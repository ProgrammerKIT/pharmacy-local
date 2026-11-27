import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../public/core.js';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function harness(){
 const bundle=core.emptyBundle('fictional-supervisor-save');
 bundle.ops.push(core.revision('person','p',{name:'虛構督導',role:'督導',desc:'原筆記',relationshipNotes:'原關係資訊',confirmed:true,supervisorKey:'qa'},[],'qa'));
 bundle.ops.push(core.revision('store','s',{name:'虛構門市',city:'',district:'',channel:'',attr:'原門市文字',contact:'',nextRemember:'原待辦'},[],'qa'));
 const person=core.project(bundle).find(r=>r.type==='person'),nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:''});return nodes.get(id)};
 const c=vm.createContext({...core,$:node,structuredClone,Date,JSON,document:{hidden:false},payload:{bundle,device:'qa',token:'fictional',dirty:false},key:{},meta:{},localRevision:1,syncEpoch:0,supervisorDraftGeneration:2,editorContext:{type:'supervisor-inline',id:'p'},pendingLock:false,updateHolding:false,syncInProgress:false,gateOpening:false,autoFetching:true,writes:[],renderCount:0,
 supervisorNoteDraft:()=>c.payload.supervisorDraft||null,supervisorDraftStatus:m=>{node('supervisor-note-status').textContent=m},
 async flushSupervisorDraft(){c.payload={...c.payload,supervisorDraft:{id:'p',head:person.heads[0].id,desc:node('supervisor-personal-note').value,relationshipNotes:node('supervisor-relationship-note').value}};c.localRevision++},
 async persist(next,{guard}){guard();await c.beforeWrite?.();guard();if(c.fail)throw Error('fictional disk failure');c.writes.push(structuredClone(next));c.payload=next;c.localRevision++},render(){c.renderCount++}
 });
 node('supervisor-personal-note').value='新的人工筆記';node('supervisor-relationship-note').value='新的人工關係資訊';
 vm.runInContext(part('function captureSupervisorSaveContext(', 'async function flushSupervisorDraft('),c);
 return {c,node,form:{dataset:{person:'p',head:person.heads[0].id}},person};
}
test('a read-only Mac probe used to trigger CSV guard; supervisor local save now succeeds while preserving originals and unrelated records',async()=>{
 const {c,form}=harness(),before=structuredClone(c.payload.bundle);vm.runInContext(part('// Bind CSV confirmation','async function saveCSVBundle('),c);
 assert.throws(()=>c.captureCSVSaveContext(),/CSV/);await c.saveSupervisorNote(form);assert.equal(c.writes.length,1);assert.equal(c.payload.supervisorDraft,null);assert.equal(c.editorContext,null);assert.equal(c.payload.bundle.ops.length,before.ops.length+1);assert.deepEqual(c.payload.bundle.ops.slice(0,-1),before.ops);
 const result=core.project(c.payload.bundle).find(r=>r.id==='p');assert.equal(result.desc,'新的人工筆記');assert.equal(result.relationshipNotes,'新的人工關係資訊');assert.equal(result.name,'虛構督導');assert.equal(c.payload.token,'fictional');assert.equal(c.renderCount,1);
});
test('actual data/session/draft changes during encryption still stop save and retain draft and all source versions',async()=>{
 for(const change of [c=>c.localRevision++,c=>c.syncEpoch++,c=>c.supervisorDraftGeneration++,c=>c.key={},c=>c.document.hidden=true,c=>c.syncInProgress=true,c=>c.payload={...c.payload}]){
  const {c,form}=harness(),before=JSON.stringify(c.payload.bundle);c.beforeWrite=()=>change(c);await assert.rejects(c.saveSupervisorNote(form),/人物筆記|工作階段/);assert.equal(c.writes.length,0);assert.equal(JSON.stringify(c.payload.bundle),before);assert.equal(c.payload.supervisorDraft.desc,'新的人工筆記');assert.equal(c.editorContext.id,'p');assert.equal(c.renderCount,0);
 }
});
test('storage failure and stale person head preserve draft; unchanged resave adds no person version',async()=>{
 const h=harness();h.c.fail=true;await assert.rejects(h.c.saveSupervisorNote(h.form),/disk failure/);assert.equal(h.c.payload.supervisorDraft.desc,'新的人工筆記');assert.equal(core.project(h.c.payload.bundle).find(r=>r.id==='p').desc,'原筆記');
 const stale=harness();stale.c.payload.bundle.ops.push(core.revision('person','p',{...stale.person.heads[0].data,desc:'其他裝置的新版本'},[stale.person.heads[0].id],'other'));await assert.rejects(stale.c.saveSupervisorNote(stale.form),/已有新版本/);assert.equal(stale.c.writes.length,0);
 const same=harness();same.node('supervisor-personal-note').value='原筆記';same.node('supervisor-relationship-note').value='原關係資訊';await same.c.saveSupervisorNote(same.form);assert.equal(same.c.payload.bundle.ops.length,2);assert.equal(same.c.payload.supervisorDraft,null);
});
test('a failed inline draft chain does not permanently block explicit retry; repeated failure still rejects without false success',async()=>{
 const c=vm.createContext({inlineTextContext:null,inlineDraftTimer:1,inlineDraftSaveChain:Promise.resolve(),clearTimeout(){},calls:0,fail:true,async persistInlineTextDraft(){c.calls++;if(c.fail)throw Error('connection failed')}});
 vm.runInContext(part('async function flushInlineTextDraft(', 'function updateInlineText('),c);
 await assert.rejects(c.flushInlineTextDraft(),/connection failed/);assert.equal(c.calls,1);c.fail=false;await c.flushInlineTextDraft();assert.equal(c.calls,2);
 c.fail=true;await assert.rejects(c.flushInlineTextDraft(),/connection failed/);await assert.rejects(c.flushInlineTextDraft(),/connection failed/);assert.equal(c.calls,4);
});
