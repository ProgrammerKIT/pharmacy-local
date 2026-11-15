import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createCSVImport } from '../public/csv-ui.js';
import { emptyBundle, revision, project, validateBundle, b64 } from '../public/core.js';
import { PROFILE_FIELDS, FILL_FIELDS, scanQuality, setDistinctReview, sourceSuggestions, fillProfile, prepareCSV, planCSV, csvSourceSupplements, sourceListKey, csvExclusionList } from '../public/csv.js';
import { groupCSVNotes, sourceTags, storeIdentityPending, relationVisitAllowed, evidenceKind, entityRule } from '../public/relations.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
test('actual exploration functions keep pending-store text visible locally and out of topic, person and tag graphs',()=>{
  const store=(id,pending)=>({id,type:'store',name:id,csvIdentityPending:pending,csvSources:[{headers:['標籤'],cells:['虛構標籤']}]});
  const visit=(id,store)=>({id,type:'visit',store,date:'',text:id,topics:['t'],people:['p'],attachments:[]});
  const records=[store('pending',true),store('confirmed',false),{id:'t',type:'topic',name:'虛構主題'},{id:'tag',type:'topic',name:'虛構標籤',csvTag:'虛構標籤'},{id:'p',type:'person',name:'虛構人物',confirmed:true},visit('pending-text','pending'),visit('confirmed-text','confirmed')];
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',clientWidth:800,style:{},setAttribute(){}});return nodes.get(id);};
  const ctx=vm.createContext({supervisedStores:()=>[],storeSupervisionHTML:()=>'',supervisorProfileHTML:()=>'',supervisorOriginStore:'',records,focus:{type:'store',id:'pending'},payload:{},activeView:'explore',graphPage:0,groupCSVNotes,sourceTags,storeIdentityPending,relationVisitAllowed,evidenceKind,entityRule,esc,kinds:{store:'門市',topic:'主題',person:'人物'},$:node,all:type=>records.filter(r=>r.type===type),by:(type,id)=>records.find(r=>r.type===type&&r.id===id),canonicalPerson:id=>id});
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
test('busy state preserves disabled controls when a preview replaces the DOM', () => {
  let elements = [{ disabled: false, dataset: {} }, { disabled: true, dataset: {} }, { disabled: false, dataset: { close: 'review' } }].map(el=>({...el,closest:()=>null}));
  const c = vm.createContext({ $: () => null, weeklyState: null, document: { querySelectorAll: () => elements }, updateBackupControls: () => {}, refreshBriefSearch: () => {} });
  vm.runInContext(app.slice(app.indexOf('function buttons('), app.indexOf('async function run(')), c);
  c.buttons(true); assert.equal(elements[0].disabled, true); assert.equal(elements[2].disabled, false);
  elements.push({ disabled: true, dataset: {}, closest:()=>null }); // Newly rendered unresolved import.
  c.buttons(false); assert.equal(elements[0].disabled, false); assert.equal(elements[1].disabled, true); assert.equal(elements[3].disabled, true);
  assert.equal(elements[0].dataset.busyDisabled, undefined);
});
test('quality UI renders escaped evidence, persists and withdraws decisions, and saves only confirmed blanks', async () => {
  const b = bundle(), first = b.ops[0];
  b.ops.push(revision('store', 's1', { ...first.data, address: '乙地址' }, [], 'mac'));
  const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', value: '', textContent: '', open: false, showModal() { this.open = true; }, close() { this.open = false; } }); return nodes.get(id); };
  const c = vm.createContext({ $, structuredClone, project, validateBundle, PROFILE_FIELDS, FILL_FIELDS, scanQuality, setDistinctReview, sourceSuggestions, fillProfile, esc,
    payload: { bundle: b, device: 'phone' }, records: project(b), qualityTab: 'duplicates', qualityField: '', qualityPage: 0, qualityCache: null, qualityReview: null, editorContext: null,
    sourceButton: () => '', input: (id, label) => { $(id); return '<label>' + esc(label) + '</label>'; }, openDialog: dialog => dialog.showModal(), toast: () => {}, confirm: () => true,
    confirmStoreSave:async()=>({}), quickTextParents:record=>record.heads.map(head=>head.id).sort() });
  c.by = (type, id) => c.records.find(r => r.type === type && r.id === id);
  c.name=(type,id)=>c.by(type,id)?.name || '';
  vm.runInContext(app.slice(app.indexOf('function assertSaveParents('),app.indexOf('function finishAttendancePrompt(')),c);
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

test('source viewer shows later adopted columns for a note even when the enclosing CSV bytes change', () => {
  const source = (blob, list, supplements) => ({ blob, fingerprint: 'same-row', list, file: 'fictional.csv', line: 2, at: '2026-10-25', headers: ['備註', '電話'], cells: ['舊原文', '<虛構電話>'], supplements });
  const old = source('old-file', '虛構清單', []), adopted = source('changed-file', '虛構清單.csv', [{ column: 1, header: '電話', text: '<虛構電話>' }]);
  const r = { type: 'visit', id: 'visit', store: 'store', csvSources: [old], versions: [{ data: { csvSources: [old] } }] };
  const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); };
  const ctx = vm.createContext({ by: type => type === 'visit' ? r : { csvSources: [adopted] }, $, esc, dateText: x => x, openDialog() {}, csvSourceSupplements, sourceListKey, csvExclusionList });
  vm.runInContext(app.slice(app.indexOf('function openSources('), app.indexOf('const input =', app.indexOf('function openSources('))), ctx);
  vm.runInContext('openSources("visit", "visit")', ctx);
  assert.match($('review-body').innerHTML, /已納入的來源補充 · 1 欄/);
  assert.match($('review-body').innerHTML, /&lt;虛構電話&gt;/);
  assert.match($('review-body').innerHTML, /data-csv-download="old-file"/);
  assert.match($('review-body').innerHTML, /data-csv-download="changed-file"/);
});
