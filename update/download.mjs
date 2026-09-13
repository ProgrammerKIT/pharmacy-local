import https from 'node:https';
import { MAX_PACKAGE, repositoryOK } from './package.mjs';

const hosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
export function allowedURL(value) {
  const u = new URL(value);
  return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && hosts.has(u.hostname) && !u.hash;
}
export function releaseURL(repository) {
  if (!repositoryOK(repository)) throw new Error('GitHub 儲存庫格式不正確。');
  return `https://github.com/${repository}/releases/latest/download/PharmacyLocal.pharmaupdate`;
}
export function download(url, hops = 0, request = https.get) {
  if (!allowedURL(url) || hops > 5) return Promise.reject(new Error('更新網址或轉址不在允許範圍。'));
  return new Promise((resolve, reject) => {
    // This outbound request contains no files, pairing tokens, vault IDs or device names.
    const req = request(url, { headers: { Accept: 'application/octet-stream', 'User-Agent': 'PharmacyLocal-Updater/1' }, timeout: 15000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        try { resolve(download(new URL(res.headers.location, url).href, hops + 1, request)); } catch (e) { reject(e); }
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`更新下載未完成（HTTP ${res.statusCode}）。`)); return; }
      const parts = []; let size = 0;
      if (Number(res.headers['content-length']) > MAX_PACKAGE) { res.destroy(); reject(new Error('更新包過大。')); return; }
      res.on('data', b => { size += b.length; if (size > MAX_PACKAGE) { res.destroy(); reject(new Error('更新包過大。')); } else parts.push(b); });
      res.on('end', () => resolve(Buffer.concat(parts)));
      res.on('error', () => reject(new Error('更新下載中斷。')));
    });
    const deadline = setTimeout(() => req.destroy(new Error('更新下載逾時。')), 60000);
    req.on('close', () => clearTimeout(deadline));
    req.on('timeout', () => req.destroy(new Error('更新下載逾時。')));
    req.on('error', () => reject(new Error('連不到更新來源；既有程式仍可使用。')));
  });
}
