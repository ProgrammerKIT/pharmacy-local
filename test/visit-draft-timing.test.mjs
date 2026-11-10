import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const draftFunctions = app.slice(app.indexOf('function activeVisitDraftContext('), app.indexOf('function resumeVisitDraft('));

function editor() {
  let text = '', pendingTimer, finish;
  const writes = [];
  const ctx = { id: 'fictional-visit', draftTouched: false };
  const env = vm.createContext({
    singleStoreContext: ctx, editorContext: null, discardingDraft: false,
    draftTimer: null, draftSaveChain: Promise.resolve(), payload: {},
    captureVisitDraft: () => ({ id: ctx.id, text }),
    persist: ({ draft }) => { writes.push(draft.text); return new Promise(resolve => { finish = resolve; }); },
    draftState() {}, status() {}, dateText: () => 'test date',
    setTimeout: fn => { pendingTimer = fn; return fn; },
    clearTimeout: fn => { if (pendingTimer === fn) pendingTimer = null; }
  });
  vm.runInContext(draftFunctions, env);
  return {
    ctx, writes, env, type(value, event) { text = value; env.scheduleVisitDraftSave(event); },
    hasTimer: () => !!pendingTimer,
    timerFired: async () => { const run = pendingTimer; pendingTimer = null; run(); await new Promise(setImmediate); },
    finishWrite: () => finish()
  };
}

test('visit draft waits for Chinese composition to finish before automatic encryption', async () => {
  const t = editor();
  t.type('前一字');
  t.type('前一字', { type: 'compositionstart' });
  t.type('前一字ㄓ', { isComposing: true });
  assert.equal(t.hasTimer(), false);
  assert.deepEqual(t.writes, []);
  t.type('前一字中', { type: 'compositionend' });
  await t.timerFired();
  assert.deepEqual(t.writes, ['前一字中']);
  t.finishWrite();
  await t.env.draftSaveChain;
  assert.equal(t.ctx.draftTouched, false);
});

test('finishing an older write cannot mark newer input saved; closing flushes the latest input', async () => {
  const t = editor();
  t.type('第一段');
  await t.timerFired();
  t.type('第一段和最後一個字');
  t.finishWrite();
  await t.env.draftSaveChain;
  assert.equal(t.ctx.draftTouched, true);
  const closing = t.env.flushVisitDraft();
  await new Promise(setImmediate);
  assert.deepEqual(t.writes, ['第一段', '第一段和最後一個字']);
  t.finishWrite();
  await closing;
  assert.equal(t.ctx.draftTouched, false);
  assert.equal(t.hasTimer(), false);
});
