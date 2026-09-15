import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, project, revision, merge, validateBundle, newMeta, derive, seal, unseal, unb64 } from '../public/core.js';
import { scanQuality, duplicateEvidence, mapKey, profileIssues, setDistinctReview, distinctReviewed, fillProfile, sourceSuggestions, prepareCSV, planCSV, buildCSVImport, profileChanges, guessMapping } from '../public/csv.js';
const bytes = value => new TextEncoder().encode(value);
const file = (text, name = '虛構清單.csv') => prepareCSV(name, bytes(text));
const profile = overrides => ({ name: '虛構測試藥局', address: '', city: '', district: '', channel: '', contact: '', attr: '', mapUrl: '', ...overrides });
function fixture(...stores) {
  const b = emptyBundle('quality-fixture');
  stores.forEach((s, i) => b.ops.push(revision('store', 's' + i, profile(s), [], 'mac')));
  return b;
}
const current = (b, id = 's0') => project(b).find(r => r.type === 'store' && r.id === id);
const importCSV = async (b, text, name) => buildCSVImport(await planCSV([await file(text, name)], b), b, 'mac');

test('quality scan uses comparison-only normalization and explains different branches without rewriting data', () => {
  const b = fixture({ name: '臺安 Ａ 藥局', address: '臺北市甲路1號' }, { name: '台安A藥局', address: '新北市乙路2號' }, { name: '另一虛構門市', address: '臺北市甲路1號' });
  const before = JSON.stringify(b), report = scanQuality(project(b));
  assert.equal(report.pairs.length, 2); assert.match(report.pairs[0].reasons.join(), /格式差異/); assert.match(report.pairs[0].reasons.join(), /地址不同/);
  assert.equal(JSON.stringify(b), before); assert.equal(project(b).length, 3);
});
test('generic searches, unrelated domains and http links never become map identity evidence', () => {
  for (const url of ['https://www.google.com/maps?q=藥局', 'https://evil.example/?cid=1234567', 'http://maps.google.com/?cid=1234567']) assert.equal(mapKey(url), '');
  assert.equal(mapKey('https://maps.google.com/?cid=0012345&utm_source=test'), mapKey('https://www.google.com/?cid=12345'));
  assert.equal(duplicateEvidence(profile({ name: '甲', mapUrl: 'https://www.google.com/maps?q=藥局' }), profile({ name: '乙', mapUrl: 'https://www.google.com/maps?q=藥局' })).length, 0);
});
test('required, optional and contradictory profile issues are distinguished without inventing values', () => {
  const p = profile({ city: '新北市', address: '臺北市甲路1號' });
  const issues = profileIssues(p);
  assert.ok(issues.some(i => i.kind === 'missing' && i.field === 'contact'));
  assert.ok(issues.some(i => i.kind === 'warning' && i.field === 'city'));
  assert.ok(!issues.some(i => i.kind === 'error'));
  assert.ok(profileIssues(profile({ name: '' })).some(i => i.kind === 'error' && i.field === 'name'));
  assert.equal(p.contact, '');
});
test('different-store decisions sync, retain history and can be withdrawn as new revisions', async () => {
  const b = fixture({ address: '甲路1號' }, { address: '乙路2號' });
  const marked = setDistinctReview(b, 's0', 's1', 'phone');
  assert.equal(scanQuality(project(marked)).pairs.length, 0); assert.equal(scanQuality(project(marked)).reviewed.length, 1);
  const merged = merge(b, marked); assert.equal(distinctReviewed(current(merged), current(merged, 's1')), true);
  const meta = newMeta(), key = await derive('fictional-quality-password', meta);
  const envelope = await seal(marked, key, meta); assert.deepEqual(await unseal(envelope, key), marked);
  const restored = setDistinctReview(merged, 's0', 's1', 'mac', true);
  assert.equal(scanQuality(project(restored)).pairs.length, 1);
  assert.ok(restored.ops.length > marked.ops.length); for (const original of b.ops) assert.deepEqual(restored.ops.find(o => o.id === original.id), original);
});
test('a changed identity resurfaces the pair; filling a contact does not discard a valid review', () => {
  const b = setDistinctReview(fixture({ address: '甲路1號' }, { address: '乙路2號' }), 's0', 's1', 'mac');
  const filled = fillProfile(b, 's0', { contact: '虛構窗口' }, 'phone', current(b).heads.map(h => h.id));
  assert.equal(scanQuality(project(filled)).reviewed.length, 1);
  const d = current(filled, 's1'); filled.ops.push(revision('store', d.id, { ...d.heads[0].data, address: '丙路3號' }, d.heads.map(h => h.id), 'mac'));
  assert.equal(scanQuality(project(filled)).pairs.length, 1);
});
test('reviewed pairs do not consume the pending-pair display limit', () => {
  const b = setDistinctReview(fixture({ address: '一號' }, { address: '二號' }, { address: '三號' }), 's0', 's1', 'mac');
  const report = scanQuality(project(b), 1);
  assert.equal(report.reviewed.length, 1); assert.equal(report.pairs.length, 1); assert.equal(report.limited, true);
  const late = setDistinctReview(fixture({ address: '一號' }, { address: '二號' }, { address: '三號' }, { address: '四號' }), 's2', 's3', 'mac');
  assert.equal(scanQuality(project(late), 1).reviewed.length, 1, 'saved decisions remain accessible beyond the pending-pair cutoff');
});
test('deleted and conflicted stores are excluded from review and cannot be filled silently', () => {
  const b = fixture({}, {}), s = current(b), other = structuredClone(b);
  other.ops.push(revision('store', s.id, { ...s.heads[0].data, contact: '甲' }, s.heads.map(h => h.id), 'phone'));
  b.ops.push(revision('store', s.id, { ...s.heads[0].data, contact: '乙' }, s.heads.map(h => h.id), 'mac'));
  const conflicted = merge(b, other); assert.equal(scanQuality(project(conflicted)).conflicts.length, 1);
  assert.throws(() => setDistinctReview(conflicted, 's0', 's1', 'mac'));
  assert.throws(() => fillProfile(conflicted, 's0', { address: '地址' }, 'mac', []));
  const deleted = fixture({}, {}), first = current(deleted); deleted.ops.push(revision('store', first.id, first.heads[0].data, first.heads.map(h => h.id), 'mac', true));
  assert.equal(scanQuality(project(deleted)).stores, 1); assert.throws(() => setDistinctReview(deleted, 's0', 's1', 'phone'));
});
test('profile fill preserves originals, provenance and unrelated visits; concurrent edits remain conflicts', async () => {
  const first = await importCSV(emptyBundle('quality-fixture'), 'Title,Note,URL\n虛構測試藥局,"  原文,\n第二行  ",https://maps.google.com/?cid=1234567');
  const s = project(first.bundle).find(r => r.type === 'store'), before = JSON.stringify(first.bundle), visit = project(first.bundle).find(r => r.type === 'visit');
  const filled = fillProfile(first.bundle, s.id, { address: '新填地址', contact: '窗口' }, 'phone', s.heads.map(h => h.id));
  assert.equal(JSON.stringify(first.bundle), before); assert.deepEqual(current(filled, s.id).csvSources, s.csvSources);
  assert.deepEqual(project(filled).find(r => r.type === 'visit'), visit); assert.deepEqual(filled.blobs, first.bundle.blobs);
  const other = structuredClone(first.bundle); other.ops.push(revision('store', s.id, { ...s.heads[0].data, contact: '另一台的窗口' }, s.heads.map(h => h.id), 'mac'));
  assert.equal(current(merge(filled, other), s.id).conflict, true);
  assert.throws(() => fillProfile(filled, s.id, { address: '覆蓋' }, 'mac', current(filled, s.id).heads.map(h => h.id)));
  assert.throws(() => fillProfile(filled, s.id, { district: '甲區' }, 'mac', s.heads.map(h => h.id)));
  assert.throws(() => fillProfile(first.bundle, s.id, { name: '改名' }, 'mac', s.heads.map(h => h.id)));
});
test('CSV sources offer multiple explicit suggestions and do not fill anything on scan', async () => {
  const b = fixture({ mapUrl: 'https://maps.google.com/?cid=1234567' });
  const text = address => 'Title,Address,URL\n虛構測試藥局,' + address + ',https://maps.google.com/?cid=1234567';
  const first = await importCSV(b, text('甲地址')), second = await importCSV(first.bundle, text('乙地址'), '另一清單.csv');
  const s = current(second.bundle), before = JSON.stringify(second.bundle);
  const suggestions = sourceSuggestions(s);
  assert.deepEqual(suggestions.address.map(s => s.value), ['甲地址', '乙地址']);
  assert.ok(suggestions.address.every(s => s.line === 2 && s.file.endsWith('.csv')));
  assert.equal(s.address, ''); assert.equal(JSON.stringify(second.bundle), before);
});
test('ambiguous headers require mapping, duplicate assignments and out-of-range assignments fail before import', async () => {
  const f = await file('Title,Name,Note,Note,\n甲,乙,A,B,C');
  assert.equal(f.mapping.name, -1); assert.equal(f.mapping.note, -1); assert.ok(f.warnings.length >= 3);
  await assert.rejects(planCSV([f], emptyBundle('q')), /指定藥局名稱/);
  f.mapping.name = 0; f.mapping.note = 0; await assert.rejects(planCSV([f], emptyBundle('q')), /重複對應/);
  f.mapping.note = 99; await assert.rejects(planCSV([f], emptyBundle('q')), /超出範圍/);
  assert.equal(guessMapping(['Title', '拜訪窗口']).contact, 1);
});
test('existing data and all files in a batch share conservative duplicate evidence', async () => {
  const b = fixture({ name: '臺安 Ａ 藥局', address: '甲路1號' });
  const p = await planCSV([await file('Title,Note\n台安A藥局,A'), await file('Title,Note\n台安Ａ藥局,B', '另一清單.csv')], b);
  assert.equal(p.rows[0].choice, 'review'); assert.equal(p.rows[1].choice, 'review');
  assert.ok(p.rows[1].candidates.some(c => c.choice.startsWith('store:')));
  assert.ok(p.rows[1].candidates.some(c => c.choice.startsWith('row:')));
  const generic = fixture({ name: '甲', mapUrl: 'https://www.google.com/maps?q=藥局' });
  const plan = await planCSV([await file('Title,URL\n乙,https://www.google.com/maps?q=藥局')], generic);
  assert.equal(plan.rows[0].choice, 'review');
});
test('identical CSV rows in different lists preserve both streams; repeating a list stays idempotent', async () => {
  const text = 'Title,Note,URL\n虛構測試藥局,原文,https://maps.google.com/?cid=1234567', b = emptyBundle('q');
  const a = await file(text, '甲清單.csv'), c = await file(text, '乙清單.csv');
  const result = buildCSVImport(await planCSV([a, c], b), b, 'mac');
  assert.equal(result.summary.stores, 1); assert.equal(result.summary.notes, 2);
  assert.equal(project(result.bundle).filter(r => r.type === 'visit').length, 2);
  const again = buildCSVImport(await planCSV([a, c], result.bundle), result.bundle, 'mac'); assert.equal(again.bundle.ops.length, result.bundle.ops.length);
});
test('unmapped notes preserve both text and existing sourceMissing state', async () => {
  const text = 'Title,Note,URL\n虛構測試藥局,原文,https://maps.google.com/?cid=1234567';
  const first = await importCSV(emptyBundle('q'), text), unmapped = await file(text.replace('原文', '新的來源字'));
  unmapped.mapping.note = -1;
  const before = project(first.bundle).find(r => r.type === 'visit');
  const plan = await planCSV([unmapped], first.bundle);
  assert.throws(() => buildCSVImport(plan, first.bundle, 'mac'), /其他非空白文字欄/);
  plan.rows[0].sop1.extraAccepted = true;
  const next = buildCSVImport(plan, first.bundle, 'mac');
  assert.deepEqual(project(next.bundle).find(r => r.type === 'visit'), before);
  const missing = await importCSV(first.bundle, text.replace('原文', ''));
  const secondPlan = await planCSV([unmapped], missing.bundle); secondPlan.rows[0].sop1.extraAccepted = true;
  const kept = buildCSVImport(secondPlan, missing.bundle, 'mac');
  assert.equal(project(kept.bundle).find(r => r.type === 'visit').sourceMissing, true);
});
test('CSV fill is opt-in, previews differences and never overwrites existing nonempty fields', async () => {
  const b = fixture({ city: '原縣市', mapUrl: 'https://maps.google.com/?cid=1234567' });
  const f = await file('Title,Address,City,Contact,URL\n虛構測試藥局,甲地址,新縣市,甲窗口,https://maps.google.com/?cid=1234567');
  const p = await planCSV([f], b), changes = profileChanges(p.rows[0], project(b));
  assert.equal(changes.find(c => c.field === 'city').fillable, false); assert.equal(changes.find(c => c.field === 'address').fillable, true);
  assert.equal(current(buildCSVImport(p, b, 'mac').bundle).address, '');
  p.rows[0].fillFields = ['address', 'contact'];
  const next = buildCSVImport(p, b, 'mac'); assert.equal(next.summary.filledFields, 2);
  assert.equal(current(next.bundle).city, '原縣市'); assert.equal(current(next.bundle).address, '甲地址');
  assert.deepEqual(unb64(next.bundle.blobs[f.blob]), f.bytes);
  p.rows[0].fillFields.push('city'); assert.throws(() => buildCSVImport(p, b, 'mac'), /補欄位選取/);
});
test('conflicting batch fills, stale previews and conflicted notes fail atomically', async () => {
  const b = fixture({ mapUrl: 'https://maps.google.com/?cid=1234567' }), before = JSON.stringify(b);
  const csv = address => 'Title,Note,Address,URL\n虛構測試藥局,原文,' + address + ',https://maps.google.com/?cid=1234567';
  const p = await planCSV([await file(csv('甲')), await file(csv('乙'), '另一清單.csv')], b);
  p.rows.forEach(r => r.fillFields = ['address']);
  assert.throws(() => buildCSVImport(p, b, 'mac'), /本批有不同補值/); assert.equal(JSON.stringify(b), before);
  const changed = fillProfile(b, 's0', { contact: '新窗口' }, 'phone', current(b).heads.map(h => h.id));
  assert.throws(() => buildCSVImport(p, changed, 'mac'), /預覽後變更/);
  const imported = await importCSV(b, csv('甲')), visit = project(imported.bundle).find(r => r.type === 'visit');
  for (const device of ['phone', 'mac']) imported.bundle.ops.push(revision('visit', visit.id, { ...visit.heads[0].data, text: device }, visit.heads.map(h => h.id), device));
  const plan = await planCSV([await file(csv('丙'))], imported.bundle), snapshot = JSON.stringify(imported.bundle);
  assert.throws(() => buildCSVImport(plan, imported.bundle, 'mac'), /同步衝突/); assert.equal(JSON.stringify(imported.bundle), snapshot);
});
test('field length and malformed CSV diagnostics retain line numbers and leave input intact', async () => {
  const f = await file('Title,Address,Note\n測試,' + '長'.repeat(2001) + ',原文'), b = emptyBundle('q');
  const p = await planCSV([f], b);
  assert.equal(p.rows[0].line, 2); assert.ok(p.rows[0].errors.some(e => e.includes('地址超過 2000')));
  assert.equal(p.rows[0].choice, 'review');
  await assert.rejects(file('Title,Note\n測試,A,B'), /第 2 行/);
  assert.deepEqual(b, emptyBundle('q'));
});
test('quality metadata is validated while schema 1 and 2 data remain readable', () => {
  const b = fixture({}, {}); b.schema = 1; validateBundle(b);
  const next = setDistinctReview(b, 's0', 's1', 'mac'); validateBundle(next);
  const invalid = structuredClone(next); invalid.ops.at(-1).data.qualityDistinct = [{ store: 's1', self: {}, other: '' }];
  assert.throws(() => validateBundle(invalid));
});
