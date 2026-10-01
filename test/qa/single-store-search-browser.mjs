// Full-App browser acceptance with synthetic records and an intercepted virtual origin.
// No real customer data, running App service, installed browser profile, or external site.
// Reuse installed tooling only: PLAYWRIGHT_PACKAGE_JSON or PLAYWRIGHT_MODULE;
// QA_BROWSER_ENGINE=chromium|webkit|firefox, optional QA_BROWSER_EXECUTABLE/QA_OUTPUT_DIR.
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
catch { throw new Error('Provide an already installed Playwright module with PLAYWRIGHT_MODULE or PLAYWRIGHT_PACKAGE_JSON. This test installs nothing.'); }
const engine = process.env.QA_BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit', 'firefox'].includes(engine), 'Unsupported browser engine');
const browser = await playwright[engine].launch({ headless: true, ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-search-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18446';
const report = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, engine, browserVersion: browser.version(), realIPhone: false, thirdPartyKeyboard: false, simulatedComposition: true, scenarios: [] };
const htmlNeedle = '<img src=x onerror="window.qaXss=1">';

async function isolated(width, { fallback = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 393 ? 852 : 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], external = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (url.pathname === '/qa-seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic single-store search QA</title>' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated synthetic QA: no App service connected"}' });
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ contentType, body: fs.readFileSync(file) });
  });
  if (fallback) await page.addInitScript(() => { Object.defineProperty(window, 'Highlight', { configurable: true, value: undefined }); Object.defineProperty(CSS, 'highlights', { configurable: true, value: undefined }); });
  if (width === 393) await page.addInitScript(() => {
    const viewport = new EventTarget(); Object.assign(viewport, { width: 393, height: 852, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport }); window.qaViewport = viewport;
  });
  await page.goto(origin + '/qa-seed');
  const initialBundle = await page.evaluate(async dangerousText => {
    const c = await import('/core.js'), db = await import('/db.js'), meta = c.newMeta(), key = await c.derive('synthetic-search-qa-only', meta), bundle = c.emptyBundle(meta.vaultId);
    const storeData = name => ({ name, city: '', district: '', channel: '', attr: '', contact: '', everyTimeMust: 'FIXED_ONLY_TOKEN' });
    bundle.ops.push(c.revision('store', 'qa-store-a', c.addReminderTasks(storeData('虛構搜尋甲店'), 'TASK_ONLY_TOKEN'), [], 'qa'));
    bundle.ops.push(c.revision('store', 'qa-store-b', storeData('虛構搜尋乙店'), [], 'qa'));
    const bytes = new TextEncoder().encode('name,note\r\nSynthetic,SNAPSHOT_ONLY_TOKEN\r\n'), blob = await c.hashBytes(bytes); bundle.blobs[blob] = c.b64(bytes);
    bundle.ops.push(c.revision('source', 'qa-source', { file: 'synthetic-search.csv', list: 'Synthetic', blob, batch: 'qa', rows: 1, headers: ['name', 'note'], encoding: 'utf-8', delimiter: ',' }, [], 'qa'));
    const data = (text, store = 'qa-store-a', date = '2026-10-02') => ({ store, date, source: '虛構來源', text, next: 'NEXT_ONLY_TOKEN', topics: [], people: [], attachments: [] });
    const lines = Array.from({ length: 45 }, (_, i) => `第 ${i + 1} 行虛構拜訪文字，逐字保留。`);
    lines[10] += ' Complete 第一處'; lines[37] += ' Complete 第二處';
    lines.push('A.*[C]+? 是要逐字搜尋的符號。', '😀玻尿酸，Unicode位置不可錯位。', dangerousText);
    bundle.ops.push(c.revision('visit', 'qa-long', data(lines.join('\n')), [], 'qa'));
    bundle.ops.push(c.revision('visit', 'qa-short', data('另一筆原文 Complete 第三處。', 'qa-store-a', '2026-10-01'), [], 'qa'));
    bundle.ops.push(c.revision('visit', 'qa-other-store', data('Complete STORE_B_ONLY_TOKEN', 'qa-store-b'), [], 'qa'));
    const old = c.revision('visit', 'qa-revised', data('OLD_REV_ONLY_TOKEN'), [], 'qa'); bundle.ops.push(old, c.revision('visit', old.entity, data('這筆目前有效原文沒有舊版暗號。'), [old.id], 'qa'));
    const deleted = c.revision('visit', 'qa-deleted', data('DELETED_ONLY_TOKEN'), [], 'qa'); bundle.ops.push(deleted, c.revision('visit', deleted.entity, deleted.data, [deleted.id], 'qa', true));
    const conflict = c.revision('visit', 'qa-conflict', data('CONFLICT_ONLY_TOKEN'), [], 'qa'); bundle.ops.push(conflict, c.revision('visit', conflict.entity, data('CONFLICT_ONLY_TOKEN 手機分支'), [conflict.id], 'phone'), c.revision('visit', conflict.entity, data('CONFLICT_ONLY_TOKEN 桌面分支'), [conflict.id], 'mac'));
    bundle.ops.push(c.revision('visit', 'qa-limit', data('LIMIT_TOKEN '.repeat(501), 'qa-store-a', '2026-09-01'), [], 'qa'));
    c.validateBundle(bundle);
    await db.writeLocal(await c.seal({ schema: 1, device: 'qa-device', deviceName: 'Synthetic Search QA', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, lastHealthAudit: new Date().toISOString() }, key, meta, 'device'), 0, key);
    return bundle;
  }, htmlNeedle);
  await page.goto(origin + '/'); await page.locator('#workspace').waitFor({ state: 'visible' });
  return { context, page, width, fallback, errors, external, initialBundle };
}
async function snapshot(page) {
  return page.evaluate(async () => { const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal(); return { revision: slot.revision, envelope: slot.envelope, payload: await c.unseal(slot.envelope, slot.unlockKey, 'device') }; });
}
async function waitForStored(page, predicate) {
  for (let n = 0; n < 70; n++) { const s = await snapshot(page); if (predicate(s)) return s; await page.waitForTimeout(100); }
  throw new Error('Timed out waiting for encrypted test draft/commit');
}
async function openStore(page, id = 'qa-store-a') {
  if (await page.locator('#review').isVisible()) await page.locator('#review [data-close="review"]').click();
  await page.locator('.rail [data-view="stores"]').click();
  await page.locator(`#stores-view [data-visit-brief="${id}"]`).first().click();
  await page.locator('#brief-search').waitFor({ state: 'visible' });
}
async function query(page, value) { await page.locator('#brief-search').fill(value); await page.waitForTimeout(260); }
async function matchState(page) {
  return page.evaluate(() => {
    const current = CSS.highlights?.get('brief-search-current'), all = CSS.highlights?.get('brief-search-all'), range = current ? [...current][0] : null;
    const target = document.querySelector('#review .brief-search-target');
    const editor = target?.matches('[data-inline-edit-text]') ? target : target?.querySelector('[data-inline-edit-text]');
    let offset = null;
    if (range && editor) { const prefix = document.createRange(); prefix.selectNodeContents(editor); prefix.setEnd(range.startContainer, range.startOffset); offset = prefix.toString().length; }
    const rect = range?.getBoundingClientRect(), body = document.querySelector('#review-body').getBoundingClientRect();
    return { visit: editor?.dataset.inlineEditText || target?.dataset.briefVisit || null, offset, currentText: range?.toString() || null, highlighted: all?.size || 0, status: document.querySelector('#brief-search-status').textContent, preview: document.querySelector('#brief-search-preview').textContent, rect: rect ? { top: rect.top, bottom: rect.bottom } : null, body: { top: body.top, bottom: body.bottom } };
  });
}
async function geometry(page, width, name) {
  const g = await page.evaluate(() => {
    const panel = document.querySelector('#brief-search-panel').getBoundingClientRect(), body = document.querySelector('#review-body').getBoundingClientRect(), dialog = document.querySelector('#review').getBoundingClientRect();
    return { pageWidth: document.documentElement.scrollWidth, dialogLeft: dialog.left, dialogRight: dialog.right, panelTop: panel.top, panelBottom: panel.bottom, bodyTop: body.top, bodyBottom: body.bottom, horizontalOverflow: document.querySelector('#review-body').scrollWidth > document.querySelector('#review-body').clientWidth + 1 };
  });
  assert.ok(g.pageWidth <= width + 1); assert.ok(g.dialogLeft >= -1 && g.dialogRight <= width + 1);
  assert.equal(g.horizontalOverflow, false); assert.ok(g.panelBottom <= g.bodyTop + 1, 'Search controls must stay outside the note scroller');
  assert.ok(g.bodyBottom > g.bodyTop + 40, 'Original-note scroller needs usable visible height');
  await page.screenshot({ path: path.join(outputDir, `${name}-${width}.png`) }); return g;
}
function retains(before, after) { for (const op of before.ops) assert.deepEqual(after.ops.find(x => x.id === op.id), op); assert.deepEqual(after.blobs, before.blobs); }

async function readOnlyAcceptance(width, fallback = false) {
  const t = await isolated(width, { fallback }), { page, context } = t;
  try {
    await openStore(page);
    const before = await snapshot(page);
    const domBefore = await page.evaluate(() => { window.qaOriginalEditors = [...document.querySelectorAll('#review [data-inline-edit-text]')]; return window.qaOriginalEditors.map(el => ({ id: el.dataset.inlineEditText, html: el.innerHTML })); });
    await query(page, 'Complete');
    let state = await matchState(page);
    assert.equal(state.visit, 'qa-long'); assert.match(state.preview, /Complete/);
    if (!fallback) { assert.equal(state.highlighted, 3); assert.equal(state.currentText, 'Complete'); assert.equal(state.offset, t.initialBundle.ops.find(x => x.entity === 'qa-long').data.text.indexOf('Complete')); }
    assert.ok(state.rect ? state.rect.top >= state.body.top - 2 && state.rect.bottom <= state.body.bottom + 2 : fallback, 'First hit must be visible in original text');
    const first = state;
    await page.locator('#brief-search-next').click(); await page.waitForTimeout(120); state = await matchState(page);
    assert.equal(state.visit, 'qa-long'); if (!fallback) assert.ok(state.offset > first.offset, 'Next moves to the next occurrence within the same note');
    await page.locator('#brief-search').press('Enter'); await page.waitForTimeout(120); state = await matchState(page); assert.equal(state.visit, 'qa-short');
    await page.locator('#brief-search').press('Shift+Enter'); await page.waitForTimeout(120); state = await matchState(page); assert.equal(state.visit, 'qa-long');
    await page.locator('#brief-search-prev').click(); await page.waitForTimeout(120); if (!fallback) assert.equal((await matchState(page)).offset, first.offset);
    for (const word of ['STORE_B_ONLY_TOKEN', 'NEXT_ONLY_TOKEN', 'TASK_ONLY_TOKEN', 'FIXED_ONLY_TOKEN', 'OLD_REV_ONLY_TOKEN', 'CONFLICT_ONLY_TOKEN', 'DELETED_ONLY_TOKEN', 'SNAPSHOT_ONLY_TOKEN']) {
      await query(page, word); state = await matchState(page); assert.equal(state.visit, null, `${word} must not be searched in current store original notes`); assert.equal(state.highlighted, 0); assert.equal(await page.locator('#brief-search-next').isDisabled(), true);
    }
    for (const word of ['A.*[C]+?', '玻尿酸', htmlNeedle]) {
      await query(page, word); state = await matchState(page); assert.equal(state.visit, 'qa-long'); assert.ok(state.preview.includes(word));
      if (!fallback) { assert.equal(state.highlighted, 1); assert.equal(state.currentText, word); }
    }
    assert.equal(await page.locator('#brief-search-preview img').count(), 0); assert.equal(await page.evaluate(() => !!window.qaXss), false);
    await query(page, 'A.*[C]+?');
    const composingBefore = await matchState(page);
    const compositionScroll = await page.locator('#review-body').evaluate(el => el.scrollTop);
    await page.locator('#brief-search').evaluate(el => { el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })); el.value = 'Complete'; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'Complete', isComposing: true })); });
    await page.waitForTimeout(260); const composingNow = await matchState(page);
    assert.equal(composingNow.status, composingBefore.status); assert.equal(composingNow.preview, composingBefore.preview, 'IME composition must not search the unfinished text');
    assert.equal(await page.locator('#review-body').evaluate(el => el.scrollTop), compositionScroll, 'IME composition must not reposition original notes');
    await page.locator('#brief-search').evaluate(el => { el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'Complete' })); el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Complete', isComposing: false })); });
    await page.waitForTimeout(260); state = await matchState(page); assert.equal(state.visit, 'qa-long'); if (!fallback) assert.equal(state.highlighted, 3);
    const g = await geometry(page, width, fallback ? 'search-fallback' : 'search-results');
    if (!fallback) {
      await query(page, 'LIMIT_TOKEN'); state = await matchState(page); assert.equal(state.visit, 'qa-limit'); assert.equal(state.highlighted, 500); assert.match(state.status, /500/);
    }
    await page.locator('#brief-search-clear').click(); assert.equal(await page.locator('#brief-search').inputValue(), ''); assert.equal((await matchState(page)).highlighted, 0);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#review [data-inline-edit-text]')].map(el => ({ id: el.dataset.inlineEditText, html: el.innerHTML }))), domBefore, 'Search must not rewrite contenteditable DOM');
    assert.equal(await page.evaluate(() => window.qaOriginalEditors.every(el => el.isConnected)), true, 'Search must not replace editor elements');
    assert.equal(await page.evaluate(() => !!document.activeElement?.matches('[data-inline-edit-text]')), false, 'Searching or jumping must not focus an editable note');
    await query(page, 'Complete'); await openStore(page, 'qa-store-b');
    assert.equal(await page.locator('#brief-search').inputValue(), '', 'Different store must start without previous query');
    await query(page, 'Complete'); state = await matchState(page); assert.equal(state.visit, 'qa-other-store'); if (!fallback) assert.equal(state.highlighted, 1);
    await page.locator('#review [data-close="review"]').click(); await openStore(page, 'qa-store-b'); assert.equal(await page.locator('#brief-search').inputValue(), '', 'Closing and reopening clears search');
    await query(page, 'Complete');
    await page.evaluate(() => { document.querySelector('#review').close(); document.querySelector('#stores-view [data-visit-brief="qa-store-a"]').click(); });
    await page.waitForTimeout(180); assert.equal(await page.locator('#review').isVisible(), true); assert.equal(await page.locator('#brief-search-panel').isVisible(), true); assert.equal(await page.locator('#brief-search').inputValue(), '');
    await query(page, 'STORE_B_ONLY_TOKEN'); assert.equal((await matchState(page)).visit, null, 'Delayed old close event cannot keep previous store search context');
    await query(page, 'Complete'); assert.equal((await matchState(page)).visit, 'qa-long');
    assert.deepEqual(await snapshot(page), before, 'All searching/jumping/clearing/changing stores must leave encrypted device bytes unchanged');
    assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []);
    report.scenarios.push({ name: fallback ? 'readonly-search-without-css-highlights' : 'readonly-search', width, fallback, geometry: g, checks: ['same-note-next-occurrence', 'cross-note-next', 'keyboard-navigation', 'scope-exclusions', 'literal-punctuation', 'unicode', 'escaped-html', 'composition-defer', 'unchanged-editor-dom', 'unchanged-encrypted-slot', 'store-close-reset', 'same-turn-close-reopen', ...(fallback ? [] : ['500-match-cap'])] });
  } finally { await context.close(); }
}

async function editingAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    await openStore(page); await query(page, 'Complete');
    const before = await snapshot(page), original = t.initialBundle.ops.find(x => x.entity === 'qa-long').data.text;
    let editor = page.locator('#review [data-inline-edit-text="qa-long"]');
    await editor.evaluate(el => { el.focus(); const range = document.createRange(); range.setStart(el.firstChild, 7); range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await page.waitForTimeout(150);
    assert.equal((await matchState(page)).highlighted, 0, 'Focusing original text must clear search highlights');
    assert.equal(await page.evaluate(() => getSelection().anchorOffset), 7, 'Search focus handling must preserve caret');
    assert.deepEqual(await snapshot(page), before, 'Moving caret without typing is read-only');
    await page.locator('#brief-search').focus(); await page.waitForTimeout(180); assert.equal((await matchState(page)).highlighted, 3, 'Clean blur resumes search');
    const changed = original + '\n虛構驗收新增文字'; await editor.fill(changed);
    const draft = await waitForStored(page, s => s.payload.inlineTextDraft?.after === changed);
    assert.deepEqual(draft.payload.bundle, t.initialBundle);
    assert.equal(await page.locator('#brief-search').isDisabled(), true); assert.equal(await page.locator('#brief-search-prev').isDisabled(), true); assert.equal(await page.locator('#brief-search-next').isDisabled(), true);
    assert.match(await page.locator('#brief-search-status').innerText(), /暫停|修改|草稿/);
    const selectionBefore = await page.evaluate(() => ({ node: getSelection().anchorNode?.textContent, offset: getSelection().anchorOffset }));
    await page.waitForTimeout(260); assert.deepEqual(await page.evaluate(() => ({ node: getSelection().anchorNode?.textContent, offset: getSelection().anchorOffset })), selectionBefore);
    let keyboardGeometry = null;
    if (width === 393) {
      await editor.evaluate(el => { el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(range); Object.assign(window.qaViewport, { height: 400, offsetTop: 30 }); window.qaViewport.dispatchEvent(new Event('resize')); });
      await page.waitForTimeout(300);
      keyboardGeometry = await page.evaluate(() => {
        const dock = document.querySelector('#review [data-inline-shell="qa-long"] .inline-edit-actions').getBoundingClientRect(), body = document.querySelector('#review-body').getBoundingClientRect(), range = getSelection().getRangeAt(0).cloneRange(); let caret = range.getBoundingClientRect();
        if (!caret.height) { let node = range.endContainer, offset = range.endOffset; if (node.nodeType !== Node.TEXT_NODE) { node = node.childNodes[Math.max(0, offset - 1)]; while (node?.lastChild) node = node.lastChild; offset = node?.textContent?.length || 0; } if (node?.nodeType === Node.TEXT_NODE && offset) { range.setStart(node, offset - 1); range.setEnd(node, offset); caret = range.getBoundingClientRect(); } }
        return { dockTop: dock.top, dockBottom: dock.bottom, bodyTop: body.top, caretTop: caret.top, caretBottom: caret.bottom, pageWidth: document.documentElement.scrollWidth };
      });
      await page.screenshot({ path: path.join(outputDir, 'search-edit-simulated-keyboard-393.png') });
      assert.ok(keyboardGeometry.dockBottom <= 430); assert.ok(keyboardGeometry.pageWidth <= 394);
      assert.ok(keyboardGeometry.caretTop >= keyboardGeometry.bodyTop && keyboardGeometry.caretBottom <= keyboardGeometry.dockTop - 8, JSON.stringify(keyboardGeometry));
      await page.evaluate(() => { Object.assign(window.qaViewport, { height: 852, offsetTop: 0 }); window.qaViewport.dispatchEvent(new Event('resize')); });
    }
    await page.locator('#review [data-inline-review="qa-long"]').click(); await page.locator('#quick-text-dialog').waitFor({ state: 'visible' });
    assert.ok(await page.locator('#quick-text-dialog .quick-diff-added').count()); assert.deepEqual((await snapshot(page)).payload.bundle, t.initialBundle, 'Diff preview may save draft but cannot save formal text');
    await page.locator('#quick-text-dialog button[type="submit"]').click(); await page.locator('#quick-text-dialog').waitFor({ state: 'hidden' });
    const saved = await waitForStored(page, s => s.payload.bundle.ops.length === t.initialBundle.ops.length + 1 && !s.payload.inlineTextDraft);
    retains(t.initialBundle, saved.payload.bundle); assert.equal(saved.payload.bundle.ops.at(-1).entity, 'qa-long'); assert.equal(saved.payload.bundle.ops.at(-1).data.text, changed);
    assert.equal(await page.locator('#brief-search').inputValue(), 'Complete'); assert.equal(await page.locator('#brief-search').isEnabled(), true);
    await page.locator('#brief-search').focus(); await page.waitForTimeout(180); assert.equal((await matchState(page)).highlighted, 3);
    await query(page, '玻尿酸'); editor = page.locator('#review [data-inline-edit-text="qa-long"]'); await editor.fill(changed + '\nCANCEL_ONLY_DRAFT');
    await waitForStored(page, s => s.payload.inlineTextDraft?.after?.includes('CANCEL_ONLY_DRAFT'));
    await page.locator('#review [data-inline-cancel="qa-long"]').click(); await waitForStored(page, s => !s.payload.inlineTextDraft);
    assert.deepEqual((await snapshot(page)).payload.bundle, saved.payload.bundle); assert.equal(await page.locator('#brief-search').inputValue(), '玻尿酸');
    assert.equal(await page.locator('#review [data-inline-edit-text="qa-long"]').innerText(), changed);
    await page.locator('#brief-search').focus(); await page.waitForTimeout(180); assert.equal((await matchState(page)).highlighted, 1);
    const noWrite = await snapshot(page); await page.locator('#brief-search-next').click(); await page.locator('#brief-search-clear').click(); assert.deepEqual(await snapshot(page), noWrite);
    await page.locator('#review [data-close="review"]').click(); await page.reload(); await page.locator('#workspace').waitFor({ state: 'visible' });
    assert.deepEqual((await snapshot(page)).payload.bundle, saved.payload.bundle);
    assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []);
    report.scenarios.push({ name: 'editing-and-draft-protection', width, keyboardIsSimulated: width === 393, keyboardGeometry, checks: ['focus-clears-highlight-not-caret', 'clean-focus-zero-write', 'clean-blur-resumes', 'dirty-draft-freezes-search', 'unchanged-selection', 'diff-before-commit', 'one-visit-revision', 'save-preserves-query', 'cancel-preserves-query', 'reload-history'] });
  } finally { await context.close(); }
}

async function newVisitDraftAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    await openStore(page); await query(page, 'Complete'); const before = await snapshot(page);
    await page.locator('#review [data-start-single-store-capture]').click();
    assert.equal(await page.locator('#brief-search').isDisabled(), true, 'An open new-visit form pauses old-note search');
    assert.deepEqual(await snapshot(page), before, 'Opening capture without typing is not a formal or draft save');
    await page.locator('#single-store-text').fill('虛構本次拜訪草稿');
    await waitForStored(page, s => s.payload.draft?.fields?.text === '虛構本次拜訪草稿');
    assert.deepEqual((await snapshot(page)).payload.bundle, t.initialBundle);
    await page.locator('#review [data-collapse-single-store-capture]').click();
    assert.equal(await page.locator('#brief-search').isDisabled(), true, 'Collapsed saved draft still pauses search');
    const withDraft = await snapshot(page); await openStore(page, 'qa-store-b');
    assert.equal(await page.locator('#brief-search').isDisabled(), true, 'Unfinished draft on another store remains protected');
    assert.deepEqual(await snapshot(page), withDraft, 'Reopening another store cannot mutate or discard draft');
    assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []);
    report.scenarios.push({ name: 'new-visit-draft-protection', width, checks: ['capture-pauses-search', 'empty-capture-zero-write', 'only-encrypted-draft', 'collapsed-draft-pauses', 'other-store-draft-preserved'] });
  } finally { await context.close(); }
}

try {
  for (const width of [393, 1440]) { await readOnlyAcceptance(width); await editingAcceptance(width); await newVisitDraftAcceptance(width); }
  await readOnlyAcceptance(393, true);
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.message; throw error; }
finally {
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, engine, passed: report.passed, scenarios: report.scenarios.length, realIPhone: false, thirdPartyKeyboard: false }));
  await browser.close();
}
