// Synthetic scale acceptance: 209 active stores, 237 active visits, 52 zero-visit stores.
// Every complete-name search must return the expected store ID, including name collisions.
// All requests are intercepted. No real App service, real records or persistent profile.
// Reuse installed Playwright via PLAYWRIGHT_PACKAGE_JSON or PLAYWRIGHT_MODULE;
// optional QA_BROWSER_ENGINE, QA_BROWSER_EXECUTABLE, QA_OUTPUT_DIR. Installs nothing.
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
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch { throw new Error('Provide an already installed Playwright module. This script installs nothing.'); }
const engine = process.env.QA_BROWSER_ENGINE || 'chromium';
assert.ok(['chromium', 'webkit', 'firefox'].includes(engine), 'Unsupported browser engine');
const browser = await playwright[engine].launch({ headless: true, ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const outputDir = process.env.QA_OUTPUT_DIR ? path.resolve(process.env.QA_OUTPUT_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-store-discovery-scale-qa-'));
fs.mkdirSync(outputDir, { recursive: true });
const origin = 'http://localhost:18452';
const report = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, engine, browserVersion: browser.version(), fictionalOnly: true, connectedAppService: false, persistentBrowserProfile: false, realIPhone: false, lineBreakInputMethods: ['Playwright fill with CR/LF removed from raw fixture name', 'DOM input.value set to raw fixture name followed by bubbling input event'], playwrightRawFillLimitation: 'Chrome editing-based fill(raw) can replace line breaks with spaces; that separate tool behavior is not treated as an App defect or a whitespace-matching requirement.', scenarios: [] };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const singleLine = value => value.replace(/[\r\n]/g, '');
// HTML parsing normalizes source CRLF to LF without changing the saved source string.
const htmlLineEndings = value => value.replace(/\r\n?/g, '\n');

async function isolated(width, edgeCases = false) {
  const context = await browser.newContext({ viewport: { width, height: width === 393 ? 852 : 900 }, serviceWorkers: 'block', timezoneId: 'Asia/Taipei' });
  const page = await context.newPage(), errors = [], external = [], apiRequests = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
    if (url.pathname === '/qa-seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fictional 209-store discovery QA</title>' });
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push({ path: url.pathname, method: route.request().method() });
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Isolated fictional QA: no App service connected"}' });
    }
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({ contentType, body: fs.readFileSync(file) });
  });
  await page.goto(origin + '/qa-seed');
  const fixture = await page.evaluate(async edgeCases => {
    const c = await import('/core.js'), db = await import('/db.js'), meta = c.newMeta();
    const key = await c.derive('fictional-scale-discovery-qa-only', meta), bundle = c.emptyBundle(meta.vaultId);
    const stores = [], visits = [], storeId = index => `qa-scale-store-${String(index).padStart(3, '0')}`;
    const sourceNames = { 3: '虛構CSV原始有\r\n紀錄店', 160: '虛構CSV原始零\n紀錄店' };
    const bytes = new TextEncoder().encode(`Title,Note\r\n"${sourceNames[3]}",fictional original one\r\n"${sourceNames[160]}",fictional original two\r\n`), blob = await c.hashBytes(bytes);
    bundle.blobs[blob] = c.b64(bytes);
    bundle.ops.push(c.revision('source', 'qa-scale-source', { file: 'fictional-scale.csv', list: 'Fictional', blob, batch: 'qa', rows: 2, headers: ['Title', 'Note'], encoding: 'utf-8', delimiter: ',' }, [], 'qa'));
    for (let index = 0; index < 209; index++) {
      const name = index === 4 ? '虛構甲｜ \n分店' : index === 161 ? '虛構乙｜\r\n分店' : [0, 157].includes(index) ? '虛構同名甲藥局' : [158, 159].includes(index) ? '虛構同名乙藥局' : [1, 2].includes(index) ? '虛構同名丙藥局' : `虛構量級店${String(index).padStart(3, '0')}藥局`;
      const data = { name, city: '虛構市', district: '虛構區', channel: '獨立', attr: '', contact: '', everyTimeMust: '虛構每次提醒：確認方便談話', csvAliases: [`虛構來源別名${String(index).padStart(3, '0')}`], ...((index === 207 || edgeCases && index === 156) ? { csvIdentityPending: true } : {}) };
      if (sourceNames[index]) data.csvSources = [{ file: 'fictional-scale.csv', list: 'Fictional', blob, fingerprint: blob, batch: 'qa', at: '2026-10-01T00:00:00.000Z', sourceSnapshot: 'qa-scale-source', line: index === 3 ? 2 : 4, headers: ['Title', 'Note'], cells: [sourceNames[index], index === 3 ? 'fictional original one' : 'fictional original two'] }];
      const prepared = c.addReminderTasks(data, `虛構待辦${String(index).padStart(3, '0')}：帶資料小卡`);
      const initial = c.revision('store', storeId(index), prepared, [], 'qa'); bundle.ops.push(initial);
      if (index === 208) bundle.ops.push(c.revision('store', initial.entity, { ...prepared, contact: '虛構手機版本' }, [initial.id], 'phone'), c.revision('store', initial.entity, { ...prepared, contact: '虛構桌面版本' }, [initial.id], 'mac'));
      stores.push({ id: storeId(index), name, expectedVisits: index < 80 ? 2 : index < 157 ? 1 : 0, pending: index === 207, conflict: index === 208 });
      for (let sequence = 0; sequence < (index < 80 ? 2 : index < 157 ? 1 : 0); sequence++) {
        const id = `qa-scale-visit-${String(index).padStart(3, '0')}-${sequence}`;
        bundle.ops.push(c.revision('visit', id, { store: storeId(index), date: sequence ? '2026-09-30' : '2026-10-01', source: '虛構量級來源', text: `虛構量級拜訪原文 ${index}-${sequence}，只作畫面驗收。`, next: '', topics: [], people: [], attachments: [] }, [], 'qa'));
        visits.push({ id, store: storeId(index) });
      }
    }
    // Tombstones do not count toward the 209 active stores or 237 active visits.
    const deletedStore = c.revision('store', 'qa-scale-deleted-store', { name: '虛構已刪除量級藥局', city: '', district: '', channel: '', attr: '', contact: '' }, [], 'qa');
    bundle.ops.push(deletedStore, c.revision('store', deletedStore.entity, deletedStore.data, [deletedStore.id], 'qa', true));
    const deletedVisit = c.revision('visit', 'qa-scale-deleted-visit', { store: storeId(200), date: '2026-09-01', source: '虛構量級來源', text: '虛構已刪除拜訪，不可阻止有效空店顯示。', next: '', topics: [], people: [], attachments: [] }, [], 'qa');
    bundle.ops.push(deletedVisit, c.revision('visit', deletedVisit.entity, deletedVisit.data, [deletedVisit.id], 'qa', true));
    if (edgeCases) {
      for (const sequence of [1, 2]) bundle.ops.push(c.revision('visit', `qa-scale-orphan-${sequence}`, { store: 'qa-scale-missing-store', date: '2026-10-02', source: '虛構孤立來源', text: `ORPHAN_ONLY 虛構未連結門市原文 ${sequence}`, next: '', topics: [], people: [], attachments: [] }, [], 'qa'));
      const initial = c.revision('visit', 'qa-scale-association-conflict', { store: storeId(205), date: '2026-10-03', source: '虛構跨店衝突來源', text: '虛構門市歸屬衝突原文', next: '', topics: [], people: [], attachments: [] }, [], 'qa');
      const projected = c.revision('visit', initial.entity, { ...initial.data, store: storeId(205), text: '虛構手機版本指到205店' }, [initial.id], 'phone');
      const other = c.revision('visit', initial.entity, { ...initial.data, store: storeId(206), text: '虛構桌面版本指到206店' }, [initial.id], 'mac');
      projected.id = 'a-qa-scale-association-head'; other.id = 'z-qa-scale-association-head';
      bundle.ops.push(initial, projected, other);
    }
    c.validateBundle(bundle);
    const projected = c.project(bundle), activeStores = projected.filter(item => item.type === 'store' && !item.deleted), activeVisits = projected.filter(item => item.type === 'visit' && !item.deleted);
    const counts = { activeStores: activeStores.length, activeVisits: activeVisits.length, storesWithVisits: new Set(activeVisits.map(item => item.store)).size, zeroVisitStores: stores.filter(item => !item.expectedVisits).length, pendingStores: activeStores.filter(item => item.csvIdentityPending).length, conflictedStores: activeStores.filter(item => item.conflict).length, deletedStores: projected.filter(item => item.type === 'store' && item.deleted).length, deletedVisits: projected.filter(item => item.type === 'visit' && item.deleted).length };
    await db.writeLocal(await c.seal({ schema: 1, device: 'qa-scale-device', deviceName: 'Fictional Scale QA', token: null, bundle, dirty: false, serverVersion: 0, lastSync: null, lastHealthAudit: new Date().toISOString() }, key, meta, 'device'), 0, key);
    return { stores, visits, counts, bundle, edgeCases, sourceNames };
  }, edgeCases);
  await page.goto(origin + '/'); await page.locator('#workspace').waitFor({ state: 'visible' });
  return { context, page, width, errors, external, apiRequests, fixture };
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const c = await import('/core.js'), db = await import('/db.js'), slot = await db.readLocal();
    return { revision: slot.revision, envelope: slot.envelope, payload: await c.unseal(slot.envelope, slot.unlockKey, 'device') };
  });
}
async function resultIDs(page) {
  return page.locator('#visit-list > *').evaluateAll(cards => cards.map(card => {
    if (card.dataset.visitEmptyStore) return card.dataset.visitEmptyStore;
    const link = card.querySelector('.store-link');
    return link?.dataset.visitBrief || link?.dataset.nodeId || link?.dataset.review?.replace(/^store:/, '') || link?.dataset.edit?.replace(/^store:/, '') || null;
  }).filter(Boolean).sort());
}
async function rawNameInput(page, selector, rawName) {
  await page.locator(selector).fill('');
  const actualInput = await page.locator(selector).evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  }, rawName);
  assert.equal(actualInput, singleLine(rawName), 'The DOM value setter applies the browser standard single-line CR/LF sanitizer');
  return actualInput;
}
async function geometry(page, width, name) {
  const result = await page.evaluate(() => ({ pageWidth: document.documentElement.scrollWidth, listWidth: document.querySelector('#visit-list').clientWidth, listScrollWidth: document.querySelector('#visit-list').scrollWidth }));
  assert.ok(result.pageWidth <= width + 1 && result.listScrollWidth <= result.listWidth + 1, `${name}: no horizontal overflow ${JSON.stringify(result)}`);
  await page.screenshot({ path: path.join(outputDir, `${name}-${width}.png`) });
  return result;
}

async function scaleAcceptance(width) {
  const t = await isolated(width), { page, context, fixture } = t;
  try {
    const before = await snapshot(page), checks = [], geometries = [];
    assert.deepEqual(fixture.counts, { activeStores: 209, activeVisits: 237, storesWithVisits: 157, zeroVisitStores: 52, pendingStores: 1, conflictedStores: 1, deletedStores: 1, deletedVisits: 1 });
    assert.equal(await page.locator('#visit-list > *').count(), 289, 'Default view contains all 237 existing visits plus 52 zero-visit store cards');
    assert.equal(await page.locator('#visit-list [data-inline-edit-text]').count(), 237);
    const emptyIDs = await page.locator('#visit-list [data-visit-empty-store]').evaluateAll(cards => cards.map(card => card.dataset.visitEmptyStore).sort());
    assert.deepEqual(emptyIDs, fixture.stores.filter(store => !store.expectedVisits).map(store => store.id).sort(), 'All 52 zero-visit IDs must be present exactly once');
    const allIDs = new Set(await resultIDs(page));
    assert.deepEqual([...allIDs].sort(), fixture.stores.map(store => store.id).sort(), 'Default view must cover every active store ID');
    const cardOrder = await page.locator('#visit-list > *').evaluateAll(cards => cards.map(card => !!card.dataset.visitEmptyStore));
    assert.ok(cardOrder.slice(0, 237).every(empty => !empty) && cardOrder.slice(237).every(Boolean), 'All empty stores follow existing visits');
    await page.locator('#visit-list [data-visit-empty-store="qa-scale-store-157"]').scrollIntoViewIfNeeded();
    geometries.push(await geometry(page, width, 'scale-default-empty-stores'));

    // renderVisits is synchronous on the input event. Each fill dispatches input,
    // then the ID assertion reads the resulting cards, without a timing-only wait.
    const start = Date.now();
    for (const store of fixture.stores) {
      await page.locator('#visit-search').fill(singleLine(store.name));
      const actualInput = await page.locator('#visit-search').inputValue();
      assert.equal(actualInput, singleLine(store.name), 'The full-name query uses only CR/LF removal, preserving all other characters');
      const actual = [...new Set(await resultIDs(page))].sort();
      const expected = fixture.stores.filter(item => item.name === store.name).map(item => item.id).sort();
      assert.ok(actual.includes(store.id), `Full-name query must return its own ID: ${store.id} / ${store.name}; got ${actual.join(', ')}`);
      assert.deepEqual(actual, expected, `Full-name query must retain all distinct IDs with the same name: ${store.name}`);
      checks.push({ storeId: store.id, query: store.name, actualInput, expectedIDs: expected, resultIDs: actual });
    }
    const queryElapsedMs = Date.now() - start;
    const lineBreakNameChecks = [];
    for (const store of fixture.stores.filter(item => /[\r\n]/.test(item.name))) {
      await page.locator('#visit-search').fill(singleLine(store.name));
      const link = page.locator('#visit-list .store-link').first();
      const preserved = await link.locator('span[style="white-space:pre-wrap"]').first().textContent();
      const highlightedSegments = await link.locator('mark.search-match').allTextContents();
      assert.equal(preserved, htmlLineEndings(store.name), 'Name display preserves the original characters and line breaks');
      assert.deepEqual(highlightedSegments, store.name.split(/[\r\n]+/).filter(Boolean), 'A cross-line name match highlights literal segments, excluding line breaks');
      assert.match(await link.innerText(), /名稱換行已忽略/);
      const actualInput = await page.locator('#visit-search').inputValue();
      const domSanitizedInput = await rawNameInput(page, '#visit-search', store.name);
      assert.deepEqual([...new Set(await resultIDs(page))], [store.id], 'Raw DOM value assignment also discovers the right ID after browser CR/LF sanitization');
      lineBreakNameChecks.push({ storeId: store.id, originalName: store.name, actualInput, domSanitizedInput, displayedName: preserved, highlightedSegments });
      geometries.push(await geometry(page, width, store.expectedVisits ? 'scale-multiline-visited-name' : 'scale-multiline-empty-name'));
    }
    for (const query of ['虛構甲｜分店', '虛構甲| 分店']) {
      await page.locator('#visit-search').fill(query);
      assert.equal((await resultIDs(page)).includes('qa-scale-store-004'), false, 'Ignoring CR/LF must not silently ignore other spaces or full-width punctuation');
    }
    await page.locator('#visit-search').fill('分店');
    assert.deepEqual([...new Set(await resultIDs(page))], ['qa-scale-store-004', 'qa-scale-store-161']);
    assert.equal((await page.locator('#visit-list').innerText()).includes('名稱換行已忽略'), false, 'A literal hit within one line needs no cross-line explanation');
    const sourceNameChecks = [];
    for (const [index, sourceName] of Object.entries(fixture.sourceNames)) {
      const storeId = `qa-scale-store-${String(index).padStart(3, '0')}`;
      await page.locator('#visit-search').fill(singleLine(sourceName));
      assert.equal(await page.locator('#visit-search').inputValue(), singleLine(sourceName));
      const actual = [...new Set(await resultIDs(page))];
      assert.deepEqual(actual, [storeId], 'A name present only in raw CSV Title must discover the matching store ID');
      const sourceDisplay = page.locator('#visit-list span[style="white-space:pre-wrap"]').first();
      assert.equal(await sourceDisplay.textContent(), htmlLineEndings(sourceName), 'Raw CSV name display preserves the original source text and line breaks');
      const highlightedSegments = await sourceDisplay.locator('mark.search-match').allTextContents();
      assert.deepEqual(highlightedSegments, sourceName.split(/[\r\n]+/).filter(Boolean));
      assert.match(await page.locator('#visit-list').innerText(), /名稱換行已忽略/);
      const actualInput = await page.locator('#visit-search').inputValue();
      const domSanitizedInput = await rawNameInput(page, '#visit-search', sourceName);
      assert.deepEqual([...new Set(await resultIDs(page))], [storeId], 'Raw DOM assignment also discovers CSV source names containing CR/LF');
      sourceNameChecks.push({ storeId, query: sourceName, actualInput, domSanitizedInput, resultIDs: actual, highlightedSegments });
      geometries.push(await geometry(page, width, Number(index) === 3 ? 'scale-multiline-visited-source' : 'scale-multiline-empty-source'));
    }
    for (const name of ['虛構同名甲藥局', '虛構同名乙藥局', '虛構同名丙藥局']) {
      await page.locator('#visit-search').fill(name);
      assert.equal((await resultIDs(page)).length, 2, 'Same-name stores remain separate cards/groups');
      geometries.push(await geometry(page, width, name === '虛構同名甲藥局' ? 'scale-mixed-same-name' : name === '虛構同名乙藥局' ? 'scale-empty-same-name' : 'scale-visited-same-name'));
    }
    await page.locator('#visit-search').fill('虛構量級店207藥局');
    const pending = page.locator('#visit-list [data-visit-empty-store="qa-scale-store-207"]');
    assert.equal(await pending.count(), 1);
    assert.equal(await pending.locator('[data-visit-brief]').count(), 0);
    assert.equal(await pending.locator('[data-new-visit-store="qa-scale-store-207"]').count(), 1);
    assert.equal(await pending.locator('[data-edit="store:qa-scale-store-207"]').count(), 1);
    await page.locator('#visit-search').fill('虛構量級店208藥局');
    const conflict = page.locator('#visit-list [data-visit-empty-store="qa-scale-store-208"]');
    assert.equal(await conflict.count(), 1);
    assert.equal(await conflict.locator('[data-visit-brief], [data-new-visit-store], [data-store-reminder], [data-reminder-complete]').count(), 0);
    assert.ok(await conflict.locator('[data-review="store:qa-scale-store-208"]').count());
    await page.locator('#visit-search').fill('虛構已刪除量級藥局');
    assert.deepEqual(await resultIDs(page), []);
    await page.locator('#visit-search').fill('虛構量級店200藥局');
    assert.equal(await page.locator('#visit-list [data-visit-empty-store="qa-scale-store-200"]').count(), 1, 'A deleted visit cannot suppress an otherwise empty active store');
    const after = await snapshot(page);
    assert.deepEqual(after, before, 'All 209 ID-based lookups and safety checks leave encrypted bytes unchanged');
    assert.deepEqual(after.payload.bundle, fixture.bundle);
    assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []); assert.deepEqual(t.apiRequests, []);
    report.scenarios.push({ name: '209-store-full-name-id-coverage', width, height: width === 393 ? 852 : 900, counts: fixture.counts, defaultCards: 289, storeQueries: checks.length, checkedDistinctStoreIDs: new Set(checks.map(check => check.storeId)).size, matchedStoreQueries: checks.filter(check => check.resultIDs.includes(check.storeId)).length, sameNameGroups: 3, queryElapsedMs, geometries, encryptedSlotUnchanged: true, bundleSha256Before: digest(before.payload.bundle), bundleSha256After: digest(after.payload.bundle), runtimeErrors: t.errors, externalRequests: t.external, apiRequests: t.apiRequests, checks, sourceNameChecks, lineBreakNameChecks });
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, `failure-scale-${width}.png`) }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
async function edgeAcceptance(width) {
  const t = await isolated(width, true), { page, context, fixture } = t;
  try {
    const before = await snapshot(page), geometries = [];
    await page.locator('#visit-search').fill('已刪除／未命名門市');
    assert.deepEqual([...new Set(await resultIDs(page))], ['qa-scale-missing-store'], 'The visible orphan fallback name remains searchable');
    assert.equal(await page.locator('#visit-list .visit-search-group').count(), 1);
    assert.match(await page.locator('#visit-list .visit-search-group-head').innerText(), /2 筆命中 · 共 2 筆/);
    await page.locator('#visit-list .visit-search-details > summary').click();
    assert.equal(await page.locator('#visit-list [data-inline-edit-text]').count(), 2);
    assert.equal(await page.locator('#visit-list [data-new-visit-store], #visit-list [data-visit-brief]').count(), 0, 'Orphan visits cannot offer an invalid store capture');
    geometries.push(await geometry(page, width, 'edge-orphan-fallback-search'));

    await page.locator('#visit-search').fill('虛構量級店156藥局');
    assert.deepEqual([...new Set(await resultIDs(page))], ['qa-scale-store-156']);
    const addPending = page.locator('#visit-list [data-new-visit-store="qa-scale-store-156"]');
    assert.equal(await addPending.count(), 1, 'Pending store with an existing visit retains the add-visit action');
    assert.equal(await page.locator('#visit-list [data-visit-brief="qa-scale-store-156"]').count(), 0);
    await addPending.click();
    await page.locator('#editor').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#f-store').inputValue(), 'qa-scale-store-156');
    // The picker and top-level visit search both recognize raw CSV source names.
    await page.locator('#f-store-search').fill(singleLine(fixture.sourceNames[160]));
    assert.equal(await page.locator('#f-store-search').inputValue(), singleLine(fixture.sourceNames[160]));
    assert.equal(await page.locator('#f-store option[value="qa-scale-store-160"]').count(), 1);
    assert.equal(await page.locator('#f-store').inputValue(), 'qa-scale-store-156', 'Picker search does not silently change the bound pending store');
    for (const store of fixture.stores.filter(item => /[\r\n]/.test(item.name))) {
      await page.locator('#f-store-search').fill(singleLine(store.name));
      assert.equal(await page.locator('#f-store-search').inputValue(), singleLine(store.name));
      assert.equal(await page.locator(`#f-store option[value="${store.id}"]`).count(), 1, 'Picker discovers full names containing CR/LF');
      assert.equal(await page.locator('#f-store').inputValue(), 'qa-scale-store-156');
      await rawNameInput(page, '#f-store-search', store.name);
      assert.equal(await page.locator(`#f-store option[value="${store.id}"]`).count(), 1);
      assert.equal(await page.locator('#f-store').inputValue(), 'qa-scale-store-156');
    }
    await page.locator('#editor [data-close="editor"]').first().click();
    await page.locator('#editor').waitFor({ state: 'hidden' });

    await page.locator('#visit-search').fill('虛構量級店206藥局');
    const associated = page.locator('#visit-list [data-visit-empty-store="qa-scale-store-206"][data-visit-association-pending="true"]');
    assert.equal(await associated.count(), 1, 'A store referenced only by another conflict head remains discoverable as association pending');
    assert.match(await associated.innerText(), /歸屬待核對/);
    assert.equal(await associated.locator('[data-visit-brief], [data-new-visit-store], [data-store-reminder], [data-reminder-complete]').count(), 0, 'Association conflict cannot offer a blank-store quick capture or reminder edit');
    const review = associated.locator('[data-review="visit:qa-scale-association-conflict"]');
    assert.ok(await review.count());
    geometries.push(await geometry(page, width, 'edge-store-association-conflict'));
    await review.first().click();
    await page.locator('#review').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#review-title').innerText(), '比較衝突版本');
    assert.match(await page.locator('#review-body').innerText(), /2 個版本待核對/);
    await page.locator('#review [data-close="review"]').click();
    await page.locator('#review').waitFor({ state: 'hidden' });
    const after = await snapshot(page);
    assert.deepEqual(after, before, 'Orphan, pending-store and association-conflict navigation is byte-for-byte read-only');
    assert.deepEqual(t.errors, []); assert.deepEqual(t.external, []); assert.deepEqual(t.apiRequests, []);
    report.scenarios.push({ name: 'additional-discovery-edge-cases', width, height: width === 393 ? 852 : 900, additionalVisitsOutsideCore: 3, additionalPendingStoreOutsideCoreScenario: true, geometries, encryptedSlotUnchanged: true, bundleSha256Before: digest(before.payload.bundle), bundleSha256After: digest(after.payload.bundle), runtimeErrors: t.errors, externalRequests: t.external, apiRequests: t.apiRequests, checks: ['orphan-fallback-name-search', 'orphan-originals-preserved', 'pending-existing-visit-add-entry', 'pending-form-correct-store', 'picker-raw-csv-source-name-with-line-break', 'picker-multiline-store-names', 'picker-search-keeps-current-store', 'nonprojected-conflict-head-discovery', 'association-conflict-review-only'] });
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, `failure-edge-${width}.png`) }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
try {
  for (const width of [393, 1280]) { await scaleAcceptance(width); await edgeAcceptance(width); }
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.message; throw error; }
finally {
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputDir, engine, passed: report.passed, scenarios: report.scenarios.length, storeQueries: report.scenarios.reduce((sum, item) => sum + (item.storeQueries || 0), 0), fictionalOnly: true }));
  await browser.close();
}
