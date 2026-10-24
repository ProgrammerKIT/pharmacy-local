import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../public/core.js';

// Real visibility handlers, scan gates and semantic scanner with invented data.
// No App service, browser profile, database or network is used by these tests.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing extraction boundary: ${start}`);
  return app.slice(from, to);
}
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const controls = ['editorContext', 'singleStoreContext', 'inlineTextContext', 'reminderContext', 'dayPlanContext', 'monthlyVisitContext', 'attendancePrompt', 'backupPreview', 'insightsPreview', 'storeMergePreview', 'storeMergeSetup', 'recoveryExportContext', 'weeklyContext'];
function fictionalBundle() {
  const bundle = core.emptyBundle('fictional-background-vault');
  const add = (type, id, data, at, parents = []) => {
    const op = core.revision(type, id, data, parents, 'fictional-device'); op.at = at; bundle.ops.push(op); return op;
  };
  const originalStore = add('store', 's', { name: '虛構青禾店', city: '', district: '', channel: '', attr: '', contact: '', address: '虛構地址', mapUrl: '' }, '2026-10-19T02:00:00.000Z');
  const original = add('visit', 'old-note', { store: 's', text: '小安目前在虛構青禾店工作。', date: '2026-10-19', people: [], next: '', source: '虛構測試', topics: [], attachments: [] }, '2026-10-19T02:00:00.000Z');
  const store = core.project(bundle).find(item => item.type === 'store' && item.id === 's');
  const entry = { id: 'fictional-card', kind: 'relationship', level: 'source', headline: original.data.text, question: '虛構問題', caution: '', limitations: [], evidence: [{ storeId: 's', storeIdentityKey: core.storeInsightsIdentityKey(store), visitId: 'old-note', revisionId: original.id, quote: original.data.text, role: 'support' }] };
  add('store', 's', { ...originalStore.data,
    preVisitInsights: { format: 'pharmacy-store-insights-1', batchId: 'fictional-batch', generatedAt: '2026-10-19T02:00:00.000Z', sourceAsOf: '2026-10-19', entries: [entry] },
    preVisitInsightReviews: [{ id: 'fictional-review', status: 'confirmed', reviewedBy: 'Kit', reviewedAt: '2026-10-20T02:00:00.000Z', sourceAsOf: '2026-10-19', entry: structuredClone(entry) }]
  }, '2026-10-20T02:00:00.000Z', [originalStore.id]);
  return core.validateBundle(bundle);
}
function addFictionalChange(bundle, text) {
  const op = core.revision('visit', 'new-note', { store: 's', text, date: '2026-10-22', people: [], next: '', source: '虛構測試', topics: [], attachments: [] }, [], 'fictional-device');
  op.at = '2026-10-22T02:00:00.000Z'; bundle.ops.push(op); return bundle;
}
function harness({ platform = 'MacIntel', userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints = 0, bundle = fictionalBundle() } = {}) {
  const nodes = new Map(), timers = new Map(), docListeners = new Map(), winListeners = new Map(), events = [];
  const state = { now: Date.parse('2026-10-24T00:00:00.000Z'), scans: 0, locks: 0, writes: 0, requests: [], scanHook: null, pendingCSV: false, operations: [] }; let serial = 0, c;
  const $ = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { id, open: false, textContent: '', innerHTML: '', dataset: {}, classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) }, replaceChildren() { this.innerHTML = ''; this.textContent = ''; }, close() { this.open = false; } });
    }
    return nodes.get(id);
  };
  class TestDate extends Date { static now() { return state.now; } }
  const doc = { hidden: false, body: $('body'),
    querySelector: selector => selector === 'dialog[open]' ? [...nodes.values()].find(node => node.open) || null : null,
    querySelectorAll: selector => [...nodes.values()].filter(node => selector === 'dialog[open]' ? node.open : node.dataset.insightChangeSlot),
    addEventListener: (event, fn) => docListeners.set(event, fn) };
  c = vm.createContext({ ...core, ...Object.fromEntries(controls.map(name => [name, null])), $, Date: TestDate, structuredClone, JSON, Set, Promise,
    navigator: { platform, userAgent, maxTouchPoints, onLine: true }, document: doc, window: { addEventListener: (event, fn) => winListeners.set(event, fn) },
    key: { fictional: 'key' }, meta: { vaultId: bundle.vaultId }, payload: { bundle, token: 'fictional-pairing-token', device: 'fictional-device', dirty: false, serverVersion: 115 },
    localRevision: 7, localSaveState: 'saved', syncEpoch: 1, busy: false, pendingLock: false, updateHolding: false, autoFetching: false, syncInProgress: false, gateOpening: false, weeklyRunning: false,
    csvImport: { hasPending: () => state.pendingCSV }, syncScheduler: { pause: () => events.push('pause'), request: reason => state.requests.push(reason) },
    dateText: value => value, renderDataSafetyEntry() {},
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: state.now + delay }); return id; }, clearTimeout: id => timers.delete(id),
    scanInsightChanges: async current => { state.scans++; return state.scanHook ? state.scanHook(current) : core.scanInsightChanges(current); },
    dismissKeyboard: () => events.push('dismiss-keyboard'), finishAttendancePrompt: () => events.push('finish-attendance'), clearNearbyPosition: () => events.push('clear-position'), requestNearbyPosition: () => events.push('request-position'),
    activeReminderDraftContext: () => c.reminderContext || c.dayPlanContext || c.monthlyVisitContext,
    flushVisitDraft: async () => events.push('flush-visit'), flushInlineTextDraft: async () => events.push('flush-inline'), flushReminderDraft: async () => events.push('flush-reminder'),
    resumeDayPlanContext: () => events.push('resume-day'), resumeMonthlyVisitContext: () => events.push('resume-month'), showGate: () => events.push('show-gate'),
    lockNow: () => { state.locks++; c.resetInsightScan(); c.key = null; c.payload = null; },
    api: async () => { state.operations.push('api'); throw new Error('No API call is permitted'); }, persist: async () => { state.writes++; throw new Error('No persistence is permitted'); }
  });
  vm.runInContext(section('// Local, read-only monitoring.', 'const INSIGHT_REVIEW_LABELS') + section('function insightChangeBadgeHTML(', 'function storeInsightsHTML(') + section('function canAutoSync(', 'function lockNow(') + section('function handleAppVisibilityChange(', "$('visit-attendance-form').addEventListener('submit'"), c);
  const get = expression => vm.runInContext(expression, c);
  const visibility = hidden => { doc.hidden = hidden; docListeners.get('visibilitychange')(); };
  const advance = async ms => {
    state.now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= state.now) { timers.delete(id); timer.fn(); }
    await settle();
  };
  $('badge-slot').dataset.insightChangeSlot = 's';
  return { c, $, state, events, get, visibility, advance, timers, winListeners };
}

test('switching an idle Mac tab retains only its bound session, veils it and leaves sync paused', async () => {
  const h = harness(), original = h.c.payload, key = h.c.key;
  h.visibility(true);
  assert.equal(h.state.locks, 0); assert.equal(h.c.key, key); assert.equal(h.c.payload, original);
  assert.equal(h.get('insightBackgroundActive').epoch, h.c.syncEpoch); assert.equal(h.get('insightBackgroundActive').payload, original);
  assert.ok(h.$('body').classList.contains('privacy-veil')); assert.ok(h.events.includes('pause'));
  assert.equal(h.c.canAutoSync(), false); assert.equal(await h.c.autoSync(), 'deferred'); assert.deepEqual(h.state.operations, []);
  assert.deepEqual(h.state.requests, []); assert.equal(h.timers.size, 1);
  assert.equal(await h.c.insightReviewTick(), true); assert.equal(h.state.scans, 1); assert.equal(h.state.writes, 0);
});

test('real background semantic scan stays silent for unchanged/supporting notes and preserves exact old/new evidence only for a substantial change', async () => {
  for (const [text, expected] of [[null, 0], ['小安今天介紹新產品。', 0], ['小安目前仍在虛構青禾店工作。', 0], ['小安可能已離職。', 0], ['小安已離職。', 1]]) {
    const bundle = fictionalBundle(); if (text) addFictionalChange(bundle, text);
    const h = harness({ bundle }), before = JSON.stringify(h.c.payload); h.visibility(true);
    assert.equal(await h.c.insightReviewTick(), true);
    const changes = h.get('insightScanCache').result.stores.flatMap(store => store.changes);
    assert.equal(changes.length, expected, text);
    if (expected) { assert.equal(changes[0].originalEvidence[0].quote, '小安目前在虛構青禾店工作。'); assert.equal(changes[0].newEvidence.quote, text); }
    assert.equal(h.$('badge-slot').innerHTML, ''); assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes, 0); assert.deepEqual(h.state.operations, []);
    await h.advance(15 * 60 * 1000); await h.c.insightReviewTick();
    assert.equal(h.get('insightScanCache').result.stores.flatMap(store => store.changes).length, expected);
    assert.equal(JSON.stringify(h.c.payload), before);
  }
});

test('iPhone and desktop-mode iPad visibility changes preserve the original locking path', () => {
  for (const device of [
    { platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 },
    { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints: 5 }
  ]) {
    const h = harness(device); h.visibility(true);
    assert.equal(h.state.locks, 1); assert.equal(h.get('insightBackgroundActive'), null); assert.equal(h.c.key, null); assert.equal(h.timers.size, 0);
  }
});

test('unsafe Mac editors, modal review, drafts, pending writes, import, sync, backup or lock never receive background capability', () => {
  const cases = controls.map(name => [name, h => { h.c[name] = { type: 'visit' }; }]);
  for (const name of ['busy', 'pendingLock', 'updateHolding', 'autoFetching', 'syncInProgress', 'gateOpening', 'weeklyRunning']) cases.push([name, h => { h.c[name] = true; }]);
  cases.push(['saving', h => { h.c.localSaveState = 'saving'; }], ['csv', h => { h.state.pendingCSV = true; }],
    ['visit draft', h => { h.c.payload.draft = {}; }], ['inline draft', h => { h.c.payload.inlineTextDraft = {}; }],
    ['arbitrary modal', h => { h.$('unlisted-modal').open = true; }], ['visit brief', h => { h.$('review').open = true; h.$('review').classList.add('visit-brief-dialog'); }]);
  for (const [name, block] of cases) {
    const h = harness(); block(h); h.visibility(true);
    assert.equal(h.state.locks, 1, name); assert.equal(h.get('insightBackgroundActive'), null, name); assert.equal(h.timers.size, 0, name);
  }
});

test('background capability is revoked when payload, key, metadata or epoch changes', async () => {
  for (const mutate of [h => { h.c.key = {}; }, h => { h.c.meta = { ...h.c.meta }; }, h => { h.c.payload = { ...h.c.payload }; }, h => { h.c.payload.bundle = structuredClone(h.c.payload.bundle); }, h => { h.c.syncEpoch++; }]) {
    const h = harness(); h.visibility(true); mutate(h);
    assert.equal(await h.c.insightReviewTick(), false); assert.equal(h.state.scans, 0);
  }
});

test('returning after browser throttling queues the overdue scan and restores only normal foreground sync', async () => {
  const h = harness(); await h.c.insightReviewTick(); h.visibility(true);
  h.state.now += 45 * 60 * 1000; // Browser suspension: no timer callback is run while hidden.
  h.visibility(false);
  assert.equal(h.get('insightBackgroundActive'), null); assert.equal(h.$('body').classList.contains('privacy-veil'), false); assert.deepEqual(h.state.requests, ['foreground']);
  assert.equal(h.state.scans, 1); await h.advance(1800);
  // WebCrypto uses an actual asynchronous digest; await the outstanding real scan.
  if (h.get('insightScanRunning')) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.scans, 2); assert.equal(h.state.locks, 0); assert.equal(h.state.writes, 0);
});

test('a scan started before visibility transition is discarded and the queued background retry remains available', async () => {
  const h = harness(); let complete;
  h.state.scanHook = () => new Promise(resolve => { complete = resolve; });
  const scan = h.c.insightReviewTick(); h.visibility(true); complete({ stores: [] });
  assert.equal(await scan, false); assert.equal(h.get('insightScanCache'), null);
  h.state.scanHook = null; await h.advance(1800);
  if (h.get('insightScanRunning')) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.scans, 2); assert.equal(h.state.writes, 0); assert.equal(h.$('badge-slot').innerHTML, '');
});

test('pagehide revokes retained Mac capability, clears pending scans and rejects an old completion', async () => {
  const h = harness(); h.visibility(true); let complete;
  h.state.scanHook = () => new Promise(resolve => { complete = resolve; });
  const scan = h.c.insightReviewTick(); h.winListeners.get('pagehide')(); complete({ stores: [] });
  assert.equal(await scan, false); assert.equal(h.state.locks, 1); assert.equal(h.get('insightBackgroundActive'), null); assert.equal(h.get('insightScanCache'), null); assert.equal(h.timers.size, 0);
  assert.equal(h.c.payload, null); assert.equal(h.c.key, null); assert.equal(h.state.writes, 0);
});
