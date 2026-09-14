import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { APP_VERSION } from '../public/version.js';

const source = fs.readFileSync(new URL('../public/update-client.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function browser() {
  const model = { busy: false, token: true, fault: null, updateFails: false, time: 100000, maintenance: null };
  const handlers = { document: {}, window: {}, worker: {} }, elements = new Map(), events = [], requests = [];
  const counts = { checks: 0, reloads: 0, activations: 0, holds: false, ready: 0 };
  let interval;
  const reg = { waiting: null, addEventListener() {}, update: async () => { counts.checks++; if (model.updateFails) throw new Error('offline shell'); } };
  const worker = { addEventListener: (name, fn) => handlers.worker[name] = fn, register: async () => reg, ready: Promise.resolve() };
  const doc = { hidden: false, getElementById: id => { if (!elements.has(id)) elements.set(id, { textContent: '' }); return elements.get(id); }, addEventListener: (name, fn) => handlers.document[name] = fn };
  const context = vm.createContext({
    APP_VERSION, document: doc, navigator: { serviceWorker: worker },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    location: { hostname: 'fictional.local', reload: () => counts.reloads++ },
    window: { addEventListener: (name, fn) => handlers.window[name] = fn },
    Date: class extends Date { static now() { return model.time; } },
    setInterval: fn => { interval = fn; return 1; }, setTimeout: () => 2, clearTimeout() {},
  });
  vm.runInContext(source, context);
  context.startUpdates({
    api: async (path, options) => { requests.push({ path, ...options }); if (model.fault) throw model.fault; return { appVersion: APP_VERSION, maintenance: model.maintenance, update: { message: '沒有較新版' } }; },
    hasToken: () => model.token, isBusy: () => model.busy, setHold: held => counts.holds = held,
    notify: message => events.push(message), onOfflineReady: () => counts.ready++,
  });
  await flush();
  return {
    model, counts, handlers, requests, events, elements, doc,
    waiting: () => { reg.waiting = { postMessage: message => { assert.equal(message.type, 'APPLY_WHEN_SAFE'); counts.activations++; } }; },
    tick: async () => { await interval(); await flush(); },
  };
}

test('revoked pairing still checks the shell; offline retries retain cached code and never reload a draft', async () => {
  const b = await browser();
  b.model.fault = Object.assign(new Error('revoked'), { status: 401, code: 'pairing', serviceReached: true });
  b.model.busy = true; b.model.time += 60001; b.waiting();
  const before = b.counts.checks;
  await b.tick();
  assert.equal(b.counts.checks, before + 1);
  assert.equal(b.counts.activations, 0); assert.equal(b.counts.reloads, 0);
  assert.match(b.elements.get('update-state').textContent, /配對已失效.*仍會獨立檢查/);
  b.model.updateFails = true; b.model.time += 60001;
  await b.tick(); assert.equal(b.counts.activations, 0);
  b.model.busy = false; await b.tick();
  assert.ok(b.counts.activations > 0); // Already prepared worker can still request the all-tab handshake.
  assert.equal(b.counts.reloads, 0); assert.equal(b.counts.holds, false);
  b.model.fault = Object.assign(new Error('unrecognized proxy response'), { status: 401, code: 'response', serviceReached: false });
  await b.tick(); assert.doesNotMatch(b.elements.get('update-state').textContent, /配對已失效/);
});

test('maintenance holds do not approve worker activation until the Mac finishes switching', async () => {
  const b = await browser(); b.waiting();
  b.model.maintenance = 'fictional-maintenance'; await b.tick();
  assert.equal(b.counts.holds, true); assert.equal(b.counts.activations, 0);
  let reply;
  b.handlers.worker.message({ data: { type: 'UPDATE_PREPARE' }, ports: [{ postMessage: value => reply = value }] });
  assert.equal(reply.ready, false);
  b.model.maintenance = null; await b.tick();
  assert.equal(b.counts.holds, false); assert.ok(b.counts.activations > 0);
});

test('an authentication failure releases only the remote hold, preserving an acknowledged worker hold', async () => {
  const b = await browser();
  let reply;
  b.handlers.worker.message({ data: { type: 'UPDATE_PREPARE' }, ports: [{ postMessage: value => reply = value }] });
  assert.equal(reply.ready, true); assert.equal(b.counts.holds, true);
  b.model.fault = Object.assign(new Error('revoked'), { status: 401, code: 'pairing', serviceReached: true }); await b.tick();
  assert.equal(b.counts.holds, true);
  b.handlers.worker.message({ data: { type: 'UPDATE_CANCEL' } });
  assert.equal(b.counts.holds, false);
});

test('controller changes wait for editing to finish and the probe survives pagehide and return to foreground', async () => {
  const b = await browser();
  b.model.busy = true; b.handlers.worker.controllerchange();
  assert.equal(b.counts.reloads, 0); assert.equal(b.events.length, 1);
  await b.tick(); assert.equal(b.counts.reloads, 0);
  b.handlers.window.pagehide(); b.doc.hidden = true; await b.tick();
  assert.equal(b.counts.reloads, 0);
  b.doc.hidden = false; b.model.busy = false; b.handlers.document.visibilitychange();
  await flush(); assert.equal(b.counts.reloads, 1);
});

test('an unpaired unlocked page can update its shell without making authenticated activity requests', async () => {
  const b = await browser();
  b.model.token = false; b.model.time += 60001;
  const before = b.requests.length, checks = b.counts.checks;
  await b.tick();
  assert.equal(b.requests.length, before); assert.equal(b.counts.checks, checks + 1);
  assert.equal(b.counts.holds, false);
});
