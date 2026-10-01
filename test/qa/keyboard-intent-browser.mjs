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
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-keyboard-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18447';
const report = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, engine, browserVersion: browser.version(), realIPhone: false, thirdPartyKeyboard: false, simulatedVisibility: true, scenarios: [], focusEvidence: [], keyboardEvidence: [] };

async function isolated(width, { empty = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 393 ? 852 : 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], external = [], apiRequests = [];
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
    bundle.ops.push(c.revision('store', 'qa-store-a', c.addReminderTasks(store('虛構鍵盤甲店'), '虛構待辦甲\n虛構待辦乙'), [], 'qa'));
    bundle.ops.push(c.revision('store', 'qa-store-b', store('虛構鍵盤乙店'), [], 'qa'));
    const text = Array.from({ length: 16 }, (_, i) => `第 ${i + 1} 行虛構拜訪筆記。${i === 1 || i === 12 ? ' Complete 原文命中。' : ''}`).join('\n');
    const visit = (store, text) => ({ store, date: '2026-10-02', source: '虛構來源', text, next: '', topics: [], people: [], attachments: [] });
    bundle.ops.push(c.revision('visit', 'qa-note', visit('qa-store-a', text), [], 'qa'), c.revision('visit', 'qa-other', visit('qa-store-b', '虛構乙店原文'), [], 'qa'));
    c.validateBundle(bundle);
    await db.writeLocal(await c.seal({ schema: 1, device: 'qa-device', deviceName: 'Fictional Keyboard QA', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, lastHealthAudit: new Date().toISOString() }, key, meta, 'device'), 0, key);
    return bundle;
  }, empty);
  await page.goto(origin + '/'); await page.locator(empty ? '#gate-form' : '#workspace').waitFor({ state: 'visible' }); await page.waitForTimeout(180);
  const boot = await page.evaluate(() => window.qaFocusEvents);
  assert.equal(boot.some(event => event.textEntry), false, 'App boot must not briefly focus a text entry');
  return { context, page, width, errors, external, apiRequests, initialBundle };
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
async function intentionalTabNavigation(t) {
  const { page, width } = t, before = await snapshot(page);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'editor-title');
  const start = await page.evaluate(() => window.qaFocusEvents.length);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.matches('#editor button[data-close="editor"]')), true, 'Tab from dialog title reaches the close button');
  const firstTab = await page.evaluate(() => window.qaFocusDescriptor(document.activeElement));
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'f-name', 'Next Tab reaches the editable name field');
  await page.keyboard.type('Keyboard-only fictional store');
  assert.equal(await page.locator('#f-name').inputValue(), 'Keyboard-only fictional store');
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#f-name').inputValue(), '');
  const evidence = await page.evaluate(start => ({ events: window.qaFocusEvents.slice(start), active: window.qaFocusDescriptor(document.activeElement) }), start);
  assert.equal(evidence.events.filter(event => event.textEntry).length, 1, 'The explicitly requested Tab focuses one text field');
  report.keyboardEvidence.push({ width, label: 'intentional-desktop-tab-and-type', firstTab, ...evidence });
  assert.deepEqual(await snapshot(page), before, 'Keyboard navigation and unsaved store-name entry cannot change encrypted data');
}
async function openStore(page) {
  await page.locator('.rail [data-view="stores"]').click();
  await page.locator('#stores-view [data-visit-brief="qa-store-a"]').click();
  await page.locator('#brief-search').waitFor({ state: 'visible' });
}
async function visibilityRoundTrip(t, expectedDraft, kind) {
  const { page } = t, bundle = (await snapshot(page)).payload.bundle;
  await noAuto(t, `background-and-return-${kind}`, async () => {
    await page.evaluate(() => { window.qaHidden = true; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
    await page.waitForTimeout(350);
    await page.evaluate(() => { window.qaHidden = false; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); });
    await page.waitForTimeout(350);
  });
  const after = await snapshot(page); assert.deepEqual(after.payload.bundle, bundle);
  assert.equal(kind === 'inline' ? after.payload.inlineTextDraft?.after : after.payload.draft?.fields?.text, expectedDraft, 'Background return preserves encrypted draft');
}
async function finish(t, name, checks) {
  assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []);
  const geometry = await t.page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(geometry.scrollWidth <= t.width + 1, 'No horizontal overflow');
  await t.page.screenshot({ path: path.join(outputDir, `${name}-${t.width}.png`) });
  report.scenarios.push({ name, width: t.width, checks, geometry });
}

async function readOnlyAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    const baseline = await snapshot(page);
    await noAuto(t, 'open-single-store', () => openStore(page), { unchanged: true });
    const search = await explicitText(page, '#brief-search'); await search.fill('Complete'); await page.waitForTimeout(260);
    await noAuto(t, 'search-next', () => page.locator('#brief-search-next').click(), { unchanged: true });
    await noAuto(t, 'search-previous', () => page.locator('#brief-search-prev').click(), { unchanged: true });
    await explicitText(page, '#brief-search');
    // Programmatic button activation preserves the old focus until App handlers run,
    // covering Safari's different button-focus behavior without calling it real iOS.
    await noAuto(t, 'search-clear-from-focused-input', () => page.locator('#brief-search-clear').evaluate(el => el.click()), { unchanged: true });
    await explicitText(page, '#brief-search');
    await noAuto(t, 'nested-reminder-open-from-focused-search', () => page.locator('#review [data-store-reminder]').first().evaluate(el => el.click()), { unchanged: true });
    if (width === 393) await page.screenshot({ path: path.join(outputDir, 'reminder-initial-393.png') });
    await noAuto(t, 'preset-checkbox', () => page.locator('#store-reminder-dialog [data-reminder-option][value="HAUD"]').check(), { unchanged: true });
    await noAuto(t, 'custom-checkbox', () => page.locator('#store-reminder-dialog [data-reminder-custom-toggle]').check(), { unchanged: true });
    const custom = await explicitText(page, '#store-reminder-dialog [data-reminder-custom-input]'); await custom.fill('虛構自訂待辦');
    await noAuto(t, 'nested-reminder-close', () => page.locator('#store-reminder-dialog [data-close="store-reminder-dialog"]').first().evaluate(el => el.click()), { unchanged: true });
    assert.equal(await page.locator('#review').isVisible(), true);
    await explicitText(page, '#review [data-inline-edit-text="qa-note"]');
    await noAuto(t, 'nested-reminder-open-from-clean-original', () => page.locator('#review [data-store-reminder]').first().evaluate(el => el.click()), { unchanged: true });
    await noAuto(t, 'nested-reminder-close-to-original', () => page.locator('#store-reminder-dialog [data-close="store-reminder-dialog"]').first().click(), { unchanged: true });
    await explicitText(page, '#brief-search');
    await noAuto(t, 'nested-reminder-open-for-escape', () => page.locator('#review [data-store-reminder]').first().evaluate(el => el.click()), { unchanged: true });
    await explicitText(page, '#store-reminder-next');
    await noAuto(t, 'nested-reminder-escape', () => page.keyboard.press('Escape'), { unchanged: true });
    page.once('dialog', dialog => dialog.dismiss());
    await noAuto(t, 'task-completion-cancel', () => page.locator('#review [data-reminder-complete]').first().click(), { unchanged: true });
    await noAuto(t, 'readonly-review-close', () => page.locator('#review [data-close="review"]').click(), { unchanged: true });
    await noAuto(t, 'readonly-background-return', async () => {
      await page.evaluate(() => { window.qaHidden = true; document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForTimeout(200);
      await page.evaluate(() => { window.qaHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
      await page.locator('#workspace').waitFor({ state: 'visible' });
    }, { unchanged: true });
    assert.deepEqual(await snapshot(page), baseline, 'All read-only opening/searching/checkbox cancellation must leave encrypted bytes unchanged');
    await finish(t, 'readonly-focus', ['transient-showModal-focus', 'explicit-field-click', 'search-navigation-clear', 'reminder-checkboxes', 'nested-close-no-keyboard', 'task-cancel', 'encrypted-slot-identical']);
  } finally { await context.close(); }
}

async function existingEditorAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    const edit = page.locator('#visit-list [data-edit="visit:qa-note"]');
    await edit.evaluate(el => { el.closest('details').open = true; });
    await noAuto(t, 'existing-full-editor-open', () => edit.click(), { unchanged: true });
    const original = t.initialBundle.ops.find(op => op.entity === 'qa-note').data.text;
    assert.equal(await page.locator('#f-text').inputValue(), original);
    const field = await explicitText(page, '#f-text'); await field.fill(original + '\n虛構完整編輯修改');
    await stored(page, value => value.payload.draft?.fields?.text === original + '\n虛構完整編輯修改');
    await noAuto(t, 'existing-full-editor-close', () => page.locator('#editor [data-close="editor"]').first().evaluate(el => el.click()));
    await noAuto(t, 'existing-full-editor-draft-resume', () => page.locator('#resume-draft').click());
    assert.equal(await page.locator('#f-text').inputValue(), original + '\n虛構完整編輯修改');
    assert.deepEqual((await snapshot(page)).payload.bundle, t.initialBundle);
    await finish(t, 'existing-editor-focus', ['existing-full-editor', 'explicit-input', 'draft-close-resume', 'formal-bundle-identical']);
  } finally { await context.close(); }
}

async function validationAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    await page.locator('.rail [data-view="stores"]').click();
    await noAuto(t, 'new-store-open', () => page.locator('#stores-view [data-add="store"]').click(), { unchanged: true });
    if (width === 1440) await intentionalTabNavigation(t);
    await noAuto(t, 'invalid-empty-store-name', () => page.locator('#editor-save').click(), { unchanged: true });
    assert.equal(await page.locator('#editor').isVisible(), true); assert.ok((await page.locator('#editor-error').textContent()).length);
    await noAuto(t, 'invalid-editor-close', () => page.locator('#editor [data-close="editor"]').first().click(), { unchanged: true });
    await page.locator('.rail [data-view="sync"]').click();
    await noAuto(t, 'repair-pair-open', () => page.locator('#repair-pair').click(), { unchanged: true });
    await noAuto(t, 'invalid-empty-repair-code', () => page.locator('#repair-pair-form button[type="submit"]').click(), { unchanged: true });
    assert.ok((await page.locator('#repair-pair-error').textContent()).length);
    const code = await explicitText(page, '#repair-pair-code'); await code.fill('FICTIONAL-NOT-SUBMITTED');
    await noAuto(t, 'repair-pair-cancel', () => page.locator('#review [data-close="review"]').first().evaluate(el => el.click()), { unchanged: true });
    assert.equal(t.apiRequests.includes('/api/pair'), false, 'Opening, invalid submit and cancelling cannot send pairing request');
    await finish(t, 'invalid-form-focus', ['empty-required-editor', 'repair-open-no-prompt', 'empty-code-blocked', 'cancel-pair-code', 'no-pair-request', 'encrypted-slot-identical', ...(width === 1440 ? ['intentional-tab-navigation-and-type'] : [])]);
  } finally { await context.close(); }
  const gate = await isolated(width, { empty: true });
  try {
    await noAuto(gate, 'invalid-empty-gate-password', () => gate.page.locator('#gate-submit').click(), { unchanged: true });
    assert.ok((await gate.page.locator('#gate-error').textContent()).length);
    assert.equal(gate.apiRequests.includes('/api/pair'), false);
    await explicitText(gate.page, '#password');
    await finish(gate, 'gate-focus', ['initial-gate-reading', 'invalid-password-no-autofocus', 'explicit-password-click', 'no-local-slot-created']);
  } finally { await gate.context.close(); }
}

async function fullEditorAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    await noAuto(t, 'new-full-visit-open', () => page.locator('#new-note').click(), { unchanged: true });
    const text = await explicitText(page, '#f-text'); await text.fill('虛構完整編輯草稿');
    await stored(page, value => value.payload.draft?.fields?.text === '虛構完整編輯草稿');
    await noAuto(t, 'full-editor-close-preserves-draft', () => page.locator('#editor [data-close="editor"]').first().evaluate(el => el.click()));
    await noAuto(t, 'resume-new-visit-draft', () => page.locator('#resume-draft').click());
    // A new draft may resume in the single-store capture form; existing-record drafts
    // resume in the full editor. Both entry paths must start as reading surfaces.
    const resumed = await page.locator('#single-store-text').isVisible() ? '#single-store-text' : '#f-text';
    assert.equal(await page.locator(resumed).inputValue(), '虛構完整編輯草稿');
    await explicitText(page, resumed); await visibilityRoundTrip(t, '虛構完整編輯草稿', 'visit');
    assert.deepEqual((await snapshot(page)).payload.bundle, t.initialBundle);
    await finish(t, 'full-editor-draft-focus', ['new-full-editor', 'direct-input', 'close-resume', 'simulated-background-return', 'draft-retained', 'formal-bundle-identical']);
  } finally { await context.close(); }
}

async function captureAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    await noAuto(t, 'capture-store-open', () => openStore(page), { unchanged: true });
    await noAuto(t, 'start-single-store-capture', () => page.locator('#review [data-start-single-store-capture]').click(), { unchanged: true });
    const field = await explicitText(page, '#single-store-text'); await field.fill('虛構本次拜訪內容');
    await stored(page, value => value.payload.draft?.fields?.text === '虛構本次拜訪內容');
    await noAuto(t, 'collapse-single-store-draft', () => page.locator('#review [data-collapse-single-store-capture]').evaluate(el => el.click()));
    await noAuto(t, 'resume-single-store-draft', () => page.locator('#review [data-start-single-store-capture]').click());
    assert.equal(await page.locator('#single-store-text').inputValue(), '虛構本次拜訪內容');
    await noAuto(t, 'capture-close', () => page.locator('#review [data-close="review"]').click());
    await noAuto(t, 'return-to-visits-with-capture-draft', () => page.locator('.rail [data-view="visits"]').click());
    await noAuto(t, 'capture-banner-resume', () => page.locator('#resume-draft').click());
    assert.equal(await page.locator('#single-store-text').inputValue(), '虛構本次拜訪內容');
    await noAuto(t, 'capture-save', () => page.locator('button[form="single-store-capture-form"]').click());
    const saved = await stored(page, value => value.payload.bundle.ops.length === t.initialBundle.ops.length + 1 && !value.payload.draft);
    assert.equal(saved.payload.bundle.ops.at(-1).data.text, '虛構本次拜訪內容');
    for (const op of t.initialBundle.ops) assert.deepEqual(saved.payload.bundle.ops.find(item => item.id === op.id), op);
    await finish(t, 'capture-focus', ['start-reading', 'explicit-input', 'collapse-resume', 'close-banner-resume', 'one-new-visit', 'history-retained']);
  } finally { await context.close(); }
}

async function inlineAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    await noAuto(t, 'inline-store-open', () => openStore(page), { unchanged: true });
    const original = t.initialBundle.ops.find(op => op.entity === 'qa-note').data.text, changed = original + '\n虛構修改新增文字';
    const note = await explicitText(page, '#review [data-inline-edit-text="qa-note"]'); await note.fill(changed);
    await stored(page, value => value.payload.inlineTextDraft?.after === changed);
    await noAuto(t, 'inline-diff-open', () => page.locator('#review [data-inline-review="qa-note"]').evaluate(el => el.click()));
    assert.ok(await page.locator('#quick-text-dialog .quick-diff-added').count());
    assert.deepEqual((await snapshot(page)).payload.bundle, t.initialBundle);
    await noAuto(t, 'diff-return-to-original', () => page.locator('[data-quick-text-back]').click());
    assert.equal(await page.locator('#review [data-inline-edit-text="qa-note"]').innerText(), changed);
    await explicitText(page, '#review [data-inline-edit-text="qa-note"]');
    await noAuto(t, 'diff-reopen', () => page.locator('#review [data-inline-review="qa-note"]').evaluate(el => el.click()));
    await noAuto(t, 'diff-cancel', () => page.locator('#quick-text-dialog [data-close="quick-text-dialog"]').first().click());
    assert.equal((await snapshot(page)).payload.inlineTextDraft?.after, changed);
    await explicitText(page, '#review [data-inline-edit-text="qa-note"]');
    await visibilityRoundTrip(t, changed, 'inline');
    await noAuto(t, 'diff-open-after-return', () => page.locator('#review [data-inline-review="qa-note"]').click());
    await noAuto(t, 'diff-confirm-save', () => page.locator('#quick-text-dialog button[type="submit"]').click());
    const saved = await stored(page, value => value.payload.bundle.ops.length === t.initialBundle.ops.length + 1 && !value.payload.inlineTextDraft);
    assert.equal(saved.payload.bundle.ops.at(-1).entity, 'qa-note'); assert.equal(saved.payload.bundle.ops.at(-1).data.text, changed);
    for (const op of t.initialBundle.ops) assert.deepEqual(saved.payload.bundle.ops.find(item => item.id === op.id), op);
    await finish(t, 'inline-diff-focus', ['explicit-raw-input', 'diff-before-save', 'return-no-autofocus', 'cancel-retains-draft', 'simulated-background-return', 'one-version-on-confirm', 'original-history-retained']);
  } finally { await context.close(); }
}

try {
  for (const width of [393, 1440]) { await readOnlyAcceptance(width); await fullEditorAcceptance(width); await existingEditorAcceptance(width); await captureAcceptance(width); await inlineAcceptance(width); await validationAcceptance(width); }
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.message; throw error; }
finally {
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, engine, passed: report.passed, scenarios: report.scenarios.length, realIPhone: false, thirdPartyKeyboard: false }));
  await browser.close();
}
