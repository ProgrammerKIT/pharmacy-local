import test from 'node:test';
import assert from 'node:assert/strict';
import { readonlyHealthAudit } from '../public/core.js';

const NOW = Date.parse('2026-09-26T04:00:00.000Z');
const recent = days => new Date(NOW - days * 86400000).toISOString();

test('read-only health audit reports a healthy current device without changing its input', () => {
  const input = { pendingCount: 0, pendingUnknown: false, conflicts: 0, identityPending: 0, lastSync: recent(1), lastBackup: recent(2), appVersion: '1.5.24', macVersion: '1.5.24', now: NOW };
  const before = structuredClone(input), result = readonlyHealthAudit(input);
  assert.deepEqual(input, before);
  assert.equal(result.state, 'healthy');
  assert.equal(result.attention, 0);
  assert.equal(result.checks.length, 6);
  assert.ok(result.checks.every(check => check.level === 'ok'));
});

test('read-only health audit surfaces operational risks but never invents follow-up reminders', () => {
  const result = readonlyHealthAudit({ pendingCount: 3, pendingUnknown: false, conflicts: 2, identityPending: 4, lastSync: recent(9), lastBackup: null, appVersion: '1.5.24', macVersion: '1.5.23', now: NOW });
  assert.equal(result.state, 'attention');
  assert.equal(result.attention, 6);
  assert.match(result.checks.map(check => check.text).join('\n'), /3 筆資料等待 Mac 確認/);
  assert.match(result.checks.map(check => check.text).join('\n'), /4 間門市身分待確認/);
  assert.doesNotMatch(result.checks.map(check => check.text).join('\n'), /跟進|逾期/);
});

test('unknown legacy pending count and unavailable Mac version stay explicit', () => {
  const result = readonlyHealthAudit({ pendingCount: 0, pendingUnknown: true, conflicts: 0, identityPending: 0, lastSync: recent(1), lastBackup: recent(1), appVersion: '1.5.24', macVersion: '', now: NOW });
  assert.equal(result.state, 'attention');
  assert.equal(result.checks.find(check => check.code === 'pending-unknown').level, 'warning');
  assert.equal(result.checks.find(check => check.code === 'program').level, 'info');
});
