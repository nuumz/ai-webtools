// The form agent against a page with everything that breaks naive fillers:
// shadow DOM, an iframe, a dependent dropdown and contenteditable.
import { createChecker, loadChromium, openFormPage, startServer } from './harness.mjs';

const field = (key, selectors, value, extra = {}) => ({ key, selectors, value, ...extra });

export default async function run() {
  const t = createChecker('form');
  const chromium = await loadChromium();
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await openFormPage(browser, server.base);

  const fill = (fields) =>
    page.evaluate((payload) => window.__DEV_TOOL_FORM_AGENT__({ kind: 'fill', fields: payload }), fields);

  const result = await fill([
    field('email', [{ strategy: 'testid', value: 'email' }], 'qa+1@dev.local'),
    field('password', [{ strategy: 'id', value: 'password' }], 'hunter2'),
    // Same value as password: the resolver produced it, the agent just types it.
    field('confirmPassword', [{ strategy: 'name', value: 'confirmPassword' }], 'hunter2'),
    field('total', [{ strategy: 'label', value: 'Total' }], '250'),
    field('notes', [{ strategy: 'css', value: '#notes' }], 'filled by the agent'),
    field('newsletter', [{ strategy: 'id', value: 'newsletter' }], 'true'),
    field('shadowField', [{ strategy: 'testid', value: 'shadowField' }], 'inside shadow dom'),
    // First selector is wrong on purpose: the chain must fall through to the second.
    field('qty', [{ strategy: 'id', value: 'does-not-exist' }, { strategy: 'name', value: 'qty' }], '5'),
    field('missing', [{ strategy: 'id', value: 'nope' }], 'x'),
    // Belongs to the iframe, so the top frame must skip it.
    field('childField', [{ strategy: 'id', value: 'childField' }], 'from parent', {
      framePattern: 'frame.html',
    }),
    // Country then city, with a wait: the options do not exist until the app reacts.
    field('country', [{ strategy: 'id', value: 'country' }], 'Thailand', { after: { waitMs: 250 } }),
    field('city', [{ strategy: 'id', value: 'city' }], 'Chiang Mai'),
  ]);

  const values = await page.evaluate(() => {
    const read = (selector) => document.querySelector(selector);
    const shadow = document.querySelector('fancy-input').shadowRoot.querySelector('input');
    return {
      email: read('#email').value,
      password: read('#password').value,
      confirm: read('#confirmPassword').value,
      total: read('#total').value,
      notes: read('#notes').textContent,
      newsletter: read('#newsletter').checked,
      qty: read('#qty').value,
      country: read('#country').value,
      city: read('#city').value,
      shadow: shadow.value,
      events: window.__events.filter((event) => event.id === 'email').map((event) => event.type),
    };
  });

  t.check('fills by test id', values.email, 'qa+1@dev.local');
  t.check('fills by id', values.password, 'hunter2');
  t.check('fills by name', values.confirm, 'hunter2');
  t.check('fills by label text', values.total, '250');
  t.check('fills contenteditable', values.notes, 'filled by the agent');
  t.check('ticks checkboxes', values.newsletter, true);
  t.check('reaches into shadow DOM', values.shadow, 'inside shadow dom');
  t.check('falls through to the next selector', values.qty, '5');
  t.check('selects an option by its visible text', values.country, 'th');
  t.check('waits for a dependent dropdown', values.city, 'chiang-mai');
  t.check('fires input and change like a user', values.events, ['input', 'change']);
  t.check('reports what it could not find', result.misses, ['missing']);
  t.assert(
    'skips fields scoped to another frame',
    !result.filled.includes('childField'),
    result.filled.join(','),
  );

  // The same agent runs in the iframe, which is what allFrames injection does.
  const frame = page.frames().find((candidate) => candidate.url().includes('frame.html'));
  const frameResult = await frame.evaluate(() =>
    window.__DEV_TOOL_FORM_AGENT__({
      kind: 'fill',
      fields: [
        {
          key: 'childField',
          selectors: [{ strategy: 'id', value: 'childField' }],
          value: 'from the iframe',
          framePattern: 'frame.html',
        },
      ],
    }),
  );
  t.check('fills inside an iframe', frameResult.filled, ['childField']);
  t.check('the iframe input really changed', await frame.evaluate(() => document.querySelector('#childField').value), 'from the iframe');

  const recorded = await page.evaluate(() =>
    window.__DEV_TOOL_FORM_AGENT__({ kind: 'record', includeSecrets: false }),
  );
  const byKey = Object.fromEntries(
    recorded.fields.map((entry) => [entry.selectors[0]?.value, entry.value]),
  );
  t.check('records filled values', byKey.email, 'qa+1@dev.local');
  t.assert(
    'leaves passwords out unless asked',
    !recorded.fields.some((entry) => entry.value === 'hunter2'),
    JSON.stringify(byKey),
  );
  t.assert(
    'prefers a test id over a generated selector',
    recorded.fields.some((entry) => entry.selectors[0]?.strategy === 'testid'),
    JSON.stringify(recorded.fields[0]?.selectors),
  );
  // The panel groups a recording by form and lets the read-off-the-page half be
  // dropped, so both marks have to survive the trip out of the agent.
  const email = recorded.fields.find((entry) => entry.selectors[0]?.value === 'email');
  t.check('a real control is marked as one', email?.origin, 'control');
  t.check('and carries the form it sits in', email?.form, 'signup');

  const withSecrets = await page.evaluate(() =>
    window.__DEV_TOOL_FORM_AGENT__({ kind: 'record', includeSecrets: true }),
  );
  t.assert(
    'includes passwords when asked',
    withSecrets.fields.some((entry) => entry.value === 'hunter2'),
    'no password captured',
  );

  // ------------------------------------------------------------------ picker

  // Poll on an interval, not rAF: a child frame's animation frames can be
  // throttled, which made this wait hang instead of resolving.
  //
  // The flag is the live picker's own cancel handle, not a boolean — matching
  // on its type keeps this tied to that contract, so swapping the handle back
  // out for a bare `true` fails here instead of passing by accident.
  const waitForPicker = (target) =>
    target.waitForFunction(() => typeof window.__DEV_TOOL_PICKING__ === 'function', undefined, {
      polling: 50,
      timeout: 5000,
    });

  const pickTop = page.evaluate(() => window.__DEV_TOOL_FORM_AGENT__({ kind: 'pick', sessionId: 's1' }));
  await waitForPicker(page);
  await page.click('#email');
  const picked = await pickTop;
  t.check('picking returns a durable selector first', picked.selectors[0], {
    strategy: 'testid',
    value: 'email',
  });
  t.check('picking reports the current value', picked.value, 'qa+1@dev.local');
  t.assert(
    'the picked selector finds the same element again',
    await page.evaluate(
      (selectors) =>
        document.querySelector(`[data-testid="${selectors[0].value}"]`) ===
        document.querySelector('#email'),
      picked.selectors,
    ),
    'selector did not round-trip',
  );

  const cancelled = page.evaluate(() => window.__DEV_TOOL_FORM_AGENT__({ kind: 'pick', sessionId: 's2' }));
  await waitForPicker(page);
  await page.keyboard.press('Escape');
  t.check('Escape cancels the picker', (await cancelled).selectors, null);

  /*
   * The picker must not set off what it points at: the gesture that picks is
   * the same gesture that presses, and a kit commits on `pointerup` long before
   * a click exists. Pointing at a plain field is harmless, which is why only a
   * control that acts on the pointer can catch this.
   */
  const pickButton = page.evaluate(() =>
    window.__DEV_TOOL_FORM_AGENT__({ kind: 'pick', sessionId: 's2b' }),
  );
  await waitForPicker(page);
  await page.click('#kitButton');
  const pickedButton = await pickButton;
  t.check('picking a kit button returns its selector', pickedButton.selectors?.[0]?.value, 'kitButton');
  t.check(
    'and does not press it on the way',
    await page.evaluate(() => window.__kitPresses),
    [],
  );

  // Every frame runs a picker, but only one gets clicked: the rest must cancel
  // themselves, or executeScript would never settle.
  const topPick = page.evaluate(() => window.__DEV_TOOL_FORM_AGENT__({ kind: 'pick', sessionId: 's3' }));
  const framePick = frame.evaluate(() => window.__DEV_TOOL_FORM_AGENT__({ kind: 'pick', sessionId: 's3' }));
  // Both pickers must be listening before the click, or the frame misses it.
  await Promise.all([waitForPicker(page), waitForPicker(frame)]);
  await frame.click('#childField');
  const [topResult, framePicked] = await Promise.all([topPick, framePick]);
  t.check('the clicked frame returns its selector', framePicked.selectors?.[0]?.value, 'childField');
  t.check('other frames cancel instead of hanging', topResult.selectors, null);

  // --- Action scripts: driving the page rather than filling it -------------
  const act = (steps) =>
    page.evaluate((payload) => window.__DEV_TOOL_FORM_AGENT__({ kind: 'act', steps: payload }), steps);

  const pressed = await act([
    { id: 'a1', label: 'Send', kind: 'click', selectors: [{ strategy: 'id', value: 'kitButton' }] },
  ]);
  t.check('a click step reports ok', pressed.outcomes, [{ id: 'a1', ok: true }]);
  // The kit button listens on `pointerup` as well as `click`, which is the
  // whole point: a control that reacts to the pointer must hear the gesture,
  // and each event exactly once — a repeat here submits a form twice.
  t.check(
    'and the button hears the gesture once, pointer event included',
    await page.evaluate(() => window.__kitPresses),
    ['pointerup', 'click'],
  );

  const sequenced = await act([
    { id: 'b1', label: 'Nowhere', kind: 'click', selectors: [{ strategy: 'id', value: 'no-such-button' }], timeoutMs: 200 },
    { id: 'b2', label: 'Send', kind: 'click', selectors: [{ strategy: 'id', value: 'kitButton' }] },
  ]);
  t.check('a failed step stops the script', sequenced.outcomes, [{ id: 'b1', ok: false, why: 'missing' }]);
  t.check(
    'so the step after it never runs',
    await page.evaluate(() => window.__kitPresses),
    ['pointerup', 'click'],
  );

  // Naming a button by the words on it is the only durable way to point a
  // script at a component kit's buttons — they carry no test id and their
  // generated class names change with every build.
  await page.evaluate(() => (window.__kitPresses.length = 0));
  const byText = await act([
    { id: 'd1', label: 'Send', kind: 'click', selectors: [{ strategy: 'text', value: 'Send' }] },
  ]);
  t.check('a button can be clicked by its own text', byText.outcomes, [{ id: 'd1', ok: true }]);
  t.check(
    'and the click lands on the button, not the box around it',
    await page.evaluate(() => window.__kitPresses),
    ['pointerup', 'click'],
  );

  const checked = await act([
    { id: 'c1', label: 'Wait for the button', kind: 'waitFor', selectors: [{ strategy: 'id', value: 'kitButton' }] },
    { id: 'c2', label: 'Expect the heading', kind: 'assertText', text: 'Send', timeoutMs: 500 },
    { id: 'c3', label: 'Expect nonsense', kind: 'assertText', text: 'not on this page at all', timeoutMs: 300 },
  ]);
  t.check('waitFor and assertText pass, then the missing text stops it', checked.outcomes, [
    { id: 'c1', ok: true },
    { id: 'c2', ok: true },
    { id: 'c3', ok: false, why: 'text' },
  ]);

  await browser.close();
  server.close();
  return t.failures;
}
