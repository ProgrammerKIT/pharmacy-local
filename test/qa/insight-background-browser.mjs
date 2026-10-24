// Isolated full-App browser acceptance, using only fictional encrypted data.
// Reuses an existing Playwright/Chrome installation; never connects to an App
// service, a real browser profile, or any external host. Visibility/device/clock
// simulations are explicit in the report and are not actual iPhone or OS sleep.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON ? path.resolve(process.env.PLAYWRIGHT_PACKAGE_JSON) : import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.QA_BROWSER_ENGINE || 'chromium';
const headless = process.env.QA_HEADLESS !== 'false';
const nativeOnly = process.env.QA_NATIVE_ONLY === '1';
assert.ok(['chromium', 'webkit', 'firefox'].includes(engine));
const browser = await playwright[engine].launch({ headless, ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-insight-background-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18454';
const initialTime = new Date('2026-10-24T04:00:00.000Z');
const oldText = '小安目前在青禾店工作。';
const changedText = '小安已離職。';
const token = 'fictional-background-qa-token-never-real';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const devices = {
  mac: { platform: 'MacIntel', maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36', width: 1280 },
  iphone: { platform: 'iPhone', maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', width: 393 },
  ipadDesktop: { platform: 'MacIntel', maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', width: 1024 }
};
const report = {
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  engine, browserVersion: browser.version(), headless, nativeOnly, fictionalOnly: true,
  connectedAppService: false, persistentBrowserProfile: false,
  syntheticVisibility: !nativeOnly, acceleratedClock: true, simulatedDeviceIdentification: true,
  realIPhone: false, realMacSleep: false, realBrowserFreeze: false,
  instrumentation: 'Only the intercepted core.js scan export is wrapped to record actual calls/results; its calculation and the delivered app.js remain unchanged.',
  scenarios: []
};

function instrumentCore(source) {
  const signature = 'export async function scanInsightChanges(bundle) {';
  assert.equal(source.split(signature).length, 2, 'Instrument exactly the existing public scan export');
  return source.replace(signature, 'async function qaOriginalScanInsightChanges(bundle) {') + `
export async function scanInsightChanges(bundle) {
  const event = { hidden: document.hidden, at: Date.now(), completed: false };
  (window.__qaScans ||= []).push(event);
  const result = await qaOriginalScanInsightChanges(bundle);
  event.completed = true;
  event.changes = result.stores.reduce((n, store) => n + store.changes.length, 0);
  return result;
}
`;
}

async function isolated(mode = 'change', device = 'mac', syntheticVisibility = true) {
  const profile = devices[device];
  const context = await browser.newContext({ userAgent: profile.userAgent, viewport: { width: profile.width, height: 900 }, serviceWorkers: 'block', timezoneId: 'Asia/Taipei' });
  await context.addInitScript(({ profile, syntheticVisibility }) => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => profile.platform });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => profile.maxTouchPoints });
    window.__qaScans = [];
    if (syntheticVisibility) {
      window.__qaHidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__qaHidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__qaHidden ? 'hidden' : 'visible' });
    }
  }, { profile, syntheticVisibility });
  const errors = [], external = [], apiRequests = [];
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: initialTime });
  await page.clock.pauseAt(initialTime);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (url.pathname === '/qa-seed' || url.pathname === '/qa-blank') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fictional isolated background acceptance</title>' });
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push({ path: url.pathname, method: route.request().method() });
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Fictional isolated QA: every API blocked"}' });
    }
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
    const body = url.pathname === '/core.js' ? instrumentCore(fs.readFileSync(file, 'utf8')) : fs.readFileSync(file);
    return route.fulfill({ contentType, body });
  });
  await page.goto(origin + '/qa-seed');
  const initialBundle = await page.evaluate(async ({ mode, oldText, changedText, token }) => {
    const c = await import('/core.js'), db = await import('/db.js'), meta = c.newMeta();
    const key = await c.derive('fictional-background-password-only', meta);
    let bundle = c.emptyBundle(meta.vaultId);
    const store = c.revision('store', 'qa-qinghe', { name: '青禾店', city: '虛構市', district: '測試區', address: '虛構路 1 號', channel: '', attr: '', contact: '', everyTimeMust: '' }, [], 'fictional-qa');
    store.at = '2026-10-19T01:00:00.000Z';
    const visit = c.revision('visit', 'qa-original', { store: store.entity, date: '2026-10-19', source: '虛構原始筆記', text: oldText, next: '', people: [], topics: [], attachments: [] }, [], 'fictional-qa');
    visit.at = '2026-10-19T02:00:00.000Z';
    const entry = { id: 'qa-confirmed-work', kind: 'relationship', level: 'source', headline: oldText, question: '已確認的虛構問題。', caution: '', limitations: ['全部為虛構資料。'], evidence: [{ storeId: store.entity, storeIdentityKey: c.storeInsightsIdentityKey(store.data), visitId: visit.entity, revisionId: visit.id, quote: oldText, role: 'support' }] };
    store.data.preVisitInsights = { format: 'pharmacy-store-insights-1', batchId: 'qa-background', generatedAt: '2026-10-20T01:00:00.000Z', sourceAsOf: '2026-10-20', entries: [entry] };
    bundle.ops.push(store, visit);
    bundle = c.applyInsightReview(bundle, c.planInsightReview(bundle, store.entity, entry.id, 'confirmed', store.id), 'fictional-qa');
    const confirmation = bundle.ops.at(-1); confirmation.at = '2026-10-20T02:00:00.000Z'; confirmation.data.preVisitInsightReviews.at(-1).reviewedAt = confirmation.at;
    if (mode !== 'none') {
      const text = mode === 'support' ? '小安目前仍在青禾店工作。' : changedText;
      const op = c.revision('visit', 'qa-new-note', { ...visit.data, date: '2026-10-22', source: '虛構新增筆記', text }, [], 'fictional-qa');
      op.at = '2026-10-22T02:00:00.000Z'; bundle.ops.push(op);
    }
    c.validateBundle(bundle);
    const payload = { schema: 1, device: 'fictional-background-device', deviceName: '虛構背景驗收', token, bundle, dirty: false, serverVersion: 115, lastSync: new Date().toISOString(), lastHealthAudit: new Date().toISOString(), pendingSync: { entities: [], unknown: false }, qaOnly: 'fictional-background' };
    await db.writeLocal(await c.seal(payload, key, meta, 'device'), 0, key);
    return bundle;
  }, { mode, oldText, changedText, token });
  await page.goto(origin + '/');
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle');
  return { context, page, errors, external, apiRequests, initialBundle, device, mode };
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
    const payload = await c.unseal(slot.envelope, slot.unlockKey, 'device');
    if (payload.qaOnly !== 'fictional-background') throw new Error('Not the isolated fictional fixture');
    return { revision: slot.revision, envelope: slot.envelope, payload };
  });
}
const scanEvents = page => page.evaluate(() => structuredClone(window.__qaScans));
async function visibility(page, hidden) {
  await page.evaluate(hidden => { window.__qaHidden = hidden; document.dispatchEvent(new Event('visibilitychange')); }, hidden);
}
async function advanceAndWaitScan(page, duration, previous) {
  if (duration < 20000) {
    // Let route-intercepted asynchronous fetches settle between timer turns;
    // advancing all callbacks in one jump can keep a foreground sync in flight.
    await page.clock.runFor(Math.min(1000, duration));
    await page.waitForLoadState('networkidle');
    await page.clock.runFor(Math.max(0, duration - 1000));
  }
  else await page.clock.fastForward(duration);
  // Native hidden tabs suspend requestAnimationFrame, so poll from the Node test
  // driver instead of using Playwright's default frame-based browser polling.
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await scanEvents(page)).filter(event => event.completed).length > previous) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok((await scanEvents(page)).filter(event => event.completed).length > previous, 'Expected an additional completed scan after clock advance');
}
async function openStore(page) {
  await page.locator('.rail [data-view="stores"]').click();
  await page.locator('#stores-view [data-visit-brief="qa-qinghe"]').first().click();
  await page.locator('#review.visit-brief-dialog').waitFor({ state: 'visible' });
}
function isolationChecks(t) {
  assert.deepEqual(t.errors, [], 'No browser runtime errors');
  assert.deepEqual(t.external, [], 'No attempted external-origin requests');
  assert.ok(t.apiRequests.every(request => ['GET', 'HEAD'].includes(request.method) || (request.method === 'POST' && request.path === '/api/activity')), 'No data, pairing or backup mutation attempted: ' + JSON.stringify(t.apiRequests));
}
async function unchanged(t, before) {
  const after = await snapshot(t.page);
  assert.deepEqual(after, before, 'Entire encrypted slot and payload remain byte-for-byte unchanged');
  assert.deepEqual(after.payload.bundle, t.initialBundle, 'All original notes, review events and history remain unchanged');
  assert.equal(after.payload.token, token, 'Existing fictional pairing token remains unchanged');
  isolationChecks(t);
}
async function scenario(name, callback) {
  let t;
  try {
    t = await callback.open();
    const result = await callback.run(t);
    report.scenarios.push({ name, passed: true, ...result, blockedApiRequests: t.apiRequests, externalRequests: t.external, runtimeErrors: t.errors });
  } catch (error) {
    if (t) console.error(JSON.stringify({ failedScenario: name, scans: await scanEvents(t.page).catch(() => []), blockedApiRequests: t.apiRequests }));
    if (t) await t.page.screenshot({ path: path.join(outputDir, 'failure-' + name + '.png') }).catch(() => {});
    throw error;
  } finally { if (t) await t.context.close(); }
}

async function backgroundScan(mode) {
  await scenario('mac-background-' + mode, {
    open: () => isolated(mode),
    run: async t => {
      const { page } = t, before = await snapshot(page);
      assert.equal((await scanEvents(page)).length, 0, 'Clock keeps the first queued scan pending until hidden');
      await visibility(page, true);
      assert.equal(await page.locator('body').evaluate(node => node.classList.contains('privacy-veil')), true);
      assert.equal(await page.locator('#workspace').evaluate(node => node.hidden), false, 'Idle Mac retains its unlocked read-only session behind the veil');
      const paint = await page.locator('#insight-scan-status').textContent(), requests = t.apiRequests.length;
      await advanceAndWaitScan(page, 2500, 0);
      const first = await scanEvents(page);
      assert.equal(first[0].hidden, true, 'The real scan calculation runs while simulated hidden');
      assert.equal(first[0].changes, mode === 'change' ? 1 : 0);
      await page.clock.fastForward(14 * 60 * 1000);
      assert.equal((await scanEvents(page)).length, 1, 'Unchanged data is not rescanned before the interval');
      await advanceAndWaitScan(page, 2 * 60 * 1000, 1);
      assert.equal((await scanEvents(page)).at(-1).hidden, true);
      assert.equal(await page.locator('#insight-scan-status').textContent(), paint, 'Background scans do not paint status');
      assert.equal(t.apiRequests.length, requests, 'No API/sync/weekly requests while background scanning');
      await unchanged(t, before);
      await page.screenshot({ path: path.join(outputDir, 'mac-background-veil-' + mode + '.png') });
      await visibility(page, false);
      await page.locator('#workspace').waitFor({ state: 'visible' });
      assert.equal(await page.locator('body').evaluate(node => node.classList.contains('privacy-veil')), false);
      assert.match(await page.locator('#insight-scan-status').textContent(), /^最近檢視：/);
      await openStore(page);
      const badge = page.locator('#review [data-insight-changes="qa-qinghe"]');
      assert.equal(await badge.count(), mode === 'change' ? 1 : 0);
      assert.equal(await page.locator('#review .confirmed-insights-group').getAttribute('open'), null, 'Confirmed clues stay collapsed');
      if (mode === 'change') {
        assert.equal(await badge.innerText(), '有 1 項新變化');
        await page.screenshot({ path: path.join(outputDir, 'mac-foreground-small-badge.png') });
        await badge.click();
        const text = await page.locator('#insight-changes-body').innerText();
        assert.ok(text.includes(oldText) && text.includes(changedText), 'The compact hint opens exact old and new evidence');
        await page.screenshot({ path: path.join(outputDir, 'mac-foreground-evidence.png') });
      }
      await unchanged(t, before);
      return { encryptedSlotUnchanged: true, originalConfirmationAndHistoryUnchanged: true, tokenUnchanged: true, hiddenScans: (await scanEvents(page)).filter(event => event.hidden).length, backgroundApiRequests: 0, backgroundStatusNotPainted: true, newChanges: mode === 'change' ? 1 : 0, bundleSha256: digest(t.initialBundle) };
    }
  });
}

async function foregroundCatchup() {
  await scenario('foreground-catchup-after-timers-suspended', {
    open: () => isolated(),
    run: async t => {
      const { page } = t, before = await snapshot(page);
      await advanceAndWaitScan(page, 2500, 0);
      const calls = (await scanEvents(page)).length;
      await visibility(page, true);
      // setSystemTime advances wall time without dispatching interval callbacks.
      // This models missed timers, not real OS sleep or browser freezing.
      await page.clock.setSystemTime(new Date(initialTime.getTime() + 31 * 60 * 1000));
      assert.equal((await scanEvents(page)).length, calls);
      await visibility(page, false);
      await advanceAndWaitScan(page, 2500, calls);
      assert.equal((await scanEvents(page)).at(-1).hidden, false, 'Return to foreground catches an overdue scan');
      await unchanged(t, before);
      return { syntheticMissedTimers: true, actualOsSleepTested: false, catchupPassed: true, encryptedSlotUnchanged: true };
    }
  });
}

async function excludedBackground(device, modal) {
  const name = device + '-' + (modal || 'device') + '-background-deferred';
  await scenario(name, {
    open: () => isolated('change', device),
    run: async t => {
      const { page } = t, before = await snapshot(page);
      await advanceAndWaitScan(page, 2500, 0);
      if (modal === 'review') await openStore(page);
      if (modal === 'editor') {
        await page.locator('.rail [data-view="stores"]').click();
        await page.locator('#stores-view .more-actions summary').first().click();
        await page.locator('#stores-view [data-edit="store:qa-qinghe"]').click();
        await page.locator('#editor').waitFor({ state: 'visible' });
      }
      const calls = (await scanEvents(page)).length;
      await visibility(page, true);
      assert.equal(await page.locator('body').evaluate(node => node.classList.contains('privacy-veil')), true);
      await page.clock.fastForward(31 * 60 * 1000);
      assert.equal((await scanEvents(page)).length, calls, 'Excluded device or active modal never scans while hidden');
      assert.equal(await page.locator('#insight-scan-status').textContent(), '', 'Lock clears prior scan result instead of retaining an active scan session');
      await unchanged(t, before);
      await visibility(page, false);
      await page.locator('#workspace').waitFor({ state: 'visible' });
      if (modal) await page.locator('#' + modal + ' [data-close="' + modal + '"]').first().click();
      await advanceAndWaitScan(page, 16000, calls);
      assert.equal((await scanEvents(page)).at(-1).hidden, false);
      await unchanged(t, before);
      return { deviceIdentification: devices[device], modal: modal || null, noHiddenScan: true, foregroundResumes: true, encryptedSlotUnchanged: true, realDeviceTested: false };
    }
  });
}

async function nativeTabVisibilityProbe() {
  const t = await isolated('none', 'mac', false);
  try {
    await advanceAndWaitScan(t.page, 2500, 0);
    const before = await snapshot(t.page), calls = (await scanEvents(t.page)).length;
    const other = await t.context.newPage();
    await other.goto(origin + '/qa-blank'); await other.bringToFront();
    const hidden = await t.page.evaluate(() => document.hidden);
    if (!hidden) {
      report.nativeTabVisibility = { verified: false, reason: 'This browser run keeps both tabs visible; synthetic visibility behavior tests are reported separately.' };
      return;
    }
    assert.equal(await t.page.locator('body').evaluate(node => node.classList.contains('privacy-veil')), true);
    const hiddenStatus = await t.page.locator('#insight-scan-status').textContent(), requests = t.apiRequests.length;
    await advanceAndWaitScan(t.page, 16 * 60 * 1000, calls);
    assert.equal((await scanEvents(t.page)).at(-1).hidden, true);
    assert.equal(await t.page.locator('#insight-scan-status').textContent(), hiddenStatus);
    assert.equal(t.apiRequests.length, requests, 'Native background scan makes no API calls');
    await unchanged(t, before);
    await t.page.bringToFront();
    assert.equal(await t.page.evaluate(() => document.hidden), false);
    assert.equal(await t.page.locator('body').evaluate(node => node.classList.contains('privacy-veil')), false);
    assert.match(await t.page.locator('#insight-scan-status').textContent(), /^最近檢視：/);
    await unchanged(t, before);
    report.nativeTabVisibility = { verified: true, acceleratedClock: true, nativeVisibilityTransition: true, actualOsSleepTested: false, hiddenScanCompleted: true, encryptedSlotUnchanged: true, backgroundApiRequests: 0, backgroundStatusNotPainted: true, foregroundResumed: true, scans: await scanEvents(t.page), blockedApiRequests: t.apiRequests };
  } finally { await t.context.close(); }
}

try {
  if (!nativeOnly) {
    for (const mode of ['none', 'support', 'change']) await backgroundScan(mode);
    await foregroundCatchup();
    for (const device of ['iphone', 'ipadDesktop']) await excludedBackground(device);
    for (const modal of ['editor', 'review']) await excludedBackground('mac', modal);
  }
  await nativeTabVisibilityProbe();
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; throw error; }
finally {
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, engine, passed: report.passed, scenarios: report.scenarios.length, fictionalOnly: true, nativeOnly, nativeVisibilityVerified: report.nativeTabVisibility?.verified, syntheticVisibility: !nativeOnly, acceleratedClock: true }));
  await browser.close();
}
