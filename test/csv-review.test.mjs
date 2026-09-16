import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBundle, project, revision, b64, newMeta, derive, seal, unseal, merge, validateBundle } from '../public/core.js';
import { prepareCSV, planCSV, prepareReviewedCSV, planReviewedCSV, setReviewedGroupChoice, buildCSVImport, sop1Report, exportCSVPreview } from '../public/csv.js';
import { relationVisitAllowed, storeIdentityPending } from '../public/relations.js';

const enc = new TextEncoder(), url = 'https://maps.google.com/?cid=99887766';
async function packet(texts, partition) {
  const files = await Promise.all(texts.map((text,i) => prepareCSV(`虛構${i}.csv`, enc.encode(text))));
  const plan = await planCSV(files, emptyBundle('fixture'));
  const ref = key => { const r=plan.rows.find(r=>r.key===key);return {sha256:files[r.fileIndex].blob,line:r.line,fingerprint:r.fingerprint}; };
  const included = new Set(partition.flatMap(g=>g.rows));
  return {format:'pharmacy-csv-review-1',files:files.map(f=>({file:f.file,list:f.list,sha256:f.blob,content:b64(f.bytes)})),groups:partition.map((g,i)=>({id:'g'+i,...g,rows:g.rows.map(ref)})),excluded:plan.rows.filter(r=>!included.has(r.key)).map(r=>ref(r.key))};
}
const read = p => prepareReviewedCSV(JSON.stringify(p));
const split = () => packet([`Title,Note,URL\n虛構甲藥局,甲原文,${url}\n虛構乙藥局,乙原文,${url}`],[{label:'虛構甲藥局',pending:true,rows:['0:0']},{label:'虛構乙藥局',pending:true,rows:['0:1']}]);

test('review partition retains same-ID stores separately, preserves raw text and repeat is a no-op',async()=>{
  const input=await split(), review=await read(input), b=emptyBundle('r');
  const p=await planReviewedCSV(review,b), result=buildCSVImport(p,b,'mac');
  assert.equal(result.summary.stores,2);
  const stores=project(result.bundle).filter(r=>r.type==='store');
  assert.equal(stores.filter(storeIdentityPending).length,2);
  assert.deepEqual(stores.map(s=>s.csvSources[0].cells[1]),['甲原文','乙原文']);
  const again=buildCSVImport(await planReviewedCSV(await read(input),result.bundle),result.bundle,'phone');
  assert.deepEqual(again.bundle,result.bundle); assert.equal(again.summary.rows,0);
  const note=project(result.bundle).find(r=>r.type==='visit');
  assert.equal(relationVisitAllowed(note,stores),false);
});
test('review package rejects missing, reused, foreign or changed source references before any write',async()=>{
  const input=await split();
  for(const mutate of [
    p=>p.files[0].content=b64(enc.encode('other')),
    p=>p.groups.pop(),
    p=>p.groups[1].rows=[p.groups[0].rows[0]],
    p=>p.groups[0].rows[0].fingerprint='0'.repeat(64),
    p=>p.groups[0].rows[0].line=999,
    p=>p.groups[0].pending='yes',
    p=>p.groups[0].label=' ',
  ]) {const p=structuredClone(input);mutate(p);await assert.rejects(read(p),/不完整|不一致/);}
});
test('temporary display name does not rewrite the source name and aliases retain both originals',async()=>{
  const input=await packet(['Title,Note,URL\n地圖圖釘,"原文\n  完整空白","https://www.google.com/maps/search/0,0"'],[{label:'虛構總倉（待確認）',pending:true,rows:['0:0']}]);
  const b=emptyBundle('r'), p=await planReviewedCSV(await read(input),b), {bundle}=buildCSVImport(p,b,'mac');
  const store=project(bundle).find(r=>r.type==='store');
  assert.equal(store.name,'虛構總倉（待確認）'); assert.equal(store.csvSources[0].cells[0],'地圖圖釘');
  assert.equal(project(bundle).find(r=>r.type==='visit').text,'原文\n  完整空白');
});
test('source-based match preserves App name and blocks two separate groups targeting one existing store',async()=>{
  const input=await split(), files=await Promise.all(input.files.map(f=>prepareCSV(f.file,Uint8Array.from(atob(f.content),c=>c.charCodeAt(0)))));
  const b=emptyBundle('r'), oldPlan=await planCSV(files,b);oldPlan.rows[1].choice='row:0:0';
  // Separate source lists permit a historical shared store without inventing a same-list resolution.
  oldPlan.rows[1].choice='skip';const old=buildCSVImport(oldPlan,b,'old').bundle;
  const originalStore=project(old).find(r=>r.type==='store');old.ops.push(revision('store',originalStore.id,{...originalStore.heads[0].data,name:'App手動店名'},[originalStore.heads[0].id],'mac'));
  const p=await planReviewedCSV(await read(input),old);
  assert.equal(p.reviewGroups[0].choice.startsWith('store:'),true);assert.equal(p.reviewGroups[1].choice,'review');
  const exported=exportCSVPreview(p,old);
  assert.equal(exported.existingStores[0].name,'App手動店名');
  assert.equal(exported.existingStores[0].notes[0].text,'甲原文');
  assert.ok(exported.groups[1].candidates.includes(originalStore.id));
  setReviewedGroupChoice(p,'g1',p.reviewGroups[0].choice);
  assert.equal(sop1Report(p,old).blockers.some(b=>b.message.includes('裁定分開')),true);assert.throws(()=>buildCSVImport(p,old,'mac'),/SOP1/);
  setReviewedGroupChoice(p,'g1','new');const result=buildCSVImport(p,old,'mac');assert.equal(result.summary.stores,1);assert.equal(project(result.bundle).find(r=>r.id===originalStore.id).name,'App手動店名');
});
test('combined aliases are one candidate, but existing conflicting store heads block import',async()=>{
  const input=await packet([`Title,Note,URL\n虛構藥局,A,${url}`,`Title,Note,URL\n虛構大藥局,B,${url}`],[{label:'虛構藥局／虛構大藥局',pending:false,rows:['0:0','1:0']}]);
  const b=emptyBundle('r'), review=await read(input), first=buildCSVImport(await planReviewedCSV(review,b),b,'mac').bundle;
  const store=project(first).find(r=>r.type==='store');assert.deepEqual(store.csvAliases,['虛構藥局','虛構大藥局']);
  assert.equal(project(first).filter(r=>r.type==='visit').length,2);
  const remote=structuredClone(first);remote.ops.push(revision('store',store.id,{...store.heads[0].data,contact:'乙'},[store.heads[0].id],'phone'));
  first.ops.push(revision('store',store.id,{...store.heads[0].data,contact:'甲'},[store.heads[0].id],'mac'));
  const merged=merge(first,remote), plan=await planReviewedCSV(review,merged);
  assert.equal(plan.reviewGroups[0].choice,'review');assert.throws(()=>buildCSVImport(plan,merged,'mac'),/SOP1/);
});
test('manual and legacy App text require acknowledgement and are retained in the new version',async()=>{
  const raw=note=>`Title,Note,URL\n虛構藥局,${note},${url}`;
  for(const legacy of [false,true]) {
    const b=emptyBundle('r'), f=await prepareCSV('虛構0.csv',enc.encode(raw('原版')));
    const first=buildCSVImport(await planCSV([f],b),b,'mac').bundle;
    const visit=project(first).find(r=>r.type==='visit'), data={...visit.heads[0].data,text:'App手動文字'};
    if(legacy) delete data.googleText;
    first.ops.push(revision('visit',visit.id,data,[visit.heads[0].id],'mac'));
    const input=await packet([raw('新版')],[{label:'虛構藥局',pending:false,rows:['0:0']}]);
    const plan=await planReviewedCSV(await read(input),first);
    assert.throws(()=>buildCSVImport(plan,first,'mac'),/手動修改/);
    plan.rows[0].sop1.manualAccepted=true;
    const second=buildCSVImport(plan,first,'mac').bundle,current=project(second).find(r=>r.type==='visit');
    assert.equal(current.text,'App手動文字');assert.equal(current.googleText,'新版');assert.equal(current.googleUpdatePending,true);
  }
});
test('review decisions survive encrypted merge and a later identity confirmation is not reset by repeat',async()=>{
  const b=emptyBundle('r'), review=await read(await split()), first=buildCSVImport(await planReviewedCSV(review,b),b,'mac').bundle;
  const meta={...newMeta(),vaultId:'r'},key=await derive('test-only',meta), transported=await unseal(await seal(first,key,meta),key);
  const merged=merge(b,transported);assert.equal(project(merged).filter(storeIdentityPending).length,2);
  const s=project(merged).find(r=>r.type==='store');merged.ops.push(revision('store',s.id,{...s.heads[0].data,csvIdentityPending:false},[s.heads[0].id],'phone'));
  const result=buildCSVImport(await planReviewedCSV(review,merged),merged,'mac').bundle;
  assert.deepEqual(result,merged);assert.equal(storeIdentityPending(project(result).find(r=>r.id===s.id)),false);
  assert.throws(()=>validateBundle({...merged,ops:[{...merged.ops[0],data:{...merged.ops[0].data,csvIdentityPending:'false'}}]}),/不完整/);
});
test('local preview is read-only, exports current conflicts, and stale preview cannot commit',async()=>{
  const review=await read(await split()), b=emptyBundle('r'), before=JSON.stringify(b), p=await planReviewedCSV(review,b);
  const out=exportCSVPreview(p,b);assert.equal(out.imported,false);assert.equal(out.rows.length,2);assert.equal(out.rows[0].incomingText,'甲原文');assert.equal(JSON.stringify(b),before);
  const result=buildCSVImport(p,b,'mac').bundle;assert.throws(()=>buildCSVImport(p,result,'mac'),/預覽後變更/);
});
test('same-list conflicting notes cannot be hidden by an approved combined group',async()=>{
  const input=await packet([`Title,Note,URL\n虛構藥局,A,${url}\n虛構藥局,B,${url}`],[{label:'虛構藥局',pending:false,rows:['0:0','0:1']}]);
  const b=emptyBundle('r'), plan=await planReviewedCSV(await read(input),b);
  assert.equal(sop1Report(plan,b).ready,false);assert.throws(()=>buildCSVImport(plan,b,'mac'),/不同備註/);
});
test('adjudicated exclusions cannot be reactivated and group followers can fill only confirmed blank fields',async()=>{
  const input=await packet([`Title,Note,URL,Address\n虛構藥局,A,${url},\n已排除,E,https://maps.google.com/?cid=11111,`, `Title,Note,URL,Address\n虛構藥局,B,${url},虛構路99號`],[{label:'虛構藥局',pending:false,rows:['0:0','1:0']}]);
  const b=emptyBundle('r');b.ops.push(revision('store','store1',{name:'虛構藥局',mapUrl:url,address:'',city:'',district:'',channel:'',contact:'',attr:''},[],'mac'));
  const p=await planReviewedCSV(await read(input),b);
  p.rows.find(r=>r.key==='0:1').choice='new';assert.throws(()=>buildCSVImport(p,b,'mac'),/已裁定排除/);
  p.rows.find(r=>r.key==='0:1').choice='skip';p.rows.find(r=>r.key==='1:0').fillFields=['address'];
  const result=buildCSVImport(p,b,'mac');assert.equal(result.summary.filledFields,1);
  assert.equal(project(result.bundle).find(r=>r.id==='store1').address,'虛構路99號');
});
