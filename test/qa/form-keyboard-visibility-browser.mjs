// Full-App form/caret visibility acceptance using fictional records and intercepted routes.
// visualViewport and composition are synthetic: this is not real iPhone/Typeless testing.
// QA_MODE=baseline exports public assets from the pinned v1.5.47 commit (or
// QA_BASELINE_REF). QA_PUBLIC_DIR may instead point at a separately frozen copy.
// PLAYWRIGHT_PACKAGE_JSON or PLAYWRIGHT_MODULE locates existing tooling;
// QA_BROWSER_ENGINE, QA_BROWSER_EXECUTABLE and QA_OUTPUT_DIR are optional.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.env.QA_MODE || 'acceptance';
const baselineRef = mode === 'baseline' && !process.env.QA_PUBLIC_DIR ? process.env.QA_BASELINE_REF || '5bff9c3c176d9e94b5004021ee60e3a60f22e8ca' : null;
let publicDir = process.env.QA_PUBLIC_DIR ? path.resolve(process.env.QA_PUBLIC_DIR) : path.join(root, 'public');
if (baselineRef) {
  const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-form-baseline-'));
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baselineRef, 'public'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  for (const file of files) {
    const destination = path.resolve(baselineDir, file);
    assert.ok(file.startsWith('public/') && destination.startsWith(baselineDir + path.sep), 'Baseline exports only tracked public program files');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, execFileSync('git', ['show', `${baselineRef}:${file}`], { cwd: root }));
  }
  publicDir = path.join(baselineDir, 'public');
}
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON ? path.resolve(process.env.PLAYWRIGHT_PACKAGE_JSON) : import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch { throw new Error('Provide an already installed Playwright module via PLAYWRIGHT_MODULE or PLAYWRIGHT_PACKAGE_JSON. This test installs nothing.'); }
const engine = process.env.QA_BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit', 'firefox'].includes(engine), 'Unsupported browser engine');
const browser = await playwright[engine].launch({ headless: true, ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-form-keyboard-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18448';
const report = { version: fs.readFileSync(path.join(publicDir, 'version.js'), 'utf8').match(/APP_VERSION\s*=\s*['"]([^'"]+)/)?.[1], engine, browserVersion: browser.version(), realIPhone: false, thirdPartyKeyboard: false, simulatedKeyboard: true, simulatedComposition: true, mode, baselineSource: mode === 'baseline' ? { ref: baselineRef, publicDir } : null, scenarios: [] };

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
    const viewport = new EventTarget(); Object.assign(viewport, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport }); window.qaViewport = viewport;
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
    const text = Array.from({ length: 16 }, (_, i) => `第 ${i + 1} 行虛構拜訪筆記。${i === 1 || i === 12 ? ' Complete 原文命中。' : ''}`).join('\r\n');
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
async function reminderSnapshot(page, spec, expectedValue, baselineSlot) {
  await page.locator('#store-reminder-draft-state[data-state="saved"]').waitFor({ state: 'attached' });
  const field = { 'reminder-next': 'next', 'reminder-custom': 'customText', 'reminder-every': 'every' }[spec.name];
  const saved = await stored(page, value => value?.payload.reminderDrafts?.find(d => d.storeId === 'qa-store-a')?.fields[field] === expectedValue);
  const withoutDraft = value => { const copy = structuredClone(value.payload); delete copy.reminderDrafts; return copy; };
  assert.deepEqual(withoutDraft(saved), withoutDraft(baselineSlot), 'Reminder input changes only encrypted device drafts, never formal bundle, dirty, attendance or sync metadata');
  assert.equal(saved.payload.reminderDrafts.length, 1); return saved;
}
async function viewport(page, height, offsetTop = 0, event = 'resize') {
  await page.evaluate(({ height, offsetTop, event }) => { Object.assign(window.qaViewport, { height, offsetTop }); window.qaViewport.dispatchEvent(new Event(event)); }, { height, offsetTop, event });
  await page.waitForTimeout(240);
}
async function openReminder(page) {
  await page.locator('.rail [data-view="stores"]').click();
  await page.locator('#stores-view [data-visit-brief="qa-store-a"]').click();
  await page.locator('#review [data-store-reminder]').first().click();
  await page.locator('#store-reminder-dialog').waitFor({ state: 'visible' });
}
async function fieldState(page, selector) {
  return page.locator(selector).evaluate(el => {
    const rect = el.getBoundingClientRect(), dialog = el.closest('dialog'), bounds = dialog?.getBoundingClientRect();
    return { id: el.id, focused: document.activeElement === el, top: rect.top, bottom: rect.bottom, height: rect.height, scrollTop: el.scrollTop, start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, value: el.value, dialogTop: bounds?.top, dialogBottom: bounds?.bottom, dialogScroll: dialog?.scrollTop, viewportTop: window.qaViewport.offsetTop, viewportBottom: window.qaViewport.offsetTop + window.qaViewport.height, pageScroll: scrollY };
  });
}
async function caretGeometry(page, selector) {
  return page.locator(selector).evaluate(el => {
    const style = getComputedStyle(el), rect = el.getBoundingClientRect(), mirror = document.createElement('div'), marker = document.createElement('span');
    for (const name of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth', 'boxSizing', 'textIndent', 'wordSpacing', 'tabSize', 'wordBreak']) mirror.style[name] = style[name];
    Object.assign(mirror.style, { position: 'fixed', left: '-10000px', top: '0', width: style.width, height: 'auto', minHeight: '0', borderStyle: 'solid', visibility: 'hidden', pointerEvents: 'none', whiteSpace: el.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre', overflowWrap: 'break-word' });
    mirror.textContent = el.value.slice(0, el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd); marker.textContent = '\u200b'; mirror.append(marker); document.body.append(mirror);
    const markerRect = marker.getBoundingClientRect(), mirrorRect = mirror.getBoundingClientRect();
    const top = rect.top + markerRect.top - mirrorRect.top - el.scrollTop, bottom = top + markerRect.height;
    mirror.remove();
    let upper = Math.max(window.qaViewport.offsetTop, rect.top + el.clientTop), lower = Math.min(window.qaViewport.offsetTop + window.qaViewport.height, rect.top + el.clientTop + el.clientHeight);
    const clips = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      // Native top-layer dialogs escape body/root overflow clipping. The visual
      // viewport already supplies the window bounds; only inner owners clip them.
      if (p === document.body || p === document.documentElement) break;
      const css = getComputedStyle(p); if (!/(auto|scroll|hidden|clip)/.test(css.overflowY)) continue;
      const bounds = p.getBoundingClientRect(); upper = Math.max(upper, bounds.top + p.clientTop); lower = Math.min(lower, bounds.top + p.clientTop + p.clientHeight); clips.push({ id: p.id, top: bounds.top, bottom: bounds.bottom });
      if (p.tagName === 'DIALOG') break;
    }
    const actions = el.closest('#review')?.querySelector('#review-persistent-actions');
    if (actions?.getClientRects().length) lower = Math.min(lower, actions.getBoundingClientRect().top);
    return { top, bottom, upper, lower, fieldTop: rect.top, fieldBottom: rect.bottom, fieldHeight: rect.height, scrollTop: el.scrollTop, start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, focused: document.activeElement === el, clips };
  });
}
async function assertCaretVisible(page, selector, label) {
  const geometry = await caretGeometry(page, selector);
  assert.equal(geometry.focused, true, `${label}: field must remain focused`);
  assert.ok(geometry.top >= geometry.upper - 2 && geometry.bottom <= geometry.lower + 2, `${label}: caret must be visible: ${JSON.stringify(geometry)}`);
  return geometry;
}
const cases = [
  { name: 'reminder-next', selector: '#store-reminder-next', kind: 'reminder' },
  { name: 'reminder-custom', selector: '#store-reminder-dialog [data-reminder-custom-input]', kind: 'reminder', input: true },
  { name: 'reminder-every', selector: '#store-reminder-every', kind: 'reminder' },
  { name: 'full-editor', selector: '#f-text', kind: 'full', draft: true },
  { name: 'quick-text', selector: '#quick-text-value', kind: 'quick' },
  { name: 'single-store', selector: '#single-store-text', kind: 'single', draft: true },
  { name: 'gate-input', selector: '#pair-code', kind: 'gate', input: true }
];
async function openCase(t, spec) {
  const { page } = t;
  if (spec.kind === 'reminder') await openReminder(page);
  if (spec.kind === 'full') {
    const edit = page.locator('#visit-list [data-edit="visit:qa-note"]'); await edit.evaluate(el => { el.closest('details').open = true; }); await edit.click();
  }
  if (spec.kind === 'quick') {
    // Retained delegated entry has no current visible launcher. This synthetic button
    // exercises its real App handler without calling private runtime functions.
    await page.evaluate(() => { const button = document.createElement('button'); button.dataset.quickEditText = 'qa-note'; button.textContent = 'Fictional legacy quick-edit route'; document.body.append(button); button.click(); button.remove(); });
  }
  if (spec.kind === 'single') {
    await page.locator('.rail [data-view="stores"]').click(); await page.locator('#stores-view [data-visit-brief="qa-store-a"]').click(); await page.locator('#review [data-start-single-store-capture]').click();
  }
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.qaFocusEvents.some(event => event.textEntry)), false, `${spec.name} must not auto-focus before deliberate input`);
  await page.locator(spec.selector).click();
  assert.equal(await page.locator(spec.selector).evaluate(el => document.activeElement === el), true);
}
async function userScrollAndClose(t, spec) {
  const { page, width } = t;
  if (width !== 393) return null;
  const scroller = await page.locator(spec.selector).evaluate(el => {
    for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 80) { p.dataset.qaManualScroll = '1'; return true; }
    return false;
  });
  if (!scroller) return { applicable: false };
  const target = page.locator('[data-qa-manual-scroll]');
  // A synthetic touch drag exercises the controller's explicit user-scroll guard.
  // It intentionally does not change the active field or its selection.
  await target.evaluate(el => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 47, pointerType: 'touch', clientX: 180, clientY: 120 }));
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 47, pointerType: 'touch', clientX: 180, clientY: 184 }));
    el.scrollTop = Math.max(0, el.scrollTop - 64);
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 47, pointerType: 'touch', clientX: 180, clientY: 184 }));
  });
  const manual = await target.evaluate(el => el.scrollTop);
  await page.waitForTimeout(350); await viewport(page, 320, 30, 'scroll');
  assert.equal(await target.evaluate(el => el.scrollTop), manual, 'A viewport scroll must not pull a manually scrolled form back to the caret');
  await page.locator(spec.selector).evaluate(el => el.blur()); await viewport(page, 852, 0);
  const closed = await target.evaluate(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
  assert.ok(Math.abs(closed.top - Math.min(manual, closed.max)) <= 2, `Closing keyboard must preserve/clamp scroll, not jump to top: ${JSON.stringify({ manual, closed })}`);
  await target.evaluate(el => delete el.dataset.qaManualScroll);
  return { applicable: true, manual, closed };
}
async function acceptance(width, spec) {
  const t = await isolated(width, { empty: spec.kind === 'gate' }), { page, context } = t;
  try {
    const baselineSlot = await snapshot(page);
    await openCase(t, spec); const beforeResize = await fieldState(page, spec.selector);
    if (width === 393) await viewport(page, 400, 30);
    const firstVisible = await assertCaretVisible(page, spec.selector, spec.name + '-first-focus');
    assert.deepEqual(await snapshot(page), baselineSlot, 'Focus and initial viewport changes cannot write data');
    const field = page.locator(spec.selector), longValue = spec.input ? 'FictionalInput-'.repeat(5) : Array.from({ length: 32 }, (_, i) => `第 ${i + 1} 行虛構 CRLF 長文。Complete 測試。`).join('\r\n');
    await field.fill(longValue); await page.waitForTimeout(450);
    const normalized = await field.inputValue(); assert.equal(normalized, spec.input ? longValue : longValue.replace(/\r\n/g, '\n'), 'Only native textarea newline normalization is expected');
    await field.evaluate(el => { el.setSelectionRange(el.value.length, el.value.length); document.dispatchEvent(new Event('selectionchange')); });
    await page.waitForTimeout(250);
    const longVisible = await assertCaretVisible(page, spec.selector, spec.name + '-long-text-end');
    const reminderDraft = spec.kind === 'reminder' && mode !== 'baseline';
    const stable = reminderDraft ? await reminderSnapshot(page, spec, normalized, baselineSlot) : await snapshot(page);
    if (spec.draft) assert.deepEqual(stable.payload.bundle, t.initialBundle, 'Typing only creates an encrypted draft');
    else if (!reminderDraft) assert.deepEqual(stable, baselineSlot, 'Unsaved form input must not write any encrypted data');
    if (width === 393) await viewport(page, 320, 30);
    const shorterVisible = await assertCaretVisible(page, spec.selector, spec.name + '-shorter-keyboard');
    if (width === 393 && spec.kind === 'single') assert.ok(shorterVisible.fieldHeight <= 142, 'Single-store 34dvh minimum must yield to the keyboard-height cap (140px at 320px visual height)');
    if (width === 393) await viewport(page, 320, 60, 'scroll');
    const offsetVisible = await assertCaretVisible(page, spec.selector, spec.name + '-offset-scroll');
    assert.deepEqual(await snapshot(page), stable, 'Viewport resize/offset cannot write data');
    const selected = await field.evaluate(el => { el.setSelectionRange(7, 20, 'backward'); document.dispatchEvent(new Event('selectionchange')); return { start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, value: el.value }; });
    await field.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })));
    if (width === 393) await viewport(page, 320, 30);
    await field.evaluate(el => { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '中', isComposing: true })); });
    await page.waitForTimeout(150);
    const during = await field.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, value: el.value }));
    assert.deepEqual(during, selected, 'Controller must preserve selection direction, CRLF-normalized DOM text and IME state');
    await field.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' })));
    await page.waitForTimeout(350);
    assert.deepEqual(await field.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, value: el.value })), selected);
    await field.evaluate(el => { el.setSelectionRange(el.value.length, el.value.length); document.dispatchEvent(new Event('selectionchange')); }); await page.waitForTimeout(250);
    // The synthetic composition input may schedule a new device draft even though
    // its DOM value stays the same. Drain it before testing read-only gestures.
    const beforeManual = reminderDraft ? await reminderSnapshot(page, spec, normalized, baselineSlot) : await snapshot(page);
    await page.screenshot({ path: path.join(outputDir, `${spec.name}-${width}-keyboard.png`) });
    const manualScroll = await userScrollAndClose(t, spec);
    assert.deepEqual(await snapshot(page), beforeManual, 'Manual scroll and keyboard close cannot write data');
    let confirmedVersion = false;
    if (spec.kind === 'quick') {
      await page.locator('#quick-text-dialog button[type="submit"]').click();
      assert.ok(await page.locator('#quick-text-dialog .quick-diff-added').count());
      assert.deepEqual((await snapshot(page)).payload.bundle, t.initialBundle, 'First submit shows differences without changing formal original text');
      await page.locator('#quick-text-dialog button[type="submit"]').click();
      await page.locator('#visit-attendance-dialog').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#visit-attendance-check').isChecked(), false);
      assert.deepEqual((await snapshot(page)).payload.bundle, t.initialBundle, 'Attendance confirmation is still a preview');
      await page.locator('#visit-attendance-confirm').click();
      const saved = await stored(page, value => value?.payload.bundle.ops.length === t.initialBundle.ops.length + 1);
      assert.equal(saved.payload.bundle.ops.at(-1).visitAttendance, undefined);
      assert.equal(saved.payload.bundle.ops.at(-1).data.text, normalized);
      for (const op of t.initialBundle.ops) assert.deepEqual(saved.payload.bundle.ops.find(item => item.id === op.id), op);
      confirmedVersion = true;
    } else if (spec.kind !== 'gate') assert.deepEqual((await snapshot(page)).payload.bundle, t.initialBundle);
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth); assert.ok(pageWidth <= width + 1);
    assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []); assert.equal(t.apiRequests.includes('/api/pair'), false);
    report.scenarios.push({ name: spec.name, width, beforeResize, firstVisible, longVisible, shorterVisible, offsetVisible, manualScroll, confirmedVersion, legacySyntheticLauncher: spec.kind === 'quick', checks: ['deliberate-focus-only', 'visible-caret', 'textarea-native-newline-normalization', 'selection-preserved', 'composition-preserved', 'viewport-no-persistence', 'no-horizontal-overflow'] });
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, `failure-${spec.name}-${width}.png`) }); throw error;
  } finally { await context.close(); }
}
async function baseline() {
  assert.equal(report.version, '1.5.47', 'Regression baseline must serve frozen v1.5.47 program assets, never the current checkout implicitly');
  const t = await isolated(393), { page, context } = t;
  try {
    await openReminder(page); const before = await snapshot(page);
    assert.equal(await page.evaluate(() => window.qaTextEntry(document.activeElement)), false);
    await page.locator('#store-reminder-next').click();
    const large = await fieldState(page, '#store-reminder-next');
    await viewport(page, 400, 30); const narrow = await fieldState(page, '#store-reminder-next');
    await page.screenshot({ path: path.join(outputDir, 'baseline-reminder-400.png') });
    await viewport(page, 320, 30); const smaller = await fieldState(page, '#store-reminder-next');
    await page.screenshot({ path: path.join(outputDir, 'baseline-reminder-320.png') });
    assert.equal(narrow.focused, true); assert.ok(narrow.top > narrow.viewportBottom || narrow.bottom > narrow.viewportBottom, 'Baseline must reproduce focused field outside the visible area');
    assert.deepEqual(await snapshot(page), before);
    assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []);
    report.scenarios.push({ name: 'v1.5.47-reminder-baseline', width: 393, large, narrow, smaller, baselineBugReproduced: true });
  } finally { await context.close(); }
}

try {
  if (report.mode === 'baseline') await baseline();
  else for (const width of [393, 1440]) for (const spec of cases) await acceptance(width, spec);
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.message; throw error; }
finally {
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, engine, mode: report.mode, passed: report.passed, scenarios: report.scenarios.length, realIPhone: false, thirdPartyKeyboard: false }));
  await browser.close();
}
