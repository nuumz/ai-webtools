/**
 * Runs the form agent in the inspected tab.
 *
 * `chrome.scripting.executeScript` with `allFrames` reaches cross-origin
 * iframes too, which is why the extension holds `host_permissions` rather than
 * `activeTab` — the latter is revoked on navigation, so the button would go
 * quiet the moment the user moved to the next page.
 */
import type { FieldSelector, ResolvedFillField } from '../shared/form';
import { randomId } from '../shared/ids';
import {
  formAgent,
  type AgentResult,
  type RecordedField,
  type RejectedField,
  type SkippedField,
} from './formAgent';

export interface FillOutcome {
  filled: string[];
  /** A selector that found nothing anywhere: the field is genuinely broken. */
  misses: string[];
  /** Found, but not fillable here and now — another step, or disabled. */
  skipped: SkippedField[];
  /** Written, and the app threw it away: a mask, a native date, a re-render. */
  rejected: RejectedField[];
}

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function runFill(tabId: number, fields: ResolvedFillField[]): Promise<FillOutcome> {
  const results = await execute(tabId, { kind: 'fill', fields });

  const filled = new Set<string>();
  const skipped = new Map<string, SkippedField>();
  const rejected = new Map<string, RejectedField>();
  for (const result of results) {
    if (result?.kind !== 'fill') continue;
    for (const key of result.filled) filled.add(key);
    for (const entry of result.skipped) skipped.set(entry.key, entry);
    for (const entry of result.rejected) rejected.set(entry.key, entry);
  }
  // A frame that filled it outranks a frame that could not.
  const explained = (key: string) => skipped.has(key) || rejected.has(key);
  return {
    filled: [...filled],
    skipped: [...skipped.values()].filter((entry) => !filled.has(entry.key)),
    rejected: [...rejected.values()].filter((entry) => !filled.has(entry.key)),
    // Only what no frame filled and no frame explained is actually missing.
    misses: fields
      .map((field) => field.key)
      .filter((key) => !filled.has(key) && !explained(key)),
  };
}

export interface ScreenScore {
  id: string;
  /** How many of the signature's texts are visible. */
  matched: number;
  total: number;
}

export interface ScreenOutcome {
  /** Every signature, scored, best first. */
  scores: ScreenScore[];
  /** The one screen showing, or undefined when none is complete or two tie. */
  best?: string;
  /** Headings the user can name a new screen after. */
  sample: string[];
}

/**
 * Which of the known screens is showing. The whole point is that a wizard's
 * steps share one URL, so nothing outside the page can answer this.
 */
export async function runScreen(
  tabId: number,
  signatures: { id: string; texts: string[] }[],
): Promise<ScreenOutcome> {
  const results = await execute(tabId, { kind: 'screen', signatures });
  const best = new Map<string, ScreenScore>();
  const sample: string[] = [];
  for (const result of results) {
    if (result?.kind !== 'screen') continue;
    // The frame that sees the most of a screen is the frame showing it.
    for (const score of result.scores) {
      const current = best.get(score.id);
      if (!current || score.matched > current.matched) best.set(score.id, score);
    }
    for (const text of result.sample) if (!sample.includes(text)) sample.push(text);
  }

  const scores = [...best.values()].sort(
    (left, right) => right.matched - left.matched || right.total - left.total,
  );
  const winner = pickScreen(scores);
  return { scores, ...(winner ? { best: winner } : {}), sample };
}

/**
 * The one screen showing. A partial score is never a match — half a signature
 * means the other half is on some other step — and when two complete signatures
 * are equally specific the panel must ask rather than guess.
 */
export function pickScreen(scores: ScreenScore[]): string | undefined {
  const complete = scores
    .filter((score) => score.total > 0 && score.matched === score.total)
    .sort((left, right) => right.total - left.total);
  if (complete.length === 0) return undefined;
  if (complete.length > 1 && complete[0].total === complete[1].total) return undefined;
  return complete[0].id;
}

export async function runRecord(tabId: number, includeSecrets: boolean): Promise<RecordedField[]> {
  const results = await execute(tabId, { kind: 'record', includeSecrets });
  const fields: RecordedField[] = [];
  for (const result of results) {
    if (result?.kind === 'record') fields.push(...result.fields);
  }
  return fields;
}

export interface PickOutcome {
  selectors: FieldSelector[];
  label?: string;
  value?: string;
}

/** Resolves once the user clicks in one frame; the other frames cancel themselves. */
export async function runPick(tabId: number): Promise<PickOutcome | null> {
  const results = await execute(tabId, { kind: 'pick', sessionId: randomId('pk_') });
  for (const result of results) {
    if (result?.kind === 'pick' && result.selectors && result.selectors.length > 0) {
      return { selectors: result.selectors, label: result.label, value: result.value };
    }
  }
  return null;
}

async function execute(
  tabId: number,
  command: Parameters<typeof formAgent>[0],
): Promise<(AgentResult | undefined)[]> {
  const injected = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: formAgent,
    args: [command],
  });
  // Frames that cannot be injected (about:blank, sandboxed) simply return nothing.
  return injected.map((entry) => entry.result as AgentResult | undefined);
}
