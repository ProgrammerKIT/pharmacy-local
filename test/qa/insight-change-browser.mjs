// Full-App acceptance using only fictional encrypted IndexedDB and an intercepted
// virtual origin. All API and external requests are blocked; no real profile or
// running App service is used. Run with an existing PLAYWRIGHT_MODULE and optional
// QA_BROWSER_EXECUTABLE. This script installs nothing.
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
assert.ok(['chromium', 'webkit', 'firefox'].includes(engine));
const browser = await playwright[engine].launch({ headless: true, ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-insight-change-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18453';
const report = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, engine, browserVersion: browser.version(), fictionalOnly: true, connectedAppService: false, persistentBrowserProfile: false, realIPhone: false, scenarios: [] };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const oldText = '小安目前在青禾店工作。';
const changedText = '小安已離職。';
const hostileText = '<img src=x onerror="window.qaInjected=true">';

async function isolated(width, mode) {
  const context = await browser.newContext({ viewport: { width, height: width === 393 ? 852 : 900 }, serviceWorkers: 'block', timezoneId: 'Asia/Taipei' });
  const page = await context.newPage(), errors = [], external = [], apiRequests = [];
  if (width === 1280 && mode === 'none') await page.clock.install({ time: Date.now() });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (url.pathname === '/qa-seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fictional insight change acceptance</title>' });
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push({ path: url.pathname, method: route.request().method() });
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Fictional isolated QA: API blocked"}' });
    }
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ contentType, body: fs.readFileSync(file) });
  });
  await page.goto(origin + '/qa-seed');
  const initialBundle = await page.evaluate(async ({ mode, oldText, changedText, hostileText }) => {
    const c = await import('/core.js'), db = await import('/db.js'), meta = c.newMeta();
    const key = await c.derive('fictional-insight-change-password-only', meta);
    let bundle = c.emptyBundle(meta.vaultId);
    const store = c.revision('store', 'qa-qinghe', { name: '青禾店', city: '虛構市', district: '測試區', address: '虛構路 1 號', channel: '', attr: '', contact: '', everyTimeMust: '' }, [], 'fictional-qa');
    store.at = '2026-10-19T01:00:00.000Z';
    const visit = c.revision('visit', 'qa-original', { store: store.entity, date: '2026-10-19', source: '虛構原始筆記', text: oldText, next: '', people: [], topics: [], attachments: [] }, [], 'fictional-qa');
    visit.at = '2026-10-19T02:00:00.000Z';
    const entry = { id: 'qa-confirmed-current-work', kind: 'relationship', level: 'source', headline: oldText, question: '虛構歷史提問，已確認後不重複要求確認。', caution: '', limitations: ['所有內容皆為虛構測試資料。'], evidence: [{ storeId: store.entity, storeIdentityKey: c.storeInsightsIdentityKey(store.data), visitId: visit.entity, revisionId: visit.id, quote: oldText, role: 'support' }] };
    store.data.preVisitInsights = { format: 'pharmacy-store-insights-1', batchId: 'qa-change-scan', generatedAt: '2026-10-20T01:00:00.000Z', sourceAsOf: '2026-10-20', entries: [entry] };
    bundle.ops.push(store, visit);
    bundle = c.applyInsightReview(bundle, c.planInsightReview(bundle, store.entity, entry.id, 'confirmed', store.id), 'fictional-qa');
    const confirmation = bundle.ops.at(-1);
    confirmation.at = '2026-10-20T02:00:00.000Z';
    confirmation.data.preVisitInsightReviews.at(-1).reviewedAt = confirmation.at;
    if (mode === 'same-text') {
      const op = c.revision('visit', visit.entity, structuredClone(visit.data), [visit.id], 'fictional-qa');
      op.at = '2026-10-22T02:00:00.000Z'; bundle.ops.push(op);
    } else if (mode !== 'none') {
      const text = mode === 'support' ? '小安目前仍在青禾店工作。' : mode === 'hostile' ? changedText.replace(/。$/, '，') + hostileText + '。' : changedText;
      const op = c.revision('visit', 'qa-new-note', { ...visit.data, date: '2026-10-22', source: '虛構新增筆記', text }, [], 'fictional-qa');
      op.at = '2026-10-22T02:00:00.000Z'; bundle.ops.push(op);
    }
    c.validateBundle(bundle);
    await db.writeLocal(await c.seal({ schema: 1, device: 'fictional-change-device', deviceName: '虛構新變化驗收', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, lastHealthAudit: new Date().toISOString(), pendingSync: { entities: [], unknown: false }, qaOnly: 'fictional-insight-change' }, key, meta, 'device'), 0, key);
    return bundle;
  }, { mode, oldText, changedText, hostileText });
  await page.goto(origin + '/');
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#insight-scan-status')?.textContent.startsWith('最近檢視：'));
  return { page, context, width, errors, external, apiRequests, initialBundle };
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
    return { revision: slot.revision, envelope: slot.envelope, payload: await c.unseal(slot.envelope, slot.unlockKey, 'device') };
  });
}
async function openStore(page) {
  await page.locator('.rail [data-view="stores"]').click();
  await page.locator('#stores-view [data-visit-brief="qa-qinghe"]').first().click();
  await page.locator('#review.visit-brief-dialog').waitFor({ state: 'visible' });
}
async function geometry(page, width, name) {
  const value = await page.evaluate(() => {
    const dialog = document.querySelector('#insight-changes-dialog[open]') || document.querySelector('#review[open]'), rect = dialog?.getBoundingClientRect();
    const body = dialog?.querySelector('#insight-changes-body, #review-body') || document.body;
    return { pageWidth: document.documentElement.scrollWidth, bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth, left: rect?.left ?? null, right: rect?.right ?? null };
  });
  assert.ok(value.pageWidth <= width + 1, `${name}: page horizontal overflow ${JSON.stringify(value)}`);
  assert.ok(value.bodyScrollWidth <= value.bodyWidth + 1, `${name}: body horizontal overflow ${JSON.stringify(value)}`);
  if (value.left !== null) assert.ok(value.left >= -1 && value.right <= width + 1, `${name}: dialog outside viewport`);
  await page.screenshot({ path: path.join(outputDir, `${name}-${width}.png`) });
  return value;
}
function assertIsolation(t) {
  assert.deepEqual(t.errors, [], 'No browser runtime errors');
  assert.deepEqual(t.external, [], 'No external-origin requests');
  assert.ok(t.apiRequests.every(request => ['GET', 'HEAD'].includes(request.method)), 'No API mutations attempted');
}
function assertMetadataPreserved(before, after) {
  const { insightChangeRead: beforeRead, ...beforePayload } = before.payload;
  const { insightChangeRead: afterRead, ...afterPayload } = after.payload;
  assert.deepEqual(afterPayload, beforePayload, 'Only local read acknowledgements may change, never bundle, dirty, token, device or sync metadata');
  for (const field of ['format', 'vaultId', 'salt', 'iterations']) assert.deepEqual(after.envelope[field], before.envelope[field], 'Database cryptographic metadata unchanged: ' + field);
}

async function quietAcceptance(width, mode) {
  const t = await isolated(width, mode), { page, context } = t;
  try {
    const before = await snapshot(page); await openStore(page);
    const group = page.locator('#review .confirmed-insights-group');
    assert.equal(await group.getAttribute('open'), null, 'Confirmed group is closed by default');
    assert.equal(await group.locator('[data-store-insight="qa-confirmed-current-work"]').isVisible(), false, 'Confirmed cards do not consume the default view');
    assert.equal(await page.locator('#review [data-insight-changes]').count(), 0, 'No unsupported alert for no news, same-text revision or supporting evidence');
    assert.equal(await page.locator('#review .insight-source-notice:visible').count(), 0);
    await group.locator(':scope > summary').click();
    const card = group.locator('[data-store-insight="qa-confirmed-current-work"]');
    assert.match(await card.innerText(), /Kit已確認/);
    assert.equal(await card.locator('details.insight-confirmed-details').getAttribute('open'), null);
    await group.locator(':scope > summary').click();
    const shape = await geometry(page, width, `quiet-${mode}`);
    let periodicRescan = false;
    if (width === 1280 && mode === 'none') {
      const status = await page.locator('#insight-scan-status').textContent();
      await page.clock.fastForward(16 * 60 * 1000);
      await page.waitForFunction(previous => {
        const current = document.querySelector('#insight-scan-status')?.textContent;
        return current?.startsWith('最近檢視：') && current !== previous;
      }, status);
      assert.equal(await page.locator('#review [data-insight-changes]').count(), 0, 'Passing time alone cannot create an alert');
      periodicRescan = true;
    }
    assert.deepEqual(await snapshot(page), before, 'Background scan and optional reading are byte-for-byte read-only');
    assert.deepEqual(before.payload.bundle, t.initialBundle); assertIsolation(t);
    report.scenarios.push({ name: `quiet-${mode}`, width, passed: true, geometry: shape, bundleSha256: digest(t.initialBundle), encryptedSlotUnchanged: true, periodicRescan, apiRequests: t.apiRequests });
  } catch (error) { await page.screenshot({ path: path.join(outputDir, `failure-${mode}-${width}.png`) }).catch(() => {}); throw error; }
  finally { await context.close(); }
}

async function changeAcceptance(width) {
  const t = await isolated(width, 'hostile'), { page, context } = t;
  try {
    const before = await snapshot(page); await openStore(page);
    const badge = page.locator('#review [data-insight-changes="qa-qinghe"]');
    assert.equal(await badge.innerText(), '有 1 項新變化');
    assert.equal(await page.locator('#review .confirmed-insights-group').getAttribute('open'), null);
    assert.equal(await page.locator('#review .confirmed-insights-group [data-store-insight="qa-confirmed-current-work"]').isVisible(), false);
    const badgeGeometry = await geometry(page, width, 'change-small-badge');
    await badge.click(); await page.locator('#insight-changes-dialog').waitFor({ state: 'visible' });
    const body = page.locator('#insight-changes-body');
    assert.match(await body.innerText(), /原來的依據/); assert.match(await body.innerText(), /新筆記/);
    assert.ok((await body.innerText()).includes(oldText)); assert.ok((await body.innerText()).includes(changedText.replace(/。$/, '')));
    assert.ok((await body.innerText()).includes(hostileText), 'Hostile markup must remain literal evidence');
    assert.equal(await body.locator('img,script').count(), 0, 'Evidence cannot create HTML elements');
    assert.equal(await page.evaluate(() => window.qaInjected === true), false);
    assert.deepEqual(await snapshot(page), before, 'Opening change comparison is read-only');
    const compareGeometry = await geometry(page, width, 'change-evidence-dialog');
    const readButton = body.locator('[data-insight-change-read]'), firstId = await readButton.getAttribute('data-insight-change-read');
    await readButton.click(); await body.getByText('已讀；相同變化不再顯示提醒。', { exact: true }).waitFor();
    const read = await snapshot(page);
    assertMetadataPreserved(before, read);
    assert.deepEqual(read.payload.insightChangeRead, { vaultId: before.payload.bundle.vaultId, ids: [firstId] });
    assert.ok(read.revision > before.revision, 'Acknowledgement persists only in encrypted local device state');
    await page.locator('#insight-changes-dialog [data-close="insight-changes-dialog"]').click();
    assert.equal(await badge.count(), 0, 'Acknowledged change disappears from compact badge');
    await page.reload(); await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#insight-scan-status')?.textContent.startsWith('最近檢視：'));
    await openStore(page); assert.equal(await badge.count(), 0, 'Reload must retain acknowledged status');
    assertMetadataPreserved(before, await snapshot(page));

    await page.goto(origin + '/qa-seed');
    await page.evaluate(async () => {
      const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
      const value = await c.unseal(slot.envelope, slot.unlockKey, 'device');
      if (value.qaOnly !== 'fictional-insight-change' || value.token) throw new Error('Not this fictional QA vault');
      const note = c.project(value.bundle).find(row => row.type === 'visit' && row.id === 'qa-new-note');
      const op = c.revision('visit', note.id, structuredClone(note.heads[0].data), [note.heads[0].id], 'fictional-qa');
      op.at = '2026-10-22T04:00:00.000Z'; value.bundle.ops.push(op); c.validateBundle(value.bundle);
      await db.writeLocal(await c.seal(value, slot.unlockKey, slot.envelope, 'device'), slot.revision, slot.unlockKey);
    });
    await page.goto(origin + '/'); await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#insight-scan-status')?.textContent.startsWith('最近檢視：'));
    await openStore(page); assert.equal(await badge.count(), 0, 'Same text in a newer source revision must not re-alert an acknowledged semantic change');

    // Only the fictional fixture changes here, while the App is not loaded.
    // This represents a new note arriving between opens, not a production write.
    await page.goto(origin + '/qa-seed');
    const changedFixture = await page.evaluate(async () => {
      const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
      const value = await c.unseal(slot.envelope, slot.unlockKey, 'device');
      if (value.qaOnly !== 'fictional-insight-change' || value.token) throw new Error('Not this fictional QA vault');
      const op = c.revision('visit', 'qa-second-change', { store: 'qa-qinghe', date: '2026-10-23', source: '虛構後續筆記', text: '小安已調到晨光店工作。', next: '', people: [], topics: [], attachments: [] }, [], 'fictional-qa');
      op.at = '2026-10-23T02:00:00.000Z'; value.bundle.ops.push(op); c.validateBundle(value.bundle);
      await db.writeLocal(await c.seal(value, slot.unlockKey, slot.envelope, 'device'), slot.revision, slot.unlockKey);
      return value.bundle;
    });
    await page.goto(origin + '/'); await page.locator('#workspace').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#insight-scan-status')?.textContent.startsWith('最近檢視：'));
    await openStore(page); assert.equal(await badge.innerText(), '有 1 項新變化', 'A different later material change must not be suppressed by the prior acknowledgement');
    await badge.click(); await page.locator('#insight-changes-dialog').waitFor({ state: 'visible' });
    assert.equal(await body.locator('[data-insight-change-read]').count(), 1);
    const secondId = await body.locator('[data-insight-change-read]').getAttribute('data-insight-change-read');
    assert.notEqual(secondId, firstId);
    assert.ok((await body.innerText()).includes('小安已調到晨光店工作。'));
    assert.deepEqual((await snapshot(page)).payload.bundle, changedFixture, 'Scanning a later new note is still read-only');
    assert.equal(await page.evaluate(() => window.qaInjected === true), false);
    const laterGeometry = await geometry(page, width, 'new-change-after-ack');
    assertIsolation(t);
    report.scenarios.push({ name: 'material-change-acknowledgement', width, passed: true, geometries: [badgeGeometry, compareGeometry, laterGeometry], bundleSha256Before: digest(before.payload.bundle), bundleSha256AfterRead: digest(read.payload.bundle), originalConfirmationUnchanged: true, originalHistoryUnchanged: true, localAcknowledgementPersists: true, sameTextRevisionDoesNotRealert: true, differentChangeShown: true, escapedEvidence: true, apiRequests: t.apiRequests, runtimeErrors: t.errors });
  } catch (error) { await page.screenshot({ path: path.join(outputDir, `failure-change-${width}.png`) }).catch(() => {}); throw error; }
  finally { await context.close(); }
}

try {
  for (const width of [1280, 393]) {
    for (const mode of ['none', 'same-text', 'support']) await quietAcceptance(width, mode);
    await changeAcceptance(width);
  }
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.stack; throw error; }
finally {
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, engine, passed: report.passed, scenarios: report.scenarios.length, fictionalOnly: true, connectedAppService: false }));
  await browser.close();
}
