import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ROOT, defaultDataDir } from './server.mjs';
import { UpdateEngine } from './update/engine.mjs';

const lockBusy = '服務已啟動，請勿重複開啟。';

function legacySupervisorIsRunning(pid) {
  try { process.kill(pid, 0); }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
  const owner = spawnSync('/bin/ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  if (owner.status === 0 && owner.stdout.trim()) {
    return /(?:^|[\s/])supervisor\.mjs(?:\s|$)/.test(owner.stdout);
  }
  // If the process exited during inspection, there is no legacy owner.
  try { process.kill(pid, 0); }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
  throw new Error('無法核對舊服務鎖持有者，請檢查 Mac 服務。');
}

export function acquireServiceLock(dataDir) {
  const lockFile = path.join(dataDir, 'service.lock');
  // Keep the same inode across starts. The kernel drops the lock even after
  // SIGKILL. Perl locks the inherited descriptor, which Node keeps open.
  const guardFile = path.join(dataDir, 'service.lock.guard');
  const { O_CREAT, O_RDWR, O_NOFOLLOW } = fs.constants;
  const guard = fs.openSync(guardFile, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600);
  try {
    const helper = [
      'open(my $lock, "<&=3") or die $!;',
      'exit 0 if flock($lock, LOCK_EX | LOCK_NB);',
      'exit 75 if $!{EWOULDBLOCK};',
      'die $!;',
    ].join(' ');
    const attempt = spawnSync('/usr/bin/perl', ['-MFcntl=:flock', '-e', helper], {
      stdio: ['ignore', 'ignore', 'pipe', guard],
      timeout: 3000,
    });
    if (attempt.status === 75) throw new Error(lockBusy);
    if (attempt.status !== 0) throw new Error('無法取得系統服務鎖，請檢查 Mac 服務。');

    // A legacy bootstrap only understands the PID file. Keep that fence
    // while running and preserve stale copies when taking over.
    if (fs.existsSync(lockFile)) {
      const old = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      if (!Number.isSafeInteger(old.pid) || old.pid < 1) throw new Error('服務鎖定檔需要人工檢查。');
      if (old.advisory !== true && legacySupervisorIsRunning(old.pid)) throw new Error(lockBusy);
      fs.renameSync(lockFile, lockFile + '.stale-' + randomUUID());
    }
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, advisory: true }), { flag: 'wx', mode: 0o600 });
    return () => {
      try { fs.unlinkSync(lockFile); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      finally { fs.closeSync(guard); }
    };
  } catch (error) {
    fs.closeSync(guard);
    throw error;
  }
}

export async function runSupervisor({ root = ROOT, dataDir = defaultDataDir(), fetchPackage, automatic = true } = {}) {
  const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json')));
  const releaseServiceLock = acquireServiceLock(dataDir);
  let child, stopping = false, expectedExit = false, engine, timer, checkTimer;
  const pending = new Map();
  const rpc = (action, body = {}) => new Promise((resolve, reject) => {
    if (!child?.connected) { reject(new Error('本機服務尚未啟動。')); return; }
    const id = randomUUID(), timeout = setTimeout(() => { pending.delete(id); reject(new Error('本機服務回應逾時。')); }, 10000);
    pending.set(id, { resolve, reject, timeout }); child.send({ type: 'control', id, action, ...body });
  });
  const stop = async () => {
    const c = child; if (!c || c.exitCode !== null || c.signalCode !== null) return;
    expectedExit = true;
    await new Promise(resolve => {
      const force = setTimeout(() => c.kill('SIGKILL'), 10000);
      c.once('exit', () => { clearTimeout(force); resolve(); }); c.kill('SIGTERM');
    });
  };
  const start = async (target, { trial, expectedVersion }) => {
    expectedExit = false;
    child = fork(path.join(target, 'server.mjs'), [], { cwd: target, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, PHARMACY_DATA_DIR: dataDir, PHARMACY_TRIAL: trial ? '1' : '0' } });
    const c = child;
    c.on('message', message => {
      if (message.type === 'reply' && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p.timeout); message.error ? p.reject(new Error(message.error)) : p.resolve(message.value); }
      if (message.type === 'update-command') {
        const operations = { check: () => engine.check().then(() => engine.tick()), pause: () => engine.pause(true), resume: () => engine.pause(false).then(() => engine.check()).then(() => engine.tick()), rollback: () => engine.rollback() };
        Promise.resolve().then(() => operations[message.action]?.()).catch(() => engine.onStatus(engine.info()));
      }
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { c.kill('SIGTERM'); reject(new Error('新版啟動逾時。')); }, 15000);
      const exited = () => { clearTimeout(timeout); reject(new Error('服務無法啟動，可能是埠號已被占用。')); };
      c.once('exit', exited); c.once('error', exited);
      const ready = message => { if (message.type === 'ready') { clearTimeout(timeout); c.off('message', ready); c.off('exit', exited); if (message.version !== expectedVersion) reject(new Error('服務版本不符。')); else resolve(); } };
      c.on('message', ready);
    });
    c.on('exit', () => {
      if (!expectedExit && !stopping && !engine?.working) {
        // Fail closed; launchd can restart the supervisor. No blind retry/restore loop.
        console.error('本機服務意外停止；請重啟服務並檢查 Mac 管理頁。'); shutdown(1);
      }
    });
    if (engine) c.send({ type: 'update-status', value: engine.info() });
  };
  const health = expectedVersion => new Promise((resolve, reject) => {
    const authority = `localhost:${cfg.port}`;
    const req = https.get({ host: '127.0.0.1', servername: 'localhost', port: cfg.port, path: '/api/admin/health', ca: fs.readFileSync(path.join(dataDir, 'tls', 'ca.crt')), headers: { Host: authority, Origin: `https://${authority}`, 'X-Pharmacy-Client': '1', Authorization: `Bearer ${cfg.adminToken}` }, timeout: 5000 }, res => {
      const parts = []; res.on('data', b => parts.push(b)); res.on('end', () => { try { const body = JSON.parse(Buffer.concat(parts)); if (res.statusCode !== 200 || body.appVersion !== expectedVersion || !body.snapshotShapeOK) throw new Error(); resolve(); } catch { reject(new Error('HTTPS 啟動檢查未通過。')); } });
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => reject(new Error('HTTPS 啟動檢查未通過。')));
  });
  async function shutdown(code = 0) {
    if (stopping) return; stopping = true; clearInterval(timer); clearInterval(checkTimer);
    await stop();
    for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error('服務正在停止。')); } pending.clear();
    releaseServiceLock();
    process.exitCode = code;
  }
  try {
    engine = new UpdateEngine({ root, dataDir, fetchPackage, lifecycle: { start, stop, health, prepare: () => rpc('prepare'), promote: () => rpc('promote'), cancel: () => rpc('cancel') }, onStatus: value => { if (child?.connected) child.send({ type: 'update-status', value }); } });
    let initialRoot;
    try { initialRoot = engine.checkedLocation(); }
    catch (e) {
      if (!engine.state.previous) throw e;
      initialRoot = engine.checkedLocation(engine.state.previous);
      engine.state.current = engine.state.previous; engine.state.previous = null; engine.state.paused = true;
      engine.record('recovered', engine.version(), '目前版本檔案驗證未通過，已退回上一個已驗證版本。'); engine.save();
    }
    await start(initialRoot, { trial: false, expectedVersion: engine.version() });
    process.once('SIGTERM', () => shutdown()); process.once('SIGINT', () => shutdown());
    if (automatic) {
      timer = setInterval(() => engine.tick().catch(() => {}), 3000);
      checkTimer = setInterval(() => engine.check().then(() => engine.tick()).catch(() => {}), 24 * 60 * 60 * 1000);
      setTimeout(() => engine.check().then(() => engine.tick()).catch(() => {}), 1500).unref();
    }
    console.log(`程式更新器已啟動。${engine.trust ? '只向已設定的 GitHub 來源下載簽章程式。' : '尚未連接發布來源，不會對外下載。'}`);
    return { engine, shutdown };
  } catch (e) { await shutdown(1); throw e; }
}
const invokedDirectly = process.argv[1]
  && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  runSupervisor().catch(e => { console.error(`未啟動：${e.message}`); process.exitCode = 1; });
}
