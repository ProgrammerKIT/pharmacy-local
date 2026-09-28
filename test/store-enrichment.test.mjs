import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emptyBundle, revision, project, splitTaiwanAddress, buildStoreEnrichmentRequest, validateStoreEnrichment, planStoreEnrichment, applyStoreEnrichment, newMeta, derive, seal, unseal, merge } from '../public/core.js';
import { parseRenderedGoogleMapsPlace, enrichRequest } from '../scripts/google-maps-enrichment.mjs';

const featureId = '0x123:0x456';
const url = `https://www.google.com/maps/place/fictional/data=!1s${featureId}!3d25!4d121`;
const data = (extra = {}) => ({ name: '虛構測試藥局', district: '', city: '', channel: '', attr: '人工客群', contact: '人工窗口', address: '', mapUrl: url, ...extra });
const bundle = (extra = {}) => ({ ...emptyBundle('enrichment-test'), ops: [revision('store', 'store-1', data(extra), [], 'test')] });
const input = (extra = {}) => ({ format: 'pharmacy-store-enrichment-1', items: [{ featureId, resolvedUrl: url, googleName: '虛構測試藥局', sourceNames: ['虛構測試藥局'], address: '100 臺北市中正區忠孝東路一段1號', checkedAt: '2026-09-27T00:00:00Z', ...extra }] });

test('Taiwan address splitting is deterministic and rejects incomplete public addresses', () => {
  assert.deepEqual(splitTaiwanAddress('100 台北市中正區忠孝東路一段1號'), { address: '臺北市中正區忠孝東路一段1號', city: '臺北市', district: '中正區' });
  assert.deepEqual(splitTaiwanAddress('台灣臺東縣臺東市中山路1號'), { address: '臺東縣臺東市中山路1號', city: '臺東縣', district: '臺東市' });
  assert.equal(splitTaiwanAddress('只有路名沒有縣市'), null);
});

test('rendered Google Maps lookup requires exact feature, current name and a Taiwan address', async () => {
  const requestItem = { featureId, sourceUrl: url, sourceNames: ['虛構測試藥局'] };
  const rendered = { heading: '虛構測試藥局', address: '100 臺北市中正區忠孝東路一段1號', finalUrl: url };
  assert.equal(parseRenderedGoogleMapsPlace(rendered, requestItem, '2026-09-27T00:00:00Z').address, rendered.address);
  assert.throws(() => parseRenderedGoogleMapsPlace({ ...rendered, heading: '另一間門市' }, requestItem), /名稱與目前門市名稱不同/);
  assert.throws(() => parseRenderedGoogleMapsPlace({ ...rendered, finalUrl: url.replace(featureId, '0x999:0xaaa') }, requestItem), /地點識別不一致/);
  assert.throws(() => parseRenderedGoogleMapsPlace({ ...rendered, address: '' }, requestItem), /沒有地址欄位/);
  assert.throws(() => parseRenderedGoogleMapsPlace({ ...rendered, address: '只有路名' }, requestItem), /地址無法拆分/);
  const lookup = async () => rendered;
  const result = await enrichRequest({ format: 'pharmacy-store-enrichment-request-1', items: [requestItem] }, { lookup, concurrency: 1 });
  assert.equal(result.items.length, 1); assert.equal(result.unresolved.length, 0); validateStoreEnrichment(result);
  const changed = async () => ({ ...rendered, heading: '另一間門市' });
  const uncertain = await enrichRequest({ format: 'pharmacy-store-enrichment-request-1', items: [requestItem] }, { lookup: changed, concurrency: 1 });
  assert.equal(uncertain.items.length, 0); assert.equal(uncertain.unresolved.length, 1); validateStoreEnrichment(uncertain);
  const plan = planStoreEnrichment(bundle(), uncertain); assert.equal(plan.changes.length, 0); assert.match(plan.exceptions[0].reason, /公開資料補查未完成/);
});

test('browser lookup retries transient failures, preserves order and isolates permanent failures', async () => {
  const requests = [0, 1, 2].map(index => {
    const id = `0x123:0x45${index}`;
    return { featureId: id, sourceUrl: url.replace(featureId, id), sourceNames: [`虛構測試藥局${index}`] };
  });
  const attempts = new Map(), progress = [];
  const result = await enrichRequest({ format: 'pharmacy-store-enrichment-request-1', items: requests }, {
    concurrency: 2,
    retries: 1,
    onProgress: value => progress.push(value.completed),
    lookup: async item => {
      const count = (attempts.get(item.featureId) || 0) + 1; attempts.set(item.featureId, count);
      if (item === requests[0] && count === 1) throw new Error('Google Maps 頁面載入逾時');
      if (item === requests[2]) return { heading: '不同名稱', address: '臺北市中正區忠孝東路1號', finalUrl: item.sourceUrl };
      return { heading: item.sourceNames[0], address: '臺北市中正區忠孝東路1號', finalUrl: item.sourceUrl };
    },
  });
  assert.deepEqual(result.items.map(item => item.featureId), requests.slice(0, 2).map(item => item.featureId));
  assert.equal(result.unresolved.length, 1); assert.match(result.unresolved[0].reason, /名稱與目前門市名稱不同/);
  assert.equal(attempts.get(requests[0].featureId), 2); assert.equal(attempts.get(requests[2].featureId), 1);
  assert.deepEqual(progress.sort((a, b) => a - b), [1, 2, 3]);
});

test('lookup rejects unsafe requests before navigation and aborts on browser failure', async () => {
  const requestItem = { featureId, sourceUrl: url, sourceNames: ['虛構測試藥局'] };
  let calls = 0;
  await assert.rejects(enrichRequest({ format: 'pharmacy-store-enrichment-request-1', items: [{ ...requestItem, sourceUrl: `https://evil.example/maps/data=!1s${featureId}` }] }, { lookup: async () => { calls++; } }), /Google 地點證據/);
  assert.equal(calls, 0);
  await assert.rejects(enrichRequest({ format: 'pharmacy-store-enrichment-request-1', items: [requestItem] }, { lookup: async () => { throw new Error('隔離瀏覽器已停止'); }, retries: 3 }), /隔離瀏覽器已停止/);
  await assert.rejects(enrichRequest({ format: 'pharmacy-store-enrichment-request-1', items: [requestItem, requestItem] }, { lookup: async () => ({}) }), /重複 Google 地點識別/);
});

test('request exports only safe incomplete stores with one Google feature identity', () => {
  const b = bundle();
  b.ops.push(revision('store', 'complete', data({ name: '完整門市', address: '臺北市中正區忠孝東路1號', city: '臺北市', district: '中正區', mapUrl: url.replace(featureId, '0x222:0x333') }), [], 'test'));
  b.ops.push(revision('store', 'pending', data({ name: '待確認門市', csvIdentityPending: true, mapUrl: url.replace(featureId, '0x444:0x555') }), [], 'test'));
  const request = buildStoreEnrichmentRequest(b, '2026-09-27T00:00:00Z');
  assert.equal(request.format, 'pharmacy-store-enrichment-request-1');
  assert.deepEqual(request.items.map(item => item.featureId), [featureId]);
  assert.equal(request.items[0].sourceNames[0], '虛構測試藥局');
});

test('preview is read only and apply fills only blanks with source and full history', () => {
  const b = bundle(), before = JSON.stringify(b), plan = planStoreEnrichment(b, input());
  assert.equal(JSON.stringify(b), before); assert.equal(plan.changes.length, 1); assert.equal(plan.exceptions.length, 0);
  assert.deepEqual(plan.changes[0].additions, { address: '臺北市中正區忠孝東路一段1號', city: '臺北市', district: '中正區' });
  const next = applyStoreEnrichment(b, input(), plan, 'phone'), store = project(next).find(item => item.id === 'store-1');
  assert.equal(next.ops.length, 2); assert.deepEqual(next.ops[0], b.ops[0]);
  assert.equal(store.contact, '人工窗口'); assert.equal(store.attr, '人工客群'); assert.equal(store.enrichmentSources.length, 1);
  assert.equal(store.enrichmentSources[0].featureId, featureId); assert.equal(store.enrichmentSources[0].sourceAddress, '100 臺北市中正區忠孝東路一段1號');
  assert.equal(planStoreEnrichment(next, input()).changes.length, 0);
});

test('existing values, identity ambiguity, conflicts and changed names become exceptions', () => {
  for (const extra of [{ address: '臺北市中正區另一條路9號' }, { city: '高雄市' }, { district: '大安區' }, { csvIdentityPending: true }, { name: '另一間門市' }]) {
    const plan = planStoreEnrichment(bundle(extra), input()); assert.equal(plan.changes.length, 0); assert.ok(plan.exceptions.length >= 1);
  }
  const conflicted = bundle(); conflicted.ops.push(revision('store', 'store-1', data({ contact: '另一版本' }), [], 'other'));
  assert.equal(planStoreEnrichment(conflicted, input()).changes.length, 0);
  const duplicate = bundle(); duplicate.ops.push(revision('store', 'store-2', data(), [], 'other'));
  assert.equal(planStoreEnrichment(duplicate, input()).changes.length, 0);
});

test('malformed evidence and stale previews block the whole batch', () => {
  for (const edit of [value => { value.items[0].featureId = 'bad'; }, value => { value.items[0].resolvedUrl = 'https://evil.example/'; }, value => { value.items[0].sourceNames = []; }, value => { value.items[0].address = '無法拆分'; }, value => { value.items.push(value.items[0]); }]) {
    const value = input(); edit(value); assert.throws(() => validateStoreEnrichment(value));
  }
  const b = bundle(), plan = planStoreEnrichment(b, input());
  b.ops.push(revision('store', 'store-1', data({ contact: '新的人工窗口' }), [b.ops[0].id], 'other'));
  assert.throws(() => applyStoreEnrichment(b, input(), plan, 'phone'), /重新預覽/);
});

test('encrypted backup and concurrent edits retain separate address-enrichment history', async () => {
  const b = bundle(), enriched = applyStoreEnrichment(b, input(), planStoreEnrichment(b, input()), 'phone');
  const other = structuredClone(b); other.ops.push(revision('store', 'store-1', data({ contact: '另一裝置窗口' }), [b.ops[0].id], 'mac'));
  const combined = merge(enriched, other); assert.equal(project(combined)[0].conflict, true);
  const meta = newMeta(), key = await derive('synthetic-enrichment-password', meta);
  assert.deepEqual(await unseal(await seal(combined, key, meta), key), combined);
});

test('UI preview/cancel do not persist and failed writes keep the preview available', async () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, { open: false, innerHTML: '', textContent: '', showModal() { this.open = true; }, close() { this.open = false; } }); return nodes.get(id); };
  let writes = 0;
  const payload = { bundle: bundle(), device: 'test', draft: { text: 'keep' } };
  const context = vm.createContext({ $, payload, key: {}, enrichmentPreview: null, coordinatePreview: null, versionReview: null, resolutionPreview: null, editorContext: null, csvImport: { hasPending: () => false }, pendingLock: false, document: { hidden: false }, openDialog: dialog => dialog.showModal(), planStoreEnrichment, applyStoreEnrichment, buildStoreEnrichmentRequest, esc: String, dateText: String, render: () => {}, toast: () => {}, download: () => {}, confirm: () => true, persist: async () => { writes++; throw new Error('disk failure'); } });
  vm.runInContext(app.slice(app.indexOf('function exportStoreEnrichmentRequest('), app.indexOf('function visitStoreSearchText(')), context);
  const file = { size: 100, text: async () => JSON.stringify(input()) };
  await context.previewStoreEnrichmentFile(file); assert.equal(writes, 0); assert.equal($('review').open, true); assert.match($('review-body').innerHTML, /可安全補全 1 間/);
  const before = JSON.stringify(payload); await assert.rejects(context.commitStoreEnrichment(), /disk failure/); assert.equal(JSON.stringify(payload), before); assert.equal($('review').open, true);
  $('review').close(); await assert.rejects(context.commitStoreEnrichment(), /預覽已失效/); assert.equal(writes, 1);
});
