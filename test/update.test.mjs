import { APP_VERSION } from '../public/version.js';
const [major, minor, patch] = APP_VERSION.split('.').map(Number);
const NEXT_VERSION = `${major}.${minor}.${patch + 1}`, BAD_VERSION = `${major}.${minor}.${patch + 2}`;
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import { ROOT, atomic } from '../server.mjs';
import { buildPackage, readPackage, RUNTIME_FILES, hash, validateTrust } from '../update/package.mjs';
import { UpdateEngine } from '../update/engine.mjs';
import { allowedURL, releaseURL, download } from '../update/download.mjs';
import { exportCode } from '../scripts/release.mjs';
import { CODE_FILES } from '../scripts/code-files.mjs';

const keys = generateKeyPairSync('ed25519');
const trust = { format: 'pharmacy-trust-1', repository: 'fictional-tests/program', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
const options = { repository: trust.repository, sequence: 10, privateKey: keys.privateKey };
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-update-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function mutatePackage(bytes, change) { const p = JSON.parse(Buffer.from(JSON.parse(bytes).payload, 'base64')); change(p); const raw = Buffer.from(JSON.stringify(p)); return Buffer.from(JSON.stringify({ payload: raw.toString('base64'), signature: sign(null, raw, keys.privateKey).toString('base64') })); }
function release(version = NEXT_VERSION, sequence = 11, root = ROOT) {
  return mutatePackage(buildPackage(root, options), p => {
    p.version = version; p.sequence = sequence;
    for (const f of p.files) if (['package.json', 'public/version.js', 'public/sw.js'].includes(f.path)) {
      const b = Buffer.from(Buffer.from(f.content, 'base64').toString().replaceAll(APP_VERSION, version));
      Object.assign(f, { size: b.length, sha256: hash(b), content: b.toString('base64') });
    }
  });
}
test('signed package verifies; wrong key and tampering fail closed', () => {
  const bytes = buildPackage(ROOT, options);
  assert.equal(readPackage(bytes, trust).version, APP_VERSION);
  const altered = JSON.parse(bytes); const raw = Buffer.from(altered.payload, 'base64'); raw[25] ^= 1; altered.payload = raw.toString('base64');
  assert.throws(() => readPackage(Buffer.from(JSON.stringify(altered)), trust), /簽章/);
  const wrong = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.throws(() => readPackage(bytes, { ...trust, publicKey: wrong }), /簽章/);
  assert.throws(() => validateTrust({ ...trust, repository: '../private' }));
});
test('even signed packages cannot change data schema, add paths, repeat paths or lie about hashes', () => {
  const bytes = buildPackage(ROOT, options);
  for (const change of [p => p.dataSchema = 3, p => p.bootstrap = 2, p => p.repository = 'another/repo', p => p.files[0].path = '../snapshot.json', p => p.files[0].path = 'customer-data/leak.csv', p => p.files[0].path = p.files[1].path, p => p.files[0].sha256 = 'a'.repeat(64), p => p.version = '1.9.9']) assert.throws(() => readPackage(mutatePackage(bytes, change), trust));
});
test('release exports only explicit code paths, excluding real customer artifacts and secrets', t => {
  const dir = temporary(t), destination = path.join(dir, 'pure-code');
  exportCode(ROOT, destination);
  const names = fs.readdirSync(destination, { recursive: true }).filter(n => fs.statSync(path.join(destination, n)).isFile()).sort();
  assert.deepEqual(names, [...CODE_FILES].sort());
  assert.equal(names.some(n => /customer-data|\.csv$|\.pem$|\.pharmabackup$|snapshot\.json|CS-Customer-Graph/.test(n)), false);
  assert.deepEqual(readPackage(buildPackage(destination, options), trust).files.map(f => f.path).sort(), [...RUNTIME_FILES].sort());
  assert.throws(() => exportCode(ROOT, destination), /不覆蓋/);
});
test('network source restrictions reject external redirects, insecure URLs and credentials', async () => {
  assert.equal(releaseURL(trust.repository), 'https://github.com/fictional-tests/program/releases/latest/download/PharmacyLocal.pharmaupdate');
  for (const u of ['http://github.com/a', 'https://github.com.evil.example/a', 'https://user:pass@github.com/a', 'https://127.0.0.1/x', 'https://github.com:8444/a', 'https://example.com/a']) {
    assert.equal(allowedURL(u), false); await assert.rejects(download(u));
  }
  assert.equal(allowedURL('https://release-assets.githubusercontent.com/path?signature=x'), true);
});
function fixture(t, { configured = true, failHealth = false } = {}) {
  const base = temporary(t), root = path.join(base, 'app'), dataDir = path.join(base, 'data');
  exportCode(ROOT, root); fs.mkdirSync(path.join(dataDir, 'updates'), { recursive: true });
  if (configured) atomic(path.join(dataDir, 'updates', 'trust.json'), trust);
  const original = { version: 7, envelope: { fictionalCiphertext: 'opaque; engine never decrypts' } };
  atomic(path.join(dataDir, 'snapshot.json'), original); atomic(path.join(dataDir, 'config.json'), { devices: ['keep-original-pairing'] });
  let ready = true, started = [], fetches = 0, stops = 0, cancelled = 0;
  let bytes = release();
  const lifecycle = { prepare: async () => ({ ready, waiting: ready ? 0 : 1 }), start: async (loc, opts) => { started.push({ loc, ...opts }); }, stop: async () => { stops++; }, health: async () => { if (failHealth) throw new Error('fictional failed startup'); }, promote: async () => {}, cancel: async () => { cancelled++; } };
  const args = { root, dataDir, lifecycle, fetchPackage: async () => { fetches++; return bytes; } };
  return { root, dataDir, args, engine: new UpdateEngine(args), original, setReady: v => ready = v, setBytes: b => bytes = b, counters: () => ({ started, fetches, stops, cancelled }) };
}
test('unconfigured and paused updaters make no outbound request', async t => {
  const f = fixture(t, { configured: false }); await f.engine.check(); assert.equal(f.counters().fetches, 0);
  const g = fixture(t); await g.engine.pause(true); await g.engine.check(); assert.equal(g.counters().fetches, 0);
});
test('busy clients defer activation; atomic switch preserves data/pairing and has independent checkpoint', async t => {
  const f = fixture(t); f.setReady(false); await f.engine.check(); await f.engine.apply();
  assert.equal(f.engine.info().phase, 'waiting'); assert.equal(f.counters().stops, 0);
  f.setReady(true); await f.engine.tick();
  assert.equal(f.engine.version(), NEXT_VERSION); assert.equal(f.engine.state.previous, 'base');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dataDir, 'snapshot.json'))), f.original);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dataDir, 'config.json'))), { devices: ['keep-original-pairing'] });
  assert.equal(fs.readdirSync(path.join(f.dataDir, 'updates')).filter(n => n.startsWith('before-')).length, 1);
  await f.engine.rollback(); await f.engine.tick(); assert.equal(f.engine.version(), APP_VERSION); assert.equal(f.engine.state.paused, true);
});
test('failed startup restores previous code, not previous data, and pauses automatic retry', async t => {
  const f = fixture(t, { failHealth: true }); await f.engine.check(); await f.engine.apply();
  assert.equal(f.engine.version(), APP_VERSION); assert.equal(f.engine.state.paused, true); assert.equal(f.counters().started.length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dataDir, 'snapshot.json'))), f.original);
  assert.equal(f.engine.state.maxSequence, 11);
});
test('interrupted activation is recovered conservatively and replayed older sequences cannot install', async t => {
  const f = fixture(t); await f.engine.check(); await f.engine.apply();
  const saved = structuredClone(f.engine.state);
  saved.pending = { from: 'base', to: saved.current, version: NEXT_VERSION };
  atomic(f.engine.file, saved);
  const recovered = new UpdateEngine(f.args); assert.equal(recovered.version(), APP_VERSION); assert.equal(recovered.state.paused, true);
  await recovered.pause(false); await recovered.check(); assert.equal(recovered.candidate, null);
});
test('a modified staged executable is rejected on next launch', async t => {
  const f = fixture(t); await f.engine.check(); await f.engine.apply();
  fs.appendFileSync(path.join(f.engine.location(f.engine.state.current), 'server.mjs'), '\n// unauthorized edit');
  assert.throws(() => f.engine.checkedLocation(), /已變更/);
});
test('a full state disk still cancels maintenance and leaves the old service usable', async t => {
  const f = fixture(t); await f.engine.check();
  f.engine.save = () => { throw new Error('simulated full disk'); };
  await f.engine.apply();
  assert.equal(f.engine.version(), APP_VERSION); assert.equal(f.counters().cancelled, 1); assert.equal(f.counters().stops, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dataDir, 'snapshot.json'))), f.original);
});
