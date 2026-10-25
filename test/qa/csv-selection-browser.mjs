// Full-App selective CSV acceptance with fictional fixtures only. The browser
// receives local files through an intercepted virtual origin; all API and
// external requests are blocked. No real App, user profile, data, or pairing.
// Reuse installed Playwright via PLAYWRIGHT_MODULE / PLAYWRIGHT_PACKAGE_JSON.
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
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.QA_BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit', 'firefox'].includes(engine));
const browser = await playwright[engine].launch({ headless: true, ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-csv-selection-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18456';
const fixtureName = 'fictional-column-selection.csv';
const headers = ['名稱', '備註', '地址', '縣市', '地區', '拜訪窗口', '補充', '補充'];
const note = '原始拜訪第一行\n第二行 & <測試>，不得被補充欄改寫。';
const manualNote = note + '\nApp 人工補上的最新內容；重傳舊 CSV 補選欄位不得回滾這行。';
const firstSupplement = '採用第七欄第一行\n第二行 <img src=x onerror="window.qaInjected=true">';
const laterSupplement = '第八欄暫不採用 & "完整保留"';
const excludedText = '排除門市原文 <script>window.qaInjected=true</script>\n仍須完整保存在 Source Snapshot。';
const rows = [
  ['虛構青禾店', note, '虛構路 1 號', '虛構市', 'CSV 不同地區', 'CSV 新窗口', firstSupplement, laterSupplement],
  ['虛構排除店', excludedText, '虛構路 99 號', '虛構市', '測試區', '排除窗口', '不納入補充甲', '不納入補充乙']
];
const csvCell = value => '"' + String(value).replaceAll('"', '""') + '"';
const csvText = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
const csvBytes = Buffer.from(csvText, 'utf8');
const csvHash = createHash('sha256').update(csvBytes).digest('hex');
const report = {
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  nodeVersion: process.version, engine, browserVersion: browser.version(),
  fictionalOnly: true, connectedAppService: false, persistentBrowserProfile: false,
  realIPhone: false, viewportSimulationOnly: true, fixtureSha256: csvHash,
  scenarios: []
};

async function isolated(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 393 ? 852 : 900 }, serviceWorkers: 'block', timezoneId: 'Asia/Taipei' });
  const page = await context.newPage(), errors = [], external = [], apiRequests = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (url.pathname === '/qa-seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fictional selective CSV acceptance</title>' });
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push({ path: url.pathname, method: route.request().method() });
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"All APIs blocked for fictional isolated acceptance"}' });
    }
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ contentType, body: fs.readFileSync(file) });
  });
  await page.goto(origin + '/qa-seed');
  const initialBundle = await page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js'), meta = c.newMeta();
    const key = await c.derive('fictional-selective-csv-password-only', meta), bundle = c.emptyBundle(meta.vaultId);
    bundle.ops.push(c.revision('store', 'qa-qinghe', { name: '虛構青禾店', address: '虛構路 1 號', city: '', district: '原有地區', channel: '', attr: '', contact: '原有窗口', everyTimeMust: '' }, [], 'fictional-qa'));
    c.validateBundle(bundle);
    const payload = { schema: 1, device: 'fictional-csv-device', deviceName: '虛構欄位勾選驗收', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, lastHealthAudit: new Date().toISOString(), pendingSync: { entities: [], unknown: false }, qaOnly: 'fictional-csv-selection' };
    await db.writeLocal(await c.seal(payload, key, meta, 'device'), 0, key);
    return bundle;
  });
  await page.goto(origin + '/');
  await page.locator('#workspace').waitFor({ state: 'visible' });
  return { context, page, width, initialBundle, errors, external, apiRequests };
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
    const payload = await c.unseal(slot.envelope, slot.unlockKey, 'device');
    if (payload.qaOnly !== 'fictional-csv-selection') throw new Error('Not the fictional acceptance fixture');
    return { revision: slot.revision, envelope: slot.envelope, payload, records: c.project(payload.bundle) };
  });
}
async function openCSV(page) {
  await page.locator('.rail [data-view="sync"]').click();
  await page.locator('#sync-view [data-view="csv"]').click();
  await page.locator('#csv-view').waitFor({ state: 'visible' });
}
async function previewCSV(page) {
  await page.locator('#csv-import-mode').selectOption('standard');
  await page.locator('#csv-files').setInputFiles({ name: fixtureName, mimeType: 'text/csv', buffer: csvBytes });
  await page.locator('#csv-preview-button').waitFor();
  await page.locator('#csv-preview-button').click();
  await page.locator('[data-csv-include="0:0"]').waitFor();
}
const include = (page, key) => page.locator(`[data-csv-include="${key}"]`);
const supplement = (page, column) => page.locator(`[data-csv-supplement="0:0"][value="${column}"]`);
const acknowledge = page => page.locator('[data-csv-ack="extraAccepted"][data-row="0:0"]');
async function confirmImport(page, accept) {
  const dialogPromise = page.waitForEvent('dialog');
  const clickPromise = page.locator('#csv-commit').click();
  const dialog = await dialogPromise, message = dialog.message();
  assert.equal(dialog.type(), 'confirm');
  assert.match(message, /Source Snapshot/);
  await (accept ? dialog.accept() : dialog.dismiss());
  await clickPromise;
  if (accept) await page.waitForFunction(() => document.querySelector('#csv-result')?.textContent.startsWith('完成：'));
  return message;
}
async function geometry(page, width, name, selector = '#csv-view') {
  const result = await page.locator(selector).evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { pageWidth: document.documentElement.scrollWidth, left: rect.left, right: rect.right, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
  });
  assert.ok(result.pageWidth <= width + 1, name + ': no horizontal page overflow');
  assert.ok(result.scrollWidth <= result.clientWidth + 1, name + ': content wraps without horizontal overflow');
  assert.ok(result.left >= -1 && result.right <= width + 1, name + ': within viewport');
  await page.screenshot({ path: path.join(outputDir, `${name}-${width}.png`), fullPage: true });
  return result;
}
function preservedMetadata(before, after) {
  for (const field of ['device', 'deviceName', 'token', 'serverVersion', 'lastSync']) assert.deepEqual(after.payload[field], before.payload[field], field + ' is unchanged');
  for (const field of ['format', 'vaultId', 'salt', 'iterations']) assert.deepEqual(after.envelope[field], before.envelope[field], field + ' is unchanged');
  for (const op of before.payload.bundle.ops) assert.deepEqual(after.payload.bundle.ops.find(item => item.id === op.id), op, 'Every original revision stays intact');
}
function importedState(value, expectedColumns, snapshots = 1, expectedNote = note) {
  const stores = value.records.filter(row => row.type === 'store' && !row.deleted), visits = value.records.filter(row => row.type === 'visit' && !row.deleted), sources = value.records.filter(row => row.type === 'source');
  assert.equal(stores.length, 1, 'Excluded row creates no store');
  assert.equal(stores[0].id, 'qa-qinghe');
  assert.equal(stores[0].city, '虛構市', 'The selected blank profile field is filled');
  assert.equal(stores[0].district, '原有地區', 'Existing district cannot be overwritten');
  assert.equal(stores[0].contact, '原有窗口', 'Existing contact cannot be overwritten');
  assert.equal(visits.length, 1, 'One source note, even after adding more supplements');
  assert.equal(visits[0].text, expectedNote, 'Supplement adoption leaves the current primary note exact');
  assert.equal(sources.length, snapshots, 'Each confirmed import records a complete Source Snapshot');
  assert.equal(value.payload.bundle.blobs[csvHash], csvBytes.toString('base64'), 'CSV bytes including excluded rows, duplicate headers, CRLF and markup remain exact');
  for (const source of sources) { assert.equal(source.blob, csvHash); assert.deepEqual(source.headers, headers); assert.equal(source.rows, 2); }
  const adopted = stores[0].csvSources.flatMap(source => source.supplements || []);
  assert.deepEqual([...new Set(adopted.map(item => item.column))].sort(), expectedColumns);
  for (const item of adopted) { assert.equal(item.header, '補充'); assert.equal(item.kind, 'supplement'); assert.equal(item.text, rows[0][item.column]); }
  assert.ok(stores[0].csvSources.every(source => JSON.stringify(source.headers) === JSON.stringify(headers) && JSON.stringify(source.cells) === JSON.stringify(rows[0])));
  return { store: stores[0], visit: visits[0], sources, adopted };
}
async function sourceModal(page, width, expectedSupplements) {
  await page.locator('.rail [data-view="stores"]').click();
  await page.locator('#stores-view .more-actions summary').first().click();
  await page.locator('#stores-view [data-csv-source="store:qa-qinghe"]').click();
  await page.locator('#review').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#review-title').innerText(), 'CSV 原始來源與已選補充');
  const visibleText = await page.locator('#review-body').innerText();
  for (const text of expectedSupplements) assert.ok(visibleText.includes(text), 'Adopted supplement is visible in the source view');
  assert.equal(await page.locator('#review-body img,#review-body script').count(), 0, 'CSV markup stays literal text');
  assert.equal(await page.evaluate(() => window.qaInjected === true), false);
  const shape = await geometry(page, width, 'adopted-source-' + expectedSupplements.length, '#review');
  await page.locator('#review [data-close="review"]').click();
  return shape;
}
async function editFictionalNote(page, visitId) {
  await page.locator('.rail [data-view="stores"]').click();
  await page.locator('#stores-view [data-visit-brief="qa-qinghe"]').click();
  await page.locator('#review').waitFor({ state: 'visible' });
  await page.locator(`#review [data-inline-edit-text="${visitId}"]`).fill(manualNote);
  await page.locator(`#review [data-inline-review="${visitId}"]`).click();
  await page.locator('#quick-text-dialog').waitFor({ state: 'visible' });
  await page.locator('#quick-text-dialog button[type="submit"]').click();
  await page.locator('#visit-attendance-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#visit-attendance-check').isChecked(), false, 'Editing fixture text must not claim a real visit');
  await page.locator('#visit-attendance-confirm').click();
  await page.locator('#quick-text-dialog').waitFor({ state: 'hidden' });
  const saved = await snapshot(page);
  assert.equal(saved.records.find(row => row.type === 'visit' && row.id === visitId).text, manualNote);
  assert.equal(saved.payload.inlineTextDraft, null);
  await page.locator('#review [data-close="review"]').click();
  return saved;
}
function isolationChecks(t) {
  assert.deepEqual(t.errors, [], 'No runtime errors');
  assert.deepEqual(t.external, [], 'No external requests attempted');
  assert.ok(t.apiRequests.every(request => ['GET', 'HEAD'].includes(request.method)), 'No API mutation attempted');
}

async function selectionAcceptance(width) {
  const t = await isolated(width), { page } = t;
  try {
    const initial = await snapshot(page);
    await openCSV(page); await previewCSV(page);
    assert.equal(await page.locator('[data-csv-choice="0:0"]').inputValue(), 'store:qa-qinghe');
    assert.equal(await supplement(page, 6).isChecked(), false);
    assert.equal(await supplement(page, 7).isChecked(), false);
    await include(page, '0:1').uncheck();
    await supplement(page, 6).check();
    await acknowledge(page).check();
    if (!await page.locator('.csv-profile-changes').first().evaluate(node => node.open)) await page.locator('.csv-profile-changes summary').first().click();
    assert.equal(await page.locator('[data-csv-fill="0:0"][value="contact"]').count(), 0);
    assert.equal(await page.locator('[data-csv-fill="0:0"][value="district"]').count(), 0);
    await page.locator('[data-csv-fill="0:0"][value="city"]').check();
    assert.equal(await page.locator('#csv-commit').isEnabled(), true);
    assert.equal(await page.evaluate(() => window.qaInjected === true), false);
    const previewGeometry = await geometry(page, width, 'selective-preview');
    assert.deepEqual(await snapshot(page), initial, 'Reading and checkbox changes do not write');
    const cancelledMessage = await confirmImport(page, false);
    assert.deepEqual(await snapshot(page), initial, 'Cancelling final confirmation writes nothing');
    const firstMessage = await confirmImport(page, true);
    const first = await snapshot(page), firstState = importedState(first, [6]);
    preservedMetadata(initial, first);
    await page.reload(); await page.locator('#workspace').waitFor({ state: 'visible' });
    assert.deepEqual(await snapshot(page), first, 'Reload retrieves the same encrypted IndexedDB data');
    const sourceGeometry = await sourceModal(page, width, [firstSupplement]);
    assert.deepEqual(await snapshot(page), first, 'Viewing original source and adopted supplement is read-only');
    const manual = await editFictionalNote(page, firstState.visit.id), manualState = importedState(manual, [6], 1, manualNote);
    preservedMetadata(first, manual);
    // Re-select a known source row but adopt no extra columns or profile fills.
    // A confirmed import must preserve its complete original file as a new
    // snapshot while leaving every current store/visit revision untouched.
    await openCSV(page); await previewCSV(page);
    await include(page, '0:0').check();
    await page.locator('[data-csv-choice="0:0"]').selectOption('store:qa-qinghe');
    await include(page, '0:1').uncheck();
    assert.equal(await supplement(page, 7).isChecked(), false);
    await acknowledge(page).check();
    assert.equal(await page.locator('#csv-commit').isEnabled(), true);
    const noColumnsGeometry = await geometry(page, width, 'known-row-no-columns');
    const noColumnsMessage = await confirmImport(page, true);
    const snapshotOnly = await snapshot(page), snapshotOnlyState = importedState(snapshotOnly, [6], 2, manualNote);
    assert.deepEqual(snapshotOnlyState.store, manualState.store, 'No selected columns means no store revision or source association change');
    assert.deepEqual(snapshotOnlyState.visit, manualState.visit, 'No selected columns cannot replay an old note over manual text');
    assert.equal(snapshotOnly.payload.bundle.ops.length, manual.payload.bundle.ops.length + 1, 'Exactly one Source Snapshot revision is appended');
    assert.equal(snapshotOnly.payload.bundle.ops.at(-1).type, 'source');
    assert.deepEqual(snapshotOnly.payload.bundle.blobs, manual.payload.bundle.blobs, 'The existing complete CSV bytes are reused unchanged');
    preservedMetadata(manual, snapshotOnly);
    await openCSV(page); await previewCSV(page);
    await include(page, '0:0').check();
    await page.locator('[data-csv-choice="0:0"]').selectOption('store:qa-qinghe');
    await include(page, '0:1').uncheck();
    assert.equal(await supplement(page, 6).count(), 0, 'Previously adopted supplement has no removal control during reimport');
    assert.ok((await page.locator('.csv-review-row').first().innerText()).includes('已納入的來源補充 · 1 欄（保留）'), 'Previously adopted supplement remains listed as retained');
    assert.equal(await supplement(page, 7).isChecked(), false, 'The previously unselected duplicate-name column remains independent');
    await supplement(page, 7).check();
    if (await acknowledge(page).isVisible()) await acknowledge(page).check();
    assert.equal(await page.locator('#csv-commit').isEnabled(), true);
    const repeatGeometry = await geometry(page, width, 'reimport-add-column');
    const secondMessage = await confirmImport(page, true);
    const second = await snapshot(page), secondState = importedState(second, [6, 7], 3, manualNote);
    assert.equal(secondState.visit.id, firstState.visit.id, 'Reimport adds source information to the same visit');
    assert.deepEqual(secondState.visit, manualState.visit, 'Reimporting an old source only adds selected supplements; the entire manual visit and history stay exact');
    preservedMetadata(snapshotOnly, second);
    await page.reload(); await page.locator('#workspace').waitFor({ state: 'visible' });
    assert.deepEqual(await snapshot(page), second, 'Additional selected column survives encrypted reload');
    const finalSourceGeometry = await sourceModal(page, width, [firstSupplement, laterSupplement]);
    assert.deepEqual(await snapshot(page), second);
    isolationChecks(t);
    report.scenarios.push({ name: 'selective-import-and-reimport', width, passed: true, cancelledConfirmationUnchanged: true, completeSourceBytesUnchanged: true, excludedRowSnapshotOnly: true, repeatedHeadersSelectedByIndex: true, supplementsDoNotOverwritePrimaryNote: true, occupiedFieldsProtected: true, onlySelectedBlankFilled: true, existingSupplementCannotBeRemoved: true, reimportDoesNotDuplicateVisit: true, manualNoteEditedThroughAppUI: true, unselectedKnownRowAddsOnlySnapshot: true, noSelectionKeepsStoreAndVisitRevisionsExact: true, reimportPreservesEntireManualVisit: true, encryptedReloadPassed: true, sourceModalPassed: true, literalHtmlPassed: true, pairingMetadataUnchanged: true, geometries: [previewGeometry, sourceGeometry, noColumnsGeometry, repeatGeometry, finalSourceGeometry], confirmationMessages: [cancelledMessage, firstMessage, noColumnsMessage, secondMessage], apiRequests: t.apiRequests, externalRequests: t.external, runtimeErrors: t.errors });
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, `failure-${width}.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally { await t.context.close(); }
}

try {
  const widths = process.env.QA_WIDTH ? [Number(process.env.QA_WIDTH)] : [1280, 393];
  for (const width of widths) await selectionAcceptance(width);
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; throw error; }
finally {
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, engine, passed: report.passed, scenarios: report.scenarios.length, fictionalOnly: true, realIPhone: false }));
  await browser.close();
}
