import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as c from '../public/core.js';
import { uiNodeFixture } from './helpers/ui-node-fixture.mjs';

const now='2026-11-27T04:00:00.000Z',month='2026-11';
const names={a:'大樹藥局-虛構甲店',b:'佑全保健藥妝-虛構乙藥局',c:'大樹藥局-虛構丙店',d:'虛構獨立丁藥局'};
const row=(id,extra={})=>({name:names[id]||'虛構未套用店',channel:id==='b'?'佑全':'大樹',reason:'虛構分析原因，非正式資料',checkpoints:['虛構詢問項目'],...extra});
const file=(rows,suffix='')=>({name:'fictional-alert'+suffix+'.json',raw:new TextEncoder().encode(JSON.stringify({stores:rows}))});
async function fixture(){
 let b=c.emptyBundle('fictional-alert-planning');
 for(const id of Object.keys(names))b.ops.push(c.revision('store',id,{name:names[id],address:'虛構路'+id+'號',city:'虛構市',district:id==='c'?'乙區':'甲區',channel:id==='b'?'佑全':id==='d'?'獨立':'大樹',attr:'完整門市文字',contact:'',nextRemember:'不改既有提醒',everyTimeMust:'保留必做'},[],'test'));
 b.ops.push(c.revision('visit','note',{store:'a',text:'完整原文不改寫',date:'2026-11-27',next:'保留跟進',source:'虛構',people:[],topics:[],attachments:[]},[],'test'));
 b=await c.applyMonthlyPlanning(b,{kind:'roster',month,expectedBasis:c.monthlyPlanningBasis(b,'roster',month),storeIds:['a','d']},'test',now);
 const plan=await c.prepareMonthlyAnalysis(b,[file([row('a'),row('c'),row('skip')],'tree'),file([row('b')],'you')],'2026-10',month);
 return c.applyMonthlyAnalysis(b,plan,[['a','c','skip'],['b']],'test');
}
const overview=b=>c.monthlyAlertVisitOverview(b,month,now);
function edit(b,id,patch,deleted=false){const next=structuredClone(b),s=c.project(next).find(r=>r.id===id&&r.type==='store');next.ops.push(c.revision('store',id,{...s.heads[0].data,...patch},s.heads.map(h=>h.id),'edit',deleted));return next;}
function attend(b,id='a'){const next=structuredClone(b);next.ops.push(c.revision('visit','attendance-'+id,{store:id,text:'虛構到店確認',date:'',source:'',next:'',people:[],topics:[],attachments:[]},[],'test',false,c.makeVisitAttendance(id,now)));return next;}

test('monthly warning list is read-only, mixes channels by region and leaves recurring roster independent',async()=>{
 const b=await fixture(),before=JSON.stringify(b),o=overview(b);
 assert.deepEqual(o.stores.map(r=>r.storeId).sort(),['a','b','c']);assert.equal(o.completedCount,0,'a note date alone does not count');
 assert.deepEqual(o.stores.filter(r=>r.district==='甲區').map(r=>r.channel),['大樹','佑全']);
 assert.deepEqual(c.monthlyVisitOverview(b,month,now).stores.map(r=>r.storeId).sort(),['a','d']);
 assert.equal(o.unassigned.length,1);assert.equal(o.unassigned[0].name,'虛構未套用店');assert.equal(o.issues.length,0);
 assert.equal(JSON.stringify(b),before);assert.ok(o.stores.every(r=>r.salesMonth==='2026-10'));
});
test('one explicit attendance is reflected in both lists without creating a second visit; next month resets',async()=>{
 const b=attend(await fixture());const before=JSON.stringify(b);
 assert.equal(overview(b).completedCount,1);assert.equal(c.monthlyVisitOverview(b,month,now).completedCount,1);
 assert.deepEqual(overview(b).completed[0].dates,['2026-11-27']);
 const december=c.monthlyAlertVisitOverview(b,'2026-12','2026-12-02T04:00:00.000Z');assert.equal(december.sources.length,0);assert.equal(december.total,0);
 const fixed=c.monthlyVisitOverview(b,'2026-12','2026-12-02T04:00:00.000Z');assert.equal(fixed.total,2);assert.equal(fixed.completedCount,0);
 assert.equal(JSON.stringify(b),before);
});
test('latest same-channel revision replaces warning membership without changing the other channel or old history',async()=>{
 let b=await fixture();const original=structuredClone(b),p=await c.prepareMonthlyAnalysis(b,[file([row('c')],'revision')],'2026-10',month);
 b=await c.applyMonthlyAnalysis(b,p,[['c']],'test',true);
 assert.deepEqual(overview(b).stores.map(r=>r.storeId).sort(),['b','c']);assert.equal(c.monthlyAnalysisSources(b).length,3);
 assert.deepEqual(b.ops.slice(0,original.ops.length),original.ops);
 assert.deepEqual(c.monthlyVisitOverview(b,month,now).stores.map(r=>r.storeId).sort(),['a','d']);
});
test('conflicting sources exclude only their channel and never choose a clock winner',async()=>{
 const base=await fixture();const plan=await c.prepareMonthlyAnalysis(base,[file([row('c')],'fork')],'2026-10',month);
 const left=await c.applyMonthlyAnalysis(base,plan,[['c']],'left',true),right=await c.applyMonthlyAnalysis(base,plan,[['c']],'right',true);
 const b=c.merge(left,right),o=overview(b);assert.deepEqual(o.stores.map(r=>r.storeId),['b']);assert.equal(o.issues.length,1);assert.match(o.issues[0].reason,/分歧/);
});
test('identity changes, removed stores and missing regions remain explicit rather than guessed',async()=>{
 const b=await fixture();for(const bad of [edit(b,'a',{name:'大樹藥局-虛構改名店'}),edit(b,'a',{address:'改址'}),edit(b,'a',{},true),edit(b,'a',{csvIdentityPending:true})]){
  const o=overview(bad);assert.ok(!o.stores.some(r=>r.storeId==='a'));assert.equal(o.issues.length,1);
 }
 const missing=overview(edit(b,'a',{city:'',district:''}));assert.equal(missing.missingRegionCount,1);assert.ok(missing.stores.some(r=>r.storeId==='a'&&r.city===''&&r.district===''));
});
test('v2 requires the still-valid human store-code mapping, with legacy v1 kept working',async()=>{
 let b=await fixture();const raw={format:'yq-alert-2',salesMonth:'2026-10',visitMonth:month,channel:'佑全',coreChecks:structuredClone(c.YQ_CORE_CHECKS),stores:[{...row('b'),storeCode:'4321',previousResult:null,checks:[]}]};
 const f={name:'fictional-v2.json',raw:new TextEncoder().encode(JSON.stringify(raw))},p=await c.prepareMonthlyAnalysis(b,[f],'2026-10',month);
 b=await c.applyMonthlyAnalysis(b,p,[['b']],'test',true);assert.deepEqual(overview(b).stores.map(r=>r.storeId).sort(),['a','b','c']);
 const code=c.analysisStoreCodeState(b,'佑全','4321');b=await c.revokeAnalysisStoreCode(b,'佑全','4321',code.current.entity,'test');
 assert.deepEqual(overview(b).stores.map(r=>r.storeId).sort(),['a','c']);assert.match(overview(b).issues[0].reason,/店碼對照/);
});

const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function implementation(){const from=app.indexOf('function monthlyVisitLabel('),to=app.indexOf('// A pending version probe',from);return app.slice(from,to);}
async function ui(){const bundle=await fixture(),{node}=uiNodeFixture();const ctx=vm.createContext({...c,Map,Set,Date,monthlyVisitSection:'required',monthlyVisitSelectedMonth:month,monthlyVisitNotice:'',monthlyVisitViewBasis:'',payload:{bundle},records:c.project(bundle),$:node,renderDayPlanEntry(){},monthlyFocusHTML:()=>'',analysisOverviewHTML:()=>'',retailChannel:store=>({id:store?.channel==='大樹'?'great-tree':store?.channel==='佑全'?'you-chuan':'independent'}),by:(type,id)=>c.project(ctx.payload.bundle).find(r=>r.type===type&&r.id===id),esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')});vm.runInContext(implementation(),ctx);ctx.renderMonthlyVisits();return{ctx,node};}
test('real monthly UI shows warning badges in fixed list, mixes channels and never offers warning roster writes',async()=>{
 const {ctx,node}=await ui(),before=JSON.stringify(ctx.payload.bundle);let html=node('monthly-visit-results').innerHTML;
 assert.match(html,/10月警示店/);assert.match(html,/data-monthly-section="alerts"/);
 const storeRows=[...html.matchAll(/<div class="monthly-store-row">[\s\S]*?<\/div>/g)].map(m=>m[0]);const rowA=storeRows.find(r=>r.includes('data-visit-brief="a"'));assert.match(rowA,/10月警示店/);assert.doesNotMatch(storeRows.find(r=>r.includes('data-visit-brief="d"')),/10月警示店/);
 ctx.monthlyVisitSection='alerts';ctx.renderMonthlyVisits();html=node('monthly-visit-results').innerHTML;
 assert.doesNotMatch(html,/data-monthly-remove|data-monthly-add-back|data-monthly-channel/);assert.equal(node('monthly-add-store').hidden,true);assert.equal(node('monthly-roster-settings').hidden,true);
 const region=[...html.matchAll(/<section class="monthly-district">[\s\S]*?<\/section>/g)].map(m=>m[0]).find(s=>s.includes('甲區'));assert.match(region,/虛構甲店/);assert.match(region,/虛構乙藥局/);assert.match(html,/同時為每月必訪/);assert.match(html,/本期未套用/);
 ctx.monthlyVisitSelectedMonth='2026-12';ctx.renderMonthlyVisits();html=node('monthly-visit-results').innerHTML;assert.match(html,/尚未匯入警示名單/);assert.doesNotMatch(html,/10月警示店/);
 ctx.monthlyVisitSection='required';ctx.renderMonthlyVisits();assert.match(node('monthly-visit-results').innerHTML,/虛構獨立丁藥局/);assert.equal(JSON.stringify(ctx.payload.bundle),before);
});
