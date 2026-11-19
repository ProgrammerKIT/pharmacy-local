import test from 'node:test';
import assert from 'node:assert/strict';
function model(){
 const values=new Map(),handles=[],state={opens:0,transactions:0,commits:0,failOpen:0,throwOpen:0,closeBefore:0,abortNext:false,failPut:false,afterCommitClose:false};
 const indexedDB={open(){state.opens++;if(state.throwOpen-- >0)throw Object.assign(Error('open failed synchronously'),{name:'InvalidStateError'});const request={};queueMicrotask(()=>{
  if(state.failOpen-- >0){request.error=Object.assign(Error('open failed'),{name:'UnknownError'});request.onerror?.();return;}
  const db={closed:false,close(){this.closed=true;},transaction(_store,mode='readonly'){
   state.transactions++;if(this.closed||state.closeBefore-- >0){this.closed=true;throw Object.assign(Error('The database connection is closing.'),{name:'InvalidStateError'});}
   const draft=structuredClone(values);let pending=0,aborted=false,scheduled=false;
   const tx={error:null,abort(){if(aborted)return;aborted=true;queueMicrotask(()=>tx.onabort?.());}};
   const schedule=()=>{if(scheduled)return;scheduled=true;setImmediate(()=>{scheduled=false;if(aborted||pending)return;if(mode==='readwrite'&&state.abortNext){state.abortNext=false;tx.error=Object.assign(Error('interrupted'),{name:'AbortError'});tx.abort();return;}if(mode==='readwrite'){values.clear();for(const [k,v]of draft)values.set(k,v);}state.commits++;if(state.afterCommitClose){state.afterCommitClose=false;db.closed=true;db.onclose?.();}tx.oncomplete?.();});};
   const op=fn=>{const r={};pending++;queueMicrotask(()=>{if(aborted)return;try{r.result=fn();r.onsuccess?.();}catch(e){r.error=e;tx.error=e;r.onerror?.();tx.abort();}pending--;schedule();});return r;};
   tx.objectStore=()=>({get:k=>op(()=>structuredClone(draft.get(k))),put:(v,k)=>op(()=>{if(state.failPut)throw Object.assign(Error('quota'),{name:'QuotaExceededError'});draft.set(k,structuredClone(v));}),add:(v,k)=>op(()=>{if(draft.has(k))throw Object.assign(Error('duplicate'),{name:'ConstraintError'});draft.set(k,structuredClone(v));}),openCursor:()=>{const entries=[...draft],r={};let i=0;pending++;const deliver=()=>queueMicrotask(()=>{if(aborted)return;const item=entries[i++];r.result=item?{key:item[0],value:item[1],continue:deliver}:null;r.onsuccess?.();if(!item){pending--;schedule();}});deliver();return r;}});
   return tx;
  }};handles.push(db);request.result=db;request.onsuccess?.();
 });return request;}};
 return {indexedDB,state,values,handles};
}
async function setup(t){const m=model(),previous=globalThis.indexedDB;globalThis.indexedDB=m.indexedDB;t.after(()=>{globalThis.indexedDB=previous});const db=await import('../public/db.js?connection='+crypto.randomUUID());return {...m,db};}
test('Safari closing connection reopens before write, preserving CAS, ciphertext, unlock key and unrelated records',async t=>{
 const m=await setup(t);await m.db.writeLocal({cipher:'old'},0,{key:'same'});m.values.set('unrelated',{unchanged:true});m.state.closeBefore=1;
 assert.equal(await m.db.writeLocal({cipher:'latest draft'},1,{key:'same'}),2);assert.equal(m.state.opens,2);const row=await m.db.readLocal();assert.deepEqual(row,{envelope:{cipher:'latest draft'},revision:2,unlockKey:{key:'same'}});assert.deepEqual(m.values.get('unrelated'),{unchanged:true});
 await assert.rejects(m.db.writeLocal({cipher:'stale'},1),/另一個視窗/);assert.equal((await m.db.readLocal()).revision,2);
});
test('unexpected close and versionchange invalidate cache; old close cannot invalidate newer handle',async t=>{
 const m=await setup(t);await m.db.writeLocal({cipher:'saved'},0,{});const old=m.handles[0];old.closed=true;old.onclose?.();assert.equal((await m.db.readLocal()).revision,1);assert.equal(m.state.opens,2);
 old.onclose?.();await m.db.readLocal();assert.equal(m.state.opens,2);const latest=m.handles.at(-1);latest.onversionchange?.();assert.equal(latest.closed,true);await m.db.readLocal();assert.equal(m.state.opens,3);
});
test('failed open is not cached forever; subsequent user retry can open without clearing any data',async t=>{
 const m=await setup(t);m.state.failOpen=1;await assert.rejects(m.db.readLocal(),/open failed/);assert.equal(await m.db.readLocal(),null);assert.equal(m.state.opens,2);
});
test('repeated closing is bounded and leaves original data; transaction abort and quota failure are never replayed',async t=>{
 const m=await setup(t);await m.db.writeLocal({cipher:'original'},0,{});m.state.closeBefore=2;await assert.rejects(m.db.writeLocal({cipher:'not saved'},1),/連線|closing/);assert.equal(m.state.opens,2);assert.equal(m.values.get('main').revision,1);
 m.state.closeBefore=0;await m.db.readLocal();const opens=m.state.opens,transactions=m.state.transactions;m.state.abortNext=true;await assert.rejects(m.db.writeLocal({cipher:'aborted'},1));assert.equal(m.state.transactions,transactions+1);assert.equal(m.state.opens,opens);assert.equal(m.values.get('main').revision,1);
 m.state.failPut=true;await assert.rejects(m.db.writeLocal({cipher:'quota'},1),/儲存失敗/);assert.equal(m.state.opens,opens);assert.equal(m.values.get('main').envelope.cipher,'original');
});
test('close after commit does not replay write or duplicate archive; archives can be read after reconnect',async t=>{
 const m=await setup(t);await m.db.writeLocal({cipher:'original'},0,{key:'retained'});m.state.closeBefore=1;m.state.afterCommitClose=true;assert.equal(await m.db.archiveAndReplaceLocal({cipher:'new vault'},1,{key:'new'}),2);
 const archives=await m.db.listLocalArchives();assert.equal(archives.length,1);assert.equal((await m.db.readLocal()).revision,2);assert.equal((await m.db.readLocalArchive(archives[0].id)).envelope.cipher,'original');assert.equal([...m.values.keys()].filter(k=>k.startsWith('archive:')).length,1);
});
test('weekly recovery settings use the same reconnect boundary and never overwrite main or an existing recovery key',async t=>{
 const m=await setup(t);await m.db.writeLocal({cipher:'main retained'},0,{key:'main'});
 const id='11111111-1111-4111-8111-111111111111',key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const value={key,meta:{vaultId:'v',salt:btoa('1234567890123456'),iterations:600000},sourceVaultId:'v',proofSha256:'a'.repeat(64)};
 m.state.closeBefore=1;await m.db.writeWeeklyRecovery(id,value);m.handles.at(-1).closed=true;const recovered=await m.db.readWeeklyRecovery(id);assert.equal(recovered.key.extractable,false);assert.equal(recovered.meta.salt,value.meta.salt);await assert.rejects(m.db.writeWeeklyRecovery(id,value),/設定已存在/);assert.equal((await m.db.readLocal()).envelope.cipher,'main retained');
});

test('synchronous open failure also releases failed cached promise for the next attempt',async t=>{
 const m=await setup(t);m.state.throwOpen=1;await assert.rejects(m.db.readLocal(),/synchronously/);assert.equal(await m.db.readLocal(),null);assert.equal(m.state.opens,2);
});
