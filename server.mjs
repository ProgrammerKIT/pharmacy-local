import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { checkEnvelope } from './public/core.js';
import { APP_VERSION } from './public/version.js';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const defaultDataDir = () => process.env.PHARMACY_DATA_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'PharmacyLocal-CS');
const digest = s => createHash('sha256').update(s).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function atomic(file, value) {
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  try { const dir = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(dir); fs.closeSync(dir); } catch {}
}
// One atomic snapshot replacement is the cutover. Old device tokens are scoped
// to the previous rebuild id; a crash cannot leave an empty, unbound server.
export function rebuildSnapshot(dataDir, snapshot, body, write = atomic) {
  if (body?.confirmation !== '清空全部資料' || !/^[a-f0-9-]{36}$/.test(body.operationId || '')) throw Object.assign(new Error('請確認清空全部資料。'), { status: 400 });
  checkEnvelope(body.envelope);
  if (snapshot.rebuild?.id === body.operationId && JSON.stringify(snapshot.envelope) === JSON.stringify(body.envelope)) return snapshot;
  if (body.expectedVersion !== snapshot.version) throw Object.assign(new Error('資料在確認期間已更新，請重新整理後再重建。'), { status: 409 });
  const retired = [...new Set([...(snapshot.retiredVaults || []), ...(snapshot.envelope ? [snapshot.envelope.vaultId] : [])])];
  if (retired.includes(body.envelope.vaultId)) throw Object.assign(new Error('重建必須使用全新資料庫；舊備份不能成為新庫。'), { status: 409 });
  const at = new Date().toISOString(), archive = `rebuild-${body.operationId}.pharmabackup`;
  if (snapshot.envelope) {
    const dir = path.join(dataDir, 'archives'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    write(path.join(dir, archive), { format: 'pharmacy-backup-1', envelope: snapshot.envelope });
  }
  const next = { version: snapshot.version + 1, envelope: body.envelope, retiredVaults: retired, rebuild: { id: body.operationId, at, archive: snapshot.envelope ? archive : null } };
  write(path.join(dataDir, 'snapshot.json'), next);
  return next;
}
// Separate ciphertext-only recovery schedule. It never opens, rewrites or rotates
// the live database, its credentials, ordinary snapshots, or device pairing.
const RECOVERY_WEEK = 7 * 24 * 60 * 60 * 1000;
const RECOVERY_OFFSET = 8 * 60 * 60 * 1000;
const recoveryId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const recoveryError = (message, status = 400) => Object.assign(new Error(message), { status });
export function recoverySchedule(now, { weekday = 5, hour = 21, minute = 0 } = {}) {
  const value = Number(now), local = new Date(value + RECOVERY_OFFSET);
  if (!Number.isFinite(value) || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw recoveryError('備份排程不正確。');
  let due = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - RECOVERY_OFFSET - ((local.getUTCDay() - weekday + 7) % 7) * 86400000;
  if (due > value) due -= RECOVERY_WEEK;
  return { latest: new Date(due).toISOString(), next: new Date(due + RECOVERY_WEEK).toISOString() };
}
// Unlike the ordinary snapshot helper, failure to sync either file or directory
// is an explicit recovery failure; a successful record requires readback too.
export function durableRecoveryAtomic(file, value) {
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
    const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function createScheduledRecoveryStore({ dataDir, getSnapshot, now = Date.now, write = durableRecoveryAtomic } = {}) {
  const directory = path.join(dataDir, 'scheduled-recovery-backups'), stateFile = path.join(directory, 'state.json');
  let state = { format: 'pharmacy-scheduled-recovery-1', config: null, records: [], lastSuccess: null, lastError: null }, stage = null, startupFailure = false, transientError = null;
  const filenameOK = name => typeof name === 'string' && /^recovery-[a-f0-9-]{36}-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-v\d+-[a-f0-9]{64}\.pharmabackup$/i.test(name);
  const source = () => { const snapshot = getSnapshot(); return { snapshot, version: snapshot?.version ?? 0, sha256: snapshot?.envelope ? digest(JSON.stringify(snapshot.envelope)) : null }; };
  const sameSource = (candidate, current) => !!candidate && !!current.snapshot.envelope && candidate.sourceVersion === current.version && candidate.sourceSha256 === current.sha256 && current.snapshot.envelope.vaultId === state.config?.vaultId;
  const stagePath = () => path.join(directory, `staged-${state.config.id}.json`);
  const ensureDirectory = () => {
    const existed = fs.existsSync(directory); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!existed) { const parentFd = fs.openSync(dataDir, 'r'); try { fs.fsyncSync(parentFd); } finally { fs.closeSync(parentFd); } }
  };
  const persist = next => { ensureDirectory(); write(stateFile, next); const bytes = fs.readFileSync(stateFile, 'utf8'); if (bytes !== JSON.stringify(next)) throw recoveryError('備份狀態落盤核對失敗。', 503); state = next; };
  const safeFailure = (code, message) => {
    transientError = { at: new Date(now()).toISOString(), code, message };
    try { persist({ ...state, lastError: transientError }); } catch { /* keep the in-memory failure visible even if state storage is unavailable */ }
  };
  try {
    if (fs.existsSync(stateFile)) {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (saved.format !== state.format || !Array.isArray(saved.records) || saved.records.some(record => !filenameOK(record.name)) || (saved.config && (!recoveryId(saved.config.id) || saved.config.timeZone !== 'Asia/Taipei' || !Number.isFinite(Date.parse(saved.config.createdAt))))) throw new Error('invalid recovery state');
      if (saved.config) recoverySchedule(now(), saved.config);
      state = saved;
      if (state.config && fs.existsSync(stagePath())) {
        try { stage = JSON.parse(fs.readFileSync(stagePath(), 'utf8')); }
        catch { transientError = { at: new Date(now()).toISOString(), code: 'stage-unreadable', message: '暫存備份無法讀取，請開啟已設定備份的裝置重新準備；原有備份保留。' }; }
      }
    }
  } catch { startupFailure = true; transientError = { at: new Date(now()).toISOString(), code: 'state-unreadable', message: '排程備份狀態無法讀取；原有備份保留，尚未繼續寫入。' }; }
  const dueInfo = () => {
    if (!state.config) return { due: false, dueAt: null, nextDueAt: null };
    const scheduled = recoverySchedule(now(), state.config), initial = !state.lastSuccess || state.lastSuccess.configId !== state.config.id;
    const dueAt = initial ? (scheduled.latest >= state.config.createdAt ? scheduled.latest : state.config.createdAt) : (scheduled.latest > state.lastSuccess.dueAt ? scheduled.latest : null);
    return { due: !!dueAt, dueAt, nextDueAt: scheduled.next };
  };
  const inspect = () => {
    const current = source(), timing = dueInfo(), error = transientError || state.lastError;
    return {
      config: state.config ? { id: state.config.id, weekday: state.config.weekday, hour: state.config.hour, minute: state.config.minute, timeZone: 'Asia/Taipei', vaultId: state.config.vaultId, recoveryMeta: state.config.recoveryMeta ? { ...state.config.recoveryMeta } : null } : null,
      status: startupFailure || error ? 'failed' : !state.config ? 'unconfigured' : timing.due ? 'waiting-current-copy' : 'success',
      ...timing, lastSuccess: state.lastSuccess ? { ...state.lastSuccess } : null, lastError: error ? { ...error } : null,
      sourceVersion: current.version, sourceSha256: current.sha256,
      stage: stage ? { sourceVersion: stage.sourceVersion, sourceSha256: stage.sourceSha256 } : null,
    };
  };
  const tick = () => {
    if (startupFailure || !state.config) return inspect();
    const timing = dueInfo(); if (!timing.due) return inspect();
    const current = source();
    if (!sameSource(stage, current)) return inspect();
    try {
      // Re-read the staged file after restart/on every promotion; memory alone
      // is never evidence of a valid durable copy.
      const savedStage = JSON.parse(fs.readFileSync(stagePath(), 'utf8'));
      checkEnvelope(savedStage.envelope);
      const backup = { format: 'pharmacy-backup-1', envelope: savedStage.envelope }, hash = digest(JSON.stringify(backup));
      if (savedStage.configId !== state.config.id || !sameSource(savedStage, current) || savedStage.sha256 !== hash || savedStage.envelope.vaultId !== state.config.vaultId || savedStage.envelope.salt !== state.config.recoveryMeta?.salt || savedStage.envelope.iterations !== state.config.recoveryMeta?.iterations || savedStage.envelope.salt === current.snapshot.envelope.salt) throw recoveryError('暫存備份核對失敗。', 409);
      const name = `recovery-${state.config.id}-${timing.dueAt.replace(/[:.]/g, '-')}-v${current.version}-${hash}.pharmabackup`, file = path.join(directory, name);
      // A retry after file commit but before state commit reuses the exact file;
      // it never overwrites or removes an earlier recovery backup.
      if (!fs.existsSync(file)) write(file, backup);
      if (digest(fs.readFileSync(file)) !== hash) throw recoveryError('備份檔案落盤核對失敗。', 503);
      const savedFd = fs.openSync(file, 'r'); try { fs.fsyncSync(savedFd); } finally { fs.closeSync(savedFd); }
      const dirFd = fs.openSync(directory, 'r'); try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
      const record = { name, configId: state.config.id, at: new Date(now()).toISOString(), dueAt: timing.dueAt, sourceVersion: current.version, sourceSha256: current.sha256, sha256: hash };
      persist({ ...state, records: state.records.some(item => item.name === name) ? state.records : [...state.records, record], lastSuccess: record, lastError: null });
      transientError = null;
    } catch { safeFailure('write-failed', '自動備份未完成：無法寫入或核對備份檔案。請檢查 Mac 儲存空間；服務會再重試。'); }
    return inspect();
  };
  const configure = body => {
    if (startupFailure) throw recoveryError('排程備份狀態無法讀取，原有備份保留。', 503);
    if (!body || !Object.hasOwn(body, 'expectedConfigId') || body.expectedConfigId !== (state.config?.id || null)) throw recoveryError('備份設定已由另一個畫面更新，請重新整理。', 409);
    if (!recoveryId(body.configId) || body.configId === state.config?.id || body.enabled !== true || typeof body.vaultId !== 'string') throw recoveryError('備份設定不正確。');
    recoverySchedule(now(), body);
    const current = source();
    if (!current.snapshot.envelope || current.snapshot.envelope.vaultId !== body.vaultId) throw recoveryError('請先同步目前資料庫後再設定備份。', 409);
    try {
      if (!body.recoveryMeta || Object.keys(body.recoveryMeta).some(key => !['salt', 'iterations'].includes(key))) throw new Error('invalid recovery metadata');
      checkEnvelope({ ...current.snapshot.envelope, salt: body.recoveryMeta.salt, iterations: body.recoveryMeta.iterations });
      if (body.recoveryMeta.salt === current.snapshot.envelope.salt) throw new Error('live encryption reused');
    } catch { throw recoveryError('請使用已驗證備份的獨立加密設定。'); }
    const next = { ...state, config: { id: body.configId, weekday: body.weekday, hour: body.hour, minute: body.minute, timeZone: 'Asia/Taipei', vaultId: body.vaultId, createdAt: new Date(now()).toISOString(), recoveryMeta: { salt: body.recoveryMeta.salt, iterations: body.recoveryMeta.iterations } }, lastSuccess: null, lastError: null };
    try { persist(next); } catch { safeFailure('config-write-failed', '備份設定無法保存，請檢查 Mac 儲存空間後重試。'); throw recoveryError('備份設定無法保存，請檢查 Mac 儲存空間後重試。', 503); }
    stage = null; transientError = null; return inspect();
  };
  const acceptStage = body => {
    if (startupFailure) throw recoveryError('排程備份狀態無法讀取，原有備份保留。', 503);
    if (!state.config || body?.configId !== state.config.id) throw recoveryError('備份設定已變更，請重新整理。', 409);
    const current = source();
    if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion !== current.version || body.sourceSha256 !== current.sha256 || !current.snapshot.envelope || current.snapshot.envelope.vaultId !== state.config.vaultId) throw recoveryError('同步資料在準備期間已更新，請重新準備備份。', 409);
    try { checkEnvelope(body.envelope); if (Object.keys(body.envelope).some(key => !['format', 'vaultId', 'salt', 'iterations', 'iv', 'ciphertext'].includes(key))) throw new Error('unexpected envelope property'); } catch { throw recoveryError('加密備份格式不正確。'); }
    const { envelope } = body, hash = digest(JSON.stringify({ format: 'pharmacy-backup-1', envelope }));
    if (typeof body.sha256 !== 'string' || !equal(hash, body.sha256) || envelope.vaultId !== state.config.vaultId || envelope.salt === current.snapshot.envelope.salt || envelope.salt !== state.config.recoveryMeta?.salt || envelope.iterations !== state.config.recoveryMeta?.iterations) throw recoveryError('備份雜湊或獨立加密設定不符。', 409);
    const nextStage = { configId: state.config.id, sourceVersion: current.version, sourceSha256: current.sha256, envelope, sha256: hash };
    try {
      ensureDirectory(); write(stagePath(), nextStage);
      if (fs.readFileSync(stagePath(), 'utf8') !== JSON.stringify(nextStage)) throw new Error('stage readback failed');
      stage = nextStage;
      if (state.lastError) persist({ ...state, lastError: null });
      transientError = null;
    } catch { safeFailure('stage-write-failed', '暫存備份無法保存或核對，請檢查 Mac 儲存空間；尚未完成本次備份。'); throw recoveryError('暫存備份無法保存或核對，尚未完成本次備份。', 503); }
    return tick();
  };
  const download = name => {
    const record = state.records.find(item => item.name === name);
    if (!filenameOK(name) || !record) throw recoveryError('找不到已完成的復原備份。', 404);
    const bytes = fs.readFileSync(path.join(directory, name));
    if (digest(bytes) !== record.sha256) throw recoveryError('備份檔案核對失敗，請保留原檔並檢查儲存空間。', 503);
    return bytes;
  };
  return { status: inspect, configure, stage: acceptStage, tick, download };
}
export const isLoopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
export function isPrivate(address = '') {
  const ip = address.replace(/^::ffff:/, '');
  if (isLoopback(address)) return true;
  if (/^(fc|fd|fe[89ab])/i.test(ip) && ip.includes(':')) return true;
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every(x => Number.isInteger(x) && x >= 0 && x <= 255) && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254));
}
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
async function json(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('需要 JSON 請求。'), { status: 415 });
  const chunks = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > 36 * 1024 * 1024) throw Object.assign(new Error('資料超過同步上限。'), { status: 413 }); chunks.push(part); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('請求格式不正確。'), { status: 400 }); }
}

// Read-only launchd inspection. Return only status, never paths, PIDs or raw command output.
export async function inspectAutostart({
  platform = process.platform, uid = process.getuid?.(), parentPid = process.ppid, managed = !!process.send,
  exists = fs.existsSync,
  run = args => new Promise((resolve, reject) => execFile('/bin/launchctl', args, { encoding: 'utf8', timeout: 1500, maxBuffer: 65536 }, (error, stdout, stderr) => { if (error) { error.stderr = stderr; reject(error); } else resolve(stdout); })),
} = {}) {
  const label = 'local.pharmacy.cs.notes', reply = (state, message) => ({ state, message });
  if (platform !== 'darwin') return reply('unsupported', '此檢查僅適用 Mac；目前無法確認登入自動啟動。');
  if (!Number.isSafeInteger(uid) || uid < 1) return reply('unknown', '無法確認目前登入使用者，請從自己的 Mac 帳號開啟管理頁。');
  if (!exists(path.join(os.homedir(), 'Library', 'LaunchAgents', label + '.plist'))) return reply('unconfigured', '未找到登入啟動設定。請從原安裝資料夾執行 05-Enable-Autostart.command。');
  const domain = 'gui/' + uid;
  try {
    const disabled = await run(['print-disabled', domain]);
    if (/"local\.pharmacy\.cs\.notes"\s*=>\s*true/.test(disabled)) return reply('disabled', '登入啟動項目已被停用。請在 Mac 系統設定檢查登入項目與背景執行權限。');
    const info = await run(['print', domain + '/' + label]);
    const pid = Number(info.match(/^\s*pid = (\d+)\s*$/m)?.[1]);
    if (/^\s*state = running\s*$/m.test(info) && pid > 0 && managed && pid === parentPid) return reply('running', '登入啟動項目已載入，且正在管理目前的 Mac 服務。');
    return reply('loaded', '登入啟動項目已載入，但尚未確認它正在管理目前服務；請依下方指引檢查。');
  } catch (error) {
    if (/Could not find service/i.test(String(error.stderr || ''))) return reply('not-loaded', '已有設定檔，但登入啟動項目尚未載入。請從原安裝資料夾執行 05-Enable-Autostart.command。');
    return reply('unknown', '暫時無法讀取登入啟動狀態；不代表服務已停用。請稍後重新整理。');
  }
}

export function createService({ dataDir = defaultDataDir(), host = '0.0.0.0', port, trial = false, updateCommand = null } = {}) {
  process.umask(0o077);
  const configPath = path.join(dataDir, 'config.json');
  let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const snapshotFile = path.join(dataDir, 'snapshot.json');
  let snapshot = fs.existsSync(snapshotFile) ? JSON.parse(fs.readFileSync(snapshotFile, 'utf8')) : { version: 0, envelope: null };
  if (snapshot.envelope) checkEnvelope(snapshot.envelope);
  const deviceActive = device => !snapshot.rebuild || device.rebuildId === snapshot.rebuild.id;
  const scheduledRecovery = createScheduledRecoveryStore({ dataDir, getSnapshot: () => snapshot });
  let pairing = null;
  let generation = null, updateStatus = { configured: false, phase: 'unconfigured', appVersion: APP_VERSION, message: '請以 02-Start 啟動更新管理服務。' };
  const activity = new Map();
  let startupCache = null, startupCheckedAt = 0, startupPending = null;
  const startupStatus = async () => {
    if (startupCache && Date.now() - startupCheckedAt < 10000) return startupCache;
    if (!startupPending) startupPending = inspectAutostart({ managed: !!updateCommand }).then(value => { startupCache = value; startupCheckedAt = Date.now(); return value; }).finally(() => { startupPending = null; });
    return startupPending;
  };
  let lastUpdateRequest = 0;
  const checkUpdates = () => { if (updateCommand && Date.now() - lastUpdateRequest > 60000) { lastUpdateRequest = Date.now(); updateCommand('check'); } };
  const prune = () => { for (const [id, v] of activity) if (Date.now() - v.at > 30000) activity.delete(id); };
  const prepare = () => { generation ||= randomUUID(); prune(); const waiting = [...activity.values()].filter(v => v.busy || v.generation !== generation).length; return { ready: waiting === 0, waiting }; };
  const failures = new Map();
  fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true, mode: 0o700 });
  const saveConfig = () => atomic(configPath, config);
  const server = https.createServer({ key: fs.readFileSync(path.join(dataDir, 'tls', 'server.key')), cert: fs.readFileSync(path.join(dataDir, 'tls', 'server.crt')), minVersion: 'TLSv1.2' }, async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Pharmacy-Version', APP_VERSION);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()');
    try {
      if (!isPrivate(req.socket.remoteAddress)) return send(403, { error: '只接受本機與私人區域網路連線。' });
      const authority = String(req.headers.host || '').toLowerCase();
      const name = authority.replace(/:\d+$/, '');
      if (!['localhost', '127.0.0.1', config.hostname.toLowerCase()].includes(name)) return send(403, { error: '主機名稱不符。' });
      const url = new URL(req.url, `https://${authority}`);
      if (trial && url.pathname !== '/api/admin/health') return send(503, { error: '新版啟動檢查中，請稍候。本機資料仍保留。' });
      if (url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin, fetchSite = req.headers['sec-fetch-site'];
        // Chromium may omit Origin on same-origin GET. The custom header still forces
        // cross-origin browser callers through a CORS preflight, which this service denies.
        if ((origin && origin !== `https://${authority}`) || (fetchSite && !['same-origin', 'none'].includes(fetchSite)) || req.headers['x-pharmacy-client'] !== '1') return send(403, { error: '請從本機 App 操作。' });
        const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
        if (url.pathname.startsWith('/api/admin/')) {
          if (!isLoopback(req.socket.remoteAddress) || !equal(token, config.adminToken)) return send(403, { error: '請在 Mac 開啟管理頁面。' });
          if (url.pathname === '/api/admin/status' && req.method === 'GET') return send(200, { hostname: config.hostname, version: snapshot.version, appVersion: APP_VERSION, rebuild: snapshot.rebuild ? { id: snapshot.rebuild.id, at: snapshot.rebuild.at, hasBackup: !!snapshot.rebuild.archive } : null, update: updateStatus, service: { running: true, supervised: !!updateCommand, autostart: await startupStatus() }, devices: config.devices.filter(deviceActive).map(({ id, label, created }) => ({ id, label, created })), backups: fs.readdirSync(path.join(dataDir, 'backups')).filter(n => n.endsWith('.pharmabackup')).length });
          if (url.pathname === '/api/admin/health' && req.method === 'GET') {
            if (snapshot.envelope) checkEnvelope(snapshot.envelope);
            for (const f of ['index.html', 'app.js', 'sw.js', 'version.js', 'update-client.js']) if (!fs.statSync(path.join(ROOT, 'public', f)).size) throw new Error('程式檔案不完整。');
            return send(200, { appVersion: APP_VERSION, snapshotShapeOK: true, trial });
          }
          if (url.pathname === '/api/admin/update' && req.method === 'POST') {
            const body = await json(req);
            if (!updateCommand) return send(503, { error: '請用 02-Start 啟動新版更新管理服務。' });
            if (!['check', 'pause', 'resume', 'rollback'].includes(body.action)) return send(400, { error: '更新操作不正確。' });
            if (['activating', 'checking'].includes(updateStatus.phase)) return send(409, { error: '目前更新操作尚未完成，請稍候。' });
            updateCommand(body.action); return send(202, { ok: true });
          }
          if (generation && req.method !== 'GET') return send(503, { error: '程式即將更新，請稍候再配對或管理裝置。' });
          if (url.pathname === '/api/admin/rebuild' && req.method === 'POST') {
            const body = await json(req);
            if (generation || ['activating', 'checking'].includes(updateStatus.phase)) return send(503, { error: '程式正在更新，請完成後再重建。' });
            snapshot = rebuildSnapshot(dataDir, snapshot, body); pairing = null; activity.clear();
            return send(200, { version: snapshot.version, rebuild: snapshot.rebuild });
          }
          if (url.pathname === '/api/admin/rebuild-backup' && req.method === 'GET') {
            if (!snapshot.rebuild?.archive || !/^rebuild-[a-f0-9-]{36}\.pharmabackup$/.test(snapshot.rebuild.archive)) return send(404, { error: '沒有本次重建前的備份。' });
            return send(200, JSON.parse(fs.readFileSync(path.join(dataDir, 'archives', snapshot.rebuild.archive), 'utf8')));
          }
          if (url.pathname === '/api/admin/code' && req.method === 'POST') { await json(req); const code = randomBytes(16).toString('base64url'); pairing = { hash: digest(code), expiry: Date.now() + 300000, attempts: 0 }; return send(200, { code, expires: pairing.expiry }); }
          if (url.pathname === '/api/admin/revoke' && req.method === 'POST') { const body = await json(req); config.devices = config.devices.filter(d => d.id !== body.id); saveConfig(); return send(200, { ok: true }); }
          return send(404, { error: '找不到管理操作。' });
        }
        if (url.pathname === '/api/pair' && req.method === 'POST') {
          const ip = req.socket.remoteAddress, now = Date.now(), recent = failures.get(ip);
          if (recent && now - recent.start < 60000 && recent.n >= 5) return send(429, { error: '配對嘗試過多，請等一分鐘後重試。' });
          const body = await json(req);
          if (generation) return send(503, { error: '程式即將更新，請稍候再配對。' });
          if (!pairing || pairing.expiry < now || pairing.attempts >= 10 || typeof body.code !== 'string' || !equal(digest(body.code.trim()), pairing.hash)) {
            if (pairing) pairing.attempts++;
            if (failures.size > 200) failures.clear();
            failures.set(ip, { start: recent && now - recent.start < 60000 ? recent.start : now, n: recent && now - recent.start < 60000 ? recent.n + 1 : 1 });
            return send(403, { error: '配對碼不正確、已使用或已過期，請在 Mac 重新產生。' });
          }
          if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 60) return send(400, { error: '請填寫裝置名稱。' });
          config.devices = config.devices.filter(deviceActive);
          if (config.devices.length >= 10) return send(409, { error: '已達 10 台裝置上限，請先撤銷未使用的裝置。' });
          const deviceToken = randomBytes(32).toString('base64url'), id = randomUUID();
          config.devices.push({ id, hash: digest(deviceToken), label: body.label.trim(), created: new Date().toISOString(), ...(snapshot.rebuild ? { rebuildId: snapshot.rebuild.id } : {}) }); saveConfig(); pairing = null;
          return send(200, { id, token: deviceToken, snapshot });
        }
        const device = config.devices.find(d => deviceActive(d) && equal(d.hash, digest(token)));
        if (!device) return send(401, { error: '裝置尚未配對或已被撤銷。請重新配對，離線資料仍保留。' });
        prune();
        if (url.pathname === '/api/activity' && req.method === 'POST') {
          const body = await json(req);
          if (!deviceActive(device) || !config.devices.some(d => d.id === device.id)) return send(401, { error: '資料庫已重建或配對已撤銷，請重新連接。' });
          if (typeof body.clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.clientId) || typeof body.busy !== 'boolean') return send(400, { error: '畫面狀態不正確。' });
          if (activity.size >= 100 && !activity.has(`${device.id}:${body.clientId}`)) return send(429, { error: '開啟的畫面過多。' });
          activity.set(`${device.id}:${body.clientId}`, { at: Date.now(), busy: body.busy, generation: body.generation });
          if (body.checkUpdates) checkUpdates();
          return send(200, { appVersion: APP_VERSION, maintenance: generation, update: { phase: updateStatus.phase, message: updateStatus.message, configured: updateStatus.configured } });
        }
        if (!req.headers['x-pharmacy-app']) activity.set(`legacy:${device.id}`, { at: Date.now(), busy: true, generation: null });
        if (url.pathname === '/api/recovery-backup/status' && req.method === 'GET') return send(200, scheduledRecovery.status());
        if (url.pathname === '/api/recovery-backup/file' && req.method === 'GET') {
          const name = url.searchParams.get('name'), bytes = scheduledRecovery.download(name);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` }); return res.end(bytes);
        }
        if (['/api/recovery-backup/config', '/api/recovery-backup/stage'].includes(url.pathname) && req.method === 'POST') {
          const body = await json(req);
          if (!deviceActive(device) || !config.devices.some(d => d.id === device.id && equal(d.hash, digest(token)))) return send(401, { error: '資料庫已重建或配對已撤銷，請重新連接。' });
          if (generation || ['activating', 'checking'].includes(updateStatus.phase)) return send(503, { error: '程式正在更新，稍後會再準備備份。' });
          return send(200, url.pathname.endsWith('/config') ? scheduledRecovery.configure(body) : scheduledRecovery.stage(body));
        }
        if (url.pathname === '/api/version' && req.method === 'GET') return send(200, { version: snapshot.version });
        if (url.pathname === '/api/snapshot' && req.method === 'GET') return send(200, snapshot);
        if (url.pathname === '/api/snapshot' && req.method === 'PUT') {
          const body = await json(req);
          if (!deviceActive(device) || !config.devices.some(d => d.id === device.id)) return send(401, { error: '資料庫已重建或配對已撤銷，舊資料不會寫入新庫。' });
          if (generation) return send(503, { error: '程式正在更新，變更已保存在裝置，稍後會再同步。' });
          if (body.expectedVersion !== snapshot.version) return send(409, { error: '另一台裝置先更新，請重新合併。' });
          checkEnvelope(body.envelope);
          if (snapshot.envelope && ['vaultId', 'salt', 'iterations'].some(k => body.envelope[k] !== snapshot.envelope[k])) return send(409, { error: '資料庫身分不同，拒絕覆蓋。' });
          const next = { ...snapshot, version: snapshot.version + 1, envelope: body.envelope };
          // No awaits from version comparison to atomic replacement: compare-and-swap is serialized.
          atomic(snapshotFile, next); snapshot = next;
          let backupOK = true;
          try {
            const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-v${next.version}.pharmabackup`;
            atomic(path.join(dataDir, 'backups', filename), { format: 'pharmacy-backup-1', envelope: next.envelope });
            const backups = fs.readdirSync(path.join(dataDir, 'backups')).filter(n => n.endsWith('.pharmabackup')).sort();
            for (const name of backups.slice(0, Math.max(0, backups.length - 30))) fs.unlinkSync(path.join(dataDir, 'backups', name));
          } catch { backupOK = false; }
          return send(200, { version: next.version, backupOK });
        }
        return send(404, { error: '找不到操作。' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: '不支援的操作。' });
      const requestedFile = url.pathname === '/' ? 'index.html' : url.pathname === '/admin' ? 'admin.html' : url.pathname.slice(1);
      // Keep historical icon URLs and Apple's root fallbacks on the same
      // approved image. These are exact public aliases, never filesystem paths.
      const file = ['icon.svg', 'icon-512.png', 'apple-touch-icon.png', 'apple-touch-icon-precomposed.png', 'favicon.ico'].includes(requestedFile) ? 'icon-192.png' : requestedFile;
      const allow = ['index.html', 'app.js', 'core.js', 'db.js', 'relations.js', 'csv.js', 'csv-ui.js', 'style.css', 'sw.js', 'version.js', 'update-client.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'admin.html', 'admin.js'];
      if (!allow.includes(file)) return send(404, { error: '找不到檔案。' });
      if (file.startsWith('admin') && !isLoopback(req.socket.remoteAddress)) return send(403, { error: '管理頁面限 Mac 本機。' });
      const bytes = fs.readFileSync(path.join(ROOT, 'public', file));
      if (file === 'sw.js') res.setHeader('Service-Worker-Allowed', '/');
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) { if (!res.headersSent) send(error.status || 400, { error: error.status ? error.message : '操作失敗；請檢查檔案格式、儲存空間與服務設定。' }); else res.end(); }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  server.on('clientError', (_e, socket) => socket.destroy());
  // Trial startup must remain read-only. Promote/startup and a bounded timer
  // catch missed weeks even when no browser is currently open.
  const recoveryTick = () => { if (!trial && !generation && !['activating', 'checking'].includes(updateStatus.phase)) scheduledRecovery.tick(); };
  const recoveryTimer = setInterval(recoveryTick, 60000); recoveryTimer.unref();
  server.on('close', () => clearInterval(recoveryTimer));
  server.on('listening', recoveryTick);
  return { server, config, prepare, cancel: () => { generation = null; }, promote: () => { trial = false; recoveryTick(); }, setUpdateStatus: value => { updateStatus = value; }, listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port ?? config.port, host, () => resolve(server.address())); }) };
}
const invokedDirectly = process.argv[1]
  && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    if (process.platform === 'darwin') {
      const dir = defaultDataDir(), config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
      try { execFileSync('/usr/bin/openssl', ['x509', '-checkend', '2592000', '-noout', '-in', path.join(dir, 'tls', 'server.crt')], { stdio: 'ignore' }); }
      catch { const { makeCertificates } = await import('./scripts/setup.mjs'); makeCertificates(dir, config.hostname); }
    }
    const service = createService({ trial: process.env.PHARMACY_TRIAL === '1', updateCommand: process.send ? action => process.send({ type: 'update-command', action }) : null }); await service.listen();
    if (process.send) {
      process.on('message', message => {
        if (message.type === 'update-status') service.setUpdateStatus(message.value);
        if (message.type === 'control') { try { const operations = { prepare: service.prepare, cancel: service.cancel, promote: service.promote }; if (!operations[message.action]) throw new Error('未知操作。'); process.send({ type: 'reply', id: message.id, value: operations[message.action]() }); } catch (e) { process.send({ type: 'reply', id: message.id, error: e.message }); } }
      });
      process.send({ type: 'ready', version: APP_VERSION });
      process.on('disconnect', () => { service.server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref(); });
    }
    process.once('SIGTERM', () => { service.server.close(() => process.exit(0)); service.server.closeIdleConnections(); setTimeout(() => process.exit(1), 8000).unref(); });
    console.log(`\n藥局關係筆記 v${APP_VERSION} 已啟動。\nApp：https://${service.config.hostname}:${service.config.port}/\nMac 管理：https://localhost:${service.config.port}/admin#${service.config.adminToken}\n請保持此視窗開啟；Control+C 停止。\n客戶同步服務不主動連接外網；更新器只下載程式。不記錄拜訪內容或存取紀錄。`);
  } catch { console.error('無法啟動。請先執行「01-Setup.command」，並確認沒有重複啟動服務。'); process.exitCode = 1; }
}
