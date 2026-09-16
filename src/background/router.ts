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
import { TOP_FRAME_ID, type FrameInfo } from '../shared/frames';

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

/**
 * One frame's connection and what it looks like.
 *
 * `port.sender.frameId` is handed to us for free and belongs to the frame
 * rather than the document, so it keeps naming the same iframe after that
 * iframe navigates — which is what lets a working frame be chosen once.
 */
interface FrameEntry {
  port: chrome.runtime.Port;
  frameId: number;
  url: string;
  depth: number;
  inputs: number;
  heading?: string;
}

const panelPorts = new Map<chrome.runtime.Port, PanelState>();
const pagePorts = new Map<number, Map<number, FrameEntry>>();
/** Last known top-frame URL per tab, learned from `page/hello` (no `tabs` permission needed). */
const tabUrls = new Map<number, string>();
/** The frame each tab's panel acts in. Absent means every frame, as before. */
const workingFrames = new Map<number, number>();
const WORKING_FRAMES_KEY = 'workingFrames';

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
    if (workingFrames.delete(tabId)) persistWorkingFrames();
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
  void reviveTab(tabId);
}

/**
 * A tab that was open before the extension — or whose scripts were orphaned when
 * it was reloaded — runs no content scripts, and only a page reload brings them
 * back. Inject them instead, so opening the panel is enough to start seeing
 * traffic. Both scripts stand down if they are already installed in a frame.
 */
async function reviveTab(tabId: number): Promise<void> {
  if ((pagePorts.get(tabId)?.size ?? 0) > 0) return;
  const inject = (files: string[], world: chrome.scripting.ExecutionWorld) =>
    chrome.scripting
      .executeScript({ target: { tabId, allFrames: true }, files, world })
      .catch(() => undefined);

  // MAIN first, matching the manifest order: the interceptor asks for config on
  // boot, and the bridge must be the one that answers.
  await inject(['interceptor.main.js'], 'MAIN');
  await inject(['bridge.isolated.js'], 'ISOLATED');
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

/** Only the flip matters: extra frames on a connected tab say nothing new. */
function sendPages(tabId: number): void {
  const connected = (pagePorts.get(tabId)?.size ?? 0) > 0;
  broadcast(tabId, (port) => sendToPanel(port, { kind: 'tab/pages', tabId, connected }));
}

function sendRecording(tabId: number): void {
  const recording = isRecording(tabId);
  broadcast(tabId, (port) => sendToPanel(port, { kind: 'tab/recording', tabId, recording }));
}

/** The frames in a tab, shallowest first, with the one the panel acts in. */
function frameList(tabId: number): FrameInfo[] {
  const frames = pagePorts.get(tabId);
  if (!frames) return [];
  return [...frames.values()]
    .map(({ frameId, url, depth, inputs, heading }) => ({ frameId, url, depth, inputs, heading }))
    .sort((a, b) => a.depth - b.depth || a.frameId - b.frameId);
}

function sendFrames(tabId: number): void {
  const frames = frameList(tabId);
  const workingFrameId = workingFrames.get(tabId);
  broadcast(tabId, (port) =>
    sendToPanel(port, { kind: 'frame/list', tabId, frames, workingFrameId }),
  );
}

/** Asks every frame in the tab what it looks like; each answers with `page/frame`. */
function describeFrames(tabId: number): void {
  const frames = pagePorts.get(tabId);
  if (!frames) return;
  for (const frame of frames.values()) sendToPage(frame.port, { kind: 'page/describe' });
}

/**
 * The chosen frame survives the worker being torn down for being idle, the same
 * way the armed and recording tab sets do.
 */
async function restoreWorkingFrames(): Promise<void> {
  if (workingFrames.size > 0) return;
  try {
    const stored = await chrome.storage.session?.get(WORKING_FRAMES_KEY);
    const pairs = stored?.[WORKING_FRAMES_KEY];
    if (!Array.isArray(pairs)) return;
    for (const pair of pairs) {
      if (Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number') {
        workingFrames.set(pair[0], pair[1]);
      }
    }
  } catch {
    // No session storage: the panel re-picks, which is the pre-existing behaviour.
  }
}

function persistWorkingFrames(): void {
  void chrome.storage.session
    ?.set({ [WORKING_FRAMES_KEY]: [...workingFrames.entries()] })
    .catch(() => undefined);
}

/** Which frame a tab's actions target, or undefined for every frame. */
export function workingFrameFor(tabId: number): number | undefined {
  return workingFrames.get(tabId);
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
  // Free from the platform, and the only stable name a frame has. `sender.url`
  // is the frame's own URL, not the page hosting it.
  const frameId = port.sender?.frameId ?? TOP_FRAME_ID;

  let frames = pagePorts.get(tabId);
  if (!frames) {
    frames = new Map();
    pagePorts.set(tabId, frames);
  }
  const first = frames.size === 0;
  frames.set(frameId, {
    port,
    frameId,
    url: port.sender?.url ?? '',
    // Both are filled in by the frame's own `page/frame` reply; until then the
    // top frame is the only one whose depth we can state.
    depth: frameId === TOP_FRAME_ID ? 0 : 1,
    inputs: 0,
  });
  if (first) sendPages(tabId);
  sendFrames(tabId);
  /*
   * A reload wakes a terminated worker. Answering before session inspect
   * state lands tells the page it is not recording and kills capture.
   */
  void restoreArmedTabs().then(() => {
    if (pagePorts.get(tabId)?.get(frameId)?.port !== port) return;
    sendToPage(port, { kind: 'page/armed', armed: isArmed(tabId), recording: isRecording(tabId) });
  });

  port.onDisconnect.addListener(() => {
    // A frame that navigated reconnects under the same id, so only drop the
    // entry when it is still the one this port owns.
    if (frames.get(frameId)?.port === port) frames.delete(frameId);
    if (frames.size > 0) {
      sendFrames(tabId);
      return;
    }
    pagePorts.delete(tabId);
    sendPages(tabId);
    sendFrames(tabId);
  });

  port.onMessage.addListener((raw) => {
    void Promise.all([restoreFromSession(), restoreArmedTabs(), restoreWorkingFrames()]).then(() =>
      handlePageMessage(tabId, frameId, raw as PageToBg),
    );
  });
}

function handlePageMessage(tabId: number, frameId: number, message: PageToBg): void {
  switch (message.kind) {
    case 'page/hello': {
      // Every frame's own URL, including an iframe that just navigated. The
      // tab-level bookkeeping below still belongs to the top frame alone.
      const entry = pagePorts.get(tabId)?.get(frameId);
      if (entry) {
        entry.url = message.url;
        if (message.isTop) entry.depth = 0;
        sendFrames(tabId);
      }
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
    }
    case 'page/frame': {
      const entry = pagePorts.get(tabId)?.get(frameId);
      if (!entry) break;
      entry.url = message.info.url;
      entry.depth = message.info.depth;
      entry.inputs = message.info.inputs;
      entry.heading = message.info.heading;
      sendFrames(tabId);
      break;
    }
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
      case 'frame/refresh':
        if (state.tabId === undefined) return;
        describeFrames(state.tabId);
        break;
      case 'frame/select': {
        if (state.tabId === undefined) return;
        if (message.frameId === undefined) workingFrames.delete(state.tabId);
        else workingFrames.set(state.tabId, message.frameId);
        persistWorkingFrames();
        sendFrames(state.tabId);
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
  sendToPanel(port, { kind: 'tab/recording', tabId, recording: isRecording(tabId) });
  // The panel starts out knowing nothing; every later change is a flip it hears about.
  sendToPanel(port, {
    kind: 'tab/pages',
    tabId,
    connected: (pagePorts.get(tabId)?.size ?? 0) > 0,
  });
  await restoreWorkingFrames();
  sendToPanel(port, {
    kind: 'frame/list',
    tabId,
    frames: frameList(tabId),
    workingFrameId: workingFrames.get(tabId),
  });
  // The counts a frame list is worth reading for arrive on the replies.
  describeFrames(tabId);
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
  for (const frame of frames.values()) sendToPage(frame.port, message);
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
