import { describe, expect, it } from 'vitest';
import { flattenPayload, matchPayload } from '../../src/shared/payloadCase';
import { recordedToField } from '../../src/shared/form';
import type { ProfileField } from '../../src/shared/form';

const field = (key: string, label?: string): ProfileField => ({
  id: `fd_${key}`,
  key,
  ...(label ? { label } : {}),
  enabled: true,
  selectors: [],
  source: { kind: 'literal', value: '' },
});

describe('flattenPayload', () => {
  it('addresses every scalar by path, arrays included', () => {
    expect(
      flattenPayload({ customer: { names: [{ first: 'KULCHAREE' }], age: 41, vip: false } }),
    ).toEqual([
      { path: 'customer.names.0.first', value: 'KULCHAREE' },
      { path: 'customer.age', value: '41' },
      { path: 'customer.vip', value: 'false' },
    ]);
  });

  it('keeps a null as a blank value rather than dropping the path', () => {
    // A field the API returned empty is exactly the case worth replaying.
    expect(flattenPayload({ middleName: null })).toEqual([{ path: 'middleName', value: '' }]);
  });
});

describe('matchPayload', () => {
  it('prefers the whole path, then the last segment', () => {
    const match = matchPayload(
      [field('firstNameTh'), field('lastNameTh')],
      flattenPayload({ firstNameTh: 'กุลชรี', customer: { lastNameTh: 'ทักษิณ' } }),
    );
    expect(match.values).toEqual({ firstNameTh: 'กุลชรี', lastNameTh: 'ทักษิณ' });
    expect(match.unmatched).toEqual([]);
  });

  it('ignores punctuation and case when the API spells a key differently', () => {
    const match = matchPayload([field('docNumber')], flattenPayload({ doc_number: '3-1008-07249-25-8' }));
    expect(match.values).toEqual({ docNumber: '3-1008-07249-25-8' });
  });

  it('takes the shallowest path when the same name appears twice', () => {
    const match = matchPayload(
      [field('firstName')],
      flattenPayload({ history: [{ firstName: 'OLD' }], firstName: 'NEW' }),
    );
    expect(match.matched).toEqual([{ key: 'firstName', path: 'firstName' }]);
  });

  it('never hands one value to two fields', () => {
    const match = matchPayload([field('title'), field('title2')], flattenPayload({ title: 'MISS' }));
    expect(match.values).toEqual({ title: 'MISS' });
    expect(match.unmatched).toEqual(['title2']);
  });

  it('falls back to the field label when the key is generic', () => {
    const match = matchPayload([field('field1', 'nationality')], flattenPayload({ nationality: 'TH' }));
    expect(match.values).toEqual({ field1: 'TH' });
  });

  it('reports what the payload carried that nothing wanted', () => {
    const match = matchPayload([field('otp')], flattenPayload({ otp: '123456', traceId: 'abc' }));
    expect(match.unused).toEqual(['traceId']);
  });
});

describe('recordedToField', () => {
  it('names a Thai-labelled field after the attribute, not field1', () => {
    // uniqueKey can only build an identifier out of Latin characters, so a Thai
    // label alone would make every field on the form indistinguishable.
    const built = recordedToField(
      { selectors: [{ strategy: 'name', value: 'firstNameTh' }], value: 'กุลชรี', label: 'ชื่อ' },
      [],
    );
    expect(built.key).toBe('firstNameTh');
    expect(built.label).toBe('ชื่อ');
  });

  it('still prefers a label that can produce an identifier', () => {
    const built = recordedToField(
      { selectors: [{ strategy: 'id', value: 'x1' }], value: 'a@b.c', label: 'Email address' },
      [],
    );
    expect(built.key).toBe('emailAddress');
  });
});
