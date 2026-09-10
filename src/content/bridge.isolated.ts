// ISOLATED world: the only side that can talk to chrome.* APIs.
// It pushes config down to the MAIN-world interceptor and forwards captured
// traffic up to the service worker.
import { normalizeSettings } from '../shared/storage';
import { getBody } from '../shared/bodyStore';
import { PORT_PAGE, type BgToPage, type PageToBg } from '../shared/messages';
import { originMatches, ruleAppliesToOrigin } from '../shared/match';
import { DEFAULT_STRICT_PATTERN, entryToRule, type StoryEntry, type StoryMeta } from '../shared/story';
import { onBus, postBus, writeStoredConfig } from '../shared/pageBus';
import {
  BODY_REPLY_EVENT,
  BODY_REQUEST_EVENT,
  CAPTURE_EVENT,
  CAPTURE_FLAG,
  ARMED_FLAG,
  REQUEST_EVENT,
  STORAGE_KEYS,
  SYNC_EVENT,
  storyEntriesKey,
  type MutationRule,
  type PageConfig,
  type Settings,
} from '../shared/types';
import type { CapturedExchange } from '../shared/capture';

const SYNC_DEBOUNCE_MS = 50;
/** Ceiling on records forwarded per second; the excess is counted, not queued. */
const RATE_LIMIT_PER_SEC = 50;

const readCaptureFlag = (): boolean => {
  try {
    return sessionStorage.getItem(CAPTURE_FLAG) === '1';
  } catch {
    return false;
  }
};

const readArmedFlag = (): boolean => {
  try {
    return sessionStorage.getItem(ARMED_FLAG) === '1';
  } catch {
    return false;
  }
};

/*
 * Seed recording from the same session flag the interceptor uses. chrome.storage
 * is async, and dropping in-flight rows until it lands is how pending never paints.
 * Capture only starts if this tab opened the panel and Record is on for it.
 */
/**
 * The worker re-injects this file into a tab whose scripts never ran (a page
 * opened before the extension, or orphaned by a reload). Injecting twice must
 * not double every capture, so the second copy stands down.
 */
const INSTALL_FLAG = '__DEV_TOOL_BRIDGE_INSTALLED__';
const bridgeScope = globalThis as unknown as Record<string, unknown>;
const previous = bridgeScope[INSTALL_FLAG] as (() => boolean) | undefined;
/*
 * The worker only re-injects when it can see no port for the tab, so a copy
 * that is already here should re-attach rather than stand down. One orphaned by
 * an extension reload cannot re-attach at all — its chrome.* calls are dead —
 * and standing down for it is what leaves a tab dark until the page is
 * reloaded by hand.
 */
if (typeof previous === 'function' && previous()) {
  // A live copy took the hint; a second install would double every capture.
} else {
  bridgeScope[INSTALL_FLAG] = true;
  install();
}

function install(): void {
let settings: Settings = {
  ...normalizeSettings(undefined),
  captureEnabled: false,
};
let armed = readArmedFlag();
let recording = readArmedFlag() && readCaptureFlag();
let lastPushed = '';
let lastCapture = '';
let syncTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------- config push

const readConfig = async (): Promise<PageConfig> => {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.rules,
    STORAGE_KEYS.settings,
    STORAGE_KEYS.stories,
  ]);
  const all: MutationRule[] = Array.isArray(stored[STORAGE_KEYS.rules])
    ? (stored[STORAGE_KEYS.rules] as MutationRule[])
    : [];
  settings = normalizeSettings(stored[STORAGE_KEYS.settings]);

  const stories: StoryMeta[] = Array.isArray(stored[STORAGE_KEYS.stories])
    ? (stored[STORAGE_KEYS.stories] as StoryMeta[])
    : [];
  const active = stories.filter(
    (story) => story.isActive && originMatches(story.scopeOrigins, location.origin),
  );

  // Entries carry body *keys* only — the bodies are fetched on first match.
  const storyRules: MutationRule[] = [];
  if (active.length > 0) {
    const entryStore = await chrome.storage.local.get(active.map((story) => storyEntriesKey(story.id)));
    for (const story of active) {
      const entries = entryStore[storyEntriesKey(story.id)];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries as StoryEntry[]) storyRules.push(entryToRule(entry, story));
    }
  }

  return {
    version: 3,
    settings,
    // Frames only ever need the rules that can match their own origin.
    rules: all.filter((rule) => ruleAppliesToOrigin(rule, location.origin)),
    storyRules,
    strictPatterns: active
      .filter((story) => story.strict)
      .map((story) => story.strictPattern || DEFAULT_STRICT_PATTERN),
  };
};

const writeCaptureFlag = (on: boolean): void => {
  try {
    sessionStorage.setItem(CAPTURE_FLAG, on ? '1' : '0');
  } catch {
    /* opaque / sandboxed origin */
  }
};

const writeArmedFlag = (on: boolean): void => {
  try {
    sessionStorage.setItem(ARMED_FLAG, on ? '1' : '0');
  } catch {
    /* opaque / sandboxed origin */
  }
};

const toPageConfig = (config: PageConfig): PageConfig =>
  armed
    ? {
        ...config,
        armed: true,
        settings: { ...config.settings, captureEnabled: recording },
      }
    : {
        ...config,
        armed: false,
        settings: { ...config.settings, enabled: false, captureEnabled: false },
        rules: [],
        storyRules: [],
        strictPatterns: [],
      };

const pushConfig = async (): Promise<void> => {
  try {
    const config = toPageConfig(await readConfig());
    writeArmedFlag(armed);
    writeCaptureFlag(config.settings.captureEnabled);
    const payload = JSON.stringify(config);
    writeStoredConfig(payload);
    if (payload !== lastPushed) {
      lastPushed = payload;
      window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: payload }));
      postBus('sync', payload);
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
/**
 * This module lives as long as the document, so the first hello is the only one
 * that means "new page"; every later one is this frame re-attaching to a worker
 * that was terminated for being idle.
 */
let helloSent = false;

/** Connects as soon as config is known, so the panel can bind this tab before Record. */
const syncPort = (): void => {
  openPort();
};

/*
 * The worker is terminated whenever it goes idle, and that drops every port.
 * The page is perfectly fine, so re-attach instead of waiting for the next
 * request: with no port the panel reads this tab as dark, and the worker cannot
 * tell the page to start or stop recording. Only the inspected tab reconnects,
 * so an idle worker is kept alive for that one tab and no other.
 */
const REATTACH_BASE_MS = 500;
const REATTACH_MAX_MS = 10_000;
let reattachAttempts = 0;
let reattachTimer: ReturnType<typeof setTimeout> | undefined;

const scheduleReattach = (): void => {
  if (reattachTimer !== undefined || port) return;
  if (!armed) return;
  // The extension was reloaded or removed: this document's scripts are orphaned.
  if (!chrome.runtime?.id) return;
  const delay = Math.min(REATTACH_MAX_MS, REATTACH_BASE_MS * 2 ** reattachAttempts);
  reattachAttempts += 1;
  reattachTimer = setTimeout(() => {
    reattachTimer = undefined;
    openPort();
  }, delay);
};

const openPort = (): chrome.runtime.Port | undefined => {
  if (port) return port;
  try {
    const opened = chrome.runtime.connect({ name: PORT_PAGE });
    opened.onMessage.addListener((raw: unknown) => {
      if (!raw || typeof raw !== 'object') return;
      const message = raw as BgToPage;
      if (message.kind !== 'page/armed') return;
      if (armed === message.armed && recording === message.recording) return;
      armed = message.armed;
      recording = message.recording;
      lastPushed = '';
      void pushConfig();
    });
    opened.onDisconnect.addListener(() => {
      port = undefined;
      scheduleReattach();
    });
    port = opened;
    reattachAttempts = 0;
    let isTop = false;
    try {
      isTop = window.top === window;
    } catch {
      isTop = false;
    }
    post({ kind: 'page/hello', url: location.href, isTop, fresh: !helloSent });
    helloSent = true;
    return port;
  } catch {
    port = undefined;
    scheduleReattach();
    return undefined;
  }
};

const post = (message: PageToBg): boolean => {
  const target = port ?? openPort();
  if (!target) return false;
  try {
    target.postMessage(message);
    return true;
  } catch {
    port = undefined;
    return false;
  }
};

/**
 * What a second injection into this frame calls instead of installing again.
 * False means this copy is orphaned and the newcomer should take over.
 */
bridgeScope[INSTALL_FLAG] = (): boolean => {
  if (!chrome.runtime?.id) return false;
  return openPort() !== undefined;
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

const forwardCapture = (raw: string): void => {
  /*
   * The interceptor already decided to emit. Gating again on local flags drops
   * the first requests after reload — those flags lag the worker's inspect state.
   */
  if (!raw || raw === lastCapture) return;
  let batch: CapturedExchange[];
  try {
    batch = JSON.parse(raw || '[]') as CapturedExchange[];
  } catch {
    return;
  }

  const accepted = batch.filter((exchange) => {
    if (exchange.outcome === 'pending') return true;
    if (takeToken()) return true;
    dropped += 1;
    return false;
  });

  if (accepted.length > 0) {
    if (post({ kind: 'capture/exchange', exchanges: accepted })) lastCapture = raw;
  }
  if (dropped > 0) {
    post({ kind: 'capture/dropped', count: dropped });
    dropped = 0;
  }
};

window.addEventListener(CAPTURE_EVENT, ((event: CustomEvent<string>) => {
  forwardCapture(event.detail ?? '');
}) as EventListener);
onBus('capture', forwardCapture);

// ------------------------------------------------------- story body requests

// Registered unconditionally: replay must work whether or not we are recording,
// and reading storage here avoids holding a port open just to serve bodies.
const replyBody = (raw: string): void => {
  let requestId = '';
  let bodyKey = '';
  try {
    ({ requestId, bodyKey } = JSON.parse(raw || '{}') as { requestId: string; bodyKey: string });
  } catch {
    return;
  }
  if (!requestId) return;

  void getBody(bodyKey)
    .catch(() => undefined)
    .then((text) => {
      const encoded = JSON.stringify({ requestId, text: text ?? null });
      window.dispatchEvent(new CustomEvent(BODY_REPLY_EVENT, { detail: encoded }));
      postBus('bodyRes', encoded);
    });
};

window.addEventListener(BODY_REQUEST_EVENT, ((event: CustomEvent<string>) => {
  replyBody(event.detail ?? '');
}) as EventListener);
onBus('bodyReq', replyBody);

// ----------------------------------------------------------------- lifecycle

// 1. The interceptor asks for config as soon as it boots (it may miss the first push).
window.addEventListener(REQUEST_EVENT, () => {
  lastPushed = '';
  if (armed && recording) void pushConfig();
  else openPort();
});
onBus('request', () => {
  lastPushed = '';
  if (armed && recording) void pushConfig();
  else openPort();
});

// 2. Push once on load when this tab was already inspecting. Do not write an
// inert config over a live stored one before the worker answers.
if (armed && recording) void pushConfig();
else openPort();

// 3. …and on every edit made in the Side Panel, so changes apply without a reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const touched = Object.keys(changes).some(
    (key) =>
      key === STORAGE_KEYS.rules ||
      key === STORAGE_KEYS.settings ||
      key === STORAGE_KEYS.stories ||
      key.startsWith('story:'),
  );
  if (touched) schedulePush();
});

}
