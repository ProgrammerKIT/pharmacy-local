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
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
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
          if (url.pathname === '/api/admin/status' && req.method === 'GET') return send(200, { hostname: config.hostname, version: snapshot.version, appVersion: APP_VERSION, update: updateStatus, service: { running: true, supervised: !!updateCommand, autostart: await startupStatus() }, devices: config.devices.map(({ id, label, created }) => ({ id, label, created })), backups: fs.readdirSync(path.join(dataDir, 'backups')).filter(n => n.endsWith('.pharmabackup')).length });
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
          if (config.devices.length >= 10) return send(409, { error: '已達 10 台裝置上限，請先撤銷未使用的裝置。' });
          const deviceToken = randomBytes(32).toString('base64url'), id = randomUUID();
          config.devices.push({ id, hash: digest(deviceToken), label: body.label.trim(), created: new Date().toISOString() }); saveConfig(); pairing = null;
          return send(200, { id, token: deviceToken, snapshot });
        }
        const device = config.devices.find(d => equal(d.hash, digest(token)));
        if (!device) return send(401, { error: '裝置尚未配對或已被撤銷。請重新配對，離線資料仍保留。' });
        prune();
        if (url.pathname === '/api/activity' && req.method === 'POST') {
          const body = await json(req);
          if (typeof body.clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.clientId) || typeof body.busy !== 'boolean') return send(400, { error: '畫面狀態不正確。' });
          if (activity.size >= 100 && !activity.has(`${device.id}:${body.clientId}`)) return send(429, { error: '開啟的畫面過多。' });
          activity.set(`${device.id}:${body.clientId}`, { at: Date.now(), busy: body.busy, generation: body.generation });
          if (body.checkUpdates) checkUpdates();
          return send(200, { appVersion: APP_VERSION, maintenance: generation, update: { phase: updateStatus.phase, message: updateStatus.message, configured: updateStatus.configured } });
        }
        if (!req.headers['x-pharmacy-app']) activity.set(`legacy:${device.id}`, { at: Date.now(), busy: true, generation: null });
        if (url.pathname === '/api/version' && req.method === 'GET') return send(200, { version: snapshot.version });
        if (url.pathname === '/api/snapshot' && req.method === 'GET') return send(200, snapshot);
        if (url.pathname === '/api/snapshot' && req.method === 'PUT') {
          const body = await json(req);
          if (generation) return send(503, { error: '程式正在更新，變更已保存在裝置，稍後會再同步。' });
          if (body.expectedVersion !== snapshot.version) return send(409, { error: '另一台裝置先更新，請重新合併。' });
          checkEnvelope(body.envelope);
          if (snapshot.envelope && ['vaultId', 'salt', 'iterations'].some(k => body.envelope[k] !== snapshot.envelope[k])) return send(409, { error: '資料庫身分不同，拒絕覆蓋。' });
          const next = { version: snapshot.version + 1, envelope: body.envelope };
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
      const file = url.pathname === '/' ? 'index.html' : url.pathname === '/admin' ? 'admin.html' : url.pathname.slice(1);
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
  return { server, config, prepare, cancel: () => { generation = null; }, promote: () => { trial = false; }, setUpdateStatus: value => { updateStatus = value; }, listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port ?? config.port, host, () => resolve(server.address())); }) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
