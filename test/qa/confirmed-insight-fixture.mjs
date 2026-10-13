// Fictional-only, opt-in browser fixture. Never connects to production APIs.
// node test/qa/confirmed-insight-fixture.mjs --self-test
// node test/qa/confirmed-insight-fixture.mjs -> http://127.0.0.1:18867/qa.html
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const PORT = 18867;

export function makeFixture(c) {
  const at = '2026-10-14T01:00:00.000Z';
  let bundle = c.emptyBundle('synthetic-confirmed-insight-vault');
  const store = name => ({ name, city: '虛構市', district: '測試區', address: '', mapUrl: '', channel: '', attr: '', contact: '', nextRemember: '', everyTimeMust: '' });
  const record = (type, id) => c.project(bundle).find(row => row.type === type && row.id === id);
  const append = (id, patch) => {
    const current = record('store', id);
    bundle.ops.push(c.revision('store', id, { ...current.heads[0].data, ...patch }, current.heads.map(head => head.id), 'synthetic-seed'));
  };
  bundle.ops.push(c.revision('store', 'qa-insight-a', store('虛構青禾藥局'), [], 'synthetic-seed'));
  bundle.ops.push(c.revision('store', 'qa-insight-b', store('虛構晨光藥局'), [], 'synthetic-seed'));
  const notes = {
    a: '  虛構原始筆記：青禾的林測試藥師說晨光的陳示範藥師是以前同事。\r\n門市使用試用品做手背展示，但還不知道顧客後續反應。\r\n這段原文的空白和換行必須完整保留。  ',
    b: '虛構原始筆記：陳示範藥師說以前和青禾的林測試藥師共事。\n店員提過展示用途，但尚未詢問實際需求。\n曾猜測兩店會共同採購，後續已否認。'
  };
  for (const id of ['a', 'b']) bundle.ops.push(c.revision('visit', 'qa-insight-note-' + id, { store: 'qa-insight-' + id, date: '', text: notes[id], next: '', source: '完全虛構，非客戶資料', topics: [], people: [], attachments: [] }, [], 'synthetic-seed'));
  const source = (id, quote) => ({ storeId: 'qa-insight-' + id, storeIdentityKey: c.storeInsightsIdentityKey(record('store', 'qa-insight-' + id)), visitId: 'qa-insight-note-' + id, revisionId: record('visit', 'qa-insight-note-' + id).heads[0].id, quote, role: 'support' });
  const profile = entries => ({ format: 'pharmacy-store-insights-1', batchId: 'synthetic-confirmed-insights', generatedAt: at, sourceAsOf: '2026-10-14', entries });
  append('qa-insight-a', { preVisitInsights: profile([
    { id: 'qa-confirmed-relationship', kind: 'relationship', level: 'source', headline: '林測試與陳示範曾是同事，可從共同經驗開場', question: '這次可以問兩位過去共事時最熟悉哪一類門市服務？', caution: '同事關係不代表能代為介紹，也不代表目前仍有聯繫。', limitations: ['只保留虛構筆記記載的同事關係，其他關係仍未證實。'], evidence: [source('a', '青禾的林測試藥師說晨光的陳示範藥師是以前同事。'), source('b', '陳示範藥師說以前和青禾的林測試藥師共事。')] },
    { id: 'qa-confirmed-customer', kind: 'customer', level: 'inference', headline: '試用品用於展示，下一步了解顧客的實際回饋', question: '上次留下的展示試用品有使用嗎？顧客最常問什麼？', caution: '展示用途不能推論為療效或已帶動銷售。', limitations: ['目前只有展示用途記錄，沒有顧客結果或銷售數字。'], evidence: [source('a', '門市使用試用品做手背展示，但還不知道顧客後續反應。')] }
  ]) });
  append('qa-insight-b', { preVisitInsights: profile([
    { id: 'qa-pending-customer', kind: 'customer', level: 'inference', headline: '待查核：門市是否需要更多展示支援', question: '這次可以問展示時遇到什麼困難，是否需要示範？', caution: '尚未確認需求，不應視為需要新增物料。', limitations: ['只提過用途，沒有確認數量或頻率。'], evidence: [source('b', '店員提過展示用途，但尚未詢問實際需求。')] },
    { id: 'qa-rejected-relationship', kind: 'relationship', level: 'counter', headline: '不符合：兩店共同採購的猜測已否認', question: '保留這則已否認線索作為審核歷史。', caution: '不在日常拜訪提醒中顯示此猜測。', limitations: ['曾有猜測，不代表存在共同採購關係。'], evidence: [source('b', '曾猜測兩店會共同採購，後續已否認。')] }
  ]) });
  for (const [storeId, entryId, status] of [['qa-insight-a', 'qa-confirmed-relationship', 'confirmed'], ['qa-insight-a', 'qa-confirmed-customer', 'confirmed'], ['qa-insight-b', 'qa-rejected-relationship', 'rejected']]) {
    bundle = c.applyInsightReview(bundle, c.planInsightReview(bundle, storeId, entryId, status, record('store', storeId).heads[0].id), 'synthetic-review-seed');
  }
  return c.validateBundle(bundle);
}

export async function auditBundle(c, bundle, original) {
  c.validateBundle(bundle); c.validateBundle(original);
  const fingerprint = value => c.hashBytes(new TextEncoder().encode(JSON.stringify(value)));
  const records = c.project(bundle), baseline = c.project(original);
  const beforeOps = new Map(original.ops.map(op => [op.id, op])), afterOps = new Map(bundle.ops.map(op => [op.id, op]));
  const visits = rows => rows.filter(row => row.type === 'visit').map(row => ({ id: row.id, deleted: row.deleted, conflict: row.conflict, heads: row.heads })).sort((a, b) => a.id.localeCompare(b.id));
  const nonReviewStores = rows => rows.filter(row => row.type === 'store').map(row => {
    const data = structuredClone(row.heads[0].data); delete data.preVisitInsightReviews;
    return { id: row.id, deleted: row.deleted, conflict: row.conflict, data };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const [currentFingerprint, baselineFingerprint] = await Promise.all([fingerprint(bundle), fingerprint(original)]);
  return {
    syntheticOnly: true, fingerprint: currentFingerprint, baselineFingerprint,
    bundleUnchanged: currentFingerprint === baselineFingerprint,
    originalOpsPreserved: [...beforeOps].every(([id, op]) => JSON.stringify(afterOps.get(id)) === JSON.stringify(op)),
    currentOriginalNotesUnchanged: JSON.stringify(visits(records)) === JSON.stringify(visits(baseline)),
    currentNonReviewStoreDataUnchanged: JSON.stringify(nonReviewStores(records)) === JSON.stringify(nonReviewStores(baseline)),
    attendanceUnchanged: JSON.stringify(bundle.ops.filter(op => op.visitAttendance)) === JSON.stringify(original.ops.filter(op => op.visitAttendance)),
    opsBefore: original.ops.length, opsAfter: bundle.ops.length,
    stores: records.filter(row => row.type === 'store').map(store => ({ id: store.id, name: store.name, staleCount: c.storeInsightsForStore(bundle, store.id).staleCount, cards: c.storeInsightsForStore(bundle, store.id).entries.map(entry => ({ id: entry.id, kind: entry.kind, level: entry.level, headline: entry.headline, status: c.insightReviewForEntry(store, entry).status, reviewEvents: c.insightReviewForEntry(store, entry).history.length })) }))
  };
}

function browserMain() {
  const output = document.getElementById('output'), baselineKey = 'synthetic-confirmed-insight-baseline';
  const allowed = () => { if (location.origin !== 'http://127.0.0.1:18867') throw new Error('拒絕在專用測試 origin 以外執行'); };
  const run = fn => async () => {
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    try { output.textContent = '處理中…'; await fn(); }
    catch (error) { output.textContent = 'ERROR: ' + error.message; }
    finally { for (const button of document.querySelectorAll('button')) button.disabled = false; }
  };
  const stored = async () => {
    allowed(); const slot = await db.readLocal();
    if (!slot?.unlockKey) throw new Error('請先建立虛構測試資料');
    const payload = await c.unseal(slot.envelope, slot.unlockKey, 'device');
    if (payload.qaOnly !== 'confirmed-insight-fictional-v1' || payload.bundle.vaultId !== 'synthetic-confirmed-insight-vault' || payload.token) throw new Error('非此專用虛構庫，拒絕讀取、改動或輸出');
    return { slot, payload };
  };
  document.getElementById('seed').onclick = run(async () => {
    allowed(); if (await db.readLocal()) throw new Error('此測試 origin 已有資料，不覆蓋既有測試證據。請開啟 App 或唯讀檢查。');
    const meta = c.newMeta(); meta.vaultId = 'synthetic-confirmed-insight-vault';
    const key = await c.derive('fictional-confirmed-insight-password-only', meta), bundle = makeFixture(c);
    const payload = { schema: 1, device: 'synthetic-confirmed-insight-device', deviceName: '僅虛構已確認洞見驗收', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, qaOnly: 'confirmed-insight-fictional-v1' };
    await db.writeLocal(await c.seal(payload, key, meta, 'device'), 0, key);
    localStorage.setItem(baselineKey, JSON.stringify(bundle));
    output.textContent = '已建立 2 間虛構門市、2 筆原文、4 張有效卡。青禾有 2 張 Kit已確認；晨光有 1 張待查核及 1 張不符合。App 會以專用測試金鑰自動解鎖。';
  });
  document.getElementById('audit').onclick = run(async () => {
    const { slot, payload } = await stored(), original = JSON.parse(localStorage.getItem(baselineKey) || 'null');
    if (!original || original.vaultId !== 'synthetic-confirmed-insight-vault') throw new Error('缺少有效測試基準');
    output.textContent = JSON.stringify({ diskRevision: slot.revision, ...await auditBundle(c, payload.bundle, original) }, null, 2);
  });
}

const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>虛構已確認洞見卡驗收</title><style>body{font:16px/1.6 system-ui;margin:24px;max-width:1050px}button,a{display:inline-block;padding:12px;margin:6px;min-height:44px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef5f5;padding:16px}strong{color:#a21}</style><h1>虛構已確認洞見卡驗收</h1><p><strong>只接受 127.0.0.1:18867；無正式資料、無 Mac API、無外部服務。</strong></p><p>全部門市、人物、筆記與審核事件都是合成測試資料。只在首次建立，不覆蓋既有 IndexedDB。</p><button id="seed">建立虛構測試資料</button><a href="/" target="_blank" rel="noopener">開啟測試 App</a><button id="audit">唯讀檢查測試結果</button><ul><li>虛構青禾藥局：兩張 Kit已確認卡，分別為人物連結／原文記載、客群需求／待驗證推論。可驗證預設收合、展開詳細資訊、原文來源與修改審核入口。</li><li>虛構晨光藥局：一張待查核卡，一張不符合卡。可驗證待查核內容可讀、不符合留存於審核歷史，以及透過 App 人工審核後立即收合。</li><li>純瀏覽、展開及收合後，bundleUnchanged 應保持 true。若透過 App 明確變更審核狀態，原文與非審核門市資料仍應不變。</li></ul><pre id="output" aria-live="polite">尚未操作。檢查只讀取通過 qaOnly 核對的測試庫。</pre><script type="module" src="/qa-client.mjs"></script></html>`;
const client = `import * as c from '/core.js';import * as db from '/db.js';\n${makeFixture.toString()}\n${auditBundle.toString()}\n(${browserMain.toString()})();`;

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
    const c = await import('../../public/core.js'), bundle = makeFixture(c), before = await auditBundle(c, bundle, bundle);
    assert.equal(before.bundleUnchanged, true); assert.equal(before.currentOriginalNotesUnchanged, true); assert.equal(before.currentNonReviewStoreDataUnchanged, true);
    assert.deepEqual(before.stores.map(store => store.cards.map(card => card.status)), [['confirmed', 'confirmed'], ['pending', 'rejected']]);
    assert.ok(before.stores.every(store => store.staleCount === 0));
    const meta = c.newMeta(); meta.vaultId = bundle.vaultId;
    const key = await c.derive('fictional-self-test-password', meta);
    assert.deepEqual(await c.unseal(await c.seal(bundle, key, meta), key), bundle);
    console.log(JSON.stringify({ ok: true, syntheticOnly: true, stores: before.stores.length, cards: before.stores.reduce((total, store) => total + store.cards.length, 0), originalOps: before.opsBefore }));
  } else createFixtureServer().listen(PORT, '127.0.0.1', () => console.log('Synthetic-only fixture: http://127.0.0.1:' + PORT + '/qa.html'));
}
