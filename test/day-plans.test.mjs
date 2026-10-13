import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, revision, project, validateBundle, validData, merge, planBackupImport, planStoreMerge, makeVisitAttendance, visitAttendanceForStore, newMeta, derive, seal, unseal,
  dayPlanDate, shiftDayPlanDate, dayPlanSources, dayPlanSourceKey, dayPlanForStore, dayPlanSuggestion, dayPlanOverview, applyDayPlanChanges } from '../public/core.js';

// Deliberately fictional stores, reminders and original notes only.
const at = '2026-10-13T01:00:00.000Z', later = '2026-10-13T02:00:00.000Z', date = '2026-10-14';
const storeData = name => ({ name, city: '', district: '', channel: '', attr: '', contact: '', nextRemember: ' Legacy exact text \r\n\r\n第二行', everyTimeMust: '詢問庫存\n 帶衛教單 ',
  nextRememberTasks: [{ id: 't1', text: 'HAUD×2盒', createdAt: at, completedAt: '' }, { id: 'done', text: '已完成虛構事項', createdAt: at, completedAt: at }] });
function fixture() {
  const b = emptyBundle('synthetic-day-plans');
  for (const id of ['a', 'b']) b.ops.push(revision('store', id, storeData('虛構' + id + '店'), [], 'test', false, makeVisitAttendance(id, at)));
  b.ops.push(revision('visit', 'note', { store: 'a', date: '', text: '逐字 原文\r\n不得改寫', next: '', source: '虛構測試', people: [], topics: [], attachments: [] }, [], 'test'));
  return b;
}
const get = (b, id = 'a') => project(b).find(store => store.type === 'store' && store.id === id);
const entry = (items = [], acknowledged = []) => ({ date, active: true, items, acknowledged });
const item = (id = 'i1', source = null, extra = {}) => ({ id, name: 'HAUD', quantity: 2, unit: '盒', source, packedAt: '', ...extra });
const change = (b, id, plan) => ({ storeId: id, expectedHeads: get(b, id).heads.map(head => head.id), plan });
const apply = (b, plan, id = 'a', time = at) => applyDayPlanChanges(b, [change(b, id, plan)], 'test', time);
function alterStore(b, id, mutate, time = later) {
  const next = structuredClone(b), old = get(next, id), data = structuredClone(old.heads[0].data); mutate(data);
  const op = revision('store', id, data, old.heads.map(head => head.id), 'other'); op.at = time; next.ops.push(op); return next;
}

test('Taipei calendar dates and leap days are exact; invalid dates never normalize silently', () => {
  assert.equal(dayPlanDate('2026-10-13T16:00:00.000Z'), '2026-10-14');
  assert.equal(dayPlanDate('2026-10-13T15:59:59.999Z'), '2026-10-13');
  assert.equal(shiftDayPlanDate('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftDayPlanDate('2028-02-29', 1), '2028-03-01');
  for (const bad of ['2026-02-29', '2026-04-31', '0000-01-01', 'not-date', '2026-13-01']) assert.throws(() => dayPlanDate(bad));
  assert.throws(() => shiftDayPlanDate(date, 1.5));
});

test('source projection keeps exact task/free-text lines and excludes only completed tasks', () => {
  const store = storeData('虛構'), before = structuredClone(store), sources = dayPlanSources(store);
  assert.deepEqual(sources, [{ kind: 'task', id: 't1', text: 'HAUD×2盒' }, { kind: 'legacy', id: '0', text: ' Legacy exact text ' }, { kind: 'legacy', id: '2', text: '第二行' }, { kind: 'every', id: '0', text: '詢問庫存' }, { kind: 'every', id: '1', text: ' 帶衛教單 ' }]);
  assert.deepEqual(store, before);
  assert.notEqual(dayPlanSourceKey(sources[0]), dayPlanSourceKey({ ...sources[0], text: 'HAUD×3盒' }));
});

test('suggestions are conservative exact presets, not synonym or prose inference', () => {
  const source = text => ({ kind: 'task', id: 'x', text });
  assert.deepEqual(dayPlanSuggestion(source('HAUD×2盒')), { name: 'HAUD', quantity: 2, unit: '盒', source: source('HAUD×2盒') });
  assert.equal(dayPlanSuggestion(source('Complete')).quantity, null);
  assert.equal(dayPlanSuggestion(source('陳列盒（小） x 2 個')).quantity, 2);
  for (const text of ['HAUD 2盒', 'HAUD2盒', 'HAUD\t2 盒', 'HAUD X2盒']) assert.deepEqual(dayPlanSuggestion(source(text)), { name: 'HAUD', quantity: 2, unit: '盒', source: source(text) });
  assert.deepEqual(dayPlanSuggestion(source('陳列盒（小）1個')), { name: '陳列盒（小）', quantity: 1, unit: '個', source: source('陳列盒（小）1個') });
  assert.equal(dayPlanSuggestion(source('Complete 0.5瓶')).quantity, 0.5);
  for (const text of ['C×2盒', 'HAMD×2盒', 'HAUD×2', 'HAUD 2', 'HAUD×0盒', 'HAUD0盒', 'HAUD×100001盒', 'HAUD 2盒待確認', 'HAUD2盒、Complete1瓶', 'Complete 5ml', 'HAUD\n2盒', 'HAUD 和 Complete 各1盒', '下次不要帶HAUD', '給 Complete 2瓶']) assert.equal(dayPlanSuggestion(source(text)), null);
});

test('planning preserves all currently valid reminder text and source-count boundaries', () => {
  const long = '保留原文'.repeat(500), base = fixture();
  let b = alterStore(base, 'a', data => { data.nextRemember = long; data.everyTimeMust = long; data.nextRememberTasks[0].text = long; });
  assert.equal(validData('store', get(b).heads[0].data), true);
  b = apply(b, entry());
  assert.deepEqual(dayPlanForStore(get(b), date).sourceSnapshot.map(source => source.text), [long, long, long]);
  assert.equal(get(b).everyTimeMust, long);
  b = alterStore(base, 'a', data => {
    data.nextRemember = '項\n'.repeat(1000); data.everyTimeMust = '項\n'.repeat(1000);
    data.nextRememberTasks = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), text: '項', createdAt: at, completedAt: '' }));
  });
  assert.equal(dayPlanSources(get(b)).length, 3000);
  assert.equal(dayPlanForStore(get(apply(b, entry())), date).sourceSnapshot.length, 3000);
  const tooLong = { ...storeData('虛構'), everyTimeMust: '字'.repeat(2001) };
  assert.equal(validData('store', tooLong), false); // Existing store limit, not a new planning limit.
});

test('batch selection changes only datePlans atomically and never creates attendance or edits notes', () => {
  const b = fixture(), before = structuredClone(b);
  const next = applyDayPlanChanges(b, ['a', 'b'].map(id => change(b, id, entry([item()]))), 'test', at);
  assert.deepEqual(b, before); assert.deepEqual(next.ops.slice(0, b.ops.length), b.ops); assert.equal(next.ops.length, b.ops.length + 2);
  assert.deepEqual(next.blobs, b.blobs);
  for (const id of ['a', 'b']) {
    const data = structuredClone(get(next, id).heads[0].data); delete data.datePlans;
    assert.deepEqual(data, get(b, id).heads[0].data);
    assert.deepEqual(visitAttendanceForStore(next, id, Date.parse(later)), visitAttendanceForStore(b, id, Date.parse(later)));
  }
  assert.ok(next.ops.slice(b.ops.length).every(op => !Object.hasOwn(op, 'visitAttendance')));
  const stale = change(b, 'b', entry()); stale.expectedHeads = ['stale'];
  assert.throws(() => applyDayPlanChanges(b, [change(b, 'a', entry()), stale], 'test', at), /新版本/);
  assert.deepEqual(b, before);
});

test('packing stays separate, idempotent, and resets on quantity/spec/source/date changes', () => {
  let b = apply(fixture(), entry([item()]));
  let plan = structuredClone(dayPlanForStore(get(b), date)); plan.items[0].packedAt = later;
  b = apply(b, plan, 'a', later);
  assert.equal(dayPlanOverview(project(b), date, Date.parse(at)).groups[0].packed, true);
  assert.equal(apply(b, dayPlanForStore(get(b), date), 'a', '2026-10-13T03:00:00.000Z'), b);
  for (const delta of [{ quantity: 3 }, { name: 'Complete' }, { unit: '瓶' }, { source: dayPlanSources(get(b))[0] }]) {
    const edited = structuredClone(dayPlanForStore(get(b), date)); Object.assign(edited.items[0], delta);
    const next = apply(b, edited); assert.equal(dayPlanForStore(get(next), date).items[0].packedAt, '');
  }
  const tomorrow = structuredClone(dayPlanForStore(get(b), date)); tomorrow.date = '2026-10-15';
  assert.equal(dayPlanForStore(get(apply(b, tomorrow)), tomorrow.date).items[0].packedAt, '');
  const beforeTasks = get(b).nextRememberTasks;
  assert.deepEqual(beforeTasks, storeData('x').nextRememberTasks);
});

test('removal preserves plan items and revisions; re-adding never carries packed state', () => {
  let b = apply(fixture(), entry([item()]));
  let plan = structuredClone(dayPlanForStore(get(b), date)); plan.items[0].packedAt = later; b = apply(b, plan, 'a', later);
  const packedBundle = b; plan = structuredClone(dayPlanForStore(get(b), date)); plan.active = false; b = apply(b, plan);
  let view = dayPlanOverview(project(b), date, Date.parse(at)); assert.equal(view.stores.length, 0); assert.equal(view.cancelledStores.length, 1); assert.equal(view.cancelledStores[0].items.length, 1);
  plan = structuredClone(dayPlanForStore(get(b), date)); plan.active = true; b = apply(b, plan);
  assert.equal(dayPlanForStore(get(b), date).items[0].packedAt, '');
  assert.deepEqual(b.ops.slice(0, packedBundle.ops.length), packedBundle.ops);
});

test('aggregation keeps exact product/unit allocations and marks unknown quantities', () => {
  const base = fixture(), source = dayPlanSources(get(base))[0];
  const b = applyDayPlanChanges(base, [change(base, 'a', entry([item('a1', source), item('a2', null, { name: 'Complete', quantity: null }), item('a3', null, { name: 'HAUD', unit: '支', quantity: 3 })])), change(base, 'b', entry([item('b1', null, { quantity: 1 }), item('b2', null, { name: 'HAMD', quantity: 4 }), item('b3', null, { name: '另項', unit: '', quantity: 2 })]))], 'test', at);
  const view = dayPlanOverview(project(b), date, Date.parse(at)), boxes = view.groups.find(group => group.name === 'HAUD' && group.unit === '盒');
  assert.equal(boxes.quantity, 3); assert.deepEqual(boxes.allocations.map(a => [a.storeId, a.quantity]), [['a', 2], ['b', 1]]);
  assert.equal(view.groups.length, 3); assert.equal(view.unknownItems.length, 2); assert.equal(view.stores[0].unclassifiedSources.length, 4);
});

test('source edits/completion invalidate packing and exclude stale quantities; all new sources remain visible', () => {
  const base = fixture(), source = dayPlanSources(get(base))[0];
  let b = apply(base, entry([item('one', source)], dayPlanSources(get(base)).slice(1)));
  const plan = structuredClone(dayPlanForStore(get(b), date)); plan.items[0].packedAt = later; b = apply(b, plan, 'a', later);
  for (const mutate of [d => d.nextRememberTasks[0].text = 'HAUD×3盒', d => d.nextRememberTasks[0].completedAt = later, d => d.nextRememberTasks = []]) {
    const changed = alterStore(b, 'a', mutate), view = dayPlanOverview(project(changed), date, Date.parse(at));
    assert.equal(view.groups.length, 0); assert.equal(view.staleItems.length, 1); assert.equal(view.stores[0].items[0].packed, false);
    assert.equal(view.stores[0].plan.items[0].packedAt, later); // No read-side mutation.
  }
  const changed = alterStore(b, 'a', d => d.nextRememberTasks.push({ id: 'new', text: '帶新的東西', createdAt: later, completedAt: '' }));
  const view = dayPlanOverview(project(changed), date, Date.parse(at)); assert.equal(view.unclassifiedSources.length, 1); assert.equal(view.unclassifiedSources[0].id, 'new');
});

test('past is read-only and reads saved source evidence, including retained pre-restore history', () => {
  const base = fixture(), source = dayPlanSources(get(base))[0]; let b = apply(base, entry([item('one', source)]));
  const plan = structuredClone(dayPlanForStore(get(b), date)); plan.items[0].packedAt = later; b = apply(b, plan, 'a', later);
  b = alterStore(b, 'a', d => d.nextRememberTasks[0].completedAt = '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z');
  let view = dayPlanOverview(project(b), date, Date.parse('2026-10-16T00:00:00.000Z'));
  assert.equal(view.past, true); assert.equal(view.groups[0].packed, true); assert.equal(view.staleItems.length, 0);
  assert.throws(() => apply(b, dayPlanForStore(get(b), date), 'a', '2026-10-16T00:00:00.000Z'), /過去行程/);
  b = alterStore(b, 'a', d => { delete d.datePlans; }, '2026-10-16T00:00:00.000Z');
  view = dayPlanOverview(project(b), date, Date.parse('2026-10-17T00:00:00.000Z'));
  assert.equal(view.stores[0].historical, true); assert.equal(view.groups[0].quantity, 2);
  assert.equal(dayPlanOverview(project(b), date, Date.parse(at)).stores.length, 0); // Does not revive future plans.
});

test('invalid/duplicate plans, sources and quantities fail closed without trimming data', () => {
  const good = get(apply(fixture(), entry([item()]))).heads[0].data;
  for (const mutate of [d => d.datePlans.push(d.datePlans[0]), d => d.datePlans[0].date = '2026-02-30', d => d.datePlans[0].items[0].quantity = 0,
    d => d.datePlans[0].items[0].quantity = Infinity, d => d.datePlans[0].items[0].quantity = '2', d => d.datePlans[0].items[0].quantity = 100001,
    d => d.datePlans[0].items[0].packedAt = 'not-a-time', d => d.datePlans[0].items.push(d.datePlans[0].items[0]), d => d.datePlans[0].items[0].source = { kind: 'ai', id: '1', text: 'guess' },
    d => d.datePlans[0].active = 'true', d => d.datePlans[0].updatedAt = '2026-02-30T00:00:00.000Z', d => d.datePlans[0].items[0].name = ' ']) {
    const bad = structuredClone(good); mutate(bad); assert.equal(validData('store', bad), false); assert.throws(() => revision('store', 'x', bad, [], 'test'));
  }
  assert.equal(validData('person', { name: '虛構人物', role: '', desc: '', confirmed: false, datePlans: good.datePlans }), false);
});

test('deleted/conflicting/pending/merged stores retain warning cards and cannot falsely complete preparation', () => {
  const base = apply(fixture(), entry([item()]));
  for (const status of ['deleted', 'conflict', 'csvIdentityPending', 'mergedInto']) {
    const records = project(base), store = records.find(r => r.id === 'a'); store[status] = status === 'mergedInto' ? 'b' : true;
    const view = dayPlanOverview(records, date, Date.parse(at)); assert.equal(view.stores.length, 1); assert.equal(view.unavailableStores.length, 1); assert.equal(view.groups.length, 0); assert.equal(view.stores[0].available, false);
  }
  const pending = alterStore(base, 'a', d => d.csvIdentityPending = true);
  assert.throws(() => apply(pending, dayPlanForStore(get(pending), date)), /待確認/);
});

test('sync conflict retains both planning branches and does not pick a trusted quantity', () => {
  const base = apply(fixture(), entry([item()])), leftPlan = structuredClone(dayPlanForStore(get(base), date)), rightPlan = structuredClone(leftPlan);
  leftPlan.items[0].quantity = 3; rightPlan.items[0].quantity = 4;
  const left = apply(base, leftPlan), right = apply(base, rightPlan), combined = merge(left, right);
  assert.equal(get(combined).conflict, true); assert.equal(get(combined).heads.length, 2);
  assert.equal(dayPlanOverview(project(combined), date, Date.parse(at)).groups.length, 0);
  assert.throws(() => apply(combined, leftPlan), /衝突/);
  assert.deepEqual(merge(left, right), merge(right, left));
  const cancelled = structuredClone(leftPlan); cancelled.active = false;
  const cancelledBranch = apply(base, cancelled), mixed = project(merge(left, cancelledBranch));
  const record = mixed.find(store => store.id === 'a');
  // Force the projection's chosen data to the cancelled head; the other active
  // head must still leave a visible, blocked arrangement instead of vanishing.
  Object.assign(record, record.heads.find(head => !head.data.datePlans[0].active).data);
  const mixedView = dayPlanOverview(mixed, date, Date.parse(at));
  assert.equal(mixedView.stores.length, 1); assert.equal(mixedView.unavailableStores.length, 1);
});

test('encrypted backup round-trip and readonly restore preview retain plans, attendance and every prior revision', async () => {
  const base = fixture(), next = apply(base, entry([item()])), meta = newMeta(), key = await derive('synthetic-only-passphrase', meta);
  const decoded = validateBundle(await unseal(await seal(next, key, meta), key)); assert.deepEqual(decoded, next);
  const preview = await planBackupImport(base, decoded); assert.equal(preview.summary.addedRevisions, 1); assert.equal(preview.summary.visitAttendance.addedMarks, 0);
  assert.deepEqual(preview.bundle.ops.filter(op => base.ops.some(old => old.id === op.id)), merge(base, base).ops);
  assert.deepEqual(get(preview.bundle).datePlans, get(next).datePlans); assert.deepEqual(merge(next, decoded), merge(decoded, next));
});

test('same-store merging cannot silently transplant or lose any saved plans', async () => {
  const b = apply(fixture(), entry([item()]));
  await assert.rejects(planStoreMerge(b, { keeperId: 'a', donorId: 'b', name: '虛構整併名稱' }), /行程與準備/);
  await assert.rejects(planStoreMerge(b, { keeperId: 'b', donorId: 'a', name: '虛構整併名稱' }), /行程與準備/);
  const historicalOnly = alterStore(b, 'a', d => { delete d.datePlans; });
  await assert.rejects(planStoreMerge(historicalOnly, { keeperId: 'a', donorId: 'b', name: '虛構整併名稱' }), /行程與準備/);
});

test('manual quantities are not inferred from store count, and multiple items can share a source', () => {
  const base = fixture(), source = dayPlanSources(get(base))[0];
  const b = apply(base, entry([item('one', source, { quantity: null }), item('two', source, { name: '另項', quantity: 0.0000001, unit: '份' })]));
  const view = dayPlanOverview(project(b), date, Date.parse(at)); assert.equal(view.unknownItems.length, 1); assert.equal(view.groups[0].quantity, 0.0000001);
  const copy = dayPlanForStore(get(b), date); copy.items[0].name = 'local form edit';
  assert.equal(dayPlanForStore(get(b), date).items[0].name, 'HAUD');
});
