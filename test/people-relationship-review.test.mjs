import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../public/core.js';
import * as r from '../public/relations.js';
import {makeFixture} from './qa/people-relationship-fixture.mjs';
const fixture=()=>makeFixture(c,r);

const plan=(f,status='confirmed',item=0)=>r.planPeopleRelationshipReview(f.bundle,f.readingId,0,item,status);
const state=(bundle,id,item=0)=>c.peopleRelationshipReviewState(bundle,id,0,item);
test('each decision only appends an immutable source; original records, other claims and identities stay unchanged',async()=>{
 const f=await fixture(),before=JSON.stringify(f.bundle),p=plan(f);assert.equal(JSON.stringify(f.bundle),before);
 const next=await r.applyPeopleRelationshipReview(f.bundle,p,'test');
 assert.deepEqual(next.ops.slice(0,f.bundle.ops.length),f.bundle.ops);assert.equal(next.ops.length,f.bundle.ops.length+1);assert.equal(next.ops.at(-1).type,'source');
 assert.equal(state(next,f.readingId).status,'confirmed');assert.equal(state(next,f.readingId,1).status,null);
 assert.equal(JSON.stringify(f.bundle),before);assert.deepEqual(c.project(next).filter(x=>x.type!=='source'),c.project(f.bundle).filter(x=>x.type!=='source'));
 assert.equal(r.peopleReadingRequest(next,'s').plan.basis,f.input.result.basis);
 assert.equal(r.currentPeopleReading(next,'s').history.length,1);
});
test('confirmed, rejected and explicit pending retain all review history; duplicate decision is inert',async()=>{
 const f=await fixture();let next=f.bundle;
 for(const status of ['confirmed','rejected','pending'])next=await r.applyPeopleRelationshipReview(next,r.planPeopleRelationshipReview(next,f.readingId,0,0,status),'test');
 const result=state(next,f.readingId);assert.equal(result.status,'pending');assert.equal(result.history.length,3);assert.equal(result.heads.length,1);
 assert.equal(await r.applyPeopleRelationshipReview(next,r.planPeopleRelationshipReview(next,f.readingId,0,0,'pending'),'test'),next);
});
test('concurrent opposite device decisions remain conflict; explicit re-review resolves without timestamp selection',async()=>{
 const f=await fixture();const a=await r.applyPeopleRelationshipReview(f.bundle,plan(f),'a');const b=await r.applyPeopleRelationshipReview(f.bundle,plan(f,'rejected'),'b');
 const merged=await c.merge(a,b);assert.equal(state(merged,f.readingId).conflict,true);assert.equal(state(merged,f.readingId).status,null);
 const next=await r.applyPeopleRelationshipReview(merged,r.planPeopleRelationshipReview(merged,f.readingId,0,0,'pending'),'test');assert.equal(state(next,f.readingId).history.length,3);assert.equal(state(next,f.readingId).conflict,false);
 const same=await r.applyPeopleRelationshipReview(f.bundle,plan(f),'c');assert.equal(state(await c.merge(a,same),f.readingId).status,'confirmed');
});
test('source, store, snapshot or review changes invalidate preview; no best-effort overwrite',async()=>{
 for(const change of ['note','store','reading','review']){
  const f=await fixture(),p=plan(f);let next=structuredClone(f.bundle);
  if(change==='reading'){const input=structuredClone(f.input);input.result.people[0].items[0].text+=' 原件保留。';next=await r.applyPeopleReading(next,input,r.preparePeopleReading(next,input),'other');}
  else if(change==='review')next=await r.applyPeopleRelationshipReview(next,plan(f,'rejected'),'other');
  else {const op=next.ops.find(o=>o.type===(change==='note'?'visit':'store'));next.ops.push(c.revision(op.type,op.entity,{...op.data,...(change==='note'?{text:op.data.text+'新筆記'}:{contact:'新窗口'})},[op.id],'other'));}
  await assert.rejects(r.applyPeopleRelationshipReview(next,p,'test'));
 }
});
test('exact unchanged claim survives same-evidence reordering, but changed wording, kind or evidence never inherit approval',async()=>{
 const f=await fixture(),reviewed=await r.applyPeopleRelationshipReview(f.bundle,plan(f),'test');
 for(const change of ['reorder','text','kind','quote']){
  const input=structuredClone(f.input);
  if(change==='reorder')input.result.people[0].items.reverse();
  if(change==='text')input.result.people[0].items[0].text+=' 新解讀。';
  if(change==='kind')input.result.people[0].kind='mentioned';
  if(change==='quote')input.result.people[0].items[0].evidence[0].quote='博文是她以前的同事';
  const next=await r.applyPeopleReading(reviewed,input,r.preparePeopleReading(reviewed,input),'other'),id=r.currentPeopleReading(next,'s').current.id;
  assert.equal(state(next,id,change==='reorder'?1:0).status,change==='reorder'?'confirmed':null);
 }
});
test('review references, field injection, foreign claim supersession and cycles fail vault validation',async()=>{
 const f=await fixture(),reviewed=await r.applyPeopleRelationshipReview(f.bundle,plan(f),'test');
 for(const mutate of [e=>e.readingId='missing',e=>e.personIndex=99,e=>e.itemIndex=99,e=>e.status='automatic',e=>e.sameAs='person-original',e=>e.replaces=['missing'],e=>e.replaces=[reviewed.ops.at(-1).entity]]){
  const bad=structuredClone(reviewed),op=bad.ops.at(-1);mutate(op.data.peopleRelationshipReview);
  const bytes=new TextEncoder().encode(JSON.stringify(op.data.peopleRelationshipReview)),blob=await c.hashBytes(bytes);op.data.blob=blob;bad.blobs[blob]=c.b64(bytes);assert.throws(()=>c.validateBundle(bad));
 }
 const second=await r.applyPeopleRelationshipReview(reviewed,r.planPeopleRelationshipReview(reviewed,f.readingId,0,1,'pending'),'test');
 const bad=structuredClone(second),op=bad.ops.at(-1);op.data.peopleRelationshipReview.replaces=[reviewed.ops.at(-1).entity];const bytes=new TextEncoder().encode(JSON.stringify(op.data.peopleRelationshipReview)),blob=await c.hashBytes(bytes);op.data.blob=blob;bad.blobs[blob]=c.b64(bytes);assert.throws(()=>c.validateBundle(bad));
 assert.throws(()=>r.planPeopleRelationshipReview(f.bundle,f.readingId,1,0,'confirmed'));
});
test('encrypted snapshot, backup and merge preserve per-claim decisions and exact original content',async()=>{
 const f=await fixture(),next=await r.applyPeopleRelationshipReview(f.bundle,plan(f,'rejected'),'test');
 const meta=c.newMeta();meta.vaultId=next.vaultId;const key=await c.derive('synthetic-test-password-only',meta);
 const restored=await c.unseal(await c.seal(next,key,meta),key);assert.deepEqual(restored,next);assert.equal(state(restored,f.readingId).status,'rejected');
 const backup=await c.createRecoveryBackup(next,'synthetic-new-password-only','synthetic-new-password-only'),file=JSON.parse(backup.text);
 const fromBackup=await c.unseal(file.envelope,await c.derive('synthetic-new-password-only',file.envelope));
 assert.deepEqual(fromBackup,next);assert.equal(state(fromBackup,f.readingId).status,'rejected');
 const importPlan=await c.planBackupImport(null,fromBackup);assert.equal(importPlan.summary.after.revisions,next.ops.length);
 const merged=await c.merge(f.bundle,restored);assert.equal(state(merged,f.readingId).status,'rejected');assert.deepEqual(merged.ops.filter(o=>o.type!=='source').sort((a,b)=>a.id.localeCompare(b.id)),f.bundle.ops.filter(o=>o.type!=='source').sort((a,b)=>a.id.localeCompare(b.id)));
});
