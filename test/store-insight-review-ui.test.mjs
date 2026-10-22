import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../public/core.js';
import { makeUnmappedFixture, mappingInput } from './qa/shared-relation-fixture.mjs';

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
    insightsPreview: null, backupPreview: null, coordinatePreview: null, enrichmentPreview: null, versionReview: null, resolutionPreview: null, editorContext: null, singleStoreContext: null, inlineTextContext: null, reminderContext: null, dayPlanContext: null, monthlyVisitContext: null, attendancePrompt: null,
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

test('current confirmed cards collapse to an escaped headline while keeping details and review actions read-only', async () => {
  const h = await harness(); await h.act('confirmed');
  const before = JSON.stringify(h.c.payload), writes = h.state.writes.length;
  const entry = core.storeInsightsForStore(h.c.payload.bundle, 's').entries[0];
  const html = h.c.insightEntryHTML(entry, '2026-10-07', '', h.c.by('store', 's'));
  const summary = html.match(/<summary>([\s\S]*?)<\/summary>/)[1];
  assert.match(summary, /Synthetic source &lt;img src=x&gt; headline/);
  assert.match(summary, /Kit已確認/);
  assert.doesNotMatch(summary, /這次可以問|原文有記載|data-insight-review|Synthetic.*question/);
  const outer = html.match(/<details[^>]*>/)[0];
  assert.match(outer, /data-insight-confirmed="entry-0"/);
  assert.doesNotMatch(outer, /\bopen\b|data-insight-detail=/);
  assert.match(html, /data-insight-detail="entry-0"/); // Opening evidence before confirming must not reopen the outer card.
  for (const kept of ['這次可以問', 'Synthetic &lt;svg&gt; caution', 'Synthetic &lt;b&gt; limitation', 'data-insight-source=', 'data-insight-review="pending"']) assert.ok(html.includes(kept), kept);
  assert.doesNotMatch(html, /<img|<script|<svg|SYNTHETIC_FULL_TEXT_MARKER/);
  const snapshot = h.c.insightEntryHTML(entry, '2026-10-07', 'history:');
  assert.doesNotMatch(snapshot, /insight-confirmed-details/); // Import/history snapshots stay fully inspectable within their own disclosures.
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, writes);
  await h.act('pending');
  assert.doesNotMatch(h.c.insightEntryHTML(entry, '2026-10-07', '', h.c.by('store', 's')), /insight-confirmed-details/);
});

test('fully confirmed stores omit the pending-review introduction without rewriting card headlines', async () => {
  const h = await harness();
  for (const id of ['entry-0', 'entry-1', 'entry-2']) await h.act('confirmed', id);
  const html = h.c.storeInsightsHTML('s'), current = html.slice(0, html.indexOf('<details class="insight-review-archive"'));
  assert.doesNotMatch(current, /先看線索與原文，再由你人工審核/);
  assert.equal((current.match(/class="insight-confirmed-details"/g) || []).length, 3);
  assert.doesNotMatch(current, /data-insight-detail="more"/);
  for (const level of ['source', 'inference', 'counter']) assert.ok(current.includes(`Synthetic ${level} &lt;img src=x&gt; headline`));
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
  assert.doesNotMatch(html.slice(0, start), /insight-confirmed-details/);
  assert.match(html.slice(0, start), /這次可以問/);
  assert.match(html.slice(start), /Synthetic source &lt;img/); assert.match(html.slice(start), /Synthetic inference &lt;img/);
  assert.doesNotMatch(html.slice(start), /data-insight-review="/);
  assert.equal(h.state.writes.length, 2);
});


test('source changes preserve only current confirmed cards; rejected cards remain solely in history without writes', async () => {
  const h = await harness();
  await h.act('confirmed', 'entry-0'); await h.act('rejected', 'entry-1');
  h.c.payload.bundle.ops.push(core.revision('visit', 'v', { ...h.fixture.visit.data }, [h.fixture.visit.id], 'synthetic-new-version'));
  const before = JSON.stringify(h.c.payload), writes = h.state.writes.length;
  const html = h.c.storeInsightsHTML('s'), boundary = html.indexOf('<details class="insight-review-archive"');
  const current = html.slice(0, boundary), history = html.slice(boundary);
  assert.match(current, /data-insight-confirmed="entry-0"/); assert.match(current, /來源已更新/);
  assert.doesNotMatch(current, /Synthetic inference|Synthetic counter|data-insight-review=/);
  assert.match(history, /Synthetic inference/); assert.match(history, /不符合/);
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, writes);
});

async function sharedHarness({ mapped = true } = {}) {
  const h = await harness(), original = await makeUnmappedFixture(core), input = mappingInput(core, original);
  h.c.payload.bundle = mapped ? core.applyStoreInsightRelations(original, input, core.planStoreInsightRelations(original, input), 'synthetic-ui-mapping') : original;
  h.c.meta.vaultId = original.vaultId;
  h.$('review').dataset.singleStoreId = 'qa-shared-b';
  const change = async (id, status) => {
    const storeId = 'qa-shared-' + id, store = h.c.by('store', storeId);
    h.$('review').dataset.singleStoreId = storeId;
    return h.c.changeInsightReview(storeId, 'qa-shared-relation-' + id, status, store.heads[0].id);
  };
  return { ...h, original, input, change };
}

test('shared confirmation retains the exact peer headline inside a collapsed group with provenance and own history only', async () => {
  const h = await sharedHarness(), before = JSON.stringify(h.c.payload), html = h.c.storeInsightsHTML('qa-shared-b');
  const boundary = html.indexOf('<details class="insight-review-archive"'), current = html.slice(0, boundary), history = html.slice(boundary);
  assert.match(current, /<details class="confirmed-insights-group"[^>]*><summary>已確認線索 · 1 項<\/summary>/);
  assert.doesNotMatch(current.match(/<details class="confirmed-insights-group"[^>]*>/)[0], /\bopen\b/);
  const summary = current.match(/<details class="insight-confirmed-details"[^>]*><summary>([\s\S]*?)<\/summary>/)[1];
  assert.match(summary, /陳示範的舊同事是林測試與王合成/); assert.match(summary, /Kit已確認/);
  assert.doesNotMatch(summary, /沿用|青禾|這次可以問/);
  assert.match(current, /data-insight-shared-from="qa-shared-a"/); assert.match(current, /沒有新增本店的審核紀錄/);
  assert.doesNotMatch(current.match(/<details class="insight-confirmed-details"[^>]*>/)[0], /\bopen\b/);
  assert.match(current, /門市展示需求仍待查核/); assert.doesNotMatch(current, /已否認的共同採購/);
  assert.match(history, /歷史 1 筆/); assert.match(history, /已否認的共同採購/); assert.doesNotMatch(history, /陳示範的舊同事/);
  assert.equal(core.insightReviewForEntry(h.c.by('store', 'qa-shared-b'), h.c.by('store', 'qa-shared-b').preVisitInsights.entries[0]).status, 'pending');
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0);
  assert.doesNotMatch(h.c.storeInsightsHTML('qa-shared-d'), /data-insight-confirmed=/, 'matching card IDs never establish UI approval');
});

test('shared confirmed source-update notices remain available inside collapsed details without inventing local review', async () => {
  const h = await sharedHarness(), visit = h.c.by('visit', 'qa-shared-note-a');
  h.c.payload.bundle.ops.push(core.revision('visit', visit.id, { ...visit.heads[0].data, text: visit.text + '\n合成新版' }, [visit.heads[0].id], 'synthetic-ui-new-source'));
  const before = JSON.stringify(h.c.payload), entry = core.storeInsightDisplayForStore(h.c.payload.bundle, 'qa-shared-b').entries.find(item => item.id === 'qa-shared-relation-b');
  const html = h.c.insightEntryHTML(entry, '2026-10-16', '', h.c.by('store', 'qa-shared-b'));
  assert.match(html, /data-insight-confirmed="qa-shared-relation-b"/);
  assert.match(html.slice(0, html.lastIndexOf('</details>')), /來源已更新/);
  assert.doesNotMatch(html.slice(html.lastIndexOf('</details>')), /來源已更新/);
  assert.match(html, /data-insight-owner="qa-shared-b"/); assert.doesNotMatch(html, /data-insight-review=/);
  assert.equal(core.storeInsightReviewHistory(h.c.by('store', 'qa-shared-b')).length, 1);
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0);
});

test('an explicit local pending keeps the original donor confirmation, retains its detailed warning, and stops third-party inheritance', async () => {
  const h = await sharedHarness(), previous = structuredClone(h.c.payload.bundle);
  await h.change('b', 'pending');
  assert.equal(h.state.writes.length, 1); assert.equal(h.c.payload.bundle.ops.length, previous.ops.length + 1);
  assert.deepEqual(h.c.payload.bundle.ops.slice(0, previous.ops.length), previous.ops);
  assert.match(h.state.confirms.at(-1), /不撤回 虛構青禾藥局 的原確認/); assert.match(h.state.confirms.at(-1), /尚未親自審核的門市會停止沿用/);
  const donorEntry = core.storeInsightDisplayForStore(h.c.payload.bundle, 'qa-shared-a').entries[0];
  const donorHTML = h.c.insightEntryHTML(donorEntry, '2026-10-16', '', h.c.by('store', 'qa-shared-a'));
  assert.match(donorHTML, /data-insight-confirmed="qa-shared-relation-a"/);
  assert.match(donorHTML.slice(0, donorHTML.lastIndexOf('</details>')), /人工判定不一致/);
  assert.doesNotMatch(donorHTML.slice(donorHTML.lastIndexOf('</details>')), /人工判定不一致/);
  for (const id of ['b', 'c']) {
    const html = h.c.storeInsightsHTML('qa-shared-' + id);
    assert.doesNotMatch(html, /data-insight-confirmed=/); assert.match(html, /人工判定不一致/);
  }
  assert.equal(core.storeInsightReviewHistory(h.c.by('store', 'qa-shared-c')).length, 0);
});

test('confirmation preview discloses excluded explicit decisions and does not promise inheritance during disagreement', async () => {
  const h = await sharedHarness(); await h.change('b', 'pending');
  h.state.confirmed = false; const before = JSON.stringify(h.c.payload), writes = h.state.writes.length;
  await h.change('c', 'confirmed');
  const prompt = h.state.confirms.at(-1);
  assert.match(prompt, /共同人物關係：林測試、陳示範、王合成曾在同一間虛構藥局共事/);
  assert.match(prompt, /人工判定仍不一致/); assert.match(prompt, /尚未親自審核的門市暫不沿用/);
  assert.match(prompt, /不會被此次操作覆蓋：虛構晨光藥局/); assert.doesNotMatch(prompt, /可沿用確認的門市/);
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, writes);
});

test('relationship file import shows complete named mapping and waits for checked confirmation before encrypted persistence', async () => {
  const h = await sharedHarness({ mapped: false }), before = structuredClone(h.c.payload.bundle);
  h.$('review').close();
  await h.c.previewInsightsFile({ size: 1000, text: async () => JSON.stringify(h.input) });
  const html = h.$('review-body').innerHTML;
  assert.equal(h.c.insightsPreview.kind, 'relations'); assert.match(h.$('review-title').textContent, /人物關係對應/);
  for (const name of ['虛構青禾藥局', '虛構晨光藥局', '虛構雲杉藥局']) assert.ok(html.includes(name));
  assert.match(html, /陳示範的舊同事是林測試與王合成/); assert.doesNotMatch(html, /undefined/);
  assert.match(html, /id="insights-ack" type="checkbox"/); assert.match(html, /id="apply-store-insights" class="primary" disabled/);
  assert.deepEqual(h.c.payload.bundle, before); assert.equal(h.state.writes.length, 0);
  await assert.rejects(h.c.commitInsights(), /勾選確認/); assert.equal(h.state.writes.length, 0);
  h.$('insights-ack').checked = true; await h.c.commitInsights();
  assert.equal(h.state.writes.length, 1);
  const saved = await core.unseal(h.state.disk.envelope, h.c.key, 'device');
  assert.deepEqual(saved.bundle.ops.slice(0, before.ops.length), before.ops);
  assert.equal(saved.bundle.ops.length, before.ops.length + 3);
  for (const oldStore of core.project(before).filter(row => row.type === 'store')) {
    const now = core.project(saved.bundle).find(row => row.type === 'store' && row.id === oldStore.id);
    assert.deepEqual(core.storeInsightReviewHistory(now), core.storeInsightReviewHistory(oldStore));
    assert.deepEqual(now.preVisitInsights, oldStore.preVisitInsights);
  }
  assert.equal(h.$('review').open, false); assert.equal(h.c.insightsPreview, null);
  assert.match(h.state.notices.at(-1), /人物關係對應/);
});

test('relationship import rejects stale heads, lost sessions and unchecked confirmation after asynchronous validation', async () => {
  for (const disrupt of [
    h => { const peer = h.c.by('store', 'qa-shared-c'); h.c.payload.bundle.ops.push(core.revision('store', peer.id, { ...peer.heads[0].data }, [peer.heads[0].id], 'synthetic-peer-race')); },
    h => { h.c.key = {}; }, h => { h.$('review').close(); }, h => { h.$('insights-ack').checked = false; }
  ]) {
    const h = await sharedHarness({ mapped: false }); h.$('review').close();
    await h.c.previewInsightsFile({ size: 1000, text: async () => JSON.stringify(h.input) }); h.$('insights-ack').checked = true;
    disrupt(h); const before = JSON.stringify(h.c.payload);
    await assert.rejects(h.c.commitInsights());
    assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0); assert.equal(h.state.notices.length, 0);
  }
  const h = await sharedHarness({ mapped: false }); h.$('review').close();
  await h.c.previewInsightsFile({ size: 1000, text: async () => JSON.stringify(h.input) }); h.$('insights-ack').checked = true;
  h.c.applyStoreInsightRelations = async (...args) => { const result = core.applyStoreInsightRelations(...args); h.$('insights-ack').checked = false; return result; };
  const before = JSON.stringify(h.c.payload); await assert.rejects(h.c.commitInsights(), /尚未寫入/);
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0);
});

test('unchanged relationship import shows no write action and counts existing member mappings accurately', async () => {
  const h = await sharedHarness(), before = JSON.stringify(h.c.payload), input = mappingInput(core, h.c.payload.bundle);
  h.$('review').close(); await h.c.previewInsightsFile({ size: 1000, text: async () => JSON.stringify(input) });
  const html = h.$('review-body').innerHTML;
  assert.match(html, /可套用 0 間/); assert.match(html, /內容相同 3 間/);
  assert.doesNotMatch(html, /id="insights-ack"|id="apply-store-insights"/);
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0);
});

test('relationship definitions are readable as full JSON and blocked from automatic safe conflict merging', async () => {
  const h = await sharedHarness(), store = h.c.by('store', 'qa-shared-b'), base = store.heads[0];
  vm.runInContext(source('function diffSegmentsHTML(', 'function renderQuickTextDialog(') + source('function describeData(', 'function openReview('), h.c);
  const description = h.c.describeData('store', base.data);
  assert.match(description, /共同人物關係對應/); assert.match(description, /"format": "pharmacy-insight-relation-1"/);
  assert.doesNotMatch(description, /\[object Object\]/);
  h.c.payload.bundle.ops.push(core.revision('store', store.id, { ...base.data, preVisitInsightRelations: [] }, [base.id], 'synthetic-relation-branch'));
  h.c.payload.bundle.ops.push(core.revision('store', store.id, { ...base.data, contact: '虛構新窗口' }, [base.id], 'synthetic-contact-branch'));
  const current = h.c.by('store', store.id), before = JSON.stringify(h.c.payload);
  const plan = h.c.safeConflictMerge(current);
  assert.equal(plan.safe, false); assert.ok(plan.blocked.some(item => item.field === 'preVisitInsightRelations' && item.kind === 'protected'));
  assert.match(h.c.reviewFields(base.data, { ...base.data, preVisitInsightRelations: [] }), /共同人物關係對應/);
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0);
});

test('peer source updates never invent a Kit confirmation or date on explicit-pending and never-reviewed cards', async () => {
  const h = await sharedHarness({ mapped: false });
  // B and C cite only their own current note; the changed source belongs to A.
  for (const id of ['b', 'c']) {
    const store = h.c.by('store', 'qa-shared-' + id), profile = structuredClone(store.preVisitInsights);
    profile.entries[0].evidence = profile.entries[0].evidence.filter(source => source.storeId === store.id);
    h.c.payload.bundle.ops.push(core.revision('store', store.id, { ...store.heads[0].data, preVisitInsights: profile }, [store.heads[0].id], 'synthetic-peer-evidence'));
  }
  const input = mappingInput(core, h.c.payload.bundle);
  h.c.payload.bundle = core.applyStoreInsightRelations(h.c.payload.bundle, input, core.planStoreInsightRelations(h.c.payload.bundle, input), 'synthetic-peer-mapping');
  await h.change('b', 'pending');
  const visit = h.c.by('visit', 'qa-shared-note-a');
  h.c.payload.bundle.ops.push(core.revision('visit', visit.id, { ...visit.heads[0].data, text: visit.text + '\n合成來源更新' }, [visit.heads[0].id], 'synthetic-source-update'));
  const before = JSON.stringify(h.c.payload), writes = h.state.writes.length;
  for (const id of ['b', 'c']) {
    const store = h.c.by('store', 'qa-shared-' + id), entry = core.storeInsightDisplayForStore(h.c.payload.bundle, store.id).entries.find(item => item.id === 'qa-shared-relation-' + id);
    assert.ok(entry); assert.equal(entry.sourceCurrent, false); assert.equal(entry.review.status, 'pending');
    const html = h.c.insightEntryHTML(entry, '2026-10-16', '', store);
    assert.match(html, /共同關係的來源已更新，需重新核對/);
    assert.match(html, /data-status="pending">待查核/);
    assert.doesNotMatch(html, /data-insight-confirmed=|保留原確認|Kit 已確認的紀錄|undefined|data-insight-review=/);
    if (id === 'b') { assert.match(html, /保留既有審核/); assert.match(html, /Kit · /); }
    else { assert.match(html, /尚未人工審核/); assert.doesNotMatch(html, /Kit · |保留既有審核/); }
  }
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, writes);
});
