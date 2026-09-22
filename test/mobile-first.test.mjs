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
  assert.match(app, /id="f-store-search"/);
  assert.match(app, /function refreshVisitStoreOptions\(/);
  assert.match(app, /data-new-visit-store=/);
  assert.match(app, /function openVisitForStore\(/);
  assert.match(app, /event\.target\.id === 'f-store-search'/);
  assert.match(app, /async function discardVisitDraft\(/);
  assert.match(app, /function openCandidateDetail\(/);
  assert.match(app, /function openCandidateOverview\(/);
  assert.match(app, /function openQuickTextEdit\(/);
  assert.match(app, /async function saveQuickTextEdit\(/);
  assert.match(app, /快速修改不能把整段文字存成空白/);
  assert.match(app, /這次只會修改這一筆拜訪的文字欄/);
  assert.match(app, /系統候選不是已確認事實/);
  assert.match(app, /確認捨棄這份未完成草稿/);
  assert.match(app, /既有門市、正式拜訪或歷史版本/);
  assert.match(html, /id="discard-draft-banner"/);
  assert.match(html, /id="discard-draft"/);
  assert.match(html, /id="quick-text-dialog"/);
  assert.match(app, /確定建立新版本/);
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

  const beforeDiscardBundle = structuredClone(restored.bundle);
  const discardedPayload = await unseal(await seal({ ...restored, draft: null }, key, meta, 'device'), key, 'device');
  assert.equal(discardedPayload.draft, null);
  assert.deepEqual(discardedPayload.bundle, beforeDiscardBundle);
  assert.equal(discardedPayload.dirty, restored.dirty);
  assert.equal(project(discardedPayload.bundle).filter(r => r.type === 'visit').length, 0);

  restored.bundle.ops.push(revision('visit', draft.id, {
    store: 'pending-store', date: draft.fields.date, source: draft.fields.source, text: draft.fields.text,
    next: '', topics: [], people: [], attachments: []
  }, [], 'phone'));
  validateBundle(restored.bundle);
  const records = project(restored.bundle), visit = records.find(r => r.type === 'visit');
  assert.equal(records.filter(r => r.type === 'visit').length, 1);
  assert.equal(relationVisitAllowed(visit, records.filter(r => r.type === 'store')), false);
});

test('quick text edit creates one new visit revision and preserves every non-text field and the original version', () => {
  const bundle = emptyBundle('quick-edit-test');
  bundle.ops.push(revision('store', 'store-1', {
    name: '虛構測試藥局', city: '台北市', district: '測試區', channel: '直營', attr: '', contact: '',
    address: '測試路 1 號', mapUrl: '', csvIdentityPending: false
  }, [], 'phone'));
  const attachmentBlob = 'a'.repeat(64), sourceBlob = 'b'.repeat(64);
  bundle.blobs[attachmentBlob] = 'AA=='; bundle.blobs[sourceBlob] = 'AQ==';
  const original = {
    store: 'store-1', date: '2026-09-22', source: 'Google Maps CSV 匯入', text: '修改前原文',
    next: '下次帶資料', topics: ['topic-x'], people: ['person-y'], attachments: [{ blob: attachmentBlob, name: 'a.pdf', mime: 'application/pdf' }],
    googleText: 'Google 最初原文', googleUpdatePending: false, sourceMissing: false,
    csvSources: [{ file: 'private.csv', line: 12, batch: 'batch-1', list: '測試', headers: ['note'], cells: ['修改前原文'], blob: sourceBlob, fingerprint: 'fp', at: '2026-09-22T00:00:00.000Z' }]
  };
  bundle.ops.push(revision('visit', 'visit-1', original, [], 'phone'));
  const before = project(bundle).find(r => r.type === 'visit');
  const beforeHead = before.heads[0];
  const edited = structuredClone(beforeHead.data);
  edited.text = '修改後原文';
  bundle.ops.push(revision('visit', 'visit-1', edited, [beforeHead.id], 'phone'));
  validateBundle(bundle);

  const after = project(bundle).find(r => r.type === 'visit');
  assert.equal(after.text, '修改後原文');
  assert.equal(after.versions.length, 2);
  for (const field of ['store', 'date', 'source', 'next', 'googleText', 'googleUpdatePending', 'sourceMissing']) {
    assert.deepEqual(after[field], original[field], field);
  }
  assert.deepEqual(after.topics, original.topics);
  assert.deepEqual(after.people, original.people);
  assert.deepEqual(after.attachments, original.attachments);
  assert.deepEqual(after.csvSources, original.csvSources);
  assert.equal(bundle.ops.find(op => op.id === beforeHead.id).data.text, '修改前原文');
});

test('SOP1 explicitly separates App daily notes from Google CSV imports and keeps retention undecided', () => {
  assert.equal(SOP1_VERSION, '1.2.1');
  assert.match(sop, /### A\. App 日常記錄/);
  assert.match(sop, /### B\. Google CSV 外部資料匯入/);
  assert.match(sop, /### C\. 同步與備份/);
  assert.match(sop, /草稿保存與「完成紀錄」分開/);
  assert.match(sop, /不得宣稱絕對零遺失/);
  assert.match(sop, /捨棄草稿/);
  assert.match(sop, /不得刪除或修改任何既有門市、正式拜訪、revision/);
  assert.match(sop, /拜訪前的記憶提示/);
  assert.match(sop, /候選不能冒充已確認需求/);
  assert.match(sop, /時間比較只使用明確的拜訪日期欄位/);
  assert.match(sop, /第一次確認只進入修改前／後的二次確認頁/);
  assert.match(sop, /快速修改不得把整段文字存成空白/);
  assert.match(sop, /門市、日期、來源、主題、人物、附件、Google 原始文字與 Source Snapshot 都不得因快速修改而改變/);
  assert.match(sop, /目前程式保留最近 30 份 Mac 自動快照/);
  assert.match(sop, /未經使用者裁定不得自行更改/);
});
