import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { emptyBundle, revision, project, merge, validateBundle, makeVisitAttendance, visitAttendanceForStore, visitTrashState, applyVisitTrashAction } from '../public/core.js';
function fixture() {
 const bundle=emptyBundle('fictional-trash');
 bundle.ops.push(revision('store','s',{name:'虛構青禾店',city:'虛構市',district:'測試區',channel:'',attr:'',contact:'',nextRemember:'原提醒',everyTimeMust:'原固定事項'},[],'qa'));
 const note={store:'s',date:'2026-11-01',text:'  完整原文\r\n保留空白。 ',source:'合成資料',next:'原跟進',people:['p'],topics:[],attachments:[{blob:'a'.repeat(64),name:'原附件.txt',mime:'text/plain'}]};
 bundle.blobs['a'.repeat(64)]=btoa('original attachment');
 bundle.ops.push(revision('person','p',{name:'虛構人物',role:'',desc:'原人物內容',confirmed:false},[],'qa'));
 bundle.ops.push(revision('visit','v',note,[],'qa',false,makeVisitAttendance('s','2026-11-01T04:00:00.000Z')));
 bundle.ops.push(revision('visit','other',{...note,text:'另一筆原文',attachments:[]},[],'qa'));
 validateBundle(bundle); return bundle;
}
const get=(b,id='v')=>project(b).find(r=>r.type==='visit'&&r.id===id);
const action=(b,a,heads=get(b).heads.map(h=>h.id))=>applyVisitTrashAction(b,{action:a,visitId:'v',expectedHeads:heads},'qa');
test('trash and restore append only the selected note, preserving all originals, blobs, people and other notes',()=>{
 const b=fixture(),before=structuredClone(b),removed=action(b,'trash');
 assert.deepEqual(b,before); assert.equal(removed.ops.length,b.ops.length+1); assert.deepEqual(removed.ops.slice(0,-1),b.ops); assert.deepEqual(removed.blobs,b.blobs);
 assert.equal(get(removed).deleted,true); assert.deepEqual(removed.ops.at(-1).data,get(b).heads[0].data); assert.deepEqual(get(removed,'other'),get(b,'other'));
 const restored=action(removed,'restore'); assert.equal(get(restored).deleted,false); assert.equal(get(restored).versions.length,3);assert.deepEqual(get(restored).heads[0].data,get(b).heads[0].data);
 assert.deepEqual(restored.ops.slice(0,-1),removed.ops);assert.deepEqual(merge(removed,restored),merge(restored,removed));
 assert.deepEqual(visitAttendanceForStore(restored,'s'),visitAttendanceForStore(b,'s')); assert.equal(restored.ops.at(-1).visitAttendance,undefined);
});
test('30-day protection derives from deletion revision; elapsed time never erases data or prevents restoring',()=>{
 const removed=action(fixture(),'trash'),head=get(removed).heads[0];head.at='2026-11-01T01:00:00.000Z';
 assert.deepEqual(visitTrashState(get(removed),'2026-11-01T01:00:00.000Z'),{removedAt:head.at,protectedUntil:'2026-12-01T01:00:00.000Z',daysRemaining:30});
 assert.equal(visitTrashState(get(removed),'2026-11-30T01:00:00.001Z').daysRemaining,1);
 assert.equal(visitTrashState(get(removed),'2026-12-01T01:00:00.000Z').daysRemaining,0);
 const old=JSON.stringify(removed); assert.equal(visitTrashState(get(removed),'2027-01-01').daysRemaining,0);assert.equal(JSON.stringify(removed),old);assert.equal(get(action(removed,'restore')).deleted,false);
});
test('re-delete starts protection from new deletion, never from original visit date or restored revision',()=>{
 const b=action(action(action(fixture(),'trash'),'restore'),'trash'); const v=get(b);v.heads[0].at='2026-11-19T02:00:00.000Z';
 assert.equal(visitTrashState(v,'2026-11-19T02:00:00.000Z').protectedUntil,'2026-12-19T02:00:00.000Z');assert.equal(v.date,'2026-11-01');
});
test('stale, absent, already changed and conflicting note operations stop without modifying the bundle',()=>{
 const b=fixture(),before=JSON.stringify(b);assert.throws(()=>action(b,'trash',['stale']),/新版本/);assert.throws(()=>action(b,'restore'),/狀態/);assert.throws(()=>action(b,'purge'),/不支援/);
 assert.throws(()=>applyVisitTrashAction(b,{action:'trash',visitId:'missing',expectedHeads:['x']},'qa'),/不存在/);
 const removed=action(b,'trash');assert.throws(()=>action(removed,'trash'),/狀態/);
 const conflict=structuredClone(b);conflict.ops.push(revision('visit','v',{...get(b).heads[0].data,text:'另一裝置修改'},[],'other-device'));assert.throws(()=>action(conflict,'trash'),/衝突/);assert.equal(JSON.stringify(b),before);
});
test('missing legacy timestamp is explicitly unknown rather than invented',()=>{
 const removed=action(fixture(),'trash'),v=get(removed);v.heads[0].at='invalid';assert.deepEqual(visitTrashState(v),{removedAt:null,protectedUntil:null,daysRemaining:null});assert.equal(visitTrashState(get(fixture())),null);assert.equal(visitTrashState({...v,conflict:true}),null);
});
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const implementation=source.slice(source.indexOf('function visitTrashTimingHTML('),source.indexOf('async function removeEntity('));
function ui(){
 const bundle=fixture(),nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{open:false,dataset:{},innerHTML:''});return nodes.get(id)};
 const c=vm.createContext({payload:{bundle,device:'qa',dirty:false},key:{},meta:{},localRevision:1,syncEpoch:1,document:{hidden:false},pendingLock:false,updateHolding:false,syncInProgress:false,editorContext:null,inlineTextContext:null,reminderContext:null,singleStoreContext:null,monthlyFeedbackContext:null,dayPlanContext:null,monthlyVisitContext:null,csvImport:{hasPending:()=>false},releaseIdleInlineEdit(){},by:(type,id)=>project(c.payload.bundle).find(r=>r.type===type&&r.id===id),name:()=> '虛構青禾店',confirm:()=>true,structuredClone,visitTrashState,applyVisitTrashAction,records:project(bundle),$:node,kinds:{visit:'拜訪',store:'門市',person:'人物'},dateText:v=>v,esc:v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),writes:0,messages:[],toast:t=>c.messages.push(t),render(){c.records=project(c.payload.bundle);c.renderTrash()},refreshes:0,openVisitBrief(){c.refreshes++},async persist(next,{guard}){guard();if(c.beforeWrite)c.beforeWrite();guard();if(c.fail)throw Error('disk failure');c.payload=next;c.writes++}});
 vm.runInContext(implementation,c);return {c,node};
}
test('UI cancellation and unfinished drafts prevent any write; confirmation identifies only this note',async()=>{
 const {c}=ui(),before=JSON.stringify(c.payload);let prompt;c.confirm=t=>{prompt=t;return false};await c.changeVisitTrash('trash','v');assert.equal(c.writes,0);assert.equal(JSON.stringify(c.payload),before);assert.match(prompt,/只將這一筆/);assert.match(prompt,/虛構青禾店/);assert.match(prompt,/完整原文/);assert.match(prompt,/30天/);
 c.confirm=()=>true;c.payload.inlineTextDraft={id:'v'};await assert.rejects(c.changeVisitTrash('trash','v'),/先保存或取消/);assert.equal(c.writes,0);
});
test('UI invalidates confirmation if data changed and refuses failures without altering originals',async()=>{
 const {c}=ui(),before=c.payload;c.confirm=()=>{c.localRevision++;return true};await assert.rejects(c.changeVisitTrash('trash','v'),/工作階段/);assert.equal(c.writes,0);assert.equal(c.payload,before);
 c.confirm=()=>true;c.fail=true;await assert.rejects(c.changeVisitTrash('trash','v'),/disk failure/);assert.equal(c.payload,before);assert.equal(get(c.payload.bundle).deleted,false);
 c.fail=false;c.beforeWrite=()=>{c.syncEpoch++};await assert.rejects(c.changeVisitTrash('trash','v'),/工作階段/);assert.equal(c.writes,0);
});
test('UI refreshes open single-store view and restores the exact note without a new attendance',async()=>{
 const {c,node}=ui();node('review').open=true;node('review').dataset.singleStoreId='s';await c.changeVisitTrash('trash','v');assert.equal(c.refreshes,1);assert.match(node('trash-list').innerHTML,/30天保護期至/);assert.match(node('trash-list').innerHTML,/還原這筆筆記/);
 await c.changeVisitTrash('restore','v');assert.equal(c.writes,2);assert.equal(c.refreshes,2);assert.equal(get(c.payload.bundle).deleted,false);assert.equal(c.payload.bundle.ops.at(-1).visitAttendance,undefined);assert.match(node('trash-list').innerHTML,/回收桶是空/);
});
test('trash rendering escapes raw note text and all note views retain collapsed single-note delete entry',()=>{
 const {c,node}=ui();c.records=[{...get(action(fixture(),'trash')),text:'<img src=x onerror=alert(1)>'}];c.renderTrash();assert.doesNotMatch(node('trash-list').innerHTML,/<img/);assert.match(node('trash-list').innerHTML,/&lt;img/);
 assert.match(source,/data-delete="visit:\$\{esc\(item.id\)\}">移除這筆筆記（30天內可復原）/);assert.match(source,/data-delete="visit:\$\{esc\(v.id\)\}">移除這筆筆記（30天內可復原）/);
});
