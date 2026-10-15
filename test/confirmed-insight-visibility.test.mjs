import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBundle, revision, project, validateBundle, merge, planBackupImport,
  newMeta, derive, seal, unseal, makeVisitAttendance, storeInsightsIdentityKey,
  storeInsightsForStore, storeInsightDisplayForStore, storeInsightEvidenceForEntry,
  insightReviewForEntry, storeInsightReviewHistory, planInsightReview, applyInsightReview,
  planStoreInsights
} from '../public/core.js';

// Invented data only; no real store, person, quote, device or production backup.
const at = '2026-10-07T02:00:00.000Z';
const storeData = name => ({ name, city: 'Synthetic city', district: 'Synthetic district', channel: '', attr: '', contact: '', address: 'Synthetic address', mapUrl: '',
  nextRemember: 'Synthetic next reminder', everyTimeMust: 'Synthetic routine', extra: { retain: true } });
const note = (store, text) => ({ store, date: '', text, next: 'Synthetic next', source: 'Synthetic source', topics: [], people: [], attachments: [] });
const record = (bundle, type = 'store', id = 'a') => project(bundle).find(item => item.type === type && item.id === id);
const entry = bundle => record(bundle).preVisitInsights.entries[0];
function append(bundle, type, id, patch = {}, deleted = false) {
  const current = record(bundle, type, id), op = revision(type, id, { ...current.heads[0].data, ...patch }, current.heads.map(head => head.id), 'synthetic-change', deleted);
  bundle.ops.push(op); return op;
}
function fixture(vaultId = 'synthetic-display-vault') {
  const bundle = emptyBundle(vaultId);
  bundle.ops.push(revision('store', 'a', storeData('Synthetic A'), [], 'synthetic', false, makeVisitAttendance('a', at)));
  bundle.ops.push(revision('store', 'b', storeData('Synthetic B'), [], 'synthetic'));
  bundle.ops.push(revision('visit', 'va', note('a', '  Synthetic person A knew person B.\r\nOriginal unabridged text.  '), [], 'synthetic'));
  bundle.ops.push(revision('visit', 'vb', note('b', 'Synthetic reciprocal observation.\nOriginal additional detail.'), [], 'synthetic'));
  const evidence = [['a', 'va', 'Synthetic person A knew person B.'], ['b', 'vb', 'Synthetic reciprocal observation.']].map(([storeId, visitId, quote]) => ({
    storeId, storeIdentityKey: storeInsightsIdentityKey(record(bundle, 'store', storeId)), visitId,
    revisionId: record(bundle, 'visit', visitId).heads[0].id, quote, role: 'support'
  }));
  const profile = { format: 'pharmacy-store-insights-1', batchId: 'synthetic-batch', generatedAt: at, sourceAsOf: '2026-10-07', entries: [{
    id: 'synthetic-card', kind: 'relationship', level: 'source', headline: 'Synthetic confirmed connection', question: 'Synthetic optional question?',
    caution: 'Synthetic caution', limitations: ['Synthetic evidence limitation'], evidence
  }] };
  append(bundle, 'store', 'a', { preVisitInsights: profile });
  return bundle;
}
const review = (bundle, status) => applyInsightReview(bundle, planInsightReview(bundle, 'a', 'synthetic-card', status, record(bundle).heads[0].id), 'synthetic-Kit');
const view = bundle => storeInsightDisplayForStore(bundle, 'a');
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

test('current cards retain strict review identity and exact source text without data mutation', () => {
  for (const status of ['pending', 'confirmed', 'rejected']) {
    const bundle = review(fixture(), status), before = structuredClone(bundle); freeze(bundle);
    const displayed = view(bundle), card = displayed.entries[0];
    assert.equal(displayed.entries.length, 1); assert.equal(displayed.staleCount, 0); assert.equal(displayed.confirmedStaleCount, 0);
    assert.equal(card.sourceCurrent, true); assert.equal(card.sourceNotice, ''); assert.deepEqual(card.sourceReasons, []);
    assert.equal(insightReviewForEntry(record(bundle), card).status, status);
    assert.equal(card.evidence[0].rawText, record(bundle, 'visit', 'va').text);
    assert.deepEqual(bundle, before);
  }
});

test('a same-text source revision preserves current Kit confirmation and displays a precise source notice', () => {
  const bundle = review(fixture(), 'confirmed'), original = record(bundle, 'visit', 'va').text, originalEntry = structuredClone(entry(bundle));
  append(bundle, 'visit', 'va', {}); const before = structuredClone(bundle); freeze(bundle);
  assert.deepEqual(storeInsightsForStore(bundle, 'a'), { entries: [], staleCount: 1 });
  const shown = view(bundle), card = shown.entries[0];
  assert.equal(shown.confirmedStaleCount, 1); assert.equal(shown.staleCount, 0); assert.equal(card.sourceCurrent, false);
  assert.match(card.sourceNotice, /來源已更新.*Kit 已確認/); assert.match(card.sourceReasons.join(' '), /原文字未變/);
  assert.equal(card.headline, originalEntry.headline); assert.equal(insightReviewForEntry(record(bundle), card).status, 'confirmed');
  assert.equal(card.evidence[0].rawText, original); assert.equal(card.evidence[0].revisionId, originalEntry.evidence[0].revisionId);
  assert.deepEqual(bundle, before);
});

test('changed source text is never substituted for the exact historical evidence text', () => {
  const bundle = review(fixture(), 'confirmed'), originalText = record(bundle, 'visit', 'vb').text, originalRevision = record(bundle, 'visit', 'vb').heads[0];
  append(bundle, 'visit', 'vb', { text: 'Synthetic new text without the quote.', source: 'Synthetic changed label' });
  const card = view(bundle).entries[0], source = card.evidence[1];
  assert.equal(card.sourceCurrent, false); assert.equal(source.historicalAvailable, true); assert.equal(source.rawText, originalText);
  assert.equal(source.sourceLabel, 'Synthetic source'); assert.equal(source.revisionAt, originalRevision.at);
  assert.match(source.sourceNotice, /新版本，文字需重新核對/);
  assert.equal(insightReviewForEntry(record(bundle), card).status, 'confirmed');
});

test('all referenced-store and visit safety changes keep only current confirmed cards visible with notices', () => {
  const mutations = [
    bundle => append(bundle, 'visit', 'vb', {}, true),
    bundle => append(bundle, 'visit', 'vb', { store: 'a' }),
    bundle => { bundle.ops = bundle.ops.filter(op => !(op.type === 'visit' && op.entity === 'vb')); },
    bundle => append(bundle, 'store', 'b', { name: 'Synthetic renamed B', address: 'Synthetic new address' }),
    bundle => append(bundle, 'store', 'b', { csvIdentityPending: true }),
    bundle => append(bundle, 'store', 'b', { mergedInto: 'a' }),
    bundle => append(bundle, 'store', 'b', {}, true),
    bundle => { const base = record(bundle, 'visit', 'vb').heads[0]; for (const device of ['synthetic-1', 'synthetic-2']) bundle.ops.push(revision('visit', 'vb', base.data, [base.id], device)); },
    bundle => { const base = record(bundle, 'store', 'b').heads[0]; for (const device of ['synthetic-1', 'synthetic-2']) bundle.ops.push(revision('store', 'b', base.data, [base.id], device)); }
  ];
  for (const flag of ['sourceMissing', 'googleUpdatePending']) for (const type of ['store', 'visit']) mutations.push(bundle => append(bundle, type, type === 'store' ? 'b' : 'vb', { [flag]: true }));
  for (const mutate of mutations) for (const status of ['confirmed', 'pending', 'rejected']) {
    const bundle = review(fixture(), status); mutate(bundle); const before = structuredClone(bundle); freeze(bundle);
    const shown = view(bundle);
    assert.equal(shown.entries.length, status === 'confirmed' ? 1 : 0); assert.equal(shown.confirmedStaleCount, status === 'confirmed' ? 1 : 0);
    if (status === 'confirmed') { assert.equal(shown.entries[0].sourceCurrent, false); assert.ok(shown.entries[0].sourceReasons.length); }
    assert.equal(storeInsightReviewHistory(record(bundle)).length, status === 'pending' ? 0 : 1);
    assert.deepEqual(bundle, before);
  }
});

test('owner identity or source changes retain confirmation with a notice; deleted, merged and conflicted owners never select a branch', () => {
  for (const patch of [{ name: 'Synthetic renamed A' }, { csvIdentityPending: true }, { sourceMissing: true }, { googleUpdatePending: true }]) {
    const bundle = review(fixture(), 'confirmed'); append(bundle, 'store', 'a', patch);
    assert.equal(view(bundle).entries.length, 1); assert.equal(view(bundle).entries[0].sourceCurrent, false);
    assert.equal(insightReviewForEntry(record(bundle), view(bundle).entries[0]).status, 'confirmed');
  }
  for (const mutate of [bundle => append(bundle, 'store', 'a', {}, true), bundle => append(bundle, 'store', 'a', { mergedInto: 'b' }),
    bundle => { const base = record(bundle).heads[0]; for (const device of ['synthetic-1', 'synthetic-2']) bundle.ops.push(revision('store', 'a', base.data, [base.id], device)); }]) {
    const bundle = review(fixture(), 'confirmed'); mutate(bundle); assert.equal(view(bundle).entries.length, 0);
  }
});

test('newer rejected or pending decisions supersede confirmation even after sources update', () => {
  for (const status of ['rejected', 'pending']) {
    const bundle = review(review(fixture(), 'confirmed'), status); append(bundle, 'visit', 'vb', {});
    assert.equal(view(bundle).entries.length, 0); assert.equal(insightReviewForEntry(record(bundle), entry(bundle)).status, status);
    assert.deepEqual(record(bundle).preVisitInsightReviews.map(event => event.status), ['confirmed', status]);
    assert.equal(storeInsightReviewHistory(record(bundle)).length, 2);
  }
});

test('withdrawn cards and restored older review arrays never revive confirmations from history', () => {
  const original = fixture(), bundle = review(original, 'confirmed');
  append(bundle, 'store', 'a', { preVisitInsights: { ...record(bundle).preVisitInsights, entries: [] } });
  assert.equal(view(bundle).entries.length, 0); assert.equal(storeInsightReviewHistory(record(bundle)).length, 1);
  const head = record(bundle).heads[0]; bundle.ops.push(revision('store', 'a', record(original).heads[0].data, [head.id], 'synthetic-explicit-restore'));
  append(bundle, 'visit', 'va', {});
  assert.equal(view(bundle).entries.length, 0); assert.equal(insightReviewForEntry(record(bundle), entry(bundle)).status, 'pending');
  assert.equal(storeInsightReviewHistory(record(bundle))[0].historical, true);
});

test('changing any exact card claim or evidence never inherits confirmation merely by card ID', () => {
  for (const mutate of [card => { card.headline += ' changed'; }, card => { card.question += ' changed'; }, card => { card.caution += ' changed'; },
    card => { card.limitations.push('Synthetic new limit'); }, card => { card.evidence[0].quote = 'Original unabridged text.'; },
    card => { card.evidence.reverse(); }]) {
    const bundle = review(fixture(), 'confirmed'), profile = structuredClone(record(bundle).preVisitInsights); mutate(profile.entries[0]);
    append(bundle, 'store', 'a', { preVisitInsights: profile }); append(bundle, 'visit', 'va', {});
    assert.equal(view(bundle).entries.length, 0); assert.equal(insightReviewForEntry(record(bundle), entry(bundle)).status, 'pending');
    assert.equal(storeInsightReviewHistory(record(bundle)).length, 1);
  }
});

test('concurrent confirmed/rejected reviews stay conflicted after encryption-independent merging, without branch promotion', () => {
  const original = fixture(), combined = merge(review(original, 'confirmed'), review(original, 'rejected'));
  assert.equal(record(combined).conflict, true); assert.equal(view(combined).entries.length, 0);
  assert.equal(storeInsightReviewHistory(record(combined)).length, 2);
  assert.equal(insightReviewForEntry(record(combined), entry(original)).status, 'pending');
});

test('historical evidence requires exact revision type, entity, store, quote and captured store identity', () => {
  const bundle = review(fixture(), 'confirmed'), card = entry(bundle);
  for (const mutate of [source => { source.revisionId = record(bundle).heads[0].id; }, source => { source.visitId = 'vb'; },
    source => { source.storeId = 'b'; }, source => { source.quote = 'Synthetic quote that never existed.'; },
    source => { source.revisionId = 'synthetic-missing-revision'; },
    source => { source.storeIdentityKey = storeInsightsIdentityKey({ ...record(bundle), name: 'Synthetic unverified identity' }); }]) {
    const changed = structuredClone(card); mutate(changed.evidence[0]); const source = storeInsightEvidenceForEntry(bundle, changed)[0];
    assert.equal(source.historicalAvailable, false); assert.equal(Object.hasOwn(source, 'rawText'), false); assert.match(source.sourceNotice, /無法核實/);
  }
  const deleted = append(bundle, 'visit', 'va', {}, true), changed = structuredClone(card); changed.evidence[0].revisionId = deleted.id;
  assert.equal(storeInsightEvidenceForEntry(bundle, changed)[0].historicalAvailable, false);
  assert.deepEqual(storeInsightEvidenceForEntry(bundle, {}), []);
});

test('historical source remains precisely readable after current deletion, rename or conflict without substituting a current branch', () => {
  const bundle = review(fixture(), 'confirmed'), card = structuredClone(entry(bundle)), original = record(bundle, 'visit', 'va').text;
  append(bundle, 'store', 'a', { name: 'Synthetic new name' }); append(bundle, 'visit', 'va', { text: 'Synthetic deleted changed text.' }, true);
  const source = storeInsightEvidenceForEntry(bundle, card)[0];
  assert.equal(source.historicalAvailable, true); assert.equal(source.rawText, original); assert.equal(source.storeName, 'Synthetic A');
  assert.match(source.sourceNotice, /身分資料已變更/); assert.match(source.sourceNotice, /回收桶/);
});

test('read-only display cannot loosen strict source rules for imports or review writes', () => {
  const bundle = review(fixture(), 'confirmed'); append(bundle, 'visit', 'va', {});
  const before = structuredClone(bundle), profile = record(bundle).preVisitInsights;
  assert.equal(view(bundle).entries.length, 1);
  assert.throws(() => planInsightReview(bundle, 'a', 'synthetic-card', 'rejected', record(bundle).heads[0].id), /來源/);
  const input = { format: 'pharmacy-store-insights-import-1', vaultId: bundle.vaultId, generatedAt: profile.generatedAt, sourceAsOf: profile.sourceAsOf,
    stores: [{ storeId: 'a', expectedStoreHead: record(bundle).heads[0].id, insights: profile }] };
  const importPlan = planStoreInsights(bundle, input);
  assert.equal(importPlan.ready.length, 0); assert.equal(importPlan.excluded.length, 1); assert.deepEqual(bundle, before);
});

test('display data is detached and repeated deep-frozen reads create no revisions, review events, dates, or blob changes', () => {
  const bundle = review(fixture(), 'confirmed'); append(bundle, 'visit', 'va', {});
  const before = structuredClone(bundle); freeze(bundle);
  for (let i = 0; i < 3; i++) {
    const shown = view(bundle), sources = storeInsightEvidenceForEntry(bundle, entry(bundle));
    shown.entries[0].headline = 'Synthetic altered returned display'; shown.entries[0].evidence[0].quote = 'Synthetic altered returned quote';
    shown.entries[0].sourceReasons.push('Synthetic altered reason'); sources[0].rawText = 'Synthetic altered result';
  }
  assert.deepEqual(bundle, before); validateBundle(bundle);
});

test('viewing confirmed stale cards preserves encrypted backup, sync, original versions, review events and attendance exactly', async () => {
  const meta = newMeta(), original = review(fixture(meta.vaultId), 'confirmed'), bundle = structuredClone(original);
  append(bundle, 'visit', 'va', { text: 'Synthetic later source update.' });
  const before = structuredClone(bundle); freeze(bundle);
  view(bundle); storeInsightEvidenceForEntry(bundle, entry(bundle));
  const key = await derive('synthetic-display-only-passphrase', meta), decoded = await unseal(await seal(bundle, key, meta), key);
  assert.deepEqual(decoded, before); assert.deepEqual(merge(original, decoded), merge(decoded, original));
  const preview = await planBackupImport(bundle, decoded);
  assert.equal(preview.summary.addedRevisions, 0); assert.equal(preview.summary.changedExistingEntities, 0);
  assert.equal(preview.summary.visitAttendance.addedMarks, 0); assert.deepEqual(preview.summary.warnings, []);
  assert.deepEqual(record(preview.bundle).preVisitInsightReviews, record(before).preVisitInsightReviews);
  assert.deepEqual(preview.bundle.ops.filter(op => op.visitAttendance), before.ops.filter(op => op.visitAttendance));
  assert.deepEqual(bundle, before); assert.equal(view(decoded).entries[0].sourceCurrent, false);
});
