import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyBundle,revision,project,planCoordinates,applyCoordinates,validateCoordinateReview,coordinateFeature,newMeta,derive,seal,unseal,merge} from '../public/core.js';
const featureId='0x123:0x456';
const url=(lat=25)=>`https://www.google.com/maps/place/fictional/data=!1s${featureId}!3d${lat}!4d121`;
const input=()=>({format:'pharmacy-coordinate-review-1',items:[{featureId,resolvedUrl:url(),latitude:25,longitude:121,googleName:'虛構測試店',address:'人工地址',sourceNames:['虛構測試店'],checkedAt:'2026-09-25T00:00:00Z'}]});
const data=()=>({name:'虛構測試店',district:'',city:'',channel:'',attr:'',contact:'人工窗口',address:'人工地址',mapUrl:`https://www.google.com/maps/data=!1s${featureId}`});
const bundle=()=>({...emptyBundle('test'),ops:[revision('store','s',data(),[],'test')]});
test('preview is read only; apply retains all manual fields and history; reimport is idempotent',()=>{
 const b=bundle(),before=JSON.stringify(b),p=planCoordinates(b,input());assert.equal(p.changes.length,1);assert.equal(JSON.stringify(b),before);
 const n=applyCoordinates(b,input(),p,'phone');assert.equal(JSON.stringify(b),before);assert.equal(n.ops.length,2);assert.deepEqual(n.ops[0],b.ops[0]);assert.deepEqual(n.ops[1].data,{...data(),mapUrl:url()});assert.equal(planCoordinates(n,input()).changes.length,0);
});
test('invalid or mismatched evidence and duplicate entries reject entire file',()=>{
 for(const edit of [i=>i.items[0].latitude=26,i=>i.items[0].resolvedUrl='https://evil.example/maps/'+featureId,i=>i.items[0].featureId='0x12:0x34',i=>i.items.push(i.items[0]),i=>i.items[0].sourceNames=null]){const i=input();edit(i);assert.throws(()=>validateCoordinateReview(i));}
 assert.equal(coordinateFeature('https://www.google.com.evil.example/maps/'+featureId),'');
});
test('changed names, pending identity, ambiguous branches and conflicting coordinates never auto-apply',()=>{
 for(const changes of [{name:'另一分店'},{csvIdentityPending:true},{mapUrl:url(26)},{mapUrl:'https://maps.app.goo.gl/fictional'}]){const b=bundle();Object.assign(b.ops[0].data,changes);assert.equal(planCoordinates(b,input()).changes.length,0);}
 const b=bundle();b.ops.push(revision('store','s',data(),[],'other'));assert.equal(planCoordinates(b,input()).changes.length,0);
 const duplicate=bundle();duplicate.ops.push(revision('store','s2',data(),[],'other'));assert.equal(planCoordinates(duplicate,input()).changes.length,0);
 const i=input();i.items[0].sourceNames=['舊名稱'];assert.equal(planCoordinates(bundle(),i).changes.length,0);
});
test('stale preview or changed package blocks whole transaction',()=>{
 const b=bundle(),p=planCoordinates(b,input());b.ops.push(revision('store','s',{...data(),contact:'新人工窗口'},[b.ops[0].id],'other'));assert.throws(()=>applyCoordinates(b,input(),p,'phone'));
 const original=bundle(),preview=planCoordinates(original,input()),i=input();i.items[0].checkedAt='2026-09-24T00:00:00Z';assert.throws(()=>applyCoordinates(original,i,preview,'phone'));
});
test('encrypted backup round trip and concurrent sync preserve both branches',async()=>{
 const b=bundle(),p=planCoordinates(b,input()),updated=applyCoordinates(b,input(),p,'phone');
 const other=structuredClone(b);other.ops.push(revision('store','s',{...data(),contact:'另一裝置人工文字'},[b.ops[0].id],'mac'));
 const combined=merge(updated,other);assert.equal(project(combined)[0].conflict,true);assert.equal(combined.ops.length,3);
 const meta=newMeta(),key=await derive('synthetic-test-only',meta);assert.deepEqual(await unseal(await seal(combined,key,meta),key),combined);
});

test('raw CSV and source snapshot survive coordinate update byte-for-byte',()=>{
 const b=bundle(),blob='a'.repeat(64);b.blobs[blob]='dGVzdA==';
 b.ops.push(revision('source','source',{file:'synthetic.csv',list:'測試',blob,batch:'batch',rows:1,headers:['網址'],encoding:'utf-8',delimiter:', '},[],'test'));
 const source={file:'synthetic.csv',fingerprint:blob,batch:'batch',list:'測試',at:'2026-09-25',blob,sourceSnapshot:'source',line:1,headers:['網址'],cells:[data().mapUrl]};
 b.ops[0].data.csvSources=[source];b.ops[0].data.mapUrl='';
 const next=applyCoordinates(b,input(),planCoordinates(b,input()),'phone');
 assert.deepEqual(next.blobs,b.blobs);assert.deepEqual(next.ops[1],b.ops[1]);assert.deepEqual(next.ops.at(-1).data.csvSources,[source]);
 assert.equal(planCoordinates(next,input()).changes.length,0);
});

test('UI preview/cancel do not persist; failed commit preserves payload and allows retry',async()=>{
 const {default:fs}=await import('node:fs'),{default:vm}=await import('node:vm');
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{open:false,showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
 const payload={bundle:bundle(),device:'test',draft:{text:'keep'}};let writes=0;
 const c=vm.createContext({$,payload,key:{},coordinatePreview:null,versionReview:null,resolutionPreview:null,editorContext:null,csvImport:{hasPending:()=>false},pendingLock:false,document:{hidden:false},planCoordinates,applyCoordinates,esc:String,dateText:String,render:()=>{},toast:()=>{},persist:async()=>{writes++;throw Error('disk failure');}});
 vm.runInContext(app.slice(app.indexOf('async function previewCoordinateFile('),app.indexOf('function visitStoreSearchText(')),c);
 const file={size:100,text:async()=>JSON.stringify(input())};await c.previewCoordinateFile(file);assert.equal(writes,0);assert.ok($('review-body').innerHTML.includes('原：'));assert.ok($('review-body').innerHTML.includes('新：'));
 const before=JSON.stringify(payload);await assert.rejects(c.commitCoordinates(),/disk failure/);assert.equal(JSON.stringify(payload),before);assert.equal($('review').open,true);
 $('review').close();await assert.rejects(c.commitCoordinates(),/預覽已失效/);assert.equal(writes,1);
 await c.previewCoordinateFile(file);c.pendingLock=true;await assert.rejects(c.commitCoordinates(),/預覽已失效/);assert.equal(writes,1);
 c.pendingLock=false;c.persist=async next=>{writes++;c.payload=next;};await c.commitCoordinates();assert.equal(writes,2);assert.equal(c.payload.bundle.ops.length,2);assert.deepEqual(c.payload.draft,payload.draft);assert.equal(c.coordinatePreview,null);
});
