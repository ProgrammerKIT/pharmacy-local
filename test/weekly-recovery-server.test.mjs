import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { randomUUID, createHash } from 'node:crypto';
import { createScheduledRecoveryStore, recoverySchedule, durableRecoveryAtomic, createService, atomic } from '../server.mjs';
import { makeCertificates } from '../scripts/setup.mjs';
import { newMeta } from '../public/core.js';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const envelope = (meta = newMeta()) => ({ ...meta, iv: Buffer.alloc(12, 1).toString('base64'), ciphertext: Buffer.alloc(32, 2).toString('base64') });
const options = (vaultId, expectedConfigId = null, configId = randomUUID()) => { const meta = newMeta(); return { expectedConfigId, configId, weekday: 5, hour: 21, minute: 0, vaultId, enabled: true, recoveryMeta: { salt: meta.salt, iterations: meta.iterations } }; };
const staged = (configId, snapshot, backup) => ({ configId, expectedVersion: snapshot.version, sourceSha256: hash(snapshot.envelope), envelope: backup, sha256: hash({ format: 'pharmacy-backup-1', envelope: backup }) });
function fixture(t, write) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-weekly-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let time = Date.parse('2026-10-18T04:00:00Z'), snapshot = { version: 7, envelope: envelope() };
  const make = () => createScheduledRecoveryStore({ dataDir: directory, getSnapshot: () => snapshot, now: () => time, ...(write ? { write } : {}) });
  const store = make(), config = options(snapshot.envelope.vaultId), backup = envelope({ ...newMeta(), vaultId: snapshot.envelope.vaultId, ...config.recoveryMeta });
  return { directory, store, config, backup, make, now: value => { time = Date.parse(value); }, snapshot: () => snapshot, advance: () => { snapshot = { version: snapshot.version + 1, envelope: { ...snapshot.envelope, ciphertext: Buffer.alloc(32, snapshot.version).toString('base64') } }; }, stage: () => staged(config.configId, snapshot, backup), files: () => fs.readdirSync(path.join(directory, 'scheduled-recovery-backups')).filter(name => name.endsWith('.pharmabackup')) };
}

test('Taipei Friday 21:00 boundaries are UTC 13:00, independent of the host timezone', () => {
  assert.deepEqual(recoverySchedule(Date.parse('2026-10-23T12:59:59.999Z')), { latest: '2026-10-16T13:00:00.000Z', next: '2026-10-23T13:00:00.000Z' });
  assert.deepEqual(recoverySchedule(Date.parse('2026-10-23T13:00:00.000Z')), { latest: '2026-10-23T13:00:00.000Z', next: '2026-10-30T13:00:00.000Z' });
  assert.deepEqual(recoverySchedule(Date.parse('2026-10-24T00:00:00+08:00')), { latest: '2026-10-23T13:00:00.000Z', next: '2026-10-30T13:00:00.000Z' });
  assert.throws(() => recoverySchedule(Date.now(), { weekday: 7 }), /排程/);
});

test('a user-selected valid schedule keeps Taipei timezone and catches its exact boundary', t => {
  const f = fixture(t), config = { ...f.config, weekday: 1, hour: 6, minute: 30 };
  assert.equal(f.store.configure(config).config.minute, 30);
  const initial = f.store.stage(f.stage()); assert.equal(initial.nextDueAt, '2026-10-18T22:30:00.000Z');
  f.now('2026-10-18T22:29:59.999Z'); assert.equal(f.store.tick().due, false); assert.equal(f.files().length, 1);
  f.now('2026-10-18T22:30:00.000Z'); assert.equal(f.store.tick().lastSuccess.dueAt, '2026-10-18T22:30:00.000Z'); assert.equal(f.files().length, 2);
  assert.throws(() => f.store.configure({ ...config, expectedConfigId: config.configId, configId: randomUUID(), hour: 24 }));
});

test('initial full copy, exact weekly boundary and multi-week startup catchup preserve every old file', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.directory, 'backups'));
  fs.writeFileSync(path.join(f.directory, 'backups', 'old.pharmabackup'), 'old backup untouched');
  fs.writeFileSync(path.join(f.directory, 'snapshot.json'), 'production sentinel');
  fs.writeFileSync(path.join(f.directory, 'config.json'), 'pairing sentinel');
  assert.equal(f.store.status().status, 'unconfigured');
  assert.equal(fs.existsSync(path.join(f.directory, 'scheduled-recovery-backups')), false);
  assert.equal(f.store.configure(f.config).status, 'waiting-current-copy');
  assert.equal(f.store.status().due, true);
  const initial = f.store.stage(f.stage());
  assert.equal(initial.status, 'success'); assert.equal(initial.due, false); assert.equal(f.files().length, 1);
  assert.equal(initial.config.recoveryMeta.salt, f.backup.salt);
  assert.equal(initial.nextDueAt, '2026-10-23T13:00:00.000Z');
  assert.equal(JSON.parse(f.store.download(initial.lastSuccess.name)).envelope.salt, f.backup.salt);
  assert.ok(!JSON.stringify(initial).includes('ciphertext'));
  const oldBytes = f.store.download(initial.lastSuccess.name);
  f.now('2026-10-23T12:59:59.999Z'); f.store.tick(); assert.equal(f.files().length, 1);
  f.now('2026-10-23T13:00:00Z'); const weekly = f.store.tick(); assert.equal(weekly.status, 'success'); assert.equal(weekly.lastSuccess.dueAt, '2026-10-23T13:00:00.000Z'); assert.equal(f.files().length, 2);
  f.store.tick(); assert.equal(f.files().length, 2);
  f.now('2026-11-15T11:00:00Z'); const restarted = f.make();
  assert.equal(restarted.status().due, true); const caughtUp = restarted.tick();
  assert.equal(caughtUp.lastSuccess.dueAt, '2026-11-13T13:00:00.000Z'); assert.equal(f.files().length, 3);
  assert.deepEqual(restarted.download(initial.lastSuccess.name), oldBytes);
  assert.equal(fs.readFileSync(path.join(f.directory, 'backups', 'old.pharmabackup'), 'utf8'), 'old backup untouched');
  assert.equal(fs.readFileSync(path.join(f.directory, 'snapshot.json'), 'utf8'), 'production sentinel');
  assert.equal(fs.readFileSync(path.join(f.directory, 'config.json'), 'utf8'), 'pairing sentinel');
  for (const name of f.files()) assert.equal(fs.statSync(path.join(f.directory, 'scheduled-recovery-backups', name)).mode & 0o777, 0o600);
});

test('missing or stale copy never becomes success; fresh source stages catch up without deleting previous copies', t => {
  const f = fixture(t); f.store.configure(f.config);
  f.now('2026-11-15T11:00:00Z'); assert.equal(f.store.tick().status, 'waiting-current-copy'); assert.equal(f.files().length, 0);
  const first = f.store.stage(f.stage()); assert.equal(first.lastSuccess.dueAt, '2026-11-13T13:00:00.000Z');
  const stale = f.stage(); f.advance(); f.now('2026-11-20T13:00:00Z');
  assert.equal(f.store.tick().status, 'waiting-current-copy'); assert.equal(f.files().length, 1);
  assert.throws(() => f.store.stage(stale), error => error.status === 409);
  const restarted = f.make(); assert.equal(restarted.tick().status, 'waiting-current-copy');
  const fresh = restarted.stage(f.stage()); assert.equal(fresh.status, 'success'); assert.equal(fresh.lastSuccess.sourceVersion, 8); assert.equal(f.files().length, 2);
});

test('config CAS and stage validate identity, exact snapshot, independent encryption and checksum', t => {
  const f = fixture(t);
  assert.throws(() => f.store.configure({ ...f.config, recoveryMeta: undefined }), error => error.status === 400);
  assert.throws(() => f.store.configure({ ...f.config, recoveryMeta: { salt: f.snapshot().envelope.salt, iterations: f.snapshot().envelope.iterations } }), error => error.status === 400);
  const configured = f.store.configure(f.config); assert.deepEqual(configured.config.recoveryMeta, f.config.recoveryMeta);
  assert.throws(() => f.store.stage(staged(f.config.configId, f.snapshot(), envelope({ ...newMeta(), vaultId: f.backup.vaultId }))), error => error.status === 409);
  assert.throws(() => f.store.configure(f.config), error => error.status === 409);
  const invalid = [
    { ...f.stage(), configId: randomUUID() }, { ...f.stage(), expectedVersion: 8 }, { ...f.stage(), sourceSha256: '0'.repeat(64) },
    { ...f.stage(), sha256: '0'.repeat(64) }, staged(f.config.configId, f.snapshot(), f.snapshot().envelope),
    staged(f.config.configId, f.snapshot(), { ...f.backup, vaultId: randomUUID() }),
    staged(f.config.configId, f.snapshot(), { ...f.backup, password: 'must-not-be-saved' }),
  ];
  for (const body of invalid) assert.throws(() => f.store.stage(body));
  assert.equal(f.files().length, 0);
  const first = f.store.stage(f.stage());
  assert.throws(() => f.store.stage(staged(f.config.configId, f.snapshot(), envelope({ ...newMeta(), vaultId: f.backup.vaultId }))), error => error.status === 409);
  const nextConfig = options(f.backup.vaultId, f.config.configId); const changed = f.store.configure(nextConfig);
  assert.equal(changed.lastSuccess, null); assert.equal(changed.stage, null); assert.deepEqual(changed.config.recoveryMeta, nextConfig.recoveryMeta);
  assert.throws(() => f.store.stage(f.stage()), error => error.status === 409);
  assert.deepEqual(f.store.download(first.lastSuccess.name), Buffer.from(JSON.stringify({ format: 'pharmacy-backup-1', envelope: f.backup })));
  assert.throws(() => f.store.download('../snapshot.json'), error => error.status === 404);
  assert.throws(() => f.store.download(first.lastSuccess.name.replace('recovery-', 'unknown-')), error => error.status === 404);
});

test('disk failure is explicit; retries after backup commit reuse the durable file and commit success only afterward', t => {
  let fault = null;
  const f = fixture(t, (file, value) => {
    if (fault === 'backup' && file.endsWith('.pharmabackup')) throw new Error('ENOSPC private path');
    if (fault === 'state' && file.endsWith('state.json') && value.lastSuccess) throw new Error('ENOSPC private path');
    durableRecoveryAtomic(file, value);
  });
  f.store.configure(f.config); fault = 'backup';
  let result = f.store.stage(f.stage()); assert.equal(result.status, 'failed'); assert.equal(result.lastSuccess, null); assert.equal(f.files().length, 0);
  assert.ok(!JSON.stringify(result).includes('private path'));
  fault = 'state'; result = f.store.tick(); assert.equal(result.status, 'failed'); assert.equal(result.lastSuccess, null); assert.equal(f.files().length, 1);
  fault = null; result = f.store.tick(); assert.equal(result.status, 'success'); assert.equal(f.files().length, 1);
  f.store.tick(); assert.equal(f.files().length, 1);
});

test('a re-encrypted retry after state commit failure preserves the orphaned prior ciphertext and can succeed', t => {
  let failState = true;
  const f = fixture(t, (file, value) => {
    if (failState && file.endsWith('state.json') && value.lastSuccess) throw new Error('state unavailable');
    durableRecoveryAtomic(file, value);
  });
  f.store.configure(f.config); assert.equal(f.store.stage(f.stage()).status, 'failed');
  const firstName = f.files()[0], firstBytes = fs.readFileSync(path.join(f.directory, 'scheduled-recovery-backups', firstName));
  failState = false;
  const replacement = { ...f.backup, iv: Buffer.alloc(12, 6).toString('base64') };
  const accepted = f.store.stage(staged(f.config.configId, f.snapshot(), replacement));
  assert.equal(accepted.status, 'success'); assert.equal(f.files().length, 2); assert.notEqual(accepted.lastSuccess.name, firstName);
  assert.deepEqual(fs.readFileSync(path.join(f.directory, 'scheduled-recovery-backups', firstName)), firstBytes);
});

test('corrupted staged bytes and existing backup bytes fail readback without altering past records', t => {
  const f = fixture(t); f.store.configure(f.config); const first = f.store.stage(f.stage());
  const dir = path.join(f.directory, 'scheduled-recovery-backups');
  f.now('2026-10-23T13:00:00Z'); fs.writeFileSync(path.join(dir, `staged-${f.config.configId}.json`), '{}');
  const failed = f.store.tick(); assert.equal(failed.status, 'failed'); assert.equal(failed.lastSuccess.name, first.lastSuccess.name); assert.equal(f.files().length, 1);
  const repaired = f.store.stage(f.stage()); assert.equal(repaired.status, 'success'); assert.equal(f.files().length, 2);
  fs.writeFileSync(path.join(dir, first.lastSuccess.name), 'corrupt');
  assert.throws(() => f.store.download(first.lastSuccess.name), error => error.status === 503);
});

test('unreadable temporary stage after restart can be replaced without resetting valid configuration', t => {
  const f = fixture(t); f.store.configure(f.config); const original = f.store.stage(f.stage());
  fs.writeFileSync(path.join(f.directory, 'scheduled-recovery-backups', `staged-${f.config.configId}.json`), '{broken');
  const restarted = f.make(); assert.equal(restarted.status().status, 'failed'); assert.equal(restarted.status().config.id, f.config.configId);
  assert.equal(restarted.stage(f.stage()).status, 'success'); assert.equal(f.files().length, 1);
  assert.equal(restarted.status().lastSuccess.name, original.lastSuccess.name);
});

test('malformed persisted state fails closed and does not silently replace a previous configuration', t => {
  const f = fixture(t); f.store.configure(f.config);
  const file = path.join(f.directory, 'scheduled-recovery-backups', 'state.json'); fs.writeFileSync(file, '{broken');
  const restarted = f.make(); assert.equal(restarted.status().status, 'failed'); assert.throws(() => restarted.configure(f.config), error => error.status === 503);
  restarted.tick(); assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('authenticated HTTPS routes reject stale source, config races, revocation and update races after body await', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-weekly-https-'));
  makeCertificates(directory, 'pharmacy-test.local');
  const admin = 'test-admin-token', token = 'test-device-token';
  atomic(path.join(directory, 'config.json'), { hostname: 'pharmacy-test.local', port: 8443, adminToken: admin, devices: [{ id: 'synthetic-device', hash: hash(token), label: 'fixture' }] });
  let snapshot = { version: 1, envelope: envelope() }; atomic(path.join(directory, 'snapshot.json'), snapshot);
  const pairingBytes = fs.readFileSync(path.join(directory, 'config.json'));
  const service = createService({ dataDir: directory, host: '127.0.0.1', port: 0 });
  t.after(() => { service.server.closeAllConnections(); service.server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const address = await service.listen(), ca = fs.readFileSync(path.join(directory, 'tls', 'ca.crt'));
  const startRequest = (route, method = 'GET', bearer = token, extra = {}) => {
    let req;
    const result = new Promise((resolve, reject) => {
      req = https.request({ host: '127.0.0.1', servername: 'localhost', port: address.port, path: route, method, ca, headers: { Host: `localhost:${address.port}`, Origin: `https://localhost:${address.port}`, 'Content-Type': 'application/json', 'X-Pharmacy-Client': '1', Authorization: `Bearer ${bearer}`, ...extra } }, res => { let bytes = ''; res.on('data', chunk => bytes += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(bytes), headers: res.headers })); }); req.on('error', reject);
    });
    return { req, result };
  };
  const request = (route, method = 'GET', body, bearer = token, extra) => { const task = startRequest(route, method, bearer, extra); task.req.end(body === undefined ? undefined : JSON.stringify(body)); return task.result; };
  const delayed = async body => {
    const seen = new Promise(resolve => service.server.once('request', resolve));
    const task = startRequest('/api/recovery-backup/stage', 'POST'); task.req.write('{'); await seen;
    return { finish: () => task.req.end(JSON.stringify(body).slice(1)), result: task.result };
  };
  assert.equal((await request('/api/recovery-backup/status', 'GET', undefined, '')).status, 401);
  assert.equal((await request('/api/recovery-backup/config', 'POST', {}, token, { Origin: 'https://evil.invalid' })).status, 403);
  const config = options(snapshot.envelope.vaultId), backup = envelope({ ...newMeta(), vaultId: snapshot.envelope.vaultId, ...config.recoveryMeta });
  assert.equal((await request('/api/recovery-backup/config', 'POST', config)).status, 200);
  assert.equal((await request('/api/recovery-backup/config', 'POST', config)).status, 409);
  const accepted = await request('/api/recovery-backup/stage', 'POST', staged(config.configId, snapshot, backup));
  assert.equal(accepted.status, 200); assert.equal(accepted.body.status, 'success');
  const downloaded = await request(`/api/recovery-backup/file?name=${encodeURIComponent(accepted.body.lastSuccess.name)}`);
  assert.equal(downloaded.status, 200); assert.deepEqual(downloaded.body.envelope, backup); assert.match(downloaded.headers['content-disposition'], /^attachment/);
  assert.equal((await request('/api/recovery-backup/file?name=..%2Fsnapshot.json')).status, 404);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'config.json')), pairingBytes);
  let race = await delayed(staged(config.configId, snapshot, backup));
  const next = { ...snapshot.envelope, ciphertext: Buffer.alloc(32, 3).toString('base64') };
  assert.equal((await request('/api/snapshot', 'PUT', { expectedVersion: 1, envelope: next })).status, 200);
  snapshot = { version: 2, envelope: next }; race.finish(); assert.equal((await race.result).status, 409);
  race = await delayed(staged(config.configId, snapshot, backup)); service.prepare(); race.finish(); assert.equal((await race.result).status, 503); service.cancel();
  race = await delayed(staged(config.configId, snapshot, backup));
  await request('/api/admin/revoke', 'POST', { id: 'synthetic-device' }, admin); race.finish(); assert.equal((await race.result).status, 401);
  assert.equal((await request('/api/recovery-backup/status')).status, 401);
});
