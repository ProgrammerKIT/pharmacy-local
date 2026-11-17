import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {prepareCSV} from '../public/csv.js';
import {emptyChatLedger,prepareChatBatch,decideChatBatch,chatApplicationChecklist,validateChatLedger,validateChatBatch} from '../scripts/csv-chat-review.mjs';
const file=(rows,name='虛構清單.csv')=>prepareCSV(name,new TextEncoder().encode('Title,Address,URL,Note\n'+rows));
const raw='虛構青禾藥局,虛構路1號,https://maps.google.com/?cid=1234567,不可成為正式拜訪原文';
const decision=(key,action,targetStoreId='')=>({key,action,targetStoreId});
test('unanswered rows stay pending, explicitly rejected identity alone is remembered',async()=>{
  const f=await file(raw+'\n虛構晴川藥局,虛構路2號,,未回答'),{batch}=await prepareChatBatch([f]);
  const ledger=await decideChatBatch(batch,emptyChatLedger(),[decision('0:0','reject')],'Kit：青禾不匯入；晴川尚未回答。');
  const again=await prepareChatBatch([f],ledger);assert.deepEqual(again.review.map(r=>r.status),['excluded','pending']);assert.equal(ledger.events.length,1);assert.equal(again.imported,false);assert.equal(again.appCompared,false);
});
test('approval creates no App data and requires fresh live App duplicate check',async()=>{
  const {batch}=await prepareChatBatch([await file(raw)]),ledger=await decideChatBatch(batch,emptyChatLedger(),[decision('0:0','approve-new')],'Kit：核准新增青禾。');
  const list=await chatApplicationChecklist(batch,ledger);assert.equal(list.imported,false);assert.equal(list.requiresLiveAppCheck,true);assert.equal(list.rows[0].action,'approve-new');assert.equal(list.rows[0].targetStoreId,'');assert.equal(ledger.events.length,1);assert.ok(!Object.hasOwn(ledger,'ops'));
});
test('changed address, name, place or newly missing address reopen review; filename and note do not',async()=>{
  const f=await file(raw),{batch}=await prepareChatBatch([f]),ledger=await decideChatBatch(batch,emptyChatLedger(),[decision('0:0','reject')],'Kit：拒絕青禾。');
  for(const changed of [raw.replace('路1號','路99號'),raw.replace('青禾','青河'),raw.replace('1234567','1234568'),raw.replace('虛構路1號','')])assert.equal((await prepareChatBatch([await file(changed)],ledger)).review[0].status,'pending');
  assert.equal((await prepareChatBatch([await file(raw.replace('不可成為正式拜訪原文','不同外部備註'),'重匯.csv')],ledger)).review[0].status,'excluded');
});
test('explicit reversal appends history; repeating same ruling does not add events',async()=>{
  const {batch}=await prepareChatBatch([await file(raw)]),reject=await decideChatBatch(batch,emptyChatLedger(),[decision('0:0','reject')],'Kit：拒絕。');
  const same=await decideChatBatch(batch,reject,[decision('0:0','reject')],'Kit：仍拒絕。');assert.deepEqual(same,reject);
  const changed=await decideChatBatch(batch,reject,[decision('0:0','pending')],'Kit：改回待確認。');assert.deepEqual(changed.events.slice(0,1),reject.events);assert.equal((await prepareChatBatch([await file(raw)],changed)).review[0].status,'pending');
});
test('tampered decision, missing history, raw source mismatch and unknown actions stop',async()=>{
  const {batch}=await prepareChatBatch([await file(raw)]),ledger=await decideChatBatch(batch,emptyChatLedger(),[decision('0:0','reject')],'Kit：拒絕。');
  const bad=structuredClone(ledger);bad.events[0].action='approve-new';await assert.rejects(()=>validateChatLedger(bad),/雜湊/);
  const broken=structuredClone(ledger);broken.events[0].previous='gone';await assert.rejects(()=>validateChatLedger(broken),/歷史/);
  const changed=structuredClone(batch);changed.rows[0].profile.address='捏造路';await assert.rejects(()=>validateChatBatch(changed),/原始CSV/);
  await assert.rejects(()=>decideChatBatch(batch,ledger,[decision('0:0','delete')],'Kit'),/裁定/);
  await assert.rejects(()=>decideChatBatch(batch,ledger,[decision('0:0','reject')],''),/明確裁定/);
});
test('duplicate source rows make one action, preserving every original row and raw column',async()=>{
  const f=await file(raw+'\n'+raw),{batch}=await prepareChatBatch([f]);const l=await decideChatBatch(batch,emptyChatLedger(),[decision('0:0','approve-new')],'Kit：核准。');
  const c=await chatApplicationChecklist(batch,l);assert.equal(c.rows.length,1);assert.deepEqual(c.rows[0].sourceRows,['0:0','0:1']);assert.equal(batch.rows.length,2);assert.ok(batch.files[0].content);assert.equal(batch.files[0].sha256,f.blob);
  await assert.rejects(()=>decideChatBatch(batch,l,[decision('0:0','reject'),decision('0:1','approve-new')],'Kit'),/重複裁定/);
});
test('existing store link requires explicit target ID; missing-address new store stops',async()=>{
  const {batch}=await prepareChatBatch([await file(raw)]);await assert.rejects(()=>decideChatBatch(batch,emptyChatLedger(),[decision('0:0','approve-link')],'Kit'),/門市ID/);
  const l=await decideChatBatch(batch,emptyChatLedger(),[decision('0:0','approve-link','fictional-store')],'Kit：對應既有門市。');assert.equal((await chatApplicationChecklist(batch,l)).rows[0].targetStoreId,'fictional-store');
  const b=(await prepareChatBatch([await file(raw.replace('虛構路1號',''))])).batch;await assert.rejects(()=>decideChatBatch(b,emptyChatLedger(),[decision('0:0','approve-new')],'Kit'),/地址未提供/);
});
test('nameless metadata remains in raw file; supplied row/mapping cannot alter parsed profile',async()=>{
  const f=await file(raw+'\n,,,清單標籤');f.rows[0].cells[0]='篡改門市';const r=await prepareChatBatch([f]);assert.equal(r.batch.rows.length,1);assert.equal(r.batch.rows[0].profile.name,'虛構青禾藥局');assert.equal(Buffer.from(r.batch.files[0].content,'base64').toString(),new TextDecoder().decode(f.bytes));
});
test('CLI saves only private worksheet with 0600, refuses overwrite and repository symlink destinations',async t=>{
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'fictional-csv-chat-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));
  const src=path.join(d,'虛構.csv'),out=path.join(d,'review.json'),script=new URL('../scripts/csv-chat-review.mjs',import.meta.url).pathname;
  await fs.writeFile(src,'Title,Address,URL,Note\n'+raw);const result=JSON.parse(execFileSync(process.execPath,[script,'prepare','--output',out,'--csv',src],{encoding:'utf8'}));
  assert.equal(result.imported,false);assert.equal(result.pending,1);assert.equal((await fs.stat(out)).mode&0o777,0o600);assert.equal(JSON.parse(await fs.readFile(out,'utf8')).review[0].status,'pending');
  assert.throws(()=>execFileSync(process.execPath,[script,'prepare','--output',out,'--csv',src],{stdio:'pipe'}),/EEXIST/);
  const link=path.join(d,'repo');await fs.symlink(new URL('..',import.meta.url).pathname,link,'dir');assert.throws(()=>execFileSync(process.execPath,[script,'prepare','--output',path.join(link,'never-write-private.json'),'--csv',src],{stdio:'pipe'}),/不得輸出/);
});
