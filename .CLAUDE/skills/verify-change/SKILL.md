---
name: verify-change
description: The verification ladder for this repo — which checks a given change actually needs, the dist/ staleness trap that makes a green e2e run meaningless, e2e prerequisites, and how to read each runner's failure output. Trigger before reporting any change done, when choosing which checks a change needs, when a check fails and the failure must be read correctly, and when setting up the e2e prerequisites. Skip for pure documentation edits (README, comments, these skills).
---

# Verify a change

Nothing here is optional judgement: the commands are in `package.json` `scripts`, the CI
order is `.github/workflows/ci.yml`, and every timing below was measured on this machine
(macOS, node 22, warm `node_modules`) unless marked *estimated*.

## The ladder

| # | Command | Prereqs | Cost | Catches | Cannot catch |
|---|---|---|---|---|---|
| 1 | `npm run typecheck` (`tsc --noEmit`) | `npm ci` | **3 s** | type errors across `src`, `scripts`, `tests/unit`, `vite.config.ts`, `.storybook` (the `include` list in `tsconfig.json`); `noUnusedLocals`/`noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` import-type violations, `strict` null holes | anything at runtime; cross-world message drift (MAIN↔ISOLATED traffic is JSON strings on `CustomEvent`, not typed calls); CSS; whether `dist/` matches `src/` |
| 2 | `npm run test:unit` (`vitest run`) | `npm ci` | **1 s** (10 files, 84 tests) | pure logic in `src/shared/**` and `src/inject/run.ts` — `expr`, `pathOps`, `resolveProfile`, `form`, `formCases`, `payloadCase`, `portable`, `sync`, `bodyStore`, `frameReport` | anything needing a DOM, a page, a port or a real `chrome.*` |
| 3 | `npm run build` = `typecheck` → `build:panel` → `build:scripts` | `npm ci` | **4 s** total (`vite build` ≈ 0.6 s; esbuild ≈ 0.02 s) | bundling/resolution failures; **and it is the prerequisite for rungs 5 and 6** | runtime behaviour |
| 3a | `npm run build:panel` (`vite build`) | — | ~1 s | the React panel only → `dist/index.html`, `dist/assets/*` | the worker and content scripts |
| 3b | `npm run build:scripts` (`node scripts/build-scripts.mjs`) | — | <1 s | esbuild IIFE bundles → `dist/background.js`, `dist/interceptor.main.js`, `dist/bridge.isolated.js`, `dist/formAgent.js` (+ `.map`) | the panel. Use `npm run watch:scripts` while iterating on e2e |
| 4 | `npm run build-storybook -- --quiet` | `npm ci` | **13 s** | a story that fails to **compile or bundle**: missing export, bad import, broken CSS pipeline | it does **not render** a story and does **not run `play`**. A component that throws on render (unguarded `chrome.*`, a null deref) builds clean here — only `npm run storybook` shows it |
| 5 | `npm run test:e2e` (`node tests/e2e/run.mjs`) | `npm run build` **first**, Playwright installed | **13 s** (158 checks, 7 suites: mutation, capture, story, form, wizard, kesc, fault) | the real interceptor in a real Chromium against a local HTTP server: rule matching, mutation, capture limits, story replay, form filling, fault injection | anything only the packed extension does — the ISOLATED bridge, the runtime port, worker log storage, the badge, sync |
| 6 | `npm run test:ext` (`node tests/e2e/run-extension.mjs`) | `npm run build` **first**, Playwright, **a display** | ~45 s *estimated* (its own `waitForTimeout` calls total ≈12 s, plus a headed launch) | `dist/` loaded as a real unpacked extension: storage→page rule delivery, lazy story bodies, worker log store + `chrome.storage.session` mirror, badge `REC`, `about:srcdoc`/`about:blank` frame coverage, `tab/pages` connectivity, the sync mirror surviving an oversized item | UI polish; anything the panel renders beyond the one row-timing assertion |

CI runs 1 → 2 → 3 → 4 → install Playwright → 5 → `xvfb-run -a` 6, in that order.

## Change kind → required checks

| Change | Required | Also worth it |
|---|---|---|
| `src/shared/**` pure logic (`expr`, `pathOps`, `match`, `merge`, `resolveProfile`, `form`, `payloadCase`, `portable`, `story`) | 1 + 2 | 3 + 5 if any e2e or the interceptor consumes it (most of `shared` is bundled into `interceptor.main.js`) |
| `src/content/**` or `src/background/**` | 1 + 3 + 5 + **6** | — |
| `src/inject/**` (`formAgent.ts`, `run.ts`) | 1 + 2 + 3 + 5 (form/wizard/kesc suites drive `dist/formAgent.js`) | 6 when frame targeting or `chrome.scripting` options change |
| `src/panel/**`, UI only (markup, Tailwind, a component's own state) | 1 + 4 + eyeball in `npm run storybook` | — |
| `src/panel/**` that talks to the worker (`useNetworkLog`, message kinds, `inject/run.ts` callers) | 1 + 3 + **6** + 4 | 5 if the message shape is shared with the interceptor |
| `src/shared/messages.ts` or `src/shared/types.ts` (shared contract) | 1 + 2 + 3 + 4 + 5 + 6 — everything | — |
| `public/manifest.json` | 3 + **6** (it is the only check that loads the manifest) + a manual load-unpacked pass | — |
| `src/panel/stories/**`, `.storybook/**`, any `*.stories.tsx` | 1 + 4 | open `npm run storybook` if the story is new |
| Tests only (`tests/unit/**`) | 1 + 2 | — |
| Tests only (`tests/e2e/**`) | the suite you touched, via 5 or 6 (`dist/` must already be current) | — |
| Build scripts / config (`scripts/build-scripts.mjs`, `vite.config.ts`, `tsconfig.json`, `package.json`) | 1 + 3 + 4 + 5 | 6 if `dist/` output names or the entry set changed |
| Docs only | none | — |

## The staleness rule — read this before every e2e run

**The e2e suites never compile `src/`. They read the bundles in `dist/`.** A source change
that is not followed by `npm run build` (or a running `npm run watch:scripts`) is tested
against the previous build, and a green run proves nothing about your change.

Verified mechanism, in the runners themselves:

- `tests/e2e/harness.mjs` → `openPage()`:
  `page.addInitScript({ content: readFileSync('dist/interceptor.main.js', 'utf8') })`
  — the MAIN-world interceptor is injected as a *string read off disk*.
- `tests/e2e/harness.mjs` → `openFormPage()`:
  `page.addInitScript({ content: readFileSync('dist/formAgent.js', 'utf8') })`.
- `tests/e2e/wizard.e2e.mjs` and `kesc.e2e.mjs`: `page.addInitScript({ path: 'dist/formAgent.js' })`.
- `tests/e2e/extension.e2e.mjs`: `launchPersistentContext(profile, { headless: false, args: ['--disable-extensions-except=dist', '--load-extension=dist'] })`, and later
  `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['formAgent.js'] })`
  — the browser loads the directory, so `dist/` *is* the extension under test.

Two corollaries: those paths are relative, so **run from the repo root**; and `dist/` is
gitignored, so a fresh clone or a `git clean` has no bundles at all and every suite fails
or times out for reasons that have nothing to do with the code.

## e2e prerequisites

Playwright is deliberately **not** a devDependency (`.github/workflows/ci.yml` and
`tests/e2e/harness.mjs` both say so, so a plain install stays lean):

```bash
npm run build
npm i -D playwright && npx playwright install chromium
npm run test:e2e
```

`npm run test:ext` additionally needs a display: CI runs `xvfb-run -a npm run test:ext`;
on macOS it must run in a real logged-in session (it launches `headless: false`, which
opens visible windows). Chromium only registers extension service workers headed.

Telling "Playwright missing" from "test failed":

| Symptom | Meaning |
|---|---|
| `Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium` then the process dies with no per-check lines | `harness.mjs` → `loadChromium()` caught the failed `import('playwright')` and called `process.exit(1)`. The package is absent |
| `Executable doesn't exist at …/ms-playwright/chromium-…` | the **package** is installed but the **browser binary** is not. `loadChromium` only guards the import, not the launch — run `npx playwright install chromium` |
| `PASS`/`FAIL` lines appear, then `N check(s) failed.` | a real test failure. Read the `FAIL` lines |
| `SKIP [extension] no extension service worker — needs headed Chromium (xvfb-run)` followed by `All checks passed.` | **a false green.** `extension.e2e.mjs` returns `0` on that path, so rung 6 exits clean having asserted nothing. Never accept a `test:ext` pass that contains this line |
| `SKIP [extension] panel row timing — the tab recorded nothing` | partial skip: the capture checks above it still ran and still report |

## Reading failures

- Both e2e runners use `createChecker(suite)` from `harness.mjs`. `check(name, got, want)`
  compares `JSON.stringify` and prints
  `FAIL [suite] name → got <json> want <json>`; `assert(name, condition, detail)` prints
  `FAIL [suite] name → <detail>`. Passing checks print `PASS [suite] name`.
- `tests/e2e/run.mjs` sums `failures` across all seven suites, then prints
  `N check(s) failed.` and sets `process.exitCode = 1`; on zero it prints
  `All checks passed.` `run-extension.mjs` does the same for the one suite.
  Because it sets `exitCode` rather than calling `exit()`, later suites still run — the
  count at the end is the total, not the first failure.
- `vitest run` prints its own `Test Files`/`Tests` summary; `tsc --noEmit` prints nothing
  on success.
- **Shell trap:** `$?` after a pipeline is the *last* command's status, so
  `npm run test:e2e | rg FAIL` reports the status of `rg` and a red suite reads green.
  Always:

```bash
npm run test:e2e > /tmp/e2e.log 2>&1; rc=$?
rg -n '^FAIL|checks failed|^SKIP' /tmp/e2e.log
```

  (zsh notes for this repo: `timeout` is not available on macOS; quote `=`-leading tokens.)

## Proof of fix

A green suite proves nothing about a fix unless a check **fails without it**. Before
reporting a bug fixed: revert just the fix (keep the test), re-run the check you are
citing, and confirm it goes red. If it stays green, the check does not cover the bug — the
fix is unverified and you either add the assertion or say so. Same rule for a check you
wrote yourself: a passing new test that also passes on the old code is not evidence.

## What "done" means here

Typecheck + unit green is **not** done for anything that crosses a world boundary — panel
↔ service worker, worker ↔ ISOLATED bridge, bridge ↔ MAIN interceptor, or panel ↔ injected
form agent. There are four worlds and only rungs 5 and 6 run more than one of them.

Done means one of:

1. a `PASS` line in `test:e2e` or `test:ext` that asserts the **new** behaviour (not a
   pre-existing check that happens to still pass), **or**
2. observed in a real browser: `npm run build` → `edge://extensions` (or
   `chrome://extensions`) → Developer mode → Load unpacked → `dist/` → **Reload** on the
   card after every rebuild → click the toolbar icon on a tab to open its panel.

Reloading the extension card is part of the loop: the worker and content scripts are
cached per load, so an un-reloaded extension is the same staleness trap as an unbuilt
`dist/`.

## Triage

| Failure | Most likely cause | First thing to check |
|---|---|---|
| `tsc` error `'X' is declared but its value is never read` | `noUnusedLocals`/`noUnusedParameters` in `tsconfig.json` — a leftover import or arg after a refactor | delete it; do not `_`-prefix a local (only params) |
| `tsc` error on `import { Foo }` used only as a type | `verbatimModuleSyntax` — needs `import type` | rewrite as `import { type Foo }` or `import type` |
| Storybook build fails to resolve a module | a story importing something the bundle cannot see, or a renamed export | the failing `*.stories.tsx` import list; rung 4 log names the file |
| A story is blank / throws when opened in `npm run storybook`, but rung 4 was green | unguarded `chrome.*` (or an API missing from the stand-in) — rung 4 never renders | add the guard, or add the API to `src/panel/stories/chromeMock.ts` |
| e2e times out, or asserts an old value that you already changed | `dist/` is stale, or you ran from a subdirectory | `npm run build`, then re-run from the repo root |
| e2e fails on every suite with a launch error | Playwright package or browser binary missing | the exact error text — see the prerequisites table above |
| `test:ext` "passes" in seconds | the `no extension service worker` SKIP — no display | run under `xvfb-run -a` (Linux) or a real macOS session |
| `test:ext` fails only on the capture/log checks | the worker mirrors metadata on a 1 s debounce and the suite waits 2 s | timing in `extension.e2e.mjs`, not the log store |
| Panel builds but the extension behaves like the old code | the unpacked extension was not reloaded after `npm run build` | the Reload button on the card at `edge://extensions` |
