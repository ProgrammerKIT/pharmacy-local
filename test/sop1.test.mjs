import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCSV, planCSV, buildCSVImport, sop1Report } from '../public/csv.js';
import { emptyBundle, project } from '../public/core.js';
import { groupCSVNotes } from '../public/relations.js';
const file = (text, name = '虛構清單.csv') => prepareCSV(name, new TextEncoder().encode(text));
const url = 'https://maps.google.com/?cid=1234567';

test('SOP1 treats list metadata and missing names differently and requires explicit disposition', async () => {
  const b = emptyBundle('sop1'), before = JSON.stringify(b);
  const p = await planCSV([await file(`標題,筆記,網址,標籤,留言\n,,,標籤甲,\n,,https://www.google.com/maps/search/0,0,\n虛構藥局,原文,${url},,`)], b);
  assert.equal(p.rows[0].sop1.metadata, true); assert.equal(p.rows[0].choice, 'skip');
  assert.equal(p.rows[1].choice, 'review'); assert.equal(sop1Report(p, b).ready, false);
  assert.throws(() => buildCSVImport(p, b, 'mac'), /SOP1/); assert.equal(JSON.stringify(b), before);
  p.rows[1].choice = 'skip'; assert.equal(sop1Report(p, b).ready, true);
  assert.equal(buildCSVImport(p, b, 'mac').summary.stores, 1);
});
test('SOP1 canonical map identifiers ignore URL decoration but name contradictions block', async () => {
  const b = emptyBundle('sop1');
  const a = await file(`Title,Note,URL\n虛構藥局,A,${url}`, '甲.csv');
  const c = await file('Title,Note,URL\n虛構藥局,B,https://www.google.com/?cid=001234567&utm_source=test', '乙.csv');
  let p = await planCSV([a, c], b); assert.match(p.rows[1].choice, /^row:/);
  assert.equal(buildCSVImport(p, b, 'mac').summary.stores, 1);
  c.rows[0].cells[0] = '虛構另一名稱'; p = await planCSV([a, c], b);
  assert.equal(p.rows[1].choice, 'review'); assert.throws(() => buildCSVImport(p, b, 'mac'), /名稱不同/);
});
test('SOP1 blocks conflicting versions in one source list instead of last-file-wins', async () => {
  const b = emptyBundle('sop1'), text = note => `Title,Note,URL\n虛構藥局,${note},${url}`;
  const p = await planCSV([await file(text('甲'), '清單(1).csv'), await file(text('乙'), '清單(2).csv')], b);
  assert.equal(sop1Report(p, b).ready, false); assert.throws(() => buildCSVImport(p, b, 'mac'), /不能以檔案順序/);
  p.rows[1].choice = 'skip'; assert.equal(buildCSVImport(p, b, 'mac').summary.notes, 1);
});
test('SOP1 accounts for every extra text field and never infers people or topics', async () => {
  const b = emptyBundle('sop1'), raw = `標題,筆記,網址,留言\n虛構藥局,筆記,${url},未核對的留言`;
  const p = await planCSV([await file(raw)], b);
  assert.throws(() => buildCSVImport(p, b, 'mac'), /其他非空白文字欄/);
  assert.equal(p.rows[0].textFields.at(-1).text, '未核對的留言'); p.rows[0].sop1.extraAccepted = true;
  const records = project(buildCSVImport(p, b, 'mac').bundle);
  assert.equal(records.filter(r => ['person','topic'].includes(r.type)).length, 0);
  assert.equal(records.find(r=>r.type==='visit').csvSources[0].supplements[0].text, '未核對的留言');
});
test('SOP1 date corrections produce versions; repeated imports add only source snapshots', async () => {
  const b = emptyBundle('sop1'), raw = date => `Title,Note,Visit Date,URL\n虛構藥局,原文,${date},${url}`;
  const first = buildCSVImport(await planCSV([await file(raw('2026-01-01'))], b), b, 'mac').bundle;
  const changed = await file(raw('2026-01-02'));
  const second = buildCSVImport(await planCSV([changed], first), first, 'mac').bundle;
  const visit = project(second).find(r=>r.type==='visit'); assert.equal(visit.date, '2026-01-02'); assert.equal(visit.versions.length, 2);
  const repeated = buildCSVImport(await planCSV([changed], second), second, 'mac'); const third = repeated.bundle; assert.equal(repeated.summary.rows, 0); assert.equal(repeated.summary.sourceSnapshots, 1); assert.equal(project(third).filter(r=>r.type==='source').length, project(second).filter(r=>r.type==='source').length + 1);
});
test('evidence grouping preserves all records and never merges different events, stores or manual edits', () => {
  const visit = overrides => ({ id: 'a', store: 's', text: '全文', googleText: '全文', date: '', csvSources: [{list:'甲'}], topics:[],people:[],attachments:[], ...overrides });
  const records = [visit({}), visit({id:'b',csvSources:[{list:'乙'}]})], before=JSON.stringify(records);
  const groups = groupCSVNotes(records); assert.equal(groups.length, 1); assert.equal(groups[0].evidenceMembers.length, 2); assert.equal(JSON.stringify(records), before);
  for (const change of [{store:'t'}, {date:'2026-01-01'}, {text:'手動'}, {googleText:undefined}, {topics:['t']}, {people:['p']}, {next:'待確認'}, {conflict:true}, {attachments:[{name:'圖'}]}]) assert.equal(groupCSVNotes([records[0],visit(change)]).length, 2);
});
