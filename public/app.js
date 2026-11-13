import { peopleBriefSourcePlan, validatePeopleBriefResult, currentPeopleReading, peopleReadingRequest, preparePeopleReading, applyPeopleReading, planPeopleRelationshipReview, applyPeopleRelationshipReview, peopleAliasLayout, peopleAliasReviewAvailability, peopleRelationshipReviewAvailability, planPeopleAliasReview, applyPeopleAliasReview } from './relations.js';
import { peopleRelationshipReviewState, peopleAliasGroups, peopleAliasReviewState } from './core.js';
import { exportTypedFeedback, YQ_CORE_CHECKS, typedFeedbackState, prepareTypedFeedback, typedFeedbackAnswers, applyTypedVisit, parseMonthlyAnalysisDocument, analysisStoreCodeChoices, revokeAnalysisStoreCode, monthlyAlertSalesMonths, monthlyAnalysisSources, monthlyAnalysisForStore, prepareMonthlyAnalysis, applyMonthlyAnalysis, monthlyFeedbackState, prepareMonthlyFeedback, applyMonthlyFeedback, applyMonthlyFeedbackWithAttendance, rememberedMonthlyAnalysisChoice, exportMonthlyFeedback, monthlyAnalysisChangeSummary } from './core.js';
import { supervisorRelationships, supervisorReviewHistory, reviewSupervisorRelationship, planStoreSupervision, applyStoreSupervision, supervisedStores } from './core.js';
import { setupWeeklyRecovery, prepareWeeklyRecovery, createRecoveryBackup, newMeta, checkEnvelope, derive, seal, unseal, planBackupImport, uuid, emptyBundle, revision, project, merge, validateBundle, hashBytes, b64, unb64, MAX_BYTES, openRebuiltSnapshot, diffTextSegments, mobileLocationDevice, validCoordinates, nearestStores, storeCoordinates, nearbyCoordinateEvidence, planNearbyCoordinates, applyNearbyCoordinates, buildStoreEnrichmentRequest, planStoreEnrichment, applyStoreEnrichment, readonlyHealthAudit, dataSafetySummary, NEXT_REMINDER_OPTIONS, reminderHasOption, setReminderOption, reminderTaskLines, editReminderTasks, addReminderTasks, convertReminderTasks, completeReminderTask, reminderTaskHistory, searchStoreVisitText, scanInsightChanges, storeInsightDisplayForStore, storeInsightEvidenceForEntry, insightReviewForEntry, insightSharedReviewForEntry, storeInsightReviewHistory, planInsightReview, applyInsightReview, planStoreInsights, applyStoreInsights, planStoreInsightRelations, applyStoreInsightRelations, buildStoreInsightsSource, planStoreMerge, applyStoreMerge } from './core.js';
import { readWeeklyRecovery, writeWeeklyRecovery, readLocal, writeLocal, archiveAndReplaceLocal, listLocalArchives, readLocalArchive } from './db.js';
import { dayPlanDate, shiftDayPlanDate, dayPlanForStore, dayPlanOverview, dayItineraryBasis, applyDayItineraryAction } from './core.js';
import { monthlyVisitMonth, shiftMonthlyVisitMonth, monthlyVisitForStore, monthlyVisitOverview, monthlyVisitBasis, applyMonthlyVisitAction } from './core.js';
import { createCSVImport } from './csv-ui.js';
import { PROFILE_FIELDS, FILL_FIELDS, scanQuality, setDistinctReview, sourceSuggestions, fillProfile, csvSourceSupplements, sourceListKey } from './csv.js';
import { entityRule, evidenceKind, sourceTags, groupCSVNotes, storeIdentityPending, relationVisitAllowed, retailChannel, originalStoreNames, filterStoreDirectory, candidateRelationsForStore, candidateOverview, candidateTrend, visitBriefForStore, regionalOptions, regionalInsights } from './relations.js';
import { APP_VERSION } from './version.js';
import { makeVisitAttendance, visitAttendanceEvidence, visitAttendanceForStore, attendanceTaipeiDate } from './core.js';
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
const titles = { monthly: '每月拜訪', itinerary: '行程與準備', explore: '關聯探索', visits: '拜訪', stores: '門市', regional: '區域觀察', entities: '人物與主題', csv: '匯入 CSV', quality: '資料整理', sync: '資料與安全', trash: '回收桶' };
const kinds = { store: '門市', visit: '拜訪', person: '人物', topic: '主題' };
// Supervisor notes stay on the person entity; drafts stay encrypted on this device.
let supervisorDraftTimer = null, supervisorDraftChain = Promise.resolve(), supervisorDraftGeneration = 0;
let supervisorRelationCache = null;
const supervisorReviewLabels = {confirmed:'確定',rejected:'否定',pending:'待確認'};
function supervisorNoteDraft(id) {
  const d = editorContext?.type === 'supervisor-inline' ? editorContext : payload?.supervisorDraft;
  return d?.id===id && d?.vaultId===payload?.bundle.vaultId ? d : null;
}
function supervisorDraftStatus(message) { if($('supervisor-note-status')) $('supervisor-note-status').textContent=message; }
function supervisorRelationEntries(personId) {
  if(!payload) return [];
  if(supervisorRelationCache?.bundle!==payload.bundle) supervisorRelationCache={bundle:payload.bundle,people:new Map(),at:Date.now()};
  if(!supervisorRelationCache.people.has(personId)) supervisorRelationCache.people.set(personId,supervisorRelationships(payload.bundle,personId));
  return supervisorRelationCache.people.get(personId);
}
function supervisorRelationshipTick() {
  if (!canScanInsights() || editorContext || payload?.supervisorDraft) return;
  if(supervisorRelationCache?.bundle===payload.bundle && Date.now()-supervisorRelationCache.at<INSIGHT_SCAN_INTERVAL) return;
  const next={bundle:payload.bundle,people:new Map(),at:Date.now()};
  for(const p of all('person').filter(p=>p.supervisorKey && !p.conflict)) next.people.set(p.id,supervisorRelationships(payload.bundle,p.id));
  supervisorRelationCache=next;
  if(!document.hidden && activeView==='explore' && focus.type==='person' && by('person',focus.id)?.supervisorKey && !document.querySelector('dialog[open]')) renderFocus();
}
function supervisorRelationCard(entry, person, interactive=true) {
  return `<article class="relation-value-card"><span class="relation-kicker">跨店筆記候選</span><h4>${esc(entry.title)}</h4><p class="relation-value"><strong>拜訪價值</strong>${esc(entry.value)}</p><details class="relation-evidence"><summary>查看兩邊筆記依據</summary>${entry.evidence.map(s=>`<div><strong>${esc(s.label)}</strong><blockquote>${esc(s.text)}</blockquote><small>引用版本：${esc(s.revisionId)}</small></div>`).join('')}</details>${interactive?`<div class="relation-review-actions" aria-label="關係審視">${Object.entries(supervisorReviewLabels).map(([status,label])=>`<button type="button" ${status==='confirmed'?'class="primary"':''} data-supervisor-review="${status}" data-review-entry="${esc(entry.id)}" data-review-person="${esc(person.id)}" data-review-head="${esc(person.heads[0].id)}" data-review-basis="${esc(entry.basis)}" data-review-revisions="${esc(JSON.stringify(entry.evidence.map(s=>s.revisionId)))}">${label}</button>`).join('')}</div>`:''}</article>`;
}
function supervisorRelationsHTML(person) {
  const entries=supervisorRelationEntries(person.id), events=supervisorReviewHistory(payload.bundle,person.id), latest=new Map();
  for(const e of events) latest.set(e.entry.id,e);
  const fresh=entries.filter(e=>!latest.has(e.id));
  const changed=entries.filter(e=>latest.has(e.id) && latest.get(e.id).entry.basis!==e.basis);
  const groups=Object.keys(supervisorReviewLabels).filter(s=>s!=='rejected').map(status=>{
    const reviewed=[...latest.values()].filter(e=>e.status===status);
    return reviewed.length?`<details class="relation-reviewed-group" data-relation-group="${status}"><summary>${status==='confirmed'?'已確定':'待確認'} · ${reviewed.length}</summary>${reviewed.map(e=>{const current=entries.find(c=>c.id===e.entry.id && c.basis===e.entry.basis);return supervisorRelationCard(e.entry,person,!!current)+(current?'':'<p class="muted">保留當時判斷；目前來源已變更或不再符合候選規則。</p>');}).join('')}</details>`:'';
  }).join('');
  return `<section class="simple-relations"><div class="relation-heading"><h3>關係紀錄</h3><span>${fresh.length?'新線索 '+fresh.length:changed.length?'來源有變化 '+changed.length:'尚無新線索'}</span></div><p class="relation-intro">以明確連結、唯一已核對姓名或手動主題，比對實際筆記。共同提及是候選，不直接認定人際關係。</p>${fresh.slice(0,1).map(e=>supervisorRelationCard(e,person)).join('')}${fresh.length>1?`<details><summary>其他新線索 · ${fresh.length-1}</summary>${fresh.slice(1).map(e=>supervisorRelationCard(e,person)).join('')}</details>`:''}${changed.length?`<details class="relation-change-notice"><summary>新依據待查看 · ${changed.length}（原判斷保留）</summary>${changed.map(e=>supervisorRelationCard(e,person)).join('')}</details>`:''}${groups}${events.length?`<details class="relation-review-history"><summary>審視歷史 · ${events.length}（含否定）</summary>${events.slice().reverse().map(e=>`<section><strong>${supervisorReviewLabels[e.status]} · ${esc(dateText(e.at))}</strong>${supervisorRelationCard(e.entry,person,false)}</section>`).join('')}${[...latest.values()].filter(e=>e.status==='rejected').map(e=>entries.find(c=>c.id===e.entry.id && c.basis===e.entry.basis)).filter(Boolean).map(e=>supervisorRelationCard(e,person)).join('')}</details>`:''}<p id="supervisor-relation-error" class="error" role="alert"></p></section>`;
}
function renderSupervisorDraftBanner() {
  let banner=$('supervisor-draft-banner');
  if(!banner){banner=document.createElement('aside');banner.id='supervisor-draft-banner';banner.className='panel';$('workspace').querySelector('main').prepend(banner);}
  const draft=payload?.supervisorDraft;
  banner.hidden=!draft || draft.vaultId!==payload?.bundle.vaultId;
  if(!banner.hidden) banner.innerHTML=`督導筆記有未完成的本機加密草稿。<button type="button" data-supervisor-resume="${esc(draft.id)}">繼續輸入</button>`;
}
async function flushSupervisorDraft() {
  clearTimeout(supervisorDraftTimer);supervisorDraftTimer=null;
  const d=editorContext?.type==='supervisor-inline'?structuredClone(editorContext):null, generation=supervisorDraftGeneration, sessionKey=key;
  supervisorDraftChain=supervisorDraftChain.catch(()=>{}).then(async()=>{
    if(!d || generation!==supervisorDraftGeneration || !payload || key!==sessionKey || payload.bundle.vaultId!==d.vaultId) return;
    await persist({...payload,supervisorDraft:d},{guard:()=>{if(key!==sessionKey || generation!==supervisorDraftGeneration)throw new Error('草稿工作階段已變更。');}});
    supervisorDraftStatus('草稿已加密保存在本機，尚未儲存成正式筆記。');renderSupervisorDraftBanner();
  });
  return supervisorDraftChain;
}
document.addEventListener('input',event=>{
  if(!event.target.matches('#supervisor-personal-note,#supervisor-relationship-note'))return;
  const form=$('supervisor-note-form'), person=by('person',form.dataset.person);
  if(!person || busy || updateHolding)return;
  const previous=supervisorNoteDraft(person.id);
  editorContext={type:'supervisor-inline',id:person.id,head:previous?.head||form.dataset.head,vaultId:payload.bundle.vaultId,desc:$('supervisor-personal-note').value,relationshipNotes:$('supervisor-relationship-note').value};
  supervisorDraftGeneration++;supervisorDraftStatus('尚未儲存；正在準備本機加密草稿…');
  clearTimeout(supervisorDraftTimer);supervisorDraftTimer=setTimeout(()=>{void flushSupervisorDraft().catch(e=>supervisorDraftStatus('草稿保存失敗：'+e.message+'；請保留畫面並重試。'));},500);
});
document.addEventListener('click',event=>{
 const b=event.target.closest('button');if(!b)return;
 if(b.dataset.supervisorResume){event.preventDefault();event.stopImmediatePropagation();if(editorContext && editorContext.type!=='supervisor-inline')return toast('先完成目前修改。');navigate('person',b.dataset.supervisorResume);return;}
 if(b.hasAttribute('data-profile-reset')){event.preventDefault();event.stopImmediatePropagation();void run(async()=>{supervisorDraftGeneration++;clearTimeout(supervisorDraftTimer);await supervisorDraftChain.catch(()=>{});await persist({...payload,supervisorDraft:null});if(editorContext?.type==='supervisor-inline')editorContext=null;render();},'supervisor-note-error');return;}
 if((editorContext?.type==='supervisor-inline' || payload?.supervisorDraft) && !b.closest('#supervisor-note-form') && b.id!=='lock'){event.preventDefault();event.stopImmediatePropagation();toast('請先儲存督導筆記，或按「還原未儲存修改」；草稿會保留。');return;}
 if(!b.dataset.supervisorReview)return;
 event.preventDefault();event.stopImmediatePropagation();
 if(editorContext || payload?.supervisorDraft)return toast('先儲存目前筆記，再審視關係。');
 void run(async()=>{
   const ctx=captureCSVSaveContext(),entry=supervisorRelationEntries(b.dataset.reviewPerson).find(e=>e.id===b.dataset.reviewEntry);
   const person=by('person',b.dataset.reviewPerson);
   if(!entry || person?.heads?.[0]?.id!==b.dataset.reviewHead || entry.basis!==b.dataset.reviewBasis || JSON.stringify(entry.evidence.map(s=>s.revisionId))!==b.dataset.reviewRevisions) throw new Error('畫面中的來源或人物已有變更，請重新查看依據再審視。');
   const bundle=reviewSupervisorRelationship(payload.bundle,b.dataset.reviewPerson,entry,b.dataset.supervisorReview,payload.device);
   if(bundle===payload.bundle)return;
   await persist({...payload,bundle,dirty:true},{guard:()=>assertCSVSaveContext(ctx)});render();toast('已記錄「'+supervisorReviewLabels[b.dataset.supervisorReview]+'」，原筆記與歷史保留。');
 },'supervisor-relation-error');
},true);
document.addEventListener('submit',event=>{
 if(event.target.id!=='supervisor-note-form')return;
 event.preventDefault();event.stopImmediatePropagation();
 void run(async()=>{
  await flushSupervisorDraft();
  const form=event.target,person=project(payload.bundle).find(r=>r.type==='person'&&r.id===form.dataset.person),draft=supervisorNoteDraft(form.dataset.person);
  if(!person || person.deleted || person.conflict || person.sameAs || person.heads.length!==1 || person.heads[0].id!==(draft?.head||form.dataset.head))throw new Error('人物已有新版本，原草稿保留；請先複製文字，再核對歷史。');
  const desc=$('supervisor-personal-note').value,relationshipNotes=$('supervisor-relationship-note').value;
  const ctx=captureCSVSaveContext(),bundle=structuredClone(payload.bundle);
  if(desc!==person.desc || relationshipNotes!==(person.relationshipNotes||''))bundle.ops.push(revision('person',person.id,{...person.heads[0].data,desc,relationshipNotes},[person.heads[0].id],payload.device));
  validateBundle(bundle);
  await persist({...payload,bundle,dirty:payload.dirty||bundle.ops.length!==payload.bundle.ops.length,supervisorDraft:null},{guard:()=>assertCSVSaveContext(ctx)});
  supervisorDraftGeneration++;editorContext=null;render();supervisorDraftStatus('已儲存；等待 Mac 同步確認。');
 },'supervisor-note-error');
},true);
window.addEventListener('beforeunload',event=>{if(editorContext?.type==='supervisor-inline'){event.preventDefault();event.returnValue='';}});
function renderSimpleSupervisor(person) {
  const stores=supervisedStores(records,person.id), areas=[...new Set(stores.map(s=>s.supervision.areaName))];
  const draft=supervisorNoteDraft(person.id);
  if (person.conflict || person.deleted || person.sameAs) { $('focus-detail').innerHTML='<p>人物狀態需要核對，原內容保留。</p>'; return; }
  document.body.classList.add('supervisor-simple-page');
  $('explore-view').classList.add('simple-supervisor-view');
  $('page-title').textContent='督導';
  $('focus-header').innerHTML=`<div class="simple-profile-heading"><div><span class="simple-eyebrow">小區督導</span><h2>${esc(person.name)}</h2><p>${esc(areas.join('、'))} · ${stores.length} 間門市</p></div>${supervisorOriginStore ? '<button id="supervisor-return-store" class="text-button">← 返回門市</button>':''}</div>`;
  $('focus-detail').innerHTML=`<section class="simple-store-section"><h3>負責門市 <span>${stores.length}</span></h3><div class="simple-store-links">${stores.map(s=>`<button type="button" data-visit-brief="${esc(s.id)}">${esc(s.name)}</button>`).join('')}</div></section><form id="supervisor-note-form" data-person="${esc(person.id)}" data-head="${esc(person.heads[0].id)}">${supervisorRelationsHTML(person)}<details class="relationship-own-notes"><summary>我補充的關係資訊</summary><p class="muted">可自行新增原始資訊，之後一併納入關聯檢視。</p><textarea id="supervisor-relationship-note" rows="3" maxlength="20000" aria-label="我補充的關係資訊" placeholder="自行補充誰與誰有什麼關係，以及消息來源…">${esc(draft?.relationshipNotes ?? person.relationshipNotes ?? '')}</textarea></details><section class="simple-note-section"><label for="supervisor-personal-note">我的筆記</label><p>記下個人資訊、互動重點或下次想聊的事。</p><textarea id="supervisor-personal-note" rows="5" maxlength="20000" placeholder="在這裡直接新增或修改筆記…">${esc(draft?.desc ?? person.desc ?? '')}</textarea></section><p id="supervisor-note-error" class="error" role="alert"></p><div class="simple-save-row"><span id="supervisor-note-status" role="status">${draft?'尚未儲存':'已儲存的內容顯示於上方'}</span><div><button type="button" data-profile-reset>還原未儲存修改</button><button type="submit" class="primary">儲存筆記與關係</button></div></div></form><div class="simple-profile-history"><button type="button" class="text-button" data-edit="person:${esc(person.id)}">編輯姓名與個人資訊</button> <button type="button" class="text-button" data-history="person:${esc(person.id)}">查看歷史紀錄</button></div>`;
  $('graph').innerHTML='';$('graph-pager').innerHTML='';$('evidence-list').innerHTML='';$('evidence-count').textContent='0';
}



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
function reminderTasksHTML(store, interactive = true, showCompleted = true) {
  const tasks = store.nextRememberTasks || [], pending = tasks.filter(t => !t.completedAt), completed = showCompleted ? reminderTaskHistory(store) : [];
  if (!pending.length && !completed.length) return '';
  const attrs = `data-reminder-store="${esc(store.id)}" data-reminder-head="${esc(store.heads?.[0]?.id || '')}"`;
  return `<section class="reminder-task-list">${pending.length ? `<strong>下次記得：待辦 ${pending.length} 項</strong>` + pending.map(task => `<div class="reminder-task-item"><label class="reminder-task-row"><input type="checkbox" ${interactive ? `data-reminder-complete="${esc(task.id)}" ${attrs}` : 'disabled'} aria-label="完成：${esc(task.text)}"><span>${esc(task.text)}</span></label>${interactive ? `<button type="button" class="text-button reminder-task-edit" data-reminder-task-edit="${esc(task.id)}" ${attrs} aria-label="修改待辦：${esc(task.text)}">修改</button>` : ''}</div>`).join('') : ''}${completed.length ? `<details class="reminder-task-history"><summary>已完成 · ${completed.length} 項</summary>${completed.map(task => `<div class="reminder-task-done"><span>✓ ${esc(task.text)}</span><small>完成：${esc(dateText(task.completedAt))}${task.historical ? ' · 歷史版本紀錄（目前狀態不同）' : ''}</small>${interactive && !task.historical ? `<button type="button" class="text-button" data-reminder-repeat="${esc(task.id)}" ${attrs}>再加入待辦</button>` : ''}</div>`).join('')}</details>` : ''}</section>`;
}
function reminderTaskEditsFromForm(form, retained = []) {
  const edits=new Map(retained.map(e=>[e.id,{...e}]));
  for(const input of form.querySelectorAll?.('[data-reminder-task-text]') || []) {
    const id=input.dataset?.reminderTaskText; if(!id) continue;
    if(input.value===input.dataset.reminderTaskBefore) edits.delete(id); else edits.set(id,{id,text:input.value});
  }
  return [...edits.values()];
}
function reminderTaskEditorHTML(store, edits = []) {
  const pending=(store.nextRememberTasks||[]).filter(t=>!t.completedAt), values=new Map(edits.map(e=>[e.id,e.text]));
  return (pending.length ? `<section class="reminder-task-editor"><h3>修改已儲存待辦</h3><p class="muted">展開要修改的項目；儲存後仍是同一筆待辦，舊文字保留在門市歷史。</p>${pending.map(task=>`<details data-reminder-task-panel="${esc(task.id)}"><summary>${esc(task.text)}</summary><label>待辦文字<textarea rows="3" maxlength="2000" data-reminder-task-text="${esc(task.id)}" data-reminder-task-before="${esc(task.text)}" aria-label="修改待辦文字：${esc(task.text)}">${esc(values.get(task.id)??task.text)}</textarea></label></details>`).join('')}</section>` : '') + reminderTasksHTML({...store,nextRememberTasks:(store.nextRememberTasks||[]).filter(t=>t.completedAt)},false);
}
function legacyReminderDraftHTML(data) {
  const text = data.nextRemember || '', lines = reminderTaskLines(text);
  if (!lines.length) return '';
  return `<section class="reminder-legacy"><strong>既有下次記得（尚未轉成任務）</strong><pre>${esc(text)}</pre><details><summary>轉換預覽：依換行分為 ${lines.length} 項</summary><ol>${lines.map(line => `<li>${esc(line)}</li>`).join('')}</ol><p class="muted">只依換行分項，不猜測逗號、數量或意思；原始文字會留存在轉換來源與門市歷史。</p></details><label class="check"><input type="checkbox" data-reminder-convert>儲存時將以上 ${lines.length} 項轉成待辦</label></section>`;
}
function reminderFormData(data, targetId) {
  const target = $(targetId), convert = target.closest('form').querySelector('[data-reminder-convert]')?.checked;
  const edits=reminderTaskEditsFromForm(target.closest('form'));
  const edited=edits.length ? editReminderTasks(data,edits) : data;
  return addReminderTasks(convert ? convertReminderTasks(edited) : edited, target.value);
}
function confirmReminderChange(before, after) {
  const previous = new Set((before.nextRememberTasks || []).map(t => t.id));
  const added = (after.nextRememberTasks || []).filter(t => !previous.has(t.id));
  const converted = (after.nextRememberImports || []).length > (before.nextRememberImports || []).length;
  const edited=(after.nextRememberTasks||[]).filter(t=>previous.has(t.id) && (before.nextRememberTasks||[]).find(old=>old.id===t.id)?.text!==t.text);
  const everyChanged = (before.everyTimeMust || '') !== (after.everyTimeMust || '');
  const impact = [edited.length ? `修改 ${edited.length} 項待辦（同一筆，保留舊版本）：\n${edited.map(t=>'修改前：'+before.nextRememberTasks.find(old=>old.id===t.id).text+'\n修改後：'+t.text).join('\n\n')}` : '', added.length ? `新增 ${added.length} 項待辦：\n${added.map(t => '□ ' + t.text).join('\n')}` : '', converted ? '既有下次記得將改用任務顯示；完整原始文字與舊版本保留。' : '', everyChanged ? `每次必做、必給\n修改前：${before.everyTimeMust || '（空白）'}\n修改後：${after.everyTimeMust || '（空白）'}` : ''].filter(Boolean);
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
  toast(repeat ? '已新增待辦，先前完成歷史保留。' : '已完成並保留紀錄，可點進門市展開「已完成」查看。');
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
  let previousHeight = viewport?.height || window.innerHeight, fallbackHeight = window.innerHeight;
  let allowViewportReveal = true, lastSelection = null;
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
  function selectionState() {
    const active = document.activeElement;
    // Compare positions only; never read input values, change a Range, or focus a field.
    if (textControl(active)) return [active, active.selectionStart, active.selectionEnd, active.selectionDirection];
    const editor = active?.closest?.('[data-inline-edit-text]'), selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !editor.contains(selection.focusNode)) return null;
    return [editor, selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset, selection.isCollapsed];
  }
  function requestCaretReveal() {
    lastSelection = selectionState(); allowViewportReveal = true; schedule(true);
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
    const shrinking = height < previousHeight - 1;
    previousHeight = height;
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
    // A visual-viewport pan can be Safari's response to our previous scroll.
    // Only an actual keyboard contraction may request another visibility correction.
    const reveal = revealCaret || (viewportChanged && shrinking && allowViewportReveal && !expanding && performance.now() >= suppressSelectionUntil);
    viewportChanged = false;
    // Geometry still follows a closing keyboard, but it must not pull reading back to the caret.
    if (!keyboard || expanding) { revealCaret = false; return; }
    if (pointer) { if (pointer.moved) revealCaret = false; else revealCaret ||= reveal || shrinking; return; }
    revealCaret = false;
    if (!reveal) return;
    lastSelection = selectionState();
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
    // An oversized fallback Range cannot fit both edges. Use one stable edge,
    // rather than alternating between the top and bottom on successive events.
    const delta = caret.height > lower - upper ? caret.top - upper
      : caret.bottom > lower ? caret.bottom - lower : caret.top < upper ? caret.top - upper : 0;
    if (Math.abs(delta) > 1) {
      if (scroller) scroller.scrollTop += delta;
      else window.scrollBy({ top: delta, left: 0, behavior: 'instant' });
    }
  }
  viewport?.addEventListener('resize', () => schedule(false, true), { passive: true });
  viewport?.addEventListener('scroll', () => schedule(false), { passive: true });
  window.addEventListener('resize', () => schedule(false, true), { passive: true });
  window.addEventListener('pageshow', () => schedule(false), { passive: true });
  document.addEventListener('focusin', requestCaretReveal);
  document.addEventListener('focusout', () => schedule(false));
  document.addEventListener('input', requestCaretReveal);
  document.addEventListener('selectionchange', () => {
    const next = selectionState(); if (!next) return;
    const changed = !lastSelection || next.some((value, index) => value !== lastSelection[index]);
    lastSelection = next;
    // Native caret/layout notifications with the same logical selection are not new input.
    if (changed && !pointer && performance.now() >= suppressSelectionUntil) { allowViewportReveal = true; schedule(true); }
  });
  document.addEventListener('pointerdown', event => { pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, target: event.target }; }, { passive: true });
  document.addEventListener('pointermove', event => { if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) { pointer.moved = true; revealCaret = false; allowViewportReveal = false; } }, { passive: true });
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, () => {
    const moved = pointer?.moved, target = pointer?.target; pointer = null;
    if (moved || type === 'pointercancel') { revealCaret = false; allowViewportReveal = false; suppressSelectionUntil = performance.now() + 250; }
    else if (target === document.activeElement && (textControl(target) || target?.closest?.('[data-inline-edit-text]'))) requestCaretReveal();
    else if (revealCaret) schedule(true);
  }, { passive: true });
  document.addEventListener('wheel', () => { allowViewportReveal = false; revealCaret = false; suppressSelectionUntil = performance.now() + 250; }, { passive: true });
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
let recoveryExportContext = null;
let weeklyContext = null, weeklyState = null, weeklyRunning = false, weeklyRetryAt = 0;
let coordinatePreview = null, enrichmentPreview = null, backupPreview = null, insightsPreview = null;
let storeMergePreview = null, storeMergeSetup = null;
let dayPlanSelectedDate = '', dayPlanContext = null, dayPlanSorting = false, dayPlanViewBasis = '', dayPlanNotice = '', dayPlanUndo = null;
let analysisImport = null;
let monthlyFeedbackContext = null;
let monthlyVisitSelectedMonth = '', monthlyVisitContext = null, monthlyVisitViewBasis = '', monthlyVisitNotice = '';
let reminderDraftTimer = null, reminderDraftSaveChain = Promise.resolve();
let attendancePrompt = null, attendanceCache = null;
let localSaveState = 'unknown', syncInProgress = false, syncEpoch = 0;
const syncScheduler = createSyncScheduler({ ready: canAutoSync, attempt: autoSync, onChange: renderDataSafetyEntry });
function storeAttendance(storeId) {
  const today = attendanceTaipeiDate(Date.now());
  if (attendanceCache?.bundle !== payload.bundle || attendanceCache.today !== today) {
    const grouped = new Map();
    for (const op of payload.bundle.ops) {
      const attendance = visitAttendanceEvidence(op); if (!attendance) continue;
      const id = attendance.store;
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
  return `<div class="store-attendance">${esc(text)}${history && summary.history.length ? `<details class="attendance-history"><summary>已確認拜訪日 · ${summary.history.length} 天</summary><p class="muted">以台北日期計算；同日多次勾選合併顯示，以下保留每次確認來源。</p>${summary.history.map(day => `<section data-attendance-date="${esc(day.date)}"><strong>${esc(day.date)}</strong>${day.occurrences.map(item => `<p>${esc(new Date(item.at).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }))} · ${item.type === 'visit' ? '拜訪筆記儲存時確認' : item.type === 'source' ? '現場回報儲存時人工確認' : '門市資料／待辦儲存時確認'}<small>來源版本：${esc(item.revisionId)}</small></p>`).join('')}</section>`).join('')}</details>` : ''}</div>`;
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
async function confirmStoreSave(storeId, storeName, changed = true, scope = '') {
  // Complete draft writes first; no formal data is committed while the prompt is open.
  await Promise.all([draftSaveChain, inlineDraftSaveChain, reminderDraftSaveChain]);
  if (!payload || document.hidden || pendingLock) throw new Error('請先回到 App 解鎖後再儲存，原修改仍保留。');
  const sessionKey = key, bundle = payload.bundle;
  const currentStore = project(bundle).find(record => record.type === 'store' && record.id === storeId);
  if (currentStore && (currentStore.deleted || currentStore.conflict)) throw new Error('門市已刪除或有衝突，本次沒有寫入；請先核對門市。');
  const dialog = $('visit-attendance-dialog');
  $('visit-attendance-check').checked = false;
  $('visit-attendance-store').textContent = storeName;
  $('visit-attendance-scope').textContent = scope || (changed ? '確認後才儲存剛才的修改。未勾選代表單純更新資料，不改變最近實際拜訪日期。' : '內容沒有變更。勾選後只新增本次實際拜訪的確認紀錄；未勾選則不寫入任何資料。');
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
const csvImport = createCSVImport({ host: $('csv-view'), getState: () => payload, getSaveContext: captureCSVSaveContext, run, saveBundle: saveCSVBundle, openDialog: dialog => openDialog(dialog), onDialogClose: () => queueMicrotask(() => { releaseDialogBackground(); syncScheduler.wake(); }), notify: toast, exportReport: report => download(JSON.stringify({ ...report, appVersion: APP_VERSION }, null, 2), 'pharmacy-import-preview.json', 'application/json'), downloadSource: (blob, filename) => { if (!confirm('原始 CSV 是明文檔案。請確認下載到自己的本機資料夾，避開 iCloud Drive。')) return; download(unb64(payload.bundle.blobs[blob]), filename.replace(/[\/\\]/g, '_'), 'application/octet-stream'); } });
// Bind CSV confirmation and encryption to the same foreground device session.
function captureCSVSaveContext() {
  const ctx = { payload, key, meta, bundle: payload?.bundle, revision: localRevision, epoch: syncEpoch, token: payload?.token, device: payload?.device };
  assertCSVSaveContext(ctx);
  return ctx;
}
function assertCSVSaveContext(ctx) {
  if (!ctx || !payload || !key || !meta || payload !== ctx.payload || key !== ctx.key || meta !== ctx.meta || payload.bundle !== ctx.bundle || localRevision !== ctx.revision || syncEpoch !== ctx.epoch || payload.token !== ctx.token || payload.device !== ctx.device || document.hidden || pendingLock || updateHolding || autoFetching || syncInProgress || gateOpening) throw new Error('CSV 核對期間資料或工作階段已變更，請回到 App 重新預覽；本次尚未寫入。');
}
async function saveCSVBundle(bundle, ctx) {
  const guard = () => assertCSVSaveContext(ctx);
  guard();
  await persist({ ...ctx.payload, bundle, dirty: true }, { guard });
  if (!payload || key !== ctx.key || meta !== ctx.meta || payload.bundle !== bundle || localRevision !== ctx.revision + 1 || syncEpoch !== ctx.epoch || payload.token !== ctx.token || payload.device !== ctx.device || document.hidden || pendingLock || updateHolding || autoFetching || syncInProgress || gateOpening) throw new Error('CSV 本機保存已完成，但畫面或工作階段已改變；請重新開啟核對保存結果。');
  render();
}
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
  document.querySelectorAll('button, [data-reminder-complete], #csv-view input, #csv-view select, #regional-view select, #supervisor-note-form textarea, #editor input, #editor select, #editor textarea, #review input, #review select, #review textarea, #store-reminder-dialog input, #store-reminder-dialog textarea, #backup-ack, #day-plan-dialog input, #day-plan-dialog select, #day-plan-dialog textarea, #itinerary-view input, #monthly-view input, #monthly-visit-dialog input, #monthly-analysis-dialog input, #monthly-analysis-dialog select, #monthly-analysis-dialog textarea').forEach(el => {
    if (el.dataset.close || el.closest('#visit-attendance-dialog')) return;
    if (disabled) { el.dataset.busyDisabled = el.disabled ? '1' : '0'; el.disabled = true; }
    else if (el.dataset.busyDisabled !== undefined) { el.disabled = el.dataset.busyDisabled === '1'; delete el.dataset.busyDisabled; }
  });
  if (!disabled) { if ($('weekly-download')) $('weekly-download').disabled = !weeklyState?.lastSuccess; updateBackupControls(); refreshBriefSearch(); if (typeof updateStoreMergeControls === 'function') updateStoreMergeControls(); }
}
async function run(fn, errorTarget) {
  if (busy || updateHolding) return;
  busy = true; buttons(true);
  try { if (errorTarget) $(errorTarget).textContent = ''; await fn(); }
  catch (e) { if (errorTarget && $(errorTarget)) $(errorTarget).textContent = e.message; else toast(e.message); }
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
async function persist(next, { guard = null } = {}) {
  if (guard) guard();
  const previous = payload, sessionKey = key, sessionMeta = meta, expected = localRevision;
  const formalChange = hasNewFormalChanges(previous, next) && !syncInProgress;
  next = withPendingSync(previous, next);
  localSaveState = 'saving'; renderDataSafetyEntry();
  try {
    const envelope = await seal(next, sessionKey, sessionMeta, 'device');
    if (key !== sessionKey || meta !== sessionMeta || payload !== previous || localRevision !== expected) throw new Error('儲存期間資料或工作階段已變更，本次沒有覆蓋較新的內容；請重試。');
    if (guard) guard();
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
  if (!previous || !next?.dirty || previous.bundle === next.bundle || previous.bundle?.vaultId !== next.bundle?.vaultId) return false;
  const before = new Set(previous.bundle.ops.map(op => op.id));
  return next.bundle.ops.some(op => !before.has(op.id));
}
function withPendingSync(previous, next) {
  if (!next.dirty) return { ...next, pendingSync: { entities: [], unknown: false } };
  const entities = new Set(Array.isArray(previous?.pendingSync?.entities) ? previous.pendingSync.entities : []);
  if (previous?.bundle !== next.bundle) {
    const before = new Set((previous?.bundle?.ops || []).map(op => op.id));
    for (const op of next.bundle?.ops || []) if (!before.has(op.id)) entities.add(op.type + ':' + op.entity);
  }
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
  if (el.textContent !== message) el.textContent = message;
  if (el.dataset.state !== state) el.dataset.state = state;
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
  const coordinateEvidence = nearbyCoordinateEvidence(payload.bundle);
  const located = ready ? nearestStores(available, nearbyState.position, NEARBY_STORE_LIMIT, coordinateEvidence) : [];
  const missing = available.filter(s => !storeCoordinates(s, coordinateEvidence));
  const coverage = available.length - missing.length;
  const title = $('quick-visit-title'), status = $('nearby-status'), retry = $('nearby-retry');
  title.textContent = mobile ? (ready && missing.length ? `已定位門市中最近 ${located.length} 間` : `附近最近 ${ready ? located.length : NEARBY_STORE_LIMIT} 間門市`) : '最近使用的門市';
  retry.hidden = !mobile; retry.disabled = nearbyState.status === 'locating';
  retry.textContent = nearbyState.status === 'locating' ? '定位中…' : '重新定位';
  let message = mobile ? nearbyState.message : '快速選擇門市開始拜訪；電腦不啟動定位。';
  if (ready) message = located.length
    ? `依直線距離排序（不是行車距離）。${coverage}／${available.length} 間有可用座標${coverage < available.length ? '；缺少座標的門市未參與排序，可能另有更近門市' : ''}。定位誤差約 ${Math.round(nearbyState.position.accuracy)} 公尺${nearbyState.position.accuracy > 1000 ? '，目前誤差較大，請重新定位' : ''}。`
    : '已取得定位，但門市缺少可靠座標，尚無法計算附近門市。';
  status.textContent = message || '開啟後會請求定位；只在本機計算距離。';
  const feedback = $('nearby-feedback'), imprecise = ready && located.length > 0 && nearbyState.position.accuracy > 1000;
  feedback.hidden = !mobile || (ready && located.length > 0 && !imprecise && !missing.length);
  feedback.textContent = feedback.hidden ? '' : ready && missing.length ? `${missing.length} 間門市缺少可靠座標，未參與排序，可能有更近門市。${imprecise ? '定位誤差較大，請重新定位。' : ''}` : imprecise ? '定位誤差較大，請重新定位；詳細資訊可展開「定位說明」。' : status.textContent;
  const entries = located.length ? located : recentStores(3).map(store => ({ store }));
  const fallback = mobile && !located.length ? '<p class="nearby-fallback-label">先顯示最近使用的門市（不是距離排序）</p>' : '';
  const missingHTML = mobile && ready && missing.length ? `<details class="nearby-missing"><summary>查看未參與距離排序的 ${missing.length} 間門市</summary><p class="muted">缺少可靠座標，不能猜測距離。可直接開啟門市，或在定位說明載入經核對的座標補查檔。</p>${missing.map(store => `<button type="button" class="text-button" ${storeIdentityPending(store) ? `data-quick-visit="${esc(store.id)}"` : `data-visit-brief="${esc(store.id)}"`}>${esc(store.name)}</button>`).join('')}</details>` : '';
  $('recent-store-list').innerHTML = fallback + entries.map(({ store, distance }) => {
    const range = Number.isFinite(distance) ? (distance < 1000 ? `約 ${Math.round(distance / 10) * 10} 公尺` : `約 ${(distance / 1000).toFixed(1)} 公里`) + ' · 直線距離' : store.district || '地區未提供';
    return `<button type="button" class="recent-store" ${storeIdentityPending(store) ? `data-quick-visit="${esc(store.id)}"` : `data-visit-brief="${esc(store.id)}"`}><strong>${esc(store.name)}${monthlyAlertBadgeHTML(store.id)}</strong><small>${esc(range)}</small>${storeIdentityPending(store) ? '<small>身分待確認 · 直接記錄拜訪</small>' : ''}</button>`;
  }).join('') + missingHTML || '<p class="muted">目前沒有可用門市，可按「新增拜訪」開始記錄。</p>';
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
  const plan = planNearbyCoordinates(payload.bundle, input);
  coordinatePreview = { input, plan, sessionKey }; versionReview = null; resolutionPreview = null;
  $('review-title').textContent = '座標補查：正式套用前預覽';
  $('review-body').innerHTML = `<p>對照目前資料：可新增獨立位置來源 ${plan.changes.length} 間，略過 ${plan.skipped.length} 間。檔案中的歷史清單不代表目前全部門市。</p><p>確認後只新增獨立位置來源，讓附近排序讀取座標；不修改門市主檔或地圖網址。名稱、地址、拜訪文字、人物、原 CSV 與全部歷史均保留。獨立來源會隨既有加密同步傳到其他裝置。</p><p>取消或關閉不寫入任何資料。</p>` +
    plan.changes.map(c => `<article><h3>${esc(c.name)}</h3><p>座標：${esc(c.point.latitude)}, ${esc(c.point.longitude)}；補查時間：${esc(dateText(c.checkedAt))}</p><details><summary>原網址與新網址</summary><p class="coordinate-url">原：${esc(c.before || '未提供')}</p><p class="coordinate-url">新：${esc(c.after)}</p></details></article>`).join('') +
    `<details><summary>略過 ${plan.skipped.length} 間及原因</summary>` + plan.skipped.map(c => `<p>${esc(c.name)}：${esc(c.reason)}</p>`).join('') + '</details><div class="dialog-footer"><button data-close="review">取消，不修改</button>' + (plan.changes.length ? `<button id="apply-coordinates" class="primary">確認新增這 ${plan.changes.length} 間的獨立座標</button>` : '') + '</div>';
  openDialog($('review'));
}
async function commitCoordinates() {
  const preview = coordinatePreview;
  if (!preview || !payload || preview.sessionKey !== key || pendingLock || document.hidden || !$('review').open) throw new Error('預覽已失效，請重新載入檔案。');
  const sessionKey = key, originalPayload = payload;
  const bundle = await applyNearbyCoordinates(payload.bundle, preview.input, preview.plan, payload.device);
  if (payload !== originalPayload || key !== sessionKey || pendingLock || document.hidden || !$('review').open) throw new Error('資料或工作階段已改變，請重新預覽。');
  const guard = () => { if (coordinatePreview !== preview || payload !== originalPayload || key !== sessionKey || pendingLock || document.hidden || !$('review').open) throw new Error('資料或工作階段已改變，請重新預覽。'); };
  await persist({ ...payload, bundle, dirty: true }, { guard });
  coordinatePreview = null; $('review').close(); render();
  toast('獨立座標已加密儲存；門市主檔、原網址與全部筆記保持原樣。');
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
  return [visitStoreNameText(store.name), ...visitStoreSourceNames(store).map(visitStoreNameText), store.city, store.district, store.address, store.channel]
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
    if(ctx.typedReadOnly)return ctx.originalDraft;
    const checked = name => [...document.querySelectorAll(`#single-store-capture-form [name="${name}"]:checked`)].map(el => el.value);
    return {
      format: 'visit-draft-1', savedAt: new Date().toISOString(), id: ctx.id, parents: [...ctx.parents], baseData: null,
      ...(ctx.typedPlan?{typedFeedback:{analysisId:ctx.typedPlan.analysisId,rowIndex:ctx.typedPlan.rowIndex,reportId:ctx.typedPlan.reportId,resolutionHead:ctx.typedPlan.resolutionHead,questions:structuredClone(ctx.typedPlan.questions),values:captureTypedValues(),keepAttachments:ctx.typedNoteAttachments||[]}}:{}),
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
function activeVisitDraftContext() {
  return singleStoreContext || (editorContext?.type === 'visit' ? editorContext : null);
}
async function persistVisitDraftNow(ctx) {
  if (discardingDraft || !ctx || ctx !== activeVisitDraftContext() || !ctx.draftTouched || !payload) return;
  const draft = captureVisitDraft(); if (!draft) return;
  const generation = ctx.draftGeneration;
  draftState('儲存中…', 'saving');
  try {
    await persist({ ...payload, draft });
    if (ctx === activeVisitDraftContext() && ctx.draftGeneration === generation) {
      ctx.draftTouched = false;
      draftState('已存於本機 · ' + dateText(draft.savedAt), 'saved');
    }
    status();
  } catch (e) {
    $('save-state').textContent = '手機保存失敗：' + e.message;
    draftState('儲存失敗：' + e.message, 'error');
    throw e;
  }
}
function scheduleVisitDraftSave({ isComposing = false, type = '' } = {}) {
  const ctx = activeVisitDraftContext();
  if (discardingDraft || !ctx) return;
  if (type !== 'compositionstart') ctx.draftTouched = true;
  ctx.draftGeneration = (ctx.draftGeneration || 0) + 1;
  clearTimeout(draftTimer); draftTimer = null;
  if (!ctx.draftTouched) return;
  if (!singleStoreContext && $('discard-draft')) $('discard-draft').hidden = false;
  draftState('儲存中…', 'saving');
  if (isComposing || type === 'compositionstart') return;
  const generation = ctx.draftGeneration;
  draftTimer = setTimeout(() => {
    draftTimer = null;
    draftSaveChain = draftSaveChain.catch(() => {}).then(() => {
      if (ctx.draftGeneration === generation) return persistVisitDraftNow(ctx);
    }).catch(() => {});
  }, 350);
}
function flushVisitDraft() {
  const ctx = activeVisitDraftContext();
  if (discardingDraft || !ctx || !ctx.draftTouched) return draftSaveChain.catch(() => {});
  clearTimeout(draftTimer); draftTimer = null;
  draftSaveChain = draftSaveChain.catch(() => {}).then(() => persistVisitDraftNow(ctx));
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
  autoTimer = setInterval(() => { void insightReviewTick(); void peopleReadingTick(); void peopleBatchTick(); supervisorRelationshipTick(); if (!document.hidden) { refreshMonthlyAlertBadges(); syncScheduler.request('poll'); setTimeout(() => void weeklyTick(), 1500); } }, 15000);
  setTimeout(() => void weeklyTick(), 3000);
  syncScheduler.request('foreground');
  queueInsightScan(); requestNearbyPosition();
}
function currentHealthAudit() {
  const pending = pendingSyncSummary();
  return readonlyHealthAudit({ pendingCount: pending.count, pendingUnknown: pending.unknown, conflicts: records.filter(record => record.conflict).length, identityPending: all('store').filter(storeIdentityPending).length, lastSync: payload.lastSync, lastBackup: payload.lastBackupExport, weeklyBackup: weeklyState?.config?.vaultId === payload.bundle?.vaultId ? weeklyState : null, appVersion: APP_VERSION, macVersion: macProgram?.version || '', now: Date.now() });
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
    (ignoreFetching || !autoFetching) && !syncInProgress && !peopleBatchRunning && !monthlyFeedbackContext && !recoveryExportContext && !weeklyContext && !weeklyRunning && !backupPreview && !editorContext && !singleStoreContext && !inlineTextContext && !reminderContext && !dayPlanContext && !monthlyVisitContext && !attendancePrompt && !payload.monthlyFeedbackDraft && !payload.inlineTextDraft && !payload.supervisorDraft &&
    !['review', 'editor', 'quick-text-dialog', 'store-reminder-dialog', 'rebuild-dialog', 'backup-review', 'visit-attendance-dialog', 'day-plan-dialog', 'monthly-visit-dialog', 'monthly-analysis-dialog', 'insight-changes-dialog'].some(id => $(id)?.open) && !csvImport.hasPending();
}
function syncSession() { return { key, meta, token: payload?.token, device: payload?.device, epoch: syncEpoch, inline: inlineTextContext, editor: editorContext, reminder: reminderContext, dayPlan: dayPlanContext, monthly: monthlyVisitContext, single: singleStoreContext, attendance: attendancePrompt }; }
function assertSyncSession(session, bundle) {
  if (!payload || key !== session.key || meta !== session.meta || payload.token !== session.token || payload.device !== session.device || syncEpoch !== session.epoch || inlineTextContext !== session.inline || editorContext !== session.editor || reminderContext !== session.reminder || dayPlanContext !== session.dayPlan || monthlyVisitContext !== session.monthly || singleStoreContext !== session.single || attendancePrompt !== session.attendance || document.hidden || pendingLock || updateHolding || (bundle && payload.bundle !== bundle)) {
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
  } finally { autoFetching = false; queueInsightScan(); renderDataSafetyEntry(); }
  return result;
}
function lockNow(reopen = !document.hidden) {
  supervisorRelationCache=null;
  if(editorContext?.type==='supervisor-inline') void flushSupervisorDraft().catch(()=>{});
  resetInsightScan();
  clearWeeklySetup(); $('weekly-dialog')?.close(); weeklyState = null; if ($('weekly-status')) $('weekly-status').textContent = '解鎖後檢查自動備份狀態。';
  clearRecoveryExport();
  $('recovery-export-dialog').close();
  syncScheduler.pause();
  forgetBriefSearchQuery();
  if (!busy && backupPreview) { clearBackupPreview(); $('backup-review').close(); }
  if (!busy && insightsPreview) { insightsPreview = null; $('review').close(); $('review-body').replaceChildren(); }
  if (storeMergePreview || storeMergeSetup) { clearStoreMergePreview(); $('review').close(); }
  if (busy || monthlyFeedbackContext || editorContext || inlineTextContext || reminderContext || dayPlanContext || monthlyVisitContext || payload?.inlineTextDraft || $('review').open || $('quick-text-dialog')?.open || $('store-reminder-dialog')?.open || csvImport.hasPending()) { pendingLock = true; document.body.classList.add('privacy-veil'); return; }
  captureTransientResumeState();
  syncEpoch++; syncScheduler.reset(); localSaveState = 'unknown';
  attendanceCache = null;
  pendingLock = false; analysisImport = null; $('monthly-analysis-dialog').close(); $('monthly-analysis-dialog').innerHTML = ''; coordinatePreview = null; enrichmentPreview = null; insightsPreview = null; clearNearbyPosition(); versionReview = null; resolutionPreview = null; inlineTextContext = null; reminderContext = null; dayPlanContext = null; monthlyVisitContext = null; monthlyVisitViewBasis = ''; monthlyVisitNotice = ''; dayPlanUndo = null; dayPlanNotice = ''; dayPlanSorting = false; dayPlanViewBasis = ''; clearTimeout(reminderDraftTimer); reminderDraftTimer = null; clearTimeout(inlineDraftTimer); inlineDraftTimer = null; clearInterval(autoTimer); key = null; meta = null; payload = null; records = []; trail = []; editorContext = null; lastError = ''; macProgram = null; lastSyncFailure = null; syncWarning = '';
  csvImport.reset(); qualityCache = null; qualityReview = null; qualityTab = 'duplicates'; qualityField = ''; qualityPage = 0;
  resetStoreFilters();
  for (const u of objectURLs) URL.revokeObjectURL(u); objectURLs = [];
  document.querySelectorAll('dialog').forEach(d => d.close());
  for (const id of ['monthly-visit-content', 'monthly-visit-fields', 'monthly-visit-error', 'day-plan-content', 'day-plan-entry', 'day-plan-fields', 'quality-content', 'regional-content', 'focus-header', 'graph', 'graph-pager', 'focus-detail', 'evidence-list', 'store-list', 'visit-list', 'recent-store-list', 'draft-banner-text', 'reminder-draft-list', 'customer-list', 'entity-list', 'trash-list', 'review-body', 'editor-fields', 'conflict-list', 'connection-detail', 'program-detail', 'local-save-detail', 'mac-ack-detail', 'sync-success-detail', 'sync-failure-detail', 'connection-check', 'device-label', 'sync-result', 'storage-detail', 'sync-health-title', 'sync-health-body', 'pending-sync-detail', 'sync-conflict-count', 'health-audit-title', 'health-audit-time', 'health-audit-list', 'backup-result', 'data-safety-title', 'data-safety-detail']) $(id).replaceChildren();
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
  const drafts = (payload.monthlyFeedbackDraft ? 1 : 0) + (payload.draft?.format === 'visit-draft-1' ? 1 : 0) + (payload.inlineTextDraft?.format === 'inline-text-draft-1' ? 1 : 0) + reminders;
  const summary = dataSafetySummary({ localState: localSaveState, paired: !!payload.token, syncing: autoFetching || syncInProgress,
    dirty: payload.dirty, pending: pendingSyncSummary(), lastSync: payload.lastSync, conflicts: records.filter(r => r.conflict).length,
    syncError: lastError, backupWarning: syncWarning || currentHealthAudit().checks.some(check => ['backup-age','weekly-backup'].includes(check.code) && ['warning','action'].includes(check.level)), drafts, reminderDrafts: reminders });
  entry.dataset.state = summary.state;
  $('data-safety-title').textContent = summary.title;
  $('data-safety-detail').textContent = summary.detail;
}
// Formal writes replace the bundle; local-only drafts reuse the same bundle.
const bundleSizes = new WeakMap();
function bundleSizeMB(bundle) {
  if (!bundleSizes.has(bundle)) bundleSizes.set(bundle, (new TextEncoder().encode(JSON.stringify(bundle)).length / 1048576).toFixed(2));
  return bundleSizes.get(bundle);
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
  $('storage-detail').textContent = `離線介面：${offlineReady ? '已備妥' : '尚待確認，請先保持連線'}。持久儲存：${storagePersistent ? '已獲允許' : '瀏覽器尚未允許，請定期同步及備份'}。資料 ${bundleSizeMB(payload.bundle)} / 24 MB（包含歷史與附件）。`;
}
function switchView(view) {
  if(view!=='explore') document.body.classList.remove('supervisor-simple-page');
  dismissKeyboard();
  releaseIdleInlineEdit();
  activeView = view; Object.keys(titles).forEach(v => $(`${v}-view`).hidden = v !== view);
  const primary = view === 'itinerary' ? 'visits' : view === 'regional' ? 'stores' : ['quality', 'csv', 'entities', 'explore', 'trash'].includes(view) ? 'sync' : view;
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
    for (const folded of article.querySelectorAll('.reading-overlap')) folded.open = true;
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
  const hasStoreText = storeOriginalTextFields(by('store', ctx.storeId)).length > 0;
  $('brief-search-status').textContent = blocked ? '搜尋已暫停：請先完成或取消未完成的文字／拜訪草稿。'
    : editing ? '正在編輯原文；搜尋標示暫停，保留目前查詢。'
    : !ctx.query.trim() ? '搜尋本店全部正式拜訪原文；英文不分大小寫。' + (hasStoreText ? '不含下方「門市原有文字」。' : '')
    : !count ? '正式拜訪原文找不到相同文字；不包含提醒、下次跟進或舊版本。' + (hasStoreText ? '門市原有文字不在搜尋範圍，請見下方。' : '')
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
function typedAnswerControls(plan) {
  return `<section class="typed-feedback"><h3>本次現場回報</h3>${plan.state?.conflict?`<details><summary>比較本次所有分歧版本</summary>${plan.state.heads.map(op=>`<article><p>保存 ${esc(op.at)}</p>${op.data.monthlyTypedFeedback.answers.map(answer=>`<p>${esc(answer.definition.label)}：${esc(answer.value??'未作答')}</p>`).join('')}</article>`).join('')}</details><label class="check"><input type="checkbox" id="typed-conflict-ack">我已核對全部分歧，以目前表單新增修訂；各版歷史保留</label>`:''}${plan.previousResult!==null?`<aside><strong>分析端回饋（上期）</strong><p class="analysis-verbatim">${esc(plan.previousResult)}</p></aside>`:''}<p class="muted">未作答保持未知；可只回答問題，不必寫筆記。答案不會自動寫入下方原文。</p>${plan.questions.map((q,i)=>{
    const numeric=q.type==='number',text=q.type==='text';
    return `<fieldset data-typed-question="${i}"><legend>${esc(q.label)}${numeric?`（${esc(q.unit)}）`:''}</legend>${numeric?`<input id="typed-value-${i}" aria-label="${esc(q.label)}" type="number" inputmode="${q.id==='core.shelf_haud'?'numeric':'decimal'}" step="${q.id==='core.shelf_haud'?'1':'any'}" ${q.min!==undefined?`min="${esc(q.min)}"`:''} ${q.max!==undefined?`max="${esc(q.max)}"`:''} placeholder="未填答">`:text?`<textarea id="typed-value-${i}" aria-label="${esc(q.label)}" maxlength="${q.maxLength||2000}" placeholder="未填答"></textarea>`:`<div class="typed-options">${(q.type==='yesno'?['是','否','未確認']:q.options).map(value=>`<label class="check"><input type="radio" name="typed-choice-${i}" value="${esc(value)}">${esc(value)}</label>`).join('')}</div>`}${q.id==='core.push_sku'?'<label>選「其他」時的說明（選填）<input id="typed-other" maxlength="100"></label>':''}<button type="button" class="text-button" data-typed-clear="${i}">清除此題，保留未作答</button></fieldset>`;
  }).join('')}</section>`;
}
function captureTypedValues() {
  const plan=singleStoreContext?.typedPlan;if(!plan)return null;
  return plan.questions.map((q,i)=>{
    const field=$(`typed-value-${i}`);let value=null;if(field?.validity?.badInput)throw new Error('數字尚未輸入完整，請先核對，不會改存為零或未知。');
    if(field && field.value!=='')value=q.type==='number'?field.valueAsNumber:field.value.trim()?field.value:null;
    if(q.type==='number' && value!==null && !Number.isFinite(value))throw new Error('數字無法完整保存，請核對；不會轉成零或 null。');
    if(!field)value=document.querySelector(`input[name="typed-choice-${i}"]:checked`)?.value??null;
    return {value,otherText:q.id==='core.push_sku' && value==='其他'?$('typed-other').value:null};
  });
}
function restoreTypedValues(values) {
  const plan=singleStoreContext?.typedPlan;if(!plan || !Array.isArray(values) || values.length!==plan.questions.length)throw new Error('回報草稿題目已變，保留草稿，請先核對。');
  plan.questions.forEach((q,i)=>{const value=values[i].value,field=$(`typed-value-${i}`);if(field)field.value=value??'';else for(const radio of document.querySelectorAll(`input[name="typed-choice-${i}"]`))radio.checked=radio.value===value;if(q.id==='core.push_sku')$('typed-other').value=values[i].otherText??'';});
}
function setupTypedCapture(draft,edit) {
  const ctx=singleStoreContext,items=monthlyAnalysisForStore(payload.bundle,ctx.storeId).filter(item=>item.current && item.format==='yq-alert-2');
  const saved=draft?.typedFeedback;
  if(!items.length && !saved && !edit)return;
  if(items.length!==1)throw new Error('分析來源不是唯一有效版本；原草稿保留，請先核對。');
  const item=items[0],rowIndex=item.assignments.findIndex(match=>match.storeId===ctx.storeId),reference=saved||edit;
  if(reference && (reference.analysisId!==item.id || reference.rowIndex!==rowIndex))throw new Error('原草稿或回報的分析版本已換版，保留原內容，不套到新題目。');
  const plan=prepareTypedFeedback(payload.bundle,item.id,rowIndex,reference?.reportId||uuid(),undefined,reference?.resolutionHead||null);
  if(saved && JSON.stringify(saved.questions)!==JSON.stringify(plan.questions))throw new Error('草稿題目版本已變，不能直接搬答案。');
  ctx.typedPlan=plan;$('single-store-typed').innerHTML=typedAnswerControls(plan);
  const previous=plan.selected?.data.monthlyTypedFeedback;
  if(previous?.note && !draft){
    const note=by('visit',previous.note.id);
    if(!note || note.conflict || note.heads[0].id!==previous.note.revisionId)throw new Error('連結的人工筆記已修改，需先核對精確版本，不覆蓋新內容。');
    ctx.id=note.id;ctx.parents=[note.heads[0].id];ctx.typedNoteAttachments=structuredClone(note.attachments);
    $('single-store-text').value=note.text;$('single-store-next').value=note.next;$('single-store-date').value=note.date;$('single-store-source').value=note.source;
    for(const [name,ids] of [['single-person',note.people],['single-topic',note.topics]])for(const field of document.querySelectorAll(`[name="${name}"]`))field.checked=ids.includes(field.value);
  }
  if(saved){ctx.typedNoteAttachments=structuredClone(saved.keepAttachments||[]);restoreTypedValues(saved.values);}
  else if(previous)restoreTypedValues(previous.answers.map(answer=>({value:answer.value,otherText:answer.otherText})));
}
function openTypedReport(button) {
  if(payload?.draft || singleStoreContext || editorContext || syncInProgress)throw new Error('請先完成或收起目前草稿；不覆蓋輸入。');
  const reference={analysisId:button.dataset.typedAnalysis,rowIndex:Number(button.dataset.typedRow),reportId:button.dataset.typedReport||uuid(),resolutionHead:button.dataset.typedResolve||null};
  const source=monthlyAnalysisSources(payload.bundle).find(item=>item.id===reference.analysisId),storeId=source?.assignments[reference.rowIndex]?.storeId;
  if(!storeId)throw new Error('回報來源不存在。');
  if(!$('review').open || $('review').dataset.singleStoreId!==storeId)openVisitBrief(storeId);
  activateSingleStoreCapture(null,reference);
}
function typedFeedbackHTML(item) {
  const rowIndex=item.assignments.findIndex(match=>match.storeId===item.storeId),state=typedFeedbackState(payload.bundle,item.id,rowIndex);
  return `<section class="monthly-feedback"><h4>現場回報 · ${state.reports.length} 次</h4>${state.reports.map(report=>`<article><p>${report.conflict?'有並行分歧，請逐版比較後核對':'已保存'}</p>${report.heads.map(op=>`<details><summary>保存 ${esc(op.at)} · 查看答案</summary>${op.data.monthlyTypedFeedback.answers.map(answer=>`<p><strong>${esc(answer.definition.label)}</strong>：${esc(answer.value===null?'未作答':answer.value)}${answer.otherText?` · ${esc(answer.otherText)}`:''}</p>`).join('')}${item.current && report.conflict?`<button type="button" data-typed-report="${esc(report.reportId)}" data-typed-analysis="${esc(item.id)}" data-typed-row="${rowIndex}" data-typed-resolve="${esc(op.entity)}">以此版本為基礎核對分歧</button>`:''}</details>`).join('')}${item.current && !report.conflict?`<button type="button" data-typed-report="${esc(report.reportId)}" data-typed-analysis="${esc(item.id)}" data-typed-row="${rowIndex}">修改這次回報</button>`:''}</article>`).join('')}${!state.reports.length?'<p>尚未回報；未作答不代表零或未執行。</p>':''}${item.current?`<button type="button" data-typed-report="" data-typed-analysis="${esc(item.id)}" data-typed-row="${rowIndex}">填寫現場結果／新增一次拜訪</button>`:'<p>歷史回報保留，不套用至新題目。</p>'}<p class="muted">與人工筆記同一表單、各自保存；不自動填入原文、關係或待辦。</p></section>`;
}
function singleStoreCaptureHTML() {
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const options = ['', '現場觀察', '藥師主動提及', '詢問後回覆', '其他'];
  const pick = (type, inputName) => all(type).map(item => `<label class="check"><input type="checkbox" name="${inputName}" value="${esc(item.id)}">${esc(item.name)}</label>`).join('') || '<p class="muted">目前尚未建立可選項目，可直接完成拜訪紀錄。</p>';
  return `<form id="single-store-capture-form" class="single-store-capture" hidden><div class="single-store-capture-head"><div><p class="eyebrow">QUICK CAPTURE</p><h3>記錄這次拜訪</h3></div><span class="pill">門市已固定</span></div><div id="single-store-typed"></div><label>原始拜訪內容<textarea id="single-store-text" maxlength="20000" placeholder="直接輸入這次拜訪內容" spellcheck="false"></textarea></label><label>下次跟進（選填）<textarea id="single-store-next" maxlength="20000" placeholder="例如：下次確認庫存"></textarea></label><details class="single-store-more"><summary>更多欄位：日期、來源、人物、主題與附件</summary><div class="field-grid"><label>筆記日期（未知可留空）<input type="date" id="single-store-date" value="${today}"></label><label>資訊來源<select id="single-store-source">${options.map(source => `<option value="${esc(source)}">${esc(source || '未指定')}</option>`).join('')}</select></label></div><label>相關主題</label><div class="check-grid">${pick('topic', 'single-topic')}</div><label>提及人物</label><div class="check-grid">${pick('person', 'single-person')}</div><label>附件（每個上限 3 MB）<input type="file" id="single-store-files" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"></label><p class="muted">新選的附件無法靠草稿跨 App 關閉保存；完成紀錄前若 App 被系統終止，請重新選擇附件。</p></details><p id="single-store-draft-state" class="draft-state" role="status">尚未變更</p><p class="muted">輸入會先加密保存成本機草稿；只有按「完成紀錄」才建立正式拜訪版本。</p><p id="single-store-error" class="error" role="alert"></p></form>`;
}
function singleStoreIdleActions(storeId) {
  const draft = payload?.draft?.format === 'visit-draft-1' ? payload.draft : null;
  if (draft && (!draft.baseData && draft.fields?.store === storeId)) return '<button type="button" class="primary" data-start-single-store-capture>繼續未完成的拜訪紀錄</button>';
  if (draft) return '<button type="button" class="primary" data-resume-single-draft>先完成目前的未完成草稿</button>';
  return '<button type="button" class="primary" data-start-single-store-capture>＋ 開始記錄這次拜訪</button>';
}
function activateSingleStoreCapture(restoreDraft = null, typedEdit = null) {
  const storeId = $('review').dataset.singleStoreId, store = by('store', storeId);
  if (!store || store.deleted || store.conflict || storeIdentityPending(store)) return toast('這間門市目前無法使用單店快速記錄，請先核對門市狀態。');
  const draft = restoreDraft || (payload?.draft?.format === 'visit-draft-1' && !payload.draft.baseData && payload.draft.fields?.store === storeId ? payload.draft : null);
  if (payload?.draft?.format === 'visit-draft-1' && !draft) return resumeSingleDraftFromReview();
  singleStoreContext = { storeId, id: draft?.id || uuid(), parents: [...(draft?.parents || [])], draftTouched: false };
  const form = $('single-store-capture-form'); form.hidden = false;
  try { setupTypedCapture(draft,typedEdit); if (draft) applyVisitDraft(draft); } catch(error) {
    if(!draft?.typedFeedback){singleStoreContext=null;form.hidden=true;toast(error.message);return;}
    singleStoreContext.typedReadOnly=true;singleStoreContext.originalDraft=draft;singleStoreContext.typedPlan={...draft.typedFeedback,previousResult:null};
    $('single-store-typed').innerHTML=typedAnswerControls(singleStoreContext.typedPlan);applyVisitDraft(draft);restoreTypedValues(draft.typedFeedback.values);
    for(const field of form.querySelectorAll('input,select,textarea,button')){if(field.tagName==='TEXTAREA')field.readOnly=true;else field.disabled=true;}
    $('single-store-error').textContent=error.message+' 原草稿唯讀保留，可查看及複製，不可保存至新來源。';
  }
  $('review-persistent-actions').innerHTML = '<button type="button" class="danger" data-discard-single-store-draft>捨棄草稿</button><button type="button" data-collapse-single-store-capture>先收起</button><button type="submit" form="single-store-capture-form" class="primary">完成紀錄</button>';
  if(singleStoreContext.typedReadOnly)$('review-persistent-actions').innerHTML='<button type="button" class="danger" data-discard-single-store-draft>捨棄草稿</button><button type="button" data-collapse-single-store-capture>先收起</button>';
  $('review-persistent-actions').classList.add('capture-active');
  refreshBriefSearch();
  form.scrollIntoView({ block: 'start' });
  focusReadingSurface($('review'));
  // The dialog's queued opening reset must settle before the capture's final scroll.
  // Keep later navigation or a collapsed draft from being pulled back into this form.
  const captureContext=singleStoreContext;
  requestAnimationFrame(()=>{if(singleStoreContext===captureContext && $('review').open && !form.hidden)form.scrollIntoView({block:'start'});});
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
    const baseBundle=payload.bundle,sessionKey=key,sessionMeta=meta,sessionEpoch=syncEpoch;
    if(ctx.typedReadOnly)throw new Error('過期草稿僅供查看，不可套用至新來源。');
    await flushVisitDraft();
    const store = by('store', ctx.storeId);
    if (!store || store.deleted || store.conflict || storeIdentityPending(store)) throw new Error('門市狀態已變更，這次沒有建立紀錄；請重新核對門市。');
    const text = $('single-store-text').value;
    if (!text.trim() && !ctx.typedPlan) throw new Error('請填寫拜訪內容。');
    const checked = name => [...document.querySelectorAll(`#single-store-capture-form [name="${name}"]:checked`)].map(input => input.value);
    const data = {
      store: ctx.storeId, date: $('single-store-date').value.trim(), source: $('single-store-source').value.trim(), text,
      next: $('single-store-next').value, topics: checked('single-topic'), people: checked('single-person'), attachments: structuredClone(ctx.typedNoteAttachments||[])
    };
    const blobs = {};
    for (const file of $('single-store-files').files) {
      if (file.size > 3 * 1024 * 1024) throw new Error(`${file.name} 超過 3 MB。`);
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'].includes(file.type) && !/\.heic$/i.test(file.name)) throw new Error('附件只支援 JPEG、PNG、WebP、HEIC 與 PDF。');
      const bytes = new Uint8Array(await file.arrayBuffer()), id = await hashBytes(bytes); blobs[id] = b64(bytes); data.attachments.push({ blob: id, name: file.name.slice(0, 200), mime: file.type || 'application/octet-stream' });
    }
    const typedValues=ctx.typedPlan?captureTypedValues():null;
    if(ctx.typedPlan){if(ctx.typedPlan.state.conflict && !$('typed-conflict-ack')?.checked)throw new Error('請先比較並勾選核對所有分歧，不會自動選擇答案。');typedFeedbackAnswers(ctx.typedPlan,typedValues);if(!text.trim() && (data.next.trim() || data.attachments.length || data.people.length || data.topics.length))throw new Error('有下次跟進、人物或附件時請自行填寫筆記；不會建立空白原文或丟棄內容。');if(!text.trim() && !typedValues.some(answer=>answer.value!==null) && !ctx.typedPlan.state.history.length)throw new Error('請回答至少一題或自行填寫筆記。');}
    const choice = await confirmStoreSave(store.id, store.name,true,ctx.typedPlan?'本次人工作答與筆記各自保存。未勾選不更新實際拜訪日；只有親自勾選才確認今天到店。':''); if (!choice) return;
    if (singleStoreContext !== ctx) throw new Error('編輯畫面已變更，這次沒有建立紀錄。');
    assertSaveParents('visit', ctx.id, ctx.parents);
    const guard=()=>{if(singleStoreContext!==ctx || payload.bundle!==baseBundle || key!==sessionKey || meta!==sessionMeta || syncEpoch!==sessionEpoch || document.hidden || pendingLock || updateHolding || syncInProgress || ctx.typedPlan && JSON.stringify(payload.bundle)!==ctx.typedPlan.basis || choice.attendance && attendanceTaipeiDate(Date.now())!==choice.attendance.date)throw new Error('來源、工作階段或日期已變，請重新核對；草稿保留。');};guard();
    let bundle;
    if(ctx.typedPlan) bundle=await applyTypedVisit(payload.bundle,ctx.typedPlan,{answers:typedValues,note:text.trim()?data:null,noteId:ctx.id,noteParents:ctx.parents},payload.device,choice.attendance,new Date().toISOString(),blobs);
    else {bundle=structuredClone(payload.bundle);bundle.schema=2;bundle.ops.push(revision('visit',ctx.id,data,ctx.parents,payload.device,false,choice.attendance));Object.assign(bundle.blobs,blobs);validateBundle(bundle);}
    guard();await persist({ ...payload, bundle, dirty: payload.dirty || bundle!==payload.bundle, draft: null },{guard});
    clearTimeout(draftTimer); draftTimer = null; singleStoreContext = null; render(); openVisitBrief(ctx.storeId);
    toast(ctx.typedPlan?`${typedValues.some(answer=>answer.value!==null)||ctx.typedPlan.state.history.length?'現場回報':'人工筆記'}已加密保存；${choice.attendance?'已確認今天實際拜訪。':'未勾選實際拜訪，不新增到店確認。'}等待 Mac 確認收到。`:'拜訪已完成並保存於手機；你仍停留在這間門市，等待 Mac 確認收到。');
  }, 'single-store-error');
}
// Private insights are imported only after an explicit, source-checked preview.
let supervisionPreview = null, supervisorOriginStore = '';
function storeSupervisionHTML(store) {
  const a=store?.supervision; if (!a) return '';
  const person=by('person',a.personId), usable=person && !person.deleted && !person.conflict && !person.sameAs && !store.conflict;
  return `<section class="store-supervision"><strong>所屬小區：${esc(a.areaCode)} ${esc(a.areaName)}</strong><p>負責督導：${usable ? `<button class="text-button" data-open-supervisor="${esc(person.id)}" data-supervisor-store="${esc(store.id)}">${esc(person.name)} ›</button>` : '<span>人物狀態待核對</span>'}</p><details><summary>分區來源</summary><p>${esc(a.organization)} · 門市編號 ${esc(a.storeCode)} · ${esc(a.sourceLabel)}</p><p>${esc(a.sourceDocument.name)} · 生效日期：${esc(a.effectiveDate || '來源未提供')}</p><button class="text-button" data-supervision-source="${esc(store.id)}">下載原始分區圖</button></details></section>`;
}
function supervisorProfileHTML(person) {
  const stores=supervisedStores(records,person.id);
  if (!person.supervisorKey && !stores.length) return '';
  return `<section class="supervised-stores"><h3>所轄門市 · ${stores.length} 間</h3><p class="muted">依已保存分區資料列出；拜訪原文只計算明確提及此人物的紀錄。</p>${stores.map(s=>`<p><button class="text-button" data-visit-brief="${esc(s.id)}">${esc(s.name)}</button> · ${esc(s.supervision.areaName)}</p>`).join('')}</section>`;
}
function openSupervisor(personId,storeId) {
  if (singleStoreContext || inlineTextContext || editorContext || reminderContext || payload?.draft || payload?.inlineTextDraft || storedReminderDrafts().length) return toast('請先完成或收起目前草稿，再查看督導；原輸入保留。');
  const person=by('person',personId), store=by('store',storeId);
  if (!person || person.conflict || person.deleted || person.sameAs || store?.supervision?.personId!==personId) return toast('督導或門市資料已變更，請重新核對。');
  supervisorOriginStore=storeId; $('review').close(); navigate('person',personId);
}
function supervisionSelection() {return [...document.querySelectorAll('[data-supervision-store]:checked')].map(e=>e.dataset.supervisionStore);}
function updateSupervisionControls(event) {
  if (event?.target.id==='supervision-all') document.querySelectorAll('[data-supervision-store]').forEach(e=>e.checked=event.target.checked);
  if (event?.target.id!=='supervision-ack' && $('supervision-ack')) $('supervision-ack').checked=false;
  const count=supervisionSelection().length;
  if ($('supervision-count')) $('supervision-count').textContent=`已選 ${count} 間`;
  if ($('apply-store-supervision')) $('apply-store-supervision').disabled=!count || !$('supervision-ack')?.checked;
}
async function previewSupervisionFile(file) {
  assertInsightsIdle();
  if (file.size>6*1024*1024) throw new Error('小區督導資料包超過6 MB。');
  const ctx=captureCSVSaveContext(), packet=JSON.parse(await file.text()), plan=await planStoreSupervision(payload.bundle,packet);
  assertCSVSaveContext(ctx); assertInsightsIdle();
  supervisionPreview={ctx,packet,plan};
  $('review-title').textContent='小區與督導 · 套用前核對';
  $('review-body').innerHTML=`<p>來源：${esc(packet.sourceDocument.name)}。生效日期：${esc(packet.effectiveDate || '來源未提供')}。</p><p>可套用 ${plan.summary.ready} 間；相同 ${plan.summary.unchanged} 間；待核對 ${plan.summary.review} 項。</p><p>僅追加所選門市的小區與督導版本，以及所需人物與原圖。原有文字、待辦與歷史保留。</p><label class="check"><input type="checkbox" id="supervision-all">全選可套用門市</label><div class="supervision-preview-list">${plan.rows.map(row=>`<article><h3>${row.status==='ready' ? `<label class="check"><input type="checkbox" data-supervision-store="${esc(row.storeId)}">${esc(row.storeName)}</label>` : esc(row.storeName)}</h3><p>${esc(row.areaCode)} ${esc(row.areaName)} ／ ${esc(row.supervisorName)}</p><p class="muted">來源：${esc(row.storeCode)} ${esc(row.sourceLabel)}</p>${row.before ? `<p>原指派：${esc(row.before.areaName)} ／ ${esc(name('person',row.before.personId))}（舊版保留）</p>` : ''}<p>${row.status==='ready' ? '可套用' : row.status==='unchanged' ? '相同，不重複寫入' : esc(row.reason)}</p></article>`).join('')}</div><p id="supervision-count">已選 0 間</p><label class="check"><input type="checkbox" id="supervision-ack">我已核對所選門市、小區、督導及來源，同意保存。</label><p id="supervision-error" class="error" role="alert"></p><p id="supervision-result" role="status"></p><div class="dialog-footer"><button id="supervision-cancel" data-close="review">取消，不修改</button><button id="apply-store-supervision" class="primary" disabled>確認所選名單並加密保存</button></div>`;
  openDialog($('review'));
}
async function commitSupervision() {
  const preview=supervisionPreview, selected=supervisionSelection();
  if (!preview || !$('review').open || !$('supervision-ack')?.checked || !selected.length) throw new Error('請選擇門市並核對確認。');
  assertCSVSaveContext(preview.ctx);
  const result=await applyStoreSupervision(payload.bundle,preview.packet,preview.plan,selected,payload.device);
  const guard=()=>{assertCSVSaveContext(preview.ctx);if(supervisionPreview!==preview || !$('review').open || !$('supervision-ack')?.checked || JSON.stringify(supervisionSelection())!==JSON.stringify(selected)) throw new Error('確認畫面已變更；尚未寫入。');};
  guard(); await persist({...payload,bundle:result.bundle,dirty:true},{guard});
  supervisionPreview=null; render();
  $('review-body').innerHTML=`<p id="supervision-result" role="status">已加密保存 ${result.summary.stores} 間門市的小區與督導、新增 ${result.summary.people} 位人物。等待 Mac 同步確認。</p><p>所選名單：${selected.map(id=>esc(name('store',id))).join('、')}</p><div class="dialog-footer"><button data-close="review">完成</button></div>`;
  toast('小區與督導已保存。');
}

function assertInsightsIdle() {
  if (!payload || editorContext || singleStoreContext || inlineTextContext || reminderContext || dayPlanContext || monthlyVisitContext || payload.draft || payload.inlineTextDraft || storedReminderDrafts().length || csvImport.hasPending() || backupPreview || $('review').open || $('quick-text-dialog').open || $('store-reminder-dialog').open || $('rebuild-dialog').open || attendancePrompt) throw new Error('請先完成目前編輯、草稿或核對，再處理拜訪前線索。');
  if (pendingLock || document.hidden) throw new Error('請回到 App 後重新操作。');
}
// Local, read-only monitoring. No timer writes customer data or review events.
const INSIGHT_SCAN_INTERVAL = 15 * 60 * 1000;
let insightScanCache = null, insightScanRunning = false, insightScanGeneration = 0, insightScanTimer = null, insightScanError = '', insightChangesContext = null;
let insightBackgroundActive = null;
function isMacInsightBackgroundDevice() {
  const ua = navigator.userAgent || '', platform = navigator.platform || '';
  return (/^Mac/.test(platform) || /Macintosh/.test(ua)) && !/iPhone|iPad|iPod/.test(ua) && !(navigator.maxTouchPoints > 1);
}
function insightScanBasis() { return payload ? payload.bundle.vaultId + ':' + payload.bundle.ops.map(op => op.id).sort().join('|') : ''; }
function insightScanIdle(allowBusy = false) {
  return !!(payload && key) && !pendingLock && !updateHolding && (allowBusy || !busy) && !autoFetching && !syncInProgress && !gateOpening &&
    !editorContext && !payload?.monthlyFeedbackDraft && !payload?.supervisorDraft && !singleStoreContext && !inlineTextContext && !reminderContext && !dayPlanContext && !monthlyVisitContext && !attendancePrompt && !backupPreview && !insightsPreview && !storeMergePreview && !storeMergeSetup && !monthlyFeedbackContext && !recoveryExportContext && !weeklyContext && !weeklyRunning && !csvImport.hasPending() &&
    !['editor', 'quick-text-dialog', 'store-reminder-dialog', 'rebuild-dialog', 'backup-review', 'visit-attendance-dialog', 'day-plan-dialog', 'monthly-visit-dialog', 'monthly-analysis-dialog'].some(id => $(id)?.open) &&
    (!$('review')?.open || $('review').classList.contains('visit-brief-dialog'));
}
function canRetainInsightBackground() {
  return isMacInsightBackgroundDevice() && insightScanIdle() && localSaveState !== 'saving' && !payload.draft && !payload.inlineTextDraft && !document.querySelector('dialog[open]');
}
function canScanInsights(allowBusy = false) {
  const session = insightBackgroundActive;
  return insightScanIdle(allowBusy) && (!document.hidden || (canRetainInsightBackground() && session && key === session.key && meta === session.meta && payload === session.payload && payload.bundle === session.bundle && syncEpoch === session.epoch));
}
function queueInsightScan() {
  if (insightScanTimer || !payload) return;
  insightScanTimer = setTimeout(() => { insightScanTimer = null; void insightReviewTick(); if(typeof peopleReadingTick==='function')void peopleReadingTick(); }, 1800);
}
function resetInsightScan() {
  if(typeof peopleReadingViews!=='undefined'){peopleReadingEpoch++;peopleReadingViews.clear();peopleReadingPreview=null;if(typeof peopleBatchStatus!=='undefined'){peopleBatchStatus=null;peopleBatchChecked=0;$('people-batch-status')?.remove?.();}}
  insightBackgroundActive = null;
  insightScanGeneration++; clearTimeout(insightScanTimer); insightScanTimer = null; insightScanCache = null; insightScanRunning = false; insightScanError = ''; insightChangesContext = null;
  $('insight-changes-body')?.replaceChildren();
  if ($('insight-changes-title')) $('insight-changes-title').textContent = '線索新變化';
  if ($('insight-changes-error')) $('insight-changes-error').textContent = '';
  if ($('insight-scan-status')) $('insight-scan-status').textContent = '';
}
async function insightReviewTick({ force = false, allowBusy = false } = {}) {
  if (!canScanInsights(allowBusy) || insightScanRunning) return false;
  const basis = insightScanBasis(), now = Date.now();
  if (!force && insightScanCache?.basis === basis && now - insightScanCache.at < INSIGHT_SCAN_INTERVAL) return true;
  const session = { key, meta, bundle: payload.bundle, epoch: syncEpoch, generation: insightScanGeneration };
  insightScanRunning = true;
  try {
    const result = await scanInsightChanges(session.bundle);
    if (!canScanInsights(allowBusy) || key !== session.key || meta !== session.meta || payload.bundle !== session.bundle || syncEpoch !== session.epoch || insightScanGeneration !== session.generation) return false;
    insightScanCache = { basis, at: Date.now(), result }; insightScanError = '';
    refreshInsightChangeBadges(); return true;
  } catch {
    if (canScanInsights(allowBusy) && key === session.key && meta === session.meta && payload.bundle === session.bundle && syncEpoch === session.epoch && insightScanGeneration === session.generation) { insightScanError = '本次線索檢視未完成，稍後會重試；原確認保留。'; refreshInsightChangeBadges(); }
    return false;
  } finally { if (insightScanGeneration === session.generation) insightScanRunning = false; }
}
function currentInsightChanges(storeId) {
  if (!insightScanCache || insightScanCache.basis !== insightScanBasis()) return [];
  return insightScanCache.result.stores.find(store => store.storeId === storeId)?.changes || [];
}
function insightReadIds() {
  const state = payload?.insightChangeRead;
  return new Set(state?.vaultId === payload?.bundle.vaultId && Array.isArray(state.ids) ? state.ids.filter(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) : []);
}
function refreshInsightChangeBadges() {
  if (document.hidden || pendingLock) return;
  document.querySelectorAll('[data-insight-change-slot]').forEach(node => { node.innerHTML = insightChangeBadgeHTML(node.dataset.insightChangeSlot); });
  const node = $('insight-scan-status');
  if (node) node.textContent = insightScanError || (insightScanCache?.basis === insightScanBasis() ? `最近檢視：${dateText(new Date(insightScanCache.at).toISOString())}。只提示有明確新證據的可能變化，不代表已證實或涵蓋所有語意。` : '新資料將在可檢視時補查；原確認維持。');
}
function renderInsightChanges() {
  const ctx = insightChangesContext; if (!ctx) return;
  const changes = currentInsightChanges(ctx.storeId), seen = insightReadIds();
  $('insight-changes-title').textContent = (by('store', ctx.storeId)?.name || '本店') + ' · 線索新變化';
  const evidenceHTML = source => `<section><p class="muted">${esc(by('store', source.storeId)?.name || source.storeId)} · 來源版本 ${esc(source.revisionId)}</p><blockquote>${esc(source.quote)}</blockquote></section>`;
  $('insight-changes-body').innerHTML = '<p>以下是新筆記中可能影響原線索的內容。原確認、完整筆記和歷史仍保留；這裡不會替你改寫或撤銷確認。</p>' + (changes.map(change => `<article class="insight-change-item"><h3>${esc(change.reason)}</h3><h4>原來的依據</h4>${change.originalEvidence.map(evidenceHTML).join('')}<h4>新筆記</h4>${evidenceHTML(change.newEvidence)}${seen.has(change.id) ? '<p class="muted">已讀；相同變化不再顯示提醒。</p>' : `<button type="button" data-insight-change-read="${esc(change.id)}">已讀，不再提醒本項</button>`}</article>`).join('') || '<p>目前沒有可列出的實質新變化。沒有提示不代表已重新證實所有關係。</p>') + '<p class="muted">已讀只保存在這台裝置，不改變「Kit已確認」或「待查核」，也不刪除證據。其他裝置需各自閱讀。</p>';
}
async function openInsightChanges(storeId) {
  if (document.hidden || !canScanInsights(true)) throw new Error('請回到 App 並完成目前編輯或核對，再查看新變化。');
  const session = { key, meta, payload, epoch: syncEpoch };
  if (!await insightReviewTick({ force: true, allowBusy: true })) throw new Error('目前尚未完成最新檢視，請稍候再開啟。');
  if (document.hidden || !canScanInsights(true) || key !== session.key || meta !== session.meta || payload !== session.payload || syncEpoch !== session.epoch) throw new Error('資料或畫面已改變，請回到 App 後重新查看。');
  insightChangesContext = { storeId, key, meta, payload, revision: localRevision, epoch: syncEpoch, basis: insightScanBasis() };
  $('insight-changes-error').textContent = ''; renderInsightChanges(); openDialog($('insight-changes-dialog'));
}
async function readInsightChange(id) {
  const ctx = insightChangesContext;
  const guard = () => {
    if (!ctx || document.hidden || !canScanInsights(true) || !$('insight-changes-dialog').open || ctx !== insightChangesContext || key !== ctx.key || meta !== ctx.meta || payload !== ctx.payload || localRevision !== ctx.revision || syncEpoch !== ctx.epoch || insightScanBasis() !== ctx.basis || !currentInsightChanges(ctx.storeId).some(change => change.id === id)) throw new Error('資料或畫面已改變，請關閉後重新查看；尚未標記已讀。');
  };
  guard(); const ids = insightReadIds(); ids.add(id);
  if (ids.size > 20000) throw new Error('本機已讀紀錄已達上限，既有紀錄保留；請另行處理。');
  await persist({ ...payload, insightChangeRead: { vaultId: payload.bundle.vaultId, ids: [...ids] } }, { guard });
  if (ctx !== insightChangesContext || !$('insight-changes-dialog').open || document.hidden || pendingLock || key !== ctx.key || meta !== ctx.meta || syncEpoch !== ctx.epoch) return;
  insightChangesContext = { ...ctx, payload, revision: localRevision };
  renderInsightChanges(); refreshInsightChangeBadges();
}

const INSIGHT_REVIEW_LABELS = { confirmed: 'Kit已確認', pending: '待查核', rejected: '不符合' };
function insightDisplayReview(store, entry) {
  // Only the core's read-only projection supplies shared display state. Plans
  // and writes independently revalidate the saved card and current decisions.
  return entry.review || insightReviewForEntry(store, entry);
}
function insightSharedProvenanceHTML(review) {
  if (!review.sharedFrom) return '';
  return `<p class="muted" data-insight-shared-from="${esc(review.sharedFrom.storeId)}">沿用 ${esc(review.sharedFrom.storeName)} 的 Kit 確認 · ${esc(dateText(review.sharedFrom.reviewedAt))}。這是同一人物關係的共享顯示，沒有新增本店的審核紀錄。</p>${review.relation?.claim ? `<p class="muted">共同關係：${esc(review.relation.claim)}</p>` : ''}`;
}
function insightReviewControlsHTML(store, entry) {
  const review = insightDisplayReview(store, entry);
  if (entry.sourceCurrent === false) {
    const reviewer = review.reviewedAt ? `<small>Kit · ${esc(dateText(review.reviewedAt))}</small>` : '<small>尚未人工審核</small>';
    const retained = review.reviewedAt ? review.status === 'confirmed' ? '保留原確認' : '保留既有審核' : '這張線索尚未人工審核';
    return `<div class="insight-human-review"><p><strong class="insight-review-status" data-status="${esc(review.status)}">${INSIGHT_REVIEW_LABELS[review.status]}</strong>${reviewer}</p><p class="muted">來源已有變動，${retained}；重新核對來源前不變更這張卡的審核。</p></div>`;
  }
  return `<div class="insight-human-review"><p><strong class="insight-review-status" data-status="${esc(review.status)}">${INSIGHT_REVIEW_LABELS[review.status]}</strong>${review.reviewedAt ? `<small>${review.carriedFrom ? '沿用既有審核（同店整併）' : 'Kit'} · ${esc(dateText(review.reviewedAt))}</small>` : '<small>尚未人工審核</small>'}</p><div class="insight-review-options" role="group" aria-label="人工審核這張線索">${Object.entries(INSIGHT_REVIEW_LABELS).map(([status, label]) => `<button type="button" data-insight-review="${status}" data-insight-store="${esc(store.id)}" data-insight-entry="${esc(entry.id)}" data-insight-head="${esc(store.heads[0].id)}" aria-pressed="${review.status === status}" ${review.status === status ? 'disabled' : ''}>${label}</button>`).join('')}</div></div>`;
}
function insightEntryHTML(entry, sourceAsOf, prefix = '', reviewStore = null) {
  const review = reviewStore ? insightDisplayReview(reviewStore, entry) : null;
  const level = { source: '原文有記載', inference: '分析推論', counter: '反向線索' }[entry.level];
  const labels = `<div class="store-insight-labels"><span>${entry.kind === 'relationship' ? '人物連結' : '客群與需求'}</span><span class="pill ${entry.level === 'source' ? '' : 'warn'}">${level}</span></div>`;
  const body = `${entry.sourceReasons?.length ? `<ul class="insight-source-reasons">${entry.sourceReasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>` : ''}<p class="store-insight-question"><strong>這次可以問</strong>${esc(entry.question)}</p>${entry.caution ? `<p class="store-insight-caution">${esc(entry.caution)}</p>` : ''}<details data-insight-detail="${esc(prefix + entry.id)}"><summary>查看原文依據與限制</summary><p class="muted">來源核對日 ${esc(sourceAsOf)}。原文記載與分析推論是證據類別，不代表 Kit 已確認關係；現況仍可能改變。</p>${entry.limitations.length ? `<ul>${entry.limitations.map(text => `<li>${esc(text)}</li>`).join('')}</ul>` : ''}${entry.evidence.map((source, i) => `<section class="store-insight-evidence"><strong>${esc(source.storeName || JSON.parse(source.storeIdentityKey).name)}${source.role === 'counter' ? ' · 反向證據' : ''}</strong><blockquote>${esc(source.quote)}</blockquote><details data-insight-detail="${esc(prefix + entry.id + ':' + i)}" data-insight-source="${esc(source.visitId)}" data-insight-revision="${esc(source.revisionId)}" data-insight-store="${esc(source.storeId)}"${reviewStore && entry.sourceCurrent === false ? ` data-insight-owner="${esc(reviewStore.id)}" data-insight-entry="${esc(entry.id)}" data-insight-evidence="${i}"` : ''}><summary>${entry.sourceCurrent === false ? '展開當時引用的完整原文（歷史版本）' : '展開這筆完整原文'}</summary><p class="muted">${esc(source.sourceLabel || '審核時來源')} · 來源版本 ${esc(source.revisionId)}</p><pre></pre></details></section>`).join('')}</details>${reviewStore ? insightReviewControlsHTML(reviewStore, entry) : ''}`;
  // Compact display uses current exact approval or its validated relation
  // projection. Preview/history snapshots never acquire a shared decision.
  if (review?.status === 'confirmed') {
    return `<article class="store-insight-card store-insight-confirmed" data-store-insight="${esc(entry.id)}"><details class="insight-confirmed-details" data-insight-confirmed="${esc(prefix + entry.id)}"><summary><span class="insight-confirmed-headline">${esc(entry.headline)}</span><span class="insight-confirmed-badge">Kit已確認</span></summary><div class="insight-confirmed-content">${insightSharedProvenanceHTML(review)}${labels}${body}${entry.sourceCurrent === false ? `<p class="insight-source-notice" role="note">${esc(entry.sourceNotice)}</p>` : ''}${review.sharedConflict ? `<p class="insight-source-notice" role="note">${esc(review.sharedConflict)}</p>` : ''}</div></details></article>`;
  }
  return `<article class="store-insight-card" data-store-insight="${esc(entry.id)}">${labels}<h3>${esc(entry.headline)}</h3>${entry.sourceCurrent === false && entry.sourceNotice ? `<p class="insight-source-notice" role="note">${esc(entry.sourceNotice)}</p>` : ''}${review?.sharedConflict ? `<p class="insight-source-notice" role="note">${esc(review.sharedConflict)}</p>` : ''}${body}</article>`;
}
function insightChangeBadgeHTML(storeId) {
  // Pure renderers can run without the monitoring lifecycle (previews/tests).
  if (typeof currentInsightChanges !== 'function') return '';
  const allChanges = currentInsightChanges(storeId), seen = insightReadIds(), unread = allChanges.filter(change => !seen.has(change.id));
  return unread.length ? `<button type="button" class="insight-change-badge" data-insight-changes="${esc(storeId)}">有 ${unread.length} 項新變化</button>` : '';
}
function storeInsightsHTML(storeId) {
  const selected = storeInsightDisplayForStore(payload.bundle, storeId), store = by('store', storeId);
  if (!store) return '';
  const history = storeInsightReviewHistory(store);
  const entries = selected.entries.filter(entry => insightDisplayReview(store, entry).status !== 'rejected');
  const rejected = selected.entries.filter(entry => insightDisplayReview(store, entry).status === 'rejected');
  if (!entries.length && !rejected.length && !history.length) return '';
  const sourceAsOf = store.preVisitInsights?.sourceAsOf || '';
  const confirmed = entries.filter(entry => insightDisplayReview(store, entry).status === 'confirmed');
  const pending = entries.filter(entry => insightDisplayReview(store, entry).status !== 'confirmed');
  return `<section class="store-insights" aria-label="本店拜訪前線索"><h2>拜訪前，多一條線索</h2>${pending.length ? '<p class="muted">先看線索與原文，再由你人工審核。</p>' : ''}<span data-insight-change-slot="${esc(storeId)}">${insightChangeBadgeHTML(storeId)}</span>${confirmed.length ? `<details class="confirmed-insights-group" data-insight-detail="confirmed-group"><summary>已確認線索 · ${confirmed.length} 項</summary>${confirmed.map(entry => insightEntryHTML(entry, sourceAsOf, '', store)).join('')}</details>` : ''}${pending.slice(0, 2).map(entry => insightEntryHTML(entry, sourceAsOf, '', store)).join('')}${pending.length > 2 ? `<details data-insight-detail="more"><summary>其他待查核線索 · ${pending.length - 2} 項</summary>${pending.slice(2).map(entry => insightEntryHTML(entry, sourceAsOf, '', store)).join('')}</details>` : ''}${insightReviewArchiveHTML(store, rejected, history)}<p id="insight-review-error" class="error" role="alert"></p></section>`;
}
function insightReviewArchiveHTML(store, rejected, history) {
  if (!rejected.length && !history.length) return '';
  const sourceAsOf = store.preVisitInsights?.sourceAsOf || '';
  return `<details class="insight-review-archive" data-insight-detail="review-history"><summary>審核留存${rejected.length ? ` · 不符合 ${rejected.length} 項` : ''} · 歷史 ${history.length} 筆</summary><p class="muted">「不符合」只在這裡留存，日常線索不顯示。可將目前仍有效的卡片改回「待查核」；歷次審核與當時內容保留。本店的審核不會改寫其他門市的審核紀錄；同一人物關係的共享顯示會隨確認來源更新。</p>${rejected.map(entry => insightEntryHTML(entry, sourceAsOf, 'rejected:', store)).join('')}${history.length ? `<details data-insight-detail="review-events"><summary>查看歷次審核</summary>${history.map(event => `<details class="insight-review-event" data-insight-detail="review-event:${esc(event.id)}"><summary>${esc(INSIGHT_REVIEW_LABELS[event.status])} · ${esc(dateText(event.reviewedAt))} · ${esc(event.entry.headline)}</summary><p class="muted">${event.carriedFrom ? '沿用既有審核（同店整併）' : 'Kit 的審核留存'}${event.historical ? ' · 歷史門市版本，並非目前狀態' : ''}。以下是當時的分析與引句，僅供回看。</p>${insightEntryHTML(event.entry, event.sourceAsOf, 'event:' + event.id + ':')}</details>`).join('')}</details>` : ''}</details>`;
}
function assertInsightReviewReady(storeId) {
  if (!payload || !key || pendingLock || document.hidden || updateHolding || syncInProgress) throw new Error('工作階段或同步狀態已改變，請稍候重新審核。');
  if (!$('review').open || $('review').dataset.singleStoreId !== storeId || !$('review').classList.contains('visit-brief-dialog')) throw new Error('請回到這間門市的單店拜訪畫面再審核。');
  if (editorContext || singleStoreContext || inlineTextContext || reminderContext || payload.draft || payload.inlineTextDraft || storedReminderDrafts().length || csvImport.hasPending() || backupPreview || insightsPreview || attendancePrompt || $('quick-text-dialog').open || $('store-reminder-dialog').open || $('rebuild-dialog').open) throw new Error('請先完成或取消目前編輯、草稿或核對，再審核線索；原輸入保持不變。');
}
async function changeInsightReview(storeId, entryId, status, expectedHead) {
  assertInsightReviewReady(storeId);
  const sessionKey = key, sessionMeta = meta, currentPayload = payload;
  const plan = planInsightReview(payload.bundle, storeId, entryId, status, expectedHead);
  if (!plan.changed) return;
  const effectiveBefore = insightSharedReviewForEntry(payload.bundle, storeId, plan.entry);
  const related = plan.relatedStores || [], excluded = plan.relatedExcluded || [];
  const relatedNames = related.map(item => item.storeName || by('store', item.storeId)?.name || item.storeId).join('、');
  const excludedNames = excluded.map(item => `${item.storeName || by('store', item.storeId)?.name || item.storeId}（${item.reason || INSIGHT_REVIEW_LABELS[item.status] || '待核對'}）`).join('、');
  const impact = status === 'rejected' ? '這張卡將從日常線索隱藏，保留在「審核留存」。' : status === 'pending' ? '這張卡將顯示為待查核，保留之前的審核歷史。' : '這張卡將標示為你親自確認，預設收合為主標題；展開仍可查看提問、原文證據與審核操作。';
  const relationScope = plan.relationClaim ? `\n共同人物關係：${plan.relationClaim}` : '';
  const sharedImpact = status === 'confirmed' && excluded.length ? '\n相關門市的人工判定仍不一致；本店確認會保留，但同組尚未親自審核的門市暫不沿用確認。' : status === 'confirmed' && related.length ? `\n同一人物關係可沿用確認的門市：${relatedNames}。這些門市只更新共享顯示，不另外建立審核紀錄。` : status !== 'confirmed' && effectiveBefore.relation ? `\n${effectiveBefore.sharedFrom ? `不撤回 ${effectiveBefore.sharedFrom.storeName} 的原確認。` : ''}同組其他門市親自做過的確認仍保留；尚未親自審核的門市會停止沿用並回到待查核，直到判定一致。其他門市的審核紀錄不會被改寫。` : '';
  const excludedImpact = excluded.length ? `\n以下門市不會被此次操作覆蓋：${excludedNames}。` : '';
  if (!confirm(`${plan.storeName}\n${plan.entry.headline}${relationScope}\n\n${INSIGHT_REVIEW_LABELS[plan.beforeStatus]} → ${INSIGHT_REVIEW_LABELS[status]}\n${impact}${sharedImpact}${excludedImpact}\n\n只在本店建立 1 個門市審核版本並加密保存、同步；不改寫其他門市的審核、拜訪原文或實際拜訪日期。\n確認儲存？`)) return;
  assertInsightReviewReady(storeId);
  if (key !== sessionKey || meta !== sessionMeta || payload !== currentPayload) throw new Error('審核期間資料或工作階段已變更，請重新核對；尚未寫入。');
  const next = applyInsightReview(payload.bundle, plan, payload.device);
  await persist({ ...payload, bundle: next, dirty: true });
  if (!payload || key !== sessionKey || pendingLock || document.hidden) return;
  render(); openVisitBrief(storeId, { preservePosition: true });
  toast(`已保存「${INSIGHT_REVIEW_LABELS[status]}」${status === 'rejected' ? '；可在審核留存回看。' : '。'}`);
}
function exportInsightsSource() {
  assertInsightsIdle();
  const source = buildStoreInsightsSource(payload.bundle);
  if (!confirm(`將匯出目前門市識別、拜訪原文與既有分析，供私人分析核對。共 ${source.coverage.stores} 間門市、${source.coverage.visits} 筆拜訪（含回收桶／衝突狀態）。不含歷史全文、附件、CSV 或金鑰。\n這是含客戶內容的明文檔，請只存到自己的本機資料夾；不可上傳 GitHub，也不會自動傳給 AI。`)) return;
  download(JSON.stringify(source, null, 2), `pharmacy-insights-source-${source.sourceAsOf}.json`, 'application/json');
}
function insightRelationsPreviewHTML(plan) {
  const ready = plan.ready, excluded = plan.excluded || [];
  const unchangedCount = new Set((plan.relations || []).flatMap(relation => relation.members.map(member => member.storeId)).filter(id => !ready.some(item => item.storeId === id) && !excluded.some(item => item.storeId === id))).size;
  const relations = (plan.relations || []).map(relation => `<article class="store-insight-card"><h3>${esc(relation.claim)}</h3><ul>${relation.members.map(member => { const store = by('store', member.storeId), entry = member.entry || store?.preVisitInsights?.entries.find(item => item.id === member.entryId); return `<li><strong>${esc(member.storeName || store?.name || member.storeId)}</strong>${entry ? `：${esc(entry.headline)}` : ` · ${esc(member.entryId || '')}`}</li>`; }).join('')}</ul><details><summary>查看這組關係的完整對應與證據</summary><pre>${esc(JSON.stringify(relation, null, 2))}</pre></details></article>`).join('');
  return `<p><strong>關係對應 ${plan.relations?.length || 0} 組；可套用 ${ready.length} 間；不修改 ${excluded.length} 項；內容相同 ${unchangedCount} 間。</strong></p><p>這次只新增同一人物關係的對應資料。每間可套用門市新增 1 個版本；既有分析文字、審核紀錄、拜訪原文、實際拜訪日期、任務、CSV 與 Source Snapshot 原樣保留。</p><p>一端已有有效的 Kit 確認時，另一端可沿用同一關係，直接顯示精華標題。各店已明確選擇的「待查核」或「不符合」不會被覆蓋；同組判定不一致時，未審核門市暫停沿用確認；沿用確認不另建審核事件。取消或關閉不寫入。</p>${relations}<details><summary>逐店新增對應的完整影響 · ${ready.length} 間</summary>${ready.map(item => `<article><h3>${esc(item.storeName)}</h3><h4>目前對應</h4><pre>${esc(JSON.stringify(item.before ?? null, null, 2))}</pre><h4>套用後對應</h4><pre>${esc(JSON.stringify(item.after, null, 2))}</pre></article>`).join('')}</details>${excluded.length ? `<details><summary>不修改的 ${excluded.length} 項</summary>${excluded.map(item => `<p>${esc(item.storeName || by('store', item.storeId)?.name || item.relationId || item.storeId || item.id || '')}：${esc(item.reason)}</p>`).join('')}</details>` : ''}<p id="insights-error" class="error" role="alert"></p>${ready.length ? `<label class="check"><input id="insights-ack" type="checkbox">我已核對關係、對應門市與完整影響，同意新增這 ${ready.length} 間門市的關係對應版本。</label>` : ''}<div class="dialog-footer"><button data-close="review">取消，不修改</button>${ready.length ? '<button id="apply-store-insights" class="primary" disabled>確認套用人物關係對應</button>' : ''}</div>`;
}
async function previewInsightsFile(file) {
  assertInsightsIdle();
  if (file.size > 2 * 1024 * 1024) throw new Error('分析檔案超過 2 MB，未載入。');
  const sessionKey = key, input = JSON.parse(await file.text());
  if (!payload || key !== sessionKey || pendingLock || document.hidden) return;
  assertInsightsIdle();
  if (input.format === 'pharmacy-insight-relations-import-1') {
    const currentPayload = payload, plan = await planStoreInsightRelations(payload.bundle, input);
    if (!payload || key !== sessionKey || pendingLock || document.hidden) return;
    if (payload !== currentPayload) throw new Error('核對期間資料已更新；請重新載入關係對應，尚未寫入。');
    assertInsightsIdle();
    insightsPreview = { kind: 'relations', input, plan, sessionKey }; versionReview = null; resolutionPreview = null;
    $('review-title').textContent = '人物關係對應 · 正式套用前核對';
    $('review-body').innerHTML = insightRelationsPreviewHTML(plan);
    openDialog($('review'));
    return;
  }
  const plan = planStoreInsights(payload.bundle, input);
  insightsPreview = { kind: 'insights', input, plan, sessionKey }; versionReview = null; resolutionPreview = null;
  $('review-title').textContent = '拜訪前線索 · 正式套用前核對';
  $('review-body').innerHTML = `<p><strong>可套用 ${plan.ready.length} 間；不修改 ${plan.excluded.length} 間；內容相同 ${plan.unchanged.length} 間。</strong></p><p>只替每間可套用門市新增一個分析版本，保存下面的線索與來源；舊版保留。拜訪原文、門市其他欄位、任務、實際拜訪日期、CSV 與 Source Snapshot 保持原樣。套用後會隨既有加密同步與備份保存。</p><p>取消或關閉不寫入。任何來源版本不符，整間分析都不套用。</p>${plan.ready.map((item, index) => `<details class="store-insight-import" data-insight-preview="${index}"><summary>${esc(item.storeName)} · ${item.before?.entries.length || 0} → ${item.after.entries.length} 項線索</summary><div></div></details>`).join('')}${plan.excluded.length ? `<details><summary>不修改的 ${plan.excluded.length} 間</summary>${plan.excluded.map(item => `<p>${esc(by('store', item.storeId)?.name || item.storeId)}：${esc(item.reason)}</p>`).join('')}</details>` : ''}<p id="insights-error" class="error" role="alert"></p>${plan.ready.length ? `<label class="check"><input id="insights-ack" type="checkbox">我已核對上述分析與來源，同意新增這 ${plan.ready.length} 間門市的分析版本。</label>` : ''}<div class="dialog-footer"><button data-close="review">取消，不修改</button>${plan.ready.length ? '<button id="apply-store-insights" class="primary" disabled>確認套用拜訪前線索</button>' : ''}</div>`;
  openDialog($('review'));
}
async function commitInsights() {
  const ctx = insightsPreview;
  if (!ctx || !payload || ctx.sessionKey !== key || pendingLock || document.hidden || !$('review').open || !$('insights-ack')?.checked) throw new Error('請重新核對分析影響並勾選確認。');
  const currentPayload = payload;
  const next = ctx.kind === 'relations' ? await applyStoreInsightRelations(payload.bundle, ctx.input, ctx.plan, payload.device) : applyStoreInsights(payload.bundle, ctx.input, ctx.plan, payload.device);
  if (!payload || payload !== currentPayload || ctx !== insightsPreview || ctx.sessionKey !== key || pendingLock || document.hidden || !$('review').open || !$('insights-ack')?.checked) throw new Error('核對期間工作階段或資料已改變；尚未寫入。');
  await persist({ ...payload, bundle: next, dirty: true });
  const count = ctx.plan.ready.length;
  insightsPreview = null; $('review').close(); render();
  toast(ctx.kind === 'relations' ? `已保存 ${count} 間門市的人物關係對應；既有審核、原文與實際拜訪日期保持原樣，等待加密同步。` : `已保存 ${count} 間門市的拜訪前線索；原文與實際拜訪日期保持原樣，等待加密同步。`);
}
// Derived reading views never write customer revisions or relationship reviews.
let peopleBatchRunning=false,peopleBatchStatus=null,peopleBatchChecked=0;
function renderPeopleBatchStatus(){
 const host=$('sync-view');if(!host)return;let panel=$('people-batch-status');if(!panel){panel=document.createElement('section');panel.id='people-batch-status';panel.className='panel';host.prepend(panel);}
 const state=peopleBatchStatus,entries=state?.entries||[],count=kind=>entries.filter(j=>j.state===kind).length;
 panel.innerHTML=`<h2>人物速覽 · 批次自動整理</h2><p>${state?.enabled?'已啟用：由 Codex 排程整理，無需逐店下載或載入 JSON。':state?'尚未啟用批次排程；原人物速覽保留。':'正在確認排程狀態；已保存速覽仍可查看。'}</p><p>可整理 ${state?.eligibleCount??'核對中'} 間；已準備 ${entries.length} 間。</p><p role="status">等待 ${count('queued')} · 整理中 ${count('running')} · 等待保存 ${count('ready')} · 已保存 ${count('saved')} · 失敗 ${count('failed')} · 來源已變 ${count('stale')}</p>${state?.error?`<p class="error">${esc(state.error)}</p>`:''}<p class="muted">AI 速覽不等於 Kit 已確認；不合併人物、不改關係判斷或待辦。Mac、Codex 與網路可執行時才整理，App 解鎖並同步後準備新來源；保留前份速覽與歷史。</p>${state?.lastWorkerAt?`<p>最近排程執行：${esc(dateText(state.lastWorkerAt))}</p>`:''}<details><summary>門市進度及例外 · ${entries.length} 間</summary>${entries.map(j=>`<p>${esc(j.name)}：${esc({queued:'等待整理',running:'整理中',ready:'等待保存',saved:'已保存',failed:'失敗',stale:'待新來源'}[j.state]||j.state)}${j.message?' · '+esc(j.message):''}</p>`).join('')}${(state?.excluded||[]).map(j=>`<p>${esc(j.name)}：${esc(j.reason)}</p>`).join('')}</details>`;
}
async function peopleBatchTick(force=false,allowBusy=false){
 if(peopleBatchRunning||!canScanInsights(allowBusy)||!payload?.token||payload.dirty||!Number.isSafeInteger(payload.serverVersion)||!force&&Date.now()-peopleBatchChecked<15000)return;
 // Hold only scheduled work; edits/lock/source changes still cancel the guarded save.
 peopleBatchRunning=true;syncScheduler.pause();const sessionKey=key,epoch=peopleReadingEpoch;
 const eligible=()=>payload&&key===sessionKey&&peopleReadingEpoch===epoch&&canScanInsights(allowBusy)&&!payload.dirty;
 try{
  const vaultId=payload.bundle.vaultId,state=await api('/api/people-batch/status',{method:'POST',body:{vaultId}});if(!eligible())return;peopleBatchStatus=state;peopleBatchChecked=Date.now();renderPeopleBatchStatus();if(!state.enabled)return;
  const acknowledgements=[];let nextBundle=payload.bundle;
  for(const item of state.ready||[]){try{const existing=currentPeopleReading(nextBundle,item.input.result.storeId).current?.peopleReading;const plan=preparePeopleReading(nextBundle,item.input);if(!(existing?.basis===plan.result.basis&&(!existing.mode||JSON.stringify(existing.result)===JSON.stringify(plan.result))))nextBundle=await applyPeopleReading(nextBundle,item.input,plan,payload.device,new Date().toISOString(),'automatic');acknowledgements.push({...item,outcome:'saved'});}catch(error){acknowledgements.push({...item,outcome:'stale',message:error.message});}}
  if(nextBundle!==payload.bundle){const before=payload;const guard=()=>{if(!payload||key!==sessionKey||epoch!==peopleReadingEpoch||payload!==before||payload.dirty||!insightScanIdle(allowBusy))throw Error('整理保存前資料或工作階段已變更，稍後補做。');};guard();await persist({...payload,bundle:nextBundle,dirty:true},{guard});}
  for(const item of acknowledgements){if(key!==sessionKey||epoch!==peopleReadingEpoch)return;await api('/api/people-batch/ack',{method:'POST',body:{vaultId,id:item.id,basis:item.basis,outcome:item.outcome,message:item.message||''}});const entry=peopleBatchStatus.entries.find(j=>j.id===item.id);if(entry)entry.state=item.outcome;renderPeopleBatchStatus();}
  if(!eligible())return;
  const known=new Map(state.entries.map(j=>[j.storeId,j])),requests=[],excluded=[];let eligibleCount=0;
  for(const store of all('store')){if(store.deleted)continue;try{const request=peopleReadingRequest(payload.bundle,store.id);eligibleCount++;const basis=request.plan.basis,prior=currentPeopleReading(payload.bundle,store.id);if(prior.current?.peopleReading.basis===basis)continue;const hash=await hashBytes(new TextEncoder().encode(basis));if(known.get(store.id)?.basisHash===hash)continue;if(requests.length<5)requests.push(request);}catch(error){excluded.push({name:store.name,reason:error.message});}}
  peopleBatchStatus.excluded=excluded;peopleBatchStatus.eligibleCount=eligibleCount;renderPeopleBatchStatus();if(requests.length&&eligible())await api('/api/people-batch/stage',{method:'POST',body:{vaultId,snapshotVersion:payload.serverVersion,requests}});
 }catch(error){peopleBatchStatus={...peopleBatchStatus,error:error.message};renderPeopleBatchStatus();}finally{peopleBatchRunning=false;syncScheduler.wake();}
}

const peopleReadingViews = new Map();
let peopleReadingEpoch=0, peopleReadingPreview=null;
function peopleReadingPlan(storeId) {return peopleBriefSourcePlan(storeId,all('visit'),all('store'));}
function peopleEvidenceHTML(evidence) {
  return `<details class="people-reading-evidence"><summary>原句與來源版本</summary>${evidence.map(e=>`<blockquote>${esc(e.quote)}</blockquote><small>紀錄 ${esc(e.visitId)} · 精確版本 ${esc(e.revisionId)}</small>`).join('')}</details>`;
}
const PEOPLE_RELATION_LABELS={confirmed:'確定',rejected:'否定',pending:'待確認',unreviewed:'尚未人工判斷',conflict:'判斷不一致'};
function peopleRelationshipHTML(storeId,view,person,personIndex,item,itemIndex) {
  const readingId=view.readingId,state=peopleRelationshipReviewState(payload.bundle,readingId,personIndex,itemIndex);
  const status=state.conflict?'conflict':state.status||'unreviewed';
  const scope=peopleRelationshipReviewAvailability(payload.bundle,readingId,personIndex,itemIndex),current=scope.canReview;
  const actions=current?`${scope.otherSourcesChanged?'<p class="muted">其他筆記已更新；本條原句版本仍一致。請對照下方最新原文，再判斷這條說法。</p>':''}<div class="people-relation-options" role="group" aria-label="人工判斷 ${esc(person.name)}：${esc(item.text)}">${['confirmed','rejected','pending'].map(s=>`<button type="button" data-reading-relation-status="${s}" data-reading-relation-reading="${esc(readingId)}" data-reading-relation-person="${personIndex}" data-reading-relation-item="${itemIndex}" aria-pressed="${status===s}" ${status===s?'disabled':''}>${PEOPLE_RELATION_LABELS[s]}</button>`).join('')}</div>`:`<p class="muted">來源或速覽已變更；保留當時判斷，待重新整理後再核對。</p>${scope.canWithdraw?`<button type="button" data-reading-relation-status="pending" data-reading-relation-reading="${esc(readingId)}" data-reading-relation-person="${personIndex}" data-reading-relation-item="${itemIndex}">撤回判斷，改為待確認</button>`:''}`;
  const content=`${peopleEvidenceHTML(item.evidence)}<p class="people-relation-status" role="status">你的判斷：${PEOPLE_RELATION_LABELS[status]}</p>${state.conflict?'<p class="error">裝置間有不同判斷，請查看歷史再決定；未自動選擇任何一方。</p>':''}${actions}`;
  return ['confirmed','rejected'].includes(status)?`<details class="people-reading-relation" data-reading-claim="${personIndex}:${itemIndex}"><summary><span>${esc(item.text)}</span><strong>${PEOPLE_RELATION_LABELS[status]}</strong></summary>${content}</details>`:`<article class="people-reading-relation"><p>${esc(item.text)}</p>${content}</article>`;
}
function peopleRelationshipHistoryHTML(storeId) {
  const readings=new Map(payload.bundle.ops.filter(o=>o.type==='source'&&o.data.peopleReading?.storeId===storeId).map(o=>[o.entity,o.data.peopleReading]));
  const events=payload.bundle.ops.filter(o=>o.type==='source'&&readings.has(o.data.peopleRelationshipReview?.readingId));
  return events.length?`<details class="people-relation-history"><summary>人物關係審核歷史 · ${events.length} 筆</summary>${events.map(op=>{const e=op.data.peopleRelationshipReview,reading=readings.get(e.readingId),p=reading.result.people[e.personIndex],item=p.items[e.itemIndex];return `<details><summary>${esc(p.name)} · ${PEOPLE_RELATION_LABELS[e.status]} · ${esc(dateText(e.reviewedAt))}</summary><p>${esc(item.text)}</p>${peopleEvidenceHTML(item.evidence)}<small>審核紀錄 ${esc(op.entity)} · 速覽 ${esc(e.readingId)} · 僅供回看，不代表目前判斷。</small></details>`;}).join('')}</details>`:'';
}
async function changePeopleRelationshipReview(button) {
  const storeId=$('review').dataset.singleStoreId;assertInsightReviewReady(storeId);
  const sessionKey=key,sessionMeta=meta,before=payload,epoch=peopleReadingEpoch;
  const plan=planPeopleRelationshipReview(payload.bundle,button.dataset.readingRelationReading,Number(button.dataset.readingRelationPerson),Number(button.dataset.readingRelationItem),button.dataset.readingRelationStatus);
  if(plan.storeId!==storeId)throw new Error('請回到對應門市核對。');if(!plan.changed)return;
  if(!confirm(`${plan.storeName}／${plan.personName}\n${plan.item.text}\n\n${plan.otherSourcesChanged?'其他筆記已更新；請先核對最新原文。本次僅判斷這條保留的說法。\n\n':''}${PEOPLE_RELATION_LABELS[plan.beforeStatus]} → ${PEOPLE_RELATION_LABELS[plan.status]}\n\n只保存這條關係的判斷與歷史；不合併人物，不修改原文、待辦、其他關係或其他門市的判斷。\n確認保存？`))return;
  const guard=()=>{assertInsightReviewReady(storeId);if(payload!==before||key!==sessionKey||meta!==sessionMeta||peopleReadingEpoch!==epoch)throw new Error('資料或工作階段已變更，請重新核對；尚未保存。');};
  guard();const bundle=await applyPeopleRelationshipReview(payload.bundle,plan,payload.device);guard();
  await persist({...payload,bundle,dirty:true},{guard});
  if(!payload||key!==sessionKey||pendingLock||document.hidden)return;
  render();openVisitBrief(storeId,{preservePosition:true});toast(`這條關係已保存為「${PEOPLE_RELATION_LABELS[plan.status]}」；原文與其他關係保持。`);
}
const PEOPLE_ALIAS_LABELS={confirmed:'同一人',rejected:'不同人',pending:'待確認',unreviewed:'尚未審核',conflict:'判斷不一致'};
function peopleAliasReviewHTML(storeId,view,indices,state) {
  const people=indices.map(i=>view.result.people[i]),status=state?.conflict?'conflict':state?.status||'unreviewed';
  const scope=view.readingId&&payload?.bundle?peopleAliasReviewAvailability(payload.bundle,view.readingId,indices):{canReview:false,canWithdraw:false},current=scope.canReview;
  const reasons=[...new Set(people.map(p=>p.candidateReason).filter(Boolean))];
  return `<details class="people-alias-review" data-alias-review><summary>${status==='confirmed'?'同人連結 · 查看或撤回':'核對是否同一人'} · ${PEOPLE_ALIAS_LABELS[status]}</summary><p>${people.map(p=>esc(p.name)).join('／')}</p>${reasons.length?reasons.map(t=>'<p>'+esc(t)+'</p>').join(''):'<p class="muted">舊速覽未另列同人理由，請核對以下兩個稱呼的原句；同音或字形相似本身不是同人證據。</p>'}${people.map(p=>`<details><summary>${esc(p.name)} · 原句與來源</summary>${peopleEvidenceHTML(p.items.flatMap(i=>i.evidence))}</details>`).join('')}<p>只整合本店這組人物的速覽，不修改原文或正式人物；不連帶確認任何人物關係。可改為「不同人」或「待確認」恢復分開顯示，歷史保留。</p>${state?.conflict?'<p class="error">不同裝置的同人判斷不一致，保留分開顯示；請重新核對。</p>':''}${current?`${scope.otherSourcesChanged?'<p class="muted">其他筆記已更新；本組原句版本仍一致。請對照下方最新原文，再決定是否同人。</p>':''}<label>合併後的主要稱呼<select data-alias-primary><option value="">請選擇，另一稱呼仍保留</option>${people.map(p=>`<option value="${esc(p.name)}" ${state?.primaryName===p.name?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><div class="people-relation-options" role="group" aria-label="同人判斷">${['confirmed','rejected','pending'].map(s=>`<button type="button" data-reading-alias-status="${s}" data-reading-alias-reading="${esc(view.readingId)}" data-reading-alias-indices="${esc(JSON.stringify(indices))}">${PEOPLE_ALIAS_LABELS[s]}</button>`).join('')}</div>`:`<p class="muted">本組來源待更新，暫不保存新的同人判斷；舊判斷完整保留。</p>${scope.canWithdraw?`<button type="button" data-reading-alias-status="pending" data-reading-alias-reading="${esc(view.readingId)}" data-reading-alias-indices="${esc(JSON.stringify(indices))}">撤回合併，改為待確認</button>`:''}`}</details>`;
}
function peopleAliasHistoryHTML(storeId,view) {
  const readings=new Map(payload.bundle.ops.filter(o=>o.type==='source'&&o.data.peopleReading?.storeId===storeId).map(o=>[o.entity,o.data.peopleReading]));
  const events=payload.bundle.ops.filter(o=>o.type==='source'&&readings.has(o.data.peopleAliasReview?.readingId));
  if(!events.length)return '';
  const rejected=peopleAliasGroups(view.result).filter(indices=>peopleAliasReviewState(payload.bundle,view.readingId,indices).status==='rejected');
  return `<details class="people-alias-history"><summary>同人審核歷史 · ${events.length} 筆</summary>${rejected.map(indices=>peopleAliasReviewHTML(storeId,view,indices,peopleAliasReviewState(payload.bundle,view.readingId,indices))).join('')}${events.map(o=>{const e=o.data.peopleAliasReview,r=readings.get(e.readingId);return `<details><summary>${esc(e.personIndices.map(i=>r.result.people[i].name).join('／'))} · ${PEOPLE_ALIAS_LABELS[e.status]} · ${esc(dateText(e.reviewedAt))}</summary><p>主要稱呼：${esc(e.primaryName||'未合併')}。當時的判斷，非所有版本的同人結論。</p><small>審核 ${esc(o.entity)} · 速覽 ${esc(e.readingId)}</small>${e.personIndices.map(i=>peopleEvidenceHTML(r.result.people[i].items.flatMap(item=>item.evidence))).join('')}</details>`;}).join('')}</details>`;
}
async function changePeopleAliasReview(button) {
  const storeId=$('review').dataset.singleStoreId;assertInsightReviewReady(storeId);
  const sessionKey=key,sessionMeta=meta,before=payload,epoch=peopleReadingEpoch;
  const status=button.dataset.readingAliasStatus,primary=status==='confirmed'?button.closest('[data-alias-review]').querySelector('[data-alias-primary]').value:'';
  const plan=planPeopleAliasReview(payload.bundle,button.dataset.readingAliasReading,JSON.parse(button.dataset.readingAliasIndices),status,primary);
  if(plan.storeId!==storeId)throw new Error('請回到對應門市核對。');if(!plan.changed)return;
  const label=status==='confirmed'?primary+'（'+plan.people.filter(p=>p.name!==primary).map(p=>p.name).join('、')+'）':plan.people.map(p=>p.name).join('／');
  if(!confirm(`${plan.storeName}\n${label}\n\n${plan.otherSourcesChanged?'其他筆記已更新；請先核對最新原文。本次僅判斷這組保留的原句。\n\n':''}${PEOPLE_ALIAS_LABELS[plan.beforeStatus]} → ${PEOPLE_ALIAS_LABELS[status]}\n\n${status==='confirmed'?'整合速覽顯示，保留兩個原稱呼。':'恢復分開顯示。'}\n只保存可撤回的同人連結與歷史；不改正式人物、原文、任何關係判斷、待辦或其他門市。\n確認保存？`))return;
  const guard=()=>{assertInsightReviewReady(storeId);if(payload!==before||key!==sessionKey||meta!==sessionMeta||peopleReadingEpoch!==epoch)throw new Error('資料或工作階段已變更，請重新核對；尚未保存。');};
  guard();const bundle=await applyPeopleAliasReview(payload.bundle,plan,payload.device);guard();
  await persist({...payload,bundle,dirty:true},{guard});
  if(!payload||key!==sessionKey||pendingLock||document.hidden)return;
  render();openVisitBrief(storeId,{preservePosition:true});toast(`同人判斷已保存為「${PEOPLE_ALIAS_LABELS[status]}」；原文與人物關係判斷保留。`);
}
function peopleReadingRecoveryHTML(storeId,view) {
  if(['success','automatic'].includes(view?.state)&&view.result?.basis===view.basis)return '';
  const job=typeof peopleBatchStatus==='undefined'?null:peopleBatchStatus?.entries?.find(j=>j.storeId===storeId);
  return `<section class="people-reading-recovery"><p role="status">${esc(job?({queued:'本店已排隊，等待 Codex 整理；不是等待你確認。',running:'Codex 正在整理本店。',ready:'本店已整理，等待 App 核對版本並保存。',saved:'前份已保存；正在核對本店新來源。',failed:'本店整理失敗，可重新排隊。',stale:'整理期間來源已變，可重新排隊。'}[job.state]||'等待核對整理狀態。'):'可要求更新本店速覽，或檢查整理進度。')}${job?.message?' '+esc(job.message):''}</p><button type="button" data-reading-refresh="${esc(storeId)}">${job&&['queued','running','ready'].includes(job.state)?'檢查本店整理進度':'要求更新本店速覽／重試'}</button><p class="muted">由既有 Codex 排程處理，不在 App 呼叫 AI；排隊不等於已完成。每4天的既有排程不變，Mac 與 Codex 需可執行。原文與判斷歷史保留。</p></section>`;
}
async function requestPeopleReadingRefresh(storeId) {
  assertInsightReviewReady(storeId);
  if(!canScanInsights(true)||payload.dirty||!payload.token||!Number.isSafeInteger(payload.serverVersion)||peopleBatchRunning)throw Error('請先關閉編輯並等同步完成；尚未重新排隊。');
  await peopleBatchTick(true,true);assertInsightReviewReady(storeId);
  loadPeopleReadingView(storeId);refreshPeopleReadingPanel(storeId);
  if(['success','automatic'].includes(peopleReadingViews.get(storeId)?.state)){toast('本店速覽已跟上目前筆記版本。');return;}
  if(payload.dirty){toast('本機已有新整理，請先關閉門市等待同步，再檢查本店進度。');return;}
  const before=payload,sessionKey=key,epoch=peopleReadingEpoch;
  const guard=()=>{assertInsightReviewReady(storeId);if(payload!==before||key!==sessionKey||peopleReadingEpoch!==epoch||payload.dirty)throw Error('來源或同步已變更，請重新檢查本店進度。');};
  guard();const request=peopleReadingRequest(payload.bundle,storeId);const state=await api('/api/people-batch/status',{method:'POST',body:{vaultId:payload.bundle.vaultId}});guard();
  if(!state.enabled)throw Error('既有批次整理尚未啟用，請在資料與安全檢查；未擅自啟用。');
  const job=state.entries.find(j=>j.storeId===storeId);
  if(!job||!['queued','running','ready'].includes(job.state)){
    await api('/api/people-batch/stage',{method:'POST',body:{vaultId:payload.bundle.vaultId,snapshotVersion:payload.serverVersion,requests:[request],retry:true}});guard();
  }
  peopleBatchStatus=await api('/api/people-batch/status',{method:'POST',body:{vaultId:payload.bundle.vaultId}});guard();
  loadPeopleReadingView(storeId);refreshPeopleReadingPanel(storeId);renderPeopleBatchStatus();
  toast('已檢查本店整理進度；排隊工作由既有 Codex 排程處理，尚未代表完成。');
}
function peopleReadingHTML(storeId) {
  const view=peopleReadingViews.get(storeId),data=view?.result;
  const state=view?.state==='automatic'&&data?.basis===view.basis?'AI 已整理至目前筆記版本（尚未人工核對）':view?.state==='success'&&data?.basis===view.basis?'已核對至目前筆記版本':view?.state==='conflict'?'有不同整理版本，請重新核對':view?.state==='stale'?'有新來源，待重新整理':'尚未整理';
  const actions=`${view?.state==='automatic'?`<button type="button" data-reading-approve="${esc(storeId)}">核對這份速覽</button>`:''}<details><summary>手動單店工具（備援）</summary><div class="people-reading-actions"><button type="button" data-reading-export="${esc(storeId)}">準備本店整理資料</button><button type="button" data-reading-import="${esc(storeId)}">載入整理結果並核對</button><input type="file" accept=".json,application/json" data-reading-file="${esc(storeId)}" hidden></div><p class="muted">只在需要手動處理時使用；日常由批次排程接手，不必逐店下載。</p></details>`;

  const history=view?.history?.length?`<details><summary>人物速覽歷史 · ${view.history.length} 份</summary>${view.history.map(h=>`<details><summary>${h.peopleReading.mode==='automatic'?'AI 整理':'人工核對'} · ${esc(dateText(h.peopleReading.approvedAt||h.peopleReading.generatedAt))} · ${esc(h.id)}</summary><pre>${esc(JSON.stringify(h.peopleReading.result,null,2))}</pre></details>`).join('')}</details>`:'';
  if(!data)return `<h2>到店前先掃這一區</h2><p class="people-reading-status" role="status">${esc(state)}</p>${peopleReadingRecoveryHTML(storeId,view)}${actions}${payload?.bundle?peopleRelationshipHistoryHTML(storeId):''}${history}`;
  const aliasState=indices=>view.readingId&&payload?.bundle?peopleAliasReviewState(payload.bundle,view.readingId,indices):null;
  const units=peopleAliasLayout(data,aliasState);
  const card=(person,index,indices=[index],merged=false,same=false)=>{
    const members=indices.map(i=>({person:data.people[i],index:i}));
    const label=merged?person.name+'（'+members.filter(m=>m.person.name!==person.name).map(m=>m.person.name).join('、')+'）':person.name;
    const memory=(person.items.find(i=>i.category==='interaction')||person.items.find(i=>i.category==='background')||person.items[0])?.text||'';
    const groups=[['background','背景與角色'],['interaction','互動記憶'],['relationship','關係紀錄'],['topic','可接續話題']].map(([category,title])=>{
      const items=members.flatMap(m=>m.person.items.map((item,itemIndex)=>({...m,item,itemIndex}))).filter(m=>m.item.category===category);if(!items.length)return '';
      return `<h4>${title}</h4>${items.map(m=>`${merged?'<small class="people-alias-origin">原稱呼：'+esc(m.person.name)+'</small>':''}${category==='relationship'&&view.readingId?peopleRelationshipHTML(storeId,view,m.person,m.index,m.item,m.itemIndex):'<p>'+esc(m.item.text)+'</p>'+peopleEvidenceHTML(m.item.evidence)}`).join('')}`;
    }).join('');
    return `<details class="people-reading-person${same?' people-reading-same':''}" data-reading-person="${esc(person.name)}" data-reading-aliases="${esc(JSON.stringify(members.map(m=>m.person.name)))}" data-reading-key="${index}"><summary><strong>${esc(label)}</strong><span>${esc(memory)}</span></summary><div>${groups}${merged?peopleAliasReviewHTML(storeId,view,indices,aliasState(indices)):''}<div class="people-formal-relations"></div></div></details>`;
  };
  const unitHTML=unit=>{
    if(!unit.group)return card(data.people[unit.indices[0]],unit.indices[0]);
    if(unit.state?.status==='confirmed'&&!unit.state.conflict){const primary=unit.indices.find(i=>data.people[i].name===unit.state.primaryName);return card(data.people[primary],primary,unit.indices,true,false);}
    return `<section class="people-alias-candidate" aria-label="疑似同人，尚未合併">${unit.indices.map(i=>card(data.people[i],i,[i],false,true)).join('')}${peopleAliasReviewHTML(storeId,view,unit.indices,unit.state)}</section>`;
  };
  const group=(kind,title)=>{const selected=units.filter(u=>u.kind===kind);return selected.length?`<details class="people-reading-tier"><summary>${title} · ${selected.reduce((n,u)=>n+u.indices.length,0)}</summary>${selected.map(unitHTML).join('')}</details>`:'';};

  return `<h2>到店前先掃這一區</h2><span data-insight-change-slot="${esc(storeId)}">${insightChangeBadgeHTML(storeId)}</span><p class="people-reading-status" role="status">${esc(state)}${view.generatedAt?' · '+esc(dateText(view.generatedAt)):''}</p>${(!['success','automatic'].includes(view.state)||data.basis!==view.basis)?'<p class="muted">目前保留前次速覽，以完整原文為準。</p>':''}${units.some(u=>u.kind==='local')?units.filter(u=>u.kind==='local').map(unitHTML).join(''):'<p class="muted">未能安全辨識本店人物；完整原文保留在下方。</p>'}${group('historical','歷史人物')}${group('mentioned','其他門市提及')}${group('uncertain','稱呼待釐清')}<p id="people-relation-error" class="error" role="alert"></p>${peopleReadingRecoveryHTML(storeId,view)}${actions}${view.readingId?peopleAliasHistoryHTML(storeId,view):''}${view.readingId?peopleRelationshipHistoryHTML(storeId):''}${history}<details><summary>閱讀來源與限制</summary><p>${view.mode==='automatic'||view.state==='automatic'?'Codex 自動整理，尚未人工核對；':'經人工核對的閱讀整理；'}可回查原句。紫色相鄰卡是疑似同人；只有你逐組確認後才合併速覽顯示，保留原稱呼、原句與可撤回的審核歷史。正式人物與關係圖身分不會被自動改寫；整理不更改原文、日期、關係審核或待辦。新版同人檢視規則首次啟用會補整理；之後沒有新來源不反覆分析。關係原文不等於已人工確認。逐筆「確定／否定／待確認」只作用於當前人物下的這條具體說法；不連帶確認同名人物或跨店關係。既有關係卡的判斷獨立保留，不以相似姓名或引句自動互相覆蓋；整份速覽核對不代替關係核實。</p></details>`;
}
function refreshPeopleReadingPanel(storeId) {
  if(document.hidden||pendingLock||inlineTextContext||editorContext||singleStoreContext||!$('review')?.open||$('review').dataset.singleStoreId!==storeId)return;
  const slot=$('people-reading-panel');if(!slot)return;
  const snapshot=peopleReadingViews.get(storeId);const signature=JSON.stringify([snapshot?.state,snapshot?.readingId,snapshot?.basis,snapshot?.generatedAt,snapshot?.result,snapshot?.progress,typeof peopleBatchStatus==='undefined'?null:peopleBatchStatus?.entries?.find(j=>j.storeId===storeId),payload?.bundle.ops.filter(o=>o.data.peopleRelationshipReview||o.data.peopleAliasReview)]);if(slot.dataset.readingSignature===signature)return;
  // Preserve open people/evidence and source focus; never rerender the editor.
  const open=[...slot.querySelectorAll('[data-reading-key][open]')].map(n=>n.dataset.readingPerson);
  const tiers=[...slot.querySelectorAll('.people-reading-tier[open]')].map(n=>n.querySelector('summary')?.textContent);
  // Move old formal cards back before replacing their reading containers.
  for(const card of slot.querySelectorAll('[data-reading-formal-card]')) {
    const home=document.getElementById(card.dataset.readingFormalCard);if(home)home.append(card);
  }
  slot.innerHTML=peopleReadingHTML(storeId);slot.dataset.readingSignature=signature;
  for(const node of slot.querySelectorAll('[data-reading-key]'))node.open=open.includes(node.dataset.readingPerson);
  for(const node of slot.querySelectorAll('.people-reading-tier'))node.open=tiers.includes(node.querySelector('summary')?.textContent);
  const formal=$('people-reading-formal-home');
  if(formal){
    const error=formal.querySelector('#insight-review-error');if(error)slot.after(error);
    for(const card of formal.querySelectorAll('article.store-insight-card')) {
      if(card.closest('.insight-review-archive'))continue;
      const text=card.querySelector('summary,h3')?.textContent||'';
      const target=[...slot.querySelectorAll('[data-reading-person]')].find(n=>(JSON.parse(n.dataset.readingAliases||'[]')).some(name=>text.includes(name)));
      if(target){card.dataset.readingFormalCard='people-reading-formal-home';target.querySelector('.people-formal-relations').append(card);}
    }
  }
}
function loadPeopleReadingView(storeId) {
  const saved=currentPeopleReading(payload.bundle,storeId);let basis='';
  try{basis=peopleReadingPlan(storeId).basis;}catch{}
  const doc=saved.current?.peopleReading;
  peopleReadingViews.set(storeId,{basis,readingId:saved.current?.id,result:doc?.result||null,generatedAt:doc?.approvedAt||doc?.generatedAt||null,history:saved.history,mode:doc?.mode||'manual',state:saved.conflict?'conflict':doc?(doc.basis===basis?(doc.mode==='automatic'?'automatic':'success'):'stale'):'missing'});
}
function peopleReadingTick() {
  if(!payload||pendingLock||document.hidden||!$('review')?.open||!$('review').dataset.singleStoreId)return;
  const storeId=$('review').dataset.singleStoreId;loadPeopleReadingView(storeId);refreshPeopleReadingPanel(storeId);
}
async function ensurePeopleReading(storeId) {loadPeopleReadingView(storeId);refreshPeopleReadingPanel(storeId);}
function assertPeopleReadingIdle() {
  if(!payload||!key||pendingLock||document.hidden||inlineTextContext||editorContext||singleStoreContext||syncInProgress)throw new Error('請先完成草稿與保存，並等目前的同步結束，再核對人物速覽。');
}
function exportPeopleReading(storeId) {
  assertPeopleReadingIdle();
  const request=peopleReadingRequest(payload.bundle,storeId);
  download(new TextEncoder().encode(JSON.stringify(request,null,2)),'本店人物整理資料.json','application/json');
  toast('已下載本店整理資料；檔案含私人筆記，僅在你選擇後提供給 ChatGPT／Codex，不要公開上傳。');
}
function readingReviewHTML(result) {
  if(!result)return '<p>尚無已保存的人物速覽。</p>';
  return result.people.map(p=>`<article><h3>${esc(p.name)}</h3><p>${esc({local:'本店筆記中的人物',historical:'歷史人物',mentioned:'其他門市提及',uncertain:'稱呼待釐清'}[p.kind]||'')}</p>${p.items.map(i=>`<h4>${esc({background:'背景與角色',interaction:'互動記憶',relationship:'關係紀錄',topic:'可接續話題'}[i.category])}</h4><p>${esc(i.text)}</p>${peopleEvidenceHTML(i.evidence)}`).join('')}</article>`).join('')||'<p>這份整理沒有可列出的人物；請確認是否有遺漏。</p>';
}
async function previewPeopleReadingFile(file,storeId) {
  assertPeopleReadingIdle();if(file.size>2*1024*1024)throw new Error('整理檔案超過 2 MB，未載入。');
  const sessionKey=key,currentPayload=payload,input=JSON.parse(await file.text());
  assertPeopleReadingIdle();if(key!==sessionKey||payload!==currentPayload)throw new Error('讀取期間工作階段或資料已更新。');
  if(input.result?.storeId!==storeId)throw new Error('整理結果不是這間門市，未載入。');
  const plan=preparePeopleReading(payload.bundle,input);
  peopleReadingPreview={input,plan,sessionKey,currentPayload,epoch:peopleReadingEpoch};
  forgetBriefSearchQuery();$('review-persistent-actions').hidden=true;$('review-persistent-actions').replaceChildren();
  $('review').dataset.singleStoreId='';$('review-title').textContent='人物速覽 · 預覽核對，尚未保存';
  $('review-body').innerHTML=`<h2>${esc(plan.storeName)}</h2><p>只新增獨立的人物速覽來源紀錄，隨既有加密同步與完整備份保存。原文、人物身分、人工關係判斷、待辦與歷史不變；核對速覽不代表確定關係為事實。</p>${plan.conflict?'<p class="error">存在不同整理版本，請核對歷史；這次確認會明確接替這些版本，全部原件保留。</p>':''}<details><summary>上次人物速覽</summary>${plan.priorResults.length?plan.priorResults.map(readingReviewHTML).join(''):'<p>尚無已保存的人物速覽。</p>'}</details><h3>這次完整人物速覽</h3>${readingReviewHTML(plan.result)}<p class="error" id="people-reading-error" role="alert"></p><label><input type="checkbox" id="people-reading-ack">我已核對人物歸屬、原句與來源版本，同意保存這份人物速覽。</label><div class="dialog-footer"><button type="button" data-reading-cancel>取消，不保存</button><button type="button" id="people-reading-save" disabled>確認保存人物速覽</button></div>`;
}
async function commitPeopleReading() {
  const ctx=peopleReadingPreview;
  const guard=()=>{assertPeopleReadingIdle();if(!ctx||peopleReadingPreview!==ctx||ctx.sessionKey!==key||ctx.epoch!==peopleReadingEpoch||payload!==ctx.currentPayload||!$('review').open||!$('people-reading-ack')?.checked)throw new Error('核對期間資料或工作階段改變，請重新預覽。');};
  guard();const next=await applyPeopleReading(payload.bundle,ctx.input,ctx.plan,payload.device);guard();
  await persist({...payload,bundle:next,dirty:true},{guard});
  peopleReadingPreview=null;$('review').close();render();openVisitBrief(ctx.plan.storeId);
  toast('已保存人物速覽；原文、關係審核與待辦保留，等待加密同步。');
}

function readingReminderOverlap(text,reminder) {
  const compact=value=>String(value||'').normalize('NFKC').replace(/（[^）]*）|\([^)]*\)/gu,'').replace(/[\s「」『』，。:：]/gu,'');
  const note=compact(text),target=compact(reminder);
  return !!note&&note.length<=80&&(note===target||(note.length>=12&&target.includes(note.slice(-12))));
}
function openVisitBrief(storeId, { capture = false, restoreDraft = null, preservePosition = false } = {}) {
  const review = $('review'), reviewBody = $('review-body');
  const preserving = preservePosition && review.open && review.dataset.singleStoreId === storeId;
  const preserved = preserving ? {
    scrollTop: reviewBody.scrollTop,
    secondaryOpen: !!reviewBody.querySelector('.brief-secondary')?.open,
    historyOpen: !!reviewBody.querySelector('.brief-history')?.open,
    tasksOpen: !!reviewBody.querySelector('.reminder-task-history')?.open,
    analysisDetails: [...reviewBody.querySelectorAll('[data-analysis-detail][open]')].map(el => el.dataset.analysisDetail),
    readingPeople: [...reviewBody.querySelectorAll('[data-reading-person][open]')].map(el=>el.dataset.readingPerson),
    readingTiers: [...reviewBody.querySelectorAll('.people-reading-tier[open]')].map(el=>el.querySelector('summary')?.textContent),
    insightDetails: [...reviewBody.querySelectorAll('[data-insight-detail][open]')].map(el => el.dataset.insightDetail),
    confirmedInsights: [...reviewBody.querySelectorAll('[data-insight-confirmed][open]')].map(el => el.dataset.insightConfirmed)
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
  const historyHTML = history.map((item,index) => `<article class="brief-item" data-brief-visit="${esc(item.id)}"><h3>S${index+1}｜完整原文</h3>${readingReminderOverlap(item.text,brief.store.nextRemember)?`<details class="reading-overlap"><summary>與置頂提醒內容重疊 · 原文保留</summary>${inlineVisitTextHTML(item)}</details>`:inlineVisitTextHTML(item)}${item.next ? `<p class="next"><strong>下次跟進</strong>${esc(item.next)}</p>` : ''}<details><summary>來源、精確版本與歷史</summary><p>${esc(item.source||'來源未提供')} · ${esc(item.heads?.[0]?.id||'版本待核對')}</p><button type="button" class="text-button" data-history="visit:${esc(item.id)}">查看歷史版本</button></details></article>`).join('') || `<p class="empty">${storeOriginalTextFields(brief.store).length ? '尚未另建拜訪紀錄；門市原有文字顯示於上方。' : '目前沒有拜訪紀錄。'}</p>`;
  const explicitItems = brief.explicitLinks.map(item => {
    const linked = chip(item.type, item.id); if (!linked) return '';
    return `<article class="brief-linked-item"><div>${linked}<span class="muted">${item.visitCount} 筆明確連結</span></div>${briefTraceHTML(item.occurrences)}</article>`;
  }).filter(Boolean).join('');
  const explicit = explicitItems ? `<section class="visit-brief-section"><h3>已明確連結的人物與主題</h3><p class="muted">每項連結都保留建立它的拜訪原文。</p><div class="brief-linked-list">${explicitItems}</div></section>` : '';
  singleStoreContext = null; review.dataset.singleStoreId = storeId;
  $('review-title').textContent = '單店拜訪｜' + brief.store.name;
  reviewBody.innerHTML = `<div class="visit-brief-head"><p>${esc(location)} · ${brief.visitCount} 筆正式拜訪紀錄</p>${storeAttendanceHTML(storeId, true)}</div>${reminders}${storeSupervisionHTML(brief.store)}${monthlyAnalysisStoreHTML(brief.store)}${storeOriginalTextHTML(brief.store)}${storeMergeOriginsHTML(brief.store)}${singleStoreCaptureHTML()}<section id="people-reading-panel" class="visit-brief-section">${peopleReadingHTML(storeId)}</section><details id="people-reading-formal-home"><summary>其他既有關係線索與審核歷史</summary>${storeInsightsHTML(storeId)}</details>${brief.followups.length ? `<section class="visit-brief-section brief-followups"><h3>明確填寫的下次跟進</h3>${followups}</section>` : ''}<details class="brief-history" ${preserved ? preserved.historyOpen ? 'open' : '' : 'open'}><summary>既有拜訪原文 · 全部 ${history.length} 筆（可直接修改）</summary><p class="muted">點一下既有拜訪原文即可直接輸入；修改會先加密保存成本機草稿，核對修改前後差異並最後確認後，才建立同一筆拜訪的新版本。這裡不去重，每筆原文、下次跟進與歷史都保留。</p>${historyHTML}</details><details class="brief-secondary" ${preserved?.secondaryOpen ? 'open' : ''}><summary>查看人物、主題、原文候選與最近拜訪原文</summary><div class="candidate-disclaimer"><strong>內容來源與限制</strong><p>只排列你已填寫的欄位、正式拜訪原文與可追溯候選；不生成或改寫正式拜訪內容。只把全半形、英文字母大小寫與空白差異視為相同內容，標點或用詞不同仍分開；完整歷史永遠保留每一筆。</p></div>${explicit}<section class="visit-brief-section"><h3>原文候選提示</h3><p class="muted">點選每個候選可核對命中的原句、來源與原文狀態。</p><div class="candidate-chip-list">${candidates}</div></section><section class="visit-brief-section"><h3>最近 ${recentCount} 筆拜訪原文${brief.recent.length < recentCount ? ` · 合併顯示 ${brief.recent.length} 組` : ''}</h3>${recent}</section></details>`;
  $('review-persistent-actions').classList.remove('capture-active');
  $('review-persistent-actions').innerHTML = singleStoreIdleActions(storeId);
  $('review-persistent-actions').hidden = false;
  if (preserving) {
    setReviewMode('visit-brief');
    for(const detail of reviewBody.querySelectorAll('[data-reading-person]'))detail.open=preserved.readingPeople.includes(detail.dataset.readingPerson);
    for(const detail of reviewBody.querySelectorAll('.people-reading-tier'))detail.open=preserved.readingTiers.includes(detail.querySelector('summary')?.textContent);
    const taskHistory = reviewBody.querySelector('.reminder-task-history'); if (taskHistory) taskHistory.open = preserved.tasksOpen;
    for (const detail of reviewBody.querySelectorAll('[data-analysis-detail]')) detail.open = preserved.analysisDetails.includes(detail.dataset.analysisDetail);
    for (const detail of reviewBody.querySelectorAll('[data-insight-detail]')) detail.open = preserved.insightDetails.includes(detail.dataset.insightDetail);
    for (const detail of reviewBody.querySelectorAll('[data-insight-confirmed]')) detail.open = preserved.confirmedInsights.includes(detail.dataset.insightConfirmed);
    const restorePosition = () => { reviewBody.scrollTop = preserved.scrollTop; };
    restorePosition(); requestAnimationFrame(restorePosition);
  } else openDialog(review, { reviewMode: 'visit-brief' });
  if (capture) activateSingleStoreCapture(restoreDraft);
  refreshBriefSearch({ search: true });
  void ensurePeopleReading(storeId);
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
function noteHTML(v, query = '', { showStoreText = true, showStoreReminders = true } = {}) {
  if (v.evidenceMembers?.length > 1) return `<section class="note"><h3>相同來源文字 · ${v.evidenceMembers.length} 份來源</h3>${storeAttendanceHTML(v.store)}${showStoreText ? storeOriginalTextHTML(by('store', v.store), query) : ''}<p>同店、同日期欄位與全文相同，整合顯示一次；不代表已證實是同一次拜訪。每份來源與歷史都保留。</p><p>${highlightLiteral(v.text, query)}</p><details><summary>展開所有來源、歷史與各別操作</summary>${v.evidenceMembers.map((item, index) => noteHTML(item, query, { showStoreText: false, showStoreReminders: showStoreReminders && index === 0 })).join('')}</details></section>`;
  const rule = activeView === 'explore' ? entityRule(by(focus.type, focus.id)) : null;
  const evidence = rule ? evidenceKind(v.text, rule) : null;
  const hint = evidence?.lines.length ? `<div class="evidence-hint ${evidence.kind}"><strong>${esc(evidence.label)} · 字詞線索</strong>${evidence.lines.map(line => `<blockquote>${esc(line)}</blockquote>`).join('')}</div>` : '';
  const sourceState = v.sourceMissing ? '<div class="conflict-card">Google 最新匯出已沒有這段備註；程式保留最後內容，未刪除。</div>' : v.googleUpdatePending ? `<div class="conflict-card">Google 備註已有新版；你曾在 App 修改原文，因此先保留 App 文字。<details><summary>查看 Google 最新文字</summary><p>${esc(v.googleText)}</p></details></div>` : '';
  const store = by('store', v.store), hasStoreNotes = !!store && !!(store.nextRemember || store.everyTimeMust || store.nextRememberTasks?.some(task => !task.completedAt));
  const storeNotes = showStoreReminders && store && !store.conflict ? `<div class="store-memory ${hasStoreNotes ? '' : 'empty'}">${reminderTasksHTML(store, true, false)}${store.nextRemember ? `<p><strong>下次記得（尚未轉成任務）：</strong>${esc(store.nextRemember)}</p>` : ''}${store.everyTimeMust ? `<p><strong>每次必做、必給：</strong>${esc(store.everyTimeMust)}</p>` : ''}<button type="button" class="text-button store-reminder-edit" data-store-reminder="${esc(store.id)}">${hasStoreNotes ? '修改門市提醒' : '＋ 填寫門市提醒'}</button></div>` : '';
  const textBlock = inlineVisitTextHTML(v, query);
  const storeButton = store && !store.conflict && !storeIdentityPending(store) ? `data-visit-brief="${esc(v.store)}"` : `data-node-type="store" data-node-id="${esc(v.store)}"`;
  const advanced = `${sourceButton(v)}<button class="text-button" data-edit="visit:${esc(v.id)}">完整編輯</button><button class="text-button" data-history="visit:${esc(v.id)}">歷史 ${v.versions.length}</button><button class="text-button danger" data-delete="visit:${esc(v.id)}">移到回收桶</button>`;
  return `<article class="note">${v.source ? `<div class="note-head"><span class="pill">${esc(v.source)}</span></div>` : ''}<button class="text-button store-link" ${storeButton}>${visitStoreNameHTML(name('store', v.store), query)}${monthlyAlertBadgeHTML(v.store)}</button>${visitStoreAliasMatchHTML(store, query)}${storeAttendanceHTML(v.store)}${storeNotes}${showStoreText ? storeOriginalTextHTML(store, query) : ''}${v.conflict ? `<div class="conflict-card">這筆有 ${v.heads.length} 個版本。以下僅顯示其中一個，請先核對。 <button class="text-button" data-review="visit:${esc(v.id)}">處理衝突</button></div>` : ''}${sourceState}${hint}${textBlock}<div class="chips">${v.topics.map(id => chip('topic', id, query)).join('')}${v.people.map(id => chip('person', id, query)).join('')}</div>${v.next ? `<p class="next"><strong>下次跟進</strong>${highlightLiteral(v.next, query)}</p>` : ''}<div class="attachments">${(v.attachments || []).map((a, i) => `<button data-attachment="${esc(v.id)}" data-index="${i}">↧ ${esc(a.name)}</button>`).join('')}</div><div class="note-actions">${!v.conflict && store && !store.deleted && !store.conflict ? `<button class="primary" data-new-visit-store="${esc(v.store)}">＋ 記錄這次拜訪</button>` : ''}<details class="more-actions"><summary>更多操作</summary><div>${advanced}</div></details></div></article>`;
}
function render() {
  if(typeof peopleBatchStatus!=='undefined')renderPeopleBatchStatus();
  if (!payload) return;
  renderSupervisorDraftBanner();
  records = project(payload.bundle); status(); queueInsightScan(); refreshInsightChangeBadges();
  if (!by(focus.type, focus.id) || by(focus.type, focus.id).deleted) { const first = all('topic').find(t => t.ruleKey === 'ortho') || all('store')[0] || all('topic')[0] || all('person')[0]; focus = first ? { type: first.type, id: first.id } : { type: 'store', id: '' }; }
  if (activeView === 'explore') { renderStores(); renderFocus(); }
  if (activeView === 'visits') renderVisits();
  if (activeView === 'itinerary') renderDayPlan();
  if (activeView === 'monthly') renderMonthlyVisits();
  if (activeView === 'quality') renderQuality();
  if (activeView === 'stores') renderStores();
  if (activeView === 'regional') renderRegional();
  if (activeView === 'entities') $('entity-list').innerHTML = [...all('person'), ...all('topic')].map(entityCard).join('') || '<p class="empty">新增人物與主題，讓拜訪紀錄產生連結。</p>';
  if (activeView === 'csv') csvImport.refresh();
  $('conflict-list').innerHTML = records.filter(r => r.conflict).map(r => `<div class="conflict-card"><strong>${esc(r.name || name('store', r.store) + ' · ' + r.date)}</strong><p>${r.heads.length} 個版本待確認</p><button data-review="${r.type}:${esc(r.id)}">比較並處理</button></div>`).join('') || '<p class="muted">目前沒有衝突。</p>';
  if (activeView === 'trash') $('trash-list').innerHTML = records.filter(r => r.deleted && !r.conflict).map(r => `<article class="panel"><span class="pill">${kinds[r.type]}${r.mergedInto ? ' · 已整併' : ''}</span><h3>${esc(r.name || name('store', r.store) + ' · ' + r.date)}</h3><p>${r.mergedInto ? '已依裁定整併至：' + esc(name('store', r.mergedInto)) + '。原版本與歷史仍保留。' : esc(r.text || r.desc || r.contact || '')}</p>${r.mergedInto && r.mergeDecision ? '<p class="muted">安全合併來源留存；若需撤銷，須另行核對完整影響。</p>' : `<button data-restore="${r.type}:${esc(r.id)}">還原</button>`} <button data-history="${r.type}:${esc(r.id)}">查看歷史</button></article>`).join('') || '<p class="empty">回收桶是空的。</p>';
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
  $('review-body').innerHTML = '<div class="quality-pair">' + qualityStore(pair.a) + qualityStore(pair.b) + '</div><p class="quality-reasons">' + pair.reasons.map(esc).join('；') + '</p><div class="quality-table-wrap"><table class="quality-table"><thead><tr><th>欄位</th><th>門市一</th><th>門市二</th></tr></thead><tbody>' + Object.entries(PROFILE_FIELDS).map(([field, label]) => '<tr><th>' + label + '</th><td>' + esc(pair.a[field] || '未提供') + '</td><td>' + esc(pair.b[field] || '未提供') + '</td></tr>').join('') + '</tbody></table></div><p class="muted">確認不同門市後會保存核對紀錄並同步。名稱、地址或地圖等辨識資料改變時，會重新列入核對。</p><p class="muted">若已由你確認為同一門市，可先產生安全合併完整影響預覽；預覽不會寫入資料。</p><div class="note-actions">' + sourceButton(pair.a) + sourceButton(pair.b) + '</div><div class="dialog-footer"><button data-close="review">稍後核對</button><button type="button" data-quality-merge>同一門市：預覽安全合併</button><button class="primary" data-quality-mark="1">' + (qualityReview.forget ? '撤回確認，重新核對' : '確認為不同門市') + '</button></div>';
  openDialog($('review'));
}
// Manual identity adjudication is a separate, read-only preview until all
// safeguards and the final explicit confirmation have succeeded.
function storeMergeCanonical(value) {
  if (Array.isArray(value)) return '[' + value.map(storeMergeCanonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + storeMergeCanonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function assertStoreMergeIdle() {
  if (!payload || !key || !meta || pendingLock || document.hidden || updateHolding || syncInProgress || autoFetching) throw new Error('工作階段、同步或更新狀態已變更；請回到 App 後重新預覽，尚未套用。');
  if (editorContext || singleStoreContext || inlineTextContext || reminderContext || dayPlanContext || monthlyVisitContext || quickTextContext || payload.draft || payload.inlineTextDraft || storedReminderDrafts().length || csvImport.hasPending() || backupPreview || insightsPreview || coordinatePreview || enrichmentPreview || attendancePrompt || ['editor', 'quick-text-dialog', 'store-reminder-dialog', 'rebuild-dialog', 'backup-review'].some(id => $(id)?.open)) throw new Error('請先完成或取消所有編輯、加密草稿及匯入預覽，再核對門市合併；原輸入保持不變。');
}
function clearStoreMergePreview() {
  const hadPreview = !!storeMergePreview || !!storeMergeSetup;
  storeMergePreview = null; storeMergeSetup = null;
  if (hadPreview) $('review-body').replaceChildren();
}
function assertStoreMergeCurrent(ctx) {
  assertStoreMergeIdle();
  if (!ctx || storeMergePreview !== ctx || !$('review').open || key !== ctx.sessionKey || meta !== ctx.sessionMeta || payload !== ctx.currentPayload || localRevision !== ctx.expected || syncEpoch !== ctx.epoch || JSON.stringify(payload) !== ctx.baseline) throw new Error('預覽期間資料或工作階段已變更；請重新預覽，尚未套用。');
}
function updateStoreMergeControls() {
  const button = $('store-merge-apply'); if (!button) return;
  button.disabled = busy || !storeMergePreview?.verifiedBackup || !$('store-merge-ack')?.checked || !$('store-merge-devices')?.checked;
}
function openStoreMergeSetup(a = qualityReview?.a, b = qualityReview?.b) {
  assertStoreMergeIdle();
  const keeper = by('store', a), donor = by('store', b);
  if (!keeper || !donor || keeper.id === donor.id || keeper.deleted || donor.deleted || keeper.conflict || donor.conflict || keeper.mergedInto || donor.mergedInto) throw new Error('這兩筆門市目前無法合併；請先核對衝突或已整併狀態。');
  storeMergePreview = null; storeMergeSetup = { a, b }; versionReview = null; resolutionPreview = null;
  $('review-title').textContent = '同一門市 · 設定合併預覽';
  $('review-body').innerHTML = `<form id="store-merge-form"><p>目前沒有寫入資料。先選擇保留的門市 ID 與正式名稱，下一步會逐筆列出完整影響。</p><label>保留哪一筆作為主檔<select id="store-merge-keeper"><option value="${esc(a)}">${esc(keeper.name)} · ${esc(a)}</option><option value="${esc(b)}">${esc(donor.name)} · ${esc(b)}</option></select></label><label>合併後正式店名<input id="store-merge-name" value="${esc(keeper.name)}" maxlength="200" required autocomplete="off"></label><p class="muted">另一筆會留下整併去向與全部舊版本，退出有效門市清單。拜訪原文不改寫，保留歷史不代表已有一鍵撤銷合併。</p><p id="store-merge-error" class="error" role="alert"></p><div class="dialog-footer"><button type="button" data-close="review">取消，不修改</button><button type="submit" class="primary">產生完整影響預覽</button></div></form>`;
  openDialog($('review'));
}
async function previewStoreMerge() {
  assertStoreMergeIdle();
  const setup = storeMergeSetup;
  if (!setup || !$('review').open) throw new Error('請重新選擇門市。');
  const keeperId = $('store-merge-keeper').value, donorId = keeperId === setup.a ? setup.b : setup.a;
  if (![setup.a, setup.b].includes(keeperId)) throw new Error('保留門市不在本次核對範圍。');
  const options = { keeperId, donorId, name: $('store-merge-name').value.trim() };
  const ctx = { options, currentPayload: payload, sessionKey: key, sessionMeta: meta, expected: localRevision, epoch: syncEpoch, baseline: JSON.stringify(payload), verifiedBackup: null };
  const disk = await readLocal();
  assertStoreMergeIdle();
  if (storeMergeSetup !== setup || !$('review').open || payload !== ctx.currentPayload || key !== ctx.sessionKey || meta !== ctx.sessionMeta || localRevision !== ctx.expected || syncEpoch !== ctx.epoch || JSON.stringify(payload) !== ctx.baseline || !disk || disk.revision !== ctx.expected) throw new Error('檢查期間資料或視窗已變更；請重新開啟預覽，尚未套用。');
  const plan = await planStoreMerge(payload.bundle, options);
  assertStoreMergeIdle();
  if (storeMergeSetup !== setup || !$('review').open || payload !== ctx.currentPayload || key !== ctx.sessionKey || meta !== ctx.sessionMeta || localRevision !== ctx.expected || syncEpoch !== ctx.epoch || JSON.stringify(payload) !== ctx.baseline) throw new Error('產生預覽期間資料已變更，尚未套用。');
  storeMergeSetup = null; storeMergePreview = { ...ctx, plan, planJSON: JSON.stringify(plan), bundleJSON: storeMergeCanonical(payload.bundle) };
  renderStoreMergePreview();
}
function storeMergeReviewSummary(data) {
  const entries = data.preVisitInsights?.entries || [], reviews = data.preVisitInsightReviews || [];
  return `<p>分析卡 ${entries.length} 張；審核事件 ${reviews.length} 筆。</p>${entries.map(entry => { const review = insightReviewForEntry(data, entry); return `<p>${esc(entry.headline)} · <strong>${esc(INSIGHT_REVIEW_LABELS[review.status])}</strong>${review.reviewedAt ? ' · ' + esc(dateText(review.reviewedAt)) : ''}</p>`; }).join('')}`;
}
function storeMergeImpactHTML(ctx) {
  const { plan } = ctx, beforeRecords = project(ctx.currentPayload.bundle), ids = [plan.keeperId, plan.donorId];
  const pair = ids.map(id => beforeRecords.find(record => record.type === 'store' && record.id === id));
  const visits = beforeRecords.filter(record => record.type === 'visit' && (ids.includes(record.store) || record.versions.some(version => ids.includes(version.data.store))));
  const activeStores = beforeRecords.filter(record => record.type === 'store' && !record.deleted).length;
  const summary = plan.summary;
  const origins = pair.map((store, index) => `<section><h3>${index ? '退出有效清單，保留原 ID 與歷史' : '保留主檔 ID'}：${esc(store.name)}</h3><p>門市 ID：${esc(store.id)}<br>地址：${esc(store.address || '未提供')}<br>原存地圖網址：${esc(store.mapUrl || '未提供')}</p><p>拜訪 ${beforeRecords.filter(visit => visit.type === 'visit' && visit.store === store.id && !visit.deleted).length} 筆有效紀錄；門市歷史 ${store.versions.length} 版；任務 ${(store.nextRememberTasks || []).length} 項；完成歷史 ${reminderTaskHistory(store).length} 筆。</p>${storeMergeReviewSummary(store)}<details><summary>查看原門市全部歷史、提醒、分析與審核</summary>${store.versions.map(version => `<details><summary>${esc(dateText(version.at))} · ${esc(version.id)}${version.deleted ? ' · 回收桶' : ''}</summary>${reviewAttendanceHTML(version)}<pre>${esc(reviewValue(version.data))}</pre></details>`).join('')}</details></section>`).join('');
  const visitDetails = visits.map(visit => { const change = plan.changes.find(item => item.type === 'visit' && item.id === visit.id); return `<details class="store-merge-change"><summary>拜訪 ${esc(visit.id)} · ${visit.deleted ? '回收桶原狀保留' : change ? '調整目前門市歸屬，原文逐字不變' : '原文與歸屬不變'} · 歷史 ${visit.versions.length} 版</summary><p>目前門市：${esc(visit.store)} → ${esc(change?.after.store || visit.store)}</p><div class="quick-text-compare"><section><h4>修改前完整原文</h4><pre>${esc(visit.text || '')}</pre></section><section><h4>修改後完整原文</h4><pre>${esc(change?.after.text ?? visit.text ?? '')}</pre></section></div><details><summary>全部原有版本與來源欄位</summary>${visit.versions.map(version => `<article><p>${esc(version.id)} · ${esc(dateText(version.at))}</p>${reviewAttendanceHTML(version)}<pre>${esc(reviewValue(version.data))}</pre></article>`).join('')}</details></details>`; }).join('');
  const changes = plan.changes.map(change => `<details class="store-merge-change"><summary>${change.type === 'store' ? '門市' : '拜訪'} ${esc(change.before.name || change.id)}${change.type === 'store' && !ids.includes(change.id) ? ' · 其他門市的分析證據對應' : ''}${change.deleted ? ' · 退出有效清單' : ''}</summary><p>識別：${esc(change.id)}；目前版本：${esc(change.beforeHead)}</p>${change.type === 'store' ? `<h4>套用前分析與人工審核</h4>${storeMergeReviewSummary(change.before)}<h4>套用後分析與人工審核</h4>${storeMergeReviewSummary(change.after)}` : ''}${reviewFields(change.before, change.after)}<details><summary>完整修改前後欄位（包含來源與歷史對應）</summary><h4>修改前</h4><pre>${esc(reviewValue(change.before))}</pre><h4>修改後</h4><pre>${esc(reviewValue(change.after))}</pre></details></details>`).join('');
  return `<p><strong>唯讀預覽，尚未寫入任何資料。</strong></p><p>正式名稱：<strong>${esc(plan.name)}</strong>；有效門市 ${activeStores} → ${activeStores - 1} 間。確認後才新增 ${esc(summary.addedRevisions)} 個版本，並隨既有加密同步傳到其他裝置。</p><div class="store-merge-origins">${origins}</div><section class="store-merge-preservation"><h3>保留範圍與限制</h3><p>目前拜訪搬移歸屬 ${esc(summary.movedVisits)} 筆；回收桶拜訪 ${esc(summary.deletedVisitsPreserved)} 筆原狀保留。全部既有版本 ${ctx.currentPayload.bundle.ops.length} 版、Source Snapshot ${beforeRecords.filter(record => record.type === 'source').length} 筆、附件／原始來源 ${Object.keys(ctx.currentPayload.bundle.blobs).length} 份原樣保留。</p><p>合併後任務 ${esc(summary.tasks)} 項、已完成 ${esc(summary.completedTasks)} 項；保留分析卡 ${esc(summary.insightCards)} 張、沿用既有審核 ${esc(summary.carriedReviews)} 筆；另有 ${esc(summary.externalStores.length)} 間門市的分析來源對應受影響，逐筆列於下方。受影響分析中原已失效 ${esc(summary.staleCards)} 張，繼續保留且不恢復顯示。</p><p>所有實際拜訪確認維持原門市 ID、原日期與原來源，不新增今天拜訪，也不複製成新的確認。退出清單的原門市，其提醒、完成歷史、分析審核、拜訪與來源可從保留主檔的「合併來源與歷史」回看。</p><p>沿用既有審核會註明「同店整併」，保留當時審核時間與狀態；不把同店確認當成新的人物關係核准。「不符合」仍只留在審核歷史。</p><p><strong>這不是一鍵可撤銷的動作。</strong>回收桶還原不能撤銷整筆合併；如需更正，必須另行核對完整影響。正式套用前須選取並驗證本次資料的加密備份。</p></section>${plan.warnings?.length ? `<ul class="error">${plan.warnings.map(warning => `<li>${esc(typeof warning === 'string' ? warning : JSON.stringify(warning))}</li>`).join('')}</ul>` : ''}<details><summary>全部相關拜訪原文與版本 · ${visits.length} 筆</summary>${visitDetails || '<p>沒有相關拜訪紀錄。</p>'}</details><details open><summary>逐筆變更、分析卡與人工審核 · ${plan.changes.length} 筆</summary>${changes}</details>`;
}
function renderStoreMergePreview() {
  const ctx = storeMergePreview; assertStoreMergeCurrent(ctx);
  $('review-title').textContent = '同一門市 · 安全合併完整影響';
  $('review-body').innerHTML = `<div class="store-merge-preview">${storeMergeImpactHTML(ctx)}<section class="store-merge-backup"><h3>套用前的加密備份驗證</h3><p>先將加密備份存到自己的本機或外接碟，再選取該檔確認可讀且包含這次預覽的全部資料。只下載檔案不算驗證完成；本機驗證不代表離機副本已完成。</p><button type="button" id="store-merge-export-backup">下載本次合併前加密備份</button><label>選取已保存的加密備份<input id="store-merge-backup-file" type="file" accept=".pharmabackup,application/octet-stream,application/json"></label><p id="store-merge-backup-status" role="status">尚未驗證備份；正式套用目前鎖定。</p></section><button type="button" id="store-merge-export-preview">匯出唯讀影響預覽（含私人資料）</button><p id="store-merge-error" class="error" role="alert"></p><label class="check"><input id="store-merge-devices" type="checkbox">Mac 與 iPhone 都已更新至 v${esc(APP_VERSION)} 或更新版本，避免舊程式不能讀取合併審核資料。</label><label class="check"><input id="store-merge-ack" type="checkbox">我已核對逐筆影響，同意將這兩筆整併為「${esc(ctx.plan.name)}」，並保留上述原文、歷史、分析及審核。</label><div class="dialog-footer"><button type="button" data-close="review">取消，不修改</button><button type="button" id="store-merge-apply" class="primary" disabled>確認影響並正式套用合併</button></div></div>`;
  resetDialogScroll($('review')); updateStoreMergeControls();
}
async function exportStoreMergeBackup() {
  const ctx = storeMergePreview; assertStoreMergeCurrent(ctx);
  const envelope = await seal(ctx.currentPayload.bundle, ctx.sessionKey, ctx.sessionMeta);
  assertStoreMergeCurrent(ctx);
  download(JSON.stringify({ format: 'pharmacy-backup-1', envelope }), `pharmacy-before-store-merge-${new Date().toISOString().replace(/[:.]/g, '-')}.pharmabackup`, 'application/octet-stream');
  $('store-merge-backup-status').textContent = '已產生加密備份；請存到本機或外接碟，再選取保存的檔案驗證。尚未套用。';
}
async function verifyStoreMergeBackup(file) {
  const ctx = storeMergePreview; assertStoreMergeCurrent(ctx); ctx.verifiedBackup = null; updateStoreMergeControls();
  $('store-merge-backup-status').textContent = '尚未完成此次備份驗證；正式套用目前鎖定。';
  if (!file || file.size > 36 * 1024 * 1024) throw new Error('請選擇支援大小的加密備份。');
  const input = JSON.parse(await file.text()); assertStoreMergeCurrent(ctx);
  if (input.format !== 'pharmacy-backup-1') throw new Error('不是此 App 的加密備份。');
  const envelope = checkEnvelope(input.envelope);
  if (envelope.vaultId !== ctx.sessionMeta.vaultId || envelope.salt !== ctx.sessionMeta.salt) throw new Error('備份屬於另一個資料庫，尚未套用。');
  const bundle = validateBundle(await unseal(envelope, ctx.sessionKey)); assertStoreMergeCurrent(ctx);
  if (storeMergeCanonical(bundle) !== ctx.bundleJSON) throw new Error('備份內容與本次預覽不完全相同；請重新下載並驗證目前資料的備份。');
  for (const [id, bytes] of Object.entries(bundle.blobs)) { if (await hashBytes(unb64(bytes)) !== id) throw new Error('備份附件或原始來源校驗不符，尚未套用。'); assertStoreMergeCurrent(ctx); }
  ctx.verifiedBackup = { filename: file.name || '加密備份', bytes: file.size, verifiedAt: new Date().toISOString() };
  $('store-merge-backup-status').textContent = `已在本機解密並核對全部版本及來源：${ctx.verifiedBackup.filename}。這不代表已套用合併或完成離機還原演練。`;
  updateStoreMergeControls();
}
function exportStoreMergePreview() {
  const ctx = storeMergePreview; assertStoreMergeCurrent(ctx);
  if (!confirm('影響預覽含門市、拜訪原文、分析及人工審核等私人資料。只儲存到自己的本機或外接碟，避開 iCloud Drive，也不要上傳 GitHub。確認匯出？')) return;
  assertStoreMergeCurrent(ctx);
  const selected = [ctx.plan.keeperId, ctx.plan.donorId], inventory = project(ctx.currentPayload.bundle).filter(record => record.type === 'store' && selected.includes(record.id) || record.type === 'visit' && record.versions.some(version => selected.includes(version.data.store))).map(record => ({ type: record.type, id: record.id, deleted: record.deleted, versions: record.versions }));
  download(JSON.stringify({ format: 'pharmacy-store-merge-preview-1', appVersion: APP_VERSION, generatedAt: new Date().toISOString(), formalDataWritten: false, plan: ctx.plan, preservedInventory: inventory }, null, 2), 'pharmacy-store-merge-preview.json', 'application/json');
}
async function applyStoreMergePreview() {
  const ctx = storeMergePreview; assertStoreMergeCurrent(ctx);
  if (!$('store-merge-ack').checked || !$('store-merge-devices').checked || !ctx.verifiedBackup) throw new Error('請先驗證本次加密備份，確認 Mac 與 iPhone 都已更新，並勾選已核對實際影響。');
  if (!confirm(`正式合併為「${ctx.plan.name}」？\n\n另一筆退出有效清單，保留原 ID 與全部歷史。拜訪原文不改寫；分析與既有審核按預覽保留。這次不記錄實際拜訪日期。\n確認後會加密保存並同步到 Mac 與其他裝置。這不是一鍵可撤銷的動作。`)) return;
  assertStoreMergeCurrent(ctx);
  const disk = await readLocal(); assertStoreMergeCurrent(ctx);
  if (!disk || disk.revision !== ctx.expected) throw new Error('另一個視窗已改變本機資料；請重新開啟並預覽，尚未套用。');
  const fresh = await planStoreMerge(payload.bundle, ctx.options); assertStoreMergeCurrent(ctx);
  if (JSON.stringify(fresh) !== ctx.planJSON) throw new Error('合併結果已改變；請重新核對完整影響，尚未套用。');
  const result = await applyStoreMerge(payload.bundle, ctx.plan, payload.device); assertStoreMergeCurrent(ctx);
  await persist({ ...payload, bundle: result.bundle, dirty: true }, { guard: () => assertStoreMergeCurrent(ctx) });
  storeMergePreview = null; storeMergeSetup = null; qualityReview = null; $('review-body').replaceChildren(); $('review').close(); render();
  toast('已依確認結果保存合併；原文、歷史與審核保留，等待 Mac 同步確認。');
}
function storeMergeOriginsHTML(store) {
  const history = store.storeMergeHistory || [];
  if (!history.length) return '';
  return `<details class="store-merge-origin-history"><summary>合併來源與歷史 · ${history.length} 次</summary><p>原門市 ID 與全部舊版本保留；這裡可唯讀查看合併來源，不提供一鍵撤銷合併。</p>${history.map(item => `<p>${esc(item.donorName)} → ${esc(item.name)} <button type="button" class="text-button" data-merged-origin="${esc(item.donorId)}" data-merged-keeper="${esc(store.id)}">查看 ${esc(item.donorName)} 的原始資料與歷史</button></p>`).join('')}</details>`;
}
function openMergedStoreOrigin(keeperId, donorId) {
  if (singleStoreContext || inlineTextContext || reminderContext || editorContext || payload?.inlineTextDraft) throw new Error('請先完成或收起目前修改，再查看合併來源；原草稿保留。');
  const keeper = by('store', keeperId), donor = by('store', donorId);
  if (!keeper?.storeMergeHistory?.some(item => item.donorId === donorId) || !donor) throw new Error('找不到這筆合併來源，請重新開啟門市。');
  const visits = records.filter(record => record.type === 'visit' && record.versions.some(version => version.data.store === donorId));
  const history = storeInsightReviewHistory(donor);
  $('review-title').textContent = '合併來源與歷史｜' + donor.name;
  $('review-body').innerHTML = `<p>唯讀留存；目前主檔：${esc(keeper.name)}。原 ID：${esc(donor.id)}。原拜訪確認維持原來源，不改算今天。</p><button type="button" data-visit-brief="${esc(keeperId)}">返回 ${esc(keeper.name)}</button>${storeAttendanceHTML(donorId, true)}${reminderTasksHTML(donor, false, true)}${donor.nextRemember ? `<h3>原下次記得</h3><pre>${esc(donor.nextRemember)}</pre>` : ''}${donor.everyTimeMust ? `<h3>原每次必做、必給</h3><pre>${esc(donor.everyTimeMust)}</pre>` : ''}<details><summary>原分析卡與人工審核留存 · 歷史 ${history.length} 筆</summary>${storeMergeReviewSummary(donor)}<pre>${esc(reviewValue({ insights: donor.preVisitInsights || null, reviews: history }))}</pre></details><details><summary>原門市全部版本、來源與合併去向 · ${donor.versions.length} 版</summary>${donor.versions.map(version => `<article><p>${esc(version.id)} · ${esc(dateText(version.at))}</p>${reviewAttendanceHTML(version)}<pre>${esc(reviewValue(version.data))}</pre></article>`).join('')}</details><details><summary>曾屬於原門市的拜訪 · ${visits.length} 筆（含回收桶）</summary>${visits.map(visit => `<details><summary>${esc(visit.id)}${visit.deleted ? ' · 回收桶' : ''} · ${visit.versions.length} 個保留版本</summary>${visit.versions.map(version => `<article><p>${esc(version.id)} · 原歸屬 ${esc(version.data.store)}</p>${reviewAttendanceHTML(version)}<pre>${esc(reviewValue(version.data))}</pre></article>`).join('')}</details>`).join('') || '<p>沒有曾屬於此 ID 的拜訪。</p>'}</details><p class="muted">一般回收桶還原不能撤銷合併；如需更正，須另行預覽並確認所有連動資料。</p>`;
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
  const supervisor = by(focus.type, focus.id);
  if (supervisor?.type==='person' && supervisor.supervisorKey && !supervisor.conflict && !supervisor.deleted && !supervisor.sameAs) return renderSimpleSupervisor(supervisor);
  document.body.classList.remove('supervisor-simple-page');
  $('explore-view').classList.remove('simple-supervisor-view');
  const r = by(focus.type, focus.id);
  if (!r) { $('focus-header').innerHTML = '<h2>建立第一個探索起點</h2><p>先新增門市，再記錄拜訪。</p>'; $('focus-detail').innerHTML = ''; $('graph').innerHTML = ''; $('evidence-list').innerHTML = ''; $('evidence-count').textContent = '0'; return; }
  const vv = related(), storeIDs = r.csvTag ? all('store').filter(s => !storeIdentityPending(s) && sourceTags(s).includes(r.csvTag)).map(s => s.id) : [...new Set(vv.map(v => v.store))];
  if (r.type === 'person') for (const store of supervisedStores(records,r.id)) if (!storeIDs.includes(store.id)) storeIDs.push(store.id);
  $('focus-header').innerHTML = `<div class="focus-top"><span class="pill ${r.type === 'person' && !r.confirmed ? 'warn' : ''}">${kinds[r.type]}${r.type === 'person' ? r.confirmed ? ' · 已核對' : ' · 待確認' : ''}</span><div class="focus-actions">${trail.length ? '<button id="back-node" class="text-button">← 上一個節點</button>' : ''}${r.type === 'person' ? `<button class="text-button" data-edit="person:${esc(r.id)}">編輯個人資訊</button><button class="text-button" data-history="person:${esc(r.id)}">個人資料歷史</button>${supervisorOriginStore ? '<button id="supervisor-return-store" class="text-button">返回原門市</button>' : ''}` : ''}<button id="candidate-overview" class="text-button">跨店候選摘要</button></div></div><h2>${esc(r.name)}</h2><p class="muted">${esc(r.type === 'store' ? `${r.city} ${r.district} · ${r.channel}` : r.type === 'person' ? r.role : r.desc)}</p>${r.conflict ? `<button class="danger" data-review="${r.type}:${esc(r.id)}">先處理這個節點的衝突</button>` : ''}`;
  const pendingIdentity = storeIdentityPending(r), topics = pendingIdentity ? [] : [...new Set(vv.flatMap(v => v.topics))], people = pendingIdentity ? [] : [...new Set(vv.flatMap(v => v.people))];
  if (r.type === 'store' && !pendingIdentity) topics.push(...all('topic').filter(t => t.csvTag && sourceTags(r).includes(t.csvTag)).map(t => t.id));
  const candidates = r.type === 'store' && !pendingIdentity ? relationCandidates(r.id) : [];
  const candidateHTML = r.type === 'store' ? `<h3>原文候選關聯</h3><p class="muted">系統只建立可追溯到原文的唯讀候選，不會把候選當成已確認需求。點節點可查看原句、來源與其他門市。</p><div class="candidate-chip-list">${candidates.map(item => `<button type="button" class="candidate-chip ${esc(item.statusKind)}" data-candidate-key="${esc(item.key)}" data-candidate-store="${esc(r.id)}"><strong>${esc(item.name)}</strong><span>${esc(item.category)} · ${esc(item.statusLabel)} · ${item.visitCount} 筆</span></button>`).join('') || '<span class="muted">目前原文沒有命中可稽核規則；系統不會為了填滿關聯圖而猜測。</span>'}</div>` : '';
  $('focus-detail').innerHTML = `<div class="metrics"><div><strong>${storeIDs.length}</strong><span>相關門市</span></div><div><strong>${vv.length}</strong><span>相關原文</span></div><div><strong>${vv.filter(v => v.csvSources?.length).length}</strong><span>可追溯 CSV</span></div>${r.type === 'store' ? `<div><strong>${candidates.length}</strong><span>候選關聯</span></div>` : ''}</div>${r.type === 'store' ? `${storeSupervisionHTML(r)}${monthlyAnalysisStoreHTML(r)}<h3>門市窗口</h3><p>${esc(r.contact)}</p><p class="muted">${esc(r.attr)}</p><p>${esc(r.address || '')}</p><p class="muted">${esc((r.lists || []).join('、'))}</p><p>${sourceTags(r).map(t => `<span class="pill">${esc(t)}</span>`).join(' ')}</p>${sourceButton(r)}` : ''}${r.type === 'person' ? `${supervisorProfileHTML(r)}<h3>個人資訊與備註</h3><p>${esc(r.desc || '尚未填寫，可按編輯個人資訊新增。')}</p>${r.sameAs ? `<p>已確認連到 ${chip('person', r.sameAs)}</p>` : ''}` : ''}<h3>已明確連結的主題</h3><div class="chips">${topics.map(id => chip('topic', id)).join('') || '<span class="muted">尚未手動連結主題</span>'}</div><h3>已明確連結的人物</h3><div class="chips">${people.map(id => chip('person', id)).join('') || '<span class="muted">尚未手動連結人物</span>'}</div>${candidateHTML}<div class="insight"><h3>證據層級</h3><p>「已明確連結」與「系統候選」分開顯示。原文提及、否定／未遇到、詢問／待釐清都保留各自狀態；共同提及不能直接當成市場需求或人際關係。</p></div>`;
  if (pendingIdentity) $('focus-detail').innerHTML = '<p class="conflict-card">需要後續的確認：原文保留，門市身分核實前暫不建立關聯。請到編輯門市核實名稱與來源後，明確勾選已核對身分。</p>' + sourceButton(r);
  $('evidence-list').innerHTML = vv.map(noteHTML).join('') || '<p class="empty">尚無相關拜訪紀錄。</p>'; $('evidence-count').textContent = vv.length;
  drawGraph();
}
function drawGraph() {
  if (!payload || activeView !== 'explore' || (focus.type==='person' && by('person',focus.id)?.supervisorKey)) return;
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
  if (focus.type === 'store' && r.supervision && supervisedStores(records,r.supervision.personId).some(s=>s.id===r.id)) {add('person',r.supervision.personId);const link=links.find(n=>n.type==='person' && n.id===r.supervision.personId);if(link)link.organizationLabel='負責督導';}
  if (focus.type === 'person') for (const s of supervisedStores(records,r.id)) {add('store',s.id);const link=links.find(n=>n.type==='store' && n.id===s.id);if(link)link.organizationLabel='所轄門市';}
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
    const subtitle = n.organizationLabel || (n.candidate ? `${n.statusLabel} · ${n.visitCount}筆` : pending ? '同名待核對' : r.csvTag ? '原始標籤相同' : focus.type === 'topic' ? evidenceKind(visits.filter(v => v.store === n.id).map(v => v.text).join('\n'), entityRule(r)).label : kinds[n.type]);
    const attrs = n.candidate ? `data-candidate-key="${esc(n.key)}" data-candidate-store="${esc(n.storeId)}"` : `data-node-type="${n.type}" data-node-id="${esc(n.id)}"`;
    shapes += `<g class="node ${n.candidate ? 'candidate' : pending ? 'pending' : ''}" role="button" tabindex="0" aria-label="${n.candidate ? '查看候選關聯' : '探索'}${esc(e.name)}" ${attrs}><title>${esc(e.name)} · ${esc(n.candidate ? n.category + ' · ' + n.statusLabel + '；系統候選不是已確認事實' : subtitle)}</title><rect x="${x - nw / 2}" y="${y - 27}" width="${nw}" height="54" rx="9"/><text x="${x}" y="${y - 2}" text-anchor="middle">${esc(label)}</text><text class="sub" x="${x}" y="${y + 16}" text-anchor="middle">${esc(subtitle)}</text></g>`;
  });
  $('graph').innerHTML = `<title>${esc(r.name)}的相關節點</title>${edges}${shapes}<g class="node center"><rect x="${cx - 82}" y="${cy - 30}" width="164" height="60" rx="10"/><text class="sub" x="${cx}" y="${cy - 8}" text-anchor="middle">目前中心 · ${kinds[r.type]}</text><text x="${cx}" y="${cy + 13}" text-anchor="middle">${esc(r.name.slice(0, 11))}</text></g>`;
}
function storeVisitSearchRank(store, needle) {
  if (!needle) return 0;
  const lower = value => visitStoreNameText(value).toLocaleLowerCase('zh-Hant');
  const storeName = lower(store?.name), q = lower(needle);
  if (storeName === q) return 0;
  if (storeName.includes(q)) return 1;
  if (visitStoreSourceNames(store).some(alias => lower(alias).includes(q))) return 1;
  return Infinity;
}
// These are existing store fields, not visit records. Read them directly for
// display/search only; never infer a visit, copy text into one, or pick a conflict.
function storeOriginalTextFields(store) {
  if (!store || store.deleted || store.mergedInto || store.conflict) return [];
  return [['attr', '門市特性／客群'], ['contact', '主要窗口']]
    .filter(([field]) => typeof store[field] === 'string' && store[field].trim())
    .map(([field, label]) => ({ field, label, text: store[field] }));
}
function storeOriginalTextMatch(store, query = '') {
  const needle = String(query).trim().toLocaleLowerCase('zh-Hant');
  return !!needle && storeOriginalTextFields(store).some(item => item.text.toLocaleLowerCase('zh-Hant').includes(needle));
}
function storeOriginalTextHTML(store, query = '') {
  if (!store || store.deleted || store.mergedInto) return '';
  if (store.conflict) {
    const hasText = store.heads?.some(head => ['attr', 'contact'].some(field => typeof head.data?.[field] === 'string' && head.data[field].trim()));
    return hasText ? `<section class="store-original-text store-original-text-conflict"><strong>門市原有文字 · 版本待核對</strong><p class="muted">門市資料有衝突，尚未選定目前內容。</p><button type="button" class="text-button" data-review="store:${esc(store.id)}">核對門市文字版本</button></section>` : '';
  }
  const fields = storeOriginalTextFields(store);
  if (!fields.length) return '';
  return `<section class="store-original-text" data-store-original-text="${esc(store.id)}" aria-label="門市原有文字"><div class="store-original-text-heading"><strong>門市原有文字</strong><span class="muted">唯讀</span></div>${storeIdentityPending(store) ? '<p class="muted">門市身分待確認；以下保留此筆門市填寫的內容。</p>' : ''}${fields.map(item => `<div class="store-original-text-field"><span class="store-original-text-label">${esc(item.label)}</span><pre data-store-original-field="${item.field}"><span>${highlightLiteral(item.text, query).replace(/\r/g, '&#13;')}</span></pre></div>`).join('')}</section>`;
}
function visitStoreNameText(value) {
  return String(value ?? '').replace(/[\r\n]/g, '');
}
var monthlyAlertBadgeCache;
function monthlyAlertBadgeContent(storeId) {
  const bundle = payload?.bundle, month = monthlyVisitMonth();
  if (!bundle) return '';
  if (monthlyAlertBadgeCache?.bundle !== bundle || monthlyAlertBadgeCache.month !== month) {
    monthlyAlertBadgeCache = { bundle, month, salesMonths: monthlyAlertSalesMonths(bundle, month) };
  }
  const salesMonth = monthlyAlertBadgeCache.salesMonths.get(storeId);
  return salesMonth ? `<span class="monthly-alert-badge"><span aria-hidden="true">⚠</span> ${Number(salesMonth.slice(-2))}月警示店</span>` : '';
}
function monthlyAlertBadgeHTML(storeId) {
  return `<span class="monthly-alert-slot" data-monthly-alert-store="${esc(storeId)}">${monthlyAlertBadgeContent(storeId)}</span>`;
}
function refreshMonthlyAlertBadges() {
  if (!payload || document.hidden) return;
  document.querySelectorAll('#recent-store-list [data-monthly-alert-store], #visit-list [data-monthly-alert-store]').forEach(slot => {
    // Keep title buttons and editable notes in place when the calendar changes.
    const badge = monthlyAlertBadgeContent(slot.dataset.monthlyAlertStore);
    if (slot.innerHTML !== badge) slot.innerHTML = badge;
  });
}
function visitStoreNameHTML(value, query = '') {
  const text = String(value ?? ''), needle = visitStoreNameText(query).trim();
  if (!needle || !/[\r\n]/.test(text)) return highlightLiteral(text, needle);
  // Single-line inputs remove CR/LF. Map each remaining UTF-16 position back to
  // the untouched name so a match crossing a line break highlights literal parts.
  const offsets = [];
  for (let index = 0; index < text.length; index++) if (text[index] !== '\r' && text[index] !== '\n') offsets.push(index);
  const pattern = new RegExp(regexEscape(needle), 'giu'), singleLine = visitStoreNameText(text);
  let html = '', last = 0, ignoredLineBreak = false, match;
  while ((match = pattern.exec(singleLine))) {
    const start = offsets[match.index], end = offsets[match.index + match[0].length - 1] + 1;
    const original = text.slice(start, end);
    ignoredLineBreak ||= /[\r\n]/.test(original);
    html += esc(text.slice(last, start)) + original.split(/([\r\n]+)/).map(part => /[\r\n]/.test(part) ? esc(part) : part ? '<mark class="search-match">' + esc(part) + '</mark>' : '').join('');
    last = end;
  }
  if (!ignoredLineBreak) return highlightLiteral(text, needle);
  return `<span style="white-space:pre-wrap">${html + esc(text.slice(last))}</span><span class="muted">（名稱換行已忽略）</span>`;
}
function visitStoreSourceNames(store) {
  if (!store) return [];
  return [...new Set([...(store.csvAliases || []), ...originalStoreNames(store)])]
    .filter(value => value.trim() && value !== store.name);
}
function visitStoreAliasMatchHTML(store, query = '') {
  if (!query) return '';
  const q = visitStoreNameText(query).toLocaleLowerCase('zh-Hant');
  const matches = visitStoreSourceNames(store).filter(alias => visitStoreNameText(alias).toLocaleLowerCase('zh-Hant').includes(q));
  return matches.length ? `<p class="muted">來源名稱：${matches.map(alias => visitStoreNameHTML(alias, query)).join('／')}</p>` : '';
}
function visitStoreCardHTML(store, query = '', unresolvedVisits = []) {
  const pending = storeIdentityPending(store), associationPending = unresolvedVisits.length > 0;
  const target = store.conflict ? `data-review="store:${esc(store.id)}"` : associationPending ? `data-review="visit:${esc(unresolvedVisits[0].id)}"` : pending ? `data-edit="store:${esc(store.id)}"` : `data-visit-brief="${esc(store.id)}"`;
  const hasStoreNotes = !!(store.nextRemember || store.everyTimeMust || store.nextRememberTasks?.some(task => !task.completedAt));
  const reminders = store.conflict || associationPending ? '' : `<div class="store-memory ${hasStoreNotes ? '' : 'empty'}">${reminderTasksHTML(store, true, false)}${store.nextRemember ? `<p><strong>下次記得（尚未轉成任務）：</strong>${esc(store.nextRemember)}</p>` : ''}${store.everyTimeMust ? `<p><strong>每次必做、必給：</strong>${esc(store.everyTimeMust)}</p>` : ''}<button type="button" class="text-button store-reminder-edit" data-store-reminder="${esc(store.id)}">${hasStoreNotes ? '修改門市提醒' : '＋ 填寫門市提醒'}</button></div>`;
  const notice = store.conflict ? '<p class="conflict-card">門市資料有衝突，請先核對版本。</p>' : pending ? `<p class="muted">${associationPending ? '門市身分待確認，仍須人工核對。' : '門市身分待確認；可先記錄拜訪，不會自動合併門市。'}</p>` : '';
  const actions = store.conflict ? `<button type="button" class="secondary" data-review="store:${esc(store.id)}">比較並處理衝突</button>` : associationPending ? '' : `${!pending ? `<button type="button" class="secondary" data-visit-brief="${esc(store.id)}">單店拜訪</button>` : ''}<button type="button" class="primary" data-new-visit-store="${esc(store.id)}">＋ 記錄這次拜訪</button>`;
  const associationActions = unresolvedVisits.map((visit, index) => `<button type="button" class="secondary" data-review="visit:${esc(visit.id)}">核對拜訪衝突${unresolvedVisits.length > 1 ? ' ' + (index + 1) : ''}</button>`).join('');
  const noteStatus = associationPending ? '<p class="conflict-card">有拜訪紀錄的門市歸屬待核對</p><p class="muted">未決版本提到此門市，不代表拜訪已歸屬此店；請先核對衝突版本。</p>' : `<p class="muted">${storeOriginalTextFields(store).length ? '尚未另建拜訪紀錄；既有內容請見上方「門市原有文字」。' : '尚無拜訪紀錄。'}</p>`;
  return `<article class="note" data-visit-empty-store="${esc(store.id)}"${associationPending ? ' data-visit-association-pending="true"' : ''}><button type="button" class="text-button store-link" ${target}>${visitStoreNameHTML(store.name, query)}${monthlyAlertBadgeHTML(store.id)}</button>${visitStoreAliasMatchHTML(store, query)}${storeAttendanceHTML(store.id)}${reminders}${storeOriginalTextHTML(store, query)}${noteStatus}${notice}<div class="note-actions">${actions}${associationActions}</div></article>`;
}
function visitSearchRank(v, needle) {
  if (!needle) return 0;
  const lower = value => String(value ?? '').toLocaleLowerCase('zh-Hant'), q = lower(needle);
  const storeRank = storeVisitSearchRank(by('store', v.store) || { name: name('store', v.store) }, needle);
  if (Number.isFinite(storeRank)) return storeRank;
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
  const storeName = name('store', v.store);
  if (lower(visitStoreNameText(storeName)).includes(lower(visitStoreNameText(query)))) return `<span class="muted">${lower(storeName).includes(q) ? '門市名稱符合搜尋字詞' : '門市名稱符合搜尋字詞（名稱換行已忽略）'}</span>`;
  const aliases = visitStoreAliasMatchHTML(by('store', v.store), query);
  if (aliases) return aliases;
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
  const matchLabel = group.storeTextMatch ? `門市原有文字命中 · 拜訪命中 ${group.matches.length} 筆 · 共 ${total} 筆` : `${group.matches.length} 筆命中 · 共 ${total} 筆`;
  return `<section class="visit-search-group"><div class="visit-search-group-head"><button class="text-button store-link" ${target}>${visitStoreNameHTML(name('store', group.storeId), query)}${monthlyAlertBadgeHTML(group.storeId)}</button><span class="pill${group.storeTextMatch ? ' visit-search-profile-match' : ''}">${matchLabel}</span></div>${storeAttendanceHTML(group.storeId)}${storeOriginalTextHTML(store, query)}<div class="visit-search-preview">${lead ? visitSearchPreview(lead, query) : ''}</div><details class="visit-search-details"><summary>展開這間藥局全部 ${total} 筆拜訪紀錄</summary><div class="visit-search-expanded">${group.allVisits.map((v, index) => noteHTML(v, query, { showStoreText: false, showStoreReminders: index === 0 })).join('')}</div></details></section>`;
}
// Day itinerary actions only change datePlans / datePlanOrder. They never call
// task completion, attendance confirmation, or note editing.
function monthlyVisitLabel(month) { return `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`; }
function monthlyVisitGroup(storeId) {
  const group = retailChannel(by('store', storeId));
  return group.id === 'great-tree' ? { id: 'tree', label: '大樹' } : group.id === 'you-chuan' ? { id: 'you', label: '佑全／健康人生' } : { id: 'other', label: '其他／未分群' };
}
function storeSelectionIdentity(storeId) {
  const store = by('store', storeId); if (!store) return '';
  const sameName = records.filter(row => row.type === 'store' && row.name === store.name && !row.mergedInto);
  if (sameName.length < 2) return '';
  const address = String(store.address || '').trim();
  const distinguishable = address && sameName.every(row => row.id === storeId || String(row.address || '').trim() !== address);
  return distinguishable ? address : [address || '地址未填', `識別碼 ${storeId}`].join(' · ');
}
function monthlyVisitRowsHTML(rows, past, removed = false) {
  const groups = new Map();
  for (const row of rows) { const district = row.district || '地區未填'; if (!groups.has(district)) groups.set(district, []); groups.get(district).push(row); }
  return [...groups].map(([district, list]) => `<section class="monthly-district"><h3>${esc(district)}</h3>${list.map(row => {
    const group = monthlyVisitGroup(row.storeId), canOpen = row.available, dates = row.dates || [], identity = storeSelectionIdentity(row.storeId);
    return `<div class="monthly-store-row"><button class="text-button monthly-store-open" ${canOpen ? `data-visit-brief="${esc(row.storeId)}"` : 'disabled'} aria-label="開啟${esc(row.name)}${row.completed ? '，本月已拜訪' : ''}"><span class="monthly-check ${row.completed ? 'is-complete' : ''}" aria-hidden="true">${row.completed ? '✓' : ''}</span><span class="monthly-store-copy"><span class="monthly-dot ${group.id}" aria-hidden="true"></span>${esc(row.name)}${identity ? `<small>${esc(identity)}</small>` : ''}${dates.length ? `<small>已拜訪 ${dates.map(date => esc(date.slice(5).replace('-', '/'))).join('、')}</small>` : ''}${!row.available ? `<small class="error">${esc(row.unavailableReason)}</small>` : ''}</span><span aria-hidden="true">›</span></button>${!past && row.available ? `<button class="text-button monthly-store-remove" ${removed ? `data-monthly-add-back="${esc(row.storeId)}"` : `data-monthly-remove="${esc(row.storeId)}"`} aria-label="${removed ? '重新加入' : '從' + esc(monthlyVisitLabel(monthlyVisitSelectedMonth)) + '移除'}${esc(row.name)}">${removed ? '重新加入' : '移除'}</button>` : ''}</div>`;
  }).join('')}</section>`).join('');
}
function renderMonthlyVisits() {
  if (!monthlyVisitSelectedMonth) monthlyVisitSelectedMonth = monthlyVisitMonth();
  const month = monthlyVisitSelectedMonth, current = monthlyVisitMonth(), past = month < current;
  const overview = monthlyVisitOverview(payload.bundle, month), doneOpen = $('monthly-completed')?.open || false;
  monthlyVisitViewBasis = monthlyVisitBasis(records, month);
  const counts = ['tree', 'you', 'other'].map(id => ({ id, rows: overview.stores.filter(row => monthlyVisitGroup(row.storeId).id === id) })).filter(group => group.rows.length);
  const content = $('monthly-visit-content');
  // Native iPhone month/date pickers keep ownership of the same input node.
  // Refresh results independently, without removing or re-inserting its controls.
  if (!content.querySelector('#monthly-visit-month')) content.innerHTML = `<div class="monthly-toolbar"><div class="monthly-month-controls"><button id="monthly-previous-month" type="button" data-monthly-shift="-1" aria-label="上一個月">‹</button><label class="sr-only" for="monthly-visit-month">查看與調整月份</label><input id="monthly-visit-month" type="month" min="0001-01" max="9999-12" aria-label="查看與調整月份"><button id="monthly-next-month" type="button" data-monthly-shift="1" aria-label="下一個月">›</button></div><span id="monthly-readonly-month" class="pill" hidden>歷史月份 · 唯讀</span><button id="monthly-add-store" type="button" class="primary" data-monthly-select>＋ 新增門市</button></div><div id="monthly-visit-results"></div>`;
  const monthInput = $('monthly-visit-month');
  if (monthInput.value !== month) monthInput.value = month;
  $('monthly-previous-month').disabled = month === '0001-01';
  $('monthly-next-month').disabled = month === '9999-12';
  $('monthly-readonly-month').hidden = !past; $('monthly-add-store').hidden = past;
  $('monthly-visit-results').innerHTML = `${analysisOverviewHTML(month)}<div class="monthly-heading"><h2>${esc(monthlyVisitLabel(month))}${month === current ? ' · 本月' : ''}</h2>${month !== current ? '<button type="button" class="text-button" data-monthly-current>回本月</button>' : ''}</div><section class="panel monthly-progress" aria-label="當月必訪進度"><div><strong>待訪 ${overview.pending.length} 間</strong><span role="status">已訪 ${overview.completedCount} / ${overview.total} 間</span></div><div class="monthly-legend">${counts.map(group => `<span><i class="monthly-dot ${group.id}" aria-hidden="true"></i>${{ tree: '大樹', you: '佑全／健康人生', other: '其他／未分群' }[group.id]} ${group.rows.filter(row => row.completed).length}/${group.rows.length}</span>`).join('')}</div></section><p id="monthly-visit-notice" class="muted" role="status" aria-live="polite" ${monthlyVisitNotice ? '' : 'hidden'}>${esc(monthlyVisitNotice)}</p><section class="panel monthly-list" aria-label="當月必訪名單">${overview.pending.length ? monthlyVisitRowsHTML(overview.pending, past) : overview.total ? '<p class="monthly-complete">✓ 本月必訪門市皆已完成</p>' : `<p class="empty">這個月尚未安排必訪門市。${past ? '' : '請按「新增門市」從既有門市選入。'}</p>`}${overview.completed.length ? `<details id="monthly-completed" ${doneOpen ? 'open' : ''}><summary>已拜訪 · ${overview.completed.length} 間</summary>${monthlyVisitRowsHTML(overview.completed, past)}</details>` : ''}</section>${overview.removedStores.length ? `<details class="monthly-removed"><summary>本月已移除 · ${overview.removedStores.length} 間</summary>${monthlyVisitRowsHTML(overview.removedStores, past, true)}</details>` : ''}<details class="monthly-help"><summary>名單調整與完成依據</summary><p class="muted">各月份名單分別保存。新增或移除不會改動其他月份、門市原文或拜訪歷史；過去月份保留唯讀。只有你勾選實際拜訪日期並完成儲存，才依該日期自動計入對應月份。修改文字、安排行程及完成待辦都不算拜訪。同店同月計一次。</p></details>`;
}
// A pending version probe is read-only. Opening a local planner invalidates
// that probe's session before it can start any snapshot exchange.
function assertMonthlyVisitIdle() {
  releaseIdleInlineEdit();
  if (!payload || payload.monthlyFeedbackDraft || monthlyFeedbackContext || document.hidden || pendingLock || updateHolding || syncInProgress || monthlyVisitContext || dayPlanContext || editorContext || reminderContext || singleStoreContext || inlineTextContext || payload.inlineTextDraft || document.querySelector('dialog[open]') || csvImport.hasPending()) throw new Error(syncInProgress ? '正在交換資料，請等待同步結束後再調整每月名單。' : '請先完成或關閉目前的編輯，再調整每月名單。');
}
function newMonthlyVisitContext(kind) {
  assertMonthlyVisitIdle();
  if (!monthlyVisitSelectedMonth) monthlyVisitSelectedMonth = monthlyVisitMonth();
  if (monthlyVisitSelectedMonth < monthlyVisitMonth()) throw new Error('過去月份名單保留歷史，不能在此修改。');
  return { kind, month: monthlyVisitSelectedMonth, key, meta, bundle: payload.bundle, revision: localRevision, epoch: syncEpoch, today: attendanceTaipeiDate(Date.now()), basis: monthlyVisitViewBasis || monthlyVisitBasis(records, monthlyVisitSelectedMonth) };
}
function assertMonthlyVisitContext(ctx) {
  if (!ctx || !payload || key !== ctx.key || meta !== ctx.meta || payload.bundle !== ctx.bundle || localRevision !== ctx.revision || syncEpoch !== ctx.epoch || monthlyVisitSelectedMonth !== ctx.month || syncInProgress || document.hidden || pendingLock || updateHolding || ctx.today !== attendanceTaipeiDate(Date.now())) throw new Error('資料、工作階段或日期已改變；尚未寫入。請關閉後重新開啟每月名單。');
}
function resumeMonthlyVisitContext() {
  const ctx = monthlyVisitContext;
  if (ctx && !busy && !syncInProgress && payload && !document.hidden && !pendingLock && !updateHolding && key === ctx.key && meta === ctx.meta && payload.bundle === ctx.bundle && localRevision === ctx.revision && ctx.month === monthlyVisitSelectedMonth && ctx.today === attendanceTaipeiDate(Date.now())) ctx.epoch = syncEpoch;
}
function openMonthlyVisitSelection() {
  const ctx = newMonthlyVisitContext('selection'); ctx.query = ''; monthlyVisitContext = ctx;
  $('monthly-visit-title').textContent = `${monthlyVisitLabel(ctx.month)} · 新增必訪門市`;
  $('monthly-visit-error').textContent = '';
  $('monthly-visit-fields').innerHTML = '<label>搜尋既有門市<input id="monthly-store-search" type="search" placeholder="店名、地區、地址或來源名稱" autocomplete="off"></label><p id="monthly-selection-count" role="status"></p><div id="monthly-store-options"></div>';
  renderMonthlyVisitChoices(''); openDialog($('monthly-visit-dialog'));
}
function renderMonthlyVisitChoices(query) {
  const ctx = monthlyVisitContext; if (ctx?.kind !== 'selection') return;
  ctx.query = query;
  const stores = project(payload.bundle).filter(store => store.type === 'store' && !store.deleted && !store.mergedInto).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  const needle = String(query).trim().toLocaleLowerCase(), overview = monthlyVisitOverview(payload.bundle, ctx.month);
  $('monthly-selection-count').textContent = `${monthlyVisitLabel(ctx.month)}已加入 ${overview.total} 間`;
  $('monthly-store-options').innerHTML = stores.filter(store => [store.name, store.city, store.district, store.address, ...(store.csvAliases || [])].some(value => String(value || '').toLocaleLowerCase().includes(needle))).map(store => {
    const active = monthlyVisitForStore(store, ctx.month)?.active, available = !store.conflict && !storeIdentityPending(store), group = monthlyVisitGroup(store.id);
    return `<div class="monthly-store-choice"><span><strong><i class="monthly-dot ${group.id}" aria-hidden="true"></i>${esc(store.name)}</strong><small>${esc([store.city, store.district, storeSelectionIdentity(store.id)].filter(Boolean).join(' · '))}${!available ? ' · 門市狀態待確認' : ''}</small></span><button type="button" data-monthly-add="${esc(store.id)}" aria-label="加入${esc(store.name)}${storeSelectionIdentity(store.id) ? '，' + esc(storeSelectionIdentity(store.id)) : ''}" ${active || !available ? 'disabled' : ''}>${active ? '已加入' : '加入'}</button></div>`;
  }).join('') || '<p class="empty">沒有符合的門市。請先在「門市」建立門市資料。</p>';
}
function closeMonthlyVisitSelection() {
  if (busy || !monthlyVisitContext) return;
  monthlyVisitContext = null; $('monthly-visit-dialog').close(); $('monthly-visit-fields').replaceChildren(); $('monthly-visit-error').textContent = ''; dismissKeyboard(); syncScheduler.wake();
}
async function performMonthlyVisitAction(action, storeId, fromPicker = false) {
  const ctx = fromPicker ? monthlyVisitContext : newMonthlyVisitContext('action');
  if (fromPicker && ctx?.kind !== 'selection') throw new Error('請重新開啟新增必訪門市。');
  assertMonthlyVisitContext(ctx);
  const storeName = by('store', storeId)?.name || '門市';
  if (action === 'remove' && !confirm(`只從 ${monthlyVisitLabel(ctx.month)}必訪名單移除「${storeName}」？\n門市、原文、實際拜訪紀錄及其他月份的名單都保留。`)) return;
  if (!fromPicker) monthlyVisitContext = ctx;
  try {
    const bundle = applyMonthlyVisitAction(payload.bundle, { month: ctx.month, storeId, action, expectedBasis: ctx.basis }, payload.device);
    if (bundle === payload.bundle) return toast('名單沒有變更，未建立新版本。');
    await persist({ ...payload, bundle, dirty: true }, { guard: () => assertMonthlyVisitContext(ctx) });
    if (fromPicker) Object.assign(ctx, { bundle: payload.bundle, revision: localRevision, epoch: syncEpoch, basis: monthlyVisitBasis(project(payload.bundle), ctx.month) });
    const completed = monthlyVisitOverview(payload.bundle, ctx.month).completed.some(row => row.storeId === storeId);
    monthlyVisitNotice = action === 'remove' ? `已從 ${monthlyVisitLabel(ctx.month)}移除${storeName}；原文及拜訪紀錄均保留。` : `${storeName}已加入 ${monthlyVisitLabel(ctx.month)}${completed ? '，依既有實際拜訪紀錄自動顯示已拜訪。' : '必訪名單。'}`;
    render(); if (fromPicker) { renderMonthlyVisitChoices(ctx.query); dismissKeyboard(); } toast(monthlyVisitNotice);
  } finally { if (!fromPicker && monthlyVisitContext === ctx) monthlyVisitContext = null; }
}
function changeMonthlyVisitMonth(month, { keepInputFocus = false } = {}) {
  if (busy || monthlyVisitContext) return;
  const next = monthlyVisitMonth(month);
  if (next !== monthlyVisitSelectedMonth && $('monthly-completed')) $('monthly-completed').open = false;
  monthlyVisitSelectedMonth = next; monthlyVisitNotice = '';
  if (!keepInputFocus) dismissKeyboard();
  renderMonthlyVisits();
}
function dayPlanLabel(date) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(date + 'T04:00:00.000Z'));
}
function dayPlanAvailable(store) { return !!store && !store.deleted && !store.conflict && !store.mergedInto && !storeIdentityPending(store); }
function renderDayPlanEntry() {
  const today = dayPlanDate(), tomorrow = shiftDayPlanDate(today, 1);
  const count = date => records.filter(r => r.type === 'store' && dayPlanForStore(r, date)?.active).length;
  $('day-plan-entry').innerHTML = `<button type="button" data-view="itinerary"><span><strong>行程與準備</strong><small>今天 ${count(today)} 間 · 明天 ${count(tomorrow)} 間</small></span><span>安排／查看 ›</span></button>`;
}
function currentDayOverview() { return dayPlanOverview(records, dayPlanSelectedDate || dayPlanDate()); }
function dayPlanReminderHTML(row) {
  const next = row.sources.filter(source => source.kind !== 'every'), every = row.sources.filter(source => source.kind === 'every');
  return [[next, '下次記得', ''], [every, '每次必做、必給', ' day-source-always']].filter(([sources]) => sources.length).map(([sources, label, style]) => `<section class="day-source-block${style}"><strong>${label}</strong>${sources.map(source => `<p>${esc(source.text)}</p>`).join('')}</section>`).join('');
}
function dayPlanLegacyHTML(row) {
  if (!row.plan.items.length && !row.plan.acknowledged.length) return '';
  return `<details class="day-plan-legacy"><summary>先前準備紀錄</summary><p class="muted">保留當時填寫的準備與已帶上紀錄，不代表已交付、完成任務或實際拜訪。</p>${row.plan.items.length ? `<ul>${row.plan.items.map(item => `<li>${esc(item.name)}${item.quantity === null ? '' : ' × ' + item.quantity}${esc(item.unit)}${item.packedAt ? ` · 已帶上（${esc(dateText(item.packedAt))}）` : ''}</li>`).join('')}</ul>` : ''}${row.plan.acknowledged.length ? `<p class="muted">當時標記無需攜帶：${row.plan.acknowledged.map(source => esc(source.text)).join('；')}</p>` : ''}<button class="text-button" data-history="store:${esc(row.storeId)}">查看門市完整歷史</button></details>`;
}
function renderDayPlan() {
  if (!dayPlanSelectedDate) dayPlanSelectedDate = dayPlanDate();
  const overview = currentDayOverview(), today = dayPlanDate(), dated = [today, shiftDayPlanDate(today, 1), shiftDayPlanDate(today, 2)];
  dayPlanViewBasis = dayItineraryBasis(records, dayPlanSelectedDate);
  const canSort = !overview.past && overview.stores.length > 1 && overview.stores.every(row => row.available);
  if (!canSort) dayPlanSorting = false;
  const cards = overview.stores.map((row, index) => `<article class="panel day-store"><div class="day-store-heading"><span class="day-store-number">${index + 1}</span><button class="text-button store-link" ${row.available ? `data-visit-brief="${esc(row.storeId)}"` : 'disabled'}>${esc(row.name)}${row.available ? ' ›' : ''}</button>${!overview.past ? `<button type="button" class="text-button day-store-cancel" data-day-cancel="${esc(row.storeId)}" aria-label="取消${esc(row.name)}的${esc(overview.date)}安排" ${!row.available ? 'disabled' : ''}>取消安排</button>` : ''}</div>${!row.available ? `<p class="day-plan-warning">${esc(row.unavailableReason)}</p>` : ''}${row.historical ? '<p class="muted">此行程只存於歷史版本，唯讀查看。</p>' : ''}${dayPlanSorting ? `<div class="day-sort-controls"><button type="button" data-day-up="${esc(row.storeId)}" aria-label="上移${esc(row.name)}" ${index === 0 ? 'disabled' : ''}>↑ 上移</button><button type="button" data-day-down="${esc(row.storeId)}" aria-label="下移${esc(row.name)}" ${index === overview.stores.length - 1 ? 'disabled' : ''}>↓ 下移</button></div>` : dayPlanReminderHTML(row) + dayPlanLegacyHTML(row)}</article>`).join('');
  const cancelled = overview.cancelledStores || [], undo = dayPlanUndo?.date === overview.date;
  const content = $('day-plan-content');
  if (!content.querySelector('#day-plan-date')) content.innerHTML = '<div class="day-plan-datebar"><div id="day-plan-days" class="day-plan-days"></div><details class="day-plan-other-date"><summary>其他日期／歷史</summary><label>行程日期<input id="day-plan-date" type="date" aria-label="行程日期"></label></details></div><div id="day-plan-results"></div>';
  const dateInput = $('day-plan-date');
  if (dateInput.value !== dayPlanSelectedDate) dateInput.value = dayPlanSelectedDate;
  $('day-plan-days').innerHTML = dated.map((date, index) => `<button type="button" data-day-date="${date}" aria-pressed="${date === dayPlanSelectedDate}">${['今天', '明天', '後天'][index]}<small>${esc(dayPlanLabel(date))}</small></button>`).join('');
  $('day-plan-results').innerHTML = `<div class="day-plan-toolbar"><h3>${esc(dayPlanLabel(overview.date))} · ${overview.stores.length} 間</h3>${!overview.past ? `<div><button type="button" class="text-button" data-day-sort aria-pressed="${dayPlanSorting}" ${!canSort ? 'disabled' : ''}>${dayPlanSorting ? '完成排序' : '調整順序'}</button><button type="button" class="primary" data-day-select>＋ 新增門市</button></div>` : '<span class="pill">過去行程 · 唯讀</span>'}</div>${overview.past ? '<p class="muted">顯示當時保存的提醒；安排日期不代表實際拜訪日期。</p>' : ''}<div class="day-plan-notice" role="status" aria-live="polite" ${dayPlanNotice ? '' : 'hidden'}>${esc(dayPlanNotice)}${undo ? '<button type="button" class="text-button" data-day-undo>復原</button>' : ''}</div><div class="day-plan-store-grid">${cards || `<p class="empty">${overview.past ? '這天沒有留存行程；不代表當天沒有實際拜訪。' : '這天還沒有安排門市。'}</p>`}</div>${cancelled.length ? `<details class="day-plan-cancelled"><summary>已取消安排 · ${cancelled.length} 間</summary>${cancelled.map(row => `<div class="day-cancelled-row"><span>${esc(row.name)}</span>${!overview.past && row.available ? `<button class="text-button" data-day-restore="${esc(row.storeId)}">重新加入</button>` : ''}<button class="text-button" data-history="store:${esc(row.storeId)}">查看歷史</button></div>`).join('')}</details>` : ''}`;
}
function assertDayPlanIdle() {
  releaseIdleInlineEdit();
  if (!payload || document.hidden || pendingLock || updateHolding || syncInProgress || dayPlanContext || monthlyVisitContext || editorContext || reminderContext || singleStoreContext || inlineTextContext || payload.inlineTextDraft || document.querySelector('dialog[open]') || csvImport.hasPending()) throw new Error(syncInProgress ? '正在交換資料，請等待同步結束後再調整行程。' : '請先完成或關閉目前的編輯，再調整行程。');
}
function newDayPlanContext(kind) {
  assertDayPlanIdle();
  if (!dayPlanSelectedDate) dayPlanSelectedDate = dayPlanDate();
  if (dayPlanSelectedDate < dayPlanDate()) throw new Error('過去行程保留供查看，不在此改寫歷史。');
  return { kind, date: dayPlanSelectedDate, key, meta, bundle: payload.bundle, revision: localRevision, epoch: syncEpoch, today: dayPlanDate(), basis: dayPlanViewBasis || dayItineraryBasis(records, dayPlanSelectedDate) };
}
function assertDayPlanContext(ctx) {
  if (!ctx || !payload || key !== ctx.key || meta !== ctx.meta || payload.bundle !== ctx.bundle || localRevision !== ctx.revision || syncEpoch !== ctx.epoch || dayPlanSelectedDate !== ctx.date || syncInProgress || document.hidden || pendingLock || updateHolding || ctx.today !== dayPlanDate()) throw new Error('資料、工作階段或日期已改變；尚未寫入。請關閉後重新開啟行程。');
}
function resumeDayPlanContext() {
  // Only renew an idle, unchanged picker. Never refresh an in-flight save guard.
  const ctx = dayPlanContext;
  if (ctx && !busy && !syncInProgress && payload && !document.hidden && !pendingLock && !updateHolding && key === ctx.key && meta === ctx.meta && payload.bundle === ctx.bundle && localRevision === ctx.revision && ctx.date === dayPlanSelectedDate && ctx.today === dayPlanDate()) ctx.epoch = syncEpoch;
}
function openDayPlanSelection() {
  const ctx = newDayPlanContext('selection');
  ctx.query = ''; ctx.stores = records.filter(r => r.type === 'store' && !r.deleted && !r.mergedInto).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  dayPlanContext = ctx;
  $('day-plan-title').textContent = `${dayPlanLabel(ctx.date)} · 新增門市`;
  $('day-plan-error').textContent = '';
  $('day-plan-fields').innerHTML = '<label>搜尋門市<input id="day-store-search" type="search" placeholder="店名、地區或既有來源名稱" autocomplete="off"></label><p id="day-plan-selection-count" role="status"></p><div id="day-store-options"></div>';
  renderDayPlanChoices(''); openDialog($('day-plan-dialog'));
}
function renderDayPlanChoices(query) {
  const ctx = dayPlanContext; if (ctx?.kind !== 'selection') return;
  ctx.query = query;
  const needle = String(query).toLocaleLowerCase(), count = ctx.stores.filter(store => dayPlanForStore(store, ctx.date)?.active).length;
  $('day-plan-selection-count').textContent = `已排 ${count} 間`;
  $('day-store-options').innerHTML = ctx.stores.filter(store => [store.name, store.city, store.district, ...(store.csvAliases || [])].some(value => String(value || '').toLocaleLowerCase().includes(needle))).map(store => {
    const active = dayPlanForStore(store, ctx.date)?.active, available = dayPlanAvailable(store), identity = storeSelectionIdentity(store.id);
    return `<div class="day-store-choice"><span><strong>${esc(store.name)}</strong><small>${esc([store.city, store.district, identity].filter(Boolean).join(' · '))}${!available ? ' · 門市狀態待確認' : ''}</small></span><button type="button" data-day-add="${esc(store.id)}" aria-label="加入${esc(store.name)}${storeSelectionIdentity(store.id) ? '，' + esc(storeSelectionIdentity(store.id)) : ''}" ${active || !available ? 'disabled' : ''}>${active ? '已加入' : '加入'}</button></div>`;
  }).join('') || '<p class="empty">沒有符合的門市。</p>';
}
function closeDayPlanEditor() {
  if (busy || !dayPlanContext) return;
  dayPlanContext = null; $('day-plan-dialog').close(); $('day-plan-fields').replaceChildren(); $('day-plan-error').textContent = ''; dismissKeyboard();
}
async function performDayItineraryAction(action, storeId) {
  const selecting = action === 'add';
  const ctx = selecting ? dayPlanContext : newDayPlanContext('action');
  if (selecting && ctx?.kind !== 'selection') throw new Error('請重新開啟新增門市。');
  assertDayPlanContext(ctx);
  if (!selecting) dayPlanContext = ctx;
  try {
    const storeName = by('store', storeId)?.name || '門市';
    const bundle = applyDayItineraryAction(payload.bundle, { date: ctx.date, storeId, action, expectedBasis: ctx.basis }, payload.device);
    if (bundle === payload.bundle) return toast('行程沒有變更，未建立新版本。');
    await persist({ ...payload, bundle, dirty: true }, { guard: () => assertDayPlanContext(ctx) });
    // No optimistic UI: renew the picker from the committed bundle only.
    if (selecting) {
      Object.assign(ctx, { bundle: payload.bundle, revision: localRevision, epoch: syncEpoch, basis: dayItineraryBasis(project(payload.bundle), ctx.date), stores: project(payload.bundle).filter(r => r.type === 'store' && !r.deleted && !r.mergedInto).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')) });
      renderDayPlanChoices(ctx.query);
    }
    dayPlanNotice = action === 'cancel' ? `已取消 ${dayPlanLabel(ctx.date)} ${storeName}的安排。` : ['add', 'restore'].includes(action) ? `${storeName}已加入 ${dayPlanLabel(ctx.date)}行程。` : '門市順序已儲存。';
    dayPlanUndo = action === 'cancel' ? { date: ctx.date, storeId, heads: reviewHeads(project(payload.bundle).find(row => row.type === 'store' && row.id === storeId)) } : null;
    render(); toast(dayPlanNotice);
    if (selecting) dismissKeyboard();
  } finally { if (!selecting && dayPlanContext === ctx) dayPlanContext = null; }
}
async function restoreLastDayPlanCancellation() {
  const undo = dayPlanUndo, store = undo && by('store', undo.storeId);
  if (!undo || undo.date !== dayPlanSelectedDate || !store || JSON.stringify(reviewHeads(store)) !== JSON.stringify(undo.heads) || dayPlanForStore(store, undo.date)?.active) throw new Error('這間門市的行程已有更新；請從「已取消安排」重新加入。');
  await performDayItineraryAction('restore', undo.storeId);
}
function renderVisits() {
  renderQuickVisit(); renderReminderDrafts(); renderDayPlanEntry();
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
  const storesWithVisits = new Set(visits.map(visit => visit.store));
  const unresolvedVisitsByStore = new Map();
  for (const visit of visits.filter(visit => visit.conflict)) {
    const otherStores = new Set(visit.heads.filter(head => !head.deleted).map(head => head.data.store));
    otherStores.delete(visit.store);
    for (const storeId of otherStores) {
      if (!unresolvedVisitsByStore.has(storeId)) unresolvedVisitsByStore.set(storeId, []);
      unresolvedVisitsByStore.get(storeId).push(visit);
    }
  }
  const emptyStores = all('store').filter(store => !store.deleted && !storesWithVisits.has(store.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  if (!query) {
    const shownStoreText = new Set();
    $('visit-list').innerHTML = visits.map(v => {
      const showStoreText = !shownStoreText.has(v.store); shownStoreText.add(v.store);
      return noteHTML(v, '', { showStoreText, showStoreReminders: showStoreText });
    }).join('') + emptyStores.map(store => visitStoreCardHTML(store, '', unresolvedVisitsByStore.get(store.id))).join('') || '<p class="empty">目前沒有門市或拜訪紀錄。</p>';
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
  for (const store of emptyStores) {
    const rank = storeVisitSearchRank(store, query);
    const storeTextMatch = storeOriginalTextMatch(store, query);
    if (Number.isFinite(rank) || storeTextMatch) grouped.set(store.id, { storeId: store.id, emptyStore: store, unresolvedVisits: unresolvedVisitsByStore.get(store.id), storeTextMatch, bestRank: Math.min(rank, storeTextMatch ? 2 : Infinity), bestRankDate: '', matches: [], allVisits: [] });
  }
  // A store-field hit is independent of visits: it must not fabricate note hits
  // or disappear just because this store also has unrelated visit records.
  for (const store of all('store')) {
    if (!storeOriginalTextMatch(store, query) || !storesWithVisits.has(store.id)) continue;
    const group = grouped.get(store.id);
    if (group) { group.storeTextMatch = true; group.bestRank = Math.min(group.bestRank, 2); }
    else grouped.set(store.id, { storeId: store.id, storeTextMatch: true, bestRank: 2, bestRankDate: '', matches: [], allVisits: allByStore.get(store.id) || [] });
  }
  const groups = [...grouped.values()].sort((a, b) => a.bestRank - b.bestRank || b.bestRankDate.localeCompare(a.bestRankDate) || name('store', a.storeId).localeCompare(name('store', b.storeId), 'zh-Hant'));
  $('visit-list').innerHTML = groups.map(group => group.emptyStore ? visitStoreCardHTML(group.emptyStore, query, group.unresolvedVisits) : group.storeTextMatch || group.matches.length > 1 ? renderVisitSearchGroup(group, query) : noteHTML(group.matches[0].v, query)).join('') || '<p class="empty">沒有符合的門市或拜訪紀錄。</p>';
}
function sourceButton(r) { return (r.csvSources?.length || r.versions?.some(v => v.data.csvSources?.length)) ? `<button class="text-button" data-csv-source="${r.type}:${esc(r.id)}">查看匯入來源與已選補充</button>` : ''; }
function openSources(type, id) {
  const r = by(type, id); if (!r) return;
  const allSources = [...(r.csvSources || []), ...r.versions.flatMap(v => v.data.csvSources || [])];
  const sourceKey = s => JSON.stringify([s.blob, s.fingerprint, s.list]);
  // A later field-only adoption belongs to the store, without changing the note.
  // Include those choices when opening that note's matching source, too.
  if (type === 'visit') {
    const rowKey = s => JSON.stringify([s.fingerprint, sourceListKey(s.list)]);
    const keys = new Set(allSources.map(rowKey)), store = by('store', r.store);
    allSources.push(...(store?.csvSources || []).filter(s => keys.has(rowKey(s))));
  }
  const grouped = new Map();
  for (const source of allSources) {
    const key = sourceKey(source);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(source);
  }
  $('review-title').textContent = 'CSV 原始來源與已選補充';
  $('review-body').innerHTML = `<p class="muted">以下保留完整原始欄位及歷史來源。已選補充只是來源文字，不自動建立人物、關係或待辦；未採用的欄位仍可在原始欄位查看。匯入時間不是拜訪日期，地圖網址不會自動連線。</p>${[...grouped.values()].map(group => {
    const s = group[0], supplements = csvSourceSupplements(group);
    return `<article class="version"><strong>${esc(s.file)} · 第 ${s.line} 行</strong><p class="muted">清單：${esc(s.list)} · 匯入：${dateText(s.at)}</p>${supplements.length ? `<details class="csv-adopted-supplements" open><summary>已納入的來源補充 · ${supplements.length} 欄</summary><div class="csv-raw">${supplements.map(f => `<p><strong>第 ${f.column + 1} 欄 · ${esc(f.header || '無欄名')}</strong><span>${esc(f.text)}</span></p>`).join('')}</div></details>` : '<p class="muted">這份來源尚無已採用的額外補充；原始欄位完整保留。</p>'}<details><summary>展開完整原始欄位（含未採用）</summary><div class="csv-raw">${s.headers.map((h, i) => `<p><strong>第 ${i + 1} 欄 · ${esc(h)}</strong><span>${esc(s.cells[i])}</span></p>`).join('')}</div></details><button class="text-button" data-csv-download="${esc(s.blob)}" data-csv-filename="${esc(s.file)}">下載原始 CSV（明文）</button></article>`;
  }).join('')}`;
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
    if (type === 'person') fields += `${input('f-role', '職務／與門市的關係', d.role)}${textarea('f-desc', '個人資訊與備註', d.desc)}<label class="check"><input type="checkbox" id="f-confirmed" ${d.confirmed ? 'checked' : ''}> 我已核對此人物的身分</label><label>已確認是同一人時，連到<select id="f-same"><option value="">保持獨立人物</option>${all('person').filter(p => p.id !== id && !p.sameAs).map(p => `<option value="${esc(p.id)}" ${d.sameAs === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><p class="muted">須先勾選已核對身分。此設定只合併探索路徑，不改寫原始拜訪文字。</p>`;
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
    (d.fields.taskEdits !== undefined && (!Array.isArray(d.fields.taskEdits) || d.fields.taskEdits.length>1000 || new Set(d.fields.taskEdits.map(e=>e?.id)).size!==d.fields.taskEdits.length || d.fields.taskEdits.some(e=>!e || !text(e.id,100) || !e.id || !text(e.text,2000)))) ||
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
    fields: { taskEdits:reminderTaskEditsFromForm($(ctx.editor?'editor-form':'store-reminder-form'),ctx.taskEdits||[]), next: $(targetId).value, every: $(ctx.editor ? 'f-every-time-must' : 'store-reminder-every').value,
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
function openStoreReminder(storeId, taskId = '', expectedHead = '') {
  if (reminderContext) return toast('請先儲存或按「稍後繼續」收起目前的門市提醒。');
  if (editorContext || singleStoreContext) return toast('請先完成或收起目前的拜訪／完整編輯，再修改門市提醒。');
  const store = by('store', storeId), saved = reminderDraftFor(storeId);
  if(taskId && (!store || store.deleted || store.conflict || expectedHead && store.heads[0].id!==expectedHead || !store.nextRememberTasks?.some(t=>t.id===taskId && !t.completedAt))) return toast('待辦或門市已有變更，請重新開啟核對；尚未修改。');
  if ((!store || store.deleted || store.conflict) && !saved) return toast('這間門市目前有衝突或已移到回收桶，請先完成核對。');
  if (inlineTextContext && inlineTextContext.after !== inlineTextContext.before) return toast('請先完成或取消目前的拜訪文字修改。');
  inlineTextContext = null;
  reminderContext = { id: storeId, storeName: saved?.storeName || store.name, parents: saved ? [...saved.parents] : store.heads.map(head => head.id).sort(),
    taskEdits:structuredClone(saved?.fields.taskEdits||[]), baseEvery: saved?.baseEvery ?? store.everyTimeMust ?? '', baseLegacy: saved?.baseLegacy ?? store.nextRemember ?? '', draftTouched: false, draftGeneration: 0,
    briefStoreId: $('review').open && $('review').classList.contains('visit-brief-dialog') ? $('review').dataset.singleStoreId : '' };
  const ctx = reminderContext;
  $('store-reminder-title').textContent = ctx.storeName + ' · 門市提醒';
  $('store-reminder-existing').innerHTML = (store ? reminderTaskEditorHTML(store,ctx.taskEdits) : '') + (saved?.fields.taskEdits?.length ? `<details><summary>本機保留的待辦修改草稿</summary>${saved.fields.taskEdits.map(e=>`<pre>${esc(e.text)}</pre>`).join('')}</details>` : '') + legacyReminderDraftHTML({ nextRemember: ctx.baseLegacy });
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
  if(taskId){const panel=[...$('store-reminder-existing').querySelectorAll('[data-reminder-task-panel]')].find(el=>el.dataset.reminderTaskPanel===taskId);if(panel){panel.open=true;panel.scrollIntoView({block:'nearest'});}}
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
    toast(changed ? '這間門市的共用提醒已儲存。' : choice.attendance ? '已記錄今天實際拜訪；門市提醒內容保持原樣。' : '門市提醒沒有變更，未新增任何版本。');
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
  const savedText = ctx.after;
  await persist({ ...payload, inlineTextDraft: draft });
  if (ctx !== inlineTextContext || ctx.after !== savedText) return;
  if (state) state.textContent = draft ? '修改草稿已加密保存在這台裝置，尚未寫入正式紀錄。' : '文字沒有變更。';
  if (!draft) releaseIdleInlineEdit();
}
function scheduleInlineTextDraft() {
  clearTimeout(inlineDraftTimer); const ctx = inlineTextContext;
  inlineDraftTimer = setTimeout(() => { inlineDraftSaveChain = inlineDraftSaveChain.then(() => ctx === inlineTextContext ? persistInlineTextDraft() : undefined).catch(error => { const state = document.querySelector(`[data-inline-state="${CSS.escape(ctx?.id || '')}"]`); if (state) state.textContent = '草稿儲存失敗：' + error.message; }); }, 250);
}
async function flushInlineTextDraft() { clearTimeout(inlineDraftTimer); inlineDraftTimer = null; inlineDraftSaveChain = inlineDraftSaveChain.then(persistInlineTextDraft); await inlineDraftSaveChain; }
function updateInlineText(id, element, { isComposing = false } = {}) {
  if (!beginInlineTextEdit(id, element)) { const visit = by('visit', id); if (visit) element.textContent = visit.text || ''; return; }
  const next = inlineTextValue(element), shell = element.closest('[data-inline-shell]'), state = shell?.querySelector('[data-inline-state]');
  if (next.length > 20000) { element.textContent = inlineTextContext.after; if (state) state.textContent = '文字超過長度上限，超出的輸入未保留。'; return; }
  const wasEdited = inlineTextContext.after !== inlineTextContext.before;
  inlineTextContext.after = next;
  const edited = next !== inlineTextContext.before;
  shell?.classList.toggle('editing', edited);
  const actions = shell?.querySelector('.inline-edit-actions');
  if (actions && actions.hidden === edited) actions.hidden = !edited;
  const message = next.trim() ? '正在加密保存修改草稿…' : '整段空白不能儲存為正式版本；原文仍安全保留。';
  if (state && state.textContent !== message) state.textContent = message;
  if (isComposing) clearTimeout(inlineDraftTimer);
  else scheduleInlineTextDraft();
  return wasEdited !== edited;
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
  const labels = { relationshipNotes:'我補充的關係資訊', relationshipReviews:'關係審視歷史', supervision:'小區與督導', supervisorKey:'督導來源身分識別', address: '地址', mapUrl: '地圖網址', lists: '來源清單', name: '名稱', city: '縣市', district: '地區', channel: '通路', attr: '屬性', contact: '窗口', nextRemember: '下次記得（未轉換文字）', nextRememberTasks: '下次記得任務', nextRememberImports: '提醒轉換原始文字', datePlanOrder: '每日門市順序', datePlans: '行程與準備（不代表實際拜訪）', monthlyVisits: '每月必訪名單（不代表實際拜訪）', preVisitInsights: '拜訪前線索（獨立分析）', preVisitInsightReviews: '線索人工審核與留存', preVisitInsightRelations: '共同人物關係對應', everyTimeMust: '每次必做、必給', desc: '備註', role: '職務', confirmed: '身分已核對', sameAs: '同一人連結', mergedInto: '已整併至門市 ID', mergeDecision: '整併裁定' };
  const details = Object.entries(data).filter(([k]) => k !== 'csvSources' && k !== 'qualityDistinct').map(([k, v]) => `${labels[k] || k}：${k === 'sameAs' && v ? name('person', v) : ['relationshipReviews','supervision', 'monthlyVisits', 'datePlans', 'datePlanOrder', 'nextRememberTasks', 'nextRememberImports', 'preVisitInsights', 'preVisitInsightReviews', 'preVisitInsightRelations'].includes(k) ? JSON.stringify(v, null, 2) : v}`);
  if (data.qualityDistinct !== undefined) details.push('此版本保存的不同門市核對：' + data.qualityDistinct.length + ' 組（辨識資料改變後需重新核對）');
  return details.join('\n');
}
function reviewHeads(record) { return record.heads.map(h => h.id).sort(); }
const SAFE_CONFLICT_BLOCKED_FIELDS = new Set(['relationshipReviews','relationshipNotes','supervision','supervisorKey','monthlyVisits', 'datePlans', 'datePlanOrder', 'preVisitInsights', 'preVisitInsightReviews', 'preVisitInsightRelations', 'nextRememberTasks', 'nextRememberImports', 'nextRemember', 'attachments', 'csvSources', 'csvIdentityRules', 'qualityDistinct', 'storeMergeHistory', 'storeMergeStaleEntries', 'mergedInto', 'mergeDecision', 'sameAs', 'confirmed', 'googleText', 'googleUpdatePending', 'sourceMissing']);
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
  const labels = { text: '拜訪文字', next: '下次跟進', store: '門市', date: '拜訪日期', source: '紀錄來源', topics: '主題連結', people: '人物連結', name: '名稱', address: '地址', mapUrl: '地圖網址', city: '縣市', district: '地區', channel: '通路', attr: '屬性', contact: '窗口', nextRemember: '下次記得（未轉換文字）', nextRememberTasks: '下次記得任務', nextRememberImports: '提醒轉換原始文字', datePlanOrder: '每日門市順序', datePlans: '行程與準備（不代表實際拜訪）', monthlyVisits: '每月必訪名單（不代表實際拜訪）', preVisitInsights: '拜訪前線索（獨立分析）', preVisitInsightReviews: '線索人工審核與留存', preVisitInsightRelations: '共同人物關係對應', everyTimeMust: '每次必做、必給', desc: '備註', role: '職務' };
  return plan.changes.map(change => {
    const versions = change.heads.map(id => record.heads.findIndex(head => head.id === id) + 1).join('、');
    return `<li>${esc(labels[change.field] || change.field)}：取自版本 ${esc(versions)}</li>`;
  }).join('');
}
function assertStoreMergeResolution(record, data, deleted) {
  if (record.type !== 'store') return;
  const staleEntries = record.heads.flatMap(head => head.data.storeMergeStaleEntries || []);
  if (staleEntries.some(marker => !data.storeMergeStaleEntries?.some(item => JSON.stringify(item) === JSON.stringify(marker)))) throw new Error('這個版本會移除分析來源失效標記，請另行核對完整影響。');
  const histories = record.versions.flatMap(version => version.data.storeMergeHistory || []);
  if (!histories.length) return;
  if (histories.some(history => !data.storeMergeHistory?.some(item => JSON.stringify(item) === JSON.stringify(history)))) throw new Error('這個版本缺少既有安全合併歷史，不能用一般還原撤銷合併；請另行核對完整影響。');
  const donor = record.versions.find(version => version.data.mergeDecision && version.data.mergedInto && version.data.storeMergeHistory?.some(item => item.donorId === record.id));
  if (donor && (!deleted || data.mergedInto !== donor.data.mergedInto || data.mergeDecision !== donor.data.mergeDecision)) throw new Error('這筆原門市已安全合併；一般還原不能將它重新變成獨立門市。');
}
function storeMergeVersionRestorable(record, version) {
  try { assertStoreMergeResolution(record, version.data, version.deleted); return true; } catch { return false; }
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
  const labels = { text: '拜訪文字', next: '下次跟進', store: '門市 ID', date: '拜訪日期', source: '紀錄來源', topics: '主題連結', people: '人物連結', attachments: '附件', name: '名稱', address: '地址', mapUrl: '地圖網址', city: '縣市', district: '地區', channel: '通路', attr: '屬性', contact: '窗口', nextRemember: '下次記得（未轉換文字）', nextRememberTasks: '下次記得任務', nextRememberImports: '提醒轉換原始文字', datePlanOrder: '每日門市順序', datePlans: '行程與準備（不代表實際拜訪）', monthlyVisits: '每月必訪名單（不代表實際拜訪）', preVisitInsights: '拜訪前線索（獨立分析）', preVisitInsightReviews: '線索人工審核與留存', preVisitInsightRelations: '共同人物關係對應', everyTimeMust: '每次必做、必給', desc: '備註', role: '職務', confirmed: '身分已核對', sameAs: '人物身分連結', csvSources: 'CSV 來源證據', csvIdentityPending: '門市身分待確認', csvIdentityRules: '門市身分裁定', googleText: 'Google 來源文字', googleUpdatePending: 'Google 文字待核對', sourceMissing: '來源缺失' };
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
    $('review-body').innerHTML = `<p>還原會先預覽，再建立新版本；不會抹除後續歷史。已確認的拜訪保留在原來源版本，不因還原而重複新增；沒有拜訪標記的版本也不會推算為拜訪。</p>${[...r.versions].sort((a, b) => b.at.localeCompare(a.at)).map(o => `<article class="version"><p>${esc(dateText(o.at))}${o.deleted ? ' · 已刪除' : ''}</p>${reviewAttendanceHTML(o)}<pre>${esc(describeData(type, o.data))}</pre>${!storeMergeVersionRestorable(r, o) ? '<p class="muted">這個歷史版本不能用來撤銷整併；更正合併須另行核對完整影響。</p>' : `<button data-use-version="${esc(o.id)}">預覽還原這個內容</button>`}</article>`).join('')}`;
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
  assertStoreMergeResolution(r, data, deleted);
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
  const current = checkedReview(ctx);
  assertStoreMergeResolution(current, ctx.data, ctx.deleted);
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
  assertStoreMergeResolution(r, o.data, false);
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
// Weekly recovery settings and jobs never persist the customer payload or pairing.
function clearWeeklySetup() {
  weeklyContext = null;
  $('weekly-form')?.reset();
  if ($('weekly-password')) $('weekly-password').value = '';
  if ($('weekly-proof')) $('weekly-proof').value = '';
}
function assertWeeklyIdle() {
  if (document.hidden || pendingLock || updateHolding || syncInProgress || monthlyFeedbackContext || payload?.monthlyFeedbackDraft || editorContext || singleStoreContext || inlineTextContext || reminderContext || dayPlanContext || monthlyVisitContext || attendancePrompt || backupPreview || recoveryExportContext || csvImport.hasPending() || ['review','editor','quick-text-dialog','store-reminder-dialog','rebuild-dialog','backup-review'].some(id => $(id)?.open)) throw new Error('等待目前編輯或核對完成後，自動補做正式資料備份。');
}
function weeklyReady() {
  if (!payload?.token || !key || navigator.onLine === false || busy || gateOpening || autoFetching || weeklyContext || weeklyRunning) return false;
  try { assertWeeklyIdle(); return true; } catch { return false; }
}
function weeklySession() { return { payload, key, meta, revision: localRevision, epoch: syncEpoch }; }
async function assertWeeklyCurrent(ctx) {
  const check = () => {
    if (!ctx || payload !== ctx.payload || key !== ctx.key || meta !== ctx.meta || localRevision !== ctx.revision || syncEpoch !== ctx.epoch || document.hidden || pendingLock || updateHolding || syncInProgress) throw new Error('資料或工作階段已變更；保留原資料，下次安全時補做備份。');
    assertWeeklyIdle();
  };
  check(); const disk = await readLocal(); check();
  if (!disk || disk.revision !== ctx.revision) throw new Error('另一個視窗更新了資料；下次安全時補做備份。');
}
function renderWeeklyStatus(state = weeklyState, notice = '') {
  const target = $('weekly-status'); if (!target) return;
  const labels = { unconfigured: '尚未設定', 'waiting-current-copy': '等待最新資料加密，恢復後補做', ready: '已備妥，等待排程', success: '最近排程已成功保存', failed: '備份失敗，會再補做' };
  let text = notice || labels[state?.status] || '尚待連線檢查';
  if (state?.config) text += `\n排程：每週${'日一二三四五六'[state.config.weekday]} ${String(state.config.hour).padStart(2,'0')}:${String(state.config.minute).padStart(2,'0')}（台北時間）`;
  if (state?.lastSuccess) text += `\n最近成功：${dateText(state.lastSuccess.at)}；Mac 資料版本 ${state.lastSuccess.sourceVersion}\n檔案：${state.lastSuccess.name}\nSHA256：${state.lastSuccess.sha256}`;
  if (state?.sourceVersion != null) text += `\nMac 目前資料版本：${state.sourceVersion}。${state.lastSuccess && state.lastSuccess.sourceVersion !== state.sourceVersion ? '最近成功備份尚未涵蓋此版本。' : ''}`;
  if (state?.nextDueAt) text += `\n下次排程：${dateText(state.nextDueAt)}`;
  if (state?.lastError) text += `\n最近失敗：${dateText(state.lastError.at)} · ${state.lastError.message}`;
  if (payload?.dirty) text += '\n此裝置仍有未同步資料，尚未包含在 Mac 備份內。';
  text += '\n只涵蓋 Mac 已收到的正式資料；手機尚未同步及未完成草稿不在內。同一 Mac 保存不等於離機備份。';
  target.textContent = text;
  $('weekly-download').disabled = !state?.lastSuccess;
  if (typeof renderHealthAudit === 'function') renderHealthAudit();
  if (typeof renderDataSafetyEntry === 'function') renderDataSafetyEntry();
}
async function openWeeklySetup() {
  assertWeeklyIdle();
  if (!payload?.token || !key || weeklyRunning || recoveryExportContext || backupPreview || syncInProgress) throw new Error('請先完成配對與同步，再設定自動備份。');
  clearWeeklySetup(); syncEpoch++; syncScheduler.pause();
  const ctx = weeklySession(); weeklyContext = ctx;
  try { weeklyState = await api('/api/recovery-backup/status'); await assertWeeklyCurrent(ctx); } catch (error) { clearWeeklySetup(); throw error; }
  if (weeklyContext !== ctx) throw new Error('設定已關閉。');
  ctx.config = weeklyState.config;
  $('weekly-weekday').value = String(ctx.config?.weekday ?? 5);
  $('weekly-time').value = `${String(ctx.config?.hour ?? 21).padStart(2,'0')}:${String(ctx.config?.minute ?? 0).padStart(2,'0')}`;
  $('weekly-error').textContent = ''; renderWeeklyStatus(); openDialog($('weekly-dialog'));
}
async function saveWeeklySetup() {
  const ctx = weeklyContext, proofFile = $('weekly-proof').files?.[0];
  let password = $('weekly-password').value; $('weekly-password').value = '';
  try {
    if (!ctx || !$('weekly-dialog').open || !$('weekly-ack').checked) throw new Error('請閱讀並勾選自動備份設定。');
    if (!proofFile || proofFile.size > 36 * 1024 * 1024) throw new Error('請選取已驗證的新密碼備份（上限36MB）。');
    await assertWeeklyCurrent(ctx);
    const proof = await proofFile.text();
    const pending = setupWeeklyRecovery(proof,password,ctx.meta); password = '';
    const config = await pending; await assertWeeklyCurrent(ctx);
    if (weeklyContext !== ctx || !$('weekly-dialog').open) throw new Error('設定已取消。');
    const weekday = Number($('weekly-weekday').value), time = $('weekly-time').value;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('請選擇有效的台北星期與時間。');
    const [hour,minute] = time.split(':').map(Number);
    const same = ctx.config && ctx.config.weekday === weekday && ctx.config.hour === hour && ctx.config.minute === minute;
    if (same && ctx.config.recoveryMeta && (ctx.config.recoveryMeta.salt !== config.meta.salt || ctx.config.recoveryMeta.iterations !== config.meta.iterations)) throw new Error('請選取與目前自動備份設定相同的原始驗證檔。');
    const id = same ? ctx.config.id : uuid();
    const prior = await readWeeklyRecovery(id); await assertWeeklyCurrent(ctx);
    if (prior && (prior.sourceVaultId !== ctx.meta.vaultId || prior.meta.salt !== config.meta.salt || prior.meta.iterations !== config.meta.iterations)) throw new Error('此裝置的備份金鑰與排程不一致，已停止設定。');
    if (!prior) await writeWeeklyRecovery(id,{...config,sourceVaultId:ctx.meta.vaultId});
    await assertWeeklyCurrent(ctx);
    if (weeklyContext !== ctx || !$('weekly-dialog').open) throw new Error('設定已取消；未變更排程。');
    if (!same) weeklyState = await api('/api/recovery-backup/config',{method:'POST',body:{expectedConfigId:ctx.config?.id || null,configId:id,weekday,hour,minute,vaultId:ctx.meta.vaultId,recoveryMeta:{salt:config.meta.salt,iterations:config.meta.iterations},enabled:true}});
    clearWeeklySetup(); $('weekly-dialog').close();
    renderWeeklyStatus(weeklyState,'設定已保存；等待安全同步後，先建立第一份完整備份。');
    weeklyRetryAt = 0; setTimeout(()=>void weeklyTick(),1000);
  } finally { password=''; $('weekly-password').value=''; $('weekly-proof').value=''; }
}
async function weeklyTick(force = false) {
  if (weeklyRunning || peopleBatchRunning || weeklyContext || !weeklyReady() || recoveryExportContext || (Date.now() < weeklyRetryAt && !force)) return;
  try { assertWeeklyIdle(); } catch { return; }
  weeklyRunning = true; syncScheduler.pause();
  try {
    await run(async () => {
      const ctx = weeklySession();
      weeklyState = await api('/api/recovery-backup/status'); await assertWeeklyCurrent(ctx); renderWeeklyStatus();
      if (!weeklyState.config) return;
      if (payload.dirty || payload.serverVersion !== weeklyState.sourceVersion) syncScheduler.request('foreground');
      const config = await readWeeklyRecovery(weeklyState.config.id); await assertWeeklyCurrent(ctx);
      if (!config) { renderWeeklyStatus(weeklyState,'此裝置尚未設定備份金鑰。請完成一次設定，或開啟已設定的裝置補做。'); return; }
      if (weeklyState.status !== 'failed' && weeklyState.stage?.sourceVersion === weeklyState.sourceVersion && weeklyState.stage?.sourceSha256 === weeklyState.sourceSha256) return;
      const remote = await api('/api/snapshot'); await assertWeeklyCurrent(ctx);
      if (remote.version !== weeklyState.sourceVersion) throw new Error('Mac 資料已更新；等待同步後補做。');
      const sourceSha256 = await hashBytes(new TextEncoder().encode(JSON.stringify(remote.envelope)));
      if (sourceSha256 !== weeklyState.sourceSha256) throw new Error('Mac 資料已更新；等待同步後補做。');
      renderWeeklyStatus(weeklyState,'正在核對全部版本與附件，準備新密碼加密副本…');
      const output = await prepareWeeklyRecovery(remote.envelope,ctx.key,config); await assertWeeklyCurrent(ctx);
      weeklyState = await api('/api/recovery-backup/stage',{method:'POST',body:{configId:weeklyState.config.id,expectedVersion:remote.version,sourceSha256,envelope:output.envelope,sha256:output.sha256}});
      await assertWeeklyCurrent(ctx); renderWeeklyStatus(); weeklyRetryAt = Date.now()+15000;
    },'weekly-status');
  } catch (error) { renderWeeklyStatus(weeklyState,'自動備份尚未完成：'+error.message); }
  finally { weeklyRunning=false; weeklyRetryAt=Math.max(weeklyRetryAt,Date.now()+30000); syncScheduler.wake(); }
}
async function downloadWeeklyBackup() {
  if (!weeklyState?.lastSuccess) throw new Error('尚無可下載的成功備份。');
  const success = weeklyState.lastSuccess;
  const backup = await api('/api/recovery-backup/file?name='+encodeURIComponent(success.name));
  const text = JSON.stringify(backup);
  if (await hashBytes(new TextEncoder().encode(text)) !== success.sha256) throw new Error('下載內容雜湊不符，已停止。');
  download(text,success.name,'application/octet-stream');
}

function clearRecoveryExport() {
  recoveryExportContext = null;
  $('recovery-export-form').reset();
  $('recovery-password').value = ''; $('recovery-password-again').value = '';
  $('recovery-export-ack').checked = false;
  $('recovery-export-error').textContent = ''; $('recovery-export-result').textContent = '';
  $('recovery-export-basis').textContent = '';
}
async function openRecoveryExport() {
  assertBackupIdle();
  if (!payload || !key || backupPreview || recoveryExportContext || syncInProgress || updateHolding || weeklyContext || weeklyRunning) throw new Error('請先解鎖並完成目前同步或備份核對。');
  clearRecoveryExport();
  syncEpoch++; syncScheduler.pause(); // Invalidate any in-flight read-only sync probe.
  const ctx = { payload, key, meta, revision: localRevision, epoch: syncEpoch, baseline: JSON.stringify(payload) };
  recoveryExportContext = ctx;
  try {
    await assertRecoveryExportCurrent(ctx, false);
    $('recovery-export-basis').textContent = `範圍：這台裝置目前保存的全部正式版本，共 ${payload.bundle.ops.length} 個版本。${payload.dirty ? '仍有尚待 Mac 確認的本機資料；本副本不代表雙端已同步。' : '其他裝置未同步的內容不包含在內。'}`;
    openDialog($('recovery-export-dialog'));
  } catch (error) { clearRecoveryExport(); throw error; }
}
async function assertRecoveryExportCurrent(ctx, requireOpen = true) {
  const check = () => {
    if (!ctx || recoveryExportContext !== ctx || payload !== ctx.payload || key !== ctx.key || meta !== ctx.meta || localRevision !== ctx.revision || syncEpoch !== ctx.epoch || JSON.stringify(payload) !== ctx.baseline || document.hidden || pendingLock || updateHolding || syncInProgress || (requireOpen && !$('recovery-export-dialog').open)) throw new Error('資料或工作階段已變更，請重新開啟另存備份；尚未下載。');
    assertBackupIdle();
  };
  check();
  const disk = await readLocal();
  check();
  if (!disk || disk.revision !== ctx.revision) throw new Error('另一個視窗已更新資料，請重新開啟另存備份；尚未下載。');
}
async function exportRecoveryBackup() {
  const ctx = recoveryExportContext;
  let password = $('recovery-password').value, confirmation = $('recovery-password-again').value;
  const acknowledged = $('recovery-export-ack').checked;
  $('recovery-password').value = ''; $('recovery-password-again').value = ''; $('recovery-export-ack').checked = false;
  try {
    if (!acknowledged) throw new Error('請先確認獨立復原副本的用途。');
    await assertRecoveryExportCurrent(ctx);
    const pending = createRecoveryBackup(ctx.payload.bundle, password, confirmation);
    password = confirmation = '';
    const output = await pending;
    await assertRecoveryExportCurrent(ctx);
    const filename = `pharmacy-recovery-new-password-${new Date().toISOString().replace(/[:.]/g, '-')}.pharmabackup`;
    download(output.text, filename, 'application/octet-stream');
    $('recovery-export-result').textContent = `已產生新密碼備份下載，並在記憶體完成解密比對及來源／附件完整性檢查。共 ${output.summary.revisions} 個版本；一般歷史引用警告 ${output.warnings} 項（未補正）。請確認檔案實際存好，再於空白隔離環境手動輸入新密碼驗證。SHA256：${output.sha256}。未改動正式資料、配對或原密碼；下載不等於檔案已保存或還原驗收通過。`;
  } finally { password = confirmation = ''; $('recovery-password').value = ''; $('recovery-password-again').value = ''; }
}
function assertBackupIdle() {
  if (monthlyFeedbackContext || payload?.monthlyFeedbackDraft || editorContext || singleStoreContext || inlineTextContext || reminderContext || dayPlanContext || monthlyVisitContext || payload?.draft || payload?.inlineTextDraft || storedReminderDrafts().length || csvImport.hasPending() || $('review').open || $('quick-text-dialog').open || $('store-reminder-dialog').open || $('rebuild-dialog').open) throw new Error('請先完成或取消目前的編輯、草稿或核對，再檢查備份；原輸入保持不變。');
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
  const data = head.data, labels = { datePlanOrder: '每日門市順序', datePlans: '行程與準備（含已帶上歷史）', name: '名稱', text: '拜訪原文', date: '拜訪日期', source: '紀錄來源', next: '下次跟進', nextRemember: '下次記得（未轉換文字）', everyTimeMust: '每次必做、必給', address: '地址', city: '縣市', district: '行政區', contact: '窗口', desc: '備註', role: '職務' };
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
  if (warning.code === 'missing-insight-source-revision') return `門市分析 ${warning.entity} 缺少來源版本 ${warning.sourceRevisionId}；相關線索暫停顯示。`;
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
    if (['rebuild-dialog', 'quick-text-dialog', 'store-reminder-dialog', 'review', 'backup-review', 'insight-changes-dialog'].includes(b.dataset.close) && busy) return;
    if (b.dataset.close === 'store-reminder-dialog') return run(closeStoreReminder, 'store-reminder-error');
    if (b.dataset.close === 'review' && singleStoreContext) return run(closeSingleStoreReview, 'single-store-error');
    if (b.dataset.close === 'editor' && editorContext?.reminderDraftContext) return run(closeStoreReminderEditor, 'editor-error');
    if (b.dataset.close === 'editor' && editorContext?.type === 'visit') return run(async () => {
      await flushVisitDraft(); $('editor').close(); editorContext = null; render();
    }, 'editor-error');
    $(b.dataset.close).close(); if (b.dataset.close === 'rebuild-dialog') $('rebuild-connect-form').reset(); if (b.dataset.close === 'editor') editorContext = null; if (b.dataset.close === 'store-reminder-dialog') reminderContext = null; return;
  }
  if (updateHolding || busy || !payload) return;
  if(b.hasAttribute('data-typed-report'))return run(()=>openTypedReport(b));
  if (b.hasAttribute('data-feedback-resume')) return run(()=>openMonthlyFeedback(payload.monthlyFeedbackDraft.analysisId,payload.monthlyFeedbackDraft.rowIndex));
  if (b.hasAttribute('data-feedback-open')) return run(()=>openMonthlyFeedback(b.dataset.feedbackOpen,Number(b.dataset.feedbackRow)));
  if (b.hasAttribute('data-feedback-export-open')) return run(openMonthlyFeedbackExport);
  if (b.hasAttribute('data-feedback-export-preview')) return run(previewMonthlyFeedbackExport,'feedback-export-error');
  if (b.hasAttribute('data-feedback-export-download')) return run(monthlyExportPreview?downloadReviewedMonthlyFeedbackExport:downloadMonthlyFeedbackExport,'feedback-export-error');
  if (b.hasAttribute('data-analysis-code-revoke')) return run(()=>openRemoveAnalysisStoreCode(b));
  if (b.hasAttribute('data-analysis-code-revoke-save')) return run(saveRemoveAnalysisStoreCode,'analysis-error');
  if (b.hasAttribute('data-analysis-open')) return run(openAnalysisImport, 'monthly-visit-notice');
  if (b.hasAttribute('data-analysis-preview')) return run(previewAnalysisImport, 'analysis-error');
  if (b.hasAttribute('data-analysis-final')) return run(finalAnalysisImport, 'analysis-error');
  if (b.hasAttribute('data-analysis-save')) return run(saveAnalysisImport, 'analysis-error');
  if (b.id==='import-store-supervision') return $('supervision-file').click();
  if (b.id==='apply-store-supervision') return run(commitSupervision,'supervision-error');
  if (b.dataset.openSupervisor) return openSupervisor(b.dataset.openSupervisor,b.dataset.supervisorStore);
  if (b.id==='supervisor-return-store') return openVisitBrief(supervisorOriginStore);
  if (b.dataset.supervisionSource) {const a=by('store',b.dataset.supervisionSource)?.supervision;if(a) download(unb64(payload.bundle.blobs[a.sourceDocument.blob]),a.sourceDocument.name.replace(/[\/\\]/g,'_'),a.sourceDocument.mime);return;}
  if (b.dataset.insightChanges) return run(() => openInsightChanges(b.dataset.insightChanges), 'insight-review-error');
  if (b.dataset.insightChangeRead) return run(() => readInsightChange(b.dataset.insightChangeRead), 'insight-changes-error');
  if (b.hasAttribute('data-monthly-close')) return closeMonthlyVisitSelection();
  if (b.dataset.monthlyAdd) return run(() => performMonthlyVisitAction('add', b.dataset.monthlyAdd, true), 'monthly-visit-error');
  if (monthlyVisitContext && !b.closest('#monthly-visit-dialog')) return toast('請先關閉每月門市選擇，再操作其他內容。');
  if (b.hasAttribute('data-monthly-select')) return run(openMonthlyVisitSelection);
  if (b.dataset.monthlyRemove) return run(() => performMonthlyVisitAction('remove', b.dataset.monthlyRemove));
  if (b.dataset.monthlyAddBack) return run(() => performMonthlyVisitAction('add', b.dataset.monthlyAddBack));
  if (b.dataset.monthlyShift) { try { return changeMonthlyVisitMonth(shiftMonthlyVisitMonth(monthlyVisitSelectedMonth || monthlyVisitMonth(), Number(b.dataset.monthlyShift))); } catch (error) { return toast(error.message); } }
  if (b.hasAttribute('data-monthly-current')) return changeMonthlyVisitMonth(monthlyVisitMonth());
  if (b.hasAttribute('data-day-close')) return closeDayPlanEditor();
  if (b.dataset.dayAdd) return run(() => performDayItineraryAction('add', b.dataset.dayAdd), 'day-plan-error');
  if (dayPlanContext && !b.closest('#day-plan-dialog')) return toast('請先關閉新增門市，再操作其他內容。');
  if (b.dataset.dayDate) { dismissKeyboard(); dayPlanSelectedDate = b.dataset.dayDate; dayPlanSorting = false; dayPlanNotice = ''; dayPlanUndo = null; return renderDayPlan(); }
  if (b.hasAttribute('data-day-select')) return run(openDayPlanSelection);
  if (b.hasAttribute('data-day-sort')) { dayPlanSorting = !dayPlanSorting; dayPlanNotice = ''; dayPlanUndo = null; return renderDayPlan(); }
  if (b.dataset.dayCancel) return run(() => performDayItineraryAction('cancel', b.dataset.dayCancel));
  if (b.dataset.dayRestore) return run(() => performDayItineraryAction('restore', b.dataset.dayRestore));
  if (b.dataset.dayUp) return run(() => performDayItineraryAction('up', b.dataset.dayUp));
  if (b.dataset.dayDown) return run(() => performDayItineraryAction('down', b.dataset.dayDown));
  if (b.hasAttribute('data-day-undo')) return run(restoreLastDayPlanCancellation);
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
  if (b.dataset.reminderTaskEdit) return openStoreReminder(b.dataset.reminderStore,b.dataset.reminderTaskEdit,b.dataset.reminderHead);
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
  if (b.dataset.qualityMerge !== undefined) return run(() => openStoreMergeSetup());
  if (b.id === 'store-merge-apply') return run(applyStoreMergePreview, 'store-merge-error');
  if (b.id === 'store-merge-export-preview') return run(exportStoreMergePreview, 'store-merge-error');
  if (b.id === 'store-merge-export-backup') return run(exportStoreMergeBackup, 'store-merge-error');
  if (b.dataset.mergedOrigin) return run(() => openMergedStoreOrigin(b.dataset.mergedKeeper, b.dataset.mergedOrigin));
  if (b.dataset.qualityPage) { qualityPage = Math.max(0, qualityPage + Number(b.dataset.qualityPage)); return renderQuality(); }
  if (b.id === 'quality-refresh') { qualityCache = null; qualityPage = 0; return renderQuality(); }
  if (b.id === 'export-store-enrichment') return run(exportStoreEnrichmentRequest);
  if (b.id === 'export-insights-source') return run(exportInsightsSource);
  if (b.id === 'import-store-insights') return $('store-insights-file').click();
  if (b.dataset.insightReview) return run(() => changeInsightReview(b.dataset.insightStore, b.dataset.insightEntry, b.dataset.insightReview, b.dataset.insightHead), 'insight-review-error');
  if (b.id === 'apply-store-insights') return run(commitInsights, 'insights-error');
  if (b.id === 'import-store-enrichment') return $('store-enrichment-file').click();
  if (b.dataset.fillSuggestion) { const field = b.dataset.fillSuggestion, suggestion = editorContext?.suggestions?.[field]?.[Number(b.dataset.suggestionIndex)]; if (suggestion && editorContext.fillFields.includes(field)) $('fill-' + field).value = suggestion.value; return; }
  if (b.dataset.edit) return openEditor(...b.dataset.edit.split(':'));
  if (b.dataset.review) return openReview(...b.dataset.review.split(':'), true);
  if (b.dataset.csvSource) return openSources(...b.dataset.csvSource.split(':'));
  if (b.dataset.csvDownload) { if (confirm('原始 CSV 是明文檔案。請確認下載到自己的本機資料夾，避開 iCloud Drive。')) download(unb64(payload.bundle.blobs[b.dataset.csvDownload]), b.dataset.csvFilename.replace(/[\/\\]/g, '_'), 'application/octet-stream'); return; }
  if (b.dataset.history) return openReview(...b.dataset.history.split(':'), false);
  if (b.dataset.delete) return run(() => removeEntity(...b.dataset.delete.split(':')));
  if (b.dataset.restore) return run(async () => { const [type, id] = b.dataset.restore.split(':'), r = by(type, id); if (r.mergedInto && r.mergeDecision) throw new Error('這筆門市已經安全合併；一般還原不能撤銷合併。請另行核對完整影響，原資料與歷史仍保留。'); if (r.mergedInto && !confirm('此門市曾依已裁定同店規則整併至「' + name('store', r.mergedInto) + '」。還原會重新成為獨立門市，之後必須重新核對身分。確認還原？')) return; await commitRevision(type, id, r.heads[0].data, r.heads.map(h => h.id)); toast('已還原。'); });
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
  if (b.id === 'export-recovery-backup') return run(openRecoveryExport);
  if (b.id === 'export-backup') return run(exportBackup);
  if (b.id === 'import-backup') return $('backup-file').click();
  if (b.id === 'repair-pair') return openRepairPair();
});
document.addEventListener('keydown', e => { const n = e.target.closest('.node[role="button"]'); if (n && ['Enter', ' '].includes(e.key) && !busy) { e.preventDefault(); if (n.dataset.candidateKey) openCandidateDetail(n.dataset.candidateKey, n.dataset.candidateStore || ''); else navigate(n.dataset.nodeType, n.dataset.nodeId); } });
// Reading or selecting text validates access without opening an edit session.
document.addEventListener('focusin', blockInlineTextBeforeInput);
document.addEventListener('beforeinput', blockInlineTextBeforeInput);
document.addEventListener('invalid', showValidationWithoutKeyboard, true);
document.addEventListener('focusin', event => { if (event.target.closest?.('#review [data-inline-edit-text]')) refreshBriefSearch(); });
document.addEventListener('focusout', event => { if (event.target.closest?.('[data-inline-edit-text]')) queueMicrotask(() => { releaseIdleInlineEdit(); refreshBriefSearch(); }); });
document.addEventListener('beforeinput', event => { if (event.target.closest?.('#review [data-inline-edit-text]')) { clearTimeout(briefSearchTimer); clearBriefSearchHighlights(); } });
document.addEventListener('compositionstart', event => {
  if (event.target.closest?.('[data-inline-edit-text]')) clearTimeout(inlineDraftTimer);
  if (event.target.closest?.('#review [data-inline-edit-text]')) clearBriefSearchHighlights();
});
for (const type of ['input', 'compositionend']) document.addEventListener(type, event => {
  const editor = event.target.closest?.('[data-inline-edit-text]');
  if (editor && updateInlineText(editor.dataset.inlineEditText, editor, event)) refreshBriefSearch();
});
document.addEventListener('input', event => {
  const custom = event.target.closest?.('[data-reminder-custom-input]'); if (custom) changeCustomReminderOption(custom.closest('[data-reminder-options-for]'));
  if (event.target.id) document.querySelectorAll(`[data-reminder-options-for="${CSS.escape(event.target.id)}"]`).forEach(syncReminderOptionGroup);
});
document.addEventListener('change', event => {
  const task = event.target.closest?.('[data-reminder-complete]');
  if (task) { task.checked = false; return run(() => changeReminderTask(task.dataset.reminderStore, task.dataset.reminderComplete, task.dataset.reminderHead)); }
  const option = event.target.closest?.('[data-reminder-option]'); if (option) return changeReminderOption(option);
  const toggle = event.target.closest?.('[data-reminder-custom-toggle]'); if (toggle) changeCustomReminderOption(toggle.closest('[data-reminder-options-for]'), toggle.checked);
});
function handleAppVisibilityChange() {
  dismissKeyboard();
  if (document.hidden) {
    const retain = canRetainInsightBackground();
    syncEpoch++; syncScheduler.pause(); finishAttendancePrompt(); clearNearbyPosition();
    if(monthlyFeedbackContext)void flushMonthlyFeedbackDraft().catch(()=>{}); if (editorContext?.type === 'visit' || singleStoreContext) void flushVisitDraft();
    if (inlineTextContext) void flushInlineTextDraft();
    if (activeReminderDraftContext()) void flushReminderDraft().catch(() => {});
    document.body.classList.add('privacy-veil');
    // Only this read-only Mac session survives a tab switch. Other work still
    // uses foreground guards; pagehide/lock always revoke this capability.
    insightBackgroundActive = retain ? { key, meta, payload, bundle: payload.bundle, epoch: syncEpoch } : null;
    if (retain) queueInsightScan();
    else if (payload || busy || backupPreview) lockNow(false);
  } else {
    insightBackgroundActive = null;
    if (pendingLock || !payload) { pendingLock = false; document.body.classList.remove('privacy-veil'); showGate(); }
    else { document.body.classList.remove('privacy-veil'); requestNearbyPosition(); }
    resumeDayPlanContext(); resumeMonthlyVisitContext(); syncScheduler.request('foreground');
    refreshMonthlyAlertBadges(); refreshInsightChangeBadges(); queueInsightScan();
  }
}
document.addEventListener('visibilitychange', handleAppVisibilityChange);
window.addEventListener('pagehide', () => { syncEpoch++; syncScheduler.pause(); finishAttendancePrompt(); dismissKeyboard(); clearNearbyPosition(); if(monthlyFeedbackContext)void flushMonthlyFeedbackDraft().catch(()=>{}); if (editorContext?.type === 'visit' || singleStoreContext) void flushVisitDraft(); if (inlineTextContext) void flushInlineTextDraft(); if (activeReminderDraftContext()) void flushReminderDraft().catch(() => {}); if (payload || busy || backupPreview) lockNow(false); });
window.addEventListener('pageshow', () => { dismissKeyboard(); if (!payload && !document.hidden) { document.body.classList.remove('privacy-veil'); showGate(); } if (!document.hidden) { refreshMonthlyAlertBadges(); resumeDayPlanContext(); resumeMonthlyVisitContext(); syncScheduler.request('foreground'); queueInsightScan(); } });
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
$('day-plan-form').addEventListener('submit', event => event.preventDefault());
$('day-plan-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDayPlanEditor(); });
$('monthly-visit-dialog').addEventListener('cancel', event => { event.preventDefault(); closeMonthlyVisitSelection(); });
$('monthly-visit-dialog').addEventListener('close', () => {
  if (!$('monthly-visit-dialog').open && monthlyVisitContext) { openDialog($('monthly-visit-dialog')); closeMonthlyVisitSelection(); }
});
document.addEventListener('input', event => { if (event.target.id === 'monthly-store-search' && !busy) renderMonthlyVisitChoices(event.target.value); });
document.addEventListener('change', event => {
  if (event.target.id !== 'monthly-visit-month' || busy || monthlyVisitContext) return;
  try { changeMonthlyVisitMonth(event.target.value, { keepInputFocus: true }); } catch (error) { event.target.value = monthlyVisitSelectedMonth; toast(error.message); }
});
$('day-plan-dialog').addEventListener('close', () => {
  if (!$('day-plan-dialog').open && dayPlanContext) { openDialog($('day-plan-dialog')); closeDayPlanEditor(); }
});
$('day-plan-fields').addEventListener('input', event => {
  if (event.target.id === 'day-store-search' && !busy) renderDayPlanChoices(event.target.value);
});
$('day-plan-content').addEventListener('change', event => {
  if (event.target.id !== 'day-plan-date' || busy || dayPlanContext || monthlyVisitContext) return;
  try { dayPlanSelectedDate = dayPlanDate(event.target.value); dayPlanSorting = false; dayPlanNotice = ''; dayPlanUndo = null; renderDayPlan(); } catch (error) { event.target.value = dayPlanSelectedDate; toast(error.message); }
});
$('review').addEventListener('submit', event => {
  if (event.target.id === 'single-store-capture-form') saveSingleStoreVisit(event);
  if (event.target.id === 'store-merge-form') { event.preventDefault(); void run(previewStoreMerge, 'store-merge-error'); }
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
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => queueMicrotask(() => { releaseDialogBackground(); releaseIdleInlineEdit(); syncScheduler.wake(); })));
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
for (const type of ['input', 'compositionstart', 'compositionend']) $('editor-fields').addEventListener(type, event => {
  if (event.target.id === 'f-store-search') {
    if (!event.isComposing && event.type !== 'compositionstart') refreshVisitStoreOptions(event.target.value);
    return;
  }
  if (editorContext?.type === 'visit' && event.target.id !== 'f-files') scheduleVisitDraftSave(event);
});
$('editor-fields').addEventListener('change', event => { if (event.target.id === 'f-store') toggleQuickStoreFields(); if (editorContext?.type === 'visit' && !['f-files', 'f-store-search'].includes(event.target.id)) scheduleVisitDraftSave(); });
for (const type of ['input', 'change', 'compositionstart', 'compositionend']) $('review').addEventListener(type, event => {
  if (singleStoreContext && event.target.closest('#single-store-capture-form') && event.target.id !== 'single-store-files') scheduleVisitDraftSave(event);
});
$('quality-content').addEventListener('change', e => { if (e.target.id === 'quality-field') { qualityField = e.target.value; qualityPage = 0; renderQuality(); } });
$('gate-restore').addEventListener('click', () => { if (!$('password').value) { $('gate-error').textContent = '請先在密碼欄填寫備份密碼。'; return; } $('backup-file').click(); });
$('recovery-export-form').addEventListener('submit', event => { event.preventDefault(); void run(exportRecoveryBackup, 'recovery-export-error'); });
$('recovery-export-dialog').addEventListener('cancel', () => { clearRecoveryExport(); });
$('recovery-export-dialog').addEventListener('close', () => { clearRecoveryExport(); });
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
let visitSearchTimer = null;
for (const type of ['input', 'compositionstart', 'compositionend']) $('visit-search').addEventListener(type, event => {
  clearTimeout(visitSearchTimer);
  if (event.isComposing || event.type === 'compositionstart') return;
  const session = key;
  visitSearchTimer = setTimeout(() => {
    if (key === session && payload && activeView === 'visits') renderVisits();
  }, 120);
});
new ResizeObserver(drawGraph).observe($('graph-wrap'));
if (!isSecureContext || !crypto.subtle) { $('gate-error').textContent = '需要受信任的 HTTPS 連線。請完成 Mac 與 iPhone 憑證設定，不要略過憑證警告。'; $('gate-submit').disabled = true; }
else {
  showGate();
  const draftBusy = () => !!monthlyFeedbackContext || !!payload?.monthlyFeedbackDraft || !!payload?.supervisorDraft || busy || gateOpening || peopleBatchRunning || !!recoveryExportContext || !!weeklyContext || weeklyRunning || !!backupPreview || !!editorContext || !!inlineTextContext || !!reminderContext || !!dayPlanContext || !!monthlyVisitContext || !!payload?.inlineTextDraft || $('review').open || $('quick-text-dialog')?.open || $('store-reminder-dialog')?.open || $('rebuild-dialog')?.open || csvImport.hasPending() || (!$('gate').hidden && [...$('gate-form').querySelectorAll('input')].some(el => el.value && !['device-name'].includes(el.id)));
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

$('store-insights-file').addEventListener('change', () => { const file = $('store-insights-file').files[0]; $('store-insights-file').value = ''; if (file) run(() => previewInsightsFile(file)); });
$('review').addEventListener('change', event => { if (event.target.id === 'insights-ack') $('apply-store-insights').disabled = busy || !event.target.checked; });
$('review').addEventListener('close', () => { insightsPreview = null; });

$('review-body').addEventListener('toggle', event => {
  const detail = event.target;
  if (!detail.open) return;
  if (detail.matches('[data-insight-source]') && detail.dataset.insightOwner) {
    // Only a still-current, exact human approval may expose its cited snapshot.
    // Re-resolve on every expansion; never substitute a current revision.
    const entry = storeInsightDisplayForStore(payload.bundle, detail.dataset.insightOwner).entries.find(item => item.id === detail.dataset.insightEntry);
    const store = by('store', detail.dataset.insightOwner);
    const evidence = entry && store && insightDisplayReview(store, entry).status === 'confirmed' ? storeInsightEvidenceForEntry(payload.bundle, entry)[Number(detail.dataset.insightEvidence)] : null;
    const valid = evidence?.historicalAvailable && evidence.visitId === detail.dataset.insightSource && evidence.revisionId === detail.dataset.insightRevision && evidence.storeId === detail.dataset.insightStore;
    detail.querySelector('pre').textContent = valid ? evidence.rawText : '無法核實當時引用的完整原文版本；保留引句，不以其他版本替代。';
  } else if (detail.matches('[data-insight-source]')) {
    const visit = by('visit', detail.dataset.insightSource), store = by('store', detail.dataset.insightStore);
    const valid = visit && store && !visit.deleted && !visit.conflict && !visit.sourceMissing && !visit.googleUpdatePending && visit.heads.length === 1 && visit.heads[0].id === detail.dataset.insightRevision && visit.store === store.id && !store.deleted && !store.conflict && !store.csvIdentityPending && !store.mergedInto && !store.sourceMissing && !store.googleUpdatePending;
    detail.querySelector('pre').textContent = valid ? visit.text : '來源已改變，請關閉後重新查看；這裡不顯示過時原文。';
  }
  if (detail.matches('[data-insight-preview]') && !detail.dataset.loaded && insightsPreview && insightsPreview.kind !== 'relations') {
    const item = insightsPreview.plan.ready[Number(detail.dataset.insightPreview)];
    if (!item) return;
    detail.querySelector('div').innerHTML = (item.before ? `<details><summary>原分析內容（舊版本會保留）</summary><pre>${esc(JSON.stringify(item.before, null, 2))}</pre></details>` : '<p>原先沒有分析內容。</p>') + (item.after.entries.length ? item.after.entries.map(entry => insightEntryHTML({ ...entry, evidence: entry.evidence.map(source => ({ ...source, storeName: by('store', source.storeId)?.name || '', sourceLabel: by('visit', source.visitId)?.source || '現行原文' })) }, item.after.sourceAsOf, item.storeId)).join('') : '<p>這次會撤下此店線索；原分析仍保留在版本歷史。</p>');
    detail.dataset.loaded = '1';
  }
}, true);

$('review').addEventListener('close', () => { if (!$('review').open) clearStoreMergePreview(); });
$('review').addEventListener('change', event => {
  if (['store-merge-ack', 'store-merge-devices'].includes(event.target.id)) updateStoreMergeControls();
  if (event.target.id === 'store-merge-backup-file') { const file = event.target.files[0]; event.target.value = ''; if (file) void run(() => verifyStoreMergeBackup(file), 'store-merge-error'); }
});

$('weekly-setup')?.addEventListener('click',()=>run(openWeeklySetup,'weekly-status'));
$('weekly-form')?.addEventListener('submit',event=>{event.preventDefault();void run(saveWeeklySetup,'weekly-error');});
$('weekly-dialog')?.addEventListener('close',clearWeeklySetup);
$('weekly-dialog')?.addEventListener('cancel',clearWeeklySetup);
$('weekly-refresh')?.addEventListener('click',()=>void weeklyTick(true));
$('weekly-download')?.addEventListener('click',()=>run(downloadWeeklyBackup,'weekly-status'));

$('insight-changes-dialog').addEventListener('close', () => { insightChangesContext = null; $('insight-changes-body').replaceChildren(); $('insight-changes-title').textContent = '線索新變化'; $('insight-changes-error').textContent = ''; syncScheduler.wake(); });
$('insight-changes-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });

$('supervision-file').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';if(file) void run(()=>previewSupervisionFile(file));});
$('review').addEventListener('change',event=>{if(event.target.matches?.('[data-supervision-store],#supervision-all,#supervision-ack')) updateSupervisionControls(event);});
$('review').addEventListener('close',()=>{if(!$('review').open) supervisionPreview=null;});


function analysisCardHTML(item) {
  return `<article class="analysis-card">${item.format==='yq-alert-2' && item.row.previousResult!==null?`<section class="analysis-previous"><h4>分析端回饋（上期）</h4><p class="analysis-verbatim">${esc(item.row.previousResult)}</p><p class="muted">外部唯讀分析，不是拜訪原文或已核實的人物關係。</p></section>`:''}<p class="muted">拜訪 ${esc(item.visitMonth)} · 銷量 ${esc(item.salesMonth)} · ${esc(item.channel)}${item.needsReview ? ' · 門市資料有變化，需重新核對' : ''}</p><h4>${esc(item.row.name)}</h4><details class="analysis-detail" data-analysis-detail="${esc(item.id)}:reason"><summary>分析原因與數據</summary><p class="analysis-verbatim">${esc(item.row.reason)}</p></details><details class="analysis-detail" data-analysis-detail="${esc(item.id)}:checkpoints"><summary>現場詢問與執行 · ${item.row.checkpoints.length} 項</summary><ol>${item.row.checkpoints.map(text => `<li class="analysis-verbatim">${esc(text)}</li>`).join('')}</ol></details>${item.format==='yq-alert-2'?typedFeedbackHTML(item):monthlyFeedbackHTML(item)}<details><summary>來源與配對依據</summary><p>${esc(item.file)} · ${esc(item.at)}</p><p>SHA256：${esc(item.blob)}</p><p>確認時名稱：${esc(item.assignments.find(m=>m.storeId === item.storeId)?.name || '')}</p><p>外部分析建議，並非已完成拜訪或已證實事實。</p></details></article>`;
}
function monthlyAnalysisStoreHTML(store) {
  const items = monthlyAnalysisForStore(payload.bundle, store.id).map(item=>({...item,storeId:store.id})), current = items.filter(item=>item.current), history = items.filter(item=>!item.current);
  if (!items.length) return '';
  return `<section class="panel monthly-analysis"><h3>本月分析建議</h3>${current.map(analysisCardHTML).join('') || '<p class="muted">本月沒有已核對的分析建議；歷史不自動當成本月任務。</p>'}${history.length?`<details><summary>歷史／待重新核對 · ${history.length} 份</summary>${history.map(analysisCardHTML).join('')}</details>`:''}</section>`;
}
function analysisOverviewHTML(month) {
  const sources = monthlyAnalysisSources(payload.bundle), matches = sources.filter(source=>source.visitMonth === month);
  const draft=payload.monthlyFeedbackDraft, draftSource=draft? sources.find(source=>source.id===draft.analysisId):null, draftStore=draftSource?.assignments[draft.rowIndex];
  const replaced=new Set(matches.flatMap(source=>source.supersedes)),active=matches.filter(source=>!replaced.has(source.id));
  const alerts=active.flatMap(source=>source.assignments.flatMap((match,rowIndex)=>{if(!match.storeId)return [];const state=source.format==='yq-alert-2'?typedFeedbackState(payload.bundle,source.id,rowIndex):monthlyFeedbackState(payload.bundle,source.id,rowIndex),item=monthlyAnalysisForStore(payload.bundle,match.storeId,month).find(item=>item.id===source.id);return [{...match,source,rowIndex,state,needsReview:!item?.current || item.needsReview}];}));
  return `<section class="panel monthly-analysis">${draftStore?.storeId?`<p class="muted">未完成回報草稿：<button type="button" class="text-button" data-visit-brief="${esc(draftStore.storeId)}">${esc(draftStore.name)}</button> <button type="button" data-feedback-resume>繼續／查看回報草稿</button>（只在這台裝置，先完成再匯入新期）</p>`:''}<h3>每月分析建議</h3>${analysisCodeManagementHTML()}<p>每月選一次 JSON；沿用已確認且仍一致的門市對應，有疑義的逐店核對。新一期取代分析顯示，舊期與現場回報完整保留。</p><button type="button" data-analysis-open>匯入每月分析 JSON</button><button type="button" data-feedback-export-open>匯出給分析</button>${alerts.length?`<h4>${esc(month)} 分析警示門市 · ${new Set(alerts.map(row=>row.storeId)).size} 間</h4><p class="muted">獨立分析名單，不更動下方必訪名單或已訪狀態。</p><ul class="monthly-alert-list">${alerts.map(row=>`<li><button type="button" class="text-button" data-visit-brief="${esc(row.storeId)}">${esc(row.name)}</button><span>${esc(row.source.channel)} · ${row.needsReview?'分析來源需核對':row.state.conflict?'回報分歧需核對':row.state.current?`已回報 ${row.state.current.data.monthlyFeedback.answers.filter(answer=>answer.text.trim()).length}／${row.source.rows[row.rowIndex].checkpoints.length} 題`:row.source.format==='yq-alert-2' && row.state.reports.length?`已回報 ${row.state.reports.length} 次`:'尚未回報'}</span></li>`).join('')}</ul>`:''}<p>${matches.length ? `${esc(month)} 有 ${matches.length} 份來源（含修訂），點門市可讀完整原因與詢問清單。` : `${esc(month)} 尚無分析來源，不會沿用上個月建議。`}</p>${matches.map(s=>`<details><summary>${esc(s.channel)} · ${esc(s.file)} · ${s.assignments.filter(m=>m.storeId).length} 間已對應（含修訂歷史）</summary>${s.assignments.filter(m=>m.storeId).map(m=>`<p><button type="button" class="text-button" data-visit-brief="${esc(m.storeId)}">${esc(m.name)}</button> · ${esc(m.address || '無地址')}</p>`).join('')}</details>`).join('')}<details><summary>全部來源歷史 · ${sources.length} 份</summary>${sources.map(s=>`<p>拜訪 ${esc(s.visitMonth)}／銷量 ${esc(s.salesMonth)} · ${esc(s.channel)} · ${esc(s.file)}</p>`).join('') || '<p>尚無來源</p>'}</details></section>`;
}
function analysisCodeManagementHTML() {
  const choices=analysisStoreCodeChoices(payload.bundle);if(!choices.length)return '';
  return `<details><summary>已確認分析店碼對照 · ${choices.length} 組</summary>${choices.map(state=>{
    const value=state.current?.data.analysisStoreCode;
    return `<p>${esc(state.channel)}／${esc(state.code)} · ${esc(value?.name||'不同裁定')} · ${state.conflict?'有分歧，需重新核對':value?.status==='revoked'?'已撤銷':state.usable?'身分一致，可預選':'門市身分已變，需重新核對'}${value?.status==='confirmed'?` <button type="button" data-analysis-code-revoke="${esc(state.code)}" data-analysis-code-head="${esc(state.current.entity)}">撤銷此店碼對照</button>`:''}</p>`;
  }).join('')}</details>`;
}
let analysisCodeRevocation=null;
function openRemoveAnalysisStoreCode(button) {
  assertMonthlyVisitIdle();
  const ctx={payload,key,meta,epoch:syncEpoch,code:button.dataset.analysisCodeRevoke,head:button.dataset.analysisCodeHead};
  analysisCodeRevocation=ctx;
  $('monthly-analysis-dialog').innerHTML=`<h2 id="analysis-title" data-dialog-focus tabindex="-1" autofocus>撤銷分析店碼對照</h2><p>佑全店碼 ${esc(ctx.code)}。只追加撤銷紀錄；門市、已匯入分析、回報與全部歷史保留。下次須重新人工選擇。</p><label class="check"><input type="checkbox" id="analysis-code-revoke-ack">確認撤銷此店碼的自動預選</label><p id="analysis-error" class="error" role="alert"></p><div class="dialog-footer"><button type="button" data-close="monthly-analysis-dialog">取消，不修改</button><button type="button" data-analysis-code-revoke-save>確認撤銷對照</button></div>`;
  openDialog($('monthly-analysis-dialog'));
}
async function saveRemoveAnalysisStoreCode() {
  const ctx=analysisCodeRevocation;
  const guard=()=>{if(!ctx || payload!==ctx.payload || key!==ctx.key || meta!==ctx.meta || syncEpoch!==ctx.epoch || syncInProgress || document.hidden || pendingLock || updateHolding || !$('monthly-analysis-dialog').open)throw new Error('資料或工作階段已變，請重新核對。');};guard();
  if(!$('analysis-code-revoke-ack')?.checked)throw new Error('請核對後勾選確認；尚未撤銷。');
  const bundle=await revokeAnalysisStoreCode(payload.bundle,'佑全',ctx.code,ctx.head,payload.device);guard();
  await persist({...payload,bundle,dirty:true},{guard});analysisCodeRevocation=null;$('monthly-analysis-dialog').close();render();toast('已撤銷店碼預選；原分析、筆記與歷史保留。');
}
async function prefillAnalysisMonths() {
  const files=[...$('analysis-files').files],session=payload,sessionKey=key,epoch=syncEpoch;
  if(!files.length || files.length>2 || files.some(file=>file.size>2097152))return;
  const documents=await Promise.all(files.map(async file=>parseMonthlyAnalysisDocument(new Uint8Array(await file.arrayBuffer()))));
  if(payload!==session || key!==sessionKey || syncEpoch!==epoch || !$('monthly-analysis-dialog').open || document.hidden || pendingLock || files.length!==$('analysis-files').files.length || files.some((file,i)=>file!==$('analysis-files').files[i]))return;
  const periods=documents.filter(doc=>doc.format==='yq-alert-2');if(!periods.length)return;
  if(periods.some(doc=>doc.salesMonth!==periods[0].salesMonth || doc.visitMonth!==periods[0].visitMonth))throw new Error('同批 v2 月份不同，請分批核對。');
  $('analysis-sales').value=periods[0].salesMonth;$('analysis-visit').value=periods[0].visitMonth;
  $('analysis-error').textContent='已依 v2 原檔預填月份，請核對後按「讀取並比對」。';
}
function openAnalysisImport() {
  assertMonthlyVisitIdle();
  analysisImport = null;
  const dialog=$('monthly-analysis-dialog'),visitMonth=monthlyVisitMonth(),salesMonth=shiftMonthlyVisitMonth(visitMonth,-1);
  dialog.innerHTML=`<form method="dialog"><button class="dialog-close" aria-label="關閉">×</button></form><h2 id="analysis-title" data-dialog-focus tabindex="-1" autofocus>匯入每月分析 · 尚未寫入</h2><p>預設上月銷量、本月拜訪；請核對月份，可修改。原檔與全部分析完整留存；不新增門市，不覆蓋筆記、待辦或拜訪歷史。</p><div class="field-grid"><label>銷量期別<input id="analysis-sales" type="month" value="${salesMonth}" required></label><label>建議拜訪月份<input id="analysis-visit" type="month" value="${visitMonth}" required></label></div><label>大樹／佑全 JSON（最多兩份）<input id="analysis-files" type="file" accept=".json,application/json" multiple></label><button type="button" data-analysis-preview>讀取並比對</button><p id="analysis-error" class="error" role="alert"></p><div id="analysis-matches"></div>`;
  openDialog(dialog);
}
async function previewAnalysisImport() {
  const session={payload,key,meta,epoch:syncEpoch}, guard=()=>{
    if(payload!==session.payload || key!==session.key || meta!==session.meta || syncEpoch!==session.epoch || document.hidden || pendingLock || !$('monthly-analysis-dialog').open) throw new Error('工作階段已改變，請重新讀取；尚未寫入。');
  };
  guard(); const files=[...$('analysis-files').files], sales=$('analysis-sales').value, visit=$('analysis-visit').value;
  if(!files.length || files.length>2 || files.some(f=>f.size>2097152)) throw new Error('請選 1–2 份 JSON，每份上限 2 MB。');
  const inputs=await Promise.all(files.map(async file=>({name:file.name,raw:new Uint8Array(await file.arrayBuffer())})));
  guard(); if($('analysis-sales').value!==sales || $('analysis-visit').value!==visit || [...$('analysis-files').files].some((file,i)=>file!==files[i]) || $('analysis-files').files.length!==files.length) throw new Error('選檔或月份已改變，請重新讀取。'); const plan=await prepareMonthlyAnalysis(payload.bundle,inputs,sales,visit);guard();
  plan.files.forEach(file=>{file.remembered=file.rows.map(row=>rememberedMonthlyAnalysisChoice(payload.bundle,row));});
  analysisImport={plan,session,guard};
  $('analysis-matches').innerHTML=`<h3>逐間核對 · 只沿用已確認且身分一致的對應</h3><p>v2 僅沿用人工確認的店碼對照；v1 保留原對應流程。同名或不同寫法只列候選，請核對完整名稱與地址；不確定請先關閉，詢問 Kit 後再匯入。選「不套用」仍保存該列原文。</p>${plan.files.map((file,f)=>`<section><h3>${esc(file.channel)} · ${esc(file.name)}</h3>${file.rows.map((row,r)=>`<article class="analysis-card"><h4>${esc(row.name)} · ${esc(row.channel)}${file.format==='yq-alert-2'?` · 店碼 ${esc(row.storeCode)}`:''}</h4>${file.format==='yq-alert-2'?`<p class="muted">核心四題與客製 ${row.checks.length} 題；匯入後由你在門市表單親自作答。</p>${row.previousResult!==null?`<details><summary>分析端回饋（上期）</summary><p class="analysis-verbatim">${esc(row.previousResult)}</p></details>`:''}`:''}<details><summary>完整分析與現場清單</summary><p class="analysis-verbatim">${esc(row.reason)}</p><ol>${row.checkpoints.map(t=>`<li>${esc(t)}</li>`).join('')}</ol></details><label>對應既有門市<select data-analysis-choice="${f}:${r}"><option value="">待核對，請選擇</option><option value="skip">本期不套用至門市（原文留存）</option>${file.candidates[r].map(({store,exact})=>`<option value="${esc(store.id)}" ${file.remembered[r]===store.id?'selected':''}>${file.remembered[r]===store.id?'沿用已確認':exact?'名稱相符候選':'其他同通路'} · ${esc(store.name)} · ${esc(store.address || '無地址，須另行核對')} · ${esc(store.id)}</option>`).join('')}</select></label></article>`).join('')}</section>`).join('')}<button type="button" data-analysis-final>下一步：最後完整名單／全部確認預選</button><div id="analysis-final"></div>`;
}
function analysisSelections() { return analysisImport.plan.files.map((file,f)=>file.rows.map((_,r)=>document.querySelector(`[data-analysis-choice="${f}:${r}"]`).value)); }
function finalAnalysisImport() {
  if(!analysisImport) throw new Error('請先讀取原檔。');analysisImport.guard();
  const choices=analysisSelections(); if(choices.flat().some(v=>!v)) throw new Error('仍有待核對門市，請完成所有列或明確選擇不套用。');
  const ids=choices.flat().filter(v=>v!=='skip');if(new Set(ids).size!==ids.length) throw new Error('同店重複，請先核對。');
  analysisImport.finalChoices=JSON.stringify(choices);
  const changes=monthlyAnalysisChangeSummary(payload.bundle,analysisImport.plan,choices);
  $('analysis-final').innerHTML=`<h3>最後核對 · 尚未寫入</h3><p>銷量 ${esc(analysisImport.plan.salesMonth)} → 拜訪 ${esc(analysisImport.plan.visitMonth)}，套用 ${ids.length} 間。只更新獨立分析區，門市與原筆記不變。</p>${analysisImport.plan.files.some(file=>file.format==='yq-alert-2')?'<p>本次所選 v2 店碼對應另存人工確認紀錄；之後只有店碼與原門市身分仍一致才自動預選。略過本期不等於撤銷既有店碼。</p>':''}${changes.map(change=>`<p>${esc(change.channel)}：分析新增 ${change.added}／更新 ${change.updated}／本期不再列入 ${change.archived}${change.needsReview?'（歷史來源分歧，請核對）':''}。歷史保留，不新增或刪除門市。</p>`).join('')}${analysisImport.plan.files.map((file,f)=>file.rows.map((row,r)=>{const store=file.candidates[r].find(c=>c.store.id===choices[f][r])?.store;return `<p>${esc(row.channel)}／${esc(row.name)} → <strong>${store?esc(store.name):'不套用（原文保留）'}</strong>${store?`<br>${esc(store.address || '無地址')} · ID ${esc(store.id)}`:''}</p>`;}).join('')).join('')}${analysisImport.plan.files.some(f=>f.replacing)?'<p>本期已有分析；確認後同通路改顯示本批，舊批收合保存。</p>':''}<label class="check"><input id="analysis-ack" type="checkbox">我已核對月份、通路與逐店對應，確認保存此批（舊期及舊批完整保留）</label><button type="button" data-analysis-save>確認名單並保存分析</button>`;
}
async function saveAnalysisImport() {
  const ctx=analysisImport;if(!ctx) throw new Error('請重新讀取原檔。');ctx.guard();
  const choices=analysisSelections();if(!$('analysis-ack')?.checked || JSON.stringify(choices)!==ctx.finalChoices) throw new Error('請重新查看最後名單並勾選確認。');
  const bundle=await applyMonthlyAnalysis(payload.bundle,ctx.plan,choices,payload.device,true);ctx.guard();
  await persist({...payload,bundle,dirty:true},{guard:ctx.guard});
  $('monthly-analysis-dialog').close();analysisImport=null;render();toast('每月分析已保存，原筆記與拜訪歷史未更改。');
}

$('monthly-analysis-dialog').addEventListener('close',()=>{analysisImport=null;analysisCodeRevocation=null;monthlyExportPreview=null;});
$('monthly-analysis-dialog').addEventListener('change', event=>{ if(event.target.matches('#feedback-export-channel,#feedback-export-month,#feedback-export-format,#feedback-export-history')){monthlyExportPreview=null;if($('feedback-export-preview'))$('feedback-export-preview').innerHTML='';} if(event.target.matches('[data-yq-export-note]') && $('feedback-export-ack'))$('feedback-export-ack').checked=false; if(event.target.matches('[data-analysis-choice]') && analysisImport){delete analysisImport.finalChoices;$('analysis-final').innerHTML='';} if(event.target.matches('#analysis-files,#analysis-sales,#analysis-visit')){analysisImport=null;$('analysis-matches').innerHTML='';if(event.target.id==='analysis-files')void run(prefillAnalysisMonths,'analysis-error');} });

$('review').addEventListener('click',event=>{
 const clear=event.target.closest?.('[data-typed-clear]');if(clear && singleStoreContext?.typedPlan && !singleStoreContext.typedReadOnly){const i=Number(clear.dataset.typedClear),field=$(`typed-value-${i}`);if(field)field.value='';for(const radio of document.querySelectorAll(`input[name="typed-choice-${i}"]`))radio.checked=false;if(singleStoreContext.typedPlan.questions[i]?.id==='core.push_sku')$('typed-other').value='';scheduleVisitDraftSave();return;}
 const refreshButton=event.target.closest?.('[data-reading-refresh]');if(refreshButton){void run(()=>requestPeopleReadingRefresh(refreshButton.dataset.readingRefresh),'people-relation-error');return;}
 const aliasButton=event.target.closest?.('[data-reading-alias-status]');if(aliasButton){void run(()=>changePeopleAliasReview(aliasButton),'people-relation-error');return;}
 const relationButton=event.target.closest?.('[data-reading-relation-status]');if(relationButton){void run(()=>changePeopleRelationshipReview(relationButton),'people-relation-error');return;}
 const approveButton=event.target.closest?.('[data-reading-approve]');if(approveButton){const storeId=approveButton.dataset.readingApprove,doc=currentPeopleReading(payload.bundle,storeId).current?.peopleReading;if(doc){const text=JSON.stringify({format:'pharmacy-people-review-1',vaultId:payload.bundle.vaultId,result:doc.result});void run(()=>previewPeopleReadingFile({size:new TextEncoder().encode(text).length,text:async()=>text},storeId));}return;}
 const exportButton=event.target.closest?.('[data-reading-export]');if(exportButton){void run(()=>exportPeopleReading(exportButton.dataset.readingExport));return;}
 const importButton=event.target.closest?.('[data-reading-import]');if(importButton){document.querySelector('[data-reading-file="'+CSS.escape(importButton.dataset.readingImport)+'"]')?.click();return;}
 if(event.target.closest?.('[data-reading-cancel]')){const id=peopleReadingPreview?.plan.storeId;peopleReadingPreview=null;if(id)openVisitBrief(id);return;}
 if(event.target.closest?.('#people-reading-save'))void run(commitPeopleReading,'people-reading-error');
});
$('review').addEventListener('change',event=>{
 if(event.target.id==='people-reading-ack'){$('people-reading-save').disabled=!event.target.checked;return;}
 if(event.target.matches?.('[data-reading-file]')){const file=event.target.files[0],storeId=event.target.dataset.readingFile;event.target.value='';if(file)void run(()=>previewPeopleReadingFile(file,storeId));}
});

function monthlyFeedbackHTML(item) {
  const rowIndex=item.assignments.findIndex(match=>match.storeId===item.storeId),state=monthlyFeedbackState(payload.bundle,item.id,rowIndex);
  const replyHTML=op=>{const value=op.data.monthlyFeedback;return `<article class="monthly-feedback-result"><p>回報日期：${esc(value.visitDate || '未提供')} · 保存 ${esc(dateText(value.createdAt))}</p>${value.answers.map(answer=>`<p><strong>${esc(answer.question)}</strong><br>${esc(answer.text || '尚未填答')}</p>`).join('')}${value.notes?`<p>補充：${esc(value.notes)}</p>`:''}</article>`;};
  const draft=payload.monthlyFeedbackDraft?.analysisId===item.id && payload.monthlyFeedbackDraft.rowIndex===rowIndex;
  return `<section class="monthly-feedback"><h4>現場回報</h4><p>${state.conflict?'有不同回報版本，請核對後另存修訂':state.current?`已填 ${state.current.data.monthlyFeedback.answers.filter(answer=>answer.text.trim()).length}／${item.row.checkpoints.length} 題`:'尚未回報；未回答不代表零或未執行'}${draft?' · 有本機未完成草稿':''}</p>${state.heads.map(replyHTML).join('')}${item.current || draft?`<button type="button" data-feedback-open="${esc(item.id)}" data-feedback-row="${rowIndex}">${draft?'繼續現場回報':state.history.length?'修改／補充現場回報':'填寫現場結果'}</button>`:'<p class="muted">歷史分析與回報留存，不自動帶入新一期。</p>'}${state.history.length>state.heads.length?`<details><summary>過去回報 · ${state.history.length-state.heads.length} 份</summary>${state.history.filter(op=>!state.heads.some(head=>head.entity===op.entity)).map(replyHTML).join('')}</details>`:''}<p class="muted">獨立保存，不改原筆記、人物關係或待辦；只有保存時親自勾選今天實際拜訪，才更新最近拜訪與本月已訪狀態。</p></section>`;
}
function assertMonthlyFeedbackCurrent(ctx) {
  if(!ctx || monthlyFeedbackContext!==ctx || !payload || key!==ctx.key || meta!==ctx.meta || payload.bundle!==ctx.bundle || syncEpoch!==ctx.epoch || document.hidden || pendingLock || updateHolding || syncInProgress || !$('monthly-analysis-dialog').open || (!ctx.readOnly && monthlyVisitMonth()!==ctx.plan.visitMonth))throw new Error('來源、工作階段或月份有變，請重新核對；輸入保留。');
}
function monthlyFeedbackInput() {
  return {visitDate:$('monthly-feedback-date').value,answers:[...document.querySelectorAll('[data-feedback-answer]')].map(node=>node.value),notes:$('monthly-feedback-notes').value};
}
async function flushMonthlyFeedbackDraft() {
  const ctx=monthlyFeedbackContext;if(!ctx)return;
  clearTimeout(ctx.timer);
  const draft={format:'monthly-feedback-draft-1',analysisId:ctx.plan.analysisId,rowIndex:ctx.plan.rowIndex,questions:[...ctx.plan.questions],...monthlyFeedbackInput()};
  const generation=++ctx.generation;
  ctx.chain=ctx.chain.catch(()=>{}).then(async()=>{
    if(generation!==ctx.generation)return;
    const guard=()=>{if(monthlyFeedbackContext!==ctx || key!==ctx.key || meta!==ctx.meta || !payload || payload.bundle!==ctx.bundle)throw new Error('草稿來源已變更，輸入仍保留於畫面。');};
    guard(); await persist({...payload,monthlyFeedbackDraft:draft},{guard});
    if($('monthly-feedback-draft-state'))$('monthly-feedback-draft-state').textContent='本機加密草稿已保存；尚未正式回報，也未同步到Mac。';
  });
  return ctx.chain;
}
async function openMonthlyFeedback(analysisId,rowIndex) {
  if(!payload || !key || pendingLock || updateHolding || autoFetching || syncInProgress || monthlyFeedbackContext || editorContext || singleStoreContext || inlineTextContext || reminderContext || payload.draft || payload.inlineTextDraft || storedReminderDrafts().length || csvImport.hasPending())throw new Error('請先完成目前修改並等同步結束，再填回報。');
  const draft=payload.monthlyFeedbackDraft;let plan,readOnly=false;
  try{plan=prepareMonthlyFeedback(payload.bundle,analysisId,rowIndex);}catch(error){
    if(!draft || draft.analysisId!==analysisId || draft.rowIndex!==rowIndex)throw error;
    const source=monthlyAnalysisSources(payload.bundle).find(source=>source.id===analysisId),match=source?.assignments[rowIndex];
    if(!match?.storeId)throw error;
    plan={analysisId,rowIndex,storeId:match.storeId,storeName:match.name,salesMonth:source.salesMonth,visitMonth:source.visitMonth,questions:[...draft.questions],state:monthlyFeedbackState(payload.bundle,analysisId,rowIndex)};readOnly=true;
  }
  if(draft && (draft.analysisId!==analysisId || draft.rowIndex!==rowIndex))throw new Error('另一間門市有未完成回報草稿，請先回該店處理；不覆蓋草稿。');
  if(draft && JSON.stringify(draft.questions)!==JSON.stringify(plan.questions))throw new Error('原題目已變更，草稿保留；請核對來源，不直接套到新題。');
  const current=plan.state.current?.data.monthlyFeedback;
  const value=draft || current || {visitDate:attendanceTaipeiDate(Date.now()),answers:plan.questions.map(()=>''),notes:''};
  const ctx={plan,bundle:payload.bundle,key,meta,epoch:syncEpoch,chain:Promise.resolve(),generation:0,timer:null,readOnly};monthlyFeedbackContext=ctx;syncScheduler.pause();
  const answers=draft?draft.answers:current?current.answers.map(answer=>answer.text):value.answers;
  $('monthly-analysis-dialog').innerHTML=`<h2 id="analysis-title" data-dialog-focus tabindex="-1" autofocus>現場回報 · ${esc(plan.storeName)}</h2><p>銷量 ${esc(plan.salesMonth)} → 拜訪 ${esc(plan.visitMonth)}。每一題可單獨填寫，未填保留未知。</p>${readOnly?'<p class="error">這份草稿來源已變更或已過期，只供閱讀、複製或明確捨棄；不套用到新期。</p>':''}${plan.state.conflict?'<p class="error">有並行回報，請先查看原店卡各版本；保存這次修訂將明確接替目前全部分支，歷史仍保留。</p>':''}<form id="monthly-feedback-form"><label>實際回報的拜訪日期（未知可留空）<input type="date" id="monthly-feedback-date" value="${esc(value.visitDate)}"></label>${plan.questions.map((question,index)=>`<label class="monthly-feedback-question"><strong>${index+1}. ${esc(question)}</strong><textarea data-feedback-answer="${index}" maxlength="20000" placeholder="記錄實際結果；不確定可寫不確定，不必為了保存而猜填">${esc(answers[index] || '')}</textarea></label>`).join('')}<label>其他現場補充（選填）<textarea id="monthly-feedback-notes" maxlength="20000">${esc(value.notes || '')}</textarea></label><p id="monthly-feedback-draft-state" class="muted" role="status">輸入先保存成本機加密草稿；正式保存才進入同步與完整備份。</p><p id="monthly-feedback-error" class="error" role="alert"></p><p>保存前會詢問今天是否就是實際拜訪日。只有親自勾選才另存人工拜訪確認，更新最近拜訪與本月已訪狀態；未勾選只存獨立回報。原筆記、人物分析、關係與待辦不變。</p><div class="dialog-footer"><button type="button" data-feedback-close>關閉，保留草稿</button><button type="button" data-feedback-discard>捨棄草稿</button>${readOnly?'':'<button type="submit" class="primary">核對並保存現場回報</button>'}</div></form>`;
  if(readOnly)$('monthly-analysis-dialog').querySelectorAll('input,textarea').forEach(node=>node.readOnly=true);
  openDialog($('monthly-analysis-dialog'));
}
async function closeMonthlyFeedback(discard=false) {
  const ctx=monthlyFeedbackContext;if(!ctx)return;
  if(discard){if(!confirm('只捨棄這份未完成回報草稿？已保存回報及所有原筆記保留。'))return;clearTimeout(ctx.timer);ctx.generation++;await ctx.chain.catch(()=>{});await persist({...payload,monthlyFeedbackDraft:null},{guard:()=>assertMonthlyFeedbackCurrent(ctx)});}
  else await flushMonthlyFeedbackDraft();
  clearTimeout(ctx.timer);monthlyFeedbackContext=null;$('monthly-analysis-dialog').close();render();
  if($('review').open)openVisitBrief(ctx.plan.storeId,{preservePosition:true});
  syncScheduler.wake();
}
async function saveMonthlyFeedback(event) {
  event.preventDefault();await run(async()=>{
    const ctx=monthlyFeedbackContext;if(ctx?.readOnly)throw new Error('過期草稿僅供查看，不可套用。');assertMonthlyFeedbackCurrent(ctx);await flushMonthlyFeedbackDraft();assertMonthlyFeedbackCurrent(ctx);
    const input=monthlyFeedbackInput();await applyMonthlyFeedback(payload.bundle,ctx.plan,input,payload.device);assertMonthlyFeedbackCurrent(ctx);
    const choice=await confirmStoreSave(ctx.plan.storeId,ctx.plan.storeName,true,`${ctx.plan.visitMonth} 現場回報：已填 ${input.answers.filter(text=>text.trim()).length}／${ctx.plan.questions.length} 題，未回答保留未知。回報日期：${input.visitDate || '未提供'}。\n未勾選：只保存獨立回報，不更新最近拜訪或每月已訪。\n勾選：確認今天實際到店，回報日期改為下方今天日期，另存人工拜訪確認並更新最近拜訪及本月已訪狀態。不新增必訪名單，不改原筆記、人物分析、關係或待辦。`);
    if(!choice)return;
    assertMonthlyFeedbackCurrent(ctx);
    if(choice.attendance){input.visitDate=choice.attendance.date;$('monthly-feedback-date').value=input.visitDate;await flushMonthlyFeedbackDraft();assertMonthlyFeedbackCurrent(ctx);}
    const assertConfirmed=()=>{assertMonthlyFeedbackCurrent(ctx);if(choice.attendance && attendanceTaipeiDate(Date.now())!==choice.attendance.date)throw new Error('日期已跨日，請重新確認今天的拜訪日期；輸入保留。');};
    assertConfirmed();const bundle=await applyMonthlyFeedbackWithAttendance(payload.bundle,ctx.plan,input,payload.device,choice.attendance);assertConfirmed();
    await persist({...payload,bundle,dirty:payload.dirty || bundle!==payload.bundle,monthlyFeedbackDraft:null},{guard:assertConfirmed});
    clearTimeout(ctx.timer);monthlyFeedbackContext=null;$('monthly-analysis-dialog').close();render();openVisitBrief(ctx.plan.storeId,{preservePosition:true});toast(choice.attendance?'現場回報已加密保存；已確認今天拜訪，最近拜訪與本月已訪狀態已更新。':'現場回報已加密保存；未勾選實際拜訪，最近拜訪與每月已訪狀態未更改。');
  },'monthly-feedback-error');
}
function openMonthlyFeedbackExport() {
  assertMonthlyVisitIdle();monthlyExportPreview=null;
  const month=monthlyVisitSelectedMonth || monthlyVisitMonth(),sources=monthlyAnalysisSources(payload.bundle),replaced=new Set(sources.flatMap(s=>s.supersedes)),hasV2=sources.some(s=>s.channel==='佑全' && s.visitMonth===month && s.format==='yq-alert-2' && !replaced.has(s.id));
  $('monthly-analysis-dialog').innerHTML=`<h2 id="analysis-title" data-dialog-focus tabindex="-1" autofocus>匯出給分析</h2><p>先逐店預覽；佑全 v2 可逐筆勾除直接連結的自由筆記。明文檔只由你自行下載及交給分析端，不自動傳送。</p><label>通路<select id="feedback-export-channel"><option ${!hasV2?'selected':''}>大樹</option><option ${hasV2?'selected':''}>佑全</option></select></label><label>建議拜訪月份<input type="month" id="feedback-export-month" value="${esc(month)}"></label><label>輸出格式<select id="feedback-export-format"><option value="legacy" ${!hasV2?'selected':''}>既有 v1 回報（保留原格式）</option><option value="typed" ${hasV2?'selected':''}>佑全 v2 結構化回報（yq-report-1）</option></select></label><label class="check"><input type="checkbox" id="feedback-export-history">既有 v1 格式：包含此期被接替的 v1 分析與回報歷史</label><p class="muted">v2 自動包含全部訪次及引用的舊來源；每次回報只取其已保存最新修訂，舊修訂仍留在 App。v1 需另外使用原格式匯出，不猜轉舊答案。</p><p id="feedback-export-error" class="error" role="alert"></p><button type="button" data-feedback-export-preview>產生匯出預覽</button><div id="feedback-export-preview"></div><div class="dialog-footer"><button type="button" data-close="monthly-analysis-dialog">取消，不下載</button></div>`;
  openDialog($('monthly-analysis-dialog'));
}
let monthlyExportPreview=null;
function previewMonthlyFeedbackExport() {
  const channel=$('feedback-export-channel').value,month=$('feedback-export-month').value,typed=$('feedback-export-format').value==='typed',at=new Date().toISOString(),includeHistory=$('feedback-export-history').checked;
  const result=typed?exportTypedFeedback(payload.bundle,channel,month,{appVersion:APP_VERSION,at}):exportMonthlyFeedback(payload.bundle,channel,month,{includeHistory,legacyOnly:true,at});
  if(!result.stores.length)throw new Error('此範圍沒有可匯出資料；舊 v1 歷史請勾選包含修訂歷史，不會轉換成 v2 答案。');
  monthlyExportPreview={bundle:payload.bundle,basis:JSON.stringify(payload.bundle),key,meta,epoch:syncEpoch,channel,month,typed,at,includeHistory};
  const labels={unmapped:'未對照／本期略過',not_visited:'無本期已保存拜訪證據（不代表確定沒去）',visited_no_report:'有本期紀錄、尚無結構化回報',reported:'已回報'};
  $('feedback-export-preview').innerHTML=`<h3>匯出前預覽 · 尚未下載</h3><p>${esc(result.channel)}／${esc(result.visitMonth)} · ${result.stores.length} 間。只含此裝置已正式保存且可見資料；草稿及其他裝置尚未同步資料不在內。筆記日期未知時不推定期別。</p>${typed?`<p>每筆回報標明原分析來源版本，包含它實際引用的舊來源。下方自由筆記只取回報連結當時的精確版本，可能含你自行書寫的人名或聯絡資訊，請逐筆預覽勾除。</p>${result.analysisSources.map(s=>`<details><summary>來源 ${esc(s.file)}</summary><p>${esc(s.sourceId)} · SHA256 ${esc(s.blob)}</p></details>`).join('')}${result.stores.map(store=>`<article class="analysis-card"><h4>${esc(store.storeCode)} ${esc(store.appStoreName||store.analysisName)}</h4><p>${esc(labels[store.status])}</p>${store.reports.map(report=>`<section><p>回報 ${esc(report.reportId)} · 版本 ${esc(report.revisionId)}<br>分析來源 ${esc(report.sourceId)}<br>實際拜訪日：${esc(report.attendanceDate||'未確認')} · 筆記日期：${esc(report.noteDate||'未提供')}</p>${Object.entries(report.answers).map(([id,answer])=>`<p>${esc(answer.question||YQ_CORE_CHECKS.find(q=>q.id===id)?.label||id)}：${esc(answer.value===null?'未作答':answer.value)}${answer.otherText?` · ${esc(answer.otherText)}`:''}</p>`).join('')}${report.note.included?`<label class="check"><input type="checkbox" data-yq-export-note="${esc(report.reportId)}" checked>匯出這筆回報連結的自由筆記及下次跟進</label><details><summary>預覽將附上的人工文字</summary><pre>${esc(report.note.text)}</pre><p>下次跟進：${esc(report.note.next)}</p></details>`:'<p>沒有可匯出的連結筆記，或該筆記已刪除／有分歧；不附文字。</p>'}</section>`).join('')||'<p>本期沒有結構化回報。</p>'}</article>`).join('')}`:`<p>維持既有 v1 匯出；不包含一般拜訪筆記，亦不把 v2 回報轉成舊文字格式。</p><details><summary>查看完整匯出內容</summary><pre>${esc(JSON.stringify(result,null,2))}</pre></details>`}<label class="check"><input type="checkbox" id="feedback-export-ack">我已核對通路、月份、來源版本與文字範圍，確認下載明文 JSON（不會自動上傳）</label><button type="button" data-feedback-export-download>確認範圍並下載 JSON</button>`;
}
function downloadReviewedMonthlyFeedbackExport() {
  const ctx=monthlyExportPreview;
  const guard=()=>{if(!ctx || !payload || payload.bundle!==ctx.bundle || JSON.stringify(payload.bundle)!==ctx.basis || key!==ctx.key || meta!==ctx.meta || syncEpoch!==ctx.epoch || document.hidden || pendingLock || updateHolding || syncInProgress || !$('monthly-analysis-dialog').open || $('feedback-export-channel').value!==ctx.channel || $('feedback-export-month').value!==ctx.month || ($('feedback-export-format').value==='typed')!==ctx.typed || $('feedback-export-history').checked!==ctx.includeHistory)throw new Error('匯出範圍、資料或工作階段已變，請重新預覽；尚未下載。');};guard();
  if(!$('feedback-export-ack')?.checked)throw new Error('請先核對預覽並勾選確認。');
  const excludedNotes=[...document.querySelectorAll('[data-yq-export-note]')].filter(node=>!node.checked).map(node=>node.dataset.yqExportNote);
  const result=ctx.typed?exportTypedFeedback(payload.bundle,ctx.channel,ctx.month,{appVersion:APP_VERSION,excludedNotes,at:ctx.at}):exportMonthlyFeedback(payload.bundle,ctx.channel,ctx.month,{includeHistory:ctx.includeHistory,legacyOnly:true,at:ctx.at});guard();
  download(JSON.stringify(result,null,2),ctx.typed?`佑全_拜訪回報_${ctx.month}.json`:`pharmacy-monthly-feedback-${ctx.channel}-${ctx.month}.json`,'application/json');
  toast('已產生明文 JSON 下載，請核對實際存好；未修改資料，也未自動上傳。');
}
function downloadMonthlyFeedbackExport() {
  const bundle=payload.bundle,sessionKey=key;
  const result=exportMonthlyFeedback(bundle,$('feedback-export-channel').value,$('feedback-export-month').value,{includeHistory:$('feedback-export-history').checked});
  if(!result.stores.length)throw new Error('此範圍尚無已對應門市的分析；不產生假回報。');
  if(!confirm(`匯出 ${result.channel}／${result.visitMonth}，${result.stores.length} 筆門市分析、${result.stores.reduce((sum,row)=>sum+row.feedback.length,0)} 份回報？\n${result.includeHistory?'包含本期修訂歷史。':'只包含未被接替來源及回報。'}\n這是明文私人JSON，只另存到你選擇的位置；不會自動傳給其他AI。未回報不算零或已執行。`))return;
  if(!payload || payload.bundle!==bundle || key!==sessionKey || document.hidden || pendingLock || updateHolding)throw new Error('匯出期間資料已變更，請重新核對。');
  download(JSON.stringify(result,null,2),`pharmacy-monthly-feedback-${result.channel}-${result.visitMonth}.json`,'application/json');toast('已產生分析回報下載，請核對實際存好；未自動傳送。');
}
$('monthly-analysis-dialog').addEventListener('submit',event=>{if(event.target.id==='monthly-feedback-form')void saveMonthlyFeedback(event);});
$('monthly-analysis-dialog').addEventListener('input',event=>{
  if(!monthlyFeedbackContext || !event.target.matches('#monthly-feedback-date,#monthly-feedback-notes,[data-feedback-answer]'))return;
  const ctx=monthlyFeedbackContext;clearTimeout(ctx.timer);ctx.timer=setTimeout(()=>{void flushMonthlyFeedbackDraft().catch(error=>{if($('monthly-feedback-error'))$('monthly-feedback-error').textContent='草稿保存失敗：'+error.message+'；請保留畫面並重試。';});},350);
});
$('monthly-analysis-dialog').addEventListener('click',event=>{
  if(event.target.closest('[data-feedback-close]'))void run(()=>closeMonthlyFeedback(false),'monthly-feedback-error');
  if(event.target.closest('[data-feedback-discard]'))void run(()=>closeMonthlyFeedback(true),'monthly-feedback-error');
});
$('monthly-analysis-dialog').addEventListener('cancel',event=>{if(monthlyFeedbackContext){event.preventDefault();void run(()=>closeMonthlyFeedback(false),'monthly-feedback-error');}});
