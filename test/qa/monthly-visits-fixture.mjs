// Fictional-only browser QA. Does not contact production, Mac APIs, or external services.
// node test/qa/monthly-visits-fixture.mjs --self-test   (no server is started)
// node test/qa/monthly-visits-fixture.mjs              -> http://127.0.0.1:18869/qa.html
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const PORT = 18869;
const VAULT = 'synthetic-monthly-visits-vault';
const PASSWORD = 'fictional-monthly-visits-password-only';

export function fixtureCalendar(c, now = Date.now()) {
  const date = c.attendanceTaipeiDate(now), month = date.slice(0, 7);
  const shift = amount => {
    const value = new Date(month + '-01T00:00:00.000Z');
    value.setUTCMonth(value.getUTCMonth() + amount); return value.toISOString().slice(0, 7);
  };
  return { date, month, previous: shift(-1), next: shift(1), at: new Date(now).toISOString(),
    attendanceAt: new Date(date + 'T00:00:00+08:00').toISOString(), previousAt: new Date(shift(-1) + '-01T00:00:00+08:00').toISOString() };
}

export async function makeFixture(c, now = Date.now()) {
  const dates = fixtureCalendar(c, now), bundle = c.emptyBundle(VAULT);
  const membership = (month, active = true) => ({ month, active, updatedAt: dates.at });
  const both = () => [membership(dates.month), membership(dates.next)];
  const store = (name, extra = {}) => ({ name, city: '虛構市', district: '合成甲區', address: '', mapUrl: '', channel: '',
    attr: '  完全虛構的門市原文。\r\n保留換行及左右空白。  ', contact: '虛構窗口，非真實人物', nextRemember: '', everyTimeMust: '', ...extra });
  const add = (type, id, data, parents = [], attendance, deleted = false) => {
    const op = c.revision(type, id, data, parents, 'fictional-monthly-seed', deleted, attendance);
    if (!attendance) op.at = dates.at;
    bundle.ops.push(op); return op;
  };
  const note = (id, storeId, text, extra = {}, attendance) => add('visit', id, { store: storeId, date: '', source: '完全虛構月訪驗收',
    text, next: '', topics: [], people: [], attachments: [], ...extra }, [], attendance);
  const raw = new TextEncoder().encode('Title,Note\r\n"大樹藥局－虛構青禾店","  preserve spaces and CRLF  "\r\n');
  const blob = await c.hashBytes(raw); bundle.blobs[blob] = c.b64(raw);
  add('source', 'qa-month-source', { file: 'fictional-monthly-visits.csv', list: 'Fictional monthly source', blob,
    batch: 'qa-monthly', rows: 1, headers: ['Title', 'Note'], encoding: 'utf-8', delimiter: ',' });
  const csvSources = [{ file: 'fictional-monthly-visits.csv', fingerprint: blob, batch: 'qa-monthly', list: 'Fictional monthly source',
    at: dates.at, blob, sourceSnapshot: 'qa-month-source', line: 2, headers: ['Title', 'Note'], cells: ['大樹藥局－虛構青禾店', '  preserve spaces and CRLF  '] }];

  add('store', 'qa-month-tree-done', store('大樹藥局－虛構青禾店', { channel: '大樹', monthlyVisits: both(), csvSources }));
  const originalNote = note('qa-month-tree-done-note', 'qa-month-tree-done', '  虛構原始拜訪舊版。\r\n不得因調整每月名單而改寫。  ',
    { csvSources, attachments: [{ blob, name: 'fictional-monthly-visits.csv', mime: 'text/csv' }] }, c.makeVisitAttendance('qa-month-tree-done', dates.attendanceAt));
  add('visit', originalNote.entity, { ...originalNote.data, text: '  虛構目前拜訪原文。\r\n這個普通修改版本沒有再次確認實際拜訪。  ' }, [originalNote.id]);
  add('store', 'qa-month-tree-pending', store('大樹藥局－虛構晨光店', { channel: '大樹', monthlyVisits: both(), nextRemember: '虛構試用品 1 份', everyTimeMust: '虛構例行事項' }));
  note('qa-month-tree-pending-note', 'qa-month-tree-pending', '虛構待拜訪文字，可由 App 正常修改後核對前後差異。');
  add('store', 'qa-month-you-note-only', store('佑全藥局－虛構晴川店', { channel: '佑全健康人生', monthlyVisits: both() }));
  note('qa-month-you-note-only-note', 'qa-month-you-note-only', '今天新增筆記不代表實際拜訪，仍須待訪。', { date: dates.date });
  add('store', 'qa-month-independent-task', store('虛構獨立山河藥局', { monthlyVisits: [membership(dates.month)], district: '合成乙區',
    nextRememberTasks: [{ id: 'qa-month-task-done', text: '虛構已完成任務，不能算拜訪', createdAt: dates.previousAt, completedAt: dates.attendanceAt }] }));

  add('store', 'qa-month-same-a', store('虛構同名藥局', { monthlyVisits: both(), address: '虛構市甲路 1 號' }), [], c.makeVisitAttendance('qa-month-same-a', dates.attendanceAt));
  add('store', 'qa-month-same-b', store('虛構同名藥局', { monthlyVisits: both(), district: '合成乙區', address: '虛構市乙路 2 號' }));
  note('qa-month-same-a-note', 'qa-month-same-a', '同名甲店原文，只屬於甲店 ID。');
  note('qa-month-same-b-note', 'qa-month-same-b', '同名乙店原文，只屬於乙店 ID。');
  const removed = add('store', 'qa-month-removed', store('虛構已移除月訪店', { monthlyVisits: both() }));
  add('store', removed.entity, { ...removed.data, monthlyVisits: [membership(dates.month, false), membership(dates.next)] }, [removed.id]);
  const deleted = add('store', 'qa-month-deleted', store('虛構回收桶月訪店', { monthlyVisits: both() }));
  add('store', deleted.entity, deleted.data, [deleted.id], undefined, true);
  const conflict = add('store', 'qa-month-conflict', store('虛構版本衝突月訪店', { monthlyVisits: both() }));
  add('store', conflict.entity, { ...conflict.data, monthlyVisits: [membership(dates.month, false), membership(dates.next)] }, [conflict.id]);
  add('store', conflict.entity, { ...conflict.data, contact: '另一個虛構分支窗口' }, [conflict.id]);
  add('store', 'qa-month-pending-identity', store('虛構身分待確認月訪店', { monthlyVisits: both(), csvIdentityPending: true }));
  add('store', 'qa-month-candidate', store('虛構可新增獨立店', { district: '合成乙區' }));
  add('store', 'qa-month-prior-attendance', store('虛構上月拜訪店', { monthlyVisits: both() }), [], c.makeVisitAttendance('qa-month-prior-attendance', dates.previousAt));
  const history = add('store', 'qa-month-historical-attendance', store('健康人生藥局－虛構歷史拜訪確認店', { channel: '佑全健康人生', monthlyVisits: both() }), [], c.makeVisitAttendance('qa-month-historical-attendance', dates.attendanceAt));
  add('store', history.entity, { ...history.data, contact: '後續普通修改窗口，不重複建立拜訪' }, [history.id]);
  add('store', 'qa-month-next-only', store('虛構僅下月必訪店', { monthlyVisits: [membership(dates.next)] }));
  add('store', 'qa-month-long-name', store('大樹藥局－虛構超長名稱手機換行驗收門市－同一張卡片的移除按鈕必須始終可操作', { channel: '大樹', monthlyVisits: [membership(dates.month)], district: '合成乙區' }));
  return c.validateBundle(bundle);
}

export function inventory(c, bundle, now = Date.now()) {
  const dates = fixtureCalendar(c, now), records = c.project(bundle), visits = records.filter(row => row.type === 'visit' && !row.deleted);
  return records.filter(row => row.type === 'store').map(store => {
    const unavailable = store.deleted ? '回收桶' : store.conflict ? '版本衝突' : store.csvIdentityPending ? '身分待確認' : store.mergedInto ? '已整併' : '';
    const attendance = c.visitAttendanceForStore(bundle, store.id, now), inMonth = month => attendance.history.filter(item => item.date.startsWith(month + '-')).map(item => item.date);
    const entry = month => store.monthlyVisits?.find(item => item.month === month);
    return { id: store.id, name: store.name, address: store.address, channel: store.channel || '獨立門市', unavailable,
      thisMonthActive: !store.conflict && entry(dates.month)?.active === true, nextMonthActive: !store.conflict && entry(dates.next)?.active === true,
      currentMonthDates: inMonth(dates.month), previousMonthDates: inMonth(dates.previous), visits: visits.filter(row => row.store === store.id).length,
      versions: store.versions.length, headCount: store.heads.length,
      expected: unavailable ? unavailable + '：不可直接修改月訪名單，不能代選版本或身分' : entry(dates.month)?.active !== true ? '不列入本月待訪；可用新增按鈕加入' : inMonth(dates.month).length ? '本月已拜訪，依保留版本中的實際拜訪確認自動勾選' : '本月待拜訪；筆記日期或已完成任務不算拜訪' };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export async function auditBundle(c, bundle, original, now = Date.now()) {
  c.validateBundle(bundle); c.validateBundle(original);
  if (bundle.vaultId !== VAULT || original.vaultId !== VAULT) throw new Error('僅允許此專用虛構庫');
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const hash = value => c.hashBytes(new TextEncoder().encode(JSON.stringify(value)));
  const [beforeFingerprint, afterFingerprint] = await Promise.all([hash(original), hash(bundle)]);
  const before = new Map(original.ops.map(op => [op.id, op])), after = new Map(bundle.ops.map(op => [op.id, op]));
  const newOps = bundle.ops.filter(op => !before.has(op.id)), subset = (value, type) => value.ops.filter(op => op.type === type);
  const otherFields = data => { const copy = structuredClone(data); delete copy.monthlyVisits; return copy; };
  const monthlyOnly = op => op.type === 'store' && !op.deleted && !op.visitAttendance && op.parents.length === 1 &&
    after.has(op.parents[0]) && equal(otherFields(op.data), otherFields(after.get(op.parents[0]).data));
  const originalOpsPreserved = [...before].every(([id, op]) => equal(op, after.get(id)));
  const sourceSnapshotsUnchanged = equal(subset(original, 'source'), subset(bundle, 'source')), blobsUnchanged = equal(original.blobs, bundle.blobs);
  const blobChecks = await Promise.all(Object.entries(bundle.blobs).map(async ([id, value]) => ({ id, sha256Matches: await c.hashBytes(c.unb64(value)) === id })));
  const rows = inventory(c, bundle, now), available = rows.filter(row => !row.unavailable), members = available.filter(row => row.thisMonthActive);
  return { syntheticOnly: true, calendar: fixtureCalendar(c, now), beforeFingerprint, afterFingerprint, bundleUnchanged: beforeFingerprint === afterFingerprint,
    opsBefore: original.ops.length, opsAfter: bundle.ops.length, newOps: newOps.length, originalOpsPreserved,
    visitTextAndHistoryUnchanged: equal(subset(original, 'visit'), subset(bundle, 'visit')), sourceSnapshotsUnchanged, blobsUnchanged,
    attendanceUnchanged: equal(original.ops.filter(op => op.visitAttendance), bundle.ops.filter(op => op.visitAttendance)),
    newAttendanceCount: newOps.filter(op => op.visitAttendance).length, allNewRevisionsOnlyMonthlyMembership: newOps.every(monthlyOnly),
    monthlyOnlyChange: originalOpsPreserved && sourceSnapshotsUnchanged && blobsUnchanged && newOps.every(monthlyOnly),
    monthlyRevisionIds: newOps.filter(monthlyOnly).map(op => op.id), nonMonthlyRevisionIds: newOps.filter(op => !monthlyOnly(op)).map(op => op.id),
    sourceBlobHashesMatch: blobChecks.every(row => row.sha256Matches), sourceBlobHashes: blobChecks,
    counts: { allStoreIds: rows.length, availableStoreIds: available.length, unavailableStoreIds: rows.filter(row => row.unavailable).length,
      thisMonthMembers: members.length, thisMonthCompleted: members.filter(row => row.currentMonthDates.length).length,
      thisMonthPending: members.filter(row => !row.currentMonthDates.length).length, nextMonthMembers: available.filter(row => row.nextMonthActive).length }, inventory: rows };
}

function browserMain() {
  const output = document.getElementById('output'), baselineKey = 'synthetic-monthly-visits-baseline';
  const allowed = () => { if (location.origin !== 'http://127.0.0.1:18869') throw new Error('拒絕在專用虛構 origin 以外操作'); };
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
    if (payload.qaOnly !== 'monthly-visits-fictional-v1' || payload.bundle.vaultId !== VAULT || payload.token) throw new Error('不屬於此專用虛構庫，拒絕讀取或輸出');
    return { slot, payload };
  };
  const original = () => {
    const value = JSON.parse(localStorage.getItem(baselineKey) || 'null');
    if (!value || value.vaultId !== VAULT) throw new Error('缺少正確虛構基準'); return value;
  };
  const showInventory = rows => {
    const tbody = document.getElementById('inventory-body'); tbody.replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr'); tr.dataset.storeId = row.id;
      for (const value of [row.id, row.name + (row.address ? '\n' + row.address : ''), row.channel, row.thisMonthActive ? '本月已加入' : '本月未加入', row.nextMonthActive ? '下月已加入' : '下月未加入', row.currentMonthDates.join('、') || '無', row.expected]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      tbody.append(tr);
    }
  };
  document.getElementById('seed').onclick = run(async () => {
    allowed(); if (await db.readLocal()) throw new Error('此獨立 origin 已有資料，拒絕覆蓋。請開啟 App 或執行唯讀檢查。');
    const meta = c.newMeta(); meta.vaultId = VAULT;
    const key = await c.derive(PASSWORD, meta), bundle = await makeFixture(c);
    const payload = { schema: 1, device: 'synthetic-monthly-visits-device', deviceName: '僅虛構每月拜訪驗收', token: null, bundle,
      dirty: false, serverVersion: 0, lastSync: null, qaOnly: 'monthly-visits-fictional-v1' };
    await db.writeLocal(await c.seal(payload, key, meta, 'device'), 0, key);
    localStorage.setItem(baselineKey, JSON.stringify(bundle));
    const audit = await auditBundle(c, bundle, bundle); showInventory(audit.inventory); output.textContent = JSON.stringify(audit, null, 2);
  });
  document.getElementById('audit').onclick = run(async () => {
    const { slot, payload } = await stored(), audit = await auditBundle(c, payload.bundle, original());
    showInventory(audit.inventory); output.textContent = JSON.stringify({ diskRevision: slot.revision, ...audit }, null, 2);
  });
  document.getElementById('roundtrip').onclick = run(async () => {
    const { slot, payload } = await stored();
    const document = JSON.stringify({ format: 'pharmacy-backup-1', envelope: await c.seal(payload.bundle, slot.unlockKey, slot.envelope) });
    const parsed = JSON.parse(document), reopened = c.validateBundle(await c.unseal(parsed.envelope, slot.unlockKey));
    const audit = await auditBundle(c, reopened, payload.bundle);
    output.textContent = JSON.stringify({ encryptionRoundTrip: audit.bundleUnchanged && audit.originalOpsPreserved, backupBytes: new TextEncoder().encode(document).length,
      ...audit, notice: '只在記憶體建立、序列化、重新解密備份；未匯入、還原或修改 App 資料。' }, null, 2);
  });
  document.getElementById('check-backup').onclick = run(async () => {
    const file = document.getElementById('backup-file').files[0];
    if (!file || file.size > 40 * 1024 * 1024) throw new Error('請選取此虛構 App 匯出的加密備份（上限 40 MB）');
    const parsed = JSON.parse(await file.text());
    if (parsed.format !== 'pharmacy-backup-1' || parsed.envelope?.vaultId !== VAULT) throw new Error('只接受此虛構庫備份；拒絕解密其他資料庫');
    const { slot, payload } = await stored(), reopened = c.validateBundle(await c.unseal(parsed.envelope, slot.unlockKey));
    output.textContent = JSON.stringify({ file: file.name, ...await auditBundle(c, reopened, payload.bundle), notice: '只核對所選備份與目前虛構 App 資料，不會匯入或還原。' }, null, 2);
  });
}

const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>虛構每月拜訪驗收</title><style>body{font:16px/1.6 system-ui;margin:24px;max-width:1400px}button,a{display:inline-block;padding:12px;margin:6px;min-height:44px}pre,td{white-space:pre-wrap;overflow-wrap:anywhere}pre{background:#eef5f5;padding:16px}strong{color:#a21}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #cbd4df;padding:10px;text-align:left;vertical-align:top}.inventory{overflow:auto}input{max-width:100%}</style><h1>虛構每月拜訪驗收</h1><p><strong>僅 127.0.0.1:18869；所有門市、人物及文字完全虛構。沒有正式庫、Mac API 或外部服務。</strong></p><p>此頁只在空 origin 首次建立加密合成庫。正式操作請使用下方 App 入口；其餘按鈕只讀取核驗資料，不注入 App runtime 或模擬點擊後的結果。</p><p>虛構測試密碼：<code>fictional-monthly-visits-password-only</code>。目前月份依建立時的臺北日期計算；請以新瀏覽器分頁開啟 App。</p><button id="seed">首次建立虛構測試資料</button><a href="/" target="_blank" rel="noopener">開啟真實 App 程式驗收</a><button id="audit">唯讀核對資料與名單</button><button id="roundtrip">唯讀驗證加密備份往返</button><h2>正常 App 驗收步驟</h2><ol><li>先首次建立虛構資料，再開啟 App。檢查「拜訪」首頁沒有每月清單；「每月拜訪」有獨立入口，依既有固定 iPhone Pro 版面，主驗 393×852、402×874 與桌面 1280×900；檢查操作元件與文字完整呈現。既有 viewport 與 body 最小寬度為 393 px，不宣稱 320 px 無溢位。</li><li>本月初始有 9 間可用必訪店，其中 3 間有本月實際拜訪確認、6 間尚待拜訪。來源舊版與後續普通修改均保留。同名甲、乙店不能互相勾選。</li><li>新增「虛構可新增獨立店」到本月；切下月應仍未加入。移除本月「大樹藥局－虛構晨光店」；下月的同店保持已加入。切回本月可重新加入；先測取消移除，再測確定移除。</li><li>筆記日期為今天、已完成任務、上月的實際拜訪，都不能算本月完成。「虛構僅下月必訪店」與已移除門市不應混入本月名單。</li><li>用 App 正常開啟晨光店，修改虛構拜訪文字，先不勾實際拜訪確認而儲存，月訪仍未完成；再次正常修改，勾選實際拜訪並確認，才自動完成本月。重開或重新整理後結果保持。</li><li>月訪名單的移除與新增，不修改門市原文、既有拜訪原文或歷史，也不新增實際拜訪確認。衝突、回收桶、身分待確認資料不能被偷偷代選或復活。</li><li>純瀏覽後 bundleUnchanged 應為 true；只增刪月訪名單後 monthlyOnlyChange 應為 true、newAttendanceCount 應為 0。刻意修改筆記或確認拜訪後 nonMonthlyRevisionIds 會列出該操作，originalOpsPreserved 仍須為 true。</li><li>完成後回此頁執行唯讀 audit 與加密備份往返；也可由 App 正常匯出備份，再選到本頁只讀比對。不驗證正式資料、不從 fixture 還原。</li></ol><h2>逐店預期值</h2><div class="inventory"><table><thead><tr><th>ID</th><th>虛構名稱／地址</th><th>體系</th><th>本月名單</th><th>下月名單</th><th>本月確認拜訪</th><th>預期</th></tr></thead><tbody id="inventory-body"></tbody></table></div><h2>唯讀核對由 App 匯出的虛構備份</h2><input id="backup-file" type="file" accept=".pharmabackup,application/octet-stream,application/json"><button id="check-backup">只讀比對所選虛構備份</button><h2>核驗結果與 SHA-256</h2><pre id="output" aria-live="polite">尚未操作</pre><script type="module" src="/qa-client.mjs"></script></html>`;
const client = `import * as c from '/core.js';import * as db from '/db.js';const VAULT=${JSON.stringify(VAULT)},PASSWORD=${JSON.stringify(PASSWORD)};\n${fixtureCalendar.toString()}\n${makeFixture.toString()}\n${inventory.toString()}\n${auditBundle.toString()}\n(${browserMain.toString()})();`;

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
      // Serve the real runtime's release header so its service worker can verify
      // these local assets. No update/state/sync API is emulated by this fixture.
      const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
      if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid package version');
      response.writeHead(200, { 'Content-Type': mime, 'X-Pharmacy-Version': version }); response.end(request.method === 'HEAD' ? '' : content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const c = await import('../../public/core.js'), now = Date.parse('2026-10-15T03:00:00.000Z');
    const bundle = await makeFixture(c, now), audit = await auditBundle(c, bundle, bundle, now);
    assert.deepEqual(audit.counts, { allStoreIds: 15, availableStoreIds: 12, unavailableStoreIds: 3, thisMonthMembers: 9, thisMonthCompleted: 3, thisMonthPending: 6, nextMonthMembers: 9 });
    for (const field of ['bundleUnchanged', 'originalOpsPreserved', 'visitTextAndHistoryUnchanged', 'sourceSnapshotsUnchanged', 'blobsUnchanged', 'attendanceUnchanged', 'monthlyOnlyChange', 'sourceBlobHashesMatch']) assert.equal(audit[field], true, field);
    for (const id of ['qa-month-you-note-only', 'qa-month-independent-task', 'qa-month-same-b', 'qa-month-prior-attendance']) assert.deepEqual(audit.inventory.find(row => row.id === id).currentMonthDates, [], id);
    assert.equal(audit.inventory.find(row => row.id === 'qa-month-same-a').currentMonthDates.length, 1);
    assert.equal(audit.inventory.find(row => row.id === 'qa-month-tree-done').currentMonthDates.length, 1);
    assert.equal(audit.inventory.find(row => row.id === 'qa-month-historical-attendance').currentMonthDates.length, 1);
    assert.equal(audit.inventory.find(row => row.id === 'qa-month-conflict').headCount, 2);
    assert.equal(fixtureCalendar(c, Date.parse('2026-12-31T16:00:00.000Z')).month, '2027-01');
    const monthly = structuredClone(bundle), record = c.project(monthly).find(row => row.id === 'qa-month-tree-pending');
    const data = structuredClone(record.heads[0].data); data.monthlyVisits.find(entry => entry.month === '2026-10').active = false;
    monthly.ops.push(c.revision('store', record.id, data, [record.heads[0].id], 'fictional-monthly-test'));
    const changed = await auditBundle(c, monthly, bundle, now);
    assert.equal(changed.monthlyOnlyChange, true); assert.equal(changed.newOps, 1); assert.equal(changed.newAttendanceCount, 0);
    assert.equal(changed.counts.thisMonthMembers, 8); assert.equal(changed.counts.nextMonthMembers, 9);
    const corrupt = structuredClone(monthly); corrupt.ops[0].data.list += ' changed';
    const detected = await auditBundle(c, corrupt, bundle, now); assert.equal(detected.originalOpsPreserved, false); assert.equal(detected.sourceSnapshotsUnchanged, false); assert.equal(detected.monthlyOnlyChange, false);
    const marked = structuredClone(monthly), head = c.project(marked).find(row => row.id === 'qa-month-tree-pending').heads[0];
    marked.ops.push(c.revision('store', head.entity, head.data, [head.id], 'fictional-monthly-test', false, c.makeVisitAttendance(head.entity, '2026-10-15T02:00:00.000Z')));
    const attendanceAudit = await auditBundle(c, marked, bundle, now); assert.equal(attendanceAudit.monthlyOnlyChange, false); assert.equal(attendanceAudit.originalOpsPreserved, true); assert.equal(attendanceAudit.newAttendanceCount, 1);
    const meta = c.newMeta(); meta.vaultId = VAULT; const key = await c.derive(PASSWORD, meta);
    const serialized = JSON.stringify({ format: 'pharmacy-backup-1', envelope: await c.seal(monthly, key, meta) });
    const reopened = c.validateBundle(await c.unseal(JSON.parse(serialized).envelope, key)); assert.deepEqual(reopened, monthly);
    assert.equal((await auditBundle(c, reopened, monthly, now)).bundleUnchanged, true);
    // Parse the generated client without executing it or touching any browser.
    assert.match(client, /function fixtureCalendar/); assert.match(client, /function makeFixture/); assert.match(client, /function auditBundle/);
    new Function(client.slice(client.indexOf('const VAULT=')));
    // Exercise the real request handler with in-memory requests. Never bind a port.
    const server = createFixtureServer();
    const request = (url, method = 'GET', host = '127.0.0.1:' + PORT) => new Promise(resolve => {
      let status = 200; const headers = {};
      server.emit('request', { url, method, headers: { host } }, { setHeader: (key, value) => { headers[key] = value; },
        writeHead: (code, values = {}) => { status = code; Object.assign(headers, values); },
        end: value => resolve({ status, body: value === undefined ? '' : value.toString(), headers }) });
    });
    assert.equal((await request('/qa.html')).status, 200);
    assert.equal((await request('/qa-client.mjs')).body, client);
    const runtime = await request('/app.js');
    assert.equal(runtime.body, await fs.readFile(path.join(publicDir, 'app.js'), 'utf8'));
    const runtimeVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
    assert.equal(runtime.headers['X-Pharmacy-Version'], runtimeVersion);
    assert.equal((await request('/sw.js')).headers['X-Pharmacy-Version'], runtimeVersion);
    assert.equal((await request('/', 'HEAD')).headers['X-Pharmacy-Version'], runtimeVersion);
    const apiState = await request('/api/state'); assert.equal(apiState.status, 503); assert.equal(apiState.headers['X-Pharmacy-Version'], undefined);
    assert.equal((await request('/api/sync', 'POST')).status, 503);
    assert.equal((await request('/', 'GET', 'example.invalid')).status, 403);
    assert.equal((await request('/%2e%2e%2fpackage.json')).status, 403);
    assert.equal((await request('/qa.html', 'HEAD')).body, '');
    assert.equal(server.listening, false);
    console.log(JSON.stringify({ ok: true, syntheticOnly: true, serverStarted: false, requestIsolationChecked: true, encryptedBackupRoundTrip: true, ...audit.counts, ops: audit.opsBefore }));
  } else createFixtureServer().listen(PORT, '127.0.0.1', () => console.log('Synthetic-only fixture: http://127.0.0.1:' + PORT + '/qa.html'));
}
