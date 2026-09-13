import test from 'node:test';
import assert from 'node:assert/strict';
import { newMeta, derive, seal, unseal, emptyBundle, revision, merge, project, validateBundle, hashBytes, b64 } from '../public/core.js';
const store = { name: '虛構門市 A', city: '臺北市', district: '大安區', channel: '獨立', attr: '親子', contact: '虛構藥師' };
const fixture = () => { const b = emptyBundle('test-vault'); b.ops.push(revision('store', 's1', store, [], 'mac')); return b; };
test('AES-GCM round trip, randomized nonce, wrong password, tampering and purpose isolation', async () => {
  const meta = newMeta(), key = await derive('a-test-password-1234', meta), b = fixture(); b.vaultId = meta.vaultId;
  const e = await seal(b, key, meta), second = await seal(b, key, meta);
  assert.notEqual(e.iv, second.iv); assert.notEqual(e.ciphertext, second.ciphertext);
  assert.deepEqual(await unseal(e, key), b); assert.ok(!JSON.stringify(e).includes(store.contact));
  await assert.rejects(unseal(e, await derive('wrong-password-1234', meta)));
  await assert.rejects(unseal({ ...e, ciphertext: (e.ciphertext[0] === 'A' ? 'B' : 'A') + e.ciphertext.slice(1) }, key));
  await assert.rejects(unseal(e, key, 'device'));
  await assert.rejects(unseal({ ...e, vaultId: 'other' }, key));
});
test('disjoint offline additions converge and retries are idempotent', () => {
  const a = fixture(), b = structuredClone(a);
  a.ops.push(revision('store', 's2', { ...store, name: 'A' }, [], 'phone'));
  b.ops.push(revision('store', 's3', { ...store, name: 'B' }, [], 'mac'));
  const ab = merge(a, b); assert.deepEqual(ab, merge(b, a)); assert.deepEqual(ab, merge(ab, a)); assert.equal(project(ab).length, 3);
});
test('concurrent edits preserve both heads; explicit resolution converges', () => {
  const a = fixture(), b = structuredClone(a), parent = a.ops[0].id;
  a.ops.push(revision('store', 's1', { ...store, name: 'phone change' }, [parent], 'phone'));
  b.ops.push(revision('store', 's1', { ...store, name: 'mac change' }, [parent], 'mac'));
  const joined = merge(a, b), r = project(joined)[0]; assert.equal(r.conflict, true); assert.equal(r.heads.length, 2);
  joined.ops.push(revision('store', 's1', { ...store, name: 'resolved' }, r.heads.map(h => h.id), 'mac'));
  assert.equal(project(merge(joined, a))[0].conflict, false); assert.equal(project(joined)[0].versions.length, 4);
});
test('delete vs edit remains conflict; old backup never resurrects a deleted record', () => {
  const original = fixture(), a = structuredClone(original), b = structuredClone(original);
  a.ops.push(revision('store', 's1', store, [a.ops[0].id], 'phone', true));
  assert.equal(project(merge(a, original))[0].deleted, true);
  b.ops.push(revision('store', 's1', { ...store, contact: 'new' }, [b.ops[0].id], 'mac'));
  const combined = merge(a, b); assert.equal(project(combined)[0].conflict, true);
});
test('same-name people remain separate until explicit linking', () => {
  const b = emptyBundle('people'); for (const id of ['p1', 'p2']) b.ops.push(revision('person', id, { name: '測試稱呼', role: '', desc: '', confirmed: false, sameAs: '' }, [], 'mac'));
  assert.equal(project(b).length, 2);
});
test('malformed graphs, changed revision IDs and foreign vault imports are rejected', () => {
  const a = fixture(), b = structuredClone(a); b.ops[0].data.name = 'tampered'; assert.throws(() => merge(a, b));
  assert.throws(() => merge(a, emptyBundle('different')));
  const bad = fixture(); bad.ops[0].parents = ['missing']; assert.throws(() => validateBundle(bad));
  const cycle = fixture(); cycle.ops.push(revision('store', 's1', store, [cycle.ops[0].id], 'phone')); cycle.ops[0].parents = [cycle.ops[1].id]; assert.throws(() => validateBundle(cycle));
});
test('attachments merge with history and missing bytes fail closed', async () => {
  const a = fixture(), bytes = new TextEncoder().encode('fake-photo-bytes'), hash = await hashBytes(bytes); a.blobs[hash] = b64(bytes);
  a.ops.push(revision('visit', 'v1', { store: 's1', date: '2026-09-12', source: '現場觀察', text: 'fake', next: '', topics: [], people: [], attachments: [{ blob: hash, name: 'demo.png', mime: 'image/png' }] }, [], 'phone'));
  assert.equal(project(merge(a, fixture())).length, 2);
  const bad = structuredClone(a); delete bad.blobs[hash]; assert.throws(() => validateBundle(bad));
});
