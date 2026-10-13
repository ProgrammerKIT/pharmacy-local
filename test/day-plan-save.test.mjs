import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emptyBundle, revision, project, validateBundle, makeVisitAttendance, visitAttendanceForStore,
  dayPlanDate, shiftDayPlanDate, dayPlanSources, dayPlanSourceKey, dayPlanForStore, applyDayPlanChanges } from '../public/core.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(first, next) {
  const start = app.indexOf(first), end = app.indexOf(next, start);
  assert.ok(start >= 0 && end > start, 'Exercise the actual day-plan save implementation');
  return app.slice(start, end);
}
const implementation = section('async function run(', 'function programDetail(')
  + section('function assertDayPlanContext(', 'function openDayPlanSelection(')
  + section('function readDayPlanItemInputs(', 'function addDayPlanItem(')
  + section('function closeDayPlanEditor(', 'async function setDayPlanPacked(');

// Synthetic local data only. DOM stubs model the two visible stages; actual core
// revision/validation/attendance helpers run for every candidate and commit.
function fixture(kind = 'selection') {
  const now = new Date().toISOString(), date = shiftDayPlanDate(dayPlanDate(), 1);
  let bundle = emptyBundle('synthetic-day-plan-save');
  bundle.ops.push(revision('store', 'store', {
    name: '虛構 <script> 門市', city: '', district: '', channel: '', attr: '', contact: '', everyTimeMust: '保留固定提醒',
    nextRememberTasks: [{ id: 'pending', text: 'HAUD×2盒', createdAt: now, completedAt: '' }, { id: 'done', text: '已完成測試事項', createdAt: now, completedAt: now }],
  }, [], 'synthetic', false, makeVisitAttendance('store', now)));
  bundle.ops.push(revision('visit', 'note', { store: 'store', date: '', text: '保留原文\r\n 與空白 ', next: '', source: 'synthetic', people: [], topics: [], attachments: [] }, [], 'synthetic'));
  let store = project(bundle).find(row => row.id === 'store');
  if (kind === 'items') {
    bundle = applyDayPlanChanges(bundle, [{ storeId: 'store', expectedHeads: store.heads.map(h => h.id), plan: {
      date, active: true, acknowledged: [], items: [{ id: 'item', name: 'HAUD', quantity: 2, unit: '盒', source: dayPlanSources(store)[0], packedAt: '' }],
    } }], 'synthetic');
    store = project(bundle).find(row => row.id === 'store');
  }
  const original = structuredClone(bundle), key = {}, meta = {}, elements = new Map(), writes = [];
  function node(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: id === 'day-plan-confirmation', innerHTML: '', textContent: '', open: true, rows: [],
      replaceChildren() { this.innerHTML = ''; this.textContent = ''; }, close() { this.open = false; },
      querySelectorAll() { return this.rows; },
    });
    return elements.get(id);
  }
  const ctx = { kind, date, key, meta, bundle, revision: 4, epoch: 8, today: dayPlanDate(), changed: true };
  if (kind === 'selection') Object.assign(ctx, { stores: [store], initial: new Set(), selected: new Set(['store']) });
  else {
    const plan = dayPlanForStore(store, date);
    Object.assign(ctx, { storeId: 'store', storeName: store.name, items: structuredClone(plan.items), sources: dayPlanSources(store), acknowledged: [] });
    const inputs = { '[data-day-item-name]': { value: 'HAUD' }, '[data-day-item-quantity]': { value: '3' }, '[data-day-item-unit]': { value: '盒' } };
    node('day-item-rows').rows = [{ dataset: { dayItem: '0' }, querySelector: selector => inputs[selector] }];
  }
  const sandbox = vm.createContext({
    dayPlanContext: ctx, key, meta, localRevision: 4, syncEpoch: 8, payload: { bundle, device: 'synthetic', dirty: false },
    document: { hidden: false }, pendingLock: false, updateHolding: false, busy: false, $: node,
    structuredClone, dayPlanDate, dayPlanSources, dayPlanSourceKey, dayPlanForStore, applyDayPlanChanges,
    reviewHeads: row => row.heads.map(head => head.id).sort(), by: (type, id) => project(sandbox.payload.bundle).find(row => row.type === type && row.id === id),
    esc: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
    buttons() {}, lockNow() {}, syncScheduler: { wake() {} }, render() {}, dismissKeyboard() {}, focusReadingSurface() {},
    toast(message) { sandbox.lastToast = message; }, confirm() { return sandbox.cancelAccepted; }, cancelAccepted: true,
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
  vm.runInContext(implementation, sandbox);
  return { sandbox, ctx, original, node, writes, submit: () => sandbox.saveDayPlanEditor({ preventDefault() {} }) };
}

test('first submit only displays an escaped impact preview; no formal data is persisted', async () => {
  const f = fixture(); await f.submit();
  assert.equal(f.sandbox.persistCalls, 0); assert.equal(f.writes.length, 0);
  assert.deepEqual(f.sandbox.payload.bundle, f.original); validateBundle(f.ctx.preview.bundle);
  assert.equal(f.node('day-plan-fields').hidden, true); assert.equal(f.node('day-plan-confirmation').hidden, false);
  assert.match(f.node('day-plan-confirmation').innerHTML, /加入：虛構 &lt;script&gt; 門市/);
  assert.doesNotMatch(f.node('day-plan-confirmation').innerHTML, /<script>/);
  assert.equal(f.node('day-plan-save').textContent, '確認儲存行程與準備');
});

test('back and cancelled/declined cancellation never write the preview', async () => {
  const f = fixture(); await f.submit(); f.sandbox.resetDayPlanConfirmation();
  assert.equal(f.ctx.preview, null); assert.equal(f.node('day-plan-fields').hidden, false);
  assert.equal(f.node('day-plan-confirmation').hidden, true); assert.equal(f.sandbox.persistCalls, 0);
  await f.submit(); f.sandbox.cancelAccepted = false; f.sandbox.closeDayPlanEditor();
  assert.equal(f.sandbox.dayPlanContext, f.ctx); assert.ok(f.ctx.preview);
  f.sandbox.cancelAccepted = true; f.sandbox.closeDayPlanEditor();
  assert.equal(f.sandbox.dayPlanContext, null); assert.equal(f.node('day-plan-dialog').open, false);
  assert.equal(f.writes.length, 0); assert.deepEqual(f.sandbox.payload.bundle, f.original);
});

test('explicit confirmation commits exactly once and preserves notes, tasks, attendance and history', async t => {
  for (const kind of ['selection', 'items']) await t.test(kind, async () => {
    const f = fixture(kind), beforeAttendance = visitAttendanceForStore(f.original, 'store');
    await f.submit(); const preview = f.ctx.preview.bundle; await f.submit();
    assert.equal(f.sandbox.persistCalls, 1); assert.equal(f.writes.length, 1);
    assert.equal(f.sandbox.payload.bundle, preview); assert.equal(f.sandbox.dayPlanContext, null);
    const saved = f.writes[0].bundle, added = saved.ops.slice(f.original.ops.length);
    assert.equal(added.length, 1); assert.equal(added[0].type, 'store'); assert.equal(Object.hasOwn(added[0], 'visitAttendance'), false);
    assert.deepEqual(saved.ops.slice(0, f.original.ops.length), f.original.ops); assert.deepEqual(saved.blobs, f.original.blobs);
    const before = structuredClone(project(f.original).find(row => row.id === 'store').heads[0].data), after = structuredClone(added[0].data);
    delete before.datePlans; delete after.datePlans; assert.deepEqual(after, before);
    assert.deepEqual(visitAttendanceForStore(saved, 'store'), beforeAttendance);
    assert.equal(f.node('day-plan-dialog').open, false); assert.equal(f.node('day-plan-confirmation').hidden, true);
    await f.submit(); assert.equal(f.sandbox.persistCalls, 1); // Duplicate submission cannot reuse the saved preview.
  });
});

test('stale epoch, bundle or local revision refuses confirmation before any persistence', async t => {
  for (const mutate of [s => s.syncEpoch++, s => s.localRevision++, s => { s.payload.bundle = structuredClone(s.payload.bundle); }]) await t.test(mutate.toString(), async () => {
    const f = fixture(); await f.submit(); const preview = f.ctx.preview; mutate(f.sandbox); await f.submit();
    assert.equal(f.sandbox.persistCalls, 0); assert.equal(f.ctx.preview, preview); assert.equal(f.writes.length, 0);
    assert.match(f.node('day-plan-error').textContent, /尚未寫入/); assert.equal(f.node('day-plan-dialog').open, true);
  });
});

test('disk rejection retains the reviewed candidate and form so a retry can commit once', async () => {
  const f = fixture('items'); await f.submit(); const preview = f.ctx.preview;
  f.sandbox.persistFailure = true; await f.submit();
  assert.equal(f.writes.length, 0); assert.equal(f.ctx.preview, preview); assert.equal(f.sandbox.dayPlanContext, f.ctx);
  assert.deepEqual(f.sandbox.payload.bundle, f.original); assert.equal(f.node('day-plan-confirmation').hidden, false);
  assert.match(f.node('day-plan-error').textContent, /synthetic disk failure/);
  f.sandbox.persistFailure = false; await f.submit();
  assert.equal(f.writes.length, 1); assert.equal(f.sandbox.payload.bundle, preview.bundle);
});

test('background during confirmation cannot use foreground resume to bypass the in-flight guard', async () => {
  const f = fixture(); await f.submit();
  let resumeWrite; f.sandbox.persistPause = new Promise(resolve => { resumeWrite = resolve; });
  const saving = f.submit(); assert.equal(f.sandbox.busy, true);
  f.sandbox.syncEpoch++; f.sandbox.resumeDayPlanContext();
  assert.equal(f.ctx.epoch, 8); resumeWrite(); await saving;
  assert.equal(f.writes.length, 0); assert.deepEqual(f.sandbox.payload.bundle, f.original);
  assert.ok(f.ctx.preview); assert.match(f.node('day-plan-error').textContent, /尚未寫入/);
});

test('returning from preview to an unchanged selection exits without a revision', async () => {
  const f = fixture(); await f.submit(); f.sandbox.resetDayPlanConfirmation(); f.ctx.selected.clear(); await f.submit();
  assert.equal(f.sandbox.persistCalls, 0); assert.equal(f.sandbox.dayPlanContext, null);
  assert.deepEqual(f.sandbox.payload.bundle, f.original); assert.match(f.sandbox.lastToast, /沒有變更/);
});
