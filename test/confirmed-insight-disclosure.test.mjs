import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../public/core.js';
import { visitBriefForStore, storeIdentityPending } from '../public/relations.js';
import { makeFixture } from './qa/confirmed-insight-fixture.mjs';

// Run the actual card renderer, openVisitBrief capture/restore path and source
// toggle listener with synthetic records. This small DOM models details state;
// it does not claim Safari layout or a native confirmation dialog was tested.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function source(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Application test boundary not found: ${start}`);
  return app.slice(from, to);
}
const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const camel = value => value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

function harness() {
  const nodes = new Map(), pendingToggles = new Set(), frames = [], state = { dialogOpens: 0, sourceLoads: 0, writes: 0 };
  function detailNode(attributes) {
    const attrs = new Map([...attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match => [match[1], decode(match[2] || '')]));
    const dataset = Object.fromEntries([...attrs].filter(([key]) => key.startsWith('data-')).map(([key, value]) => [camel(key.slice(5)), value]));
    let open = attrs.has('open');
    const pre = { textContent: '' };
    return {
      dataset,
      get open() { return open; },
      set open(value) { if (open !== !!value) { open = !!value; pendingToggles.add(this); } },
      matches(selector) {
        if (selector.startsWith('.')) return (attrs.get('class') || '').split(/\s+/).includes(selector.slice(1));
        const required = [...selector.matchAll(/\[([\w-]+)\]/g)].map(match => match[1]);
        return required.length > 0 && required.every(key => key === 'open' ? open : attrs.has(key));
      },
      querySelector(selector) { assert.equal(selector, 'pre'); state.sourceLoads++; return pre; },
      pre
    };
  }
  const $ = id => {
    if (!nodes.has(id)) {
      const listeners = new Map(); let html = '', details = [];
      nodes.set(id, {
        id, open: false, dataset: {}, scrollTop: 0, hidden: false, textContent: '',
        classList: { add() {}, remove() {} },
        get innerHTML() { return html; },
        set innerHTML(value) {
          html = value;
          // Setting innerHTML creates fresh nodes; old open flags must never
          // survive except through the application's explicit restore logic.
          details = [...value.matchAll(/<details\b([^>]*)>/g)].map(match => detailNode(match[1]));
        },
        querySelector(selector) { return details.find(detail => detail.matches(selector)) || null; },
        querySelectorAll(selector) { return details.filter(detail => detail.matches(selector)); },
        addEventListener(name, fn) { listeners.set(name, fn); },
        dispatchToggle(target) { listeners.get('toggle')?.({ target }); },
        close() { this.open = false; }
      });
    }
    return nodes.get(id);
  };
  let context;
  const records = () => core.project(context.payload.bundle);
  context = vm.createContext({
    ...core, visitBriefForStore, storeIdentityPending, $, JSON, Set, Date,
    payload: { bundle: makeFixture(core) }, singleStoreContext: null, insightsPreview: null,
    all: type => records().filter(record => record.type === type),
    by: (type, id) => records().find(record => record.type === type && record.id === id),
    dateText: value => value,
    storeAttendanceHTML: () => '', storeMergeOriginsHTML: () => '', singleStoreCaptureHTML: () => '', singleStoreIdleActions: () => '',
    inlineVisitTextHTML: visit => `<pre>${vm.runInContext('esc', context)(visit.text)}</pre>`,
    prepareBriefSearch() {}, refreshBriefSearch() {}, setReviewMode() {},
    toast: message => { throw new Error(message); },
    openDialog: dialog => { state.dialogOpens++; dialog.open = true; $('review-body').scrollTop = 0; },
    requestAnimationFrame: fn => frames.push(fn),
    persist: () => { state.writes++; throw new Error('Disclosure rendering must not persist'); }
  });
  vm.runInContext(source('const esc = ', 'const titles =')
    + source('function storeOriginalTextFields(', 'function visitStoreNameText(')
    + source('const INSIGHT_REVIEW_LABELS = ', 'function assertInsightReviewReady(')
    + source('function openVisitBrief(', 'function canonicalPerson(')
    + source("$('review-body').addEventListener('toggle'", "$('review').addEventListener('close', () => { if (!$('review').open) clearStoreMergePreview(); });"), context);
  const flush = () => {
    while (frames.length) frames.shift()();
    for (const node of pendingToggles) $('review-body').dispatchToggle(node);
    pendingToggles.clear();
  };
  const open = (storeId, options) => { context.openVisitBrief(storeId, options); flush(); };
  const find = (attribute, value) => {
    const node = $('review-body').querySelectorAll(`[${attribute}]`).find(detail => detail.dataset[camel(attribute.slice(5))] === value);
    assert.ok(node, `Missing detail ${attribute}=${value}`); return node;
  };
  const review = (storeId, entryId, status) => {
    const store = context.by('store', storeId);
    context.payload.bundle = core.applyInsightReview(context.payload.bundle, core.planInsightReview(context.payload.bundle, storeId, entryId, status, store.heads[0].id), 'synthetic-disclosure-test');
  };
  return { context, $, state, open, find, flush, review };
}

test('confirming a card closes its new outer disclosure while preserving already-open evidence and original notes', () => {
  const h = harness(), storeId = 'qa-insight-b', entryId = 'qa-pending-customer';
  h.open(storeId);
  const oldEvidence = h.find('data-insight-detail', entryId), oldSource = h.find('data-insight-detail', entryId + ':0');
  oldEvidence.open = true; oldSource.open = true; h.flush();
  assert.equal(h.$('review-body').querySelectorAll('[data-insight-confirmed]').length, 0);
  h.$('review-body').scrollTop = 321;
  h.review(storeId, entryId, 'confirmed');
  const afterExplicitReview = JSON.stringify(h.context.payload.bundle);
  h.open(storeId, { preservePosition: true });
  const outer = h.find('data-insight-confirmed', entryId), evidence = h.find('data-insight-detail', entryId), source = h.find('data-insight-detail', entryId + ':0');
  assert.equal(outer.open, false, 'The identical entry ID in the evidence namespace must not open the confirmed card');
  assert.equal(evidence.open, true); assert.equal(source.open, true);
  assert.notEqual(evidence, oldEvidence, 'Assertions must inspect newly rendered nodes');
  assert.equal(source.pre.textContent, h.context.by('visit', 'qa-insight-note-b').text);
  assert.equal(h.$('review-body').querySelector('.brief-history').open, true);
  assert.equal(h.$('review-body').scrollTop, 321);
  assert.equal(h.state.dialogOpens, 1);
  assert.equal(JSON.stringify(h.context.payload.bundle), afterExplicitReview); assert.equal(h.state.writes, 0);
});

test('manual confirmed expansion survives a same-store refresh without opening other cards or creating data', () => {
  const h = harness(), storeId = 'qa-insight-a', first = 'qa-confirmed-relationship', second = 'qa-confirmed-customer';
  const before = JSON.stringify(h.context.payload.bundle);
  h.open(storeId);
  assert.equal(h.find('data-insight-confirmed', first).open, false);
  assert.equal(h.find('data-insight-confirmed', second).open, false);
  h.find('data-insight-confirmed', first).open = true;
  h.find('data-insight-detail', first).open = true;
  h.find('data-insight-detail', first + ':0').open = true; h.flush();
  const loaded = h.find('data-insight-detail', first + ':0').pre.textContent;
  assert.equal(loaded, h.context.by('visit', 'qa-insight-note-a').text);
  h.$('review-body').scrollTop = 212;
  h.open(storeId, { preservePosition: true });
  assert.equal(h.find('data-insight-confirmed', first).open, true);
  assert.equal(h.find('data-insight-confirmed', second).open, false);
  assert.equal(h.find('data-insight-detail', first + ':0').pre.textContent, loaded);
  assert.equal(h.$('review-body').scrollTop, 212);
  h.find('data-insight-confirmed', first).open = false; h.flush();
  h.open(storeId, { preservePosition: true });
  assert.equal(h.find('data-insight-confirmed', first).open, false, 'Manual collapse also survives the current-view refresh');
  assert.equal(JSON.stringify(h.context.payload.bundle), before); assert.equal(h.state.writes, 0);
});

test('fresh opening and closing/reopening discard temporary expansion even when preservation was requested', () => {
  const h = harness(), storeId = 'qa-insight-a', entryId = 'qa-confirmed-relationship';
  const before = JSON.stringify(h.context.payload.bundle);
  for (const reopen of [() => h.open(storeId), () => { h.$('review').close(); h.open(storeId, { preservePosition: true }); }, () => { h.open('qa-insight-b', { preservePosition: true }); h.open(storeId, { preservePosition: true }); }]) {
    h.open(storeId);
    h.find('data-insight-confirmed', entryId).open = true;
    h.find('data-insight-detail', entryId).open = true;
    h.find('data-insight-detail', entryId + ':0').open = true; h.flush();
    h.$('review-body').scrollTop = 888;
    reopen();
    assert.equal(h.find('data-insight-confirmed', entryId).open, false);
    assert.equal(h.find('data-insight-detail', entryId).open, false);
    assert.equal(h.find('data-insight-detail', entryId + ':0').open, false);
    assert.equal(h.find('data-insight-detail', entryId + ':0').pre.textContent, '');
    assert.equal(h.$('review-body').scrollTop, 0);
  }
  assert.equal(JSON.stringify(h.context.payload.bundle), before); assert.equal(h.state.writes, 0);
});

test('opening a confirmed wrapper does not load original text; source expansion still checks the exact current revision', () => {
  const h = harness(), storeId = 'qa-insight-a', entryId = 'qa-confirmed-relationship';
  h.open(storeId);
  const originalText = h.context.by('visit', 'qa-insight-note-a').text;
  h.find('data-insight-confirmed', entryId).open = true; h.flush();
  assert.equal(h.state.sourceLoads, 0);
  const source = h.find('data-insight-detail', entryId + ':0');
  assert.equal(source.pre.textContent, '');
  source.open = true; h.flush();
  assert.equal(source.pre.textContent, originalText);
  source.open = false; h.flush();
  const current = h.context.by('visit', 'qa-insight-note-a');
  h.context.payload.bundle.ops.push(core.revision('visit', current.id, { ...current.heads[0].data, text: 'Synthetic changed source.' }, current.heads.map(head => head.id), 'synthetic-concurrent'));
  const afterConcurrentUpdate = JSON.stringify(h.context.payload.bundle);
  source.open = true; h.flush();
  assert.notEqual(source.pre.textContent, originalText);
  assert.match(source.pre.textContent, /來源已改變/);
  assert.equal(JSON.stringify(h.context.payload.bundle), afterConcurrentUpdate); assert.equal(h.state.writes, 0);
});

test('updated sources keep confirmed headlines visible with an external notice and lazy exact historical text', () => {
  const h = harness(), storeId = 'qa-insight-a', entryId = 'qa-confirmed-relationship';
  const current = h.context.by('visit', 'qa-insight-note-a'), original = current.text;
  h.context.payload.bundle.ops.push(core.revision('visit', current.id, { ...current.heads[0].data, text: 'Synthetic replacement with no quoted evidence.' }, current.heads.map(head => head.id), 'synthetic-update'));
  const before = JSON.stringify(h.context.payload.bundle);
  h.open(storeId);
  const html = h.$('review-body').innerHTML, outer = h.find('data-insight-confirmed', entryId);
  assert.equal(outer.open, false);
  assert.match(html, /<\/details><p class="insight-source-notice" role="note">來源已更新/);
  const currentCards = html.slice(html.indexOf('<section class="store-insights"'), html.indexOf('<details class="insight-review-archive"'));
  assert.doesNotMatch(currentCards, /data-insight-review=/);
  assert.match(currentCards, /歷史版本/);
  const source = h.find('data-insight-detail', entryId + ':0');
  assert.equal(source.pre.textContent, '');
  outer.open = true; h.find('data-insight-detail', entryId).open = true; source.open = true; h.flush();
  assert.equal(source.pre.textContent, original);
  assert.notEqual(source.pre.textContent, h.context.by('visit', current.id).text);
  assert.equal(JSON.stringify(h.context.payload.bundle), before); assert.equal(h.state.writes, 0);
});

test('historical source disclosure rechecks a removed card and never substitutes another source version', () => {
  const h = harness(), storeId = 'qa-insight-a', entryId = 'qa-confirmed-relationship';
  const visit = h.context.by('visit', 'qa-insight-note-a');
  h.context.payload.bundle.ops.push(core.revision('visit', visit.id, { ...visit.heads[0].data }, visit.heads.map(head => head.id), 'synthetic-update'));
  h.open(storeId);
  const source = h.find('data-insight-detail', entryId + ':0');
  const store = h.context.by('store', storeId), data = structuredClone(store.heads[0].data);
  data.preVisitInsights.entries = data.preVisitInsights.entries.filter(entry => entry.id !== entryId);
  h.context.payload.bundle.ops.push(core.revision('store', storeId, data, store.heads.map(head => head.id), 'synthetic-withdrawal'));
  const before = JSON.stringify(h.context.payload.bundle);
  source.open = true; h.flush();
  assert.match(source.pre.textContent, /無法核實/);
  assert.notEqual(source.pre.textContent, visit.text);
  h.open(storeId);
  assert.equal(h.$('review-body').querySelectorAll('[data-insight-confirmed]').some(detail => detail.dataset.insightConfirmed === entryId), false);
  assert.equal(JSON.stringify(h.context.payload.bundle), before); assert.equal(h.state.writes, 0);
});
