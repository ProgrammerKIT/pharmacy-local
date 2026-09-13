import { APP_VERSION } from '../public/version.js';
const [major, minor, patch] = APP_VERSION.split('.').map(Number);
const NEXT_VERSION = `${major}.${minor}.${patch + 1}`, BAD_VERSION = `${major}.${minor}.${patch + 2}`;
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

function worker({ mixed = false, ready = [], opensNewClient = false } = {}) {
  const handlers = {}, stored = new Map(), messages = [];
  let skipped = 0, listCalls = 0, claims = 0;
  const windows = ready.map((r, n) => ({ id: String(n), postMessage: (message, ports) => { messages.push(message.type); if (ports?.[0] && r !== null) { ports[0].postMessage({ ready: r }); ports[0].close(); } } }));
  const context = { URL, Response, MessageChannel, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 30)), clearTimeout,
    fetch: async asset => new Response(asset, { headers: { 'X-Pharmacy-Version': mixed && asset === '/core.js' ? '0.9.0' : APP_VERSION } }),
    caches: { open: async name => ({ put: async (key, value) => stored.set(`${name}:${key}`, value), match: async key => stored.get(`${name}:${key}`) }), keys: async () => ['pharmacy-shell-v1.3.0'], delete: async () => true },
    self: { location: { origin: 'https://fictional.local:8444' }, addEventListener: (type, fn) => handlers[type] = fn, skipWaiting: async () => { skipped++; }, clients: { claim: async () => { claims++; }, matchAll: async () => { listCalls++; return opensNewClient && listCalls > 1 ? [...windows, { id: 'new' }] : windows; } } },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  const dispatch = async (type, extra = {}) => { let result; handlers[type]({ ...extra, waitUntil: p => result = p, respondWith: p => result = p }); return await result; };
  return { dispatch, stored, messages, counts: () => ({ skipped, claims }) };
}
test('worker atomically prepares consistent code cache and refuses mixed release assets', async () => {
  const good = worker(); await good.dispatch('install'); assert.equal(good.stored.size, 15);
  const bad = worker({ mixed: true }); await assert.rejects(bad.dispatch('install'), /Mixed/); assert.equal(bad.stored.size, 0);
});
test('worker activation requires every open window to acknowledge idle', async () => {
  const good = worker({ ready: [true, true] }); await good.dispatch('message', { data: { type: 'APPLY_WHEN_SAFE' } }); assert.equal(good.counts().skipped, 1);
  for (const scenario of [{ ready: [true, false] }, { ready: [true, null] }, { ready: [true], opensNewClient: true }]) {
    const w = worker(scenario); await w.dispatch('message', { data: { type: 'APPLY_WHEN_SAFE' } }); assert.equal(w.counts().skipped, 0); assert.ok(w.messages.includes('UPDATE_CANCEL'));
  }
});
test('worker serves its own offline shell, never captures APIs or external resources', async () => {
  const w = worker(); await w.dispatch('install');
  const local = path => ({ method: 'GET', url: `https://fictional.local:8444${path}` });
  const response = await w.dispatch('fetch', { request: local('/app.js') }); assert.equal(await response.text(), '/app.js');
  assert.equal(await w.dispatch('fetch', { request: local('/api/snapshot') }), undefined);
  const blocked = await w.dispatch('fetch', { request: { method: 'GET', url: 'https://outside.example/collect' } }); assert.equal(blocked.type, 'error');
});
