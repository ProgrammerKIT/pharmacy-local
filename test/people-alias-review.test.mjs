import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../public/core.js';
import * as r from '../public/relations.js';
import {makeAliasFixture} from './qa/people-alias-fixture.mjs';
const fixture=()=>makeAliasFixture(c,r);
const plan=(f,status='confirmed',primary=status==='confirmed'?'雨晴':'')=>r.planPeopleAliasReview(f.bundle,f.readingId,[0,2],status,primary);
const state=f=>c.peopleAliasReviewState(f.bundle,f.readingId,[0,2]);
test('candidate layout keeps variant cards adjacent across tiers without merging or changing kind',async()=>{
 const f=await fixture(),original=JSON.stringify(f.input.result),layout=r.peopleAliasLayout(f.input.result);
 assert.deepEqual(layout.map(u=>u.indices),[[0,2],[1]]);assert.equal(layout[0].kind,'local');assert.equal(f.input.result.people[2].kind,'uncertain');assert.equal(JSON.stringify(f.input.result),original);
 assert.deepEqual(r.peopleAliasLayout(f.input.result,()=>({status:'rejected'})).map(u=>u.indices),[[0],[1],[2]]);
});
test('confirmation appends only an immutable link; identities, original text, task and relationship judgments stay byte-identical',async()=>{
 const f=await fixture();f.bundle=await r.applyPeopleRelationshipReview(f.bundle,r.planPeopleRelationshipReview(f.bundle,f.readingId,0,2,'rejected'),'seed');
 const before=structuredClone(f.bundle),next=await r.applyPeopleAliasReview(f.bundle,plan(f),'test');
 assert.deepEqual(f.bundle,before);assert.deepEqual(next.ops.slice(0,before.ops.length),before.ops);assert.equal(next.ops.length,before.ops.length+1);
 assert.equal(state({...f,bundle:next}).status,'confirmed');assert.equal(state({...f,bundle:next}).primaryName,'雨晴');
 assert.equal(c.peopleRelationshipReviewState(next,f.readingId,0,2).status,'rejected');assert.deepEqual(c.project(next).filter(x=>x.type!=='source'),c.project(before).filter(x=>x.type!=='source'));
 assert.equal(r.peopleReadingRequest(next,'s').plan.basis,f.input.result.basis);
});
test('primary name required; reject/pending undo display merge with full audit and no duplicate writes',async()=>{
 const f=await fixture();assert.throws(()=>plan(f,'confirmed',''),/主要稱呼/);assert.throws(()=>plan(f,'confirmed','外來姓名'),/主要稱呼/);
 for(const status of ['confirmed','pending','confirmed','rejected'])f.bundle=await r.applyPeopleAliasReview(f.bundle,plan(f,status),'test');
 assert.equal(state(f).status,'rejected');assert.equal(state(f).history.length,4);assert.equal(state(f).heads.length,1);assert.equal(await r.applyPeopleAliasReview(f.bundle,plan(f,'rejected'),'test'),f.bundle);
});
test('concurrent statuses OR different primary names are conflicts, never auto-merge; explicit review resolves',async()=>{
 const f=await fixture(),a=await r.applyPeopleAliasReview(f.bundle,plan(f),'a');
 for(const p of [plan(f,'rejected'),plan(f,'confirmed','雨清')]){
  const b=await r.applyPeopleAliasReview(f.bundle,p,'b'),merged=await c.merge(a,b);assert.equal(state({...f,bundle:merged}).conflict,true);assert.equal(state({...f,bundle:merged}).status,null);
  const next=await r.applyPeopleAliasReview(merged,r.planPeopleAliasReview(merged,f.readingId,[0,2],'pending'),'test');assert.equal(state({...f,bundle:next}).conflict,false);assert.equal(state({...f,bundle:next}).history.length,3);
 }
});
test('pending preview rejects concurrent source/store/reading/review changes and foreign/partial groups',async()=>{
 for(const change of ['note','store','reading','review']){
  const f=await fixture(),p=plan(f);let next=structuredClone(f.bundle);
  if(change==='reading'){const input=structuredClone(f.input);input.result.people[0].items[0].text+=' 原文記載。';next=await r.applyPeopleReading(next,input,r.preparePeopleReading(next,input),'other');}
  else if(change==='review')next=await r.applyPeopleAliasReview(next,plan(f,'rejected'),'other');
  else{const op=next.ops.find(o=>o.type===(change==='note'?'visit':'store'));next.ops.push(c.revision(op.type,op.entity,{...op.data,...(change==='note'?{text:op.data.text+'新記載'}:{contact:'新窗口'})},[op.id],'other'));}
  await assert.rejects(r.applyPeopleAliasReview(next,p,'test'));
 }
 const f=await fixture();for(const indices of [[0],[0,1],[2,0],[0,2,2],[0,99]])assert.throws(()=>r.planPeopleAliasReview(f.bundle,f.readingId,indices,'confirmed','雨晴'));
});
test('same exact members/evidence survive list/group-label reordering; changed evidence, interpretation, kind or group membership do not inherit decision',async()=>{
 const f=await fixture(),reviewed=await r.applyPeopleAliasReview(f.bundle,plan(f),'test');
 for(const mode of ['order','label','text','kind','quote','member']){
  const input=structuredClone(f.input);
  if(mode==='order')input.result.people.reverse();
  if(mode==='label')for(const p of input.result.people)if(p.candidateGroup)p.candidateGroup='new-label';
  if(mode==='text')input.result.people[0].items[0].text+=' 新解讀。';
  if(mode==='kind')input.result.people[2].kind='historical';
  if(mode==='quote')input.result.people[0].items[0].evidence[0].quote='是藥師';
  if(mode==='member')input.result.people[1].candidateGroup='possible-alias';
  const next=await r.applyPeopleReading(reviewed,input,r.preparePeopleReading(reviewed,input),'test'),id=r.currentPeopleReading(next,'s').current.id;
  const indices=c.peopleAliasGroups(input.result)[0];assert.equal(c.peopleAliasReviewState(next,id,indices).status,['order','label'].includes(mode)?'confirmed':null);
 }
});
test('malformed events, injected decisions, source mixing and review cycles fail validation',async()=>{
 const f=await fixture(),saved=await r.applyPeopleAliasReview(f.bundle,plan(f),'test');
 for(const mutate of [e=>e.readingId='missing',e=>e.personIndices=[0,1],e=>e.primaryName='外人',e=>e.status='automatic',e=>e.sameAs='original-person',e=>e.replaces=['missing'],e=>e.replaces=[saved.ops.at(-1).entity]]){
  const bad=structuredClone(saved),op=bad.ops.at(-1);mutate(op.data.peopleAliasReview);const bytes=new TextEncoder().encode(JSON.stringify(op.data.peopleAliasReview)),blob=await c.hashBytes(bytes);op.data.blob=blob;bad.blobs[blob]=c.b64(bytes);assert.throws(()=>c.validateBundle(bad));
 }
 const bad=structuredClone(saved);bad.ops.at(-1).data.monthlyFeedback={};assert.throws(()=>c.validateBundle(bad));
 const input=structuredClone(f.input);input.result.people[0].sameAs='original-person';assert.throws(()=>r.preparePeopleReading(f.bundle,input),/身分/);
});
test('encrypted backup, restore plan and merge preserve alias decisions, original data and all history',async()=>{
 const f=await fixture(),next=await r.applyPeopleAliasReview(f.bundle,plan(f),'test');
 const backup=JSON.parse((await c.createRecoveryBackup(next,'synthetic-new-password-only','synthetic-new-password-only')).text),key=await c.derive('synthetic-new-password-only',backup.envelope),restored=await c.unseal(backup.envelope,key);
 assert.deepEqual(restored,next);assert.equal(state({...f,bundle:restored}).status,'confirmed');
 assert.equal((await c.planBackupImport(null,restored)).summary.after.revisions,next.ops.length);
 assert.equal(state({...f,bundle:await c.merge(f.bundle,restored)}).status,'confirmed');
});
test('new analysis policy invalidates old source basis once without accepting external sources or model identity decisions',async()=>{
 const f=await fixture(),q=r.peopleReadingRequest(f.bundle,'s'),old=JSON.parse(q.plan.basis);assert.equal(old.pop(),r.PEOPLE_ALIAS_POLICY);assert.notEqual(JSON.stringify(old),q.plan.basis);
 assert.match(q.instructions,/姓名相似本身不足/);assert.match(q.instructions,/candidateReason/);assert.ok(q.plan.sources.every(s=>f.bundle.ops.some(o=>o.type==='visit'&&o.id===s.revisionId)));
 const input=structuredClone(f.input);input.result.people[0].candidateReason='';assert.throws(()=>r.preparePeopleReading(f.bundle,input));
});
