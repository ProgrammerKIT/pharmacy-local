import { FIELD_NAMES, prepareCSV, planCSV, buildCSVImport, normalizeListName, CSV_LIMIT, profileChanges, csvStream, sop1Report, REVIEW_LIMIT, prepareReviewedCSV, planReviewedCSV, setReviewedGroupChoice, csvTargetChoice, csvSupplementChoices, exportCSVPreview, csvExclusionList } from './csv.js';
import { project } from './core.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function createCSVImport({ host, getState, run, saveBundle, getSaveContext, notify, exportReport, downloadSource, openDialog, onDialogClose }) {
  let files = [], plan = null, page = 0, generation = 0, filter = 'all', review = null, mode = 'new-only', finalReview = null, finalApplying = false;
  const previousChoices = new Map();
  const find = s => host.querySelector(s);
  function closeFinalReview() {
    if (finalApplying) return;
    finalReview = null;
    const dialog = find('#csv-final-review');
    if (dialog?.open) dialog.close();
    onDialogClose?.();
  }
  function choicesStamp() {
    return JSON.stringify({ mode, generation, rows: plan?.rows.map(row => [row.key, row.choice, row.data, row.note, row.date, row.line, row.fillFields, row.supplementColumns, row.sop1]), revoke: plan?.revokeExclusionIds || [], files: files.map(file => [file.blob, file.mapping, file.list, file.channel]) });
  }
  function exclusionListHTML(items, selected = []) {
    return items.map(item => '<article class="panel"><strong>' + esc(item.name) + '</strong><p>' + esc(item.address || '地址未提供') + '</p><p class="muted">' + esc(item.file) + ' · 第 ' + item.line + ' 行</p><label class="check"><input type="checkbox" data-csv-revoke="' + esc(item.id) + '" ' + (selected.includes(item.id) ? 'checked' : '') + '>撤銷這筆記住排除（確認後生效）</label></article>').join('');
  }
  function shell() {
    closeFinalReview();
    const snapshots = getState() ? project(getState().bundle).filter(r => r.type === 'source').sort((a, b) => (b.heads?.[0]?.at || '').localeCompare(a.heads?.[0]?.at || '')) : [];
    const saved = snapshots.length ? '<article class="panel"><div class="section-row"><div><h3>已保存原始 CSV · ' + snapshots.length + ' 份</h3><p class="muted">Source Snapshot 只新增、不由分析或門市整理改寫。以下顯示最近 20 份；相同 SHA 可共用同一份檔案 bytes。</p></div></div>' + snapshots.slice(0, 20).map(s => '<div class="section-row"><div><strong>' + esc(s.file) + '</strong><p class="muted">' + esc(s.list || '未命名清單') + ' · ' + s.rows + ' 列 · SHA-256 ' + esc(s.blob.slice(0, 12)) + '…</p></div><button class="text-button" data-csv-source-snapshot="' + esc(s.id) + '">下載原始 CSV</button></div>').join('') + '</article>' : '<article class="panel"><h3>已保存原始 CSV · 0 份</h3><p class="muted">第一次確認提交 CSV 後，完整原檔會以 Source Snapshot 加密保存在資料庫。</p></article>';
    host.innerHTML = `<div class="section-row"><div><h2>從 Google Maps CSV 匯入</h2><p class="muted">在這台裝置讀取、預覽並加密儲存。原始 CSV 不會送到外部服務。</p></div><button id="csv-choose" class="primary">選取 CSV 檔案</button><button id="csv-review-choose" ${mode === 'new-only' ? 'disabled' : ''}>載入已核對資料包</button></div><input id="csv-files" type="file" accept=".csv,text/csv" multiple hidden><input id="csv-review-file" type="file" accept=".pharmareview,application/json" hidden><article class="panel"><label>匯入模式<select id="csv-import-mode"><option value="new-only" ${mode === 'new-only' ? 'selected' : ''}>只新增新門市（預設）</option><option value="standard" ${mode === 'standard' ? 'selected' : ''}>一般匯入／補選既有資料</option></select></label><p id="csv-mode-help" class="muted">${mode === 'new-only' ? '既有店自動略過；有疑慮的留待核對。新店候選預設不勾，由你選擇要新增的店；既有文字與歷史不更新。' : '一般模式可連結既有店、補空白及更新來源版本，須逐列核對；已核對資料包也使用此模式。'}</p></article><div class="csv-intro"><p>① 選取檔案　② 核對欄位　③ 勾選要納入的列與額外欄位　④ 確認後保存來源並加密匯入</p><p class="muted">可多檔選取，每個 2 MB、合計 5 MB，每批最多 1,500 列。建議在 Mac 操作。請先匯出加密備份；Mac 與 iPhone 都更新到支援 Source Snapshot 的版本後再提交新批次。</p></div>${saved}<div id="csv-exclusions"></div><div id="csv-file-settings"></div><p id="csv-error" class="error" role="alert"></p><div id="csv-preview"></div><div id="csv-result" class="result" role="status"></div><dialog id="csv-final-review" aria-labelledby="csv-final-title"></dialog>`;
    const remembered = getState() ? csvExclusionList(getState().bundle) : [];
    find('#csv-exclusions').innerHTML = '<details class="panel"><summary>管理記住排除的地點 · ' + remembered.length + ' 筆</summary><p class="muted">未勾新增不會記住排除；只有明確選擇才會保存。可在此撤銷，完成後重新預覽才可選取新增。</p>' + (remembered.length ? '<p class="muted">如需撤銷，先在「只新增新門市」模式選取 CSV 並產生預覽，再到下方「管理記住排除」勾選撤銷。</p>' + remembered.map(item => '<p><strong>' + esc(item.name) + '</strong> · ' + esc(item.address || '地址未提供') + '<br><small>' + esc(item.file) + ' · 第 ' + item.line + ' 行</small></p>').join('') : '<p class="muted">目前沒有記住排除的地點。</p>') + '</details>';
    const dialog = find('#csv-final-review');
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeFinalReview(); });
    dialog.addEventListener('close', () => { if (!dialog.open && !finalApplying && finalReview?.dialog === dialog) finalReview = null; onDialogClose?.(); });
  }
  function reset() { generation++; files = []; plan = null; review = null; page = 0; filter = 'all'; mode = 'new-only'; previousChoices.clear(); shell(); }
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
    if (plan.mode === 'new-only') return previewNewOnly();
    const records = project(getState().bundle), selected = plan.rows.filter(r => r.choice !== 'skip');
    const sop = sop1Report(plan, getState().bundle), blockedKeys = new Set(sop.blockers.map(b => b.key));
    const unresolved = blockedKeys.size;
    const filters = { all: () => true, review: r => blockedKeys.has(r.key), errors: r => r.errors.length, warnings: r => r.warnings.length, pending: r => r.choice !== 'skip' && (csvSupplementChoices(plan, r, records).some(f => !f.included) || profileChanges({ ...r, choice: csvTargetChoice(plan, r) }, records).some(f => f.fillable)), selected: r => r.choice !== 'skip' };
    const filtered = plan.rows.filter(filters[filter] || filters.all);
    page = Math.min(page, Math.max(0, Math.ceil(filtered.length / 40) - 1));
    const start = page * 40, rows = filtered.slice(start, start + 40);
    const newRows = selected.filter(r => r.choice === 'new').length, linkedRows = selected.filter(r => /^(store|row):/.test(r.choice)).length;
    const fills = selected.reduce((n, r) => n + r.fillFields.length, 0), supplements = selected.reduce((n, r) => n + (r.supplementColumns?.length || 0), 0), merges = (plan.reviewGroups || []).filter(g => g.merge);
    const mergedStores = merges.reduce((n, g) => n + g.merge.merged.length, 0), movedVisits = merges.reduce((n, g) => n + g.merge.movedVisits, 0);
    let html = '<div class="csv-summary"><div><strong>' + plan.rows.length + ' 列 · 選取 ' + selected.length + ' 列 · 略過 ' + (plan.rows.length - selected.length) + ' 列 · 待處理 ' + unresolved + ' 列</strong><p>新增門市列 ' + newRows + ' · 連結列 ' + linkedRows + ' · 已選補值 ' + fills + ' 項 · 已選來源補充 ' + supplements + ' 項' + (merges.length ? ' · 依裁定整併 ' + mergedStores + ' 間既有門市、搬移 ' + movedVisits + ' 筆既有拜訪' : '') + '</p></div><button id="csv-commit" class="primary" ' + (unresolved ? 'disabled' : '') + '>確認保存來源並加密匯入</button></div>';
    html += '<p class="muted">先確認這列的門市，再勾選尚未納入的額外欄位。已對應的門市資料與備註依下方預覽匯入；取消整列勾選即可不納入這列。補值只填空白，額外欄位存為來源補充，不自動建立人物、關係或待辦。</p><p class="muted">本批每一份原始 CSV 都會先建立唯讀 Source Snapshot；即使所有列都略過，完整原檔仍會加密保存。相同檔案可共用同一份 bytes，但每次確認提交仍保留本次來源快照。</p>';
    if (review) html += '<p class="conflict-card">待確認門市會標記「需要後續的確認」。原文仍可在客戶與拜訪紀錄查看，身分核實前不列入關聯分析。同組來源一起指定，已裁定分開的組不能指向同一間現有門市。</p>';
    html += '<section class="conflict-card" aria-live="polite"><h3>SOP1 · 匯入前整理閘門</h3><p>' + (sop.ready ? '本批已通過檢查；按確認後才寫入 App。' : '尚有待處理事項；整批不會寫入 App 或關聯圖。請切換「待核對門市」篩選。') + '</p><p>檔案原文與來源逐列保留；同店同來源重傳不新增拜訪。不同清單的完全相同文字整合顯示，來源分別留存。</p><p>備註未變 ' + (sop.counts.unchanged || 0) + ' 列 · 來源新版 ' + (sop.counts['new-version'] || 0) + ' 列 · 清單標籤行 ' + (sop.counts.metadata || 0) + ' 列</p></section>';
    html += '<label class="quality-filter">檢查篩選<select id="csv-filter">' + [['all', '全部列'], ['pending', '尚有可選欄位的列'], ['review', '待核對門市'], ['errors', '無法匯入的列'], ['warnings', '缺漏或提醒'], ['selected', '選取匯入的列']].map(([key, label]) => '<option value="' + key + '" ' + (filter === key ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label>';
    html += '<div class="csv-review-list">' + rows.map(row => {
      const group = row.review ? plan.reviewGroups.find(g => g.id === row.review.group) : null;
      const mergeText = group?.merge ? '<div class="conflict-card"><strong>依已裁定同店規則整併</strong><p>' + group.merge.merged.map(s => esc(s.name)).join('、') + ' → ' + esc(group.merge.keeperName) + '</p><p>將搬移 ' + group.merge.movedVisits + ' 筆既有拜訪；被整併門市移到回收桶，原版本、附件與來源歷史仍保留。</p></div>' : '';
      const control = row.reviewExcluded ? '<p>依裁定排除本批；原始來源保留。</p>' : group && group.rows[0] !== row.key ? '<p>同組來源：跟隨「' + esc(group.label) + '」的整組匯入方式。</p>' : group?.merge ? mergeText : group?.mergeBlocked ? '<div class="conflict-card"><p class="error">同店裁定目前不能安全整併：' + esc(group.mergeBlocked) + '</p><p>不能用手動改指門市繞過；請取消本批並先處理衝突。</p></div>' : '<label>' + (group ? '這組的匯入方式' : '這列的匯入方式') + '<select data-csv-choice="' + esc(row.key) + '" aria-label="' + esc(row.data.name) + '的匯入方式">' + targets(row, records) + '</select></label>';
      const changes = profileChanges({ ...row, choice: csvTargetChoice(plan, row) }, records);
      const extras = csvSupplementChoices(plan, row, records), available = extras.filter(f => !f.included), included = extras.filter(f => f.included);
      const rowReport = sop.rows.find(s => s.key === row.key), manual = rowReport?.manual;
      const inactive = row.choice === 'skip' || row.choice === 'review' || row.reviewExcluded;
      const extraHTML = available.length ? '<details class="csv-extra-choices" open><summary>尚未納入的其他文字欄 · ' + available.length + ' 欄</summary><p class="muted">勾選後會加入此門市的來源補充。未勾選只保存於完整原始 CSV；不會刪除以前已採用的內容。</p>' + available.map(f => '<div class="csv-change"><label class="check"><input type="checkbox" data-csv-supplement="' + row.key + '" value="' + f.column + '" ' + ((row.supplementColumns || []).includes(f.column) ? 'checked ' : '') + (inactive ? 'disabled ' : '') + '>納入第 ' + (f.column + 1) + ' 欄 · ' + esc(f.header || '無欄名') + '</label><pre>' + esc(f.text) + '</pre></div>').join('') + '<label class="check"><input type="checkbox" data-csv-ack="extraAccepted" data-row="' + row.key + '" ' + (row.sop1.extraAccepted ? 'checked ' : '') + (inactive ? 'disabled ' : '') + '>已核對勾選結果；未勾選的欄位本次不採用，只保留原始來源</label></details>' : '';
      const includedHTML = included.length ? '<details><summary>已納入的來源補充 · ' + included.length + ' 欄（保留）</summary>' + included.map(f => '<strong>第 ' + (f.column + 1) + ' 欄 · ' + esc(f.header || '無欄名') + '</strong><pre>' + esc(f.text) + '</pre>').join('') + '</details>' : '';
      const checks = '<div class="csv-sop-checks">' + sop.blockers.filter(b => b.key === row.key).map(b => '<p class="error">SOP1：' + esc(b.message) + '</p>').join('') + extraHTML + includedHTML + (manual ? '<label class="check"><input type="checkbox" data-csv-ack="manualAccepted" data-row="' + row.key + '" ' + (row.sop1.manualAccepted ? 'checked' : '') + '>保留 App 手動文字，另存 CSV 新版供後續核對</label>' : '') + '</div>';
      const includeControl = !row.reviewExcluded && (!group || (group.rows[0] === row.key && !group.merge && !group.mergeBlocked)) ? '<label class="check"><input type="checkbox" data-csv-include="' + row.key + '" ' + (row.choice !== 'skip' ? 'checked' : '') + '>' + (group ? '納入這組資料（原始檔一律保留）' : '納入這列資料（原始檔一律保留）') + '</label>' : '';
      const fillHTML = changes.map(change => '<div class="csv-change"><strong>' + esc(change.label) + '</strong><p>既有：' + esc(change.previous || '未提供') + '</p><p>CSV：' + esc(change.incoming) + '</p>' + (change.fillable ? '<label class="check"><input type="checkbox" data-csv-fill="' + esc(row.key) + '" value="' + change.field + '" ' + (row.fillFields.includes(change.field) ? 'checked ' : '') + (inactive ? 'disabled ' : '') + '>確認補上這個空白欄位</label>' : '<small>已有資料，保留既有值</small>') + '</div>').join('');
      return '<article class="panel csv-review-row"><div class="section-row"><div><small>' + esc(plan.files[row.fileIndex].file) + ' · 第 ' + row.line + ' 行</small><h3>' + esc(row.data.name || '缺少門市名稱') + '</h3><p>' + esc(row.data.address || '地址未提供') + '</p></div><span class="pill ' + (row.errors.length || row.choice === 'review' ? 'warn' : '') + '">' + (row.errors.length ? '此列需修正或略過' : row.choice === 'review' ? '待核對門市' : row.choice === 'skip' ? '略過' : '已選取') + '</span></div><div class="csv-review-columns"><div><details><summary>備註原文：' + esc(row.note ? row.note.slice(0, 90) + (row.note.length > 90 ? '…' : '') : row.noteProvided ? '空白' : '未對應') + '</summary><pre>' + esc(row.note) + '</pre></details><p class="muted">拜訪日期：' + esc(row.date || '原始日期未提供') + '</p><p>' + esc(row.reason) + '</p>' + row.errors.map(e => '<p class="error">' + esc(e) + '</p>').join('') + (row.warnings.length ? '<details class="csv-warnings"><summary>' + row.warnings.length + ' 項缺漏或提醒</summary>' + row.warnings.map(w => '<p>' + esc(w) + '</p>').join('') + '</details>' : '') + (rowReport?.kind === 'supplement-only' ? '<p class="muted">此原始列已匯入；此次只補選欄位，備註不重套、不回滾目前版本。</p>' : noteChanges(row, records)) + '</div><div>' + includeControl + control + (row.candidates.length ? '<details><summary>查看 ' + row.candidates.length + ' 個門市比對線索</summary>' + row.candidates.slice(0, 12).map(c => '<div class="csv-candidate"><strong>' + esc(c.data.name) + '</strong><p>' + esc(c.data.address || '地址未提供') + '</p><small>' + c.reasons.map(esc).join('；') + (c.data.deleted || c.data.conflict ? '；此門市已刪除或有衝突，不能直接連結' : '') + '</small></div>').join('') + (row.candidates.length > 12 ? '<p class="muted">先顯示 12 個線索，可在匯入方式清單核對其他門市。</p>' : '') + '</details>' : '') + '</div></div>' + (changes.length ? '<details class="csv-profile-changes" open><summary>門市欄位差異與可補值 · ' + changes.length + ' 項' + (row.fillFields.length ? '（已選 ' + row.fillFields.length + '）' : '') + '</summary>' + fillHTML + '</details>' : '') + checks + '</article>';
    }).join('') + '</div>';
    if (!rows.length) html += '<p class="empty">沒有符合此篩選的列。</p>';
    html += '<div class="section-row csv-pagination"><button id="csv-prev" ' + (!page ? 'disabled' : '') + '>上一頁</button><span>' + (page + 1) + ' / ' + Math.max(1, Math.ceil(filtered.length / 40)) + ' 頁 · 符合篩選 ' + filtered.length + ' 列</span><button id="csv-next" ' + (start + 40 >= filtered.length ? 'disabled' : '') + '>下一頁</button></div>';
    find('#csv-preview').innerHTML = html;
  }

  function previewNewOnly() {
    const state = getState(), records = project(state.bundle), report = sop1Report(plan, state.bundle);
    const status = row => row.newStoreOnly?.status || 'review';
    const count = kind => plan.rows.filter(row => status(row) === kind).length;
    const selected = plan.rows.filter(row => row.choice === 'new'), excluded = plan.rows.filter(row => row.choice === 'exclude'), supplements = selected.reduce((n, row) => n + (row.supplementColumns?.length || 0), 0);
    const filters = { all: () => true, new: row => status(row) === 'new', existing: row => status(row) === 'existing', remembered: row => status(row) === 'remembered', review: row => status(row) === 'review', other: row => ['duplicate', 'excluded'].includes(status(row)), selected: row => row.choice === 'new' };
    const filtered = plan.rows.filter(filters[filter] || filters.new);
    page = Math.min(page, Math.max(0, Math.ceil(filtered.length / 40) - 1));
    const start = page * 40, rows = filtered.slice(start, start + 40);
    const labels = { new: '新門市候選', existing: '既有門市 · 自動略過', review: '待核對 · 本次不納入', duplicate: '本批重複 · 略過', remembered: '已記住排除 · 略過', excluded: '非門市資料／排除 · 略過' };
    let html = '<div class="csv-summary"><div><strong>只新增新門市</strong><p>新門市候選 ' + count('new') + ' 列 · 已選新增 ' + selected.length + ' 間 · 已選新店補充 ' + supplements + ' 項 · 待記住排除 ' + excluded.length + ' 列</p><p>已記住排除 ' + count('remembered') + ' 列（預設隱藏） · 既有自動略過 ' + count('existing') + ' 列 · 待核對 ' + count('review') + ' 列 · 重複／排除 ' + (count('duplicate') + count('excluded')) + ' 列</p></div><button id="csv-commit" class="primary" ' + (report.ready ? '' : 'disabled') + '>下一步：逐店核對完整清單</button></div>';
    html += '<p class="muted">新店候選預設不勾，請核對店名、地址與地圖網址再選取。比對只依這台 App 已載入的資料，候選不代表已證實是全新店家。</p><p class="muted">既有店不補欄、不更新文字或歷史；待核對及本批重複列不納入。完整原始 CSV 一律保存，包含未勾選及略過的列。全部不勾只保存原始來源，不會自動記住排除。</p>';
    if (report.blockers.length) html += '<div class="conflict-card" role="alert">' + report.blockers.map(item => '<p class="error">' + esc(item.message) + '</p>').join('') + '</div>';
    html += '<details class="panel" id="csv-exclusion-manager"><summary>管理記住排除 · ' + (plan.exclusions?.length || 0) + ' 筆（待撤銷 ' + (plan.revokeExclusionIds?.length || 0) + ' 筆）</summary><p class="muted">撤銷要在最後核對後才保存。完成後重新預覽，地點才會回到一般比對；本次不會順便新增。</p>' + (plan.exclusions?.length ? exclusionListHTML(plan.exclusions, plan.revokeExclusionIds || []) : '<p>目前沒有記住排除的地點。</p>') + '</details>';
    html += '<label class="quality-filter">檢查篩選<select id="csv-filter">' + [['new', '可勾選的新門市候選（' + count('new') + '）'], ['selected', '已勾選新增（' + selected.length + '）'], ['remembered', '已記住排除（' + count('remembered') + '）'], ['existing', '既有門市 · 自動略過（' + count('existing') + '）'], ['review', '待核對 · 本次不納入（' + count('review') + '）'], ['other', '本批重複／排除'], ['all', '全部列']].map(([value, text]) => '<option value="' + value + '" ' + (filter === value ? 'selected' : '') + '>' + text + '</option>').join('') + '</select></label>';
    html += '<div class="csv-review-list">' + rows.map(row => {
      const kind = status(row), isNew = kind === 'new', active = row.choice === 'new', file = plan.files[row.fileIndex], raw = file.rows[row.rowIndex];
      const extras = isNew && active ? csvSupplementChoices(plan, row, records).filter(field => !field.included) : [];
      const extraHTML = extras.length ? '<details class="csv-extra-choices" open><summary>新店的其他文字欄 · ' + extras.length + ' 欄</summary><p class="muted">勾選加入新店來源補充；未勾選只保留完整原始欄位，不自動建立人物、關係或待辦。</p>' + extras.map(field => '<div class="csv-change"><label class="check"><input type="checkbox" data-csv-supplement="' + row.key + '" value="' + field.column + '" ' + ((row.supplementColumns || []).includes(field.column) ? 'checked' : '') + '>納入第 ' + (field.column + 1) + ' 欄 · ' + esc(field.header || '無欄名') + '</label><pre>' + esc(field.text) + '</pre></div>').join('') + '<label class="check"><input type="checkbox" data-csv-ack="extraAccepted" data-row="' + row.key + '" ' + (row.sop1.extraAccepted ? 'checked' : '') + '>已核對勾選結果；未勾選的欄位只保留原始來源</label></details>' : '';
      const exclusionControl = (row.newStoreOnly?.canExclude ? '<label class="check"><input type="checkbox" data-csv-exclude="' + row.key + '" ' + (row.choice === 'exclude' ? 'checked' : '') + '>記住不匯入這個地點</label><p class="muted">明確勾選才會記住；與新增互斥。下次身分吻合時會略過，完整原始 CSV 仍保留。</p>' : isNew ? '<p class="muted">此列沒有可安全沿用的 Google 地點識別，只能本次不勾，不會記住排除。</p>' : '');
      const candidates = row.candidates?.length ? '<details><summary>查看既有／同批比對線索 · ' + row.candidates.length + ' 項</summary>' + row.candidates.slice(0, 12).map(candidate => '<p><strong>' + esc(candidate.data.name) + '</strong> · ' + esc(candidate.data.address || '地址未提供') + '<br><small>' + candidate.reasons.map(esc).join('；') + '</small></p>').join('') + '</details>' : '';
      return '<article class="panel csv-review-row" data-csv-row="' + row.key + '" data-csv-new-status="' + kind + '"><div class="section-row"><div><small>' + esc(file.file) + ' · 第 ' + row.line + ' 行</small><h3>' + esc(row.data.name || '缺少門市名稱') + '</h3></div><span class="pill ' + (kind === 'review' ? 'warn' : '') + '">' + labels[kind] + '</span></div><p>' + esc(row.newStoreOnly?.reason || row.reason) + '</p><p>地址：' + esc(row.data.address || '未提供') + '</p><p>地圖網址：' + esc(row.data.mapUrl || '未提供') + '</p>' + (isNew ? '<label class="check"><input type="checkbox" data-csv-include="' + row.key + '" ' + (active ? 'checked' : '') + '>新增這間門市</label>' + '<details><summary>新店備註原文</summary><pre>' + esc(row.note || '未提供') + '</pre></details>' : '<p class="muted">本次只保存原始來源，不建立或更新這間門市與筆記。</p>') + exclusionControl + candidates + '<details><summary>查看完整原始欄位</summary><div class="csv-raw">' + file.headers.map((header, index) => '<p><strong>第 ' + (index + 1) + ' 欄 · ' + esc(header || '無欄名') + '</strong><span>' + esc(raw.cells[index]) + '</span></p>').join('') + '</div></details>' + extraHTML + '</article>';
    }).join('') + '</div>';
    if (!rows.length) html += '<p class="empty">這個分類沒有資料。可切換篩選查看既有或待核對項目。</p>';
    html += '<div class="section-row csv-pagination"><button id="csv-prev" ' + (!page ? 'disabled' : '') + '>上一頁</button><span>' + (page + 1) + ' / ' + Math.max(1, Math.ceil(filtered.length / 40)) + ' 頁 · 符合篩選 ' + filtered.length + ' 列</span><button id="csv-next" ' + (start + 40 >= filtered.length ? 'disabled' : '') + '>下一頁</button></div>';
    find('#csv-preview').innerHTML = html;
  }

  function finalRowHTML(row) {
    const file = plan.files[row.fileIndex];
    return '<article class="panel" data-csv-final-row="' + esc(row.key) + '"><h3>' + esc(row.data.name || '缺少名稱') + '</h3><p>地址：' + esc(row.data.address || '未提供') + '</p><p>來源：' + esc(file.file) + ' · 第 ' + row.line + ' 行</p>' + (row.choice === 'new' ? '<p>新店備註 ' + (row.note ? 1 : 0) + ' 筆 · 已選來源補充 ' + (row.supplementColumns?.length || 0) + ' 項</p>' : '') + '</article>';
  }
  function openFinalReview() {
    if (!plan || plan.mode !== 'new-only') throw new Error('請先重新產生只新增新門市的預覽。');
    const state = getState(), saveContext = getSaveContext?.();
    if (!state || document.hidden) throw new Error('請回到 App 解鎖後重新預覽。');
    const result = buildCSVImport(plan, state.bundle, state.device);
    const selected = plan.rows.filter(row => row.choice === 'new'), excluded = plan.rows.filter(row => row.choice === 'exclude');
    const revoked = (plan.exclusions || []).filter(item => (plan.revokeExclusionIds || []).includes(item.id));
    const s = result.summary, dialog = find('#csv-final-review');
    finalReview = { dialog, state, bundle: state.bundle, device: state.device, token: state.token, plan, stamp: choicesStamp(), saveContext, result };
    dialog.innerHTML = '<div class="section-row"><h2 id="csv-final-title" tabindex="-1" data-dialog-focus>最後核對 · 尚未寫入</h2><button id="csv-final-back">返回編輯</button></div><p>請逐店確認以下清單，按最下方確認按鈕後才會保存。</p><p><strong>新增 ' + selected.length + ' 間門市 · ' + s.notes + ' 筆新店備註 · ' + s.adoptedSupplements + ' 項新店來源補充</strong></p><section aria-label="這次新增的門市"><h3>這次新增的門市</h3>' + (selected.length ? selected.map(finalRowHTML).join('') : '<p>沒有選取新增門市。</p>') + '</section><section aria-label="這次記住排除"><h3>這次記住排除 · 選取 ' + excluded.length + ' 列／記住 ' + s.excludedPlaces + ' 個地點</h3>' + (excluded.length ? excluded.map(finalRowHTML).join('') : '<p>沒有新增記住排除；單純未勾選的列不會記住。</p>') + '</section><section aria-label="這次撤銷排除"><h3>這次撤銷排除 · ' + revoked.length + ' 筆</h3>' + (revoked.length ? revoked.map(item => '<article class="panel" data-csv-final-revoke="' + esc(item.id) + '"><h3>' + esc(item.name) + '</h3><p>地址：' + esc(item.address || '未提供') + '</p><p>原來源：' + esc(item.file) + ' · 第 ' + item.line + ' 行</p></article>').join('') + '<p>撤銷後請重新預覽；本次不會順便新增這些地點。</p>' : '<p>沒有撤銷排除。</p>') + '</section><p>保存 ' + s.sourceSnapshots + ' 份完整原始 CSV' + (s.auditSnapshots ? '，另保存 ' + s.auditSnapshots + ' 份排除變更稽核快照' : '') + '。原始來源包含全部未選取及略過的列。</p><p>既有門市、文字、關係及歷史更新：0。排除記憶另存並保留歷史。</p><p id="csv-final-error" class="error" role="alert"></p><div class="dialog-footer"><button id="csv-final-edit">返回編輯，不寫入</button><button id="csv-final-apply" class="primary">確認上述清單並加密保存</button></div>';
    if (openDialog) openDialog(dialog); else dialog.showModal();
  }
  function showResult(result, newOnly) {
    const s = result.summary; reset();
    find('#csv-result').textContent = newOnly ? `完成：只新增 ${s.stores} 間門市、${s.notes} 筆新店備註、${s.adoptedSupplements} 項新店來源補充；記住排除 ${s.excludedPlaces || 0} 筆、撤銷排除 ${s.revokedExclusions || 0} 筆；保存 ${s.sourceSnapshots} 份完整原始 CSV${s.auditSnapshots ? ` 與 ${s.auditSnapshots} 份排除變更稽核快照` : ''}。既有門市、文字、關係及歷史完全保留，更新 0 筆。已加密儲存於本機，Mac 可連線時會交換。` : `完成：已保存 ${s.sourceSnapshots} 份原始 CSV Source Snapshot；新增 ${s.stores} 間門市，連結 ${s.linked} 間現有門市，新增 ${s.notes} 筆備註，更新 ${s.updatedNotes} 筆版本${s.mergeGroups ? `，依裁定整併 ${s.mergedStores} 間既有門市並搬移 ${s.movedVisits} 筆既有拜訪` : ''}，補上 ${s.filledFields} 個空白欄位、納入 ${s.adoptedSupplements} 項來源補充；${s.missingNotes} 筆最新匯出缺少備註但舊文已保留，${s.restoredNotes} 筆重新出現，${s.unchangedNotes} 筆未變，${s.skipped} 列略過。已加密儲存於本機，Mac 可連線時會交換。`;
    notify('CSV 已加密保存，可到客戶門市與拜訪紀錄查看。');
  }

  async function readFiles(selected) {
    if (!selected.length) return;
    const active = ++generation; previousChoices.clear(); files = []; plan = null; review = null; page = 0; find('#csv-result').textContent = ''; find('#csv-file-settings').replaceChildren(); preview();
    if (selected.length > 10 || selected.some(f => f.size > CSV_LIMIT) || selected.reduce((n, f) => n + f.size, 0) > 5 * 1024 * 1024) throw new Error('最多 10 個 CSV；每個上限 2 MB，合計 5 MB。');
    for (const f of selected) {
      const bytes = new Uint8Array(await f.arrayBuffer()); if (active !== generation || !getState()) return;
      try { files.push(await prepareCSV(f.name, bytes)); }
      catch (e) { files.push({ file: f.name, bytes, encoding: 'auto', error: e.message }); }
    }
    if (active === generation && getState()) { fileSettings(); preview(); }
  }
  async function readReview(file) {
    if (mode !== 'standard') throw new Error('只新增新門市模式不接受已核對資料包；請選取原始 CSV。');
    const active = ++generation; previousChoices.clear(); files = []; plan = null; review = null; page = 0;
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
  function chooseTarget(row, choice) {
    if (plan.mode === 'new-only') {
      if (row.newStoreOnly?.status !== 'new' || !['skip', 'new'].includes(choice)) return;
      row.choice = choice; row.supplementColumns = []; row.fillFields = [];
      row.sop1.extraAccepted = false; row.sop1.manualAccepted = false; return;
    }
    const members = row.review ? plan.rows.filter(r => r.review?.group === row.review.group) : [row];
    if (choice === 'skip' && row.choice !== 'skip') previousChoices.set(row.key, row.choice);
    if (row.review) setReviewedGroupChoice(plan, row.review.group, choice);
    else row.choice = choice;
    for (const item of members) {
      item.fillFields = []; item.supplementColumns = [];
      item.sop1.manualAccepted = false; item.sop1.extraAccepted = false;
    }
  }
  host.addEventListener('change', event => {
    const el = event.target;
    if (!getState()) return;
    if (el.id !== 'csv-filter') { closeFinalReview(); generation++; }
    if (el.id === 'csv-import-mode') {
      if (!['new-only', 'standard'].includes(el.value)) return;
      mode = el.value; generation++; plan = null; page = 0; filter = 'all'; previousChoices.clear();
      if (review) { files = []; review = null; }
      shell(); if (files.length) fileSettings();
      notify('已切換匯入模式；請重新產生預覽，先前勾選不會沿用。'); return;
    }
    if (el.id === 'csv-files') { const selected = [...el.files]; el.value = ''; return run(() => readFiles(selected), 'csv-error'); }
    if (el.id === 'csv-review-file') { const file = el.files[0]; el.value = ''; if (file) return run(() => readReview(file), 'csv-error'); }
    if (el.dataset.csvEncoding !== undefined) { const i = +el.dataset.csvEncoding; return run(() => reparse(i, el.value, files[i].requestedDelimiter || 'auto'), 'csv-error'); }
    if (el.dataset.csvDelimiter !== undefined) { const i = +el.dataset.csvDelimiter; return run(() => reparse(i, files[i].encoding, el.value), 'csv-error'); }
    if (el.dataset.csvField) { files[+el.dataset.file].mapping[el.dataset.csvField] = +el.value; plan = null; preview(); }
    if (el.dataset.csvList !== undefined) { files[+el.dataset.csvList].list = normalizeListName(el.value); el.value = files[+el.dataset.csvList].list; plan = null; preview(); }
    if (el.dataset.csvChannel !== undefined) { files[+el.dataset.csvChannel].channel = el.value; plan = null; preview(); }
    if (el.id === 'csv-filter') { filter = el.value; page = 0; preview(); return; }
    if (el.dataset.csvExclude) {
      const row = plan?.rows.find(item => item.key === el.dataset.csvExclude);
      if (plan?.mode !== 'new-only' || !row?.newStoreOnly?.canExclude) return;
      row.choice = el.checked ? 'exclude' : 'skip'; row.supplementColumns = []; row.fillFields = []; row.sop1.extraAccepted = false; preview(); return;
    }
    if (el.dataset.csvRevoke) {
      if (plan?.mode !== 'new-only' || !plan.exclusions?.some(item => item.id === el.dataset.csvRevoke)) return;
      plan.revokeExclusionIds = (plan.revokeExclusionIds || []).filter(id => id !== el.dataset.csvRevoke);
      if (el.checked) plan.revokeExclusionIds.push(el.dataset.csvRevoke); preview(); return;
    }
    if (el.dataset.csvAck) { const row = plan?.rows.find(r => r.key === el.dataset.row); if (row && ['extraAccepted', 'manualAccepted'].includes(el.dataset.csvAck)) row.sop1[el.dataset.csvAck] = !!el.checked; preview(); return; }
    if (el.dataset.csvFill) { if (plan?.mode === 'new-only') return; const row = plan.rows.find(r => r.key === el.dataset.csvFill); row.fillFields = row.fillFields.filter(field => field !== el.value); if (el.checked) row.fillFields.push(el.value); preview(); return; }
    if (el.dataset.csvSupplement) {
      const row = plan?.rows.find(r => r.key === el.dataset.csvSupplement), column = +el.value;
      if (!row || row.choice === 'skip' || row.choice === 'review' || row.reviewExcluded) return;
      if (!csvSupplementChoices(plan, row, project(getState().bundle)).some(f => f.column === column && !f.included)) return;
      row.supplementColumns = (row.supplementColumns || []).filter(c => c !== column);
      if (el.checked) row.supplementColumns.push(column);
      row.sop1.extraAccepted = false; preview(); return;
    }
    if (el.dataset.csvInclude) {
      const row = plan?.rows.find(r => r.key === el.dataset.csvInclude);
      if (!row || row.reviewExcluded) return;
      chooseTarget(row, el.checked ? plan.mode === 'new-only' ? 'new' : previousChoices.get(row.key) || 'review' : 'skip'); preview(); return;
    }
    if (el.dataset.csvChoice) { if (plan?.mode === 'new-only') return; const row = plan.rows.find(r => r.key === el.dataset.csvChoice); chooseTarget(row, el.value); preview(); }
  });
  host.addEventListener('click', event => {
    const b = event.target.closest('button'); if (!b || !getState()) return;
    if (b.id === 'csv-final-back' || b.id === 'csv-final-edit') { closeFinalReview(); return; }
    if (b.id === 'csv-final-apply') return run(async () => {
      const ctx = finalReview, current = getState();
      if (!ctx || !find('#csv-final-review')?.open || !current || document.hidden || current !== ctx.state || current.bundle !== ctx.bundle || current.device !== ctx.device || current.token !== ctx.token || plan !== ctx.plan || choicesStamp() !== ctx.stamp) { closeFinalReview(); throw new Error('核對期間資料、工作階段或勾選已改變，請重新預覽；這批未寫入。'); }
      let result;
      try {
        result = buildCSVImport(plan, current.bundle, current.device);
        if (JSON.stringify(result.summary) !== JSON.stringify(ctx.result.summary)) throw new Error('最後核對的匯入影響已改變，請重新預覽；這批未寫入。');
      } catch (error) { closeFinalReview(); throw error; }
      finalApplying = true;
      try { await saveBundle(result.bundle, ctx.saveContext); }
      finally { finalApplying = false; closeFinalReview(); }
      showResult(result, true);
    }, 'csv-error');
    if (b.dataset?.csvSourceSnapshot) { const snapshot = project(getState().bundle).find(r => r.type === 'source' && r.id === b.dataset.csvSourceSnapshot); if (!snapshot) return notify('找不到這份原始 CSV Source Snapshot。'); if (!downloadSource) return notify('此介面尚未支援下載原始來源。'); return downloadSource(snapshot.blob, snapshot.file); }
    if (b.id === 'csv-choose') return find('#csv-files').click();
    if (b.id === 'csv-review-choose') { if (mode !== 'standard') return notify('只新增新門市模式請選取原始 CSV。'); return find('#csv-review-file').click(); }
    if (b.id === 'csv-export-preview') return run(async () => { if (!plan) throw new Error('請先預覽並確認本批來源。'); if (!exportReport) throw new Error('此介面尚未支援匯出核對結果。'); exportReport(exportCSVPreview(plan, getState().bundle)); }, 'csv-error');
    if (b.id === 'csv-cancel') { reset(); notify('已取消未完成的匯入；已保存的客戶資料不受影響。'); return; }
    if (b.id === 'csv-preview-button') return run(async () => { closeFinalReview(); generation++; if (files.some(f => f.error)) throw new Error('請先解決檔案的編碼或格式問題。'); const active = generation, bundle = getState().bundle; plan = null; preview(); const parsed = review ? await planReviewedCSV(review, bundle) : await planCSV(files, bundle, { mode }); if (active !== generation || !getState()) return; plan = parsed; previousChoices.clear(); filter = mode === 'new-only' ? 'new' : 'all'; page = 0; preview(); }, 'csv-error');
    if (b.id === 'csv-prev') { page = Math.max(0, page - 1); preview(); }
    if (b.id === 'csv-next') { page = Math.min(Math.ceil(plan.rows.length / 40) - 1, page + 1); preview(); }
    if (b.id === 'csv-commit') return run(async () => {
      if (!plan) throw new Error('請先預覽並確認本批來源。');
      if (plan.mode === 'new-only') { openFinalReview(); return; }
      const state = getState(), baseBundle = state.bundle, baseDevice = state.device, activePlan = plan;
      const saveContext = getSaveContext?.();
      const result = buildCSVImport(plan, baseBundle, baseDevice);
      if (!confirm(`確認保存 ${result.summary.sourceSnapshots} 份原始 CSV Source Snapshot，並匯入 ${result.summary.rows} 列？\n新增 ${result.summary.stores} 間門市、${result.summary.notes} 筆備註；更新 ${result.summary.updatedNotes} 筆版本。\n${result.summary.mergeGroups ? `依已裁定同店規則整併 ${result.summary.mergedStores} 間既有門市，搬移 ${result.summary.movedVisits} 筆既有拜訪；原版本與來源歷史保留。\n` : ''}補上 ${result.summary.filledFields} 個空白欄位、納入 ${result.summary.adoptedSupplements} 項來源補充。\n未勾選欄位及略過列只保留在完整原始來源；既有內容不移除。\n原始 CSV 完整 bytes 不會被分析結果回寫；Google 缺少備註時保留舊文。`)) return;
      const current = getState();
      if (!current || current.bundle !== baseBundle || current.device !== baseDevice || plan !== activePlan) throw new Error('確認期間資料或工作階段已變更，請重新預覽；這批未寫入。');
      await saveBundle(result.bundle, saveContext);
      showResult(result, false);
    }, 'csv-error');
  });
  shell(); return { reset, refresh: () => { if (!files.length) shell(); }, hasPending: () => files.length > 0 };
}
