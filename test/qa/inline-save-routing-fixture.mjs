// Dedicated fictional origin. Never reads a production snapshot or pairing.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../public');
const port=18924;
const client=`import * as c from '/core.js';import * as db from '/db.js';
const output=document.querySelector('#output');
function allowed(){if(location.origin!=='http://127.0.0.1:18924')throw Error('Fictional origin only');}
document.querySelector('#seed').onclick=async()=>{try{allowed();if(await db.readLocal())throw Error('Existing fixture retained; open App directly.');
const bundle=c.emptyBundle('fictional-inline-routing-v124');
bundle.ops.push(c.revision('store','s',{name:'虛構青禾測試藥局',city:'虛構市',district:'測試區',channel:'獨立',attr:'',contact:''},[],'qa'));
bundle.ops.push(c.revision('visit','v',{store:'s',date:'2026-11-01',source:'虛構隔離測試',text:'虛構原文：這一筆已有筆記。',next:'原下次跟進',people:[],topics:[],attachments:[]},[],'qa'));
const meta=c.newMeta();meta.vaultId=bundle.vaultId;const key=await c.derive('fictional-fixture-only',meta);
const payload={schema:1,device:'qa-inline-routing',deviceName:'虛構隔離驗收',token:null,bundle,dirty:false,serverVersion:0,lastSync:null,qaOnly:'inline-routing-v124'};
await db.writeLocal(await c.seal(payload,key,meta,'device'),0,key);output.textContent='虛構資料已建立。';}catch(e){output.textContent=e.message;}};
document.querySelector('#audit').onclick=async()=>{try{allowed();const slot=await db.readLocal();if(!slot?.unlockKey)throw Error('No fixture');const p=await c.unseal(slot.envelope,slot.unlockKey,'device');if(p.qaOnly!=='inline-routing-v124'||p.bundle.vaultId!=='fictional-inline-routing-v124'||p.token)throw Error('Wrong fixture');
const v=c.project(p.bundle).find(x=>x.type==='visit'&&x.id==='v');output.textContent=JSON.stringify({version:'1.5.124',ops:p.bundle.ops.length,visitCount:c.project(p.bundle).filter(x=>x.type==='visit').length,text:v.text,next:v.next,originalRetained:p.bundle.ops.some(x=>x.data?.text==='虛構原文：這一筆已有筆記。'),draft:p.inlineTextDraft?.after??null,newVisitDraft:p.draft??null,attendance:p.bundle.ops.some(x=>x.visitAttendance)},null,2);}catch(e){output.textContent=e.message;}};
`;
const html='<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>虛構保存入口驗收 v1.5.124</title><h1>虛構保存入口驗收 v1.5.124</h1><p>只在獨立127.0.0.1:18924測試，無正式資料、配對或Mac API。</p><button id="seed">建立虛構資料</button><a href="/">開啟隔離App</a><button id="audit">核對虛構保存結果</button><pre id="output"></pre><script type="module" src="/qa-client.mjs"></script></html>';
http.createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");try{
if(req.headers.host!=='127.0.0.1:'+port){res.writeHead(403);return res.end();}
const url=new URL(req.url,'http://127.0.0.1:'+port);
if(req.method!=='GET'||url.pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});return res.end('{"error":"Fictional test: no API available"}');}
if(url.pathname==='/qa.html'||url.pathname==='/qa-client.mjs'){res.setHeader('Content-Type',url.pathname.endsWith('.mjs')?'text/javascript':'text/html; charset=utf-8');return res.end(url.pathname.endsWith('.mjs')?client:html);}
const f=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!f.startsWith(root+path.sep)||(await fs.realpath(f)).startsWith(root+path.sep)===false){res.writeHead(403);return res.end();}
res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(f)]||'application/octet-stream');res.end(await fs.readFile(f));
}catch{res.writeHead(404);res.end();}}).listen(port,'127.0.0.1',()=>console.log('Fictional fixture: http://127.0.0.1:'+port+'/qa.html'));
