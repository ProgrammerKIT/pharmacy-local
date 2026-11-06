import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../public/core.js';
import * as relations from '../public/relations.js';

// Invented notes only. Exercise the actual browser handoff and scheduler together.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from); return app.slice(from, to);
}
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function harness() {
  const bundle = core.emptyBundle('fictional-batch-scheduling');
  const jobs = [];
  for (let i = 0; i < 12; i++) {
    const storeId = `s${i}`, visitId = `v${i}`;
    bundle.ops.push(core.revision('store', storeId, { name: `虛構排程店${i}`, city: '', district: '', channel: '', attr: '', contact: '' }, [], 'fictional'), core.revision('visit', visitId, { store: storeId, text: '小雨分享產品介紹經驗。', date: '', source: '虛構', next: '原有跟進', people: [], topics: [], attachments: [] }, [], 'fictional'));
    const request = relations.peopleReadingRequest(bundle, storeId);
    jobs.push({ id: `job${i}`, storeId, state: 'ready', basis: request.plan.basis, input: { format: 'pharmacy-people-review-1', vaultId: bundle.vaultId, result: { format: request.plan.format, storeId, basis: request.plan.basis, coveredRevisions: request.plan.sources.map(s => s.revisionId), people: [{ name: '小雨', kind: 'local', items: [{ category: 'interaction', text: '分享產品介紹經驗。', evidence: [{ visitId, revisionId: request.plan.sources[0].revisionId, quote: '小雨分享產品介紹經驗。' }] }] }] } } });
  }
  let now = 100000, timerId = 0, timers = new Map(), c;
  const control = { statusGate: null, saveGate: null, failSave: false, syncs: 0, weeklyStarts: 0, saves: 0, saveEntered: deferred(), acks: [] };
  c = vm.createContext({ monthlyFeedbackContext:null,  ...core, ...relations, structuredClone, TextEncoder, Map, Set, Promise,
    key: {}, payload: { token: 'fictional', device: 'fictional', bundle, dirty: false, serverVersion: 1 },
    peopleReadingEpoch: 0, busy: false, gateOpening: false, pendingLock: false, updateHolding: false, autoFetching: false, syncInProgress: false,
    recoveryExportContext: null, weeklyContext: null, weeklyRunning: false, weeklyRetryAt: 0, backupPreview: null, editorContext: null, singleStoreContext: null, inlineTextContext: null, reminderContext: null, dayPlanContext: null, monthlyVisitContext: null, attendancePrompt: null,
    navigator: { onLine: true }, document: { hidden: false }, csvImport: { hasPending: () => false }, $: () => ({ open: false }),
    canScanInsights: () => !c.busy && !c.autoFetching && !c.syncInProgress && !c.editorContext && !c.pendingLock && !c.weeklyRunning,
    insightScanIdle: () => c.canScanInsights(), all: type => core.project(c.payload.bundle).filter(r => r.type === type),
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; }, clearTimeout: id => timers.delete(id),
    api: async (route, options) => {
      if (route.endsWith('/status')) { if (control.statusGate) await control.statusGate.promise; return { enabled: true, entries: structuredClone(jobs), ready: structuredClone(jobs.filter(j => j.state === 'ready').slice(0, 5)) }; }
      if (route.endsWith('/ack')) { control.acks.push(options.body); jobs.find(j => j.id === options.body.id).state = options.body.outcome; return {}; }
      throw Error(`Unexpected route ${route}`);
    },
    persist: async (next, options) => { control.saveEntered.resolve(); if (control.saveGate) await control.saveGate.promise; options.guard(); if (control.failSave) throw Error('fictional disk failure'); c.payload = next; control.saves++; c.syncScheduler.request('saved'); },
    weeklyReady: () => true, assertWeeklyIdle() {}, run: async () => { control.weeklyStarts++; throw Error('fictional weekly exit'); },
    renderWeeklyStatus() {}, renderDataSafetyEntry() {}, weeklyState: null
  });
  vm.runInContext(section('function createSyncScheduler(', 'function syncSession()') + section('let peopleBatchRunning=', 'const peopleReadingViews ='), c);
  c.renderPeopleBatchStatus = () => {};
  // Extract the full real backup tick, including its finally cleanup.
  vm.runInContext(section('async function weeklyTick(', 'async function downloadWeeklyBackup('), c);
  c.syncScheduler = c.createSyncScheduler({ ready: c.canAutoSync, attempt: async () => { control.syncs++; c.autoFetching = true; await Promise.resolve(); c.autoFetching = false; c.payload = { ...c.payload, dirty: false }; return 'success'; }, now: () => now, setTimer: c.setTimeout, clearTimer: c.clearTimeout });
  async function advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); await timer.fn(); } }
  return { c, jobs, control, bundle, advance };
}

test('status handoff excludes same-tick sync poll and backup, then releases both', async () => {
  const h = harness(), gate = deferred(); h.control.statusGate = gate;
  const tick = h.c.peopleBatchTick(true); h.c.syncScheduler.request('poll');
  await h.advance(1); await h.c.weeklyTick();
  assert.equal(h.control.syncs, 0, 'poll must not race the status response');
  assert.equal(h.control.weeklyStarts, 0, 'backup must not interrupt handoff');
  gate.resolve(); await tick; await h.advance(501);
  assert.equal(h.jobs.filter(j => j.state === 'saved').length, 5);
  assert.equal(h.control.syncs, 1); assert.equal(h.c.payload.dirty, false);
  await h.c.weeklyTick(true); assert.equal(h.control.weeklyStarts, 1);
});

test('repeated real handoffs drain more than one page and preserve every original revision', async () => {
  const h = harness();
  for (let i = 0; i < 4; i++) { await h.c.peopleBatchTick(true); await h.advance(16000); }
  assert.equal(h.jobs.filter(j => j.state === 'saved').length, 12);
  assert.equal(h.control.saves, 3);
  assert.deepEqual(h.c.payload.bundle.ops.slice(0, h.bundle.ops.length), h.bundle.ops);
  assert.equal(h.c.payload.bundle.ops.filter(op => op.type === 'visit').length, 12);
  for (let i = 0; i < 12; i++) assert.equal(relations.currentPeopleReading(h.c.payload.bundle, `s${i}`).current.peopleReading.mode, 'automatic');
});

test('save failure keeps ready results for retry and wakes pending sync', async () => {
  const h = harness(); h.control.failSave = true;
  await h.c.peopleBatchTick(true);
  assert.equal(h.control.acks.length, 0); assert.equal(h.control.saves, 0);
  assert.equal(h.c.canAutoSync(), true);
  h.control.failSave = false; await h.c.peopleBatchTick(true); await h.advance(501);
  assert.equal(h.jobs.filter(j => j.state === 'saved').length, 5);
});

test('editing or locking during handoff cancels saving and acknowledgement', async () => {
  for (const interrupt of [h => h.c.editorContext = {}, h => { h.c.key = {}; h.c.peopleReadingEpoch++; }]) {
    const h = harness(), gate = deferred(); h.control.saveGate = gate;
    const tick = h.c.peopleBatchTick(true);
    await h.control.saveEntered.promise;
    interrupt(h); gate.resolve(); await tick;
    assert.equal(h.control.saves, 0); assert.equal(h.control.acks.length, 0);
    assert.equal(h.jobs.filter(j => j.state === 'ready').length, 12);
  }
});
