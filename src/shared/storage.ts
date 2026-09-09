import {
  DEFAULT_FORM_FILL_FIELDS,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  storyEntriesKey,
  type FormFillField,
  type MutationRule,
  type Settings,
} from './types';
import type { StoryEntry, StoryMeta } from './story';

const hasChromeStorage = (): boolean =>
  typeof chrome !== 'undefined' && !!chrome.storage?.local;

export async function loadRules(): Promise<MutationRule[]> {
  if (!hasChromeStorage()) return [];
  const stored = await chrome.storage.local.get([STORAGE_KEYS.rules]);
  const rules = stored[STORAGE_KEYS.rules];
  return Array.isArray(rules) ? (rules as MutationRule[]) : [];
}

export async function saveRules(rules: MutationRule[]): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.rules]: rules });
}

export async function loadFormFillFields(): Promise<FormFillField[]> {
  if (!hasChromeStorage()) return DEFAULT_FORM_FILL_FIELDS;
  const stored = await chrome.storage.local.get([STORAGE_KEYS.formFill]);
  const fields = stored[STORAGE_KEYS.formFill];
  return Array.isArray(fields) ? (fields as FormFillField[]) : DEFAULT_FORM_FILL_FIELDS;
}

export async function saveFormFillFields(fields: FormFillField[]): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.formFill]: fields });
}

export async function loadSettings(): Promise<Settings> {
  if (!hasChromeStorage()) return DEFAULT_SETTINGS;
  const stored = await chrome.storage.local.get([STORAGE_KEYS.settings]);
  return normalizeSettings(stored[STORAGE_KEYS.settings]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

/** Fills in defaults for partial/legacy stored settings so every reader sees a complete shape. */
export function normalizeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
  const partial = raw as Partial<Settings>;
  return {
    enabled: partial.enabled ?? DEFAULT_SETTINGS.enabled,
    captureEnabled: partial.captureEnabled ?? DEFAULT_SETTINGS.captureEnabled,
    redactKeys: Array.isArray(partial.redactKeys) ? partial.redactKeys : DEFAULT_SETTINGS.redactKeys,
  };
}

export async function loadStories(): Promise<StoryMeta[]> {
  if (!hasChromeStorage()) return [];
  const stored = await chrome.storage.local.get([STORAGE_KEYS.stories]);
  const stories = stored[STORAGE_KEYS.stories];
  return Array.isArray(stories) ? (stories as StoryMeta[]) : [];
}

export async function saveStories(stories: StoryMeta[]): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.stories]: stories });
}

export async function loadStoryEntries(storyId: string): Promise<StoryEntry[]> {
  if (!hasChromeStorage()) return [];
  const key = storyEntriesKey(storyId);
  const stored = await chrome.storage.local.get(key);
  const entries = stored[key];
  return Array.isArray(entries) ? (entries as StoryEntry[]) : [];
}

export async function saveStoryEntries(storyId: string, entries: StoryEntry[]): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ [storyEntriesKey(storyId)]: entries });
}

export async function removeStory(storyId: string): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.remove(storyEntriesKey(storyId));
}
