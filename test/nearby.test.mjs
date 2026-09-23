import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mobileLocationDevice, validCoordinates, mapCoordinates, storeCoordinates, distanceMeters, nearestStores } from '../public/core.js';
const pin = (lat,lon) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
const store = (id,lat,lon) => ({id,name:'虛構門市 '+id,mapUrl:pin(lat,lon)});
test('phone detection never enables GPS for desktop Mac, Windows or narrow desktop windows',()=>{
 for(const userAgent of ['iPhone','iPad','Android'])assert.equal(mobileLocationDevice({userAgent}),true);
 assert.equal(mobileLocationDevice({userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5}),true);
 for(const userAgent of ['Macintosh','Windows NT','Linux x86_64'])assert.equal(mobileLocationDevice({userAgent,platform:'MacIntel',maxTouchPoints:0}),false);
});
test('only explicit Google map pins are coordinates; IDs, viewports, short URLs and ambiguous points are not',()=>{
 assert.deepEqual(mapCoordinates(pin(25,121)),{latitude:25,longitude:121});
 assert.deepEqual(mapCoordinates('https://www.google.com/maps/place/test/data=!3d25.1!4d121.2!16sabc'),{latitude:25.1,longitude:121.2});
 for(const u of ['https://www.google.com/maps/@25,121,15z','https://maps.google.com/?ll=25,121','https://maps.google.com/?cid=123456','https://maps.app.goo.gl/fictional',pin(91,121),pin(25,181),'https://www.google.com/search?q=25,121','https://evil.example/?q=25,121','https://www.google.com.evil.example/?q=25,121','https://www.google.com/maps/data=!3d25!4d121!3d26!4d122'])assert.equal(mapCoordinates(u),null,u);
});
test('source coordinate disagreement is not silently assigned to the store',()=>{
 const s={csvSources:[{headers:['網址'],cells:[pin(25,121)]},{headers:['網址'],cells:[pin(26,122)]}]};
 assert.equal(storeCoordinates(s),null);
 s.csvSources.pop();assert.deepEqual(storeCoordinates(s),{latitude:25,longitude:121});
});
test('nearest three use straight-line distance, exclude deleted/conflicted stores, retain IDs and never mutate source',()=>{
 const stores=[store('far',26,121),store('near',25.001,121),store('middle',25.002,121),store('same',25.001,121),{...store('deleted',25,121),deleted:true},{...store('conflict',25,121),conflict:true},{id:'unknown',name:'未知座標',mapUrl:'https://maps.google.com/?cid=123'}];
 const saved=JSON.stringify(stores);const ranked=nearestStores(stores,{latitude:25,longitude:121});
 assert.deepEqual(ranked.map(x=>x.store.id),['near','same','middle']);assert.ok(ranked[0].distance>110&&ranked[0].distance<112);
 assert.equal(JSON.stringify(stores),saved);assert.equal(nearestStores(stores,{latitude:NaN,longitude:121}).length,0);
 assert.ok(distanceMeters({latitude:0,longitude:179.9},{latitude:0,longitude:-179.9})<23000);
});
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function harness(mobile=true){
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',hidden:false,disabled:false});return nodes.get(id);};
 let calls=0,success,failure,options;
 const c=vm.createContext({$,mobileLocationDevice,validCoordinates,nearestStores,storeCoordinates,Date,isSecureContext:true,
  navigator:{userAgent:mobile?'iPhone':'Macintosh',geolocation:{getCurrentPosition(s,f,o){calls++;success=s;failure=f;options=o;}}},
  document:{hidden:false},payload:{bundle:{ops:[],blobs:{}}},key:{},nearbyRequest:0,nearbyDenied:false,nearbyState:{status:'idle',position:null,message:''},
  all:()=>[store('a',25,121),store('b',25.001,121),store('c',25.002,121),store('d',25.003,121)],
  recentStores:()=>[store('recent',26,121)],storeIdentityPending:()=>false,esc:x=>String(x)
 });
 vm.runInContext(app.slice(app.indexOf('function clearNearbyPosition('),app.indexOf('function visitStoreSearchText(')),c);
 return {c,$,calls:()=>calls,success:()=>success,failure:()=>failure,options:()=>options};
}
test('mobile auto location requests once, uses bounded fresh fixes, and only renders the nearest three',()=>{
 const h=harness();const before=JSON.stringify(h.c.payload);h.c.requestNearbyPosition();h.c.requestNearbyPosition();assert.equal(h.calls(),1);
 assert.deepEqual({...h.options()},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
 h.success()({coords:{latitude:25,longitude:121,accuracy:20},timestamp:Date.now()});
 assert.equal((h.$('recent-store-list').innerHTML.match(/data-quick-visit/g)||[]).length,3);
 assert.match(h.$('nearby-status').textContent,/直線距離/);assert.equal(JSON.stringify(h.c.payload),before);
});
test('desktop never requests geolocation, including retry, and renders recent-store cards',()=>{
 const h=harness(false);h.c.requestNearbyPosition();h.c.requestNearbyPosition(true);h.c.renderQuickVisit();
 assert.equal(h.calls(),0);assert.equal(h.$('nearby-retry').hidden,true);assert.match(h.$('quick-visit-title').textContent,/最近使用/);
});
test('denial does not repeatedly prompt; retry is explicit; timeout has a labelled non-distance fallback',()=>{
 const h=harness();h.c.requestNearbyPosition();h.failure()({code:1});h.c.requestNearbyPosition();assert.equal(h.calls(),1);
 assert.match(h.$('recent-store-list').innerHTML,/不是距離排序/);h.c.requestNearbyPosition(true);assert.equal(h.calls(),2);
 h.failure()({code:3});assert.match(h.$('nearby-status').textContent,/逾時/);assert.equal(h.c.nearbyState.position,null);
});
test('background, lock and database switches invalidate outstanding callbacks and discard positions',()=>{
 const h=harness();h.c.requestNearbyPosition();const old=h.success();h.c.document.hidden=true;h.c.clearNearbyPosition();
 old({coords:{latitude:25,longitude:121,accuracy:20},timestamp:Date.now()});assert.equal(h.c.nearbyState.position,null);
 h.c.document.hidden=false;h.c.requestNearbyPosition();h.c.key={};h.success()({coords:{latitude:25,longitude:121,accuracy:20},timestamp:Date.now()});assert.equal(h.c.nearbyState.position,null);
});
test('missing store coordinates and stale GPS never claim to show nearest stores',()=>{
 const h=harness();h.c.all=()=>[{id:'no',name:'無座標',mapUrl:'https://maps.google.com/?cid=1'}];h.c.requestNearbyPosition();
 h.success()({coords:{latitude:25,longitude:121,accuracy:20},timestamp:Date.now()});assert.match(h.$('nearby-status').textContent,/缺少可靠座標/);
 h.c.requestNearbyPosition(true);h.success()({coords:{latitude:25,longitude:121,accuracy:20},timestamp:Date.now()-120000});assert.equal(h.c.nearbyState.position,null);
});
