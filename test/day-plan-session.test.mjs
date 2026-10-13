import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = app.indexOf('function assertDayPlanContext(');
const end = app.indexOf('function openDayPlanSelection(', start);
assert.ok(start >= 0 && end > start, 'Exercise the actual session guards and foreground-resume implementation');
const implementation = app.slice(start, end);

function session() {
  const key = { synthetic: 'key' }, meta = { synthetic: 'meta' }, bundle = { ops: ['synthetic-only'] };
  const ctx = {
    kind: 'selection', date: '2026-10-14', key, meta, bundle, revision: 17, epoch: 3,
    today: '2026-10-13', query: '虛構搜尋', basis: 'synthetic-view-basis',
  };
  const sandbox = vm.createContext({
    dayPlanContext: ctx, busy: false, payload: { bundle }, document: { hidden: false },
    pendingLock: false, updateHolding: false, autoFetching: false, syncInProgress: false,
    dayPlanSelectedDate: '2026-10-14', key, meta, localRevision: 17, syncEpoch: 4,
    currentDate: '2026-10-13', dayPlanDate() { return sandbox.currentDate; },
  });
  vm.runInContext(implementation, sandbox);
  return { sandbox, ctx };
}

test('returning to an unchanged add dialog renews only its epoch and preserves the search', () => {
  const { sandbox, ctx } = session(), before = structuredClone(ctx);
  assert.throws(() => sandbox.assertDayPlanContext(ctx), /尚未寫入/);
  sandbox.resumeDayPlanContext();
  assert.equal(ctx.epoch, sandbox.syncEpoch);
  assert.deepEqual({ ...ctx, epoch: before.epoch }, before);
  assert.doesNotThrow(() => sandbox.assertDayPlanContext(ctx));
  sandbox.resumeDayPlanContext();
  assert.equal(ctx.epoch, 4); // Repeated pageshow/visibility events are idempotent.
});

test('foreground renewal refuses every changed data, identity, date, lock, or visibility boundary', async t => {
  const cases = [
    ['background', s => { s.document.hidden = true; }],
    ['pending lock', s => { s.pendingLock = true; }],
    ['program update', s => { s.updateHolding = true; }],
    ['fetch in progress', s => { s.autoFetching = true; }],
    ['sync in progress', s => { s.syncInProgress = true; }],
    ['missing payload', s => { s.payload = null; }],
    ['another key', s => { s.key = { synthetic: 'other-key' }; }],
    ['another metadata object', s => { s.meta = { synthetic: 'other-meta' }; }],
    ['another bundle, even with equal content', s => { s.payload.bundle = structuredClone(s.payload.bundle); }],
    ['new local revision', s => { s.localRevision++; }],
    ['Taipei midnight rollover', s => { s.currentDate = '2026-10-14'; }],
    ['selected itinerary day changed', s => { s.dayPlanSelectedDate = '2026-10-15'; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    const { sandbox, ctx } = session(); change(sandbox);
    sandbox.resumeDayPlanContext();
    assert.equal(ctx.epoch, 3);
    assert.throws(() => sandbox.assertDayPlanContext(ctx), /尚未寫入/);
  });
});

test('background and return during an in-flight save cannot refresh its stale guard', () => {
  const { sandbox, ctx } = session();
  sandbox.busy = true;
  sandbox.resumeDayPlanContext();
  assert.equal(ctx.epoch, 3);
  assert.throws(() => sandbox.assertDayPlanContext(ctx), /尚未寫入/);
  // Even after busy clears, no implicit write occurs and the interrupted save's
  // old guard remains invalid until a separate foreground revalidation happens.
  sandbox.busy = false;
  assert.throws(() => sandbox.assertDayPlanContext(ctx), /尚未寫入/);
});

test('save guard rejects later changes after a successful foreground revalidation', async t => {
  const cases = [
    ['epoch', s => { s.syncEpoch++; }],
    ['bundle', s => { s.payload.bundle = { ops: ['other-synthetic-version'] }; }],
    ['local revision', s => { s.localRevision++; }],
    ['background', s => { s.document.hidden = true; }],
    ['date', s => { s.currentDate = '2026-10-14'; }],
    ['selected day', s => { s.dayPlanSelectedDate = '2026-10-15'; }],
    ['fetch', s => { s.autoFetching = true; }],
    ['sync', s => { s.syncInProgress = true; }],
  ];
  for (const [name, change] of cases) await t.test(name, () => {
    const { sandbox, ctx } = session();
    sandbox.resumeDayPlanContext();
    assert.doesNotThrow(() => sandbox.assertDayPlanContext(ctx));
    change(sandbox);
    assert.throws(() => sandbox.assertDayPlanContext(ctx), /尚未寫入/);
  });
});

test('no retained form or missing context is handled without inventing a session', () => {
  const { sandbox, ctx } = session(); sandbox.dayPlanContext = null;
  assert.doesNotThrow(() => sandbox.resumeDayPlanContext());
  assert.equal(sandbox.dayPlanContext, null);
  assert.equal(ctx.epoch, 3);
  assert.throws(() => sandbox.assertDayPlanContext(null), /尚未寫入/);
});
