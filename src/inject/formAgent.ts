/**
 * The only code that runs inside the inspected page.
 *
 * Chrome serialises this function with `Function.prototype.toString()`, so it
 * MUST be self-contained: no imports, no module-scope constants, nothing but
 * its arguments and its own nested helpers. Type-only imports are erased by
 * TypeScript and are therefore safe.
 */
import type { FieldSelector, ResolvedFillField } from '../shared/form';

export interface RecordedField {
  selectors: FieldSelector[];
  value: string;
  label?: string;
}

export type AgentCommand =
  | { kind: 'fill'; fields: ResolvedFillField[] }
  | { kind: 'record'; includeSecrets: boolean }
  | { kind: 'pick' };

export type AgentResult =
  | { kind: 'fill'; filled: string[]; misses: string[] }
  | { kind: 'record'; fields: RecordedField[] }
  /** `selectors: null` means the user cancelled, or another frame was picked. */
  | { kind: 'pick'; selectors: FieldSelector[] | null; label?: string; value?: string };

export async function formAgent(command: AgentCommand): Promise<AgentResult> {
  // ------------------------------------------------------------- DOM helpers

  /** Collects matches across the document and every open shadow root. */
  function deepQuery(selector: string): Element[] {
    const found: Element[] = [];
    const visit = (root: Document | ShadowRoot): void => {
      try {
        found.push(...root.querySelectorAll(selector));
      } catch {
        return; // Malformed selector: treat as no match.
      }
      for (const element of root.querySelectorAll('*')) {
        const shadow = (element as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
        if (shadow) visit(shadow);
      }
    };
    visit(document);
    return found;
  }

  function isVisible(element: Element): boolean {
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function isUsable(element: Element): boolean {
    if (!isVisible(element)) return false;
    const control = element as HTMLInputElement;
    return !control.disabled && !control.readOnly;
  }

  function escapeAttr(value: string): string {
    return value.replace(/["\\]/g, '\\$&');
  }

  /** Turns one selector into candidate elements. */
  function candidates(selector: FieldSelector): Element[] {
    const value = selector.value.trim();
    if (!value) return [];

    switch (selector.strategy) {
      case 'testid':
        return deepQuery(`[data-testid="${escapeAttr(value)}"]`);
      case 'id':
        return deepQuery(`[id="${escapeAttr(value)}"]`);
      case 'name':
        return deepQuery(`[name="${escapeAttr(value)}"]`);
      case 'aria':
        return deepQuery(`[aria-label="${escapeAttr(value)}"]`);
      case 'placeholder':
        return deepQuery(`[placeholder="${escapeAttr(value)}"]`);
      case 'css':
        return deepQuery(value);
      case 'label': {
        // Match the label's text, then follow it to the control it names.
        const wanted = value.toLowerCase();
        const controls: Element[] = [];
        for (const label of deepQuery('label')) {
          const text = (label.textContent ?? '').trim().toLowerCase();
          if (text !== wanted) continue;
          const target = label.getAttribute('for');
          const control = target
            ? (label.getRootNode() as Document | ShadowRoot).querySelector(`[id="${escapeAttr(target)}"]`)
            : label.querySelector('input, select, textarea, [contenteditable]');
          if (control) controls.push(control);
        }
        return controls;
      }
    }
  }

  /** First selector that identifies exactly one usable element wins. */
  function resolveField(selectors: FieldSelector[]): Element | null {
    for (const selector of selectors) {
      const usable = candidates(selector).filter(isUsable);
      if (usable.length === 1) return usable[0];
      // Ambiguous or missing: fall through to the next, more specific selector.
    }
    return null;
  }

  function nativeSetter(element: Element, property: 'value' | 'checked'): ((value: unknown) => void) | undefined {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    return descriptor?.set?.bind(element) as ((value: unknown) => void) | undefined;
  }

  function fire(element: Element, ...types: string[]): void {
    for (const type of types) element.dispatchEvent(new Event(type, { bubbles: true }));
  }

  /** Writes a value the way a user would, so framework value trackers notice. */
  function setValue(element: Element, value: string): boolean {
    if (element instanceof HTMLSelectElement) {
      const options = [...element.options];
      const match =
        options.find((option) => option.value === value) ??
        options.find((option) => option.text.trim().toLowerCase() === value.trim().toLowerCase());
      if (!match) return false;
      const setter = nativeSetter(element, 'value');
      if (setter) setter(match.value);
      else element.value = match.value;
      fire(element, 'input', 'change');
      return true;
    }

    if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
      const shouldCheck = value === 'true' || value === '1' || value === 'yes' || value === 'on';
      const setter = nativeSetter(element, 'checked');
      if (setter) setter(shouldCheck);
      else element.checked = shouldCheck;
      fire(element, 'input', 'change');
      return true;
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const setter = nativeSetter(element, 'value');
      if (setter) setter(value);
      else element.value = value;
      fire(element, 'input', 'change');
      return true;
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      element.focus();
      element.textContent = value;
      fire(element, 'input', 'change');
      return true;
    }

    return false;
  }

  function readValue(element: Element): string {
    if (element instanceof HTMLSelectElement) return element.value;
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox' || element.type === 'radio') return String(element.checked);
      return element.value;
    }
    if (element instanceof HTMLTextAreaElement) return element.value;
    if (element instanceof HTMLElement && element.isContentEditable) return element.textContent ?? '';
    return '';
  }

  function labelFor(element: Element): string | undefined {
    const labels = (element as HTMLInputElement).labels;
    const text = labels?.[0]?.textContent?.trim();
    if (text) return text;
    const wrapper = element.closest('label')?.textContent?.trim();
    if (wrapper) return wrapper;
    return (
      element.getAttribute('aria-label') ??
      element.getAttribute('placeholder') ??
      element.getAttribute('name') ??
      undefined
    );
  }

  /** Generated ids change on every render and make useless selectors. */
  function looksGenerated(id: string): boolean {
    return /^(:r|mui-|radix-|headlessui-|react-aria|\d)/.test(id) || /^[0-9a-f]{8,}$/i.test(id);
  }

  function cssPath(element: Element): string {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && parts.length < 5 && current !== document.documentElement) {
      const parent: Element | null = current.parentElement;
      if (!parent) break;
      const sameTag = [...parent.children].filter((child) => child.tagName === current!.tagName);
      const index = sameTag.indexOf(current) + 1;
      parts.unshift(sameTag.length > 1 ? `${current.tagName.toLowerCase()}:nth-of-type(${index})` : current.tagName.toLowerCase());
      current = parent;
    }
    return parts.join(' > ');
  }

  /**
   * Candidate selectors, most durable first — the same order Testing Library
   * recommends, because those are the ones that survive a re-render.
   */
  function buildSelectors(element: Element): FieldSelector[] {
    const selectors: FieldSelector[] = [];
    const testid = element.getAttribute('data-testid') ?? element.getAttribute('data-test-id');
    if (testid) selectors.push({ strategy: 'testid', value: testid });

    const id = element.getAttribute('id');
    if (id && !looksGenerated(id)) selectors.push({ strategy: 'id', value: id });

    const name = element.getAttribute('name');
    if (name) selectors.push({ strategy: 'name', value: name });

    const labels = (element as HTMLInputElement).labels;
    const labelText = labels?.[0]?.textContent?.trim();
    if (labelText) selectors.push({ strategy: 'label', value: labelText });

    const aria = element.getAttribute('aria-label');
    if (aria) selectors.push({ strategy: 'aria', value: aria });

    const placeholder = element.getAttribute('placeholder');
    if (placeholder) selectors.push({ strategy: 'placeholder', value: placeholder });

    const path = cssPath(element);
    if (path) selectors.push({ strategy: 'css', value: path });

    return selectors;
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------------------------------------------------------------- commands

  if (command.kind === 'fill') {
    const filled: string[] = [];
    const misses: string[] = [];

    // Sequential on purpose: a dependent dropdown only has its options once
    // the field before it has changed and the app has re-rendered.
    for (const field of command.fields) {
      // Substring match, not a glob: the agent cannot import the URL matcher.
      if (field.framePattern && !location.href.includes(field.framePattern)) continue;

      const element = resolveField(field.selectors);
      if (!element) {
        misses.push(field.key);
        continue;
      }
      if (!setValue(element, field.value)) {
        misses.push(field.key);
        continue;
      }
      filled.push(field.key);

      if (field.after?.blur && element instanceof HTMLElement) {
        element.blur();
        fire(element, 'blur', 'focusout');
      }
      if (field.after?.click && element instanceof HTMLElement) element.click();
      if (field.after?.waitMs) await sleep(field.after.waitMs);
    }

    return { kind: 'fill', filled, misses };
  }

  if (command.kind === 'pick') {
    return await new Promise<AgentResult>((resolve) => {
      let settled = false;

      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647';
      const shadow = host.attachShadow({ mode: 'closed' });

      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;border:2px solid #4f46e5;background:rgba(79,70,229,.15);' +
        'border-radius:3px;pointer-events:none';
      const hint = document.createElement('div');
      hint.textContent = 'Click a field · Esc to cancel';
      hint.style.cssText =
        'position:fixed;left:8px;bottom:8px;padding:6px 10px;border-radius:6px;' +
        'background:#0f172a;color:#fff;font:12px system-ui;pointer-events:none';
      shadow.append(box, hint);
      (document.body ?? document.documentElement).append(host);

      const targetOf = (event: Event): Element | null => {
        const path = event.composedPath();
        const first = path[0];
        return first instanceof Element ? first : null;
      };

      const onMove = (event: MouseEvent): void => {
        const element = targetOf(event);
        if (!element) return;
        const rect = element.getBoundingClientRect();
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
      };

      const onClick = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        const element = targetOf(event);
        if (!element) return;
        cancelEverywhere();
        finish({
          kind: 'pick',
          selectors: buildSelectors(element),
          label: labelFor(element),
          value: readValue(element),
        });
      };

      const onKey = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        cancelEverywhere();
        finish({ kind: 'pick', selectors: null });
      };

      /**
       * Every frame runs its own picker, but only one is clicked. Without this
       * the others never settle, and executeScript waits for all of them.
       */
      const onMessage = (event: MessageEvent): void => {
        const data = event.data as { __devToolPick?: string } | null;
        if (!data || data.__devToolPick !== 'cancel') return;
        relayDown();
        finish({ kind: 'pick', selectors: null });
      };

      const relayDown = (): void => {
        for (let index = 0; index < window.frames.length; index += 1) {
          try {
            window.frames[index].postMessage({ __devToolPick: 'cancel' }, '*');
          } catch {
            // Cross-origin frames still accept a '*' post; anything else is not ours.
          }
        }
      };

      const cancelEverywhere = (): void => {
        try {
          window.top?.postMessage({ __devToolPick: 'cancel' }, '*');
        } catch {
          // No parent access: the local relay below still covers our children.
        }
        relayDown();
      };

      const finish = (result: AgentResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        host.remove();
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('click', onClick, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('message', onMessage);
        resolve(result);
      };

      // Backstop: never leave a frame's promise pending forever.
      const timer = setTimeout(() => finish({ kind: 'pick', selectors: null }), 60_000);

      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('click', onClick, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('message', onMessage);
    });
  }

  const recorded: RecordedField[] = [];
  for (const element of deepQuery('input, select, textarea, [contenteditable=""], [contenteditable="true"]')) {
    if (!isVisible(element)) continue;
    const type = (element as HTMLInputElement).type;
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'file') continue;
    if (type === 'password' && !command.includeSecrets) continue;

    const value = readValue(element);
    if (!value || value === 'false') continue;
    recorded.push({ selectors: buildSelectors(element), value, label: labelFor(element) });
  }
  return { kind: 'record', fields: recorded };
}

declare global {
  interface Window {
    __DEV_TOOL_FORM_AGENT__?: typeof formAgent;
  }
}

// Lets the e2e suite drive the very same agent the panel injects.
if (typeof window !== 'undefined') window.__DEV_TOOL_FORM_AGENT__ = formAgent;
