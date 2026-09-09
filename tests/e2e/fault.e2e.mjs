// Latency, failures and targeted field edits — the states an app only shows
// when the backend misbehaves.
import { createChecker, loadChromium, openPage, startServer } from './harness.mjs';

const rule = (id, urlPattern, extra) => ({
  id,
  isActive: true,
  type: 'MUTATE_RESPONSE',
  urlPattern,
  method: 'ANY',
  payload: {},
  ...extra,
});

const config = {
  version: 3,
  settings: { enabled: true, captureEnabled: false, redactKeys: [] },
  rules: [
    rule('delay', '/api/users/1', { delayMs: 400 }),
    rule('failed', '/api/fail', { fault: { kind: 'status', status: 503, body: { why: 'maintenance' } } }),
    rule('offline', '/api/offline', { fault: { kind: 'network-error' } }),
    rule('hang', '/api/hang', { fault: { kind: 'timeout' } }),
    rule('edits', '/api/items', {
      ops: [
        { op: 'set', path: 'data.items[0].price', value: 0 },
        { op: 'set', path: 'data.items[*].inStock', value: false },
        { op: 'delete', path: 'data.total' },
        { op: 'set', path: 'status', value: 'APPROVED' },
      ],
    }),
  ],
};

export default async function run() {
  const t = createChecker('fault');
  const chromium = await loadChromium();
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await openPage(browser, config);
  await page.goto(server.base);

  const results = await page.evaluate(async () => {
    const xhr = (url, options = {}) =>
      new Promise((resolve) => {
        const x = new XMLHttpRequest();
        x.open(options.method ?? 'GET', url);
        if (options.responseType) x.responseType = options.responseType;
        if (options.timeout) x.timeout = options.timeout;
        const settle = (event) => resolve({ event, status: x.status, response: x.response });
        x.onload = () => settle('load');
        x.onerror = () => settle('error');
        x.ontimeout = () => settle('timeout');
        x.send();
      });

    const out = {};

    const started = performance.now();
    await fetch('/api/users/1');
    out.elapsed = performance.now() - started;

    const failed = await fetch('/api/fail');
    out.failed = { status: failed.status, body: await failed.json() };

    try {
      await fetch('/api/offline');
      out.offline = 'resolved';
    } catch (error) {
      out.offline = error.constructor.name;
    }

    // A hung request must still honour the caller's AbortController.
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const hangStarted = performance.now();
    try {
      await fetch('/api/hang', { signal: controller.signal });
      out.hang = 'resolved';
    } catch (error) {
      out.hang = error.name;
      out.hangElapsed = performance.now() - hangStarted;
    }

    out.edited = await (await fetch('/api/items')).json();
    out.editedXhrText = JSON.parse((await xhr('/api/items')).response);
    out.editedXhrJson = (await xhr('/api/items', { responseType: 'json' })).response;
    out.xhrOffline = await xhr('/api/offline');
    out.xhrHang = await xhr('/api/hang', { timeout: 300 });
    return out;
  });

  t.assert('a delay really holds the response back', results.elapsed >= 380, `${Math.round(results.elapsed)}ms`);
  t.check('a status fault replaces the response', results.failed, { status: 503, body: { why: 'maintenance' } });
  t.check('a network fault rejects like a failed fetch', results.offline, 'TypeError');
  t.check('a hung request still aborts', results.hang, 'AbortError');
  t.assert(
    'aborting a hung request is prompt',
    results.hangElapsed < 1000,
    `${Math.round(results.hangElapsed ?? 0)}ms`,
  );

  t.check('an edit reaches one array element only', results.edited.data.items.map((item) => item.price), [0, 200]);
  t.check('a wildcard edit reaches every element', results.edited.data.items.map((item) => item.inStock), [false, false]);
  t.check('a delete removes the key', 'total' in results.edited.data, false);
  t.check('edits compose with the payload merge', results.edited.status, 'APPROVED');
  t.check('edits apply to xhr responseText', results.editedXhrText.data.items[0].price, 0);
  t.check('edits apply to xhr responseType json', results.editedXhrJson.data.items[0].price, 0);

  t.check('xhr reports a network fault as an error event', results.xhrOffline.event, 'error');
  t.check('xhr network faults report status 0', results.xhrOffline.status, 0);
  t.check('xhr reports a hung request as a timeout', results.xhrHang.event, 'timeout');

  await browser.close();
  server.close();
  return t.failures;
}
