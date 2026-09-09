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
| `src/panel/*` | Extension page | React UI: network log, rule CRUD, form profiles |
| `src/inject/formAgent.ts` | Injected into the page | Fills, records and picks fields across frames and shadow roots |
| `src/background/index.ts` | Service worker | Opens the panel, seeds storage, drives the toolbar badge |
| `src/background/router.ts` | Service worker | Port registry: page capture in, panel updates out |
| `src/background/logStore.ts` | Service worker | Per-tab ring buffer of captured exchanges |
| `src/content/bridge.isolated.ts` | ISOLATED | Pushes config to the page, forwards capture, serves story bodies |
| `src/content/interceptor.main.ts` | MAIN | Patches `window.fetch` and `XMLHttpRequest` |
| `src/shared/story.ts` | Everywhere | Story/entry model, replay sequencing, exchange → entry |
| `src/shared/pathOps.ts` | Everywhere | Dot-path edits to a JSON body |
| `src/shared/portable.ts` | Panel | Self-contained export/import file |
| `src/shared/sync.ts` | Worker | Mirrors settings, rules and profiles through the account |
| `src/shared/form.ts` | Everywhere | Profiles, fields, selector chains |
| `src/shared/expr.ts` | Panel / worker | The value expression language (no `eval`) |
| `src/shared/resolveProfile.ts` | Panel / worker | Dependency ordering, sequences, resolved values |
| `src/shared/bodyStore.ts` | Everywhere | Content-addressed body storage with garbage collection |
| `src/shared/*` | Everywhere | Rule types, URL matching, deep merge, capture + redaction, storage |

The ISOLATED bridge exists because a content script cannot patch the page's own `fetch`,
and a MAIN-world script cannot call `chrome.*`. Config crosses that boundary as a JSON
string on a `CustomEvent` and is re-pushed on every `storage.onChanged`, so edits in the
panel apply to the next request without reloading the page.

The bridge opens a `chrome.runtime` port to the service worker **only while recording**,
which is what makes the network log work without any extra permissions: `port.sender`
carries the tab id and frame URL for free, and an idle tab holds no port open.

## The panel

Four tabs, so each one fits without scrolling: **Network** (watch traffic), **Mocks**
(stories and rules), **Fill** (form profiles) and **Settings** (backup, sync, storage).
The header carries the master switch and the current host; everything else lives in a tab.

## Network log

Press **Record** and every `fetch`/`XHR` on the active tab shows up: method, path, status,
duration and size, with a badge when the response did not come from the network —
`STORY` for a replayed recording, `STUB` for something faked outright, `MUTATED` for a
real response that was altered. Expand a row to see the request and response bodies, then
turn it into a rule with one click:

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

## Stories

A **story** is a set of real responses, captured once and replayed on demand. Press **Select** in the network log, tick the rows you want and
choose *Save to story*; the responses are stored under their own content hash. Rows that a
mock already served cannot be ticked — recording those would capture the mock as if it
were real. Activate the story and those endpoints answer from the recording — with
the backend switched off entirely, if you like.

- **Sequences come for free.** Save the same endpoint twice and the entries fold into a
  sequence, so a polling endpoint replays `PENDING → RUNNING → DONE` in order. `cycle`
  decides what happens after the last one: hold it (default), loop, or stop intercepting.
- **Bodies load lazily.** Only matchers are pushed into the page; a body is fetched from
  storage on first match and cached per frame, so a big story costs nothing until it is hit.
- **Hand-written rules always win.** Story entries carry a lower priority, so a rule you
  typed overrides the recording without editing it.
- **Strict mode** (per story) answers `501` for requests the story does not cover, instead of
  letting them reach the backend — scoped to a pattern (`/api/*` by default) so page assets
  still load. Off by default: a miss falls through to the real backend.
- Replayed traffic is tagged `STORY` in the log and skipped when saving, so a recording can
  never capture itself.

Stories and bodies live in `chrome.storage.local` (hence `unlimitedStorage`); deleting a
story garbage-collects the bodies nothing else references.

## Rule types

| Type | Behaviour |
| --- | --- |
| `MUTATE_REQUEST` | Deep-merges the payload into the outgoing JSON body, then hits the real backend |
| `MUTATE_RESPONSE` | Calls the real backend, then deep-merges the payload into the JSON response |
| `STUB` | Never touches the network; returns the payload with the configured status code |

Deep merge replaces arrays and primitives outright and merges plain objects recursively,
so `{"user": {"role": "ADMIN"}}` overrides only `user.role` and leaves the rest of the
real response intact.

### Editing single fields

A payload merge cannot change one array element, delete a key, or push onto a list. Rules
take an optional list of **edits**, applied after the merge:

```json
[
  { "op": "set",    "path": "data.items[0].price", "value": 0 },
  { "op": "set",    "path": "data.items[*].inStock", "value": false },
  { "op": "delete", "path": "data.total" },
  { "op": "append", "path": "data.items", "value": { "sku": "c" } },
  { "op": "merge",  "path": "data.items[1]", "value": { "note": "sale" } },
  { "op": "copy",   "from": "status", "path": "data.echo" }
]
```

Paths are dot-separated with `[n]` indices and a `[*]` wildcard — deliberately not full
JSONPath, whose filters and script expressions would be a parser project for edits nobody
writes. Edits never mutate the original body, so a replayed story stays intact.

### Simulating failure

The states an app only reaches when the backend misbehaves, all per rule:

| Setting | Effect |
| --- | --- |
| **delay** (+ optional jitter) | Holds the response back, so you can actually look at a loading state |
| **error status** | Replaces the response with the status and body you choose — on any rule type |
| **network error** | `fetch` rejects with `TypeError: Failed to fetch`; XHR fires `error` with status 0 |
| **never answers** | The request hangs — but still rejects with `AbortError` when the caller's `AbortController` fires, so timeout handling is exercised rather than broken |

A story can also **replay the latency it was recorded with**, per story, since each entry
remembers how long the real backend took. Rules also accept an optional `priority` (higher wins; equal
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

## Form profiles

A **profile** is a named set of fields that knows how to find each input and how to
produce its value. *Fill form* writes them all in one go — across iframes and open shadow
roots — and reports anything it could not find instead of failing silently.

**Values** come in four flavours:

| Kind | Example | Use |
| --- | --- | --- |
| Text | `tester@dev.local` | a constant |
| Template | `qa+{{seq('user')}}@dev.local` | text with computed holes |
| Same as | `password` | mirror another field (confirm-password) |
| Formula | `qty * price` | derive from other fields |

Templates and formulas share one small expression language: arithmetic, comparisons,
ternaries and a fixed function list (`round sum upper lower trim pad len now randInt
randPick uuid seq`). It is a hand-written parser, never `eval`, and it runs in the panel —
only finished strings reach the page. Fields are ordered by their dependencies, so a
formula can sit above the values it reads; a circular reference is reported, not looped.
`seq('name')` draws **once per fill**, so every field referencing it agrees, and the
counter continues on the next run — which is what makes repeat signups with unique emails
work.

**Finding the input**: each field holds a list of selectors tried in order — `testid`,
`id`, `name`, `label` text, `aria`, `placeholder`, `css` — and the first one that matches
exactly one visible, enabled element wins. Add fallbacks for inputs whose id changes
between renders.

You do not have to type any of that:

- **◎ Pick** highlights elements as you move over the page; click one and its selector
  chain (plus its current value) lands in the profile. Works inside iframes and open
  shadow roots; Esc cancels. Picking from a field's own row replaces just that field's
  selectors.
- **⤓ Record** reads every filled-in field on the page and offers them as a checklist —
  fill a form by hand once, then keep the fields you want. Passwords are left out unless
  you tick *include passwords*.
- **`Alt+Shift+F`** fills without opening the panel at all. It uses the profile you last
  filled with on that origin, else one whose site scope matches, else the only profile you
  have; the toolbar badge flashes how many fields it filled. Rebind it under
  `chrome://extensions/shortcuts`.

Values are written through the native `HTMLInputElement.prototype.value` setter followed
by `input`/`change`, so React and Vue value trackers see the change instead of reverting
it. `<select>` accepts an option's value *or* its visible text; checkboxes take
`true`/`false`; `contenteditable` works. A field can wait N ms after filling, which is how
dependent dropdowns are handled — fill the country, wait for the app to load cities, then
fill the city. A field can also be pinned to a frame whose URL contains a given string.

Filling uses `chrome.scripting.executeScript` with `allFrames`, backed by
`host_permissions`, rather than `activeTab`: the `activeTab` grant is revoked on
navigation, so the button used to go quiet as soon as you moved to the next page. The
permission prompt is unchanged, since the content scripts already match all URLs.

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
npm run test:unit      # vitest: expression language, profile resolution, profile picking
npm run test:e2e       # rule engine, capture, story, form and fault suites (headless)
npm run test:ext       # loads dist/ as a real extension; needs a display: xvfb-run -a npm run test:ext
npm run storybook      # the panel components on their own, at localhost:6006
```

`demo/index.html` is the form fixture the tests drive (iframe, shadow DOM, dependent
dropdown, contenteditable); the e2e server also serves it at `/demo` if you want to poke
at it by hand.

The e2e commands need `npm run build` first and `npm i -D playwright && npx playwright
install chromium` — Playwright is deliberately not a devDependency, so a plain install
stays lean. `vite build` emits the panel, and `scripts/build-scripts.mjs` bundles the
service worker and both content scripts as self-contained IIFEs, because MV3 content
scripts cannot be ES modules.

Every push and pull request runs the same commands in CI
(`.github/workflows/ci.yml`): typecheck, unit tests, build, a Storybook build, the
headless suites, and the loaded-extension suite under `xvfb`.

## Storybook

`npm run storybook` opens every panel component without an extension, a backend or a
browser tab — which is the only practical way to look at the states that are hard to
reach by hand: a body that was truncated and redacted, a sync run that hit the 100 KB
quota, a profile whose formulas reference each other in a circle, a story replaying a
`PENDING → DONE` sequence.

- Stories sit next to their component (`src/panel/components/*.stories.tsx`), so
  `npm run typecheck` covers them and a prop change breaks them in the same commit.
- `src/panel/stories/fixtures.ts` builds its data with the same factories the extension
  uses (`newStory`, `newProfile`, `toExchangeMeta`) and mirrors the endpoints the e2e
  harness serves, so the sample traffic matches what a real recording looks like. The
  field previews in the Fill stories come from running `resolveProfile` for real.
- `src/panel/stories/chromeMock.ts` installs a stand-in for the `chrome.*` surface the
  panel touches. Every module guards its chrome access, so this one object is enough to
  run the whole `SidePanel` — the four tab stories are the real screens, with storage,
  the log port and the injected form agent all answering.

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
- Story replay serves the recorded body verbatim; it does not re-run any backend logic, so
  a recorded response can drift from what the API would say today.
- A field's frame pattern is a plain substring of the frame URL, not a glob.
- The picker runs in every frame at once; the frame you click cancels the others through a
  `postMessage` relay, with a 60-second backstop so nothing can hang.
- Picking cannot reach into a closed shadow root — nothing outside the component can.
- While recording, every tab holds a port open, which keeps the service worker alive by
  design. Turn recording off when you are done.
- Rules are stored in `chrome.storage.local` and apply to every frame of every site
  unless you scope them, so keep patterns narrow.
