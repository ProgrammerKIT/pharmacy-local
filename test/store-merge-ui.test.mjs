import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../public/core.js';

// Run real UI handlers, merge engine and encryption against synthetic data and
// an in-memory CAS disk. No customer vault, browser or network is touched.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function source(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return app.slice(from, to);
}
const seed = (async () => {
  const meta = core.newMeta(), key = await core.derive('synthetic-safe-merge-password', meta), bundle = core.emptyBundle(meta.vaultId);
  const base = { name: 'Synthetic <img> primary', address: 'Synthetic Road', city: '', district: '', channel: '', attr: '', contact: '', everyTimeMust: '' };
  const keeper = core.revision('store', 'keeper', base, [], 'synthetic');
  const taskData = core.addReminderTasks({ ...base, name: 'Synthetic donor', mapUrl: 'https://www.google.com/maps?cid=123' }, 'Synthetic completed task\nSynthetic pending task', '2026-10-01T01:00:00.000Z');
  const donor = core.revision('store', 'donor', core.completeReminderTask(taskData, taskData.nextRememberTasks[0].id, '2026-10-01T02:00:00.000Z'), [], 'synthetic');
  const visits = ['keeper', 'donor'].map((store, i) => core.revision('visit', 'visit-' + i, { store, date: '', text: 'Synthetic <script>verbatim</script>\r\nFull note ' + i, next: '', source: 'synthetic', topics: [], people: [], attachments: [] }, [], 'synthetic'));
  bundle.ops.push(keeper, donor, ...visits);
  const entry = { id: 'donor-card', kind: 'relationship', level: 'source', headline: 'Synthetic private relationship', question: 'Synthetic question', caution: '', limitations: [], evidence: [{ storeId: 'donor', storeIdentityKey: core.storeInsightsIdentityKey(donor.data), visitId: 'visit-1', revisionId: visits[1].id, quote: 'Full note 1', role: 'support' }] };
  const input = { format: 'pharmacy-store-insights-import-1', vaultId: bundle.vaultId, generatedAt: '2026-10-01T03:00:00.000Z', sourceAsOf: '2026-10-01', stores: [{ storeId: 'donor', expectedStoreHead: donor.id, insights: { format: 'pharmacy-store-insights-1', batchId: 'synthetic-batch', generatedAt: '2026-10-01T03:00:00.000Z', sourceAsOf: '2026-10-01', entries: [entry] } }] };
  const withInsights = core.applyStoreInsights(bundle, input, core.planStoreInsights(bundle, input), 'synthetic');
  const store = core.project(withInsights).find(record => record.id === 'donor');
  const reviewed = core.applyInsightReview(withInsights, core.planInsightReview(withInsights, 'donor', entry.id, 'rejected', store.heads[0].id), 'synthetic');
  return { meta, key, bundle: reviewed };
})();
async function harness() {
  const fixture = await seed, nodes = new Map(), state = { disk: { revision: 8 }, writes: [], downloads: [], notices: [], confirms: [], confirmation: true, csvPending: false, readHook: null, sealHook: null, writeFail: false, renders: 0 };
  let c;
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { id, open: false, value: '', checked: false, disabled: false, textContent: '', innerHTML: '', dataset: {},
      replaceChildren() { this.innerHTML = ''; }, close() { this.open = false; if (id === 'review') c.clearStoreMergePreview(); } });
    return nodes.get(id);
  };
  c = vm.createContext({ ...core, $, JSON, Date, Set, structuredClone,
    payload: { device: 'synthetic-device', bundle: structuredClone(fixture.bundle), token: 'synthetic-pair', dirty: false }, key: fixture.key, meta: structuredClone(fixture.meta), localRevision: 8, syncEpoch: 1,
    slot: state.disk, localSaveState: 'saved', busy: false, pendingLock: false, updateHolding: false, syncInProgress: false, autoFetching: false,
    storeMergePreview: null, storeMergeSetup: null, qualityReview: { a: 'keeper', b: 'donor' }, versionReview: null, resolutionPreview: null,
    editorContext: null, singleStoreContext: null, inlineTextContext: null, reminderContext: null, dayPlanContext: null, monthlyVisitContext: null, quickTextContext: null, backupPreview: null, insightsPreview: null, coordinatePreview: null, enrichmentPreview: null, attendancePrompt: null,
    document: { hidden: false }, csvImport: { hasPending: () => state.csvPending }, storedReminderDrafts: () => c.payload?.reminderDrafts || [],
    reviewHeads: record => record.heads.map(head => head.id).sort(), APP_VERSION: '1.5.62', INSIGHT_REVIEW_LABELS: { pending: '待查核', confirmed: 'Kit已確認', rejected: '不符合' },
    esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    dateText: value => value, reviewAttendanceHTML: () => '', reviewValue: value => typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    reviewFields: (a, b) => `<pre>${c.esc(JSON.stringify(a))}</pre><pre>${c.esc(JSON.stringify(b))}</pre>`,
    reminderTasksHTML: store => c.esc(JSON.stringify(core.reminderTaskHistory(store))), storeAttendanceHTML: () => 'Synthetic attendance',
    by: (type, id) => core.project(c.payload.bundle).find(record => record.type === type && record.id === id),
    openDialog: node => { node.open = true; }, resetDialogScroll() {}, renderDataSafetyEntry() {}, syncScheduler: { request() {} },
    render: () => { state.renders++; c.records = core.project(c.payload.bundle); }, toast: msg => state.notices.push(msg),
    confirm: msg => { state.confirms.push(msg); return state.confirmation; }, download: (bytes, name, type) => state.downloads.push({ bytes, name, type }),
    readLocal: async () => { await state.readHook?.(); return structuredClone(state.disk); },
    seal: async (...args) => { await state.sealHook?.(); return core.seal(...args); },
    writeLocal: async (envelope, expected, key) => { if (state.writeFail) throw new Error('synthetic disk full'); assert.equal(expected, state.disk.revision); state.writes.push({ envelope, expected, key }); state.disk = { revision: expected + 1, envelope }; return state.disk.revision; }
  });
  vm.runInContext(source('async function persist(', 'function pendingSyncSummary(') + source('function storeMergeCanonical(', 'async function saveQualityReview(') + source('function assertStoreMergeResolution(', 'function reviewValue('), c);
  c.records = core.project(c.payload.bundle);
  const preview = async () => { c.openStoreMergeSetup(); $('store-merge-keeper').value = 'keeper'; $('store-merge-name').value = 'Synthetic merged pharmacy'; await c.previewStoreMerge(); };
  const backup = async () => { const text = JSON.stringify({ format: 'pharmacy-backup-1', envelope: await core.seal(c.payload.bundle, c.key, c.meta) }); return { name: 'synthetic-backup.pharmabackup', size: text.length, text: async () => text }; };
  const ready = async () => { await preview(); await c.verifyStoreMergeBackup(await backup()); $('store-merge-ack').checked = true; $('store-merge-devices').checked = true; c.updateStoreMergeControls(); };
  return { c, $, state, fixture, preview, backup, ready };
}

test('setup, complete preview, private export and cancellation are read-only with escaped full notes', async () => {
  const h = await harness(), before = JSON.stringify(h.c.payload);
  await h.preview();
  const html = h.$('review-body').innerHTML;
  for (const text of ['唯讀預覽', '全部相關拜訪原文', 'Full note 0', 'Full note 1', '完成歷史', '不符合', '全部歷史', 'Mac 與 iPhone', '一鍵', 'store-merge-backup-file']) assert.ok(html.includes(text), text);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|<img>/);
  assert.equal(h.$('store-merge-apply').disabled, true);
  h.c.exportStoreMergePreview();
  const exported = JSON.parse(h.state.downloads[0].bytes);
  assert.equal(exported.formalDataWritten, false); assert.equal(exported.plan.name, 'Synthetic merged pharmacy');
  assert.equal(exported.token, undefined); assert.equal(exported.key, undefined); assert.equal(exported.bundle, undefined);
  assert.equal(exported.preservedInventory.filter(record => record.type === 'visit').length, 2);
  await h.c.exportStoreMergeBackup();
  assert.equal(h.c.storeMergePreview.verifiedBackup, null);
  assert.equal(h.state.writes.length, 0); assert.equal(JSON.stringify(h.c.payload), before);
  h.$('review').close(); assert.equal(h.c.storeMergePreview, null); assert.equal(h.$('review-body').innerHTML, '');
  assert.equal(h.state.writes.length, 0);
});

test('backup, both-device acknowledgement and final confirmation gate one atomic encrypted save', async () => {
  const h = await harness(); await h.preview();
  await assert.rejects(h.c.applyStoreMergePreview(), /備份/);
  await h.c.verifyStoreMergeBackup(await h.backup());
  h.$('store-merge-ack').checked = true;
  await assert.rejects(h.c.applyStoreMergePreview(), /Mac 與 iPhone/);
  h.$('store-merge-devices').checked = true; h.state.confirmation = false;
  await h.c.applyStoreMergePreview(); assert.equal(h.state.writes.length, 0);
  h.state.confirmation = true; await h.c.applyStoreMergePreview();
  assert.equal(h.state.writes.length, 1); assert.equal(h.c.localRevision, 9); assert.equal(h.c.storeMergePreview, null);
  const saved = await core.unseal(h.state.disk.envelope, h.c.key, 'device');
  assert.deepEqual(saved.bundle.ops.slice(0, h.fixture.bundle.ops.length), h.fixture.bundle.ops);
  const records = core.project(saved.bundle), donor = records.find(record => record.id === 'donor'), keeper = records.find(record => record.id === 'keeper');
  assert.equal(donor.deleted, true); assert.equal(donor.mergedInto, 'keeper'); assert.equal(keeper.name, 'Synthetic merged pharmacy');
  assert.equal(records.find(record => record.id === 'visit-1').text, 'Synthetic <script>verbatim</script>\r\nFull note 1');
  assert.equal(core.insightReviewForEntry(keeper, keeper.preVisitInsights.entries[0]).status, 'rejected');
  assert.equal(saved.bundle.ops.slice(h.fixture.bundle.ops.length).some(op => Object.hasOwn(op, 'visitAttendance')), false);
  assert.equal(h.state.confirms.at(-1).includes('實際拜訪日期'), true);
  await assert.rejects(h.c.applyStoreMergePreview()); assert.equal(h.state.writes.length, 1);
});

test('wrong-vault, older backup and corrupt backup cannot unlock apply', async () => {
  for (const mode of ['other', 'older', 'corrupt']) {
    const h = await harness(); await h.preview(); let file;
    if (mode === 'other') { const meta = core.newMeta(), key = await core.derive('synthetic-other-vault', meta); const text = JSON.stringify({ format: 'pharmacy-backup-1', envelope: await core.seal(core.emptyBundle(meta.vaultId), key, meta) }); file = { size: text.length, text: async () => text }; }
    else if (mode === 'older') { const bundle = structuredClone(h.c.payload.bundle); bundle.ops.pop(); const text = JSON.stringify({ format: 'pharmacy-backup-1', envelope: await core.seal(bundle, h.c.key, h.c.meta) }); file = { size: text.length, text: async () => text }; }
    else file = { size: 8, text: async () => '{broken' };
    await assert.rejects(h.c.verifyStoreMergeBackup(file)); assert.equal(h.c.storeMergePreview.verifiedBackup, null); assert.equal(h.state.writes.length, 0);
  }
});

test('stored drafts, hidden page, updates, lock, session, changed data and other-tab disk invalidate apply', async () => {
  const changes = [h => h.c.payload.draft = { text: 'unsaved' }, h => h.c.payload.inlineTextDraft = {}, h => h.c.payload.reminderDrafts = [{}], h => h.c.dayPlanContext = {}, h => h.c.document.hidden = true, h => h.c.pendingLock = true, h => h.c.updateHolding = true, h => h.c.syncInProgress = true, h => h.c.autoFetching = true, h => h.state.csvPending = true, h => h.c.key = {}, h => h.c.meta = {}, h => h.c.syncEpoch++, h => h.c.localRevision++, h => h.state.disk.revision++, h => h.c.payload.bundle.ops[0].data.name = 'stale', h => h.$('review').close()];
  for (const change of changes) { const h = await harness(); await h.ready(); change(h); await assert.rejects(h.c.applyStoreMergePreview()); assert.equal(h.state.writes.length, 0); }
});

test('leaving foreground during final encryption writes nothing; write failure retains retryable preview', async () => {
  const hidden = await harness(); await hidden.ready(); const before = JSON.stringify(hidden.c.payload);
  hidden.state.sealHook = () => { hidden.c.document.hidden = true; };
  await assert.rejects(hidden.c.applyStoreMergePreview()); assert.equal(hidden.state.writes.length, 0); assert.equal(JSON.stringify(hidden.c.payload), before);
  const failed = await harness(); await failed.ready(); const original = JSON.stringify(failed.c.payload), ctx = failed.c.storeMergePreview;
  failed.state.writeFail = true; await assert.rejects(failed.c.applyStoreMergePreview(), /disk full/);
  assert.equal(JSON.stringify(failed.c.payload), original); assert.equal(failed.c.storeMergePreview, ctx);
  failed.state.writeFail = false; await failed.c.applyStoreMergePreview(); assert.equal(failed.state.writes.length, 1);
});

test('archived donor histories are accessible from retained store without editable or restore controls', async () => {
  const h = await harness(); await h.ready(); await h.c.applyStoreMergePreview();
  const keeper = h.c.by('store', 'keeper'); assert.match(h.c.storeMergeOriginsHTML(keeper), /data-merged-origin="donor"/);
  h.c.openMergedStoreOrigin('keeper', 'donor'); const html = h.$('review-body').innerHTML;
  for (const text of ['唯讀留存', 'completed task', 'Synthetic private relationship', 'Full note 1', '原門市全部版本', '不符合']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /data-restore|data-use-version|contenteditable|data-reminder-complete|data-insight-review=/);
  assert.equal(h.state.writes.length, 1);
});


test('premerge rollback is blocked while postmerge conflicts preserving provenance can still be reviewed', async () => {
  const h = await harness(); await h.ready(); await h.c.applyStoreMergePreview();
  const keeper = h.c.by('store', 'keeper'), donor = h.c.by('store', 'donor');
  assert.throws(() => h.c.assertStoreMergeResolution(keeper, h.fixture.bundle.ops.find(op => op.entity === 'keeper').data, false), /安全合併歷史/);
  assert.throws(() => h.c.assertStoreMergeResolution(donor, donor.heads[0].data, false), /獨立門市/);
  const base = keeper.heads[0], left = core.revision('store', 'keeper', { ...base.data, contact: 'Synthetic left' }, [base.id], 'left'), right = core.revision('store', 'keeper', { ...base.data, contact: 'Synthetic right' }, [base.id], 'right');
  h.c.payload.bundle.ops.push(left, right);
  const conflicted = h.c.by('store', 'keeper'); assert.equal(conflicted.conflict, true);
  const context = { type: 'store', id: 'keeper', parents: conflicted.heads.map(head => head.id).sort() };
  assert.doesNotThrow(() => h.c.checkedReview(context));
  assert.doesNotThrow(() => h.c.assertStoreMergeResolution(conflicted, left.data, false));
  assert.equal(h.c.storeMergeVersionRestorable(keeper, base), true);
});


test('external-store stale-card safeguards cannot be removed by generic restore', async () => {
  const h = await harness(), marker = { id: 'synthetic-stale-card', key: 'synthetic-entry-key' };
  const version = core.revision('store', 'external', { ...h.fixture.bundle.ops[0].data, name: 'Synthetic external', storeMergeStaleEntries: [marker] }, [], 'synthetic');
  const record = { type: 'store', id: 'external', heads: [version], versions: [version] };
  assert.throws(() => h.c.assertStoreMergeResolution(record, { name: 'Synthetic external' }, false), /來源失效標記/);
  assert.doesNotThrow(() => h.c.assertStoreMergeResolution(record, version.data, false));
});
