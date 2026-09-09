/**
 * A small expression language for field values — enough for
 * `total = qty * price` or `{{firstName}}.{{seq('user')}}@dev.local`, and
 * nothing more.
 *
 * Hand-written on purpose: `eval` and `new Function` are blocked by the MV3
 * CSP anyway, and a whitelist keeps user-authored text from reaching the page
 * as code.
 */

export type ExprValue = string | number | boolean | null;

export interface ExprContext {
  /** Field keys and profile variables, already resolved. */
  vars: Record<string, ExprValue>;
  /** Shared counters: the same name yields the same number for a whole fill run. */
  seq: (name: string) => number;
  /** Injectable for tests. */
  now?: () => Date;
  random?: () => number;
}

export class ExprError extends Error {}

// ---------------------------------------------------------------- tokenizer

type TokenType = 'num' | 'str' | 'ident' | 'op' | 'end';
interface Token {
  type: TokenType;
  value: string;
}

const OPERATORS = [
  '===',
  '!==',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '!',
  '(',
  ')',
  ',',
  '?',
  ':',
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      let value = '';
      i += 1;
      while (i < source.length && source[i] !== char) {
        if (source[i] === '\\' && i + 1 < source.length) {
          value += source[i + 1];
          i += 2;
        } else {
          value += source[i];
          i += 1;
        }
      }
      if (i >= source.length) throw new ExprError('Unterminated string');
      i += 1;
      tokens.push({ type: 'str', value });
      continue;
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      let value = '';
      while (i < source.length && /[0-9.]/.test(source[i])) {
        value += source[i];
        i += 1;
      }
      tokens.push({ type: 'num', value });
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      let value = '';
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) {
        value += source[i];
        i += 1;
      }
      tokens.push({ type: 'ident', value });
      continue;
    }

    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (!operator) throw new ExprError(`Unexpected character “${char}”`);
    tokens.push({ type: 'op', value: operator });
    i += operator.length;
  }

  tokens.push({ type: 'end', value: '' });
  return tokens;
}

// ------------------------------------------------------------------- parser

type Node =
  | { kind: 'literal'; value: ExprValue }
  | { kind: 'ident'; name: string }
  | { kind: 'unary'; op: string; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'ternary'; test: Node; then: Node; other: Node }
  | { kind: 'call'; name: string; args: Node[] };

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.ternary();
    if (this.peek().type !== 'end') throw new ExprError(`Unexpected “${this.peek().value}”`);
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private eat(value: string): boolean {
    if (this.peek().type === 'op' && this.peek().value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expect(value: string): void {
    if (!this.eat(value)) throw new ExprError(`Expected “${value}”`);
  }

  private ternary(): Node {
    const test = this.binary(0);
    if (!this.eat('?')) return test;
    const then = this.ternary();
    this.expect(':');
    return { kind: 'ternary', test, then, other: this.ternary() };
  }

  /** Precedence climbing keeps the whole binary chain in one method. */
  private binary(level: number): Node {
    const levels = [['||'], ['&&'], ['===', '!==', '==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
    if (level >= levels.length) return this.unary();

    let left = this.binary(level + 1);
    for (;;) {
      const token = this.peek();
      if (token.type !== 'op' || !levels[level].includes(token.value)) return left;
      this.index += 1;
      left = { kind: 'binary', op: token.value, left, right: this.binary(level + 1) };
    }
  }

  private unary(): Node {
    if (this.eat('!')) return { kind: 'unary', op: '!', operand: this.unary() };
    if (this.eat('-')) return { kind: 'unary', op: '-', operand: this.unary() };
    return this.primary();
  }

  private primary(): Node {
    const token = this.peek();

    if (this.eat('(')) {
      const node = this.ternary();
      this.expect(')');
      return node;
    }

    if (token.type === 'num') {
      this.index += 1;
      const value = Number(token.value);
      if (Number.isNaN(value)) throw new ExprError(`Bad number “${token.value}”`);
      return { kind: 'literal', value };
    }

    if (token.type === 'str') {
      this.index += 1;
      return { kind: 'literal', value: token.value };
    }

    if (token.type === 'ident') {
      this.index += 1;
      if (token.value === 'true') return { kind: 'literal', value: true };
      if (token.value === 'false') return { kind: 'literal', value: false };
      if (token.value === 'null') return { kind: 'literal', value: null };

      if (this.eat('(')) {
        const args: Node[] = [];
        if (!this.eat(')')) {
          do {
            args.push(this.ternary());
          } while (this.eat(','));
          this.expect(')');
        }
        return { kind: 'call', name: token.value, args };
      }
      return { kind: 'ident', name: token.value };
    }

    throw new ExprError(token.type === 'end' ? 'Unexpected end of expression' : `Unexpected “${token.value}”`);
  }
}

// ---------------------------------------------------------------- evaluator

type BuiltIn = (args: ExprValue[], context: ExprContext) => ExprValue;

const BUILT_INS: Record<string, BuiltIn> = {
  round: ([value, digits]) => {
    const factor = 10 ** Number(digits ?? 0);
    return Math.round(Number(value) * factor) / factor;
  },
  sum: (args) => args.reduce((total: number, value) => total + Number(value ?? 0), 0),
  upper: ([value]) => String(value ?? '').toUpperCase(),
  lower: ([value]) => String(value ?? '').toLowerCase(),
  trim: ([value]) => String(value ?? '').trim(),
  pad: ([value, length, filler]) => String(value ?? '').padStart(Number(length ?? 0), String(filler ?? '0')),
  len: ([value]) => String(value ?? '').length,
  now: ([format], context) => formatDate((context.now ?? (() => new Date()))(), format ? String(format) : undefined),
  randInt: ([min, max], context) => {
    const low = Math.ceil(Number(min ?? 0));
    const high = Math.floor(Number(max ?? 0));
    const random = context.random ?? Math.random;
    return low + Math.floor(random() * (high - low + 1));
  },
  randPick: (args, context) => {
    if (args.length === 0) return null;
    const random = context.random ?? Math.random;
    return args[Math.floor(random() * args.length)];
  },
  uuid: (_args, context) => {
    const random = context.random ?? Math.random;
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const value = Math.floor(random() * 16);
      const digit = char === 'x' ? value : (value & 0x3) | 0x8;
      return digit.toString(16);
    });
  },
  seq: ([name], context) => context.seq(String(name ?? 'default')),
};

export const BUILT_IN_NAMES = Object.keys(BUILT_INS);

function formatDate(date: Date, format?: string): string {
  if (!format) return date.toISOString();
  const parts: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    DD: String(date.getDate()).padStart(2, '0'),
    HH: String(date.getHours()).padStart(2, '0'),
    mm: String(date.getMinutes()).padStart(2, '0'),
    ss: String(date.getSeconds()).padStart(2, '0'),
  };
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => parts[token] ?? token);
}

function evaluateNode(node: Node, context: ExprContext): ExprValue {
  switch (node.kind) {
    case 'literal':
      return node.value;

    case 'ident':
      // `in` would find inherited names like `constructor` and leak the
      // prototype chain into the value space.
      if (!Object.prototype.hasOwnProperty.call(context.vars, node.name)) {
        throw new ExprError(`Unknown name “${node.name}”`);
      }
      return context.vars[node.name];

    case 'unary': {
      const value = evaluateNode(node.operand, context);
      return node.op === '!' ? !truthy(value) : -Number(value);
    }

    case 'binary': {
      const left = evaluateNode(node.left, context);
      // Short-circuit before touching the right-hand side.
      if (node.op === '&&') return truthy(left) ? evaluateNode(node.right, context) : left;
      if (node.op === '||') return truthy(left) ? left : evaluateNode(node.right, context);

      const right = evaluateNode(node.right, context);
      switch (node.op) {
        case '+':
          return typeof left === 'string' || typeof right === 'string'
            ? `${asText(left)}${asText(right)}`
            : Number(left) + Number(right);
        case '-':
          return Number(left) - Number(right);
        case '*':
          return Number(left) * Number(right);
        case '/':
          return Number(left) / Number(right);
        case '%':
          return Number(left) % Number(right);
        case '<':
          return Number(left) < Number(right);
        case '>':
          return Number(left) > Number(right);
        case '<=':
          return Number(left) <= Number(right);
        case '>=':
          return Number(left) >= Number(right);
        case '==':
        case '===':
          return left === right;
        case '!=':
        case '!==':
          return left !== right;
        default:
          throw new ExprError(`Unsupported operator “${node.op}”`);
      }
    }

    case 'ternary':
      return truthy(evaluateNode(node.test, context))
        ? evaluateNode(node.then, context)
        : evaluateNode(node.other, context);

    case 'call': {
      const fn = Object.prototype.hasOwnProperty.call(BUILT_INS, node.name) ? BUILT_INS[node.name] : undefined;
      if (!fn) throw new ExprError(`Unknown function “${node.name}”`);
      return fn(
        node.args.map((arg) => evaluateNode(arg, context)),
        context,
      );
    }
  }
}

const truthy = (value: ExprValue): boolean => Boolean(value);
const asText = (value: ExprValue): string => (value === null ? '' : String(value));

export function evaluate(source: string, context: ExprContext): ExprValue {
  return evaluateNode(new Parser(tokenize(source)).parse(), context);
}

/** Replaces every `{{ … }}` with its evaluated value; the rest is literal text. */
export function renderTemplate(text: string, context: ExprContext): string {
  return text.replace(/\{\{([^}]*)\}\}/g, (_match, source: string) => {
    const trimmed = source.trim();
    if (!trimmed) return '';
    return asText(evaluate(trimmed, context));
  });
}

/** Free variable names an expression reads — the input to dependency ordering. */
export function identifiers(source: string): string[] {
  const found = new Set<string>();
  const walk = (node: Node): void => {
    switch (node.kind) {
      case 'ident':
        found.add(node.name);
        break;
      case 'unary':
        walk(node.operand);
        break;
      case 'binary':
        walk(node.left);
        walk(node.right);
        break;
      case 'ternary':
        walk(node.test);
        walk(node.then);
        walk(node.other);
        break;
      case 'call':
        node.args.forEach(walk);
        break;
      case 'literal':
        break;
    }
  };
  walk(new Parser(tokenize(source)).parse());
  return [...found];
}

/** Same, for a template string: the union over its `{{ … }}` chunks. */
export function templateIdentifiers(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\{\{([^}]*)\}\}/g)) {
    const source = match[1].trim();
    if (!source) continue;
    try {
      for (const name of identifiers(source)) found.add(name);
    } catch {
      // A malformed chunk reports its error at evaluation time, not here.
    }
  }
  return [...found];
}
