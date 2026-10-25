import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, project, revision, validateBundle, b64, newMeta, derive, seal, unseal, merge } from '../public/core.js';
import { prepareCSV, planCSV, buildCSVImport, sop1Report, exportCSVPreview, mapKey } from '../public/csv.js';

// Entirely fictional fixtures; no production files, credentials, or network.
const encode = text => new TextEncoder().encode(text);
const url = id => `https://maps.google.com/?cid=${id}`;
const row = (name = '虛構甲藥局', id = '7654001', note = '原始備註', address = '臺北市虛構甲路1號', extra = '') => [name, note, url(id), address, extra, '2026-10-01'];
const csv = rows => ['Title,Note,URL,Address,其他文字,Visit Date', ...rows.map(cells => cells.map(value => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\r\n');
const file = (rows, name = '虛構清單.csv') => prepareCSV(name, encode(csv(rows)));
const records = (bundle, type) => project(bundle).filter(record => record.type === type);
async function plan(bundle, rows, name) { return planCSV([await file(rows, name)], bundle, { mode: 'new-only' }); }
const statuses = p => p.rows.map(row => row.newStoreOnly.status);
function select(p, indexes, columns = []) {
  for (const index of indexes) { p.rows[index].choice = 'new'; p.rows[index].supplementColumns = [...columns]; p.rows[index].sop1.extraAccepted = true; }
  return p;
}
async function seed(rows = [row()]) {
  const base = emptyBundle('new-only-fixture'), p = await planCSV([await file(rows)], base);
  for (const r of p.rows) { r.choice = 'new'; r.sop1.extraAccepted = true; }
  return buildCSVImport(p, base, 'fixture').bundle;
}
function change(base, type, data, options = {}) {
  const next = structuredClone(base), prior = records(base, type)[options.index || 0];
  next.ops.push(revision(type, prior.id, { ...prior.heads[0].data, ...data }, options.parents || prior.heads.map(head => head.id), 'other-device', options.deleted || false));
  return next;
}
function assertPreserved(base, next) {
  assert.deepEqual(next.ops.slice(0, base.ops.length), base.ops);
  for (const [key, value] of Object.entries(base.blobs)) assert.equal(next.blobs[key], value);
  const ids = new Set(base.ops.map(op => op.entity)), added = next.ops.slice(base.ops.length);
  assert.ok(added.every(op => !ids.has(op.entity) && !op.parents.length && !op.deleted && ['store', 'visit', 'source'].includes(op.type)));
  const stores = new Set(added.filter(op => op.type === 'store').map(op => op.entity));
  assert.ok(added.filter(op => op.type === 'visit').every(op => stores.has(op.data.store)));
  assert.deepEqual(records(next, 'store').filter(s => ids.has(s.id)), records(base, 'store'));
  assert.deepEqual(records(next, 'visit').filter(s => ids.has(s.id)), records(base, 'visit'));
  validateBundle(next);
}

test('new-only selects nothing by default and only explicitly selected new stores get new records', async () => {
  const base = change(change(await seed(), 'store', { contact: '', city: '' }), 'visit', { text: '人工內容', googleText: '已更新來源', sourceMissing: true, googleUpdatePending: true });
  const incoming = [row('虛構甲藥局', '7654001', '不可取代的新版CSV'), row('虛構乙藥局', '7654002', '新店乙'), row('虛構丙藥局', '7654003', '不勾丙'), row('虛構甲藥局', '7654004', '同名不同店', '臺北市疑慮路4號'), row('虛構乙藥局', '7654002', '新店乙')];
  // Give each unrelated candidate its own address.
  incoming[1][3] = incoming[4][3] = '臺北市虛構乙路2號'; incoming[2][3] = '臺北市虛構丙路3號';
  const p = await plan(base, incoming);
  // The two different rows sharing the old name are conservatively both review.
  assert.deepEqual(statuses(p), ['review', 'new', 'new', 'review', 'duplicate']);
  assert.ok(p.rows.every(r => r.choice === 'skip' && !r.fillFields.length));
  assert.equal(sop1Report(p, base).ready, true);
  select(p, [1]); const result = buildCSVImport(p, base, 'mac');
  assert.equal(result.summary.stores, 1); assert.equal(result.summary.notes, 1); assert.equal(result.summary.skipped, 4);
  assert.equal(result.summary.updatedNotes, 0); assert.equal(result.summary.filledFields, 0); assert.equal(result.summary.mergeGroups, 0);
  assertPreserved(base, result.bundle);
  assert.equal(result.bundle.blobs[p.files[0].blob], b64(encode(csv(incoming))));
  assert.equal(records(result.bundle, 'source').at(-1).rows, 5);
});

test('unique stable current identity is existing even with a changed note or blank fill opportunity', async () => {
  const base = change(await seed(), 'store', { address: '', city: '', contact: '' });
  const p = await plan(base, [row('虛構甲藥局', '7654001', '後來Google內容')]);
  assert.deepEqual(statuses(p), ['existing']);
  const result = buildCSVImport(p, base, 'mac');
  assert.equal(result.summary.stores, 0); assert.equal(result.summary.rows, 0); assert.equal(result.summary.sourceSnapshots, 1);
  assertPreserved(base, result.bundle);
  const preview = exportCSVPreview(p, base);
  assert.equal(preview.mode, 'new-only'); assert.equal(preview.rows[0].newStoreOnly.status, 'existing');
});

test('only selected supplements are adopted on new stores; raw unselected content stays in the snapshot', async () => {
  const base = emptyBundle('extras'), p = await plan(base, [row('虛構新藥局', '7654111', '新筆記', '臺北市虛構新路1號', '  未清理補充\r\n第二行  ')]);
  p.rows[0].choice = 'new'; p.rows[0].supplementColumns = [4];
  assert.throws(() => buildCSVImport(p, base, 'mac'), /核對勾選結果/);
  p.rows[0].sop1.extraAccepted = true; p.rows[0].textFields[4].text = '不可採用的預覽篡改';
  const result = buildCSVImport(p, base, 'mac');
  assert.deepEqual(records(result.bundle, 'store')[0].csvSources[0].supplements, [{ column: 4, header: '其他文字', text: '  未清理補充\r\n第二行  ', kind: 'supplement' }]);
  assert.equal(result.summary.adoptedSupplements, 1);
  assertPreserved(base, result.bundle);
  const p2 = select(await plan(base, [row('虛構新藥局', '7654111', '新筆記', '臺北市虛構新路1號', '不採用')]), [0]);
  const result2 = buildCSVImport(p2, base, 'mac');
  assert.deepEqual(records(result2.bundle, 'store')[0].csvSources[0].supplements, []);
  assert.equal(records(result2.bundle, 'store')[0].csvSources[0].cells[4], '不採用');
});

test('exact raw duplicate across lists has one candidate, one list link, and every complete source snapshot', async () => {
  const base = emptyBundle('lists'), files = [await file([row()], '虛構清單甲.csv'), await file([row()], '虛構清單乙.csv')];
  const p = await planCSV(files, base, { mode: 'new-only' });
  assert.deepEqual(statuses(p), ['new', 'duplicate']);
  assert.match(p.rows[1].newStoreOnly.reason, /只建立所選列的清單關聯/);
  const result = buildCSVImport(select(p, [0]), base, 'mac');
  assert.equal(result.summary.sourceSnapshots, 2); assert.equal(result.summary.stores, 1);
  assert.deepEqual(records(result.bundle, 'store')[0].lists, [files[0].list]);
  assert.equal(records(result.bundle, 'store')[0].csvSources.length, 1);
  assertPreserved(base, result.bundle);
});

test('same-batch identity/name/address collisions are symmetric when any original value differs', async () => {
  const base = emptyBundle('collisions');
  for (const [column, value] of [[0, '虛構另名藥局'], [1, '不同備註'], [2, url('7654999')], [3, '臺北市虛構另址9號'], [4, '不同補充'], [5, '2026-10-02']]) {
    const first = row(), second = row(); second[column] = value;
    for (const rows of [[first, second], [second, first]]) {
      const p = await plan(base, rows); assert.deepEqual(statuses(p), ['review', 'review']);
      assert.equal(sop1Report(p, base).ready, true);
      p.rows[0].choice = 'new'; assert.throws(() => buildCSVImport(p, base, 'mac'), /新店候選/);
    }
  }
});

test('deleted, conflicted, merged and identity-pending stores cannot be treated as new or revived', async () => {
  const original = await seed(), initial = records(original, 'store')[0];
  const alternatives = [change(original, 'store', {}, { deleted: true }), change(original, 'store', { csvIdentityPending: true }), change(original, 'store', { mergedInto: 'fictional-survivor' })];
  const left = change(original, 'store', { contact: '左端修改' }), right = change(original, 'store', { contact: '右端修改' });
  alternatives.push(merge(left, right));
  for (const base of alternatives) {
    const p = await plan(base, [row()]); assert.deepEqual(statuses(p), ['review']);
    assert.ok(p.rows[0].newStoreOnly.candidateStoreIds.includes(initial.id));
    p.rows[0].choice = 'new'; assert.throws(() => buildCSVImport(p, base, 'mac'), /新店候選/);
  }
});

test('historical profiles, aliases and identity rulings exclude new candidates after current details change', async () => {
  const original = await seed();
  const renamed = change(original, 'store', { name: '虛構現在新名藥局', address: '臺北市虛構現在路8號', mapUrl: url('7654888'), csvSources: [], csvAliases: ['虛構曾用別名'], csvIdentityRules: [{ decision: 'same', mapKey: mapKey(url('7654777')), label: '虛構核對', source: '虛構測試', decidedAt: '2026-10-25T00:00:00Z', names: ['虛構裁定名稱', '虛構舊裁定名稱'], addresses: ['臺北市虛構裁定路7號'] }] });
  for (const incoming of [row(), row('虛構曾用別名', '7654666', '', '臺北市虛構別名路6號'), row('虛構裁定名稱', '7654555', '', '臺北市虛構異路5號'), row('虛構完全另名', '7654777', '', '臺北市虛構異路4號'), row('虛構完全另名', '7654444', '', '臺北市虛構裁定路7號')]) {
    assert.deepEqual(statuses(await plan(renamed, [incoming])), ['review']);
  }
});

test('same historical source fingerprint is conservative evidence even with custom headers and changed mapping', async () => {
  const raw = '自訂甲,自訂乙,自訂丙\n虛構原名藥局,虛構另一名藥局,https://maps.google.com/?cid=7654333';
  const source = await prepareCSV('虛構自訂.csv', encode(raw)); source.mapping.name = 0; source.mapping.url = 2; source.mapping.note = -1;
  const empty = emptyBundle('custom'), p = await planCSV([source], empty); p.rows[0].sop1.extraAccepted = true;
  const old = buildCSVImport(p, empty, 'mac').bundle;
  const base = change(old, 'store', { name: '虛構現名藥局', mapUrl: url('7654222'), address: '臺北市虛構現址2號', csvSources: [] });
  const incoming = structuredClone(source); incoming.mapping.name = 1; incoming.mapping.url = -1; incoming.mapping.address = 0;
  const candidate = await planCSV([incoming], base, { mode: 'new-only' });
  assert.deepEqual(statuses(candidate), ['review']);
});

test('ambiguous or invalid rows stay review without blocking separate selected new candidates', async () => {
  const base = emptyBundle('review'), f = await prepareCSV('虛構待查.csv', encode('Title,Note,URL,Address,Visit Date\n只有名稱藥局,備註,,,\n虛構連結藥局,,http://maps.google.com/?cid=999,臺北市虛構連結路9號,\n虛構日期藥局,,https://maps.google.com/?cid=888,臺北市虛構日期路8號,01/02/2026\n,沒有名稱,https://maps.google.com/?cid=777,,\n虛構可選藥局,,https://maps.google.com/?cid=666,臺北市虛構可選路6號,'));
  const p = await planCSV([f], base, { mode: 'new-only' });
  assert.deepEqual(statuses(p), ['review', 'review', 'review', 'review', 'new']);
  const next = buildCSVImport(select(p, [4]), base, 'mac');
  assert.equal(next.summary.stores, 1); assert.equal(next.summary.notes, 0); assert.equal(next.summary.skipped, 4);
  assertPreserved(base, next.bundle);
});

test('classification flags, target redirections, fills, merge rulings and invalid supplement choices cannot bypass new-only', async () => {
  const base = await seed();
  for (const mutate of [p => { p.rows[0].newStoreOnly = { status: 'new' }; p.rows[0].choice = 'new'; }, p => p.rows[0].choice = 'store:' + records(base, 'store')[0].id, p => p.rows[0].choice = 'row:0:0', p => p.rows[0].fillFields = ['address'], p => p.reviewGroups = [], p => p.reviewPackageId = 'forged', p => p.rows[0].review = {}, p => p.rows[0].reviewExcluded = false]) {
    const p = await plan(base, [row()]); mutate(p); assert.equal(sop1Report(p, base).ready, false); assert.throws(() => buildCSVImport(p, base, 'mac'));
  }
  const empty = emptyBundle('invalid-columns');
  for (const columns of [[4, 4], [-1], [1], [99], ['4'], null, {}]) {
    const p = select(await plan(empty, [row('虛構新藥局', '7654111', '', '臺北市虛構新路1號', '補充')]), [0]); p.rows[0].supplementColumns = columns;
    assert.throws(() => buildCSVImport(p, empty, 'mac'), /欄位選擇/);
  }
  const skipped = await plan(empty, [row('虛構新藥局', '7654111', '', '臺北市虛構新路1號', '補充')]); skipped.rows[0].supplementColumns = [4];
  assert.throws(() => buildCSVImport(skipped, empty, 'mac'), /略過/);
});

test('raw source/mapping/row tampering, cloned plans, changed mode and stale base fail atomically', async () => {
  const base = emptyBundle('tampering'), before = JSON.stringify(base);
  for (const mutate of [p => p.rows[0].data.name = '篡改名稱', p => p.rows[0].note = '篡改內文', p => p.rows[0].fingerprint = '0'.repeat(64), p => p.rows.splice(0, 1), p => p.files[0].mapping.note = -1, p => p.files[0].rows[0].cells[0] = '篡改來源', p => p.files[0].bytes[0] = 0, p => p.mode = 'standard']) {
    const p = select(await plan(base, [row()]), [0]); mutate(p); assert.throws(() => buildCSVImport(p, base, 'mac')); assert.equal(JSON.stringify(base), before);
  }
  const p = select(await plan(base, [row()]), [0]);
  assert.throws(() => buildCSVImport(structuredClone(p), base, 'mac'), /預覽已失效/);
  const changed = structuredClone(base); changed.ops.push(revision('store', 's-other', { name: '虛構別店', city: '', district: '', address: '', mapUrl: '', channel: '', attr: '', contact: '' }, [], 'other'));
  assert.throws(() => buildCSVImport(p, changed, 'mac'), /資料已變更/);
  const invalidFile = await file([row()]); invalidFile.rows[0].cells[0] = '解析內容不符';
  await assert.rejects(planCSV([invalidFile], base, { mode: 'new-only' }), /原始內容/);
});

test('reimport skips previously selected stores but previously unselected snapshot rows remain eligible', async () => {
  const base = emptyBundle('reimport'), rows = [row(), row('虛構乙藥局', '7654002', '乙筆記', '臺北市虛構乙路2號')];
  const first = buildCSVImport(select(await plan(base, rows), [0]), base, 'mac').bundle;
  const repeated = await plan(first, rows); assert.deepEqual(statuses(repeated), ['existing', 'new']);
  const next = buildCSVImport(select(repeated, [1]), first, 'mac').bundle; assertPreserved(first, next);
  assert.deepEqual(statuses(await plan(next, rows)), ['existing', 'existing']);
  const sourceOnly = buildCSVImport(await plan(base, rows), base, 'mac').bundle;
  assert.deepEqual(statuses(await plan(sourceOnly, rows)), ['new', 'new']);
});

test('new-only output survives encryption and normal merge without rewriting any original entity', async () => {
  const base = await seed(), p = select(await plan(base, [row('虛構加密新藥局', '7654123', '  原文\r\n第二行  ', '臺北市虛構加密路1號', '補充')]), [0], [4]);
  const next = buildCSVImport(p, base, 'mac').bundle, meta = newMeta(), key = await derive('synthetic-new-only-password', meta), encrypted = await seal(next, key, meta);
  assert.ok(!JSON.stringify(encrypted).includes('虛構加密新藥局'));
  const decoded = await unseal(encrypted, key); assert.deepEqual(decoded, next); assertPreserved(base, decoded);
  const merged = merge(base, decoded); assert.equal(records(merged, 'store').length, 2); assert.equal(records(merged, 'visit').length, 2);
});

test('1500-row boundary scans multi-version history and keeps current exact matches excluded from selection', async () => {
  let base = await seed();
  for (let i = 0; i < 80; i++) base = change(base, 'store', { contact: `虛構歷史窗口${i}` });
  const rows = [row(), ...Array.from({ length: 1499 }, (_, i) => row(`虛構效能${i}藥局`, String(8000000 + i), '', `臺北市虛構效能路${i + 2}號`))];
  const p = await plan(base, rows); assert.equal(p.rows.length, 1500); assert.equal(p.rows[0].newStoreOnly.status, 'existing');
  assert.equal(p.rows.filter(r => r.newStoreOnly.status === 'new').length, 1499);
  assert.equal(sop1Report(p, base).ready, true);
  const next = buildCSVImport(select(p, [1499]), base, 'mac').bundle; assertPreserved(base, next);
  await assert.rejects(plan(base, [...rows, row('虛構超額藥局', '9999999')]), /1,500/);
});
