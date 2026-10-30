import test from 'node:test';
import assert from 'node:assert/strict';
import {editReminderTasks,addReminderTasks,completeReminderTask,convertReminderTasks,reminderTaskHistory,emptyBundle,revision,project,merge,validateBundle,newMeta,derive,seal,unseal} from '../public/core.js';
const created='2026-10-01T01:00:00.000Z',done='2026-10-02T01:00:00.000Z';
function fixture(){return convertReminderTasks({name:'虛構藥局',city:'',district:'',channel:'',attr:'原有客群',contact:'原有窗口',nextRemember:' 來源原字\r\n第二項 ',everyTimeMust:'原有固定提醒'},created);}
test('editing preserves task ID, order, timestamps, other tasks and exact conversion source',()=>{
 const before=fixture(),id=before.nextRememberTasks[0].id,after=editReminderTasks(before,[{id,text:'  修改後，含原樣空白\n第二行 <script>只顯示文字</script>  '}]);
 assert.equal(after.nextRememberTasks[0].id,id);assert.equal(after.nextRememberTasks[0].createdAt,created);assert.equal(after.nextRememberTasks[0].completedAt,'');assert.deepEqual(after.nextRememberTasks[1],before.nextRememberTasks[1]);assert.deepEqual(after.nextRememberImports,before.nextRememberImports);assert.equal(before.nextRememberTasks[0].text,' 來源原字');assert.equal(after.everyTimeMust,before.everyTimeMust);
});
test('empty, oversized, missing, completed or duplicate edits fail without mutating input',()=>{
 const before=fixture(),id=before.nextRememberTasks[0].id,copy=structuredClone(before);
 for(const edits of [[{id,text:'  '}],[{id,text:'x'.repeat(2001)}],[{id:'absent',text:'new'}],[{id,text:'one'},{id,text:'two'}],null]) assert.throws(()=>editReminderTasks(before,edits));
 assert.throws(()=>editReminderTasks(completeReminderTask(before,id,done),[{id,text:'new'}]),/完成/);assert.deepEqual(before,copy);
});
test('batch validation is atomic; unchanged input adds no task and keeps completion history',()=>{
 const before=fixture(),id=before.nextRememberTasks[0].id,copy=structuredClone(before);assert.throws(()=>editReminderTasks(before,[{id,text:'valid first edit'},{id:'absent',text:'cannot apply'}]));assert.deepEqual(before,copy);assert.deepEqual(editReminderTasks(before,[{id,text:before.nextRememberTasks[0].text}]),before);
});
test('edited pending task coexists with completed tasks and new tasks',()=>{
 let before=fixture();const pendingId=before.nextRememberTasks[0].id,completedId=before.nextRememberTasks[1].id;before=completeReminderTask(before,completedId,done);
 const after=addReminderTasks(editReminderTasks(before,[{id:pendingId,text:'新內容'}]),'另一筆新待辦',created);
 assert.equal(after.nextRememberTasks.length,3);assert.deepEqual(after.nextRememberTasks[1],before.nextRememberTasks[1]);assert.deepEqual(reminderTaskHistory(after),reminderTaskHistory(before));assert.deepEqual(editReminderTasks(before,[]),before);
});
test('old task text and unrelated visits survive encrypted backup and merged revision history',async()=>{
 const before=fixture(),b=emptyBundle('fictional-edited-task'),base=revision('store','s',before,[],'fictional');
 const visit=revision('visit','v',{store:'s',date:'',text:'原有拜訪內容',source:'',next:'原有跟進',topics:[],people:[],attachments:[]},[],'fictional');b.ops.push(base,visit);
 const changed=structuredClone(b);changed.ops.push(revision('store','s',editReminderTasks(before,[{id:before.nextRememberTasks[0].id,text:'修改後內容'}]),[base.id],'fictional'));validateBundle(changed);
 const m=newMeta(),key=await derive('fictional-task-password',m),roundtrip=await unseal(await seal(changed,key,m),key),merged=merge(roundtrip,b),store=project(merged).find(r=>r.type==='store');assert.equal(store.nextRememberTasks[0].text,'修改後內容');assert.equal(store.versions.find(o=>o.id===base.id).data.nextRememberTasks[0].text,before.nextRememberTasks[0].text);assert.deepEqual(merged.ops.find(o=>o.id===visit.id),visit);assert.equal(store.heads[0].visitAttendance,undefined);
});
