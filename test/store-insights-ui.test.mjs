import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { newMeta, derive, seal, unseal, emptyBundle, revision, project, storeInsightsIdentityKey, storeInsightsForStore, planStoreInsights, applyStoreInsights, buildStoreInsightsSource } from '../public/core.js';

// Exercise the real UI functions against synthetic fixtures and an in-memory
// encrypted disk. No browser, network, client database or customer text is used.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function source(start, end) {
  const from = app.indexOf(start), to = end ? app.indexOf(end, from + start.length) : app.length;
  assert.ok(from >= 0 && to > from, `Application test boundary not found: ${start}`);
  return app.slice(from, to);
}
const generatedAt = '2026-10-06T02:00:00.000Z';
const seed = (async () => {
  const meta = newMeta(), key = await derive('synthetic-insight-ui-passphrase', meta), bundle = emptyBundle(meta.vaultId);
  const store = revision('store', 's', { name: 'Synthetic <img src=x onerror=alert(1)>', city: '', district: '', channel: '', attr: '', contact: '', nextRemember: 'Synthetic reminder' }, [], 'synthetic');
  const visit = revision('visit', 'v', { store: 's', date: '', text: 'Synthetic exact <script>alert(1)</script> quote.\r\nRAW_TEXT_ONLY_SYNTHETIC_MARKER', next: '', source: 'Synthetic <svg onload=alert(1)> source', topics: [], people: [], attachments: [] }, [], 'synthetic');
  bundle.ops.push(store, visit);
  const input = { format: 'pharmacy-store-insights-import-1', vaultId: bundle.vaultId, generatedAt, sourceAsOf: '2026-10-06', stores: [{ storeId: 's', expectedStoreHead: store.id, insights: {
    format: 'pharmacy-store-insights-1', batchId: 'synthetic-ui-batch', generatedAt, sourceAsOf: '2026-10-06', entries: [{
      id: 'synthetic-entry', kind: 'customer', level: 'inference', headline: 'Synthetic <img src=x> headline', question: 'Synthetic <script>question</script>?', caution: 'Synthetic <svg> caution', limitations: ['Synthetic <b> limitation'],
      evidence: [{ storeId: 's', storeIdentityKey: storeInsightsIdentityKey(store.data), visitId: 'v', revisionId: visit.id, quote: 'Synthetic exact <script>alert(1)</script> quote.', role: 'support' }]
    }]
  } }] };
  return { meta, key, bundle, store, visit, input };
})();
function fileFor(input) { const text = JSON.stringify(input); return { size: Buffer.byteLength(text), text: async () => text }; }
async function harness() {
  const fixture = await seed, nodes = new Map(), state = { disk: { revision: 7 }, writes: [], renders: 0, notices: [], downloads: [], confirms: [], requests: [], pendingCSV: false, failWrite: false, sealHook: null };
  let c;
  const $ = id => {
    if (!nodes.has(id)) {
      const listeners = new Map();
      nodes.set(id, { id, open: false, checked: false, disabled: false, hidden: false, value: '', textContent: '', innerHTML: '', dataset: {},
        classList: { add() {}, remove() {} }, reset() { this.value = ''; }, replaceChildren() { this.innerHTML = ''; this.textContent = ''; },
        addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
        dispatch(name, target = this) { for (const fn of listeners.get(name) || []) fn({ target }); },
        close() { this.open = false; this.dispatch('close'); }
      });
    }
    return nodes.get(id);
  };
  c = vm.createContext({ $, structuredClone, JSON, Set, Date, storeInsightsForStore, planStoreInsights, applyStoreInsights, buildStoreInsightsSource,
    key: fixture.key, meta: structuredClone(fixture.meta), payload: { device: 'synthetic-ui-device', token: 'synthetic-token', bundle: structuredClone(fixture.bundle), dirty: false },
    localRevision: 7, slot: state.disk, localSaveState: 'saved', syncInProgress: false, pendingLock: false, busy: false, updateHolding: false,
    insightsPreview: null, backupPreview: null, versionReview: null, resolutionPreview: null, editorContext: null, singleStoreContext: null, inlineTextContext: null, reminderContext: null, attendancePrompt: null,
    document: { hidden: false, querySelectorAll: () => [...nodes.values()], body: { classList: { add() {}, remove() {} } } },
    csvImport: { hasPending: () => state.pendingCSV, reset() {} }, syncScheduler: { request: reason => state.requests.push(reason), pause() {}, reset() {} },
    openDialog: dialog => { dialog.open = true; }, render: () => state.renders++, renderDataSafetyEntry() {}, toast: message => state.notices.push(message),
    by: (type, id) => project(c.payload.bundle).find(record => record.type === type && record.id === id),
    confirm: message => { state.confirms.push(message); return state.confirmed === true; }, download: (...args) => state.downloads.push(args),
    seal: async (...args) => { if (state.sealHook) await state.sealHook(); return seal(...args); },
    writeLocal: async (envelope, expected, unlockKey) => {
      if (state.failWrite) throw new Error('synthetic disk full');
      if (state.disk.revision !== expected) throw new Error('另一個視窗已更新資料');
      state.writes.push({ envelope, expected, unlockKey }); state.disk = { envelope, revision: expected + 1 }; return expected + 1;
    }
  });
  vm.runInContext(source('const esc = ', '\n') + '\n' + source('function storedReminderDrafts(', 'function reminderDraftFor(') + source('async function persist(', 'function pendingSyncSummary(') + source('function assertInsightsIdle(', 'function openVisitBrief(') + source("$('store-insights-file').addEventListener('change'"), c);
  return { c, $, state, fixture, file: fileFor(fixture.input) };
}
async function preview(h) { await h.c.previewInsightsFile(h.file); }
function acknowledge(h) { h.$('insights-ack').checked = true; h.$('review').dispatch('change', h.$('insights-ack')); }
function installLock(h) {
  Object.assign(h.c, { syncEpoch: 0, clearTimeout() {}, clearInterval() {}, inlineDraftTimer: null, reminderDraftTimer: null, autoTimer: null, objectURLs: [], forgetBriefSearchQuery() {}, captureTransientResumeState() {}, clearNearbyPosition() {}, resetStoreFilters() {}, resetReminderOptionGroup() {}, showGate() {} });
  vm.runInContext(source('function lockNow(', 'async function showGate('), h.c);
}

test('insight actions reject open editors, unfinished encrypted drafts, competing reviews and background state without writing', async () => {
  const blockers = [h => h.c.payload = null, h => h.c.editorContext = {}, h => h.c.singleStoreContext = {}, h => h.c.inlineTextContext = {}, h => h.c.reminderContext = {}, h => h.c.payload.draft = {}, h => h.c.payload.inlineTextDraft = {}, h => h.c.backupPreview = {}, h => h.c.attendancePrompt = {}, h => h.state.pendingCSV = true,
    ...['review', 'quick-text-dialog', 'store-reminder-dialog', 'rebuild-dialog'].map(id => h => h.$(id).open = true), h => h.c.pendingLock = true, h => h.c.document.hidden = true,
    h => h.c.payload.reminderDrafts = [{ format: 'store-reminder-draft-1', storeId: 's', storeName: 'Synthetic', parents: [h.fixture.store.id], baseEvery: '', baseLegacy: '', savedAt: generatedAt, fields: { next: 'Synthetic draft', every: '', customText: '', customApplied: '', convert: false, customChecked: false } }]
  ];
  for (const block of blockers) {
    const h = await harness(); block(h); const before = JSON.stringify(h.c.payload);
    await assert.rejects(h.c.previewInsightsFile(h.file), /編輯、草稿或核對|重新操作/);
    assert.throws(() => h.c.exportInsightsSource(), /編輯、草稿或核對|重新操作/);
    assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.c.insightsPreview, null); assert.equal(h.state.writes.length, 0); assert.equal(h.state.downloads.length, 0);
  }
});
test('preview and cancel are read-only; summaries escape names and do not preload full source text', async () => {
  const h = await harness(), before = JSON.stringify(h.c.payload); await preview(h);
  assert.equal(h.$('review').open, true); assert.equal(h.c.insightsPreview.plan.ready.length, 1);
  assert.match(h.$('review-body').innerHTML, /&lt;img/); assert.match(h.$('review-body').innerHTML, /id="apply-store-insights"[^>]* disabled/);
  assert.doesNotMatch(h.$('review-body').innerHTML, /<img|<script|RAW_TEXT_ONLY_SYNTHETIC_MARKER/);
  h.$('review').close(); assert.equal(h.c.insightsPreview, null); assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0);
});
test('explicit acknowledgement is required; accepted apply writes one encrypted store revision and retains originals', async () => {
  const h = await harness(); await preview(h);
  await assert.rejects(h.c.commitInsights(), /勾選確認/); assert.equal(h.state.writes.length, 0);
  acknowledge(h); assert.equal(h.$('apply-store-insights').disabled, false); await h.c.commitInsights();
  assert.equal(h.state.writes.length, 1); assert.equal(h.state.writes[0].expected, 7); assert.equal(h.c.localRevision, 8); assert.equal(h.c.insightsPreview, null); assert.equal(h.$('review').open, false);
  const stored = await unseal(h.state.disk.envelope, h.c.key, 'device');
  assert.deepEqual(stored.bundle.ops.slice(0, h.fixture.bundle.ops.length), h.fixture.bundle.ops); assert.equal(stored.bundle.ops.length, h.fixture.bundle.ops.length + 1);
  assert.equal(stored.bundle.ops.at(-1).type, 'store'); assert.equal(Object.hasOwn(stored.bundle.ops.at(-1), 'visitAttendance'), false);
  assert.deepEqual(stored.pendingSync.entities, ['store:s']); assert.equal(stored.token, 'synthetic-token'); assert.equal(h.state.renders, 1);
  await assert.rejects(h.c.commitInsights(), /勾選確認/); assert.equal(h.state.writes.length, 1);
});
test('file parsing is bounded and a lost session during loading never opens a stale preview', async () => {
  const oversized = await harness(); let reads = 0;
  await assert.rejects(oversized.c.previewInsightsFile({ size: 2 * 1024 * 1024 + 1, text: async () => { reads++; return ''; } }), /2 MB/); assert.equal(reads, 0);
  const malformed = await harness(); await assert.rejects(malformed.c.previewInsightsFile({ size: 1, text: async () => '{' })); assert.equal(malformed.state.writes.length, 0);
  for (const change of [c => c.key = {}, c => c.payload = null, c => c.pendingLock = true, c => c.document.hidden = true]) {
    const h = await harness(); h.file.text = async () => { change(h.c); return JSON.stringify(h.fixture.input); };
    await preview(h); assert.equal(h.c.insightsPreview, null); assert.equal(h.$('review').open, false); assert.equal(h.state.writes.length, 0);
  }
});
test('session loss and changes to source or target after preview reject commit without persisting', async () => {
  const changes = [h => h.c.key = {}, h => h.c.payload = null, h => h.c.pendingLock = true, h => h.c.document.hidden = true, h => h.$('review').open = false,
    ...['store', 'visit'].map(type => h => { const old = type === 'store' ? h.fixture.store : h.fixture.visit; h.c.payload.bundle.ops.push(revision(type, old.entity, { ...old.data }, [old.id], 'synthetic-concurrent')); })];
  for (const change of changes) {
    const h = await harness(); await preview(h); acknowledge(h); change(h); const before = JSON.stringify(h.c.payload);
    await assert.rejects(h.c.commitInsights(), /重新核對|預覽後/); assert.equal(h.state.writes.length, 0); assert.equal(JSON.stringify(h.c.payload), before);
  }
});
test('real persistence rejects encryption-time session races and disk CAS races, retaining a retryable preview', async () => {
  for (const change of [h => h.c.key = {}, h => h.c.localRevision++, h => h.state.disk.revision++]) {
    const h = await harness(); await preview(h); acknowledge(h); const before = JSON.stringify(h.c.payload);
    h.state.sealHook = () => change(h);
    await assert.rejects(h.c.commitInsights(), /儲存期間|另一個視窗/); assert.equal(h.state.writes.length, 0); assert.equal(JSON.stringify(h.c.payload), before); assert.ok(h.c.insightsPreview);
  }
  const h = await harness(); await preview(h); acknowledge(h); h.state.failWrite = true;
  await assert.rejects(h.c.commitInsights(), /disk full/); assert.ok(h.c.insightsPreview); assert.equal(h.$('review').open, true);
  h.state.failWrite = false; await h.c.commitInsights(); assert.equal(h.state.writes.length, 1);
});
test('renderer escapes every private field and loads complete raw text only on an explicit source expansion', async () => {
  const h = await harness(); await preview(h); acknowledge(h); await h.c.commitInsights();
  const html = h.c.storeInsightsHTML('s');
  assert.match(html, /&lt;img/); assert.match(html, /&lt;script/); assert.match(html, /&lt;svg/); assert.match(html, /&lt;b/);
  assert.doesNotMatch(html, /<img|<script|<svg|<b>|RAW_TEXT_ONLY_SYNTHETIC_MARKER/); assert.match(html, /<pre><\/pre>/);
  const pre = { textContent: '', innerHTML: '' }, detail = { open: false, dataset: { insightSource: 'v', insightStore: 's', insightRevision: h.fixture.visit.id }, matches: selector => selector === '[data-insight-source]', querySelector: () => pre };
  h.$('review-body').dispatch('toggle', detail); assert.equal(pre.textContent, '');
  detail.open = true; h.$('review-body').dispatch('toggle', detail); assert.equal(pre.textContent, h.fixture.visit.data.text); assert.equal(pre.innerHTML, '');
  h.c.payload.bundle.ops.push(revision('visit', 'v', { ...h.fixture.visit.data, googleUpdatePending: true }, [h.fixture.visit.id], 'synthetic-updated'));
  h.$('review-body').dispatch('toggle', detail); assert.match(pre.textContent, /來源已改變/); assert.doesNotMatch(pre.textContent, /RAW_TEXT_ONLY_SYNTHETIC_MARKER/);
});
test('stores without effective current entries render no empty section and import details stay lazy', async () => {
  const h = await harness(); assert.equal(h.c.storeInsightsHTML('s'), ''); await preview(h);
  const content = { innerHTML: '' }, detail = { open: false, dataset: { insightPreview: '0' }, matches: selector => selector === '[data-insight-preview]', querySelector: () => content };
  h.$('review-body').dispatch('toggle', detail); assert.equal(content.innerHTML, '');
  detail.open = true; h.$('review-body').dispatch('toggle', detail); assert.match(content.innerHTML, /&lt;script/); assert.doesNotMatch(content.innerHTML, /<script|RAW_TEXT_ONLY_SYNTHETIC_MARKER/); assert.equal(detail.dataset.loaded, '1');
  acknowledge(h); await h.c.commitInsights(); h.c.payload.bundle.ops.push(revision('visit', 'v', h.fixture.visit.data, [h.fixture.visit.id], 'synthetic-identical-new-revision'));
  assert.equal(h.c.storeInsightsHTML('s'), ''); assert.equal(h.c.storeInsightsHTML('missing'), '');
});
test('explicit source-export consent is required and export neither persists nor automatically sends data', async () => {
  const h = await harness(), before = JSON.stringify(h.c.payload); h.c.exportInsightsSource();
  assert.equal(h.state.downloads.length, 0); assert.match(h.state.confirms[0], /明文檔/); assert.match(h.state.confirms[0], /不可上傳 GitHub/);
  h.state.confirmed = true; h.c.exportInsightsSource(); assert.equal(h.state.downloads.length, 1);
  const exported = JSON.parse(h.state.downloads[0][0]); assert.equal(exported.format, 'pharmacy-store-insights-source-1'); assert.equal(exported.visits[0].heads[0].data.text, h.fixture.visit.data.text);
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0); assert.deepEqual(h.state.requests, []);
});
test('actual lock cancels decrypted insight preview and clears its DOM without a write', async () => {
  const h = await harness(); installLock(h); await preview(h); const original = h.c.payload, before = JSON.stringify(original), disk = JSON.stringify(h.state.disk);
  h.c.document.hidden = true; h.c.lockNow(false);
  assert.equal(h.c.insightsPreview, null); assert.equal(h.$('review').open, false); assert.equal(h.$('review-body').innerHTML, '');
  assert.equal(h.c.payload, null); assert.equal(h.c.key, null); assert.equal(h.c.meta, null); assert.equal(h.c.pendingLock, false);
  assert.equal(JSON.stringify(original), before); assert.equal(JSON.stringify(h.state.disk), disk); assert.equal(h.state.writes.length, 0);
  await assert.rejects(h.c.commitInsights(), /勾選確認/);
});
