// Port registry: fans page capture in, and panel updates out.
import {
  PORT_PAGE,
  PORT_PANEL,
  type BgToPanel,
  type PageToBg,
  type PanelToBg,
} from '../shared/messages';
import {
  addDropped,
  addExchanges,
  clearTab,
  getBodies,
  getEntries,
  restoreFromSession,
} from './logStore';

interface PanelState {
  windowId: number;
  tabId?: number;
}

const panelPorts = new Map<chrome.runtime.Port, PanelState>();
/** Last known top-frame URL per tab, learned from `page/hello` (no `tabs` permission needed). */
const tabUrls = new Map<number, string>();

export function initRouter(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === PORT_PAGE) handlePagePort(port);
    else if (port.name === PORT_PANEL) handlePanelPort(port);
  });

  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    for (const [port, state] of panelPorts) {
      if (state.windowId !== windowId) continue;
      state.tabId = tabId;
      sendToPanel(port, { kind: 'tab/changed', tabId, url: tabUrls.get(tabId) });
      sendLogReset(port, tabId);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    tabUrls.delete(tabId);
    clearTab(tabId);
  });
}

function handlePagePort(port: chrome.runtime.Port): void {
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) return;

  port.onMessage.addListener((raw) => {
    const message = raw as PageToBg;
    switch (message.kind) {
      case 'page/hello':
        if (message.isTop) {
          // A fresh top-frame load: the previous page's traffic is no longer relevant.
          tabUrls.set(tabId, message.url);
          clearTab(tabId);
          broadcast(tabId, (panelPort) => {
            sendToPanel(panelPort, { kind: 'tab/changed', tabId, url: message.url });
            sendLogReset(panelPort, tabId);
          });
        }
        break;
      case 'capture/exchange': {
        const entries = addExchanges(tabId, message.exchanges);
        if (entries.length === 0) break;
        const { dropped } = getEntries(tabId);
        broadcast(tabId, (panelPort) =>
          sendToPanel(panelPort, { kind: 'log/append', tabId, entries, dropped }),
        );
        break;
      }
      case 'capture/dropped': {
        const dropped = addDropped(tabId, message.count);
        broadcast(tabId, (panelPort) =>
          sendToPanel(panelPort, { kind: 'log/append', tabId, entries: [], dropped }),
        );
        break;
      }
    }
  });
}

function handlePanelPort(port: chrome.runtime.Port): void {
  panelPorts.set(port, { windowId: chrome.windows.WINDOW_ID_NONE });
  port.onDisconnect.addListener(() => panelPorts.delete(port));

  port.onMessage.addListener((raw) => {
    const message = raw as PanelToBg;
    const state = panelPorts.get(port);
    if (!state) return;

    switch (message.kind) {
      case 'log/subscribe':
        state.windowId = message.windowId;
        void resolveActiveTab(message.windowId).then((tabId) => {
          if (tabId === undefined) return;
          state.tabId = tabId;
          sendToPanel(port, { kind: 'tab/changed', tabId, url: tabUrls.get(tabId) });
          sendLogReset(port, tabId);
        });
        break;
      case 'log/clear':
        if (state.tabId !== undefined) {
          clearTab(state.tabId);
          sendLogReset(port, state.tabId);
        }
        break;
      case 'log/getBody': {
        if (state.tabId === undefined) return;
        const bodies = getBodies(state.tabId, message.exchangeId);
        sendToPanel(port, {
          kind: 'log/body',
          exchangeId: message.exchangeId,
          found: bodies !== undefined,
          request: bodies?.request,
          response: bodies?.response,
        });
        break;
      }
    }
  });
}

async function resolveActiveTab(windowId: number): Promise<number | undefined> {
  await restoreFromSession();
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    return tab?.id;
  } catch {
    return undefined;
  }
}

function broadcast(tabId: number, send: (port: chrome.runtime.Port) => void): void {
  for (const [port, state] of panelPorts) {
    if (state.tabId === tabId) send(port);
  }
}

function sendLogReset(port: chrome.runtime.Port, tabId: number): void {
  const { entries, dropped } = getEntries(tabId);
  sendToPanel(port, { kind: 'log/reset', tabId, entries, dropped });
}

function sendToPanel(port: chrome.runtime.Port, message: BgToPanel): void {
  try {
    port.postMessage(message);
  } catch {
    panelPorts.delete(port);
  }
}
