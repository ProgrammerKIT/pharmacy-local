import test from 'node:test';import assert from 'node:assert/strict';
import * as c from '../public/core.js';
const at='2026-11-14T11:00:00.000Z', month='2026-11';
function fixture(){const b=c.emptyBundle('fictional-planning');for(const id of ['a','b'])b.ops.push(c.revision('store',id,{name:'虛構'+id,city:'虛構市',district:'甲區',address:'虛構路1號',channel:'',attr:'原文不能改',contact:'',nextRemember:'保留提醒'},[],'qa'));b.ops.push(c.revision('visit','note',{store:'a',date:'2026-11-14',text:'寫筆記不等於到店',next:'保留跟進',source:'虛構',people:[],topics:[],attachments:[]},[],'qa'));return b;}
const apply=(b,kind,month,value,time=at)=>c.applyMonthlyPlanning(b,{kind,month,expectedBasis:c.monthlyPlanningBasis(b,kind,month),[kind==='focus'?'text':'storeIds']:value},'qa',time);
const view=(b,m=month,time=at)=>c.monthlyVisitOverview(b,m,time);
test('recurring roster is read-only on open, repeats on Taipei month boundary and does not infer attendance from note dates',async()=>{
 const before=fixture(),b=await apply(before,'roster',month,['a','b']),snap=structuredClone(b);
 assert.equal(view(before).total,0);assert.equal(view(b).total,2);assert.equal(view(b).completedCount,0);
 assert.equal(view(b,'2026-12','2026-11-30T16:00:00.000Z').total,2);assert.equal(view(b,'2026-10').total,0);assert.deepEqual(b,snap);
 assert.deepEqual(b.ops.slice(0,before.ops.length),before.ops);assert.equal(b.ops.at(-1).type,'source');assert.ok(!b.ops.at(-1).visitAttendance);
});
test('only retained explicit attendance counts, independent of latest ordinary edit, and next month resets',async()=>{
 let b=await apply(fixture(),'roster',month,['a','b']);const old=b.ops.find(o=>o.entity==='note');
 const visit=c.revision('visit','note',{...old.data,text:'親自確認'},[old.id],'qa',false,c.makeVisitAttendance('a','2026-11-02T01:00:00.000Z'));b.ops.push(visit);
 b.ops.push(c.revision('visit','note',{...visit.data,text:'後來一般修改'},[visit.id],'qa'));
 assert.equal(view(b).completedCount,1);assert.deepEqual(view(b).completed[0].dates,['2026-11-02']);assert.equal(view(b,'2026-12','2026-12-01T00:00:00.000Z').completedCount,0);
});
test('manual external-report attendance counts but answers/source imports alone do not',async()=>{
 let b=await apply(fixture(),'roster',month,['a']);const data={format:'pharmacy-manual-visit-attendance-1',store:'a',date:'2026-11-14',at};const raw=new TextEncoder().encode(JSON.stringify(data)),blob=await c.hashBytes(raw);
 b.blobs[blob]=c.b64(raw);const o=c.revision('source','manual',{file:'人工拜訪確認.json',list:'人工拜訪確認',blob,batch:'qa',rows:1,headers:[],encoding:'UTF-8',delimiter:'',manualVisitAttendance:data},[],'qa');o.at=at;b.ops.push(o);
 c.validateBundle(b);assert.equal(view(b).completedCount,1);
});
test('single-month overrides preserve recurrence in other months and never mutate visits',async()=>{
 let b=await apply(fixture(),'roster',month,['a']);const orig=b.ops.filter(o=>o.type==='visit');
 b=c.applyMonthlyVisitAction(b,{month,storeId:'a',action:'remove',expectedBasis:c.monthlyVisitBasis(c.project(b),month)},'qa',at);
 assert.equal(view(b).total,0);assert.equal(view(b,'2026-12').total,1);assert.deepEqual(b.ops.filter(o=>o.type==='visit'),orig);
});
test('future roster edits preserve old month membership and all source history',async()=>{
 let b=await apply(fixture(),'roster',month,['a']);b=await apply(b,'roster','2026-12',['b']);
 assert.deepEqual(view(b).stores.map(r=>r.storeId),['a']);assert.deepEqual(view(b,'2026-12').stores.map(r=>r.storeId),['b']);
 assert.equal(b.ops.filter(o=>o.data.monthlyPlanning).length,2);
});
test('monthly focus is independent, exact plain text, versioned and empty next month',async()=>{
 let b=await apply(fixture(),'focus',month,'  <script>原樣文字</script>\n下一行  ');const old=structuredClone(b);
 assert.equal(c.monthlyPlanningState(b,'focus',month).document.text,'<script>原樣文字</script>\n下一行');assert.equal(c.monthlyPlanningState(b,'focus','2026-12').document,null);
 b=await apply(b,'focus',month,'修改');assert.deepEqual(b.ops.slice(0,old.ops.length),old.ops);assert.equal(c.monthlyPlanningState(b,'focus',month).document.text,'修改');
 assert.equal(await apply(b,'focus',month,'修改'),b);assert.equal(view(b).total,0);
});
test('same-month concurrent focus edits remain a visible conflict until explicit resolution',async()=>{
 const base=fixture(),a=await apply(base,'focus',month,'甲'),b=await apply(base,'focus',month,'乙');let merged=c.merge(a,b);
 assert.equal(c.monthlyPlanningState(merged,'focus',month).conflict,true);assert.equal(c.monthlyPlanningState(merged,'focus',month).document,null);
 merged=await apply(merged,'focus',month,'人工核對後');assert.equal(c.monthlyPlanningState(merged,'focus',month).conflict,false);assert.equal(merged.ops.filter(o=>o.data.monthlyPlanning).length,3);
});
test('concurrent roster edits never quietly count completion or pick one branch',async()=>{
 const base=fixture(),a=await apply(base,'roster',month,['a']),b=await apply(base,'roster',month,['b']),merged=c.merge(a,b);
 assert.equal(view(merged).recurringConflict,true);assert.equal(view(merged).total,2);assert.equal(view(merged).completedCount,0);assert.ok(view(merged).stores.every(r=>!r.available));
});
test('stale basis, past edits, duplicate ids, missing stores and too-long text fail without writes',async()=>{
 const b=fixture(),before=JSON.stringify(b),basis=c.monthlyPlanningBasis(b,'focus',month),changed=await apply(b,'focus',month,'新資料');
 await assert.rejects(c.applyMonthlyPlanning(changed,{kind:'focus',month,text:'舊視窗',expectedBasis:basis},'qa',at),/新版本/);
 for(const [kind,m,value] of [['focus','2026-10','x'],['roster',month,['a','a']],['roster',month,['missing']],['focus',month,'x'.repeat(1001)]])await assert.rejects(apply(b,kind,m,value));assert.equal(JSON.stringify(b),before);
});
test('deleted and conflicted stores retain warning rows but are not counted; cannot newly save unavailable ids',async()=>{
 let b=await apply(fixture(),'roster',month,['a']);const a=c.project(b).find(r=>r.id==='a');b.ops.push(c.revision('store','a',a.heads[0].data,a.heads.map(h=>h.id),'qa',true));
 assert.equal(view(b).total,1);assert.equal(view(b).stores[0].available,false);await assert.rejects(apply(b,'roster',month,['a','b']));
});
test('independent source tampering and cross-kind supersedes are rejected',async()=>{
 const b=await apply(fixture(),'roster',month,['a']),tampered=structuredClone(b);tampered.ops.at(-1).data.monthlyPlanning.storeIds=['b'];assert.throws(()=>c.validateBundle(tampered),/原件/);
 const f=await apply(b,'focus',month,'內容');const doc=f.ops.at(-1).data.monthlyPlanning;doc.supersedes=[b.ops.at(-1).entity];const raw=new TextEncoder().encode(JSON.stringify(doc)),blob=await c.hashBytes(raw);f.blobs[blob]=c.b64(raw);f.ops.at(-1).data.blob=blob;assert.throws(()=>c.validateBundle(f),/鏈結/);
});
test('ciphertext backup round trip and cross-device merge retain planning, originals and evidence',async()=>{
 const base=fixture();const b=await apply(await apply(base,'roster',month,['a','b']),'focus',month,'本月方向');const meta={...c.newMeta(),vaultId:b.vaultId},key=await c.derive('fictional-test-only',meta);
 const sealed=await c.seal({bundle:b},key,meta,'backup'),opened=await c.unseal(sealed,key,'backup');assert.deepEqual(opened.bundle,b);assert.deepEqual(c.merge(base,opened.bundle).ops.length,b.ops.length);
});
