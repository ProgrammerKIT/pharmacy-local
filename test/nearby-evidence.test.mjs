import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyBundle,revision,project,planNearbyCoordinates,applyNearbyCoordinates,nearbyCoordinateEvidence,storeCoordinates,nearestStores,merge,seal,unseal,newMeta,derive,validateBundle} from '../public/core.js';
const fid='0x123:0x456',idURL=`https://www.google.com/maps/data=!1s${fid}`;
const fullURL=`${idURL}!3d25!4d121`;
function fixture(){const b=emptyBundle('device');b.ops.push(revision('store','s',{name:'虛構別稱店',district:'',city:'',channel:'',attr:'',contact:'',mapUrl:idURL,address:'',csvAliases:['虛構原店名']},[],'device'));return b;}
const input=()=>({format:'pharmacy-coordinate-review-1',items:[{featureId:fid,resolvedUrl:fullURL,latitude:25,longitude:121,googleName:'虛構原店名',sourceNames:['虛構別稱店','虛構原店名'],checkedAt:'2026-11-13T00:00:00Z'}]});
test('renamed store with exact original feature gets independent evidence, original entities stay byte-identical',async()=>{
 const b=fixture(),before=JSON.stringify(b),plan=planNearbyCoordinates(b,input());assert.equal(plan.changes.length,1);
 const next=await applyNearbyCoordinates(b,input(),plan,'phone');assert.equal(JSON.stringify(b),before);assert.deepEqual(next.ops.slice(0,b.ops.length),b.ops);
 const records=project(next),s=records.find(r=>r.type==='store');assert.equal(s.mapUrl,idURL);assert.equal(s.name,'虛構別稱店');assert.equal(next.ops.at(-1).type,'source');
 const evidence=nearbyCoordinateEvidence(next);assert.equal(evidence.length,1);assert.deepEqual(storeCoordinates(s,evidence),{latitude:25,longitude:121});
 assert.equal(nearestStores([s],{latitude:25,longitude:121},4,evidence)[0].distance,0);assert.equal(planNearbyCoordinates(next,input()).changes.length,0);
 const meta=newMeta(),key=await derive('fictional-testing-password',meta);const opened=await unseal(await seal(next,key,meta),key);assert.deepEqual(nearbyCoordinateEvidence(opened),evidence);
});
test('identity or geography changes, removed stores, collisions and contradictory evidence never reuse a pin',async()=>{
 const b=fixture(),next=await applyNearbyCoordinates(b,input(),planNearbyCoordinates(b,input()),'a');const s=project(next).find(r=>r.type==='store'),e=nearbyCoordinateEvidence(next);
 for(const delta of [{name:'改名'},{mapUrl:''},{address:'改址'},{deleted:true},{conflict:true},{mergedInto:'other'},{csvIdentityPending:true}])assert.equal(storeCoordinates({...s,...delta},e),null);
 const collision=fixture();collision.ops.push(revision('store','s2',collision.ops[0].data,[],'other'));assert.equal(planNearbyCoordinates(collision,input()).changes.length,0);
 const unknown=input();unknown.items[0].googleName='未知店名';assert.equal(planNearbyCoordinates(b,unknown).changes.length,0);
 const wrong=input();wrong.items[0].sourceNames=['虛構原店名'];assert.equal(planNearbyCoordinates(b,wrong).changes.length,0);
 const bad=structuredClone(e[0]);bad.mapUrl=fullURL.replace('!3d25','!3d26');assert.equal(storeCoordinates(s,[...e,bad]),null);
 const mismatched=structuredClone(next);mismatched.ops.at(-1).data.nearbyCoordinate.mapUrl=bad.mapUrl;assert.equal(nearbyCoordinateEvidence(mismatched).length,0);
 const changed=structuredClone(b);changed.ops.push(revision('store','s',{...b.ops[0].data,name:'改名'},[b.ops[0].id],'b'));await assert.rejects(applyNearbyCoordinates(changed,input(),planNearbyCoordinates(b,input()),'a'),/改變/);
});
test('concurrent independent evidence survives merge without modifying store heads',async()=>{
 const b=fixture(),plan=planNearbyCoordinates(b,input());const a=await applyNearbyCoordinates(b,input(),plan,'a'),c=await applyNearbyCoordinates(b,input(),plan,'c'),n=merge(a,c);
 assert.deepEqual(project(n).find(r=>r.type==='store').heads,project(b).find(r=>r.type==='store').heads);
 assert.deepEqual(storeCoordinates(project(n).find(r=>r.type==='store'),nearbyCoordinateEvidence(n)),{latitude:25,longitude:121});
});

test('location sources cannot impersonate another source channel or refer to an absent store',async()=>{
 const b=fixture(),n=await applyNearbyCoordinates(b,input(),planNearbyCoordinates(b,input()),'a'),op=n.ops.at(-1);
 assert.throws(()=>revision('source','bad',{...op.data,monthlyAnalysis:{}},[],'qa'));
 const changed=structuredClone(n);changed.ops.at(-1).data.nearbyCoordinate.storeId='absent';assert.throws(()=>validateBundle(changed),/座標/);
 const wrong=structuredClone(n);wrong.ops.at(-1).data.nearbyCoordinate.address='tampered';assert.throws(()=>validateBundle(wrong),/原件/);
});
test('original CSV title permits a renamed store and source bytes remain unchanged',async()=>{
 const b=fixture(),blob='a'.repeat(64);b.blobs[blob]='dGVzdA==';delete b.ops[0].data.csvAliases;
 b.ops[0].data.csvSources=[{file:'fictional.csv',fingerprint:blob,batch:'batch',list:'test',at:'2026-11-13',blob,line:1,headers:['標題','網址'],cells:['虛構原店名',idURL]}];
 const old=structuredClone(b),p=planNearbyCoordinates(b,input());assert.equal(p.changes.length,1);
 const n=await applyNearbyCoordinates(b,input(),p,'qa');assert.deepEqual(n.ops.slice(0,b.ops.length),old.ops);assert.equal(n.blobs[blob],old.blobs[blob]);
});
