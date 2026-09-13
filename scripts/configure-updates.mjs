import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, createPublicKey, createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { atomic, defaultDataDir } from '../server.mjs';
import { validateTrust, repositoryOK } from '../update/package.mjs';

const io = createInterface({ input: process.stdin, output: process.stdout });
try {
  if (process.platform !== 'darwin') throw new Error('請在你的 Mac 執行，私鑰只在你的 Mac 建立。');
  process.umask(0o077);
  console.log('第一次設定：公開 GitHub 儲存庫只能放純程式，不能放 CSV、客戶資料包或備份。');
  const repository = (await io.question('你的 GitHub 儲存庫（帳號/儲存庫）：')).trim();
  if (!repositoryOK(repository)) throw new Error('請輸入 帳號/儲存庫，不含 https 或其他網址。');
  const visibility = execFileSync('gh', ['repo', 'view', repository, '--json', 'visibility', '--jq', '.visibility'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  if (visibility !== 'PUBLIC') throw new Error('此路線需要公開的純程式儲存庫；未修改信任或上傳私鑰。');
  const dir = path.join(defaultDataDir(), 'updates'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const trustFile = path.join(dir, 'trust.json');
  if (fs.existsSync(trustFile)) {
    const old = validateTrust(JSON.parse(fs.readFileSync(trustFile)));
    if (old.repository !== repository) throw new Error('已有不同的更新來源。本工具不自動更換信任或重設防降版紀錄，請先核對。');
  }
  // Kept outside the repository and customer vault. Never print this key.
  const publisher = path.join(os.homedir(), 'Library', 'Application Support', 'PharmacyLocal-Publisher');
  fs.mkdirSync(publisher, { recursive: true, mode: 0o700 });
  const keyFile = path.join(publisher, 'release-ed25519.pem');
  if (!fs.existsSync(keyFile)) {
    if (fs.existsSync(trustFile)) throw new Error('已設定的發布私鑰遺失。請還原原私鑰，不要任意建立替代金鑰。');
    const keys = generateKeyPairSync('ed25519');
    fs.writeFileSync(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  }
  const privateKey = fs.readFileSync(keyFile, 'utf8');
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  const trust = validateTrust({ format: 'pharmacy-trust-1', repository, publicKey });
  if (fs.existsSync(trustFile) && validateTrust(JSON.parse(fs.readFileSync(trustFile))).publicKey !== publicKey) throw new Error('私鑰與目前信任公鑰不符，未修改設定。');
  console.log(`發布公鑰指紋：${createHash('sha256').update(publicKey).digest('hex')}`);
  console.log('自動發布需要把「程式簽章私鑰」存入你這個 GitHub 儲存庫的 Actions Secret。這不是客戶資料或資料庫密碼。');
  const consent = (await io.question('同意用已登入的 GitHub CLI 設定這個 Secret？輸入 YES 繼續，其他取消：')).trim();
  if (consent !== 'YES') throw new Error('已取消線上設定。產生的私鑰僅留在本機，更新來源尚未啟用。');
  // Normal configured gh credentials only; no extraction of credentials or key in argv.
  execFileSync('gh', ['secret', 'set', 'PHARMACY_SIGNING_KEY', '--repo', repository], { input: privateKey, stdio: ['pipe', 'inherit', 'inherit'] });
  atomic(trustFile, trust);
  console.log('已設定簽章來源。請保留本機私鑰的加密離線備份，並重新啟動本機服務。首次 GitHub Release 發布後才有版本可下載。');
} catch (e) { console.error(`未完成：${e.code === 'ENOENT' ? '找不到 gh。請先安裝免費 GitHub CLI，再執行 gh auth login 登入你自己的帳號。' : e.message}`); process.exitCode = 1; }
finally { io.close(); }
