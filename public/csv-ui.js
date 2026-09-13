import { FIELD_NAMES, prepareCSV, planCSV, buildCSVImport, normalizeListName, CSV_LIMIT } from './csv.js';
import { project } from './core.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function createCSVImport({ host, getState, run, saveBundle, notify }) {
  let files = [], plan = null, page = 0, generation = 0;
  const find = s => host.querySelector(s);
  function shell() {
    host.innerHTML = `<div class="section-row"><div><h2>從 Google Maps CSV 匯入</h2><p class="muted">在這台裝置讀取、預覽並加密儲存。原始 CSV 不會送到外部服務。</p></div><button id="csv-choose" class="primary">選取 CSV 檔案</button></div><input id="csv-files" type="file" accept=".csv,text/csv" multiple hidden><div class="csv-intro"><p>① 選取檔案　② 核對欄位　③ 確認門市　④ 加密匯入</p><p class="muted">可多檔選取，每個 2 MB、合計 5 MB，每批最多 1,500 列。建議在 Mac 操作。請先匯出加密備份；兩台都更新到 1.3 版後再匯入。</p></div><div id="csv-file-settings"></div><p id="csv-error" class="error" role="alert"></p><div id="csv-preview"></div><div id="csv-result" class="result" role="status"></div>`;
  }
  function reset() { generation++; files = []; plan = null; page = 0; shell(); }
  function fileSettings() {
    let cancel = find('#csv-cancel');
    if (!cancel) { cancel = document.createElement('button'); cancel.id = 'csv-cancel'; cancel.textContent = '取消本次匯入'; cancel.className = 'secondary'; find('#csv-choose').after(cancel); }
    find('#csv-file-settings').innerHTML = files.map((f, i) => `<article class="panel csv-file"><div class="section-row"><h3>${esc(f.file)}</h3><span class="pill">${f.rows?.length ?? '—'} 列</span></div><div class="field-grid"><label>文字編碼<select data-csv-encoding="${i}">${[['auto', '自動（UTF-8／UTF-16 BOM）'], ['big5', 'Big5（繁體中文）'], ['utf-8', 'UTF-8'], ['utf-16le', 'UTF-16 LE'], ['utf-16be', 'UTF-16 BE']].map(([k, v]) => `<option value="${k}" ${f.encoding === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>分隔符號<select data-csv-delimiter="${i}">${[['auto', '自動辨識'], [',', '逗號'], [';', '分號'], ['\t', 'Tab']].map(([k, v]) => `<option value="${k}" ${(f.requestedDelimiter || 'auto') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>${f.error ? `<p class="error">${esc(f.error)}</p>` : `<div class="csv-mapping">${Object.entries(FIELD_NAMES).map(([key, title]) => `<label>${title}<select data-csv-field="${key}" data-file="${i}"><option value="-1">${key === 'name' ? '請指定' : '不對應／未提供'}</option>${f.headers.map((h, n) => `<option value="${n}" ${f.mapping[key] === n ? 'selected' : ''}>第 ${n + 1} 欄 · ${esc(h || '無欄名')}</option>`).join('')}</select></label>`).join('')}</div><div class="field-grid"><label>來源清單名稱<input data-csv-list="${i}" maxlength="200" value="${esc(f.list)}"></label><label>通路預設（原列沒有通路時）<select data-csv-channel="${i}">${['', '連鎖', '獨立', '加盟', '診所', '其他'].map(v => `<option value="${v}" ${f.channel === v ? 'selected' : ''}>${v || '保持未分類'}</option>`).join('')}</select></label></div><details><summary>查看第一筆原始欄位，確認對應</summary><div class="csv-raw">${f.headers.map((h, n) => `<p><strong>第 ${n + 1} 欄 · ${esc(h)}</strong><span>${esc(f.rows[0]?.cells[n] || '（空白）')}</span></p>`).join('')}</div></details>`}</article>`).join('');
    if (files.length) find('#csv-file-settings').insertAdjacentHTML('beforeend', '<button id="csv-preview-button" class="secondary">產生／重新整理匯入預覽</button><p class="muted">欄位判斷只是建議，請核對備註是否選對。未對應欄位仍留在原始來源內。</p>');
  }
  function targets(row) {
    const current = getState(); if (!current) return '';
    const stores = project(current.bundle).filter(r => r.type === 'store' && !r.deleted && !r.conflict).sort((a, b) => a.name.localeCompare(b.name));
    const batch = plan.rows.filter(r => r.key !== row.key && r.data.name.trim() === row.data.name.trim()).slice(0, 30);
    return [['skip', '略過這列'], ['new', '新增獨立門市'], ['review', '待指定門市'], ...stores.map(s => [`store:${s.id}`, `現有：${s.name} · ${s.district || '未填地區'}`]), ...batch.map(r => [`row:${r.key}`, `本批：${r.data.name}（${plan.files[r.fileIndex].file} 第 ${r.line} 行）`])].map(([value, label]) => `<option value="${esc(value)}" ${row.choice === value ? 'selected' : ''}>${esc(label)}</option>`).join('');
  }
  function preview() {
    if (!plan) { find('#csv-preview').replaceChildren(); return; }
    const selected = plan.rows.filter(r => r.choice !== 'skip'), unresolved = selected.filter(r => r.choice === 'review' || r.errors.length).length;
    const start = page * 40, rows = plan.rows.slice(start, start + 40);
    find('#csv-preview').innerHTML = `<div class="csv-summary"><strong>${plan.rows.length} 列 · 選取 ${selected.length} 列 · 略過 ${plan.rows.length - selected.length} 列 · 待處理 ${unresolved} 列</strong><button id="csv-commit" class="primary" ${!selected.length || unresolved ? 'disabled' : ''}>確認並加密匯入</button></div><p class="muted">同一門市、同一來源清單的備註會更新為同一筆紀錄的新版本。Google 缺少舊備註時保留最後文字並標示；日期不明就留空。</p><p class="muted">含匯入列的整份原始 CSV 也會加密保存，因此原檔仍包含你略過的列。只想保留部分資料時，先在自己的 Mac 另存篩選後的 CSV。</p><div class="csv-table-wrap"><table class="csv-table"><thead><tr><th>來源／門市</th><th>備註原文與核對</th><th>匯入方式</th></tr></thead><tbody>${rows.map(r => `<tr><td><small>${esc(plan.files[r.fileIndex].file)} · 第 ${r.line} 行</small><strong>${esc(r.data.name || '缺少名稱')}</strong><span>${esc(r.data.address)}</span><span>${esc(r.data.city)} ${esc(r.data.district)}</span></td><td><details><summary>${esc(r.note ? r.note.slice(0, 100) + (r.note.length > 100 ? '…（點開全文）' : '') : '沒有備註內容')}</summary><pre>${esc(r.note)}</pre></details><small>拜訪日期：${esc(r.date || '原始日期未提供')}</small>${[r.reason, ...r.warnings, ...r.errors].map(x => `<p class="${r.errors.includes(x) ? 'error' : 'muted'}">${esc(x)}</p>`).join('')}</td><td><select data-csv-choice="${esc(r.key)}" aria-label="${esc(r.data.name)}的匯入方式">${targets(r)}</select></td></tr>`).join('')}</tbody></table></div><div class="section-row csv-pagination"><button id="csv-prev" ${!page ? 'disabled' : ''}>上一頁</button><span>${page + 1} / ${Math.max(1, Math.ceil(plan.rows.length / 40))} 頁</span><button id="csv-next" ${start + 40 >= plan.rows.length ? 'disabled' : ''}>下一頁</button></div>`;
  }
  async function readFiles(selected) {
    if (!selected.length) return;
    if (selected.length > 10 || selected.some(f => f.size > CSV_LIMIT) || selected.reduce((n, f) => n + f.size, 0) > 5 * 1024 * 1024) throw new Error('最多 10 個 CSV；每個上限 2 MB，合計 5 MB。');
    const active = generation; files = []; plan = null; page = 0; find('#csv-result').textContent = '';
    for (const f of selected) {
      const bytes = new Uint8Array(await f.arrayBuffer()); if (active !== generation || !getState()) return;
      try { files.push(await prepareCSV(f.name, bytes)); }
      catch (e) { files.push({ file: f.name, bytes, encoding: 'auto', error: e.message }); }
    }
    if (active === generation && getState()) { fileSettings(); preview(); }
  }
  async function reparse(i, encoding, delimiter) {
    const old = files[i];
    try { files[i] = { ...await prepareCSV(old.file, old.bytes, encoding, delimiter), requestedDelimiter: delimiter }; }
    catch (e) { files[i] = { ...old, encoding, requestedDelimiter: delimiter, error: e.message }; }
    plan = null; fileSettings(); preview();
  }
  host.addEventListener('change', event => {
    const el = event.target;
    if (!getState()) return;
    if (el.id === 'csv-files') { const selected = [...el.files]; el.value = ''; return run(() => readFiles(selected), 'csv-error'); }
    if (el.dataset.csvEncoding !== undefined) { const i = +el.dataset.csvEncoding; return run(() => reparse(i, el.value, files[i].requestedDelimiter || 'auto'), 'csv-error'); }
    if (el.dataset.csvDelimiter !== undefined) { const i = +el.dataset.csvDelimiter; return run(() => reparse(i, files[i].encoding, el.value), 'csv-error'); }
    if (el.dataset.csvField) { files[+el.dataset.file].mapping[el.dataset.csvField] = +el.value; plan = null; preview(); }
    if (el.dataset.csvList !== undefined) { files[+el.dataset.csvList].list = normalizeListName(el.value); el.value = files[+el.dataset.csvList].list; plan = null; preview(); }
    if (el.dataset.csvChannel !== undefined) { files[+el.dataset.csvChannel].channel = el.value; plan = null; preview(); }
    if (el.dataset.csvChoice) { plan.rows.find(r => r.key === el.dataset.csvChoice).choice = el.value; preview(); }
  });
  host.addEventListener('click', event => {
    const b = event.target.closest('button'); if (!b || !getState()) return;
    if (b.id === 'csv-choose') return find('#csv-files').click();
    if (b.id === 'csv-cancel') { reset(); notify('已取消未完成的匯入；已保存的客戶資料不受影響。'); return; }
    if (b.id === 'csv-preview-button') return run(async () => { if (files.some(f => f.error)) throw new Error('請先解決檔案的編碼或格式問題。'); plan = await planCSV(files, getState().bundle); page = 0; preview(); }, 'csv-error');
    if (b.id === 'csv-prev') { page = Math.max(0, page - 1); preview(); }
    if (b.id === 'csv-next') { page = Math.min(Math.ceil(plan.rows.length / 40) - 1, page + 1); preview(); }
    if (b.id === 'csv-commit') return run(async () => {
      if (!plan || !plan.rows.some(r => r.choice !== 'skip')) throw new Error('請先預覽並選取要匯入的列。');
      const state = getState(), result = buildCSVImport(plan, state.bundle, state.device);
      if (!confirm(`確認匯入 ${result.summary.rows} 列？\n新增 ${result.summary.stores} 間門市、${result.summary.notes} 筆備註；更新 ${result.summary.updatedNotes} 筆版本。\nGoogle 缺少備註時保留舊文。既有門市欄位不會被覆蓋。`)) return;
      await saveBundle(result.bundle);
      const s = result.summary; reset(); find('#csv-result').textContent = `匯入完成：新增 ${s.stores} 間門市，連結 ${s.linked} 間現有門市，新增 ${s.notes} 筆備註，更新 ${s.updatedNotes} 筆版本；${s.missingNotes} 筆最新匯出缺少備註但舊文已保留，${s.restoredNotes} 筆重新出現，${s.unchangedNotes} 筆未變，${s.skipped} 列略過。已加密儲存於本機，Mac 可連線時會交換。`;
      notify('CSV 已加密匯入，可到客戶門市與拜訪紀錄查看。');
    }, 'csv-error');
  });
  shell(); return { reset, hasPending: () => files.length > 0 };
}
