let connection, currentDatabase;
function invalidate(db) {
  if (currentDatabase === db) { currentDatabase = null; connection = null; }
  try { db.close(); } catch {}
}
function open() {
  if (connection) return connection;
  let pending;
  pending = new Promise((resolve, reject) => {
    const request = indexedDB.open('pharmacy-local-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vault');
    request.onerror = () => { if (connection === pending) connection = null; reject(request.error); };
    request.onsuccess = () => {
      const db = request.result; currentDatabase = db;
      db.onversionchange = () => invalidate(db);
      db.onclose = () => invalidate(db);
      resolve(db);
    };
  });
  connection = pending;
  pending.catch(() => { if (connection === pending) connection = null; });
  return pending;
}
// Safari can close an IDB connection while the PWA is suspended. Reopen only
// when transaction CREATION failed: no request has run and nothing can replay.
// Never retry an aborted transaction, a quota error, or a completed write.
async function transact(mode, work) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = await open(); let tx;
    try { tx = db.transaction('vault', mode); }
    catch (error) {
      if (error?.name !== 'InvalidStateError') throw error;
      invalidate(db);
      if (!attempt) continue;
      throw new Error('本機資料庫連線暫時無法恢復；目前輸入仍保留，請保持畫面並再試一次。', { cause: error });
    }
    return new Promise((resolve, reject) => {
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('本機資料操作中斷，尚未確認保存；請保留輸入並重試。'));
      work(tx, resolve, reject);
    });
  }
}
export async function readLocal() {
  return transact('readonly', (tx, resolve, reject) => {
    const r = tx.objectStore('vault').get('main'); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error);
  });
}
export async function writeLocal(envelope, expected, unlockKey) {
  return transact('readwrite', (tx, resolve, reject) => {
    const store = tx.objectStore('vault'), r = store.get('main'); let mismatch = false;
    r.onsuccess = () => {
      if ((r.result?.revision || 0) !== expected) { mismatch = true; tx.abort(); return; }
      store.put({ envelope, revision: expected + 1, unlockKey: unlockKey || r.result?.unlockKey }, 'main');
    };
    tx.oncomplete = () => resolve(expected + 1);
    tx.onabort = tx.onerror = () => reject(new Error(mismatch ? '另一個視窗更新了資料。請關閉多餘視窗，再解鎖重試；本次變更尚未儲存。' : '本機儲存失敗，請檢查可用空間。'));
  });
}
export async function archiveAndReplaceLocal(envelope, expected, unlockKey) {
  return transact('readwrite', (tx, resolve, reject) => {
    const store = tx.objectStore('vault'), r = store.get('main'); let mismatch = false;
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
  return transact('readonly', (tx, resolve, reject) => {
    const result = [], r = tx.objectStore('vault').openCursor();
    r.onerror = () => reject(r.error);
    r.onsuccess = () => { const c = r.result; if (!c) { resolve(result); return; } if (String(c.key).startsWith('archive:')) result.push({ id: c.key, at: c.value.archivedAt }); c.continue(); };
  });
}
export async function readLocalArchive(id) {
  if (typeof id !== 'string' || !/^archive:[a-f0-9-]{36}$/.test(id)) throw new Error('備份識別不正確。');
  return transact('readonly', (tx, resolve, reject) => {
    const r = tx.objectStore('vault').get(id); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error);
  });
}

function weeklyRecoveryId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw new Error('每週備份設定識別不正確。');
  return 'weekly-recovery:' + id;
}
function weeklyRecoveryRecord(value) {
  const key = value?.key, meta = value?.meta;
  if (typeof CryptoKey === 'undefined' || !(key instanceof CryptoKey) || key.type !== 'secret' || key.extractable !== false || key.algorithm?.name !== 'AES-GCM' || key.algorithm.length !== 256 || !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) throw new Error('每週備份金鑰不正確，請重新驗證備份密碼。');
  let salt;
  try { salt = typeof meta?.salt === 'string' ? atob(meta.salt) : null; } catch {}
  if (!meta || typeof meta.vaultId !== 'string' || !meta.vaultId || meta.vaultId.length > 100 || meta.iterations !== 600000 || salt?.length !== 16 || btoa(salt) !== meta.salt || value.sourceVaultId !== meta.vaultId || typeof value.proofSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.proofSha256)) throw new Error('每週備份設定內容不正確。');
  return { key, meta: { vaultId: meta.vaultId, salt: meta.salt, iterations: meta.iterations }, sourceVaultId: value.sourceVaultId, proofSha256: value.proofSha256 };
}
export async function readWeeklyRecovery(id) {
  const recordId = weeklyRecoveryId(id);
  return transact('readonly', (tx, resolve, reject) => {
    const r = tx.objectStore('vault').get(recordId);
    r.onsuccess = () => { try { resolve(r.result == null ? null : weeklyRecoveryRecord(r.result)); } catch (error) { reject(error); } };
    r.onerror = () => reject(r.error);
  });
}
export async function writeWeeklyRecovery(id, value) {
  const recordId = weeklyRecoveryId(id), record = weeklyRecoveryRecord(value);
  return transact('readwrite', (tx, resolve, reject) => {
    // Configuration IDs are immutable: changing configuration preserves old keys
    // and never replaces the live vault/main record or its unlock key.
    tx.objectStore('vault').add(record, recordId);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error('每週備份設定無法保存，或此設定已存在；原資料與既有設定保持原樣。'));
  });
}
