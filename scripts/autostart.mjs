import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../server.mjs';
const label = 'local.pharmacy.cs.notes', folder = path.join(os.homedir(), 'Library', 'LaunchAgents'), file = path.join(folder, label + '.plist');
const uid = process.getuid(), xml = s => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
try {
  if (process.platform !== 'darwin') throw new Error('請在 Mac 執行。');
  if (process.argv.includes('--remove')) {
    try { execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${label}`], { stdio: 'ignore' }); } catch {}
    if (fs.existsSync(file)) fs.unlinkSync(file); console.log('已停用登入自動啟動。資料與配對仍保留。');
  } else {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(ROOT, 'supervisor.mjs'))}</string></array><key>WorkingDirectory</key><string>${xml(ROOT)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string></dict></plist>`, { mode: 0o600 });
    try { execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${label}`], { stdio: 'ignore' }); } catch {}
    execFileSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, file]);
    console.log('已設定登入 Mac 時啟動本機服務。請勿再重複執行 02-Start；可用 03-Manage 開啟管理。');
  }
} catch (e) { console.error(`未完成：${e.message}`); process.exitCode = 1; }
