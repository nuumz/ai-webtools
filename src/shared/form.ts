/**
 * Form profiles: named datasets that know how to find their fields and how to
 * derive values from each other.
 */
import { randomId } from './ids';
import type { FormFillField } from './types';

/** Ordered by how well each survives a re-render, best first. */
export type FieldStrategy = 'testid' | 'id' | 'name' | 'label' | 'aria' | 'placeholder' | 'css';

export interface FieldSelector {
  strategy: FieldStrategy;
  value: string;
}

export type FieldSource =
  /** A fixed string. */
  | { kind: 'literal'; value: string }
  /** Text with `{{ … }}` holes, e.g. `qa+{{seq('user')}}@dev.local`. */
  | { kind: 'template'; value: string }
  /** Mirrors another field, e.g. confirmPassword ← password. */
  | { kind: 'ref'; value: string }
  /** An expression over other fields and vars, e.g. `qty * price`. */
  | { kind: 'expr'; value: string };

export interface FieldFollowUp {
  /** Wait before filling the next field — dependent dropdowns need this. */
  waitMs?: number;
  blur?: boolean;
  click?: boolean;
}

export interface ProfileField {
  id: string;
  /** Stable name other fields refer to. */
  key: string;
  label?: string;
  enabled: boolean;
  selectors: FieldSelector[];
  /** Restricts the field to matching frames; absent means every frame tries it. */
  framePattern?: string;
  source: FieldSource;
  after?: FieldFollowUp;
}

export interface FormProfile {
  id: string;
  name: string;
  /** URL pattern this profile belongs to, matched with compilePattern. */
  siteScope?: string;
  vars: Record<string, string>;
  fields: ProfileField[];
  /** Set when the profile belongs with a recorded story. */
  storyId?: string;
}

/** The only shape that crosses into the page: values are already resolved. */
export interface ResolvedFillField {
  key: string;
  selectors: FieldSelector[];
  value: string;
  framePattern?: string;
  after?: FieldFollowUp;
}

export function newProfile(name: string): FormProfile {
  return { id: randomId('pf_'), name, vars: {}, fields: [] };
}

export function newField(key = ''): ProfileField {
  return {
    id: randomId('fd_'),
    key,
    enabled: true,
    selectors: [{ strategy: 'css', value: '' }],
    source: { kind: 'literal', value: '' },
  };
}

/** Keeps day-one data working: the old flat list becomes a "Default" profile. */
export function migrateFormFillFields(fields: FormFillField[]): FormProfile {
  const profile = newProfile('Default');
  profile.fields = fields.map((field, index) => ({
    ...newField(keyFromSelector(field.selector, index)),
    selectors: [{ strategy: 'css', value: field.selector }],
    source: { kind: 'literal', value: field.value },
  }));
  return profile;
}

function keyFromSelector(selector: string, index: number): string {
  const cleaned = selector.replace(/^[#.\[]+/, '').replace(/[^A-Za-z0-9_$]/g, '');
  return cleaned || `field${index + 1}`;
}

export function describeSelector(selectors: FieldSelector[]): string {
  const first = selectors.find((selector) => selector.value.trim().length > 0);
  if (!first) return 'no selector';
  return first.strategy === 'css' ? first.value : `${first.strategy}=${first.value}`;
}
