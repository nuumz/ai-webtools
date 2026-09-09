# DevTool: API Mutator & Form Filler

A Manifest V3 extension for Edge/Chrome that puts a React **Side Panel** next to the app
you are developing, and lets you **mutate live API traffic** instead of stubbing it away.

The idea behind *dynamic mutation*: let the request reach the real backend, but

- rewrite the **request payload** just before it leaves the page, and/or
- rewrite the **response body** just before React/Vue sees it.

Your business logic, auth and database still run — you only override the fields you care
about (`status: "PENDING"` → `status: "APPROVED"`, `role: "USER"` → `role: "ADMIN"`, …).
Full stubbing is still available when you want the network out of the picture entirely.

## Architecture

```
┌──────────────────┐   chrome.storage.local   ┌───────────────────────┐
│  Side Panel      │ ───────────────────────► │  bridge.isolated.js   │
│  (React + TS)    │ ◄─── storage.onChanged ─ │  ISOLATED world       │
└──────────────────┘                          └───────────┬───────────┘
                                                          │ CustomEvent
                                                          │ (JSON string)
                                              ┌───────────▼───────────┐
                                              │ interceptor.main.js   │
                                              │ MAIN world            │
                                              │ patches fetch + XHR   │
                                              └───────────────────────┘
```

| File | World | Responsibility |
| --- | --- | --- |
| `src/panel/*` | Extension page | React UI: rule CRUD, auto-fill mappings |
| `src/background/index.ts` | Service worker | Opens the panel on toolbar click, seeds storage |
| `src/content/bridge.isolated.ts` | ISOLATED | Reads `chrome.storage`, pushes rules into the page |
| `src/content/interceptor.main.ts` | MAIN | Patches `window.fetch` and `XMLHttpRequest` |
| `src/shared/*` | Both | Rule types, URL matching, deep merge, storage helpers |

The ISOLATED bridge exists because a content script cannot patch the page's own `fetch`,
and a MAIN-world script cannot call `chrome.*`. Rules cross the boundary as a JSON string
on a `CustomEvent`, and are re-pushed on every `storage.onChanged`, so edits in the panel
apply to the next request without reloading the page.

## Rule types

| Type | Behaviour |
| --- | --- |
| `MUTATE_REQUEST` | Deep-merges the payload into the outgoing JSON body, then hits the real backend |
| `MUTATE_RESPONSE` | Calls the real backend, then deep-merges the payload into the JSON response |
| `STUB` | Never touches the network; returns the payload with the configured status code |

Deep merge replaces arrays and primitives outright and merges plain objects recursively,
so `{"user": {"role": "ADMIN"}}` overrides only `user.role` and leaves the rest of the
real response intact.

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
npm run test:e2e       # optional; needs `npm i -D playwright && npx playwright install chromium`
```

`vite build` emits the panel, and `scripts/build-scripts.mjs` bundles the service worker
and both content scripts as self-contained IIFEs — MV3 content scripts cannot be ES
modules, so they cannot go through the Rollup pipeline.

## Notes & limits

- Requires Chrome/Edge 111+ for `"world": "MAIN"` content scripts.
- Only JSON bodies are mutated; other content types pass through untouched.
- The interceptor patches `fetch` and `XMLHttpRequest`. Traffic from Service Workers,
  `sendBeacon`, WebSocket or `EventSource` is not intercepted.
- `204`/`205`/`304` responses are left alone (they must not carry a body).
- `content-length`/`content-encoding` are dropped from mutated responses since the body
  is rewritten; mutated responses carry `x-intercepted` for easy spotting.
- Rules are stored in `chrome.storage.local` and apply to every frame of every site,
  so keep them narrowly scoped.
