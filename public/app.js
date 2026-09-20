import { newMeta, derive, seal, unseal, uuid, emptyBundle, revision, project, merge, validateBundle, hashBytes, b64, unb64, MAX_BYTES, openRebuiltSnapshot } from './core.js';
import { readLocal, writeLocal, archiveAndReplaceLocal, listLocalArchives, readLocalArchive } from './db.js';
import { createCSVImport } from './csv-ui.js';
import { PROFILE_FIELDS, FILL_FIELDS, scanQuality, setDistinctReview, sourceSuggestions, fillProfile } from './csv.js';
import { entityRule, evidenceKind, sourceTags, groupCSVNotes, storeIdentityPending, relationVisitAllowed, retailChannel, filterStoreDirectory } from './relations.js';
import { APP_VERSION } from './version.js';
import { startUpdates, requestLocal, diagnoseConnection } from './update-client.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const titles = { explore: '關聯探索', visits: '拜訪紀錄', stores: '客戶門市', entities: '人物與主題', csv: '匯入 CSV', quality: '資料整理', sync: '同步與備份', trash: '回收桶' };
const kinds = { store: '門市', visit: '拜訪', person: '人物', topic: '主題' };
let key = null, meta = null, payload = null, slot = null, localRevision = 0, busy = false, pendingLock = false, activeView = 'visits';
let focus = { type: 'topic', id: '' }, graphPage = 0, trail = [], records = [], editorContext = null, toastTimer, autoTimer, objectURLs = [];
let lastError = '', offlineReady = false, storagePersistent = false, autoFetching = false, gateOpening = false;
let qualityTab = 'duplicates', qualityField = '', qualityPage = 0, qualityCache = null, qualityReview = null;
let storeFilters = { query: '', district: '', kind: '', groups: [] };
let updateHolding = false, macProgram = null, lastSyncFailure = null, syncWarning = '';
let draftTimer = null, draftSaveChain = Promise.resolve();
const csvImport = createCSVImport({ host: $('csv-view'), getState: () => payload, run, saveBundle: async bundle => { await persist({ ...payload, bundle, dirty: true }); render(); }, notify: toast, exportReport: report => download(JSON.stringify({ ...report, appVersion: APP_VERSION }, null, 2), 'pharmacy-import-preview.json', 'application/json'), downloadSource: (blob, filename) => { if (!confirm('原始 CSV 是明文檔案。請確認下載到自己的本機資料夾，避開 iCloud Drive。')) return; download(unb64(payload.bundle.blobs[blob]), filename.replace(/[\/\\]/g, '_'), 'application/octet-stream'); } });
const all = type => records.filter(r => r.type === type && (!r.deleted || r.conflict));
const by = (type, id) => records.find(r => r.type === type && r.id === id);
const name = (type, id) => by(type, id)?.name || (type === 'store' ? '已刪除／未命名門市' : '已刪除節點');
const dateText = at => at ? new Date(at).toLocaleString('zh-TW', { hour12: false }) : '尚未同步';
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 6500); }
function buttons(disabled) {
  document.querySelectorAll('button, #csv-view input, #csv-view select').forEach(el => {
    if (el.dataset.close) return;
    if (disabled) { el.dataset.busyDisabled = el.disabled ? '1' : '0'; el.disabled = true; }
    else if (el.dataset.busyDisabled !== undefined) { el.disabled = el.dataset.busyDisabled === '1'; delete el.dataset.busyDisabled; }
  });
}
async function run(fn, errorTarget) {
  if (busy || updateHolding) return;
  busy = true; buttons(true);
  try { if (errorTarget) $(errorTarget).textContent = ''; await fn(); }
  catch (e) { if (errorTarget) $(errorTarget).textContent = e.message; else toast(e.message); }
  finally { busy = false; buttons(false); if (pendingLock) lockNow(!document.hidden); }
}
function programDetail() {
  return '本機 App v' + APP_VERSION + ' · ' + (macProgram ? 'Mac 程式 v' + macProgram.version + '（確認於 ' + dateText(macProgram.at) + '）' : 'Mac 程式版本尚待連線確認');
}
async function api(path, options = {}) {
  return requestLocal(path, { token: payload?.token, ...options }, version => {
    macProgram = { version, at: new Date().toISOString() };
    if (payload) $('program-detail').textContent = programDetail();
  });
}
async function checkConnection() {
  const output = $('connection-check');
  output.hidden = false; output.textContent = '正在檢查 Mac 服務、HTTPS 與配對…';
  const result = await diagnoseConnection({ api, hasToken: () => !!payload?.token });
  output.textContent = '檢查時間：' + dateText(result.checkedAt) + '\nMac 服務：' + result.service + '\nHTTPS：' + result.tls + '\n裝置配對：' + result.pairing + (result.version !== null ? '\nMac 目前資料版本：' + result.version : '') + '\n' + result.message;
}
async function persist(next) {
  const envelope = await seal(next, key, meta, 'device');
  const rev = await writeLocal(envelope, localRevision, key);
  localRevision = rev; slot = { envelope, revision: rev, unlockKey: key }; payload = next;
  $('save-state').textContent = '手機已保存：已加密儲存於本機';
}
function draftState(message, state = '') {
  const el = $('draft-save-state'); if (!el) return;
  el.textContent = message; el.dataset.state = state;
}
function recentStores(limit = 6) {
  const latest = new Map();
  for (const visit of all('visit')) {
    const at = Math.max(0, ...(visit.versions || []).map(v => Date.parse(v.at) || 0));
    latest.set(visit.store, Math.max(latest.get(visit.store) || 0, at));
  }
  for (const store of all('store')) {
    const at = Math.max(0, ...(store.versions || []).map(v => Date.parse(v.at) || 0));
    if (!latest.has(store.id)) latest.set(store.id, at);
  }
  return all('store').sort((a, b) => (latest.get(b.id) || 0) - (latest.get(a.id) || 0) || a.name.localeCompare(b.name, 'zh-Hant')).slice(0, limit);
}
function captureVisitDraft() {
  const ctx = editorContext; if (!ctx || ctx.type !== 'visit' || !$('editor').open) return null;
  const val = id => $(id)?.value ?? '';
  const checked = name => [...document.querySelectorAll(`#editor [name="${name}"]:checked`)].map(el => el.value);
  return {
    format: 'visit-draft-1', savedAt: new Date().toISOString(), id: ctx.id, parents: [...ctx.parents],
    baseData: ctx.oldData ? structuredClone(ctx.oldData) : null,
    fields: {
      store: val('f-store'), date: val('f-date'), source: val('f-source'), text: $('f-text')?.value ?? '', next: $('f-next')?.value ?? '',
      topics: checked('topic'), people: checked('person'), keepAttachments: checked('keep-attachment'),
      newStoreName: val('f-new-store-name'), newStoreDistrict: val('f-new-store-district'), newStoreMapUrl: val('f-new-store-map-url'),
      newStorePending: $('f-new-store-pending')?.checked !== false
    }
  };
}
function applyVisitDraft(draft) {
  if (!draft || draft.format !== 'visit-draft-1' || !draft.fields) return;
  const f = draft.fields, set = (id, value) => { const el = $(id); if (el && value !== undefined) el.value = value; };
  set('f-store', f.store); set('f-date', f.date); set('f-source', f.source); set('f-text', f.text); set('f-next', f.next);
  set('f-new-store-name', f.newStoreName); set('f-new-store-district', f.newStoreDistrict); set('f-new-store-map-url', f.newStoreMapUrl);
  if ($('f-new-store-pending')) $('f-new-store-pending').checked = f.newStorePending !== false;
  for (const name of ['topic', 'person', 'keep-attachment']) {
    const selected = new Set(f[name === 'keep-attachment' ? 'keepAttachments' : name + 's'] || []);
    document.querySelectorAll(`#editor [name="${name}"]`).forEach(el => { el.checked = selected.has(el.value); });
  }
  toggleQuickStoreFields();
  draftState('已存於本機 · ' + dateText(draft.savedAt), 'saved');
}
function toggleQuickStoreFields() {
  const box = $('quick-store-fields'), select = $('f-store'); if (!box || !select) return;
  box.hidden = select.value !== '__new__';
}
async function persistVisitDraftNow() {
  clearTimeout(draftTimer); draftTimer = null;
  const draft = captureVisitDraft(); if (!draft || !payload) return;
  draftState('儲存中…', 'saving');
  try {
    await persist({ ...payload, draft });
    draftState('已存於本機 · ' + dateText(draft.savedAt), 'saved');
  } catch (e) {
    draftState('儲存失敗：' + e.message, 'error');
    throw e;
  }
}
function scheduleVisitDraftSave() {
  if (!editorContext || editorContext.type !== 'visit') return;
  draftState('儲存中…', 'saving'); clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftSaveChain = draftSaveChain.catch(() => {}).then(persistVisitDraftNow).catch(() => {});
  }, 350);
}
function flushVisitDraft() {
  if (!editorContext || editorContext.type !== 'visit') return Promise.resolve();
  clearTimeout(draftTimer); draftTimer = null;
  draftSaveChain = draftSaveChain.catch(() => {}).then(persistVisitDraftNow);
  return draftSaveChain;
}
function resumeVisitDraft() {
  const draft = payload?.draft;
  if (!draft || draft.format !== 'visit-draft-1') return toast('目前沒有可恢復的草稿。');
  const id = draft.baseData ? draft.id : null;
  openEditor('visit', id, draft);
}
async function initializeOrUnlock(event) {
  event.preventDefault(); await run(async () => {
    const password = $('password').value;
    slot = await readLocal(); localRevision = slot?.revision || 0;
    if (slot) {
      meta = slot.envelope; key = await derive(password, meta);
      const decrypted = await unseal(slot.envelope, key, 'device'); validateBundle(decrypted.bundle);
      if (decrypted.bundle.vaultId !== meta.vaultId) throw new Error('資料庫身分不符。');
      payload = decrypted; await persist(decrypted);
    } else {
      if (password.length < 12) throw new Error('請使用至少 12 個字元的密碼。');
      if ($('password-again').value && $('password-again').value !== password) throw new Error('兩次密碼不同。');
      const label = $('device-name').value.trim(), code = $('pair-code').value.trim();
      if (!label || !code) throw new Error('請填寫裝置名稱及 Mac 的配對碼。');
      const paired = await api('/api/pair', { method: 'POST', body: { code, label }, token: null });
      let bundle;
      if (paired.snapshot.envelope) {
        meta = paired.snapshot.envelope; key = await derive(password, meta);
        bundle = validateBundle(await unseal(meta, key));
        if (bundle.vaultId !== meta.vaultId) throw new Error('資料庫身分不符。');
      } else {
        if ($('password-again').value !== password) throw new Error('首次建立需要再輸入密碼。配對碼已使用，請在 Mac 重新產生。');
        meta = newMeta(); key = await derive(password, meta); bundle = emptyBundle(meta.vaultId);
      }
      await persist({ schema: 1, device: paired.id, deviceName: label, token: paired.token, bundle, dirty: !paired.snapshot.envelope, serverVersion: paired.snapshot.version, lastSync: paired.snapshot.envelope ? new Date().toISOString() : null });
    }
    $('password').value = ''; $('password-again').value = ''; $('pair-code').value = '';
    await openWorkspace();
    setTimeout(autoSync, 0);
  }, 'gate-error');
}
async function openWorkspace() {
  pendingLock = document.hidden; lastError = ''; lastSyncFailure = null; syncWarning = '';
  $('gate').hidden = true; $('workspace').hidden = false;
  document.body.classList.toggle('privacy-veil', pendingLock);
  try { storagePersistent = await navigator.storage?.persist?.() || false; } catch {}
  switchView('visits'); clearInterval(autoTimer);
  autoTimer = setInterval(autoSync, 15000);
}
async function autoSync() {
  if (updateHolding || autoFetching || !payload?.token || document.hidden || busy || editorContext || $('review').open || $('rebuild-dialog')?.open || csvImport.hasPending()) return;
  const sessionKey = key;
  autoFetching = true;
  try {
    // Offline probes never block editing or take the write lock, and carry no customer content.
    const remote = await api('/api/version');
    if (updateHolding || !payload || key !== sessionKey || document.hidden || busy || editorContext || $('review').open || $('rebuild-dialog')?.open || csvImport.hasPending()) return;
    await run(async () => {
      try {
        if (payload.dirty || remote.version !== payload.serverVersion) await synchronize();
        else await recordUnchangedSync();
      } catch (e) { recordSyncFailure(e); }
    });
  } catch (e) { if (payload && key === sessionKey) { recordSyncFailure(e); } }
  finally { autoFetching = false; }
}
function lockNow(reopen = !document.hidden) {
  if (busy || editorContext || csvImport.hasPending()) { pendingLock = true; document.body.classList.add('privacy-veil'); return; }
  pendingLock = false; clearInterval(autoTimer); key = null; meta = null; payload = null; records = []; trail = []; editorContext = null; lastError = ''; macProgram = null; lastSyncFailure = null; syncWarning = '';
  csvImport.reset(); qualityCache = null; qualityReview = null; qualityTab = 'duplicates'; qualityField = ''; qualityPage = 0;
  resetStoreFilters();
  for (const u of objectURLs) URL.revokeObjectURL(u); objectURLs = [];
  document.querySelectorAll('dialog').forEach(d => d.close());
  for (const id of ['quality-content', 'focus-header', 'graph', 'graph-pager', 'focus-detail', 'evidence-list', 'store-list', 'visit-list', 'customer-list', 'entity-list', 'trash-list', 'review-body', 'editor-fields', 'conflict-list', 'connection-detail', 'program-detail', 'sync-success-detail', 'sync-failure-detail', 'connection-check', 'device-label', 'sync-result', 'storage-detail']) $(id).replaceChildren();
  $('connection-check').hidden = true;
  $('editor-form').reset(); $('gate-form').reset(); $('rebuild-connect-form').reset(); $('password').value = ''; $('backup-file').value = '';
  $('workspace').hidden = true; $('gate').hidden = false;
  if (reopen) { document.body.classList.remove('privacy-veil'); showGate(); }
  $('toast').classList.remove('show'); $('toast').textContent = '';
}
async function showGate() {
  if (gateOpening || payload) return; gateOpening = true;
  try {
    $('gate-error').textContent = '';
    slot = await readLocal(); localRevision = slot?.revision || 0;
    if (slot?.unlockKey) {
      $('gate-title').textContent = '正在開啟本機筆記'; $('gate-hint').textContent = '使用這台裝置保存的金鑰解密，不需輸入密碼。'; $('gate-form').hidden = true; $('gate-restore').hidden = true;
      try {
        meta = slot.envelope; key = slot.unlockKey; const decrypted = await unseal(slot.envelope, key, 'device'); validateBundle(decrypted.bundle);
        if (decrypted.bundle.vaultId !== meta.vaultId) throw new Error('資料庫身分不符。');
        payload = decrypted; await openWorkspace(); setTimeout(autoSync, 0); return;
      } catch { key = null; meta = null; payload = null; $('gate-error').textContent = '裝置保存的金鑰無法使用。請輸入一次原資料庫密碼，重新建立自動開啟金鑰。'; }
    }
    $('gate-form').hidden = false;
    $('gate-title').textContent = slot ? '輸入一次資料庫密碼' : '連接你的 Mac';
    $('gate-hint').textContent = slot ? '這是舊版升級或裝置金鑰修復。成功後，日常開啟不再要求密碼。' : '先在 Mac 管理頁產生配對碼。首次配對輸入一次資料庫密碼，之後自動開啟。';
    $('pair-fields').hidden = !!slot; $('new-options').hidden = !!slot; $('gate-restore').hidden = !!slot;
    $('gate-submit').textContent = slot ? '驗證並啟用自動開啟' : '配對並開啟';
    $('device-name').value = /iPhone|iPad/.test(navigator.userAgent) ? '我的 iPhone' : '我的 Mac';
  } catch (e) { $('gate-error').textContent = `無法使用本機儲存：${e.message}`; }
  finally { gateOpening = false; }
}
async function recordUnchangedSync() {
  // A successful confirmation is still a sync, even when no customer revisions change.
  // Save only after the Mac responds; persist() must succeed before showing a new time.
  await persist({ ...payload, lastSync: new Date().toISOString() });
  lastError = ''; status();
  $('sync-result').textContent = `最近成功同步：${dateText(payload.lastSync)}\n已確認與 Mac 的資料版本一致，沒有新變更。`;
}
async function synchronize() {
  if (!payload?.token) throw new Error('請先在「同步與備份」重新配對；本機資料仍保留。');
  $('sync-state').textContent = '正在與 Mac 交換…';
  for (let attempt = 0; attempt < 5; attempt++) {
    const remote = await api('/api/snapshot');
    if (remote.version < (payload.serverVersion || 0)) throw new Error('Mac 資料版本比上次舊，可能已回復備份。請先匯出本機備份，再重新配對確認。');
    if (remote.envelope && !payload.dirty && remote.version === payload.serverVersion) { await recordUnchangedSync(); return; }
    let combined = payload.bundle, other = null;
    if (remote.envelope) {
      if (remote.envelope.vaultId !== meta.vaultId || remote.envelope.salt !== meta.salt) throw new Error('Mac 是另一個資料庫，已停止同步以保護本機資料。');
      other = validateBundle(await unseal(remote.envelope, key)); combined = merge(combined, other);
    }
    // Persist received revisions before sending: interrupted transfers never erase local edits.
    await persist({ ...payload, bundle: combined, dirty: true });
    const same = other && combined.ops.length === other.ops.length;
    let version = remote.version, backupOK = true;
    if (!same) {
      try { const result = await api('/api/snapshot', { method: 'PUT', body: { expectedVersion: remote.version, envelope: await seal(combined, key, meta) } }); version = result.version; backupOK = result.backupOK; }
      catch (e) { if (e.status === 409) continue; throw e; }
    }
    await persist({ ...payload, dirty: false, serverVersion: version, lastSync: new Date().toISOString() });
    lastError = ''; syncWarning = backupOK ? '' : 'Mac 自動快照失敗。請檢查磁碟空間並手動匯出加密備份。';
    render(); $('sync-result').textContent = `最近成功同步：${dateText(payload.lastSync)}\n已與 Mac 交換至資料版本 ${version}。${records.some(r => r.conflict) ? '有衝突需確認。' : '目前沒有內容衝突。'}${syncWarning ? '\n同步提醒：' + syncWarning : ''}`;
    return;
  }
  throw new Error('其他裝置持續更新，尚未完成同步。請稍後再按一次。');
}
function recordSyncFailure(error) {
  lastError = error.message;
  lastSyncFailure = { at: new Date().toISOString(), message: error.message };
  status();
}
function status() {
  if (!payload) return;
  const conflicts = records.filter(r => r.conflict).length;
  const lastSuccess = payload.lastSync ? dateText(payload.lastSync) : '尚未成功同步';
  $('save-state').textContent = '手機已保存：本機加密資料可用' + (payload.draft ? ' · 有未完成草稿' : '');
  const macAck = payload.dirty ? `Mac 尚未確認收到這次變更 · 上次成功 ${lastSuccess}` : `Mac 已確認收到 · 資料版本 ${payload.serverVersion || 0} · ${lastSuccess}`;
  $('sync-state').textContent = lastError ? `Mac 同步未完成：${lastError} · 上次成功 ${lastSuccess}` : macAck;
  $('conflict-link').hidden = !conflicts; $('conflict-link').textContent = `${conflicts} 筆衝突待確認`;
  $('device-label').textContent = payload.deviceName;
  $('connection-detail').textContent = payload.deviceName + ' · ' + location.hostname + ' · 本機已確認的資料版本 ' + (payload.serverVersion || 0);
  $('program-detail').textContent = programDetail();
  $('local-save-detail').textContent = '手機已保存：' + (payload.draft ? '有 1 份未完成草稿；' : '') + (payload.dirty ? '有已完成紀錄等待 Mac 確認。' : '沒有已完成紀錄等待傳送。');
  $('mac-ack-detail').textContent = payload.dirty ? `Mac 已確認收到至資料版本 ${payload.serverVersion || 0}；本機仍有變更尚未確認。` : `Mac 已確認收到目前資料版本 ${payload.serverVersion || 0}。`;
  $('sync-success-detail').textContent = (payload.lastSync ? '最近成功同步：' + lastSuccess : '尚未成功同步') + (payload.dirty ? '；另有本機變更等待同步。' : '') + (syncWarning ? '；同步提醒：' + syncWarning : '');
  $('sync-failure-detail').textContent = lastSyncFailure ? dateText(lastSyncFailure.at) + ' · ' + lastSyncFailure.message + (!lastError ? '（之後已成功同步）' : '') : '本次開啟尚無同步失敗紀錄。';
  $('storage-detail').textContent = `離線介面：${offlineReady ? '已備妥' : '尚待確認，請先保持連線'}。持久儲存：${storagePersistent ? '已獲允許' : '瀏覽器尚未允許，請定期同步及備份'}。資料 ${(new TextEncoder().encode(JSON.stringify(payload.bundle)).length / 1048576).toFixed(2)} / 24 MB（包含歷史與附件）。`;
}
function switchView(view) {
  activeView = view; Object.keys(titles).forEach(v => $(`${v}-view`).hidden = v !== view);
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('page-title').textContent = titles[view]; render();
}
function navigate(type, id, remember = true) {
  const r = by(type, id); if (!r) return;
  if (remember && (focus.id !== id || focus.type !== type)) trail.push({ ...focus });
  focus = { type, id }; graphPage = 0; switchView('explore');
}
function canonicalPerson(id) { const seen = new Set(); let r = by('person', id); while (r?.sameAs && !r.conflict && !seen.has(r.id)) { seen.add(r.id); r = by('person', r.sameAs); } return r?.id || id; }
function related(f = focus) {
  const tag = by(f.type, f.id)?.csvTag;
  const tagged = tag ? all('store').filter(s => sourceTags(s).includes(tag)).map(s => s.id) : [];
  return groupCSVNotes(all('visit').filter(v => f.type === 'store' || relationVisitAllowed(v, all('store'))).filter(v => f.type === 'store' ? v.store === f.id : f.type === 'topic' ? tag ? tagged.includes(v.store) : v.topics.includes(f.id) : v.people.some(p => canonicalPerson(p) === canonicalPerson(f.id))).sort((a, b) => b.date.localeCompare(a.date)));
}
function chip(type, id) { const r = by(type, id); return r ? `<button class="chip ${type}" data-node-type="${type}" data-node-id="${esc(id)}">${type === 'topic' ? '# ' : ''}${esc(r.name)}${r.conflict ? ' ⚠' : ''}</button>` : ''; }
function noteHTML(v) {
  if (v.evidenceMembers?.length > 1) return `<section class="note"><h3>相同來源文字 · ${v.evidenceMembers.length} 份來源</h3><p>同店、同日期欄位與全文相同，整合顯示一次；不代表已證實是同一次拜訪。每份來源與歷史都保留。</p><p>${esc(v.text)}</p><details><summary>展開所有來源、歷史與各別操作</summary>${v.evidenceMembers.map(noteHTML).join('')}</details></section>`;
  const rule = activeView === 'explore' ? entityRule(by(focus.type, focus.id)) : null;
  const evidence = rule ? evidenceKind(v.text, rule) : null;
  const hint = evidence?.lines.length ? `<div class="evidence-hint ${evidence.kind}"><strong>${esc(evidence.label)} · 字詞線索</strong>${evidence.lines.map(line => `<blockquote>${esc(line)}</blockquote>`).join('')}</div>` : '';
  const sourceState = v.sourceMissing ? '<div class="conflict-card">Google 最新匯出已沒有這段備註；程式保留最後內容，未刪除。</div>' : v.googleUpdatePending ? `<div class="conflict-card">Google 備註已有新版；你曾在 App 修改原文，因此先保留 App 文字。<details><summary>查看 Google 最新文字</summary><p>${esc(v.googleText)}</p></details></div>` : '';
  return `<article class="note"><div class="note-head"><time>${esc(v.date || '原始日期未提供')}</time><span class="pill">${esc(v.source)}</span></div><button class="text-button store-link" data-node-type="store" data-node-id="${esc(v.store)}">${esc(name('store', v.store))}</button>${v.conflict ? `<div class="conflict-card">這筆有 ${v.heads.length} 個版本。以下僅顯示其中一個，請先核對。 <button class="text-button" data-review="visit:${esc(v.id)}">處理衝突</button></div>` : ''}${sourceState}${hint}<p>${esc(v.text)}</p><div class="chips">${v.topics.map(id => chip('topic', id)).join('')}${v.people.map(id => chip('person', id)).join('')}</div>${v.next ? `<p class="next"><strong>下次跟進</strong>${esc(v.next)}</p>` : ''}<div class="attachments">${(v.attachments || []).map((a, i) => `<button data-attachment="${esc(v.id)}" data-index="${i}">↧ ${esc(a.name)}</button>`).join('')}</div><div class="note-actions">${sourceButton(v)}<button class="text-button" data-edit="visit:${esc(v.id)}">編輯</button><button class="text-button" data-history="visit:${esc(v.id)}">歷史 ${v.versions.length}</button><button class="text-button danger" data-delete="visit:${esc(v.id)}">移到回收桶</button></div></article>`;
}
function render() {
  if (!payload) return;
  records = project(payload.bundle); status();
  if (!by(focus.type, focus.id) || by(focus.type, focus.id).deleted) { const first = all('topic').find(t => t.ruleKey === 'ortho') || all('store')[0] || all('topic')[0] || all('person')[0]; focus = first ? { type: first.type, id: first.id } : { type: 'store', id: '' }; }
  if (activeView === 'explore') { renderStores(); renderFocus(); }
  if (activeView === 'visits') renderVisits();
  if (activeView === 'quality') renderQuality();
  if (activeView === 'stores') renderStores();
  if (activeView === 'entities') $('entity-list').innerHTML = [...all('person'), ...all('topic')].map(entityCard).join('') || '<p class="empty">新增人物與主題，讓拜訪紀錄產生連結。</p>';
  if (activeView === 'csv') csvImport.refresh();
  $('conflict-list').innerHTML = records.filter(r => r.conflict).map(r => `<div class="conflict-card"><strong>${esc(r.name || name('store', r.store) + ' · ' + r.date)}</strong><p>${r.heads.length} 個版本待確認</p><button data-review="${r.type}:${esc(r.id)}">比較並處理</button></div>`).join('') || '<p class="muted">目前沒有衝突。</p>';
  if (activeView === 'trash') $('trash-list').innerHTML = records.filter(r => r.deleted && !r.conflict).map(r => `<article class="panel"><span class="pill">${kinds[r.type]}${r.mergedInto ? ' · 已整併' : ''}</span><h3>${esc(r.name || name('store', r.store) + ' · ' + r.date)}</h3><p>${r.mergedInto ? '已依裁定整併至：' + esc(name('store', r.mergedInto)) + '。原版本與歷史仍保留。' : esc(r.text || r.desc || r.contact || '')}</p><button data-restore="${r.type}:${esc(r.id)}">還原</button> <button data-history="${r.type}:${esc(r.id)}">查看歷史</button></article>`).join('') || '<p class="empty">回收桶是空的。</p>';
}
function entityCard(r) { return `<article class="panel"><span class="pill ${r.conflict ? 'warn' : ''}">${kinds[r.type]}${r.conflict ? ' · 有衝突' : ''}${storeIdentityPending(r) ? ' · 需要後續的確認' : ''}</span><h3>${esc(r.name)}</h3>${r.type === 'store' ? '<span class="pill retail-label">' + esc(retailChannel(r).label) + '</span>' : ''}${r.csvAliases?.length ? '<p class="muted">來源名稱：' + r.csvAliases.map(esc).join('／') + '</p>' : ''}<p>${esc(r.type === 'store' ? `${r.city} ${r.district} · ${r.channel}\n${r.attr}\n${r.contact}` : r.type === 'person' ? `${r.confirmed ? '身分已核對' : '身分待確認'} · ${r.role}${r.sameAs ? '\n連到：' + name('person', r.sameAs) : ''}` : r.desc)}</p><div class="note-actions">${sourceButton(r)}<button class="text-button" data-node-type="${r.type}" data-node-id="${esc(r.id)}">探索關聯</button><button class="text-button" data-edit="${r.type}:${esc(r.id)}">編輯</button><button class="text-button" data-history="${r.type}:${esc(r.id)}">歷史</button><button class="text-button danger" data-delete="${r.type}:${esc(r.id)}">刪除</button></div></article>`; }
function qualityReport() {
  if (qualityCache?.bundle !== payload.bundle) qualityCache = { bundle: payload.bundle, report: scanQuality(records) };
  return qualityCache.report;
}
function qualityStore(store) {
  const visits = records.filter(r => r.type === 'visit' && !r.deleted && r.store === store.id).length;
  return '<div class="quality-store"><strong>' + esc(store.name) + '</strong><p>' + esc(store.address || '地址未提供') + '</p><small>' + esc([store.city, store.district, store.channel].filter(Boolean).join(' · ') || '地區／通路未提供') + ' · ' + visits + ' 筆紀錄</small></div>';
}
function renderQuality() {
  if (!payload) return;
  const report = qualityReport(), labels = { duplicates: '疑似重複', missing: '缺漏與格式', reviewed: '已確認不同' };
  const options = [['', '全部缺漏與格式'], ...Object.entries(PROFILE_FIELDS)].map(([value, text]) => '<option value="' + esc(value) + '" ' + (qualityField === value ? 'selected' : '') + '>' + esc(text) + '</option>').join('');
  const source = qualityTab === 'missing' ? report.items.filter(x => !qualityField || x.issues.some(i => i.field === qualityField)) : qualityTab === 'reviewed' ? report.reviewed : report.pairs;
  qualityPage = Math.min(qualityPage, Math.max(0, Math.ceil(source.length / 20) - 1));
  const start = qualityPage * 20, rows = source.slice(start, start + 20);
  const counts = { duplicates: report.pairs.length, missing: report.items.length, reviewed: report.reviewed.length };
  let html = '<div class="quality-tabs" aria-label="資料整理分類">' + Object.entries(labels).map(([value, text]) => '<button data-quality-tab="' + value + '" aria-pressed="' + (qualityTab === value) + '" class="' + (qualityTab === value ? 'primary' : '') + '">' + text + ' · ' + counts[value] + (report.limited && value === 'duplicates' ? '＋' : '') + '</button>').join('') + '</div>';
  html += '<p class="muted">已檢查 ' + report.stores + ' 間無衝突門市。疑似重複是比對線索；同名分店可確認為不同門市。選填欄位未知時可以留空。</p>';
  if (report.limited) html += '<p class="conflict-card">疑似重複較多，目前列出部分配對。先核對這批後重新檢查，仍可能有其他待確認項目。</p>';
  if (report.conflicts.length) html += '<div class="conflict-card">' + report.conflicts.length + ' 間門市有同步衝突，請先處理才能補登或核對。<button data-view="sync" class="text-button">前往處理衝突</button></div>';
  if (qualityTab === 'missing') html += '<label class="quality-filter">依欄位篩選<select id="quality-field">' + options + '</select></label>';
  html += '<div class="quality-list">' + rows.map((row, i) => {
    if (qualityTab === 'missing') {
      const missing = row.issues.filter(issue => issue.kind === 'missing'), warnings = row.issues.filter(issue => issue.kind !== 'missing');
      return '<article class="panel">' + qualityStore(row.store) + '<div class="chips">' + missing.map(issue => '<span class="pill">' + esc(PROFILE_FIELDS[issue.field]) + '未提供</span>').join('') + '</div>' + warnings.map(issue => '<p class="error">' + esc(issue.message) + '</p>').join('') + '<div class="note-actions">' + (missing.length ? '<button class="secondary" data-fill-store="' + esc(row.store.id) + '">補登欄位</button>' : '') + '<button class="text-button" data-edit="store:' + esc(row.store.id) + '">檢查門市資料</button>' + sourceButton(row.store) + '</div></article>';
    }
    return '<article class="panel"><div class="quality-pair">' + qualityStore(row.a) + qualityStore(row.b) + '</div><p class="quality-reasons">' + row.reasons.map(esc).join('；') + '</p><button class="secondary" data-quality-pair="' + (qualityTab === 'reviewed' ? 'reviewed:' : 'duplicates:') + (start + i) + '">' + (qualityTab === 'reviewed' ? '查看／重新核對' : '並排核對') + '</button></article>';
  }).join('') + '</div>';
  if (!rows.length) html += '<p class="empty">' + (qualityTab === 'duplicates' ? '目前沒有符合比對規則的疑似重複；仍可到「客戶門市」人工核對。' : qualityTab === 'missing' ? '目前沒有符合篩選的缺漏或格式問題。' : '尚未記錄已確認為不同門市的配對。') + '</p>';
  if (source.length > 20) html += '<div class="section-row csv-pagination"><button data-quality-page="-1" ' + (!qualityPage ? 'disabled' : '') + '>上一頁</button><span>' + (qualityPage + 1) + ' / ' + Math.ceil(source.length / 20) + ' 頁</span><button data-quality-page="1" ' + (start + 20 >= source.length ? 'disabled' : '') + '>下一頁</button></div>';
  $('quality-content').innerHTML = html;
}
function openQualityPair(key) {
  const [tab, index] = key.split(':'), report = qualityReport(), pair = (tab === 'reviewed' ? report.reviewed : report.pairs)[Number(index)];
  if (!pair) return;
  qualityReview = { a: pair.a.id, b: pair.b.id, forget: tab === 'reviewed' };
  $('review-title').textContent = tab === 'reviewed' ? '已確認為不同門市' : '核對疑似重複門市';
  $('review-body').innerHTML = '<div class="quality-pair">' + qualityStore(pair.a) + qualityStore(pair.b) + '</div><p class="quality-reasons">' + pair.reasons.map(esc).join('；') + '</p><div class="quality-table-wrap"><table class="quality-table"><thead><tr><th>欄位</th><th>門市一</th><th>門市二</th></tr></thead><tbody>' + Object.entries(PROFILE_FIELDS).map(([field, label]) => '<tr><th>' + label + '</th><td>' + esc(pair.a[field] || '未提供') + '</td><td>' + esc(pair.b[field] || '未提供') + '</td></tr>').join('') + '</tbody></table></div><p class="muted">確認不同門市後會保存核對紀錄並同步。名稱、地址或地圖等辨識資料改變時，會重新列入核對。</p><p class="muted">若確實為同一間，這一版先保留兩筆及其拜訪紀錄；完整合併另行處理。</p><div class="note-actions">' + sourceButton(pair.a) + sourceButton(pair.b) + '</div><div class="dialog-footer"><button data-close="review">稍後核對</button><button class="primary" data-quality-mark="1">' + (qualityReview.forget ? '撤回確認，重新核對' : '確認為不同門市') + '</button></div>';
  $('review').showModal();
}
async function saveQualityReview() {
  if (!qualityReview) return;
  const { a, b, forget } = qualityReview;
  const bundle = setDistinctReview(payload.bundle, a, b, payload.device, forget);
  await persist({ ...payload, bundle, dirty: true }); $('review').close(); qualityReview = null; render();
  toast(forget ? '已撤回核對，將重新顯示這組門市。' : '已記錄為不同門市，等待同步。');
}
function openFillStore(id) {
  const store = by('store', id);
  if (!store || store.deleted) return;
  if (store.conflict) return openReview('store', id, true);
  const fields = FILL_FIELDS.filter(field => !store[field]?.trim()), suggestions = sourceSuggestions(store);
  if (!fields.length) { toast('目前沒有空白欄位，請到門市資料檢查。'); return; }
  editorContext = { type: 'store', id, parents: store.heads.map(h => h.id), oldData: structuredClone(store.heads[0].data), fillFields: fields, suggestions };
  $('editor-title').textContent = '補登 · ' + store.name; $('editor-error').textContent = '';
  $('editor-fields').innerHTML = '<p class="muted">只補上空白欄位；未知資料可留空。來源建議需由你核對後採用。</p>' + fields.map(field => {
    const choices = suggestions[field] || [];
    return input('fill-' + field, PROFILE_FIELDS[field] + '（選填）', '', ['address', 'mapUrl'].includes(field) ? 2000 : 500) + (choices.length ? '<details class="quality-suggestions"><summary>查看原始 CSV 的 ' + choices.length + ' 個補值建議' + (choices.length > 1 ? '（來源有不同值）' : '') + '</summary>' + choices.slice(0, 20).map((s, i) => '<div><p>' + esc(s.value) + '</p><small>' + esc(s.file) + ' · 第 ' + s.line + ' 行</small><button type="button" class="text-button" data-fill-suggestion="' + field + '" data-suggestion-index="' + i + '">採用此值</button></div>').join('') + (choices.length > 20 ? '<p class="muted">此處先顯示 20 個值，完整內容可在門市原始來源查閱。</p>' : '') + '</details>' : '');
  }).join('');
  $('editor').showModal();
}
function resetStoreFilters() {
  storeFilters = { query: '', district: '', kind: '', groups: [] };
  for (const prefix of ['', 'customer-']) {
    $(prefix + 'search').value = '';
    $(prefix + 'district').innerHTML = '<option value="">所有地區</option>';
    $(prefix + 'channel').innerHTML = '<option value="">所有門市型態</option>';
    $(prefix + 'retail-options').replaceChildren();
    $(prefix + 'store-count').textContent = '';
  }
}
function changeStoreFilter(field, value) {
  if (!payload || updateHolding) return;
  if (field === 'groups') {
    storeFilters.groups = !value ? [] : storeFilters.groups.includes(value) ? storeFilters.groups.filter(id => id !== value) : [...storeFilters.groups, value];
  } else if (field === 'clear') resetStoreFilters();
  else storeFilters[field] = value;
  renderStores();
}
function renderStores() {
  if (!payload) return;
  const stores = all('store'), result = filterStoreDirectory(stores, all('visit'), storeFilters);
  const options = (values, current, label) => '<option value="">' + label + '</option>' + [...new Set([...values.filter(Boolean), ...(current ? [current] : [])])].sort().map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
  const districtOptions = options(stores.map(s => s.district), storeFilters.district, '所有地區');
  const kindOptions = options(stores.map(s => s.channel), storeFilters.kind, '所有門市型態');
  const optionButton = (id, label, count, selected) => `<button type="button" data-retail-group="${id}" aria-pressed="${selected}">${esc(label)} <span>${count}</span></button>`;
  const groupOptions = optionButton('', '全部通路', result.matchedBeforeGroups, !storeFilters.groups.length) + result.groups.map(g => optionButton(g.id, g.label, g.count, storeFilters.groups.includes(g.id))).join('');
  for (const prefix of ['', 'customer-']) {
    // Do not replace the text input: typing keeps its caret and IME composition.
    if ($(prefix + 'search').value !== storeFilters.query) $(prefix + 'search').value = storeFilters.query;
    $(prefix + 'district').innerHTML = districtOptions; $(prefix + 'district').value = storeFilters.district;
    $(prefix + 'channel').innerHTML = kindOptions; $(prefix + 'channel').value = storeFilters.kind;
    const container = $(prefix + 'retail-options'), focused = container.contains(document.activeElement) ? document.activeElement?.dataset.retailGroup : undefined;
    const scrollTop = container.scrollTop;
    container.innerHTML = groupOptions; container.scrollTop = scrollTop;
    if (focused !== undefined) [...container.querySelectorAll('button')].find(b => b.dataset.retailGroup === focused)?.focus({ preventScroll: true });
    $(prefix + 'store-count').textContent = `顯示 ${result.entries.length} ／ ${result.total} 間門市`;
  }
  const empty = '<p class="empty">沒有符合的門市。請調整條件或清除篩選。</p>';
  if (activeView === 'stores') $('customer-list').innerHTML = result.entries.map(({ store: s }) => entityCard(s)).join('') || empty;
  if (activeView === 'explore') $('store-list').innerHTML = result.entries.map(({ store: s, group }) => `<button class="store-card ${focus.type === 'store' && focus.id === s.id ? 'active' : ''}" data-node-type="store" data-node-id="${esc(s.id)}"><strong>${esc(s.name)}</strong><small>${esc(group.label)} · ${esc(s.district || '地區未提供')}</small><small>${esc(s.channel || '型態待整理')} · ${related({ type: 'store', id: s.id }).length} 筆</small>${s.conflict ? '<span class="pill warn">有衝突</span>' : ''}${storeIdentityPending(s) ? '<span class="pill warn">需要後續的確認</span>' : ''}</button>`).join('') || empty;
}
function renderFocus() {
  const r = by(focus.type, focus.id);
  if (!r) { $('focus-header').innerHTML = '<h2>建立第一個探索起點</h2><p>先新增門市，再記錄拜訪。</p>'; $('focus-detail').innerHTML = ''; $('graph').innerHTML = ''; $('evidence-list').innerHTML = ''; $('evidence-count').textContent = '0'; return; }
  const vv = related(), storeIDs = r.csvTag ? all('store').filter(s => !storeIdentityPending(s) && sourceTags(s).includes(r.csvTag)).map(s => s.id) : [...new Set(vv.map(v => v.store))];
  $('focus-header').innerHTML = `<div class="focus-top"><span class="pill ${r.type === 'person' && !r.confirmed ? 'warn' : ''}">${kinds[r.type]}${r.type === 'person' ? r.confirmed ? ' · 已核對' : ' · 待確認' : ''}</span>${trail.length ? '<button id="back-node" class="text-button">← 上一個節點</button>' : ''}</div><h2>${esc(r.name)}</h2><p class="muted">${esc(r.type === 'store' ? `${r.city} ${r.district} · ${r.channel}` : r.type === 'person' ? r.role : r.desc)}</p>${r.conflict ? `<button class="danger" data-review="${r.type}:${esc(r.id)}">先處理這個節點的衝突</button>` : ''}`;
  const pendingIdentity = storeIdentityPending(r), topics = pendingIdentity ? [] : [...new Set(vv.flatMap(v => v.topics))], people = pendingIdentity ? [] : [...new Set(vv.flatMap(v => v.people))];
  if (r.type === 'store' && !pendingIdentity) topics.push(...all('topic').filter(t => t.csvTag && sourceTags(r).includes(t.csvTag)).map(t => t.id));
  $('focus-detail').innerHTML = `<div class="metrics"><div><strong>${storeIDs.length}</strong><span>相關門市</span></div><div><strong>${vv.length}</strong><span>相關原文</span></div><div><strong>${vv.filter(v => v.csvSources?.length).length}</strong><span>可追溯 CSV</span></div></div>${r.type === 'store' ? `<h3>門市窗口</h3><p>${esc(r.contact)}</p><p class="muted">${esc(r.attr)}</p><p>${esc(r.address || '')}</p><p class="muted">${esc((r.lists || []).join('、'))}</p><p>${sourceTags(r).map(t => `<span class="pill">${esc(t)}</span>`).join(' ')}</p>${sourceButton(r)}` : ''}${r.type === 'person' ? `<p>${esc(r.desc)}</p>${r.sameAs ? `<p>已確認連到 ${chip('person', r.sameAs)}</p>` : ''}` : ''}<h3>相關主題</h3><div class="chips">${topics.map(id => chip('topic', id)).join('') || '<span class="muted">尚未標記主題</span>'}</div><h3>提及人物</h3><div class="chips">${people.map(id => chip('person', id)).join('') || '<span class="muted">尚未標記人物</span>'}</div><div class="insight"><h3>從證據判斷</h3><p>共同主題代表值得追問的線索。對照原文、日期及提問方式，再判斷是否為市場需求；同名人物請先核對身分。</p></div>`;
  if (pendingIdentity) $('focus-detail').innerHTML = '<p class="conflict-card">需要後續的確認：原文保留，門市身分核實前暫不建立關聯。請到編輯門市核實名稱與來源後，明確勾選已核對身分。</p>' + sourceButton(r);
  $('evidence-list').innerHTML = vv.map(noteHTML).join('') || '<p class="empty">尚無相關拜訪紀錄。</p>'; $('evidence-count').textContent = vv.length;
  drawGraph();
}
function drawGraph() {
  if (!payload || activeView !== 'explore') return;
  const r = by(focus.type, focus.id); if (!r) return;
  if (storeIdentityPending(r)) { $('graph').innerHTML = ''; $('graph-pager').textContent = '門市身分待確認，暫不呈現關聯'; return; }
  const visits = related(), links = [];
  function add(type, id) { if ((type === focus.type && id === focus.id) || links.some(x => x.type === type && x.id === id) || !by(type, id)) return; links.push({ type, id }); }
  if (focus.type === 'store') { visits.forEach(v => v.topics.forEach(id => add('topic', id))); visits.forEach(v => v.people.forEach(id => add('person', id))); all('topic').filter(t => t.csvTag && sourceTags(r).includes(t.csvTag)).forEach(t => add('topic', t.id)); }
  else if (r.csvTag) all('store').filter(s => !storeIdentityPending(s) && sourceTags(s).includes(r.csvTag)).forEach(s => add('store', s.id));
  else visits.forEach(v => add('store', v.store));
  if (focus.type === 'person') all('person').filter(p => p.id !== focus.id && (p.name.includes(r.name.replace('（待確認）', '')) || r.name.includes(p.name.replace('（待確認）', '')))).forEach(p => add('person', p.id));
  graphPage = Math.min(graphPage, Math.max(0, Math.ceil(links.length / 8) - 1));
  $('graph-pager').innerHTML = links.length > 8 ? `<button data-graph-page="-1" ${graphPage === 0 ? 'disabled' : ''}>上一頁</button><span>節點 ${graphPage * 8 + 1}–${Math.min(links.length, (graphPage + 1) * 8)}／${links.length}</span><button data-graph-page="1" ${graphPage === Math.ceil(links.length / 8) - 1 ? 'disabled' : ''}>下一頁</button>` : `<span>全部 ${links.length} 個關聯節點</span>`;
  const nodes = links.slice(graphPage * 8, graphPage * 8 + 8), w = Math.max(280, $('graph-wrap').clientWidth), h = 420, cx = w / 2, cy = h / 2, nw = Math.min(152, w * .44);
  $('graph').setAttribute('viewBox', `0 0 ${w} ${h}`); $('graph-wrap').style.height = `${h}px`;
  const positions = [[w * .25, 43], [w * .75, 43], [w * .25, 121], [w * .75, 121], [w * .25, 299], [w * .75, 299], [w * .25, 377], [w * .75, 377]];
  let edges = '', shapes = '';
  nodes.forEach((n, i) => { const e = by(n.type, n.id), [x, y] = positions[i], pending = n.type === 'person' && !e.confirmed || r.type === 'person' && !r.confirmed;
    edges += `<path class="edge ${pending ? 'pending' : ''}" d="M${cx} ${cy} Q${cx} ${y} ${x} ${y}"/>`;
    const label = e.name.length > 10 ? e.name.slice(0, 9) + '…' : e.name;
    shapes += `<g class="node ${pending ? 'pending' : ''}" role="button" tabindex="0" aria-label="探索${esc(e.name)}" data-node-type="${n.type}" data-node-id="${esc(n.id)}"><title>${esc(e.name)}</title><rect x="${x - nw / 2}" y="${y - 27}" width="${nw}" height="54" rx="9"/><text x="${x}" y="${y - 2}" text-anchor="middle">${esc(label)}</text><text class="sub" x="${x}" y="${y + 16}" text-anchor="middle">${pending ? '同名待核對' : r.csvTag ? '原始標籤相同' : focus.type === 'topic' ? esc(evidenceKind(visits.filter(v => v.store === n.id).map(v => v.text).join('\n'), entityRule(r)).label) : kinds[n.type]}</text></g>`;
  });
  $('graph').innerHTML = `<title>${esc(r.name)}的相關節點</title>${edges}${shapes}<g class="node center"><rect x="${cx - 82}" y="${cy - 30}" width="164" height="60" rx="10"/><text class="sub" x="${cx}" y="${cy - 8}" text-anchor="middle">目前中心 · ${kinds[r.type]}</text><text x="${cx}" y="${cy + 13}" text-anchor="middle">${esc(r.name.slice(0, 11))}</text></g>`;
}
function renderVisits() {
  const recent = recentStores();
  $('recent-store-list').innerHTML = recent.map(store => `<button type="button" class="recent-store" data-quick-visit="${esc(store.id)}"><strong>${esc(store.name)}</strong><small>${esc(store.district || '地區未提供')}</small></button>`).join('') || '<p class="muted">完成第一筆拜訪後，最近使用門市會出現在這裡。</p>';
  $('draft-banner').hidden = !payload?.draft;
  if (payload?.draft) $('draft-banner-text').textContent = '有一份已成功保存於本機的未完成草稿' + (payload.draft.savedAt ? ' · ' + dateText(payload.draft.savedAt) : '') + '。';
  const q = $('visit-search').value.trim().toLowerCase();
  $('visit-list').innerHTML = all('visit').sort((a, b) => b.date.localeCompare(a.date)).filter(v => !q || `${v.text}${v.next}${name('store', v.store)}${v.topics.map(id => name('topic', id)).join()}${v.people.map(id => name('person', id)).join()}`.toLowerCase().includes(q)).map(noteHTML).join('') || '<p class="empty">沒有符合的拜訪紀錄。</p>';
}
function sourceButton(r) { return (r.csvSources?.length || r.versions?.some(v => v.data.csvSources?.length)) ? `<button class="text-button" data-csv-source="${r.type}:${esc(r.id)}">查看匯入原始來源</button>` : ''; }
function openSources(type, id) {
  const r = by(type, id); if (!r) return;
  const seen = new Set(), sources = r.versions.flatMap(v => v.data.csvSources || []).filter(s => { const k = `${s.blob}:${s.fingerprint}:${s.list}`; if (seen.has(k)) return false; seen.add(k); return true; });
  $('review-title').textContent = 'CSV 原始來源';
  $('review-body').innerHTML = `<p class="muted">以下是匯入時的原始欄位；包含歷史版本的來源。匯入時間不是拜訪日期。地圖網址只顯示，不會自動連線。</p>${sources.map(s => `<article class="version"><strong>${esc(s.file)} · 第 ${s.line} 行</strong><p class="muted">清單：${esc(s.list)} · 匯入：${dateText(s.at)}</p><details><summary>展開原始欄位</summary><div class="csv-raw">${s.headers.map((h, i) => `<p><strong>第 ${i + 1} 欄 · ${esc(h)}</strong><span>${esc(s.cells[i])}</span></p>`).join('')}</div></details><button class="text-button" data-csv-download="${esc(s.blob)}" data-csv-filename="${esc(s.file)}">下載原始 CSV（明文）</button></article>`).join('')}`;
  $('review').showModal();
}
const input = (id, label, value = '', max = 500, required = false) => `<label>${label}<input id="${id}" maxlength="${max}" value="${esc(value)}" ${required ? 'required' : ''} autocomplete="off"></label>`;
const textarea = (id, label, value = '') => `<label>${label}<textarea id="${id}" maxlength="20000">${esc(value)}</textarea></label>`;
function openEditor(type, id = null, restoreDraft = null) {
  const old = id ? by(type, id) : null; if (old?.conflict) { openReview(type, id, true); return; }
  editorContext = { type, id: id || uuid(), parents: old?.heads.map(h => h.id) || [], oldData: old ? structuredClone(old.heads[0].data) : null };
  const d = editorContext.oldData || {};
  $('editor-title').textContent = `${old ? '編輯' : '新增'}${kinds[type]}`; $('editor-error').textContent = '';
  if (type === 'visit') {
    if (restoreDraft?.format === 'visit-draft-1') editorContext = { type, id: restoreDraft.id, parents: [...(restoreDraft.parents || [])], oldData: restoreDraft.baseData ? structuredClone(restoreDraft.baseData) : null };
    const base = editorContext.oldData || d;
    const selectedStore = restoreDraft?.fields?.store || base.store || (focus.type === 'store' ? focus.id : recentStores(1)[0]?.id || all('store')[0]?.id || '__new__');
    const orderedStores = [...recentStores(6), ...all('store').filter(s => !recentStores(6).some(r => r.id === s.id))];
    const pick = (kind, selected) => all(kind).map(r => `<label class="check"><input type="checkbox" name="${kind}" value="${esc(r.id)}" ${selected?.includes(r.id) ? 'checked' : ''}>${esc(r.name)}</label>`).join('') || '<p class="muted">先到「人物與主題」新增。</p>';
    const storeOptions = orderedStores.concat(base.store && by('store', base.store)?.deleted ? [by('store', base.store)] : []).map(s => `<option value="${esc(s.id)}" ${selectedStore === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('') + `<option value="__new__" ${selectedStore === '__new__' ? 'selected' : ''}>＋ 快速新增門市</option>`;
    $('editor-fields').innerHTML = `<div class="field-grid"><label>門市<select id="f-store">${storeOptions}</select></label><label>拜訪日期（未知可留空）<input type="date" id="f-date" value="${esc(base.date ?? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))}"></label></div><div id="quick-store-fields" class="quick-store" hidden><h3>快速新增門市</h3>${input('f-new-store-name', '門市名稱（必要）', '', 200)}${input('f-new-store-district', '地區（可稍後補）', '', 500)}${input('f-new-store-map-url', 'Google Maps 網址（可稍後補）', '', 2000)}<label class="check"><input id="f-new-store-pending" type="checkbox" checked> 身分待確認；先保存門市與拜訪，不自動合併</label><p class="muted">除名稱外都可稍後補。待確認門市不參與關聯分析，之後可在門市資料核實。</p></div><label>資訊來源<select id="f-source">${[...new Set(['藥師主動提及', '詢問後回覆', '現場觀察', '其他', ...(base.source ? [base.source] : [])])].map(x => `<option ${x === base.source ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>${textarea('f-text', '原始拜訪內容', base.text)}${textarea('f-next', '下次跟進', base.next)}<label>相關主題</label><div class="check-grid">${pick('topic', base.topics)}</div><label>提及人物</label><div class="check-grid">${pick('person', base.people)}</div><label>附件（每個上限 3 MB）<input type="file" id="f-files" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"></label><p class="muted">支援圖片與 PDF。新選的附件檔案無法靠草稿跨 App 關閉／重新開啟保存；完成紀錄前若 App 被系統終止，請重新選擇附件。舊附件取消勾選可從此版本移除，歷史仍保留。</p><div class="check-grid">${(base.attachments || []).map((a, i) => `<label class="check"><input type="checkbox" name="keep-attachment" value="${i}" checked>${esc(a.name)}</label>`).join('')}</div><p id="draft-save-state" class="draft-state" role="status">尚未變更</p><p class="muted">文字與欄位變更會自動加密保存為本機草稿；「完成紀錄」才建立／更新正式拜訪版本。</p>`;
    $('editor-save').textContent = '完成紀錄';
    toggleQuickStoreFields();
    if (restoreDraft) applyVisitDraft(restoreDraft);
  } else {
    $('editor-save').textContent = '儲存';
    let fields = input('f-name', `${kinds[type]}名稱`, d.name, 200, true);
    if (type === 'store') fields += `<div class="field-grid">${input('f-city', '縣市', d.city)}${input('f-district', '地區', d.district)}</div><label>通路<select id="f-channel">${[...new Set(['', '連鎖', '獨立', '加盟', '診所', '其他', ...(d.channel ? [d.channel] : [])])].map(c => `<option value="${esc(c)}" ${c === d.channel ? 'selected' : ''}>${esc(c || '未分類')}</option>`).join('')}</select></label>${input('f-address', '地址', d.address, 2000)}${input('f-map-url', 'Google Maps 網址（只保存，不自動開啟）', d.mapUrl, 2000)}${input('f-attr', '門市屬性／客群', d.attr)}${input('f-contact', '拜訪窗口', d.contact)}`;
    if (type === 'store' && d.csvIdentityPending) fields += '<label class="check"><input type="checkbox" id="f-identity-reviewed">我已核實此門市身分與來源，解除待確認標記並允許關聯分析</label>';
    if (type === 'person') fields += `${input('f-role', '職務／與門市的關係', d.role)}${textarea('f-desc', '身分證據與備註', d.desc)}<label class="check"><input type="checkbox" id="f-confirmed" ${d.confirmed ? 'checked' : ''}> 我已核對此人物的身分</label><label>已確認是同一人時，連到<select id="f-same"><option value="">保持獨立人物</option>${all('person').filter(p => p.id !== id && !p.sameAs).map(p => `<option value="${esc(p.id)}" ${d.sameAs === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><p class="muted">須先勾選已核對身分。此設定只合併探索路徑，不改寫原始拜訪文字。</p>`;
    if (type === 'topic') fields += textarea('f-desc', '主題定義與備註', d.desc);
    $('editor-fields').innerHTML = fields;
  }
  $('editor').showModal();
}
async function commitRevision(type, id, data, parents, deleted = false, blobs = {}) {
  const bundle = structuredClone(payload.bundle); bundle.schema = 2; bundle.ops.push(revision(type, id, data, parents, payload.device, deleted)); Object.assign(bundle.blobs, blobs); validateBundle(bundle);
  await persist({ ...payload, bundle, dirty: true }); render();
}
async function saveEditor(event) {
  event.preventDefault(); await run(async () => {
    const ctx = editorContext; if (!ctx) return;
    if (ctx.fillFields) {
      const additions = Object.fromEntries(ctx.fillFields.map(field => [field, $('fill-' + field).value]));
      const bundle = fillProfile(payload.bundle, ctx.id, additions, payload.device, ctx.parents);
      const summary = Object.entries(additions).filter(([, value]) => value.trim()).map(([field, value]) => PROFILE_FIELDS[field] + '：' + value.trim()).join('\n');
      if (!confirm('確認補上以下欄位？\n' + summary + '\n原始來源與既有欄位會保留。')) return;
      await persist({ ...payload, bundle, dirty: true }); $('editor').close(); editorContext = null; render(); toast('欄位已補登，已保留歷史並等待同步。'); return;
    }
    const value = id => $(id).value.trim(); let d, blobs = {};
    let quickStore = null;
    if (ctx.type === 'visit') {
      if (!value('f-text')) throw new Error('請填寫拜訪內容。');
      const checked = n => [...document.querySelectorAll(`#editor [name="${n}"]:checked`)].map(c => c.value);
      let storeId = value('f-store');
      if (storeId === '__new__') {
        const storeName = value('f-new-store-name'); if (!storeName) throw new Error('快速新增門市至少需要門市名稱。');
        storeId = uuid();
        quickStore = { id: storeId, data: { name: storeName, city: '', district: value('f-new-store-district'), channel: '', attr: '', contact: '', address: '', mapUrl: value('f-new-store-map-url'), csvIdentityPending: $('f-new-store-pending').checked } };
      }
      d = { store: storeId, date: value('f-date'), source: value('f-source'), text: $('f-text').value, next: $('f-next').value, topics: checked('topic'), people: checked('person'), attachments: checked('keep-attachment').map(i => ctx.oldData?.attachments?.[Number(i)]).filter(Boolean) };
      // Keep unresolved references in old notes, even if the referenced entity is now in the trash.
      for (const [field, type] of [['topics', 'topic'], ['people', 'person']]) for (const old of ctx.oldData?.[field] || []) if (!all(type).some(r => r.id === old) && !d[field].includes(old)) d[field].push(old);
      for (const f of $('f-files').files) {
        if (f.size > 3 * 1024 * 1024) throw new Error(`${f.name} 超過 3 MB。`);
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'].includes(f.type) && !/\.heic$/i.test(f.name)) throw new Error('附件只支援 JPEG、PNG、WebP、HEIC 與 PDF。');
        const bytes = new Uint8Array(await f.arrayBuffer()), id = await hashBytes(bytes); blobs[id] = b64(bytes); d.attachments.push({ blob: id, name: f.name.slice(0, 200), mime: f.type || 'application/octet-stream' });
      }
    } else if (ctx.type === 'store') d = { name: value('f-name'), city: value('f-city'), district: value('f-district'), channel: value('f-channel'), attr: value('f-attr'), contact: value('f-contact'), address: value('f-address'), mapUrl: value('f-map-url') };
    else if (ctx.type === 'topic') d = { name: value('f-name'), desc: value('f-desc') };
    else {
      d = { name: value('f-name'), role: value('f-role'), desc: value('f-desc'), confirmed: $('f-confirmed').checked, sameAs: value('f-same') };
      if (d.sameAs && !d.confirmed) throw new Error('請先核對人物身分，再建立同一人連結。');
      const seen = new Set([ctx.id]); let target = d.sameAs;
      while (target) { if (seen.has(target)) throw new Error('人物連結不能形成循環。'); seen.add(target); target = by('person', target)?.sameAs; }
    }
    d = { ...(ctx.oldData || {}), ...d };
    if (ctx.type === 'store' && ctx.oldData?.csvIdentityPending && $('f-identity-reviewed')?.checked) d.csvIdentityPending = false;
    if (ctx.type === 'visit' && d.googleUpdatePending && d.text === d.googleText) d.googleUpdatePending = false;
    if (ctx.type === 'visit') {
      const bundle = structuredClone(payload.bundle); bundle.schema = 2;
      if (quickStore) bundle.ops.push(revision('store', quickStore.id, quickStore.data, [], payload.device));
      bundle.ops.push(revision('visit', ctx.id, d, ctx.parents, payload.device)); Object.assign(bundle.blobs, blobs); validateBundle(bundle);
      await persist({ ...payload, bundle, dirty: true, draft: null }); render(); clearTimeout(draftTimer); draftTimer = null;
      $('editor').close(); editorContext = null; toast(quickStore ? '新門市與拜訪已完成並保存於手機；等待 Mac 確認收到。' : '拜訪已完成並保存於手機；等待 Mac 確認收到。'); return;
    }
    await commitRevision(ctx.type, ctx.id, d, ctx.parents, false, blobs); $('editor').close(); editorContext = null; toast('已加密儲存。Mac 可連線時會自動交換。');
  }, 'editor-error');
}
function describeData(type, data) {
  if (type === 'visit') return `${name('store', data.store)} · ${data.date || '原始日期未提供'}\n${data.source}\n${data.sourceMissing ? 'Google 最新匯出：備註缺少（舊文保留）\n' : ''}${data.googleUpdatePending ? `Google 最新文字：${data.googleText}\nApp 文字待人工核對\n` : ''}\n${data.text}\n\n下次跟進：${data.next}\n主題：${data.topics.map(id => name('topic', id)).join('、')}\n人物：${data.people.map(id => name('person', id)).join('、')}\n附件：${data.attachments.map(a => a.name).join('、')}`;
  const labels = { address: '地址', mapUrl: '地圖網址', lists: '來源清單', name: '名稱', city: '縣市', district: '地區', channel: '通路', attr: '屬性', contact: '窗口', desc: '備註', role: '職務', confirmed: '身分已核對', sameAs: '同一人連結', mergedInto: '已整併至門市 ID', mergeDecision: '整併裁定' };
  const details = Object.entries(data).filter(([k]) => k !== 'csvSources' && k !== 'qualityDistinct').map(([k, v]) => `${labels[k] || k}：${k === 'sameAs' && v ? name('person', v) : v}`);
  if (data.qualityDistinct !== undefined) details.push('此版本保存的不同門市核對：' + data.qualityDistinct.length + ' 組（辨識資料改變後需重新核對）');
  return details.join('\n');
}
function openReview(type, id, conflict) {
  const r = by(type, id); if (!r) return;
  $('review-title').textContent = conflict ? '比較衝突版本' : '歷史版本';
  const versions = conflict ? r.heads : [...r.versions].sort((a, b) => b.at.localeCompare(a.at));
  $('review-body').innerHTML = `<p class="muted">${conflict ? '選擇保留的版本會解決目前全部衝突，其他版本仍留在歷史中。需要整合文字時，可選擇「編輯合併」。' : '還原會新增版本；不會抹除後續歷史。'}</p>${versions.map(o => `<article class="version"><p class="muted">${dateText(o.at)} · 裝置 ${esc(o.device.slice(0, 8))}${o.deleted ? ' · 已刪除' : ''}</p><pre>${esc(describeData(type, o.data))}</pre><button class="secondary" data-use-version="${esc(o.id)}">${conflict ? o.deleted ? '採用刪除' : '採用這個版本' : '還原這個內容'}</button> ${conflict && !o.deleted ? `<button data-merge-version="${esc(o.id)}">以此內容編輯合併</button>` : ''}</article>`).join('')}`;
  $('review').showModal();
}
async function useVersion(id) {
  const o = payload.bundle.ops.find(o => o.id === id), r = by(o.type, o.entity);
  if (!confirm('確認採用此版本？其他版本仍保留在歷史中。')) return;
  await commitRevision(o.type, o.entity, o.data, r.heads.map(h => h.id), o.deleted); $('review').close(); toast('已建立新的確認版本，等待同步。');
}
function editMerge(id) {
  const o = payload.bundle.ops.find(o => o.id === id), r = by(o.type, o.entity), heads = r.heads.map(h => h.id);
  // Open an editable copy while retaining all conflict parent IDs for explicit resolution.
  const temporary = { ...r, ...o.data, conflict: false, heads: [o] }, i = records.indexOf(r); records[i] = temporary;
  $('review').close(); openEditor(o.type, o.entity); records[i] = r; editorContext.parents = heads;
}
async function removeEntity(type, id) {
  const r = by(type, id); if (r.conflict) return openReview(type, id, true);
  if (!confirm(`將此${kinds[type]}移到回收桶？既有拜訪原文與歷史會保留。`)) return;
  await commitRevision(type, id, r.heads[0].data, r.heads.map(h => h.id), true); toast('已移到回收桶。');
}
function download(bytes, filename, type) { const url = URL.createObjectURL(new Blob([bytes], { type })); objectURLs.push(url); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => { URL.revokeObjectURL(url); objectURLs = objectURLs.filter(u => u !== url); }, 60000); }
async function exportBackup() { const envelope = await seal(payload.bundle, key, meta); download(JSON.stringify({ format: 'pharmacy-backup-1', envelope }), `pharmacy-${new Date().toISOString().slice(0, 10)}.pharmabackup`, 'application/octet-stream'); toast('已產生加密備份，請儲存到本機或外接碟。'); }
async function importBackup(file) {
  if (file.size > 36 * 1024 * 1024) throw new Error('備份檔案太大。');
  const data = JSON.parse(await file.text()); if (data.format !== 'pharmacy-backup-1') throw new Error('不是此版本的加密備份。');
  if (!payload) {
    if (await readLocal()) throw new Error('本機已有資料，請先解鎖後合併。');
    const password = $('password').value; if (!password) throw new Error('請先在密碼欄填寫備份密碼，再選取備份。');
    const restoredKey = await derive(password, data.envelope), bundle = validateBundle(await unseal(data.envelope, restoredKey));
    if (bundle.vaultId !== data.envelope.vaultId) throw new Error('備份身分不符。');
    meta = data.envelope; key = restoredKey; localRevision = 0;
    await persist({ schema: 1, device: uuid(), deviceName: '還原的裝置', token: null, bundle, dirty: true, serverVersion: 0, lastSync: null }); $('password').value = ''; await openWorkspace(); switchView('sync'); toast('已在本機還原，請重新配對 Mac。');
  } else {
    if (data.envelope.vaultId !== meta.vaultId || data.envelope.salt !== meta.salt) throw new Error('這份備份屬於另一個資料庫，已停止合併。');
    const incoming = validateBundle(await unseal(data.envelope, key)), bundle = merge(payload.bundle, incoming);
    await persist({ ...payload, bundle, dirty: true }); render(); toast('備份已合併。舊版本不會蓋掉較新的修改；可到歷史版本還原。');
  }
}
async function adoptRebuilt(event) {
  event.preventDefault();
  await run(async () => {
    if (editorContext || csvImport.hasPending()) throw new Error('請先儲存編輯或取消匯入預覽，再切換資料庫。');
    const code = $('rebuild-code').value.trim(), password = $('rebuild-connect-password').value;
    if (!code || !password || !$('rebuild-understood').checked) throw new Error('請填寫配對碼、密碼並確認隔離本機舊資料。');
    const paired = await api('/api/pair', { method: 'POST', token: null, body: { code, label: payload.deviceName } });
    const next = await openRebuiltSnapshot(paired, meta.vaultId, password, payload.deviceName);
    const envelope = await seal(next.payload, next.key, next.meta, 'device');
    const rev = await archiveAndReplaceLocal(envelope, localRevision, next.key);
    // Only adopt after the archive and active slot commit in one transaction.
    meta = next.meta; key = next.key; payload = next.payload; localRevision = rev; slot = { envelope, revision: rev, unlockKey: key };
    csvImport.reset(); qualityCache = null; qualityReview = null; editorContext = null; records = []; trail = []; focus = { type: 'store', id: '' }; graphPage = 0;
    for (const u of objectURLs) URL.revokeObjectURL(u); objectURLs = [];
    for (const id of ['focus-header', 'graph', 'graph-pager', 'focus-detail', 'evidence-list', 'store-list', 'visit-list', 'customer-list', 'entity-list', 'trash-list', 'review-body', 'editor-fields', 'quality-content']) $(id).replaceChildren();
    resetStoreFilters(); $('visit-search').value = '';
    lastError = ''; lastSyncFailure = null; syncWarning = '';
    $('rebuild-dialog').close(); $('rebuild-connect-form').reset();
    await openWorkspace(); switchView('csv'); toast('已改用重建後的資料庫。本機舊資料已隔離，請載入已核對資料包。');
  }, 'rebuild-connect-error');
  $('rebuild-connect-password').value = '';
}
async function openArchives() {
  const archives = await listLocalArchives(); $('review-title').textContent = '本機隔離備份';
  $('review-body').innerHTML = '<p>以下舊資料只保留為備份，不參與目前資料庫、同步、CSV 比對或關聯圖。匯出檔案仍使用該舊庫的原密碼。</p>' + (archives.map(a => '<article class="version"><p>' + esc(dateText(a.at)) + '</p><button data-export-archive="' + esc(a.id) + '">匯出舊庫加密備份</button></article>').join('') || '<p>這台裝置尚無隔離備份。</p>');
  $('review').showModal();
}
async function exportArchive(id) {
  const archived = await readLocalArchive(id); if (!archived?.unlockKey) throw new Error('找不到可匯出的隔離備份。');
  const old = await unseal(archived.envelope, archived.unlockKey, 'device'); validateBundle(old.bundle);
  if (old.bundle.vaultId !== archived.envelope.vaultId) throw new Error('隔離備份身分不符。');
  const envelope = await seal(old.bundle, archived.unlockKey, archived.envelope);
  download(JSON.stringify({ format: 'pharmacy-backup-1', envelope }), 'pharmacy-isolated-old-vault.pharmabackup', 'application/octet-stream');
}
async function repairPair() {
  const code = prompt('請輸入 Mac 管理頁新產生的配對碼：'); if (!code?.trim()) return;
  const paired = await api('/api/pair', { method: 'POST', token: null, body: { code: code.trim(), label: payload.deviceName } });
  if (paired.snapshot.envelope && (paired.snapshot.envelope.vaultId !== meta.vaultId || paired.snapshot.envelope.salt !== meta.salt)) throw new Error('此 Mac 是另一個資料庫，本機資料未修改。');
  await persist({ ...payload, device: paired.id, token: paired.token, serverVersion: 0, dirty: true }); await synchronize(); toast('重新配對完成。');
}
document.addEventListener('click', event => {
  const b = event.target.closest('button');
  const node = event.target.closest('[data-node-type]'); if (node && !busy) return navigate(node.dataset.nodeType, node.dataset.nodeId);
  if (!b) return;
  if (b.dataset.close) {
    if (b.dataset.close === 'rebuild-dialog' && busy) return;
    if (b.dataset.close === 'editor' && editorContext?.type === 'visit') return run(async () => {
      await flushVisitDraft(); $('editor').close(); editorContext = null;
    }, 'editor-error');
    $(b.dataset.close).close(); if (b.dataset.close === 'rebuild-dialog') $('rebuild-connect-form').reset(); if (b.dataset.close === 'editor') editorContext = null; return;
  }
  if (updateHolding || busy || !payload) return;
  if (b.id === 'connect-rebuilt') { if (editorContext || csvImport.hasPending()) return toast('請先儲存編輯或取消匯入預覽。'); $('rebuild-connect-form').reset(); $('rebuild-connect-error').textContent = ''; $('rebuild-dialog').showModal(); return; }
  if (b.id === 'view-archives') return run(openArchives);
  if (b.dataset.exportArchive) return run(() => exportArchive(b.dataset.exportArchive));
  if (b.dataset.view) return switchView(b.dataset.view);
  if (b.dataset.quickVisit) { focus = { type: 'store', id: b.dataset.quickVisit }; return openEditor('visit'); }
  if (b.id === 'resume-draft') return resumeVisitDraft();
  if (b.dataset.retailGroup !== undefined) return changeStoreFilter('groups', b.dataset.retailGroup);
  if (b.dataset.clearStoreFilters !== undefined) return changeStoreFilter('clear');
  if (b.dataset.add) return openEditor(b.dataset.add);
  if (b.dataset.fillStore) return openFillStore(b.dataset.fillStore);
  if (b.dataset.qualityTab) { qualityTab = b.dataset.qualityTab; qualityPage = 0; return renderQuality(); }
  if (b.dataset.qualityPair) return openQualityPair(b.dataset.qualityPair);
  if (b.dataset.qualityMark) return run(saveQualityReview);
  if (b.dataset.qualityPage) { qualityPage = Math.max(0, qualityPage + Number(b.dataset.qualityPage)); return renderQuality(); }
  if (b.id === 'quality-refresh') { qualityCache = null; qualityPage = 0; return renderQuality(); }
  if (b.dataset.fillSuggestion) { const field = b.dataset.fillSuggestion, suggestion = editorContext?.suggestions?.[field]?.[Number(b.dataset.suggestionIndex)]; if (suggestion && editorContext.fillFields.includes(field)) $('fill-' + field).value = suggestion.value; return; }
  if (b.dataset.edit) return openEditor(...b.dataset.edit.split(':'));
  if (b.dataset.review) return openReview(...b.dataset.review.split(':'), true);
  if (b.dataset.csvSource) return openSources(...b.dataset.csvSource.split(':'));
  if (b.dataset.csvDownload) { if (confirm('原始 CSV 是明文檔案。請確認下載到自己的本機資料夾，避開 iCloud Drive。')) download(unb64(payload.bundle.blobs[b.dataset.csvDownload]), b.dataset.csvFilename.replace(/[\/\\]/g, '_'), 'application/octet-stream'); return; }
  if (b.dataset.history) return openReview(...b.dataset.history.split(':'), false);
  if (b.dataset.delete) return run(() => removeEntity(...b.dataset.delete.split(':')));
  if (b.dataset.restore) return run(async () => { const [type, id] = b.dataset.restore.split(':'), r = by(type, id); if (r.mergedInto && !confirm('此門市曾依已裁定同店規則整併至「' + name('store', r.mergedInto) + '」。還原會重新成為獨立門市，之後必須重新核對身分。確認還原？')) return; await commitRevision(type, id, r.heads[0].data, r.heads.map(h => h.id)); toast('已還原。'); });
  if (b.dataset.useVersion) return run(() => useVersion(b.dataset.useVersion));
  if (b.dataset.mergeVersion) return editMerge(b.dataset.mergeVersion);
  if (b.dataset.attachment) { const v = by('visit', b.dataset.attachment), a = v.attachments[Number(b.dataset.index)]; download(unb64(payload.bundle.blobs[a.blob]), a.name.replace(/[\/\\]/g, '_'), 'application/octet-stream'); return; }
  if (b.dataset.graphPage) { graphPage = Math.max(0, graphPage + Number(b.dataset.graphPage)); drawGraph(); return; }
  if (b.id === 'new-note') return openEditor('visit');
  if (b.id === 'back-node') { const previous = trail.pop(); if (previous) navigate(previous.type, previous.id, false); return; }
  if (b.id === 'conflict-link') return switchView('sync');
  if (['sync-button', 'sync-now'].includes(b.id)) return run(async () => { try { await synchronize(); toast(`同步成功：${dateText(payload.lastSync)}。另一台裝置連線同步後會接收更新。`); } catch (e) { recordSyncFailure(e); throw e; } });
  if (b.id === 'check-connection') return run(checkConnection);
  if (b.id === 'export-backup') return run(exportBackup);
  if (b.id === 'import-backup') return $('backup-file').click();
  if (b.id === 'repair-pair') return run(async () => { try { await repairPair(); } catch (e) { recordSyncFailure(e); throw e; } });
});
document.addEventListener('keydown', e => { const n = e.target.closest('.node[role="button"]'); if (n && ['Enter', ' '].includes(e.key) && !busy) { e.preventDefault(); navigate(n.dataset.nodeType, n.dataset.nodeId); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (editorContext?.type === 'visit') void flushVisitDraft(); document.body.classList.add('privacy-veil'); if (payload || busy) lockNow(false); }
  else if (pendingLock || !payload) { pendingLock = false; document.body.classList.remove('privacy-veil'); showGate(); }
  else document.body.classList.remove('privacy-veil');
});
window.addEventListener('pagehide', () => { if (editorContext?.type === 'visit') void flushVisitDraft(); if (payload || busy) lockNow(false); });
window.addEventListener('pageshow', () => { if (!payload && !document.hidden) { document.body.classList.remove('privacy-veil'); showGate(); } });
$('gate-form').addEventListener('submit', initializeOrUnlock); $('editor-form').addEventListener('submit', saveEditor);
$('editor').addEventListener('close', () => editorContext = null);
$('editor-fields').addEventListener('input', event => { if (editorContext?.type === 'visit' && !['f-files'].includes(event.target.id)) scheduleVisitDraftSave(); });
$('editor-fields').addEventListener('change', event => { if (event.target.id === 'f-store') toggleQuickStoreFields(); if (editorContext?.type === 'visit' && event.target.id !== 'f-files') scheduleVisitDraftSave(); });
$('quality-content').addEventListener('change', e => { if (e.target.id === 'quality-field') { qualityField = e.target.value; qualityPage = 0; renderQuality(); } });
$('gate-restore').addEventListener('click', () => { if (!$('password').value) { $('gate-error').textContent = '請先在密碼欄填寫備份密碼。'; return; } $('backup-file').click(); });
$('backup-file').addEventListener('change', () => { const f = $('backup-file').files[0]; if (f) run(() => importBackup(f), payload ? null : 'gate-error'); $('backup-file').value = ''; });
$('rebuild-connect-form').addEventListener('submit', adoptRebuilt);
$('rebuild-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); else $('rebuild-connect-form').reset(); });
for (const prefix of ['', 'customer-']) for (const [id, field] of [['search', 'query'], ['district', 'district'], ['channel', 'kind']]) $(prefix + id).addEventListener(id === 'search' ? 'input' : 'change', event => changeStoreFilter(field, event.target.value));
$('visit-search').addEventListener('input', renderVisits);
new ResizeObserver(drawGraph).observe($('graph-wrap'));
if (!isSecureContext || !crypto.subtle) { $('gate-error').textContent = '需要受信任的 HTTPS 連線。請完成 Mac 與 iPhone 憑證設定，不要略過憑證警告。'; $('gate-submit').disabled = true; }
else {
  showGate();
  const draftBusy = () => busy || gateOpening || !!editorContext || $('review').open || $('rebuild-dialog')?.open || csvImport.hasPending() || (!$('gate').hidden && [...$('gate-form').querySelectorAll('input')].some(el => el.value && !['device-name'].includes(el.id)));
  for (const name of ['click', 'submit', 'keydown', 'beforeinput']) document.addEventListener(name, event => { if (updateHolding && event.target.closest('button,input,select,textarea,form,a')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  startUpdates({ api, hasToken: () => !!payload?.token, isBusy: draftBusy, setHold: held => { updateHolding = held; document.body.classList.toggle('update-holding', held); }, notify: toast, onOfflineReady: () => { offlineReady = true; $('secure-state').textContent = '離線介面已備妥。iPhone 請先加入主畫面，再從主畫面進行配對。'; status(); } });
  if (location.hostname === 'localhost') $('secure-state').textContent = '請使用 Mac 顯示的 .local 網址開啟 App，管理頁才使用 localhost。';
}
