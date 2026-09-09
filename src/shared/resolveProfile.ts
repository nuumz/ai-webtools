/**
 * Turns a profile into concrete strings for the page.
 *
 * Resolution happens here rather than in the page so the expression engine
 * never ships into a site, and so the panel can show exactly what will be typed.
 */
import { evaluate, identifiers, renderTemplate, templateIdentifiers, type ExprContext } from './expr';
import type { FormProfile, ProfileField, ResolvedFillField } from './form';

export interface ResolveOptions {
  counters?: Record<string, number>;
  now?: () => Date;
  random?: () => number;
}

export interface ResolveResult {
  fields: ResolvedFillField[];
  /** Every field's value, including disabled ones, so the panel can preview them. */
  values: Record<string, string>;
  /** Counters after the run; persist these so the next fill continues the series. */
  counters: Record<string, number>;
  errors: string[];
}

export function resolveProfile(profile: FormProfile, options: ResolveOptions = {}): ResolveResult {
  const counters = { ...(options.counters ?? {}) };
  const errors: string[] = [];
  const values: Record<string, string> = {};

  // A sequence resolves once per run: every field that reads seq('order') in
  // one fill must see the same number, or the form is internally inconsistent.
  const drawn = new Map<string, number>();
  const context: ExprContext = {
    vars: { ...profile.vars },
    seq: (name) => {
      const existing = drawn.get(name);
      if (existing !== undefined) return existing;
      const next = (counters[name] ?? 0) + 1;
      counters[name] = next;
      drawn.set(name, next);
      return next;
    },
    now: options.now,
    random: options.random,
  };

  const { order, cycles } = sortByDependency(profile.fields);
  for (const keys of cycles) {
    errors.push(`Circular reference between ${keys.map((key) => `“${key}”`).join(' and ')}`);
  }

  for (const field of order) {
    try {
      const value = resolveValue(field, context);
      values[field.key] = value;
      context.vars[field.key] = value;
    } catch (error) {
      errors.push(`${field.key || field.id}: ${(error as Error).message}`);
    }
  }

  const fields = profile.fields
    .filter((field) => field.enabled && values[field.key] !== undefined)
    .filter((field) => field.selectors.some((selector) => selector.value.trim().length > 0))
    .map((field) => ({
      key: field.key,
      selectors: field.selectors.filter((selector) => selector.value.trim().length > 0),
      value: values[field.key],
      framePattern: field.framePattern,
      after: field.after,
    }));

  return { fields, values, counters, errors };
}

function resolveValue(field: ProfileField, context: ExprContext): string {
  switch (field.source.kind) {
    case 'literal':
      return field.source.value;
    case 'template':
      return renderTemplate(field.source.value, context);
    case 'ref': {
      const name = field.source.value.trim();
      if (!Object.prototype.hasOwnProperty.call(context.vars, name)) {
        throw new Error(`nothing named “${name}” to copy`);
      }
      return String(context.vars[name] ?? '');
    }
    case 'expr': {
      const value = evaluate(field.source.value, context);
      return value === null ? '' : String(value);
    }
  }
}

/** Kahn's algorithm; whatever is still cyclic is reported rather than filled. */
function sortByDependency(fields: ProfileField[]): { order: ProfileField[]; cycles: string[][] } {
  const byKey = new Map<string, ProfileField>();
  for (const field of fields) if (field.key) byKey.set(field.key, field);

  const dependencies = new Map<string, Set<string>>();
  for (const field of fields) {
    const names = dependencyNames(field).filter((name) => byKey.has(name) && name !== field.key);
    dependencies.set(field.id, new Set(names));
  }

  const resolved = new Set<string>();
  const order: ProfileField[] = [];
  let remaining = [...fields];

  for (;;) {
    const ready = remaining.filter((field) =>
      [...(dependencies.get(field.id) ?? [])].every((name) => resolved.has(name)),
    );
    if (ready.length === 0) break;
    for (const field of ready) {
      order.push(field);
      if (field.key) resolved.add(field.key);
    }
    remaining = remaining.filter((field) => !ready.includes(field));
  }

  const cycles = remaining.length > 0 ? [remaining.map((field) => field.key || field.id)] : [];
  return { order, cycles };
}

function dependencyNames(field: ProfileField): string[] {
  try {
    switch (field.source.kind) {
      case 'ref':
        return [field.source.value.trim()];
      case 'expr':
        return identifiers(field.source.value);
      case 'template':
        return templateIdentifiers(field.source.value);
      case 'literal':
        return [];
    }
  } catch {
    // Unparseable sources have no ordering constraints; the error surfaces on evaluate.
    return [];
  }
}
