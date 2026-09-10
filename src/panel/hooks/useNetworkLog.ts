import { useCallback, useEffect, useRef, useState } from 'react';
import { PORT_PANEL, type BgToPanel, type PanelToBg } from '../../shared/messages';
import type { BodySnapshot, ExchangeMeta } from '../../shared/capture';

export interface ExchangeBodies {
  found: boolean;
  request?: BodySnapshot;
  response?: BodySnapshot;
}

export interface NetworkLogState {
  connected: boolean;
  tabId?: number;
  tabUrl?: string;
  /** The panel was opened for one tab and stays with it, rather than following the active tab. */
  pinned: boolean;
  /** The pinned tab was closed: the log is still readable, but nothing can act on the page. */
  tabClosed: boolean;
  /** Record is on for this panel's tab only. */
  recording: boolean;
  /**
   * Whether any content script in the tab is talking to the worker. False for a
   * tab opened before the extension was loaded and for one Chrome refuses to
   * script — both record nothing, and only this tells them from "no traffic yet".
   */
  pageConnected: boolean;
  setRecording: (enabled: boolean) => void;
  entries: ExchangeMeta[];
  dropped: number;
  bodies: Record<string, ExchangeBodies>;
  loadBody: (exchangeId: string) => void;
  /** Awaitable variant, for flows that need several bodies at once (saving to a story). */
  fetchBody: (exchangeId: string) => Promise<ExchangeBodies>;
  clear: () => void;
}

const NOT_FOUND: ExchangeBodies = { found: false };
const BODY_TIMEOUT_MS = 3000;
/**
 * The worker is terminated whenever it goes idle, which drops this port. Nothing
 * else brings it back — so the panel reconnects itself, and pings often enough
 * that a recording in progress does not sit behind a dead channel.
 */
const KEEPALIVE_MS = 20_000;
const RECONNECT_BASE_MS = 250;
const RECONNECT_MAX_MS = 5000;

/**
 * The service worker opens the panel as `index.html?tabId=<id>`, which is what
 * makes the document per tab. Absent (dev server, manual open) the panel falls
 * back to following the window's active tab.
 */
function readPinnedTabId(): number | undefined {
  const raw = new URLSearchParams(window.location.search).get('tabId');
  if (raw === null) return undefined;
  const id = Number(raw);
  return Number.isInteger(id) && id >= 0 ? id : undefined;
}

/**
 * Owns the panel's single port to the service worker: tab identity and the log
 * arrive on the same channel, so one connection serves both.
 */
export function useNetworkLog(): NetworkLogState {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const [connected, setConnected] = useState(false);
  const [pinnedTabId] = useState(readPinnedTabId);
  const [pinned, setPinned] = useState(pinnedTabId !== undefined);
  const [tabClosed, setTabClosed] = useState(false);
  const [recording, setRecordingState] = useState(false);
  const [pageConnected, setPageConnected] = useState(false);
  const [tabId, setTabId] = useState<number | undefined>(pinnedTabId);
  const [tabUrl, setTabUrl] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<ExchangeMeta[]>([]);
  const [dropped, setDropped] = useState(0);
  const [bodies, setBodies] = useState<Record<string, ExchangeBodies>>({});
  const bodyWaiters = useRef(new Map<string, ((bodies: ExchangeBodies) => void)[]>());

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;

    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let keepalive: ReturnType<typeof setInterval> | undefined;

    const stopKeepalive = () => {
      if (keepalive === undefined) return;
      clearInterval(keepalive);
      keepalive = undefined;
    };

    const scheduleReconnect = () => {
      if (disposed || retryTimer !== undefined) return;
      // The worker restarts on demand, so the first retry is almost always the
      // one that lands; the backoff only guards a genuinely broken runtime.
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;

      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connect({ name: PORT_PANEL });
      } catch {
        scheduleReconnect();
        return;
      }
      portRef.current = port;
      setConnected(true);
      attempt = 0;

      port.onMessage.addListener((raw) => {
        const message = raw as BgToPanel;
        switch (message.kind) {
          case 'tab/changed':
            setTabId(message.tabId);
            setTabUrl(message.url);
            setPinned(message.pinned);
            setTabClosed(false);
            break;
          case 'tab/closed':
            setTabClosed(true);
            setPageConnected(false);
            break;
          case 'tab/recording':
            setRecordingState(message.recording);
            break;
          case 'tab/pages':
            setPageConnected(message.connected);
            break;
          case 'log/reset':
            setEntries(message.entries);
            setDropped(message.dropped);
            setBodies({});
            break;
          case 'log/append':
            if (message.entries.length > 0) {
              setEntries((current) => mergeLogEntries(current, message.entries));
            }
            setDropped(message.dropped);
            break;
          case 'log/body': {
            const value: ExchangeBodies = {
              found: message.found,
              request: message.request,
              response: message.response,
            };
            setBodies((current) => ({ ...current, [message.exchangeId]: value }));
            const waiters = bodyWaiters.current.get(message.exchangeId);
            if (waiters) {
              bodyWaiters.current.delete(message.exchangeId);
              for (const resolve of waiters) resolve(value);
            }
            break;
          }
        }
      });

      port.onDisconnect.addListener(() => {
        if (portRef.current === port) portRef.current = null;
        setConnected(false);
        setPageConnected(false);
        stopKeepalive();
        // Not an error: an idle worker is torn down and rebuilt on the next
        // connect. Re-subscribing is what makes recording survive that.
        scheduleReconnect();
      });

      if (pinnedTabId !== undefined) {
        send(port, { kind: 'log/subscribe', tabId: pinnedTabId });
      } else {
        void subscribePanel(port);
      }

      keepalive = setInterval(() => {
        const current = portRef.current;
        if (current) send(current, { kind: 'panel/ping' });
      }, KEEPALIVE_MS);
    };

    connect();

    return () => {
      disposed = true;
      stopKeepalive();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      const port = portRef.current;
      portRef.current = null;
      try {
        port?.disconnect();
      } catch {
        // Already gone.
      }
    };
  }, [pinnedTabId]);

  const loadBody = useCallback((exchangeId: string) => {
    const port = portRef.current;
    if (port) send(port, { kind: 'log/getBody', exchangeId });
  }, []);

  const fetchBody = useCallback((exchangeId: string): Promise<ExchangeBodies> => {
    const port = portRef.current;
    if (!port) return Promise.resolve(NOT_FOUND);

    return new Promise((resolve) => {
      const waiters = bodyWaiters.current.get(exchangeId) ?? [];
      waiters.push(resolve);
      bodyWaiters.current.set(exchangeId, waiters);
      send(port, { kind: 'log/getBody', exchangeId });

      setTimeout(() => {
        const pending = bodyWaiters.current.get(exchangeId);
        if (!pending?.includes(resolve)) return;
        // The worker restarted or dropped the body; do not hang the caller.
        const remaining = pending.filter((entry) => entry !== resolve);
        if (remaining.length > 0) bodyWaiters.current.set(exchangeId, remaining);
        else bodyWaiters.current.delete(exchangeId);
        resolve(NOT_FOUND);
      }, BODY_TIMEOUT_MS);
    });
  }, []);

  const setRecording = useCallback((enabled: boolean) => {
    setRecordingState(enabled);
    const port = portRef.current;
    if (port) send(port, { kind: 'log/record', enabled });
  }, []);

  const clear = useCallback(() => {
    const port = portRef.current;
    if (port) send(port, { kind: 'log/clear' });
    setEntries([]);
    setDropped(0);
    setBodies({});
  }, []);

  return {
    connected,
    tabId,
    tabUrl,
    pinned,
    tabClosed,
    recording,
    setRecording,
    pageConnected,
    entries,
    dropped,
    bodies,
    loadBody,
    fetchBody,
    clear,
  };
}

/**
 * Edge's side panel often is not the "current" window, so getCurrent() binds
 * the log to a window with no tab. Prefer the last focused browser tab, and
 * pin it — never follow later tab switches.
 */
async function subscribePanel(port: chrome.runtime.Port): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) {
      send(port, { kind: 'log/subscribe', tabId: tab.id });
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    const window = await chrome.windows.getCurrent();
    send(port, { kind: 'log/subscribe', windowId: window.id });
  } catch {
    send(port, { kind: 'log/subscribe' });
  }
}

function mergeLogEntries(current: ExchangeMeta[], incoming: ExchangeMeta[]): ExchangeMeta[] {
  const next = [...current];
  for (const entry of incoming) {
    const index = next.findIndex((item) => item.id === entry.id);
    if (index >= 0) next[index] = entry;
    else next.push(entry);
  }
  return next;
}

function send(port: chrome.runtime.Port, message: PanelToBg): void {
  try {
    port.postMessage(message);
  } catch {
    // The worker restarted; the next panel action reconnects.
  }
}
