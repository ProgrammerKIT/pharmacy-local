import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { originalStoreNames, retailChannel, filterStoreDirectory } from '../public/relations.js';
import { prepareCSV, planCSV, buildCSVImport } from '../public/csv.js';
import { newMeta, emptyBundle, project, revision, derive, seal, unseal, merge } from '../public/core.js';

// All branch names, people, notes and source files in this file are fictional.
const source = name => ({ headers: ['Title', 'Note'], cells: [name, '虛構原文：附近有大樹與躍獅'] });
const store = (id, name, extra = {}) => ({ id, type: 'store', name, city: '', district: '', channel: '', attr: '', contact: '', ...extra });
const ids = result => result.entries.map(e => e.store.id);
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('channels prefer untouched original titles to manual names and use only the approved cross-name alias', () => {
  const s = freeze(store('a', '躍獅藥局－虛構甲店', { csvAliases: ['大樹藥局－虛構甲店'], csvSources: [source('  佑全藥局－虛構甲店  ')] }));
  assert.deepEqual(originalStoreNames(s), ['  佑全藥局－虛構甲店  ']);
  assert.equal(retailChannel(s).id, 'you-chuan');
  assert.equal(retailChannel(store('b', '健康人生藥局－虛構乙店')).id, 'you-chuan');
  assert.equal(retailChannel(store('c', '大 樹 藥局－虛構丙店')).id, 'great-tree');
  assert.equal(retailChannel(store('d', '立登藥局－虛構丁店')).id, 'ungrouped');
  assert.equal(retailChannel(store('e', '博陽藥局－虛構戊店')).id, 'ungrouped');
  assert.equal(s.csvSources[0].cells[0], '  佑全藥局－虛構甲店  ');
});

test('mentions in notes, address, tags or marketing text do not create a channel', () => {
  const s = store('a', '虛構藥局', { attr: '大樹', address: '躍獅旁', csvSources: [source('虛構藥局｜大樹附近')] });
  assert.equal(retailChannel(s).id, 'ungrouped');
  assert.equal(retailChannel(store('b', '大樹公園')).id, 'ungrouped');
  const changed = store('c', '人工名稱', { csvSources: [{ headers: ['Name', '標題'], cells: ['大樹藥局－虛構店', '躍獅藥局－虛構店'] }] });
  assert.equal(retailChannel(changed).id, 'yes-chain');
  assert.equal(retailChannel(store('d', '人工名稱', { csvAliases: ['健康人生藥局－虛構店'] })).id, 'you-chuan');
});

test('conflicting source channels and concurrent heads remain pending, with original names inspectable', () => {
  const s = store('a', '整合顯示名稱', { csvSources: [source('大樹藥局－虛構甲店'), source('躍獅藥局－虛構乙店')] });
  const group = retailChannel(freeze(s));
  assert.equal(group.id, 'pending'); assert.deepEqual(group.candidates, ['大樹', '躍獅']); assert.equal(group.names.length, 2);
  const conflict = store('b', '佑全藥局－虛構店', { conflict: true, heads: [{ data: { name: '躍獅藥局－虛構店' } }] });
  assert.equal(retailChannel(conflict).id, 'pending');
  assert.equal(retailChannel(store('c', '同群來源', { csvSources: [source('佑全藥局－虛構店'), source('健康人生藥局－虛構店')] })).id, 'you-chuan');
});

test('multiple channels use OR and combine with text, district and store type using AND', () => {
  const stores = freeze([
    store('a', '佑全藥局－虛構甲店', { district: '測試甲區', channel: '連鎖' }),
    store('b', '健康人生藥局－虛構乙店', { district: '測試乙區', channel: '加盟' }),
    store('c', '大樹藥局－虛構丙店', { district: '測試甲區', channel: '連鎖' }),
    store('d', '躍獅藥局－虛構丁店', { district: '測試甲區', channel: '連鎖' }),
    store('gone', '大樹藥局－虛構已刪店', { deleted: true }),
  ]);
  const visits = freeze([{ store: 'a', text: '虛構測試：追蹤陳列' }, { store: 'c', text: '虛構測試：追蹤陳列' }, { store: 'd', text: '虛構測試：追蹤陳列', deleted: true }]);
  const filters = { groups: ['you-chuan', 'great-tree'], query: '陳列', district: '測試甲區', kind: '連鎖' };
  assert.deepEqual(ids(filterStoreDirectory(stores, visits, filters)), ['a', 'c']);
  assert.deepEqual(ids(filterStoreDirectory(stores, visits, { groups: ['you-chuan'] })), ['a', 'b']);
  assert.equal(filterStoreDirectory(stores, visits, {}).total, 4);
  assert.deepEqual(ids(filterStoreDirectory(stores, visits, { query: '陳列', groups: ['yes-chain'] })), []);
  const empty = filterStoreDirectory(stores, visits, { query: '不存在', groups: ['you-chuan'] });
  assert.equal(empty.groups.find(g => g.id === 'you-chuan').count, 0);
  assert.equal(filterStoreDirectory(stores, visits, filters).groups.find(g => g.id === 'great-tree').count, 1);
});

test('text search includes original names and both approved channel aliases', () => {
  const s = store('a', '人工顯示名稱', { csvSources: [source('健康人生藥局－虛構甲店')] });
  assert.deepEqual(ids(filterStoreDirectory([s], [], { query: '虛構甲店' })), ['a']);
  assert.deepEqual(ids(filterStoreDirectory([s], [], { query: '佑全' })), ['a']);
  assert.deepEqual(ids(filterStoreDirectory([s], [{ store: 'a', text: '人工補充', googleText: '保留原文' }], { query: '保留原文' })), ['a']);
});

test('real CSV import, manual edits, repeat upload and encrypted transport retain separate branches and identical source bytes', async () => {
  const raw = 'Title,Note,URL\n佑全藥局－虛構甲店,"第一行\n  第二行",https://maps.google.com/?cid=991001\n健康人生藥局－虛構乙店,虛構原文乙,https://maps.google.com/?cid=991002\n';
  const file = await prepareCSV('fictional-channel.csv', new TextEncoder().encode(raw));
  const meta = newMeta(), base = emptyBundle(meta.vaultId);
  const first = buildCSVImport(await planCSV([file], base), base, 'mac').bundle;
  const s = project(first).find(r => r.type === 'store');
  first.ops.push(revision('store', s.id, { ...s.heads[0].data, name: '人工顯示名稱', contact: '虛構手動窗口' }, [s.heads[0].id], 'mac'));
  const before = JSON.stringify(first), records = project(first), stores = records.filter(r => r.type === 'store');
  const result = filterStoreDirectory(stores, records.filter(r => r.type === 'visit'), { groups: ['you-chuan'] });
  assert.equal(result.entries.length, 2); assert.equal(new Set(ids(result)).size, 2); assert.equal(JSON.stringify(first), before);
  assert.equal(Buffer.from(first.blobs[file.blob], 'base64').toString('utf8'), raw);
  const repeated = buildCSVImport(await planCSV([file], first), first, 'phone').bundle;
  assert.deepEqual(repeated, first);
  const key = await derive('fictional-test-only', meta), transported = merge(base, await unseal(await seal(first, key, meta), key));
  const remote = project(transported).filter(r => r.type === 'store');
  assert.deepEqual(ids(filterStoreDirectory(remote, [], { groups: ['you-chuan'] })).sort(), ids(result).sort());
  assert.equal(remote.find(r => r.id === s.id).name, '人工顯示名稱');
});

test('actual shared directory controls retain combined filters across views and can clear a zero-result selection', () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const nodes = new Map(), $ = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', innerHTML: '', textContent: '', scrollTop: 0, contains: () => false, replaceChildren() { this.innerHTML = ''; } });
    return nodes.get(id);
  };
  const records = [store('a', '佑全藥局－虛構甲店'), store('b', '健康人生藥局－虛構乙店'), store('c', '大樹藥局－虛構丙店')];
  const ctx = vm.createContext({ $, payload: {}, updateHolding: false, storeFilters: {}, activeView: 'stores', filterStoreDirectory,
    all: type => type === 'store' ? records : [], document: { activeElement: null }, entityCard: s => s.id,
    esc: s => String(s || ''), focus: {}, related: () => [], storeIdentityPending: () => false });
  vm.runInContext(source.slice(source.indexOf('function resetStoreFilters('), source.indexOf('function renderFocus(')), ctx);
  ctx.resetStoreFilters(); ctx.changeStoreFilter('groups', 'you-chuan');
  assert.equal($('customer-list').innerHTML, 'ab');
  ctx.changeStoreFilter('query', '虛構甲'); assert.equal($('customer-list').innerHTML, 'a');
  assert.equal($('search').value, '虛構甲');
  ctx.activeView = 'explore'; ctx.renderStores();
  assert.match($('store-list').innerHTML, /data-node-id="a"/); assert.doesNotMatch($('store-list').innerHTML, /data-node-id="b"/);
  ctx.changeStoreFilter('query', '不存在'); assert.match($('store-count').textContent, /顯示 0/);
  assert.match($('retail-options').innerHTML, /data-retail-group="you-chuan" aria-pressed="true"/);
  ctx.changeStoreFilter('groups', ''); assert.equal(ctx.storeFilters.query, '不存在');
  ctx.changeStoreFilter('clear'); assert.equal($('customer-search').value, '');
  assert.match($('store-count').textContent, /顯示 3/);
});
