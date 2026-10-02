// Opt-in browser acceptance. Synthetic data only; never connect to a running App.
// Usage and the distinction from real iPhone acceptance: DEVICE-ACCEPTANCE.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON
  ? path.resolve(process.env.PLAYWRIGHT_PACKAGE_JSON) : import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch { throw new Error('Provide an installed Playwright module with PLAYWRIGHT_MODULE, or PLAYWRIGHT_PACKAGE_JSON pointing to its runtime package.json. No dependency will be installed by this script.'); }
const browserKind = process.env.QA_BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit', 'firefox'].includes(browserKind), 'Unsupported QA_BROWSER_ENGINE');
const browser = await playwright[browserKind].launch({ headless: true, ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-backup-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18445'; // Route-fulfilled virtual origin; no server is started.
const password = 'synthetic-backup-acceptance-only';
const report = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, browser: browserKind, realIPhone: false, thirdPartyKeyboard: false, scenarios: [] };

async function openIsolated(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 393 ? 852 : 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage(), errors = [], blocked = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { blocked.push(url.origin); return route.abort(); }
    if (url.pathname === '/qa-seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic isolated acceptance</title>' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated test: no App service is connected"}' });
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    const contentType = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ contentType, body: fs.readFileSync(file) });
  });
  await page.goto(origin + '/qa-seed');
  return { context, page, width, errors, blocked };
}

async function seed(page) {
  return page.evaluate(async testPassword => {
    const c = await import('/core.js'), db = await import('/db.js');
    const meta = c.newMeta(), key = await c.derive(testPassword, meta), bundle = c.emptyBundle(meta.vaultId);
    const csv = new TextEncoder().encode('name,note\r\nSynthetic,original source bytes\r\n');
    const csvHash = await c.hashBytes(csv); bundle.blobs[csvHash] = c.b64(csv);
    const attachment = new TextEncoder().encode('%PDF-1.4\nSynthetic attachment bytes only\n%%EOF');
    const attachmentHash = await c.hashBytes(attachment); bundle.blobs[attachmentHash] = c.b64(attachment);
    let store = c.addReminderTasks({ name: '虛構備份驗收門市', city: '', district: '', channel: '', attr: '', contact: '', everyTimeMust: '虛構固定事項' }, 'HAUD\nComplete', '2026-10-01T01:00:00.000Z');
    store = c.completeReminderTask(store, store.nextRememberTasks[0].id, '2026-10-01T02:00:00.000Z');
    bundle.ops.push(c.revision('store', 'qa-store', store, [], 'qa'));
    bundle.ops.push(c.revision('source', 'qa-source', { file: 'synthetic.csv', list: 'Synthetic', blob: csvHash, batch: 'qa', rows: 1, headers: ['name', 'note'], encoding: 'utf-8', delimiter: ',' }, [], 'qa'));
    const visit = { store: 'qa-store', date: '2026-10-01', source: '合成資料', text: Array.from({ length: 45 }, (_, i) => `第 ${i + 1} 行虛構原文，保留每一字。`).join('\n'), next: '', topics: [], people: [], attachments: [{ blob: attachmentHash, name: 'synthetic.pdf', mime: 'application/pdf' }] };
    bundle.ops.push(c.revision('visit', 'qa-visit', visit, [], 'qa'));
    const base = c.revision('visit', 'qa-conflict', { ...visit, text: '共同虛構原文', attachments: [] }, [], 'qa');
    bundle.ops.push(base);
    const incoming = structuredClone(bundle);
    bundle.ops.push(c.revision('visit', 'qa-conflict', { ...base.data, text: '本機版本，不能被靜默覆蓋' }, [base.id], 'local'));
    incoming.ops.push(c.revision('visit', 'qa-conflict', { ...base.data, text: '備份版本，需要人工核對' }, [base.id], 'backup'));
    incoming.ops.push(c.revision('store', 'qa-new-store', { name: '虛構備份新增門市', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'backup'));
    incoming.ops.push(c.revision('visit', 'qa-new-visit', { ...visit, store: 'qa-new-store', text: '只有備份包含的虛構拜訪', attachments: [] }, [], 'backup'));
    c.validateBundle(bundle); c.validateBundle(incoming);
    const backup = async b => JSON.stringify({ format: 'pharmacy-backup-1', envelope: await c.seal(b, key, meta) });
    const envelope = await c.seal({ schema: 1, device: 'qa-device', deviceName: 'Synthetic QA', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null }, key, meta, 'device');
    await db.writeLocal(envelope, 0, key);
    const otherMeta = c.newMeta(), otherKey = await c.derive(testPassword, otherMeta), foreign = c.emptyBundle(otherMeta.vaultId);
    foreign.ops.push(c.revision('store', 'foreign', { name: '另一個虛構資料庫', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'qa'));
    const damaged = JSON.parse(await backup(incoming));
    damaged.envelope.ciphertext = (damaged.envelope.ciphertext[0] === 'A' ? 'B' : 'A') + damaged.envelope.ciphertext.slice(1);
    return { initial: bundle, incoming, backup: await backup(incoming), unchangedBackup: await backup(bundle), foreignBackup: JSON.stringify({ format: 'pharmacy-backup-1', envelope: await c.seal(foreign, otherKey, otherMeta) }), damagedBackup: JSON.stringify(damaged) };
  }, password);
}

async function stored(page) {
  return page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
    return slot ? { revision: slot.revision, payload: await c.unseal(slot.envelope, slot.unlockKey, 'device'), envelope: slot.envelope } : null;
  });
}
async function waitForStored(page, predicate) {
  for (let i = 0; i < 60; i++) { const state = await stored(page); if (predicate(state)) return state; await page.waitForTimeout(100); }
  throw new Error('Timed out waiting for expected encrypted IndexedDB state');
}
async function upload(page, json, gate = false) {
  const fileChooser = page.waitForEvent('filechooser');
  await page.locator(gate ? '#gate-restore' : '#import-backup').click();
  const chooser = await fileChooser;
  await chooser.setFiles({ name: 'synthetic-only.pharmabackup', mimeType: 'application/octet-stream', buffer: Buffer.from(json) });
}
async function assertNoWrite(page, before) {
  const after = await stored(page);
  assert.deepEqual(after, before, 'Preview/cancel must not change the encrypted device slot');
}
async function reviewGeometry(page, width, label) {
  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector('#backup-review'), rect = dialog.getBoundingClientRect();
    return { width: document.documentElement.scrollWidth, viewport: innerWidth, left: rect.left, right: rect.right, height: rect.height, innerOverflow: dialog.scrollWidth > dialog.clientWidth + 1 };
  });
  assert.ok(geometry.width <= width + 1, 'Page horizontal overflow');
  assert.ok(geometry.left >= -1 && geometry.right <= width + 1, 'Backup dialog outside screen');
  assert.equal(geometry.innerOverflow, false, 'Backup dialog horizontal overflow');
  await page.locator('#backup-ack').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDir, `${label}-${width}.png`) });
  return geometry;
}
async function confirmApply(page) {
  assert.equal(await page.locator('#backup-apply').isDisabled(), true, 'Apply requires explicit acknowledgment');
  await page.locator('#backup-ack').check();
  assert.equal(await page.locator('#backup-apply').isEnabled(), true);
  await page.locator('#backup-apply').click();
  await page.locator('#backup-review').waitFor({ state: 'hidden' });
}
function retained(oldBundle, newBundle) {
  for (const op of oldBundle.ops) assert.deepEqual(newBundle.ops.find(item => item.id === op.id), op, 'Original revision must stay unchanged');
  for (const [hash, bytes] of Object.entries(oldBundle.blobs)) assert.equal(newBundle.blobs[hash], bytes, 'Original source/attachment bytes must stay unchanged');
}

async function mergeAcceptance(width) {
  const test = await openIsolated(width), { page, context } = test;
  try {
    const f = await seed(page);
    await page.goto(origin + '/'); await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.locator('.rail [data-view="sync"]').click();
    const initial = await stored(page);
    await upload(page, f.backup); await page.locator('#backup-review').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#backup-review-body').innerText()).trim(), 'Impact summary must be present');
    assert.equal(await page.locator('#backup-apply').isDisabled(), true);
    await assertNoWrite(page, initial);
    const geometry = await reviewGeometry(page, width, 'backup-preview');
    await page.locator('#backup-review-body > details').last().locator('summary').first().click();
    const conflictDetail = page.locator('#backup-changes > details').filter({ hasText: '保留多版本，需另行核對' });
    await conflictDetail.locator('summary').click();
    await conflictDetail.locator('pre').first().waitFor({ state: 'visible' });
    assert.match(await conflictDetail.innerText(), /本機版本，不能被靜默覆蓋/);
    assert.match(await conflictDetail.innerText(), /備份版本，需要人工核對/);
    await conflictDetail.locator('div').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outputDir, `backup-expanded-diff-${width}.png`) });
    await page.locator('#backup-cancel').click(); await page.locator('#backup-review').waitFor({ state: 'hidden' });
    await assertNoWrite(page, initial);
    await upload(page, f.backup); await page.locator('#backup-review').waitFor({ state: 'visible' });
    await confirmApply(page);
    const applied = await waitForStored(page, state => state.payload.bundle.ops.length === initial.payload.bundle.ops.length + 3);
    retained(initial.payload.bundle, applied.payload.bundle); retained(f.incoming, applied.payload.bundle);
    const conflicts = await page.evaluate(async () => { const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal(); const p = await c.unseal(slot.envelope, slot.unlockKey, 'device'); return c.project(p.bundle).find(r => r.id === 'qa-conflict').heads.length; });
    assert.equal(conflicts, 2, 'Conflicting local and incoming edits must both remain');
    assert.ok((await page.locator('#backup-result').innerText()).trim());
    await page.reload(); await page.locator('#workspace').waitFor({ state: 'visible' }); await page.locator('.rail [data-view="sync"]').click();
    assert.deepEqual((await stored(page)).payload.bundle, applied.payload.bundle);
    assert.ok((await page.locator('#backup-result').innerText()).trim(), 'Backup result must survive reload');
    const noOpBefore = await stored(page);
    await upload(page, f.backup); await page.locator('#backup-review').waitFor({ state: 'visible' });
    if (await page.locator('#backup-ack').isEnabled()) await page.locator('#backup-ack').check();
    assert.equal(await page.locator('#backup-apply').isDisabled(), true, 'Already contained backup must not apply again');
    await page.locator('#backup-cancel').click(); await page.locator('#backup-review').waitFor({ state: 'hidden' });
    await assertNoWrite(page, noOpBefore);
    const beforeExport = await stored(page), downloaded = page.waitForEvent('download');
    await page.locator('#export-backup').click();
    const download = await downloaded;
    const downloadedPath = path.join(outputDir, `synthetic-export-${width}.pharmabackup`);
    await download.saveAs(downloadedPath); assert.equal(await download.failure(), null);
    const exportedJSON = fs.readFileSync(downloadedPath, 'utf8');
    const decryptedExport = await page.evaluate(async json => {
      const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal(), data = JSON.parse(json);
      if (data.format !== 'pharmacy-backup-1') throw new Error('Wrong exported format');
      return c.validateBundle(await c.unseal(data.envelope, slot.unlockKey));
    }, exportedJSON);
    assert.deepEqual(decryptedExport, beforeExport.payload.bundle, 'Downloaded export must contain the complete exact bundle');
    const afterExport = await waitForStored(page, state => !!state.payload.lastBackupExport && state.payload.lastBackupExport !== beforeExport.payload.lastBackupExport);
    assert.deepEqual(afterExport.payload, { ...beforeExport.payload, lastBackupExport: afterExport.payload.lastBackupExport }, 'Export can only change local export metadata');
    await upload(page, exportedJSON); await page.locator('#backup-review').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#backup-apply').isDisabled(), true, 'Fresh export of current state is a no-op');
    await assertNoWrite(page, afterExport);
    await page.locator('#backup-cancel').click(); await page.locator('#backup-review').waitFor({ state: 'hidden' });
    await assertNoWrite(page, afterExport);
    for (const [kind, json] of [['foreign', f.foreignBackup], ['damaged', f.damagedBackup]]) {
      const before = await stored(page);
      await upload(page, json);
      await page.waitForFunction(expectedKind => [...document.querySelectorAll('#backup-error, #toast, .toast, #sync-result')].some(el => (expectedKind === 'foreign' ? /另一個資料庫/ : /密碼不正確|損毀/).test(el.textContent)), kind);
      assert.equal(await page.locator('#backup-review').isVisible(), false, `${kind}: invalid backup should not show actionable preview`);
      await assertNoWrite(page, before);
    }
    assert.deepEqual(test.errors, []); assert.deepEqual(test.blocked, [], 'No external origin should be requested');
    report.scenarios.push({ name: 'backup-merge', width, checks: ['preview-zero-write', 'cancel-zero-write', 'explicit-ack', 'apply', 'conflicts-retained', 'source-attachment-bytes', 'reload', 'no-op', 'export-real-download', 'export-exact-bundle', 'export-only-local-metadata', 'export-reselect-cancel-no-write', 'foreign-vault', 'damaged-file'], geometry });
    if (width === 393) await longPreviewAcceptance(test);
    return f;
  } finally { await context.close(); }
}

async function longPreviewAcceptance(test) {
  const { page, width } = test, before = await stored(page);
  const fixture = await page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
    const payload = await c.unseal(slot.envelope, slot.unlockKey, 'device'), bundle = structuredClone(payload.bundle);
    const visitsBefore = new Set(bundle.ops.filter(op => op.type === 'visit').map(op => op.entity)).size;
    for (let i = 0; i < 25; i++) bundle.ops.push(c.revision('visit', `qa-lazy-${String(i).padStart(2, '0')}`, { store: 'qa-store', date: '2026-10-01', source: '合成分頁驗收', text: `SYNTHETIC_LAZY_BODY_${i}\n僅供測試的原文，不應在展開前插入DOM。`, next: '', topics: [], people: [], attachments: [] }, [], 'qa'));
    return { visitsBefore, backup: JSON.stringify({ format: 'pharmacy-backup-1', envelope: await c.seal(bundle, slot.unlockKey, slot.envelope) }) };
  });
  await upload(page, fixture.backup); await page.locator('#backup-review').waitFor({ state: 'visible' });
  const summary = (await page.locator('#backup-review-body .backup-counts').innerText()).replace(/\s+/g, '');
  assert.ok(summary.includes(`拜訪：${fixture.visitsBefore}→${fixture.visitsBefore + 25}筆（新增25筆）`), 'Summary must count all 25 changes, not only the visible page');
  await page.locator('#backup-review-body > details').last().locator('summary').first().click();
  assert.equal(await page.locator('#backup-changes > details').count(), 20);
  assert.match(await page.locator('#backup-pages').innerText(), /第 1／2 頁.*共 25 筆/s);
  assert.doesNotMatch(await page.locator('#backup-changes').textContent(), /SYNTHETIC_LAZY_BODY_/, 'Collapsed rows must not populate raw-text DOM');
  await page.locator('#backup-changes > details > summary').first().click();
  await page.waitForFunction(() => document.querySelector('#backup-changes').textContent.includes('SYNTHETIC_LAZY_BODY_'));
  assert.equal(await page.locator('#backup-changes > details[open]').count(), 1);
  await page.locator('#backup-pages [data-backup-page="1"]').click();
  assert.equal(await page.locator('#backup-changes > details').count(), 5);
  assert.match(await page.locator('#backup-pages').innerText(), /第 2／2 頁.*共 25 筆/s);
  assert.doesNotMatch(await page.locator('#backup-changes').textContent(), /SYNTHETIC_LAZY_BODY_/, 'Changing pages must not retain previous raw-text DOM');
  await page.locator('#backup-changes > details > summary').first().click();
  await page.waitForFunction(() => document.querySelector('#backup-changes').textContent.includes('SYNTHETIC_LAZY_BODY_'));
  const geometry = await reviewGeometry(page, width, 'backup-long-preview');
  await assertNoWrite(page, before);
  await page.locator('#backup-cancel').click(); await page.locator('#backup-review').waitFor({ state: 'hidden' });
  await assertNoWrite(page, before);
  assert.deepEqual(test.errors, []); assert.deepEqual(test.blocked, []);
  report.scenarios.push({ name: 'long-preview-pagination', width, changes: 25, checks: ['all-record-counts', '20-and-5-rows', 'lazy-raw-content', 'expand-one-record', 'page-change-clears-raw-dom', 'preview-cancel-zero-write'], geometry });
}

async function restoreAcceptance(width, f) {
  const test = await openIsolated(width), { context, page } = test;
  try {
    await page.goto(origin + '/'); await page.locator('#gate').waitFor({ state: 'visible' });
    await page.locator('#password').fill('deliberately-wrong-synthetic-password');
    await upload(page, f.backup, true);
    await page.waitForFunction(() => /密碼不正確|損毀/.test(document.querySelector('#gate-error').textContent));
    assert.equal(await stored(page), null, 'Wrong password must not create a database');
    assert.equal(await page.locator('#backup-review').isVisible(), false);
    await page.locator('#password').fill(password);
    assert.equal(await stored(page), null);
    await upload(page, f.backup, true); await page.locator('#backup-review').waitFor({ state: 'visible' });
    assert.equal(await stored(page), null, 'Restore preview must not create local database');
    await reviewGeometry(page, width, 'restore-preview');
    await page.locator('#backup-cancel').click(); await page.locator('#backup-review').waitFor({ state: 'hidden' });
    assert.equal(await stored(page), null, 'Restore cancellation must not create local database');
    await page.locator('#password').fill(password);
    await upload(page, f.backup, true); await page.locator('#backup-review').waitFor({ state: 'visible' });
    await confirmApply(page); await page.locator('#workspace').waitFor({ state: 'visible' });
    const restored = await stored(page);
    assert.deepEqual(restored.payload.bundle, f.incoming); assert.equal(restored.payload.token, null);
    await page.reload(); await page.locator('#workspace').waitFor({ state: 'visible' });
    assert.deepEqual((await stored(page)).payload.bundle, f.incoming);
    await page.locator('.rail [data-view="sync"]').click(); assert.ok((await page.locator('#backup-result').innerText()).trim());
    assert.deepEqual(test.errors, []); assert.deepEqual(test.blocked, []);
    report.scenarios.push({ name: 'empty-device-restore', width, checks: ['wrong-password', 'preview-no-slot', 'cancel-no-slot', 'explicit-ack', 'exact-bundle', 'unpaired', 'reload'] });
  } finally { await context.close(); }
}

async function dailyRegression(width) {
  const test = await openIsolated(width), { context, page } = test;
  try {
    const f = await seed(page);
    // Synthetic Visual Viewport only, explicitly not a software keyboard or iPhone.
    if (width === 393) await page.addInitScript(() => {
      const viewport = new EventTarget(); Object.assign(viewport, { width: 393, height: 852, offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      window.qaViewport = viewport;
    });
    await page.goto(origin + '/'); await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.locator('[data-visit-brief="qa-store"]').first().click(); await page.locator('#review').waitFor({ state: 'visible' });
    const original = f.initial.ops.find(op => op.entity === 'qa-visit');
    const changed = original.data.text + '\n虛構驗收新增末行';
    const editor = page.locator('#review [data-inline-edit-text="qa-visit"]');
    await editor.fill(changed);
    await waitForStored(page, state => state.payload.inlineTextDraft?.after === changed);
    assert.deepEqual((await stored(page)).payload.bundle, f.initial, 'Editing creates encrypted draft, not formal revision');
    let keyboardGeometry = null;
    if (width === 393) {
      await editor.evaluate(el => { el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); Object.assign(window.qaViewport, { height: 400, offsetTop: 30 }); window.qaViewport.dispatchEvent(new Event('resize')); });
      await page.waitForTimeout(350);
      keyboardGeometry = await page.evaluate(() => {
        const modal = document.querySelector('#review').getBoundingClientRect(), dock = document.querySelector('#review [data-inline-shell="qa-visit"] .inline-edit-actions').getBoundingClientRect();
        const range = getSelection().getRangeAt(0).cloneRange(); let caret = range.getBoundingClientRect();
        // Chromium can report an empty rect for a caret at an element boundary.
        // Measure the final adjacent character without changing the selection or DOM.
        if (!caret.height) {
          let node = range.endContainer, offset = range.endOffset;
          if (node.nodeType !== Node.TEXT_NODE) { node = node.childNodes[Math.max(0, offset - 1)]; while (node?.lastChild) node = node.lastChild; offset = node?.textContent?.length || 0; }
          if (node?.nodeType === Node.TEXT_NODE && offset) { range.setStart(node, offset - 1); range.setEnd(node, offset); caret = range.getBoundingClientRect(); }
        }
        return { top: modal.top, height: modal.height, dockTop: dock.top, dockBottom: dock.bottom, caretTop: caret.top, caretBottom: caret.bottom, pageWidth: document.documentElement.scrollWidth };
      });
      assert.ok(Math.abs(keyboardGeometry.top - 30) <= 2); assert.ok(Math.abs(keyboardGeometry.height - 400) <= 2);
      assert.ok(keyboardGeometry.dockBottom <= 430); assert.ok(keyboardGeometry.pageWidth <= 394);
      await page.screenshot({ path: path.join(outputDir, 'simulated-keyboard-393.png') });
      assert.ok(keyboardGeometry.caretTop >= keyboardGeometry.top && keyboardGeometry.caretBottom <= keyboardGeometry.dockTop - 8, `Last-line caret must stay above editing controls: ${JSON.stringify(keyboardGeometry)}`);
      await page.evaluate(() => { Object.assign(window.qaViewport, { height: 852, offsetTop: 0 }); window.qaViewport.dispatchEvent(new Event('resize')); });
    }
    await page.locator('#review [data-inline-review="qa-visit"]').click(); await page.locator('#quick-text-dialog').waitFor({ state: 'visible' });
    assert.ok(await page.locator('#quick-text-dialog .quick-diff-added').count());
    assert.deepEqual((await stored(page)).payload.bundle, f.initial, 'Difference review does not commit');
    await page.locator('#quick-text-dialog button[type="submit"]').click();
    await page.locator('#visit-attendance-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#visit-attendance-check').isChecked(), false);
    await page.locator('#visit-attendance-confirm').click();
    await page.locator('#quick-text-dialog').waitFor({ state: 'hidden' });
    const saved = await waitForStored(page, state => state.payload.bundle.ops.length === f.initial.ops.length + 1);
    retained(f.initial, saved.payload.bundle); assert.equal(saved.payload.inlineTextDraft, null);
    const last = saved.payload.bundle.ops.at(-1); assert.equal(last.entity, 'qa-visit'); assert.equal(last.data.text, changed);
    assert.equal(await page.locator('#review [data-inline-shell="qa-visit"] .inline-edit-actions').isVisible(), false);
    const dialogPromise = page.waitForEvent('dialog'), click = page.locator('#review [data-reminder-complete]').first().click();
    const confirmation = await dialogPromise; assert.match(confirmation.message(), /完成/); await confirmation.accept(); await click;
    await page.locator('#visit-attendance-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#visit-attendance-check').isChecked(), false);
    await page.locator('#visit-attendance-confirm').click();
    await waitForStored(page, state => state.payload.bundle.ops.length === saved.payload.bundle.ops.length + 1);
    await page.locator('#review .reminder-task-history summary').click(); assert.match(await page.locator('#review .reminder-task-history').innerText(), /HAUD/);
    await page.locator('#review [data-close="review"]').click(); await page.reload(); await page.locator('#workspace').waitFor({ state: 'visible' });
    const final = await stored(page); retained(f.initial, final.payload.bundle);
    assert.deepEqual(test.errors, []); assert.deepEqual(test.blocked, []);
    report.scenarios.push({ name: 'daily-inline-and-task-regression', width, checks: ['encrypted-draft', 'diff-before-commit', 'original-history', 'one-new-visit-revision', 'clear-editor', 'complete-task', 'reload'], keyboardGeometry, keyboardIsSimulated: width === 393 });
  } finally { await context.close(); }
}

try {
  for (const width of [393, 1440]) {
    const fixture = await mergeAcceptance(width);
    await restoreAcceptance(width, fixture);
    await dailyRegression(width);
  }
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.message; throw error;
} finally {
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, passed: report.passed, scenarios: report.scenarios.length, realIPhone: false, thirdPartyKeyboard: false }));
  await browser.close();
}
