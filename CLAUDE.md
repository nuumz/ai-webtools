# CLAUDE.md — ai-webtools

MV3 side-panel extension for Edge/Chrome (`public/manifest.json`): watch the page's API traffic,
mutate/stub request + response bodies live, and auto-fill forms from named profiles.
React 19 + TS strict, Vite for the panel, esbuild for everything that runs in a page, vitest for
pure logic, Playwright-driven `.mjs` suites for browser behaviour, Storybook for the panel.

## Runtime worlds

Five execution contexts. Every boundary exists because of an MV3 restriction, not preference.

| World | Code | Can reach | Exists because |
| --- | --- | --- | --- |
| Extension page (side panel) | `src/panel/**`, entry `src/panel/main.tsx` via `index.html` | all `chrome.*`, DOM of itself | Per-tab UI; opened as `index.html?tabId=<id>` (`src/background/index.ts:20`) |
| Service worker | `src/background/**` → `dist/background.js` | all `chrome.*`, no DOM | Only context that knows `tabId` and outlives navigation; dies when idle |
| ISOLATED content script | `src/content/bridge.isolated.ts` | `chrome.*`, page DOM, **not** page JS objects | A content script cannot patch the page's own `fetch` |
| MAIN content script | `src/content/interceptor.main.ts` | page JS (`window.fetch`, `XMLHttpRequest`) | **Cannot call `chrome.*` at all** — needs the bridge for storage + ports |
| Injected agent | `src/inject/formAgent.ts` via `chrome.scripting.executeScript` | page DOM + shadow roots, per frame | Runs in every frame incl. cross-origin iframes (`src/inject/run.ts:1`) |

Data paths (verified in code, the README's diagram is incomplete):

- Panel → worker/bridge: `chrome.storage.local` writes + `storage.onChanged`; plus runtime ports
  `devtool.panel` / `devtool.page` (`src/shared/messages.ts:5`).
- Bridge → MAIN: the whole `PageConfig` as **one JSON string**, sent three ways for the same push
  (`src/content/bridge.isolated.ts:164`): `CustomEvent('__DEV_TOOL_SYNC_RULES__', {detail})`,
  `window.postMessage` bus (`src/shared/pageBus.ts`), and `sessionStorage['__DEV_TOOL_CONFIG__']`
  so a `document_start` interceptor has config before the first request.
- MAIN → bridge: capture batches and story-body requests, same dual event+postMessage pattern.
- Bridge → worker: port `devtool.page`; `port.sender` supplies tabId/frameId/url for free.

## Where things live

| Path | Responsibility | World |
| --- | --- | --- |
| `src/shared/types.ts` | Rule/Settings/PageConfig contract, `STORAGE_KEYS`, cross-world event names | all |
| `src/shared/messages.ts` | Port names + `PageToBg`/`PanelToBg`/`BgToPage`/`BgToPanel` unions | all |
| `src/shared/storage.ts` | Typed `chrome.storage.local` accessors + `normalizeSettings` | panel/worker/bridge |
| `src/shared/match.ts`, `merge.ts`, `pathOps.ts` | URL matching, deep merge, dot-path edits | MAIN + panel |
| `src/shared/capture.ts` | Exchange shape, redaction, body truncation (`DEFAULT_BODY_LIMIT` 1 MB) | MAIN + worker + panel |
| `src/shared/story.ts`, `bodyStore.ts` | Recorded-story model; content-addressed bodies + GC | panel/worker/bridge |
| `src/shared/expr.ts`, `resolveProfile.ts`, `form.ts`, `payloadCase.ts` | Value expression language (no `eval` — MV3 CSP), profile→values, profiles/cases | panel + worker |
| `src/shared/sync.ts`, `portable.ts` | `chrome.storage.sync` mirror; export/import file | worker / panel |
| `src/background/index.ts` | Panel enable/open, install seeding, badge, `fill-form` command | worker |
| `src/background/router.ts` | Port registry, fans capture in / panel updates out | worker |
| `src/background/logStore.ts`, `armedTabs.ts` | Per-tab ring buffer (500 entries), armed/recording sets | worker |
| `src/content/bridge.isolated.ts` | Reads storage, pushes config, rate-limits + forwards capture, serves bodies | ISOLATED |
| `src/content/interceptor.main.ts` | Patches `fetch` + `XHR`; mutate/stub/fault/delay; emits captures | MAIN |
| `src/inject/formAgent.ts` | `fill` / `record` / `screen` / `pick` commands inside a frame | injected page |
| `src/inject/run.ts` | Panel-side wrapper: `executeScript(allFrames)`, merges per-frame results | panel |
| `src/panel/**` | React UI; tabs are `network \| mocks \| fill` (`src/panel/components/TabBar.tsx:1`) | panel |
| `demo/*.html` | Fixtures served by the e2e harness (form, wizard, device iframe, kesc) | — |

## Commands

npm only. `package-lock.json` is the lockfile CI uses.

| Command | What it actually does / verifies | Prerequisites |
| --- | --- | --- |
| `npm run dev` | Vite dev server for the panel alone — no `chrome.*`, so most panel actions throw | — |
| `npm run build` | `typecheck` → `build:panel` → `build:scripts`; the only command that leaves `dist/` complete | — |
| `npm run build:panel` | `vite build` — panel + `public/` → `dist/`. **`emptyOutDir: true`, so it deletes the esbuild outputs** | — |
| `npm run build:scripts` | esbuild IIFE bundles → `dist/{background,bridge.isolated,interceptor.main,formAgent}.js` | run *after* `build:panel` |
| `npm run watch:scripts` | Same, in watch mode | — |
| `npm run typecheck` (= `npm run lint`) | `tsc --noEmit` over `src`, `scripts`, `tests/unit`, `vite.config.ts`, `.storybook` | — |
| `npm run test:unit` | vitest, no config file → picks up `tests/unit/*.test.ts` (pure logic only) | — |
| `npm run test:e2e` | 7 suites (`tests/e2e/run.mjs`) in **headless** Chromium against `dist/` | `npm run build`; playwright |
| `npm run test:ext` | Loads `dist/` as a real unpacked extension, headed | `npm run build`; playwright; a display |
| `npm run storybook` | Panel components at :6006 with a `chrome.*` stand-in | — |
| `npm run build-storybook` | Catches stories that compile but crash on render | — |

Playwright is deliberately **not** a devDependency (`tests/e2e/harness.mjs:6`):
`npm i -D playwright && npx playwright install chromium` before any e2e run. On Linux/CI
`test:ext` needs `xvfb-run -a`; on this macOS box it can use the real display.

## Verification ladder

**e2e reads the built files off disk** — `readFileSync('dist/interceptor.main.js')` and
`dist/formAgent.js` (`tests/e2e/harness.mjs:153,169`; `tests/e2e/wizard.e2e.mjs:15`;
`tests/e2e/kesc.e2e.mjs:16`), and `test:ext` loads `--load-extension=dist`
(`tests/e2e/extension.e2e.mjs:22`). **Any src change without `npm run build` is tested stale and
will pass against the old bundle.**

| Change | Run, cheapest first | Notes |
| --- | --- | --- |
| `src/shared/**` types or pure logic | `typecheck` → `test:unit` → `build` → `test:e2e` | Shared contract: every world consumes it |
| `src/content/**`, `src/inject/formAgent.ts` | `typecheck` → **`build`** → `test:e2e` | Skipping the build tests the previous bundle |
| `src/inject/run.ts` | `typecheck` → `test:unit` (`frameReport`, `formCases`) | Panel-side; not in the injected bundle |
| `src/background/**` | `typecheck` → `build` → `test:ext` | Only `test:ext` exercises worker + ports for real |
| `src/panel/**` (UI only) | `typecheck` → `build-storybook` | No e2e covers panel rendering |
| Panel↔worker message shape | `typecheck` → `build` → `test:ext` | Ports are faked in `test:e2e` |
| `public/manifest.json`, `vite.config.ts`, `scripts/build-scripts.mjs` | `build` → `test:ext` | Manifest errors only show on real load |
| `.storybook/**`, `*.stories.tsx` | `build-storybook` | |
| Docs / `demo/*.html` only | nothing, unless a suite reads that fixture | `harness.mjs` serves every `demo/*.html` |

Traps when reading results: `test:ext` prints `SKIP [extension] no extension service worker` and
**returns 0** when Chromium starts without a display — a green run that verified nothing
(`tests/e2e/extension.e2e.mjs:29`). `test:e2e` calls `process.exit(1)` with an install hint when
Playwright is missing. `tests/e2e/**` is `.mjs` and outside `tsconfig.include` — never typechecked.

## Hard rules and traps

- MV3 content scripts cannot be ES modules → `scripts/build-scripts.mjs` bundles them as IIFE; never
  add a content script to the Vite build.
- MAIN world cannot touch `chrome.*`; ISOLATED cannot patch page `fetch`. Anything crossing goes
  through `src/shared/pageBus.ts` + the event names in `src/shared/types.ts:110-125` as JSON strings.
- `src/inject/formAgent.ts` is serialized with `Function.prototype.toString()`. It must stay
  self-contained: no value imports, no module-scope constants — **type-only imports only**.
- `build:panel` alone wipes `dist/*.js` from esbuild (`emptyOutDir: true`). Use `npm run build`.
- Storage keys: `STORAGE_KEYS` in `src/shared/types.ts:97` (`mutationRules`, `formFillFields`,
  `settings`, `stories`, `formProfiles`, `formCases`, `counters`). Derived/local-only keys:
  `story:<id>` (`storyEntriesKey`), `body:<sha1-hex>` (`src/shared/bodyStore.ts:8`), `syncMirroredKeys`
  (`src/shared/sync.ts:102`). `chrome.storage.session`: `armedTabs`, `recordingTabs`, `log:<tabId>`.
  `chrome.storage.sync` mirror only: `settings`, `rule:<id>`, `profile:<id>` — `local` stays the SOT.
- Frame-level idempotence flags — `__DEV_TOOL_INTERCEPTOR_INSTALLED__`, `__DEV_TOOL_BRIDGE_INSTALLED__`
  — exist because the worker re-injects; double install doubles every capture.
- Session flags `__DEV_TOOL_ARMED__` / `__DEV_TOOL_CAPTURE__` are read synchronously at
  `document_start` because `chrome.storage` is async and the page's first fetch wins that race.
- Interception is armed **per tab** (the tab that opened the panel). An unarmed config sets
  `enabled:false` and empties the rule list — global settings alone never intercept.
- tsconfig strictness that bites: `noUnusedLocals` / `noUnusedParameters` (an unused import or
  `catch (e)` fails the build), `verbatimModuleSyntax` (type imports must say `type`),
  `isolatedModules`, `allowImportingTsExtensions`, `types: ["chrome","vite/client"]` — there is no
  `@types/node`, so a `.ts` file under `src/` cannot use Node globals or `node:` imports.
- **Inconsistency to confirm, do not "fix" blindly**: esbuild targets `chrome111`
  (`scripts/build-scripts.mjs`) while the manifest declares `minimum_chrome_version: "119"`. The
  esbuild target only controls syntax down-levelling, not API availability, so nothing breaks today —
  but the two numbers disagree about the floor and nothing in-repo explains 119.
- `pnpm-lock.yaml` and `pnpm-workspace.yaml` exist but are stale/unused — use **npm**; CI runs `npm ci`.
- No ESLint, no Prettier. `npm run lint` is `tsc --noEmit`. Never run or propose prettier.
- `dist/` and `storybook-static/` are gitignored build output.

## Code style (as written here)

- 2-space indent, semicolons, single quotes, trailing commas, ~100-col soft wrap (p99 = 103).
- `src/shared/**`, `src/background/**`, `src/content/**`: **named exports only**. Panel components:
  `export default function Name({...}: Props)` with a file-local `interface Props`.
- `function` declarations for exported pure helpers; `const fn = (): T =>` for module-local helpers.
- Object shapes are `interface`; variants are discriminated unions keyed on `kind`
  (`AgentResult`, `PageToBg`, `PathOp`). Add a variant, then fix the exhaustive switches.
- Comments are dense and explain **why** — a block comment above a decision, not `@param` JSDoc.
  Keep that register: a non-obvious guard without a reason comment will look wrong to the next reader.
- Errors never cross a world boundary: `try { … } catch { return <safe fallback> }`, or
  `console.error('[DevTool] …' / '[Bridge] …' / '[Interceptor] …', err)`. Fire-and-forget promises
  are marked `void`.
- In panel-reachable modules, `chrome.*` entry points are guarded
  (`typeof chrome !== 'undefined' && !!chrome.storage?.local` in `src/shared/storage.ts:13`,
  `src/panel/SidePanel.tsx:110`, `src/panel/hooks/useNetworkLog.ts:80`) so they import cleanly under
  vitest and Storybook. `src/inject/run.ts` is the deliberate exception — hence the Storybook mock.
- Tailwind v4 with semantic tokens from `src/panel/index.css` (`bg-canvas`, `text-ink`, `text-faint`,
  `border-line`, `text-bad`…). Never hard-code a hex or a raw Tailwind palette colour — both schemes
  are driven by CSS vars.

## Testing policy

- `tests/unit/**` (vitest): pure, chrome-free logic — `src/shared/*` plus `src/inject/run.ts`
  result-merging (`frameReport.test.ts`, `formCases.test.ts`). Covered today: expr, pathOps, form,
  formCases, payloadCase, portable, resolveProfile, sync, bodyStore.
- `tests/e2e/**` (plain `.mjs` + Playwright): real browser behaviour through the **built** bundles.
  `harness.mjs` provides the fixture server, a fake ISOLATED bridge, and the `check/assert` reporter;
  `extension.e2e.mjs` is the only suite that loads the real extension.
- Add a unit test for: matching/merging/path-op rules, expression evaluation, profile resolution,
  sync chunking/merging, import/export migration — anything with branches worth naming.
- Do **not** add tests for plumbing: new props, new message pass-through, wiring a component into a
  tab, renamed exports. Verify those with `build` + the relevant e2e suite instead.
- New e2e assertions go into the existing suite for that behaviour and its `demo/*.html` fixture;
  a new suite must be registered in `tests/e2e/run.mjs`.

## Continuity / resuming work

1. `git status --short` and `git diff --stat` first — this tree usually has in-flight work
   (recent rounds: `src/inject/formAgent.ts` + `tests/e2e/{kesc,wizard}.e2e.mjs` + `demo/kesc.html`
   moving together, i.e. an agent behaviour change with its fixture and suite).
2. Delta gate before re-analysing: compare against the marker recorded last time (SHA / `diff --stat`).
   Unchanged → say so and ask; changed → scope work to the delta.
3. `dist/` may be stale relative to `src/`. Before trusting any e2e result, rebuild.
4. Local skills live in `.claude/skills/`. Load the matching one **before** the first edit in its area:

| Skill | Load when |
| --- | --- |
| `mv3-architecture` | Cross-world changes, ports/messages, storage schema, manifest, worker lifecycle |
| `mock-engine` | Rules, stories, `pathOps`, `expr`, matching, capture/replay behaviour |
| `form-filler` | `formAgent`, selector chains, profiles/cases, frames and shadow DOM |
| `panel-ui` | React panel components, hooks, Storybook stories |
| `verify-change` | Choosing which checks to run and reading their failures |
