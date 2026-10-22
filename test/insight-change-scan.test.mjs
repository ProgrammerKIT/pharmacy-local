import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, revision, project, validateBundle, merge, scanInsightChanges, storeInsightsIdentityKey,
  insightReviewForEntry, planInsightReview, applyInsightReview } from '../public/core.js';

// Invented stores, people and prose only. No private/customer data fixtures.
const before = '2026-10-19T02:00:00.000Z', reviewed = '2026-10-20T02:00:00.000Z', after = '2026-10-22T02:00:00.000Z';
const storeData = name => ({ name, city: '', district: '', channel: '', attr: '', contact: '', address: '測試地址', mapUrl: '' });
const visitData = (store, text, date = '2026-10-19', people = []) => ({ store, text, date, people, next: '', source: '虛構測試', topics: [], attachments: [] });
const record = (bundle, type, id) => project(bundle).find(item => item.type === type && item.id === id);
function add(bundle, type, id, data, at = before, parents = []) {
  const op = revision(type, id, data, parents, 'synthetic-device'); op.at = at; bundle.ops.push(op); return op;
}
function edit(bundle, type, id, patch, at = after) {
  const old = record(bundle, type, id);
  return add(bundle, type, id, { ...old.heads[0].data, ...patch }, at, old.heads.map(head => head.id));
}
export function insightChangeFixture({ quote = '小安目前在青禾店工作。', headline = quote, people = [] } = {}) {
  const bundle = emptyBundle('synthetic-insight-scan');
  add(bundle, 'store', 'a', storeData('青禾店')); add(bundle, 'store', 'b', storeData('松林店'));
  if (people.length) add(bundle, 'person', 'person-a', { name: '小安', role: '', desc: '', confirmed: true, sameAs: '' });
  const original = add(bundle, 'visit', 'old-note', visitData('a', quote, '2026-10-19', people));
  const entry = { id: 'card', kind: 'relationship', level: 'source', headline, question: '虛構問題', caution: '', limitations: [],
    evidence: [{ storeId: 'a', storeIdentityKey: storeInsightsIdentityKey(record(bundle, 'store', 'a')), visitId: 'old-note', revisionId: original.id, quote, role: 'support' }] };
  edit(bundle, 'store', 'a', { preVisitInsights: { format: 'pharmacy-store-insights-1', batchId: 'synthetic-batch', generatedAt: before, sourceAsOf: '2026-10-19', entries: [entry] },
    preVisitInsightReviews: [{ id: 'review', status: 'confirmed', reviewedBy: 'Kit', reviewedAt: reviewed, sourceAsOf: '2026-10-19', entry: structuredClone(entry) }] }, reviewed);
  return validateBundle(bundle);
}
export function addInsightChangeNote(bundle, text = '小安已離職。', options = {}) {
  return add(bundle, 'visit', options.id || 'new-note', visitData(options.store || 'a', text, options.date ?? '2026-10-22', options.people || []), options.at || after);
}
const changes = async bundle => (await scanInsightChanges(bundle)).stores.flatMap(store => store.changes);
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };

test('confirmed named employment change has exact traceable old/new evidence without changing bundle, review or history', async () => {
  const bundle = insightChangeFixture(), op = addInsightChangeNote(bundle), original = structuredClone(bundle); freeze(bundle);
  const result = await scanInsightChanges(bundle);
  assert.equal(result.stores.length, 1); assert.equal(result.stores[0].storeId, 'a');
  const [change] = result.stores[0].changes;
  assert.match(change.id, /^[a-f0-9]{64}$/); assert.equal(change.kind, 'important-change');
  assert.equal(change.entryId, 'card'); assert.match(change.reason, /原確認仍保留/);
  assert.deepEqual(change.newEvidence, { storeId: 'a', visitId: 'new-note', revisionId: op.id, quote: '小安已離職。' });
  assert.equal(change.originalEvidence[0].quote, '小安目前在青禾店工作。');
  assert.deepEqual(bundle, original);
  change.originalEvidence[0].quote = 'mutated output'; assert.deepEqual(bundle, original);
  const store = record(bundle, 'store', 'a'); assert.equal(insightReviewForEntry(store, store.preVisitInsights.entries[0]).status, 'confirmed');
});

test('no time-based reconfirmation, no new message, and ordinary supporting or unrelated notes produce no hint', async () => {
  const bundle = insightChangeFixture(); assert.deepEqual(await changes(bundle), []);
  for (const text of ['小安目前仍在青禾店工作。', '小安今天介紹新產品。', '小岑已離職。', '其他店有人已離職。', '小安的朋友已離職。', '小安說小岑已離職。', '本店今日休息。']) {
    const next = structuredClone(bundle); addInsightChangeNote(next, text); assert.deepEqual(await changes(next), [], text);
  }
});

test('uncertain, denied, quoted-as-false, hypothetical, future, question and retrospective events stay silent', async () => {
  for (const text of ['小安沒有離職。', '小安並未離職。', '小安否認已離職。', '小安可能已離職。', '聽說小安已離職。', '小安已離職嗎？',
    '小安已離職?', '小安已離職，不確定。', '小安已離職是假設。', '小安已離職的消息是假的。', '如果小安已離職，要問別人。',
    '小安預計離職。', '小安明天已離職。', '小安明年會離職。', '小安曾經已離職。', '小安去年已離職。', '補記：小安已離職。',
    '小安已離職，不代表已查證。', '小安已離職，這是誤傳。', '小安尚未離職。', '小安已退休了嗎？']) {
    const bundle = insightChangeFixture(); addInsightChangeNote(bundle, text); assert.deepEqual(await changes(bundle), [], text);
  }
});

test('same original text, metadata or punctuation-only source revisions never become a change hint', async () => {
  for (const patch of [{}, { next: '虛構新待辦' }, { text: ' 小安目前在青禾店工作！ ' }, { text: '小安目前在青禾店工作\n' }]) {
    const bundle = insightChangeFixture(); edit(bundle, 'visit', 'old-note', patch); assert.deepEqual(await changes(bundle), []);
  }
});

test('a substantial source revision can show a current change; old quote and original confirmation survive', async () => {
  const bundle = insightChangeFixture(); edit(bundle, 'visit', 'old-note', { text: '經確認，小安已離職。' });
  const found = await changes(bundle); assert.equal(found.length, 1); assert.equal(found[0].newEvidence.visitId, 'old-note');
  assert.equal(found[0].originalEvidence[0].quote, '小安目前在青禾店工作。');
});

test('new backfilled old entries and messages recorded before confirmation do not alert', async () => {
  for (const options of [{ date: '2025-01-01' }, { at: before }, { at: reviewed }, { at: 'invalid' }]) {
    const bundle = insightChangeFixture(); addInsightChangeNote(bundle, '小安已離職。', options); assert.deepEqual(await changes(bundle), []);
  }
  const bundle = insightChangeFixture(); addInsightChangeNote(bundle, '小安已離職。', { at: before });
  edit(bundle, 'visit', 'new-note', { next: 'only metadata changes' }); assert.deepEqual(await changes(bundle), []);
});

test('past transfer is not disproved by new departure; old events repeated in another visit are not new', async () => {
  const bundle = insightChangeFixture({ quote: '小安曾從松林店調到青禾店。' }); addInsightChangeNote(bundle);
  const found = await changes(bundle); assert.equal(found.length, 1); assert.equal(found[0].kind, 'important-change'); assert.match(found[0].reason, /不否定.*歷史/);
  for (const quote of ['小安已離職。', '小安已退休。']) {
    const old = insightChangeFixture({ quote }); addInsightChangeNote(old, '小安已經離職。'); assert.deepEqual(await changes(old), []);
  }
  const same = insightChangeFixture({ quote: '小安已調到青禾店。' }); addInsightChangeNote(same, '小安已調到青禾店。'); assert.deepEqual(await changes(same), []);
});

test('clear transfers and role changes have evidence while unrelated changes do not', async () => {
  for (const text of ['小安已調到松林店。', '小安已轉任主管。', '小安正式退休。', '小安離職了。', '小安已不再擔任店長。']) {
    const bundle = insightChangeFixture(); addInsightChangeNote(bundle, text); assert.equal((await changes(bundle)).length, 1, text);
  }
  const bundle = insightChangeFixture({ quote: '小安與小岑是朋友。' }); addInsightChangeNote(bundle); assert.deepEqual(await changes(bundle), []);
});

test('relation change requires both exact subjects, compatible relationship and explicit actual change', async () => {
  for (const [text, count] of [['小安與小岑已不再聯絡。', 1], ['小岑與小安已不再聯絡。', 1], ['小安與小雨已不再聯絡。', 0],
    ['小安與小岑可能不再聯絡。', 0], ['小安與小岑不是朋友。', 0], ['經確認，小安與小岑不是朋友。', 1], ['小安與小岑已離婚。', 0]]) {
    const bundle = insightChangeFixture({ quote: '小安與小岑是朋友。' }); addInsightChangeNote(bundle, text); assert.equal((await changes(bundle)).length, count, text);
  }
  const bundle = insightChangeFixture({ quote: '小安與小岑曾是朋友。' }); addInsightChangeNote(bundle, '經確認，小安與小岑不是朋友。');
  const found = await changes(bundle); assert.equal(found[0].kind, 'important-change'); assert.match(found[0].reason, /不否定.*歷史/);
});

test('explicit same-person correction has exact two-subject binding and cannot be inferred from generic 不是', async () => {
  const bundle = insightChangeFixture({ quote: '小安與小岑是同一人。' }); addInsightChangeNote(bundle, '經確認，小安與小岑不是同一人。');
  assert.equal((await changes(bundle))[0].kind, 'possible-contradiction');
  for (const text of ['不是同一人。', '經確認，小安與小雨不是同一人。', '小安與小岑可能不是同一人。', '小安與小岑不是同一人嗎？', '小安不是店長。']) {
    const next = insightChangeFixture({ quote: '小安與小岑是同一人。' }); addInsightChangeNote(next, text); assert.deepEqual(await changes(next), [], text);
  }
});

test('same name in another store never binds without the same confirmed person ID', async () => {
  for (const text of ['小安已離職。', '經確認，小安已離職。']) {
    const bundle = insightChangeFixture(); addInsightChangeNote(bundle, text, { store: 'b' }); assert.deepEqual(await changes(bundle), []);
  }
  const linked = insightChangeFixture({ people: ['person-a'] }); addInsightChangeNote(linked, '小安已離職。', { store: 'b', people: ['person-a'] });
  assert.equal((await changes(linked)).length, 1);
  for (const patch of [{ confirmed: false }, { sameAs: 'somebody-else' }]) {
    const bundle = structuredClone(linked); edit(bundle, 'person', 'person-a', patch); assert.deepEqual(await changes(bundle), []);
  }
});

test('different explicit person IDs block same-name matches even within one store', async () => {
  const bundle = insightChangeFixture({ people: ['person-a'] });
  add(bundle, 'person', 'other-person', { name: '小安', role: '', desc: '', confirmed: true, sameAs: '' });
  addInsightChangeNote(bundle, '小安已離職。', { people: ['other-person'] }); assert.deepEqual(await changes(bundle), []);
});

test('incidental named sources do not turn unrelated card headlines into changes', async () => {
  const bundle = insightChangeFixture({ headline: '今天有一項商品採購線索。' }); addInsightChangeNote(bundle); assert.deepEqual(await changes(bundle), []);
});

test('unconfirmed, rejected, withdrawn or differently edited cards do not inherit an old approval', async () => {
  for (const status of ['pending', 'rejected']) {
    const bundle = insightChangeFixture(), store = record(bundle, 'store', 'a');
    const changed = applyInsightReview(bundle, planInsightReview(bundle, 'a', 'card', status, store.heads[0].id), 'test'); addInsightChangeNote(changed);
    assert.deepEqual(await changes(changed), []);
  }
  for (const mutate of [store => ({ preVisitInsightReviews: [] }), store => ({ preVisitInsights: { ...store.preVisitInsights, entries: [] } }),
    store => ({ preVisitInsights: { ...store.preVisitInsights, entries: [{ ...store.preVisitInsights.entries[0], headline: '小安在別店工作。' }] } })]) {
    const bundle = insightChangeFixture(); edit(bundle, 'store', 'a', mutate(record(bundle, 'store', 'a'))); addInsightChangeNote(bundle); assert.deepEqual(await changes(bundle), []);
  }
});

test('conflicting or unsafe stores, old sources and new notes never manufacture semantic alerts', async () => {
  for (const [type, id, patch] of [['store', 'a', { csvIdentityPending: true }], ['store', 'a', { name: '另一家門市' }], ['store', 'a', { mergedInto: 'b' }],
    ['visit', 'old-note', { sourceMissing: true }], ['visit', 'old-note', { store: 'b' }], ['visit', 'new-note', { googleUpdatePending: true }]]) {
    const bundle = insightChangeFixture(); addInsightChangeNote(bundle); edit(bundle, type, id, patch); assert.deepEqual(await changes(bundle), [], JSON.stringify([type,id,patch]));
  }
  for (const [type, id] of [['store', 'a'], ['visit', 'old-note'], ['visit', 'new-note']]) {
    const bundle = insightChangeFixture(); addInsightChangeNote(bundle); const old = record(bundle, type, id);
    add(bundle, type, id, old.heads[0].data, after, [old.heads[0].id]); add(bundle, type, id, old.heads[0].data, after, [old.heads[0].id]);
    assert.deepEqual(await changes(bundle), []);
  }
});

test('stable IDs survive merge order, repeated scan, revision-only changes, punctuation and whitespace', async () => {
  const bundle = insightChangeFixture(); addInsightChangeNote(bundle); const [first] = await changes(bundle);
  assert.equal((await changes(bundle))[0].id, first.id);
  assert.equal((await changes(merge(bundle, bundle)))[0].id, first.id);
  assert.equal((await changes({ ...bundle, ops: [...bundle.ops].reverse() }))[0].id, first.id);
  edit(bundle, 'visit', 'new-note', { next: 'new unrelated metadata', text: '  小安已離職！  ' }, '2026-10-23T02:00:00.000Z');
  const [next] = await changes(bundle); assert.equal(next.id, first.id); assert.notEqual(next.newEvidence.revisionId, first.newEvidence.revisionId);
  edit(bundle, 'visit', 'new-note', { text: '小安已調到松林店。' }, '2026-10-24T02:00:00.000Z'); assert.notEqual((await changes(bundle))[0].id, first.id);
});

test('ID binds the complete approval/card and cannot carry an old read acknowledgement to a new review', async () => {
  const bundle = insightChangeFixture(); addInsightChangeNote(bundle); const [first] = await changes(bundle);
  const store = record(bundle, 'store', 'a'), event = { ...structuredClone(store.preVisitInsightReviews[0]), id: 'new-confirmation', reviewedAt: '2026-10-21T02:00:00.000Z' };
  edit(bundle, 'store', 'a', { preVisitInsightReviews: [...store.preVisitInsightReviews, event] }); assert.notEqual((await changes(bundle))[0].id, first.id);
});

test('duplicate source quotations do not duplicate the same change', async () => {
  const bundle = insightChangeFixture(), store = record(bundle, 'store', 'a'), entry = structuredClone(store.preVisitInsights.entries[0]);
  // Another exact support for the same subject, independently cited.
  const op = add(bundle, 'visit', 'other-old-note', visitData('a', '小安目前在青禾店工作。'));
  entry.evidence.push({ ...entry.evidence[0], visitId: op.entity, revisionId: op.id });
  edit(bundle, 'store', 'a', { preVisitInsights: { ...store.preVisitInsights, entries: [entry] }, preVisitInsightReviews: [{ ...store.preVisitInsightReviews[0], id: 'review-full-card', entry }] }, reviewed);
  addInsightChangeNote(bundle); assert.equal((await changes(bundle)).length, 1);
});

test('large unrelated dataset scans without alerts or mutations and still finds a single relevant event', async () => {
  const bundle = insightChangeFixture();
  for (let i = 0; i < 6000; i++) addInsightChangeNote(bundle, '這是虛構一般產品介紹與拜訪紀錄。', { id: 'unrelated-' + i });
  addInsightChangeNote(bundle); const snapshot = JSON.stringify(bundle), start = performance.now();
  assert.equal((await changes(bundle)).length, 1); assert.equal(JSON.stringify(bundle), snapshot);
  assert.ok(performance.now() - start < 5000, '6000 unrelated visits should remain a bounded indexed scan');
});


test('later disclaimers, denied events, retrospective context and hypothetical headings suppress the whole incoming note', async () => {
  for (const text of ['小安已離職，但搞錯了人。', '小安已離職，只是我記錯了。', '小安已離職。更正：小安沒有離職。',
    '小安已離職。剛剛核對，這是誤傳。', '小安已離職。這是以前的紀錄。', '小安已離職。這是當時的紀錄。',
    '假設情境：\n小安已離職。', '小安已離職，這是假消息。', '小安已離職。小安已離職嗎？']) {
    const bundle = insightChangeFixture(); addInsightChangeNote(bundle, text); assert.deepEqual(await changes(bundle), [], text);
  }
});

test('restating the already known workplace or role is supporting detail, not a material change', async () => {
  for (const [quote, text] of [['小安目前在青禾店工作。', '小安已調到青禾店。'], ['小安目前是店長。', '小安已轉任店長。'],
    ['小安曾從松林店調到青禾店。', '小安已調到青禾店工作。'], ['小安是青禾店店長。', '小安已改任青禾店店長。'],
    ['小安曾從松林店調到青禾店。', '小安已從松林店調到青禾店。']]) {
    const bundle = insightChangeFixture({ quote }); addInsightChangeNote(bundle, text); assert.deepEqual(await changes(bundle), [], text);
  }
  const bundle = insightChangeFixture({ quote: '小安目前是店長。' }); addInsightChangeNote(bundle, '小安已改任主管。'); assert.equal((await changes(bundle)).length, 1);
});

test('name boundaries retain two-, three-, four-character and Latin subjects beside time markers', async () => {
  for (const name of ['小安', '林小安', '歐陽小安', 'Alex']) for (const when of ['已', '已經', '現已', '目前', '現在']) {
    const bundle = insightChangeFixture({ quote: name + '目前在青禾店工作。' }); addInsightChangeNote(bundle, name + when + '離職。');
    assert.equal((await changes(bundle)).length, 1, name + when);
  }
});

test('cross-domain incidental support does not invent a different claim to recheck', async () => {
  const bundle = insightChangeFixture({ headline: '小安與小岑是朋友。' }); addInsightChangeNote(bundle); assert.deepEqual(await changes(bundle), []);
});

test('a semantic read ID is unchanged by equivalent time markers, internal spacing or unrelated trailing detail', async () => {
  const bundle = insightChangeFixture(); addInsightChangeNote(bundle); const [first] = await changes(bundle);
  for (const text of ['小安已經離職。', '小安 已 離職。', '小安已離職，今天另有新品介紹。']) {
    edit(bundle, 'visit', 'new-note', { text }, '2026-10-23T02:00:00.000Z'); assert.equal((await changes(bundle))[0].id, first.id, text);
  }
});

test('explicitly linked unsafe or renamed people cannot fall back to name matching in the same store', async () => {
  for (const patch of [{ confirmed: false }, { name: '小雨' }, { sameAs: 'another-person' }]) {
    const bundle = insightChangeFixture({ people: ['person-a'] }); addInsightChangeNote(bundle, '小安已離職。', { people: ['person-a'] });
    edit(bundle, 'person', 'person-a', patch); assert.deepEqual(await changes(bundle), []);
  }
});

test('shared relationship approval is used only with exact safe mappings and no opposed local/peer review', async () => {
  const bundle = insightChangeFixture(), firstStore = record(bundle, 'store', 'a'), baseEntry = structuredClone(firstStore.preVisitInsights.entries[0]);
  const original = add(bundle, 'visit', 'b-old-note', visitData('b', baseEntry.evidence[0].quote));
  baseEntry.evidence.push({ ...baseEntry.evidence[0], storeId: 'b', storeIdentityKey: storeInsightsIdentityKey(record(bundle, 'store', 'b')),
    visitId: original.entity, revisionId: original.id });
  const relation = { format: 'pharmacy-insight-relation-1', id: 'shared-employment', claim: '虛構同一主體任職線索', members: ['a', 'b'].map(storeId => ({
    storeId, storeIdentityKey: storeInsightsIdentityKey(record(bundle, 'store', storeId)), entry: structuredClone(baseEntry) })) };
  for (const storeId of ['a', 'b']) edit(bundle, 'store', storeId, {
    preVisitInsights: { ...firstStore.preVisitInsights, entries: [structuredClone(baseEntry)] }, preVisitInsightRelations: [structuredClone(relation)],
    preVisitInsightReviews: storeId === 'a' ? [{ ...firstStore.preVisitInsightReviews[0], id: 'review-shared', entry: structuredClone(baseEntry) }] : []
  }, reviewed);
  addInsightChangeNote(bundle); assert.deepEqual((await scanInsightChanges(bundle)).stores.map(store => store.storeId), ['a', 'b']);
  edit(bundle, 'store', 'b', { preVisitInsightReviews: [{ ...record(bundle, 'store', 'a').preVisitInsightReviews[0], id: 'peer-pending', status: 'pending' }] }, reviewed);
  assert.deepEqual(await changes(bundle), []);
});


test('attributed long headlines retain explicit named employment context without accepting incidental name/job mentions', async () => {
  for (const headline of ['本店記錄小安由松林店調來，松林筆記也寫他去了青禾；這條具名調動能接續舊店互動。',
    '舊筆記提到小安曾從松林店調到青禾店，這段歷史可接續互動。']) {
    const bundle = insightChangeFixture({ quote: '小安曾從松林店調到青禾店。', headline }); addInsightChangeNote(bundle);
    const found = await changes(bundle); assert.equal(found.length, 1, headline); assert.equal(found[0].kind, 'important-change'); assert.match(found[0].reason, /不否定.*歷史/);
  }
  for (const headline of ['小安與小岑是朋友，原始拜訪筆記也有任職紀錄。', '本店記錄小安與小岑是朋友，今天拜訪工作有進度。',
    '本店記錄小岑由松林店調來，小安介紹兩人認識。', '本店記錄小安可能由松林店調來，身分待查。']) {
    const bundle = insightChangeFixture({ quote: '小安曾從松林店調到青禾店。', headline }); addInsightChangeNote(bundle);
    assert.deepEqual(await changes(bundle), [], headline);
  }
});
