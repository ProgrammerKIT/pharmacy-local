import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { emptyBundle, revision, project, validateBundle, newMeta, derive, seal, unseal } from '../public/core.js';
import { storeIdentityPending, relationVisitAllowed } from '../public/relations.js';
import { SOP1_VERSION } from '../public/csv.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const sop = fs.readFileSync(new URL('../SOP1.md', import.meta.url), 'utf8');

test('mobile-first runtime files are valid JavaScript and expose the daily capture contract', () => {
  for (const file of ['public/app.js', 'public/core.js', 'public/csv.js']) {
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  }
  assert.match(app, /function scheduleVisitDraftSave\(/);
  assert.match(app, /function flushVisitDraft\(/);
  assert.match(app, /function resumeVisitDraft\(/);
  assert.match(app, /draftState\('儲存中…'/);
  assert.match(app, /draftState\('已存於本機/);
  assert.match(app, /draftState\('儲存失敗：/);
  assert.match(app, /await flushVisitDraft\(\)/);
  assert.match(app, /identity.*待確認|身分待確認/);
  assert.match(html, /最近使用的門市/);
  assert.match(html, /手機已保存/);
  assert.match(html, /Mac 已確認收到/);
  assert.match(html, /不假設仍會持續同步/);
});

test('a local draft survives encryption without creating a formal visit revision', async () => {
  const bundle = emptyBundle('mobile-first-test');
  bundle.ops.push(revision('store', 'pending-store', {
    name: '虛構待確認藥局', city: '', district: '', channel: '', attr: '', contact: '',
    address: '', mapUrl: '', csvIdentityPending: true
  }, [], 'phone'));
  validateBundle(bundle);
  const before = project(bundle);
  assert.equal(before.filter(r => r.type === 'visit').length, 0);
  assert.equal(storeIdentityPending(before.find(r => r.type === 'store')), true);

  const draft = {
    format: 'visit-draft-1', savedAt: '2026-09-21T01:00:00.000Z', id: 'draft-visit', parents: [], baseData: null,
    fields: { store: 'pending-store', date: '2026-09-21', source: '現場觀察', text: '未完成草稿', next: '', topics: [], people: [], keepAttachments: [], newStoreName: '', newStoreDistrict: '', newStoreMapUrl: '', newStorePending: true }
  };
  const payload = { schema: 1, device: 'phone', deviceName: '測試 iPhone', token: null, bundle, dirty: false, serverVersion: 6, lastSync: null, draft };
  const meta = newMeta(), key = await derive('mobile-first-test-password', meta);
  const restored = await unseal(await seal(payload, key, meta, 'device'), key, 'device');
  assert.deepEqual(restored.draft, draft);
  assert.equal(project(restored.bundle).filter(r => r.type === 'visit').length, 0);

  restored.bundle.ops.push(revision('visit', draft.id, {
    store: 'pending-store', date: draft.fields.date, source: draft.fields.source, text: draft.fields.text,
    next: '', topics: [], people: [], attachments: []
  }, [], 'phone'));
  validateBundle(restored.bundle);
  const records = project(restored.bundle), visit = records.find(r => r.type === 'visit');
  assert.equal(records.filter(r => r.type === 'visit').length, 1);
  assert.equal(relationVisitAllowed(visit, records.filter(r => r.type === 'store')), false);
});

test('SOP1 explicitly separates App daily notes from Google CSV imports and keeps retention undecided', () => {
  assert.equal(SOP1_VERSION, '1.1.0');
  assert.match(sop, /### A\. App 日常記錄/);
  assert.match(sop, /### B\. Google CSV 外部資料匯入/);
  assert.match(sop, /### C\. 同步與備份/);
  assert.match(sop, /草稿保存與「完成紀錄」分開/);
  assert.match(sop, /不得宣稱絕對零遺失/);
  assert.match(sop, /目前程式保留最近 30 份 Mac 自動快照/);
  assert.match(sop, /未經使用者裁定不得自行更改/);
});
