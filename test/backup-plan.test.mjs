import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planBackupImport, emptyBundle, revision, project, merge, newMeta, derive, seal, unseal,
  hashBytes, b64, unb64, convertReminderTasks, completeReminderTask, reminderTaskHistory
} from '../public/core.js';

// Only synthetic fixtures. No actual customer notes, backups or source files.
const storeData = { name: 'Synthetic backup store', city: '', district: '', channel: '', attr: '', contact: '', nextRemember: '  Task A\r\nTask B  ' };
const visitData = { store: 's', date: '', text: 'Synthetic original\r\nPreserve exact whitespace  ', next: '', source: 'synthetic', topics: [], people: [], attachments: [] };
const createdAt = '2026-10-01T01:00:00.000Z', completedAt = '2026-10-02T02:00:00.000Z';
function fixture(vaultId = 'synthetic-backup-vault') {
  const b = emptyBundle(vaultId); b.ops.push(revision('store', 's', storeData, [], 'synthetic')); return b;
}
const record = (b, id = 's') => project(b).find(r => r.id === id);

test('backup plans are deeply immutable, isolated from caller mutation and create no revisions', async () => {
  const current = fixture(), incoming = structuredClone(current), parent = incoming.ops[0];
  incoming.ops.push(revision('store', 's', { ...parent.data, contact: 'Synthetic updated contact' }, [parent.id], 'other'));
  const currentBefore = structuredClone(current), incomingBefore = structuredClone(incoming);
  const pending = planBackupImport(current, incoming);
  incoming.ops[1].data.contact = 'mutation after call';
  const plan = await pending;
  assert.deepEqual(current, currentBefore);
  assert.deepEqual(plan.bundle.ops.find(op => op.id === incomingBefore.ops[1].id), incomingBefore.ops[1]);
  assert.equal(plan.bundle.ops.length, incomingBefore.ops.length);
  assert.equal(plan.summary.addedRevisions, 1); assert.equal(plan.summary.identicalRevisions, 1);
  assert.equal(plan.summary.changedExistingEntities, 1); assert.equal(plan.changes[0].kind, 'heads-changed');
  assert.equal(plan.summary.before.active.store, 1); assert.equal(plan.summary.after.active.store, 1);
  for (const item of [plan, plan.bundle, plan.bundle.ops, plan.bundle.ops[0].data, plan.summary, plan.changes, plan.changes[0].beforeHeads]) assert.ok(Object.isFrozen(item));
  assert.throws(() => { plan.bundle.ops[0].data.name = 'tamper'; }, TypeError);
  assert.throws(() => { plan.changes[0].afterHeads.push(parent); }, TypeError);
  assert.equal(Object.isFrozen(current), false); assert.equal(Object.isFrozen(incoming), false);
});

test('same and older backups are no-ops, preserve tombstones and do not create replacement versions', async () => {
  const old = fixture(), current = structuredClone(old);
  current.ops.push(revision('store', 's', current.ops[0].data, [current.ops[0].id], 'synthetic', true));
  for (const incoming of [old, current]) {
    const plan = await planBackupImport(current, incoming);
    assert.equal(plan.summary.hasChanges, false); assert.equal(plan.summary.addedRevisions, 0);
    assert.equal(plan.summary.changedExistingEntities, 0); assert.equal(plan.changes.length, 0);
    assert.equal(record(plan.bundle).deleted, true); assert.equal(plan.bundle.ops.length, 2);
  }
});

test('schema 1 is readable and a schema-only upgrade is visible, including empty restores', async () => {
  const legacy = fixture(); legacy.schema = 1;
  const restored = await planBackupImport(null, legacy);
  assert.equal(restored.summary.mode, 'restore'); assert.equal(restored.summary.hasChanges, true);
  assert.equal(restored.bundle.schema, 1); assert.equal(restored.summary.newEntities.store, 1);
  const current = structuredClone(legacy); current.schema = 2;
  const upgraded = await planBackupImport(legacy, current);
  assert.equal(upgraded.summary.hasChanges, true); assert.equal(upgraded.summary.addedRevisions, 0);
  assert.deepEqual(upgraded.changes, []); assert.equal(upgraded.bundle.schema, 2);
  assert.equal((await planBackupImport(current, legacy)).summary.hasChanges, false);
  assert.equal((await planBackupImport(null, emptyBundle('synthetic-empty'))).summary.hasChanges, true);
});

test('deletions, revivals and competing edits have explicit per-entity implications', async () => {
  const base = fixture(), deleted = structuredClone(base), edited = structuredClone(base);
  deleted.ops.push(revision('store', 's', base.ops[0].data, [base.ops[0].id], 'phone', true));
  edited.ops.push(revision('store', 's', { ...base.ops[0].data, contact: 'other change' }, [base.ops[0].id], 'mac'));
  const deletionPlan = await planBackupImport(base, deleted);
  assert.equal(deletionPlan.summary.movedToTrash, 1); assert.equal(deletionPlan.changes[0].afterDeleted, true);
  const conflictPlan = await planBackupImport(deleted, edited);
  assert.equal(conflictPlan.summary.newConflicts, 1); assert.equal(conflictPlan.summary.conflictsAfter, 1);
  assert.equal(conflictPlan.changes[0].afterHeads.length, 2); assert.equal(conflictPlan.changes[0].afterConflict, true);
  const resolved = structuredClone(conflictPlan.bundle), conflicted = record(resolved);
  resolved.ops.push(revision('store', 's', { ...base.ops[0].data, contact: 'explicit synthetic resolution' }, conflicted.heads.map(h => h.id), 'test'));
  const resolutionPlan = await planBackupImport(conflictPlan.bundle, resolved);
  assert.equal(resolutionPlan.summary.resolvedConflicts, 1); assert.equal(resolutionPlan.summary.conflictsAfter, 0);
  const revival = structuredClone(deleted);
  revival.ops.push(revision('store', 's', base.ops[0].data, [deleted.ops.at(-1).id], 'test'));
  const revivalPlan = await planBackupImport(deleted, revival);
  assert.equal(revivalPlan.summary.revived, 1); assert.equal(revivalPlan.changes[0].beforeDeleted, true);
  assert.equal(revivalPlan.changes[0].afterDeleted, false);
});

test('encrypted backup planning retains tasks, completion history, source snapshots, attachments and exact notes', async () => {
  const meta = newMeta(), key = await derive('synthetic-backup-only-password', meta), b = fixture(meta.vaultId), base = b.ops[0];
  const csvBytes = new TextEncoder().encode('name,note\r\nSynthetic,exact source\r\n');
  const csvBlob = await hashBytes(csvBytes); b.blobs[csvBlob] = b64(csvBytes);
  const imageBytes = new Uint8Array([0, 1, 2, 3, 255]), imageBlob = await hashBytes(imageBytes); b.blobs[imageBlob] = b64(imageBytes);
  const source = revision('source', 'source', { file: 'synthetic.csv', list: 'synthetic', blob: csvBlob, batch: 'batch', rows: 1, headers: ['name', 'note'], encoding: 'utf-8', delimiter: ',' }, [], 'test');
  const converted = revision('store', 's', convertReminderTasks(base.data, createdAt), [base.id], 'test');
  const done = revision('store', 's', completeReminderTask(converted.data, converted.data.nextRememberTasks[0].id, completedAt), [converted.id], 'test');
  const restoredStore = revision('store', 's', base.data, [done.id], 'test');
  const person = revision('person', 'p', { name: 'Synthetic person', role: '', desc: '', sameAs: '', confirmed: false }, [], 'test');
  const topic = revision('topic', 't', { name: 'Synthetic topic', desc: '' }, [], 'test');
  const visit = revision('visit', 'v', { ...visitData, people: ['p'], topics: ['t'], attachments: [{ blob: imageBlob, name: 'synthetic.bin', mime: 'application/octet-stream' }], csvSources: [{ file: 'synthetic.csv', fingerprint: csvBlob, batch: 'batch', list: 'synthetic', at: createdAt, blob: csvBlob, sourceSnapshot: 'source', line: 2, headers: ['name', 'note'], cells: ['Synthetic', 'exact source'] }] }, [], 'test');
  b.ops.push(source, converted, done, restoredStore, person, topic, visit);
  const encrypted = await seal(b, key, meta), decrypted = await unseal(encrypted, key);
  const restorePlan = await planBackupImport(null, decrypted);
  assert.deepEqual(restorePlan.bundle, b); assert.deepEqual(restorePlan.summary.warnings, []);
  assert.equal(restorePlan.summary.newBlobs, 2); assert.equal(restorePlan.summary.after.active.source, 1);
  assert.equal(restorePlan.summary.after.active.visit, 1); assert.equal(restorePlan.summary.after.revisions, 8);
  assert.deepEqual(unb64(restorePlan.bundle.blobs[csvBlob]), csvBytes); assert.deepEqual(unb64(restorePlan.bundle.blobs[imageBlob]), imageBytes);
  assert.deepEqual(restorePlan.bundle.ops.find(op => op.id === visit.id), visit);
  assert.equal(reminderTaskHistory(record(restorePlan.bundle))[0].completedAt, completedAt);
  assert.equal(reminderTaskHistory(record(restorePlan.bundle))[0].historical, true);
  assert.equal(restorePlan.bundle.ops.find(op => op.id === converted.id).data.nextRememberImports[0].text, base.data.nextRemember);
  const current = fixture(meta.vaultId); current.ops = [structuredClone(base)];
  const mergePlan = await planBackupImport(current, decrypted);
  assert.deepEqual(mergePlan.bundle, merge(current, b)); assert.equal(mergePlan.summary.addedRevisions, 7);
  assert.deepEqual(await unseal(await seal(mergePlan.bundle, key, meta), key), mergePlan.bundle);
});

test('concurrent task completions stay separate and all completion history remains inspectable', async () => {
  const b = fixture(); b.ops[0].data = convertReminderTasks(b.ops[0].data, createdAt);
  const phone = structuredClone(b), mac = structuredClone(b), [a, z] = b.ops[0].data.nextRememberTasks;
  phone.ops.push(revision('store', 's', completeReminderTask(b.ops[0].data, a.id, completedAt), [b.ops[0].id], 'phone'));
  mac.ops.push(revision('store', 's', completeReminderTask(b.ops[0].data, z.id, completedAt), [b.ops[0].id], 'mac'));
  const plan = await planBackupImport(phone, mac), store = record(plan.bundle);
  assert.equal(plan.summary.newConflicts, 1); assert.equal(store.heads.length, 2);
  assert.deepEqual(new Set(reminderTaskHistory(store).map(task => task.id)), new Set([a.id, z.id]));
  assert.equal(plan.bundle.ops.length, 3);
});

test('missing legacy relationship targets warn without rewriting otherwise valid historical notes', async () => {
  const b = fixture(); b.ops.push(revision('visit', 'legacy', { ...visitData, store: 'missing-store', people: ['missing-person'], topics: ['missing-topic'] }, [], 'test'));
  const before = structuredClone(b), plan = await planBackupImport(null, b);
  assert.equal(plan.summary.warnings.length, 3); assert.deepEqual(plan.bundle, before); assert.deepEqual(b, before);
  assert.deepEqual(new Set(plan.summary.warnings.map(w => w.targetType)), new Set(['store', 'person', 'topic']));
  assert.ok(plan.summary.warnings.every(w => w.code === 'missing-reference' && w.entity === 'legacy' && w.revisionIds.length === 1));
});

test('malformed graphs, tasks, source history and wrong blob bytes reject the whole plan without mutation', async () => {
  const good = fixture(), image = new Uint8Array([1, 2, 3]), hash = await hashBytes(image);
  good.blobs[hash] = b64(image);
  const original = structuredClone(good);
  const variants = [
    b => { b.blobs[hash] = b64(new Uint8Array([3, 2, 1])); },
    b => { b.blobs[hash] = 'A'; },
    b => { b.ops[0].parents = ['missing']; },
    b => { b.ops[0].data.nextRememberTasks = [{ id: 'x', text: 'Synthetic task', createdAt, completedAt: 'invalid' }]; },
    b => { b.ops.push(revision('visit', 'v', { ...visitData, attachments: [{ blob: '0'.repeat(64), name: 'missing', mime: '' }] }, [], 'test')); },
    b => { b.ops.push(revision('source', 'source', { file: 'synthetic.csv', list: '', blob: hash, batch: 'batch', rows: 0, headers: [], encoding: 'utf-8', delimiter: ',' }, [], 'test', true)); }
  ];
  for (const mutate of variants) {
    const invalid = structuredClone(good); mutate(invalid); const snapshot = structuredClone(invalid);
    await assert.rejects(planBackupImport(good, invalid)); assert.deepEqual(invalid, snapshot); assert.deepEqual(good, original);
  }
  const changedId = structuredClone(good); changedId.ops[0].data.name = 'same id different contents';
  await assert.rejects(planBackupImport(good, changedId), /相同版本/);
  await assert.rejects(planBackupImport(good, fixture('foreign-vault')), /不同的資料庫/);
});
