import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createPeopleBatch, peopleRoundCompletion } from '../server.mjs';
import * as core from '../public/core.js';
import { peopleReadingRequest } from '../public/relations.js';

function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fictional-round-completion-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let clock=Date.parse('2026-01-01T00:00:00Z');
  const bundle=core.emptyBundle('fictional-completion-vault');
  for(const id of ['a','b'])bundle.ops.push(core.revision('store',id,{name:`虛構${id}店`,city:'',district:'',channel:'',attr:'',contact:''},[],'fictional'),core.revision('visit',`v${id}`,{store:id,text:'小雨分享經驗。',date:'',source:'虛構',next:'不修改原跟進',people:[],topics:[],attachments:[]},[],'fictional'));
  const requests=['a','b'].map(id=>peopleReadingRequest(bundle,id));
  const options={directory,getSnapshot:()=>({version:1,envelope:{vaultId:bundle.vaultId}}),now:()=>clock};
  const api=createPeopleBatch(options);api.configure(true,bundle.vaultId);const round=api.beginRound();
  const body={vaultId:bundle.vaultId,snapshotVersion:1,roundId:round.id,requests};
  const stage=(extra={})=>api.stage({...body,requests:[],completeStoreIds:['a','b'],checkedStoreIds:['a','b','unchanged'],skippedStoreIds:['unchanged'],excludedCount:0,...extra});
  const ready=()=>{const claim=api.claim(),p=claim.request.plan;api.submit({id:claim.id,lease:claim.lease,input:{format:'pharmacy-people-review-1',vaultId:bundle.vaultId,result:{format:p.format,storeId:p.storeId,basis:p.basis,coveredRevisions:p.sources.map(s=>s.revisionId),people:[]}}});return claim;};
  const ack=(claim,outcome='saved',target=api)=>target.acknowledge({vaultId:bundle.vaultId,roundId:round.id,id:claim.id,basis:claim.request.plan.basis,outcome});
  return{api,body,options,directory,requests,bundle,round,stage,ready,ack,tick:ms=>clock+=ms,time:()=>new Date(clock).toISOString(),status:()=>api.status(body)};
}

test('only a sealed complete source set and final App saved acknowledgement finish a round',t=>{
 const x=fixture(t),before=structuredClone(x.bundle);x.api.stage(x.body);
 assert.equal(x.status().lastCompletedRound,null);x.stage();
 const a=x.ready(),b=x.ready();assert.equal(x.status().lastCompletedRound,null,'AI ready is not saved');
 x.tick(1000);x.ack(a);assert.equal(x.status().lastCompletedRound,null);
 x.tick(2000);x.ack(b);const done=x.status().lastCompletedRound;
 assert.equal(done.completedAt,x.time());assert.deepEqual([done.checked,done.skipped,done.required,done.saved,done.excluded],[3,1,2,2,0]);
 assert.deepEqual(x.bundle,before,'no original note/person/todo changes');
 assert.equal(x.status().round.completedAt,done.completedAt);
});

test('duplicate acknowledgement and polling preserve time; restart and next round preserve the last completion',t=>{
 const x=fixture(t);x.api.stage(x.body);x.stage();const a=x.ready(),b=x.ready();x.tick(1000);x.ack(a);x.tick(1000);x.ack(b);
 const done=x.status().lastCompletedRound,raw=fs.readFileSync(path.join(x.directory,'settings.json'),'utf8');
 x.tick(2000);x.ack(b);assert.equal(x.status().lastCompletedRound.completedAt,done.completedAt);
 assert.equal(fs.readFileSync(path.join(x.directory,'settings.json'),'utf8'),raw);
 const restarted=createPeopleBatch(x.options);assert.deepEqual(restarted.status(x.body).lastCompletedRound,done);
 x.tick(5*86400000);const next=restarted.beginRound();assert.notEqual(next.id,x.round.id);
 const state=restarted.status(x.body);assert.deepEqual(state.lastCompletedRound,done);assert.equal(state.round.completedAt,undefined);
});

test('new source in a completed round preserves prior completion while reopening current work',t=>{
 const x=fixture(t);x.api.stage(x.body);x.stage();const a=x.ready(),b=x.ready();x.ack(a);x.tick(1000);x.ack(b);const previous=x.status().lastCompletedRound;
 const q=structuredClone(x.requests[0]);q.plan.basis+='new-source';x.tick(2000);x.api.stage({...x.body,requests:[q]});
 assert.equal(x.status().round.completedAt,undefined);assert.deepEqual(x.status().lastCompletedRound,previous);
 const c=x.ready();x.tick(2000);x.ack(c);assert.notEqual(x.status().lastCompletedRound.completedAt,previous.completedAt);
});

test('failed or stale work cannot finish the round even after other jobs are saved',t=>{
 for(const outcome of ['failed','stale']){const x=fixture(t);x.api.stage(x.body);x.stage();x.ack(x.ready());x.ack(x.ready(),outcome);assert.equal(x.status().lastCompletedRound,null);}
});

test('a sealed zero-change manifest completes at preparation time without AI or fabricated work',t=>{
 const x=fixture(t);x.tick(3000);x.stage({completeStoreIds:[],checkedStoreIds:['a','b'],skippedStoreIds:['a','b']});
 assert.equal(x.api.claim(),null);assert.deepEqual([x.status().lastCompletedRound.saved,x.status().lastCompletedRound.skipped],[0,2]);
 assert.equal(x.status().lastCompletedRound.completedAt,x.time());
});

test('legacy completed rounds recover from exact job acknowledgements without status writes or deployment time',t=>{
 const x=fixture(t);x.api.stage(x.body);x.stage({excludedCount:undefined});x.ack(x.ready());x.tick(4000);x.ack(x.ready());const expected=x.time();
 const f=path.join(x.directory,'settings.json'),settings=JSON.parse(fs.readFileSync(f));delete settings.lastCompletedRound;fs.writeFileSync(f,JSON.stringify(settings));
 const before=fs.readFileSync(f,'utf8');x.tick(500000);const status=x.status();
 assert.equal(status.lastCompletedRound.completedAt,expected);assert.equal(status.lastCompletedRound.excluded,null);assert.equal(fs.readFileSync(f,'utf8'),before);
 const other=createPeopleBatch({...x.options,getSnapshot:()=>({envelope:{vaultId:'other'}})});assert.equal(other.status({vaultId:'other'}).lastCompletedRound,null);
});

test('incomplete, duplicated, wrong-round or undated acknowledgement evidence never fabricates a completion',()=>{
 const round={id:'r',mode:'changed-formal-notes',sealed:true,storeIds:['a'],checkedStoreIds:['a','b'],skippedStoreIds:['b'],preparedAt:'2026-01-01T00:00:00Z'};
 const job={state:'saved',roundId:'r',updatedAt:'2026-01-01T00:01:00Z',request:{store:{id:'a'},plan:{basis:'fictional'}}};
 for(const [r,jobs]of [[{...round,sealed:false},[job]],[round,[]],[round,[job,job]],[round,[{...job,roundId:'other'}]],[round,[{...job,updatedAt:'missing'}]],[{...round,checkedStoreIds:['a']},[job]]])assert.equal(peopleRoundCompletion(r,jobs),null);
 assert.equal(peopleRoundCompletion(round,[job]).completedAt,'2026-01-01T00:01:00.000Z');
});

function html(state){
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),from=app.indexOf('function peopleBatchCompletionHTML('),to=app.indexOf('function renderPeopleBatchStatus(',from);
 const context=vm.createContext({state,esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),dateText:s=>s});
 return vm.runInContext(app.slice(from,to)+'\npeopleBatchCompletionHTML(state)',context);
}
test('UI separates last completion from current progress and never labels a claim as completion',()=>{
 assert.match(html({lastWorkerAt:'fictional-claim'}),/尚無可核對/);
 const done={id:'old',completedAt:'2026-01-01T00:00:00Z',checked:3,skipped:1,required:2,saved:2,failed:0,stale:0,excluded:null};
 let out=html({lastCompletedRound:done,round:{id:'new'}});assert.match(out,/最近整輪完成/);assert.match(out,/前次完成紀錄/);assert.match(out,/目前這輪尚未完成/);assert.match(out,/排除／待核對 未記錄/);
 out=html({lastCompletedRound:done,round:{id:'old',completedAt:done.completedAt}});assert.match(out,/本輪已完成可整理門市/);assert.doesNotMatch(out,/目前這輪尚未完成/);
 assert.match(html({lastCompletedRound:{...done,required:0,saved:0}}),/本輪無筆記變動/);
 assert.ok(!html({lastCompletedRound:{...done,completedAt:'<script>bad</script>'}}).includes('<script>'));
});
