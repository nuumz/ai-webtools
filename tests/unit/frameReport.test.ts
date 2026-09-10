import { describe, expect, it } from 'vitest';
import { explainEmpty } from '../../src/inject/run';

describe('explainEmpty', () => {
  it('names the failure when a frame threw', () => {
    // The whole point: a thrown agent must not read as an empty page.
    const said = explainEmpty({
      frames: 2,
      answered: 1,
      urls: ['https://simulator/'],
      errors: [{ message: 'TypeError: x is not iterable', url: 'https://app/step' }],
    });
    expect(said).toContain('TypeError: x is not iterable');
    expect(said).toContain('2');
  });

  it('says so when only the top frame ran', () => {
    // An app inside a device simulator always has more than one frame, so this
    // is the shape of "the agent never reached the app at all".
    const said = explainEmpty({ frames: 1, answered: 1, urls: ['https://simulator/'], errors: [] });
    expect(said).toContain('iframe');
  });

  it('names the frames it did read, so the app frame is accounted for', () => {
    const said = explainEmpty({
      frames: 2,
      answered: 2,
      urls: ['https://simulator/', 'https://app/mutual-fund'],
      errors: [],
    });
    expect(said).toContain('https://app/mutual-fund');
    expect(said).not.toContain('iframe');
  });
});
