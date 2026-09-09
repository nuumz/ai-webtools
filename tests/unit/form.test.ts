import { describe, expect, it } from 'vitest';
import {
  newProfile,
  pickProfileForUrl,
  recordedToField,
  uniqueKey,
  type FormProfile,
} from '../../src/shared/form';

const profile = (name: string, siteScope?: string): FormProfile => ({
  ...newProfile(name),
  siteScope,
});

describe('uniqueKey', () => {
  it('camel-cases a label into a referenceable name', () => {
    expect(uniqueKey('Confirm password', [])).toBe('confirmPassword');
    expect(uniqueKey('E-mail address', [])).toBe('eMailAddress');
  });

  it('never collides with an existing key', () => {
    expect(uniqueKey('email', ['email'])).toBe('email2');
    expect(uniqueKey('email', ['email', 'email2'])).toBe('email3');
  });

  it('falls back when there is nothing usable', () => {
    expect(uniqueKey('   ', [])).toBe('field');
    expect(uniqueKey('123', [])).toBe('field');
  });
});

describe('recordedToField', () => {
  it('keeps the recorded value and selectors', () => {
    const field = recordedToField(
      { selectors: [{ strategy: 'id', value: 'email' }], value: 'a@b.c', label: 'Email' },
      [],
    );
    expect(field.key).toBe('email');
    expect(field.source).toEqual({ kind: 'literal', value: 'a@b.c' });
    expect(field.selectors).toEqual([{ strategy: 'id', value: 'email' }]);
    expect(field.enabled).toBe(true);
  });

  it('names itself from the selector when there is no label', () => {
    const field = recordedToField({ selectors: [{ strategy: 'name', value: 'qty' }], value: '2' }, ['qty']);
    expect(field.key).toBe('qty2');
  });
});

describe('pickProfileForUrl', () => {
  const shop = profile('Shop', 'https://shop.test/*');
  const admin = profile('Admin', 'https://admin.test/*');

  it('prefers the profile last used on this origin', () => {
    const chosen = pickProfileForUrl([shop, admin], 'https://shop.test/checkout', {
      'https://shop.test': admin.id,
    });
    expect(chosen?.id).toBe(admin.id);
  });

  it('falls back to a profile scoped to the URL', () => {
    expect(pickProfileForUrl([shop, admin], 'https://admin.test/users', {})?.id).toBe(admin.id);
  });

  it('uses the only profile when nothing else identifies one', () => {
    expect(pickProfileForUrl([shop], 'https://other.test/', {})?.id).toBe(shop.id);
    expect(pickProfileForUrl([shop, admin], 'https://other.test/', {})).toBeUndefined();
  });

  it('ignores a remembered id that no longer exists', () => {
    const chosen = pickProfileForUrl([shop, admin], 'https://admin.test/x', {
      'https://admin.test': 'deleted',
    });
    expect(chosen?.id).toBe(admin.id);
  });

  it('survives a URL it cannot parse', () => {
    expect(pickProfileForUrl([shop], 'not a url', {})?.id).toBe(shop.id);
    expect(pickProfileForUrl([], undefined, {})).toBeUndefined();
  });
});
