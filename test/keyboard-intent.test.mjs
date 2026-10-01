import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const helpers = app.slice(app.indexOf('function dismissKeyboard('), app.indexOf('function lockDialogBackground('));
const classes = () => ({ add() {}, remove() {}, toggle() {} });

function fixture() {
  const events = [], tasks = [], nodes = new Map(), dialogs = [];
  const document = {
    activeElement: null, body: { classList: classes(), style: { top: '' } }, documentElement: { classList: classes() },
    scrollingElement: { scrollTop: 144 }, querySelectorAll: () => dialogs.filter(d => d.open),
    querySelector: () => dialogs.find(d => d.open) || null
  };
  function neutral(id) {
    const node = { id, matches: () => false, closest: () => null, focus(options) { events.push(['focus', id, options.preventScroll]); document.activeElement = node; } };
    nodes.set(id, node); return node;
  }
  function editable(id, contenteditable = false) {
    const node = { id, value: '虛構草稿', innerText: '虛構原文追加', selectionStart: 3, selectionEnd: 5,
      isContentEditable: contenteditable, matches: () => !contenteditable, closest: () => null,
      blur() { events.push(['blur', id]); document.activeElement = null; },
      focus() { events.push(['edit', id]); document.activeElement = node; }
    };
    return node;
  }
  function dialog(id) {
    const heading = neutral(id + '-title');
    const node = { id, open: false, scrollTop: 88, classList: classes(),
      closest: () => node.open ? node : null, querySelector: () => heading,
      showModal() { this.returnTarget = document.activeElement; events.push(['show', id]); this.open = true; heading.focus({ preventScroll: true }); },
      close() { this.open = false; this.returnTarget?.focus({ preventScroll: true }); }
    };
    heading.closest = () => node.open ? node : null;
    dialogs.push(node); nodes.set(id, node); return node;
  }
  nodes.set('workspace', { hidden: false }); neutral('gate-title'); neutral('page-title');
  const context = vm.createContext({ document, $: id => nodes.get(id), queueMicrotask: fn => tasks.push(fn),
    window: { scrollY: 144, scrollTo() {} }, requestAnimationFrame: fn => tasks.push(fn) });
  vm.runInContext(helpers, context);
  return { context, document, nodes, dialogs, events, tasks, neutral, editable, dialog, flush() { while (tasks.length) tasks.shift()(); } };
}

test('keyboard dismissal only blurs input or editable focus without touching content, selection or drafts', () => {
  const f = fixture();
  for (const contenteditable of [false, true]) {
    const field = f.editable('text', contenteditable), before = JSON.stringify(field);
    f.document.activeElement = field;
    f.context.dismissKeyboard();
    assert.equal(f.document.activeElement, null);
    assert.equal(JSON.stringify(field), before);
  }
  const button = f.neutral('action'); button.blur = () => assert.fail('non-editable focus must remain available to keyboard users');
  f.document.activeElement = button; f.context.dismissKeyboard();
  assert.equal(f.document.activeElement, button);
  f.document.activeElement = null; assert.doesNotThrow(() => f.context.dismissKeyboard());
  assert.deepEqual(f.events, [['blur', 'text'], ['blur', 'text']]);
});

test('reading focus uses explicit or active parent dialog and preventScroll, with safe gate/page fallback', () => {
  const f = fixture(), parent = f.dialog('parent'), laterInDOM = f.dialog('other');
  parent.open = laterInDOM.open = true;
  const field = f.editable('inside'); field.closest = () => parent; f.document.activeElement = field;
  f.context.focusReadingSurface();
  assert.equal(f.document.activeElement, f.nodes.get('parent-title'), 'active modal wins over DOM order');
  f.context.focusReadingSurface(laterInDOM);
  assert.equal(f.document.activeElement, f.nodes.get('other-title'));
  parent.open = laterInDOM.open = false; f.document.activeElement = null;
  f.context.focusReadingSurface(); assert.equal(f.document.activeElement, f.nodes.get('page-title'));
  f.nodes.get('workspace').hidden = true; f.context.focusReadingSurface();
  assert.equal(f.document.activeElement, f.nodes.get('gate-title'));
  assert.ok(f.events.filter(([kind]) => kind === 'focus').every(([, , preventScroll]) => preventScroll));
});

test('opening nested dialogs records a non-editable return target before native showModal', () => {
  const f = fixture(), parent = f.dialog('parent'), child = f.dialog('child'); parent.open = true;
  const field = f.editable('parent-input'); field.closest = () => parent; f.document.activeElement = field;
  vm.runInContext('let dialogScrollLock = null;\n' + app.slice(app.indexOf('function lockDialogBackground('), app.indexOf('function buttons(')), f.context);
  f.context.openDialog(child); f.flush();
  assert.equal(child.returnTarget, f.nodes.get('parent-title'));
  assert.equal(f.document.activeElement, f.nodes.get('child-title'));
  assert.equal(child.scrollTop, 0);
  child.close();
  assert.equal(f.document.activeElement, f.nodes.get('parent-title'));
  assert.equal(field.value, '虛構草稿');
  assert.ok(!f.events.some(([kind]) => kind === 'edit'));
});

test('each native modal initially focuses its reading heading, never an editable field', () => {
  const dialogs = [...html.matchAll(/<dialog\b[^>]*>([\s\S]*?)<\/dialog>/g)];
  assert.ok(dialogs.length >= 6);
  for (const [, body] of dialogs) {
    const autofocused = [...body.matchAll(/<([\w-]+)\b([^>]*\bautofocus\b[^>]*)>/g)];
    assert.equal(autofocused.length, 1);
    assert.equal(autofocused[0][1], 'h2');
    assert.match(autofocused[0][2], /data-dialog-focus/);
    assert.match(autofocused[0][2], /tabindex="-1"/);
  }
  assert.doesNotMatch(html, /<(?:input|textarea)\b[^>]*\bautofocus\b/);
  assert.match(html, /id="page-title" tabindex="-1"/);
  assert.match(html, /id="gate-title" tabindex="-1"/);
});

test('invalid fields retain native constraints, show the first error once and never focus text', () => {
  const f = fixture(), error = { textContent: '' }, form = { querySelector: () => error };
  const details = { tagName: 'DETAILS', open: false, parentElement: form };
  let prevented = 0;
  const fields = ['第一個必填', '第二個必填'].map(message => ({
    form, required: true, value: '', validationMessage: message, parentElement: details,
    scrollIntoView(options) { f.events.push(['scroll', message, options.block]); },
    focus() { assert.fail('invalid submission must not open the keyboard'); }
  }));
  f.document.activeElement = f.editable('unfilled');
  for (const target of fields) f.context.showValidationWithoutKeyboard({ target, preventDefault() { prevented++; } });
  assert.equal(prevented, 2, 'every invalid default action must be canceled, including subsequent fields');
  assert.match(error.textContent, /第一個必填/);
  assert.equal(details.open, true);
  assert.equal(f.events.filter(([kind]) => kind === 'scroll').length, 1);
  assert.ok(fields.every(field => field.required && field.value === ''));
  f.flush(); f.context.showValidationWithoutKeyboard({ target: fields[1], preventDefault() {} });
  assert.match(error.textContent, /第二個必填/, 'a later submission may display its own first invalid field');
  assert.match(app, /addEventListener\('invalid', showValidationWithoutKeyboard, true\)/);
  assert.doesNotMatch(html, /\bnovalidate\b/);
});

test('Mac administration invalid and lifecycle handlers only manage focus/error, never submit a rebuild', () => {
  const source = fs.readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
  const docListeners = new Map(), winListeners = new Map(), tasks = [], error = { textContent: '' };
  let blurred = 0, prevented = 0, scrolled = 0;
  const form = { requestSubmit() { assert.fail('invalid handler must not submit'); } };
  const field = { form, required: true, value: '', validationMessage: '測試必填', matches: () => true,
    blur() { blurred++; }, scrollIntoView() { scrolled++; }, focus() { assert.fail('validation must not focus the field'); } };
  const document = { activeElement: field, addEventListener: (type, fn, capture) => docListeners.set(type, { fn, capture }) };
  const context = vm.createContext({ document, window: { addEventListener: (type, fn) => winListeners.set(type, fn) },
    $: id => { assert.equal(id, 'admin-error'); return error; }, queueMicrotask: fn => tasks.push(fn) });
  vm.runInContext(source.slice(source.indexOf('function dismissAdminKeyboard('), source.indexOf('history.replaceState(')), context);
  const invalid = docListeners.get('invalid'); assert.equal(invalid.capture, true);
  for (let i = 0; i < 2; i++) invalid.fn({ target: field, preventDefault() { prevented++; } });
  assert.equal(prevented, 2); assert.equal(scrolled, 1); assert.equal(blurred, 1);
  assert.match(error.textContent, /測試必填/); assert.equal(field.required, true); assert.equal(field.value, '');
  for (const callback of [docListeners.get('visibilitychange').fn, winListeners.get('pagehide'), winListeners.get('pageshow')]) callback();
  assert.equal(blurred, 4);
});

test('background and bfcache lifecycle dismiss focus synchronously without removing pending text', () => {
  const f = fixture(), docListeners = new Map(), winListeners = new Map();
  f.document.addEventListener = (type, fn) => docListeners.set(type, fn);
  f.document.body.classList = classes();
  f.context.window.addEventListener = (type, fn) => winListeners.set(type, fn);
  Object.assign(f.context, {
    payload: { draft: { text: '保留中的虛構草稿' } }, editorContext: { type: 'visit' }, singleStoreContext: null,
    inlineTextContext: { after: '保留的直接修改' }, busy: false, backupPreview: null, pendingLock: false,
    clearNearbyPosition() {}, requestNearbyPosition() {}, showGate() {}, lockNow() {},
    flushVisitDraft() { f.events.push(['flush-visit']); }, flushInlineTextDraft() { f.events.push(['flush-inline']); }
  });
  vm.runInContext(app.slice(app.indexOf("document.addEventListener('visibilitychange', () => {"), app.indexOf("$('gate-form').addEventListener('submit'")), f.context);
  const field = f.editable('composed-text', true);
  for (const [type, hidden] of [['visibilitychange', true], ['visibilitychange', false], ['pagehide', true], ['pageshow', false]]) {
    f.document.activeElement = field; f.document.hidden = hidden;
    (docListeners.get(type) || winListeners.get(type))();
    assert.equal(f.document.activeElement, null);
    assert.equal(field.innerText, '虛構原文追加');
  }
  assert.equal(f.context.payload.draft.text, '保留中的虛構草稿');
  assert.equal(f.context.inlineTextContext.after, '保留的直接修改');
  assert.equal(f.tasks.length, 0, 'no delayed blur may steal a subsequent intentional tap');
  field.focus(); f.flush(); assert.equal(f.document.activeElement, field);
});

function pairingFixture() {
  const f = fixture(), review = f.dialog('review'), calls = [];
  f.nodes.set('review-body', { innerHTML: '' });
  Object.assign(f.context, {
    payload: { bundle: { ops: ['synthetic-only'] }, deviceName: '測試裝置', token: 'old', device: 'old-device' },
    meta: { vaultId: 'same-vault', salt: 'same-salt' },
    api: async (...args) => { calls.push(['api', ...args]); return { id: 'new-device', token: 'new-token', snapshot: { envelope: { vaultId: 'same-vault', salt: 'same-salt' } } }; },
    persist: async value => calls.push(['persist', value]), synchronize: async () => calls.push(['sync']), toast: value => calls.push(['toast', value]),
    openDialog: dialog => { dialog.open = true; }
  });
  vm.runInContext(app.slice(app.indexOf('function openRepairPair('), app.indexOf("document.addEventListener('click', event => {")), f.context);
  return { ...f, review, calls };
}

test('opening and canceling re-pair preview does not send a code or write data; stale close retains a new form', () => {
  const f = pairingFixture(), code = { value: 'synthetic-one-time-code' }; f.nodes.set('repair-pair-code', code);
  let onClose, reset = 0;
  f.review.addEventListener = (type, fn) => { assert.equal(type, 'close'); onClose = fn; };
  f.context.setReviewMode = () => reset++;
  const closeListener = app.split('\n').find(line => line.startsWith("$('review').addEventListener('close',") && line.includes('setReviewMode'));
  vm.runInContext(closeListener, f.context);
  f.context.openRepairPair();
  assert.match(f.nodes.get('review-body').innerHTML, /id="repair-pair-code"/);
  assert.equal(f.calls.length, 0);
  onClose(); assert.equal(code.value, 'synthetic-one-time-code'); assert.equal(reset, 0);
  f.review.close(); onClose(); assert.equal(code.value, ''); assert.equal(reset, 1);
  assert.equal(f.calls.length, 0);
});

test('re-pair preserves bundle and rejects another vault or salt before any local write', async () => {
  const f = pairingFixture();
  await f.context.repairPair('   '); assert.equal(f.calls.length, 0);
  const originalBundle = f.context.payload.bundle;
  await f.context.repairPair('  synthetic-code  ');
  assert.equal(f.calls[0][1], '/api/pair');
  assert.equal(f.calls[0][2].token, null);
  assert.equal(f.calls[0][2].body.code, 'synthetic-code');
  assert.equal(f.calls[1][0], 'persist');
  assert.equal(f.calls[1][1].bundle, originalBundle);
  assert.equal(f.calls[1][1].device, 'new-device'); assert.equal(f.calls[1][1].dirty, true);
  assert.equal(f.calls[2][0], 'sync');
  for (const envelope of [{ vaultId: 'different', salt: 'same-salt' }, { vaultId: 'same-vault', salt: 'different' }]) {
    const rejected = pairingFixture(); rejected.context.api = async () => ({ snapshot: { envelope } });
    await assert.rejects(rejected.context.repairPair('synthetic-code'), /另一個資料庫/);
    assert.equal(rejected.calls.length, 0, 'foreign identity must not persist or sync');
  }
});
