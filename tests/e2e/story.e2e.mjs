// Stories: real responses recorded once and replayed as stubs.
import { createChecker, loadChromium, openPage, startServer } from './harness.mjs';

const entry = (id, urlPattern, bodyKeys, overrides = {}) => ({
  id: `st1:${id}`,
  isActive: true,
  type: 'STUB',
  urlPattern,
  method: 'ANY',
  payload: null,
  status: 200,
  priority: -1,
  contentType: 'application/json',
  storyId: 'st1',
  cycle: 'stick-last',
  bodyKeys,
  ...overrides,
});

const BODIES = {
  b_users: '{"user":{"name":"recorded","role":"USER"},"status":"PENDING"}',
  b_job1: '{"state":"PENDING"}',
  b_job2: '{"state":"RUNNING"}',
  b_job3: '{"state":"DONE"}',
  b_once: '{"served":"once"}',
};

const config = {
  version: 3,
  settings: { enabled: true, captureEnabled: false, redactKeys: [] },
  rules: [
    // Same path as a story entry, but a hand-written rule must win.
    {
      id: 'r1',
      isActive: true,
      type: 'STUB',
      urlPattern: '/api/submit',
      method: 'ANY',
      payload: { fromRule: true },
      status: 200,
    },
  ],
  storyRules: [
    entry('users', '/api/users/1', ['b_users']),
    entry('job', '/api/job', ['b_job1', 'b_job2', 'b_job3']),
    entry('once', '/api/once', ['b_once'], { cycle: 'once' }),
    entry('missing', '/api/missing', ['not-stored']),
    entry('submit', '/api/submit', ['b_users']),
  ],
  strictPatterns: ['/api/strict/*'],
};

export default async function run() {
  const t = createChecker('story');
  const chromium = await loadChromium();
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await openPage(browser, config, { bodies: BODIES });
  await page.goto(server.base);

  const online = await page.evaluate(async () => {
    const get = async (path) => {
      const response = await fetch(path);
      return { status: response.status, body: await response.text() };
    };
    const out = {};
    out.replayed = await get('/api/users/1');
    // Repeat hits walk the recorded sequence, then hold on the last one.
    out.job = [];
    for (let i = 0; i < 4; i += 1) out.job.push(JSON.parse((await get('/api/job')).body).state);
    out.onceFirst = await get('/api/once');
    out.onceSecond = await get('/api/once');
    out.missing = await get('/api/missing');
    out.ruleWins = await get('/api/submit');
    out.strictMiss = await get('/api/strict/anything');
    out.uncovered = await get('/api/other');
    out.intercepted = (await fetch('/api/users/1')).headers.get('x-intercepted');
    return out;
  });

  t.check('a recorded response is replayed', JSON.parse(online.replayed.body).user.name, 'recorded');
  t.check('replayed responses are labelled', online.intercepted, 'STORY');
  t.check('repeat hits walk the sequence', online.job, ['PENDING', 'RUNNING', 'DONE', 'DONE']);
  t.check('a once-cycle entry serves its body', JSON.parse(online.onceFirst.body).served, 'once');
  t.check('an exhausted once-cycle falls through', online.onceSecond.status, 404);
  t.check('a missing body falls through to the network', online.missing.status, 404);
  t.check('a hand-written rule beats the story', JSON.parse(online.ruleWins.body).fromRule, true);
  t.check('a strict story refuses what it does not cover', online.strictMiss.status, 501);
  t.check('strict only applies inside its pattern', online.uncovered.status, 404);

  // The real test of a recording: does it still work with the backend gone?
  server.close();
  const offline = await page.evaluate(async () => {
    const xhr = (url) =>
      new Promise((resolve) => {
        const x = new XMLHttpRequest();
        x.open('GET', url);
        x.onload = () => resolve({ status: x.status, body: x.responseText });
        x.onerror = () => resolve({ error: true });
        x.send();
      });
    const out = {};
    out.fetch = await (await fetch('/api/users/1')).text();
    out.xhr = await xhr('/api/users/1');
    try {
      await fetch('/api/other');
      out.serverStillUp = true;
    } catch {
      out.serverStillUp = false;
    }
    return out;
  });

  t.check('fetch replays with the backend down', offline.fetch, BODIES.b_users);
  t.check('xhr replays with the backend down', offline.xhr.body, BODIES.b_users);
  t.check('xhr replay reports the recorded status', offline.xhr.status, 200);
  t.check('the backend really was down', offline.serverStillUp, false);

  await browser.close();
  return t.failures;
}
