// Fictional browser regression. All network routes are intercepted; no formal App is contacted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = process.env.QA_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE);
const browser = await playwright.chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
});
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-idle-itinerary-'));
const origin = 'http://localhost:18459';
const report = {
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
  fictionalOnly: true,
  realIPhone: false,
  connectedFormalService: false,
  scenarios: []
};
async function scenario(width, probe = false) {
  const context = await browser.newContext({
    viewport: {
      width,
      height: width === 393 ? 852 : 1000
    },
    timezoneId: 'Asia/Taipei',
    serviceWorkers: 'block'
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push(e.message));
  let unblock,
    probeStarted = false;
  const blocked = new Promise(resolve => {
    unblock = resolve;
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) throw Error('Unexpected external request');
    if (url.pathname === '/seed') return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Fictional itinerary regression</title>'
    });
    if (url.pathname.startsWith('/api/')) {
      requests.push({
        path: url.pathname,
        method: route.request().method()
      });
      if (url.pathname === '/api/version' && probe) {
        probeStarted = true;
        await blocked;
        return route.fulfill({
          contentType: 'application/json',
          headers: {
            'X-Pharmacy-Version': report.version
          },
          body: '{"version":7}'
        });
      }
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: {
          'X-Pharmacy-Version': report.version
        },
        body: '{"error":"Fictional disconnected Mac"}'
      });
    }
    const file = path.resolve(publicDir, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file)) return route.abort();
    return route.fulfill({
      contentType: {
        '.js': 'text/javascript',
        '.html': 'text/html',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.webmanifest': 'application/manifest+json'
      }[path.extname(file)] || 'application/octet-stream',
      body: fs.readFileSync(file)
    });
  });
  await page.goto(origin + '/seed');
  const original = await page.evaluate(async probe => {
    const c = await import('/core.js'),
      db = await import('/db.js'),
      meta = c.newMeta(),
      key = await c.derive('fictional-itinerary-only', meta),
      bundle = c.emptyBundle(meta.vaultId);
    const bytes = new TextEncoder().encode('Fictional attachment original\r\n'),
      blob = await c.hashBytes(bytes);
    bundle.blobs[blob] = c.b64(bytes);
    for (const [id, label] of [['a', '虛構青禾藥局'], ['b', '虛構晨光藥局'], ['c', '虛構晴川藥局']]) {
      const store = c.addReminderTasks({
        name: label,
        city: '虛構市',
        district: '測試區',
        channel: '獨立',
        contact: '',
        attr: '',
        everyTimeMust: '保留原提醒'
      }, '保留原待辦');
      bundle.ops.push(c.revision('store', id, store, [], 'qa'));
      bundle.ops.push(c.revision('visit', 'note-' + id, {
        store: id,
        date: '2026-11-10',
        source: '合成測試',
        text: '  虛構原文 ' + id + '\r\n原始換行和空白完整保留。  ',
        next: '原下次跟進',
        topics: [],
        people: [],
        attachments: [{
          blob,
          name: 'fictional.txt',
          mime: 'text/plain'
        }]
      }, [], 'qa'));
    }
    bundle.ops.push(c.revision('person', 'person-a', {
      name: '虛構人物',
      role: '',
      desc: '保留人物原文',
      confirmed: false
    }, [], 'qa'));
    c.validateBundle(bundle);
    await db.writeLocal(await c.seal({
      schema: 1,
      device: 'qa',
      deviceName: 'Fictional-only',
      token: probe ? 'fictional-token' : null,
      bundle,
      dirty: false,
      pendingSync: {
        entities: [],
        unknown: false
      },
      serverVersion: 7,
      lastSync: new Date().toISOString(),
      lastHealthAudit: new Date().toISOString()
    }, key, meta, 'device'), 0, key);
    return bundle;
  }, probe);
  const snapshot = () => page.evaluate(async () => {
    const c = await import('/core.js'),
      db = await import('/db.js'),
      slot = await db.readLocal();
    return c.unseal(slot.envelope, slot.unlockKey, 'device');
  });
  const assertPreserved = async () => {
    const saved = (await snapshot()).bundle;
    assert.deepEqual(saved.ops.slice(0, original.ops.length), original.ops);
    assert.deepEqual(saved.blobs, original.blobs);
    const added = saved.ops.slice(original.ops.length);
    assert.ok(added.every(op => op.type === 'store' && !op.visitAttendance));
    for (const op of added) {
      const before = original.ops.find(old => old.type === 'store' && old.entity === op.entity).data;
      const after = {
        ...op.data
      };
      delete after.datePlans;
      delete after.datePlanOrder;
      assert.deepEqual(after, before);
    }
  };
  const select = async id => {
    await page.locator('[data-day-select]').click();
    await page.locator('#day-plan-dialog').waitFor({
      state: 'visible'
    });
    const count = Number((await page.locator('#day-plan-selection-count').textContent()).match(/已排 (\d+)/)[1]);
    await page.locator('[data-day-add="' + id + '"]').click();
    await page.waitForFunction(count => document.querySelector('#day-plan-selection-count').textContent === '已排 ' + (count + 1) + ' 間', count);
    await page.locator('#day-plan-dialog [data-day-close]').first().click();
  };
  try {
    await page.goto(origin + '/');
    await page.locator('#workspace').waitFor({
      state: 'visible'
    });
    if (probe) {
      for (let n = 0; n < 40 && !probeStarted; n++) await page.waitForTimeout(50);
      assert.equal(probeStarted, true, 'Hold a real requestLocal preflight while planning');
      await page.locator('#day-plan-entry [data-view="itinerary"]').click();
      await page.locator('[data-day-select]').click();
      await page.locator('#day-plan-dialog').waitFor({
        state: 'visible'
      });
      await page.locator('[data-day-add="a"]').click();
      await page.waitForFunction(() => document.querySelector('#day-plan-selection-count').textContent === '已排 1 間');
      unblock();
      await page.waitForTimeout(250);
      assert.equal(requests.some(r => r.path === '/api/snapshot'), false, 'An old probe cannot start a snapshot exchange after local planning begins');
      await page.locator('[data-day-add="b"]').click();
      await page.waitForFunction(() => document.querySelector('#day-plan-selection-count').textContent === '已排 2 間');
      await page.locator('#day-plan-dialog [data-day-close]').first().click();
      await assertPreserved();
      report.scenarios.push({
        width,
        name: 'pending-read-only-Mac-probe',
        passed: true
      });
    } else {
      await page.locator('#day-plan-entry [data-view="itinerary"]').click();
      await select('a');
      for (let n = 0; n < 3; n++) {
        await page.locator('#day-plan-content [data-visit-brief="a"]').click();
        const editor = page.locator('#review [data-inline-edit-text="note-a"]');
        await editor.click();
        await editor.evaluate(el => {
          const s = window.getSelection(),
            r = document.createRange();
          r.selectNodeContents(el);
          s.removeAllRanges();
          s.addRange(r);
        });
        await page.locator('#review [data-close="review"]').click();
        await page.locator('[data-day-select]').click();
        await page.locator('#day-plan-dialog').waitFor({
          state: 'visible'
        });
        await page.locator('#day-plan-dialog [data-day-close]').first().click();
      }
      assert.equal((await snapshot()).inlineTextDraft, undefined);
      await select('b');
      await page.locator('#day-plan-content [data-visit-brief="a"]').click();
      await page.locator('[data-start-single-store-capture]').click();
      await page.locator('[data-collapse-single-store-capture]').click();
      await page.locator('#review [data-close="review"]').click();
      await page.locator('[data-day-select]').click();
      await page.locator('#day-plan-dialog').waitFor({
        state: 'visible'
      });
      await page.locator('#day-plan-dialog [data-day-close]').first().click();
      await assertPreserved();
      await page.locator('#day-plan-content [data-visit-brief="a"]').click();
      const field = page.locator('#review [data-inline-edit-text="note-a"]');
      await field.fill('這是必須保留的最新未完成文字。');
      let draftSaved = false;
      for (let n = 0; n < 60; n++) {
        if ((await snapshot()).inlineTextDraft?.after === '這是必須保留的最新未完成文字。') {
          draftSaved = true;
          break;
        }
        await page.waitForTimeout(50);
      }
      assert.equal(draftSaved, true, 'Wait for the encrypted draft transaction to finish');
      await page.locator('#review [data-close="review"]').click();
      await page.locator('[data-day-select]').click();
      await page.waitForTimeout(160);
      assert.equal(await page.locator('#day-plan-dialog').isVisible(), false, 'A real unfinished draft stays protected');
      assert.equal((await snapshot()).inlineTextDraft.after, '這是必須保留的最新未完成文字。');
      await assertPreserved();
      await page.screenshot({
        path: path.join(out, 'protected-draft-' + width + '.png')
      });
      report.scenarios.push({
        width,
        name: 'read-select-exit-repeat-and-real-draft-protection',
        passed: true
      });
    }
    assert.deepEqual(errors, []);
  } finally {
    unblock();
    await context.close();
  }
}
try {
  for (const width of [393, 1440]) {
    await scenario(width, false);
    await scenario(width, true);
  }
  report.passed = true;
} catch (e) {
  report.passed = false;
  report.error = e.message;
  throw e;
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    outputDir: out,
    ...report
  }));
  await browser.close();
}
