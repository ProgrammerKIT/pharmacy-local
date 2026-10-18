import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { uiNodeFixture } from './helpers/ui-node-fixture.mjs';
import { emptyBundle, revision, project, validateBundle, makeVisitAttendance, visitAttendanceForStore,
  dayPlanDate, shiftDayPlanDate, dayPlanForStore, dayPlanOverview, dayItineraryBasis, applyDayItineraryAction } from '../public/core.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(first, next) {
  const start = app.indexOf(first), end = app.indexOf(next, start);
  assert.ok(start >= 0 && end > start, 'Exercise the actual direct itinerary UI implementation');
  return app.slice(start, end);
}
const implementation = section('function storeSelectionIdentity(', 'function monthlyVisitRowsHTML(')
  + section('async function run(', 'function programDetail(')
  + section('function dayPlanLabel(', 'function renderVisits(');

// Only synthetic data. Real projection, revision, action and validation helpers
// run against DOM/persistence stubs; browser QA covers the actual encrypted store.
function fixture() {
  const now = new Date().toISOString(), date = shiftDayPlanDate(dayPlanDate(), 1);
  const bundle = emptyBundle('synthetic-direct-day-plan');
  for (const id of ['a', 'b', 'c']) bundle.ops.push(revision('store', id, {
    name: id === 'a' ? '虛構 <script> 門市' : '虛構 ' + id, city: '虛構市', district: '', channel: '', attr: '', contact: '', everyTimeMust: '保留固定提醒',
    nextRememberTasks: [{ id: id + '-pending', text: 'HAUD×2盒', createdAt: now, completedAt: '' }, { id: id + '-done', text: '已完成測試事項', createdAt: now, completedAt: now }],
  }, [], 'synthetic', false, id === 'a' ? makeVisitAttendance('a', now) : undefined));
  bundle.ops.push(revision('visit', 'note', { store: 'a', date: '', text: '保留原文\r\n 與空白 ', next: '', source: 'synthetic', people: [], topics: [], attachments: [] }, [], 'synthetic'));
  const original = structuredClone(bundle), key = {}, meta = {}, elements = new Map(), writes = [];
  const { node } = uiNodeFixture();
  const sandbox = vm.createContext({ recoveryExportContext: null, clearRecoveryExport() {}, weeklyContext: null, weeklyRunning: false, weeklyState: null, clearWeeklySetup() {},
    dayPlanContext: null, monthlyVisitContext: null, dayPlanSelectedDate: date, dayPlanViewBasis: '', dayPlanSorting: false, dayPlanNotice: '', dayPlanUndo: null,
    key, meta, localRevision: 4, syncEpoch: 8, payload: { bundle, device: 'synthetic', dirty: false }, records: project(bundle),
    document: { hidden: false, querySelector() { return node('day-plan-dialog').open ? node('day-plan-dialog') : null; } },
    pendingLock: false, updateHolding: false, autoFetching: false, syncInProgress: false, busy: false,
    editorContext: null, reminderContext: null, singleStoreContext: null, inlineTextContext: null,
    $: node, structuredClone, project, dayPlanDate, shiftDayPlanDate, dayPlanForStore, dayPlanOverview, dayItineraryBasis, applyDayItineraryAction,
    reviewHeads: row => row.heads.map(head => head.id).sort(), by: (type, id) => project(sandbox.payload.bundle).find(row => row.type === type && row.id === id),
    storeIdentityPending: row => row.csvIdentityPending === true,
    esc: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
    dateText: value => value, csvImport: { hasPending() { return false; } }, buttons() {}, lockNow() {}, syncScheduler: { wake() {} },
    render() { sandbox.records = project(sandbox.payload.bundle); sandbox.renderDayPlan(); },
    dismissKeyboard() {}, openDialog(dialog) { dialog.open = true; },
    toast(message) { sandbox.lastToast = message; }, confirm() { throw new Error('Direct day-plan actions must not add a confirmation workflow'); },
    persistCalls: 0, persistFailure: false, persistPause: null,
    async persist(next, { guard }) {
      sandbox.persistCalls++; guard();
      if (sandbox.persistPause) await sandbox.persistPause;
      guard();
      if (sandbox.persistFailure) throw new Error('synthetic disk failure');
      validateBundle(next.bundle); writes.push(structuredClone(next)); sandbox.payload = next; sandbox.localRevision++;
    },
    confirmStoreSave() { throw new Error('Must never request actual attendance while planning'); },
  });
  vm.runInContext(implementation, sandbox); sandbox.renderDayPlan();
  const act = (action, id = 'a') => sandbox.run(() => sandbox.performDayItineraryAction(action, id), 'day-plan-error');
  return { sandbox, original, node, writes, date, act,
    open() { sandbox.openDayPlanSelection(); }, close() { sandbox.closeDayPlanEditor(); },
    undo() { return sandbox.run(() => sandbox.restoreLastDayPlanCancellation(), 'day-plan-error'); },
    order() { return dayPlanOverview(project(sandbox.payload.bundle), date).stores.map(row => row.storeId); },
  };
}
function assertPreserved(f) {
  const saved = f.sandbox.payload.bundle, added = saved.ops.slice(f.original.ops.length);
  assert.deepEqual(saved.ops.slice(0, f.original.ops.length), f.original.ops); assert.deepEqual(saved.blobs, f.original.blobs);
  assert.ok(added.every(op => op.type === 'store' && !Object.hasOwn(op, 'visitAttendance')));
  for (const store of project(saved).filter(row => row.type === 'store')) {
    const before = structuredClone(project(f.original).find(row => row.id === store.id).heads[0].data), after = structuredClone(store.heads[0].data);
    delete before.datePlans; delete after.datePlans; delete before.datePlanOrder; delete after.datePlanOrder;
    assert.deepEqual(after, before);
  }
  assert.deepEqual(visitAttendanceForStore(saved, 'a'), visitAttendanceForStore(f.original, 'a'));
}

test('opening and closing the add dialog is read-only with escaped buttons and no confirmation stage', () => {
  const f = fixture(); f.open();
  assert.match(f.node('day-store-options').innerHTML, /虛構 &lt;script&gt; 門市/);
  assert.doesNotMatch(f.node('day-store-options').innerHTML, /<script>|checkbox|核對並儲存/);
  f.close(); assert.equal(f.sandbox.dayPlanContext, null); assert.equal(f.node('day-plan-dialog').open, false);
  assert.equal(f.sandbox.persistCalls, 0); assert.deepEqual(f.sandbox.payload.bundle, f.original);
});

test('each explicit add saves once and renews the retained picker for the next add', async () => {
  const f = fixture(); f.open(); const ctx = f.sandbox.dayPlanContext;
  f.sandbox.renderDayPlanChoices('虛構');
  await f.act('add'); assert.equal(f.writes.length, 1); assert.equal(f.sandbox.dayPlanContext, ctx);
  assert.equal(ctx.bundle, f.sandbox.payload.bundle); assert.equal(ctx.revision, f.sandbox.localRevision);
  assert.equal(ctx.query, '虛構'); assert.equal(f.node('day-plan-dialog').open, true);
  assert.match(f.node('day-plan-selection-count').textContent, /已排 1/);
  await f.act('add', 'b'); assert.equal(f.writes.length, 2); assert.deepEqual(f.order(), ['a', 'b']);
  await f.act('add', 'b'); assert.equal(f.writes.length, 2); assert.match(f.sandbox.lastToast, /沒有變更/);
  f.close(); assertPreserved(f);
});

test('direct cancel, undo and up/down persist the intended date and retain reminders and all prior data', async () => {
  const f = fixture(); f.open();
  for (const id of ['a', 'b', 'c']) await f.act('add', id);
  f.close(); assert.deepEqual(f.order(), ['a', 'b', 'c']);
  await f.act('up', 'c'); assert.deepEqual(f.order(), ['a', 'c', 'b']);
  await f.act('down', 'c'); assert.deepEqual(f.order(), ['a', 'b', 'c']);
  await f.act('cancel', 'b'); assert.deepEqual(f.order(), ['a', 'c']);
  assert.equal(f.sandbox.dayPlanUndo.storeId, 'b'); assert.equal(f.sandbox.dayPlanContext, null);
  assert.match(f.node('day-plan-content').innerHTML, /已取消安排/);
  await f.undo(); assert.deepEqual(f.order(), ['a', 'b', 'c']); assert.equal(f.sandbox.dayPlanUndo, null);
  assertPreserved(f);
  assert.doesNotMatch(f.node('day-plan-content').innerHTML, /出門前，帶齊這些|核對準備|data-day-pack|已完成測試事項/);
  assert.match(f.node('day-plan-content').innerHTML, /HAUD×2盒|保留固定提醒/);
});

test('failed direct add retains picker/search, shows no success, and can be retried safely once', async () => {
  const f = fixture(); f.open(); const ctx = f.sandbox.dayPlanContext; f.sandbox.renderDayPlanChoices('虛構');
  f.sandbox.persistFailure = true; await f.act('add');
  assert.equal(f.writes.length, 0); assert.equal(f.sandbox.dayPlanContext, ctx); assert.equal(ctx.query, '虛構');
  assert.deepEqual(f.sandbox.payload.bundle, f.original); assert.equal(f.node('day-plan-dialog').open, true);
  assert.match(f.node('day-plan-error').textContent, /synthetic disk failure/); assert.equal(f.sandbox.dayPlanNotice, '');
  f.sandbox.persistFailure = false; await f.act('add'); assert.equal(f.writes.length, 1); assertPreserved(f);
});

test('stale data, active sync and selected-date changes refuse a retained picker before writing', async t => {
  const cases = [
    ['epoch', s => s.syncEpoch++], ['revision', s => s.localRevision++], ['bundle', s => { s.payload.bundle = structuredClone(s.payload.bundle); }],
    ['date', s => { s.dayPlanSelectedDate = shiftDayPlanDate(s.dayPlanSelectedDate, 1); }], ['fetch', s => { s.autoFetching = true; }],
    ['sync', s => { s.syncInProgress = true; }], ['background', s => { s.document.hidden = true; }], ['lock', s => { s.pendingLock = true; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const f = fixture(); f.open(); const ctx = f.sandbox.dayPlanContext; mutate(f.sandbox); await f.act('add');
    assert.equal(f.sandbox.persistCalls, 0); assert.equal(f.writes.length, 0); assert.equal(f.sandbox.dayPlanContext, ctx);
    assert.match(f.node('day-plan-error').textContent, /尚未寫入/);
  });
});

test('background during a direct save cannot renew the in-flight guard or show optimistic success', async () => {
  const f = fixture(); f.open(); const ctx = f.sandbox.dayPlanContext;
  let resume; f.sandbox.persistPause = new Promise(resolve => { resume = resolve; });
  const saving = f.act('add'); assert.equal(f.sandbox.busy, true);
  f.sandbox.syncEpoch++; f.sandbox.resumeDayPlanContext(); assert.equal(ctx.epoch, 8);
  resume(); await saving; assert.equal(f.writes.length, 0); assert.deepEqual(f.sandbox.payload.bundle, f.original);
  assert.equal(f.sandbox.dayPlanNotice, ''); assert.equal(f.node('day-plan-dialog').open, true);
  assert.match(f.node('day-plan-error').textContent, /尚未寫入/);
});

test('duplicate taps during an in-flight add cannot create a second revision', async () => {
  const f = fixture(); f.open(); let resume;
  f.sandbox.persistPause = new Promise(resolve => { resume = resolve; });
  const saving = f.act('add'); await f.act('add'); assert.equal(f.sandbox.persistCalls, 1);
  resume(); await saving; assert.equal(f.writes.length, 1); assertPreserved(f);
});

test('stale rendered action and stale undo cannot overwrite a later store revision', async () => {
  const f = fixture(); f.open(); await f.act('add'); f.close(); await f.act('cancel');
  const store = project(f.sandbox.payload.bundle).find(row => row.id === 'a');
  const next = structuredClone(f.sandbox.payload.bundle);
  next.ops.push(revision('store', 'a', { ...store.heads[0].data, contact: '虛構較新聯絡資料' }, store.heads.map(head => head.id), 'synthetic-other'));
  f.sandbox.payload.bundle = next; f.sandbox.localRevision++; f.sandbox.records = project(next);
  const writeCount = f.writes.length; await f.act('restore');
  assert.equal(f.writes.length, writeCount); assert.match(f.node('day-plan-error').textContent, /新版本/);
  f.sandbox.render(); await f.undo(); assert.equal(f.writes.length, writeCount);
  assert.match(f.node('day-plan-error').textContent, /已有更新/);
  assert.equal(project(f.sandbox.payload.bundle).find(row => row.id === 'a').contact, '虛構較新聯絡資料');
});

test('failed cancel retains the active plan and creates no usable undo', async () => {
  const f = fixture(); f.open(); await f.act('add'); f.close();
  f.sandbox.persistFailure = true; await f.act('cancel');
  assert.deepEqual(f.order(), ['a']); assert.equal(f.sandbox.dayPlanUndo, null); assert.equal(f.sandbox.dayPlanContext, null);
  assert.equal(f.writes.length, 1); assert.match(f.node('day-plan-error').textContent, /synthetic disk failure/);
});

test('locking clears private itinerary and note displays using only DOM IDs that really exist', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const nodes = new Map([...html.matchAll(/<([a-z][a-z\d-]*)\b[^>]*\bid="([^"]+)"/gi)].map(([, tag, id]) => [id, {
    tag, id, open: false, hidden: false, textContent: '', innerHTML: '', value: '',
    classList: { add() {}, remove() {} }, close() { this.open = false; },
    reset() { this.value = ''; }, replaceChildren() { this.textContent = ''; this.innerHTML = ''; },
  }]));
  // Strict lookup matters: an auto-creating DOM stub masks references to removed
  // confirmation nodes, allowing a privacy-lock exception to pass unnoticed.
  const strictNode = id => nodes.get(id) || null;
  assert.equal(strictNode('day-plan-confirmation'), null);
  for (const id of ['day-plan-content', 'day-plan-entry', 'day-plan-fields', 'visit-list', 'review-body']) {
    assert.ok(strictNode(id), id + ' must exist'); strictNode(id).textContent = 'synthetic private content';
  }
  const c = vm.createContext({ recoveryExportContext: null, clearRecoveryExport() {}, weeklyContext: null, weeklyRunning: false, weeklyState: null, clearWeeklySetup() {},
    $: strictNode, document: { hidden: false, body: { classList: { add() {}, remove() {} } }, querySelectorAll: selector => selector === 'dialog' ? [...nodes.values()].filter(node => node.tag === 'dialog') : [] },
    syncScheduler: { pause() {}, reset() {} }, forgetBriefSearchQuery() {}, captureTransientResumeState() {}, clearNearbyPosition() {},
    resetStoreFilters() {}, resetReminderOptionGroup() {}, showGate() {}, clearTimeout() {}, clearInterval() {},
    busy: false, backupPreview: null, insightsPreview: null, storeMergePreview: null, storeMergeSetup: null,
    editorContext: null, inlineTextContext: null, reminderContext: null, dayPlanContext: null, monthlyVisitContext: null,
    payload: { bundle: emptyBundle('synthetic-lock') }, key: {}, meta: {}, records: [{ name: 'synthetic private store' }],
    pendingLock: false, syncEpoch: 1, csvImport: { hasPending() { return false; }, reset() {} },
    reminderDraftTimer: null, inlineDraftTimer: null, autoTimer: null, objectURLs: [],
    dayPlanUndo: { date: '2026-10-14', storeId: 'synthetic' }, dayPlanNotice: 'synthetic private notice', dayPlanSorting: true, dayPlanViewBasis: 'synthetic private basis',
  });
  vm.runInContext(section('function lockNow(', 'async function showGate('), c);
  assert.doesNotThrow(() => c.lockNow(false));
  for (const id of ['day-plan-content', 'day-plan-entry', 'day-plan-fields', 'visit-list', 'review-body']) assert.equal(strictNode(id).textContent, '');
  assert.equal(c.payload, null); assert.equal(c.key, null); assert.equal(c.meta, null); assert.equal(c.records.length, 0);
  assert.equal(c.dayPlanUndo, null); assert.equal(c.dayPlanNotice, ''); assert.equal(c.dayPlanViewBasis, '');
  assert.equal(strictNode('workspace').hidden, true); assert.equal(strictNode('gate').hidden, false);
});
