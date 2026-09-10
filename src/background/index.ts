import {
  loadCounters,
  loadProfiles,
  loadSettings,
  normalizeSettings,
  saveCounters,
} from '../shared/storage';
import { pickProfileForUrl } from '../shared/form';
import { pullFromSync, pushToSync } from '../shared/sync';
import { resolveProfile } from '../shared/resolveProfile';
import { formAgent } from '../inject/formAgent';
import { DEFAULT_FORM_FILL_FIELDS, STORAGE_KEYS, type MutationRule } from '../shared/types';
import { armOpenedTab, initRouter, resumeInspect } from './router';
import { armedTabIds, isArmed, recordingTabIds } from './armedTabs';
import { restoreFromSession } from './logStore';

/** The panel document is per tab, so its tab is baked into the URL it is opened with. */
const PANEL_PATH = 'index.html';

const panelPathFor = (tabId: number): string => `${PANEL_PATH}?tabId=${tabId}`;

const enablePanel = (tabId: number): void => {
  void chrome.sidePanel
    .setOptions({ tabId, path: panelPathFor(tabId), enabled: true })
    .catch((error) => console.error('[DevTool] Error enabling panel:', error));
};

const disablePanel = (tabId: number): void => {
  void chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => undefined);
};

const disablePanelOnOtherTabs = (keepTabId: number, windowId?: number): void => {
  const query: chrome.tabs.QueryInfo = windowId !== undefined ? { windowId } : {};
  void chrome.tabs.query(query).then((tabs) => {
    for (const other of tabs) {
      if (other.id === undefined || other.id === keepTabId) continue;
      disablePanel(other.id);
    }
  });
};

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((error) => console.error('[DevTool] Error setting panel behavior:', error));

chrome.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  if (tabId === undefined) return;
  /*
   * Both calls stay in the gesture's own task: awaiting setOptions first would
   * spend the user gesture that open() requires.
   * Never setOptions({ enabled: true }) without a tabId — that makes the panel
   * follow every tab in the window.
   */
  void chrome.sidePanel.setOptions({ tabId, path: panelPathFor(tabId), enabled: true });
  void chrome.sidePanel.open({ tabId }).catch((error) => {
    if (tab.windowId !== undefined) {
      void chrome.sidePanel.open({ windowId: tab.windowId });
      disablePanelOnOtherTabs(tabId, tab.windowId);
      return;
    }
    console.error('[DevTool] Error opening panel:', error);
  });
  disablePanelOnOtherTabs(tabId, tab.windowId);
  armOpenedTab(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (resumeInspect(tabId)) enablePanel(tabId);
  else disablePanel(tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id === undefined || isArmed(tab.id)) return;
  disablePanel(tab.id);
});

initRouter({
  onArmedChange: () => void refreshBadge(),
  onTabArmed: (tabId, armed) => {
    if (!armed) disablePanel(tabId);
  },
});
void restoreFromSession();
void pullFromSync();

// Seed storage so the panel and the interceptor always read a well-formed shape.
chrome.runtime.onInstalled.addListener(async () => {
  // Pull first: on a fresh device the account may already hold the real setup,
  // and seeding an empty rule list over it would look like data loss.
  await pullFromSync();

  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.rules,
    STORAGE_KEYS.formFill,
    STORAGE_KEYS.settings,
  ]);
  const seed: Record<string, unknown> = {};
  if (!Array.isArray(stored[STORAGE_KEYS.rules])) seed[STORAGE_KEYS.rules] = [];
  if (!Array.isArray(stored[STORAGE_KEYS.formFill])) seed[STORAGE_KEYS.formFill] = DEFAULT_FORM_FILL_FIELDS;
  // Runs on update too: normalize rather than overwrite, so older profiles gain new keys.
  seed[STORAGE_KEYS.settings] = normalizeSettings(stored[STORAGE_KEYS.settings]);
  await chrome.storage.local.set(seed);
  void refreshBadge();
});

let pushTimer: ReturnType<typeof setTimeout> | undefined;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    // Someone else's device edited something; land it in local and everything
    // downstream re-hydrates through its existing local listener.
    void pullFromSync();
    return;
  }
  if (area !== 'local') return;

  if (changes[STORAGE_KEYS.settings] || changes[STORAGE_KEYS.rules]) void refreshBadge();

  if (changes[STORAGE_KEYS.settings] || changes[STORAGE_KEYS.rules] || changes[STORAGE_KEYS.profiles]) {
    // Coalesce the storm of writes the panel makes while the user types.
    if (pushTimer !== undefined) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = undefined;
      void pushToSync();
    }, 1500);
  }
});

void refreshBadge();

/**
 * Fills the current form without opening the panel. The profile is whichever
 * one was last used on this origin, else one scoped to the URL, else the only
 * one there is — see pickProfileForUrl.
 */
chrome.commands?.onCommand.addListener((command, tab) => {
  if (command !== 'fill-form' || tab?.id === undefined) return;
  void fillActiveForm(tab.id, tab.url);
});

async function fillActiveForm(tabId: number, url: string | undefined): Promise<void> {
  try {
    const [profiles, settings, counters] = await Promise.all([
      loadProfiles(),
      loadSettings(),
      loadCounters(),
    ]);

    const profile = pickProfileForUrl(profiles, url, settings.lastProfileByOrigin);
    if (!profile) return flashBadge('?');

    const resolved = resolveProfile(profile, { counters });
    if (resolved.errors.length > 0) {
      console.error('[DevTool] Profile has errors:', resolved.errors);
      return flashBadge('!');
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: formAgent,
      args: [{ kind: 'fill', fields: resolved.fields }],
    });
    await saveCounters(resolved.counters);

    const filled = new Set<string>();
    for (const entry of results) {
      const result = entry.result as { kind?: string; filled?: string[] } | undefined;
      if (result?.kind === 'fill') for (const key of result.filled ?? []) filled.add(key);
    }
    flashBadge(`✓${filled.size}`);
  } catch (error) {
    console.error('[DevTool] Shortcut fill failed:', error);
    flashBadge('!');
  }
}

/** Momentary feedback: the panel may not even be open when the shortcut runs. */
function flashBadge(text: string): void {
  void chrome.action.setBadgeText({ text });
  void chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });
  setTimeout(() => void refreshBadge(), 2000);
}

/** The badge is the only always-visible signal that traffic is being touched. */
async function refreshBadge(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.rules]);
    const settings = normalizeSettings(stored[STORAGE_KEYS.settings]);
    const rules: MutationRule[] = Array.isArray(stored[STORAGE_KEYS.rules])
      ? (stored[STORAGE_KEYS.rules] as MutationRule[])
      : [];
    const active = rules.filter((rule) => rule.isActive).length;

    if (recordingTabIds().length > 0) {
      await chrome.action.setBadgeText({ text: 'REC' });
      await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
      return;
    }
    if (!settings.enabled) {
      await chrome.action.setBadgeText({ text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
      return;
    }
    if (armedTabIds().length === 0) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    await chrome.action.setBadgeText({ text: active > 0 ? String(active) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  } catch (error) {
    console.error('[DevTool] Could not update badge:', error);
  }
}
