import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../public/core.js';

// Actual App save boundary, encryption and CAS; fictional in-memory data only.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return app.slice(from, to);
}
const seed = (async () => {
  const meta = core.newMeta(), key = await core.derive('fictional-csv-save-password', meta), bundle = core.emptyBundle(meta.vaultId);
  bundle.ops.push(core.revision('store', 'fictional-store', { name: '虛構CSV保護店', address: '', city: '', district: '', channel: '', contact: '', attr: '' }, [], 'fictional'));
  return { meta, key, bundle };
})();
async function harness() {
  const fixture = await seed;
  const state = { writes: [], renders: 0, requests: [], sealHook: null, writeHook: null, diskRevision: 7, failWrite: false };
  const payload = { schema: 1, device: 'fictional-device', token: 'fictional-pair-token', bundle: structuredClone(fixture.bundle), dirty: false, serverVersion: 3, lastSync: '2026-10-25T00:00:00Z', reminderDrafts: [] };
  const c = vm.createContext({ ...core, payload, key: fixture.key, meta: structuredClone(fixture.meta), localRevision: 7, syncEpoch: 4, slot: null, localSaveState: 'saved',
    document: { hidden: false }, pendingLock: false, updateHolding: false, autoFetching: false, syncInProgress: false, gateOpening: false, busy: true,
    $: () => ({ textContent: '' }), renderDataSafetyEntry() {}, render: () => state.renders++, syncScheduler: { request: reason => state.requests.push(reason) },
    seal: async (...args) => { await state.sealHook?.(); return core.seal(...args); },
    writeLocal: async (envelope, expected, unlockKey) => {
      if (state.failWrite || expected !== state.diskRevision) throw new Error('fictional CAS/storage failure');
      state.writes.push({ envelope, expected, unlockKey }); state.diskRevision++; await state.writeHook?.(); return state.diskRevision;
    }
  });
  vm.runInContext(section('// Bind CSV confirmation', 'const all =') + section('async function persist(', 'function pendingSyncSummary('), c);
  const next = structuredClone(payload.bundle), old = core.project(next)[0];
  next.ops.push(core.revision('store', old.id, { ...old.heads[0].data, contact: '虛構已選補值' }, old.heads.map(head => head.id), 'fictional'));
  return { c, state, next, fixture };
}

test('CSV callback is wired to a pre-confirmation session context and preserves pairing during encrypted save', async () => {
  assert.match(app, /getSaveContext: captureCSVSaveContext, run, saveBundle: saveCSVBundle/);
  const h = await harness(), before = h.c.payload, ctx = h.c.captureCSVSaveContext();
  await h.c.saveCSVBundle(h.next, ctx);
  assert.equal(h.state.writes.length, 1); assert.equal(h.state.renders, 1);
  const saved = await core.unseal(h.state.writes[0].envelope, h.fixture.key, 'device');
  assert.deepEqual(saved.bundle, h.next); assert.equal(saved.token, before.token); assert.equal(saved.device, before.device);
  assert.equal(saved.serverVersion, before.serverVersion); assert.equal(saved.lastSync, before.lastSync);
  assert.equal(saved.dirty, true); assert.deepEqual(h.state.requests, ['saved']); assert.equal(h.c.localRevision, 8);
});

test('CSV save rejects foreground, identity and preview-session changes before any write', async () => {
  const changes = [
    h => { h.c.document.hidden = true; }, h => { h.c.pendingLock = true; }, h => { h.c.updateHolding = true; },
    h => { h.c.autoFetching = true; }, h => { h.c.syncInProgress = true; }, h => { h.c.gateOpening = true; },
    h => { h.c.syncEpoch++; }, h => { h.c.localRevision++; }, h => { h.c.payload = { ...h.c.payload }; },
    h => { h.c.payload.bundle = structuredClone(h.c.payload.bundle); }, h => { h.c.meta = { ...h.c.meta }; },
    h => { h.c.key = null; }, h => { h.c.payload.token = 'changed-fictional-token'; }, h => { h.c.payload.device = 'changed-fictional-device'; }
  ];
  for (const change of changes) {
    const h = await harness(), ctx = h.c.captureCSVSaveContext(); change(h);
    await assert.rejects(h.c.saveCSVBundle(h.next, ctx), /尚未寫入/);
    assert.equal(h.state.writes.length, 0); assert.equal(h.state.renders, 0);
  }
  const h = await harness(); await assert.rejects(h.c.saveCSVBundle(h.next), /尚未寫入/);
  h.c.document.hidden = true; assert.throws(() => h.c.captureCSVSaveContext(), /尚未寫入/);
});

test('CSV guard repeats after encryption and rejects a background round trip even with unchanged payload', async () => {
  for (const change of [
    h => { h.c.document.hidden = true; }, h => { h.c.pendingLock = true; },
    h => { h.c.syncEpoch += 2; }, h => { h.c.updateHolding = true; },
    h => { h.c.payload.token = 'changed-during-seal'; }
  ]) {
    const h = await harness(), ctx = h.c.captureCSVSaveContext(), before = JSON.stringify(h.c.payload.bundle);
    h.state.sealHook = () => change(h);
    await assert.rejects(h.c.saveCSVBundle(h.next, ctx), /尚未寫入/);
    assert.equal(h.state.writes.length, 0); assert.equal(JSON.stringify(h.c.payload.bundle), before);
    assert.equal(h.state.renders, 0); assert.deepEqual(h.state.requests, []);
  }
});

test('CSV CAS/storage failure preserves the old payload and never reports completion', async () => {
  for (const failStorage of [false, true]) {
    const h = await harness(), ctx = h.c.captureCSVSaveContext(), before = h.c.payload;
    if (failStorage) h.state.failWrite = true; else h.state.diskRevision++;
    await assert.rejects(h.c.saveCSVBundle(h.next, ctx), /CAS\/storage/);
    assert.equal(h.c.payload, before); assert.equal(h.c.localRevision, 7);
    assert.equal(h.state.writes.length, 0); assert.equal(h.state.renders, 0); assert.deepEqual(h.state.requests, []);
  }
});

test('CSV late visibility loss after disk commit reports completed storage for recheck without rendering stale success', async () => {
  const h = await harness(), ctx = h.c.captureCSVSaveContext();
  h.state.writeHook = () => { h.c.document.hidden = true; h.c.syncEpoch++; };
  await assert.rejects(h.c.saveCSVBundle(h.next, ctx), /本機保存已完成.*重新開啟核對/);
  assert.equal(h.state.writes.length, 1); assert.equal(h.c.payload.bundle, h.next); assert.equal(h.state.renders, 0);
});
