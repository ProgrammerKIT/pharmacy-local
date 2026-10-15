import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emptyBundle, revision, project, validateBundle, validData, merge, planBackupImport, planStoreMerge, makeVisitAttendance,
  visitAttendanceForStore, newMeta, derive, seal, unseal, monthlyVisitMonth, shiftMonthlyVisitMonth, monthlyVisitForStore,
  monthlyVisitOverview, monthlyVisitBasis, applyMonthlyVisitAction } from '../public/core.js';

// Entirely synthetic stores and text. No private customer information.
const at = '2026-10-15T01:00:00.000Z', later = '2026-10-15T02:00:00.000Z', month = '2026-10', nextMonth = '2026-11';
const storeData = name => ({ name, city: '', district: '虛構區', channel: '', attr: ' 原始門市文字\r\n完整留存 ', contact: '',
  nextRemember: ' 自由文字 ', everyTimeMust: '原有必做事項', nextRememberTasks: [{ id: 't1', text: '虛構試用品', createdAt: at, completedAt: '' }] });
function fixture() {
  const bundle = emptyBundle('synthetic-monthly-visits');
  for (const id of ['a', 'b', 'c']) {
    const op = revision('store', id, storeData('虛構門市 ' + id), [], 'test'); op.at = at; bundle.ops.push(op);
  }
  const op = revision('visit', 'note', { store: 'a', date: '2026-10-15', text: '逐字 拜訪原文\r\n不得搬移', next: '', source: 'synthetic', people: [], topics: [], attachments: [] }, [], 'test');
  op.at = at; bundle.ops.push(op); return bundle;
}
const get = (bundle, id = 'a') => project(bundle).find(record => record.type === 'store' && record.id === id);
const basis = (bundle, value = month) => monthlyVisitBasis(project(bundle), value);
const request = (bundle, id, action, value = month) => ({ month: value, storeId: id, action, expectedBasis: basis(bundle, value) });
const apply = (bundle, id = 'a', action = 'add', value = month, time = later) => applyMonthlyVisitAction(bundle, request(bundle, id, action, value), 'test', time);
const view = (bundle, value = month, time = later) => monthlyVisitOverview(bundle, value, time);
function alter(bundle, id, mutate, time = later, deleted = false) {
  const next = structuredClone(bundle), store = get(next, id), data = structuredClone(store.heads[0].data); mutate(data);
  const op = revision('store', id, data, store.heads.map(head => head.id), 'other', deleted); op.at = time; next.ops.push(op); return next;
}
function attend(bundle, id = 'a', time = at, type = 'store') {
  const next = structuredClone(bundle), store = get(next, id);
  if (type === 'store') next.ops.push(revision('store', id, structuredClone(store.heads[0].data), store.heads.map(head => head.id), 'test', false, makeVisitAttendance(id, time)));
  else next.ops.push(revision('visit', 'attendance-' + next.ops.length, { store: id, date: '', text: '虛構明確確認', next: '', source: 'synthetic', people: [], topics: [], attachments: [] }, [], 'test', false, makeVisitAttendance(id, time)));
  return next;
}

test('Taipei month boundaries, December/year transitions and valid year range are exact', () => {
  assert.equal(monthlyVisitMonth('2026-10'), month);
  assert.equal(monthlyVisitMonth('2026-09-30T16:00:00.000Z'), month);
  assert.equal(monthlyVisitMonth(Date.parse('2026-09-30T15:59:59.999Z')), '2026-09');
  assert.equal(monthlyVisitMonth(new Date('2026-12-31T16:00:00.000Z')), '2027-01');
  assert.equal(shiftMonthlyVisitMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonthlyVisitMonth('2027-01', -1), '2026-12');
  assert.equal(shiftMonthlyVisitMonth('0099-12', 1), '0100-01');
  assert.equal(shiftMonthlyVisitMonth('0001-01', 0), '0001-01');
  for (const bad of ['2026-00', '2026-13', '0000-10', '2026-1', 'invalid', '2026-10-15', null, Infinity]) assert.throws(() => monthlyVisitMonth(bad));
  for (const delta of [1.1, Infinity, '1', 120001]) assert.throws(() => shiftMonthlyVisitMonth(month, delta));
  assert.throws(() => shiftMonthlyVisitMonth('0001-01', -1)); assert.throws(() => shiftMonthlyVisitMonth('9999-12', 1));
});

test('opening a month does not seed stores, create revisions, infer membership or attendance', () => {
  const bundle = fixture(), before = structuredClone(bundle);
  for (const value of [month, nextMonth, '2027-01']) { const result = view(bundle, value); assert.equal(result.total, 0); assert.equal(result.completedCount, 0); }
  assert.deepEqual(bundle, before); assert.equal(monthlyVisitForStore(get(bundle), month), null);
});

test('add/remove affect one month only, are idempotent and append exactly one store revision', () => {
  const original = fixture(), snapshot = structuredClone(original);
  let bundle = apply(original); bundle = apply(bundle, 'a', 'add', nextMonth); bundle = apply(bundle, 'b');
  const november = monthlyVisitForStore(get(bundle), nextMonth), beforeRemove = bundle;
  bundle = apply(bundle, 'a', 'remove');
  assert.deepEqual(view(bundle).stores.map(row => row.storeId), ['b']);
  assert.deepEqual(view(bundle).removedStores.map(row => row.storeId), ['a']);
  assert.deepEqual(view(bundle, nextMonth).stores.map(row => row.storeId), ['a']);
  assert.deepEqual(monthlyVisitForStore(get(bundle), nextMonth), november);
  assert.equal(bundle.ops.length, beforeRemove.ops.length + 1); assert.deepEqual(original, snapshot);
  assert.equal(apply(bundle, 'a', 'remove'), bundle); assert.equal(apply(bundle, 'b', 'add'), bundle); assert.equal(apply(bundle, 'c', 'remove'), bundle);
  const reopened = apply(bundle); assert.equal(view(reopened).total, 2); assert.equal(view(reopened).removedStores.length, 0);
  assert.deepEqual(reopened.ops.slice(0, bundle.ops.length), bundle.ops);
});

test('membership changes preserve all other fields, notes, sources, tasks and existing attendance', () => {
  const original = attend(fixture()), snapshot = structuredClone(original), next = apply(original);
  const data = structuredClone(get(next).heads[0].data); delete data.monthlyVisits;
  assert.deepEqual(data, get(original).heads[0].data); assert.deepEqual(next.blobs, original.blobs);
  assert.deepEqual(next.ops.slice(0, original.ops.length), original.ops);
  assert.deepEqual(next.ops.filter(op => op.type === 'visit'), original.ops.filter(op => op.type === 'visit'));
  assert.deepEqual(visitAttendanceForStore(next, 'a', later), visitAttendanceForStore(original, 'a', later));
  assert.equal(Object.hasOwn(next.ops.at(-1), 'visitAttendance'), false); assert.deepEqual(original, snapshot);
  const copy = monthlyVisitForStore(get(next), month); copy.active = false;
  assert.equal(monthlyVisitForStore(get(next), month).active, true);
});

test('only explicit actual attendance counts; notes dates, reminders, task completion and membership do not', () => {
  let bundle = apply(fixture());
  bundle = alter(bundle, 'a', data => { data.nextRememberTasks[0].completedAt = later; data.contact = '只修改文字'; });
  assert.equal(view(bundle).completedCount, 0);
  const after = attend(bundle); assert.equal(view(after).completedCount, 1); assert.deepEqual(view(after).completed[0].dates, ['2026-10-15']);
  assert.equal(view(after, nextMonth).completedCount, 0);
  const viaVisit = attend(bundle, 'a', at, 'visit'); assert.equal(view(viaVisit).completedCount, 1);
  assert.equal(view(attend(bundle, 'b')).completedCount, 0); // Another store's confirmation cannot complete A.
});

test('all retained attendance events count, with unique same-day dates and exact month boundaries', () => {
  let bundle = apply(fixture());
  bundle = attend(bundle, 'a', '2026-09-30T15:59:59.999Z');
  assert.equal(view(bundle).completedCount, 0);
  bundle = attend(bundle, 'a', '2026-09-30T16:00:00.000Z', 'visit');
  bundle = attend(bundle, 'a', '2026-10-01T01:00:00.000Z');
  bundle = attend(bundle, 'a', '2026-10-10T01:00:00.000Z');
  bundle = attend(bundle, 'a', '2026-11-01T01:00:00.000Z');
  assert.deepEqual(view(bundle).completed[0].dates, ['2026-10-10', '2026-10-01']);
  const november = apply(bundle, 'a', 'add', nextMonth);
  assert.equal(view(november, nextMonth).completedCount, 0); // Future month evidence does not pre-complete.
  assert.equal(view(november, nextMonth, '2026-11-01T02:00:00.000Z').completedCount, 1);
  assert.equal(view(november, month, '2026-11-01T02:00:00.000Z').completedCount, 1); // Not just latestDate.
});

test('ordinary edits, visit deletion and month removal/re-add preserve real attendance evidence', () => {
  let bundle = attend(apply(fixture()), 'a', at, 'visit');
  const old = bundle.ops.at(-1), next = structuredClone(bundle);
  next.ops.push(revision('visit', old.entity, structuredClone(old.data), [old.id], 'test', true)); bundle = next;
  bundle = alter(bundle, 'a', data => { data.contact = '修改聯絡欄位'; });
  const attendance = visitAttendanceForStore(bundle, 'a', later), removed = apply(bundle, 'a', 'remove');
  assert.equal(view(removed).total, 0); assert.equal(view(removed).removedStores[0].completed, true);
  const restored = apply(removed); assert.equal(view(restored).completedCount, 1);
  assert.deepEqual(visitAttendanceForStore(restored, 'a', later), attendance);
  assert.equal(restored.ops.filter(op => op.visitAttendance).length, 1);
});

test('future and malformed attendance cannot create a false checkmark', () => {
  const base = apply(fixture());
  assert.equal(view(attend(base, 'a', '2026-10-16T01:00:00.000Z')).completedCount, 0);
  for (const mutate of [op => op.visitAttendance.date = '2026-10-14', op => op.visitAttendance.at = 'bad', op => op.visitAttendance.extra = true,
    op => op.at = later, op => op.deleted = true, op => op.visitAttendance.store = 'b', op => op.data.name = '', op => op.id = '']) {
    const bad = attend(base); mutate(bad.ops.at(-1));
    assert.equal(view(bad).completedCount, 0);
  }
});

test('store IDs, not names, define membership and completion', () => {
  let bundle = alter(fixture(), 'b', data => { data.name = get(fixture()).name; });
  bundle = apply(bundle); bundle = apply(bundle, 'b'); bundle = attend(bundle);
  assert.equal(view(bundle).total, 2); assert.equal(view(bundle).completedCount, 1);
  assert.deepEqual(view(bundle).pending.map(row => row.storeId), ['b']);
});

test('past months remain view-only and current month is determined in Taipei', () => {
  const bundle = apply(fixture());
  assert.throws(() => apply(bundle, 'b', 'add', '2026-09'), /過去月份/);
  assert.throws(() => apply(bundle, 'a', 'remove', month, '2026-10-31T16:00:00.000Z'), /過去月份/);
  assert.equal(view(bundle, month, '2026-10-31T15:59:59.999Z').past, false);
  assert.equal(view(bundle, month, '2026-10-31T16:00:00.000Z').past, true);
  assert.equal(view(bundle, month, '2026-11-01T01:00:00.000Z').total, 1);
});

test('restored older versions leave past roster history visible without reviving current/future membership', () => {
  let bundle = apply(fixture()); bundle = apply(bundle, 'a', 'remove');
  bundle = alter(bundle, 'a', data => { delete data.monthlyVisits; }, '2026-11-01T01:00:00.000Z');
  const history = view(bundle, month, '2026-11-01T02:00:00.000Z');
  assert.equal(history.removedStores.length, 1); assert.equal(history.removedStores[0].historical, true);
  assert.equal(view(bundle).total, 0); assert.equal(view(bundle).removedStores.length, 0);
  let active = apply(fixture()); active = alter(active, 'a', data => { delete data.monthlyVisits; }, '2026-11-01T01:00:00.000Z');
  assert.equal(view(active, month, '2026-11-01T02:00:00.000Z').total, 1);
});

test('past membership follows version ancestry despite a backwards clock or same-time saves', () => {
  let bundle = apply(fixture());
  bundle = apply(bundle, 'a', 'remove', month, at); // The newer revision has an earlier clock.
  bundle = alter(bundle, 'a', data => { delete data.monthlyVisits; }, '2026-11-01T01:00:00.000Z');
  const result = view(bundle, month, '2026-11-02T01:00:00.000Z');
  assert.equal(result.total, 0); assert.equal(result.removedStores.length, 1); assert.equal(result.removedStores[0].historical, true);
  assert.deepEqual(view(bundle, month, '2026-11-02T01:00:00.000Z'), view({ ...bundle, ops: [...bundle.ops].reverse() }, month, '2026-11-02T01:00:00.000Z'));
});

test('conflicting retained historical membership stays visible but cannot claim completion', () => {
  const base = attend(apply(fixture())), removed = apply(base, 'a', 'remove'), kept = alter(base, 'a', data => { data.contact = '另一台資訊'; });
  let bundle = merge(removed, kept);
  bundle = alter(bundle, 'a', data => { delete data.monthlyVisits; }, '2026-11-01T01:00:00.000Z');
  assert.equal(get(bundle).conflict, false); // A generic restore resolved current heads, not past roster intent.
  const result = view(bundle, month, '2026-11-02T01:00:00.000Z');
  assert.equal(result.total, 1); assert.equal(result.stores[0].historical, true); assert.equal(result.stores[0].available, false);
  assert.match(result.stores[0].unavailableReason, /歷史不一致/); assert.equal(result.completedCount, 0);
  assert.deepEqual(result.stores[0].dates, ['2026-10-15']);
});

test('all store heads bind the preview, including stores not yet in this month', () => {
  const bundle = fixture(), pending = request(bundle, 'a', 'add');
  const changed = alter(bundle, 'b', data => { data.contact = '另一台更新'; });
  assert.throws(() => applyMonthlyVisitAction(changed, pending, 'test', later), /新版本/);
  assert.throws(() => applyMonthlyVisitAction(bundle, { ...pending, expectedBasis: basis(bundle, nextMonth) }, 'test', later), /新版本/);
  assert.equal(monthlyVisitBasis([...project(bundle)].reverse(), month), basis(bundle));
  const snapshot = structuredClone(changed); assert.throws(() => applyMonthlyVisitAction(changed, pending, 'test', later)); assert.deepEqual(changed, snapshot);
});

test('invalid requests reject without writes or inferred operations', () => {
  const bundle = fixture(), good = request(bundle, 'a', 'add'), snapshot = structuredClone(bundle);
  for (const bad of [null, {}, { ...good, month: '2026-13' }, { ...good, action: 'complete' }, { ...good, storeId: '' }, { ...good, extra: true }, { ...good, expectedBasis: 3 }]) {
    assert.throws(() => applyMonthlyVisitAction(bundle, bad, 'test', later));
  }
  for (const time of ['bad', '2026-02-30T00:00:00.000Z']) assert.throws(() => applyMonthlyVisitAction(bundle, good, 'test', time));
  assert.throws(() => applyMonthlyVisitAction(bundle, good, ' ', later));
  assert.throws(() => apply(bundle, 'missing'));
  assert.deepEqual(bundle, snapshot);
});

test('invalid or duplicate membership data fail closed and cannot hide corrupt input', () => {
  const good = get(apply(fixture())).heads[0].data;
  for (const mutate of [data => data.monthlyVisits = null, data => data.monthlyVisits = {}, data => data.monthlyVisits.push(data.monthlyVisits[0]),
    data => data.monthlyVisits[0].month = '2026-00', data => data.monthlyVisits[0].month = '0000-01', data => data.monthlyVisits[0].active = 1,
    data => data.monthlyVisits[0].updatedAt = '2026-02-30T00:00:00.000Z', data => data.monthlyVisits[0].extra = true,
    data => delete data.monthlyVisits[0].active, data => data.monthlyVisits.push(null)]) {
    const bad = structuredClone(good); mutate(bad); assert.equal(validData('store', bad), false);
    assert.throws(() => revision('store', 'x', bad, [], 'test')); assert.equal(monthlyVisitForStore(bad, month), null);
  }
  assert.equal(validData('store', { ...good, monthlyVisits: [] }), true);
  assert.equal(validData('person', { name: 'Synthetic', role: '', desc: '', confirmed: false, monthlyVisits: [] }), false);
  const badBundle = structuredClone(fixture()); badBundle.ops[0].data.monthlyVisits = [{ month, active: false, updatedAt: 'bad' }];
  assert.throws(() => applyMonthlyVisitAction(badBundle, request(badBundle, 'a', 'add'), 'test', later));
});

test('monthly storage bound preserves old years and rejects a new month atomically', () => {
  const bundle = alter(fixture(), 'a', data => { data.monthlyVisits = Array.from({ length: 1000 }, (_, i) => ({ month: shiftMonthlyVisitMonth(month, i), active: true, updatedAt: at })); });
  assert.equal(validData('store', get(bundle).heads[0].data), true);
  const snapshot = structuredClone(bundle);
  assert.throws(() => apply(bundle, 'a', 'add', shiftMonthlyVisitMonth(month, 1000)), /安全上限/);
  assert.deepEqual(bundle, snapshot);
  assert.equal(monthlyVisitForStore(get(apply(bundle, 'a', 'remove')), month).active, false);
});

test('deleted, pending and merged stores stay visible with warning, do not count complete and cannot mutate', () => {
  const base = attend(apply(fixture()));
  for (const status of ['deleted', 'csvIdentityPending', 'mergedInto']) {
    const bundle = alter(base, 'a', data => { if (status !== 'deleted') data[status] = status === 'mergedInto' ? 'b' : true; }, later, status === 'deleted');
    const result = view(bundle); assert.equal(result.total, 1); assert.equal(result.stores[0].available, false);
    assert.ok(result.stores[0].unavailableReason); assert.equal(result.completedCount, 0); assert.deepEqual(result.stores[0].dates, ['2026-10-15']);
    assert.throws(() => apply(bundle, 'a', 'remove'), /待確認/); assert.throws(() => apply(bundle, 'a', 'add', nextMonth), /待確認/);
  }
});

test('conflicting membership remains visible and both immutable branches survive sync', () => {
  const base = attend(apply(fixture()));
  const left = apply(base, 'a', 'remove'), right = alter(base, 'a', data => { data.contact = '另一台新資料'; });
  const combined = merge(left, right), result = view(combined);
  assert.equal(get(combined).conflict, true); assert.equal(result.total, 1); assert.equal(result.stores[0].active, true);
  assert.equal(result.stores[0].available, false); assert.equal(result.completedCount, 0);
  assert.throws(() => apply(combined, 'a', 'remove'), /衝突/);
  assert.deepEqual(merge(left, right), merge(right, left));
  assert.ok(get(combined).heads.some(head => head.data.monthlyVisits[0].active));
  assert.ok(get(combined).heads.some(head => !head.data.monthlyVisits[0].active));
});

test('encrypted backup, readonly import preview and sync preserve rosters and all history', async () => {
  const base = fixture(), next = apply(attend(apply(base)), 'a', 'remove'), snapshot = structuredClone(next);
  const meta = newMeta(), key = await derive('synthetic-monthly-test-passphrase', meta);
  const decoded = validateBundle(await unseal(await seal(next, key, meta), key)); assert.deepEqual(decoded, next);
  const preview = await planBackupImport(base, decoded);
  assert.equal(preview.summary.addedRevisions, 3); assert.equal(preview.summary.visitAttendance.addedMarks, 1);
  assert.deepEqual(get(preview.bundle).monthlyVisits, get(next).monthlyVisits);
  assert.deepEqual(view(preview.bundle).removedStores, view(next).removedStores);
  assert.deepEqual(merge(decoded, next), merge(next, decoded)); assert.deepEqual(next, snapshot);
});

test('same-store merge blocks current, removed and historical membership on either side', async () => {
  const base = apply(fixture()), removed = apply(base, 'a', 'remove'), historical = alter(removed, 'a', data => { delete data.monthlyVisits; });
  for (const bundle of [base, removed, historical]) for (const [keeperId, donorId] of [['a', 'b'], ['b', 'a']]) {
    const snapshot = structuredClone(bundle);
    await assert.rejects(planStoreMerge(bundle, { keeperId, donorId, name: '虛構整併' }), /每月拜訪名單歷史/);
    assert.deepEqual(bundle, snapshot);
  }
});

test('generic safe-conflict suggestion cannot silently choose monthly membership', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('const SAFE_CONFLICT_BLOCKED_FIELDS ='), end = app.indexOf('function safeMergeSummary(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ structuredClone }); vm.runInContext(app.slice(start, end), context);
  const base = { id: 'base', parents: [], data: storeData('Synthetic'), deleted: false, at };
  const left = { id: 'left', parents: ['base'], data: { ...base.data, monthlyVisits: [{ month, active: true, updatedAt: later }] }, deleted: false, at: later };
  const right = { id: 'right', parents: ['base'], data: { ...base.data, contact: 'Changed' }, deleted: false, at: later };
  const plan = context.safeConflictMerge({ type: 'store', id: 'a', conflict: true, heads: [left, right], versions: [base, left, right] });
  assert.equal(plan.safe, false); assert.ok(plan.blocked.some(item => item.field === 'monthlyVisits' && item.kind === 'protected'));
});
