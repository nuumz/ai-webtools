import { describe, expect, it } from 'vitest';
import { explainEmpty, reportOf } from '../../src/inject/run';

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

describe('reportOf', () => {
  it('counts a frame that returned nothing without reading through it', () => {
    // executeScript reports an uninjectable frame as `result: null`, and null
    // is not undefined — testing only for undefined threw on `.kind`, which is
    // what made both Fill and Read the page fail outright.
    const report = reportOf([
      null,
      undefined,
      { kind: 'record', fields: [], url: 'https://app/step' },
      { kind: 'error', message: 'TypeError: boom', url: 'https://app/other' },
    ]);
    expect(report).toEqual({
      frames: 4,
      answered: 1,
      urls: ['https://app/step'],
      errors: [{ message: 'TypeError: boom', url: 'https://app/other' }],
    });
  });
});
