import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../public/core.js';
const sales='2026-10',month='2026-11';
const profile=(name,channel='')=>({name,channel,address:'虛構路1號',city:'虛構市',district:'虛構區',attr:'原特性',contact:'原窗口',nextRemember:'原提醒'});
const file=(channel,name,reason='虛構建議')=>({name:'synthetic-'+channel+'.json',raw:new TextEncoder().encode(JSON.stringify({stores:[{name,channel,reason,checkpoints:['虛構現場問題？']}]}))});
function fixture(){const b=c.emptyBundle('synthetic-youquan-group');
 for(const [id,name,ch] of [['tree','大樹藥局-虛構甲店','大樹'],['health','健康人生藥局-虛構甲店藥局',''],['you','佑全保健藥妝-虛構乙藥局','佑全'],['conflict','健康人生藥局-虛構甲店藥局','大樹'],['other','健康人生診所-虛構甲店','']])b.ops.push(c.revision('store',id,profile(name,ch),[],'test'));
 b.ops.push(c.revision('visit','v',{store:'health',date:'',text:'原拜訪文字',next:'原跟進',source:'虛構',people:[],topics:[],attachments:[]},[],'test'));
 return b;}
test('Health Life store aliases are only candidates in the You Chuan channel; conflicting identity and lookalike names excluded',()=>{
 const b=fixture(),row=c.parseMonthlyAnalysis(file('佑全','A123虛構甲').raw)[0],matches=c.monthlyAnalysisCandidates(row,c.project(b));
 assert.deepEqual(matches.map(x=>x.store.id).sort(),['health','you']);assert.equal(matches[0].store.id,'health');assert.equal(matches[0].exact,true);
 assert.equal(c.analysisStoreChannel({name:'大樹虛構甲店',channel:'健康人生'}),'');
 assert.equal(c.analysisStoreChannel({name:'健康人生藥局-虛構甲店藥局',channel:'佑全'}),'佑全');
 assert.equal(c.analysisStoreChannel({name:'健康人生診所-虛構甲店',channel:''}),'');
 assert.equal(c.analysisName('佑全保健藥妝-虛構乙藥局'),c.analysisName('123虛構乙'));
 assert.equal(c.analysisChannel('健康人生'),''); // External file contract is not expanded.
 assert.equal(c.rememberedMonthlyAnalysisChoice(b,row),'');
});
test('You Chuan imports and feedback do not replace same-month Great Tree sources, answers, notes or identities',async()=>{
 let b=fixture();const treeFile=file('大樹','001虛構甲');
 b=await c.applyMonthlyAnalysis(b,await c.prepareMonthlyAnalysis(b,[treeFile],sales,month),[['tree']],'test');
 const treeId=c.monthlyAnalysisSources(b).at(-1).id;
 b=await c.applyMonthlyFeedback(b,c.prepareMonthlyFeedback(b,treeId,0,month),{visitDate:'2026-11-01',answers:['原大樹回答'],notes:''},'test',month);
 const before=structuredClone(b),treeReport=c.exportMonthlyFeedback(b,'大樹',month,{at:'2026-11-08T00:00:00.000Z'});
 const youFile=file('佑全','A123虛構甲'),plan=await c.prepareMonthlyAnalysis(b,[youFile],sales,month);
 await assert.rejects(c.applyMonthlyAnalysis(b,plan,[['']],'test'));
 await assert.rejects(c.applyMonthlyAnalysis(b,plan,[['tree']],'test'));
 b=await c.applyMonthlyAnalysis(b,plan,[['health']],'test');
 const youId=c.monthlyAnalysisSources(b).at(-1).id;
 assert.deepEqual(c.monthlyAnalysisSources(b).at(-1).supersedes,[]);
 b=await c.applyMonthlyFeedback(b,c.prepareMonthlyFeedback(b,youId,0,month),{visitDate:'',answers:['佑全自己的回答'],notes:''},'test',month);
 const revised=file('佑全','A123虛構甲','虛構佑全修訂');
 b=await c.applyMonthlyAnalysis(b,await c.prepareMonthlyAnalysis(b,[revised],'2026-09',month),[['health']],'test',true);
 assert.deepEqual(c.monthlyAnalysisSources(b).at(-1).supersedes,[youId]);
 assert.deepEqual(c.exportMonthlyFeedback(b,'大樹',month,{at:'2026-11-08T00:00:00.000Z'}),treeReport);
 assert.deepEqual(b.ops.slice(0,before.ops.length),before.ops);
 assert.deepEqual(b.ops.filter(o=>o.type!=='source'),before.ops.filter(o=>o.type!=='source'));
 assert.equal(c.monthlyAnalysisForStore(b,'tree',month).filter(x=>x.current).length,1);
 assert.deepEqual([...c.monthlyAlertStoreIds(b,month)].sort(),['health','tree']);
 assert.deepEqual(c.monthlyAlertSalesMonths(b,month),new Map([['tree','2026-10'],['health','2026-09']]));
 c.validateBundle(b);
});
test('Missing stores stay unassigned and their complete original row is retained without creating a store',async()=>{
 const b=fixture(),rawFile=file('佑全','999虛構缺店'),plan=await c.prepareMonthlyAnalysis(b,[rawFile],sales,month);
 assert.equal(plan.files[0].candidates[0].filter(x=>x.exact).length,0);
 const next=await c.applyMonthlyAnalysis(b,plan,[['skip']],'test');
 assert.equal(c.project(next).filter(x=>x.type==='store').length,c.project(b).filter(x=>x.type==='store').length);
 assert.deepEqual(next.ops.slice(0,b.ops.length),b.ops);
 assert.equal(next.blobs[plan.files[0].hash],c.b64(rawFile.raw));
 assert.equal(c.monthlyAnalysisSources(next)[0].assignments[0].storeId,'');
 assert.equal(c.monthlyAlertStoreIds(next,month).size,0);
});
