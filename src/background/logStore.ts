// Per-tab ring buffer for captured traffic. Lives in the service worker because
// it is the only context that knows the tabId and survives page navigation.
import {
  toExchangeMeta,
  type BodySnapshot,
  type CapturedExchange,
  type ExchangeMeta,
} from '../shared/capture';

const MAX_ENTRIES_PER_TAB = 500;
const MAX_BYTES_PER_TAB = 16 * 1024 * 1024;
const SESSION_PREFIX = 'log:';
const MIRROR_DEBOUNCE_MS = 1000;

interface Bodies {
  request?: BodySnapshot;
  response?: BodySnapshot;
}

interface TabLog {
  entries: ExchangeMeta[];
  bodies: Map<string, Bodies>;
  bytes: number;
  dropped: number;
}

const logs = new Map<number, TabLog>();
let mirrorTimer: ReturnType<typeof setTimeout> | undefined;
let restored: Promise<void> | undefined;

const tabLog = (tabId: number): TabLog => {
  let log = logs.get(tabId);
  if (!log) {
    log = { entries: [], bodies: new Map(), bytes: 0, dropped: 0 };
    logs.set(tabId, log);
  }
  return log;
};

export function addExchanges(tabId: number, exchanges: CapturedExchange[]): ExchangeMeta[] {
  const log = tabLog(tabId);
  const changed: ExchangeMeta[] = [];

  for (const exchange of exchanges) {
    const meta = toExchangeMeta(exchange);
    const nextBytes =
      (exchange.requestBody?.text.length ?? 0) + (exchange.responseBody?.text.length ?? 0);
    const index = log.entries.findIndex((entry) => entry.id === meta.id);
    if (index >= 0) {
      const previous = log.bodies.get(meta.id);
      log.bytes -= (previous?.request?.text.length ?? 0) + (previous?.response?.text.length ?? 0);
      log.entries[index] = meta;
    } else {
      log.entries.push(meta);
    }
    log.bodies.set(meta.id, { request: exchange.requestBody, response: exchange.responseBody });
    log.bytes += nextBytes;
    changed.push(meta);
  }

  // Bodies are what blow the byte budget, and the row is the part the user reads,
  // so the oldest bodies go first and the list itself survives. The newest body
  // is never dropped: with a large capture limit one response can exceed the
  // whole budget, and that response is exactly the one about to be stubbed.
  for (const entry of log.entries.slice(0, -1)) {
    if (log.bytes <= MAX_BYTES_PER_TAB) break;
    if (!log.bodies.has(entry.id)) continue;
    dropBodies(log, entry.id);
  }

  while (log.entries.length > MAX_ENTRIES_PER_TAB) {
    const evicted = log.entries.shift();
    if (!evicted) break;
    dropBodies(log, evicted.id);
  }

  scheduleMirror();
  return changed;
}

function dropBodies(log: TabLog, exchangeId: string): void {
  const bodies = log.bodies.get(exchangeId);
  if (!bodies) return;
  log.bytes -= (bodies.request?.text.length ?? 0) + (bodies.response?.text.length ?? 0);
  log.bodies.delete(exchangeId);
}

export function addDropped(tabId: number, count: number): number {
  const log = tabLog(tabId);
  log.dropped += count;
  return log.dropped;
}

export function getEntries(tabId: number): { entries: ExchangeMeta[]; dropped: number } {
  const log = logs.get(tabId);
  return { entries: log?.entries ?? [], dropped: log?.dropped ?? 0 };
}

export function getBodies(tabId: number, exchangeId: string): Bodies | undefined {
  return logs.get(tabId)?.bodies.get(exchangeId);
}

export function clearTab(tabId: number): void {
  logs.delete(tabId);
  void chrome.storage.session?.remove(`${SESSION_PREFIX}${tabId}`).catch(() => undefined);
}

/**
 * Mirrors metadata (never bodies) to storage.session so the list survives a
 * service-worker restart. Bodies are deliberately sacrificed: losing them costs
 * a refresh, whereas losing the list costs the whole session's context.
 */
function scheduleMirror(): void {
  if (mirrorTimer !== undefined) return;
  mirrorTimer = setTimeout(() => {
    mirrorTimer = undefined;
    const payload: Record<string, ExchangeMeta[]> = {};
    for (const [tabId, log] of logs) payload[`${SESSION_PREFIX}${tabId}`] = log.entries;
    void chrome.storage.session?.set(payload).catch(() => undefined);
  }, MIRROR_DEBOUNCE_MS);
}

/**
 * Re-hydrates metadata after the worker was terminated. Safe to call repeatedly:
 * every caller awaits the same read, so a panel that attaches while the first
 * restore is still in flight is not handed an empty log.
 */
export function restoreFromSession(): Promise<void> {
  restored ??= readSession();
  return restored;
}

async function readSession(): Promise<void> {
  try {
    const stored = await chrome.storage.session?.get(null);
    for (const [key, value] of Object.entries(stored ?? {})) {
      if (!key.startsWith(SESSION_PREFIX) || !Array.isArray(value)) continue;
      const tabId = Number(key.slice(SESSION_PREFIX.length));
      if (!Number.isFinite(tabId)) continue;
      const log = tabLog(tabId);
      if (log.entries.length === 0) log.entries = value as ExchangeMeta[];
    }
  } catch {
    // storage.session unavailable — the log simply starts empty.
  }
}
