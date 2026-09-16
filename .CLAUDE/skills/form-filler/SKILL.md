---
name: form-filler
description: Cross-frame form auto-filler — selector chains, picker/recorder, profiles & cases, the value-expression language, fill reporting. Use when editing src/inject/**, src/shared/{form,expr,resolveProfile}.ts, the Fill tab (ProfilesCard/RecordedFieldsDialog), demo/*.html fixtures, or tests/{unit,e2e} for any of those. Skip for API mocking rules/mutation/stories/capture, background-worker messaging and manifest plumbing, and panel styling.
---

# Form filler

Second half of the extension: write a named set of values into a live page, across frames and
open shadow roots, and report honestly what did not land. Everything below is from the code.

## 1. How a fill runs, end to end

| Step | Where | Runs |
| --- | --- | --- |
| Fold the active case into the profile | `SidePanel.tsx` `fillForm` → `applyCase` (`shared/form.ts`) | once |
| Resolve every value to a string | `resolveProfile` (`shared/resolveProfile.ts`) | once, **in the panel** |
| Abort on a resolve error | `fillForm`: `resolved.errors[0]` → toast, no injection | once |
| Inject into every frame | `run.ts` `execute` → `chrome.scripting.executeScript({ allFrames: true, func: formAgent, args: [command] })` | once |
| Run the agent | `formAgent` (`inject/formAgent.ts`) → `run(command)` inside a try/catch | **per frame** |
| Loop fields **sequentially** | `formAgent` `command.kind === 'fill'` loop | per frame |
| Per field: frame pin → resolve → write → read back | `resolveWhenReady` → `setValue` → `kept` | per frame, per field |
| Aggregate | `run.ts` `runFill` + `reportOf` | once |
| Persist counters, toast the summary | `fillForm` → `saveCounters` | once |

`AgentResult` has an `error` variant on purpose: a frame that threw would otherwise return
`undefined`, byte-identical to a frame with nothing to say.

**Why the aggregate shape matters.** Every frame is sent every field, so a field living in exactly
one frame is "not here" in all the others. `runFill` therefore unions `filled` across frames, keys
`skipped`/`rejected` by field key, drops any that a *different* frame filled, and computes `misses`
from the **input** list: only a key no frame filled and no frame explained. `misses` = broken
selector; `skipped` = present but hidden/disabled; `rejected` = written and thrown away — folding
them together makes a working profile look broken. `reportOf` adds `frames`/`answered`/`errors`/`urls`,
and `explainEmpty` turns "nothing came back" into one of three distinguishable causes (agent threw /
only the top frame ran / read N frames and found nothing). `tests/unit/frameReport.test.ts`
(untracked WIP) pins exactly those three branches, on a device-simulator shape.

## 2. Selector chain resolution

`candidates(selector)` turns one selector into elements; `resolveField(selectors, anchor, value)`
walks the chain in the order the field stores them. `FieldStrategy` (`shared/form.ts`) declares
the canonical order, most durable first, and `buildSelectors` emits chains in it.

| Kind | How `candidates` finds it |
| --- | --- |
| `testid` | `deepQuery('[data-testid="…"]')` (recording also reads `data-test-id`) |
| `id` / `name` / `aria` / `placeholder` | `deepQuery` on the exact attribute (`aria` = `aria-label`) |
| `css` | `deepQuery(value)` raw; a malformed selector is swallowed inside `deepQuery` and reads as no match |
| `label` | `deepQuery('label')` → `normalise`d text, exact matches beat `textMatches` (prefix/suffix) matches → `controlFor(label)`: `for=` → a wrapped control → the first control in the parent row. If that yields nothing, falls back to `captionCandidates` → `widgetForCaption`: walk forward siblings, up 3 ancestor hops, accept a segment group, then a control, then the innermost element carrying the whole box's text |

Rule: **the first selector that identifies exactly one visible, enabled element wins**
(`isUsable` = `isVisible` && not `disabled` && not `readOnly`; a segment group counts as usable
while any one of its boxes is — ticking ตลอดชีพ disables the segments, not their container).

- **0 usable, something found** → record why (`hidden` outranks `disabled`: a field on another
  wizard step is not "disabled"), keep walking the chain, end as `{kind:'skip'}`.
- **2+ usable** → try `chooseRadio` (a radio group is one field: `value` attr, then exact label,
  then loose label); otherwise `continue` — ambiguity is never a miss, a later selector may resolve it.
- **Nothing anywhere** → `{kind:'missing'}`.
- `anchor.text` narrows first via `withinAnchor`: every candidate has *some* ancestor carrying the
  text (`<body>` does), so the tightest scope wins.

## 3. Writing a value without React/Vue reverting it

`nativeSetter(element, 'value'|'checked')` takes the prototype descriptor's setter off
`HTMLInputElement`/`HTMLTextAreaElement`/`HTMLSelectElement.prototype` and binds it, then `fire`
dispatches `input` and `change` with `bubbles: true` — that is what a framework value tracker
listens for. Per element kind, in `setValue`'s order:

| Element | Rule |
| --- | --- |
| `<select>` | option by `value`, then `normalise(option.text)` equality, then `textMatches`; no match returns `'no'` → a miss |
| checkbox / radio | `wantsChecked`: a radio takes the *name of the member* (`value` attr or its label text); a checkbox takes `true`/`1`/`yes`/`on`. A real `element.click()` first — setting `.checked` alone leaves app state untouched — native setter only as fallback |
| `<input>` / `<textarea>` | native setter + `input`,`change` |
| contenteditable | `focus()`, `textContent = value`, `input`,`change` |
| segmented field (`segmentsOf`: ≥2 visible inputs with no `name`/`id`) | split the value on `/[^0-9A-Za-z]+/` and write part-per-box, skipping disabled boxes; `readValue` joins them with `/` |
| control-less widget | `openAndPick`: snapshot `visibleNow()`, click the trigger, poll ≤1500 ms in 60 ms steps for newly-visible text matching the wanted value, click the innermost match. Nothing appeared at all → `'shut'` → reported `skipped:disabled` (a read-only dropdown). Appeared but no match → `closeOverlay` (Esc → backdrop → trigger) then a miss |

**Dates are strings.** `31/12/2530` goes into the segments character-for-character; there is no
BE↔CE conversion anywhere in the codebase. Do not add one inside the agent — see §6.

`kept(element, wanted)` re-reads afterwards and decides `filled` vs `rejected`: exact, then the
select's `selectedOptions[0]`, then checkbox state, then a `bare()` comparison ignoring
non-letter/digit characters (masks legitimately reformat), then — control-less widgets only —
`includes`, since such a widget paints its own furniture beside the value. `after` then applies
`blur` (+ `blur`/`focusout`), `click`, `waitMs`. `waitFor` is handled *before* the write by
`resolveWhenReady` (re-resolve every 100 ms until `timeoutMs ?? 3000`); `isReady` means anything
only for a `<select>` (`minOptions`, `optionText`).

## 4. Frames and shadow DOM

- The agent **never traverses into an iframe**. `executeScript({ allFrames: true })` runs a separate
  copy per frame (`run.ts` `execute`); frames that cannot be injected (`about:blank`, sandboxed) map
  to `undefined`. The content scripts declare `all_frames`, `match_about_blank` and
  `match_origin_as_fallback` in `public/manifest.json`, which is what reaches `srcdoc`/`about:blank`
  children; `host_permissions` rather than `activeTab`, which is revoked on navigation.
- `deepQuery` visits `document` then recurses into every element's `shadowRoot` — **open roots only**.
  A closed root is invisible to fill, record and pick alike; the picker's own overlay uses
  `attachShadow({ mode: 'closed' })` precisely so it cannot pick or record itself.
- **`framePattern` is a plain substring, not a glob**: `if (field.framePattern && !location.href.includes(field.framePattern)) continue;`
  in the fill loop. The agent cannot import `compilePattern` (`shared/match.ts`) — that matcher is
  used only for `siteScope` in `pickProfileForUrl`. Writing `*.html` there matches nothing.
- **Picker cancel relay**: every frame arms a picker, only one gets clicked. `cancelEverywhere`
  posts `{__devToolPick:'cancel', session}` to `window.top` and `relayDown()` to each
  `window.frames[i]` with `'*'`; `onMessage` ignores a cancel whose `session !== command.sessionId`,
  or a stale broadcast from the previous pick would kill the next one the moment it opened.
  Backstop: `setTimeout(() => finish({kind:'pick', selectors:null}), 60_000)` — no frame's promise
  may hang, because `executeScript` waits on all of them. `__DEV_TOOL_PICKING__` is set only after
  the listeners attach and deleted in `finish`; the e2e suites poll on it.

## 5. The expression language

`shared/expr.ts`: hand-written `tokenize` → `Parser` → `evaluateNode`. Never `eval`/`new Function`
(blocked by the MV3 CSP anyway, and a whitelist keeps authored text from reaching the page as code).
Exact function list, `BUILT_INS` — `round sum upper lower trim pad len now randInt randPick uuid seq`;
`BUILT_IN_NAMES` is derived from it, so there is no second list to keep in step. Both name lookups
(`vars`, `BUILT_INS`) go through `hasOwnProperty` — `in` would resolve `constructor`/`toString`.

Four value kinds (`FieldSource` in `shared/form.ts`; Text/Template/Same as/Formula in
`ProfilesCard.tsx`), resolved by `resolveValue`: `literal` verbatim; `template` via `renderTemplate`
(`{{ … }}` holes, the rest literal); `ref` copies another key and throws if it is absent; `expr` via
`evaluate`, with `null` → `''`. Ordering is `sortByDependency` (Kahn) over `dependencyNames`, which
reads `identifiers` for a formula and `templateIdentifiers` for a template — so a formula may sit
above the values it reads; whatever stays cyclic is never resolved and is reported as
`Circular reference between …`.

**`seq()` draws once per fill**: `resolveProfile` builds the `ExprContext.seq` closure over a
`drawn` map, so every field reading `seq('order')` in one run sees the same number, while `counters`
advances for the next run (persisted by `fillForm`, not by `resolveProfile`). Two fields disagreeing
about the order number is an internally inconsistent form.

Pinned by unit tests — change deliberately only. `tests/unit/expr.test.ts`: precedence, string-vs-number
`+`, short-circuit/ternary, whitelist-only calls (`fetch`, `constructor`, `toString()` all throw
`ExprError`), malformed input throws instead of guessing. `tests/unit/resolveProfile.test.ts`: order
independent of field order, `ref`, seq once-per-run **and** continuation across runs, cycle reported
with `fields` empty, error attributed to the owning key, disabled/selector-less fields still resolved.

## 6. Where the code runs

Resolution happens **in the panel** and only finished strings cross into the page — verified:
`resolveProfile`'s header says so, `SidePanel.fillForm` calls it before `runFill`, and
`ResolvedFillField` (`shared/form.ts`) is commented "The only shape that crosses into the page".

So anything added to `expr.ts` / `resolveProfile.ts` **must not** touch the page: no `document`,
`window`, `location`, `chrome.*`, no network, no `async`; determinism is injected (`now`, `random`,
`counters`), which is how the tests pin it. A function like `valueOf('#total')` cannot exist here.
Conversely `formAgent.ts` is serialised with `Function.prototype.toString()`: no imports (type-only
ones are erased and safe), no module-scope constants, no closure beyond its own arguments and nested
helpers. Page-shaped logic goes in the agent; value logic goes in expr.

## 7. Adding a new selector kind / value kind / field option

| # | File | What |
| --- | --- | --- |
| 1 | `shared/form.ts` | extend `FieldStrategy` / `FieldSource` / `ProfileField` **and `ResolvedFillField`** |
| 2 | `shared/resolveProfile.ts` | `resolveValue` switch, `dependencyNames` switch, **and the field-mapping projection** at the end of `resolveProfile` |
| 3 | `shared/expr.ts` | a new function goes in `BUILT_INS` only |
| 4 | `inject/formAgent.ts` | `candidates()` for a selector kind; `setValue`/`readValue`/`kept` for an element kind; the fill loop / `resolveWhenReady` for a per-field option |
| 5 | `panel/components/ProfilesCard.tsx` | `STRATEGIES`, `SOURCE_KINDS`, `PLACEHOLDERS`, and the editor row for a new option (this is the profile field editor — `RuleForm.tsx` belongs to the mock engine) |
| 6 | `shared/portable.ts` | profiles and cases ride whole inside `StoredState`, so a new field *property* needs nothing; a shape change needs `migrateState` + `SCHEMA_VERSION` |
| 7 | `tests/unit/` + `demo/*.html` & a `tests/e2e/*.e2e.mjs` assertion | see §8, §9 |

Skipped steps fail silently, each in its own way: **(1)** type-checks, then is dropped in transit;
**(2) already broken today — the projection copies only `key`, `selectors`, `value`, `framePattern`,
`after`, so `anchor` and `waitFor`, which `ProfilesCard` lets the user set and
`resolveField`/`resolveWhenReady` consume, never reach a real fill**, and both e2e suites hand those
two straight to the agent, so nothing catches it; **(3)** an unknown name throws at evaluate time,
never at edit time; **(4)** the value resolves to a string no frame can act on — a miss;
**(5)** the kind exists but cannot be chosen, so only imported profiles carry it; **(6)** a
colleague's export loses it without a word; **(7)** invisible until someone uses it by hand.

## 8. Fixtures — what each one is designed to break

| File | Designed to break |
| --- | --- |
| `demo/index.html` | the baseline chain: testid/id/name/label, an **open shadow root** (`fancy-input`), an **iframe** (`/demo/frame.html`), a **dependent select** (country → cities 100 ms later), **contenteditable** `#notes`, and `window.__events` as the witness that `input`/`change` really fired |
| `demo/frame.html` | the child frame a `framePattern` pins to |
| `demo/wizard.html` | one URL with **every step in the DOM at once** (`hidden`); Thai labels carrying a `*` marker span; the same label in a Thai and an English block (`data-section` → anchors); a segmented **BE date**; `#lifetime` disabling its siblings; `#fundAccount` populated 1200 ms after the step paints; readonly summary rows that are not fields; a radio group; a **mask** on `#docNumber` that discards letters → `rejected` |
| `demo/device.html` | the wizard inside a **device-simulator iframe**, same-origin and (`?cross=1`) cross-origin, under a CSS `transform: scale(.82)`; the tab's own frame must score 0 |
| `demo/kesc.html` | the bank's component kit: a **caption as a preceding sibling div**, not a `<label for>`; a **dropdown with no form control** whose options exist only inside a modal; a read-only dropdown that swallows the click; a **date in three unnamed inputs**; ตลอดชีพ disabling the expiry segments |

Rule: a new hard case gets a **fixture plus an e2e assertion**, not a mock-only unit test. Every DOM
rule above was discovered against real markup; a hand-built DOM would have agreed with the bug.
Reserve `tests/unit/` for `expr` / `resolveProfile` / `form` / `run.ts` logic.

**Currently under active work** (uncommitted): the picker's gesture handling in `formAgent.ts` — it
settles on `pointerdown`/`mousedown` rather than `click`, swallows the trailing `mouseup`/`click`,
and reports a throw as an `error` result — with a matching `#volatileBox` in `demo/kesc.html` that
replaces its input mid-gesture, and new picker assertions in `tests/e2e/kesc.e2e.mjs`. Expect churn
in the picker branch, the KESC fixture and that suite; re-read before editing there.

## 9. How to verify

| Change | Command |
| --- | --- |
| `expr.ts`, `resolveProfile.ts`, `form.ts`, pure helpers in `run.ts` (`pickScreen`, `explainEmpty`) | `npm run test:unit` (vitest) |
| Anything in `src/inject/**`, or a fixture | `npm run build` **then** `npm run test:e2e` |

The suites drive the **built** agent, not the source — verified: `scripts/build-scripts.mjs` declares
a `formAgent` entry point whose comment says it exists so the e2e suite can drive the same agent;
`harness.mjs` `openFormPage` injects `dist/formAgent.js` via `addInitScript`, and `wizard.e2e.mjs` /
`kesc.e2e.mjs` do the same with `{ path: 'dist/formAgent.js' }`; the bottom of `formAgent.ts`
self-registers `window.__DEV_TOOL_FORM_AGENT__`, which is what the suites call. So **editing
`formAgent.ts` and running `test:e2e` without rebuilding tests the previous agent** — a green run
then proves nothing. Playwright is deliberately not a devDependency:
`npm i -D playwright && npx playwright install chromium` first.

For the full ladder — what to run when, and what "done" requires beyond green — use the sibling
skill `verify-change` rather than the two rows above.

## Siblings

- `mv3-architecture` — manifest, worker, content scripts, panel/page messaging: how `executeScript` and the frame permissions above are actually wired.
- `mock-engine` — mutation rules, capture and stories; `RuleForm.tsx`, `shared/match.ts`, `shared/pathOps.ts`. Shares `compilePattern` and `portable.ts` with this half, nothing else.
- `panel-ui` — the React side panel, Tailwind conventions and Storybook; the presentation of `ProfilesCard` / `RecordedFieldsDialog`, not their data contracts.
