// MAIN world: patches the page's own `fetch` and `XMLHttpRequest` so requests
// and responses can be mutated on the fly before the app's framework sees them,
// and so every exchange can be mirrored to the panel's network log.
import {
  MAX_BODY_BYTES,
  MAX_MUTATE_BYTES,
  isCapturableContentType,
  makeBodySnapshot,
  newExchangeId,
  redactHeaders,
  type CapturedExchange,
  type Outcome,
  type ServedBy,
} from '../shared/capture';
import { compilePattern, compileRules, findRule, toAbsoluteUrl, type CompiledRule } from '../shared/match';
import { mergeDeep } from '../shared/merge';
import { randomId } from '../shared/ids';
import { bodyKeyForHit } from '../shared/story';
import {
  BODY_REPLY_EVENT,
  BODY_REQUEST_EVENT,
  CAPTURE_EVENT,
  DEFAULT_SETTINGS,
  REQUEST_EVENT,
  SYNC_EVENT,
  type MutationRule,
  type PageConfig,
  type Settings,
} from '../shared/types';

const INSTALL_FLAG = '__DEV_TOOL_INTERCEPTOR_INSTALLED__';
const globalScope = window as unknown as Record<string, unknown>;
if (globalScope[INSTALL_FLAG]) {
  // Already patched in this frame (e.g. re-injected script) — do nothing.
} else {
  globalScope[INSTALL_FLAG] = true;
  install();
}

function install(): void {
  let settings: Settings = DEFAULT_SETTINGS;
  let activeRules: CompiledRule[] = [];
  let strictMatchers: ((url: string) => boolean)[] = [];
  /** How many times each story entry has answered in THIS frame. */
  const hits = new Map<string, number>();
  const bodyCache = new Map<string, string>();
  const pendingBodies = new Map<string, (text: string | undefined) => void>();

  window.addEventListener(SYNC_EVENT, ((event: CustomEvent<string>) => {
    try {
      const parsed: unknown = JSON.parse(event.detail ?? '[]');
      // A bare array is the v1 payload shape; still accepted so older callers keep working.
      const config: PageConfig = Array.isArray(parsed)
        ? { version: 2, settings: DEFAULT_SETTINGS, rules: parsed as MutationRule[] }
        : (parsed as PageConfig);
      settings = config.settings ?? DEFAULT_SETTINGS;
      // Story entries are rule-shaped and carry a lower priority, so the sort
      // inside compileRules is what makes hand-written rules win.
      activeRules = compileRules([...(config.rules ?? []), ...(config.storyRules ?? [])]);
      strictMatchers = (config.strictPatterns ?? []).map(compilePattern);
      // Rules changed, so sequence positions no longer mean anything.
      hits.clear();
    } catch (err) {
      console.error('[Interceptor] Could not read config:', err);
      settings = DEFAULT_SETTINGS;
      activeRules = [];
      strictMatchers = [];
    }
  }) as EventListener);

  window.addEventListener(BODY_REPLY_EVENT, ((event: CustomEvent<string>) => {
    try {
      const { requestId, text } = JSON.parse(event.detail ?? '{}') as {
        requestId: string;
        text: string | null;
      };
      const resolve = pendingBodies.get(requestId);
      if (!resolve) return;
      pendingBodies.delete(requestId);
      resolve(typeof text === 'string' ? text : undefined);
    } catch {
      // Malformed reply: the pending request falls back to its timeout.
    }
  }) as EventListener);

  // The bridge may have pushed before this listener existed — ask for a resend.
  window.dispatchEvent(new CustomEvent(REQUEST_EVENT));

  const log = (message: string, ...rest: unknown[]) =>
    console.log(`%c[Interceptor]%c ${message}`, 'color:#6366f1;font-weight:bold', '', ...rest);

  // ==========================================
  // Capture: batched hand-off to the ISOLATED bridge
  // ==========================================
  const FLUSH_MS = 100;
  const FLUSH_MAX = 20;
  let queue: CapturedExchange[] = [];
  let flushTimer: number | undefined;

  const flush = (): void => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    try {
      window.dispatchEvent(new CustomEvent(CAPTURE_EVENT, { detail: JSON.stringify(batch) }));
    } catch (err) {
      console.error('[Interceptor] Could not emit capture batch:', err);
    }
  };

  const emit = (exchange: CapturedExchange): void => {
    if (!settings.captureEnabled) return;
    queue.push(exchange);
    if (queue.length >= FLUSH_MAX) flush();
    else if (flushTimer === undefined) flushTimer = window.setTimeout(flush, FLUSH_MS);
  };

  const snapshot = (text: string | undefined) =>
    text === undefined ? undefined : makeBodySnapshot(text, settings.redactKeys);

  const findMatch = (url: string, method: string): CompiledRule | undefined =>
    settings.enabled ? findRule(activeRules, url, method) : undefined;

  const BODY_TIMEOUT_MS = 3000;

  /** Asks the ISOLATED bridge for a stored body; resolves undefined if it cannot be had. */
  const fetchStoredBody = (bodyKey: string): Promise<string | undefined> => {
    const cached = bodyCache.get(bodyKey);
    if (cached !== undefined) return Promise.resolve(cached);

    return new Promise<string | undefined>((resolve) => {
      const requestId = randomId('bq_');
      const timer = setTimeout(() => {
        pendingBodies.delete(requestId);
        resolve(undefined);
      }, BODY_TIMEOUT_MS);

      pendingBodies.set(requestId, (text) => {
        clearTimeout(timer);
        if (text !== undefined) bodyCache.set(bodyKey, text);
        resolve(text);
      });

      window.dispatchEvent(
        new CustomEvent(BODY_REQUEST_EVENT, { detail: JSON.stringify({ requestId, bodyKey }) }),
      );
    });
  };

  /**
   * The body a stub should serve. Inline payloads resolve immediately; story
   * entries walk their recorded sequence. `undefined` means "do not stub" — the
   * caller falls through to the real network rather than inventing a response.
   */
  const resolveStubBody = async (rule: CompiledRule): Promise<string | undefined> => {
    if (!rule.bodyKeys || rule.bodyKeys.length === 0) return JSON.stringify(rule.payload ?? {});

    const seen = hits.get(rule.id) ?? 0;
    const bodyKey = bodyKeyForHit(rule.bodyKeys, rule.cycle ?? 'stick-last', seen);
    if (bodyKey === undefined) return undefined;

    const text = await fetchStoredBody(bodyKey);
    if (text === undefined) return undefined;
    hits.set(rule.id, seen + 1);
    return text;
  };

  /** A strict story answers 501 for anything it does not cover, instead of falling through. */
  const isStrictMiss = (url: string): boolean =>
    settings.enabled && strictMatchers.some((matches) => matches(url));

  const strictBody = (url: string): string =>
    JSON.stringify({ error: 'not-in-story', message: 'No story entry matches this request.', url });

  /** Applies the rule payload to a JSON string, returning null when it is not JSON. */
  const mutateJsonText = (raw: string, rule: CompiledRule): string | null => {
    try {
      return JSON.stringify(mergeDeep(JSON.parse(raw), rule.payload));
    } catch {
      return null;
    }
  };

  // ==========================================
  // 1. Fetch interceptor
  // ==========================================
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const startedAt = Date.now();
    const started = performance.now();
    const capture = settings.captureEnabled;

    let rule: CompiledRule | undefined;
    let absoluteUrl = '';
    let method = 'GET';
    try {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      absoluteUrl = toAbsoluteUrl(rawUrl, location.href);
      method = (
        init?.method ??
        (typeof input === 'object' && 'method' in input ? input.method : 'GET')
      ).toUpperCase();
      rule = findMatch(absoluteUrl, method);
    } catch (err) {
      console.error('[Interceptor] Rule lookup failed:', err);
    }

    // Nothing to do at all: hand straight to the network.
    if (!rule && !capture && !isStrictMiss(absoluteUrl)) return nativeFetch(input, init);

    const requestHeaders = capture ? readRequestHeaders(input, init) : undefined;
    let requestText = capture ? await readRequestBody(input, init) : undefined;

    const finish = (
      response: Response | undefined,
      servedBy: ServedBy,
      outcome: Outcome,
      responseText?: string,
    ): void => {
      if (!capture) return;
      emit({
        id: newExchangeId(),
        startedAt,
        durationMs: Math.round(performance.now() - started),
        transport: 'fetch',
        servedBy,
        outcome,
        method,
        url: absoluteUrl,
        status: response?.status ?? 0,
        statusText: response?.statusText ?? '',
        contentType: response?.headers.get('content-type') ?? '',
        requestHeaders: requestHeaders && redactHeaders(requestHeaders, settings.redactKeys),
        responseHeaders:
          response && redactHeaders(headersToObject(response.headers), settings.redactKeys),
        requestBody: snapshot(requestText),
        responseBody: snapshot(responseText),
      });
    };

    // --- Full stub: never touch the network.
    if (rule?.type === 'STUB') {
      const body = await resolveStubBody(rule);
      if (body !== undefined) {
        log(`${rule.storyId ? 'Replayed' : 'Stubbed'} ${absoluteUrl}`, rule.label ?? rule.payload);
        const stubbed = new Response(body, {
          status: rule.status ?? 200,
          headers: {
            'Content-Type': rule.contentType || 'application/json',
            'X-Intercepted': rule.storyId ? 'STORY' : 'STUB',
          },
        });
        finish(stubbed, 'stub', 'ok', body);
        return stubbed;
      }
      // No body to serve (missing, or a `once` sequence ran out): behave as a miss.
      rule = undefined;
    }

    // --- Strict story: a request it does not cover must not silently reach the backend.
    if (!rule && isStrictMiss(absoluteUrl)) {
      const body = strictBody(absoluteUrl);
      log(`Strict miss ${absoluteUrl}`);
      const refused = new Response(body, {
        status: 501,
        headers: { 'Content-Type': 'application/json', 'X-Intercepted': 'STRICT' },
      });
      finish(refused, 'stub', 'ok', body);
      return refused;
    }

    // --- Request mutation: rewrite the outgoing body, then hit the real backend.
    let request: RequestInfo | URL = input;
    let requestInit = init;
    if (rule?.type === 'MUTATE_REQUEST') {
      try {
        const normalized = new Request(input as RequestInfo, init);
        if (normalized.method !== 'GET' && normalized.method !== 'HEAD') {
          const originalText = await normalized.clone().text();
          const mutated = originalText ? mutateJsonText(originalText, rule) : null;
          if (mutated !== null) {
            request = new Request(normalized, { body: mutated });
            requestInit = undefined;
            requestText = mutated;
            log(`Mutated request to ${absoluteUrl}`, JSON.parse(mutated));
          } else {
            request = normalized;
            requestInit = undefined;
          }
        }
      } catch (err) {
        console.error('[Interceptor] Failed to mutate request body:', err);
      }
    }

    let response: Response;
    try {
      response = await nativeFetch(request, requestInit);
    } catch (err) {
      finish(undefined, 'network', isAbortError(err) ? 'aborted' : 'network-error');
      throw err;
    }

    // --- Response mutation: merge the override into the real payload.
    if (rule?.type === 'MUTATE_RESPONSE' && canRewriteBody(response)) {
      try {
        const originalText = await response.clone().text();
        const mutated = mutateJsonText(originalText, rule);
        if (mutated !== null) {
          log(`Mutated response from ${absoluteUrl}`, JSON.parse(mutated));
          const headers = new Headers(response.headers);
          // The body changed length and is no longer encoded as it arrived.
          headers.delete('content-length');
          headers.delete('content-encoding');
          headers.set('x-intercepted', 'MUTATE_RESPONSE');
          const rewritten = new Response(mutated, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
          finish(rewritten, 'mutated', 'ok', mutated);
          return rewritten;
        }
      } catch (err) {
        console.error('[Interceptor] Failed to mutate response data:', err);
      }
    }

    if (capture) {
      // The clone must be consumed or Chrome retains its buffer for the life of
      // the response, so read it (capped) off the return path and never await it.
      if (isCapturableContentType(response.headers.get('content-type') ?? '')) {
        const clone = response.clone();
        void readCapped(clone)
          .then((text) => finish(response, 'network', 'ok', text))
          .catch(() => finish(response, 'network', 'ok'));
      } else {
        finish(response, 'network', 'ok');
      }
    }

    return response;
  };

  /** 204/205/304 must not carry a body, only JSON is worth merging, and huge payloads are left alone. */
  function canRewriteBody(response: Response): boolean {
    if (response.status === 204 || response.status === 205 || response.status === 304) return false;
    if (!(response.headers.get('content-type') ?? '').includes('json')) return false;
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_MUTATE_BYTES) {
      console.warn(`[Interceptor] Response too large to mutate (${declared} bytes) — passing through.`);
      return false;
    }
    return true;
  }

  // ==========================================
  // 2. XMLHttpRequest interceptor (axios <= 0.x, jQuery, legacy SDKs)
  // ==========================================
  const NativeXHR = window.XMLHttpRequest;

  interface StubState {
    status: number;
    /** Undefined until the story body arrives; `_deliverStub` fills it in. */
    body?: string;
    readyState: number;
    aborted: boolean;
    /** 'STRICT' responses are synthesised locally and need no lookup. */
    resolved: boolean;
  }

  class MutatedXHR extends NativeXHR {
    private _method = 'GET';
    private _url = '';
    private _rule?: CompiledRule;
    private _stub?: StubState;
    private _cacheSource?: string;
    private _cacheResult?: string;
    private _startedAt = 0;
    private _started = 0;
    private _requestText?: string;
    private _requestHeaders: Record<string, string> = {};
    private _captureBound = false;
    private _sendBody?: Document | XMLHttpRequestBodyInit | null;

    override open(
      method: string,
      url: string | URL,
      async = true,
      username?: string | null,
      password?: string | null,
    ): void {
      this._method = method.toUpperCase();
      this._url = toAbsoluteUrl(url.toString(), location.href);
      this._rule = findMatch(this._url, this._method);
      this._stub = undefined;
      this._cacheSource = undefined;
      this._requestHeaders = {};
      this._requestText = undefined;
      super.open(method, url, async, username, password);
    }

    override setRequestHeader(name: string, value: string): void {
      this._requestHeaders[name] = value;
      super.setRequestHeader(name, value);
    }

    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      this._startedAt = Date.now();
      this._started = performance.now();
      if (typeof body === 'string') this._requestText = body;
      this._bindCapture();

      if (this._rule?.type === 'STUB') {
        // `send` cannot be async, so the body is resolved inside the deferred
        // delivery that already runs on a timer.
        this._sendBody = body;
        this._stub = {
          status: this._rule.status ?? 200,
          readyState: MutatedXHR.OPENED,
          aborted: false,
          resolved: false,
        };
        setTimeout(() => void this._deliverStub(), 0);
        return;
      }

      if (!this._rule && isStrictMiss(this._url)) {
        this._stub = {
          status: 501,
          body: strictBody(this._url),
          readyState: MutatedXHR.OPENED,
          aborted: false,
          resolved: true,
        };
        log(`Strict miss ${this._url} (XHR)`);
        setTimeout(() => void this._deliverStub(), 0);
        return;
      }

      let outgoing = body;
      if (this._rule?.type === 'MUTATE_REQUEST' && typeof body === 'string') {
        const mutated = mutateJsonText(body, this._rule);
        if (mutated !== null) {
          outgoing = mutated;
          this._requestText = mutated;
          log(`Mutated request to ${this._url} (XHR)`, JSON.parse(mutated));
        }
      }
      super.send(outgoing);
    }

    override abort(): void {
      if (this._stub) {
        this._stub.aborted = true;
        this._stub.readyState = MutatedXHR.DONE;
      }
      super.abort();
    }

    private get _stubContentType(): string {
      return this._rule?.contentType || 'application/json';
    }

    private get _stubMarker(): string {
      if (this._stub?.status === 501 && !this._rule) return 'STRICT';
      return this._rule?.storyId ? 'STORY' : 'STUB';
    }

    override getAllResponseHeaders(): string {
      if (this._stub) {
        return `content-type: ${this._stubContentType}\r\nx-intercepted: ${this._stubMarker}\r\n`;
      }
      return super.getAllResponseHeaders();
    }

    override getResponseHeader(name: string): string | null {
      if (this._stub) {
        const lower = name.toLowerCase();
        if (lower === 'content-type') return this._stubContentType;
        if (lower === 'x-intercepted') return this._stubMarker;
        return null;
      }
      return super.getResponseHeader(name);
    }

    override get readyState(): number {
      return this._stub ? this._stub.readyState : super.readyState;
    }

    override get status(): number {
      if (!this._stub) return super.status;
      return this._stub.readyState === MutatedXHR.DONE ? this._stub.status : 0;
    }

    override get statusText(): string {
      if (!this._stub) return super.statusText;
      return this._stub.readyState === MutatedXHR.DONE ? 'OK' : '';
    }

    override get responseURL(): string {
      return this._stub ? this._url : super.responseURL;
    }

    override get responseText(): string {
      if (this._stub) return this._stub.readyState === MutatedXHR.DONE ? (this._stub.body ?? '') : '';
      const text = super.responseText;
      if (this._rule?.type !== 'MUTATE_RESPONSE' || !text) return text;
      return this._mutateCached(text, this._rule);
    }

    override get response(): unknown {
      if (this._stub) {
        const text = this.responseText;
        if (this.responseType === 'json') return text ? JSON.parse(text) : null;
        return text;
      }

      if (this._rule?.type === 'MUTATE_RESPONSE') {
        // `responseText` throws for non-text response types, so branch first.
        if (this.responseType === 'json') {
          const raw: unknown = super.response;
          return raw === null || raw === undefined ? raw : mergeDeep(raw, this._rule.payload);
        }
        if (this.responseType === '' || this.responseType === 'text') return this.responseText;
      }
      return super.response;
    }

    private _mutateCached(text: string, rule: CompiledRule): string {
      if (this._cacheSource === text && this._cacheResult !== undefined) return this._cacheResult;
      const mutated = mutateJsonText(text, rule);
      if (mutated === null) return text;
      log(`Mutated response from ${this._url} (XHR)`, JSON.parse(mutated));
      this._cacheSource = text;
      this._cacheResult = mutated;
      return mutated;
    }

    /** Mirrors the finished exchange to the log, whatever served it. */
    private _bindCapture(): void {
      if (this._captureBound || !settings.captureEnabled) return;
      this._captureBound = true;
      const report = (outcome: Outcome) => {
        const servedBy: ServedBy = this._stub
          ? 'stub'
          : this._rule?.type === 'MUTATE_RESPONSE'
            ? 'mutated'
            : 'network';
        emit({
          id: newExchangeId(),
          startedAt: this._startedAt,
          durationMs: Math.round(performance.now() - this._started),
          transport: 'xhr',
          servedBy,
          outcome,
          method: this._method,
          url: this._url,
          status: this.status,
          statusText: this.statusText,
          contentType: this.getResponseHeader('content-type') ?? '',
          requestHeaders: redactHeaders(this._requestHeaders, settings.redactKeys),
          responseHeaders: redactHeaders(
            parseHeaderBlock(this.getAllResponseHeaders()),
            settings.redactKeys,
          ),
          requestBody: snapshot(this._requestText),
          responseBody: snapshot(this._readTextForCapture()),
        });
      };
      this.addEventListener('load', () => report('ok'));
      this.addEventListener('error', () => report('network-error'));
      this.addEventListener('abort', () => report('aborted'));
      this.addEventListener('timeout', () => report('network-error'));
    }

    /** Reads what the page will actually see, without throwing on binary response types. */
    private _readTextForCapture(): string | undefined {
      try {
        const type = this.responseType;
        if (type === '' || type === 'text') return this.responseText.slice(0, MAX_BODY_BYTES + 1);
        if (type === 'json') {
          const value: unknown = this.response;
          return value === undefined ? undefined : JSON.stringify(value).slice(0, MAX_BODY_BYTES + 1);
        }
        return undefined;
      } catch {
        return undefined;
      }
    }

    private async _deliverStub(): Promise<void> {
      const stub = this._stub;
      if (!stub || stub.aborted) return;

      if (!stub.resolved) {
        const body = this._rule ? await resolveStubBody(this._rule) : undefined;
        // `abort()` can land while the body is in flight.
        if (stub.aborted || this._stub !== stub) return;
        if (body === undefined) {
          // Nothing to replay: drop the stub and run the real request instead.
          this._stub = undefined;
          super.send(this._sendBody);
          return;
        }
        stub.body = body;
        stub.resolved = true;
        log(`${this._rule?.storyId ? 'Replayed' : 'Stubbed'} ${this._url} (XHR)`);
      }

      const body = stub.body ?? '';
      this.dispatchEvent(new ProgressEvent('loadstart'));
      for (const state of [MutatedXHR.HEADERS_RECEIVED, MutatedXHR.LOADING, MutatedXHR.DONE]) {
        if (stub.aborted) return;
        stub.readyState = state;
        this.dispatchEvent(new Event('readystatechange'));
      }
      const total = body.length;
      this.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: total, total }));
      this.dispatchEvent(new ProgressEvent('load', { lengthComputable: true, loaded: total, total }));
      this.dispatchEvent(new ProgressEvent('loadend', { lengthComputable: true, loaded: total, total }));
    }
  }

  window.XMLHttpRequest = MutatedXHR as unknown as typeof XMLHttpRequest;
}

/** Reads at most MAX_BODY_BYTES from a response clone, cancelling the rest. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return response.text();

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > MAX_BODY_BYTES) {
        void reader.cancel();
        return text;
      }
    }
  } catch {
    return text;
  }
  return text + decoder.decode();
}

function readRequestHeaders(
  input: RequestInfo | URL,
  init?: RequestInit,
): Record<string, string> | undefined {
  try {
    const source = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    return source ? headersToObject(new Headers(source)) : {};
  } catch {
    return undefined;
  }
}

/** Reads the outgoing body for the log without consuming the caller's Request. */
async function readRequestBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string | undefined> {
  const body = init?.body;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body !== undefined && body !== null) return undefined; // FormData/Blob/stream: not logged.

  if (input instanceof Request && input.body && !input.bodyUsed) {
    try {
      return await input.clone().text();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function headersToObject(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, name) => {
    output[name] = value;
  });
  return output;
}

function parseHeaderBlock(raw: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of raw.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) output[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return output;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
