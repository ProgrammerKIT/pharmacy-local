// Full-App acceptance with fictional records and an intercepted virtual origin.
// No running App service, real customer data, installed browser profile, or network.
// Reuse installed Playwright via PLAYWRIGHT_PACKAGE_JSON or PLAYWRIGHT_MODULE.
// QA_BROWSER_ENGINE, QA_BROWSER_EXECUTABLE and QA_OUTPUT_DIR are optional.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON ? path.resolve(process.env.PLAYWRIGHT_PACKAGE_JSON) : import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch { throw new Error('Provide an already installed Playwright module via PLAYWRIGHT_MODULE or PLAYWRIGHT_PACKAGE_JSON. This script installs nothing.'); }
const engine = process.env.QA_BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit', 'firefox'].includes(engine), 'Unsupported browser engine');
const browser = await playwright[engine].launch({ headless: true, ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-store-discovery-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18451';
const report = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, engine, browserVersion: browser.version(), fictionalOnly: true, connectedAppService: false, persistentBrowserProfile: false, realIPhone: false, scenarios: [] };
const emptyName = '虛構新晨 Alpha 藥局';
const pendingTask = '虛構待辦：帶產品資訊小卡';
const completedTask = '虛構已完成任務：電話核對';
const everyReminder = '虛構每次提醒：先確認方便談話';
const legacyReminder = '虛構舊式提醒：確認資料收件人';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function isolated(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 393 ? 852 : 900 }, serviceWorkers: 'block', timezoneId: 'Asia/Taipei' });
  const page = await context.newPage(), errors = [], external = [], apiRequests = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (url.pathname === '/qa-seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fictional zero-visit store discovery QA</title>' });
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push({ path: url.pathname, method: route.request().method() });
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated fictional QA: no App service connected"}' });
    }
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ contentType, body: fs.readFileSync(file) });
  });
  await page.goto(origin + '/qa-seed');
  const initialBundle = await page.evaluate(async labels => {
    const c = await import('/core.js'), db = await import('/db.js'), meta = c.newMeta();
    const key = await c.derive('fictional-store-discovery-qa-only', meta), bundle = c.emptyBundle(meta.vaultId);
    const store = name => ({ name, city: '虛構市', district: '虛構區', channel: '獨立', attr: '', contact: '', address: '虛構路 123 號', everyTimeMust: '' });
    let empty = c.addReminderTasks({ ...store(labels.emptyName), everyTimeMust: labels.everyReminder, nextRemember: labels.legacyReminder }, `${labels.pendingTask}\n${labels.completedTask}`);
    empty = c.completeReminderTask(empty, empty.nextRememberTasks[1].id);
    bundle.ops.push(c.revision('store', 'qa-empty', empty, [], 'qa'));
    bundle.ops.push(c.revision('store', 'qa-history', store('虛構歷史藥局'), [], 'qa'));
    bundle.ops.push(c.revision('store', 'qa-pending', { ...store('虛構待確認藥局'), csvIdentityPending: true }, [], 'qa'));
    const conflict = c.revision('store', 'qa-conflict', store('虛構衝突藥局'), [], 'qa');
    bundle.ops.push(conflict, c.revision('store', conflict.entity, { ...conflict.data, contact: '虛構手機版本' }, [conflict.id], 'phone'), c.revision('store', conflict.entity, { ...conflict.data, contact: '虛構桌面版本' }, [conflict.id], 'mac'));
    const deleted = c.revision('store', 'qa-deleted', store('虛構已刪除藥局'), [], 'qa');
    bundle.ops.push(deleted, c.revision('store', deleted.entity, deleted.data, [deleted.id], 'qa', true));
    const visit = (text, date) => ({ store: 'qa-history', date, source: '虛構來源', text, next: '', topics: [], people: [], attachments: [] });
    for (const [id, text, date] of [['qa-history-1', 'DISCOVERY_SHARED 虛構歷史第一筆原文。', '2026-10-01'], ['qa-history-2', 'DISCOVERY_SHARED 虛構歷史第二筆原文。', '2026-09-30'], ['qa-history-3', '虛構歷史第三筆原文，搜尋命中其他筆後仍可展開。', '2026-09-29']]) bundle.ops.push(c.revision('visit', id, visit(text, date), [], 'qa'));
    const bytes = new TextEncoder().encode('name,note\r\nFictional,immutable source\r\n'), blob = await c.hashBytes(bytes);
    bundle.blobs[blob] = c.b64(bytes);
    bundle.ops.push(c.revision('source', 'qa-source', { file: 'fictional-discovery.csv', list: 'Fictional', blob, batch: 'qa', rows: 1, headers: ['name', 'note'], encoding: 'utf-8', delimiter: ',' }, [], 'qa'));
    c.validateBundle(bundle);
    await db.writeLocal(await c.seal({ schema: 1, device: 'qa-device', deviceName: 'Fictional Store Discovery QA', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, lastHealthAudit: new Date().toISOString() }, key, meta, 'device'), 0, key);
    return bundle;
  }, { emptyName, pendingTask, completedTask, everyReminder, legacyReminder });
  await page.goto(origin + '/');
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.locator('#visits-view').waitFor({ state: 'visible' });
  return { context, page, width, errors, external, apiRequests, initialBundle };
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
    return { revision: slot.revision, envelope: slot.envelope, payload: await c.unseal(slot.envelope, slot.unlockKey, 'device') };
  });
}
async function stored(page, predicate) {
  for (let i = 0; i < 70; i++) { const value = await snapshot(page); if (predicate(value)) return value; await page.waitForTimeout(100); }
  throw new Error('Timed out waiting for encrypted fictional draft/commit');
}
async function query(page, text) { await page.locator('#visit-search').fill(text); await page.waitForTimeout(220); }
async function closeReview(page) { await page.locator('#review [data-close="review"]').click(); await page.locator('#review').waitFor({ state: 'hidden' }); }
async function closeEditor(page) { await page.locator('#editor [data-close="editor"]').first().click(); await page.locator('#editor').waitFor({ state: 'hidden' }); }
async function geometry(page, width, name) {
  const result = await page.evaluate(() => {
    const openDialog = document.querySelector('dialog[open]'), target = openDialog?.querySelector('#review-body, #editor-fields') || document.querySelector('#visit-list');
    const rect = openDialog?.getBoundingClientRect();
    return { pageWidth: document.documentElement.scrollWidth, targetWidth: target.clientWidth, targetScrollWidth: target.scrollWidth, dialogLeft: rect?.left ?? null, dialogRight: rect?.right ?? null };
  });
  assert.ok(result.pageWidth <= width + 1, `${name}: page must not overflow horizontally: ${JSON.stringify(result)}`);
  assert.ok(result.targetScrollWidth <= result.targetWidth + 1, `${name}: visible content must not overflow horizontally: ${JSON.stringify(result)}`);
  if (result.dialogLeft !== null) assert.ok(result.dialogLeft >= -1 && result.dialogRight <= width + 1, `${name}: dialog must fit viewport`);
  await page.screenshot({ path: path.join(outputDir, `${name}-${width}.png`) });
  return result;
}
function assertIsolation(t) {
  assert.deepEqual(t.errors, [], 'No browser runtime errors');
  assert.deepEqual(t.external, [], 'No requests to an external origin');
  assert.equal(t.apiRequests.some(request => !['GET', 'HEAD'].includes(request.method)), false, 'No request may attempt a server mutation');
}

async function readOnlyAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    const before = await snapshot(page), geometries = [];
    const empty = page.locator('#visit-list [data-visit-empty-store="qa-empty"]');
    assert.equal(await empty.count(), 1, 'Default visit list includes a store with reminders and zero visits');
    assert.equal(await page.locator('#visit-list [data-visit-empty-store="qa-history"]').count(), 0, 'Existing visit store must not get an empty duplicate');
    const order = await page.locator('#visit-list > *').evaluateAll(cards => cards.map(card => card.hasAttribute('data-visit-empty-store')));
    const firstEmpty = order.indexOf(true);
    assert.ok(firstEmpty >= 3 && order.slice(firstEmpty).every(Boolean), 'Zero-visit stores append after all existing visit cards');
    assert.equal(await page.locator('#visit-list [data-visit-empty-store="qa-deleted"]').count(), 0, 'Deleted stores stay out of discovery');
    assert.equal((await page.locator('#visit-list').innerText()).includes('虛構已刪除藥局'), false);
    await empty.scrollIntoViewIfNeeded();
    geometries.push(await geometry(page, width, 'default-store-discovery'));

    await query(page, '  alpha  ');
    assert.equal(await empty.count(), 1, 'Case-insensitive, trimmed store name search finds a zero-visit store');
    assert.equal(await page.locator('#visit-list [data-visit-empty-store]').count(), 1);
    for (const reminder of [pendingTask, everyReminder, legacyReminder]) assert.ok((await empty.innerText()).includes(reminder), `Discovery card shows ${reminder}`);
    assert.equal((await empty.innerText()).includes(completedTask), false, 'Completed tasks do not reappear among visit-list reminders');
    assert.equal(await empty.locator('[data-inline-edit-text]').count(), 0, 'An empty store cannot contain a fake visit editor');
    geometries.push(await geometry(page, width, 'search-zero-visit-store'));
    await empty.locator('[data-visit-brief="qa-empty"]').first().click();
    await page.locator('#review').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#review').getAttribute('data-single-store-id'), 'qa-empty');
    assert.ok((await page.locator('#review-title').innerText()).includes(emptyName));
    for (const reminder of [pendingTask, everyReminder, legacyReminder]) assert.ok((await page.locator('#review-body').innerText()).includes(reminder));
    assert.match(await page.locator('.brief-history > summary').innerText(), /全部 0 筆/);
    assert.equal(await page.locator('#review [data-brief-visit]').count(), 0);
    assert.match(await page.locator('#review .visit-brief-head').innerText(), /0 筆正式拜訪紀錄/);
    geometries.push(await geometry(page, width, 'single-store-zero-history'));
    await page.locator('#review [data-start-single-store-capture]').click();
    await page.locator('#single-store-capture-form').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#review').getAttribute('data-single-store-id'), 'qa-empty');
    assert.match(await page.locator('#single-store-capture-form').innerText(), /門市已固定/);
    assert.equal(await page.locator('#single-store-capture-form #f-store').count(), 0);
    assert.deepEqual(await snapshot(page), before, 'Opening the bound capture form is byte-for-byte read-only');
    geometries.push(await geometry(page, width, 'bound-first-visit-form'));
    await page.locator('#review [data-collapse-single-store-capture]').click();
    await closeReview(page);
    assert.deepEqual(await snapshot(page), before, 'Collapsing and closing an untouched form cannot create a draft or formal visit');
    await empty.locator('[data-new-visit-store="qa-empty"]').click();
    await page.locator('#single-store-capture-form').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#review').getAttribute('data-single-store-id'), 'qa-empty');
    await closeReview(page);

    await query(page, 'DISCOVERY_SHARED');
    const group = page.locator('#visit-list .visit-search-group');
    assert.equal(await group.count(), 1, 'Existing same-store search results remain grouped');
    assert.match(await group.locator('.visit-search-group-head').innerText(), /2 筆命中 · 共 3 筆/);
    await group.locator('.visit-search-details > summary').click();
    assert.equal(await group.locator('.visit-search-expanded [data-inline-edit-text]').count(), 3, 'Expanding a match group retains all visits, including unmatched originals');
    assert.ok((await group.innerText()).includes('虛構歷史第三筆原文'));
    assert.equal(await page.locator('#visit-list [data-visit-empty-store]').count(), 0, 'Unrelated zero-visit stores do not dilute visit-text search');
    geometries.push(await geometry(page, width, 'existing-visit-search-group'));

    await query(page, '虛構待確認藥局');
    const pending = page.locator('#visit-list [data-visit-empty-store="qa-pending"]');
    assert.equal(await pending.count(), 1);
    assert.equal(await pending.locator('[data-visit-brief]').count(), 0, 'Pending identity must not offer a single-store brief');
    assert.equal(await pending.locator('[data-new-visit-store="qa-pending"]').count(), 1);
    await pending.locator('[data-new-visit-store="qa-pending"]').click();
    await page.locator('#editor').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#f-store').inputValue(), 'qa-pending', 'Pending store goes to the existing full visit form with correct store bound');
    assert.equal(await page.locator('#review').isVisible(), false);
    await closeEditor(page);
    const identityAction = pending.locator('[data-edit="store:qa-pending"]');
    assert.equal(await identityAction.count(), 1, 'Pending store offers identity review');
    await identityAction.click();
    await page.locator('#f-identity-reviewed').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#f-identity-reviewed').isChecked(), false);
    await closeEditor(page);

    await query(page, '虛構衝突藥局');
    const conflict = page.locator('#visit-list [data-visit-empty-store="qa-conflict"]');
    assert.equal(await conflict.count(), 1);
    assert.equal(await conflict.locator('[data-visit-brief], [data-new-visit-store], [data-store-reminder], [data-reminder-complete]').count(), 0, 'Conflicted store cannot offer unsafe visit or reminder actions');
    await conflict.locator('[data-review="store:qa-conflict"]').first().click();
    await page.locator('#review').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#review-title').innerText(), '比較衝突版本');
    assert.match(await page.locator('#review-body').innerText(), /2 個版本待核對/);
    await closeReview(page);
    await query(page, '虛構已刪除藥局');
    assert.equal(await page.locator('#visit-list [data-visit-empty-store]').count(), 0);
    await query(page, '完全沒有對應的虛構門市');
    assert.match(await page.locator('#visit-list').innerText(), /沒有符合/);

    const after = await snapshot(page);
    assert.deepEqual(after, before, 'All search, review, safety and untouched-cancel scenarios preserve encrypted device bytes');
    assert.deepEqual(after.payload.bundle, t.initialBundle);
    assertIsolation(t);
    report.scenarios.push({ name: 'readonly-store-discovery', width, height: width === 393 ? 852 : 900, geometries, bundleSha256Before: digest(before.payload.bundle), bundleSha256After: digest(after.payload.bundle), encryptedSlotUnchanged: true, apiRequests: t.apiRequests, runtimeErrors: t.errors, checks: ['default-append-after-existing-visits', 'zero-visit-name-search', 'pending-and-fixed-reminders-visible', 'completed-reminders-hidden-on-list', 'single-store-zero-history', 'untouched-bound-form-cancel-zero-write', 'direct-add-bound-to-store', 'existing-group-all-three-originals', 'pending-identity-safe-entry', 'conflict-review-only', 'deleted-store-excluded', 'unmatched-empty-state', 'no-horizontal-overflow'] });
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, `failure-readonly-${width}.png`) }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

async function firstVisitAcceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    await query(page, emptyName);
    await page.locator('#visit-list [data-visit-empty-store="qa-empty"] [data-new-visit-store="qa-empty"]').click();
    await page.locator('#single-store-capture-form').waitFor({ state: 'visible' });
    const text = '虛構第一筆拜訪：已交付產品資訊小卡，待對方閱讀後聯絡。';
    await page.locator('#single-store-text').fill(text);
    await stored(page, value => value.payload.draft?.fields?.text === text);
    assert.deepEqual((await snapshot(page)).payload.bundle, t.initialBundle, 'Typing creates only an encrypted draft');
    await page.locator('button[form="single-store-capture-form"]').click();
    await page.locator('#visit-attendance-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#visit-attendance-check').isChecked(), false);
    assert.deepEqual((await snapshot(page)).payload.bundle, t.initialBundle, 'Attendance prompt does not commit the first visit');
    await page.locator('#visit-attendance-cancel').click();
    await page.locator('#visit-attendance-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#single-store-text').inputValue(), text, 'Canceling final confirmation preserves the draft');
    assert.deepEqual((await snapshot(page)).payload.bundle, t.initialBundle);
    await page.locator('button[form="single-store-capture-form"]').click();
    await page.locator('#visit-attendance-dialog').waitFor({ state: 'visible' });
    await page.locator('#visit-attendance-confirm').click();
    const saved = await stored(page, value => value.payload.bundle.ops.length === t.initialBundle.ops.length + 1 && !value.payload.draft);
    const added = saved.payload.bundle.ops.at(-1);
    assert.equal(added.type, 'visit'); assert.equal(added.data.store, 'qa-empty'); assert.equal(added.data.text, text);
    assert.equal(added.deleted, false);
    for (const op of t.initialBundle.ops) assert.deepEqual(saved.payload.bundle.ops.find(value => value.id === op.id), op, 'Original store, visit, source and history revisions remain unchanged');
    assert.deepEqual(saved.payload.bundle.blobs, t.initialBundle.blobs);
    assert.match(await page.locator('.brief-history > summary').innerText(), /全部 1 筆/);
    assert.equal(await page.locator('#review [data-brief-visit]').count(), 1);
    await closeReview(page);
    await query(page, emptyName);
    assert.equal(await page.locator('#visit-list [data-visit-empty-store="qa-empty"]').count(), 0, 'After first save, name search must not show a duplicate empty-store card');
    assert.equal(await page.locator(`#visit-list [data-inline-edit-text="${added.entity}"]`).count(), 1);
    await query(page, '');
    assert.equal(await page.locator('#visit-list [data-visit-empty-store="qa-empty"]').count(), 0, 'Default list must also remove the zero-visit card');
    assert.equal(await page.locator(`#visit-list [data-inline-edit-text="${added.entity}"]`).count(), 1);
    const g = await geometry(page, width, 'first-visit-saved-no-duplicate');
    await page.reload(); await page.locator('#workspace').waitFor({ state: 'visible' });
    await query(page, emptyName);
    assert.equal(await page.locator('#visit-list [data-visit-empty-store="qa-empty"]').count(), 0);
    assert.equal(await page.locator(`#visit-list [data-inline-edit-text="${added.entity}"]`).count(), 1);
    assert.deepEqual((await snapshot(page)).payload.bundle, saved.payload.bundle);
    assertIsolation(t);
    report.scenarios.push({ name: 'first-visit-save-replaces-empty-card', width, height: width === 393 ? 852 : 900, geometry: g, addedFormalRevisions: 1, originalRevisionsUnchanged: true, sourceBlobsUnchanged: true, apiRequests: t.apiRequests, runtimeErrors: t.errors, checks: ['typing-draft-only', 'final-confirmation-cancel-preserves-draft', 'explicit-confirm-creates-one-visit', 'new-visit-bound-to-discovered-store', 'single-store-history-one', 'search-no-empty-duplicate', 'default-no-empty-duplicate', 'reload-persists-one-visit'] });
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, `failure-first-save-${width}.png`) }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

try {
  for (const width of [393, 1280]) { await readOnlyAcceptance(width); await firstVisitAcceptance(width); }
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.message; throw error; }
finally {
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, engine, passed: report.passed, scenarios: report.scenarios.length, fictionalOnly: true, connectedAppService: false }));
  await browser.close();
}
