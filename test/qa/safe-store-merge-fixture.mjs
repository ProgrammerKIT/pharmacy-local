// Opt-in, fictional-only fixture UI. Never points at a running production App.
// Run: node test/qa/safe-store-merge-fixture.mjs
// Open http://127.0.0.1:18862/qa.html, seed, then follow the App link.
// Self-check (no server/browser): node test/qa/safe-store-merge-fixture.mjs --self-test
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const PORT = 18862;

export async function makeFixture(c) {
  const at = '2026-10-01T02:00:00.000Z', vaultId = 'synthetic-safe-merge-vault';
  let bundle = c.emptyBundle(vaultId);
  const store = (name, mapUrl) => ({ name, city: '虛構市', district: '測試區', address: '虛構市測試區合成路 123 號', mapUrl, channel: '', attr: '', contact: '', nextRemember: '', everyTimeMust: '虛構共同固定事項' });
  const note = (storeId, text) => ({ store: storeId, date: '', source: '合成資料，非客戶', text, next: '', topics: [], people: [], attachments: [] });
  const current = (type, id) => c.project(bundle).find(record => record.type === type && record.id === id);
  const append = (type, id, patch, deleted = false) => {
    const previous = current(type, id);
    const op = c.revision(type, id, { ...previous.heads[0].data, ...patch }, previous.heads.map(head => head.id), 'synthetic-device', deleted);
    bundle.ops.push(op); return op;
  };
  let keeper = c.addReminderTasks(store('虛構甲門市', 'https://www.google.com/maps/place/SyntheticA/data=!4m2!3m1!1s0xaaa:0x111'), '虛構主店待辦\n虛構主店已完成', at);
  keeper = c.completeReminderTask(keeper, keeper.nextRememberTasks[1].id, '2026-10-01T03:00:00.000Z');
  let donor = c.addReminderTasks(store('虛構乙門市', 'https://www.google.com/maps/place/SyntheticB/data=!4m2!3m1!1s0xaaa:0x222'), '虛構副店待辦\n虛構副店歷史完成', at);
  donor = c.completeReminderTask(donor, donor.nextRememberTasks[1].id, '2026-10-01T04:00:00.000Z');
  bundle.ops.push(c.revision('store', 'qa-keeper', keeper, [], 'synthetic-device', false, c.makeVisitAttendance('qa-keeper', at)));
  bundle.ops.push(c.revision('store', 'qa-donor', donor, [], 'synthetic-device', false, c.makeVisitAttendance('qa-donor', at)));
  bundle.ops.push(c.revision('store', 'qa-external', { ...store('虛構第三店', ''), address: '虛構市另一路 456 號' }, [], 'synthetic-device'));
  // Completed donor task remains only in an old store revision, not the current list.
  append('store', 'qa-donor', { nextRememberTasks: donor.nextRememberTasks.slice(0, 1) });
  const rawCSV = new TextEncoder().encode('name,note\r\nSynthetic,keep raw bytes\r\n');
  const sourceHash = await c.hashBytes(rawCSV); bundle.blobs[sourceHash] = c.b64(rawCSV);
  bundle.ops.push(c.revision('source', 'qa-source', { file: 'fictional.csv', list: 'Synthetic source', blob: sourceHash, batch: 'synthetic-batch', rows: 1, headers: ['name', 'note'], encoding: 'utf-8', delimiter: ',' }, [], 'synthetic-device'));
  bundle.ops.push(c.revision('visit', 'qa-note-1', { ...note('qa-keeper', '  虛構甲筆記：合成人物甲認識合成人物乙。\r\n所有換行與空白須原樣保留。  '), attachments: [{ blob: sourceHash, name: 'fictional.csv', mime: 'text/csv' }] }, [], 'synthetic-device'));
  bundle.ops.push(c.revision('visit', 'qa-note-2', note('qa-keeper', Array.from({ length: 12 }, (_, i) => '虛構長筆記第 ' + (i + 1) + ' 行：僅供手機排版測試。').join('\n')), [], 'synthetic-device'));
  bundle.ops.push(c.revision('visit', 'qa-donor-note', note('qa-donor', '虛構乙筆記：合成人物乙也認識合成人物甲。'), [], 'synthetic-device'));
  bundle.ops.push(c.revision('visit', 'qa-external-note', note('qa-external', '虛構第三店筆記：第三店同事提供合成佐證。'), [], 'synthetic-device'));
  bundle.ops.push(c.revision('visit', 'qa-deleted-note', note('qa-donor', '虛構回收桶筆記：不能復活，不能消失。'), [], 'synthetic-device'));
  append('visit', 'qa-deleted-note', {}, true);
  const evidence = (storeId, visitId, quote) => ({ storeId, storeIdentityKey: c.storeInsightsIdentityKey(current('store', storeId)), visitId, revisionId: current('visit', visitId).heads[0].id, quote, role: 'support' });
  const sources = {
    keeper: evidence('qa-keeper', 'qa-note-1', '合成人物甲認識合成人物乙。'),
    donor: evidence('qa-donor', 'qa-donor-note', '合成人物乙也認識合成人物甲。'),
    external: evidence('qa-external', 'qa-external-note', '第三店同事提供合成佐證。')
  };
  const entry = (id, label, supporting) => ({ id, kind: 'relationship', level: 'source', headline: '虛構線索：' + label, question: '合成查核問題，沒有真實人物。', caution: '測試資料，禁止作為客戶結論。', limitations: ['合成證據'], evidence: supporting });
  for (const [storeId, entries] of [
    ['qa-keeper', [entry('qa-confirmed', '主店已確認', [sources.keeper, sources.donor]), entry('qa-rejected', '主店不符合', [sources.keeper]), entry('qa-pending', '主店待查核', [sources.keeper])]],
    ['qa-donor', [entry('qa-donor-confirmed', '副店已確認', [sources.donor, sources.keeper]), entry('qa-donor-rejected', '副店不符合', [sources.donor])]],
    ['qa-external', [entry('qa-external-confirmed', '其他店引用主副店', [sources.external, sources.keeper, sources.donor])]]
  ]) append('store', storeId, { preVisitInsights: { format: 'pharmacy-store-insights-1', batchId: 'synthetic-insights', generatedAt: at, sourceAsOf: '2026-10-01', entries } });
  for (const [storeId, entryId, status] of [
    ['qa-keeper', 'qa-confirmed', 'confirmed'], ['qa-keeper', 'qa-rejected', 'rejected'],
    ['qa-donor', 'qa-donor-confirmed', 'confirmed'], ['qa-donor', 'qa-donor-rejected', 'rejected'],
    ['qa-external', 'qa-external-confirmed', 'confirmed']
  ]) bundle = c.applyInsightReview(bundle, c.planInsightReview(bundle, storeId, entryId, status, current('store', storeId).heads[0].id), 'synthetic-device');
  return c.validateBundle(bundle);
}

export async function auditBundle(c, bundle, original) {
  c.validateBundle(bundle);
  const encode = value => new TextEncoder().encode(JSON.stringify(value));
  const originalOps = new Map(original.ops.map(op => [op.id, op]));
  const currentOps = new Map(bundle.ops.map(op => [op.id, op]));
  const records = c.project(bundle), baselineRecords = c.project(original);
  const statuses = (b, rs) => rs.filter(r => r.type === 'store').map(store => ({
    id: store.id, name: store.name, deleted: store.deleted,
    cards: (store.preVisitInsights?.entries || []).map(entry => ({ id: entry.id, headline: entry.headline, status: c.insightReviewForEntry(store, entry).status })),
    validEvidenceIds: c.storeInsightsForStore(b, store.id).entries.map(entry => entry.id),
    reviewHistory: c.storeInsightReviewHistory(store).map(event => ({ id: event.id, status: event.status, reviewedAt: event.reviewedAt, historical: event.historical })),
    completedHistory: c.reminderTaskHistory(store)
  }));
  return {
    syntheticOnly: true, fingerprint: await c.hashBytes(encode(bundle)), initialFingerprint: await c.hashBytes(encode(original)),
    unchangedSinceSeed: JSON.stringify(bundle) === JSON.stringify(original),
    originalOpsPreserved: [...originalOps].every(([id, op]) => JSON.stringify(currentOps.get(id)) === JSON.stringify(op)),
    originalBlobsPreserved: Object.entries(original.blobs).every(([id, content]) => bundle.blobs[id] === content),
    noNewAttendance: bundle.ops.filter(op => !originalOps.has(op.id)).every(op => !op.visitAttendance),
    originalVisitTextPreserved: original.ops.filter(op => op.type === 'visit').every(op => currentOps.get(op.id)?.data.text === op.data.text),
    deletedNoteStillDeleted: records.find(r => r.id === 'qa-deleted-note')?.deleted === true,
    counts: { opsBefore: original.ops.length, opsAfter: bundle.ops.length, activeStores: records.filter(r => r.type === 'store' && !r.deleted).length, activeVisits: records.filter(r => r.type === 'visit' && !r.deleted).length },
    before: statuses(original, baselineRecords), after: statuses(bundle, records),
    currentFields: records.filter(r => ['store', 'visit'].includes(r.type)).map(r => ({ type: r.type, id: r.id, deleted: r.deleted, conflict: r.conflict, data: r.heads.map(head => head.data) })),
    allOps: bundle.ops
  };
}

function browserMain() {
  const output = document.getElementById('output');
  const run = fn => async () => { try { output.textContent = '處理中…'; await fn(); } catch (error) { output.textContent = 'ERROR: ' + error.message; } };
  const baselineKey = 'synthetic-safe-store-merge-baseline';
  const allowed = () => { if (location.origin !== 'http://127.0.0.1:18862') throw new Error('拒絕在測試 origin 以外執行'); };
  const stored = async () => {
    allowed(); const slot = await db.readLocal();
    if (!slot?.unlockKey) throw new Error('請先建立虛構測試資料');
    const payload = await c.unseal(slot.envelope, slot.unlockKey, 'device');
    if (payload.qaOnly !== 'safe-store-merge-fictional-v1') throw new Error('偵測到非本測試資料，拒絕讀取或覆寫');
    return { slot, payload };
  };
  const save = async (slot, payload) => db.writeLocal(await c.seal(payload, slot.unlockKey, slot.envelope, 'device'), slot.revision, slot.unlockKey);
  document.getElementById('seed').onclick = run(async () => {
    allowed(); const prior = await db.readLocal();
    if (prior) { await stored(); throw new Error('此測試 origin 已有虛構資料；重新種子前請用瀏覽器清除此專用測試 origin 的資料，避免覆蓋測試證據。'); }
    const meta = c.newMeta(); meta.vaultId = 'synthetic-safe-merge-vault';
    const key = await c.derive('fictional-qa-password-only', meta), bundle = await makeFixture(c);
    const payload = { schema: 1, device: 'synthetic-device', deviceName: '僅虛構合併測試', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, qaOnly: 'safe-store-merge-fictional-v1' };
    await db.writeLocal(await c.seal(payload, key, meta, 'device'), 0, key);
    localStorage.setItem(baselineKey, JSON.stringify(bundle));
    output.textContent = '虛構資料建立完成。主店 2 筆、副店 1 筆，另有回收桶筆記、任務歷史、分析與審核。請開啟測試 App。';
  });
  document.getElementById('audit').onclick = run(async () => {
    const { slot, payload } = await stored(), original = JSON.parse(localStorage.getItem(baselineKey) || 'null');
    if (!original) throw new Error('本測試缺少原始基準');
    output.textContent = JSON.stringify({ diskRevision: slot.revision, ...await auditBundle(c, payload.bundle, original) }, null, 2);
  });
  document.getElementById('concurrent').onclick = run(async () => {
    const { slot, payload } = await stored(), bundle = structuredClone(payload.bundle);
    const current = c.project(bundle).find(r => r.type === 'visit' && r.id === 'qa-note-2');
    bundle.ops.push(c.revision('visit', current.id, { ...current.heads[0].data, text: current.text + '\n虛構並行新增，舊合併預覽必須失效。' }, current.heads.map(head => head.id), 'synthetic-concurrent'));
    c.validateBundle(bundle); await save(slot, { ...payload, bundle, dirty: true });
    output.textContent = '已新增 1 個虛構並行版本。未重新讀取的 App 合併預覽必須拒絕提交。';
  });
  document.getElementById('backup').onclick = run(async () => {
    const { slot, payload } = await stored();
    const bytes = JSON.stringify({ format: 'pharmacy-backup-1', envelope: await c.seal(payload.bundle, slot.unlockKey, slot.envelope) });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })), a = document.createElement('a');
    a.href = url; a.download = 'synthetic-safe-merge.pharmabackup'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    output.textContent = '已產生虛構資料備份下載；此頁不寫入 App 資料。請在 App 合併預覽重新選檔驗證。';
  });
}

const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>虛構安全合併驗收</title><style>body{font:16px system-ui;margin:24px;max-width:1100px}button,a{display:inline-block;padding:12px;margin:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef5f5;padding:16px}strong{color:#a21}</style><h1>虛構安全合併驗收</h1><p><strong>僅 127.0.0.1:18862 專用測試。沒有正式資料、帳密或 Mac API。</strong></p><p>全部門市、人名、拜訪、審核、附件皆為合成資料。本頁僅透過公開 db.js 寫入此 origin 的測試 IndexedDB。</p><button id="seed">建立虛構測試資料</button><a href="/" target="_blank" rel="noopener">開啟測試 App</a><button id="audit">檢查測試結果</button><button id="backup">匯出虛構加密備份</button><button id="concurrent">新增虛構並行版本</button><p>保留主檔：虛構甲門市（qa-keeper）；併入：虛構乙門市（qa-donor）；測試正式名稱建議：虛構甲乙合併門市。</p><pre id="output" aria-live="polite">尚未操作。若已有本測試資料可直接檢查，種子按鈕不覆蓋任何既有資料。</pre><script type="module" src="/qa-client.mjs"></script></html>`;
const client = `import * as c from '/core.js';import * as db from '/db.js';\n${makeFixture.toString()}\n${auditBundle.toString()}\n(${browserMain.toString()})();`;

export function createFixtureServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'");
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(503, { 'Content-Type': 'application/json' }); return response.end('{"error":"Synthetic fixture: APIs and writes disabled"}'); }
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
    const c = await import('../../public/core.js'), fixture = await makeFixture(c), audit = await auditBundle(c, fixture, fixture);
    assert.equal(audit.originalOpsPreserved, true); assert.equal(audit.unchangedSinceSeed, true);
    assert.equal(audit.counts.activeStores, 3); assert.equal(audit.counts.activeVisits, 4);
    assert.equal(audit.deletedNoteStillDeleted, true);
    assert.equal(audit.before.find(s => s.id === 'qa-donor').completedHistory.length, 1);
    assert.equal(audit.before.find(s => s.id === 'qa-external').validEvidenceIds.length, 1);
    assert.deepEqual(audit.before.find(s => s.id === 'qa-keeper').cards.map(card => card.status), ['confirmed', 'rejected', 'pending']);
    const meta = c.newMeta(); meta.vaultId = fixture.vaultId;
    const key = await c.derive('fictional-self-test-password', meta);
    assert.deepEqual(await c.unseal(await c.seal(fixture, key, meta), key), fixture);
    console.log(JSON.stringify({ ok: true, syntheticOnly: true, ...audit.counts }));
  } else createFixtureServer().listen(PORT, '127.0.0.1', () => console.log('Synthetic-only fixture: http://127.0.0.1:' + PORT + '/qa.html'));
}
