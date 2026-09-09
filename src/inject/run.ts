/**
 * Runs the form agent in the inspected tab.
 *
 * `chrome.scripting.executeScript` with `allFrames` reaches cross-origin
 * iframes too, which is why the extension holds `host_permissions` rather than
 * `activeTab` — the latter is revoked on navigation, so the button would go
 * quiet the moment the user moved to the next page.
 */
import type { FieldSelector, ResolvedFillField } from '../shared/form';
import { randomId } from '../shared/ids';
import { formAgent, type AgentResult, type RecordedField } from './formAgent';

export interface FillOutcome {
  filled: string[];
  misses: string[];
}

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function runFill(tabId: number, fields: ResolvedFillField[]): Promise<FillOutcome> {
  const results = await execute(tabId, { kind: 'fill', fields });

  const filled = new Set<string>();
  for (const result of results) {
    if (result?.kind === 'fill') for (const key of result.filled) filled.add(key);
  }
  return {
    filled: [...filled],
    // A field is only missing when no frame could fill it.
    misses: fields.map((field) => field.key).filter((key) => !filled.has(key)),
  };
}

export async function runRecord(tabId: number, includeSecrets: boolean): Promise<RecordedField[]> {
  const results = await execute(tabId, { kind: 'record', includeSecrets });
  const fields: RecordedField[] = [];
  for (const result of results) {
    if (result?.kind === 'record') fields.push(...result.fields);
  }
  return fields;
}

export interface PickOutcome {
  selectors: FieldSelector[];
  label?: string;
  value?: string;
}

/** Resolves once the user clicks in one frame; the other frames cancel themselves. */
export async function runPick(tabId: number): Promise<PickOutcome | null> {
  const results = await execute(tabId, { kind: 'pick', sessionId: randomId('pk_') });
  for (const result of results) {
    if (result?.kind === 'pick' && result.selectors && result.selectors.length > 0) {
      return { selectors: result.selectors, label: result.label, value: result.value };
    }
  }
  return null;
}

async function execute(
  tabId: number,
  command: Parameters<typeof formAgent>[0],
): Promise<(AgentResult | undefined)[]> {
  const injected = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: formAgent,
    args: [command],
  });
  // Frames that cannot be injected (about:blank, sandboxed) simply return nothing.
  return injected.map((entry) => entry.result as AgentResult | undefined);
}
