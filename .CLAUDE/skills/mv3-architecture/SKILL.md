---
name: mv3-architecture
description: MV3 execution-context boundaries for this extension — ports, message kinds, chrome.storage keys, cross-world (MAIN/ISOLATED) handoff, manifest and rebuild rules. Use when adding or changing a message kind or port name, editing anything under src/background/ or src/content/, changing chrome.storage keys or a stored schema, editing public/manifest.json or permissions, or moving data across the MAIN/ISOLATED boundary. Skip for panel-only UI styling, pure src/shared logic with no messaging, and test-only edits.
---

# MV3 architecture boundaries

Sibling skills own their own domains — cross-reference, do not duplicate: `mock-engine` (rule
matching, merge, stub/fault semantics), `form-filler` (profiles, selectors, the agent), `panel-ui`
(React panel screens), `verify-change` (full verification detail).

## 1. The five execution contexts

| Context | Files | chrome.* it may touch | Cannot | Lifetime |
|---|---|---|---|---|
| Service worker | `src/background/index.ts`, `router.ts`, `logStore.ts`, `armedTabs.ts` | everything in `permissions` (`sidePanel`, `storage`, `scripting`, `tabs`, `action`, `commands`) | no DOM, no `window`, no page access | **killed when idle**; all module state (`logs`, `armed`, `panelPorts`, `tabUrls`, `lastSyncedHash`) is lost |
| Side panel | `src/panel/**` (React 19 doc, `index.html?tabId=<id>`) | `chrome.storage`, `chrome.runtime.connect`, `chrome.tabs`, `chrome.scripting` | cannot see page globals; one document per tab | dies when the panel closes or its tab closes |
| ISOLATED bridge | `src/content/bridge.isolated.ts` | `chrome.storage.local`, `chrome.runtime` port only | cannot patch the page's `fetch`/`XHR` (separate JS realm) | lives as long as the document; orphaned by an extension reload (`chrome.runtime?.id` falsy) |
| MAIN interceptor | `src/content/interceptor.main.ts` | **none — no `chrome.*` at all** | no storage, no ports; must ask the bridge for everything | same as the document; re-injectable |
| Injected form agent | `src/inject/formAgent.ts` via `chrome.scripting.executeScript({func})` in `src/inject/run.ts` | none at run time | **no imports, no module-scope constants** — Chrome serialises it with `Function.prototype.toString()`; type-only imports are erased and safe | one call, all frames |

**What the idle kill breaks, and how the code already compensates:**

| Loss | Compensation |
|---|---|
| Panel port drops | `useNetworkLog.ts` reconnects with backoff (`RECONNECT_BASE_MS`→`RECONNECT_MAX_MS`) and pings `{ kind: 'panel/ping' }` every `KEEPALIVE_MS` (20 s); the router's `panel/ping` case is deliberately empty — the message itself resets the idle timer |
| Page port drops | `scheduleReattach` in `bridge.isolated.ts` re-opens (500 ms → 10 s), but only while `armed` and only if `chrome.runtime?.id` still exists |
| Log lost | `logStore.ts` mirrors **metadata only** to `chrome.storage.session` under `log:<tabId>`; `restoreFromSession()` re-hydrates. Bodies are deliberately sacrificed |
| Armed/recording sets lost | `armedTabs.ts` persists to `chrome.storage.session` (`armedTabs`, `recordingTabs`); `restoreArmedTabs()` is awaited **before** handling any page message in `handlePagePort` |
| Reconnect looks like a navigation | `page/hello` carries `fresh` (`!helloSent`, true only for the first hello of a document). `handlePageMessage` calls `clearTab` + `sendLogReset` only when `fresh` — otherwise a reconnect would delete a live recording |
| Panel disconnect looks like "panel closed" | `DISARM_GRACE_MS` (2500 ms) in `router.ts` `scheduleDisarm` |

## 2. How a config edit reaches a patched `fetch`

1. `SidePanel.tsx` → `persistRules` / `persistSettings` / `persistStories` → `saveRules` etc. in `src/shared/storage.ts` → `chrome.storage.local.set({ [STORAGE_KEYS.rules]: … })`. The panel never messages the page directly.
2. `chrome.storage.onChanged` (area `local`) fires in three places: the bridge, the worker (`refreshBadge` + debounced `pushToSync`, 1500 ms), and the panel's own listener (so a second window re-renders).
3. Bridge listener filters on `STORAGE_KEYS.rules | settings | stories` or a key starting with `story:` → `schedulePush()` (`SYNC_DEBOUNCE_MS` = 50 ms) → `pushConfig()`.
4. `pushConfig` → `readConfig()`: reads rules/settings/stories, filters rules by `ruleAppliesToOrigin(rule, location.origin)` and expands active stories via `storyEntriesKey` into `storyRules` (body **keys** only, never bodies) → `toPageConfig()` blanks everything when `armed` is false.
5. It then writes `ARMED_FLAG` / `CAPTURE_FLAG` and `writeStoredConfig(payload)` (`CONFIG_STORE` in page `sessionStorage`), and if the JSON string changed, emits **both** `new CustomEvent(SYNC_EVENT, { detail: payload })` and `postBus('sync', payload)`. Finally `syncPort()` → `openPort()`.
6. MAIN interceptor's `install()` has `window.addEventListener(SYNC_EVENT, …)` **and** `onBus('sync', applyConfig)` → `applyConfig` → `compileRules([...rules, ...storyRules])` into `activeRules`, `strictPatterns.map(compilePattern)` into `strictMatchers`, `hits.clear()`.
7. The next `patchedFetch` / `MutatedXHR.open` calls `findMatch` → `findRule(activeRules, …)`.

**Boot race:** at `document_start` the interceptor first reads `readStoredConfig()` (synchronous `sessionStorage`) so the page's very first request is already covered, then emits `REQUEST_EVENT` + `postBus('request')`; the bridge answers by resetting `lastPushed` and pushing again.

## 3. Adding a new message kind — checklist

| # | File | What |
|---|---|---|
| 1 | `src/shared/messages.ts` | add the member to the right union: `PageToBg`, `PanelToBg`, `BgToPage`, `BgToPanel` |
| 2 | sender | panel: `send(port, …)` in `src/panel/hooks/useNetworkLog.ts` · page: `post()` in `src/content/bridge.isolated.ts` · worker: `sendToPanel` / `sendToPage` in `src/background/router.ts` |
| 3 | receiver | `PageToBg` → `handlePageMessage` switch · `PanelToBg` → `handlePanelPort`'s switch · `BgToPanel` → the switch in `useNetworkLog.ts` · `BgToPage` → the port listener in `bridge.isolated.ts`, which **hard-filters** `if (message.kind !== 'page/armed') return;` and must be widened |
| 4 | `src/panel/stories/chromeMock.ts` | the Storybook stand-in answers `log/subscribe`, `log/record`, `log/clear`, `log/getBody` by hand — a new panel message is dead in Storybook until added here |
| 5 | new port name | both `PORT_PAGE` / `PORT_PANEL` constants and the `onConnect` dispatch in `initRouter` |

**The compiler will not catch a missed case.** No switch in this repo has a `default:` with an
`assertNever(x: never)`, and `noFallthroughCasesInSwitch` in `tsconfig.json` only catches
fallthrough. A new kind type-checks clean and is silently dropped at run time. Either add the case
in the same commit, or add the `default: { const _never: never = message; }` guard yourself while
you are in the file. Note all port payloads are cast (`raw as PanelToBg`) — there is no validation.

## 4. Storage

| Key | Constant | Area | Written by | Read by |
|---|---|---|---|---|
| `mutationRules` | `STORAGE_KEYS.rules` | local **+ sync** as `rule:<id>` | panel `saveRules`, `pullFromSync` | bridge `readConfig`, `refreshBadge`, `ruleBodyKeys` |
| `settings` | `STORAGE_KEYS.settings` | local **+ sync** as `settings` | panel `saveSettings`, `recordStatus` | everywhere, always via `normalizeSettings` |
| `formProfiles` | `STORAGE_KEYS.profiles` | local **+ sync** as `profile:<id>` | panel, `pullFromSync` | `loadProfiles`, shortcut fill |
| `formFillFields` | `STORAGE_KEYS.formFill` | local (legacy) | seeded in `onInstalled` | `loadProfiles` migrates it once |
| `stories`, `story:<id>` | `STORAGE_KEYS.stories`, `storyEntriesKey` | local only | panel | bridge `readConfig` |
| `formCases`, `counters` | `STORAGE_KEYS.cases`, `.counters` | local only | panel, `fillActiveForm` | panel, worker |
| `body:<sha1>` | `bodyStorageKey` | local only | `putBody` | `getBody` (bridge, serving `bodyReq`); GC via `collectGarbage` / `trimBodies` |
| `syncMirroredKeys` | `MIRROR_KEY` in `sync.ts` | local only | `saveMirrored` | `loadMirrored` — deliberately outside `STORAGE_KEYS` so it never travels in an export |
| `armedTabs`, `recordingTabs` | `armedTabs.ts` | **session** | `persist()` | `restoreArmedTabs` |
| `log:<tabId>` | `SESSION_PREFIX` in `logStore.ts` | **session** | `scheduleMirror` | `restoreFromSession` |
| `__DEV_TOOL_CONFIG__`, `__DEV_TOOL_ARMED__`, `__DEV_TOOL_CAPTURE__` | `CONFIG_STORE`, `ARMED_FLAG`, `CAPTURE_FLAG` | **page `sessionStorage`**, not chrome.storage | bridge | interceptor + bridge at `document_start` |

Rules: `chrome.storage.local` is the single source of truth — every `onChanged` listener in the
extension is `area === 'local'` only. Sync is a mirror: `pullFromSync` writes into local and
everything re-hydrates through its existing local listener. `chrome.storage.session` is
optional-chained everywhere (`chrome.storage.session?.get`) — never assume it exists.

**Size limits that bite.** `chrome.storage.sync` allows ~100 KB total and 8192 bytes per item;
`sync.ts` guards with `MAX_ITEM_BYTES = 7800`, chunks one item per record (`chunkRecords`), skips
oversized records by name and surfaces them in `settings.syncStatus`. `pruneOrigins` caps
`lastProfileByOrigin` at `MAX_REMEMBERED_ORIGINS` (50) so one item cannot grow without bound.
Stories, cases and bodies are local-only for exactly this reason. `unlimitedStorage` in the
manifest raises the **local** ceiling only — it does nothing for sync. Per-tab log caps live in
`logStore.ts`: `MAX_ENTRIES_PER_TAB` 500, `MAX_BYTES_PER_TAB` 16 MB (bodies evicted first, the
newest body never dropped).

**Schema changes — the risk.** There is no version field on stored data and no migration runner.
The only migration that exists is `loadProfiles()` folding legacy `formFillFields` into
`formProfiles` via `migrateFormFillFields`, plus `normalizeSettings` back-filling defaults on every
`Settings` read. `PageConfig.version` (`2 | 3`) versions the config **pushed into the page**, not
storage. Every other reader does `Array.isArray(x)` and casts. So: adding an **optional** field to
`MutationRule` / `StoryEntry` / `FormProfile` / `FormCase` is safe; renaming, removing or changing
the type of an existing field silently corrupts installed data. If you must, write the migration
in the loader in `src/shared/storage.ts` (the `loadProfiles` shape is the precedent) and make it
idempotent — it runs on every read.

## 5. Manifest changes and rebuilds

`public/manifest.json` is the source. `dist/manifest.json` is a build output: Vite's default
`publicDir` copies `public/*` verbatim into `outDir` during `npm run build:panel`. Nothing
generates or rewrites it — an edit there is only a copy away from `dist/`. `dist/` is gitignored,
so a fresh clone has no extension to load until `npm run build`.

`vite.config.ts` sets `emptyOutDir: true`, so `vite build` **wipes** the esbuild outputs. That is
why `package.json`'s `build` is ordered `typecheck && build:panel && build:scripts` — never run
`build:panel` alone after `watch:scripts`.

| Changed | Run | Then |
|---|---|---|
| `src/panel/**` | `build:panel` + `build:scripts` | close and reopen the panel |
| `src/content/**` or `src/shared/**` reached from them | `build:scripts` | reload the extension **and** reload the page — orphaned scripts do not re-attach; `armOpenedTab` → `reviveTab` re-injects on the next panel open |
| `src/background/**` | `build:scripts` | reload the extension (restarts the worker; session state survives, module state does not) |
| `public/manifest.json` | `build:panel` (+ `build:scripts`, see above) | **Reload** the unpacked entry in `edge://extensions`; a newly added permission, host permission or `commands` entry may need Remove + Load unpacked to take effect |

`minimum_chrome_version` is `119`; esbuild targets `chrome111`. Content scripts declare
`world: MAIN` / `ISOLATED`, `run_at: document_start`, `all_frames: true`, `match_about_blank: true`,
`match_origin_as_fallback: true`, MAIN listed **first** — `reviveTab` injects in that same order
because the interceptor asks for config on boot and the bridge must be the one that answers.

## 6. Traps

- Content scripts and the worker must be self-contained **IIFE classic scripts** — `format: 'iife'` in `scripts/build-scripts.mjs`. Routing them through Vite/Rollup emits ESM and they stop loading.
- MAIN world has no `chrome.*`. Anything needing storage round-trips through the bridge: `BODY_REQUEST_EVENT` / `BODY_REPLY_EVENT` plus `postBus('bodyReq'|'bodyRes')`, with `BODY_TIMEOUT_MS` (3 s) as the only backstop.
- Every cross-world payload is a **JSON string**, never an object: `pageBus.ts` states `CustomEvent.detail` is stripped by some Edge builds when the event crosses worlds. Senders always emit both channels (`CustomEvent` + `postBus`); receivers register both handlers. Keep both when you add a channel.
- `postBus` uses `window.postMessage(msg, '*')` and `onBus` only checks `event.source === window` and `msg.ch === PAGE_BUS`. The page can read and forge bus traffic — never put anything secret on it.
- URLs are absolutised with `toAbsoluteUrl(raw, location.href)` in both the fetch and XHR paths before matching. Never match a rule against the raw `input`.
- Frames: `all_frames` + `match_about_blank` + `match_origin_as_fallback` mean `about:blank`, `srcdoc` and sandboxed frames each run their own interceptor and their own bridge port; `pagePorts` is a `Set<Port>` per tab, and story `hits` counts are **per frame**, not per tab.
- Double-install guards differ on purpose: `__DEV_TOOL_INTERCEPTOR_INSTALLED__` is a boolean, `__DEV_TOOL_BRIDGE_INSTALLED__` is a **function** returning whether the existing copy re-attached (false = orphaned, newcomer takes over). Do not "simplify" the bridge one to a boolean.
- `sessionStorage` flags exist because `chrome.storage` is async and the page's first fetch wins the race at `document_start`. Every access is wrapped in try/catch — opaque and sandboxed origins throw.
- `CAPTURE_FLAG` and `CAPTURE_EVENT` share the literal `'__DEV_TOOL_CAPTURE__'` (one is a sessionStorage key, one an event name). Do not merge them into one constant.
- The bridge deliberately does **not** re-gate forwarded captures on its own local flags (`forwardCapture`): those flags lag the worker's state and gating drops the first rows after a reload.
- `chrome.sidePanel.setOptions({ enabled: true })` without a `tabId` makes the panel follow every tab in the window. In `onClicked`, `setOptions` and `open` must both stay in the gesture's own task — awaiting the first spends the user gesture `open()` requires.
- Capture forwarding is rate-limited to `RATE_LIMIT_PER_SEC` (50) in the bridge; the excess becomes `capture/dropped`, not a queue. `pending` rows bypass the limit.

## 7. Verifying a change here

```
npm run typecheck                # union/type drift; will NOT catch a missing switch case
npm run test:unit                # vitest, pure src/shared only — proves nothing cross-world
npm run build                    # typecheck + vite (panel + manifest copy) + esbuild IIFE bundles
npm run test:e2e                 # rule engine / capture / story / form / fault against a page harness
xvfb-run -a npm run test:ext     # loads dist/ as a real extension: real bridge, real port, real logStore, real badge
```

`test:e2e` and `test:ext` both need `npm run build` first and Playwright installed. Unit tests
never cross a world boundary — a port, message-kind, storage-key, world or manifest change is only
proven by a built `dist/` plus `tests/e2e/extension.e2e.mjs` (`npm run test:ext`) running **headed**:
Chromium only registers extension service workers with a display, and the suite prints
`SKIP [extension] no extension service worker` and returns 0 otherwise — a green run carrying that
line proves nothing. Finish with a manual reload in `edge://extensions` and one real page. See
`verify-change` for the full procedure.
