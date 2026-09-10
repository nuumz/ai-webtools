import { describe, expect, it } from 'vitest';
import { MAX_ITEM_BYTES, chunkRecords, mergeMirror, pruneOrigins, stableHash } from '../../src/shared/sync';

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

describe('mergeMirror', () => {
  const rules = (...ids: string[]) => ids.map((id) => ({ id }));

  it('keeps a record sync never carried, so a fat mock is not deleted by a pull', () => {
    // 'big' was skipped by chunkRecords, so it never reached sync.
    const merged = mergeMirror('rule:', rules('small', 'big'), rules('small'), new Set(['rule:small']));
    expect(merged.map((rule) => rule.id)).toEqual(['small', 'big']);
  });

  it('still applies a real remote deletion', () => {
    const merged = mergeMirror('rule:', rules('a', 'b'), rules('a'), new Set(['rule:a', 'rule:b']));
    expect(merged.map((rule) => rule.id)).toEqual(['a']);
  });

  it('deletes nothing before this device has ever pushed', () => {
    const merged = mergeMirror('rule:', rules('a', 'b'), rules('c'), undefined);
    expect(merged.map((rule) => rule.id)).toEqual(['a', 'b', 'c']);
  });

  it('takes the remote copy of a record both sides hold, in local order', () => {
    const merged = mergeMirror(
      'rule:',
      [{ id: 'a', label: 'local' }, { id: 'b', label: 'local' }],
      [{ id: 'b', label: 'remote' }, { id: 'a', label: 'remote' }],
      new Set(['rule:a', 'rule:b']),
    );
    expect(merged).toEqual([{ id: 'a', label: 'remote' }, { id: 'b', label: 'remote' }]);
  });
});
