/**
 * A stand-in for the slice of `chrome.*` the panel touches, so `SidePanel`
 * runs end to end inside Storybook.
 *
 * No module under `src/` reads `chrome` at import time, and every call site is
 * guarded on `typeof chrome !== 'undefined'`, so installing this object on
 * `globalThis` before the first render is enough — no module mocking or Vite
 * aliasing needed. `src/inject/run.ts` is the exception that makes it
 * necessary: it calls `chrome.tabs`/`chrome.scripting` unguarded, so Fill,
 * Pick and Record would throw without a stand-in.
 */
import type { BgToPanel, PanelToBg } from '../../shared/messages';
import { STORAGE_KEYS, storyEntriesKey } from '../../shared/types';
import { bodies, exchanges, profiles, rules, settings, stories, tabUrl, usageBytes } from './fixtures';

const TAB_ID = 1;
/** Long enough to see the panel's own loading states, short enough not to drag. */
const REPLY_DELAY_MS = 30;

type Store = Record<string, unknown>;

const seed = (): Store => ({
  [STORAGE_KEYS.settings]: settings,
  [STORAGE_KEYS.rules]: rules,
  [STORAGE_KEYS.stories]: stories,
  [STORAGE_KEYS.profiles]: profiles,
  [STORAGE_KEYS.counters]: { user: 41 },
  [storyEntriesKey('st_checkout')]: [],
});

const pick = (store: Store, keys: unknown): Store => {
  if (keys === null || keys === undefined) return { ...store };
  const list = Array.isArray(keys) ? keys : [keys];
  const out: Store = {};
  for (const key of list) if (typeof key === 'string' && key in store) out[key] = store[key];
  return out;
};

export interface ChromeMockOptions {
  /** Rows the fake service worker replays when the panel subscribes. */
  entries?: typeof exchanges;
  /** Extra storage values, merged over the seeded ones. */
  storage?: Store;
  /** Start with recording on for the pinned tab. */
  recording?: boolean;
  /** Report the pinned tab as gone, so the panel goes read-only. */
  tabClosed?: boolean;
}

export function installChromeMock(options: ChromeMockOptions = {}): void {
  const store: Store = { ...seed(), ...options.storage };
  const entries = options.entries ?? exchanges;
  let recording = options.recording ?? true;

  const mock = {
    storage: {
      local: {
        get: (keys?: unknown) => Promise.resolve(pick(store, keys)),
        set: (values: Store) => {
          Object.assign(store, values);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
          return Promise.resolve();
        },
        getBytesInUse: () => Promise.resolve(usageBytes),
      },
      sync: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: {
      connect: () => {
        const listeners: ((message: BgToPanel) => void)[] = [];
        const send = (message: BgToPanel) =>
          setTimeout(() => listeners.forEach((listener) => listener(message)), REPLY_DELAY_MS);
        return {
          onMessage: { addListener: (fn: (message: BgToPanel) => void) => listeners.push(fn) },
          onDisconnect: { addListener: () => {} },
          disconnect: () => {},
          postMessage: (message: PanelToBg) => {
            if (message.kind === 'log/subscribe') {
              // The real panel is opened as index.html?tabId=<id> and stays with
              // that tab, so the stand-in always reports itself as pinned.
              send({ kind: 'tab/changed', tabId: TAB_ID, url: tabUrl, pinned: true });
              send({ kind: 'tab/recording', tabId: TAB_ID, recording });
              send({ kind: 'log/reset', tabId: TAB_ID, entries, dropped: 0 });
              if (options.tabClosed) send({ kind: 'tab/closed', tabId: TAB_ID });
            }
            if (message.kind === 'log/record') {
              recording = message.enabled;
              send({ kind: 'tab/recording', tabId: TAB_ID, recording });
            }
            if (message.kind === 'log/clear') {
              send({ kind: 'log/reset', tabId: TAB_ID, entries: [], dropped: 0 });
            }
            if (message.kind === 'log/getBody') {
              const body = message.exchangeId === 'ex3' ? bodies.checkout : bodies.items;
              send({ kind: 'log/body', exchangeId: message.exchangeId, ...body });
            }
          },
        };
      },
    },
    windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
    tabs: { query: () => Promise.resolve([{ id: TAB_ID, url: tabUrl }]) },
    scripting: {
      executeScript: () =>
        Promise.resolve([{ result: { kind: 'fill', filled: ['email', 'password', 'total'], misses: ['city'] } }]),
    },
    commands: { onCommand: { addListener: () => {} } },
  };

  (globalThis as { chrome?: unknown }).chrome = mock;
}
