import { FIELD_NAMES, prepareCSV, planCSV, buildCSVImport, normalizeListName, CSV_LIMIT, profileChanges, csvStream, sop1Report, REVIEW_LIMIT, prepareReviewedCSV, planReviewedCSV, setReviewedGroupChoice, csvTargetChoice, exportCSVPreview } from './csv.js';
import { project } from './core.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function createCSVImport({ host, getState, run, saveBundle, notify, exportReport, downloadSource }) {
  let files = [], plan = null, page = 0, generation = 0, filter = 'all', review = null;
  const find = s => host.querySelector(s);
  function shell() {
    const snapshots = getState() ? project(getState().bundle).filter(r => r.type === 'source').sort((a, b) => (b.heads?.[0]?.at || '').localeCompare(a.heads?.[0]?.at || '')) : [];
    const saved = snapshots.length ? '<article class="panel"><div class="section-row"><div><h3>已保存原始 CSV · ' + snapshots.length + ' 份</h3><p class="muted">Source Snapshot 只新增、不由分析或門市整理改寫。以下顯示最近 20 份；相同 SHA 可共用同一份檔案 bytes。</p></div></div>' + snapshots.slice(0, 20).map(s => '<div class="section-row"><div><strong>' + esc(s.file) + '</strong><p class="muted">' + esc(s.list || '未命名清單') + ' · ' + s.rows + ' 列 · SHA-256 ' + esc(s.blob.slice(0, 12)) + '…</p></div><button class="text-button" data-csv-source-snapshot="' + esc(s.id) + '">下載原始 CSV</button></div>').join('') + '</article>' : '<article class="panel"><h3>已保存原始 CSV · 0 份</h3><p class="muted">第一次確認提交 CSV 後，完整原檔會以 Source Snapshot 加密保存在資料庫。</p></article>';
    host.innerHTML = `<div class="section-row"><div><h2>從 Google Maps CSV 匯入</h2><p class="muted">在這台裝置讀取、預覽並加密儲存。原始 CSV 不會送到外部服務。</p></div><button id="csv-choose" class="primary">選取 CSV 檔案</button><button id="csv-review-choose">載入已核對資料包</button></div><input id="csv-files" type="file" accept=".csv,text/csv" multiple hidden><input id="csv-review-file" type="file" accept=".pharmareview,application/json" hidden><div class="csv-intro"><p>① 選取檔案　② 核對欄位　③ 確認門市　④ 保存來源並加密匯入</p><p class="muted">可多檔選取，每個 2 MB、合計 5 MB，每批最多 1,500 列。建議在 Mac 操作。請先匯出加密備份；Mac 與 iPhone 都更新到支援 Source Snapshot 的版本後再提交新批次。</p></div>${saved}<div id="csv-file-settings"></div><p id="csv-error" class="error" role="alert"></p><div id="csv-preview"></div><div id="csv-result" class="result" role="status"></div>`;
  }
  function reset() { generation++; files = []; plan = null; review = null; page = 0; filter = 'all'; shell(); }
  function fileSettings() {
    let cancel = find('#csv-cancel');
    if (!cancel) { cancel = document.createElement('button'); cancel.id = 'csv-cancel'; cancel.textContent = '取消本次匯入'; cancel.className = 'secondary'; find('#csv-choose').after(cancel); }
    if (review) {
      find('#csv-file-settings').innerHTML = '<article class="panel"><h3>已載入裁定 · 尚未寫入</h3><p>' + review.groups.length + ' 組 · ' + review.groups.filter(g => g.pending).length + ' 組保留後續確認 · ' + review.excluded.length + ' 列依裁定排除</p><p>本次依裁定保持分組、暫稱與原文；現有門市名稱及人工文字仍需對照。欄位已由資料包固定。</p>' + files.map(f => '<p>' + esc(f.file) + ' · ' + f.rows.length + ' 列</p>').join('') + '<button id="csv-preview-button" class="secondary">重新比對 App 現有資料</button><button id="csv-export-preview">匯出核對結果（明文）</button><p class="muted">核對結果包含客戶名稱及新舊文字，可另存後交回確認；不需要提供密碼或整份資料庫。</p></article>';
      return;
    }
    find('#csv-file-settings').innerHTML = files.map((f, i) => `<article class="panel csv-file"><div class="section-row"><h3>${esc(f.file)}</h3><span class="pill">${f.rows?.length ?? '—'} 列</span></div><div class="field-grid"><label>文字編碼<select data-csv-encoding="${i}">${[['auto', '自動（UTF-8／UTF-16 BOM）'], ['big5', 'Big5（繁體中文）'], ['utf-8', 'UTF-8'], ['utf-16le', 'UTF-16 LE'], ['utf-16be', 'UTF-16 BE']].map(([k, v]) => `<option value="${k}" ${f.encoding === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>分隔符號<select data-csv-delimiter="${i}">${[['auto', '自動辨識'], [',', '逗號'], [';', '分號'], ['\t', 'Tab']].map(([k, v]) => `<option value="${k}" ${(f.requestedDelimiter || 'auto') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>${f.error ? `<p class="error">${esc(f.error)}</p>` : `<div class="csv-mapping">${Object.entries(FIELD_NAMES).map(([key, title]) => `<label>${title}<select data-csv-field="${key}" data-file="${i}"><option value="-1">${key === 'name' ? '請指定' : '不對應／未提供'}</option>${f.headers.map((h, n) => `<option value="${n}" ${f.mapping[key] === n ? 'selected' : ''}>第 ${n + 1} 欄 · ${esc(h || '無欄名')}</option>`).join('')}</select></label>`).join('')}</div><div class="field-grid"><label>來源清單名稱<input data-csv-list="${i}" maxlength="200" value="${esc(f.list)}"></label><label>通路預設（原列沒有通路時）<select data-csv-channel="${i}">${['', '連鎖', '獨立', '加盟', '診所', '其他'].map(v => `<option value="${v}" ${f.channel === v ? 'selected' : ''}>${v || '保持未分類'}</option>`).join('')}</select></label></div><details><summary>查看第一筆原始欄位，確認對應</summary><div class="csv-raw">${f.headers.map((h, n) => `<p><strong>第 ${n + 1} 欄 · ${esc(h)}</strong><span>${esc(f.rows[0]?.cells[n] || '（空白）')}</span></p>`).join('')}</div></details>`}</article>`).join('');
    const warnings = files.flatMap(f => (f.warnings || []).map(w => f.file + '：' + w));
    if (warnings.length) find('#csv-file-settings').insertAdjacentHTML('beforeend', '<div class="conflict-card">' + warnings.map(w => '<p>' + esc(w) + '</p>').join('') + '</div>');
    if (files.length) find('#csv-file-settings').insertAdjacentHTML('beforeend', '<button id="csv-preview-button" class="secondary">產生／重新整理匯入預覽</button><p class="muted">欄位判斷只是建議，請核對備註是否選對。未對應欄位仍留在原始來源內。</p>');
  }
  function targets(row, records) {
    const rank = choice => row.candidates.findIndex(c => c.choice === choice);
    const stores = records.filter(r => r.type === 'store' && !r.deleted && !r.conflict).sort((a, b) => (rank('store:' + a.id) < 0 ? 1 : 0) - (rank('store:' + b.id) < 0 ? 1 : 0) || a.name.localeCompare(b.name));
    const batch = row.review ? [] : row.candidates.filter(c => c.choice.startsWith('row:'));
    return [['skip', '略過這列'], ['new', '新增獨立門市'], ['review', '待指定門市'], ...stores.map(s => ['store:' + s.id, '現有：' + s.name + ' · ' + (s.address || s.district || '地址／地區未提供')]), ...batch.map(c => [c.choice, '本批：' + c.data.name + ' · ' + (c.data.address || '地址未提供')])].map(([value, label]) => '<option value="' + esc(value) + '" ' + (row.choice === value ? 'selected' : '') + '>' + esc(label) + '</option>').join('');
  }
  function noteChanges(row, records) {
    row = { ...row, choice: csvTargetChoice(plan, row) };
    if (!row.choice.startsWith('store:')) return '';
    const store = row.choice.slice(6), stream = csvStream(store, plan.files[row.fileIndex].list);
    const visits = records.filter(v => v.type === 'visit' && !v.deleted && (v.csvStream || (v.csvSources?.length ? csvStream(v.store, v.csvSources.at(-1).list) : '')) === stream);
    if (visits.length > 1 || visits.some(v => v.conflict)) return '<p class="error">同一來源的既有備註有多筆或同步衝突，請先在 App 核對；這批尚未寫入。</p>';
    const old = visits[0]; if (!old || row.noteProvided === false) return '';
    if (!row.note) return '<p class="muted">本次備註空白：保留舊文，標示最新來源缺少備註。</p>';
    if ((old.googleText ?? old.text) === row.note && !old.sourceMissing) return '<p class="muted">此來源的備註內容未變。</p>';
    const manual = old.googleText === undefined || old.text !== old.googleText;
    return '<details class="csv-note-changes"><summary>查看備註新舊差異' + (manual ? '（保留 App 手動修改）' : '') + '</summary><div class="quality-pair"><div><strong>目前 App 內容</strong><pre>' + esc(old.text) + '</pre></div><div><strong>這次 CSV 原文</strong><pre>' + esc(row.note) + '</pre></div></div><p class="muted">' + (manual ? '這次只保存 Google 新文字供核對，保留 App 手動修改。' : '確認匯入後建立新版本，舊文字留在歷史。') + '</p></details>';
  }
  function preview() {
    if (!plan) { find('#csv-preview').replaceChildren(); return; }
    const records = project(getState().bundle), selected = plan.rows.filter(r => r.choice !== 'skip');
    const sop = sop1Report(plan, getState().bundle), blockedKeys = new Set(sop.blockers.map(b => b.key));
    const unresolved = blockedKeys.size;
    const filters = { all: () => true, review: r => blockedKeys.has(r.key), errors: r => r.errors.length, warnings: r => r.warnings.length, selected: r => r.choice !== 'skip' };
    const filtered = plan.rows.filter(filters[filter] || filters.all);
    page = Math.min(page, Math.max(0, Math.ceil(filtered.length / 40) - 1));
    const start = page * 40, rows = filtered.slice(start, start + 40);
    const newRows = selected.filter(r => r.choice === 'new').length, linkedRows = selected.filter(r => /^(store|row):/.test(r.choice)).length;
    const fills = selected.reduce((n, r) => n + r.fillFields.length, 0);
    let html = '<div class="csv-summary"><div><strong>' + plan.rows.length + ' 列 · 選取 ' + selected.length + ' 列 · 略過 ' + (plan.rows.length - selected.length) + ' 列 · 待處理 ' + unresolved + ' 列</strong><p>新增門市列 ' + newRows + ' · 連結列 ' + linkedRows + ' · 已選補值 ' + fills + ' 項</p></div><button id="csv-commit" class="primary" ' + (unresolved ? 'disabled' : '') + '>確認保存來源並加密匯入</button></div>';
    html += '<p class="muted">同一門市與來源清單的備註會建立新版本。選取補值只填空白欄位；既有欄位與原始 CSV 都會保留。</p><p class="muted">本批每一份原始 CSV 都會先建立唯讀 Source Snapshot；即使所有列都略過，完整原檔仍會加密保存。相同檔案可共用同一份 bytes，但每次確認提交仍保留本次來源快照。</p>';
    if (review) html += '<p class="conflict-card">待確認門市會標記「需要後續的確認」。原文仍可在客戶與拜訪紀錄查看，身分核實前不列入關聯分析。同組來源一起指定，已裁定分開的組不能指向同一間現有門市。</p>';
    html += '<section class="conflict-card" aria-live="polite"><h3>SOP1 · 匯入前整理閘門</h3><p>' + (sop.ready ? '本批已通過檢查；按確認後才寫入 App。' : '尚有待處理事項；整批不會寫入 App 或關聯圖。請切換「待核對門市」篩選。') + '</p><p>檔案原文與來源逐列保留；同店同來源重傳不新增拜訪。不同清單的完全相同文字整合顯示，來源分別留存。</p><p>備註未變 ' + (sop.counts.unchanged || 0) + ' 列 · 來源新版 ' + (sop.counts['new-version'] || 0) + ' 列 · 清單標籤行 ' + (sop.counts.metadata || 0) + ' 列</p></section>';
    html += '<label class="quality-filter">檢查篩選<select id="csv-filter">' + [['all', '全部列'], ['review', '待核對門市'], ['errors', '無法匯入的列'], ['warnings', '缺漏或提醒'], ['selected', '選取匯入的列']].map(([key, label]) => '<option value="' + key + '" ' + (filter === key ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label>';
    html += '<div class="csv-review-list">' + rows.map(row => {
      const group = row.review ? plan.reviewGroups.find(g => g.id === row.review.group) : null;
      const control = row.reviewExcluded ? '<p>依裁定排除本批；原始來源保留。</p>' : group && group.rows[0] !== row.key ? '<p>同組來源：跟隨「' + esc(group.label) + '」的整組匯入方式。</p>' : '<label>' + (group ? '這組的匯入方式' : '這列的匯入方式') + '<select data-csv-choice="' + esc(row.key) + '" aria-label="' + esc(row.data.name) + '的匯入方式">' + targets(row, records) + '</select></label>';
      const changes = profileChanges({ ...row, choice: csvTargetChoice(plan, row) }, records);
      const extra = (row.textFields || []).filter(f => f.kind === 'supplement');
      const manual = sop.rows.find(s => s.key === row.key)?.manual;
      const checks = '<div class="csv-sop-checks">' + sop.blockers.filter(b => b.key === row.key).map(b => '<p class="error">SOP1：' + esc(b.message) + '</p>').join('') + (extra.length ? '<details open><summary>其他文字欄 · ' + extra.length + ' 欄</summary>' + extra.map(f => '<strong>' + esc(f.header) + '</strong><pre>' + esc(f.text) + '</pre>').join('') + '</details><label class="check"><input type="checkbox" data-csv-ack="extraAccepted" data-row="' + row.key + '" ' + (row.sop1.extraAccepted ? 'checked' : '') + '>已核對，保留為來源補充文字；不自動推論成拜訪或人物關係</label>' : '') + (manual ? '<label class="check"><input type="checkbox" data-csv-ack="manualAccepted" data-row="' + row.key + '" ' + (row.sop1.manualAccepted ? 'checked' : '') + '>保留 App 手動文字，另存 CSV 新版供後續核對</label>' : '') + '</div>';
      const fillHTML = changes.map(change => '<div class="csv-change"><strong>' + esc(change.label) + '</strong><p>既有：' + esc(change.previous || '未提供') + '</p><p>CSV：' + esc(change.incoming) + '</p>' + (change.fillable ? '<label class="check"><input type="checkbox" data-csv-fill="' + esc(row.key) + '" value="' + change.field + '" ' + (row.fillFields.includes(change.field) ? 'checked' : '') + '>確認補上這個空白欄位</label>' : '<small>已有資料，保留既有值</small>') + '</div>').join('');
      return checks + '<article class="panel csv-review-row"><div class="section-row"><div><small>' + esc(plan.files[row.fileIndex].file) + ' · 第 ' + row.line + ' 行</small><h3>' + esc(row.data.name || '缺少門市名稱') + '</h3><p>' + esc(row.data.address || '地址未提供') + '</p></div><span class="pill ' + (row.errors.length || row.choice === 'review' ? 'warn' : '') + '">' + (row.errors.length ? '此列需修正或略過' : row.choice === 'review' ? '待核對門市' : row.choice === 'skip' ? '略過' : '已選取') + '</span></div><div class="csv-review-columns"><div><details><summary>備註原文：' + esc(row.note ? row.note.slice(0, 90) + (row.note.length > 90 ? '…' : '') : row.noteProvided ? '空白' : '未對應') + '</summary><pre>' + esc(row.note) + '</pre></details><p class="muted">拜訪日期：' + esc(row.date || '原始日期未提供') + '</p><p>' + esc(row.reason) + '</p>' + row.errors.map(e => '<p class="error">' + esc(e) + '</p>').join('') + (row.warnings.length ? '<details class="csv-warnings"><summary>' + row.warnings.length + ' 項缺漏或提醒</summary>' + row.warnings.map(w => '<p>' + esc(w) + '</p>').join('') + '</details>' : '') + noteChanges(row, records) + '</div><div>' + control + (row.candidates.length ? '<details><summary>查看 ' + row.candidates.length + ' 個門市比對線索</summary>' + row.candidates.slice(0, 12).map(c => '<div class="csv-candidate"><strong>' + esc(c.data.name) + '</strong><p>' + esc(c.data.address || '地址未提供') + '</p><small>' + c.reasons.map(esc).join('；') + (c.data.deleted || c.data.conflict ? '；此門市已刪除或有衝突，不能直接連結' : '') + '</small></div>').join('') + (row.candidates.length > 12 ? '<p class="muted">先顯示 12 個線索，可在匯入方式清單核對其他門市。</p>' : '') + '</details>' : '') + '</div></div>' + (changes.length ? '<details class="csv-profile-changes"><summary>門市欄位差異與可補值 · ' + changes.length + ' 項' + (row.fillFields.length ? '（已選 ' + row.fillFields.length + '）' : '') + '</summary>' + fillHTML + '</details>' : '') + '</article>';
    }).join('') + '</div>';
    if (!rows.length) html += '<p class="empty">沒有符合此篩選的列。</p>';
    html += '<div class="section-row csv-pagination"><button id="csv-prev" ' + (!page ? 'disabled' : '') + '>上一頁</button><span>' + (page + 1) + ' / ' + Math.max(1, Math.ceil(filtered.length / 40)) + ' 頁 · 符合篩選 ' + filtered.length + ' 列</span><button id="csv-next" ' + (start + 40 >= filtered.length ? 'disabled' : '') + '>下一頁</button></div>';
    find('#csv-preview').innerHTML = html;
  }

  async function readFiles(selected) {
    if (!selected.length) return;
    const active = ++generation; files = []; plan = null; review = null; page = 0; find('#csv-result').textContent = ''; find('#csv-file-settings').replaceChildren(); preview();
    if (selected.length > 10 || selected.some(f => f.size > CSV_LIMIT) || selected.reduce((n, f) => n + f.size, 0) > 5 * 1024 * 1024) throw new Error('最多 10 個 CSV；每個上限 2 MB，合計 5 MB。');
    for (const f of selected) {
      const bytes = new Uint8Array(await f.arrayBuffer()); if (active !== generation || !getState()) return;
      try { files.push(await prepareCSV(f.name, bytes)); }
      catch (e) { files.push({ file: f.name, bytes, encoding: 'auto', error: e.message }); }
    }
    if (active === generation && getState()) { fileSettings(); preview(); }
  }
  async function readReview(file) {
    const active = ++generation; files = []; plan = null; review = null; page = 0;
    find('#csv-file-settings').replaceChildren(); find('#csv-result').textContent = ''; preview();
    if (file.size > REVIEW_LIMIT) throw new Error('已核對資料包上限8 MB。');
    const parsed = await prepareReviewedCSV(await file.text());
    if (active !== generation || !getState()) return;
    const compared = await planReviewedCSV(parsed, getState().bundle);
    if (active !== generation || !getState()) return;
    review = parsed; files = parsed.files; plan = compared; fileSettings(); preview();
  }
  async function reparse(i, encoding, delimiter) {
    const old = files[i], active = generation;
    try { const parsed = await prepareCSV(old.file, old.bytes, encoding, delimiter); if (active !== generation || !getState()) return; files[i] = { ...parsed, requestedDelimiter: delimiter }; }
    catch (e) { if (active !== generation || !getState()) return; files[i] = { ...old, encoding, requestedDelimiter: delimiter, error: e.message }; }
    plan = null; fileSettings(); preview();
  }
  host.addEventListener('change', event => {
    const el = event.target;
    if (!getState()) return;
    if (el.id === 'csv-files') { const selected = [...el.files]; el.value = ''; return run(() => readFiles(selected), 'csv-error'); }
    if (el.id === 'csv-review-file') { const file = el.files[0]; el.value = ''; if (file) return run(() => readReview(file), 'csv-error'); }
    if (el.dataset.csvEncoding !== undefined) { const i = +el.dataset.csvEncoding; return run(() => reparse(i, el.value, files[i].requestedDelimiter || 'auto'), 'csv-error'); }
    if (el.dataset.csvDelimiter !== undefined) { const i = +el.dataset.csvDelimiter; return run(() => reparse(i, files[i].encoding, el.value), 'csv-error'); }
    if (el.dataset.csvField) { files[+el.dataset.file].mapping[el.dataset.csvField] = +el.value; plan = null; preview(); }
    if (el.dataset.csvList !== undefined) { files[+el.dataset.csvList].list = normalizeListName(el.value); el.value = files[+el.dataset.csvList].list; plan = null; preview(); }
    if (el.dataset.csvChannel !== undefined) { files[+el.dataset.csvChannel].channel = el.value; plan = null; preview(); }
    if (el.id === 'csv-filter') { filter = el.value; page = 0; preview(); return; }
    if (el.dataset.csvAck) { const row = plan?.rows.find(r => r.key === el.dataset.row); if (row && ['extraAccepted', 'manualAccepted'].includes(el.dataset.csvAck)) row.sop1[el.dataset.csvAck] = !!el.checked; preview(); return; }
    if (el.dataset.csvFill) { const row = plan.rows.find(r => r.key === el.dataset.csvFill); row.fillFields = row.fillFields.filter(field => field !== el.value); if (el.checked) row.fillFields.push(el.value); preview(); return; }
    if (el.dataset.csvChoice) { const row = plan.rows.find(r => r.key === el.dataset.csvChoice); if (row.review) setReviewedGroupChoice(plan, row.review.group, el.value); else { row.choice = el.value; row.fillFields = []; row.sop1.manualAccepted = false; } preview(); }
  });
  host.addEventListener('click', event => {
    const b = event.target.closest('button'); if (!b || !getState()) return;
    if (b.dataset.csvSourceSnapshot) { const snapshot = project(getState().bundle).find(r => r.type === 'source' && r.id === b.dataset.csvSourceSnapshot); if (!snapshot) return notify('找不到這份原始 CSV Source Snapshot。'); if (!downloadSource) return notify('此介面尚未支援下載原始來源。'); return downloadSource(snapshot.blob, snapshot.file); }
    if (b.id === 'csv-choose') return find('#csv-files').click();
    if (b.id === 'csv-review-choose') return find('#csv-review-file').click();
    if (b.id === 'csv-export-preview') return run(async () => { if (!plan) throw new Error('請先產生匯入預覽。'); if (!exportReport) throw new Error('此介面尚未支援匯出核對結果。'); exportReport(exportCSVPreview(plan, getState().bundle)); }, 'csv-error');
    if (b.id === 'csv-cancel') { reset(); notify('已取消未完成的匯入；已保存的客戶資料不受影響。'); return; }
    if (b.id === 'csv-preview-button') return run(async () => { if (files.some(f => f.error)) throw new Error('請先解決檔案的編碼或格式問題。'); const active = generation, bundle = getState().bundle; plan = null; preview(); const parsed = review ? await planReviewedCSV(review, bundle) : await planCSV(files, bundle); if (active !== generation || !getState()) return; plan = parsed; page = 0; preview(); }, 'csv-error');
    if (b.id === 'csv-prev') { page = Math.max(0, page - 1); preview(); }
    if (b.id === 'csv-next') { page = Math.min(Math.ceil(plan.rows.length / 40) - 1, page + 1); preview(); }
    if (b.id === 'csv-commit') return run(async () => {
      if (!plan) throw new Error('請先產生匯入預覽。');
      const state = getState(), result = buildCSVImport(plan, state.bundle, state.device);
      if (!confirm(`確認保存 ${result.summary.sourceSnapshots} 份原始 CSV Source Snapshot，並匯入 ${result.summary.rows} 列？\n新增 ${result.summary.stores} 間門市、${result.summary.notes} 筆備註；更新 ${result.summary.updatedNotes} 筆版本。\n補上 ${result.summary.filledFields} 個空白欄位。\n原始 CSV 完整 bytes 不會被分析結果回寫；Google 缺少備註時保留舊文。`)) return;
      await saveBundle(result.bundle);
      const s = result.summary; reset(); find('#csv-result').textContent = `完成：已保存 ${s.sourceSnapshots} 份原始 CSV Source Snapshot；新增 ${s.stores} 間門市，連結 ${s.linked} 間現有門市，新增 ${s.notes} 筆備註，更新 ${s.updatedNotes} 筆版本，補上 ${s.filledFields} 個空白欄位；${s.missingNotes} 筆最新匯出缺少備註但舊文已保留，${s.restoredNotes} 筆重新出現，${s.unchangedNotes} 筆未變，${s.skipped} 列略過。已加密儲存於本機，Mac 可連線時會交換。`;
      notify('CSV 已加密匯入，可到客戶門市與拜訪紀錄查看。');
    }, 'csv-error');
  });
  shell(); return { reset, hasPending: () => files.length > 0 };
}
