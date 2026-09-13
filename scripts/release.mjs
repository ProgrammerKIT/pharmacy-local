import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../server.mjs';
import { buildPackage } from '../update/package.mjs';
import { CODE_FILES } from './code-files.mjs';

export function exportCode(source, destination) {
  if (fs.existsSync(destination)) throw new Error('輸出資料夾已存在；不覆蓋既有檔案，請指定新位置。');
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const file of CODE_FILES) {
    let current = source;
    for (const component of file.split('/')) { current = path.join(current, component); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('不接受符號連結作為發布來源。'); }
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(current, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, file.endsWith('.command') ? 0o700 : 0o600);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === '--code-only' && args[1]) { exportCode(ROOT, path.resolve(args[1])); console.log('已輸出純程式資料夾；不含客戶 CSV、資料包、憑證或私鑰。'); }
    else {
      const repository = process.env.GITHUB_REPOSITORY;
      const sequence = Number(process.env.PHARMACY_RELEASE_SEQUENCE);
      const privateKey = process.env.PHARMACY_SIGNING_KEY;
      if (!privateKey) throw new Error('未設定簽章私鑰；不能發布未簽署版本。');
      const destination = path.resolve(args[0] || 'PharmacyLocal.pharmaupdate');
      const bytes = buildPackage(ROOT, { repository, sequence, privateKey, notes: process.env.PHARMACY_RELEASE_NOTES || '' });
      fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
      console.log('已產生簽章純程式更新包。');
    }
  } catch (e) { console.error(`未完成：${e.message}`); process.exitCode = 1; }
}
