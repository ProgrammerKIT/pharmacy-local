import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const implementation=source.slice(source.indexOf('async function notePurgeTick()'),source.indexOf('function visitTrashTimingHTML('));
function ui() {
 const c=vm.createContext({Date,Number,notePurgeRunning:false,notePurgeRetryAt:0,canAutoSync:()=>true,payload:{bundle:{id:'before'},dirty:false,lastSync:new Date().toISOString()},macProgram:{version:'1.5.116',at:new Date().toISOString()},APP_VERSION:'1.5.116',key:{},meta:{},localRevision:1,syncEpoch:1,document:{hidden:false},pendingLock:false,updateHolding:false,syncInProgress:false,expiredVisitTrash:()=>['due'],purgeExpiredVisitNotes:()=>({id:'purged'}),writes:0,syncs:0,messages:[],syncScheduler:{wake(){}},toast:s=>c.messages.push(s),render(){},async run(fn){try{await fn()}catch(e){c.messages.push(e.message)}},async synchronize(){c.syncs++;if(c.syncFail)throw Error('offline');if(c.onSync)c.onSync()},async persist(next,{guard}){guard();if(c.beforeWrite)c.beforeWrite();guard();if(c.diskFail)throw Error('disk failure');c.payload=next;c.writes++}});
 vm.runInContext(implementation,c);return c;
}
test('expiry waits for idle and recent verified sync, preserving dirty data, drafts and offline sessions',async()=>{
 for(const change of [c=>c.canAutoSync=()=>false,c=>c.payload.dirty=true,c=>c.payload.draft={text:'unsaved'},c=>c.macProgram.version='1.5.115',c=>c.payload.lastSync='invalid',c=>c.payload.lastSync='2020-01-01T00:00:00.000Z',c=>c.macProgram.at='2020-01-01T00:00:00.000Z',c=>c.expiredVisitTrash=()=>[],c=>c.notePurgeRunning=true]){
  const c=ui();change(c);await c.notePurgeTick();assert.equal(c.writes,0);assert.equal(c.syncs,0);
 }
});
test('expiry synchronizes first, encrypts via existing persist, then schedules outbound sync and never marks manual approval',async()=>{
 const c=ui();let wake=0;c.syncScheduler.wake=()=>wake++;await c.notePurgeTick();assert.equal(c.syncs,1);assert.equal(c.writes,1);assert.equal(c.payload.bundle.id,'purged');assert.equal(c.payload.dirty,true);assert.equal(c.notePurgeRunning,false);assert.equal(wake,1);assert.match(c.messages[0],/人工判斷與舊備份保留/);
});
test('sync, storage, lock and session changes never discard original payload or report deletion success',async()=>{
 for(const change of [c=>c.syncFail=true,c=>c.diskFail=true,c=>c.onSync=()=>{c.document.hidden=true},c=>c.beforeWrite=()=>{c.syncEpoch++}]){
  const c=ui(),before=c.payload;change(c);await c.notePurgeTick();assert.equal(c.writes,0);assert.equal(c.payload,before);assert.equal(c.notePurgeRunning,false);assert.ok(c.messages.length);assert.doesNotMatch(c.messages[0],/^已永久移除/);await c.notePurgeTick();assert.equal(c.syncs,1,'failure backoff prevents network busy-loop');
 }
});
test('backup preview explicitly labels irreversible receipt and its affected note instead of promising all versions survive',()=>{
 const start=source.indexOf('function backupSummaryHTML('),end=source.indexOf('function renderBackupChanges(',start);
 const c=vm.createContext({backupPreview:{storeNames:new Map([['s','虛構門市']])},esc:v=>String(v??''),dateText:v=>v,reviewValue:v=>JSON.stringify(v),reviewFields:()=>'',reviewAttendanceHTML:()=>''});
 vm.runInContext(source.slice(start,end),c);
 const counts={store:0,visit:0,person:0,topic:0,source:0},stat={entities:counts,active:counts,deleted:counts};
 const html=c.backupSummaryHTML({before:stat,after:stat,newEntities:counts,permanentlyRemovedNotes:1});
 assert.match(html,/將套用 1 筆已永久移除筆記的收據/);assert.match(html,/不能從回收桶還原/);
 const change={type:'visit',entity:'v',kind:'permanent-removal',beforeHeads:[],afterHeads:[],purge:{storeId:'s',deletedAt:'2026-10-01T00:00:00.000Z',purgedAt:'2026-10-31T00:00:00.000Z'}};
 assert.match(c.backupChangeTitle(change),/虛構門市.*永久移除收據/);assert.match(c.backupChangeHTML(change),/筆記已永久移除，不能還原/);
});
