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

const mergeDiffSegments = segments => {
  const out = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const last = out.at(-1);
    if (last?.kind === segment.kind) last.text += segment.text;
    else out.push({ kind: segment.kind, text: segment.text });
  }
  return out;
};
function inlineDiff(before, after) {
  const a = [...before], b = [...after]; let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1, endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const prefix = a.slice(0, start).join(''), suffix = a.slice(endA + 1).join('');
  return {
    before: mergeDiffSegments([
      { kind: 'same', text: prefix },
      { kind: 'removed', text: a.slice(start, endA + 1).join('') },
      { kind: 'same', text: suffix }
    ]),
    after: mergeDiffSegments([
      { kind: 'same', text: prefix },
      { kind: 'added', text: b.slice(start, endB + 1).join('') },
      { kind: 'same', text: suffix }
    ])
  };
}
// Display-only text diff for the quick-edit confirmation screen.
// It never rewrites either input. Normal notes use a line LCS, then highlight the changed
// portion within paired replacement lines. Very large comparisons fall back to a safe
// prefix/suffix diff rather than allocating an unbounded matrix.
export function diffTextSegments(before, after) {
  before = String(before ?? ''); after = String(after ?? '');
  if (before === after) return { before: [{ kind: 'same', text: before }], after: [{ kind: 'same', text: after }] };
  const oldLines = before.split('\n'), newLines = after.split('\n');
  if (oldLines.length * newLines.length > 120000) return inlineDiff(before, after);
  const rows = Array.from({ length: oldLines.length + 1 }, () => new Uint16Array(newLines.length + 1));
  for (let i = oldLines.length - 1; i >= 0; i--) for (let j = newLines.length - 1; j >= 0; j--) {
    rows[i][j] = oldLines[i] === newLines[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  }
  const ops = []; let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) { ops.push({ kind: 'same', old: oldLines[i], next: newLines[j] }); i++; j++; }
    else if (j < newLines.length && (i === oldLines.length || rows[i][j + 1] >= rows[i + 1][j])) { ops.push({ kind: 'added-line', next: newLines[j++] }); }
    else { ops.push({ kind: 'removed-line', old: oldLines[i++] }); }
  }
  const beforeSegments = [], afterSegments = [];
  const pushLine = (target, segments, needsBreak) => {
    if (needsBreak) target.push({ kind: 'same', text: '\n' });
    target.push(...segments);
  };
  let beforeLine = 0, afterLine = 0, k = 0;
  while (k < ops.length) {
    if (ops[k].kind === 'same') {
      pushLine(beforeSegments, [{ kind: 'same', text: ops[k].old }], beforeLine++ > 0);
      pushLine(afterSegments, [{ kind: 'same', text: ops[k].next }], afterLine++ > 0);
      k++; continue;
    }
    const removed = [], added = [];
    while (k < ops.length && ops[k].kind !== 'same') {
      if (ops[k].kind === 'removed-line') removed.push(ops[k].old);
      else added.push(ops[k].next);
      k++;
    }
    const count = Math.max(removed.length, added.length);
    for (let n = 0; n < count; n++) {
      if (n < removed.length && n < added.length) {
        const changed = inlineDiff(removed[n], added[n]);
        pushLine(beforeSegments, changed.before, beforeLine++ > 0);
        pushLine(afterSegments, changed.after, afterLine++ > 0);
      } else if (n < removed.length) {
        pushLine(beforeSegments, [{ kind: 'removed', text: removed[n] }], beforeLine++ > 0);
      } else {
        pushLine(afterSegments, [{ kind: 'added', text: added[n] }], afterLine++ > 0);
      }
    }
  }
  return { before: mergeDiffSegments(beforeSegments), after: mergeDiffSegments(afterSegments) };
}
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
  if (d.mergedInto !== undefined && (type !== 'store' || !str(d.mergedInto, 100) || !d.mergedInto)) return false;
  if (d.mergeDecision !== undefined && (type !== 'store' || !str(d.mergeDecision, 200) || !d.mergeDecision)) return false;
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
  if (type === 'store') return ['district', 'city', 'channel', 'attr', 'contact'].every(k => str(d[k], 500)) && ['address', 'mapUrl', 'nextRemember', 'everyTimeMust'].every(k => d[k] === undefined || str(d[k], 2000)) && (d.lists === undefined || Array.isArray(d.lists) && d.lists.length <= 2000 && d.lists.every(x => str(x, 200)));
  if (type === 'person') return str(d.role, 500) && str(d.desc) && typeof d.confirmed === 'boolean' && str(d.sameAs ?? '', 100);
  return str(d.desc);
}
export function validateBundle(b) {
  if (!plain(b) || ![1, 2].includes(b.schema) || !str(b.vaultId, 100) || !Array.isArray(b.ops) || b.ops.length > 30000 || !plain(b.blobs)) throw new Error('資料庫格式不符，或需要更新至支援此資料的程式版本。');
  const seen = new Map(), sourceEntities = new Map();
  for (const o of b.ops) {
    if (!plain(o) || !str(o.id, 100) || !o.id || seen.has(o.id) || !types.includes(o.type) || !str(o.entity, 100) || !ids(o.parents) || new Set(o.parents).size !== o.parents.length || !str(o.device, 100) || !str(o.at, 40) || typeof o.deleted !== 'boolean' || !validData(o.type, o.data)) throw new Error('紀錄或版本資訊不完整。');
    if (o.type === 'source' && (o.deleted || o.parents.length || sourceEntities.has(o.entity))) throw new Error('原始來源快照只能新增一次，不能修改或刪除。');
    if (o.type === 'source') sourceEntities.set(o.entity, o);
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
  for (const o of b.ops) for (const s of o.data.csvSources || []) {
    if (!Object.hasOwn(b.blobs, s.blob)) throw new Error('匯入原始 CSV 不完整，停止合併。');
    if (s.sourceSnapshot !== undefined) { const snapshot = sourceEntities.get(s.sourceSnapshot); if (!snapshot || snapshot.data.blob !== s.blob) throw new Error('來源列與原始 CSV 快照連結不完整，停止合併。'); }
  }
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
export function readonlyHealthAudit(input) {
  const now = Number.isFinite(input.now) ? input.now : Date.now(), week = 7 * 24 * 60 * 60 * 1000;
  const age = value => { const time = Date.parse(value || ''); return Number.isFinite(time) ? now - time : null; };
  const checks = [];
  if (input.pendingUnknown) checks.push({ code: 'pending-unknown', level: 'warning', text: '待同步數量尚未建立精確基準；完成一次同步後即可精確計算。' });
  else if (input.pendingCount > 0) checks.push({ code: 'pending', level: 'action', text: `${input.pendingCount} 筆資料等待 Mac 確認。` });
  else checks.push({ code: 'pending', level: 'ok', text: '沒有資料等待 Mac 確認。' });
  checks.push(input.conflicts > 0 ? { code: 'conflicts', level: 'action', text: `${input.conflicts} 筆同步衝突待核對。` } : { code: 'conflicts', level: 'ok', text: '沒有待核對衝突。' });
  checks.push(input.identityPending > 0 ? { code: 'identity', level: 'action', text: `${input.identityPending} 間門市身分待確認。` } : { code: 'identity', level: 'ok', text: '沒有門市身分待確認。' });
  const syncAge = age(input.lastSync);
  checks.push(syncAge === null ? { code: 'sync-age', level: 'warning', text: '這台裝置尚未完成成功同步。' } : syncAge > week ? { code: 'sync-age', level: 'warning', text: '最近成功同步已超過 7 天。' } : { code: 'sync-age', level: 'ok', text: '最近 7 天內曾成功同步。' });
  const backupAge = age(input.lastBackup);
  checks.push(backupAge === null ? { code: 'backup-age', level: 'warning', text: '這台裝置尚無由 App 匯出加密備份的紀錄。' } : backupAge > week ? { code: 'backup-age', level: 'warning', text: '最近由 App 匯出加密備份已超過 7 天。' } : { code: 'backup-age', level: 'ok', text: '最近 7 天內曾由 App 匯出加密備份。' });
  if (!input.macVersion) checks.push({ code: 'program', level: 'info', text: 'Mac 程式版本尚待連線確認。' });
  else checks.push(input.macVersion === input.appVersion ? { code: 'program', level: 'ok', text: `本機與 Mac 程式版本一致（v${input.appVersion}）。` } : { code: 'program', level: 'warning', text: `版本不一致：本機 v${input.appVersion}，Mac v${input.macVersion}。` });
  const attention = checks.filter(check => ['action', 'warning'].includes(check.level)).length;
  return { checkedAt: new Date(now).toISOString(), attention, state: attention ? 'attention' : checks.some(check => check.level === 'info') ? 'partial' : 'healthy', checks };
}
export async function hashBytes(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join(''); }

// Nearby-store calculations are read-only. Map viewports and opaque place IDs are
// not coordinates of a store, and must never be guessed into distance rankings.
export function mobileLocationDevice(nav = {}) {
  return /iPhone|iPad|iPod|Android/i.test(nav.userAgent || '') ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}
export function validCoordinates(latitude, longitude) {
  return typeof latitude === 'number' && typeof longitude === 'number' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}
export function distanceMeters(a, b) {
  const rad = Math.PI / 180, dlat = (b.latitude - a.latitude) * rad, dlon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dlon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, h))), Math.sqrt(Math.max(0, 1 - h)));
}
export function mapCoordinates(value) {
  let url; try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['www.google.com', 'maps.google.com', 'www.google.com.tw', 'maps.google.com.tw'].includes(url.hostname)) return null;
  if (!url.hostname.startsWith('maps.') && !/^\/maps(?:\/|$)/.test(url.pathname)) return null;
  let text; try { text = decodeURIComponent(url.pathname + url.search + url.hash); } catch { return null; }
  const points = [...text.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)(?=[!&#/?]|$)/g)]
    .map(m => ({ latitude: Number(m[1]), longitude: Number(m[2]) }));
  if (!points.length) {
    // Only an explicit coordinate pin, never ll= or @ camera center.
    for (const field of ['query', 'q']) {
      const m = (url.searchParams.get(field) || '').trim().match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
      if (m) points.push({ latitude: Number(m[1]), longitude: Number(m[2]) });
    }
  }
  if (!points.length || points.some(p => !validCoordinates(p.latitude, p.longitude)) || points.some(p => distanceMeters(points[0], p) > 25)) return null;
  return points[0];
}
export function storeCoordinates(store) {
  const direct = mapCoordinates(store.mapUrl || '');
  if (direct) return direct;
  const points = [];
  for (const source of store.csvSources || []) {
    for (let i = 0; i < (source.headers || []).length; i++) {
      if (!/^(網址|地圖網址|google\s*maps(?:\s*網址)?|url|map\s*url)$/i.test(source.headers[i].trim())) continue;
      const p = mapCoordinates(source.cells?.[i] || ''); if (p) points.push(p);
    }
  }
  if (!points.length || points.some(p => distanceMeters(points[0], p) > 25)) return null;
  return points[0];
}
export function nearestStores(stores, position, limit = 3) {
  if (!validCoordinates(position?.latitude, position?.longitude)) return [];
  return stores.filter(s => !s.deleted && !s.conflict).map(store => ({ store, point: storeCoordinates(store) }))
    .filter(x => x.point).map(({ store, point }) => ({ store, distance: distanceMeters(position, point) }))
    .sort((a, b) => a.distance - b.distance || a.store.name.localeCompare(b.store.name, 'zh-Hant') || a.store.id.localeCompare(b.store.id))
    .slice(0, limit);
}


// Coordinate review packages are private local inputs, never bundled with code.
export function coordinateFeature(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !['www.google.com','maps.google.com','www.google.com.tw','maps.google.com.tw'].includes(u.hostname)) return '';
    if (!u.hostname.startsWith('maps.') && !/^\/maps(?:\/|$)/.test(u.pathname)) return '';
    const matches = [...decodeURIComponent(u.pathname + u.search).matchAll(/!1s(0x[a-f0-9]+:0x[a-f0-9]+)(?=[!&#/?]|$)/gi)].map(m => m[1].toLowerCase());
    const ftid = u.searchParams.get('ftid'); if (/^0x[a-f0-9]+:0x[a-f0-9]+$/i.test(ftid || '')) matches.push(ftid.toLowerCase());
    return matches.length && new Set(matches).size === 1 ? matches[0] : '';
  } catch { return ''; }
}
export function validateCoordinateReview(input) {
  const fail = () => { throw new Error('座標補查檔案格式或地點證據不完整，未修改資料。'); };
  if (!input || input.format !== 'pharmacy-coordinate-review-1' || !Array.isArray(input.items) || !input.items.length || input.items.length > 2000) fail();
  const seen = new Set();
  const items = input.items.map(item => {
    if (!item || typeof item.featureId !== 'string' || !/^0x[a-f0-9]+:0x[a-f0-9]+$/.test(item.featureId) || seen.has(item.featureId) || typeof item.resolvedUrl !== 'string' || item.resolvedUrl.length > 2000 || coordinateFeature(item.resolvedUrl) !== item.featureId || typeof item.googleName !== 'string' || !item.googleName.trim() || item.googleName.length > 500 || !Array.isArray(item.sourceNames) || !item.sourceNames.length || item.sourceNames.length > 100 || item.sourceNames.some(n => typeof n !== 'string' || n.length > 500) || !Number.isFinite(Date.parse(item.checkedAt))) fail();
    const point = mapCoordinates(item.resolvedUrl);
    if (!point || !validCoordinates(item.latitude,item.longitude) || Math.abs(point.latitude-item.latitude)>1e-8 || Math.abs(point.longitude-item.longitude)>1e-8) fail();
    if (item.address != null && (typeof item.address !== 'string' || item.address.length > 2000)) fail();
    seen.add(item.featureId);
    return { featureId:item.featureId, mapUrl:item.resolvedUrl, googleName:item.googleName, sourceNames:[...item.sourceNames], checkedAt:item.checkedAt, address:item.address || '', point };
  });
  return items;
}
export function planCoordinates(bundle, input) {
  validateBundle(bundle);
  const items = validateCoordinateReview(input), lookup = new Map(items.map(i => [i.featureId,i]));
  const stores = project(bundle).filter(s => s.type === 'store' && (!s.deleted || s.conflict));
  const evidence = store => {
    const urls = (store.csvSources || []).flatMap(s => s.headers.flatMap((h,i) => /^(網址|地圖網址|google\s*maps(?:\s*網址)?|url|map\s*url)$/i.test(h.trim()) ? [s.cells[i]] : []));
    const direct = coordinateFeature(store.mapUrl || '');
    const ids = [...new Set([direct,...urls.map(coordinateFeature)].filter(Boolean))];
    return {id:ids.length===1 ? ids[0] : '', ambiguous:ids.length>1 || !!store.mapUrl && !direct};
  };
  const evidenceById = new Map(stores.map(s => [s.id,evidence(s)]));
  const counts = new Map(); for (const e of evidenceById.values()) if(e.id) counts.set(e.id,(counts.get(e.id)||0)+1);
  const changes=[], skipped=[];
  for (const store of stores) {
    const e=evidenceById.get(store.id), item=lookup.get(e.id);
    let reason='';
    if(store.conflict || store.csvIdentityPending || store.deleted || store.mergedInto) reason='版本衝突或身分待確認';
    else if(e.ambiguous) reason='地圖識別不一致或人工連結無法核對';
    else if(!item) reason='補查檔案沒有相同地點識別碼';
    else if(counts.get(e.id)>1) reason='相同地點識別碼對應多筆門市，需核對';
    else if(store.name.trim()!==item.googleName.trim() || !item.sourceNames.some(n=>n.trim()===item.googleName.trim())) reason='名稱變動，需重新核對身分';
    else if(store.address?.trim() && store.address.trim() !== item.address.trim()) reason='現有地址與 Google 地址不同，需核對';
    else {
      const old=storeCoordinates(store);
      if(old) reason=distanceMeters(old,item.point)<=25 ? '已有可靠座標，不需修改' : '現有座標與補查結果不一致';
      // Check each source separately: an ambiguous aggregate must not hide disagreement.
      else if((store.csvSources||[]).some(source=>source.headers.some((h,i)=>/^(網址|地圖網址|google\s*maps(?:\s*網址)?|url|map\s*url)$/i.test(h.trim()) && mapCoordinates(source.cells[i]) && distanceMeters(mapCoordinates(source.cells[i]),item.point)>25))) reason='來源座標不一致';
    }
    if(reason) skipped.push({id:store.id,name:store.name,reason});
    else changes.push({id:store.id,name:store.name,parents:store.heads.map(h=>h.id).sort(),before:store.mapUrl||'',after:item.mapUrl,point:item.point,checkedAt:item.checkedAt});
  }
  return {vaultId:bundle.vaultId,changes,skipped};
}
export function applyCoordinates(bundle, input, expected, device) {
  const current=planCoordinates(bundle,input);
  if(JSON.stringify(current)!==JSON.stringify(expected)) throw new Error('資料或補查結果已改變，請重新預覽；尚未套用。');
  const next=structuredClone(bundle), stores=new Map(project(bundle).map(s=>[s.id,s]));
  for(const change of current.changes) {
    const store=stores.get(change.id);
    next.ops.push(revision('store',store.id,{...store.heads[0].data,mapUrl:change.after},change.parents,device));
  }
  return validateBundle(next);
}
