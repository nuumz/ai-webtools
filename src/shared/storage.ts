import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  storyEntriesKey,
  type FormFillField,
  type MutationRule,
  type Settings,
} from './types';
import { clampBodyLimit } from './capture';
import type { StoryEntry, StoryMeta } from './story';
import { migrateFormFillFields, type FormProfile } from './form';

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
    lastProfileByOrigin:
      partial.lastProfileByOrigin && typeof partial.lastProfileByOrigin === 'object'
        ? partial.lastProfileByOrigin
        : {},
    captureBodyLimit: clampBodyLimit(partial.captureBodyLimit),
    syncEnabled: partial.syncEnabled ?? DEFAULT_SETTINGS.syncEnabled,
    ...(partial.syncStatus ? { syncStatus: partial.syncStatus } : {}),
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

/**
 * Profiles, migrating the day-one `formFillFields` list on first read so no
 * existing setup is lost.
 */
export async function loadProfiles(): Promise<FormProfile[]> {
  if (!hasChromeStorage()) return [];
  const stored = await chrome.storage.local.get([STORAGE_KEYS.profiles, STORAGE_KEYS.formFill]);
  const profiles = stored[STORAGE_KEYS.profiles];
  if (Array.isArray(profiles) && profiles.length > 0) return profiles as FormProfile[];

  const legacy = stored[STORAGE_KEYS.formFill];
  if (!Array.isArray(legacy) || legacy.length === 0) return [];
  const migrated = [migrateFormFillFields(legacy as FormFillField[])];
  await saveProfiles(migrated);
  return migrated;
}

export async function saveProfiles(profiles: FormProfile[]): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.profiles]: profiles });
}

export async function loadCounters(): Promise<Record<string, number>> {
  if (!hasChromeStorage()) return {};
  const stored = await chrome.storage.local.get([STORAGE_KEYS.counters]);
  const counters = stored[STORAGE_KEYS.counters];
  return counters && typeof counters === 'object' ? (counters as Record<string, number>) : {};
}

export async function saveCounters(counters: Record<string, number>): Promise<void> {
  if (!hasChromeStorage()) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.counters]: counters });
}
