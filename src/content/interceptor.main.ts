// MAIN world: patches the page's own `fetch` and `XMLHttpRequest` so requests
// and responses can be mutated on the fly before the app's framework sees them.
import { compileRules, findRule, toAbsoluteUrl, type CompiledRule } from '../shared/match';
import { mergeDeep } from '../shared/merge';
import { REQUEST_EVENT, SYNC_EVENT, type MutationRule } from '../shared/types';

const INSTALL_FLAG = '__DEV_TOOL_INTERCEPTOR_INSTALLED__';
const globalScope = window as unknown as Record<string, unknown>;
if (globalScope[INSTALL_FLAG]) {
  // Already patched in this frame (e.g. re-injected script) — do nothing.
} else {
  globalScope[INSTALL_FLAG] = true;
  install();
}

function install(): void {
  let activeRules: CompiledRule[] = [];

  window.addEventListener(SYNC_EVENT, ((event: CustomEvent<string>) => {
    try {
      const rules = JSON.parse(event.detail ?? '[]') as MutationRule[];
      activeRules = compileRules(rules);
    } catch (err) {
      console.error('[Interceptor] Could not read rules:', err);
      activeRules = [];
    }
  }) as EventListener);

  // The bridge may have pushed before this listener existed — ask for a resend.
  window.dispatchEvent(new CustomEvent(REQUEST_EVENT));

  const log = (message: string, ...rest: unknown[]) =>
    console.log(`%c[Interceptor]%c ${message}`, 'color:#6366f1;font-weight:bold', '', ...rest);

  const stubResponseBody = (rule: CompiledRule): string => JSON.stringify(rule.payload ?? {});

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
    let rule: CompiledRule | undefined;
    let absoluteUrl = '';
    try {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      absoluteUrl = toAbsoluteUrl(rawUrl, location.href);
      const method =
        init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
      rule = findRule(activeRules, absoluteUrl, method);
    } catch (err) {
      console.error('[Interceptor] Rule lookup failed:', err);
    }

    if (!rule) return nativeFetch(input, init);

    // --- Full stub: never touch the network.
    if (rule.type === 'STUB') {
      log(`Stubbed ${absoluteUrl}`, rule.payload);
      return new Response(stubResponseBody(rule), {
        status: rule.status ?? 200,
        headers: { 'Content-Type': 'application/json', 'X-Intercepted': 'STUB' },
      });
    }

    // --- Request mutation: rewrite the outgoing body, then hit the real backend.
    let request: RequestInfo | URL = input;
    let requestInit = init;
    if (rule.type === 'MUTATE_REQUEST') {
      try {
        const normalized = new Request(input as RequestInfo, init);
        if (normalized.method !== 'GET' && normalized.method !== 'HEAD') {
          const originalText = await normalized.clone().text();
          const mutated = originalText ? mutateJsonText(originalText, rule) : null;
          if (mutated !== null) {
            request = new Request(normalized, { body: mutated });
            requestInit = undefined;
            log(`Mutated request to ${absoluteUrl}`, JSON.parse(mutated));
          }
        }
      } catch (err) {
        console.error('[Interceptor] Failed to mutate request body:', err);
      }
    }

    const response = await nativeFetch(request, requestInit);

    // --- Response mutation: merge the override into the real payload.
    if (rule.type === 'MUTATE_RESPONSE' && canRewriteBody(response)) {
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
          return new Response(mutated, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        }
      } catch (err) {
        console.error('[Interceptor] Failed to mutate response data:', err);
      }
    }

    return response;
  };

  function canRewriteBody(response: Response): boolean {
    // 204/205/304 must not carry a body, and only JSON is worth merging.
    if (response.status === 204 || response.status === 205 || response.status === 304) return false;
    return (response.headers.get('content-type') ?? '').includes('json');
  }

  // ==========================================
  // 2. XMLHttpRequest interceptor (axios <= 0.x, jQuery, legacy SDKs)
  // ==========================================
  const NativeXHR = window.XMLHttpRequest;

  interface StubState {
    status: number;
    body: string;
    readyState: number;
    aborted: boolean;
  }

  class MutatedXHR extends NativeXHR {
    private _method = 'GET';
    private _url = '';
    private _rule?: CompiledRule;
    private _stub?: StubState;
    private _cacheSource?: string;
    private _cacheResult?: string;

    override open(
      method: string,
      url: string | URL,
      async = true,
      username?: string | null,
      password?: string | null,
    ): void {
      this._method = method.toUpperCase();
      this._url = toAbsoluteUrl(url.toString(), location.href);
      this._rule = findRule(activeRules, this._url, this._method);
      this._stub = undefined;
      this._cacheSource = undefined;
      super.open(method, url, async, username, password);
    }

    override send(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (this._rule?.type === 'STUB') {
        this._stub = {
          status: this._rule.status ?? 200,
          body: stubResponseBody(this._rule),
          readyState: MutatedXHR.OPENED,
          aborted: false,
        };
        log(`Stubbed ${this._url} (XHR)`, this._rule.payload);
        setTimeout(() => this._deliverStub(), 0);
        return;
      }

      let outgoing = body;
      if (this._rule?.type === 'MUTATE_REQUEST' && typeof body === 'string') {
        const mutated = mutateJsonText(body, this._rule);
        if (mutated !== null) {
          outgoing = mutated;
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

    override getAllResponseHeaders(): string {
      if (this._stub) return 'content-type: application/json\r\nx-intercepted: STUB\r\n';
      return super.getAllResponseHeaders();
    }

    override getResponseHeader(name: string): string | null {
      if (this._stub) {
        const lower = name.toLowerCase();
        if (lower === 'content-type') return 'application/json';
        if (lower === 'x-intercepted') return 'STUB';
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
      if (this._stub) return this._stub.readyState === MutatedXHR.DONE ? this._stub.body : '';
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

    private _deliverStub(): void {
      const stub = this._stub;
      if (!stub || stub.aborted) return;

      this.dispatchEvent(new ProgressEvent('loadstart'));
      for (const state of [MutatedXHR.HEADERS_RECEIVED, MutatedXHR.LOADING, MutatedXHR.DONE]) {
        if (stub.aborted) return;
        stub.readyState = state;
        this.dispatchEvent(new Event('readystatechange'));
      }
      const total = stub.body.length;
      this.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: total, total }));
      this.dispatchEvent(new ProgressEvent('load', { lengthComputable: true, loaded: total, total }));
      this.dispatchEvent(new ProgressEvent('loadend', { lengthComputable: true, loaded: total, total }));
    }
  }

  window.XMLHttpRequest = MutatedXHR as unknown as typeof XMLHttpRequest;
}
