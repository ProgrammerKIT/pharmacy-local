import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function safeMerge(record) {
  const start = app.indexOf('const SAFE_CONFLICT_BLOCKED_FIELDS =');
  const end = app.indexOf('function safeMergeSummary(', start);
  assert.ok(start >= 0 && end > start, 'Use the actual generic conflict merge implementation');
  const context = vm.createContext({ structuredClone });
  vm.runInContext(app.slice(start, end), context);
  return context.safeConflictMerge(record);
}
function record(left, right, baseData = { name: '虛構門市', contact: '', city: '', datePlans: [] }) {
  const base = { id: 'base', parents: [], data: baseData, deleted: false, at: '2026-10-01T00:00:00.000Z' };
  const phone = { id: 'phone', parents: ['base'], data: { ...baseData, ...left }, deleted: false, at: '2026-10-02T00:00:00.000Z' };
  const mac = { id: 'mac', parents: ['base'], data: { ...baseData, ...right }, deleted: false, at: '2026-10-02T00:01:00.000Z' };
  return { id: 'synthetic', type: 'store', conflict: true, heads: [phone, mac], versions: [base, phone, mac] };
}

test('generic conflict merge cannot combine day plans with another field as a safe suggestion', () => {
  const plan = safeMerge(record({ datePlans: [{ date: '2026-10-14', selected: true }] }, { contact: '虛構新聯絡人' }));
  assert.equal(plan.safe, false);
  assert.ok(plan.blocked.some(item => item.field === 'datePlans' && item.kind === 'protected'));
});

test('identical changed day plans on both heads remain protected, including packed decisions', () => {
  const changed = { datePlans: [{ date: '2026-10-14', selected: true, packed: ['fictional-item'] }] };
  const plan = safeMerge(record(changed, { ...changed, city: '虛構市' }));
  assert.equal(plan.safe, false);
  assert.ok(plan.blocked.some(item => item.field === 'datePlans' && item.kind === 'protected'));
});

test('unchanged day plans do not prevent ordinary disjoint-field conflict suggestions', () => {
  const baseline = { name: '虛構門市', city: '', contact: '', datePlans: [{ date: '2026-10-14', selected: true }] };
  const plan = safeMerge(record({ city: '虛構市' }, { contact: '虛構人' }, baseline));
  assert.equal(plan.safe, true);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.data.datePlans)), baseline.datePlans);
});
