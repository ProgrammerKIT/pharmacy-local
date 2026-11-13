import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(start, end) {
  return app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
}
function fixture() {
  const ctx = vm.createContext({
    payload: {
      bundle: {}
    },
    document: {
      hidden: false,
      activeElement: null,
      querySelector: () => null
    },
    pendingLock: false,
    updateHolding: false,
    autoFetching: false,
    syncInProgress: false,
    dayPlanContext: null,
    monthlyVisitContext: null,
    editorContext: null,
    reminderContext: null,
    singleStoreContext: null,
    inlineTextContext: null,
    quickTextContext: null,
    monthlyFeedbackContext: null,
    csvImport: {
      hasPending: () => false
    },
    syncScheduler: {
      wake() {}
    }
  });
  vm.runInContext(section('function releaseIdleInlineEdit(', 'function beginInlineTextEdit(') + section('function assertDayPlanIdle(', 'function newDayPlanContext(') + section('function assertMonthlyVisitIdle(', 'function newMonthlyVisitContext('), ctx);
  return ctx;
}
for (const [label, guard] of [['itinerary', 'assertDayPlanIdle'], ['monthly list', 'assertMonthlyVisitIdle']]) {
  test(label + ': an outbound read-only Mac probe does not block local planning', () => {
    const ctx = fixture();
    ctx.autoFetching = true;
    assert.doesNotThrow(() => ctx[guard]());
  });
  test(label + ': unchanged detached inline focus is released without writing or deleting drafts', () => {
    const ctx = fixture();
    ctx.inlineTextContext = {
      before: '原文',
      after: '原文'
    };
    const before = JSON.stringify(ctx.payload);
    assert.doesNotThrow(() => ctx[guard]());
    assert.equal(ctx.inlineTextContext, null);
    assert.equal(JSON.stringify(ctx.payload), before);
  });
  test(label + ': real edits, saved drafts, open forms and snapshot exchanges remain protected', () => {
    const cases = [s => {
      s.inlineTextContext = {
        before: '原文',
        after: '最新輸入'
      };
    }, s => {
      s.payload.inlineTextDraft = {
        format: 'inline-text-draft-1',
        after: '已保存草稿'
      };
    }, s => {
      s.editorContext = {
        type: 'visit'
      };
    }, s => {
      s.singleStoreContext = {
        storeId: 'synthetic'
      };
    }, s => {
      s.reminderContext = {};
    }, s => {
      s.syncInProgress = true;
    }, s => {
      s.document.hidden = true;
    }, s => {
      s.pendingLock = true;
    }, s => {
      s.updateHolding = true;
    }];
    for (const change of cases) {
      const ctx = fixture();
      change(ctx);
      const before = JSON.stringify(ctx.payload);
      assert.throws(() => ctx[guard]());
      assert.equal(JSON.stringify(ctx.payload), before);
    }
  });
}
