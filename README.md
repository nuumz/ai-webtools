# DevTool: API Mutator & Form Filler

A Manifest V3 extension for Edge/Chrome that puts a React **Side Panel** next to the app
you are developing: watch the API traffic the page actually makes, turn any real response
into a mock with one click, and stop retyping the same form data every round.

The idea behind *dynamic mutation*: let the request reach the real backend, but

- rewrite the **request payload** just before it leaves the page, and/or
- rewrite the **response body** just before React/Vue sees it.

Your business logic, auth and database still run — you only override the fields you care
about (`status: "PENDING"` → `status: "APPROVED"`, `role: "USER"` → `role: "ADMIN"`, …).
Full stubbing is still available when you want the network out of the picture entirely.

## Architecture

```
┌──────────────────┐  chrome.storage.local  ┌───────────────────────┐
│  Side Panel      │ ─────────────────────► │  bridge.isolated.js   │
│  (React + TS)    │ ◄── storage.onChanged ─│  ISOLATED world       │
└────────┬─────────┘                        └───────────┬───────────┘
         │ runtime port                      config ▲   │ CustomEvent
         ▼                                  (JSON)  │   ▼ (JSON string)
┌──────────────────┐   capture (port)       ┌───────┴───────────────┐
│ service worker   │ ◄───────────────────── │ interceptor.main.js   │
│ router+logStore  │                        │ MAIN world            │
└──────────────────┘                        │ patches fetch + XHR   │
                                            └───────────────────────┘
```

| File | World | Responsibility |
| --- | --- | --- |
| `src/panel/*` | Extension page | React UI: network log, rule CRUD, auto-fill mappings |
| `src/background/index.ts` | Service worker | Opens the panel, seeds storage, drives the toolbar badge |
| `src/background/router.ts` | Service worker | Port registry: page capture in, panel updates out |
| `src/background/logStore.ts` | Service worker | Per-tab ring buffer of captured exchanges |
| `src/content/bridge.isolated.ts` | ISOLATED | Pushes config to the page, forwards capture to the worker |
| `src/content/interceptor.main.ts` | MAIN | Patches `window.fetch` and `XMLHttpRequest` |
| `src/shared/*` | Everywhere | Rule types, URL matching, deep merge, capture + redaction, storage |

The ISOLATED bridge exists because a content script cannot patch the page's own `fetch`,
and a MAIN-world script cannot call `chrome.*`. Config crosses that boundary as a JSON
string on a `CustomEvent` and is re-pushed on every `storage.onChanged`, so edits in the
panel apply to the next request without reloading the page.

The bridge opens a `chrome.runtime` port to the service worker **only while recording**,
which is what makes the network log work without any extra permissions: `port.sender`
carries the tab id and frame URL for free, and an idle tab holds no port open.

## Network log

Press **Record** in the panel and every `fetch`/`XHR` on the active tab shows up: method,
path, status, size, and a badge when the response was served by a stub or mutated. Expand
a row to see the request and response bodies, then turn it into a rule with one click:

| Button | Creates |
| --- | --- |
| **Stub this response** | A `STUB` rule preloaded with the real response body and status |
| **Mutate response** | A `MUTATE_RESPONSE` rule for that endpoint, ready for your overrides |
| **Mutate request** | A `MUTATE_REQUEST` rule for that endpoint |

Tick *Match the query string too* when two calls to the same path differ only by their
query (`/api/search?type=A` vs `?type=B`) — the generated pattern then pins the full URL.

**Redaction.** `Authorization`, `Cookie` and similar headers are always masked, along with
any field whose name matches the configurable key list (`password`, `token`, `secret`,
`citizenId`, `cardNo`, …). Masking happens in the page, before a record reaches the worker,
so secrets never enter the log. Bodies are truncated at 64 KB and only text/JSON-ish
content types are stored at all.

## Rule types

| Type | Behaviour |
| --- | --- |
| `MUTATE_REQUEST` | Deep-merges the payload into the outgoing JSON body, then hits the real backend |
| `MUTATE_RESPONSE` | Calls the real backend, then deep-merges the payload into the JSON response |
| `STUB` | Never touches the network; returns the payload with the configured status code |

Deep merge replaces arrays and primitives outright and merges plain objects recursively,
so `{"user": {"role": "ADMIN"}}` overrides only `user.role` and leaves the rest of the
real response intact. Rules also accept an optional `priority` (higher wins; equal
priorities keep insertion order) and `scope.origins`, which restricts a rule to matching
origins — scoped-out rules are filtered before they are ever pushed into a frame.

The master switch in the panel header disables all interception at once; the toolbar badge
shows `OFF` when it is off, `REC` while recording, and the active rule count otherwise.

### URL patterns

| Pattern | Matched as |
| --- | --- |
| `https://api.example.com/v1/*` | Full [`URLPattern`](https://developer.mozilla.org/docs/Web/API/URLPattern) |
| `/api/v1/users/*` | `URLPattern` on the pathname only |
| `users` | Substring of the whole URL (a `*` turns it into a glob) |

`URLPattern` is used when the browser exposes it; otherwise a glob → RegExp fallback keeps
matching working. Relative request URLs are resolved against the page URL before matching.

## Auto-fill

The panel's **Auto-Fill Form** button injects a script into the active tab (via
`chrome.scripting.executeScript`) that writes each configured `selector → value` pair.
Values are written through the native `HTMLInputElement.prototype.value` setter and
followed by `input`/`change` events, so React and Vue value trackers pick the change up
instead of silently reverting it. Mappings are editable in the *Auto-Fill Fields* card.

## Build & load

```bash
npm install
npm run build       # typecheck + Vite (panel) + esbuild (worker/content scripts) → dist/
```

Then in Edge (`edge://extensions`) or Chrome (`chrome://extensions`): enable **Developer
mode** → **Load unpacked** → select `dist/`. Click the toolbar icon to open the panel.

Other scripts:

```bash
npm run dev            # Vite dev server for the panel UI alone
npm run watch:scripts  # rebuild worker/content scripts on change
npm run typecheck
npm run test:e2e       # rule engine + capture suites (headless)
npm run test:ext       # loads dist/ as a real extension; needs a display: xvfb-run -a npm run test:ext
```

Both test commands need `npm run build` first and `npm i -D playwright && npx playwright
install chromium` — Playwright is deliberately not a devDependency, so a plain install
stays lean. `vite build` emits the panel, and `scripts/build-scripts.mjs` bundles the
service worker and both content scripts as self-contained IIFEs, because MV3 content
scripts cannot be ES modules.

## Notes & limits

- Requires Chrome/Edge 111+ for `"world": "MAIN"` content scripts.
- Only JSON bodies are mutated; other content types pass through untouched.
- The interceptor patches `fetch` and `XMLHttpRequest`. Traffic from Service Workers,
  `sendBeacon`, WebSocket or `EventSource` is not intercepted.
- `204`/`205`/`304` responses are left alone, and responses declaring more than 5 MB are
  passed through rather than buffered and reparsed.
- `content-length`/`content-encoding` are dropped from mutated responses since the body
  is rewritten; mutated responses carry `x-intercepted` for easy spotting.
- The log keeps 500 entries / 8 MB per tab and is cleared when the tab navigates or
  closes. Its metadata survives a service-worker restart; bodies do not.
- While recording, every tab holds a port open, which keeps the service worker alive by
  design. Turn recording off when you are done.
- Rules are stored in `chrome.storage.local` and apply to every frame of every site
  unless you scope them, so keep patterns narrow.
