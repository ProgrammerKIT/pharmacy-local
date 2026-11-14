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

test('changed public names require an exact local manual review, never a package flag',async()=>{
 const b=fixture(),i=input();i.items[0].googleName='虛構公開新店名';i.items[0].address='虛構市測試路1號';
 i.manualNameConfirmed=true;i.nameConfirmations=['s'];
 const p=planNearbyCoordinates(b,i);assert.equal(p.changes.length,0);assert.equal(p.nameReviews.length,1);assert.equal(p.nameReviews[0].confirmed,false);
 const keys=[p.nameReviews[0].reviewKey],reviewed=planNearbyCoordinates(b,i,keys);assert.equal(reviewed.changes.length,1);assert.equal(reviewed.nameReviews[0].confirmed,true);
 await assert.rejects(applyNearbyCoordinates(b,i,reviewed,'qa'),/改變/);
 const before=JSON.stringify(b),n=await applyNearbyCoordinates(b,i,reviewed,'qa',keys);assert.equal(JSON.stringify(b),before);assert.deepEqual(n.ops.slice(0,b.ops.length),b.ops);
 assert.equal(Object.keys(n.ops.at(-1).data.nearbyCoordinate).length,8);assert.match(n.ops.at(-1).data.file,/人工確認/);assert.match(n.ops.at(-1).data.headers[0],/人工已核對/);
 assert.equal(n.ops.at(-1).data.nearbyCoordinate.googleName,'虛構公開新店名');assert.equal(project(n).find(s=>s.type==='store').name,'虛構別稱店');
 assert.equal(planNearbyCoordinates(n,i).changes.length,0);assert.deepEqual(storeCoordinates(project(n).find(s=>s.type==='store'),nearbyCoordinateEvidence(n)),{latitude:25,longitude:121});
});
test('manual name approval cannot bypass identity, address, geography or changed evidence',()=>{
 const b=fixture(),i=input();i.items[0].googleName='虛構公開新店名';i.items[0].address='虛構市測試路1號';
 const keys=[planNearbyCoordinates(b,i).nameReviews[0].reviewKey];
 for(const edit of [v=>v.items[0].googleName='另一名稱',v=>v.items[0].address='另一地址',v=>v.items[0].checkedAt='2026-11-14T00:00:00Z']){const changed=structuredClone(i);edit(changed);assert.equal(planNearbyCoordinates(b,changed,keys).changes.length,0);}
 const noAddress=structuredClone(i);noAddress.items[0].address='';assert.equal(planNearbyCoordinates(b,noAddress,keys).nameReviews.length,0);
 for(const delta of [{csvIdentityPending:true},{address:'不同既有地址'},{mapUrl:fullURL.replace('!3d25','!3d26')}]){const changed=structuredClone(b);Object.assign(changed.ops[0].data,delta);assert.equal(planNearbyCoordinates(changed,i,keys).changes.length,0);}
 const duplicate=structuredClone(b);duplicate.ops.push(revision('store','other',b.ops[0].data,[],'qa'));assert.equal(planNearbyCoordinates(duplicate,i,keys).changes.length,0);
 const missingName=structuredClone(i);missingName.items[0].sourceNames=[];assert.throws(()=>planNearbyCoordinates(b,missingName,keys));
});
