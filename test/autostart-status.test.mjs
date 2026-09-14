import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectAutostart } from '../server.mjs';

const fixture = { platform: 'darwin', uid: 501, parentPid: 1234, managed: true, exists: () => true };
test('autostart confirms only a running launchd job that owns this supervisor', async () => {
  const calls = [];
  const run = async args => { calls.push(args); return args[0] === 'print-disabled' ? '"local.pharmacy.cs.notes" => false' : 'state = running\npid = 1234\n'; };
  const result = await inspectAutostart({ ...fixture, run });
  assert.equal(result.state, 'running');
  assert.deepEqual(calls, [['print-disabled', 'gui/501'], ['print', 'gui/501/local.pharmacy.cs.notes']]);
  assert.ok(!JSON.stringify(result).includes('1234'));
  assert.equal((await inspectAutostart({ ...fixture, parentPid: 5678, run })).state, 'loaded');
  assert.equal((await inspectAutostart({ ...fixture, managed: false, run })).state, 'loaded');
});

test('missing, disabled, and unloaded login jobs produce different repair guidance without mutations', async () => {
  let calls = 0;
  const absent = await inspectAutostart({ ...fixture, exists: () => false, run: async () => { calls++; } });
  assert.equal(absent.state, 'unconfigured'); assert.equal(calls, 0);
  const disabled = await inspectAutostart({ ...fixture, run: async args => { assert.equal(args[0], 'print-disabled'); return '"local.pharmacy.cs.notes" => true'; } });
  assert.equal(disabled.state, 'disabled');
  const unloaded = await inspectAutostart({ ...fixture, run: async args => {
    if (args[0] === 'print-disabled') return '';
    assert.equal(args[0], 'print');
    throw Object.assign(new Error('Bad request'), { stderr: 'Could not find service "local.pharmacy.cs.notes"' });
  } });
  assert.equal(unloaded.state, 'not-loaded'); assert.match(unloaded.message, /05-Enable-Autostart/);
});

test('launchctl errors and unsupported environments remain unknown without exposing raw diagnostics', async () => {
  const failed = await inspectAutostart({ ...fixture, run: async () => { throw Object.assign(new Error('/private/fictional-sensitive-path'), { stderr: 'operation timed out' }); } });
  assert.equal(failed.state, 'unknown'); assert.ok(!JSON.stringify(failed).includes('fictional-sensitive-path'));
  let calls = 0;
  assert.equal((await inspectAutostart({ ...fixture, platform: 'linux', run: async () => { calls++; } })).state, 'unsupported');
  assert.equal(calls, 0);
});
