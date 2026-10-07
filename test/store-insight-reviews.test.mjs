import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBundle, revision, project, validData, validateBundle, merge, planBackupImport,
  newMeta, derive, seal, unseal, makeVisitAttendance, storeInsightsIdentityKey,
  storeInsightsForStore, planStoreInsights, applyStoreInsights,
  insightReviewForEntry, storeInsightReviewHistory, planInsightReview, applyInsightReview
} from '../public/core.js';

// All stores, people, quotations and sources below are invented test data.
const at = '2026-10-07T02:00:00.000Z';
const data = name => ({ name, city: 'Synthetic city', district: 'Synthetic district', channel: '', attr: 'Synthetic attr', contact: 'Synthetic contact', address: 'Synthetic address', mapUrl: '', nextRemember: 'Synthetic untouched reminder', everyTimeMust: 'Synthetic routine', extraField: { retain: true } });
const note = (store, text) => ({ store, date: '', text, next: 'Synthetic next', source: 'Synthetic source', topics: [], people: [], attachments: [] });
const record = (bundle, type = 'store', id = 'a') => project(bundle).find(item => item.type === type && item.id === id);
const entry = bundle => record(bundle).preVisitInsights.entries[0];
function fixture(vaultId = 'synthetic-review-vault') {
  const bundle = emptyBundle(vaultId);
  bundle.ops.push(revision('store', 'a', data('Synthetic A'), [], 'synthetic', false, makeVisitAttendance('a', at)));
  bundle.ops.push(revision('store', 'b', data('Synthetic B'), [], 'synthetic'));
  bundle.ops.push(revision('visit', 'va', note('a', '  Synthetic person A knew Synthetic person B.\r\nUnchanged note.  '), [], 'synthetic'));
  bundle.ops.push(revision('visit', 'vb', note('b', 'Synthetic relationship counterpart.'), [], 'synthetic'));
  const evidence = [['a', 'va', 'Synthetic person A knew Synthetic person B.'], ['b', 'vb', 'Synthetic relationship counterpart.']].map(([storeId, visitId, quote]) => ({
    storeId, storeIdentityKey: storeInsightsIdentityKey(record(bundle, 'store', storeId)), visitId, revisionId: record(bundle, 'visit', visitId).heads[0].id, quote, role: 'support'
  }));
  const profile = { format: 'pharmacy-store-insights-1', batchId: 'synthetic-batch', generatedAt: at, sourceAsOf: '2026-10-07', entries: [{
    id: 'synthetic-card', kind: 'relationship', level: 'source', headline: 'Synthetic relationship claim', question: 'Synthetic verification question?', caution: 'Synthetic caution.', limitations: ['Synthetic limited evidence.'], evidence
  }] };
  for (const id of ['a', 'b']) append(bundle, 'store', id, { preVisitInsights: structuredClone(profile) });
  return bundle;
}
function append(bundle, type, id, patch = {}, deleted = false) {
  const current = record(bundle, type, id), op = revision(type, id, { ...current.heads[0].data, ...patch }, current.heads.map(head => head.id), 'synthetic-change', deleted);
  bundle.ops.push(op); return op;
}
const plan = (bundle, status, id = 'a') => planInsightReview(bundle, id, 'synthetic-card', status, record(bundle, 'store', id).heads[0].id);
const review = (bundle, status, id = 'a') => applyInsightReview(bundle, plan(bundle, status, id), 'synthetic-Kit-device');
const state = bundle => insightReviewForEntry(record(bundle), entry(bundle));
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

test('every evidence classification defaults to pending with no migration, IDs, times or writes', () => {
  for (const level of ['source', 'inference', 'counter']) {
    const bundle = fixture(), profile = structuredClone(record(bundle).preVisitInsights); profile.entries[0].level = level;
    append(bundle, 'store', 'a', { preVisitInsights: profile });
    const before = structuredClone(bundle); freeze(bundle);
    assert.deepEqual(state(bundle), { status: 'pending', history: [] });
    assert.deepEqual(storeInsightReviewHistory(record(bundle)), []);
    const preview = plan(bundle, 'confirmed'); assert.equal(preview.beforeStatus, 'pending'); assert.equal(preview.changed, true);
    assert.equal(Object.hasOwn(preview, 'reviewedAt'), false); assert.equal(Object.hasOwn(preview, 'reviewedBy'), false);
    assert.deepEqual(bundle, before);
  }
});

test('review appends exactly one store revision and preserves profile, notes, reminders, attendance and all other records', () => {
  const original = fixture(), before = structuredClone(original), preview = plan(original, 'confirmed'); freeze(original); freeze(preview);
  const next = applyInsightReview(original, preview, 'synthetic-Kit-device'), old = record(original), current = record(next);
  assert.deepEqual(original, before); assert.equal(next.ops.length, original.ops.length + 1); assert.deepEqual(next.ops.slice(0, original.ops.length), original.ops);
  const { preVisitInsightReviews, ...remaining } = current.heads[0].data;
  assert.deepEqual(remaining, old.heads[0].data); assert.equal(Object.hasOwn(current.heads[0], 'visitAttendance'), false);
  assert.deepEqual(current.heads[0].parents, [old.heads[0].id]); assert.equal(current.heads[0].at, preVisitInsightReviews[0].reviewedAt);
  assert.deepEqual(preVisitInsightReviews[0].entry, entry(original)); assert.equal(preVisitInsightReviews[0].reviewedBy, 'Kit');
  assert.equal(state(next).status, 'confirmed'); assert.equal(state(next).history.length, 1);
  assert.equal(insightReviewForEntry(record(next, 'store', 'b'), entry(next)).status, 'pending');
  assert.deepEqual(record(next, 'store', 'b'), record(original, 'store', 'b'));
  assert.deepEqual(next.ops.filter(op => op.type !== 'store'), original.ops.filter(op => op.type !== 'store'));
  assert.deepEqual(next.blobs, original.blobs);
});

test('rejection retains the current card and audit trail; pending/confirmed restores require separate explicit reviews', () => {
  const original = fixture(), rejected = review(original, 'rejected'), pending = review(rejected, 'pending'), confirmed = review(pending, 'confirmed');
  assert.equal(state(rejected).status, 'rejected');
  assert.deepEqual(storeInsightsForStore(rejected, 'a'), storeInsightsForStore(original, 'a'));
  assert.equal(state(pending).status, 'pending'); assert.equal(state(confirmed).status, 'confirmed');
  assert.deepEqual(record(confirmed).preVisitInsightReviews.map(event => event.status), ['rejected', 'pending', 'confirmed']);
  assert.deepEqual(record(confirmed).preVisitInsightReviews.slice(0, 2), record(pending).preVisitInsightReviews);
  assert.equal(storeInsightReviewHistory(record(confirmed)).length, 3);
});

test('repeated same-state decisions are no-ops without duplicate review events or versions', () => {
  const original = fixture(); assert.equal(review(original, 'pending'), original);
  for (const status of ['confirmed', 'rejected']) {
    const saved = review(original, status), before = structuredClone(saved);
    assert.equal(plan(saved, status).changed, false); assert.equal(review(saved, status), saved); assert.deepEqual(saved, before);
  }
});

test('canonical matching accepts property order and resolved display fields while keeping every meaningful entry field exact', () => {
  const bundle = review(fixture(), 'confirmed'), current = entry(bundle);
  const reordered = Object.fromEntries(Object.entries(current).reverse());
  reordered.evidence = current.evidence.map(source => Object.fromEntries(Object.entries(source).reverse()));
  assert.equal(insightReviewForEntry(record(bundle), reordered).status, 'confirmed');
  const displayed = storeInsightsForStore(bundle, 'a').entries[0]; assert.ok(displayed.evidence[0].rawText);
  assert.equal(insightReviewForEntry(record(bundle), displayed).status, 'confirmed');
  for (const mutate of [
    next => { next.id += '-new'; }, next => { next.kind = 'customer'; }, next => { next.level = 'inference'; },
    next => { next.headline += ' edited'; }, next => { next.question += ' edited'; }, next => { next.caution += ' edited'; },
    next => { next.limitations.push('Synthetic new limitation.'); }, next => { next.evidence[0].role = 'counter'; },
    next => { next.evidence[0].revisionId += '-new'; }, next => { next.evidence[0].quote += ' changed'; },
    next => { next.evidence[0].storeIdentityKey = storeInsightsIdentityKey({ ...record(bundle), name: 'Synthetic renamed' }); },
    next => { next.evidence.reverse(); }
  ]) {
    const changed = structuredClone(current); mutate(changed);
    assert.deepEqual(insightReviewForEntry(record(bundle), changed), { status: 'pending', history: [] });
  }
});

test('unchanged card re-import preserves decision; changed card or source never inherits confirmation or rejection by id', () => {
  for (const status of ['confirmed', 'rejected']) {
    let bundle = review(fixture(), status);
    const reimport = (profile) => {
      const input = { format: 'pharmacy-store-insights-import-1', vaultId: bundle.vaultId, generatedAt: profile.generatedAt, sourceAsOf: profile.sourceAsOf, stores: [{ storeId: 'a', expectedStoreHead: record(bundle).heads[0].id, insights: profile }] };
      bundle = applyStoreInsights(bundle, input, planStoreInsights(bundle, input), 'synthetic-importer');
    };
    const refreshed = structuredClone(record(bundle).preVisitInsights); refreshed.batchId = 'synthetic-next-batch'; refreshed.generatedAt = '2026-10-08T02:00:00.000Z'; refreshed.sourceAsOf = '2026-10-08';
    reimport(refreshed); assert.equal(state(bundle).status, status); assert.equal(state(bundle).history[0].sourceAsOf, '2026-10-07');
    const changed = structuredClone(refreshed); changed.entries[0].headline += ' materially different';
    reimport(changed); assert.equal(state(bundle).status, 'pending'); assert.equal(storeInsightReviewHistory(record(bundle)).length, 1);
    append(bundle, 'visit', 'va', {});
    const newSource = structuredClone(changed); newSource.entries[0].evidence[0].revisionId = record(bundle, 'visit', 'va').heads[0].id;
    reimport(newSource); assert.equal(state(bundle).status, 'pending');
  }
});

test('history remains after analysis withdrawal and explicit prior-store-version restore without reviving an old status', () => {
  const original = fixture(), bundle = review(review(original, 'rejected'), 'confirmed'), historyBefore = storeInsightReviewHistory(record(bundle));
  const empty = { ...record(bundle).preVisitInsights, entries: [] }; append(bundle, 'store', 'a', { preVisitInsights: empty });
  assert.equal(storeInsightReviewHistory(record(bundle)).length, 2);
  const current = record(bundle); bundle.ops.push(revision('store', 'a', record(original).heads[0].data, [current.heads[0].id], 'synthetic-explicit-restore'));
  assert.equal(state(bundle).status, 'pending'); assert.equal(state(bundle).history.length, 2);
  const history = storeInsightReviewHistory(record(bundle)); assert.ok(history.every(event => event.historical));
  assert.deepEqual(history.map(({ historical, ...event }) => event), historyBefore.map(({ historical, ...event }) => event));
  const rereviewed = review(bundle, 'rejected'); assert.equal(state(rereviewed).status, 'rejected');
  assert.equal(storeInsightReviewHistory(record(rereviewed)).length, 3);
  assert.equal(storeInsightReviewHistory(record(rereviewed)).filter(event => event.historical).length, 2);
});

test('current array order decides status even with clock skew; audit reads clone their results', () => {
  const bundle = review(review(fixture(), 'confirmed'), 'rejected'), current = record(bundle).heads[0];
  current.data.preVisitInsightReviews.at(-1).reviewedAt = '2020-01-01T00:00:00.000Z';
  const before = structuredClone(bundle); validateBundle(bundle);
  assert.equal(state(bundle).status, 'rejected');
  const history = storeInsightReviewHistory(record(bundle)); history[0].entry.headline = 'Synthetic mutated return';
  state(bundle).history[0].entry.evidence[0].quote = 'Synthetic mutated return';
  assert.deepEqual(bundle, before);
});

test('source changes, missing/deleted/unsafe/conflicting sources block new reviews while retained history stays readable', () => {
  const mutations = [
    bundle => append(bundle, 'visit', 'va', {}),
    bundle => append(bundle, 'visit', 'vb', { text: 'Synthetic changed source' }),
    bundle => append(bundle, 'visit', 'vb', {}, true),
    bundle => { bundle.ops = bundle.ops.filter(op => !(op.type === 'visit' && op.entity === 'vb')); },
    bundle => append(bundle, 'store', 'b', { name: 'Synthetic renamed store' }),
    bundle => append(bundle, 'store', 'b', { csvIdentityPending: true }),
    bundle => append(bundle, 'store', 'b', { mergedInto: 'a' }),
    bundle => append(bundle, 'store', 'b', {}, true),
    bundle => { const base = record(bundle, 'visit', 'vb'); for (const device of ['synthetic-1', 'synthetic-2']) bundle.ops.push(revision('visit', 'vb', base.heads[0].data, [base.heads[0].id], device)); }
  ];
  for (const flag of ['sourceMissing', 'googleUpdatePending']) for (const type of ['store', 'visit']) mutations.push(bundle => append(bundle, type, type === 'store' ? 'b' : 'vb', { [flag]: true }));
  for (const change of mutations) for (const status of ['confirmed', 'pending', 'rejected']) {
    const bundle = review(fixture(), 'rejected'); change(bundle); const before = structuredClone(bundle);
    assert.throws(() => plan(bundle, status), /來源/); assert.deepEqual(bundle, before);
    assert.equal(storeInsightReviewHistory(record(bundle)).length, 1);
  }
});

test('concurrent local/source changes and modified review plans fail closed without partial writes', () => {
  for (const mutate of [
    bundle => append(bundle, 'store', 'a', { contact: 'Synthetic concurrent contact' }),
    bundle => append(bundle, 'visit', 'vb', {}),
    bundle => append(bundle, 'store', 'b', { address: 'Synthetic moved address' })
  ]) {
    const bundle = fixture(), preview = plan(bundle, 'confirmed'); mutate(bundle); const before = structuredClone(bundle);
    assert.throws(() => applyInsightReview(bundle, preview, 'synthetic-device')); assert.deepEqual(bundle, before);
  }
  for (const mutate of [
    preview => { preview.entry.headline = 'Synthetic changed preview'; }, preview => { preview.sourceAsOf = '2020-01-01'; },
    preview => { preview.vaultId = 'synthetic-other-vault'; }, preview => { preview.beforeStatus = 'confirmed'; },
    preview => { preview.changed = false; }, preview => { preview.extra = 'Synthetic unexpected field'; }
  ]) {
    const bundle = fixture(), preview = plan(bundle, 'confirmed'), before = structuredClone(bundle); mutate(preview);
    assert.throws(() => applyInsightReview(bundle, preview, 'synthetic-device'), /預覽後/); assert.deepEqual(bundle, before);
  }
  const bundle = fixture();
  for (const status of ['approved', '', null]) assert.throws(() => plan(bundle, status), /選項/);
  assert.throws(() => planInsightReview(bundle, 'a', 'unknown-card', 'confirmed', record(bundle).heads[0].id), /來源/);
  assert.throws(() => applyInsightReview(bundle, plan(bundle, 'confirmed'), ''), /裝置/);
});

test('parallel reviews sync as a store conflict; neither branch silently becomes Kit confirmed', () => {
  const original = fixture(), a = review(original, 'confirmed'), b = review(original, 'rejected'), combined = merge(a, b), current = record(combined);
  assert.equal(current.conflict, true); assert.equal(current.heads.length, 2);
  assert.equal(insightReviewForEntry(current, entry(original)).status, 'pending');
  assert.equal(storeInsightReviewHistory(current).length, 2); assert.equal(combined.ops.length, original.ops.length + 2);
  assert.throws(() => plan(combined, 'confirmed'), /衝突/);
  assert.deepEqual(storeInsightsForStore(combined, 'a'), { entries: [], staleCount: 1 });
});

test('strict review validation rejects malformed, duplicate, oversized and non-store records', () => {
  const bundle = review(fixture(), 'confirmed'), saved = record(bundle).heads[0].data;
  assert.equal(validData('store', saved), true);
  const mutations = [
    value => { value.preVisitInsightReviews = {}; }, value => { value.preVisitInsightReviews = null; },
    value => { value.preVisitInsightReviews[0].extra = true; }, value => { delete value.preVisitInsightReviews[0].sourceAsOf; },
    value => { value.preVisitInsightReviews[0].id = ' '; }, value => { value.preVisitInsightReviews[0].status = 'approved'; },
    value => { value.preVisitInsightReviews[0].reviewedBy = 'AI'; }, value => { value.preVisitInsightReviews[0].reviewedAt = '2026-02-30T00:00:00.000Z'; },
    value => { value.preVisitInsightReviews[0].sourceAsOf = '2026-02-30'; }, value => { value.preVisitInsightReviews[0].entry.headline = ''; },
    value => { value.preVisitInsightReviews[0].entry.evidence[0].rawText = 'Synthetic forbidden display field'; },
    value => { value.preVisitInsightReviews.push(structuredClone(value.preVisitInsightReviews[0])); },
    value => { value.preVisitInsightReviews = Array.from({ length: 1001 }, (_, i) => ({ ...structuredClone(value.preVisitInsightReviews[0]), id: 'synthetic-event-' + i })); }
  ];
  for (const mutate of mutations) { const invalid = structuredClone(saved); mutate(invalid); assert.equal(validData('store', invalid), false); }
  assert.equal(validData('visit', { ...note('a', 'Synthetic note'), preVisitInsightReviews: saved.preVisitInsightReviews }), false);
  assert.deepEqual(insightReviewForEntry({ preVisitInsightReviews: [{ id: 'malformed' }] }, entry(bundle)), { status: 'pending', history: [] });
});

test('review event IDs cannot be reused with different content or copied to a second store', () => {
  for (const mutate of [
    bundle => { const current = record(bundle), copied = structuredClone(current.preVisitInsightReviews); copied[0].status = 'rejected'; append(bundle, 'store', 'a', { preVisitInsightReviews: copied }); },
    bundle => { append(bundle, 'store', 'b', { preVisitInsightReviews: structuredClone(record(bundle).preVisitInsightReviews) }); }
  ]) { const bundle = review(fixture(), 'confirmed'); mutate(bundle); assert.throws(() => validateBundle(bundle), /審核歷史/); }
  const bundle = review(fixture(), 'confirmed'), copied = structuredClone(record(bundle).preVisitInsightReviews);
  copied[0].entry.evidence = copied[0].entry.evidence.filter(source => source.storeId === 'b');
  record(bundle).heads[0].data.preVisitInsightReviews = copied;
  assert.throws(() => validateBundle(bundle), /審核歷史/);
});

test('review history limits reject the next write while preserving every existing event', () => {
  for (const mode of ['count', 'bytes']) {
    const bundle = fixture(), current = record(bundle), template = { id: 'synthetic-review-0', status: 'pending', reviewedBy: 'Kit', reviewedAt: at, sourceAsOf: '2026-10-07', entry: structuredClone(entry(bundle)) };
    const events = [];
    if (mode === 'count') for (let i = 0; i < 1000; i++) events.push({ ...structuredClone(template), id: 'synthetic-event-' + i });
    else {
      template.entry.limitations = Array.from({ length: 20 }, () => 'x'.repeat(1000));
      while (JSON.stringify([...events, { ...template, id: 'synthetic-event-' + events.length }]).length < 2 * 1024 * 1024 - 1000) events.push({ ...structuredClone(template), id: 'synthetic-event-' + events.length });
      // Fill remaining room with a valid exact snapshot, stopping just before the next append exceeds the byte budget.
      const room = 2 * 1024 * 1024 - JSON.stringify(events).length - JSON.stringify(template).length - 300;
      if (room > 0) { const last = { ...structuredClone(template), id: 'synthetic-event-' + events.length }; last.entry.limitations = ['x'.repeat(Math.min(1000, room))]; events.push(last); }
    }
    current.heads[0].data.preVisitInsightReviews = events; validateBundle(bundle);
    if (mode === 'bytes') {
      // Make the current card large enough to cross the remaining byte allowance.
      const profile = structuredClone(current.preVisitInsights); profile.entries[0].limitations = Array.from({ length: 20 }, () => 'y'.repeat(1000));
      append(bundle, 'store', 'a', { preVisitInsights: profile });
    }
    const before = structuredClone(bundle); assert.throws(() => review(bundle, 'confirmed'), /歷史已達上限/); assert.deepEqual(bundle, before);
  }
});

test('encrypted backup, source-only sync and backup preview preserve reviews and add no attendance', async () => {
  const meta = newMeta(), original = fixture(meta.vaultId), bundle = review(original, 'rejected'), key = await derive('synthetic-human-review-test-passphrase', meta);
  const decoded = await unseal(await seal(bundle, key, meta), key); assert.deepEqual(decoded, bundle);
  assert.deepEqual(merge(original, decoded), merge(decoded, original));
  const preview = await planBackupImport(original, decoded);
  assert.equal(preview.summary.addedRevisions, 1); assert.equal(preview.summary.changedExistingEntities, 1);
  assert.equal(preview.summary.visitAttendance.addedMarks, 0); assert.deepEqual(preview.summary.warnings, []);
  assert.equal(state(preview.bundle).status, 'rejected'); assert.equal(storeInsightReviewHistory(record(preview.bundle)).length, 1);
});

test('backup checks source references in retained review snapshots even without a current analysis profile', async () => {
  const original = review(fixture(), 'rejected'), bundle = emptyBundle(original.vaultId);
  const snapshot = { ...data('Synthetic A'), preVisitInsightReviews: structuredClone(record(original).preVisitInsightReviews) };
  bundle.ops.push(revision('store', 'a', snapshot, [], 'synthetic-backup'));
  validateBundle(bundle);
  const preview = await planBackupImport(null, bundle);
  assert.ok(preview.summary.warnings.some(warning => warning.code === 'missing-insight-source-revision' && warning.targetId === 'va'));
  assert.ok(preview.summary.warnings.some(warning => warning.code === 'missing-reference' && warning.targetId === 'b'));
  assert.equal(storeInsightReviewHistory(record(preview.bundle)).length, 1);
});
