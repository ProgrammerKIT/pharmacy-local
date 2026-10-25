// Full-App acceptance for new-stores-only CSV import, using fictional data.
// Uses a new nonpersistent browser context and an intercepted virtual origin.
// All API/external requests are blocked; never connects to a production App.
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
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-csv-exclusions-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18459';
const filename = 'fictional' + 'LongSourceLabel'.repeat(11) + '.csv';
const mapUrl = id => 'https://www.google.com/maps/search/?api=1&query=fictional&query_place_id=' + id;
const existingMap = mapUrl('QA_ONLY_EXISTING_PLACE');
const headers = ['名稱', '備註', '地址', '縣市', '地區', '拜訪窗口', '網址', '其他補充'];
const newText = '虛構新甲第一行\n<img src=x onerror="window.qaInjected=true"> & 原文字元保留。';
const newRow = ['虛構新增甲店', newText, '虛構新街 11 號', '虛構市', '新甲區', '虛構新甲窗口', mapUrl('QA_ONLY_NEW_A')];
const rows = [
  ['虛構既有藥局', 'CSV 新文字不得覆蓋人工筆記', '虛構舊路 1 號', 'CSV 欲補的縣市', 'CSV 不同地區', 'CSV 新窗口', existingMap],
  newRow,
  ['虛構新增乙店', '未勾選的新乙資料仍留原檔。', '虛構新街 22 號', '虛構市', '新乙區', '虛構新乙窗口', mapUrl('QA_ONLY_NEW_B')],
  ['虛構同名藥局', '同名但不同地址與地點識別，不可自動當成同店或新店。', '虛構歧義路 77 號', '虛構市', '疑慮區', '待核對窗口', mapUrl('QA_ONLY_UNCERTAIN_PLACE')],
  [...newRow],
  ['虛構單純未選丙店', '不勾並不代表記住排除', '虛構丙路 55 號', '虛構市', '丙區', '丙窗口', mapUrl('QA_ONLY_NEW_C')]
];
for (const [index, row] of rows.entries()) row.push([1, 4].includes(index) ? '<虛構補充 & 來源>' : '');
const cell = value => '"' + String(value).replaceAll('"', '""') + '"';
const csvBytes = Buffer.from([headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n', 'utf8');
const csvHash = createHash('sha256').update(csvBytes).digest('hex');
const report = {
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  nodeVersion: process.version, engine, browserVersion: browser.version(),
  fictionalOnly: true, connectedAppService: false, persistentBrowserProfile: false,
  realIPhone: false, viewportSimulationOnly: true, fixtureSha256: csvHash, scenarios: []
};

async function isolated(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 393 ? 852 : 900 }, serviceWorkers: 'block', timezoneId: 'Asia/Taipei' });
  const page = await context.newPage(), errors = [], external = [], apiRequests = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (url.pathname === '/qa-seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fictional new-stores-only acceptance</title>' });
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push({ path: url.pathname, method: route.request().method() });
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Fictional isolated QA: every API blocked"}' });
    }
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ contentType, body: fs.readFileSync(file) });
  });
  await page.goto(origin + '/qa-seed');
  const initialBundle = await page.evaluate(async existingMap => {
    const c = await import('/core.js'), db = await import('/db.js'), meta = c.newMeta();
    const key = await c.derive('fictional-new-stores-password-only', meta), bundle = c.emptyBundle(meta.vaultId);
    const firstStore = c.revision('store', 'qa-existing', { name: '虛構既有藥局', address: '虛構舊路 1 號', mapUrl: existingMap, city: '', district: '原有地區', channel: '', attr: '', contact: '原始窗口', everyTimeMust: '原有固定提醒', nextRemember: '原有待辦不可變更' }, [], 'fictional-qa');
    const latestStore = c.revision('store', firstStore.entity, { ...firstStore.data, contact: '人工更新後的窗口' }, [firstStore.id], 'fictional-qa');
    const firstNote = c.revision('visit', 'qa-existing-note', { store: firstStore.entity, date: '2026-10-01', source: '虛構人工來源', text: '舊原文：自行建立，不應被 CSV 覆蓋。', next: '虛構跟進事項', people: [], topics: [], attachments: [] }, [], 'fictional-qa');
    const latestNote = c.revision('visit', firstNote.entity, { ...firstNote.data, text: 'App 人工修改後的最新筆記\n第二行與原有跟進事項完整保留。' }, [firstNote.id], 'fictional-qa');
    const otherStore = c.revision('store', 'qa-other-existing', { name: '虛構同名藥局', address: '虛構另一舊路 33 號', mapUrl: 'https://www.google.com/maps/search/?api=1&query=fictional&query_place_id=QA_ONLY_OTHER_EXISTING', city: '虛構市', district: '另一原有地區', channel: '', attr: '', contact: '另一原有窗口', everyTimeMust: '' }, [], 'fictional-qa');
    bundle.ops.push(firstStore, latestStore, firstNote, latestNote, otherStore); c.validateBundle(bundle);
    await db.writeLocal(await c.seal({ schema: 1, device: 'fictional-new-stores-device', deviceName: '虛構新店匯入驗收', token: null, bundle, dirty: false, serverVersion: 17, lastSync: '2026-10-01T00:00:00.000Z', lastHealthAudit: new Date().toISOString(), pendingSync: { entities: [], unknown: false }, qaOnly: 'fictional-new-stores' }, key, meta, 'device'), 0, key);
    return bundle;
  }, existingMap);
  await page.goto(origin + '/'); await page.locator('#workspace').waitFor({ state: 'visible' });
  return { context, page, width, initialBundle, errors, external, apiRequests };
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
    const payload = await c.unseal(slot.envelope, slot.unlockKey, 'device');
    if (payload.qaOnly !== 'fictional-new-stores') throw new Error('Not this fictional fixture');
    return { revision: slot.revision, envelope: slot.envelope, payload, records: c.project(payload.bundle) };
  });
}
async function openCSV(page) {
  await page.locator('.rail [data-view="sync"]').click();
  await page.locator('#sync-view [data-view="csv"]').click();
  await page.locator('#csv-view').waitFor({ state: 'visible' });
}
async function previewCSV(page) {
  assert.equal(await page.locator('#csv-import-mode').inputValue(), 'new-only', 'New stores only is the default mode');
  assert.equal(await page.locator('#csv-review-choose').isDisabled(), true, 'Reviewed merge packages are unavailable in new-only mode');
  await page.locator('#csv-files').setInputFiles({ name: filename, mimeType: 'text/csv', buffer: csvBytes });
  await page.locator('#csv-preview-button').waitFor(); await page.locator('#csv-preview-button').click();
  await page.locator('#csv-filter').waitFor();
  assert.equal(await page.locator('#csv-filter').inputValue(), 'new', 'Only candidate new stores occupy the initial preview');
}
const row = (page, key) => page.locator(`[data-csv-row="${key}"]`);
async function classification(page, repeated) {
  await page.locator('#csv-filter').selectOption('all');
  const expected = repeated ? ['existing', 'existing', 'new', 'review', 'existing'] : ['existing', 'new', 'new', 'review', 'duplicate'];
  for (const [index, status] of expected.entries()) assert.equal(await row(page, '0:' + index).getAttribute('data-csv-new-status'), status, 'Classification of row ' + index);
  assert.equal(await page.locator('[data-csv-choice]').count(), 0, 'New-only mode cannot select an existing or batch target');
  assert.equal(await page.locator('[data-csv-fill]').count(), 0, 'New-only mode cannot fill an existing profile');
  for (const index of repeated ? [0, 1, 3, 4] : [0, 3, 4]) assert.equal(await row(page, '0:' + index).locator('[data-csv-include]').count(), 0, 'Non-new row has no import checkbox');
  for (const index of repeated ? [2] : [1, 2]) assert.equal(await page.locator(`[data-csv-include="0:${index}"]`).isChecked(), false, 'Candidate new stores are opt-in');
  assert.equal(await page.locator('#csv-commit').isEnabled(), true, 'Unselected or unresolved rows do not block other eligible new stores');
  await page.locator('#csv-filter').selectOption('new');
  return expected;
}
async function confirmImport(page, accept) {
  await page.locator('#csv-commit').click();
  const dialog = page.locator('#csv-final-review'); await dialog.waitFor({ state: 'visible' });
  const message = await dialog.innerText();
  assert.match(message, /完整原始 CSV/);
  assert.match(message, /既有門市、文字、關係及歷史更新：0/);
  await page.locator(accept ? '#csv-final-apply' : '#csv-final-back').click();
  if (accept) await page.waitForFunction(() => document.querySelector('#csv-result')?.textContent.startsWith('完成：'));
  else await dialog.waitFor({ state: 'hidden' });
  return message;
}
function metadataAndHistory(before, after) {
  for (const key of ['device', 'deviceName', 'token', 'serverVersion', 'lastSync']) assert.deepEqual(after.payload[key], before.payload[key], 'Preserve ' + key);
  for (const key of ['format', 'vaultId', 'salt', 'iterations']) assert.deepEqual(after.envelope[key], before.envelope[key], 'Preserve encryption ' + key);
  for (const op of before.payload.bundle.ops) assert.deepEqual(after.payload.bundle.ops.find(item => item.id === op.id), op, 'Preserve every historical revision exactly');
}
function verifyImported(initial, value, snapshots) {
  const stores = value.records.filter(item => item.type === 'store'), visits = value.records.filter(item => item.type === 'visit'), sources = value.records.filter(item => item.type === 'source');
  const initialStores = initial.records.filter(item => item.type === 'store'), initialVisits = initial.records.filter(item => item.type === 'visit');
  assert.equal(stores.length, initialStores.length + 1, 'Only one expressly selected new store is created');
  assert.equal(visits.length, initialVisits.length + 1, 'Only the selected new store receives one new note');
  for (const original of initial.records) assert.deepEqual(value.records.find(item => item.type === original.type && item.id === original.id), original, 'All existing records and their histories stay identical');
  const addedStore = stores.find(item => !initialStores.some(prior => prior.id === item.id)), addedVisit = visits.find(item => !initialVisits.some(prior => prior.id === item.id));
  assert.equal(addedStore.name, newRow[0]); assert.equal(addedStore.address, newRow[2]);
  assert.equal(addedVisit.store, addedStore.id); assert.equal(addedVisit.text, newText);
  assert.equal(sources.length, snapshots);
  for (const source of sources) { assert.equal(source.blob, csvHash); assert.deepEqual(source.headers, headers); assert.equal(source.rows, rows.length); }
  assert.equal(value.payload.bundle.blobs[csvHash], csvBytes.toString('base64'), 'Source Snapshot preserves all rows and literal bytes, including existing, unselected, uncertain and duplicate rows');
  metadataAndHistory(initial, value);
  return { stores, visits, sources, addedStore, addedVisit };
}
async function geometry(page, width, name, selector = '#csv-view') {
  const value = await page.locator(selector).evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { pageWidth: document.documentElement.scrollWidth, left: rect.left, right: rect.right, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
  });
  assert.ok(value.pageWidth <= width + 1, name + ': page does not overflow');
  assert.ok(value.scrollWidth <= value.clientWidth + 1, name + ': contents do not overflow');
  assert.ok(value.left >= -1 && value.right <= width + 1, name + ': panel fits viewport');
  await page.screenshot({ path: path.join(outputDir, `${name}-${width}.png`), fullPage: selector === '#csv-view' });
  if (selector === '#csv-final-review') {
    await page.locator('#csv-final-apply').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outputDir, `${name}-actions-${width}.png`), fullPage: false });
    await page.locator(selector).evaluate(node => node.scrollTop = 0);
  }
  return value;
}

async function acceptance(width) {
  const t = await isolated(width), { page } = t;
  try {
    const initial = await snapshot(page), nativeDialogs = [];
    page.on('dialog', async dialog => { nativeDialogs.push(dialog.message()); await dialog.dismiss(); });
    await openCSV(page); await previewCSV(page);
    assert.equal(await page.locator('[data-csv-exclude="0:2"]').isChecked(), false);
    await page.locator('[data-csv-include="0:1"]').check();
    await page.locator('[data-csv-supplement="0:1"][value="7"]').check();
    await page.locator('[data-csv-ack="extraAccepted"][data-row="0:1"]').check();
    await page.locator('[data-csv-exclude="0:2"]').check();
    assert.equal(await page.locator('[data-csv-include="0:2"]').isChecked(), false, 'Remember exclude and import are mutually exclusive');
    assert.equal(await page.locator('[data-csv-include="0:5"]').isChecked(), false, 'Simply unchecked remains distinct from remembered exclusion');
    const previewGeometry = await geometry(page, width, 'exclusion-selection');
    await page.locator('#csv-commit').click(); await page.locator('#csv-final-review').waitFor({state:'visible'});
    assert.equal(await page.locator('[aria-label="這次新增的門市"] [data-csv-final-row]').count(), 1);
    assert.equal(await page.locator('[aria-label="這次記住排除"] [data-csv-final-row]').count(), 1);
    const addedText = await page.locator('[aria-label="這次新增的門市"]').innerText();
    assert.ok(addedText.includes(newRow[0]) && addedText.includes(newRow[2]) && addedText.includes(filename));
    assert.match(addedText, /第 3 行/); assert.match(addedText, /備註 1 筆/); assert.match(addedText, /補充 1 項/);
    const finalGeometry = await geometry(page, width, 'per-store-final-confirmation', '#csv-final-review');
    assert.deepEqual(await snapshot(page), initial, 'Last review is read-only');
    await page.locator('#csv-final-edit').click();
    assert.deepEqual(await snapshot(page), initial, 'Return to edit is read-only');
    await page.locator('#csv-commit').click(); await page.locator('#csv-final-review').waitFor({state:'visible'});
    await page.keyboard.press('Escape');
    assert.deepEqual(await snapshot(page), initial, 'ESC is read-only');
    await confirmImport(page, true);
    const first = await snapshot(page), imported = verifyImported(initial, first, 1);
    assert.equal(imported.addedStore.csvSources[0].supplements[0].text, '<虛構補充 & 來源>');
    const exclusions = await page.evaluate(async () => {
      const c=await import('/core.js'),db=await import('/db.js'),csv=await import('/csv.js'),slot=await db.readLocal();
      return csv.csvExclusionList((await c.unseal(slot.envelope,slot.unlockKey,'device')).bundle);
    });
    assert.equal(exclusions.length, 1); assert.equal(exclusions[0].name, rows[2][0]);
    assert.equal(await page.evaluate(() => window.qaInjected === true), false);
    await page.reload(); await page.locator('#workspace').waitFor({state:'visible'});
    assert.deepEqual(await snapshot(page), first, 'Exclusion and imported new store survive encrypted reload');
    await openCSV(page); await previewCSV(page);
    assert.equal(await row(page,'0:2').count(),0,'Remembered place hidden by default');
    assert.equal(await row(page,'0:5').count(),1,'Simply unchecked place stays a candidate next time');
    assert.match(await page.locator('.csv-summary').innerText(),/已記住排除 1 列/);
    await page.locator('#csv-filter').selectOption('remembered');
    assert.equal(await row(page,'0:2').getAttribute('data-csv-new-status'),'remembered');
    assert.equal(await row(page,'0:2').locator('[data-csv-include]').count(),0);
    await page.locator('#csv-exclusion-manager > summary').click();
    const managerGeometry = await geometry(page,width,'exclusion-management');
    await page.locator('[data-csv-revoke]').check();
    await page.locator('#csv-commit').click(); await page.locator('#csv-final-review').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-csv-final-revoke]').count(),1);
    assert.match(await page.locator('#csv-final-review').innerText(),/新增 0 間門市/);
    const revokeGeometry = await geometry(page,width,'revoke-final-confirmation','#csv-final-review');
    await page.locator('#csv-final-back').click(); await page.locator('#csv-cancel').click();
    assert.deepEqual(await snapshot(page),first,'Cancelling pending revocation does not remove saved exclusion');
    await previewCSV(page); await page.locator('#csv-exclusion-manager > summary').click();
    assert.equal(await page.locator('[data-csv-revoke]').isChecked(),false,'Cancel clears pending revocation');
    await page.locator('[data-csv-revoke]').check(); await confirmImport(page,true);
    const revoked = await snapshot(page); metadataAndHistory(first,revoked);
    for(const prior of first.records.filter(r=>r.type!=='source')) assert.deepEqual(revoked.records.find(r=>r.id===prior.id),prior,'Revocation does not modify stores or notes');
    assert.equal(await page.evaluate(async()=>{const c=await import('/core.js'),db=await import('/db.js'),csv=await import('/csv.js'),slot=await db.readLocal();return csv.csvExclusionList((await c.unseal(slot.envelope,slot.unlockKey,'device')).bundle).length;}),0);
    await page.reload(); await page.locator('#workspace').waitFor({state:'visible'}); await openCSV(page); await previewCSV(page);
    assert.equal(await page.locator('[data-csv-include="0:2"]').isChecked(),false,'Revoked place returns unselected after a fresh comparison');
    assert.equal(await page.locator('[data-csv-exclude="0:2"]').isChecked(),false);
    await confirmImport(page,true);
    const none = await snapshot(page); metadataAndHistory(revoked,none);
    for(const prior of revoked.records.filter(r=>r.type!=='source')) assert.deepEqual(none.records.find(r=>r.id===prior.id),prior,'No selected rows only save raw source');
    assert.equal(await page.evaluate(async()=>{const c=await import('/core.js'),db=await import('/db.js'),csv=await import('/csv.js'),slot=await db.readLocal();return csv.csvExclusionList((await c.unseal(slot.envelope,slot.unlockKey,'device')).bundle).length;}),0,'Unchecked cannot silently remember exclusions');
    assert.equal(nativeDialogs.length,0,'No native count-only confirm used');
    assert.deepEqual(t.external,[]); assert.deepEqual(t.apiRequests,[]); assert.deepEqual(t.errors,[]);
    const result = {width,passed:true,flows:['explicit-remember-mutually-exclusive','per-store-final-details-and-supplement-counts','return-and-escape-read-only','old-records-and-history-identical','encrypted-reload','remembered-hidden-discoverable','unselected-not-remembered','cancel-revocation','revoke-without-import','revoked-candidate-unselected','all-unchecked-source-only'],geometry:[previewGeometry,finalGeometry,managerGeometry,revokeGeometry],nativeDialogs:0,externalRequests:0,apiRequests:0,pageErrors:[]};
    report.scenarios.push(result); return result;
  } finally { await t.context.close(); }
}

async function finalReviewSafety(width) {
  const t=await isolated(width),{page}=t;
  try {
    const initial=await snapshot(page); await openCSV(page);
    const batch=Buffer.from([headers,...Array.from({length:41},(_,i)=>['虛構分頁門市'+i,'虛構原文'+i,'虛構路'+i+'號','虛構市','測試區','虛構窗口',mapUrl('QA_PAGED_'+i),''])].map(row=>row.map(cell).join(',')).join('\n'));
    await page.locator('#csv-files').setInputFiles({name:'fictional-many-pages.csv',mimeType:'text/csv',buffer:batch});
    await page.locator('#csv-preview-button').click(); await page.locator('[data-csv-include="0:0"]').check();
    await page.locator('#csv-next').click(); await page.locator('[data-csv-include="0:40"]').check();
    await page.locator('#csv-commit').click(); await page.locator('#csv-final-review').waitFor({state:'visible'});
    assert.equal(await page.locator('[aria-label="這次新增的門市"] [data-csv-final-row]').count(),2,'Every selection across preview pages is in the final list');
    assert.match(await page.locator('#csv-final-review').innerText(),/虛構分頁門市0/);
    assert.match(await page.locator('#csv-final-review').innerText(),/虛構分頁門市40/);
    const finalGeometry=await geometry(page,width,'cross-page-final-confirmation','#csv-final-review');
    await page.evaluate(()=>{const input=document.querySelector('[data-csv-list]');input.value='改變來源清單';input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#csv-final-apply').click();});
    await page.waitForFunction(()=>document.querySelector('#csv-error').textContent.includes('核對期間'));
    assert.deepEqual(await snapshot(page),initial,'Changing mapping/list invalidates a pending final confirmation');
    await page.locator('#csv-preview-button').click(); await page.locator('[data-csv-include="0:0"]').check();
    await page.locator('#csv-commit').click(); await page.locator('#csv-final-review').waitFor({state:'visible'});
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));document.querySelector('#csv-final-apply')?.click();});
    await page.waitForFunction(()=>!document.querySelector('#csv-final-review').open);
    assert.deepEqual(await snapshot(page),initial,'Synthetic background/lock invalidates final apply without writes');
    assert.deepEqual(t.external,[]); assert.deepEqual(t.apiRequests,[]); assert.deepEqual(t.errors,[]);
    report.scenarios.push({width,passed:true,flows:['multi-page-selections-all-listed','mapping-changes-invalidate-final','background-lock-blocks-stale-apply'],syntheticVisibility:true,realDeviceBackgroundTest:false,geometry:[finalGeometry],externalRequests:0,apiRequests:0,pageErrors:[]});
  } finally {await t.context.close();}
}

try {
  const widths = process.env.QA_WIDTH ? [Number(process.env.QA_WIDTH)] : [1280, 393];
  for (const width of widths) { await acceptance(width); await finalReviewSafety(width); }
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; throw error; }
finally {
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, engine, passed: report.passed, scenarios: report.scenarios.length, fictionalOnly: true, realIPhone: false }));
  await browser.close();
}
