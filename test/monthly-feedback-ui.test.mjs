import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as c from '../public/core.js';
import {makeFixture} from './qa/monthly-feedback-fixture.mjs';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
async function harness(){
 const b=await makeFixture(c),analysis=c.monthlyAnalysisSources(b)[0],plan=c.prepareMonthlyFeedback(b,analysis.id,0),nodes=new Map(),answers=[{value:'0'},{value:''}],writes=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',open:true,close(){this.open=false;}});return nodes.get(id);};
 $('monthly-feedback-date').value='';$('monthly-feedback-notes').value='';
 const ctx=vm.createContext({JSON,Date,Number,Set,Map,Promise,clearTimeout,setTimeout,key:{},meta:{},syncEpoch:0,payload:{bundle:b,device:'qa'},monthlyFeedbackContext:null,pendingLock:false,updateHolding:false,syncInProgress:false,document:{hidden:false,querySelectorAll:()=>answers},$,monthlyVisitMonth:c.monthlyVisitMonth,monthlyFeedbackState:c.monthlyFeedbackState,prepareMonthlyFeedback:c.prepareMonthlyFeedback,applyMonthlyFeedback:c.applyMonthlyFeedback,applyMonthlyFeedbackWithAttendance:c.applyMonthlyFeedbackWithAttendance,attendanceTaipeiDate:c.attendanceTaipeiDate,exportMonthlyFeedback:c.exportMonthlyFeedback,
  esc:v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),dateText:v=>v,run:async fn=>fn(),render(){},openVisitBrief(){},toast:t=>ctx.toastText=t,confirm:()=>ctx.accept,confirmStoreSave:async()=>{if(ctx.onAttendancePrompt)ctx.onAttendancePrompt();return ctx.accept?{attendance:ctx.attendance}:null;},syncScheduler:{wake(){}},download:(text,name)=>ctx.downloaded={text,name},
  persist:async(next,{guard}={})=>{if(ctx.beforePersist)ctx.beforePersist(next);guard?.();writes.push(next);ctx.payload=next;}});
 vm.runInContext(source.slice(source.indexOf('function monthlyFeedbackHTML('),source.indexOf("$('monthly-analysis-dialog').addEventListener('submit',event=>{if(event.target.id==='monthly-feedback-form')")),ctx);
 ctx.monthlyFeedbackContext={plan,bundle:b,key:ctx.key,meta:ctx.meta,epoch:0,chain:Promise.resolve(),generation:0};
 return {ctx,b,analysis,plan,$,answers,writes};
}
test('cancel never creates formal feedback; save preserves zero versus unknown and only appends one source',async()=>{
 const h=await harness();h.ctx.accept=false;await h.ctx.saveMonthlyFeedback({preventDefault(){}});assert.equal(h.writes.filter(w=>w.bundle!==h.b).length,0);assert.ok(h.ctx.payload.monthlyFeedbackDraft);
 h.ctx.accept=true;await h.ctx.saveMonthlyFeedback({preventDefault(){}});assert.equal(h.ctx.payload.bundle.ops.length,h.b.ops.length+1);assert.deepEqual(h.ctx.payload.bundle.ops.slice(0,h.b.ops.length),h.b.ops);const value=h.ctx.payload.bundle.ops.at(-1).data.monthlyFeedback;assert.equal(value.answers[0].text,'0');assert.equal(value.answers[1].text,'');assert.equal(h.ctx.payload.monthlyFeedbackDraft,null);
});
test('changed source, locked, hidden and write failures keep input and never report success',async()=>{
 for(const mode of ['hidden','lock','epoch','disk']){
  const h=await harness();h.ctx.accept=true;
  if(mode==='hidden')h.ctx.document.hidden=true;if(mode==='lock')h.ctx.pendingLock=true;if(mode==='epoch')h.ctx.syncEpoch++;
  if(mode==='disk')h.ctx.beforePersist=next=>{if(next.bundle!==h.b)throw Error('synthetic disk failure');};
  await assert.rejects(h.ctx.saveMonthlyFeedback({preventDefault(){}}));assert.equal(h.writes.filter(w=>w.bundle!==h.b).length,0);assert.equal(h.ctx.toastText,undefined);assert.equal(h.answers[0].value,'0');assert.ok(h.ctx.monthlyFeedbackContext);
 }
});
test('close retains encrypted device draft, while explicit discard never deletes saved sources',async()=>{
 const h=await harness();h.ctx.accept=true;await h.ctx.closeMonthlyFeedback(false);assert.equal(h.ctx.payload.monthlyFeedbackDraft.answers[0],'0');assert.equal(h.ctx.payload.bundle,h.b);assert.equal(h.ctx.monthlyFeedbackContext,null);
 const d=await harness();d.ctx.accept=true;await d.ctx.closeMonthlyFeedback(true);assert.equal(d.ctx.payload.monthlyFeedbackDraft,null);assert.equal(d.ctx.payload.bundle,d.b);
});
test('feedback HTML escapes original questions, shows unknown and keeps historical revision readable',async()=>{
 const h=await harness(),item={...h.analysis,row:{...h.analysis.rows[0],checkpoints:['<script>bad</script>']},storeId:'qa-alert-a',current:true};
 const html=h.ctx.monthlyFeedbackHTML(item);assert.match(html,/未回答不代表零/);assert.match(html,/data-feedback-open/);assert.doesNotMatch(html,/<script>/);
});
test('export confirmation cancel is inert and unknown replies are exported without visit text or tasks',async()=>{
 const h=await harness();h.$('feedback-export-channel').value='大樹';h.$('feedback-export-month').value=c.monthlyVisitMonth();h.$('feedback-export-history').checked=false;
 h.ctx.accept=false;h.ctx.downloadMonthlyFeedbackExport();assert.equal(h.ctx.downloaded,undefined);
 h.ctx.accept=true;h.ctx.downloadMonthlyFeedbackExport();const output=JSON.parse(h.ctx.downloaded.text);assert.equal(output.stores[0].status,'not-reported');assert.equal(output.stores[0].feedback.length,0);assert.ok(!h.ctx.downloaded.text.includes('原始筆記'));assert.equal(h.writes.length,0);
});
test('calendar refresh removes stale homepage markers without re-rendering titles, drafts or notes',async()=>{
 const bundle=await makeFixture(c),slots=[{dataset:{monthlyAlertStore:'qa-alert-a'},innerHTML:''},{dataset:{monthlyAlertStore:'qa-alert-other'},innerHTML:''}];
 let scans=0,period=c.monthlyVisitMonth();
 const ctx=vm.createContext({payload:{bundle},document:{hidden:false,querySelectorAll:()=>slots},monthlyVisitMonth:()=>period,monthlyAlertSalesMonths:(...args)=>{scans++;return c.monthlyAlertSalesMonths(...args);},esc:value=>String(value)});
 vm.runInContext(source.slice(source.indexOf('var monthlyAlertBadgeCache;'),source.indexOf('function visitStoreNameHTML(')),ctx);
 const salesMonth = c.monthlyAnalysisSources(bundle)[0].salesMonth;
 ctx.refreshMonthlyAlertBadges();assert.ok(slots[0].innerHTML.includes(Number(salesMonth.slice(-2))+'月警示店'));assert.equal(slots[1].innerHTML,'');
 ctx.refreshMonthlyAlertBadges();assert.equal(scans,1);
 period='9999-12';ctx.refreshMonthlyAlertBadges();assert.equal(slots[0].innerHTML,'');assert.equal(scans,2);
 assert.equal(ctx.payload.bundle,bundle);
});

test('checked final confirmation updates today and persists feedback plus attendance in one formal write',async()=>{
 const h=await harness();h.ctx.accept=true;h.ctx.attendance=c.makeVisitAttendance(h.plan.storeId);h.$('monthly-feedback-date').value='2000-01-01';
 await h.ctx.saveMonthlyFeedback({preventDefault(){}});
 const formal=h.writes.filter(w=>w.bundle!==h.b);assert.equal(formal.length,1);
 assert.equal(c.visitAttendanceForStore(h.ctx.payload.bundle,h.plan.storeId).latestDate,h.ctx.attendance.date);
 assert.equal(h.ctx.payload.bundle.ops.findLast(op=>op.data.monthlyFeedback).data.monthlyFeedback.visitDate,h.ctx.attendance.date);
 assert.match(h.ctx.toastText,/已確認今天拜訪/);
});
test('source changes during final confirmation abort both feedback and attendance',async()=>{
 const h=await harness();h.ctx.accept=true;h.ctx.attendance=c.makeVisitAttendance(h.plan.storeId);h.ctx.onAttendancePrompt=()=>h.ctx.syncEpoch++;
 await assert.rejects(h.ctx.saveMonthlyFeedback({preventDefault(){}}));assert.equal(h.writes.filter(w=>w.bundle!==h.b).length,0);assert.ok(h.ctx.payload.monthlyFeedbackDraft);assert.equal(h.ctx.toastText,undefined);
});
test('checked save failure keeps corrected-date draft and writes neither feedback nor attendance',async()=>{
 const h=await harness();h.ctx.accept=true;h.ctx.attendance=c.makeVisitAttendance(h.plan.storeId);h.$('monthly-feedback-date').value='2000-01-01';h.ctx.beforePersist=next=>{if(next.bundle!==h.b)throw Error('synthetic disk failure');};
 await assert.rejects(h.ctx.saveMonthlyFeedback({preventDefault(){}}));assert.equal(h.ctx.payload.bundle,h.b);assert.equal(h.ctx.payload.monthlyFeedbackDraft.visitDate,h.ctx.attendance.date);assert.equal(h.ctx.toastText,undefined);
});
