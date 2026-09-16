/**
 * Shared fixture for the end-to-end suites: a local API, a Chromium page with
 * the built interceptor injected, and a fake bridge that pushes config in.
 *
 * The extension has no runtime dependency on Playwright, so it is not a
 * devDependency. To run these suites:
 *
 *   npm run build
 *   npm i -D playwright && npx playwright install chromium
 *   npm run test:e2e
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';

const PAGE = '<!doctype html><meta charset=utf-8><title>t</title><body>ok</body>';

/*
 * A suite closes its own browser and server on the way out. When one throws
 * part way through, nothing does — and an open Chromium connection or a
 * listening socket keeps node alive, so letting the runner carry on to the
 * next suite would hang the run rather than end it.
 *
 * Every such resource is handed out from here, so this is also the one place
 * that can dispose of whatever a failed suite left behind.
 */
const openResources = new Set();
const checkers = [];

/** Closes anything the suites opened. Safe to call after a clean suite too: closing twice is a no-op. */
export async function closeOpenResources() {
  for (const close of openResources) {
    try {
      await close();
    } catch {
      // Already closed on the happy path, which is the common case.
    }
  }
  openResources.clear();
}

/**
 * Failures recorded by every checker so far. The runner reads this instead of
 * a suite's return value, so the checks a suite did run still count when it
 * throws before it can return them.
 */
function recordedFailures() {
  return checkers.reduce((total, checker) => total + checker.failures, 0);
}

/*
 * Runs the named suites and returns the total number of failed checks.
 *
 * A suite that throws — a Playwright timeout, most often — used to take the
 * process with it, so one broken wait hid the state of every later suite and
 * the log ended in a stack trace instead of a tally. Report it as the failure
 * it is and keep going; the run still exits non-zero.
 */
export async function runSuites(entries) {
  let thrown = 0;
  /*
   * A suite abandons its in-flight page calls when it throws, and every one of
   * them rejects with "Target closed" the moment we tear the browser down.
   * Node treats an unhandled rejection as fatal, so those would kill the run we
   * are keeping alive — while the failure that caused them is already reported.
   * Outside that window a rejection nobody handled is a real defect, so it
   * counts.
   */
  let unravelling = false;
  const onUnhandled = (reason) => {
    const detail = reason?.message ?? reason;
    if (unravelling) {
      console.error(`      (abandoned by the failure) ${detail}`);
      return;
    }
    thrown += 1;
    console.error(`FAIL [runner] nothing handled a rejected promise → ${detail}`);
  };
  process.on('unhandledRejection', onUnhandled);

  try {
    for (const [name, suite] of entries) {
      try {
        await suite();
      } catch (error) {
        thrown += 1;
        unravelling = true;
        console.error(`FAIL [${name}] the suite threw before it finished → ${error?.message ?? error}`);
        const where = String(error?.stack ?? '')
          .split('\n')
          .find((line) => line.includes('/tests/'));
        if (where) console.error(`      ${where.trim()}`);
      } finally {
        // The suite closes these itself when it gets that far; this catches
        // what a throw skipped, so no open handle can keep the run alive.
        await closeOpenResources();
        // Give the calls it abandoned a turn to settle against the closed
        // browser before rejections count against the next suite.
        await new Promise((resolve) => setTimeout(resolve, 0));
        unravelling = false;
      }
    }
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return recordedFailures() + thrown;
}

export async function loadChromium() {
  try {
    const { chromium } = await import('playwright');
    // Suites call `chromium.launch()` directly, so hand back a stand-in that
    // registers what it opens. Reflect/bind keeps every call on the real
    // BrowserType, which owns private state a copied object would not have.
    return new Proxy(chromium, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        const method = value.bind(target);
        if (property !== 'launch' && property !== 'launchPersistentContext') return method;
        return async (...args) => {
          const handle = await method(...args);
          openResources.add(() => handle.close());
          return handle;
        };
      },
    });
  } catch {
    console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
}

/** Endpoints the suites exercise. `state.stubHits` proves a stub never reached the network. */
export async function startServer() {
  const state = { stubHits: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (body, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(PAGE);
    }
    // The form fixture, also usable by hand: `npx serve demo`.
    if (url.pathname === '/demo' || url.pathname === '/demo/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(readFileSync('demo/index.html', 'utf8'));
    }
    // A wizard shaped like the app the extension is used on: several steps
    // behind one URL, Thai labels, BE dates, conditional and late-loaded fields.
    // The wizard as it is really met: inside a device simulator's iframe.
    if (url.pathname === '/demo/device' || url.pathname === '/demo/device.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(readFileSync('demo/device.html', 'utf8'));
    }
    if (url.pathname === '/demo/kesc' || url.pathname === '/demo/kesc.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(readFileSync('demo/kesc.html', 'utf8'));
    }
    if (url.pathname === '/demo/wizard' || url.pathname === '/demo/wizard.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(readFileSync('demo/wizard.html', 'utf8'));
    }
    if (url.pathname === '/demo/frame.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(readFileSync('demo/frame.html', 'utf8'));
    }
    if (url.pathname === '/api/users/1') {
      return json({ status: 'PENDING', user: { name: 'real', role: 'USER' } });
    }
    if (url.pathname === '/api/submit' || url.pathname === '/api/login') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      return req.on('end', () => json({ echo: JSON.parse(body || '{}') }));
    }
    if (url.pathname === '/api/stub') {
      state.stubHits += 1;
      return json({ real: true });
    }
    if (url.pathname === '/api/big') {
      // Comfortably past the 1MB capture cap.
      return json({ blob: 'x'.repeat(2 * 1024 * 1024) });
    }
    // Large but under the cap: must survive whole, or a stub built from it is broken JSON.
    if (url.pathname === '/api/large') {
      return json({ rows: Array.from({ length: 8000 }, (_, i) => ({ id: i, name: `row ${i}` })) });
    }
    // Headers land at once, the body never ends: what a keep-alive proxy, an SSE
    // channel or a stalled upstream looks like to the page.
    if (url.pathname === '/api/dribble') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"partial":');
      return; // deliberately never ended
    }
    if (url.pathname === '/api/error') {
      return json({ message: 'boom' }, 500);
    }
    if (url.pathname === '/api/slow') {
      const wait = Number(url.searchParams.get('ms') ?? '0');
      return setTimeout(() => json({ slow: true, waited: wait }), wait);
    }
    if (url.pathname === '/api/items') {
      return json({
        status: 'PENDING',
        data: {
          items: [
            { sku: 'a', price: 100, inStock: true },
            { sku: 'b', price: 200, inStock: true },
          ],
          total: 300,
        },
      });
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, resolve));
  openResources.add(() => server.close());
  return {
    base: `http://localhost:${server.address().port}`,
    state,
    close: () => server.close(),
  };
}

/**
 * Opens a page with the built MAIN-world bundle plus a stand-in for the
 * ISOLATED bridge (config push, capture collection and story-body lookup), so
 * suites exercise the real interceptor without loading the extension.
 */
export async function openPage(browser, config, { bodies = {} } = {}) {
  const page = await browser.newPage();
  const payload = Array.isArray(config) ? config : { ...config, armed: true };
  await page.addInitScript(([json, bodyJson]) => {
    const storedBodies = JSON.parse(bodyJson);
    window.__captured = [];
    window.addEventListener('__DEV_TOOL_CAPTURE__', (event) => {
      try {
        window.__captured.push(...JSON.parse(event.detail));
      } catch {
        /* ignore malformed batches */
      }
    });
    window.addEventListener('__DEV_TOOL_REQUEST_RULES__', () => {
      window.dispatchEvent(new CustomEvent('__DEV_TOOL_SYNC_RULES__', { detail: json }));
    });
    window.addEventListener('__DEV_TOOL_BODY_REQUEST__', (event) => {
      const { requestId, bodyKey } = JSON.parse(event.detail);
      window.dispatchEvent(
        new CustomEvent('__DEV_TOOL_BODY_REPLY__', {
          detail: JSON.stringify({ requestId, text: storedBodies[bodyKey] ?? null }),
        }),
      );
    });
  }, [JSON.stringify(payload), JSON.stringify(bodies)]);
  await page.addInitScript({ content: readFileSync('dist/interceptor.main.js', 'utf8') });
  return page;
}

/** Reads the capture buffer after giving the 100ms batch timer room to flush. */
export async function drainCaptures(page) {
  await page.waitForTimeout(250);
  const raw = await page.evaluate(() => window.__captured ?? []);
  const byId = new Map();
  for (const entry of raw) byId.set(entry.id, entry);
  return [...byId.values()];
}

/** Loads the built form agent into every frame of a page, as executeScript would. */
export async function openFormPage(browser, base) {
  const page = await browser.newPage();
  await page.addInitScript({ content: readFileSync('dist/formAgent.js', 'utf8') });
  await page.goto(`${base}/demo`);
  return page;
}

export function createChecker(suite) {
  let failures = 0;
  const checker = {
    check(name, got, want) {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      if (!ok) failures += 1;
      const detail = ok ? '' : ` → got ${JSON.stringify(got)} want ${JSON.stringify(want)}`;
      console.log(`${ok ? 'PASS' : 'FAIL'} [${suite}] ${name}${detail}`);
    },
    assert(name, condition, detail = '') {
      if (!condition) failures += 1;
      console.log(`${condition ? 'PASS' : 'FAIL'} [${suite}] ${name}${condition ? '' : ` → ${detail}`}`);
    },
    get failures() {
      return failures;
    },
  };
  checkers.push(checker);
  return checker;
}
