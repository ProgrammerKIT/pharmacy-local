import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createCSVImport } from '../public/csv-ui.js';
import { emptyBundle, revision, project, b64 } from '../public/core.js';
import { PROFILE_FIELDS, FILL_FIELDS, scanQuality, setDistinctReview, sourceSuggestions, fillProfile, prepareCSV, planCSV } from '../public/csv.js';
import { groupCSVNotes, sourceTags, storeIdentityPending, relationVisitAllowed, evidenceKind, entityRule } from '../public/relations.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
test('actual exploration functions keep pending-store text visible locally and out of topic, person and tag graphs',()=>{
  const store=(id,pending)=>({id,type:'store',name:id,csvIdentityPending:pending,csvSources:[{headers:['標籤'],cells:['虛構標籤']}]});
  const visit=(id,store)=>({id,type:'visit',store,date:'',text:id,topics:['t'],people:['p'],attachments:[]});
  const records=[store('pending',true),store('confirmed',false),{id:'t',type:'topic',name:'虛構主題'},{id:'tag',type:'topic',name:'虛構標籤',csvTag:'虛構標籤'},{id:'p',type:'person',name:'虛構人物',confirmed:true},visit('pending-text','pending'),visit('confirmed-text','confirmed')];
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',clientWidth:800,style:{},setAttribute(){}});return nodes.get(id);};
  const ctx=vm.createContext({records,focus:{type:'store',id:'pending'},payload:{},activeView:'explore',graphPage:0,groupCSVNotes,sourceTags,storeIdentityPending,relationVisitAllowed,evidenceKind,entityRule,esc,kinds:{store:'門市',topic:'主題',person:'人物'},$:node,all:type=>records.filter(r=>r.type===type),by:(type,id)=>records.find(r=>r.type===type&&r.id===id),canonicalPerson:id=>id});
  vm.runInContext(app.slice(app.indexOf('function related('),app.indexOf('function chip('))+app.slice(app.indexOf('function drawGraph('),app.indexOf('function renderVisits(')),ctx);
  assert.equal(vm.runInContext('related()[0].text',ctx),'pending-text');
  vm.runInContext('drawGraph()',ctx);assert.equal(node('graph').innerHTML,'');assert.match(node('graph-pager').textContent,/待確認/);
  for(const focus of [{type:'topic',id:'t'},{type:'topic',id:'tag'},{type:'person',id:'p'}]) {
    ctx.focus=focus;assert.equal(vm.runInContext('related().some(v=>v.store==="pending")',ctx),false);
    vm.runInContext('drawGraph()',ctx);assert.doesNotMatch(node('graph').innerHTML,/data-node-id="pending"/);
  }
  records[0].csvIdentityPending=false;ctx.focus={type:'topic',id:'t'};
  assert.equal(vm.runInContext('related().some(v=>v.store==="pending")',ctx),true);
  vm.runInContext('drawGraph()',ctx);assert.match(node('graph').innerHTML,/data-node-id="pending"/);
});
function bundle() {
  const b = emptyBundle('synthetic-ui');
  b.ops.push(revision('store', 's0', { name: '<測試>藥局', address: '', city: '臺北市', district: '', channel: '', contact: '', attr: '', mapUrl: 'https://maps.google.com/?cid=1234567' }, [], 'mac'));
  return b;
}
// Event and rendering harness: real import UI, CSV parser and persistence result.
// This deliberately does not claim browser layout or Safari coverage.
function importUI(b = bundle()) {
  const nodes = new Map(), handlers = {}, saved = [], prompts = [], messages = [], reports = [];
  const state = { bundle: b, device: 'phone' };
  let errors = [], accepted = true;
  function node(id = '') {
    let html = '';
    return { id, dataset: {}, disabled: false, value: '', textContent: '',
      get innerHTML() { return html; },
      set innerHTML(value) { html = value; for (const match of value.matchAll(/\bid="([^"]+)"/g)) nodes.set('#' + match[1], node(match[1])); },
      replaceChildren() { html = ''; },
      insertAdjacentHTML(position, value) { this.innerHTML = html + value; },
      after(element) { nodes.set('#' + element.id, element); },
      closest() { return this; },
    };
  }
  const host = node('csv-view');
  host.querySelector = selector => nodes.get(selector) || null;
  host.addEventListener = (type, handler) => handlers[type] = handler;
  const oldDocument = globalThis.document, oldConfirm = globalThis.confirm;
  globalThis.document = { createElement: () => node() };
  globalThis.confirm = text => { prompts.push(text); return accepted; };
  const ui = createCSVImport({ host, getState: () => state,
    run: async fn => { try { await fn(); } catch (e) { errors.push(e.message); } },
    saveBundle: async next => { saved.push(next); state.bundle = next; }, notify: text => messages.push(text), exportReport: report => reports.push(report) });
  const change = target => handlers.change({ target: { dataset: {}, ...target } });
  const click = id => handlers.click({ target: { id, closest() { return this; } } });
  return { ui, nodes, state, saved, prompts, messages, reports, change, click,
    errors: () => errors, reject: () => accepted = false, accept: () => accepted = true,
    preview: () => nodes.get('#csv-preview').innerHTML,
    read: async text => { const bytes = new TextEncoder().encode(text); await change({ id: 'csv-files', files: [{ name: '虛構.csv', size: bytes.length, arrayBuffer: async () => bytes.buffer }] }); await click('csv-preview-button'); },
    cleanup: () => { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; if (oldConfirm === undefined) delete globalThis.confirm; else globalThis.confirm = oldConfirm; },
  };
}
test('CSV UI keeps fill opt-in through filtering and requires confirmation before writing', async t => {
  const h = importUI(); t.after(h.cleanup);
  await h.read('Title,Address,City,Contact,Note,URL\n<測試>藥局,甲地址,新縣市,甲窗口,<script>alert(1)</script>,https://maps.google.com/?cid=1234567');
  assert.deepEqual(h.errors(), []); assert.equal(h.saved.length, 0);
  let html = h.preview(); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /已有資料，保留既有值/); assert.match(html, /已選補值 0 項/);
  const key = html.match(/data-csv-choice="([^"]+)"/)[1];
  await h.change({ dataset: { csvFill: key }, value: 'address', checked: true });
  await h.change({ id: 'csv-filter', value: 'warnings' });
  assert.match(h.preview(), /已選補值 1 項/);
  h.reject(); await h.click('csv-commit'); assert.equal(h.saved.length, 0); assert.equal(h.ui.hasPending(), true);
  h.accept(); await h.click('csv-commit'); assert.deepEqual(h.errors(), []); assert.equal(h.saved.length, 1);
  const store = project(h.state.bundle).find(r => r.type === 'store');
  assert.equal(store.address, '甲地址'); assert.equal(store.city, '臺北市'); assert.equal(store.contact, '');
  assert.equal(project(h.state.bundle).find(r => r.type === 'visit').text, '<script>alert(1)</script>');
  assert.equal(h.ui.hasPending(), false); assert.match(h.prompts.at(-1), /補上 1 個空白欄位/);
});

test('CSV UI requires an explicit disposition for every supplementary text column', async t => {
  const h = importUI(); t.after(h.cleanup);
  await h.read('Title,筆記,URL,留言\n<測試>藥局,原文,https://maps.google.com/?cid=1234567,<額外文字>');
  const html=h.preview(); assert.match(html,/其他文字欄/); assert.match(html,/&lt;額外文字&gt;/);
  assert.match(html,/id="csv-commit"[^>]*disabled/);
  await h.click('csv-commit'); assert.equal(h.saved.length,0);
  const key=html.match(/data-csv-choice="([^"]+)"/)[1];
  await h.change({dataset:{csvAck:'extraAccepted',row:key},checked:true});
  assert.doesNotMatch(h.preview(),/id="csv-commit"[^>]*disabled/);
  await h.click('csv-commit'); assert.equal(h.saved.length,1);
  assert.equal(project(h.saved[0]).find(r=>r.type==='visit').csvSources[0].supplements[0].text,'<額外文字>');
});
test('review package UI previews locally, exports without writes, preserves group choices and requires final confirmation',async t=>{
  const h=importUI(emptyBundle('review-ui')); t.after(h.cleanup);
  const files=await Promise.all(['甲','乙'].map((name,i)=>prepareCSV('虛構'+i+'.csv',new TextEncoder().encode('Title,Note,URL\n虛構'+name+'藥局,原文'+i+',https://maps.google.com/?cid=1234567'))));
  const p=await planCSV(files,h.state.bundle);
  const packet={format:'pharmacy-csv-review-1',files:files.map(f=>({file:f.file,list:f.list,sha256:f.blob,content:b64(f.bytes)})),groups:[{id:'g',label:'虛構甲／乙藥局',pending:true,rows:p.rows.map(r=>({sha256:files[r.fileIndex].blob,line:r.line,fingerprint:r.fingerprint}))}],excluded:[]};
  const text=JSON.stringify(packet);
  await h.change({id:'csv-review-file',files:[{size:text.length,text:async()=>text}]});
  assert.deepEqual(h.errors(),[]);assert.equal(h.saved.length,0);assert.match(h.preview(),/同組來源/);assert.equal((h.preview().match(/data-csv-choice=/g)||[]).length,1);
  await h.click('csv-export-preview');assert.equal(h.reports.length,1);assert.equal(h.reports[0].imported,false);assert.equal(h.saved.length,0);
  h.reject();await h.click('csv-commit');assert.equal(h.saved.length,0);
  h.accept();await h.click('csv-commit');assert.deepEqual(h.errors(),[]);assert.equal(h.saved.length,1);assert.equal(project(h.saved[0]).filter(r=>r.type==='store').length,1);
  assert.equal(project(h.saved[0]).find(r=>r.type==='store').csvIdentityPending,true);
});
test('failed replacement package invalidates a previously ready import preview',async t=>{
  const h=importUI(); t.after(h.cleanup);
  await h.read('Title,Note,URL\n<測試>藥局,原文,https://maps.google.com/?cid=1234567');
  assert.match(h.preview(),/csv-commit/);
  await h.change({id:'csv-review-file',files:[{size:9*1024*1024,text:async()=>''}]});
  assert.equal(h.preview(),'');await h.click('csv-commit');assert.equal(h.saved.length,0);assert.match(h.errors().at(-1),/請先預覽/);
});
test('CSV UI invalidates old preview after a mapping error and never commits stale selections', async t => {
  const h = importUI(); t.after(h.cleanup);
  await h.read('Title,Note,URL\n<測試>藥局,原文,https://maps.google.com/?cid=1234567');
  assert.match(h.preview(), /csv-commit/);
  await h.change({ dataset: { csvField: 'name', file: '0' }, value: '-1' });
  await h.click('csv-preview-button'); assert.match(h.errors().at(-1), /指定藥局名稱/); assert.equal(h.preview(), '');
  await h.click('csv-commit'); assert.match(h.errors().at(-1), /請先預覽/); assert.equal(h.saved.length, 0);
});
test('CSV UI forces ambiguous stores to be resolved and resets fill choices when the target changes', async t => {
  const h = importUI(); t.after(h.cleanup);
  await h.read('Title,Address,Note\n<測試>藥局,甲地址,原文');
  let html = h.preview(); assert.match(html, /id="csv-commit"[^>]*disabled/);
  await h.click('csv-commit'); assert.equal(h.saved.length, 0); assert.match(h.errors().at(-1), /SOP1 尚未通過/);
  const key = html.match(/data-csv-choice="([^"]+)"/)[1];
  await h.change({ dataset: { csvChoice: key }, value: 'store:s0' });
  await h.change({ dataset: { csvFill: key }, value: 'address', checked: true });
  assert.match(h.preview(), /已選補值 1 項/);
  await h.change({ dataset: { csvChoice: key }, value: 'new' });
  assert.match(h.preview(), /已選補值 0 項/);
  await h.click('csv-cancel'); assert.equal(h.ui.hasPending(), false); assert.equal(h.saved.length, 0);
});
test('busy state preserves disabled controls when a preview replaces the DOM', () => {
  let elements = [{ disabled: false, dataset: {} }, { disabled: true, dataset: {} }, { disabled: false, dataset: { close: 'review' } }];
  const c = vm.createContext({ document: { querySelectorAll: () => elements } });
  vm.runInContext(app.slice(app.indexOf('function buttons('), app.indexOf('async function run(')), c);
  c.buttons(true); assert.equal(elements[0].disabled, true); assert.equal(elements[2].disabled, false);
  elements.push({ disabled: true, dataset: {} }); // Newly rendered unresolved import.
  c.buttons(false); assert.equal(elements[0].disabled, false); assert.equal(elements[1].disabled, true); assert.equal(elements[3].disabled, true);
  assert.equal(elements[0].dataset.busyDisabled, undefined);
});
test('quality UI renders escaped evidence, persists and withdraws decisions, and saves only confirmed blanks', async () => {
  const b = bundle(), first = b.ops[0];
  b.ops.push(revision('store', 's1', { ...first.data, address: '乙地址' }, [], 'mac'));
  const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', value: '', textContent: '', open: false, showModal() { this.open = true; }, close() { this.open = false; } }); return nodes.get(id); };
  const c = vm.createContext({ $, structuredClone, PROFILE_FIELDS, FILL_FIELDS, scanQuality, setDistinctReview, sourceSuggestions, fillProfile, esc,
    payload: { bundle: b, device: 'phone' }, records: project(b), qualityTab: 'duplicates', qualityField: '', qualityPage: 0, qualityCache: null, qualityReview: null, editorContext: null,
    sourceButton: () => '', input: (id, label) => { $(id); return '<label>' + esc(label) + '</label>'; }, toast: () => {}, confirm: () => true });
  c.by = (type, id) => c.records.find(r => r.type === type && r.id === id);
  c.persist = async next => { c.payload = next; };
  c.render = () => { c.records = project(c.payload.bundle); c.renderQuality(); };
  c.run = async fn => fn();
  vm.runInContext(app.slice(app.indexOf('function qualityReport('), app.indexOf('function renderStores(')) +
    app.slice(app.indexOf('async function saveEditor('), app.indexOf('function openReview(')), c);
  c.renderQuality(); assert.match($('quality-content').innerHTML, /&lt;測試&gt;/); assert.doesNotMatch($('quality-content').innerHTML, /<測試>/);
  c.openQualityPair('duplicates:0'); assert.equal($('review').open, true);
  await c.saveQualityReview(); assert.equal(scanQuality(c.records).pairs.length, 0);
  assert.match(c.describeData('store', c.records.find(r => r.id === 's0').heads[0].data), /不同門市核對：1 組/);
  c.openQualityPair('reviewed:0'); await c.saveQualityReview(); assert.equal(scanQuality(c.records).pairs.length, 1);
  c.qualityTab = 'missing'; c.qualityField = 'address'; c.renderQuality(); assert.match($('quality-content').innerHTML, /data-fill-store="s0"/);
  c.openFillStore('s0'); assert.equal(c.editorContext.fillFields.includes('city'), false);
  $('fill-address').value = '新補地址';
  const before = c.payload.bundle.ops.length;
  c.confirm = () => false; await c.saveEditor({ preventDefault() {} }); assert.equal(c.payload.bundle.ops.length, before); assert.equal($('editor').open, true);
  c.confirm = () => true; await c.saveEditor({ preventDefault() {} });
  assert.equal(c.by('store', 's0').address, '新補地址'); assert.equal(c.by('store', 's0').city, '臺北市');
  assert.equal(c.payload.bundle.ops.length, before + 1); assert.equal($('editor').open, false); assert.equal(c.editorContext, null);
});
