import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, revision, project, planStoreMerge, applyStoreMerge, validateBundle, storeInsightsIdentityKey, storeInsightsForStore, insightReviewForEntry, makeVisitAttendance, visitAttendanceForStore, merge } from '../public/core.js';

const profile = (name, feature) => ({ name, address: '虛構路20號', mapUrl: `https://www.google.com/maps/place/test/data=!1s0xaaa:0x${feature}`, city: '虛構市', district: '虛構區', channel: '', contact: '', attr: '', csvIdentityPending: false });
const note = (store, text) => ({ store, text, date: '', source: '虛構測試', next: '', people: [], topics: [], attachments: [] });
const append = (b, type, id, data, extra = {}) => { const old = project(b).find(item => item.type === type && item.id === id); const op = revision(type, id, data, old?.heads.map(head => head.id) || [], 'test', extra.deleted || false, extra.attendance); b.ops.push(op); return op; };
const request = { keeperId: 'keep', donorId: 'donor', name: '虛構合併藥局' };
function fixture() {
  const b = emptyBundle('synthetic-safe-store-merge');
  append(b, 'store', 'keep', profile('虛構甲藥局', 'bbb'));
  append(b, 'store', 'donor', profile('虛構乙藥局', 'ccc'));
  append(b, 'store', 'external', profile('虛構丙藥局', 'ddd'));
  append(b, 'visit', 'k-note', note('keep', '甲原文，保留每個字'));
  append(b, 'visit', 'd-note', note('donor', '乙原文，保留每個字'));
  append(b, 'visit', 'e-note', note('external', '丙原文，保留每個字'));
  return b;
}
const get = (b, type, id) => project(b).find(item => item.type === type && item.id === id);
function card(b, id, owners) {
  return { id, kind: 'relationship', level: 'source', headline: '虛構關係原句', question: '虛構待核對問題', caution: '不推定人物身分', limitations: [], evidence: owners.map(([storeId, visitId]) => ({ storeId, storeIdentityKey: storeInsightsIdentityKey(get(b, 'store', storeId)), visitId, revisionId: get(b, 'visit', visitId).heads[0].id, quote: get(b, 'visit', visitId).text, role: 'support' })) };
}
function addCard(b, storeId, entry, status) {
  const old = get(b, 'store', storeId), data = { ...old.heads[0].data, preVisitInsights: { format: 'pharmacy-store-insights-1', batchId: 'synthetic-analysis', generatedAt: '2026-10-01T00:00:00.000Z', sourceAsOf: '2026-10-01', entries: [entry] } };
  if (status) data.preVisitInsightReviews = [{ id: 'review-' + storeId, status, reviewedBy: 'Kit', reviewedAt: '2026-10-01T01:00:00.000Z', sourceAsOf: '2026-10-01', entry: structuredClone(entry) }];
  append(b, 'store', storeId, data);
}

test('pure deterministic plan and append-only two-ID merge preserve old ops and blobs with different map features', async () => {
  const b = fixture(), before = structuredClone(b);
  const first = await planStoreMerge(b, request), second = await planStoreMerge(b, request);
  assert.deepEqual(first, second); assert.deepEqual(b, before);
  assert.equal(first.summary.movedVisits, 1); assert.equal(first.summary.keeperVisits, 1);
  const { bundle: after } = await applyStoreMerge(b, first, 'mac');
  assert.deepEqual(after.ops.slice(0, b.ops.length), b.ops); assert.deepEqual(after.blobs, b.blobs);
  assert.equal(get(after, 'store', 'keep').name, request.name);
  assert.equal(get(after, 'store', 'donor').deleted, true);
  assert.equal(get(after, 'store', 'donor').mergedInto, 'keep');
  assert.equal(get(after, 'visit', 'd-note').store, 'keep');
  assert.deepEqual(get(after, 'visit', 'd-note').heads[0].data, { ...get(b, 'visit', 'd-note').heads[0].data, store: 'keep' });
  assert.equal(get(after, 'store', 'keep').mapUrl, get(b, 'store', 'keep').mapUrl);
  assert.deepEqual(get(after, 'store', 'keep').csvAliases, ['虛構甲藥局', '虛構乙藥局']);
  assert.equal(after.ops.slice(b.ops.length).some(op => 'visitAttendance' in op), false);
  assert.deepEqual(merge(after, b), merge(b, after));
});

test('plan rejects all stale or tampered changes and leaves inputs exact', async () => {
  const b = fixture(), plan = await planStoreMerge(b, request);
  for (const mutate of [p => p.changes[0].after.name = '竄改', p => p.summary.movedVisits++, p => p.baseFingerprint = 'bad', p => p.name = '未核准名稱', p => p.changes[0].deleted = !p.changes[0].deleted]) {
    const changed = structuredClone(plan); mutate(changed);
    await assert.rejects(applyStoreMerge(b, changed, 'mac'), /改變/);
  }
  const next = structuredClone(b); append(next, 'visit', 'e-note', note('external', '更新外店筆記'));
  await assert.rejects(applyStoreMerge(next, plan, 'mac'), /改變/);
});

test('task histories, completed status and deleted visits remain, attendance keeps original store IDs', async () => {
  const b = fixture(), task = { id: 'task-one', text: '虛構待辦', createdAt: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-02T00:00:00.000Z' };
  append(b, 'store', 'donor', { ...get(b, 'store', 'donor').heads[0].data, nextRememberTasks: [task], everyTimeMust: '每次核對虛構項目' }, { attendance: makeVisitAttendance('donor', '2026-10-02T01:00:00.000Z') });
  append(b, 'visit', 'deleted-note', note('donor', '已回收原文'), { deleted: true });
  const plan = await planStoreMerge(b, request), { bundle: after } = await applyStoreMerge(b, plan, 'mac');
  assert.equal(plan.summary.completedTasks, 1); assert.equal(plan.summary.deletedVisitsPreserved, 1);
  assert.deepEqual(get(after, 'store', 'keep').nextRememberTasks, [task]);
  assert.equal(get(after, 'visit', 'deleted-note').store, 'donor');
  assert.equal(visitAttendanceForStore(after, 'donor').latestDate, '2026-10-02');
  assert.equal(visitAttendanceForStore(after, 'keep').latestDate, '');
});

test('same task IDs with different states, conflicting text/unknown fields, pending identities and conflicts fail closed', async () => {
  for (const mutate of [
    b => { const task = { id: 'task', text: '任務', createdAt: '2026-10-01T00:00:00.000Z', completedAt: '' }; append(b, 'store', 'keep', { ...get(b, 'store', 'keep').heads[0].data, nextRememberTasks: [task] }); append(b, 'store', 'donor', { ...get(b, 'store', 'donor').heads[0].data, nextRememberTasks: [{ ...task, completedAt: '2026-10-02T00:00:00.000Z' }] }); },
    b => { append(b, 'store', 'keep', { ...get(b, 'store', 'keep').heads[0].data, everyTimeMust: '甲' }); append(b, 'store', 'donor', { ...get(b, 'store', 'donor').heads[0].data, everyTimeMust: '乙' }); },
    b => { append(b, 'store', 'keep', { ...get(b, 'store', 'keep').heads[0].data, futureField: { a: 1 } }); append(b, 'store', 'donor', { ...get(b, 'store', 'donor').heads[0].data, futureField: { a: 2 } }); },
    b => append(b, 'store', 'donor', { ...get(b, 'store', 'donor').heads[0].data, csvIdentityPending: true }),
    b => { const original = get(b, 'visit', 'e-note').heads[0]; b.ops.push(revision('visit', 'e-note', note('external', '衝突甲'), [original.id], 'a')); b.ops.push(revision('visit', 'e-note', note('external', '衝突乙'), [original.id], 'b')); }
  ]) { const b = fixture(); mutate(b); const before = structuredClone(b); await assert.rejects(planStoreMerge(b, request)); assert.deepEqual(b, before); }
});

test('exact valid cards on both owners and external stores retain all Kit statuses with provenance, not a new Kit decision', async () => {
  for (const status of ['confirmed', 'pending', 'rejected']) {
    const b = fixture();
    addCard(b, 'keep', card(b, 'keep-card', [['keep', 'k-note'], ['donor', 'd-note']]), status);
    addCard(b, 'donor', card(b, 'donor-card', [['donor', 'd-note']]), status);
    addCard(b, 'external', card(b, 'external-card', [['external', 'e-note'], ['keep', 'k-note']]), status);
    const plan = await planStoreMerge(b, request), { bundle: after } = await applyStoreMerge(b, plan, 'mac');
    assert.deepEqual(plan.summary.externalStores, ['external']); assert.equal(plan.summary.carriedReviews, 3);
    assert.equal(storeInsightsForStore(after, 'keep').entries.length, 2); assert.equal(storeInsightsForStore(after, 'external').entries.length, 1);
    for (const storeId of ['keep', 'external']) for (const entry of storeInsightsForStore(after, storeId).entries) {
      const review = insightReviewForEntry(get(after, 'store', storeId), entry);
      assert.equal(review.status, status); assert.equal(review.reviewedAt, '2026-10-01T01:00:00.000Z'); assert.ok(review.carriedFrom);
    }
    assert.deepEqual(after.ops.slice(0, b.ops.length), b.ops);
    const tampered = structuredClone(after), op = tampered.ops.slice(b.ops.length).find(op => op.data.preVisitInsightReviews?.some(event => event.carriedFrom));
    op.data.preVisitInsightReviews.find(event => event.carriedFrom).status = status === 'confirmed' ? 'rejected' : 'confirmed';
    assert.throws(() => validateBundle(tampered), /沿用審核/);
    const changed = structuredClone(after); append(changed, 'visit', 'k-note', note('keep', '原文已改'));
    assert.equal(storeInsightsForStore(changed, 'external').entries.length, 0);
  }
});

test('stale cards remain stale after merge and duplicate card IDs block rather than picking an approval', async () => {
  const b = fixture(); addCard(b, 'donor', card(b, 'stale-card', [['donor', 'd-note']]), 'rejected');
  append(b, 'visit', 'd-note', note('donor', '乙原文更新'));
  const plan = await planStoreMerge(b, request), { bundle: after } = await applyStoreMerge(b, plan, 'mac');
  assert.equal(plan.summary.staleCards, 1); assert.equal(storeInsightsForStore(after, 'keep').entries.length, 0);
  assert.equal(get(after, 'store', 'donor').preVisitInsightReviews[0].status, 'rejected');
  const c = fixture(); addCard(c, 'keep', card(c, 'same-card', [['keep', 'k-note']]), 'confirmed'); addCard(c, 'donor', card(c, 'same-card', [['donor', 'd-note']]), 'rejected');
  await assert.rejects(planStoreMerge(c, request), /相同分析卡 ID/);
});

test('source snapshots, source bytes and attachment data survive untouched without a synthetic CSV import', async () => {
  const b = fixture(), blob = 'a'.repeat(64), bytes = btoa('synthetic-original-csv-bytes');
  b.blobs[blob] = bytes;
  const source = append(b, 'source', 'original-snapshot', { file: 'synthetic.csv', list: '虛構來源', batch: 'synthetic-batch', blob, rows: 1, headers: ['name'], encoding: 'utf-8', delimiter: ',' });
  const src = { file: 'synthetic.csv', fingerprint: 'b'.repeat(64), batch: 'synthetic-batch', list: '虛構來源', at: '2026-10-01T00:00:00.000Z', blob, sourceSnapshot: source.entity, line: 2, headers: ['name'], cells: ['虛構乙藥局'] };
  append(b, 'store', 'donor', { ...get(b, 'store', 'donor').heads[0].data, csvSources: [src], lists: ['虛構來源'] });
  append(b, 'visit', 'd-note', { ...get(b, 'visit', 'd-note').heads[0].data, attachments: [{ blob, name: 'synthetic.txt', mime: 'text/plain' }], csvSources: [src], csvStream: 'google-csv:donor:original' });
  const plan = await planStoreMerge(b, request), { bundle: after } = await applyStoreMerge(b, plan, 'mac');
  assert.deepEqual(after.blobs, b.blobs); assert.equal(project(after).filter(item => item.type === 'source').length, 1);
  assert.deepEqual(get(after, 'source', 'original-snapshot'), get(b, 'source', 'original-snapshot'));
  assert.deepEqual(get(after, 'store', 'keep').csvSources, [src]);
  assert.deepEqual(get(after, 'visit', 'd-note').attachments, get(b, 'visit', 'd-note').attachments);
  assert.equal(get(after, 'visit', 'd-note').csvStream, 'google-csv:donor:original');
});

test('historical-only completed tasks stay in donor archive without returning as pending work', async () => {
  const b = fixture(), task = { id: 'history-task', text: '已完成歷史', createdAt: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-02T00:00:00.000Z' };
  append(b, 'store', 'donor', { ...get(b, 'store', 'donor').heads[0].data, nextRememberTasks: [task] });
  append(b, 'store', 'donor', { ...get(b, 'store', 'donor').heads[0].data, nextRememberTasks: [] });
  const plan = await planStoreMerge(b, request), { bundle: after } = await applyStoreMerge(b, plan, 'mac');
  assert.equal(plan.summary.donorHistoricalCompletedTasks, 1); assert.equal(plan.summary.tasks, 0);
  assert.deepEqual(get(after, 'store', 'donor').versions.slice(0, -1), get(b, 'store', 'donor').versions);
  assert.deepEqual(get(after, 'store', 'keep').nextRememberTasks, []);
});

test('different-store adjudication, alias/card capacities and unknown donor state are never silently discarded', async () => {
  const b = fixture(); append(b, 'store', 'keep', { ...get(b, 'store', 'keep').heads[0].data, qualityDistinct: [{ store: 'donor', self: 'opaque', other: 'opaque' }] });
  await assert.rejects(planStoreMerge(b, request), /不同門市裁定/);
  const large = fixture(); append(large, 'store', 'donor', { ...get(large, 'store', 'donor').heads[0].data, csvAliases: Array.from({ length: 100 }, (_, i) => '虛構別名' + i) });
  await assert.rejects(planStoreMerge(large, request), /上限/);
  const extra = fixture(); append(extra, 'store', 'donor', { ...get(extra, 'store', 'donor').heads[0].data, futureField: { exact: 'future-value' } });
  const result = await applyStoreMerge(extra, await planStoreMerge(extra, request), 'mac');
  assert.deepEqual(get(result.bundle, 'store', 'keep').futureField, { exact: 'future-value' });
});

test('carried reviews reject forged provenance, rewritten quotes and fabricated Kit review times', async () => {
  const b = fixture(); addCard(b, 'donor', card(b, 'origin-card', [['donor', 'd-note']]), 'rejected');
  const { bundle: after } = await applyStoreMerge(b, await planStoreMerge(b, request), 'mac');
  for (const mutate of [event => event.carriedFrom.eventId = 'missing', event => event.carriedFrom.storeId = 'external', event => event.carriedFrom.sourceRevision = get(b, 'store', 'keep').heads[0].id, event => event.entry.headline = '被篡改結論', event => event.entry.evidence[0].quote = '被篡改原句', event => event.reviewedAt = '2026-10-03T00:00:00.000Z', event => event.carriedFrom.mergeId = 'missing']) {
    const changed = structuredClone(after), event = changed.ops.slice(b.ops.length).find(op => op.entity === 'keep').data.preVisitInsightReviews.find(event => event.carriedFrom);
    mutate(event); assert.throws(() => validateBundle(changed), /沿用審核/);
  }
});

test('canonical fingerprints and plans tolerate operation/property ordering while detecting mutation during async apply', async () => {
  const b = fixture(), plan = await planStoreMerge(b, request), reordered = { blobs: b.blobs, ops: [...b.ops].reverse(), vaultId: b.vaultId, schema: b.schema };
  assert.deepEqual(await planStoreMerge(reordered, request), plan);
  const pending = applyStoreMerge(b, plan, 'mac');
  b.ops.push(revision('visit', 'later', note('keep', '非同步期間新增'), [], 'phone'));
  await assert.rejects(pending, /改變/);
});

test('parallel edits to a merged donor remain conflicts and are not discarded by sync', async () => {
  const b = fixture(), plan = await planStoreMerge(b, request), remote = structuredClone(b);
  append(remote, 'store', 'donor', { ...get(remote, 'store', 'donor').heads[0].data, contact: '另一台新增窗口' });
  const { bundle: after } = await applyStoreMerge(b, plan, 'mac');
  const joined = merge(after, remote);
  assert.equal(get(joined, 'store', 'donor').conflict, true);
  assert.equal(get(joined, 'store', 'donor').heads.length, 2);
});

test('a formerly stale identity cannot revive merely because the merged name happens to match it', async () => {
  const b = fixture();
  append(b, 'store', 'keep', { ...get(b, 'store', 'keep').heads[0].data, name: request.name });
  addCard(b, 'keep', card(b, 'formerly-valid', [['keep', 'k-note']]), 'rejected');
  append(b, 'store', 'keep', { ...get(b, 'store', 'keep').heads[0].data, name: '虛構甲藥局' });
  assert.equal(storeInsightsForStore(b, 'keep').entries.length, 0);
  const { bundle: after } = await applyStoreMerge(b, await planStoreMerge(b, request), 'mac');
  assert.equal(get(after, 'store', 'keep').name, request.name);
  assert.equal(storeInsightsForStore(after, 'keep').entries.length, 0);
  assert.equal(storeInsightsForStore(after, 'keep').staleCount, 1);
});

test('different analysis batches cannot silently inherit the primary store source date', async () => {
  const b = fixture(); addCard(b, 'keep', card(b, 'primary-card', [['keep', 'k-note']]), 'confirmed'); addCard(b, 'donor', card(b, 'secondary-card', [['donor', 'd-note']]), 'pending');
  const donor = get(b, 'store', 'donor'); append(b, 'store', 'donor', { ...donor.heads[0].data, preVisitInsights: { ...donor.preVisitInsights, sourceAsOf: '2026-10-02' } });
  await assert.rejects(planStoreMerge(b, request), /不同批次或資料日期/);
});
