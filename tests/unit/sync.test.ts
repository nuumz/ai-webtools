import { describe, expect, it } from 'vitest';
import { MAX_ITEM_BYTES, chunkRecords, pruneOrigins, stableHash } from '../../src/shared/sync';

describe('stableHash', () => {
  it('ignores key order, so a push and its echo compare equal', () => {
    expect(stableHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(stableHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
  });

  it('still notices a real change', () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
    expect(stableHash([1, 2])).not.toBe(stableHash([2, 1]));
  });

  it('treats undefined fields as absent', () => {
    expect(stableHash({ a: 1, b: undefined })).toBe(stableHash({ a: 1 }));
  });
});

describe('pruneOrigins', () => {
  const origins = (count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_, index) => [`https://site${index}.test`, `p${index}`]));

  it('leaves a small map alone', () => {
    const small = origins(3);
    expect(pruneOrigins(small)).toBe(small);
  });

  it('keeps the most recent entries when it overflows', () => {
    const pruned = pruneOrigins(origins(60), 50);
    expect(Object.keys(pruned)).toHaveLength(50);
    expect(pruned['https://site59.test']).toBe('p59');
    expect(pruned['https://site0.test']).toBeUndefined();
  });
});

describe('chunkRecords', () => {
  it('writes one item per record so a fat rule cannot sink the rest', () => {
    const { items, skipped } = chunkRecords('rule:', [
      { id: 'a', name: 'small', payload: { x: 1 } },
      { id: 'b', name: 'also small' },
    ]);
    expect(Object.keys(items)).toEqual(['rule:a', 'rule:b']);
    expect(skipped).toEqual([]);
  });

  it('skips a record that cannot fit in one sync item, by name', () => {
    const { items, skipped } = chunkRecords('rule:', [
      { id: 'big', name: 'huge rule', payload: 'x'.repeat(MAX_ITEM_BYTES) },
      { id: 'ok', name: 'fine' },
    ]);
    expect(Object.keys(items)).toEqual(['rule:ok']);
    expect(skipped).toEqual(['huge rule']);
  });
});
