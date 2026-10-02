import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { emptyBundle, revision, project, validateBundle, newMeta, derive, seal, unseal, diffTextSegments } from '../public/core.js';
import { storeIdentityPending, relationVisitAllowed } from '../public/relations.js';
import { SOP1_VERSION } from '../public/csv.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const sop = fs.readFileSync(new URL('../SOP1.md', import.meta.url), 'utf8');

test('phone UI uses one fixed iPhone Pro canvas and prevents page scaling or horizontal drift', () => {
  assert.match(html, /name="viewport" content="width=393, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content"/);
  assert.match(style, /--iphone-pro-canvas-width:393px;--iphone-pro-canvas-height:852px/);
  assert.match(style, /html\{[^}]*width:var\(--iphone-pro-canvas-width\)[^}]*overflow-x:clip[^}]*overscroll-behavior-x:none/);
  assert.match(style, /body\{[^}]*inset-inline-start:0[^}]*overflow-x:clip[^}]*overscroll-behavior-x:none/);
  assert.match(style, /#gate,#workspace,#workspace>main\{[^}]*min-height:var\(--iphone-pro-canvas-height\)/);

  const source = app.slice(app.indexOf('function lockPhoneViewportScale('), app.indexOf('function installPhoneEditingViewport('));
  const listeners = new Map();
  const viewportListeners = new Map(), windowListeners = new Map();
  const scrollingElement = { scrollLeft: 0 }, documentElement = { scrollLeft: 0 }, body = { scrollLeft: 0 };
  const document = { scrollingElement, documentElement, body, addEventListener: (type, handler, options) => listeners.set(type, { handler, options }) };
  let windowScroll = null;
  const window = {
    matchMedia: () => ({ matches: true }), scrollX: 0, scrollY: 222,
    scrollTo: (x, y) => { windowScroll = [x, y]; },
    addEventListener: (type, handler, options) => windowListeners.set(type, { handler, options }),
    visualViewport: { addEventListener: (type, handler, options) => viewportListeners.set(type, { handler, options }) }
  };
  vm.runInNewContext(source, { window, document, requestAnimationFrame: fn => fn() });
  for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'touchmove']) {
    assert.equal(listeners.get(type)?.options?.passive, false, `${type} must be cancellable`);
  }
  assert.equal(listeners.get('touchstart')?.options?.passive, true);
  assert.equal(listeners.get('scroll')?.options?.passive, true);
  assert.equal(viewportListeners.get('scroll')?.options?.passive, true);
  let prevented = 0;
  listeners.get('gesturestart').handler({ preventDefault: () => prevented++ });
  listeners.get('touchmove').handler({ touches: [{}, {}], preventDefault: () => prevented++ });
  listeners.get('touchstart').handler({ touches: [{ clientX: 100, clientY: 100 }], target: { closest: () => null } });
  listeners.get('touchmove').handler({ touches: [{ clientX: 135, clientY: 102 }], preventDefault: () => prevented++ });
  listeners.get('touchmove').handler({ touches: [{ clientX: 102, clientY: 135 }], preventDefault: () => prevented++ });
  listeners.get('touchstart').handler({ touches: [{ clientX: 100, clientY: 100 }], target: { closest: () => ({}) } });
  listeners.get('touchmove').handler({ touches: [{ clientX: 135, clientY: 102 }], preventDefault: () => prevented++ });
  assert.equal(prevented, 3, 'scale and whole-page horizontal drag are blocked; vertical and explicit horizontal scrollers remain available');

  scrollingElement.scrollLeft = 30; documentElement.scrollLeft = 20; body.scrollLeft = 10; window.scrollX = 30;
  listeners.get('scroll').handler();
  assert.equal(scrollingElement.scrollLeft, 0); assert.equal(documentElement.scrollLeft, 0); assert.equal(body.scrollLeft, 0);
  assert.deepEqual(windowScroll, [0, 222]);
});

function editingViewportFixture({ mobile = true, withViewport = true, inDialog = false } = {}) {
  const properties = new Map(), classes = new Set(), listeners = new Map(), viewportListeners = new Map(), windowListeners = new Map();
  const frames = [], scrolls = [], watched = [];
  const geometry = { caret: { top: 530, bottom: 554, height: 24 }, dock: { top: 460, height: 100 }, selection: true };
  const action = { getClientRects: () => [{}], getBoundingClientRect: () => geometry.dock };
  const scroller = { scrollTop: 180, computed: { overflowY: 'auto' }, getBoundingClientRect: () => ({ top: 210, bottom: 588 }) };
  const editor = { closest: selector => selector === '[data-inline-edit-text]' ? editor : selector === '#review-body' && inDialog ? scroller : null, contains: node => node === text };
  const text = { nodeType: 3 };
  const originalRange = { startContainer: text, startOffset: 8, cloneRange: () => ({ startContainer: text, startOffset: 8, collapse() {}, setStart() {}, getBoundingClientRect: () => geometry.caret }) };
  const selection = { rangeCount: 1, focusNode: text, isCollapsed: true, getRangeAt: () => originalRange };
  const scope = { querySelectorAll: () => [action], querySelector: () => null };
  const document = { activeElement: editor, body: {}, documentElement: { style: { setProperty: (key, value) => properties.set(key, value) }, classList: { toggle: (key, value) => value ? classes.add(key) : classes.delete(key) } }, querySelectorAll: selector => selector === 'dialog[open]' ? inDialog ? [scope] : [] : [action], addEventListener: (type, handler) => listeners.set(type, handler) };
  editor.parentElement = inDialog ? scroller : document.body; scroller.parentElement = scope;
  const viewport = { offsetTop: 180, height: 400, addEventListener: (type, handler) => viewportListeners.set(type, handler) };
  const window = { innerHeight: 852, matchMedia: () => ({ matches: mobile }), visualViewport: withViewport ? viewport : undefined, getSelection: () => geometry.selection ? selection : null, scrollBy: value => scrolls.push(value), addEventListener: (type, handler) => windowListeners.set(type, handler) };
  const source = app.slice(app.indexOf('function installPhoneEditingViewport('), app.indexOf('let key ='));
  vm.runInNewContext(source, { document, window, getComputedStyle: element => element.computed || {}, performance: { now: () => 1000 }, requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, ResizeObserver: class { constructor(fn) { this.fn = fn; } observe(target) { watched.push(target); } }, MutationObserver: class { observe() {} } });
  const flush = () => { for (let count = 0; frames.length && count < 10; count++) frames.shift()(); assert.equal(frames.length, 0); };
  return { properties, classes, listeners, viewportListeners, windowListeners, viewport, window, document, geometry, selection, originalRange, scroller, scrolls, watched, flush };
}

test('keyboard viewport follows changing keyboard height and pan, then returns to the full phone canvas', () => {
  const f = editingViewportFixture(); f.flush();
  assert.equal(f.properties.get('--phone-visible-bottom'), '580px');
  assert.equal(f.properties.get('--phone-visible-height'), '400px');
  assert.equal(f.properties.get('--phone-keyboard-inset'), '452px');
  assert.equal(f.classes.has('phone-keyboard-open'), true);
  assert.equal(f.properties.get('--phone-edit-dock-height'), '100px');
  f.viewport.offsetTop = 80; f.viewport.height = 320;
  f.viewportListeners.get('resize')(); f.flush();
  assert.equal(f.properties.get('--phone-visible-bottom'), '400px');
  f.viewport.offsetTop = 0; f.viewport.height = 852;
  f.viewportListeners.get('resize')(); f.flush();
  assert.equal(f.properties.get('--phone-visible-bottom'), '852px');
  assert.equal(f.classes.has('phone-keyboard-open'), false);
  assert.equal(f.properties.get('--phone-keyboard-inset'), '0px');
  assert.equal(f.watched.length, 1, 'do not register duplicate observers on repeated input');
  assert.match(style, /top:calc\(var\(--phone-visible-bottom,100dvh\) - 8px\);gap:6px/);
  assert.match(style, /height:var\(--phone-visible-height,100dvh\)/);
  assert.match(style, /body:not\(\.dialog-scroll-locked\)\{padding-bottom:var\(--phone-keyboard-inset,0px\)/);
});

test('typing keeps only the caret above the dock without rewriting text or selection; modal scroll stays internal', () => {
  const f = editingViewportFixture(); f.flush();
  f.listeners.get('input')(); f.flush();
  assert.equal(f.scrolls[0].top, 106);
  assert.equal(f.originalRange.startOffset, 8);
  f.geometry.caret = { top: 300, bottom: 324, height: 24 };
  f.listeners.get('selectionchange')(); f.flush();
  assert.equal(f.scrolls.length, 1, 'already-visible caret must not move the page');
  f.selection.isCollapsed = false;
  f.geometry.caret = { top: 530, bottom: 554, height: 24 };
  f.listeners.get('selectionchange')(); f.flush();
  assert.equal(f.scrolls.length, 1, 'text selection must not be pulled away while selecting');
  const modal = editingViewportFixture({ inDialog: true }); modal.flush();
  modal.listeners.get('input')(); modal.flush();
  assert.equal(modal.scroller.scrollTop, 286);
  assert.equal(modal.scrolls.length, 0, 'dialog editing must not scroll the locked background');
});

test('desktop viewport is untouched and phone fallback works without the Visual Viewport API', () => {
  const desktop = editingViewportFixture({ mobile: false }); desktop.flush();
  assert.equal(desktop.properties.size, 0); assert.equal(desktop.listeners.size, 0);
  const phone = editingViewportFixture({ withViewport: false }); phone.flush();
  assert.equal(phone.properties.get('--phone-visible-bottom'), '852px');
  assert.equal(phone.classes.has('phone-keyboard-open'), false);
  phone.window.innerHeight = 460;
  phone.windowListeners.get('resize')(); phone.flush();
  assert.equal(phone.properties.get('--phone-visible-height'), '460px');
});

test('a collapsed caret at an element boundary can be measured without inserting markers into the note', () => {
  const f = editingViewportFixture(); f.flush();
  const text = { nodeType: 3, textContent: '虛構末行文字' };
  let measured = false;
  f.originalRange.cloneRange = () => ({
    startContainer: { nodeType: 1, childNodes: [text] }, startOffset: 1,
    collapse() {}, setStart(node, offset) { assert.equal(node, text); assert.equal(offset, 5); measured = true; },
    setEnd(node, offset) { assert.equal(node, text); assert.equal(offset, 6); },
    getBoundingClientRect: () => measured ? f.geometry.caret : { top: 0, bottom: 0, height: 0 }
  });
  f.listeners.get('input')(); f.flush();
  assert.equal(measured, true);
  assert.equal(f.scrolls[0].top, 106);
  assert.equal(text.textContent, '虛構末行文字');
});

test('a new empty line remains visible after Enter without inserting or removing note content', () => {
  const f = editingViewportFixture(); f.flush();
  const lineBreak = { nodeType: 1, tagName: 'BR', getBoundingClientRect: () => f.geometry.caret };
  f.originalRange.cloneRange = () => ({ startContainer: { nodeType: 1, childNodes: [lineBreak] }, startOffset: 0, collapse() {}, getBoundingClientRect: () => ({ height: 0 }) });
  f.listeners.get('input')(); f.flush();
  assert.equal(f.scrolls[0].top, 106);
});

test('mobile-first runtime files are valid JavaScript and expose the daily capture contract', () => {
  for (const file of ['public/app.js', 'public/core.js', 'public/csv.js']) {
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  }
  assert.match(app, /function scheduleVisitDraftSave\(/);
  assert.match(app, /function flushVisitDraft\(/);
  assert.match(app, /function resumeVisitDraft\(/);
  assert.match(app, /draftState\('儲存中…'/);
  assert.match(app, /draftState\('已存於本機/);
  assert.match(app, /draftState\('儲存失敗：/);
  assert.match(app, /await flushVisitDraft\(\)/);
  assert.match(app, /identity.*待確認|身分待確認/);
  assert.match(html, /最近使用的門市/);
  assert.match(html, /手機已保存/);
  assert.match(html, /Mac 已確認收到/);
  assert.match(html, /id="sync-health-card"/);
  assert.match(html, /id="pending-sync-detail"/);
  assert.match(html, /id="health-audit-card"/);
  assert.match(html, /每 7 天|立即重新健檢/);
  assert.match(html, /也不處理跟進提醒/);
  assert.match(app, /function runPeriodicHealthAudit\(/);
  assert.match(app, /lastBackupExport/);
  assert.match(html, /同一筆紀錄連續修改仍只算一項/);
  assert.match(app, /function withPendingSync\(/);
  assert.match(app, /function pendingSyncSummary\(/);
  assert.match(html, /不假設仍會持續同步/);
  assert.match(app, /id="f-store-search"/);
  assert.match(app, /function refreshVisitStoreOptions\(/);
  assert.match(app, /data-new-visit-store=/);
  assert.match(app, /function openVisitForStore\(/);
  assert.match(app, /openVisitBrief\(storeId, \{ capture: true \}\)/);
  assert.match(app, /event\.target\.id === 'f-store-search'/);
  assert.match(app, /async function discardVisitDraft\(/);
  assert.match(app, /function openCandidateDetail\(/);
  assert.match(app, /function openCandidateOverview\(/);
  assert.match(app, /function openVisitBrief\(/);
  assert.match(app, /data-visit-brief=/);
  assert.match(app, /單店拜訪｜/);
  assert.match(app, /只排列你已填寫的欄位、正式拜訪原文與可追溯候選/);
  assert.match(app, /function openQuickTextEdit\(/);
  assert.match(app, /async function saveQuickTextEdit\(/);
  assert.match(app, /contenteditable="\$\{inlineBlocked \? 'false' : 'true'\}"/);
  assert.match(app, /document\.addEventListener\('beforeinput', blockInlineTextBeforeInput\)/);
  assert.match(app, /data-inline-edit-text=/);
  assert.match(app, /function updateInlineText\(/);
  assert.match(app, /修改草稿已加密保存在這台裝置/);
  assert.match(app, /回到修改並儲存/);
  assert.match(app, /data-inline-cancel=/);
  assert.match(app, /data-inline-review=/);
  assert.match(app, /檢查並儲存修改/);
  assert.match(style, /inline-edit-actions:not\(\[hidden\]\)\{position:fixed/);
  assert.match(style, /inline-edit-shell\.locked \.inline-edit-text/);
  assert.match(app, /下次記得：/);
  assert.match(app, /每次必做、必給：/);
  assert.match(app, /id="f-next-remember"/);
  assert.match(app, /id="f-every-time-must"/);
  assert.match(app, /data-store-reminder=/);
  assert.match(app, /填寫門市提醒/);
  assert.match(app, /修改門市提醒/);
  assert.match(app, /function openStoreReminder\(/);
  assert.match(app, /async function saveStoreReminder\(/);
  assert.match(html, /id="store-reminder-dialog"/);
  assert.match(html, /這次不會修改拜訪文字或其他門市資料/);
  assert.match(html, /快速勾選（可複選）/);
  assert.match(html, /data-reminder-option value="HAUD"/);
  assert.match(html, /data-reminder-option value="Complete"/);
  assert.match(html, /data-reminder-option value="陳列盒（中）"/);
  assert.match(html, /data-reminder-option value="陳列盒（小）"/);
  assert.match(html, /data-reminder-custom-input/);
  assert.match(app, /setReminderOption\(before, input\.value, input\.checked\)/);
  assert.match(html, /▤ 拜訪/);
  assert.match(html, /▦ 門市/);
  assert.match(html, /⚙ 資料與安全/);
  assert.match(html, /class="panel management-hub"/);
  assert.match(html, /id="export-store-enrichment"/);
  assert.match(html, /id="import-store-enrichment"/);
  assert.match(html, /id="store-enrichment-file"/);
  assert.match(app, /單店拜訪｜/);
  assert.match(app, /開始記錄這次拜訪/);
  assert.match(app, /function singleStoreCaptureHTML\(/);
  assert.match(app, /id="single-store-capture-form"/);
  assert.match(app, /id="single-store-text"/);
  assert.match(app, /id="single-store-next"/);
  assert.match(app, /更多欄位：日期、來源、人物、主題與附件/);
  assert.match(app, /source \|\| '未指定'/);
  assert.match(app, /form="single-store-capture-form"/);
  assert.match(app, /async function saveSingleStoreVisit\(/);
  assert.match(app, /await flushVisitDraft\(\)/);
  assert.match(app, /dirty: true, draft: null/);
  assert.match(app, /你仍停留在這間門市/);
  assert.match(app, /請先完成或收起這次拜訪紀錄/);
  assert.match(style, /#single-store-text\{[^}]*min-height/);
  assert.match(style, /review-persistent-actions\.capture-active/);
  assert.match(app, /既有拜訪原文.*全部.*筆.*可直接修改/);
  assert.match(app, /不生成或改寫正式拜訪內容/);
  assert.match(html, /id="review-persistent-actions"/);
  assert.match(html, /id="review" tabindex="-1" aria-labelledby="review-title"/);
  assert.match(app, /function lockDialogBackground\(/);
  assert.match(app, /function releaseDialogBackground\(/);
  assert.match(app, /function resetDialogScroll\(/);
  assert.match(app, /document\.querySelectorAll\('dialog'\).*queueMicrotask\(releaseDialogBackground\)/);
  assert.match(style, /body\.dialog-scroll-locked\{position:fixed/);
  assert.match(style, /#review-body\{[^}]*overflow-y:auto[^}]*overscroll-behavior-y:contain/);
  assert.match(style, /#review\.visit-brief-dialog\{[^}]*height:100dvh/);
  const visitBriefSource = app.slice(app.indexOf('function openVisitBrief('), app.indexOf('function canonicalPerson('));
  const visitBriefLayout = visitBriefSource.slice(visitBriefSource.indexOf('reviewBody.innerHTML'));
  assert.doesNotMatch(visitBriefSource, /<h3>\$\{esc\(brief\.store\.name\)\}<\/h3>/);
  assert.ok(visitBriefLayout.indexOf('${reminders}') < visitBriefLayout.indexOf('brief-followups'));
  assert.ok(visitBriefLayout.indexOf('singleStoreCaptureHTML()') < visitBriefLayout.indexOf('brief-followups'));
  assert.ok(visitBriefLayout.indexOf('brief-followups') < visitBriefLayout.indexOf('brief-secondary'));
  assert.ok(visitBriefLayout.indexOf('brief-secondary') < visitBriefLayout.indexOf('brief-history'));
  assert.match(visitBriefSource, /inlineVisitTextHTML\(item\)/);
  assert.match(visitBriefSource, /點一下既有拜訪原文即可直接輸入/);
  assert.match(visitBriefSource, /brief-history.*preserved.*historyOpen.*'open'/s);
  assert.match(visitBriefSource, /review-persistent-actions/);
  assert.match(visitBriefSource, /reviewMode: 'visit-brief'/);
  assert.match(app, /function briefTraceHTML\(/);
  assert.match(app, /展開完整拜訪原文/);
  assert.match(visitBriefSource, /相同內容/);
  assert.match(visitBriefSource, /點選每個候選可核對命中的原句、日期、來源與原文狀態/);
  assert.match(visitBriefSource, /完整歷史永遠保留每一筆/);
  assert.match(visitBriefSource, /這裡不去重，每筆原文、下次跟進與歷史都保留/);
  assert.doesNotMatch(visitBriefSource, /persist\(|commitRevision\(|\brevision\(/);
  assert.doesNotMatch(visitBriefSource, /fetch\(|api\(/);
  assert.match(app, /class="advanced-fields"/);
  assert.match(app, /地址與系統資料/);
  const storeNotesStart = app.indexOf('const storeNotes ='), storeNotesSource = app.slice(storeNotesStart, app.indexOf('const textBlock', storeNotesStart));
  assert.ok(storeNotesSource.indexOf("store.nextRemember ?") < storeNotesSource.indexOf("store.everyTimeMust ?"), 'store reminders render in the requested order');
  assert.match(app, /快速修改不能把整段文字存成空白/);
  assert.match(app, /這次只會修改這一筆拜訪的文字欄/);
  assert.match(app, /diffTextSegments\(ctx\.before, ctx\.after\)/);
  assert.match(app, /修改前被刪除／取代/);
  assert.match(app, /修改後新增／取代/);
  assert.match(app, /系統候選不是已確認事實/);
  assert.match(app, /確認捨棄這份未完成草稿/);
  assert.match(app, /既有門市、正式拜訪或歷史版本/);
  assert.match(html, /id="discard-draft-banner"/);
  assert.match(html, /id="discard-draft"/);
  assert.match(html, /id="quick-text-dialog"/);
  assert.match(app, /確定建立新版本/);
  assert.match(app, /function captureTransientResumeState\(/);
  assert.match(app, /function restoreTransientResumeState\(/);
  assert.match(app, /restoreTransientResumeState\(\); renderBackupResult\(\); await runPeriodicHealthAudit\(\); clearInterval\(autoTimer\)/);
  assert.match(app, /function visitSearchRank\(/);
  assert.match(app, /if \(storeName === q\) return 0;/);
  assert.match(app, /if \(storeName\.includes\(q\)\) return 1;/);
  assert.match(app, /if \(lower\(v\.text\)\.includes\(q\)\) return 2;/);
  assert.match(app, /function highlightLiteral\(/);
  assert.match(app, /<mark class="search-match">/);
  assert.match(app, /highlightLiteral\(name\('store', v\.store\), query\)/);
  assert.match(app, /highlightLiteral\(v\.text, query\)/);
  assert.match(app, /function renderVisitSearchGroup\(/);
  assert.match(app, /group\.matches\.length > 1 \? renderVisitSearchGroup\(group, query\) : noteHTML/);
  assert.match(app, /展開這間藥局全部/);
  assert.match(app, /group\.allVisits\.map\(v => noteHTML\(v, query\)\)/);
  assert.match(app, /筆命中 · 共/);
  assert.match(app, /visitSearch: \$\('visit-search'\)\?\.value/);
  assert.match(app, /scrollTop: document\.scrollingElement\?\.scrollTop/);
  assert.match(app, /\$\('review'\)\.open \|\| \$\('quick-text-dialog'\)\?\.open/);
});

test('reused dialogs reset their own scroll and restore the unchanged page position after close', () => {
  const classes = () => { const values = new Set(); return { add: value => values.add(value), remove: value => values.delete(value), toggle: (value, on) => on ? values.add(value) : values.delete(value), contains: value => values.has(value) }; };
  const reviewBody = { scrollTop: 75 };
  const actions = { hidden: false, replaceChildren() {} };
  const heading = { focus() {} };
  const review = { id: 'review', open: false, scrollTop: 125, classList: classes(), showModal() { this.open = true; }, closest() { return this.open ? this : null; }, querySelector: () => heading };
  const nodes = new Map([['review', review], ['review-body', reviewBody], ['review-persistent-actions', actions], ['workspace', { hidden: false }], ['page-title', heading]]);
  let restored = null;
  const body = { classList: classes(), style: { top: '3px' } };
  const document = { body, documentElement: { classList: classes() }, scrollingElement: { scrollTop: 438 }, querySelector: () => review.open ? review : null, querySelectorAll: () => review.open ? [review] : [] };
  const window = { scrollY: 438, scrollTo: (x, y) => { restored = [x, y]; } };
  const context = vm.createContext({ document, window, requestAnimationFrame: fn => fn(), $: id => nodes.get(id) });
  vm.runInContext(app.slice(app.indexOf('let dialogScrollLock = null;'), app.indexOf('function buttons(')), context);
  context.openDialog(review, { reviewMode: 'visit-brief' });
  assert.equal(review.scrollTop, 0); assert.equal(reviewBody.scrollTop, 0);
  assert.equal(document.body.style.top, '-438px'); assert.equal(document.body.classList.contains('dialog-scroll-locked'), true);
  review.open = false; context.releaseDialogBackground();
  assert.equal(document.body.style.top, '3px'); assert.deepEqual(restored, [0, 438]);
  assert.equal(document.body.classList.contains('dialog-scroll-locked'), false);
});

test('a queued close from the previous review cannot clear an immediately reopened single-store page', () => {
  let closedHandler, cleared = 0, replaced = 0;
  const review = { open: false, dataset: { singleStoreId: 'previous-store' }, classList: { toggle() {} }, addEventListener(event, handler) { assert.equal(event, 'close'); closedHandler = handler; } };
  const actions = { hidden: false, replaceChildren() { replaced++; } };
  const context = vm.createContext({ $: id => id === 'review' ? review : id === 'review-persistent-actions' ? actions : null, singleStoreContext: null, clearBriefSearch() { cleared++; } });
  const listener = app.split('\n').find(line => line.startsWith("$('review').addEventListener('close',") && line.includes('setReviewMode'));
  assert.ok(listener, 'Exercise the actual registered review lifecycle listener');
  vm.runInContext(app.slice(app.indexOf('function setReviewMode('), app.indexOf('function openDialog(')) + listener, context);
  // Native dialog close is queued: a new page can already be open when it arrives.
  review.open = true; review.dataset.singleStoreId = 'new-store';
  const newContext = { storeId: 'new-store', id: 'unsaved-new-visit' }; context.singleStoreContext = newContext;
  closedHandler();
  assert.equal(cleared, 0); assert.equal(replaced, 0); assert.equal(actions.hidden, false);
  assert.equal(review.dataset.singleStoreId, 'new-store'); assert.equal(context.singleStoreContext, newContext);
  review.open = false; closedHandler();
  assert.equal(cleared, 1); assert.equal(replaced, 1); assert.equal(actions.hidden, true);
  assert.equal(review.dataset.singleStoreId, undefined); assert.equal(context.singleStoreContext, null);
});

test('a local draft survives encryption without creating a formal visit revision', async () => {
  const bundle = emptyBundle('mobile-first-test');
  bundle.ops.push(revision('store', 'pending-store', {
    name: '虛構待確認藥局', city: '', district: '', channel: '', attr: '', contact: '',
    address: '', mapUrl: '', csvIdentityPending: true
  }, [], 'phone'));
  validateBundle(bundle);
  const before = project(bundle);
  assert.equal(before.filter(r => r.type === 'visit').length, 0);
  assert.equal(storeIdentityPending(before.find(r => r.type === 'store')), true);

  const draft = {
    format: 'visit-draft-1', savedAt: '2026-09-21T01:00:00.000Z', id: 'draft-visit', parents: [], baseData: null,
    fields: { store: 'pending-store', date: '2026-09-21', source: '現場觀察', text: '未完成草稿', next: '', topics: [], people: [], keepAttachments: [], newStoreName: '', newStoreDistrict: '', newStoreMapUrl: '', newStorePending: true }
  };
  const payload = { schema: 1, device: 'phone', deviceName: '測試 iPhone', token: null, bundle, dirty: false, serverVersion: 6, lastSync: null, draft };
  const meta = newMeta(), key = await derive('mobile-first-test-password', meta);
  const restored = await unseal(await seal(payload, key, meta, 'device'), key, 'device');
  assert.deepEqual(restored.draft, draft);
  assert.equal(project(restored.bundle).filter(r => r.type === 'visit').length, 0);

  const beforeDiscardBundle = structuredClone(restored.bundle);
  const discardedPayload = await unseal(await seal({ ...restored, draft: null }, key, meta, 'device'), key, 'device');
  assert.equal(discardedPayload.draft, null);
  assert.deepEqual(discardedPayload.bundle, beforeDiscardBundle);
  assert.equal(discardedPayload.dirty, restored.dirty);
  assert.equal(project(discardedPayload.bundle).filter(r => r.type === 'visit').length, 0);

  restored.bundle.ops.push(revision('visit', draft.id, {
    store: 'pending-store', date: draft.fields.date, source: draft.fields.source, text: draft.fields.text,
    next: '', topics: [], people: [], attachments: []
  }, [], 'phone'));
  validateBundle(restored.bundle);
  const records = project(restored.bundle), visit = records.find(r => r.type === 'visit');
  assert.equal(records.filter(r => r.type === 'visit').length, 1);
  assert.equal(relationVisitAllowed(visit, records.filter(r => r.type === 'store')), false);
});

test('single-store quick capture creates exactly one formal visit only on submit and stays on the same store', async () => {
  const bundle = emptyBundle('single-store-capture-test');
  const storeData = { name: '虛構單店藥局', city: '臺北市', district: '測試區', channel: '', attr: '', contact: '', address: '', mapUrl: '', csvIdentityPending: false };
  bundle.ops.push(revision('store', 'store-one', storeData, [], 'phone'));
  bundle.ops.push(revision('topic', 'topic-one', { name: '虛構主題', desc: '' }, [], 'phone'));
  bundle.ops.push(revision('person', 'person-one', { name: '虛構藥師', role: '', desc: '', confirmed: false, sameAs: '' }, [], 'phone'));
  validateBundle(bundle);
  assert.equal(project(bundle).filter(record=>record.type==='visit').length,0);

  const nodes = new Map([
    ['review',{open:true,dataset:{singleStoreId:'store-one'}}],
    ['single-store-text',{value:'逐字保存的本次拜訪原文'}],
    ['single-store-date',{value:'2026-09-28'}],
    ['single-store-source',{value:'現場觀察'}],
    ['single-store-next',{value:'下次帶資料'}],
    ['single-store-files',{files:[]}]
  ]);
  const stores = project(bundle).filter(record=>record.type==='store');
  let persisted = null, reopened = '', message = '';
  const context = vm.createContext({
    singleStoreContext:{storeId:'store-one',id:'visit-one',parents:[],draftTouched:true}, payload:{bundle,device:'phone',draft:{format:'visit-draft-1'}}, draftTimer:null,
    $:id=>nodes.get(id), document:{querySelectorAll:selector=>selector.includes('single-topic')?[{value:'topic-one'}]:selector.includes('single-person')?[{value:'person-one'}]:[]},
    by:(type,id)=>type==='store'?stores.find(store=>store.id===id):null, storeIdentityPending, flushVisitDraft:async()=>{},
    hashBytes:async()=>'', b64:()=>'', revision, validateBundle, project, structuredClone, Uint8Array, clearTimeout,
    confirmStoreSave:async()=>({}),quickTextParents:record=>record.heads.map(head=>head.id).sort(),
    persist:async next=>{persisted=structuredClone(next);context.payload=next;}, render:()=>{}, openVisitBrief:id=>{reopened=id;}, toast:value=>{message=value;},
    run:async fn=>fn()
  });
  const captureSource=app.slice(app.indexOf('function captureVisitDraft('),app.indexOf('function applyVisitDraft('));
  vm.runInContext(app.slice(app.indexOf('function assertSaveParents('),app.indexOf('function finishAttendancePrompt(')),context);
  vm.runInContext(captureSource,context);
  const pending=context.captureVisitDraft();
  assert.equal(pending.format,'visit-draft-1');assert.equal(pending.baseData,null);assert.equal(pending.fields.store,'store-one');
  assert.equal(pending.fields.text,'逐字保存的本次拜訪原文');assert.equal(pending.fields.next,'下次帶資料');
  context.payload.draft=pending;
  assert.equal(project(context.payload.bundle).filter(record=>record.type==='visit').length,0);

  const source=app.slice(app.indexOf('async function saveSingleStoreVisit('),app.indexOf('function openVisitBrief('));
  vm.runInContext(source,context);
  let prevented=false;await context.saveSingleStoreVisit({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(persisted.draft,null);assert.equal(persisted.dirty,true);
  const visit=project(persisted.bundle).find(record=>record.type==='visit');
  assert.equal(visit.store,'store-one');assert.equal(visit.text,'逐字保存的本次拜訪原文');assert.equal(visit.next,'下次帶資料');
  assert.deepEqual(visit.topics,['topic-one']);assert.deepEqual(visit.people,['person-one']);assert.deepEqual(visit.attachments,[]);
  assert.equal(project(persisted.bundle).filter(record=>record.type==='visit').length,1);
  assert.equal(reopened,'store-one');assert.match(message,/仍停留在這間門市/);assert.equal(context.singleStoreContext,null);
});

test('quick text confirmation highlights only changed portions without changing either input', () => {
  const before = '- 第一行維持不變\n- 原本是玻尿酸\n- 最後一行';
  const after = '- 第一行維持不變\n- 原本是單支裝\n- 新增追問\n- 最後一行';
  const diff = diffTextSegments(before, after);
  assert.equal(diff.before.map(x => x.text).join(''), before);
  assert.equal(diff.after.map(x => x.text).join(''), after);
  assert.ok(diff.before.some(x => x.kind === 'removed' && x.text.includes('玻尿酸')));
  assert.ok(diff.after.some(x => x.kind === 'added' && x.text.includes('單支裝')));
  assert.ok(diff.after.some(x => x.kind === 'added' && x.text.includes('新增追問')));
  assert.ok(diff.before.some(x => x.kind === 'same' && x.text.includes('第一行維持不變')));
});

test('single-store history renders each formal visit as the same safe inline editor', () => {
  const visit = { id: 'visit-brief', text: '既有正式原文', conflict: false };
  const original = structuredClone(visit);
  const context = vm.createContext({
    payload: { draft: null, inlineTextDraft: null }, inlineTextContext: null,
    inlineTextBlockReason: () => '', pendingInlineTextId: () => '',
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    highlightLiteral: value => String(value)
  });
  vm.runInContext(app.slice(app.indexOf('function inlineVisitTextHTML('), app.indexOf('function noteHTML(')), context);
  let rendered = context.inlineVisitTextHTML(visit);
  assert.match(rendered, /contenteditable="true"/);
  assert.match(rendered, /data-inline-edit-text="visit-brief"/);
  assert.match(rendered, /data-inline-review="visit-brief"/);
  assert.match(rendered, /inline-edit-actions" hidden/);

  context.payload.inlineTextDraft = { format: 'inline-text-draft-1', id: 'visit-brief', before: '既有正式原文', after: '尚未確認的修改', parents: ['head-1'] };
  rendered = context.inlineVisitTextHTML(visit);
  assert.match(rendered, /尚未確認的修改/);
  assert.doesNotMatch(rendered, /inline-edit-actions" hidden/);
  assert.match(rendered, /檢查並儲存修改/);

  context.payload.inlineTextDraft = null; context.inlineTextBlockReason = () => '目前有未完成內容';
  rendered = context.inlineVisitTextHTML(visit);
  assert.match(rendered, /contenteditable="false"/);
  assert.match(rendered, /目前有未完成內容/);
  assert.deepEqual(visit, original, 'rendering must not mutate the formal visit');
});

test('inline text draft is encrypted locally without creating a formal revision', async () => {
  const bundle = emptyBundle('inline-text-draft-test');
  const store = revision('store', 'store-inline', { name: '虛構行內測試門市', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'phone');
  const visit = revision('visit', 'visit-inline', { store: 'store-inline', date: '2026-09-27', source: '現場觀察', text: '正式原文', next: '', topics: [], people: [], attachments: [] }, [], 'phone');
  bundle.ops.push(store, visit);
  const inlineTextDraft = { format: 'inline-text-draft-1', id: 'visit-inline', before: '正式原文', after: '正式原文加上草稿', parents: [visit.id], updatedAt: '2026-09-27T01:00:00.000Z' };
  const payload = { schema: 1, device: 'phone', deviceName: '測試 iPhone', token: null, bundle, dirty: false, serverVersion: 1, lastSync: null, inlineTextDraft };
  const meta = newMeta(), key = await derive('inline-text-draft-password', meta);
  const restored = await unseal(await seal(payload, key, meta, 'device'), key, 'device');
  assert.deepEqual(restored.inlineTextDraft, inlineTextDraft);
  assert.equal(restored.bundle.ops.length, 2);
  assert.equal(project(restored.bundle).find(record => record.type === 'visit').text, '正式原文');
});

test('blocked inline editing cannot create unsavable visible text and can return to the active draft without rerendering it', () => {
  const visits = new Map([
    ['visit-a', { id: 'visit-a', store: 'store-a', text: '正式原文 A', deleted: false, conflict: false, heads: [{ id: 'head-a' }] }],
    ['visit-b', { id: 'visit-b', store: 'store-b', text: '正式原文 B', deleted: false, conflict: false, heads: [{ id: 'head-b' }] }]
  ]);
  let message = '', prevented = false, blurred = false, switched = 0, scrolled = false, focused = false, resumedVisit = 0, readingTarget = null;
  const activeElement = {
    dataset: { inlineEditText: 'visit-a' }, innerText: '畫面上不該殘留的文字', textContent: '',
    closest(selector) { return selector === '[data-inline-edit-text]' ? this : null; },
    blur() { blurred = true; }, scrollIntoView() { scrolled = true; }, focus() { focused = true; }
  };
  const context = vm.createContext({
    inlineTextContext: null, inlineDraftTimer: null, inlineDraftSaveChain: Promise.resolve(), activeView: 'visits', singleStoreContext: null,
    payload: { draft: { format: 'visit-draft-1' }, inlineTextDraft: null },
    by: (type, id) => type === 'visit' ? visits.get(id) : null,
    toast: value => { message = value; },
    document: { querySelector: () => activeElement }, CSS: { escape: value => value },
    switchView: () => { switched++; }, renderVisits() {}, name: () => '虛構門市', focusReadingSurface: target => { readingTarget = target; },
    $: id => id === 'visit-list' ? { querySelector: () => activeElement } : { value: '' }, queueMicrotask: fn => fn(), resumeVisitDraft: () => { resumedVisit++; },
    clearTimeout, setTimeout
  });
  const source = app.slice(app.indexOf('function quickTextParents('), app.indexOf('async function cancelInlineTextEdit('));
  vm.runInContext(source, context);

  const blockedEvent = { target: activeElement, preventDefault() { prevented = true; } };
  assert.equal(context.blockInlineTextBeforeInput(blockedEvent), true);
  assert.equal(prevented, true); assert.equal(blurred, true); assert.match(message, /未完成的拜訪草稿/);
  context.updateInlineText('visit-a', activeElement);
  assert.equal(activeElement.textContent, '正式原文 A', 'input fallback restores the formal text instead of leaving an unsavable visual edit');

  context.payload = { draft: null, inlineTextDraft: { format: 'inline-text-draft-1', id: 'visit-b', before: '正式原文 B', after: '草稿 B', parents: ['head-b'] } };
  prevented = false; blurred = false;
  assert.equal(context.blockInlineTextBeforeInput(blockedEvent), true);
  assert.equal(prevented, true); assert.match(message, /另一筆拜訪/);
  const sameDraftElement = { ...activeElement, dataset: { inlineEditText: 'visit-b' }, closest() { return this; } };
  assert.equal(context.blockInlineTextBeforeInput({ target: sameDraftElement, preventDefault() { throw new Error('same draft must remain editable'); } }), false);

  context.payload = { draft: null, inlineTextDraft: null };
  context.inlineTextContext = { id: 'visit-a', before: '正式原文 A', after: '尚未完成 A' };
  context.resumeInlineTextDraft();
  assert.equal(switched, 0, 'active in-memory text must not be destroyed by a rerender');
  assert.equal(scrolled, true); assert.equal(focused, false, 'resume must leave the software keyboard closed');
  assert.equal(readingTarget, activeElement, 'resume hands off the unchanged draft element to reading-focus navigation');
  assert.equal(context.inlineTextContext.after, '尚未完成 A');

  context.activeView = 'stores'; switched = 0;
  context.resumeInlineTextDraft();
  assert.equal(switched, 1, 'returning from another page must show the visits page before locating the draft');
  assert.equal(readingTarget, activeElement); assert.equal(focused, false);

  context.payload.draft = { format: 'visit-draft-1' };
  context.resumeInlineTextDraft();
  assert.equal(resumedVisit, 1, 'when two legacy drafts coexist, the visit draft is resumed first without discarding either draft');
});

test('quick text edit creates one new visit revision and preserves every non-text field and the original version', () => {
  const bundle = emptyBundle('quick-edit-test');
  bundle.ops.push(revision('store', 'store-1', {
    name: '虛構測試藥局', city: '台北市', district: '測試區', channel: '直營', attr: '', contact: '',
    address: '測試路 1 號', mapUrl: '', csvIdentityPending: false
  }, [], 'phone'));
  const attachmentBlob = 'a'.repeat(64), sourceBlob = 'b'.repeat(64);
  bundle.blobs[attachmentBlob] = 'AA=='; bundle.blobs[sourceBlob] = 'AQ==';
  const original = {
    store: 'store-1', date: '2026-09-22', source: 'Google Maps CSV 匯入', text: '修改前原文',
    next: '下次帶資料', topics: ['topic-x'], people: ['person-y'], attachments: [{ blob: attachmentBlob, name: 'a.pdf', mime: 'application/pdf' }],
    googleText: 'Google 最初原文', googleUpdatePending: false, sourceMissing: false,
    csvSources: [{ file: 'private.csv', line: 12, batch: 'batch-1', list: '測試', headers: ['note'], cells: ['修改前原文'], blob: sourceBlob, fingerprint: 'fp', at: '2026-09-22T00:00:00.000Z' }]
  };
  bundle.ops.push(revision('visit', 'visit-1', original, [], 'phone'));
  const before = project(bundle).find(r => r.type === 'visit');
  const beforeHead = before.heads[0];
  const edited = structuredClone(beforeHead.data);
  edited.text = '修改後原文';
  bundle.ops.push(revision('visit', 'visit-1', edited, [beforeHead.id], 'phone'));
  validateBundle(bundle);

  const after = project(bundle).find(r => r.type === 'visit');
  assert.equal(after.text, '修改後原文');
  assert.equal(after.versions.length, 2);
  for (const field of ['store', 'date', 'source', 'next', 'googleText', 'googleUpdatePending', 'sourceMissing']) {
    assert.deepEqual(after[field], original[field], field);
  }
  assert.deepEqual(after.topics, original.topics);
  assert.deepEqual(after.people, original.people);
  assert.deepEqual(after.attachments, original.attachments);
  assert.deepEqual(after.csvSources, original.csvSources);
  assert.equal(bundle.ops.find(op => op.id === beforeHead.id).data.text, '修改前原文');
});

test('successful single-store inline save clears edit state and refreshes the same page without a second prompt', async () => {
  const bundle = emptyBundle('inline-save-state-test');
  bundle.ops.push(revision('store', 'store-1', { name: '虛構測試門市', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'phone'));
  const original = revision('visit', 'visit-1', { store: 'store-1', date: '2026-09-30', source: '現場觀察', text: '修改前原文', next: '', topics: [], people: [], attachments: [] }, [], 'phone');
  bundle.ops.push(original);
  let closed = false, rendered = false, message = '', refreshed = null;
  const context = vm.createContext({
    payload: { schema: 1, device: 'phone', bundle, dirty: false, inlineTextDraft: { format: 'inline-text-draft-1', id: 'visit-1', before: '修改前原文', after: '修改後原文', parents: [original.id] } },
    quickTextContext: { id: 'visit-1', before: '修改前原文', after: '修改後原文', parents: [original.id], step: 'confirm', briefStoreId: 'store-1' },
    inlineTextContext: { id: 'visit-1', before: '修改前原文', after: '修改後原文', parents: [original.id], briefStoreId: 'store-1' },
    structuredClone, revision, validateBundle, project, confirmStoreSave:async()=>({}),name:()=> '虛構測試門市',
    quickTextParents: record => record.heads.map(head => head.id).sort(),
    by: (type, id) => project(context.payload.bundle).find(record => record.type === type && record.id === id),
    persist: async next => { context.payload = next; },
    render: () => {
      rendered = true;
      assert.equal(context.quickTextContext, null, 'confirmation state must be cleared before cards rerender');
      assert.equal(context.inlineTextContext, null, 'inline draft state must be cleared before cards rerender');
      assert.equal(context.payload.inlineTextDraft, null, 'encrypted draft must be cleared after the formal revision is saved');
    },
    $: id => id === 'quick-text-dialog' ? { close() { closed = true; } } : id === 'review' ? { open: true, dataset: { singleStoreId: 'store-1' } } : null,
    openVisitBrief: (storeId, options) => { refreshed = [storeId, options]; },
    toast: value => { message = value; },
    run: async fn => fn()
  });
  vm.runInContext(app.slice(app.indexOf('function assertSaveParents('),app.indexOf('function finishAttendancePrompt(')),context);
  vm.runInContext(app.slice(app.indexOf('async function saveQuickTextEdit('), app.indexOf('async function commitRevision(')), context);
  let prevented = false;
  await context.saveQuickTextEdit({ preventDefault() { prevented = true; } });
  const saved = project(context.payload.bundle).find(record => record.type === 'visit');
  assert.equal(prevented, true); assert.equal(rendered, true); assert.equal(closed, true);
  assert.equal(saved.text, '修改後原文'); assert.equal(saved.versions.length, 2);
  assert.equal(refreshed[0], 'store-1'); assert.equal(refreshed[1].preservePosition, true);
  assert.match(message, /已建立為同一筆拜訪的新版本/);
});

test('SOP1 explicitly separates App daily notes from Google CSV imports and keeps retention undecided', () => {
  assert.equal(SOP1_VERSION, '1.2.16');
  assert.match(sop, /流程版本：1\.2\.37/);
  assert.match(sop, /393 × 852 CSS 像素/);
  assert.match(sop, /固定手機畫布不等於鍵盤開啟時的可見高度/);
  assert.match(sop, /長原文末行游標也須可見/);
  assert.match(sop, /不得冒充 iPhone 原生或第三方鍵盤驗收/);
  assert.match(sop, /水平位移必須固定為 0/);
  assert.match(sop, /不得修改任何客戶資料、正式版本、同步內容或備份/);
  assert.match(sop, /既有拜訪原文區預設展開/);
  assert.match(sop, /完成或取消後須留在同一個單店頁面/);
  assert.match(sop, /先清除該筆草稿與編輯狀態再重繪/);
  assert.match(sop, /定位成功時.*最多 4 間門市/);
  assert.match(sop, /桌機與定位失敗時的最近使用備用清單維持最多 3 間/);
  assert.match(sop, /### A\. App 日常記錄/);
  assert.match(sop, /### B\. Google CSV 外部資料匯入/);
  assert.match(sop, /### C\. 同步與備份/);
  assert.match(sop, /草稿保存與「完成紀錄」分開/);
  assert.match(sop, /不得宣稱絕對零遺失/);
  assert.match(sop, /捨棄草稿/);
  assert.match(sop, /不得刪除或修改任何既有門市、正式拜訪、revision/);
  assert.match(sop, /拜訪前的記憶提示/);
  assert.match(sop, /候選不能冒充已確認需求/);
  assert.match(sop, /時間比較只使用明確的拜訪日期欄位/);
  assert.match(sop, /可直接定位游標的行內編輯區/);
  assert.match(sop, /單純點擊或移動游標不寫入資料/);
  assert.match(sop, /同一時間只允許一筆行內文字草稿/);
  assert.match(sop, /下次記得.*每次必做、必給/);
  assert.match(sop, /每張拜訪紀錄卡的門市名稱正下方/);
  assert.match(sop, /沒有內容時仍顯示填寫入口/);
  assert.match(sop, /快捷視窗僅修改下次記得（含任務與轉換來源）及每次必做、必給/);
  assert.match(sop, /更新、解鎖或顯示清單不得自動轉換/);
  assert.match(sop, /安全衝突合併預覽將.*列為保護欄位/);
  assert.match(sop, /HAUD.*Complete.*陳列盒（中）.*陳列盒（小）/);
  assert.match(sop, /取消只移除完全相同的獨立項目/);
  assert.match(sop, /不得由 CSV、關聯候選、AI 或系統規則推論或自動填寫/);
  assert.match(sop, /v1\.5\.40 更新器的固定白名單驗證/);
  assert.match(sop, /不能任意新增、刪除或改名/);
  assert.match(sop, /保留原程式與全部資料/);
  assert.match(sop, /拜訪、門市、資料與安全/);
  assert.match(sop, /不得建立摘要 revision 或回寫任何 entity/);
  assert.match(sop, /不得以介面重整、自動化、匯入或同步繞過/);
  assert.match(sop, /唯讀詞彙主檔/);
  assert.match(sop, /不得展開、替換或寫回拜訪原文/);
  assert.match(sop, /CME.*C.*P2.*P.*TNF32.*TN/);
  assert.match(sop, /「單店拜訪」把同一門市/);
  assert.match(sop, /資訊來源不得猜填/);
  assert.match(sop, /沿用 `visit-draft-1` 本機加密草稿/);
  assert.match(sop, /完成後仍停留在同一門市/);
  assert.match(sop, /門市地址批次補全/);
  assert.match(sop, /只補空白的 address、city、district/);
  assert.match(sop, /不得加入 GitHub、release 或測試資料/);
  assert.match(sop, /二次確認頁必須以明顯 highlight 標示/);
  assert.match(sop, /非關閉式 App 切換/);
  assert.match(sop, /不得把使用者硬切回「拜訪紀錄」/);
  assert.match(sop, /導覽狀態只保存在記憶體/);
  assert.match(sop, /若 App 真正被關閉、iOS 終止前端程序、重新載入或程式更新，則不保證恢復一般導覽頁/);
  assert.match(sop, /門市名稱命中優先/);
  assert.match(sop, /完整店名符合優先於店名局部符合/);
  assert.match(sop, /逐字符合的實際文字片段.*highlight/);
  assert.match(sop, /不得把模糊／語意相關結果冒充為逐字符合/);
  assert.match(sop, /兩筆以上命中的拜訪紀錄/);
  assert.match(sop, /全部目前有效的拜訪紀錄/);
  assert.match(sop, /此分組僅是顯示層去重/);
  assert.match(sop, /行內修改不得把整段文字存成空白/);
  assert.match(sop, /門市、日期、來源、主題、人物、附件、Google 原始文字與 Source Snapshot 都不得因行內修改而改變/);
  assert.match(sop, /原文區必須實際設為不可編輯/);
  assert.match(sop, /不得容許文字只在畫面改變卻沒有草稿或儲存路徑/);
  assert.match(sop, /「檢查並儲存修改」必須固定在可視安全區/);
  assert.match(sop, /目前程式保留最近 30 份 Mac 自動快照/);
  assert.match(sop, /未經使用者裁定不得自行更改/);
  assert.match(sop, /每次開啟單店「拜訪前重點」都從內容頂端開始/);
  assert.match(sop, /固定背景頁面並由視窗內容區自行捲動/);
  assert.match(sop, /底部安全區固定「開始記錄這次拜訪」/);
  assert.match(sop, /不得建立摘要、主題、提醒、門市、拜訪或其他 revision/);
  assert.match(sop, /不得呼叫外部 AI、分析服務或遙測/);
  assert.match(sop, /比較時僅正規化 Unicode 全半形、英文字母大小寫、換行及多餘空白/);
  assert.match(sop, /完整歷史一律不去重/);
  assert.match(sop, /不建立文字摘要、不進行語意相似推論/);
});
