// Capture pipeline: what the MAIN world emits for the panel's network log.
import { createChecker, drainCaptures, loadChromium, openPage, startServer } from './harness.mjs';

const config = (overrides = {}) => ({
  version: 2,
  settings: { enabled: true, captureEnabled: true, redactKeys: ['password', 'token'], ...overrides },
  rules: [
    { id: '1', isActive: true, type: 'STUB', urlPattern: '/api/stub', method: 'ANY', payload: { stubbed: true }, status: 201 },
    { id: '2', isActive: true, type: 'MUTATE_RESPONSE', urlPattern: '/api/users/*', method: 'ANY', payload: { status: 'APPROVED' } },
  ],
});

export default async function run() {
  const t = createChecker('capture');
  const chromium = await loadChromium();
  const server = await startServer();
  const browser = await chromium.launch();

  const page = await openPage(browser, config());
  await page.goto(server.base);
  await page.evaluate(async () => {
    await fetch('/api/users/1');
    await fetch('/api/error');
    await fetch('/api/stub');
    await fetch('/api/big');
    await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer super-secret' },
      body: JSON.stringify({ username: 'qa', password: 'hunter2' }),
    });
    await new Promise((resolve) => {
      const x = new XMLHttpRequest();
      x.open('GET', '/api/users/1');
      x.onloadend = resolve;
      x.send();
    });
  });

  const captured = await drainCaptures(page);
  const byPath = (path) => captured.filter((x) => x.url.includes(path));

  t.check('one record per request', captured.length, 6);

  const mutated = byPath('/api/users/1').find((x) => x.transport === 'fetch');
  t.check('mutated response is tagged', mutated?.servedBy, 'mutated');
  t.check('mutated body is what the app received', JSON.parse(mutated?.responseBody?.text ?? '{}').status, 'APPROVED');

  const xhrRecord = byPath('/api/users/1').find((x) => x.transport === 'xhr');
  t.assert('xhr requests are captured', xhrRecord !== undefined, 'no xhr record');
  t.check('xhr status is recorded', xhrRecord?.status, 200);

  t.check('stubs are tagged', byPath('/api/stub')[0]?.servedBy, 'stub');
  t.check('stubs never reach the network', server.state.stubHits, 0);

  const failure = byPath('/api/error')[0];
  t.check('error status is recorded', failure?.status, 500);
  t.check('error is served by the network', failure?.servedBy, 'network');

  const big = byPath('/api/big')[0];
  t.check('oversized body is truncated', big?.responseBody?.truncated, true);
  t.assert(
    'truncated body is capped at 64KB',
    (big?.responseBody?.text.length ?? 0) <= 64 * 1024 + 1,
    `length ${big?.responseBody?.text.length}`,
  );

  const login = byPath('/api/login')[0];
  t.check('sensitive request fields are redacted', JSON.parse(login?.requestBody?.text ?? '{}').password, '«redacted»');
  t.check('the rest of the body survives redaction', JSON.parse(login?.requestBody?.text ?? '{}').username, 'qa');
  t.check('redaction is flagged', login?.requestBody?.redacted, true);
  t.check('authorization header is redacted', login?.requestHeaders?.authorization, '«redacted»');

  // Recording off: rules still apply, nothing is captured.
  const quiet = await openPage(browser, config({ captureEnabled: false }));
  await quiet.goto(server.base);
  const quietResult = await quiet.evaluate(async () => (await fetch('/api/stub')).status);
  t.check('rules still apply while recording is off', quietResult, 201);
  t.check('nothing is captured while recording is off', (await drainCaptures(quiet)).length, 0);

  // Master switch off: no interception at all.
  const disabled = await openPage(browser, config({ enabled: false, captureEnabled: true }));
  await disabled.goto(server.base);
  const disabledResult = await disabled.evaluate(async () => (await fetch('/api/stub')).status);
  t.check('master switch disables interception', disabledResult, 200);
  t.check('capture still works with interception off', (await drainCaptures(disabled))[0]?.servedBy, 'network');

  await browser.close();
  server.close();
  return t.failures;
}
