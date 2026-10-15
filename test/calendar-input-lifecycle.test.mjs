import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { uiNodeFixture } from './helpers/ui-node-fixture.mjs';
import { emptyBundle, monthlyVisitMonth, shiftMonthlyVisitMonth, monthlyVisitOverview, monthlyVisitBasis,
  dayPlanDate, shiftDayPlanDate, dayPlanOverview, dayItineraryBasis } from '../public/core.js';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(first, next) {
  const start = app.indexOf(first), end = app.indexOf(next, start + first.length);
  assert.ok(start >= 0 && end > start); return app.slice(start, end);
}
function fixture() {
  const { node, document } = uiNodeFixture(), handlers = new Map(), bundle = emptyBundle('fictional-calendar-lifecycle');
  document.addEventListener = (type, handler) => handlers.set('monthly-' + type, handler);
  node('day-plan-content').addEventListener = (type, handler) => handlers.set('daily-' + type, handler);
  const sandbox = vm.createContext({
    $: node, document, payload: { bundle }, records: [], monthlyVisitSelectedMonth: monthlyVisitMonth(), monthlyVisitNotice: '', monthlyVisitViewBasis: '',
    monthlyVisitContext: null, dayPlanContext: null, dayPlanSelectedDate: dayPlanDate(), dayPlanViewBasis: '', dayPlanSorting: false, dayPlanNotice: '', dayPlanUndo: null, busy: false,
    monthlyVisitMonth, shiftMonthlyVisitMonth, monthlyVisitOverview, monthlyVisitBasis, dayPlanDate, shiftDayPlanDate, dayPlanOverview, dayItineraryBasis,
    esc: value => String(value), by: () => undefined, retailChannel: () => ({ id: 'independent' }),
    dismissals: 0, dismissKeyboard() { sandbox.dismissals++; document.activeElement?.blur(); },
    toast(message) { sandbox.lastToast = message; }
  });
  vm.runInContext(section('function monthlyVisitLabel(', 'function assertMonthlyVisitIdle(')
    + section('function changeMonthlyVisitMonth(', 'function assertDayPlanIdle('), sandbox);
  sandbox.renderMonthlyVisits(); sandbox.renderDayPlan();
  for (const prefix of ["document.addEventListener('change', event => {\n  if (event.target.id !== 'monthly-visit-month'", "$('day-plan-content').addEventListener('change', event => {"]) {
    const start = app.indexOf(prefix), end = app.indexOf('\n});', start) + 4;
    assert.ok(start >= 0 && end > start); vm.runInContext(app.slice(start, end), sandbox);
  }
  const before = JSON.stringify(bundle);
  return { node, document, sandbox, before,
    change(kind, value) { const input = node(kind === 'monthly' ? 'monthly-visit-month' : 'day-plan-date'); input.value = value; handlers.get(kind + '-change')({ target: input }); return input; }
  };
}

test('native month changes retain the original focused input while selected-month results update', () => {
  const f = fixture(), input = f.node('monthly-visit-month'), first = f.sandbox.monthlyVisitSelectedMonth;
  input.focus();
  for (const month of [shiftMonthlyVisitMonth(first, 1), shiftMonthlyVisitMonth(first, 2), first]) {
    f.change('monthly', month);
    assert.equal(f.node('monthly-visit-month'), input); assert.equal(input.isConnected, true);
    assert.equal(f.document.activeElement, input); assert.equal(input.value, month);
    assert.equal(f.sandbox.monthlyVisitSelectedMonth, month);
    assert.match(f.node('monthly-visit-results').innerHTML, new RegExp(Number(month.slice(5)) + ' 月'));
  }
  assert.equal(f.sandbox.dismissals, 0); assert.equal(JSON.stringify(f.sandbox.payload.bundle), f.before);
});

test('native day changes retain their input and expanded date section across repeated selections', () => {
  const f = fixture(), input = f.node('day-plan-date'), section = input.closest('details'), first = f.sandbox.dayPlanSelectedDate;
  section.open = true; input.focus();
  for (const date of [shiftDayPlanDate(first, 1), shiftDayPlanDate(first, 3), first]) {
    f.change('daily', date);
    assert.equal(f.node('day-plan-date'), input); assert.equal(input.isConnected, true);
    assert.equal(input.closest('details'), section); assert.equal(section.open, true);
    assert.equal(f.document.activeElement, input); assert.equal(input.value, date);
    assert.equal(f.sandbox.dayPlanSelectedDate, date);
    assert.match(f.node('day-plan-results').innerHTML, /day-plan-toolbar/);
  }
  assert.equal(f.sandbox.dismissals, 0); assert.equal(JSON.stringify(f.sandbox.payload.bundle), f.before);
});

test('refreshing roster or itinerary results keeps active date controls connected', () => {
  const f = fixture();
  for (const [id, render] of [['monthly-visit-month', 'renderMonthlyVisits'], ['day-plan-date', 'renderDayPlan']]) {
    const input = f.node(id); input.focus();
    f.sandbox[render](); f.sandbox[render]();
    assert.equal(f.node(id), input); assert.equal(input.isConnected, true); assert.equal(f.document.activeElement, input);
  }
});

test('empty native selections restore their displayed month/date without changing the active selection or data', () => {
  const f = fixture();
  for (const [kind, id, selected] of [['monthly', 'monthly-visit-month', 'monthlyVisitSelectedMonth'], ['daily', 'day-plan-date', 'dayPlanSelectedDate']]) {
    const before = f.sandbox[selected], input = f.node(id); input.focus(); f.change(kind, '');
    assert.equal(input.value, before); assert.equal(f.sandbox[selected], before);
    assert.equal(f.document.activeElement, input); assert.equal(input.isConnected, true);
  }
  assert.equal(JSON.stringify(f.sandbox.payload.bundle), f.before);
});

test('explicit month-arrow navigation can still dismiss input and updates boundary/history controls', () => {
  const f = fixture(), input = f.node('monthly-visit-month'); input.focus();
  f.sandbox.changeMonthlyVisitMonth('0001-01');
  assert.equal(f.sandbox.dismissals, 1); assert.equal(f.document.activeElement, null);
  assert.equal(f.node('monthly-visit-month'), input); assert.equal(f.node('monthly-previous-month').disabled, true);
  assert.equal(f.node('monthly-readonly-month').hidden, false); assert.equal(f.node('monthly-add-store').hidden, true);
  f.sandbox.changeMonthlyVisitMonth('9999-12');
  assert.equal(f.node('monthly-next-month').disabled, true); assert.equal(f.node('monthly-add-store').hidden, false);
  assert.equal(JSON.stringify(f.sandbox.payload.bundle), f.before);
});
