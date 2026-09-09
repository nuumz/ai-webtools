/**
 * Capture contract shared by the MAIN world (producer), the service worker
 * (buffer) and the panel (viewer), plus the redaction helpers.
 *
 * Redaction runs in the MAIN world, before a record ever leaves the page, so
 * tokens and PII are never written to a port, to storage, or to the log.
 */

/** Bodies larger than this are stored truncated — a log is not an archive. */
export const MAX_BODY_BYTES = 64 * 1024;
/** Above this, MUTATE_RESPONSE passes through: buffering + reparsing costs more than the mock is worth. */
export const MAX_MUTATE_BYTES = 5 * 1024 * 1024;

export const DEFAULT_REDACT_KEYS = [
  'password',
  'passwd',
  'token',
  'secret',
  'authorization',
  'apikey',
  'api_key',
  'accesskey',
  'citizenid',
  'nationalid',
  'cardno',
  'cardnumber',
  'cvv',
  'pin',
  'otp',
];

export const REDACTED = '«redacted»';

/** Headers dropped unconditionally, regardless of the user's key list. */
const HEADER_DENY_LIST = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
]);

export type Transport = 'fetch' | 'xhr';
/** How the response reached the page — lets the panel exclude replayed traffic from new recordings. */
export type ServedBy = 'network' | 'stub' | 'mutated';
export type Outcome = 'ok' | 'network-error' | 'aborted';

export interface BodySnapshot {
  text: string;
  bytes: number;
  truncated: boolean;
  redacted: boolean;
}

export interface CapturedExchange {
  id: string;
  startedAt: number;
  durationMs: number;
  transport: Transport;
  servedBy: ServedBy;
  outcome: Outcome;
  method: string;
  url: string;
  status: number;
  statusText: string;
  contentType: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: BodySnapshot;
  responseBody?: BodySnapshot;
}

/** What the panel list renders: everything except the bodies, which are fetched on expand. */
export interface ExchangeMeta {
  id: string;
  startedAt: number;
  durationMs: number;
  transport: Transport;
  servedBy: ServedBy;
  outcome: Outcome;
  method: string;
  url: string;
  origin: string;
  pathname: string;
  search: string;
  status: number;
  contentType: string;
  reqBytes: number;
  resBytes: number;
}

/** `crypto.randomUUID` needs a secure context; pages served over plain http do not have one. */
export function newExchangeId(): string {
  const uuid = globalThis.crypto?.randomUUID;
  if (typeof uuid === 'function') return uuid.call(globalThis.crypto);
  return `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function truncateText(text: string): { text: string; bytes: number; truncated: boolean } {
  const bytes = text.length;
  return bytes > MAX_BODY_BYTES
    ? { text: text.slice(0, MAX_BODY_BYTES), bytes, truncated: true }
    : { text, bytes, truncated: false };
}

/** Only text-ish payloads are worth logging; binary is reported by size alone. */
export function isCapturableContentType(contentType: string): boolean {
  if (!contentType) return true; // Unknown: assume text, the truncation cap bounds the damage.
  return /json|text|xml|javascript|x-www-form-urlencoded|graphql/i.test(contentType);
}

export function redactHeaders(
  headers: Record<string, string>,
  keys: string[] = DEFAULT_REDACT_KEYS,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    output[name] = HEADER_DENY_LIST.has(lower) || matchesKey(lower, keys) ? REDACTED : value;
  }
  return output;
}

/** Masks sensitive values in a JSON or urlencoded body. Returns the text untouched otherwise. */
export function redactBody(text: string, keys: string[] = DEFAULT_REDACT_KEYS): { text: string; redacted: boolean } {
  if (!text) return { text, redacted: false };

  try {
    const parsed: unknown = JSON.parse(text);
    let hit = false;
    const walk = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
          if (matchesKey(key.toLowerCase(), keys)) {
            out[key] = REDACTED;
            hit = true;
          } else {
            out[key] = walk(inner);
          }
        }
        return out;
      }
      return value;
    };
    const masked = walk(parsed);
    return hit ? { text: JSON.stringify(masked), redacted: true } : { text, redacted: false };
  } catch {
    // Not JSON — fall through to the urlencoded pass.
  }

  if (!text.includes('=')) return { text, redacted: false };
  let hit = false;
  const masked = text
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const name = decodeURIComponent(pair.slice(0, eq)).toLowerCase();
      if (!matchesKey(name, keys)) return pair;
      hit = true;
      return `${pair.slice(0, eq)}=${encodeURIComponent(REDACTED)}`;
    })
    .join('&');
  return hit ? { text: masked, redacted: true } : { text, redacted: false };
}

export function makeBodySnapshot(text: string, keys?: string[]): BodySnapshot {
  const capped = truncateText(text);
  const { text: safe, redacted } = redactBody(capped.text, keys);
  return { text: safe, bytes: capped.bytes, truncated: capped.truncated, redacted };
}

export function toExchangeMeta(exchange: CapturedExchange): ExchangeMeta {
  let origin = '';
  let pathname = exchange.url;
  let search = '';
  try {
    const parsed = new URL(exchange.url);
    origin = parsed.origin;
    pathname = parsed.pathname;
    search = parsed.search;
  } catch {
    // Keep the raw URL as the pathname when it cannot be parsed.
  }
  return {
    id: exchange.id,
    startedAt: exchange.startedAt,
    durationMs: exchange.durationMs,
    transport: exchange.transport,
    servedBy: exchange.servedBy,
    outcome: exchange.outcome,
    method: exchange.method,
    url: exchange.url,
    origin,
    pathname,
    search,
    status: exchange.status,
    contentType: exchange.contentType,
    reqBytes: exchange.requestBody?.bytes ?? 0,
    resBytes: exchange.responseBody?.bytes ?? 0,
  };
}

function matchesKey(lowerName: string, keys: string[]): boolean {
  return keys.some((key) => key && lowerName.includes(key.toLowerCase()));
}
