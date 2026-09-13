import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomic } from '../server.mjs';
import { hash, readPackage, validateTrust } from './package.mjs';
import { download, releaseURL } from './download.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
export class UpdateEngine {
  constructor({ root, dataDir, lifecycle, fetchPackage = download, onStatus = () => {} }) {
    Object.assign(this, { root, dataDir, lifecycle, fetchPackage, onStatus });
    this.dir = path.join(dataDir, 'updates');
    this.releases = path.join(root, 'runtime', 'releases');
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.releases, { recursive: true, mode: 0o700 });
    this.file = path.join(this.dir, 'state.json');
    this.state = fs.existsSync(this.file) ? read(this.file) : { format: 1, current: 'base', previous: null, maxSequence: 0, paused: false, history: [] };
    if (this.state.format !== 1) throw new Error('更新器狀態格式不相容。');
    this.state.history ||= [];
    const trustFile = path.join(this.dir, 'trust.json');
    this.trust = fs.existsSync(trustFile) ? validateTrust(read(trustFile)) : null;
    this.status = { phase: this.trust ? 'idle' : 'unconfigured', message: this.trust ? '已設定簽章更新來源。' : '尚未設定已授權的 GitHub 發布來源；不會對外連線。', checkedAt: null, available: null };
    this.working = false; this.checking = false; this.candidate = null;
    if (this.state.pending) {
      // A crash/power loss during activation never promotes an unconfirmed build.
      this.state.current = this.state.pending.from;
      this.record('recovered', this.state.pending.version, '上次切換未完成，已使用原版程式。');
      this.state.pending = null; this.state.paused = true; this.save();
    }
  }
  save() { atomic(this.file, this.state); }
  record(result, version, message) { this.state.history.unshift({ at: new Date().toISOString(), result, version, message }); this.state.history = this.state.history.slice(0, 12); }
  version(id = this.state.current) { return read(path.join(this.location(id), 'package.json')).version; }
  location(id) {
    if (id === 'base') return this.root;
    if (typeof id !== 'string' || !/^\d+-\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(id)) throw new Error('版本位置不正確。');
    return path.join(this.releases, id);
  }
  checkedLocation(id = this.state.current) {
    const target = this.location(id);
    if (id === 'base') return target; // User-installed bootstrap is the initial trust anchor.
    if (!this.trust) throw new Error('找不到版本驗證公鑰。');
    const p = readPackage(fs.readFileSync(path.join(target, 'release.pharmaupdate')), this.trust);
    for (const f of p.files) {
      let dir = target;
      for (const part of f.path.split('/')) { dir = path.join(dir, part); if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('版本檔案出現符號連結。'); }
      if (hash(fs.readFileSync(dir)) !== f.sha256) throw new Error('版本檔案已變更，不能啟動。');
    }
    return target;
  }
  report(phase, message) { Object.assign(this.status, { phase, message }); this.onStatus(this.info()); }
  info() { return { ...this.status, appVersion: this.version(), configured: !!this.trust, repository: this.trust?.repository || null, paused: !!this.state.paused, canRollback: !!this.state.previous, history: this.state.history }; }
  async check() {
    if (!this.trust || this.state.paused || this.checking || this.working || this.candidate) return this.info();
    this.checking = true;
    this.report('checking', '正在下載並驗證程式更新；不傳送客戶資料。');
    try {
      const bytes = await this.fetchPackage(releaseURL(this.trust.repository));
      const p = readPackage(bytes, this.trust);
      this.status.checkedAt = new Date().toISOString();
      if (p.sequence <= this.state.maxSequence || !newer(p.version, this.version())) { this.report('idle', '未發現可安裝的較新版本。'); return this.info(); }
      const id = `${p.sequence}-${p.version}-${hash(bytes).slice(0, 12)}`;
      const target = this.location(id);
      if (!fs.existsSync(target)) {
        const staging = fs.mkdtempSync(path.join(this.releases, 'staging-'));
        for (const f of p.files) { const full = path.join(staging, f.path); fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 }); fs.writeFileSync(full, Buffer.from(f.content, 'base64'), { flag: 'wx', mode: 0o600 }); }
        fs.writeFileSync(path.join(staging, 'release.pharmaupdate'), bytes, { flag: 'wx', mode: 0o600 });
        fs.renameSync(staging, target);
      }
      this.checkedLocation(id);
      this.candidate = { id, version: p.version, sequence: p.sequence };
      this.status.available = p.version;
      this.report('staged', `v${p.version} 簽章與檔案驗證成功，等待安全切換。`);
    } catch (e) { this.report('error', e.message); }
    finally { this.checking = false; }
    return this.info();
  }
  async apply() {
    if (!this.candidate || this.working || this.state.paused) return;
    this.working = true;
    const next = this.candidate, from = this.state.current;
    let stopped = false;
    try {
      const prepared = await this.lifecycle.prepare();
      if (!prepared.ready) { this.report('waiting', `等待 ${prepared.waiting} 個使用中的畫面儲存或關閉，再切換程式。`); return; }
      this.checkedLocation(next.id);
      // Independent checkpoint. Ordinary snapshot retention never removes it.
      const snapshot = path.join(this.dataDir, 'snapshot.json');
      if (fs.existsSync(snapshot)) atomic(path.join(this.dir, `before-${next.id}-${randomUUID()}.pharmabackup`), { format: 'pharmacy-backup-1', envelope: read(snapshot).envelope });
      this.state.pending = { from, to: next.id, version: next.version };
      this.state.maxSequence = Math.max(this.state.maxSequence, next.sequence);
      this.save();
      this.report('activating', '資料寫入已暫停，正在測試新版服務。');
      stopped = true;
      await this.lifecycle.stop();
      await this.lifecycle.start(this.checkedLocation(next.id), { trial: true, expectedVersion: next.version });
      await this.lifecycle.health(next.version);
      // Keep pending until the trial server has been promoted. It cannot accept writes before promotion.
      await this.lifecycle.promote();
      this.state.current = next.id; this.state.previous = from; this.state.pending = null;
      this.record('installed', next.version, '簽章、檔案、HTTPS 啟動檢查通過。'); this.save();
      this.candidate = null;
      this.status.available = null;
      this.report('idle', `已切換至 v${next.version}；客戶資料與配對保留。`);
    } catch (e) {
      this.candidate = null; this.state.paused = true;
      this.state.current = from; this.state.pending = null;
      this.record('failed', next.version, '更新未完成；保留客戶資料並退回原版。');
      // Full/read-only disks must not skip cancellation or restoration of the running code.
      try { this.save(); } catch {}
      try {
        if (stopped) { await this.lifecycle.stop(); await this.lifecycle.start(this.checkedLocation(from), { trial: false, expectedVersion: this.version(from) }); }
        else await this.lifecycle.cancel();
        this.report('error', '更新未完成，已保留原版並暫停自動更新。請先查看管理頁。');
      } catch { this.report('error', '新版及原版啟動未完成；客戶資料未被還原或刪除，請重新啟動 Mac 服務。'); }
    } finally { this.working = false; }
  }
  async pause(paused) {
    if (this.working || this.checking) throw new Error('正在處理更新，請稍後再操作。');
    this.state.paused = paused; this.save();
    if (paused) await this.lifecycle.cancel();
    this.report(paused ? 'paused' : this.trust ? 'idle' : 'unconfigured', paused ? '自動更新已暫停；本機使用與同步照常。' : '已恢復更新檢查。');
  }
  async rollback() {
    if (this.working || this.checking) throw new Error('請等待目前更新操作完成。');
    if (!this.state.previous) throw new Error('目前沒有可退回的上一版。');
    this.checkedLocation(this.state.previous);
    this.candidate = { id: this.state.previous, version: this.version(this.state.previous), sequence: this.state.maxSequence };
    this.state.paused = false;
    // A requested rollback waits for editing too, and pauses subsequent automatic upgrades.
    this.rollbackRequested = true;
    await this.apply();
  }
  async tick() {
    await this.apply();
    if (this.rollbackRequested && !this.candidate && !this.working) { this.rollbackRequested = false; await this.pause(true); }
  }
}
