import { APP_VERSION } from '../public/version.js';
import { diagnoseConnection } from '../public/update-client.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { newMeta, derive, seal, unseal, emptyBundle, revision, merge, validateBundle, project } from '../public/core.js';

// Run the actual application functions, with a local in-memory transport and real encryption.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const functions = app.slice(app.indexOf('function programDetail()'), app.indexOf('async function api(')) +
  app.slice(app.indexOf('function withPendingSync('), app.indexOf('function draftState(')) +
  app.slice(app.indexOf('async function checkConnection()'), app.indexOf('async function persist(')) +
  app.slice(app.indexOf('async function autoSync()'), app.indexOf('function lockNow(')) +
  app.slice(app.indexOf('async function recordUnchangedSync()'), app.indexOf('function switchView('));
const OLD = '2026-09-12T03:55:35.000Z', NOW = '2026-09-13T15:10:20.000Z';
async function fixture() {
  const meta = newMeta(), key = await derive('fictional-test-password', meta), bundle = emptyBundle(meta.vaultId);
  bundle.ops.push(revision('store', 'fictional-store', { name: '測試門市', city: '', district: '', channel: '獨立', attr: '', contact: '' }, [], 'mac'));
  const remote = { version: 1, envelope: await seal(bundle, key, meta) };
  return { meta, key, bundle, remote };
}
async function client(f, device = 'phone') {
  const elements = new Map(), calls = [], local = { envelope: null };
  const $ = id => { if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, open: false, dataset: {} }); return elements.get(id); };
  const c = vm.createContext({
    ...f, payload: { schema: 1, device, deviceName: device, token: `fictional-${device}`, bundle: structuredClone(f.bundle), dirty: false, serverVersion: 1, lastSync: OLD },
    records: [], lastError: '', lastSyncFailure: null, syncWarning: '', macProgram: null, APP_VERSION, diagnoseConnection, clock: NOW, failure: null, updateHolding: false, autoFetching: false, busy: false, editorContext: null,
    document: { hidden: false }, csvImport: { hasPending: () => false }, location: { hostname: 'fictional.local' },
    offlineReady: true, storagePersistent: true, TextEncoder, seal, unseal, validateBundle, merge, $, dateText: value => value || '尚未同步',
  });
  c.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [c.clock])); } };
  c.persist = async next => {
    if (c.failure === 'disk') throw new Error('本機儲存失敗');
    next = c.withPendingSync(c.payload, next);
    const encrypted = await seal(next, f.key, f.meta, 'device');
    local.envelope = encrypted; c.payload = next;
  };
  vm.runInContext(functions, c);
  await c.persist(c.payload);
  c.render = () => { c.records = project(c.payload.bundle); c.status(); };
  c.run = async fn => { if (c.busy || c.updateHolding) return; c.busy = true; try { await fn(); } finally { c.busy = false; } };
  c.api = async (route, options = {}) => {
    calls.push([route, options.method || 'GET']);
    if (c.failure === 'network' || (c.failure === 'put' && options.method === 'PUT')) throw new Error('連線失敗');
    if (route === '/api/version') return { version: f.remote.version };
    if (route === '/api/snapshot' && options.method !== 'PUT') return structuredClone(f.remote);
    if (route === '/api/snapshot' && options.method === 'PUT') {
      assert.equal(options.body.expectedVersion, f.remote.version);
      f.remote.version++; f.remote.envelope = options.body.envelope;
      return { version: f.remote.version, backupOK: c.failure !== 'backup' };
    }
    throw new Error('unexpected route');
  };
  c.manual = async () => { try { await c.synchronize(); } catch (e) { c.recordSyncFailure(e); throw e; } };
  return { c, calls, local, $ };
}

test('unchanged manual sync refreshes and persists successful time without a server write or customer revision', async () => {
  const f = await fixture(), { c, calls, local, $ } = await client(f), original = JSON.stringify(f.bundle);
  await c.manual();
  assert.equal(c.payload.lastSync, NOW);
  assert.equal((await unseal(local.envelope, f.key, 'device')).lastSync, NOW);
  assert.equal(JSON.stringify(c.payload.bundle), original); assert.equal(f.remote.version, 1);
  assert.deepEqual(calls, [['/api/snapshot', 'GET']]);
  assert.match($('sync-state').textContent, /最近成功同步：2026-09-13/);
  assert.match($('sync-result').textContent, /沒有新變更/);
  c.clock = '2026-09-13T15:11:00.000Z'; await c.manual(); assert.equal(c.payload.lastSync, c.clock);
});

test('unchanged automatic sync refreshes time after the authenticated version response, without downloading or uploading a snapshot', async () => {
  const f = await fixture(), { c, calls } = await client(f);
  await c.autoSync(); assert.equal(c.payload.lastSync, NOW);
  assert.deepEqual(calls, [['/api/version', 'GET']]); assert.equal(f.remote.version, 1);
});

test('network and local persistence failures retain the last successful time for both manual and automatic sync', async () => {
  for (const failure of ['network', 'disk']) for (const automatic of [false, true]) {
    const f = await fixture(), { c, local, $ } = await client(f), before = JSON.stringify(local.envelope);
    c.failure = failure;
    if (automatic) await c.autoSync(); else await assert.rejects(c.manual());
    assert.equal(c.payload.lastSync, OLD); assert.equal(JSON.stringify(local.envelope), before);
    assert.match($('sync-state').textContent, /同步未完成/); assert.ok($('sync-state').textContent.includes(OLD));
    assert.ok(!$('sync-state').textContent.includes(NOW));
  }
});

test('failed upload never advances time and preserves local edits for a retry', async () => {
  const f = await fixture(), { c } = await client(f);
  c.payload.bundle.ops.push(revision('store', 'other-store', { name: '待同步測試', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'phone'));
  c.payload.dirty = true; c.failure = 'put';
  await assert.rejects(c.manual()); assert.equal(c.payload.lastSync, OLD); assert.equal(c.payload.dirty, true);
  assert.equal(c.payload.bundle.ops.length, 2); assert.equal(f.remote.version, 1);
});

test('pending sync count deduplicates repeated edits by entity and clears only after Mac acknowledgement', async () => {
  const f = await fixture(), { c, $ } = await client(f);
  const first = revision('visit', 'same-visit', { store: 'fictional-store', date: '2026-09-13', text: '第一版', next: '', source: '測試', topics: [], people: [], attachments: [] }, [], 'phone');
  let bundle = structuredClone(c.payload.bundle); bundle.ops.push(first);
  await c.persist({ ...c.payload, bundle, dirty: true }); c.records = project(c.payload.bundle); c.status();
  bundle = structuredClone(c.payload.bundle); bundle.ops.push(revision('visit', 'same-visit', { ...first.data, text: '第二版' }, [first.id], 'phone'));
  bundle.ops.push(revision('store', 'second-store', { name: '第二間測試門市', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'phone'));
  await c.persist({ ...c.payload, bundle, dirty: true }); c.records = project(c.payload.bundle); c.status();
  assert.equal(c.pendingSyncSummary().count, 2); assert.match($('pending-sync-detail').textContent, /2 項/); assert.match($('pending-sync-detail').textContent, /1 筆拜訪/); assert.match($('pending-sync-detail').textContent, /1 間門市/);
  c.failure = 'put'; await assert.rejects(c.manual()); assert.equal(c.pendingSyncSummary().count, 2); assert.equal(c.payload.dirty, true);
  c.failure = null; await c.manual(); assert.equal(c.pendingSyncSummary().count, 0); assert.equal(c.payload.dirty, false); assert.equal($('pending-sync-detail').textContent, '0 筆');
});

test('legacy dirty state stays honest until one successful sync establishes a counting baseline', async () => {
  const f = await fixture(), { c, $ } = await client(f);
  delete c.payload.pendingSync; c.payload.dirty = true; c.records = project(c.payload.bundle); c.status();
  assert.equal(c.pendingSyncSummary().unknown, true); assert.match($('pending-sync-detail').textContent, /完成一次同步後/);
  await c.manual(); assert.equal(c.pendingSyncSummary().unknown, false); assert.equal(c.pendingSyncSummary().count, 0);
});

test('phone and Mac each record their own completion time while real encrypted customer changes converge in both directions', async () => {
  const f = await fixture(), phone = await client(f, 'phone'), mac = await client(f, 'mac');
  phone.c.payload.bundle.ops.push(revision('store', 'from-phone', { name: '手機測試', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'phone'));
  phone.c.payload.dirty = true; await phone.c.manual();
  mac.c.clock = '2026-09-13T15:12:00.000Z'; await mac.c.autoSync();
  assert.equal(mac.c.payload.lastSync, mac.c.clock); assert.equal(phone.c.payload.lastSync, NOW);
  assert.equal(JSON.stringify(mac.c.payload.bundle), JSON.stringify(phone.c.payload.bundle));
  mac.c.payload.bundle.ops.push(revision('store', 'from-mac', { name: 'Mac 測試', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'mac'));
  mac.c.payload.dirty = true; await mac.c.manual();
  phone.c.clock = '2026-09-13T15:13:00.000Z'; await phone.c.autoSync();
  assert.equal(phone.c.payload.lastSync, phone.c.clock);
  assert.equal(JSON.stringify(phone.c.payload.bundle), JSON.stringify(mac.c.payload.bundle));
  assert.equal((await unseal(f.remote.envelope, f.key)).ops.length, 3);
});

test('background and active editing never produce a fresh automatic success time', async () => {
  const f = await fixture(), { c, calls } = await client(f);
  c.document.hidden = true; await c.autoSync();
  c.document.hidden = false; c.editorContext = {}; await c.autoSync();
  assert.equal(c.payload.lastSync, OLD); assert.equal(calls.length, 0);
});


test('read-only connection diagnostics never claim sync or overwrite encrypted local edits and time', async () => {
  const f = await fixture(), { c, calls, local, $ } = await client(f);
  c.payload.dirty = true; await c.persist(c.payload);
  const before = JSON.stringify(local.envelope);
  await c.checkConnection();
  assert.deepEqual(calls, [['/api/version', 'GET']]);
  assert.equal(c.payload.lastSync, OLD); assert.equal(c.payload.dirty, true);
  assert.equal(JSON.stringify(local.envelope), before);
  assert.match($('connection-check').textContent, /配對有效/);
  assert.match($('connection-check').textContent, /不會交換客戶資料或更新成功同步時間/);
});

test('program versions, data revisions, failure time and recovered sync remain distinct', async () => {
  const f = await fixture(), { c, $ } = await client(f);
  c.macProgram = { version: '1.4.3', at: NOW };
  c.failure = 'network'; await assert.rejects(c.manual());
  assert.equal(c.lastSyncFailure.at, NOW); assert.equal(c.payload.lastSync, OLD);
  assert.match($('connection-detail').textContent, /資料版本 1/);
  assert.doesNotMatch($('connection-detail').textContent, /Mac 版本/);
  assert.ok($('program-detail').textContent.includes('本機 App v' + APP_VERSION));
  assert.match($('program-detail').textContent, /Mac 程式 v1\.4\.3/);
  assert.match($('sync-failure-detail').textContent, /連線失敗/);
  c.failure = null; c.clock = '2026-09-13T16:00:00.000Z'; await c.manual();
  assert.equal(c.lastSyncFailure.at, NOW); assert.equal(c.payload.lastSync, c.clock);
  assert.match($('sync-failure-detail').textContent, /之後已成功同步/);
  assert.doesNotMatch($('sync-state').textContent, /同步未完成/);
});

test('a failed Mac backup after accepted data is a warning, not a failed sync', async () => {
  const f = await fixture(), { c, $ } = await client(f);
  c.payload.bundle.ops.push(revision('store', 'backup-test', { name: '合成快照測試', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'phone'));
  c.payload.dirty = true; c.failure = 'backup'; await c.manual();
  assert.equal(c.payload.lastSync, NOW); assert.equal(c.payload.dirty, false); assert.equal(c.lastError, '');
  assert.equal(c.lastSyncFailure, null);
  assert.match($('sync-result').textContent, /同步提醒.*自動快照失敗/);
  assert.doesNotMatch($('sync-state').textContent, /同步未完成/);
  await c.manual(); assert.match($('sync-success-detail').textContent, /自動快照失敗/);
});
