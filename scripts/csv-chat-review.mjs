// Local private worksheet helper. Never writes an App bundle, credentials or queue.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCSV, CSV_LIMIT } from '../public/csv.js';
import { hashBytes, b64 } from '../public/core.js';

const enc = new TextEncoder();
const FORMAT = 'pharmacy-csv-chat-ledger-1';
const fields = ['name', 'address', 'city', 'district', 'channel', 'mapUrl'];
const digest = value => hashBytes(enc.encode(JSON.stringify(value)));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 2000) => typeof value === 'string' && value.length <= max;
const exactKeys = (value, keys) => plain(value) && Object.keys(value).sort().join('|') === keys.slice().sort().join('|');
const profileOK = p => exactKeys(p, fields) && fields.every(k => text(p[k])) && !!p.name.trim() && p.name.length <= 200;
export const emptyChatLedger = () => ({ format: FORMAT, events: [] });
export async function chatIdentity(profile) {
  if (!profileOK(profile)) throw Error('完整店名／地址／通路／地點資料格式不符。');
  // Exact profile only: a rename, address correction, missing address or changed
  // place link reopens review. Never use name similarity or filenames as identity.
  return digest(fields.map(k => profile[k]));
}
export async function validateChatLedger(ledger) {
  if (!exactKeys(ledger, ['format', 'events']) || ledger.format !== FORMAT || !Array.isArray(ledger.events) || ledger.events.length > 100000) throw Error('私人裁定紀錄格式不符。');
  let previous = ''; const ids = new Set();
  for (const event of ledger.events) {
    if (!exactKeys(event, ['id','previous','identity','profile','action','at','confirmation','batchId','targetStoreId',...(Object.hasOwn(event,'approvedProfile')?['approvedProfile']:[])]) || event.previous !== previous || ids.has(event.id) || !profileOK(event.profile) || !['approve-new','approve-link','reject','pending'].includes(event.action) || !text(event.at, 40) || !Number.isFinite(Date.parse(event.at)) || !text(event.confirmation, 20000) || !event.confirmation.trim() || !text(event.batchId, 64) || !/^[a-f0-9]{64}$/.test(event.batchId) || !text(event.targetStoreId, 100)) throw Error('私人裁定事件或歷史鏈不完整。');
    if(Object.hasOwn(event,'approvedProfile')&&(event.action!=='approve-new'||!profileOK(event.approvedProfile)||!event.approvedProfile.address.trim()||event.approvedProfile.name!==event.profile.name||event.approvedProfile.mapUrl!==event.profile.mapUrl))throw Error('核准的補查地址必須獨立記錄並綁定同一原始門市。');
    if ((event.action === 'approve-link') !== !!event.targetStoreId) throw Error('僅明確對應既有門市的裁定可帶門市ID。');
    const { id, ...body } = event;
    if (await chatIdentity(event.profile) !== event.identity || await digest(body) !== id) throw Error('私人裁定內容與雜湊不符。');
    ids.add(id); previous = id;
  }
  return ledger;
}
const latestByIdentity = ledger => new Map(ledger.events.map(e => [e.identity, e]));
export async function validateChatBatch(batch) {
  if (!exactKeys(batch, ['format','id','files','rows']) || batch.format !== 'pharmacy-csv-chat-batch-1' || !Array.isArray(batch.files) || !batch.files.length || batch.files.length > 10 || !Array.isArray(batch.rows)) throw Error('對話核對批次不完整。');
  const parsed = [];
  for (const file of batch.files) {
    if (!exactKeys(file, ['file','sha256','content']) || !text(file.file,500) || !text(file.content,Math.ceil(CSV_LIMIT / 3) * 4) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)) throw Error('原件格式不符。');
    const bytes = Uint8Array.from(Buffer.from(file.content, 'base64'));
    if (await hashBytes(bytes) !== file.sha256) throw Error('原始CSV雜湊不符。');
    parsed.push(await prepareCSV(file.file,bytes));
  }
  const fresh = await makeBatch(parsed);
  if (JSON.stringify(fresh) !== JSON.stringify(batch)) throw Error('核對清單與完整原始CSV不符。');
  return batch;
}
async function makeBatch(files) {
  if (!Array.isArray(files) || !files.length || files.length > 10 || files.some(f => !(f.bytes instanceof Uint8Array) || f.bytes.length > CSV_LIMIT) || files.reduce((n,f) => n + f.bytes.length,0) > 5 * 1024 * 1024) throw Error('最多10檔、每檔2 MB、合計5 MB。');
  const originals = [], rows = []; let originalRows = 0;
  for (const [fileIndex,file] of files.entries()) {
    // Reparse original bytes; caller-supplied mapping/row objects cannot change a ruling.
    const fresh = await prepareCSV(file.file,file.bytes);
    originalRows += fresh.rows.length;
    if (fresh.mapping.name < 0) throw Error('找不到門市名稱欄位，先核對欄位，不猜填。');
    originals.push({file:fresh.file,sha256:fresh.blob,content:b64(fresh.bytes)});
    for (const [rowIndex,row] of fresh.rows.entries()) {
      const read = key => fresh.mapping[key] >= 0 ? row.cells[fresh.mapping[key]] || '' : '';
      const profile = {name:read('name'),address:read('address'),city:read('city'),district:read('district'),channel:read('channel') || fresh.channel || '',mapUrl:read('url')};
      // Nameless metadata remain in the original but are not invented stores.
      if (!profile.name.trim()) continue;
      rows.push({key:`${fileIndex}:${rowIndex}`,fileIndex,rowIndex,line:row.line,identity:await chatIdentity(profile),profile});
    }
  }
  if (originalRows > 1500) throw Error('本批超過1500列。');
  return {format:'pharmacy-csv-chat-batch-1',id:await digest(originals.map(({file,sha256})=>({file,sha256}))),files:originals,rows};
}
export async function prepareChatBatch(files, ledger = emptyChatLedger()) {
  await validateChatLedger(ledger); const batch = await makeBatch(files), remembered = latestByIdentity(ledger);
  const review = batch.rows.map(row => {
    const prior = remembered.get(row.identity);
    return {...row,status:prior?.action === 'reject' ? 'excluded' : prior?.action.startsWith('approve-') ? 'approved-awaiting-app-check' : 'pending',decisionId:prior?.id || null};
  });
  return {batch,review,appCompared:false,imported:false};
}
export async function decideChatBatch(batch, ledger, decisions, confirmation, at = new Date().toISOString()) {
  await validateChatBatch(batch); await validateChatLedger(ledger);
  if (!Array.isArray(decisions) || decisions.length > batch.rows.length || !text(confirmation,20000) || !confirmation.trim() || !Number.isFinite(Date.parse(at))) throw Error('須保存Kit明確裁定的原話／對話依據，不從未回答推定拒絕。');
  const next = structuredClone(ledger), seen = new Set(), byKey = new Map(batch.rows.map(r => [r.key,r]));
  for (const decision of decisions) {
    if (!exactKeys(decision,['key','action','targetStoreId',...(Object.hasOwn(decision,'approvedProfile')?['approvedProfile']:[])]) || !byKey.has(decision.key) || !['approve-new','approve-link','reject','pending'].includes(decision.action) || !text(decision.targetStoreId,100)) throw Error('裁定必須明列本批來源列、動作及對應門市。');
    const row = byKey.get(decision.key);
    if (seen.has(row.identity)) throw Error('同一門市身分有重複裁定，須先統一決定。');
    seen.add(row.identity);
    if (decision.action === 'approve-new' && !(decision.approvedProfile||row.profile).address?.trim()) throw Error('新增門市的地址未提供，先向Kit核對。');
    if ((decision.action === 'approve-link') !== !!decision.targetStoreId) throw Error('既有門市對應須明列門市ID；其他動作不得帶ID。');
    const prior = latestByIdentity(next).get(row.identity);
    if (prior?.action === decision.action && prior.targetStoreId === decision.targetStoreId && JSON.stringify(prior.approvedProfile)===JSON.stringify(decision.approvedProfile)) continue;
    const body = {previous:next.events.at(-1)?.id || '',identity:row.identity,profile:structuredClone(row.profile),action:decision.action,at,confirmation,batchId:batch.id,targetStoreId:decision.targetStoreId,...(Object.hasOwn(decision,'approvedProfile')?{approvedProfile:structuredClone(decision.approvedProfile)}:{})};
    next.events.push({id:await digest(body),...body});
  }
  // Omitted rows remain pending, unless an earlier explicit decision exists.
  return validateChatLedger(next);
}
export async function chatApplicationChecklist(batch, ledger) {
  await validateChatBatch(batch); await validateChatLedger(ledger); const latest = latestByIdentity(ledger);
  const unique = new Map();for(const row of batch.rows){if(!unique.has(row.identity))unique.set(row.identity,{...row,sourceRows:[]});unique.get(row.identity).sourceRows.push(row.key);}
  return {batchId:batch.id,imported:false,requiresLiveAppCheck:true,rows:[...unique.values()].map(row=>{const d=latest.get(row.identity);return{...row,decisionId:d?.id||null,action:d?.action||'pending',targetStoreId:d?.targetStoreId||'',approvedProfile:d?.approvedProfile||null,instruction:d?.action==='approve-new'?'核對正式App無重複／回收桶衝突後，經既有人工新增門市表單獨立建立；不寫入CSV筆記。':d?.action==='approve-link'?'唯讀核對已指定門市仍一致；只對應獨立外部CSV來源，不補欄或改名。':d?.action==='reject'?'明確拒絕，同一身分不再詢問、不匯入；完整原檔及裁定留存。':'尚未回答或明確待確認：不匯入，不當作拒絕。'};})};
}

// Minimal CLI for generating private worksheets. Decision recording is an
// explicit module call after Kit answers, never an inference from missing input.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),opt=k=>args[args.indexOf(k)+1];
  if(args[0]!=='prepare'||!args.includes('--output')||!opt('--output')||!args.includes('--csv'))throw Error('用法：node scripts/csv-chat-review.mjs prepare --output 私人清單.json [--ledger 私人裁定.json] --csv 原檔.csv [--csv 原檔2.csv]');
  const output=path.resolve(opt('--output')),repo=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
  const realOutputDir=await fs.realpath(path.dirname(output)),realRepo=await fs.realpath(repo);
  if(realOutputDir===realRepo||realOutputDir.startsWith(realRepo+path.sep))throw Error('私人清單不得輸出到程式儲存庫。');
  const names=args.flatMap((v,i)=>v==='--csv'?[args[i+1]]:[]);if(!names.length||names.length>10||names.some(n=>!n||n.startsWith('--')))throw Error('CSV檔案參數不完整。');
  const files=[];for(const name of names){const bytes=new Uint8Array(await fs.readFile(name));files.push(await prepareCSV(path.basename(name),bytes));}
  const ledger=args.includes('--ledger')?JSON.parse(await fs.readFile(opt('--ledger'),'utf8')):emptyChatLedger();
  const result=await prepareChatBatch(files,ledger);
  await fs.writeFile(path.join(realOutputDir,path.basename(output)),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({output,rows:result.review.length,pending:result.review.filter(r=>r.status==='pending').length,excluded:result.review.filter(r=>r.status==='excluded').length,approved:result.review.filter(r=>r.status==='approved-awaiting-app-check').length,appCompared:false,imported:false}));
}
