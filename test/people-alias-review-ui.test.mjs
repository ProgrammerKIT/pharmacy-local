import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as c from '../public/core.js';
import * as r from '../public/relations.js';
import {makeAliasFixture} from './qa/people-alias-fixture.mjs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
async function harness(){
 const f=await makeAliasFixture(c,r),nodes=new Map(),writes=[],confirmations=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{open:true,dataset:{singleStoreId:'s'},querySelectorAll:()=>[]});return nodes.get(id);};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ctx=vm.createContext({...c,...r,JSON,Date,Number,Set,Map,peopleReadingEpoch:0,key:{},meta:{},payload:{device:'synthetic',bundle:f.bundle},pendingLock:false,document:{hidden:false},$,esc,dateText:v=>v,insightChangeBadgeHTML:()=>'',
  assertInsightReviewReady(){if(ctx.pendingLock||ctx.document.hidden||ctx.draft)throw Error('blocked');},
  confirm:t=>{confirmations.push(t);return ctx.answer;},render(){},openVisitBrief(){},toast:t=>ctx.lastToast=t,
  persist:async(next,{guard})=>{if(ctx.duringSave)ctx.duringSave();guard();writes.push(next);ctx.payload=next;}});
 vm.runInContext(app.slice(app.indexOf('const peopleReadingViews'),app.indexOf('function loadPeopleReadingView(')),ctx);
 const view={readingId:f.readingId,result:f.input.result,basis:f.input.result.basis,state:'automatic'};
 vm.runInContext(`peopleReadingViews.set('s',${JSON.stringify(view)})`,ctx);
 const button={dataset:{readingAliasReading:f.readingId,readingAliasIndices:'[0,2]',readingAliasStatus:'confirmed'},closest:()=>({querySelector:()=>({value:ctx.primary??'雨晴'})})};
 return {ctx,f,writes,confirmations,button,view,html:()=>ctx.peopleReadingHTML('s')};
}
test('purple cards are adjacent across tiers; review collapsed, original memories visible, no identity merge until confirmation',async()=>{
 const h=await harness(),html=h.html();
 assert.match(html,/people-alias-candidate/);assert.equal((html.match(/people-reading-same/g)||[]).length,2);
 assert.ok(html.indexOf('data-reading-person="雨晴"')<html.indexOf('data-reading-person="雨清"'));assert.ok(html.indexOf('data-reading-person="雨清"')<html.indexOf('data-reading-person="子安"'));
 assert.match(html,/核對是否同一人/);assert.match(html,/接續同一展示架/);assert.doesNotMatch(html,/<details[^>]*\sopen/);assert.doesNotMatch(html,/雨晴（雨清）/);
 for(const s of ['confirmed','rejected','pending'])assert.match(html,new RegExp(`data-reading-alias-status="${s}"`));
});
test('cancel and missing primary cannot save; approval shows both names with all original evidence and relationship buttons unchanged',async()=>{
 const h=await harness();h.ctx.answer=false;await h.ctx.changePeopleAliasReview(h.button);assert.equal(h.writes.length,0);
 h.ctx.answer=true;h.ctx.primary='';await assert.rejects(h.ctx.changePeopleAliasReview(h.button),/主要稱呼/);assert.equal(h.writes.length,0);
 h.ctx.primary='雨清';await h.ctx.changePeopleAliasReview(h.button);assert.equal(h.writes.length,1);
 const html=h.html();assert.match(html,/雨清（雨晴）/);assert.equal((html.match(/class="people-reading-person/g)||[]).length,2);assert.doesNotMatch(html,/people-reading-same/);
 assert.match(html,/data-reading-relation-person="0" data-reading-relation-item="2"/);assert.match(html,/原稱呼：雨晴/);assert.match(html,/原稱呼：雨清/);assert.match(html,/同人審核歷史 · 1 筆/);assert.match(h.confirmations.at(-1),/不改正式人物/);
 assert.deepEqual(h.ctx.payload.bundle.ops.slice(0,h.f.bundle.ops.length),h.f.bundle.ops);
});
test('rejected restores separate tiers and can be revised from collapsed review history',async()=>{
 const h=await harness();h.ctx.answer=true;h.button.dataset.readingAliasStatus='rejected';await h.ctx.changePeopleAliasReview(h.button);
 const html=h.html();assert.doesNotMatch(html,/people-reading-same/);assert.match(html,/稱呼待釐清/);assert.match(html,/核對是否同一人 · 不同人/);assert.match(html,/data-reading-alias-status="pending"/);
 h.button.dataset.readingAliasStatus='pending';await h.ctx.changePeopleAliasReview(h.button);assert.equal((h.html().match(/people-reading-same/g)||[]).length,2);assert.match(h.html(),/同人審核歷史 · 2 筆/);
});
test('disk failure, lock, hidden page, draft and async changes preserve prior state and never claim success',async()=>{
 for(const mode of ['disk','lock','hidden','draft','payload','epoch']){
  const h=await harness();h.ctx.answer=true;
  if(mode==='disk')h.ctx.persist=async()=>{throw Error('synthetic disk failure');};
  if(mode==='lock')h.ctx.pendingLock=true;if(mode==='hidden')h.ctx.document.hidden=true;if(mode==='draft')h.ctx.draft=true;
  if(mode==='payload')h.ctx.duringSave=()=>{h.ctx.payload={...h.ctx.payload};};if(mode==='epoch')h.ctx.duringSave=()=>{vm.runInContext('peopleReadingEpoch++',h.ctx);};
  await assert.rejects(h.ctx.changePeopleAliasReview(h.button));assert.equal(h.writes.length,0);assert.equal(h.ctx.lastToast,undefined);
 }
});
test('source staleness disables identity choices, keeps history; text escapes HTML',async()=>{
 const h=await harness();const view={...h.view,state:'stale',basis:'new'};vm.runInContext(`peopleReadingViews.set('s',${JSON.stringify(view)})`,h.ctx);
 assert.doesNotMatch(h.html(),/data-reading-alias-status/);assert.match(h.html(),/暫不保存新判斷/);
 const data=structuredClone(view.result);data.people[0].candidateReason='<script>bad</script>';assert.match(h.ctx.peopleAliasReviewHTML('s',{...view,result:data},[0,2],null),/&lt;script&gt;/);
});
