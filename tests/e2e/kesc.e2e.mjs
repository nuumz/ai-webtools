// The form agent against the shapes the real KESC webview actually uses: a
// caption that is a sibling div rather than a <label>, a dropdown with no form
// control behind it whose options live in a modal, a date split across three
// unnamed boxes, and inputs that carry the form's own name.
import { createChecker, loadChromium, startServer } from './harness.mjs';

const field = (key, selectors, value, extra = {}) => ({ key, selectors, value, ...extra });
const byCaption = (key, caption, value) => field(key, [{ strategy: 'label', value: caption }], value);

export default async function run() {
  const t = createChecker('kesc');
  const chromium = await loadChromium();
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript({ path: 'dist/formAgent.js' });
  await page.goto(`${server.base}/demo/kesc`);

  const call = (command) => page.evaluate((c) => window.__DEV_TOOL_FORM_AGENT__(c), command);
  const fill = (fields) => call({ kind: 'fill', fields });
  const textOf = (css) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, css);
  const valueOf = (css) => page.evaluate((s) => document.querySelector(s)?.value ?? null, css);

  // ------------------------------------------------------- captions, not labels

  const first = await fill([
    byCaption('docNo', 'เลขที่เอกสารสำคัญ', '3-1008-07249-25-8'),
    byCaption('issuer', 'ออกโดย', 'เขตราษฎร์บูรณะ'),
  ]);
  t.check('an input under a caption is filled', await valueOf('[name=docNo]'), '3-1008-07249-25-8');
  t.check('and so is the one beside it', await valueOf('[name=issuer]'), 'เขตราษฎร์บูรณะ');
  t.check('neither is a miss', (first.misses ?? []).join(','), '');

  // ----------------------------------------------- a dropdown with no control

  const chose = await fill([byCaption('docType', 'ประเภทเอกสารสำคัญ', 'บัตรประชาชน')]);
  t.check('a dropdown with no form control is opened and picked', await textOf('[data-select=docType] span'), 'บัตรประชาชน');
  t.check('and it counts as filled', (chose.filled ?? []).join(','), 'docType');
  t.check('the modal it opened is closed again', await page.evaluate(() => document.getElementById('modal').hidden), true);

  const absent = await fill([byCaption('docType', 'ประเภทเอกสารสำคัญ', 'ใบขับขี่')]);
  t.check('a value the list does not offer is a miss', (absent.misses ?? []).join(','), 'docType');
  t.check('and the modal does not stay open over the form', await page.evaluate(() => document.getElementById('modal').hidden), true);

  const readOnly = await fill([byCaption('nationality', 'สัญชาติ', 'TH - ไทย')]);
  t.check(
    'a dropdown that refuses to open is skipped, not missed',
    (readOnly.skipped ?? []).map((entry) => `${entry.key}:${entry.why}`).join(','),
    'nationality:disabled',
  );
  t.check('and it is not a miss either', (readOnly.misses ?? []).join(','), '');

  // ------------------------------------------------------ a date in three boxes

  const dated = await fill([byCaption('birthDate', 'วันเดือนปีเกิด', '31/12/2530')]);
  t.check(
    'one value is spread across the segments',
    await page.evaluate(() => [...document.querySelectorAll('[data-field=birthDate] input')].map((i) => i.value).join('|')),
    '31|12|2530',
  );
  t.check('and the date is not a miss', (dated.misses ?? []).join(','), '');

  const disabled = await fill([
    field('chkPermanentExpiryDate', [{ strategy: 'name', value: 'chkPermanentExpiryDate' }], 'true'),
    byCaption('expiryDate', 'วันที่หมดอายุ', '31/12/2540'),
  ]);
  t.check(
    'the date ตลอดชีพ disables is skipped, not missed',
    (disabled.skipped ?? []).map((entry) => entry.key).join(','),
    'expiryDate',
  );

  // ------------------------------------------------------ saving what is there

  const captured = await call({ kind: 'record', includeSecrets: false });
  const byLabel = new Map(captured.fields.map((entry) => [entry.label, entry]));

  t.check('the dropdown is saved by its caption', byLabel.get('ประเภทเอกสารสำคัญ')?.selectors[0]?.value, 'ประเภทเอกสารสำคัญ');
  t.check('with the value it shows, and none of its furniture', byLabel.get('ประเภทเอกสารสำคัญ')?.value, 'บัตรประชาชน');
  t.check('the date is one field, not three', byLabel.get('วันเดือนปีเกิด')?.value, '31/12/2530');
  t.check('a segment is not saved on its own', captured.fields.some((entry) => entry.label === 'DD'), false);
  t.check('an input is saved under the caption a person reads', byLabel.get('เลขที่เอกสารสำคัญ')?.value, '3-1008-07249-25-8');
  t.check(
    'a read-only dropdown is still part of the case',
    byLabel.has('สัญชาติ'),
    true,
  );
  t.check('another step contributes nothing', byLabel.has('กรอกรหัส OTP'), false);

  // Everything recorded can be replayed: that is what makes it a test case.
  await page.reload();
  const replay = await fill(
    captured.fields
      .filter((entry) => entry.value && entry.label !== 'สัญชาติ')
      .map((entry) => field(entry.label, entry.selectors, entry.value)),
  );
  t.check('a saved case replays with nothing missing', (replay.misses ?? []).join(','), '');
  t.check('and the dropdown comes back', await textOf('[data-select=docType] span'), 'บัตรประชาชน');

  // -------------------------------------------------------- naming the screen

  const screen = await call({ kind: 'screen', signatures: [{ id: 'customer', texts: ['ยืนยันตัวตนลูกค้า'] }] });
  t.check('the screen is recognised', `${screen.scores[0].matched}/${screen.scores[0].total}`, '1/1');
  t.check('the title is offered first to name it after', screen.sample[0], 'ยืนยันตัวตนลูกค้า');
  t.check(
    'a caption stuck to the field under it is not offered as a title',
    screen.sample.some((entry) => entry.includes('กรุณาเลือก')),
    false,
  );

  // ------------------------------------------------- a frame that cannot answer

  // A frame where the agent throws used to return undefined, which the panel
  // could not tell apart from a page with no fields on it.
  const broken = await page.evaluate(() => window.__DEV_TOOL_FORM_AGENT__({ kind: 'fill' }));
  t.check('a frame that fails says so instead of going quiet', broken.kind, 'error');
  t.check('and it names the frame it failed in', broken.url.includes('/demo/kesc'), true);

  await browser.close();
  server.close();
  return t.failures;
}
