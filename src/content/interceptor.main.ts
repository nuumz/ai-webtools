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
import { applyOps } from '../shared/pathOps';
import { randomId } from '../shared/ids';
import { bodyKeyForHit } from '../shared/story';
import { onBus, postBus, readStoredConfig } from '../shared/pageBus';
import {
  BODY_REPLY_EVENT,
  BODY_REQUEST_EVENT,
  CAPTURE_EVENT,
  CAPTURE_FLAG,
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

function readCaptureFlag(): boolean {
  try {
    return sessionStorage.getItem(CAPTURE_FLAG) === '1';
  } catch {
    return false;
  }
}

function install(): void {
  let settings: Settings = { ...DEFAULT_SETTINGS, captureEnabled: readCaptureFlag() };
  let activeRules: CompiledRule[] = [];
  let strictMatchers: ((url: string) => boolean)[] = [];
  /** How many times each story entry has answered in THIS frame. */
  const hits = new Map<string, number>();
  const bodyCache = new Map<string, string>();
  const pendingBodies = new Map<string, (text: string | undefined) => void>();

  const applyConfig = (raw: string): void => {
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      const config: PageConfig = Array.isArray(parsed)
        ? { version: 2, settings: DEFAULT_SETTINGS, rules: parsed as MutationRule[] }
        : (parsed as PageConfig);
      settings = config.settings ?? settings;
      activeRules = compileRules([...(config.rules ?? []), ...(config.storyRules ?? [])]);
      strictMatchers = (config.strictPatterns ?? []).map(compilePattern);
      hits.clear();
    } catch (err) {
      console.error('[Interceptor] Could not read config:', err);
    }
  };

  const stored = readStoredConfig();
  if (stored) applyConfig(stored);

  window.addEventListener(SYNC_EVENT, ((event: CustomEvent<string>) => {
    applyConfig(event.detail ?? '');
  }) as EventListener);
  onBus('sync', applyConfig);

  const takeBodyReply = (raw: string): void => {
    try {
      const { requestId, text } = JSON.parse(raw || '{}') as {
        requestId: string;
        text: string | null;
      };
      const resolve = pendingBodies.get(requestId);
      if (!resolve) return;
      pendingBodies.delete(requestId);
      resolve(typeof text === 'string' ? text : undefined);
    } catch {
      /* Malformed reply: the pending request falls back to its timeout. */
    }
  };

  window.addEventListener(BODY_REPLY_EVENT, ((event: CustomEvent<string>) => {
    takeBodyReply(event.detail ?? '');
  }) as EventListener);
  onBus('bodyRes', takeBodyReply);

  window.dispatchEvent(new CustomEvent(REQUEST_EVENT));
  postBus('request');

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
      const encoded = JSON.stringify(batch);
      window.dispatchEvent(new CustomEvent(CAPTURE_EVENT, { detail: encoded }));
      postBus('capture', encoded);
    } catch (err) {
      console.error('[Interceptor] Could not emit capture batch:', err);
    }
  };

  const capturing = (): boolean => settings.captureEnabled || readCaptureFlag();

  const emit = (exchange: CapturedExchange, immediate = false): void => {
    if (!capturing()) return;
    /*
     * In-flight rows must travel alone. A pending+complete batch of the same id
     * is one panel setState, so the list paints only the finished row.
     */
    if (exchange.outcome === 'pending' || immediate) {
      const held = queue;
      const heldTimer = flushTimer;
      queue = [exchange];
      flushTimer = undefined;
      flush();
      queue = held.concat(queue);
      flushTimer = heldTimer;
      if (queue.length > 0 && flushTimer === undefined) {
        flushTimer = window.setTimeout(flush, FLUSH_MS);
      }
      return;
    }
    queue.push(exchange);
    if (queue.length >= FLUSH_MAX) flush();
    else if (flushTimer === undefined) flushTimer = window.setTimeout(flush, FLUSH_MS);
  };

  const emitPending = (
    exchange: Omit<CapturedExchange, 'outcome' | 'servedBy' | 'durationMs' | 'status' | 'statusText' | 'contentType'> &
      Partial<CapturedExchange>,
  ): void => {
    emit(
      {
        durationMs: 0,
        servedBy: 'network',
        status: 0,
        statusText: '',
        contentType: '',
        ...exchange,
        outcome: 'pending',
      },
      true,
    );
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

      const encoded = JSON.stringify({ requestId, bodyKey });
      window.dispatchEvent(new CustomEvent(BODY_REQUEST_EVENT, { detail: encoded }));
      postBus('bodyReq', encoded);
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

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const abortError = (): DOMException =>
    new DOMException('The operation was aborted.', 'AbortError');

  /** How long this rule holds the response back. */
  const holdFor = (rule: CompiledRule): number =>
    (rule.delayMs ?? 0) + (rule.jitterMs ? Math.random() * rule.jitterMs : 0);

  /** A delay must still be interruptible, or it breaks the very timeouts under test. */
  const sleepUnlessAborted = (ms: number, signal?: AbortSignal | null): Promise<void> => {
    if (!signal) return sleep(ms);
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  /** A strict story answers 501 for anything it does not cover, instead of falling through. */
  const isStrictMiss = (url: string): boolean =>
    settings.enabled && strictMatchers.some((matches) => matches(url));

  const strictBody = (url: string): string =>
    JSON.stringify({ error: 'not-in-story', message: 'No story entry matches this request.', url });

  /** Applies the rule payload and its path ops to a JSON string; null when it is not JSON. */
  const mutateJsonText = (raw: string, rule: CompiledRule): string | null => {
    try {
      return JSON.stringify(applyOps(mergeDeep(JSON.parse(raw), rule.payload), rule.ops));
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
    const capture = capturing();

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

    const id = newExchangeId();
    if (capture) {
      emitPending({
        id,
        startedAt,
        transport: 'fetch',
        method,
        url: absoluteUrl,
      });
    }

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
        id,
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

    // --- Latency and faults apply to any matched rule, whatever its type.
    if (rule) {
      const wait = holdFor(rule);
      try {
        if (wait > 0) await sleepUnlessAborted(wait, init?.signal);
      } catch (err) {
        finish(undefined, 'stub', 'aborted');
        throw err;
      }

      if (rule.fault) {
        const fault = rule.fault;
        log(`Faulted ${absoluteUrl} (${fault.kind})`);

        if (fault.kind === 'status') {
          const body = JSON.stringify(fault.body ?? { error: 'simulated', status: fault.status });
          const failed = new Response(body, {
            status: fault.status,
            headers: { 'Content-Type': 'application/json', 'X-Intercepted': 'FAULT' },
          });
          finish(failed, 'stub', 'ok', body);
          return failed;
        }

        if (fault.kind === 'network-error') {
          finish(undefined, 'stub', 'network-error');
          // What a real fetch failure looks like to application code.
          throw new TypeError('Failed to fetch');
        }

        // A timeout never settles on its own; the caller's signal is the only way out.
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          const fail = () => {
            finish(undefined, 'stub', 'aborted');
            reject(abortError());
          };
          if (signal.aborted) fail();
          else signal.addEventListener('abort', fail, { once: true });
        });
      }
    }

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

    if (capture) {
      emitPending({
        id,
        startedAt,
        durationMs: Math.round(performance.now() - started),
        transport: 'fetch',
        method,
        url: absoluteUrl,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type') ?? '',
        requestHeaders: requestHeaders && redactHeaders(requestHeaders, settings.redactKeys),
        responseHeaders: redactHeaders(headersToObject(response.headers), settings.redactKeys),
        requestBody: snapshot(requestText),
      });
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

  type Fault = NonNullable<CompiledRule['fault']>;

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
    private _exchangeId = '';
    private _sendBody?: Document | XMLHttpRequestBodyInit | null;
    private _fault?: Fault;

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
      this._fault = undefined;
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

      const wait = this._rule ? holdFor(this._rule) : 0;

      if (this._rule?.fault) {
        this._fault = this._rule.fault;
        this._sendBody = body;
        // A caller-set timeout wins: that is the deadline the app is testing.
        const delay =
          this._fault.kind === 'timeout' && this.timeout > 0 ? this.timeout : wait;
        log(`Faulted ${this._url} (${this._fault.kind}, XHR)`);
        setTimeout(() => void this._deliverSynthetic(), delay);
        return;
      }

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
        setTimeout(() => void this._deliverStub(), wait);
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

      // A delayed real request: hold the send itself, so timing matches fetch.
      if (wait > 0) {
        setTimeout(() => {
          if (!this._stub?.aborted) super.send(outgoing);
        }, wait);
        return;
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
      if (this._fault) return 'FAULT';
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
          if (raw === null || raw === undefined) return raw;
          return applyOps(mergeDeep(raw, this._rule.payload), this._rule.ops);
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

    /** Mirrors the exchange as soon as send() runs, then again when headers land. */
    private _bindCapture(): void {
      if (this._captureBound || !capturing()) return;
      this._captureBound = true;
      this._exchangeId = newExchangeId();
      emitPending({
        id: this._exchangeId,
        startedAt: this._startedAt,
        transport: 'xhr',
        method: this._method,
        url: this._url,
      });
      const report = (outcome: Outcome) => {
        const servedBy: ServedBy = this._stub
          ? 'stub'
          : this._rule?.type === 'MUTATE_RESPONSE'
            ? 'mutated'
            : 'network';
        emit({
          id: this._exchangeId,
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
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== XMLHttpRequest.HEADERS_RECEIVED) return;
        emitPending({
          id: this._exchangeId,
          startedAt: this._startedAt,
          durationMs: Math.round(performance.now() - this._started),
          transport: 'xhr',
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
        });
      });
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

    /** Synthesises the failure the rule asked for, through the same event machinery. */
    private async _deliverSynthetic(): Promise<void> {
      const fault = this._fault;
      if (!fault) return;

      if (fault.kind === 'status') {
        this._stub = {
          status: fault.status,
          body: JSON.stringify(fault.body ?? { error: 'simulated', status: fault.status }),
          readyState: MutatedXHR.OPENED,
          aborted: false,
          resolved: true,
        };
        await this._deliverStub();
        return;
      }

      // Network errors and timeouts carry no body and report status 0.
      this._stub = {
        status: 0,
        body: '',
        readyState: MutatedXHR.DONE,
        aborted: false,
        resolved: true,
      };
      this.dispatchEvent(new Event('readystatechange'));
      this.dispatchEvent(new ProgressEvent(fault.kind === 'timeout' ? 'timeout' : 'error'));
      this.dispatchEvent(new ProgressEvent('loadend'));
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
