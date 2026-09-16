import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCSV, parseCSV, guessMapping, originalDate, prepareCSV, planCSV, buildCSVImport, identity, normalizeListName } from '../public/csv.js';
import { emptyBundle, project, validateBundle, revision, unb64, newMeta, derive, seal, unseal, merge } from '../public/core.js';
const bytes = s => new TextEncoder().encode(s);
const csv = 'Title,Note,URL,Address\r\n匯入測試點,"  測試稱呼說：""先確認""，再追蹤。\r\n第二行保持原文  ",https://maps.google.com/?cid=1234567,臺北市測試路一號\r\n';
const fixture = async (s = csv, filename = '虛構藥局.csv') => prepareCSV(filename, bytes(s));
test('quoted commas, escaped quotes, embedded CRLF and whitespace survive exactly', () => {
  const parsed = parseCSV(csv); assert.equal(parsed.rows.length, 1); assert.equal(parsed.rows[0].line, 2);
  assert.equal(parsed.rows[0].cells[1], '  測試稱呼說："先確認"，再追蹤。\r\n第二行保持原文  ');
  assert.equal(parseCSV('Title,Note\nA,"one\ntwo"\nB,three').rows[1].line, 4);
});
test('CSV delimiter/BOM support and malformed input fails without truncation', () => {
  assert.equal(parseCSV('\uFEFFTitle;Note\r\nA;B').delimiter, ';');
  assert.equal(parseCSV('sep=;\r\nTitle;Note\r\nA;B').rows[0].line, 3);
  assert.equal(parseCSV('Title\tNote\nA\tB').delimiter, '\t');
  assert.throws(() => parseCSV('Title,Note\nA,"unfinished'));
  assert.throws(() => parseCSV('Title,Note\nA,B,C'));
});
test('UTF-16 BOM and Big5 decode, invalid UTF-8 is not silently replaced', () => {
  const utf16 = new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('名稱,備註\n測試,中文', 'utf16le')]));
  assert.equal(decodeCSV(utf16), '名稱,備註\n測試,中文');
  assert.equal(decodeCSV(new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5]), 'big5'), '中文');
  assert.throws(() => decodeCSV(new Uint8Array([0xff, 0xff])));
});
test('unknown/missing visit dates are never replaced with import time', async () => {
  assert.equal(guessMapping(['Title', 'Note', 'Created Time']).date, -1);
  assert.equal(originalDate('01/02/2025'), ''); assert.equal(originalDate('2025/02/29'), ''); assert.equal(originalDate('2024/2/29'), '2024-02-29');
  const b = emptyBundle('test'); const result = buildCSVImport(await planCSV([await fixture()], b), b, 'mac');
  assert.equal(project(result.bundle).find(r => r.type === 'visit').date, '');
  assert.equal(project(result.bundle).filter(r => r.type === 'person').length, 0);
});
test('import preserves raw bytes, original fields, notes and encrypts all provenance', async () => {
  const b = emptyBundle('test'), f = await fixture(), result = buildCSVImport(await planCSV([f], b), b, 'mac');
  const record = project(result.bundle).find(r => r.type === 'visit');
  assert.equal(record.text, parseCSV(csv).rows[0].cells[1]); assert.deepEqual(record.csvSources[0].cells, f.rows[0].cells);
  assert.deepEqual(unb64(result.bundle.blobs[f.blob]), bytes(csv)); validateBundle(result.bundle);
  const meta = newMeta(), key = await derive('testing-csv-password', meta), encrypted = await seal(result.bundle, key, meta);
  assert.ok(!JSON.stringify(encrypted).includes('測試稱呼')); assert.deepEqual(await unseal(encrypted, key), result.bundle);
});
test('Finder download suffixes map to one Google note stream and changes create versions', async () => {
  assert.equal(normalizeListName('CS清單(17).csv'), 'CS清單');
  const base = emptyBundle('test'), firstFile = await fixture(csv, 'CS清單(3).csv'), first = buildCSVImport(await planCSV([firstFile], base), base, 'mac');
  const again = await planCSV([await fixture(csv, 'CS清單(4).csv')], first.bundle); assert.equal(again.rows[0].choice, 'skip');
  const noChange = buildCSVImport(again, first.bundle, 'mac'); assert.equal(noChange.bundle.ops.length, first.bundle.ops.length);
  const changed = await planCSV([await fixture(csv.replace('再追蹤', '下次再確認'), 'CS清單(4).csv')], first.bundle);
  assert.ok(changed.rows[0].choice.startsWith('store:'));
  const second = buildCSVImport(changed, first.bundle, 'mac'); assert.equal(second.summary.stores, 0); assert.equal(second.summary.notes, 0); assert.equal(second.summary.updatedNotes, 1);
  const visits = project(second.bundle).filter(r => r.type === 'visit'); assert.equal(visits.length, 1); assert.equal(visits[0].versions.length, 2); assert.match(visits[0].text, /下次再確認/);
  const blankCSV = 'Title,Note,URL,Address\r\n匯入測試點,,https://maps.google.com/?cid=1234567,臺北市測試路一號\r\n';
  const missing = buildCSVImport(await planCSV([await fixture(blankCSV, 'CS清單(5).csv')], second.bundle), second.bundle, 'mac');
  const preserved = project(missing.bundle).find(r => r.type === 'visit'); assert.equal(missing.summary.missingNotes, 1); assert.equal(preserved.sourceMissing, true); assert.match(preserved.text, /下次再確認/); assert.equal(preserved.versions.length, 3);
  const restored = buildCSVImport(await planCSV([await fixture(csv.replace('再追蹤', '下次再確認'), 'CS清單(6).csv')], missing.bundle), missing.bundle, 'mac');
  assert.equal(restored.summary.restoredNotes, 1); assert.equal(project(restored.bundle).find(r => r.type === 'visit').sourceMissing, false);
});
test('same names never auto-merge without evidence; generic map searches are not identifiers', async () => {
  assert.equal(identity({ name: '大樹藥局', mapUrl: 'https://www.google.com/maps?q=大樹藥局' }), '');
  const b = emptyBundle('test'), f = await fixture('Title,Note\n相同藥局,A\n相同藥局,B'), plan = await planCSV([f], b);
  assert.equal(plan.rows[0].choice, 'review'); assert.equal(plan.rows[1].choice, 'review'); assert.throws(() => buildCSVImport(plan, b, 'mac'));
  plan.rows.forEach(row => row.choice = 'new'); assert.equal(buildCSVImport(plan, b, 'mac').summary.stores, 2);
});
test('matching rows across distinct source lists join one store but keep one note stream per list', async () => {
  const b = emptyBundle('test'), f1 = await fixture(), f2 = await fixture(csv.replace('Title,Note,URL,Address', 'Name,Note,URL,Address'), '第二個清單.csv');
  const plan = await planCSV([f1, f2], b); assert.ok(plan.rows[1].choice.startsWith('row:'));
  const r = buildCSVImport(plan, b, 'mac'); assert.equal(r.summary.stores, 1); assert.equal(r.summary.notes, 2); assert.equal(r.summary.duplicateNotes, 0);
  assert.equal(project(r.bundle).filter(x => x.type === 'visit').length, 2);
  assert.equal(project(r.bundle).find(x => x.type === 'store').lists.length, 2);
});
test('a Google update does not overwrite text manually edited in the App', async () => {
  const base = emptyBundle('test'), first = buildCSVImport(await planCSV([await fixture(csv, 'CS清單.csv')], base), base, 'mac');
  const bundle = structuredClone(first.bundle), old = project(bundle).find(r => r.type === 'visit');
  bundle.ops.push(revision('visit', old.id, { ...old.heads[0].data, text: '我在 App 補充的文字' }, old.heads.map(h => h.id), 'phone'));
  const changedCSV = csv.replace('再追蹤', 'Google 新版本');
  const plan = await planCSV([await fixture(changedCSV, 'CS清單(2).csv')], bundle);
  assert.throws(() => buildCSVImport(plan, bundle, 'mac'), /手動修改/);
  plan.rows[0].sop1.manualAccepted = true;
  const updated = buildCSVImport(plan, bundle, 'mac');
  const current = project(updated.bundle).find(r => r.type === 'visit');
  assert.equal(current.text, '我在 App 補充的文字'); assert.match(current.googleText, /Google 新版本/); assert.equal(current.googleUpdatePending, true); assert.equal(current.versions.length, 3);
});
test('linking preserves current store data and creates a normal conflict if another device edited offline', async () => {
  const b = emptyBundle('test'), d = { name: '原名', city: '', district: '大安區', channel: '獨立', contact: '保留窗口', attr: '', mapUrl: 'https://maps.google.com/?cid=1234567', address: '' };
  b.ops.push(revision('store', 's1', d, [], 'mac')); const p = await planCSV([await fixture()], b);
  assert.equal(p.rows[0].choice, 'review'); p.rows[0].choice = 'store:s1';
  const result = buildCSVImport(p, b, 'mac');
  assert.equal(project(result.bundle)[0].contact, '保留窗口'); assert.equal(project(result.bundle)[0].name, '原名');
  const other = structuredClone(b); other.ops.push(revision('store', 's1', { ...d, contact: '手機修改' }, [b.ops[0].id], 'phone'));
  assert.equal(project(merge(result.bundle, other)).find(r => r.type === 'store').conflict, true);
});
test('invalid rows cannot partially commit and schema 1 backups remain readable', async () => {
  const b = emptyBundle('test'); b.schema = 1; validateBundle(b);
  const p = await planCSV([await fixture('Title,Note\n合法,A\n,B')], b); p.rows[1].choice = 'new';
  const before = JSON.stringify(b); assert.throws(() => buildCSVImport(p, b, 'mac')); assert.equal(JSON.stringify(b), before);
  p.rows[0].choice = 'new'; p.rows[1].choice = 'skip'; const next = buildCSVImport(p, b, 'mac').bundle; assert.equal(next.schema, 2); assert.equal(merge(b, next).schema, 2);
  delete next.blobs[Object.keys(next.blobs)[0]]; assert.throws(() => validateBundle(next));
});
