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

  await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
  return t.failures;
}
