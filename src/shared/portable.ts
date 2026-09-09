/**
 * Export and import everything the extension knows, as one self-contained
 * file: stories carry their bodies inline so a colleague (or a repo) can hold
 * the whole setup without the content-addressed store behind it.
 */
import { getBody, putBody } from './bodyStore';
import { migrateFormFillFields, type FormProfile } from './form';
import {
  loadCounters,
  loadProfiles,
  loadRules,
  loadSettings,
  loadStories,
  loadStoryEntries,
  normalizeSettings,
  removeStory,
  saveCounters,
  saveProfiles,
  saveRules,
  saveSettings,
  saveStories,
  saveStoryEntries,
} from './storage';
import type { StoryEntry, StoryMeta } from './story';
import { STORAGE_KEYS, type FormFillField, type MutationRule, type Settings } from './types';

export const SCHEMA_VERSION = 3;

export interface PortableStory {
  meta: StoryMeta;
  entries: StoryEntry[];
  /** bodyKey → body text, so the file needs nothing else to replay. */
  bodies: Record<string, string>;
}

export interface StoredState {
  schemaVersion: number;
  exportedAt: string;
  settings: Settings;
  mutationRules: MutationRule[];
  formProfiles: FormProfile[];
  counters: Record<string, number>;
  stories: PortableStory[];
}

export async function exportState(): Promise<StoredState> {
  const [settings, mutationRules, formProfiles, counters, storyMetas] = await Promise.all([
    loadSettings(),
    loadRules(),
    loadProfiles(),
    loadCounters(),
    loadStories(),
  ]);

  const stories: PortableStory[] = [];
  for (const meta of storyMetas) {
    const entries = await loadStoryEntries(meta.id);
    const bodies: Record<string, string> = {};
    for (const entry of entries) {
      for (const key of entry.bodyKeys) {
        if (bodies[key] !== undefined) continue;
        const text = await getBody(key);
        if (text !== undefined) bodies[key] = text;
      }
    }
    stories.push({ meta, entries, bodies });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    mutationRules,
    formProfiles,
    counters,
    stories,
  };
}

export type ImportMode = 'merge' | 'replace';

export interface ImportReport {
  rules: number;
  profiles: number;
  stories: number;
  bodies: number;
}

export async function importState(raw: unknown, mode: ImportMode): Promise<ImportReport> {
  const state = migrateState(raw);

  const [existingRules, existingProfiles, existingStories] = await Promise.all([
    mode === 'merge' ? loadRules() : Promise.resolve([]),
    mode === 'merge' ? loadProfiles() : Promise.resolve([]),
    loadStories(),
  ]);

  if (mode === 'replace') {
    // Drop the old entry lists, or their keys linger forever.
    for (const story of existingStories) await removeStory(story.id);
  }

  await saveRules(mergeById(existingRules, state.mutationRules));
  await saveProfiles(mergeById(existingProfiles, state.formProfiles));
  await saveCounters(
    mode === 'merge' ? { ...(await loadCounters()), ...state.counters } : state.counters,
  );
  await saveSettings(
    mode === 'merge'
      ? { ...(await loadSettings()), ...state.settings }
      : normalizeSettings(state.settings),
  );

  let bodies = 0;
  for (const story of state.stories) {
    for (const text of Object.values(story.bodies)) {
      // Content-addressed: re-storing yields the same key the entries reference.
      await putBody(text);
      bodies += 1;
    }
    await saveStoryEntries(story.meta.id, story.entries);
  }

  const keptStories = mode === 'merge' ? existingStories : [];
  await saveStories(mergeById(keptStories, state.stories.map((story) => story.meta)));

  return {
    rules: state.mutationRules.length,
    profiles: state.formProfiles.length,
    stories: state.stories.length,
    bodies,
  };
}

/** Accepts older exports, including the day-one `formFillFields` list. */
export function migrateState(raw: unknown): StoredState {
  const input = (raw ?? {}) as Partial<StoredState> & { formFillFields?: FormFillField[] };

  const formProfiles = Array.isArray(input.formProfiles)
    ? input.formProfiles
    : Array.isArray(input.formFillFields) && input.formFillFields.length > 0
      ? [migrateFormFillFields(input.formFillFields)]
      : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : new Date().toISOString(),
    settings: normalizeSettings(input.settings),
    mutationRules: Array.isArray(input.mutationRules) ? input.mutationRules : [],
    formProfiles,
    counters: input.counters && typeof input.counters === 'object' ? input.counters : {},
    stories: Array.isArray(input.stories)
      ? input.stories
          .filter((story): story is PortableStory => !!story?.meta?.id)
          .map((story) => ({
            meta: story.meta,
            entries: Array.isArray(story.entries) ? story.entries : [],
            bodies: story.bodies && typeof story.bodies === 'object' ? story.bodies : {},
          }))
      : [],
  };
}

/** Incoming records win; anything not mentioned is left alone. */
function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

export function suggestedFileName(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `devtool-${stamp}.json`;
}

/** Panel-side download; no `downloads` permission needed for a Blob URL. */
export function downloadState(state: StoredState, fileName = suggestedFileName()): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export const EXPORT_KEYS = Object.values(STORAGE_KEYS);
