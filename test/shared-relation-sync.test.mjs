import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import * as c from '../public/core.js';
import { createService, atomic } from '../server.mjs';
import { makeCertificates } from '../scripts/setup.mjs';
import { makeUnmappedFixture, mappingInput, auditBundle } from './qa/shared-relation-fixture.mjs';

// Two independent HTTPS clients and encrypted bundles, not two physical devices.
// All identities, notes, approvals, dates, keys, certificates and files are synthetic.
const record = (bundle, id) => c.project(bundle).find(row => row.type === 'store' && row.id === 'qa-shared-' + id);
const card = (bundle, id) => record(bundle, id).preVisitInsights.entries.find(entry => entry.id === 'qa-shared-relation-' + id);
const effective = (bundle, id) => c.insightSharedReviewForEntry(bundle, 'qa-shared-' + id, card(bundle, id));
const review = (bundle, id, status, device) => c.applyInsightReview(bundle, c.planInsightReview(bundle, 'qa-shared-' + id, card(bundle, id).id, status, record(bundle, id).heads[0].id), device);

async function assertProtected(original, next) {
  const audit = await auditBundle(c, next, original);
  for (const field of ['originalOpsPreserved', 'originalBlobsPreserved', 'visitOpsUnchanged', 'sourceOpsUnchanged', 'attendanceUnchanged', 'originalReviewEventsPreserved', 'currentNonRelationAndReviewStoreDataUnchanged', 'reviewEventIdsUnique']) assert.equal(audit[field], true, field);
  return audit;
}

test('shared relation mapping encrypts and restores without changing notes, sources, attendance or review events', async () => {
  const original = await makeUnmappedFixture(c), before = structuredClone(original), input = mappingInput(c, original), plan = c.planStoreInsightRelations(original, input);
  const mapped = c.applyStoreInsightRelations(original, input, plan, 'synthetic-mapper');
  assert.deepEqual(original, before);
  const audit = await assertProtected(original, mapped);
  assert.equal(audit.reviewEventsAfter, audit.reviewEventsBefore);
  assert.equal(mapped.ops.length, original.ops.length + 3, 'Only the three mapped stores gain metadata revisions');
  for (const id of ['a', 'b', 'c']) {
    const { preVisitInsightRelations, ...otherData } = record(mapped, id).heads[0].data;
    assert.equal(preVisitInsightRelations.length, 1);
    assert.deepEqual(otherData, record(original, id).heads[0].data, 'Mapping adds only the relation metadata field');
  }
  for (const id of ['a', 'b', 'c']) assert.equal(effective(mapped, id).status, 'confirmed');
  assert.equal(c.insightReviewForEntry(record(mapped, 'b'), card(mapped, 'b')).status, 'pending', 'Shared confirmation does not fabricate a local review event');
  assert.equal(c.insightReviewForEntry(record(mapped, 'c'), card(mapped, 'c')).status, 'pending');
  assert.equal(record(mapped, 'd').heads[0].id, record(original, 'd').heads[0].id, 'Unmapped same-ID card is untouched');
  const meta = c.newMeta(); meta.vaultId = mapped.vaultId; const key = await c.derive('synthetic-shared-backup-password', meta);
  const backup = { format: 'pharmacy-backup-1', envelope: await c.seal(mapped, key, meta) };
  assert.ok(!JSON.stringify(backup).includes('林測試'));
  const reopened = await c.unseal(backup.envelope, key), fresh = await c.planBackupImport(null, reopened), combined = await c.planBackupImport(original, reopened);
  assert.deepEqual(fresh.bundle, mapped); assert.deepEqual(combined.bundle, c.merge(original, mapped));
  await assertProtected(original, fresh.bundle); await assertProtected(original, combined.bundle);
  assert.equal((await c.planBackupImport(mapped, reopened)).summary.addedRevisions, 0);
  for (const id of ['a', 'b', 'c']) assert.equal(effective(fresh.bundle, id).status, 'confirmed');
});

test('two real HTTPS clients sync shared confirmations and preserve divergent local reviews through CAS and encrypted server backups', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-shared-relation-sync-'));
  let service;
  t.after(() => { if (service) { service.server.closeAllConnections(); service.server.close(); } fs.rmSync(dir, { recursive: true, force: true }); });
  makeCertificates(dir, 'synthetic-shared-relation.local');
  const admin = 'synthetic-shared-relation-admin-token';
  atomic(path.join(dir, 'config.json'), { hostname: 'synthetic-shared-relation.local', port: 8443, adminToken: admin, devices: [] });
  service = createService({ dataDir: dir, host: '127.0.0.1', port: 0 });
  const address = await service.listen(), ca = fs.readFileSync(path.join(dir, 'tls', 'ca.crt'));
  const request = (route, method = 'GET', body, token) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', servername: 'localhost', port: address.port, path: route, method, ca,
      headers: { Host: `localhost:${address.port}`, Origin: `https://localhost:${address.port}`, 'Content-Type': 'application/json', 'X-Pharmacy-Client': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(text) }); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const pair = async label => {
    const code = await request('/api/admin/code', 'POST', {}, admin); assert.equal(code.status, 200);
    const paired = await request('/api/pair', 'POST', { code: code.body.code, label }); assert.equal(paired.status, 200); return paired.body;
  };
  const clientA = await pair('Synthetic client A'), clientB = await pair('Synthetic client B');
  assert.notEqual(clientA.id, clientB.id); assert.notEqual(clientA.token, clientB.token);
  const original = await makeUnmappedFixture(c), meta = c.newMeta(); meta.vaultId = original.vaultId;
  const keyA = await c.derive('synthetic-shared-HTTPS-password', meta), keyB = await c.derive('synthetic-shared-HTTPS-password', meta);
  const put = async (bundle, version, client, key) => request('/api/snapshot', 'PUT', { expectedVersion: version, envelope: await c.seal(bundle, key, meta) }, client.token);
  assert.equal((await put(original, 0, clientA, keyA)).status, 200);
  const initialB = await request('/api/snapshot', 'GET', undefined, clientB.token); assert.equal(initialB.status, 200);
  const independentB = await c.unseal(initialB.body.envelope, keyB); assert.deepEqual(independentB, original);
  const input = mappingInput(c, original), mapped = c.applyStoreInsightRelations(original, input, c.planStoreInsightRelations(original, input), clientA.id);
  const mappingSaved = await put(mapped, 1, clientA, keyA); assert.equal(mappingSaved.status, 200); assert.equal(mappingSaved.body.version, 2); assert.equal(mappingSaved.body.backupOK, true);
  const mappedSnapshot = await request('/api/snapshot', 'GET', undefined, clientB.token);
  const mappedOnB = await c.unseal(mappedSnapshot.body.envelope, keyB); assert.deepEqual(mappedOnB, mapped);
  for (const id of ['a', 'b', 'c']) assert.equal(effective(mappedOnB, id).status, 'confirmed');
  await assertProtected(original, mappedOnB);

  // Both clients now act on the same store from version 2, producing two explicit
  // LOCAL decisions. A 409 must not cause either decision or old evidence to vanish.
  const rejectedOnB = review(mappedOnB, 'b', 'rejected', clientB.id);
  const pendingOnA = review(mapped, 'b', 'pending', clientA.id);
  assert.equal(rejectedOnB.ops.length, mapped.ops.length + 1); assert.equal(pendingOnA.ops.length, mapped.ops.length + 1);
  assert.equal(effective(rejectedOnB, 'b').status, 'rejected'); assert.equal(effective(pendingOnA, 'b').status, 'pending');
  assert.equal(effective(rejectedOnB, 'a').status, 'confirmed');
  assert.equal(effective(rejectedOnB, 'c').status, 'pending', 'A disagreement blocks inheritance to an unreviewed third store');
  assert.ok(effective(rejectedOnB, 'c').sharedConflict);
  const savedB = await put(rejectedOnB, 2, clientB, keyB); assert.equal(savedB.status, 200); assert.equal(savedB.body.version, 3);
  const staleA = await put(pendingOnA, 2, clientA, keyA); assert.equal(staleA.status, 409);
  const latest = await request('/api/snapshot', 'GET', undefined, clientA.token), remote = await c.unseal(latest.body.envelope, keyA);
  const joined = c.merge(pendingOnA, remote);
  assert.equal(record(joined, 'b').conflict, true); assert.equal(record(joined, 'b').heads.length, 2);
  assert.equal(effective(joined, 'b').status, 'pending', 'No conflict branch may silently become confirmed');
  const bHistory = c.storeInsightReviewHistory(record(joined, 'b')).filter(event => event.entry.id === 'qa-shared-relation-b');
  assert.deepEqual(new Set(bHistory.map(event => event.status)), new Set(['pending', 'rejected']));
  assert.equal(joined.ops.length, mapped.ops.length + 2);
  await assertProtected(original, joined); await assertProtected(mapped, joined);
  const entityOps = (bundle, entity) => bundle.ops.filter(op => op.entity === entity).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(entityOps(joined, 'qa-shared-a'), entityOps(mapped, 'qa-shared-a'));
  assert.deepEqual(entityOps(joined, 'qa-shared-c'), entityOps(mapped, 'qa-shared-c'));
  assert.equal((await put(joined, 3, clientA, keyA)).status, 200);
  const received = await request('/api/snapshot', 'GET', undefined, clientB.token); assert.equal(received.body.version, 4);
  assert.deepEqual(await c.unseal(received.body.envelope, keyB), joined);

  const disk = fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'); assert.ok(!disk.includes('林測試')); assert.ok(!disk.includes('虛構青禾'));
  const backups = fs.readdirSync(path.join(dir, 'backups')).filter(name => name.endsWith('.pharmabackup')).sort(); assert.equal(backups.length, 4);
  for (const [index, expected] of [original, mapped, rejectedOnB, joined].entries()) {
    const filename = backups.find(name => name.endsWith(`-v${index + 1}.pharmabackup`));
    assert.ok(filename, `Server version ${index + 1} must have its own encrypted backup`);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'backups', filename), 'utf8'));
    const recovered = await c.planBackupImport(null, await c.unseal(saved.envelope, keyB));
    assert.deepEqual(recovered.bundle, expected, `Backup ${index + 1} must restore its exact version`);
    await assertProtected(original, recovered.bundle);
  }
  const savedBackup = JSON.parse(fs.readFileSync(path.join(dir, 'backups', backups.at(-1)), 'utf8'));
  const restored = await c.planBackupImport(null, await c.unseal(savedBackup.envelope, keyB));
  assert.deepEqual(restored.bundle, joined); await assertProtected(original, restored.bundle);
  assert.equal(record(restored.bundle, 'b').heads.length, 2);
  assert.equal(c.storeInsightReviewHistory(record(restored.bundle, 'b')).filter(event => event.entry.id === 'qa-shared-relation-b').length, 2);
  assert.equal(fs.statSync(path.join(dir, 'snapshot.json')).mode & 0o777, 0o600);
});
