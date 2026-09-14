const $ = id => document.getElementById(id), token = location.hash.slice(1);
history.replaceState(null, '', '/admin');
async function request(path, body) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch('/api/admin/' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-Pharmacy-Client': '1', Authorization: 'Bearer ' + token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await res.json();
    if (!res.ok) throw new Error(value.error || 'Mac 尚未完成操作。');
    return value;
  } finally { clearTimeout(timer); }
}
function serviceUnavailable() { $('service-status').textContent = '暫時連不到 Mac 本機服務，可能正在更新切換或已停止。'; $('autostart-status').textContent = '目前無法取得登入啟動狀態。若持續無回應，請依下方指引處理。'; }
async function task(fn) { $('admin-error').textContent = ''; try { await fn(); } catch (e) { $('admin-error').textContent = e.message; } }
async function refresh() {
  let value;
  try { value = await request('status'); } catch (error) { serviceUnavailable(); throw error; }
  const a = document.createElement('a'); a.href = `https://${value.hostname}:${location.port}/`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `開啟 App：${a.href}`; $('app-url').replaceChildren(a);
  $('snapshot').textContent = `目前資料版本 ${value.version} · 已保存 ${value.backups} 份加密快照（最多 30 份）`;
  $('service-status').textContent = value.service?.running ? 'Mac 本機服務已回應。' + (value.service.supervised ? '程式更新管理服務已連接。' : '目前未連接程式更新管理服務，請依下方指引啟動。') : '此 Mac 程式尚未提供啟動狀態，請先完成程式更新。';
  $('autostart-status').textContent = value.service?.autostart?.message || '尚未取得登入自動啟動狀態。';
  $('service-checked').textContent = '檢查於 ' + new Date().toLocaleString('zh-TW') + '；此結果只確認 Mac 本機，iPhone 連線請從手機 App 按「檢查連線」。';
  const u = value.update;
  $('update-version').textContent = `Mac 程式 v${value.appVersion}`;
  $('update-status').textContent = u.message;
  $('update-source').textContent = u.configured ? `已設定來源：${u.repository} · ${u.paused ? '已暫停' : 'App 前景、服務啟動及每 24 小時檢查'}${u.checkedAt ? ' · 上次驗證 ' + new Date(u.checkedAt).toLocaleString('zh-TW') : ''}` : '尚未設定發布來源。完成 08-Configure-Updates 後重新啟動服務；不要把客戶檔案放上 GitHub。';
  const running = ['activating', 'checking'].includes(u.phase);
  document.querySelectorAll('[data-update]').forEach(b => b.disabled = running || (b.dataset.update === 'check' && (!u.configured || u.paused)) || (b.dataset.update === 'rollback' && !u.canRollback));
  $('update-toggle').dataset.update = u.paused ? 'resume' : 'pause';
  $('update-toggle').textContent = u.paused ? '恢復自動更新' : '暫停自動更新';
  $('update-history').replaceChildren();
  for (const entry of u.history || []) { const li = document.createElement('li'); li.textContent = `${new Date(entry.at).toLocaleString('zh-TW')} · v${entry.version} · ${entry.message}`; $('update-history').append(li); }
  $('devices').replaceChildren();
  for (const device of value.devices) { const row = document.createElement('div'); row.className = 'admin-device'; const name = document.createElement('span'); name.textContent = `${device.label} · ${device.id.slice(0, 8)}`; const button = document.createElement('button'); button.textContent = '撤銷配對'; button.className = 'danger'; button.addEventListener('click', () => task(async () => { if (confirm(`停止「${device.label}」未來的同步？裝置已有的資料仍然保留。`)) { await request('revoke', { id: device.id }); await refresh(); } })); row.append(name, button); $('devices').append(row); }
  if (!value.devices.length) $('devices').textContent = '還沒有配對裝置。';
}
$('make-code').addEventListener('click', () => task(async () => { const value = await request('code', {}); $('code').hidden = false; $('code').textContent = value.code; $('expiry').textContent = `有效至 ${new Date(value.expires).toLocaleTimeString('zh-TW')}，只能使用一次。產生新碼會取代舊碼。`; }));
$('refresh').addEventListener('click', () => task(refresh));
document.querySelectorAll('[data-update]').forEach(b => b.addEventListener('click', () => task(async () => {
  if (b.dataset.update === 'rollback' && !confirm('退回上一個相容的程式版本？客戶資料不會倒退；完成後自動更新會暫停。')) return;
  await request('update', { action: b.dataset.update });
  $('update-status').textContent = '已送出操作，狀態稍後更新。';
})));
if (token) setInterval(() => { if (!document.hidden) refresh().catch(() => { serviceUnavailable(); $('update-status').textContent = '服務正在切換或尚未啟動，會繼續重試。'; }); }, 4000);
if (!token) $('admin-error').textContent = '請用 Mac 的「03-Manage.command」開啟管理頁，網址需要一次載入的管理憑證。'; else task(refresh);
