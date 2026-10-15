import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, project, revision, b64, validateBundle } from '../public/core.js';
import { prepareCSV, planCSV, prepareReviewedCSV, planReviewedCSV, setReviewedGroupChoice, buildCSVImport, sop1Report } from '../public/csv.js';

// All names, addresses and source text in this suite are fictional.
const enc = new TextEncoder();
const featureURL = 'https://www.google.com/maps/place/SyntheticMonthly/data=!4m2!3m1!1s0xaaa:0xabc';
const names = { keeper: '虛構月清單甲藥局 A店', donor: '虛構月清單甲藥局' };
const storeData = (name, extra = {}) => ({ name, address: '', mapUrl: featureURL, city: '', district: '', channel: '', contact: '', attr: '', ...extra });
const member = (active = true) => ({ month: '2026-10', active, updatedAt: '2026-10-15T01:00:00.000Z' });

async function reviewedPacket() {
  const files = await Promise.all(Object.values(names).map((name, index) => prepareCSV(`虛構每月來源${index}.csv`, enc.encode(`Title,Note,URL\n${name},虛構來源文字${index},${featureURL}`))));
  const plan = await planCSV(files, emptyBundle('fictional-monthly-packet'));
  const rows = plan.rows.map(row => ({ sha256: files[row.fileIndex].blob, line: row.line, fingerprint: row.fingerprint }));
  return prepareReviewedCSV(JSON.stringify({
    format: 'pharmacy-csv-review-1',
    files: files.map(file => ({ file: file.file, list: file.list, sha256: file.blob, content: b64(file.bytes) })),
    groups: [{ id: 'fictional-monthly-same-store', label: names.keeper, pending: false, rows,
      identityRule: { decision: 'same', mapKey: 'feature:0xaaa:0xabc', label: names.keeper, names: Object.values(names), addresses: [], source: '虛構測試裁定', decidedAt: '2026-10-15' } }],
    excluded: []
  }));
}
function fixture() {
  const bundle = emptyBundle('fictional-monthly-merge');
  for (const [id, name] of Object.entries(names)) bundle.ops.push(revision('store', id, storeData(name), [], 'fictional-device'));
  bundle.ops.push(revision('visit', 'fictional-original', { store: 'donor', date: '', source: '虛構來源', text: '  虛構原文\r\n完整保留。  ', next: '', topics: [], people: [], attachments: [] }, [], 'fictional-device'));
  return bundle;
}
function append(bundle, id, patch) {
  const current = project(bundle).find(store => store.type === 'store' && store.id === id);
  bundle.ops.push(revision('store', id, { ...current.heads[0].data, ...patch }, current.heads.map(head => head.id), 'fictional-device'));
}

test('CSV automatic same-store merge blocks active or removed monthly membership on either store without altering originals', async () => {
  const review = await reviewedPacket();
  for (const id of ['keeper', 'donor']) for (const active of [true, false]) {
    const bundle = fixture(); append(bundle, id, { monthlyVisits: [member(active)] }); validateBundle(bundle);
    const before = JSON.stringify(bundle), plan = await planReviewedCSV(review, bundle), group = plan.reviewGroups[0];
    assert.equal(group.choice, 'review'); assert.match(group.mergeBlocked, /每月必訪/); assert.equal(group.merge, undefined);
    assert.equal(sop1Report(plan, bundle).ready, false);
    assert.throws(() => setReviewedGroupChoice(plan, group.id, 'store:keeper'), /不能.*繞過/);
    assert.throws(() => buildCSVImport(plan, bundle, 'fictional-device'), /SOP1/);
    assert.equal(JSON.stringify(bundle), before); assert.equal(project(bundle).filter(store => store.type === 'store' && !store.deleted).length, 2);
  }
});

test('historical-only monthly membership remains a blocker after the current field is cleared or absent', async () => {
  const review = await reviewedPacket();
  for (const id of ['keeper', 'donor']) for (const mode of ['empty', 'absent']) {
    const bundle = fixture(); append(bundle, id, { monthlyVisits: [member(false)] });
    if (mode === 'empty') append(bundle, id, { monthlyVisits: [] });
    else {
      const current = project(bundle).find(store => store.type === 'store' && store.id === id), data = structuredClone(current.heads[0].data); delete data.monthlyVisits;
      bundle.ops.push(revision('store', id, data, current.heads.map(head => head.id), 'fictional-old-device'));
    }
    validateBundle(bundle); const before = JSON.stringify(bundle), plan = await planReviewedCSV(review, bundle);
    assert.match(plan.reviewGroups[0].mergeBlocked, /每月必訪/); assert.equal(sop1Report(plan, bundle).ready, false);
    assert.throws(() => buildCSVImport(plan, bundle, 'fictional-device'), /SOP1/); assert.equal(JSON.stringify(bundle), before);
  }
});

test('stores with no monthly membership retain the existing exact CSV ruling path', async () => {
  const review = await reviewedPacket(), bundle = fixture(); append(bundle, 'keeper', { monthlyVisits: [] });
  const plan = await planReviewedCSV(review, bundle); assert.equal(sop1Report(plan, bundle).ready, true);
  assert.equal(plan.reviewGroups[0].merge.keeper, 'keeper');
  const result = buildCSVImport(plan, bundle, 'fictional-device');
  assert.equal(result.summary.mergedStores, 1); assert.deepEqual(project(result.bundle).find(store => store.id === 'keeper').monthlyVisits, []);
});

test('a previously valid CSV merge preview cannot bypass a monthly roster added before application', async () => {
  const review = await reviewedPacket(), bundle = fixture(), plan = await planReviewedCSV(review, bundle);
  assert.equal(plan.reviewGroups[0].merge.keeper, 'keeper');
  append(bundle, 'donor', { monthlyVisits: [member()] });
  const before = JSON.stringify(bundle);
  assert.throws(() => buildCSVImport(plan, bundle, 'fictional-device'), /預覽後變更/);
  assert.equal(JSON.stringify(bundle), before); assert.equal(project(bundle).filter(store => store.type === 'store' && !store.deleted).length, 2);
});

test('ordinary CSV reimport preserves existing monthly memberships and creates no visit attendance', async () => {
  const bundle = fixture(); bundle.ops = bundle.ops.filter(op => op.entity !== 'donor' && op.type !== 'visit');
  append(bundle, 'keeper', { monthlyVisits: [member()] });
  const before = structuredClone(bundle), file = await prepareCSV('虛構普通重匯.csv', enc.encode(`Title,Note,URL\n${names.keeper},虛構普通文字,${featureURL}`));
  const plan = await planCSV([file], bundle); assert.equal(sop1Report(plan, bundle).ready, true);
  const after = buildCSVImport(plan, bundle, 'fictional-device').bundle;
  assert.deepEqual(project(after).find(store => store.type === 'store' && store.id === 'keeper').monthlyVisits, [member()]);
  for (const op of before.ops) assert.deepEqual(after.ops.find(saved => saved.id === op.id), op);
  assert.equal(after.ops.some(op => op.visitAttendance), false);
});
