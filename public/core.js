export const FORMAT = 'pharmacy-vault-1';
export const ITERATIONS = 600000;
export const MAX_BYTES = 24 * 1024 * 1024;
const enc = new TextEncoder();
const dec = new TextDecoder();
export const uuid = () => crypto.randomUUID();
export function b64(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export function unb64(str) { return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }
export function newMeta() { return { format: FORMAT, vaultId: uuid(), salt: b64(crypto.getRandomValues(new Uint8Array(16))), iterations: ITERATIONS }; }
export function checkEnvelope(e) {
  if (!e || e.format !== FORMAT || typeof e.vaultId !== 'string' || e.vaultId.length > 100 || e.iterations !== ITERATIONS || typeof e.salt !== 'string' || unb64(e.salt).length !== 16 || typeof e.iv !== 'string' || unb64(e.iv).length !== 12 || typeof e.ciphertext !== 'string' || e.ciphertext.length > 40 * 1024 * 1024 || unb64(e.ciphertext).length < 16) throw new Error('加密檔案格式不符或版本不支援。');
  return e;
}
export async function derive(password, meta) {
  if (meta.iterations !== ITERATIONS || unb64(meta.salt).length !== 16) throw new Error('金鑰設定不符。');
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(meta.salt), iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const aad = (m, purpose) => enc.encode(JSON.stringify([FORMAT, m.vaultId, m.salt, m.iterations, purpose]));
export async function seal(value, key, meta, purpose = 'shared') {
  const raw = enc.encode(JSON.stringify(value));
  if (raw.length > MAX_BYTES) throw new Error('資料已達此版 24 MB 上限，請先備份。這次變更未儲存。');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(meta, purpose) }, key, raw);
  return { format: FORMAT, vaultId: meta.vaultId, salt: meta.salt, iterations: ITERATIONS, iv: b64(iv), ciphertext: b64(new Uint8Array(data)) };
}
export async function unseal(e, key, purpose = 'shared') {
  checkEnvelope(e);
  try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv), additionalData: aad(e, purpose) }, key, unb64(e.ciphertext)))); }
  catch { throw new Error('密碼不正確，或檔案已損毀；原資料未被覆蓋。'); }
}
export const emptyBundle = vaultId => ({ schema: 2, vaultId, ops: [], blobs: {} });
export async function openRebuiltSnapshot(paired, currentVaultId, password, deviceName) {
  const remote = paired?.snapshot;
  if (!remote?.rebuild?.id || !remote.envelope || remote.envelope.vaultId === currentVaultId) throw new Error('Mac 尚未重建為另一個資料庫；本機資料保持原樣。');
  if (!Number.isSafeInteger(remote.version) || remote.version < 1 || typeof paired.token !== 'string' || !paired.token || typeof paired.id !== 'string') throw new Error('新資料庫的配對回應不完整。');
  const meta = remote.envelope, key = await derive(password, meta), bundle = validateBundle(await unseal(meta, key));
  if (bundle.vaultId !== meta.vaultId) throw new Error('新資料庫身分不符。');
  return { key, meta, payload: { schema: 1, device: paired.id, deviceName, token: paired.token, bundle, dirty: false, serverVersion: remote.version, lastSync: new Date().toISOString() } };
}
const types = ['store', 'visit', 'topic', 'person', 'source'];
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = (s, max = 20000) => typeof s === 'string' && s.length <= max;
const ids = a => Array.isArray(a) && a.length <= 100 && a.every(x => str(x, 100));
export function validData(type, d) {
  if (!plain(d)) return false;
  if (d.csvIdentityPending !== undefined && (type !== 'store' || typeof d.csvIdentityPending !== 'boolean')) return false;
  if (d.csvDecisionGroups !== undefined && (type !== 'store' || !Array.isArray(d.csvDecisionGroups) || d.csvDecisionGroups.length > 200 || !d.csvDecisionGroups.every(v => str(v, 200)))) return false;
  if (d.csvAliases !== undefined && (type !== 'store' || !Array.isArray(d.csvAliases) || d.csvAliases.length > 100 || !d.csvAliases.every(v => str(v, 200)))) return false;
  if (d.csvIdentityRules !== undefined && (type !== 'store' || !Array.isArray(d.csvIdentityRules) || d.csvIdentityRules.length > 200 || !d.csvIdentityRules.every(r => plain(r) && r.decision === 'same' && str(r.mapKey, 500) && r.mapKey && str(r.label, 200) && r.label.trim() && str(r.source, 200) && str(r.decidedAt, 40) && Array.isArray(r.names) && r.names.length > 1 && r.names.length <= 100 && r.names.every(v => str(v, 200) && v.trim()) && Array.isArray(r.addresses) && r.addresses.length <= 100 && r.addresses.every(v => str(v, 2000) && v.trim())))) return false;
  if (d.qualityDistinct !== undefined && (type !== 'store' || !Array.isArray(d.qualityDistinct) || d.qualityDistinct.length > 200 || !d.qualityDistinct.every(r => plain(r) && str(r.store, 100) && str(r.self, 6000) && str(r.other, 6000)))) return false;
  if (['ruleKey', 'csvTag', 'mentionTerm'].some(k => d[k] !== undefined && !str(d[k], 200))) return false;
  if (d.csvStream !== undefined && !str(d.csvStream, 500)) return false;
  if (d.googleText !== undefined && !str(d.googleText)) return false;
  if (d.sourceMissing !== undefined && typeof d.sourceMissing !== 'boolean') return false;
  if (d.googleUpdatePending !== undefined && typeof d.googleUpdatePending !== 'boolean') return false;
  if (d.csvSources !== undefined && (!Array.isArray(d.csvSources) || d.csvSources.length > 20000 || !d.csvSources.every(s => plain(s) && str(s.file, 500) && str(s.fingerprint, 64) && str(s.batch, 100) && str(s.list, 200) && str(s.at, 40) && str(s.blob, 64) && (s.sourceSnapshot === undefined || str(s.sourceSnapshot, 100)) && Number.isInteger(s.line) && s.line > 0 && Array.isArray(s.headers) && Array.isArray(s.cells) && s.headers.length === s.cells.length && s.headers.length <= 100 && s.headers.every(h => str(h, 20000)) && s.cells.every(c => str(c, 2097152))))) return false;
  if (type === 'source') return str(d.file, 500) && !!d.file.trim() && str(d.list, 200) && /^[a-f0-9]{64}$/.test(d.blob || '') && str(d.batch, 100) && !!d.batch && Number.isInteger(d.rows) && d.rows >= 0 && d.rows <= 1500 && Array.isArray(d.headers) && d.headers.length <= 100 && d.headers.every(h => str(h, 20000)) && str(d.encoding, 20) && str(d.delimiter, 10) && (d.reviewPackageId === undefined || str(d.reviewPackageId, 100));
  if (type === 'visit') return str(d.store, 100) && str(d.date, 20) && (d.date === '' || /^\d{4}-\d{2}-\d{2}$/.test(d.date)) && str(d.text) && str(d.next) && str(d.source, 100) && ids(d.topics) && ids(d.people) && Array.isArray(d.attachments) && d.attachments.length <= 20 && d.attachments.every(a => plain(a) && str(a.blob, 100) && str(a.name, 200) && str(a.mime, 100));
  if (!str(d.name, 200) || !d.name.trim()) return false;
  if (type === 'store') return ['district', 'city', 'channel', 'attr', 'contact'].every(k => str(d[k], 500)) && ['address', 'mapUrl'].every(k => d[k] === undefined || str(d[k], 2000)) && (d.lists === undefined || Array.isArray(d.lists) && d.lists.length <= 2000 && d.lists.every(x => str(x, 200)));
  if (type === 'person') return str(d.role, 500) && str(d.desc) && typeof d.confirmed === 'boolean' && str(d.sameAs ?? '', 100);
  return str(d.desc);
}
export function validateBundle(b) {
  if (!plain(b) || ![1, 2].includes(b.schema) || !str(b.vaultId, 100) || !Array.isArray(b.ops) || b.ops.length > 30000 || !plain(b.blobs)) throw new Error('資料庫格式不符，或需要更新至支援此資料的程式版本。');
  const seen = new Map(), sourceEntities = new Set();
  for (const o of b.ops) {
    if (!plain(o) || !str(o.id, 100) || !o.id || seen.has(o.id) || !types.includes(o.type) || !str(o.entity, 100) || !ids(o.parents) || new Set(o.parents).size !== o.parents.length || !str(o.device, 100) || !str(o.at, 40) || typeof o.deleted !== 'boolean' || !validData(o.type, o.data)) throw new Error('紀錄或版本資訊不完整。');
    if (o.type === 'source' && (o.deleted || o.parents.length || sourceEntities.has(o.entity))) throw new Error('原始來源快照只能新增一次，不能修改或刪除。');
    if (o.type === 'source') sourceEntities.add(o.entity);
    seen.set(o.id, o);
  }
  for (const o of b.ops) for (const p of o.parents) {
    const parent = seen.get(p);
    if (!parent || parent.entity !== o.entity || parent.type !== o.type || parent.id === o.id) throw new Error('版本鏈結不完整。');
  }
  // Kahn's algorithm checks cycles without recursive stack growth.
  const degree = new Map(b.ops.map(o => [o.id, o.parents.length])), children = new Map();
  for (const o of b.ops) for (const p of o.parents) { if (!children.has(p)) children.set(p, []); children.get(p).push(o.id); }
  const queue = b.ops.filter(o => !o.parents.length).map(o => o.id); let count = 0;
  for (let i = 0; i < queue.length; i++) { count++; for (const c of children.get(queue[i]) || []) { degree.set(c, degree.get(c) - 1); if (!degree.get(c)) queue.push(c); } }
  if (count !== b.ops.length) throw new Error('版本鏈結形成循環。');
  for (const [id, blob] of Object.entries(b.blobs)) if (!/^[a-f0-9]{64}$/.test(id) || typeof blob !== 'string' || blob.length > 4200000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(blob)) throw new Error('附件格式或大小不符。');
  for (const o of b.ops) if (o.type === 'visit') for (const a of o.data.attachments) if (!Object.hasOwn(b.blobs, a.blob)) throw new Error('附件不完整，停止合併。');
  for (const o of b.ops) for (const s of o.data.csvSources || []) if (!Object.hasOwn(b.blobs, s.blob)) throw new Error('匯入原始 CSV 不完整，停止合併。');
  for (const o of b.ops) if (o.type === 'source' && !Object.hasOwn(b.blobs, o.data.blob)) throw new Error('原始 CSV 快照缺少檔案內容，停止合併。');
  return b;
}
export function merge(a, b) {
  validateBundle(a); validateBundle(b);
  if (a.vaultId !== b.vaultId) throw new Error('這是不同的資料庫，不能直接合併。');
  const all = new Map(a.ops.map(o => [o.id, o]));
  for (const o of b.ops) { if (all.has(o.id) && JSON.stringify(all.get(o.id)) !== JSON.stringify(o)) throw new Error('相同版本編號的內容不同，停止同步。'); all.set(o.id, o); }
  const blobs = { ...a.blobs };
  for (const [id, data] of Object.entries(b.blobs)) { if (Object.hasOwn(blobs, id) && blobs[id] !== data) throw new Error('附件識別衝突。'); blobs[id] = data; }
  return validateBundle({ schema: Math.max(a.schema, b.schema), vaultId: a.vaultId, ops: [...all.values()].sort((x, y) => x.id.localeCompare(y.id)), blobs });
}
export function project(b) {
  const groups = new Map(), superseded = new Set(b.ops.flatMap(o => o.parents));
  for (const o of b.ops) { const k = `${o.type}:${o.entity}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
  return [...groups.values()].map(versions => {
    const heads = versions.filter(o => !superseded.has(o.id)).sort((a, b) => a.id.localeCompare(b.id));
    const current = heads.find(o => !o.deleted) || heads[0];
    return { ...current.data, id: current.entity, type: current.type, deleted: current.deleted, conflict: heads.length > 1, heads, versions };
  });
}
export function revision(type, entity, data, parents, device, deleted = false) {
  if (!validData(type, data)) throw new Error('欄位內容不完整或超過長度限制。');
  return { id: uuid(), type, entity, data: structuredClone(data), parents: [...parents], device, deleted, at: new Date().toISOString() };
}
export async function hashBytes(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join(''); }
