/**
 * A Story is a named set of exchanges captured from the real backend and
 * replayed as stubs. Entries carry only body *keys*: the bodies live in their
 * own storage entries and are fetched lazily, so activating a story never
 * pushes megabytes of JSON into every frame.
 */
import type { ExchangeMeta } from './capture';
import { randomId } from './ids';
import type { HttpMethod, MutationRule } from './types';

/** Query strings often select the response, so matching can include them. */
export type MatchOn = 'path' | 'path+query';
export type Cycle = 'once' | 'loop' | 'stick-last';

/** Story entries always sit below hand-written rules, which are deliberate overrides. */
export const STORY_PRIORITY = -1;
export const DEFAULT_STRICT_PATTERN = '/api/*';

export interface StoryMeta {
  id: string;
  name: string;
  notes?: string;
  isActive: boolean;
  /** Answer 501 instead of falling through when a request is not in the story. */
  strict: boolean;
  /** Strict only applies to requests matching this pattern, so page assets keep loading. */
  strictPattern: string;
  matchOn: MatchOn;
  scopeOrigins: string[];
  /** Replay each entry with the latency it was recorded at. */
  replayTiming: boolean;
  entryCount: number;
  createdAt: number;
}

export interface StoryEntry {
  id: string;
  method: HttpMethod;
  urlPattern: string;
  status: number;
  contentType: string;
  /** More than one body means a sequence: the same endpoint answering differently over time. */
  bodyKeys: string[];
  cycle: Cycle;
  delayMs?: number;
  label?: string;
}

const METHODS: HttpMethod[] = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function newStory(name: string, matchOn: MatchOn = 'path+query'): StoryMeta {
  return {
    id: randomId('st_'),
    name,
    isActive: false,
    strict: false,
    strictPattern: DEFAULT_STRICT_PATTERN,
    matchOn,
    scopeOrigins: [],
    replayTiming: false,
    entryCount: 0,
    createdAt: Date.now(),
  };
}

/**
 * Turns an entry into a rule-shaped object so the existing matcher serves it —
 * `compileRules` already sorts by priority, which is what makes hand-written
 * rules win without touching `findRule`.
 */
export function entryToRule(entry: StoryEntry, story: StoryMeta): MutationRule {
  return {
    id: `${story.id}:${entry.id}`,
    isActive: true,
    type: 'STUB',
    urlPattern: entry.urlPattern,
    method: entry.method,
    payload: null,
    status: entry.status,
    priority: STORY_PRIORITY,
    bodyKeys: entry.bodyKeys,
    cycle: entry.cycle,
    contentType: entry.contentType,
    ...(story.replayTiming && entry.delayMs ? { delayMs: entry.delayMs } : {}),
    storyId: story.id,
    label: entry.label ?? story.name,
    ...(story.scopeOrigins.length > 0 ? { scope: { origins: story.scopeOrigins } } : {}),
  };
}

/**
 * Derives an entry from a logged exchange. The pattern is always a pathname or
 * a full URL: `compilePattern`'s bare-text branch is a whole-URL substring
 * match, which would over-match wildly for generated patterns.
 */
export function exchangeToEntry(meta: ExchangeMeta, bodyKey: string, matchOn: MatchOn): StoryEntry {
  const urlPattern =
    matchOn === 'path+query' && meta.search
      ? `${meta.origin}${meta.pathname}${meta.search}`
      : meta.pathname || meta.url;

  return {
    id: randomId('en_'),
    method: METHODS.includes(meta.method as HttpMethod) ? (meta.method as HttpMethod) : 'ANY',
    urlPattern,
    status: meta.status || 200,
    contentType: meta.contentType || 'application/json',
    bodyKeys: [bodyKey],
    cycle: 'stick-last',
    // Remember how long the backend actually took, in case the story replays timing.
    delayMs: Math.min(Math.round(meta.durationMs), 30_000),
    label: `${meta.method} ${meta.pathname}`,
  };
}

/**
 * Adds an entry to a story, folding repeat captures of the same endpoint into a
 * sequence — which is exactly how a polling endpoint (PENDING → PENDING → DONE)
 * gets recorded without anyone hand-writing it.
 */
export function addEntry(entries: StoryEntry[], incoming: StoryEntry): StoryEntry[] {
  const index = entries.findIndex(
    (entry) => entry.method === incoming.method && entry.urlPattern === incoming.urlPattern,
  );
  if (index < 0) return [...entries, incoming];

  const existing = entries[index];
  const bodyKey = incoming.bodyKeys[0];
  // Repeating the same body adds nothing; a different one extends the sequence.
  if (existing.bodyKeys[existing.bodyKeys.length - 1] === bodyKey) return entries;

  const merged: StoryEntry = {
    ...existing,
    status: incoming.status,
    bodyKeys: [...existing.bodyKeys, bodyKey],
  };
  return entries.map((entry, i) => (i === index ? merged : entry));
}

/** Picks the body for this hit, given how many times the entry already answered. */
export function bodyKeyForHit(bodyKeys: string[], cycle: Cycle, hits: number): string | undefined {
  if (bodyKeys.length === 0) return undefined;
  if (hits < bodyKeys.length) return bodyKeys[hits];
  switch (cycle) {
    case 'loop':
      return bodyKeys[hits % bodyKeys.length];
    case 'stick-last':
      return bodyKeys[bodyKeys.length - 1];
    case 'once':
      // Sequence exhausted: stop intercepting and let the real backend answer.
      return undefined;
  }
}

export function referencedBodyKeys(entriesByStory: StoryEntry[][]): Set<string> {
  const keys = new Set<string>();
  for (const entries of entriesByStory) {
    for (const entry of entries) for (const key of entry.bodyKeys) keys.add(key);
  }
  return keys;
}
