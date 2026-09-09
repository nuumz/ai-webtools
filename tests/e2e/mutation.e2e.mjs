// Rule engine: request/response mutation and stubbing, over both transports.
// The config is pushed as a BARE ARRAY on purpose: it pins the v1 payload
// shape the interceptor must keep accepting.
import { createChecker, drainCaptures, loadChromium, openPage, startServer } from './harness.mjs';

export default async function run() {
  const t = createChecker('mutation');
  const chromium = await loadChromium();
  const server = await startServer();

  const rules = [
    { id: '1', isActive: true, type: 'MUTATE_RESPONSE', urlPattern: '/api/users/*', method: 'ANY', payload: { user: { role: 'ADMIN' }, status: 'APPROVED' } },
    { id: '2', isActive: true, type: 'MUTATE_REQUEST', urlPattern: '/api/submit', method: 'POST', payload: { role: 'ADMIN' } },
    { id: '3', isActive: true, type: 'STUB', urlPattern: '/api/stub', method: 'ANY', payload: { stubbed: true }, status: 201 },
  ];

  const browser = await chromium.launch();
  const page = await openPage(browser, rules);
  await page.goto(server.base);

  const results = await page.evaluate(async () => {
    const xhr = (method, url, body, responseType = '') =>
      new Promise((resolve) => {
        const x = new XMLHttpRequest();
        x.open(method, url);
        x.responseType = responseType;
        x.onload = () => resolve({ status: x.status, response: x.response, readyState: x.readyState });
        x.onerror = () => resolve({ error: true });
        x.send(body);
      });

    const out = {};
    out.fetchResponseMutation = await (await fetch('/api/users/1')).json();
    out.fetchRequestMutation = await (
      await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'A' }),
      })
    ).json();
    const stub = await fetch('/api/stub');
    out.fetchStub = { status: stub.status, body: await stub.json(), header: stub.headers.get('x-intercepted') };
    out.fetchUnmatched = (await fetch('/api/other')).status;
    out.xhrResponseMutationText = JSON.parse((await xhr('GET', '/api/users/1')).response);
    out.xhrResponseMutationJson = (await xhr('GET', '/api/users/1', null, 'json')).response;
    out.xhrRequestMutation = JSON.parse((await xhr('POST', '/api/submit', JSON.stringify({ name: 'B' }))).response);
    out.xhrStub = await xhr('GET', '/api/stub');
    return out;
  });

  t.check('fetch response mutation', results.fetchResponseMutation, { status: 'APPROVED', user: { name: 'real', role: 'ADMIN' } });
  t.check('fetch request mutation', results.fetchRequestMutation, { echo: { name: 'A', role: 'ADMIN' } });
  t.check('fetch stub', results.fetchStub, { status: 201, body: { stubbed: true }, header: 'STUB' });
  t.check('fetch unmatched passthrough', results.fetchUnmatched, 404);
  t.check('xhr response mutation (text)', results.xhrResponseMutationText, { status: 'APPROVED', user: { name: 'real', role: 'ADMIN' } });
  t.check('xhr response mutation (json)', results.xhrResponseMutationJson, { status: 'APPROVED', user: { name: 'real', role: 'ADMIN' } });
  t.check('xhr request mutation', results.xhrRequestMutation, { echo: { name: 'B', role: 'ADMIN' } });
  t.check('xhr stub', results.xhrStub, { status: 201, response: '{"stubbed":true}', readyState: 4 });
  t.check('stub never hit the network', server.state.stubHits, 0);

  // v1 config carries no settings, so capture must stay off.
  const captured = await drainCaptures(page);
  t.check('legacy config captures nothing', captured.length, 0);

  await browser.close();
  server.close();
  return t.failures;
}
