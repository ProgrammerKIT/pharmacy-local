// Fictional-only, isolated browser fixture. No production APIs or customer data.
// node test/qa/confirmed-insight-visibility-fixture.mjs --self-test
// node test/qa/confirmed-insight-visibility-fixture.mjs -> http://127.0.0.1:18873/qa.html
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { makeFixture as makeBaseFixture, auditBundle as auditBaseBundle } from './confirmed-insight-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const PORT = 18873;

export function makeFixture(c) {
  let bundle = makeBaseFixture(c);
  bundle.vaultId = 'synthetic-confirmed-insight-visibility-vault';
  const record = (type, id) => c.project(bundle).find(row => row.type === type && row.id === id);
  const append = (type, id, patch) => {
    const current = record(type, id);
    bundle.ops.push(c.revision(type, id, { ...current.heads[0].data, ...patch }, current.heads.map(head => head.id), 'synthetic-visibility-seed'));
  };
  const examples = [
    { id: 'current', quote: '虛構藥師希望先閱讀一張重點說明，再決定要不要深入討論。', headline: '第三張已確認：可先提供一張重點說明，再依需求展開', question: '今天是否仍偏好先閱讀重點，再補充細節？' },
    { id: 'same-text', quote: '虛構測試員表示下午比較有時間交流。', headline: '第四張已確認：下午較方便交流，來源新增同文版本', question: '目前下午仍是比較方便交流的時段嗎？' },
    { id: 'removed-quote', quote: '虛構測試員曾與晨光的陳示範藥師一起上課。', headline: '第五張已確認：曾一起上課，來源已更新需再次核對', question: '上次提到一起上課的經驗，是否方便補充當時課程？' }
  ];
  const entries = [];
  for (const item of examples) {
    const id = 'qa-visibility-note-' + item.id;
    const data = { store: 'qa-insight-a', date: '', text: '  僅供合成驗收。\r\n' + item.quote + '\r\n  原始空白與換行必須保留。  ', next: '', source: '完全虛構的來源版本：' + item.id, topics: [], people: [], attachments: [] };
    const attendance = item.id === 'current' ? c.makeVisitAttendance('qa-insight-a', '2026-10-14T02:00:00.000Z') : undefined;
    bundle.ops.push(c.revision('visit', id, data, [], 'synthetic-visibility-seed', false, attendance));
    entries.push({ id: 'qa-confirmed-' + item.id, kind: item.id === 'removed-quote' ? 'relationship' : 'customer', level: 'source', headline: item.headline,
      question: item.question, caution: '這是虛構驗收線索；保留原先人工確認，不代表來源更新後仍能直接定案。', limitations: ['此測試不包含真實門市或人物。'],
      evidence: [{ storeId: 'qa-insight-a', storeIdentityKey: c.storeInsightsIdentityKey(record('store', 'qa-insight-a')), visitId: id, revisionId: record('visit', id).heads[0].id, quote: item.quote, role: 'support' }] });
  }
  append('store', 'qa-insight-a', { preVisitInsights: { ...record('store', 'qa-insight-a').preVisitInsights, entries: [...record('store', 'qa-insight-a').preVisitInsights.entries, ...entries] } });
  for (const entry of entries) bundle = c.applyInsightReview(bundle, c.planInsightReview(bundle, 'qa-insight-a', entry.id, 'confirmed', record('store', 'qa-insight-a').heads[0].id), 'synthetic-visibility-review');
  append('visit', 'qa-visibility-note-same-text', {});
  append('visit', 'qa-visibility-note-removed-quote', { text: '來源已更新：這筆虛構記錄的目前版本不再含原本一起上課的那句話。\n必須依卡片引用的歷史版本查核，不能冒充目前原文。' });
  return c.validateBundle(bundle);
}

export async function auditBundle(c, bundle, original) {
  const result = await auditBaseBundle(c, bundle, original);
  const reviewData = value => c.project(value).filter(row => row.type === 'store').map(row => ({ id: row.id, reviews: row.preVisitInsightReviews ?? null })).sort((a, b) => a.id.localeCompare(b.id));
  const beforeReviews = await c.hashBytes(new TextEncoder().encode(JSON.stringify(reviewData(original))));
  const afterReviews = await c.hashBytes(new TextEncoder().encode(JSON.stringify(reviewData(bundle))));
  return { ...result, allReviewDataUnchanged: beforeReviews === afterReviews, reviewFingerprint: afterReviews, baselineReviewFingerprint: beforeReviews,
    display: c.project(bundle).filter(row => row.type === 'store').map(store => {
      const selected = c.storeInsightDisplayForStore(bundle, store.id);
      return { storeId: store.id, name: store.name, confirmedStaleCount: selected.confirmedStaleCount, hiddenStaleCount: selected.staleCount,
        cards: selected.entries.map(entry => ({ id: entry.id, headline: entry.headline, reviewStatus: c.insightReviewForEntry(store, entry).status,
          sourceCurrent: entry.sourceCurrent, sourceNotice: entry.sourceNotice, evidence: c.storeInsightEvidenceForEntry(bundle, entry).map(source => ({ revisionId: source.revisionId, historicalAvailable: source.historicalAvailable, sourceCurrent: source.sourceCurrent })) })) };
    }) };
}

function browserMain() {
  const output = document.getElementById('output');
  const baselineKey = 'synthetic-confirmed-visibility-baseline';
  const revisionKey = 'synthetic-confirmed-visibility-disk-revision';
  const metadataKey = 'synthetic-confirmed-visibility-device-metadata';
  const deviceMetadata = payload => ({ dirty: payload.dirty, serverVersion: payload.serverVersion, lastSync: payload.lastSync,
    lastHealthAudit: payload.lastHealthAudit ?? null, pendingSync: payload.pendingSync ?? null });
  const allowed = () => { if (location.origin !== 'http://127.0.0.1:18873') throw new Error('拒絕在專用測試 origin 以外執行'); };
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
    if (payload.qaOnly !== 'confirmed-insight-visibility-fictional-v1' || payload.bundle.vaultId !== 'synthetic-confirmed-insight-visibility-vault' || payload.token) throw new Error('非此專用虛構庫，拒絕讀取或輸出');
    return { slot, payload };
  };
  document.getElementById('seed').onclick = run(async () => {
    allowed(); if (await db.readLocal()) throw new Error('此測試 origin 已有資料，不覆蓋既有測試證據。請開啟 App 或唯讀檢查。');
    const meta = c.newMeta(); meta.vaultId = 'synthetic-confirmed-insight-visibility-vault';
    const key = await c.derive('fictional-visibility-password-only', meta), bundle = makeFixture(c);
    // A fresh fixture represents an already-opened device. Avoid unrelated weekly
    // health-audit initialization when measuring display-only IndexedDB writes.
    // Existing origins are still refused above; their original audit remains intact.
    const payload = { schema: 1, device: 'synthetic-confirmed-visibility-device', deviceName: '僅虛構洞見顯示驗收', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null,
      lastHealthAudit: new Date().toISOString(), pendingSync: { entities: [], unknown: false }, qaOnly: 'confirmed-insight-visibility-fictional-v1' };
    await db.writeLocal(await c.seal(payload, key, meta, 'device'), 0, key);
    localStorage.setItem(baselineKey, JSON.stringify(bundle));
    localStorage.setItem(revisionKey, JSON.stringify((await db.readLocal()).revision));
    localStorage.setItem(metadataKey, JSON.stringify(deviceMetadata(payload)));
    output.textContent = '已建立專用合成資料：青禾 5 張 Kit已確認（3 張來源有效、1 張同文新版本、1 張引用句已移除）；晨光 1 張待查核及 1 張不符合。兩間門市、5 筆原文、7 張卡、1 份實際拜訪確認皆為虛構。';
  });
  document.getElementById('audit').onclick = run(async () => {
    const { slot, payload } = await stored(), original = JSON.parse(localStorage.getItem(baselineKey) || 'null');
    if (!original || original.vaultId !== 'synthetic-confirmed-insight-visibility-vault') throw new Error('缺少有效測試基準');
    const baselineDiskRevision = JSON.parse(localStorage.getItem(revisionKey) || 'null');
    const baselineDeviceMetadata = JSON.parse(localStorage.getItem(metadataKey) || 'null'), currentDeviceMetadata = deviceMetadata(payload);
    output.textContent = JSON.stringify({ diskRevision: slot.revision, baselineDiskRevision, diskRevisionUnchanged: slot.revision === baselineDiskRevision,
      deviceMetadata: currentDeviceMetadata, baselineDeviceMetadata,
      deviceMetadataUnchanged: baselineDeviceMetadata ? JSON.stringify(currentDeviceMetadata) === JSON.stringify(baselineDeviceMetadata) : null,
      initializationNote: baselineDeviceMetadata ? '新種子已設定本機健檢時間與空的待同步追蹤，不需首次健檢初始化寫入。' : '舊版種子未設定 lastHealthAudit 與 pendingSync：App 首次開啟會保存定期健檢時間及空的待同步追蹤，使本機 revision 增加。此處保留原種子 revision 比對，不覆蓋基準；後續純瀏覽須與首次開啟後的 audit 再比較。',
      ...await auditBundle(c, payload.bundle, original) }, null, 2);
  });
}

const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>虛構確認線索與來源更新驗收</title><style>body{font:16px/1.6 system-ui;margin:24px;max-width:1050px}button,a{display:inline-block;padding:12px;margin:6px;min-height:44px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef5f5;padding:16px}strong{color:#a21}</style><h1>虛構確認線索與來源更新驗收</h1><p><strong>僅 127.0.0.1:18873；不接正式資料庫、Mac API 或外部服務。</strong></p><p>使用正式 App 靜態程式，門市、人物、原文、審核及日期全部為合成測試資料。此 origin 首次建立後不提供覆蓋或重設按鈕。</p><button id="seed">建立虛構測試資料</button><a href="/" target="_blank" rel="noopener">開啟測試 App</a><button id="audit">唯讀檢查測試結果</button><ol><li>青禾：5 張已確認標題都應直接可見，不能把第 3 張以後藏在「其他線索」。詳細內容預設收合。</li><li>第 4 張：來源新增同文字版本，仍顯示 Kit已確認及來源更新提醒。展開來源時明確標示所引用的歷史版本。</li><li>第 5 張：目前原文已移除引用句，已確認標題仍可見且提醒核對；歷史來源應是原引用文字，不可拿目前文字充當舊版本。</li><li>晨光：待查核照常可讀；「不符合」只留歷史，不可出現在日常線索區。</li><li>純瀏覽、搜尋、展開及收合後，bundleUnchanged、allReviewDataUnchanged、attendanceUnchanged、originalOpsPreserved 及 diskRevisionUnchanged 都應保持 true。</li></ol><pre id="output" aria-live="polite">尚未操作。只讀檢查通過 qaOnly 與 vaultId 核對的合成資料。</pre><script type="module" src="/qa-client.mjs"></script></html>`;
const client = `import * as c from '/core.js';import * as db from '/db.js';\nconst makeBaseFixture=${makeBaseFixture.toString()};\nconst auditBaseBundle=${auditBaseBundle.toString()};\n${makeFixture.toString()}\n${auditBundle.toString()}\n(${browserMain.toString()})();`;

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
      const content = await fs.readFile(realFile), mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': mime }); response.end(request.method === 'HEAD' ? '' : content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    const c = await import('../../public/core.js'), bundle = makeFixture(c), before = JSON.stringify(bundle), audit = await auditBundle(c, bundle, bundle);
    assert.equal(audit.bundleUnchanged, true); assert.equal(audit.allReviewDataUnchanged, true); assert.equal(audit.attendanceUnchanged, true);
    assert.equal(audit.currentOriginalNotesUnchanged, true); assert.equal(audit.originalOpsPreserved, true);
    const first = audit.display.find(store => store.storeId === 'qa-insight-a'), second = audit.display.find(store => store.storeId === 'qa-insight-b');
    assert.equal(first.cards.length, 5); assert.ok(first.cards.every(card => card.reviewStatus === 'confirmed'));
    assert.equal(first.confirmedStaleCount, 2); assert.equal(first.cards.filter(card => card.sourceCurrent).length, 3);
    assert.ok(first.cards.every(card => card.evidence.every(source => source.historicalAvailable)));
    assert.deepEqual(second.cards.map(card => card.reviewStatus), ['pending', 'rejected']);
    assert.equal(bundle.ops.filter(op => op.visitAttendance).length, 1);
    assert.equal(JSON.stringify(bundle), before);
    const meta = c.newMeta(); meta.vaultId = bundle.vaultId;
    const key = await c.derive('fictional-visibility-self-test', meta);
    assert.deepEqual(await c.unseal(await c.seal(bundle, key, meta), key), bundle);
    console.log(JSON.stringify({ ok: true, syntheticOnly: true, stores: audit.display.length, displayedProjectionCards: audit.display.reduce((total, store) => total + store.cards.length, 0), confirmedTitles: first.cards.length, confirmedStaleSources: first.confirmedStaleCount, originalOps: audit.opsBefore, fingerprint: audit.fingerprint }));
  } else createFixtureServer().listen(PORT, '127.0.0.1', () => console.log('Synthetic-only fixture: http://127.0.0.1:' + PORT + '/qa.html'));
}
