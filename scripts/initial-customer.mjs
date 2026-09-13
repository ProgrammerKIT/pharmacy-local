import fs from 'node:fs';
import path from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { derive, unseal, seal, newMeta, validateBundle } from '../public/core.js';

function secret(prompt) {
  if (!process.stdin.isTTY) throw new Error('客戶資料啟用需要互動式終端機。請雙擊 01-Setup.command。');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(prompt); emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
    function done(error) { process.stdin.off('keypress', handler); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); error ? reject(error) : resolve(value); }
    function handler(str, key = {}) {
      if (key.ctrl && key.name === 'c') return done(new Error('已取消，既有資料未修改。'));
      if (key.name === 'return' || key.name === 'enter') return done();
      if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (str && !key.ctrl && !key.meta && !/\p{Cc}/u.test(str)) value += str;
    }
    process.stdin.on('keypress', handler);
  });
}
export async function rekeyInitial(envelope, deliveryPassword, password) {
  if (password.length < 12) throw new Error('請設定至少 12 個字元的資料庫密碼。');
  const input = validateBundle(await unseal(envelope, await derive(deliveryPassword, envelope)));
  if (input.vaultId !== envelope.vaultId) throw new Error('資料庫身分不符。');
  const meta = newMeta();
  return seal({ ...input, vaultId: meta.vaultId }, await derive(password, meta), meta);
}
export async function installInitialCustomer(root, dir, atomic) {
  const destination = path.join(dir, 'snapshot.json');
  if (fs.existsSync(destination)) {
    const previous = JSON.parse(fs.readFileSync(destination, 'utf8'));
    if (previous.envelope) { console.log('已有客戶資料庫，保留目前紀錄與密碼，不重新載入交付資料。'); return; }
  }
  const source = path.join(root, 'customer-data', 'CS-customers.pharmabackup');
  if (!fs.existsSync(source)) { console.log('此為純程式版本，不含客戶資料。首次配對可建立空資料庫，再於本機匯入 CSV；既有資料不會被重設。'); return; }
  console.log('\n啟用已整理的客戶資料。交付密碼在對話訊息內；輸入時不顯示字元。');
  let deliveryPassword = await secret('交付密碼：');
  let password = await secret('設定你自己的資料庫密碼（至少 12 個字元）：');
  let again = await secret('再輸入一次資料庫密碼：');
  if (password !== again) throw new Error('兩次密碼不同，請重新執行設定。');
  const envelope = await rekeyInitial(JSON.parse(fs.readFileSync(source, 'utf8')), deliveryPassword, password);
  deliveryPassword = password = again = '';
  atomic(destination, { version: 1, envelope });
  const backups = path.join(dir, 'backups'); fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  atomic(path.join(backups, 'initial-customer.pharmabackup'), envelope);
  console.log('客戶資料已使用你設定的密碼重新加密。Mac 與 iPhone 首次配對各輸入一次；之後由裝置自動開啟。請保留密碼，以便新裝置配對及還原加密備份。');
}
