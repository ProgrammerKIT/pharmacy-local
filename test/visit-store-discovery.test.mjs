import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emptyBundle, revision, makeVisitAttendance, visitAttendanceForStore, reminderTaskHistory } from '../public/core.js';
import { storeIdentityPending } from '../public/relations.js';

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
    $: node, storeIdentityPending, reminderTaskHistory,
    storeAttendance: id => visitAttendanceForStore(payload.bundle, id),
    dateText: value => value || '',
    renderQuickVisit() {}, renderReminderDrafts() {},
    noteHTML: (record, query = '') => `<article data-rendered-visit="${record.id}" data-query="${query}"></article>`,
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
    sourceBetween('function openVisitForStore(', 'function captureVisitDraft(') +
    sourceBetween('function storeVisitSearchRank(', 'function sourceButton('), ctx);
  return {
    ctx, node, calls, payload,
    render(query = '') { node('visit-search').value = query; ctx.renderVisits(); return node('visit-list').innerHTML; },
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
