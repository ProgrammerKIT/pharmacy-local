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
  feature: 'supervisor-relationships',
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
    bundle.ops.push(firstStore, latestStore, firstNote, latestNote, otherStore);
    const bytes=new TextEncoder().encode('fictional chart'),blob=await c.hashBytes(bytes);
    const packet={format:'pharmacy-store-supervision-1',organization:'虛構連鎖',effectiveDate:'',sourceDocument:{blob,name:'fictional.jpg',mime:'image/jpeg',base64:c.b64(bytes)},people:[{key:'fictional-supervisor',name:'虛構督導'}],assignments:[{storeName:'虛構既有藥局',areaCode:'01',areaName:'虛構小區',personKey:'fictional-supervisor',storeCode:'123',sourceLabel:'虛構來源'}]};
    Object.assign(bundle,(await c.applyStoreSupervision(bundle,packet,await c.planStoreSupervision(bundle,packet),['qa-existing'],'fictional')).bundle);
    const boss=c.project(bundle).find(r=>r.supervisorKey);
    bundle.ops.push(c.revision('person','qa-peer',{name:'虛構店長',role:'',desc:'',confirmed:true,sameAs:''},[],'fictional'));
    for(const [id,store,text,people] of [['qa-relation-a','qa-existing','虛構督導與虛構店長一起討論培訓',[boss.id,'qa-peer']],['qa-relation-b','qa-other-existing','虛構店長分享培訓經驗',['qa-peer']]]) bundle.ops.push(c.revision('visit',id,{store,date:'2026-10-01',text,next:'',source:'',people,topics:[],attachments:[]},[],'fictional'));
    c.validateBundle(bundle);
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

try {
 for(const width of [1280,393]) {
  const h=await isolated(width),{page}=h;page.on('dialog',d=>d.accept());
  const original=await snapshot(page),boss=original.records.find(r=>r.supervisorKey);
  const open=async()=>{await page.locator('.rail [data-view="stores"]').click();await page.locator('#customer-list [data-visit-brief="qa-existing"]').click();await page.locator('[data-open-supervisor]').click();await page.locator('#supervisor-note-form').waitFor();};
  await open();
  assert.equal(await page.locator('#graph-wrap').isVisible(),false);
  const layout=await page.locator('#focus-detail').evaluate(e=>({relations:e.querySelector('.simple-relations').offsetTop,notes:e.querySelector('.simple-note-section').offsetTop}));assert.ok(layout.relations<layout.notes);
  await page.locator('.relation-evidence summary').first().click();assert.ok((await page.locator('.relation-evidence').first().innerText()).includes('虛構店長分享培訓經驗'));
  await page.locator('[data-supervisor-review="confirmed"]').first().click();await page.locator('[data-relation-group="confirmed"]').waitFor();assert.equal(await page.locator('[data-relation-group="confirmed"]').getAttribute('open'),null);
  await page.locator('[data-relation-group="confirmed"]>summary').click();await page.locator('[data-supervisor-review="pending"]').first().click();await page.locator('[data-relation-group="pending"]').waitFor();await page.locator('[data-relation-group="pending"]>summary').click();await page.locator('[data-supervisor-review="rejected"]').first().click();assert.equal(await page.locator('.simple-relations>.relation-value-card').count(),0);
  await page.locator('#supervisor-personal-note').fill('虛構私人筆記：<script>不執行</script>');await page.locator('.relationship-own-notes summary').click();await page.locator('#supervisor-relationship-note').fill('虛構店長的培訓交流經驗');
  await page.locator('.rail [data-view="stores"]').click();assert.equal(await page.locator('#supervisor-personal-note').inputValue(),'虛構私人筆記：<script>不執行</script>');
  await page.locator('#supervisor-note-status').filter({hasText:'草稿已加密'}).waitFor();
  assert.equal((await snapshot(page)).payload.supervisorDraft.relationshipNotes,'虛構店長的培訓交流經驗');
  await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await page.locator('[data-supervisor-resume]').click();assert.equal(await page.locator('#supervisor-personal-note').inputValue(),'虛構私人筆記：<script>不執行</script>');
  await page.locator('#supervisor-note-form button[type=submit]').click();await page.locator('#supervisor-note-status').filter({hasText:'已儲存；'}).waitFor();
  const after=await snapshot(page);assert.equal(after.payload.supervisorDraft,null);assert.equal(after.records.find(r=>r.id===boss.id).relationshipNotes,'虛構店長的培訓交流經驗');assert.deepEqual(after.payload.bundle.ops.slice(0,original.payload.bundle.ops.length),original.payload.bundle.ops);assert.deepEqual(after.records.filter(r=>r.type==='visit'),original.records.filter(r=>r.type==='visit'));
  const reviews=after.records.find(r=>r.id===boss.id).relationshipReviews;assert.equal(reviews.length,3);assert.equal(reviews.at(-1).status,'rejected');
  await page.screenshot({path:path.join(outputDir,`supervisor-relationships-${width}.png`),fullPage:true});
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(geometry.scroll<=geometry.width+1);assert.deepEqual(h.errors,[]);assert.deepEqual(h.external,[]);
  report.scenarios.push({width,passed:true,encryptedDraftReload:true,reviewHistory:reviews.length,originalRevisionsPreserved:true,geometry});await h.context.close();
 }
 fs.writeFileSync(path.join(outputDir,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
