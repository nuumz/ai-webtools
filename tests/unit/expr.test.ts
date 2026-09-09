import { describe, expect, it } from 'vitest';
import { ExprError, evaluate, identifiers, renderTemplate } from '../../src/shared/expr';

const context = (vars: Record<string, string | number> = {}) => ({
  vars,
  seq: (name: string) => (name === 'user' ? 7 : 1),
  now: () => new Date('2026-09-09T10:20:30'),
  random: () => 0.5,
});

describe('evaluate', () => {
  it('respects operator precedence', () => {
    expect(evaluate('2 + 3 * 4', context())).toBe(14);
    expect(evaluate('(2 + 3) * 4', context())).toBe(20);
    expect(evaluate('10 - 2 - 3', context())).toBe(5);
  });

  it('reads variables and computes over them', () => {
    expect(evaluate('qty * price', context({ qty: 3, price: '1.5' }))).toBe(4.5);
  });

  it('concatenates when either side is a string', () => {
    expect(evaluate('"a" + 1', context())).toBe('a1');
    expect(evaluate('1 + 1', context())).toBe(2);
  });

  it('short-circuits and handles ternaries', () => {
    expect(evaluate('qty > 2 ? "many" : "few"', context({ qty: 5 }))).toBe('many');
    expect(evaluate('null || "fallback"', context())).toBe('fallback');
  });

  it('exposes only whitelisted functions', () => {
    expect(evaluate('round(2.345, 2)', context())).toBe(2.35);
    expect(evaluate('upper(trim("  ab "))', context())).toBe('AB');
    expect(evaluate('now("YYYY-MM-DD")', context())).toBe('2026-09-09');
    expect(() => evaluate('fetch("http://x")', context())).toThrow(ExprError);
    // `in` would have found these on Object.prototype.
    expect(() => evaluate('constructor', context())).toThrow(ExprError);
    expect(() => evaluate('toString()', context())).toThrow(ExprError);
  });

  it('rejects malformed input instead of guessing', () => {
    expect(() => evaluate('2 +', context())).toThrow(ExprError);
    expect(() => evaluate('"unterminated', context())).toThrow(ExprError);
    expect(() => evaluate('unknownName', context())).toThrow(ExprError);
  });
});

describe('renderTemplate', () => {
  it('substitutes each hole and leaves the rest alone', () => {
    expect(renderTemplate("qa+{{seq('user')}}@dev.local", context())).toBe('qa+7@dev.local');
    expect(renderTemplate('{{upper(first)}} {{last}}', context({ first: 'ada', last: 'L' }))).toBe('ADA L');
    expect(renderTemplate('no holes', context())).toBe('no holes');
  });
});

describe('identifiers', () => {
  it('lists the names an expression reads', () => {
    expect(identifiers('qty * price + shipping').sort()).toEqual(['price', 'qty', 'shipping']);
    expect(identifiers('round(total, 2)')).toEqual(['total']);
  });
});
