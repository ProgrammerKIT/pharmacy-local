import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../public/core.js';
import * as r from '../public/relations.js';
import {makeAliasFixture} from './qa/people-alias-fixture.mjs';
const fixture=()=>makeAliasFixture(c,r);
function edit(bundle,type,id,change){const old=c.project(bundle).find(o=>o.type===type&&o.id===id);bundle.ops.push(c.revision(type,id,{...old.heads[0].data,...change},old.heads.map(h=>h.id),'synthetic'));return bundle;}
const scope=f=>r.peopleAliasReviewAvailability(f.bundle,f.readingId,[0,2]);
test('unrelated store reminders, tasks and another persons note do not block exact scoped evidence; saves remain append-only',async()=>{
 for(const mode of ['reminder','tasks','other-note']){
  const f=await fixture();
  if(mode==='reminder')edit(f.bundle,'store','s',{nextRemember:'只改提醒'});
  if(mode==='tasks')edit(f.bundle,'store','s',{everyTimeMust:'只改每次必做'});
  if(mode==='other-note')edit(f.bundle,'visit','v2',{text:'子安提過新的試用心得。'});
  assert.equal(scope(f).canReview,true);assert.equal(scope(f).otherSourcesChanged,true);
  assert.equal(r.peopleRelationshipReviewAvailability(f.bundle,f.readingId,0,2).canReview,true);
  const before=structuredClone(f.bundle),plan=r.planPeopleAliasReview(f.bundle,f.readingId,[0,2],'confirmed','雨清');
  const next=await r.applyPeopleAliasReview(f.bundle,plan,'synthetic');assert.deepEqual(next.ops.slice(0,before.ops.length),before.ops);
  assert.deepEqual(c.project(next).filter(o=>o.type!=='source'),c.project(before).filter(o=>o.type!=='source'));
 }
});
test('changed, missing or conflicted direct evidence and identity changes block new approvals',async()=>{
 for(const mode of ['text','delete','conflict','identity','pending','store-delete','source-missing']){
  const f=await fixture();
  if(mode==='text')edit(f.bundle,'visit','v0',{text:'雨晴的新原文。'});
  if(mode==='source-missing')edit(f.bundle,'visit','v0',{sourceMissing:true});
  if(mode==='delete'){const o=f.bundle.ops.find(o=>o.entity==='v0');f.bundle.ops.push(c.revision('visit','v0',o.data,[o.id],'synthetic',true));}
  if(mode==='store-delete'){const o=f.bundle.ops.find(o=>o.entity==='s');f.bundle.ops.push(c.revision('store','s',o.data,[o.id],'synthetic',true));}
  if(mode==='conflict'){const o=f.bundle.ops.find(o=>o.entity==='v0');f.bundle.ops.push(c.revision('visit','v0',o.data,[],'other-device'));}
  if(mode==='identity')edit(f.bundle,'store','s',{name:'另一間店'});
  if(mode==='pending')edit(f.bundle,'store','s',{csvIdentityPending:true});
  assert.equal(scope(f).canReview,false,mode);assert.throws(()=>r.planPeopleAliasReview(f.bundle,f.readingId,[0,2],'confirmed','雨晴'));
 }
});
test('changed direct evidence allows only explicit withdrawal to pending, keeping original merge and relationship history',async()=>{
 const f=await fixture();f.bundle=await r.applyPeopleAliasReview(f.bundle,r.planPeopleAliasReview(f.bundle,f.readingId,[0,2],'confirmed','雨晴'),'synthetic');
 f.bundle=await r.applyPeopleRelationshipReview(f.bundle,r.planPeopleRelationshipReview(f.bundle,f.readingId,0,2,'confirmed'),'synthetic');
 edit(f.bundle,'visit','v0',{text:'雨晴改了這一段原文。'});assert.equal(scope(f).canReview,false);assert.equal(scope(f).canWithdraw,true);
 assert.throws(()=>r.planPeopleAliasReview(f.bundle,f.readingId,[0,2],'rejected'));
 assert.throws(()=>r.planPeopleRelationshipReview(f.bundle,f.readingId,0,2,'rejected'));
 const before=structuredClone(f.bundle);
 f.bundle=await r.applyPeopleAliasReview(f.bundle,r.planPeopleAliasReview(f.bundle,f.readingId,[0,2],'pending'),'synthetic');
 f.bundle=await r.applyPeopleRelationshipReview(f.bundle,r.planPeopleRelationshipReview(f.bundle,f.readingId,0,2,'pending'),'synthetic');
 assert.deepEqual(f.bundle.ops.slice(0,before.ops.length),before.ops);assert.equal(c.peopleAliasReviewState(f.bundle,f.readingId,[0,2]).status,'pending');
 assert.equal(c.peopleRelationshipReviewState(f.bundle,f.readingId,0,2).status,'pending');assert.equal(c.peopleAliasReviewState(f.bundle,f.readingId,[0,2]).history.length,2);
 const sealed=await c.createRecoveryBackup(f.bundle,'fictional-recovery-password','fictional-recovery-password');const backup=JSON.parse(sealed.text),key=await c.derive('fictional-recovery-password',backup.envelope);assert.deepEqual(await c.unseal(backup.envelope,key),f.bundle);
});
test('a concurrent unrelated change after preview still cancels saving; no automatic decision propagation',async()=>{
 const f=await fixture();edit(f.bundle,'visit','v2',{text:'子安的其他資訊。'});
 const p=r.planPeopleAliasReview(f.bundle,f.readingId,[0,2],'confirmed','雨晴');edit(f.bundle,'store','s',{nextRemember:'確認視窗之後的修改'});
 await assert.rejects(r.applyPeopleAliasReview(f.bundle,p,'synthetic'),/核對期間/);
 assert.equal(c.peopleAliasReviewState(f.bundle,f.readingId,[0,2]).status,null);
});
