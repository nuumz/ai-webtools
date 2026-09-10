import { describe, expect, it } from 'vitest';
import { applyCase, newProfile, type FormCase } from '../../src/shared/form';
import { pickScreen } from '../../src/inject/run';

const profile = () => {
  const created = newProfile('Customer Info');
  created.fields = [
    { id: 'f1', key: 'firstNameTh', enabled: true, selectors: [], source: { kind: 'literal', value: 'กุลชรี' } },
    { id: 'f2', key: 'lastNameTh', enabled: true, selectors: [], source: { kind: 'template', value: '{{ x }}' } },
  ];
  return created;
};

describe('applyCase', () => {
  const testCase = (values: Record<string, string>): FormCase => ({
    id: 'cs_1',
    profileId: 'pf_1',
    name: 'minor',
    values,
  });

  it('replaces only the fields the case names', () => {
    const applied = applyCase(profile(), testCase({ firstNameTh: 'สมชาย' }));
    expect(applied.fields[0].source).toEqual({ kind: 'literal', value: 'สมชาย' });
    // Untouched, so a field that derives its value keeps deriving it.
    expect(applied.fields[1].source).toEqual({ kind: 'template', value: '{{ x }}' });
  });

  it('keeps a value the case deliberately blanks', () => {
    const applied = applyCase(profile(), testCase({ firstNameTh: '' }));
    expect(applied.fields[0].source).toEqual({ kind: 'literal', value: '' });
  });

  it('leaves the profile alone when no case is active', () => {
    const original = profile();
    expect(applyCase(original, undefined)).toBe(original);
  });
});

describe('pickScreen', () => {
  it('takes the only complete signature', () => {
    expect(pickScreen([{ id: 'a', matched: 1, total: 1 }, { id: 'b', matched: 0, total: 1 }])).toBe('a');
  });

  it('never takes a partial match', () => {
    expect(pickScreen([{ id: 'a', matched: 2, total: 3 }])).toBeUndefined();
  });

  it('prefers the more specific screen when one signature contains the other', () => {
    expect(pickScreen([{ id: 'broad', matched: 1, total: 1 }, { id: 'exact', matched: 2, total: 2 }])).toBe('exact');
  });

  it('refuses to guess between two equally specific screens', () => {
    expect(pickScreen([{ id: 'a', matched: 1, total: 1 }, { id: 'b', matched: 1, total: 1 }])).toBeUndefined();
  });
});
