import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../public/core.js';
import { storeIdentityPending, originalStoreNames, visitBriefForStore } from '../public/relations.js';
import { makeFixture, inventory, auditBundle } from './qa/store-text-fixture.mjs';

// Synthetic data only. Execute production rendering functions, with persistence
// APIs set to fail, to test display/search behavior without touching any vault.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function source(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing production fixture boundary: ${start}`);
  return app.slice(from, to);
}
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
};
const store = (id, extra = {}) => ({ type: 'store', id, name: `虛構門市 ${id}`, city: '', district: '', address: '', channel: '', attr: '', contact: '', ...extra });
const visit = (id, storeId, extra = {}) => ({ type: 'visit', id, store: storeId, date: '2026-01-01', text: `合成拜訪 ${id}`, source: 'synthetic', next: '', people: [], topics: [], attachments: [], ...extra });
function bundleFor(items) {
  const bundle = core.emptyBundle('synthetic-profile-display');
  for (const { type, id, deleted = false, ...data } of items) bundle.ops.push(core.revision(type, id, data, [], 'synthetic-device', deleted));
  core.validateBundle(bundle); return bundle;
}
function harness(items, { bundle = bundleFor(items), payloadFields = {} } = {}) {
  const nodes = new Map(), messages = [], attempts = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', innerHTML: '', textContent: '', hidden: false, open: false, dataset: {}, scrollTop: 0,
      classList: { add() {}, remove() {} }, querySelector: () => null, querySelectorAll: () => [],
    });
    return nodes.get(id);
  };
  const denyWrite = name => () => { attempts.push(name); assert.fail(`Reading must not invoke ${name}`); };
  const payload = freeze({ bundle, ...payloadFields });
  const ctx = vm.createContext({storeSupervisionHTML:()=>'',
    ...core, storeIdentityPending, originalStoreNames, visitBriefForStore,
    records: freeze(core.project(bundle)), payload, $: node, JSON, Date, Set,
    activeView: 'visits', focus: { type: 'store', id: '' }, inlineTextContext: null, singleStoreContext: null,
    storeAttendance: id => core.visitAttendanceForStore(payload.bundle, id), dateText: value => value || '',
    renderQuickVisit() {}, renderReminderDrafts() {}, chip: () => '',
    inlineVisitTextHTML: record => `<div data-rendered-visit="${record.id}">${escapeHTML(record.text)}</div>`,
    storeMergeOriginsHTML: () => '', storeInsightsHTML: () => '', singleStoreCaptureHTML: () => '', singleStoreIdleActions: () => '',
    prepareBriefSearch() {}, refreshBriefSearch() {}, setReviewMode() {}, requestAnimationFrame: fn => fn(),
    openDialog: dialog => { dialog.open = true; }, toast: message => messages.push(message),
    persist: denyWrite('persist'), writeLocal: denyWrite('writeLocal'), revision: denyWrite('revision'),
    commitRevision: denyWrite('commitRevision'), makeVisitAttendance: denyWrite('makeVisitAttendance'),
  });
  vm.runInContext(
    source('const esc =', 'const titles =') +
    source('const all =', 'const dateText =') +
    source('function reminderTasksHTML(', 'function legacyReminderDraftHTML(') +
    source('function storeAttendanceHTML(', 'function assertSaveParents(') +
    source('function visitStoreSearchText(', 'function orderedVisitStores(') +
    source('function storeVisitSearchRank(', 'function sourceButton(') +
    source('function sourceButton(', 'function openSources(') +
    source('function briefTraceHTML(', 'function singleStoreCaptureHTML(') +
    source('function noteHTML(', 'function render()') +
    source('function openVisitBrief(', 'function canonicalPerson('), ctx);
  return {
    ctx, node, payload, messages, attempts,
    render(query = '') { node('visit-search').value = query; ctx.renderVisits(); return node('visit-list').innerHTML; },
    open(storeId) { node('review-body').innerHTML = ''; node('review').open = false; ctx.openVisitBrief(storeId); return node('review-body').innerHTML; },
    snapshot() { return JSON.stringify({ payload, records: ctx.records }); },
  };
}
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
const unescapeHTML = value => value.replace(/&#13;/g, '\r').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function profileBlocks(html, id) { return [...html.matchAll(/<section\b[^>]*data-store-original-text="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)].filter(match => match[1] === id).map(match => match[2]); }
function profileFields(block) { return Object.fromEntries([...block.matchAll(/<pre\b[^>]*data-store-original-field="([^"]+)"[^>]*>([\s\S]*?)<\/pre>/g)].map(match => [match[1], unescapeHTML(match[2].replace(/<[^>]*>/g, ''))])); }
function assertProfile(html, item, count = 1) {
  const blocks = profileBlocks(html, item.id); assert.equal(blocks.length, count, `Expected ${count} profile block(s) for ${item.id}`);
  const expected = Object.fromEntries(['attr', 'contact'].filter(field => typeof item[field] === 'string' && item[field].trim()).map(field => [field, item[field]]));
  for (const block of blocks) { assert.deepEqual(profileFields(block), expected); assert.doesNotMatch(block, /contenteditable|textarea|data-inline-edit|data-new-visit-store/); }
}

test('zero-visit stores display both original profile fields in visits and single-store views with source labels', () => {
  const item = store('zero', { attr: '虛構客群原文', contact: '虛構窗口原文' }), h = harness([item]);
  const before = h.snapshot();
  for (const html of [h.render(), h.render(item.name), h.open(item.id)]) {
    assertProfile(html, item); assert.match(html, /門市原有文字/); assert.match(html, /門市特性／客群/); assert.match(html, /主要窗口/); assert.match(html, /唯讀/);
    assert.doesNotMatch(html, /data-rendered-visit=/);
  }
  assert.equal(h.snapshot(), before); assert.deepEqual(h.attempts, []);
});

test('attr-only, contact-only, missing and whitespace-only fields create no invented content or empty boxes', () => {
  const cases = [store('attr', { attr: '  虛構客群  ' }), store('contact', { contact: '\t虛構窗口\n' }), store('empty'), store('spaces', { attr: ' \r\n\t', contact: '\n' })];
  for (const item of cases) {
    const h = harness([item]), hasText = Boolean(item.attr.trim() || item.contact.trim());
    for (const html of [h.render(), h.open(item.id)]) assertProfile(html, item, hasText ? 1 : 0);
  }
});

test('single-store search scope mentions the profile below only when readable profile text actually exists', () => {
  const cases = [store('hint-attr', { attr: 'profile-needle' }), store('hint-contact', { contact: 'profile-needle' }), store('hint-empty'), store('hint-whitespace', { attr: ' \r\n\t', contact: '\n' })];
  for (const item of cases) {
    const h = harness([item]), before = h.snapshot();
    assert.match(h.open(item.id), /0 筆正式拜訪紀錄/);
    Object.assign(h.ctx, { busy: false, updateHolding: false, briefSearchBlocked: () => false, briefSearchEditing: () => false, paintBriefSearch() {} });
    h.node('brief-search-preview').replaceChildren = () => {};
    vm.runInContext(source('function refreshBriefSearch(', 'function runBriefSearchQuery('), h.ctx);
    for (const query of ['', 'profile-needle']) {
      h.ctx.briefSearchContext = { storeId: item.id, query, matches: [], index: 0, composing: false };
      h.ctx.refreshBriefSearch({ search: true });
      const message = h.node('brief-search-status').textContent, hasText = Boolean(item.attr.trim() || item.contact.trim());
      assert.equal(message.includes('門市原有文字'), hasText);
      assert.equal(h.ctx.briefSearchContext.matches.length, 0, 'profile text is never counted as a formal visit match');
      if (query) assert.match(message, /正式拜訪原文找不到相同文字/);
    }
    assert.equal(h.snapshot(), before); assert.deepEqual(h.attempts, []);
  }
});

test('multiple visits show one profile per store while retaining every original visit', () => {
  const item = store('history', { attr: '獨有的虛構門市背景', contact: '獨有的虛構窗口' });
  const notes = [visit('one', item.id), visit('two', item.id), visit('three', item.id)];
  const h = harness([item, ...notes]), before = h.snapshot();
  for (const html of [h.render(), h.render(item.name), h.open(item.id)]) {
    assertProfile(html, item);
    for (const note of notes) assert.equal((html.match(new RegExp(`data-rendered-visit="${note.id}"`, 'g')) || []).length, 1);
  }
  assert.equal(h.snapshot(), before);
});

test('profile keyword discovery includes stores with zero, one and multiple unrelated visits without claiming visit hits', () => {
  for (const count of [0, 1, 3]) {
    const item = store(`profile-${count}`, { attr: '原有 SeedNeedle 背景', contact: '主要窗口 ContactNeedle' });
    const notes = Array.from({ length: count }, (_, i) => visit(`unrelated-${i}`, item.id));
    const h = harness([item, ...notes]);
    for (const query of ['seedneedle', 'contactneedle']) {
      const html = h.render(query); assertProfile(html, item); assert.doesNotMatch(html, /沒有符合/);
      assert.match(html, /<mark class="search-match">/);
      for (const note of notes) assert.equal(h.ctx.visitSearchRank(h.ctx.records.find(r => r.type === 'visit' && r.id === note.id), query), Infinity);
      if (count) { assert.match(html, /門市原有文字命中/); assert.match(html, /拜訪命中 0 筆/); assert.match(html, new RegExp(`共 ${count} 筆`)); }
    }
  }
});

test('a keyword shared by profile and one visit counts only the actual matching visit and retains other history', () => {
  const item = store('mixed', { attr: 'keyword 虛構門市背景' });
  const h = harness([item, visit('match', item.id, { text: 'keyword 虛構筆記' }), visit('other', item.id, { text: '無關的歷史原文' })]);
  const html = h.render('keyword'); assertProfile(html, item);
  assert.match(html, /(?:拜訪命中 1 筆|1 筆命中)/); assert.match(html, /共 2 筆/);
  assert.equal((html.match(/data-rendered-visit="match"/g) || []).length, 1);
  assert.equal((html.match(/data-rendered-visit="other"/g) || []).length, 1);
});

test('identical store names do not mix profile text or formal visits across separate IDs', () => {
  const a = store('same-a', { name: '虛構同名店', attr: '甲店專屬背景' }), b = store('same-b', { name: a.name, contact: '乙店專屬窗口' });
  const h = harness([a, b, visit('a-note', a.id), visit('b-note', b.id)]);
  const both = h.render(a.name); assertProfile(both, a); assertProfile(both, b);
  const onlyA = h.render('甲店專屬背景'); assertProfile(onlyA, a); assertProfile(onlyA, b, 0); assert.doesNotMatch(onlyA, /data-rendered-visit="b-note"/);
  for (const [own, other] of [[a, b], [b, a]]) { const html = h.open(own.id); assertProfile(html, own); assertProfile(html, other, 0); }
});

test('original CRLF, CR, tabs, leading and trailing spaces, emoji and HTML remain byte-for-byte text', () => {
  const item = store('literal', { attr: ' \t甲\r\n乙\r丙\n😀 <img src=x onerror=synthetic()> & "quoted" \'single\'  ', contact: '\n  窗口 <script>synthetic()</script>\t' });
  const h = harness([item]), before = h.snapshot();
  for (const html of [h.render(), h.render('onerror'), h.open(item.id)]) {
    assertProfile(html, item); assert.doesNotMatch(html, /<img\b|<script\b|onerror="/); assert.match(html, /&lt;img/);
  }
  assert.equal(h.snapshot(), before);
});

test('profile search is literal and case insensitive without joining separate fields or normalizing original words', () => {
  const item = store('search-rules', { attr: '甲\r\n乙\ttwo  words <x.*> HAUD', contact: '個別窗口' }), h = harness([item]);
  for (const query of ['haud', '<x.*>', 'two  words', '個別窗口']) assertProfile(h.render(query), item);
  for (const query of ['甲乙', 'two words', 'HAMD', 'HAUD個別窗口', '.*not-here']) assert.match(h.render(query), /沒有符合/);
});

test('deleted and merged source profiles are not injected into current visits or single-store display', () => {
  const deleted = store('deleted', { attr: '刪除背景不可呈現', deleted: true });
  // A real safe merge tombstones its source; preserve this valid lifecycle shape.
  const merged = store('merged', { contact: '已整併來源窗口不可呈現', deleted: true, mergedInto: 'target' });
  const target = store('target', { attr: '目前保留店背景' });
  const h = harness([deleted, merged, target, visit('old-note', deleted.id)]);
  for (const query of ['', '刪除背景', '已整併來源窗口', '虛構門市']) {
    const html = h.render(query); assertProfile(html, deleted, 0); assertProfile(html, merged, 0); assert.doesNotMatch(html, /刪除背景不可呈現|已整併來源窗口不可呈現/);
  }
  assertProfile(h.open(target.id), target); assert.equal(h.open(deleted.id), ''); assert.equal(h.open(merged.id), '');
});

test('pending identity keeps exact per-ID profile visible while preserving the single-store review gate', () => {
  const item = store('pending', { attr: '尚待確認身分的原文', csvIdentityPending: true }), h = harness([item]);
  for (const query of ['', item.name, item.attr]) {
    const html = h.render(query); assertProfile(html, item); assert.match(html, /待確認/); assert.doesNotMatch(html, /data-visit-brief="pending"/);
  }
  assert.equal(h.open(item.id), ''); assert.ok(h.messages.some(message => /待確認/.test(message)));
});

test('store conflicts never pick one profile version as settled text or allow profile-only search to settle identity', () => {
  const item = store('conflict', { attr: '私有甲版本背景', contact: '私有甲版本窗口' });
  const bundle = bundleFor([item]);
  bundle.ops.push(core.revision('store', item.id, { ...bundle.ops[0].data, attr: '私有乙版本背景', contact: '私有乙版本窗口' }, [], 'other-device'));
  core.validateBundle(bundle);
  const h = harness([], { bundle }), before = h.snapshot();
  for (const query of ['', item.name, '私有甲版本背景', '私有乙版本背景']) {
    const html = h.render(query); assert.doesNotMatch(html, /私有[甲乙]版本(?:背景|窗口)/);
    if (!query || query === item.name) assert.match(html, /data-review="store:conflict"/);
  }
  assert.equal(h.open(item.id), ''); assert.equal(h.snapshot(), before);
});

test('visit association conflicts preserve store profile but never attach an unresolved visit to its alternate store', () => {
  const a = store('assoc-a', { attr: '甲店既有文字' }), b = store('assoc-b', { contact: '乙店既有窗口' });
  const bundle = bundleFor([a, b, visit('assoc-note', a.id, { text: '門市歸屬尚未核實' })]);
  const first = bundle.ops.at(-1); first.id = 'a-visit-head';
  const alternative = core.revision('visit', 'assoc-note', { ...first.data, store: b.id }, [], 'other-device'); alternative.id = 'z-visit-head'; bundle.ops.push(alternative);
  core.validateBundle(bundle);
  const h = harness([], { bundle }), html = h.render(b.name);
  assertProfile(html, b); assert.match(html, /門市歸屬待核對/); assert.match(html, /data-review="visit:assoc-note"/);
  assert.doesNotMatch(html, /data-rendered-visit="assoc-note"|data-new-visit-store="assoc-b"|data-visit-brief="assoc-b"/);
});

test('historical profile text stays historical; deleted last visits do not hide the current profile', () => {
  const item = store('versions', { attr: '歷史背景不應顯示' });
  const bundle = bundleFor([item, visit('deleted-note', item.id, { deleted: true })]);
  const old = bundle.ops[0], current = { ...old.data, attr: '目前背景必須呈現' };
  bundle.ops.push(core.revision('store', item.id, current, [old.id], 'synthetic-device'));
  const h = harness([], { bundle }), projected = { ...item, attr: current.attr }, before = h.snapshot();
  for (const html of [h.render(), h.open(item.id)]) { assertProfile(html, projected); assert.doesNotMatch(html, /歷史背景不應顯示|data-rendered-visit="deleted-note"/); }
  assert.match(h.render('歷史背景不應顯示'), /沒有符合/); assert.equal(h.snapshot(), before);
});

test('a full 240-store synthetic corpus is covered by default display, profile search, and each eligible single-store view', () => {
  const items = [], expected = [];
  for (let index = 0; index < 240; index++) {
    const item = store(`scale-${index}`, { attr: index % 4 < 2 ? `CorpusNeedle 背景 ${index}` : '', contact: index % 4 === 1 || index % 4 === 2 ? `CorpusNeedle 窗口 ${index}` : '' });
    items.push(item); expected.push(item);
    for (let count = 0; count < index % 3; count++) items.push(visit(`scale-note-${index}-${count}`, item.id));
  }
  const h = harness(items), before = h.snapshot(), defaultHTML = h.render(), searchHTML = h.render('corpusneedle');
  for (const item of expected) {
    const count = item.attr || item.contact ? 1 : 0;
    assertProfile(defaultHTML, item, count); assertProfile(searchHTML, item, count); assertProfile(h.open(item.id), item, count);
  }
  assert.equal(h.snapshot(), before); assert.deepEqual(h.attempts, []);
});

test('display and search leave encrypted-draft inputs, attendance, sources, versions and bundle bytes unchanged', () => {
  const item = store('immutable', { attr: '不可變背景', contact: '不可變窗口', everyTimeMust: '不可變每次必做', nextRememberTasks: [{ id: 'task', text: '不可變待辦', createdAt: '2026-01-01T00:00:00.000Z', completedAt: '' }] });
  const bundle = bundleFor([item, visit('immutable-note', item.id)]);
  const blob = 'a'.repeat(64), headers = ['Title', 'Note'];
  bundle.blobs[blob] = Buffer.from('Title,Note\n合成標題,合成來源').toString('base64');
  bundle.ops.push(core.revision('source', 'immutable-source', { file: 'synthetic.csv', list: 'synthetic', blob, batch: 'synthetic-batch', rows: 1, headers, encoding: 'utf-8', delimiter: ',' }, [], 'synthetic-device'));
  const csvSources = [{ file: 'synthetic.csv', fingerprint: 'b'.repeat(64), batch: 'synthetic-batch', list: 'synthetic', at: '2026-01-01T00:00:00.000Z', blob, line: 2, sourceSnapshot: 'immutable-source', headers, cells: ['合成標題', '合成來源'] }];
  const prior = bundle.ops[0]; bundle.ops.push(core.revision('store', item.id, { ...prior.data, csvSources }, [prior.id], 'synthetic-device', false, core.makeVisitAttendance(item.id, '2026-01-01T01:00:00.000Z')));
  core.validateBundle(bundle);
  const h = harness([], { bundle, payloadFields: {
    draft: { format: 'visit-draft-1', id: 'draft', fields: { text: '不可變拜訪草稿' } },
    inlineTextDraft: { format: 'inline-text-draft-1', id: 'inline', after: '不可變文字草稿' },
    reminderDrafts: [{ storeId: item.id, customText: '不可變提醒草稿' }],
  } });
  const before = h.snapshot(), bytes = Buffer.from(JSON.stringify(bundle));
  for (const query of ['', item.name, '不可變背景', '不可變窗口', '查無合成字詞']) h.render(query);
  h.open(item.id);
  assert.equal(h.snapshot(), before); assert.deepEqual(Buffer.from(JSON.stringify(bundle)), bytes); assert.deepEqual(h.attempts, []);
  assert.equal(core.visitAttendanceForStore(bundle, item.id).history.length, 1);
});

test('the shared browser QA corpus renders every eligible profile and preserves all source/history fingerprints', async () => {
  const bundle = await makeFixture(core), baseline = structuredClone(bundle), rows = inventory(core, bundle), h = harness([], { bundle });
  const initial = h.render();
  for (const row of rows) {
    const item = h.ctx.records.find(record => record.type === 'store' && record.id === row.id);
    const count = row.expectedAttr || row.expectedContact ? 1 : 0;
    assertProfile(initial, item, count);
    if (!row.deleted && !row.conflict && !row.pending) assertProfile(h.open(row.id), item, count);
    for (const field of ['expectedAttr', 'expectedContact']) if (row[field]) {
      const query = row[field].trim().split(/[\r\n]/)[0];
      assertProfile(h.render(query), item);
    }
  }
  const audit = await auditBundle(core, bundle, baseline);
  for (const key of ['bundleUnchanged', 'originalOpsPreserved', 'storeDataAndHistoryUnchanged', 'visitTextAndHistoryUnchanged', 'sourceSnapshotsUnchanged', 'blobsUnchanged', 'attendanceUnchanged']) assert.equal(audit[key], true, key);
  assert.equal(audit.newOps, 0); assert.deepEqual(audit.changedStoreIds, []); assert.deepEqual(h.attempts, []);
  assert.equal(audit.counts.allStoreIds, 216); assert.equal(audit.counts.readableStoreIdsWithText, 171);
});
