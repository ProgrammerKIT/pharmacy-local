const $ = id => document.getElementById(id), token = location.hash.slice(1);
history.replaceState(null, '', '/admin');
async function request(path, body) { const res = await fetch(`/api/admin/${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-Pharmacy-Client': '1', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const value = await res.json(); if (!res.ok) throw new Error(value.error); return value; }
async function task(fn) { $('admin-error').textContent = ''; try { await fn(); } catch (e) { $('admin-error').textContent = e.message; } }
async function refresh() {
  const value = await request('status');
  const a = document.createElement('a'); a.href = `https://${value.hostname}:${location.port}/`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `開啟 App：${a.href}`; $('app-url').replaceChildren(a);
  $('snapshot').textContent = `目前同步版本 ${value.version} · 已保存 ${value.backups} 份加密快照（最多 30 份）`;
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
if (token) setInterval(() => { if (!document.hidden) refresh().catch(() => { $('update-status').textContent = '服務正在切換或尚未啟動，會繼續重試。'; }); }, 4000);
if (!token) $('admin-error').textContent = '請用 Mac 的「03-Manage.command」開啟管理頁，網址需要一次載入的管理憑證。'; else task(refresh);
