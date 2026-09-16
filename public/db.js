let connection;
function open() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('pharmacy-local-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vault');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  }); return connection;
}
export async function readLocal() {
  const db = await open(); return new Promise((resolve, reject) => { const r = db.transaction('vault').objectStore('vault').get('main'); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error); });
}
export async function writeLocal(envelope, expected, unlockKey) {
  const db = await open(); return new Promise((resolve, reject) => {
    const tx = db.transaction('vault', 'readwrite'), store = tx.objectStore('vault'), r = store.get('main'); let mismatch = false;
    r.onsuccess = () => {
      if ((r.result?.revision || 0) !== expected) { mismatch = true; tx.abort(); return; }
      store.put({ envelope, revision: expected + 1, unlockKey: unlockKey || r.result?.unlockKey }, 'main');
    };
    tx.oncomplete = () => resolve(expected + 1);
    tx.onabort = tx.onerror = () => reject(new Error(mismatch ? '另一個視窗更新了資料。請關閉多餘視窗，再解鎖重試；本次變更尚未儲存。' : '本機儲存失敗，請檢查可用空間。'));
  });
}
export async function archiveAndReplaceLocal(envelope, expected, unlockKey) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('vault', 'readwrite'), store = tx.objectStore('vault'), r = store.get('main'); let mismatch = false;
    r.onsuccess = () => {
      const old = r.result;
      if ((old?.revision || 0) !== expected) { mismatch = true; tx.abort(); return; }
      if (old && !old.unlockKey) { tx.abort(); return; }
      if (old) store.add({ ...old, archivedAt: new Date().toISOString() }, 'archive:' + crypto.randomUUID());
      store.put({ envelope, revision: expected + 1, unlockKey }, 'main');
    };
    tx.oncomplete = () => resolve(expected + 1);
    tx.onabort = tx.onerror = () => reject(new Error(mismatch ? '另一個視窗已修改資料，請關閉多餘視窗並重新開啟；本次沒有切換資料庫。' : '隔離備份或本機儲存失敗；舊資料保持原樣。'));
  });
}
export async function listLocalArchives() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const result = [], r = db.transaction('vault').objectStore('vault').openCursor();
    r.onerror = () => reject(r.error);
    r.onsuccess = () => { const c = r.result; if (!c) { resolve(result); return; } if (String(c.key).startsWith('archive:')) result.push({ id: c.key, at: c.value.archivedAt }); c.continue(); };
  });
}
export async function readLocalArchive(id) {
  if (typeof id !== 'string' || !/^archive:[a-f0-9-]{36}$/.test(id)) throw new Error('備份識別不正確。');
  const db = await open();
  return new Promise((resolve, reject) => { const r = db.transaction('vault').objectStore('vault').get(id); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error); });
}
