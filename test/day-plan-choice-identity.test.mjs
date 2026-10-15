// Fictional stores only. Same-name branches must be distinguishable before adding an itinerary.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const functionSource = name => {
  const start = app.indexOf(`function ${name}(`), end = app.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start); return app.slice(start, end);
};
function render(stores) {
  const elements = new Map([['day-plan-selection-count', { textContent: '' }], ['day-store-options', { innerHTML: '' }]]);
  const context = vm.createContext({
    dayPlanContext: { kind: 'selection', query: '', stores, date: '2026-10-15' }, records: stores,
    $: id => elements.get(id), by: (type, id) => stores.find(store => store.type === type && store.id === id),
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    dayPlanForStore: () => undefined, dayPlanAvailable: () => true
  });
  vm.runInContext(functionSource('storeSelectionIdentity') + '\n' + functionSource('renderDayPlanChoices') + '\nrenderDayPlanChoices("");', context);
  return elements.get('day-store-options').innerHTML;
}
const store = (id, address) => ({ type: 'store', id, name: '合成同名藥局', city: '虛構市', district: '合成區', address });
test('same-name itinerary choices display their different addresses before the user chooses a branch', () => {
  const html = render([store('qa-day-same-a', '虛構市甲路 1 號'), store('qa-day-same-b', '虛構市乙路 2 號')]);
  assert.match(html, /虛構市甲路 1 號/);
  assert.match(html, /虛構市乙路 2 號/);
});
test('same-name itinerary choices with missing or equal addresses expose a visible ID fallback', () => {
  for (const address of ['', '虛構市同路 3 號']) {
    const html = render([store('qa-day-same-a', address), store('qa-day-same-b', address)]);
    assert.match(html, /識別碼 qa-day-same-a/);
    assert.match(html, /識別碼 qa-day-same-b/);
  }
});
