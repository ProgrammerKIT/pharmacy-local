import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, project, revision, b64, newMeta, derive, seal, unseal, merge } from '../public/core.js';
import { prepareCSV, planCSV, buildCSVImport, sop1Report, csvSupplementChoices, csvSourceSupplements, exportCSVPreview, prepareReviewedCSV, planReviewedCSV } from '../public/csv.js';

const enc = new TextEncoder(), url = 'https://maps.google.com/?cid=7654321';
const raw = `Title,Note,URL,Address,額外欄,額外欄,空欄\r\n虛構欄位藥局,原筆記,${url},臺北市虛構路1號,"  第一段\r\n第二段  ",<不採用>,   \r\n`;
const file = (text = raw, name = '虛構欄位.csv') => prepareCSV(name, enc.encode(text));
const store = bundle => project(bundle).find(item => item.type === 'store');
const visit = bundle => project(bundle).find(item => item.type === 'visit');
async function makePlan(bundle, text = raw) { return planCSV([await file(text)], bundle); }
function decide(plan, columns = []) { plan.rows[0].supplementColumns = columns; plan.rows[0].sop1.extraAccepted = true; return plan; }
async function first(columns = [], text = raw) {
  const bundle = emptyBundle('csv-selection');
  return buildCSVImport(decide(await makePlan(bundle, text), columns), bundle, 'mac').bundle;
}
function change(bundle, type, data) {
  const before = project(bundle).find(item => item.type === type), result = structuredClone(bundle);
  result.ops.push(revision(type, before.id, { ...before.heads[0].data, ...data }, before.heads.map(head => head.id), 'phone'));
  return result;
}
async function reviewed(text = raw, excluded = false) {
  const f = await file(text), p = await planCSV([f], emptyBundle('review-fixture')), r = p.rows[0];
  const ref = { sha256: f.blob, line: r.line, fingerprint: r.fingerprint };
  return prepareReviewedCSV(JSON.stringify({ format: 'pharmacy-csv-review-1', files: [{ file: f.file, list: f.list, sha256: f.blob, content: b64(f.bytes) }],
    groups: excluded ? [] : [{ id: 'one', label: '虛構欄位藥局', pending: false, rows: [ref] }], excluded: excluded ? [ref] : [] }));
}

test('selected supplements retain exact column identity and bytes, including duplicate headings and CRLF', async () => {
  const base = emptyBundle('selection'), plan = await makePlan(base);
  assert.deepEqual(csvSupplementChoices(plan, plan.rows[0], []).map(item => [item.column, item.header, item.text, item.included]), [[4, '額外欄', '  第一段\r\n第二段  ', false], [5, '額外欄', '<不採用>', false]]);
  plan.rows[0].supplementColumns = [4];
  assert.throws(() => buildCSVImport(plan, base, 'mac'), /核對勾選結果/);
  plan.rows[0].sop1.extraAccepted = true;
  // Cached display data is not an authority for adopted text.
  plan.rows[0].textFields[4].text = '不能採用的篡改預覽';
  const result = buildCSVImport(plan, base, 'mac'), s = store(result.bundle);
  assert.equal(result.summary.adoptedSupplements, 1);
  assert.deepEqual(s.csvSources[0].supplements, [{ column: 4, header: '額外欄', text: '  第一段\r\n第二段  ', kind: 'supplement' }]);
  assert.deepEqual(s.csvSources[0].cells, plan.files[0].rows[0].cells);
  assert.equal(result.bundle.blobs[plan.files[0].blob], b64(enc.encode(raw)));
  assert.equal(visit(result.bundle).text, '原筆記');
  assert.equal(project(result.bundle).filter(item => ['person', 'topic'].includes(item.type)).length, 0);
  const preview = exportCSVPreview(plan, base);
  assert.deepEqual(preview.rows[0].supplementColumns, [4]);
  assert.deepEqual(preview.rows[0].supplements.map(item => item.selected), [true, false]);
});

test('all-unselected still archives every raw column and permits late adoption without another visit revision', async () => {
  const base = await first(), originalVisit = visit(base), originalStore = store(base);
  assert.deepEqual(originalStore.csvSources[0].supplements, []);
  assert.equal(originalStore.csvSources[0].cells[5], '<不採用>');
  const plan = decide(await makePlan(base), [5]);
  assert.equal(plan.rows[0].choice, 'store:' + originalStore.id);
  assert.equal(sop1Report(plan, base).rows[0].kind, 'supplement-only');
  const result = buildCSVImport(plan, base, 'mac');
  assert.equal(result.summary.adoptedSupplements, 1);
  assert.deepEqual(visit(result.bundle), originalVisit);
  assert.deepEqual(store(result.bundle).csvSources[0], originalStore.csvSources[0]);
  assert.equal(csvSourceSupplements(store(result.bundle).csvSources)[0].text, '<不採用>');
  const repeated = buildCSVImport(decide(await makePlan(result.bundle)), result.bundle, 'mac');
  assert.equal(repeated.summary.rows, 0); assert.equal(repeated.summary.sourceSnapshots, 1);
  assert.equal(repeated.summary.adoptedSupplements, 0);
  assert.deepEqual(store(repeated.bundle), store(result.bundle));
  assert.deepEqual(visit(repeated.bundle), originalVisit);
});

test('same-source late selection never rolls back newer Google text, manual text, date, or missing-source state', async () => {
  let base = await first();
  base = change(base, 'visit', { text: '人工文字', googleText: '後來的Google新版', date: '2026-09-01', sourceMissing: true, googleUpdatePending: true });
  const before = visit(base), plan = decide(await makePlan(base), [4]);
  assert.equal(sop1Report(plan, base).rows[0].kind, 'supplement-only');
  const next = buildCSVImport(plan, base, 'mac');
  assert.deepEqual(visit(next.bundle), before);
  assert.equal(next.summary.updatedNotes, 0); assert.equal(next.summary.missingNotes, 0); assert.equal(next.summary.restoredNotes, 0);
  const noIncrement = decide(await makePlan(base));
  const untouched = buildCSVImport(noIncrement, base, 'mac');
  assert.equal(untouched.summary.rows, 0); assert.equal(untouched.summary.sourceSnapshots, 1);
  assert.deepEqual(visit(untouched.bundle), before);
});

test('A to B to A field-review mode remains snapshot-only when no fields are selected or the final checkbox is cleared', async () => {
  const a = await first(), bPlan = decide(await makePlan(a, raw.replace('原筆記', 'B新版筆記')));
  const b = buildCSVImport(bPlan, a, 'mac').bundle, before = visit(b), beforeStore = store(b);
  for (const toggle of [false, true]) {
    const p = decide(await makePlan(b));
    if (toggle) { p.rows[0].supplementColumns = [4]; p.rows[0].supplementColumns = []; }
    assert.equal(sop1Report(p, b).rows[0].kind, 'supplement-only');
    const result = buildCSVImport(p, b, 'mac');
    assert.deepEqual(visit(result.bundle), before); assert.deepEqual(store(result.bundle), beforeStore);
    assert.equal(result.summary.rows, 0); assert.equal(result.summary.sourceSnapshots, 1);
  }
  const adoption = buildCSVImport(decide(await makePlan(b), [4, 5]), b, 'mac').bundle;
  const allIncludedRepeat = await makePlan(adoption), unchanged = buildCSVImport(allIncludedRepeat, adoption, 'mac');
  assert.equal(sop1Report(allIncludedRepeat, adoption).rows[0].kind, 'supplement-only');
  assert.equal(unchanged.summary.rows, 0); assert.deepEqual(visit(unchanged.bundle), before);
});

test('historical field-only rows in a batch cannot conflict with or replace its genuinely new source note', async () => {
  const base = await first(), files = [await file(), await file(raw.replace('原筆記', '當批B新版'), '虛構欄位(2).csv')];
  for (const ordered of [files, [...files].reverse()]) {
    const p = await planCSV(ordered, base);
    for (const row of p.rows) row.sop1.extraAccepted = true;
    assert.equal(sop1Report(p, base).ready, true);
    const result = buildCSVImport(p, base, 'mac');
    assert.equal(visit(result.bundle).text, '當批B新版'); assert.equal(result.summary.updatedNotes, 1);
    assert.equal(visit(result.bundle).versions.length, visit(base).versions.length + 1);
  }
});

test('new source text with supplements still requires manual protection and no-supplement source restoration is unchanged', async () => {
  const base = change(await first(), 'visit', { text: '應保留的人工原文' });
  const newer = decide(await makePlan(base, raw.replace('原筆記', '尚未匯入的新版')), [4]);
  assert.throws(() => buildCSVImport(newer, base, 'mac'), /手動修改/);
  newer.rows[0].sop1.manualAccepted = true;
  const updated = buildCSVImport(newer, base, 'mac').bundle;
  assert.equal(visit(updated).text, '應保留的人工原文'); assert.equal(visit(updated).googleText, '尚未匯入的新版');
  const plain = `Title,Note,URL\n虛構欄位藥局,原筆記,${url}`, original = emptyBundle('plain');
  const a = buildCSVImport(await makePlan(original, plain), original, 'mac').bundle;
  const missing = buildCSVImport(await makePlan(a, plain.replace('原筆記', '')), a, 'mac').bundle;
  assert.equal(visit(missing).sourceMissing, true);
  const reappeared = buildCSVImport(await makePlan(missing, plain), missing, 'mac');
  assert.equal(reappeared.summary.restoredNotes, 1); assert.equal(visit(reappeared.bundle).sourceMissing, false);
});

test('late blank-profile fill uses the same original row without replacing occupied fields or visit state', async () => {
  let base = await first([4, 5]);
  base = change(base, 'store', { address: '' });
  base = change(base, 'visit', { text: '人工內容', googleText: '更新來源', sourceMissing: true });
  const before = visit(base), plan = await makePlan(base);
  assert.equal(plan.rows[0].choice, 'store:' + store(base).id);
  plan.rows[0].fillFields = ['address'];
  assert.equal(sop1Report(plan, base).rows[0].kind, 'supplement-only');
  const next = buildCSVImport(plan, base, 'mac');
  assert.equal(store(next.bundle).address, '臺北市虛構路1號'); assert.deepEqual(visit(next.bundle), before);
  const occupied = decide(await makePlan(next.bundle)); occupied.rows[0].choice = 'store:' + store(next.bundle).id; occupied.rows[0].fillFields = ['address'];
  assert.throws(() => buildCSVImport(occupied, next.bundle, 'mac'), /手動修改|補欄位選取/);
});

test('invalid, duplicate, mapped, empty, skipped, and excluded selections fail without modifying the bundle', async () => {
  const base = emptyBundle('invalid'), before = JSON.stringify(base);
  for (const columns of [[4, 4], [-1], [1], [6], [99], ['4'], null, {}]) {
    const plan = decide(await makePlan(base)); plan.rows[0].supplementColumns = columns;
    assert.throws(() => buildCSVImport(plan, base, 'mac'), /欄位選擇/);
    assert.equal(JSON.stringify(base), before);
  }
  const skipped = decide(await makePlan(base), [4]); skipped.rows[0].choice = 'skip';
  assert.throws(() => buildCSVImport(skipped, base, 'mac'), /略過|排除/);
  const excluded = await planReviewedCSV(await reviewed(raw, true), base); excluded.rows[0].supplementColumns = [4];
  assert.throws(() => buildCSVImport(excluded, base, 'mac'), /排除/);
});

test('legacy adopted supplements remain included and cannot be removed by new empty selections', async () => {
  const base = await first([4, 5]), before = store(base), plan = await makePlan(base);
  assert.equal(plan.rows[0].choice, 'skip');
  assert.deepEqual(csvSupplementChoices(plan, plan.rows[0], project(base)).map(field => field.included), [true, true]);
  plan.rows[0].choice = 'store:' + before.id;
  const next = buildCSVImport(plan, base, 'mac');
  assert.equal(next.summary.rows, 0); assert.deepEqual(store(next.bundle), before);
  const duplicate = [...before.csvSources, ...before.csvSources];
  assert.equal(csvSourceSupplements(duplicate).length, 2);
  const forged = structuredClone(before.csvSources); forged[0].supplements[0].text = '與原欄不符';
  assert.equal(csvSourceSupplements(forged).length, 1);
});

test('reviewed CSV late selection survives reviewed repeat shortcut, retaining exact partition and source history', async () => {
  const review = await reviewed(), base = emptyBundle('reviewed');
  const firstPlan = decide(await planReviewedCSV(review, base)), original = buildCSVImport(firstPlan, base, 'mac').bundle;
  const late = decide(await planReviewedCSV(review, original), [5]);
  const next = buildCSVImport(late, original, 'mac');
  assert.equal(next.summary.adoptedSupplements, 1); assert.deepEqual(visit(next.bundle), visit(original));
  const again = buildCSVImport(decide(await planReviewedCSV(review, next.bundle)), next.bundle, 'mac');
  assert.equal(again.summary.rows, 0); assert.equal(again.summary.sourceSnapshots, 1);
});

test('different branches and source contents never inherit another store selection', async () => {
  const base = await first([4]), changed = raw.replace('7654321', '7654322').replace('虛構欄位藥局', '虛構另一藥局').replace('虛構路1號', '虛構路2號');
  const plan = decide(await makePlan(base, changed), [5]);
  assert.equal(plan.rows[0].choice, 'new');
  assert.ok(csvSupplementChoices(plan, plan.rows[0], project(base)).every(item => !item.included));
  const result = buildCSVImport(plan, base, 'mac');
  assert.equal(result.summary.stores, 1); assert.equal(project(result.bundle).filter(item => item.type === 'store').length, 2);
  const changedText = decide(await makePlan(base, raw.replace('<不採用>', '新的補充')), [5]);
  assert.ok(csvSupplementChoices(changedText, changedText.rows[0], project(base)).every(item => !item.included));
});

test('stale previews and conflicting notes block supplement adoption; encryption and normal merge retain choices', async () => {
  const base = await first(), plan = decide(await makePlan(base), [4]), changed = change(base, 'store', { contact: '新的窗口' });
  assert.throws(() => buildCSVImport(plan, changed, 'mac'), /資料已在預覽後變更/);
  const old = visit(base), other = structuredClone(base);
  other.ops.push(revision('visit', old.id, { ...old.heads[0].data, text: '另一端' }, old.heads.map(head => head.id), 'phone'));
  const competing = change(base, 'visit', { text: '本端' }), conflict = merge(competing, other);
  const conflictPlan = decide(await makePlan(conflict), [4]);
  assert.throws(() => buildCSVImport(conflictPlan, conflict, 'mac'), /同步衝突/);
  const next = buildCSVImport(plan, base, 'mac').bundle, meta = newMeta(), key = await derive('synthetic-selection-password', meta), encrypted = await seal(next, key, meta);
  assert.ok(!JSON.stringify(encrypted).includes('第一段'));
  const decoded = await unseal(encrypted, key); assert.deepEqual(decoded, next);
  assert.deepEqual(csvSourceSupplements(store(merge(base, decoded)).csvSources), csvSourceSupplements(store(next).csvSources));
});
