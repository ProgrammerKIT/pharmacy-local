import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import {
  emptyBundle, revision, project, validateBundle, newMeta, derive, seal, unseal, b64,
  NEXT_REMINDER_OPTIONS, reminderHasOption, setReminderOption, reminderTaskLines,
  addReminderTasks, convertReminderTasks, completeReminderTask, reminderTaskHistory, makeVisitAttendance, diffTextSegments
} from '../public/core.js';

// Real application functions and encryption, fictional records and memory-only disk.
// This test does not launch browsers, contact services or read a customer vault.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing application extraction boundary: ${start}`);
  return app.slice(a, b);
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const tick = () => new Promise(resolve => setImmediate(resolve));
const created = '2026-10-01T01:00:00.000Z', completed = '2026-10-01T02:00:00.000Z';
const clone = value => structuredClone(value);
function fixture() {
  const bundle = emptyBundle('synthetic-reminder-draft-vault');
  const storeData = name => ({ name, city: '', district: '', channel: '', attr: '', contact: '', nextRemember: '  synthetic legacy\r\nsource remains exact  ', everyTimeMust: 'synthetic every time' });
  let data = addReminderTasks(storeData('Synthetic store A <script>literal</script>'), 'synthetic existing task', created);
  data = completeReminderTask(data, data.nextRememberTasks[0].id, completed);
  const a = revision('store', 'a', data, [], 'synthetic'), b = revision('store', 'b', storeData('Synthetic store B'), [], 'synthetic');
  const bytes = new TextEncoder().encode('name,note\r\nSynthetic,"immutable source"\r\n'), blob = createHash('sha256').update(bytes).digest('hex');
  bundle.blobs[blob] = b64(bytes);
  const source = revision('source', 'source', { file: 'synthetic.csv', list: 'Synthetic', blob, batch: 'synthetic', rows: 1, headers: ['name', 'note'], encoding: 'utf-8', delimiter: ',' }, [], 'synthetic');
  const visit = revision('visit', 'visit', { store: 'a', date: '', source: 'Synthetic', text: 'Exact synthetic visit\r\n <script>literal</script>  ', next: '', topics: [], people: [], attachments: [] }, [], 'synthetic');
  bundle.ops.push(a, b, source, visit); validateBundle(bundle);
  return { bundle, a, b, source, visit };
}
function harness() {
  const f = fixture(), nodes = new Map(), timers = new Map();
  const state = { writes: [], attempts: [], prompts: [], toasts: [], opened: [], choice: {}, allow: true, failWhen: () => false, beforePersist: null, timerId: 0, statuses: 0, renders: 0 };
  let c, group;
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', checked: false, hidden: false, disabled: false, open: false, textContent: '', innerHTML: '', dataset: {}, maxLength: 2000,
      classList: { contains: name => id === 'review' && name === 'visit-brief-dialog' },
      close() { this.open = false; }, querySelector: () => null, querySelectorAll: () => [], closest: selector => selector === 'form' ? $('store-reminder-form') : null,
      dispatchEvent(event) { if (['input', 'change'].includes(event.type)) c.scheduleReminderDraftSave(); return true; }
    });
    return nodes.get(id);
  };
  const customText = $('custom-text'), customToggle = $('custom-toggle'), convert = $('convert');
  customToggle.type = convert.type = 'checkbox';
  const options = NEXT_REMINDER_OPTIONS.map(value => ({ value, checked: false, type: 'checkbox', closest: () => group }));
  group = { dataset: { reminderOptionsFor: 'store-reminder-next', customApplied: '' },
    querySelector: selector => selector === '[data-reminder-custom-input]' ? customText : selector === '[data-reminder-custom-toggle]' ? customToggle : null,
    querySelectorAll: selector => selector === '[data-reminder-option]' ? options : [], closest: () => $('store-reminder-dialog') };
  $('store-reminder-form').querySelector = selector => selector === '[data-reminder-convert]' ? convert : null;
  $('store-reminder-form').querySelectorAll = () => [$('store-reminder-next'), $('store-reminder-every'), customText, customToggle, convert, ...options];
  c = vm.createContext({ $, esc, structuredClone, Date, Event, Set, JSON, CSS: { escape: x => x },
    project, revision, validateBundle, NEXT_REMINDER_OPTIONS, reminderHasOption, setReminderOption, reminderTaskLines, addReminderTasks, convertReminderTasks, reminderTaskHistory,
    payload: { bundle: f.bundle, device: 'synthetic-device', dirty: false, pendingSync: { entities: [], unknown: false }, reminderDrafts: [] },
    reminderContext: null, editorContext: null, singleStoreContext: null, inlineTextContext: null, reminderDraftTimer: null, reminderDraftSaveChain: Promise.resolve(), busy: false, updateHolding: false,
    document: { querySelector: selector => selector.includes('data-reminder-options-for') ? group : null },
    setTimeout: fn => { const id = ++state.timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    dateText: value => value, toast: value => state.toasts.push(value), status: () => state.statuses++, render: () => state.renders++,
    openDialog: node => { node.open = true; state.opened.push(node.id); }, openVisitBrief: (id, options) => { state.reopened = { id, options }; },
    confirm: value => { state.prompts.push(value); return state.allow; }, confirmStoreSave: async (...args) => { state.confirmArgs = args; return state.choice; },
    by: (type, id) => project(c.payload.bundle).find(record => record.type === type && record.id === id), quickTextParents: record => record.heads.map(head => head.id).sort(),
    run: async fn => fn(), persist: async next => {
      state.attempts.push(clone(next)); if (state.beforePersist) await state.beforePersist(next);
      if (state.failWhen(next)) throw new Error('synthetic disk full');
      next = c.withPendingSync(c.payload, next); state.writes.push(clone(next)); c.payload = next;
    }
  });
  vm.runInContext(section('function reminderOptionsHTML(', 'async function changeReminderTask('), c);
  vm.runInContext(section('function assertSaveParents(', 'function finishAttendancePrompt('), c);
  vm.runInContext(section('function withPendingSync(', 'function pendingSyncSummary('), c);
  vm.runInContext(section('// Reminder drafts live only', 'function beginInlineTextEdit('), c);
  return { ...f, c, $, state, nodes, group, options, customText, customToggle, convert,
    input(next, every) { if (next !== undefined) $('store-reminder-next').value = next; if (every !== undefined) $('store-reminder-every').value = every; c.scheduleReminderDraftSave(); },
    fireTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); }, timers,
    save: () => c.saveStoreReminder({ preventDefault() {} }) };
}
function assertFormalUnchanged(h, before) {
  assert.deepEqual(h.c.payload.bundle, before);
  assert.equal(h.state.writes.some(value => JSON.stringify(value.bundle) !== JSON.stringify(before)), false);
}

test('opening and closing a pristine reminder form creates neither a draft nor a formal write', async () => {
  const h = harness(), before = clone(h.c.payload);
  h.c.openStoreReminder('a'); assert.equal(h.c.reminderContext.draftTouched, false); assert.equal(h.$('store-reminder-dialog').open, true);
  await h.c.closeStoreReminder(); assert.equal(h.c.reminderContext, null); assert.equal(h.$('store-reminder-dialog').open, false);
  assert.equal(h.state.writes.length, 0); assert.deepEqual(h.c.payload, before); assert.equal(h.c.captureReminderDraft(), null);
});

test('free text and every-time fields are captured exactly in a device draft without formal or sync mutations', async () => {
  const h = harness(), before = clone(h.bundle); h.c.openStoreReminder('a');
  h.input('  synthetic new task\r\n第二行 <img src=x>  ', '  fixed text\n保持  ');
  const captured = h.c.captureReminderDraft(); assert.equal(captured.fields.next, h.$('store-reminder-next').value); assert.equal(captured.fields.every, h.$('store-reminder-every').value);
  assert.equal(captured.baseLegacy, h.a.data.nextRemember); assert.equal(captured.baseEvery, h.a.data.everyTimeMust);
  assert.deepEqual([...captured.parents], [h.a.id]); captured.parents.push('caller-only'); assert.deepEqual([...h.c.reminderContext.parents], [h.a.id]);
  await h.c.flushReminderDraft(); assert.equal(h.state.writes.length, 1); assert.equal(h.c.payload.reminderDrafts[0].fields.next, h.$('store-reminder-next').value);
  assert.equal(h.c.reminderContext.draftTouched, false); assert.equal(h.$('store-reminder-draft-state').dataset.state, 'saved');
  assert.equal(h.c.payload.dirty, false); assert.deepEqual(clone(h.c.payload.pendingSync), { entities: [], unknown: false }); assertFormalUnchanged(h, before);
  assert.match(h.$('reminder-draft-list').innerHTML, /&lt;script&gt;/); assert.doesNotMatch(h.$('reminder-draft-list').innerHTML, /<script>/);
});

test('same-store reopen restores all fields and separate stores keep independent drafts', async () => {
  const h = harness(), before = clone(h.bundle); h.c.openStoreReminder('a'); h.input('store A unfinished', 'A fixed'); await h.c.closeStoreReminder();
  h.c.openStoreReminder('b'); assert.equal(h.$('store-reminder-next').value, ''); h.input('store B unfinished', 'B fixed'); await h.c.closeStoreReminder();
  assert.equal(h.c.payload.reminderDrafts.length, 2);
  h.c.openStoreReminder('a'); assert.equal(h.$('store-reminder-next').value, 'store A unfinished'); assert.equal(h.$('store-reminder-every').value, 'A fixed');
  const ctx = h.c.reminderContext; h.c.openStoreReminder('b'); assert.equal(h.c.reminderContext, ctx); assert.match(h.state.toasts.at(-1), /稍後繼續/);
  await h.c.closeStoreReminder(); h.c.openStoreReminder('b'); assert.equal(h.$('store-reminder-next').value, 'store B unfinished');
  assertFormalUnchanged(h, before);
});

test('full store editor reminder fields flush on close and restore in the reminder popup without saving other profile edits', async () => {
  const h = harness(), before = clone(h.bundle), editor = { type: 'store', id: 'a', parents: [h.a.id], oldData: clone(h.a.data) };
  editor.reminderDraftContext = { editor, id: 'a', storeName: h.a.data.name, parents: [h.a.id], baseEvery: h.a.data.everyTimeMust, baseLegacy: h.a.data.nextRemember, draftTouched: false, draftGeneration: 0 };
  h.c.editorContext = editor; h.$('editor').open = true;
  const custom = { value: 'full editor custom draft' }, checked = { checked: true }, conversion = { checked: true };
  const editorGroup = { dataset: { reminderOptionsFor: 'f-next-remember', customApplied: 'full editor custom draft' }, querySelector: selector => selector === '[data-reminder-custom-input]' ? custom : checked };
  const query = h.c.document.querySelector;
  h.c.document.querySelector = selector => selector.includes('"f-next-remember"') ? editorGroup : query(selector);
  h.$('editor-form').querySelector = () => conversion;
  h.$('f-next-remember').value = 'full editor unfinished\nfull editor custom draft'; h.$('f-every-time-must').value = 'full editor every time'; h.$('f-contact').value = 'UNSAVED_PROFILE_SENTINEL';
  h.c.scheduleReminderDraftSave(); const captured = h.c.captureReminderDraft();
  assert.equal(captured.fields.next, h.$('f-next-remember').value); assert.equal(captured.fields.every, h.$('f-every-time-must').value); assert.equal(captured.fields.convert, true);
  await h.c.closeStoreReminderEditor(); assert.equal(h.c.editorContext, null); assert.equal(h.$('editor').open, false);
  assert.equal(h.c.payload.reminderDrafts.length, 1); assert.doesNotMatch(JSON.stringify(h.c.payload.reminderDrafts), /UNSAVED_PROFILE_SENTINEL/); assertFormalUnchanged(h, before);
  h.c.openStoreReminder('a'); assert.deepEqual(clone(h.c.captureReminderDraft().fields), clone(captured.fields)); assert.equal(h.c.payload.bundle.ops.find(op => op.id === h.a.id).data.contact, '');
});

test('fixed options, unfinished custom input and legacy conversion choice survive close and reopen', async () => {
  const h = harness(); h.c.openStoreReminder('a');
  h.options[0].checked = true; h.c.changeReminderOption(h.options[0]);
  h.customText.value = '  custom draft  '; h.c.changeCustomReminderOption(h.group, true);
  h.customText.value = 'typing next custom text'; h.convert.checked = true; h.c.scheduleReminderDraftSave();
  const before = h.c.captureReminderDraft(); await h.c.closeStoreReminder();
  h.convert.checked = false; h.c.openStoreReminder('a');
  assert.equal(h.options[0].checked, true); assert.equal(h.customText.value, 'typing next custom text'); assert.equal(h.customToggle.checked, true); assert.equal(h.group.dataset.customApplied, 'custom draft'); assert.equal(h.convert.checked, true);
  assert.deepEqual(clone(h.c.captureReminderDraft().fields), clone(before.fields));
  h.c.changeCustomReminderOption(h.group, false); assert.equal(h.$('store-reminder-next').value, 'HAUD'); assert.equal(h.c.payload.bundle.ops.length, h.bundle.ops.length);
});

test('debouncing coalesces rapid input and immediate close flushes the latest text without waiting for a timer', async () => {
  const h = harness(); h.c.openStoreReminder('a'); h.input('one'); h.input('two'); h.input('latest');
  assert.equal(h.timers.size, 1); assert.equal(h.state.writes.length, 0);
  await h.c.closeStoreReminder(); assert.equal(h.timers.size, 0); assert.equal(h.state.writes.length, 1); assert.equal(h.c.payload.reminderDrafts[0].fields.next, 'latest');
  h.fireTimers(); await tick(); assert.equal(h.state.writes.length, 1);
});

test('typing during an in-flight draft write remains dirty until flush saves the newer generation', async () => {
  const h = harness(); let release, entered;
  const arrived = new Promise(resolve => entered = resolve), held = new Promise(resolve => release = resolve);
  h.state.beforePersist = async () => { entered(); await held; };
  h.c.openStoreReminder('a'); h.input('first'); h.fireTimers(); await arrived;
  h.input('latest while encrypting'); const close = h.c.closeStoreReminder();
  assert.equal(h.c.reminderContext.draftTouched, true); assert.equal(h.$('store-reminder-dialog').open, true);
  release(); await close;
  assert.equal(h.state.writes.length, 2); assert.equal(h.state.writes[0].reminderDrafts[0].fields.next, 'first'); assert.equal(h.c.payload.reminderDrafts[0].fields.next, 'latest while encrypting'); assert.equal(h.c.reminderContext, null);
});

test('draft persistence failure keeps the visible fields and context, and close retries the same draft', async () => {
  const h = harness(), before = clone(h.c.payload); h.state.failWhen = () => true;
  h.c.openStoreReminder('a'); h.input('retry exact text');
  await assert.rejects(h.c.closeStoreReminder(), /disk full/);
  assert.equal(h.$('store-reminder-dialog').open, true); assert.equal(h.c.reminderContext.draftTouched, true); assert.equal(h.$('store-reminder-next').value, 'retry exact text'); assert.deepEqual(h.c.payload, before);
  assert.equal(h.$('store-reminder-draft-state').dataset.state, 'error');
  h.state.failWhen = () => false; await h.c.closeStoreReminder(); assert.equal(h.c.payload.reminderDrafts[0].fields.next, 'retry exact text'); assert.equal(h.state.writes.length, 1);
});

test('busy or update holds do not schedule new work, and a stale form cannot write through the draft queue', async () => {
  const h = harness(); h.c.openStoreReminder('a');
  for (const key of ['busy', 'updateHolding']) { h.c[key] = true; h.input('blocked'); assert.equal(h.timers.size, 0); assert.equal(h.c.reminderContext.draftTouched, false); h.c[key] = false; }
  h.input('A'); const old = h.c.reminderContext; h.c.reminderContext = { ...old, id: 'b' };
  await h.c.persistReminderDraftNow(old); assert.equal(h.state.writes.length, 0);
});

test('cancelled content or attendance confirmation leaves an encrypted draft and creates no formal version', async () => {
  for (const stage of ['content', 'attendance']) {
    const h = harness(), before = clone(h.bundle); h.c.openStoreReminder('a'); h.input('synthetic pending confirmation');
    if (stage === 'content') h.state.allow = false; else h.state.choice = null;
    await h.save(); assert.equal(h.c.payload.reminderDrafts[0].fields.next, 'synthetic pending confirmation'); assert.equal(h.$('store-reminder-dialog').open, true); assert.ok(h.c.reminderContext);
    assertFormalUnchanged(h, before); assert.equal(h.c.payload.dirty, false);
  }
});

test('confirmed save adds one store revision and removes only its draft in the same encrypted write', async () => {
  const h = harness(), before = clone(h.bundle); h.c.openStoreReminder('b'); h.input('B keep draft'); await h.c.closeStoreReminder();
  h.c.openStoreReminder('a'); h.input('A new task', 'new every time'); h.convert.checked = true; h.c.scheduleReminderDraftSave(); await h.c.flushReminderDraft();
  const savedBefore = h.state.writes.length; await h.save(); assert.equal(h.state.writes.length, savedBefore + 1);
  const committed = h.state.writes.at(-1); assert.equal(committed.bundle.ops.length, before.ops.length + 1); assert.deepEqual(committed.reminderDrafts.map(d => d.storeId), ['b']);
  for (const op of before.ops) assert.deepEqual(committed.bundle.ops.find(o => o.id === op.id), op);
  assert.deepEqual(committed.bundle.blobs, before.blobs);
  const store = project(committed.bundle).find(r => r.id === 'a'); assert.equal(store.everyTimeMust, 'new every time'); assert.equal(store.nextRememberImports[0].text, h.a.data.nextRemember);
  assert.deepEqual(store.nextRememberTasks[0], h.a.data.nextRememberTasks[0]); assert.equal(store.nextRememberTasks.at(-1).text, 'A new task');
  assert.equal(committed.bundle.ops.at(-1).visitAttendance, undefined); assert.deepEqual(clone(committed.pendingSync.entities), ['store:a']); assert.equal(h.c.reminderContext, null); assert.equal(h.$('store-reminder-dialog').open, false);
});

test('explicit attendance is atomic with reminder save, while unchecked saves never manufacture a visit date', async () => {
  const h = harness(); h.c.openStoreReminder('a'); h.input('new task'); h.state.choice = { attendance: makeVisitAttendance('a', created) };
  await h.save(); const op = h.c.payload.bundle.ops.at(-1);
  assert.equal(op.type, 'store'); assert.equal(op.visitAttendance.at, created); assert.equal(h.c.payload.reminderDrafts.length, 0);
  assert.deepEqual(h.c.payload.bundle.ops.find(o => o.id === h.visit.id), h.visit); assert.equal(h.c.payload.bundle.ops.filter(o => o.type === 'visit').length, 1);
  assert.equal(h.state.writes.filter(p => p.bundle.ops.length > h.bundle.ops.length).length, 1);
});

test('failed formal save retains the encrypted draft and all original data for an exact retry', async () => {
  const h = harness(); h.c.openStoreReminder('a'); h.input('formal retry task'); await h.c.flushReminderDraft(); const before = clone(h.c.payload);
  h.state.failWhen = next => next.bundle.ops.length > before.bundle.ops.length;
  await assert.rejects(h.save(), /disk full/); assert.deepEqual(clone(h.c.payload), before); assert.ok(h.c.reminderContext); assert.equal(h.$('store-reminder-next').value, 'formal retry task');
  h.state.failWhen = () => false; await h.save(); assert.equal(h.c.payload.bundle.ops.length, before.bundle.ops.length + 1); assert.equal(h.c.payload.reminderDrafts.length, 0);
});

test('stale, deleted, conflicted and missing stores keep saved drafts readable but block formal saves', async () => {
  for (const kind of ['stale', 'deleted', 'conflict', 'missing']) {
    const h = harness(); h.c.openStoreReminder('a'); h.input('protected draft'); await h.c.closeStoreReminder();
    if (kind === 'missing') h.c.payload.bundle.ops = h.c.payload.bundle.ops.filter(op => op.entity !== 'a');
    else {
      h.c.payload.bundle.ops.push(revision('store', 'a', { ...h.a.data, contact: 'changed' }, [h.a.id], 'other', kind === 'deleted'));
      if (kind === 'conflict') h.c.payload.bundle.ops.push(revision('store', 'a', { ...h.a.data, contact: 'competing' }, [h.a.id], 'another'));
    }
    const before = clone(h.c.payload); h.c.openStoreReminder('a'); assert.equal(h.$('store-reminder-next').value, 'protected draft'); assert.equal(h.$('store-reminder-save').disabled, true);
    await assert.rejects(h.save(), /保留供查看/); assert.deepEqual(clone(h.c.payload), before); assert.ok(h.c.reminderContext); assert.equal(h.$('store-reminder-dialog').open, true);
  }
});

test('a new store head while the last confirmation is open rejects the formal commit', async () => {
  const h = harness(), originalCount = h.bundle.ops.length; h.c.openStoreReminder('a'); h.input('protected during confirmation');
  h.c.confirmStoreSave = async () => { h.c.payload.bundle.ops.push(revision('store', 'a', { ...h.a.data, contact: 'concurrent' }, [h.a.id], 'other')); return {}; };
  await assert.rejects(h.save(), /新版本或衝突/); assert.equal(h.c.payload.bundle.ops.length, originalCount + 1); assert.equal(h.c.payload.bundle.ops.at(-1).data.contact, 'concurrent'); assert.equal(h.c.payload.reminderDrafts.length, 1);
  assert.equal(h.state.writes.filter(p => p.bundle.ops.some(op => op.data?.nextRememberTasks?.some(task => task.text === 'protected during confirmation'))).length, 0);
});

test('discard needs confirmation, removes only that store draft and preserves formal history', async () => {
  const h = harness(), before = clone(h.bundle);
  for (const id of ['a', 'b']) { h.c.openStoreReminder(id); h.input(id + ' unfinished'); await h.c.closeStoreReminder(); }
  h.c.openStoreReminder('a'); h.state.allow = false; const initial = clone(h.c.payload); await h.c.discardReminderDraft(); assert.deepEqual(clone(h.c.payload), initial); assert.ok(h.c.reminderContext);
  h.state.allow = true; await h.c.discardReminderDraft(); assert.deepEqual(clone(h.c.payload.reminderDrafts.map(d => d.storeId)), ['b']); assert.equal(h.c.reminderContext, null); assertFormalUnchanged(h, before);
});

test('discard drains a running draft write and prevents a queued timer from resurrecting the discarded draft', async () => {
  const h = harness(); let release, entered;
  const arrived = new Promise(resolve => entered = resolve), held = new Promise(resolve => release = resolve);
  h.state.beforePersist = async () => { entered(); await held; }; h.c.openStoreReminder('a'); h.input('first'); h.fireTimers(); await arrived;
  h.input('second'); const pending = h.c.discardReminderDraft(); assert.equal(h.timers.size, 0); release(); await pending;
  assert.equal(h.c.payload.reminderDrafts.length, 0); h.fireTimers(); await tick(); assert.equal(h.c.payload.reminderDrafts.length, 0); assert.equal(h.state.writes.length, 2);
});

test('malformed or duplicate persisted drafts fail closed without clearing or rewriting their evidence', () => {
  const h = harness(); h.c.openStoreReminder('a'); const good = clone(h.c.captureReminderDraft());
  const variants = [null, {}, [null], [good, good], [{ ...good, parents: [] }], [{ ...good, savedAt: 'invalid' }], [{ ...good, fields: { ...good.fields, next: 'x'.repeat(2001) } }], [{ ...good, fields: { ...good.fields, customChecked: 'yes' } }]];
  for (const drafts of variants) { h.c.payload.reminderDrafts = drafts; const before = clone(h.c.payload); assert.throws(() => h.c.storedReminderDrafts(), /格式無法辨識/); assert.deepEqual(h.c.payload, before); }
  delete h.c.payload.reminderDrafts; assert.deepEqual([...h.c.storedReminderDrafts()], []); assert.equal(h.state.writes.length, 0);
});

const encryptedFixture = (async () => { const meta = newMeta(), key = await derive('synthetic-reminder-draft-only-password', meta); return { meta, key }; })();
async function installRealPersistence(h) {
  const { meta, key } = await encryptedFixture, state = { disk: { revision: 4 }, calls: [], sealHook: null, writeHook: null };
  h.c.meta = meta; h.c.key = key; h.c.localRevision = 4; h.c.slot = state.disk;
  h.c.payload.bundle.vaultId = meta.vaultId;
  h.c.seal = async (...args) => { if (state.sealHook) await state.sealHook(...args); return seal(...args); };
  h.c.writeLocal = async (envelope, expected, unlockKey) => {
    state.calls.push({ envelope, expected, unlockKey }); if (state.writeHook) await state.writeHook();
    if (state.disk.revision !== expected) throw new Error('synthetic CAS stale revision');
    state.disk = { envelope, revision: expected + 1, unlockKey }; return expected + 1;
  };
  vm.runInContext(section('async function persist(', 'function pendingSyncSummary('), h.c);
  return { ...state, state, meta, key };
}

test('real device encryption preserves reminders exactly and exported bundle excludes every unfinished draft', async () => {
  const h = harness(), { state, key, meta } = await installRealPersistence(h), before = clone(h.c.payload.bundle);
  h.c.openStoreReminder('a'); h.input('SYNTHETIC_PRIVATE_DRAFT_SENTINEL\n exact  ', 'private every time'); await h.c.flushReminderDraft();
  assert.equal(state.calls.length, 1); assert.equal(state.calls[0].expected, 4); assert.doesNotMatch(JSON.stringify(state.disk.envelope), /SYNTHETIC_PRIVATE_DRAFT_SENTINEL/);
  const reopened = await unseal(state.disk.envelope, key, 'device'); assert.equal(reopened.reminderDrafts[0].fields.next, h.$('store-reminder-next').value); assert.deepEqual(reopened.bundle, before); assert.equal(reopened.dirty, false);
  const backup = await unseal(await seal(reopened.bundle, key, meta), key); assert.deepEqual(backup, before); assert.equal(Object.hasOwn(backup, 'reminderDrafts'), false); assert.doesNotMatch(JSON.stringify(backup), /SYNTHETIC_PRIVATE_DRAFT_SENTINEL/);
  const fresh = harness(); fresh.c.payload = reopened; fresh.c.openStoreReminder('a'); assert.equal(fresh.$('store-reminder-next').value, reopened.reminderDrafts[0].fields.next); assert.equal(fresh.$('store-reminder-every').value, 'private every time');
});

test('real persist catches payload, key, meta and revision changes while encryption is pending before any disk write', async () => {
  for (const kind of ['payload', 'key', 'meta', 'revision']) {
    const h = harness(), { state } = await installRealPersistence(h), next = { ...h.c.payload, reminderDrafts: [] };
    state.sealHook = () => { if (kind === 'revision') h.c.localRevision++; else h.c[kind] = { ...h.c[kind] }; };
    await assert.rejects(h.c.persist(next), /工作階段已變更/); assert.equal(state.calls.length, 0); assert.equal(state.disk.revision, 4);
  }
});

test('real persist uses captured CAS and refuses another-tab changes without adopting the candidate payload', async () => {
  const h = harness(), { state } = await installRealPersistence(h), original = h.c.payload;
  state.sealHook = () => { state.disk = { revision: 5 }; };
  await assert.rejects(h.c.persist({ ...original, reminderDrafts: [] }), /CAS stale/);
  assert.equal(state.calls.length, 1); assert.equal(state.calls[0].expected, 4); assert.equal(h.c.localRevision, 4); assert.equal(h.c.payload, original);
});

test('real persist never revives an old session when it changes during the successful disk transaction', async () => {
  for (const field of ['payload', 'key', 'meta', 'localRevision']) {
    const h = harness(), { state, key } = await installRealPersistence(h), next = { ...h.c.payload, reminderDrafts: [] };
    const changed = field === 'localRevision' ? 99 : null;
    state.writeHook = () => { h.c[field] = changed; };
    await assert.rejects(h.c.persist(next), /本機寫入已完成，但工作階段已變更/);
    assert.equal(state.calls.length, 1); assert.equal(state.calls[0].expected, 4); assert.equal(state.disk.revision, 5); assert.equal(h.c[field], changed);
    assert.deepEqual((await unseal(state.disk.envelope, key, 'device')).bundle, next.bundle);
    if (field !== 'localRevision') assert.equal(h.c.localRevision, 4, 'A changed session cannot adopt the completed write');
  }
});

function conflictHarness() {
  const h = harness(), { c, $ } = h;
  const first = revision('store', 'a', { ...h.a.data, contact: 'synthetic first head' }, [h.a.id], 'phone', false, makeVisitAttendance('a', created));
  const second = revision('store', 'a', { ...h.a.data, contact: 'synthetic second head' }, [h.a.id], 'mac');
  c.payload.bundle.ops.push(first, second);
  Object.assign(c, { records: project(c.payload.bundle), versionReview: null, resolutionPreview: null, draftTimer: null, diffTextSegments,
    kinds: { store: '門市' }, name: () => 'Synthetic name', uuid: () => 'synthetic-new-entity',
    input: (id, label, value = '') => { $(id).value = value; return `<label>${esc(label)}</label>`; }
  });
  c.by = (type, id) => c.records.find(record => record.type === type && record.id === id);
  c.render = () => { c.records = project(c.payload.bundle); h.state.renders++; };
  $('editor-fields').insertAdjacentHTML = (position, html) => { $('editor-fields').innerHTML = html + $('editor-fields').innerHTML; };
  const custom = { value: '' }, toggle = { checked: false }, convert = { checked: false };
  const group = { dataset: { reminderOptionsFor: 'f-next-remember', customApplied: '' }, querySelector: selector => selector === '[data-reminder-custom-input]' ? custom : toggle, querySelectorAll: () => [] };
  const query = c.document.querySelector; c.document.querySelector = selector => selector.includes('"f-next-remember"') ? group : query(selector);
  $('editor-form').querySelector = selector => selector === '[data-reminder-convert]' ? convert : null;
  $('f-next-remember').closest = selector => selector === 'form' ? $('editor-form') : null;
  vm.runInContext(section('function openEditor(', 'function quickTextParents('), c);
  vm.runInContext(section('async function saveEditor(', 'async function removeEntity('), c);
  vm.runInContext(section('function diffSegmentsHTML(', 'function renderQuickTextDialog('), c);
  vm.runInContext('function backFromResolution(b) {' + section('  if (b.dataset.resolutionBack !== undefined) {', '  if (b.dataset.attachment)') + '}', c);
  const originalClose = $('editor').close;
  $('editor').close = function () { h.state.contextAtEditorClose = c.editorContext; return originalClose.call(this); };
  function begin() {
    c.openReview('store', 'a', true); c.editMerge(first.id);
    // Real openEditor builds markup; this narrow DOM model supplies its rendered values.
    $('f-next-remember').value = ''; $('f-every-time-must').value = h.a.data.everyTimeMust; $('f-channel').value = '';
  }
  async function preview(text = 'synthetic merged task') {
    $('f-next-remember').value = text; c.scheduleReminderDraftSave();
    await c.saveEditor({ preventDefault() {} });
  }
  return { ...h, first, second, begin, preview };
}

test('real store merge editor copies every head into its reminder draft and preview or back keeps the draft intact', async () => {
  const h = conflictHarness(), before = clone(h.c.payload.bundle); h.begin();
  const heads = [h.first.id, h.second.id].sort();
  assert.deepEqual([...h.c.editorContext.parents], heads); assert.deepEqual([...h.c.editorContext.reminderDraftContext.parents], heads);
  assert.notEqual(h.c.editorContext.parents, h.c.editorContext.reminderDraftContext.parents);
  await h.preview(); assert.ok(h.c.resolutionPreview?.fromEditor); assert.ok(h.c.payload.reminderDrafts.length);
  assert.equal(h.c.payload.reminderDrafts[0].fields.next, 'synthetic merged task'); assertFormalUnchanged(h, before);
  const saved = clone(h.c.payload), context = h.c.editorContext;
  h.c.backFromResolution({ dataset: { resolutionBack: '' } });
  assert.equal(h.c.resolutionPreview, null); assert.equal(h.$('review').open, false); assert.equal(h.$('editor').open, true); assert.equal(h.c.editorContext, context);
  assert.deepEqual(clone(h.c.payload), saved); assert.equal(h.$('f-next-remember').value, 'synthetic merged task');
});

test('confirming a store merge atomically resolves all heads and clears only that store draft before closing its editor', async () => {
  const h = conflictHarness(); h.c.openStoreReminder('b'); h.input('unrelated store draft'); await h.c.closeStoreReminder();
  h.begin(); await h.preview(); const before = clone(h.c.payload), writes = h.state.writes.length;
  await h.c.confirmResolution();
  assert.equal(h.state.writes.length, writes + 1); const committed = h.state.writes.at(-1);
  assert.deepEqual(committed.reminderDrafts.map(draft => draft.storeId), ['b']); assert.equal(committed.bundle.ops.length, before.bundle.ops.length + 1);
  assert.deepEqual(committed.bundle.ops.slice(0, -1), before.bundle.ops); assert.deepEqual(committed.bundle.blobs, before.bundle.blobs);
  const current = project(committed.bundle).find(record => record.id === 'a'); assert.equal(current.conflict, false); assert.deepEqual([...current.heads[0].parents].sort(), [h.first.id, h.second.id].sort());
  assert.equal(current.nextRememberTasks.at(-1).text, 'synthetic merged task'); assert.equal(current.heads[0].visitAttendance, undefined); assert.equal(committed.bundle.ops.filter(op => op.visitAttendance).length, 1);
  assert.equal(h.state.contextAtEditorClose, null); assert.equal(h.c.editorContext, null); assert.equal(h.c.resolutionPreview, null); assert.equal(h.$('editor').open, false);
});

test('failed store merge commit preserves both drafts, conflict and preview for retry', async () => {
  const h = conflictHarness(); h.c.openStoreReminder('b'); h.input('other saved draft'); await h.c.closeStoreReminder();
  h.begin(); await h.preview(); const before = clone(h.c.payload), preview = h.c.resolutionPreview, ctx = h.c.editorContext;
  h.state.failWhen = next => next.bundle.ops.length > before.bundle.ops.length;
  await assert.rejects(h.c.confirmResolution(), /disk full/);
  assert.deepEqual(clone(h.c.payload), before); assert.equal(h.c.resolutionPreview, preview); assert.equal(h.c.editorContext, ctx); assert.equal(h.$('editor').open, true); assert.equal(project(h.c.payload.bundle).find(record => record.id === 'a').conflict, true);
  h.state.failWhen = () => false; await h.c.confirmResolution(); assert.equal(h.c.payload.bundle.ops.length, before.bundle.ops.length + 1); assert.deepEqual(clone(h.c.payload.reminderDrafts.map(draft => draft.storeId)), ['b']);
});

test('store merge confirmation rejects a replaced editor or draft context without clearing any saved draft', async () => {
  for (const kind of ['editor', 'draft']) {
    const h = conflictHarness(); h.begin(); await h.preview(); const before = clone(h.c.payload), writes = h.state.writes.length;
    if (kind === 'editor') h.c.editorContext = null; else h.c.editorContext.reminderDraftContext = { ...h.c.editorContext.reminderDraftContext };
    await assert.rejects(h.c.confirmResolution(), /編輯畫面已變更/); assert.deepEqual(clone(h.c.payload), before); assert.equal(h.state.writes.length, writes); assert.ok(h.c.resolutionPreview);
  }
});

test('store merge confirmation rechecks editor identity after awaiting an in-flight draft write', async () => {
  const h = conflictHarness(); h.begin(); await h.preview(); const before = clone(h.c.payload.bundle);
  h.$('f-next-remember').value = 'latest protected draft'; h.c.scheduleReminderDraftSave();
  h.state.beforePersist = async next => { if (next.bundle.ops.length === before.ops.length) h.c.editorContext = null; };
  await assert.rejects(h.c.confirmResolution(), /編輯畫面已變更/);
  assert.deepEqual(h.c.payload.bundle, before); assert.equal(h.c.payload.reminderDrafts.find(draft => draft.storeId === 'a').fields.next, 'latest protected draft');
  assert.equal(h.state.writes.some(next => next.bundle.ops.length > before.ops.length), false); assert.ok(h.c.resolutionPreview);
});

test('editMerge refuses an existing same-store draft before opening an editor or overwriting draft text', async () => {
  const h = conflictHarness();
  h.c.reminderContext = { id: 'a', storeName: h.a.data.name, parents: [h.a.id], baseEvery: h.a.data.everyTimeMust, baseLegacy: h.a.data.nextRemember, draftTouched: false, draftGeneration: 0 };
  h.input('existing exact draft'); await h.c.closeStoreReminder();
  h.c.openReview('store', 'a', true); const before = clone(h.c.payload), opened = h.state.opened.length, writes = h.state.writes.length;
  assert.throws(() => h.c.editMerge(h.first.id), /未完成提醒草稿/);
  assert.deepEqual(clone(h.c.payload), before); assert.equal(h.c.editorContext, null); assert.equal(h.state.opened.length, opened); assert.equal(h.state.writes.length, writes); assert.equal(h.$('review').open, true);
});
