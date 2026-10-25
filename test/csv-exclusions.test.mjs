import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, project, revision, validateBundle, csvExclusionIdentity, b64, merge, createRecoveryBackup, derive, unseal, planBackupImport } from '../public/core.js';
import { prepareCSV, planCSV, buildCSVImport, sop1Report, csvExclusionList, mapKey } from '../public/csv.js';

// Synthetic places and passwords only; never reads production data or files.
const encode = text => new TextEncoder().encode(text);
const url = id => `https://maps.google.com/?cid=${id}`;
const row = (name = '虛構甲藥局', id = '88001', note = '  原文\r\n第二行  ', address = '臺北市虛構甲路1號') => [name, note, url(id), address, '未採用補充'];
const csv = rows => ['Title,Note,URL,Address,Other', ...rows.map(cells => cells.map(value => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\r\n');
const file = (rows, name = '虛構清單.csv') => prepareCSV(name, encode(csv(rows)));
const records = (bundle, type) => project(bundle).filter(item => item.type === type);
const statuses = plan => plan.rows.map(item => item.newStoreOnly.status);
async function preview(bundle, rows = [row()], name) { return planCSV([await file(rows, name)], bundle, { mode: 'new-only' }); }
async function exclude(bundle, rows = [row()], indexes = rows.map((_, i) => i), name) {
  const plan = await preview(bundle, rows, name); for (const index of indexes) plan.rows[index].choice = 'exclude';
  return buildCSVImport(plan, bundle, 'synthetic-mac');
}
async function revoke(bundle, ids = csvExclusionList(bundle).map(item => item.id), rows = [row()]) {
  const plan = await preview(bundle, rows); plan.revokeExclusionIds = ids; return buildCSVImport(plan, bundle, 'synthetic-phone');
}
function assertPreserved(before, after) {
  assert.deepEqual(after.ops.slice(0, before.ops.length), before.ops);
  for (const [key, data] of Object.entries(before.blobs)) assert.equal(after.blobs[key], data);
  const ids = new Set(before.ops.map(item => item.entity));
  assert.ok(after.ops.slice(before.ops.length).every(item => !ids.has(item.entity) && !item.deleted && !item.parents.length));
  for (const type of ['store', 'visit']) assert.deepEqual(records(after, type).filter(item => ids.has(item.id)), records(before, type));
  validateBundle(after);
}

test('unchecked remains pending while an explicit exclusion persists with all original bytes and no derived records', async () => {
  const base = emptyBundle('exclude-pending'), rows = [row(), row('虛構乙藥局', '88002', '乙原文', '臺北市虛構乙路2號')];
  const sourceOnly = buildCSVImport(await preview(base, rows), base, 'synthetic').bundle;
  assert.deepEqual(csvExclusionList(sourceOnly), []); assert.deepEqual(statuses(await preview(sourceOnly, rows)), ['new', 'new']);
  const result = await exclude(sourceOnly, rows, [0]);
  assert.equal(result.summary.excludedPlaces, 1); assert.equal(result.summary.stores, 0); assert.equal(result.summary.notes, 0);
  assert.equal(result.summary.sourceSnapshots, 1); assert.equal(result.summary.auditSnapshots, 0);
  assert.equal(records(result.bundle, 'store').length, 0); assert.equal(records(result.bundle, 'visit').length, 0);
  assert.equal(records(result.bundle, 'source').at(-1).rows, 2);
  const source = records(result.bundle, 'source').at(-1); assert.equal(result.bundle.blobs[source.blob], b64(encode(csv(rows))));
  assert.equal(source.csvExclusionEvents[0].line, 2);
  assert.deepEqual(statuses(await preview(result.bundle, rows)), ['remembered', 'new']);
  assertPreserved(sourceOnly, result.bundle);
});

test('notes/list/normalization changes retain exact memory; name/address/stable identifier changes resurface for review', async () => {
  const base = (await exclude(emptyBundle('identity'))).bundle;
  const changedNote = row(); changedNote[1] = '後來的不同筆記';
  const normalized = row(' 虛構甲藥局 ', '00088001', '', '台北市虛構甲路1號');
  assert.deepEqual(statuses(await preview(base, [changedNote], '虛構另一清單.csv')), ['remembered']);
  assert.deepEqual(statuses(await preview(base, [normalized])), ['remembered']);
  for (const [column, value] of [[0, '虛構甲改名藥局'], [2, url('88099')], [3, '臺北市虛構搬遷路9號'], [3, '']]) {
    const incoming = row(); incoming[column] = value;
    const p = await preview(base, [incoming]); assert.deepEqual(statuses(p), ['review']);
    assert.equal(p.rows[0].newStoreOnly.exclusionIdentityChanged, true);
    p.rows[0].choice = 'new'; assert.throws(() => buildCSVImport(p, base, 'synthetic'), /新店候選/);
  }
  const unrelated = row('虛構完全另店', '88888', '', '臺北市虛構無關路8號');
  assert.deepEqual(statuses(await preview(base, [unrelated])), ['new']);
});

test('stable review/duplicate rows can be explicitly excluded without identity merge or note adoption', async () => {
  const base = emptyBundle('review-exclude'), first = row(), otherNote = row(); otherNote[1] = '同地點不同清單的文字';
  const restaurant = row('虛構不需要餐廳', '88222', '', '臺北市虛構餐廳路2號');
  const restaurantPlan = await preview(base, [restaurant]); assert.deepEqual(statuses(restaurantPlan), ['review']);
  restaurantPlan.rows[0].choice = 'exclude';
  const restaurantExcluded = buildCSVImport(restaurantPlan, base, 'synthetic').bundle;
  assert.deepEqual(statuses(await preview(restaurantExcluded, [restaurant])), ['remembered']);
  const p = await planCSV([await file([first], '虛構清單甲.csv'), await file([otherNote], '虛構清單乙.csv')], base, { mode: 'new-only' });
  assert.deepEqual(statuses(p), ['review', 'review']); assert.ok(p.rows.every(item => item.newStoreOnly.canExclude));
  p.rows.forEach(item => item.choice = 'exclude');
  const result = buildCSVImport(p, base, 'synthetic'); assert.equal(result.summary.excludedPlaces, 1); assert.equal(result.summary.sourceSnapshots, 2);
  assert.equal(result.summary.notes, 0); assert.equal(result.summary.adoptedSupplements, 0);
  assert.deepEqual(statuses(await preview(result.bundle, [first, otherNote])), ['remembered', 'remembered']);
  const duplicatePlan = await preview(base, [first, first]); assert.deepEqual(statuses(duplicatePlan), ['new', 'duplicate']);
  duplicatePlan.rows[1].choice = 'exclude'; const duplicateResult = buildCSVImport(duplicatePlan, base, 'synthetic');
  assert.equal(duplicateResult.summary.excludedPlaces, 1); assert.equal(csvExclusionList(duplicateResult.bundle).length, 1);
  duplicatePlan.rows[0].choice = 'new'; duplicatePlan.rows[0].sop1.extraAccepted = true;
  assert.throws(() => buildCSVImport(duplicatePlan, base, 'synthetic'), /同一精確地點/);
});

test('distinct branches sharing a name or address keep independent explicit exclusions', async () => {
  const base = emptyBundle('branches'), first = row(), branch = row('虛構甲藥局', '88003', '', '臺北市虛構分店路3號');
  const result = await exclude(base, [first, branch]); assert.equal(result.summary.excludedPlaces, 2);
  assert.deepEqual(statuses(await preview(result.bundle, [first, branch])), ['remembered', 'remembered']);
  const third = row('虛構別名藥局', '88004', '', first[3]);
  assert.deepEqual(statuses(await preview(result.bundle, [third])), ['review']);
  const afterThird = (await exclude(result.bundle, [third])).bundle;
  assert.deepEqual(statuses(await preview(afterThird, [first, branch, third])), ['remembered', 'remembered', 'remembered']);
  const renamed = row('虛構甲已改名', '88001', '', first[3]);
  const afterRename = (await exclude(afterThird, [renamed])).bundle;
  assert.deepEqual(statuses(await preview(afterRename, [first, renamed])), ['remembered', 'remembered']);
});

test('weak identities cannot be excluded and stable identity rules agree with CSV matching', async () => {
  for (const mapUrl of ['', 'https://maps.app.goo.gl/synthetic', 'https://www.google.com/maps?q=虛構藥局', 'http://maps.google.com/?cid=88001', 'https://evil.example/?cid=88001']) {
    const incoming = row(); incoming[2] = mapUrl;
    const base = emptyBundle('weak'), p = await preview(base, [incoming]);
    assert.equal(p.rows[0].newStoreOnly.canExclude, false); p.rows[0].choice = 'exclude';
    assert.throws(() => buildCSVImport(p, base, 'synthetic'), /穩定地點/);
  }
  for (const mapUrl of [url('00088001'), 'https://www.google.com/maps/?query_place_id=synthetic-place', 'https://www.google.com/maps?q=place_id:synthetic-place', 'https://www.google.com/maps/data=!1s0x123:0x456']) {
    assert.equal(csvExclusionIdentity({ name: '虛構', address: '', mapUrl }).mapKey, mapKey(mapUrl));
  }
  assert.equal(csvExclusionIdentity({ name: '', address: '', mapUrl: url('88001') }), null);
});

test('revoke appends a source audit, restores candidate on re-preview and preserves the original decision', async () => {
  const excluded = (await exclude(emptyBundle('revoke'))).bundle, original = records(excluded, 'source')[0];
  const p = await preview(excluded); p.revokeExclusionIds = [p.exclusions[0].id];
  assert.deepEqual(statuses(p), ['remembered']); p.rows[0].choice = 'new';
  assert.throws(() => buildCSVImport(p, excluded, 'synthetic'), /新店候選/); p.rows[0].choice = 'skip';
  const result = buildCSVImport(p, excluded, 'synthetic');
  assert.equal(result.summary.revokedExclusions, 1); assert.equal(result.summary.auditSnapshots, 1); assert.equal(result.summary.sourceSnapshots, 1);
  assert.deepEqual(csvExclusionList(result.bundle), []); assert.deepEqual(statuses(await preview(result.bundle)), ['new']);
  const audit = records(result.bundle, 'source').find(item => item.csvExclusionAuditOf);
  assert.equal(audit.csvExclusionAuditOf, original.id);
  for (const key of ['file', 'list', 'blob', 'rows', 'headers', 'encoding', 'delimiter']) assert.deepEqual(audit[key], original[key]);
  assert.equal(audit.csvExclusionEvents[0].target, original.csvExclusionEvents[0].id);
  assertPreserved(excluded, result.bundle);
});

test('one revoke removes all concurrent same-place exclusions, stale branches cannot resurrect, explicit re-exclusion can', async () => {
  const base = emptyBundle('concurrent'), left = (await exclude(base)).bundle, right = (await exclude(base)).bundle;
  const together = merge(left, right), list = csvExclusionList(together);
  assert.equal(list.length, 1); assert.equal(list[0].eventIds.length, 2);
  const revoked = (await revoke(together)).bundle; assert.deepEqual(csvExclusionList(revoked), []);
  const stale = (await exclude(base)).bundle;
  assert.deepEqual(csvExclusionList(merge(revoked, stale)), []);
  assert.deepEqual(csvExclusionList(merge(stale, revoked)), []);
  const reexcluded = (await exclude(revoked)).bundle, active = csvExclusionList(reexcluded);
  assert.equal(active.length, 1); assert.equal(active[0].eventIds.length, 1);
  assert.deepEqual(statuses(await preview(merge(reexcluded, stale))), ['remembered']);
  const concurrentRevocation = (await revoke(together)).bundle;
  assert.deepEqual(csvExclusionList(merge(reexcluded, concurrentRevocation)), []);
  const fullySeen = merge(reexcluded, concurrentRevocation), fresh = (await exclude(fullySeen)).bundle;
  assert.equal(csvExclusionList(fresh).length, 1);
});

test('exclude/revoke with existing manual text and history never changes original stores, visits or blobs', async () => {
  const base = emptyBundle('manual'), p = await preview(base); p.rows[0].choice = 'new'; p.rows[0].sop1.extraAccepted = true;
  const seed = buildCSVImport(p, base, 'synthetic').bundle, visit = records(seed, 'visit')[0];
  seed.ops.push(revision('visit', visit.id, { ...visit.heads[0].data, text: '人工編輯原文；不可被CSV覆蓋', next: '原有待辦' }, visit.heads.map(item => item.id), 'synthetic'));
  const rows = [row(), row('虛構新藥局', '88999', '不應變為筆記', '臺北市虛構新路99號')];
  const candidate = await preview(seed, rows); assert.equal(candidate.rows[0].newStoreOnly.canExclude, false);
  candidate.rows[1].choice = 'exclude'; const excluded = buildCSVImport(candidate, seed, 'synthetic').bundle; assertPreserved(seed, excluded);
  const revoked = (await revoke(excluded, undefined, rows)).bundle; assertPreserved(excluded, revoked);
  assert.equal(records(revoked, 'visit')[0].text, '人工編輯原文；不可被CSV覆蓋');
});

test('new-only exclusion does not secretly change standard import rules', async () => {
  const excluded = (await exclude(emptyBundle('standard'))).bundle;
  const standard = await planCSV([await file([row()])], excluded, { mode: 'standard' });
  assert.equal(standard.rows[0].choice, 'new'); assert.equal(standard.rows[0].newStoreOnly, undefined);
});

test('a later existing-store conflict or historical match stays visible despite exact exclusion and batch review overrides', async () => {
  const base = emptyBundle('history-visible'), excluded = (await exclude(base)).bundle;
  const p = await preview(base); p.rows[0].choice = 'new'; p.rows[0].sop1.extraAccepted = true;
  const imported = buildCSVImport(p, base, 'synthetic').bundle, store = records(imported, 'store')[0];
  const changed = data => { const branch = structuredClone(imported); branch.ops.push(revision('store', store.id, { ...store.heads[0].data, ...data }, store.heads.map(item => item.id), 'synthetic')); return branch; };
  const conflict = merge(changed({ contact: '虛構左端' }), changed({ contact: '虛構右端' }));
  const renamed = changed({ name: '虛構現在名稱', mapUrl: url('88777'), address: '臺北市虛構現在路7號' });
  const deleted = structuredClone(imported); deleted.ops.push(revision('store', store.id, store.heads[0].data, store.heads.map(item => item.id), 'synthetic', true));
  for (const other of [conflict, renamed, deleted]) {
    const merged = merge(excluded, other), incoming = row(), otherNote = row(); otherNote[1] = '跨清單的新文字';
    for (const rows of [[incoming], [incoming, otherNote]]) {
      const plan = await preview(merged, rows); assert.ok(statuses(plan).every(status => status === 'review'));
      assert.ok(plan.rows.every(item => item.newStoreOnly.canExclude === false));
      plan.rows[0].choice = 'exclude'; assert.throws(() => buildCSVImport(plan, merged, 'synthetic'), /其餘列只能略過/);
    }
  }
  const healthy = merge(excluded, imported), current = await preview(healthy);
  assert.deepEqual(statuses(current), ['existing']); assert.equal(current.rows[0].newStoreOnly.canExclude, false);
});

test('encryption, complete recovery export and blank restore preserve exclusions plus all revocation history', async () => {
  const base = emptyBundle('recovery-exclusions'), first = (await exclude(base)).bundle, revoked = (await revoke(first)).bundle;
  const current = (await exclude(revoked)).bundle, pass = 'synthetic-exclusion-recovery-password';
  const backup = await createRecoveryBackup(current, pass, pass);
  assert.ok(!backup.text.includes('虛構甲藥局'));
  const envelope = JSON.parse(backup.text).envelope, decoded = await unseal(envelope, await derive(pass, envelope));
  assert.deepEqual(decoded, current); assert.deepEqual(csvExclusionList(decoded), csvExclusionList(current));
  const restore = await planBackupImport(null, decoded); assert.equal(restore.summary.after.revisions, current.ops.length);
  assert.deepEqual(csvExclusionList(merge(base, decoded)), csvExclusionList(current));
});

test('core rejects malformed/forged event fields, cross-place causal references, damaged audits and cycles', async () => {
  const first = (await exclude(emptyBundle('invalid'))).bundle, revoked = (await revoke(first)).bundle, current = (await exclude(revoked)).bundle;
  const sourceIndex = current.ops.findIndex(item => item.type === 'source' && item.data.csvExclusionEvents?.some(event => event.action === 'exclude'));
  const auditIndex = current.ops.findIndex(item => item.data.csvExclusionAuditOf);
  for (const mutate of [
    b => b.ops[sourceIndex].data.csvExclusionEvents[0].unexpected = true,
    b => b.ops[sourceIndex].data.csvExclusionEvents[0].identity.mapKey = 'cid:999',
    b => b.ops[sourceIndex].data.csvExclusionEvents[0].fingerprint = 'invalid',
    b => b.ops[sourceIndex].data.csvExclusionEvents[0].line = 0,
    b => b.ops[sourceIndex].data.csvExclusionEvents[0].seenRevocations = ['missing'],
    b => b.ops[auditIndex].data.csvExclusionAuditOf = 'missing-source',
    b => b.ops[auditIndex].data.headers = ['altered'],
    b => b.ops[auditIndex].data.csvExclusionEvents[0].target = 'missing-event',
    b => b.ops[auditIndex].data.csvExclusionEvents[0].target = b.ops[auditIndex].data.csvExclusionEvents[0].id,
    b => b.ops[sourceIndex].data.csvExclusionEvents[0].seenRevocations = [b.ops[auditIndex].data.csvExclusionEvents[0].id],
    b => b.ops[auditIndex].data.csvExclusionEvents.push(structuredClone(b.ops[auditIndex].data.csvExclusionEvents[0])),
  ]) { const invalid = structuredClone(current); mutate(invalid); assert.throws(() => validateBundle(invalid)); }
  const unrelated = (await exclude(revoked, [row('虛構無關店', '88777', '', '臺北市虛構無關路7號')])).bundle;
  const event = unrelated.ops.at(-1).data.csvExclusionEvents[0];
  event.seenRevocations = [unrelated.ops[auditIndex].data.csvExclusionEvents[0].id];
  assert.throws(() => validateBundle(unrelated), /不同地點/);
  const badBlob = structuredClone(current); badBlob.blobs[Object.keys(badBlob.blobs)[0]] = b64(encode('altered original'));
  await assert.rejects(createRecoveryBackup(badBlob, 'synthetic-password', 'synthetic-password'), /內容與識別不符/);
});

test('core validates long merged exclusion causality iteratively without stack growth', async () => {
  const seed = (await exclude(emptyBundle('long-history'))).bundle, source = seed.ops[0], initial = source.data.csvExclusionEvents[0];
  const large = emptyBundle(seed.vaultId); large.blobs = structuredClone(seed.blobs);
  let previous = null;
  for (let i = 0; i < 2400; i++) {
    const excludeId = `synthetic-exclude-${i}`, sourceId = `synthetic-source-${i}`, revokeId = `synthetic-revoke-${i}`;
    large.ops.push(revision('source', sourceId, { ...source.data, csvExclusionEvents: [{ ...initial, id: excludeId, seenRevocations: previous ? [previous] : [] }] }, [], 'synthetic'));
    large.ops.push(revision('source', `synthetic-audit-${i}`, { ...source.data, csvExclusionAuditOf: sourceId, csvExclusionEvents: [{ id: revokeId, action: 'revoke', target: excludeId }] }, [], 'synthetic'));
    previous = revokeId;
  }
  large.ops.reverse(); assert.doesNotThrow(() => validateBundle(large));
  assert.deepEqual(csvExclusionList(large), []);
});

test('stale preview, forged exclusion/revoke selections and raw bytes fail before any write', async () => {
  const base = emptyBundle('stale'), before = structuredClone(base), p = await preview(base); p.rows[0].choice = 'exclude';
  assert.throws(() => buildCSVImport(structuredClone(p), base, 'synthetic'), /失效/);
  const changed = (await exclude(base)).bundle; assert.throws(() => buildCSVImport(p, changed, 'synthetic'), /資料已變更/);
  for (const ids of [null, ['unknown'], [changed.ops[0].data.csvExclusionEvents[0].id, changed.ops[0].data.csvExclusionEvents[0].id]]) {
    const candidate = await preview(changed); candidate.revokeExclusionIds = ids;
    assert.equal(sop1Report(candidate, changed).ready, false); assert.throws(() => buildCSVImport(candidate, changed, 'synthetic'), /撤銷排除/);
  }
  p.files[0].bytes[0] ^= 1; assert.throws(() => buildCSVImport(p, base, 'synthetic'), /原始bytes/);
  assert.deepEqual(base, before);
});
