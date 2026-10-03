import { newMeta, checkEnvelope, derive, seal, unseal, planBackupImport, uuid, emptyBundle, revision, project, merge, validateBundle, hashBytes, b64, unb64, MAX_BYTES, openRebuiltSnapshot, diffTextSegments, mobileLocationDevice, validCoordinates, nearestStores, storeCoordinates, planCoordinates, applyCoordinates, buildStoreEnrichmentRequest, planStoreEnrichment, applyStoreEnrichment, readonlyHealthAudit, dataSafetySummary, NEXT_REMINDER_OPTIONS, reminderHasOption, setReminderOption, reminderTaskLines, addReminderTasks, convertReminderTasks, completeReminderTask, reminderTaskHistory, searchStoreVisitText } from './core.js';
import { readLocal, writeLocal, archiveAndReplaceLocal, listLocalArchives, readLocalArchive } from './db.js';
import { createCSVImport } from './csv-ui.js';
import { PROFILE_FIELDS, FILL_FIELDS, scanQuality, setDistinctReview, sourceSuggestions, fillProfile } from './csv.js';
import { entityRule, evidenceKind, sourceTags, groupCSVNotes, storeIdentityPending, relationVisitAllowed, retailChannel, filterStoreDirectory, candidateRelationsForStore, candidateOverview, candidateTrend, visitBriefForStore, regionalOptions, regionalInsights } from './relations.js';
import { APP_VERSION } from './version.js';
import { makeVisitAttendance, visitAttendanceForStore, attendanceTaipeiDate } from './core.js';
import { startUpdates, requestLocal, diagnoseConnection } from './update-client.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const regexEscape = value => String(value ?? '').replace(/[.*+?^$\{\}()|[\]\\]/g, char => '\\' + char);
function highlightLiteral(value, query) {
  const text = String(value ?? ''), needle = String(query ?? '').trim();
  if (!needle) return esc(text);
  const pattern = new RegExp(regexEscape(needle), 'giu');
  let html = '', last = 0, match;
  while ((match = pattern.exec(text))) {
    html += esc(text.slice(last, match.index)) + '<mark class="search-match">' + esc(match[0]) + '</mark>';
    last = match.index + match[0].length;
    if (!match[0].length) pattern.lastIndex++;
  }
  return html + esc(text.slice(last));
}
const titles = { explore: '關聯探索', visits: '拜訪', stores: '門市', regional: '區域觀察', entities: '人物與主題', csv: '匯入 CSV', quality: '資料整理', sync: '資料與安全', trash: '回收桶' };
const kinds = { store: '門市', visit: '拜訪', person: '人物', topic: '主題' };
const NEARBY_STORE_LIMIT = 4;
function reminderOptionsHTML(targetId) {
  return `<fieldset class="reminder-options" data-reminder-options-for="${esc(targetId)}"><legend>快速勾選（可複選）</legend><p class="muted">勾選會加入下方新增待辦；取消只移除尚未儲存的相同項目，已保存的任務與歷史不會改動。</p><div class="reminder-option-grid">${NEXT_REMINDER_OPTIONS.map(option => `<label class="check"><input type="checkbox" data-reminder-option value="${esc(option)}">${esc(option)}</label>`).join('')}</div><div class="reminder-custom-option"><label class="check"><input type="checkbox" data-reminder-custom-toggle>自訂</label><input type="text" data-reminder-custom-input maxlength="120" placeholder="空白，自行填寫" aria-label="自訂下次記得項目" autocomplete="off"></div></fieldset>`;
}
function reminderOptionTarget(group) { return $(group?.dataset.reminderOptionsFor || ''); }
function reminderOptionError(group, message = '') {
  const target = group?.closest('#store-reminder-dialog') ? $('store-reminder-error') : $('editor-error');
  if (target) target.textContent = message;
}
function syncReminderOptionGroup(group) {
  const target = reminderOptionTarget(group); if (!target) return;
  group.querySelectorAll('[data-reminder-option]').forEach(input => { input.checked = reminderHasOption(target.value, input.value); });
  const applied = group.dataset.customApplied || '';
  if (applied && !reminderHasOption(target.value, applied)) {
    group.dataset.customApplied = '';
    group.querySelector('[data-reminder-custom-toggle]').checked = false;
  }
}
function resetReminderOptionGroup(targetId) {
  const group = document.querySelector(`[data-reminder-options-for="${CSS.escape(targetId)}"]`); if (!group) return;
  group.dataset.customApplied = '';
  group.querySelector('[data-reminder-custom-toggle]').checked = false;
  group.querySelector('[data-reminder-custom-input]').value = '';
  syncReminderOptionGroup(group);
}
function setReminderDraftValue(group, value) {
  const target = reminderOptionTarget(group), limit = Number(target?.maxLength || 2000);
  if (!target) return false;
  if (value.length > limit) { reminderOptionError(group, `下次記得最多 ${limit} 個字；這個選項尚未加入。`); return false; }
  reminderOptionError(group);
  target.value = value;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
function changeReminderOption(input) {
  const group = input.closest('[data-reminder-options-for]'), target = reminderOptionTarget(group); if (!target) return;
  const before = target.value, after = setReminderOption(before, input.value, input.checked);
  if (!setReminderDraftValue(group, after)) input.checked = !input.checked;
}
function changeCustomReminderOption(group, selected = true) {
  const target = reminderOptionTarget(group), toggle = group.querySelector('[data-reminder-custom-toggle]'), input = group.querySelector('[data-reminder-custom-input]');
  if (!target) return;
  const before = target.value, previous = group.dataset.customApplied || '', current = input.value.replace(/[\r\n]+/g, ' ').trim();
  if (!selected) {
    if (!setReminderDraftValue(group, previous ? setReminderOption(before, previous, false) : before)) { toggle.checked = true; return; }
    group.dataset.customApplied = ''; return;
  }
  if (!current) { toggle.checked = true; return; }
  let after = previous && previous !== current ? setReminderOption(before, previous, false) : before;
  after = setReminderOption(after, current, true);
  if (!setReminderDraftValue(group, after)) { input.value = previous; toggle.checked = !!previous; return; }
  group.dataset.customApplied = current; toggle.checked = true;
}
function reminderTasksHTML(store, interactive = true) {
  const tasks = store.nextRememberTasks || [], pending = tasks.filter(t => !t.completedAt), completed = reminderTaskHistory(store);
  if (!tasks.length && !completed.length) return '';
  const attrs = `data-reminder-store="${esc(store.id)}" data-reminder-head="${esc(store.heads?.[0]?.id || '')}"`;
  return `<section class="reminder-task-list">${pending.length ? `<strong>下次記得：待辦 ${pending.length} 項</strong>` + pending.map(task => `<label class="reminder-task-row"><input type="checkbox" ${interactive ? `data-reminder-complete="${esc(task.id)}" ${attrs}` : 'disabled'} aria-label="完成：${esc(task.text)}"><span>${esc(task.text)}</span></label>`).join('') : ''}${completed.length ? `<details class="reminder-task-history"><summary>已完成 · ${completed.length} 項</summary>${completed.map(task => `<div class="reminder-task-done"><span>✓ ${esc(task.text)}</span><small>完成：${esc(dateText(task.completedAt))}${task.historical ? ' · 歷史版本紀錄（目前狀態不同）' : ''}</small>${interactive && !task.historical ? `<button type="button" class="text-button" data-reminder-repeat="${esc(task.id)}" ${attrs}>再加入待辦</button>` : ''}</div>`).join('')}</details>` : ''}</section>`;
}
function legacyReminderDraftHTML(data) {
  const text = data.nextRemember || '', lines = reminderTaskLines(text);
  if (!lines.length) return '';
  return `<section class="reminder-legacy"><strong>既有下次記得（尚未轉成任務）</strong><pre>${esc(text)}</pre><details><summary>轉換預覽：依換行分為 ${lines.length} 項</summary><ol>${lines.map(line => `<li>${esc(line)}</li>`).join('')}</ol><p class="muted">只依換行分項，不猜測逗號、數量或意思；原始文字會留存在轉換來源與門市歷史。</p></details><label class="check"><input type="checkbox" data-reminder-convert>儲存時將以上 ${lines.length} 項轉成待辦</label></section>`;
}
function reminderFormData(data, targetId) {
  const target = $(targetId), convert = target.closest('form').querySelector('[data-reminder-convert]')?.checked;
  return addReminderTasks(convert ? convertReminderTasks(data) : data, target.value);
}
function confirmReminderChange(before, after) {
  const previous = new Set((before.nextRememberTasks || []).map(t => t.id));
  const added = (after.nextRememberTasks || []).filter(t => !previous.has(t.id));
  const converted = (after.nextRememberImports || []).length > (before.nextRememberImports || []).length;
  const everyChanged = (before.everyTimeMust || '') !== (after.everyTimeMust || '');
  const impact = [added.length ? `新增 ${added.length} 項待辦：\n${added.map(t => '□ ' + t.text).join('\n')}` : '', converted ? '既有下次記得將改用任務顯示；完整原始文字與舊版本保留。' : '', everyChanged ? `每次必做、必給\n修改前：${before.everyTimeMust || '（空白）'}\n修改後：${after.everyTimeMust || '（空白）'}` : ''].filter(Boolean);
  return !impact.length || confirm(impact.join('\n\n') + '\n\n確認儲存這間門市的提醒？拜訪原文不會修改。');
}
async function changeReminderTask(storeId, taskId, expectedHead, repeat = false) {
  if (singleStoreContext || editorContext || reminderContext || payload?.inlineTextDraft || inlineTextContext?.after !== inlineTextContext?.before) throw new Error('請先完成或取消目前的修改，再勾選任務。');
  const store = by('store', storeId);
  if (!store || store.deleted || store.conflict || store.heads[0].id !== expectedHead) throw new Error('門市已有新版本或衝突；本次沒有寫入，請重新開啟核對。');
  const task = store.nextRememberTasks?.find(t => t.id === taskId);
  if (!task) throw new Error('找不到這項任務；本次沒有寫入。');
  if (!repeat && task.completedAt) return toast('這項任務已完成，沒有重複寫入。');
  if (repeat && !task.completedAt) throw new Error('這項任務仍在待辦中，沒有重複加入。');
  const data = repeat ? addReminderTasks(store.heads[0].data, task.text) : completeReminderTask(store.heads[0].data, taskId);
  const impact = repeat ? '將新增一項同內容待辦；先前完成紀錄仍保留。' : '將記錄完成時間，並移到「已完成」歷史；不刪除任務。';
  if (!confirm(`${store.name}\n${task.text}\n\n${impact}\n拜訪原文與每次必做、必給保持原樣。\n確認${repeat ? '再加入待辦' : '完成'}？`)) return;
  const briefStoreId = $('review').open && $('review').classList.contains('visit-brief-dialog') ? $('review').dataset.singleStoreId : '';
  const choice = await confirmStoreSave(store.id, store.name); if (!choice) return;
  assertSaveParents('store', store.id, [expectedHead]);
  await commitRevision('store', store.id, data, [expectedHead], false, {}, choice.attendance);
  if (briefStoreId) openVisitBrief(briefStoreId, { preservePosition: true });
  toast(repeat ? '已新增待辦，先前完成歷史保留。' : '已完成並保留紀錄，可展開「已完成」查看。');
}
function lockPhoneViewportScale() {
  if (!window.matchMedia?.('(max-width: 760px)').matches) return;
  const horizontalScrollSelector = '.rail nav,#store-list,.csv-table-wrap,.quality-table-wrap';
  const preventScale = event => event.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, preventScale, { passive: false });
  let touchOrigin = null;
  document.addEventListener('touchstart', event => {
    const touch = event.touches?.length === 1 ? event.touches[0] : null;
    touchOrigin = touch ? { x: touch.clientX, y: touch.clientY, horizontalScroller: !!event.target?.closest?.(horizontalScrollSelector) } : null;
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (event.touches?.length > 1) return event.preventDefault();
    const touch = event.touches?.[0];
    if (!touch || !touchOrigin || touchOrigin.horizontalScroller) return;
    const dx = Math.abs(touch.clientX - touchOrigin.x), dy = Math.abs(touch.clientY - touchOrigin.y);
    if (dx > dy + 4) event.preventDefault();
  }, { passive: false });
  for (const type of ['touchend', 'touchcancel']) document.addEventListener(type, () => { touchOrigin = null; }, { passive: true });
  const resetHorizontalOffset = () => {
    const root = document.scrollingElement;
    if (root?.scrollLeft) root.scrollLeft = 0;
    if (document.documentElement?.scrollLeft) document.documentElement.scrollLeft = 0;
    if (document.body?.scrollLeft) document.body.scrollLeft = 0;
    if (window.scrollX) window.scrollTo(0, window.scrollY);
  };
  document.addEventListener('scroll', resetHorizontalOffset, { passive: true });
  window.visualViewport?.addEventListener('scroll', resetHorizontalOffset, { passive: true });
  window.visualViewport?.addEventListener('resize', resetHorizontalOffset, { passive: true });
  window.addEventListener('pageshow', resetHorizontalOffset, { passive: true });
  requestAnimationFrame(resetHorizontalOffset);
}
lockPhoneViewportScale();
function installPhoneEditingViewport() {
  if (!window.matchMedia?.('(max-width: 760px)').matches) return;
  const root = document.documentElement, viewport = window.visualViewport;
  let frame = 0, revealCaret = false, viewportChanged = false;
  let previousHeight = viewport?.height || window.innerHeight, previousTop = viewport?.offsetTop || 0, fallbackHeight = window.innerHeight;
  let allowViewportPan = true;
  let pointer = null, suppressSelectionUntil = 0;
  const observed = new Set();
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule(false)) : null;
  function schedule(reveal = false, resized = false) {
    revealCaret ||= reveal; viewportChanged ||= resized;
    if (!frame) frame = requestAnimationFrame(update);
  }
  function textControl(element) {
    return element?.matches?.('textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="color"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"])') && !element.disabled && !element.readOnly;
  }
  function controlCaret(control) {
    const rect = control.getBoundingClientRect();
    // Single-line controls need no text copy (especially passwords/pairing codes).
    if (control.tagName !== 'TEXTAREA') return rect;
    if (control.selectionStart !== control.selectionEnd) return null;
    const style = getComputedStyle(control), mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true'); mirror.setAttribute('data-phone-caret-mirror', ''); mirror.inert = true;
    Object.assign(mirror.style, { position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', pointerEvents: 'none', userSelect: 'none', margin: '0', height: 'auto', minHeight: '0', maxHeight: 'none', overflow: 'visible' });
    for (const prop of ['boxSizing', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'fontStretch', 'fontVariant', 'fontKerning', 'fontFeatureSettings', 'fontVariationSettings', 'textRendering', 'wordBreak', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textIndent', 'textTransform', 'direction', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle']) mirror.style[prop] = style[prop];
    // Match the actual text area width, excluding its native vertical scrollbar.
    mirror.style.width = `${control.clientWidth + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0)}px`;
    mirror.style.boxSizing = 'border-box';
    mirror.style.whiteSpace = control.wrap === 'off' ? 'pre' : 'pre-wrap';
    mirror.style.overflowWrap = control.wrap === 'off' ? 'normal' : 'break-word';
    const offset = Math.min(control.value.length, control.selectionEnd ?? 0);
    const before = document.createTextNode(control.value.slice(0, offset));
    const marker = document.createElement('span');
    marker.textContent = control.value.slice(offset) || '\u200b';
    mirror.append(before, marker);
    try {
      document.body.append(mirror);
      const markerRect = marker.getClientRects()[0] || marker.getBoundingClientRect();
      const mirrorRect = mirror.getBoundingClientRect();
      const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 16) * 1.5;
      const localTop = markerRect.top - mirrorRect.top;
      const contentTop = control.clientTop + (parseFloat(style.paddingTop) || 0);
      const contentBottom = control.clientTop + control.clientHeight - (parseFloat(style.paddingBottom) || 0);
      // Scroll only the control's own text when its current caret is internally clipped.
      if (localTop - control.scrollTop < contentTop) control.scrollTop = Math.max(0, localTop - contentTop);
      else if (localTop + lineHeight - control.scrollTop > contentBottom) control.scrollTop += localTop + lineHeight - control.scrollTop - contentBottom;
      const top = rect.top + localTop - control.scrollTop;
      return { top, bottom: top + lineHeight, height: lineHeight };
    } finally { mirror.remove(); }
  }
  function scrollContainer(element, dialog) {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent === document.body || parent === document.documentElement) break;
      if (parent === dialog || /^(auto|scroll|overlay)$/.test(getComputedStyle(parent).overflowY)) return parent;
    }
    return null;
  }
  function update() {
    frame = 0;
    const top = Math.max(0, viewport?.offsetTop || 0), height = viewport?.height || window.innerHeight;
    if (!Number.isFinite(height) || height <= 0) return;
    const expanding = height > previousHeight + 1;
    const shrinking = height < previousHeight - 1, panning = Math.abs(top - previousTop) > 1;
    previousHeight = height; previousTop = top;
    root.style.setProperty('--phone-visible-top', `${top}px`);
    root.style.setProperty('--phone-visible-height', `${height}px`);
    root.style.setProperty('--phone-visible-bottom', `${top + height}px`);
    if (!viewport) fallbackHeight = Math.max(fallbackHeight, window.innerHeight);
    const keyboardInset = Math.max(0, (viewport ? window.innerHeight : fallbackHeight) - height);
    root.style.setProperty('--phone-keyboard-inset', `${keyboardInset}px`);
    const keyboard = keyboardInset > 120;
    root.classList.toggle('phone-keyboard-open', keyboard);
    const active = document.activeElement;
    const dialog = active?.closest?.('dialog[open]') || [...document.querySelectorAll('dialog[open]')].at(-1);
    const scope = dialog || document;
    const actions = [...scope.querySelectorAll('.inline-edit-actions:not([hidden])')].filter(el => el.getClientRects().length);
    const dock = actions[0];
    for (const action of observed) if (!actions.includes(action)) { resizeObserver?.unobserve(action); observed.delete(action); }
    for (const action of actions) if (!observed.has(action)) { resizeObserver?.observe(action); observed.add(action); }
    const dockHeight = dock?.getBoundingClientRect().height || 0;
    root.style.setProperty('--phone-edit-dock-height', `${dockHeight}px`);
    const reveal = revealCaret || (viewportChanged && (shrinking || panning) && !expanding && performance.now() >= suppressSelectionUntil);
    viewportChanged = false;
    // Geometry still follows a closing keyboard, but it must not pull reading back to the caret.
    if (!keyboard || expanding) { revealCaret = false; return; }
    if (pointer) { if (pointer.moved) revealCaret = false; else revealCaret ||= reveal || shrinking; return; }
    revealCaret = false;
    if (!reveal) return;
    const control = textControl(active) ? active : null;
    const editor = control || active?.closest?.('[data-inline-edit-text]');
    if (!editor) return;
    let caret;
    if (control) caret = controlCaret(control);
    else {
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed === false || !editor.contains(selection.focusNode)) return;
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(false);
      caret = range.getBoundingClientRect();
      // Empty/newline caret ranges may have no rect. Measure adjacent text without changing the DOM or selection.
      if (!caret.height) {
        let node = range.startContainer, offset = range.startOffset;
        if (node.nodeType !== 3) {
          const previous = offset > 0;
          node = node.childNodes?.[previous ? offset - 1 : 0];
          while (node?.[previous ? 'lastChild' : 'firstChild']) node = node[previous ? 'lastChild' : 'firstChild'];
          offset = previous ? node?.textContent?.length || 0 : 0;
        }
        if (node?.nodeType === 3 && node.textContent?.length) {
          range.setStart(node, Math.max(0, offset - 1));
          range.setEnd(node, Math.max(1, offset));
          caret = range.getBoundingClientRect();
        }
        else if (node?.nodeType === 1 && node.tagName === 'BR') caret = node.getBoundingClientRect();
      }
    }
    if (!caret?.height) return;
    const scroller = scrollContainer(editor, dialog), bounds = scroller?.getBoundingClientRect();
    let lower = Math.min(top + height - 16, dock ? dock.getBoundingClientRect().top - 12 : Infinity, bounds ? bounds.bottom - 8 : Infinity);
    let upper = Math.max(top + 12, bounds ? bounds.top + 8 : 0);
    if (dialog) {
      const header = dialog.querySelector(':scope > .section-row, :scope > form > .section-row');
      const headerRect = header?.getBoundingClientRect();
      if (headerRect && !header.contains(editor)) upper = Math.max(upper, headerRect.bottom + 8);
      const footer = dialog.querySelector('.dialog-footer');
      if (footer && !footer.contains(editor) && ['sticky', 'fixed'].includes(getComputedStyle(footer).position)) lower = Math.min(lower, footer.getBoundingClientRect().top - 8);
    }
    if (lower <= upper) return;
    const delta = caret.bottom > lower ? caret.bottom - lower : caret.top < upper ? caret.top - upper : 0;
    if (delta) {
      if (scroller) scroller.scrollTop += delta;
      else window.scrollBy({ top: delta, left: 0, behavior: 'instant' });
    }
  }
  viewport?.addEventListener('resize', () => schedule(false, true), { passive: true });
  viewport?.addEventListener('scroll', () => schedule(false, allowViewportPan), { passive: true });
  window.addEventListener('resize', () => schedule(false, true), { passive: true });
  window.addEventListener('pageshow', () => schedule(false), { passive: true });
  document.addEventListener('focusin', () => { allowViewportPan = true; schedule(true); });
  document.addEventListener('focusout', () => schedule(false));
  document.addEventListener('input', () => { allowViewportPan = true; schedule(true); });
  document.addEventListener('selectionchange', () => { if (!pointer && performance.now() >= suppressSelectionUntil) schedule(true); });
  document.addEventListener('pointerdown', event => { pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, target: event.target }; }, { passive: true });
  document.addEventListener('pointermove', event => { if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) { pointer.moved = true; revealCaret = false; allowViewportPan = false; } }, { passive: true });
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, () => {
    const moved = pointer?.moved, target = pointer?.target; pointer = null;
    if (moved || type === 'pointercancel') { revealCaret = false; allowViewportPan = false; suppressSelectionUntil = performance.now() + 250; }
    else if (target === document.activeElement && (textControl(target) || target?.closest?.('[data-inline-edit-text]'))) { allowViewportPan = true; schedule(true); }
    else if (revealCaret) schedule(true);
  }, { passive: true });
  document.addEventListener('wheel', () => { allowViewportPan = false; revealCaret = false; suppressSelectionUntil = performance.now() + 250; }, { passive: true });
  if (typeof MutationObserver === 'function') new MutationObserver(records => {
    // Ignore the transient, hidden measurement mirror; it never represents an App layout change.
    if (records.some(record => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node => !node.hasAttribute?.('data-phone-caret-mirror')))) schedule(false);
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] });
  schedule(false);
}
installPhoneEditingViewport();
let key = null, meta = null, payload = null, slot = null, localRevision = 0, busy = false, pendingLock = false, activeView = 'visits';
let focus = { type: 'topic', id: '' }, graphPage = 0, trail = [], records = [], editorContext = null, toastTimer, autoTimer, objectURLs = [];
let lastError = '', offlineReady = false, storagePersistent = false, autoFetching = false, gateOpening = false;
let qualityTab = 'duplicates', qualityField = '', qualityPage = 0, qualityCache = null, qualityReview = null;
let storeFilters = { query: '', district: '', kind: '', groups: [] };
let regionalCity = '', regionalDistrict = '';
let updateHolding = false, macProgram = null, lastSyncFailure = null, syncWarning = '';
let draftTimer = null, draftSaveChain = Promise.resolve(), discardingDraft = false, singleStoreContext = null, quickTextContext = null, inlineTextContext = null, inlineDraftTimer = null, inlineDraftSaveChain = Promise.resolve(), reminderContext = null, transientResumeState = null;
let versionReview = null, resolutionPreview = null;
let coordinatePreview = null, enrichmentPreview = null, backupPreview = null;
let reminderDraftTimer = null, reminderDraftSaveChain = Promise.resolve();
let attendancePrompt = null, attendanceCache = null;
let localSaveState = 'unknown', syncInProgress = false, syncEpoch = 0;
const syncScheduler = createSyncScheduler({ ready: canAutoSync, attempt: autoSync, onChange: renderDataSafetyEntry });
function storeAttendance(storeId) {
  const today = attendanceTaipeiDate(Date.now());
  if (attendanceCache?.bundle !== payload.bundle || attendanceCache.today !== today) {
    const grouped = new Map();
    for (const op of payload.bundle.ops) if (op.visitAttendance) {
      const id = op.visitAttendance.store;
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(op);
    }
    attendanceCache = { bundle: payload.bundle, today, grouped, summaries: new Map() };
  }
  if (!attendanceCache.summaries.has(storeId)) attendanceCache.summaries.set(storeId, visitAttendanceForStore({ ops: attendanceCache.grouped.get(storeId) || [] }, storeId));
  return attendanceCache.summaries.get(storeId);
}
function storeAttendanceHTML(storeId, history = false) {
  const summary = storeAttendance(storeId);
  const elapsed = `距離${summary.daysSince} 天`;
  const text = summary.latestDate ? `最近拜訪：${summary.latestDate} · ${summary.hasFutureDates ? '日期晚於今天，請核對裝置時間' : elapsed}` : '尚無已確認的拜訪日期';
  return `<div class="store-attendance">${esc(text)}${history && summary.history.length ? `<details class="attendance-history"><summary>已確認拜訪日 · ${summary.history.length} 天</summary><p class="muted">以台北日期計算；同日多次勾選合併顯示，以下保留每次確認來源。</p>${summary.history.map(day => `<section data-attendance-date="${esc(day.date)}"><strong>${esc(day.date)}</strong>${day.occurrences.map(item => `<p>${esc(new Date(item.at).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }))} · ${item.type === 'visit' ? '拜訪筆記儲存時確認' : '門市資料／待辦儲存時確認'}<small>來源版本：${esc(item.revisionId)}</small></p>`).join('')}</section>`).join('')}</details>` : ''}</div>`;
}
function assertSaveParents(type, id, parents) {
  const current = project(payload.bundle).find(record => record.type === type && record.id === id);
  if (parents.length ? !current || current.deleted || current.conflict || JSON.stringify(quickTextParents(current)) !== JSON.stringify([...parents].sort()) : !!current) throw new Error('資料已有新版本或衝突，本次沒有寫入；請重新開啟核對。');
}
function finishAttendancePrompt(result = null) {
  const prompt = attendancePrompt; if (!prompt) return;
  attendancePrompt = null;
  $('visit-attendance-dialog').close();
  for (const id of ['visit-attendance-store', 'visit-attendance-scope', 'visit-attendance-date', 'visit-attendance-error']) $(id).textContent = '';
  $('visit-attendance-check').checked = false;
  prompt.resolve(result);
}
async function confirmStoreSave(storeId, storeName, changed = true) {
  // Complete draft writes first; no formal data is committed while the prompt is open.
  await Promise.all([draftSaveChain, inlineDraftSaveChain, reminderDraftSaveChain]);
  if (!payload || document.hidden || pendingLock) throw new Error('請先回到 App 解鎖後再儲存，原修改仍保留。');
  const sessionKey = key, bundle = payload.bundle;
  const currentStore = project(bundle).find(record => record.type === 'store' && record.id === storeId);
  if (currentStore && (currentStore.deleted || currentStore.conflict)) throw new Error('門市已刪除或有衝突，本次沒有寫入；請先核對門市。');
  const dialog = $('visit-attendance-dialog');
  $('visit-attendance-check').checked = false;
  $('visit-attendance-store').textContent = storeName;
  $('visit-attendance-scope').textContent = changed ? '確認後才儲存剛才的修改。未勾選代表單純更新資料，不改變最近實際拜訪日期。' : '內容沒有變更。勾選後只新增本次實際拜訪的確認紀錄；未勾選則不寫入任何資料。';
  $('visit-attendance-error').textContent = '';
  const result = await new Promise(resolve => {
    attendancePrompt = { resolve, storeId, date: attendanceTaipeiDate(Date.now()) };
    $('visit-attendance-date').textContent = attendancePrompt.date + '（台北時間）';
    openDialog(dialog);
  });
  await Promise.all([draftSaveChain, inlineDraftSaveChain, reminderDraftSaveChain]);
  if (!result) return null;
  if (!payload || key !== sessionKey || payload.bundle !== bundle || document.hidden || pendingLock) throw new Error('確認期間資料或工作階段已變更，本次沒有寫入；請重新檢查後再儲存。');
  return result;
}
let nearbyState = { status: 'idle', position: null, message: '' }, nearbyRequest = 0, nearbyDenied = false;
const csvImport = createCSVImport({ host: $('csv-view'), getState: () => payload, run, saveBundle: async bundle => { await persist({ ...payload, bundle, dirty: true }); render(); }, notify: toast, exportReport: report => download(JSON.stringify({ ...report, appVersion: APP_VERSION }, null, 2), 'pharmacy-import-preview.json', 'application/json'), downloadSource: (blob, filename) => { if (!confirm('原始 CSV 是明文檔案。請確認下載到自己的本機資料夾，避開 iCloud Drive。')) return; download(unb64(payload.bundle.blobs[blob]), filename.replace(/[\/\\]/g, '_'), 'application/octet-stream'); } });
const all = type => records.filter(r => r.type === type && (!r.deleted || r.conflict));
const by = (type, id) => records.find(r => r.type === type && r.id === id);
const name = (type, id) => by(type, id)?.name || (type === 'store' ? '已刪除／未命名門市' : '已刪除節點');
const dateText = at => at ? new Date(at).toLocaleString('zh-TW', { hour12: false }) : '尚未同步';
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 6500); }
let dialogScrollLock = null;
function dismissKeyboard() {
  const active = document.activeElement;
  if (active?.matches?.('input,textarea') || active?.isContentEditable) active.blur();
}
function focusReadingSurface(scope = null) {
  const dialog = scope?.closest?.('dialog[open]') || document.activeElement?.closest?.('dialog[open]') || [...document.querySelectorAll('dialog[open]')].at(-1);
  dismissKeyboard();
  const target = dialog?.querySelector('[data-dialog-focus]') || ($('workspace').hidden ? $('gate-title') : $('page-title'));
  target?.focus({ preventScroll: true });
}
const invalidForms = new WeakSet();
function showValidationWithoutKeyboard(event) {
  event.preventDefault();
  const field = event.target, form = field.form;
  if (!form || invalidForms.has(form)) return;
  invalidForms.add(form); queueMicrotask(() => invalidForms.delete(form));
  dismissKeyboard();
  const error = form.querySelector('[role="alert"],.error') || form.closest('dialog')?.querySelector('[role="alert"],.error') || $('gate-error');
  if (error) error.textContent = '請檢查未完成或格式不符的欄位：' + field.validationMessage;
  for (let parent = field.parentElement; parent && parent !== form; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
  field.scrollIntoView({ block: 'nearest' });
}
function lockDialogBackground() {
  if (dialogScrollLock) return;
  const scrollTop = document.scrollingElement?.scrollTop || window.scrollY || 0;
  dialogScrollLock = { scrollTop, bodyTop: document.body.style.top };
  document.documentElement.classList.add('dialog-scroll-locked');
  document.body.classList.add('dialog-scroll-locked');
  document.body.style.top = '-' + scrollTop + 'px';
}
function releaseDialogBackground() {
  if (!dialogScrollLock || document.querySelector('dialog[open]')) return;
  const state = dialogScrollLock; dialogScrollLock = null;
  document.documentElement.classList.remove('dialog-scroll-locked');
  document.body.classList.remove('dialog-scroll-locked');
  document.body.style.top = state.bodyTop;
  window.scrollTo(0, state.scrollTop);
}
function resetDialogScroll(dialog) {
  dialog.scrollTop = 0;
  if (dialog.id === 'review') $('review-body').scrollTop = 0;
}
function setReviewMode(mode) {
  const review = $('review'), actions = $('review-persistent-actions');
  review.classList.toggle('visit-brief-dialog', mode === 'visit-brief');
  if (mode !== 'visit-brief') { clearBriefSearch(); delete review.dataset.singleStoreId; singleStoreContext = null; actions.hidden = true; actions.replaceChildren(); }
}
function openDialog(dialog, { reviewMode = '' } = {}) {
  if (dialog.id === 'review') setReviewMode(reviewMode);
  // Capture a non-editable return target before native dialog focus/close restoration.
  if (!dialog.open) focusReadingSurface();
  lockDialogBackground(); resetDialogScroll(dialog);
  if (!dialog.open) dialog.showModal();
  resetDialogScroll(dialog);
  focusReadingSurface(dialog);
  requestAnimationFrame(() => { if (dialog.open) resetDialogScroll(dialog); });
}
function buttons(disabled) {
  document.querySelectorAll('button, [data-reminder-complete], #csv-view input, #csv-view select, #regional-view select, #editor input, #editor select, #editor textarea, #review input, #review select, #review textarea, #store-reminder-dialog input, #store-reminder-dialog textarea, #backup-ack').forEach(el => {
    if (el.dataset.close || el.closest('#visit-attendance-dialog')) return;
    if (disabled) { el.dataset.busyDisabled = el.disabled ? '1' : '0'; el.disabled = true; }
    else if (el.dataset.busyDisabled !== undefined) { el.disabled = el.dataset.busyDisabled === '1'; delete el.dataset.busyDisabled; }
  });
  if (!disabled) { updateBackupControls(); refreshBriefSearch(); }
}
async function run(fn, errorTarget) {
  if (busy || updateHolding) return;
  busy = true; buttons(true);
  try { if (errorTarget) $(errorTarget).textContent = ''; await fn(); }
  catch (e) { if (errorTarget) $(errorTarget).textContent = e.message; else toast(e.message); }
  finally { busy = false; buttons(false); if (pendingLock) lockNow(!document.hidden); syncScheduler.wake(); }
}
function programDetail() {
  return '本機 App v' + APP_VERSION + ' · ' + (macProgram ? 'Mac 程式 v' + macProgram.version + '（確認於 ' + dateText(macProgram.at) + '）' : 'Mac 程式版本尚待連線確認');
}
async function api(path, options = {}) {
  const session = syncSession();
  return requestLocal(path, { token: payload?.token, ...options }, version => {
    if (key !== session.key || meta !== session.meta || payload?.token !== session.token || syncEpoch !== session.epoch) return;
    macProgram = { version, at: new Date().toISOString() };
    if (payload) { $('program-detail').textContent = programDetail(); renderHealthAudit(); }
  });
}
async function checkConnection() {
  const output = $('connection-check');
  output.hidden = false; output.textContent = '正在檢查 Mac 服務、HTTPS 與配對…';
  const result = await diagnoseConnection({ api, hasToken: () => !!payload?.token });
  output.textContent = '檢查時間：' + dateText(result.checkedAt) + '\nMac 服務：' + result.service + '\nHTTPS：' + result.tls + '\n裝置配對：' + result.pairing + (result.version !== null ? '\nMac 目前資料版本：' + result.version : '') + '\n' + result.message;
}
async function persist(next) {
  const previous = payload, sessionKey = key, sessionMeta = meta, expected = localRevision;
  const formalChange = hasNewFormalChanges(previous, next) && !syncInProgress;
  next = withPendingSync(previous, next);
  localSaveState = 'saving'; renderDataSafetyEntry();
  try {
    const envelope = await seal(next, sessionKey, sessionMeta, 'device');
    if (key !== sessionKey || meta !== sessionMeta || payload !== previous || localRevision !== expected) throw new Error('儲存期間資料或工作階段已變更，本次沒有覆蓋較新的內容；請重試。');
    const rev = await writeLocal(envelope, expected, sessionKey);
    if (key !== sessionKey || meta !== sessionMeta || payload !== previous || localRevision !== expected) throw new Error('本機寫入已完成，但工作階段已變更；請重新開啟核對。');
    localRevision = rev; slot = { envelope, revision: rev, unlockKey: key }; payload = next;
    localSaveState = 'saved';
    $('save-state').textContent = '手機已保存：已加密儲存於本機';
    if (formalChange) syncScheduler.request('saved');
  } catch (error) {
    if (key === sessionKey && meta === sessionMeta) localSaveState = 'failed';
    throw error;
  } finally { renderDataSafetyEntry(); }
}
function hasNewFormalChanges(previous, next) {
  if (!previous || !next?.dirty || previous.bundle?.vaultId !== next.bundle?.vaultId) return false;
  const before = new Set(previous.bundle.ops.map(op => op.id));
  return next.bundle.ops.some(op => !before.has(op.id));
}
function withPendingSync(previous, next) {
  if (!next.dirty) return { ...next, pendingSync: { entities: [], unknown: false } };
  const entities = new Set(Array.isArray(previous?.pendingSync?.entities) ? previous.pendingSync.entities : []);
  const before = new Set((previous?.bundle?.ops || []).map(op => op.id));
  for (const op of next.bundle?.ops || []) if (!before.has(op.id)) entities.add(op.type + ':' + op.entity);
  const legacyUnknown = previous?.dirty === true && !previous.pendingSync;
  return { ...next, pendingSync: { entities: [...entities].sort(), unknown: legacyUnknown && !entities.size } };
}
function pendingSyncSummary() {
  const tracking = payload?.pendingSync;
  const entities = Array.isArray(tracking?.entities) ? [...new Set(tracking.entities)] : [];
  const counts = { visit: 0, store: 0, person: 0, topic: 0, source: 0, other: 0 };
  for (const key of entities) {
    const type = String(key).split(':', 1)[0];
    if (Object.hasOwn(counts, type)) counts[type]++; else counts.other++;
  }
  return { count: entities.length, counts, unknown: payload?.dirty === true && (tracking?.unknown === true || !tracking) };
}
function pendingSyncText(summary) {
  if (!payload?.dirty) return '0 筆';
  if (summary.unknown) return '有待同步變更；完成一次同步後即可開始精確計數';
  const labels = { visit: '筆拜訪', store: '間門市', person: '位人物', topic: '個主題', source: '份來源快照', other: '項其他資料' };
  const parts = Object.entries(summary.counts).filter(([, count]) => count).map(([type, count]) => count + ' ' + labels[type]);
  return summary.count + ' 項' + (parts.length ? '（' + parts.join('、') + '）' : '');
}
function draftState(message, state = '') {
  const el = singleStoreContext ? $('single-store-draft-state') : $('draft-save-state'); if (!el) return;
  el.textContent = message; el.dataset.state = state;
}
function recentStores(limit = 6) {
  const latest = new Map();
  const availableStores = all('store').filter(store => !store.conflict);
  for (const visit of all('visit')) {
    const at = Math.max(0, ...(visit.versions || []).map(v => Date.parse(v.at) || 0));
    latest.set(visit.store, Math.max(latest.get(visit.store) || 0, at));
  }
  for (const store of availableStores) {
    const at = Math.max(0, ...(store.versions || []).map(v => Date.parse(v.at) || 0));
    if (!latest.has(store.id)) latest.set(store.id, at);
  }
  return availableStores.sort((a, b) => (latest.get(b.id) || 0) - (latest.get(a.id) || 0) || a.name.localeCompare(b.name, 'zh-Hant')).slice(0, limit);
}
function clearNearbyPosition() {
  nearbyRequest++;
  nearbyState = { status: nearbyDenied ? 'denied' : 'idle', position: null, message: nearbyDenied ? '定位未授權，請在裝置設定允許定位後重試。' : '' };
}
function renderQuickVisit() {
  if (!payload) return;
  const mobile = mobileLocationDevice(navigator), ready = mobile && nearbyState.status === 'ready';
  const available = all('store').filter(s => !s.conflict && !s.deleted);
  const located = ready ? nearestStores(available, nearbyState.position, NEARBY_STORE_LIMIT) : [];
  const coverage = available.filter(s => storeCoordinates(s)).length;
  const title = $('quick-visit-title'), status = $('nearby-status'), retry = $('nearby-retry');
  title.textContent = mobile ? `附近最近 ${NEARBY_STORE_LIMIT} 間門市` : '最近使用的門市';
  retry.hidden = !mobile; retry.disabled = nearbyState.status === 'locating';
  retry.textContent = nearbyState.status === 'locating' ? '定位中…' : '重新定位';
  let message = mobile ? nearbyState.message : '快速選擇門市開始拜訪；電腦不啟動定位。';
  if (ready) message = located.length
    ? `依直線距離排序（不是行車距離）。${coverage}／${available.length} 間有可用座標${coverage < available.length ? '；缺少座標的門市未參與排序，可能另有更近門市' : ''}。定位誤差約 ${Math.round(nearbyState.position.accuracy)} 公尺${nearbyState.position.accuracy > 1000 ? '，目前誤差較大，請重新定位' : ''}。`
    : '已取得定位，但門市缺少可靠座標，尚無法計算附近門市。';
  status.textContent = message || '開啟後會請求定位；只在本機計算距離。';
  const entries = located.length ? located : recentStores(3).map(store => ({ store }));
  const fallback = mobile && !located.length ? '<p class="nearby-fallback-label">先顯示最近使用的門市（不是距離排序）</p>' : '';
  $('recent-store-list').innerHTML = fallback + entries.map(({ store, distance }) => {
    const range = Number.isFinite(distance) ? (distance < 1000 ? `約 ${Math.round(distance / 10) * 10} 公尺` : `約 ${(distance / 1000).toFixed(1)} 公里`) + ' · 直線距離' : store.district || '地區未提供';
    return `<button type="button" class="recent-store" ${storeIdentityPending(store) ? `data-quick-visit="${esc(store.id)}"` : `data-visit-brief="${esc(store.id)}"`}><strong>${esc(store.name)}</strong><small>${esc(range)}</small>${storeAttendanceHTML(store.id)}${storeIdentityPending(store) ? '<small>身分待確認 · 直接記錄拜訪</small>' : '<small>查看重點並記錄拜訪</small>'}</button>`;
  }).join('') || '<p class="muted">目前沒有可用門市，可按「新增拜訪」開始記錄。</p>';
}
function requestNearbyPosition(force = false) {
  if (!payload || document.hidden || !mobileLocationDevice(navigator) || nearbyState.status === 'locating') return;
  if (!force && (nearbyDenied || nearbyState.status === 'ready')) { renderQuickVisit(); return; }
  const request = ++nearbyRequest, sessionKey = key;
  const current = () => request === nearbyRequest && !!payload && key === sessionKey && !document.hidden;
  if (!navigator.geolocation || !isSecureContext) {
    nearbyState = { status: 'error', position: null, message: '此環境無法定位，請使用原本受信任的 HTTPS App。' }; renderQuickVisit(); return;
  }
  nearbyState = { status: 'locating', position: null, message: '正在取得目前位置；首次使用請允許定位。位置只在本機使用。' }; renderQuickVisit();
  const failed = error => {
    if (!current()) return;
    nearbyDenied = error?.code === 1;
    nearbyState = { status: nearbyDenied ? 'denied' : 'error', position: null, message: nearbyDenied ? '定位未授權，請在裝置設定允許定位後重試。' : error?.code === 3 ? '定位逾時，請到訊號較好的位置後重新定位。' : '目前無法取得位置，請確認定位服務後重試。' }; renderQuickVisit();
  };
  try {
    navigator.geolocation.getCurrentPosition(result => {
      if (!current()) return;
      const c = result.coords;
      if (!validCoordinates(c?.latitude, c?.longitude) || !Number.isFinite(c.accuracy) || c.accuracy < 0 || !Number.isFinite(result.timestamp) || Date.now() - result.timestamp > 60000) { failed({ code: 2 }); return; }
      nearbyDenied = false;
      nearbyState = { status: 'ready', position: { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy }, message: '' }; renderQuickVisit();
    }, failed, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  } catch { failed({ code: 2 }); }
}
async function previewCoordinateFile(file) {
  if (!payload || editorContext || csvImport.hasPending() || $('review').open) throw new Error('請先完成目前編輯或預覽。');
  if (file.size > 2 * 1024 * 1024) throw new Error('座標檔案超過 2 MB，未載入。');
  const sessionKey = key, input = JSON.parse(await file.text());
  if (!payload || key !== sessionKey || pendingLock || document.hidden) return;
  const plan = planCoordinates(payload.bundle, input);
  coordinatePreview = { input, plan, sessionKey }; versionReview = null; resolutionPreview = null;
  $('review-title').textContent = '座標補查：正式套用前預覽';
  $('review-body').innerHTML = `<p>對照目前資料：可更新 ${plan.changes.length} 間，略過 ${plan.skipped.length} 間。檔案中的歷史清單不代表目前全部門市。</p><p>確認後只新增門市地圖網址版本，讓附近排序讀取座標；舊網址保留在版本歷史。名稱、地址、拜訪文字、原 CSV 與 Source Snapshot 均保留。變更會隨加密同步傳到其他裝置。</p><p>取消或關閉不寫入任何資料。</p>` +
    plan.changes.map(c => `<article><h3>${esc(c.name)}</h3><p>座標：${esc(c.point.latitude)}, ${esc(c.point.longitude)}；補查時間：${esc(dateText(c.checkedAt))}</p><details><summary>原網址與新網址</summary><p class="coordinate-url">原：${esc(c.before || '未提供')}</p><p class="coordinate-url">新：${esc(c.after)}</p></details></article>`).join('') +
    `<details><summary>略過 ${plan.skipped.length} 間及原因</summary>` + plan.skipped.map(c => `<p>${esc(c.name)}：${esc(c.reason)}</p>`).join('') + '</details><div class="dialog-footer"><button data-close="review">取消，不修改</button>' + (plan.changes.length ? `<button id="apply-coordinates" class="primary">確認更新這 ${plan.changes.length} 間的地圖網址</button>` : '') + '</div>';
  openDialog($('review'));
}
async function commitCoordinates() {
  const preview = coordinatePreview;
  if (!preview || !payload || preview.sessionKey !== key || pendingLock || document.hidden || !$('review').open) throw new Error('預覽已失效，請重新載入檔案。');
  const bundle = applyCoordinates(payload.bundle, preview.input, preview.plan, payload.device);
  await persist({ ...payload, bundle, dirty: true });
  coordinatePreview = null; $('review').close(); render();
  toast('座標已加密儲存；舊網址與原始來源保留。');
}
function exportStoreEnrichmentRequest() {
  const request = buildStoreEnrichmentRequest(payload.bundle);
  if (!request.items.length) throw new Error('目前沒有同時具備唯一 Google 地點識別與待補地址欄位的安全候選。');
  if (!confirm(`將匯出 ${request.items.length} 間門市的 Google 地點識別、名稱與地圖網址，供公開資料補查。\n檔案含門市名稱，請只存到自己的本機資料夾，避開 iCloud Drive，也不要上傳 GitHub。`)) return;
  download(JSON.stringify(request, null, 2), `pharmacy-store-enrichment-request-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
}
async function previewStoreEnrichmentFile(file) {
  if (!payload || editorContext || csvImport.hasPending() || $('review').open) throw new Error('請先完成目前編輯或預覽。');
  if (file.size > 2 * 1024 * 1024) throw new Error('門市資料補查檔案超過 2 MB，未載入。');
  const sessionKey = key, input = JSON.parse(await file.text());
  if (!payload || key !== sessionKey || pendingLock || document.hidden) return;
  const plan = planStoreEnrichment(payload.bundle, input);
  enrichmentPreview = { input, plan, sessionKey }; coordinatePreview = null; versionReview = null; resolutionPreview = null;
  const labels = { address: '地址', city: '縣市', district: '行政區' };
  $('review-title').textContent = '門市地址自動補全：正式套用前預覽';
  $('review-body').innerHTML = `<div class="enrichment-summary"><strong>可安全補全 ${plan.changes.length} 間</strong><span>例外／不修改 ${plan.exceptions.length} 間</span></div><p>確認後只補上目前空白的地址、縣市與行政區，建立一般門市新版本並保存 Google 地點識別、公開地址、補查時間與來源網址。既有非空白欄位、拜訪原文、CSV 與 Source Snapshot 不會被覆蓋。</p><p>任何名稱、地點識別或既有資料不一致都保留在例外清單，這次不修改。取消或關閉不寫入資料。</p>` +
    plan.changes.map(change => `<article class="enrichment-change"><h3>${esc(change.name)}</h3>${Object.entries(change.additions).map(([field, value]) => `<p><strong>${esc(labels[field])}</strong><span>${esc(change.before[field] || '未提供')} → ${esc(value)}</span></p>`).join('')}<small>Google Maps 公開資料 · ${esc(dateText(change.source.checkedAt))}</small></article>`).join('') +
    `<details class="enrichment-exceptions" ${plan.exceptions.length ? '' : 'hidden'}><summary>查看 ${plan.exceptions.length} 間例外與原因</summary>${plan.exceptions.map(item => `<article><strong>${esc(item.name || item.featureId)}</strong><p>${esc(item.reason)}</p></article>`).join('')}</details><div class="dialog-footer"><button data-close="review">取消，不修改</button>${plan.changes.length ? `<button id="apply-store-enrichment" class="primary">確認補全這 ${plan.changes.length} 間門市</button>` : ''}</div>`;
  openDialog($('review'));
}
async function commitStoreEnrichment() {
  const preview = enrichmentPreview;
  if (!preview || !payload || preview.sessionKey !== key || pendingLock || document.hidden || !$('review').open) throw new Error('預覽已失效，請重新載入檔案。');
  const bundle = applyStoreEnrichment(payload.bundle, preview.input, preview.plan, payload.device);
  await persist({ ...payload, bundle, dirty: true });
  const count = preview.plan.changes.length; enrichmentPreview = null; $('review').close(); render();
  toast(`已補全 ${count} 間門市；來源與舊版本已保留，等待加密同步。`);
}
function visitStoreSearchText(store) {
  return [store.name, ...(store.csvAliases || []), store.city, store.district, store.address, store.channel]
    .filter(Boolean).join(' ').toLocaleLowerCase('zh-Hant');
}
function orderedVisitStores() {
  const recent = recentStores(6), recentIds = new Set(recent.map(store => store.id));
  const rest = all('store').filter(store => !store.conflict && !recentIds.has(store.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return [...recent, ...rest];
}
function refreshVisitStoreOptions(query = '') {
  const select = $('f-store'), count = $('f-store-match-count'); if (!select) return;
  const selected = select.value, needle = query.trim().toLocaleLowerCase('zh-Hant');
  const matches = orderedVisitStores().filter(store => !needle || visitStoreSearchText(store).includes(needle));
  const selectedRecord = selected !== '__new__' ? by('store', selected) : null;
  const selectedUnavailable = selected && selected !== '__new__' && (!selectedRecord || selectedRecord.deleted || selectedRecord.conflict);
  const shown = selectedRecord && !selectedUnavailable && !matches.some(store => store.id === selected)
    ? [selectedRecord, ...matches] : matches;
  const unavailableOption = selectedUnavailable ? `<option value="${esc(selected)}" selected disabled>原門市目前不可使用或有衝突，請重新選擇</option>` : '';
  select.innerHTML = unavailableOption + shown.map(store => `<option value="${esc(store.id)}">${esc(store.name)}${store.district ? ' · ' + esc(store.district) : ''}</option>`).join('') + '<option value="__new__">＋ 快速新增門市</option>';
  if ([...select.options].some(option => option.value === selected && !option.disabled)) select.value = selected;
  else if (selectedUnavailable) select.value = selected;
  else if (select.options.length) select.selectedIndex = 0;
  if (count) count.textContent = needle ? `符合 ${matches.length} 間既有門市；目前選擇不會因搜尋自動改變。` : `可選 ${matches.length} 間既有門市。`;
}
function openVisitForStore(storeId) {
  const store = by('store', storeId);
  if (!store || store.deleted || store.conflict) return toast('這間門市目前不可直接新增拜訪；若有同步衝突請先處理。');
  if (payload?.draft?.format === 'visit-draft-1') {
    toast('目前有未完成草稿，先恢復該草稿；完成後再新增另一筆拜訪。');
    return resumeVisitDraft();
  }
  if (pendingInlineTextId()) {
    toast('目前有一筆尚未完成的文字修改，先回到該筆檢查並儲存；完成後再新增拜訪。');
    return resumeInlineTextDraft();
  }
  focus = { type: 'store', id: storeId };
  if (storeIdentityPending(store)) return openEditor('visit');
  openVisitBrief(storeId, { capture: true });
}
function captureVisitDraft() {
  if (singleStoreContext && $('review').open && !$('single-store-capture-form')?.hidden) {
    const ctx = singleStoreContext;
    const checked = name => [...document.querySelectorAll(`#single-store-capture-form [name="${name}"]:checked`)].map(el => el.value);
    return {
      format: 'visit-draft-1', savedAt: new Date().toISOString(), id: ctx.id, parents: [...ctx.parents], baseData: null,
      fields: {
        store: ctx.storeId, date: $('single-store-date')?.value || '', source: $('single-store-source')?.value || '',
        text: $('single-store-text')?.value || '', next: $('single-store-next')?.value || '',
        topics: checked('single-topic'), people: checked('single-person'), keepAttachments: [],
        newStoreName: '', newStoreDistrict: '', newStoreMapUrl: '', newStorePending: true
      }
    };
  }
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
  if (singleStoreContext && $('single-store-capture-form')) {
    const f = draft.fields, set = (id, value) => { const el = $(id); if (el && value !== undefined) el.value = value; };
    set('single-store-date', f.date); set('single-store-source', f.source); set('single-store-text', f.text); set('single-store-next', f.next);
    for (const [name, field] of [['single-topic', 'topics'], ['single-person', 'people']]) {
      const selected = new Set(f[field] || []);
      document.querySelectorAll(`#single-store-capture-form [name="${name}"]`).forEach(el => { el.checked = selected.has(el.value); });
    }
    draftState('已存於本機 · ' + dateText(draft.savedAt), 'saved');
    return;
  }
  if ($('discard-draft')) $('discard-draft').hidden = false;
  const f = draft.fields, set = (id, value) => { const el = $(id); if (el && value !== undefined) el.value = value; };
  set('f-store', f.store); set('f-date', f.date); set('f-source', f.source); set('f-text', f.text); set('f-next', f.next);
  set('f-new-store-name', f.newStoreName); set('f-new-store-district', f.newStoreDistrict); set('f-new-store-map-url', f.newStoreMapUrl);
  if ($('f-new-store-pending')) $('f-new-store-pending').checked = f.newStorePending !== false;
  for (const name of ['topic', 'person', 'keep-attachment']) {
    const field = name === 'topic' ? 'topics' : name === 'person' ? 'people' : 'keepAttachments';
    const selected = new Set(f[field] || []);
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
  if (discardingDraft) return;
  const draft = captureVisitDraft(); if (!draft || !payload) return;
  draftState('儲存中…', 'saving');
  try {
    await persist({ ...payload, draft });
    if (singleStoreContext?.id === draft.id) singleStoreContext.draftTouched = false;
    if (editorContext?.type === 'visit' && editorContext.id === draft.id) editorContext.draftTouched = false;
    status();
    draftState('已存於本機 · ' + dateText(draft.savedAt), 'saved');
  } catch (e) {
    $('save-state').textContent = '手機保存失敗：' + e.message;
    draftState('儲存失敗：' + e.message, 'error');
    throw e;
  }
}
function scheduleVisitDraftSave() {
  const ctx = singleStoreContext || (editorContext?.type === 'visit' ? editorContext : null);
  if (discardingDraft || !ctx) return;
  ctx.draftTouched = true;
  if (!singleStoreContext && $('discard-draft')) $('discard-draft').hidden = false;
  draftState('儲存中…', 'saving'); clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    draftSaveChain = draftSaveChain.catch(() => {}).then(persistVisitDraftNow).catch(() => {});
  }, 350);
}
function flushVisitDraft() {
  const ctx = singleStoreContext || (editorContext?.type === 'visit' ? editorContext : null);
  if (discardingDraft || !ctx || !ctx.draftTouched) return draftSaveChain.catch(() => {});
  clearTimeout(draftTimer); draftTimer = null;
  draftSaveChain = draftSaveChain.catch(() => {}).then(persistVisitDraftNow);
  return draftSaveChain;
}
function resumeVisitDraft() {
  const draft = payload?.draft;
  if (!draft || draft.format !== 'visit-draft-1') return toast('目前沒有可恢復的草稿。');
  const store = !draft.baseData && draft.fields?.store && draft.fields.store !== '__new__' ? by('store', draft.fields.store) : null;
  if (store && !store.deleted && !store.conflict && !storeIdentityPending(store)) {
    focus = { type: 'store', id: store.id };
    return openVisitBrief(store.id, { capture: true, restoreDraft: draft });
  }
  const id = draft.baseData ? draft.id : null;
  openEditor('visit', id, draft);
}
async function discardVisitDraft() {
  const activeVisit = editorContext?.type === 'visit';
  const activeSingleStore = !!singleStoreContext;
  const hasSavedDraft = payload?.draft?.format === 'visit-draft-1';
  const hasPendingInput = activeVisit && editorContext.draftTouched || activeSingleStore && singleStoreContext.draftTouched;
  if (!hasSavedDraft && !hasPendingInput) return toast('目前沒有未完成草稿需要捨棄。');
  if (!confirm('確認捨棄這份未完成草稿？\n只會刪除這份尚未完成的本機草稿與目前尚未保存的輸入；不會刪除或修改任何既有門市、正式拜訪或歷史版本。')) return;
  discardingDraft = true;
  try {
    clearTimeout(draftTimer); draftTimer = null;
    if (activeVisit) editorContext.draftTouched = false;
    if (activeSingleStore) singleStoreContext.draftTouched = false;
    await draftSaveChain.catch(() => {});
    if (payload?.draft?.format === 'visit-draft-1') await persist({ ...payload, draft: null });
    if (activeVisit) { $('editor').close(); editorContext = null; }
    if (activeSingleStore) {
      const storeId = singleStoreContext.storeId; singleStoreContext = null;
      openVisitBrief(storeId);
    }
    render(); status();
    toast('未完成草稿已從這台裝置捨棄；既有門市、正式拜訪與歷史版本未變更。');
  } finally {
    discardingDraft = false;
  }
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
    syncScheduler.request('foreground');
  }, 'gate-error');
}
function captureTransientResumeState() {
  if (!payload) return;
  transientResumeState = {
    view: Object.hasOwn(titles, activeView) ? activeView : 'visits',
    focus: { ...focus },
    graphPage,
    trail: trail.map(item => ({ ...item })),
    qualityTab,
    qualityField,
    qualityPage,
    storeFilters: structuredClone(storeFilters),
    regionalCity,
    regionalDistrict,
    visitSearch: $('visit-search')?.value || '',
    scrollTop: document.scrollingElement?.scrollTop || 0
  };
}
function restoreTransientResumeState() {
  const state = transientResumeState; transientResumeState = null;
  if (!state) { switchView('visits'); return; }
  focus = { ...state.focus };
  graphPage = Number.isSafeInteger(state.graphPage) && state.graphPage >= 0 ? state.graphPage : 0;
  trail = Array.isArray(state.trail) ? state.trail.map(item => ({ ...item })) : [];
  qualityTab = ['duplicates', 'missing', 'reviewed'].includes(state.qualityTab) ? state.qualityTab : 'duplicates';
  qualityField = typeof state.qualityField === 'string' ? state.qualityField : '';
  qualityPage = Number.isSafeInteger(state.qualityPage) && state.qualityPage >= 0 ? state.qualityPage : 0;
  storeFilters = state.storeFilters && typeof state.storeFilters === 'object'
    ? { query: state.storeFilters.query || '', district: state.storeFilters.district || '', kind: state.storeFilters.kind || '', groups: Array.isArray(state.storeFilters.groups) ? [...state.storeFilters.groups] : [] }
    : { query: '', district: '', kind: '', groups: [] };
  regionalCity = typeof state.regionalCity === 'string' ? state.regionalCity : '';
  regionalDistrict = typeof state.regionalDistrict === 'string' ? state.regionalDistrict : '';
  $('visit-search').value = typeof state.visitSearch === 'string' ? state.visitSearch : '';
  switchView(Object.hasOwn(titles, state.view) ? state.view : 'visits');
  const scrollTop = Number.isFinite(state.scrollTop) && state.scrollTop >= 0 ? state.scrollTop : 0;
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, scrollTop)));
}
async function openWorkspace() {
  pendingLock = document.hidden; lastError = ''; lastSyncFailure = null; syncWarning = '';
  localSaveState = 'saved'; syncEpoch++; syncScheduler.reset();
  $('gate').hidden = true; $('workspace').hidden = false;
  document.body.classList.toggle('privacy-veil', pendingLock);
  try { storagePersistent = await navigator.storage?.persist?.() || false; } catch {}
  restoreTransientResumeState(); renderBackupResult(); await runPeriodicHealthAudit(); clearInterval(autoTimer);
  autoTimer = setInterval(() => syncScheduler.request('poll'), 15000);
  syncScheduler.request('foreground');
  requestNearbyPosition();
}
function currentHealthAudit() {
  const pending = pendingSyncSummary();
  return readonlyHealthAudit({ pendingCount: pending.count, pendingUnknown: pending.unknown, conflicts: records.filter(record => record.conflict).length, identityPending: all('store').filter(storeIdentityPending).length, lastSync: payload.lastSync, lastBackup: payload.lastBackupExport, appVersion: APP_VERSION, macVersion: macProgram?.version || '', now: Date.now() });
}
function renderHealthAudit() {
  if (!payload || !$('health-audit-list')) return;
  const audit = currentHealthAudit(), last = payload.lastHealthAudit ? dateText(payload.lastHealthAudit) : '尚未完成定期健檢';
  $('health-audit-card').dataset.state = audit.state;
  $('health-audit-title').textContent = audit.state === 'healthy' ? '唯讀健檢正常' : audit.state === 'partial' ? '唯讀健檢完成，部分狀態待連線確認' : `${audit.attention} 項需要查看`;
  $('health-audit-time').textContent = `最近定期健檢：${last}。每 7 天在 App 開啟時自動重做，也可立即手動重做。`;
  $('health-audit-list').innerHTML = audit.checks.map(check => `<li class="audit-${esc(check.level)}"><span aria-hidden="true">${check.level === 'ok' ? '✓' : check.level === 'info' ? '○' : '!'}</span>${esc(check.text)}</li>`).join('');
}
async function runPeriodicHealthAudit(force = false) {
  if (!payload) return;
  const previous = Date.parse(payload.lastHealthAudit || ''), due = !Number.isFinite(previous) || Date.now() - previous >= 7 * 24 * 60 * 60 * 1000;
  if (force || due) await persist({ ...payload, lastHealthAudit: new Date().toISOString() });
  renderHealthAudit();
}
// One queue serves saves, foreground/online events and the existing lightweight poll.
// Timers never carry customer content; only the guarded attempt can exchange snapshots.
function createSyncScheduler({ ready, attempt, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {} }) {
  let timer = null, pending = false, inFlight = false, failures = 0, retryAt = 0, dueAt = 0, generation = 0, wakeVersion = 0;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const state = () => ({ pending, inFlight, failures, retryAt });
  const notify = () => onChange(state());
  const arm = () => {
    clear();
    if (pending && !inFlight && ready()) timer = setTimer(drain, Math.max(0, dueAt - now(), retryAt - now()));
  };
  const failure = () => {
    failures++;
    retryAt = now() + [15000, 30000, 60000, 120000, 300000][Math.min(failures - 1, 4)];
    pending = true; dueAt = retryAt;
  };
  async function drain() {
    timer = null;
    if (!pending || inFlight || !ready()) return;
    const epoch = generation, wakeAtStart = wakeVersion;
    pending = false; inFlight = true; notify();
    let result;
    try { result = await attempt(); } catch { result = 'failure'; }
    inFlight = false;
    if (epoch !== generation) { arm(); notify(); return; }
    if (result === 'failure') failure();
    else if (result === 'deferred') {
      pending = true; dueAt = now() + 500;
      // A close/foreground event may arrive before the old probe settles. Keep that wake.
      if (wakeVersion !== wakeAtStart) arm();
      notify(); return;
    } else { failures = 0; retryAt = 0; }
    arm(); notify();
  }
  return {
    request(reason = 'poll') {
      wakeVersion++;
      const due = now() + (reason === 'poll' ? 0 : 500);
      dueAt = pending ? Math.min(dueAt, due) : due; pending = true; arm(); notify();
    },
    wake() { wakeVersion++; arm(); notify(); },
    pause() { clear(); notify(); },
    reset() { generation++; clear(); pending = false; failures = 0; retryAt = 0; dueAt = 0; notify(); },
    confirmed() { clear(); pending = false; failures = 0; retryAt = 0; notify(); },
    failed() { failure(); arm(); notify(); },
    state
  };
}
function canAutoSync(ignoreFetching = false) {
  return !!(key && payload?.token) && navigator.onLine !== false && !document.hidden && !pendingLock && !updateHolding && !busy && !gateOpening &&
    (ignoreFetching || !autoFetching) && !syncInProgress && !backupPreview && !editorContext && !singleStoreContext && !inlineTextContext && !reminderContext && !attendancePrompt && !payload.inlineTextDraft &&
    !['review', 'editor', 'quick-text-dialog', 'store-reminder-dialog', 'rebuild-dialog', 'backup-review', 'visit-attendance-dialog'].some(id => $(id)?.open) && !csvImport.hasPending();
}
function syncSession() { return { key, meta, token: payload?.token, device: payload?.device, epoch: syncEpoch, inline: inlineTextContext, editor: editorContext, reminder: reminderContext, single: singleStoreContext, attendance: attendancePrompt }; }
function assertSyncSession(session, bundle) {
  if (!payload || key !== session.key || meta !== session.meta || payload.token !== session.token || payload.device !== session.device || syncEpoch !== session.epoch || inlineTextContext !== session.inline || editorContext !== session.editor || reminderContext !== session.reminder || singleStoreContext !== session.single || attendancePrompt !== session.attendance || document.hidden || pendingLock || updateHolding || (bundle && payload.bundle !== bundle)) {
    const error = new Error('同步已暫停；本機內容保留，回到前景並完成編輯後會再確認。'); error.code = 'sync-paused'; throw error;
  }
}
async function autoSync() {
  if (!canAutoSync()) return 'deferred';
  const session = syncSession();
  autoFetching = true; renderDataSafetyEntry();
  let result = 'deferred';
  try {
    // Offline probes never block editing or take the write lock, and carry no customer content.
    const remote = await api('/api/version');
    assertSyncSession(session);
    if (!canAutoSync(true)) return 'deferred';
    await run(async () => {
      try {
        if (payload.dirty || remote.version !== payload.serverVersion) await synchronize({ fromAuto: true });
        else { await recordUnchangedSync(); assertSyncSession(session); }
        result = 'success';
      } catch (e) {
        if (e.code !== 'sync-paused' && payload && key === session.key && meta === session.meta && payload.token === session.token && syncEpoch === session.epoch) { recordSyncFailure(e); result = 'failure'; }
      }
    });
  } catch (e) {
    if (e.code !== 'sync-paused' && payload && key === session.key && meta === session.meta && payload.token === session.token && syncEpoch === session.epoch) { recordSyncFailure(e); result = 'failure'; }
  } finally { autoFetching = false; renderDataSafetyEntry(); }
  return result;
}
function lockNow(reopen = !document.hidden) {
  syncScheduler.pause();
  forgetBriefSearchQuery();
  if (!busy && backupPreview) { clearBackupPreview(); $('backup-review').close(); }
  if (busy || editorContext || inlineTextContext || reminderContext || payload?.inlineTextDraft || $('review').open || $('quick-text-dialog')?.open || $('store-reminder-dialog')?.open || csvImport.hasPending()) { pendingLock = true; document.body.classList.add('privacy-veil'); return; }
  captureTransientResumeState();
  syncEpoch++; syncScheduler.reset(); localSaveState = 'unknown';
  attendanceCache = null;
  pendingLock = false; coordinatePreview = null; enrichmentPreview = null; clearNearbyPosition(); versionReview = null; resolutionPreview = null; inlineTextContext = null; reminderContext = null; clearTimeout(reminderDraftTimer); reminderDraftTimer = null; clearTimeout(inlineDraftTimer); inlineDraftTimer = null; clearInterval(autoTimer); key = null; meta = null; payload = null; records = []; trail = []; editorContext = null; lastError = ''; macProgram = null; lastSyncFailure = null; syncWarning = '';
  csvImport.reset(); qualityCache = null; qualityReview = null; qualityTab = 'duplicates'; qualityField = ''; qualityPage = 0;
  resetStoreFilters();
  for (const u of objectURLs) URL.revokeObjectURL(u); objectURLs = [];
  document.querySelectorAll('dialog').forEach(d => d.close());
  for (const id of ['quality-content', 'regional-content', 'focus-header', 'graph', 'graph-pager', 'focus-detail', 'evidence-list', 'store-list', 'visit-list', 'recent-store-list', 'draft-banner-text', 'reminder-draft-list', 'customer-list', 'entity-list', 'trash-list', 'review-body', 'editor-fields', 'conflict-list', 'connection-detail', 'program-detail', 'local-save-detail', 'mac-ack-detail', 'sync-success-detail', 'sync-failure-detail', 'connection-check', 'device-label', 'sync-result', 'storage-detail', 'sync-health-title', 'sync-health-body', 'pending-sync-detail', 'sync-conflict-count', 'health-audit-title', 'health-audit-time', 'health-audit-list', 'backup-result', 'data-safety-title', 'data-safety-detail']) $(id).replaceChildren();
  $('connection-check').hidden = true;
  $('store-reminder-form').reset(); resetReminderOptionGroup('store-reminder-next'); $('store-reminder-existing').replaceChildren(); $('store-reminder-title').textContent = '門市提醒'; $('store-reminder-draft-state').textContent = ''; $('store-reminder-error').textContent = ''; $('reminder-draft-banner').hidden = true; $('reminder-draft-count').textContent = '未完成門市提醒';
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
        payload = decrypted; await openWorkspace(); syncScheduler.request('foreground'); return;
      } catch { key = null; meta = null; payload = null; $('gate-error').textContent = '裝置保存的金鑰無法使用。請輸入一次原資料庫密碼，重新建立自動開啟金鑰。'; }
    }
    $('gate-form').hidden = false;
    $('gate-title').textContent = slot ? '輸入一次資料庫密碼' : '連接你的 Mac';
    $('gate-hint').textContent = slot ? '這是舊版升級或裝置金鑰修復。成功後，日常開啟不再要求密碼。' : '先在 Mac 管理頁產生配對碼。首次配對輸入一次資料庫密碼，之後自動開啟。';
    $('pair-fields').hidden = !!slot; $('new-options').hidden = !!slot; $('gate-restore').hidden = !!slot;
    $('gate-submit').textContent = slot ? '驗證並啟用自動開啟' : '配對並開啟';
    $('device-name').value = /iPhone|iPad/.test(navigator.userAgent) ? '我的 iPhone' : '我的 Mac';
  } catch (e) { $('gate-error').textContent = `無法使用本機儲存：${e.message}`; }
  finally { gateOpening = false; syncScheduler.wake(); }
}
async function recordUnchangedSync() {
  const session = syncSession(), bundle = payload.bundle;
  assertSyncSession(session, bundle);
  // A confirmation is saved only after a Mac response and successful local commit.
  await persist({ ...payload, lastSync: new Date().toISOString() });
  assertSyncSession(session, bundle);
  lastError = ''; status();
  $('sync-result').textContent = `最近成功同步：${dateText(payload.lastSync)}\n已確認與 Mac 的資料版本一致，沒有新變更。`;
}
async function synchronize({ fromAuto = false } = {}) {
  if (!payload?.token) throw new Error('請先在「同步與備份」重新配對；本機資料仍保留。');
  if (syncInProgress || (autoFetching && !fromAuto)) { const error = new Error('正在確認同步，請稍候。'); error.code = 'sync-paused'; throw error; }
  const session = syncSession();
  assertSyncSession(session);
  syncInProgress = true; renderDataSafetyEntry();
  try {
    $('sync-state').textContent = '正在與 Mac 交換…';
    for (let attempt = 0; attempt < 5; attempt++) {
      assertSyncSession(session);
      const remote = await api('/api/snapshot');
      assertSyncSession(session);
      if (remote.version < (payload.serverVersion || 0)) throw new Error('Mac 資料版本比上次舊，可能已回復備份。請先匯出本機備份，再重新配對確認。');
      if (remote.envelope && !payload.dirty && remote.version === payload.serverVersion) { await recordUnchangedSync(); return; }
      let combined = payload.bundle, other = null;
      if (remote.envelope) {
        if (remote.envelope.vaultId !== session.meta.vaultId || remote.envelope.salt !== session.meta.salt) throw new Error('Mac 是另一個資料庫，已停止同步以保護本機資料。');
        other = validateBundle(await unseal(remote.envelope, session.key));
        assertSyncSession(session, combined); combined = merge(combined, other);
      }
      // Received revisions remain encrypted locally even if the following upload is interrupted.
      await persist({ ...payload, bundle: combined, dirty: true });
      assertSyncSession(session, combined);
      const same = other && combined.ops.length === other.ops.length;
      let version = remote.version, backupOK = true;
      if (!same) {
        const envelope = await seal(combined, session.key, session.meta);
        assertSyncSession(session, combined);
        try {
          const result = await api('/api/snapshot', { method: 'PUT', body: { expectedVersion: remote.version, envelope } });
          assertSyncSession(session, combined); version = result.version; backupOK = result.backupOK;
        } catch (e) { assertSyncSession(session, combined); if (e.status === 409) continue; throw e; }
      }
      assertSyncSession(session, combined);
      // Clear only the acknowledged bundle; retain all current device-only drafts.
      await persist({ ...payload, dirty: false, serverVersion: version, lastSync: new Date().toISOString() });
      assertSyncSession(session, combined);
      lastError = ''; syncWarning = backupOK ? '' : 'Mac 自動快照失敗。請檢查磁碟空間並手動匯出加密備份。';
      render(); $('sync-result').textContent = `最近成功同步：${dateText(payload.lastSync)}\n已與 Mac 交換至資料版本 ${version}。${records.some(r => r.conflict) ? '有衝突需確認。' : '目前沒有內容衝突。'}${syncWarning ? '\n同步提醒：' + syncWarning : ''}`;
      return;
    }
    throw new Error('其他裝置持續更新，尚未完成同步。請稍後再按一次。');
  } catch (error) { assertSyncSession(session); throw error; }
  finally { syncInProgress = false; renderDataSafetyEntry(); }
}
function recordSyncFailure(error) {
  lastError = error.message;
  lastSyncFailure = { at: new Date().toISOString(), message: error.message };
  status();
}
function renderDataSafetyEntry() {
  const entry = $('data-safety-open');
  if (!entry || !payload) return;
  const reminders = storedReminderDrafts().length;
  const drafts = (payload.draft?.format === 'visit-draft-1' ? 1 : 0) + (payload.inlineTextDraft?.format === 'inline-text-draft-1' ? 1 : 0) + reminders;
  const summary = dataSafetySummary({ localState: localSaveState, paired: !!payload.token, syncing: autoFetching || syncInProgress,
    dirty: payload.dirty, pending: pendingSyncSummary(), lastSync: payload.lastSync, conflicts: records.filter(r => r.conflict).length,
    syncError: lastError, backupWarning: syncWarning || currentHealthAudit().checks.some(check => check.code === 'backup-age' && check.level === 'warning'), drafts, reminderDrafts: reminders });
  entry.dataset.state = summary.state;
  $('data-safety-title').textContent = summary.title;
  $('data-safety-detail').textContent = summary.detail;
}
function status() {
  if (!payload) return;
  const conflicts = records.filter(r => r.conflict).length;
  const pending = pendingSyncSummary();
  const lastSuccess = payload.lastSync ? dateText(payload.lastSync) : '尚未成功同步';
  const unfinished = (payload.draft?.format === 'visit-draft-1' ? 1 : 0) + (payload.inlineTextDraft?.format === 'inline-text-draft-1' ? 1 : 0) + storedReminderDrafts().length;
  $('save-state').textContent = '手機已保存：本機加密資料可用' + (unfinished ? ` · 有 ${unfinished} 份未完成內容` : '');
  const macAck = !payload.lastSync ? 'Mac 尚未確認收到' : payload.dirty ? `Mac 尚未確認收到這次已完成的變更 · 最近成功同步：${lastSuccess}` : `Mac 已確認收到已完成紀錄 · 資料版本 ${payload.serverVersion || 0} · 最近成功同步：${lastSuccess}`;
  $('sync-state').textContent = lastError ? `Mac 同步未完成：${lastError} · 最近成功同步：${lastSuccess}` : macAck + (unfinished ? '；未完成內容僅存本機裝置' : '');
  $('conflict-link').hidden = !conflicts; $('conflict-link').textContent = `${conflicts} 筆衝突待確認`;
  $('device-label').textContent = payload.deviceName;
  $('connection-detail').textContent = payload.deviceName + ' · ' + location.hostname + ' · 本機已確認的資料版本 ' + (payload.serverVersion || 0);
  $('program-detail').textContent = programDetail();
  $('local-save-detail').textContent = '手機已保存：' + (unfinished ? `有 ${unfinished} 份未完成內容；` : '') + (payload.dirty ? '有已完成紀錄等待 Mac 確認。' : '沒有已完成紀錄等待傳送。');
  $('mac-ack-detail').textContent = !payload.lastSync ? 'Mac 尚未確認收到此裝置的資料。' : payload.dirty ? `Mac 已確認收到至資料版本 ${payload.serverVersion || 0}；本機仍有變更尚未確認。` : `Mac 已確認收到目前資料版本 ${payload.serverVersion || 0}。`;
  $('sync-success-detail').textContent = (payload.lastSync ? '最近成功同步：' + lastSuccess : '尚未成功同步') + (payload.dirty ? '；另有本機變更等待同步。' : '') + (syncWarning ? '；同步提醒：' + syncWarning : '');
  $('sync-failure-detail').textContent = lastSyncFailure ? dateText(lastSyncFailure.at) + ' · ' + lastSyncFailure.message + (!lastError ? '（之後已成功同步）' : '') : '本次開啟尚無同步失敗紀錄。';
  let healthState = 'healthy', healthTitle = '同步狀態正常', healthBody = '本機已加密保存，Mac 已確認收到目前的已完成紀錄。';
  if (!payload.token) { healthState = 'action'; healthTitle = '需要重新配對 Mac'; healthBody = '本機資料仍保留；重新配對並成功同步後，Mac 才會收到變更。'; }
  else if (lastError) { healthState = 'warning'; healthTitle = '同步尚未完成'; healthBody = '本機資料已加密保存。處理下方失敗原因後可沿用原版本重試，不會因此新增重複拜訪。'; }
  else if (payload.dirty) { healthState = 'pending'; healthTitle = '有資料等待 Mac 確認'; healthBody = '本機保存成功；App 保持前景且 Mac 可連線時會自動重試。'; }
  else if (!payload.lastSync) { healthState = 'pending'; healthTitle = '尚待 Mac 確認'; healthBody = '本機已有加密資料；完成一次同步後才能確認 Mac 收到。'; }
  else if (conflicts) { healthState = 'action'; healthTitle = '同步完成，有衝突待核對'; healthBody = '兩台內容都已保留；衝突尚未自動選邊或改寫。'; }
  else if (syncWarning) { healthState = 'warning'; healthTitle = '資料已同步，Mac 快照需要檢查'; healthBody = syncWarning; }
  $('sync-health-card').dataset.state = healthState;
  $('sync-health-title').textContent = healthTitle;
  $('sync-health-body').textContent = healthBody;
  $('pending-sync-detail').textContent = pendingSyncText(pending);
  $('sync-conflict-count').textContent = conflicts + ' 筆';
  renderHealthAudit(); renderDataSafetyEntry();
  $('storage-detail').textContent = `離線介面：${offlineReady ? '已備妥' : '尚待確認，請先保持連線'}。持久儲存：${storagePersistent ? '已獲允許' : '瀏覽器尚未允許，請定期同步及備份'}。資料 ${(new TextEncoder().encode(JSON.stringify(payload.bundle)).length / 1048576).toFixed(2)} / 24 MB（包含歷史與附件）。`;
}
function switchView(view) {
  dismissKeyboard();
  activeView = view; Object.keys(titles).forEach(v => $(`${v}-view`).hidden = v !== view);
  const primary = view === 'regional' ? 'stores' : ['quality', 'csv', 'entities', 'explore', 'trash'].includes(view) ? 'sync' : view;
  document.querySelectorAll('.rail [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === primary));
  $('page-title').textContent = titles[view]; render();
}
function navigate(type, id, remember = true) {
  const r = by(type, id); if (!r) return;
  if (remember && (focus.id !== id || focus.type !== type)) trail.push({ ...focus });
  focus = { type, id }; graphPage = 0; switchView('explore');
}
function relationCandidates(storeId) {
  return candidateRelationsForStore(storeId, all('visit'), all('store'), all('person'));
}
function relationOverview() {
  return candidateOverview(all('visit'), all('store'), all('person'));
}
function candidateEvidenceHTML(evidence, limit = 12) {
  const shown = (evidence || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, limit);
  return shown.map(item => `<article class="candidate-evidence"><div><span class="pill candidate-status ${esc(item.kind)}">${esc(item.label)}</span><span class="muted">${esc(item.field === 'next' ? '下次跟進' : item.source || '原始拜訪內容')}</span></div><blockquote>${esc(item.line)}</blockquote>${item.visitText && item.visitText.trim() !== item.line.trim() ? `<details class="candidate-fulltext"><summary>展開完整拜訪原文</summary><pre>${esc(item.visitText)}</pre></details>` : ''}</article>`).join('') || '<p class="muted">目前沒有可顯示的原文證據。</p>';
}
function openCandidateDetail(key, storeId = '') {
  const overview = relationOverview().find(item => item.key === key);
  if (!overview) return toast('這個候選關聯已因資料變更而不存在，請重新開啟關聯探索。');
  const selectedStore = storeId ? overview.stores.find(item => item.storeId === storeId) : null;
  const trend = candidateTrend(overview);
  const provenance = overview.sourceMode === 'explicit'
    ? '這個節點來自你明確填寫的「下次跟進」欄位，不是系統推論。'
    : overview.category === '人物提及'
      ? '這是原文中的同名／稱呼線索；不代表已確認人物身分或人際關係。'
      : '這是依可稽核字詞規則從原始拜訪文字找出的系統候選；不代表已確認需求、偏好或商業判斷。';
  const current = selectedStore ? `<h3>這間門市的證據</h3><p><strong>${esc(selectedStore.storeName)}</strong> · ${selectedStore.visitCount} 筆相關紀錄</p>${candidateEvidenceHTML(selectedStore.evidence, 20)}` : '';
  const others = overview.stores.filter(item => !storeId || item.storeId !== storeId).slice().sort((a, b) => b.visitCount - a.visitCount || (b.latestDate || '').localeCompare(a.latestDate || '')).slice(0, 20);
  const cross = others.length ? `<h3>跨店覆盤</h3><p class="muted">下列只是相同候選規則在其他門市的原文證據；共同提及不等於相同需求。</p><div class="candidate-store-list">${others.map(item => `<article class="candidate-store"><div><strong>${esc(item.storeName)}</strong><span class="muted">${item.visitCount} 筆</span></div><p>${esc(item.evidence.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]?.line || '')}</p><button type="button" class="text-button" data-candidate-store="${esc(item.storeId)}">查看這間門市</button></article>`).join('')}</div>` : '<h3>跨店覆盤</h3><p class="muted">目前沒有其他門市命中這個候選關聯。</p>';
  const dated = trend.currentVisits || trend.previousVisits
    ? `依筆記日期計算，最近 30 天：${trend.currentVisits} 筆／${trend.currentStores} 間；前 30 天：${trend.previousVisits} 筆／${trend.previousStores} 間。`
    : '近 60 天沒有足夠的「有筆記日期」紀錄可比較；未提供日期的原文仍保留在證據列表。';
  $('review-title').textContent = overview.name + ' · ' + (overview.sourceMode === 'explicit' ? '明確記錄' : '系統候選');
  $('review-body').innerHTML = `<div class="candidate-disclaimer"><strong>${esc(overview.category)}</strong>${overview.definition ? `<p><strong>詞彙定義：</strong>${esc(overview.definition)}</p>` : ''}<p>${esc(provenance)}</p></div><div class="candidate-metrics"><span>${overview.storeCount} 間門市</span><span>${overview.visitCount} 筆相關紀錄</span></div>${current}<h3>筆記時間比較</h3><p>${esc(dated)}</p>${cross}`;
  openDialog($('review'));
}
function openCandidateOverview() {
  const overview = relationOverview();
  $('review-title').textContent = '跨店候選關聯摘要';
  if (!overview.length) {
    $('review-body').innerHTML = '<p class="empty">目前沒有任何可稽核的候選關聯。系統不會為了填滿關聯圖而猜測。</p>';
  } else {
    const categories = [...new Set(overview.map(item => item.category))];
    $('review-body').innerHTML = '<p class="candidate-disclaimer">以下是從原始拜訪文字或明確「下次跟進」欄位建立的唯讀索引。系統候選不是已確認事實；點開後可一路查看原文。</p>' + categories.map(category => `<section class="candidate-overview-group"><h3>${esc(category)}</h3><div class="candidate-overview-list">${overview.filter(item => item.category === category).map(item => `<button type="button" class="candidate-summary" data-candidate-key="${esc(item.key)}"><strong>${esc(item.name)}</strong><span>${item.storeCount} 間門市 · ${item.visitCount} 筆</span></button>`).join('')}</div></section>`).join('');
  }
  openDialog($('review'));
}
// Transient, local-only search. Never replace an editable node or touch its selection.
let briefSearchContext = null, briefSearchTimer = null;
function clearBriefSearchHighlights() {
  for (const name of ['brief-search-all', 'brief-search-current']) globalThis.CSS?.highlights?.delete(name);
  $('review-body').querySelectorAll('.brief-search-target').forEach(node => node.classList.remove('brief-search-target'));
}
function clearBriefSearch() {
  clearTimeout(briefSearchTimer); briefSearchTimer = null; briefSearchContext = null;
  clearBriefSearchHighlights();
  $('brief-search-panel').hidden = true; $('brief-search').value = '';
  $('brief-search-status').textContent = ''; $('brief-search-preview').replaceChildren();
}
function prepareBriefSearch(storeId, preserving) {
  const old = preserving && briefSearchContext?.storeId === storeId ? briefSearchContext : null;
  clearTimeout(briefSearchTimer); briefSearchTimer = null; clearBriefSearchHighlights();
  briefSearchContext = { storeId, query: old?.query || '', matches: old?.matches || [], index: old?.index ?? 0, truncated: false, composing: false };
  $('brief-search-panel').hidden = false; $('brief-search').value = briefSearchContext.query;
}
function forgetBriefSearchQuery() {
  clearTimeout(briefSearchTimer); briefSearchTimer = null;
  if (!briefSearchContext) return;
  briefSearchContext.query = ''; briefSearchContext.matches = []; briefSearchContext.index = 0; briefSearchContext.composing = false;
  $('brief-search').value = ''; refreshBriefSearch(); clearBriefSearchHighlights();
}
function briefSearchBlocked() {
  return !!(singleStoreContext || payload?.draft || payload?.inlineTextDraft || (inlineTextContext && inlineTextContext.after !== inlineTextContext.before));
}
function briefSearchEditing() { return !!document.activeElement?.closest?.('#review [data-inline-edit-text]'); }
function briefSearchRange(match) {
  const element = $('review-body').querySelector(`.brief-history [data-inline-edit-text="${CSS.escape(match.visitId)}"]`);
  const visit = by('visit', match.visitId);
  if (!element || !visit || visit.heads?.[0]?.id !== match.headId || element.textContent !== (visit.text || '').replace(/\r\n?/g, '\n')) return null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), range = document.createRange();
  let node, offset = 0, started = false;
  while ((node = walker.nextNode())) {
    const end = offset + node.length;
    if (!started && match.start < end) { range.setStart(node, match.start - offset); started = true; }
    if (started && match.end <= end) { range.setEnd(node, match.end - offset); return range; }
    offset = end;
  }
  return null;
}
function paintBriefSearch(scroll = false) {
  clearBriefSearchHighlights();
  const ctx = briefSearchContext;
  if (!ctx || briefSearchBlocked() || briefSearchEditing() || ctx.composing || document.hidden || busy || updateHolding) return;
  const match = ctx.matches[ctx.index]; if (!match) return;
  const article = $('review-body').querySelector(`.brief-history [data-brief-visit="${CSS.escape(match.visitId)}"]`);
  if (!article) return;
  article.classList.add('brief-search-target');
  const current = briefSearchRange(match);
  if (globalThis.CSS?.highlights && typeof globalThis.Highlight === 'function') {
    const ranges = ctx.matches.map(briefSearchRange).filter(Boolean);
    CSS.highlights.set('brief-search-all', new Highlight(...ranges));
    if (current) { const highlight = new Highlight(current); highlight.priority = 1; CSS.highlights.set('brief-search-current', highlight); }
  }
  if (scroll) {
    article.closest('.brief-history').open = true;
    const body = $('review-body'), target = current?.getBoundingClientRect();
    const rect = target?.height ? target : article.getBoundingClientRect();
    body.scrollTop += rect.top - body.getBoundingClientRect().top - Math.min(80, body.clientHeight / 4);
  }
}
function refreshBriefSearch({ search = false, jump = false } = {}) {
  const ctx = briefSearchContext;
  if (!ctx || !$('review').open || $('review').dataset.singleStoreId !== ctx.storeId) return;
  const blocked = briefSearchBlocked(), editing = briefSearchEditing();
  if (search && !blocked && !ctx.composing) {
    const previous = ctx.matches[ctx.index];
    const result = searchStoreVisitText(all('visit'), ctx.storeId, ctx.query);
    ctx.matches = result.matches; ctx.truncated = result.truncated;
    const oldIndex = ctx.matches.findIndex(match => match.visitId === previous?.visitId && match.headId === previous?.headId && match.start === previous?.start);
    ctx.index = oldIndex < 0 ? 0 : oldIndex;
  }
  $('brief-search').disabled = busy || updateHolding || blocked;
  $('brief-search-clear').disabled = busy || updateHolding || blocked || !ctx.query;
  for (const id of ['brief-search-prev', 'brief-search-next']) $(id).disabled = busy || updateHolding || blocked || ctx.composing || !ctx.matches.length;
  const count = ctx.matches.length, match = ctx.matches[ctx.index];
  $('brief-search-status').textContent = blocked ? '搜尋已暫停：請先完成或取消未完成的文字／拜訪草稿。'
    : editing ? '正在編輯原文；搜尋標示暫停，保留目前查詢。'
    : !ctx.query.trim() ? '搜尋本店全部正式拜訪原文；英文不分大小寫。'
    : !count ? '找不到相同文字；不包含提醒、下次跟進或舊版本。'
    : `${ctx.truncated ? '前 ' : '共 '}${count} 處 · 第 ${ctx.index + 1} 處${ctx.truncated ? '（尚有更多，請縮小關鍵字）' : ` · ${new Set(ctx.matches.map(item => item.visitId)).size} 筆紀錄`}`;
  const preview = $('brief-search-preview');
  preview.hidden = !match || blocked || editing;
  if (match && !blocked && !editing) {
    const text = String(by('visit', match.visitId)?.text || '').replace(/\r\n?/g, '\n');
    preview.innerHTML = `<div class="muted">${esc(match.source || '來源未提供')}</div><div>${match.start > 35 ? '…' : ''}${esc(text.slice(Math.max(0, match.start - 35), match.start))}<mark>${esc(match.text)}</mark>${esc(text.slice(match.end, match.end + 55))}${match.end + 55 < text.length ? '…' : ''}</div>`;
  } else preview.replaceChildren();
  paintBriefSearch(jump);
}
function runBriefSearchQuery() {
  clearTimeout(briefSearchTimer); briefSearchTimer = null;
  if (!briefSearchContext || briefSearchContext.composing || briefSearchBlocked() || busy || updateHolding) return;
  briefSearchContext.query = $('brief-search').value;
  briefSearchContext.matches = []; briefSearchContext.index = 0;
  refreshBriefSearch({ search: true, jump: true });
}
function scheduleBriefSearch() {
  clearTimeout(briefSearchTimer); clearBriefSearchHighlights();
  const ctx = briefSearchContext;
  if (!ctx || ctx.composing || briefSearchBlocked() || busy || updateHolding) return;
  briefSearchTimer = setTimeout(() => { if (ctx === briefSearchContext) runBriefSearchQuery(); }, 120);
}
function moveBriefSearch(direction) {
  const ctx = briefSearchContext;
  if (!ctx || ctx.composing || briefSearchBlocked() || busy || updateHolding) return;
  if ($('brief-search').value !== ctx.query) return runBriefSearchQuery();
  if (!ctx.matches.length) return;
  ctx.index = (ctx.index + direction + ctx.matches.length) % ctx.matches.length;
  refreshBriefSearch({ jump: true });
}
function briefTraceHTML(occurrences, field = 'text') {
  const items = occurrences || [];
  const label = items.length > 1 ? `查看 ${items.length} 筆原始紀錄` : '查看同筆原始拜訪文字';
  return `<details class="brief-trace"><summary>${label}</summary>${items.map(item => `<article class="brief-trace-item">${item.source ? `<div><span class="pill">${esc(item.source)}</span></div>` : ''}${field === 'next' ? `<p><strong>下次跟進原文</strong></p><blockquote>${esc(item.text || '原文未提供')}</blockquote><p class="muted">同筆拜訪原文</p><pre>${esc(item.visitText || '原文未提供')}</pre>` : `<pre>${esc(item.text || '原文未提供')}</pre>`}</article>`).join('')}</details>`;
}
function singleStoreCaptureHTML() {
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const options = ['', '現場觀察', '藥師主動提及', '詢問後回覆', '其他'];
  const pick = (type, inputName) => all(type).map(item => `<label class="check"><input type="checkbox" name="${inputName}" value="${esc(item.id)}">${esc(item.name)}</label>`).join('') || '<p class="muted">目前尚未建立可選項目，可直接完成拜訪紀錄。</p>';
  return `<form id="single-store-capture-form" class="single-store-capture" hidden><div class="single-store-capture-head"><div><p class="eyebrow">QUICK CAPTURE</p><h3>記錄這次拜訪</h3></div><span class="pill">門市已固定</span></div><label>原始拜訪內容<textarea id="single-store-text" maxlength="20000" placeholder="直接輸入這次拜訪內容" spellcheck="false"></textarea></label><label>下次跟進（選填）<textarea id="single-store-next" maxlength="20000" placeholder="例如：下次確認庫存"></textarea></label><details class="single-store-more"><summary>更多欄位：日期、來源、人物、主題與附件</summary><div class="field-grid"><label>筆記日期（未知可留空）<input type="date" id="single-store-date" value="${today}"></label><label>資訊來源<select id="single-store-source">${options.map(source => `<option value="${esc(source)}">${esc(source || '未指定')}</option>`).join('')}</select></label></div><label>相關主題</label><div class="check-grid">${pick('topic', 'single-topic')}</div><label>提及人物</label><div class="check-grid">${pick('person', 'single-person')}</div><label>附件（每個上限 3 MB）<input type="file" id="single-store-files" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"></label><p class="muted">新選的附件無法靠草稿跨 App 關閉保存；完成紀錄前若 App 被系統終止，請重新選擇附件。</p></details><p id="single-store-draft-state" class="draft-state" role="status">尚未變更</p><p class="muted">輸入會先加密保存成本機草稿；只有按「完成紀錄」才建立正式拜訪版本。</p><p id="single-store-error" class="error" role="alert"></p></form>`;
}
function singleStoreIdleActions(storeId) {
  const draft = payload?.draft?.format === 'visit-draft-1' ? payload.draft : null;
  if (draft && (!draft.baseData && draft.fields?.store === storeId)) return '<button type="button" class="primary" data-start-single-store-capture>繼續未完成的拜訪紀錄</button>';
  if (draft) return '<button type="button" class="primary" data-resume-single-draft>先完成目前的未完成草稿</button>';
  return '<button type="button" class="primary" data-start-single-store-capture>＋ 開始記錄這次拜訪</button>';
}
function activateSingleStoreCapture(restoreDraft = null) {
  const storeId = $('review').dataset.singleStoreId, store = by('store', storeId);
  if (!store || store.deleted || store.conflict || storeIdentityPending(store)) return toast('這間門市目前無法使用單店快速記錄，請先核對門市狀態。');
  const draft = restoreDraft || (payload?.draft?.format === 'visit-draft-1' && !payload.draft.baseData && payload.draft.fields?.store === storeId ? payload.draft : null);
  if (payload?.draft?.format === 'visit-draft-1' && !draft) return resumeSingleDraftFromReview();
  singleStoreContext = { storeId, id: draft?.id || uuid(), parents: [...(draft?.parents || [])], draftTouched: false };
  const form = $('single-store-capture-form'); form.hidden = false;
  if (draft) applyVisitDraft(draft);
  $('review-persistent-actions').innerHTML = '<button type="button" class="danger" data-discard-single-store-draft>捨棄草稿</button><button type="button" data-collapse-single-store-capture>先收起</button><button type="submit" form="single-store-capture-form" class="primary">完成紀錄</button>';
  $('review-persistent-actions').classList.add('capture-active');
  refreshBriefSearch();
  form.scrollIntoView({ block: 'start' });
  focusReadingSurface($('review'));
}
function resumeSingleDraftFromReview() {
  singleStoreContext = null;
  if ($('review').open) $('review').close();
  resumeVisitDraft();
}
async function collapseSingleStoreCapture() {
  if (!singleStoreContext) return;
  const storeId = singleStoreContext.storeId;
  await flushVisitDraft(); singleStoreContext = null;
  $('single-store-capture-form').hidden = true;
  const actions = $('review-persistent-actions'); actions.classList.remove('capture-active'); actions.innerHTML = singleStoreIdleActions(storeId);
  refreshBriefSearch({ search: true });
}
async function closeSingleStoreReview() {
  if (singleStoreContext) await flushVisitDraft();
  singleStoreContext = null; $('review').close();
}
async function saveSingleStoreVisit(event) {
  event.preventDefault(); await run(async () => {
    const ctx = singleStoreContext;
    if (!ctx || !$('review').open || $('review').dataset.singleStoreId !== ctx.storeId) throw new Error('單店畫面已變更，這次沒有建立紀錄。');
    await flushVisitDraft();
    const store = by('store', ctx.storeId);
    if (!store || store.deleted || store.conflict || storeIdentityPending(store)) throw new Error('門市狀態已變更，這次沒有建立紀錄；請重新核對門市。');
    const text = $('single-store-text').value;
    if (!text.trim()) throw new Error('請填寫拜訪內容。');
    const checked = name => [...document.querySelectorAll(`#single-store-capture-form [name="${name}"]:checked`)].map(input => input.value);
    const data = {
      store: ctx.storeId, date: $('single-store-date').value.trim(), source: $('single-store-source').value.trim(), text,
      next: $('single-store-next').value, topics: checked('single-topic'), people: checked('single-person'), attachments: []
    };
    const blobs = {};
    for (const file of $('single-store-files').files) {
      if (file.size > 3 * 1024 * 1024) throw new Error(`${file.name} 超過 3 MB。`);
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'].includes(file.type) && !/\.heic$/i.test(file.name)) throw new Error('附件只支援 JPEG、PNG、WebP、HEIC 與 PDF。');
      const bytes = new Uint8Array(await file.arrayBuffer()), id = await hashBytes(bytes); blobs[id] = b64(bytes); data.attachments.push({ blob: id, name: file.name.slice(0, 200), mime: file.type || 'application/octet-stream' });
    }
    const choice = await confirmStoreSave(store.id, store.name); if (!choice) return;
    if (singleStoreContext !== ctx) throw new Error('編輯畫面已變更，這次沒有建立紀錄。');
    assertSaveParents('visit', ctx.id, ctx.parents);
    const bundle = structuredClone(payload.bundle); bundle.schema = 2;
    bundle.ops.push(revision('visit', ctx.id, data, ctx.parents, payload.device, false, choice.attendance)); Object.assign(bundle.blobs, blobs); validateBundle(bundle);
    await persist({ ...payload, bundle, dirty: true, draft: null });
    clearTimeout(draftTimer); draftTimer = null; singleStoreContext = null; render(); openVisitBrief(ctx.storeId);
    toast('拜訪已完成並保存於手機；你仍停留在這間門市，等待 Mac 確認收到。');
  }, 'single-store-error');
}
function openVisitBrief(storeId, { capture = false, restoreDraft = null, preservePosition = false } = {}) {
  const review = $('review'), reviewBody = $('review-body');
  const preserving = preservePosition && review.open && review.dataset.singleStoreId === storeId;
  const preserved = preserving ? {
    scrollTop: reviewBody.scrollTop,
    secondaryOpen: !!reviewBody.querySelector('.brief-secondary')?.open,
    historyOpen: !!reviewBody.querySelector('.brief-history')?.open,
    tasksOpen: !!reviewBody.querySelector('.reminder-task-history')?.open
  } : null;
  const brief = visitBriefForStore(storeId, all('visit'), all('store'), all('person'));
  if (!brief) return toast('這間門市目前有衝突、身分待確認或已移到回收桶，無法建立重點卡。');
  prepareBriefSearch(storeId, review.open && review.dataset.singleStoreId === storeId);
  const location = [brief.store.city, brief.store.district, brief.store.channel].filter(Boolean).join(' · ') || '地區／通路未提供';
  const reminders = brief.store.nextRemember || brief.store.everyTimeMust || brief.store.nextRememberTasks?.length || reminderTaskHistory(brief.store).length ? `<section class="brief-reminders">${reminderTasksHTML(brief.store)}${brief.store.nextRemember ? `<div><strong>下次記得（尚未轉成任務）</strong><p>${esc(brief.store.nextRemember)}</p></div>` : ''}${brief.store.everyTimeMust ? `<div><strong>每次必做、必給</strong><p>${esc(brief.store.everyTimeMust)}</p></div>` : ''}<button type="button" class="text-button" data-store-reminder="${esc(storeId)}">修改門市提醒</button></section>` : `<button type="button" class="brief-empty-reminder" data-store-reminder="${esc(storeId)}">＋ 填寫門市提醒</button>`;
  const followups = brief.followups.length ? brief.followups.map(item => `<article class="brief-item explicit">${item.source || item.count > 1 ? `<div>${item.source ? `<span class="pill">${esc(item.source)}</span>` : ''}${item.count > 1 ? `<span class="pill brief-duplicate">相同內容 ${item.count} 筆</span>` : ''}</div>` : ''}<p>${esc(item.text)}</p>${briefTraceHTML(item.occurrences, 'next')}</article>`).join('') : '<p class="empty">目前沒有明確填寫的下次跟進。</p>';
  const candidates = brief.candidates.length ? brief.candidates.map(item => `<button type="button" class="candidate-chip ${esc(item.statusKind)}" data-candidate-key="${esc(item.key)}" data-candidate-store="${esc(storeId)}"><strong>${esc(item.name)}</strong><span>${esc(item.category)} · ${item.visitCount} 筆／${item.lineCount} 條原文 · ${esc(item.statusLabel)} · 點選核對</span></button>`).join('') : '<p class="empty">目前沒有符合可稽核字詞規則的候選提示。</p>';
  const recentCount = brief.recent.reduce((sum, item) => sum + item.count, 0);
  const recent = brief.recent.length ? brief.recent.map(item => `<article class="brief-item">${item.source || item.count > 1 ? `<div>${item.source ? `<span class="pill">${esc(item.source)}</span>` : ''}${item.count > 1 ? `<span class="pill brief-duplicate">相同內容 ${item.count} 筆</span>` : ''}</div>` : ''}<pre>${esc(item.text || '原文未提供')}</pre>${item.topics.length || item.people.length ? `<div class="chips">${item.topics.map(id => chip('topic', id)).join('')}${item.people.map(id => chip('person', id)).join('')}</div>` : ''}${item.count > 1 ? briefTraceHTML(item.occurrences) : ''}</article>`).join('') : '<p class="empty">目前沒有可顯示的拜訪原文。</p>';
  const history = all('visit').filter(item => item.store === storeId && !item.deleted && !item.conflict).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  const historyHTML = history.map(item => `<article class="brief-item" data-brief-visit="${esc(item.id)}"><div><span class="pill">${esc(item.source || '來源未提供')}</span></div>${inlineVisitTextHTML(item)}${item.next ? `<p class="next"><strong>下次跟進</strong>${esc(item.next)}</p>` : ''}</article>`).join('') || '<p class="empty">目前沒有拜訪紀錄。</p>';
  const explicitItems = brief.explicitLinks.map(item => {
    const linked = chip(item.type, item.id); if (!linked) return '';
    return `<article class="brief-linked-item"><div>${linked}<span class="muted">${item.visitCount} 筆明確連結</span></div>${briefTraceHTML(item.occurrences)}</article>`;
  }).filter(Boolean).join('');
  const explicit = explicitItems ? `<section class="visit-brief-section"><h3>已明確連結的人物與主題</h3><p class="muted">每項連結都保留建立它的拜訪原文。</p><div class="brief-linked-list">${explicitItems}</div></section>` : '';
  singleStoreContext = null; review.dataset.singleStoreId = storeId;
  $('review-title').textContent = '單店拜訪｜' + brief.store.name;
  reviewBody.innerHTML = `<div class="visit-brief-head"><p>${esc(location)} · ${brief.visitCount} 筆可用紀錄</p>${storeAttendanceHTML(storeId, true)}</div>${reminders}${singleStoreCaptureHTML()}<section class="visit-brief-section brief-followups"><h3>明確填寫的下次跟進</h3>${followups}</section><details class="brief-secondary" ${preserved?.secondaryOpen ? 'open' : ''}><summary>查看人物、主題、原文候選與最近拜訪原文</summary><div class="candidate-disclaimer"><strong>內容來源與限制</strong><p>只排列你已填寫的欄位、正式拜訪原文與可追溯候選；不生成或改寫正式拜訪內容。只把全半形、英文字母大小寫與空白差異視為相同內容，標點或用詞不同仍分開；完整歷史永遠保留每一筆。</p></div>${explicit}<section class="visit-brief-section"><h3>原文候選提示</h3><p class="muted">點選每個候選可核對命中的原句、來源與原文狀態。</p><div class="candidate-chip-list">${candidates}</div></section><section class="visit-brief-section"><h3>最近 ${recentCount} 筆拜訪原文${brief.recent.length < recentCount ? ` · 合併顯示 ${brief.recent.length} 組` : ''}</h3>${recent}</section></details><details class="brief-history" ${preserved ? preserved.historyOpen ? 'open' : '' : 'open'}><summary>既有拜訪原文 · 全部 ${history.length} 筆（可直接修改）</summary><p class="muted">點一下既有拜訪原文即可直接輸入；修改會先加密保存成本機草稿，核對修改前後差異並最後確認後，才建立同一筆拜訪的新版本。這裡不去重，每筆原文、下次跟進與歷史都保留。</p>${historyHTML}</details>`;
  $('review-persistent-actions').classList.remove('capture-active');
  $('review-persistent-actions').innerHTML = singleStoreIdleActions(storeId);
  $('review-persistent-actions').hidden = false;
  if (preserving) {
    setReviewMode('visit-brief');
    const taskHistory = reviewBody.querySelector('.reminder-task-history'); if (taskHistory) taskHistory.open = preserved.tasksOpen;
    const restorePosition = () => { reviewBody.scrollTop = preserved.scrollTop; };
    restorePosition(); requestAnimationFrame(restorePosition);
  } else openDialog(review, { reviewMode: 'visit-brief' });
  if (capture) activateSingleStoreCapture(restoreDraft);
  refreshBriefSearch({ search: true });
}
function canonicalPerson(id) { const seen = new Set(); let r = by('person', id); while (r?.sameAs && !r.conflict && !seen.has(r.id)) { seen.add(r.id); r = by('person', r.sameAs); } return r?.id || id; }
function related(f = focus) {
  const tag = by(f.type, f.id)?.csvTag;
  const tagged = tag ? all('store').filter(s => sourceTags(s).includes(tag)).map(s => s.id) : [];
  return groupCSVNotes(all('visit').filter(v => f.type === 'store' || relationVisitAllowed(v, all('store'))).filter(v => f.type === 'store' ? v.store === f.id : f.type === 'topic' ? tag ? tagged.includes(v.store) : v.topics.includes(f.id) : v.people.some(p => canonicalPerson(p) === canonicalPerson(f.id))).sort((a, b) => b.date.localeCompare(a.date)));
}
function chip(type, id, query = '') { const r = by(type, id); return r ? `<button class="chip ${type}" data-node-type="${type}" data-node-id="${esc(id)}">${type === 'topic' ? '# ' : ''}${highlightLiteral(r.name, query)}${r.conflict ? ' ⚠' : ''}</button>` : ''; }
function inlineVisitTextHTML(v, query = '') {
  const savedInlineDraft = payload?.inlineTextDraft?.format === 'inline-text-draft-1' && payload.inlineTextDraft.id === v.id ? payload.inlineTextDraft : null;
  const liveInlineDraft = inlineTextContext?.id === v.id && inlineTextContext.after !== inlineTextContext.before ? inlineTextContext : null;
  const inlineDraft = liveInlineDraft || savedInlineDraft;
  const inlineBlocked = inlineTextBlockReason(v.id);
  const inlineBlockAction = payload?.draft?.format === 'visit-draft-1'
    ? '<button type="button" class="text-button" data-resume-visit-draft>回到未完成拜訪</button>'
    : pendingInlineTextId() && pendingInlineTextId() !== v.id
      ? '<button type="button" class="text-button" data-resume-inline-draft>回到未完成修改</button>'
      : '';
  const shownText = inlineDraft?.after ?? v.text;
  return v.conflict
    ? `<p>${highlightLiteral(v.text, query)}</p>`
    : `<div class="inline-edit-shell ${inlineDraft ? 'editing' : ''} ${inlineBlocked ? 'locked' : ''}" data-inline-shell="${esc(v.id)}"><div class="inline-edit-text" contenteditable="${inlineBlocked ? 'false' : 'true'}" ${inlineBlocked ? 'aria-disabled="true"' : ''} role="textbox" aria-multiline="true" aria-label="直接修改這筆拜訪文字" spellcheck="false" data-inline-edit-text="${esc(v.id)}">${highlightLiteral(shownText, query)}</div>${inlineBlocked ? `<div class="inline-edit-blocked" role="status"><span>${esc(inlineBlocked)}</span>${inlineBlockAction}</div>` : ''}<div class="inline-edit-actions" ${inlineDraft ? '' : 'hidden'}><span class="muted" data-inline-state="${esc(v.id)}" role="status">${savedInlineDraft ? '修改草稿已加密保存在這台裝置，尚未寫入正式紀錄。' : inlineDraft ? '修改正在加密保存；正式紀錄尚未改變。' : ''}</span><button type="button" data-inline-cancel="${esc(v.id)}">取消修改</button><button type="button" class="primary" data-inline-review="${esc(v.id)}">檢查並儲存修改</button></div></div>`;
}
function noteHTML(v, query = '') {
  if (v.evidenceMembers?.length > 1) return `<section class="note"><h3>相同來源文字 · ${v.evidenceMembers.length} 份來源</h3>${storeAttendanceHTML(v.store)}<p>同店、同日期欄位與全文相同，整合顯示一次；不代表已證實是同一次拜訪。每份來源與歷史都保留。</p><p>${highlightLiteral(v.text, query)}</p><details><summary>展開所有來源、歷史與各別操作</summary>${v.evidenceMembers.map(item => noteHTML(item, query)).join('')}</details></section>`;
  const rule = activeView === 'explore' ? entityRule(by(focus.type, focus.id)) : null;
  const evidence = rule ? evidenceKind(v.text, rule) : null;
  const hint = evidence?.lines.length ? `<div class="evidence-hint ${evidence.kind}"><strong>${esc(evidence.label)} · 字詞線索</strong>${evidence.lines.map(line => `<blockquote>${esc(line)}</blockquote>`).join('')}</div>` : '';
  const sourceState = v.sourceMissing ? '<div class="conflict-card">Google 最新匯出已沒有這段備註；程式保留最後內容，未刪除。</div>' : v.googleUpdatePending ? `<div class="conflict-card">Google 備註已有新版；你曾在 App 修改原文，因此先保留 App 文字。<details><summary>查看 Google 最新文字</summary><p>${esc(v.googleText)}</p></details></div>` : '';
  const store = by('store', v.store), hasStoreNotes = !!store && !!(store.nextRemember || store.everyTimeMust || store.nextRememberTasks?.length || reminderTaskHistory(store).length);
  const storeNotes = store && !store.conflict ? `<div class="store-memory ${hasStoreNotes ? '' : 'empty'}">${reminderTasksHTML(store)}${store.nextRemember ? `<p><strong>下次記得（尚未轉成任務）：</strong>${esc(store.nextRemember)}</p>` : ''}${store.everyTimeMust ? `<p><strong>每次必做、必給：</strong>${esc(store.everyTimeMust)}</p>` : ''}<button type="button" class="text-button store-reminder-edit" data-store-reminder="${esc(store.id)}">${hasStoreNotes ? '修改門市提醒' : '＋ 填寫門市提醒'}</button></div>` : '';
  const textBlock = inlineVisitTextHTML(v, query);
  const storeButton = store && !store.conflict && !storeIdentityPending(store) ? `data-visit-brief="${esc(v.store)}"` : `data-node-type="store" data-node-id="${esc(v.store)}"`;
  const advanced = `${sourceButton(v)}<button class="text-button" data-edit="visit:${esc(v.id)}">完整編輯</button><button class="text-button" data-history="visit:${esc(v.id)}">歷史 ${v.versions.length}</button><button class="text-button danger" data-delete="visit:${esc(v.id)}">移到回收桶</button>`;
  return `<article class="note">${v.source ? `<div class="note-head"><span class="pill">${esc(v.source)}</span></div>` : ''}<button class="text-button store-link" ${storeButton}>${highlightLiteral(name('store', v.store), query)}</button>${storeAttendanceHTML(v.store)}${storeNotes}${v.conflict ? `<div class="conflict-card">這筆有 ${v.heads.length} 個版本。以下僅顯示其中一個，請先核對。 <button class="text-button" data-review="visit:${esc(v.id)}">處理衝突</button></div>` : ''}${sourceState}${hint}${textBlock}<div class="chips">${v.topics.map(id => chip('topic', id, query)).join('')}${v.people.map(id => chip('person', id, query)).join('')}</div>${v.next ? `<p class="next"><strong>下次跟進</strong>${highlightLiteral(v.next, query)}</p>` : ''}<div class="attachments">${(v.attachments || []).map((a, i) => `<button data-attachment="${esc(v.id)}" data-index="${i}">↧ ${esc(a.name)}</button>`).join('')}</div><div class="note-actions">${!v.conflict && store && !storeIdentityPending(store) ? `<button class="primary" data-new-visit-store="${esc(v.store)}">＋ 記錄這次拜訪</button>` : ''}<details class="more-actions"><summary>更多操作</summary><div>${advanced}</div></details></div></article>`;
}
function render() {
  if (!payload) return;
  records = project(payload.bundle); status();
  if (!by(focus.type, focus.id) || by(focus.type, focus.id).deleted) { const first = all('topic').find(t => t.ruleKey === 'ortho') || all('store')[0] || all('topic')[0] || all('person')[0]; focus = first ? { type: first.type, id: first.id } : { type: 'store', id: '' }; }
  if (activeView === 'explore') { renderStores(); renderFocus(); }
  if (activeView === 'visits') renderVisits();
  if (activeView === 'quality') renderQuality();
  if (activeView === 'stores') renderStores();
  if (activeView === 'regional') renderRegional();
  if (activeView === 'entities') $('entity-list').innerHTML = [...all('person'), ...all('topic')].map(entityCard).join('') || '<p class="empty">新增人物與主題，讓拜訪紀錄產生連結。</p>';
  if (activeView === 'csv') csvImport.refresh();
  $('conflict-list').innerHTML = records.filter(r => r.conflict).map(r => `<div class="conflict-card"><strong>${esc(r.name || name('store', r.store) + ' · ' + r.date)}</strong><p>${r.heads.length} 個版本待確認</p><button data-review="${r.type}:${esc(r.id)}">比較並處理</button></div>`).join('') || '<p class="muted">目前沒有衝突。</p>';
  if (activeView === 'trash') $('trash-list').innerHTML = records.filter(r => r.deleted && !r.conflict).map(r => `<article class="panel"><span class="pill">${kinds[r.type]}${r.mergedInto ? ' · 已整併' : ''}</span><h3>${esc(r.name || name('store', r.store) + ' · ' + r.date)}</h3><p>${r.mergedInto ? '已依裁定整併至：' + esc(name('store', r.mergedInto)) + '。原版本與歷史仍保留。' : esc(r.text || r.desc || r.contact || '')}</p><button data-restore="${r.type}:${esc(r.id)}">還原</button> <button data-history="${r.type}:${esc(r.id)}">查看歷史</button></article>`).join('') || '<p class="empty">回收桶是空的。</p>';
}
function entityCard(r) { const advanced = `${sourceButton(r)}<button class="text-button" data-edit="${r.type}:${esc(r.id)}">完整編輯</button><button class="text-button" data-history="${r.type}:${esc(r.id)}">歷史</button><button class="text-button danger" data-delete="${r.type}:${esc(r.id)}">刪除</button>`; return `<article class="panel"><span class="pill ${r.conflict ? 'warn' : ''}">${kinds[r.type]}${r.conflict ? ' · 有衝突' : ''}${storeIdentityPending(r) ? ' · 需要後續的確認' : ''}</span><h3>${esc(r.name)}</h3>${r.type === 'store' ? storeAttendanceHTML(r.id) : ''}${r.type === 'store' ? '<span class="pill retail-label">' + esc(retailChannel(r).label) + '</span>' : ''}${r.csvAliases?.length ? '<p class="muted">來源名稱：' + r.csvAliases.map(esc).join('／') + '</p>' : ''}<p>${esc(r.type === 'store' ? `${r.attr}\n${r.contact}` : r.type === 'person' ? `${r.confirmed ? '身分已核對' : '身分待確認'} · ${r.role}${r.sameAs ? '\n連到：' + name('person', r.sameAs) : ''}` : r.desc)}</p><div class="note-actions">${r.type === 'store' && !r.conflict ? `${!storeIdentityPending(r) ? `<button class="primary" data-visit-brief="${esc(r.id)}">單店拜訪</button>` : ''}<button class="secondary" data-new-visit-store="${esc(r.id)}">＋ 新增拜訪</button>` : ''}<details class="more-actions"><summary>更多操作</summary><div>${advanced}</div></details></div></article>`; }
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
  openDialog($('review'));
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
  openDialog($('editor'));
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
function currentRegionalInsights() {
  return regionalInsights(regionalCity, regionalDistrict, all('visit'), all('store'), all('person'), all('topic'));
}
function regionalPercent(value, total) { return total ? `${Math.round(value * 100)}%` : '無比較基準'; }
function regionalSignalCard(signal, report) {
  const comparison = report.comparisonStoreCount
    ? `${report.comparisonLabel} ${signal.comparisonStoreCount}／${report.comparisonStoreCount} 間（${regionalPercent(signal.comparisonRate, report.comparisonStoreCount)}）`
    : `${report.comparisonLabel}沒有足夠資料`;
  return `<button type="button" class="regional-signal ${signal.distinctive ? 'standout' : ''}" data-regional-signal="${esc(signal.key)}"><span class="pill">${esc(signal.concentrationLabel)}</span><strong>${esc(signal.name)}</strong><span>${esc(signal.category)} · 本區 ${signal.regionStoreCount}／${report.storeCount} 間（${regionalPercent(signal.regionRate, report.storeCount)}）</span><small>${esc(comparison)} · ${signal.visitCount} 筆相關拜訪</small></button>`;
}
function openRegionalSignal(key) {
  const report = currentRegionalInsights(), signal = [...(report?.explicitSignals || []), ...(report?.candidateSignals || []), ...(report?.emergingSignals || [])].find(item => item.key === key);
  if (!report || !signal) return toast('這項區域線索已因資料變更而不存在，請重新查看區域觀察。');
  const sourceText = signal.sourceMode === 'explicit'
    ? '這個主題來自你已明確連結的拜訪主題。'
    : signal.sourceMode === 'literal'
      ? '這不是預設主題，而是目前至少兩間門市的正式拜訪原文出現相同完整字詞；系統保留原句供你判斷它是否具有商業意義。'
    : '這是依可稽核字詞規則從正式拜訪原文找出的候選線索；每個原句的否定、詢問與提及狀態分開保留。';
  const comparison = report.comparisonStoreCount
    ? `${report.label}：${signal.regionStoreCount}／${report.storeCount} 間（${regionalPercent(signal.regionRate, report.storeCount)}）；${report.comparisonLabel}：${signal.comparisonStoreCount}／${report.comparisonStoreCount} 間（${regionalPercent(signal.comparisonRate, report.comparisonStoreCount)}）。`
    : `${report.comparisonLabel}沒有足夠門市資料，因此只呈現本區共同出現次數，不判定相對集中度。`;
  const evidence = signal.regionStores.map(store => {
    const items = (store.evidence || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return `<article class="regional-evidence-store"><div class="section-row"><div><strong>${esc(store.storeName)}</strong><p class="muted">${items.length} 條證據</p></div><button type="button" class="text-button" data-regional-store="${esc(store.storeId)}">查看門市</button></div>${items.slice(0, 12).map(item => `<div class="regional-evidence"><span class="pill candidate-status ${esc(item.kind)}">${esc(item.label)}</span><span class="muted">${esc(item.source || '來源未提供')}</span><blockquote>${esc(item.line || '原文未提供')}</blockquote></div>`).join('')}${items.length > 12 ? `<p class="muted">另有 ${items.length - 12} 條證據，可進入門市查看完整原文。</p>` : ''}</article>`;
  }).join('');
  $('review-title').textContent = report.label + '｜' + signal.name;
  $('review-body').innerHTML = `<div class="candidate-disclaimer"><strong>${esc(signal.concentrationLabel)} · ${esc(signal.category)}</strong>${signal.definition ? `<p><strong>詞彙定義：</strong>${esc(signal.definition)}</p>` : ''}<p>${esc(sourceText)}</p><p>${esc(comparison)}</p><p>集中度只代表目前紀錄中有多少門市出現相同線索，不代表實際需求量、產品接受度、因果關係或完整市場母體。</p></div>${evidence || '<p class="empty">目前沒有可顯示的原文證據。</p>'}`;
  openDialog($('review'));
}
function renderRegional() {
  if (!payload) return;
  const options = regionalOptions(all('store'));
  if (!options.some(option => option.city === regionalCity)) regionalCity = options[0]?.city || '';
  const city = options.find(option => option.city === regionalCity), districts = city?.districts || [];
  if (regionalDistrict && !districts.some(option => option.district === regionalDistrict)) regionalDistrict = '';
  $('regional-city').innerHTML = options.map(option => `<option value="${esc(option.city)}">${esc(option.city)} · ${option.count} 間</option>`).join('') || '<option value="">尚無可分析縣市</option>';
  $('regional-city').value = regionalCity;
  $('regional-district').innerHTML = '<option value="">整個縣市</option>' + districts.map(option => `<option value="${esc(option.district)}">${esc(option.district)} · ${option.count} 間</option>`).join('');
  $('regional-district').value = regionalDistrict;
  const report = currentRegionalInsights();
  if (!report || !report.storeCount) {
    $('regional-content').innerHTML = '<p class="empty">目前沒有具備安全門市身分與縣市資料的門市可供分析。身分待確認、同步衝突及回收桶資料不會加入。</p>';
    return;
  }
  const combined = [...report.explicitSignals, ...report.candidateSignals, ...report.emergingSignals], standouts = combined.filter(signal => signal.distinctive), shared = combined.filter(signal => !signal.distinctive && signal.regionStoreCount >= 2);
  const singleCount = combined.filter(signal => signal.regionStoreCount === 1).length;
  const signalSection = (title, description, items) => `<section class="regional-section"><h3>${title}</h3><p class="muted">${description}</p><div class="regional-signal-list">${items.map(signal => regionalSignalCard(signal, report)).join('') || '<p class="empty">目前沒有符合這個層級的線索。累積更多跨店拜訪紀錄後會自動重新計算。</p>'}</div></section>`;
  const coverage = report.storesWithVisits === report.storeCount ? '每間門市都有可用拜訪紀錄' : `${report.storesWithVisits}／${report.storeCount} 間有可用拜訪紀錄`;
  const comparisonWarning = report.comparisonStoreCount < 2 ? '<p class="conflict-card">比較區域少於 2 間門市，本版不會把任何項目標成「區域獨有」或「區域較集中」；仍可查看本區跨店共同線索。</p>' : '';
  const profiles = report.storeProfiles.map(item => `<article class="regional-profile"><div><strong>${esc(item.storeName)}</strong><span class="muted">${esc([item.channel, ...item.tags].filter(Boolean).join(' · ') || '門市型態未提供')}</span></div>${item.attr ? `<p>${esc(item.attr)}</p>` : ''}<button type="button" class="text-button" data-regional-store="${esc(item.storeId)}">查看門市</button></article>`).join('') || '<p class="empty">本區尚未填寫客群／門市特徵，也沒有可追溯來源標籤。</p>';
  const channels = report.channels.map(item => `<span class="pill">${esc(item.label)} · ${item.count}</span>`).join('') || '<span class="muted">尚無通路分群</span>';
  $('regional-content').innerHTML = `<div class="regional-metrics"><div><strong>${report.storeCount}</strong><span>安全納入門市</span></div><div><strong>${report.visitCount}</strong><span>可用拜訪紀錄</span></div><div><strong>${report.storesWithVisits}</strong><span>有紀錄門市</span></div></div><p class="muted">${esc(report.label)} · ${esc(coverage)} · ${report.datedVisitCount} 筆有筆記日期（非實際拜訪確認）。${report.excludedStoreCount ? `另有 ${report.excludedStoreCount} 間因衝突、回收桶或身分待確認而排除。` : ''}</p>${comparisonWarning}<div class="candidate-disclaimer"><strong>閱讀方式</strong><p>區域突出線索至少要出現在 2 間門市，並和${esc(report.comparisonLabel)}比較。系統只計算既有紀錄的出現比例；所有結論都可點開核對原文。</p></div>${signalSection('區域突出線索', `相對${esc(report.comparisonLabel)}更集中，或目前只在本區跨店出現。這是優先覆盤線索，不是已確認市場結論。`, standouts)}${signalSection('區域內共同線索', '至少在本區 2 間門市出現，但和比較區域的差異尚不足以稱為突出。', shared)}${singleCount ? `<p class="muted regional-single-note">另有 ${singleCount} 項只出現在單一門市，保留在該店的拜訪前重點中，不升級為區域線索。</p>` : ''}<section class="regional-section"><h3>通路分布</h3><div class="chips">${channels}</div></section><section class="regional-section"><h3>客群、門市特徵與來源標籤</h3><p class="muted">直接排列人工門市特徵與可追溯來源標籤，不改寫、不合併，也不從空白欄位猜測。</p><div class="regional-profile-list">${profiles}</div></section>`;
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
  $('focus-header').innerHTML = `<div class="focus-top"><span class="pill ${r.type === 'person' && !r.confirmed ? 'warn' : ''}">${kinds[r.type]}${r.type === 'person' ? r.confirmed ? ' · 已核對' : ' · 待確認' : ''}</span><div class="focus-actions">${trail.length ? '<button id="back-node" class="text-button">← 上一個節點</button>' : ''}<button id="candidate-overview" class="text-button">跨店候選摘要</button></div></div><h2>${esc(r.name)}</h2><p class="muted">${esc(r.type === 'store' ? `${r.city} ${r.district} · ${r.channel}` : r.type === 'person' ? r.role : r.desc)}</p>${r.conflict ? `<button class="danger" data-review="${r.type}:${esc(r.id)}">先處理這個節點的衝突</button>` : ''}`;
  const pendingIdentity = storeIdentityPending(r), topics = pendingIdentity ? [] : [...new Set(vv.flatMap(v => v.topics))], people = pendingIdentity ? [] : [...new Set(vv.flatMap(v => v.people))];
  if (r.type === 'store' && !pendingIdentity) topics.push(...all('topic').filter(t => t.csvTag && sourceTags(r).includes(t.csvTag)).map(t => t.id));
  const candidates = r.type === 'store' && !pendingIdentity ? relationCandidates(r.id) : [];
  const candidateHTML = r.type === 'store' ? `<h3>原文候選關聯</h3><p class="muted">系統只建立可追溯到原文的唯讀候選，不會把候選當成已確認需求。點節點可查看原句、來源與其他門市。</p><div class="candidate-chip-list">${candidates.map(item => `<button type="button" class="candidate-chip ${esc(item.statusKind)}" data-candidate-key="${esc(item.key)}" data-candidate-store="${esc(r.id)}"><strong>${esc(item.name)}</strong><span>${esc(item.category)} · ${esc(item.statusLabel)} · ${item.visitCount} 筆</span></button>`).join('') || '<span class="muted">目前原文沒有命中可稽核規則；系統不會為了填滿關聯圖而猜測。</span>'}</div>` : '';
  $('focus-detail').innerHTML = `<div class="metrics"><div><strong>${storeIDs.length}</strong><span>相關門市</span></div><div><strong>${vv.length}</strong><span>相關原文</span></div><div><strong>${vv.filter(v => v.csvSources?.length).length}</strong><span>可追溯 CSV</span></div>${r.type === 'store' ? `<div><strong>${candidates.length}</strong><span>候選關聯</span></div>` : ''}</div>${r.type === 'store' ? `<h3>門市窗口</h3><p>${esc(r.contact)}</p><p class="muted">${esc(r.attr)}</p><p>${esc(r.address || '')}</p><p class="muted">${esc((r.lists || []).join('、'))}</p><p>${sourceTags(r).map(t => `<span class="pill">${esc(t)}</span>`).join(' ')}</p>${sourceButton(r)}` : ''}${r.type === 'person' ? `<p>${esc(r.desc)}</p>${r.sameAs ? `<p>已確認連到 ${chip('person', r.sameAs)}</p>` : ''}` : ''}<h3>已明確連結的主題</h3><div class="chips">${topics.map(id => chip('topic', id)).join('') || '<span class="muted">尚未手動連結主題</span>'}</div><h3>已明確連結的人物</h3><div class="chips">${people.map(id => chip('person', id)).join('') || '<span class="muted">尚未手動連結人物</span>'}</div>${candidateHTML}<div class="insight"><h3>證據層級</h3><p>「已明確連結」與「系統候選」分開顯示。原文提及、否定／未遇到、詢問／待釐清都保留各自狀態；共同提及不能直接當成市場需求或人際關係。</p></div>`;
  if (pendingIdentity) $('focus-detail').innerHTML = '<p class="conflict-card">需要後續的確認：原文保留，門市身分核實前暫不建立關聯。請到編輯門市核實名稱與來源後，明確勾選已核對身分。</p>' + sourceButton(r);
  $('evidence-list').innerHTML = vv.map(noteHTML).join('') || '<p class="empty">尚無相關拜訪紀錄。</p>'; $('evidence-count').textContent = vv.length;
  drawGraph();
}
function drawGraph() {
  if (!payload || activeView !== 'explore') return;
  const r = by(focus.type, focus.id); if (!r) return;
  if (storeIdentityPending(r)) { $('graph').innerHTML = ''; $('graph-pager').textContent = '門市身分待確認，暫不呈現關聯'; return; }
  const visits = related(), links = [];
  function add(type, id) { if ((type === focus.type && id === focus.id) || links.some(x => !x.candidate && x.type === type && x.id === id) || !by(type, id)) return; links.push({ type, id, candidate: false }); }
  if (focus.type === 'store') {
    visits.forEach(v => v.topics.forEach(id => add('topic', id))); visits.forEach(v => v.people.forEach(id => add('person', id))); all('topic').filter(t => t.csvTag && sourceTags(r).includes(t.csvTag)).forEach(t => add('topic', t.id));
    const confirmedRules = new Set(links.filter(item => item.type === 'topic').map(item => entityRule(by('topic', item.id))?.key).filter(Boolean));
    const confirmedPeople = new Set(links.filter(item => item.type === 'person').map(item => item.id));
    for (const candidate of relationCandidates(r.id)) {
      if (candidate.ruleKey && confirmedRules.has(candidate.ruleKey)) continue;
      if (candidate.personId && confirmedPeople.has(candidate.personId)) continue;
      links.push({ ...candidate, candidate: true, storeId: r.id });
    }
  } else if (r.csvTag) all('store').filter(s => !storeIdentityPending(s) && sourceTags(s).includes(r.csvTag)).forEach(s => add('store', s.id));
  else visits.forEach(v => add('store', v.store));
  if (focus.type === 'person') all('person').filter(p => p.id !== focus.id && (p.name.includes(r.name.replace('（待確認）', '')) || r.name.includes(p.name.replace('（待確認）', '')))).forEach(p => add('person', p.id));
  graphPage = Math.min(graphPage, Math.max(0, Math.ceil(links.length / 8) - 1));
  $('graph-pager').innerHTML = links.length > 8 ? `<button data-graph-page="-1" ${graphPage === 0 ? 'disabled' : ''}>上一頁</button><span>節點 ${graphPage * 8 + 1}–${Math.min(links.length, (graphPage + 1) * 8)}／${links.length}</span><button data-graph-page="1" ${graphPage === Math.ceil(links.length / 8) - 1 ? 'disabled' : ''}>下一頁</button>` : `<span>全部 ${links.length} 個關聯節點</span>`;
  const nodes = links.slice(graphPage * 8, graphPage * 8 + 8), w = Math.max(280, $('graph-wrap').clientWidth), h = 420, cx = w / 2, cy = h / 2, nw = Math.min(152, w * .44);
  $('graph').setAttribute('viewBox', `0 0 ${w} ${h}`); $('graph-wrap').style.height = `${h}px`;
  const positions = [[w * .25, 43], [w * .75, 43], [w * .25, 121], [w * .75, 121], [w * .25, 299], [w * .75, 299], [w * .25, 377], [w * .75, 377]];
  let edges = '', shapes = '';
  nodes.forEach((n, i) => {
    const e = n.candidate ? n : by(n.type, n.id), [x, y] = positions[i];
    const pending = n.candidate || n.type === 'person' && !e.confirmed || r.type === 'person' && !r.confirmed;
    edges += `<path class="edge ${n.candidate ? 'candidate' : pending ? 'pending' : ''}" d="M${cx} ${cy} Q${cx} ${y} ${x} ${y}"/>`;
    const label = e.name.length > 10 ? e.name.slice(0, 9) + '…' : e.name;
    const subtitle = n.candidate ? `${n.statusLabel} · ${n.visitCount}筆` : pending ? '同名待核對' : r.csvTag ? '原始標籤相同' : focus.type === 'topic' ? evidenceKind(visits.filter(v => v.store === n.id).map(v => v.text).join('\n'), entityRule(r)).label : kinds[n.type];
    const attrs = n.candidate ? `data-candidate-key="${esc(n.key)}" data-candidate-store="${esc(n.storeId)}"` : `data-node-type="${n.type}" data-node-id="${esc(n.id)}"`;
    shapes += `<g class="node ${n.candidate ? 'candidate' : pending ? 'pending' : ''}" role="button" tabindex="0" aria-label="${n.candidate ? '查看候選關聯' : '探索'}${esc(e.name)}" ${attrs}><title>${esc(e.name)} · ${esc(n.candidate ? n.category + ' · ' + n.statusLabel + '；系統候選不是已確認事實' : subtitle)}</title><rect x="${x - nw / 2}" y="${y - 27}" width="${nw}" height="54" rx="9"/><text x="${x}" y="${y - 2}" text-anchor="middle">${esc(label)}</text><text class="sub" x="${x}" y="${y + 16}" text-anchor="middle">${esc(subtitle)}</text></g>`;
  });
  $('graph').innerHTML = `<title>${esc(r.name)}的相關節點</title>${edges}${shapes}<g class="node center"><rect x="${cx - 82}" y="${cy - 30}" width="164" height="60" rx="10"/><text class="sub" x="${cx}" y="${cy - 8}" text-anchor="middle">目前中心 · ${kinds[r.type]}</text><text x="${cx}" y="${cy + 13}" text-anchor="middle">${esc(r.name.slice(0, 11))}</text></g>`;
}
function visitSearchRank(v, needle) {
  if (!needle) return 0;
  const lower = value => String(value ?? '').toLocaleLowerCase('zh-Hant');
  const storeName = lower(name('store', v.store)), q = lower(needle);
  if (storeName === q) return 0;
  if (storeName.includes(q)) return 1;
  if (lower(v.text).includes(q)) return 2;
  if (lower(v.next).includes(q)) return 3;
  if (v.topics.some(id => lower(name('topic', id)).includes(q))) return 4;
  if (v.people.some(id => lower(name('person', id)).includes(q))) return 5;
  return Infinity;
}
function visitSearchSnippet(value, query, before = 38, after = 70) {
  const text = String(value ?? ''), needle = String(query ?? '').trim();
  if (!needle) return esc(text);
  const lower = text.toLocaleLowerCase('zh-Hant'), q = needle.toLocaleLowerCase('zh-Hant'), index = lower.indexOf(q);
  if (index < 0) return '';
  const start = Math.max(0, index - before), end = Math.min(text.length, index + needle.length + after);
  return highlightLiteral((start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : ''), needle);
}
function visitSearchPreview(v, query) {
  const lower = value => String(value ?? '').toLocaleLowerCase('zh-Hant'), q = query.toLocaleLowerCase('zh-Hant');
  if (lower(name('store', v.store)).includes(q)) return '<span class="muted">門市名稱符合搜尋字詞</span>';
  const fields = [
    ['拜訪原文', v.text],
    ['下次跟進', v.next],
    ['主題', v.topics.map(id => name('topic', id)).join('、')],
    ['人物', v.people.map(id => name('person', id)).join('、')]
  ];
  const hit = fields.find(([, value]) => lower(value).includes(q));
  return hit ? `<span class="visit-search-preview-label">${esc(hit[0])}</span><span>${visitSearchSnippet(hit[1], query)}</span>` : '';
}
function renderVisitSearchGroup(group, query) {
  const matches = group.matches.slice().sort((a, b) => a.rank - b.rank || b.v.date.localeCompare(a.v.date));
  const lead = matches[0]?.v, total = group.allVisits.length, store = by('store', group.storeId);
  const target = store && !store.conflict && !storeIdentityPending(store) ? `data-visit-brief="${esc(group.storeId)}"` : `data-node-type="store" data-node-id="${esc(group.storeId)}"`;
  return `<section class="visit-search-group"><div class="visit-search-group-head"><button class="text-button store-link" ${target}>${highlightLiteral(name('store', group.storeId), query)}</button><span class="pill">${group.matches.length} 筆命中 · 共 ${total} 筆</span></div>${storeAttendanceHTML(group.storeId)}<div class="visit-search-preview">${lead ? visitSearchPreview(lead, query) : ''}</div><details class="visit-search-details"><summary>展開這間藥局全部 ${total} 筆拜訪紀錄</summary><div class="visit-search-expanded">${group.allVisits.map(v => noteHTML(v, query)).join('')}</div></details></section>`;
}
function renderVisits() {
  renderQuickVisit(); renderReminderDrafts();
  const visitDraft = payload?.draft?.format === 'visit-draft-1' ? payload.draft : null;
  const savedInlineDraft = payload?.inlineTextDraft?.format === 'inline-text-draft-1' ? payload.inlineTextDraft : null;
  const liveInlineDraft = inlineTextContext && inlineTextContext.after !== inlineTextContext.before ? inlineTextContext : null;
  const inlineDraft = savedInlineDraft || liveInlineDraft;
  $('draft-banner').hidden = !visitDraft && !inlineDraft;
  $('discard-draft-banner').hidden = !visitDraft;
  $('resume-draft').textContent = visitDraft ? '繼續草稿' : '回到修改並儲存';
  if (visitDraft) $('draft-banner-text').textContent = '有一份已成功保存於本機的未完成拜訪草稿' + (visitDraft.savedAt ? ' · ' + dateText(visitDraft.savedAt) : '') + (inlineDraft ? '；另有一筆拜訪文字修改會在這份草稿完成後繼續保留。' : '。');
  else if (savedInlineDraft) $('draft-banner-text').textContent = '有一筆拜訪文字修改已加密保存，但尚未建立正式版本' + (savedInlineDraft.updatedAt ? ' · ' + dateText(savedInlineDraft.updatedAt) : '') + '。';
  else if (liveInlineDraft) $('draft-banner-text').textContent = '有一筆拜訪文字正在加密保存，尚未建立正式版本。';
  const query = $('visit-search').value.trim(), visits = all('visit').slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!query) {
    $('visit-list').innerHTML = visits.map(v => noteHTML(v)).join('') || '<p class="empty">沒有符合的拜訪紀錄。</p>';
    return;
  }
  const allByStore = new Map();
  for (const visit of visits) {
    if (!allByStore.has(visit.store)) allByStore.set(visit.store, []);
    allByStore.get(visit.store).push(visit);
  }
  const grouped = new Map();
  for (const v of visits) {
    const rank = visitSearchRank(v, query);
    if (!Number.isFinite(rank)) continue;
    let group = grouped.get(v.store);
    if (!group) {
      group = { storeId: v.store, bestRank: rank, bestRankDate: v.date || '', matches: [], allVisits: allByStore.get(v.store) || [] };
      grouped.set(v.store, group);
    }
    group.matches.push({ v, rank });
    if (rank < group.bestRank) {
      group.bestRank = rank;
      group.bestRankDate = v.date || '';
    } else if (rank === group.bestRank && (v.date || '') > group.bestRankDate) {
      group.bestRankDate = v.date || '';
    }
  }
  const groups = [...grouped.values()].sort((a, b) => a.bestRank - b.bestRank || b.bestRankDate.localeCompare(a.bestRankDate) || name('store', a.storeId).localeCompare(name('store', b.storeId), 'zh-Hant'));
  $('visit-list').innerHTML = groups.map(group => group.matches.length > 1 ? renderVisitSearchGroup(group, query) : noteHTML(group.matches[0].v, query)).join('') || '<p class="empty">沒有符合的拜訪紀錄。</p>';
}
function sourceButton(r) { return (r.csvSources?.length || r.versions?.some(v => v.data.csvSources?.length)) ? `<button class="text-button" data-csv-source="${r.type}:${esc(r.id)}">查看匯入原始來源</button>` : ''; }
function openSources(type, id) {
  const r = by(type, id); if (!r) return;
  const seen = new Set(), sources = r.versions.flatMap(v => v.data.csvSources || []).filter(s => { const k = `${s.blob}:${s.fingerprint}:${s.list}`; if (seen.has(k)) return false; seen.add(k); return true; });
  $('review-title').textContent = 'CSV 原始來源';
  $('review-body').innerHTML = `<p class="muted">以下是匯入時的原始欄位；包含歷史版本的來源。匯入時間不是拜訪日期。地圖網址只顯示，不會自動連線。</p>${sources.map(s => `<article class="version"><strong>${esc(s.file)} · 第 ${s.line} 行</strong><p class="muted">清單：${esc(s.list)} · 匯入：${dateText(s.at)}</p><details><summary>展開原始欄位</summary><div class="csv-raw">${s.headers.map((h, i) => `<p><strong>第 ${i + 1} 欄 · ${esc(h)}</strong><span>${esc(s.cells[i])}</span></p>`).join('')}</div></details><button class="text-button" data-csv-download="${esc(s.blob)}" data-csv-filename="${esc(s.file)}">下載原始 CSV（明文）</button></article>`).join('')}`;
  openDialog($('review'));
}
const input = (id, label, value = '', max = 500, required = false) => `<label>${label}<input id="${id}" maxlength="${max}" value="${esc(value)}" ${required ? 'required' : ''} autocomplete="off"></label>`;
const textarea = (id, label, value = '') => `<label>${label}<textarea id="${id}" maxlength="20000">${esc(value)}</textarea></label>`;
function openEditor(type, id = null, restoreDraft = null) {
  if (type === 'store' && id && reminderDraftFor(id)) { toast('這間門市有未完成提醒，先開啟原草稿；完成或捨棄後再完整編輯。'); return openStoreReminder(id); }
  if (type === 'visit' && !restoreDraft && payload?.draft?.format === 'visit-draft-1') {
    const draft = payload.draft;
    if (id && draft.baseData && id !== draft.id) toast('先開啟尚未完成的草稿，避免覆蓋；完成後再編輯另一筆拜訪。');
    return openEditor('visit', draft.baseData ? draft.id : null, draft);
  }
  if (type === 'visit' && !restoreDraft && pendingInlineTextId()) {
    toast('目前有一筆尚未完成的文字修改，先回到該筆檢查並儲存；完成後再編輯其他拜訪。');
    return resumeInlineTextDraft();
  }
  const old = id ? by(type, id) : null; if (old?.conflict) { openReview(type, id, true); return; }
  editorContext = { type, id: id || uuid(), parents: old?.heads.map(h => h.id) || [], oldData: old ? structuredClone(old.heads[0].data) : null, draftTouched: false };
  const d = editorContext.oldData || {};
  $('editor-title').textContent = `${old ? '編輯' : '新增'}${kinds[type]}`; $('editor-error').textContent = '';
  if (type === 'visit') {
    if (restoreDraft?.format === 'visit-draft-1') editorContext = { type, id: restoreDraft.id, parents: [...(restoreDraft.parents || [])], oldData: restoreDraft.baseData ? structuredClone(restoreDraft.baseData) : null, draftTouched: false };
    const base = editorContext.oldData || d;
    const selectedStore = restoreDraft?.fields?.store || base.store || (focus.type === 'store' && by('store', focus.id) && !by('store', focus.id).conflict ? focus.id : recentStores(1)[0]?.id || '__new__');
    const orderedStores = orderedVisitStores();
    const pick = (kind, selected) => all(kind).map(r => `<label class="check"><input type="checkbox" name="${kind}" value="${esc(r.id)}" ${selected?.includes(r.id) ? 'checked' : ''}>${esc(r.name)}</label>`).join('') || '<p class="muted">先到「人物與主題」新增。</p>';
    const selectedRecord = selectedStore !== '__new__' ? by('store', selectedStore) : null;
    const selectedUnavailable = selectedStore !== '__new__' && (!selectedRecord || selectedRecord.deleted || selectedRecord.conflict);
    const unavailableOption = selectedUnavailable ? `<option value="${esc(selectedStore)}" selected disabled>原門市目前不可使用或有衝突，請重新選擇</option>` : '';
    const storeOptions = unavailableOption + orderedStores.map(s => `<option value="${esc(s.id)}" ${!selectedUnavailable && selectedStore === s.id ? 'selected' : ''}>${esc(s.name)}${s.district ? ' · ' + esc(s.district) : ''}</option>`).join('') + `<option value="__new__" ${selectedStore === '__new__' ? 'selected' : ''}>＋ 快速新增門市</option>`;
    $('editor-fields').innerHTML = `<div class="visit-store-picker"><label>搜尋既有門市<input id="f-store-search" type="search" placeholder="輸入店名、來源名稱、地區或地址" autocomplete="off"></label><p id="f-store-match-count" class="muted"></p></div><div class="field-grid"><label>門市<select id="f-store">${storeOptions}</select></label><label>筆記日期（未知可留空）<input type="date" id="f-date" value="${esc(base.date ?? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))}"></label></div><div id="quick-store-fields" class="quick-store" hidden><h3>快速新增門市</h3>${input('f-new-store-name', '門市名稱（必要）', '', 200)}${input('f-new-store-district', '地區（可稍後補）', '', 500)}${input('f-new-store-map-url', 'Google Maps 網址（可稍後補）', '', 2000)}<label class="check"><input id="f-new-store-pending" type="checkbox" checked> 身分待確認；先保存門市與拜訪，不自動合併</label><p class="muted">除名稱外都可稍後補。待確認門市不參與關聯分析，之後可在門市資料核實。</p></div><label>資訊來源<select id="f-source">${[...new Set(['藥師主動提及', '詢問後回覆', '現場觀察', '其他', ...(base.source ? [base.source] : [])])].map(x => `<option ${x === base.source ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>${textarea('f-text', '原始拜訪內容', base.text)}${textarea('f-next', '下次跟進', base.next)}<label>相關主題</label><div class="check-grid">${pick('topic', base.topics)}</div><label>提及人物</label><div class="check-grid">${pick('person', base.people)}</div><label>附件（每個上限 3 MB）<input type="file" id="f-files" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"></label><p class="muted">支援圖片與 PDF。新選的附件檔案無法靠草稿跨 App 關閉／重新開啟保存；完成紀錄前若 App 被系統終止，請重新選擇附件。舊附件取消勾選可從此版本移除，歷史仍保留。</p><div class="check-grid">${(base.attachments || []).map((a, i) => `<label class="check"><input type="checkbox" name="keep-attachment" value="${i}" checked>${esc(a.name)}</label>`).join('')}</div><p id="draft-save-state" class="draft-state" role="status">尚未變更</p><p class="muted">文字與欄位變更會自動加密保存為本機草稿；「完成紀錄」才建立／更新正式拜訪版本。</p>`;
    $('editor-save').textContent = '完成紀錄';
    $('discard-draft').hidden = !(restoreDraft?.format === 'visit-draft-1');
    toggleQuickStoreFields();
    refreshVisitStoreOptions('');
    if (restoreDraft) applyVisitDraft(restoreDraft);
  } else {
    $('editor-save').textContent = '儲存';
    $('discard-draft').hidden = true;
    let fields = input('f-name', `${kinds[type]}名稱`, d.name, 200, true);
    if (type === 'store') fields += `${reminderTasksHTML(old || d, false)}${legacyReminderDraftHTML(d)}${reminderOptionsHTML('f-next-remember')}<label>新增待辦（每行一項）<textarea id="f-next-remember" maxlength="2000" placeholder="自由填寫，換行可新增另一項"></textarea></label><p class="muted">只新增任務，不改動已保存的待辦與完成歷史。勾選完成請回到拜訪頁。</p><label>每次必做、必給<textarea id="f-every-time-must" maxlength="2000">${esc(d.everyTimeMust || '')}</textarea></label><p id="editor-reminder-draft-state" class="draft-state" role="status">${old ? '提醒欄位會加密暫存；重新開啟可從門市提醒繼續。其他門市資料仍須按儲存。' : '請先儲存建立門市；之後填寫門市提醒可使用加密草稿。'}</p>${input('f-contact', '主要窗口', d.contact)}${input('f-attr', '門市特性／客群', d.attr)}<details class="advanced-fields"><summary>地址與系統資料</summary><p class="muted">這些欄位供地理整理與來源核對；不知道時可以留空，不影響拜訪紀錄。</p><div class="field-grid">${input('f-city', '縣市', d.city)}${input('f-district', '地區', d.district)}</div><label>通路<select id="f-channel">${[...new Set(['', '連鎖', '獨立', '加盟', '診所', '其他', ...(d.channel ? [d.channel] : [])])].map(c => `<option value="${esc(c)}" ${c === d.channel ? 'selected' : ''}>${esc(c || '未分類')}</option>`).join('')}</select></label>${input('f-address', '地址', d.address, 2000)}${input('f-map-url', 'Google Maps 網址（只保存，不自動開啟）', d.mapUrl, 2000)}</details>`;
    if (type === 'store' && d.csvIdentityPending) fields += '<label class="check"><input type="checkbox" id="f-identity-reviewed">我已核實此門市身分與來源，解除待確認標記並允許關聯分析</label>';
    if (type === 'person') fields += `${input('f-role', '職務／與門市的關係', d.role)}${textarea('f-desc', '身分證據與備註', d.desc)}<label class="check"><input type="checkbox" id="f-confirmed" ${d.confirmed ? 'checked' : ''}> 我已核對此人物的身分</label><label>已確認是同一人時，連到<select id="f-same"><option value="">保持獨立人物</option>${all('person').filter(p => p.id !== id && !p.sameAs).map(p => `<option value="${esc(p.id)}" ${d.sameAs === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><p class="muted">須先勾選已核對身分。此設定只合併探索路徑，不改寫原始拜訪文字。</p>`;
    if (type === 'topic') fields += textarea('f-desc', '主題定義與備註', d.desc);
    $('editor-fields').innerHTML = fields;
    if (type === 'store') {
      resetReminderOptionGroup('f-next-remember');
      if (old && !old.deleted) editorContext.reminderDraftContext = { editor: editorContext, id: old.id, storeName: old.name, parents: [...editorContext.parents].sort(), baseEvery: d.everyTimeMust || '', baseLegacy: d.nextRemember || '', draftTouched: false, draftGeneration: 0 };
    }
  }
  openDialog($('editor'));
}
function quickTextParents(record) {
  return (record?.heads || []).map(head => head.id).sort();
}
function inlineTextValue(element) { return (element.innerText || '').replace(/\r/g, ''); }
function pendingInlineTextId() {
  if (inlineTextContext && inlineTextContext.after !== inlineTextContext.before) return inlineTextContext.id;
  return payload?.inlineTextDraft?.format === 'inline-text-draft-1' ? payload.inlineTextDraft.id : '';
}
function inlineTextElement(id, briefStoreId = '') {
  const selector = `[data-inline-edit-text="${CSS.escape(id)}"]`;
  if (briefStoreId && $('review').open && $('review').dataset.singleStoreId === briefStoreId) return $('review').querySelector(selector);
  return document.querySelector(selector);
}
function inlineTextBlockReason(id) {
  const visit = by('visit', id);
  if (!visit || visit.deleted) return '這筆拜訪目前已不存在，不能直接修改。';
  if (visit.conflict) return '這筆拜訪有同步衝突，請先完成核對。';
  if (singleStoreContext) return '目前正在記錄這次拜訪；先完成或捨棄這份內容，才能修改既有拜訪原文。';
  if (payload?.draft?.format === 'visit-draft-1') return '目前另有未完成的拜訪草稿；先完成或捨棄該草稿，才能修改這筆文字。';
  const pendingId = pendingInlineTextId();
  if (pendingId && pendingId !== id) return '另一筆拜訪已有未完成的文字修改；先回到該筆檢查並儲存或取消。';
  return '';
}
function resumeInlineTextDraft() {
  const id = pendingInlineTextId();
  if (!id) return toast('目前沒有未完成的文字修改。');
  if (payload?.draft?.format === 'visit-draft-1') {
    toast('先完成或捨棄未完成的拜訪草稿；這筆文字修改仍會保留。');
    return resumeVisitDraft();
  }
  const visit = by('visit', id);
  if (!visit || visit.deleted) return toast('原本修改的拜訪已不存在；正式資料沒有被改寫。');
  const selector = `[data-inline-edit-text="${CSS.escape(id)}"]`;
  let element = inlineTextElement(id, inlineTextContext?.briefStoreId || '');
  const elementDialog = element?.closest?.('dialog');
  if (activeView === 'visits' && element && (!elementDialog || elementDialog.open) && inlineTextContext?.id === id && inlineTextContext.after !== inlineTextContext.before) {
    const collapsed = element.closest('details:not([open])'); if (collapsed) collapsed.open = true;
    element.scrollIntoView({ block: 'center' });
    focusReadingSurface(element);
    return;
  }
  switchView('visits');
  element = $('visit-list').querySelector(selector);
  if (!element) {
    $('visit-search').value = name('store', visit.store);
    renderVisits();
    element = $('visit-list').querySelector(selector);
  }
  if (!element) return toast('找不到未完成修改的原始卡片；正式資料仍未被改寫。');
  const collapsed = element.closest('details:not([open])'); if (collapsed) collapsed.open = true;
  element.scrollIntoView({ block: 'center' });
  focusReadingSurface(element);
}
function blockInlineTextBeforeInput(event) {
  const element = event.target.closest?.('[data-inline-edit-text]');
  if (!element) return false;
  const reason = syncInProgress ? '正在完成同步交換，請稍候再點文字輸入。' : inlineTextBlockReason(element.dataset.inlineEditText);
  if (!reason) return false;
  event.preventDefault(); element.blur(); toast(reason); return true;
}
// Reminder drafts live only in the encrypted device payload, never in bundle.
function storedReminderDrafts() {
  const drafts = payload?.reminderDrafts;
  if (drafts === undefined) return [];
  const text = (value, limit) => typeof value === 'string' && value.length <= limit;
  if (!Array.isArray(drafts) || drafts.length > 1000 || new Set(drafts.map(d => d?.storeId)).size !== drafts.length || drafts.some(d =>
    !d || d.format !== 'store-reminder-draft-1' || !text(d.storeId, 100) || !d.storeId || !text(d.storeName, 2000) ||
    !Array.isArray(d.parents) || !d.parents.length || d.parents.some(id => !text(id, 100) || !id) ||
    !text(d.baseEvery, 2000) || !text(d.baseLegacy, 2000) || !Number.isFinite(Date.parse(d.savedAt)) ||
    !d.fields || !text(d.fields.next, 2000) || !text(d.fields.every, 2000) || !text(d.fields.customText, 120) || !text(d.fields.customApplied, 120) ||
    typeof d.fields.convert !== 'boolean' || typeof d.fields.customChecked !== 'boolean')) throw new Error('本機提醒草稿格式無法辨識；原資料保留，沒有自動清除。');
  return drafts;
}
function reminderDraftFor(storeId) { return storedReminderDrafts().find(draft => draft.storeId === storeId); }
function activeReminderDraftContext() { return reminderContext || editorContext?.reminderDraftContext || null; }
function reminderDraftState(message, state = '', ctx = activeReminderDraftContext()) {
  const node = $(ctx?.editor ? 'editor-reminder-draft-state' : 'store-reminder-draft-state');
  node.textContent = message; node.dataset.state = state;
}
function reminderDraftProblem(ctx = reminderContext) {
  const store = ctx && by('store', ctx.id);
  if (!store || store.deleted || store.conflict) return '門市已不存在、已刪除或有衝突；草稿保留供查看，不會套用。';
  if (JSON.stringify(store.heads.map(head => head.id).sort()) !== JSON.stringify(ctx.parents)) return '門市已有新版本；草稿保留供查看，不能覆蓋較新的提醒。請先核對新版，再手動重新填寫。';
  return '';
}
function captureReminderDraft(ctx = activeReminderDraftContext()) {
  if (!ctx) return null;
  const targetId = ctx.editor ? 'f-next-remember' : 'store-reminder-next';
  const group = document.querySelector(`[data-reminder-options-for="${targetId}"]`);
  return { format: 'store-reminder-draft-1', storeId: ctx.id, storeName: ctx.storeName, parents: [...ctx.parents],
    baseEvery: ctx.baseEvery, baseLegacy: ctx.baseLegacy, savedAt: new Date().toISOString(),
    fields: { next: $(targetId).value, every: $(ctx.editor ? 'f-every-time-must' : 'store-reminder-every').value,
      convert: !!$(ctx.editor ? 'editor-form' : 'store-reminder-form').querySelector('[data-reminder-convert]')?.checked,
      customText: group.querySelector('[data-reminder-custom-input]').value,
      customChecked: group.querySelector('[data-reminder-custom-toggle]').checked, customApplied: group.dataset.customApplied || '' } };
}
function renderReminderDrafts() {
  const drafts = storedReminderDrafts();
  $('reminder-draft-banner').hidden = !drafts.length;
  $('reminder-draft-count').textContent = `未完成門市提醒 · ${drafts.length} 間`;
  $('reminder-draft-list').innerHTML = drafts.map(d => `<p><button type="button" class="text-button" data-resume-reminder="${esc(d.storeId)}">繼續：${esc(d.storeName)}</button><small> · ${esc(dateText(d.savedAt))}</small></p>`).join('');
}
async function persistReminderDraftNow(ctx) {
  if (!ctx || ctx !== activeReminderDraftContext() || !ctx.draftTouched || !payload) return;
  const draft = captureReminderDraft(ctx), generation = ctx.draftGeneration;
  const drafts = storedReminderDrafts(), nextDrafts = [...drafts.filter(item => item.storeId !== ctx.id), draft];
  if (nextDrafts.length > 1000) throw new Error('未完成門市提醒已達上限；請先完成或明確捨棄既有草稿。');
  reminderDraftState('正在加密保存提醒草稿…', 'saving');
  try {
    await persist({ ...payload, reminderDrafts: nextDrafts });
    if (ctx === activeReminderDraftContext() && ctx.draftGeneration === generation) {
      ctx.draftTouched = false;
      reminderDraftState('提醒草稿已加密保存在這台裝置，尚未寫入正式紀錄。', 'saved');
    }
    renderReminderDrafts(); status();
  } catch (error) {
    if (ctx === activeReminderDraftContext()) reminderDraftState('草稿儲存失敗：' + error.message + ' 請保留此視窗，按儲存或再次關閉以重試。', 'error');
    throw error;
  }
}
function scheduleReminderDraftSave() {
  const ctx = activeReminderDraftContext(); if (!ctx || busy || updateHolding) return;
  ctx.draftTouched = true; ctx.draftGeneration++;
  if (!ctx.editor) $('discard-reminder-draft').hidden = false;
  reminderDraftState('正在加密保存提醒草稿…', 'saving');
  clearTimeout(reminderDraftTimer);
  reminderDraftTimer = setTimeout(() => {
    reminderDraftTimer = null;
    reminderDraftSaveChain = reminderDraftSaveChain.catch(() => {}).then(() => persistReminderDraftNow(ctx));
    void reminderDraftSaveChain.catch(() => {});
  }, 350);
}
function flushReminderDraft() {
  clearTimeout(reminderDraftTimer); reminderDraftTimer = null;
  const ctx = activeReminderDraftContext();
  reminderDraftSaveChain = reminderDraftSaveChain.catch(() => {}).then(() => persistReminderDraftNow(ctx));
  return reminderDraftSaveChain;
}
async function closeStoreReminderEditor() {
  const ctx = editorContext; if (!ctx?.reminderDraftContext) return;
  await flushReminderDraft();
  if (editorContext !== ctx) return;
  editorContext = null; $('editor').close(); renderReminderDrafts(); status();
}
async function closeStoreReminder() {
  const ctx = reminderContext; if (!ctx) return;
  await flushReminderDraft();
  if (ctx !== reminderContext) return;
  reminderContext = null; $('store-reminder-dialog').close(); renderReminderDrafts(); status();
}
async function discardReminderDraft() {
  const ctx = reminderContext; if (!ctx) return;
  if (!confirm('確認捨棄「' + ctx.storeName + '」的未完成提醒草稿？\n只移除這台裝置上的未送出輸入，不修改正式待辦、完成歷史、拜訪文字或拜訪日期。')) return;
  clearTimeout(reminderDraftTimer); reminderDraftTimer = null;
  // Drain an already running write before removing exactly this store's draft.
  await reminderDraftSaveChain.catch(() => {});
  if (ctx !== reminderContext || !payload) return;
  await persist({ ...payload, reminderDrafts: storedReminderDrafts().filter(d => d.storeId !== ctx.id) });
  reminderDraftSaveChain = Promise.resolve();
  reminderContext = null; $('store-reminder-dialog').close(); renderReminderDrafts(); status();
  toast('已捨棄這間門市的本機提醒草稿；正式資料保持原樣。');
}
function openStoreReminder(storeId) {
  if (reminderContext) return toast('請先儲存或按「稍後繼續」收起目前的門市提醒。');
  if (editorContext || singleStoreContext) return toast('請先完成或收起目前的拜訪／完整編輯，再修改門市提醒。');
  const store = by('store', storeId), saved = reminderDraftFor(storeId);
  if ((!store || store.deleted || store.conflict) && !saved) return toast('這間門市目前有衝突或已移到回收桶，請先完成核對。');
  if (inlineTextContext && inlineTextContext.after !== inlineTextContext.before) return toast('請先完成或取消目前的拜訪文字修改。');
  inlineTextContext = null;
  reminderContext = { id: storeId, storeName: saved?.storeName || store.name, parents: saved ? [...saved.parents] : store.heads.map(head => head.id).sort(),
    baseEvery: saved?.baseEvery ?? store.everyTimeMust ?? '', baseLegacy: saved?.baseLegacy ?? store.nextRemember ?? '', draftTouched: false, draftGeneration: 0,
    briefStoreId: $('review').open && $('review').classList.contains('visit-brief-dialog') ? $('review').dataset.singleStoreId : '' };
  const ctx = reminderContext;
  $('store-reminder-title').textContent = ctx.storeName + ' · 門市提醒';
  $('store-reminder-existing').innerHTML = (store ? reminderTasksHTML(store, false) : '') + legacyReminderDraftHTML({ nextRemember: ctx.baseLegacy });
  $('store-reminder-next').value = saved?.fields.next || '';
  $('store-reminder-every').value = saved?.fields.every ?? ctx.baseEvery;
  resetReminderOptionGroup('store-reminder-next');
  if (saved) {
    const group = document.querySelector('[data-reminder-options-for="store-reminder-next"]');
    group.querySelector('[data-reminder-custom-input]').value = saved.fields.customText;
    group.querySelector('[data-reminder-custom-toggle]').checked = saved.fields.customChecked;
    group.dataset.customApplied = saved.fields.customApplied;
    const convert = $('store-reminder-form').querySelector('[data-reminder-convert]'); if (convert) convert.checked = saved.fields.convert;
  }
  const problem = reminderDraftProblem();
  $('store-reminder-error').textContent = problem;
  $('store-reminder-save').disabled = !!problem;
  $('store-reminder-form').querySelectorAll('input,textarea').forEach(input => { if (input.type === 'checkbox') input.disabled = !!problem; else input.readOnly = !!problem; });
  $('discard-reminder-draft').hidden = !saved;
  reminderDraftState(saved ? '已恢復這台裝置的加密提醒草稿；尚未寫入正式紀錄。' : '輸入會加密保存成本機草稿；正式儲存仍需確認。', saved ? 'saved' : '');
  openDialog($('store-reminder-dialog'));
}
async function saveStoreReminder(event) {
  event.preventDefault();
  await run(async () => {
    const ctx = reminderContext;
    if (!ctx) return;
    await flushReminderDraft();
    const store = by('store', ctx.id), problem = reminderDraftProblem(ctx);
    if (problem) throw new Error(problem);
    const before = store.heads[0].data, data = reminderFormData(before, 'store-reminder-next');
    data.everyTimeMust = $('store-reminder-every').value.trim();
    const changed = JSON.stringify(data) !== JSON.stringify({ ...before, everyTimeMust: before.everyTimeMust || '' });
    if (!confirmReminderChange(before, data)) return;
    const choice = await confirmStoreSave(store.id, store.name, changed); if (!choice) return;
    if (reminderContext !== ctx) throw new Error('提醒畫面已變更，本次沒有寫入。');
    assertSaveParents('store', store.id, ctx.parents);
    const bundle = structuredClone(payload.bundle);
    if (changed || choice.attendance) { bundle.schema = 2; bundle.ops.push(revision('store', store.id, changed ? data : before, ctx.parents, payload.device, false, choice.attendance)); validateBundle(bundle); }
    // Formal content and draft removal succeed (or fail) in one encrypted write.
    await persist({ ...payload, bundle, dirty: payload.dirty || changed || !!choice.attendance, reminderDrafts: storedReminderDrafts().filter(d => d.storeId !== ctx.id) });
    reminderContext = null; $('store-reminder-dialog').close(); render();
    if (ctx.briefStoreId) openVisitBrief(ctx.briefStoreId, { preservePosition: true });
    toast(changed ? '門市提醒已儲存並套用到這間門市的全部拜訪紀錄。' : choice.attendance ? '已記錄今天實際拜訪；門市提醒內容保持原樣。' : '門市提醒沒有變更，未新增任何版本。');
  }, 'store-reminder-error');
}
function releaseIdleInlineEdit() {
  if (!inlineTextContext || inlineTextContext.after !== inlineTextContext.before || payload?.inlineTextDraft || quickTextContext || document.activeElement?.closest?.('[data-inline-edit-text]')) return false;
  // A tap without changes has no save/cancel controls; it must not block sync forever.
  inlineTextContext = null; syncScheduler.wake(); return true;
}
function beginInlineTextEdit(id, element) {
  if (syncInProgress) { toast('正在完成同步交換，請稍候再點文字輸入。'); element.blur(); return false; }
  const visit = by('visit', id), blocked = inlineTextBlockReason(id);
  if (blocked) { toast(blocked); element.blur(); return false; }
  const saved = payload?.inlineTextDraft?.format === 'inline-text-draft-1' ? payload.inlineTextDraft : null;
  const review = element.closest?.('#review'), briefStoreId = review?.open && review.classList.contains('visit-brief-dialog') ? review.dataset.singleStoreId || '' : '';
  if (!inlineTextContext || inlineTextContext.id !== id) inlineTextContext = { id, before: saved?.id === id ? saved.before : visit.text || '', after: saved?.id === id ? saved.after : visit.text || '', parents: saved?.id === id ? [...saved.parents] : quickTextParents(visit), storeName: name('store', visit.store), date: visit.date || '', source: visit.source || '', briefStoreId };
  else if (briefStoreId) inlineTextContext.briefStoreId = briefStoreId;
  return true;
}
async function persistInlineTextDraft() {
  const ctx = inlineTextContext; if (!ctx || !payload) return;
  const visit = by('visit', ctx.id), element = inlineTextElement(ctx.id, ctx.briefStoreId || ''), state = element?.closest('[data-inline-shell]')?.querySelector('[data-inline-state]');
  if (!visit || visit.deleted || visit.conflict || JSON.stringify(quickTextParents(visit)) !== JSON.stringify(ctx.parents)) { if (state) state.textContent = '這筆紀錄已有新版本；目前文字未寫入，請取消後重新開始。'; return; }
  const draft = ctx.after === ctx.before ? null : { format: 'inline-text-draft-1', id: ctx.id, before: ctx.before, after: ctx.after, parents: [...ctx.parents], updatedAt: new Date().toISOString() };
  await persist({ ...payload, inlineTextDraft: draft });
  if (state) state.textContent = draft ? '修改草稿已加密保存在這台裝置，尚未寫入正式紀錄。' : '文字沒有變更。';
  if (!draft) releaseIdleInlineEdit();
}
function scheduleInlineTextDraft() {
  clearTimeout(inlineDraftTimer); const ctx = inlineTextContext;
  inlineDraftTimer = setTimeout(() => { inlineDraftSaveChain = inlineDraftSaveChain.then(() => ctx === inlineTextContext ? persistInlineTextDraft() : undefined).catch(error => { const state = document.querySelector(`[data-inline-state="${CSS.escape(ctx?.id || '')}"]`); if (state) state.textContent = '草稿儲存失敗：' + error.message; }); }, 250);
}
async function flushInlineTextDraft() { clearTimeout(inlineDraftTimer); inlineDraftTimer = null; inlineDraftSaveChain = inlineDraftSaveChain.then(persistInlineTextDraft); await inlineDraftSaveChain; }
function updateInlineText(id, element) {
  if (!beginInlineTextEdit(id, element)) { const visit = by('visit', id); if (visit) element.textContent = visit.text || ''; return; }
  const next = inlineTextValue(element), shell = element.closest('[data-inline-shell]'), state = shell?.querySelector('[data-inline-state]');
  if (next.length > 20000) { element.textContent = inlineTextContext.after; if (state) state.textContent = '文字超過長度上限，超出的輸入未保留。'; return; }
  inlineTextContext.after = next; shell?.classList.toggle('editing', next !== inlineTextContext.before);
  if (shell) shell.querySelector('.inline-edit-actions').hidden = next === inlineTextContext.before;
  if (state) state.textContent = next.trim() ? '正在加密保存修改草稿…' : '整段空白不能儲存為正式版本；原文仍安全保留。';
  scheduleInlineTextDraft();
}
async function cancelInlineTextEdit(id, originStoreId = '') {
  if (inlineTextContext?.id !== id && payload?.inlineTextDraft?.id !== id) return;
  const briefStoreId = originStoreId || (inlineTextContext?.id === id ? inlineTextContext.briefStoreId : '');
  clearTimeout(inlineDraftTimer); inlineDraftTimer = null; await inlineDraftSaveChain;
  await persist({ ...payload, inlineTextDraft: null }); inlineTextContext = null; render();
  if (briefStoreId && $('review').open && $('review').dataset.singleStoreId === briefStoreId) openVisitBrief(briefStoreId, { preservePosition: true });
  toast('已取消文字修改，正式紀錄沒有改變。');
}
async function reviewInlineTextEdit(id, originStoreId = '') {
  const briefStoreId = originStoreId || (inlineTextContext?.id === id ? inlineTextContext.briefStoreId || '' : '');
  const element = inlineTextElement(id, briefStoreId);
  if (!element || !beginInlineTextEdit(id, element)) return;
  inlineTextContext.after = inlineTextValue(element); await flushInlineTextDraft();
  const visit = by('visit', id);
  if (!inlineTextContext.after.trim()) throw new Error('為避免誤刪，不能把整段拜訪文字存成空白。原文仍保留。');
  if (!visit || visit.conflict || JSON.stringify(quickTextParents(visit)) !== JSON.stringify(inlineTextContext.parents)) throw new Error('這筆拜訪已有新版本，本次沒有寫入；請取消後重新修改。');
  quickTextContext = { ...inlineTextContext, step: 'confirm' }; renderQuickTextDialog();
}
function diffSegmentsHTML(segments) {
  return segments.map(segment => segment.kind === 'same'
    ? esc(segment.text)
    : `<mark class="quick-diff-${segment.kind}">${esc(segment.text)}</mark>`).join('');
}
function renderQuickTextDialog() {
  if (!quickTextContext) return;
  const ctx = quickTextContext, dialog = $('quick-text-dialog');
  $('quick-text-title').textContent = ctx.step === 'confirm' ? '二次確認文字修改' : '快速修改拜訪文字';
  $('quick-text-error').textContent = '';
  if (ctx.step === 'confirm') {
    const diff = diffTextSegments(ctx.before, ctx.after);
    $('quick-text-body').innerHTML = `<div class="quick-text-scope"><strong>${ctx.before === ctx.after ? '文字沒有變更；下一步可確認今天是否有實際拜訪。' : '這次只會修改這一筆拜訪的文字欄。'}</strong><p>門市、日期、來源、主題、人物、附件與 CSV 原始來源不變；修改前文字會留在歷史版本中。</p></div><div class="quick-diff-legend" aria-label="修改標示說明"><span><i class="quick-diff-swatch removed"></i>修改前被刪除／取代</span><span><i class="quick-diff-swatch added"></i>修改後新增／取代</span></div><div class="quick-text-compare"><section><h3>修改前</h3><pre>${diffSegmentsHTML(diff.before)}</pre></section><section><h3>修改後</h3><pre>${diffSegmentsHTML(diff.after)}</pre></section></div>`;
    $('quick-text-actions').innerHTML = '<button type="button" data-close="quick-text-dialog">取消</button><button type="button" data-quick-text-back>返回直接修改</button><button type="submit" class="primary">確定建立新版本</button>';
  } else {
    $('quick-text-body').innerHTML = `<p><strong>${esc(ctx.storeName)}</strong></p><p class="muted">${esc(ctx.source || '來源未提供')}</p><div class="quick-text-scope"><strong>安全快速修改</strong><p>這裡只能改文字，不提供刪除。第一次按確認不會寫入正式資料，下一頁還會再顯示修改前／後內容讓你二次確認。</p></div><label>拜訪文字<textarea id="quick-text-value" maxlength="20000" spellcheck="false">${esc(ctx.after ?? ctx.before)}</textarea></label>`;
    $('quick-text-actions').innerHTML = '<button type="button" data-close="quick-text-dialog">取消</button><button type="submit" class="primary">確認修改內容</button>';
  }
  openDialog(dialog);
}
function openQuickTextEdit(id) {
  const visit = by('visit', id);
  if (!visit || visit.deleted) return toast('這筆拜訪目前不可修改。');
  if (visit.conflict) return openReview('visit', id, true);
  if (payload?.draft?.format === 'visit-draft-1' && payload.draft.baseData && payload.draft.id === id) return toast('這筆拜訪已有未完成草稿。請先完成或捨棄草稿，避免同一筆紀錄同時產生兩個編輯版本。');
  const data = structuredClone(visit.heads[0].data);
  quickTextContext = {
    id,
    before: data.text || '',
    after: data.text || '',
    parents: quickTextParents(visit),
    storeName: name('store', data.store),
    date: data.date || '',
    source: data.source || '',
    step: 'edit'
  };
  renderQuickTextDialog();
}
async function saveQuickTextEdit(event) {
  event.preventDefault();
  if (!quickTextContext) return;
  if (quickTextContext.step === 'edit') {
    const next = $('quick-text-value').value;
    if (!next.trim()) { $('quick-text-error').textContent = '為避免誤刪，快速修改不能把整段文字存成空白。若確實需要清空，請使用完整編輯流程。'; return; }
    quickTextContext.after = next; quickTextContext.step = 'confirm'; renderQuickTextDialog(); return;
  }
  await run(async () => {
    const ctx = quickTextContext; if (!ctx) return;
    const visit = by('visit', ctx.id);
    if (!visit || visit.deleted) throw new Error('這筆拜訪已不存在，未寫入任何修改。');
    if (visit.conflict) throw new Error('這筆拜訪目前有同步衝突，未寫入修改。請先處理衝突。');
    const currentParents = quickTextParents(visit);
    if (JSON.stringify(currentParents) !== JSON.stringify(ctx.parents)) throw new Error('這筆拜訪在你修改期間已有新版本。為避免覆蓋較新的內容，本次沒有寫入；請關閉後重新修改。');
    if (!ctx.after.trim()) throw new Error('為避免誤刪，快速修改不能把整段文字存成空白。');
    const data = structuredClone(visit.heads[0].data);
    data.text = ctx.after;
    const choice = await confirmStoreSave(data.store, name('store', data.store), ctx.after !== ctx.before); if (!choice) return;
    if (quickTextContext !== ctx) throw new Error('修改畫面已變更，本次沒有寫入。');
    assertSaveParents('visit', ctx.id, ctx.parents);
    const bundle = structuredClone(payload.bundle); bundle.schema = 2;
    if (ctx.after !== ctx.before || choice.attendance) bundle.ops.push(revision('visit', ctx.id, data, ctx.parents, payload.device, false, choice.attendance));
    validateBundle(bundle);
    await persist({ ...payload, bundle, dirty: payload.dirty || ctx.after !== ctx.before || !!choice.attendance, inlineTextDraft: null });
    const briefStoreId = ctx.briefStoreId || '';
    quickTextContext = null; inlineTextContext = null; $('quick-text-dialog').close(); render();
    if (briefStoreId && $('review').open && $('review').dataset.singleStoreId === briefStoreId) openVisitBrief(briefStoreId, { preservePosition: true });
    toast(ctx.after !== ctx.before ? '文字修改已建立為同一筆拜訪的新版本；舊文字與 CSV 原始來源都保留。' : choice.attendance ? '已記錄今天實際拜訪；筆記原文保持原樣。' : '文字沒有變更，未新增任何版本。');
  }, 'quick-text-error');
}
async function commitRevision(type, id, data, parents, deleted = false, blobs = {}, attendance) {
  const bundle = structuredClone(payload.bundle); bundle.schema = 2; bundle.ops.push(revision(type, id, data, parents, payload.device, deleted, attendance)); Object.assign(bundle.blobs, blobs); validateBundle(bundle);
  await persist({ ...payload, bundle, dirty: true }); render();
}
async function saveEditor(event) {
  event.preventDefault(); await run(async () => {
    const ctx = editorContext; if (!ctx) return;
    if (ctx.reminderDraftContext) await flushReminderDraft();
    if (ctx.fillFields) {
      const additions = Object.fromEntries(ctx.fillFields.map(field => [field, $('fill-' + field).value]));
      fillProfile(payload.bundle, ctx.id, additions, payload.device, ctx.parents); // Validate the proposed additions before confirmation.
      const summary = Object.entries(additions).filter(([, value]) => value.trim()).map(([field, value]) => PROFILE_FIELDS[field] + '：' + value.trim()).join('\n');
      if (!confirm('確認補上以下欄位？\n' + summary + '\n原始來源與既有欄位會保留。')) return;
      const choice = await confirmStoreSave(ctx.id, name('store', ctx.id)); if (!choice) return;
      if (editorContext !== ctx) throw new Error('編輯畫面已變更，本次沒有寫入。');
      assertSaveParents('store', ctx.id, ctx.parents);
      const bundle = fillProfile(payload.bundle, ctx.id, additions, payload.device, ctx.parents);
      if (choice.attendance) { const op = bundle.ops.at(-1); op.at = choice.attendance.at; op.visitAttendance = choice.attendance; }
      validateBundle(bundle);
      await persist({ ...payload, bundle, dirty: true }); $('editor').close(); editorContext = null; render(); toast('欄位已補登，已保留歷史並等待同步。'); return;
    }
    const value = id => $(id).value.trim(); let d, blobs = {};
    let quickStore = null;
    if (ctx.type === 'visit') {
      await flushVisitDraft();
      if (!value('f-text')) throw new Error('請填寫拜訪內容。');
      const checked = n => [...document.querySelectorAll(`#editor [name="${n}"]:checked`)].map(c => c.value);
      let storeId = value('f-store');
      if (storeId !== '__new__') {
        const selected = by('store', storeId);
        if (!selected || selected.deleted || selected.conflict) throw new Error('草稿原本的門市目前不可使用或有同步衝突，請重新選擇門市後再完成紀錄。');
      }
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
    } else if (ctx.type === 'store') d = { name: value('f-name'), city: value('f-city'), district: value('f-district'), channel: value('f-channel'), attr: value('f-attr'), contact: value('f-contact'), address: value('f-address'), mapUrl: value('f-map-url'), everyTimeMust: $('f-every-time-must').value.trim() };
    else if (ctx.type === 'topic') d = { name: value('f-name'), desc: value('f-desc') };
    else {
      d = { name: value('f-name'), role: value('f-role'), desc: value('f-desc'), confirmed: $('f-confirmed').checked, sameAs: value('f-same') };
      if (d.sameAs && !d.confirmed) throw new Error('請先核對人物身分，再建立同一人連結。');
      const seen = new Set([ctx.id]); let target = d.sameAs;
      while (target) { if (seen.has(target)) throw new Error('人物連結不能形成循環。'); seen.add(target); target = by('person', target)?.sameAs; }
    }
    d = { ...(ctx.oldData || {}), ...d };
    if (ctx.type === 'store') {
      const current = by('store', ctx.id);
      if (ctx.parents.length && (!current || current.deleted || (current.conflict && ctx.parents.length === 1) || JSON.stringify(quickTextParents(current)) !== JSON.stringify([...ctx.parents].sort()))) throw new Error('門市已有新版本或衝突，本次沒有寫入；請重新開啟核對。');
      d = reminderFormData(d, 'f-next-remember');
      if (!confirmReminderChange(ctx.oldData || {}, d)) return;
    }
    if (ctx.type === 'store' && ctx.oldData?.csvIdentityPending && $('f-identity-reviewed')?.checked) d.csvIdentityPending = false;
    if (ctx.parents.length > 1) {
      if (quickStore) throw new Error('衝突整合請選擇既有門市；新增門市需另外處理。');
      previewResolution(ctx, d, false, blobs, true); return;
    }
    if (ctx.type === 'visit' && d.googleUpdatePending && d.text === d.googleText) d.googleUpdatePending = false;
    let choice = {};
    if (ctx.type === 'visit' || ctx.type === 'store') {
      assertSaveParents(ctx.type, ctx.id, ctx.parents);
      choice = await confirmStoreSave(ctx.type === 'store' ? ctx.id : d.store, ctx.type === 'store' ? d.name : quickStore?.data.name || name('store', d.store));
      if (!choice) return;
      if (editorContext !== ctx) throw new Error('編輯畫面已變更，本次沒有寫入。');
      assertSaveParents(ctx.type, ctx.id, ctx.parents);
    }
    if (ctx.type === 'visit') {
      const bundle = structuredClone(payload.bundle); bundle.schema = 2;
      if (quickStore) bundle.ops.push(revision('store', quickStore.id, quickStore.data, [], payload.device));
      bundle.ops.push(revision('visit', ctx.id, d, ctx.parents, payload.device, false, choice.attendance)); Object.assign(bundle.blobs, blobs); validateBundle(bundle);
      await persist({ ...payload, bundle, dirty: true, draft: null }); render(); clearTimeout(draftTimer); draftTimer = null;
      $('editor').close(); editorContext = null; toast(quickStore ? '新門市與拜訪已完成並保存於手機；等待 Mac 確認收到。' : '拜訪已完成並保存於手機；等待 Mac 確認收到。'); return;
    }
    if (ctx.type === 'store' && ctx.reminderDraftContext) {
      const bundle = structuredClone(payload.bundle); bundle.schema = 2;
      bundle.ops.push(revision('store', ctx.id, d, ctx.parents, payload.device, false, choice.attendance)); Object.assign(bundle.blobs, blobs); validateBundle(bundle);
      await persist({ ...payload, bundle, dirty: true, reminderDrafts: storedReminderDrafts().filter(draft => draft.storeId !== ctx.id) });
      editorContext = null; render();
    } else await commitRevision(ctx.type, ctx.id, d, ctx.parents, false, blobs, choice.attendance);
    editorContext = null; $('editor').close(); toast('已加密儲存。Mac 可連線時會自動交換。');
  }, 'editor-error');
}
function describeData(type, data) {
  if (type === 'visit') return `${name('store', data.store)} · ${data.date || '原始日期未提供'}\n${data.source}\n${data.sourceMissing ? 'Google 最新匯出：備註缺少（舊文保留）\n' : ''}${data.googleUpdatePending ? `Google 最新文字：${data.googleText}\nApp 文字待人工核對\n` : ''}\n${data.text}\n\n下次跟進：${data.next}\n主題：${data.topics.map(id => name('topic', id)).join('、')}\n人物：${data.people.map(id => name('person', id)).join('、')}\n附件：${data.attachments.map(a => a.name).join('、')}`;
  const labels = { address: '地址', mapUrl: '地圖網址', lists: '來源清單', name: '名稱', city: '縣市', district: '地區', channel: '通路', attr: '屬性', contact: '窗口', nextRemember: '下次記得（未轉換文字）', nextRememberTasks: '下次記得任務', nextRememberImports: '提醒轉換原始文字', everyTimeMust: '每次必做、必給', desc: '備註', role: '職務', confirmed: '身分已核對', sameAs: '同一人連結', mergedInto: '已整併至門市 ID', mergeDecision: '整併裁定' };
  const details = Object.entries(data).filter(([k]) => k !== 'csvSources' && k !== 'qualityDistinct').map(([k, v]) => `${labels[k] || k}：${k === 'sameAs' && v ? name('person', v) : ['nextRememberTasks', 'nextRememberImports'].includes(k) ? JSON.stringify(v, null, 2) : v}`);
  if (data.qualityDistinct !== undefined) details.push('此版本保存的不同門市核對：' + data.qualityDistinct.length + ' 組（辨識資料改變後需重新核對）');
  return details.join('\n');
}
function reviewHeads(record) { return record.heads.map(h => h.id).sort(); }
const SAFE_CONFLICT_BLOCKED_FIELDS = new Set(['nextRememberTasks', 'nextRememberImports', 'nextRemember', 'attachments', 'csvSources', 'csvIdentityRules', 'qualityDistinct', 'mergedInto', 'mergeDecision', 'sameAs', 'confirmed', 'googleText', 'googleUpdatePending', 'sourceMissing']);
function sameReviewValue(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function conflictMergeBase(record) {
  const versions = new Map(record.versions.map(version => [version.id, version]));
  const distances = record.heads.map(head => {
    const found = new Map(), queue = head.parents.map(id => [id, 1]);
    for (let i = 0; i < queue.length; i++) {
      const [id, distance] = queue[i];
      if (found.has(id) && found.get(id) <= distance) continue;
      found.set(id, distance);
      for (const parent of versions.get(id)?.parents || []) queue.push([parent, distance + 1]);
    }
    return found;
  });
  const common = [...(distances[0]?.keys() || [])].filter(id => distances.every(found => found.has(id)));
  if (!common.length) return null;
  common.sort((a, b) => {
    const aDistance = Math.max(...distances.map(found => found.get(a))), bDistance = Math.max(...distances.map(found => found.get(b)));
    return aDistance - bDistance || (versions.get(b)?.at || '').localeCompare(versions.get(a)?.at || '') || a.localeCompare(b);
  });
  const bestDistance = Math.max(...distances.map(found => found.get(common[0])));
  const best = common.filter(id => Math.max(...distances.map(found => found.get(id))) === bestDistance);
  return best.length === 1 ? versions.get(best[0]) : null;
}
function safeConflictMerge(record) {
  if (!record?.conflict || record.heads.length < 2) return { safe: false, reason: '目前沒有可合併的衝突版本。' };
  if (record.heads.some(head => head.deleted)) return { safe: false, reason: '版本包含刪除狀態，必須人工選擇，不能產生安全合併建議。' };
  const base = conflictMergeBase(record);
  if (!base || base.deleted) return { safe: false, reason: '找不到唯一且可驗證的共同版本，必須人工核對。' };
  const fields = [...new Set([...Object.keys(base.data), ...record.heads.flatMap(head => Object.keys(head.data))])];
  const result = structuredClone(base.data), changes = [], blocked = [];
  for (const field of fields) {
    const changed = record.heads.filter(head => !sameReviewValue(head.data[field], base.data[field]));
    if (!changed.length) continue;
    const values = [];
    for (const head of changed) if (!values.some(value => sameReviewValue(value, head.data[field]))) values.push(head.data[field]);
    if (SAFE_CONFLICT_BLOCKED_FIELDS.has(field)) blocked.push({ field, kind: 'protected' });
    else if (values.length > 1) blocked.push({ field, kind: 'overlap' });
    else { result[field] = structuredClone(values[0]); changes.push({ field, heads: changed.map(head => head.id) }); }
  }
  if (blocked.length) return { safe: false, reason: '存在同一欄位的不同修改，或涉及身分、來源、附件等保護欄位，必須人工核對。', blocked, base };
  if (!changes.length) return { safe: false, reason: '各版本沒有可合併的欄位差異，請人工選擇版本。', base };
  return { safe: true, base, data: result, changes };
}
function safeMergeSummary(plan, record) {
  const labels = { text: '拜訪文字', next: '下次跟進', store: '門市', date: '拜訪日期', source: '紀錄來源', topics: '主題連結', people: '人物連結', name: '名稱', address: '地址', mapUrl: '地圖網址', city: '縣市', district: '地區', channel: '通路', attr: '屬性', contact: '窗口', nextRemember: '下次記得（未轉換文字）', nextRememberTasks: '下次記得任務', nextRememberImports: '提醒轉換原始文字', everyTimeMust: '每次必做、必給', desc: '備註', role: '職務' };
  return plan.changes.map(change => {
    const versions = change.heads.map(id => record.heads.findIndex(head => head.id === id) + 1).join('、');
    return `<li>${esc(labels[change.field] || change.field)}：取自版本 ${esc(versions)}</li>`;
  }).join('');
}
function checkedReview(ctx) {
  const r = project(payload.bundle).find(r => r.type === ctx.type && r.id === ctx.id);
  if (!r || JSON.stringify(reviewHeads(r)) !== JSON.stringify([...ctx.parents].sort())) throw new Error('核對期間已有新版本，本次未寫入。請關閉並重新比較衝突。');
  return r;
}
function reviewValue(value) {
  if (value === undefined) return '（未提供）';
  if (typeof value === 'string') return value || '（空白）';
  return JSON.stringify(value, null, 2);
}
function reviewFields(before, after) {
  const labels = { text: '拜訪文字', next: '下次跟進', store: '門市 ID', date: '拜訪日期', source: '紀錄來源', topics: '主題連結', people: '人物連結', attachments: '附件', name: '名稱', address: '地址', mapUrl: '地圖網址', city: '縣市', district: '地區', channel: '通路', attr: '屬性', contact: '窗口', nextRemember: '下次記得（未轉換文字）', nextRememberTasks: '下次記得任務', nextRememberImports: '提醒轉換原始文字', everyTimeMust: '每次必做、必給', desc: '備註', role: '職務', confirmed: '身分已核對', sameAs: '人物身分連結', csvSources: 'CSV 來源證據', csvIdentityPending: '門市身分待確認', csvIdentityRules: '門市身分裁定', googleText: 'Google 來源文字', googleUpdatePending: 'Google 文字待核對', sourceMissing: '來源缺失' };
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = keys.filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const rows = changed.map(k => {
    const diff = diffTextSegments(reviewValue(before[k]), reviewValue(after[k]));
    return `<section class="conflict-field"><h4>${esc(labels[k] || k)}</h4><div class="quick-text-compare"><section><small>對照內容</small><pre>${diffSegmentsHTML(diff.before)}</pre></section><section><small>此版本／預計結果</small><pre>${diffSegmentsHTML(diff.after)}</pre></section></div></section>`;
  }).join('');
  return `<p><strong>${changed.length} 個欄位不同</strong>${changed.length ? '：' + changed.map(k => esc(labels[k] || k)).join('、') : '；仍須核對是否有刪除狀態差異。'}</p>${rows}`;
}
function reviewAttendanceHTML(op, storeName = '') {
  const attendance = op.visitAttendance; if (!attendance) return '';
  const time = new Date(attendance.at).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  return `<section class="version-attendance"><h4>使用者已確認的實際拜訪</h4><p>${esc(attendance.date)} ${esc(time)}（台北時間）</p><p>${op.type === 'visit' ? '拜訪筆記儲存時確認' : '門市資料／待辦儲存時確認'}${storeName ? ` · ${esc(storeName)}` : ''}</p><small>門市識別：${esc(attendance.store)}<br>來源版本：${esc(op.id)}</small></section>`;
}
function reviewVersionLabel(o, index) {
  return `版本 ${index + 1} · ${o.device === payload.device ? '本裝置' : '其他裝置 ' + o.device.slice(0, 8)} · ${dateText(o.at)}${o.deleted ? ' · 已刪除' : ' · 保留紀錄'}${o.visitAttendance ? ' · 已確認拜訪 ' + o.visitAttendance.date : ''}`;
}
function openReview(type, id, conflict) {
  const r = by(type, id); if (!r) return;
  versionReview = { type, id, parents: reviewHeads(r), conflict, baseline: r.heads[0].id };
  resolutionPreview = null;
  if (conflict) renderConflictReview();
  else {
    $('review-title').textContent = '歷史版本';
    $('review-body').innerHTML = `<p>還原會先預覽，再建立新版本；不會抹除後續歷史。已確認的拜訪保留在原來源版本，不因還原而重複新增；沒有拜訪標記的版本也不會推算為拜訪。</p>${[...r.versions].sort((a, b) => b.at.localeCompare(a.at)).map(o => `<article class="version"><p>${esc(dateText(o.at))}${o.deleted ? ' · 已刪除' : ''}</p>${reviewAttendanceHTML(o)}<pre>${esc(describeData(type, o.data))}</pre><button data-use-version="${esc(o.id)}">預覽還原這個內容</button></article>`).join('')}`;
  }
  openDialog($('review'));
}
function renderConflictReview() {
  const r = checkedReview(versionReview), versions = r.heads;
  const baseline = versions.find(o => o.id === versionReview.baseline) || versions[0];
  const safePlan = safeConflictMerge(r);
  $('review-title').textContent = '比較衝突版本';
  $('review-body').innerHTML = `<p><strong>${versions.length} 個版本待核對，目前沒有寫入任何變更。</strong></p><p>選一份作為對照，再看其他版本的差異。紅色是對照內容中不同的部分，綠色是另一版本不同的部分；顏色不代表正確、新舊或建議採用。時間是版本儲存時間，不是拜訪日期。只有下方明確標示的拜訪確認才計入實際拜訪；採用或合併版本不會抹除其他版本的拜訪確認，也不會複製成新的拜訪。</p>${safePlan.safe ? `<section class="safe-merge-card"><span class="pill">安全合併預覽可用</span><h3>各版本修改了不同欄位</h3><p>系統只組合沒有互相覆蓋的欄位，現在仍未寫入。請先查看完整結果，再決定是否建立處理版本。</p><ul>${safeMergeSummary(safePlan, r)}</ul><button class="primary" data-safe-conflict-preview>查看安全合併預覽</button></section>` : `<section class="safe-merge-card blocked"><strong>這次不提供自動合併建議</strong><p>${esc(safePlan.reason)}</p><p>你仍可逐版比較、採用其中一版，或以一個版本為起點人工整合。</p></section>`}<label>對照版本<select id="conflict-baseline">${versions.map((o, i) => `<option value="${esc(o.id)}" ${o.id === baseline.id ? 'selected' : ''}>${esc(reviewVersionLabel(o, i))}</option>`).join('')}</select></label>${versions.map((o, i) => `<article class="version"><h3>${esc(reviewVersionLabel(o, i))}</h3>${reviewAttendanceHTML(o)}${o.id === baseline.id ? '<p>目前對照版本</p>' : `<p>${o.deleted !== baseline.deleted ? '<strong>刪除狀態不同，請特別核對。</strong>' : '刪除狀態一致。'}</p>${reviewFields(baseline.data, o.data)}`}<details><summary>查看完整內容與來源欄位</summary><pre>${esc(reviewValue(o.data))}</pre></details><button class="secondary" data-use-version="${esc(o.id)}">${o.deleted ? '預覽採用刪除' : '預覽採用此版本'}</button> ${!o.deleted ? `<button data-merge-version="${esc(o.id)}">以此版本為起點整合</button>` : ''}</article>`).join('')}`;
}
function previewSafeConflictMerge() {
  const r = checkedReview(versionReview), plan = safeConflictMerge(r);
  if (!plan.safe) throw new Error('衝突內容已改變，現在不能安全產生合併預覽；請重新核對。');
  previewResolution(versionReview, plan.data);
}
function previewResolution(ctx, data, deleted = false, blobs = {}, fromEditor = false) {
  const r = checkedReview(ctx);
  resolutionPreview = { ...ctx, parents: [...ctx.parents], data: structuredClone(data), deleted, blobs, fromEditor };
  $('review-title').textContent = '確認衝突處理／還原結果';
  $('review-body').innerHTML = `<p><strong>尚未寫入。${deleted ? '確認後，此紀錄將移到回收桶。' : '確認後，同一筆紀錄會建立一個新的有效版本。'}</strong></p><p>以下逐一比較目前版本與預計結果。${r.conflict ? '目前全部衝突將由這個結果解決。' : ''}未採用的內容與原有拜訪確認仍保留在歷史中，原始 Source Snapshot 不變；採用／還原版本不會新增實際拜訪日期。</p><h3>預計保存的完整內容</h3><pre class="resolution-result">${esc(describeData(ctx.type, data))}</pre><details><summary>查看全部結果欄位</summary><pre>${esc(reviewValue(data))}</pre></details>${r.heads.map((o, i) => `<article class="version"><h3>相對於 ${esc(reviewVersionLabel(o, i))}</h3><p>${o.deleted !== deleted ? '<strong>刪除狀態將改變。</strong>' : '刪除狀態不變。'}</p>${o.visitAttendance ? reviewAttendanceHTML(o) : ''}${reviewFields(o.data, data)}</article>`).join('')}<p id="resolution-error" class="error" role="alert"></p><div class="dialog-footer"><button data-resolution-back>返回${fromEditor ? '修改' : '核對'}</button><button class="primary" data-resolution-confirm>${deleted ? '確定移到回收桶並建立版本' : '確定建立處理結果版本'}</button></div>`;
  openDialog($('review'));
}
async function useVersion(id) {
  if (!versionReview) throw new Error('請重新開啟版本核對。');
  const r = checkedReview(versionReview), o = r.versions.find(o => o.id === id);
  if (!o || (versionReview.conflict && !r.heads.some(h => h.id === id))) throw new Error('版本已改變，請重新核對。');
  if (payload.draft?.id === r.id) throw new Error('這筆拜訪有未完成草稿，請先處理草稿。');
  previewResolution(versionReview, o.data, o.deleted);
}
async function confirmResolution() {
  const ctx = resolutionPreview; if (!ctx) throw new Error('請重新預覽處理結果。');
  if (ctx.fromEditor && ctx.type === 'store') {
    const editor = editorContext;
    if (!editor || editor.id !== ctx.id || editor.reminderDraftContext !== ctx.reminderDraftContext) throw new Error('編輯畫面已變更，請重新預覽處理結果。');
    await flushReminderDraft();
    if (editorContext !== editor || editor.reminderDraftContext !== ctx.reminderDraftContext || resolutionPreview !== ctx) throw new Error('編輯畫面已變更，請重新預覽處理結果。');
  }
  checkedReview(ctx);
  if (!ctx.fromEditor && payload.draft?.id === ctx.id) throw new Error('這筆拜訪有未完成草稿，請先處理草稿。');
  const bundle = structuredClone(payload.bundle); bundle.schema = 2;
  bundle.ops.push(revision(ctx.type, ctx.id, ctx.data, ctx.parents, payload.device, ctx.deleted));
  Object.assign(bundle.blobs, ctx.blobs); validateBundle(bundle);
  await persist({ ...payload, bundle, dirty: true, ...(ctx.fromEditor && ctx.type === 'visit' ? { draft: null } : {}), ...(ctx.fromEditor && ctx.type === 'store' ? { reminderDrafts: storedReminderDrafts().filter(draft => draft.storeId !== ctx.id) } : {}) });
  if (ctx.fromEditor) { clearTimeout(draftTimer); draftTimer = null; editorContext = null; $('editor').close(); }
  resolutionPreview = null; versionReview = null; $('review').close(); render(); toast('已建立處理結果版本，原版本保留在歷史中；等待同步。');
}
function editMerge(id) {
  const r = checkedReview(versionReview), o = r.heads.find(o => o.id === id);
  if (!o || o.deleted) throw new Error('請重新選擇可編輯的版本。');
  if (payload.draft) throw new Error('有未完成草稿，請先處理，避免覆蓋。');
  if (r.type === 'store' && reminderDraftFor(r.id)) throw new Error('這間門市有未完成提醒草稿；請先從拜訪頁開啟、核對並保留所需文字，再明確捨棄草稿後處理衝突。');
  const temporary = { ...r, ...o.data, conflict: false, heads: [o] }, i = records.findIndex(record => record.type === r.type && record.id === r.id);
  if (i < 0) throw new Error('目前畫面已沒有這筆紀錄，請重新開啟核對。');
  const original = records[i]; records[i] = temporary;
  try {
    $('review').close(); openEditor(o.type, o.entity); editorContext.parents = reviewHeads(r);
    if (editorContext.reminderDraftContext) editorContext.reminderDraftContext.parents = [...editorContext.parents].sort();
    $('editor-fields').insertAdjacentHTML('afterbegin', `<details class="conflict-editor-reference"><summary>展開原衝突版本，邊看邊整合</summary><p>以選定版本為起點；其他版本不會自動拼接。請核對附件、人物與來源等差異。</p>${r.heads.map((head, index) => `<section><h3>${esc(reviewVersionLabel(head, index))}</h3><pre>${esc(reviewValue(head.data))}</pre></section>`).join('')}</details>`);
  }
  finally { records[i] = original; }
}
async function removeEntity(type, id) {
  const r = by(type, id); if (r.conflict) return openReview(type, id, true);
  if (!confirm(`將此${kinds[type]}移到回收桶？既有拜訪原文與歷史會保留。`)) return;
  await commitRevision(type, id, r.heads[0].data, r.heads.map(h => h.id), true); toast('已移到回收桶。');
}
function download(bytes, filename, type) { const url = URL.createObjectURL(new Blob([bytes], { type })); objectURLs.push(url); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => { URL.revokeObjectURL(url); objectURLs = objectURLs.filter(u => u !== url); }, 60000); }
async function exportBackup() { const envelope = await seal(payload.bundle, key, meta); download(JSON.stringify({ format: 'pharmacy-backup-1', envelope }), `pharmacy-${new Date().toISOString().slice(0, 10)}.pharmabackup`, 'application/octet-stream'); await persist({ ...payload, lastBackupExport: new Date().toISOString() }); renderHealthAudit(); toast('已產生加密備份，請儲存到本機或外接碟。'); }
function assertBackupIdle() {
  if (editorContext || singleStoreContext || inlineTextContext || reminderContext || payload?.draft || payload?.inlineTextDraft || storedReminderDrafts().length || csvImport.hasPending() || $('review').open || $('quick-text-dialog').open || $('store-reminder-dialog').open || $('rebuild-dialog').open) throw new Error('請先完成或取消目前的編輯、草稿或核對，再檢查備份；原輸入保持不變。');
  if (pendingLock || document.hidden) throw new Error('App 已離開前景，請返回後重新選取備份。');
}
function clearBackupPreview() {
  backupPreview = null;
  $('backup-review-body').replaceChildren(); $('backup-ack').checked = false;
  $('backup-error').textContent = ''; $('backup-apply').disabled = true;
}
function updateBackupControls() {
  const button = $('backup-apply'); if (!button) return;
  button.disabled = busy || !backupPreview?.plan.summary.hasChanges || !$('backup-ack').checked;
  $('backup-ack').disabled = busy || !backupPreview?.plan.summary.hasChanges;
}
function backupSummaryHTML(summary) {
  const labels = { store: '門市', visit: '拜訪', person: '人物', topic: '主題', source: 'Source Snapshot' };
  const attendance = summary.visitAttendance;
  const attendanceSummary = attendance ? `<section class="backup-attendance-summary"><h4>實際拜訪確認的影響</h4><p>確認來源 ${esc(attendance.beforeMarks)} → ${esc(attendance.afterMarks)} 份；加入備份中既有的 ${esc(attendance.addedMarks)} 份確認。</p><p>門市拜訪日 ${esc(attendance.beforeDays)} → ${esc(attendance.afterDays)} 組（新增 ${esc(attendance.addedDays)} 組門市／日期）。同一門市同一天只算一個拜訪日；不同門市分開計算。</p><p class="muted">保留原確認時間與來源，不把還原或合併當成今天的新拜訪；加入歷史確認可能改變最近實際拜訪與距今天數。</p></section>` : '';
  return `<div class="backup-counts">${Object.entries(labels).map(([type, label]) => `<p><strong>${label}</strong>：${summary.before.entities[type]} → ${summary.after.entities[type]} 筆（新增 ${summary.newEntities[type]} 筆）<br><small>有效 ${summary.before.active[type]} → ${summary.after.active[type]}；回收桶 ${summary.before.deleted[type]} → ${summary.after.deleted[type]}</small></p>`).join('')}</div><p>增加 ${summary.addedRevisions} 個既有版本；${summary.identicalRevisions} 個版本已存在。新增 ${summary.newBlobs} 份附件／原始來源檔案。</p>${attendanceSummary}<p>既有紀錄目前版本改變 ${summary.changedExistingEntities} 筆；只補歷史 ${summary.historyOnlyEntities} 筆。衝突 ${summary.conflictsBefore} → ${summary.conflictsAfter} 筆（新增衝突 ${summary.newConflicts} 筆；備份已含解決版本 ${summary.resolvedConflicts} 筆）。</p><p class="${summary.movedToTrash || summary.revived ? 'error' : 'muted'}">有效紀錄移入回收桶 ${summary.movedToTrash} 筆；回收桶改為含有效版本 ${summary.revived} 筆（有衝突者仍待核對）。</p><p class="muted">筆數包含回收桶與衝突紀錄；衝突保留全部版本，尚未裁定內容或門市身分。合併不代表把目前資料倒退到備份日期。</p>`;
}
function backupChangeTitle(change) {
  const labels = { store: '門市', visit: '拜訪', person: '人物', topic: '主題', source: 'Source Snapshot' };
  const candidate = change.afterHeads.find(head => !head.deleted) || change.afterHeads[0];
  const store = change.type === 'visit' ? backupPreview?.storeNames?.get(candidate?.data.store) : '';
  const title = candidate?.data.name || candidate?.data.file || (change.type === 'visit' ? `${store || candidate?.data.store || '門市未提供'} · ${candidate?.data.date || '日期未提供'}` : change.entity);
  const action = change.afterConflict ? '保留多版本，需另行核對' : change.afterDeleted ? '回收桶狀態' : change.beforeDeleted ? '恢復有效紀錄' : change.kind === 'added' ? '新增紀錄' : change.kind === 'history-only' ? '只補歷史，目前內容不變' : '目前版本將改變';
  return `${labels[change.type]} · ${title}：${action}${change.addedVisitAttendance?.length ? '；加入 ' + change.addedVisitAttendance.length + ' 份既有拜訪確認' : ''}`;
}
function backupVersionHTML(head) {
  const data = head.data, labels = { name: '名稱', text: '拜訪原文', date: '拜訪日期', source: '紀錄來源', next: '下次跟進', nextRemember: '下次記得（未轉換文字）', everyTimeMust: '每次必做、必給', address: '地址', city: '縣市', district: '行政區', contact: '窗口', desc: '備註', role: '職務' };
  const fields = Object.entries(labels).filter(([field]) => Object.hasOwn(data, field)).map(([field, label]) => `<h5>${label}</h5><pre>${esc(reviewValue(data[field]))}</pre>`).join('');
  const tasks = data.nextRememberTasks?.length ? `<h5>下次記得任務</h5>${data.nextRememberTasks.map(task => `<p>${task.completedAt ? '✓ 已完成' : '□ 待完成'}：${esc(task.text)}${task.completedAt ? `<br><small>完成：${esc(dateText(task.completedAt))}</small>` : ''}</p>`).join('')}` : '';
  return `<article class="backup-version"><p>${esc(dateText(head.at))} · ${head.deleted ? '回收桶' : '保留紀錄'}</p>${head.visitAttendance ? reviewAttendanceHTML(head, backupPreview?.storeNames?.get(head.visitAttendance.store) || '') : ''}${fields}${tasks}<details><summary>完整欄位與來源證據</summary><p class="muted">版本識別：${esc(head.id)}</p><pre>${esc(reviewValue(data))}</pre></details></article>`;
}
function backupChangeHTML(change) {
  const heads = (list, label) => `<section><h4>${label}</h4>${list.length ? list.map(backupVersionHTML).join('') : '<p>目前無此紀錄</p>'}</section>`;
  const addedAttendance = change.addedVisitAttendance || [];
  const onePair = change.beforeHeads.length === 1 && change.afterHeads.length === 1;
  const contentUnchanged = onePair && [...new Set([...Object.keys(change.beforeHeads[0].data), ...Object.keys(change.afterHeads[0].data)])].every(field => JSON.stringify(change.beforeHeads[0].data[field]) === JSON.stringify(change.afterHeads[0].data[field]));
  const comparison = contentUnchanged && addedAttendance.length ? `<p><strong>內容欄位沒有變更；仍會加入 ${addedAttendance.length} 份既有拜訪確認。</strong>請核對以下原確認日期、來源及刪除狀態。</p>` : onePair && change.kind !== 'history-only' ? reviewFields(change.beforeHeads[0].data, change.afterHeads[0].data) : '';
  const attendance = addedAttendance.length ? `<details><summary>本次加入的拜訪確認來源 · ${addedAttendance.length} 份（含歷史版本）</summary><p>這些確認隨原版本保留；不是這次匯入新建立的拜訪。</p>${addedAttendance.map(op => reviewAttendanceHTML(op, backupPreview?.storeNames?.get(op.visitAttendance.store) || '')).join('')}</details>` : '';
  return `<p class="muted">識別：${esc(change.entity)}</p>${comparison}${attendance}${heads(change.beforeHeads, '套用前全部目前版本')}${heads(change.afterHeads, '套用後全部目前版本')}`;
}
function renderBackupChanges(page = 0) {
  const ctx = backupPreview; if (!ctx) return;
  const count = ctx.plan.changes.length, pages = Math.max(1, Math.ceil(count / 20));
  ctx.changePage = Math.max(0, Math.min(page, pages - 1));
  const start = ctx.changePage * 20;
  $('backup-changes').innerHTML = ctx.plan.changes.slice(start, start + 20).map((change, index) => `<details class="backup-change" data-backup-change="${start + index}"><summary>${esc(backupChangeTitle(change))}</summary><div></div></details>`).join('') || '<p>沒有新增或改變的紀錄。</p>';
  $('backup-pages').innerHTML = `<p>第 ${ctx.changePage + 1}／${pages} 頁 · 共 ${count} 筆</p><button type="button" data-backup-page="${ctx.changePage - 1}" ${ctx.changePage === 0 ? 'disabled' : ''}>上一頁</button> <button type="button" data-backup-page="${ctx.changePage + 1}" ${ctx.changePage + 1 === pages ? 'disabled' : ''}>下一頁</button>`;
}
function renderBackupWarnings(page = 0) {
  const ctx = backupPreview, target = $('backup-warnings'); if (!ctx || !target) return;
  const warnings = ctx.plan.summary.warnings, pages = Math.max(1, Math.ceil(warnings.length / 20));
  page = Math.max(0, Math.min(page, pages - 1));
  target.innerHTML = warnings.slice(page * 20, page * 20 + 20).map(w => `<p>${esc(labelsForBackupWarning(w))}</p>`).join('') + `<p>第 ${page + 1}／${pages} 頁</p><button type="button" data-backup-warning-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>上一頁</button> <button type="button" data-backup-warning-page="${page + 1}" ${page + 1 === pages ? 'disabled' : ''}>下一頁</button>`;
}
function renderBackupPreview() {
  const ctx = backupPreview, summary = ctx.plan.summary;
  ctx.storeNames = new Map(project(ctx.plan.bundle).filter(record => record.type === 'store').map(store => [store.id, store.name + (store.conflict ? '（門市有衝突）' : '')]));
  $('backup-review-title').textContent = summary.mode === 'restore' ? '在空白裝置還原 · 影響預覽' : '備份合併 · 影響預覽';
  $('backup-review-body').innerHTML = `<p>已在本機解密並驗證檔案、版本鏈結、附件與原始來源內容。目前尚未寫入資料。</p><p class="muted">檔案：${esc(ctx.filename)}（${ctx.bytes} bytes）。檔名不代表已驗證的備份日期。</p>${summary.mode === 'restore' ? '<p>確認後會在這台空白裝置建立本機加密資料。需要重新配對 Mac；不會自動連接其他資料庫。</p>' : '<p>確認後保留本機全部既有版本，加入備份中的版本。若備份含較新的修改或刪除版本，目前顯示內容可能改變；請展開下方逐筆核對。已配對時，後續會依既有同步機制傳到 Mac 與其他裝置；內容、刪除或恢復狀態也會同步。</p>'}${backupSummaryHTML(summary)}<p class="muted">資料格式：${ctx.currentPayload?.bundle.schema ?? '空白裝置'} → ${ctx.plan.bundle.schema}${ctx.currentPayload && ctx.currentPayload.bundle.schema !== ctx.plan.bundle.schema ? '；格式升級也需確認，原文及歷史保持原樣。' : '。'}</p><p>備份不含尚未完成的草稿、裝置配對憑證或 GPS 位置。原始文字、任務完成歷史、實際拜訪確認、CSV 與 Source Snapshot 依各版本原樣保留。</p>${summary.warnings.length ? `<details><summary>需要注意的歷史連結 · ${summary.warnings.length} 項</summary><p>下列紀錄指向未包含的門市、人物或主題；只列出問題，不猜補或裁定身分。</p><div id="backup-warnings"></div></details>` : ''}<details><summary>逐筆影響 · ${ctx.plan.changes.length} 筆（可展開內容對比）</summary><div id="backup-changes"></div><div id="backup-pages"></div></details>${summary.hasChanges ? '' : '<p class="insight">這份備份沒有可加入的版本或檔案，無需套用；關閉即可，資料不會寫入。</p>'}`;
  renderBackupChanges(); renderBackupWarnings();
  $('backup-ack').checked = false; $('backup-ack').disabled = !summary.hasChanges;
  $('backup-apply').textContent = summary.mode === 'restore' ? '確認影響並在本機還原' : '確認影響並合併備份';
  $('backup-error').textContent = ''; updateBackupControls(); openDialog($('backup-review'));
}
function labelsForBackupWarning(warning) {
  return `${warning.type}:${warning.entity} → ${warning.targetType}:${warning.targetId}`;
}
function renderBackupResult() {
  const result = payload?.lastBackupOperation, target = $('backup-result');
  if (!target) return;
  target.replaceChildren();
  if (!result) return;
  target.innerHTML = `<h3>最近一次確認套用結果</h3><p>${esc(dateText(result.at))} · ${result.summary.mode === 'restore' ? '已在本機還原' : '已在本機合併'}，加密儲存成功。</p>${backupSummaryHTML(result.summary)}<p class="muted">這是本機套用結果；Mac 是否收到請以上方同步狀態為準。驗證可讀不等於外接碟保存成功，也不等於真機還原演練通過。</p>`;
}
async function importBackup(file) {
  if (backupPreview) throw new Error('請先關閉目前的備份預覽。');
  if (file.size > 36 * 1024 * 1024) throw new Error('備份檔案太大。');
  const data = JSON.parse(await file.text()); if (data?.format !== 'pharmacy-backup-1') throw new Error('不是此版本的加密備份。');
  const envelope = checkEnvelope(data.envelope);
  if (payload && (envelope.vaultId !== meta.vaultId || envelope.salt !== meta.salt)) throw new Error('這份備份屬於另一個資料庫，已停止合併。');
  assertBackupIdle();
  const currentPayload = payload, currentKey = key, currentMeta = meta, expected = localRevision;
  const baseline = JSON.stringify(payload), disk = await readLocal();
  if (!currentPayload && disk) throw new Error('本機已有資料，請先解鎖後合併。');
  if (currentPayload && (!disk || disk.revision !== expected)) throw new Error('另一個視窗已改變本機資料，請重新開啟後再選取備份。');
  const password = !currentPayload ? $('password').value : '';
  if (!currentPayload && !password) throw new Error('請先在密碼欄填寫備份密碼，再選取備份。');
  const restoredKey = currentPayload ? currentKey : await derive(password, envelope);
  const incoming = validateBundle(await unseal(envelope, restoredKey));
  if (incoming.vaultId !== envelope.vaultId) throw new Error('備份身分不符。');
  const plan = await planBackupImport(currentPayload?.bundle || null, incoming);
  assertBackupIdle();
  if (payload !== currentPayload || key !== currentKey || meta !== currentMeta || localRevision !== expected || JSON.stringify(payload) !== baseline) throw new Error('檢查期間本機狀態已改變，請重新選取備份。');
  backupPreview = { plan, incoming, restoredKey, envelope, currentPayload, currentKey, currentMeta, expected, baseline, candidate: JSON.stringify(plan.bundle), filename: file.name || '加密備份', bytes: file.size };
  renderBackupPreview();
}
async function applyBackupPreview() {
  const ctx = backupPreview;
  if (!ctx || !ctx.plan.summary.hasChanges || !$('backup-ack').checked) throw new Error('請先查看實際影響並勾選確認。');
  assertBackupIdle();
  const assertCurrent = () => {
    if (backupPreview !== ctx || payload !== ctx.currentPayload || key !== ctx.currentKey || meta !== ctx.currentMeta || localRevision !== ctx.expected || JSON.stringify(payload) !== ctx.baseline || pendingLock || document.hidden) throw new Error('預覽期間本機狀態已改變，請關閉並重新選取備份；尚未套用。');
  };
  assertCurrent();
  const disk = await readLocal();
  if (ctx.currentPayload ? !disk || disk.revision !== ctx.expected : !!disk) throw new Error('另一個視窗已改變本機資料，請重新開啟並預覽；尚未套用。');
  const plan = await planBackupImport(payload?.bundle || null, ctx.incoming);
  if (JSON.stringify(plan.bundle) !== ctx.candidate || JSON.stringify(plan.summary) !== JSON.stringify(ctx.plan.summary)) throw new Error('備份結果已改變，請重新選取備份。');
  assertCurrent();
  const at = new Date().toISOString(), report = { at, summary: { ...plan.summary, warnings: [], warningCount: plan.summary.warnings.length } };
  const next = withPendingSync(payload, payload ? { ...payload, bundle: plan.bundle, dirty: true, lastBackupOperation: report } : { schema: 1, device: uuid(), deviceName: '還原的裝置', token: null, bundle: plan.bundle, dirty: true, serverVersion: 0, lastSync: null, lastHealthAudit: at, lastBackupOperation: report });
  const nextMeta = ctx.currentPayload ? ctx.currentMeta : ctx.envelope;
  const encrypted = await seal(next, ctx.restoredKey, nextMeta, 'device');
  assertCurrent();
  // Use the reviewed revision, never a newer global revision after an await.
  // Memory adopts the candidate only after the one IndexedDB transaction succeeds.
  const rev = await writeLocal(encrypted, ctx.currentPayload ? ctx.expected : 0, ctx.restoredKey);
  key = ctx.restoredKey; meta = nextMeta; payload = next; localRevision = rev;
  slot = { envelope: encrypted, revision: rev, unlockKey: key }; localSaveState = 'saved';
  syncScheduler.request('saved');
  clearBackupPreview(); $('backup-review').close(); $('password').value = '';
  $('save-state').textContent = '手機已保存：已加密儲存於本機';
  if (!ctx.currentPayload) await openWorkspace();
  render(); renderBackupResult(); switchView('sync');
  toast(plan.summary.mode === 'restore' ? '已在本機還原並保留全部歷史；尚未配對 Mac。' : '已依確認結果在本機合併；全部歷史保留，等待 Mac 同步確認。');
}
async function adoptRebuilt(event) {
  event.preventDefault();
  await run(async () => {
    if (editorContext || singleStoreContext || reminderContext || inlineTextContext || payload?.draft || payload?.inlineTextDraft || storedReminderDrafts().length || csvImport.hasPending()) throw new Error('請先完成或明確捨棄所有未完成草稿，並取消匯入預覽，再切換資料庫。');
    const code = $('rebuild-code').value.trim(), password = $('rebuild-connect-password').value;
    if (!code || !password || !$('rebuild-understood').checked) throw new Error('請填寫配對碼、密碼並確認隔離本機舊資料。');
    const paired = await api('/api/pair', { method: 'POST', token: null, body: { code, label: payload.deviceName } });
    const next = await openRebuiltSnapshot(paired, meta.vaultId, password, payload.deviceName);
    const envelope = await seal(next.payload, next.key, next.meta, 'device');
    const rev = await archiveAndReplaceLocal(envelope, localRevision, next.key);
    // Only adopt after the archive and active slot commit in one transaction.
    attendanceCache = null; clearNearbyPosition(); meta = next.meta; key = next.key; payload = next.payload; localRevision = rev; slot = { envelope, revision: rev, unlockKey: key };
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
  openDialog($('review'));
}
async function exportArchive(id) {
  const archived = await readLocalArchive(id); if (!archived?.unlockKey) throw new Error('找不到可匯出的隔離備份。');
  const old = await unseal(archived.envelope, archived.unlockKey, 'device'); validateBundle(old.bundle);
  if (old.bundle.vaultId !== archived.envelope.vaultId) throw new Error('隔離備份身分不符。');
  const envelope = await seal(old.bundle, archived.unlockKey, archived.envelope);
  download(JSON.stringify({ format: 'pharmacy-backup-1', envelope }), 'pharmacy-isolated-old-vault.pharmabackup', 'application/octet-stream');
}
function openRepairPair() {
  $('review-title').textContent = '重新配對此裝置';
  $('review-body').innerHTML = '<form id="repair-pair-form"><p>保留本機資料，使用 Mac 管理頁新產生的配對碼重新連線。確認前不會送出配對碼或修改資料。</p><label>一次性配對碼<input id="repair-pair-code" autocomplete="off" autocapitalize="none" spellcheck="false" required></label><p id="repair-pair-error" class="error" role="alert"></p><div class="dialog-footer"><button type="button" data-close="review">取消</button><button type="submit" class="primary">確認重新配對</button></div></form>';
  openDialog($('review'));
}
async function repairPair(code) {
  if (!code?.trim()) return;
  if (autoFetching || syncInProgress) { const error = new Error('正在確認同步，請稍候再送出配對碼。'); error.code = 'sync-paused'; throw error; }
  const paired = await api('/api/pair', { method: 'POST', token: null, body: { code: code.trim(), label: payload.deviceName } });
  if (paired.snapshot.envelope && (paired.snapshot.envelope.vaultId !== meta.vaultId || paired.snapshot.envelope.salt !== meta.salt)) throw new Error('此 Mac 是另一個資料庫，本機資料未修改。');
  await persist({ ...payload, device: paired.id, token: paired.token, serverVersion: 0, dirty: true }); await synchronize(); syncScheduler.confirmed(); toast('重新配對完成。');
}
document.addEventListener('click', event => {
  const b = event.target.closest('button');
  const candidate = event.target.closest('[data-candidate-key]'); if (candidate && !busy) return singleStoreContext ? toast('請先完成或收起這次拜訪紀錄，再查看候選原文。') : openCandidateDetail(candidate.dataset.candidateKey, candidate.dataset.candidateStore || '');
  const node = event.target.closest('[data-node-type]'); if (node && !busy) return singleStoreContext ? toast('請先完成或收起這次拜訪紀錄，再切換頁面。') : navigate(node.dataset.nodeType, node.dataset.nodeId);
  if (!b) return;
  if (b.dataset.close) {
    if (['rebuild-dialog', 'quick-text-dialog', 'store-reminder-dialog', 'review', 'backup-review'].includes(b.dataset.close) && busy) return;
    if (b.dataset.close === 'store-reminder-dialog') return run(closeStoreReminder, 'store-reminder-error');
    if (b.dataset.close === 'review' && singleStoreContext) return run(closeSingleStoreReview, 'single-store-error');
    if (b.dataset.close === 'editor' && editorContext?.reminderDraftContext) return run(closeStoreReminderEditor, 'editor-error');
    if (b.dataset.close === 'editor' && editorContext?.type === 'visit') return run(async () => {
      await flushVisitDraft(); $('editor').close(); editorContext = null; render();
    }, 'editor-error');
    $(b.dataset.close).close(); if (b.dataset.close === 'rebuild-dialog') $('rebuild-connect-form').reset(); if (b.dataset.close === 'editor') editorContext = null; if (b.dataset.close === 'store-reminder-dialog') reminderContext = null; return;
  }
  if (updateHolding || busy || !payload) return;
  if (b.dataset.resumeReminder !== undefined) return openStoreReminder(b.dataset.resumeReminder);
  if (b.id === 'discard-reminder-draft') return run(discardReminderDraft, 'store-reminder-error');
  if (b.dataset.startSingleStoreCapture !== undefined) return activateSingleStoreCapture();
  if (b.dataset.resumeSingleDraft !== undefined) return resumeSingleDraftFromReview();
  if (b.dataset.collapseSingleStoreCapture !== undefined) return run(collapseSingleStoreCapture, 'single-store-error');
  if (b.dataset.discardSingleStoreDraft !== undefined) return run(discardVisitDraft, 'single-store-error');
  if (b.id === 'connect-rebuilt') { if (editorContext || singleStoreContext || reminderContext || inlineTextContext || payload?.draft || payload?.inlineTextDraft || storedReminderDrafts().length || csvImport.hasPending()) return toast('請先完成或明確捨棄所有未完成草稿，並取消匯入預覽。'); $('rebuild-connect-form').reset(); $('rebuild-connect-error').textContent = ''; openDialog($('rebuild-dialog')); return; }
  if (b.id === 'view-archives') return run(openArchives);
  if (b.dataset.exportArchive) return run(() => exportArchive(b.dataset.exportArchive));
  if (b.dataset.view) return switchView(b.dataset.view);
  if (b.dataset.regionalSignal) return openRegionalSignal(b.dataset.regionalSignal);
  if (b.dataset.regionalStore) { if ($('review').open) $('review').close(); return navigate('store', b.dataset.regionalStore); }
  if (b.dataset.quickEditText) return openQuickTextEdit(b.dataset.quickEditText);
  if (b.dataset.quickTextBack !== undefined) { const id = quickTextContext?.id, briefStoreId = quickTextContext?.briefStoreId; const selector = `[data-inline-edit-text="${CSS.escape(id || '')}"]`; const target = briefStoreId && $('review').open && $('review').dataset.singleStoreId === briefStoreId ? $('review').querySelector(selector) : document.querySelector(selector); $('quick-text-dialog').close(); quickTextContext = null; focusReadingSurface(target); return; }
  if (b.dataset.inlineCancel) { const review = b.closest('#review'), briefStoreId = review?.open && review.classList.contains('visit-brief-dialog') ? review.dataset.singleStoreId || '' : ''; return run(() => cancelInlineTextEdit(b.dataset.inlineCancel, briefStoreId)); }
  if (b.dataset.inlineReview) { const review = b.closest('#review'), briefStoreId = review?.open && review.classList.contains('visit-brief-dialog') ? review.dataset.singleStoreId || '' : ''; return run(() => reviewInlineTextEdit(b.dataset.inlineReview, briefStoreId), null); }
  if (b.dataset.resumeVisitDraft !== undefined) return resumeVisitDraft();
  if (b.dataset.resumeInlineDraft !== undefined) return resumeInlineTextDraft();
  if (b.dataset.reminderRepeat) return run(() => changeReminderTask(b.dataset.reminderStore, b.dataset.reminderRepeat, b.dataset.reminderHead, true));
  if (b.dataset.storeReminder) { if (singleStoreContext) return toast('請先完成或收起這次拜訪紀錄，再修改門市提醒。'); if ($('review').open && !$('review').classList.contains('visit-brief-dialog')) $('review').close(); return openStoreReminder(b.dataset.storeReminder); }
  if (b.dataset.quickVisit) return openVisitForStore(b.dataset.quickVisit);
  if (b.dataset.newVisitStore) { if ($('review').open) $('review').close(); return openVisitForStore(b.dataset.newVisitStore); }
  if (b.dataset.visitBrief) return openVisitBrief(b.dataset.visitBrief);
  if (b.id === 'resume-draft') return payload?.draft?.format === 'visit-draft-1' ? resumeVisitDraft() : resumeInlineTextDraft();
  if (b.id === 'discard-draft') return run(discardVisitDraft, 'editor-error');
  if (b.id === 'discard-draft-banner') return run(discardVisitDraft);
  if (b.dataset.retailGroup !== undefined) return changeStoreFilter('groups', b.dataset.retailGroup);
  if (b.dataset.clearStoreFilters !== undefined) return changeStoreFilter('clear');
  if (b.dataset.add) return openEditor(b.dataset.add);
  if (b.dataset.fillStore) return openFillStore(b.dataset.fillStore);
  if (b.dataset.qualityTab) { qualityTab = b.dataset.qualityTab; qualityPage = 0; return renderQuality(); }
  if (b.dataset.qualityPair) return openQualityPair(b.dataset.qualityPair);
  if (b.dataset.qualityMark) return run(saveQualityReview);
  if (b.dataset.qualityPage) { qualityPage = Math.max(0, qualityPage + Number(b.dataset.qualityPage)); return renderQuality(); }
  if (b.id === 'quality-refresh') { qualityCache = null; qualityPage = 0; return renderQuality(); }
  if (b.id === 'export-store-enrichment') return run(exportStoreEnrichmentRequest);
  if (b.id === 'import-store-enrichment') return $('store-enrichment-file').click();
  if (b.dataset.fillSuggestion) { const field = b.dataset.fillSuggestion, suggestion = editorContext?.suggestions?.[field]?.[Number(b.dataset.suggestionIndex)]; if (suggestion && editorContext.fillFields.includes(field)) $('fill-' + field).value = suggestion.value; return; }
  if (b.dataset.edit) return openEditor(...b.dataset.edit.split(':'));
  if (b.dataset.review) return openReview(...b.dataset.review.split(':'), true);
  if (b.dataset.csvSource) return openSources(...b.dataset.csvSource.split(':'));
  if (b.dataset.csvDownload) { if (confirm('原始 CSV 是明文檔案。請確認下載到自己的本機資料夾，避開 iCloud Drive。')) download(unb64(payload.bundle.blobs[b.dataset.csvDownload]), b.dataset.csvFilename.replace(/[\/\\]/g, '_'), 'application/octet-stream'); return; }
  if (b.dataset.history) return openReview(...b.dataset.history.split(':'), false);
  if (b.dataset.delete) return run(() => removeEntity(...b.dataset.delete.split(':')));
  if (b.dataset.restore) return run(async () => { const [type, id] = b.dataset.restore.split(':'), r = by(type, id); if (r.mergedInto && !confirm('此門市曾依已裁定同店規則整併至「' + name('store', r.mergedInto) + '」。還原會重新成為獨立門市，之後必須重新核對身分。確認還原？')) return; await commitRevision(type, id, r.heads[0].data, r.heads.map(h => h.id)); toast('已還原。'); });
  if (b.dataset.useVersion) return run(() => useVersion(b.dataset.useVersion));
  if (b.dataset.mergeVersion) return run(() => editMerge(b.dataset.mergeVersion));
  if (b.dataset.safeConflictPreview !== undefined) return run(previewSafeConflictMerge);
  if (b.dataset.resolutionConfirm !== undefined) return run(confirmResolution, 'resolution-error');
  if (b.dataset.resolutionBack !== undefined) {
    const ctx = resolutionPreview; resolutionPreview = null;
    if (ctx?.fromEditor) return $('review').close();
    if (versionReview) return run(() => { $('review').close(); openReview(versionReview.type, versionReview.id, versionReview.conflict); });
  }
  if (b.dataset.attachment) { const v = by('visit', b.dataset.attachment), a = v.attachments[Number(b.dataset.index)]; download(unb64(payload.bundle.blobs[a.blob]), a.name.replace(/[\/\\]/g, '_'), 'application/octet-stream'); return; }
  if (b.dataset.graphPage) { graphPage = Math.max(0, graphPage + Number(b.dataset.graphPage)); drawGraph(); return; }
  if (b.id === 'import-coordinates') return $('coordinate-file').click();
  if (b.id === 'apply-coordinates') return run(commitCoordinates);
  if (b.id === 'apply-store-enrichment') return run(commitStoreEnrichment);
  if (b.id === 'nearby-retry') return requestNearbyPosition(true);
  if (b.id === 'new-note') return openEditor('visit');
  if (b.id === 'back-node') { const previous = trail.pop(); if (previous) navigate(previous.type, previous.id, false); return; }
  if (b.id === 'candidate-overview') return openCandidateOverview();
  if (b.dataset.candidateStore) { if (singleStoreContext) return toast('請先完成或收起這次拜訪紀錄，再切換門市。'); $('review').close(); return navigate('store', b.dataset.candidateStore); }
  if (b.id === 'data-safety-open') {
    if (inlineTextContext || editorContext || singleStoreContext || reminderContext) return toast('請先完成或收起目前編輯，再查看資料安全狀態。');
    switchView('sync'); focusReadingSurface($('sync-health-card')); $('sync-health-card').scrollIntoView({ block: 'start' }); return;
  }
  if (b.id === 'conflict-link') return switchView('sync');
  if (['sync-button', 'sync-now'].includes(b.id)) {
    if (!payload.token) return toast('請先在「資料與安全」重新配對 Mac；本機資料仍保留。');
    if (navigator.onLine === false) { syncScheduler.request('manual'); return toast('目前離線；已排入同步，恢復連線且完成編輯後會再確認。'); }
    if (!canAutoSync()) { syncScheduler.request('manual'); return toast(autoFetching || syncInProgress ? '正在確認同步，請稍候。' : '已排入同步；請保持連線，完成或收起目前編輯後會再確認。'); }
    return run(async () => {
      try { await synchronize(); syncScheduler.confirmed(); toast(`同步成功：${dateText(payload.lastSync)}。另一台裝置連線同步後會接收更新。`); }
      catch (e) { if (e.code === 'sync-paused') syncScheduler.request('foreground'); else { recordSyncFailure(e); syncScheduler.failed(); } throw e; }
    });
  }
  if (b.id === 'check-connection') return run(checkConnection);
  if (b.id === 'run-health-audit') return run(async () => { await runPeriodicHealthAudit(true); toast('唯讀健檢已重新完成；沒有修改任何客戶紀錄。'); });
  if (b.id === 'export-backup') return run(exportBackup);
  if (b.id === 'import-backup') return $('backup-file').click();
  if (b.id === 'repair-pair') return openRepairPair();
});
document.addEventListener('keydown', e => { const n = e.target.closest('.node[role="button"]'); if (n && ['Enter', ' '].includes(e.key) && !busy) { e.preventDefault(); if (n.dataset.candidateKey) openCandidateDetail(n.dataset.candidateKey, n.dataset.candidateStore || ''); else navigate(n.dataset.nodeType, n.dataset.nodeId); } });
document.addEventListener('focusin', event => { const editor = event.target.closest?.('[data-inline-edit-text]'); if (editor) beginInlineTextEdit(editor.dataset.inlineEditText, editor); });
document.addEventListener('beforeinput', blockInlineTextBeforeInput);
document.addEventListener('invalid', showValidationWithoutKeyboard, true);
document.addEventListener('focusin', event => { if (event.target.closest?.('#review [data-inline-edit-text]')) refreshBriefSearch(); });
document.addEventListener('focusout', event => { if (event.target.closest?.('[data-inline-edit-text]')) queueMicrotask(() => { releaseIdleInlineEdit(); refreshBriefSearch(); }); });
document.addEventListener('beforeinput', event => { if (event.target.closest?.('#review [data-inline-edit-text]')) { clearTimeout(briefSearchTimer); clearBriefSearchHighlights(); } });
document.addEventListener('compositionstart', event => { if (event.target.closest?.('#review [data-inline-edit-text]')) clearBriefSearchHighlights(); });
document.addEventListener('input', event => {
  const editor = event.target.closest?.('[data-inline-edit-text]'); if (editor) { updateInlineText(editor.dataset.inlineEditText, editor); refreshBriefSearch(); }
  const custom = event.target.closest?.('[data-reminder-custom-input]'); if (custom) changeCustomReminderOption(custom.closest('[data-reminder-options-for]'));
  if (event.target.id) document.querySelectorAll(`[data-reminder-options-for="${CSS.escape(event.target.id)}"]`).forEach(syncReminderOptionGroup);
});
document.addEventListener('change', event => {
  const task = event.target.closest?.('[data-reminder-complete]');
  if (task) { task.checked = false; return run(() => changeReminderTask(task.dataset.reminderStore, task.dataset.reminderComplete, task.dataset.reminderHead)); }
  const option = event.target.closest?.('[data-reminder-option]'); if (option) return changeReminderOption(option);
  const toggle = event.target.closest?.('[data-reminder-custom-toggle]'); if (toggle) changeCustomReminderOption(toggle.closest('[data-reminder-options-for]'), toggle.checked);
});
document.addEventListener('visibilitychange', () => {
  dismissKeyboard();
  if (document.hidden) { syncEpoch++; syncScheduler.pause(); finishAttendancePrompt(); clearNearbyPosition(); if (editorContext?.type === 'visit' || singleStoreContext) void flushVisitDraft(); if (inlineTextContext) void flushInlineTextDraft(); if (activeReminderDraftContext()) void flushReminderDraft().catch(() => {}); document.body.classList.add('privacy-veil'); if (payload || busy || backupPreview) lockNow(false); }
  else if (pendingLock || !payload) { pendingLock = false; document.body.classList.remove('privacy-veil'); showGate(); }
  else { document.body.classList.remove('privacy-veil'); requestNearbyPosition(); }
  if (!document.hidden) syncScheduler.request('foreground');
});
window.addEventListener('pagehide', () => { syncEpoch++; syncScheduler.pause(); finishAttendancePrompt(); dismissKeyboard(); clearNearbyPosition(); if (editorContext?.type === 'visit' || singleStoreContext) void flushVisitDraft(); if (inlineTextContext) void flushInlineTextDraft(); if (activeReminderDraftContext()) void flushReminderDraft().catch(() => {}); if (payload || busy || backupPreview) lockNow(false); });
window.addEventListener('pageshow', () => { dismissKeyboard(); if (!payload && !document.hidden) { document.body.classList.remove('privacy-veil'); showGate(); } if (!document.hidden) syncScheduler.request('foreground'); });
window.addEventListener('online', () => syncScheduler.request('online'));
window.addEventListener('offline', () => syncScheduler.pause());
$('visit-attendance-form').addEventListener('submit', event => {
  event.preventDefault(); if (!attendancePrompt) return;
  const at = new Date().toISOString(), date = attendanceTaipeiDate(at);
  if (date !== attendancePrompt.date) {
    attendancePrompt.date = date; $('visit-attendance-date').textContent = date + '（台北時間）';
    $('visit-attendance-check').checked = false;
    $('visit-attendance-error').textContent = '日期已跨日，請重新核對今天是否實際拜訪，再確認儲存。'; return;
  }
  finishAttendancePrompt({ attendance: $('visit-attendance-check').checked ? makeVisitAttendance(attendancePrompt.storeId, at) : undefined });
});
$('visit-attendance-cancel').addEventListener('click', () => finishAttendancePrompt());
$('visit-attendance-dialog').addEventListener('cancel', event => { event.preventDefault(); finishAttendancePrompt(); });
$('visit-attendance-dialog').addEventListener('close', () => { if (!$('visit-attendance-dialog').open) finishAttendancePrompt(); });
$('gate-form').addEventListener('submit', initializeOrUnlock); $('editor-form').addEventListener('submit', saveEditor); $('quick-text-form').addEventListener('submit', saveQuickTextEdit); $('store-reminder-form').addEventListener('submit', saveStoreReminder);
$('review').addEventListener('submit', event => {
  if (event.target.id === 'single-store-capture-form') saveSingleStoreVisit(event);
  if (event.target.id === 'repair-pair-form') {
    event.preventDefault(); void run(async () => {
      try { await repairPair($('repair-pair-code').value); $('review').close(); }
      catch (error) { if (error.code !== 'sync-paused') { recordSyncFailure(error); syncScheduler.failed(); } throw error; }
    }, 'repair-pair-error');
  }
});
$('brief-search').addEventListener('input', scheduleBriefSearch);
$('brief-search').addEventListener('compositionstart', () => { if (briefSearchContext) { briefSearchContext.composing = true; clearTimeout(briefSearchTimer); clearBriefSearchHighlights(); } });
$('brief-search').addEventListener('compositionend', () => { if (briefSearchContext) { briefSearchContext.composing = false; scheduleBriefSearch(); } });
$('brief-search').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || briefSearchContext?.composing) return;
  event.preventDefault(); moveBriefSearch(event.shiftKey ? -1 : 1);
});
$('brief-search-prev').addEventListener('click', () => moveBriefSearch(-1));
$('brief-search-next').addEventListener('click', () => moveBriefSearch(1));
$('brief-search-clear').addEventListener('click', () => {
  if (busy || updateHolding || briefSearchBlocked()) return;
  forgetBriefSearchQuery(); focusReadingSurface($('review'));
});
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => queueMicrotask(() => { releaseDialogBackground(); syncScheduler.wake(); })));
$('editor').addEventListener('close', () => {
  if ($('editor').open) return;
  if (editorContext?.reminderDraftContext) { openDialog($('editor')); if (!busy) void run(closeStoreReminderEditor, 'editor-error'); }
  else editorContext = null;
});
$('editor').addEventListener('cancel', event => { if (editorContext?.reminderDraftContext) { event.preventDefault(); if (!busy) void run(closeStoreReminderEditor, 'editor-error'); } });
$('review').addEventListener('close', () => { if (!$('review').open) { setReviewMode(''); if ($('repair-pair-code')) $('repair-pair-code').value = ''; } });
$('quick-text-dialog').addEventListener('close', () => { quickTextContext = null; $('quick-text-error').textContent = ''; });
$('quick-text-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('store-reminder-dialog').addEventListener('cancel', event => { event.preventDefault(); if (!busy) void run(closeStoreReminder, 'store-reminder-error'); });
$('store-reminder-dialog').addEventListener('close', () => {
  if ($('store-reminder-dialog').open) return;
  if (reminderContext) { openDialog($('store-reminder-dialog')); if (!busy) void run(closeStoreReminder, 'store-reminder-error'); }
  else $('store-reminder-error').textContent = '';
});
for (const event of ['input', 'change']) $('store-reminder-form').addEventListener(event, scheduleReminderDraftSave);
for (const type of ['input', 'change']) $('editor-fields').addEventListener(type, event => {
  if (editorContext?.reminderDraftContext && (['f-next-remember', 'f-every-time-must'].includes(event.target.id) || event.target.closest?.('[data-reminder-options-for], [data-reminder-convert]'))) scheduleReminderDraftSave();
});
$('editor-fields').addEventListener('input', event => {
  if (event.target.id === 'f-store-search') { refreshVisitStoreOptions(event.target.value); return; }
  if (editorContext?.type === 'visit' && event.target.id !== 'f-files') scheduleVisitDraftSave();
});
$('editor-fields').addEventListener('change', event => { if (event.target.id === 'f-store') toggleQuickStoreFields(); if (editorContext?.type === 'visit' && !['f-files', 'f-store-search'].includes(event.target.id)) scheduleVisitDraftSave(); });
$('review').addEventListener('input', event => { if (singleStoreContext && event.target.closest('#single-store-capture-form') && event.target.id !== 'single-store-files') scheduleVisitDraftSave(); });
$('review').addEventListener('change', event => { if (singleStoreContext && event.target.closest('#single-store-capture-form') && event.target.id !== 'single-store-files') scheduleVisitDraftSave(); });
$('quality-content').addEventListener('change', e => { if (e.target.id === 'quality-field') { qualityField = e.target.value; qualityPage = 0; renderQuality(); } });
$('gate-restore').addEventListener('click', () => { if (!$('password').value) { $('gate-error').textContent = '請先在密碼欄填寫備份密碼。'; return; } $('backup-file').click(); });
$('backup-file').addEventListener('change', () => { const f = $('backup-file').files[0]; if (f) run(() => importBackup(f), payload ? null : 'gate-error'); $('backup-file').value = ''; });
$('backup-review-body').addEventListener('click', event => {
  if (busy) return;
  const page = event.target.closest('[data-backup-page]'), warning = event.target.closest('[data-backup-warning-page]');
  if (page) renderBackupChanges(Number(page.dataset.backupPage));
  if (warning) renderBackupWarnings(Number(warning.dataset.backupWarningPage));
});
$('backup-review-body').addEventListener('toggle', event => {
  const detail = event.target;
  if (!backupPreview || !detail.open || !detail.matches('[data-backup-change]') || detail.dataset.loaded) return;
  const change = backupPreview.plan.changes[Number(detail.dataset.backupChange)];
  if (change) { detail.querySelector('div').innerHTML = backupChangeHTML(change); detail.dataset.loaded = '1'; }
}, true);
$('backup-ack').addEventListener('change', updateBackupControls);
$('backup-apply').addEventListener('click', () => run(applyBackupPreview, 'backup-error'));
$('backup-review').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('backup-review').addEventListener('close', clearBackupPreview);
$('rebuild-connect-form').addEventListener('submit', adoptRebuilt);
$('rebuild-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); else $('rebuild-connect-form').reset(); });
for (const prefix of ['', 'customer-']) for (const [id, field] of [['search', 'query'], ['district', 'district'], ['channel', 'kind']]) $(prefix + id).addEventListener(id === 'search' ? 'input' : 'change', event => changeStoreFilter(field, event.target.value));
$('regional-city').addEventListener('change', event => { regionalCity = event.target.value; regionalDistrict = ''; renderRegional(); });
$('regional-district').addEventListener('change', event => { regionalDistrict = event.target.value; renderRegional(); });
$('visit-search').addEventListener('input', renderVisits);
new ResizeObserver(drawGraph).observe($('graph-wrap'));
if (!isSecureContext || !crypto.subtle) { $('gate-error').textContent = '需要受信任的 HTTPS 連線。請完成 Mac 與 iPhone 憑證設定，不要略過憑證警告。'; $('gate-submit').disabled = true; }
else {
  showGate();
  const draftBusy = () => busy || gateOpening || !!backupPreview || !!editorContext || !!inlineTextContext || !!reminderContext || !!payload?.inlineTextDraft || $('review').open || $('quick-text-dialog')?.open || $('store-reminder-dialog')?.open || $('rebuild-dialog')?.open || csvImport.hasPending() || (!$('gate').hidden && [...$('gate-form').querySelectorAll('input')].some(el => el.value && !['device-name'].includes(el.id)));
  for (const name of ['click', 'submit', 'keydown', 'beforeinput']) document.addEventListener(name, event => { if (updateHolding && event.target.closest('button,input,select,textarea,form,a')) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  startUpdates({ api, hasToken: () => !!payload?.token, isBusy: draftBusy, setHold: held => { updateHolding = held; if (held) { syncEpoch++; syncScheduler.pause(); } else syncScheduler.wake(); document.body.classList.toggle('update-holding', held); }, notify: toast, onOfflineReady: () => { offlineReady = true; $('secure-state').textContent = '離線介面已備妥。iPhone 請先加入主畫面，再從主畫面進行配對。'; status(); } });
  if (location.hostname === 'localhost') $('secure-state').textContent = '請使用 Mac 顯示的 .local 網址開啟 App，管理頁才使用 localhost。';
}

$('review').addEventListener('change', event => { if (event.target.id === 'conflict-baseline') run(() => { versionReview.baseline = event.target.value; renderConflictReview(); }); });
$('review').addEventListener('cancel', event => {
  if (busy) { event.preventDefault(); return; }
  if (singleStoreContext) { event.preventDefault(); void run(closeSingleStoreReview, 'single-store-error'); }
});

$('coordinate-file').addEventListener('change', () => { const file = $('coordinate-file').files[0]; $('coordinate-file').value = ''; if (file) run(() => previewCoordinateFile(file)); });
$('store-enrichment-file').addEventListener('change', () => { const file = $('store-enrichment-file').files[0]; $('store-enrichment-file').value = ''; if (file) run(() => previewStoreEnrichmentFile(file)); });
$('review').addEventListener('close', () => { coordinatePreview = null; });
