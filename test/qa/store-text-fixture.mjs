// Fictional-only browser QA. No production data, external service, or Mac API.
// node test/qa/store-text-fixture.mjs --self-test
// node test/qa/store-text-fixture.mjs -> http://127.0.0.1:18868/qa.html
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const PORT = 18868;

export async function makeFixture(c) {
  const bundle = c.emptyBundle('synthetic-store-text-vault'), at = '2026-10-14T00:00:00.000Z';
  const store = (name, extra = {}) => ({ name, city: '虛構市', district: '測試區', address: '', mapUrl: '', channel: '', attr: '', contact: '', nextRemember: '', everyTimeMust: '', ...extra });
  const add = (type, id, data, parents = [], attendance) => {
    const op = c.revision(type, id, data, parents, 'fictional-store-text-seed', false, attendance);
    if (!attendance) op.at = at;
    bundle.ops.push(op); return op;
  };
  const note = (id, storeId, text, extra = {}) => add('visit', id, { store: storeId, date: '', source: '完全虛構，非客戶資料', text, next: '', topics: [], people: [], attachments: [], ...extra });
  const raw = new TextEncoder().encode('Title,Note\r\n"Fictional archival source","  retain CRLF and spaces  "\r\n');
  const blob = await c.hashBytes(raw); bundle.blobs[blob] = c.b64(raw);
  add('source', 'qa-text-source', { file: 'fictional-store-text.csv', list: 'Fictional original source', blob, batch: 'qa-store-text', rows: 1, headers: ['Title', 'Note'], encoding: 'utf-8', delimiter: ',' });
  const csvSources = [{ file: 'fictional-store-text.csv', fingerprint: blob, batch: 'qa-store-text', list: 'Fictional original source', at, blob, sourceSnapshot: 'qa-text-source', line: 2, headers: ['Title', 'Note'], cells: ['Fictional archival source', '  retain CRLF and spaces  '] }];

  add('store', 'qa-text-attr', store('虛構青禾原文店', { attr: '  原欄位特性甲：虛構林示範店長習慣先談門市經營。\r\n第二行保留兩個空白  與 CRLF。  ', csvSources }));
  add('store', 'qa-text-contact', store('虛構晨光窗口店', { contact: '  窗口獨有詞乙：虛構陳示範藥師\n週三午後可聯絡  ' }));
  add('store', 'qa-text-both', store('虛構晴川雙欄店', { attr: '雙欄特性丙：需要原樣看到的門市背景。', contact: '雙欄窗口丙：虛構王測試店長' }));
  add('store', 'qa-text-multi', store('虛構山河多筆店', { attr: '多筆特性丁：這段在三筆拜訪之外仍應看見。', contact: '多筆窗口丁：虛構張例子' }), [], c.makeVisitAttendance('qa-text-multi', '2026-10-10T02:00:00.000Z'));
  for (let i = 1; i <= 3; i++) note('qa-text-multi-note-' + i, 'qa-text-multi', '虛構多筆拜訪原文第 ' + i + ' 筆；歷史文字不可搬移。', { date: '2026-10-0' + i });
  add('store', 'qa-text-pending', store('虛構待確認原文店', { attr: '待確認特性戊：仍應可讀，但不可自動認定門市身分。', contact: '待確認窗口戊', csvIdentityPending: true }));
  note('qa-text-pending-note', 'qa-text-pending', '虛構待確認店拜訪；不裁定身分。');
  const conflicted = add('store', 'qa-text-conflict', store('虛構衝突原文店', { attr: '衝突共同基底，不能代選版本。' }));
  add('store', 'qa-text-conflict', { ...conflicted.data, attr: '衝突左分支己：禁止被當成唯一現況。', contact: '左分支窗口' }, [conflicted.id]);
  add('store', 'qa-text-conflict', { ...conflicted.data, attr: '衝突右分支己：禁止被當成唯一現況。', contact: '右分支窗口' }, [conflicted.id]);
  note('qa-text-conflict-note', 'qa-text-conflict', '虛構衝突門市正式筆記仍不可改寫。');
  add('store', 'qa-text-empty', store('虛構全空店'));
  const literal = '  <script>window.QA_SHOULD_NOT_RUN=true</script>\r\n<img src=x onerror="alert(1)"> & <b>只是原文</b>\n';
  add('store', 'qa-text-long', store('虛構長文安全店', { attr: (literal + '長文獨有庚：ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(20)).slice(0, 498), contact: '同樣只顯示字面內容：<svg onload="alert(2)">\n保留換行' }));
  add('store', 'qa-text-same-a', store('虛構同名藥局', { attr: '同名甲分店原文：不同 ID，不能串到乙店。', address: '虛構市甲路 1 號' }));
  add('store', 'qa-text-same-b', store('虛構同名藥局', { attr: '同名乙分店原文：不同 ID，不能串到甲店。', address: '虛構市乙路 2 號' }));
  note('qa-text-same-note-a', 'qa-text-same-a', '同名甲分店正式拜訪原文。');
  note('qa-text-same-note-b', 'qa-text-same-b', '同名乙分店正式拜訪原文。');
  const old = add('store', 'qa-text-history', store('虛構歷史来源店', { attr: '歷史舊特性，不能出現在目前原欄位。', contact: '舊窗口', csvSources }));
  add('store', 'qa-text-history', { ...old.data, attr: '歷史現行辛：目前原有文字完整呈現。', contact: '現行窗口辛' }, [old.id]);
  const historicalNote = note('qa-text-history-note', 'qa-text-history', '虛構拜訪歷史舊版原文。', { attachments: [{ blob, name: 'fictional-store-text.csv', mime: 'text/csv' }], csvSources });
  add('visit', historicalNote.entity, { ...historicalNote.data, text: '  虛構拜訪歷史現行原文。\r\n原始來源、空白、附件都必須保留。  ' }, [historicalNote.id]);
  add('store', 'qa-text-whitespace', store('虛構空白字元店', { attr: ' \r\n\t ', contact: '\n  ' }));
  add('store', 'qa-text-note-only', store('虛構只有拜訪店'));
  note('qa-text-note-only-note', 'qa-text-note-only', '只有拜訪壬：門市原欄位空白，不應顯示空框。');
  const deleted = add('store', 'qa-text-deleted', store('虛構回收桶原文店', { attr: '回收桶獨有癸，不應出現在正常列表。' }));
  bundle.ops.push(c.revision('store', deleted.entity, deleted.data, [deleted.id], 'fictional-store-text-seed', true));

  // 202 additional fictional stores exercise the all-store inventory, not only the named example.
  for (let i = 1; i <= 202; i++) {
    const suffix = String(i).padStart(3, '0'), id = 'qa-text-inventory-' + suffix, mode = i % 5;
    const data = store('虛構全庫店' + suffix, {
      attr: [0, 1, 3].includes(mode) ? '全庫特性' + suffix + '：完全虛構、只讀、不可新增版本。\n保留第二行。' : '',
      contact: [1, 2, 3].includes(mode) ? '全庫窗口' + suffix + '：虛構窗口' : ''
    });
    add('store', id, data);
    if (mode === 3 || mode === 4) note('qa-text-inventory-note-' + suffix, id, '全庫拜訪原文' + suffix + '：與門市文字維持不同欄位。');
  }
  return c.validateBundle(bundle);
}

export function inventory(c, bundle) {
  const records = c.project(bundle), visits = records.filter(row => row.type === 'visit' && !row.deleted);
  return records.filter(row => row.type === 'store').map(store => {
    const fields = store.heads.map(head => ({ revision: head.id, attr: head.data.attr, contact: head.data.contact }));
    const visible = !store.deleted && !store.conflict;
    return { id: store.id, name: store.name, deleted: store.deleted, conflict: store.conflict, pending: store.csvIdentityPending === true,
      visits: visits.filter(note => note.store === store.id).length, headCount: store.heads.length, historyVersions: store.versions.length,
      expectedAttr: visible && store.attr.trim() ? store.attr : '', expectedContact: visible && store.contact.trim() ? store.contact : '',
      expected: store.deleted ? '正常列表隱藏' : store.conflict ? '衝突警示；不代選任何版本文字' : store.attr.trim() || store.contact.trim() ? '拜訪列表及單店都顯示現行原欄位' : '不顯示空的門市原文字區', fields };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export async function auditBundle(c, bundle, original) {
  c.validateBundle(bundle); c.validateBundle(original);
  if (bundle.vaultId !== 'synthetic-store-text-vault' || original.vaultId !== bundle.vaultId) throw new Error('僅允許此專用虛構庫');
  const hash = value => c.hashBytes(new TextEncoder().encode(JSON.stringify(value)));
  const [beforeFingerprint, afterFingerprint] = await Promise.all([hash(original), hash(bundle)]);
  const allBefore = new Map(original.ops.map(op => [op.id, op])), allAfter = new Map(bundle.ops.map(op => [op.id, op]));
  const subset = (value, predicate) => value.ops.filter(predicate);
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const rows = inventory(c, bundle), baselineRows = inventory(c, original);
  return { syntheticOnly: true, beforeFingerprint, afterFingerprint, bundleUnchanged: beforeFingerprint === afterFingerprint,
    opsBefore: original.ops.length, opsAfter: bundle.ops.length, newOps: bundle.ops.filter(op => !allBefore.has(op.id)).length,
    originalOpsPreserved: [...allBefore].every(([id, op]) => equal(op, allAfter.get(id))),
    storeDataAndHistoryUnchanged: equal(subset(original, op => op.type === 'store'), subset(bundle, op => op.type === 'store')),
    visitTextAndHistoryUnchanged: equal(subset(original, op => op.type === 'visit'), subset(bundle, op => op.type === 'visit')),
    sourceSnapshotsUnchanged: equal(subset(original, op => op.type === 'source'), subset(bundle, op => op.type === 'source')),
    blobsUnchanged: equal(original.blobs, bundle.blobs),
    attendanceUnchanged: equal(subset(original, op => op.visitAttendance), subset(bundle, op => op.visitAttendance)),
    counts: { allStoreIds: rows.length, activeStoreIds: rows.filter(row => !row.deleted).length, readableStoreIdsWithText: rows.filter(row => row.expectedAttr || row.expectedContact).length, contactOnly: rows.filter(row => !row.expectedAttr && row.expectedContact).length, textWithNoVisit: rows.filter(row => (row.expectedAttr || row.expectedContact) && !row.visits).length, conflicts: rows.filter(row => row.conflict).length, pending: rows.filter(row => row.pending).length },
    changedStoreIds: rows.filter(row => !equal(row, baselineRows.find(before => before.id === row.id))).map(row => row.id),
    inventory: rows };
}

function browserMain() {
  const output = document.getElementById('output'), baselineKey = 'synthetic-store-text-baseline';
  const allowed = () => { if (location.origin !== 'http://127.0.0.1:18868') throw new Error('拒絕在專用虛構 origin 以外操作'); };
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
    if (payload.qaOnly !== 'store-text-fictional-v1' || payload.bundle.vaultId !== 'synthetic-store-text-vault' || payload.token) throw new Error('不屬於此專用虛構庫，拒絕讀取或输出');
    return { slot, payload };
  };
  let currentInventory = [];
  const showInventory = () => {
    const query = document.getElementById('inventory-query').value.trim().toLowerCase();
    const tbody = document.getElementById('inventory-body'); tbody.replaceChildren();
    const rows = currentInventory.filter(row => !query || JSON.stringify(row).toLowerCase().includes(query));
    for (const row of rows) {
      const tr = document.createElement('tr'); tr.dataset.storeId = row.id;
      for (const value of [row.id, row.name, String(row.visits), row.expected, row.expectedAttr, row.expectedContact]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      tbody.append(tr);
    }
    document.getElementById('inventory-count').textContent = '列出 ' + rows.length + ' / ' + currentInventory.length + ' 個獨立門市 ID。此表只是驗收基準，App 須另外透過正常 UI 查看。';
  };
  document.getElementById('inventory-query').addEventListener('input', showInventory);
  document.getElementById('seed').onclick = run(async () => {
    allowed(); if (await db.readLocal()) throw new Error('此獨立 origin 已有資料，拒絕覆蓋。請開啟 App 或執行唯讀檢查。');
    const meta = c.newMeta(); meta.vaultId = 'synthetic-store-text-vault';
    const key = await c.derive('fictional-store-text-password-only', meta), bundle = await makeFixture(c);
    const payload = { schema: 1, device: 'synthetic-store-text-device', deviceName: '僅虛構門市原文驗收', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, qaOnly: 'store-text-fictional-v1' };
    await db.writeLocal(await c.seal(payload, key, meta, 'device'), 0, key);
    localStorage.setItem(baselineKey, JSON.stringify(bundle));
    currentInventory = inventory(c, bundle); showInventory();
    output.textContent = JSON.stringify(await auditBundle(c, bundle, bundle), null, 2);
  });
  document.getElementById('audit').onclick = run(async () => {
    const { slot, payload } = await stored(), original = JSON.parse(localStorage.getItem(baselineKey) || 'null');
    if (!original || original.vaultId !== 'synthetic-store-text-vault') throw new Error('缺少正確虛構基準');
    currentInventory = inventory(c, payload.bundle); showInventory();
    output.textContent = JSON.stringify({ diskRevision: slot.revision, ...await auditBundle(c, payload.bundle, original) }, null, 2);
  });
}

const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>虛構門市原文全庫驗收</title><style>body{font:16px/1.6 system-ui;margin:24px;max-width:1300px}button,a{display:inline-block;padding:12px;margin:6px;min-height:44px}pre,td{white-space:pre-wrap;overflow-wrap:anywhere}pre{background:#eef5f5;padding:16px}strong{color:#a21}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #cbd4df;padding:10px;text-align:left;vertical-align:top}input{padding:12px;min-width:260px}.inventory{overflow:auto}</style><h1>虛構門市原文全庫驗收</h1><p><strong>僅 127.0.0.1:18868；所有內容虛構。沒有正式庫、Mac API 或外部網路。</strong></p><p>載入的 App 是本次 public/ 真正執行程式。此頁只在空 origin 首次建立加密合成庫，之後只能讀取驗收；不注入 App runtime、也不提供修改資料的 QA API。</p><button id="seed">首次建立虛構測試資料</button><a href="/" target="_blank" rel="noopener">開啟真實 App 程式驗收</a><button id="audit">唯讀核對完整資料未改動</button><h2>驗收範圍</h2><ul><li>216 間獨立門市 ID：215 間未刪除；涵蓋零拜訪但有原文、只有窗口、兩欄、三筆拜訪、身分待確認、衝突、全空、空白字元、HTML 字面內容、同名不同 ID、原始來源與歷史。</li><li>門市原欄位最大 500 字，長文使用 498 字；不為測試放寬正式欄位限制。</li><li>對照 .store-original-text[data-store-original-text] 與 pre[data-store-original-field]；單店同區塊位於 #review-body。內容必須唯讀，欄位來源清楚；衝突不代選任何版本。</li><li>分別用店名、原欄位獨有文字、窗口獨有文字搜尋。多筆拜訪與同名店須保持 ID 範圍，各店原文不串店。</li><li>完成純顯示操作後，bundleUnchanged、原始版本、拜訪原文、Source Snapshot、附件、attendance 必須全為 true，newOps 必須為 0。</li></ul><h2>逐店預期值（全部是合成內容）</h2><label>篩選驗收基準 <input id="inventory-query" placeholder="ID、名稱或預期原文"></label><p id="inventory-count">尚未載入合成庫</p><div class="inventory"><table><thead><tr><th>門市 ID</th><th>名稱</th><th>拜訪數</th><th>預期</th><th>原始特性／客群</th><th>原始主要窗口</th></tr></thead><tbody id="inventory-body"></tbody></table></div><h2>資料完整性檢查（含前後 SHA-256）</h2><pre id="output" aria-live="polite">尚未操作</pre><script type="module" src="/qa-client.mjs"></script></html>`;
const client = `import * as c from '/core.js';import * as db from '/db.js';\n${makeFixture.toString()}\n${inventory.toString()}\n${auditBundle.toString()}\n(${browserMain.toString()})();`;

export function createFixtureServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
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
      response.writeHead(200, { 'Content-Type': mime }); response.end(request.method === 'HEAD' ? '' : content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const c = await import('../../public/core.js'), bundle = await makeFixture(c), audit = await auditBundle(c, bundle, bundle);
    assert.equal(audit.counts.allStoreIds, 216); assert.equal(audit.counts.activeStoreIds, 215);
    assert.equal(audit.counts.conflicts, 1); assert.equal(audit.counts.pending, 1); assert.equal(audit.newOps, 0);
    for (const field of ['bundleUnchanged', 'originalOpsPreserved', 'storeDataAndHistoryUnchanged', 'visitTextAndHistoryUnchanged', 'sourceSnapshotsUnchanged', 'blobsUnchanged', 'attendanceUnchanged']) assert.equal(audit[field], true, field);
    assert.equal(audit.inventory.find(row => row.id === 'qa-text-conflict').expectedAttr, '');
    assert.equal(audit.inventory.find(row => row.id === 'qa-text-conflict').headCount, 2);
    assert.equal(audit.inventory.find(row => row.id === 'qa-text-contact').visits, 0);
    assert.equal(audit.inventory.find(row => row.id === 'qa-text-long').expectedAttr.length, 498);
    assert.equal(audit.inventory.find(row => row.id === 'qa-text-whitespace').expectedAttr, '');
    assert.equal(audit.inventory.find(row => row.id === 'qa-text-multi').visits, 3);
    assert.equal(audit.inventory.filter(row => row.name === '虛構同名藥局').length, 2);
    const changed = structuredClone(bundle); changed.ops.find(op => op.entity === 'qa-text-attr').data.attr += '!';
    const detect = await auditBundle(c, changed, bundle);
    assert.equal(detect.bundleUnchanged, false); assert.equal(detect.storeDataAndHistoryUnchanged, false); assert.deepEqual(detect.changedStoreIds, ['qa-text-attr']);
    const meta = c.newMeta(); meta.vaultId = bundle.vaultId;
    const key = await c.derive('fictional-self-test-password', meta);
    assert.deepEqual(await c.unseal(await c.seal(bundle, key, meta), key), bundle);
    const server = createFixtureServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const request = (pathname, method = 'GET', host = '127.0.0.1:' + PORT) => new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method, headers: { host } }, res => {
          const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers }));
        }); req.on('error', reject); req.end();
      });
      assert.equal((await request('/qa.html')).status, 200);
      const runtime = await request('/app.js'); assert.equal(runtime.body, await fs.readFile(path.join(publicDir, 'app.js'), 'utf8'));
      assert.equal((await request('/api/state')).status, 503);
      assert.equal((await request('/api/sync', 'POST')).status, 503);
      assert.equal((await request('/', 'GET', 'example.invalid')).status, 403);
      assert.equal((await request('/%2e%2e%2fpackage.json')).status, 403);
      assert.equal((await request('/qa.html', 'HEAD')).body, '');
    } finally { await new Promise(resolve => server.close(resolve)); }
    console.log(JSON.stringify({ ok: true, syntheticOnly: true, networkIsolationChecked: true, ...audit.counts, ops: audit.opsBefore, fingerprint: audit.beforeFingerprint }));
  } else createFixtureServer().listen(PORT, '127.0.0.1', () => console.log('Synthetic-only fixture: http://127.0.0.1:' + PORT + '/qa.html'));
}
