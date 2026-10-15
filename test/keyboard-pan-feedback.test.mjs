import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = app.indexOf('function installPhoneEditingViewport('), end = app.indexOf('let key =', start);
assert.ok(start >= 0 && end > start);
const source = app.slice(start, end);

// Synthetic browser geometry, not customer data. Range rectangles move when
// the page scrolls; the fixed action bar follows the visual viewport. A native
// viewport pan is deliberately independent of typing or changing the caret.
function fixture({ kind = 'DIV' } = {}) {
  const listeners = new Map(), viewportListeners = new Map(), windowListeners = new Map();
  const frames = [], scrolls = [], properties = new Map(), classes = new Set();
  const geometry = { caretDocumentTop: 500, caretHeight: 24, dockHeight: 96, time: 1000 };
  const body = { parentElement: null, computed: { overflowY: 'visible' }, children: [],
    append(node) { this.children.push(node); node.parentElement = this; } };
  const root = { style: { setProperty: (name, value) => properties.set(name, value) },
    classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) } };
  const rect = () => ({ top: geometry.caretDocumentTop - window.scrollY,
    bottom: geometry.caretDocumentTop - window.scrollY + geometry.caretHeight,
    height: geometry.caretHeight, left: 30, right: 31, width: 1 });
  const editor = { parentElement: body, nodeType: 1, tagName: kind, isContentEditable: kind === 'DIV', isConnected: true,
    selectionStart: 4, selectionEnd: 4, selectionDirection: 'none', scrollTop: 0, clientTop: 1, clientWidth: 320, clientHeight: 128,
    value: '虛構多行表單\n僅用於驗收', wrap: 'soft', disabled: false, readOnly: false,
    matches: () => kind !== 'DIV', contains: node => node === editor || node?.parentNode === editor,
    closest: selector => kind === 'DIV' && selector.includes('[data-inline-edit-text]') ? editor : null,
    getBoundingClientRect() {
      const top = rect().top - (kind === 'TEXTAREA' ? 20 : 0), height = kind === 'INPUT' ? 44 : kind === 'TEXTAREA' ? 130 : 644;
      return { top, bottom: top + height, height, left: 20, right: 342, width: 322 };
    },
    computed: { overflowY: 'visible', fontSize: '16px', lineHeight: '24px', paddingTop: '10px', paddingBottom: '10px',
      borderLeftWidth: '1px', borderRightWidth: '1px' } };
  const text = { nodeType: 3, parentElement: editor, parentNode: editor, isConnected: true, textContent: '虛構驗收文字'.repeat(100) };
  const selection = { rangeCount: 1, isCollapsed: true, anchorNode: text, focusNode: text, anchorOffset: 4, focusOffset: 4,
    getRangeAt() {
      return { startContainer: selection.focusNode, endContainer: selection.focusNode, startOffset: selection.focusOffset, endOffset: selection.focusOffset,
        collapsed: true, cloneRange() { return { ...this }; }, collapse() {},
        getBoundingClientRect: rect, getClientRects: () => [rect()] };
    } };
  const dock = { getClientRects: () => [{}], getBoundingClientRect() {
    const bottom = Number.parseFloat(properties.get('--phone-visible-bottom')) || viewport.offsetTop + viewport.height;
    return { top: bottom - 8 - geometry.dockHeight, bottom: bottom - 8, height: geometry.dockHeight };
  } };
  const document = { body, documentElement: root, activeElement: editor,
    querySelectorAll: selector => selector === 'dialog[open]' ? [] : [dock],
    addEventListener: (name, listener) => listeners.set(name, listener), createTextNode: textContent => ({ textContent }),
    createElement(tag) {
      return { tagName: tag.toUpperCase(), style: {}, children: [], attributes: {}, textContent: '',
        setAttribute(name, value) { this.attributes[name] = value; }, append(...nodes) { this.children.push(...nodes); },
        getClientRects: () => [{ top: 20, height: 24 }], getBoundingClientRect: () => ({ top: tag === 'div' ? 0 : 20, height: 24 }),
        remove() { body.children = body.children.filter(node => node !== this); } };
    } };
  const viewport = { height: 852, offsetTop: 0, addEventListener: (name, listener) => viewportListeners.set(name, listener) };
  const window = { innerHeight: 852, scrollY: 0, visualViewport: viewport,
    matchMedia: () => ({ matches: true }), getSelection: () => selection,
    addEventListener: (name, listener) => windowListeners.set(name, listener),
    scrollBy(value) { scrolls.push({ ...value }); this.scrollY += value.top; } };
  const context = vm.createContext({ document, window, getComputedStyle: element => element.computed || {},
    performance: { now: () => geometry.time },
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    ResizeObserver: class { observe() {} unobserve() {} }, MutationObserver: class { observe() {} } });
  vm.runInContext(source, context);
  const flush = () => {
    for (let turns = 0; frames.length && turns < 20; turns++) frames.shift()();
    assert.equal(frames.length, 0, 'geometry corrections must settle without another animation loop');
  };
  const emit = (name, extra = {}) => { listeners.get(name)?.({ type: name, target: editor, ...extra }); flush(); };
  const openKeyboard = height => { viewport.height = height; viewportListeners.get('resize')(); flush(); };
  const nativePan = offset => { viewport.offsetTop = offset; viewportListeners.get('scroll')(); flush(); };
  flush();
  return { geometry, window, viewport, editor, text, selection, scrolls, properties, emit, openKeyboard, nativePan, flush, rect };
}

test('native viewport pans update dock geometry without creating a reverse-scroll feedback loop', () => {
  const f = fixture(); f.emit('focusin'); f.openKeyboard(160);
  assert.ok(f.scrolls.length > 0, 'opening the keyboard must initially reveal the focused caret');
  const count = f.scrolls.length, top = f.window.scrollY;
  // With a short viewport the native pan crosses the caret safe-area boundary.
  // Previously every 20 -> 0 pan generated alternating -12 / +12 page scrolls.
  for (const offset of [20, 0, 20, 0, 20, 0]) f.nativePan(offset);
  assert.equal(f.scrolls.length, count, 'native pan alone must not authorize another caret correction');
  assert.equal(f.window.scrollY, top);
  f.nativePan(20);
  assert.equal(f.properties.get('--phone-visible-top'), '20px');
  assert.equal(f.properties.get('--phone-visible-bottom'), '180px', 'the action bar must still follow the real visible viewport');
});

test('repeated selectionchange for the same caret does not fight native page positioning', () => {
  const f = fixture(); f.emit('focusin'); f.openKeyboard(400); f.emit('input');
  const count = f.scrolls.length;
  // Safari moved the layout viewport after the first correction. Selection
  // node/offset did not change; a repeated notification is not fresh intent.
  f.window.scrollY -= 80;
  for (let i = 0; i < 5; i++) f.emit('selectionchange');
  assert.equal(f.scrolls.length, count, 'duplicate selection events must not restart automatic scrolling');
});

test('a temporarily unavailable native selection does not turn the restored same caret into fresh input', () => {
  const f = fixture(); f.emit('focusin'); f.openKeyboard(400); f.emit('input');
  const count = f.scrolls.length;
  f.window.scrollY -= 80;
  f.selection.rangeCount = 0; f.emit('selectionchange');
  f.selection.rangeCount = 1; f.emit('selectionchange');
  assert.equal(f.scrolls.length, count, 'transient range loss and restoration cannot restart the native-pan feedback loop');
});

test('a genuinely moved collapsed caret and new text input still receive visibility assistance', () => {
  const f = fixture(); f.emit('focusin'); f.openKeyboard(400); f.emit('input');
  const firstCount = f.scrolls.length;
  f.geometry.caretDocumentTop += 180;
  f.selection.anchorOffset = f.selection.focusOffset = 40;
  f.emit('selectionchange');
  assert.ok(f.scrolls.length > firstCount, 'moving the caret to another text offset must remain supported');
  const movedCount = f.scrolls.length;
  f.geometry.caretDocumentTop += 120;
  f.emit('input');
  assert.ok(f.scrolls.length > movedCount, 'typing must remain able to reveal an obscured caret');
  assert.equal(f.selection.focusOffset, 40, 'visibility assistance cannot change the selected text position');
  assert.equal(f.text.textContent, '虛構驗收文字'.repeat(100));
});

test('moving the caret to another text node at the same offset remains a genuine selection change', () => {
  const f = fixture(); f.emit('focusin'); f.openKeyboard(400); f.emit('input');
  const count = f.scrolls.length;
  const secondLine = { nodeType: 3, parentNode: f.editor, parentElement: f.editor, isConnected: true, textContent: '另一行虛構文字' };
  f.geometry.caretDocumentTop += 160;
  f.selection.anchorNode = f.selection.focusNode = secondLine;
  f.emit('selectionchange');
  assert.ok(f.scrolls.length > count, 'equal offsets in different text nodes must not be mistaken for a duplicate event');
  assert.equal(f.selection.focusOffset, 4);
  assert.equal(f.selection.focusNode, secondLine);
});

test('textarea duplicate selection events stay quiet while a changed insertion offset still reveals the caret', () => {
  const f = fixture({ kind: 'TEXTAREA' }); f.emit('focusin'); f.openKeyboard(400); f.emit('input');
  const count = f.scrolls.length, original = f.editor.value;
  f.window.scrollY -= 80;
  for (let i = 0; i < 5; i++) f.emit('selectionchange');
  assert.equal(f.scrolls.length, count, 'same textarea start/end/direction must not fight a native page adjustment');
  f.editor.selectionStart = f.editor.selectionEnd = 8;
  f.emit('selectionchange');
  assert.ok(f.scrolls.length > count, 'a changed textarea insertion offset must remain visible');
  assert.equal(f.editor.value, original); assert.equal(f.editor.selectionStart, 8); assert.equal(f.editor.selectionEnd, 8);
  assert.equal(f.editor.isContentEditable, false); assert.equal(f.editor.tagName, 'TEXTAREA');
});

test('single-line password caret tracking reads only selection positions, never its secret value', () => {
  const f = fixture({ kind: 'INPUT' }); f.editor.type = 'password';
  Object.defineProperty(f.editor, 'value', { get() { assert.fail('password value must never be read by viewport assistance'); } });
  f.emit('focusin'); f.openKeyboard(400); f.emit('input');
  const count = f.scrolls.length;
  f.window.scrollY -= 80; f.emit('selectionchange');
  assert.equal(f.scrolls.length, count);
  f.editor.selectionStart = f.editor.selectionEnd = 8; f.emit('selectionchange');
  assert.ok(f.scrolls.length > count);
});

test('a caret rectangle taller than the usable space converges instead of bouncing between its two edges', () => {
  const f = fixture(); f.geometry.caretHeight = 400;
  f.emit('focusin'); f.openKeyboard(400); f.emit('input');
  const settledTop = f.window.scrollY, count = f.scrolls.length;
  for (let i = 0; i < 6; i++) f.emit('input');
  assert.equal(f.window.scrollY, settledTop, 'an oversized measured range must use one stable edge');
  assert.equal(f.scrolls.length, count, 'repeated input with unchanged geometry must not drift or reverse direction');
});

test('noncollapsed text selection is never pulled by viewport pan or selection notifications', () => {
  const f = fixture(); f.openKeyboard(400);
  f.selection.isCollapsed = false; f.selection.anchorOffset = 0; f.selection.focusOffset = 80;
  const count = f.scrolls.length;
  f.geometry.caretDocumentTop += 400;
  f.emit('selectionchange'); f.nativePan(30); f.emit('input');
  assert.equal(f.scrolls.length, count);
});
