// Fictional-only, opt-in browser fixture. No production data or Mac API.
// node test/qa/day-plans-fixture.mjs --self-test
// node test/qa/day-plans-fixture.mjs -> http://127.0.0.1:18866/qa.html
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const PORT = 18866;

export async function makeFixture(c) {
  const at = '2026-10-02T02:00:00.000Z', bundle = c.emptyBundle('synthetic-day-plans-vault');
  const store = (name, extra = {}) => ({ name, city: '虛構市', district: '測試區', address: '', mapUrl: '', channel: '', attr: '', contact: '', nextRemember: '', everyTimeMust: '', ...extra });
  const addStore = (id, data, attendance) => {
    const op = c.revision('store', id, data, [], 'synthetic-seed', false, attendance);
    bundle.ops.push(op); return op;
  };
  let a = c.addReminderTasks(store('虛構青禾藥局', { everyTimeMust: '確認單支裝庫存' }), 'HAUD 2盒\n詢問上次試用品反應\n已交付的舊試用品 9盒', at);
  a = c.completeReminderTask(a, a.nextRememberTasks[2].id, '2026-10-02T03:00:00.000Z');
  addStore('qa-plan-a', a, c.makeVisitAttendance('qa-plan-a', at));
  addStore('qa-plan-b', c.addReminderTasks(store('虛構晨光藥局'), 'HAUD 1盒\nHAMD 1瓶\n陳列盒（小）1個', at));
  addStore('qa-plan-c', c.addReminderTasks(store('虛構晴川藥局', { everyTimeMust: '衛教單 3份' }), 'Complete\n確認陳列位置', at));
  addStore('qa-plan-d', store('虛構田野藥局', { nextRemember: '陳列盒（中）1個\nHAUD（特殊規格）1盒', everyTimeMust: '詢問上課後反應' }));
  addStore('qa-plan-pending', c.addReminderTasks(store('虛構身分待確認店', { csvIdentityPending: true }), 'HAUD 99盒', at));
  const deleted = addStore('qa-plan-deleted', c.addReminderTasks(store('虛構回收桶門市'), 'HAUD 88盒', at));
  bundle.ops.push(c.revision('store', deleted.entity, deleted.data, [deleted.id], 'synthetic-seed', true));
  const conflicted = addStore('qa-plan-conflict', c.addReminderTasks(store('虛構衝突門市'), 'HAUD 77盒', at));
  bundle.ops.push(c.revision('store', conflicted.entity, { ...conflicted.data, contact: '虛構分歧甲' }, [conflicted.id], 'synthetic-phone'));
  bundle.ops.push(c.revision('store', conflicted.entity, { ...conflicted.data, contact: '虛構分歧乙' }, [conflicted.id], 'synthetic-mac'));
  const raw = new TextEncoder().encode('name,note\r\nSynthetic,keep original source unchanged\r\n');
  const blob = await c.hashBytes(raw); bundle.blobs[blob] = c.b64(raw);
  bundle.ops.push(c.revision('source', 'qa-plan-source', { file: 'fictional-day-plans.csv', list: 'Synthetic source', blob, batch: 'qa-day-plans', rows: 1, headers: ['name', 'note'], encoding: 'utf-8', delimiter: ',' }, [], 'synthetic-seed'));
  for (const id of ['a', 'b', 'c', 'd']) {
    const text = id === 'a' ? '  虛構原始筆記：本次行程不得改寫。\r\n空白、日期與換行均須原樣保留。  ' : `虛構 ${id.toUpperCase()} 店原始筆記：只供行程與準備驗收。`;
    bundle.ops.push(c.revision('visit', 'qa-plan-note-' + id, { store: 'qa-plan-' + id, date: '2026-09-30', source: '合成資料，非客戶', text, next: '', topics: [], people: [], attachments: id === 'a' ? [{ blob, name: 'fictional-day-plans.csv', mime: 'text/csv' }] : [] }, [], 'synthetic-seed'));
  }
  return c.validateBundle(bundle);
}

export function changeFixture(c, original, scenario) {
  const bundle = structuredClone(original), records = c.project(bundle);
  const record = records.find(row => row.type === 'store' && row.id === 'qa-plan-a');
  if (!record || record.deleted || record.conflict) throw new Error('虛構青禾藥局已有衝突；先使用目前狀態測試，不自動覆蓋。');
  const data = record.heads[0].data, parents = record.heads.map(head => head.id);
  if (scenario === 'source') {
    const task = data.nextRememberTasks.find(task => !task.completedAt && /^HAUD /.test(task.text));
    if (!task) throw new Error('虛構 HAUD 任務已完成或不存在，沒有改動。');
    const next = task.text === 'HAUD 4盒' ? 'HAUD 2盒' : 'HAUD 4盒';
    bundle.ops.push(c.revision('store', record.id, { ...data, nextRememberTasks: data.nextRememberTasks.map(item => item.id === task.id ? { ...item, text: next } : item) }, parents, 'synthetic-scenario-source'));
  } else if (scenario === 'complete') {
    const task = data.nextRememberTasks.find(task => !task.completedAt && /^HAUD /.test(task.text));
    if (!task) throw new Error('虛構 HAUD 任務已完成或不存在，沒有重複寫入。');
    bundle.ops.push(c.revision('store', record.id, c.completeReminderTask(data, task.id), parents, 'synthetic-scenario-complete'));
  } else if (scenario === 'conflict') {
    bundle.ops.push(c.revision('store', record.id, { ...data, contact: '虛構並行來源甲' }, parents, 'synthetic-scenario-phone'));
    bundle.ops.push(c.revision('store', record.id, { ...data, contact: '虛構並行來源乙' }, parents, 'synthetic-scenario-mac'));
  } else throw new Error('未知虛構情境');
  return c.validateBundle(bundle);
}

export async function auditBundle(c, bundle, original) {
  c.validateBundle(bundle); c.validateBundle(original);
  const records = c.project(bundle), baseline = c.project(original);
  const beforeOps = new Map(original.ops.map(op => [op.id, op])), afterOps = new Map(bundle.ops.map(op => [op.id, op]));
  const newOps = bundle.ops.filter(op => !beforeOps.has(op.id));
  const attendance = value => value.ops.filter(op => op.visitAttendance).map(op => ({ id: op.id, attendance: op.visitAttendance }));
  const visits = rows => rows.filter(row => row.type === 'visit').map(row => ({ id: row.id, deleted: row.deleted, conflict: row.conflict, heads: row.heads.map(head => ({ id: head.id, data: head.data })) })).sort((a, b) => a.id.localeCompare(b.id));
  const stores = records.filter(row => row.type === 'store');
  const nonPlanStoreData = rows => rows.filter(row => row.type === 'store').map(row => {
    const data = structuredClone(row.heads[0].data); delete data.datePlans; delete data.datePlanOrder;
    return { id: row.id, deleted: row.deleted, conflict: row.conflict, data };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return {
    syntheticOnly: true,
    fingerprint: await c.hashBytes(new TextEncoder().encode(JSON.stringify(bundle))),
    originalOpsPreserved: [...beforeOps].every(([id, op]) => JSON.stringify(afterOps.get(id)) === JSON.stringify(op)),
    originalBlobsPreserved: Object.entries(original.blobs).every(([id, bytes]) => bundle.blobs[id] === bytes),
    originalVisitTextPreserved: original.ops.filter(op => op.type === 'visit').every(op => afterOps.get(op.id)?.data.text === op.data.text),
    currentVisitDataUnchanged: JSON.stringify(visits(records)) === JSON.stringify(visits(baseline)),
    currentNonPlanStoreDataUnchanged: JSON.stringify(nonPlanStoreData(records)) === JSON.stringify(nonPlanStoreData(baseline)),
    attendanceUnchanged: JSON.stringify(attendance(bundle)) === JSON.stringify(attendance(original)),
    noNewAttendance: newOps.every(op => !op.visitAttendance),
    deletedStoreStillDeleted: stores.find(store => store.id === 'qa-plan-deleted')?.deleted === true,
    counts: { opsBefore: original.ops.length, opsAfter: bundle.ops.length, newOps: newOps.length, activeStores: stores.filter(store => !store.deleted).length, eligibleStores: stores.filter(store => !store.deleted && !store.conflict && !store.csvIdentityPending).length, visits: records.filter(row => row.type === 'visit' && !row.deleted).length, planStores: stores.filter(store => !!store.datePlans && Object.keys(store.datePlans).length > 0).length, newScenarioOps: newOps.filter(op => op.device?.startsWith?.('synthetic-scenario')).length },
    stores: stores.map(store => ({ id: store.id, name: store.name, deleted: store.deleted, conflict: store.conflict, pending: store.csvIdentityPending === true, nextRemember: store.nextRemember || '', tasks: store.nextRememberTasks || [], everyTimeMust: store.everyTimeMust || '', plans: store.datePlans || [], order: store.datePlanOrder || [], heads: store.heads.map(head => head.id) })),
    newOps: newOps.map(op => ({ id: op.id, entity: op.entity, type: op.type, device: op.device, data: op.data }))
  };
}

function browserMain() {
  const output = document.getElementById('output'), baselineKey = 'synthetic-day-plans-baseline';
  const run = fn => async () => {
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    try { output.textContent = '處理中…'; await fn(); }
    catch (error) { output.textContent = 'ERROR: ' + error.message; }
    finally { for (const button of document.querySelectorAll('button')) button.disabled = false; }
  };
  const allowed = () => { if (location.origin !== 'http://127.0.0.1:18866') throw new Error('拒絕在專用測試 origin 以外執行'); };
  const stored = async () => {
    allowed(); const slot = await db.readLocal();
    if (!slot?.unlockKey) throw new Error('請先建立虛構測試資料');
    const payload = await c.unseal(slot.envelope, slot.unlockKey, 'device');
    if (payload.qaOnly !== 'day-plans-fictional-v1' || payload.bundle.vaultId !== 'synthetic-day-plans-vault' || payload.token) throw new Error('非此專用虛構庫，拒絕讀取、改動或輸出');
    return { slot, payload };
  };
  document.getElementById('seed').onclick = run(async () => {
    allowed(); if (await db.readLocal()) throw new Error('此測試 origin 已有資料，不覆蓋既有測試證據。請直接開啟測試 App 或檢查結果。');
    const meta = c.newMeta(); meta.vaultId = 'synthetic-day-plans-vault';
    const key = await c.derive('fictional-day-plans-password-only', meta), bundle = await makeFixture(c);
    const payload = { schema: 1, device: 'synthetic-day-plan-device', deviceName: '僅虛構行程測試', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, qaOnly: 'day-plans-fictional-v1' };
    await db.writeLocal(await c.seal(payload, key, meta, 'device'), 0, key);
    localStorage.setItem(baselineKey, JSON.stringify(bundle));
    output.textContent = '虛構資料建立完成：4 間可安排門市，另含待確認、回收桶與衝突門市各 1 間。尚未安排任何行程，請在 App 內操作。';
  });
  document.getElementById('audit').onclick = run(async () => {
    const { slot, payload } = await stored(), original = JSON.parse(localStorage.getItem(baselineKey) || 'null');
    if (!original) throw new Error('缺少原始測試基準');
    output.textContent = JSON.stringify({ diskRevision: slot.revision, ...await auditBundle(c, payload.bundle, original) }, null, 2);
  });
  const descriptions = {
    source: '只修改虛構青禾藥局的 HAUD 待辦數量（2 盒與 4 盒切換），保留同一任務 ID 與全部舊版本。用於檢查行程是否顯示最新提醒及是否阻擋其他視窗的舊狀態寫入。',
    complete: '只完成虛構青禾藥局的 HAUD 任務並保留歷史。不會新增實際拜訪或改寫原始筆記。',
    conflict: '只為虛構青禾藥局建立兩個並行門市版本，驗證已排行程遇到來源衝突時仍保留安排、顯示警示並阻擋該店操作。此頁不裁定或解決衝突。'
  };
  for (const [scenario, description] of Object.entries(descriptions)) document.getElementById('scenario-' + scenario).onclick = run(async () => {
    if (!confirm(description + '\n\n只影響 127.0.0.1:18866 虛構測試庫。確認建立這個測試情境？')) { output.textContent = '已取消，測試資料未變更。'; return; }
    const { slot, payload } = await stored(), bundle = changeFixture(c, payload.bundle, scenario);
    await db.writeLocal(await c.seal({ ...payload, bundle, dirty: true }, slot.unlockKey, slot.envelope, 'device'), slot.revision, slot.unlockKey);
    output.textContent = description + '\n已寫入虛構庫。已開啟的 App 保留舊版本以測試 CAS 阻擋；重新開啟 App 後可測試新來源的呈現。';
  });
  document.getElementById('backup').onclick = run(async () => {
    const { slot, payload } = await stored();
    const bytes = JSON.stringify({ format: 'pharmacy-backup-1', envelope: await c.seal(payload.bundle, slot.unlockKey, slot.envelope) });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })), a = document.createElement('a');
    a.href = url; a.download = 'synthetic-day-plans.pharmabackup'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    output.textContent = '已下載虛構加密備份；本頁未修改資料。只可用此專用測試 origin 的 App 核對，不要帶到正式 App。';
  });
}

const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>虛構行程與準備驗收</title><style>body{font:16px/1.6 system-ui;margin:24px;max-width:1050px}button,a{display:inline-block;padding:12px;margin:6px;min-height:44px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef5f5;padding:16px}strong{color:#a21}</style><h1>虛構行程與準備驗收</h1><p><strong>只接受 127.0.0.1:18866；無正式資料、無 Mac API、無外部服務。</strong></p><p>全部門市、任務、原文、Source Snapshot 與附件均為合成資料。種子不覆蓋既有 IndexedDB。行程必須透過 App UI 安排。</p><button id="seed">建立虛構測試資料</button><a href="/" target="_blank" rel="noopener">開啟測試 App</a><button id="audit">唯讀檢查測試結果</button><button id="backup">匯出虛構加密備份</button><h2>基準</h2><ul><li>青禾：HAUD 2 盒、一般待辦、已完成舊任務。</li><li>晨光：HAUD 1 盒、HAMD 1 瓶、陳列盒（小）1 個。</li><li>晴川：Complete 無數量；每次必做、必給有衛教單 3 份。</li><li>田野：legacy 原文有陳列盒（中）、HAUD 特殊規格。</li><li>另有身分待確認、回收桶、衝突各 1 間，不能安排或修改行程。</li></ul><h2>來源變動情境（只修改虛構庫）</h2><p>先在 App 加入門市、調整順序或取消安排，再使用以下按鈕。每次操作都先說明作用並確認；原文、來源與拜訪日期不變。</p><button id="scenario-source">虛構 HAUD 數量切換 2／4 盒</button><button id="scenario-complete">完成虛構 HAUD 任務</button><button id="scenario-conflict">建立虛構來源衝突</button><pre id="output" aria-live="polite">尚未操作。此頁檢查只讀取這個專用 origin 且通過 qaOnly 核對的測試庫。</pre><script type="module" src="/qa-client.mjs"></script></html>`;
const client = `import * as c from '/core.js';import * as db from '/db.js';\n${makeFixture.toString()}\n${changeFixture.toString()}\n${auditBundle.toString()}\n(${browserMain.toString()})();`;

export function createFixtureServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (request.headers.host !== '127.0.0.1:' + PORT) { response.writeHead(403); return response.end('Dedicated fictional origin only'); }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(503, { 'Content-Type': 'application/json' }); return response.end('{"error":"Synthetic fixture: APIs and network writes disabled"}'); }
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
      response.writeHead(200, { 'Content-Type': mime }); response.end(request.method === 'HEAD' ? '' : content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const c = await import('../../public/core.js'), bundle = await makeFixture(c);
    const before = await auditBundle(c, bundle, bundle);
    assert.equal(before.counts.eligibleStores, 4); assert.equal(before.counts.visits, 4); assert.equal(before.currentNonPlanStoreDataUnchanged, true);
    for (const scenario of ['source', 'complete', 'conflict']) {
      const changed = changeFixture(c, bundle, scenario), audit = await auditBundle(c, changed, bundle);
      for (const field of ['originalOpsPreserved', 'originalBlobsPreserved', 'originalVisitTextPreserved', 'currentVisitDataUnchanged', 'attendanceUnchanged', 'noNewAttendance', 'deletedStoreStillDeleted']) assert.equal(audit[field], true, scenario + ': ' + field);
      const a = c.project(changed).find(row => row.id === 'qa-plan-a');
      if (scenario === 'source') assert.equal(a.nextRememberTasks[0].text, 'HAUD 4盒');
      if (scenario === 'complete') assert.ok(a.nextRememberTasks[0].completedAt);
      if (scenario === 'conflict') assert.equal(a.conflict, true);
    }
    const meta = c.newMeta(); meta.vaultId = bundle.vaultId;
    const key = await c.derive('fictional-self-test-password', meta);
    assert.deepEqual(await c.unseal(await c.seal(bundle, key, meta), key), bundle);
    console.log(JSON.stringify({ ok: true, syntheticOnly: true, ...before.counts }));
  } else createFixtureServer().listen(PORT, '127.0.0.1', () => console.log('Synthetic-only fixture: http://127.0.0.1:' + PORT + '/qa.html'));
}
