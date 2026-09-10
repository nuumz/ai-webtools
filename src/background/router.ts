// Port registry: fans page capture in, and panel updates out.
import {
  PORT_PAGE,
  PORT_PANEL,
  type BgToPage,
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
import { isArmed, isRecording, restoreArmedTabs, setArmed, setRecording } from './armedTabs';

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
const pagePorts = new Map<number, Set<chrome.runtime.Port>>();
/** Last known top-frame URL per tab, learned from `page/hello` (no `tabs` permission needed). */
const tabUrls = new Map<number, string>();

/*
 * Panel reconnect after an idle worker is torn down is not "the user closed
 * the panel". Wait before disarming so a recording tab is not dropped.
 */
const DISARM_GRACE_MS = 2500;
const disarmTimers = new Map<number, ReturnType<typeof setTimeout>>();

let onArmedChange: (() => void) | undefined;
let onTabArmed: ((tabId: number, armed: boolean) => void) | undefined;

export function initRouter(options?: {
  onArmedChange?: () => void;
  onTabArmed?: (tabId: number, armed: boolean) => void;
}): void {
  onArmedChange = options?.onArmedChange;
  onTabArmed = options?.onTabArmed;

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
    if (changeInfo.url) {
      tabUrls.set(tabId, changeInfo.url);
      broadcast(tabId, (port) =>
        sendToPanel(port, {
          kind: 'tab/changed',
          tabId,
          url: changeInfo.url,
          pinned: panelPorts.get(port)?.pinned ?? false,
        }),
      );
    }
    if (changeInfo.status === 'loading') {
      cancelDisarm(tabId);
    }
    if (changeInfo.status === 'complete') {
      void restoreArmedTabs().then(() => {
        if (isArmed(tabId) || isRecording(tabId) || hasPanelFor(tabId)) {
          resumeInspectOnReload(tabId);
          notifyPages(tabId);
        }
      });
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    tabUrls.delete(tabId);
    clearTab(tabId);
    cancelDisarm(tabId);
    pagePorts.delete(tabId);
    setRecording(tabId, false);
    if (setArmed(tabId, false)) onArmedChange?.();
    for (const [port, state] of panelPorts) {
      if (state.tabId !== tabId) continue;
      sendToPanel(port, { kind: 'tab/closed', tabId });
    }
  });

  void restoreArmedTabs().then(() => {
    for (const tabId of pagePorts.keys()) notifyPages(tabId);
    onArmedChange?.();
  });
}

/** Open Inspect on this tab: arm it and start recording, like opening DevTools. */
export function armOpenedTab(tabId: number): void {
  cancelDisarm(tabId);
  const first = !isArmed(tabId);
  setTabArmed(tabId, true);
  if (first) setTabRecording(tabId, true);
}

/**
 * The user switched back to a tab. Keep Inspect attached (DevTools does not
 * drop Network when you leave and return) and re-push scope to the page.
 * Returns whether the side panel should be shown for this tab.
 */
export function resumeInspect(tabId: number): boolean {
  cancelDisarm(tabId);
  if (hasPanelFor(tabId) && !isArmed(tabId)) {
    armOpenedTab(tabId);
    return true;
  }
  if (!isArmed(tabId)) return false;
  notifyPages(tabId);
  sendRecording(tabId);
  return true;
}

/** Reload is a new document, not "Inspect closed" — keep recording like DevTools. */
function resumeInspectOnReload(tabId: number): void {
  cancelDisarm(tabId);
  if (!hasPanelFor(tabId) && !isArmed(tabId) && !isRecording(tabId)) return;
  setTabArmed(tabId, true);
  setTabRecording(tabId, true);
}

function setTabArmed(tabId: number, next: boolean): void {
  const changed = setArmed(tabId, next);
  if (!next) setRecording(tabId, false);
  const armed = isArmed(tabId);
  notifyPages(tabId);
  onTabArmed?.(tabId, armed);
  sendRecording(tabId);
  if (changed) onArmedChange?.();
}

function setTabRecording(tabId: number, next: boolean): void {
  if (next && !isArmed(tabId)) setTabArmed(tabId, true);
  const changed = setRecording(tabId, next);
  notifyPages(tabId);
  sendRecording(tabId);
  if (changed) onArmedChange?.();
}

function sendRecording(tabId: number): void {
  const recording = isRecording(tabId);
  broadcast(tabId, (port) => sendToPanel(port, { kind: 'tab/recording', tabId, recording }));
}

function cancelDisarm(tabId: number): void {
  const timer = disarmTimers.get(tabId);
  if (timer === undefined) return;
  clearTimeout(timer);
  disarmTimers.delete(tabId);
}

function scheduleDisarm(tabId: number): void {
  cancelDisarm(tabId);
  disarmTimers.set(
    tabId,
    setTimeout(() => {
      disarmTimers.delete(tabId);
      if (hasPanelFor(tabId)) return;
      setTabArmed(tabId, false);
    }, DISARM_GRACE_MS),
  );
}

function hasPanelFor(tabId: number): boolean {
  for (const state of panelPorts.values()) {
    if (state.tabId === tabId) return true;
  }
  return false;
}

function handlePagePort(port: chrome.runtime.Port): void {
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) return;

  let frames = pagePorts.get(tabId);
  if (!frames) {
    frames = new Set();
    pagePorts.set(tabId, frames);
  }
  frames.add(port);
  /*
   * A reload wakes a terminated worker. Answering before session inspect
   * state lands tells the page it is not recording and kills capture.
   */
  void restoreArmedTabs().then(() => {
    if (!pagePorts.get(tabId)?.has(port)) return;
    sendToPage(port, { kind: 'page/armed', armed: isArmed(tabId), recording: isRecording(tabId) });
  });

  port.onDisconnect.addListener(() => {
    frames.delete(port);
    if (frames.size === 0) pagePorts.delete(tabId);
  });

  port.onMessage.addListener((raw) => {
    void Promise.all([restoreFromSession(), restoreArmedTabs()]).then(() =>
      handlePageMessage(tabId, raw as PageToBg),
    );
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
        if (message.fresh) {
          resumeInspectOnReload(tabId);
          clearTab(tabId);
        }
        notifyPages(tabId);
        sendRecording(tabId);
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
      if (!isArmed(tabId) || !isRecording(tabId)) break;
      const entries = addExchanges(tabId, message.exchanges);
      if (entries.length === 0) break;
      const { dropped } = getEntries(tabId);
      broadcast(tabId, (panelPort) =>
        sendToPanel(panelPort, { kind: 'log/append', tabId, entries, dropped }),
      );
      break;
    }
    case 'capture/dropped': {
      if (!isArmed(tabId) || !isRecording(tabId)) break;
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
  port.onDisconnect.addListener(() => {
    const state = panelPorts.get(port);
    panelPorts.delete(port);
    if (state?.tabId === undefined || hasPanelFor(state.tabId)) return;
    const inspected = state.tabId;
    /*
     * Tab-switch fires onDisconnect before onActivated, so a sync "active tab"
     * read still sees this tab and would stop recording. Wait, then only close
     * Inspect if they are still here and the panel did not come back.
     */
    setTimeout(() => {
      if (hasPanelFor(inspected)) return;
      void chrome.tabs
        .get(inspected)
        .then((tab) => {
          if (hasPanelFor(inspected)) return;
          if (tab.status === 'loading') return;
          return chrome.tabs.query({ active: true, lastFocusedWindow: true });
        })
        .then((active) => {
          if (!active) return;
          const current = Array.isArray(active) ? active[0] : undefined;
          if (hasPanelFor(inspected)) return;
          if (current?.id !== undefined && current.id !== inspected) return;
          scheduleDisarm(inspected);
        })
        .catch(() => undefined);
    }, 500);
  });

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
          armOpenedTab(message.tabId);
          void attachToTab(port, message.tabId);
          break;
        }
        void resolveActiveTab(state.windowId).then((tabId) => {
          if (tabId === undefined) return;
          state.tabId = tabId;
          state.pinned = true;
          armOpenedTab(tabId);
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
      case 'log/record':
        if (state.tabId === undefined) return;
        setTabRecording(state.tabId, message.enabled);
        break;
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
  sendToPanel(port, { kind: 'tab/recording', tabId, recording: isRecording(tabId) });
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

function broadcast(tabId: number, send: (port: chrome.runtime.Port) => void): void {
  for (const [port, state] of panelPorts) {
    if (state.tabId === tabId) send(port);
  }
}

function notifyPages(tabId: number): void {
  const frames = pagePorts.get(tabId);
  if (!frames) return;
  const message: BgToPage = {
    kind: 'page/armed',
    armed: isArmed(tabId),
    recording: isRecording(tabId),
  };
  for (const frame of frames) sendToPage(frame, message);
}

function sendLogReset(port: chrome.runtime.Port, tabId: number): void {
  const { entries, dropped } = getEntries(tabId);
  sendToPanel(port, { kind: 'log/reset', tabId, entries, dropped });
}

function sendToPage(port: chrome.runtime.Port, message: BgToPage): void {
  try {
    port.postMessage(message);
  } catch {
    /* port gone */
  }
}

function sendToPanel(port: chrome.runtime.Port, message: BgToPanel): void {
  try {
    port.postMessage(message);
  } catch {
    panelPorts.delete(port);
  }
}
