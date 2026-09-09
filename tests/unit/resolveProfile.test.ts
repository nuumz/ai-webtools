import { describe, expect, it } from 'vitest';
import { newField, newProfile, type FormProfile, type ProfileField } from '../../src/shared/form';
import { resolveProfile } from '../../src/shared/resolveProfile';

const withFields = (fields: Partial<ProfileField>[]): FormProfile => ({
  ...newProfile('test'),
  fields: fields.map((field) => ({ ...newField(field.key ?? 'k'), ...field })),
});

const selector = [{ strategy: 'css' as const, value: '#x' }];

describe('resolveProfile', () => {
  it('resolves dependencies in order, whatever the field order', () => {
    const profile = withFields([
      { key: 'total', source: { kind: 'expr', value: 'qty * price' }, selectors: selector },
      { key: 'qty', source: { kind: 'literal', value: '3' }, selectors: selector },
      { key: 'price', source: { kind: 'literal', value: '1.5' }, selectors: selector },
    ]);
    const result = resolveProfile(profile);
    expect(result.errors).toEqual([]);
    expect(result.values.total).toBe('4.5');
  });

  it('copies a value with ref', () => {
    const profile = withFields([
      { key: 'password', source: { kind: 'literal', value: 'hunter2' }, selectors: selector },
      { key: 'confirmPassword', source: { kind: 'ref', value: 'password' }, selectors: selector },
    ]);
    expect(resolveProfile(profile).values.confirmPassword).toBe('hunter2');
  });

  it('draws a sequence once per run and continues next time', () => {
    const profile = withFields([
      { key: 'email', source: { kind: 'template', value: "qa+{{seq('user')}}@dev.local" }, selectors: selector },
      { key: 'username', source: { kind: 'template', value: "qa{{seq('user')}}" }, selectors: selector },
    ]);

    const first = resolveProfile(profile);
    expect(first.values).toEqual({ email: 'qa+1@dev.local', username: 'qa1' });
    expect(first.counters).toEqual({ user: 1 });

    const second = resolveProfile(profile, { counters: first.counters });
    expect(second.values.email).toBe('qa+2@dev.local');
    expect(second.values.username).toBe('qa2');
  });

  it('reports a cycle instead of looping forever', () => {
    const profile = withFields([
      { key: 'a', source: { kind: 'ref', value: 'b' }, selectors: selector },
      { key: 'b', source: { kind: 'ref', value: 'a' }, selectors: selector },
    ]);
    const result = resolveProfile(profile);
    expect(result.errors[0]).toMatch(/Circular/);
    expect(result.fields).toEqual([]);
  });

  it('reports a bad expression against the field that owns it', () => {
    const profile = withFields([
      { key: 'total', source: { kind: 'expr', value: 'qty *' }, selectors: selector },
    ]);
    expect(resolveProfile(profile).errors[0]).toMatch(/^total:/);
  });

  it('skips disabled fields and fields with no selector, but still resolves them', () => {
    const profile = withFields([
      { key: 'base', source: { kind: 'literal', value: '2' }, enabled: false, selectors: selector },
      { key: 'doubled', source: { kind: 'expr', value: 'base * 2' }, selectors: selector },
      { key: 'noSelector', source: { kind: 'literal', value: 'x' }, selectors: [{ strategy: 'css', value: '' }] },
    ]);
    const result = resolveProfile(profile);
    expect(result.values.base).toBe('2');
    expect(result.fields.map((field) => field.key)).toEqual(['doubled']);
  });
});
