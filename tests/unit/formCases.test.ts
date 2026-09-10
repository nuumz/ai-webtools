import { describe, expect, it } from 'vitest';
import {
  applyCase,
  newProfile,
  recordedToField,
  uniqueCaseName,
  uniqueKey,
  type FormCase,
} from '../../src/shared/form';
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

describe('uniqueCaseName', () => {
  const existing: FormCase[] = [
    { id: 'a', profileId: 'pf_1', name: 'GET /api/customer', values: {} },
    { id: 'b', profileId: 'pf_1', name: 'GET /api/customer (2)', values: {} },
    { id: 'c', profileId: 'pf_2', name: 'GET /api/customer', values: {} },
  ];

  it('leaves a free name alone', () => {
    expect(uniqueCaseName(existing, 'pf_1', 'POST /api/session')).toBe('POST /api/session');
  });

  it('walks past the names already taken in that profile', () => {
    expect(uniqueCaseName(existing, 'pf_1', 'GET /api/customer')).toBe('GET /api/customer (3)');
  });

  it('does not collide across profiles', () => {
    // Another profile's case is a different screen entirely.
    expect(uniqueCaseName(existing, 'pf_3', 'GET /api/customer')).toBe('GET /api/customer');
  });

  it('falls back when the name is blank', () => {
    expect(uniqueCaseName([], 'pf_1', '   ')).toBe('Case');
  });
});


describe('uniqueKey on a form with no Latin in it', () => {
  it('names a field after the caption a person reads', () => {
    // The bank's dropdowns and dates carry neither name nor id, so the Thai
    // caption is the only handle there is. Dropping it made every such field
    // `field`, `field2`, `field3` — indistinguishable in a case or a payload.
    expect(uniqueKey('ประเภทเอกสารสำคัญ', [])).toBe('ประเภทเอกสารสำคัญ');
  });

  it('still tells two Thai fields apart', () => {
    const keys: string[] = [];
    for (const caption of ['สัญชาติ', 'สัญชาติ']) keys.push(uniqueKey(caption, keys));
    expect(keys).toEqual(['สัญชาติ', 'สัญชาติ2']);
  });

  it('leaves a Latin identifier exactly as it was', () => {
    expect(uniqueKey('firstNameTh', [])).toBe('firstNameTh');
    expect(uniqueKey('Email address', [])).toBe('emailAddress');
  });

  it('prefers the markup handle over the caption when there is one', () => {
    // `docNo` matches a payload; `เลขที่เอกสารสำคัญ` does not.
    const built = recordedToField(
      { selectors: [{ strategy: 'name', value: 'docNo' }], value: '3-1', label: 'เลขที่เอกสารสำคัญ' },
      [],
    );
    expect(built.key).toBe('docNo');
  });

  it('falls back to the caption when the markup gives no handle', () => {
    const built = recordedToField(
      { selectors: [{ strategy: 'label', value: 'ประเภทเอกสารสำคัญ' }], value: 'บัตรประชาชน', label: 'ประเภทเอกสารสำคัญ' },
      [],
    );
    expect(built.key).toBe('ประเภทเอกสารสำคัญ');
  });
});
