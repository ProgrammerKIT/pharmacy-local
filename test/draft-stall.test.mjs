import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const turn=()=>new Promise(setImmediate);
function clock(){let id=0;const timers=new Map();return{setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},fire(ms){for(const[k,v]of[...timers])if(v.ms<=ms){timers.delete(k);v.fn();}},timers};}
async function database(t){
 const timer=clock(),values=new Map(),opens=[],state={stallOpen:false,stallCommit:false,aborts:0,puts:0};
 const indexedDB={open(){const req={};opens.push(req);const db={closed:false,close(){this.closed=true;},transaction(){if(this.closed)throw Object.assign(Error('closed'),{name:'InvalidStateError'});const draft=structuredClone(values);let aborted=false;const tx={abort(){if(aborted)return;aborted=true;state.aborts++;queueMicrotask(()=>tx.onabort?.());},objectStore(){return{get(k){const r={};queueMicrotask(()=>{if(aborted)return;r.result=structuredClone(draft.get(k));r.onsuccess?.();});return r;},put(value,key){state.puts++;draft.set(key,structuredClone(value));if(!state.stallCommit)queueMicrotask(()=>{if(aborted)return;values.clear();for(const[k,v]of draft)values.set(k,v);tx.oncomplete?.();});}};}};return tx;}};req.deliver=()=>{req.result=db;req.onsuccess?.();};if(!state.stallOpen)queueMicrotask(req.deliver);return req;}};
 const original={indexedDB:globalThis.indexedDB,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};Object.assign(globalThis,{indexedDB,setTimeout:timer.setTimeout,clearTimeout:timer.clearTimeout});t.after(()=>Object.assign(globalThis,original));
 const db=await import('../public/db.js?stall='+crypto.randomUUID());return{db,timer,values,opens,state};
}
test('a never-answering Safari open fails boundedly; late open cannot replace the fresh connection',async t=>{
 const h=await database(t);h.state.stallOpen=true;const result=h.db.readLocal().catch(e=>e);await turn();assert.equal(h.opens.length,1);
 h.timer.fire(15000);assert.match((await result).message,/開啟逾時/);h.state.stallOpen=false;
 await h.db.writeLocal({cipher:'retained'},0,{key:'same'});h.opens[0].deliver();assert.equal(h.opens[0].result.closed,true);
 assert.equal((await h.db.readLocal()).envelope.cipher,'retained');assert.equal(h.opens.length,2);assert.equal(h.timer.timers.size,0);
});
test('a hung transaction aborts without replay; explicit retry keeps CAS, original ciphertext and key',async t=>{
 const h=await database(t);await h.db.writeLocal({cipher:'original'},0,{key:'retained'});h.state.stallCommit=true;
 const result=h.db.writeLocal({cipher:'not committed'},1,{key:'retained'}).catch(e=>e);await turn();assert.equal(h.state.puts,2);
 h.timer.fire(30000);assert.match((await result).message,/保存逾時/);await turn();assert.equal(h.values.get('main').envelope.cipher,'original');assert.equal(h.values.get('main').revision,1);assert.equal(h.state.aborts,1);assert.equal(h.state.puts,2,'no automatic write replay');
 h.state.stallCommit=false;assert.equal(await h.db.writeLocal({cipher:'latest explicit retry'},1,{key:'retained'}),2);
 await assert.rejects(h.db.writeLocal({cipher:'stale'},1),/另一個視窗/);assert.equal(h.values.get('main').envelope.cipher,'latest explicit retry');assert.equal(h.timer.timers.size,0);
});
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),core=fs.readFileSync(new URL('../public/core.js',import.meta.url),'utf8');
const part=(text,a,b)=>text.slice(text.indexOf(a),text.indexOf(b,text.indexOf(a)+a.length));
test('a hung encrypt releases actual run busy state; late crypto completion never starts a database write',async()=>{
 const timer=clock();let finish;const source={bundle:{ops:[]},inlineTextDraft:null},next={...source,inlineTextDraft:{after:'new private fictional text'}};
 const c=vm.createContext({...timer,enc:new TextEncoder(),MAX_DEVICE_BYTES:1e6,MAX_BYTES:1e6,aad:()=>new Uint8Array(),FORMAT:'fictional',b64:b=>Buffer.from(b).toString('base64'),crypto:{getRandomValues:v=>v,subtle:{encrypt:()=>new Promise(r=>finish=r)}},payload:source,key:{},meta:{vaultId:'fictional',salt:'fictional',iterations:600000},localRevision:1,slot:null,localSaveState:'saved',syncInProgress:false,hasNewFormalChanges:()=>false,withPendingSync:(_old,n)=>n,renderDataSafetyEntry(){},$:()=>({textContent:''}),writes:0,async writeLocal(){c.writes++;return 2;},busy:false,updateHolding:false,pendingLock:false,buttons:disabled=>{c.disabled=disabled;},toast:message=>{c.error=message;},document:{hidden:false},syncScheduler:{wake(){},request(){}}});
 vm.runInContext(part(core,'export async function seal(','export async function unseal(').replace('export ',''),c);
 vm.runInContext(part(app,'async function persist(','function hasNewFormalChanges(')+part(app,'async function run(','function programDetail('),c);
 c.next=next;const task=vm.runInContext('run(()=>persist(next))',c);await turn();assert.equal(c.busy,true);timer.fire(30000);await task;
 assert.equal(c.busy,false);assert.equal(c.disabled,false);assert.match(c.error,/加密逾時/);assert.equal(c.localSaveState,'failed');assert.equal(c.payload,source);assert.equal(c.writes,0);
 finish(new ArrayBuffer(16));await turn();assert.equal(c.writes,0);assert.equal(c.payload,source);
});
function inline(){const timer=clock(),state={textContent:''},ctx={id:'fictional',before:'original',after:'edit 0',parents:['head']};let first;
 const shell={querySelector:()=>state},element={closest:()=>shell};
 const c=vm.createContext({...timer,inlineTextContext:ctx,inlineDraftTimer:null,inlineDraftSaveChain:Promise.resolve(),payload:{bundle:{ops:[]},inlineTextDraft:null},by:()=>({deleted:false,conflict:false}),inlineTextElement:()=>element,quickTextParents:()=>['head'],releaseIdleInlineEdit(){},writes:[],calls:0,fail:false,async persist(next,options){c.calls++;options?.onProgress?.('writing');if(c.fail)throw Error('fictional storage unavailable');if(c.calls===1)await new Promise(r=>first=r);c.writes.push(next.inlineTextDraft);c.payload=next;}});
 vm.runInContext(part(app,'async function persistInlineTextDraft(','function updateInlineText('),c);
 return{c,ctx,state,timer,finish:()=>first()};}
test('rapid input coalesces to one pending latest draft; reviewing already saved text does not rewrite the vault',async()=>{
 const h=inline();h.c.scheduleInlineTextDraft();h.timer.fire(500);await turn();assert.equal(h.c.calls,1);
 for(let i=1;i<=20;i++){h.ctx.after='edit '+i;h.c.scheduleInlineTextDraft();h.timer.fire(500);await turn();}
 assert.equal(h.c.calls,1);assert.doesNotMatch(h.state.textContent,/已加密保存在/);
 h.finish();await h.c.inlineDraftSaveChain;assert.equal(h.c.calls,2);assert.equal(h.c.payload.inlineTextDraft.after,'edit 20');assert.match(h.state.textContent,/已加密保存在/);
 await h.c.flushInlineTextDraft();assert.equal(h.c.calls,2,'no identical whole-vault re-encryption on review');assert.equal(h.ctx.after,'edit 20');assert.equal(h.c.payload.bundle.ops.length,0);
});
test('failed explicit flush reports an enduring error, retains input and permits a later explicit attempt',async()=>{
 const h=inline();h.c.fail=true;await assert.rejects(h.c.flushInlineTextDraft(),/storage unavailable/);assert.match(h.state.textContent,/草稿儲存失敗/);assert.equal(h.ctx.after,'edit 0');assert.equal(h.c.writes.length,0);
 h.c.fail=false;await h.c.flushInlineTextDraft();assert.equal(h.c.payload.inlineTextDraft.after,'edit 0');assert.match(h.state.textContent,/已加密保存在/);assert.equal(h.c.payload.bundle.ops.length,0);
});
