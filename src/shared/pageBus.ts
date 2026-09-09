/**
 * MAIN ↔ ISOLATED handshake. CustomEvent.detail is stripped by some Edge
 * builds when the event crosses worlds; postMessage is not.
 */
export const PAGE_BUS = '__DEV_TOOL_BUS__';
export const CONFIG_STORE = '__DEV_TOOL_CONFIG__';

export type BusKind = 'sync' | 'request' | 'capture' | 'bodyReq' | 'bodyRes';

export interface BusMessage {
  ch: typeof PAGE_BUS;
  k: BusKind;
  d?: string;
}

export function postBus(kind: BusKind, detail?: string): void {
  const message: BusMessage = { ch: PAGE_BUS, k: kind };
  if (detail !== undefined) message.d = detail;
  window.postMessage(message, '*');
}

export function onBus(kind: BusKind, handler: (detail: string) => void): void {
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    const msg = data as Partial<BusMessage>;
    if (msg.ch !== PAGE_BUS || msg.k !== kind) return;
    handler(typeof msg.d === 'string' ? msg.d : '');
  });
}

export function readStoredConfig(): string | undefined {
  try {
    return sessionStorage.getItem(CONFIG_STORE) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredConfig(payload: string): void {
  try {
    sessionStorage.setItem(CONFIG_STORE, payload);
  } catch {
    /* opaque / sandboxed origin */
  }
}
