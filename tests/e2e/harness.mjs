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

export async function loadChromium() {
  try {
    const { chromium } = await import('playwright');
    return chromium;
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
      // Comfortably past the 64KB capture cap.
      return json({ blob: 'x'.repeat(100 * 1024) });
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
  }, [JSON.stringify(config), JSON.stringify(bodies)]);
  await page.addInitScript({ content: readFileSync('dist/interceptor.main.js', 'utf8') });
  return page;
}

/** Reads the capture buffer after giving the 100ms batch timer room to flush. */
export async function drainCaptures(page) {
  await page.waitForTimeout(250);
  return page.evaluate(() => window.__captured ?? []);
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
  return {
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
}
