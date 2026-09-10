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

/**
 * Restricts a field to the part of the screen it belongs to. The KBank wizard
 * repeats คำนำหน้า / ชื่อ / ชื่อกลาง / นามสกุล in a Thai block and an English
 * block, so the label alone is ambiguous and the whole field is discarded.
 */
export interface FieldAnchor {
  /** Text of the section this field sits in, e.g. "ชื่อ-นามสกุล (ไทย)". */
  text: string;
}

/**
 * Holds the fill back until the control is actually ready. A select whose
 * options arrive from the network has none at the moment its step first paints.
 */
export interface FieldReadiness {
  /** An option with this visible text must exist. */
  optionText?: string;
  /** The select must carry at least this many options, blank one included. */
  minOptions?: number;
  /** Default 3000. */
  timeoutMs?: number;
}

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
  anchor?: FieldAnchor;
  waitFor?: FieldReadiness;
  after?: FieldFollowUp;
}

/**
 * How a screen is recognised. A wizard's steps all live at one URL, so the URL
 * cannot say which one is showing — the visible text can. Every entry must be
 * present, which is what lets "ยืนยันตัวตนลูกค้า" tell Customer Info from
 * Service Detail on the same page.
 */
export interface ScreenSignature {
  texts: string[];
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
  /** Recognises the screen these fields belong to, inside a multi-step flow. */
  screen?: ScreenSignature;
}

/**
 * One named set of values for a profile: the same screen filled as a different
 * test case. Values live apart from the profile so a case never carries a copy
 * of the selectors — the screen is defined once and drifts in one place.
 */
export interface FormCase {
  id: string;
  profileId: string;
  name: string;
  /** Field key → the value to type. A key that is absent falls back to the field's own source. */
  values: Record<string, string>;
}

export function newCase(profileId: string, name: string): FormCase {
  return { id: randomId('cs_'), profileId, name, values: {} };
}

/**
 * A name that is not already taken in this profile. Saving twice from the same
 * exchange must never overwrite a case someone has since edited, but two rows
 * reading `GET /api/customer` in the picker are unusable — so the second one
 * says so instead.
 */
export function uniqueCaseName(existing: Iterable<FormCase>, profileId: string, base: string): string {
  const taken = new Set(
    [...existing].filter((entry) => entry.profileId === profileId).map((entry) => entry.name),
  );
  const wanted = base.trim() || 'Case';
  if (!taken.has(wanted)) return wanted;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${wanted} (${suffix})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The values a case would type, as the fill actually sees them. */
export function applyCase(profile: FormProfile, formCase: FormCase | undefined): FormProfile {
  if (!formCase) return profile;
  return {
    ...profile,
    fields: profile.fields.map((field) =>
      field.key in formCase.values
        ? { ...field, source: { kind: 'literal', value: formCase.values[field.key] } }
        : field,
    ),
  };
}

/** The only shape that crosses into the page: values are already resolved. */
export interface ResolvedFillField {
  key: string;
  selectors: FieldSelector[];
  value: string;
  framePattern?: string;
  anchor?: FieldAnchor;
  waitFor?: FieldReadiness;
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
  /*
   * Letters in any script, not just Latin. A widget the markup gives no name to
   * — the bank's dropdowns and dates have neither name nor id — is known only
   * by the Thai caption printed beside it, and forcing that through a Latin
   * filter turned every one of them into `field`, `field2`, `field3`: three
   * fields no one can tell apart in a case, in an export, or against a payload.
   *
   * Marks are letters here: Thai vowels and tone marks are `\p{M}`, so keeping
   * only `\p{L}` silently rewrites the word — สัญชาติ came out as สญชาต.
   */
  const words = base.trim().split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
  /*
   * Lowercasing the whole leading word flattens an attribute name that was
   * already an identifier — `firstNameTh` became `firstnameth`, which is what a
   * case export then shows the user. Only the first character needs to move,
   * unless the word is a shout.
   */
  const lowerLead = (word: string): string =>
    word === word.toUpperCase() ? word.toLowerCase() : word[0].toLowerCase() + word.slice(1);

  const camel = words
    .map((word, index) => (index === 0 ? lowerLead(word) : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
  const cleaned = camel.replace(/^\p{N}+/u, '') || 'field';

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
  anchor?: FieldAnchor;
}

/** uniqueKey can only build an identifier out of Latin letters and digits. */
const hasIdentifierChars = (text: string): boolean => /[A-Za-z0-9]/.test(text);

export function recordedToField(recorded: RecordedFieldInput, existingKeys: Iterable<string>): ProfileField {
  /*
   * A Thai label yields no identifier at all, so every field on a Thai form
   * would be called field1, field2, field3 — unreadable in an expression and
   * unmatchable against a payload. The attribute the selector already found is
   * the English handle the markup gives the field, so prefer it in that case.
   */
  const fromLabel = recorded.label ?? '';
  const fromAttribute =
    recorded.selectors.find(
      (selector) => selector.strategy !== 'css' && selector.strategy !== 'label' && hasIdentifierChars(selector.value),
    )?.value ?? '';
  const base = hasIdentifierChars(fromLabel) ? fromLabel : fromAttribute || fromLabel || 'field';
  return {
    ...newField(uniqueKey(base, existingKeys)),
    label: recorded.label,
    selectors: recorded.selectors,
    // Carried through, or a label repeated in two blocks loses the one thing
    // that told it from its twin.
    ...(recorded.anchor ? { anchor: recorded.anchor } : {}),
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
