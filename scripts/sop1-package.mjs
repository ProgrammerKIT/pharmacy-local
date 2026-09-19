import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { b64, hashBytes } from '../public/core.js';
import { prepareReviewedCSV, REVIEW_FORMAT } from '../public/csv.js';

// Compiler for the private, fully adjudicated SOP1 worksheet ledger. The
// artifact includes source bytes; it must never be saved in this repository.
export async function compileReviewedPackage(decisions, sourceDirectory) {
  if (!decisions || !Array.isArray(decisions.controls) || !Array.isArray(decisions.rows) || !Array.isArray(decisions.groups) || !Array.isArray(decisions.questions) || decisions.questions.length) throw new Error('裁定尚未完成或缺少來源清冊。');
  const files=[];
  for (const c of decisions.controls) {
    if (path.basename(c.file)!==c.file) throw new Error('來源檔名不可包含資料夾。');
    const bytes=new Uint8Array(await fs.readFile(path.join(sourceDirectory,c.file)));
    if(await hashBytes(bytes)!==c.sha256) throw new Error('來源已變更，請重新核對：'+c.file);
    files.push({file:c.file,list:c.list,sha256:c.sha256,content:b64(bytes)});
  }
  const rows=new Map(decisions.rows.map(r=>[r.row,r]));
  const ref=r=>({sha256:r.sha256,line:r.line,fingerprint:r.fingerprint});
  const groups=[];
  for(const g of decisions.groups) {
    if(g.status==='本批排除') continue;
    if(!['擬納入','擬納入・待確認'].includes(g.status)) throw new Error('仍有未裁定組。');
    const members=g.rows.map(key=>rows.get(key));
    if(members.some(r=>!r||r.status!==g.status)) throw new Error('組與來源列的裁定不同。');
    groups.push({id:'g_'+(await hashBytes(new TextEncoder().encode(g.key))).slice(0,32),label:g.displayName||g.names.join('／'),pending:g.status==='擬納入・待確認',rows:members.map(ref),...(g.identityRule?{identityRule:g.identityRule}:{})});
  }
  if(decisions.rows.some(r=>!['擬納入','擬納入・待確認','本批排除'].includes(r.status))) throw new Error('仍有未裁定來源列。');
  const result={format:REVIEW_FORMAT,files,groups,excluded:decisions.rows.filter(r=>r.status==='本批排除').map(ref),decisions:decisions.rulings?.map(r=>({item:r.item,decision:r.decision,originalDecision:r.originalDecision,source:r.decisionSource,refs:r.refs}))};
  await prepareReviewedCSV(JSON.stringify(result));
  return result;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), value=key=>args[args.indexOf(key)+1];
  if(!['--decisions','--source-dir','--output'].every(key=>args.includes(key)&&value(key))) throw new Error('用法：node scripts/sop1-package.mjs --decisions 裁定.json --source-dir 原CSV目錄 --output 私人目錄/已核對.pharmareview');
  const output=path.resolve(value('--output')), repo=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
  if(output===repo||output.startsWith(repo+path.sep)) throw new Error('客戶資料包必須放在程式儲存庫之外。');
  const result=await compileReviewedPackage(JSON.parse(await fs.readFile(value('--decisions'),'utf8')),path.resolve(value('--source-dir')));
  await fs.writeFile(output,JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({output,files:result.files.length,groups:result.groups.length,pending:result.groups.filter(g=>g.pending).length,excluded:result.excluded.length,imported:false}));
}
