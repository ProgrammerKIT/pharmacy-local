import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import vm from 'node:vm';
import { createService, atomic, rebuildSnapshot } from '../server.mjs';
import { makeCertificates } from '../scripts/setup.mjs';
import { newMeta, derive, seal, unseal, emptyBundle, revision, merge, project, validateBundle, hashBytes, b64, uuid, openRebuiltSnapshot } from '../public/core.js';
import { prepareCSV, planCSV, buildCSVImport, prepareReviewedCSV, planReviewedCSV } from '../public/csv.js';

const PASSWORD = 'fictional-password-only';
async function fixture(full = false) {
  const meta = newMeta(), key = await derive(PASSWORD, meta), bundle = emptyBundle(meta.vaultId);
  if (full) {
    const bytes = new TextEncoder().encode('fictional attachment'), blob = await hashBytes(bytes); bundle.blobs[blob] = b64(bytes);
    bundle.ops.push(revision('store','old-store',{name:'虛構舊門市',city:'',district:'',channel:'',attr:'',contact:''},[],'old'));
    bundle.ops.push(revision('topic','old-topic',{name:'虛構舊主題',desc:''},[],'old'));
    bundle.ops.push(revision('person','old-person',{name:'虛構舊人物',role:'',desc:'',confirmed:true},[],'old'));
    bundle.ops.push(revision('visit','old-visit',{store:'old-store',date:'',source:'手動',text:'舊庫獨有備註',next:'',topics:['old-topic'],people:['old-person'],attachments:[{blob,name:'虛構.txt',mime:'text/plain'}]},[],'old'));
  }
  return { meta, key, bundle, envelope: await seal(bundle,key,meta) };
}
function resetBody(envelope, expectedVersion) { return { envelope, expectedVersion, operationId: uuid(), confirmation:'清空全部資料' }; }

test('Mac rebuild archives the full old encrypted vault and creates an empty isolated active snapshot',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pharmacy-rebuild-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const old=await fixture(true), fresh=await fixture(), snapshot={version:12,envelope:old.envelope};atomic(path.join(dir,'snapshot.json'),snapshot);
  const body=resetBody(fresh.envelope,12), next=rebuildSnapshot(dir,snapshot,body);
  assert.equal(next.version,13);assert.ok(next.retiredVaults.includes(old.meta.vaultId));
  assert.deepEqual(await unseal(next.envelope,fresh.key),emptyBundle(fresh.meta.vaultId));
  const archive=JSON.parse(fs.readFileSync(path.join(dir,'archives',next.rebuild.archive)));
  assert.deepEqual(await unseal(archive.envelope,old.key),old.bundle);
  assert.equal(fs.statSync(path.join(dir,'archives',next.rebuild.archive)).mode&0o777,0o600);
  assert.equal(fs.readFileSync(path.join(dir,'snapshot.json'),'utf8').includes('舊庫獨有'),false);
  assert.throws(()=>merge(fresh.bundle,old.bundle),/不同/);
  assert.deepEqual(rebuildSnapshot(dir,next,body),next); // Lost response can be acknowledged, not reset again.
  assert.throws(()=>rebuildSnapshot(dir,next,resetBody(old.envelope,13)),/舊備份/);
  assert.throws(()=>rebuildSnapshot(dir,next,resetBody(fresh.envelope,12)),/已更新/);
  assert.throws(()=>rebuildSnapshot(dir,next,{...body,confirmation:''}),/確認/);
});
test('archive or snapshot write failures leave the old active snapshot intact',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pharmacy-rebuild-failure-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const old=await fixture(true), fresh=await fixture(), snapshot={version:1,envelope:old.envelope};atomic(path.join(dir,'snapshot.json'),snapshot);
  for(const failAt of ['archive','snapshot']) {
    const body=resetBody(fresh.envelope,1);
    assert.throws(()=>rebuildSnapshot(dir,snapshot,body,(file,value)=>{
      if((failAt==='archive'&&file.includes('archives'))||(failAt==='snapshot'&&file.endsWith('snapshot.json'))) throw new Error('disk failure');atomic(file,value);
    }),/disk failure/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json'))),snapshot);
  }
});

test('real HTTPS cutover rejects old tokens, pending uploads, old pairing codes and foreign backup writes after restart',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pharmacy-reset-https-'));makeCertificates(dir,'fixture.local');
  const admin='fictional-admin-only';atomic(path.join(dir,'config.json'),{hostname:'fixture.local',port:8443,adminToken:admin,devices:[]});
  let service=createService({dataDir:dir,host:'127.0.0.1',port:0}), address=await service.listen();
  t.after(()=>{service.server.closeAllConnections();service.server.close();fs.rmSync(dir,{recursive:true,force:true});});
  const ca=fs.readFileSync(path.join(dir,'tls','ca.crt'));
  function request(route,method='GET',body,token,hold=false) {
    let req;const response=new Promise((resolve,reject)=>{
      req=https.request({host:'127.0.0.1',servername:'localhost',port:address.port,path:route,method,ca,headers:{Host:`localhost:${address.port}`,Origin:`https://localhost:${address.port}`,'Content-Type':'application/json','X-Pharmacy-Client':'1',...(token?{Authorization:'Bearer '+token}:{})}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);
      if(hold) req.flushHeaders();else req.end(body===undefined?undefined:JSON.stringify(body));
    });return hold?{response,end:body=>req.end(JSON.stringify(body))}:response;
  }
  async function pair() {const code=(await request('/api/admin/code','POST',{},admin)).body.code;return (await request('/api/pair','POST',{code,label:'虛構裝置'})).body;}
  const old=await fixture(true), fresh=await fixture(), device=await pair();
  await request('/api/snapshot','PUT',{expectedVersion:0,envelope:old.envelope},device.token);
  const oldCode=(await request('/api/admin/code','POST',{},admin)).body.code;
  const seen=new Promise(resolve=>service.server.once('request',resolve));
  const pending=request('/api/snapshot','PUT',null,device.token,true);await seen;
  const body=resetBody(fresh.envelope,1);
  assert.equal((await request('/api/admin/rebuild','POST',body,device.token)).status,403);
  assert.equal((await request('/api/admin/rebuild','POST',body,admin)).status,200);
  pending.end({expectedVersion:2,envelope:old.envelope});assert.equal((await pending.response).status,401);
  assert.equal((await request('/api/snapshot','GET',undefined,device.token)).status,401);
  assert.equal((await request('/api/pair','POST',{code:oldCode,label:'旧碼'})).status,403);
  const adminStatus=(await request('/api/admin/status','GET',undefined,admin)).body;assert.equal(adminStatus.devices.length,0);assert.equal(adminStatus.rebuild.hasBackup,true);
  const archive=await request('/api/admin/rebuild-backup','GET',undefined,admin);assert.deepEqual(await unseal(archive.body.envelope,old.key),old.bundle);
  assert.equal((await request('/archives/'+adminStatus.rebuild.id)).status,404);
  await new Promise(resolve=>{service.server.close(resolve);service.server.closeAllConnections();});
  service=createService({dataDir:dir,host:'127.0.0.1',port:0});address=await service.listen();
  assert.equal((await request('/api/snapshot','GET',undefined,device.token)).status,401);
  const adopted=await pair();assert.deepEqual(await unseal(adopted.snapshot.envelope,fresh.key),fresh.bundle);
  assert.equal((await request('/api/snapshot','PUT',{expectedVersion:2,envelope:old.envelope},adopted.token)).status,409);
  assert.equal((await request('/api/snapshot','PUT',{expectedVersion:2,envelope:fresh.envelope},adopted.token)).status,200);
  assert.equal((await request('/api/snapshot','GET',undefined,adopted.token)).body.rebuild.id,body.operationId);
  service.prepare();assert.equal((await request('/api/admin/rebuild','POST',resetBody((await fixture()).envelope,3),admin)).status,503);
});

test('adopting a rebuilt snapshot never merges old data and a reviewed import starts with only the approved group',async()=>{
  const old=await fixture(true), fresh=await fixture();
  const paired={id:'new-device',token:'new-token',snapshot:{version:9,envelope:fresh.envelope,rebuild:{id:uuid()}}};
  await assert.rejects(openRebuiltSnapshot(paired,old.meta.vaultId,'wrong','Mac'),/密碼/);
  await assert.rejects(openRebuiltSnapshot(paired,fresh.meta.vaultId,PASSWORD,'Mac'),/尚未重建/);
  await assert.rejects(openRebuiltSnapshot({...paired,snapshot:{...paired.snapshot,rebuild:null}},old.meta.vaultId,PASSWORD,'Mac'),/尚未重建/);
  const next=await openRebuiltSnapshot(paired,old.meta.vaultId,PASSWORD,'Mac');assert.equal(next.payload.bundle.ops.length,0);assert.deepEqual(next.payload.bundle.blobs,{});
  const file=await prepareCSV('虛構.csv',new TextEncoder().encode('Title,Note,URL\n虛構新門市,新庫原文,https://maps.google.com/?cid=12345678'));
  const base=await planCSV([file],next.payload.bundle), r=base.rows[0];
  const packet={format:'pharmacy-csv-review-1',files:[{file:file.file,list:file.list,sha256:file.blob,content:b64(file.bytes)}],groups:[{id:'g',label:'虛構新門市',pending:true,rows:[{sha256:file.blob,line:r.line,fingerprint:r.fingerprint}]}],excluded:[]};
  const review=await prepareReviewedCSV(JSON.stringify(packet));
  const imported=buildCSVImport(await planReviewedCSV(review,next.payload.bundle),next.payload.bundle,'mac').bundle;
  assert.deepEqual(project(imported).map(r=>r.type).sort(),['source','store','visit']);assert.equal(JSON.stringify(imported).includes('舊庫獨有'),false);
  assert.equal(project(imported).find(r=>r.type==='store').csvIdentityPending,true);
  const repeated=buildCSVImport(await planReviewedCSV(review,imported),imported,'mac');assert.equal(repeated.summary.rows,0);assert.equal(repeated.summary.sourceSnapshots,1);assert.equal(project(repeated.bundle).filter(r=>r.type==='source').length,2);
  const phone=await openRebuiltSnapshot({...paired,snapshot:{...paired.snapshot,envelope:await seal(imported,fresh.key,fresh.meta)}},old.meta.vaultId,PASSWORD,'phone');
  assert.deepEqual(phone.payload.bundle,imported);
});

// Transactional IDB model: requests run asynchronously and abort discards the
// entire staged transaction, including an archive already added before failure.
function idbModel() {
  let values=new Map();const flags={failPut:false};
  const db={transaction(){
    let draft=structuredClone(values), pending=0, aborted=false, scheduled=false;const tx={abort(){if(aborted)return;aborted=true;queueMicrotask(()=>tx.onabort?.());}};
    function schedule(){if(scheduled)return;scheduled=true;setImmediate(()=>{scheduled=false;if(!aborted&&!pending){values=draft;tx.oncomplete?.();}});}
    function op(fn){const r={};pending++;queueMicrotask(()=>{if(aborted)return;try{r.result=fn();r.onsuccess?.();}catch(e){r.error=e;r.onerror?.();tx.abort();}pending--;schedule();});return r;}
    tx.objectStore=()=>({get:key=>op(()=>structuredClone(draft.get(key))),add:(v,k)=>op(()=>{if(draft.has(k))throw new Error('duplicate');draft.set(k,structuredClone(v));}),put:(v,k)=>op(()=>{if(flags.failPut)throw new Error('quota');draft.set(k,structuredClone(v));}),openCursor:()=>{
      const rows=[...draft],r={};let i=0;const deliver=()=>queueMicrotask(()=>{const pair=rows[i++];r.result=pair?{key:pair[0],value:pair[1],continue:deliver}:null;r.onsuccess?.();});deliver();return r;
    }});return tx;
  }};
  return {flags,indexedDB:{open(){const r={};queueMicrotask(()=>{r.result=db;r.onsuccess?.();});return r;}}};
}
test('local archive and replacement commit together; quota failure and stale tabs cannot mix vaults',async t=>{
  const model=idbModel(), previous=globalThis.indexedDB;globalThis.indexedDB=model.indexedDB;t.after(()=>{globalThis.indexedDB=previous;});
  const db=await import('../public/db.js?rebuild-transaction');
  const old=await fixture(true), fresh=await fixture(), oldPayload={bundle:old.bundle,token:'retired',device:'old'};
  const oldDevice=await seal(oldPayload,old.key,old.meta,'device'), newDevice=await seal({bundle:fresh.bundle,token:'fresh'},fresh.key,fresh.meta,'device');
  await db.writeLocal(oldDevice,0,old.key);
  model.flags.failPut=true;await assert.rejects(db.archiveAndReplaceLocal(newDevice,1,fresh.key),/舊資料保持/);
  assert.equal((await db.listLocalArchives()).length,0);assert.deepEqual((await db.readLocal()).envelope,oldDevice);
  model.flags.failPut=false;const rev=await db.archiveAndReplaceLocal(newDevice,1,fresh.key);assert.equal(rev,2);
  const archives=await db.listLocalArchives();assert.equal(archives.length,1);assert.deepEqual(Object.keys(archives[0]).sort(),['at','id']);
  const archived=await db.readLocalArchive(archives[0].id);assert.deepEqual(await unseal(archived.envelope,archived.unlockKey,'device'),oldPayload);
  assert.deepEqual((await unseal((await db.readLocal()).envelope,fresh.key,'device')).bundle,fresh.bundle);
  await assert.rejects(db.writeLocal(oldDevice,1,old.key),/另一個視窗/);
  await assert.rejects(db.archiveAndReplaceLocal(oldDevice,1,old.key),/另一個視窗/);
  await assert.rejects(db.readLocalArchive('main'),/識別/);
  assert.equal((await db.listLocalArchives()).length,1);
});

test('actual backup import rejects a retired vault before decrypting or changing the active database',async()=>{
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),old=await fixture(true),fresh=await fixture();let writes=0;
  const ctx=vm.createContext({meta:fresh.meta,key:fresh.key,payload:{bundle:fresh.bundle},validateBundle,unseal,merge,persist:async()=>writes++});
  vm.runInContext(app.slice(app.indexOf('async function importBackup('),app.indexOf('async function adoptRebuilt(')),ctx);
  const backup=JSON.stringify({format:'pharmacy-backup-1',envelope:old.envelope});
  await assert.rejects(ctx.importBackup({size:backup.length,text:async()=>backup}),/另一個資料庫/);assert.equal(writes,0);
});

test('actual device-switch UI keeps the active vault on failure, then clears old graph state only after local commit',async()=>{
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),old=await fixture(true),fresh=await fixture();
  const paired={id:'fresh-id',token:'fresh-token',snapshot:{version:2,envelope:fresh.envelope,rebuild:{id:uuid()}}};
  const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',innerHTML:'old graph',close(){this.closed=true;},reset(){},replaceChildren(){this.innerHTML='';}});return nodes.get(id);};
  $('rebuild-code').value='fixture-code';$('rebuild-understood').checked=true;
  let failWrite=true,writes=0,locationClears=0;
  const ctx=vm.createContext({$,meta:old.meta,key:old.key,payload:{bundle:old.bundle,deviceName:'Mac'},localRevision:1,slot:{},openRebuiltSnapshot,seal,editorContext:null,csvImport:{hasPending:()=>false,reset(){}},qualityCache:{},qualityReview:{},records:project(old.bundle),trail:['old'],focus:{type:'store',id:'old-store'},graphPage:1,objectURLs:[],lastError:'old',lastSyncFailure:{},syncWarning:'',
    clearNearbyPosition:()=>{locationClears++;},api:async()=>paired,archiveAndReplaceLocal:async()=>{if(failWrite)throw new Error('quota');writes++;return 2;},openWorkspace:async()=>{},switchView:view=>ctx.view=view,toast:message=>ctx.notice=message,
    run:async(fn,errorTarget)=>{try{await fn();}catch(e){$(errorTarget).textContent=e.message;}},
  });
  vm.runInContext("let storeFilters = {query:'old',groups:['great-tree']};" + app.slice(app.indexOf('function resetStoreFilters('),app.indexOf('function changeStoreFilter(')) + app.slice(app.indexOf('async function adoptRebuilt('),app.indexOf('async function openArchives(')),ctx);
  $('rebuild-connect-password').value='wrong';await ctx.adoptRebuilt({preventDefault(){}});assert.equal(ctx.meta.vaultId,old.meta.vaultId);assert.equal(writes,0);
  $('rebuild-connect-password').value=PASSWORD;await ctx.adoptRebuilt({preventDefault(){}});assert.equal(ctx.meta.vaultId,old.meta.vaultId);assert.equal($('graph').innerHTML,'old graph');assert.equal(writes,0);
  assert.equal(locationClears,0);failWrite=false;$('rebuild-connect-password').value=PASSWORD;await ctx.adoptRebuilt({preventDefault(){}});
  assert.equal(writes,1);assert.equal(locationClears,1);assert.equal(ctx.meta.vaultId,fresh.meta.vaultId);assert.equal(ctx.payload.bundle.ops.length,0);assert.equal($('graph').innerHTML,'');assert.equal(ctx.records.length,0);assert.equal(ctx.trail.length,0);assert.equal(ctx.view,'csv');assert.equal($('rebuild-connect-password').value,'');
  assert.equal(vm.runInContext('storeFilters.groups.length',ctx),0);assert.equal($('customer-search').value,'');assert.equal($('retail-options').innerHTML,'');
});

test('actual Mac rebuild form requires the scope phrase and sends only a newly encrypted empty vault',async()=>{
  const source=fs.readFileSync(new URL('../public/admin.js',import.meta.url),'utf8').replace(/^import .*\n/,'');
  const nodes=new Map(),requests=[];const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,dataset:{},handlers:{},textContent:'',disabled:false,addEventListener(event,fn){this.handlers[event]=fn;},replaceChildren(){},append(){},reset(){},className:''});return nodes.get(id);};
  let status={hostname:'fixture.local',version:3,backups:1,devices:[],rebuild:null,appVersion:'1.5.2',update:{phase:'idle',configured:false,history:[]}};
  const ctx=vm.createContext({newMeta,derive,seal,emptyBundle,uuid,AbortController,setTimeout,clearTimeout,setInterval:()=>0,location:{hash:'#fictional-admin',port:'8443'},history:{replaceState(){}},document:{hidden:false,getElementById:node,querySelectorAll:()=>[],createElement:()=>({})},fetch:async(route,options)=>{
    const body=options.body?JSON.parse(options.body):undefined;requests.push({route,body});
    if(route.endsWith('/rebuild'))status={...status,version:4,rebuild:{id:body.operationId,at:new Date().toISOString(),hasBackup:true}};
    return {ok:true,json:async()=>status};
  }});
  vm.runInContext(source,ctx);await new Promise(resolve=>setImmediate(resolve));
  node('rebuild-password').value=PASSWORD;node('rebuild-password-again').value=PASSWORD;node('rebuild-confirm').value='';
  await node('rebuild-form').handlers.submit({preventDefault(){}});assert.equal(requests.some(r=>r.route.endsWith('/rebuild')),false);
  node('rebuild-confirm').value='清空全部資料';await node('rebuild-form').handlers.submit({preventDefault(){}});
  const sent=requests.find(r=>r.route.endsWith('/rebuild'));assert.ok(sent);assert.equal(JSON.stringify(sent.body).includes(PASSWORD),false);
  const decrypted=await unseal(sent.body.envelope,await derive(PASSWORD,sent.body.envelope));assert.deepEqual(decrypted,emptyBundle(sent.body.envelope.vaultId));
  assert.equal(node('rebuild-password').value,'');assert.equal(node('rebuild-password-again').value,'');assert.match(node('rebuild-result').textContent,/空白資料庫/);
});
