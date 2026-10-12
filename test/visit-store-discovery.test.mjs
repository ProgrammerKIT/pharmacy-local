import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emptyBundle, revision, project, validateBundle, makeVisitAttendance, visitAttendanceForStore, reminderTaskHistory } from '../public/core.js';
import { storeIdentityPending, originalStoreNames } from '../public/relations.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function sourceBetween(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `The renderer fixture must load ${start}`);
  return app.slice(from, to);
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const store = (id, name, extra = {}) => ({
  type: 'store', id, name, city: '', district: '', channel: '', address: '', attr: '', contact: '',
  heads: [{ id: `${id}-head`, data: {} }], versions: [], ...extra,
});
const visit = (id, storeId, extra = {}) => ({
  type: 'visit', id, store: storeId, date: '2026-01-02', text: '虛構原文', next: '',
  topics: [], people: [], attachments: [], heads: [{ id: `${id}-head` }], versions: [], ...extra,
});

// Execute the production search/card renderer with synthetic records. Other views
// and existing note bodies are outside this fixture; this is not browser-layout QA.
function fixture(records, payloadFields = {}) {
  const nodes = new Map(), calls = [], bundle = emptyBundle('synthetic-store-discovery');
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', innerHTML: '', textContent: '', hidden: false });
    return nodes.get(id);
  };
  const payload = freeze({ bundle, ...payloadFields });
  const rejectWrite = () => assert.fail('Searching or opening an existing store must not persist a revision');
  const ctx = vm.createContext({
    records: freeze(records), payload, inlineTextContext: null, focus: { type: 'store', id: '' },
    $: node, storeIdentityPending, originalStoreNames, reminderTaskHistory, activeView: 'visits',
    storeAttendance: id => visitAttendanceForStore(payload.bundle, id),
    dateText: value => value || '',
    renderQuickVisit() {}, renderReminderDrafts() {},
    noteHTML: (record, query = '') => `<article data-rendered-visit="${record.id}" data-query="${query}"></article>`,
    inlineVisitTextHTML: record => `<p>${record.text}</p>`, chip: () => '', sourceButton: () => '',
    persist: rejectWrite, commitRevision: rejectWrite, writeLocal: rejectWrite, revision: rejectWrite,
    toast: message => calls.push(['toast', message]),
    resumeVisitDraft: () => calls.push(['resume-visit']),
    pendingInlineTextId: () => '',
    resumeInlineTextDraft: () => calls.push(['resume-inline']),
    openEditor: type => calls.push(['editor', type]),
    openVisitBrief: (id, options) => calls.push(['brief', id, options]),
  });
  vm.runInContext(
    sourceBetween('const esc =', 'const titles =') +
    sourceBetween('const all =', 'const dateText =') +
    sourceBetween('function reminderTasksHTML(', 'function legacyReminderDraftHTML(') +
    sourceBetween('function storeAttendanceHTML(', 'function assertSaveParents(') +
    sourceBetween('function visitStoreSearchText(', 'function orderedVisitStores(') +
    sourceBetween('function openVisitForStore(', 'function captureVisitDraft(') +
    sourceBetween('function storeVisitSearchRank(', 'function sourceButton('), ctx);
  return {
    ctx, node, calls, payload,
    render(query = '') { node('visit-search').value = query; ctx.renderVisits(); return node('visit-list').innerHTML; },
    useNoteRenderer() { vm.runInContext(sourceBetween('function noteHTML(', 'function render()'), ctx); },
  };
}

test('the default visits page includes stores without notes after existing notes in name order', () => {
  const emptyStores = [store('zero-b', '虛構乙店'), store('zero-a', '虛構甲店')];
  const h = fixture([...emptyStores, store('with-note', '虛構既有店'), visit('existing-note', 'with-note')]);
  const html = h.render();
  assert.match(html, /data-rendered-visit="existing-note"/);
  for (const item of emptyStores) assert.match(html, new RegExp(`data-new-visit-store="${item.id}"`));
  const sorted = emptyStores.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  assert.ok(html.indexOf('data-rendered-visit="existing-note"') < html.indexOf(sorted[0].name));
  assert.ok(html.indexOf(sorted[0].name) < html.indexOf(sorted[1].name));
  assert.equal((html.match(/data-new-visit-store=/g) || []).length, 2);
  assert.doesNotMatch(html, /沒有符合的拜訪紀錄/);
});

test('a store with no visits is discoverable by exact and partial names with an existing-store action', () => {
  const item = store('new-store', '虛構新店-測試分店'), h = fixture([item]);
  assert.equal(h.ctx.storeVisitSearchRank(item, item.name), 0);
  assert.equal(h.ctx.storeVisitSearchRank(item, '測試分店'), 1);
  for (const query of [item.name, '測試分店']) {
    const html = h.render(query);
    assert.match(html, /data-new-visit-store="new-store"/);
    assert.match(html, /data-visit-brief="new-store"/);
    assert.match(html, /<mark class="search-match">/);
    assert.doesNotMatch(html, /data-rendered-visit=/);
    assert.doesNotMatch(html, /沒有符合的拜訪紀錄/);
  }
  assert.match(h.render('查無此虛構字詞'), /沒有符合/);
});

test('source aliases match case-insensitively and highlight literal characters without adding duplicate stores', () => {
  const item = store('alias-store', '虛構更名店', { csvAliases: ['虛構<Alias.()>來源店', '虛構<Alias.()>來源店'] });
  const h = fixture([item]);
  assert.equal(h.ctx.storeVisitSearchRank(item, '<alias.()>'), 1);
  const html = h.render('<alias.()>');
  assert.match(html, /虛構更名店/);
  assert.match(html, /<mark class="search-match">&lt;Alias\.\(\)&gt;<\/mark>/);
  assert.doesNotMatch(html, /<Alias/);
  assert.equal((html.match(/data-new-visit-store="alias-store"/g) || []).length, 1);
});

test('the first formal visit replaces the empty-store card and deleting the last note restores discoverability', () => {
  const item = store('new-store', '虛構新店'), h = fixture([item]);
  assert.match(h.render('虛構新店'), /data-new-visit-store="new-store"/);
  h.ctx.records = freeze([item, visit('first-note', item.id)]);
  for (const query of ['', '虛構新店']) {
    const html = h.render(query);
    assert.equal((html.match(/data-rendered-visit="first-note"/g) || []).length, 1);
    assert.doesNotMatch(html, /data-new-visit-store="new-store"/);
  }
  h.ctx.records = freeze([item, visit('first-note', item.id, { deleted: true })]);
  assert.match(h.render('虛構新店'), /data-new-visit-store="new-store"/);
  assert.doesNotMatch(h.render(), /data-rendered-visit=/);
});

test('deleted stores are omitted, pending stores can add notes, and conflicted stores offer review only', () => {
  const h = fixture([
    store('deleted', '虛構刪除店', { deleted: true }),
    store('deleted-conflict', '虛構刪除衝突店', { deleted: true, conflict: true }),
    store('pending', '虛構待確認店', { csvIdentityPending: true }),
    store('conflict', '虛構衝突店', { conflict: true }),
  ]);
  for (const query of ['', '虛構']) {
    const html = h.render(query);
    assert.doesNotMatch(html, /虛構刪除店|虛構刪除衝突店/);
    assert.match(html, /data-new-visit-store="pending"/);
    assert.doesNotMatch(html, /data-visit-brief="pending"/);
    assert.match(html, /data-review="store:conflict"/);
    assert.doesNotMatch(html, /data-(?:new-visit-store|visit-brief|store-reminder)="conflict"/);
  }
});

test('empty-store cards preserve reminders and explicit attendance without inventing a note', () => {
  const item = store('reminder-store', '虛構提醒店', {
    nextRemember: '虛構舊提醒', everyTimeMust: '虛構每次必做',
    nextRememberTasks: [{ id: 'pending-task', text: '虛構待辦' }, { id: 'done-task', text: '虛構已完成項目', completedAt: '2026-01-01T01:00:00Z' }],
  });
  const bundle = emptyBundle('synthetic-store-attendance');
  const data = { name: item.name, city: '', district: '', channel: '', attr: '', contact: '' };
  bundle.ops.push(revision('store', item.id, data, [], 'synthetic-device', false, makeVisitAttendance(item.id, '2026-01-01T01:00:00.000Z')));
  const h = fixture([item], { bundle }), html = h.render(item.name);
  assert.match(html, /虛構舊提醒/);
  assert.match(html, /虛構每次必做/);
  assert.match(html, /虛構待辦/);
  assert.match(html, /data-store-reminder="reminder-store"/);
  assert.doesNotMatch(html, /虛構已完成項目/);
  assert.match(html, /最近拜訪：2026-01-01/);
  assert.doesNotMatch(html, /data-rendered-visit=/);
  assert.match(fixture([store('unconfirmed', '虛構無確認店')]).render(), /尚無已確認的拜訪日期/);
});

test('name and alias discovery retain the existing text, follow-up, topic and person ranking', () => {
  const exact = store('exact', 'needle'), partial = store('partial', '虛構needle店');
  const alias = store('alias', '虛構別名店', { csvAliases: ['NEEDLE'] });
  const h = fixture([exact, partial, alias, store('body', '虛構原文店'),
    { type: 'topic', id: 'topic', name: 'needle 主題' }, { type: 'person', id: 'person', name: 'needle 人物' }]);
  assert.equal(h.ctx.visitSearchRank(visit('exact-note', exact.id), 'needle'), 0);
  assert.equal(h.ctx.visitSearchRank(visit('partial-note', partial.id), 'needle'), 1);
  assert.equal(h.ctx.visitSearchRank(visit('alias-note', alias.id), 'needle'), 1);
  assert.equal(h.ctx.visitSearchRank(visit('body-note', 'body', { text: 'needle' }), 'needle'), 2);
  assert.equal(h.ctx.visitSearchRank(visit('next-note', 'body', { next: 'needle' }), 'needle'), 3);
  assert.equal(h.ctx.visitSearchRank(visit('topic-note', 'body', { topics: ['topic'] }), 'needle'), 4);
  assert.equal(h.ctx.visitSearchRank(visit('person-note', 'body', { people: ['person'] }), 'needle'), 5);
  assert.equal(h.ctx.visitSearchRank(visit('no-match', 'body'), 'needle'), Infinity);
  h.ctx.records = freeze([...h.ctx.records, visit('body-note', 'body', { text: 'needle', date: '2026-10-12' })]);
  const html = h.render('needle');
  assert.ok(html.indexOf('data-new-visit-store="exact"') < html.indexOf('data-new-visit-store="partial"'));
  assert.ok(html.indexOf('data-new-visit-store="partial"') < html.indexOf('data-rendered-visit="body-note"'));
});

test('existing matching notes stay grouped by store ID and expanding retains nonmatching history', () => {
  const h = fixture([store('history-store', '虛構歷史店'),
    visit('first-match', 'history-store', { text: 'needle 第一筆', date: '2026-01-02' }),
    visit('second-match', 'history-store', { text: 'needle 第二筆', date: '2026-01-03' }),
    visit('unmatched-history', 'history-store', { text: '其他虛構原文', date: '2026-01-01' }),
    store('other-id', '虛構歷史店', { csvAliases: ['needle 舊名'] })]);
  const html = h.render('needle');
  assert.match(html, /2 筆命中 · 共 3 筆/);
  for (const id of ['first-match', 'second-match', 'unmatched-history']) {
    assert.equal((html.match(new RegExp(`data-rendered-visit="${id}"`, 'g')) || []).length, 1);
  }
  assert.doesNotMatch(html, /data-new-visit-store="history-store"/);
  assert.match(html, /data-new-visit-store="other-id"/);
});

test('searching does not write, mutate formal data or discard either local draft', () => {
  const h = fixture([store('draft-store', '虛構草稿門市')], {
    draft: { format: 'visit-draft-1', id: 'draft', fields: { store: 'draft-store', text: '虛構未完成拜訪' } },
    inlineTextDraft: { format: 'inline-text-draft-1', id: 'inline-draft', after: '虛構未完成文字修改' },
  });
  const before = JSON.stringify({ records: h.ctx.records, payload: h.payload });
  for (const query of ['', '草稿', '虛構草稿門市', '沒有命中']) h.render(query);
  assert.equal(JSON.stringify({ records: h.ctx.records, payload: h.payload }), before);
  assert.equal(h.node('draft-banner').hidden, false);
  assert.equal(h.node('resume-draft').textContent, '繼續草稿');
  h.ctx.openVisitForStore('draft-store');
  assert.ok(h.calls.some(([type]) => type === 'resume-visit'));
  assert.ok(!h.calls.some(([type]) => type === 'brief' || type === 'editor'));
  assert.equal(JSON.stringify({ records: h.ctx.records, payload: h.payload }), before);
});

test('the shared add-visit entry preserves state checks and the pending-store route', () => {
  const h = fixture([store('normal', '虛構一般店'), store('pending', '虛構待核店', { csvIdentityPending: true }),
    store('conflict', '虛構版本衝突店', { conflict: true }), store('deleted', '虛構已刪店', { deleted: true })]);
  h.ctx.openVisitForStore('normal');
  assert.equal(h.calls.at(-1)[0], 'brief');
  assert.equal(h.calls.at(-1)[1], 'normal');
  assert.equal(h.calls.at(-1)[2].capture, true);
  h.ctx.openVisitForStore('pending');
  assert.deepEqual(h.calls.at(-1), ['editor', 'visit']);
  for (const id of ['conflict', 'deleted', 'missing']) {
    h.ctx.openVisitForStore(id);
    assert.equal(h.calls.at(-1)[0], 'toast');
  }
  h.ctx.pendingInlineTextId = () => 'unfinished-inline';
  h.ctx.openVisitForStore('normal');
  assert.deepEqual(h.calls.at(-1), ['resume-inline']);
});

test('raw CSV source names remain discoverable alongside aliases in search and the visit picker', () => {
  const rawName = '虛構<Raw.(Origin)>原名', alias = '虛構已核別名';
  for (const hasVisit of [false, true]) {
    const item = store('source-store', '虛構人工更名店', {
      csvAliases: [alias],
      csvSources: [{ headers: ['Title', 'Note'], cells: [rawName, '來源備註不是門市名稱'] }],
    });
    const h = fixture([item, ...(hasVisit ? [visit('source-note', item.id)] : [])]);
    h.useNoteRenderer();
    const before = JSON.stringify({ records: h.ctx.records, payload: h.payload });
    for (const query of [rawName, alias, item.name]) {
      const html = h.render(query);
      assert.doesNotMatch(html, /沒有符合/);
      assert.ok(h.ctx.visitStoreSearchText(item).includes(query.toLocaleLowerCase('zh-Hant')));
    }
    const html = h.render('<raw.(origin)>');
    assert.match(html, /<mark class="search-match">&lt;Raw\.\(Origin\)&gt;<\/mark>/);
    assert.doesNotMatch(html, /<Raw/);
    assert.equal(h.ctx.storeVisitSearchRank(item, '來源備註不是門市名稱'), Infinity);
    assert.equal(JSON.stringify({ records: h.ctx.records, payload: h.payload }), before);
  }
});

test('ordinary imported stores need no csvAliases field for source-name search or picker matching', () => {
  const item = store('plain-import', '虛構目前店名', {
    csvSources: [{ headers: ['Name', 'Title'], cells: ['虛構次要欄位', '虛構原始標題'] }],
  });
  const h = fixture([item]);
  assert.match(h.render('虛構原始標題'), /data-visit-empty-store="plain-import"/);
  assert.match(h.render('原始標題'), /<mark class="search-match">原始標題<\/mark>/);
  assert.ok(h.ctx.visitStoreSearchText(item).includes('虛構原始標題'));
  assert.equal(h.ctx.storeVisitSearchRank(item, '虛構次要欄位'), Infinity, 'use the established original-title precedence');
  assert.equal(item.csvAliases, undefined, 'search must not backfill identity data');
});

test('orphan notes with missing or empty store references can be found by their displayed fallback name', () => {
  const h = fixture([
    visit('empty-reference', ''),
    visit('missing-reference-one', 'missing-store'),
    visit('missing-reference-two', 'missing-store'),
  ]);
  h.useNoteRenderer();
  for (const query of ['已刪除／未命名門市', '未命名門市']) {
    const html = h.render(query);
    for (const id of ['empty-reference', 'missing-reference-one', 'missing-reference-two']) {
      assert.match(html, new RegExp(`data-edit="visit:${id}"`));
    }
    assert.match(html, /2 筆命中 · 共 2 筆/);
    assert.match(html, /<mark class="search-match">/);
    assert.doesNotMatch(html, /data-visit-empty-store=|data-new-visit-store=/);
  }
  assert.equal(h.ctx.visitSearchRank(h.ctx.records[0], '已刪除／未命名門市'), 0);
  assert.equal(h.ctx.records.filter(record => record.type === 'store').length, 0);
});

test('pending stores keep the add-visit action after their first note while deleted and conflicted stores remain blocked', () => {
  const states = [
    { id: 'pending', name: '虛構待確認店', flags: { csvIdentityPending: true }, allowed: true },
    { id: 'deleted', name: '虛構已刪門市', flags: { deleted: true }, allowed: false },
    { id: 'conflict', name: '虛構衝突門市', flags: { conflict: true }, allowed: false },
    { id: 'deleted-conflict', name: '虛構已刪衝突門市', flags: { deleted: true, conflict: true }, allowed: false },
  ];
  for (const state of states) {
    const h = fixture([store(state.id, state.name, state.flags), visit(`${state.id}-note`, state.id)]);
    h.useNoteRenderer();
    const html = h.render(state.name), action = new RegExp(`data-new-visit-store="${state.id}"`);
    assert.equal(action.test(html), state.allowed);
    if (state.allowed) {
      assert.doesNotMatch(html, /data-visit-brief="pending"/);
      h.ctx.openVisitForStore(state.id);
      assert.deepEqual(h.calls.at(-1), ['editor', 'visit']);
    }
  }
});

function associationBundle({ pendingStore = false, storeConflict = false, otherHeadDeleted = false, resolved = false } = {}) {
  const bundle = emptyBundle('synthetic-association-conflict');
  const data = name => ({ name, city: '', district: '', channel: '', attr: '', contact: '' });
  const a = revision('store', 'store-a', data('虛構甲歸屬店'), [], 'synthetic');
  const bData = { ...data('虛構乙歸屬店'), csvIdentityPending: pendingStore };
  const b = revision('store', 'store-b', bData, [], 'synthetic');
  bundle.ops.push(a, b);
  if (storeConflict) bundle.ops.push(revision('store', 'store-b', { ...bData, contact: '虛構版本差異' }, [], 'synthetic'));
  const noteData = storeId => ({ store: storeId, date: '2026-01-01', source: 'synthetic', text: '虛構待核對門市歸屬', next: '', topics: [], people: [], attachments: [] });
  const first = revision('visit', 'association-note', noteData('store-a'), [], 'synthetic');
  const second = revision('visit', 'association-note', noteData('store-b'), [], 'synthetic', otherHeadDeleted);
  first.id = 'a-association-head'; second.id = 'b-association-head';
  bundle.ops.push(first, second);
  if (resolved) bundle.ops.push(revision('visit', 'association-note', noteData('store-b'), [first.id, second.id], 'synthetic'));
  validateBundle(bundle);
  return bundle;
}

test('a nonselected visit head pointing to another store produces a review card instead of claiming no notes', () => {
  const bundle = associationBundle(), h = fixture(project(bundle), { bundle });
  h.useNoteRenderer();
  const before = JSON.stringify({ records: h.ctx.records, payload: h.payload });
  assert.equal(h.ctx.records.find(record => record.type === 'visit').store, 'store-a');
  for (const query of ['', '虛構乙歸屬店']) {
    const html = h.render(query);
    assert.match(html, /data-visit-empty-store="store-b" data-visit-association-pending="true"/);
    assert.match(html, /有拜訪紀錄的門市歸屬待核對/);
    assert.match(html, /不代表拜訪已歸屬此店/);
    assert.match(html, /data-review="visit:association-note"/);
    assert.doesNotMatch(html, /尚無拜訪紀錄/);
    assert.doesNotMatch(html, /data-(?:visit-brief|new-visit-store|store-reminder)="store-b"/);
  }
  assert.equal(JSON.stringify({ records: h.ctx.records, payload: h.payload }), before);
  assert.equal(h.ctx.records.find(record => record.type === 'visit').heads.length, 2);
});

test('association review cards retain pending-store and store-conflict protections', () => {
  for (const options of [{ pendingStore: true }, { storeConflict: true }]) {
    const bundle = associationBundle(options), h = fixture(project(bundle), { bundle });
    const html = h.render('虛構乙歸屬店');
    assert.match(html, /data-visit-association-pending="true"/);
    assert.match(html, /data-review="visit:association-note"/);
    assert.doesNotMatch(html, /data-(?:visit-brief|new-visit-store|store-reminder)="store-b"/);
    if (options.pendingStore) assert.match(html, /門市身分待確認/);
    if (options.storeConflict) assert.match(html, /data-review="store:store-b"/);
  }
});

test('deleted conflict heads and resolved old versions do not create stale association warnings', () => {
  const deletedBundle = associationBundle({ otherHeadDeleted: true });
  const deleted = fixture(project(deletedBundle), { bundle: deletedBundle }).render('虛構乙歸屬店');
  assert.match(deleted, /尚無拜訪紀錄/);
  assert.doesNotMatch(deleted, /data-visit-association-pending=/);
  const resolvedBundle = associationBundle({ resolved: true }), h = fixture(project(resolvedBundle), { bundle: resolvedBundle });
  assert.doesNotMatch(h.render(), /data-visit-association-pending=/);
  assert.match(h.render('虛構乙歸屬店'), /data-rendered-visit="association-note"/);
  assert.match(h.render('虛構甲歸屬店'), /data-visit-empty-store="store-a"/);
});

test('source-name discovery keeps matching literal rather than silently normalizing names', () => {
  const h = fixture([store('literal-store', '虛構ＡＢＣ藥局－台北 店')]);
  assert.match(h.render('ａｂｃ'), /data-visit-empty-store="literal-store"/);
  for (const query of ['ABC', '台北店', '臺北 店']) assert.match(h.render(query), /沒有符合/);
});

test('single-line name searches ignore only CR and LF while all visit result shapes retain the original name', () => {
  for (const lineBreak of ['\n', '\r', '\r\n']) for (const noteCount of [0, 1, 2]) {
    const item = store('multiline-store', `虛構甲｜ ${lineBreak}分店`);
    const h = fixture([item, ...Array.from({ length: noteCount }, (_, index) => visit(`line-note-${index}`, item.id))]);
    h.useNoteRenderer();
    const before = JSON.stringify({ records: h.ctx.records, payload: h.payload });
    const singleLineQuery = item.name.replace(/[\r\n]/g, ''); // Native single-line input sanitization.
    const html = h.render(singleLineQuery);
    assert.doesNotMatch(html, /沒有符合/);
    assert.equal(h.ctx.storeVisitSearchRank(item, singleLineQuery), 0);
    assert.ok(h.ctx.visitStoreSearchText(item).includes(singleLineQuery));
    assert.ok(html.includes(`<mark class="search-match">虛構甲｜ </mark>${lineBreak}<mark class="search-match">分店</mark>`));
    assert.match(html, /名稱換行已忽略/);
    assert.match(html, /white-space:pre-wrap/);
    assert.match(h.render('虛構甲｜分店'), /沒有符合/, 'the real space remains significant');
    const literalHTML = h.render('分店');
    assert.match(literalHTML, /<mark class="search-match">分店<\/mark>/);
    assert.doesNotMatch(literalHTML, /名稱換行已忽略/, 'a match within one line needs no normalization claim');
    const nameHTML = h.ctx.visitStoreNameHTML(item.name, singleLineQuery);
    assert.equal(nameHTML.replace(/<[^>]+>/g, '').replace('（名稱換行已忽略）', ''), item.name);
    assert.equal(JSON.stringify({ records: h.ctx.records, payload: h.payload }), before);
  }
});

test('multiline raw source names and aliases use the same search and picker rule with escaped literal-part highlights', () => {
  const item = store('multiline-source', '虛構目前名稱', {
    csvAliases: ['虛構Alias\r名稱'],
    csvSources: [{ headers: ['Title'], cells: ['虛構<Source.>\r\n原名'] }],
  });
  const h = fixture([item, visit('source-first', item.id), visit('source-second', item.id)]);
  h.useNoteRenderer();
  for (const query of ['虛構Alias名稱', '虛構<Source.>原名']) {
    const html = h.render(query);
    assert.match(html, /2 筆命中 · 共 2 筆/);
    assert.match(html, /來源名稱/);
    assert.match(html, /名稱換行已忽略/);
    assert.equal(h.ctx.storeVisitSearchRank(item, query), 1);
    assert.ok(h.ctx.visitStoreSearchText(item).includes(query.toLocaleLowerCase('zh-Hant')));
  }
  const html = h.render('<Source.>原名');
  assert.ok(html.includes('<mark class="search-match">&lt;Source.&gt;</mark>\r\n<mark class="search-match">原名</mark>'));
  assert.doesNotMatch(html, /<Source/);
  assert.equal(item.csvAliases[0], '虛構Alias\r名稱');
  assert.equal(item.csvSources[0].cells[0], '虛構<Source.>\r\n原名');
});

test('line-break match mapping handles repeated hits and UTF-16 characters without highlighting a removed newline', () => {
  const h = fixture([]), name = '虛構😀\nＡ分店／😀\r\nＡ分店';
  const html = h.ctx.visitStoreNameHTML(name, '😀Ａ');
  assert.ok(html.includes('<mark class="search-match">😀</mark>\n<mark class="search-match">Ａ</mark>'));
  assert.ok(html.includes('<mark class="search-match">😀</mark>\r\n<mark class="search-match">Ａ</mark>'));
  assert.equal((html.match(/名稱換行已忽略/g) || []).length, 1);
  assert.equal(html.replace(/<[^>]+>/g, '').replace('（名稱換行已忽略）', ''), name);
  for (const match of html.matchAll(/<mark class="search-match">([^<]*)<\/mark>/g)) assert.doesNotMatch(match[1], /[\r\n]/);
});

test('name line-break handling does not normalize note text, tabs, other spaces, punctuation or Unicode width', () => {
  const h = fixture([store('literal', '虛構甲\t乙－台北 店'), visit('literal-note', 'literal', { text: '虛構原文甲\n乙', next: '虛構跟進甲\r\n乙' })]);
  for (const query of ['虛構原文甲乙', '虛構跟進甲乙', '虛構甲乙', '虛構甲 乙', '台北店', '臺北 店', '乙-台北']) assert.match(h.render(query), /沒有符合/);
});
