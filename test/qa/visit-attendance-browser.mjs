// Full-App acceptance using only fictional records and intercepted virtual-origin routes.
// Observes transient native dialog focus, not just final activeElement. It does not
// emulate a real iPhone keyboard or install browsers/dependencies.
// PLAYWRIGHT_PACKAGE_JSON or PLAYWRIGHT_MODULE locates existing tooling;
// QA_BROWSER_ENGINE, QA_BROWSER_EXECUTABLE and QA_OUTPUT_DIR are optional.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON ? path.resolve(process.env.PLAYWRIGHT_PACKAGE_JSON) : import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch { throw new Error('Provide an already installed Playwright module via PLAYWRIGHT_MODULE or PLAYWRIGHT_PACKAGE_JSON. This test installs nothing.'); }
const engine = process.env.QA_BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit', 'firefox'].includes(engine), 'Unsupported browser engine');
const browser = await playwright[engine].launch({ headless: true, ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-attendance-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18449';
const report = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, engine, browserVersion: browser.version(), realIPhone: false, thirdPartyKeyboard: false, scenarios: [], focusEvidence: [] };

async function isolated(width, { empty = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 393 ? 852 : 1000 }, serviceWorkers: 'block', timezoneId: 'Asia/Taipei' });
  const page = await context.newPage(), errors = [], external = [], apiRequests = [], nativeConfirms = [];
  page.on('dialog', async dialog => { nativeConfirms.push({ type: dialog.type(), message: dialog.message() }); if (dialog.type() === 'confirm') await dialog.accept(); else await dialog.dismiss(); });
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (url.pathname === '/qa-seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fictional keyboard intent QA</title>' });
    if (url.pathname.startsWith('/api/')) { apiRequests.push(url.pathname); return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated fictional QA: no App service connected"}' }); }
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ contentType, body: fs.readFileSync(file) });
  });
  await page.addInitScript(() => {
    window.qaFocusEvents = []; window.qaHidden = false;
    window.qaTextEntry = el => !!el && (el.isContentEditable || el.matches?.('textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="range"]):not([type="color"])'));
    const descriptor = el => ({ tag: el?.tagName || '', id: el?.id || '', inlineId: el?.dataset?.inlineEditText || '', type: el?.type || '', textEntry: window.qaTextEntry(el), dialog: el?.closest?.('dialog')?.id || '' });
    window.qaFocusDescriptor = descriptor;
    document.addEventListener('focusin', event => window.qaFocusEvents.push({ event: 'focusin', duringShow: window.qaShowingDialog || '', ...descriptor(event.target) }), true);
    const showModal = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function (...args) {
      window.qaFocusEvents.push({ event: 'showModal-start', dialog: this.id }); window.qaShowingDialog = this.id;
      try { return showModal.apply(this, args); }
      finally { window.qaFocusEvents.push({ event: 'showModal-end', ...descriptor(document.activeElement) }); window.qaShowingDialog = ''; }
    };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.qaHidden });
  });
  await page.goto(origin + '/qa-seed');
  const initialBundle = await page.evaluate(async empty => {
    if (empty) return null;
    const c = await import('/core.js'), db = await import('/db.js'), meta = c.newMeta(), key = await c.derive('fictional-keyboard-qa-only', meta), bundle = c.emptyBundle(meta.vaultId);
    const store = name => ({ name, city: '', district: '', channel: '', attr: '', contact: '', everyTimeMust: '虛構每次提醒' });
    let storeA = c.addReminderTasks(store('虛構拜訪甲店'), '虛構待辦甲\n虛構待辦乙\n虛構已完成任務');
    storeA = c.completeReminderTask(storeA, storeA.nextRememberTasks[2].id);
    bundle.ops.push(c.revision('store', 'qa-store-a', storeA, [], 'qa'));
    bundle.ops.push(c.revision('store', 'qa-store-b', store('虛構拜訪乙店'), [], 'qa'));
    const text = Array.from({ length: 16 }, (_, i) => `第 ${i + 1} 行虛構拜訪筆記。${i === 1 || i === 12 ? ' Complete 原文命中。' : ''}`).join('\n');
    const visit = (store, text) => ({ store, date: '2026-09-01', source: '虛構來源', text, next: '', topics: [], people: [], attachments: [] });
    bundle.ops.push(c.revision('visit', 'qa-note', visit('qa-store-a', text), [], 'qa'), c.revision('visit', 'qa-other', visit('qa-store-b', '虛構乙店原文'), [], 'qa'));
    const bytes = new TextEncoder().encode('name,note\r\nSynthetic,immutable source\r\n'), blob = await c.hashBytes(bytes); bundle.blobs[blob] = c.b64(bytes);
    bundle.ops.push(c.revision('source', 'qa-source', { file: 'fictional-attendance.csv', list: 'Fictional', blob, batch: 'qa', rows: 1, headers: ['name', 'note'], encoding: 'utf-8', delimiter: ',' }, [], 'qa'));
    c.validateBundle(bundle);
    await db.writeLocal(await c.seal({ schema: 1, device: 'qa-device', deviceName: 'Fictional Keyboard QA', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, lastHealthAudit: new Date().toISOString() }, key, meta, 'device'), 0, key);
    return bundle;
  }, empty);
  await page.goto(origin + '/'); await page.locator(empty ? '#gate-form' : '#workspace').waitFor({ state: 'visible' }); await page.waitForTimeout(180);
  const boot = await page.evaluate(() => window.qaFocusEvents);
  assert.equal(boot.some(event => event.textEntry), false, 'App boot must not briefly focus a text entry');
  return { context, page, width, errors, external, apiRequests, nativeConfirms, initialBundle };
}
async function snapshot(page) {
  return page.evaluate(async () => { const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal(); return slot ? { revision: slot.revision, envelope: slot.envelope, payload: await c.unseal(slot.envelope, slot.unlockKey, 'device') } : null; });
}
async function stored(page, predicate) {
  for (let n = 0; n < 70; n++) { const value = await snapshot(page); if (predicate(value)) return value; await page.waitForTimeout(100); }
  throw new Error('Timed out waiting for encrypted fictional draft/commit');
}
async function noAuto(t, label, action, { unchanged = false } = {}) {
  const { page, width } = t, before = unchanged ? await snapshot(page) : null;
  const start = await page.evaluate(() => window.qaFocusEvents.length);
  await action(); await page.waitForTimeout(230);
  const evidence = await page.evaluate(start => ({ events: window.qaFocusEvents.slice(start), active: window.qaFocusDescriptor(document.activeElement) }), start);
  report.focusEvidence.push({ width, label, ...evidence });
  assert.equal(evidence.events.some(event => event.textEntry), false, `${label}: transient automatic text focus: ${JSON.stringify(evidence)}`);
  assert.equal(evidence.active.textEntry, false, `${label}: text input remains focused`);
  if (unchanged) assert.deepEqual(await snapshot(page), before, `${label}: encrypted slot must stay byte-for-byte unchanged`);
}
async function explicitText(page, selector) {
  const field = page.locator(selector); await field.click();
  assert.equal(await field.evaluate(el => document.activeElement === el && window.qaTextEntry(el)), true, `Direct click must focus ${selector}`);
  return field;
}
async function closeDialogs(page) {
  assert.equal(await page.locator('#visit-attendance-dialog').isVisible(), false, 'Finish the pending confirmation first');
  for (const id of ['quick-text-dialog', 'store-reminder-dialog', 'editor', 'review']) if (await page.locator('#' + id).isVisible()) await page.locator(`#${id} [data-close="${id}"]`).first().click();
}
async function openStore(page) {
  await closeDialogs(page); await page.locator('.rail [data-view="stores"]').click();
  await page.locator('#stores-view [data-visit-brief="qa-store-a"]').click();
}
async function openEditorButton(page, selector) {
  const button = page.locator(selector);
  const details = button.locator('xpath=ancestor::details[1]'); if (await details.count()) await details.locator(':scope > summary').click();
  await button.click();
}
const routes = ['reminder-add', 'task-complete', 'task-repeat', 'inline', 'single-store', 'full-visit', 'full-store', 'fill-profile'];
async function prepare(t, route, phase) {
  const { page } = t; await closeDialogs(page);
  const text = `虛構 ${route} 第 ${phase} 次修改`;
  let selector = null, expectedValue = null, submit;
  if (['reminder-add', 'task-complete', 'task-repeat', 'inline', 'single-store'].includes(route)) await openStore(page);
  if (route === 'reminder-add') {
    await page.locator('#review [data-store-reminder]').first().click(); selector = '#store-reminder-next';
    await (await explicitText(page, selector)).fill(text); expectedValue = text;
    submit = () => page.locator('#store-reminder-dialog button[type="submit"]').click();
  }
  if (route === 'task-complete') submit = () => page.locator('#review [data-reminder-complete]').first().click();
  if (route === 'task-repeat') {
    await page.locator('#review .reminder-task-history > summary').first().click();
    submit = () => page.locator('#review [data-reminder-repeat]').first().click();
  }
  if (route === 'inline') {
    selector = '#review [data-inline-edit-text="qa-note"]'; expectedValue = await page.locator(selector).innerText() + '\n' + text;
    await (await explicitText(page, selector)).fill(expectedValue);
    await stored(page, value => value.payload.inlineTextDraft?.after === expectedValue);
    await page.locator('#review [data-inline-review="qa-note"]').click();
    await page.locator('#quick-text-dialog').waitFor({ state: 'visible' });
    assert.ok(await page.locator('#quick-text-dialog .quick-diff-added').count());
    assert.equal(await page.locator('#visit-attendance-dialog').isVisible(), false, 'Diff preview cannot record attendance');
    submit = () => page.locator('#quick-text-dialog button[type="submit"]').click();
  }
  if (route === 'single-store') {
    await page.locator('#review [data-start-single-store-capture]').click(); selector = '#single-store-text'; expectedValue = text;
    await (await explicitText(page, selector)).fill(text);
    await page.locator('#single-store-capture-form .single-store-more > summary').click(); await page.locator('#single-store-date').fill('2026-09-01');
    await stored(page, value => value.payload.draft?.fields?.text === text && value.payload.draft.fields.date === '2026-09-01');
    submit = () => page.locator('button[form="single-store-capture-form"]').click();
  }
  if (route === 'full-visit') {
    await page.locator('.rail [data-view="visits"]').click(); await openEditorButton(page, '#visit-list [data-edit="visit:qa-note"]'); selector = '#f-text';
    expectedValue = await page.locator(selector).inputValue() + '\n' + text;
    await (await explicitText(page, selector)).fill(expectedValue); await stored(page, value => value.payload.draft?.fields?.text === expectedValue);
    submit = () => page.locator('#editor-save').click();
  }
  if (route === 'full-store') {
    await page.locator('.rail [data-view="stores"]').click(); await openEditorButton(page, '#customer-list [data-edit="store:qa-store-a"]'); selector = '#f-attr'; expectedValue = text;
    await (await explicitText(page, selector)).fill(text); submit = () => page.locator('#editor-save').click();
  }
  if (route === 'fill-profile') {
    await page.locator('.rail [data-view="sync"]').click(); await page.locator('#sync-view [data-view="quality"]').click();
    await page.locator('#quality-content [data-quality-tab="missing"]').click(); await page.locator('#quality-content [data-fill-store="qa-store-a"]').click();
    selector = phase === 1 ? '#fill-district' : '#fill-city'; expectedValue = text;
    await (await explicitText(page, selector)).fill(text); submit = () => page.locator('#editor-save').click();
  }
  await page.waitForTimeout(450);
  return { submit, selector, expectedValue };
}
async function ask(t, label, submit) {
  const before = (await snapshot(t.page)).payload.bundle;
  await noAuto(t, label, async () => { await submit(); await t.page.locator('#visit-attendance-dialog').waitFor({ state: 'visible' }); });
  assert.equal(await t.page.locator('#visit-attendance-check').isChecked(), false, 'Every confirmation starts unchecked');
  assert.equal(await t.page.locator('#visit-attendance-confirm').isEnabled(), true, 'Busy guard must not deadlock the final confirmation');
  assert.equal(await t.page.locator('#visit-attendance-cancel').isEnabled(), true);
  assert.match(await t.page.locator('#visit-attendance-dialog').innerText(), /當下是否為拜訪日期/);
  assert.deepEqual((await snapshot(t.page)).payload.bundle, before, 'Opening confirmation cannot write the formal save or attendance');
}
function preserved(before, after) {
  for (const op of before.ops) assert.deepEqual(after.ops.find(item => item.id === op.id), op, 'Existing revisions remain byte-for-byte identical');
  assert.deepEqual(after.blobs, before.blobs, 'Source bytes remain identical');
}
async function confirm(t, checked, before) {
  const { page } = t;
  if (checked) await noAuto(t, 'explicit-attendance-checkbox', () => page.locator('#visit-attendance-check').check());
  const today = await page.evaluate(() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; });
  await noAuto(t, checked ? 'confirm-with-attendance' : 'confirm-without-attendance', () => page.locator('#visit-attendance-confirm').click());
  const saved = await stored(page, value => value.payload.bundle.ops.length === before.ops.length + 1);
  const added = saved.payload.bundle.ops.filter(op => !before.ops.some(old => old.id === op.id)); assert.equal(added.length, 1);
  preserved(before, saved.payload.bundle);
  if (checked) {
    assert.equal(added[0].visitAttendance?.store, 'qa-store-a'); assert.equal(added[0].visitAttendance?.date, today);
    assert.ok(Number.isFinite(Date.parse(added[0].visitAttendance?.at)), 'Attendance records an explicit timestamp');
  } else assert.equal(added[0].visitAttendance, undefined, 'Ordinary saves must not inherit or create attendance metadata');
  if (added[0].type === 'visit') assert.equal(added[0].data.date, '2026-09-01', 'Actual visit confirmation cannot rewrite the original note date');
  return saved;
}
async function summary(page) {
  await openStore(page);
  const text = await page.locator('#review .store-attendance').innerText();
  assert.match(text, /最近實際拜訪/); assert.match(text, /今天|0\s*天/);
  const history = page.locator('#review .attendance-history'); await history.locator(':scope > summary').click();
  return { text, dates: await history.locator('[data-attendance-date]').evaluateAll(items => items.map(el => el.dataset.attendanceDate)) };
}
async function routeAcceptance(width, route) {
  const t = await isolated(width), { page, context } = t;
  try {
    const first = await prepare(t, route, 1), initial = (await snapshot(page)).payload.bundle;
    await ask(t, `${route}-ask-before-cancel`, first.submit);
    await page.locator('#visit-attendance-check').check();
    await noAuto(t, `${route}-cancel`, () => page.locator('#visit-attendance-cancel').click());
    assert.deepEqual((await snapshot(page)).payload.bundle, initial, 'Cancel leaves original content and attendance untouched');
    if (first.selector) {
      const actual = route === 'inline' ? await page.locator(first.selector).innerText() : await page.locator(first.selector).inputValue();
      assert.equal(actual, first.expectedValue, 'Cancelled confirmation preserves edited form text');
    }
    if (route === 'inline') assert.equal((await snapshot(page)).payload.inlineTextDraft?.after, first.expectedValue);
    if (['single-store', 'full-visit'].includes(route)) assert.equal((await snapshot(page)).payload.draft?.fields?.text, first.expectedValue);
    await ask(t, `${route}-reopen-unchecked`, first.submit);
    const ordinary = await confirm(t, false, initial); assert.equal(ordinary.payload.bundle.ops.some(op => op.visitAttendance), false);
    const second = await prepare(t, route, 2); await ask(t, `${route}-ask-checked-save`, second.submit);
    await page.screenshot({ path: path.join(outputDir, `${route}-${width}-confirmation.png`) });
    const saved = await confirm(t, true, ordinary.payload.bundle); const attendance = await summary(page);
    assert.equal(attendance.dates.length, 1, 'A store has one displayed attendance date');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []);
    report.scenarios.push({ name: route, width, opsBefore: initial.ops.length, opsAfter: saved.payload.bundle.ops.length, attendance, checks: ['default-unchecked', 'cancel-preserves-form-and-draft', 'reopen-resets-checkbox', 'ordinary-save-no-attendance', 'explicit-checkbox-only', 'same-revision-metadata', 'original-date-retained', 'no-auto-text-focus', 'immutable-source-history'] });
  } catch (error) { await page.screenshot({ path: path.join(outputDir, `failure-${route}-${width}.png`) }); throw error; }
  finally { await context.close(); }
}
async function sameDayAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    let last = await snapshot(page);
    for (const phase of [1, 2, 3]) {
      const next = await prepare(t, 'reminder-add', phase); await ask(t, `same-day-${phase}`, next.submit);
      last = await confirm(t, phase < 3, last.payload.bundle);
    }
    assert.equal(last.payload.bundle.ops.filter(op => op.visitAttendance).length, 2);
    const attendance = await summary(page); assert.equal(attendance.dates.length, 1, 'Two explicitly checked saves on the same date display one visit day');
    const stable = await snapshot(page); await page.locator('#review [data-close="review"]').click(); await page.reload(); await page.locator('#workspace').waitFor({ state: 'visible' });
    assert.deepEqual(await snapshot(page), stable); assert.deepEqual(await summary(page), attendance, 'Attendance survives reload; ordinary saves do not change the last visit');
    await page.screenshot({ path: path.join(outputDir, `attendance-history-${width}.png`) });
    assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []);
    report.scenarios.push({ name: 'same-day-dedup-and-reload', width, attendance, checks: ['two-explicit-events-one-calendar-day', 'ordinary-save-preserves-last-attendance', 'reload-preserves-encrypted-slot'] });
  } catch (error) { await page.screenshot({ path: path.join(outputDir, `failure-same-day-${width}.png`) }); throw error; }
  finally { await context.close(); }
}
async function unchangedAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    const initial = await snapshot(page);
    await openStore(page); await page.locator('#review [data-store-reminder]').first().click();
    const submit = () => page.locator('#store-reminder-dialog button[type="submit"]').click();
    await ask(t, 'unchanged-reminder', submit);
    await noAuto(t, 'unchanged-reminder-unchecked', () => page.locator('#visit-attendance-confirm').click());
    assert.deepEqual(await snapshot(page), initial, 'No changes plus unchecked confirmation is a byte-for-byte no-op');
    await openStore(page); await page.locator('#review [data-store-reminder]').first().click();
    await ask(t, 'unchanged-reminder-only-attendance', submit);
    await noAuto(t, 'unchanged-reminder-escape', () => page.keyboard.press('Escape'));
    assert.deepEqual(await snapshot(page), initial, 'Escape cancels without writing');
    await ask(t, 'unchanged-reminder-reopen', submit);
    const saved = await confirm(t, true, initial.payload.bundle);
    assert.deepEqual(saved.payload.bundle.ops.at(-1).data, initial.payload.bundle.ops.find(op => op.entity === 'qa-store-a').data, 'Attendance-only confirmation preserves all original store data');
    const attendance = await summary(page); assert.equal(attendance.dates.length, 1);
    assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []);
    report.scenarios.push({ name: 'unchanged-reminder-and-escape', width, checks: ['no-op-zero-encrypted-writes', 'escape-cancels', 'attendance-only-preserves-data'] });
  } catch (error) { await page.screenshot({ path: path.join(outputDir, `failure-unchanged-${width}.png`) }); throw error; }
  finally { await context.close(); }
}

try {
  for (const width of [393, 1440]) { for (const route of routes) await routeAcceptance(width, route); await sameDayAcceptance(width); await unchangedAcceptance(width); }
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.message; throw error; }
finally {
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, engine, passed: report.passed, scenarios: report.scenarios.length, realIPhone: false, thirdPartyKeyboard: false }));
  await browser.close();
}
