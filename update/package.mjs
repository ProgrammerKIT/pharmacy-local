// The bootstrap keeps this verifier outside remotely replaceable code.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, sign, verify } from 'node:crypto';

export const BOOTSTRAP = 1;
export const MAX_PACKAGE = 16 * 1024 * 1024;
export const RUNTIME_FILES = Object.freeze([
  'package.json', 'server.mjs', 'scripts/setup.mjs', 'scripts/initial-customer.mjs',
  'public/index.html', 'public/app.js', 'public/core.js', 'public/db.js',
  'public/relations.js', 'public/csv.js', 'public/csv-ui.js', 'public/style.css',
  'public/sw.js', 'public/update-client.js', 'public/version.js',
  'public/admin.html', 'public/admin.js', 'public/manifest.webmanifest',
  'public/icon.svg', 'public/icon-192.png', 'public/icon-512.png',
]);
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function versionOK(version) { return typeof version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version); }
export function repositoryOK(repo) {
  return typeof repo === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(repo) && !repo.endsWith('.');
}
export function validateTrust(trust) {
  if (trust?.format !== 'pharmacy-trust-1' || !repositoryOK(trust.repository)) throw new Error('更新來源格式不正確。');
  const key = createPublicKey(trust.publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('更新公鑰必須使用 Ed25519。');
  return { format: trust.format, repository: trust.repository, publicKey: key.export({ type: 'spki', format: 'pem' }).toString() };
}
function decode(value, limit) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('更新內容編碼不正確。');
  return Buffer.from(value, 'base64');
}
export function validatePayload(p, trust) {
  if (p?.format !== 'pharmacy-update-1' || !versionOK(p.version) || !Number.isSafeInteger(p.sequence) || p.sequence < 1) throw new Error('更新版本格式不正確。');
  if (p.repository !== trust.repository || p.bootstrap !== BOOTSTRAP || p.dataSchema !== 2 || p.protocol !== 1) throw new Error('更新來源或資料格式不相容；需要人工升級。');
  if (!Number.isFinite(Date.parse(p.publishedAt)) || typeof p.notes !== 'string' || p.notes.length > 4000) throw new Error('更新說明格式不正確。');
  if (!Array.isArray(p.files) || p.files.length !== RUNTIME_FILES.length) throw new Error('更新檔案不完整。');
  const seen = new Set(); let total = 0;
  for (const f of p.files) {
    if (!RUNTIME_FILES.includes(f.path) || seen.has(f.path)) throw new Error('更新包含重複或未允許的路徑。');
    seen.add(f.path);
    const bytes = decode(f.content, 3 * 1024 * 1024); total += bytes.length;
    if (f.size !== bytes.length || f.sha256 !== hash(bytes) || total > 8 * 1024 * 1024) throw new Error('更新檔案驗證失敗。');
  }
  const pkg = JSON.parse(Buffer.from(p.files.find(f => f.path === 'package.json').content, 'base64'));
  const js = Buffer.from(p.files.find(f => f.path === 'public/version.js').content, 'base64').toString();
  const sw = Buffer.from(p.files.find(f => f.path === 'public/sw.js').content, 'base64').toString();
  if (pkg.version !== p.version || !js.includes(`APP_VERSION = '${p.version}'`) || !sw.includes(`VERSION = '${p.version}'`)) throw new Error('程式與發布版本不一致。');
  return p;
}
export function readPackage(bytes, trustInput) {
  const trust = validateTrust(trustInput);
  if (bytes.length > MAX_PACKAGE) throw new Error('更新包過大。');
  const signed = JSON.parse(bytes.toString('utf8'));
  const raw = decode(signed.payload, MAX_PACKAGE), signature = decode(signed.signature, 64);
  if (signature.length !== 64 || !verify(null, raw, trust.publicKey, signature)) throw new Error('數位簽章不符，已拒絕更新。');
  return validatePayload(JSON.parse(raw.toString('utf8')), trust);
}
export function buildPackage(root, { repository, sequence, privateKey, notes = '', publishedAt = new Date().toISOString() }) {
  const trust = validateTrust({ format: 'pharmacy-trust-1', repository, publicKey: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString() });
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  const files = RUNTIME_FILES.map(file => {
    const full = path.join(root, file);
    // Do not follow links, including a parent directory replaced with a link.
    let check = root;
    for (const segment of file.split('/')) { check = path.join(check, segment); if (fs.lstatSync(check).isSymbolicLink()) throw new Error('發布來源不能含符號連結。'); }
    const bytes = fs.readFileSync(full);
    return { path: file, size: bytes.length, sha256: hash(bytes), content: bytes.toString('base64') };
  });
  const p = validatePayload({ format: 'pharmacy-update-1', version, sequence, repository, bootstrap: BOOTSTRAP, dataSchema: 2, protocol: 1, notes, publishedAt, files }, trust);
  const raw = Buffer.from(JSON.stringify(p));
  const bytes = Buffer.from(JSON.stringify({ payload: raw.toString('base64'), signature: sign(null, raw, privateKey).toString('base64') }));
  if (bytes.length > MAX_PACKAGE) throw new Error('更新包過大。');
  return bytes;
}
