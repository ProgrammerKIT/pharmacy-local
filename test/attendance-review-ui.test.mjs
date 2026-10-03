import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emptyBundle, revision, project, validateBundle, planBackupImport, makeVisitAttendance, attendanceTaipeiDate, diffTextSegments } from '../public/core.js';

// Real handlers with synthetic records and an in-memory persistence boundary.
// No customer vault, server, filesystem backup, or browser storage is opened.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const bundle = emptyBundle('synthetic-attendance-ui');
  const store = revision('store', 'synthetic-store', { name: '虛構門市 <img onerror="bad">', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'synthetic-device');
  const visit = revision('visit', 'synthetic-visit', { store: store.entity, date: '2026-09-01', source: 'synthetic', text: '虛構原文\n<script>literal</script>', next: '', topics: [], people: [], attachments: [] }, [], 'synthetic-device');
  bundle.ops.push(store, visit);
  return { bundle, store, visit };
}
function harness() {
  const f = fixture(), nodes = new Map(), state = { writes: [], toasts: [], now: '2026-10-02T15:59:00.000Z', failWrite: false };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [state.now])); } static now() { return Date.parse(state.now); } }
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { id, open: false, innerHTML: '', textContent: '', value: '', checked: false, disabled: false, dataset: {}, handlers: {},
      classList: { contains: () => false }, addEventListener(type, fn) { this.handlers[type] = fn; },
      replaceChildren() { this.innerHTML = ''; }, close() { this.open = false; }, showModal() { this.open = true; }
    });
    return nodes.get(id);
  };
  const c = vm.createContext({ syncInProgress: false, autoFetching: false, syncEpoch: 0, localSaveState: 'saved', renderDataSafetyEntry() {},
    syncScheduler: { request() {}, wake() {}, pause() {}, reset() {}, confirmed() {}, failed() {} },
     $, esc, Date: Clock, structuredClone, project, revision, validateBundle, planBackupImport, makeVisitAttendance, attendanceTaipeiDate, diffTextSegments,
    payload: { bundle: f.bundle, device: 'synthetic-device', dirty: false, inlineTextDraft: { id: f.visit.entity, text: f.visit.data.text } }, key: {},
    document: { hidden: false }, pendingLock: false, attendancePrompt: null, draftSaveChain: Promise.resolve(), inlineDraftSaveChain: Promise.resolve(), reminderDraftSaveChain: Promise.resolve(),
    quickTextContext: { id: f.visit.entity, parents: [f.visit.id], before: f.visit.data.text, after: f.visit.data.text, step: 'confirm' }, inlineTextContext: { id: f.visit.entity },
    versionReview: null, resolutionPreview: null, backupPreview: null,
    openDialog: node => node.showModal(), dateText: value => value, toast: text => state.toasts.push(text), name: () => f.store.data.name,
    render: () => {}, renderQuickTextDialog: () => {}, quickTextParents: visit => visit.heads.map(head => head.id).sort(),
    by: (type, id) => project(c.payload.bundle).find(record => record.type === type && record.id === id),
    run: async fn => fn(), persist: async next => { if (state.failWrite) throw new Error('synthetic disk full'); state.writes.push(structuredClone(next)); c.payload = next; }
  });
  vm.runInContext(section('function assertSaveParents(', 'let nearbyState ='), c);
  vm.runInContext(section("$('visit-attendance-form').addEventListener", "$('gate-form').addEventListener"), c);
  vm.runInContext(section('async function saveQuickTextEdit(', 'async function commitRevision('), c);
  vm.runInContext(section('function diffSegmentsHTML(', 'function renderQuickTextDialog(') + section('function describeData(', 'async function removeEntity('), c);
  vm.runInContext(section('function backupSummaryHTML(', 'function renderBackupChanges('), c);
  return { ...f, c, $, state, submit() { $('visit-attendance-form').handlers.submit({ preventDefault() {} }); } };
}

test('confirmation is unchecked each time, cancel leaves formal records and draft unchanged', async () => {
  const h = harness(), before = JSON.stringify(h.c.payload);
  h.$('visit-attendance-check').checked = true;
  const pending = h.c.confirmStoreSave(h.store.entity, h.store.data.name); await tick();
  assert.equal(h.$('visit-attendance-check').checked, false);
  assert.equal(h.$('visit-attendance-store').textContent, h.store.data.name);
  assert.equal(h.state.writes.length, 0);
  h.$('visit-attendance-cancel').handlers.click(); assert.equal(await pending, null);
  assert.equal(JSON.stringify(h.c.payload), before);
  assert.equal(h.$('visit-attendance-dialog').open, false);
});

test('confirmation waits for drafts before showing and after consent, without writing formal data', async () => {
  const h = harness(); let release;
  h.c.inlineDraftSaveChain = new Promise(resolve => { release = resolve; });
  const pending = h.c.confirmStoreSave(h.store.entity, h.store.data.name); await tick();
  assert.equal(h.$('visit-attendance-dialog').open, false);
  release(); await tick(); assert.equal(h.$('visit-attendance-dialog').open, true);
  let finishDraft; h.c.draftSaveChain = new Promise(resolve => { finishDraft = resolve; });
  let completed = false; pending.then(() => { completed = true; });
  h.submit(); await tick(); assert.equal(completed, false);
  finishDraft(); const result = await pending;
  assert.equal(result.attendance, undefined); assert.equal(h.state.writes.length, 0);
});

test('attendance confirmation waits for reminder encryption both before opening and after explicit consent', async () => {
  const h = harness(), before = JSON.stringify(h.c.payload); let release;
  h.c.reminderDraftSaveChain = new Promise(resolve => { release = resolve; });
  const pending = h.c.confirmStoreSave(h.store.entity, h.store.data.name); await tick();
  assert.equal(h.$('visit-attendance-dialog').open, false); assert.equal(h.state.writes.length, 0);
  release(); await tick(); assert.equal(h.$('visit-attendance-dialog').open, true);
  let finishReminder; h.c.reminderDraftSaveChain = new Promise(resolve => { finishReminder = resolve; });
  let completed = false; pending.then(() => { completed = true; });
  h.$('visit-attendance-check').checked = true; h.submit(); await tick(); assert.equal(completed, false);
  assert.equal(JSON.stringify(h.c.payload), before);
  finishReminder(); assert.equal((await pending).attendance.store, h.store.entity);
  assert.equal(h.state.writes.length, 0);

  const failed = harness(); failed.c.reminderDraftSaveChain = Promise.reject(new Error('synthetic reminder encryption failure'));
  await assert.rejects(failed.c.confirmStoreSave(failed.store.entity, failed.store.data.name), /reminder encryption failure/);
  assert.equal(failed.$('visit-attendance-dialog').open, false); assert.equal(failed.state.writes.length, 0);
});

test('background or pending lock blocks new confirmation and cancels consent without writes', async () => {
  for (const field of ['hidden', 'pendingLock']) {
    const h = harness(); if (field === 'hidden') h.c.document.hidden = true; else h.c.pendingLock = true;
    await assert.rejects(h.c.confirmStoreSave(h.store.entity, 'synthetic'), /解鎖/);
    assert.equal(h.$('visit-attendance-dialog').open, false);
    if (field === 'hidden') h.c.document.hidden = false; else h.c.pendingLock = false;
    const pending = h.c.confirmStoreSave(h.store.entity, 'synthetic'); await tick();
    h.$('visit-attendance-check').checked = true; h.submit();
    if (field === 'hidden') h.c.document.hidden = true; else h.c.pendingLock = true;
    await assert.rejects(pending, /工作階段已變更/); assert.equal(h.state.writes.length, 0);
  }
});

test('bundle replacement or unlock-session change after consent rejects rather than use stale review', async () => {
  for (const changed of ['bundle', 'key']) {
    const h = harness(), pending = h.c.confirmStoreSave(h.store.entity, 'synthetic'); await tick();
    h.$('visit-attendance-check').checked = true; h.submit();
    if (changed === 'bundle') h.c.payload.bundle = structuredClone(h.c.payload.bundle); else h.c.key = {};
    await assert.rejects(pending, /工作階段已變更/); assert.equal(h.state.writes.length, 0);
  }
});

test('crossing Taipei midnight invalidates the checkbox and requires new explicit confirmation', async () => {
  const h = harness(), pending = h.c.confirmStoreSave(h.store.entity, 'synthetic'); await tick();
  h.$('visit-attendance-check').checked = true; h.state.now = '2026-10-02T16:01:00.000Z'; h.submit();
  assert.equal(h.$('visit-attendance-dialog').open, true); assert.equal(h.$('visit-attendance-check').checked, false);
  assert.match(h.$('visit-attendance-error').textContent, /跨日/); assert.match(h.$('visit-attendance-date').textContent, /2026-10-03/);
  h.$('visit-attendance-check').checked = true; h.submit(); const result = await pending;
  assert.equal(result.attendance.date, '2026-10-03'); assert.equal(result.attendance.at, h.state.now);
  assert.equal(h.state.writes.length, 0);
});

test('late native close from a prior confirmation cannot cancel an immediately reopened prompt', async () => {
  const h = harness(), first = h.c.confirmStoreSave(h.store.entity, 'synthetic'); await tick();
  h.$('visit-attendance-cancel').handlers.click(); assert.equal(await first, null);
  const second = h.c.confirmStoreSave(h.store.entity, 'synthetic'); await tick();
  h.$('visit-attendance-dialog').handlers.close();
  assert.ok(h.c.attendancePrompt); assert.equal(h.$('visit-attendance-dialog').open, true);
  h.submit(); assert.equal((await second).attendance, undefined);
});

test('draft chain failure cannot become consent and leaves the input available for retry', async () => {
  const h = harness(), before = JSON.stringify(h.c.payload);
  h.c.draftSaveChain = Promise.reject(new Error('synthetic draft failure'));
  await assert.rejects(h.c.confirmStoreSave(h.store.entity, 'synthetic'), /draft failure/);
  assert.equal(h.$('visit-attendance-dialog').open, false);
  assert.equal(JSON.stringify(h.c.payload), before); assert.equal(h.state.writes.length, 0);
});

test('unchanged inline text with no checkbox adds no revision; explicit check adds metadata only once', async () => {
  for (const checked of [false, true]) {
    const h = harness(), before = structuredClone(h.bundle), pending = h.c.saveQuickTextEdit({ preventDefault() {} }); await tick();
    assert.equal(h.state.writes.length, 0); h.$('visit-attendance-check').checked = checked; h.submit(); await pending;
    const saved = h.c.payload.bundle;
    assert.equal(saved.ops.length, before.ops.length + Number(checked));
    assert.deepEqual(saved.ops.slice(0, before.ops.length), before.ops);
    assert.equal(h.c.payload.dirty, checked); assert.equal(h.c.payload.inlineTextDraft, null);
    if (checked) {
      assert.deepEqual(saved.ops.at(-1).data, h.visit.data);
      assert.equal(saved.ops.at(-1).visitAttendance.store, h.store.entity);
      assert.equal(saved.ops.at(-1).visitAttendance.at, saved.ops.at(-1).at);
    }
    await h.c.saveQuickTextEdit({ preventDefault() {} });
    assert.equal(h.state.writes.length, 1);
  }
});

test('new head during confirmation is caught even when an in-memory bundle identity is reused', async () => {
  const h = harness(), pending = h.c.saveQuickTextEdit({ preventDefault() {} }); await tick();
  h.c.payload.bundle.ops.push(revision('visit', h.visit.entity, { ...h.visit.data, text: 'synthetic concurrent edit' }, [h.visit.id], 'synthetic-other'));
  h.$('visit-attendance-check').checked = true; h.submit();
  await assert.rejects(pending, /新版本或衝突/); assert.equal(h.state.writes.length, 0); assert.ok(h.c.quickTextContext); assert.ok(h.c.payload.inlineTextDraft);
});

test('failed final save retains draft and confirmed text; retry requires a fresh unchecked prompt', async () => {
  const h = harness(), before = JSON.stringify(h.c.payload); h.c.quickTextContext.after += '\nsynthetic extra'; h.state.failWrite = true;
  const pending = h.c.saveQuickTextEdit({ preventDefault() {} }); await tick();
  h.$('visit-attendance-check').checked = true; h.submit(); await assert.rejects(pending, /disk full/);
  assert.equal(JSON.stringify(h.c.payload), before); assert.ok(h.c.quickTextContext); assert.equal(h.state.writes.length, 0);
  h.state.failWrite = false;
  const retry = h.c.saveQuickTextEdit({ preventDefault() {} }); await tick(); assert.equal(h.$('visit-attendance-check').checked, false);
  h.submit(); await retry;
  assert.equal(h.c.payload.bundle.ops.length, h.bundle.ops.length + 1); assert.equal(h.c.payload.bundle.ops.at(-1).visitAttendance, undefined);
});

test('history and conflict comparisons show explicit metadata with escaped sources and never invent attendance', () => {
  const h = harness(), at = '2026-10-02T01:02:03.000Z';
  const marked = revision('visit', h.visit.entity, h.visit.data, [h.visit.id], 'synthetic-device', false, makeVisitAttendance(h.store.entity, at));
  const ordinary = revision('visit', h.visit.entity, { ...h.visit.data, next: 'synthetic future action' }, [h.visit.id], 'synthetic-other');
  h.c.payload.bundle.ops.push(marked, ordinary); const original = JSON.stringify(h.c.payload.bundle);
  h.c.openReview('visit', h.visit.entity, false); let html = h.$('review-body').innerHTML;
  assert.match(html, /2026-10-02 09:02:03（台北時間）/); assert.match(html, new RegExp(marked.id)); assert.match(html, /不因還原而重複新增/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|<img/);
  h.c.openReview('visit', h.visit.entity, true); html = h.$('review-body').innerHTML;
  assert.match(html, /使用者已確認的實際拜訪/); assert.match(html, /不會複製成新的拜訪/);
  assert.equal(h.c.reviewAttendanceHTML(ordinary), '');
  const hostile = { ...marked, id: '<img src=x>', visitAttendance: { ...marked.visitAttendance, store: '<script>x</script>' } };
  assert.doesNotMatch(h.c.reviewAttendanceHTML(hostile, '<img onerror=bad>'), /<img|<script>/);
  assert.equal(JSON.stringify(h.c.payload.bundle), original); assert.equal(h.state.writes.length, 0);
});

test('adopting an old marked version preserves the source event without copying it to the restore revision', async () => {
  const h = harness();
  const marked = revision('visit', h.visit.entity, h.visit.data, [h.visit.id], 'synthetic-device', false, makeVisitAttendance(h.store.entity, '2026-10-02T01:02:03.000Z'));
  const ordinary = revision('visit', h.visit.entity, { ...h.visit.data, text: 'synthetic later edit' }, [marked.id], 'synthetic-device');
  h.c.payload.bundle.ops.push(marked, ordinary); const original = structuredClone(h.c.payload.bundle.ops);
  h.c.openReview('visit', h.visit.entity, false); await h.c.useVersion(marked.id);
  assert.equal(h.state.writes.length, 0);
  await h.c.confirmResolution();
  const saved = h.c.payload.bundle;
  assert.deepEqual(saved.ops.slice(0, -1), original);
  assert.equal(saved.ops.length, original.length + 1);
  assert.equal(saved.ops.at(-1).visitAttendance, undefined);
  assert.deepEqual(saved.ops.at(-1).data, h.visit.data);
  assert.equal(saved.ops.filter(op => op.visitAttendance).length, 1);
  validateBundle(saved);
});

test('metadata-only backup preview explains attendance impact instead of an empty field diff', async () => {
  const h = harness(), incoming = structuredClone(h.bundle);
  const marked = revision('visit', h.visit.entity, h.visit.data, [h.visit.id], 'synthetic-device', false, makeVisitAttendance(h.store.entity, '2026-10-02T01:02:03.000Z'));
  incoming.ops.push(marked); const plan = await planBackupImport(h.bundle, incoming);
  h.c.backupPreview = { plan, storeNames: new Map([[h.store.entity, h.store.data.name]]) };
  const before = JSON.stringify({ current: h.bundle, incoming, plan });
  const html = h.c.backupChangeHTML(plan.changes[0]), summary = h.c.backupSummaryHTML(plan.summary);
  assert.match(html, /內容欄位沒有變更；仍會加入 1 份既有拜訪確認/); assert.doesNotMatch(html, /0 個欄位不同/);
  assert.match(html, /2026-10-02 09:02:03（台北時間）/); assert.match(html, new RegExp(marked.id));
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|<script>/);
  assert.match(summary, /確認來源 0 → 1 份/); assert.match(summary, /門市拜訪日 0 → 1 組/);
  assert.match(summary, /不把還原或合併當成今天的新拜訪/);
  assert.match(h.c.backupChangeTitle(plan.changes[0]), /加入 1 份既有拜訪確認/);
  assert.equal(JSON.stringify({ current: h.bundle, incoming, plan }), before); assert.equal(h.state.writes.length, 0);
});

test('backup restore reveals historical attendance even when current heads contain no marker', async () => {
  const h = harness(), incoming = structuredClone(h.bundle);
  const marked = revision('visit', h.visit.entity, h.visit.data, [h.visit.id], 'synthetic-device', false, makeVisitAttendance(h.store.entity, '2026-10-02T01:02:03.000Z'));
  const ordinary = revision('visit', h.visit.entity, { ...h.visit.data, text: 'synthetic later correction' }, [marked.id], 'synthetic-device');
  incoming.ops.push(marked, ordinary);
  const plan = await planBackupImport(null, incoming);
  h.c.backupPreview = { plan, storeNames: new Map() };
  const change = plan.changes.find(item => item.type === 'visit');
  assert.equal(change.afterHeads[0].visitAttendance, undefined);
  const html = h.c.backupChangeHTML(change);
  assert.match(html, /本次加入的拜訪確認來源 · 1 份（含歷史版本）/); assert.match(html, new RegExp(marked.id));
  assert.match(html, /2026-10-02 09:02:03（台北時間）/); assert.match(html, /synthetic later correction/);
  const again = await planBackupImport(plan.bundle, incoming);
  assert.equal(again.summary.hasChanges, false);
  assert.match(h.c.backupSummaryHTML(again.summary), /既有的 0 份確認/); assert.match(h.c.backupSummaryHTML(again.summary), /新增 0 組門市／日期/);
  assert.equal(h.state.writes.length, 0);
});

test('same-day backup sources count separately without exaggerating visit days, old reports remain renderable', async () => {
  const h = harness(), incoming = structuredClone(h.bundle);
  for (const [hour, type, original] of [['01', 'visit', h.visit], ['02', 'store', h.store]]) incoming.ops.push(revision(type, original.entity, original.data, [original.id], 'synthetic-device', false, makeVisitAttendance(h.store.entity, `2026-10-02T${hour}:02:03.000Z`)));
  const plan = await planBackupImport(h.bundle, incoming), html = h.c.backupSummaryHTML(plan.summary);
  assert.match(html, /確認來源 0 → 2 份/); assert.match(html, /門市拜訪日 0 → 1 組/);
  const legacy = structuredClone(plan.summary); delete legacy.visitAttendance;
  const legacyHTML = h.c.backupSummaryHTML(legacy);
  assert.doesNotMatch(legacyHTML, /undefined|NaN/); assert.match(legacyHTML, /增加 2 個既有版本/);
});
