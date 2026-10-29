export const FORMAT = 'pharmacy-vault-1';
export const ITERATIONS = 600000;
export const MAX_BYTES = 24 * 1024 * 1024;
export const NEXT_REMINDER_OPTIONS = Object.freeze(['HAUD', 'Complete', '陳列盒（中）', '陳列盒（小）']);
function reminderItem(value) { return String(value ?? '').replace(/[\r\n]+/g, ' ').trim(); }
export function reminderHasOption(value, option) {
  const item = reminderItem(option);
  return !!item && String(value ?? '').split(/\r\n|\n|\r/).some(line => line.trim() === item);
}
export function setReminderOption(value, option, selected) {
  const source = String(value ?? ''), item = reminderItem(option);
  if (!item) return source;
  if (selected) {
    if (reminderHasOption(source, item)) return source;
    if (!source) return item;
    return source + (/[\r\n]$/.test(source) ? '' : source.includes('\r\n') ? '\r\n' : '\n') + item;
  }
  if (!reminderHasOption(source, item)) return source;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source.split(/\r\n|\n|\r/).filter(line => line.trim() !== item).join(newline);
}
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
const taskTime = value => str(value, 40) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const attendanceCalendar = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', era: 'short' });
function attendanceInstant(value) {
  if (!taskTime(value)) return false;
  return new Date(value).toISOString() === value;
}
export function attendanceTaipeiDate(value) {
  const timestamp = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : attendanceInstant(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) throw new Error('拜訪確認時間不正確。');
  const instant = new Date(timestamp);
  if (!Number.isFinite(instant.getTime())) throw new Error('拜訪確認時間不正確。');
  const parts = Object.fromEntries(attendanceCalendar.formatToParts(instant).map(part => [part.type, part.value]));
  const date = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
  if (parts.era !== 'AD' || !/^\d{4}-\d\d-\d\d$/.test(date)) throw new Error('拜訪確認日期超出支援範圍。');
  return date;
}
export function makeVisitAttendance(store, at = new Date().toISOString()) {
  if (!str(store, 100) || !store.trim() || !attendanceInstant(at)) throw new Error('拜訪確認資料不完整。');
  return { store, date: attendanceTaipeiDate(at), at };
}
function validVisitAttendance(op) {
  const attendance = op?.visitAttendance;
  if (!plain(attendance) || Object.keys(attendance).length !== 3 || !['store', 'date', 'at'].every(field => Object.hasOwn(attendance, field)) ||
      !str(attendance.store, 100) || !attendance.store.trim() || !attendanceInstant(attendance.at) || attendance.at !== op.at ||
      op.deleted !== false || !str(op.entity, 100) || !op.entity.trim() ||
      !(op.type === 'store' && op.entity === attendance.store || op.type === 'visit' && op.data?.store === attendance.store)) return false;
  try { return attendance.date === attendanceTaipeiDate(attendance.at); } catch { return false; }
}
// Read evidence from all retained revisions, not only the current head. A later
// ordinary edit or restore neither copies an attendance event nor erases it.
// Bundles are validated at their input boundary; this read never validates or
// rewrites the full graph, and ignores malformed attendance evidence locally.
export function visitAttendanceForStore(bundle, storeId, now = Date.now()) {
  const today = attendanceTaipeiDate(now), dates = new Map(), ops = Array.isArray(bundle?.ops) ? bundle.ops : [];
  for (const op of ops) {
    if (op?.visitAttendance?.store !== storeId || !str(op.id, 100) || !op.id || !validVisitAttendance(op) || !validData(op.type, op.data)) continue;
    const attendance = op.visitAttendance;
    if (!dates.has(attendance.date)) dates.set(attendance.date, []);
    dates.get(attendance.date).push({ entityId: op.entity, type: op.type, revisionId: op.id, at: attendance.at });
  }
  const history = [...dates].sort(([a], [b]) => b.localeCompare(a)).map(([date, occurrences]) => ({ date, occurrences: occurrences.sort((a, b) => b.at.localeCompare(a.at) || b.revisionId.localeCompare(a.revisionId)) }));
  const latestDate = history[0]?.date || '', hasFutureDates = !!latestDate && latestDate > today;
  // Compare UTC ordinals of the two Taipei calendar dates, not elapsed hours.
  const daysSince = !latestDate || hasFutureDates ? null : (Date.parse(today + 'T00:00:00.000Z') - Date.parse(latestDate + 'T00:00:00.000Z')) / 86400000;
  return { today, latestDate, daysSince, hasFutureDates, history };
}

// Membership is explicit for one calendar month and remains independent of
// attendance. Optional store data keeps schema-2 backup/sync append-only; opening
// a new month never copies a roster or creates a visit confirmation.
export function monthlyVisitMonth(value = Date.now()) {
  if (typeof value === 'string' && /^\d{4}-\d\d$/.test(value)) {
    if (value.startsWith('0000') || Number(value.slice(5)) < 1 || Number(value.slice(5)) > 12) throw new Error('每月拜訪月份不正確。');
    return value;
  }
  return attendanceTaipeiDate(value).slice(0, 7);
}
export function shiftMonthlyVisitMonth(month, delta) {
  month = monthlyVisitMonth(month);
  if (!Number.isSafeInteger(delta) || Math.abs(delta) > 120000) throw new Error('每月拜訪月份位移不正確。');
  const ordinal = (Number(month.slice(0, 4)) - 1) * 12 + Number(month.slice(5)) - 1 + delta;
  if (ordinal < 0 || ordinal >= 9999 * 12) throw new Error('每月拜訪月份超出支援範圍。');
  return `${String(Math.floor(ordinal / 12) + 1).padStart(4, '0')}-${String(ordinal % 12 + 1).padStart(2, '0')}`;
}
const validMonthlyVisitMonth = value => {
  try { return typeof value === 'string' && /^\d{4}-\d\d$/.test(value) && monthlyVisitMonth(value) === value; } catch { return false; }
};
function validMonthlyVisits(entries) {
  return Array.isArray(entries) && entries.length <= 1000 && new Set(entries.map(entry => entry?.month)).size === entries.length
    && entries.every(entry => plain(entry) && Object.keys(entry).sort().join(',') === 'active,month,updatedAt'
      && validMonthlyVisitMonth(entry.month) && typeof entry.active === 'boolean' && attendanceInstant(entry.updatedAt));
}
export function monthlyVisitForStore(store, month) {
  month = monthlyVisitMonth(month);
  const entries = store?.monthlyVisits;
  if (entries === undefined || !validMonthlyVisits(entries)) return null;
  const entry = entries.find(entry => entry.month === month);
  return entry ? structuredClone(entry) : null;
}
function monthlyVisitUnavailable(store) {
  if (store.mergedInto) return '門市已整併，每月名單歸屬需另行核對';
  if (store.deleted) return '門市已在回收桶，保留每月名單供核對';
  if (store.conflict) return '門市有同步衝突，請先核對版本';
  if (store.csvIdentityPending) return '門市身分待確認，暫不判定本月完成';
  return '';
}
function historicalMonthlyVisit(store, month) {
  // Walk parent links instead of trusting clocks: two saves can share one
  // timestamp, and a device clock may move backwards. The first surviving
  // membership on each ancestry branch is the nearest historical decision.
  const index = new Map(store.versions.map(op => [op.id, op])), queue = [...store.heads], seen = new Set(), entries = [];
  for (let i = 0; i < queue.length; i++) {
    const op = queue[i];
    if (!op || seen.has(op.id)) continue;
    seen.add(op.id);
    const entry = monthlyVisitForStore(op.data, month);
    if (entry) entries.push(entry);
    else queue.push(...op.parents.map(id => index.get(id)));
  }
  const conflicting = new Set(entries.map(entry => entry.active)).size > 1;
  return { entry: entries.find(entry => entry.active) || entries[0] || null, conflicting };
}
export function monthlyVisitOverview(bundle, month, now = Date.now()) {
  month = monthlyVisitMonth(month);
  const today = attendanceTaipeiDate(now), past = month < today.slice(0, 7), stores = [], removedStores = [];
  for (const store of project(bundle).filter(record => record.type === 'store')) {
    let entry = monthlyVisitForStore(store, month), historical = false, historicalConflict = false;
    // A restored older store version cannot erase the evidence of past rosters.
    // Current/future memberships use current heads only, never a historical guess.
    if (!entry && past) {
      const previous = historicalMonthlyVisit(store, month);
      entry = previous.entry; historical = !!entry; historicalConflict = previous.conflicting;
    }
    // Any active conflicting head keeps a visible warning row. Do not quietly
    // choose the removed branch or claim completion while identity is uncertain.
    if (!entry?.active && store.conflict) {
      const active = store.heads.map(head => monthlyVisitForStore(head.data, month)).find(candidate => candidate?.active);
      if (active) { entry = active; historical = false; }
    }
    if (!entry) continue;
    const unavailableReason = monthlyVisitUnavailable(store) || (historicalConflict ? '保留的每月名單歷史不一致，請先核對版本' : ''), available = !unavailableReason;
    const dates = visitAttendanceForStore(bundle, store.id, now).history.map(item => item.date).filter(date => date.slice(0, 7) === month && date <= today);
    const row = { storeId: store.id, name: store.name, district: store.district, channel: store.channel,
      available, unavailableReason, active: entry.active, historical, dates, completed: available && dates.length > 0 };
    (entry.active ? stores : removedStores).push(row);
  }
  const compare = (a, b) => a.district.localeCompare(b.district, 'zh-Hant') || a.name.localeCompare(b.name, 'zh-Hant') || a.storeId.localeCompare(b.storeId);
  stores.sort(compare); removedStores.sort(compare);
  const completed = stores.filter(row => row.completed), pending = stores.filter(row => !row.completed);
  return { month, today, past, stores, removedStores, pending, completed, total: stores.length, completedCount: completed.length };
}
// Include all store heads: an open picker must not write over a newly changed
// store, even if that store was not yet selected for this month.
export function monthlyVisitBasis(records, month) {
  month = monthlyVisitMonth(month);
  return JSON.stringify({ month, stores: records.filter(record => record.type === 'store').map(store => [store.id, store.heads.map(head => head.id).sort()]).sort((a, b) => a[0].localeCompare(b[0])) });
}
export function applyMonthlyVisitAction(bundle, request, device, at = new Date().toISOString()) {
  validateBundle(bundle);
  if (!attendanceInstant(at) || !str(device, 100) || !device.trim() || !plain(request)
    || Object.keys(request).sort().join(',') !== 'action,expectedBasis,month,storeId'
    || !validMonthlyVisitMonth(request.month) || !str(request.storeId, 100) || !request.storeId.trim()
    || typeof request.expectedBasis !== 'string' || !['add', 'remove'].includes(request.action)) throw new Error('每月名單修改資料不完整，尚未寫入。');
  const { month, storeId, action, expectedBasis } = request, records = project(bundle);
  if (month < monthlyVisitMonth(at)) throw new Error('過去月份保留歷史，不能新增或移除必訪門市。');
  if (monthlyVisitBasis(records, month) !== expectedBasis) throw new Error('門市或每月名單已有新版本，請重新開啟名單；尚未寫入。');
  const store = records.find(record => record.type === 'store' && record.id === storeId);
  if (!store || monthlyVisitUnavailable(store)) throw new Error('每月名單門市不存在、已刪除、整併、身分待確認或有衝突；請先核對。');
  const before = monthlyVisitForStore(store, month), active = action === 'add';
  if (before?.active === active || !before && !active) return bundle;
  const data = structuredClone(store.heads[0].data);
  data.monthlyVisits = [...(data.monthlyVisits || []).filter(entry => entry.month !== month), { month, active, updatedAt: at }].sort((a, b) => a.month.localeCompare(b.month));
  if (!validMonthlyVisits(data.monthlyVisits)) throw new Error('每月名單超過安全上限，全部歷史保留，本次尚未寫入。');
  const next = structuredClone(bundle), op = revision('store', storeId, data, store.heads.map(head => head.id), device);
  op.at = at; next.ops.push(op); validateBundle(next);
  if (enc.encode(JSON.stringify(next)).length > MAX_BYTES) throw new Error('每月名單儲存後資料超過 24 MB 上限；全部原資料保留，本次尚未寫入。');
  return next;
}
function validReminderTasks(d) {
  const tasks = d.nextRememberTasks;
  if (tasks !== undefined && (!Array.isArray(tasks) || tasks.length > 1000 || !tasks.every(t => plain(t) && str(t.id, 100) && t.id && str(t.text, 2000) && t.text.trim() && taskTime(t.createdAt) && (t.completedAt === '' || taskTime(t.completedAt))) || new Set(tasks.map(t => t.id)).size !== tasks.length)) return false;
  const imports = d.nextRememberImports;
  return imports === undefined || Array.isArray(imports) && imports.length <= 1000 && imports.every(item => plain(item) && str(item.text, 2000) && item.text.trim() && taskTime(item.at) && Array.isArray(item.taskIds) && item.taskIds.length > 0 && item.taskIds.length <= 1000 && new Set(item.taskIds).size === item.taskIds.length && item.taskIds.every(id => str(id, 100) && tasks?.some(t => t.id === id)));
}
// Split only at explicit line breaks. Keep exact source bytes in the import record.
export function reminderTaskLines(text) {
  if (!str(text, 2000)) throw new Error('新增待辦最多 2000 個字；尚未寫入。');
  return text.split(/\r\n|\n|\r/).filter(line => line.trim());
}
export function addReminderTasks(data, text, at = new Date().toISOString(), makeId = uuid) {
  if (!validReminderTasks(data) || !taskTime(at)) throw new Error('任務資料格式不符，尚未寫入。');
  const lines = reminderTaskLines(text), next = structuredClone(data);
  if (!lines.length) return next;
  next.nextRememberTasks = [...(next.nextRememberTasks || []), ...lines.map(line => ({ id: makeId(), text: line, createdAt: at, completedAt: '' }))];
  if (!validReminderTasks(next)) throw new Error('任務超過 1000 項或識別重複；歷史保留，本次尚未加入。');
  return next;
}
export function convertReminderTasks(data, at = new Date().toISOString(), makeId = uuid) {
  const text = data.nextRemember || '', lines = reminderTaskLines(text);
  if (!lines.length) return structuredClone(data);
  const next = addReminderTasks(data, text, at, makeId);
  next.nextRememberImports = [...(next.nextRememberImports || []), { text, at, taskIds: next.nextRememberTasks.slice(-lines.length).map(t => t.id) }];
  next.nextRemember = '';
  if (!validReminderTasks(next)) throw new Error('轉換歷史超過上限，原提醒保留，本次尚未轉換。');
  return next;
}
export function completeReminderTask(data, taskId, at = new Date().toISOString()) {
  if (!validReminderTasks(data) || !taskTime(at)) throw new Error('任務資料格式不符，尚未寫入。');
  const next = structuredClone(data), task = next.nextRememberTasks?.find(t => t.id === taskId);
  if (!task) throw new Error('找不到這項任務，請重新開啟門市。');
  if (!task.completedAt) task.completedAt = at;
  return next;
}
// Completion evidence remains inspectable even after an explicit store-version restore.
export function reminderTaskHistory(record) {
  const history = new Map(), current = record.nextRememberTasks || [];
  for (const data of [...(record.versions || []).map(v => v.data), record]) for (const task of data.nextRememberTasks || []) {
    if (!task.completedAt) continue;
    const key = JSON.stringify([task.id, task.completedAt, task.text]);
    history.set(key, { ...task, historical: !current.some(t => t.id === task.id && t.completedAt === task.completedAt && t.text === task.text) });
  }
  return [...history.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt) || a.id.localeCompare(b.id));
}

// Day plans are an optional store field so schema-2 clients can preserve them
// without introducing an entity type that would block their entire sync bundle.
// They are preparation evidence only: never visitAttendance or task completion.
export function dayPlanDate(value = Date.now()) {
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)) {
    const parsed = new Date(value + 'T00:00:00.000Z');
    if (value.startsWith('0000') || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('行程日期不正確。');
    return value;
  }
  return attendanceTaipeiDate(value);
}
export function shiftDayPlanDate(date, days) {
  if (!Number.isSafeInteger(days) || Math.abs(days) > 36600) throw new Error('行程日期位移不正確。');
  const instant = new Date(dayPlanDate(date) + 'T00:00:00.000Z');
  instant.setUTCDate(instant.getUTCDate() + days);
  return dayPlanDate(instant.toISOString().slice(0, 10));
}
const validPlanDate = value => { try { return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && dayPlanDate(value) === value; } catch { return false; } };
const validPlanSource = source => plain(source) && Object.keys(source).sort().join(',') === 'id,kind,text' && ['task', 'legacy', 'every'].includes(source.kind) && str(source.id, 100) && !!source.id && str(source.text, 2000) && !!source.text.trim();
export function dayPlanSourceKey(source) { return JSON.stringify([source?.kind, source?.id, source?.text]); }
export function dayPlanSources(store) {
  const sources = (store?.nextRememberTasks || []).filter(task => !task.completedAt).map(task => ({ kind: 'task', id: task.id, text: task.text }));
  for (const [kind, field] of [['legacy', 'nextRemember'], ['every', 'everyTimeMust']]) {
    String(store?.[field] || '').split(/\r\n|\n|\r/).forEach((text, index) => { if (text.trim()) sources.push({ kind, id: String(index), text }); });
  }
  return sources;
}
const validPlanSources = sources => Array.isArray(sources) && sources.length <= 3000 && sources.every(validPlanSource) && new Set(sources.map(dayPlanSourceKey)).size === sources.length;
function validDatePlans(plans) {
  return Array.isArray(plans) && plans.length <= 1000 && new Set(plans.map(plan => plan?.date)).size === plans.length && plans.every(plan => plain(plan)
    && Object.keys(plan).every(field => ['date', 'active', 'items', 'acknowledged', 'sourceSnapshot', 'updatedAt'].includes(field))
    && validPlanDate(plan.date) && typeof plan.active === 'boolean' && attendanceInstant(plan.updatedAt)
    && validPlanSources(plan.acknowledged) && validPlanSources(plan.sourceSnapshot)
    && Array.isArray(plan.items) && plan.items.length <= 300 && new Set(plan.items.map(item => item?.id)).size === plan.items.length
    && plan.items.every(item => plain(item) && Object.keys(item).sort().join(',') === 'id,name,packedAt,quantity,source,unit'
      && str(item.id, 100) && !!item.id && str(item.name, 200) && !!item.name.trim() && item.name === item.name.trim()
      && (item.quantity === null || typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0 && item.quantity <= 100000)
      && str(item.unit, 40) && item.unit === item.unit.trim() && (item.source === null || validPlanSource(item.source))
      && (item.packedAt === '' || attendanceInstant(item.packedAt))));
}
// Keep ranks outside datePlans: v1.5.63–v1.5.65 clients reject extra plan keys.
const MAX_DAY_PLAN_POSITION = 1000000;
function validDatePlanOrder(order) {
  return Array.isArray(order) && order.length <= 1000 && new Set(order.map(entry => entry?.date)).size === order.length && order.every(entry => plain(entry)
    && Object.keys(entry).sort().join(',') === 'date,position' && validPlanDate(entry.date) && Number.isSafeInteger(entry.position) && entry.position >= 0 && entry.position <= MAX_DAY_PLAN_POSITION);
}
const dayPlanPosition = (data, date) => data?.datePlanOrder?.find(entry => entry.date === date)?.position ?? null;
const compareDayPlanNames = (a, b) => a.name.localeCompare(b.name, 'zh-Hant') || a.storeId.localeCompare(b.storeId);
const compareDayPlanRows = (a, b) => a.orderPosition - b.orderPosition || compareDayPlanNames(a, b);
function positionDayPlanRows(rows) {
  // Legacy rows fill unoccupied slots in their existing name order, without a
  // write. Include cancelled rows so cancellation does not shift their slot.
  const used = new Set(rows.filter(row => row.position !== null).map(row => row.position));
  let available = 0;
  for (const row of [...rows].sort(compareDayPlanNames)) {
    if (row.position !== null) { row.orderPosition = row.position; continue; }
    while (used.has(available)) available++;
    row.orderPosition = available; used.add(available++);
  }
}
export function dayPlanForStore(store, date) { const plan = store?.datePlans?.find(plan => plan.date === dayPlanDate(date)); return plan ? structuredClone(plan) : null; }
export function dayPlanSuggestion(source) {
  if (!validPlanSource(source)) return null;
  const match = /^(HAUD|Complete|陳列盒（中）|陳列盒（小）)(?:[ \t]*(?:[×xX][ \t]*)?(\d+(?:\.\d+)?)[ \t]*(盒|個|瓶|支|份|包))?$/.exec(source.text.trim());
  if (!match) return null;
  const quantity = match[2] === undefined ? null : Number(match[2]);
  if (quantity !== null && (!(quantity > 0) || quantity > 100000)) return null;
  return { name: match[1], quantity, unit: match[3] || '', source: structuredClone(source) };
}
function dayPlanUnavailable(store) {
  if (store.deleted) return '門市已在回收桶，保留行程供核對';
  if (store.conflict) return '門市有同步衝突，請先核對版本';
  if (store.mergedInto) return '門市已整併，行程歸屬需另行核對';
  if (store.csvIdentityPending) return '門市身分待確認，暫不核定準備數量';
  return '';
}
// Past views use the saved sources, not today's changing task list. A previous
// store restore can remove a current plan, but its old evidence stays viewable.
export function dayPlanOverview(records, date, now = Date.now()) {
  date = dayPlanDate(date); const past = date < dayPlanDate(now), stores = [], cancelledStores = [], groups = new Map();
  const unknownItems = [], staleItems = [], unclassifiedSources = [], unavailableStores = [];
  for (const store of records.filter(record => record.type === 'store')) {
    let plan = dayPlanForStore(store, date), historical = false, position = dayPlanPosition(store, date);
    if (!plan && past) {
      const version = [...(store.versions || [])].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).find(op => op.data.datePlans?.some(entry => entry.date === date));
      plan = version?.data.datePlans.find(entry => entry.date === date) || null; historical = !!plan; position = dayPlanPosition(version?.data, date);
    }
    // A conflicting head must not silently hide the day's arrangement.
    if (!plan?.active && store.conflict) {
      const head = store.heads.find(head => head.data.datePlans?.some(entry => entry.date === date && entry.active));
      if (head) { plan = head.data.datePlans.find(entry => entry.date === date); position = dayPlanPosition(head.data, date); }
    }
    if (!plan) continue;
    const unavailableReason = dayPlanUnavailable(store), available = !unavailableReason;
    const sources = structuredClone(past ? plan.sourceSnapshot : dayPlanSources(store)), currentKeys = new Set(sources.map(dayPlanSourceKey));
    const items = plan.items.map(item => {
      const stale = item.source !== null && !currentKeys.has(dayPlanSourceKey(item.source));
      return { ...structuredClone(item), stale, packed: available && !stale && !!item.packedAt };
    });
    const classified = new Set([...plan.acknowledged.map(dayPlanSourceKey), ...items.filter(item => !item.stale && item.source).map(item => dayPlanSourceKey(item.source))]);
    const row = { storeId: store.id, name: store.name, plan: structuredClone(plan), position, historical, available, unavailableReason, sources, items, unclassifiedSources: sources.filter(source => !classified.has(dayPlanSourceKey(source))) };
    if (!plan.active) { cancelledStores.push(row); continue; }
    stores.push(row);
    if (!available) unavailableStores.push(row);
    const allocationBase = { storeId: store.id, storeName: store.name };
    for (const source of row.unclassifiedSources) unclassifiedSources.push({ ...allocationBase, ...source });
    for (const item of items) {
      const allocation = { ...allocationBase, itemId: item.id, name: item.name, unit: item.unit, quantity: item.quantity, packed: item.packed, source: item.source };
      if (item.stale) { staleItems.push(allocation); continue; }
      if (!available) continue;
      if (item.quantity === null || !item.unit) { unknownItems.push(allocation); continue; }
      const key = JSON.stringify([item.name, item.unit]);
      if (!groups.has(key)) groups.set(key, { key, name: item.name, unit: item.unit, quantity: 0, packed: true, allocations: [] });
      const group = groups.get(key); group.quantity = Number((group.quantity + item.quantity).toPrecision(15)); group.packed &&= item.packed; group.allocations.push(allocation);
    }
  }
  positionDayPlanRows([...stores, ...cancelledStores]);
  stores.sort(compareDayPlanRows); cancelledStores.sort(compareDayPlanRows);
  return { date, past, stores, cancelledStores, groups: [...groups.values()], unknownItems, staleItems, unclassifiedSources, unavailableStores };
}
// All store heads participate, including unselected/cancelled candidates: a stale
// screen cannot reorder against a newly changed reminder, store, or arrangement.
export function dayItineraryBasis(records, date) {
  date = dayPlanDate(date);
  return JSON.stringify({ date, stores: records.filter(record => record.type === 'store').map(store => [store.id, store.heads.map(head => head.id).sort()]).sort((a, b) => a[0].localeCompare(b[0])) });
}
export function applyDayItineraryAction(bundle, request, device, at = new Date().toISOString()) {
  validateBundle(bundle);
  if (!attendanceInstant(at) || !str(device, 100) || !device || !plain(request) || Object.keys(request).sort().join(',') !== 'action,date,expectedBasis,storeId'
    || !validPlanDate(request.date) || !str(request.storeId, 100) || !request.storeId || typeof request.expectedBasis !== 'string'
    || !['add', 'cancel', 'restore', 'up', 'down'].includes(request.action)) throw new Error('行程修改資料不完整，尚未寫入。');
  const { date, storeId, action, expectedBasis } = request, records = project(bundle), index = new Map(records.filter(record => record.type === 'store').map(store => [store.id, store]));
  if (date < dayPlanDate(at)) throw new Error('過去行程保留歷史，不能重新安排或調整順序。');
  if (dayItineraryBasis(records, date) !== expectedBasis) throw new Error('門市、提醒或行程已有新版本，請重新開啟行程；尚未寫入。');
  const store = index.get(storeId);
  if (!store || dayPlanUnavailable(store)) throw new Error('行程門市不存在、已刪除、整併、身分待確認或有衝突；請先核對。');
  const before = dayPlanForStore(store, date), drafts = new Map();
  const draft = id => {
    if (!index.has(id) || dayPlanUnavailable(index.get(id))) throw new Error('順序涉及已刪除、整併、身分待確認或有衝突的門市；請先核對。');
    if (!drafts.has(id)) drafts.set(id, structuredClone(index.get(id).heads[0].data));
    return drafts.get(id);
  };
  const setPlan = plan => { const data = draft(storeId); data.datePlans = [...(data.datePlans || []).filter(entry => entry.date !== date), plan].sort((a, b) => a.date.localeCompare(b.date)); };
  const setPosition = (id, position) => {
    if (dayPlanPosition(drafts.get(id) || index.get(id), date) === position) return;
    const data = draft(id); data.datePlanOrder = [...(data.datePlanOrder || []).filter(entry => entry.date !== date), { date, position }].sort((a, b) => a.date.localeCompare(b.date));
  };
  if (action === 'cancel' || action === 'restore') {
    if (action === 'restore' && !before) throw new Error('找不到可復原的安排，尚未寫入。');
    if (!before || before.active === (action === 'restore')) return bundle;
    // Cancellation/restoration never recalculate sources or reset old packedAt.
    setPlan({ ...before, active: action === 'restore', updatedAt: at });
  } else {
    if (action === 'add' && before?.active) return bundle;
    if (action !== 'add' && !before?.active) throw new Error('門市尚未安排於當日，不能調整順序。');
    const overview = dayPlanOverview(records, date, at), rows = [...overview.stores, ...overview.cancelledStores].sort(compareDayPlanRows);
    const activeIndex = overview.stores.findIndex(row => row.storeId === storeId), neighborIndex = activeIndex + (action === 'up' ? -1 : 1);
    if (action !== 'add' && (neighborIndex < 0 || neighborIndex >= overview.stores.length)) return bundle;
    if (action !== 'add' && dayPlanUnavailable(index.get(overview.stores[neighborIndex].storeId))) throw new Error('順序涉及已刪除、整併、身分待確認或有衝突的門市；請先核對。');
    // Cancelled slots are read-only. Restoring a store retains its saved rank;
    // moving active neighbors must never create a cancelled-store revision.
    if (action === 'add') {
      // Appending only changes this store. An unrelated legacy/conflicting row
      // must not prevent adding a safe store or silently get a new revision.
      const position = Math.max(-1, ...rows.map(row => row.orderPosition)) + 1;
      if (position > MAX_DAY_PLAN_POSITION) throw new Error('當日順序已達安全上限（含保留的已取消順位）；本次無法新增，既有行程尚未變更。');
      setPlan(before ? { ...before, active: true, updatedAt: at } : { date, active: true, items: [], acknowledged: [], sourceSnapshot: dayPlanSources(store), updatedAt: at });
      setPosition(storeId, position);
    } else {
      const activeRows = overview.stores, neighbor = activeRows[neighborIndex];
      if (new Set(activeRows.map(row => row.orderPosition)).size === activeRows.length && !activeRows.some(row => row.orderPosition === MAX_DAY_PLAN_POSITION)) {
        // The overview already gives legacy rows deterministic virtual slots.
        // Persist only the two exchanged slots when no rank needs compaction.
        setPosition(storeId, neighbor.orderPosition); setPosition(neighbor.storeId, activeRows[activeIndex].orderPosition);
      } else {
        // Concurrent additions can give active stores equal ranks; MAX ranks
        // need compaction to leave space for later additions. Only the day's
        // active set is normalized; unavailable active stores make
        // the entire operation fail closed before any draft is prepared.
        if (activeRows.some(row => dayPlanUnavailable(index.get(row.storeId)))) throw new Error('順序涉及已刪除、整併、身分待確認或有衝突的門市；請先核對。');
        const reordered = [...activeRows], reserved = new Set(overview.cancelledStores.map(row => row.orderPosition));
        [reordered[activeIndex], reordered[neighborIndex]] = [reordered[neighborIndex], reordered[activeIndex]];
        let position = 0;
        for (const row of reordered) {
          while (reserved.has(position)) position++;
          if (position > MAX_DAY_PLAN_POSITION) throw new Error('當日順序已達安全上限；尚未寫入。');
          setPosition(row.storeId, position++);
        }
      }
    }
  }
  if (!drafts.size) return bundle;
  const next = structuredClone(bundle);
  for (const [id, data] of drafts) {
    const op = revision('store', id, data, index.get(id).heads.map(head => head.id), device); op.at = at; next.ops.push(op);
  }
  validateBundle(next);
  if (enc.encode(JSON.stringify(next)).length > MAX_BYTES) throw new Error('行程儲存後資料超過 24 MB 上限；全部原資料保留，本次尚未寫入。');
  return next;
}
const planItemSpec = item => JSON.stringify([item.name, item.quantity, item.unit, item.source]);
export function applyDayPlanChanges(bundle, changes, device, at = new Date().toISOString()) {
  validateBundle(bundle);
  if (!attendanceInstant(at) || !str(device, 100) || !device || !Array.isArray(changes) || changes.length > 1000) throw new Error('行程修改資料不完整，尚未寫入。');
  const index = new Map(project(bundle).filter(record => record.type === 'store').map(store => [store.id, store]));
  const drafts = new Map(), requested = new Set(), today = dayPlanDate(at);
  for (const change of changes) {
    if (!plain(change) || !str(change.storeId, 100) || !plain(change.plan) || !Array.isArray(change.expectedHeads)) throw new Error('行程修改資料不完整，尚未寫入。');
    const store = index.get(change.storeId);
    if (!store || dayPlanUnavailable(store)) throw new Error('行程門市不存在、已刪除、整併、身分待確認或有衝突；請先核對。');
    if (JSON.stringify([...change.expectedHeads].sort()) !== JSON.stringify(store.heads.map(head => head.id).sort())) throw new Error('門市或行程已有新版本，請重新核對；尚未寫入。');
    const date = dayPlanDate(change.plan.date), requestKey = JSON.stringify([store.id, date]);
    if (date < today) throw new Error('過去行程保留歷史，不能重新安排或改寫已帶上狀態。');
    if (requested.has(requestKey)) throw new Error('同一門市同一天的修改重複，尚未寫入。');
    requested.add(requestKey);
    const data = drafts.get(store.id) || structuredClone(store.heads[0].data), before = dayPlanForStore(data, date);
    const plan = { ...structuredClone(change.plan), date, sourceSnapshot: dayPlanSources(store), updatedAt: at };
    // Accept caller round-trips of our own plan, but never an invented source snapshot.
    if (!validDatePlans([plan])) throw new Error('行程品項、數量或來源格式不正確；尚未寫入。');
    const currentSources = new Set(plan.sourceSnapshot.map(dayPlanSourceKey));
    for (const source of plan.acknowledged) if (!currentSources.has(dayPlanSourceKey(source)) && !before?.acknowledged.some(old => dayPlanSourceKey(old) === dayPlanSourceKey(source))) throw new Error('事項來源已變更，請重新核對。');
    for (const item of plan.items) {
      const old = before?.items.find(previous => previous.id === item.id), stale = item.source && !currentSources.has(dayPlanSourceKey(item.source));
      if (stale && (!old || dayPlanSourceKey(old.source) !== dayPlanSourceKey(item.source))) throw new Error('備品來源已變更，請重新核對。');
      if (!before?.active || !plan.active || !old || planItemSpec(old) !== planItemSpec(item) || stale || item.quantity === null || !item.unit) item.packedAt = '';
      else if (item.packedAt && item.packedAt !== old.packedAt) item.packedAt = at;
    }
    // Do not create a revision just for recomputing timestamps or reopening a plan.
    const comparable = value => { if (!value) return null; const copy = structuredClone(value); delete copy.updatedAt; return copy; };
    if (JSON.stringify(comparable(before)) === JSON.stringify(comparable(plan))) continue;
    data.datePlans = [...(data.datePlans || []).filter(previous => previous.date !== date), plan].sort((a, b) => a.date.localeCompare(b.date));
    if (!validDatePlans(data.datePlans)) throw new Error('行程超過安全上限；保留全部歷史，本次尚未寫入。');
    drafts.set(store.id, data);
  }
  if (!drafts.size) return bundle;
  const next = structuredClone(bundle);
  for (const [storeId, data] of drafts) { const op = revision('store', storeId, data, index.get(storeId).heads.map(head => head.id), device); op.at = at; next.ops.push(op); }
  validateBundle(next);
  if (enc.encode(JSON.stringify(next)).length > MAX_BYTES) throw new Error('行程儲存後資料超過 24 MB 上限；全部原資料保留，本次尚未寫入。');
  return next;
}
// Exclusion memory is an explicit decision about one exact Google place
// identity. These comparison keys never replace the original source strings.
export function csvExclusionIdentity(profile) {
  if (!plain(profile) || !str(profile.name, 200) || !profile.name.trim() || !str(profile.address, 2000) || !str(profile.mapUrl, 2000)) return null;
  let mapKey = '';
  try {
    const url = new URL(profile.mapUrl.trim());
    if (url.protocol !== 'https:' || !['www.google.com', 'maps.google.com', 'www.google.com.tw', 'maps.google.com.tw'].includes(url.hostname)) return null;
    const place = url.searchParams.get('query_place_id') || (url.searchParams.get('q') || '').match(/^place_id:(.+)$/)?.[1];
    const cid = url.searchParams.get('cid'), feature = decodeURIComponent(url.pathname + url.search).match(/!1s([^!&/?]+)/)?.[1];
    if (place) mapKey = 'place:' + place;
    else if (cid && /^\d+$/.test(cid)) mapKey = 'cid:' + BigInt(cid).toString();
    else if (feature) mapKey = 'feature:' + feature;
  } catch { return null; }
  if (!mapKey || mapKey.length > 500) return null;
  const normalize = value => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replaceAll('臺', '台');
  return { mapKey, name: normalize(profile.name), address: normalize(profile.address) };
}
const csvEventKeys = (value, fields) => plain(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const csvEventIdentityKey = identity => JSON.stringify([identity.mapKey, identity.name, identity.address]);
function validCSVExclusionEvent(event) {
  if (!plain(event) || !str(event.id, 100) || !event.id) return false;
  if (event.action === 'revoke') return csvEventKeys(event, ['id', 'action', 'target']) && str(event.target, 100) && !!event.target && event.target !== event.id;
  if (event.action !== 'exclude' || !csvEventKeys(event, ['id', 'action', 'identity', 'profile', 'line', 'fingerprint', 'seenRevocations']) ||
    !csvEventKeys(event.profile, ['name', 'address', 'mapUrl']) || !csvEventKeys(event.identity, ['mapKey', 'name', 'address'])) return false;
  const identity = csvExclusionIdentity(event.profile);
  return !!identity && csvEventIdentityKey(identity) === csvEventIdentityKey(event.identity) &&
    Number.isSafeInteger(event.line) && event.line > 0 && event.line <= 2097152 && /^[a-f0-9]{64}$/.test(event.fingerprint || '') &&
    Array.isArray(event.seenRevocations) && event.seenRevocations.length <= 2000 && new Set(event.seenRevocations).size === event.seenRevocations.length &&
    event.seenRevocations.every(id => str(id, 100) && !!id && id !== event.id);
}
function validateCSVExclusionEvents(sourceEntities) {
  const events = new Map(), owners = new Map();
  for (const source of sourceEntities.values()) for (const event of source.data.csvExclusionEvents || []) {
    if (events.has(event.id)) throw new Error('CSV 排除事件識別重複；不能覆寫排除或撤銷歷史。');
    events.set(event.id, event); owners.set(event.id, source);
  }
  const dependencies = new Map();
  for (const source of sourceEntities.values()) {
    const list = source.data.csvExclusionEvents || [];
    if (source.data.csvExclusionAuditOf !== undefined) {
      const original = sourceEntities.get(source.data.csvExclusionAuditOf);
      if (!original || original === source || original.data.csvExclusionAuditOf !== undefined || !list.length || list.some(event => event.action !== 'revoke') ||
        ['file', 'list', 'blob', 'rows', 'headers', 'encoding', 'delimiter'].some(field => JSON.stringify(source.data[field]) !== JSON.stringify(original.data[field]))) throw new Error('CSV 撤銷稽核未連到完整原始來源。');
    } else if (list.some(event => event.action !== 'exclude')) throw new Error('CSV 撤銷事件缺少原始來源稽核連結。');
    for (const event of list) {
      if (event.action === 'revoke') {
        const target = events.get(event.target);
        if (!target || target.action !== 'exclude' || owners.get(event.target).entity !== source.data.csvExclusionAuditOf) throw new Error('CSV 撤銷事件的排除依據不存在或不一致。');
        dependencies.set(event.id, [event.target]);
      } else {
        for (const id of event.seenRevocations) {
          const revoked = events.get(id), target = events.get(revoked?.target);
          if (!revoked || revoked.action !== 'revoke' || !target || target.action !== 'exclude' || csvEventIdentityKey(target.identity) !== csvEventIdentityKey(event.identity)) throw new Error('CSV 重新排除引用了不同地點或不存在的撤銷。');
        }
        dependencies.set(event.id, event.seenRevocations);
      }
    }
  }
  // Imported/merged history can be long; validate causality without recursion.
  const degrees = new Map(), children = new Map(), queue = [];
  for (const [id, parents] of dependencies) {
    degrees.set(id, parents.length);
    if (!parents.length) queue.push(id);
    for (const parent of parents) { const list = children.get(parent) || []; list.push(id); children.set(parent, list); }
  }
  for (let index = 0; index < queue.length; index++) for (const child of children.get(queue[index]) || []) {
    const degree = degrees.get(child) - 1; degrees.set(child, degree); if (!degree) queue.push(child);
  }
  if (queue.length !== events.size) throw new Error('CSV 排除與撤銷歷史形成循環。');
}
const supervisionText = (value, max) => str(value, max) && !!value.trim() && value === value.trim();
const supervisionKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const supervisionMimes = ['image/jpeg', 'image/png', 'image/webp'];
function supervisionDate(value) {
  return value === '' || str(value, 10) && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value;
}
function validSupervisionDocument(value) {
  return supervisionKeys(value, ['blob', 'name', 'mime']) && /^[a-f0-9]{64}$/.test(value.blob || '')
    && supervisionText(value.name, 500) && supervisionMimes.includes(value.mime);
}
function validStoreSupervision(value) {
  return supervisionKeys(value, ['organization', 'areaCode', 'areaName', 'personId', 'storeCode', 'sourceLabel', 'sourceDocument', 'recordedAt', 'effectiveDate'])
    && ['organization', 'areaName'].every(key => supervisionText(value[key], 200))
    && ['areaCode', 'personId'].every(key => supervisionText(value[key], 100))
    && str(value.storeCode, 100) && supervisionText(value.sourceLabel, 500)
    && validSupervisionDocument(value.sourceDocument) && attendanceInstant(value.recordedAt) && supervisionDate(value.effectiveDate);
}
export function validData(type, d) {
  if (!plain(d)) return false;
  if (d.supervision !== undefined && (type !== 'store' || !validStoreSupervision(d.supervision))) return false;
  if (d.supervisorKey !== undefined && (type !== 'person' || !supervisionText(d.supervisorKey, 200))) return false;
  if (d.monthlyVisits !== undefined && (type !== 'store' || !validMonthlyVisits(d.monthlyVisits))) return false;
  if (d.datePlans !== undefined && (type !== 'store' || !validDatePlans(d.datePlans))) return false;
  if (d.datePlanOrder !== undefined && (type !== 'store' || !validDatePlanOrder(d.datePlanOrder))) return false;
  if (d.storeMergeHistory !== undefined && (type !== 'store' || !validStoreMergeHistory(d.storeMergeHistory))) return false;
  if (d.storeMergeStaleEntries !== undefined && (type !== 'store' || !Array.isArray(d.storeMergeStaleEntries) || d.storeMergeStaleEntries.length > 20 || !d.storeMergeStaleEntries.every(item => plain(item) && insightId(item.id) && str(item.key, 300000)))) return false;
  if (d.preVisitInsights !== undefined && (type !== 'store' || !validStoreInsights(d.preVisitInsights))) return false;
  if (d.preVisitInsightReviews !== undefined && (type !== 'store' || !validInsightReviews(d.preVisitInsightReviews))) return false;
  if (d.preVisitInsightRelations !== undefined && (type !== 'store' || !validInsightRelations(d.preVisitInsightRelations))) return false;
  if ((d.nextRememberTasks !== undefined || d.nextRememberImports !== undefined) && (type !== 'store' || !validReminderTasks(d))) return false;
  if (d.csvIdentityPending !== undefined && (type !== 'store' || typeof d.csvIdentityPending !== 'boolean')) return false;
  if (d.csvExclusionEvents !== undefined && (type !== 'source' || !Array.isArray(d.csvExclusionEvents) || d.csvExclusionEvents.length > 1500 || !d.csvExclusionEvents.every(validCSVExclusionEvent))) return false;
  if (d.csvExclusionAuditOf !== undefined && (type !== 'source' || !str(d.csvExclusionAuditOf, 100) || !d.csvExclusionAuditOf)) return false;
  if (d.mergedInto !== undefined && (type !== 'store' || !str(d.mergedInto, 100) || !d.mergedInto)) return false;
  if (d.mergeDecision !== undefined && (type !== 'store' || !str(d.mergeDecision, 200) || !d.mergeDecision)) return false;
  if (d.csvDecisionGroups !== undefined && (type !== 'store' || !Array.isArray(d.csvDecisionGroups) || d.csvDecisionGroups.length > 200 || !d.csvDecisionGroups.every(v => str(v, 200)))) return false;
  if (d.csvAliases !== undefined && (type !== 'store' || !Array.isArray(d.csvAliases) || d.csvAliases.length > 100 || !d.csvAliases.every(v => str(v, 200)))) return false;
  if (d.csvIdentityRules !== undefined && (type !== 'store' || !Array.isArray(d.csvIdentityRules) || d.csvIdentityRules.length > 200 || !d.csvIdentityRules.every(r => plain(r) && r.decision === 'same' && str(r.mapKey, 500) && r.mapKey && str(r.label, 200) && r.label.trim() && str(r.source, 200) && str(r.decidedAt, 40) && Array.isArray(r.names) && r.names.length > 1 && r.names.length <= 100 && r.names.every(v => str(v, 200) && v.trim()) && Array.isArray(r.addresses) && r.addresses.length <= 100 && r.addresses.every(v => str(v, 2000) && v.trim())))) return false;
  if (d.qualityDistinct !== undefined && (type !== 'store' || !Array.isArray(d.qualityDistinct) || d.qualityDistinct.length > 200 || !d.qualityDistinct.every(r => plain(r) && str(r.store, 100) && str(r.self, 6000) && str(r.other, 6000)))) return false;
  if (d.enrichmentSources !== undefined && (type !== 'store' || !Array.isArray(d.enrichmentSources) || d.enrichmentSources.length > 50 || !d.enrichmentSources.every(r => plain(r) && r.provider === 'Google Maps 公開資料' && /^0x[a-f0-9]+:0x[a-f0-9]+$/.test(r.featureId || '') && str(r.sourceUrl, 2000) && coordinateFeature(r.sourceUrl) === r.featureId && str(r.sourceAddress, 2000) && !!r.sourceAddress.trim() && str(r.address, 2000) && !!r.address.trim() && str(r.city, 500) && !!r.city.trim() && str(r.district, 500) && !!r.district.trim() && str(r.checkedAt, 40) && Number.isFinite(Date.parse(r.checkedAt))))) return false;
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
  const seen = new Map(), sourceEntities = new Map(), storeEntities = new Set(), reviewEvents = new Map(), relationDefinitions = new Map();
  for (const o of b.ops) {
    if (!plain(o) || !str(o.id, 100) || !o.id || seen.has(o.id) || !types.includes(o.type) || !str(o.entity, 100) || !ids(o.parents) || new Set(o.parents).size !== o.parents.length || !str(o.device, 100) || !str(o.at, 40) || typeof o.deleted !== 'boolean' || !validData(o.type, o.data)) throw new Error('紀錄或版本資訊不完整。');
    if (o.type === 'source' && (o.deleted || o.parents.length || sourceEntities.has(o.entity))) throw new Error('原始來源快照只能新增一次，不能修改或刪除。');
    if (o.type === 'source') sourceEntities.set(o.entity, o);
    if (o.type === 'store') storeEntities.add(o.entity);
    for (const relation of o.data.preVisitInsightRelations || []) {
      const fingerprint = insightRelationKey(relation);
      if (!relation.members.some(member => member.storeId === o.entity) || relationDefinitions.has(relation.id) && relationDefinitions.get(relation.id) !== fingerprint) throw new Error('人物關係對應識別或內容不一致；既有對應不得改寫。');
      relationDefinitions.set(relation.id, fingerprint);
    }
    for (const event of o.data.preVisitInsightReviews || []) {
      const fingerprint = JSON.stringify([o.entity, canonicalInsightReview(event)]);
      if (!event.entry.evidence.some(source => source.storeId === o.entity) || reviewEvents.has(event.id) && reviewEvents.get(event.id) !== fingerprint) throw new Error('分析審核歷史識別或內容不一致；尚未寫入任何資料。');
      reviewEvents.set(event.id, fingerprint);
    }
    if (Object.hasOwn(o, 'visitAttendance') && !validVisitAttendance(o)) throw new Error('拜訪確認資料不完整或與紀錄不符。');
    seen.set(o.id, o);
  }
  validateStoreMergeProvenance(b, seen);
  validateCSVExclusionEvents(sourceEntities);
  for (const o of b.ops) if (Object.hasOwn(o, 'visitAttendance') && !storeEntities.has(o.visitAttendance.store)) throw new Error('拜訪確認所屬門市不存在。');
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
  for (const o of b.ops) if (o.data.supervision && !Object.hasOwn(b.blobs, o.data.supervision.sourceDocument.blob)) throw new Error('督導分區來源圖缺少檔案內容，停止合併。');
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
// Literal, read-only search of current visit text. Offsets address UTF-16 text
// with DOM-style LF line endings; the original record and version stay intact.
export function searchStoreVisitText(visits, storeId, query, limit = 500) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('搜尋筆數上限須為非負整數。');
  const needle = String(query ?? '').trim(), matches = [];
  if (!needle) return { query: needle, matches, truncated: false };
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const ordered = visits.filter(visit => visit.type === 'visit' && visit.store === storeId && !visit.deleted && !visit.conflict)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  for (const visit of ordered) {
    const text = String(visit.text ?? '').replace(/\r\n?/g, '\n');
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (matches.length === limit) return { query: needle, matches, truncated: true };
      matches.push({ visitId: visit.id, headId: visit.heads?.[0]?.id || '', start: match.index, end: match.index + match[0].length, text: match[0], date: visit.date || '', source: visit.source || '' });
    }
  }
  return { query: needle, matches, truncated: false };
}
export function revision(type, entity, data, parents, device, deleted = false, attendance) {
  if (!validData(type, data)) throw new Error('欄位內容不完整或超過長度限制。');
  const op = { id: uuid(), type, entity, data: structuredClone(data), parents: [...parents], device, deleted, at: new Date().toISOString() };
  if (attendance !== undefined) {
    op.visitAttendance = structuredClone(attendance); op.at = attendance?.at;
    if (!validVisitAttendance(op)) throw new Error('拜訪確認資料不完整或與紀錄不符。');
  }
  return op;
}
// Display-only device safety summary. No timestamps, writes, or inferred Mac receipts.
// drafts includes reminderDrafts; all drafts are device-only, outside the shared bundle.
export function dataSafetySummary(input = {}) {
  const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
  const localState = ['saved', 'saving', 'failed'].includes(input.localState) ? input.localState : 'unknown';
  const local = { saved: '本機已保存', saving: '本機保存中', failed: '本機保存失敗', unknown: '本機保存尚待確認' }[localState];
  const pending = count(input.pending?.count), unknownPending = input.pending?.unknown === true;
  const waiting = input.dirty === true || pending > 0 || unknownPending;
  const acknowledged = typeof input.lastSync === 'string' && Number.isFinite(Date.parse(input.lastSync));
  const conflicts = count(input.conflicts), reminderDrafts = count(input.reminderDrafts), drafts = Math.max(count(input.drafts), reminderDrafts);
  const issues = [];
  const mac = input.syncing ? '正在與 Mac 交換' : !input.paired ? '尚未配對 Mac' : input.syncError ? '本次同步未完成' : waiting
    ? unknownPending ? '等待 Mac，數量待確認' : pending ? `${pending} 項等待 Mac` : '等待 Mac 確認'
    : acknowledged ? 'Mac 已確認收到正式紀錄' : 'Mac 尚無成功確認';
  let state = 'healthy', title = 'Mac 已確認收到';
  if (localState === 'failed') { state = 'warning'; title = '本機保存失敗'; }
  else if (localState === 'unknown') { state = 'unknown'; title = '保存狀態待確認'; }
  else if (localState === 'saving') { state = 'pending'; title = '正在保存本機'; }
  else if (conflicts) { state = 'action'; title = `${conflicts} 筆衝突待核對`; }
  else if (input.syncError && !input.syncing) { state = 'warning'; title = '同步尚未完成'; }
  else if (input.backupWarning) { state = 'warning'; title = '備份需要檢查'; }
  else if (input.syncing) { state = 'syncing'; title = '正在同步'; }
  else if (!input.paired) { state = 'action'; title = '需要配對 Mac'; }
  else if (waiting) { state = 'pending'; title = '等待 Mac 確認'; }
  else if (!acknowledged) { state = 'pending'; title = '尚無成功同步確認'; }
  if (conflicts && !title.includes('衝突')) issues.push(`${conflicts} 筆衝突待核對`);
  if (input.backupWarning && title !== '備份需要檢查') issues.push('備份需檢查');
  if (input.syncError && input.syncing) issues.push('上次同步未完成');
  if (drafts) issues.push(drafts === reminderDrafts ? `提醒草稿 ${drafts} 份僅本機` : `草稿 ${drafts} 份僅本機${reminderDrafts ? `（提醒 ${reminderDrafts} 份）` : ''}`);
  return { state, title, detail: [local, mac, ...issues].join(' · ') };
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
  // The caller only supplies weekly state after checking its vault identity.
  // Manual exports, scheduled Mac files and off-device copies remain distinct.
  const weekly = input.weeklyBackup && input.weeklyBackup.status !== 'unconfigured'
    && (input.weeklyBackup.config || ['ready', 'success', 'waiting-current-copy', 'failed'].includes(input.weeklyBackup.status)) ? input.weeklyBackup : null;
  const weeklyAge = weekly?.lastSuccess ? age(weekly.lastSuccess.at) : null;
  const sameWeeklyConfig = !weekly?.config?.id || !weekly?.lastSuccess?.configId || weekly.config.id === weekly.lastSuccess.configId;
  const recentWeekly = !!weekly && sameWeeklyConfig && weekly.status !== 'failed' && weeklyAge !== null && weeklyAge >= 0 && weeklyAge <= week;
  const backupAge = age(input.lastBackup);
  const manualBackup = backupAge === null ? { code: 'backup-age', level: 'warning', text: '這台裝置尚無由 App 匯出加密備份的紀錄。' } : backupAge > week ? { code: 'backup-age', level: 'warning', text: '最近由 App 匯出加密備份已超過 7 天。' } : { code: 'backup-age', level: 'ok', text: '最近 7 天內曾由 App 匯出加密備份。' };
  if (recentWeekly && manualBackup.level === 'warning') {
    manualBackup.level = 'info';
    manualBackup.text = (backupAge === null ? '這台裝置尚無手動匯出加密備份的紀錄。' : '最近手動匯出加密備份已超過 7 天。') + '最近 7 天內另有每週自動備份成功紀錄；不代表已另存離機副本。';
  }
  checks.push(manualBackup);
  if (weekly) {
    let level = 'ok', text;
    if (weekly.status === 'failed') { level = 'warning'; text = '每週自動備份最近一次失敗，請查看失敗原因；先前成功紀錄不代表本次已完成。'; }
    else if (!sameWeeklyConfig || !weekly.lastSuccess) { level = 'warning'; text = '目前每週自動備份設定尚無成功保存紀錄，等待可執行時補做。'; }
    else if (weeklyAge === null || weeklyAge < 0) { level = 'warning'; text = '每週自動備份成功時間不正確或晚於目前時間，尚無法確認最近備份。'; }
    else if (weeklyAge > week) { level = 'warning'; text = '最近成功的每週自動備份已超過 7 天，請查看服務與補做狀態。'; }
    else if (weekly.due === true || (weekly.status === 'waiting-current-copy' && weekly.due !== false)) { level = 'warning'; text = '本次每週自動備份已到期，等待最新正式資料加密後補做；先前成功備份仍保留。'; }
    else {
      const lastVersion = weekly.lastSuccess.sourceVersion, versionKnown = Number.isSafeInteger(lastVersion) && lastVersion >= 0;
      text = `最近 7 天內每週自動備份已在 Mac 保存成功${versionKnown ? `（資料版本 ${lastVersion}）` : ''}。`;
      if (versionKnown && Number.isSafeInteger(weekly.sourceVersion) && weekly.sourceVersion > lastVersion) {
        level = 'info'; text += `Mac 目前版本 ${weekly.sourceVersion} 較新，等待下一次排程；最近成功備份尚未涵蓋此版本。`;
      }
    }
    checks.push({ code: 'weekly-backup', level, text: text + 'Mac 上的保存不等於離機備份，也不代表未同步的手機資料已包含。' });
  }
  if (!input.macVersion) checks.push({ code: 'program', level: 'info', text: 'Mac 程式版本尚待連線確認。' });
  else checks.push(input.macVersion === input.appVersion ? { code: 'program', level: 'ok', text: `本機與 Mac 程式版本一致（v${input.appVersion}）。` } : { code: 'program', level: 'warning', text: `版本不一致：本機 v${input.appVersion}，Mac v${input.macVersion}。` });
  const attention = checks.filter(check => ['action', 'warning'].includes(check.level)).length;
  return { checkedAt: new Date(now).toISOString(), attention, state: attention ? 'attention' : checks.some(check => check.level === 'info') ? 'partial' : 'healthy', checks };
}
export async function hashBytes(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join(''); }

const backupTypeCounts = () => Object.fromEntries(types.map(type => [type, 0]));
function backupCounts(bundle, records) {
  const entities = backupTypeCounts(), active = backupTypeCounts(), deleted = backupTypeCounts();
  for (const record of records) { entities[record.type]++; (record.deleted ? deleted : active)[record.type]++; }
  return { entities, active, deleted, conflicts: records.filter(record => record.conflict).length, revisions: bundle?.ops.length || 0, blobs: Object.keys(bundle?.blobs || {}).length };
}
function backupReferenceWarnings(bundle) {
  const known = new Set(bundle.ops.map(op => JSON.stringify([op.type, op.entity]))), revisions = new Map(bundle.ops.map(op => [op.id, op])), missing = new Map();
  for (const op of bundle.ops) {
    const references = op.type === 'visit' ? [['store', op.data.store], ...op.data.people.map(id => ['person', id]), ...op.data.topics.map(id => ['topic', id])]
      : op.type === 'person' && op.data.sameAs ? [['person', op.data.sameAs]]
      : op.type === 'store' && op.data.mergedInto ? [['store', op.data.mergedInto]] : [];
    if (op.data.supervision) references.push(['person', op.data.supervision.personId]);
    if (op.type === 'store') for (const relation of op.data.preVisitInsightRelations || []) for (const member of relation.members) {
      references.push(['store', member.storeId]);
      if (!bundle.ops.some(other => other.type === 'store' && other.entity === member.storeId && other.data.preVisitInsights?.entries.some(entry => insightEntryKey(entry) === insightEntryKey(member.entry)))) {
        const id = JSON.stringify(['relation-card', op.entity, relation.id, member.storeId]);
        if (!missing.has(id)) missing.set(id, { code: 'missing-insight-relation-card', type: 'store', entity: op.entity, targetType: 'store', targetId: member.storeId, revisionIds: [] });
        if (!missing.get(id).revisionIds.includes(op.id)) missing.get(id).revisionIds.push(op.id);
      }
    }
    if (op.type === 'store') for (const entry of [...(op.data.preVisitInsights?.entries || []), ...(op.data.preVisitInsightReviews || []).map(event => event.entry), ...(op.data.preVisitInsightRelations || []).flatMap(relation => relation.members.map(member => member.entry))]) for (const source of entry.evidence) {
      references.push(['store', source.storeId], ['visit', source.visitId]);
      const revision = revisions.get(source.revisionId);
      if (!revision || revision.type !== 'visit' || revision.entity !== source.visitId || revision.data.store !== source.storeId) {
        const id = JSON.stringify(['insight-revision', op.entity, source.storeId, source.visitId, source.revisionId]);
        if (!missing.has(id)) missing.set(id, { code: 'missing-insight-source-revision', type: 'store', entity: op.entity, targetType: 'visit', targetId: source.visitId, sourceRevisionId: source.revisionId, revisionIds: [] });
        if (!missing.get(id).revisionIds.includes(op.id)) missing.get(id).revisionIds.push(op.id);
      }
    }
    for (const [targetType, targetId] of references) {
      if (known.has(JSON.stringify([targetType, targetId]))) continue;
      const id = JSON.stringify([op.type, op.entity, targetType, targetId]);
      if (!missing.has(id)) missing.set(id, { code: 'missing-reference', type: op.type, entity: op.entity, targetType, targetId, revisionIds: [] });
      const warning = missing.get(id);
      if (!warning.revisionIds.includes(op.id)) warning.revisionIds.push(op.id);
    }
  }
  return [...missing.values()].sort((a, b) => JSON.stringify([a.type, a.entity, a.targetType, a.targetId]).localeCompare(JSON.stringify([b.type, b.entity, b.targetType, b.targetId])));
}
function freezeBackupPlan(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value); for (const child of Object.values(value)) freezeBackupPlan(child, seen);
  return Object.freeze(value);
}
// Read-only planning: no new revision IDs, writes, source repairs or automatic resolutions.
// The caller must separately validate the encrypted envelope/session and obtain confirmation,
// then revalidate this plan against the still-current local revision before committing it.
export async function planBackupImport(currentBundle, incomingBundle) {
  const incoming = structuredClone(incomingBundle), current = currentBundle == null ? null : structuredClone(currentBundle);
  validateBundle(incoming); if (current) validateBundle(current);
  const bundle = current ? merge(current, incoming) : incoming;
  if (enc.encode(JSON.stringify(bundle)).length > MAX_BYTES) throw new Error('合併後資料超過 24 MB 上限；尚未寫入任何資料。');
  for (const [id, encoded] of Object.entries(bundle.blobs)) {
    let bytes; try { bytes = unb64(encoded); } catch { throw new Error('備份附件或原始 CSV 的編碼損毀；尚未寫入任何資料。'); }
    if (await hashBytes(bytes) !== id) throw new Error('備份附件或原始 CSV 的內容與識別不符；尚未寫入任何資料。');
  }
  const beforeRecords = current ? project(current) : [], incomingRecords = project(incoming), afterRecords = project(bundle);
  const recordKey = record => JSON.stringify([record.type, record.id]);
  const beforeByKey = new Map(beforeRecords.map(record => [recordKey(record), record]));
  const existingOps = new Set((current?.ops || []).map(op => op.id));
  const addedOps = incoming.ops.filter(op => !existingOps.has(op.id));
  const beforeAttendance = (current?.ops || []).filter(op => op.visitAttendance), afterAttendance = bundle.ops.filter(op => op.visitAttendance);
  const attendanceDay = op => JSON.stringify([op.visitAttendance.store, op.visitAttendance.date]);
  const beforeAttendanceDays = new Set(beforeAttendance.map(attendanceDay)), afterAttendanceDays = new Set(afterAttendance.map(attendanceDay));
  const addedAttendanceByEntity = new Map();
  for (const op of addedOps) if (op.visitAttendance) {
    const key = JSON.stringify([op.type, op.entity]);
    if (!addedAttendanceByEntity.has(key)) addedAttendanceByEntity.set(key, []);
    addedAttendanceByEntity.get(key).push(op);
  }
  const affected = new Set(addedOps.map(op => JSON.stringify([op.type, op.entity])));
  const newEntities = backupTypeCounts(), changes = [];
  let changedExistingEntities = 0, historyOnlyEntities = 0, newConflicts = 0, resolvedConflicts = 0, movedToTrash = 0, revived = 0;
  for (const after of afterRecords) {
    const key = recordKey(after), before = beforeByKey.get(key);
    if (!before) newEntities[after.type]++;
    if (after.conflict && !before?.conflict) newConflicts++;
    if (before?.conflict && !after.conflict) resolvedConflicts++;
    if (before && !before.deleted && after.deleted) movedToTrash++;
    if (before?.deleted && !after.deleted) revived++;
    if (!affected.has(key)) continue;
    const beforeHeads = before?.heads || [], afterHeads = after.heads;
    const headsChanged = JSON.stringify(beforeHeads.map(op => op.id)) !== JSON.stringify(afterHeads.map(op => op.id));
    const kind = !before ? 'added' : headsChanged ? 'heads-changed' : 'history-only';
    if (before && headsChanged) changedExistingEntities++;
    if (kind === 'history-only') historyOnlyEntities++;
    changes.push({ type: after.type, entity: after.id, kind, beforeHeads, afterHeads, beforeDeleted: before?.deleted || false, afterDeleted: after.deleted, beforeConflict: before?.conflict || false, afterConflict: after.conflict, addedVisitAttendance: addedAttendanceByEntity.get(key) || [] });
  }
  changes.sort((a, b) => JSON.stringify([a.type, a.entity]).localeCompare(JSON.stringify([b.type, b.entity])));
  const before = backupCounts(current, beforeRecords), after = backupCounts(bundle, afterRecords);
  const newBlobs = Object.keys(incoming.blobs).filter(id => !Object.hasOwn(current?.blobs || {}, id)).length;
  const summary = {
    mode: current ? 'merge' : 'restore', hasChanges: !current || addedOps.length > 0 || newBlobs > 0 || bundle.schema !== current.schema,
    before, incoming: backupCounts(incoming, incomingRecords), after,
    addedRevisions: addedOps.length, identicalRevisions: incoming.ops.length - addedOps.length, newBlobs, newEntities,
    changedExistingEntities, historyOnlyEntities, conflictsBefore: before.conflicts, conflictsAfter: after.conflicts,
    visitAttendance: { beforeMarks: beforeAttendance.length, afterMarks: afterAttendance.length, addedMarks: afterAttendance.length - beforeAttendance.length, beforeDays: beforeAttendanceDays.size, afterDays: afterAttendanceDays.size, addedDays: [...afterAttendanceDays].filter(day => !beforeAttendanceDays.has(day)).length },
    newConflicts, resolvedConflicts, movedToTrash, revived, warnings: backupReferenceWarnings(bundle)
  };
  return freezeBackupPlan({ bundle, summary, changes });
}

// Independent recovery export: keep the complete bundle and vault identity unchanged.
// A fresh salt/key belongs only to this file, never to the paired live database.
export async function createRecoveryBackup(bundle, password, confirmation) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('新備份密碼需為 12 至 1024 個字元。');
  if (password !== confirmation) throw new Error('兩次新密碼不同。');
  const copy = structuredClone(bundle), original = JSON.stringify(copy);
  const plan = await planBackupImport(null, copy); // Includes source/attachment hashes.
  const recoveryMeta = { ...newMeta(), vaultId: copy.vaultId };
  let recoveryKey;
  try {
    recoveryKey = await derive(password, recoveryMeta);
    password = confirmation = '';
    const envelope = await seal(copy, recoveryKey, recoveryMeta);
    if (JSON.stringify(await unseal(envelope, recoveryKey)) !== original) throw new Error('新備份完整性驗證失敗；未產生下載。');
    const text = JSON.stringify({ format: 'pharmacy-backup-1', envelope });
    return { text, sha256: await hashBytes(enc.encode(text)), summary: plan.summary.incoming, warnings: plan.summary.warnings.length };
  } finally { password = confirmation = ''; recoveryKey = null; }
}

function weeklyRecoveryMeta(value) {
  let salt;
  try { salt = typeof value?.salt === 'string' ? unb64(value.salt) : null; } catch {}
  if (!value || typeof value.vaultId !== 'string' || !value.vaultId || value.vaultId.length > 100 || value.iterations !== ITERATIONS || salt?.length !== 16 || b64(salt) !== value.salt) throw new Error('每週備份的加密設定不正確。');
  return { vaultId: value.vaultId, salt: value.salt, iterations: value.iterations };
}
function weeklyRecoveryKey(key) {
  if (typeof CryptoKey === 'undefined' || !(key instanceof CryptoKey) || key.type !== 'secret' || key.extractable !== false || key.algorithm?.name !== 'AES-GCM' || key.algorithm.length !== 256 || !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) throw new Error('每週備份需要此裝置安全保存的備份金鑰，請重新驗證備份密碼。');
  return key;
}
function separateWeeklyRecoveryMeta(source, backup) {
  if (source.vaultId !== backup.vaultId) throw new Error('這份復原備份屬於不同資料庫；每週備份設定未變更。');
  if (source.salt === backup.salt) throw new Error('請選取使用新備份密碼另存的復原備份，不能沿用正式資料庫的加密設定。');
}
// Prove the privately entered password against an existing recovery file. Only
// its nonextractable key and public encryption metadata leave this function.
export async function setupWeeklyRecovery(proofText, password, sourceMeta) {
  let key;
  try {
    if (typeof proofText !== 'string' || proofText.length > 36 * 1024 * 1024 || enc.encode(proofText).length > 36 * 1024 * 1024) throw new Error('請選取大小不超過 36 MB 的復原備份。');
    if (typeof password !== 'string' || !password.length || password.length > 1024) throw new Error('請自行輸入這份復原備份的密碼。');
    const source = weeklyRecoveryMeta(sourceMeta);
    let proof;
    try { proof = JSON.parse(proofText); } catch { throw new Error('復原備份不是有效的 JSON 檔案。'); }
    if (proof?.format !== 'pharmacy-backup-1') throw new Error('請選取已驗證的新密碼復原備份。');
    checkEnvelope(proof.envelope);
    const meta = weeklyRecoveryMeta(proof.envelope);
    separateWeeklyRecoveryMeta(source, meta);
    key = weeklyRecoveryKey(await derive(password, meta));
    password = '';
    const bundle = validateBundle(await unseal(proof.envelope, key));
    if (bundle.vaultId !== meta.vaultId) throw new Error('復原備份內容與資料庫身分不符。');
    await planBackupImport(null, bundle);
    return { key, meta, proofSha256: await hashBytes(enc.encode(proofText)) };
  } finally { password = ''; key = null; }
}
// Encrypt precisely the shared snapshot supplied by the caller. Device payloads,
// drafts, pairing tokens and database writes are deliberately outside this API.
export async function prepareWeeklyRecovery(sourceEnvelope, sourceKey, backupConfig) {
  const source = structuredClone(sourceEnvelope), meta = weeklyRecoveryMeta(backupConfig?.meta), key = weeklyRecoveryKey(backupConfig?.key);
  checkEnvelope(source);
  separateWeeklyRecoveryMeta(weeklyRecoveryMeta(source), meta);
  weeklyRecoveryKey(sourceKey);
  const bundle = validateBundle(await unseal(source, sourceKey));
  if (bundle.vaultId !== source.vaultId) throw new Error('來源快照內容與資料庫身分不符。');
  const original = JSON.stringify(bundle), plan = await planBackupImport(null, bundle);
  const envelope = await seal(bundle, key, meta);
  if (JSON.stringify(await unseal(envelope, key)) !== original) throw new Error('每週備份完整性驗證失敗；尚未交付保存。');
  return { envelope, sha256: await hashBytes(enc.encode(JSON.stringify({ format: 'pharmacy-backup-1', envelope }))), summary: plan.summary.incoming, warnings: plan.summary.warnings.length };
}

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

const TAIWAN_CITIES = ['臺北市','新北市','桃園市','臺中市','臺南市','高雄市','基隆市','新竹市','嘉義市','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣','屏東縣','宜蘭縣','花蓮縣','臺東縣','澎湖縣','金門縣','連江縣'];
export function splitTaiwanAddress(value) {
  if (typeof value !== 'string') return null;
  let address = value.trim().replace(/^中華民國(?:\s*（?臺灣）?)?\s*/, '').replace(/^臺灣(?:省)?\s*/, '').replace(/^台灣(?:省)?\s*/, '').replace(/^\d{3,6}\s*/, '');
  address = address.replace(/^台北市/, '臺北市').replace(/^台中市/, '臺中市').replace(/^台南市/, '臺南市').replace(/^台東縣/, '臺東縣');
  const city = TAIWAN_CITIES.find(name => address.startsWith(name));
  if (!city) return null;
  const district = address.slice(city.length).match(/^(.{1,5}?(?:區|鄉|鎮|市))/)?.[1] || '';
  if (!district) return null;
  return { address, city, district };
}
export function buildStoreEnrichmentRequest(bundle, generatedAt = new Date().toISOString()) {
  validateBundle(bundle);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('補查清單時間不正確。');
  const stores = project(bundle).filter(store => store.type === 'store' && !store.deleted && !store.conflict && !store.csvIdentityPending && !store.mergedInto);
  const items = [];
  for (const store of stores) {
    const urls = [store.mapUrl, ...(store.csvSources || []).flatMap(source => source.headers.flatMap((header, index) => /^(網址|地圖網址|google\s*maps(?:\s*網址)?|url|map\s*url)$/i.test(header.trim()) ? [source.cells[index]] : []))].filter(Boolean);
    const ids = [...new Set(urls.map(coordinateFeature).filter(Boolean))];
    if (ids.length !== 1 || store.address?.trim() && store.city?.trim() && store.district?.trim()) continue;
    const sourceUrl = urls.find(url => coordinateFeature(url) === ids[0]);
    items.push({ featureId: ids[0], sourceUrl, sourceNames: [...new Set([store.name, ...(store.csvAliases || [])].map(name => name.trim()).filter(Boolean))] });
  }
  items.sort((a, b) => a.featureId.localeCompare(b.featureId));
  return { format: 'pharmacy-store-enrichment-request-1', generatedAt, items };
}
export function validateStoreEnrichment(input) {
  const fail = () => { throw new Error('門市資料補查檔案格式或地點證據不完整，未修改資料。'); };
  if (!input || input.format !== 'pharmacy-store-enrichment-1' || !Array.isArray(input.items) || input.items.length > 2000 || input.unresolved !== undefined && (!Array.isArray(input.unresolved) || input.unresolved.length > 2000) || !input.items.length && !input.unresolved?.length) fail();
  const seen = new Set();
  const items = input.items.map(item => {
    if (!plain(item) || typeof item.featureId !== 'string' || !/^0x[a-f0-9]+:0x[a-f0-9]+$/.test(item.featureId) || seen.has(item.featureId) || typeof item.resolvedUrl !== 'string' || item.resolvedUrl.length > 2000 || coordinateFeature(item.resolvedUrl) !== item.featureId || typeof item.googleName !== 'string' || !item.googleName.trim() || item.googleName.length > 500 || !Array.isArray(item.sourceNames) || !item.sourceNames.length || item.sourceNames.length > 100 || item.sourceNames.some(name => typeof name !== 'string' || !name.trim() || name.length > 500) || !item.sourceNames.some(name => name.trim() === item.googleName.trim()) || typeof item.address !== 'string' || !item.address.trim() || item.address.length > 2000 || !Number.isFinite(Date.parse(item.checkedAt))) fail();
    const location = splitTaiwanAddress(item.address); if (!location) fail();
    seen.add(item.featureId);
    return { featureId: item.featureId, resolvedUrl: item.resolvedUrl, googleName: item.googleName.trim(), sourceNames: [...item.sourceNames], sourceAddress: item.address.trim(), checkedAt: item.checkedAt, ...location };
  });
  for (const item of input.unresolved || []) {
    if (!plain(item) || typeof item.featureId !== 'string' || !/^0x[a-f0-9]+:0x[a-f0-9]+$/.test(item.featureId) || seen.has(item.featureId) || !Array.isArray(item.sourceNames) || !item.sourceNames.length || item.sourceNames.length > 100 || item.sourceNames.some(name => typeof name !== 'string' || !name.trim() || name.length > 500) || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 1000) fail();
    seen.add(item.featureId);
  }
  return items;
}
export function planStoreEnrichment(bundle, input) {
  validateBundle(bundle);
  const items = validateStoreEnrichment(input), lookup = new Map(items.map(item => [item.featureId, item]));
  const stores = project(bundle).filter(store => store.type === 'store' && (!store.deleted || store.conflict));
  const evidence = store => {
    const urls = [store.mapUrl, ...(store.csvSources || []).flatMap(source => source.headers.flatMap((header, index) => /^(網址|地圖網址|google\s*maps(?:\s*網址)?|url|map\s*url)$/i.test(header.trim()) ? [source.cells[index]] : []))].filter(Boolean);
    const ids = [...new Set(urls.map(coordinateFeature).filter(Boolean))];
    return { featureId: ids.length === 1 ? ids[0] : '', ambiguous: ids.length !== 1 };
  };
  const evidenceByStore = new Map(stores.map(store => [store.id, evidence(store)]));
  const counts = new Map(); for (const value of evidenceByStore.values()) if (value.featureId) counts.set(value.featureId, (counts.get(value.featureId) || 0) + 1);
  const changes = [], exceptions = [], used = new Set();
  for (const store of stores) {
    const proof = evidenceByStore.get(store.id), item = lookup.get(proof.featureId); let reason = '';
    if (store.conflict || store.csvIdentityPending || store.deleted || store.mergedInto) reason = '版本衝突或身分待確認';
    else if (proof.ambiguous) reason = '缺少唯一 Google 地點識別或來源識別不一致';
    else if (!item) continue;
    else if (counts.get(proof.featureId) > 1) reason = '相同 Google 地點識別對應多筆門市，需先核對身分';
    else if (store.name.trim() !== item.googleName || !item.sourceNames.some(name => name.trim() === store.name.trim())) reason = 'Google 名稱與目前門市名稱不同，需重新核對身分';
    else if (store.address?.trim() && store.address.trim() !== item.address) reason = '現有地址與公開資料不同，不自動覆蓋';
    else if (store.city?.trim() && store.city.trim().replace(/^台/, '臺') !== item.city) reason = '現有縣市與地址拆分結果不同，不自動覆蓋';
    else if (store.district?.trim() && store.district.trim() !== item.district) reason = '現有行政區與地址拆分結果不同，不自動覆蓋';
    const additions = reason ? {} : Object.fromEntries([['address', item.address], ['city', item.city], ['district', item.district]].filter(([field]) => !store[field]?.trim()));
    if (!reason && !Object.keys(additions).length) reason = '地址、縣市與行政區已有一致資料，不需修改';
    if (reason) exceptions.push({ id: store.id, name: store.name, featureId: proof.featureId, reason });
    else {
      used.add(item.featureId);
      changes.push({ id: store.id, name: store.name, parents: store.heads.map(head => head.id).sort(), before: { address: store.address || '', city: store.city || '', district: store.district || '' }, additions, source: { provider: 'Google Maps 公開資料', featureId: item.featureId, sourceUrl: item.resolvedUrl, sourceAddress: item.sourceAddress, address: item.address, city: item.city, district: item.district, checkedAt: item.checkedAt } });
    }
  }
  for (const item of items) if (!used.has(item.featureId) && !exceptions.some(entry => entry.featureId === item.featureId)) exceptions.push({ id: '', name: item.googleName, featureId: item.featureId, reason: '目前資料庫找不到可安全對應的門市' });
  for (const item of input.unresolved || []) {
    const storesForFeature = stores.filter(store => evidenceByStore.get(store.id).featureId === item.featureId);
    if (storesForFeature.length) for (const store of storesForFeature) exceptions.push({ id: store.id, name: store.name, featureId: item.featureId, reason: '公開資料補查未完成：' + item.reason });
    else exceptions.push({ id: '', name: item.sourceNames[0], featureId: item.featureId, reason: '公開資料補查未完成：' + item.reason });
  }
  changes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant') || a.id.localeCompare(b.id));
  exceptions.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant') || a.featureId.localeCompare(b.featureId));
  return { vaultId: bundle.vaultId, changes, exceptions };
}
export function applyStoreEnrichment(bundle, input, expected, device) {
  const current = planStoreEnrichment(bundle, input);
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('資料或補查結果已改變，請重新預覽；尚未套用。');
  if (!current.changes.length) throw new Error('沒有可安全補上的門市資料。');
  const next = structuredClone(bundle), stores = new Map(project(bundle).map(store => [store.id, store]));
  for (const change of current.changes) {
    const store = stores.get(change.id), prior = store.heads[0].data.enrichmentSources || [];
    const data = { ...store.heads[0].data, ...change.additions, enrichmentSources: [...prior.slice(-49), change.source] };
    next.ops.push(revision('store', store.id, data, change.parents, device));
  }
  return validateBundle(next);
}

// Private, reviewed analysis is an optional store field. It never changes visit
// text or creates attendance; older schema-2 clients preserve the unknown field.
const insightKeys = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const insightId = value => str(value, 100) && !!value.trim() && value === value.trim();
const insightText = (value, max) => str(value, max) && !!value.trim();
function insightInstant(value) {
  if (!taskTime(value)) return false;
  return new Date(value).toISOString() === value;
}
function insightDate(value) {
  return str(value, 10) && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value;
}
export function storeInsightsIdentityKey(store) {
  return JSON.stringify({ name: store.name, address: store.address ?? '', mapUrl: store.mapUrl ?? '', city: store.city ?? '', district: store.district ?? '', csvIdentityPending: store.csvIdentityPending === true, mergedInto: store.mergedInto ?? '', mergeDecision: store.mergeDecision ?? '' });
}
function validInsightIdentityKey(value) {
  if (!str(value, 12000)) return false;
  let data; try { data = JSON.parse(value); } catch { return false; }
  return insightKeys(data, ['name', 'address', 'mapUrl', 'city', 'district', 'csvIdentityPending', 'mergedInto', 'mergeDecision'])
    && insightText(data.name, 200) && ['address', 'mapUrl'].every(key => str(data[key], 2000)) && ['city', 'district'].every(key => str(data[key], 500))
    && typeof data.csvIdentityPending === 'boolean' && str(data.mergedInto, 100) && str(data.mergeDecision, 200) && storeInsightsIdentityKey(data) === value;
}
function validInsightEvidence(source) {
  return insightKeys(source, ['storeId', 'storeIdentityKey', 'visitId', 'revisionId', 'quote', 'role'])
    && ['storeId', 'visitId', 'revisionId'].every(key => insightId(source[key])) && validInsightIdentityKey(source.storeIdentityKey)
    && insightText(source.quote, 2000) && ['support', 'counter'].includes(source.role);
}
function validInsightEntry(entry) {
  return insightKeys(entry, ['id', 'kind', 'level', 'headline', 'question', 'caution', 'limitations', 'evidence'])
    && insightId(entry.id) && ['relationship', 'customer'].includes(entry.kind) && ['source', 'inference', 'counter'].includes(entry.level)
    && insightText(entry.headline, 500) && insightText(entry.question, 2000) && str(entry.caution, 2000)
    && Array.isArray(entry.limitations) && entry.limitations.length <= 20 && entry.limitations.every(value => insightText(value, 1000))
    && Array.isArray(entry.evidence) && entry.evidence.length > 0 && entry.evidence.length <= 40 && entry.evidence.every(validInsightEvidence)
    && new Set(entry.evidence.map(source => JSON.stringify([source.storeId, source.visitId, source.revisionId, source.quote]))).size === entry.evidence.length;
}
function validStoreInsights(value) {
  return insightKeys(value, ['format', 'batchId', 'generatedAt', 'sourceAsOf', 'entries']) && value.format === 'pharmacy-store-insights-1'
    && insightId(value.batchId) && insightInstant(value.generatedAt) && insightDate(value.sourceAsOf)
    && Array.isArray(value.entries) && value.entries.length <= 20 && value.entries.every(validInsightEntry)
    && new Set(value.entries.map(entry => entry.id)).size === value.entries.length && enc.encode(JSON.stringify(value)).length <= 256 * 1024;
}
// Kit's review is separate from the evidence classification. It is an explicit
// append-only decision about one exact card, not an identity adjudication or a
// statement that similarly named people/other stores have been confirmed.
function canonicalInsightEntry(entry) {
  if (!plain(entry) || !Array.isArray(entry.evidence)) return null;
  return { id: entry.id, kind: entry.kind, level: entry.level, headline: entry.headline, question: entry.question,
    caution: entry.caution, limitations: entry.limitations,
    evidence: entry.evidence.map(source => ({ storeId: source?.storeId, storeIdentityKey: source?.storeIdentityKey,
      visitId: source?.visitId, revisionId: source?.revisionId, quote: source?.quote, role: source?.role })) };
}
function insightEntryKey(entry) {
  const exact = canonicalInsightEntry(entry);
  return validInsightEntry(exact) ? JSON.stringify(exact) : '';
}
function canonicalInsightReview(event) {
  return { id: event.id, status: event.status, reviewedBy: event.reviewedBy, reviewedAt: event.reviewedAt,
    sourceAsOf: event.sourceAsOf, entry: canonicalInsightEntry(event.entry), ...(event.carriedFrom ? { carriedFrom: event.carriedFrom } : {}) };
}
function validInsightReview(event) {
  return insightKeys(event, ['id', 'status', 'reviewedBy', 'reviewedAt', 'sourceAsOf', 'entry', ...(event?.carriedFrom ? ['carriedFrom'] : [])])
    && (!event.carriedFrom || insightKeys(event.carriedFrom, ['storeId', 'sourceRevision', 'eventId', 'mergeId']) && Object.values(event.carriedFrom).every(insightId))
    && insightId(event.id) && ['confirmed', 'pending', 'rejected'].includes(event.status)
    && event.reviewedBy === 'Kit' && insightInstant(event.reviewedAt) && insightDate(event.sourceAsOf) && validInsightEntry(event.entry);
}
function validInsightReviews(events) {
  return Array.isArray(events) && events.length <= 1000 && events.every(validInsightReview)
    && new Set(events.map(event => event.id)).size === events.length && enc.encode(JSON.stringify(events)).length <= 2 * 1024 * 1024;
}
export function storeInsightReviewHistory(store) {
  const current = validInsightReviews(store?.preVisitInsightReviews) ? store.preVisitInsightReviews : [], activeIds = new Set(current.map(event => event.id)), history = new Map();
  for (const data of [...(store?.versions || []).map(version => version.data), store]) {
    if (!validInsightReviews(data?.preVisitInsightReviews)) continue;
    for (const event of data.preVisitInsightReviews) if (!history.has(event.id)) history.set(event.id, { ...structuredClone(event), historical: !activeIds.has(event.id) });
  }
  return [...history.values()].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || b.id.localeCompare(a.id));
}
export function insightReviewForEntry(store, entry) {
  const key = insightEntryKey(entry), history = key ? storeInsightReviewHistory(store).filter(event => insightEntryKey(event.entry) === key) : [];
  // Reading an old card, upgrading the App, or seeing a source-level card never
  // manufactures a Kit decision. A conflict never picks one branch's approval.
  const current = key && !store?.conflict && validInsightReviews(store?.preVisitInsightReviews)
    ? [...store.preVisitInsightReviews].reverse().find(event => insightEntryKey(event.entry) === key) : null;
  return current ? { status: current.status, reviewedAt: current.reviewedAt, reviewedBy: current.reviewedBy, ...(current.carriedFrom ? { carriedFrom: structuredClone(current.carriedFrom) } : {}), history } : { status: 'pending', history };
}
// Explicit private definitions bind exact existing cards to ONE verified claim.
// No person-name, card-ID, quote similarity, or graph traversal creates a group.
function canonicalInsightRelation(value) {
  return { format: value.format, id: value.id, claim: value.claim, members: value.members.map(member => ({
    storeId: member.storeId, storeIdentityKey: member.storeIdentityKey, entry: canonicalInsightEntry(member.entry)
  })).sort((a, b) => a.storeId.localeCompare(b.storeId)) };
}
function validInsightRelation(value) {
  return insightKeys(value, ['format', 'id', 'claim', 'members']) && value.format === 'pharmacy-insight-relation-1'
    && insightId(value.id) && insightText(value.claim, 1000) && Array.isArray(value.members) && value.members.length >= 2 && value.members.length <= 20
    && value.members.every(member => insightKeys(member, ['storeId', 'storeIdentityKey', 'entry']) && insightId(member.storeId)
      && validInsightIdentityKey(member.storeIdentityKey) && validInsightEntry(member.entry) && member.entry.kind === 'relationship'
      && member.entry.evidence.some(source => source.storeId === member.storeId && source.role === 'support'))
    && new Set(value.members.map(member => member.storeId)).size === value.members.length;
}
function insightRelationKey(value) { return validInsightRelation(value) ? JSON.stringify(canonicalInsightRelation(value)) : ''; }
function validInsightRelations(values) {
  return Array.isArray(values) && values.length <= 20 && values.every(validInsightRelation)
    && new Set(values.map(value => value.id)).size === values.length && enc.encode(JSON.stringify(values)).length <= 2 * 1024 * 1024;
}
function currentInsightEvent(store, entry) {
  const key = insightEntryKey(entry);
  return key && !store?.conflict && validInsightReviews(store?.preVisitInsightReviews)
    ? [...store.preVisitInsightReviews].reverse().find(event => insightEntryKey(event.entry) === key) : null;
}
function resolveInsightRelation(context, storeId, entry) {
  const store = context.index.get('store:' + storeId), key = insightEntryKey(entry);
  const mappings = (store?.preVisitInsightRelations || []).filter(value => value.members.some(member => member.storeId === storeId && insightEntryKey(member.entry) === key));
  if (!mappings.length || entry.kind !== 'relationship') return null;
  const invalid = message => ({ members: [], notice: message });
  if (mappings.length !== 1) return invalid('這張人物關係有多份對應，需核對；未沿用其他門市的確認。');
  const relation = mappings[0], fingerprint = insightRelationKey(relation), members = [];
  for (const member of relation.members) {
    const peer = context.index.get('store:' + member.storeId);
    if (!safeInsightStore(peer)) return invalid('相關門市有衝突、身分待確認或已停用，需核對；未沿用其他門市的確認。');
    const exact = insightEntryKey(member.entry), card = peer.preVisitInsights?.entries.find(item => insightEntryKey(item) === exact);
    const maps = (peer.preVisitInsightRelations || []).filter(value => value.members.some(item => item.storeId === peer.id && insightEntryKey(item.entry) === exact));
    if (!card || maps.length !== 1 || insightRelationKey(maps[0]) !== fingerprint
      || (peer.storeMergeStaleEntries || []).some(item => item.id === card.id && item.key === exact)) return invalid('關係對應不完整或卡片內容已改變，需核對；未沿用其他門市的確認。');
    if (!context.identities.get(peer.id)?.has(member.storeIdentityKey)
      || card.evidence.some(source => !resolveInsightEvidenceForDisplay(source, context).historicalAvailable)) return invalid('關係對應的原始身分或引用版本無法核實；未沿用其他門市的確認。');
    members.push({ store: peer, entry: card, event: currentInsightEvent(peer, card) });
  }
  return { definition: relation, members, notice: '' };
}
function sharedInsightReview(context, storeId, entry) {
  const store = context.index.get('store:' + storeId), local = insightReviewForEntry(store, entry);
  const relation = resolveInsightRelation(context, storeId, entry);
  if (!relation) return local;
  if (relation.notice) return { ...local, sharedConflict: relation.notice };
  const info = { id: relation.definition.id, claim: relation.definition.claim,
    members: relation.members.map(member => ({ storeId: member.store.id, storeName: member.store.name, entryId: member.entry.id })) };
  const relationSourceReasons = [...new Set(relation.members.flatMap(member => member.entry.evidence.flatMap(source =>
    resolveInsightEvidenceForDisplay(source, context).sourceReasons.map(reason => member.store.name + ' 的關係來源：' + reason))))];
  const sharedContext = { relation: info, relationSourceReasons };
  const confirmed = relation.members.filter(member => member.event?.status === 'confirmed');
  const opposed = relation.members.filter(member => member.event && member.event.status !== 'confirmed');
  const conflict = confirmed.length && opposed.length ? '相關門市的人工判定不一致；各店原決定保留，尚未審核的門市不自動沿用，請核對。' : '';
  // A local explicit pending/rejected is a decision, not an empty default.
  if (currentInsightEvent(store, entry) || !confirmed.length || conflict) return { ...local, ...sharedContext, ...(conflict ? { sharedConflict: conflict } : {}) };
  // Deterministic provenance only; never use timestamps to resolve disagreement.
  const donor = confirmed.sort((a, b) => a.store.id.localeCompare(b.store.id))[0];
  return { ...local, status: 'confirmed', reviewedAt: donor.event.reviewedAt, reviewedBy: donor.event.reviewedBy,
    ...sharedContext, sharedFrom: { storeId: donor.store.id, storeName: donor.store.name, eventId: donor.event.id, reviewedAt: donor.event.reviewedAt } };
}
export function insightSharedReviewForEntry(bundle, storeId, entry) {
  return sharedInsightReview(insightEvidenceContext(bundle), storeId, entry);
}
export function planStoreInsightRelations(bundle, input) {
  validateBundle(bundle);
  if (!insightKeys(input, ['format', 'vaultId', 'generatedAt', 'relations', 'expectedHeads']) || input.format !== 'pharmacy-insight-relations-import-1'
    || input.vaultId !== bundle.vaultId || !insightInstant(input.generatedAt) || !Array.isArray(input.relations) || !input.relations.length || input.relations.length > 200
    || !input.relations.every(validInsightRelation) || new Set(input.relations.map(value => value.id)).size !== input.relations.length
    || !Array.isArray(input.expectedHeads) || input.expectedHeads.length > 500 || input.expectedHeads.some(item => !insightKeys(item, ['storeId', 'headId']) || !insightId(item.storeId) || !insightId(item.headId))
    || new Set(input.expectedHeads.map(item => item.storeId)).size !== input.expectedHeads.length || enc.encode(JSON.stringify(input)).length > 2 * 1024 * 1024) throw new Error('人物關係對應格式、資料庫或大小不符；尚未寫入。');
  const context = insightEvidenceContext(bundle), declared = new Map(), changes = new Map(), used = new Set();
  for (const op of bundle.ops) for (const relation of op.data.preVisitInsightRelations || []) declared.set(relation.id, insightRelationKey(relation));
  const heads = new Map(input.expectedHeads.map(item => [item.storeId, item.headId]));
  for (const relation of input.relations) {
    const fingerprint = insightRelationKey(relation);
    if (declared.has(relation.id) && declared.get(relation.id) !== fingerprint) throw new Error('既有人物關係識別不能改成另一份內容；請核對新關係。');
    for (const member of relation.members) {
      const store = context.index.get('store:' + member.storeId), exact = insightEntryKey(member.entry);
      if (!safeInsightStore(store) || heads.get(member.storeId) !== store.heads[0].id || storeInsightsIdentityKey(store) !== member.storeIdentityKey
        || !store.preVisitInsights?.entries.some(entry => insightEntryKey(entry) === exact)) throw new Error('門市、關係卡或預覽版本已改變；尚未寫入。');
      // New definitions require inspectable originals and still-present quotes.
      // Source revisions may be newer without rewriting the approved old card.
      for (const source of member.entry.evidence) {
        const visit = context.index.get('visit:' + source.visitId), sourceStore = context.index.get('store:' + source.storeId);
        if (!resolveInsightEvidenceForDisplay(source, context).historicalAvailable || !safeInsightStore(sourceStore) || !safeInsightVisit(visit, context.index)
          || visit.store !== source.storeId || !visit.text.includes(source.quote)) throw new Error('關係對應的引用原文或現行來源無法核實；尚未寫入。');
      }
      const memberKey = JSON.stringify([member.storeId, exact]);
      if (used.has(memberKey)) throw new Error('同一張卡不能同時加入不同人物關係；尚未寫入。');
      used.add(memberKey);
      if (!changes.has(store.id)) changes.set(store.id, { storeId: store.id, storeName: store.name, expectedHead: store.heads[0].id,
        before: structuredClone(store.preVisitInsightRelations || []), after: structuredClone(store.preVisitInsightRelations || []) });
      const item = changes.get(store.id);
      if (item.after.some(value => value.id !== relation.id && value.members.some(peer => peer.storeId === store.id && insightEntryKey(peer.entry) === exact))) throw new Error('這張卡已有另一份人物關係對應，須先核對；尚未寫入。');
      if (!item.after.some(value => value.id === relation.id)) item.after.push(canonicalInsightRelation(relation));
      if (!validInsightRelations(item.after)) throw new Error('人物關係對應已達大小或數量上限；尚未寫入。');
    }
  }
  if (heads.size !== changes.size) throw new Error('人物關係預覽的門市範圍不一致；尚未寫入。');
  const ready = [...changes.values()].filter(item => JSON.stringify(item.before) !== JSON.stringify(item.after)).sort((a, b) => a.storeId.localeCompare(b.storeId));
  return { vaultId: bundle.vaultId, relations: input.relations.map(value => ({ ...canonicalInsightRelation(value), members: value.members.map(member => ({ ...structuredClone(member), storeName: context.index.get('store:' + member.storeId).name })) })), ready, excluded: [],
    baseHeads: [...context.index.values()].map(record => [record.type, record.id, record.heads.map(head => head.id)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
}
export function applyStoreInsightRelations(bundle, input, plan, device) {
  const current = planStoreInsightRelations(bundle, input);
  if (!plain(plan) || JSON.stringify(current) !== JSON.stringify(plan)) throw new Error('人物關係對應預覽後資料已改變；請重新核對。');
  if (!current.ready.length) return bundle;
  if (!insightId(device)) throw new Error('裝置識別不完整；尚未寫入。');
  const index = insightRecordIndex(bundle), next = structuredClone(bundle);
  for (const item of current.ready) next.ops.push(revision('store', item.storeId, { ...index.get('store:' + item.storeId).heads[0].data,
    preVisitInsightRelations: structuredClone(item.after) }, [item.expectedHead], device));
  next.schema = Math.max(2, next.schema);
  if (enc.encode(JSON.stringify(next)).length > MAX_BYTES) throw new Error('資料已達 24 MB 上限；尚未寫入。');
  return validateBundle(next);
}
export function planInsightReview(bundle, storeId, entryId, status, expectedHead) {
  validateBundle(bundle);
  if (![storeId, entryId, expectedHead].every(insightId) || !['confirmed', 'pending', 'rejected'].includes(status)) throw new Error('分析審核選項或識別不完整；尚未寫入任何資料。');
  const index = insightRecordIndex(bundle), store = index.get('store:' + storeId);
  if (!safeInsightStore(store) || store.heads[0].id !== expectedHead) throw new Error('門市版本已改變或需要先核對衝突／身分；尚未寫入任何資料。');
  const profile = store.preVisitInsights, entry = profile?.entries.find(item => item.id === entryId);
  if (!entry || !resolveInsightEntry(entry, storeId, index)) throw new Error('這張分析的原文來源已變更或不再有效；請重新核對，尚未寫入任何資料。');
  const localBeforeStatus = insightReviewForEntry(store, entry).status, effective = insightSharedReviewForEntry(bundle, storeId, entry), beforeStatus = effective.status;
  if (effective.relationSourceReasons?.length) throw new Error('共同關係的原文來源已變更或不再有效；請重新核對，尚未寫入任何資料。');
  // Bind every declared member's current source heads, even when an incomplete
  // group cannot currently share a review. A source-only edit must invalidate
  // the preview without requiring any peer store metadata to change.
  const entryKey = insightEntryKey(entry), relationVisitIds = new Set((store.preVisitInsightRelations || [])
    .filter(relation => relation.members.some(member => member.storeId === storeId && insightEntryKey(member.entry) === entryKey))
    .flatMap(relation => relation.members.flatMap(member => member.entry.evidence.map(source => source.visitId))));
  const relationEvidenceBasis = [...relationVisitIds].sort().map(visitId => [visitId,
    (index.get('visit:' + visitId)?.heads || []).map(head => head.id).sort()]);
  const relatedStores = [], relatedExcluded = [];
  const peerDisagreement = status === 'confirmed' && (effective.relation?.members || []).some(member => {
    if (member.storeId === storeId) return false;
    const peer = index.get('store:' + member.storeId), card = peer.preVisitInsights.entries.find(item => item.id === member.entryId), event = currentInsightEvent(peer, card);
    return event && event.status !== 'confirmed';
  });
  const relationBasis = (effective.relation?.members || []).map(member => {
    const peer = index.get('store:' + member.storeId), card = peer.preVisitInsights.entries.find(item => item.id === member.entryId), event = currentInsightEvent(peer, card);
    if (peer.id !== storeId) (event && event.status !== 'confirmed' || peerDisagreement && !event ? relatedExcluded : relatedStores).push({ storeId: peer.id, storeName: peer.name, status: event?.status || 'pending',
      ...(peerDisagreement && !event ? { reason: '其他門市已有不同判定，暫不共用' } : {}) });
    return [peer.id, peer.heads[0].id];
  });
  return { vaultId: bundle.vaultId, storeId, storeName: store.name, entryId, status, beforeStatus, expectedHead,
    sourceAsOf: profile.sourceAsOf, entry: structuredClone(entry), localBeforeStatus, relatedStores, relatedExcluded, relationBasis, relationEvidenceBasis,
    relationClaim: effective.relation?.claim || '', changed: beforeStatus !== status };
}
export function applyInsightReview(bundle, plan, device) {
  if (!plain(plan)) throw new Error('分析審核預覽不完整；尚未寫入任何資料。');
  const current = planInsightReview(bundle, plan.storeId, plan.entryId, plan.status, plan.expectedHead);
  if (JSON.stringify(current) !== JSON.stringify(plan)) throw new Error('分析審核預覽後資料已改變；請重新核對，尚未寫入任何資料。');
  if (!current.changed) return bundle;
  if (!insightId(device)) throw new Error('裝置識別不完整；尚未寫入任何資料。');
  const store = insightRecordIndex(bundle).get('store:' + current.storeId), reviewedAt = new Date().toISOString();
  const event = { id: uuid(), status: current.status, reviewedBy: 'Kit', reviewedAt, sourceAsOf: current.sourceAsOf, entry: structuredClone(current.entry) };
  const events = [...(store.preVisitInsightReviews || []), event];
  if (!validInsightReviews(events)) throw new Error('分析審核歷史已達上限，既有歷史完整保留；本次尚未寫入。');
  const next = structuredClone(bundle), op = revision('store', store.id, { ...store.heads[0].data, preVisitInsightReviews: events }, [current.expectedHead], device);
  op.at = reviewedAt; next.schema = Math.max(2, next.schema); next.ops.push(op);
  if (enc.encode(JSON.stringify(next)).length > MAX_BYTES) throw new Error('資料已達此版 24 MB 上限，既有歷史完整保留；本次尚未寫入。');
  return validateBundle(next);
}
export function validateStoreInsightsImport(input) {
  if (!insightKeys(input, ['format', 'vaultId', 'generatedAt', 'sourceAsOf', 'stores']) || input.format !== 'pharmacy-store-insights-import-1'
    || !insightId(input.vaultId) || !insightInstant(input.generatedAt) || !insightDate(input.sourceAsOf)
    || !Array.isArray(input.stores) || !input.stores.length || input.stores.length > 500
    || !input.stores.every(item => insightKeys(item, ['storeId', 'expectedStoreHead', 'insights']) && insightId(item.storeId) && insightId(item.expectedStoreHead)
      && validStoreInsights(item.insights) && item.insights.generatedAt === input.generatedAt && item.insights.sourceAsOf === input.sourceAsOf)
    || new Set(input.stores.map(item => item.storeId)).size !== input.stores.length
    || enc.encode(JSON.stringify(input)).length > 2 * 1024 * 1024) throw new Error('單店分析資料格式、來源欄位或大小不符；尚未寫入任何資料。');
  return input;
}
function insightRecordIndex(bundle) { return new Map(project(bundle).map(record => [record.type + ':' + record.id, record])); }
function safeInsightStore(store) { return !!store && !store.deleted && !store.conflict && !store.csvIdentityPending && !store.mergedInto && !store.sourceMissing && !store.googleUpdatePending && store.heads.length === 1; }
function safeInsightVisit(visit, index) { return !!visit && !visit.deleted && !visit.conflict && !visit.sourceMissing && !visit.googleUpdatePending && visit.heads.length === 1 && safeInsightStore(index.get('store:' + visit.store)); }
function resolveInsightEntry(entry, storeId, index) {
  if ((index.get('store:' + storeId)?.storeMergeStaleEntries || []).some(item => item.id === entry.id && item.key === insightEntryKey(entry))) return null;
  if (!entry.evidence.some(source => source.storeId === storeId)) return null;
  const evidence = [];
  for (const source of entry.evidence) {
    const store = index.get('store:' + source.storeId), visit = index.get('visit:' + source.visitId);
    if (!safeInsightStore(store) || storeInsightsIdentityKey(store) !== source.storeIdentityKey
      || !safeInsightVisit(visit, index) || visit.heads[0].id !== source.revisionId
      || visit.store !== source.storeId || !visit.text.includes(source.quote)) return null;
    evidence.push({ ...source, storeName: store.name, rawText: visit.text, sourceLabel: visit.source || '現行拜訪原文' });
  }
  return { ...structuredClone(entry), evidence };
}
export function storeInsightsForStore(bundle, storeId) {
  return resolveStoreInsights(insightRecordIndex(bundle), storeId);
}
function resolveStoreInsights(index, storeId) {
  const store = index.get('store:' + storeId), saved = store?.preVisitInsights;
  if (!saved) return { entries: [], staleCount: 0 };
  if (!validStoreInsights(saved)) return { entries: [], staleCount: Array.isArray(saved.entries) ? saved.entries.length : 0 };
  if (!safeInsightStore(store)) return { entries: [], staleCount: saved.entries.length };
  const entries = saved.entries.filter(entry => !(store.storeMergeStaleEntries || []).some(item => item.id === entry.id && item.key === insightEntryKey(entry))).map(entry => resolveInsightEntry(entry, storeId, index)).filter(Boolean);
  return { entries, staleCount: saved.entries.length - entries.length };
}
// Display is deliberately separate from import/review validation. A later source
// revision does not revoke Kit's exact current decision, and a historical review
// never becomes a current decision merely because its card was once confirmed.
function insightEvidenceContext(bundle, index = insightRecordIndex(bundle)) {
  const revisions = new Map(), identities = new Map();
  for (const op of bundle.ops) {
    revisions.set(op.id, op);
    if (op.type === 'store' && !op.deleted) {
      if (!identities.has(op.entity)) identities.set(op.entity, new Set());
      identities.get(op.entity).add(storeInsightsIdentityKey(op.data));
    }
  }
  return { index, revisions, identities };
}
function resolveInsightEvidenceForDisplay(source, context) {
  const { index, revisions, identities } = context, original = revisions.get(source.revisionId);
  const store = index.get('store:' + source.storeId), visit = index.get('visit:' + source.visitId);
  const historicalAvailable = !!original && original.type === 'visit' && original.entity === source.visitId
    && !original.deleted && original.data.store === source.storeId && typeof original.data.text === 'string'
    && original.data.text.includes(source.quote) && identities.get(source.storeId)?.has(source.storeIdentityKey) === true;
  const sourceReasons = [];
  if (!historicalAvailable) sourceReasons.push('無法核實當時引用的完整原文版本。');
  if (!store) sourceReasons.push('引用的門市目前不存在。');
  else {
    if (store.deleted) sourceReasons.push('引用的門市已移至回收桶。');
    if (store.conflict) sourceReasons.push('引用的門市有版本衝突，尚未選定版本。');
    if (store.mergedInto) sourceReasons.push('引用的門市已合併，身分需要核對。');
    if (store.csvIdentityPending) sourceReasons.push('引用的門市身分待確認。');
    if (store.sourceMissing || store.googleUpdatePending) sourceReasons.push('引用的門市來源待核對。');
    if (storeInsightsIdentityKey(store) !== source.storeIdentityKey) sourceReasons.push('引用的門市名稱、地址或身分資料已變更。');
  }
  if (!visit) sourceReasons.push('引用的拜訪紀錄目前不存在。');
  else {
    if (visit.deleted) sourceReasons.push('引用的拜訪紀錄已移至回收桶。');
    if (visit.conflict) sourceReasons.push('引用的拜訪紀錄有版本衝突，尚未選定版本。');
    if (visit.sourceMissing || visit.googleUpdatePending) sourceReasons.push('引用的拜訪原始來源待核對。');
    if (visit.store !== source.storeId) sourceReasons.push('引用的拜訪紀錄所屬門市已變更。');
    if (!visit.conflict && visit.heads[0]?.id !== source.revisionId) sourceReasons.push(historicalAvailable && visit.text === original.data.text
      ? '拜訪紀錄已有新版本（原文字未變）。' : '拜訪紀錄已有新版本，文字需重新核對。');
  }
  const sourceCurrent = historicalAvailable && safeInsightStore(store) && storeInsightsIdentityKey(store) === source.storeIdentityKey
    && safeInsightVisit(visit, index) && visit.heads[0].id === source.revisionId && visit.store === source.storeId && visit.text.includes(source.quote);
  return { ...structuredClone(source), storeName: JSON.parse(source.storeIdentityKey).name, historicalAvailable, sourceCurrent,
    sourceNotice: sourceReasons.join(' '), sourceReasons,
    ...(historicalAvailable ? { rawText: original.data.text, sourceLabel: original.data.source || '當時引用的拜訪原文', revisionAt: original.at } : {}) };
}
export function storeInsightEvidenceForEntry(bundle, entry) {
  const exact = canonicalInsightEntry(entry);
  if (!validInsightEntry(exact)) return [];
  const context = insightEvidenceContext(bundle);
  return exact.evidence.map(source => resolveInsightEvidenceForDisplay(source, context));
}
export function storeInsightDisplayForStore(bundle, storeId) {
  const index = insightRecordIndex(bundle), store = index.get('store:' + storeId), saved = store?.preVisitInsights;
  const empty = { entries: [], staleCount: Array.isArray(saved?.entries) ? saved.entries.length : 0, confirmedStaleCount: 0 };
  if (!saved || !validStoreInsights(saved) || !store || store.deleted || store.mergedInto || store.conflict || store.heads.length !== 1) return empty;
  const context = insightEvidenceContext(bundle, index), entries = [];
  let staleCount = 0, confirmedStaleCount = 0;
  for (const entry of saved.entries) {
    const strict = safeInsightStore(store) ? resolveInsightEntry(entry, storeId, index) : null;
    const review = sharedInsightReview(context, storeId, entry), confirmed = review.status === 'confirmed';
    if (!strict && !confirmed) { staleCount++; continue; }
    const evidence = entry.evidence.map(source => resolveInsightEvidenceForDisplay(source, context));
    const sourceReasons = [...new Set([...evidence.flatMap(source => source.sourceReasons), ...(review.relationSourceReasons || [])])];
    if (!strict && !sourceReasons.length) sourceReasons.push('本店分析來源或整併身分需要重新核對。');
    const sourceCurrent = !!strict && !(review.relationSourceReasons?.length);
    if (!sourceCurrent && confirmed) confirmedStaleCount++;
    entries.push({ ...structuredClone(entry), evidence, review, sourceCurrent, sourceReasons,
      sourceNotice: sourceCurrent ? '' : confirmed ? '來源已更新，需核對；Kit 已確認的紀錄仍保留。' : '共同關係的來源已更新，需重新核對。' });
  }
  return { entries, staleCount, confirmedStaleCount };
}
// Read-only, deliberately narrow change detection. These rules only compare
// explicit named-subject statements in formal visit text; they are not a general
// language model or a claim that the real-world relationship has been verified.
// Unsupported wording, ambiguity, uncertain identities and clock/date ambiguity
// are omitted. No elapsed-time expiry, source-version-only alert, or write occurs.
const insightScanName = "(?:[\\p{Script=Han}]{2,4}?|[A-Za-z][A-Za-z'-]{1,29}?)";
const insightScanLead = '^\\s*(?:(?:經確認|本次確認|確認|更正)[，,:：]?\\s*)?';
const insightScanEmployment = new RegExp(insightScanLead + '(' + insightScanName + ')(目前|現在|現已|已經|已|正式|曾經|曾|當時|仍然|仍)?(從[^，,。]{1,40}?(?:調到|調至|轉到)[^，,。]{1,40}|(?:在|於|任職於)[^，,。]{1,40}?(?:工作|任職|服務)|(?:是|擔任)[^，,。]{0,30}?(?:店長|藥師|負責人|採購|店員|主管|助理|經理)|離職(?:了)?|退休(?:了)?|離開本店(?:了)?|(?:調到|調至|轉到|轉任|改任|轉職至|轉調至)[^，,。]{1,40}|不再擔任[^，,。]{1,30})(?=[，,。!！;；]|$)', 'u');
const insightScanRelation = new RegExp(insightScanLead + '(' + insightScanName + ')(?:與|和|跟)(' + insightScanName + ')(目前|現在|曾經|曾|當時|已經|已|原本)?(是同一人|為同一人|是同一位|不是同一人|並非同一人|是不同人|不是朋友|並非朋友|已不再是朋友|不再是朋友|已不再聯絡|不再聯絡|已結束合作|結束合作|已離婚|離婚|是朋友|為朋友|是同事|為同事|是夫妻|為夫妻|共事)(?=[，,。!！;；]|$)', 'u');
const insightScanUncertain = /[?？]|是否|是不是|不知|不確定|待確認|待查|聽說|據說|可能|也許|好像|疑似|如果|假如|假設|若|計畫|打算|預計|準備|將會|將於|即將|想要|考慮|明年|明天|下週|下周|下月|尚未|還未|並未|沒有|未曾|否認|不是說|沒說|不會|誤傳|謠言|不實|假的|不是真的|不代表|不能證明|未證實|未確認|待核實|不可信|無法確認|不一定|不可能|似乎|搞錯|記錯|口誤|誤記|誤會|假消息|舉例/;
const insightScanPast = /曾經|以前|過去|當年|去年|前年|多年前|上次已|之前已|早已|早就|舊聞|回顧|歷史|補記|補登/;
const insightScanText = value => String(value).normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase();
function insightScanClauses(text) {
  return String(text || '').match(/[^。！？!?\n；;]+[。！？!?；;]?/gu) || [];
}
function insightScanFacts(text, incoming = false) {
  // Reject the entire incoming note when surrounding sentences disclaim the
  // event. Splitting off '已離職' must not discard a later '這是誤傳／舊紀錄'.
  // This intentionally misses mixed/complex notes rather than guessing scope.
  if (incoming && (insightScanUncertain.test(text) || insightScanPast.test(text)
    || /這是(?:當時|之前|舊|早期)|(?:假設|範例|演練|情境)[^\n]{0,80}[:：]/.test(text))) return [];
  const facts = [];
  for (const raw of insightScanClauses(text)) {
    const quote = raw.trim(), clause = quote.normalize('NFKC').replace(/[\t ]+/g, '');
    if (!clause || clause.length > 600 || insightScanUncertain.test(clause) || incoming && insightScanPast.test(clause)) continue;
    const relation = insightScanRelation.exec(clause), employment = insightScanEmployment.exec(clause);
    if (relation) {
      const [, first, second, when = '', action] = relation;
      if (first === second || incoming && /曾|當時|原本/.test(when)) continue;
      const subjects = [first, second].sort(), historical = /曾|當時|原本/.test(when),
        identity = /同一|不同人/.test(action), correction = /不是|並非|不同人/.test(action),
        changed = correction || /不再|結束|離婚/.test(action),
        state = identity ? correction ? 'different-people' : 'same-person' : /不再聯絡|結束合作/.test(action) ? 'contact-ended'
          : /離婚/.test(action) ? 'divorced' : /不再是朋友|不是朋友|並非朋友/.test(action) ? 'not-friends'
            : /朋友/.test(action) ? 'friends' : /夫妻/.test(action) ? 'married' : 'colleagues';
      // A plain negative can concern the present or the past. Only a recorded
      // correction has enough scope to compare a non-change statement.
      if (incoming && (!changed || correction && !/經確認|本次確認|更正/.test(clause))) continue;
      facts.push({ subjects, domain: identity ? 'identity' : 'relationship', state, historical, correction, quote,
        signature: JSON.stringify([subjects, identity ? 'identity' : 'relationship', state]) });
    } else if (employment) {
      const [, subject, when = '', action] = employment;
      if (incoming && /曾|當時/.test(when)) continue;
      const historical = /曾|當時/.test(when) || /^從/.test(action) && !/已|現在|目前/.test(when),
        moving = /調到|調至|轉到|轉任|改任|轉職至|轉調至/.test(action),
        target = moving ? action.replace(/^.*?(?:調到|調至|轉到|轉任|改任|轉職至|轉調至)/, '').replace(/(?:工作|任職|服務|上班)$/, '') : '',
        roleMatch = /(?:店長|藥師|負責人|採購|店員|主管|助理|經理)$/.exec(moving ? target : /^(?:是|擔任)/.test(action) ? action : ''),
        role = roleMatch?.[0] || '',
        place = moving ? (role ? target.slice(0, -role.length).replace(/(?:擔任|任)$/, '') : target)
          : /^(?:在|於|任職於)/.test(action) ? action.replace(/^(?:任職於|在|於)/, '').replace(/(?:工作|任職|服務)$/, '')
            : role ? action.replace(/^(?:是|擔任)/, '').slice(0, -role.length) : '',
        state = /^離職|^離開本店/.test(action) ? 'left' : /^退休/.test(action) ? 'retired'
          : /^不再擔任/.test(action) ? 'role-ended:' + insightScanText(action.replace(/^不再擔任/, ''))
            : moving ? 'moved' : 'working';
      if (incoming && (state === 'working' || historical || !(when || /了$|^(?:調|轉|改)/.test(action)))) continue;
      facts.push({ subjects: [subject], domain: 'employment', state, place: insightScanText(place), role, historical, correction: false, quote,
        signature: JSON.stringify([[subject], 'employment', state, insightScanText(place), role]) });
    }
  }
  return facts;
}
function insightScanHeadlineSupports(headline, original) {
  const matches = claim => claim.domain === original.domain && JSON.stringify(claim.subjects) === JSON.stringify(original.subjects);
  if (insightScanFacts(headline).some(matches)) return true;
  // Analysis headlines often wrap a literal named statement in a short source
  // attribution. Recognize only these explicit wrappers, not arbitrary mentions
  // of the name near a job keyword (e.g. a friendship claim quoting a job note).
  if (insightScanUncertain.test(headline)) return false;
  const subject = original.subjects.length === 1 ? original.subjects[0] : '';
  const transfer = subject && new RegExp('^' + subject + '(?:目前|現在|當時|曾經|曾|已經|已)?(?:由|從)[^，,。；;]{1,40}?(?:調來|(?:調到|調至|轉到|轉任)[^，,。；;的]{1,40})(?=[，,。；;]|$)', 'u');
  for (const raw of insightScanClauses(headline)) {
    const clause = raw.normalize('NFKC').replace(/[\t ]+/g, ''),
      attributed = clause.replace(/^(?:(?:本店|本次|舊|原|拜訪)?(?:紀錄|記錄|筆記)(?:記載|提到|寫到|寫|顯示)?)[：:]?/, '');
    if (attributed === clause) continue;
    if (insightScanFacts(attributed).some(matches)) return true;
    if (original.domain === 'employment' && transfer && transfer.test(attributed)) return true;
  }
  return false;
}
function insightScanPeople(visitData, subject, index) {
  const people = (visitData.people || []).map(id => index.get('person:' + id)).filter(person => person
    && (person.name === subject || person.versions.some(op => op.data.name === subject)));
  return { ids: people.map(person => person.id), unsafe: people.some(person => person.name !== subject || person.confirmed !== true
    || person.deleted || person.conflict || person.sameAs || person.heads.length !== 1) };
}
function insightScanSameSubjects(original, source, candidate, context) {
  if (original.domain !== candidate.fact.domain || JSON.stringify(original.subjects) !== JSON.stringify(candidate.fact.subjects)) return false;
  const oldVisit = context.revisions.get(source.revisionId)?.data;
  if (!oldVisit) return false;
  for (const subject of original.subjects) {
    const oldPeople = insightScanPeople(oldVisit, subject, context.index), newPeople = insightScanPeople(candidate.visit, subject, context.index),
      oldIds = oldPeople.ids, newIds = newPeople.ids;
    if (oldPeople.unsafe || newPeople.unsafe) return false;
    // Same names across stores are never identities. An explicit, safe confirmed
    // person ID on both source and new note is the only cross-store path.
    if (source.storeId !== candidate.visit.store && (oldIds.length !== 1 || newIds.length !== 1 || oldIds[0] !== newIds[0])) return false;
    if (oldIds.length > 1 || newIds.length > 1 || oldIds.length && newIds.length && oldIds[0] !== newIds[0]) return false;
  }
  return true;
}
function insightScanComparison(original, incoming) {
  if (original.signature === incoming.signature) return null;
  if (incoming.domain === 'identity') {
    if (original.state !== 'same-person' || incoming.state !== 'different-people') return null;
    return { kind: 'possible-contradiction', reason: '新筆記明確更正同一人判斷，可能與原線索矛盾；原確認及歷史仍保留。' };
  }
  if (incoming.domain === 'relationship') {
    const comparable = incoming.state === 'not-friends' && original.state === 'friends'
      || incoming.state === 'divorced' && original.state === 'married'
      || incoming.state === 'contact-ended' && ['friends', 'colleagues'].includes(original.state);
    if (!comparable) return null;
    return { kind: incoming.correction && !original.historical ? 'possible-contradiction' : 'important-change',
      reason: original.historical ? '新筆記記載同一主體的關係現況變化；這不否定原線索記載的歷史。'
        : incoming.correction ? '新筆記明確更正原關係說法，可能與原線索矛盾；尚未取代原確認。'
          : '新筆記明確記載同一主體的關係變化，可能影響後續互動；原確認仍保留。' };
  }
  // Another departure is not new information simply because its wording or
  // record ID changed. Employment changes cannot contradict a past transfer.
  if (['left', 'retired'].includes(original.state) && ['left', 'retired'].includes(incoming.state)) return null;
  if (incoming.state === 'moved' && ['working', 'moved'].includes(original.state)
    && (incoming.role && incoming.role === original.role && (!incoming.place || !original.place || incoming.place === original.place)
      || !incoming.role && incoming.place && incoming.place === original.place)) return null;
  return { kind: 'important-change', reason: original.historical
    ? '新筆記記載同一主體的任職現況變化；這不否定原線索記載的歷史。'
    : '新筆記明確記載同一主體的離職、調任或職務變化，可能影響後續互動；原確認仍保留。' };
}
export async function scanInsightChanges(bundle) {
  validateBundle(bundle);
  const context = insightEvidenceContext(bundle), bySubject = new Map(), factsByRevision = new Map(), stores = [];
  const revisionFacts = op => {
    if (!factsByRevision.has(op.id)) factsByRevision.set(op.id, insightScanFacts(op.data.text));
    return factsByRevision.get(op.id);
  };
  for (const visit of context.index.values()) {
    if (visit.type !== 'visit' || !safeInsightVisit(visit, context.index)) continue;
    const head = visit.heads[0];
    if (!insightInstant(head.at)) continue;
    for (const fact of insightScanFacts(visit.text, true)) {
      const key = JSON.stringify([fact.subjects, fact.domain]), list = bySubject.get(key) || [];
      list.push({ fact, visit, head }); bySubject.set(key, list);
    }
  }
  for (const store of context.index.values()) {
    if (store.type !== 'store' || !safeInsightStore(store) || !validStoreInsights(store.preVisitInsights)) continue;
    const changes = [];
    for (const entry of store.preVisitInsights.entries) {
      const review = sharedInsightReview(context, store.id, entry), local = currentInsightEvent(store, entry);
      if (review.status !== 'confirmed' || review.sharedConflict || !insightInstant(review.reviewedAt)) continue;
      const event = local || context.index.get('store:' + review.sharedFrom?.storeId)?.preVisitInsightReviews?.find(item => item.id === review.sharedFrom.eventId);
      if (!event || event.status !== 'confirmed' || (store.storeMergeStaleEntries || []).some(item => item.id === entry.id && item.key === insightEntryKey(entry))) continue;
      const resolved = entry.evidence.map(source => resolveInsightEvidenceForDisplay(source, context));
      // Source safety is not reclassified as a semantic contradiction. Keep the
      // strict sourceCurrent write gate independent from these display hints.
      if (resolved.some(source => !source.historicalAvailable || !safeInsightStore(context.index.get('store:' + source.storeId))
        || storeInsightsIdentityKey(context.index.get('store:' + source.storeId)) !== source.storeIdentityKey
        || !safeInsightVisit(context.index.get('visit:' + source.visitId), context.index)
        || context.index.get('visit:' + source.visitId).store !== source.storeId)) continue;
      const seen = new Set();
      for (const source of entry.evidence.filter(item => item.role === 'support')) for (const original of insightScanFacts(source.quote)) {
        // A quoted incidental person is insufficient: the card's actual claim
        // must name every compared subject. Questions/limitations are not claims.
        if (!original.subjects.every(subject => entry.headline.includes(subject))
          || !insightScanHeadlineSupports(entry.headline, original)) continue;
        const candidates = bySubject.get(JSON.stringify([original.subjects, original.domain])) || [];
        for (const candidate of candidates) {
          const { fact, visit, head } = candidate;
          if (head.at <= review.reviewedAt || !insightScanSameSubjects(original, source, candidate, context)) continue;
          // A newly imported old diary entry is not a newly occurring event.
          if (visit.date && visit.date < attendanceTaipeiDate(review.reviewedAt)
            && !(visit.id === source.visitId && /目前|現在|本次確認|經確認|更正/.test(fact.quote))) continue;
          if (entry.evidence.some(old => insightScanText(old.quote).includes(insightScanText(fact.quote)))) continue;
          if (visit.versions.some(op => insightInstant(op.at) && op.at <= review.reviewedAt
            && revisionFacts(op).some(old => old.signature === fact.signature))) continue;
          const comparison = insightScanComparison(original, fact);
          if (!comparison) continue;
          const semantic = JSON.stringify([visit.store, visit.id, fact.signature, comparison.kind]);
          if (seen.has(semantic)) continue;
          seen.add(semantic);
          const id = await hashBytes(enc.encode(JSON.stringify(['insight-change-1', bundle.vaultId, store.id,
            canonicalInsightEntry(entry), canonicalInsightReview(event), semantic, comparison.reason])));
          changes.push({ id, entryId: entry.id, ...comparison,
            originalEvidence: entry.evidence.map(old => ({ storeId: old.storeId, visitId: old.visitId, revisionId: old.revisionId, quote: old.quote })),
            newEvidence: { storeId: visit.store, visitId: visit.id, revisionId: head.id, quote: fact.quote } });
        }
      }
    }
    if (changes.length) stores.push({ storeId: store.id, changes: changes.sort((a, b) => a.id.localeCompare(b.id)) });
  }
  return { stores: stores.sort((a, b) => a.storeId.localeCompare(b.storeId)) };
}

// Explicitly downloaded private analysis source: current heads only, with a
// fixed field allowlist. Never include CSV, snapshots, blobs or full history.
export function buildStoreInsightsSource(bundle, at = new Date().toISOString()) {
  validateBundle(bundle);
  if (!insightInstant(at)) throw new Error('分析來源匯出時間不正確。');
  const index = insightRecordIndex(bundle), stores = [], visits = [];
  for (const record of index.values()) {
    if (record.type === 'store') {
      const current = resolveStoreInsights(index, record.id), validIds = new Set(current.entries.map(entry => entry.id));
      const availableInsights = current.entries.length ? { ...record.preVisitInsights, entries: record.preVisitInsights.entries.filter(entry => validIds.has(entry.id)) } : null;
      stores.push({ storeId: record.id, name: record.name, eligible: safeInsightStore(record), deleted: record.deleted, conflict: record.conflict,
        csvIdentityPending: record.csvIdentityPending === true, mergedInto: record.mergedInto ?? '', sourceMissing: record.sourceMissing === true, googleUpdatePending: record.googleUpdatePending === true,
        heads: record.heads.map(head => ({ id: head.id, deleted: head.deleted, data: JSON.parse(storeInsightsIdentityKey(head.data)) })),
        availableInsights: structuredClone(availableInsights), staleInsightCount: current.staleCount });
    } else if (record.type === 'visit') {
      visits.push({ visitId: record.id, eligible: safeInsightVisit(record, index), deleted: record.deleted, conflict: record.conflict,
        heads: record.heads.map(head => ({ id: head.id, deleted: head.deleted, data: { store: head.data.store, text: head.data.text, source: head.data.source, sourceMissing: head.data.sourceMissing === true, googleUpdatePending: head.data.googleUpdatePending === true } })) });
    }
  }
  return { format: 'pharmacy-store-insights-source-1', vaultId: bundle.vaultId, generatedAt: at, sourceAsOf: attendanceTaipeiDate(at), stores, visits,
    coverage: { stores: stores.length, visits: visits.length, eligibleStores: stores.filter(store => store.eligible).length, eligibleVisits: visits.filter(visit => visit.eligible).length,
      unlinkedVisits: visits.filter(visit => visit.heads.some(head => !index.has('store:' + head.data.store))).length } };
}
export function planStoreInsights(bundle, input) {
  validateBundle(bundle); validateStoreInsightsImport(input);
  if (bundle.vaultId !== input.vaultId) throw new Error('分析資料屬於另一個資料庫；尚未寫入任何資料。');
  const index = insightRecordIndex(bundle), ready = [], excluded = [], unchanged = [];
  for (const item of input.stores) {
    const store = index.get('store:' + item.storeId), reject = reason => excluded.push({ storeId: item.storeId, reason });
    if (!safeInsightStore(store)) { reject('門市不存在，或已刪除、衝突、身分待確認／已整併。'); continue; }
    if (!item.insights.entries.every(entry => resolveInsightEntry(entry, item.storeId, index))) { reject('至少一筆來源已更新、無法核實，或缺少本店直接證據；整間分析不套用。'); continue; }
    const before = store.heads[0].data.preVisitInsights ?? null;
    if (JSON.stringify(before) === JSON.stringify(item.insights)) { unchanged.push({ storeId: store.id, storeName: store.name }); continue; }
    if (store.heads[0].id !== item.expectedStoreHead) { reject('門市已產生新版本，請依最新資料重新核對。'); continue; }
    ready.push({ storeId: store.id, storeName: store.name, before: structuredClone(before), after: structuredClone(item.insights), expectedHead: store.heads[0].id });
  }
  return { ready, excluded, unchanged };
}
export function applyStoreInsights(bundle, input, expected, device) {
  const current = planStoreInsights(bundle, input);
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('分析預覽後資料已改變；請重新核對，尚未寫入任何資料。');
  if (!current.ready.length) return bundle;
  if (!insightId(device)) throw new Error('裝置識別不完整；尚未寫入任何資料。');
  const next = structuredClone(bundle), index = insightRecordIndex(bundle); next.schema = Math.max(2, next.schema);
  for (const item of current.ready) {
    const store = index.get('store:' + item.storeId);
    next.ops.push(revision('store', store.id, { ...store.heads[0].data, preVisitInsights: item.after }, [item.expectedHead], device));
  }
  return validateBundle(next);
}

// Explicit two-ID store merge. Plans are inert, reproducible descriptions; only
// the caller can persist the returned append-only bundle after final approval.
function mergeCanonical(value) {
  if (Array.isArray(value)) return value.map(mergeCanonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, mergeCanonical(value[key])]));
  return value;
}
const mergeJSON = value => JSON.stringify(mergeCanonical(value));
const mergeEqual = (a, b) => mergeJSON(a) === mergeJSON(b);
const mergeEmpty = value => value === undefined || value === null || value === '' || Array.isArray(value) && !value.length;
function validStoreMergeHistory(items) {
  return Array.isArray(items) && items.length <= 100 && items.every(item => insightKeys(item, ['id', 'keeperId', 'donorId', 'keeperHead', 'donorHead', 'keeperName', 'donorName', 'name', 'visitMoves', 'identityChanges'])
    && ['id', 'keeperId', 'donorId', 'keeperHead', 'donorHead'].every(key => insightId(item[key])) && item.keeperId !== item.donorId
    && ['keeperName', 'donorName', 'name'].every(key => insightText(item[key], 200))
    && Array.isArray(item.visitMoves) && item.visitMoves.length <= 5000 && item.visitMoves.every(move => insightKeys(move, ['id', 'fromRevision', 'toRevision']) && Object.values(move).every(insightId))
    && new Set(item.visitMoves.map(move => move.id)).size === item.visitMoves.length
    && Array.isArray(item.identityChanges) && item.identityChanges.length === 2 && item.identityChanges.every(change => insightKeys(change, ['id', 'before', 'after']) && insightId(change.id) && validInsightIdentityKey(change.before) && validInsightIdentityKey(change.after)))
    && new Set(items.map(item => item.id)).size === items.length;
}
function mergedInsightEntry(entry, record) {
  const next = structuredClone(entry);
  for (const evidence of next.evidence) {
    const identity = record.identityChanges.find(change => change.id === evidence.storeId && change.before === evidence.storeIdentityKey);
    if (identity) {
      evidence.storeIdentityKey = identity.after;
      if (evidence.storeId === record.donorId) evidence.storeId = record.keeperId;
    }
    const move = record.visitMoves.find(item => item.id === evidence.visitId && item.fromRevision === evidence.revisionId);
    if (move) evidence.revisionId = move.toRevision;
  }
  return next;
}
function validateStoreMergeProvenance(bundle, seen) {
  const records = new Map();
  for (const op of bundle.ops) for (const record of op.data.storeMergeHistory || []) {
    if (op.type !== 'store' || ![record.keeperId, record.donorId].includes(op.entity)) throw new Error('門市整併歷史歸屬不符。');
    if (records.has(record.id) && !mergeEqual(records.get(record.id), record)) throw new Error('門市整併歷史內容不一致。');
    records.set(record.id, record);
  }
  for (const record of records.values()) {
    const keeper = seen.get(record.keeperHead), donor = seen.get(record.donorHead), merged = seen.get(record.id);
    if (!keeper || !donor || !merged || keeper.type !== 'store' || donor.type !== 'store' || keeper.entity !== record.keeperId || donor.entity !== record.donorId
      || keeper.deleted || donor.deleted || merged.type !== 'store' || merged.entity !== record.keeperId || merged.deleted || !merged.parents.includes(record.keeperHead)
      || merged.data.name !== record.name || keeper.data.name !== record.keeperName || donor.data.name !== record.donorName
      || !merged.data.storeMergeHistory?.some(item => mergeEqual(item, record))) throw new Error('門市整併歷史缺少原始版本或保存結果。');
    const after = storeInsightsIdentityKey(merged.data);
    for (const original of [keeper, donor]) if (!record.identityChanges.some(change => change.id === original.entity && change.before === storeInsightsIdentityKey(original.data) && change.after === after)) throw new Error('門市整併身分來源不符。');
    if (!bundle.ops.some(op => op.type === 'store' && op.entity === record.donorId && op.deleted && op.parents.includes(record.donorHead) && op.data.mergedInto === record.keeperId && op.data.mergeDecision === record.id && op.data.storeMergeHistory?.some(item => mergeEqual(item, record)))) throw new Error('門市整併缺少封存版本。');
    for (const move of record.visitMoves) {
      const before = seen.get(move.fromRevision), moved = seen.get(move.toRevision);
      if (!before || !moved || before.type !== 'visit' || moved.type !== 'visit' || before.entity !== move.id || moved.entity !== move.id || before.deleted || moved.deleted
        || before.data.store !== record.donorId || moved.data.store !== record.keeperId || !moved.parents.includes(before.id) || Object.hasOwn(moved, 'visitAttendance')
        || !mergeEqual({ ...before.data, store: record.keeperId }, moved.data)) throw new Error('門市整併拜訪搬移來源不符。');
    }
  }
  for (const op of bundle.ops) for (const event of op.data.preVisitInsightReviews || []) {
    if (!event.carriedFrom) continue;
    const ref = event.carriedFrom, record = records.get(ref.mergeId), source = seen.get(ref.sourceRevision), previous = source?.data.preVisitInsightReviews?.find(item => item.id === ref.eventId);
    if (!record || !source || source.type !== 'store' || source.entity !== ref.storeId || !previous || previous.id === event.id
      || (ref.storeId === record.donorId ? op.entity !== record.keeperId : op.entity !== ref.storeId)
      || ['status', 'reviewedBy', 'reviewedAt', 'sourceAsOf'].some(key => previous[key] !== event[key])
      || !mergeEqual(mergedInsightEntry(previous.entry, record), event.entry)) throw new Error('沿用審核缺少完全相符的原始審核與同店整併證據。');
  }
}
async function storeMergeFingerprint(bundle) {
  return hashBytes(enc.encode(mergeJSON({ ...bundle, ops: [...bundle.ops].sort((a, b) => a.id.localeCompare(b.id)) })));
}
function mergeUniqueArrays(left, right, field) {
  const values = [...(left || []), ...(right || [])], seen = new Set(), out = [];
  for (const value of values) { const key = mergeJSON(value); if (!seen.has(key)) { seen.add(key); out.push(structuredClone(value)); } }
  if (field === 'nextRememberTasks') {
    const ids = new Set();
    for (const task of out) { if (ids.has(task.id)) throw new Error('兩間門市有相同任務 ID 但內容或完成狀態不同，請先核對。'); ids.add(task.id); }
  }
  return out;
}
/** Pure readonly preview, with no new timestamps, random IDs or persisted state. */
export async function planStoreMerge(bundle, request) {
  bundle = structuredClone(bundle); request = structuredClone(request);
  validateBundle(bundle);
  if (!plain(request) || Object.keys(request).sort().join(',') !== 'donorId,keeperId,name' || !insightId(request.keeperId) || !insightId(request.donorId) || request.keeperId === request.donorId || !insightText(request.name, 200) || request.name !== request.name.trim()) throw new Error('請指定兩筆不同門市 ID 與正式名稱。');
  const rawSize = enc.encode(JSON.stringify(bundle)).length;
  if (rawSize > MAX_BYTES) throw new Error('資料庫超過安全整併預覽大小上限。');
  const records = project(bundle).sort((a, b) => (a.type + ':' + a.id).localeCompare(b.type + ':' + b.id)), index = new Map(records.map(item => [item.type + ':' + item.id, item]));
  if (records.some(item => item.conflict)) throw new Error('資料庫有同步衝突，請先核對後再預覽門市整併。');
  const keeper = index.get('store:' + request.keeperId), donor = index.get('store:' + request.donorId);
  if (bundle.ops.some(op => (op.data.preVisitInsightRelations || []).some(relation => [request.keeperId, request.donorId].includes(op.entity)
    || relation.members.some(member => [request.keeperId, request.donorId].includes(member.storeId))))) throw new Error('門市保有人物關係對應或被其他店引用，須另行核對所有關係與審核歸屬；本次不自動整併。');
  if ([keeper, donor].some(store => store?.monthlyVisits?.length || store?.versions?.some(op => op.data.monthlyVisits?.length))) throw new Error('門市保有每月拜訪名單歷史，須另行核對各月份的歸屬；本次不自動搬移或整併。');
  if ([keeper, donor].some(store => store?.datePlans?.length || store?.datePlanOrder?.length || store?.versions?.some(op => op.data.datePlans?.length || op.data.datePlanOrder?.length))) throw new Error('門市保有行程與準備紀錄，須另行核對日期、備品與已帶上狀態的歸屬；本次不自動搬移或整併。');
  for (const store of [keeper, donor]) if (!safeInsightStore(store) || store.storeMergeHistory?.length) throw new Error('門市已刪除、待確認、已有整併歷史或來源未核對；本次不合併。');
  const selected = new Set([keeper.id, donor.id]);
  if (records.some(item => item.type === 'store' && (item.qualityDistinct || []).some(review => selected.has(item.id) || selected.has(review.store)))) throw new Error('相關門市保存了不同門市裁定，須先人工核對；不能用整併覆蓋。');
  const baseFingerprint = await storeMergeFingerprint(bundle);
  const mergeKey = await hashBytes(enc.encode(mergeJSON([baseFingerprint, request])));
  const newId = async (type, id) => 'sm-' + (await hashBytes(enc.encode(mergeKey + ':' + type + ':' + id))).slice(0, 60);
  const keeperRevision = await newId('store', keeper.id), donorRevision = await newId('store', donor.id);
  const data = structuredClone(keeper.heads[0].data);
  const specialized = new Set(['name', 'mapUrl', 'csvSources', 'csvAliases', 'lists', 'csvDecisionGroups', 'csvIdentityRules', 'enrichmentSources', 'nextRememberTasks', 'nextRememberImports', 'preVisitInsights', 'preVisitInsightReviews', 'storeMergeHistory', 'storeMergeStaleEntries']);
  for (const [field, value] of Object.entries(donor.heads[0].data)) {
    if (specialized.has(field) || mergeEmpty(value)) continue;
    if (mergeEmpty(data[field])) data[field] = structuredClone(value);
    else if (!mergeEqual(data[field], value)) throw new Error('兩間門市「' + field + '」內容不同，先核對才能整併；不會自動覆蓋或拼接。');
  }
  data.name = request.name;
  // The chosen primary map URL remains exact; alternate URLs remain in immutable
  // source/identity history. They are not silently substituted to bypass identity checks.
  for (const field of ['csvSources', 'lists', 'csvDecisionGroups', 'csvIdentityRules', 'enrichmentSources', 'nextRememberTasks', 'nextRememberImports']) {
    if (keeper[field] !== undefined || donor[field] !== undefined) data[field] = mergeUniqueArrays(keeper[field], donor[field], field);
  }
  data.csvAliases = mergeUniqueArrays([...(keeper.csvAliases || []), keeper.name], [...(donor.csvAliases || []), donor.name], 'csvAliases');
  const movedVisits = records.filter(item => item.type === 'visit' && !item.deleted && item.store === donor.id).sort((a, b) => a.id.localeCompare(b.id));
  const visitMoves = [];
  for (const visit of movedVisits) visitMoves.push({ id: visit.id, fromRevision: visit.heads[0].id, toRevision: await newId('visit', visit.id) });
  const record = { id: keeperRevision, keeperId: keeper.id, donorId: donor.id, keeperHead: keeper.heads[0].id, donorHead: donor.heads[0].id,
    keeperName: keeper.name, donorName: donor.name, name: request.name, visitMoves,
    identityChanges: [keeper, donor].map(store => ({ id: store.id, before: storeInsightsIdentityKey(store), after: storeInsightsIdentityKey(data) })) };
  data.storeMergeHistory = [record];
  const changes = [], outputData = new Map([[keeper.id, data]]), staleByStore = new Map();
  const cardSources = new Map(), externalIds = new Set();
  // Inventory all currently stored cards, including rejected cards. Only cards
  // resolving exactly before the merge can be rebound; old stale cards stay stale.
  for (const store of records.filter(item => item.type === 'store' && !item.deleted)) {
    const targetId = store.id === donor.id ? keeper.id : store.id;
    const target = outputData.get(targetId) || structuredClone(store.heads[0].data);
    const sourceProfile = store.preVisitInsights;
    if (!sourceProfile) continue;
    const applicable = selected.has(store.id) || sourceProfile.entries.some(entry => entry.evidence.some(source => selected.has(source.storeId)));
    if (!applicable) continue;
    if (!selected.has(store.id) && !safeInsightStore(store)) throw new Error('其他門市的相關分析目前待確認或來源失效，須先核對後再整併。');
    outputData.set(targetId, target);
    if (!selected.has(store.id)) externalIds.add(store.id);
    const entries = cardSources.get(targetId) || [];
    for (const entry of sourceProfile.entries) {
      const priorBlocked = (store.storeMergeStaleEntries || []).some(item => item.id === entry.id && item.key === insightEntryKey(entry));
      const wasValid = !priorBlocked && !!resolveInsightEntry(entry, store.id, index);
      const after = wasValid ? mergedInsightEntry(entry, record) : structuredClone(entry);
      if (entries.some(item => item.after.id === after.id)) throw new Error('兩間門市有相同分析卡 ID，先核對各自分析與審核，不能自動合併。');
      entries.push({ owner: store, before: entry, after, wasValid, profile: sourceProfile });
      if (!wasValid) { const list = staleByStore.get(targetId) || []; list.push({ id: after.id, key: insightEntryKey(after) }); staleByStore.set(targetId, list); }
    }
    cardSources.set(targetId, entries);
  }
  let carriedReviews = 0, reboundCards = 0, staleCards = 0;
  for (const [storeId, cards] of cardSources) {
    const target = outputData.get(storeId), first = cards[0];
    if (new Set(cards.map(card => card.owner.id)).size > 1 && cards.some(card => !mergeEqual([card.profile.batchId, card.profile.generatedAt, card.profile.sourceAsOf], [first.profile.batchId, first.profile.generatedAt, first.profile.sourceAsOf]))) throw new Error('兩間門市的分析來自不同批次或資料日期，須先核對逐卡來源；本次保留全部原分析、不合併。');
    const existingProfile = target.preVisitInsights?.entries.length ? target.preVisitInsights : first?.profile || target.preVisitInsights;
    if (existingProfile) target.preVisitInsights = { ...structuredClone(existingProfile), entries: cards.map(card => card.after) };
    if (staleByStore.has(storeId)) target.storeMergeStaleEntries = staleByStore.get(storeId);
    // Existing event objects are never changed or transplanted under another owner.
    // A continuity event has a new ID and explicit provenance, while its original
    // Kit status and timestamp remain exact. The original event remains in history.
    const reviews = [...(target.preVisitInsightReviews || [])];
    for (const card of cards) {
      if (!card.wasValid) { staleCards++; continue; }
      if (!mergeEqual(card.before, card.after) || card.owner.id !== storeId) reboundCards++;
      const previous = [...(card.owner.preVisitInsightReviews || [])].reverse().find(event => insightEntryKey(event.entry) === insightEntryKey(card.before));
      if (!previous || mergeEqual(card.before, card.after) && card.owner.id === storeId) continue;
      const event = { ...structuredClone(previous), id: await newId('review', card.owner.id + ':' + previous.id), entry: card.after,
        carriedFrom: { storeId: card.owner.id, sourceRevision: card.owner.heads[0].id, eventId: previous.id, mergeId: record.id } };
      reviews.push(event); carriedReviews++;
    }
    if (reviews.length) target.preVisitInsightReviews = reviews;
  }
  const donorData = { ...structuredClone(donor.heads[0].data), mergedInto: keeper.id, mergeDecision: record.id, storeMergeHistory: [record] };
  outputData.set(donor.id, donorData);
  for (const [id, after] of [...outputData].sort(([a], [b]) => a.localeCompare(b))) {
    const original = index.get('store:' + id);
    if (!validData('store', after)) throw new Error('整併後門市、提醒或分析資料超過格式／容量上限，原資料未改動。');
    if (mergeEqual(original.heads[0].data, after) && id !== donor.id) continue;
    changes.push({ type: 'store', id, beforeHead: original.heads[0].id, before: structuredClone(original.heads[0].data), after, deleted: id === donor.id,
      newRevisionId: id === keeper.id ? keeperRevision : id === donor.id ? donorRevision : await newId('store', id) });
  }
  for (const visit of movedVisits) changes.push({ type: 'visit', id: visit.id, beforeHead: visit.heads[0].id, before: structuredClone(visit.heads[0].data), after: { ...structuredClone(visit.heads[0].data), store: keeper.id }, deleted: false, newRevisionId: visitMoves.find(move => move.id === visit.id).toRevision });
  const plan = { format: 'pharmacy-store-merge-plan-1', vaultId: bundle.vaultId, baseFingerprint, keeperId: keeper.id, donorId: donor.id, name: request.name,
    keeper: { id: keeper.id, name: keeper.name, head: keeper.heads[0].id }, donor: { id: donor.id, name: donor.name, head: donor.heads[0].id },
    summary: { movedVisits: movedVisits.length, keeperVisits: records.filter(item => item.type === 'visit' && !item.deleted && item.store === keeper.id).length,
      deletedVisitsPreserved: records.filter(item => item.type === 'visit' && item.deleted && selected.has(item.store)).length,
      tasks: data.nextRememberTasks?.length || 0, completedTasks: data.nextRememberTasks?.filter(task => task.completedAt).length || 0,
      donorHistoricalCompletedTasks: reminderTaskHistory(donor).length, insightCards: data.preVisitInsights?.entries.length || 0, reboundCards, staleCards, carriedReviews,
      externalStores: [...externalIds].sort(), attendanceKeeper: bundle.ops.filter(op => op.visitAttendance?.store === keeper.id).length,
      attendanceDonor: bundle.ops.filter(op => op.visitAttendance?.store === donor.id).length, sourceSnapshots: records.filter(item => item.type === 'source').length,
      sourceRecords: data.csvSources?.length || 0, addedRevisions: changes.length }, changes,
    warnings: ['原始門市與拜訪歷史、CSV、Source Snapshot、附件全部保留；次門市封存於回收桶，不提供一鍵撤銷合併。',
      '實際拜訪確認仍保留原門市 ID，不搬移、不複製，也不新增今天的拜訪。',
      '來源已失效的分析維持失效；次門市歷史分析、原審核與歷史完成任務可由來源歷史查看。'] };
  if (enc.encode(JSON.stringify(plan)).length > 8 * 1024 * 1024) throw new Error('整併預覽超過 8 MB 上限，請先檢查來源資料；尚未寫入。');
  // Validate the exact planned graph, without using revision() or generating time.
  const check = structuredClone(bundle);
  for (const change of changes) check.ops.push({ id: change.newRevisionId, type: change.type, entity: change.id, data: structuredClone(change.after), parents: [change.beforeHead], device: 'merge-preview', deleted: change.deleted, at: '2000-01-01T00:00:00.000Z' });
  check.schema = Math.max(2, check.schema); validateBundle(check);
  if (enc.encode(JSON.stringify(check)).length > MAX_BYTES) throw new Error('整併後超過資料庫 24 MB 上限，原資料未改動。');
  return plan;
}
export async function applyStoreMerge(bundle, plan, device) {
  const original = bundle; bundle = structuredClone(bundle); plan = structuredClone(plan);
  if (!plain(plan) || plan.format !== 'pharmacy-store-merge-plan-1' || !insightId(device)) throw new Error('門市整併預覽或裝置識別不完整；尚未寫入。');
  const verified = await planStoreMerge(bundle, { keeperId: plan.keeperId, donorId: plan.donorId, name: plan.name });
  if (!mergeEqual(verified, plan) || !mergeEqual(original, bundle)) throw new Error('資料或整併預覽已改變，請重新核對；尚未寫入。');
  const next = structuredClone(bundle), at = new Date().toISOString();
  next.schema = Math.max(2, next.schema);
  for (const change of verified.changes) next.ops.push({ id: change.newRevisionId, type: change.type, entity: change.id, data: structuredClone(change.after), parents: [change.beforeHead], device, deleted: change.deleted, at });
  validateBundle(next);
  if (enc.encode(JSON.stringify(next)).length > MAX_BYTES) throw new Error('整併後資料超過 24 MB 上限，尚未寫入。');
  return { bundle: next, summary: structuredClone(verified.summary) };
}

// Source-backed organization assignments. These are never inferred visit links.
export async function planStoreSupervision(bundle, packet) {
  validateBundle(bundle);
  const p = structuredClone(packet), source = p?.sourceDocument;
  if (p?.format !== 'pharmacy-store-supervision-1' || !supervisionText(p.organization, 200) || !supervisionDate(p.effectiveDate) || !source || !validSupervisionDocument({blob:source.blob,name:source.name,mime:source.mime}) || typeof source.base64 !== 'string' || source.base64.length > 4200000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.base64) || !Array.isArray(p.people) || p.people.length > 100 || !Array.isArray(p.assignments) || p.assignments.length > 1500) throw new Error('小區督導資料包格式不符。');
  const bytes = unb64(source.base64);
  if (!bytes.length || await hashBytes(bytes) !== source.blob) throw new Error('來源圖 SHA256 不符。');
  const people = new Map();
  for (const person of p.people) {
    if (!supervisionText(person.key, 200) || !supervisionText(person.name, 200) || people.has(person.key)) throw new Error('督導身分識別重複或不完整。');
    people.set(person.key, person);
  }
  const records = project(bundle), stores = records.filter(r => r.type === 'store'), persons = records.filter(r => r.type === 'person');
  const rows = p.assignments.map((a, index) => {
    if (!people.has(a.personKey) || !supervisionText(a.storeName, 200) || !supervisionText(a.areaCode, 100) || !supervisionText(a.areaName, 200) || !str(a.storeCode, 100) || !supervisionText(a.sourceLabel, 500) || a.storeId !== undefined && !supervisionText(a.storeId,100)) throw new Error('門市對照欄位不完整。');
    const person = people.get(a.personKey), matches = stores.filter(s => a.storeId ? s.id === a.storeId : s.name === a.storeName);
    const row = {...a, rowKey:String(index), supervisorName:person.name, storeId:matches.length === 1 ? matches[0].id : '', status:'review', reason:'門市不存在或有同名多筆'};
    if (matches.length !== 1) return row;
    const s = matches[0];
    if (s.name !== a.storeName || s.deleted || s.conflict || s.csvIdentityPending || s.mergedInto) return {...row,reason:'門市狀態或身分需要核對'};
    if (!a.storeId && stores.some(other => other.id !== s.id && other.versions.some(v => v.data.name === a.storeName))) return {...row,reason:'歷史同名門市需要核對'};
    const known = persons.filter(r => r.versions.some(v => v.data.supervisorKey === person.key));
    if (known.length > 1 || known.some(r => r.deleted || r.conflict || r.sameAs || r.supervisorKey !== person.key || r.name !== person.name)) return {...row,reason:'既有督導身分、姓名或狀態需要核對'};
    if (!known.length && persons.some(r => r.versions.some(v => v.data.name === person.name))) return {...row,reason:'已有同名人物，不能自動合併或另建'};
    const after = {organization:p.organization,areaCode:a.areaCode,areaName:a.areaName,personId:known[0]?.id || '',storeCode:a.storeCode,sourceLabel:a.sourceLabel,sourceDocument:{blob:source.blob,name:source.name,mime:source.mime},effectiveDate:p.effectiveDate};
    const before = s.supervision || null, comparison = before ? {...before} : null; if (comparison) delete comparison.recordedAt;
    return {...row,status:known.length && JSON.stringify(comparison) === JSON.stringify(after) ? 'unchanged' : 'ready',reason:'',personId:known[0]?.id || '',before,after,change:before ? 'update':'add'};
  });
  for (const row of rows) if (row.storeId && rows.filter(r => r.storeId === row.storeId).length > 1) {row.status='review'; row.reason='來源多列對應同一門市';}
  const fingerprint = await hashBytes(enc.encode(JSON.stringify([bundle,p])));
  return {fingerprint, rows, summary:{ready:rows.filter(r=>r.status==='ready').length,unchanged:rows.filter(r=>r.status==='unchanged').length,review:rows.filter(r=>r.status==='review').length}};
}
export async function applyStoreSupervision(bundle, packet, plan, selectedStoreIds, device) {
  const current = await planStoreSupervision(bundle,packet);
  if (JSON.stringify(current) !== JSON.stringify(plan) || !Array.isArray(selectedStoreIds) || new Set(selectedStoreIds).size !== selectedStoreIds.length || !supervisionText(device,100)) throw new Error('資料或預覽已改變，請重新核對；尚未寫入。');
  const selected = selectedStoreIds.map(id=>current.rows.find(r=>r.storeId===id && r.status==='ready'));
  if (selected.some(r=>!r)) throw new Error('選取項目不在可套用清單內。');
  const next=structuredClone(bundle), people=new Map(), records=project(bundle);
  if (!selected.length) return {bundle:next,summary:{stores:0,people:0}};
  const source=packet.sourceDocument;
  if (next.blobs[source.blob] && next.blobs[source.blob] !== source.base64) throw new Error('來源圖識別衝突。');
  next.blobs[source.blob]=source.base64;
  for (const row of selected) {
    let personId=row.personId || people.get(row.personKey);
    if (!personId) {personId=uuid();people.set(row.personKey,personId);next.ops.push(revision('person',personId,{name:row.supervisorName,role:packet.organization+'小區督導',desc:'',confirmed:true,sameAs:'',supervisorKey:row.personKey},[],device));}
    const store=records.find(r=>r.type==='store' && r.id===row.storeId);
    next.ops.push(revision('store',store.id,{...store.heads[0].data,supervision:{...row.after,personId,recordedAt:new Date().toISOString()}},store.heads.map(h=>h.id),device));
  }
  validateBundle(next);
  if (enc.encode(JSON.stringify(next)).length>MAX_BYTES) throw new Error('資料超過24 MB上限；尚未寫入。');
  return {bundle:next,summary:{stores:selected.length,people:people.size}};
}
export function supervisedStores(records, personId) {
  const person=records.find(r=>r.type==='person' && r.id===personId);
  if (!person || person.deleted || person.conflict || person.sameAs) return [];
  return records.filter(r=>r.type==='store' && !r.deleted && !r.conflict && !r.csvIdentityPending && !r.mergedInto && r.supervision?.personId===personId);
}
