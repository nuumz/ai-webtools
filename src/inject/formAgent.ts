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
  /** Set only when the label is repeated, so the field can be told from its twin. */
  anchor?: { text: string };
}

export type AgentCommand =
  | { kind: 'fill'; fields: ResolvedFillField[] }
  | { kind: 'record'; includeSecrets: boolean }
  /** Which of these screens is on show right now. */
  | { kind: 'screen'; signatures: { id: string; texts: string[] }[] }
  /** `sessionId` scopes the cancel broadcast to this picking session. */
  | { kind: 'pick'; sessionId: string };

/** Why a field was left alone: it is on the screen, but not fillable right now. */
export interface SkippedField {
  key: string;
  why: 'hidden' | 'disabled';
}

/** Written, but the app did not keep it — a mask, a native date, a re-render. */
export interface RejectedField {
  key: string;
  wanted: string;
  got: string;
}

export type AgentResult =
  /**
   * `misses` is a broken selector; `skipped` is a field the screen answered for
   * — another wizard step's input, or one a checkbox disabled. Folding the two
   * together is what makes a working profile look broken.
   */
  | {
      kind: 'fill';
      filled: string[];
      misses: string[];
      skipped: SkippedField[];
      rejected: RejectedField[];
    }
  | { kind: 'record'; fields: RecordedField[]; url: string }
  /** How much of each signature this frame can see, so the panel can rank them. */
  | { kind: 'screen'; scores: { id: string; matched: number; total: number }[]; sample: string[] }
  /** `selectors: null` means the user cancelled, or another frame was picked. */
  | { kind: 'pick'; selectors: FieldSelector[] | null; label?: string; value?: string }
  /**
   * A frame where the agent itself failed.
   *
   * Without this a frame that threw returns `undefined`, which reads exactly
   * like a frame that had nothing to say — so a broken agent and an empty page
   * produce the same silent "0 fields", and there is nothing to debug from.
   */
  | { kind: 'error'; message: string; url: string };

export async function formAgent(command: AgentCommand): Promise<AgentResult> {
  try {
    return await run(command);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { kind: 'error', message, url: location.href };
  }

  async function run(command: AgentCommand): Promise<AgentResult> {
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
      if (control.disabled || control.readOnly) return false;
      // A segmented field is usable while any one of its boxes still is: ticking
      // ตลอดชีพ disables the segments, not the box that holds them.
      const segments = segmentsOf(element);
      return segments.length === 0 || segments.some((segment) => !segment.disabled && !segment.readOnly);
    }

    /**
     * Compares visible text the way a person reads it: composed Thai, no
     * zero-width joiners, one space between words, and without the marker glyphs
     * a form puts next to a required label. toLowerCase is kept for Latin and is
     * a no-op on Thai.
     */
    function normalise(text: string): string {
      return text
        .normalize('NFC')
        .replace(/[\u200b-\u200d\ufeff\u00a0]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s*:：＊]+|[\s*:：＊]+$/g, '')
        .toLowerCase();
    }

    function textMatches(actual: string, wanted: string): boolean {
      const left = normalise(actual);
      const right = normalise(wanted);
      if (!right) return false;
      return left === right || left.startsWith(right) || left.endsWith(right);
    }

    /**
     * The text of an element as a person reads it: an element's own words plus
     * its visible children, with a break wherever the layout puts one.
     *
     * Collecting only childless elements — the obvious walk — loses the text of
     * any element that also has a child, and a real app writes its step title as
     * `<div>ยืนยันตัวตน<span>ลูกค้า</span></div>`. The two halves never join, so
     * the screen it names can never be recognised.
     */
    function visibleTextOf(element: Element): string {
      let out = '';
      for (const node of element.childNodes) {
        if (node.nodeType === 3) {
          out += node.nodeValue ?? '';
          continue;
        }
        if (node.nodeType !== 1) continue;
        const child = node as Element;
        if (!isVisible(child)) continue;
        const display = getComputedStyle(child).display;
        // Inline runs are one phrase; a block is its own line, so unrelated
        // neighbours cannot be read as one string.
        const inline = display.startsWith('inline') || display === 'contents';
        out += inline ? visibleTextOf(child) : ` \n ${visibleTextOf(child)} \n `;
      }
      return out;
    }

    /** How much this element looks like the name of the screen. */
    function headingWeight(element: Element, style: CSSStyleDeclaration): number {
      const semantic =
        /^H[1-6]$/.test(element.tagName) ||
        element.tagName === 'LEGEND' ||
        element.getAttribute('role') === 'heading' ||
        element.hasAttribute('aria-current');
      const size = Number.parseFloat(style.fontSize) || 0;
      const bold = (Number.parseInt(style.fontWeight, 10) || 400) >= 600;
      return (semantic ? 100 : 0) + size * 2 + (bold ? 5 : 0);
    }

    /**
     * Texts worth offering as a screen signature, most prominent first.
     *
     * Ranked by how the text is PAINTED, not by its tag: an app that titles its
     * step with a styled div rather than an h2 would otherwise offer the user
     * nothing to pick, which reads as the feature being broken.
     */
    function headingCandidates(): string[] {
      const scored: { text: string; weight: number }[] = [];
      const all = document.body.querySelectorAll('*');
      const limit = Math.min(all.length, 4000);

      for (let index = 0; index < limit; index += 1) {
        const element = all[index];
        if (!isVisible(element)) continue;
        const raw = visibleTextOf(element).trim();
        // A heading is one line. Anything spanning a line break is a container
        // that swept up a caption and the field under it.
        if (/[\n\r]/.test(raw)) continue;
        const text = raw.replace(/\s+/g, ' ').trim();
        if (text.length < 2 || text.length > 80) continue;
        // A control-less block under a caption is a widget's value, not a title.
        if (!holdsControl(element) && captionOf(element) !== undefined) continue;
        // Only the innermost element that owns the text, never its wrappers.
        if ([...element.children].some((child) => visibleTextOf(child).replace(/\s+/g, ' ').trim() === text)) {
          continue;
        }
        scored.push({ text, weight: headingWeight(element, getComputedStyle(element)) });
      }

      const seenTexts = new Set<string>();
      return scored
        .sort((left, right) => right.weight - left.weight)
        .filter((entry) => !seenTexts.has(entry.text) && seenTexts.add(entry.text))
        .map((entry) => entry.text)
        .slice(0, 12);
    }

    const CONTROLS = 'input, select, textarea, [contenteditable]';

    /**
     * The control a label names: by `for`, then one it wraps, then the first in
     * its own row. Thai forms commonly print the label as a sibling above the
     * input with neither `for` nor nesting, which the first two rules cannot see.
     */
    function controlFor(label: Element): Element | null {
      const target = label.getAttribute('for');
      if (target) {
        const byId = (label.getRootNode() as Document | ShadowRoot).querySelector(`[id="${escapeAttr(target)}"]`);
        if (byId) return byId;
      }
      return label.querySelector(CONTROLS) ?? label.parentElement?.querySelector(CONTROLS) ?? null;
    }

    function escapeAttr(value: string): string {
      return value.replace(/["\\]/g, '\\$&');
    }

    /** The text an element shows, collapsed to one line. */
    function collapsed(element: Element): string {
      return visibleTextOf(element).replace(/\s+/g, ' ').trim();
    }

    function holdsControl(element: Element): boolean {
      return element.querySelector(CONTROLS) !== null;
    }

    /**
     * A field whose value is spread over several unnamed boxes — a date as
     * DD / MM / YYYY is the common one. Named controls are excluded: those are
     * separate fields that merely sit together.
     */
    function segmentsOf(element: Element): HTMLInputElement[] {
      if (element instanceof HTMLInputElement) return [];
      const inputs = [...element.querySelectorAll('input')].filter(
        (input) => isVisible(input) && !input.name && !input.id,
      );
      return inputs.length >= 2 ? inputs : [];
    }

    /**
     * The widget a caption governs.
     *
     * Real forms do not associate a caption with `for`: the bank's kit prints it
     * as the previous sibling inside a column, and a dropdown there renders NO
     * form control at all — no select, no name, no role, just a div that opens a
     * list when clicked. So the caption is followed until something fillable is
     * found, and what that something IS is decided by what it contains.
     */
    function widgetForCaption(caption: Element): Element | null {
      let node: Element | null = caption;
      for (let hop = 0; node && hop < 3; hop += 1) {
        for (let next = node.nextElementSibling; next; next = next.nextElementSibling) {
          if (!isVisible(next)) continue;
          if (segmentsOf(next).length > 0) return next;
          const control = next.querySelector(CONTROLS);
          if (control) return control;
          // No control anywhere: a custom widget. Its trigger is the innermost
          // element that still carries the whole box's text.
          if (collapsed(next)) {
            let trigger = next;
            while (trigger.children.length === 1 && collapsed(trigger.children[0]) === collapsed(trigger)) {
              trigger = trigger.children[0];
            }
            return trigger;
          }
        }
        node = node.parentElement;
      }
      return null;
    }

    /** The caption printed for a widget, when nothing associates the two. */
    function captionOf(element: Element): string | undefined {
      let node: Element | null = element;
      for (let hop = 0; node && hop < 3; hop += 1) {
        for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
          if (!isVisible(prev) || prev.matches(CONTROLS) || holdsControl(prev)) continue;
          if (/[\n\r]/.test(visibleTextOf(prev).trim())) continue;
          const text = collapsed(prev);
          if (text && text.length <= 80) return text;
        }
        node = node.parentElement;
      }
      return undefined;
    }

    /** Captions that read as `value`, resolved to the widget each one governs. */
    function captionCandidates(value: string): Element[] {
      const exact: Element[] = [];
      const loose: Element[] = [];
      for (const element of document.body.querySelectorAll('*')) {
        if (!isVisible(element) || holdsControl(element)) continue;
        const text = collapsed(element);
        if (!text || text.length > 80) continue;
        const equal = normalise(text) === normalise(value);
        if (!equal && !textMatches(text, value)) continue;
        const widget = widgetForCaption(element);
        if (widget) (equal ? exact : loose).push(widget);
      }
      return exact.length > 0 ? exact : loose;
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
          const exact: Element[] = [];
          const loose: Element[] = [];
          for (const label of deepQuery('label')) {
            const text = label.textContent ?? '';
            const equal = normalise(text) === normalise(value);
            if (!equal && !textMatches(text, value)) continue;
            const control = controlFor(label);
            if (control) (equal ? exact : loose).push(control);
          }
          // "ชื่อ" must not drag in "ชื่อกลาง": the loose pass is only a fallback
          // for a label the markup decorated, never a competitor to a real match.
          const found = exact.length > 0 ? exact : loose;
          return found.length > 0 ? found : captionCandidates(value);
        }
      }
    }

    /** The nearest ancestor whose text carries the anchor, or null. */
    function scopeFor(element: Element, text: string): Element | null {
      let current: Element | null = element.parentElement;
      while (current) {
        if (normalise(current.textContent ?? '').includes(normalise(text))) return current;
        current = current.parentElement;
      }
      return null;
    }

    /**
     * Keeps the candidates that sit in the anchored section. Every candidate has
     * SOME ancestor carrying the text — <body> does — so the tightest scope wins:
     * an outer one only matched because it wraps the inner one.
     */
    function withinAnchor(elements: Element[], text: string): Element[] {
      const scoped: { element: Element; scope: Element }[] = [];
      for (const element of elements) {
        const scope = scopeFor(element, text);
        if (scope) scoped.push({ element, scope });
      }
      if (scoped.length <= 1) return scoped.map((entry) => entry.element);
      return scoped
        .filter((entry) => !scoped.some((other) => other.scope !== entry.scope && entry.scope.contains(other.scope)))
        .map((entry) => entry.element);
    }

    type Resolution =
      | { kind: 'ok'; element: Element }
      | { kind: 'skip'; why: 'hidden' | 'disabled' }
      | { kind: 'missing' };

    /**
     * First selector that identifies exactly one usable element wins. When every
     * selector finds the element but it cannot be written — another step is
     * showing, or a checkbox disabled it — say so instead of calling it a miss.
     */
    /**
     * A radio group is one field with N controls, so "ambiguous" is the wrong
     * answer: the value names which member to pick, by its value attribute or by
     * the label beside it.
     */
    function chooseRadio(elements: Element[], value: string): Element | undefined {
      const radios = elements.filter(
        (element) => element instanceof HTMLInputElement && element.type === 'radio',
      ) as HTMLInputElement[];
      if (radios.length !== elements.length || radios.length < 2) return undefined;
      return (
        radios.find((radio) => radio.value === value) ??
        radios.find((radio) => {
          const label = labelFor(radio);
          return label !== undefined && normalise(label) === normalise(value);
        }) ??
        radios.find((radio) => {
          const label = labelFor(radio);
          return label !== undefined && textMatches(label, value);
        })
      );
    }

    function resolveField(selectors: FieldSelector[], anchor?: { text: string }, value?: string): Resolution {
      let blocked: 'hidden' | 'disabled' | undefined;

      for (const selector of selectors) {
        const found = anchor ? withinAnchor(candidates(selector), anchor.text) : candidates(selector);
        const usable = found.filter(isUsable);
        if (usable.length === 1) return { kind: 'ok', element: usable[0] };
        if (usable.length > 1) {
          const chosen = value === undefined ? undefined : chooseRadio(usable, value);
          if (chosen) return { kind: 'ok', element: chosen };
          continue; // Ambiguous: a later, more specific selector may not be.
        }
        for (const element of found) {
          // Hidden outranks disabled: a field on another step is not "disabled".
          if (!isVisible(element)) blocked = 'hidden';
          else if (blocked === undefined) blocked = 'disabled';
        }
      }
      return blocked ? { kind: 'skip', why: blocked } : { kind: 'missing' };
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

    /**
     * Whether this box or radio should end up ticked. A radio takes the name of
     * the member to choose — 'ผ่าน' means "this one", not "false".
     */
    function wantsChecked(element: HTMLInputElement, value: string): boolean {
      if (element.type === 'radio') {
        const label = labelFor(element);
        if (element.value === value) return true;
        if (label !== undefined && textMatches(label, value)) return true;
      }
      return value === 'true' || value === '1' || value === 'yes' || value === 'on';
    }

    /** `shut` means the widget would not even open — a read-only dropdown. */
    type Written = 'ok' | 'no' | 'shut';

    /** Writes a value the way a user would, so framework value trackers notice. */
    async function setValue(element: Element, value: string): Promise<Written> {
      if (element instanceof HTMLSelectElement) {
        const options = [...element.options];
        const match =
          options.find((option) => option.value === value) ??
          options.find((option) => normalise(option.text) === normalise(value)) ??
          options.find((option) => option.text.trim() && textMatches(option.text, value));
        if (!match) return 'no';
        const setter = nativeSetter(element, 'value');
        if (setter) setter(match.value);
        else element.value = match.value;
        fire(element, 'input', 'change');
        return 'ok';
      }

      if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
        const shouldCheck = wantsChecked(element, value);
        if (element.checked !== shouldCheck) {
          // A real click is what a framework's own onChange listens for; setting
          // `.checked` alone leaves the app's state untouched behind a box that
          // looks ticked.
          element.click();
        }
        if (element.checked !== shouldCheck) {
          const setter = nativeSetter(element, 'checked');
          if (setter) setter(shouldCheck);
          else element.checked = shouldCheck;
          fire(element, 'input', 'change');
        }
        return 'ok';
      }

      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const setter = nativeSetter(element, 'value');
        if (setter) setter(value);
        else element.value = value;
        fire(element, 'input', 'change');
        return 'ok';
      }

      if (element instanceof HTMLElement && element.isContentEditable) {
        element.focus();
        element.textContent = value;
        fire(element, 'input', 'change');
        return 'ok';
      }

      const segments = segmentsOf(element);
      if (segments.length > 0) {
        // "31/12/2530" is one value to the form and three boxes to the DOM.
        const parts = value.split(/[^0-9A-Za-z]+/).filter(Boolean);
        if (parts.length === 0) return 'no';
        let written = false;
        for (let index = 0; index < Math.min(parts.length, segments.length); index += 1) {
          const segment = segments[index];
          if (segment.disabled || segment.readOnly) continue;
          segment.focus();
          const setter = nativeSetter(segment, 'value');
          if (setter) setter(parts[index]);
          else segment.value = parts[index];
          fire(segment, 'input', 'change');
          written = true;
        }
        return written ? 'ok' : 'no';
      }

      if (element instanceof HTMLElement) {
        const outcome = await openAndPick(element, value);
        return outcome === 'picked' ? 'ok' : outcome === 'shut' ? 'shut' : 'no';
      }
      return 'no';
    }

    /** Every element a person can currently see. */
    function visibleNow(): Set<Element> {
      const seen = new Set<Element>();
      for (const element of document.querySelectorAll('*')) if (isVisible(element)) seen.add(element);
      return seen;
    }

    /**
     * Picks a value from a widget that has no form control behind it.
     *
     * The options do not exist until the trigger is clicked, and where they then
     * appear is the kit's business — a modal, a portal at the end of <body>, a
     * popover. So rather than knowing any of that, this clicks and then looks for
     * what BECAME visible: whatever newly appeared and reads as the wanted value
     * is the option, and clicking it is what tells the app its value changed.
     */
    async function openAndPick(trigger: HTMLElement, wanted: string): Promise<'picked' | 'empty' | 'shut'> {
      const before = visibleNow();
      trigger.click();

      let opened = false;
      for (let waited = 0; waited <= 1500; waited += 60) {
        const fresh: Element[] = [];
        for (const element of document.querySelectorAll('*')) {
          if (!before.has(element) && isVisible(element)) fresh.push(element);
        }
        if (fresh.length > 0) opened = true;

        const options = fresh.filter((element) => {
          const text = collapsed(element);
          return text !== '' && (normalise(text) === normalise(wanted) || textMatches(text, wanted));
        });
        // The innermost match is the option itself; the others are its wrappers.
        const option = options.sort((left, right) => left.children.length - right.children.length)[0];
        if (option instanceof HTMLElement) {
          option.click();
          await sleep(60);
          return 'picked';
        }
        await sleep(60);
      }

      if (opened) await closeOverlay(trigger, before);
      // Nothing opened at all: the widget refused the click, which is what a
      // read-only dropdown does. That is a skip, not a value we failed to find.
      return opened ? 'empty' : 'shut';
    }

    /** Puts back a list that was opened and had nothing worth clicking. */
    async function closeOverlay(trigger: HTMLElement, before: Set<Element>): Promise<void> {
      const stillOpen = (): Element[] => {
        const fresh: Element[] = [];
        for (const element of document.querySelectorAll('*')) {
          if (!before.has(element) && isVisible(element)) fresh.push(element);
        }
        return fresh;
      };

      for (const key of ['keydown', 'keyup'] as const) {
        document.dispatchEvent(new KeyboardEvent(key, { key: 'Escape', bubbles: true }));
      }
      await sleep(60);
      if (stillOpen().length === 0) return;

      // No Esc handler: click the outermost thing that appeared, which is the
      // backdrop every such kit puts behind its list.
      const fresh = stillOpen();
      const backdrop = fresh.find((element) => !fresh.some((other) => other !== element && other.contains(element)));
      if (backdrop instanceof HTMLElement) backdrop.click();
      await sleep(60);
      if (stillOpen().length > 0) trigger.click();
    }

    function readValue(element: Element): string {
      if (element instanceof HTMLSelectElement) return element.value;
      if (element instanceof HTMLInputElement) {
        if (element.type === 'checkbox' || element.type === 'radio') return String(element.checked);
        return element.value;
      }
      if (element instanceof HTMLTextAreaElement) return element.value;
      if (element instanceof HTMLElement && element.isContentEditable) return element.textContent ?? '';
      const segments = segmentsOf(element);
      if (segments.length > 0) {
        const parts = segments.map((segment) => segment.value);
        return parts.some(Boolean) ? parts.join('/') : '';
      }
      // A widget with no control shows its value; there is nowhere else to read.
      // Its own furniture is not part of that value: a caret is not an answer.
      return collapsed(element)
        .split(' ')
        .filter((word) => /[\p{L}\p{N}]/u.test(word))
        .join(' ');
    }

    function labelFor(element: Element): string | undefined {
      const labels = (element as HTMLInputElement).labels;
      const text = labels?.[0]?.textContent?.trim();
      if (text) return text;
      const wrapper = element.closest('label')?.textContent?.trim();
      if (wrapper) return wrapper;
      // A label printed above the input, associated by nothing but layout.
      for (const label of element.parentElement?.querySelectorAll(':scope > label') ?? []) {
        if (controlFor(label) !== element) continue;
        const sibling = label.textContent?.trim();
        if (sibling) return sibling;
      }
      return (
        element.getAttribute('aria-label') ??
        element.getAttribute('placeholder') ??
        // Ahead of `name`, behind `placeholder`: a caption says what a person
        // sees, but a segment already labelled DD must not become the whole date.
        captionOf(element) ??
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

      if (!labelText && !element.matches(CONTROLS)) {
        const caption = captionOf(element);
        if (caption) selectors.push({ strategy: 'label', value: caption });
      }

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

    /** True once the control can take the value — options loaded, and so on. */
    function isReady(element: Element, waitFor: { optionText?: string; minOptions?: number }): boolean {
      if (!(element instanceof HTMLSelectElement)) return true;
      if (waitFor.minOptions !== undefined && element.options.length < waitFor.minOptions) return false;
      if (waitFor.optionText !== undefined) {
        return [...element.options].some((option) => textMatches(option.text, waitFor.optionText as string));
      }
      return true;
    }

    /**
     * Resolves the field, polling while it declares a readiness condition. A
     * select whose options arrive from the network has none when its step first
     * paints, and the only tool before this was a fixed sleep on the field
     * BEFORE it — which never ran when that field itself missed.
     */
    async function resolveWhenReady(field: ResolvedFillField): Promise<Resolution> {
      const waitFor = field.waitFor;
      let resolution = resolveField(field.selectors, field.anchor, field.value);
      if (!waitFor) return resolution;

      const deadline = Date.now() + (waitFor.timeoutMs ?? 3000);
      while (Date.now() < deadline) {
        if (resolution.kind === 'ok' && isReady(resolution.element, waitFor)) return resolution;
        await sleep(100);
        resolution = resolveField(field.selectors, field.anchor, field.value);
      }
      return resolution;
    }

    /**
     * Did the app keep what was written? "setValue returned true" is not the same
     * thing: a mask can strip the value, a native date input drops a string it
     * cannot parse, and a re-render can revert a controlled input — all of which
     * used to be reported as a successful fill. Masks legitimately reformat, so
     * only the characters that carry meaning are compared.
     */
    function kept(element: Element, wanted: string): boolean {
      const got = readValue(element);
      if (got === wanted) return true;
      if (element instanceof HTMLSelectElement) {
        const option = element.selectedOptions[0];
        return option !== undefined && (option.value === wanted || textMatches(option.text, wanted));
      }
      if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
        return element.checked === wantsChecked(element, wanted);
      }
      const bare = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '');
      if (bare(got) === bare(wanted)) return true;
      // A custom widget renders its choice next to its own furniture — a caret,
      // a clear button — so the value it now shows only has to contain what was
      // asked for, not equal it.
      return !holdsControl(element) && bare(wanted) !== '' && bare(got).includes(bare(wanted));
    }

    if (command.kind === 'fill') {
      const filled: string[] = [];
      const misses: string[] = [];
      const skipped: SkippedField[] = [];
      const rejected: RejectedField[] = [];

      // Sequential on purpose: a dependent dropdown only has its options once
      // the field before it has changed and the app has re-rendered.
      for (const field of command.fields) {
        // Substring match, not a glob: the agent cannot import the URL matcher.
        if (field.framePattern && !location.href.includes(field.framePattern)) continue;

        const resolution = await resolveWhenReady(field);
        if (resolution.kind === 'skip') {
          skipped.push({ key: field.key, why: resolution.why });
          continue;
        }
        if (resolution.kind === 'missing') {
          misses.push(field.key);
          continue;
        }
        const element = resolution.element;
        const written = await setValue(element, field.value);
        if (written === 'shut') {
          skipped.push({ key: field.key, why: 'disabled' });
          continue;
        }
        if (written === 'no') {
          misses.push(field.key);
          continue;
        }
        if (!kept(element, field.value)) {
          rejected.push({ key: field.key, wanted: field.value, got: readValue(element) });
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

      return { kind: 'fill', filled, misses, skipped, rejected };
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

        /**
         * Picks on the way DOWN, not on `click`.
         *
         * A framework app re-renders while the button is still held: the node
         * under the pointer is replaced between mousedown and mouseup, and a
         * `click` event is then never dispatched at all. Waiting for one leaves
         * the picker armed forever, which is indistinguishable from a picker
         * that was never injected — the frame just goes quiet.
         */
        const onDown = (event: MouseEvent | PointerEvent): void => {
          if (settled) return;
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const element = targetOf(event);
          if (!element) return;
          try {
            const picked: AgentResult = {
              kind: 'pick',
              selectors: buildSelectors(element),
              label: labelFor(element),
              value: readValue(element),
            };
            cancelEverywhere();
            finish(picked);
          } catch (error) {
            // Never leave the promise pending: a picker that threw has to say
            // so, or it looks exactly like one that was never armed.
            cancelEverywhere();
            finish({
              kind: 'error',
              message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
              url: location.href,
            });
          }
        };

        /** Keeps the app from acting on the gesture we already consumed. */
        const swallow = (event: Event): void => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
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
         *
         * The session id matters: a cancel broadcast from a previous pick can
         * still be in flight when the next one starts, and would otherwise kill
         * it the moment it opened.
         */
        const onMessage = (event: MessageEvent): void => {
          const data = event.data as { __devToolPick?: string; session?: string } | null;
          if (!data || data.__devToolPick !== 'cancel') return;
          if (data.session !== command.sessionId) return;
          relayDown();
          finish({ kind: 'pick', selectors: null });
        };

        const relayDown = (): void => {
          for (let index = 0; index < window.frames.length; index += 1) {
            try {
              window.frames[index].postMessage(
                { __devToolPick: 'cancel', session: command.sessionId },
                '*',
              );
            } catch {
              // Cross-origin frames still accept a '*' post; anything else is not ours.
            }
          }
        };

        const cancelEverywhere = (): void => {
          try {
            window.top?.postMessage({ __devToolPick: 'cancel', session: command.sessionId }, '*');
          } catch {
            // No parent access: the local relay below still covers our children.
          }
          relayDown();
        };

        const finish = (result: AgentResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          delete (window as unknown as Record<string, unknown>).__DEV_TOOL_PICKING__;
          host.remove();
          window.removeEventListener('mousemove', onMove, true);
          window.removeEventListener('pointerdown', onDown, true);
          window.removeEventListener('mousedown', onDown, true);
          window.removeEventListener('keydown', onKey, true);
          // The gesture that picked still has a mouseup and a click to come:
          // let those be swallowed, then stop listening.
          setTimeout(() => {
            window.removeEventListener('mouseup', swallow, true);
            window.removeEventListener('click', swallow, true);
          }, 0);
          window.removeEventListener('message', onMessage);
          resolve(result);
        };

        // Backstop: never leave a frame's promise pending forever.
        const timer = setTimeout(() => finish({ kind: 'pick', selectors: null }), 60_000);

        // Observable marker: the picker is only live once its listeners are attached.
        (window as unknown as Record<string, unknown>).__DEV_TOOL_PICKING__ = true;
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('pointerdown', onDown, true);
        window.addEventListener('mousedown', onDown, true);
        window.addEventListener('mouseup', swallow, true);
        window.addEventListener('click', swallow, true);
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('message', onMessage);
      });
    }

    if (command.kind === 'screen') {
      /*
       * Only text a person can see counts. A wizard keeps the other steps in the
       * DOM, so matching textContent would report every screen at once — which is
       * the same blindness that made framePattern useless here.
       */
      const seen = normalise(visibleTextOf(document.body));
      // A count, not a verdict: two screens can both be present in part, and only
      // the panel knows which of them the user was working on.
      const scores = command.signatures.map((signature) => ({
        id: signature.id,
        matched: signature.texts.filter((text) => text.trim() && seen.includes(normalise(text))).length,
        total: signature.texts.filter((text) => text.trim()).length,
      }));

      return { kind: 'screen', scores, sample: headingCandidates() };
    }

    /** The heading of the block a control sits in, e.g. "ชื่อ-นามสกุล (ไทย)". */
    function sectionFor(element: Element): string | undefined {
      let current: Element | null = element.parentElement;
      while (current) {
        const section = current.getAttribute('data-section');
        if (section) return section;
        const heading = current.querySelector(':scope > strong, :scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4');
        const text = heading?.textContent?.trim();
        if (text) return text;
        current = current.parentElement;
      }
      return undefined;
    }

    /*
     * Only what is on the screen right now, and all of it: a field left blank and
     * a box left unticked are the test case, not noise — dropping them means a
     * saved case cannot put the form back the way it was found.
     *
     * Recording is a READ, so read-only counts. Whether a value can be written
     * back is the fill side's question, and it already answers it honestly with
     * `skipped` and `rejected`; leaving those fields out here instead would empty
     * a recording of every date and dropdown that renders behind a picker.
     */
    const candidatesToRecord: Element[] = [];
    const seenWidgets = new Set<Element>();
    for (const element of deepQuery('input, select, textarea, [contenteditable=""], [contenteditable="true"]')) {
      if (!isVisible(element) || (element as HTMLInputElement).disabled) continue;
      const type = (element as HTMLInputElement).type;
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'file') continue;
      if (type === 'password' && !command.includeSecrets) continue;
      const group = element.parentElement;
      // A segmented field is one value: record the group, never its boxes.
      if (group && segmentsOf(group).includes(element as HTMLInputElement)) {
        if (!seenWidgets.has(group)) {
          seenWidgets.add(group);
          candidatesToRecord.push(group);
        }
        continue;
      }
      candidatesToRecord.push(element);
    }

    // Widgets with no form control behind them — the kit's own dropdowns — are
    // invisible to a sweep over inputs, so they are found through their captions.
    for (const caption of document.body.querySelectorAll('*')) {
      if (!isVisible(caption) || holdsControl(caption)) continue;
      const text = collapsed(caption);
      if (!text || text.length > 80 || /[\n\r]/.test(visibleTextOf(caption).trim())) continue;
      for (let next = caption.nextElementSibling; next; next = next.nextElementSibling) {
        if (!isVisible(next)) continue;
        if (holdsControl(next) || segmentsOf(next).length > 0) break;
        const widget = widgetForCaption(caption);
        const says = widget ? collapsed(widget) : '';
        const inside = [...seenWidgets].some((known) => known.contains(caption));
        if (widget && !holdsControl(widget) && !inside && !seenWidgets.has(widget) && /[\p{L}\p{N}]/u.test(says)) {
          seenWidgets.add(widget);
          candidatesToRecord.push(widget);
        }
        break;
      }
    }

    const labelCounts = new Map<string, number>();
    for (const element of candidatesToRecord) {
      const label = normalise(labelFor(element) ?? '');
      if (label) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }

    const recorded: RecordedField[] = [];
    for (const element of candidatesToRecord) {
      const label = labelFor(element);
      const repeated = label !== undefined && (labelCounts.get(normalise(label)) ?? 0) > 1;
      const section = repeated ? sectionFor(element) : undefined;
      recorded.push({
        selectors: buildSelectors(element),
        value: readValue(element),
        label,
        ...(section ? { anchor: { text: section } } : {}),
      });
    }
    return { kind: 'record', fields: recorded, url: location.href };
  }
}

declare global {
  interface Window {
    __DEV_TOOL_FORM_AGENT__?: typeof formAgent;
  }
}

// Lets the e2e suite drive the very same agent the panel injects.
if (typeof window !== 'undefined') window.__DEV_TOOL_FORM_AGENT__ = formAgent;
