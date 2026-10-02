import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { newMeta, derive, seal, unseal, checkEnvelope, emptyBundle, revision, validateBundle, project, planBackupImport, addReminderTasks, completeReminderTask, hashBytes, b64, uuid } from '../public/core.js';

// Real application handlers and cryptography with synthetic fixtures only.
// The modeled disk is isolated memory: never open a real browser vault or network.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const password = 'synthetic-backup-handler-test';
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const seed = (async () => {
  const meta = newMeta(), key = await derive(password, meta), bundle = emptyBundle(meta.vaultId);
  const bytes = new TextEncoder().encode('name,note\r\nSynthetic,"first\r\nsecond"\r\n'), blob = await hashBytes(bytes);
  bundle.blobs[blob] = b64(bytes);
  const tasks = addReminderTasks({name:'虛構備份測試門市',city:'',district:'',channel:'',attr:'',contact:'',nextRemember:'',everyTimeMust:'虛構固定事項'}, 'HAUD\nComplete', '2026-10-01T01:00:00.000Z');
  const base = revision('store', 's', tasks, [], 'synthetic');
  const done = revision('store', 's', completeReminderTask(tasks, tasks.nextRememberTasks[0].id, '2026-10-01T02:00:00.000Z'), [base.id], 'synthetic');
  const source = revision('source', 'source', {file:'synthetic.csv',list:'Synthetic',blob,batch:'synthetic',rows:1,headers:['name','note'],encoding:'utf-8',delimiter:','}, [], 'synthetic');
  const visit = revision('visit', 'v', {store:'s',date:'',text:'虛構原始文字\r\n <script>preserve literally</script>',next:'',source:'synthetic',topics:[],people:[],attachments:[{blob,name:'synthetic.csv',mime:'text/csv'}]}, [], 'synthetic');
  bundle.ops.push(base, done, source, visit);
  const incoming = structuredClone(bundle);
  incoming.ops.push(revision('visit', 'new-visit', {...visit.data,text:'新增的虛構拜訪'}, [], 'backup'));
  return {meta,key,bundle,incoming,base,done,source,visit,blob};
})();

function backupFile(envelope, name = 'synthetic.pharmabackup') {
  const text = JSON.stringify({format:'pharmacy-backup-1',envelope});
  return {name,size:Buffer.byteLength(text),text:async () => text};
}
async function harness({restore = false} = {}) {
  const fixture = await seed, meta = structuredClone(fixture.meta), nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, {id,open:false,value:'',checked:false,disabled:false,textContent:'',innerHTML:'',dataset:{},classList:{add(){},remove(){}},reset(){},
      closest(){return null;},replaceChildren(){this.innerHTML='';},close(){this.open=false;if(id==='backup-review')c.clearBackupPreview();}});
    return nodes.get(id);
  };
  const payload = restore ? null : {schema:1,device:'synthetic-device',deviceName:'Synthetic',token:'synthetic-token',bundle:structuredClone(fixture.bundle),dirty:false,serverVersion:4,lastSync:'2026-10-01T03:00:00.000Z'};
  const state = {disk:restore ? null : {revision:7},writes:[],reads:0,decrypts:0,opens:0,renders:0,notices:[],failWrite:false,pendingCSV:false,readHook:null,sealHook:null,writeHook:null};
  const c = vm.createContext({$,structuredClone,JSON,Set,Date,uuid,derive,checkEnvelope,validateBundle,planBackupImport,project,
    key:restore ? null : fixture.key,meta:restore ? null : meta,payload,localRevision:restore ? 0 : 7,slot:restore ? null : state.disk,
    backupPreview:null,editorContext:null,singleStoreContext:null,inlineTextContext:null,reminderContext:null,pendingLock:false,busy:false,updateHolding:false,
    document:{hidden:false,querySelectorAll:()=>[...nodes.values()]},csvImport:{hasPending:()=>state.pendingCSV},
    esc,dateText:x=>x,reviewValue:value=>JSON.stringify(value,null,2),reviewFields:(before,after)=>`<pre>${esc(JSON.stringify(before))}</pre><pre>${esc(JSON.stringify(after))}</pre>`,
    openDialog:node=>node.open=true,openWorkspace:async()=>state.opens++,render:()=>state.renders++,switchView:view=>state.view=view,toast:message=>state.notices.push(message),lockNow:()=>{},
    refreshBriefSearch:()=>{}, // This harness exercises backup writes, not the independent search UI.
    unseal:async(...args)=>{state.decrypts++;return unseal(...args);},
    seal:async(...args)=>{if(state.sealHook)await state.sealHook(...args);return seal(...args);},
    readLocal:async()=>{state.reads++;if(state.readHook)await state.readHook();return structuredClone(state.disk);},
    writeLocal:async(envelope,expected,key)=>{
      state.writes.push({envelope,expected,key});if(state.writeHook)await state.writeHook();
      if(state.failWrite)throw new Error('synthetic disk full');
      if((state.disk?.revision || 0)!==expected)throw new Error('另一個視窗已更新資料');
      state.disk={envelope,revision:expected+1,unlockKey:key};return expected+1;
    }
  });
  vm.runInContext(app.slice(app.indexOf('function buttons('),app.indexOf('function programDetail(')) + app.slice(app.indexOf('function withPendingSync('),app.indexOf('function pendingSyncSummary(')) + app.slice(app.indexOf('function assertBackupIdle('),app.indexOf('async function adoptRebuilt(')),c);
  $('password').value = password;
  const file = backupFile(await seal(fixture.incoming,fixture.key,fixture.meta));
  return {c,$,state,fixture,file};
}
async function preview(h) { await h.c.importBackup(h.file);h.$('backup-ack').checked=true;h.c.updateBackupControls(); }

test('backup inspection and cancellation preserve current data, source bytes and encryption session',async()=>{
  const h=await harness(), {c,$,state,fixture}=h, original=JSON.stringify(c.payload), currentKey=c.key,currentMeta=c.meta;
  h.file.name='<img src=x onerror=alert(1)>.pharmabackup';
  await c.importBackup(h.file);
  assert.equal(state.writes.length,0);assert.equal(JSON.stringify(c.payload),original);assert.equal(c.key,currentKey);assert.equal(c.meta,currentMeta);
  assert.equal($('backup-review').open,true);assert.equal($('backup-apply').disabled,true);assert.equal(c.backupPreview.plan.summary.addedRevisions,1);
  assert.match($('backup-review-body').innerHTML,/&lt;img/);assert.doesNotMatch($('backup-review-body').innerHTML,/<img|<script>/);
  assert.deepEqual(c.backupPreview.plan.bundle.ops.find(op=>op.id===fixture.visit.id),fixture.visit);
  assert.equal(c.backupPreview.plan.bundle.blobs[fixture.blob],fixture.bundle.blobs[fixture.blob]);
  $('backup-review').close();assert.equal(c.backupPreview,null);assert.equal($('backup-review-body').innerHTML,'');assert.equal(JSON.stringify(c.payload),original);assert.equal(state.writes.length,0);
});

test('final acknowledgement is required and accepted merge writes once without rewriting existing revisions',async()=>{
  const h=await harness(),{c,$,state,fixture}=h;
  await c.importBackup(h.file);await assert.rejects(c.applyBackupPreview(),/勾選確認/);assert.equal(state.writes.length,0);
  $('backup-ack').checked=true;await c.applyBackupPreview();
  assert.equal(state.writes.length,1);assert.equal(state.writes[0].expected,7);assert.equal(c.localRevision,8);assert.equal(c.backupPreview,null);
  assert.equal(c.payload.lastBackupOperation.summary.mode,'merge');assert.equal(c.payload.lastBackupOperation.summary.addedRevisions,1);assert.equal(c.payload.dirty,true);
  assert.deepEqual([...c.payload.pendingSync.entities],['visit:new-visit']);assert.equal(c.payload.token,'synthetic-token');assert.equal(c.payload.serverVersion,4);
  for(const op of fixture.bundle.ops)assert.deepEqual(c.payload.bundle.ops.find(item=>item.id===op.id),op);
  assert.equal(c.payload.bundle.blobs[fixture.blob],fixture.bundle.blobs[fixture.blob]);
  assert.deepEqual(await unseal(state.disk.envelope,c.key,'device'),JSON.parse(JSON.stringify(c.payload)));
  assert.equal(project(c.payload.bundle).find(r=>r.id==='s').nextRememberTasks[0].completedAt,'2026-10-01T02:00:00.000Z');
  await assert.rejects(c.applyBackupPreview(),/勾選確認/);assert.equal(state.writes.length,1);
});

test('identical and older-subset backups produce a read-only no-op with disabled apply',async()=>{
  for(const subset of [false,true]) {
    const h=await harness(),incoming=structuredClone(h.fixture.bundle);
    if(subset)incoming.ops=incoming.ops.filter(op=>op.id!==h.fixture.done.id);
    h.file=backupFile(await seal(incoming,h.fixture.key,h.fixture.meta));const before=JSON.stringify(h.c.payload);
    await preview(h);assert.equal(h.c.backupPreview.plan.summary.hasChanges,false);assert.equal(h.$('backup-apply').disabled,true);
    await assert.rejects(h.c.applyBackupPreview(),/勾選確認/);assert.equal(h.state.writes.length,0);assert.equal(JSON.stringify(h.c.payload),before);
  }
});

test('empty-device restore adopts credentials only after successful transaction; failure retains retryable preview',async()=>{
  const h=await harness({restore:true}),{c,$,state,fixture}=h;
  await preview(h);const ctx=c.backupPreview;
  assert.equal(c.payload,null);assert.equal(c.key,null);assert.equal(c.meta,null);assert.equal(c.localRevision,0);
  state.writeHook=()=>{assert.equal(c.payload,null);assert.equal(c.key,null);assert.equal(c.meta,null);assert.equal(c.localRevision,0);};
  state.failWrite=true;await assert.rejects(c.applyBackupPreview(),/disk full/);
  assert.equal(c.payload,null);assert.equal(c.key,null);assert.equal(c.meta,null);assert.equal(state.disk,null);assert.equal(c.backupPreview,ctx);assert.equal($('backup-review').open,true);assert.equal($('password').value,password);
  state.failWrite=false;await c.applyBackupPreview();
  assert.equal(state.writes[1].expected,0);assert.equal(c.localRevision,1);assert.equal(c.meta.vaultId,fixture.meta.vaultId);assert.equal(c.key,ctx.restoredKey);
  assert.equal(c.payload.token,null);assert.equal(c.payload.serverVersion,0);assert.equal(c.payload.lastSync,null);assert.equal(c.payload.lastBackupOperation.summary.mode,'restore');assert.equal(state.opens,1);assert.equal($('password').value,'');
  assert.equal(c.payload.bundle.ops.length,fixture.incoming.ops.length);
});

test('failed merge persistence leaves current payload and preview intact for a successful retry',async()=>{
  const h=await harness(),{c,state}=h,before=JSON.stringify(c.payload),oldKey=c.key,oldMeta=c.meta,oldSlot=c.slot;
  await preview(h);const ctx=c.backupPreview;state.failWrite=true;await assert.rejects(c.applyBackupPreview(),/disk full/);
  assert.equal(JSON.stringify(c.payload),before);assert.equal(c.key,oldKey);assert.equal(c.meta,oldMeta);assert.equal(c.slot,oldSlot);assert.equal(c.localRevision,7);assert.equal(c.backupPreview,ctx);
  state.failWrite=false;await c.applyBackupPreview();assert.equal(c.localRevision,8);assert.equal(c.backupPreview,null);
});

test('stale in-memory payload, key, metadata and revision all invalidate previously accepted preview',async()=>{
  for(const change of [c=>c.payload=structuredClone(c.payload),c=>c.payload.deviceName='changed',c=>c.key={},c=>c.meta=structuredClone(c.meta),c=>c.localRevision++]) {
    const h=await harness();await preview(h);change(h.c);const before=JSON.stringify(h.c.payload);
    await assert.rejects(h.c.applyBackupPreview(),/本機狀態已改變/);assert.equal(h.state.writes.length,0);assert.equal(JSON.stringify(h.c.payload),before);assert.ok(h.c.backupPreview);
  }
});

test('disk changes in another tab block both stale merge and empty-device restore',async()=>{
  for(const restore of [false,true]) {
    const h=await harness({restore});await preview(h);h.state.disk={revision:restore?1:8};const before=JSON.stringify(h.c.payload);
    await assert.rejects(h.c.applyBackupPreview(),/另一個視窗/);assert.equal(h.state.writes.length,0);assert.equal(JSON.stringify(h.c.payload),before);
  }
  const h=await harness();h.state.disk.revision=8;await assert.rejects(h.c.importBackup(h.file),/另一個視窗/);assert.equal(h.state.decrypts,0);
});

test('a racing write during encryption cannot substitute an unreviewed global revision or bypass disk CAS',async()=>{
  const changed=await harness();await preview(changed);changed.state.sealHook=()=>changed.c.localRevision=8;
  await assert.rejects(changed.c.applyBackupPreview(),/本機狀態已改變/);assert.equal(changed.state.writes.length,0);
  const raced=await harness(),before=JSON.stringify(raced.c.payload);await preview(raced);
  raced.state.sealHook=()=>raced.state.disk={revision:8};
  await assert.rejects(raced.c.applyBackupPreview(),/另一個視窗/);assert.equal(raced.state.writes[0].expected,7);assert.equal(raced.c.localRevision,7);assert.equal(JSON.stringify(raced.c.payload),before);assert.ok(raced.c.backupPreview);
});

test('open editors, encrypted drafts, CSV previews, dialogs and background state prohibit inspection and application',async()=>{
  const cases=[h=>h.c.editorContext={},h=>h.c.singleStoreContext={},h=>h.c.inlineTextContext={},h=>h.c.reminderContext={},h=>h.c.payload.draft={text:'synthetic unsaved'},h=>h.c.payload.inlineTextDraft={after:'synthetic unsaved'},h=>h.state.pendingCSV=true,
    ...['review','quick-text-dialog','store-reminder-dialog','rebuild-dialog'].map(id=>h=>h.$(id).open=true),h=>h.c.document.hidden=true,h=>h.c.pendingLock=true];
  for(const block of cases) {
    const h=await harness();block(h);const before=JSON.stringify(h.c.payload);
    await assert.rejects(h.c.importBackup(h.file),/編輯、草稿或核對|離開前景/);assert.equal(h.state.writes.length,0);assert.equal(h.state.decrypts,0);assert.equal(JSON.stringify(h.c.payload),before);
    const applying=await harness();await preview(applying);block(applying);
    await assert.rejects(applying.c.applyBackupPreview(),/編輯、草稿或核對|離開前景/);assert.equal(applying.state.writes.length,0);
  }
});

test('malformed files and foreign envelopes fail before decryption or any session mutation',async()=>{
  const invalid=[{size:36*1024*1024+1,text:async()=>{throw new Error('must not read');}},{size:2,text:async()=>'{x'}, {size:2,text:async()=>'{}'},backupFile({format:'broken'})];
  for(const file of invalid) {
    const h=await harness(),before=JSON.stringify(h.c.payload);await assert.rejects(h.c.importBackup(file));assert.equal(h.state.writes.length,0);assert.equal(h.state.decrypts,0);assert.equal(JSON.stringify(h.c.payload),before);assert.equal(h.c.backupPreview,null);
  }
  const h=await harness(),foreign=newMeta();const file=backupFile(await seal(emptyBundle(foreign.vaultId),await derive(password,foreign),foreign));
  await assert.rejects(h.c.importBackup(file),/另一個資料庫/);assert.equal(h.state.decrypts,0);assert.equal(h.state.writes.length,0);
});

test('restore password, existing local slot and decrypted vault mismatch fail without adopting a key',async()=>{
  const noPassword=await harness({restore:true});noPassword.$('password').value='';await assert.rejects(noPassword.c.importBackup(noPassword.file),/備份密碼/);assert.equal(noPassword.state.decrypts,0);
  const wrong=await harness({restore:true});wrong.$('password').value='wrong synthetic password';await assert.rejects(wrong.c.importBackup(wrong.file),/密碼不正確/);assert.equal(wrong.c.key,null);assert.equal(wrong.c.meta,null);assert.equal(wrong.state.writes.length,0);
  const occupied=await harness({restore:true});occupied.state.disk={revision:1};await assert.rejects(occupied.c.importBackup(occupied.file),/先解鎖/);assert.equal(occupied.state.decrypts,0);
  const mismatch=await harness({restore:true}),bundle=structuredClone(mismatch.fixture.incoming);bundle.vaultId=uuid();mismatch.file=backupFile(await seal(bundle,mismatch.fixture.key,mismatch.fixture.meta));
  await assert.rejects(mismatch.c.importBackup(mismatch.file),/身分不符/);assert.equal(mismatch.c.payload,null);assert.equal(mismatch.c.key,null);assert.equal(mismatch.state.writes.length,0);
});

test('malformed bundle references and changed source bytes are rejected before a preview is exposed',async()=>{
  for(const mutate of [b=>delete b.blobs[Object.keys(b.blobs)[0]],b=>b.blobs[Object.keys(b.blobs)[0]]=b64(new TextEncoder().encode('altered synthetic CSV'))]) {
    const h=await harness(),bundle=structuredClone(h.fixture.incoming),before=JSON.stringify(h.c.payload);mutate(bundle);h.file=backupFile(await seal(bundle,h.fixture.key,h.fixture.meta));
    await assert.rejects(h.c.importBackup(h.file));assert.equal(h.c.backupPreview,null);assert.equal(h.state.writes.length,0);assert.equal(JSON.stringify(h.c.payload),before);
  }
});

test('state changes while preview is being inspected abort without exposing a stale candidate',async()=>{
  const h=await harness();h.state.readHook=()=>h.c.payload.deviceName='changed during inspection';
  await assert.rejects(h.c.importBackup(h.file),/檢查期間本機狀態已改變/);assert.equal(h.c.backupPreview,null);assert.equal(h.state.writes.length,0);
});

test('real run guard ignores repeated apply clicks and restores controls after an error',async()=>{
  const h=await harness();await preview(h);let enter,finish;const entered=new Promise(resolve=>enter=resolve),waiting=new Promise(resolve=>finish=resolve);
  h.state.sealHook=async()=>{enter();await waiting;};
  const first=h.c.run(h.c.applyBackupPreview,'backup-error');await entered;
  assert.equal(h.c.busy,true);await h.c.run(h.c.applyBackupPreview,'backup-error');assert.equal(h.state.writes.length,0);
  finish();await first;assert.equal(h.state.writes.length,1);assert.equal(h.c.busy,false);assert.equal(h.$('backup-apply').disabled,true);
  const failure=await harness();await preview(failure);failure.state.failWrite=true;await failure.c.run(failure.c.applyBackupPreview,'backup-error');
  assert.match(failure.$('backup-error').textContent,/disk full/);assert.equal(failure.c.busy,false);assert.equal(failure.$('backup-apply').disabled,false);assert.ok(failure.c.backupPreview);
});

function installRealLock(h) {
  const {c,state}=h;
  Object.assign(c,{clearTimeout(){},clearInterval(){},inlineDraftTimer:null,autoTimer:null,objectURLs:[],captureTransientResumeState(){state.resumeCaptured=true;},clearNearbyPosition(){state.locationCleared=true;},forgetBriefSearchQuery(){state.searchForgotten=true;},resetStoreFilters(){},showGate(){state.gateShown=true;}});
  c.document.body={classList:{add(){state.veiled=true;},remove(){state.veiled=false;}}};c.csvImport.reset=()=>{};
  vm.runInContext(app.slice(app.indexOf('function lockNow('),app.indexOf('async function showGate(')),c);
}

test('actual lock cancels and clears decrypted backup preview in both merge and empty-restore modes without a disk write',async()=>{
  for(const restore of [false,true]) {
    const h=await harness({restore}),{c,$,state}=h;installRealLock(h);await preview(h);
    const original=c.payload,before=JSON.stringify(original),disk=JSON.stringify(state.disk),inspected=c.backupPreview;
    c.document.hidden=true;c.lockNow(false);
    assert.equal(c.backupPreview,null);assert.equal($('backup-review').open,false);assert.equal($('backup-review-body').innerHTML,'');assert.equal($('backup-ack').checked,false);
    assert.equal(c.payload,null);assert.equal(c.key,null);assert.equal(c.meta,null);assert.equal($('password').value,'');assert.equal(c.pendingLock,false);
    assert.equal(JSON.stringify(original),before);assert.equal(JSON.stringify(state.disk),disk);assert.equal(state.writes.length,0);assert.equal(state.locationCleared,true);assert.equal(state.searchForgotten,true);
    assert.equal(inspected.plan.summary.mode,restore?'restore':'merge');await assert.rejects(c.applyBackupPreview(),/勾選確認/);
  }
});

test('backgrounding during backup encryption defers the real lock, aborts apply, then clears the preview without writing',async()=>{
  const h=await harness(),{c,state,$}=h;installRealLock(h);await preview(h);const original=c.payload,before=JSON.stringify(original),disk=JSON.stringify(state.disk);
  state.sealHook=()=>{c.document.hidden=true;c.lockNow(false);assert.equal(c.pendingLock,true);assert.ok(c.backupPreview);};
  await c.run(c.applyBackupPreview,'backup-error');
  assert.equal(state.writes.length,0);assert.equal(JSON.stringify(state.disk),disk);assert.equal(JSON.stringify(original),before);
  assert.equal(c.payload,null);assert.equal(c.key,null);assert.equal(c.backupPreview,null);assert.equal(c.busy,false);assert.equal(c.pendingLock,false);assert.equal($('backup-review').open,false);
});

test('large preview pages stay read-only and render at most 20 summaries and warnings without eagerly expanding note text',async()=>{
  const h=await harness(),{c,$,state,fixture}=h,incoming=structuredClone(fixture.bundle),original=JSON.stringify(c.payload);
  for(let i=0;i<45;i++)incoming.ops.push(revision('visit',`synthetic-${String(i).padStart(2,'0')}`,{...fixture.visit.data,store:`missing-${i}`,text:`SYNTHETIC_DETAIL_${i}<img src=x>`},[],'backup'));
  await c.importBackup(backupFile(await seal(incoming,fixture.key,fixture.meta)));
  assert.equal(c.backupPreview.plan.changes.length,45);assert.equal(c.backupPreview.plan.summary.warnings.length,45);
  assert.equal(($('backup-changes').innerHTML.match(/data-backup-change=/g)||[]).length,20);assert.doesNotMatch($('backup-changes').innerHTML,/SYNTHETIC_DETAIL/);
  assert.equal(($('backup-warnings').innerHTML.match(/ → /g)||[]).length,20);
  c.renderBackupChanges(2);c.renderBackupWarnings(2);
  assert.equal(($('backup-changes').innerHTML.match(/data-backup-change=/g)||[]).length,5);assert.equal(($('backup-warnings').innerHTML.match(/ → /g)||[]).length,5);
  assert.match($('backup-pages').innerHTML,/第 3／3 頁/);assert.match($('backup-warnings').innerHTML,/第 3／3 頁/);
  const html=c.backupChangeHTML(c.backupPreview.plan.changes[0]);assert.match(html,/SYNTHETIC_DETAIL/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
  assert.equal(JSON.stringify(c.payload),original);assert.equal(state.writes.length,0);
});
