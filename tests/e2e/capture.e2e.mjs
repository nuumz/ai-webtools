// Capture pipeline: what the MAIN world emits for the panel's network log.
import { createChecker, drainCaptures, loadChromium, openPage, startServer } from './harness.mjs';

/** Mirrors MAX_BODY_BYTES in src/shared/capture.ts. */
const CAP = 1024 * 1024;

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
    await fetch('/api/large');
    // Headers only: the body never ends, and the app carries on with the status.
    void fetch('/api/dribble').then((res) => res.status);
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

  t.check('one record per request', captured.length, 8);

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
    'truncated body is capped',
    (big?.responseBody?.text.length ?? 0) <= CAP + 1,
    `length ${big?.responseBody?.text.length}`,
  );

  // A body under the cap must arrive whole: a mock is built by parsing this text,
  // so one missing byte turns into a stub that serves the app nothing.
  const large = byPath('/api/large')[0];
  t.check('a large body under the cap is kept whole', large?.responseBody?.truncated, false);
  t.check(
    'a large body still parses',
    JSON.parse(large?.responseBody?.text ?? '{}').rows?.length,
    8000,
  );

  // The row closes when the page has its response. Waiting for the body to end
  // would leave an SSE channel or a stalled proxy "in progress" for minutes.
  const dribble = byPath('/api/dribble')[0];
  t.check('a never-ending body still finishes the row', dribble?.outcome, 'ok');
  t.check('the row reports the status the app got', dribble?.status, 200);
  t.check('a half-read body is not stored', dribble?.responseBody, undefined);

  const login = byPath('/api/login')[0];
  t.check('sensitive request fields are redacted', JSON.parse(login?.requestBody?.text ?? '{}').password, '«redacted»');
  t.check('the rest of the body survives redaction', JSON.parse(login?.requestBody?.text ?? '{}').username, 'qa');
  t.check('redaction is flagged', login?.requestBody?.redacted, true);
  t.check('authorization header is redacted', login?.requestHeaders?.authorization, '«redacted»');

  // Raising the limit is what makes a multi-megabyte response stubbable at all:
  // the same body that truncates at the default must arrive whole here.
  const roomy = await openPage(browser, config({ captureBodyLimit: 4 * 1024 * 1024 }));
  await roomy.goto(server.base);
  await roomy.evaluate(() => fetch('/api/big'));
  const roomyBig = (await drainCaptures(roomy)).find((x) => x.url.includes('/api/big'));
  t.check('a raised limit keeps a 2 MB body whole', roomyBig?.responseBody?.truncated, false);
  t.check(
    'the raised body still parses',
    JSON.parse(roomyBig?.responseBody?.text ?? '{}').blob?.length,
    2 * 1024 * 1024,
  );

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
