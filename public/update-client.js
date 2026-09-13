import { APP_VERSION } from './version.js';

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
  function maybeActivate() { if (registration?.waiting && !isBusy()) registration.waiting.postMessage({ type: 'APPLY_WHEN_SAFE' }); }
  async function probe() {
    if (probing || document.hidden) return;
    probing = true;
    try {
      if (reloadPending && !isBusy()) { location.reload(); return; }
      if (hasToken()) {
        if (generation && !isBusy()) { remoteHold = true; updateHold(); }
        const state = await api('/api/activity', { method: 'POST', body: { clientId, busy: isBusy(), generation: remoteHold ? generation : null, checkUpdates: foregroundCheck } });
        foregroundCheck = false;
        generation = state.maintenance;
        if (!generation) { remoteHold = false; updateHold(); }
        else if (!isBusy()) { remoteHold = true; updateHold(); }
        message(generation ? (remoteHold ? '正在安全切換，請稍候…' : '新版等待中，請先儲存或取消編輯。') : state.appVersion !== APP_VERSION ? `Mac 已是 v${state.appVersion}，正在取得新版介面。` : state.update.message);
      }
      if (registration && !generation && Date.now() - lastCheck > 60000) { lastCheck = Date.now(); await registration.update(); }
      maybeActivate();
    } catch {
      remoteHold = false; generation = null; updateHold();
      message('目前使用已保存的版本；連回 Mac 後再檢查。');
    } finally { probing = false; }
  }
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'UPDATE_PREPARE') {
        const ready = !isBusy();
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
