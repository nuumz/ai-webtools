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
  const [tabId, setTabId] = useState<number | undefined>(pinnedTabId);
  const [tabUrl, setTabUrl] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<ExchangeMeta[]>([]);
  const [dropped, setDropped] = useState(0);
  const [bodies, setBodies] = useState<Record<string, ExchangeBodies>>({});
  const bodyWaiters = useRef(new Map<string, ((bodies: ExchangeBodies) => void)[]>());

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;

    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: PORT_PANEL });
    } catch {
      return;
    }
    portRef.current = port;
    setConnected(true);

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
          break;
        case 'log/reset':
          setEntries(message.entries);
          setDropped(message.dropped);
          setBodies({});
          break;
        case 'log/append':
          if (message.entries.length > 0) {
            setEntries((current) => [...current, ...message.entries]);
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
      portRef.current = null;
      setConnected(false);
    });

    if (pinnedTabId !== undefined) {
      send(port, { kind: 'log/subscribe', tabId: pinnedTabId });
    } else {
      void subscribePanel(port);
    }

    return () => {
      portRef.current = null;
      try {
        port.disconnect();
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
 * the log to a window with no tab. Prefer the last focused browser tab.
 */
async function subscribePanel(port: chrome.runtime.Port): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.windowId !== undefined) {
      send(port, { kind: 'log/subscribe', windowId: tab.windowId });
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

function send(port: chrome.runtime.Port, message: PanelToBg): void {
  try {
    port.postMessage(message);
  } catch {
    // The worker restarted; the next panel action reconnects.
  }
}
