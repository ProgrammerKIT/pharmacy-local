import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import * as c from '../public/core.js';import {makeFixture} from './qa/compact-reading-fixture.mjs';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
async function harness(){const b=await makeFixture(c),ctx=vm.createContext({...c,payload:{bundle:b},esc,dateText:v=>v});
 vm.runInContext(source.slice(source.indexOf('function analysisReadingState('),source.indexOf('function analysisOverviewHTML(')),ctx);
 vm.runInContext(source.slice(source.indexOf('function monthlyFeedbackHTML('),source.indexOf('function assertMonthlyFeedbackCurrent(')),ctx);
 vm.runInContext(source.slice(source.indexOf('function typedFeedbackHTML('),source.indexOf('function singleStoreCaptureHTML(')),ctx);
 return {b,ctx,store:id=>c.project(b).find(s=>s.type==='store'&&s.id===id)};}
test('saved legacy feedback is below original route, collapsed, traceable and exported unchanged',async()=>{
 const h=await harness(),before=JSON.stringify(h.b),month=c.monthlyVisitMonth(),old=c.exportMonthlyFeedback(h.b,'大樹',month,{at:'2026-11-14T00:00:00.000Z'});
 assert.equal(h.ctx.monthlyAnalysisStoreHTML(h.store('saved'),'attention'),'');
 const html=h.ctx.monthlyAnalysisStoreHTML(h.store('saved'),'saved');assert.match(html,/已填 4／4 題/);assert.match(html,/查看已保存答案/);assert.match(html,/已確認陳列位置/);assert.match(html,/修改／補充現場回報/);assert.doesNotMatch(html,/<details[^>]*\bopen(?:[\s=>])/);
 assert.equal(JSON.stringify(h.b),before);assert.deepEqual(c.exportMonthlyFeedback(h.b,'大樹',month,{at:'2026-11-14T00:00:00.000Z'}),old);
 const layout=source.slice(source.indexOf('const historyHTML ='),source.indexOf('function canonicalPerson('));assert.ok(layout.indexOf('${historyHTML}')<layout.indexOf("monthlyAnalysisStoreHTML(brief.store,'saved')"));
});
test('unanswered, source review and drafts remain attention, never inferred complete',async()=>{
 const h=await harness();assert.match(h.ctx.monthlyAnalysisStoreHTML(h.store('pending'),'attention'),/尚未回報/);
 const item={...c.monthlyAnalysisForStore(h.b,'saved')[0],storeId:'saved'};
 h.ctx.payload.monthlyFeedbackDraft={analysisId:item.id,rowIndex:0};assert.match(h.ctx.monthlyAnalysisStoreHTML(h.store('saved'),'attention'),/有未完成草稿/);assert.equal(h.ctx.monthlyAnalysisStoreHTML(h.store('saved'),'saved'),'');
 delete h.ctx.payload.monthlyFeedbackDraft;assert.equal(h.ctx.analysisReadingState({...item,needsReview:true}).attention,true);
});
test('legacy conflicts stay prominent while complete answer variants and history survive',async()=>{
 const h=await harness(),item={...c.monthlyAnalysisForStore(h.b,'saved')[0],storeId:'saved'},p=c.prepareMonthlyFeedback(h.b,item.id,0);
 const input={visitDate:c.monthlyVisitMonth()+'-01',answers:['版本甲','','',''],notes:''};
 const left=await c.applyMonthlyFeedback(h.b,p,input,'left');input.answers[0]='版本乙';const right=await c.applyMonthlyFeedback(h.b,p,input,'right');h.ctx.payload.bundle=c.merge(left,right);
 const html=h.ctx.monthlyAnalysisStoreHTML(h.store('saved'),'attention');assert.match(html,/回報分歧需核對/);assert.match(html,/版本甲/);assert.match(html,/版本乙/);assert.match(html,/過去回報/);
});
test('typed saved reports collapse without losing zero, null, new visit, revision or export',async()=>{
 const h=await harness(),before=JSON.stringify(h.b),month=c.monthlyVisitMonth(),options={appVersion:'1.5.106',at:'2026-11-14T00:00:00.000Z'},old=c.exportTypedFeedback(h.b,'佑全',month,options);
 const html=h.ctx.monthlyAnalysisStoreHTML(h.store('typed'),'saved');assert.match(html,/已保存 1 次回報/);assert.match(html,/未作答/);assert.match(html,/：0/);assert.match(html,/修改這次回報/);assert.match(html,/新增一次拜訪/);assert.doesNotMatch(html,/<details[^>]*\bopen(?:[\s=>])/);
 assert.equal(JSON.stringify(h.b),before);assert.deepEqual(c.exportTypedFeedback(h.b,'佑全',month,options),old);
 const item={...c.monthlyAnalysisForStore(h.b,'typed')[0],storeId:'typed'};h.ctx.payload.draft={typedFeedback:{analysisId:item.id,rowIndex:0}};assert.match(h.ctx.monthlyAnalysisStoreHTML(h.store('typed'),'attention'),/有未完成草稿/);
});
