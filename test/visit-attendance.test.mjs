import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  attendanceTaipeiDate, makeVisitAttendance, visitAttendanceForStore,
  revision, emptyBundle, validateBundle, project, merge, newMeta, derive, seal, unseal,
  planBackupImport, hashBytes, b64
} from '../public/core.js';

// Synthetic evidence only. Never read production stores, notes or backups.
const storeData={name:'Synthetic attendance store',city:'',district:'',channel:'',attr:'',contact:''};
const visitData={store:'s',date:'2025-04-03',text:'Synthetic exact note\r\n preserve spaces  ',next:'',source:'synthetic',topics:[],people:[],attachments:[]};
const firstAt='2026-10-01T01:00:00.000Z',secondAt='2026-10-01T10:00:00.000Z',nextAt='2026-10-01T16:00:00.000Z';
const now=Date.parse('2026-10-03T02:00:00.000Z');
function fixture(vaultId='synthetic-attendance') {
  const bundle=emptyBundle(vaultId);bundle.ops.push(revision('store','s',storeData,[],'synthetic'));return bundle;
}
function confirmedVisit(id='v',at=firstAt,data=visitData,parents=[]) {
  return revision('visit',id,data,parents,'synthetic',false,makeVisitAttendance(data.store,at));
}

test('Taipei calendar date crosses UTC 16:00 and respects month, leap-day and year boundaries',()=>{
  const cases=[['2026-10-01T15:59:59.999Z','2026-10-01'],['2026-10-01T16:00:00.000Z','2026-10-02'],['2026-10-31T16:00:00.000Z','2026-11-01'],['2024-02-28T16:00:00.000Z','2024-02-29'],['2024-02-29T16:00:00.000Z','2024-03-01'],['2026-12-31T16:00:00.000Z','2027-01-01']];
  for(const [at,date] of cases) {
    assert.equal(attendanceTaipeiDate(at),date);assert.equal(attendanceTaipeiDate(Date.parse(at)),date);assert.equal(attendanceTaipeiDate(new Date(at)),date);
    assert.deepEqual(makeVisitAttendance('s',at),{store:'s',date,at});
  }
});

test('attendance dates and calendar-day differences are independent of the host timezone and DST',()=>{
  const core=new URL('../public/core.js',import.meta.url).href;
  const script=`import {attendanceTaipeiDate,makeVisitAttendance,visitAttendanceForStore,revision} from ${JSON.stringify(core)};
    const at='2026-03-08T15:59:59.999Z',data=${JSON.stringify(storeData)},op=revision('store','s',data,[],'synthetic',false,makeVisitAttendance('s',at));
    console.log(JSON.stringify([attendanceTaipeiDate('2026-03-08T16:00:00.000Z'),visitAttendanceForStore({ops:[op]},'s',Date.parse('2026-03-08T16:00:00.000Z')).daysSince]));`;
  for(const TZ of ['UTC','America/Los_Angeles','Asia/Tokyo']) {
    const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ},encoding:'utf8'}));
    assert.deepEqual(result,['2026-03-09',1]);
  }
});

test('helper rejects malformed times and identifiers without normalizing invalid timestamps',()=>{
  for(const at of ['2026-02-30T01:00:00.000Z','2026-10-01T01:00:00Z','2026-10-01T09:00:00.000+08:00','2026-10-01','tomorrow','0000-01-01T00:00:00.000Z',null,42])assert.throws(()=>makeVisitAttendance('s',at));
  for(const store of ['', '   ',null,42,'s'.repeat(101)])assert.throws(()=>makeVisitAttendance(store,firstAt));
  for(const bad of [undefined,null,false,NaN,Infinity,new Date(NaN),'2026-02-30T01:00:00.000Z'])assert.throws(()=>attendanceTaipeiDate(bad));
  assert.throws(()=>visitAttendanceForStore({ops:[]},'s',NaN));
  const generated=makeVisitAttendance('s');assert.equal(generated.date,attendanceTaipeiDate(generated.at));
});

test('one visit revision holds changed content and explicit attendance while the original note date remains untouched',()=>{
  const bundle=fixture(),before=JSON.stringify(visitData),attendance=makeVisitAttendance('s',firstAt),parents=[];
  const op=revision('visit','v',visitData,parents,'synthetic',false,attendance);bundle.ops.push(op);
  assert.equal(bundle.ops.length,2);assert.equal(op.at,firstAt);assert.deepEqual(op.visitAttendance,attendance);assert.notEqual(op.visitAttendance,attendance);
  assert.equal(op.data.date,'2025-04-03');assert.equal(JSON.stringify(visitData),before);assert.equal(op.data.text,visitData.text);assert.deepEqual(parents,[]);
  attendance.date='mutated';assert.equal(op.visitAttendance.date,'2026-10-01');assert.doesNotThrow(()=>validateBundle(bundle));
  assert.equal(project(bundle).find(r=>r.id==='v').date,'2025-04-03');
});

test('store revisions may carry the same optional evidence without manufacturing a visit or changing store fields',()=>{
  const bundle=fixture(),base=bundle.ops[0],op=revision('store','s',base.data,[base.id],'synthetic',false,makeVisitAttendance('s',firstAt));bundle.ops.push(op);
  assert.equal(op.at,firstAt);assert.deepEqual(op.data,base.data);assert.equal(bundle.ops.filter(item=>item.type==='visit').length,0);assert.doesNotThrow(()=>validateBundle(bundle));
  assert.deepEqual(visitAttendanceForStore(bundle,'s',now).history[0].occurrences,[{entityId:'s',type:'store',revisionId:op.id,at:firstAt}]);
});

test('metadata-free legacy schema 1 and 2 bundles remain valid and original dates never imply attendance',()=>{
  for(const schema of [1,2]) {
    const bundle=emptyBundle('synthetic-legacy');bundle.schema=schema;
    bundle.ops.push(revision('visit','legacy',{...visitData,store:'legacy-missing-store'},[],'synthetic'));
    assert.doesNotThrow(()=>validateBundle(bundle));assert.equal(Object.hasOwn(bundle.ops[0],'visitAttendance'),false);
    assert.deepEqual(visitAttendanceForStore(bundle,'legacy-missing-store',now),{today:'2026-10-03',latestDate:'',daysSince:null,hasFutureDates:false,history:[]});
  }
});

test('invalid metadata shapes, fields, dates, timestamps and store associations are rejected',()=>{
  const valid=confirmedVisit();
  const mutations=[
    o=>o.visitAttendance=null,o=>o.visitAttendance=undefined,o=>o.visitAttendance=[],o=>o.visitAttendance=false,
    o=>delete o.visitAttendance.store,o=>delete o.visitAttendance.date,o=>delete o.visitAttendance.at,
    o=>o.visitAttendance.extra=true,o=>o.visitAttendance.store='',o=>o.visitAttendance.store='other',
    o=>o.visitAttendance.date='2026-02-30',o=>o.visitAttendance.date='2026-10-02',o=>o.visitAttendance.date=20261001,
    o=>o.visitAttendance.at='2026-10-01T01:00:00Z',o=>o.visitAttendance.at='2026-02-30T01:00:00.000Z',
    o=>o.at=secondAt,o=>o.deleted=true,o=>o.data.store='other'
  ];
  for(const mutate of mutations) {
    const op=structuredClone(valid);mutate(op);const bundle=fixture();bundle.ops.push(op);
    assert.throws(()=>validateBundle(bundle),/拜訪確認/);
  }
  for(const attendance of [null,false,{},[],{...makeVisitAttendance('s',firstAt),extra:true}])assert.throws(()=>revision('visit','v',visitData,[],'synthetic',false,attendance),/拜訪確認/);
});

test('non-visit/store and deleted revisions cannot carry attendance; store identity must match the entity',()=>{
  const attendance=makeVisitAttendance('s',firstAt);
  for(const [type,data] of [['topic',{name:'Synthetic',desc:''}],['person',{name:'Synthetic',role:'',desc:'',confirmed:false}],['source',{file:'synthetic.csv',list:'Synthetic',blob:'a'.repeat(64),batch:'synthetic',rows:0,headers:[],encoding:'utf-8',delimiter:','}]])assert.throws(()=>revision(type,'s',data,[],'synthetic',false,attendance),/拜訪確認/);
  assert.throws(()=>revision('store','other',storeData,[],'synthetic',false,attendance),/拜訪確認/);
  assert.throws(()=>revision('store','s',storeData,[],'synthetic',true,attendance),/拜訪確認/);
  assert.throws(()=>revision('visit','v',visitData,[],'synthetic',true,attendance),/拜訪確認/);
});

test('bundle validation requires a referenced store but summary accepts a prevalidated metadata-only subset',()=>{
  const op=confirmedVisit(),bundle=emptyBundle('missing-store');bundle.ops.push(op);
  assert.throws(()=>validateBundle(bundle),/所屬門市不存在/);
  const summary=visitAttendanceForStore({ops:[op]},'s',now);assert.equal(summary.history.length,1);assert.equal(summary.daysSince,2);
  bundle.ops.push(revision('store','s',storeData,[],'synthetic'));assert.doesNotThrow(()=>validateBundle(bundle));
});

test('display deduplicates dates across stores and visits only within the requested store while retaining every operation',()=>{
  const bundle=fixture(),a=confirmedVisit('a',firstAt),b=confirmedVisit('b',secondAt),c=confirmedVisit('c',nextAt);
  const storeOp=revision('store','s',storeData,[bundle.ops[0].id],'synthetic',false,makeVisitAttendance('s',secondAt));
  const otherStore=revision('store','other',storeData,[],'synthetic',false,makeVisitAttendance('other',nextAt));bundle.ops.push(a,b,c,storeOp,otherStore);
  const before=JSON.stringify(bundle),summary=visitAttendanceForStore(bundle,'s',now);
  assert.deepEqual(summary.history.map(item=>item.date),['2026-10-02','2026-10-01']);assert.deepEqual(summary.history.map(item=>item.occurrences.length),[1,3]);
  assert.equal(summary.latestDate,'2026-10-02');assert.equal(summary.daysSince,1);assert.equal(summary.hasFutureDates,false);
  assert.deepEqual(new Set(summary.history.flatMap(item=>item.occurrences.map(o=>o.revisionId))),new Set([a.id,b.id,c.id,storeOp.id]));
  assert.equal(summary.history[1].occurrences[0].at,secondAt);assert.equal(summary.history[1].occurrences.at(-1).at,firstAt);assert.equal(JSON.stringify(bundle),before);
});

test('historical attendance survives later edits, deletion and explicit restoration without being automatically copied',()=>{
  const bundle=fixture(),attended=confirmedVisit();bundle.ops.push(attended);
  const edit=revision('visit','v',{...attended.data,text:'Synthetic later correction'},[attended.id],'synthetic');
  const removed=revision('visit','v',edit.data,[edit.id],'synthetic',true);
  const restored=revision('visit','v',attended.data,[removed.id],'synthetic');bundle.ops.push(edit,removed,restored);
  for(const op of [edit,removed,restored])assert.equal(Object.hasOwn(op,'visitAttendance'),false);
  assert.equal(bundle.ops.length,5);assert.equal(visitAttendanceForStore(bundle,'s',now).history[0].occurrences.length,1);assert.equal(project(bundle).find(r=>r.id==='v').date,visitData.date);assert.doesNotThrow(()=>validateBundle(bundle));
});

test('future evidence remains valid and visible but never produces a negative elapsed-day count',()=>{
  const bundle=fixture();bundle.ops.push(confirmedVisit('past',firstAt),confirmedVisit('future','2026-10-05T01:00:00.000Z'));
  assert.doesNotThrow(()=>validateBundle(bundle));const result=visitAttendanceForStore(bundle,'s',now);
  assert.equal(result.latestDate,'2026-10-05');assert.equal(result.daysSince,null);assert.equal(result.hasFutureDates,true);assert.equal(result.history.length,2);
  assert.equal(visitAttendanceForStore(bundle,'s',Date.parse('2026-10-05T15:00:00.000Z')).daysSince,0);
  assert.equal(visitAttendanceForStore(bundle,'s',Date.parse('2026-10-05T16:00:00.000Z')).daysSince,1);
});

test('the read-only summary skips invalid evidence and neither mutates nor retains mutable references',()=>{
  const good=confirmedVisit(),bad=structuredClone(good);bad.id='invalid-evidence';bad.visitAttendance.date='incorrect';
  const bundle={ops:[null,{},good,bad]},before=JSON.stringify(bundle);
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};freeze(bundle);
  const result=visitAttendanceForStore(bundle,'s',now);assert.equal(result.history.length,1);assert.equal(result.history[0].occurrences.length,1);
  result.history[0].occurrences[0].at='changed output';result.history.push({date:'changed output',occurrences:[]});assert.equal(JSON.stringify(bundle),before);
});

test('offline confirmed revisions converge with both pieces of evidence and no automatic conflict resolution',()=>{
  const base=fixture(),initial=revision('visit','v',visitData,[],'synthetic');base.ops.push(initial);
  const phone=structuredClone(base),mac=structuredClone(base);
  phone.ops.push(confirmedVisit('v',firstAt,{...visitData,text:'Synthetic phone edit'},[initial.id]));
  mac.ops.push(confirmedVisit('v',nextAt,{...visitData,text:'Synthetic desktop edit'},[initial.id]));
  const joined=merge(phone,mac);assert.deepEqual(joined,merge(mac,phone));assert.deepEqual(merge(joined,phone),joined);
  assert.equal(project(joined).find(record=>record.id==='v').conflict,true);assert.equal(visitAttendanceForStore(joined,'s',now).history.length,2);
  const tampered=structuredClone(phone);tampered.ops.at(-1).visitAttendance.at=secondAt;tampered.ops.at(-1).visitAttendance.date=attendanceTaipeiDate(secondAt);tampered.ops.at(-1).at=secondAt;
  assert.throws(()=>merge(phone,tampered),/相同版本編號/);
});

test('encrypted backup import preserves attendance, original note dates, source snapshot and raw CSV bytes exactly',async()=>{
  const meta=newMeta(),key=await derive('synthetic-attendance-backup-password',meta),base=fixture(meta.vaultId);
  const bytes=new TextEncoder().encode('name,note\r\nSynthetic,"exact\r\noriginal"\r\n'),blob=await hashBytes(bytes);base.blobs[blob]=b64(bytes);
  const source=revision('source','source',{file:'synthetic.csv',list:'Synthetic',blob,batch:'synthetic',rows:1,headers:['name','note'],encoding:'utf-8',delimiter:','},[],'synthetic');
  const original=revision('visit','v',{...visitData,date:'',attachments:[{blob,name:'synthetic.csv',mime:'text/csv'}]},[],'synthetic');base.ops.push(source,original);
  const incoming=structuredClone(base),confirmed=confirmedVisit('v',firstAt,{...original.data,text:original.data.text+'\nSynthetic confirmed addition'},[original.id]);incoming.ops.push(confirmed);
  const before=JSON.stringify(incoming),backup={format:'pharmacy-backup-1',envelope:await seal(incoming,key,meta)};
  const decoded=validateBundle(await unseal(JSON.parse(JSON.stringify(backup)).envelope,key));
  const imported=await planBackupImport(base,decoded),restored=await planBackupImport(null,decoded);
  assert.equal(imported.summary.addedRevisions,1);assert.equal(imported.summary.mode,'merge');assert.equal(restored.summary.mode,'restore');assert.equal(imported.bundle.schema,2);
  for(const bundle of [decoded,imported.bundle,restored.bundle]) {
    assert.deepEqual(bundle.ops.find(op=>op.id===confirmed.id),confirmed);assert.deepEqual(bundle.ops.find(op=>op.id===original.id),original);assert.deepEqual(bundle.ops.find(op=>op.id===source.id),source);assert.equal(bundle.blobs[blob],b64(bytes));
    assert.equal(project(bundle).find(record=>record.id==='v').date,'');assert.equal(visitAttendanceForStore(bundle,'s',now).daysSince,2);
  }
  assert.equal(JSON.stringify(incoming),before);assert.equal((await planBackupImport(imported.bundle,decoded)).summary.hasChanges,false);
});

test('backup preview reports zero attendance for legacy data without inferring from original dates',async()=>{
  const legacy=fixture();legacy.schema=1;legacy.ops.push(revision('visit','v',visitData,[],'synthetic'));
  const zero={beforeMarks:0,afterMarks:0,addedMarks:0,beforeDays:0,afterDays:0,addedDays:0};
  for(const current of [null,legacy]) {
    const plan=await planBackupImport(current,legacy);
    assert.deepEqual(plan.summary.visitAttendance,zero);assert.ok(plan.changes.every(change=>change.addedVisitAttendance.length===0));
  }
});

test('backup attendance preview counts every mark but distinct store days, including same-day updates',async()=>{
  const base=fixture(),first=confirmedVisit();base.ops.push(first);
  const incoming=structuredClone(base),again=confirmedVisit('v',secondAt,visitData,[first.id]);incoming.ops.push(again);
  const sameDay=await planBackupImport(base,incoming);
  assert.deepEqual(sameDay.summary.visitAttendance,{beforeMarks:1,afterMarks:2,addedMarks:1,beforeDays:1,afterDays:1,addedDays:0});
  assert.deepEqual(sameDay.changes.find(change=>change.entity==='v').addedVisitAttendance,[again]);
  const later=confirmedVisit('v',nextAt,visitData,[again.id]),otherStore=revision('store','other',storeData,[],'synthetic',false,makeVisitAttendance('other',firstAt));incoming.ops.push(later,otherStore);
  const before=JSON.stringify({base,incoming}),plan=await planBackupImport(base,incoming);
  assert.deepEqual(plan.summary.visitAttendance,{beforeMarks:1,afterMarks:4,addedMarks:3,beforeDays:1,afterDays:3,addedDays:2});
  assert.equal(JSON.stringify({base,incoming}),before);assert.equal(plan.summary.addedRevisions,3);
  const repeat=await planBackupImport(plan.bundle,incoming);
  assert.deepEqual(repeat.summary.visitAttendance,{beforeMarks:4,afterMarks:4,addedMarks:0,beforeDays:3,afterDays:3,addedDays:0});assert.deepEqual(repeat.changes,[]);
});

test('backup preview exposes non-head attendance evidence for imports and restores and freezes original ops',async()=>{
  const base=fixture(),incoming=structuredClone(base),confirmed=confirmedVisit(),ordinary=revision('visit','v',{...visitData,text:'Synthetic later text'},[confirmed.id],'synthetic');incoming.ops.push(confirmed,ordinary);
  for(const current of [null,base]) {
    const plan=await planBackupImport(current,incoming),change=plan.changes.find(item=>item.entity==='v');
    assert.deepEqual(change.afterHeads,[ordinary]);assert.equal(Object.hasOwn(change.afterHeads[0],'visitAttendance'),false);
    assert.deepEqual(change.addedVisitAttendance,[confirmed]);assert.ok(Object.isFrozen(change.addedVisitAttendance));assert.ok(Object.isFrozen(change.addedVisitAttendance[0]));
    assert.deepEqual(plan.summary.visitAttendance,{beforeMarks:0,afterMarks:1,addedMarks:1,beforeDays:0,afterDays:1,addedDays:1});
    assert.equal(plan.summary.after.active.visit,1);assert.equal(plan.bundle.ops.find(op=>op.id===confirmed.id).data.date,visitData.date);
  }
  assert.equal(Object.isFrozen(confirmed),false);
});
