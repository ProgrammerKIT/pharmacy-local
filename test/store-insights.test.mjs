import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBundle, revision, project, validateBundle, validData, merge, planBackupImport,
  newMeta, derive, seal, unseal, makeVisitAttendance, storeInsightsIdentityKey,
  validateStoreInsightsImport, storeInsightsForStore, planStoreInsights, applyStoreInsights, buildStoreInsightsSource
} from '../public/core.js';

// Every name, quote and record below is synthetic; no customer fixtures or files.
const generatedAt = '2026-10-06T02:00:00.000Z', sourceAsOf = '2026-10-06';
const storeData = name => ({ name, city: 'Synthetic city', district: 'Synthetic district', channel: '', attr: 'Synthetic original attribute  ', contact: 'Synthetic original contact', address: 'Synthetic address', mapUrl: '', nextRemember: '  Synthetic reminder\r\nKeep spaces  ', everyTimeMust: 'Synthetic routine', extraPreservedField: { value: 'Synthetic optional data' } });
const visitData = (store, text) => ({ store, date: '', text, next: 'Synthetic next step', source: 'Synthetic manual source', topics: [], people: [], attachments: [] });
function fixture(vaultId = 'synthetic-insights-vault') {
  const bundle = emptyBundle(vaultId);
  bundle.ops.push(revision('store', 'a', storeData('Synthetic A'), [], 'synthetic', false, makeVisitAttendance('a', '2026-10-01T02:00:00.000Z')));
  bundle.ops.push(revision('store', 'b', storeData('Synthetic B'), [], 'synthetic'));
  bundle.ops.push(revision('store', 'c', storeData('Synthetic A'), [], 'synthetic'));
  bundle.ops.push(revision('visit', 'visit-a', visitData('a', '  Synthetic alpha.\r\nSynthetic second line.  '), [], 'synthetic'));
  bundle.ops.push(revision('visit', 'visit-b', visitData('b', 'Synthetic beta counterexample.'), [], 'synthetic'));
  return bundle;
}
const record = (bundle, type, id) => project(bundle).find(item => item.type === type && item.id === id);
function source(bundle, storeId, visitId, quote, role = 'support') {
  return { storeId, storeIdentityKey: storeInsightsIdentityKey(record(bundle, 'store', storeId)), visitId, revisionId: record(bundle, 'visit', visitId).heads[0].id, quote, role };
}
function inputFor(bundle, ids = ['a']) {
  return { format: 'pharmacy-store-insights-import-1', vaultId: bundle.vaultId, generatedAt, sourceAsOf, stores: ids.map(storeId => ({
    storeId, expectedStoreHead: record(bundle, 'store', storeId).heads[0].id,
    insights: { format: 'pharmacy-store-insights-1', batchId: 'synthetic-batch-1', generatedAt, sourceAsOf, entries: [{
      id: 'synthetic-entry-1', kind: 'customer', level: 'inference', headline: 'Synthetic store-specific clue', question: 'Synthetic follow-up question?', caution: 'Synthetic inference only.', limitations: ['Synthetic scope limit.'],
      evidence: [source(bundle, 'a', 'visit-a', 'Synthetic alpha.'), source(bundle, 'b', 'visit-b', 'Synthetic beta counterexample.', 'counter')]
    }] }
  })) };
}
function appliedFixture(ids = ['a']) {
  const bundle = fixture(), input = inputFor(bundle, ids), plan = planStoreInsights(bundle, input);
  return { bundle: applyStoreInsights(bundle, input, plan, 'synthetic-reviewer'), original: bundle, input, plan };
}
function append(bundle, type, id, patch = {}, deleted = false) {
  const current = record(bundle, type, id);
  const op = revision(type, id, { ...current.heads[0].data, ...patch }, current.heads.map(head => head.id), 'synthetic-change', deleted);
  bundle.ops.push(op); return op;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('legacy bundles with no analysis remain valid and show no empty analysis content', () => {
  for (const schema of [1, 2]) {
    const bundle = fixture(); bundle.schema = schema;
    assert.equal(validateBundle(bundle), bundle);
    assert.deepEqual(storeInsightsForStore(bundle, 'a'), { entries: [], staleCount: 0 });
    assert.deepEqual(storeInsightsForStore(bundle, 'absent'), { entries: [], staleCount: 0 });
  }
});
test('identity keys use only fixed identity fields and remain stable when reminders or the analysis field change', () => {
  const bundle = fixture(), store = record(bundle, 'store', 'a'), key = storeInsightsIdentityKey(store);
  assert.equal(storeInsightsIdentityKey({ ...store, contact: 'Other synthetic contact', nextRemember: 'Other synthetic reminder', preVisitInsights: inputFor(bundle).stores[0].insights }), key);
  for (const patch of [{ name: 'Synthetic different name' }, { city: 'Synthetic other city' }, { district: 'Synthetic other district' }, { address: 'Synthetic other address' }, { mapUrl: 'https://example.invalid/' }, { csvIdentityPending: true }, { mergedInto: 'b' }, { mergeDecision: 'synthetic-new-decision' }]) assert.notEqual(storeInsightsIdentityKey({ ...store, ...patch }), key);
});
test('strict import schema rejects unknown/raw text fields, duplicate IDs, invalid dates and overlong content', () => {
  const bundle = fixture();
  const mutations = [
    input => { input.format = 'other'; }, input => { input.extra = true; }, input => { input.vaultId = ''; },
    input => { input.generatedAt = '2026-10-06'; }, input => { input.sourceAsOf = '2026-02-30'; },
    input => { input.stores = []; }, input => { input.stores.push(structuredClone(input.stores[0])); },
    input => { input.stores[0].expectedStoreHead = ' '; }, input => { input.stores[0].extra = true; },
    input => { input.stores[0].insights.generatedAt = '2026-10-05T02:00:00.000Z'; },
    input => { input.stores[0].insights.sourceAsOf = '2026-10-05'; },
    input => { input.stores[0].insights.batchId = ''; }, input => { input.stores[0].insights.extra = true; },
    input => { input.stores[0].insights.entries.push(structuredClone(input.stores[0].insights.entries[0])); },
    input => { input.stores[0].insights.entries[0].kind = 'topic'; }, input => { input.stores[0].insights.entries[0].level = 'certain'; },
    input => { input.stores[0].insights.entries[0].headline = 'a'.repeat(501); }, input => { input.stores[0].insights.entries[0].question = ''; },
    input => { input.stores[0].insights.entries[0].caution = 'a'.repeat(2001); }, input => { input.stores[0].insights.entries[0].limitations = Array(21).fill('Synthetic limitation'); },
    input => { input.stores[0].insights.entries[0].evidence = []; },
    input => { input.stores[0].insights.entries[0].evidence.push(structuredClone(input.stores[0].insights.entries[0].evidence[0])); },
    input => { input.stores[0].insights.entries[0].evidence[0].rawText = 'Synthetic redundant raw text'; },
    input => { input.stores[0].insights.entries[0].evidence[0].revisionId = ' '; },
    input => { input.stores[0].insights.entries[0].evidence[0].quote = 'a'.repeat(2001); },
    input => { input.stores[0].insights.entries[0].evidence[0].role = 'other'; },
    input => { input.stores[0].insights.entries[0].evidence[0].storeIdentityKey = '{}'; },
  ];
  for (const change of mutations) { const input = inputFor(bundle); change(input); assert.throws(() => validateStoreInsightsImport(input), /格式/); }
  assert.equal(validateStoreInsightsImport(inputFor(bundle)).stores.length, 1);
});
test('per-store, evidence and whole-import size limits are enforced', () => {
  const bundle = fixture(), manyEntries = inputFor(bundle), first = manyEntries.stores[0].insights.entries[0];
  manyEntries.stores[0].insights.entries = Array.from({ length: 21 }, (_, i) => ({ ...structuredClone(first), id: 'entry-' + i }));
  assert.throws(() => validateStoreInsightsImport(manyEntries));
  const manyEvidence = inputFor(bundle), evidence = manyEvidence.stores[0].insights.entries[0].evidence[0];
  manyEvidence.stores[0].insights.entries[0].evidence = Array.from({ length: 41 }, (_, i) => ({ ...evidence, visitId: 'visit-' + i }));
  assert.throws(() => validateStoreInsightsImport(manyEvidence));
  const manyStores = inputFor(bundle), item = manyStores.stores[0];
  manyStores.stores = Array.from({ length: 501 }, (_, i) => ({ ...structuredClone(item), storeId: 'store-' + i }));
  assert.throws(() => validateStoreInsightsImport(manyStores));
  const large = inputFor(bundle), entry = large.stores[0].insights.entries[0];
  entry.evidence = Array.from({ length: 40 }, (_, i) => ({ ...evidence, visitId: 'visit-' + i, quote: 'x'.repeat(2000) }));
  large.stores[0].insights.entries = Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(entry), id: 'large-entry-' + i }));
  assert.throws(() => validateStoreInsightsImport(large));
  const total = inputFor(bundle); total.stores[0].insights.entries[0].limitations = Array(20).fill('x'.repeat(1000));
  total.stores = Array.from({ length: 100 }, (_, i) => ({ ...structuredClone(total.stores[0]), storeId: 'large-store-' + i }));
  assert.throws(() => validateStoreInsightsImport(total));
});
test('the optional analysis field is accepted only on stores, with its complete strict schema', () => {
  const bundle = fixture(), analysis = inputFor(bundle).stores[0].insights;
  assert.equal(validData('store', { ...storeData('Synthetic'), preVisitInsights: analysis }), true);
  assert.equal(validData('visit', { ...visitData('a', 'Synthetic'), preVisitInsights: analysis }), false);
  assert.equal(validData('store', { ...storeData('Synthetic'), preVisitInsights: { ...analysis, rawText: 'Synthetic' } }), false);
});
test('plan and apply preserve all original fields and ops, add one store revision per ready store, and never copy attendance', () => {
  const bundle = fixture(), input = inputFor(bundle, ['a', 'b']), beforeBundle = structuredClone(bundle), beforeInput = structuredClone(input);
  freeze(bundle); freeze(input);
  const plan = planStoreInsights(bundle, input);
  assert.equal(plan.ready.length, 2); assert.deepEqual(plan.excluded, []); assert.deepEqual(plan.unchanged, []);
  assert.ok(plan.ready.every(item => item.before === null));
  const next = applyStoreInsights(bundle, input, plan, 'synthetic-reviewer');
  assert.deepEqual(bundle, beforeBundle); assert.deepEqual(input, beforeInput);
  assert.equal(next.ops.length, bundle.ops.length + 2); assert.deepEqual(next.ops.slice(0, bundle.ops.length), bundle.ops); assert.deepEqual(next.blobs, bundle.blobs);
  for (const id of ['a', 'b']) {
    const oldStore = record(bundle, 'store', id), current = record(next, 'store', id), { preVisitInsights, ...remaining } = current.heads[0].data;
    assert.deepEqual(remaining, oldStore.heads[0].data); assert.equal(Object.hasOwn(current.heads[0], 'visitAttendance'), false);
    assert.deepEqual(current.heads[0].parents, [oldStore.heads[0].id]); assert.equal(preVisitInsights.batchId, 'synthetic-batch-1');
    assert.equal(storeInsightsForStore(next, id).entries.length, 1);
  }
  assert.deepEqual(next.ops.filter(op => op.type === 'visit'), bundle.ops.filter(op => op.type === 'visit'));
});
test('selector resolves exact original text, labels and support/counter evidence without mutating the bundle', () => {
  const { bundle } = appliedFixture(), before = structuredClone(bundle); freeze(bundle);
  const result = storeInsightsForStore(bundle, 'a'); assert.equal(result.staleCount, 0); assert.equal(result.entries.length, 1);
  assert.deepEqual(result.entries[0].evidence.map(item => item.role), ['support', 'counter']);
  for (const item of result.entries[0].evidence) {
    assert.equal(item.rawText, record(bundle, 'visit', item.visitId).text); assert.equal(item.storeName, record(bundle, 'store', item.storeId).name);
    assert.equal(item.sourceLabel, record(bundle, 'visit', item.visitId).source);
  }
  assert.deepEqual(bundle, before);
});
test('a same-name store never gets another store analysis and every entry needs direct local evidence', () => {
  const bundle = fixture(), input = inputFor(bundle, ['c']), plan = planStoreInsights(bundle, input);
  assert.equal(plan.ready.length, 0); assert.equal(plan.excluded.length, 1);
  assert.deepEqual(storeInsightsForStore(bundle, 'c'), { entries: [], staleCount: 0 });
  const mismatched = inputFor(bundle); mismatched.stores[0].insights.entries[0].evidence[0].storeId = 'c';
  assert.equal(planStoreInsights(bundle, mismatched).ready.length, 0);
});
test('all related evidence must be current: even a new revision with identical text hides the whole entry', () => {
  for (const patch of [{}, { text: 'Synthetic updated beta.' }, { store: 'c' }]) {
    const { bundle } = appliedFixture(); append(bundle, 'visit', 'visit-b', patch);
    assert.deepEqual(storeInsightsForStore(bundle, 'a'), { entries: [], staleCount: 1 });
  }
  const { bundle } = appliedFixture(); append(bundle, 'visit', 'visit-a', { text: 'Synthetic updated alpha.' });
  assert.deepEqual(storeInsightsForStore(bundle, 'a'), { entries: [], staleCount: 1 });
});
test('missing, deleted or conflicting source visits are never displayed as current evidence', () => {
  for (const change of [
    bundle => { bundle.ops = bundle.ops.filter(op => !(op.type === 'visit' && op.entity === 'visit-b')); },
    bundle => append(bundle, 'visit', 'visit-b', {}, true),
    bundle => { const current = record(bundle, 'visit', 'visit-b'); for (const device of ['other-a', 'other-b']) bundle.ops.push(revision('visit', current.id, current.heads[0].data, current.heads.map(head => head.id), device)); },
  ]) { const { bundle } = appliedFixture(); change(bundle); assert.deepEqual(storeInsightsForStore(bundle, 'a'), { entries: [], staleCount: 1 }); }
});
test('unsafe, changed or conflicting target and related store identities hide stored entries and exclude imports', () => {
  for (const id of ['a', 'b']) for (const patch of [{ csvIdentityPending: true }, { mergedInto: 'c' }, { name: 'Synthetic renamed store' }, { address: 'Synthetic moved address' }]) {
    const { bundle, input } = appliedFixture(); append(bundle, 'store', id, patch);
    assert.deepEqual(storeInsightsForStore(bundle, 'a'), { entries: [], staleCount: 1 });
    assert.equal(planStoreInsights(bundle, input).ready.length, 0);
  }
  for (const change of [
    bundle => append(bundle, 'store', 'b', {}, true),
    bundle => { const current = record(bundle, 'store', 'b'); for (const device of ['other-a', 'other-b']) bundle.ops.push(revision('store', 'b', current.heads[0].data, [current.heads[0].id], device)); },
  ]) { const { bundle } = appliedFixture(); change(bundle); assert.deepEqual(storeInsightsForStore(bundle, 'a'), { entries: [], staleCount: 1 }); }
});
test('quotes must be exact substrings and foreign vaults are rejected before any plan or mutation', () => {
  const bundle = fixture(), input = inputFor(bundle); input.stores[0].insights.entries[0].evidence[0].quote = 'synthetic ALPHA';
  assert.equal(planStoreInsights(bundle, input).excluded.length, 1);
  const foreign = inputFor(bundle); foreign.vaultId = 'another-synthetic-vault';
  assert.throws(() => planStoreInsights(bundle, foreign), /另一個資料庫/);
});
test('re-importing an identical package is a no-op even though its original target head has advanced', () => {
  const { bundle, input } = appliedFixture(), plan = planStoreInsights(bundle, input);
  assert.equal(plan.ready.length, 0); assert.equal(plan.unchanged.length, 1); assert.equal(plan.excluded.length, 0);
  assert.equal(applyStoreInsights(bundle, input, plan, 'synthetic-reviewer'), bundle);
});
test('concurrent store/visit changes, changed packages and altered plans block the entire apply', () => {
  for (const change of [bundle => append(bundle, 'store', 'a', { contact: 'Synthetic concurrent contact' }), bundle => append(bundle, 'visit', 'visit-b', { text: 'Synthetic concurrent text' })]) {
    const bundle = fixture(), input = inputFor(bundle, ['a', 'b']), plan = planStoreInsights(bundle, input); change(bundle);
    const before = structuredClone(bundle);
    assert.throws(() => applyStoreInsights(bundle, input, plan, 'synthetic-reviewer'), /預覽後/); assert.deepEqual(bundle, before);
  }
  const bundle = fixture(), input = inputFor(bundle), plan = planStoreInsights(bundle, input), changedPlan = structuredClone(plan);
  changedPlan.ready[0].after.entries[0].headline = 'Synthetic tampered preview';
  assert.throws(() => applyStoreInsights(bundle, input, changedPlan, 'synthetic-reviewer'), /預覽後/);
  input.stores[0].insights.entries[0].headline = 'Synthetic modified import';
  assert.throws(() => applyStoreInsights(bundle, input, plan, 'synthetic-reviewer'), /預覽後/);
});
test('an import may exclude unsafe stores without changing them, while applying only reviewed ready rows', () => {
  const bundle = fixture(), input = inputFor(bundle, ['a', 'c']), plan = planStoreInsights(bundle, input);
  assert.deepEqual(plan.ready.map(item => item.storeId), ['a']); assert.deepEqual(plan.excluded.map(item => item.storeId), ['c']);
  const next = applyStoreInsights(bundle, input, plan, 'synthetic-reviewer');
  assert.equal(next.ops.length, bundle.ops.length + 1); assert.deepEqual(record(next, 'store', 'c'), record(bundle, 'store', 'c'));
});
test('explicit withdrawal hides the section and retains original analysis, notes and all history', () => {
  const { bundle } = appliedFixture(), input = inputFor(bundle); input.stores[0].insights.batchId = 'synthetic-withdrawal'; input.stores[0].insights.entries = [];
  const before = structuredClone(bundle), next = applyStoreInsights(bundle, input, planStoreInsights(bundle, input), 'synthetic-reviewer');
  assert.deepEqual(storeInsightsForStore(next, 'a'), { entries: [], staleCount: 0 });
  assert.deepEqual(next.ops.slice(0, before.ops.length), before.ops); assert.equal(next.ops.length, before.ops.length + 1);
  assert.equal(record(next, 'store', 'a').versions.some(version => version.data.preVisitInsights?.entries.length === 1), true);
});
test('normal unrelated store fields can change without falsely invalidating visit evidence', () => {
  const { bundle } = appliedFixture(); append(bundle, 'store', 'a', { contact: 'Synthetic new contact', everyTimeMust: 'Synthetic updated routine' });
  assert.equal(storeInsightsForStore(bundle, 'a').entries.length, 1);
});
test('encrypted shared backup, version union and backup preview preserve the optional field and exact original records', async () => {
  const meta = newMeta(), key = await derive('synthetic-insights-only-passphrase', meta), original = fixture(meta.vaultId), input = inputFor(original);
  const bundle = applyStoreInsights(original, input, planStoreInsights(original, input), 'synthetic-reviewer');
  const decoded = await unseal(await seal(bundle, key, meta), key);
  assert.deepEqual(decoded, bundle); assert.deepEqual(merge(original, decoded), merge(decoded, original));
  const plan = await planBackupImport(original, decoded);
  assert.equal(plan.summary.addedRevisions, 1); assert.equal(plan.summary.changedExistingEntities, 1); assert.equal(plan.summary.visitAttendance.addedMarks, 0);
  assert.deepEqual(plan.summary.warnings, []); assert.equal(storeInsightsForStore(plan.bundle, 'a').entries.length, 1);
  assert.deepEqual(bundle.ops.filter(op => op.type !== 'store'), original.ops.filter(op => op.type !== 'store'));
});
test('backup preserves unresolved analysis references as warnings and the selector remains fail-closed', async () => {
  const { bundle } = appliedFixture(); bundle.ops = bundle.ops.filter(op => !(op.type === 'visit' && op.entity === 'visit-b'));
  validateBundle(bundle);
  const plan = await planBackupImport(null, bundle);
  assert.ok(plan.summary.warnings.some(warning => warning.code === 'missing-insight-source-revision' && warning.targetId === 'visit-b'));
  assert.ok(plan.summary.warnings.some(warning => warning.code === 'missing-reference' && warning.targetId === 'visit-b'));
  assert.deepEqual(storeInsightsForStore(plan.bundle, 'a'), { entries: [], staleCount: 1 });
});
test('parallel analysis imports preserve all revisions and become a store conflict, never last-write-wins', () => {
  const original = fixture(), first = inputFor(original), second = structuredClone(first); second.stores[0].insights.entries[0].headline = 'Synthetic competing analysis';
  const a = applyStoreInsights(original, first, planStoreInsights(original, first), 'device-a'), b = applyStoreInsights(original, second, planStoreInsights(original, second), 'device-b');
  const combined = merge(a, b);
  assert.equal(record(combined, 'store', 'a').conflict, true); assert.equal(record(combined, 'store', 'a').heads.length, 2);
  assert.deepEqual(storeInsightsForStore(combined, 'a'), { entries: [], staleCount: 1 });
});
test('duplicate evidence cannot evade validation through property order or contradictory roles', () => {
  for (const role of ['support', 'counter']) {
    const input = inputFor(fixture()), evidence = input.stores[0].insights.entries[0].evidence, first = evidence[0];
    evidence.push({ role, quote: first.quote, revisionId: first.revisionId, visitId: first.visitId, storeIdentityKey: first.storeIdentityKey, storeId: first.storeId });
    assert.throws(() => validateStoreInsightsImport(input), /格式/);
  }
});
test('retracted or pending Google sources hide analyses and exclude even imports referencing their exact current heads', () => {
  for (const flag of ['sourceMissing', 'googleUpdatePending']) for (const type of ['store', 'visit']) for (const suffix of ['a', 'b']) {
    const { bundle } = appliedFixture(), id = type === 'visit' ? 'visit-' + suffix : suffix;
    append(bundle, type, id, { [flag]: true });
    assert.deepEqual(storeInsightsForStore(bundle, 'a'), { entries: [], staleCount: 1 });
    const input = inputFor(bundle), before = structuredClone(bundle), plan = planStoreInsights(bundle, input);
    assert.equal(plan.ready.length, 0); assert.equal(plan.excluded.length, 1);
    assert.equal(applyStoreInsights(bundle, input, plan, 'synthetic-reviewer'), bundle); assert.deepEqual(bundle, before);
  }
  const bundle = fixture(); append(bundle, 'visit', 'visit-a', { sourceMissing: false, googleUpdatePending: false });
  assert.equal(planStoreInsights(bundle, inputFor(bundle)).ready.length, 1);
});
test('current-source export is immutable, exact, allowlisted and excludes history, reminders, CSV and device credentials', () => {
  const bundle = fixture(), blob = 'a'.repeat(64); bundle.blobs[blob] = 'U3ludGhldGlj';
  bundle.token = 'synthetic-device-secret';
  bundle.ops.push(revision('source', 'source-synthetic', { file: 'synthetic.csv', list: 'Synthetic list', blob, batch: 'synthetic-source-batch', rows: 1, headers: ['Synthetic column'], encoding: 'utf-8', delimiter: ',' }, [], 'synthetic'));
  bundle.ops.push(revision('person', 'synthetic-person', { name: 'Synthetic person', role: '', desc: 'Synthetic person description', confirmed: true }, [], 'synthetic'));
  bundle.ops.push(revision('topic', 'synthetic-topic', { name: 'Synthetic topic', desc: 'Synthetic topic description' }, [], 'synthetic'));
  const oldVisitHead = record(bundle, 'visit', 'visit-a').heads[0].id;
  append(bundle, 'visit', 'visit-a', { text: '  Synthetic current exact text.\r\nKeep spacing.  ', date: '2026-10-06', googleText: 'Synthetic different Google original', attachments: [{ blob, name: 'synthetic.txt', mime: 'text/plain' }],
    csvSources: [{ file: 'synthetic.csv', fingerprint: 'b'.repeat(64), batch: 'synthetic-source-batch', list: 'Synthetic list', at: generatedAt, blob, sourceSnapshot: 'source-synthetic', line: 1, headers: ['Synthetic column'], cells: ['Synthetic CSV cell'] }] });
  const before = structuredClone(bundle); freeze(bundle);
  const output = buildStoreInsightsSource(bundle, '2026-10-05T17:00:00.000Z');
  assert.deepEqual(bundle, before); assert.equal(output.format, 'pharmacy-store-insights-source-1'); assert.equal(output.vaultId, bundle.vaultId);
  assert.equal(output.sourceAsOf, '2026-10-06'); assert.equal(output.generatedAt, '2026-10-05T17:00:00.000Z');
  assert.deepEqual(output.coverage, { stores: 3, visits: 2, eligibleStores: 3, eligibleVisits: 2, unlinkedVisits: 0 });
  assert.deepEqual(Object.keys(output).sort(), ['coverage', 'format', 'generatedAt', 'sourceAsOf', 'stores', 'vaultId', 'visits']);
  for (const store of output.stores) {
    assert.deepEqual(Object.keys(store).sort(), ['availableInsights', 'conflict', 'csvIdentityPending', 'deleted', 'eligible', 'googleUpdatePending', 'heads', 'mergedInto', 'name', 'sourceMissing', 'staleInsightCount', 'storeId']);
    assert.deepEqual(store.heads, record(bundle, 'store', store.storeId).heads.map(head => ({ id: head.id, deleted: head.deleted, data: JSON.parse(storeInsightsIdentityKey(head.data)) })));
    assert.equal(store.availableInsights, null); assert.equal(store.staleInsightCount, 0);
  }
  const current = output.visits.find(visit => visit.visitId === 'visit-a');
  assert.deepEqual(Object.keys(current).sort(), ['conflict', 'deleted', 'eligible', 'heads', 'visitId']);
  assert.deepEqual(Object.keys(current.heads[0].data).sort(), ['googleUpdatePending', 'source', 'sourceMissing', 'store', 'text']);
  assert.equal(current.heads.length, 1); assert.notEqual(current.heads[0].id, oldVisitHead);
  assert.equal(current.heads[0].data.text, record(bundle, 'visit', 'visit-a').text);
  const serialized = JSON.stringify(output);
  for (const excluded of [oldVisitHead, 'Synthetic alpha.', 'synthetic-device-secret', 'Synthetic CSV cell', 'Synthetic different Google original', 'Synthetic reminder', 'Synthetic routine', 'Synthetic original contact', 'Synthetic person description', 'Synthetic topic description', 'synthetic.csv', blob]) assert.equal(serialized.includes(excluded), false);
  output.stores[0].heads[0].data.name = 'Mutated export'; current.heads[0].data.text = 'Mutated export';
  assert.deepEqual(bundle, before);
  for (const invalid of ['2026-02-30T00:00:00.000Z', '2026-10-06', '2026-10-06T02:00:00Z', null]) assert.throws(() => buildStoreInsightsSource(bundle, invalid), /時間/);
});
test('source export reports unsafe, conflicting and unlinked current records without guessing a store or exporting superseded versions', () => {
  const bundle = fixture();
  append(bundle, 'store', 'a', { csvIdentityPending: true }); append(bundle, 'store', 'b', { sourceMissing: true }); append(bundle, 'store', 'c', {}, true);
  append(bundle, 'visit', 'visit-a', { googleUpdatePending: true });
  const base = record(bundle, 'visit', 'visit-b');
  for (const device of ['synthetic-x', 'synthetic-y']) bundle.ops.push(revision('visit', 'visit-b', { ...base.heads[0].data, text: 'Synthetic conflicting ' + device }, [base.heads[0].id], device));
  bundle.ops.push(revision('visit', 'unlinked', visitData('', 'Synthetic unlinked note'), [], 'synthetic'));
  const output = buildStoreInsightsSource(bundle, generatedAt);
  assert.deepEqual(output.coverage, { stores: 3, visits: 3, eligibleStores: 0, eligibleVisits: 0, unlinkedVisits: 1 });
  assert.equal(output.stores.find(store => store.storeId === 'a').csvIdentityPending, true);
  assert.equal(output.stores.find(store => store.storeId === 'b').sourceMissing, true);
  assert.equal(output.stores.find(store => store.storeId === 'c').deleted, true);
  assert.equal(output.visits.find(visit => visit.visitId === 'visit-a').heads[0].data.googleUpdatePending, true);
  const conflicting = output.visits.find(visit => visit.visitId === 'visit-b');
  assert.equal(conflicting.conflict, true); assert.equal(conflicting.heads.length, 2); assert.equal(conflicting.heads.some(head => head.id === base.heads[0].id), false);
  assert.equal(output.visits.find(visit => visit.visitId === 'unlinked').heads[0].data.store, '');
});
test('source export includes only still-valid saved entries without resolved raw text duplication', () => {
  const { bundle } = appliedFixture(), before = structuredClone(bundle);
  const first = buildStoreInsightsSource(bundle, generatedAt), store = first.stores.find(item => item.storeId === 'a');
  assert.deepEqual(store.availableInsights, record(bundle, 'store', 'a').preVisitInsights); assert.equal(store.staleInsightCount, 0);
  for (const entry of store.availableInsights.entries) for (const evidence of entry.evidence) assert.equal(Object.hasOwn(evidence, 'rawText'), false);
  store.availableInsights.entries[0].headline = 'Synthetic mutated export'; assert.deepEqual(bundle, before);
  append(bundle, 'visit', 'visit-b', { sourceMissing: true });
  const stale = buildStoreInsightsSource(bundle, generatedAt).stores.find(item => item.storeId === 'a');
  assert.equal(stale.availableInsights, null); assert.equal(stale.staleInsightCount, 1);
});
