// ISOLATED world: the only side that can talk to chrome.* APIs.
// It pushes config down to the MAIN-world interceptor and forwards captured
// traffic up to the service worker.
import { normalizeSettings } from '../shared/storage';
import { PORT_PAGE, type PageToBg } from '../shared/messages';
import { ruleAppliesToOrigin } from '../shared/match';
import {
  CAPTURE_EVENT,
  REQUEST_EVENT,
  STORAGE_KEYS,
  SYNC_EVENT,
  type MutationRule,
  type PageConfig,
  type Settings,
} from '../shared/types';
import type { CapturedExchange } from '../shared/capture';

const SYNC_DEBOUNCE_MS = 50;
/** Ceiling on records forwarded per second; the excess is counted, not queued. */
const RATE_LIMIT_PER_SEC = 50;

let settings: Settings = normalizeSettings(undefined);
let lastPushed = '';
let syncTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------- config push

const readConfig = async (): Promise<PageConfig> => {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.rules, STORAGE_KEYS.settings]);
  const all: MutationRule[] = Array.isArray(stored[STORAGE_KEYS.rules])
    ? (stored[STORAGE_KEYS.rules] as MutationRule[])
    : [];
  settings = normalizeSettings(stored[STORAGE_KEYS.settings]);
  return {
    version: 2,
    settings,
    // Frames only ever need the rules that can match their own origin.
    rules: all.filter((rule) => ruleAppliesToOrigin(rule, location.origin)),
  };
};

const pushConfig = async (): Promise<void> => {
  try {
    const config = await readConfig();
    // `detail` is serialised: objects created in this world are not directly
    // usable by page scripts, but a string always crosses the world boundary.
    const payload = JSON.stringify(config);
    if (payload !== lastPushed) {
      lastPushed = payload;
      window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: payload }));
    }
    syncPort();
  } catch (err) {
    console.error('[Bridge] Error syncing config:', err);
  }
};

/** Coalesces the storm of storage writes the panel makes while the user types. */
const schedulePush = (): void => {
  if (syncTimer !== undefined) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    void pushConfig();
  }, SYNC_DEBOUNCE_MS);
};

// ------------------------------------------------------------------ port side

let port: chrome.runtime.Port | undefined;

/** Connects only while recording, so idle tabs never hold the service worker awake. */
const syncPort = (): void => {
  if (settings.captureEnabled) openPort();
  else closePort();
};

const openPort = (): chrome.runtime.Port | undefined => {
  if (port) return port;
  try {
    const opened = chrome.runtime.connect({ name: PORT_PAGE });
    opened.onDisconnect.addListener(() => {
      port = undefined;
    });
    port = opened;
    post({ kind: 'page/hello', url: location.href, isTop: window.top === window });
    return port;
  } catch {
    // Extension reloaded or context invalidated — retry on the next record.
    port = undefined;
    return undefined;
  }
};

const closePort = (): void => {
  try {
    port?.disconnect();
  } catch {
    // Already gone.
  }
  port = undefined;
};

const post = (message: PageToBg): void => {
  const target = port ?? openPort();
  if (!target) return;
  try {
    target.postMessage(message);
  } catch {
    port = undefined;
  }
};

// --------------------------------------------------------------- capture pipe

let tokens = RATE_LIMIT_PER_SEC;
let lastRefill = Date.now();
let dropped = 0;

const takeToken = (): boolean => {
  const now = Date.now();
  tokens = Math.min(RATE_LIMIT_PER_SEC, tokens + ((now - lastRefill) / 1000) * RATE_LIMIT_PER_SEC);
  lastRefill = now;
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
};

window.addEventListener(CAPTURE_EVENT, ((event: CustomEvent<string>) => {
  if (!settings.captureEnabled) return;
  let batch: CapturedExchange[];
  try {
    batch = JSON.parse(event.detail ?? '[]') as CapturedExchange[];
  } catch {
    return;
  }

  const accepted = batch.filter(() => {
    if (takeToken()) return true;
    dropped += 1;
    return false;
  });

  if (accepted.length > 0) post({ kind: 'capture/exchange', exchanges: accepted });
  if (dropped > 0) {
    post({ kind: 'capture/dropped', count: dropped });
    dropped = 0;
  }
}) as EventListener);

// ----------------------------------------------------------------- lifecycle

// 1. The interceptor asks for config as soon as it boots (it may miss the first push).
window.addEventListener(REQUEST_EVENT, () => {
  lastPushed = '';
  void pushConfig();
});

// 2. Push once on load…
void pushConfig();

// 3. …and on every edit made in the Side Panel, so changes apply without a reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STORAGE_KEYS.rules] || changes[STORAGE_KEYS.settings]) schedulePush();
});
