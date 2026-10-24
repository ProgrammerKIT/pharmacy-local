// Actual Mac lifecycle acceptance using fictional data only. No automatic sleep,
// clock/visibility/device overrides, production access, or scan forcing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMacPowerEvents } from './mac-power-events.mjs';

assert.equal(process.platform, 'darwin', 'This acceptance requires an actual Mac');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-real-mac-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const resultPath = path.join(outputDir, 'results.json'), ownerPath = path.join(outputDir, 'owner.json');
assert.ok(!fs.existsSync(resultPath) && !fs.existsSync(ownerPath), 'Use a new output directory; preserve earlier records');
const origin = 'http://localhost:18455', oldText = '小安目前在青禾店工作。', changedText = '小安已離職。';
const token = 'fictional-background-qa-token-never-real', mode = 'change';
const smokeOnly = process.env.QA_SMOKE_ONLY === '1', runId = randomUUID(), startedAt = Date.now();
const waitMinutes = Number(process.env.QA_WAIT_MINUTES || 720);
assert.ok(Number.isFinite(waitMinutes) && waitMinutes >= 16 && waitMinutes <= 1440, 'QA_WAIT_MINUTES must be between 16 and 1440');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const events = [], apiRequests = [], externalRequests = [], errors = [], lifecycle = [], transportGaps = [];
const seen = new Set();
let chrome, browser, context, browserCDP, page, instructions, endpoint, portFile;
let cleanupStarted = false, stopping = false, reconnecting = false, reconnectAttempts = 0;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-native-mac-'));
const owner = { format: 'pharmacy-isolated-mac-qa-owner-1', runId, runnerPid: process.pid, chromePid: null, profile, endpoint: null, appTargetId: null, appPageInstanceId: null, createdAt: new Date(startedAt).toISOString() };
const report = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, runId,
  startedAt: new Date(startedAt).toISOString(), fictionalOnly: true, productionConnected: false,
  persistentUserProfile: false, freshTemporaryProfile: true, clockOverridden: false,
  visibilityOverridden: false, deviceOverridden: false, scanForced: false,
  sleepCommandIssued: false, powerSettingsChanged: false, smokeOnly,
  observationWindowMinutes: waitMinutes,
  stage: 'starting', passed: null, fullPassed: false, smokePassed: false,
  nativeBackgroundVerified: false, actualSleepCatchupVerified: false, observationCoverageComplete: true };
function atomic(file, value) {
  const temporary = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function save() {
  report.lastProgressAt = new Date().toISOString();
  atomic(resultPath, { ...report, events, apiRequests, externalRequests, errors, lifecycle, transportGaps });
  atomic(ownerPath, { ...owner, stage: report.stage, updatedAt: report.lastProgressAt });
}
function note(kind, details = {}) { lifecycle.push({ kind, at: Date.now(), ...details }); save(); }
function stage(value) { report.stage = value; save(); console.log(JSON.stringify({ stage: value, outputDir, at: new Date().toISOString() })); }
function gap(kind, details = {}) {
  transportGaps.push({ kind, at: Date.now(), ...details });
  report.observationCoverageComplete = false; report.backgroundApiRequests = null;
  save();
}
function ingest(event) {
  if (!event || typeof event.pageInstanceId !== 'string' || !Number.isInteger(event.seq) || event.seq < 1) return;
  const id = event.pageInstanceId + ':' + event.seq;
  if (seen.has(id)) return;
  seen.add(id); events.push(event);
  if (event.kind === 'window-error' || event.kind === 'unhandledrejection') errors.push({ kind: event.kind, message: event.message, at: event.at });
  save();
}
function rendererObserver() {
  if (window.__qaEventBuffer) return;
  // getRandomValues also works on the temporary about:blank page created
  // before navigation; randomUUID is secure-context-only in Chrome.
  const pageInstanceId = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join(''), buffer = [];
  let seq = 0;
  window.__qaPageInstanceId = pageInstanceId;
  window.__qaEventBuffer = buffer;
  window.__qaEmit = event => {
    const record = { ...event, at: event.at ?? Date.now(), seq: ++seq, pageInstanceId,
      page: location.pathname === '/qa-instructions' ? 'instructions' : 'app' };
    buffer.push(record); // Synchronous, independent of CDP connectivity.
    try { Promise.resolve(window.__qaObserve(record)).catch(() => {}); } catch {}
    return record;
  };
  window.__qaEmit({ kind: 'document-created', hidden: document.hidden });
  document.addEventListener('visibilitychange', event => window.__qaEmit({ kind: 'visibility', hidden: document.hidden, state: document.visibilityState, trusted: event.isTrusted }));
  window.addEventListener('error', event => window.__qaEmit({ kind: 'window-error', message: event.message || 'Resource error', hidden: document.hidden }));
  window.addEventListener('unhandledrejection', event => window.__qaEmit({ kind: 'unhandledrejection', message: String(event.reason?.stack || event.reason), hidden: document.hidden }));
  document.addEventListener('DOMContentLoaded', () => {
    const status = document.getElementById('insight-scan-status');
    if (status) new MutationObserver(() => window.__qaEmit({ kind: 'scan-status', hidden: document.hidden, text: status.textContent })).observe(status, { childList: true, subtree: true, characterData: true });
  });
}
function instrumentCore(source) {
  const signature = 'export async function scanInsightChanges(bundle) {';
  assert.equal(source.split(signature).length, 2);
  return source.replace(signature, 'async function qaOriginalScanInsightChanges(bundle) {') + `
export async function scanInsightChanges(bundle) {
  const startedAt = Date.now();
  window.__qaEmit({ kind: 'scan-start', at: startedAt, hidden: document.hidden });
  const result = await qaOriginalScanInsightChanges(bundle);
  window.__qaEmit({ kind: 'scan-end', at: Date.now(), startedAt, hidden: document.hidden, changes: result.stores.reduce((n,s) => n + s.changes.length, 0) });
  return result;
}
`;
}
function instrumentApp(source) {
  const assignment = 'insightScanCache = { basis, at: Date.now(), result };';
  assert.equal(source.split(assignment).length, 2);
  return source.replace(assignment, assignment + " window.__qaEmit({ kind: 'scan-accepted', at: insightScanCache.at, hidden: document.hidden });");
}
async function routeRequest(route) {
  const url = new URL(route.request().url());
  if (url.origin !== origin) { externalRequests.push({ at: Date.now(), origin: url.origin }); save(); return route.abort(); }
  if (url.pathname === '/qa-seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>虛構資料隔離驗收</title>' });
  if (url.pathname === '/qa-instructions') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>隔離驗收｜保持此頁</title><style>body{font:24px/1.7 system-ui;max-width:850px;margin:60px auto;padding:24px;background:#eef7f6;color:#183747}h1{font-size:36px}</style><h1>Mac 真實背景／休眠隔離驗收</h1><p>此視窗只使用虛構資料，已封鎖正式服務與外部連線。</p><p>收到 Codex「已就緒」通知後，請用 Apple 選單 → 睡眠，至少 16 分鐘後喚醒並解鎖 Mac。</p><p>喚醒後先保持本說明頁，不要點回測試 App，也不要關閉此測試 Chrome。</p><p>不需輸入 App 密碼，也不需操作正式 App。</p></html>' });
  if (url.pathname.startsWith('/api/')) { apiRequests.push({ at: Date.now(), path: url.pathname, method: route.request().method() }); save(); return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated fictional acceptance: API blocked"}' }); }
  const publicDir = path.join(root, 'public'), file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
  const source = fs.readFileSync(file);
  const body = url.pathname === '/core.js' ? instrumentCore(source.toString()) : url.pathname === '/app.js' ? instrumentApp(source.toString()) : source;
  return route.fulfill({ contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[path.extname(file)] || 'application/octet-stream', body });
}
function observePage(targetPage) {
  targetPage.on('close', () => { note('page-close', { url: targetPage.url(), intentionalCleanup: cleanupStarted }); if (!cleanupStarted) gap('page-close-observed'); });
  targetPage.on('crash', () => { note('page-crash', { url: targetPage.url() }); if (!cleanupStarted) gap('page-crash'); });
  targetPage.on('pageerror', error => { errors.push({ kind: 'playwright-pageerror', message: error.message, at: Date.now() }); save(); });
}
async function connect() {
  const connectedBrowser = await chromium.connectOverCDP(endpoint, { noDefaults: true, timeout: 10000 });
  connectedBrowser.on('disconnected', () => { note('browser-disconnected', { intentionalCleanup: cleanupStarted }); if (!cleanupStarted) gap('browser-disconnected'); });
  const connectedContext = connectedBrowser.contexts()[0];
  await connectedContext.exposeBinding('__qaObserve', (_source, event) => ingest(event));
  await connectedContext.addInitScript(rendererObserver);
  await connectedContext.route('**/*', routeRequest);
  connectedContext.pages().forEach(observePage);
  connectedContext.on('page', observePage);
  return { browser: connectedBrowser, context: connectedContext, browserCDP: await connectedBrowser.newBrowserCDPSession() };
}
function ownedProcessAlive() {
  if (!chrome?.pid || chrome.exitCode !== null || chrome.signalCode !== null) return false;
  try { process.kill(chrome.pid, 0); return true; } catch { return false; }
}
async function targetId(targetPage, targetContext = context) {
  const session = await targetContext.newCDPSession(targetPage);
  try { return (await session.send('Target.getTargetInfo')).targetInfo.targetId; } finally { await session.detach().catch(() => {}); }
}
async function collectBuffersDirect() {
  const current = await page.evaluate(() => ({ pageInstanceId: window.__qaPageInstanceId, events: window.__qaEventBuffer }));
  assert.equal(current.pageInstanceId, owner.appPageInstanceId, 'Renderer document identity changed; never reload/reseed');
  current.events.forEach(ingest);
  if (instructions && !instructions.isClosed()) {
    const other = await instructions.evaluate(() => window.__qaEventBuffer || []);
    other.forEach(ingest);
  }
}
async function recoverConnection(error) {
  gap('transport-operation-failed', { message: String(error) });
  if (reconnecting) throw error;
  reconnecting = true;
  try {
    while (++reconnectAttempts <= 3) {
      note('reconnect-attempt', { attempt: reconnectAttempts });
      if (!ownedProcessAlive()) throw new Error('Owned Chrome process exited; no restart is allowed');
      assert.equal(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'), portFile, 'Owned endpoint identity changed');
      let next;
      try {
        next = await connect();
        const candidate = next.context.pages().find(p => p.url() === origin + '/');
        assert.ok(candidate, 'Original App page no longer exists');
        assert.equal(await targetId(candidate, next.context), owner.appTargetId, 'Original App target identity changed');
        assert.equal(await candidate.evaluate(() => window.__qaPageInstanceId), owner.appPageInstanceId, 'Original renderer document identity changed');
        browser = next.browser; context = next.context; browserCDP = next.browserCDP; page = candidate;
        instructions = context.pages().find(p => p.url() === origin + '/qa-instructions');
        await collectBuffersDirect();
        note('same-session-reconnected', { targetId: owner.appTargetId, pageInstanceId: owner.appPageInstanceId });
        // Recovered events are diagnostic only: API/error coverage was interrupted.
        report.reconnectedForDiagnostics = true; save(); return;
      } catch (retryError) {
        note('reconnect-failed', { attempt: reconnectAttempts, message: String(retryError) });
        // connectOverCDP browser.close only detaches this CDP connection.
        if (next) await next.browser.close().catch(() => {});
        if (/identity changed|no longer exists/.test(String(retryError))) throw retryError;
        await delay(1000);
      }
    }
    throw new Error('Limited reconnection attempts exhausted; preserve the owned profile');
  } finally { reconnecting = false; }
}
async function connected(action) {
  try { return await action(); } catch (error) {
    if (!/closed|disconnected|Target.*destroyed|ECONN|WebSocket/i.test(String(error))) throw error;
    await recoverConnection(error);
    return action();
  }
}
async function collectBuffers() { await connected(collectBuffersDirect); }
function sequenceGaps() {
  const instances = new Map();
  for (const event of events) { if (!instances.has(event.pageInstanceId)) instances.set(event.pageInstanceId, new Set()); instances.get(event.pageInstanceId).add(event.seq); }
  return [...instances].flatMap(([pageInstanceId, sequence]) => {
    const missing = []; for (let i = 1; i <= Math.max(...sequence); i++) if (!sequence.has(i)) missing.push(i);
    return missing.length ? [{ pageInstanceId, missing }] : [];
  });
}
async function snapshot() {
  return connected(() => page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
    const payload = await c.unseal(slot.envelope, slot.unlockKey, 'device');
    if (payload.qaOnly !== 'fictional-background') throw new Error('Unexpected non-fictional database');
    return { revision: slot.revision, envelope: slot.envelope, payload };
  }));
}
async function waitFor(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await connected(check)) return; await delay(250); }
  throw new Error('Timed out waiting for actual browser state');
}
function powerEvents() {
  const log = execFileSync('/usr/bin/pmset', ['-g', 'log'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return parseMacPowerEvents(log, startedAt);
}
function findCatchup(power, backgroundAt) {
  const appEvents = events.filter(e => e.pageInstanceId === owner.appPageInstanceId).sort((a,b) => a.at - b.at || a.seq - b.seq);
  for (let i = 0; i < power.length - 1; i++) {
    const sleep = power[i], resume = power[i + 1];
    if (sleep.kind !== 'Sleep' || sleep.at < backgroundAt || !['DarkWake', 'Wake'].includes(resume.kind)) continue;
    const lastScan = appEvents.filter(e => e.kind === 'scan-accepted' && e.at <= sleep.at).at(-1);
    if (!lastScan) continue;
    const dueAt = lastScan.at + 15 * 60 * 1000;
    if (!(sleep.at < dueAt && dueAt < resume.at)) continue;
    if (appEvents.some(e => e.kind === 'scan-start' && e.at > sleep.at && e.at < resume.at)) continue;
    const start = appEvents.find(e => e.kind === 'scan-start' && e.at >= resume.at);
    if (!start) { report.awaitingPostResumeScan = { resumeAt: resume.at, resumeType: resume.kind, dueAt }; continue; }
    const nextSleep = power.slice(i + 2).find(e => e.kind === 'Sleep');
    if (nextSleep && start.at >= nextSleep.at) continue;
    const end = appEvents.find(e => e.kind === 'scan-end' && e.startedAt === start.at);
    if (!end) continue;
    const nextStart = appEvents.find(e => e.kind === 'scan-start' && e.seq > start.seq);
    const accepted = appEvents.find(e => e.kind === 'scan-accepted' && e.seq > end.seq && (!nextStart || e.seq < nextStart.seq));
    if (!accepted || (nextSleep && (end.at >= nextSleep.at || accepted.at >= nextSleep.at))) continue;
    assert.ok(start.hidden && end.hidden && accepted.hidden, 'Resume scan must finish and be accepted while truly hidden');
    assert.ok(!appEvents.some(e => e.kind === 'visibility' && !e.hidden && e.at > backgroundAt && e.at <= accepted.at), 'App became foreground before catch-up');
    return { sleep, resume, resumeType: resume.kind, lastScan, dueAt, start, catchup: end, accepted,
      resumeToAcceptedMs: accepted.at - resume.at, powerPath: power.filter(e => e.at >= sleep.at && e.at <= accepted.at) };
  }
  return null;
}
const heartbeat = setInterval(() => { report.ownedChromeAlive = ownedProcessAlive(); save(); }, 10000);
save();
try {
  const stdout = fs.openSync(path.join(outputDir, 'chrome-stdout.log'), 'wx', 0o600);
  const stderr = fs.openSync(path.join(outputDir, 'chrome-stderr.log'), 'wx', 0o600);
  chrome = spawn(process.env.QA_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--user-data-dir=' + profile, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--disable-sync',
    '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', 'about:blank'
  ], { detached: true, stdio: ['ignore', stdout, stderr] });
  fs.closeSync(stdout); fs.closeSync(stderr); chrome.unref(); owner.chromePid = chrome.pid;
  chrome.on('error', error => { note('chrome-process-error', { message: String(error) }); if (!cleanupStarted) gap('chrome-process-error'); });
  chrome.on('exit', (code, signal) => { note('chrome-process-exit', { code, signal, intentionalCleanup: cleanupStarted }); if (!cleanupStarted) gap('chrome-process-exit', { code, signal }); });
  chrome.on('close', (code, signal) => note('chrome-process-close', { code, signal, intentionalCleanup: cleanupStarted }));
  note('chrome-process-started', { pid: chrome.pid });
  for (let i = 0; i < 100; i++) {
    try { portFile = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'); endpoint = 'http://127.0.0.1:' + portFile.split('\n')[0]; break; } catch {}
    await delay(100);
  }
  assert.ok(endpoint, 'Fresh isolated browser did not expose its own endpoint'); owner.endpoint = endpoint; save();
  ({ browser, context, browserCDP } = await connect());
  report.browserVersion = browser.version();
  page = context.pages()[0] || await context.newPage(); page.setDefaultTimeout(20000);
  owner.appTargetId = await targetId(page); save();
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
  owner.appPageInstanceId = await page.evaluate(() => window.__qaPageInstanceId); save();
  report.device = await page.evaluate(() => ({ platform: navigator.platform, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }));
  assert.match(report.device.platform, /^Mac/); assert.ok(report.device.maxTouchPoints <= 1);
  await waitFor(() => events.some(e => e.kind === 'scan-accepted' && e.pageInstanceId === owner.appPageInstanceId));
  await delay(800);
  const before = await snapshot(); assert.deepEqual(before.payload.bundle, initialBundle);
  report.baseline = { encryptedSlotSha256: digest(before), bundleSha256: digest(initialBundle), sourceSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'public/app.js'))).digest('hex') };
  instructions = await context.newPage(); await instructions.goto(origin + '/qa-instructions'); await instructions.bringToFront();
  await waitFor(() => page.evaluate(() => document.hidden)); await collectBuffers();
  assert.ok(events.some(e => e.pageInstanceId === owner.appPageInstanceId && e.kind === 'visibility' && e.hidden && e.trusted));
  assert.equal(await page.locator('#workspace').evaluate(node => node.hidden), false);
  assert.equal(await page.locator('body').evaluate(node => node.classList.contains('privacy-veil')), true);
  const hiddenStatus = await page.locator('#insight-scan-status').textContent(), backgroundAt = Date.now();
  report.nativeBackgroundVerified = true; report.backgroundAt = new Date(backgroundAt).toISOString();
  let matched;
  if (!smokeOnly) {
    report.sleepInstructions = 'Apple menu Sleep for at least 16 minutes, wake/unlock without selecting the App tab or closing this isolated Chrome.';
    stage('ready-for-operator-sleep');
    const deadline = Date.now() + waitMinutes * 60 * 1000;
    while (Date.now() < deadline) {
      if (fs.existsSync(path.join(outputDir, 'STOP'))) { stopping = true; throw new Error('Operator stopped isolated acceptance'); }
      report.powerEvents = powerEvents(); save(); // Save OS evidence before a possibly interrupted browser call.
      await collectBuffers();
      assert.equal(await connected(() => page.evaluate(() => document.hidden)), true, 'Keep the App tab hidden until catch-up is observed');
      matched = findCatchup(report.powerEvents, backgroundAt); save();
      if (matched) break;
      await delay(10000);
    }
    if (!matched) {
      report.inconclusiveReason = 'Observation window ended without a qualifying sleep/catch-up sequence; preserve the same isolated browser for inspection';
      throw new Error(report.inconclusiveReason);
    }
    assert.equal(await connected(() => page.locator('#insight-scan-status').textContent()), hiddenStatus, 'Do not paint background results');
    report.sleepCatchup = matched;
    stage('actual-hidden-catchup-observed');
  } else {
    stage('smoke-native-background-observed');
    await delay(1000); // No clock advancement and no sleep claim.
  }
  assert.deepEqual(await snapshot(), before, 'Encrypted slot, data, history and pairing changed');
  await connected(() => page.bringToFront()); await waitFor(() => page.evaluate(() => !document.hidden));
  if (matched) {
    const acceptedStatus = await page.locator('#insight-scan-status').textContent();
    const parts = acceptedStatus.match(/^最近檢視：(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)。/);
    assert.ok(parts, 'Foreground status must contain the accepted cache time');
    const acceptedMs = new Date(+parts[1], +parts[2]-1, +parts[3], +parts[4], +parts[5], +parts[6]).getTime();
    assert.ok(Math.abs(acceptedMs - matched.accepted.at) < 1000, 'Foreground cache must be the accepted hidden result');
    report.acceptedBackgroundResult = { status: acceptedStatus, at: acceptedMs };
  }
  await page.locator('.rail [data-view="stores"]').click();
  await page.locator('#stores-view [data-visit-brief="qa-qinghe"]').first().click();
  const badge = page.locator('#review [data-insight-changes="qa-qinghe"]');
  assert.equal(await badge.innerText(), '有 1 項新變化');
  assert.equal(await page.locator('#review .confirmed-insights-group').getAttribute('open'), null);
  await page.screenshot({ path: path.join(outputDir, smokeOnly ? 'smoke-small-hint.png' : 'actual-mac-small-hint.png') });
  await badge.click(); const evidence = await page.locator('#insight-changes-body').innerText();
  assert.ok(evidence.includes(oldText) && evidence.includes(changedText));
  await page.screenshot({ path: path.join(outputDir, smokeOnly ? 'smoke-old-new-evidence.png' : 'actual-mac-old-new-evidence.png') });
  assert.deepEqual(await snapshot(), before); await collectBuffers();
  report.sequenceGaps = sequenceGaps();
  assert.deepEqual(report.sequenceGaps, [], 'Renderer event sequence has a recording gap');
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  report.encryptedSlotUnchanged = true; report.foregroundHintAndHistoryVerified = true;
  if (transportGaps.length) {
    report.passed = false; report.inconclusiveReason = 'Transport or target interruption: recovered buffers cannot prove complete API/error coverage';
    stage('inconclusive');
  } else {
    const backgroundRequests = apiRequests.filter(r => r.at >= backgroundAt && r.at < events.filter(e => e.pageInstanceId === owner.appPageInstanceId && e.kind === 'visibility' && !e.hidden && e.at > backgroundAt).at(-1).at);
    assert.deepEqual(backgroundRequests, []); report.backgroundApiRequests = 0;
    if (smokeOnly) { report.smokePassed = true; report.passed = null; stage('smoke-passed'); }
    else { report.actualSleepCatchupVerified = true; report.fullPassed = true; report.passed = true; stage('passed'); }
  }
} catch (error) {
  report.passed = false; report.fullPassed = false; report.actualSleepCatchupVerified = false;
  report.failure = error.stack; report.failureAt = new Date().toISOString();
  if (fs.existsSync(path.join(outputDir, 'STOP'))) stopping = true;
  try { report.powerEvents = powerEvents(); } catch (powerError) { report.powerLogError = String(powerError); }
  if (report.inconclusiveReason || transportGaps.length || /closed|identity changed|no longer exists|process exited|reconnection/i.test(String(error))) {
    report.inconclusiveReason ||= 'Original browser/session or observation coverage was interrupted'; stage('inconclusive');
  } else stage(stopping ? 'stopped' : 'failed');
  process.exitCode = stopping ? 0 : 1;
} finally {
  clearInterval(heartbeat);
  const shouldClean = report.fullPassed || report.smokePassed || stopping;
  if (shouldClean) {
    cleanupStarted = true; note('intentional-cleanup-started', { reason: stopping ? 'operator-STOP' : report.smokePassed ? 'smoke-pass' : 'full-pass' });
    if (browserCDP) await browserCDP.send('Browser.close').catch(error => note('cleanup-browser-close-error', { message: String(error) }));
    for (let i = 0; i < 50 && ownedProcessAlive(); i++) await delay(100);
    if (ownedProcessAlive()) { note('intentional-owned-chrome-sigterm', { pid: chrome.pid }); chrome.kill('SIGTERM'); await delay(500); }
    if (!ownedProcessAlive()) { fs.rmSync(profile, { recursive: true, force: true }); report.profileCleaned = true; }
  } else {
    report.profilePreserved = true; report.ownedChromeAlive = ownedProcessAlive();
    note('preserving-owned-test-instance', { profile, chromePid: chrome?.pid });
    // For connectOverCDP this detaches transport only; do not send Browser.close.
    if (browser?.isConnected()) { cleanupStarted = true; await browser.close().catch(() => {}); }
  }
  save();
}
