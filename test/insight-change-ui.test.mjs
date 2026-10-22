import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../public/core.js';

// Real monitoring, rendering, guarded persistence and encryption. Fictional
// records, fake clock and in-memory CAS only: no App service or browser profile.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing extraction boundary: ${start}`);
  return app.slice(from, to);
}
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const firstId = 'a'.repeat(64), secondId = 'b'.repeat(64);
const change = (id = firstId) => ({ id, reason: '虛構 <script> 重要變化', originalEvidence: [{ storeId: 's', revisionId: 'old', quote: '虛構原依據 <img src=x>' }], newEvidence: { storeId: 's', revisionId: 'new', quote: '虛構新筆記 <svg onload=x>' } });
const result = (changes = [change()]) => ({ stores: [{ storeId: 's', changes }] });
const seed = (async () => {
  const meta = core.newMeta(), key = await core.derive('fictional-insight-monitor-password', meta), bundle = core.emptyBundle(meta.vaultId);
  bundle.ops.push(core.revision('store', 's', { name: '虛構 <b> 門市', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'fictional'));
  return { meta, key, bundle };
})();

async function harness() {
  const fixture = await seed, nodes = new Map(), timers = new Map(); let serial = 0, c;
  const state = { now: Date.parse('2026-10-22T13:00:00.000Z'), scans: [], writes: [], requests: [], pendingCSV: false, scanResult: result(), scanHook: null, sealHook: null, writeHook: null, failWrite: false, disk: { revision: 7 } };
  const $ = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { id, open: false, textContent: '', innerHTML: '', dataset: {}, classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) }, replaceChildren() { this.innerHTML = ''; this.textContent = ''; }, close() { this.open = false; } });
    }
    return nodes.get(id);
  };
  class TestDate extends Date { static now() { return state.now; } }
  const contexts = Object.fromEntries(['editorContext', 'singleStoreContext', 'inlineTextContext', 'reminderContext', 'dayPlanContext', 'monthlyVisitContext', 'attendancePrompt', 'backupPreview', 'insightsPreview', 'storeMergePreview', 'storeMergeSetup', 'recoveryExportContext', 'weeklyContext'].map(name => [name, null]));
  c = vm.createContext({ ...core, ...contexts, $, Date: TestDate, structuredClone, JSON, Set, Promise,
    key: fixture.key, meta: structuredClone(fixture.meta), payload: { schema: 1, device: 'fictional-device', token: null, bundle: structuredClone(fixture.bundle), dirty: false, serverVersion: 4, pendingSync: { entities: [], unknown: false } },
    localRevision: 7, slot: state.disk, localSaveState: 'saved', syncEpoch: 1, busy: false, pendingLock: false, updateHolding: false, autoFetching: false, syncInProgress: false, gateOpening: false, weeklyRunning: false,
    document: { hidden: false, querySelectorAll: () => [...nodes.values()].filter(node => node.dataset.insightChangeSlot) },
    csvImport: { hasPending: () => state.pendingCSV }, syncScheduler: { request: reason => state.requests.push(reason) }, renderDataSafetyEntry() {},
    esc: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])), dateText: value => value,
    by: (type, id) => core.project(c.payload.bundle).find(record => record.type === type && record.id === id), openDialog: node => { node.open = true; },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: state.now + delay }); return id; }, clearTimeout: id => timers.delete(id),
    scanInsightChanges: async bundle => { state.scans.push(bundle); if (state.scanHook) return state.scanHook(bundle); return structuredClone(state.scanResult); },
    seal: async (...args) => { await state.sealHook?.(); return core.seal(...args); },
    writeLocal: async (envelope, expected, unlockKey) => {
      if (state.failWrite) throw new Error('fictional disk full');
      if (state.disk.revision !== expected) throw new Error('另一個視窗已更新資料');
      state.writes.push({ envelope, expected, unlockKey }); state.disk = { envelope, revision: expected + 1, unlockKey }; await state.writeHook?.(); return expected + 1;
    }
  });
  vm.runInContext(section('async function persist(', 'function pendingSyncSummary(') + section('// Local, read-only monitoring.', 'const INSIGHT_REVIEW_LABELS') + section('function insightChangeBadgeHTML(', 'function storeInsightsHTML('), c);
  const get = expression => vm.runInContext(expression, c);
  const advance = async ms => {
    state.now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= state.now) { timers.delete(id); timer.fn(); }
    await settle();
  };
  $('badge-slot').dataset.insightChangeSlot = 's';
  return { c, $, state, get, advance, timers, fixture };
}

test('foreground scan is read-only, works unpaired/offline and checks unchanged data every 15 minutes', async () => {
  const h = await harness(), before = JSON.stringify(h.c.payload); h.state.scanResult = result([]);
  assert.equal(await h.c.insightReviewTick(), true); assert.equal(h.state.scans.length, 1);
  assert.equal(h.c.insightChangeBadgeHTML('s'), '');
  await h.advance(15 * 60 * 1000 - 1); await h.c.insightReviewTick(); assert.equal(h.state.scans.length, 1);
  await h.advance(1); await h.c.insightReviewTick(); assert.equal(h.state.scans.length, 2);
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0); assert.equal(h.state.requests.length, 0);
});

test('new data scans before the interval and queued renders coalesce instead of creating a busy loop', async () => {
  const h = await harness(); await h.c.insightReviewTick();
  h.c.payload = { ...h.c.payload, bundle: { ...h.c.payload.bundle, ops: [...h.c.payload.bundle.ops, { id: 'fictional-added-op' }] } };
  for (let i = 0; i < 30; i++) h.c.queueInsightScan();
  assert.equal(h.timers.size, 1); await h.advance(1799); assert.equal(h.state.scans.length, 1);
  await h.advance(1); assert.equal(h.state.scans.length, 2); assert.equal(h.timers.size, 0);
  for (let i = 0; i < 30; i++) h.c.queueInsightScan(); await h.advance(1800); assert.equal(h.state.scans.length, 2);
});

test('sync completion schedules a delayed retry so a coincident version poll cannot starve scanning', async () => {
  for (const failSync of [false, true]) {
    const h = await harness(); let finishScan, finishProbe, failProbe;
    h.c.payload.token = 'fictional-token'; h.state.syncFailures = [];
    Object.assign(h.c, {
      canAutoSync: ignoreFetching => !h.c.busy && (ignoreFetching || !h.c.autoFetching),
      syncSession: () => ({ key: h.c.key, meta: h.c.meta, token: h.c.payload.token, epoch: h.c.syncEpoch }),
      assertSyncSession() {}, run: async fn => fn(),
      api: () => new Promise((resolve, reject) => { finishProbe = resolve; failProbe = reject; }),
      recordUnchangedSync: async () => {},
      synchronize: async () => { throw new Error('This scenario must only poll the unchanged version'); },
      recordSyncFailure: error => h.state.syncFailures.push(error.message)
    });
    vm.runInContext(section('async function autoSync()', 'function lockNow('), h.c);
    h.state.scanHook = () => new Promise(resolve => { finishScan = resolve; });
    const scan = h.c.insightReviewTick(), sync = h.c.autoSync();
    assert.equal(h.c.autoFetching, true);
    finishScan(result()); assert.equal(await scan, false, 'A scan overlapping sync is discarded safely');
    assert.equal(h.get('insightScanCache'), null);
    if (failSync) failProbe(new Error('fictional offline probe'));
    else finishProbe({ version: h.c.payload.serverVersion });
    assert.equal(await sync, failSync ? 'failure' : 'success'); assert.equal(h.c.autoFetching, false);
    assert.equal(h.timers.size, 1, 'Sync must wake a retry after releasing autoFetching');
    h.state.scanHook = null; await h.advance(1799); assert.equal(h.state.scans.length, 1);
    await h.advance(1); assert.equal(h.state.scans.length, 2); assert.ok(h.get('insightScanCache'));
    assert.match(h.c.insightChangeBadgeHTML('s'), /有 1 項新變化/); assert.equal(h.state.writes.length, 0);
  }
});

test('hidden, busy, editing, import, sync and restore conditions defer without losing the next safe scan', async () => {
  const blocks = ['busy', 'pendingLock', 'updateHolding', 'autoFetching', 'syncInProgress', 'gateOpening', 'weeklyRunning', 'editorContext', 'singleStoreContext', 'inlineTextContext', 'reminderContext', 'dayPlanContext', 'monthlyVisitContext', 'attendancePrompt', 'backupPreview', 'insightsPreview', 'storeMergePreview', 'storeMergeSetup', 'recoveryExportContext', 'weeklyContext'];
  for (const name of blocks) {
    const h = await harness(); h.c[name] = true;
    assert.equal(await h.c.insightReviewTick(), false, name); assert.equal(h.state.scans.length, 0, name);
    h.c[name] = false; assert.equal(await h.c.insightReviewTick(), true, name);
  }
  for (const block of ['hidden', 'csv', 'dialog']) {
    const h = await harness();
    if (block === 'hidden') h.c.document.hidden = true;
    if (block === 'csv') h.state.pendingCSV = true;
    if (block === 'dialog') h.$('review').open = true;
    assert.equal(await h.c.insightReviewTick(), false, block); assert.equal(h.state.scans.length, 0);
    h.c.document.hidden = false; h.state.pendingCSV = false; h.$('review').open = false;
    assert.equal(await h.c.insightReviewTick(), true);
  }
});

test('stale async results cannot repaint after lock, visibility, epoch, vault or bundle changes', async () => {
  for (const mutate of [h => h.c.resetInsightScan(), h => { h.c.key = null; }, h => { h.c.document.hidden = true; }, h => { h.c.pendingLock = true; }, h => { h.c.syncEpoch++; }, h => { h.c.meta = { ...h.c.meta }; }, h => { h.c.payload = { ...h.c.payload, bundle: structuredClone(h.c.payload.bundle) }; }]) {
    const h = await harness(); let release;
    h.state.scanHook = () => new Promise(resolve => { release = resolve; });
    const running = h.c.insightReviewTick(); await settle(); mutate(h); release(result());
    assert.equal(await running, false); assert.equal(h.get('insightScanCache'), null); assert.equal(h.$('badge-slot').innerHTML, '');
  }
});

test('lock reset cancels pending scans and an old completion cannot clear a newer in-flight scan', async () => {
  const h = await harness(), resolvers = [];
  h.c.queueInsightScan(); assert.equal(h.timers.size, 1); h.c.resetInsightScan(); assert.equal(h.timers.size, 0);
  h.state.scanHook = () => new Promise(resolve => resolvers.push(resolve));
  const first = h.c.insightReviewTick(); h.c.resetInsightScan(); const second = h.c.insightReviewTick();
  resolvers[0](result()); assert.equal(await first, false); assert.equal(h.get('insightScanRunning'), true);
  resolvers[1](result()); assert.equal(await second, true); assert.equal(h.get('insightScanRunning'), false);
});

test('failure is retryable and never changes confirmation, customer data or local revision', async () => {
  const h = await harness(), before = JSON.stringify(h.c.payload); h.state.scanHook = () => { throw new Error('fictional scan failure'); };
  assert.equal(await h.c.insightReviewTick(), false); assert.match(h.$('insight-scan-status').textContent, /未完成.*原確認保留/);
  assert.equal(h.get('insightScanRunning'), false); assert.equal(h.state.writes.length, 0); assert.equal(h.c.localRevision, 7); assert.equal(JSON.stringify(h.c.payload), before);
  h.state.scanHook = null; assert.equal(await h.c.insightReviewTick(), true); assert.equal(h.get('insightScanError'), '');
});

test('late scan failure cannot repaint status after foreground, epoch, bundle or metadata changed', async () => {
  for (const mutate of [h => { h.c.document.hidden = true; }, h => { h.c.syncEpoch++; }, h => { h.c.meta = { ...h.c.meta }; }, h => { h.c.payload = { ...h.c.payload, bundle: structuredClone(h.c.payload.bundle) }; }]) {
    const h = await harness(); let fail;
    h.state.scanHook = () => new Promise((_, reject) => { fail = reject; });
    const scan = h.c.insightReviewTick(); mutate(h); fail(new Error('late fictional failure'));
    assert.equal(await scan, false); assert.equal(h.get('insightScanError'), ''); assert.equal(h.$('insight-scan-status').textContent, '');
  }
});

test('reset clears customer names, evidence and errors from the monitoring dialog', async () => {
  const h = await harness(); await h.c.openInsightChanges('s'); h.$('insight-changes-error').textContent = 'fictional private error';
  assert.match(h.$('insight-changes-title').textContent, /虛構/);
  h.c.resetInsightScan();
  assert.equal(h.$('insight-changes-title').textContent, '線索新變化'); assert.equal(h.$('insight-changes-body').innerHTML, '');
  assert.equal(h.$('insight-changes-error').textContent, ''); assert.equal(h.get('insightChangesContext'), null);
});

test('compact badge and detailed new/old evidence escape content without changing the original confirmation', async () => {
  const h = await harness(), before = JSON.stringify(h.c.payload); await h.c.openInsightChanges('s');
  assert.match(h.c.insightChangeBadgeHTML('s'), /有 1 項新變化/);
  const html = h.$('insight-changes-body').innerHTML;
  assert.match(html, /原來的依據/); assert.match(html, /新筆記/); assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;img/); assert.match(html, /&lt;svg/); assert.doesNotMatch(html, /<script|<img|<svg/);
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0);
});

test('read acknowledgement uses encrypted CAS, preserves bundle/dirty/pairing and suppresses only the exact event', async () => {
  for (const dirty of [false, true]) {
    const h = await harness(); h.c.payload.dirty = dirty; h.c.payload.token = 'fictional-pair-token';
    const originalBundle = h.c.payload.bundle, originalMeta = h.c.meta, originalKey = h.c.key;
    await h.c.openInsightChanges('s'); await h.c.readInsightChange(firstId);
    assert.equal(h.state.writes.length, 1); assert.equal(h.state.writes[0].expected, 7); assert.equal(h.c.localRevision, 8);
    assert.equal(h.c.payload.bundle, originalBundle); assert.equal(h.c.payload.dirty, dirty); assert.equal(h.c.payload.token, 'fictional-pair-token'); assert.equal(h.c.key, originalKey); assert.equal(h.c.meta, originalMeta); assert.equal(h.state.requests.length, 0);
    const saved = await core.unseal(h.state.disk.envelope, originalKey, 'device');
    assert.deepEqual(saved.bundle, originalBundle); assert.deepEqual(saved.insightChangeRead.ids, [firstId]); assert.equal(h.c.insightChangeBadgeHTML('s'), '');
    // Simulate reopening from the encrypted device payload; no derived state is exported to bundle.
    h.c.payload = saved; h.c.resetInsightScan(); await h.c.insightReviewTick(); assert.equal(h.c.insightChangeBadgeHTML('s'), '');
    h.state.scanResult = result([change(), change(secondId)]); await h.c.insightReviewTick({ force: true }); assert.match(h.c.insightChangeBadgeHTML('s'), /有 1 項新變化/);
  }
});

test('read state from another vault or malformed IDs cannot suppress a current event', async () => {
  const h = await harness(); h.c.payload.insightChangeRead = { vaultId: 'foreign-vault', ids: [firstId] }; await h.c.insightReviewTick();
  assert.match(h.c.insightChangeBadgeHTML('s'), /有 1 項新變化/);
  h.c.payload.insightChangeRead = { vaultId: h.c.payload.bundle.vaultId, ids: ['bad-id', 5] };
  assert.equal(h.c.insightReadIds().size, 0);
});

test('stale read guards reject changed data or session before writing', async () => {
  for (const mutate of [h => { h.c.payload = { ...h.c.payload }; }, h => { h.c.localRevision++; }, h => { h.c.syncEpoch++; }, h => { h.c.key = null; }, h => { h.c.pendingLock = true; }, h => { h.$('insight-changes-dialog').open = false; }]) {
    const h = await harness(); await h.c.openInsightChanges('s'); mutate(h);
    await assert.rejects(h.c.readInsightChange(firstId), /資料或畫面已改變/); assert.equal(h.state.writes.length, 0); assert.equal(h.c.payload.insightChangeRead, undefined);
  }
});

test('guard repeats after encryption, and failed CAS/storage never fake an acknowledgement', async () => {
  for (const kind of ['close-during-seal', 'cas', 'disk']) {
    const h = await harness(); await h.c.openInsightChanges('s'); const before = JSON.stringify(h.c.payload);
    if (kind === 'close-during-seal') h.state.sealHook = () => { h.$('insight-changes-dialog').open = false; };
    if (kind === 'cas') h.state.disk.revision = 8;
    if (kind === 'disk') h.state.failWrite = true;
    await assert.rejects(h.c.readInsightChange(firstId), /資料或畫面已改變|另一個視窗|disk full/);
    assert.equal(h.state.writes.length, 0); assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.c.localRevision, 7); assert.match(h.c.insightChangeBadgeHTML('s'), /有 1 項新變化/);
  }
});

test('closing, hiding or locking during a completed disk write never repopulates private content', async () => {
  for (const kind of ['closed', 'hidden', 'pending-lock', 'epoch']) {
    const h = await harness(); await h.c.openInsightChanges('s'); const ctx = h.get('insightChangesContext');
    h.state.writeHook = () => {
      h.$('insight-changes-body').replaceChildren();
      if (kind === 'closed') { h.$('insight-changes-dialog').open = false; vm.runInContext('insightChangesContext = null', h.c); }
      if (kind === 'hidden') h.c.document.hidden = true;
      if (kind === 'pending-lock') h.c.pendingLock = true;
      if (kind === 'epoch') h.c.syncEpoch++;
    };
    await h.c.readInsightChange(firstId);
    assert.equal(h.state.writes.length, 1); assert.equal(h.$('insight-changes-body').innerHTML, '', kind);
    assert.equal(h.get('insightChangesContext'), kind === 'closed' ? null : ctx, kind);
  }
});

test('key loss after disk commit does not claim completion in the lost session', async () => {
  const h = await harness(); await h.c.openInsightChanges('s'); const key = h.c.key, before = JSON.stringify(h.c.payload);
  h.state.writeHook = () => { h.c.key = null; h.$('insight-changes-body').replaceChildren(); };
  await assert.rejects(h.c.readInsightChange(firstId), /本機寫入已完成.*工作階段已變更/);
  assert.equal(h.state.writes.length, 1); assert.equal(h.$('insight-changes-body').innerHTML, ''); assert.equal(JSON.stringify(h.c.payload), before);
  const saved = await core.unseal(h.state.disk.envelope, key, 'device'); assert.deepEqual(saved.insightChangeRead.ids, [firstId]);
});
