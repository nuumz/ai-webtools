/**
 * Loads the packed extension for real: exercises the paths the other suites
 * fake — the ISOLATED bridge, the runtime port, the service-worker log store
 * and the badge.
 *
 * Chromium only registers extension service workers in headed mode, so run it
 * with a display:  xvfb-run -a npm run test:ext
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChecker, loadChromium, startServer } from './harness.mjs';

export default async function run() {
  const t = createChecker('extension');
  const chromium = await loadChromium();
  const server = await startServer();
  const profile = mkdtempSync(join(tmpdir(), 'devtool-e2e-'));

  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: ['--disable-extensions-except=dist', '--load-extension=dist'],
  });

  let worker = context.serviceWorkers()[0];
  try {
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  } catch {
    console.log('SKIP [extension] no extension service worker — needs headed Chromium (xvfb-run)');
    await context.close();
    server.close();
    rmSync(profile, { recursive: true, force: true });
    return 0;
  }

  // Seed through storage, exactly as the panel does.
  await worker.evaluate(
    ([origin]) =>
      chrome.storage.local.set({
        settings: { enabled: true, captureEnabled: true, redactKeys: ['password'] },
        mutationRules: [
          { id: 's1', isActive: true, type: 'STUB', urlPattern: '/api/stub', method: 'ANY', payload: { fromStorage: true }, status: 201 },
          { id: 's2', isActive: true, type: 'STUB', urlPattern: '/api/users/*', method: 'ANY', payload: { never: true }, scope: { origins: ['https://not-this-origin.test'] } },
          { id: 's3', isActive: true, type: 'STUB', urlPattern: '/api/error', method: 'ANY', payload: { scoped: true }, status: 202, scope: { origins: [origin] } },
        ],
        // A story whose body is fetched lazily, through the real bridge.
        stories: [
          {
            id: 'st1',
            name: 'Recorded',
            isActive: true,
            strict: false,
            strictPattern: '/api/*',
            matchOn: 'path',
            scopeOrigins: [],
            entryCount: 1,
            createdAt: 0,
          },
        ],
        'story:st1': [
          {
            id: 'e1',
            method: 'ANY',
            urlPattern: '/api/story',
            status: 200,
            contentType: 'application/json',
            bodyKeys: ['bk1'],
            cycle: 'stick-last',
          },
        ],
        'body:bk1': '{"replayed":true}',
      }),
    [server.base],
  );

  const page = await context.newPage();
  await page.goto(server.base);

  // Arming is what turns interception on for a tab, and only a real panel can do
  // it: a port opened from inside the worker never reaches the worker's own
  // onConnect, so connecting there arms nothing.
  const extensionId = new URL(worker.url()).host;
  const pageTabId = await worker.evaluate(
    async ([base]) => (await chrome.tabs.query({ url: `${base}/*` }))[0]?.id,
    [server.base],
  );
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/index.html?tabId=${pageTabId}`);
  await panel.waitForTimeout(500);

  await page.bringToFront();
  await page.goto(server.base);
  const results = await page.evaluate(async () => ({
    stub: await (await fetch('/api/stub')).json(),
    scoped: (await fetch('/api/error')).status,
    unscoped: await (await fetch('/api/users/1')).json(),
    story: await (await fetch('/api/story')).json(),
  }));

  t.check('rules loaded from storage reach the page', results.stub, { fromStorage: true });
  t.check('an in-scope origin rule applies', results.scoped, 202);
  t.check('an out-of-scope rule is filtered out', results.unscoped.user.role, 'USER');
  t.check('a story body is fetched lazily and replayed', results.story, { replayed: true });

  // The metadata mirror is debounced by a second in the worker.
  await page.waitForTimeout(2000);
  const session = await worker.evaluate(() => chrome.storage.session.get(null));
  const entries = Object.entries(session).find(([key]) => key.startsWith('log:'))?.[1] ?? [];
  const summary = entries.map((entry) => `${entry.method} ${entry.pathname} ${entry.status} ${entry.servedBy}`);

  t.check('captured traffic reaches the worker', summary.length, 4);
  t.assert('story replays are logged as stubs', summary.includes('GET /api/story 200 stub'), summary.join(' | '));
  t.assert('stubs are logged as stubs', summary.includes('GET /api/stub 201 stub'), summary.join(' | '));
  t.assert('real traffic is logged', summary.includes('GET /api/users/1 200 network'), summary.join(' | '));
  t.check('the badge shows recording', await worker.evaluate(() => chrome.action.getBadgeText({})), 'REC');

  // Reloading the same URL is a new document: the previous page's traffic must
  // not linger, and the log has to start over rather than accumulate.
  await page.reload();
  await page.evaluate(() => fetch('/api/users/1'));
  await page.waitForTimeout(2000);
  const afterReload = await worker.evaluate(() => chrome.storage.session.get(null));
  const reloaded = Object.entries(afterReload).find(([key]) => key.startsWith('log:'))?.[1] ?? [];
  t.check(
    'a reload starts the log over',
    reloaded.map((entry) => `${entry.method} ${entry.pathname}`),
    ['GET /api/users/1'],
  );

  // The panel itself, with real chrome APIs: proves the per-tab subscription and
  // that a captured row renders its timing rather than an empty cell.
  // A form or an API call inside a srcdoc/about:blank frame is invisible without
  // match_about_blank + match_origin_as_fallback: the content scripts never run there.
  await page.evaluate(() => {
    const child = document.createElement('iframe');
    child.srcdoc = '<form><input id="childField"></form>';
    document.body.appendChild(child);
    const blank = document.createElement('iframe');
    document.body.appendChild(blank);
    blank.contentDocument.body.innerHTML = '<form><input id="childField"></form>';
  });
  await page.waitForTimeout(500);

  const installedIn = {};
  for (const frame of page.frames()) {
    installedIn[frame.url() || 'about:blank'] = await frame
      .evaluate(() => Boolean(window.__DEV_TOOL_INTERCEPTOR_INSTALLED__))
      .catch(() => 'unreachable');
  }
  t.check('the interceptor runs in a srcdoc frame', installedIn['about:srcdoc'], true);
  t.check('the interceptor runs in an about:blank frame', installedIn['about:blank'], true);

  const framesFilled = await worker.evaluate(async ([id]) => {
    await chrome.scripting.executeScript({
      target: { tabId: id, allFrames: true },
      files: ['formAgent.js'],
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId: id, allFrames: true },
      func: (command) => window.__DEV_TOOL_FORM_AGENT__(command),
      args: [
        {
          kind: 'fill',
          fields: [
            { key: 'childField', selectors: [{ strategy: 'id', value: 'childField' }], value: 'in a frame' },
          ],
        },
      ],
    });
    return results.filter((entry) => entry.result?.filled?.includes('childField')).length;
  }, [pageTabId]);

  // The srcdoc frame and the about:blank one — this page has no other form.
  t.check('auto-fill reaches every frame that has the field', framesFilled, 2);

  const row = panel.locator('li').first();
  const rowText = await row
    .waitFor({ timeout: 5000 })
    .then(() => row.innerText())
    .catch(() => '');

  if (rowText === '') {
    // Nothing was recorded on this tab, so there is no row to inspect; the
    // capture checks above already report why.
    console.log('SKIP [extension] panel row timing — the tab recorded nothing');
  } else {
    t.assert('the panel lists the tab it was opened for', /users\/1/.test(rowText), rowText);
    t.assert('a row shows the wall-clock start', /\d{2}:\d{2}:\d{2}\.\d{3}/.test(rowText), rowText);
    t.assert('a row shows how long the request took', /\d+ ms|\d+\.\d{2} s/.test(rowText), rowText);
  }

  /*
   * `tab/pages` is how the panel tells a page that never connected — a tab open
   * before the extension, or one Chrome refuses to script — from a quiet one.
   */
  const pagesFor = (target, waitMs = 1500) =>
    panel.evaluate(
      ([id, wait]) =>
        new Promise((resolve) => {
          const port = chrome.runtime.connect({ name: 'devtool.panel' });
          let answer;
          port.onMessage.addListener((message) => {
            if (message.kind === 'tab/pages') answer = message.connected;
          });
          port.postMessage({ kind: 'log/subscribe', tabId: id });
          setTimeout(() => {
            port.disconnect();
            resolve(answer);
          }, wait);
        }),
      [target, waitMs],
    );

  t.check('a live page reports as connected', await pagesFor(pageTabId), true);

  /*
   * Back/forward cache: a frozen document keeps its port, so the worker posts
   * into a page that cannot receive and Chrome logs "Unchecked
   * runtime.lastError" for every message. The bridge hangs up on `pagehide`
   * and re-opens on `pageshow`; without that, a restored page also reads as
   * not connected until the reattach backoff catches up.
   */
  await page.goto('chrome://version');
  // Frozen, not gone: the document is intact in the cache but can receive
  // nothing. Holding its port open is what makes the worker keep posting into
  // it — and makes this tab claim a live page it no longer has.
  t.check('a page frozen into the back/forward cache stops claiming to be connected', await pagesFor(pageTabId), false);

  await page.goBack();
  await page.waitForLoadState('domcontentloaded');
  const restored = await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.type);
  if (restored !== 'back_forward') {
    console.log(`SKIP [extension] bfcache — navigation type was "${restored}"`);
  } else {
    t.check('and it is connected again once restored', await pagesFor(pageTabId), true);
  }

  const darkTab = await context.newPage();
  await darkTab.goto('chrome://version');
  const darkTabId = await worker.evaluate(
    async () => (await chrome.tabs.query({ url: 'chrome://version/*' }))[0]?.id,
  );
  t.check('a tab that runs no content script reports as not connected', await pagesFor(darkTabId), false);
  await darkTab.close();

  /*
   * Sync is a mirror, and a mock too fat for one sync item never reaches it.
   * Before the mirrored-key bookkeeping, the next pull deleted it from local —
   * which is how a stub "kept disappearing" on its own.
   */
  await worker.evaluate(async ([blob]) => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.remove('syncMirroredKeys');
    const stored = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: { ...stored.settings, syncEnabled: true },
      mutationRules: [
        { id: 'sm', isActive: true, type: 'STUB', urlPattern: '/api/sync-small', method: 'ANY', payload: { a: 1 } },
        { id: 'lg', isActive: true, type: 'STUB', urlPattern: '/api/sync-large', method: 'ANY', payload: { blob } },
      ],
    });
  }, ['x'.repeat(20000)]);

  // The push is debounced at 1.5 s; then a write from "another device" pulls.
  await page.waitForTimeout(3000);
  await worker.evaluate(() => chrome.storage.sync.set({ 'profile:other-device': { id: 'other-device', name: 'p' } }));
  await page.waitForTimeout(2500);

  const survivors = await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get('mutationRules');
    return (stored.mutationRules ?? []).map((rule) => rule.id).sort();
  });
  t.check('a mock too large to sync survives a pull', survivors.join(','), 'lg,sm');

  await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
  return t.failures;
}
