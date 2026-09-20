import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, project, validateBundle, revision, b64 } from '../public/core.js';
import { prepareCSV, planCSV, buildCSVImport } from '../public/csv.js';
import { createCSVImport } from '../public/csv-ui.js';

const enc = new TextEncoder();
const raw = 'Title,Note,URL\n虛構藥局,原始內容,https://maps.google.com/?cid=1234567';
const file = () => prepareCSV('虛構清單.csv', enc.encode(raw));

test('every confirmed CSV batch stores a complete immutable source snapshot', async () => {
  const b = emptyBundle('source-vault'), f = await file(), plan = await planCSV([f], b);
  const result = buildCSVImport(plan, b, 'mac');
  const source = result.bundle.ops.find(o => o.type === 'source');
  assert.ok(source);
  assert.equal(source.deleted, false);
  assert.deepEqual(source.parents, []);
  assert.equal(source.data.file, '虛構清單.csv');
  assert.equal(source.data.blob, f.blob);
  assert.equal(source.data.rows, 1);
  assert.deepEqual(source.data.headers, f.headers);
  assert.equal(result.bundle.blobs[f.blob], b64(f.bytes));

  const store = project(result.bundle).find(r => r.type === 'store');
  assert.equal(store.csvSources[0].sourceSnapshot, source.entity);

  const edited = structuredClone(result.bundle);
  edited.ops.push(revision('source', source.entity, { ...source.data, file: '改寫.csv' }, [source.id], 'mac'));
  assert.throws(() => validateBundle(edited), /只能新增一次/);

  const deleted = structuredClone(result.bundle);
  deleted.ops.push(revision('source', source.entity, source.data, [source.id], 'mac', true));
  assert.throws(() => validateBundle(deleted), /不能修改或刪除/);
});

test('a file is snapshotted even when every parsed row is excluded', async () => {
  const b = emptyBundle('source-only'), f = await file(), plan = await planCSV([f], b);
  for (const row of plan.rows) row.choice = 'skip';
  const result = buildCSVImport(plan, b, 'mac');
  assert.equal(result.summary.rows, 0);
  assert.equal(result.summary.sourceSnapshots, 1);
  assert.equal(project(result.bundle).filter(r => r.type === 'store').length, 0);
  assert.equal(project(result.bundle).filter(r => r.type === 'visit').length, 0);
  assert.equal(project(result.bundle).filter(r => r.type === 'source').length, 1);
  assert.equal(result.bundle.blobs[f.blob], b64(f.bytes));
});

test('reconfirming identical CSV keeps customer data idempotent but records the new source event', async () => {
  const b = emptyBundle('repeat-source'), f = await file();
  const first = buildCSVImport(await planCSV([f], b), b, 'mac').bundle;
  const beforeStores = project(first).filter(r => r.type === 'store').map(r => r.id);
  const beforeVisits = project(first).filter(r => r.type === 'visit').map(r => r.id);
  const secondResult = buildCSVImport(await planCSV([await file()], first), first, 'phone');
  const second = secondResult.bundle;

  assert.deepEqual(project(second).filter(r => r.type === 'store').map(r => r.id), beforeStores);
  assert.deepEqual(project(second).filter(r => r.type === 'visit').map(r => r.id), beforeVisits);
  assert.equal(project(second).filter(r => r.type === 'source').length, 2);
  assert.equal(Object.keys(second.blobs).length, Object.keys(first.blobs).length);
  assert.equal(secondResult.summary.rows, 0);
  assert.equal(secondResult.summary.sourceSnapshots, 1);
});


test('Source Snapshot panel refreshes after encrypted state becomes available', async () => {
  let state = null;
  const host = {
    innerHTML: '',
    addEventListener() {},
    querySelector() { return null; }
  };
  const ui = createCSVImport({
    host,
    getState: () => state,
    run: async fn => fn(),
    saveBundle: async () => {},
    notify: () => {}
  });
  assert.match(host.innerHTML, /已保存原始 CSV · 0 份/);

  const b = emptyBundle('refresh-source'), f = await file();
  const first = buildCSVImport(await planCSV([f], b), b, 'mac').bundle;
  state = { bundle: first, device: 'mac' };
  ui.refresh();

  assert.match(host.innerHTML, /已保存原始 CSV · 1 份/);
  assert.match(host.innerHTML, /虛構清單\.csv/);
  assert.match(host.innerHTML, new RegExp(f.blob.slice(0, 12)));
});
