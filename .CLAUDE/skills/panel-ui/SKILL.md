---
name: panel-ui
description: Conventions for the MV3 side-panel React UI — shell/tab structure, where state lives, the chrome.* guard rule, Tailwind 4 tokens, and colocated Storybook stories. Trigger when editing src/panel/**, adding or changing a panel component, its *.stories.tsx, Tailwind styling, panel state or hooks, or src/panel/stories/chromeMock.ts. Skip for content scripts and the service worker (src/content/**, src/background/**), the mocking/rule engine, and form-agent internals (src/inject/formAgent.ts).
---

# Panel UI

The side panel is the only React surface in the extension. `vite.config.ts` says it plainly:
"Only the Side Panel (React app) is built by Vite" — everything else is esbuild IIFE.

## Shell and tabs

`src/panel/main.tsx` mounts `SidePanel` into `#root` under `StrictMode` and imports
`./index.css`. `SidePanel.tsx` is the whole shell: header toolbar, `TabBar`, one `<main>`
that renders exactly one tab body, plus two overlays.

| Surface | Rendered by | Guard in `SidePanel` |
|---|---|---|
| Header toolbar | `ConnectionDot` + host label + Intercepting/Passthrough button + `IconSettings` | always |
| Tab strip | `components/TabBar.tsx`, `TabId = 'network' \| 'mocks' \| 'fill'` | always |
| Network | `components/NetworkLogCard.tsx` (opens `ExchangeDetail` inline) | `tab === 'network'` |
| Mocks | `RuleList` or `StoriesCard`, switched by `mockView: 'rules' \| 'stories'`; `RuleForm` replaces both when `ruleFormOpen` | `tab === 'mocks'` |
| Fill | `components/ProfilesCard.tsx` | `tab === 'fill'` |
| Settings | `components/SettingsCard.tsx` — a **sheet over the tabs**, not a fourth tab | `settingsOpen` |
| Recorded fields | `components/RecordedFieldsDialog.tsx` — `absolute inset-0` dialog | `recorded !== null` |
| Toast | inline `role="status"` node, `showToast(node, ms)`; the value is a `ReactNode`, so a toast may be JSX (`FillSummary`) | `toast` |

## Where state lives

| Kind | Owner | Notes |
|---|---|---|
| View state — `tab`, `mockView`, `settingsOpen`, `ruleFormOpen`, `editing`, `draft`, `toast`, `recorded`, `includeSecrets`, `screenBusy`, `storageBusy` | `useState` in `SidePanel` | never persisted |
| Selection — `profileId`, `caseId` | `useState` in `SidePanel` | derived views `activeProfile`, `profileCases`, `activeCase` |
| Domain data — rules, profiles, cases, stories, settings, counters | `chrome.storage.local` via `src/shared/storage.ts` (`loadRules`/`saveRules`, `loadProfiles`, `loadCases`, `loadStories`, `loadSettings`, `loadCounters`, `loadStoryEntries`/`saveStoryEntries`, `removeStory`, `normalizeSettings`) | mirrored into state by the `persist*` callbacks: `setX(next)` **and** `void saveX(next)` in one function. Never call `saveX` without the matching `setX` |
| Cross-window echo | `chrome.storage.onChanged` effect in `SidePanel` | re-hydrates rules/profiles/settings/stories/cases when another window or an import writes |
| Live traffic + tab identity | `hooks/useNetworkLog.ts` → one `chrome.runtime.Port` named `PORT_PANEL` | owns `connected`, `pinned`, `tabClosed`, `recording`, `pageConnected`, `entries`, `dropped`, `bodies`, and the `loadBody`/`fetchBody`/`clear`/`setRecording` actions. Reconnects itself with backoff and a 20 s keepalive because the worker is torn down when idle |
| Body blobs | `src/shared/bodyStore.ts` (`putBody`, `trimBodies`, `collectGarbage`, `usageBytes`) | content-addressed; the panel only holds byte counts |

New panel state goes in exactly one of those three places. If it must survive a panel
close, it belongs in `src/shared/storage.ts` with a key in `STORAGE_KEYS`, not in a new
ad-hoc `chrome.storage` call inside a component.

## The chrome-access guard rule (hard)

Every module under `src/panel/**` must (a) never touch `chrome` at import time and
(b) guard each call site. The two real examples:

- `SidePanel.tsx`: `if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;`
- `useNetworkLog.ts`: `if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;`

Why: `.storybook/preview.tsx` calls `installChromeMock()` at module scope — *not* from a
decorator — and that stand-in (`src/panel/stories/chromeMock.ts`) implements only the
slice the panel actually uses: `storage.local` (`get`/`set`/`remove`/`getBytesInUse`),
`storage.sync`, `storage.onChanged`, `runtime.connect`, `tabs.query`/`get`/`reload`,
`windows.getCurrent`, `scripting.executeScript`, `commands.onCommand`.

`src/inject/run.ts` is the documented exception: it calls `chrome.tabs`/`chrome.scripting`
unguarded, which is exactly why the mock has to exist at all.

What breaks if a new component reads `chrome.*` unguarded or at import time: the story
throws when it renders in `npm run storybook`. **`npm run build-storybook` will not catch
it** — that command only bundles; it never renders a story or runs a `play`. So a new
chrome-touching component must be opened in the dev Storybook once, and any new API
surface must be added to `chromeMock.ts` in the same commit.

## Component conventions

- One default-exported function component per file in `src/panel/components/`, named after
  the file: `export default function TabBar({ active, tabs, onSelect }: Props)`. Props are a
  **local, non-exported `interface Props`** in all nine components; only types other modules
  need are exported (`TabId` from `TabBar.tsx`, `RuleDraft` from `RuleForm.tsx`).
- Private sub-components live in the same file with inline prop types (`ServedByChip`,
  `BodyBlock`, `Section`, `ScreenStatus`, `ScreenEditor`, `FillSummary`, `ConnectionDot`).
- Domain types come from `src/shared/**`, never redeclared: `MutationRule`, `Settings`,
  `DEFAULT_SETTINGS`, `STORAGE_KEYS`, `storyEntriesKey` from `shared/types.ts`;
  `FormProfile`, `FormCase`, `ProfileField`, `ScreenSignature`, `RecordedFieldInput` from
  `shared/form.ts`; `StoryMeta` from `shared/story.ts`; `ExchangeMeta`, `BodySnapshot`,
  `CapturedExchange` from `shared/capture.ts`; `FillOutcome`, `ScreenOutcome` from
  `inject/run.ts`; `NetworkLogState`, `ExchangeBodies` from `hooks/useNetworkLog.ts`.
- Icons: `components/icons.tsx` only — `IconRecord`, `IconStop`, `IconSearch`, `IconClear`,
  `IconSettings`, `IconChevron`, `IconClose`, `IconPlus`, `IconChecklist`, `IconTarget`,
  `IconWand`. All take `{ className?: string }` and draw on a 16px grid via the shared `Svg`
  wrapper with `currentColor`. Add a glyph here rather than inlining an `<svg>`; no icon
  package, no emoji standing in for an icon.
- Formatting: `src/panel/format.ts` exports `formatClock(startedAt)`, `formatDuration(ms)`
  and `durationColor(ms)` (`text-bad`/`text-warn`/`text-mute`/`text-faint` at 3000/1000/300
  ms). Import them; do not rewrite them. Known duplication to fold in if you touch the file:
  a private `formatBytes` exists three times — `NetworkLogCard.tsx`, `ExchangeDetail.tsx`,
  `SettingsCard.tsx`.

## Tailwind 4

Wired through `@tailwindcss/vite` in `vite.config.ts`. **There is no `tailwind.config.*`
file** — verified: nothing but `vite.config.ts` configures it, and `src/panel/index.css`
starts with `@import 'tailwindcss'`. Adding a JS config would be a new mechanism, not a fix.

- Tokens live in `index.css`: `@theme inline` maps `--color-canvas`, `--surface`, `--raised`,
  `--inset`, `--line`, `--line-strong`, `--ink`, `--mute`, `--faint`, `--accent*`, `--ok*`,
  `--warn*`, `--bad*` onto runtime vars; a second `@theme` holds `--font-sans`, `--font-mono`,
  `--radius-sm/md/lg`, `--ease-out`.
- **Dark/light is automatic**: `:root { color-scheme: light dark }` plus one
  `@media (prefers-color-scheme: dark)` block re-pointing the same vars. No `dark:` variant,
  no toggle. Use `bg-canvas` / `text-ink` / `text-faint` / `border-line`, never `bg-white` or
  `text-gray-500`, or the panel breaks in one scheme.
- Repeated patterns are `@layer components` classes used as bare names: `.btn` with
  `-sm/-lg/-icon/-primary/-secondary/-ghost/-on/-live/-danger/-link`, `.field` with
  `-sm/-mono/-area/-bare`, `.chip` with `-ok/-warn/-accent/-btn/-pending`, `.toolbar`,
  `.card`, `.eyebrow`, `.note`, `.empty`, `.code-block`, `.seg`/`.seg-item`, `.log-row`,
  `.log-cell`, `.pane-grip`. Reach for one before writing new utility soup; add to the layer
  when a third component needs the same run.
- Layout idiom: root is `flex h-screen flex-col`; every card is a full-height flex column
  with `min-h-0 flex-1 overflow-y-auto` on its scroll area — a padded block wrapper collapses
  toolbars, which is why `.storybook/preview.tsx` uses a `flex h-screen flex-col` decorator.
- Arbitrary values are reserved for the small type scale (`text-[11px]`, `text-[12px]`) and
  var-backed radii/shadows (`rounded-[var(--radius-lg)]`, `shadow-[var(--shadow-float)]`).
  Numbers read as counts get `tabular-nums`.

## Story discipline (not optional)

`.storybook/main.ts` globs `../src/panel/**/*.stories.tsx`, so every component file has a
colocated `*.stories.tsx` sibling — currently all nine components plus `SidePanel` itself.
`tsconfig.json` includes `src`, so `npm run typecheck` type-checks the stories: a prop
change breaks its story in the same commit. **A new component without a story is an
incomplete change.**

- Use `satisfies Meta<typeof X>` on `meta`, `StoryObj<typeof meta>` for stories, `fn()` from
  `storybook/test` for every handler, and a leading `/** … */` on each story saying which
  real situation it is.
- Handlers that an effect depends on must be **hoisted out of `args` and created once** —
  `ExchangeDetail.stories.tsx` keeps `const onLoadBody = fn()` at module scope because the
  component re-runs its body-loading effect on that identity.
- Fixtures come from `src/panel/stories/fixtures.ts`, built with the extension's own
  factories — verified names: `newStory` (`shared/story.ts`), `newProfile` and `newField`
  (`shared/form.ts`), `toExchangeMeta` (`shared/capture.ts`), and `resolveProfile` run for
  real to produce the Fill previews. Do not hand-write object literals for `ExchangeMeta`,
  `FormProfile` or `StoryMeta`: `toExchangeMeta` derives `reqBytes`/`resBytes` from the body
  snapshots, and a literal silently drifts when a shape changes instead of failing.
  Time-sensitive fixtures anchor to `Date.now()` (`T0`, `pendingExchange`), never a fixed date.
- Whole-panel stories re-install the stand-in per story via
  `withChrome(options)` → `installChromeMock({ tabClosed, recording, pageConnected, entries, storage })`
  returned from `beforeEach`, restoring the default on teardown.

### The states Storybook exists for

Hard to reach by hand, so each one is a named story rather than a manual repro:
truncated + redacted bodies (`ExchangeDetail/TruncatedAndRedacted`), a body the worker
dropped (`BodyGone`), a non-JSON response that cannot be stubbed (`NotJson`), an in-flight
request (`NetworkLogCard/InFlight`), a tab running no content script
(`PageNotConnected`, `PageNotConnectedWithRows`), a closed pinned tab
(`SidePanel/PinnedTabClosed`), a ring-buffer overflow (`WithDroppedEntries`), the
`chrome.storage.sync` 8 KB-per-item quota report (`SettingsCard/SyncQuotaWarning`), and
mutually-referencing formulas (`ProfilesCard/CircularReference`).
A new edge case you had to fake by hand to see gets a story in the same change.

## Verifying a panel change

`npm run typecheck` → `npm run build-storybook -- --quiet` → open `npm run storybook` for
anything that renders differently or touches `chrome.*`. When the panel talks to the
service worker (`useNetworkLog`, message kinds, `src/inject/run.ts` callers), the
loaded-extension suite is the only thing that proves it. **Load the sibling skill
`verify-change` for the full ladder and the change-kind → checks table — it is not
duplicated here.**

## Siblings

- `mv3-architecture` — worlds, manifest, the worker/bridge/interceptor split and the message contracts the panel speaks.
- `mock-engine` — rules, stories, matching and replay; what `servedBy` values mean in the log.
- `form-filler` — `src/inject/formAgent.ts`, selector strategies and frame reports behind the Fill tab.
