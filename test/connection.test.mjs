import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { APP_VERSION } from '../public/version.js';

const source = fs.readFileSync(new URL('../public/update-client.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
function client(fetchImpl, timeout = false) {
  let abort, cleared = 0;
  const calls = [], versions = [];
  const context = vm.createContext({
    APP_VERSION, AbortController,
    fetch: async (url, options) => { calls.push({ url, options }); if (timeout) abort(); return fetchImpl(url, options); },
    setTimeout: fn => { abort = fn; return 1; }, clearTimeout: () => { cleared++; },
  });
  vm.runInContext(source, context);
  const api = (path, options = {}) => context.requestLocal(path, { token: 'fictional-secret-token', ...options }, version => versions.push(version));
  return { context, api, calls, versions, cleared: () => cleared };
}
const response = (body, status = 200, recognized = true) => new Response(JSON.stringify(body), { status, headers: recognized ? { 'X-Pharmacy-Version': APP_VERSION } : {} });

test('diagnostics uses only a same-origin uncached version read with the existing authentication header', async () => {
  const c = client(async () => response({ version: 7 }));
  const result = await c.context.diagnoseConnection({ api: c.api, hasToken: () => true });
  assert.equal(result.version, 7); assert.equal(result.pairing, '配對有效');
  assert.equal(c.calls.length, 1);
  const { url, options } = c.calls[0];
  assert.equal(url, '/api/version'); assert.equal(options.method, 'GET');
  assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
  assert.equal(options.headers.Authorization, 'Bearer fictional-secret-token'); assert.equal(options.body, undefined);
  assert.equal(c.cleared(), 1); assert.deepEqual(c.versions, [APP_VERSION]);
  assert.ok(!JSON.stringify(result).includes('fictional-secret-token'));
  await assert.rejects(c.api('https://outside.example/api/version'), /只允許/);
  assert.equal(c.calls.length, 1);
});

test('a recognized 401 proves HTTPS reached the service while reporting invalid or absent pairing', async () => {
  const c = client(async () => response({ error: '裝置配對已被撤銷。' }, 401));
  const failed = await c.context.diagnoseConnection({ api: c.api, hasToken: () => true });
  assert.match(failed.service, /已回應/); assert.match(failed.tls, /驗證通過/);
  assert.match(failed.pairing, /配對已失效/); assert.equal(failed.version, null);
  const unpaired = await c.context.diagnoseConnection({ api: c.api, hasToken: () => false });
  assert.match(unpaired.pairing, /尚未配對/); assert.equal(c.calls[1].options.headers.Authorization, undefined);
});

test('network and abort failures stay uncertain rather than naming a firewall or certificate as the cause', async () => {
  for (const timeout of [false, true]) {
    const c = client(async () => { throw timeout ? new DOMException('aborted', 'AbortError') : Object.assign(new TypeError('Failed to fetch'), { code: 'ECONNRESET' }); }, timeout);
    await assert.rejects(c.api('/api/version'), error => {
      assert.equal(error.code, timeout ? 'timeout' : 'network'); assert.equal(error.serviceReached, false); return true;
    });
    const result = await c.context.diagnoseConnection({ api: c.api, hasToken: () => true });
    assert.equal(result.service, '尚未確認'); assert.equal(result.tls, '尚未確認'); assert.equal(result.version, null);
    assert.match(result.message, /無法單憑/); assert.equal(c.cleared(), 2);
  }
});

test('malformed and unrelated responses never turn into a valid pairing or data revision', async () => {
  for (const make of [
    () => new Response('<html>proxy error</html>', { headers: { 'X-Pharmacy-Version': APP_VERSION } }),
    () => response({ version: 7 }, 200, false),
    () => response({ error: 'unrelated authentication' }, 401, false),
    () => response({ version: '7' }),
    () => response({ version: -1 }),
    () => response({ error: '更新切換中' }, 503),
  ]) {
    const c = client(async () => make());
    const result = await c.context.diagnoseConnection({ api: c.api, hasToken: () => true });
    assert.equal(result.version, null); assert.doesNotMatch(result.pairing, /配對有效/);
  }
  const c = client(async () => response({ version: 7 }));
  await assert.rejects(c.api('/api/snapshot'), error => error.code === 'response');
});
