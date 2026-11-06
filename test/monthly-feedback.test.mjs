import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../public/core.js';
const month='2026-11',sales='2026-10';
const profile=(name,channel='大樹')=>({name,channel,address:'虛構路1號',city:'虛構市',district:'虛構區',attr:'原特性',contact:'原窗口',nextRemember:'原待辦不動'});
function fixture(){const b=c.emptyBundle('synthetic-feedback');b.ops.push(c.revision('store','a',profile('大樹虛構甲店'),[],'test'),c.revision('store','b',profile('大樹虛構乙店'),[],'test'),c.revision('store','other',profile('佑全虛構甲店','佑全'),[],'test'),c.revision('visit','v',{store:'a',date:'',text:'原筆記\r\n保留',source:'虛構',next:'原跟進',topics:[],people:[],attachments:[]},[],'test'));return b;}
const file=(reason='虛構建議',name='001大樹虛構甲店')=>({name:'synthetic.json',raw:new TextEncoder().encode(JSON.stringify({stores:[{name,channel:'大樹',reason,checkpoints:['庫存幾盒？','現場詢問結果？']}]}))});
async function imported(){const b=fixture();return c.applyMonthlyAnalysis(b,await c.prepareMonthlyAnalysis(b,[file()],sales,month),[['a']],'test');}
const target=b=>c.monthlyAnalysisSources(b).at(-1).id;
const input=(answers=['0','尚未詢問'])=>({visitDate:'2026-11-07',answers,notes:''});
const add=async(b,answers)=>c.applyMonthlyFeedback(b,c.prepareMonthlyFeedback(b,target(b),0,month),input(answers),'test',month);
test('feedback adds only one immutable source and raw blob; original notes, tasks and identities survive encryption and backup',async()=>{
 const b=await imported(),before=structuredClone(b),next=await add(b,['0','不知道']);assert.deepEqual(b,before);assert.deepEqual(next.ops.slice(0,b.ops.length),b.ops);assert.equal(next.ops.length,b.ops.length+1);assert.equal(next.ops.at(-1).type,'source');assert.equal(next.ops.at(-1).data.monthlyFeedback.answers[0].text,'0');assert.equal(next.ops.at(-1).visitAttendance,undefined);
 const meta=c.newMeta(),key=await c.derive('synthetic-only-password',meta),sealed=await c.seal(next,key,meta);assert.deepEqual(await c.unseal(sealed,key),next);const p=await c.planBackupImport(null,next);assert.deepEqual(p.bundle,next);
});
test('blank answers stay unknown; no response cannot be saved; date may be unknown and invalid dates rejected',async()=>{
 const b=await imported(),p=c.prepareMonthlyFeedback(b,target(b),0,month);await assert.rejects(c.applyMonthlyFeedback(b,p,input(['','']),'x',month));
 const next=await c.applyMonthlyFeedback(b,p,{visitDate:'',answers:['','實際回覆'],notes:''},'x',month);assert.equal(next.ops.at(-1).data.monthlyFeedback.answers[0].text,'');assert.equal(next.ops.at(-1).data.monthlyFeedback.visitDate,'');
 await assert.rejects(c.applyMonthlyFeedback(b,p,{...input(),visitDate:'2026-02-30'},'x',month));
});
test('editing preserves history, no-op saves are idempotent and cannot target another question or month',async()=>{
 let b=await imported();b=await add(b,['4','未詢問']);const first=c.monthlyFeedbackState(b,target(b),0).current.entity;const same=await add(b,['4','未詢問']);assert.equal(same,b);
 const next=await add(b,['5','已詢問']);const state=c.monthlyFeedbackState(next,target(next),0);assert.equal(state.history.length,2);assert.deepEqual(state.current.data.monthlyFeedback.replaces,[first]);
 const forged=structuredClone(next);forged.ops.at(-1).data.monthlyFeedback.answers[0].question='另一題';assert.throws(()=>c.validateBundle(forged),/題目/);
 assert.throws(()=>c.prepareMonthlyFeedback(next,target(next),0,'2026-12'),/過期/);
});
test('source changes and altered plans fail; no cross-store attribution',async()=>{
 const b=await imported(),p=c.prepareMonthlyFeedback(b,target(b),0,month),changed=structuredClone(b);changed.ops.push(c.revision('store','b',{...c.project(b).find(s=>s.id==='b').heads[0].data,contact:'新的窗口'},c.project(b).find(s=>s.id==='b').heads.map(h=>h.id),'other'));
 await assert.rejects(c.applyMonthlyFeedback(changed,p,input(),'x',month),/變更/);
 const forged=structuredClone(p);forged.storeId='b';await assert.rejects(c.applyMonthlyFeedback(b,forged,input(),'x',month));
 const next=await add(b);next.ops.at(-1).data.monthlyFeedback.storeHead=b.ops.find(op=>op.entity==='b').id;assert.throws(()=>c.validateBundle(next),/門市版本/);
});
test('parallel replies retain both branches and require explicit reviewed replacement',async()=>{
 const b=await imported(),left=await add(b,['1','左']),right=await add(b,['2','右']),joined=c.merge(left,right),state=c.monthlyFeedbackState(joined,target(joined),0);assert.equal(state.conflict,true);assert.equal(state.current,null);
 const output=c.exportMonthlyFeedback(joined,'大樹',month);assert.equal(output.stores[0].status,'conflicting-feedback');assert.equal(output.stores[0].feedback.length,2);assert.equal(output.stores[0].needsReview,true);
 const revised=await add(joined,['3','人工重新核對']);assert.equal(c.monthlyFeedbackState(revised,target(revised),0).heads.length,1);assert.equal(c.monthlyFeedbackState(revised,target(revised),0).history.length,3);
});
test('revision of analysis archives old feedback; other channel and period stay separate; export is minimal and read-only',async()=>{
 let b=await imported();b=await add(b,['8','已詢問']);const oldId=target(b);const p=await c.prepareMonthlyAnalysis(b,[file('修訂')],sales,month);b=await c.applyMonthlyAnalysis(b,p,[['b']],'test',true);
 const before=structuredClone(b),out=c.exportMonthlyFeedback(b,'大樹',month),all=c.exportMonthlyFeedback(b,'大樹',month,{includeHistory:true});assert.equal(out.stores.length,1);assert.equal(out.stores[0].storeId,'b');assert.equal(out.stores[0].status,'not-reported');assert.equal(all.stores.length,2);assert.ok(all.stores.find(s=>s.analysis.id===oldId).historical);assert.deepEqual(b,before);
 assert.equal(c.exportMonthlyFeedback(b,'佑全',month).stores.length,0);assert.equal(c.exportMonthlyFeedback(b,'大樹','2026-12').stores.length,0);for(const key of ['原筆記','原待辦','原窗口'])assert.ok(!JSON.stringify(all).includes(key));
});
test('remembered mappings require exact external name, channel and unchanged current store identity; never infer first import',async()=>{
 let b=fixture();const row=c.parseMonthlyAnalysis(file().raw)[0];assert.equal(c.rememberedMonthlyAnalysisChoice(b,row),'');b=await imported();assert.equal(c.rememberedMonthlyAnalysisChoice(b,row),'a');assert.equal(c.rememberedMonthlyAnalysisChoice(b,{...row,name:'大樹虛構甲店'}),'');assert.equal(c.rememberedMonthlyAnalysisChoice(b,{...row,channel:'佑全'}),'');
 const s=c.project(b).find(s=>s.id==='a');b.ops.push(c.revision('store','a',{...s.heads[0].data,address:'另一地址'},s.heads.map(h=>h.id),'test'));assert.equal(c.rememberedMonthlyAnalysisChoice(b,row),'');
});
test('monthly change preview only counts independent analysis membership, not deletion of stores',async()=>{
 const b=await imported(),p=await c.prepareMonthlyAnalysis(b,[file('下期')],'2026-11','2026-12');assert.deepEqual(c.monthlyAnalysisChangeSummary(b,p,[['b']]),[{channel:'大樹',previousMonth:month,needsReview:false,added:1,updated:0,archived:1}]);
});
test('forged parents, raw mismatch, cycles and a feedback placed on a visit are rejected',async()=>{
 const b=await add(await imported()),op=b.ops.at(-1);assert.equal(c.validData('visit',{...b.ops.find(o=>o.type==='visit').data,monthlyFeedback:op.data.monthlyFeedback}),false);
 const raw=structuredClone(b);raw.blobs[op.data.blob]=c.b64(new TextEncoder().encode('{}'));assert.throws(()=>c.validateBundle(raw),/原件/);
 const cycle=structuredClone(b);cycle.ops.at(-1).data.monthlyFeedback.replaces=[op.entity];cycle.blobs[op.data.blob]=c.b64(new TextEncoder().encode(JSON.stringify(cycle.ops.at(-1).data.monthlyFeedback)));assert.throws(()=>c.validateBundle(cycle),/接替/);
});

test('homepage alerts follow the selected calendar month and immutable confirmed store identity without modifying records',async()=>{
 const b=await imported(),before=JSON.stringify(b);
 assert.deepEqual([...c.monthlyAlertStoreIds(b,month)],['a']);
 assert.equal(c.monthlyAlertStoreIds(b,'2026-10').size,0);assert.equal(c.monthlyAlertStoreIds(b,'2026-12').size,0);
 const reported=await add(b,['0','已詢問']);assert.deepEqual([...c.monthlyAlertStoreIds(reported,month)],['a']);
 assert.equal(JSON.stringify(b),before);
 const s=c.project(b).find(s=>s.id==='a'),changed=structuredClone(b);changed.ops.push(c.revision('store','a',{...s.heads[0].data,address:'虛構異動路2號'},s.heads.map(h=>h.id),'test'));
 assert.equal(c.monthlyAlertStoreIds(changed,month).size,0);
});
test('homepage alerts exclude superseded, skipped and conflicting monthly sources rather than choosing a name or clock winner',async()=>{
 const b=await imported(),p=await c.prepareMonthlyAnalysis(b,[file('修訂乙')],sales,month);
 const left=await c.applyMonthlyAnalysis(b,p,[['b']],'left',true),right=await c.applyMonthlyAnalysis(b,p,[['a']],'right',true);
 assert.deepEqual([...c.monthlyAlertStoreIds(left,month)],['b']);
 assert.equal(c.monthlyAlertStoreIds(c.merge(left,right),month).size,0);
 const skipped=await c.applyMonthlyAnalysis(b,p,[['skip']],'test',true);assert.equal(c.monthlyAlertStoreIds(skipped,month).size,0);
});
