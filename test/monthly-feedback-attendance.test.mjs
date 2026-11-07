import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../public/core.js';
import * as r from '../public/relations.js';
import { makeFixture } from './qa/monthly-feedback-fixture.mjs';
async function fixture() {
 let b=await makeFixture(c);
 const month=c.monthlyVisitMonth(), records=c.project(b);
 b=c.applyMonthlyVisitAction(b,{action:'add',expectedBasis:c.monthlyVisitBasis(records,month),month,storeId:'qa-alert-a'},'qa');
 const plan=c.prepareMonthlyFeedback(b,c.monthlyAnalysisSources(b)[0].id,0);
 const now=new Date().toISOString(), attendance=c.makeVisitAttendance('qa-alert-a',now);
 return {b,plan,now,attendance,input:{visitDate:attendance.date,answers:['0','未知'],notes:''}};
}
test('unchecked feedback and imported JSON never count as an actual visit',async()=>{
 const {b,plan,input,now}=await fixture(), next=await c.applyMonthlyFeedbackWithAttendance(b,plan,input,'qa',undefined,now);
 assert.equal(c.visitAttendanceForStore(b,'qa-alert-a').latestDate,'');
 assert.equal(c.visitAttendanceForStore(next,'qa-alert-a').latestDate,'');
 assert.equal(c.monthlyVisitOverview(next,c.monthlyVisitMonth()).completedCount,0);
 assert.deepEqual(next.ops.slice(0,b.ops.length),b.ops);assert.equal(next.ops.length,b.ops.length+1);
});
test('explicit today confirmation updates recent visit and month completion without changing heads, original text or people-reading basis',async()=>{
 const {b,plan,input,now,attendance}=await fixture(), before=JSON.stringify(b), basis=r.peopleReadingRequest(b,'qa-alert-a').plan.basis;
 const next=await c.applyMonthlyFeedbackWithAttendance(b,plan,input,'qa',attendance,now);
 assert.equal(JSON.stringify(b),before);assert.deepEqual(next.ops.slice(0,b.ops.length),b.ops);assert.equal(next.ops.length,b.ops.length+2);
 assert.deepEqual(c.project(next).filter(v=>v.type!=='source'),c.project(b).filter(v=>v.type!=='source'));
 assert.equal(r.peopleReadingRequest(next,'qa-alert-a').plan.basis,basis);
 assert.equal(c.visitAttendanceForStore(next,'qa-alert-a').latestDate,attendance.date);
 assert.equal(c.visitAttendanceForStore(next,'qa-alert-b').latestDate,'');
 assert.equal(c.monthlyVisitOverview(next,c.monthlyVisitMonth()).completedCount,1);
 const marks=next.ops.filter(op=>op.data.manualVisitAttendance);assert.equal(marks.length,1);assert.deepEqual(c.visitAttendanceEvidence(marks[0]),attendance);
 assert.ok(next.ops.every(op=>op.visitAttendance===undefined));
});
test('encryption, two-device merge and blank-device backup planning retain explicit manual confirmations and report their impact',async()=>{
 const {b,plan,input,now,attendance}=await fixture(), next=await c.applyMonthlyFeedbackWithAttendance(b,plan,input,'qa',attendance,now);
 const meta=c.newMeta(),key=await c.derive('synthetic-only-test-password',meta),opened=await c.unseal(await c.seal(next,key,meta),key);
 assert.deepEqual(opened,next);const canonical=value=>[...value.ops].sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(canonical(c.merge(b,opened)),canonical(next));assert.deepEqual(canonical(c.merge(next,b)),canonical(next));
 const merged=await c.planBackupImport(b,next),blank=await c.planBackupImport(null,next);
 assert.equal(merged.summary.visitAttendance.addedMarks,1);assert.equal(merged.summary.visitAttendance.addedDays,1);
 assert.equal(blank.summary.visitAttendance.afterMarks,1);assert.equal(blank.summary.visitAttendance.afterDays,1);
 const change=merged.changes.find(v=>v.addedVisitAttendance.length);assert.equal(change.type,'source');assert.deepEqual(change.addedVisitAttendance[0].visitAttendance,attendance);
 assert.equal(c.monthlyVisitOverview(blank.bundle,c.monthlyVisitMonth()).completedCount,1);
});
test('feedback export remains independent and never leaks the manual confirmation source or other notes',async()=>{
 const {b,plan,input,now,attendance}=await fixture(),next=await c.applyMonthlyFeedbackWithAttendance(b,plan,input,'qa',attendance,now);
 const output=c.exportMonthlyFeedback(next,'大樹',c.monthlyVisitMonth()),text=JSON.stringify(output);
 assert.equal(output.stores[0].feedback[0].visitDate,attendance.date);
 assert.ok(!text.includes('manualVisitAttendance'));assert.ok(!text.includes('原始筆記'));assert.ok(!text.includes('原下次跟進'));
});
test('same feedback can receive an explicit confirmation later; repeated same-day confirmations count as one visited day',async()=>{
 const {b,plan,input,now,attendance}=await fixture();
 const onlyFeedback=await c.applyMonthlyFeedbackWithAttendance(b,plan,input,'qa',undefined,now);
 const checked=await c.applyMonthlyFeedbackWithAttendance(onlyFeedback,c.prepareMonthlyFeedback(onlyFeedback,plan.analysisId,0),input,'qa',attendance,now);
 assert.equal(checked.ops.length,onlyFeedback.ops.length+1);
 const twice=await c.applyMonthlyFeedbackWithAttendance(checked,c.prepareMonthlyFeedback(checked,plan.analysisId,0),input,'qa',attendance,now);
 assert.equal(c.visitAttendanceForStore(twice,'qa-alert-a').history.length,1);assert.equal(c.monthlyVisitOverview(twice,c.monthlyVisitMonth()).completedCount,1);
});
test('wrong store, changed date, extra keys, future instant and stale source fail without mutating the input bundle',async()=>{
 const {b,plan,input,now,attendance}=await fixture(),before=JSON.stringify(b);
 for(const value of [{...attendance,store:'qa-alert-b'},{...attendance,date:'2000-01-01'},{...attendance,confirmed:true},{...attendance,at:new Date(Date.parse(now)+1000).toISOString()}])await assert.rejects(c.applyMonthlyFeedbackWithAttendance(b,plan,input,'qa',value,now));
 await assert.rejects(c.applyMonthlyFeedbackWithAttendance(b,plan,{...input,visitDate:''},'qa',attendance,now));
 const changed=structuredClone(b);changed.ops.push(c.revision('person','synthetic-person',{name:'虛構甲',role:'',desc:'',confirmed:false,sameAs:''},[],'qa'));
 await assert.rejects(c.applyMonthlyFeedbackWithAttendance(changed,plan,input,'qa',attendance,now),/變更/);
 assert.equal(JSON.stringify(b),before);
});
test('Taipei midnight requires renewed consent and cannot apply yesterday confirmation to today',async()=>{
 const {b,plan,input}=await fixture(),day=c.monthlyVisitMonth()+'-07',before=day+'T15:59:59.999Z',after=day+'T16:00:00.000Z';
 const attendance=c.makeVisitAttendance(plan.storeId,before);
 await assert.rejects(c.applyMonthlyFeedbackWithAttendance(b,plan,{...input,visitDate:attendance.date},'qa',attendance,after),/日期/);
});
test('malformed/manual-source lookalikes cannot create valid attendance or replace raw provenance',async()=>{
 const {b,plan,input,now,attendance}=await fixture(),next=await c.applyMonthlyFeedbackWithAttendance(b,plan,input,'qa',attendance,now);
 for(const change of [op=>op.data.manualVisitAttendance.store='absent',op=>op.data.manualVisitAttendance.date='2000-01-01',op=>op.data.monthlyFeedback={},op=>op.data.file='external.json']){
  const bad=structuredClone(next);change(bad.ops.at(-1));assert.throws(()=>c.validateBundle(bad));
 }
 const bad=structuredClone(next);bad.blobs[bad.ops.at(-1).data.blob]=c.b64(new TextEncoder().encode('{}'));assert.throws(()=>c.validateBundle(bad),/原件/);
 const wrong=structuredClone(next.ops.at(-1));wrong.data.file='external.json';assert.equal(c.visitAttendanceEvidence(wrong),null);
 const incoming=new TextEncoder().encode(JSON.stringify({stores:[{name:'虛構',channel:'大樹',reason:'x',checkpoints:['x'],manualVisitAttendance:attendance}]}));assert.throws(()=>c.parseMonthlyAnalysis(incoming));
});
