import { normalizeSettings } from '../shared/storage';
import { DEFAULT_FORM_FILL_FIELDS, STORAGE_KEYS, type MutationRule } from '../shared/types';
import { initRouter } from './router';
import { restoreFromSession } from './logStore';

// Clicking the toolbar icon opens the Side Panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[DevTool] Error setting panel behavior:', error));

initRouter();
void restoreFromSession();

// Seed storage so the panel and the interceptor always read a well-formed shape.
chrome.runtime.onInstalled.addListener(async () => {
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[STORAGE_KEYS.settings] || changes[STORAGE_KEYS.rules])) {
    void refreshBadge();
  }
});

void refreshBadge();

/** The badge is the only always-visible signal that traffic is being touched. */
async function refreshBadge(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.rules]);
    const settings = normalizeSettings(stored[STORAGE_KEYS.settings]);
    const rules: MutationRule[] = Array.isArray(stored[STORAGE_KEYS.rules])
      ? (stored[STORAGE_KEYS.rules] as MutationRule[])
      : [];
    const active = rules.filter((rule) => rule.isActive).length;

    if (!settings.enabled) {
      await chrome.action.setBadgeText({ text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
      return;
    }
    if (settings.captureEnabled) {
      await chrome.action.setBadgeText({ text: 'REC' });
      await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
      return;
    }
    await chrome.action.setBadgeText({ text: active > 0 ? String(active) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  } catch (error) {
    console.error('[DevTool] Could not update badge:', error);
  }
}
