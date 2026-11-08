import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as c from '../public/core.js';
import * as r from '../public/relations.js';
import {makeFixture} from './qa/people-relationship-fixture.mjs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
async function harness(){
 const f=await makeFixture(c,r),nodes=new Map(),writes=[],confirmations=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{singleStoreId:'s'}});return nodes.get(id);};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ctx=vm.createContext({JSON,Date,Number,Set,Map,peopleReadingEpoch:0,key:{},meta:{},payload:{device:'synthetic',bundle:f.bundle},pendingLock:false,document:{hidden:false},$,
  peopleRelationshipReviewState:c.peopleRelationshipReviewState,peopleRelationshipReviewAvailability:r.peopleRelationshipReviewAvailability,planPeopleRelationshipReview:r.planPeopleRelationshipReview,applyPeopleRelationshipReview:r.applyPeopleRelationshipReview,
  esc,dateText:v=>v,peopleEvidenceHTML:e=>`<details><summary>原句與來源版本</summary>${e.map(x=>esc(x.quote)).join('')}</details>`,
  assertInsightReviewReady(){if(ctx.pendingLock||ctx.document.hidden||ctx.draft)throw Error('blocked');},
  confirm:t=>{confirmations.push(t);return ctx.answer;},render(){},openVisitBrief(){},toast:t=>ctx.lastToast=t,
  persist:async(next,{guard})=>{if(ctx.duringSave)ctx.duringSave();guard();writes.push(next);ctx.payload=next;}});
 vm.runInContext(app.slice(app.indexOf('const PEOPLE_RELATION_LABELS='),app.indexOf('function peopleReadingHTML(')),ctx);
 const button={dataset:{readingRelationReading:f.readingId,readingRelationPerson:'0',readingRelationItem:'0',readingRelationStatus:'confirmed'}};
 const view={readingId:f.readingId,result:f.input.result,basis:f.input.result.basis,state:'automatic'};
 return {ctx,f,writes,confirmations,button,html:()=>ctx.peopleRelationshipHTML('s',view,f.input.result.people[0],0,f.input.result.people[0].items[0],0),view};
}
test('every relationship has three accessible choices and exact evidence; stale source disables choices',async()=>{
 const h=await harness(),html=h.html();for(const s of ['confirmed','rejected','pending'])assert.match(html,new RegExp(`data-reading-relation-status="${s}"`));
 assert.match(html,/尚未人工判斷/);assert.match(html,/原句與來源版本/);assert.match(html,/aria-label="人工判斷/);
 const op=h.ctx.payload.bundle.ops.find(o=>o.type==='visit');h.ctx.payload.bundle.ops.push(c.revision('visit',op.entity,{...op.data,text:op.data.text+'新原文'},[op.id],'test'));h.view.state='stale';assert.doesNotMatch(h.html(),/data-reading-relation-status/);assert.match(h.html(),/來源或速覽已變更/);
});
test('cancel is inert; explicit confirmation saves only this decision and offers accurate scope',async()=>{
 const h=await harness();h.ctx.answer=false;await h.ctx.changePeopleRelationshipReview(h.button);assert.equal(h.writes.length,0);
 h.ctx.answer=true;await h.ctx.changePeopleRelationshipReview(h.button);assert.equal(h.writes.length,1);assert.match(h.ctx.lastToast,/確定/);
 assert.match(h.confirmations[0],/不合併人物/);assert.match(h.confirmations[0],/其他門市/);assert.deepEqual(h.writes[0].bundle.ops.slice(0,h.f.bundle.ops.length),h.f.bundle.ops);
 assert.match(h.html(),/<details class="people-reading-relation"/);assert.doesNotMatch(h.html(),/<details[^>]* open/);
 const history=h.ctx.peopleRelationshipHistoryHTML('s');assert.match(history,/人物關係審核歷史 · 1 筆/);assert.match(history,/原句與來源版本/);
});
test('changes during async save and locked, hidden or draft state never write or claim success',async()=>{
 for(const mode of ['lock','hidden','draft','payload','epoch']){
  const h=await harness();h.ctx.answer=true;
  if(mode==='lock')h.ctx.pendingLock=true;
  if(mode==='hidden')h.ctx.document.hidden=true;
  if(mode==='draft')h.ctx.draft=true;
  if(mode==='payload')h.ctx.duringSave=()=>{h.ctx.payload={...h.ctx.payload};};
  if(mode==='epoch')h.ctx.duringSave=()=>{h.ctx.peopleReadingEpoch++;};
  await assert.rejects(h.ctx.changePeopleRelationshipReview(h.button));assert.equal(h.writes.length,0);assert.equal(h.ctx.lastToast,undefined);
 }
});
test('disk failure preserves previous state and retry can save; HTML escapes claim text',async()=>{
 const h=await harness();h.ctx.answer=true;const persist=h.ctx.persist;
 h.ctx.persist=async()=>{throw Error('synthetic disk failure');};await assert.rejects(h.ctx.changePeopleRelationshipReview(h.button),/disk failure/);
 assert.equal(c.peopleRelationshipReviewState(h.ctx.payload.bundle,h.f.readingId,0,0).status,null);assert.equal(h.ctx.lastToast,undefined);
 h.ctx.persist=persist;await h.ctx.changePeopleRelationshipReview(h.button);assert.equal(h.writes.length,1);
 const p=structuredClone(h.f.input.result.people[0]),item=p.items[0];item.text='<script>bad</script>';
 const html=h.ctx.peopleRelationshipHTML('s',h.view,p,0,item,0);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});
