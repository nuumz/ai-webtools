/**
 * Builds a test case out of a captured API payload.
 *
 * Deliberately a one-time mapping rather than a live binding: a case is a
 * fixture, and a fixture that silently changes when a new response is recorded
 * is not a test case any more. The panel reads a captured body, this turns it
 * into literal values, and from then on the case is exactly as stable — and as
 * editable — as one saved from the screen.
 */
import { newCase, type FormCase, type FormProfile, type ProfileField } from './form';

export interface PayloadLeaf {
  /** Dotted path, with array indices as segments: `customer.names.0.first`. */
  path: string;
  value: string;
}

/** Every scalar in a JSON document, addressed by path. */
export function flattenPayload(input: unknown, prefix = ''): PayloadLeaf[] {
  if (input === null || input === undefined) {
    return prefix ? [{ path: prefix, value: '' }] : [];
  }
  if (Array.isArray(input)) {
    return input.flatMap((item, index) => flattenPayload(item, prefix ? `${prefix}.${index}` : String(index)));
  }
  if (typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) =>
      flattenPayload(value, prefix ? `${prefix}.${key}` : key),
    );
  }
  return prefix ? [{ path: prefix, value: String(input) }] : [];
}

export interface PayloadMatch {
  /** Field key → value, ready to become a case. */
  values: Record<string, string>;
  matched: { key: string; path: string }[];
  /** Fields the payload said nothing about; they keep their own source. */
  unmatched: string[];
  /** Payload paths no field wanted, so the user can see what was left over. */
  unused: string[];
}

const lastSegment = (path: string): string => path.slice(path.lastIndexOf('.') + 1);
const bare = (text: string): string => text.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

/**
 * Pairs fields with payload leaves, best rule first: the whole path, then the
 * last segment, then both with punctuation and case ignored, then the field's
 * label. A leaf is used once, and the shallowest path wins a tie — a top-level
 * `firstName` is a likelier answer than `history.3.firstName`.
 */
export function matchPayload(fields: ProfileField[], leaves: PayloadLeaf[]): PayloadMatch {
  const depth = (leaf: PayloadLeaf) => leaf.path.split('.').length;
  const pool = [...leaves].sort((left, right) => depth(left) - depth(right));
  const taken = new Set<string>();

  const values: Record<string, string> = {};
  const matched: { key: string; path: string }[] = [];
  const unmatched: string[] = [];

  for (const field of fields) {
    const key = field.key;
    const label = field.label ?? '';
    const rules: ((leaf: PayloadLeaf) => boolean)[] = [
      (leaf) => leaf.path === key,
      (leaf) => lastSegment(leaf.path) === key,
      (leaf) => bare(leaf.path) === bare(key),
      (leaf) => bare(lastSegment(leaf.path)) === bare(key),
      (leaf) => bare(label) !== '' && bare(lastSegment(leaf.path)) === bare(label),
    ];

    let found: PayloadLeaf | undefined;
    for (const rule of rules) {
      found = pool.find((leaf) => !taken.has(leaf.path) && rule(leaf));
      if (found) break;
    }
    if (!found) {
      unmatched.push(key);
      continue;
    }
    taken.add(found.path);
    values[key] = found.value;
    matched.push({ key, path: found.path });
  }

  return {
    values,
    matched,
    unmatched,
    unused: leaves.filter((leaf) => !taken.has(leaf.path)).map((leaf) => leaf.path),
  };
}

/** The whole flow: a captured body plus a profile becomes a named case. */
export function caseFromPayload(
  profile: FormProfile,
  body: unknown,
  name: string,
): { formCase: FormCase; match: PayloadMatch } {
  const match = matchPayload(profile.fields, flattenPayload(body));
  return { formCase: { ...newCase(profile.id, name), values: match.values }, match };
}
