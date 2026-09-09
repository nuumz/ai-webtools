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
  /**
   * A pinned panel was opened for one specific tab and stays with it: it must
   * not re-target when the user switches tabs, otherwise two panels of the same
   * window would show the same traffic.
   */
  pinned: boolean;
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
      if (state.pinned || state.windowId !== windowId) continue;
      state.tabId = tabId;
      sendToPanel(port, { kind: 'tab/changed', tabId, url: tabUrls.get(tabId), pinned: false });
      sendLogReset(port, tabId);
    }
  });

  // A pinned panel outlives navigation, so it needs the new address even when
  // the content script never reports in (chrome://, blocked pages).
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    tabUrls.set(tabId, changeInfo.url);
    broadcast(tabId, (port) =>
      sendToPanel(port, {
        kind: 'tab/changed',
        tabId,
        url: changeInfo.url,
        pinned: panelPorts.get(port)?.pinned ?? false,
      }),
    );
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    tabUrls.delete(tabId);
    clearTab(tabId);
    for (const [port, state] of panelPorts) {
      if (state.tabId !== tabId) continue;
      sendToPanel(port, { kind: 'tab/closed', tabId });
    }
  });
}

function handlePagePort(port: chrome.runtime.Port): void {
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) return;

  port.onMessage.addListener((raw) => {
    // The worker may have restarted a moment ago: let the session mirror land
    // before the first capture is folded in, or restoring finds a log that has
    // already been overwritten with just that one record.
    void restoreFromSession().then(() => handlePageMessage(tabId, raw as PageToBg));
  });
}

function handlePageMessage(tabId: number, message: PageToBg): void {
  switch (message.kind) {
    case 'page/hello':
      if (message.isTop) {
        tabUrls.set(tabId, message.url);
        // A new document starts a new log. A port reconnect after the worker
        // was killed for being idle is not a load, and clearing there would
        // delete a recording the live page is still adding to — while a reload
        // of the same URL is a new document, which the URL alone cannot tell.
        if (message.fresh) clearTab(tabId);
        claimOrphanPanels(tabId, message.url);
        broadcast(tabId, (panelPort) => {
          const state = panelPorts.get(panelPort);
          sendToPanel(panelPort, {
            kind: 'tab/changed',
            tabId,
            url: message.url,
            pinned: state?.pinned ?? false,
          });
          // On a reconnect the worker's view may still be re-hydrating; the
          // panel already holds the rows, so only a real load resets it.
          if (message.fresh) sendLogReset(panelPort, tabId);
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
}

function handlePanelPort(port: chrome.runtime.Port): void {
  panelPorts.set(port, { windowId: chrome.windows.WINDOW_ID_NONE, pinned: false });
  port.onDisconnect.addListener(() => panelPorts.delete(port));

  port.onMessage.addListener((raw) => {
    const message = raw as PanelToBg;
    const state = panelPorts.get(port);
    if (!state) return;

    switch (message.kind) {
      case 'log/subscribe':
        if (message.windowId !== undefined) state.windowId = message.windowId;
        if (message.tabId !== undefined) {
          state.pinned = true;
          state.tabId = message.tabId;
          void attachToTab(port, message.tabId);
          break;
        }
        void resolveActiveTab(state.windowId).then((tabId) => {
          if (tabId === undefined) return;
          state.tabId = tabId;
          void attachToTab(port, tabId);
        });
        break;
      case 'panel/ping':
        // Nothing to answer: the message itself is what resets the worker's idle timer.
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

/** Hands a panel its tab's identity and backlog in one go. */
async function attachToTab(port: chrome.runtime.Port, tabId: number): Promise<void> {
  await restoreFromSession();
  const state = panelPorts.get(port);
  if (!state) return;

  let url = tabUrls.get(tabId);
  if (url === undefined) {
    // The page port only reports on load; a panel opened later still needs the address.
    try {
      const tab = await chrome.tabs.get(tabId);
      url = tab.url;
      if (url) tabUrls.set(tabId, url);
    } catch {
      sendToPanel(port, { kind: 'tab/closed', tabId });
      return;
    }
  }

  sendToPanel(port, { kind: 'tab/changed', tabId, url, pinned: state.pinned });
  sendLogReset(port, tabId);
}

async function resolveActiveTab(windowId: number): Promise<number | undefined> {
  try {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      const [inWindow] = await chrome.tabs.query({ active: true, windowId });
      if (inWindow?.id !== undefined) return inWindow.id;
    }
    const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return focused?.id;
  } catch {
    return undefined;
  }
}

/** A panel that never resolved a tab still receives this page's log. */
function claimOrphanPanels(tabId: number, url: string): void {
  for (const [port, state] of panelPorts) {
    if (state.tabId !== undefined) continue;
    state.tabId = tabId;
    sendToPanel(port, { kind: 'tab/changed', tabId, url, pinned: state.pinned });
    sendLogReset(port, tabId);
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
