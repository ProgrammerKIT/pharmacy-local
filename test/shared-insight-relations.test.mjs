import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../public/core.js';
import { makeUnmappedFixture, mappingInput, auditBundle } from './qa/shared-relation-fixture.mjs';

// Every store, person, note, review, date and source below is fictional.
const originalPromise = makeUnmappedFixture(c);
const fresh = async () => structuredClone(await originalPromise);
const rec = (bundle, type, id) => c.project(bundle).find(row => row.type === type && row.id === id);
const store = (bundle, id) => rec(bundle, 'store', 'qa-shared-' + id);
const card = (bundle, id) => store(bundle, id).preVisitInsights.entries.find(entry => entry.id === 'qa-shared-relation-' + id);
const state = (bundle, id) => c.insightSharedReviewForEntry(bundle, store(bundle, id).id, card(bundle, id));
const review = (bundle, id, status) => c.applyInsightReview(bundle, c.planInsightReview(bundle, store(bundle, id).id, card(bundle, id).id, status, store(bundle, id).heads[0].id), 'synthetic-review-action');
function append(bundle, type, id, patch = {}, deleted = false) {
  const prior = rec(bundle, type, id);
  const next = c.revision(type, id, { ...prior.heads[0].data, ...patch }, prior.heads.map(head => head.id), 'synthetic-change', deleted);
  bundle.ops.push(next); return next;
}
function mapped(bundle) {
  const input = mappingInput(c, bundle);
  return c.applyStoreInsightRelations(bundle, input, c.planStoreInsightRelations(bundle, input), 'synthetic-mapping');
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
function assertNoMutation(before, after) { assert.deepEqual(after, before, 'Read/planning/rejected changes must leave the entire bundle exact'); }
function changeCard(bundle, id, change) {
  const profile = structuredClone(store(bundle, id).preVisitInsights); change(profile.entries.find(entry => entry.id === 'qa-shared-relation-' + id));
  append(bundle, 'store', 'qa-shared-' + id, { preVisitInsights: profile });
}
async function mappedWithLocalEvidence() {
  const bundle = await fresh();
  for (const id of ['a', 'b', 'c']) changeCard(bundle, id, entry => { entry.evidence = entry.evidence.filter(source => source.storeId === 'qa-shared-' + id); });
  return mapped(review(bundle, 'a', 'confirmed'));
}
function changePeerSource(bundle, kind) {
  const prior = rec(bundle, 'visit', 'qa-shared-note-a');
  if (kind === 'conflict') {
    for (const device of ['synthetic-source-one', 'synthetic-source-two']) bundle.ops.push(c.revision('visit', prior.id, prior.heads[0].data, [prior.heads[0].id], device));
  } else if (kind === 'removed') bundle.ops = bundle.ops.filter(op => !(op.type === 'visit' && op.entity === prior.id));
  else if (kind === 'restored-text') {
    append(bundle, 'visit', prior.id, { text: 'Synthetic temporary source edit.' });
    append(bundle, 'visit', prior.id, { text: prior.text });
  } else append(bundle, 'visit', prior.id, kind === 'quote-removed' ? { text: 'Synthetic replacement omits the prior relation quotation.' } : {}, kind === 'deleted');
}

test('relation metadata validates exact shape, relationship kind, own supporting evidence and bounded collections', async () => {
  const base = await fresh(), relation = mappingInput(c, base).relations[0], valid = { ...store(base, 'a').heads[0].data, preVisitInsightRelations: [relation] };
  assert.equal(c.validData('store', valid), true);
  const cases = [
    value => { value.preVisitInsightRelations = null; }, value => { value.preVisitInsightRelations = {}; },
    value => { value.preVisitInsightRelations.push(structuredClone(relation)); },
    value => { value.preVisitInsightRelations = Array.from({ length: 21 }, (_, i) => ({ ...relation, id: 'synthetic-group-' + i })); },
    value => { value.preVisitInsightRelations[0].format = 'unknown'; }, value => { value.preVisitInsightRelations[0].extra = true; },
    value => { value.preVisitInsightRelations[0].id = ' '; }, value => { value.preVisitInsightRelations[0].claim = ' '; },
    value => { value.preVisitInsightRelations[0].claim = 'x'.repeat(1001); },
    value => { value.preVisitInsightRelations[0].members = relation.members.slice(0, 1); },
    value => { value.preVisitInsightRelations[0].members = [relation.members[0], relation.members[0]]; },
    value => { value.preVisitInsightRelations[0].members[0].extra = true; },
    value => { value.preVisitInsightRelations[0].members[0].storeId = ''; },
    value => { value.preVisitInsightRelations[0].members[0].storeIdentityKey = '{}'; },
    value => { value.preVisitInsightRelations[0].members[0].entry.kind = 'customer'; },
    value => { value.preVisitInsightRelations[0].members[0].entry.rawText = 'unapproved snapshot field'; },
    value => { value.preVisitInsightRelations[0].members[0].entry.evidence[0].role = 'counter'; },
    value => { value.preVisitInsightRelations[0].members[0].entry.evidence[0].quote = ''; }
  ];
  for (const change of cases) { const invalid = structuredClone(valid); change(invalid); assert.equal(c.validData('store', invalid), false); }
  assert.equal(c.validData('visit', { ...rec(base, 'visit', 'qa-shared-note-a').heads[0].data, preVisitInsightRelations: [relation] }), false);
});

test('a mapping may only be stored on one of its declared member stores', async () => {
  const bundle = await fresh(), relation = mappingInput(c, bundle).relations[0];
  append(bundle, 'store', 'qa-shared-d', { preVisitInsightRelations: [relation] });
  assert.throws(() => c.validateBundle(bundle), /人物關係對應/);
});

test('relation identity remains immutable across current and historical versions', async () => {
  for (const mutate of [value => { value.claim += ' a different claim'; }, value => { value.members[0].entry.headline += ' changed'; }]) {
    const bundle = mapped(await fresh()), relation = structuredClone(store(bundle, 'a').preVisitInsightRelations[0]);
    append(bundle, 'store', 'qa-shared-a', { preVisitInsightRelations: [] });
    mutate(relation); append(bundle, 'store', 'qa-shared-a', { preVisitInsightRelations: [relation] });
    assert.throws(() => c.validateBundle(bundle), /既有對應不得改寫/);
  }
  const bundle = mapped(await fresh()), input = mappingInput(c, bundle); input.relations[0].claim += ' another claim';
  assert.throws(() => c.planStoreInsightRelations(bundle, input), /既有人物關係識別/);
});

test('mapping planning and exact application add only relation metadata with no fabricated review or attendance', async () => {
  const bundle = await fresh(), before = structuredClone(bundle), input = mappingInput(c, bundle); freeze(bundle); freeze(input);
  const plan = c.planStoreInsightRelations(bundle, input); freeze(plan);
  assert.equal(plan.ready.length, 3); assert.equal(Object.hasOwn(plan, 'reviewedAt'), false);
  const result = c.applyStoreInsightRelations(bundle, input, plan, 'synthetic-device');
  assertNoMutation(before, bundle); assert.deepEqual(result.ops.slice(0, before.ops.length), before.ops);
  for (const op of result.ops.slice(before.ops.length)) {
    assert.equal(op.type, 'store'); assert.equal(Object.hasOwn(op, 'visitAttendance'), false);
    const { preVisitInsightRelations, ...data } = op.data;
    assert.equal(preVisitInsightRelations.length, 1); assert.deepEqual(data, rec(before, 'store', op.entity).heads[0].data);
  }
  const audit = await auditBundle(c, result, before);
  for (const field of ['originalOpsPreserved', 'originalBlobsPreserved', 'visitOpsUnchanged', 'sourceOpsUnchanged', 'attendanceUnchanged', 'originalReviewEventsPreserved', 'currentNonRelationAndReviewStoreDataUnchanged']) assert.equal(audit[field], true, field);
  assert.equal(audit.reviewEventsAfter, audit.reviewEventsBefore);
});

test('mapping reimport is an identity no-op even when declared member order changes', async () => {
  const bundle = mapped(await fresh()), before = structuredClone(bundle), input = mappingInput(c, bundle);
  input.relations[0].members.reverse(); input.expectedHeads.reverse();
  const plan = c.planStoreInsightRelations(bundle, input); assert.equal(plan.ready.length, 0);
  assert.equal(c.applyStoreInsightRelations(bundle, input, plan, 'synthetic-device'), bundle);
  assertNoMutation(before, bundle);
});

test('malformed imports and incomplete or surplus expected heads fail without writes', async () => {
  const cases = [
    input => { input.extra = true; }, input => { input.vaultId = 'foreign-vault'; }, input => { input.generatedAt = '2026-02-30'; },
    input => { input.relations = []; }, input => { input.relations.push(structuredClone(input.relations[0])); },
    input => { input.expectedHeads.pop(); }, input => { input.expectedHeads.push({ storeId: 'qa-shared-d', headId: 'not-a-current-head' }); },
    input => { input.expectedHeads.push(structuredClone(input.expectedHeads[0])); },
    input => { input.expectedHeads[0].extra = true; }, input => { input.expectedHeads[0].headId = 'stale'; },
    input => { input.relations[0].members[0].storeIdentityKey = c.storeInsightsIdentityKey({ name: 'wrong synthetic identity' }); }
  ];
  for (const change of cases) {
    const bundle = await fresh(), before = structuredClone(bundle), input = mappingInput(c, bundle); change(input);
    assert.throws(() => c.planStoreInsightRelations(bundle, input)); assertNoMutation(before, bundle);
  }
});

test('tampered relation previews cannot apply a different definition, owner set or base revision', async () => {
  const cases = [
    plan => { plan.extra = true; }, plan => { plan.vaultId = 'foreign-vault'; }, plan => { plan.ready.pop(); },
    plan => { plan.ready[0].expectedHead = 'stale'; }, plan => { plan.ready[0].after[0].claim += ' changed'; },
    plan => { plan.relations[0].members.pop(); }, plan => { plan.baseHeads.pop(); }
  ];
  for (const change of cases) {
    const bundle = await fresh(), before = structuredClone(bundle), input = mappingInput(c, bundle), plan = c.planStoreInsightRelations(bundle, input); change(plan);
    assert.throws(() => c.applyStoreInsightRelations(bundle, input, plan, 'synthetic-device'), /預覽後/); assertNoMutation(before, bundle);
  }
});

test('peer and source changes after mapping preview reject the entire operation atomically', async () => {
  for (const change of [
    bundle => append(bundle, 'store', 'qa-shared-b', { contact: 'synthetic concurrent edit' }),
    bundle => append(bundle, 'visit', 'qa-shared-note-c', {}),
    bundle => append(bundle, 'visit', 'qa-shared-note-a', { text: rec(bundle, 'visit', 'qa-shared-note-a').text + '\nSynthetic new line.' }),
    bundle => append(bundle, 'store', 'qa-shared-d', { contact: 'unrelated but changed preview basis' })
  ]) {
    const bundle = await fresh(), input = mappingInput(c, bundle), plan = c.planStoreInsightRelations(bundle, input); change(bundle);
    const before = structuredClone(bundle); assert.throws(() => c.applyStoreInsightRelations(bundle, input, plan, 'synthetic-device')); assertNoMutation(before, bundle);
  }
});

test('new mappings require intact historical evidence and still-present current quotes', async () => {
  for (const change of [
    bundle => append(bundle, 'visit', 'qa-shared-note-b', { text: 'Synthetic source removed the quoted sentence.' }),
    bundle => append(bundle, 'visit', 'qa-shared-note-c', {}, true),
    bundle => append(bundle, 'visit', 'qa-shared-note-b', { googleUpdatePending: true }),
    bundle => append(bundle, 'store', 'qa-shared-b', { csvIdentityPending: true })
  ]) {
    const bundle = await fresh(); change(bundle); const before = structuredClone(bundle);
    assert.throws(() => c.planStoreInsightRelations(bundle, mappingInput(c, bundle))); assertNoMutation(before, bundle);
  }
});

test('default local pending inherits one proven current approval without event copies or read-time writes', async () => {
  const bundle = mapped(await fresh()), before = structuredClone(bundle); freeze(bundle);
  for (const id of ['b', 'c']) {
    const result = state(bundle, id);
    assert.equal(result.status, 'confirmed'); assert.equal(result.sharedFrom.storeId, 'qa-shared-a');
    assert.equal(result.sharedFrom.eventId, state(bundle, 'a').history[0].id);
    assert.equal(c.insightReviewForEntry(store(bundle, id), card(bundle, id)).status, 'pending');
    result.relation.members[0].storeName = 'mutated returned display';
  }
  assertNoMutation(before, bundle);
});

test('same ID and customer cards never acquire unrelated shared confirmation', async () => {
  const bundle = mapped(await fresh()), d = store(bundle, 'd'), b = store(bundle, 'b');
  assert.equal(c.insightSharedReviewForEntry(bundle, d.id, d.preVisitInsights.entries[0]).status, 'pending');
  assert.equal(d.preVisitInsights.entries[0].id, card(bundle, 'a').id);
  const customer = b.preVisitInsights.entries.find(entry => entry.kind === 'customer');
  const result = c.insightSharedReviewForEntry(bundle, b.id, customer);
  assert.equal(result.status, 'pending'); assert.equal(result.sharedFrom, undefined);
});

test('editing a card under the same ID invalidates matching rather than inheriting an old approval', async () => {
  for (const change of [entry => { entry.headline += ' changed'; }, entry => { entry.question += ' changed'; }, entry => { entry.evidence.reverse(); }]) {
    const bundle = mapped(await fresh()); changeCard(bundle, 'b', change);
    assert.equal(state(bundle, 'b').status, 'pending'); assert.equal(state(bundle, 'b').sharedFrom, undefined);
    assert.equal(state(bundle, 'c').status, 'pending'); assert.match(state(bundle, 'c').sharedConflict, /卡片內容已改變/);
    assert.equal(state(bundle, 'a').status, 'confirmed');
  }
});

test('missing mappings and removed cards block incomplete-group inheritance without revoking local confirmation', async () => {
  for (const change of [
    bundle => append(bundle, 'store', 'qa-shared-c', { preVisitInsightRelations: [] }),
    bundle => append(bundle, 'store', 'qa-shared-c', { preVisitInsights: { ...store(bundle, 'c').preVisitInsights, entries: [] } })
  ]) {
    const bundle = mapped(await fresh()); change(bundle); c.validateBundle(bundle);
    assert.equal(state(bundle, 'a').status, 'confirmed'); assert.equal(state(bundle, 'b').status, 'pending');
    assert.match(state(bundle, 'b').sharedConflict, /不完整|改變/);
  }
});

test('deleted, merged, identity-pending or conflicted peers fail closed for unreviewed members', async () => {
  const changes = [
    bundle => append(bundle, 'store', 'qa-shared-c', {}, true),
    bundle => append(bundle, 'store', 'qa-shared-c', { mergedInto: 'qa-shared-d' }),
    bundle => append(bundle, 'store', 'qa-shared-c', { csvIdentityPending: true }),
    bundle => append(bundle, 'store', 'qa-shared-c', { sourceMissing: true }),
    bundle => {
      const peer = store(bundle, 'c');
      for (const device of ['synthetic-offline-one', 'synthetic-offline-two']) bundle.ops.push(c.revision('store', peer.id, peer.heads[0].data, [peer.heads[0].id], device));
    }
  ];
  for (const change of changes) {
    const bundle = mapped(await fresh()); change(bundle); c.validateBundle(bundle);
    assert.equal(state(bundle, 'b').status, 'pending'); assert.ok(state(bundle, 'b').sharedConflict);
    assert.equal(state(bundle, 'a').status, 'confirmed');
  }
});

test('a merely historical approval never resurfaces through relation metadata', async () => {
  const bundle = mapped(await fresh()), oldEvent = state(bundle, 'a').history[0];
  append(bundle, 'store', 'qa-shared-a', { preVisitInsightReviews: [] });
  assert.equal(c.storeInsightReviewHistory(store(bundle, 'a')).find(event => event.id === oldEvent.id).historical, true);
  for (const id of ['a', 'b', 'c']) assert.equal(state(bundle, id).status, 'pending');
  assert.equal(c.storeInsightReviewHistory(store(bundle, 'a')).length, 1);
});

test('updated source revisions keep exact shared approval visible with historical source labels and warnings', async () => {
  for (const kind of ['same-text', 'changed-text', 'quote-removed']) {
    const bundle = mapped(await fresh()), originalVisit = rec(bundle, 'visit', 'qa-shared-note-b'), oldText = originalVisit.text;
    append(bundle, 'visit', originalVisit.id, kind === 'same-text' ? {} : { text: kind === 'changed-text' ? oldText + '\nSynthetic update.' : 'Synthetic replacement omits the old quotation.' });
    const before = structuredClone(bundle), displayed = c.storeInsightDisplayForStore(bundle, 'qa-shared-b').entries.find(entry => entry.id === card(bundle, 'b').id);
    assert.equal(displayed.review.status, 'confirmed'); assert.equal(displayed.sourceCurrent, false); assert.match(displayed.sourceNotice, /來源已更新/);
    const source = c.storeInsightEvidenceForEntry(bundle, displayed).find(source => source.visitId === originalVisit.id);
    assert.equal(source.historicalAvailable, true); assert.equal(source.sourceCurrent, false); assert.equal(source.revisionId, originalVisit.heads[0].id); assert.equal(source.rawText, oldText);
    assert.equal(state(bundle, 'b').sharedFrom.storeId, 'qa-shared-a'); assertNoMutation(before, bundle);
  }
});

test('a peer-only source update is visible even when each relation card quotes only its own store', async () => {
  for (const kind of ['same-text', 'quote-removed', 'identity-updated']) {
    let bundle = await fresh();
    for (const id of ['a', 'b', 'c']) changeCard(bundle, id, entry => { entry.evidence = entry.evidence.filter(source => source.storeId === 'qa-shared-' + id); });
    bundle = mapped(review(bundle, 'a', 'confirmed'));
    const donorText = rec(bundle, 'visit', 'qa-shared-note-a').text;
    if (kind === 'identity-updated') append(bundle, 'store', 'qa-shared-a', { address: '虛構新址，原身分仍留歷史' });
    else append(bundle, 'visit', 'qa-shared-note-a', kind === 'same-text' ? {} : { text: 'Synthetic replacement omits the approved donor quotation.' });
    const before = structuredClone(bundle);
    for (const id of ['b', 'c']) {
      const strict = c.storeInsightsForStore(bundle, 'qa-shared-' + id).entries.find(entry => entry.id === card(bundle, id).id);
      assert.ok(strict, 'This member’s own exact source still satisfies the strict checker');
      const displayed = c.storeInsightDisplayForStore(bundle, 'qa-shared-' + id).entries.find(entry => entry.id === card(bundle, id).id);
      assert.equal(displayed.review.status, 'confirmed'); assert.equal(displayed.review.sharedFrom.storeId, 'qa-shared-a');
      assert.equal(displayed.sourceCurrent, false); assert.match(displayed.sourceNotice, /來源已更新/);
      assert.ok(displayed.sourceReasons.some(reason => reason.includes('虛構青禾藥局') && /新版本|身分資料已變更/.test(reason)));
      assert.ok(displayed.review.relationSourceReasons.length > 0);
      assert.ok(displayed.evidence.every(source => source.sourceCurrent), 'Do not falsely label the untouched local original as changed');
    }
    const donorEvidence = c.storeInsightEvidenceForEntry(bundle, card(bundle, 'a'))[0];
    assert.equal(donorEvidence.rawText, donorText); assert.equal(donorEvidence.historicalAvailable, true); assertNoMutation(before, bundle);
  }
});

test('confirmation preview names the common claim and does not promise sharing past an explicit peer disagreement', async () => {
  let bundle = mapped(await fresh()); append(bundle, 'store', 'qa-shared-a', { preVisitInsightReviews: [] });
  bundle = review(bundle, 'b', 'rejected');
  const before = structuredClone(bundle), plan = c.planInsightReview(bundle, 'qa-shared-a', card(bundle, 'a').id, 'confirmed', store(bundle, 'a').heads[0].id);
  assert.equal(plan.relationClaim, mappingInput(c, bundle).relations[0].claim);
  assert.equal(plan.changed, true); assert.equal(plan.relatedStores.length, 0);
  assert.deepEqual(new Set(plan.relatedExcluded.map(item => item.storeId)), new Set(['qa-shared-b', 'qa-shared-c']));
  assert.match(plan.relatedExcluded.find(item => item.storeId === 'qa-shared-c').reason, /不同判定/);
  assertNoMutation(before, bundle);
  const saved = c.applyInsightReview(bundle, plan, 'synthetic-confirmation');
  assert.equal(state(saved, 'a').status, 'confirmed'); assert.equal(state(saved, 'b').status, 'rejected'); assert.equal(state(saved, 'c').status, 'pending');
});

test('explicit local pending overrides inheritance and records one local decision without rewriting donor review', async () => {
  const initial = mapped(await fresh()), bundle = review(initial, 'b', 'pending');
  assert.equal(bundle.ops.length, initial.ops.length + 1); assert.equal(state(bundle, 'b').status, 'pending'); assert.equal(state(bundle, 'b').sharedFrom, undefined);
  assert.equal(state(bundle, 'a').status, 'confirmed'); assert.equal(state(bundle, 'c').status, 'pending'); assert.ok(state(bundle, 'c').sharedConflict);
  assert.deepEqual(store(bundle, 'a'), store(initial, 'a')); assert.deepEqual(store(bundle, 'c'), store(initial, 'c'));
  assert.equal(c.storeInsightReviewHistory(store(bundle, 'b')).filter(event => event.entry.id === card(bundle, 'b').id).length, 1);
  assert.equal(review(bundle, 'b', 'pending'), bundle, 'Repeating the same explicit decision is a no-op');
});

test('a later explicit approval can start sharing again without copying the old donor event', async () => {
  let bundle = mapped(await fresh()); append(bundle, 'store', 'qa-shared-a', { preVisitInsightReviews: [] });
  assert.equal(state(bundle, 'b').status, 'pending');
  const before = structuredClone(bundle); bundle = review(bundle, 'c', 'confirmed');
  assert.equal(bundle.ops.length, before.ops.length + 1);
  assert.equal(state(bundle, 'b').status, 'confirmed'); assert.equal(state(bundle, 'b').sharedFrom.storeId, 'qa-shared-c');
  assert.equal(state(bundle, 'a').status, 'confirmed'); assert.equal(state(bundle, 'a').sharedFrom.storeId, 'qa-shared-c');
  const oldEvent = c.storeInsightReviewHistory(store(bundle, 'a'))[0], newEvent = c.storeInsightReviewHistory(store(bundle, 'c'))[0];
  assert.notEqual(oldEvent.id, newEvent.id); assert.equal(oldEvent.historical, true);
});

test('local rejection is retained in history and excluded by the normal visible-card filter', async () => {
  const initial = mapped(await fresh()), bundle = review(initial, 'b', 'rejected'), target = card(bundle, 'b');
  const all = c.storeInsightDisplayForStore(bundle, 'qa-shared-b').entries;
  assert.equal(all.find(entry => entry.id === target.id).review.status, 'rejected');
  assert.ok(!all.filter(entry => entry.review.status !== 'rejected').some(entry => entry.id === target.id));
  assert.equal(c.storeInsightReviewHistory(store(bundle, 'b')).find(event => event.entry.id === target.id).status, 'rejected');
  assert.equal(state(bundle, 'a').status, 'confirmed'); assert.equal(state(bundle, 'c').status, 'pending');
  assert.deepEqual(bundle.ops.slice(0, initial.ops.length), initial.ops);
});

test('concurrent cross-store opposition keeps both local decisions and warns rather than resolving by time', async () => {
  const initial = mapped(await fresh()); append(initial, 'store', 'qa-shared-a', { preVisitInsightReviews: [] });
  const a = review(initial, 'a', 'confirmed'), b = review(initial, 'b', 'rejected'), joined = c.merge(a, b);
  assert.equal(store(joined, 'a').conflict, false); assert.equal(store(joined, 'b').conflict, false);
  assert.equal(state(joined, 'a').status, 'confirmed'); assert.equal(state(joined, 'b').status, 'rejected'); assert.equal(state(joined, 'c').status, 'pending');
  assert.match(state(joined, 'c').sharedConflict, /人工判定不一致/);
  const old = structuredClone(joined); freeze(joined); c.storeInsightDisplayForStore(joined, 'qa-shared-c'); assertNoMutation(old, joined);
});

test('review preview detects peer changes so a stale confirmation cannot ignore a concurrent opposition', async () => {
  const bundle = mapped(await fresh()), plan = c.planInsightReview(bundle, 'qa-shared-b', card(bundle, 'b').id, 'pending', store(bundle, 'b').heads[0].id);
  const changed = review(bundle, 'c', 'rejected'), before = structuredClone(changed);
  assert.throws(() => c.applyInsightReview(changed, plan, 'synthetic-device'), /預覽後/); assertNoMutation(before, changed);
});

test('review preview binds every group source head once in deterministic order rather than only the local quotation', async () => {
  for (const bundle of [mapped(await fresh()), await mappedWithLocalEvidence()]) {
    const before = structuredClone(bundle), plan = c.planInsightReview(bundle, 'qa-shared-b', card(bundle, 'b').id, 'pending', store(bundle, 'b').heads[0].id);
    assert.deepEqual(plan.relationEvidenceBasis, ['a', 'b', 'c'].map(id => ['qa-shared-note-' + id, [rec(bundle, 'visit', 'qa-shared-note-' + id).heads[0].id]]));
    const reordered = structuredClone(bundle); reordered.ops.reverse();
    assert.deepEqual(c.planInsightReview(reordered, 'qa-shared-b', card(reordered, 'b').id, 'pending', store(reordered, 'b').heads[0].id), plan);
    const tampered = structuredClone(plan); tampered.relationEvidenceBasis.shift();
    assert.throws(() => c.applyInsightReview(bundle, tampered, 'synthetic-device'), /預覽後/);
    assertNoMutation(before, bundle);
  }
});

test('already stale peer evidence blocks new review planning while preserving existing shared approval and original decisions', async () => {
  for (const kind of ['same-text', 'quote-removed', 'restored-text', 'deleted', 'conflict']) {
    const bundle = await mappedWithLocalEvidence(); changePeerSource(bundle, kind);
    const before = structuredClone(bundle), effective = state(bundle, 'b');
    assert.equal(effective.status, 'confirmed'); assert.ok(effective.relationSourceReasons.length);
    assert.ok(c.storeInsightsForStore(bundle, 'qa-shared-b').entries.some(entry => entry.id === card(bundle, 'b').id), 'Local evidence remains exact; only the peer source changed');
    for (const status of ['confirmed', 'pending', 'rejected']) assert.throws(() => c.planInsightReview(bundle, 'qa-shared-b', card(bundle, 'b').id, status, store(bundle, 'b').heads[0].id), /共同關係的原文來源已變更/);
    assert.equal(c.storeInsightDisplayForStore(bundle, 'qa-shared-b').entries.find(entry => entry.id === card(bundle, 'b').id).sourceCurrent, false);
    assertNoMutation(before, bundle);
  }
});

test('a peer source-only update after preview rejects stale review apply including identical text, restored text, deletion and conflicting heads', async () => {
  for (const kind of ['same-text', 'quote-removed', 'restored-text', 'deleted', 'conflict', 'removed']) {
    const bundle = await mappedWithLocalEvidence(), plan = c.planInsightReview(bundle, 'qa-shared-b', card(bundle, 'b').id, 'pending', store(bundle, 'b').heads[0].id);
    const peerStoreHeads = ['a', 'b', 'c'].map(id => store(bundle, id).heads.map(head => head.id));
    changePeerSource(bundle, kind); const before = structuredClone(bundle);
    assert.deepEqual(['a', 'b', 'c'].map(id => store(bundle, id).heads.map(head => head.id)), peerStoreHeads, 'No store head changed to reveal this source race');
    assert.throws(() => c.applyInsightReview(bundle, plan, 'synthetic-device'), /原文來源已變更|預覽後/);
    assertNoMutation(before, bundle);
  }
});

test('missing historical peer evidence still binds current heads so an unavailable group cannot bypass review CAS', async () => {
  const bundle = await mappedWithLocalEvidence(), original = rec(bundle, 'visit', 'qa-shared-note-a').heads[0];
  changePeerSource(bundle, 'removed');
  const plan = c.planInsightReview(bundle, 'qa-shared-b', card(bundle, 'b').id, 'confirmed', store(bundle, 'b').heads[0].id);
  assert.ok(state(bundle, 'b').sharedConflict); assert.equal(state(bundle, 'b').relationSourceReasons, undefined);
  assert.deepEqual(plan.relationEvidenceBasis.find(([id]) => id === original.entity), [original.entity, []]);
  const restored = c.revision('visit', original.entity, original.data, [], 'synthetic-partial-restoration'); bundle.ops.push(restored);
  const refreshed = c.planInsightReview(bundle, 'qa-shared-b', card(bundle, 'b').id, 'confirmed', store(bundle, 'b').heads[0].id);
  assert.ok(state(bundle, 'b').sharedConflict); assert.equal(state(bundle, 'b').relationSourceReasons, undefined);
  assert.deepEqual(refreshed.relationEvidenceBasis.find(([id]) => id === original.entity), [original.entity, [restored.id]]);
  const { relationEvidenceBasis: oldBasis, ...oldPlan } = plan, { relationEvidenceBasis: newBasis, ...newPlan } = refreshed;
  assert.deepEqual(oldPlan, newPlan, 'The independent source-head basis must be what catches this incomplete backup change');
  assert.notDeepEqual(oldBasis, newBasis);
  const before = structuredClone(bundle); assert.throws(() => c.applyInsightReview(bundle, plan, 'synthetic-device'), /預覽後/); assertNoMutation(before, bundle);
});

test('safe store merge refuses current or historical relation mappings instead of corrupting the group', async () => {
  for (const historical of [false, true]) {
    const bundle = mapped(await fresh());
    if (historical) for (const id of ['a', 'b', 'c']) append(bundle, 'store', 'qa-shared-' + id, { preVisitInsightRelations: [] });
    const before = structuredClone(bundle);
    await assert.rejects(c.planStoreMerge(bundle, { keeperId: 'qa-shared-a', donorId: 'qa-shared-d', name: '虛構合併預覽' }), /人物關係對應/);
    assertNoMutation(before, bundle);
  }
});

test('backup preview reports missing relation members, cards and historical quote revisions without repairing them', async () => {
  const complete = mapped(await fresh()), owner = store(complete, 'b'), sparse = c.emptyBundle(complete.vaultId);
  sparse.ops.push(c.revision('store', owner.id, { ...owner.heads[0].data, preVisitInsights: { ...owner.preVisitInsights, entries: [] }, preVisitInsightReviews: [] }, [], 'synthetic-incomplete-backup'));
  c.validateBundle(sparse); const before = structuredClone(sparse), plan = await c.planBackupImport(null, sparse);
  assert.deepEqual(plan.bundle, sparse); assertNoMutation(before, sparse);
  assert.ok(plan.summary.warnings.some(w => w.code === 'missing-reference' && w.targetId === 'qa-shared-a'));
  assert.ok(plan.summary.warnings.some(w => w.code === 'missing-insight-relation-card' && w.targetId === 'qa-shared-b'));
  assert.ok(plan.summary.warnings.some(w => w.code === 'missing-insight-source-revision' && w.targetId === 'qa-shared-note-a'));
});

test('a card cannot be silently reused in a second relation and a changed group requires a new explicit identity', async () => {
  const bundle = mapped(await fresh()), before = structuredClone(bundle), input = mappingInput(c, bundle);
  input.relations[0].id = 'synthetic-other-group';
  assert.throws(() => c.planStoreInsightRelations(bundle, input), /另一份人物關係對應/); assertNoMutation(before, bundle);
  const original = await fresh(), duplicate = mappingInput(c, original), other = structuredClone(duplicate.relations[0]); other.id = 'synthetic-other-group'; duplicate.relations.push(other);
  assert.throws(() => c.planStoreInsightRelations(original, duplicate), /同一張卡不能同時/);
});
