/**
 * Mirrors the light half of the setup through the browser account.
 *
 * `chrome.storage.local` stays the single source of truth: every reader and
 * every `onChanged` listener in the extension is local-only, so a pull writes
 * into local and the rest of the app re-hydrates exactly as it does for a local
 * edit. Sync is a mirror, never a second brain.
 *
 * Stories and bodies stay behind: sync allows 100 KB in total, 8 KB per item.
 */
import type { FormProfile } from './form';
import {
  loadProfiles,
  loadRules,
  loadSettings,
  normalizeSettings,
  saveProfiles,
  saveRules,
  saveSettings,
} from './storage';
import type { MutationRule, Settings } from './types';

const RULE_PREFIX = 'rule:';
const PROFILE_PREFIX = 'profile:';
const SETTINGS_KEY = 'settings';
/** Chrome's hard cap is 8192 bytes per item, including the key. */
export const MAX_ITEM_BYTES = 7800;
/** One entry per origin ever filled would grow without bound inside one item. */
export const MAX_REMEMBERED_ORIGINS = 50;

export interface SyncReport {
  pushed: number;
  skipped: string[];
  error?: string;
}

const hasSync = (): boolean => typeof chrome !== 'undefined' && !!chrome.storage?.sync;

/**
 * Cheap, stable, and enough to tell "same payload" from "changed payload".
 * Keys are sorted so a push and the pull that echoes it hash identically —
 * otherwise the two would ping-pong one extra write every time.
 */
export function stableHash(value: unknown): string {
  const text = canonical(value);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function pruneOrigins(
  origins: Record<string, string>,
  max = MAX_REMEMBERED_ORIGINS,
): Record<string, string> {
  const keys = Object.keys(origins);
  if (keys.length <= max) return origins;
  // Object key order is insertion order, so the tail is the most recent.
  return Object.fromEntries(keys.slice(keys.length - max).map((key) => [key, origins[key]]));
}

export interface ChunkResult {
  items: Record<string, unknown>;
  skipped: string[];
}

/** One item per record, so a fat rule cannot push the whole set over the limit. */
export function chunkRecords<T extends { id: string; name?: string; label?: string }>(
  prefix: string,
  records: T[],
): ChunkResult {
  const items: Record<string, unknown> = {};
  const skipped: string[] = [];

  for (const record of records) {
    const key = `${prefix}${record.id}`;
    const size = key.length + (JSON.stringify(record)?.length ?? 0);
    if (size > MAX_ITEM_BYTES) {
      skipped.push(record.name ?? record.label ?? record.id);
      continue;
    }
    items[key] = record;
  }
  return { items, skipped };
}

/** Written by the last push; a pull that matches it is our own echo. */
let lastSyncedHash = '';

export async function pushToSync(): Promise<SyncReport> {
  if (!hasSync()) return { pushed: 0, skipped: [], error: 'sync unavailable' };

  const [settings, rules, profiles] = await Promise.all([loadSettings(), loadRules(), loadProfiles()]);
  if (!settings.syncEnabled) return { pushed: 0, skipped: [] };

  const portableSettings: Settings = {
    ...settings,
    lastProfileByOrigin: pruneOrigins(settings.lastProfileByOrigin),
    syncStatus: undefined,
  };

  const ruleChunks = chunkRecords(RULE_PREFIX, rules);
  const profileChunks = chunkRecords(PROFILE_PREFIX, profiles);
  const items = {
    [SETTINGS_KEY]: portableSettings,
    ...ruleChunks.items,
    ...profileChunks.items,
  };

  const hash = stableHash(items);
  if (hash === lastSyncedHash) return { pushed: 0, skipped: [] };

  try {
    // Drop records deleted since the last push.
    const existing = await chrome.storage.sync.get(null);
    const stale = Object.keys(existing).filter(
      (key) => (key.startsWith(RULE_PREFIX) || key.startsWith(PROFILE_PREFIX)) && !(key in items),
    );
    if (stale.length > 0) await chrome.storage.sync.remove(stale);

    await chrome.storage.sync.set(items);
    lastSyncedHash = hash;

    const skipped = [...ruleChunks.skipped, ...profileChunks.skipped];
    await recordStatus(
      settings,
      skipped.length > 0 ? `Synced; too large to sync: ${skipped.join(', ')}` : undefined,
    );
    return { pushed: Object.keys(items).length, skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordStatus(settings, `Sync failed: ${message}`);
    return { pushed: 0, skipped: [], error: message };
  }
}

/** Pulls sync into local. Returns true when local actually changed. */
export async function pullFromSync(): Promise<boolean> {
  if (!hasSync()) return false;

  let stored: Record<string, unknown>;
  try {
    stored = await chrome.storage.sync.get(null);
  } catch {
    return false;
  }
  if (Object.keys(stored).length === 0) return false;

  const hash = stableHash(stored);
  if (hash === lastSyncedHash) return false; // Our own push coming back.

  const remoteSettings = stored[SETTINGS_KEY];
  const rules = collect<MutationRule>(stored, RULE_PREFIX);
  const profiles = collect<FormProfile>(stored, PROFILE_PREFIX);

  const localSettings = await loadSettings();
  if (!localSettings.syncEnabled) return false;

  let changed = false;

  if (remoteSettings) {
    const merged = normalizeSettings({
      ...(remoteSettings as Partial<Settings>),
      // Never let a remote copy switch syncing off underneath this device.
      syncEnabled: true,
      syncStatus: localSettings.syncStatus,
    });
    if (stableHash(merged) !== stableHash(localSettings)) {
      await saveSettings(merged);
      changed = true;
    }
  }

  if (stableHash(rules) !== stableHash(await loadRules())) {
    await saveRules(rules);
    changed = true;
  }
  if (stableHash(profiles) !== stableHash(await loadProfiles())) {
    await saveProfiles(profiles);
    changed = true;
  }

  lastSyncedHash = hash;
  return changed;
}

/** Clears the mirror, e.g. when the user turns syncing off. */
export async function clearSync(): Promise<void> {
  if (!hasSync()) return;
  try {
    await chrome.storage.sync.clear();
    lastSyncedHash = '';
  } catch {
    // Nothing to do: the mirror is best-effort.
  }
}

function collect<T>(stored: Record<string, unknown>, prefix: string): T[] {
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, value]) => value as T);
}

async function recordStatus(settings: Settings, status: string | undefined): Promise<void> {
  if (settings.syncStatus === status) return;
  await saveSettings({ ...settings, syncStatus: status });
}
