/**
 * End-to-end check of the MAIN-world interceptor against a real Chromium page.
 *
 * The extension itself has no runtime dependency on Playwright, so it is not a
 * devDependency. To run this suite:
 *
 *   npm run build
 *   npm i -D playwright && npx playwright install chromium
 *   npm run test:e2e
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}
const PAGE = '<!doctype html><meta charset=utf-8><title>t</title><body>ok</body>';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') { res.writeHead(200, {'content-type':'text/html'}); return res.end(PAGE); }
  if (url.pathname === '/api/users/1') {
    res.writeHead(200, {'content-type':'application/json'});
    return res.end(JSON.stringify({ status: 'PENDING', user: { name: 'real', role: 'USER' } }));
  }
  if (url.pathname === '/api/submit') {
    let body = '';
    req.on('data', (c) => (body += c));
    return req.on('end', () => { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({ echo: JSON.parse(body || '{}') })); });
  }
  if (url.pathname === '/api/stub') { hitStub = true; res.writeHead(200, {'content-type':'application/json'}); return res.end('{"real":true}'); }
  res.writeHead(404); res.end();
});
let hitStub = false;
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const rules = [
  { id: '1', isActive: true, type: 'MUTATE_RESPONSE', urlPattern: '/api/users/*', method: 'ANY', payload: { user: { role: 'ADMIN' }, status: 'APPROVED' } },
  { id: '2', isActive: true, type: 'MUTATE_REQUEST', urlPattern: '/api/submit', method: 'POST', payload: { role: 'ADMIN' } },
  { id: '3', isActive: true, type: 'STUB', urlPattern: '/api/stub', method: 'ANY', payload: { stubbed: true }, status: 201 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript((json) => {
  window.addEventListener('__DEV_TOOL_REQUEST_RULES__', () => {
    window.dispatchEvent(new CustomEvent('__DEV_TOOL_SYNC_RULES__', { detail: json }));
  });
}, JSON.stringify(rules));
await page.addInitScript({ content: readFileSync('dist/interceptor.main.js', 'utf8') });
// The unmatched-passthrough case intentionally requests a 404 URL.
await page.goto(base);

const results = await page.evaluate(async () => {
  const xhr = (method, url, body, responseType = '') => new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    x.responseType = responseType;
    x.onload = () => resolve({ status: x.status, response: x.response, readyState: x.readyState });
    x.onerror = () => resolve({ error: true });
    x.send(body);
  });
  const out = {};
  out.fetchResponseMutation = await (await fetch('/api/users/1')).json();
  out.fetchRequestMutation = await (await fetch('/api/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'A' }) })).json();
  const stub = await fetch('/api/stub');
  out.fetchStub = { status: stub.status, body: await stub.json(), header: stub.headers.get('x-intercepted') };
  out.fetchUnmatched = (await fetch('/api/users/1'.replace('users','other'))).status;
  out.xhrResponseMutationText = JSON.parse((await xhr('GET', '/api/users/1')).response);
  out.xhrResponseMutationJson = (await xhr('GET', '/api/users/1', null, 'json')).response;
  out.xhrRequestMutation = JSON.parse((await xhr('POST', '/api/submit', JSON.stringify({ name: 'B' }))).response);
  out.xhrStub = await xhr('GET', '/api/stub');
  return out;
});

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` → got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
check('fetch response mutation', results.fetchResponseMutation, { status: 'APPROVED', user: { name: 'real', role: 'ADMIN' } });
check('fetch request mutation', results.fetchRequestMutation, { echo: { name: 'A', role: 'ADMIN' } });
check('fetch stub', results.fetchStub, { status: 201, body: { stubbed: true }, header: 'STUB' });
check('fetch unmatched passthrough', results.fetchUnmatched, 404);
check('xhr response mutation (text)', results.xhrResponseMutationText, { status: 'APPROVED', user: { name: 'real', role: 'ADMIN' } });
check('xhr response mutation (json)', results.xhrResponseMutationJson, { status: 'APPROVED', user: { name: 'real', role: 'ADMIN' } });
check('xhr request mutation', results.xhrRequestMutation, { echo: { name: 'B', role: 'ADMIN' } });
check('xhr stub', results.xhrStub, { status: 201, response: '{"stubbed":true}', readyState: 4 });
check('stub never hit the network', hitStub, false);

await browser.close();
server.close();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed.');
}
