import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { ROOT, defaultDataDir, atomic } from '../server.mjs';
import { exportCode } from './release.mjs';
import { checkEnvelope } from '../public/core.js';

const io = createInterface({ input: process.stdin, output: process.stdout });
const label = `gui/${process.getuid?.()}/local.pharmacy.cs.notes`;
let wasLoaded = false, finished = false, oldPlist = null;
const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', 'local.pharmacy.cs.notes.plist');
try {
  if (process.platform !== 'darwin') throw new Error('請在 Mac 執行。');
  const dir = defaultDataDir();
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json')));
  const snapshot = path.join(dir, 'snapshot.json');
  if (!fs.existsSync(snapshot) || !JSON.parse(fs.readFileSync(snapshot)).envelope) throw new Error('找不到既有客戶資料。這是升級工具；首次安裝請用 01-Setup。');
  checkEnvelope(JSON.parse(fs.readFileSync(snapshot)).envelope);
  const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'))).version;
  const target = path.join(os.homedir(), 'Applications', `PharmacyLocal-v${appVersion}`);
  if (fs.existsSync(target)) throw new Error(`升級資料夾已存在，未覆蓋。請先使用 ${target} 內的 02-Start／05-Enable-Autostart。`);
  console.log('只安裝程式到你的 Applications，不更換原本的網址、配對、密碼或客戶檔案。');
  console.log('請先在兩台裝置儲存、同步並匯出加密備份，關閉 App 與相關網頁。舊 Terminal 若仍在執行 02-Start，請在該視窗按 Control+C。');
  if ((await io.question('完成後輸入 YES 升級：')).trim() !== 'YES') throw new Error('已取消。');
  if (fs.existsSync(plist)) oldPlist = fs.readFileSync(plist);
  try { execFileSync('/bin/launchctl', ['print', label], { stdio: 'ignore' }); wasLoaded = true; } catch {}
  if (wasLoaded) execFileSync('/bin/launchctl', ['bootout', label], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', () => reject(new Error('舊服務仍在執行。請先在舊 Terminal 按 Control+C，然後重試。'))); server.listen(config.port, '127.0.0.1', () => server.close(resolve)); });
  const updates = path.join(dir, 'updates'); fs.mkdirSync(updates, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  atomic(path.join(updates, `before-bootstrap-${stamp}.pharmabackup`), { format: 'pharmacy-backup-1', envelope: JSON.parse(fs.readFileSync(snapshot)).envelope });
  if (fs.existsSync(plist)) fs.copyFileSync(plist, path.join(updates, `launch-agent-${stamp}.plist`), fs.constants.COPYFILE_EXCL);
  exportCode(ROOT, target);
  execFileSync(process.execPath, [path.join(target, 'scripts', 'autostart.mjs')], { stdio: 'inherit' });
  finished = true;
  console.log(`升級程式已安裝並設定登入自動啟動：${target}\n請使用這個資料夾的 03-Manage.command。舊程式資料夾保留，請勿同時啟動。\n在管理頁確認 v${appVersion}；兩台 App 各完整關閉再重開。不要清除瀏覽器資料或重新匯入 CSV。`);
  execFileSync('/usr/bin/open', ['-R', path.join(target, '03-Manage.command')]);
} catch (e) {
  if (!finished && oldPlist) fs.writeFileSync(plist, oldPlist, { mode: 0o600 });
  if (wasLoaded && !finished && fs.existsSync(plist)) { try { execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist], { stdio: 'ignore' }); } catch {} }
  console.error(`未完成：${e.message}。既有客戶資料未覆蓋。`); process.exitCode = 1;
} finally { io.close(); }
