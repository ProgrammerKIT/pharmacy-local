import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, project, revision, b64 } from '../public/core.js';
import { prepareCSV, planCSV, prepareReviewedCSV, planReviewedCSV, setReviewedGroupChoice, buildCSVImport, sop1Report, exportCSVPreview } from '../public/csv.js';

const enc = new TextEncoder();
const featureURL = 'https://www.google.com/maps/place/example/data=!4m2!3m1!1s0xaaa:0xbbb';
const rule = {
  decision: 'same',
  mapKey: 'feature:0xaaa:0xbbb',
  label: '虛構甲藥局 A店',
  names: ['虛構甲藥局', '虛構甲藥局 A店'],
  addresses: [],
  source: '測試裁定',
  decidedAt: '2026-09-19'
};
const storeData = (name, extra = {}) => ({ name, address: '', mapUrl: featureURL, city: '', district: '', channel: '', contact: '', attr: '', ...extra });
const visitData = (store, text, stream = '') => ({ store, date: '', source: '測試', text, next: '', topics: [], people: [], attachments: [], ...(stream ? { csvStream: stream } : {}) });
const pendingSource = (name, blob, fingerprint) => ({
  fingerprint, batch: 'old-batch', file: name + '.csv', line: 2, list: name, at: '2026-09-18T00:00:00.000Z', blob,
  headers: ['Title'], cells: [name], sop1Version: '1.0.1', supplements: [], disposition: 'new',
  review: { key: 'old:' + name, group: 'old', pending: true, label: name, names: [name] }
});

async function reviewedPacket() {
  const texts = [
    `Title,Note,URL\n虛構甲藥局,甲來源,${featureURL}`,
    `Title,Note,URL\n虛構甲藥局 A店,乙來源,${featureURL}`
  ];
  const files = await Promise.all(texts.map((text, i) => prepareCSV('虛構來源' + i + '.csv', enc.encode(text))));
  const plan = await planCSV(files, emptyBundle('packet'));
  const refs = plan.rows.map(row => ({ sha256: files[row.fileIndex].blob, line: row.line, fingerprint: row.fingerprint }));
  return prepareReviewedCSV(JSON.stringify({
    format: 'pharmacy-csv-review-1',
    files: files.map(file => ({ file: file.file, list: file.list, sha256: file.blob, content: b64(file.bytes) })),
    groups: [{ id: 'same-store', label: rule.label, pending: false, identityRule: rule, rows: refs }],
    excluded: []
  }));
}

test('exact same-store ruling merges existing stores, moves visits and preserves history plus source snapshots', async () => {
  const review = await reviewedPacket(), b = emptyBundle('merge-vault');
  const blobA = 'a'.repeat(64), blobB = 'b'.repeat(64);
  b.blobs[blobA] = b64(enc.encode('old-a')); b.blobs[blobB] = b64(enc.encode('old-b'));
  const sourceA = pendingSource('虛構甲藥局', blobA, '1'.repeat(64));
  const sourceB = pendingSource('虛構甲藥局 A店', blobB, '2'.repeat(64));
  b.ops.push(revision('store', 'legacy', storeData('虛構甲藥局', { csvSources: [sourceA], csvIdentityPending: true, csvAliases: ['虛構甲藥局'], lists: ['舊來源甲'] }), [], 'mac'));
  b.ops.push(revision('store', 'keeper', storeData('虛構甲藥局 A店', { csvSources: [sourceB], csvIdentityPending: true, csvAliases: ['虛構甲藥局 A店'], lists: ['舊來源乙'] }), [], 'mac'));
  b.ops.push(revision('visit', 'manual-visit', visitData('legacy', '既有手動拜訪'), [], 'mac'));

  const plan = await planReviewedCSV(review, b), group = plan.reviewGroups[0];
  assert.equal(group.choice, 'store:keeper');
  assert.equal(group.merge.keeper, 'keeper');
  assert.deepEqual(group.merge.merged.map(s => s.id), ['legacy']);
  assert.equal(group.merge.movedVisits, 1);
  assert.equal(sop1Report(plan, b).ready, true);
  const preview = exportCSVPreview(plan, b);
  assert.equal(preview.groups[0].merge.keeper, 'keeper');
  assert.equal(preview.imported, false);

  const result = buildCSVImport(plan, b, 'mac'), records = project(result.bundle);
  assert.equal(result.summary.mergeGroups, 1);
  assert.equal(result.summary.mergedStores, 1);
  assert.equal(result.summary.movedVisits, 1);
  assert.equal(result.summary.sourceSnapshots, 2);

  const activeStores = records.filter(r => r.type === 'store' && !r.deleted);
  assert.deepEqual(activeStores.map(r => r.id), ['keeper']);
  const keeper = activeStores[0], retired = records.find(r => r.type === 'store' && r.id === 'legacy');
  assert.deepEqual(keeper.csvAliases.sort(), rule.names.slice().sort());
  assert.deepEqual(keeper.csvIdentityRules, [rule]);
  assert.equal(keeper.csvIdentityPending, false);
  assert.equal(retired.deleted, true);
  assert.equal(retired.mergedInto, 'keeper');
  assert.equal(retired.mergeDecision, review.packageId + ':same-store');

  const moved = records.find(r => r.type === 'visit' && r.id === 'manual-visit');
  assert.equal(moved.store, 'keeper');
  assert.equal(moved.versions.length, 2);
  assert.equal(moved.versions[0].data.store, 'legacy');
  assert.equal(records.filter(r => r.type === 'source').length, 2);
  for (const file of review.files) assert.equal(result.bundle.blobs[file.blob], b64(file.bytes));

  const repeatPlan = await planReviewedCSV(review, result.bundle);
  assert.equal(repeatPlan.reviewGroups[0].merge, undefined);
  assert.equal(repeatPlan.reviewGroups[0].choice, 'store:keeper');
  const repeat = buildCSVImport(repeatPlan, result.bundle, 'phone');
  assert.equal(repeat.summary.mergedStores, 0);
  assert.equal(repeat.summary.rows, 0);
  assert.equal(repeat.summary.sourceSnapshots, 2);
  assert.equal(project(repeat.bundle).filter(r => r.type === 'source').length, 4);
});

test('same-store ruling is blocked when moving stores would collide two existing source streams', async () => {
  const review = await reviewedPacket(), b = emptyBundle('collision-vault');
  b.ops.push(revision('store', 'legacy', storeData('虛構甲藥局'), [], 'mac'));
  b.ops.push(revision('store', 'keeper', storeData('虛構甲藥局 A店'), [], 'mac'));
  b.ops.push(revision('visit', 'legacy-note', visitData('legacy', '甲', 'google-csv:legacy:共同來源'), [], 'mac'));
  b.ops.push(revision('visit', 'keeper-note', visitData('keeper', '乙', 'google-csv:keeper:共同來源'), [], 'mac'));

  const plan = await planReviewedCSV(review, b), group = plan.reviewGroups[0];
  assert.equal(group.choice, 'review');
  assert.match(group.mergeBlocked, /同一來源清單/);
  assert.equal(sop1Report(plan, b).ready, false);
  assert.throws(() => setReviewedGroupChoice(plan, group.id, 'store:keeper'), /不能.*繞過/);
  assert.throws(() => buildCSVImport(plan, b, 'mac'), /SOP1/);
  assert.equal(project(b).filter(r => r.type === 'store' && !r.deleted).length, 2);
});

test('same-store ruling is blocked rather than overwriting conflicting existing profile fields', async () => {
  const review = await reviewedPacket(), b = emptyBundle('profile-vault');
  b.ops.push(revision('store', 'legacy', storeData('虛構甲藥局', { contact: '甲窗口' }), [], 'mac'));
  b.ops.push(revision('store', 'keeper', storeData('虛構甲藥局 A店', { contact: '乙窗口' }), [], 'mac'));
  const plan = await planReviewedCSV(review, b), group = plan.reviewGroups[0];
  assert.equal(group.choice, 'review');
  assert.match(group.mergeBlocked, /拜訪窗口.*不同/);
  assert.equal(sop1Report(plan, b).ready, false);
});
