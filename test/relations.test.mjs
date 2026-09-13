import test from 'node:test';
import assert from 'node:assert/strict';
import { TOPIC_RULES, termFound, evidenceKind, sourceTags } from '../public/relations.js';
import { prepareCSV, planCSV, buildCSVImport } from '../public/csv.js';
import { newMeta, derive, seal, unseal, emptyBundle, project } from '../public/core.js';
import { rekeyInitial, installInitialCustomer } from '../scripts/initial-customer.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('Google Chinese notes are preferred to comments; multiline source and header-only record preserved',async()=>{
  const raw='標題,留言,筆記,網址,標籤\n,,,,🟡 CME\n測試地點,,"第一行\n第二行",https://www.google.com/maps/place/test/data=!1splace-one,🟡 CME\n';
  const file=await prepareCSV('input.csv',new TextEncoder().encode(raw));
  assert.equal(file.mapping.note,2);
  const base=emptyBundle(newMeta().vaultId), plan=await planCSV([file],base), result=buildCSVImport(plan,base,'test');
  assert.deepEqual([result.summary.stores,result.summary.notes,result.summary.skipped],[1,1,1]);
  const records=project(result.bundle), note=records.find(r=>r.type==='visit'), store=records.find(r=>r.type==='store');
  assert.equal(note.text,'第一行\n第二行');assert.equal(note.date,'');assert.deepEqual(sourceTags(store),['🟡 CME']);
  assert.equal(Buffer.from(result.bundle.blobs[file.blob],'base64').toString('utf8'),raw);
});
test('relationship matching preserves negative, mixed, question and name-comparison evidence',()=>{
  const rule=TOPIC_RULES.find(r=>r.key==='ortho');
  assert.equal(evidenceKind('沒有角膜塑型片的小朋友',rule).kind,'negative');
  assert.equal(evidenceKind('這裡有角膜塑型客群\n角膜塑型片他說沒遇到',rule).kind,'mixed');
  assert.equal(evidenceKind('角膜塑型片小朋友怎麼用？',rule).kind,'question');
  assert.equal(evidenceKind('戴塑形片的也有',rule).kind,'mention');
  assert.equal(evidenceKind('名字甲很像名字乙',{key:'person-mention',terms:['名字乙']}).label,'含外貌比喻，非人際關係證據');
  assert.equal(termFound('CHA CHA','HA'),false);assert.equal(termFound('HAUD','HA'),false);
  assert.equal(termFound('給 Sample 試用','sample'),true);assert.equal(termFound('SAMPLE123','Sample'),false);
});
test('initial customer package rekeys locally; delivery password cannot decrypt new vault',async()=>{
  const meta=newMeta(), bundle=emptyBundle(meta.vaultId), delivery='delivery-password-strong', own='personal-password-strong';
  const envelope=await seal(bundle,await derive(delivery,meta),meta);
  const rekeyed=await rekeyInitial(envelope,delivery,own);
  assert.notEqual(rekeyed.vaultId,meta.vaultId);assert.notEqual(rekeyed.salt,meta.salt);
  const result=await unseal(rekeyed,await derive(own,rekeyed));assert.deepEqual(result.ops,bundle.ops);assert.equal(result.vaultId,rekeyed.vaultId);
  await assert.rejects(unseal(rekeyed,await derive(delivery,rekeyed)));
  await assert.rejects(rekeyInitial(envelope,'wrong-delivery',own));
});
test('re-running setup never overwrites an existing customer snapshot',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'customer-setup-test-'));
  try{const content=JSON.stringify({version:8,envelope:{existing:true}});fs.writeFileSync(path.join(dir,'snapshot.json'),content);
    await installInitialCustomer('/no-package-needed',dir,()=>assert.fail('must not write'));
    assert.equal(fs.readFileSync(path.join(dir,'snapshot.json'),'utf8'),content);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
