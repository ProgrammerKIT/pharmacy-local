import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, project, revision, b64, validateBundle, storeInsightsIdentityKey,
  makeVisitAttendance, newMeta, derive, seal, unseal, merge, planBackupImport } from '../public/core.js';
import { prepareCSV, planCSV, prepareReviewedCSV, planReviewedCSV, setReviewedGroupChoice, buildCSVImport, sop1Report } from '../public/csv.js';

// Fictional stores, people, text, mapping, decisions and encrypted backups only.
const enc = new TextEncoder(), at = '2026-10-16T01:00:00.000Z';
const featureURL = 'https://www.google.com/maps/place/SyntheticSharedRelation/data=!4m2!3m1!1s0xaaa:0xabc';
const otherURL = 'https://www.google.com/maps/place/SyntheticOtherRelation/data=!4m2!3m1!1s0xdef:0x123';
const names = { keeper: '虛構關係甲藥局 A店', donor: '虛構關係甲藥局', external: '虛構關係乙藥局', unrelated: '虛構關係丙藥局' };
const storeData = (name, mapUrl = featureURL) => ({ name, address: '', mapUrl, city: '', district: '', channel: '', contact: '', attr: '', nextRemember: 'Synthetic unchanged reminder', everyTimeMust: 'Synthetic unchanged routine' });
const note = store => ({ store, date: '', source: 'Synthetic original source', text: `  Synthetic ${store} exact relationship text.\r\nOriginal detail.  `, next: '', topics: [], people: [], attachments: [] });
const row = (bundle, type, id) => project(bundle).find(record => record.type === type && record.id === id);
function append(bundle, id, patch = {}, deleted = false) {
  const current = row(bundle, 'store', id);
  bundle.ops.push(revision('store', id, { ...current.heads[0].data, ...patch }, current.heads.map(head => head.id), 'synthetic-change', deleted));
}
function fixture(vaultId = 'synthetic-relation-csv') {
  const bundle = emptyBundle(vaultId);
  for (const [id, name] of Object.entries(names)) {
    bundle.ops.push(revision('store', id, storeData(name, ['keeper', 'donor'].includes(id) ? featureURL : otherURL + (id === 'unrelated' ? '&synthetic=other' : '')), [], 'synthetic', false,
      id === 'keeper' ? makeVisitAttendance(id, at) : undefined));
    bundle.ops.push(revision('visit', 'visit-' + id, note(id), [], 'synthetic'));
  }
  return bundle;
}
function makeMapping(bundle, ids = ['keeper', 'external'], relationId = 'synthetic-shared-relation') {
  const members = ids.map(storeId => {
    const store = row(bundle, 'store', storeId), visit = row(bundle, 'visit', 'visit-' + storeId);
    const entry = { id: 'synthetic-card-' + storeId, kind: 'relationship', level: 'source', headline: 'Synthetic relationship at ' + storeId,
      question: 'Synthetic optional question?', caution: '', limitations: ['Synthetic limited evidence'], evidence: [{ storeId,
        storeIdentityKey: storeInsightsIdentityKey(store), visitId: visit.id, revisionId: visit.heads[0].id,
        quote: `Synthetic ${storeId} exact relationship text.`, role: 'support' }] };
    append(bundle, storeId, { preVisitInsights: { format: 'pharmacy-store-insights-1', batchId: 'synthetic-shared-batch', generatedAt: at,
      sourceAsOf: '2026-10-16', entries: [entry] } });
    return { storeId, storeIdentityKey: storeInsightsIdentityKey(store), entry };
  });
  return { format: 'pharmacy-insight-relation-1', id: relationId, claim: 'Synthetic A and B are former colleagues.', members };
}
function installMapping(bundle, relation, owners = relation.members.map(member => member.storeId)) {
  for (const id of owners) append(bundle, id, { preVisitInsightRelations: [structuredClone(relation)] });
}
function withdrawMapping(bundle, id, absent = false, deleted = false) {
  if (!absent) return append(bundle, id, { preVisitInsightRelations: [] }, deleted);
  const current = row(bundle, 'store', id), data = structuredClone(current.heads[0].data); delete data.preVisitInsightRelations;
  bundle.ops.push(revision('store', id, data, current.heads.map(head => head.id), 'synthetic-legacy-device', deleted));
}
async function reviewedPacket() {
  const files = await Promise.all(['keeper', 'donor'].map((id, index) => prepareCSV(`Synthetic reviewed relation ${index}.csv`, enc.encode(`Title,Note,URL\n${names[id]},Synthetic CSV text ${index},${featureURL}`))));
  const plan = await planCSV(files, emptyBundle('synthetic-relation-packet'));
  return prepareReviewedCSV(JSON.stringify({ format: 'pharmacy-csv-review-1',
    files: files.map(file => ({ file: file.file, list: file.list, sha256: file.blob, content: b64(file.bytes) })),
    groups: [{ id: 'synthetic-relation-same-store', label: names.keeper, pending: false,
      rows: plan.rows.map(item => ({ sha256: files[item.fileIndex].blob, line: item.line, fingerprint: item.fingerprint })),
      identityRule: { decision: 'same', mapKey: 'feature:0xaaa:0xabc', label: names.keeper, names: [names.keeper, names.donor], addresses: [], source: 'Synthetic ruling', decidedAt: '2026-10-16' } }], excluded: [] }));
}
async function assertCSVBlocked(bundle, review) {
  validateBundle(bundle); const before = structuredClone(bundle), plan = await planReviewedCSV(review, bundle), group = plan.reviewGroups[0];
  assert.equal(group.choice, 'review'); assert.match(group.mergeBlocked, /共用人物關係/); assert.equal(group.merge, undefined);
  assert.equal(sop1Report(plan, bundle).ready, false);
  assert.throws(() => setReviewedGroupChoice(plan, group.id, 'store:keeper'), /不能.*繞過/);
  assert.throws(() => buildCSVImport(plan, bundle, 'synthetic-device'), /SOP1/);
  assert.deepEqual(bundle, before);
}

test('CSV automatic same-store merge blocks mappings owned by either store without changing any data', async () => {
  const review = await reviewedPacket();
  for (const id of ['keeper', 'donor']) {
    const bundle = fixture(), relation = makeMapping(bundle, [id, 'external']); installMapping(bundle, relation);
    await assertCSVBlocked(bundle, review);
  }
});

test('withdrawn owned mappings remain blockers through empty or absent current fields', async () => {
  const review = await reviewedPacket();
  for (const id of ['keeper', 'donor']) for (const absent of [false, true]) {
    const bundle = fixture(), relation = makeMapping(bundle, [id, 'external']); installMapping(bundle, relation, [id]); withdrawMapping(bundle, id, absent);
    await assertCSVBlocked(bundle, review);
  }
});

test('external current, historical or deleted-store mappings referencing either candidate block CSV merge', async () => {
  const review = await reviewedPacket();
  for (const id of ['keeper', 'donor']) for (const mode of ['current', 'empty', 'absent', 'deleted']) {
    const bundle = fixture(), relation = makeMapping(bundle, [id, 'external']);
    // Partial mapping is retained but cannot activate shared approval. Neither
    // selected store ever owns it, proving external references are inspected.
    installMapping(bundle, relation, ['external']);
    if (mode !== 'current') withdrawMapping(bundle, 'external', mode === 'absent', mode === 'deleted');
    await assertCSVBlocked(bundle, review);
  }
});

test('unrelated mappings and empty mapping fields do not block the existing CSV ruling path', async () => {
  const review = await reviewedPacket(), bundle = fixture(), relation = makeMapping(bundle, ['external', 'unrelated']);
  installMapping(bundle, relation); append(bundle, 'keeper', { preVisitInsightRelations: [] });
  const before = structuredClone(bundle), plan = await planReviewedCSV(review, bundle);
  assert.equal(sop1Report(plan, bundle).ready, true); assert.equal(plan.reviewGroups[0].merge.keeper, 'keeper');
  const after = buildCSVImport(plan, bundle, 'synthetic-device').bundle;
  for (const id of ['external', 'unrelated']) assert.deepEqual(row(after, 'store', id).preVisitInsightRelations, [relation]);
  for (const op of before.ops) assert.deepEqual(after.ops.find(saved => saved.id === op.id), op);
  assert.deepEqual(after.ops.filter(op => op.visitAttendance), before.ops.filter(op => op.visitAttendance));
});

test('previously approved CSV merge cannot apply after a mapping is added on a candidate or external store', async () => {
  const review = await reviewedPacket();
  for (const owner of ['keeper', 'external']) {
    const bundle = fixture(), relation = makeMapping(bundle), plan = await planReviewedCSV(review, bundle);
    assert.equal(plan.reviewGroups[0].merge.keeper, 'keeper'); installMapping(bundle, relation, [owner]);
    const before = structuredClone(bundle);
    assert.throws(() => buildCSVImport(plan, bundle, 'synthetic-device'), /預覽後變更/); assert.deepEqual(bundle, before);
    // Even a caller that changes the preview baseline cannot bypass the merge's
    // independent check of current and historical external relation references.
    plan.baseRevision = bundle.ops.map(op => op.id).sort().join(',');
    assert.throws(() => buildCSVImport(plan, bundle, 'synthetic-device'), /整併計畫已失效/); assert.deepEqual(bundle, before);
  }
});

test('ordinary CSV imports and reimports preserve shared mapping, exact reviews, original notes and attendance', async () => {
  let bundle = fixture(); bundle.ops = bundle.ops.filter(op => op.entity !== 'donor' && op.entity !== 'visit-donor');
  const relation = makeMapping(bundle); installMapping(bundle, relation);
  const card = relation.members.find(member => member.storeId === 'keeper').entry;
  append(bundle, 'keeper', { preVisitInsightReviews: [{ id: 'synthetic-original-review', status: 'confirmed', reviewedBy: 'Kit', reviewedAt: at, sourceAsOf: '2026-10-16', entry: structuredClone(card) }] });
  validateBundle(bundle); const before = structuredClone(bundle);
  const file = await prepareCSV('Synthetic ordinary relation.csv', enc.encode(`Title,Note,URL\n${names.keeper},Synthetic separate imported text,${featureURL}`));
  for (let iteration = 0; iteration < 2; iteration++) {
    const plan = await planCSV([file], bundle); assert.equal(sop1Report(plan, bundle).ready, true);
    bundle = buildCSVImport(plan, bundle, 'synthetic-device').bundle; validateBundle(bundle);
    for (const id of ['keeper', 'external']) assert.deepEqual(row(bundle, 'store', id).preVisitInsightRelations, [relation]);
    assert.deepEqual(row(bundle, 'store', 'keeper').preVisitInsightReviews, row(before, 'store', 'keeper').preVisitInsightReviews);
    for (const op of before.ops) assert.deepEqual(bundle.ops.find(saved => saved.id === op.id), op);
    for (const id of ['keeper', 'external']) assert.equal(row(bundle, 'visit', 'visit-' + id).text, row(before, 'visit', 'visit-' + id).text);
    assert.deepEqual(bundle.ops.filter(op => op.visitAttendance), before.ops.filter(op => op.visitAttendance));
  }
});

test('shared mappings survive exact encrypted backup and sync round-trips without attendance or review writes', async () => {
  const meta = newMeta(), bundle = fixture(meta.vaultId), relation = makeMapping(bundle); installMapping(bundle, relation);
  const before = structuredClone(bundle), key = await derive('synthetic-relation-backup-passphrase', meta);
  const decoded = await unseal(await seal(bundle, key, meta), key); assert.deepEqual(decoded, before);
  assert.deepEqual(merge(bundle, decoded), merge(decoded, bundle));
  const preview = await planBackupImport(bundle, decoded);
  assert.equal(preview.summary.addedRevisions, 0); assert.equal(preview.summary.changedExistingEntities, 0);
  assert.equal(preview.summary.visitAttendance.addedMarks, 0);
  for (const id of ['keeper', 'external']) assert.deepEqual(row(preview.bundle, 'store', id).preVisitInsightRelations, [relation]);
  assert.deepEqual(bundle, before);
});
