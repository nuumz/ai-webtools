/**
 * Action scripts: a named, ordered list of things to do to the live page —
 * click a button, wait for something to appear, pause.
 *
 * Filling is about values; this is about driving the app. The two share the
 * selector chain (`FieldSelector`) deliberately: the picker already produces
 * one, and a button is found exactly the way a field is.
 */
import { randomId } from './ids';
import type { FieldSelector } from './form';

export type ActionKind =
  /** A real `element.click()` — the app's own handler runs. */
  | 'click'
  /** Hold until the element resolves, or give up at `timeoutMs`. */
  | 'waitFor'
  /** Hold for a fixed time; the last resort when nothing in the DOM marks readiness. */
  | 'waitMs'
  /** Stop the script unless the text is on screen — a checkpoint, not a side effect. */
  | 'assertText';

export interface ActionStep {
  id: string;
  /** What the user called it; the panel and the run report show this, not the selector. */
  label: string;
  kind: ActionKind;
  /** `click` / `waitFor`: how to find the element. Empty for the time/text kinds. */
  selectors: FieldSelector[];
  /** `assertText`: the text that must be present. */
  text?: string;
  /** `waitMs`: how long. `waitFor` / `click`: how long to keep looking. Default 3000. */
  timeoutMs?: number;
  /** Substring of the frame URL, same plain-substring rule as a fill field. */
  framePattern?: string;
}

export interface ActionScript {
  id: string;
  name: string;
  steps: ActionStep[];
}

/** Why a step did not run. Mirrors the fill vocabulary so the panel reads the same. */
export type StepFailure = 'missing' | 'hidden' | 'disabled' | 'timeout' | 'text';

export interface StepOutcome {
  id: string;
  ok: boolean;
  why?: StepFailure;
}

export function newStep(kind: ActionKind): ActionStep {
  return { id: randomId('step-'), label: '', kind, selectors: [] };
}

export function newScript(name: string): ActionScript {
  return { id: randomId('act-'), name, steps: [] };
}

/**
 * Collapses one frame's answer per step across frames.
 *
 * Every frame runs the whole script, so a step whose button lives in the app's
 * iframe is `missing` in the tab's own frame — reporting that as a failure
 * would make a working script look broken. A step that succeeded anywhere
 * succeeded; otherwise the first frame that explained itself gets the word.
 */
export function mergeStepOutcomes(perFrame: StepOutcome[][]): StepOutcome[] {
  const order: string[] = [];
  const merged = new Map<string, StepOutcome>();
  for (const frame of perFrame) {
    for (const outcome of frame) {
      const seen = merged.get(outcome.id);
      if (seen === undefined) {
        order.push(outcome.id);
        merged.set(outcome.id, outcome);
        continue;
      }
      if (!seen.ok && outcome.ok) merged.set(outcome.id, outcome);
    }
  }
  return order.map((id) => merged.get(id)!);
}
