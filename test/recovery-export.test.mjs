import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../public/core.js';
const pass='synthetic-new-recovery-password';
async function fixture(){
 const meta=core.newMeta(),bundle=core.emptyBundle(meta.vaultId),bytes=new TextEncoder().encode('synthetic,source\r\nkeep,bytes  \r\n'),hash=await core.hashBytes(bytes);
 bundle.blobs[hash]=core.b64(bytes);
 const store=core.revision('store','s',{name:'Synthetic only',city:'',district:'',channel:'',attr:'original\r\n  ',contact:''},[],'test');
 const visit=core.revision('visit','v',{store:'s',date:'',text:'Synthetic complete original\r\n  ',next:'',source:'',topics:[],people:[],attachments:[{blob:hash,name:'synthetic.csv',mime:'text/csv'}]},[],'test');
 bundle.ops.push(store,visit,core.revision('visit','v',{...visit.data,text:'branch A'},[visit.id],'a'),core.revision('visit','v',{...visit.data,text:'branch B'},[visit.id],'b'));
 return {meta,bundle};
}
test('new-password backup preserves entire bundle including conflicts, history and bytes; original key cannot decrypt',async()=>{
 const {meta,bundle}=await fixture(),before=structuredClone(bundle),originalKey=await core.derive('synthetic-old-password',meta);
 const {text,sha256,summary}=await core.createRecoveryBackup(bundle,pass,pass),file=JSON.parse(text);
 assert.equal(file.format,'pharmacy-backup-1');assert.equal(file.envelope.vaultId,bundle.vaultId);assert.notEqual(file.envelope.salt,meta.salt);
 assert.equal(await core.hashBytes(new TextEncoder().encode(text)),sha256);
 const restored=await core.unseal(file.envelope,await core.derive(pass,file.envelope));assert.deepEqual(restored,before);assert.deepEqual(bundle,before);
 assert.equal(summary.conflicts,1);await assert.rejects(core.unseal(file.envelope,originalKey));
 const plan=await core.planBackupImport(null,restored);assert.equal(plan.summary.after.revisions,before.ops.length);
 const again=JSON.parse((await core.createRecoveryBackup(bundle,pass,pass)).text);assert.notEqual(again.envelope.salt,file.envelope.salt);
});
test('reject weak/mismatched passwords and corrupt source bytes; snapshot isolated before first await',async()=>{
 const {bundle}=await fixture();await assert.rejects(core.createRecoveryBackup(bundle,'short','short'));await assert.rejects(core.createRecoveryBackup(bundle,pass,pass+'x'));
 const before=structuredClone(bundle),pending=core.createRecoveryBackup(bundle,pass,pass);bundle.ops[0].data.name='changed after call';
 const file=JSON.parse((await pending).text);assert.deepEqual(await core.unseal(file.envelope,await core.derive(pass,file.envelope)),before);
 const corrupt=structuredClone(before);corrupt.blobs[Object.keys(corrupt.blobs)[0]]=core.b64(new TextEncoder().encode('corrupt'));await assert.rejects(core.createRecoveryBackup(corrupt,pass,pass),/內容與識別不符/);
});
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
async function harness(){
 const {meta,bundle}=await fixture(),nodes=new Map(),calls={downloads:[],diskReads:0,pauses:0};
 const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,open:false,textContent:'',reset(){},close(){this.open=false;}});return nodes.get(id);};
 const payload={bundle,device:'synthetic-device',token:'synthetic-token',dirty:true};
 const c=vm.createContext({$,payload,key:{synthetic:true},meta,localRevision:7,syncEpoch:0,recoveryExportContext:null,weeklyContext:null,weeklyRunning:false,backupPreview:null,syncInProgress:false,updateHolding:false,pendingLock:false,document:{hidden:false},JSON,Date,
  syncScheduler:{pause(){calls.pauses++;}},assertBackupIdle(){if(c.draftBlocked)throw Error('draft blocked');},
  readLocal:async()=>{calls.diskReads++;if(c.onRead)c.onRead();return {revision:c.diskRevision};},diskRevision:7,
  createRecoveryBackup:core.createRecoveryBackup,download:(...args)=>calls.downloads.push(args),openDialog:node=>node.open=true,
  persist(){throw Error('must never write');},writeLocal(){throw Error('must never write');},api(){throw Error('must never access server');}
 });
 vm.runInContext(source.slice(source.indexOf('function clearRecoveryExport()'),source.indexOf('function assertBackupIdle()')),c);
 const fill=()=>{$('recovery-password').value=pass;$('recovery-password-again').value=pass;$('recovery-export-ack').checked=true;};
 return {c,$,calls,fill};
}
test('real export handlers download once with no persistence or pairing changes; clear password fields',async()=>{
 const {c,$,calls,fill}=await harness(),before=JSON.stringify(c.payload),oldKey=c.key,oldMeta=c.meta;
 await c.openRecoveryExport();fill();await c.exportRecoveryBackup();assert.equal(calls.downloads.length,1);assert.equal(JSON.stringify(c.payload),before);assert.equal(c.key,oldKey);assert.equal(c.meta,oldMeta);assert.equal(c.localRevision,7);
 assert.equal($('recovery-password').value,'');assert.equal($('recovery-password-again').value,'');assert.equal($('recovery-export-ack').checked,false);
 assert.match($('recovery-export-result').textContent,/SHA256/);
 await assert.rejects(c.exportRecoveryBackup(),/確認/);assert.equal(calls.downloads.length,1);
});
test('real handlers reject stale disk, mutated payload, background, cancelled dialog, session and update changes before download',async()=>{
 for(const invalidate of [c=>c.diskRevision++,c=>c.payload.bundle.ops[0].data.name='mutated',c=>c.document.hidden=true,c=>c.clearRecoveryExport(),c=>c.syncEpoch++,c=>c.updateHolding=true,c=>c.pendingLock=true,c=>c.syncInProgress=true]){
  const {c,$,calls,fill}=await harness();await c.openRecoveryExport();fill();
  c.createRecoveryBackup=async(...args)=>{const out=await core.createRecoveryBackup(...args);invalidate(c);return out;};
  await assert.rejects(c.exportRecoveryBackup());assert.equal(calls.downloads.length,0);assert.equal($('recovery-password').value,'');assert.equal($('recovery-password-again').value,'');
 }
});
test('handler stops when disk changes during initial check, and blocks drafts before opening',async()=>{
 const {c,fill,calls}=await harness();await c.openRecoveryExport();fill();c.onRead=()=>{c.syncEpoch++;};await assert.rejects(c.exportRecoveryBackup());assert.equal(calls.downloads.length,0);
 const h=await harness();h.c.draftBlocked=true;await assert.rejects(h.c.openRecoveryExport());assert.equal(h.c.recoveryExportContext,null);
});
