// Fictional full-App browser QA. Never connects to a production database or API.
// node test/qa/iphone-ui-audit-fixture.mjs --self-test (no port is bound)
// node test/qa/iphone-ui-audit-fixture.mjs -> http://127.0.0.1:18871/qa.html
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fixtureCalendar, makeFixture as makeMonthlyFixture } from './monthly-visits-fixture.mjs';
import { makeFixture as makeInsightFixture } from './confirmed-insight-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Optional code-only baseline directory for before/after UI comparison.
// No API or file outside this public root is served.
const publicDir = await fs.realpath(path.resolve(process.env.QA_PUBLIC_DIR || path.join(root, 'public')));
const PORT = 18871;
const VAULT = 'synthetic-iphone-ui-audit-vault';
const PASSWORD = 'fictional-iphone-ui-audit-password-only';

export async function makeFixture(c, now = Date.now()) {
  const monthly = await makeMonthlyFixture(c, now), insights = makeInsightFixture(c), dates = fixtureCalendar(c, now);
  let bundle = c.emptyBundle(VAULT);
  bundle.ops = [...monthly.ops, ...insights.ops];
  bundle.blobs = { ...monthly.blobs, ...insights.blobs };
  const add = (type, id, data, parents = []) => {
    const op = c.revision(type, id, data, parents, 'synthetic-iphone-ui-seed');
    op.at = dates.at; bundle.ops.push(op); return op;
  };
  const longText = Array.from({ length: 72 }, (_, i) => {
    if (i % 9 === 8) return '';
    return '  第 ' + String(i + 1).padStart(2, '0') + ' 行：完全虛構的驗收筆記，保留中文、English、數字 1.25、HAUD / Complete 及標點。' + (i % 7 === 0 ? '\n第二段落保留空白：  中間兩格  與行尾兩格。  ' : '');
  }).join('\r\n') + '\r\n\r\n  最後一行：不要自動刪除前後空白。  ';
  const base = (name, extra = {}) => ({ name, city: '虛構市', district: '合成丙區', address: '', mapUrl: '', channel: '',
    attr: '', contact: '虛構窗口，非真實人物', nextRemember: '', everyTimeMust: '', ...extra });
  const taskData = c.addReminderTasks(base('虛構 001 長文與提醒驗收藥局', { attr: '  門市既有文字與正式拜訪文字是不同欄位。\r\n第一行留白不可以被刪除。  ',
    everyTimeMust: '確認虛構庫存與資料\n虛構的每次必給：展示單 1 份；不代表醫療指示。',
    monthlyVisits: [{ month: dates.month, active: true, updatedAt: dates.at }, { month: dates.next, active: true, updatedAt: dates.at }] }),
  'HAUD × 2 盒\nComplete × 1 瓶\n陳列盒（中）\n陳列盒（小）\n虛構長待辦：這個欄位刻意放入超過一行的文字，以核對按鈕、換行與勾選範圍是否完整。\n虛構已完成事項', dates.previousAt);
  const withHistory = c.completeReminderTask(taskData, taskData.nextRememberTasks.at(-1).id, dates.previousAt);
  add('store', 'qa-ui-store-001', withHistory);
  add('visit', 'qa-ui-note-001', { store: 'qa-ui-store-001', date: '', source: '完全虛構長文驗收', text: longText, next: '虛構下次跟進原文，與門市任務獨立。', topics: [], people: [], attachments: [] });
  add('store', 'qa-ui-store-002', base('虛構 002 只有門市原有文字藥局', { attr: longText.slice(0, 500), everyTimeMust: '門市只有原有文字，也應可於拜訪與單店完整閱讀。' }));
  const raw = new TextEncoder().encode('Title,Note\r\nSynthetic,Long filename and original source fixture only\r\n');
  const sourceBlob = await c.hashBytes(raw); bundle.blobs[sourceBlob] = c.b64(raw);
  const longFile = 'SYNTHETIC_SOURCE_FILENAME_'.padEnd(490, 'A') + '.csv';
  add('source', 'qa-ui-long-source', { file: longFile, list: 'Fictional long filename source', blob: sourceBlob, batch: 'qa-ui-long-source', rows: 1, headers: ['Title', 'Note'], encoding: 'utf-8', delimiter: ',' });
  for (let i = 3; i <= 173; i++) {
    const id = 'qa-ui-store-' + String(i).padStart(3, '0');
    const label = '虛構 ' + String(i).padStart(3, '0');
    const name = i === 3 ? 'SYNTHETIC_UI_003_'.padEnd(200, 'A') : i % 17 === 0 ? label + ' 超長名稱門市－這段店名用於檢查手機多行排版與加入取消按鈕是否一直可以操作' : label + ' 合成驗收藥局';
    add('store', id, base(name, { district: ['合成甲區', '合成乙區', '合成丙區'][i % 3],
      address: i % 11 === 0 ? '虛構市合成測試區很長的測試道路名稱二段 999 巷 888 弄 777 號 6 樓之 5（此為不可導航的虛構地址）' : '虛構市合成路 ' + i + ' 號',
      channel: i % 3 === 0 ? '大樹' : i % 3 === 1 ? '佑全健康人生' : '',
      attr: i % 8 === 0 ? '  虛構門市原有文字 ' + i + '\r\n不要自動轉成拜訪。  ' : '', csvAliases: i === 3 ? ['虛構 003 ASCII 長名稱藥局'] : [],
      ...(i <= 28 ? { monthlyVisits: [{ month: dates.month, active: true, updatedAt: dates.at }] } : {}) }));
    if (i <= 115) {
      const op = add('visit', 'qa-ui-note-' + String(i).padStart(3, '0'), { store: id, date: '', source: '完全虛構批次驗收',
        text: i % 19 === 0 ? longText : '虛構 ' + i + ' 店筆記：只供介面驗收。\n中文與英文 mixed words 123.45\n\n保留空行和標點：；（）「」。', next: '', topics: [], people: [],
        attachments: i === 3 ? [{ blob: sourceBlob, name: 'SYNTHETIC_ATTACHMENT_'.padEnd(196, 'B') + '.csv', mime: 'text/csv' }] : [],
        ...(i === 3 ? { csvSources: [{ file: longFile, fingerprint: sourceBlob, batch: 'qa-ui-long-source', list: 'Fictional long filename source', at: dates.at, blob: sourceBlob, sourceSnapshot: 'qa-ui-long-source', line: 2, headers: ['Title', 'Note'], cells: [name, 'Long filename and original source fixture only'] }] } : {}) });
      if (i === 3) op.at = new Date(now + 60000).toISOString(); // Ensure ASCII name appears in recent-use fallback cards.
    }
  }
  // Planning seed uses the real pure core operation, without any browser or production write.
  for (const date of [dates.date, c.shiftDayPlanDate(dates.date, 1)]) {
    const rows = c.project(bundle);
    const planned = ['qa-ui-store-001', 'qa-ui-store-017', 'qa-month-tree-pending', 'qa-insight-a'];
    bundle = c.applyDayPlanChanges(bundle, planned.map(id => ({ storeId: id, expectedHeads: rows.find(row => row.id === id).heads.map(head => head.id), plan: { date, active: true, items: [], acknowledged: [] } })), 'synthetic-iphone-ui-plan-seed', dates.at);
  }
  return c.validateBundle(bundle);
}

export async function auditBundle(c, bundle, original) {
  c.validateBundle(bundle); c.validateBundle(original);
  if (bundle.vaultId !== VAULT || original.vaultId !== VAULT) throw new Error('僅允許此專用虛構庫');
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const hash = value => c.hashBytes(new TextEncoder().encode(JSON.stringify(value)));
  const beforeOps = new Map(original.ops.map(op => [op.id, op])), afterOps = new Map(bundle.ops.map(op => [op.id, op]));
  const beforeRows = c.project(original), afterRows = c.project(bundle);
  const pick = (rows, type) => rows.filter(row => row.type === type).sort((a, b) => a.id.localeCompare(b.id));
  const dataOf = (rows, type, fields) => pick(rows, type).map(row => ({ id: row.id, deleted: row.deleted, conflict: row.conflict,
    heads: row.heads.map(head => fields ? Object.fromEntries(fields.map(field => [field, head.data[field] ?? null])) : head.data) }));
  const currentBefore = beforeRows.map(row => ({ id: row.id, type: row.type, deleted: row.deleted, heads: row.heads })).sort((a, b) => a.id.localeCompare(b.id));
  const currentAfter = afterRows.map(row => ({ id: row.id, type: row.type, deleted: row.deleted, heads: row.heads })).sort((a, b) => a.id.localeCompare(b.id));
  const [beforeFingerprint, afterFingerprint, beforeStateFingerprint, afterStateFingerprint] = await Promise.all([hash(original), hash(bundle), hash(currentBefore), hash(currentAfter)]);
  const allBeforePreserved = [...beforeOps].every(([id, op]) => equal(op, afterOps.get(id)));
  const newOps = bundle.ops.filter(op => !beforeOps.has(op.id));
  const changedRecords = afterRows.flatMap(row => {
    const previous = beforeRows.find(prior => prior.id === row.id && prior.type === row.type);
    if (previous && equal(previous.heads, row.heads) && previous.deleted === row.deleted) return [];
    const before = previous?.heads[0]?.data || {}, after = row.heads[0]?.data || {};
    return [{ id: row.id, type: row.type, beforeHeads: previous?.heads.map(head => head.id) || [], afterHeads: row.heads.map(head => head.id),
      changedFields: [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !equal(before[key], after[key])), deleted: row.deleted, conflict: row.conflict }];
  });
  const protectedChecks = {
    originalOpsPreserved: allBeforePreserved,
    currentVisitDataUnchanged: equal(dataOf(beforeRows, 'visit'), dataOf(afterRows, 'visit')),
    currentStoreDataUnchanged: equal(dataOf(beforeRows, 'store'), dataOf(afterRows, 'store')),
    storeOriginalTextUnchanged: equal(dataOf(beforeRows, 'store', ['attr', 'contact']), dataOf(afterRows, 'store', ['attr', 'contact'])),
    sourceSnapshotsUnchanged: equal(original.ops.filter(op => op.type === 'source'), bundle.ops.filter(op => op.type === 'source')),
    blobsUnchanged: equal(original.blobs, bundle.blobs),
    attendanceUnchanged: equal(original.ops.filter(op => op.visitAttendance), bundle.ops.filter(op => op.visitAttendance)),
    insightProfilesAndReviewsUnchanged: equal(dataOf(beforeRows, 'store', ['preVisitInsights', 'preVisitInsightReviews']), dataOf(afterRows, 'store', ['preVisitInsights', 'preVisitInsightReviews'])),
    remindersAndCompletedHistoryUnchanged: equal(dataOf(beforeRows, 'store', ['nextRemember', 'nextRememberTasks', 'everyTimeMust']), dataOf(afterRows, 'store', ['nextRemember', 'nextRememberTasks', 'everyTimeMust'])),
    schedulesAndMonthlyMembershipUnchanged: equal(dataOf(beforeRows, 'store', ['datePlans', 'datePlanOrder', 'monthlyVisits']), dataOf(afterRows, 'store', ['datePlans', 'datePlanOrder', 'monthlyVisits']))
  };
  const blobChecks = await Promise.all(Object.entries(bundle.blobs).map(async ([id, bytes]) => ({ id, sha256Matches: await c.hashBytes(c.unb64(bytes)) === id })));
  const stores = pick(afterRows, 'store'), visits = pick(afterRows, 'visit');
  return { syntheticOnly: true, beforeFingerprint, afterFingerprint, beforeStateFingerprint, afterStateFingerprint,
    bundleUnchanged: beforeFingerprint === afterFingerprint, projectedStateUnchanged: beforeStateFingerprint === afterStateFingerprint,
    protectedChecks, sourceBlobHashesMatch: blobChecks.every(row => row.sha256Matches), sourceBlobHashes: blobChecks,
    counts: { storeIds: stores.length, activeStoreIds: stores.filter(row => !row.deleted).length, availableStoreIds: stores.filter(row => !row.deleted && !row.conflict && !row.csvIdentityPending).length,
      visitIds: visits.length, opsBefore: original.ops.length, opsAfter: bundle.ops.length, newOps: newOps.length,
      plannedStores: stores.filter(row => row.datePlans?.length).length, insightStores: stores.filter(row => row.preVisitInsights?.entries.length).length },
    newRevisions: newOps.map(op => ({ id: op.id, entity: op.entity, type: op.type, deleted: op.deleted, confirmedAttendance: !!op.visitAttendance })), changedRecords,
    specialStores: stores.filter(row => ['qa-ui-store-001', 'qa-ui-store-002', 'qa-ui-store-017', 'qa-insight-a', 'qa-insight-b', 'qa-month-tree-pending'].includes(row.id)).map(row => ({ id: row.id, name: row.name, originalStoreTextLength: row.attr?.length || 0,
      visits: visits.filter(visit => visit.store === row.id).map(visit => ({ id: visit.id, textLength: visit.text?.length || 0 })), plans: row.datePlans?.map(plan => ({ date: plan.date, active: plan.active })) || [],
      insights: row.preVisitInsights ? c.storeInsightsForStore(bundle, row.id).entries.map(entry => ({ id: entry.id, status: c.insightReviewForEntry(row, entry).status })) : [] })) };
}

function browserMain() {
  const output = document.getElementById('output'), baselineKey = 'synthetic-iphone-ui-baseline', payloadKey = 'synthetic-iphone-ui-payload-baseline';
  const allowed = () => { if (location.origin !== 'http://127.0.0.1:18871') throw new Error('拒絕在專用虛構 origin 以外操作'); };
  const run = fn => async () => {
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    try { output.textContent = '處理中…'; await fn(); }
    catch (error) { output.textContent = 'ERROR: ' + error.message; }
    finally { for (const button of document.querySelectorAll('button')) button.disabled = false; }
  };
  const stored = async () => {
    allowed(); const slot = await db.readLocal();
    if (!slot?.unlockKey) throw new Error('請先首次建立虛構資料');
    const payload = await c.unseal(slot.envelope, slot.unlockKey, 'device');
    if (payload.qaOnly !== 'iphone-ui-audit-fictional-v1' || payload.bundle.vaultId !== VAULT || payload.token) throw new Error('非此專用虛構庫，拒絕讀取或輸出');
    return { slot, payload };
  };
  const original = () => {
    const value = JSON.parse(localStorage.getItem(baselineKey) || 'null');
    if (!value || value.vaultId !== VAULT) throw new Error('缺少虛構基準'); return value;
  };
  document.getElementById('seed').onclick = run(async () => {
    allowed(); if (await db.readLocal()) throw new Error('此獨立 origin 已有資料，拒絕覆蓋。請開啟 App 或唯讀核對。');
    const meta = c.newMeta(); meta.vaultId = VAULT;
    const key = await c.derive(PASSWORD, meta), bundle = await makeFixture(c);
    const payload = { schema: 1, device: 'synthetic-iphone-ui-device', deviceName: '僅虛構全 App iPhone 驗收', token: null, bundle,
      dirty: false, serverVersion: 0, lastSync: null, qaOnly: 'iphone-ui-audit-fictional-v1' };
    await db.writeLocal(await c.seal(payload, key, meta, 'device'), 0, key);
    localStorage.setItem(baselineKey, JSON.stringify(bundle)); localStorage.setItem(payloadKey, JSON.stringify(payload));
    output.textContent = JSON.stringify(await auditBundle(c, bundle, bundle), null, 2);
  });
  document.getElementById('audit').onclick = run(async () => {
    const { slot, payload } = await stored(), baselinePayload = JSON.parse(localStorage.getItem(payloadKey) || 'null');
    if (baselinePayload?.qaOnly !== 'iphone-ui-audit-fictional-v1') throw new Error('缺少正確虛構狀態基準');
    const outsideBundle = value => { const copy = structuredClone(value); delete copy.bundle; return copy; };
    const originalState = outsideBundle(baselinePayload), currentState = outsideBundle(payload);
    const hash = value => c.hashBytes(new TextEncoder().encode(JSON.stringify(value)));
    output.textContent = JSON.stringify({ diskRevision: slot.revision, ...(await auditBundle(c, payload.bundle, original())),
      nonBundlePayload: { beforeFingerprint: await hash(originalState), afterFingerprint: await hash(currentState),
        changedFields: [...new Set([...Object.keys(originalState), ...Object.keys(currentState)])].filter(field => JSON.stringify(originalState[field]) !== JSON.stringify(currentState[field])) },
      notice: '唯讀；列出所有差異，不把 UI 操作造成的資料變更視為通過。虛構庫中刻意儲存新筆記時，原 OP 仍必須完整保留。' }, null, 2);
  });
  document.getElementById('roundtrip').onclick = run(async () => {
    const { slot, payload } = await stored();
    const bytes = JSON.stringify({ format: 'pharmacy-backup-1', envelope: await c.seal(payload.bundle, slot.unlockKey, slot.envelope) });
    const reopened = c.validateBundle(await c.unseal(JSON.parse(bytes).envelope, slot.unlockKey));
    const result = await auditBundle(c, reopened, payload.bundle);
    output.textContent = JSON.stringify({ encryptionRoundTrip: result.bundleUnchanged, backupBytes: new TextEncoder().encode(bytes).length, ...result,
      notice: '只在記憶體加密及解密虛構備份；未匯入、還原或修改 App。' }, null, 2);
  });
}

const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>虛構全 App iPhone UI 驗收</title><style>body{font:16px/1.6 system-ui;margin:24px;max-width:1100px}button,a{display:inline-block;padding:12px;margin:6px;min-height:44px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef5f5;padding:16px}strong{color:#a21}li{margin-bottom:12px}code{overflow-wrap:anywhere}</style><h1>虛構全 App iPhone UI 驗收</h1><p><strong>僅 127.0.0.1:18871；190 間門市與全部筆記、人物、任務、分析、歷史完全虛構。沒有正式庫、Mac API 或外部服務。</strong></p><p>首次只在空 origin 建立加密種子；不覆蓋或清除資料。驗收正常 App 操作後，回此頁唯讀核對完整 OP、投影狀態、原文與所有受保護欄位。虛構密碼：<code>fictional-iphone-ui-audit-password-only</code>。</p><button id="seed">首次建立虛構測試資料</button><a href="/" target="_blank" rel="noopener">開啟真實 App 程式驗收</a><button id="audit">唯讀核對全部資料與狀態</button><button id="roundtrip">唯讀驗證加密備份往返</button><h2>測試入口</h2><ul><li>「虛構 001 長文與提醒驗收藥局」：72 行中英文、數字、CRLF 與空行筆記；門市原有文字、未完成／已完成任務、每次必做、今日／明日行程、本月／下月必訪。驗證閱讀、精準點選、游標、選字、修改與取消／差異／儲存。</li><li>「虛構 002 只有門市原有文字藥局」：沒有正式拜訪，仍須在拜訪與單店看到既有門市文字；瀏覽不得新增拜訪或日期。</li><li>「虛構 017 超長名稱門市」與每 17 間長名稱：驗證搜尋、長列表、卡片換行、按鈕、選店與捲動。190 間名單可重現有限視窗中的深層操作。</li><li>「虛構青禾藥局」：兩張 Kit 已確認卡，詳細資訊預設收合；「虛構晨光藥局」：一張待查核與一張不符合，後者僅保留歷史。全部證據可回原文。</li><li>每月拜訪：本月、下月、上月、同名不同地址、實際拜訪確認、只有今天筆記但尚未拜訪、回收桶、身分待確認及衝突情境。</li><li>行程與準備：今日／明日已安排四店；驗證查看、選店、深層列表、取消及排序。行程不應算實際拜訪。</li><li>資料與安全：只用這個虛構庫驗證完整編輯、來源、歷史、回收桶、備份預覽與取消；不要輸入任何正式密碼或正式備份。</li></ul><p>只瀏覽後 bundleUnchanged、projectedStateUnchanged 與所有 protectedChecks 應為 true。透過 App 明確修改虛構資料後必須逐項檢查 newRevisions / changedRecords；這些結果不是正式資料驗收，也不是 iPhone 真機鍵盤驗收。</p><h2>核驗結果與 SHA-256</h2><pre id="output" aria-live="polite">尚未操作</pre><script type="module" src="/qa-client.mjs"></script></html>`;
const rename = (fn, name) => fn.toString().replace(/function makeFixture\(/, 'function ' + name + '(');
const client = `import * as c from '/core.js';import * as db from '/db.js';const VAULT=${JSON.stringify(VAULT)},PASSWORD=${JSON.stringify(PASSWORD)};\n${fixtureCalendar.toString()}\n${rename(makeMonthlyFixture, 'makeMonthlyFixture')}\n${rename(makeInsightFixture, 'makeInsightFixture')}\n${makeFixture.toString()}\n${auditBundle.toString()}\n(${browserMain.toString()})();`;

export function createFixtureServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (request.headers.host !== '127.0.0.1:' + PORT) { response.writeHead(403); return response.end('Dedicated fictional origin only'); }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(503, { 'Content-Type': 'application/json' }); return response.end('{"error":"Synthetic fixture: all API and network writes disabled"}'); }
      const url = new URL(request.url, 'http://127.0.0.1:' + PORT);
      if (url.pathname.startsWith('/api/')) { response.writeHead(503, { 'Content-Type': 'application/json' }); return response.end('{"error":"Synthetic fixture: no production API connected"}'); }
      if (url.pathname === '/qa.html' || url.pathname === '/qa-client.mjs') {
        response.setHeader('Content-Type', url.pathname.endsWith('.mjs') ? 'text/javascript' : 'text/html; charset=utf-8');
        return response.end(request.method === 'HEAD' ? '' : url.pathname.endsWith('.mjs') ? client : html);
      }
      const file = path.resolve(publicDir, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(publicDir + path.sep)) { response.writeHead(403); return response.end(); }
      const stat = await fs.stat(file); if (!stat.isFile()) { response.writeHead(404); return response.end(); }
      const realFile = await fs.realpath(file); if (!realFile.startsWith(publicDir + path.sep)) { response.writeHead(403); return response.end(); }
      const content = await fs.readFile(file), mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
      const versionSource = await fs.readFile(path.join(publicDir, 'version.js'), 'utf8');
      const version = versionSource.match(/^export const APP_VERSION = ['"](\d+\.\d+\.\d+)['"];?\s*$/)?.[1];
      if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid package version');
      response.writeHead(200, { 'Content-Type': mime, 'X-Pharmacy-Version': version }); response.end(request.method === 'HEAD' ? '' : content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const c = await import('../../public/core.js'), bundle = await makeFixture(c, Date.parse('2026-10-15T03:00:00.000Z'));
    const audit = await auditBundle(c, bundle, bundle);
    assert.equal(audit.counts.storeIds, 190); assert.equal(audit.counts.availableStoreIds, 187);
    assert.equal(audit.counts.insightStores, 2); assert.equal(audit.counts.plannedStores, 4);
    assert.ok(audit.counts.visitIds >= 120); assert.equal(audit.bundleUnchanged, true); assert.equal(audit.projectedStateUnchanged, true);
    for (const [field, pass] of Object.entries(audit.protectedChecks)) assert.equal(pass, true, field);
    const rows = c.project(bundle), longVisit = rows.find(row => row.id === 'qa-ui-note-001');
    assert.ok(longVisit.text.length > 4000); assert.match(longVisit.text, /\r\n\r\n/);
    assert.equal(rows.filter(row => row.type === 'visit' && row.store === 'qa-ui-store-002').length, 0);
    assert.equal(rows.find(row => row.id === 'qa-ui-store-002').attr.length, 500);
    assert.equal(rows.find(row => row.id === 'qa-ui-store-003').name.length, 200);
    assert.equal(rows.find(row => row.id === 'qa-ui-note-003').attachments[0].name.length, 200);
    assert.ok(audit.specialStores.find(row => row.id === 'qa-insight-a').insights.every(entry => entry.status === 'confirmed'));
    assert.deepEqual(audit.specialStores.find(row => row.id === 'qa-insight-b').insights.map(entry => entry.status), ['pending', 'rejected']);
    const modified = structuredClone(bundle), old = c.project(modified).find(row => row.id === 'qa-ui-note-001');
    modified.ops.push(c.revision('visit', old.id, { ...old.heads[0].data, text: old.text + '\n虛構刻意新增文字' }, old.heads.map(head => head.id), 'synthetic-ui-self-test'));
    const changed = await auditBundle(c, modified, bundle);
    assert.equal(changed.bundleUnchanged, false); assert.equal(changed.protectedChecks.originalOpsPreserved, true);
    assert.equal(changed.protectedChecks.currentVisitDataUnchanged, false); assert.equal(changed.protectedChecks.currentStoreDataUnchanged, true);
    assert.equal(changed.protectedChecks.attendanceUnchanged, true); assert.deepEqual(changed.changedRecords[0].changedFields, ['text']);
    const corrupted = structuredClone(bundle); corrupted.ops[0].data.list += ' changed';
    const corruptAudit = await auditBundle(c, corrupted, bundle); assert.equal(corruptAudit.protectedChecks.originalOpsPreserved, false); assert.equal(corruptAudit.protectedChecks.sourceSnapshotsUnchanged, false);
    const meta = c.newMeta(); meta.vaultId = VAULT; const key = await c.derive(PASSWORD, meta);
    assert.deepEqual(await c.unseal(await c.seal(bundle, key, meta), key), bundle);
    new Function(client.slice(client.indexOf('const VAULT=')));
    // Execute the exact browser-side seed helper in memory too, without a DOM,
    // IndexedDB, network, or App hook, so embedded dependency names stay valid.
    const browserHelpers = client.slice(client.indexOf('const VAULT='), client.indexOf('(function browserMain'));
    const browserBuild = new Function('c', browserHelpers + '\nreturn makeFixture;')(c);
    const browserBundle = await browserBuild(c, Date.parse('2026-10-15T03:00:00.000Z'));
    assert.equal(c.project(c.validateBundle(browserBundle)).filter(row => row.type === 'store').length, 190);
    const server = createFixtureServer();
    const request = (url, method = 'GET', host = '127.0.0.1:' + PORT) => new Promise(resolve => {
      let status = 200; const headers = {};
      server.emit('request', { url, method, headers: { host } }, { setHeader: (key, value) => { headers[key] = value; }, writeHead: (code, values = {}) => { status = code; Object.assign(headers, values); }, end: value => resolve({ status, body: value === undefined ? '' : value.toString(), headers }) });
    });
    assert.equal((await request('/qa.html')).status, 200); assert.equal((await request('/qa-client.mjs')).body, client);
    assert.equal((await request('/app.js')).body, await fs.readFile(path.join(publicDir, 'app.js'), 'utf8'));
    assert.equal((await request('/api/state')).status, 503); assert.equal((await request('/api/sync', 'POST')).status, 503);
    assert.equal((await request('/', 'GET', 'example.invalid')).status, 403); assert.equal((await request('/%2e%2e%2fpackage.json')).status, 403);
    assert.equal((await request('/qa.html', 'HEAD')).body, ''); assert.equal(server.listening, false);
    console.log(JSON.stringify({ ok: true, syntheticOnly: true, serverStarted: false, requestIsolationChecked: true, encryptedBackupRoundTrip: true, ...audit.counts, longNoteCharacters: longVisit.text.length }));
  } else createFixtureServer().listen(PORT, '127.0.0.1', () => console.log('Synthetic-only fixture: http://127.0.0.1:' + PORT + '/qa.html'));
}
