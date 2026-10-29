import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../public/core.js';
async function fixture(){
 const bundle=c.emptyBundle('fictional-vault');
 for(const id of ['a','b'])bundle.ops.push(c.revision('store',id,{name:'虛構'+id+'店',city:'',district:'',channel:'',attr:'原有文字',contact:'原窗口',nextRemember:'原待辦'},[],'fixture'));
 bundle.ops.push(c.revision('visit','note',{store:'a',date:'',text:'歷史文字',source:'虛構',next:'原跟進',people:[],topics:[],attachments:[]},[],'fixture'));
 const bytes=new TextEncoder().encode('fictional-source-only'),blob=await c.hashBytes(bytes);
 const packet={format:'pharmacy-store-supervision-1',organization:'虛構連鎖',effectiveDate:'',sourceDocument:{blob,name:'fictional.jpg',mime:'image/jpeg',base64:c.b64(bytes)},people:[{key:'fictional-person',name:'虛構督導'}],assignments:['a','b'].map(id=>({storeName:'虛構'+id+'店',areaCode:'01',areaName:'虛構小區',personKey:'fictional-person',storeCode:id,sourceLabel:'原圖'+id}))};return{bundle,packet};
}
test('selected assignments preserve original ops, notes, reminders and reuse supervisor on repeat',async()=>{
 const {bundle,packet}=await fixture(),before=structuredClone(bundle),plan=await c.planStoreSupervision(bundle,packet);
 assert.equal(plan.summary.ready,2);assert.deepEqual(bundle,before);
 const one=await c.applyStoreSupervision(bundle,packet,plan,['a'],'test-device');
 assert.deepEqual(one.bundle.ops.slice(0,bundle.ops.length),bundle.ops);assert.deepEqual(bundle,before);assert.equal(one.summary.people,1);
 const records=c.project(one.bundle),person=records.find(r=>r.type==='person');
 assert.equal(c.supervisedStores(records,person.id).length,1);assert.equal(records.find(r=>r.id==='a').nextRemember,'原待辦');
 const retry=await c.planStoreSupervision(one.bundle,packet);assert.equal(retry.summary.unchanged,1);
 const two=await c.applyStoreSupervision(one.bundle,packet,retry,['b'],'test-device');assert.equal(two.summary.people,0);assert.equal(c.supervisedStores(c.project(two.bundle),person.id).length,2);
 const meta=c.newMeta(),key=await c.derive('fictional-new-password',meta),decoded=await c.unseal(await c.seal(two.bundle,key,meta),key);
 assert.deepEqual(decoded,two.bundle);const backup=await c.planBackupImport(null,decoded);assert.equal(backup.summary.warnings.length,0);
});
test('no selection is a no-op; stale plans and altered source reject atomically',async()=>{
 const {bundle,packet}=await fixture(),plan=await c.planStoreSupervision(bundle,packet);
 assert.deepEqual((await c.applyStoreSupervision(bundle,packet,plan,[],'test')).bundle,bundle);
 const changed=structuredClone(bundle);changed.ops.push(c.revision('topic','t',{name:'虛構',desc:''},[],'test'));
 await assert.rejects(c.applyStoreSupervision(changed,packet,plan,['a'],'test'),/預覽已改變/);
 const bad=structuredClone(packet);bad.sourceDocument.base64=c.b64(new Uint8Array([1]));await assert.rejects(c.planStoreSupervision(bundle,bad),/SHA256/);
});
test('duplicates, existing same-name people and source duplicates require review',async()=>{
 for(const mode of ['store','person','source']){
 const {bundle,packet}=await fixture();
 if(mode==='store')bundle.ops.push(c.revision('store','duplicate',{...bundle.ops[0].data},[],'test'));
 if(mode==='person')bundle.ops.push(c.revision('person','p',{name:'虛構督導',role:'',desc:'',confirmed:false,sameAs:''},[],'test'));
 if(mode==='source')packet.assignments.push({...packet.assignments[0]});
 const plan=await c.planStoreSupervision(bundle,packet);assert.equal(plan.rows[0].status,'review');await assert.rejects(c.applyStoreSupervision(bundle,packet,plan,['a'],'test'));
 }
});
test('concurrent district changes remain a visible conflict and retain source documents',async()=>{
 const {bundle,packet}=await fixture(),first=(await c.applyStoreSupervision(bundle,packet,await c.planStoreSupervision(bundle,packet),['a'],'one')).bundle;
 const changed=structuredClone(packet);changed.assignments[0].areaName='虛構異動小區';
 const changed2=structuredClone(packet);changed2.assignments[0].areaName='虛構另一小區';
 const left=(await c.applyStoreSupervision(first,changed,await c.planStoreSupervision(first,changed),['a'],'left')).bundle;
 const right=(await c.applyStoreSupervision(first,changed2,await c.planStoreSupervision(first,changed2),['a'],'right')).bundle;
 const merged=c.merge(left,right);assert.equal(c.project(merged).find(r=>r.id==='a').conflict,true);assert.equal(c.supervisedStores(c.project(merged),c.project(merged).find(r=>r.type==='person').id).length,0);
});
