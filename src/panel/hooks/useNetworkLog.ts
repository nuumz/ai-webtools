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
  entries: ExchangeMeta[];
  dropped: number;
  bodies: Record<string, ExchangeBodies>;
  loadBody: (exchangeId: string) => void;
  clear: () => void;
}

/**
 * Owns the panel's single port to the service worker: tab identity and the log
 * arrive on the same channel, so one connection serves both.
 */
export function useNetworkLog(): NetworkLogState {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const [connected, setConnected] = useState(false);
  const [tabId, setTabId] = useState<number | undefined>(undefined);
  const [tabUrl, setTabUrl] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<ExchangeMeta[]>([]);
  const [dropped, setDropped] = useState(0);
  const [bodies, setBodies] = useState<Record<string, ExchangeBodies>>({});

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
        case 'log/body':
          setBodies((current) => ({
            ...current,
            [message.exchangeId]: {
              found: message.found,
              request: message.request,
              response: message.response,
            },
          }));
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      portRef.current = null;
      setConnected(false);
    });

    void chrome.windows
      ?.getCurrent()
      .then((window) => {
        if (window.id !== undefined) send(port, { kind: 'log/subscribe', windowId: window.id });
      })
      .catch(() => undefined);

    return () => {
      portRef.current = null;
      try {
        port.disconnect();
      } catch {
        // Already gone.
      }
    };
  }, []);

  const loadBody = useCallback((exchangeId: string) => {
    const port = portRef.current;
    if (port) send(port, { kind: 'log/getBody', exchangeId });
  }, []);

  const clear = useCallback(() => {
    const port = portRef.current;
    if (port) send(port, { kind: 'log/clear' });
    setEntries([]);
    setDropped(0);
    setBodies({});
  }, []);

  return { connected, tabId, tabUrl, entries, dropped, bodies, loadBody, clear };
}

function send(port: chrome.runtime.Port, message: PanelToBg): void {
  try {
    port.postMessage(message);
  } catch {
    // The worker restarted; the next panel action reconnects.
  }
}
