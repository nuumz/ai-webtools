/**
 * Content-addressed storage for captured response bodies. Identical responses
 * collapse to one entry, and bodies stay out of the config pushed into frames.
 */
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

/** Deletes bodies no story references any more. Returns how many went. */
export async function collectGarbage(referenced: Set<string>): Promise<number> {
  if (!hasChromeStorage()) return 0;
  const all = await chrome.storage.local.get(null);
  const orphans = Object.keys(all).filter(
    (key) => key.startsWith(BODY_PREFIX) && !referenced.has(key.slice(BODY_PREFIX.length)),
  );
  if (orphans.length > 0) await chrome.storage.local.remove(orphans);
  return orphans.length;
}

export async function usageBytes(): Promise<number> {
  if (!hasChromeStorage()) return 0;
  try {
    return await chrome.storage.local.getBytesInUse(null);
  } catch {
    return 0;
  }
}
