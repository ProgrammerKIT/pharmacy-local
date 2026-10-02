import test from 'node:test';
import assert from 'node:assert/strict';
import { NEXT_REMINDER_OPTIONS, reminderHasOption, setReminderOption } from '../public/core.js';

test('fixed next-reminder options match the requested choices', () => {
  assert.deepEqual([...NEXT_REMINDER_OPTIONS], ['HAUD', 'Complete', '陳列盒（中）', '陳列盒（小）']);
});

test('checking options appends independent items without rewriting existing free text', () => {
  const original = 'HAUD×1、陳列盒15cm×1';
  const withHAUD = setReminderOption(original, 'HAUD', true);
  assert.equal(withHAUD, original + '\nHAUD');
  assert.equal(setReminderOption(withHAUD, 'HAUD', true), withHAUD);
  assert.equal(setReminderOption(withHAUD, 'HAUD', false), original);
});

test('unchecking removes only an exact independent item and custom text uses the same safe path', () => {
  const original = 'Complete 之後再詢問\nComplete\n陳列盒（中）×2';
  assert.equal(reminderHasOption(original, 'Complete'), true);
  assert.equal(setReminderOption(original, 'Complete', false), 'Complete 之後再詢問\n陳列盒（中）×2');
  assert.equal(setReminderOption(original, '陳列盒（中）', false), original);
  assert.equal(setReminderOption('自由文字', '下次帶價目表', true), '自由文字\n下次帶價目表');
});

// Synthetic data only. Exercise persistence, version history and UI handlers, not just markup.
import fs from 'node:fs';
import vm from 'node:vm';
import { reminderTaskLines, addReminderTasks, convertReminderTasks, completeReminderTask, reminderTaskHistory, validData, revision, project, merge, validateBundle, emptyBundle, newMeta, derive, seal, unseal, hashBytes, b64 } from '../public/core.js';
const taskStore = { name: '虛構任務測試店', city: '', district: '', channel: '', attr: '', contact: '', nextRemember: ' HAUD×1、盒子×2\r\n\r\nComplete ', everyTimeMust: '虛構固定事項' };
const created = '2026-10-01T01:00:00.000Z', completed = '2026-10-02T02:00:00.000Z';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('legacy conversion preserves exact source, only splits line breaks, and never mutates its input', () => {
  const before = JSON.stringify(taskStore), next = convertReminderTasks(taskStore, created);
  assert.equal(JSON.stringify(taskStore), before);
  assert.equal(next.nextRemember, '');
  assert.deepEqual(next.nextRememberTasks.map(t => t.text), [' HAUD×1、盒子×2', 'Complete ']);
  assert.equal(next.nextRememberImports[0].text, taskStore.nextRemember);
  assert.deepEqual(next.nextRememberImports[0].taskIds, next.nextRememberTasks.map(t => t.id));
  assert.equal(next.everyTimeMust, taskStore.everyTimeMust);
  assert.deepEqual(convertReminderTasks(next), next);
  assert.deepEqual(reminderTaskLines(' \n\r\n'), []);
  assert.ok(validData('store', next));
});

test('completion is idempotent and adding the same item again preserves the original completed task', () => {
  const data = addReminderTasks(taskStore, 'HAUD\nComplete', created), before = structuredClone(data), id = data.nextRememberTasks[0].id;
  const done = completeReminderTask(data, id, completed);
  assert.deepEqual(data, before);
  assert.equal(done.nextRememberTasks[0].completedAt, completed);
  assert.deepEqual(completeReminderTask(done, id, '2026-10-03T00:00:00.000Z'), done);
  const repeated = addReminderTasks(done, done.nextRememberTasks[0].text, completed);
  assert.deepEqual(repeated.nextRememberTasks.slice(0, 2), done.nextRememberTasks);
  assert.notEqual(repeated.nextRememberTasks[2].id, id);
  assert.equal(repeated.nextRememberTasks[2].completedAt, '');
  assert.equal(repeated.nextRemember, taskStore.nextRemember);
});

test('malformed, duplicate, oversized and orphaned task data fail closed without trimming history', () => {
  const data = convertReminderTasks(taskStore, created);
  for (const mutate of [d => d.nextRememberTasks.push(d.nextRememberTasks[0]), d => d.nextRememberTasks[0].completedAt = 'tomorrow', d => d.nextRememberTasks[0].text = ' ', d => d.nextRememberImports[0].taskIds[0] = 'missing', d => d.nextRememberTasks = null]) {
    const bad = structuredClone(data); mutate(bad); assert.equal(validData('store', bad), false); assert.throws(() => revision('store', 's', bad, [], 'test'));
  }
  assert.throws(() => addReminderTasks(data, 'x'.repeat(2001)), /2000/);
  assert.throws(() => addReminderTasks(data, 'same id', created, () => data.nextRememberTasks[0].id), /識別重複/);
  const full = { ...taskStore, nextRememberTasks: Array.from({length:1000}, (_, i) => ({id: String(i), text: 'synthetic', createdAt: created, completedAt: completed})) };
  const before = JSON.stringify(full); assert.throws(() => addReminderTasks(full, 'over limit'), /1000/); assert.equal(JSON.stringify(full), before);
});

test('encrypted backup and sync keep tasks, imports, original visits and Source Snapshot byte-for-byte', async () => {
  const meta = newMeta(), key = await derive('synthetic-task-test-password', meta), b = emptyBundle(meta.vaultId);
  const bytes = new TextEncoder().encode('name,note\r\nSynthetic,original\r\n'), blob = await hashBytes(bytes); b.blobs[blob] = b64(bytes);
  const source = revision('source', 'source', {file:'synthetic.csv',list:'Synthetic',blob,batch:'test',rows:1,headers:['name','note'],encoding:'utf-8',delimiter:','}, [], 'phone');
  const visit = revision('visit', 'visit', {store:'s',date:'',text:'虛構原文不可更改',next:'',source:'synthetic',topics:[],people:[],attachments:[]}, [], 'phone');
  const base = revision('store', 's', taskStore, [], 'phone'); b.ops.push(base, source, visit);
  const converted = revision('store', 's', convertReminderTasks(taskStore, created), [base.id], 'phone'); b.ops.push(converted);
  const done = revision('store', 's', completeReminderTask(converted.data, converted.data.nextRememberTasks[0].id, completed), [converted.id], 'phone'); b.ops.push(done);
  const restored = validateBundle(await unseal(await seal(b, key, meta), key));
  assert.deepEqual(restored, b); assert.deepEqual(merge(restored, b), merge(b, restored));
  assert.deepEqual(restored.ops.find(o => o.id === visit.id), visit); assert.deepEqual(restored.ops.find(o => o.id === source.id), source); assert.equal(restored.blobs[blob], b64(bytes));
  // Explicit version restore changes the current state, but completion evidence stays visible.
  b.ops.push(revision('store', 's', base.data, [done.id], 'phone'));
  const record = project(b).find(r => r.id === 's'), history = reminderTaskHistory(record);
  assert.equal(history.length, 1); assert.equal(history[0].completedAt, completed); assert.equal(history[0].historical, true);
});

test('offline task completions retain both heads and never receive an automatic safe merge', () => {
  const b = emptyBundle('synthetic-task-conflict'), base = revision('store', 's', addReminderTasks(taskStore, 'A\nB', created), [], 'seed'); b.ops.push(base);
  const phone = structuredClone(b), mac = structuredClone(b);
  phone.ops.push(revision('store', 's', completeReminderTask(base.data, base.data.nextRememberTasks[0].id, completed), [base.id], 'phone'));
  mac.ops.push(revision('store', 's', completeReminderTask(base.data, base.data.nextRememberTasks[1].id, completed), [base.id], 'mac'));
  const combined = merge(phone, mac), record = project(combined)[0];
  assert.equal(record.conflict, true); assert.equal(record.heads.length, 2); assert.deepEqual(merge(mac, phone), combined);
  const c = vm.createContext({structuredClone});
  vm.runInContext(app.slice(app.indexOf('const SAFE_CONFLICT_BLOCKED_FIELDS'), app.indexOf('function safeMergeSummary(')), c);
  const plan = c.safeConflictMerge(record); assert.equal(plan.safe, false); assert.equal(plan.blocked[0].field, 'nextRememberTasks');
});

function taskHarness({ confirm = true, fail = false } = {}) {
  const bundle = emptyBundle('task-ui'), data = addReminderTasks({...taskStore,nextRemember:''}, 'HAUD\nComplete', created), base = revision('store','s',data,[],'test'); bundle.ops.push(base);
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, {textContent:'',innerHTML:'',value:'',open:false,classList:{contains:()=>false},dataset:{},close(){this.open=false;},querySelector:()=>null,closest:()=>({querySelector:()=>null})}); return nodes.get(id); };
  const c = vm.createContext({$, structuredClone, JSON, Set, Date, addReminderTasks, convertReminderTasks, completeReminderTask, reminderTaskHistory, reminderTaskLines, revision, validateBundle, project,
    esc: value => String(value ?? '').replace(/[&<>"']/g, x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),dateText:x=>x,
    payload:{bundle,device:'test',dirty:false},singleStoreContext:null,editorContext:null,reminderContext:null,inlineTextContext:null,
    confirm: message => { c.prompts.push(message); return c.allow; },prompts:[],allow:confirm,toast:message=>c.messages.push(message),messages:[],saves:0,
    confirmStoreSave:async()=>({}),quickTextParents:record=>record.heads.map(head=>head.id).sort(),
    openVisitBrief:()=>{},run:async fn=>fn(),render:()=>{},persist:async next=>{if(fail)throw new Error('disk full');c.payload=next;c.saves++;} });
  c.by=(type,id)=>project(c.payload.bundle).find(r=>r.type===type&&r.id===id);
  c.name=(type,id)=>c.by(type,id)?.name || '';
  vm.runInContext(app.slice(app.indexOf('function assertSaveParents('),app.indexOf('function finishAttendancePrompt(')),c);
  vm.runInContext(app.slice(app.indexOf('function reminderTasksHTML('),app.indexOf('function lockPhoneViewportScale(')), c);
  vm.runInContext(app.slice(app.indexOf('async function commitRevision('),app.indexOf('async function saveEditor(')), c);
  vm.runInContext(app.slice(app.indexOf('async function saveStoreReminder('),app.indexOf('function beginInlineTextEdit(')), c);
  return {c,$,base,task:data.nextRememberTasks[0]};
}

test('checkbox completion previews impact, commits once, and cancellation writes nothing', async () => {
  const h = taskHarness({confirm:false}), before = JSON.stringify(h.c.payload);
  await h.c.changeReminderTask('s',h.task.id,h.base.id);
  assert.equal(JSON.stringify(h.c.payload),before); assert.equal(h.c.saves,0); assert.match(h.c.prompts[0],/完成時間/);
  h.c.allow=true; await h.c.changeReminderTask('s',h.task.id,h.base.id);
  assert.equal(h.c.saves,1); assert.ok(h.c.by('store','s').nextRememberTasks[0].completedAt);
  await assert.rejects(()=>h.c.changeReminderTask('s',h.task.id,h.base.id), /新版本/);
  const current=h.c.by('store','s'); await h.c.changeReminderTask('s',h.task.id,current.heads[0].id); assert.equal(h.c.saves,1);
});

test('failed completion, active editing, stale head and conflicts preserve all current data', async () => {
  const h = taskHarness({fail:true}), before=JSON.stringify(h.c.payload);
  await assert.rejects(()=>h.c.changeReminderTask('s',h.task.id,h.base.id),/disk full/); assert.equal(JSON.stringify(h.c.payload),before);
  for (const [field,value] of [['singleStoreContext',{}],['editorContext',{}],['reminderContext',{}],['inlineTextContext',{before:'a',after:'b'}]]) {
    h.c[field]=value; await assert.rejects(()=>h.c.changeReminderTask('s',h.task.id,h.base.id),/目前的修改/);h.c[field]=null;
  }
  h.c.payload.inlineTextDraft={};await assert.rejects(()=>h.c.changeReminderTask('s',h.task.id,h.base.id),/目前的修改/);delete h.c.payload.inlineTextDraft;
  h.c.payload.bundle.ops.push(revision('store','s',{...h.base.data,contact:'A'},[h.base.id],'A'),revision('store','s',{...h.base.data,contact:'B'},[h.base.id],'B'));
  await assert.rejects(()=>h.c.changeReminderTask('s',h.task.id,h.base.id),/衝突/);assert.equal(h.c.saves,0);
});

test('rendering a task or migration preview is read only and escapes raw user text', () => {
  const h=taskHarness(), record=h.c.by('store','s');record.nextRemember='<img src=x>\nComplete';record.nextRememberTasks[0].text='<script>bad</script>';
  const before=JSON.stringify(record), html=h.c.reminderTasksHTML(record)+h.c.legacyReminderDraftHTML(record);
  assert.equal(JSON.stringify(record),before);assert.equal(h.c.saves,0);assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
  assert.match(html,/data-reminder-complete/);assert.match(html,/轉換預覽/);assert.doesNotMatch(h.c.reminderTasksHTML(record,false),/data-reminder-complete/);
});

test('reminder form adds only confirmed items and keeps draft after cancel or failure',async()=>{
  const h=taskHarness({confirm:false});h.c.reminderContext={id:'s',parents:[h.base.id]};h.$('store-reminder-next').value='新的虛構待辦';h.$('store-reminder-every').value=taskStore.everyTimeMust;h.$('store-reminder-dialog').open=true;
  await h.c.saveStoreReminder({preventDefault(){}});assert.equal(h.c.saves,0);assert.equal(h.$('store-reminder-dialog').open,true);assert.equal(h.$('store-reminder-next').value,'新的虛構待辦');
  h.c.allow=true;await h.c.saveStoreReminder({preventDefault(){}});assert.equal(h.c.saves,1);assert.equal(h.c.by('store','s').nextRememberTasks.length,3);assert.equal(h.$('store-reminder-dialog').open,false);
  const failed=taskHarness({fail:true});failed.c.reminderContext={id:'s',parents:[failed.base.id]};failed.$('store-reminder-next').value='retry';failed.$('store-reminder-every').value=taskStore.everyTimeMust;
  await assert.rejects(()=>failed.c.saveStoreReminder({preventDefault(){}}),/disk full/);assert.ok(failed.c.reminderContext);assert.equal(failed.$('store-reminder-next').value,'retry');assert.equal(failed.c.saves,0);
});

test('old-client legacy edits do not erase task history and can be converted separately', () => {
  const first = convertReminderTasks(taskStore,created), done = completeReminderTask(first,first.nextRememberTasks[0].id,completed);
  const oldClient = {...done,nextRemember:'舊版另填的提醒',contact:'synthetic change'};
  const next = convertReminderTasks(oldClient,completed);
  assert.deepEqual(next.nextRememberTasks.slice(0,2),done.nextRememberTasks);
  assert.equal(next.nextRememberTasks[2].text,'舊版另填的提醒');
  assert.equal(next.nextRememberImports.length,2);assert.deepEqual(next.nextRememberImports[0],first.nextRememberImports[0]);
});

test('full store editor preserves completed tasks, rejects stale writes, and retains manual conflict preview', async () => {
  const h=taskHarness();h.c.quickTextParents=r=>r.heads.map(o=>o.id).sort();h.c.clearTimeout=()=>{};h.c.draftTimer=null;
  vm.runInContext(app.slice(app.indexOf('async function saveEditor('),app.indexOf('function describeData(')),h.c);
  const fields={'f-name':taskStore.name,'f-city':'','f-district':'','f-channel':'','f-attr':'','f-contact':'new contact','f-address':'','f-map-url':'','f-next-remember':'editor addition','f-every-time-must':taskStore.everyTimeMust};
  for(const [id,value] of Object.entries(fields))h.$(id).value=value;
  h.c.editorContext={type:'store',id:'s',parents:[h.base.id],oldData:structuredClone(h.base.data)};
  await h.c.saveEditor({preventDefault(){}});assert.equal(h.c.saves,1);assert.equal(h.c.by('store','s').nextRememberTasks.length,3);
  h.c.editorContext={type:'store',id:'s',parents:[h.base.id],oldData:structuredClone(h.base.data)};
  await assert.rejects(()=>h.c.saveEditor({preventDefault(){}}),/已有新版本/);assert.equal(h.c.saves,1);
  const other=revision('store','s',{...h.base.data,contact:'other'},[h.base.id],'other');h.c.payload.bundle.ops.push(other);
  const record=h.c.by('store','s');h.c.editorContext={type:'store',id:'s',parents:record.heads.map(o=>o.id),oldData:structuredClone(record.heads[0].data)};
  h.c.previewResolution=(ctx,data)=>{h.c.preview={ctx,data};};
  await h.c.saveEditor({preventDefault(){}});assert.equal(h.c.saves,1);assert.ok(h.c.preview);assert.equal(h.c.preview.ctx.parents.length,2);
});
