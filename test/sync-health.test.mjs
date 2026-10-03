import test from 'node:test';
import assert from 'node:assert/strict';
import { dataSafetySummary, readonlyHealthAudit } from '../public/core.js';

const successful = Object.freeze({ localState: 'saved', paired: true, syncing: false, dirty: false,
  pending: Object.freeze({ count: 0, unknown: false }), lastSync: '2026-10-03T01:00:00.000Z',
  conflicts: 0, syncError: '', backupWarning: '', drafts: 0, reminderDrafts: 0 });

test('missing state never asserts local persistence or Mac receipt', () => {
  const result = dataSafetySummary();
  assert.equal(result.state, 'unknown');
  assert.match(result.detail, /本機保存尚待確認/);
  assert.doesNotMatch(result.title + result.detail, /本機已保存|Mac 已確認收到/);
});

test('successful acknowledgement requires a valid success time and no pending changes', () => {
  assert.deepEqual(dataSafetySummary(successful), { state: 'healthy', title: 'Mac 已確認收到', detail: '本機已保存 · Mac 已確認收到正式紀錄' });
  for (const lastSync of [null, '', 'invalid date', 0]) {
    const result = dataSafetySummary({ ...successful, lastSync });
    assert.equal(result.state, 'pending'); assert.match(result.title, /尚無成功/);
    assert.match(result.detail, /本機已保存.*Mac 尚無成功確認/);
  }
});

test('new formal changes cannot reuse an earlier successful Mac acknowledgement', () => {
  for (const change of [{ dirty: true }, { pending: { count: 3, unknown: false } }, { pending: { count: 0, unknown: true } }]) {
    const result = dataSafetySummary({ ...successful, ...change });
    assert.equal(result.state, 'pending'); assert.match(result.title, /等待 Mac/);
    assert.doesNotMatch(result.title + result.detail, /Mac 已確認收到/);
  }
  assert.match(dataSafetySummary({ ...successful, pending: { count: 3, unknown: false } }).detail, /3 項等待 Mac/);
  assert.match(dataSafetySummary({ ...successful, pending: { count: 9, unknown: true } }).detail, /數量待確認/);
});

test('unpaired devices do not imply Mac receipt even with a historical sync timestamp', () => {
  const result = dataSafetySummary({ ...successful, paired: false });
  assert.equal(result.state, 'action'); assert.match(result.title, /需要配對/);
  assert.match(result.detail, /本機已保存.*尚未配對 Mac/);
  assert.doesNotMatch(result.detail, /Mac 已確認收到/);
});

test('in-progress exchange is distinct from success and retains the previous failure warning', () => {
  const result = dataSafetySummary({ ...successful, syncing: true, dirty: true, syncError: 'synthetic failure' });
  assert.equal(result.state, 'syncing'); assert.match(result.title, /正在同步/);
  assert.match(result.detail, /正在與 Mac 交換.*上次同步未完成/);
  assert.doesNotMatch(result.detail, /Mac 已確認收到/);
});

test('sync failure does not mislabel successful local persistence as lost', () => {
  const result = dataSafetySummary({ ...successful, syncError: 'synthetic failure', dirty: true });
  assert.equal(result.state, 'warning'); assert.match(result.title, /同步尚未完成/);
  assert.match(result.detail, /本機已保存.*本次同步未完成/);
  assert.doesNotMatch(result.detail, /本機保存失敗|Mac 已確認收到/);
});

test('local writing and failed local saves take priority over a previous Mac receipt', () => {
  for (const [localState, state, title] of [['saving', 'pending', '正在保存本機'], ['failed', 'warning', '本機保存失敗']]) {
    const result = dataSafetySummary({ ...successful, localState });
    assert.equal(result.state, state); assert.equal(result.title, title);
    assert.doesNotMatch(result.detail, /本機已保存/);
  }
});

test('conflicts remain actionable even when all current formal versions reached Mac', () => {
  const result = dataSafetySummary({ ...successful, conflicts: 2 });
  assert.equal(result.state, 'action'); assert.equal(result.title, '2 筆衝突待核對');
  assert.match(result.detail, /Mac 已確認收到正式紀錄/);
});

test('combined failures, conflicts and backup warnings stay visible without repeating raw errors', () => {
  const result = dataSafetySummary({ ...successful, conflicts: 2, syncError: '<script>private error</script>', backupWarning: 'private backup filename', drafts: 2, reminderDrafts: 1 });
  assert.match(result.title, /2 筆衝突/); assert.match(result.detail, /本次同步未完成.*備份需檢查.*草稿 2 份僅本機（提醒 1 份）/);
  assert.doesNotMatch(JSON.stringify(result), /script|private/);
  const localFailure = dataSafetySummary({ ...successful, localState: 'failed', conflicts: 1 });
  assert.match(localFailure.title, /保存失敗/); assert.match(localFailure.detail, /1 筆衝突/);
});

test('backup concerns do not erase a successful sync or claim an unconfirmed backup exists', () => {
  const result = dataSafetySummary({ ...successful, backupWarning: true });
  assert.equal(result.state, 'warning'); assert.equal(result.title, '備份需要檢查');
  assert.match(result.detail, /Mac 已確認收到正式紀錄/);
  assert.doesNotMatch(JSON.stringify(result), /備份成功|備份已完成|快照失敗/);
});

test('reminder drafts are device-only and do not become pending formal records or Mac receipts', () => {
  const result = dataSafetySummary({ ...successful, drafts: 2, reminderDrafts: 2 });
  assert.equal(result.state, 'healthy'); assert.match(result.detail, /正式紀錄.*提醒草稿 2 份僅本機/);
  assert.doesNotMatch(result.detail, /2 項等待 Mac/);
  const unknown = dataSafetySummary({ ...successful, lastSync: null, drafts: 0, reminderDrafts: 1 });
  assert.match(unknown.detail, /尚無成功確認.*提醒草稿 1 份僅本機/);
});

test('summary does not mutate frozen inputs, create dates or depend on the current time', () => {
  const input = Object.freeze({ ...successful, pending: Object.freeze({ count: 1, unknown: false }), backupWarning: true });
  const before = JSON.stringify(input), result = dataSafetySummary(input);
  assert.deepEqual(dataSafetySummary(input), result); assert.equal(JSON.stringify(input), before);
  assert.deepEqual(Object.keys(result).sort(), ['detail', 'state', 'title']);
  result.title = 'consumer display change'; assert.equal(JSON.stringify(input), before);
});

test('existing read-only audit backup warning is suitable input without changing the audit', () => {
  const audit = readonlyHealthAudit({ now: Date.parse('2026-10-03T02:00:00Z'), lastSync: successful.lastSync, pendingCount: 0, conflicts: 0, identityPending: 0, appVersion: 'synthetic', macVersion: 'synthetic' });
  const before = JSON.stringify(audit), backupWarning = audit.checks.some(check => check.code === 'backup-age' && check.level === 'warning');
  assert.equal(dataSafetySummary({ ...successful, backupWarning }).title, '備份需要檢查');
  assert.equal(JSON.stringify(audit), before);
});
