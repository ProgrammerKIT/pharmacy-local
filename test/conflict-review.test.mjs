import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emptyBundle, revision, project, validateBundle, diffTextSegments, newMeta, derive, seal, unseal, merge } from '../public/core.js';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
function fixture(extra = false) {
  const b = emptyBundle('synthetic-conflict');
  b.ops.push(revision('store', 's', { name:'虛構門市', city:'', district:'', channel:'', attr:'', contact:'', address:'', mapUrl:'' }, [], 'mac'));
  const data = { store:'s', date:'2026-09-23', source:'現場觀察', text:'共同原文\n舊句', next:'', topics:[], people:[], attachments:[] };
  const original = revision('visit', 'v', data, [], 'mac'); b.ops.push(original);
  const a = revision('visit', 'v', {...data, text:'共同原文\n手機新增 <script>秘密</script>'}, [original.id], 'phone');
  const z = revision('visit', 'v', {...data, text:'共同原文\nMac 新增', next:'詢問庫存'}, [original.id], 'mac'); b.ops.push(a,z);
  if(extra) b.ops.push(revision('visit','v', {...data,text:'第三個版本'},[original.id],'other'));
  return { b, a, z, original };
}
function harness(f = fixture()) {
  const nodes = new Map(); const $ = id => { if(!nodes.has(id)) nodes.set(id, {innerHTML:'', textContent:'', value:'', files:[], open:false, insertAdjacentHTML(position,html){this.innerHTML=html+this.innerHTML;}, showModal(){this.open=true;}, close(){this.open=false;} }); return nodes.get(id); };
  const c = vm.createContext({ $, esc, structuredClone, project, revision, validateBundle, diffTextSegments, clearTimeout,
    payload:{bundle:f.b,device:'phone',dirty:false,draft:null}, records:project(f.b), versionReview:null,resolutionPreview:null,editorContext:null,draftTimer:null,
    dateText:x=>x, name:()=> '虛構名稱', toast:()=>{}, persistCalls:0,
    document:{querySelectorAll:()=>[]}, flushVisitDraft:async()=>{}, uuid:()=> 'new-store' });
  c.by=(type,id)=>c.records.find(r=>r.type===type&&r.id===id); c.all=type=>c.records.filter(r=>r.type===type);
  c.persist=async next=>{c.payload=next;c.persistCalls++;};c.render=()=>{c.records=project(c.payload.bundle);};c.run=async fn=>fn();
  c.openEditor=(type,id)=>{const r=c.by(type,id);c.editorContext={type,id,parents:r.heads.map(h=>h.id),oldData:structuredClone(r.heads[0].data)};$('editor').showModal();};
  vm.runInContext(app.slice(app.indexOf('function diffSegmentsHTML('),app.indexOf('function renderQuickTextDialog('))+app.slice(app.indexOf('async function saveEditor('),app.indexOf('async function removeEntity(')),c);
  return { c,$,...f };
}
test('comparison highlights fields, escapes raw text, supports three heads and never writes',async()=>{
  const h=harness(fixture(true));const before=JSON.stringify(h.b);h.c.openReview('visit','v',true);
  assert.match(h.$('review-body').innerHTML,/下次跟進/);assert.match(h.$('review-body').innerHTML,/quick-diff-/);
  assert.doesNotMatch(h.$('review-body').innerHTML,/<script>/);assert.match(h.$('review-body').innerHTML,/&lt;script&gt;/);
  assert.match(h.$('review-body').innerHTML,/3 個版本待核對/);
  h.c.versionReview.baseline=h.z.id;h.c.renderConflictReview();
  assert.equal(JSON.stringify(h.b),before);assert.equal(h.c.persistCalls,0);
});
test('adoption previews first, then adds one resolving revision with all parents and full history',async()=>{
  const h=harness();h.c.openReview('visit','v',true);await h.c.useVersion(h.a.id);
  assert.equal(h.c.persistCalls,0);assert.match(h.$('review-body').innerHTML,/預計保存的完整內容/);
  const old=structuredClone(h.b);await h.c.confirmResolution();
  assert.equal(h.c.persistCalls,1);assert.equal(h.c.payload.bundle.ops.length,old.ops.length+1);
  assert.deepEqual(h.c.payload.bundle.ops.slice(0,-1),old.ops);
  const v=project(h.c.payload.bundle).find(r=>r.id==='v');assert.equal(v.conflict,false);assert.equal(v.text,h.a.data.text);
  assert.deepEqual([...v.heads[0].parents].sort(),[h.a.id,h.z.id].sort());
  const meta=newMeta(),key=await derive('synthetic-backup-password',meta);
  const restored=await unseal(await seal(h.c.payload.bundle,key,meta),key);
  assert.deepEqual(restored,h.c.payload.bundle);
  assert.equal(project(merge(restored,old)).find(r=>r.id==='v').conflict,false);
});
test('stale preview, including a newly received third head, cannot write',async()=>{
  const h=harness();h.c.openReview('visit','v',true);await h.c.useVersion(h.a.id);
  h.c.payload.bundle.ops.push(revision('visit','v',{...h.original.data,text:'新到達'},[h.original.id],'third'));
  await assert.rejects(()=>h.c.confirmResolution(),/已有新版本/);assert.equal(h.c.persistCalls,0);
});
test('pending draft blocks adoption and merge entry',async()=>{
  const h=harness();h.c.openReview('visit','v',true);h.c.payload.draft={id:'v'};
  await assert.rejects(()=>h.c.useVersion(h.a.id),/未完成草稿/);
  assert.throws(()=>h.c.editMerge(h.a.id),/未完成草稿/);assert.equal(h.c.persistCalls,0);
});
test('deletion state is explicit and nothing is deleted before final confirmation',async()=>{
  const f=fixture();f.z.deleted=true;const h=harness(f);h.c.openReview('visit','v',true);
  assert.match(h.$('review-body').innerHTML,/刪除狀態不同/);await h.c.useVersion(h.z.id);
  assert.equal(h.c.persistCalls,0);assert.match(h.$('review-body').innerHTML,/確定移到回收桶/);
  await h.c.confirmResolution();assert.equal(project(h.c.payload.bundle).find(r=>r.id==='v').deleted,true);
  assert.equal(h.c.payload.bundle.ops.length,5);
});
test('actual merge editor save previews combined text before committing or clearing draft',async()=>{
  const h=harness();h.c.openReview('visit','v',true);h.c.editMerge(h.a.id);
  for(const [id,value] of Object.entries({'f-store':'s','f-date':'2026-09-23','f-source':'現場觀察','f-text':'手機新增\nMac 新增','f-next':'詢問庫存'}))h.$(id).value=value;
  h.c.payload.draft={id:'v'};
  await h.c.saveEditor({preventDefault(){}});
  assert.equal(h.c.persistCalls,0);assert.ok(h.c.payload.draft);assert.equal(h.c.resolutionPreview.fromEditor,true);
  h.$('review').close();assert.equal(h.c.persistCalls,0);assert.equal(h.$('editor').open,true);
  await h.c.saveEditor({preventDefault(){}});await h.c.confirmResolution();
  assert.equal(h.c.payload.draft,null);assert.equal(project(h.c.payload.bundle).find(r=>r.id==='v').text,'手機新增\nMac 新增');
});
test('failed persistence keeps the conflict, preview, and draft available for retry',async()=>{
  const h=harness();h.c.openReview('visit','v',true);await h.c.useVersion(h.a.id);
  h.c.persist=async()=>{throw new Error('disk full');};await assert.rejects(()=>h.c.confirmResolution(),/disk full/);
  assert.ok(h.c.resolutionPreview);assert.equal(project(h.c.payload.bundle).find(r=>r.id==='v').conflict,true);
});
test('history restore also previews and retains current content as history',async()=>{
  const h=harness();h.c.openReview('visit','v',false);await h.c.useVersion(h.original.id);
  assert.equal(h.c.persistCalls,0);await h.c.confirmResolution();
  const v=project(h.c.payload.bundle).find(r=>r.id==='v');assert.equal(v.text,h.original.data.text);assert.equal(v.versions.length,4);
});

test('safe merge preview combines changes made to different ordinary fields and writes only after confirmation',async()=>{
  const b=emptyBundle('synthetic-safe-merge');
  b.ops.push(revision('store','s',{name:'虛構門市',city:'',district:'',channel:'',attr:'',contact:'',address:'',mapUrl:''},[],'mac'));
  const data={store:'s',date:'2026-09-26',source:'現場觀察',text:'原始拜訪文字',next:'',topics:[],people:[],attachments:[]};
  const base=revision('visit','safe',data,[],'mac');b.ops.push(base);
  const phone=revision('visit','safe',{...data,text:'手機補上拜訪文字'},[base.id],'phone');
  const mac=revision('visit','safe',{...data,next:'Mac 補上下次跟進'},[base.id],'mac');b.ops.push(phone,mac);
  const h=harness({b,original:base,a:phone,z:mac});h.c.openReview('visit','safe',true);
  assert.match(h.$('review-body').innerHTML,/安全合併預覽可用/);
  const plan=h.c.safeConflictMerge(h.c.by('visit','safe'));
  assert.equal(plan.safe,true);assert.equal(plan.data.text,'手機補上拜訪文字');assert.equal(plan.data.next,'Mac 補上下次跟進');
  h.c.previewSafeConflictMerge();assert.equal(h.c.persistCalls,0);assert.match(h.$('review-body').innerHTML,/預計保存的完整內容/);
  await h.c.confirmResolution();assert.equal(h.c.persistCalls,1);
  const saved=project(h.c.payload.bundle).find(r=>r.id==='safe');assert.equal(saved.conflict,false);assert.equal(saved.text,'手機補上拜訪文字');assert.equal(saved.next,'Mac 補上下次跟進');
});

test('safe merge preview refuses overlapping edits, deletions, and protected evidence fields',()=>{
  const overlap=harness();overlap.c.openReview('visit','v',true);
  assert.equal(overlap.c.safeConflictMerge(overlap.c.by('visit','v')).safe,false);
  assert.match(overlap.$('review-body').innerHTML,/不提供自動合併建議/);

  const deletedFixture=fixture();deletedFixture.z.deleted=true;const deleted=harness(deletedFixture);
  assert.equal(deleted.c.safeConflictMerge(deleted.c.by('visit','v')).safe,false);

  const protectedFixture=fixture();protectedFixture.a.data={...protectedFixture.original.data,attachments:[{blob:'a'.repeat(64),name:'證據.pdf',mime:'application/pdf'}]};
  protectedFixture.b.blobs['a'.repeat(64)]='YQ==';protectedFixture.z.data={...protectedFixture.original.data,next:'後續'};
  const protectedHarness=harness(protectedFixture);
  assert.equal(protectedHarness.c.safeConflictMerge(protectedHarness.c.by('visit','v')).safe,false);
});
