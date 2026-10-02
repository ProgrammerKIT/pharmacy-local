import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function installPhoneEditingViewport('), app.indexOf('let key ='));

function fixture({ kind = 'TEXTAREA', mobile = true, dialog = true, nested = false, withViewport = true } = {}) {
  const listeners = new Map(), viewportListeners = new Map(), windowListeners = new Map(), frames = [];
  const properties = new Map(), classes = new Set(), mirrors = [], removed = [], windowScrolls = [];
  const geometry = { fieldTop: 500, fieldHeight: 130, localCaretTop: 11, headerBottom: 88, footerTop: null, dockTop: null, failMirror: false, now: 1000 };
  const body = { children: [], append(node) { this.children.push(node); node.parentElement = this; }, querySelectorAll: () => [] };
  const root = { style: { setProperty: (name, value) => properties.set(name, value) }, classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } };
  const header = { contains: () => false, getBoundingClientRect: () => ({ top: 12, bottom: geometry.headerBottom }) };
  const footer = { contains: () => false, computed: { position: 'sticky' }, getBoundingClientRect: () => ({ top: geometry.footerTop }) };
  const dock = { getClientRects: () => [{}], getBoundingClientRect: () => ({ top: geometry.dockTop, height: 72 }) };
  const dialogElement = { parentElement: body, scrollTop: 0, computed: { overflowY: 'auto' },
    getBoundingClientRect: () => ({ top: 12, bottom: (withViewport ? viewport.height : window.innerHeight) - 12 }),
    querySelector: selector => selector.includes('section-row') ? header : geometry.footerTop !== null ? footer : null,
    querySelectorAll: () => geometry.dockTop === null ? [] : [dock] };
  const nestedScroller = { parentElement: dialogElement, scrollTop: 0, computed: { overflowY: 'auto' }, getBoundingClientRect: () => ({ top: 110, bottom: 350 }) };
  const owner = nested ? nestedScroller : dialog ? dialogElement : null;
  const form = { parentElement: owner || body, computed: { overflowY: 'visible' } };
  const field = { tagName: kind, type: kind === 'INPUT' ? 'text' : undefined, wrap: 'soft', value: '虛構多行筆記\n第二行', selectionStart: 6, selectionEnd: 6,
    scrollTop: 0, scrollLeft: 0, clientTop: 1, clientWidth: 320, clientHeight: 128, disabled: false, readOnly: false, parentElement: form,
    computed: { fontSize: '16px', lineHeight: '24px', paddingTop: '10px', paddingBottom: '10px', borderTopWidth: '1px', borderLeftWidth: '1px', borderRightWidth: '1px', overflowY: 'auto' },
    matches: () => ['TEXTAREA', 'INPUT'].includes(kind), closest: selector => selector === 'dialog[open]' && dialog ? dialogElement : null,
    getBoundingClientRect() { const top = geometry.fieldTop - (owner?.scrollTop || 0); return { top, bottom: top + geometry.fieldHeight, height: geometry.fieldHeight, width: 322 }; },
    focus() { assert.fail('visibility correction must never focus a field'); }, blur() { assert.fail('visibility correction must not dismiss intentional input'); },
    setSelectionRange() { assert.fail('visibility correction must not move text selection'); }
  };
  const document = { body, documentElement: root, activeElement: field,
    querySelectorAll: () => dialog ? [dialogElement] : geometry.dockTop === null ? [] : [dock],
    addEventListener: (name, fn) => listeners.set(name, fn), createTextNode: text => ({ textContent: text }),
    createElement(tag) {
      const node = { tagName: tag.toUpperCase(), style: {}, attributes: {}, children: [], textContent: '', inert: false,
        setAttribute(name, value) { this.attributes[name] = value; }, append(...children) { this.children.push(...children); },
        getClientRects() { if (geometry.failMirror) throw Error('synthetic geometry failure'); return [{ top: geometry.localCaretTop, height: 16 }]; },
        getBoundingClientRect: () => ({ top: tag === 'div' ? 0 : geometry.localCaretTop, height: 16 }),
        remove() { body.children = body.children.filter(child => child !== this); removed.push(this); }
      };
      if (tag === 'div') mirrors.push(node);
      return node;
    }
  };
  const viewport = { height: 852, offsetTop: 0, addEventListener: (name, fn) => viewportListeners.set(name, fn) };
  const window = { innerHeight: 852, visualViewport: withViewport ? viewport : undefined,
    matchMedia: () => ({ matches: mobile }), addEventListener: (name, fn) => windowListeners.set(name, fn),
    scrollBy: value => windowScrolls.push(value), getSelection: () => null };
  const context = vm.createContext({ document, window, getComputedStyle: element => element.computed || {}, performance: { now: () => geometry.now },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, ResizeObserver: class { observe() {} unobserve() {} }, MutationObserver: class { observe() {} } });
  vm.runInContext(source, context);
  const flush = () => { for (let count = 0; frames.length && count < 20; count++) frames.shift()(); assert.equal(frames.length, 0); };
  flush();
  const openKeyboard = () => { viewport.height = 400; viewportListeners.get('resize')(); flush(); };
  return { field, owner, dialogElement, nestedScroller, document, viewport, window, listeners, viewportListeners, windowListeners, geometry, mirrors, removed, windowScrolls, properties, classes, body, openKeyboard, flush };
}

test('opening keyboard brings an ordinary reminder textarea caret inside its dialog with the minimum scroll', () => {
  const f = fixture(), before = f.field.value, start = f.field.selectionStart;
  f.openKeyboard();
  assert.equal(f.owner.scrollTop, 155);
  assert.equal(f.windowScrolls.length, 0, 'the fixed background must not scroll');
  assert.equal(f.field.value, before); assert.equal(f.field.selectionStart, start); assert.equal(f.field.selectionEnd, start);
  assert.equal(f.field.getBoundingClientRect().top + f.geometry.localCaretTop + 24, 380);
  f.listeners.get('input')(); f.flush(); assert.equal(f.owner.scrollTop, 155, 'already-visible input stays in place');
});

test('textarea measurement is temporary, inert and text-only, and cleans up even when geometry throws', () => {
  const f = fixture(); f.field.value = '<img src="invalid" onerror="bad">\n純虛構文字';
  f.field.selectionStart = f.field.selectionEnd = 10; f.openKeyboard();
  const mirror = f.mirrors[0];
  assert.equal(mirror.attributes['aria-hidden'], 'true'); assert.equal(mirror.inert, true);
  assert.equal(mirror.style.visibility, 'hidden'); assert.equal(mirror.style.pointerEvents, 'none');
  assert.equal(mirror.style.width, '322px'); assert.equal(mirror.style.whiteSpace, 'pre-wrap');
  assert.equal(mirror.children.map(child => child.textContent).join(''), f.field.value);
  assert.equal(f.body.children.length, 0); assert.equal(f.removed.length, 1);
  const failing = fixture(); failing.geometry.failMirror = true;
  assert.throws(() => failing.openKeyboard(), /synthetic geometry failure/);
  assert.equal(failing.body.children.length, 0); assert.equal(failing.removed.length, 1);
});

test('a long textarea keeps its end caret inside both its own shortened text area and the visible dialog', () => {
  const f = fixture(); f.field.value = '虛構多行\n'.repeat(400); f.field.selectionStart = f.field.selectionEnd = f.field.value.length;
  f.geometry.localCaretTop = 1200; f.field.clientHeight = 100; f.geometry.fieldHeight = 102;
  const before = { value: f.field.value, start: f.field.selectionStart, end: f.field.selectionEnd };
  f.openKeyboard();
  assert.ok(f.field.scrollTop > 1000, 'internal scrolling reveals the caret when CSS shortens a long textarea');
  assert.ok(f.owner.scrollTop > 0, 'revealing only the textarea internal line is insufficient');
  const caretTop = f.field.getBoundingClientRect().top + f.geometry.localCaretTop - f.field.scrollTop;
  assert.ok(caretTop >= 96 && caretTop + 24 <= 380);
  assert.deepEqual({ value: f.field.value, start: f.field.selectionStart, end: f.field.selectionEnd }, before);
});

test('single-line password and pairing inputs are made visible without reading or mirroring their values', () => {
  for (const type of ['password', 'text']) {
    const f = fixture({ kind: 'INPUT' }); f.field.type = type; f.geometry.fieldHeight = 44;
    Object.defineProperty(f.field, 'value', { get() { assert.fail('single-line visibility must not read sensitive text'); } });
    f.openKeyboard();
    assert.equal(f.owner.scrollTop, 164); assert.equal(f.mirrors.length, 0); assert.equal(f.windowScrolls.length, 0);
  }
});

test('nearest inner scroller and sticky header/footer bounds take precedence over the outer dialog', () => {
  const f = fixture({ nested: true }); f.geometry.footerTop = 310; f.openKeyboard();
  assert.equal(f.nestedScroller.scrollTop, 233); assert.equal(f.dialogElement.scrollTop, 0);
  assert.equal(f.windowScrolls.length, 0);
  f.geometry.fieldTop = 280; f.geometry.headerBottom = 150;
  f.listeners.get('input')(); f.flush();
  assert.equal(f.field.getBoundingClientRect().top + f.geometry.localCaretTop, 158);
});

test('closing or expanding the keyboard never pulls the reading position back to the old caret', () => {
  const f = fixture(); f.openKeyboard(); const top = f.owner.scrollTop;
  f.geometry.fieldTop = 900; f.viewport.height = 500;
  f.listeners.get('input')(); f.viewportListeners.get('resize')(); f.flush();
  assert.equal(f.owner.scrollTop, top);
  f.viewport.height = 852; f.viewportListeners.get('resize')(); f.flush();
  f.listeners.get('selectionchange')(); f.flush();
  assert.equal(f.owner.scrollTop, top); assert.equal(f.classes.has('phone-keyboard-open'), false);
});

test('an intentional tap defers reveal until pointer release, while dragging and selection keep user control', () => {
  const f = fixture();
  f.listeners.get('pointerdown')({ pointerId: 1, clientX: 20, clientY: 20, target: f.field }); f.openKeyboard();
  assert.equal(f.owner.scrollTop, 0);
  f.listeners.get('pointerup')({ pointerId: 1 }); f.flush(); assert.equal(f.owner.scrollTop, 155);
  f.geometry.fieldTop = 900; const top = f.owner.scrollTop;
  f.listeners.get('pointerdown')({ pointerId: 2, clientX: 20, clientY: 20, target: f.field });
  f.listeners.get('pointermove')({ pointerId: 2, clientX: 21, clientY: 90 });
  f.viewportListeners.get('scroll')(); f.flush(); assert.equal(f.owner.scrollTop, top);
  f.listeners.get('pointerup')({ pointerId: 2 });
  f.listeners.get('selectionchange')(); f.flush(); assert.equal(f.owner.scrollTop, top);
  f.viewport.offsetTop = 20; f.viewportListeners.get('scroll')(); f.flush(); assert.equal(f.owner.scrollTop, top, 'gesture cooldown also prevents native viewport-pan feedback');
  f.geometry.now += 300; f.viewport.offsetTop = 40; f.viewportListeners.get('scroll')(); f.flush();
  assert.equal(f.owner.scrollTop, top, 'momentum pan after the cooldown must not pull the reader back');
  f.field.selectionEnd += 3;
  f.listeners.get('selectionchange')(); f.flush(); assert.equal(f.owner.scrollTop, top, 'noncollapsed text selection is never pulled away');
  f.field.selectionEnd = f.field.selectionStart;
  f.listeners.get('input')(); f.flush(); assert.ok(f.owner.scrollTop > top, 'a fresh intentional input restores caret assistance');
});

test('wheel scrolling also owns position until the user explicitly taps or types in a field again', () => {
  const f = fixture(); f.openKeyboard(); const top = f.owner.scrollTop;
  f.geometry.fieldTop = 900; f.listeners.get('wheel')();
  f.geometry.now += 600; f.viewport.offsetTop = 40; f.viewportListeners.get('scroll')(); f.flush();
  assert.equal(f.owner.scrollTop, top);
  f.listeners.get('pointerdown')({ pointerId: 3, clientX: 20, clientY: 20, target: f.field });
  f.listeners.get('pointerup')({ pointerId: 3 }); f.flush();
  assert.ok(f.owner.scrollTop > top, 'a tap inside the already-focused input does not require another focusin event');
});

test('desktop avoids measurement while the no-VisualViewport fallback and ordinary page forms can reveal input', () => {
  const desktop = fixture({ mobile: false }); assert.equal(desktop.listeners.size, 0); assert.equal(desktop.mirrors.length, 0);
  const fallback = fixture({ withViewport: false }); fallback.window.innerHeight = 460;
  fallback.windowListeners.get('resize')(); fallback.flush();
  assert.equal(fallback.properties.get('--phone-visible-height'), '460px'); assert.ok(fallback.mirrors.length > 0);
  assert.equal(fallback.classes.has('phone-keyboard-open'), true); assert.ok(fallback.owner.scrollTop > 0);
  const page = fixture({ dialog: false }); page.openKeyboard();
  assert.equal(page.windowScrolls.length, 1); assert.equal(page.windowScrolls[0].top, 151);
});
