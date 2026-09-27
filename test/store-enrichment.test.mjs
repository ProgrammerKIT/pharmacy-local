import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emptyBundle, revision, project, splitTaiwanAddress, buildStoreEnrichmentRequest, validateStoreEnrichment, planStoreEnrichment, applyStoreEnrichment, newMeta, derive, seal, unseal, merge } from '../public/core.js';
import { parseGoogleMapsPublicPage, enrichRequest } from '../scripts/google-maps-enrichment.mjs';

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

test('public-page lookup accepts one exact-name address and isolates uncertain results', async () => {
  const requestItem = { featureId, sourceUrl: url, sourceNames: ['虛構測試藥局'] };
  const html = '<html><head><meta property="og:title" content="虛構測試藥局 - Google Maps"><meta property="og:description" content="100 臺北市中正區忠孝東路一段1號"></head></html>';
  assert.equal(parseGoogleMapsPublicPage(html, requestItem).address, '臺北市中正區忠孝東路一段1號');
  assert.throws(() => parseGoogleMapsPublicPage(html.replace('虛構測試藥局 - Google Maps', '另一間門市 - Google Maps'), requestItem), /名稱已變更/);
  const fetcher = async () => ({ ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => html });
  const result = await enrichRequest({ format: 'pharmacy-store-enrichment-request-1', items: [requestItem] }, { fetcher, pause: async () => {} });
  assert.equal(result.items.length, 1); assert.equal(result.unresolved.length, 0); validateStoreEnrichment(result);
  const changed = async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => html.replace('虛構測試藥局 - Google Maps', '另一間門市 - Google Maps') });
  const uncertain = await enrichRequest({ format: 'pharmacy-store-enrichment-request-1', items: [requestItem] }, { fetcher: changed, pause: async () => {} });
  assert.equal(uncertain.items.length, 0); assert.equal(uncertain.unresolved.length, 1); validateStoreEnrichment(uncertain);
  const plan = planStoreEnrichment(bundle(), uncertain); assert.equal(plan.changes.length, 0); assert.match(plan.exceptions[0].reason, /公開資料補查未完成/);
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
  const context = vm.createContext({ $, payload, key: {}, enrichmentPreview: null, coordinatePreview: null, versionReview: null, resolutionPreview: null, editorContext: null, csvImport: { hasPending: () => false }, pendingLock: false, document: { hidden: false }, planStoreEnrichment, applyStoreEnrichment, buildStoreEnrichmentRequest, esc: String, dateText: String, render: () => {}, toast: () => {}, download: () => {}, confirm: () => true, persist: async () => { writes++; throw new Error('disk failure'); } });
  vm.runInContext(app.slice(app.indexOf('function exportStoreEnrichmentRequest('), app.indexOf('function visitStoreSearchText(')), context);
  const file = { size: 100, text: async () => JSON.stringify(input()) };
  await context.previewStoreEnrichmentFile(file); assert.equal(writes, 0); assert.equal($('review').open, true); assert.match($('review-body').innerHTML, /可安全補全 1 間/);
  const before = JSON.stringify(payload); await assert.rejects(context.commitStoreEnrichment(), /disk failure/); assert.equal(JSON.stringify(payload), before); assert.equal($('review').open, true);
  $('review').close(); await assert.rejects(context.commitStoreEnrichment(), /預覽已失效/); assert.equal(writes, 1);
});
