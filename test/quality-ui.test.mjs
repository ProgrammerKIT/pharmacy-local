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
// Event and rendering harness: real import UI, CSV parser and persistence result.
// This deliberately does not claim browser layout or Safari coverage.
function importUI(b = bundle(), importMode = 'standard') {
  const nodes = new Map(), handlers = {}, saved = [], prompts = [], messages = [], reports = [];
  const state = { bundle: b, device: 'phone' };
  let errors = [], accepted = true, onConfirm = null;
  function node(id = '') {
    let html = ''; const events = {};
    return { open: false, addEventListener(type, fn) { events[type] = fn; }, showModal() { this.open = true; }, close() { this.open = false; events.close?.(); }, dispatch(type) { events[type]?.({ preventDefault() {} }); }, id, dataset: {}, disabled: false, value: '', textContent: '',
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
  globalThis.confirm = text => { prompts.push(text); onConfirm?.(); return accepted; };
  const ui = createCSVImport({ host, getState: () => state,
    run: async fn => { try { await fn(); } catch (e) { errors.push(e.message); } },
    saveBundle: async next => { saved.push(next); state.bundle = next; }, notify: text => messages.push(text), exportReport: report => reports.push(report) });
  const change = target => handlers.change({ target: { dataset: {}, ...target } });
  const click = id => handlers.click({ target: { id, closest() { return this; } } });
  if (importMode === 'standard') change({ id: 'csv-import-mode', value: 'standard' });
  return { ui, nodes, state, saved, prompts, messages, reports, change, click,
    onConfirm: fn => onConfirm = fn, errors: () => errors, reject: () => accepted = false, accept: () => accepted = true,
    preview: () => nodes.get('#csv-preview').innerHTML,
    read: async text => { if (importMode === 'standard') await change({ id: 'csv-import-mode', value: 'standard' }); const bytes = new TextEncoder().encode(text); await change({ id: 'csv-files', files: [{ name: '虛構.csv', size: bytes.length, arrayBuffer: async () => bytes.buffer }] }); await click('csv-preview-button'); },
    cleanup: () => { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; if (oldConfirm === undefined) delete globalThis.confirm; else globalThis.confirm = oldConfirm; },
  };
}
test('new-only UI defaults to unselected candidates and cannot select existing or review rows', async t => {
  const h = importUI(bundle(), 'new-only'); t.after(h.cleanup);
  const original = structuredClone(h.state.bundle);
  await h.read('Title,Note,URL\n<測試>藥局,不應覆寫,https://maps.google.com/?cid=1234567\n虛構全新青木藥局,新店原文,https://maps.google.com/?cid=7654001\n<測試>藥局,另一分店,https://maps.google.com/?cid=7654002');
  assert.match(h.preview(), /只新增新門市/);
  assert.match(h.preview(), /已選新增 0 間/);
  assert.match(h.preview(), /data-csv-include="0:1"/);
  assert.doesNotMatch(h.preview(), /data-csv-include="0:1" checked/);
  assert.doesNotMatch(h.preview(), /data-csv-choice=/);
  await h.change({ id: 'csv-filter', value: 'all' });
  assert.match(h.preview(), /data-csv-new-status="review"/);
  assert.doesNotMatch(h.preview(), /data-csv-include="0:0"|data-csv-include="0:2"/);
  await h.change({ dataset: { csvInclude: '0:0' }, checked: true });
  await h.change({ dataset: { csvInclude: '0:2' }, checked: true });
  assert.match(h.preview(), /已選新增 0 間/);
  await h.change({ dataset: { csvInclude: '0:1' }, checked: true });
  await h.click('csv-commit'); assert.equal(h.saved.length, 0);
  assert.match(h.nodes.get('#csv-final-review').innerHTML, /虛構全新青木藥局/);
  assert.match(h.nodes.get('#csv-final-review').innerHTML, /虛構.csv · 第 3 行/);
  await h.click('csv-final-back'); assert.equal(h.saved.length, 0);
  await h.click('csv-commit'); await h.click('csv-final-apply'); assert.deepEqual(h.errors(), []); assert.equal(h.saved.length, 1);
  assert.deepEqual(h.state.bundle.ops.slice(0, original.ops.length), original.ops);
  assert.equal(project(h.state.bundle).find(r => r.id === 's0').versions.length, 1);
  assert.equal(project(h.state.bundle).filter(r => r.type === 'store').length, 2);
  assert.equal(project(h.state.bundle).find(r => r.type === 'visit').text, '新店原文');
  assert.equal(h.prompts.length, 0, 'new-only never substitutes a native count-only confirm');
});
test('new-only mode switches clear previews and choices, and reviewed packets cannot bypass the mode', async t => {
  const h = importUI(bundle(), 'new-only'); t.after(h.cleanup);
  await h.read('Title,Note,URL\n虛構全新青木藥局,新店原文,https://maps.google.com/?cid=7654001');
  await h.change({ dataset: { csvInclude: '0:0' }, checked: true });
  assert.match(h.preview(), /已選新增 1 間/);
  await h.change({ id: 'csv-import-mode', value: 'standard' }); assert.equal(h.preview(), '');
  await h.change({ id: 'csv-import-mode', value: 'new-only' });
  await h.click('csv-preview-button'); assert.match(h.preview(), /已選新增 0 間/);
  await h.change({ id: 'csv-review-file', files: [{ size: 2, text: async () => '{}' }] });
  assert.match(h.errors().at(-1), /不接受已核對資料包/);
  await h.click('csv-commit'); await h.click('csv-final-apply');
  assert.equal(project(h.state.bundle).filter(r => r.type === 'source').length, 1);
  assert.equal(project(h.state.bundle).filter(r => r.type === 'store').length, 1);
});
test('new-only selected extras require acknowledgment and old-store fill controls cannot be used', async t => {
  const h = importUI(bundle(), 'new-only'); t.after(h.cleanup);
  await h.read('Title,Note,URL,電話\n虛構新店藥局,新店原文,https://maps.google.com/?cid=7654001,<虛構補充>');
  await h.change({ dataset: { csvInclude: '0:0' }, checked: true });
  assert.match(h.preview(), /&lt;虛構補充&gt;/);
  assert.match(h.preview(), /id="csv-commit"[^>]*disabled/);
  await h.change({ dataset: { csvSupplement: '0:0' }, value: '3', checked: true });
  await h.change({ dataset: { csvAck: 'extraAccepted', row: '0:0' }, checked: true });
  await h.change({ dataset: { csvFill: '0:0' }, value: 'address', checked: true });
  await h.change({ dataset: { csvChoice: '0:0' }, value: 'store:s0' });
  await h.click('csv-commit'); await h.click('csv-final-apply'); assert.deepEqual(h.errors(), []);
  const records = project(h.state.bundle), created = records.find(r => r.type === 'store' && r.id !== 's0');
  assert.equal(created.csvSources[0].supplements[0].text, '<虛構補充>');
  assert.equal(records.find(r => r.id === 's0').csvSources, undefined);
});
test('remembered exclusions require explicit selection, are cancel-safe and can be revoked without importing', async t => {
  const h = importUI(bundle(), 'new-only'); t.after(h.cleanup);
  const text = 'Title,Address,Note,URL\n虛構排除甲,甲路1號,原文,https://maps.google.com/?cid=7654001\n虛構單純未選,乙路2號,未勾原文,https://maps.google.com/?cid=7654002';
  await h.read(text);
  await h.change({ dataset: { csvInclude: '0:0' }, checked: true });
  await h.change({ dataset: { csvExclude: '0:0' }, checked: true });
  assert.match(h.preview(), /已選新增 0 間/);
  assert.match(h.preview(), /待記住排除 1 列/);
  await h.click('csv-commit'); assert.equal(h.saved.length, 0);
  assert.match(h.nodes.get('#csv-final-review').innerHTML, /這次記住排除 · 選取 1 列／記住 1 個地點/);
  await h.click('csv-final-edit'); await h.click('csv-cancel');
  assert.equal(h.saved.length, 0); assert.deepEqual(csvExclusionList(h.state.bundle), []);
  await h.read(text); assert.match(h.preview(), /待記住排除 0 列/);
  await h.change({ dataset: { csvExclude: '0:0' }, checked: true });
  await h.click('csv-commit'); await h.click('csv-final-apply'); assert.deepEqual(h.errors(), []);
  assert.equal(csvExclusionList(h.state.bundle).length, 1);
  assert.equal(project(h.state.bundle).filter(r => r.type === 'store').length, 1);
  await h.read(text);
  assert.doesNotMatch(h.preview(), /data-csv-row="0:0"/);
  assert.match(h.preview(), /data-csv-row="0:1"/);
  await h.change({ id: 'csv-filter', value: 'remembered' });
  assert.match(h.preview(), /data-csv-new-status="remembered"/);
  const exclusion = csvExclusionList(h.state.bundle)[0];
  await h.change({ dataset: { csvRevoke: exclusion.id }, checked: true });
  await h.click('csv-commit'); assert.match(h.nodes.get('#csv-final-review').innerHTML, /這次撤銷排除 · 1 筆/);
  await h.click('csv-final-apply'); assert.deepEqual(h.errors(), []);
  assert.deepEqual(csvExclusionList(h.state.bundle), []);
  assert.equal(project(h.state.bundle).filter(r => r.type === 'store').length, 1);
  await h.read(text); assert.match(h.preview(), /data-csv-include="0:0"/);
  assert.doesNotMatch(h.preview(), /data-csv-include="0:0" checked/);
});
test('duplicate rows can be explicitly excluded while final confirmation separates row and place counts', async t => {
  const h = importUI(bundle(), 'new-only'); t.after(h.cleanup);
  const row = '虛構不要匯入,甲路1號,原文,https://maps.google.com/?cid=7654001';
  await h.read('Title,Address,Note,URL\n' + row + '\n' + row);
  await h.change({ id: 'csv-filter', value: 'all' });
  assert.match(h.preview(), /data-csv-exclude="0:1"/);
  await h.change({ dataset: { csvExclude: '0:0' }, checked: true });
  await h.change({ dataset: { csvExclude: '0:1' }, checked: true });
  await h.click('csv-commit');
  assert.match(h.nodes.get('#csv-final-review').innerHTML, /選取 2 列／記住 1 個地點/);
  assert.equal((h.nodes.get('#csv-final-review').innerHTML.match(/data-csv-final-row=/g) || []).length, 2);
  await h.click('csv-final-apply'); assert.deepEqual(h.errors(), []);
  assert.equal(csvExclusionList(h.state.bundle).length, 1);
  assert.equal(project(h.state.bundle).filter(r => r.type === 'store').length, 1);
});
test('final per-store confirmation rejects changed bundle, session, selection, mapping and reset', async t => {
  for (const mutation of ['bundle', 'device', 'token', 'choice', 'mapping', 'reset', 'hidden']) {
    const h = importUI(bundle(), 'new-only');
    try {
      await h.read('Title,Address,Note,URL\n<虛構 & 新店>,甲路1號,文字,https://maps.google.com/?cid=7654001');
      await h.change({ dataset: { csvInclude: '0:0' }, checked: true });
      await h.click('csv-commit');
      const final = h.nodes.get('#csv-final-review').innerHTML;
      assert.match(final, /&lt;虛構 &amp; 新店&gt;/); assert.doesNotMatch(final, /<虛構/);
      if (mutation === 'bundle') h.state.bundle = structuredClone(h.state.bundle);
      if (mutation === 'device') h.state.device = 'changed';
      if (mutation === 'token') h.state.token = 'changed';
      if (mutation === 'choice') await h.change({ dataset: { csvInclude: '0:0' }, checked: false });
      if (mutation === 'mapping') await h.change({ dataset: { csvField: 'note', file: '0' }, value: '-1' });
      if (mutation === 'reset') h.ui.reset();
      if (mutation === 'hidden') document.hidden = true;
      await h.click('csv-final-apply');
      assert.equal(h.saved.length, 0, mutation + ' must invalidate final confirmation');
      assert.match(h.errors().at(-1), /核對期間/);
    } finally { h.cleanup(); }
  }
});
test('final confirmation rebuild rejects data changed in place without writing', async t => {
  const h = importUI(bundle(), 'new-only'); t.after(h.cleanup);
  await h.read('Title,Address,Note,URL\n虛構新店,甲路1號,文字,https://maps.google.com/?cid=7654001');
  await h.change({ dataset: { csvInclude: '0:0' }, checked: true });
  await h.click('csv-commit');
  h.state.bundle.ops.push(revision('store', 'concurrent-store', { ...h.state.bundle.ops[0].data, name: '虛構同期新增門市', mapUrl: 'https://maps.google.com/?cid=7890101' }, [], 'other-device'));
  await h.click('csv-final-apply');
  assert.equal(h.saved.length, 0);
  assert.match(h.errors().at(-1), /資料已變更/);
  assert.equal(h.nodes.get('#csv-final-review').open, false);
});
test('closing the final dialog preserves editing choices and never saves', async t => {
  const h = importUI(bundle(), 'new-only'); t.after(h.cleanup);
  await h.read('Title,Note,URL\n虛構新店,文字,https://maps.google.com/?cid=7654001');
  await h.change({ dataset: { csvInclude: '0:0' }, checked: true });
  await h.click('csv-commit'); h.nodes.get('#csv-final-review').dispatch('cancel');
  assert.equal(h.nodes.get('#csv-final-review').open, false); assert.equal(h.saved.length, 0);
  assert.match(h.preview(), /已選新增 1 間/);
  await h.click('csv-final-apply'); assert.equal(h.saved.length, 0);
});
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
  await h.change({dataset:{csvSupplement:key},value:'3',checked:true});
  await h.change({dataset:{csvAck:'extraAccepted',row:key},checked:true});
  assert.doesNotMatch(h.preview(),/id="csv-commit"[^>]*disabled/);
  await h.click('csv-commit'); assert.equal(h.saved.length,1);
  assert.equal(project(h.saved[0]).find(r=>r.type==='visit').csvSources[0].supplements[0].text,'<額外文字>');
});
test('CSV choices keep unchecked extras raw-only, allow later adoption, and reset confirmation on edits', async t => {
  const h = importUI(); t.after(h.cleanup);
  const csv = 'Title,Note,URL,電話,電話\n<測試>藥局,原文,https://maps.google.com/?cid=1234567,虛構甲,虛構乙';
  await h.read(csv);
  const key = h.preview().match(/data-csv-choice="([^"]+)"/)[1];
  await h.change({ dataset: { csvSupplement: key }, value: '3', checked: true });
  await h.change({ dataset: { csvAck: 'extraAccepted', row: key }, checked: true });
  await h.change({ dataset: { csvSupplement: key }, value: '4', checked: true });
  assert.match(h.preview(), /id="csv-commit"[^>]*disabled/);
  await h.change({ dataset: { csvSupplement: key }, value: '4', checked: false });
  await h.change({ dataset: { csvAck: 'extraAccepted', row: key }, checked: true });
  await h.click('csv-commit');
  const before = project(h.state.bundle).find(r => r.type === 'visit');
  assert.deepEqual(project(h.state.bundle).find(r => r.type === 'store').csvSources.at(-1).supplements.map(f => f.column), [3]);
  await h.read(csv);
  assert.match(h.preview(), /已納入的來源補充/);
  assert.match(h.preview(), /尚未納入的其他文字欄 · 1 欄/);
  assert.doesNotMatch(h.preview(), /data-csv-supplement="0:0" value="3"/);
  await h.change({ dataset: { csvSupplement: '0:0' }, value: '4', checked: true });
  await h.change({ dataset: { csvAck: 'extraAccepted', row: '0:0' }, checked: true });
  await h.click('csv-commit');
  assert.deepEqual(project(h.state.bundle).find(r => r.type === 'visit'), before);
  assert.deepEqual(h.errors(), []);
});
test('CSV confirmation rejects a changed bundle and preserves the unfinished selection', async t => {
  const h = importUI(); t.after(h.cleanup);
  await h.read('Title,Note,URL\n<測試>藥局,原文,https://maps.google.com/?cid=1234567');
  h.onConfirm(() => { h.state.bundle = structuredClone(h.state.bundle); });
  await h.click('csv-commit');
  assert.equal(h.saved.length, 0);
  assert.match(h.errors().at(-1), /確認期間資料或工作階段已變更/);
  assert.equal(h.ui.hasPending(), true);
  assert.equal(h.messages.some(message => /已加密匯入/.test(message)), false);
});
test('CSV row checkboxes skip without discarding the original file and target changes clear choices', async t => {
  const h = importUI(); t.after(h.cleanup);
  await h.read('Title,Note,URL,留言\n<測試>藥局,原文,https://maps.google.com/?cid=1234567,補充');
  await h.change({ dataset: { csvSupplement: '0:0' }, value: '3', checked: true });
  await h.change({ dataset: { csvAck: 'extraAccepted', row: '0:0' }, checked: true });
  await h.change({ dataset: { csvInclude: '0:0' }, checked: false });
  assert.match(h.preview(), /已選來源補充 0 項/);
  await h.change({ dataset: { csvInclude: '0:0' }, checked: true });
  assert.match(h.preview(), /id="csv-commit"[^>]*disabled/);
  assert.doesNotMatch(h.preview(), /data-csv-supplement="0:0" value="3" checked/);
  await h.change({ dataset: { csvInclude: '0:0' }, checked: false });
  await h.click('csv-commit');
  assert.equal(project(h.state.bundle).filter(r => r.type === 'source').length, 1);
  assert.equal(project(h.state.bundle).filter(r => r.type === 'visit').length, 0);
  assert.equal(project(h.state.bundle).find(r => r.type === 'store').csvSources, undefined);
  assert.deepEqual(h.errors(), []);
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
