// Entirely fictional, isolated QA. Never reads the production vault or service.
// node test/qa/shared-relation-fixture.mjs --self-test
// node test/qa/shared-relation-fixture.mjs -> http://127.0.0.1:18874/qa.html
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public'), PORT = 18874;

export async function makeUnmappedFixture(c) {
  let bundle = c.emptyBundle('synthetic-shared-relation-vault');
  const at = '2026-10-16T01:00:00.000Z';
  const names = { a: '虛構青禾藥局', b: '虛構晨光藥局', c: '虛構雲杉藥局', d: '虛構海風藥局' };
  const notes = {
    a: '  僅虛構驗收：林測試、陳示範與王合成藥師曾同在模擬藥局共事。\r\n空白與換行不可改寫。  ',
    b: '僅虛構驗收：陳示範說林測試和王合成是以前的同事。\n門市曾提過展示用途，需求尚待查核。\n先前共同採購的猜測已被否認。',
    c: '僅虛構驗收：王合成提過曾和林測試、陳示範共事。',
    d: '僅虛構驗收：海風的李範例只提過另一位同名林測試，尚不確定身分。'
  };
  const get = (type, id) => c.project(bundle).find(row => row.type === type && row.id === id);
  for (const id of Object.keys(names)) {
    bundle.ops.push(c.revision('store', 'qa-shared-' + id, { name: names[id], city: '虛構市', district: '合成區', address: '虛構市合成區測試路 ' + id, mapUrl: '', channel: '', attr: '', contact: '', nextRemember: '', everyTimeMust: '虛構固定事項，原樣保留' }, [], 'synthetic-shared-seed'));
    bundle.ops.push(c.revision('visit', 'qa-shared-note-' + id, { store: 'qa-shared-' + id, date: '', text: notes[id], next: '', source: '虛構原始來源 ' + id, topics: [], people: [], attachments: [] }, [], 'synthetic-shared-seed', false,
      id === 'a' ? c.makeVisitAttendance('qa-shared-a', at) : undefined));
  }
  const bytes = new TextEncoder().encode('name,note\r\nSynthetic,untouched source bytes\r\n'), hash = await c.hashBytes(bytes);
  bundle.blobs[hash] = c.b64(bytes);
  bundle.ops.push(c.revision('source', 'qa-shared-source', { file: 'synthetic-shared-source.csv', list: 'Synthetic source', blob: hash, batch: 'synthetic-shared-batch', rows: 1, headers: ['name', 'note'], encoding: 'utf-8', delimiter: ',' }, [], 'synthetic-shared-seed'));
  const quotes = {
    a: '林測試、陳示範與王合成藥師曾同在模擬藥局共事。',
    b: '陳示範說林測試和王合成是以前的同事。',
    c: '王合成提過曾和林測試、陳示範共事。',
    d: '海風的李範例只提過另一位同名林測試，尚不確定身分。'
  };
  const source = (id, quote = quotes[id]) => ({ storeId: 'qa-shared-' + id, storeIdentityKey: c.storeInsightsIdentityKey(get('store', 'qa-shared-' + id)), visitId: 'qa-shared-note-' + id, revisionId: get('visit', 'qa-shared-note-' + id).heads[0].id, quote, role: 'support' });
  const entry = (id, owner, headline) => ({ id, kind: 'relationship', level: 'source', headline,
    question: '這次可以從過去共事的共同經驗開始談嗎？', caution: '舊同事不等於目前仍聯繫，也不代表能代為介紹。', limitations: ['門市、人物與關係全部是合成測試資料。'],
    evidence: owner === 'd' ? [source('d')] : [source(owner), ...['a', 'b', 'c'].filter(id => id !== owner).map(id => source(id))] });
  const cards = {
    a: [entry('qa-shared-relation-a', 'a', '林測試與陳示範、王合成曾共事，可從共同經驗開場')],
    b: [entry('qa-shared-relation-b', 'b', '陳示範的舊同事是林測試與王合成')],
    c: [entry('qa-shared-relation-c', 'c', '王合成與林測試、陳示範有過共事經驗')],
    // Same card ID as A is deliberately NOT a relation mapping or an identity match.
    d: [entry('qa-shared-relation-a', 'd', '同名線索待核實，不可繼承其他店的確認')]
  };
  cards.b.push({ ...entry('qa-shared-customer', 'b', '門市展示需求仍待查核，不屬於共同人物關係'), kind: 'customer', level: 'inference',
    evidence: [source('b', '門市曾提過展示用途，需求尚待查核。')] });
  cards.b.push({ ...entry('qa-shared-rejected', 'b', '已否認的共同採購，只留審核歷史'), level: 'counter',
    evidence: [source('b', '先前共同採購的猜測已被否認。')] });
  for (const id of Object.keys(names)) {
    const current = get('store', 'qa-shared-' + id);
    bundle.ops.push(c.revision('store', current.id, { ...current.heads[0].data, preVisitInsights: { format: 'pharmacy-store-insights-1', batchId: 'synthetic-shared-analysis', generatedAt: at, sourceAsOf: '2026-10-16', entries: cards[id] } }, [current.heads[0].id], 'synthetic-shared-seed'));
  }
  for (const [id, cardId, status] of [['a', 'qa-shared-relation-a', 'confirmed'], ['b', 'qa-shared-rejected', 'rejected']]) {
    const store = get('store', 'qa-shared-' + id);
    bundle = c.applyInsightReview(bundle, c.planInsightReview(bundle, store.id, cardId, status, store.heads[0].id), 'synthetic-Kit-seed');
  }
  return c.validateBundle(bundle);
}

export function mappingInput(c, bundle) {
  const stores = c.project(bundle).filter(row => row.type === 'store');
  const members = ['a', 'b', 'c'].map(id => {
    const store = stores.find(row => row.id === 'qa-shared-' + id);
    return { storeId: store.id, storeIdentityKey: c.storeInsightsIdentityKey(store), entry: structuredClone(store.preVisitInsights.entries.find(entry => entry.id === 'qa-shared-relation-' + id)) };
  });
  return { format: 'pharmacy-insight-relations-import-1', vaultId: bundle.vaultId, generatedAt: '2026-10-16T03:00:00.000Z',
    relations: [{ format: 'pharmacy-insight-relation-1', id: 'qa-shared-colleagues', claim: '林測試、陳示範、王合成曾在同一間虛構藥局共事。', members }],
    expectedHeads: members.map(member => ({ storeId: member.storeId, headId: stores.find(store => store.id === member.storeId).heads[0].id })) };
}

export async function makeFixture(c) {
  const original = await makeUnmappedFixture(c), input = mappingInput(c, original), plan = c.planStoreInsightRelations(original, input);
  return c.applyStoreInsightRelations(original, input, plan, 'synthetic-shared-mapping');
}

export async function auditBundle(c, bundle, original) {
  c.validateBundle(bundle); c.validateBundle(original);
  const fingerprint = value => c.hashBytes(new TextEncoder().encode(JSON.stringify(value)));
  const originalOps = new Map(original.ops.map(op => [op.id, op])), currentOps = new Map(bundle.ops.map(op => [op.id, op]));
  const reviews = value => c.project(value).filter(row => row.type === 'store').flatMap(store => c.storeInsightReviewHistory(store).map(event => ({ storeId: store.id, event }))).sort((a, b) => a.event.id.localeCompare(b.event.id));
  const originalReviews = reviews(original), currentReviews = reviews(bundle);
  const selectedOps = (value, predicate) => value.ops.filter(predicate).sort((a, b) => a.id.localeCompare(b.id));
  const nonRelationReviewData = data => {
    const value = structuredClone(data); delete value.preVisitInsightRelations; delete value.preVisitInsightReviews; return value;
  };
  const currentStores = new Map(c.project(bundle).filter(row => row.type === 'store').map(row => [row.id, row]));
  const [currentFingerprint, baselineFingerprint] = await Promise.all([fingerprint(bundle), fingerprint(original)]);
  return { syntheticOnly: true, realIPhone: false, fingerprint: currentFingerprint, baselineFingerprint, bundleUnchanged: currentFingerprint === baselineFingerprint,
    originalOpsPreserved: [...originalOps].every(([id, op]) => JSON.stringify(currentOps.get(id)) === JSON.stringify(op)),
    originalBlobsPreserved: Object.entries(original.blobs).every(([id, data]) => bundle.blobs[id] === data),
    visitOpsUnchanged: JSON.stringify(selectedOps(bundle, op => op.type === 'visit')) === JSON.stringify(selectedOps(original, op => op.type === 'visit')),
    sourceOpsUnchanged: JSON.stringify(selectedOps(bundle, op => op.type === 'source')) === JSON.stringify(selectedOps(original, op => op.type === 'source')),
    attendanceUnchanged: JSON.stringify(selectedOps(bundle, op => op.visitAttendance)) === JSON.stringify(selectedOps(original, op => op.visitAttendance)),
    originalReviewEventsPreserved: originalReviews.every(before => currentReviews.some(after => before.storeId === after.storeId && JSON.stringify(before.event) === JSON.stringify(after.event))),
    currentNonRelationAndReviewStoreDataUnchanged: c.project(original).filter(row => row.type === 'store').every(before => {
      const after = currentStores.get(before.id);
      return after && after.deleted === before.deleted && after.heads.every(head => JSON.stringify(nonRelationReviewData(head.data)) === JSON.stringify(nonRelationReviewData(before.heads[0].data)));
    }),
    reviewEventIdsUnique: new Set(currentReviews.map(item => item.event.id)).size === currentReviews.length,
    opsBefore: original.ops.length, opsAfter: bundle.ops.length, reviewEventsBefore: originalReviews.length, reviewEventsAfter: currentReviews.length,
    stores: c.project(bundle).filter(row => row.type === 'store').map(store => ({ id: store.id, name: store.name, conflict: store.conflict,
      cards: (store.preVisitInsights?.entries || []).map(entry => ({ id: entry.id, kind: entry.kind, headline: entry.headline,
        localStatus: c.insightReviewForEntry(store, entry).status, effectiveReview: c.insightSharedReviewForEntry(bundle, store.id, entry) })) })) };
}

function browserMain() {
  const output = document.getElementById('output'), baselineKey = 'synthetic-shared-relation-baseline', revisionKey = 'synthetic-shared-relation-disk-revision';
  const allowed = () => { if (location.origin !== 'http://127.0.0.1:18874') throw new Error('拒絕在專用合成 origin 以外執行'); };
  const run = fn => async () => {
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    try { output.textContent = '處理中…'; await fn(); } catch (error) { output.textContent = 'ERROR: ' + error.message; }
    finally { for (const button of document.querySelectorAll('button')) button.disabled = false; }
  };
  const stored = async () => {
    allowed(); const slot = await db.readLocal();
    if (!slot?.unlockKey) throw new Error('請先建立合成測試資料');
    const payload = await c.unseal(slot.envelope, slot.unlockKey, 'device');
    if (payload.qaOnly !== 'shared-relation-fictional-v1' || payload.bundle.vaultId !== 'synthetic-shared-relation-vault' || payload.token) throw new Error('非此測試庫，拒絕讀取或輸出');
    return { slot, payload };
  };
  document.getElementById('seed').onclick = run(async () => {
    allowed(); if (await db.readLocal()) throw new Error('此測試 origin 已有資料，不覆蓋既有驗收證據。');
    const meta = c.newMeta(); meta.vaultId = 'synthetic-shared-relation-vault';
    const key = await c.derive('synthetic-shared-relation-password-only', meta), bundle = await makeFixture(c);
    const payload = { schema: 1, device: 'synthetic-shared-browser', deviceName: '僅虛構共用關係驗收', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null,
      lastHealthAudit: new Date().toISOString(), pendingSync: { entities: [], unknown: false }, qaOnly: 'shared-relation-fictional-v1' };
    await db.writeLocal(await c.seal(payload, key, meta, 'device'), 0, key);
    localStorage.setItem(baselineKey, JSON.stringify(bundle)); localStorage.setItem(revisionKey, JSON.stringify((await db.readLocal()).revision));
    output.textContent = '合成資料已建立。只有青禾有本店已確認事件；晨光、雲杉透過明確共同關係對照取得同一次確認。晨光需求卡仍待查核，不符合卡只留歷史；海風即使卡片 ID 相同也不可繼承。';
  });
  document.getElementById('audit').onclick = run(async () => {
    const { slot, payload } = await stored(), original = JSON.parse(localStorage.getItem(baselineKey) || 'null');
    if (original?.vaultId !== 'synthetic-shared-relation-vault') throw new Error('缺少有效種子基準');
    const baselineDiskRevision = JSON.parse(localStorage.getItem(revisionKey) || 'null');
    output.textContent = JSON.stringify({ diskRevision: slot.revision, baselineDiskRevision, diskRevisionUnchanged: slot.revision === baselineDiskRevision, ...await auditBundle(c, payload.bundle, original) }, null, 2);
  });
  document.getElementById('backup').onclick = run(async () => {
    const { slot, payload } = await stored();
    const envelope = await c.seal(payload.bundle, slot.unlockKey, slot.envelope);
    const reopened = await c.unseal(envelope, slot.unlockKey);
    const plan = await c.planBackupImport(null, reopened);
    if (JSON.stringify(plan.bundle) !== JSON.stringify(payload.bundle)) throw new Error('合成備份還原預覽與原 bundle 不相等');
    const blob = new Blob([JSON.stringify({ format: 'pharmacy-backup-1', envelope })], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'synthetic-shared-relation.pharmabackup'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    output.textContent = '已產生合成加密備份，並在記憶體驗證解密與還原預覽完整相等；此動作未寫入 App 資料。';
  });
}

const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>虛構共同人物關係驗收</title><style>body{font:16px/1.6 system-ui;margin:24px;max-width:1050px}button,a{display:inline-block;padding:12px;margin:6px;min-height:44px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef5f5;padding:16px}strong{color:#a21}</style><h1>虛構共同人物關係驗收</h1><p><strong>專用 127.0.0.1:18874；無正式門市、帳密、Mac API 或外部服務。</strong></p><p>真實瀏覽器可驗證操作與排版，此測試不代表 iPhone 真機驗收。兩個裝置的 HTTPS 同步另由隔離服務測試驗證。</p><button id="seed">建立虛構測試資料</button><a href="/" target="_blank" rel="noopener">開啟測試 App</a><button id="audit">唯讀核對資料</button><button id="backup">匯出並驗證合成備份</button><ol><li>青禾：有一筆原有 Kit 已確認。晨光、雲杉：同一項明確共同關係應顯示此確認的來源，沒有複製任何審核事件。</li><li>晨光的需求卡仍待查核；已否認共同採購的卡只留在歷史。</li><li>海風卡片 ID 刻意與青禾相同，但未加入共同關係，不可自動確認。</li><li>純瀏覽／展開／關閉不應增加任何版本。若明確改本店審核狀態，只新增該店事件，保留其他門市與原確認。</li><li>原始筆記、CSV bytes、Source Snapshot、實際拜訪證據與原審核事件必須完整保留。</li></ol><pre id="output" aria-live="polite">尚未操作。已有測試資料時不會覆蓋，請直接唯讀核對。</pre><script type="module" src="/qa-client.mjs"></script></html>`;
const client = `import * as c from '/core.js';import * as db from '/db.js';\n${makeUnmappedFixture.toString()}\n${mappingInput.toString()}\n${makeFixture.toString()}\n${auditBundle.toString()}\n(${browserMain.toString()})();`;

export function createFixtureServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (request.headers.host !== '127.0.0.1:' + PORT) { response.writeHead(403); return response.end('Dedicated fictional origin only'); }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(503, { 'Content-Type': 'application/json' }); return response.end('{"error":"Synthetic fixture: network writes disabled"}'); }
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
    const c = await import('../../public/core.js'), original = await makeUnmappedFixture(c), before = structuredClone(original), input = mappingInput(c, original);
    const bundle = c.applyStoreInsightRelations(original, input, c.planStoreInsightRelations(original, input), 'synthetic-self-test');
    assert.deepEqual(original, before);
    const audit = await auditBundle(c, bundle, original);
    for (const field of ['originalOpsPreserved', 'originalBlobsPreserved', 'visitOpsUnchanged', 'sourceOpsUnchanged', 'attendanceUnchanged', 'originalReviewEventsPreserved', 'currentNonRelationAndReviewStoreDataUnchanged', 'reviewEventIdsUnique']) assert.equal(audit[field], true, field);
    assert.equal(audit.reviewEventsAfter, audit.reviewEventsBefore);
    const status = (store, card) => audit.stores.find(row => row.id === 'qa-shared-' + store).cards.find(row => row.id === card).effectiveReview.status;
    for (const id of ['a', 'b', 'c']) assert.equal(status(id, 'qa-shared-relation-' + id), 'confirmed');
    assert.equal(status('b', 'qa-shared-customer'), 'pending'); assert.equal(status('b', 'qa-shared-rejected'), 'rejected'); assert.equal(status('d', 'qa-shared-relation-a'), 'pending');
    const meta = c.newMeta(); meta.vaultId = bundle.vaultId; const key = await c.derive('synthetic-shared-self-test', meta);
    const decrypted = await c.unseal(await c.seal(bundle, key, meta), key), restored = await c.planBackupImport(null, decrypted);
    assert.deepEqual(restored.bundle, bundle);
    console.log(JSON.stringify({ ok: true, syntheticOnly: true, realIPhone: false, stores: audit.stores.length, opsBefore: audit.opsBefore, opsAfter: audit.opsAfter, reviewEvents: audit.reviewEventsAfter }));
  } else createFixtureServer().listen(PORT, '127.0.0.1', () => console.log('Synthetic-only fixture: http://127.0.0.1:' + PORT + '/qa.html'));
}
