import { describe, expect, it } from 'vitest';
import { mergeStepOutcomes, type StepOutcome } from '../../src/shared/actions';

const ok = (id: string): StepOutcome => ({ id, ok: true });
const failed = (id: string, why: StepOutcome['why']): StepOutcome => ({ id, ok: false, why });

describe('mergeStepOutcomes', () => {
  it('lets the frame that did the work answer for the step', () => {
    // The simulator shell cannot see the app's button; the app's frame can.
    const merged = mergeStepOutcomes([[failed('a', 'missing')], [ok('a'), ok('b')]]);
    expect(merged).toEqual([ok('a'), ok('b')]);
  });

  it('keeps a failure when no frame managed the step', () => {
    const merged = mergeStepOutcomes([[failed('a', 'missing')], [failed('a', 'hidden')]]);
    expect(merged).toEqual([failed('a', 'missing')]);
  });

  it('keeps the order the steps ran in, taking later frames into account', () => {
    const merged = mergeStepOutcomes([[ok('a')], [ok('a'), ok('b'), failed('c', 'timeout')]]);
    expect(merged.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('reports nothing when no frame ran the script', () => {
    expect(mergeStepOutcomes([])).toEqual([]);
  });
});
