/**
 * Form profiles: named datasets that know how to find their fields and how to
 * derive values from each other.
 */
import { randomId } from './ids';
import { compilePattern } from './match';
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

/** A field key that is safe to reference from an expression and not already taken. */
export function uniqueKey(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const words = base.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  const camel = words
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
  const cleaned = camel.replace(/^[0-9]+/, '') || 'field';

  if (!taken.has(cleaned)) return cleaned;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${cleaned}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface RecordedFieldInput {
  selectors: FieldSelector[];
  value: string;
  label?: string;
}

export function recordedToField(recorded: RecordedFieldInput, existingKeys: Iterable<string>): ProfileField {
  const base = recorded.label ?? recorded.selectors[0]?.value ?? 'field';
  return {
    ...newField(uniqueKey(base, existingKeys)),
    label: recorded.label,
    selectors: recorded.selectors,
    source: { kind: 'literal', value: recorded.value },
  };
}

/**
 * Which profile a keyboard shortcut should use, in order: the one last used on
 * this origin, then one scoped to the URL, then the only profile there is.
 */
export function pickProfileForUrl(
  profiles: FormProfile[],
  url: string | undefined,
  lastByOrigin: Record<string, string> = {},
): FormProfile | undefined {
  if (profiles.length === 0) return undefined;

  let origin = '';
  try {
    if (url) origin = new URL(url).origin;
  } catch {
    origin = '';
  }

  const remembered = origin ? profiles.find((profile) => profile.id === lastByOrigin[origin]) : undefined;
  if (remembered) return remembered;

  if (url) {
    const scoped = profiles.find(
      (profile) => profile.siteScope?.trim() && compilePattern(profile.siteScope)(url),
    );
    if (scoped) return scoped;
  }

  return profiles.length === 1 ? profiles[0] : undefined;
}
