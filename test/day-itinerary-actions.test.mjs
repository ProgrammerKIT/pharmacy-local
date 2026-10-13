import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, revision, project, validateBundle, validData, merge, planBackupImport, planStoreMerge, makeVisitAttendance, visitAttendanceForStore, newMeta, derive, seal, unseal,
  dayPlanSources, dayPlanForStore, dayPlanOverview, shiftDayPlanDate, applyDayPlanChanges, dayItineraryBasis, applyDayItineraryAction } from '../public/core.js';

// Synthetic data only; no production records, coordinates, or private notes.
const at = '2026-10-13T01:00:00.000Z', later = '2026-10-13T02:00:00.000Z', date = '2026-10-14', nextDate = '2026-10-15';
const data = name => ({ name, city: '', district: '', channel: '', attr: '', contact: '', nextRemember: ' 保留自由文字 \r\n第二行', everyTimeMust: '詢問庫存',
  nextRememberTasks: [{ id: 'task', text: 'HAUD×2盒', createdAt: at, completedAt: '' }, { id: 'done', text: '已完成', createdAt: at, completedAt: at }] });
function fixture() {
  const bundle = emptyBundle('synthetic-simple-itinerary');
  for (const id of ['a', 'b', 'c']) { const op = revision('store', id, data('Synthetic ' + id.toUpperCase()), [], 'test', false, makeVisitAttendance(id, at)); op.at = at; bundle.ops.push(op); }
  const op = revision('visit', 'note', { store: 'a', date: '', text: '原始文字\r\n完整保留', next: '', source: 'synthetic', people: [], topics: [], attachments: [] }, [], 'test'); op.at = at; bundle.ops.push(op);
  return bundle;
}
const get = (bundle, id = 'a') => project(bundle).find(store => store.type === 'store' && store.id === id);
const basis = (bundle, day = date) => dayItineraryBasis(project(bundle), day);
const request = (bundle, id, action, day = date) => ({ date: day, storeId: id, action, expectedBasis: basis(bundle, day) });
const apply = (bundle, id, action, day = date, time = later) => applyDayItineraryAction(bundle, request(bundle, id, action, day), 'test', time);
const list = (bundle, day = date, time = at) => dayPlanOverview(project(bundle), day, time).stores.map(row => row.storeId);
function alter(bundle, id, mutate, time = later, deleted = false) {
  const next = structuredClone(bundle), store = get(next, id), draft = structuredClone(store.heads[0].data); mutate(draft);
  const op = revision('store', id, draft, store.heads.map(head => head.id), 'other', deleted); op.at = time; next.ops.push(op); return next;
}
function legacy(bundle, ids = ['a', 'b', 'c']) {
  return applyDayPlanChanges(bundle, ids.map(id => ({ storeId: id, expectedHeads: get(bundle, id).heads.map(head => head.id), plan: { date, active: true, items: [], acknowledged: [] } })), 'test', at);
}
function arrange(bundle, ids = ['a', 'b', 'c'], day = date) { for (const id of ids) bundle = apply(bundle, id, 'add', day); return bundle; }

test('direct add appends by chosen order, retains exact reminders, notes, history and attendance', () => {
  const original = fixture(), before = structuredClone(original), next = arrange(original, ['c', 'a', 'b']);
  assert.deepEqual(list(next), ['c', 'a', 'b']); assert.deepEqual(original, before);
  assert.deepEqual(next.ops.slice(0, original.ops.length), original.ops); assert.deepEqual(next.blobs, original.blobs);
  for (const id of ['a', 'b', 'c']) {
    const after = structuredClone(get(next, id).heads[0].data); delete after.datePlans; delete after.datePlanOrder;
    assert.deepEqual(after, get(original, id).heads[0].data);
    assert.deepEqual(dayPlanForStore(get(next, id), date).sourceSnapshot, dayPlanSources(get(original, id)));
    assert.deepEqual(dayPlanForStore(get(next, id), date).items, []); assert.deepEqual(dayPlanForStore(get(next, id), date).acknowledged, []);
    assert.deepEqual(visitAttendanceForStore(next, id, later), visitAttendanceForStore(original, id, later));
  }
  assert.ok(next.ops.slice(original.ops.length).every(op => !Object.hasOwn(op, 'visitAttendance')));
});

test('cancel and restore preserve old preparation bytes and return to retained order', () => {
  let bundle = arrange(fixture());
  bundle = alter(bundle, 'b', draft => {
    const plan = draft.datePlans[0]; plan.items = [{ id: 'old-item', name: 'HAUD', quantity: 2, unit: '盒', source: plan.sourceSnapshot[0], packedAt: at }]; plan.acknowledged = [plan.sourceSnapshot[1]];
  });
  const saved = dayPlanForStore(get(bundle, 'b'), date), initialRank = get(bundle, 'b').datePlanOrder;
  bundle = alter(bundle, 'b', draft => { draft.nextRemember = '目前新提醒'; });
  const cancelled = apply(bundle, 'b', 'cancel'); assert.deepEqual(list(cancelled), ['a', 'c']);
  const restored = apply(cancelled, 'b', 'restore'); assert.deepEqual(list(restored), ['a', 'b', 'c']);
  for (const next of [cancelled, restored]) {
    const plan = dayPlanForStore(get(next, 'b'), date);
    for (const field of ['items', 'acknowledged', 'sourceSnapshot']) assert.deepEqual(plan[field], saved[field]);
    assert.deepEqual(get(next, 'b').datePlanOrder, initialRank); assert.deepEqual(next.ops.slice(0, bundle.ops.length), bundle.ops);
    assert.equal(get(next, 'b').nextRemember, '目前新提醒');
  }
  assert.equal(apply(cancelled, 'b', 'cancel'), cancelled); assert.equal(apply(restored, 'b', 'restore'), restored);
  const readded = apply(cancelled, 'b', 'add'); assert.deepEqual(list(readded), ['a', 'c', 'b']);
  assert.deepEqual(dayPlanForStore(get(readded, 'b'), date).items, saved.items);
});

test('reordering is atomic, preserves cancelled slots, and isolates selected dates', () => {
  let bundle = arrange(arrange(fixture()), ['b', 'c', 'a'], nextDate);
  const otherDay = new Map(['a', 'b', 'c'].map(id => [id, { plan: dayPlanForStore(get(bundle, id), nextDate), order: get(bundle, id).datePlanOrder.find(entry => entry.date === nextDate) }]));
  const moved = apply(bundle, 'c', 'up'); assert.deepEqual(list(moved), ['a', 'c', 'b']); assert.equal(moved.ops.length, bundle.ops.length + 2);
  assert.deepEqual(list(moved, nextDate), ['b', 'c', 'a']);
  for (const id of ['a', 'b', 'c']) {
    assert.deepEqual(dayPlanForStore(get(moved, id), nextDate), otherDay.get(id).plan);
    assert.deepEqual(get(moved, id).datePlanOrder.find(entry => entry.date === nextDate), otherDay.get(id).order);
    assert.deepEqual(dayPlanForStore(get(moved, id), date), dayPlanForStore(get(bundle, id), date));
  }
  bundle = apply(bundle, 'b', 'cancel'); bundle = apply(bundle, 'c', 'up'); assert.deepEqual(list(bundle), ['c', 'a']);
  bundle = apply(bundle, 'b', 'restore'); assert.deepEqual(list(bundle), ['c', 'b', 'a']);
  assert.equal(apply(bundle, 'c', 'up'), bundle); assert.equal(apply(bundle, 'a', 'down'), bundle); assert.equal(apply(bundle, 'a', 'add'), bundle);
});

test('legacy alphabetical order stays read-only during append and initializes only on explicit move', () => {
  const original = legacy(fixture(), ['a', 'b']); assert.deepEqual(list(original), ['a', 'b']);
  assert.equal(get(original).datePlanOrder, undefined);
  const added = apply(original, 'c', 'add'); assert.deepEqual(list(added), ['a', 'b', 'c']);
  assert.equal(added.ops.length, original.ops.length + 1);
  assert.equal(get(added, 'a').datePlanOrder, undefined); assert.equal(get(added, 'b').datePlanOrder, undefined);
  assert.equal(get(added, 'c').datePlanOrder[0].position, 2);
  const moved = apply(original, 'b', 'up'); assert.deepEqual(list(moved), ['b', 'a']);
  assert.deepEqual(dayPlanForStore(get(moved, 'a'), date), dayPlanForStore(get(original, 'a'), date));
  assert.deepEqual(dayPlanForStore(get(moved, 'b'), date), dayPlanForStore(get(original, 'b'), date));
});

test('basis is deterministic and invalidates changed reminders, candidates, ranks and dates', () => {
  const bundle = arrange(fixture()); const records = project(bundle);
  assert.equal(dayItineraryBasis(records, date), dayItineraryBasis([...records].reverse(), date));
  assert.notEqual(basis(bundle), basis(bundle, nextDate));
  const oldRequest = request(bundle, 'a', 'down');
  for (const changed of [alter(bundle, 'c', draft => draft.nextRemember = '新提醒'), apply(bundle, 'c', 'cancel'), apply(bundle, 'b', 'up'), alter(bundle, 'c', draft => draft.name = '新名稱')]) {
    const before = structuredClone(changed); assert.throws(() => applyDayItineraryAction(changed, oldRequest, 'test', later), /新版本/); assert.deepEqual(changed, before);
  }
  const extra = structuredClone(bundle); const op = revision('store', 'new', data('New'), [], 'test'); op.at = later; extra.ops.push(op);
  assert.throws(() => applyDayItineraryAction(extra, oldRequest, 'test', later), /新版本/);
});

test('unavailable targets and affected neighbors are blocked without partially writing ranks', () => {
  const original = arrange(fixture());
  for (const changed of [alter(original, 'b', draft => draft.csvIdentityPending = true), alter(original, 'b', draft => draft.mergedInto = 'a'), alter(original, 'b', () => {}, later, true), merge(apply(original, 'b', 'cancel'), apply(original, 'b', 'up'))]) {
    const before = structuredClone(changed);
    for (const action of ['add', 'cancel', 'restore', 'up', 'down']) assert.throws(() => apply(changed, 'b', action), /待確認|衝突|不存在/);
    const rows = list(changed), blockedIndex = rows.indexOf('b'), neighborId = rows[blockedIndex === 0 ? 1 : blockedIndex - 1];
    assert.throws(() => apply(changed, neighborId, blockedIndex === 0 ? 'up' : 'down'), /待確認|衝突|不存在/); assert.deepEqual(changed, before);
  }
  const old = alter(legacy(fixture(), ['a', 'b']), 'b', draft => draft.csvIdentityPending = true);
  const added = apply(old, 'c', 'add');
  assert.throws(() => apply(added, 'c', 'up'), /待確認/); assert.equal(get(old, 'a').datePlanOrder, undefined);
});

test('invalid requests, past dates and absent restores fail closed; empty cancellation is a noop', () => {
  const bundle = fixture(), good = request(bundle, 'a', 'add'), before = structuredClone(bundle);
  for (const bad of [null, {}, { ...good, date: '2026-02-30' }, { ...good, date: undefined }, { ...good, action: 'delete' }, { ...good, storeId: 'missing' }, { ...good, expectedBasis: undefined }, { ...good, plan: {} }]) assert.throws(() => applyDayItineraryAction(bundle, bad, 'test', later));
  for (const badTime of ['', '2026-02-30T00:00:00.000Z', 'not-time']) assert.throws(() => applyDayItineraryAction(bundle, good, 'test', badTime));
  assert.throws(() => applyDayItineraryAction(bundle, good, '', later));
  assert.throws(() => apply(bundle, 'a', 'add', date, '2026-10-15T00:00:00.000Z'), /過去行程/);
  assert.throws(() => apply(bundle, 'a', 'restore'), /找不到/); assert.throws(() => apply(bundle, 'a', 'up'), /尚未安排/);
  assert.equal(apply(bundle, 'a', 'cancel'), bundle); assert.deepEqual(bundle, before);
});

test('rank validation rejects malformed values, duplicate dates, unknown keys and oversized history', () => {
  for (const position of [-1, 1.5, Infinity, NaN, '0', null, 1000001]) assert.equal(validData('store', { ...data('Synthetic'), datePlanOrder: [{ date, position }] }), false);
  for (const order of [null, {}, [{ date: '2026-02-30', position: 0 }], [{ date, position: 0, extra: true }], [{ date, position: 0 }, { date, position: 1 }], Array.from({ length: 1001 }, (_, i) => ({ date: shiftDayPlanDate(date, i), position: i }))]) assert.equal(validData('store', { ...data('Synthetic'), datePlanOrder: order }), false);
  assert.equal(validData('store', { ...data('Synthetic'), datePlanOrder: [{ date, position: 1000000 }] }), true);
  assert.equal(validData('person', { name: 'Synthetic', role: '', desc: '', confirmed: false, datePlanOrder: [] }), false);
  const bundle = alter(fixture(), 'a', draft => { draft.datePlanOrder = Array.from({ length: 1000 }, (_, i) => ({ date: shiftDayPlanDate(nextDate, i), position: 0 })); });
  const before = structuredClone(bundle); assert.throws(() => apply(bundle, 'a', 'add')); assert.deepEqual(bundle, before);
});

test('duplicate ranks from concurrent independent additions resolve deterministically on explicit reorder', () => {
  const base = fixture(), both = merge(apply(base, 'a', 'add'), apply(base, 'b', 'add'));
  assert.deepEqual(list(both), ['a', 'b']); assert.deepEqual(get(both, 'a').datePlanOrder, get(both, 'b').datePlanOrder);
  const next = apply(both, 'b', 'up'); assert.deepEqual(list(next), ['b', 'a']);
  assert.notEqual(get(next, 'a').datePlanOrder[0].position, get(next, 'b').datePlanOrder[0].position);
  assert.deepEqual(list(merge(both, next)), ['b', 'a']);
});

test('past read-only views use saved ranks and snapshots including historical versions after store restore', () => {
  let bundle = arrange(fixture(), ['c', 'a', 'b']);
  bundle = alter(bundle, 'c', draft => { delete draft.datePlans; delete draft.datePlanOrder; draft.nextRemember = '今日提醒'; }, '2026-10-16T01:00:00.000Z');
  const overview = dayPlanOverview(project(bundle), date, '2026-10-17T01:00:00.000Z');
  assert.deepEqual(overview.stores.map(row => row.storeId), ['c', 'a', 'b']);
  assert.equal(overview.stores[0].historical, true); assert.equal(overview.stores[0].position, 0);
  assert.deepEqual(overview.stores[0].sources, dayPlanSources(data('original')));
  assert.deepEqual(list(bundle), ['a', 'b']);
});

test('encryption, sync and backup preview retain order, cancellation, original revisions and no new attendance', async () => {
  const original = arrange(fixture()), next = apply(apply(original, 'b', 'cancel'), 'c', 'up');
  const meta = newMeta(), key = await derive('synthetic-only', meta), decoded = validateBundle(await unseal(await seal(next, key, meta), key));
  assert.deepEqual(decoded, next); assert.deepEqual(merge(decoded, original), merge(original, decoded));
  const preview = await planBackupImport(original, decoded); assert.equal(preview.summary.visitAttendance.addedMarks, 0);
  for (const id of ['a', 'b', 'c']) { assert.deepEqual(get(preview.bundle, id).datePlanOrder, get(next, id).datePlanOrder); assert.deepEqual(get(preview.bundle, id).datePlans, get(next, id).datePlans); }
  assert.deepEqual(list(preview.bundle), ['c', 'a']); assert.ok(original.ops.every(op => preview.bundle.ops.some(saved => JSON.stringify(saved) === JSON.stringify(op))));
});

test('store merge blocks rank-only and historical-rank data instead of silently transplanting it', async () => {
  const ranked = alter(fixture(), 'a', draft => { draft.datePlanOrder = [{ date, position: 0 }]; });
  const historical = alter(ranked, 'a', draft => { delete draft.datePlanOrder; });
  for (const bundle of [ranked, historical]) await assert.rejects(planStoreMerge(bundle, { keeperId: 'a', donorId: 'b', name: 'Synthetic Combined' }), /行程與準備/);
});


test('add/cancel/restore affect only their safe target even beside unavailable unranked legacy stores', () => {
  const old = legacy(fixture(), ['b', 'c']);
  for (const unavailable of [alter(old, 'c', draft => draft.csvIdentityPending = true), alter(old, 'c', draft => draft.mergedInto = 'b'), alter(old, 'c', () => {}, later, true), merge(alter(old, 'c', draft => draft.contact = 'Left'), alter(old, 'c', draft => draft.contact = 'Right'))]) {
    const before = structuredClone(unavailable), added = apply(unavailable, 'a', 'add');
    assert.deepEqual(list(added), ['b', 'c', 'a']); assert.deepEqual(unavailable, before);
    assert.equal(added.ops.length, unavailable.ops.length + 1); assert.equal(added.ops.at(-1).entity, 'a');
    assert.equal(get(added, 'b').datePlanOrder, undefined); assert.equal(get(added, 'c').datePlanOrder, undefined);
    const cancelled = apply(added, 'a', 'cancel'), restored = apply(cancelled, 'a', 'restore');
    assert.deepEqual(list(restored), ['b', 'c', 'a']);
    for (const next of [cancelled, restored]) assert.ok(next.ops.slice(unavailable.ops.length).every(op => op.entity === 'a'));
    assert.deepEqual(get(restored, 'c').heads, get(unavailable, 'c').heads);
    assert.deepEqual(dayPlanForStore(get(restored, 'a'), date).sourceSnapshot, dayPlanSources(get(before, 'a')));
  }
});

test('mixed legacy and ranked rows retain cancellation slots when appending and then reordering', () => {
  let bundle = legacy(fixture(), ['b', 'c']);
  bundle = apply(bundle, 'b', 'cancel'); bundle = apply(bundle, 'a', 'add');
  assert.deepEqual(list(bundle), ['c', 'a']);
  bundle = apply(bundle, 'b', 'restore'); assert.deepEqual(list(bundle), ['b', 'c', 'a']);
  bundle = apply(bundle, 'a', 'up'); assert.deepEqual(list(bundle), ['b', 'a', 'c']);
  const ranks = ['a', 'b', 'c'].map(id => get(bundle, id).datePlanOrder[0].position);
  assert.deepEqual([...ranks].sort(), [0, 1, 2]);
});
