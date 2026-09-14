import { APP_VERSION } from './version.js';

const programVersion = value => typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value);
const dataVersion = value => Number.isSafeInteger(value) && value >= 0;

// Fetch failures do not reveal whether DNS, TLS, a firewall or the Mac caused them.
export async function requestLocal(path, { method = 'GET', body, token } = {}, onVersion = () => {}) {
  if (!/^\/api\/[a-z/-]+$/.test(path)) throw new Error('只允許連接本機 App 的 API。');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  let response, appVersion = null;
  const failure = (message, code) => Object.assign(new Error(message), { code, status: response?.status, serviceReached: !!appVersion, appVersion });
  try {
    response = await fetch(path, { method, cache: 'no-store', redirect: 'error', credentials: 'omit', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-Pharmacy-Client': '1', 'X-Pharmacy-App': APP_VERSION, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const version = response.headers.get('X-Pharmacy-Version');
    if (programVersion(version)) { appVersion = version; onVersion(version); }
    let data;
    try { data = await response.json(); }
    catch { throw failure(controller.signal.aborted ? 'Mac 回應逾時，請稍後再試。本機資料仍保留。' : 'Mac 回應格式不正確，尚未完成同步。', controller.signal.aborted ? 'timeout' : 'response'); }
    if (!appVersion || !data || typeof data !== 'object' || Array.isArray(data)) throw failure('未收到可辨識的 Mac 程式回應，尚未完成同步。', 'response');
    if (!response.ok) throw failure(typeof data.error === 'string' ? data.error : 'Mac 尚未完成操作，請稍後再試。', response.status === 401 ? 'pairing' : response.status === 503 ? 'maintenance' : 'http');
    if ((path === '/api/version' || path === '/api/snapshot') && !dataVersion(data.version)) throw failure('Mac 回傳的資料版本不正確，尚未完成同步。', 'response');
    if (path === '/api/snapshot' && method === 'GET' && !Object.hasOwn(data, 'envelope')) throw failure('Mac 回傳的同步內容不完整。', 'response');
    if (path === '/api/activity' && (!programVersion(data.appVersion) || !(data.maintenance === null || typeof data.maintenance === 'string') || typeof data.update?.message !== 'string')) throw failure('Mac 回傳的更新狀態不完整。', 'response');
    return data;
  } catch (error) {
    if (typeof error.serviceReached === 'boolean') throw error;
    throw failure(controller.signal.aborted ? 'Mac 回應逾時，請稍後再試。本機資料仍保留。' : '未能連到 Mac；請確認同一區域網路、Mac 服務、防火牆及憑證。本機資料仍保留。', controller.signal.aborted ? 'timeout' : 'network');
  } finally { clearTimeout(timer); }
}

// A read-only authenticated version probe; never downloads or writes a customer snapshot.
export async function diagnoseConnection({ api, hasToken }) {
  const result = { checkedAt: null, service: '尚未確認', tls: '尚未確認', pairing: '尚未確認', version: null, message: '' };
  try {
    const remote = await api('/api/version', hasToken() ? {} : { token: null });
    if (!dataVersion(remote.version)) throw new Error('Mac 回傳的資料版本不正確。');
    result.service = 'Mac 服務已回應';
    result.tls = '本次 HTTPS 連線驗證通過';
    result.pairing = '配對有效';
    result.version = remote.version;
    result.message = '連線檢查完成；這項檢查不會交換客戶資料或更新成功同步時間。';
  } catch (error) {
    if (error.serviceReached) {
      result.service = 'Mac 服務已回應';
      result.tls = '本次 HTTPS 連線驗證通過';
    }
    result.pairing = error.code === 'pairing' ? (hasToken() ? '配對已失效，請重新配對（保留本機資料）' : '尚未配對或尚未解鎖') : '尚未確認，請先解決連線或服務問題';
    result.message = error.message;
    if (!error.serviceReached) result.message += ' 瀏覽器無法單憑這次失敗區分防火牆、憑證或網路問題。';
  }
  result.checkedAt = new Date().toISOString();
  return result;
}

export function startUpdates({ api, hasToken, isBusy, setHold, notify, onOfflineReady }) {
  const clientId = crypto.randomUUID();
  let generation = null, remoteHold = false, workerHold = false, probing = false;
  let registration, lastCheck = 0, reloadPending = false, workerTimer, foregroundCheck = true;
  const label = document.getElementById('update-state');
  const versionLabel = document.getElementById('app-version');
  if (versionLabel) versionLabel.textContent = `CS EDITION · ${APP_VERSION}`;
  const updateHold = () => setHold(remoteHold || workerHold);
  const message = text => { if (label) label.textContent = `程式 v${APP_VERSION} · ${text}`; };
  const releaseWorker = () => { workerHold = false; clearTimeout(workerTimer); updateHold(); };
  function maybeActivate() { if (registration?.waiting && !generation && !isBusy()) registration.waiting.postMessage({ type: 'APPLY_WHEN_SAFE' }); }
  async function probe() {
    if (probing || document.hidden) return;
    probing = true;
    try {
      if (reloadPending && !isBusy()) { location.reload(); return; }
      let activityFailed = false;
      try {
        if (hasToken()) {
          if (generation && !isBusy()) { remoteHold = true; updateHold(); }
          const state = await api('/api/activity', { method: 'POST', body: { clientId, busy: isBusy(), generation: remoteHold ? generation : null, checkUpdates: foregroundCheck } });
          foregroundCheck = false;
          generation = state.maintenance;
          if (!generation) { remoteHold = false; updateHold(); }
          else if (!isBusy()) { remoteHold = true; updateHold(); }
          message(generation ? (remoteHold ? '正在安全切換，請稍候…' : '新版等待中，請先儲存或取消編輯。') : state.appVersion !== APP_VERSION ? 'Mac 已是 v' + state.appVersion + '，正在取得新版介面。' : state.update.message);
        } else {
          remoteHold = false; generation = null; updateHold();
        }
      } catch (error) {
        activityFailed = true;
        remoteHold = false; generation = null; updateHold();
        message(error.code === 'pairing' ? '配對已失效；請重新配對以恢復同步。新版介面仍會獨立檢查。' : error.serviceReached ? 'Mac 已回應，更新狀態暫不可用；稍後會再檢查。' : '目前使用已保存的版本；連回 Mac 後再檢查。');
      }
      // Authentication must not gate downloading the public, versioned shell.
      // Activation still requires no local draft and the worker's all-tab handshake.
      try {
        if (registration && !generation && Date.now() - lastCheck > 60000) { lastCheck = Date.now(); await registration.update(); }
      } catch {
        if (!activityFailed) message('新版介面尚未下載完成，稍後會再試；目前版本仍可使用。');
      }
      maybeActivate();
    } finally { probing = false; }
  }
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'UPDATE_PREPARE') {
        const ready = !isBusy() && !generation;
        if (ready) { workerHold = true; updateHold(); clearTimeout(workerTimer); workerTimer = setTimeout(releaseWorker, 10000); }
        event.ports[0]?.postMessage({ ready });
      }
      if (event.data?.type === 'UPDATE_CANCEL') releaseWorker();
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      reloadPending = true;
      if (!isBusy()) location.reload(); else notify('新版已就緒，儲存目前內容後會自動切換。');
    });
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(async reg => {
      registration = reg;
      reg.addEventListener('updatefound', () => { const installing = reg.installing; installing?.addEventListener('statechange', () => { if (installing.state === 'installed') maybeActivate(); }); });
      await navigator.serviceWorker.ready; onOfflineReady(); maybeActivate(); probe();
    }).catch(() => message('尚未完成離線介面下載；請確認 Mac 連線與憑證。'));
  }
  message('Mac 連線後檢查更新；離線時保留原版。');
  const timer = setInterval(probe, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastCheck = 0; foregroundCheck = true; probe(); } });
  window.addEventListener('online', probe);
  // Do not stop this timer on pagehide: Safari's back-forward cache may restore the page.
  window.addEventListener('pagehide', releaseWorker);
  probe();
}
