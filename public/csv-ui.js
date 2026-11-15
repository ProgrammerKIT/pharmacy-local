import { FIELD_NAMES, prepareCSV, planExternalCSV, buildExternalCSVImport, externalCSVStores, normalizeListName, CSV_LIMIT } from './csv.js';
import { project } from './core.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// CSV is an external reading channel. This UI has no create, fill, merge or note-update route.
export function createCSVImport({ host, getState, run, saveBundle, getSaveContext, notify, exportReport, downloadSource, openDialog, onDialogClose }) {
  let files = [], plan = null, generation = 0, page = 0, finalReview = null, applying = false;
  const find = selector => host.querySelector(selector);
  const stamp = () => JSON.stringify(plan);
  function closeFinal() {
    if (applying) return;
    finalReview = null;
    const dialog = find('#csv-final-review');
    if (dialog?.open) dialog.close();
    onDialogClose?.();
  }
  function shell() {
    const snapshots = getState() ? project(getState().bundle).filter(s => s.type === 'source' && (s.externalCSV || /\.csv$/i.test(s.file || ''))).sort((a,b) => b.heads[0].at.localeCompare(a.heads[0].at)) : [];
    host.innerHTML = `<div class="section-row"><div><h2>外部 CSV 資料</h2><p>只保存獨立來源，不新增或修改門市、拜訪筆記、人物、關係、待辦或拜訪狀態。</p></div><button id="csv-choose" class="primary">選取 CSV 檔案</button></div><input id="csv-files" type="file" accept=".csv,text/csv" multiple hidden><p class="muted">選檔 → 核對欄位 → 人工對應既有門市 → 最後清單確認。沒有對應的列只保留原檔。每檔上限2 MB，最多10檔、合計5 MB及1,500列。舊資料包的補欄、更新筆記及整併流程不再提供；歷史資料不受影響。</p><div id="csv-file-settings"></div><p id="csv-error" class="error" role="alert"></p><div id="csv-preview"></div><div id="csv-result" role="status"></div><details class="panel"><summary>原始來源與歷史 · ${snapshots.length} 份</summary><p>完整原檔與舊匯入紀錄保留；以下顯示最近20份。下載為明文，請存本機私人資料夾。</p>${snapshots.slice(0,20).map(s=>`<div class="section-row"><div><strong>${esc(s.file)}</strong><p>${esc(s.list)} · ${s.rows} 列${s.externalCSV?' · 獨立外部來源':' · 舊匯入原件'}</p></div><button data-csv-source-snapshot="${esc(s.id)}">下載原始 CSV</button></div>`).join('')}</details><dialog id="csv-final-review" aria-labelledby="csv-final-title"></dialog>`;
    const dialog = find('#csv-final-review');
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeFinal(); });
    dialog.addEventListener('close', () => { if (!applying) finalReview = null; onDialogClose?.(); });
  }
  function reset() { closeFinal(); generation++; files=[]; plan=null; page=0; shell(); }
  function settings() {
    find('#csv-file-settings').innerHTML = files.map((file,i)=>`<article class="panel"><h3>${esc(file.file)}</h3>${file.error?`<p class="error">${esc(file.error)}</p>`:`<div class="field-grid"><label>文字編碼<select data-csv-encoding="${i}">${[['auto','自動（UTF-8／UTF-16 BOM）'],['big5','Big5'],['utf-8','UTF-8'],['utf-16le','UTF-16 LE'],['utf-16be','UTF-16 BE']].map(([key,label])=>`<option value="${key}" ${file.encoding===key?'selected':''}>${label}</option>`).join('')}</select></label><label>分隔符號<select data-csv-delimiter="${i}">${[['auto','自動'],[',','逗號'],[';','分號'],['\t','Tab']].map(([key,label])=>`<option value="${esc(key)}" ${(file.requestedDelimiter||'auto')===key?'selected':''}>${label}</option>`).join('')}</select></label></div><div class="csv-mapping">${Object.entries(FIELD_NAMES).map(([key,title])=>`<label>${esc(title)}<select data-csv-field="${key}" data-file="${i}"><option value="-1">${key==='name'?'請指定':'未對應'}</option>${file.headers.map((h,n)=>`<option value="${n}" ${file.mapping[key]===n?'selected':''}>第${n+1}欄 · ${esc(h||'無欄名')}</option>`).join('')}</select></label>`).join('')}</div><label>來源清單名稱<input data-csv-list="${i}" maxlength="200" value="${esc(file.list)}"></label><p>欄位對應只協助核對，完整原始欄位全部保留，不補入門市欄位或筆記。</p>`}</article>`).join('') + (files.length?'<button id="csv-preview-button">產生／重新整理對應預覽</button><button id="csv-cancel">取消本次匯入</button>':'');
  }
  function preview() {
    if (!plan) { find('#csv-preview').replaceChildren(); return; }
    const stores = externalCSVStores(getState().bundle), mapped=plan.rows.filter(row=>row.storeId);
    page=Math.min(page,Math.max(0,Math.ceil(plan.rows.length/40)-1));
    find('#csv-preview').innerHTML = `<section class="panel"><h3>獨立呈現 · 尚未寫入</h3><p>${plan.rows.length}列；選擇對應${mapped.length}列；未對應${plan.rows.length-mapped.length}列。</p><p>既有門市、筆記、人物、關係、歷史更新：0。每列需人工確認店名、地址與通路，不依相似度自動配對。</p><button id="csv-commit" class="primary" ${mapped.some(r=>!r.confirmed)?'disabled':''}>下一步：核對完整清單</button></section>${plan.rows.slice(page*40,page*40+40).map(row=>{
      const file=plan.files[row.fileIndex], raw=file.rows[row.rowIndex];
      const candidates=new Set(row.candidates.filter(c=>c.choice.startsWith('store:')).map(c=>c.choice.slice(6)));
      const ordered=stores.slice().sort((a,b)=>Number(candidates.has(b.id))-Number(candidates.has(a.id))||a.name.localeCompare(b.name,'zh-Hant'));
      return `<article class="panel csv-review-row"><h3>${esc(row.data.name||'原檔未提供名稱')}</h3><p>${esc(file.file)} · 第${row.line}行</p><p>原檔地址：${esc(row.data.address||'未提供')} · 通路：${esc(row.data.channel||'未提供')}</p>${row.errors.map(e=>`<p class="error">${esc(e)}</p>`).join('')}<label>只對應既有門市<select data-csv-target="${esc(row.key)}" ${row.errors.length?'disabled':''}><option value="">不對應，只保留原檔</option>${ordered.map(s=>`<option value="${esc(s.id)}" ${s.id===row.storeId?'selected':''}>${esc(s.name)} · ${esc(s.address||'地址未提供')} · ${esc(s.channel||'通路未填')} · ID ${esc(s.id)}</option>`).join('')}</select></label>${row.storeId?`<label class="check"><input type="checkbox" data-csv-confirm="${esc(row.key)}" ${row.confirmed?'checked':''}>已核對完整店名、地址、通路及門市身分；僅供此來源展示</label>`:''}<details><summary>查看完整外部原文</summary>${file.headers.map((h,n)=>`<p><strong>第${n+1}欄 · ${esc(h||'無欄名')}</strong></p><pre>${esc(raw.cells[n])}</pre>`).join('')}</details></article>`;
    }).join('')}<div class="section-row"><button id="csv-prev" ${page===0?'disabled':''}>上一頁</button><span>${page+1} / ${Math.max(1,Math.ceil(plan.rows.length/40))}頁</span><button id="csv-next" ${(page+1)*40>=plan.rows.length?'disabled':''}>下一頁</button></div>`;
  }
  async function readFiles(selected) {
    closeFinal(); const active=++generation; files=[]; plan=null; page=0; find('#csv-result').textContent=''; settings(); preview();
    if(selected.length>10||selected.some(f=>f.size>CSV_LIMIT)||selected.reduce((n,f)=>n+f.size,0)>5*1024*1024)throw Error('最多10個CSV，每檔2 MB、合計5 MB。');
    for(const file of selected){const bytes=new Uint8Array(await file.arrayBuffer());if(active!==generation||!getState())return;try{files.push(await prepareCSV(file.name,bytes));}catch(error){files.push({file:file.name,bytes,error:error.message});}}
    if(active===generation&&getState())settings();
  }
  async function finalPreview() {
    if(!plan)throw Error('請先產生預覽。');
    const state=getState(), activePlan=plan, activeGeneration=generation, saveContext=getSaveContext?.(), result=await buildExternalCSVImport(activePlan,state.bundle,state.device);
    if(getState()!==state||plan!==activePlan||generation!==activeGeneration||document.hidden)throw Error('資料或畫面已改變，請重新預覽。');
    const dialog=find('#csv-final-review');
    finalReview={state,saveContext,plan,stamp:stamp(),summary:result.summary};
    const stores=externalCSVStores(state.bundle);
    dialog.innerHTML=`<div class="section-row"><h2 id="csv-final-title" tabindex="-1" data-dialog-focus>最後核對 · 尚未寫入</h2><button id="csv-final-back">返回編輯</button></div><p>保存${files.length}份完整原檔；對應${result.summary.linked}列，其他${result.summary.unmapped}列只保留原檔。</p><p><strong>新增或修改門市、拜訪、人物、關係及待辦：0。</strong></p>${plan.rows.filter(r=>r.storeId).map(row=>{const s=stores.find(s=>s.id===row.storeId);return `<article class="panel"><h3>${esc(s.name)}</h3><p>${esc(s.address||'地址未提供')} · ${esc(s.channel||'通路未填')}</p><p>門市ID：${esc(s.id)}</p><p>外部名稱：${esc(row.data.name)} · ${esc(files[row.fileIndex].file)}第${row.line}行</p></article>`;}).join('')||'<p>沒有選取門市對應，本次僅保存完整原檔。</p>'}<p>同清單新來源僅切換外部資料呈現；舊來源及全部原文歷史保留。不自動新增門市或建立拜訪。</p><label class="check"><input id="csv-final-ack" type="checkbox">已核對此次對應及保存範圍</label><p id="csv-final-error" class="error" role="alert"></p><button id="csv-final-edit">返回編輯，不寫入</button><button id="csv-final-apply" class="primary" disabled>確認上述清單並加密保存</button>`;
    if(openDialog)openDialog(dialog);else dialog.showModal();
  }
  host.addEventListener('change', event=>{
    const el=event.target;if(!getState())return;
    if(el.id==='csv-final-ack'){find('#csv-final-apply').disabled=!el.checked;return;}
    closeFinal();generation++;
    if(el.id==='csv-files'){const selected=[...el.files];el.value='';return run(()=>readFiles(selected),'csv-error');}
    if(el.dataset.csvEncoding!==undefined||el.dataset.csvDelimiter!==undefined){const i=Number(el.dataset.csvEncoding??el.dataset.csvDelimiter),old=files[i],active=generation;plan=null;preview();return run(async()=>{const encoding=el.dataset.csvEncoding!==undefined?el.value:old.encoding,delimiter=el.dataset.csvDelimiter!==undefined?el.value:old.requestedDelimiter||'auto';const parsed=await prepareCSV(old.file,old.bytes,encoding,delimiter);if(active!==generation||!getState())return;files[i]={...parsed,requestedDelimiter:delimiter};settings();},'csv-error');}
    if(el.dataset.csvField){files[Number(el.dataset.file)].mapping[el.dataset.csvField]=Number(el.value);plan=null;preview();return;}
    if(el.dataset.csvList!==undefined){files[Number(el.dataset.csvList)].list=normalizeListName(el.value);plan=null;preview();return;}
    if(el.dataset.csvTarget){const row=plan?.rows.find(r=>r.key===el.dataset.csvTarget);if(row){row.storeId=el.value;row.confirmed=false;preview();}return;}
    if(el.dataset.csvConfirm){const row=plan?.rows.find(r=>r.key===el.dataset.csvConfirm);if(row){row.confirmed=el.checked;preview();}}
  });
  host.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b||!getState())return;
    if(b.id==='csv-choose')return find('#csv-files').click();
    if(b.id==='csv-cancel'){reset();notify('已取消，既有資料不變。');return;}
    if(b.id==='csv-final-back'||b.id==='csv-final-edit'){closeFinal();return;}
    if(b.dataset.csvSourceSnapshot){const s=project(getState().bundle).find(s=>s.type==='source'&&s.id===b.dataset.csvSourceSnapshot);if(s&&downloadSource)return downloadSource(s.blob,s.file);return;}
    if(b.id==='csv-preview-button')return run(async()=>{closeFinal();const active=++generation,state=getState();plan=null;preview();if(files.some(f=>f.error))throw Error('請先解決檔案格式或編碼問題。');const parsed=await planExternalCSV(files,state.bundle);if(active!==generation||getState()!==state)return;plan=parsed;page=0;preview();},'csv-error');
    if(b.id==='csv-prev'){page--;preview();return;}if(b.id==='csv-next'){page++;preview();return;}
    if(b.id==='csv-commit')return run(finalPreview,'csv-error');
    if(b.id==='csv-final-apply')return run(async()=>{
      const ctx=finalReview;
      const guard=()=>{if(!ctx||finalReview!==ctx||!find('#csv-final-review')?.open||!find('#csv-final-ack')?.checked||document.hidden||getState()!==ctx.state||plan!==ctx.plan||stamp()!==ctx.stamp)throw Error('核對期間資料、來源、工作階段或選擇已變，請重新預覽。');};
      guard();const result=await buildExternalCSVImport(plan,ctx.state.bundle,ctx.state.device);guard();
      if(JSON.stringify(result.summary)!==JSON.stringify(ctx.summary))throw Error('最後核對的影響已變，請重新預覽。');
      applying=true;
      try{await saveBundle(result.bundle,ctx.saveContext);}catch(error){throw error;}finally{applying=false;}
      reset();find('#csv-result').textContent=`完成：保存${result.summary.sourceSnapshots}份完整外部來源，對應${result.summary.linked}列；未對應${result.summary.unmapped}列原文保留。門市、筆記、人物、關係及待辦更新0筆。已在本機加密保存，Mac收到狀態另行核對。`;notify('外部CSV已獨立保存，可由門市的「外部CSV資料」查看。');
    },'csv-final-error');
  });
  shell();return {reset,refresh:()=>{if(!files.length)shell();},hasPending:()=>files.length>0};
}
