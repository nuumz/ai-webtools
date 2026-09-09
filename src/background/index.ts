import { DEFAULT_FORM_FILL_FIELDS, STORAGE_KEYS } from '../shared/types';

// Clicking the toolbar icon opens the Side Panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[DevTool] Error setting panel behavior:', error));

// Seed storage so the panel and the interceptor always read a well-formed shape.
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.rules, STORAGE_KEYS.formFill]);
  const seed: Record<string, unknown> = {};
  if (!Array.isArray(stored[STORAGE_KEYS.rules])) seed[STORAGE_KEYS.rules] = [];
  if (!Array.isArray(stored[STORAGE_KEYS.formFill])) seed[STORAGE_KEYS.formFill] = DEFAULT_FORM_FILL_FIELDS;
  if (Object.keys(seed).length > 0) await chrome.storage.local.set(seed);
});
