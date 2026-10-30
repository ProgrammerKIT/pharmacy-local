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
  feature: 'edit-reminder-tasks',
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
    let tasks=c.addReminderTasks(firstStore.data,'虛構待辦：下次帶兩份資料\n虛構已完成事項','2026-10-01T00:00:00.000Z');tasks=c.completeReminderTask(tasks,tasks.nextRememberTasks[1].id,'2026-10-02T00:00:00.000Z');
    const latestStore = c.revision('store', firstStore.entity, { ...tasks, contact: '人工更新後的窗口' }, [firstStore.id], 'fictional-qa');
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

try {
 for(const width of [1280,393]) {
  const h=await isolated(width),{page}=h;let accept=true;const confirmations=[];page.on('dialog',async d=>{confirmations.push(d.message());if(accept)await d.accept();else await d.dismiss();});
  const before=await snapshot(page),store=before.records.find(r=>r.id==='qa-existing'),task=store.nextRememberTasks[0],done=store.nextRememberTasks[1];
  await page.locator('.rail [data-view="stores"]').click();await page.locator('#customer-list [data-visit-brief="qa-existing"]').click();await page.locator('#review [data-reminder-task-edit]').click();
  const input=page.locator('[data-reminder-task-text]');assert.equal(await input.inputValue(),task.text);assert.equal(await page.locator('[data-reminder-task-panel]').getAttribute('open'),'');
  const edited='虛構待辦：改帶三份資料 <img src=x>\n同一筆繼續追蹤';await input.fill(edited);
  await page.locator('#store-reminder-dialog [data-close]').filter({hasText:'稍後繼續'}).click();await page.locator('#store-reminder-dialog').waitFor({state:'hidden'});assert.deepEqual((await snapshot(page)).payload.bundle,before.payload.bundle);
  await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await page.locator('#reminder-draft-banner>summary').click();await page.locator('[data-resume-reminder]').click();assert.equal(await input.inputValue(),edited);await page.locator('[data-reminder-task-panel]>summary').click();
  await input.fill('  ');await page.locator('#store-reminder-save').click();await page.locator('#store-reminder-error').filter({hasText:'不可空白'}).waitFor();assert.deepEqual((await snapshot(page)).payload.bundle,before.payload.bundle);
  await input.fill(edited);accept=false;await page.locator('#store-reminder-save').click();await page.locator('#store-reminder-save').waitFor({state:'visible'});assert.deepEqual((await snapshot(page)).payload.bundle,before.payload.bundle);accept=true;
  await page.locator('#store-reminder-save').click();await page.locator('#visit-attendance-dialog[open]').waitFor();await page.locator('#visit-attendance-dialog button[type=submit]').click();await page.locator('#store-reminder-dialog').waitFor({state:'hidden'});
  const after=await snapshot(page),current=after.records.find(r=>r.id==='qa-existing');assert.equal(current.nextRememberTasks.length,2);assert.deepEqual(current.nextRememberTasks[0],{...task,text:edited});assert.deepEqual(current.nextRememberTasks[1],done);assert.deepEqual(after.payload.bundle.ops.slice(0,before.payload.bundle.ops.length),before.payload.bundle.ops);assert.equal(after.payload.bundle.ops.length,before.payload.bundle.ops.length+1);assert.equal(current.heads[0].visitAttendance,undefined);assert.deepEqual(after.records.filter(r=>r.type==='visit'),before.records.filter(r=>r.type==='visit'));assert.deepEqual(after.records.find(r=>r.id==='qa-other-existing'),before.records.find(r=>r.id==='qa-other-existing'));
  assert.ok(confirmations.some(s=>s.includes('修改前：'+task.text)&&s.includes('修改後：'+edited)));
  await page.locator('.rail [data-view="stores"]').click();await page.locator('#customer-list [data-visit-brief="qa-existing"]').click();assert.ok((await page.locator('#review .brief-reminders').innerText()).includes(edited));await page.locator('#review [data-reminder-task-edit]').click();assert.equal(await input.inputValue(),edited);
  await page.screenshot({path:path.join(outputDir,`task-edit-${width}.png`),fullPage:true});const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(geometry.scroll<=geometry.width+1);assert.deepEqual(h.errors,[]);assert.deepEqual(h.external,[]);
  report.scenarios.push({width,passed:true,sameTaskIdentity:true,completionAndCreatedAtPreserved:true,encryptedDraftResumed:true,emptyAndCancelWriteNothing:true,oldVersionsAndVisitsExact:true,geometry});await h.context.close();
 }
 fs.writeFileSync(path.join(outputDir,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
