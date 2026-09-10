// The form agent against a wizard shaped like the app it is used on: Thai
// labels carrying required markers, a name block repeated in two languages,
// several steps behind one URL, a checkbox that disables its neighbours, and a
// select whose options arrive from the network.
import { createChecker, loadChromium, startServer } from './harness.mjs';

const field = (key, selectors, value, extra = {}) => ({ key, selectors, value, ...extra });

export default async function run() {
  const t = createChecker('wizard');
  const chromium = await loadChromium();
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript({ path: 'dist/formAgent.js' });
  await page.goto(`${server.base}/demo/wizard`);

  const fill = (fields) =>
    page.evaluate((payload) => window.__DEV_TOOL_FORM_AGENT__({ kind: 'fill', fields: payload }), fields);
  const valueOf = (selector) => page.evaluate((css) => document.querySelector(css)?.value ?? null, selector);

  // ---------------------------------------------------------------- labels

  const labelled = await fill([
    // The live label is "ประเภทเอกสารสำคัญ*" — the marker span is part of its text.
    field('docType', [{ strategy: 'label', value: 'ประเภทเอกสารสำคัญ' }], 'บัตรประชาชน'),
    field('docNumber', [{ strategy: 'label', value: 'เลขที่เอกสารสำคัญ' }], '3-1008-07249-25-8'),
  ]);
  t.check('a Thai label matches through its required marker', await valueOf('#docType'), 'CID');
  t.check('the id under that label is filled', await valueOf('#docNumber'), '3-1008-07249-25-8');
  t.check('neither label field is reported as a miss', (labelled.misses ?? []).join(','), '');

  // ------------------------------------------------------------- anchoring

  await fill([
    field('firstNameTh', [{ strategy: 'label', value: 'ชื่อ' }], 'กุลชรี', {
      anchor: { text: 'ชื่อ-นามสกุล (ไทย)' },
    }),
    field('firstNameEn', [{ strategy: 'label', value: 'ชื่อ' }], 'KULCHAREE', {
      anchor: { text: 'ชื่อ-นามสกุล (อังกฤษ)' },
    }),
  ]);
  t.check('a label repeated in two blocks resolves inside its own block', await valueOf('[name=firstNameTh]'), 'กุลชรี');
  t.check('and the other block gets its own value', await valueOf('[name=firstNameEn]'), 'KULCHAREE');

  // ----------------------------------------------- another step's fields

  const mixed = await fill([
    field('issuedBy', [{ strategy: 'id', value: 'issuedBy' }], 'ท้องที่เขตราษฎร์บูรณะ'),
    // Belongs to Service Detail, which is not the step on screen.
    field('otp', [{ strategy: 'id', value: 'otp' }], '123456'),
    // Belongs to no step at all: a genuinely broken selector.
    field('ghost', [{ strategy: 'id', value: 'no-such-field' }], 'x'),
  ]);
  t.check('a field on the current step is filled', await valueOf('#issuedBy'), 'ท้องที่เขตราษฎร์บูรณะ');
  t.check('a field belonging to another step is not written', await valueOf('#otp'), '');
  t.check(
    'a field on another step is skipped, not missed',
    (mixed.skipped ?? []).map((entry) => entry.key).join(','),
    'otp',
  );
  t.check('only the broken selector is a miss', (mixed.misses ?? []).join(','), 'ghost');

  // ------------------------------------------------- conditional fields

  const conditional = await fill([
    field('lifetime', [{ strategy: 'id', value: 'lifetime' }], 'true'),
    field('expiryDay', [{ strategy: 'id', value: 'expiryDay' }], '31'),
  ]);
  t.check('the checkbox is ticked', await page.evaluate(() => document.getElementById('lifetime').checked), true);
  t.check(
    'the field it disables is skipped, not missed',
    (conditional.skipped ?? []).map((entry) => `${entry.key}:${entry.why}`).join(','),
    'expiryDay:disabled',
  );
  t.check('a disabled field is not a miss', (conditional.misses ?? []).join(','), '');

  // ------------------------------------------------ late-loading options

  await page.click('#toDetail');
  const late = await fill([
    field('fundAccount', [{ strategy: 'id', value: 'fundAccount' }], '001-2-34567-8', {
      waitFor: { optionText: '001-2-34567-8', timeoutMs: 2000 },
    }),
  ]);
  t.check('a select whose options arrive late is filled', await valueOf('#fundAccount'), '001');
  t.check('and it is not reported as a miss', (late.misses ?? []).join(','), '');

  // ------------------------------------------------------------ radio groups

  await page.click('#toCustomer');
  const radio = await fill([
    field('checkResult', [{ strategy: 'name', value: 'checkResult' }], 'ผ่าน'),
  ]);
  t.check(
    'a radio group picks the member named by the value',
    await page.evaluate(() => document.querySelector('[name=checkResult][value=PASS]').checked),
    true,
  );
  t.check('and the other member is left alone', (radio.misses ?? []).join(','), '');

  // ---------------------------------------------------------------- readback

  const masked = await fill([
    field('docNumber', [{ strategy: 'id', value: 'docNumber' }], 'ABCDEF'),
  ]);
  t.check(
    'a value the app threw away is reported, not counted as filled',
    (masked.rejected ?? []).map((entry) => `${entry.key}:${entry.got}`).join(','),
    'docNumber:',
  );
  t.check('and it is not in filled', (masked.filled ?? []).join(','), '');

  // ----------------------------------------------------- recognising a screen

  const screen = (signatures) =>
    page.evaluate((payload) => window.__DEV_TOOL_FORM_AGENT__({ kind: 'screen', signatures: payload }), signatures);

  const SIGNATURES = [
    { id: 'customer', texts: ['ยืนยันตัวตนลูกค้า'] },
    { id: 'detail', texts: ['ข้อมูลการทำรายการ'] },
    { id: 'both', texts: ['ยืนยันตัวตนลูกค้า', 'ข้อมูลการทำรายการ'] },
  ];

  const scoreOf = (result, id) => {
    const score = result.scores.find((entry) => entry.id === id);
    return `${score.matched}/${score.total}`;
  };

  const onCustomer = await screen(SIGNATURES);
  t.check('the step on screen scores in full', scoreOf(onCustomer, 'customer'), '1/1');
  t.check('the step that is not showing scores zero', scoreOf(onCustomer, 'detail'), '0/1');
  t.check('a signature spanning two steps is only half seen', scoreOf(onCustomer, 'both'), '1/2');
  t.check(
    'a heading is offered to name the screen after',
    (await screen([])).sample.includes('ยืนยันตัวตนลูกค้า'),
    true,
  );

  await page.click('#toDetail');
  const onDetail = await screen(SIGNATURES);
  t.check('and it follows the step, with no navigation', scoreOf(onDetail, 'detail'), '1/1');
  await page.click('#toCustomer');

  // ------------------------------------------------- saving what is on screen

  const captured = await page.evaluate(() =>
    window.__DEV_TOOL_FORM_AGENT__({ kind: 'record', includeSecrets: false }),
  );
  const byKey = new Map(captured.fields.map((entry) => [entry.selectors[0]?.value, entry]));

  t.check('a field left blank is part of the case', byKey.get('middleNameTh')?.value, '');
  t.check('a box left unticked is part of the case', byKey.get('checkResult')?.value, 'false');
  t.check(
    'a repeated label is saved with the block it belongs to',
    byKey.get('firstNameTh')?.anchor?.text,
    'ชื่อ-นามสกุล (ไทย)',
  );
  t.check(
    'a label that is unique carries no anchor',
    byKey.get('issuedBy')?.anchor ?? null,
    null,
  );
  t.check(
    'another step contributes nothing',
    captured.fields.some((entry) => entry.selectors.some((selector) => selector.value === 'otp')),
    false,
  );
  t.check(
    'a read-only summary row is not a field',
    captured.fields.some((entry) => entry.value === 'KEFI3MI'),
    false,
  );
  t.check(
    'a field the case disabled is not captured as fillable',
    captured.fields.some((entry) => entry.selectors.some((selector) => selector.value === 'expiryDay')),
    false,
  );

  // ------------------------------------------- the app inside a device simulator

  // The tab holds only the simulator's chrome; the app paints in an iframe, and
  // very often on another origin. Every answer has to come from the app's frame.
  for (const [what, query] of [['same-origin', ''], ['cross-origin', '?cross=1']]) {
    const outer = await browser.newPage();
    await outer.addInitScript({ path: 'dist/formAgent.js' });
    await outer.goto(`${server.base}/demo/device${query}`);
    const app = await (await outer.waitForSelector('#app')).contentFrame();
    await app.waitForSelector('#docType');

    const inFrame = (frame) =>
      frame.evaluate((payload) => window.__DEV_TOOL_FORM_AGENT__({ kind: 'screen', signatures: payload }), SIGNATURES);

    t.check(
      `the app's frame recognises the screen behind a ${what} simulator`,
      scoreOf(await inFrame(app), 'customer'),
      '1/1',
    );
    t.check(
      `the simulator's own frame recognises nothing (${what})`,
      scoreOf(await inFrame(outer.mainFrame()), 'customer'),
      '0/1',
    );

    const filled = await app.evaluate(
      (payload) => window.__DEV_TOOL_FORM_AGENT__({ kind: 'fill', fields: payload }),
      [{ key: 'issuedBy', selectors: [{ strategy: 'id', value: 'issuedBy' }], value: 'เขตราษฎร์บูรณะ' }],
    );
    t.check(`and it is filled there (${what})`, (filled.filled ?? []).join(','), 'issuedBy');

    // Pick runs in every frame at once and only one is clicked; the rest have to
    // cancel themselves, or executeScript waits on them forever.
    const session = `pk_${what}`;
    const both = Promise.all([
      outer.mainFrame().evaluate((id) => window.__DEV_TOOL_FORM_AGENT__({ kind: 'pick', sessionId: id }), session),
      app.evaluate((id) => window.__DEV_TOOL_FORM_AGENT__({ kind: 'pick', sessionId: id }), session),
    ]);
    await app.waitForFunction(() => typeof window.__DEV_TOOL_PICKING__ === 'function');
    await app.click('#docNumber');
    const settled = await Promise.race([
      both,
      new Promise((resolve) => setTimeout(() => resolve('timed out'), 5000)),
    ]);
    t.check(
      `a pick inside a ${what} simulator returns the field that was clicked`,
      settled === 'timed out' ? 'timed out' : (settled[1].selectors ?? [])[0]?.value,
      'docNumber',
    );
    t.check(
      `and the simulator's own frame stands down (${what})`,
      settled === 'timed out' ? 'timed out' : settled[0].selectors,
      null,
    );

    await outer.close();
  }

  await browser.close();
  server.close();
  return t.failures;
}
