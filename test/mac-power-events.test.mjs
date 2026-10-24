import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMacPowerEvents } from './qa/mac-power-events.mjs';

// Invented dates and sanitized transition bodies only. These fixtures contain
// no captured power logs, wake reasons, device identifiers or process names.
const epoch = iso => Date.parse(iso);
const event = (kind, iso) => ({ kind, at: epoch(iso), iso });

test('power log distinguishes actual sleep, DarkWake and full wake from wake requests', () => {
  const log = [
    '2030-04-05 08:00:00 +0800 Sleep               \tEntering Sleep state 10 secs',
    '2030-04-05 08:00:02 +0800 Wake Requests       \t[sanitized]',
    '2030-04-05 08:00:10 +0800 DarkWake            \tDarkWake from Deep Idle 45 secs',
    '2030-04-05 08:00:55 +0800 Sleep               \tEntering Sleep state 905 secs',
    '2030-04-05 08:00:56 +0800 Wake Requests       \t[sanitized]',
    '2030-04-05 08:16:00 +0800 DarkWake            \tDarkWake from Deep Idle',
    '2030-04-05 08:17:00 +0800 Wake                \tDarkWake to FullWake from Deep Idle'
  ].join('\n');
  const events = parseMacPowerEvents(log, epoch('2030-04-05T00:00:00.000Z'));
  assert.deepEqual(events, [
    event('Sleep', '2030-04-05T00:00:00.000Z'),
    event('DarkWake', '2030-04-05T00:00:10.000Z'),
    event('Sleep', '2030-04-05T00:00:55.000Z'),
    event('DarkWake', '2030-04-05T00:16:00.000Z'),
    event('Wake', '2030-04-05T00:17:00.000Z')
  ]);
  // A wake request one second after Sleep must not shorten the actual sleep
  // segment or masquerade as the resume boundary for a 15-minute due time.
  assert.equal(events[3].at - events[2].at, 905000);
});

test('power log rejects start rows, summaries and mismatched transition categories', () => {
  const log = [
    '2030-04-05 08:00:00 +0800 Start               \tWake from Deep Idle',
    '2030-04-05 08:00:01 +0800 Sleep               \tSleep/Wakes since boot: 3',
    '2030-04-05 08:00:02 +0800 Wake                \tWake Requests [sanitized]',
    '2030-04-05 08:00:03 +0800 Sleep               \tDarkWake from Deep Idle',
    '2030-04-05 08:00:04 +0800 DarkWake            \tWake from Deep Idle',
    '2030-04-05 08:00:05 +0800 Wake                \tEntering Sleep state',
    'Summary: 2030-04-05 08:00:06 +0800 Wake       \tWake from Deep Idle',
    '2030-04-05 08:00:07 +0800 Wake                \tDarkWake to FullWakefulness',
    '2030-04-05 08:00:08 +0800 Sleep               \tEntering Sleep stateful'
  ].join('\n');
  assert.deepEqual(parseMacPowerEvents(log, 0), []);
});

test('power log uses explicit UTC offsets and an inclusive cutoff without reordering rows', () => {
  const log = [
    '2030-04-05 09:59:59 +0930 Sleep\tEntering Sleep state',
    '2030-04-05 10:00:00 +0930 Wake\tWake from Deep Idle',
    '2030-04-04 20:30:00 -0400 Sleep\tEntering Sleep state',
    '2030-04-05 10:00:01 +0930 Wake\tWake from Normal Sleep'
  ].join('\r\n');
  assert.deepEqual(parseMacPowerEvents(log, epoch('2030-04-05T00:30:00.000Z')), [
    event('Wake', '2030-04-05T00:30:00.000Z'),
    event('Sleep', '2030-04-05T00:30:00.000Z'),
    event('Wake', '2030-04-05T00:30:01.000Z')
  ]);
});

test('power log ignores malformed dates and fails closed when the cutoff is invalid', () => {
  const log = [
    '2030-02-30 08:00:00 +0800 Sleep\tEntering Sleep state',
    '2030-04-05 25:00:00 +0800 Sleep\tEntering Sleep state',
    '2030-04-05 08:00:00 +0860 Sleep\tEntering Sleep state',
    '2030-04-05 08:00:00 UTC Sleep\tEntering Sleep state'
  ].join('\n');
  assert.deepEqual(parseMacPowerEvents(log, 0), []);
  assert.throws(() => parseMacPowerEvents('', NaN), /finite epoch timestamp/);
  assert.throws(() => parseMacPowerEvents('', undefined), /finite epoch timestamp/);
  assert.throws(() => parseMacPowerEvents(null, 0), /must be a string/);
});
