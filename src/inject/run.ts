/**
 * Runs the form agent in the inspected tab.
 *
 * `chrome.scripting.executeScript` with `allFrames` reaches cross-origin
 * iframes too, which is why the extension holds `host_permissions` rather than
 * `activeTab` — the latter is revoked on navigation, so the button would go
 * quiet the moment the user moved to the next page.
 */
import { mergeStepOutcomes, type ActionStep, type StepOutcome } from '../shared/actions';
import { DEFAULT_BODY_LIMIT } from '../shared/capture';
import type { FieldSelector, ResolvedFillField } from '../shared/form';
import {
  pageCall,
  pageEval,
  pageReplay,
  type PageOutcome,
  type ReplayRequest,
  type ReplayResult,
} from './pageScript';
import { randomId } from '../shared/ids';
import {
  formAgent,
  type AgentResult,
  type RecordedField,
  type RejectedField,
  type SkippedField,
} from './formAgent';

/**
 * The frame the panel was told to act in no longer exists.
 *
 * A frame id outlives its frame: an SPA that swaps its iframe, a frame Chrome
 * parked in the back/forward cache, a crashed renderer. Chrome then rejects the
 * injection with a raw "No frame with id 920 in tab with id 859260512", and
 * fill, read and the screen check all failed with that same line — three
 * console errors that name nothing the user can act on. Falling back to every
 * frame is not the answer: writing into whichever frame answers first is the
 * exact thing naming a frame exists to prevent.
 */
export class FrameGoneError extends Error {
  constructor(readonly frameId: number) {
    super(`No frame with id ${frameId}`);
    this.name = 'FrameGoneError';
  }
}

/** Chrome words this two ways depending on which API noticed. */
const isFrameGone = (error: unknown): boolean =>
  error instanceof Error && /no frame with id|frame with id .* was removed/i.test(error.message);

/** A frame where the agent threw, kept so a silent result can be explained. */
export interface FrameFailure {
  message: string;
  url: string;
}

/**
 * What the tab answered, beyond the answer itself.
 *
 * `frames` is how many frames ran the agent at all: on a page that runs inside
 * a device simulator that is at least two, and a count of one means the app's
 * own frame never answered.
 */
/** One frame's answer, with the id Chrome returns alongside it. */
export interface FrameAnswer {
  frameId: number;
  result: AgentResult | undefined;
}

export interface FrameReport {
  frames: number;
  answered: number;
  errors: FrameFailure[];
  /** The frames that answered, so it is visible whether the app's own one did. */
  urls: string[];
}

/**
 * `results` carries holes, and they are `null`, not `undefined`: a frame whose
 * injection produced no value comes back from `executeScript` as `result: null`,
 * so testing for `undefined` alone let a null straight through to `.kind` and
 * threw before either a fill or a read could report anything at all.
 */
export function reportOf(answers: FrameAnswer[]): FrameReport {
  const results = answers.map((answer) => answer.result);
  return {
    frames: results.length,
    answered: results.filter((result) => result != null && result.kind !== 'error').length,
    errors: results.flatMap((result) =>
      result?.kind === 'error' ? [{ message: result.message, url: result.url }] : [],
    ),
    urls: results.flatMap((result) => (result?.kind === 'record' ? [result.url] : [])),
  };
}

export interface FillOutcome extends FrameReport {
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

export async function runFill(
  tabId: number,
  fields: ResolvedFillField[],
  frameId?: number,
): Promise<FillOutcome> {
  const answers = await execute(tabId, { kind: 'fill', fields }, frameId);

  const filled = new Set<string>();
  const skipped = new Map<string, SkippedField>();
  const rejected = new Map<string, RejectedField>();
  for (const { result } of answers) {
    if (result?.kind !== 'fill') continue;
    for (const key of result.filled) filled.add(key);
    for (const entry of result.skipped) skipped.set(entry.key, entry);
    for (const entry of result.rejected) rejected.set(entry.key, entry);
  }
  // A frame that filled it outranks a frame that could not. With a working
  // frame chosen only that frame answers, so nothing can mask its failures.
  const explained = (key: string) => skipped.has(key) || rejected.has(key);
  return {
    ...reportOf(answers),
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
  frameId?: number,
): Promise<ScreenOutcome> {
  const answers = await execute(tabId, { kind: 'screen', signatures }, frameId);
  const best = new Map<string, ScreenScore>();
  const sample: string[] = [];
  for (const { result } of answers) {
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

export interface RecordOutcome extends FrameReport {
  fields: RecordedField[];
}

export async function runRecord(
  tabId: number,
  includeSecrets: boolean,
  frameId?: number,
): Promise<RecordOutcome> {
  const answers = await execute(tabId, { kind: 'record', includeSecrets }, frameId);
  const fields: RecordedField[] = [];
  for (const { result } of answers) {
    if (result?.kind === 'record') fields.push(...result.fields);
  }
  return { ...reportOf(answers), fields };
}

/**
 * Why a command came back with nothing.
 *
 * A page with no fields, an agent that threw, and a tab whose frames never ran
 * all look identical from the panel — this is what tells them apart, in words
 * the user can act on.
 */
export function explainEmpty(report: FrameReport): string {
  if (report.errors.length > 0) {
    const first = report.errors[0];
    return `The agent failed in ${report.errors.length} of ${report.frames} frame(s): ${first.message}`;
  }
  if (report.frames <= 1) {
    return 'Only the top frame answered. If the app runs in an iframe, reload the tab and try again.';
  }
  if (report.urls.length > 1) {
    // Naming them is what settles "did it even look at the app?", which is the
    // first question when the page is plainly full of fields.
    return `Read ${report.urls.length} frames and found no fields: ${report.urls.join(', ')}`;
  }
  return `Nothing to read in ${report.answered} frame(s) — no fields the agent can see.`;
}

export interface ActOutcome extends FrameReport {
  outcomes: StepOutcome[];
}

/**
 * Runs an action script in the page.
 *
 * Unlike a fill, the steps are stateful: the script stops at its first failure
 * in each frame, so a frame that cannot see the app reports one failed step and
 * nothing more. `mergeStepOutcomes` is what keeps that from reading as a broken
 * script — the frame that did the work is the one that answers for each step.
 */
export async function runAct(
  tabId: number,
  steps: ActionStep[],
  frameId?: number,
): Promise<ActOutcome> {
  const answers = await execute(tabId, { kind: 'act', steps }, frameId);
  const perFrame = answers.flatMap(({ result }) => (result?.kind === 'act' ? [result.outcomes] : []));
  return { ...reportOf(answers), outcomes: mergeStepOutcomes(perFrame) };
}

export interface PickOutcome {
  selectors: FieldSelector[];
  label?: string;
  value?: string;
  /** The frame the click landed in — which is also how a frame gets chosen. */
  frameId: number;
}

/** Resolves once the user clicks in one frame; the other frames cancel themselves. */
export async function runPick(tabId: number, frameId?: number): Promise<PickOutcome | null> {
  const answers = await execute(tabId, { kind: 'pick', sessionId: randomId('pk_') }, frameId);
  for (const answer of answers) {
    const result = answer.result;
    if (result?.kind === 'pick' && result.selectors && result.selectors.length > 0) {
      return {
        selectors: result.selectors,
        label: result.label,
        value: result.value,
        frameId: answer.frameId,
      };
    }
  }
  return null;
}

/**
 * Runs one of the page-world functions.
 *
 * Separate from `execute` because of `world: 'MAIN'`: the form agent must stay
 * in the isolated world — that is where its own globals, its picker overlay and
 * its idempotence flags live — while these exist only to reach the page's.
 * One frame at a time, since "which copy of the app answered" is not a question
 * a call or a replay can be merged across.
 */
async function executeInPage<A extends unknown[], R>(
  tabId: number,
  func: (...args: A) => Promise<R>,
  args: A,
  frameId?: number,
): Promise<R | undefined> {
  let injected;
  try {
    injected = await chrome.scripting.executeScript({
      target: frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] },
      world: 'MAIN',
      func,
      args,
    });
  } catch (error) {
    if (frameId !== undefined && isFrameGone(error)) throw new FrameGoneError(frameId);
    throw error;
  }
  return (injected[0]?.result ?? undefined) as R | undefined;
}

/** Calls `window.<path>(...args)` in the page. `args` omitted reads the value instead. */
export async function runPageCall(
  tabId: number,
  path: string,
  args: unknown[] | undefined,
  frameId?: number,
): Promise<PageOutcome> {
  const outcome = await executeInPage(tabId, pageCall, [path, args], frameId);
  return outcome ?? { kind: 'error', message: 'The frame did not answer.' };
}

/** Evaluates an expression with the page's globals; a strict CSP can refuse it. */
export async function runPageEval(
  tabId: number,
  source: string,
  frameId?: number,
): Promise<PageOutcome> {
  const outcome = await executeInPage(tabId, pageEval, [source], frameId);
  return outcome ?? { kind: 'error', message: 'The frame did not answer.' };
}

/** Re-sends a request through the page's own `fetch`, so its cookies and wrappers apply. */
export async function runReplay(
  tabId: number,
  request: ReplayRequest,
  frameId?: number,
): Promise<ReplayResult> {
  const result = await executeInPage(tabId, pageReplay, [request, DEFAULT_BODY_LIMIT], frameId);
  if (result) return result;
  return {
    ok: false,
    status: 0,
    statusText: '',
    headers: [],
    body: '',
    truncated: false,
    ms: 0,
    error: 'The frame did not answer.',
  };
}

async function execute(
  tabId: number,
  command: Parameters<typeof formAgent>[0],
  frameId?: number,
): Promise<FrameAnswer[]> {
  let injected;
  try {
    injected = await chrome.scripting.executeScript({
      // Naming the frame is what stops a fill meant for the app from also being
      // written into the simulator wrapping it. `allFrames` and `frameIds` are
      // mutually exclusive, hence the branch rather than an extra option.
      target: frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] },
      func: formAgent,
      args: [command],
    });
  } catch (error) {
    if (frameId !== undefined && isFrameGone(error)) throw new FrameGoneError(frameId);
    throw error;
  }
  // Frames that cannot be injected (about:blank, sandboxed) simply return
  // nothing, which arrives as null; normalise so one absent shape reaches the
  // callers rather than two.
  return injected.map((entry) => ({
    frameId: entry.frameId,
    result: (entry.result ?? undefined) as AgentResult | undefined,
  }));
}
