import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../public/core.js';

// Real review UI and encrypted persistence, with synthetic records and an
// in-memory disk. No customer database, browser session or network is used.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function source(start, end) {
  const from = app.indexOf(start), to = end ? app.indexOf(end, from + start.length) : app.length;
  assert.ok(from >= 0 && to > from, `Application test boundary not found: ${start}`);
  return app.slice(from, to);
}
const generatedAt = '2026-10-07T02:00:00.000Z';
const seed = (async () => {
  const meta = core.newMeta(), key = await core.derive('synthetic-human-review-passphrase', meta), bundle = core.emptyBundle(meta.vaultId);
  const store = core.revision('store', 's', { name: 'Synthetic <img src=x> store', city: '', district: '', channel: '', attr: '', contact: '', nextRemember: 'Synthetic reminder' }, [], 'synthetic');
  const other = core.revision('store', 'other', { name: 'Synthetic other store', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'synthetic');
  const visit = core.revision('visit', 'v', { store: 's', date: '', text: 'Synthetic exact <script>alert(1)</script> quote.\r\nSYNTHETIC_FULL_TEXT_MARKER', next: '', source: 'Synthetic <svg> source', topics: [], people: [], attachments: [] }, [], 'synthetic');
  bundle.ops.push(store, other, visit);
  const entries = ['source', 'inference', 'counter'].map((level, i) => ({
    id: `entry-${i}`, kind: 'relationship', level, headline: `Synthetic ${level} <img src=x> headline`, question: 'Synthetic <script>question</script>?', caution: 'Synthetic <svg> caution', limitations: ['Synthetic <b> limitation'],
    evidence: [{ storeId: 's', storeIdentityKey: core.storeInsightsIdentityKey(store.data), visitId: 'v', revisionId: visit.id, quote: 'Synthetic exact <script>alert(1)</script> quote.', role: level === 'counter' ? 'counter' : 'support' }]
  }));
  const input = { format: 'pharmacy-store-insights-import-1', vaultId: bundle.vaultId, generatedAt, sourceAsOf: '2026-10-07', stores: [{ storeId: 's', expectedStoreHead: store.id, insights: { format: 'pharmacy-store-insights-1', batchId: 'synthetic-review-batch', generatedAt, sourceAsOf: '2026-10-07', entries } }] };
  const ready = core.applyStoreInsights(bundle, input, core.planStoreInsights(bundle, input), 'synthetic');
  return { meta, key, bundle: ready, store, other, visit, input };
})();
async function harness() {
  const fixture = await seed, nodes = new Map(), state = { disk: { revision: 7 }, writes: [], renders: 0, notices: [], confirms: [], requests: [], briefOpens: [], confirmed: true, confirmHook: null, sealHook: null, writeHook: null, failWrite: false, pendingCSV: false };
  let c;
  const $ = id => {
    if (!nodes.has(id)) {
      const listeners = new Map();
      nodes.set(id, { id, open: false, checked: false, disabled: false, hidden: false, value: '', textContent: '', innerHTML: '', dataset: {}, scrollTop: 340,
        classList: { add() {}, remove() {}, contains: name => name === 'visit-brief-dialog' }, reset() { this.value = ''; }, replaceChildren() { this.innerHTML = ''; this.textContent = ''; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
        dispatch(name, target = this) { for (const fn of listeners.get(name) || []) fn({ target }); },
        close() { this.open = false; this.dispatch('close'); }
      });
    }
    return nodes.get(id);
  };
  c = vm.createContext({ ...core, $, structuredClone, JSON, Set, Date,
    key: fixture.key, meta: structuredClone(fixture.meta), payload: { device: 'synthetic-review-device', token: 'synthetic-token', bundle: structuredClone(fixture.bundle), dirty: false },
    localRevision: 7, slot: state.disk, localSaveState: 'saved', syncInProgress: false, pendingLock: false, busy: false, updateHolding: false,
    insightsPreview: null, backupPreview: null, coordinatePreview: null, enrichmentPreview: null, versionReview: null, resolutionPreview: null, editorContext: null, singleStoreContext: null, inlineTextContext: null, reminderContext: null, attendancePrompt: null,
    document: { hidden: false, querySelectorAll: () => [...nodes.values()], body: { classList: { add() {}, remove() {} } } },
    csvImport: { hasPending: () => state.pendingCSV, reset() {} }, syncScheduler: { request: reason => state.requests.push(reason), pause() {}, reset() {} },
    openDialog: dialog => { dialog.open = true; }, render: () => state.renders++, renderDataSafetyEntry() {}, toast: message => state.notices.push(message),
    by: (type, id) => core.project(c.payload.bundle).find(record => record.type === type && record.id === id),
    openVisitBrief: (...args) => state.briefOpens.push(args), dateText: value => value,
    confirm: message => { state.confirms.push(message); state.confirmHook?.(); return state.confirmed; },
    seal: async (...args) => { if (state.sealHook) await state.sealHook(); return core.seal(...args); },
    writeLocal: async (envelope, expected, unlockKey) => {
      if (state.failWrite) throw new Error('synthetic disk full');
      if (state.disk.revision !== expected) throw new Error('另一個視窗已更新資料');
      state.writes.push({ envelope, expected, unlockKey }); state.disk = { envelope, revision: expected + 1 }; await state.writeHook?.(); return expected + 1;
    }
  });
  vm.runInContext(source('const esc = ', '\n') + '\n' + source('function storedReminderDrafts(', 'function reminderDraftFor(') + source('async function persist(', 'function pendingSyncSummary(') + source('function assertInsightsIdle(', 'function openVisitBrief('), c);
  $('review').open = true; $('review').dataset.singleStoreId = 's';
  const head = () => c.by('store', 's').heads[0].id;
  const act = (status, entryId = 'entry-0', expected = head()) => c.changeInsightReview('s', entryId, status, expected);
  return { c, $, state, fixture, head, act };
}

test('unreviewed source, inference and counter cards all begin pending without writes and escape private text', async () => {
  const h = await harness(), before = JSON.stringify(h.c.payload), html = h.c.storeInsightsHTML('s');
  for (const label of ['原文有記載', '分析推論', '反向線索', 'Kit已確認', '待查核', '不符合']) assert.ok(html.includes(label), label);
  assert.equal((html.match(/data-insight-review="confirmed"/g) || []).length, 3);
  assert.equal((html.match(/data-status="pending">待查核/g) || []).length, 3);
  assert.match(html, /&lt;img/); assert.match(html, /&lt;script/); assert.match(html, /&lt;svg/); assert.match(html, /&lt;b/);
  assert.doesNotMatch(html, /<img|<script|<svg|<b>|SYNTHETIC_FULL_TEXT_MARKER/);
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0);
});

test('cancel and pending-to-pending are read-only; explicit review creates only one encrypted store revision', async () => {
  const h = await harness(), before = JSON.stringify(h.c.payload);
  await h.act('pending'); assert.equal(h.state.confirms.length, 0); assert.equal(JSON.stringify(h.c.payload), before);
  h.state.confirmed = false; await h.act('confirmed'); assert.equal(h.state.confirms.length, 1); assert.equal(h.state.writes.length, 0); assert.equal(JSON.stringify(h.c.payload), before);
  h.state.confirmed = true; await h.act('confirmed');
  assert.equal(h.state.writes.length, 1); assert.equal(h.c.localRevision, 8);
  const saved = await core.unseal(h.state.disk.envelope, h.c.key, 'device');
  assert.deepEqual(saved.bundle.ops.slice(0, h.fixture.bundle.ops.length), h.fixture.bundle.ops);
  assert.equal(saved.bundle.ops.length, h.fixture.bundle.ops.length + 1);
  const added = saved.bundle.ops.at(-1); assert.equal(added.type, 'store'); assert.equal(added.entity, 's'); assert.equal(Object.hasOwn(added, 'visitAttendance'), false);
  assert.deepEqual(core.project(saved.bundle).find(record => record.id === 'v'), core.project(h.fixture.bundle).find(record => record.id === 'v'));
  assert.deepEqual(core.project(saved.bundle).find(record => record.id === 'other'), core.project(h.fixture.bundle).find(record => record.id === 'other'));
  assert.deepEqual(saved.pendingSync.entities, ['store:s']); assert.equal(saved.token, 'synthetic-token');
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.briefOpens.at(-1))), ['s', { preservePosition: true }]);
  assert.equal(h.state.renders, 1);
  const confirms = h.state.confirms.length; await h.act('confirmed'); assert.equal(h.state.writes.length, 1); assert.equal(h.state.confirms.length, confirms);
  assert.match(h.state.confirms.at(-1), /Synthetic source/); assert.match(h.state.confirms.at(-1), /Kit已確認/);
});

test('stale target and stale source cannot be reviewed even if card remains on screen', async () => {
  for (const type of ['store', 'visit']) {
    const h = await harness(), expected = h.head(), record = h.c.by(type, type === 'store' ? 's' : 'v');
    h.c.payload.bundle.ops.push(core.revision(type, record.id, { ...record.heads[0].data }, [record.heads[0].id], 'synthetic-concurrent'));
    const before = JSON.stringify(h.c.payload);
    await assert.rejects(h.act('confirmed', 'entry-0', expected));
    assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0); assert.equal(h.state.confirms.length, 0);
  }
});

test('session, screen and source are rechecked after confirmation with no stale write or success notice', async () => {
  const changes = [h => h.c.key = {}, h => h.c.payload = null, h => h.c.pendingLock = true, h => h.c.document.hidden = true, h => h.$('review').open = false, h => h.$('review').dataset.singleStoreId = 'other',
    h => { const v = h.c.by('visit', 'v'); h.c.payload.bundle.ops.push(core.revision('visit', 'v', { ...v.heads[0].data }, [v.heads[0].id], 'synthetic-race')); }];
  for (const change of changes) {
    const h = await harness(); h.state.confirmHook = () => change(h);
    await assert.rejects(h.act('confirmed'));
    assert.equal(h.state.writes.length, 0); assert.equal(h.state.briefOpens.length, 0); assert.equal(h.state.renders, 0); assert.equal(h.state.notices.length, 0);
  }
});

test('editing, encrypted drafts, competing dialogs and background state block review without clearing anything', async () => {
  const changes = [h => h.c.editorContext = {}, h => h.c.singleStoreContext = {}, h => h.c.inlineTextContext = {}, h => h.c.reminderContext = {}, h => h.c.payload.draft = {}, h => h.c.payload.inlineTextDraft = {}, h => h.c.backupPreview = {}, h => h.c.insightsPreview = {}, h => h.c.attendancePrompt = {}, h => h.state.pendingCSV = true, h => h.c.syncInProgress = true, h => h.c.pendingLock = true, h => h.c.document.hidden = true,
    ...['quick-text-dialog', 'store-reminder-dialog', 'rebuild-dialog'].map(id => h => h.$(id).open = true),
    h => h.c.payload.reminderDrafts = [{ format: 'store-reminder-draft-1', storeId: 's', storeName: 'Synthetic', parents: [h.head()], baseEvery: '', baseLegacy: '', savedAt: generatedAt, fields: { next: 'Synthetic draft', every: '', customText: '', customApplied: '', convert: false, customChecked: false } }]
  ];
  for (const change of changes) {
    const h = await harness(); change(h); const before = JSON.stringify(h.c.payload);
    await assert.rejects(h.act('confirmed'));
    assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.confirms.length, 0); assert.equal(h.state.writes.length, 0);
  }
});

test('encryption and disk failures preserve the unsaved review and do not announce success', async () => {
  for (const change of [h => h.c.key = {}, h => h.c.localRevision++, h => h.state.disk.revision++]) {
    const h = await harness(), before = JSON.stringify(h.c.payload); h.state.sealHook = () => change(h);
    await assert.rejects(h.act('confirmed'), /儲存期間|另一個視窗/);
    assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0); assert.equal(h.state.notices.length, 0); assert.equal(h.state.briefOpens.length, 0);
  }
  const h = await harness(), before = JSON.stringify(h.c.payload); h.state.failWrite = true;
  await assert.rejects(h.act('confirmed'), /disk full/); assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.notices.length, 0);
  h.state.failWrite = false; await h.act('confirmed'); assert.equal(h.state.writes.length, 1); assert.equal(h.state.notices.length, 1);
});

test('a session change after disk commit never reopens private content or reports success in the lost session', async () => {
  const h = await harness(), before = JSON.stringify(h.c.payload), sessionKey = h.c.key;
  h.state.writeHook = () => { h.c.key = null; };
  await assert.rejects(h.act('confirmed'), /本機寫入已完成.*工作階段已變更/);
  assert.equal(h.state.writes.length, 1); assert.equal(h.state.briefOpens.length, 0); assert.equal(h.state.renders, 0); assert.equal(h.state.notices.length, 0); assert.equal(JSON.stringify(h.c.payload), before);
  const saved = await core.unseal(h.state.disk.envelope, sessionKey, 'device');
  assert.equal(saved.bundle.ops.length, h.fixture.bundle.ops.length + 1);
  assert.equal(core.insightReviewForEntry(core.project(saved.bundle).find(record => record.id === 's'), h.fixture.input.stores[0].insights.entries[0]).status, 'confirmed');
});

test('a double tap during encryption cannot create duplicate review versions', async () => {
  const h = await harness(); let release, entered;
  const ready = new Promise(resolve => entered = resolve), waiting = new Promise(resolve => release = resolve);
  h.state.sealHook = async () => { entered(); await waiting; };
  const first = h.act('rejected'); await ready;
  const second = h.act('rejected'); release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(h.state.writes.length, 1); assert.equal(h.c.payload.bundle.ops.length, h.fixture.bundle.ops.length + 1);
});

test('rejection hides only the reviewed card in normal viewing, with recoverable collapsed history', async () => {
  const h = await harness(); await h.act('rejected');
  const html = h.c.storeInsightsHTML('s'), start = html.indexOf('<details class="insight-review-archive"');
  assert.ok(start >= 0, 'A compact review-history entry remains available');
  const ordinary = html.slice(0, start), history = html.slice(start);
  assert.doesNotMatch(ordinary, /Synthetic source &lt;img/); assert.match(ordinary, /Synthetic inference &lt;img/); assert.match(ordinary, /Synthetic counter &lt;img/);
  assert.match(history, /Synthetic source &lt;img/); assert.match(history, /不符合/); assert.match(history, /data-insight-review="pending"/);
  assert.doesNotMatch(history.match(/^<details[^>]*>/)[0], /\bopen\b/);
  assert.doesNotMatch(html, /SYNTHETIC_FULL_TEXT_MARKER|<script|<img/);
  await h.act('pending');
  const restored = h.c.storeInsightsHTML('s'); assert.match(restored.slice(0, restored.indexOf('<details class="insight-review-archive"')), /Synthetic source &lt;img/);
  const events = core.storeInsightReviewHistory(h.c.by('store', 's'));
  assert.equal(events.length, 2); assert.deepEqual(new Set(events.map(event => event.status)), new Set(['rejected', 'pending']));
  assert.equal(h.state.writes.length, 2);
});

test('all-rejected stores still offer collapsed review history rather than an empty or lost record', async () => {
  const h = await harness(); for (const id of ['entry-0', 'entry-1', 'entry-2']) await h.act('rejected', id);
  const html = h.c.storeInsightsHTML('s'), start = html.indexOf('<details class="insight-review-archive"');
  assert.ok(start >= 0); assert.doesNotMatch(html.slice(0, start), /data-store-insight=/);
  assert.match(html.slice(start), /Synthetic source &lt;img/); assert.match(html.slice(start), /Synthetic inference &lt;img/); assert.match(html.slice(start), /Synthetic counter &lt;img/);
  assert.equal(core.storeInsightReviewHistory(h.c.by('store', 's')).length, 3);
});

test('changed content never inherits a Kit approval and removed cards retain their review snapshots', async () => {
  const h = await harness(); await h.act('confirmed'); await h.act('rejected', 'entry-1');
  const current = h.c.by('store', 's'), profile = structuredClone(current.preVisitInsights);
  profile.entries[0].headline = 'Synthetic changed content needs a new review'; profile.entries = [profile.entries[0]];
  h.c.payload.bundle.ops.push(core.revision('store', 's', { ...current.heads[0].data, preVisitInsights: profile }, [current.heads[0].id], 'synthetic-new-analysis'));
  const html = h.c.storeInsightsHTML('s'), start = html.indexOf('<details class="insight-review-archive"');
  assert.match(html.slice(0, start), /Synthetic changed content needs a new review/);
  assert.match(html.slice(0, start), /data-status="pending">待查核/);
  assert.match(html.slice(start), /Synthetic source &lt;img/); assert.match(html.slice(start), /Synthetic inference &lt;img/);
  assert.doesNotMatch(html.slice(start), /data-insight-review="/);
  assert.equal(h.state.writes.length, 2);
});
