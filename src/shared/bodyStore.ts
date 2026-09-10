/**
 * Content-addressed storage for captured response bodies. Identical responses
 * collapse to one entry, and bodies stay out of the config pushed into frames.
 */
import { STORAGE_KEYS, type MutationRule } from './types';

const BODY_PREFIX = 'body:';

export const bodyStorageKey = (hash: string): string => `${BODY_PREFIX}${hash}`;

const hasChromeStorage = (): boolean => typeof chrome !== 'undefined' && !!chrome.storage?.local;

export async function hashBody(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Stores the body if it is new and returns its key. */
export async function putBody(text: string): Promise<string> {
  const hash = await hashBody(text);
  if (!hasChromeStorage()) return hash;
  const key = bodyStorageKey(hash);
  const existing = await chrome.storage.local.get(key);
  if (existing[key] === undefined) await chrome.storage.local.set({ [key]: text });
  return hash;
}

export async function getBody(hash: string): Promise<string | undefined> {
  if (!hasChromeStorage()) return undefined;
  const key = bodyStorageKey(hash);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Deletes bodies nothing references any more. Returns how many went.
 *
 * Callers pass the story side; the rule side is read here so that deleting a
 * story can never gut a story-backed stub that outlived it.
 */
export async function collectGarbage(referenced: Set<string>): Promise<number> {
  if (!hasChromeStorage()) return 0;
  const all = await chrome.storage.local.get(null);
  const kept = new Set(referenced);
  for (const key of ruleBodyKeys(all[STORAGE_KEYS.rules])) kept.add(key);
  const orphans = Object.keys(all).filter(
    (key) => key.startsWith(BODY_PREFIX) && !kept.has(key.slice(BODY_PREFIX.length)),
  );
  if (orphans.length > 0) await chrome.storage.local.remove(orphans);
  return orphans.length;
}

/**
 * Deletes recorded bodies above a size. Entries that referenced them fall
 * through to the real network, which is the safe direction.
 */
export async function trimBodies(maxBytes: number): Promise<number> {
  if (!hasChromeStorage()) return 0;
  const all = await chrome.storage.local.get(null);
  const oversized = Object.entries(all)
    .filter(([key, value]) => key.startsWith(BODY_PREFIX) && typeof value === 'string' && value.length > maxBytes)
    .map(([key]) => key);
  if (oversized.length > 0) await chrome.storage.local.remove(oversized);
  return oversized.length;
}

export async function usageBytes(): Promise<number> {
  if (!hasChromeStorage()) return 0;
  try {
    return await chrome.storage.local.getBytesInUse(null);
  } catch {
    return 0;
  }
}

/** Body keys a stub rule replays, whether or not its story still exists. */
export function ruleBodyKeys(rules: unknown): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(rules)) return keys;
  for (const rule of rules as MutationRule[]) {
    for (const key of rule?.bodyKeys ?? []) keys.add(key);
  }
  return keys;
}
