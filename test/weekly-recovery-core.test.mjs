import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as core from '../public/core.js';

// Fictional data and passwords only. No formal app, customer files or pairing.
const password = 'synthetic-weekly-recovery-password', oldPassword = 'synthetic-formal-password';
const enc = new TextEncoder();
const fixturePromise = (async () => {
  const sourceMeta = core.newMeta(), backupMeta = { ...core.newMeta(), vaultId: sourceMeta.vaultId };
  const sourceKey = await core.derive(oldPassword, sourceMeta), backupKey = await core.derive(password, backupMeta);
  const bundle = core.emptyBundle(sourceMeta.vaultId), bytes = enc.encode('name,note\r\nSynthetic,"exact\r\nsource  "\r\n');
  const blob = await core.hashBytes(bytes); bundle.blobs[blob] = core.b64(bytes);
  const store = core.revision('store', 's', { name: 'Synthetic weekly store', city: '', district: '', channel: '', contact: '', attr: 'Original relationship text\r\n  ', nextRemember: 'Do not rewrite' }, [], 'synthetic');
  const visit = core.revision('visit', 'v', { store: 's', date: '', text: '  Exact customer note\r\nSynthetic relationship.  ', next: '', source: 'Synthetic source', people: [], topics: [], attachments: [{ blob, name: 'synthetic.csv', mime: 'text/csv' }] }, [], 'synthetic', false, core.makeVisitAttendance('s', '2026-10-18T02:00:00.000Z'));
  const source = core.revision('source', 'source', { file: 'synthetic.csv', list: 'Synthetic', blob, batch: 'synthetic', rows: 1, headers: ['name', 'note'], encoding: 'utf-8', delimiter: ',' }, [], 'synthetic');
  bundle.ops.push(store, visit, source);
  const proofBundle = structuredClone(bundle), proofText = JSON.stringify({ format: 'pharmacy-backup-1', envelope: await core.seal(proofBundle, backupKey, backupMeta) });
  const removed = core.revision('store', 'removed', { ...store.data, name: 'Synthetic removed store' }, [], 'synthetic');
  bundle.ops.push(removed, core.revision('store', 'removed', removed.data, [removed.id], 'synthetic', true));
  const record = core.project(bundle).find(r => r.id === 's' && r.type === 'store');
  const entry = { id: 'synthetic-relation', kind: 'relationship', level: 'source', headline: 'Synthetic relationship', question: 'Synthetic follow-up?', caution: '', limitations: [], evidence: [{ storeId: 's', storeIdentityKey: core.storeInsightsIdentityKey(record), visitId: 'v', revisionId: visit.id, quote: 'Synthetic relationship.', role: 'support' }] };
  bundle.ops.push(core.revision('store', 's', { ...store.data, preVisitInsights: { format: 'pharmacy-store-insights-1', batchId: 'synthetic', generatedAt: '2026-10-18T02:00:00.000Z', sourceAsOf: '2026-10-18', entries: [entry] } }, [store.id], 'synthetic'));
  const current = core.project(bundle).find(r => r.id === 's' && r.type === 'store');
  const reviewed = core.applyInsightReview(bundle, core.planInsightReview(bundle, 's', entry.id, 'confirmed', current.heads[0].id), 'synthetic');
  reviewed.ops.push(core.revision('visit', 'v', { ...visit.data, text: 'Synthetic Mac branch' }, [visit.id], 'mac'));
  reviewed.ops.push(core.revision('visit', 'v', { ...visit.data, text: 'Synthetic iPhone branch' }, [visit.id], 'phone'));
  return { sourceMeta, sourceKey, backupMeta, backupKey, proofText, proofBundle, bundle: reviewed, sourceEnvelope: await core.seal(reviewed, sourceKey, sourceMeta) };
})();

test('existing backup proof derives a nonextractable key without returning password or customer content', async () => {
  const f = await fixturePromise, before = structuredClone(f.sourceMeta);
  const config = await core.setupWeeklyRecovery(f.proofText, password, f.sourceMeta);
  assert.deepEqual(Object.keys(config).sort(), ['key', 'meta', 'proofSha256']);
  assert.equal(config.key.extractable, false); assert.equal(config.key.algorithm.name, 'AES-GCM'); assert.equal(config.key.algorithm.length, 256);
  await assert.rejects(crypto.subtle.exportKey('raw', config.key));
  assert.deepEqual(config.meta, { vaultId: f.backupMeta.vaultId, salt: f.backupMeta.salt, iterations: f.backupMeta.iterations });
  assert.equal(config.proofSha256, await core.hashBytes(enc.encode(f.proofText)));
  assert.deepEqual(f.sourceMeta, before);
  assert.deepEqual(await core.unseal(JSON.parse(f.proofText).envelope, config.key), f.proofBundle);
});

test('prepared recovery includes later changes, conflicts, tombstones, relationships, attendance and exact source bytes', async () => {
  const f = await fixturePromise, config = await core.setupWeeklyRecovery(f.proofText, password, f.sourceMeta);
  const before = JSON.stringify({ source: f.sourceEnvelope, bundle: f.bundle, meta: config.meta });
  const output = await core.prepareWeeklyRecovery(f.sourceEnvelope, f.sourceKey, config);
  assert.deepEqual(Object.keys(output).sort(), ['envelope', 'sha256', 'summary', 'warnings']);
  assert.deepEqual(await core.unseal(output.envelope, await core.derive(password, output.envelope)), f.bundle);
  assert.equal(output.summary.revisions, f.bundle.ops.length); assert.equal(output.summary.conflicts, 1); assert.equal(output.summary.deleted.store, 1);
  assert.equal(output.sha256, await core.hashBytes(enc.encode(JSON.stringify({ format: 'pharmacy-backup-1', envelope: output.envelope }))));
  assert.equal(output.envelope.salt, config.meta.salt); assert.notEqual(output.envelope.salt, f.sourceMeta.salt);
  await assert.rejects(core.unseal(output.envelope, f.sourceKey));
  const second = await core.prepareWeeklyRecovery(f.sourceEnvelope, f.sourceKey, config);
  assert.notEqual(second.envelope.iv, output.envelope.iv); assert.notEqual(second.sha256, output.sha256);
  assert.deepEqual(await core.unseal(second.envelope, config.key), f.bundle);
  assert.equal(JSON.stringify({ source: f.sourceEnvelope, bundle: f.bundle, meta: config.meta }), before);
});

test('proof rejects wrong password, foreign vault, formal salt, malformed file and corrupt complete content', async () => {
  const f = await fixturePromise;
  await assert.rejects(core.setupWeeklyRecovery(f.proofText, password + '-wrong', f.sourceMeta), /密碼不正確/);
  await assert.rejects(core.setupWeeklyRecovery(f.proofText, password, { ...f.sourceMeta, vaultId: crypto.randomUUID() }), /不同資料庫/);
  await assert.rejects(core.setupWeeklyRecovery(f.proofText, password, f.backupMeta), /正式資料庫/);
  for (const text of ['{', '{}', JSON.stringify({ format: 'other', envelope: JSON.parse(f.proofText).envelope })]) await assert.rejects(core.setupWeeklyRecovery(text, password, f.sourceMeta));
  const corrupt = structuredClone(f.proofBundle); corrupt.blobs[Object.keys(corrupt.blobs)[0]] = core.b64(enc.encode('wrong content'));
  await assert.rejects(core.setupWeeklyRecovery(JSON.stringify({ format: 'pharmacy-backup-1', envelope: await core.seal(corrupt, f.backupKey, f.backupMeta) }), password, f.sourceMeta), /內容與識別不符/);
  const wrongIdentity = { ...f.proofBundle, vaultId: crypto.randomUUID() };
  await assert.rejects(core.setupWeeklyRecovery(JSON.stringify({ format: 'pharmacy-backup-1', envelope: await core.seal(wrongIdentity, f.backupKey, f.backupMeta) }), password, f.sourceMeta), /身分不符/);
});

test('preparation rejects device payloads, corrupted blobs, wrong identity and insecure keys', async () => {
  const f = await fixturePromise, config = { key: f.backupKey, meta: f.backupMeta };
  const deviceEnvelope = await core.seal({ bundle: f.bundle, token: 'synthetic-token', draft: 'not a formal record' }, f.sourceKey, f.sourceMeta, 'device');
  await assert.rejects(core.prepareWeeklyRecovery(deviceEnvelope, f.sourceKey, config));
  const corrupt = structuredClone(f.bundle); corrupt.blobs[Object.keys(corrupt.blobs)[0]] = core.b64(enc.encode('bad'));
  await assert.rejects(core.prepareWeeklyRecovery(await core.seal(corrupt, f.sourceKey, f.sourceMeta), f.sourceKey, config), /內容與識別不符/);
  const wrongIdentity = { ...f.bundle, vaultId: crypto.randomUUID() };
  await assert.rejects(core.prepareWeeklyRecovery(await core.seal(wrongIdentity, f.sourceKey, f.sourceMeta), f.sourceKey, config), /身分不符/);
  await assert.rejects(core.prepareWeeklyRecovery(f.sourceEnvelope, f.sourceKey, { key: f.backupKey, meta: f.sourceMeta }), /正式資料庫/);
  for (const key of [null, { type: 'secret', extractable: false, algorithm: { name: 'AES-GCM', length: 256 }, usages: ['encrypt', 'decrypt'] }, await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']), await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt'])]) {
    await assert.rejects(core.prepareWeeklyRecovery(f.sourceEnvelope, f.sourceKey, { ...config, key }), /金鑰/);
  }
});

test('preparation captures source and metadata before awaiting cryptography', async () => {
  const f = await fixturePromise, source = structuredClone(f.sourceEnvelope), meta = { ...f.backupMeta };
  const pending = core.prepareWeeklyRecovery(source, f.sourceKey, { key: f.backupKey, meta });
  source.ciphertext = 'caller changed after call'; meta.salt = f.sourceMeta.salt; meta.vaultId = crypto.randomUUID();
  assert.deepEqual(await core.unseal((await pending).envelope, f.backupKey), f.bundle);
});

// A transaction stub exercises the actual DB helper code, including asynchronous
// completion/abort and structured-cloned CryptoKey records, without touching IDB.
function databaseHarness(initial) {
  let records = new Map(Object.entries(initial)), failCommit = false;
  const db = { transaction(storeName, mode) {
    assert.equal(storeName, 'vault');
    const pending = new Map(records), tx = { objectStore(name) {
      assert.equal(name, 'vault');
      return { get(id) { const r = {}; queueMicrotask(() => { r.result = structuredClone(records.get(id)); r.onsuccess?.(); }); return r; },
        add(record, id) {
          assert.equal(mode, 'readwrite'); const copy = structuredClone(record);
          queueMicrotask(() => { if (failCommit || pending.has(id)) { tx.onabort?.(); return; } pending.set(id, copy); records = pending; tx.oncomplete?.(); });
        } };
    } }; return tx;
  } };
  const indexedDB = { open(name, version) { assert.equal(name, 'pharmacy-local-v1'); assert.equal(version, 1); const r = {}; queueMicrotask(() => { r.result = db; r.onsuccess?.(); }); return r; } };
  const context = vm.createContext({ indexedDB, CryptoKey, atob, btoa, Error, Promise });
  vm.runInContext(fs.readFileSync(new URL('../public/db.js', import.meta.url), 'utf8').replaceAll('export ', ''), context);
  return { context, records: () => records, fail: () => { failCommit = true; } };
}

test('weekly DB records preserve main, archives and prior keys; duplicate or failed writes never replace records', async () => {
  const f = await fixturePromise, id = crypto.randomUUID(), otherId = crypto.randomUUID();
  const main = { envelope: f.sourceEnvelope, revision: 8, unlockKey: f.sourceKey }, archive = { envelope: f.sourceEnvelope, revision: 7, unlockKey: f.sourceKey };
  const h = databaseHarness({ main, 'archive:synthetic': archive });
  const value = { key: f.backupKey, meta: f.backupMeta, sourceVaultId: f.sourceMeta.vaultId, proofSha256: await core.hashBytes(enc.encode(f.proofText)), password: 'must never be stored' };
  assert.equal(await h.context.readWeeklyRecovery(id), null);
  await h.context.writeWeeklyRecovery(id, value);
  const read = await h.context.readWeeklyRecovery(id);
  assert.equal(read.key.extractable, false); assert.deepEqual(await core.unseal(JSON.parse(f.proofText).envelope, read.key), f.proofBundle);
  assert.deepEqual(Object.keys(read).sort(), ['key', 'meta', 'proofSha256', 'sourceVaultId']);
  assert.equal(h.records().get('weekly-recovery:' + id).password, undefined);
  await h.context.writeWeeklyRecovery(otherId, value);
  await assert.rejects(h.context.writeWeeklyRecovery(id, { ...value, proofSha256: 'a'.repeat(64) }), /已存在/);
  assert.equal(h.records().get('weekly-recovery:' + id).proofSha256, value.proofSha256);
  h.fail(); await assert.rejects(h.context.writeWeeklyRecovery(crypto.randomUUID(), value), /無法保存/);
  assert.equal(h.records().size, 4); assert.equal(h.records().get('main'), main); assert.equal(h.records().get('archive:synthetic'), archive);
});

test('weekly DB rejects malformed IDs and unsafe records before opening any transaction', async () => {
  const f = await fixturePromise, h = databaseHarness({}), id = crypto.randomUUID();
  const value = { key: f.backupKey, meta: f.backupMeta, sourceVaultId: f.sourceMeta.vaultId, proofSha256: 'a'.repeat(64) };
  for (const bad of ['main', 'archive:' + id, 'weekly-recovery:' + id, id.toUpperCase(), 'a'.repeat(36), null]) {
    await assert.rejects(h.context.readWeeklyRecovery(bad)); await assert.rejects(h.context.writeWeeklyRecovery(bad, value));
  }
  for (const bad of [{ ...value, key: {} }, { ...value, sourceVaultId: 'foreign' }, { ...value, proofSha256: 'invalid' }, { ...value, meta: { ...value.meta, salt: 'bad' } }]) await assert.rejects(h.context.writeWeeklyRecovery(id, bad));
  assert.equal(h.records().size, 0);
});

const healthNow = Date.parse('2026-10-18T04:00:00.000Z'), healthWeek = 7 * 86400000;
const healthInput = { now: healthNow, pendingCount: 0, pendingUnknown: false, conflicts: 0, identityPending: 0, lastSync: new Date(healthNow - 3600000).toISOString(), lastBackup: null, appVersion: 'synthetic', macVersion: 'synthetic' };
const weeklyHealth = (age, extra = {}) => ({ config: { id: 'synthetic-config', vaultId: 'synthetic-vault' }, status: 'success', due: false, sourceVersion: 12, lastSuccess: { configId: 'synthetic-config', at: new Date(healthNow - age).toISOString(), sourceVersion: 12 }, ...extra });
const healthCheck = (result, code) => result.checks.find(check => check.code === code);

test('health keeps legacy manual-export warning without weekly state and adds independent recent weekly evidence', () => {
  const legacy = core.readonlyHealthAudit(healthInput);
  assert.equal(healthCheck(legacy, 'backup-age').level, 'warning'); assert.equal(healthCheck(legacy, 'weekly-backup'), undefined);
  for (const lastBackup of [null, new Date(healthNow - 30 * 86400000).toISOString()]) {
    const input = { ...healthInput, lastBackup, weeklyBackup: weeklyHealth(86400000) }, before = structuredClone(input);
    const result = core.readonlyHealthAudit(input);
    assert.deepEqual(input, before); assert.equal(result.attention, 0); assert.equal(result.state, 'partial');
    assert.equal(healthCheck(result, 'backup-age').level, 'info'); assert.match(healthCheck(result, 'backup-age').text, /手動匯出/);
    assert.equal(healthCheck(result, 'weekly-backup').level, 'ok'); assert.match(healthCheck(result, 'weekly-backup').text, /Mac 保存成功/);
    assert.match(healthCheck(result, 'weekly-backup').text, /不等於離機備份/);
  }
});

test('health accepts the seven-day boundary but never suppresses manual warning with stale or future weekly time', () => {
  const boundary = core.readonlyHealthAudit({ ...healthInput, weeklyBackup: weeklyHealth(healthWeek) });
  assert.equal(healthCheck(boundary, 'backup-age').level, 'info');
  for (const age of [healthWeek + 1, -1]) {
    const result = core.readonlyHealthAudit({ ...healthInput, weeklyBackup: weeklyHealth(age) });
    assert.equal(healthCheck(result, 'backup-age').level, 'warning'); assert.equal(healthCheck(result, 'weekly-backup').level, 'warning');
    assert.equal(result.attention, 2);
  }
  const malformed = weeklyHealth(0); malformed.lastSuccess.at = 'invalid';
  assert.equal(healthCheck(core.readonlyHealthAudit({ ...healthInput, weeklyBackup: malformed }), 'weekly-backup').level, 'warning');
});

test('health does not hide current weekly failure behind an older recent success or a different configuration', () => {
  const failed = core.readonlyHealthAudit({ ...healthInput, weeklyBackup: weeklyHealth(3600000, { status: 'failed' }) });
  assert.equal(healthCheck(failed, 'backup-age').level, 'warning'); assert.equal(healthCheck(failed, 'weekly-backup').level, 'warning');
  assert.match(healthCheck(failed, 'weekly-backup').text, /最近一次失敗/);
  const changed = weeklyHealth(3600000, { config: { id: 'new-config' } });
  const result = core.readonlyHealthAudit({ ...healthInput, weeklyBackup: changed });
  assert.equal(healthCheck(result, 'backup-age').level, 'warning'); assert.match(healthCheck(result, 'weekly-backup').text, /目前.*設定尚無成功/);
});

test('health treats newer data before the next weekly schedule as informational, while due catchup remains visible', () => {
  const pendingNextWeek = core.readonlyHealthAudit({ ...healthInput, weeklyBackup: weeklyHealth(86400000, { sourceVersion: 13, due: false }) });
  assert.equal(pendingNextWeek.attention, 0); assert.equal(healthCheck(pendingNextWeek, 'weekly-backup').level, 'info');
  assert.match(healthCheck(pendingNextWeek, 'weekly-backup').text, /版本 13 較新.*下一次排程/);
  const due = core.readonlyHealthAudit({ ...healthInput, weeklyBackup: weeklyHealth(86400000, { sourceVersion: 13, status: 'waiting-current-copy', due: true }) });
  assert.equal(healthCheck(due, 'backup-age').level, 'info'); assert.equal(healthCheck(due, 'weekly-backup').level, 'warning');
  assert.match(healthCheck(due, 'weekly-backup').text, /已到期.*補做/);
  const initial = core.readonlyHealthAudit({ ...healthInput, weeklyBackup: weeklyHealth(0, { lastSuccess: null, status: 'waiting-current-copy', due: true }) });
  assert.equal(healthCheck(initial, 'backup-age').level, 'warning'); assert.equal(healthCheck(initial, 'weekly-backup').level, 'warning');
});
