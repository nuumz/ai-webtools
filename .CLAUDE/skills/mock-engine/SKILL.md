---
name: mock-engine
description: The request/response mocking engine — rule types, URL matching, priority, deep merge and path edits, stories/replay/sequences, fault injection (delay, error status, network error, hang), capture/redaction/truncation, and content-addressed body storage with GC. Use when changing any of those. Skip for panel UI layout, form filling/profiles, and messaging/manifest/worker plumbing.
---

# Mock engine

Core files, all load-bearing: `src/content/interceptor.main.ts` (MAIN world, the only place
apply order exists), `src/content/bridge.isolated.ts` (ISOLATED world, the only side with
`chrome.*`), `src/shared/{types,match,merge,pathOps,story,capture,bodyStore,portable}.ts`.
Read the interceptor before changing anything — the README describes intent, the code
decides, and they disagree in the places marked **[drift]** below.

## 1. Decision pipeline for one intercepted request

`window.fetch` → `patchedFetch` in `interceptor.main.ts`, in this exact order:

| # | Step | Symbol / detail |
|---|---|---|
| 1 | Scope filter | Already done in the bridge: `readConfig` keeps only `ruleAppliesToOrigin(rule, location.origin)` rules and stories passing `originMatches(story.scopeOrigins, …)`. The interceptor never re-checks scope. |
| 2 | Arm gate | `applyConfig`: `config.armed !== true` → settings reset, `activeRules = []`, `hits.clear()`. Unarmed frames idle. |
| 3 | URL normalise | `toAbsoluteUrl(rawUrl, location.href)`, method uppercased. |
| 4 | Match | `findMatch` = `settings.enabled ? findRule(activeRules, url, method) : undefined`. The master switch kills matching, not capture. |
| 5 | Fast path | `!rule && !capture && !isStrictMiss` → `nativeFetch` untouched. |
| 6 | Capture open | `emitPending` (own batch, flushed immediately), request headers + body read. |
| 7 | Latency | `holdFor(rule)` = `delayMs + random*jitterMs`, awaited via `sleepUnlessAborted` — abort rejects with `AbortError` and closes the row as `aborted`. Applies to **every** rule type. |
| 8 | Fault | `rule.fault` before type dispatch: `status` → synthetic `Response` + `X-Intercepted: FAULT`; `network-error` → `throw new TypeError('Failed to fetch')`; `timeout` → a promise that only ever settles on the caller's `AbortSignal`. |
| 9 | STUB | `resolveStubBody`: inline `JSON.stringify(rule.payload ?? {})`, or a story body via `bodyKeyForHit` + `fetchStoredBody`. `undefined` ⇒ `rule = undefined`, i.e. degrade to a miss (never invent a body). |
| 10 | Strict miss | `!rule && isStrictMiss(url)` → 501 `X-Intercepted: STRICT`. Reached by a STUB that fell through at step 9. |
| 11 | MUTATE_REQUEST | Skipped for GET/HEAD. `mutateJsonText` = `JSON.stringify(applyOps(mergeDeep(JSON.parse(raw), rule.payload), rule.ops))`. |
| 12 | Network | `nativeFetch(request, requestInit)`; failure closes the row `network-error`/`aborted`. |
| 13 | MUTATE_RESPONSE | Only if `canRewriteBody(response)`: not 204/205/304, content-type contains `json`, declared `content-length` ≤ `MAX_MUTATE_BYTES` (5 MB). Strips `content-length`/`content-encoding`, sets `x-intercepted: MUTATE_RESPONSE`, tags `servedBy: 'mutated'`. |
| 14 | Capture close | `finish(…, 'network', 'ok')` with `durationMs` pinned at response time, then a `readCapped` clone updates the same row — only when `read.complete` (a half-read body is dropped, never stored). |

XHR (`MutatedXHR`) keeps the same order with three differences that must stay true:

| Difference | Where |
|---|---|
| MUTATE_RESPONSE is lazy — applied in the `responseText` / `response` getters via `_mutateCached`, memoised on the source text. There is **no** `canRewriteBody` equivalent, so XHR mutates regardless of content-type or size. | `MutatedXHR.responseText`, `MutatedXHR.response` |
| A `timeout` fault honours a caller-set `this.timeout` in preference to `delayMs`; `_deliverSynthetic` fires `error`/`timeout` + `loadend` with status 0. | `MutatedXHR.send`, `_deliverSynthetic` |
| A stub whose body resolves `undefined` calls `super.send(this._sendBody)` — the real request runs after the fact. `abort()` during the in-flight body lookup is checked twice (`stub.aborted`, `this._stub !== stub`). | `_deliverStub` |

## 2. Matching semantics (`src/shared/match.ts`, `compilePattern`)

| Pattern shape | Detection | Matcher | Fallback when `URLPattern` is absent |
|---|---|---|---|
| contains `://` | `isFullUrl` | `new URLPattern(trimmed)` against the absolute URL | `globToRegExp` on the whole URL |
| starts with `/` | `isPathname` | `new URLPattern({ pathname })` | `globToRegExp` against `new URL(absoluteUrl).pathname` |
| bare text with `*` | — | anchored glob on the whole URL | same (no URLPattern branch) |
| bare text, no `*` | — | `absoluteUrl.includes(trimmed)` | same |

- `globToRegExp` escapes regex metacharacters, maps `*` → `.*`, and **anchors `^…$`**. A bare
  glob is therefore a whole-URL match, not a substring one. **[drift]**
- A malformed `URLPattern` init falls through to the glob matcher; a throwing `test()` returns
  `false`. Both are silent — never let a pattern error surface to the page.
- Relative request URLs are resolved first (`toAbsoluteUrl(url, location.href)`), so patterns
  always see an absolute URL.
- Query strings are matched only when the pattern carries them (full-URL form). `matchOn:
  'path+query'` in `exchangeToEntry` is what produces such a pattern from a capture.
- `originMatches` reuses `compilePattern` against `location.origin` — origin patterns are
  full URLs without a path, so they take the `isFullUrl` branch.

## 3. Precedence invariants

| Invariant | Enforced by | Guarded by |
|---|---|---|
| Rules and story entries share one sorted list; hand-written rules come first in the input array and story entries carry `STORY_PRIORITY = -1`. | `applyConfig`: `compileRules([...rules, ...storyRules])`; `story.ts` `entryToRule` | `tests/e2e/story.e2e.mjs` "a hand-written rule beats the story" |
| Higher `priority` wins; equal priorities keep insertion order (`Array.sort` stability). Precedence is **numeric only** — there is no rule-vs-story class distinction, so `priority: -2` on a hand-written rule loses to a story entry. **[drift]** | `match.ts` `compileRules` | same test (implicitly: rule `priority ?? 0` > `-1`) |
| First match wins; inactive rules never compile. | `compileRules` filter on `isActive`, `findRule` `.find` | `tests/e2e/mutation.e2e.mjs` |
| `method: 'ANY'` matches everything; otherwise uppercase equality. | `findRule` | `mutation.e2e.mjs` |
| `scope.origins` is applied **once, in the bridge**, before the config is serialised into the frame. The engine assumes everything it holds is in scope. | `bridge.isolated.ts` `readConfig`, `match.ts` `ruleAppliesToOrigin` | `tests/e2e/extension.e2e.mjs` "an out-of-scope rule is filtered out" (the only suite running the real bridge) |
| The master switch suppresses matching and strict mode but not capture. | `findMatch`, `isStrictMiss` | `tests/e2e/capture.e2e.mjs` "master switch disables interception" |

Changing precedence means changing `compileRules` **and** re-checking `entryToRule`'s
constant; anything reading precedence out of the panel is a second source of truth.

## 4. Path edit ops (`src/shared/pathOps.ts`)

Grammar: dot-separated keys, `[n]` indices, `[*]` wildcard — `data.items[0].price`,
`items[*].inStock`. `parsePath` splits on `.`, then scans `\[([^\]]*)\]` per segment, so
`a[0][1]` is legal and empty segments are skipped.

| Op | Behaviour | Note |
|---|---|---|
| `set` | replaces the value at `path` | creates missing containers: object for a key segment, array for an index |
| `delete` | removes a key / splices an index / empties a wildcard level | non-container input is returned unchanged |
| `append` | pushes onto the array at `path`, or creates `[value]` | |
| `merge` | `mergeDeep(existing, value)` at `path` | same object-only recursion as the payload merge |
| `copy` | `getPath(input, from)` then `set` at `path` | `getPath` returns the **first** value a wildcard collects |

Non-goals, deliberate: no JSONPath filters, no recursive descent, no scripting. Everything is
synchronous because the XHR getters that call it are.

- **Immutability invariant**: `update` and `remove` rebuild each container along the path
  (`{ ...input }` / `[...input]`) and never write through. A story body is a shared cached
  string parsed per hit, so a mutating edit would poison every later replay. Proven by
  `tests/unit/pathOps.test.ts` "never mutates the input"; `applyOps` with no ops returns the
  identical reference ("is the identity without ops").
- A throwing op is swallowed per-op inside `applyOps` — one bad path must not take the
  response down. Test: "survives a path that does not resolve".
- Ops run **after** the payload merge, in array order (`applyOps` loop; test "applies ops in
  order"), and only on `MUTATE_REQUEST` / `MUTATE_RESPONSE`. **`ops` on a STUB rule are
  silently ignored** — `resolveStubBody` never calls `applyOps` — although `RuleForm` will
  happily save them. **[drift]**

## 5. Capture and redaction (`src/shared/capture.ts`)

| Concern | Symbol | Rule |
|---|---|---|
| Where masking happens | `redactBody`, `redactHeaders`, called from `snapshot`/`finish` in the MAIN world | Masking runs **in the page, before the record crosses to the ISOLATED bridge**. Nothing unmasked ever reaches a port, `chrome.storage`, the worker log or the panel — so a bug that moves redaction downstream leaks secrets even if the UI still looks right. |
| Headers | `HEADER_DENY_LIST` | `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `x-csrf-token` are dropped unconditionally, plus anything matching the user key list. |
| Bodies | `DEFAULT_REDACT_KEYS`, `matchesKey` (substring, case-insensitive) | JSON walk first; on parse failure, a urlencoded `k=v&…` pass. `REDACTED = '«redacted»'`, and `BodySnapshot.redacted` flags a hit. |
| Content-type filter | `isCapturableContentType` | json/text/xml/javascript/form-urlencoded/graphql only; an empty content-type is assumed text. Binary is reported by size alone. |
| Truncation | `truncateText`, `DEFAULT_BODY_LIMIT` (1 MB), `MIN_BODY_LIMIT` 64 KB, `MAX_BODY_LIMIT` 32 MB, `clampBodyLimit` | `makeBodySnapshot` truncates **then** redacts; `bytes` records the real size. |
| Downstream rule | `SidePanel.saveToStory` (`cut` branch), `ExchangeDetail` `stubBlocked` | A truncated body is broken JSON: it may not become a stub or a story entry. Enforced **in the panel only** — the engine will replay whatever `bodyKeys` it is handed. **[drift risk]** |
| Streaming | `readCapped`, `BODY_READ_TIMEOUT_MS` 15 s | The row closes when the page has its response; a body that never finishes updates nothing (`read.complete === false`). Guarded by `capture.e2e.mjs` `/api/dribble`. |
| Mutation size cap | `MAX_MUTATE_BYTES` 5 MB | fetch-side only, via `canRewriteBody`. |

Order matters: truncate → redact → emit. Reordering redaction after the batch leaves the cap
protecting nothing.

## 6. Stories (`src/shared/story.ts`, `src/shared/bodyStore.ts`)

- **Content-addressed bodies.** `hashBody` (SHA-1) → `putBody` writes `body:<hash>` only when
  absent; identical responses collapse. Entries carry `bodyKeys`, never text.
- **Lazy fetch + per-frame cache.** `fetchStoredBody` checks the frame's `bodyCache`, else asks
  the bridge over `BODY_REQUEST_EVENT`/`BODY_REPLY_EVENT` (`replyBody` → `getBody`) with a
  3 s `BODY_TIMEOUT_MS`; a timeout resolves `undefined` ⇒ fall through to the network.
- **Sequence folding.** `addEntry` merges an incoming capture into the existing
  method+urlPattern entry, appending `bodyKeys` unless the last key repeats — that is how
  `PENDING → RUNNING → DONE` records itself.
- **Cycle.** `bodyKeyForHit(bodyKeys, cycle, hits)`: within range serve `bodyKeys[hits]`, then
  `loop` → modulo, `stick-last` → last (the default from `exchangeToEntry`), `once` →
  `undefined`, i.e. stop intercepting. `hits` is a per-frame `Map` keyed by rule id, cleared on
  every `applyConfig`, and only incremented **after** a body actually resolves.
- **Strict mode.** Per story: `strict` + `strictPattern` (`DEFAULT_STRICT_PATTERN = '/api/*'`)
  become `PageConfig.strictPatterns`; `isStrictMiss` requires `settings.enabled`. Scoping to a
  pattern is what keeps page assets loading. Guarded by `story.e2e.mjs` "a strict story refuses
  what it does not cover" / "strict only applies inside its pattern".
- **A mock must never be recorded as real.** `SidePanel.saveToStory` skips any row with
  `meta.servedBy !== 'network'` or `outcome === 'pending'`; `servedBy` is stamped in the
  interceptor (`'stub'` for stub/story/fault/strict, `'mutated'`, `'network'`). Both halves are
  the invariant — a new served-by value must be added to the exclusion, not just the type.
- **GC on delete.** `SidePanel.deleteStory` → `removeStory` (drops `story:<id>`) →
  `collectGarbage(referencedBodyKeys(remaining))`. `collectGarbage` additionally reads
  `mutationRules` itself (`ruleBodyKeys`) so a story-backed stub that outlived its story keeps
  its body — proven by `tests/unit/bodyStore.test.ts` "keeps a body a stub rule still replays
  after its story is gone". `trimBodies` deletes oversized bodies; entries pointing at them
  fall through to the network, which is the safe direction.

## 7. Adding a rule type or edit op — checklist

Touch in this order; each skipped step fails silently, not loudly.

| # | File | What | If skipped |
|---|---|---|---|
| 1 | `src/shared/types.ts` (`RuleType`, `MutationRule`) or `src/shared/pathOps.ts` (`PathOp`) | the union member + any new field | nothing else typechecks |
| 2 | `src/shared/pathOps.ts` `applyOne` | new op case | the `switch` over `PathOp['op']` is exhaustive with no `default`, so a missing case returns `undefined` and **erases the body** rather than erroring |
| 3 | `src/content/interceptor.main.ts` | fetch branch (steps 9/11/13 above) **and** `MutatedXHR.send` + the `responseText`/`response` getters | the type works on fetch and passes through on XHR, or vice versa — the two paths are independent `if` chains, not one dispatcher |
| 4 | `src/content/interceptor.main.ts` `report` / `finish` | the `ServedBy` tag for the new type | the row is logged as `network` and becomes recordable into a story — the "never record a mock as real" invariant breaks |
| 5 | `src/panel/components/RuleForm.tsx` (`RULE_TYPES`, the `type === 'STUB'` branches) and `RuleList.tsx` | form fields + list rendering | the type cannot be created or is mislabelled; fields silently dropped on save |
| 6 | `src/shared/portable.ts` | nothing for a new rule field (rules are copied whole by `mergeById`), but a new **body-bearing** shape needs `exportState`/`importState` to walk it like `PortableStory.bodies` | export writes a file that imports as a rule referencing a body key that does not exist locally — replay silently falls through to the network |
| 7 | `src/shared/bodyStore.ts` `ruleBodyKeys` | teach it any new place body keys live | `collectGarbage` deletes bodies still in use |
| 8 | `src/shared/sync.ts` (`RULE_PREFIX` chunking) | nothing structural — whole rule objects are mirrored — but a large new field eats the 100 KB sync quota | sync starts reporting quota errors |
| 9 | Tests | `tests/unit/pathOps.test.ts` for an op; a case in `tests/e2e/mutation.e2e.mjs` or `fault.e2e.mjs` for a rule type | see §8 |

`src/panel/components/ExchangeDetail.tsx` `draft()` also branches on `type === 'STUB'` when
turning a log row into a rule; a new type that needs a preloaded payload belongs there too.

## 8. How to verify

- **Pure logic** → extend `tests/unit/pathOps.test.ts` (ops, immutability, ordering),
  `tests/unit/bodyStore.test.ts` (GC), `tests/unit/payloadCase.test.ts` (payload → case
  mapping). Run `npm run test:unit` (vitest).
- **Engine behaviour** → the e2e suites are the only real proof: `mutation.e2e.mjs` (three rule
  types × fetch/XHR, plus the v1 bare-array config shape), `story.e2e.mjs` (replay, sequences,
  `once` exhaustion, missing body, rule-beats-story, strict, and replay with the server
  killed), `fault.e2e.mjs` (delay, status/network/hang faults, path edits on both transports),
  `capture.e2e.mjs` (tagging, truncation, redaction, limits, master switch).
- **Unit tests never prove interceptor behaviour.** No unit test loads
  `interceptor.main.ts`; apply order, transport parity and header/tagging all live only in
  e2e. A green `npm run test:unit` after an interceptor change means nothing.
- **`npm run build` must precede `npm run test:e2e`.** Verified in `tests/e2e/harness.mjs`
  `openPage`, which injects `readFileSync('dist/interceptor.main.js')` (and `dist/formAgent.js`
  in `openFormPage`) — the suites drive built bundles, never `src/`, so an unbuilt change tests
  the previous build. Paths are repo-root relative: run from the repo root.
- The harness fakes the ISOLATED bridge (config push, capture sink, body lookup). Anything
  living in `bridge.isolated.ts` — origin scoping, storage-change pushes, the port, lazy body
  reads through `chrome.storage` — is covered only by `tests/e2e/extension.e2e.mjs`
  (`npm run test:ext`, needs headed Chromium: `xvfb-run -a npm run test:ext`; it self-skips
  when no extension service worker appears).
- Full ladder (typecheck → unit → build → e2e → real app): see the sibling skill
  `verify-change`.

## Siblings

- `mv3-architecture` — MAIN/ISOLATED worlds, the page bus, the worker port and arming; read it before touching how config or capture crosses a boundary.
- `form-filler` — profiles, cases, selectors and `formAgent.ts`; shares only `payloadCase.ts` with this engine.
- `panel-ui` — panel layout and components; the rule form, log list and story card are where engine changes surface to the user.
