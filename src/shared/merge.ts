/**
 * Deep-merges `source` into `target` without mutating either.
 * Arrays and primitives from `source` replace the target value outright, which
 * is what you want when overriding a field such as `items` or `status`.
 */
export function mergeDeep(target: unknown, source: unknown): unknown {
  if (!isPlainObject(source)) return source;
  if (!isPlainObject(target)) return { ...source };

  const output: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    output[key] = key in target ? mergeDeep(target[key], source[key]) : source[key];
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
