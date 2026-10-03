import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { newMeta, derive, seal, unseal, emptyBundle, revision, merge, validateBundle, project } from '../public/core.js';

// Actual scheduler, deterministic fake clock, no browser, socket or customer data.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing application extraction boundary: ${start}`);
  return app.slice(a, b);
}
const settle = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function fakeClock() {
  let time = Date.parse('2026-10-03T01:00:00.000Z'), id = 0;
  const timers = new Map();
  return { timers, now: () => time,
    setTimer(fn, delay = 0) { const token = ++id; timers.set(token, { fn, at: time + Math.max(0, delay) }); return token; },
    clearTimer(token) { timers.delete(token); },
    async advance(ms) {
      const until = time + ms; let count = 0;
      await settle();
      while (true) {
        const next = [...timers.entries()].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        assert.ok(++count < 100, 'Scheduler must not create a zero-delay busy loop');
        timers.delete(next[0]); time = next[1].at; next[1].fn(); await settle();
      }
      time = until; await settle();
    }
  };
}
function schedulerHarness() {
  const clock = fakeClock(), calls = [], notices = [], c = vm.createContext({ Date, Math, Promise });
  vm.runInContext(section('function createSyncScheduler(', 'function canAutoSync('), c);
  const control = { ready: true, result: 'success', implementation: null };
  const scheduler = c.createSyncScheduler({ ready: () => control.ready,
    attempt: async () => { calls.push(clock.now()); return control.implementation ? control.implementation() : control.result; },
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onChange: (...args) => notices.push(args) });
  return { clock, calls, notices, control, scheduler };
}

test('saved requests coalesce for 500ms and perform one attempt', async () => {
  const h = schedulerHarness(), start = h.clock.now();
  for (let n = 0; n < 20; n++) h.scheduler.request('saved');
  assert.equal(h.scheduler.state().pending, true); assert.equal(h.calls.length, 0); assert.equal(h.clock.timers.size, 1);
  await h.clock.advance(499); assert.equal(h.calls.length, 0);
  await h.clock.advance(1); assert.deepEqual(h.calls, [start + 500]);
  assert.equal(h.scheduler.state().pending, false); assert.equal(h.scheduler.state().inFlight, false); assert.equal(h.scheduler.state().failures, 0); assert.equal(h.scheduler.state().retryAt, 0);
});

test('foreground and online use the same short delay while polling can attempt immediately', async () => {
  for (const reason of ['foreground', 'online']) {
    const h = schedulerHarness(); h.scheduler.request(reason); await h.clock.advance(499); assert.equal(h.calls.length, 0);
    await h.clock.advance(1); assert.equal(h.calls.length, 1);
  }
  const h = schedulerHarness(); h.scheduler.request('poll'); await h.clock.advance(0); assert.equal(h.calls.length, 1);
});

test('blocked readiness keeps pending work without polling or trying until wake', async () => {
  const h = schedulerHarness(); h.control.ready = false; h.scheduler.request('saved');
  await h.clock.advance(600000); assert.equal(h.calls.length, 0); assert.equal(h.clock.timers.size, 0); assert.equal(h.scheduler.state().pending, true);
  h.control.ready = true; h.scheduler.wake(); await h.clock.advance(500); assert.equal(h.calls.length, 1); assert.equal(h.scheduler.state().pending, false);
});

test('readiness is rechecked at the scheduled time, preserving a blocked request for later', async () => {
  const h = schedulerHarness(); h.scheduler.request('saved'); h.control.ready = false;
  await h.clock.advance(500); assert.equal(h.calls.length, 0); assert.equal(h.scheduler.state().pending, true); assert.equal(h.clock.timers.size, 0);
  h.control.ready = true; h.scheduler.wake(); await h.clock.advance(500); assert.equal(h.calls.length, 1);
});

test('failures back off at 15, 30, 60, 120 and capped 300 seconds without repeated events moving the deadline earlier', async () => {
  const h = schedulerHarness(); h.control.result = 'failure'; h.scheduler.request('poll'); await h.clock.advance(0);
  let count = 1;
  for (const delay of [15000, 30000, 60000, 120000, 300000, 300000]) {
    const retryAt = h.scheduler.state().retryAt; assert.equal(retryAt - h.clock.now(), delay); assert.equal(h.scheduler.state().failures, count);
    for (const reason of ['saved', 'online', 'foreground', 'poll', 'saved']) { h.scheduler.request(reason); h.scheduler.wake(); }
    assert.equal(h.scheduler.state().retryAt, retryAt); assert.equal(h.clock.timers.size, 1);
    await h.clock.advance(delay - 1); assert.equal(h.calls.length, count);
    await h.clock.advance(1); assert.equal(h.calls.length, ++count);
  }
});

test('successful retry clears failure state and later saves return to the normal 500ms delay', async () => {
  const h = schedulerHarness(); h.control.result = 'failure'; h.scheduler.request('poll'); await h.clock.advance(0);
  h.control.result = 'success'; await h.clock.advance(15000); assert.equal(h.calls.length, 2);
  assert.equal(h.scheduler.state().failures, 0); assert.equal(h.scheduler.state().retryAt, 0); assert.equal(h.scheduler.state().pending, false);
  h.scheduler.request('saved'); await h.clock.advance(499); assert.equal(h.calls.length, 2); await h.clock.advance(1); assert.equal(h.calls.length, 3);
});

test('concurrent requests cannot overlap an in-flight attempt', async () => {
  const h = schedulerHarness(); let release;
  h.control.implementation = () => new Promise(resolve => { release = resolve; });
  h.scheduler.request('poll'); await h.clock.advance(0); assert.equal(h.scheduler.state().inFlight, true);
  for (let n = 0; n < 20; n++) { h.scheduler.request('saved'); h.scheduler.request('online'); h.scheduler.wake(); }
  await h.clock.advance(600000); assert.equal(h.calls.length, 1);
  h.control.implementation = null; release('success'); await settle(); await h.clock.advance(500);
  assert.equal(h.scheduler.state().inFlight, false); assert.ok(h.calls.length <= 2, 'Coalesced follow-up may run once, never once per event');
});

test('deferred attempts retain pending work without failure inflation or a busy retry loop', async () => {
  const h = schedulerHarness(); h.control.result = 'deferred'; h.scheduler.request('poll'); await h.clock.advance(0);
  assert.equal(h.calls.length, 1); assert.equal(h.scheduler.state().pending, true); assert.equal(h.scheduler.state().failures, 0); assert.equal(h.scheduler.state().retryAt, 0);
  await h.clock.advance(600000); assert.equal(h.calls.length, 1); assert.equal(h.clock.timers.size, 0);
  h.control.result = 'success'; h.scheduler.wake(); await h.clock.advance(500); assert.equal(h.calls.length, 2);
});

test('thrown transport failures follow backoff without escaping the timer callback', async () => {
  const h = schedulerHarness(); h.control.implementation = async () => { throw new Error('synthetic offline'); };
  h.scheduler.request('poll'); await h.clock.advance(0);
  assert.equal(h.scheduler.state().failures, 1); assert.equal(h.scheduler.state().retryAt - h.clock.now(), 15000); assert.equal(h.scheduler.state().inFlight, false);
});

test('pause cancels the timer while retaining work for a later foreground wake', async () => {
  const h = schedulerHarness(); h.scheduler.request('saved'); h.scheduler.pause();
  assert.equal(h.clock.timers.size, 0); assert.equal(h.scheduler.state().pending, true);
  await h.clock.advance(600000); assert.equal(h.calls.length, 0); h.scheduler.wake(); await h.clock.advance(500); assert.equal(h.calls.length, 1);
});

test('reset clears queued work and ignores a late old-session flight result', async () => {
  for (const outcome of ['success', 'failure']) {
    const h = schedulerHarness(); let release; h.control.implementation = () => new Promise(resolve => { release = resolve; });
    h.scheduler.request('poll'); await h.clock.advance(0); h.scheduler.request('saved'); h.scheduler.reset();
    const state = () => { const x = h.scheduler.state(); return { pending: x.pending, inFlight: x.inFlight, failures: x.failures, retryAt: x.retryAt }; };
    assert.deepEqual(state(), { pending: false, inFlight: true, failures: 0, retryAt: 0 });
    h.scheduler.request('foreground'); await h.clock.advance(500); assert.equal(h.calls.length, 1);
    assert.equal(state().pending, true); assert.equal(state().inFlight, true);
    h.control.implementation = null; release(outcome); await settle();
    assert.equal(state().pending, true); assert.equal(state().inFlight, false); assert.equal(state().failures, 0); assert.equal(state().retryAt, 0);
    await h.clock.advance(0); assert.equal(h.calls.length, 2);
    assert.deepEqual(state(), { pending: false, inFlight: false, failures: 0, retryAt: 0 });
  }
});

test('explicit failure and confirmation share the same backoff state as scheduled attempts', async () => {
  const h = schedulerHarness(); h.scheduler.failed();
  assert.equal(h.scheduler.state().failures, 1); assert.equal(h.scheduler.state().retryAt - h.clock.now(), 15000);
  h.scheduler.confirmed(); assert.equal(h.scheduler.state().failures, 0); assert.equal(h.scheduler.state().retryAt, 0);
  h.scheduler.request('saved'); await h.clock.advance(500); assert.equal(h.calls.length, 1); assert.ok(h.notices.length > 0);
});

test('a wake or request received during a deferred flight is retried once after 500ms', async () => {
  for (const signal of ['wake', 'request']) {
    const h = schedulerHarness(); let release;
    h.control.implementation = () => new Promise(resolve => { release = resolve; });
    h.scheduler.request('poll'); await h.clock.advance(0);
    if (signal === 'wake') h.scheduler.wake(); else h.scheduler.request('foreground');
    h.control.implementation = null; release('deferred'); await settle();
    await h.clock.advance(499); assert.equal(h.calls.length, 1);
    await h.clock.advance(1); assert.equal(h.calls.length, 2); assert.equal(h.scheduler.state().pending, false);
  }
});

const OLD = '2026-10-02T01:00:00.000Z';
const syntheticMeta = newMeta();
const syntheticKey = await derive('synthetic-sync-scheduler-only', syntheticMeta);
const baseBundle = emptyBundle(syntheticMeta.vaultId);
baseBundle.ops.push(revision('store', 'synthetic-store', { name: '虛構測試門市', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'synthetic-device'));
const appSyncFunctions = section('async function persist(', 'function pendingSyncSummary(') +
  section('function createSyncScheduler(', 'function lockNow(') +
  section('async function recordUnchangedSync(', 'function renderDataSafetyEntry(') +
  section('async function run(', 'function programDetail(');
async function waitUntil(predicate, message = 'asynchronous synthetic operation settled') {
  // Real WebCrypto completion depends on worker scheduling, not an event-loop turn count.
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
function latch() {
  let resolve, entered;
  const waiting = new Promise(done => { resolve = done; }), started = new Promise(done => { entered = done; });
  return { started, release: resolve, wait: async () => { entered(); await waiting; } };
}
async function appHarness() {
  const clock = fakeClock(), calls = [], writes = [], savedRequests = [], elements = new Map();
  const control = { failure: '', hook: null, sealHook: null, writeHook: null, unsealHook: null };
  const remote = { version: 1, envelope: await seal(baseBundle, syntheticKey, syntheticMeta) };
  const initial = { schema: 1, device: 'synthetic-phone', deviceName: 'Synthetic phone', token: 'synthetic-token', bundle: structuredClone(baseBundle), dirty: false, serverVersion: 1, lastSync: OLD, pendingSync: { entities: [], unknown: false } };
  const local = { revision: 1, envelope: await seal(initial, syntheticKey, syntheticMeta, 'device') };
  const $ = id => { if (!elements.has(id)) elements.set(id, { textContent: '', open: false, dataset: {}, hidden: false }); return elements.get(id); };
  const c = vm.createContext({ Math, Promise, Error, Set, key: syntheticKey, meta: syntheticMeta, payload: initial, localRevision: 1, slot: null,
    localSaveState: 'saved', syncInProgress: false, syncEpoch: 0, autoFetching: false, updateHolding: false, pendingLock: false, gateOpening: false, busy: false,
    backupPreview: null, editorContext: null, singleStoreContext: null, inlineTextContext: null, reminderContext: null, attendancePrompt: null,
    document: { hidden: false }, navigator: { onLine: true }, csvImport: { hasPending: () => false }, records: project(initial.bundle),
    lastError: '', lastSyncFailure: null, syncWarning: '', $, dateText: String, validateBundle, merge,
    renderDataSafetyEntry() {}, status() {}, buttons() {}, toast() {}, lockNow() { c.pendingLock = false; c.key = null; c.syncEpoch++; c.syncScheduler.reset(); },
    render() { c.records = project(c.payload.bundle); }
  });
  c.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [clock.now()])); } static now() { return clock.now(); } };
  c.seal = async (...args) => { if (control.sealHook) await control.sealHook(...args); return seal(...args); };
  c.unseal = async (...args) => { if (control.unsealHook) await control.unsealHook(...args); return unseal(...args); };
  c.writeLocal = async (envelope, expected, unlockKey) => {
    if (control.writeHook) await control.writeHook(envelope, expected, unlockKey);
    if (control.failure === 'disk') throw Error('synthetic disk failure');
    assert.equal(expected, local.revision, 'Actual persist must use captured CAS revision');
    assert.equal(unlockKey, syntheticKey); local.revision++; local.envelope = envelope; writes.push(envelope); return local.revision;
  };
  c.api = async (route, options = {}) => {
    const method = options.method || 'GET'; calls.push([route, method]);
    if (control.hook) await control.hook(route, options);
    if (control.failure === 'network' || (control.failure === 'put' && method === 'PUT')) throw Error('synthetic network failure');
    if (route === '/api/version') return { version: remote.version };
    if (route === '/api/snapshot' && method === 'GET') return structuredClone(remote);
    if (route === '/api/snapshot' && method === 'PUT') {
      if (options.body.expectedVersion !== remote.version) { const e = Error('synthetic concurrent write'); e.status = 409; throw e; }
      remote.version++; remote.envelope = options.body.envelope;
      if (control.failure === 'lost-ack') throw Error('synthetic accepted upload but response lost');
      return { version: remote.version, backupOK: true };
    }
    throw Error('Unexpected synthetic route');
  };
  vm.runInContext(appSyncFunctions, c);
  c.syncScheduler = c.createSyncScheduler({ ready: c.canAutoSync, attempt: c.autoSync, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const request = c.syncScheduler.request;
  c.syncScheduler.request = reason => { savedRequests.push(reason); request(reason); };
  async function addVisit(id = 'synthetic-visit') {
    const bundle = structuredClone(c.payload.bundle);
    bundle.ops.push(revision('visit', id, { store: 'synthetic-store', date: '2026-10-02', text: '僅供測試的原始筆記', next: '', source: 'synthetic', topics: [], people: [], attachments: [] }, [], 'synthetic-phone'));
    await c.persist({ ...c.payload, bundle, dirty: true }); return bundle.ops.at(-1);
  }
  return { c, $, clock, calls, writes, remote, local, control, savedRequests, addVisit };
}

test('actual encrypted formal save schedules one transfer, confirms Mac and clears only pending formal work', async () => {
  const h = await appHarness(); const op = await h.addVisit();
  assert.deepEqual(h.savedRequests, ['saved']); assert.equal(h.c.payload.dirty, true); assert.equal(h.c.payload.lastSync, OLD);
  assert.equal(h.c.payload.pendingSync.entities.length, 1); assert.equal(h.calls.length, 0);
  await h.clock.advance(499); assert.equal(h.calls.length, 0); await h.clock.advance(1);
  await waitUntil(() => !h.c.syncScheduler.state().inFlight);
  assert.equal(h.c.payload.dirty, false); assert.equal(h.c.payload.pendingSync.entities.length, 0);
  assert.equal(h.c.payload.lastSync, new Date(h.clock.now()).toISOString());
  assert.equal((await unseal(h.remote.envelope, syntheticKey)).ops.filter(x => x.id === op.id).length, 1);
  assert.equal((await unseal(h.local.envelope, syntheticKey, 'device')).dirty, false);
  assert.deepEqual(h.calls, [['/api/version', 'GET'], ['/api/snapshot', 'GET'], ['/api/snapshot', 'PUT']]);
  assert.deepEqual(h.savedRequests, ['saved'], 'Sync merge persistence must not recursively schedule another saved request');
});

test('actual draft, reminder draft, preference and health persistence never trigger a save transfer', async () => {
  for (const dirty of [false, true]) {
    const h = await appHarness(); h.c.payload.dirty = dirty;
    for (const patch of [{ draft: { format: 'visit-draft-1', text: 'synthetic unfinished' } }, { inlineTextDraft: { format: 'inline-text-draft-1', text: 'synthetic unfinished' } }, { reminderDrafts: [{ store: 'synthetic-store', next: 'synthetic unfinished' }] }, { lastHealthAudit: OLD }, { deviceName: 'Synthetic changed label' }]) {
      await h.c.persist({ ...h.c.payload, ...patch });
    }
    assert.deepEqual(h.savedRequests, []); await h.clock.advance(600000); assert.equal(h.calls.length, 0);
    assert.equal(h.c.payload.lastSync, OLD);
    assert.deepEqual((await unseal(h.local.envelope, syntheticKey, 'device')).bundle, baseBundle);
  }
});

test('a save performed offline waits for an online event and then converges without new revisions', async () => {
  const h = await appHarness(); h.c.navigator.onLine = false; const op = await h.addVisit();
  await h.clock.advance(600000); assert.equal(h.calls.length, 0); assert.equal(h.c.syncScheduler.state().pending, true);
  h.c.navigator.onLine = true; h.c.syncScheduler.request('online'); await h.clock.advance(500);
  await waitUntil(() => !h.c.syncScheduler.state().inFlight);
  assert.equal(h.c.payload.dirty, false); assert.equal(h.c.payload.bundle.ops.filter(x => x.id === op.id).length, 1);
});

const blockers = [
  ['offline', c => { c.navigator.onLine = false; }, c => { c.navigator.onLine = true; }],
  ...['pendingLock', 'updateHolding', 'busy', 'gateOpening', 'syncInProgress', 'autoFetching'].map(name => [name, c => { c[name] = true; }, c => { c[name] = false; }]),
  ...['backupPreview', 'editorContext', 'singleStoreContext', 'inlineTextContext', 'reminderContext', 'attendancePrompt'].map(name => [name, c => { c[name] = {}; }, c => { c[name] = null; }]),
  ['hidden', c => { c.document.hidden = true; }, c => { c.document.hidden = false; }],
  ['locked', c => { c.key = null; }, c => { c.key = syntheticKey; }],
  ['unpaired', c => { c.payload.token = ''; }, c => { c.payload.token = 'synthetic-token'; }],
  ['inline draft', c => { c.payload.inlineTextDraft = { format: 'inline-text-draft-1' }; }, c => { delete c.payload.inlineTextDraft; }],
  ['CSV preview', c => { c.csvImport.hasPending = () => true; }, c => { c.csvImport.hasPending = () => false; }],
  ...['review', 'editor', 'quick-text-dialog', 'store-reminder-dialog', 'rebuild-dialog', 'backup-review', 'visit-attendance-dialog'].map(id => [id, (c, $) => { $(id).open = true; }, (c, $) => { $(id).open = false; }])
];
test('all editing, confirmation, background, update and lock guards block probes and writes, then safely wake', async () => {
  for (const [name, block, release] of blockers) {
    const h = await appHarness(); block(h.c, h.$);
    const before = JSON.stringify(h.c.payload); h.c.syncScheduler.request('saved');
    assert.equal(await h.c.autoSync(), 'deferred', name); await h.clock.advance(60000);
    assert.equal(h.calls.length, 0, name); assert.equal(h.writes.length, 0, name); assert.equal(JSON.stringify(h.c.payload), before, name);
    release(h.c, h.$); h.c.syncScheduler.wake(); await h.clock.advance(0);
    await waitUntil(() => !h.c.syncScheduler.state().inFlight, name);
    assert.equal(h.calls.length, 1, name); assert.equal(h.c.payload.lastSync, new Date(h.clock.now()).toISOString(), name);
  }
});

test('an editor or confirmation opened during a version probe prevents snapshots and acknowledgement writes', async () => {
  for (const name of ['editorContext', 'singleStoreContext', 'inlineTextContext', 'reminderContext', 'attendancePrompt', 'backupPreview']) {
    const h = await appHarness(), gate = latch(); h.control.hook = () => gate.wait();
    const task = h.c.autoSync(); await gate.started; h.c[name] = {}; gate.release();
    assert.equal(await task, 'deferred', name); assert.deepEqual(h.calls, [['/api/version', 'GET']]);
    assert.equal(h.writes.length, 0); assert.equal(h.c.payload.lastSync, OLD); assert.equal(h.c.autoFetching, false);
  }
});

test('actual network failures retain encrypted local edits and old successful time through backoff and retry', async () => {
  for (const failure of ['network', 'put']) {
    const h = await appHarness(), op = await h.addVisit(); h.control.failure = failure;
    await h.clock.advance(500); await waitUntil(() => !h.c.syncScheduler.state().inFlight);
    assert.equal(h.c.payload.dirty, true); assert.equal(h.c.payload.lastSync, OLD); assert.equal(h.c.payload.pendingSync.entities.length, 1);
    const attempts = h.calls.length, retry = h.c.syncScheduler.state().retryAt;
    for (let i = 0; i < 5; i++) h.c.syncScheduler.request('online');
    await h.clock.advance(retry - h.clock.now() - 1); assert.equal(h.calls.length, attempts);
    h.control.failure = ''; await h.clock.advance(1); await waitUntil(() => !h.c.syncScheduler.state().inFlight);
    assert.equal(h.c.payload.dirty, false); assert.equal(h.c.syncScheduler.state().failures, 0);
    assert.equal((await unseal(h.remote.envelope, syntheticKey)).ops.filter(x => x.id === op.id).length, 1);
  }
});

test('lost acknowledgement retry recognizes the already accepted revisions without a duplicate upload or revision', async () => {
  const h = await appHarness(), op = await h.addVisit(); h.c.syncScheduler.pause(); h.control.failure = 'lost-ack';
  await assert.rejects(h.c.synchronize(), /response lost/); assert.equal(h.c.payload.dirty, true); assert.equal(h.c.payload.lastSync, OLD);
  assert.equal(h.remote.version, 2); h.control.failure = ''; await h.c.synchronize();
  assert.equal(h.remote.version, 2); assert.equal(h.calls.filter(([, method]) => method === 'PUT').length, 1);
  assert.equal(h.c.payload.dirty, false); assert.equal(h.c.payload.pendingSync.entities.length, 0);
  assert.equal(h.c.payload.bundle.ops.filter(x => x.id === op.id).length, 1);
});

test('a concurrent Mac update is merged after 409 without duplicating either revision or transmitting device drafts', async () => {
  const h = await appHarness(), op = await h.addVisit(); h.c.syncScheduler.pause();
  h.c.payload.reminderDrafts = [{ store: 'synthetic-store', next: 'private synthetic unfinished' }];
  let concurrent = false;
  const other = revision('store', 'synthetic-other-store', { name: '另一間虛構測試門市', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'synthetic-mac');
  h.control.hook = async (route, options) => {
    if (options.method === 'PUT' && !concurrent) {
      concurrent = true; const bundle = await unseal(h.remote.envelope, syntheticKey); bundle.ops.push(other);
      h.remote.envelope = await seal(bundle, syntheticKey, syntheticMeta); h.remote.version++;
    }
  };
  await h.c.synchronize(); const remote = await unseal(h.remote.envelope, syntheticKey);
  assert.equal(remote.ops.filter(x => x.id === op.id).length, 1); assert.equal(remote.ops.filter(x => x.id === other.id).length, 1);
  assert.equal(remote.reminderDrafts, undefined); assert.equal(h.c.payload.reminderDrafts.length, 1);
  assert.equal(h.c.payload.dirty, false); assert.equal(h.remote.version, 3);
});

test('background, lock, update and changed session invalidate late version or snapshot responses before writing', async () => {
  const changes = [
    c => { c.document.hidden = true; c.syncEpoch++; }, c => { c.pendingLock = true; c.syncEpoch++; },
    c => { c.updateHolding = true; c.syncEpoch++; }, c => { c.key = null; }, c => { c.meta = { ...c.meta }; },
    c => { c.payload.token = 'new-synthetic-token'; }, c => { c.payload.device = 'new-synthetic-device'; }, c => { c.syncEpoch++; }
  ];
  for (const stage of ['probe', 'snapshot']) for (const change of changes) {
    const h = await appHarness(), gate = latch(); h.control.hook = () => gate.wait();
    const task = stage === 'probe' ? h.c.autoSync() : h.c.synchronize().catch(error => error);
    await gate.started; change(h.c); gate.release(); const result = await task;
    if (stage === 'probe') assert.equal(result, 'deferred'); else assert.equal(result.code, 'sync-paused');
    assert.equal(h.writes.length, 0); assert.equal(h.calls.length, 1); assert.equal(h.c.payload.lastSync, OLD);
    assert.equal(h.c.autoFetching, false); assert.equal(h.c.syncInProgress, false);
  }
});

test('late accepted upload after background cannot clear dirty state; later retry safely confirms once', async () => {
  const h = await appHarness(), op = await h.addVisit(); h.c.syncScheduler.pause(); const gate = latch();
  h.control.hook = (route, options) => options.method === 'PUT' ? gate.wait() : undefined;
  const task = h.c.synchronize().catch(error => error); await gate.started;
  h.c.document.hidden = true; h.c.syncEpoch++; gate.release(); assert.equal((await task).code, 'sync-paused');
  assert.equal(h.remote.version, 2); assert.equal(h.c.payload.dirty, true); assert.equal(h.c.payload.lastSync, OLD);
  h.c.document.hidden = false; h.control.hook = null; await h.c.synchronize();
  assert.equal(h.c.payload.dirty, false); assert.equal(h.remote.version, 2);
  assert.equal(h.c.payload.bundle.ops.filter(x => x.id === op.id).length, 1);
});

test('an active version probe or snapshot blocks duplicate manual/automatic synchronization', async () => {
  for (const automatic of [true, false]) {
    const h = await appHarness(), gate = latch(); h.control.hook = () => gate.wait();
    const task = automatic ? h.c.autoSync() : h.c.synchronize(); await gate.started;
    assert.equal(await h.c.autoSync(), 'deferred'); await assert.rejects(h.c.synchronize(), error => error.code === 'sync-paused');
    assert.equal(h.calls.length, 1); gate.release(); await task; assert.equal(h.calls.length, 1);
  }
});

test('failed local persistence never schedules a saved request or loses the prior payload', async () => {
  const h = await appHarness(), before = h.c.payload, disk = JSON.stringify(h.local.envelope); h.control.failure = 'disk';
  await assert.rejects(h.addVisit(), /disk failure/); assert.equal(h.c.payload, before); assert.equal(JSON.stringify(h.local.envelope), disk);
  assert.equal(h.c.localSaveState, 'failed'); assert.deepEqual(h.savedRequests, []); assert.equal(h.calls.length, 0);
});

test('actual persist captures its session and CAS before encryption and rejects changes before or after disk write', async () => {
  for (const stage of ['seal', 'write']) {
    const h = await appHarness(), before = h.c.payload, gate = latch();
    if (stage === 'seal') h.control.sealHook = () => gate.wait(); else h.control.writeHook = () => gate.wait();
    const task = h.addVisit().catch(error => error); await gate.started; h.c.localRevision = 9; gate.release();
    assert.match((await task).message, /工作階段已變更/); assert.equal(h.c.payload, before); assert.equal(h.c.localRevision, 9);
    assert.equal(h.writes.length, stage === 'seal' ? 0 : 1); assert.deepEqual(h.savedRequests, []);
  }
});

test('real API version callback cannot update Mac program information after epoch or token changes', async () => {
  for (const change of [c => { c.syncEpoch++; }, c => { c.payload.token = 'changed-token'; }, c => { c.key = null; }, c => { c.meta = { ...c.meta }; }]) {
    const h = await appHarness(); let callback;
    h.c.macProgram = null; h.c.requestLocal = async (path, options, onVersion) => { callback = onVersion; return { version: 1 }; };
    h.c.programDetail = () => 'synthetic version'; h.c.renderHealthAudit = () => {};
    vm.runInContext(section('async function api(', 'async function checkConnection('), h.c);
    await h.c.api('/api/version'); change(h.c); callback('synthetic-old-version'); assert.equal(h.c.macProgram, null);
  }
});

test('a new editing context during a snapshot wait aborts before merge, upload or acknowledgement', async () => {
  for (const field of ['inlineTextContext', 'editorContext', 'reminderContext', 'singleStoreContext', 'attendancePrompt']) {
    const h = await appHarness(), gate = latch(), original = JSON.stringify(h.c.payload.bundle);
    h.control.hook = () => gate.wait();
    const task = h.c.synchronize().catch(error => error); await gate.started;
    h.c[field] = { synthetic: true }; gate.release();
    assert.equal((await task).code, 'sync-paused'); assert.equal(h.writes.length, 0);
    assert.equal(h.calls.length, 1); assert.equal(h.c.payload.lastSync, OLD);
    assert.equal(JSON.stringify(h.c.payload.bundle), original);
  }
});

test('snapshot exchange protects contenteditable before new typing and releases the guard after completion', async () => {
  const h = await appHarness(), gate = latch(), notices = [];
  vm.runInContext(section('function beginInlineTextEdit(', 'async function persistInlineTextDraft(') +
    section('function blockInlineTextBeforeInput(', '// Reminder drafts live only'), h.c);
  h.c.toast = value => notices.push(value); h.c.inlineTextBlockReason = () => '';
  let blurred = 0, prevented = 0;
  const element = { dataset: { inlineEditText: 'synthetic-visit' }, textContent: '原文字', blur() { blurred++; }, closest() { return this; } };
  const event = { target: element, preventDefault() { prevented++; } };
  h.control.hook = () => gate.wait(); const task = h.c.synchronize(); await gate.started;
  assert.equal(h.c.beginInlineTextEdit('synthetic-visit', element), false);
  assert.equal(h.c.blockInlineTextBeforeInput(event), true);
  assert.equal(h.c.inlineTextContext, null); assert.equal(element.textContent, '原文字');
  assert.equal(blurred, 2); assert.equal(prevented, 1); assert.equal(notices.length, 2);
  gate.release(); await task;
  assert.equal(h.c.syncInProgress, false); assert.equal(h.c.blockInlineTextBeforeInput(event), false);
  assert.equal(prevented, 1);
});

test('a tap with no text changes releases idle editing for sync, while real input and drafts remain protected', async () => {
  const h = await appHarness(); vm.runInContext(section('function releaseIdleInlineEdit(', 'function beginInlineTextEdit('), h.c);
  h.c.quickTextContext = null;
  for (const blocked of ['changed', 'draft', 'focused', 'comparison']) {
    h.c.inlineTextContext = { before: '原文', after: blocked === 'changed' ? '修改' : '原文' };
    h.c.payload.inlineTextDraft = blocked === 'draft' ? { format: 'inline-text-draft-1' } : null;
    h.c.document.activeElement = blocked === 'focused' ? { closest: () => ({}) } : null;
    h.c.quickTextContext = blocked === 'comparison' ? {} : null;
    assert.equal(h.c.releaseIdleInlineEdit(), false); assert.notEqual(h.c.inlineTextContext, null);
  }
  h.c.quickTextContext = null; h.c.document.activeElement = null; h.c.payload.inlineTextDraft = null;
  h.c.inlineTextContext = { before: '原文', after: '原文' }; const before = JSON.stringify(h.c.payload);
  assert.equal(h.c.releaseIdleInlineEdit(), true); assert.equal(h.c.inlineTextContext, null);
  assert.equal(h.c.canAutoSync(), true); assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.writes.length, 0);
});
