import fs from 'node:fs';
import { installInitialCustomer } from './initial-customer.mjs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { atomic, defaultDataDir, ROOT } from '../server.mjs';

export function makeCertificates(dataDir, hostname) {
  const tls = path.join(dataDir, 'tls'); fs.mkdirSync(tls, { recursive: true, mode: 0o700 });
  const run = args => execFileSync('/usr/bin/openssl', args, { cwd: tls, stdio: 'pipe' });
  if (!fs.existsSync(path.join(tls, 'ca.key'))) {
    if (fs.existsSync(path.join(tls, 'ca.crt'))) throw new Error('根憑證私鑰遺失，請先保留備份，再依指南重新配對憑證。');
    fs.writeFileSync(path.join(tls, 'ca.cnf'), `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3_ca\n[dn]\nCN=Pharmacy Local ${randomBytes(4).toString('hex')}\nO=Personal Local Notes\n[v3_ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\nnameConstraints=critical,permitted;DNS:${hostname},permitted;DNS:localhost,permitted;IP:127.0.0.1/255.255.255.255\n`, { mode: 0o600 });
    run(['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '3650', '-keyout', 'ca.key', '-out', 'ca.crt', '-config', 'ca.cnf']);
  }
  fs.writeFileSync(path.join(tls, 'server.cnf'), `[req]\nprompt=no\ndistinguished_name=dn\nreq_extensions=req_ext\n[dn]\nCN=${hostname}\n[req_ext]\nsubjectAltName=@alt\n[alt]\nDNS.1=${hostname}\nDNS.2=localhost\nIP.1=127.0.0.1\n[server_ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=@alt\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n`, { mode: 0o600 });
  if (!fs.existsSync(path.join(tls, 'server.key'))) run(['genrsa', '-out', 'server.key', '3072']);
  run(['req', '-new', '-key', 'server.key', '-out', 'server.csr', '-config', 'server.cnf']);
  run(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '365', '-sha256', '-extfile', 'server.cnf', '-extensions', 'server_ext']);
  run(['x509', '-in', 'ca.crt', '-outform', 'DER', '-out', 'PharmacyLocal-CA.cer']);
  const profile = path.join(tls, 'PharmacyLocal.mobileconfig');
  if (!fs.existsSync(profile)) {
    const certificate = fs.readFileSync(path.join(tls, 'PharmacyLocal-CA.cer')).toString('base64');
    fs.writeFileSync(profile, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>PayloadContent</key><array><dict><key>PayloadCertificateFileName</key><string>PharmacyLocal-CA.cer</string><key>PayloadContent</key><data>${certificate}</data><key>PayloadDescription</key><string>本機藥局筆記 HTTPS 憑證，限制於 ${hostname} 與 localhost。</string><key>PayloadDisplayName</key><string>Pharmacy Local HTTPS</string><key>PayloadIdentifier</key><string>local.pharmacy.root.${randomUUID()}</string><key>PayloadType</key><string>com.apple.security.root</string><key>PayloadUUID</key><string>${randomUUID()}</string><key>PayloadVersion</key><integer>1</integer></dict></array><key>PayloadDisplayName</key><string>藥局關係筆記・本機連線</string><key>PayloadDescription</key><string>只安裝你自己 Mac 產生的本機連線根憑證；不包含 MDM、VPN 或資料上傳功能。</string><key>PayloadIdentifier</key><string>local.pharmacy.profile.${randomUUID()}</string><key>PayloadType</key><string>Configuration</string><key>PayloadUUID</key><string>${randomUUID()}</string><key>PayloadVersion</key><integer>1</integer><key>PayloadRemovalDisallowed</key><false/></dict></plist>`, { mode: 0o600 });
  }
  for (const file of fs.readdirSync(tls)) fs.chmodSync(path.join(tls, file), 0o600);
  return tls;
}
if (process.argv[1]?.endsWith('/scripts/setup.mjs')) {
  try {
    if (process.platform !== 'darwin') throw new Error('此安裝流程需要在你的 Mac 執行。測試程式可在其他系統執行。');
    process.umask(0o077);
    const dir = defaultDataDir(); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const localName = execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim();
    if (!/^[a-zA-Z0-9-]{1,63}$/.test(localName)) throw new Error('Mac 本機名稱不符合要求，請在系統設定確認電腦名稱。');
    const hostname = `${localName}.local`, configPath = path.join(dir, 'config.json');
    let config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { hostname, port: 8444, adminToken: randomBytes(32).toString('base64url'), devices: [] };
    if (config.hostname !== hostname) throw new Error(`Mac 名稱變更會造成新的網頁儲存空間。請先將「本機主機名稱」改回 ${config.hostname.replace(/\.local$/, '')}；不要直接覆蓋舊設定。`);
    const tls = makeCertificates(dir, hostname); atomic(configPath, config);
    await installInitialCustomer(ROOT, dir, atomic);
    // Exclusion of this Mac folder is supplemental. It does not control iOS/iCloud backups.
    try { execFileSync('/usr/bin/tmutil', ['addexclusion', dir], { stdio: 'ignore' }); } catch { console.log('無法設定 Time Machine 排除，請依指南手動確認備份目的地。'); }
    console.log(`\n設定完成。\n資料：${dir}\nApp：https://${hostname}:${config.port}/\n需傳到 iPhone 的公開憑證描述檔：${tls}/PharmacyLocal.mobileconfig\n只有 .mobileconfig 與 .cer 可傳送，請勿分享 tls 資料夾、.key 或 config.json。\n\n接著請執行「02-Start.command」啟動服務，及「03-Manage.command」配對。`);
    execFileSync('/usr/bin/open', ['-R', path.join(tls, 'PharmacyLocal.mobileconfig')]);
    console.log('\nMac 憑證信任需要你在下一步輸入 Mac 登入密碼（輸入時不顯示字元）。');
    execFileSync('/usr/bin/sudo', ['/usr/bin/security', 'add-trusted-cert', '-d', '-r', 'trustRoot', '-k', '/Library/Keychains/System.keychain', path.join(tls, 'ca.crt')], { stdio: 'inherit' });
  } catch (e) { console.error(`\n設定尚未完成：${e.message}`); process.exitCode = 1; }
}
