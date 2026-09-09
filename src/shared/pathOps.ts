/**
 * Targeted edits to a JSON body, for the cases a whole-object deep merge
 * cannot express: changing one array element, deleting a key, appending to a
 * list.
 *
 * Deliberately a dot-path, not full JSONPath — filters and recursive descent
 * would be a parser project, and every real edit fits in this much.
 * Everything here is synchronous, because the XHR response getters that use it
 * are synchronous.
 */
import { mergeDeep } from './merge';

export type PathOp =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'delete'; path: string }
  /** Appends to the array at `path`. */
  | { op: 'append'; path: string; value: unknown }
  /** Deep-merges `value` into whatever sits at `path`. */
  | { op: 'merge'; path: string; value: unknown }
  | { op: 'copy'; from: string; path: string };

type Segment = { kind: 'key'; key: string } | { kind: 'index'; index: number } | { kind: 'wildcard' };

/** `data.items[0].price`, `items[*].inStock`, `user.name` */
export function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];
  for (const raw of path.split('.')) {
    if (!raw) continue;
    const name = raw.replace(/\[.*$/, '');
    if (name) segments.push({ kind: 'key', key: name });

    for (const match of raw.matchAll(/\[([^\]]*)\]/g)) {
      const inner = match[1].trim();
      if (inner === '*') segments.push({ kind: 'wildcard' });
      else segments.push({ kind: 'index', index: Number(inner) });
    }
  }
  return segments;
}

export function getPath(input: unknown, path: string): unknown {
  const found = collect(input, parsePath(path));
  return found.length === 0 ? undefined : found[0];
}

/** Applies every op in order, returning a new value; `undefined` ops are the identity. */
export function applyOps(input: unknown, ops?: PathOp[]): unknown {
  if (!ops || ops.length === 0) return input;

  let current = input;
  for (const op of ops) {
    try {
      current = applyOne(current, op);
    } catch {
      // A bad path must not take the whole response down with it.
    }
  }
  return current;
}

function applyOne(input: unknown, op: PathOp): unknown {
  const segments = parsePath(op.path);
  if (segments.length === 0) return input;

  switch (op.op) {
    case 'set':
      return update(input, segments, () => op.value);
    case 'delete':
      return remove(input, segments);
    case 'append':
      return update(input, segments, (existing) =>
        Array.isArray(existing) ? [...existing, op.value] : [op.value],
      );
    case 'merge':
      return update(input, segments, (existing) => mergeDeep(existing, op.value));
    case 'copy': {
      const value = getPath(input, op.from);
      return update(input, segments, () => value);
    }
  }
}

/** Every value a (possibly wildcarded) path points at. */
function collect(input: unknown, segments: Segment[]): unknown[] {
  let level: unknown[] = [input];

  for (const segment of segments) {
    const next: unknown[] = [];
    for (const value of level) {
      if (value === null || value === undefined) continue;
      if (segment.kind === 'key') {
        if (typeof value === 'object') next.push((value as Record<string, unknown>)[segment.key]);
      } else if (segment.kind === 'index') {
        if (Array.isArray(value)) next.push(value[segment.index]);
      } else {
        if (Array.isArray(value)) next.push(...value);
        else if (typeof value === 'object') next.push(...Object.values(value as object));
      }
    }
    level = next;
  }
  return level;
}

/** Rebuilds the container along the path, leaving the original untouched. */
function update(input: unknown, segments: Segment[], change: (existing: unknown) => unknown): unknown {
  const [segment, ...rest] = segments;

  if (segment.kind === 'wildcard') {
    if (Array.isArray(input)) {
      return input.map((item) => (rest.length === 0 ? change(item) : update(item, rest, change)));
    }
    if (isRecord(input)) {
      const output: Record<string, unknown> = { ...input };
      for (const key of Object.keys(output)) {
        output[key] = rest.length === 0 ? change(output[key]) : update(output[key], rest, change);
      }
      return output;
    }
    return input;
  }

  if (segment.kind === 'index') {
    const array = Array.isArray(input) ? [...input] : [];
    const existing = array[segment.index];
    array[segment.index] = rest.length === 0 ? change(existing) : update(existing, rest, change);
    return array;
  }

  const record: Record<string, unknown> = isRecord(input) ? { ...input } : {};
  const existing = record[segment.key];
  record[segment.key] = rest.length === 0 ? change(existing) : update(existing, rest, change);
  return record;
}

function remove(input: unknown, segments: Segment[]): unknown {
  const [segment, ...rest] = segments;

  if (rest.length > 0) {
    return update(input, [segment], (existing) => remove(existing, rest));
  }

  if (segment.kind === 'wildcard') {
    if (Array.isArray(input)) return [];
    if (isRecord(input)) return {};
    return input;
  }

  if (segment.kind === 'index') {
    if (!Array.isArray(input)) return input;
    return input.filter((_, index) => index !== segment.index);
  }

  if (!isRecord(input)) return input;
  const output = { ...input };
  delete output[segment.key];
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
