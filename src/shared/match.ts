import type { MutationRule } from './types';

interface UrlPatternLike {
  test(input: string, baseURL?: string): boolean;
}
type UrlPatternCtor = new (init: string | { pathname?: string }, baseURL?: string) => UrlPatternLike;

const NativeURLPattern: UrlPatternCtor | undefined = (
  globalThis as unknown as { URLPattern?: UrlPatternCtor }
).URLPattern;

export interface CompiledRule extends MutationRule {
  /** Pre-compiled matcher, built once per storage change instead of per request. */
  matches: (absoluteUrl: string) => boolean;
}

/**
 * Builds a matcher for a rule pattern. `URLPattern` is used when the browser
 * exposes it (Chrome/Edge 95+); otherwise a glob → RegExp fallback is used so
 * the extension keeps working on older runtimes.
 */
export function compilePattern(pattern: string): (absoluteUrl: string) => boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return () => false;

  const isFullUrl = trimmed.includes('://');
  const isPathname = trimmed.startsWith('/');

  if (NativeURLPattern && (isFullUrl || isPathname)) {
    try {
      const compiled = isFullUrl
        ? new NativeURLPattern(trimmed)
        : new NativeURLPattern({ pathname: trimmed });
      return (absoluteUrl) => {
        try {
          return compiled.test(absoluteUrl);
        } catch {
          return false;
        }
      };
    } catch {
      // Malformed pattern — fall through to the glob matcher.
    }
  }

  const regex = globToRegExp(trimmed);
  if (isPathname) {
    return (absoluteUrl) => {
      try {
        return regex.test(new URL(absoluteUrl).pathname);
      } catch {
        return false;
      }
    };
  }
  if (isFullUrl) return (absoluteUrl) => regex.test(absoluteUrl);

  // Bare text: treat it as a substring (or glob) match on the whole URL.
  return trimmed.includes('*')
    ? (absoluteUrl) => regex.test(absoluteUrl)
    : (absoluteUrl) => absoluteUrl.includes(trimmed);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function compileRules(rules: MutationRule[]): CompiledRule[] {
  return rules
    .filter((rule) => rule.isActive)
    .map((rule) => ({ ...rule, matches: compilePattern(rule.urlPattern) }));
}

export function findRule(
  rules: CompiledRule[],
  absoluteUrl: string,
  method: string,
): CompiledRule | undefined {
  const upper = method.toUpperCase();
  return rules.find((rule) => (rule.method === 'ANY' || rule.method === upper) && rule.matches(absoluteUrl));
}

export function toAbsoluteUrl(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}
