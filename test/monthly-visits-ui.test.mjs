import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emptyBundle, revision, project, validateBundle, makeVisitAttendance, visitAttendanceForStore, attendanceTaipeiDate,
  monthlyVisitMonth, shiftMonthlyVisitMonth, monthlyVisitForStore, monthlyVisitOverview, monthlyVisitBasis, applyMonthlyVisitAction } from '../public/core.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function section(first, next) {
  const start = app.indexOf(first), end = app.indexOf(next, start);
  assert.ok(start >= 0 && end > start, 'Exercise the actual monthly visit UI implementation');
  return app.slice(start, end);
}
const implementation = section('async function run(', 'function programDetail(')
  + section('function monthlyVisitLabel(', 'function dayPlanLabel(');

// Only synthetic records, DOM and disk. Core projection, monthly membership,
// attendance and validation are the same functions used by the real App.
function fixture() {
  const now = new Date().toISOString(), month = monthlyVisitMonth(), nextMonth = shiftMonthlyVisitMonth(month, 1), bundle = emptyBundle('fictional-monthly-ui');
  for (const id of ['a', 'b', 'c', 'pending']) bundle.ops.push(revision('store', id, {
    name: id === 'a' ? '虛構 <script> 門市' : '虛構 ' + id, city: '虛構市', district: id === 'a' ? '<img>測試區' : '虛構區', channel: '', attr: ' 原有門市文字\r\n 保留 ', contact: '',
    everyTimeMust: '虛構固定事項', csvAliases: id === 'b' ? ['虛構原始別名'] : [], ...(id === 'pending' ? { csvIdentityPending: true } : {}),
    nextRememberTasks: [{ id: id + '-pending', text: '虛構提醒', createdAt: now, completedAt: '' }],
  }, [], 'fictional-device', false, id === 'a' ? makeVisitAttendance('a', now) : undefined));
  bundle.ops.push(revision('visit', 'fictional-original', { store: 'a', date: '', text: '  虛構拜訪原文\r\n保留。 ', next: '', source: 'fictional', people: [], topics: [], attachments: [] }, [], 'fictional-device'));
  const original = structuredClone(bundle), elements = new Map(), writes = [];
  function node(id) {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', open: false, hidden: false, value: '', dataset: {},
      replaceChildren() { this.innerHTML = ''; this.textContent = ''; }, close() { this.open = false; } });
    return elements.get(id);
  }
  const sandbox = vm.createContext({
    monthlyVisitContext: null, monthlyVisitSelectedMonth: month, monthlyVisitViewBasis: '', monthlyVisitNotice: '',
    dayPlanContext: null, editorContext: null, reminderContext: null, singleStoreContext: null, inlineTextContext: null,
    key: {}, meta: {}, localRevision: 5, syncEpoch: 9, payload: { bundle, device: 'fictional-device', dirty: false }, records: project(bundle),
    document: { hidden: false, querySelector() { return node('monthly-visit-dialog').open ? node('monthly-visit-dialog') : null; } },
    pendingLock: false, updateHolding: false, autoFetching: false, syncInProgress: false, busy: false,
    $: node, structuredClone, project, monthlyVisitMonth, shiftMonthlyVisitMonth, monthlyVisitForStore, monthlyVisitOverview, monthlyVisitBasis, applyMonthlyVisitAction, attendanceTaipeiDate,
    by: (type, id) => project(sandbox.payload.bundle).find(row => row.type === type && row.id === id),
    retailChannel: store => ({ id: store?.id === 'a' ? 'great-tree' : store?.id === 'b' ? 'you-chuan' : 'independent' }),
    storeIdentityPending: store => store.csvIdentityPending === true,
    esc: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
    csvImport: { hasPending() { return false; } }, buttons() {}, lockNow() {}, syncScheduler: { wake() {} },
    renderCalls: 0, render() { sandbox.renderCalls++; sandbox.records = project(sandbox.payload.bundle); sandbox.renderMonthlyVisits(); },
    keyboardDismissals: 0, dismissKeyboard() { sandbox.keyboardDismissals++; }, openDialog(dialog) { dialog.open = true; },
    toasts: [], toast(message) { sandbox.toasts.push(message); }, confirmResult: true, confirms: [], confirm(message) { sandbox.confirms.push(message); return sandbox.confirmResult; },
    persistCalls: 0, persistFailure: false, persistPause: null,
    async persist(next, { guard }) {
      sandbox.persistCalls++; guard(); if (sandbox.persistPause) await sandbox.persistPause; guard();
      if (sandbox.persistFailure) throw new Error('fictional disk failure');
      validateBundle(next.bundle); writes.push(structuredClone(next)); sandbox.payload = next; sandbox.localRevision++;
    },
    confirmStoreSave() { throw new Error('Monthly rosters must not request or generate actual attendance'); },
  });
  vm.runInContext(implementation, sandbox); sandbox.renderMonthlyVisits();
  const act = (action, id = 'a', fromPicker = !!sandbox.monthlyVisitContext) => sandbox.run(() => sandbox.performMonthlyVisitAction(action, id, fromPicker), 'monthly-visit-error');
  return { sandbox, original, node, writes, month, nextMonth, act,
    open() { sandbox.openMonthlyVisitSelection(); }, close() { sandbox.closeMonthlyVisitSelection(); },
    members(selectedMonth = sandbox.monthlyVisitSelectedMonth) { return monthlyVisitOverview(sandbox.payload.bundle, selectedMonth).stores.map(row => row.storeId); },
  };
}
function assertPreserved(f) {
  const saved = f.sandbox.payload.bundle, added = saved.ops.slice(f.original.ops.length);
  assert.deepEqual(saved.ops.slice(0, f.original.ops.length), f.original.ops); assert.deepEqual(saved.blobs, f.original.blobs);
  assert.ok(added.every(op => op.type === 'store' && !Object.hasOwn(op, 'visitAttendance')));
  for (const store of project(saved).filter(row => row.type === 'store')) {
    const before = structuredClone(project(f.original).find(row => row.id === store.id).heads[0].data), after = structuredClone(store.heads[0].data);
    delete before.monthlyVisits; delete after.monthlyVisits; assert.deepEqual(after, before);
  }
  assert.deepEqual(visitAttendanceForStore(saved, 'a'), visitAttendanceForStore(f.original, 'a'));
}

test('dedicated monthly page, roster rendering and picker stay read-only, escape text and search aliases', () => {
  const f = fixture(); f.open();
  assert.match(f.node('monthly-store-options').innerHTML, /虛構 &lt;script&gt; 門市/);
  assert.doesNotMatch(f.node('monthly-store-options').innerHTML, /<script>|<img>/);
  assert.match(f.node('monthly-store-options').innerHTML, /門市狀態待確認/);
  f.sandbox.renderMonthlyVisitChoices('原始別名'); assert.match(f.node('monthly-store-options').innerHTML, /虛構 b/); assert.doesNotMatch(f.node('monthly-store-options').innerHTML, /虛構 c/);
  f.close(); assert.equal(f.sandbox.monthlyVisitContext, null); assert.equal(f.node('monthly-visit-dialog').open, false);
  assert.equal(f.sandbox.persistCalls, 0); assert.deepEqual(f.sandbox.payload.bundle, f.original);
  assert.match(html, /data-view="monthly"/); assert.match(html, /id="monthly-view"/);
  const visitsStart = html.indexOf('<section id="visits-view"'), visitsEnd = html.indexOf('<section id="monthly-view"', visitsStart);
  assert.ok(visitsStart >= 0 && visitsEnd > visitsStart); assert.doesNotMatch(html.slice(visitsStart, visitsEnd), /monthly|每月拜訪/);
});

test('successful explicit add renews retained picker context and preserves existing confirmed attendance without generating one', async () => {
  const f = fixture(); f.open(); const ctx = f.sandbox.monthlyVisitContext;
  f.sandbox.renderMonthlyVisitChoices('虛構'); await f.act('add');
  assert.equal(f.writes.length, 1); assert.equal(f.sandbox.renderCalls, 1); assert.equal(f.sandbox.monthlyVisitContext, ctx);
  assert.equal(ctx.bundle, f.sandbox.payload.bundle); assert.equal(ctx.revision, f.sandbox.localRevision); assert.equal(ctx.query, '虛構');
  assert.match(f.node('monthly-selection-count').textContent, /已加入 1/); assert.match(f.sandbox.monthlyVisitNotice, /既有實際拜訪/);
  assert.match(f.node('monthly-visit-content').innerHTML, /已拜訪 · 1 間/); assert.doesNotMatch(f.node('monthly-visit-content').innerHTML, /<details id="monthly-completed" open/);
  await f.act('add', 'b'); assert.equal(f.writes.length, 2); assert.equal(f.members().length, 2);
  await f.act('add', 'b'); assert.equal(f.writes.length, 2); assert.match(f.sandbox.toasts.at(-1), /沒有變更/);
  assert.equal(f.sandbox.confirms.length, 0); f.close(); assertPreserved(f);
});

test('save waits for durable persistence, failed saves retain picker/query without optimistic state and allow one retry', async () => {
  const f = fixture(); f.open(); f.sandbox.renderMonthlyVisitChoices('虛構'); const ctx = f.sandbox.monthlyVisitContext;
  let resume; f.sandbox.persistPause = new Promise(resolve => { resume = resolve; }); f.sandbox.persistFailure = true;
  const saving = f.act('add'); assert.equal(f.sandbox.busy, true); assert.equal(f.sandbox.renderCalls, 0); assert.equal(f.sandbox.monthlyVisitNotice, '');
  assert.deepEqual(f.sandbox.payload.bundle, f.original); assert.deepEqual(f.members(), []); assert.equal(f.sandbox.toasts.length, 0);
  resume(); await saving; assert.equal(f.writes.length, 0); assert.equal(f.sandbox.renderCalls, 0); assert.equal(f.sandbox.monthlyVisitContext, ctx); assert.equal(ctx.query, '虛構');
  assert.equal(f.node('monthly-visit-dialog').open, true); assert.match(f.node('monthly-visit-error').textContent, /fictional disk failure/); assert.equal(f.sandbox.toasts.length, 0);
  f.sandbox.persistFailure = false; f.sandbox.persistPause = null; await f.act('add'); assert.equal(f.writes.length, 1); assertPreserved(f);
});

test('cancelled or failed removal preserves month membership and prior data; successful remove can be added back', async () => {
  const f = fixture(); f.open(); await f.act('add', 'b'); f.close(); const before = JSON.stringify(f.sandbox.payload.bundle), count = f.sandbox.renderCalls;
  f.sandbox.confirmResult = false; await f.act('remove', 'b'); assert.equal(f.writes.length, 1); assert.equal(JSON.stringify(f.sandbox.payload.bundle), before);
  assert.equal(f.sandbox.renderCalls, count); assert.equal(f.sandbox.monthlyVisitContext, null); assert.match(f.sandbox.confirms.at(-1), /其他月份/);
  f.sandbox.confirmResult = true; f.sandbox.persistFailure = true; await f.act('remove', 'b'); assert.equal(f.writes.length, 1); assert.equal(JSON.stringify(f.sandbox.payload.bundle), before);
  assert.equal(f.sandbox.monthlyVisitContext, null); assert.match(f.node('monthly-visit-error').textContent, /fictional disk failure/);
  f.sandbox.persistFailure = false; await f.act('remove', 'b'); assert.equal(f.writes.length, 2); assert.deepEqual(f.members(), []); assert.match(f.node('monthly-visit-content').innerHTML, /本月已移除 · 1 間/);
  await f.act('add', 'b', false); assert.equal(f.writes.length, 3); assert.deepEqual(f.members(), ['b']); assertPreserved(f);
});

test('switching months writes nothing, isolates monthly rosters and cannot switch while picker or save is active', async () => {
  const f = fixture(); f.open(); await f.act('add', 'b'); f.sandbox.changeMonthlyVisitMonth(f.nextMonth); assert.equal(f.sandbox.monthlyVisitSelectedMonth, f.month);
  f.close(); f.sandbox.changeMonthlyVisitMonth(f.nextMonth); assert.equal(f.writes.length, 1); assert.deepEqual(f.members(), []);
  f.open(); await f.act('add', 'c'); f.close(); assert.deepEqual(f.members(f.month), ['b']); assert.deepEqual(f.members(f.nextMonth), ['c']);
  await f.act('remove', 'c'); assert.deepEqual(f.members(f.nextMonth), []); assert.deepEqual(f.members(f.month), ['b']);
  const before = JSON.stringify(f.sandbox.payload.bundle); f.sandbox.changeMonthlyVisitMonth(shiftMonthlyVisitMonth(f.month, -1));
  assert.match(f.node('monthly-visit-content').innerHTML, /歷史月份 · 唯讀/); assert.doesNotMatch(f.node('monthly-visit-content').innerHTML, /data-monthly-select/);
  assert.throws(() => f.open(), /過去月份/); assert.equal(JSON.stringify(f.sandbox.payload.bundle), before); assertPreserved(f);
});

test('previous and next month click handlers really navigate, without run busy state swallowing the change', async () => {
  const f = fixture();
  const start = app.indexOf('if (b.dataset.monthlyShift)'), end = app.indexOf("if (b.hasAttribute('data-monthly-current'))", start);
  assert.ok(start >= 0 && end > start); const branch = app.slice(start, end);
  f.sandbox.b = { dataset: { monthlyShift: '1' } };
  await vm.runInContext('(async()=>{' + branch + '})()', f.sandbox); assert.equal(f.sandbox.monthlyVisitSelectedMonth, f.nextMonth);
  f.sandbox.b.dataset.monthlyShift = '-1'; await vm.runInContext('(async()=>{' + branch + '})()', f.sandbox); assert.equal(f.sandbox.monthlyVisitSelectedMonth, f.month);
  assert.equal(f.sandbox.persistCalls, 0);
});

test('stale retained picker, background and changed session identity block all writes', async t => {
  const cases = [
    ['epoch', s => s.syncEpoch++], ['revision', s => s.localRevision++], ['bundle', s => { s.payload.bundle = structuredClone(s.payload.bundle); }],
    ['month', s => { s.monthlyVisitSelectedMonth = shiftMonthlyVisitMonth(s.monthlyVisitSelectedMonth, 1); }], ['key', s => { s.key = {}; }], ['metadata', s => { s.meta = {}; }],
    ['background', s => { s.document.hidden = true; }], ['pending lock', s => { s.pendingLock = true; }], ['fetch', s => { s.autoFetching = true; }], ['sync', s => { s.syncInProgress = true; }],
  ];
  for (const [label, mutate] of cases) await t.test(label, async () => {
    const f = fixture(); f.open(); const ctx = f.sandbox.monthlyVisitContext; mutate(f.sandbox); await f.act('add');
    assert.equal(f.sandbox.persistCalls, 0); assert.equal(f.writes.length, 0); assert.equal(f.sandbox.renderCalls, 0); assert.equal(f.sandbox.monthlyVisitContext, ctx);
    assert.match(f.node('monthly-visit-error').textContent, /尚未寫入/);
  });
});

test('in-flight guard cannot be renewed after background/epoch change and duplicate taps cannot double save', async () => {
  const f = fixture(); f.open(); const ctx = f.sandbox.monthlyVisitContext;
  let resume; f.sandbox.persistPause = new Promise(resolve => { resume = resolve; }); const saving = f.act('add');
  await f.act('add'); assert.equal(f.sandbox.persistCalls, 1); f.sandbox.syncEpoch++; f.sandbox.resumeMonthlyVisitContext(); assert.equal(ctx.epoch, 9);
  resume(); await saving; assert.equal(f.writes.length, 0); assert.deepEqual(f.sandbox.payload.bundle, f.original); assert.equal(f.sandbox.renderCalls, 0);
  assert.match(f.node('monthly-visit-error').textContent, /尚未寫入/); assert.equal(f.sandbox.monthlyVisitNotice, '');
});

test('stale visible roster action refuses a newer store revision without rewriting original text', async () => {
  const f = fixture(); f.open(); await f.act('add', 'b'); f.close();
  const store = project(f.sandbox.payload.bundle).find(row => row.id === 'b'), next = structuredClone(f.sandbox.payload.bundle);
  next.ops.push(revision('store', 'b', { ...store.heads[0].data, contact: '虛構較新窗口' }, store.heads.map(head => head.id), 'fictional-other'));
  f.sandbox.payload.bundle = next; f.sandbox.localRevision++; f.sandbox.records = project(next); const before = JSON.stringify(next);
  await f.act('remove', 'b'); assert.equal(f.writes.length, 1); assert.equal(JSON.stringify(f.sandbox.payload.bundle), before); assert.match(f.node('monthly-visit-error').textContent, /新版本/);
});

test('same-name stores display distinct existing addresses in both picker and roster, with address search', async () => {
  const f = fixture();
  for (const [id, address] of [['b', '虛構甲路一號'], ['c', '虛構乙路二號']]) {
    const store = project(f.sandbox.payload.bundle).find(row => row.type === 'store' && row.id === id);
    f.sandbox.payload.bundle.ops.push(revision('store', id, { ...store.heads[0].data, name: '虛構同名店', address }, store.heads.map(head => head.id), 'fictional-device'));
  }
  f.sandbox.records = project(f.sandbox.payload.bundle); f.sandbox.renderMonthlyVisits(); f.open();
  assert.match(f.node('monthly-store-options').innerHTML, /虛構甲路一號/); assert.match(f.node('monthly-store-options').innerHTML, /虛構乙路二號/);
  f.sandbox.renderMonthlyVisitChoices('乙路二號'); assert.match(f.node('monthly-store-options').innerHTML, /data-monthly-add="c"/); assert.doesNotMatch(f.node('monthly-store-options').innerHTML, /data-monthly-add="b"/);
  await f.act('add', 'c'); f.close(); assert.match(f.node('monthly-visit-content').innerHTML, /虛構乙路二號/);
  assert.equal(f.sandbox.monthlyVisitIdentity('b'), '虛構甲路一號');
});
