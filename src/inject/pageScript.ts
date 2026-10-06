/**
 * The functions the panel runs in the page's OWN world (`world: 'MAIN'`).
 *
 * The form agent runs in the isolated world, where the page's JavaScript is
 * invisible — it can click a button but it cannot call the function behind it.
 * These three can, because `chrome.scripting.executeScript({ world: 'MAIN' })`
 * evaluates them with the page's globals.
 *
 * Same serialisation rule as `formAgent`: Chrome stringifies each one, so every
 * helper must be nested inside it and every import must be type-only.
 */

/** What a page call or an expression answered, already safe to post to the panel. */
export interface PageValue {
  /** `typeof` of the raw value, so `null` and `undefined` do not both read as "nothing". */
  type: string;
  /** JSON where the value survives it, a printed form where it does not (DOM nodes, cycles). */
  text: string;
}

export type PageOutcome =
  | { kind: 'value'; value: PageValue }
  /** The page answered with a rejection or a throw — the app's own error, not ours. */
  | { kind: 'error'; message: string }
  /** Nothing lives at that path. Named separately: a typo and a throw are different bugs. */
  | { kind: 'missing'; path: string };

/**
 * Calls `window.<path>(...args)` — e.g. `__APP__.store.dispatch`.
 *
 * A path call rather than an evaluated string because the page's own CSP
 * governs this world: a page served with `script-src 'self'` blocks
 * `new Function`, and walking a path needs no code generation at all. Reading a
 * value is the same operation with no call: `args` omitted.
 */
export async function pageCall(path: string, args: unknown[] | undefined): Promise<PageOutcome> {
  try {
    const parts = path.split('.').filter((part) => part.length > 0);
    if (parts.length === 0) return { kind: 'missing', path };

    let holder: unknown = window;
    let value: unknown = window;
    for (const part of parts) {
      if (value === null || value === undefined) return { kind: 'missing', path };
      holder = value;
      value = (value as Record<string, unknown>)[part];
    }
    if (value === undefined) return { kind: 'missing', path };

    // `args` absent means "read it"; an empty array still means "call it with
    // nothing", which is a different request on a getter-shaped API.
    const result =
      args === undefined ? value : await (value as (...rest: unknown[]) => unknown).apply(holder, args);
    return { kind: 'value', value: describe(result) };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }

  /**
   * A page's object graph is cyclic far more often than not — a store holds its
   * own subscribers, a DOM node its parent — and `JSON.stringify` throws on the
   * first cycle, losing the whole answer. Marking the repeat keeps the rest.
   */
  function describe(value: unknown): PageValue {
    const type = value === null ? 'null' : typeof value;
    const seen = new WeakSet<object>();
    try {
      const text = JSON.stringify(
        value,
        (_key, entry: unknown) => {
          if (typeof entry !== 'object' || entry === null) return entry;
          if (seen.has(entry)) return '[circular]';
          seen.add(entry);
          return entry;
        },
        2,
      );
      return { type, text: text === undefined ? String(value) : text };
    } catch {
      return { type, text: String(value) };
    }
  }
}

/**
 * Evaluates an expression with the page's globals.
 *
 * This is the escape hatch for reading state that no function exposes, and it
 * is the one thing here a page's CSP can refuse: `new Function` is code
 * generation, and a strict `script-src` blocks it. The refusal is reported as
 * what it is rather than as a broken expression.
 */
export async function pageEval(source: string): Promise<PageOutcome> {
  try {
    const factory = new Function(`"use strict"; return (${source});`) as () => unknown;
    const value = await factory();
    const type = value === null ? 'null' : typeof value;
    let text: string;
    try {
      text = JSON.stringify(value, undefined, 2) ?? String(value);
    } catch {
      text = String(value);
    }
    return { kind: 'value', value: { type, text } };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (/unsafe-eval|Content Security Policy/i.test(message)) {
      return {
        kind: 'error',
        message: `${message} — this page's CSP blocks evaluated code. Use a call path instead.`,
      };
    }
    return { kind: 'error', message };
  }
}

/** One request, replayed from inside the page. */
export interface ReplayRequest {
  url: string;
  method: string;
  headers: [string, string][];
  body?: string;
}

export interface ReplayResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  /** Round trip in ms, measured in the page so it includes the app's own interceptors. */
  ms: number;
  /** The body was cut at the limit; the panel says so rather than showing a truncated body as whole. */
  truncated: boolean;
  /** The fetch itself failed — DNS, CORS, an abort. There is no status to report. */
  error?: string;
}

/**
 * Replays a request with the page's `fetch`.
 *
 * Deliberately the page's fetch and not the panel's: cookies, `Authorization`
 * headers added by the app's own wrapper, and the extension's own interceptor
 * all sit on that path, so a replay exercises what the app really sends. A
 * replay issued from the panel would share none of it.
 */
export async function pageReplay(request: ReplayRequest, limit: number): Promise<ReplayResult> {
  const started = Date.now();
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      credentials: 'include',
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body: text.slice(0, limit),
      truncated: text.length > limit,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: '',
      headers: [],
      body: '',
      truncated: false,
      ms: Date.now() - started,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}
