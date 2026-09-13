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
