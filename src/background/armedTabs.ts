/**
 * Tabs the user opened the side panel on, and which of those are recording.
 * Capture is per recording tab — the Record switch is not a browser-wide flag.
 */
const ARMED_KEY = 'armedTabs';
const RECORDING_KEY = 'recordingTabs';

const armed = new Set<number>();
const recording = new Set<number>();

export function isArmed(tabId: number): boolean {
  return armed.has(tabId);
}

export function armedTabIds(): number[] {
  return [...armed];
}

/** Returns whether the set changed. */
export function setArmed(tabId: number, next: boolean): boolean {
  const had = armed.has(tabId);
  if (next) armed.add(tabId);
  else armed.delete(tabId);
  if (had === next) return false;
  persist(ARMED_KEY, armed);
  return true;
}

export function isRecording(tabId: number): boolean {
  return recording.has(tabId);
}

export function recordingTabIds(): number[] {
  return [...recording];
}

/** Returns whether the set changed. */
export function setRecording(tabId: number, next: boolean): boolean {
  const had = recording.has(tabId);
  if (next) recording.add(tabId);
  else recording.delete(tabId);
  if (had === next) return false;
  persist(RECORDING_KEY, recording);
  return true;
}

let restored: Promise<void> | undefined;

/** Safe to call repeatedly: every caller awaits the same session read. */
export function restoreArmedTabs(): Promise<void> {
  restored ??= Promise.all([restoreSet(ARMED_KEY, armed), restoreSet(RECORDING_KEY, recording)]).then(
    () => undefined,
  );
  return restored;
}

async function restoreSet(key: string, target: Set<number>): Promise<void> {
  try {
    const stored = await chrome.storage.session?.get(key);
    const ids = stored?.[key];
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (typeof id === 'number' && Number.isInteger(id) && id >= 0) target.add(id);
    }
  } catch {
    /* session unavailable */
  }
}

function persist(key: string, ids: Set<number>): void {
  void chrome.storage.session?.set({ [key]: [...ids] }).catch(() => undefined);
}
