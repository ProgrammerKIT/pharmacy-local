import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('// Weekly recovery settings'),source.indexOf('function clearRecoveryExport()'));
function harness(){
 const nodes=new Map(),calls=[],$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',files:[],checked:false,open:false,disabled:false,textContent:'',reset(){},close(){this.open=false;}});return nodes.get(id);};
 const c=vm.createContext({$,JSON,Date,Number,String,Math,TextEncoder,encodeURIComponent,setTimeout:()=>{},weeklyState:null,weeklyContext:null,weeklyRunning:false,weeklyRetryAt:0,payload:{token:'synthetic',dirty:false,serverVersion:3,bundle:{unchanged:true}},key:{old:true},meta:{vaultId:'v',salt:'original'},localRevision:4,syncEpoch:0,document:{hidden:false},navigator:{onLine:true},busy:false,gateOpening:false,autoFetching:false,editorContext:null,singleStoreContext:null,inlineTextContext:null,reminderContext:null,dayPlanContext:null,monthlyVisitContext:null,attendancePrompt:null,csvImport:{hasPending:()=>false},pendingLock:false,updateHolding:false,syncInProgress:false,recoveryExportContext:null,backupPreview:null,
 syncScheduler:{pause(){},wake(){},request(){}},assertBackupIdle(){},readLocal:async()=>({revision:c.diskRevision??4}),openDialog:n=>n.open=true,dateText:x=>x,uuid:()=> '11111111-1111-4111-8111-111111111111',canAutoSync:()=>true,
 readWeeklyRecovery:async()=>c.localConfig||null,writeWeeklyRecovery:async(id,value)=>{calls.push(['key',id,value]);c.localConfig=value;},setupWeeklyRecovery:async()=>({key:{backup:true},meta:{vaultId:'v',salt:'backup',iterations:600000},proofSha256:'proof'}),
 api:async(path,options)=>{calls.push([path,options]);if(path.endsWith('/status'))return c.remote;if(path.endsWith('/config'))return {config:{id:options.body.configId,...options.body},status:'waiting-current-copy'};if(path==='/api/snapshot')return {version:3,envelope:{source:true}};if(path.endsWith('/stage'))return {config:c.remote.config,status:'success',lastSuccess:{name:'weekly.pharmabackup',at:'now',sourceVersion:3,sha256:'file'}};throw Error(path);},
 hashBytes:async()=> 'source-hash',prepareWeeklyRecovery:async()=>({envelope:{backup:true},sha256:'file'}),run:async(fn,id)=>{try{await fn();}catch(e){$(id).textContent=e.message;}},download:()=>{calls.push(['download']);}
 });
 c.remote={config:null,status:'unconfigured',sourceVersion:3,sourceSha256:'source-hash'};vm.runInContext(functions,c);
 return {c,$,calls,fill(){ $('weekly-proof').files=[{size:100,text:async()=> 'synthetic-proof'}];$('weekly-password').value='user-secret';$('weekly-ack').checked=true;}};
}
test('weekly setup stores separate key, not customer payload/password; Friday21 default and single config activation',async()=>{
 const {c,$,calls,fill}=harness(),original=JSON.stringify(c.payload);await c.openWeeklySetup();assert.equal($('weekly-weekday').value,'5');assert.equal($('weekly-time').value,'21:00');fill();await c.saveWeeklySetup();
 assert.equal(JSON.stringify(c.payload),original);assert.equal(c.localRevision,4);assert.equal(c.key.old,true);assert.equal($('weekly-password').value,'');assert.equal($('weekly-proof').value,'');
 assert.equal(calls.filter(x=>x[0].endsWith('/config')).length,1);assert.ok(!JSON.stringify(calls).includes('user-secret'));
});
test('weekly setup rejects wrong proof password, stale disk and cancelled/background session without activating config',async()=>{
 for(const invalidate of [c=>c.setupWeeklyRecovery=async()=>{throw Error('wrong password');},c=>c.diskRevision=5,c=>c.document.hidden=true,c=>c.clearWeeklySetup()]){
  const {c,$,calls,fill}=harness();await c.openWeeklySetup();fill();invalidate(c);await assert.rejects(c.saveWeeklySetup());assert.equal($('weekly-password').value,'');assert.ok(!calls.some(x=>x[0].endsWith('/config')));
 }
 const h=harness();h.c.api=async()=>{throw Error('offline');};await assert.rejects(h.c.openWeeklySetup());assert.equal(h.c.weeklyContext,null);
});
test('weekly worker stages full current snapshot only, preserves payload and handles missing local key/stale server',async()=>{
 const {c,$,calls}=harness();c.remote.config={id:'id',weekday:5,hour:21,minute:0};await c.weeklyTick();assert.match($('weekly-status').textContent,/尚未設定備份金鑰/);assert.ok(!calls.some(x=>x[0].endsWith('/stage')));
 c.localConfig={key:{},meta:{}};c.weeklyRetryAt=0;const before=JSON.stringify(c.payload);await c.weeklyTick();assert.equal(calls.filter(x=>x[0].endsWith('/stage')).length,1);assert.equal(JSON.stringify(c.payload),before);assert.equal(c.localRevision,4);
 const staged=calls.find(x=>x[0].endsWith('/stage'))[1].body;assert.equal(staged.expectedVersion,3);assert.equal(staged.sourceSha256,'source-hash');
 c.remote.sourceVersion=4;c.weeklyRetryAt=0;await c.weeklyTick();assert.match($('weekly-status').textContent,/Mac 資料已更新/);assert.equal(calls.filter(x=>x[0].endsWith('/stage')).length,1);
});
test('weekly worker rejects changes during encryption; no stage upload and no false success',async()=>{
 for(const mutate of [c=>c.document.hidden=true,c=>c.diskRevision=5,c=>c.syncEpoch++]){
  const {c,$,calls}=harness();c.remote.config={id:'id'};c.localConfig={key:{},meta:{}};c.prepareWeeklyRecovery=async()=>{mutate(c);return {envelope:{},sha256:'file'};};await c.weeklyTick();assert.ok(!calls.some(x=>x[0].endsWith('/stage')));assert.doesNotMatch($('weekly-status').textContent,/最近排程已成功保存/);assert.equal(c.weeklyRunning,false);
 }
});

test('saved inactive drafts do not block formal Mac backup and failed stage can be regenerated',async()=>{
 const {c,$,calls}=harness();c.payload.draft={text:'unsubmitted'};c.payload.inlineTextDraft={text:'unsubmitted'};c.payload.reminderDrafts=[{text:'unsubmitted'}];c.remote.config={id:'id'};c.remote.status='failed';c.remote.stage={sourceVersion:3,sourceSha256:'source-hash'};c.localConfig={key:{},meta:{}};
 await c.weeklyTick();assert.equal(calls.filter(x=>x[0].endsWith('/stage')).length,1);assert.equal(c.payload.draft.text,'unsubmitted');
});
test('existing local recovery key must match verified proof before setup is accepted',async()=>{
 const {c,$,calls,fill}=harness();c.remote.config={id:'id',weekday:5,hour:21,minute:0,recoveryMeta:{salt:'backup',iterations:600000}};c.localConfig={sourceVaultId:'v',meta:{salt:'other',iterations:600000}};await c.openWeeklySetup();fill();await assert.rejects(c.saveWeeklySetup(),/金鑰與排程不一致/);assert.ok(!calls.some(x=>x[0].endsWith('/config')));
});
