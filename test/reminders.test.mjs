import test from 'node:test';
import assert from 'node:assert/strict';
import { NEXT_REMINDER_OPTIONS, reminderHasOption, setReminderOption } from '../public/reminders.js';

test('fixed next-reminder options match the requested choices', () => {
  assert.deepEqual([...NEXT_REMINDER_OPTIONS], ['HAUD', 'Complete', '陳列盒（中）', '陳列盒（小）']);
});

test('checking options appends independent items without rewriting existing free text', () => {
  const original = 'HAUD×1、陳列盒15cm×1';
  const withHAUD = setReminderOption(original, 'HAUD', true);
  assert.equal(withHAUD, original + '\nHAUD');
  assert.equal(setReminderOption(withHAUD, 'HAUD', true), withHAUD);
  assert.equal(setReminderOption(withHAUD, 'HAUD', false), original);
});

test('unchecking removes only an exact independent item and custom text uses the same safe path', () => {
  const original = 'Complete 之後再詢問\nComplete\n陳列盒（中）×2';
  assert.equal(reminderHasOption(original, 'Complete'), true);
  assert.equal(setReminderOption(original, 'Complete', false), 'Complete 之後再詢問\n陳列盒（中）×2');
  assert.equal(setReminderOption(original, '陳列盒（中）', false), original);
  assert.equal(setReminderOption('自由文字', '下次帶價目表', true), '自由文字\n下次帶價目表');
});
