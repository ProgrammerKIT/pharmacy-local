import { APP_VERSION } from '../public/version.js';
const [major, minor, patch] = APP_VERSION.split('.').map(Number);
const NEXT_VERSION = `${major}.${minor}.${patch + 1}`, BAD_VERSION = `${major}.${minor}.${patch + 2}`;
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import https from 'node:https';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { ROOT, atomic } from '../server.mjs';
import { runSupervisor } from '../supervisor.mjs';
import { makeCertificates } from '../scripts/setup.mjs';
import { exportCode } from '../scripts/release.mjs';
import { buildPackage } from '../update/package.mjs';
import { newMeta, derive, seal, emptyBundle, unseal } from '../public/core.js';

test('real supervisor switches HTTPS child processes, waits for tabs and recovers a crashing release without changing ciphertext', { timeout: 60000 }, async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-supervisor-test-'));
  const root = path.join(base, 'app'), dataDir = path.join(base, 'data');
  exportCode(ROOT, root); makeCertificates(dataDir, 'fictional-test.local');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  atomic(path.join(dataDir, 'config.json'), { hostname: 'fictional-test.local', port, adminToken: 'fictional-test-only-admin', devices: [] });
  const meta = newMeta(), key = await derive('fictional-test-only-password', meta), bundle = emptyBundle(meta.vaultId);
  atomic(path.join(dataDir, 'snapshot.json'), { version: 1, envelope: await seal(bundle, key, meta) });
  const keys = generateKeyPairSync('ed25519'), repository = 'fictional-tests/program';
  fs.mkdirSync(path.join(dataDir, 'updates'));
  atomic(path.join(dataDir, 'updates', 'trust.json'), { format: 'pharmacy-trust-1', repository, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() });
  let bytes;
  const service = await runSupervisor({ root, dataDir, automatic: false, fetchPackage: async () => bytes });
  t.after(async () => { await service.shutdown(); fs.rmSync(base, { recursive: true, force: true }); });
  const request = (route, method = 'GET', body, token = 'fictional-test-only-admin') => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', servername: 'localhost', port, path: route, method, ca: fs.readFileSync(path.join(dataDir, 'tls', 'ca.crt')), headers: { Host: `localhost:${port}`, Origin: `https://localhost:${port}`, 'Content-Type': 'application/json', 'X-Pharmacy-Client': '1', 'X-Pharmacy-App': APP_VERSION, Authorization: `Bearer ${token}` } }, res => { const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) })); }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const code = (await request('/api/admin/code', 'POST', {})).body.code;
  const device = (await request('/api/pair', 'POST', { code, label: 'fictional browser' }, '')).body;
  const savedSnapshot = fs.readFileSync(path.join(dataDir, 'snapshot.json')), savedConfig = fs.readFileSync(path.join(dataDir, 'config.json'));
  function makeRelease(version, sequence, broken = false) {
    const source = path.join(base, `build-${sequence}`); exportCode(ROOT, source);
    for (const f of ['package.json', 'public/version.js', 'public/sw.js']) { const full = path.join(source, f); fs.writeFileSync(full, fs.readFileSync(full, 'utf8').replaceAll(APP_VERSION, version)); }
    if (broken) fs.writeFileSync(path.join(source, 'server.mjs'), "throw new Error('deliberately crashing fictional test release');\n");
    return buildPackage(source, { repository, sequence, privateKey: keys.privateKey });
  }
  const clientId = randomUUID();
  await request('/api/activity', 'POST', { clientId, busy: true }, device.token);
  bytes = makeRelease(NEXT_VERSION, 1); await service.engine.check(); await service.engine.apply();
  assert.equal(service.engine.info().phase, 'waiting');
  const maintenance = (await request('/api/activity', 'POST', { clientId, busy: true }, device.token)).body.maintenance;
  assert.ok(maintenance);
  assert.equal((await request('/api/snapshot', 'PUT', { expectedVersion: 1, envelope: meta }, device.token)).status, 503);
  await request('/api/activity', 'POST', { clientId, busy: false, generation: maintenance }, device.token);
  await service.engine.tick();
  assert.equal(service.engine.version(), NEXT_VERSION);
  assert.equal((await request('/api/admin/health')).body.appVersion, NEXT_VERSION);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'snapshot.json')), savedSnapshot);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'config.json')), savedConfig);
  assert.deepEqual(await unseal((await request('/api/snapshot', 'GET', undefined, device.token)).body.envelope, key), bundle);
  bytes = makeRelease(BAD_VERSION, 2, true); await service.engine.check(); await service.engine.tick();
  assert.equal(service.engine.version(), NEXT_VERSION); assert.equal(service.engine.state.paused, true);
  assert.equal((await request('/api/admin/health')).body.appVersion, NEXT_VERSION);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'snapshot.json')), savedSnapshot);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'config.json')), savedConfig);
  await service.engine.rollback(); await service.engine.tick();
  assert.equal(service.engine.version(), APP_VERSION); assert.equal(service.engine.state.paused, true);
});
