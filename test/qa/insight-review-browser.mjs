// Full-App human-review acceptance on an intercepted virtual origin with fictional data.
// No App service, customer data, production profile, or external site is contacted.
// Reuse installed Playwright via PLAYWRIGHT_PACKAGE_JSON or PLAYWRIGHT_MODULE.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON ? path.resolve(process.env.PLAYWRIGHT_PACKAGE_JSON) : import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch { throw new Error('Provide an already installed Playwright module. This test installs nothing.'); }
const engine = process.env.QA_BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit', 'firefox'].includes(engine));
const browser = await playwright[engine].launch({ headless: true, ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-insight-review-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18449';
const report = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, engine, browserVersion: browser.version(), realIPhone: false, realKeyboard: false, scenarios: [] };

async function isolated(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 393 ? 852 : 900 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], external = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (url.pathname === '/qa-seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fictional insight review QA</title>' });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated synthetic QA: no App service connected"}' });
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ contentType, body: fs.readFileSync(file) });
  });
  await page.addInitScript(() => {
    window.qaTextFocus = [];
    document.addEventListener('focusin', event => {
      const el = event.target;
      if (el.isContentEditable || el.matches?.('textarea,input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="range"]):not([type="color"])')) window.qaTextFocus.push({ tag: el.tagName, id: el.id });
    }, true);
  });
  await page.goto(origin + '/qa-seed');
  const initial = await page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js');
    const meta = c.newMeta(), key = await c.derive('fictional-insight-review-qa-only', meta), bundle = c.emptyBundle(meta.vaultId);
    const data = name => ({ name, city: '', district: '', channel: '', attr: '', contact: '', everyTimeMust: '虛構固定提醒' });
    const a = c.revision('store', 'qa-a', data('虛構人工審核甲店'), [], 'qa');
    const b = c.revision('store', 'qa-b', data('虛構人工審核乙店'), [], 'qa');
    const visit = (store, text) => ({ store, date: '2026-10-06', source: '虛構來源', text, next: '', topics: [], people: [], attachments: [] });
    const av = c.revision('visit', 'qa-a-note', visit('qa-a', '虛構甲藥師提到與乙藥師曾是同事。\n完整原文標記：ONLY_SYNTHETIC_TEXT。'), [], 'qa');
    const bv = c.revision('visit', 'qa-b-note', visit('qa-b', '虛構乙藥師提到認識甲藥師。'), [], 'qa');
    bundle.ops.push(a, b, av, bv);
    const evidence = [
      { storeId: a.entity, storeIdentityKey: c.storeInsightsIdentityKey(a.data), visitId: av.entity, revisionId: av.id, quote: '虛構甲藥師提到與乙藥師曾是同事。', role: 'support' },
      { storeId: b.entity, storeIdentityKey: c.storeInsightsIdentityKey(b.data), visitId: bv.entity, revisionId: bv.id, quote: '虛構乙藥師提到認識甲藥師。', role: 'support' }
    ];
    const source = { id: 'qa-relation', kind: 'relationship', level: 'source', headline: '虛構同事線索，仍由 Kit 人工審核', question: '可以確認當時是否同時任職嗎？', caution: '原文有記載不等於人工確認。', limitations: ['虛構測試；不含真實門市或人物。'], evidence };
    const inference = { ...source, id: 'qa-inference', kind: 'customer', level: 'inference', headline: '虛構需求推論，尚待查核', question: '這個需求是否仍存在？' };
    const profile = entries => ({ format: 'pharmacy-store-insights-1', batchId: 'qa-human-review', generatedAt: '2026-10-07T00:00:00.000Z', sourceAsOf: '2026-10-07', entries });
    a.data.preVisitInsights = profile([source, inference]);
    b.data.preVisitInsights = profile([source]);
    c.validateBundle(bundle);
    await db.writeLocal(await c.seal({ schema: 1, device: 'qa-device', deviceName: 'Fictional Insight Review QA', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, lastHealthAudit: new Date().toISOString() }, key, meta, 'device'), 0, key);
    return bundle;
  });
  await page.goto(origin + '/');
  await page.locator('#workspace').waitFor({ state: 'visible' });
  return { context, page, width, initial, errors, external };
}

async function snapshot(page) {
  return page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
    return { revision: slot.revision, envelope: slot.envelope, payload: await c.unseal(slot.envelope, slot.unlockKey, 'device') };
  });
}
async function stored(page, count) {
  for (let i = 0; i < 80; i++) {
    const value = await snapshot(page);
    if (value.payload.bundle.ops.length === count) return value;
    await page.waitForTimeout(75);
  }
  throw new Error('Timed out waiting for one encrypted synthetic review revision');
}
async function openStore(page, id = 'qa-a') {
  if (await page.locator('#review').isVisible()) await page.locator('#review [data-close="review"]').click();
  await page.locator('.rail [data-view="stores"]').click();
  await page.locator(`#stores-view [data-visit-brief="${id}"]`).first().click();
  await page.locator('#review.visit-brief-dialog').waitFor({ state: 'visible' });
}
const activeCard = (page, id) => page.locator(`.store-insights > [data-store-insight="${id}"]`);
async function choose(page, card, status, accept) {
  let message = '';
  page.once('dialog', async dialog => { message = dialog.message(); await (accept ? dialog.accept() : dialog.dismiss()); });
  await card.locator(`[data-insight-review="${status}"]`).click();
  assert.match(message, /只更新本店這張卡/);
  assert.match(message, /建立 1 個門市版本/);
  assert.match(message, /不修改拜訪原文或記錄實際拜訪日期/);
}
async function geometry(page, width, name) {
  const result = await page.evaluate(() => {
    const body = document.querySelector('#review-body'), dialog = document.querySelector('#review');
    const r = dialog.getBoundingClientRect();
    return { pageWidth: document.documentElement.scrollWidth, dialogLeft: r.left, dialogRight: r.right, bodyScrollWidth: body.scrollWidth, bodyClientWidth: body.clientWidth, textFocus: window.qaTextFocus };
  });
  assert.ok(result.pageWidth <= width + 1, 'The document must not overflow horizontally');
  assert.ok(result.dialogLeft >= -1 && result.dialogRight <= width + 1, 'The single-store dialog must stay within the viewport');
  assert.ok(result.bodyScrollWidth <= result.bodyClientWidth + 1, 'Review contents must wrap within the dialog');
  assert.deepEqual(result.textFocus, [], 'Reading/reviewing must never briefly focus a text input');
  await page.screenshot({ path: path.join(outputDir, `${name}-${width}.png`) });
  return result;
}
function retained(initial, current, writes) {
  assert.equal(current.ops.length, initial.ops.length + writes);
  for (const op of initial.ops) assert.deepEqual(current.ops.find(saved => saved.id === op.id), op, 'Every existing revision must remain byte-equivalent');
  assert.deepEqual(current.blobs, initial.blobs);
  assert.deepEqual(current.ops.filter(op => op.entity === 'qa-b'), initial.ops.filter(op => op.entity === 'qa-b'), 'Reviewing one store must not review another store');
  for (const op of current.ops.slice(initial.ops.length)) {
    assert.equal(op.type, 'store'); assert.equal(op.entity, 'qa-a'); assert.equal(Object.hasOwn(op, 'visitAttendance'), false);
    const { preVisitInsightReviews, ...unchanged } = op.data;
    assert.ok(preVisitInsightReviews.length);
    assert.deepEqual(unchanged, initial.ops.find(item => item.entity === 'qa-a').data, 'Only the review ledger may change');
  }
}

async function acceptance(width) {
  const t = await isolated(width), { page, context } = t;
  try {
    const before = await snapshot(page);
    await openStore(page);
    assert.equal(await page.locator('.store-insights > [data-store-insight]').count(), 2);
    assert.equal(await page.locator('.store-insights > [data-store-insight] .insight-review-status[data-status="pending"]').count(), 2);
    assert.match(await activeCard(page, 'qa-relation').innerText(), /原文有記載/);
    assert.match(await activeCard(page, 'qa-inference').innerText(), /分析推論/);
    assert.equal(await activeCard(page, 'qa-relation').locator('[data-insight-review]').count(), 3);
    await activeCard(page, 'qa-relation').locator('details > summary').first().click();
    await activeCard(page, 'qa-relation').locator('[data-insight-source="qa-a-note"] > summary').click();
    await activeCard(page, 'qa-relation').locator('[data-insight-source="qa-a-note"] pre').filter({ hasText: 'ONLY_SYNTHETIC_TEXT' }).waitFor();
    assert.match(await activeCard(page, 'qa-relation').locator('[data-insight-source="qa-a-note"] pre').innerText(), /ONLY_SYNTHETIC_TEXT/);
    assert.deepEqual(await snapshot(page), before, 'Default states and reading source evidence must be read-only');
    const initialGeometry = await geometry(page, width, 'review-default-pending');

    await choose(page, activeCard(page, 'qa-relation'), 'confirmed', false);
    assert.deepEqual(await snapshot(page), before, 'Cancelling confirmation must not write anything');
    await choose(page, activeCard(page, 'qa-relation'), 'confirmed', true);
    let current = await stored(page, t.initial.ops.length + 1);
    await activeCard(page, 'qa-relation').locator('.insight-review-status[data-status="confirmed"]').waitFor();
    retained(t.initial, current.payload.bundle, 1);
    assert.match(await activeCard(page, 'qa-relation').innerText(), /Kit已確認/);
    assert.match(await activeCard(page, 'qa-relation').innerText(), /原文有記載/);
    await openStore(page, 'qa-b');
    assert.equal(await activeCard(page, 'qa-relation').locator('.insight-review-status').innerText(), '待查核');
    await openStore(page);
    assert.equal(await activeCard(page, 'qa-relation').locator('.insight-review-status').innerText(), 'Kit已確認');

    await choose(page, activeCard(page, 'qa-relation'), 'rejected', true);
    current = await stored(page, t.initial.ops.length + 2);
    await activeCard(page, 'qa-relation').waitFor({ state: 'detached' });
    const archive = page.locator('.insight-review-archive');
    assert.equal(await archive.getAttribute('open'), null, 'Rejected cards must start inside a collapsed archive');
    assert.equal(await archive.locator('[data-store-insight="qa-relation"]').first().isVisible(), false);
    assert.equal(await page.locator('.store-insights > [data-store-insight]').count(), 1);
    retained(t.initial, current.payload.bundle, 2);
    const rejectedGeometry = await geometry(page, width, 'review-rejected-hidden');
    await archive.locator(':scope > summary').click();
    const rejectedCard = archive.locator(':scope > [data-store-insight="qa-relation"]');
    assert.equal(await rejectedCard.locator('.insight-review-status').innerText(), '不符合');
    await page.locator('[data-insight-detail="review-events"] > summary').click();
    assert.equal(await page.locator('.insight-review-event').count(), 2);
    const archiveGeometry = await geometry(page, width, 'review-retained-history');

    await choose(page, rejectedCard, 'pending', true);
    current = await stored(page, t.initial.ops.length + 3);
    await activeCard(page, 'qa-relation').locator('.insight-review-status[data-status="pending"]').waitFor();
    retained(t.initial, current.payload.bundle, 3);
    assert.equal(await page.locator('.insight-review-event').count(), 3, 'Restoring pending must retain the rejection and confirmation history');
    assert.equal(await page.locator('.insight-review-archive > [data-store-insight]').count(), 0);
    await choose(page, activeCard(page, 'qa-inference'), 'confirmed', true);
    current = await stored(page, t.initial.ops.length + 4);
    await activeCard(page, 'qa-inference').locator('.insight-review-status[data-status="confirmed"]').waitFor();
    assert.match(await activeCard(page, 'qa-inference').innerText(), /分析推論/);
    retained(t.initial, current.payload.bundle, 4);

    await page.reload(); await page.locator('#workspace').waitFor({ state: 'visible' }); await openStore(page);
    assert.equal(await activeCard(page, 'qa-relation').locator('.insight-review-status').innerText(), '待查核');
    assert.equal(await activeCard(page, 'qa-inference').locator('.insight-review-status').innerText(), 'Kit已確認');
    assert.match(await activeCard(page, 'qa-inference').innerText(), /分析推論/);
    assert.equal(await page.locator('.insight-review-archive').getAttribute('open'), null);
    current = await snapshot(page); retained(t.initial, current.payload.bundle, 4);
    const reopenedGeometry = await geometry(page, width, 'review-reopened');
    assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []);
    report.scenarios.push({ width, passed: true, writes: 4, initialGeometry, rejectedGeometry, archiveGeometry, reopenedGeometry, checks: ['read-only-default-pending', 'source-evidence-distinct-from-human-review', 'cancel-no-write', 'explicit-confirm-save', 'other-store-unchanged', 'rejected-hidden-in-collapsed-archive', 'retained-review-history', 'restore-pending', 'save-reload', 'original-revisions-unchanged', 'no-attendance-created', 'no-horizontal-overflow', 'no-text-autofocus', 'no-external-requests', 'no-page-errors'] });
  } finally { await context.close(); }
}

try {
  for (const width of [393, 1280]) await acceptance(width);
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack || String(error); throw error;
} finally {
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); console.log(JSON.stringify({ passed: report.passed, scenarios: report.scenarios.length, outputDir }));
}
