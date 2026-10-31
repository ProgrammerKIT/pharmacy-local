import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createService, atomic, isPrivate } from '../server.mjs';
import { makeCertificates } from '../scripts/setup.mjs';
import { newMeta, derive, seal, unseal, emptyBundle, revision, merge, project } from '../public/core.js';
import { APP_VERSION } from '../public/version.js';

test('historical and Apple fallback icon URLs return the approved PNG without changing data or pairing', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-icon-test-'));
  makeCertificates(dir, 'pharmacy-icon-test.local');
  atomic(path.join(dir, 'config.json'), { hostname: 'pharmacy-icon-test.local', port: 8443, adminToken: 'fictional-icon-admin-token', devices: [{ id: 'fictional-device', hash: '0'.repeat(64), label: 'Fictional phone', created: '2026-01-01T00:00:00Z' }] });
  const meta = newMeta(), key = await derive('fictional-icon-password', meta), bundle = emptyBundle(meta.vaultId);
  bundle.ops.push(revision('store', 'fictional-icon-store', { name: 'Fictional icon store', city: '', district: '', channel: '獨立', attr: '', contact: '' }, [], 'fictional-device'));
  atomic(path.join(dir, 'snapshot.json'), { version: 7, envelope: await seal(bundle, key, meta) });
  const service = createService({ dataDir: dir, host: '127.0.0.1', port: 0 }), address = await service.listen();
  t.after(() => { service.server.closeAllConnections(); service.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const ca = fs.readFileSync(path.join(dir, 'tls', 'ca.crt'));
  const before = ['config.json', 'snapshot.json'].map(name => fs.readFileSync(path.join(dir, name)));
  const expected = fs.readFileSync(new URL('../public/icon-192.png', import.meta.url));
  const request = (route, method = 'GET') => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', servername: 'localhost', port: address.port, path: route, method, ca,
      headers: { Host: `localhost:${address.port}` } }, res => {
      const parts = []; res.on('data', chunk => parts.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(parts) }));
    }); req.on('error', reject); req.end();
  });
  for (const route of ['/icon-192.png', '/icon-192.png?v=1.5.7', '/icon-512.png?v=1.5.0', '/icon.svg', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/favicon.ico']) {
    const result = await request(route);
    assert.equal(result.status, 200, route); assert.equal(result.headers['content-type'], 'image/png', route);
    assert.equal(result.headers['x-pharmacy-version'], APP_VERSION, route); assert.equal(result.headers['cache-control'], 'no-store', route);
    assert.deepEqual(result.bytes, expected, route);
  }
  const head = await request('/icon.svg?old-cache=1', 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.headers['content-type'], 'image/png'); assert.equal(head.bytes.length, 0);
  for (const route of ['/icon.svg/config.json', '/apple-touch-icon.png/../config.json', '/config.json', '/tls/server.key']) assert.equal((await request(route)).status, 404, route);
  for (const [i, name] of ['config.json', 'snapshot.json'].entries()) assert.deepEqual(fs.readFileSync(path.join(dir, name)), before[i], name);
});

test('private network classification', () => { assert.equal(isPrivate('::ffff:192.168.1.5'), true); assert.equal(isPrivate('172.31.0.5'), true); assert.equal(isPrivate('172.32.0.5'), false); assert.equal(isPrivate('8.8.8.8'), false); });
test('real HTTPS pairing, authentication, CAS sync, encrypted backups and revocation', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-test-'));
  makeCertificates(dir, 'pharmacy-test.local'); atomic(path.join(dir, 'config.json'), { hostname: 'pharmacy-test.local', port: 8443, adminToken: 'test-admin-token-123456', devices: [] });
  const service = createService({ dataDir: dir, host: '127.0.0.1', port: 0 }), address = await service.listen();
  t.after(() => { service.server.closeAllConnections(); service.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const ca = fs.readFileSync(path.join(dir, 'tls', 'ca.crt'));
  const request = (route, method = 'GET', body, token, extra = {}) => new Promise((resolve, reject) => {
    const headers = { Host: `localhost:${address.port}`, Origin: `https://localhost:${address.port}`, 'Content-Type': 'application/json', 'X-Pharmacy-Client': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
    for (const [name, value] of Object.entries(headers)) if (value === undefined) delete headers[name];
    const req = https.request({ host: '127.0.0.1', servername: 'localhost', port: address.port, path: route, method, ca, headers }, res => { let s = ''; res.on('data', chunk => s += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s), headers: res.headers })); }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const admin = 'test-admin-token-123456';
  assert.equal((await request('/api/admin/status')).status, 403);
  const status = await request('/api/admin/status', 'GET', undefined, admin);
  assert.equal(status.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()');
  assert.equal(status.body.service.running, true);
  assert.equal(status.body.service.supervised, false);
  assert.ok(['unsupported', 'unknown', 'unconfigured', 'disabled', 'not-loaded', 'loaded'].includes(status.body.service.autostart.state));
  assert.ok(!JSON.stringify(status.body).includes(admin));
  assert.equal((await request('/api/version', 'GET', undefined, undefined, { 'X-Pharmacy-Client': undefined })).status, 403);
  assert.equal((await request('/api/snapshot')).status, 401);
  assert.equal((await request('/api/admin/status', 'GET', undefined, admin, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/api/admin/status', 'GET', undefined, admin, { Origin: undefined, 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.equal((await request('/api/admin/status', 'GET', undefined, admin, { Origin: undefined, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/api/admin/status', 'GET', undefined, admin, { Host: 'evil.example' })).status, 403);
  assert.equal((await request('/config.json')).status, 404);
  async function pair(label) { const code = (await request('/api/admin/code', 'POST', {}, admin)).body.code; const result = await request('/api/pair', 'POST', { code, label }); assert.equal(result.status, 200); assert.equal((await request('/api/pair', 'POST', { code, label })).status, 403); return result.body; }
  const mac = await pair('Mac'), phone = await pair('iPhone'), meta = newMeta(), key = await derive('test-password-very-long', meta);
  assert.deepEqual((await request('/api/version', 'GET', undefined, mac.token)).body, { version: 0 });
  const base = emptyBundle(meta.vaultId), store = { name: 'secret fictional store', city: '', district: '', channel: '獨立', attr: '', contact: 'never-plaintext-contact' };
  base.ops.push(revision('store', 's1', store, [], mac.id));
  const first = await request('/api/snapshot', 'PUT', { expectedVersion: 0, envelope: await seal(base, key, meta) }, mac.token);
  assert.equal(first.status, 200); assert.equal(first.body.version, 1);
  const a = structuredClone(base), b = structuredClone(base);
  a.ops.push(revision('store', 's1', { ...store, contact: 'phone-edited' }, [a.ops[0].id], phone.id));
  b.ops.push(revision('store', 's1', { ...store, contact: 'mac-edited' }, [b.ops[0].id], mac.id));
  assert.equal((await request('/api/snapshot', 'PUT', { expectedVersion: 1, envelope: await seal(a, key, meta) }, phone.token)).status, 200);
  assert.equal((await request('/api/snapshot', 'PUT', { expectedVersion: 1, envelope: await seal(b, key, meta) }, mac.token)).status, 409);
  const latest = (await request('/api/snapshot', 'GET', undefined, mac.token)).body, joined = merge(b, await unseal(latest.envelope, key));
  assert.equal(project(joined)[0].heads.length, 2);
  assert.equal((await request('/api/snapshot', 'PUT', { expectedVersion: 2, envelope: await seal(joined, key, meta) }, mac.token)).status, 200);
  const received = (await request('/api/snapshot', 'GET', undefined, phone.token)).body; assert.deepEqual(await unseal(received.envelope, key), joined);
  const disk = fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'); assert.ok(!disk.includes(store.name)); assert.ok(!disk.includes(store.contact));
  const backups = fs.readdirSync(path.join(dir, 'backups')); assert.equal(backups.length, 3);
  const backup = JSON.parse(fs.readFileSync(path.join(dir, 'backups', backups.sort().at(-1)))); assert.deepEqual(await unseal(backup.envelope, key), joined);
  assert.equal(fs.statSync(path.join(dir, 'snapshot.json')).mode & 0o777, 0o600);
  const foreign = newMeta(); assert.equal((await request('/api/snapshot', 'PUT', { expectedVersion: 3, envelope: await seal(emptyBundle(foreign.vaultId), await derive('different-password', foreign), foreign) }, phone.token)).status, 409);
  await request('/api/admin/revoke', 'POST', { id: phone.id }, admin); assert.equal((await request('/api/snapshot', 'GET', undefined, phone.token)).status, 401);
});
