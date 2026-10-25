import { b64, unb64, hashBytes, uuid, revision, project, validateBundle, csvExclusionIdentity, MAX_BYTES } from './core.js';
const utf8 = new TextEncoder();
export const CSV_LIMIT = 2 * 1024 * 1024;
export const PROFILE_FIELDS = { name: '名稱', address: '地址', city: '縣市', district: '地區', channel: '通路', contact: '拜訪窗口', mapUrl: 'Google Maps 網址' };
export const FILL_FIELDS = Object.keys(PROFILE_FIELDS).filter(k => k !== 'name');
// Comparison keys only. Never write these normalized strings back into source data.
export const comparisonText = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replaceAll('臺', '台');
export function mapKey(value) {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'https:') return '';
    if (u.hostname === 'maps.app.goo.gl' && u.pathname.length > 2) return 'short:' + u.hostname + u.pathname;
    if (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps/')) return 'short:' + u.hostname + u.pathname;
    if (!['www.google.com', 'maps.google.com', 'www.google.com.tw', 'maps.google.com.tw'].includes(u.hostname)) return '';
    const place = u.searchParams.get('query_place_id') || (u.searchParams.get('q') || '').match(/^place_id:(.+)$/)?.[1];
    if (place) return 'place:' + place;
    const cid = u.searchParams.get('cid');
    if (cid && /^\d+$/.test(cid)) return 'cid:' + BigInt(cid).toString();
    const feature = decodeURIComponent(u.pathname + u.search).match(/!1s([^!&/?]+)/)?.[1];
    if (feature) return 'feature:' + feature;
  } catch { /* Invalid/unrecognized links are never identity evidence. */ }
  return '';
}
export function profileIssues(data) {
  const issues = [];
  if (!data.name?.trim()) issues.push({ field: 'name', kind: 'error', message: '缺少必要的門市名稱' });
  for (const field of FILL_FIELDS) if (!data[field]?.trim()) issues.push({ field, kind: 'missing', message: PROFILE_FIELDS[field] + '未提供（選填）' });
  const addressCity = comparisonText(data.address).replace(/^\d{3,6}/, '').match(/^(.{2,3}[縣市])/)?.[1];
  if (addressCity && data.city?.trim() && addressCity !== comparisonText(data.city)) issues.push({ field: 'city', kind: 'warning', message: '縣市與地址開頭不同，請核對原文' });
  if (data.mapUrl?.trim()) {
    try {
      const url = new URL(data.mapUrl.trim());
      if (url.protocol !== 'https:' || !['www.google.com', 'maps.google.com', 'www.google.com.tw', 'maps.google.com.tw', 'maps.app.goo.gl', 'goo.gl'].includes(url.hostname)) throw new Error();
      if (!mapKey(data.mapUrl)) issues.push({ field: 'mapUrl', kind: 'warning', message: '地圖連結未含可辨識的地點識別，不能單獨用來判定同一門市' });
    } catch { issues.push({ field: 'mapUrl', kind: 'warning', message: '地圖網址格式或網域待核對' }); }
  }
  for (const field of Object.keys(PROFILE_FIELDS)) if (/[\uFFFD\u200B\u200C\u200D\uFEFF]/u.test(data[field] || '')) issues.push({ field, kind: 'warning', message: PROFILE_FIELDS[field] + '含替代字元或不可見字元，請對照來源' });
  return issues;
}
function profileKeys(data) {
  return [['name', comparisonText(data.name)], ['address', comparisonText(data.address)], ['map', mapKey(data.mapUrl || '')]].filter(([, v]) => v).map(([k, v]) => k + ':' + v);
}
export function duplicateEvidence(a, b) {
  const reasons = [];
  const ak = mapKey(a.mapUrl || ''), bk = mapKey(b.mapUrl || '');
  if (ak && ak === bk) reasons.push('Google 地點識別／短連結相同');
  if (comparisonText(a.name) && comparisonText(a.name) === comparisonText(b.name)) reasons.push(a.name === b.name ? '門市名稱相同' : '名稱僅有空白、全半形或臺／台等格式差異');
  if (comparisonText(a.address) && comparisonText(a.address) === comparisonText(b.address)) reasons.push('地址比對相同');
  if (!reasons.length) return [];
  if (ak && bk && ak !== bk) reasons.push('地點識別不同，須核對是否為分店、搬遷或不同形式連結');
  if (a.address?.trim() && b.address?.trim() && comparisonText(a.address) !== comparisonText(b.address)) reasons.push('地址不同，不能僅依名稱認定重複');
  return reasons;
}
const profileSnapshot = s => JSON.stringify(['name', 'address', 'city', 'district', 'mapUrl'].map(k => s[k] || ''));
export function distinctReviewed(a, b) {
  return !a.conflict && !b.conflict && [ [a, b], [b, a] ].some(([self, other]) => (self.qualityDistinct || []).some(r => r.store === other.id && r.self === profileSnapshot(self) && r.other === profileSnapshot(other)));
}
export function scanQuality(records, limit = 200) {
  const stores = records.filter(r => r.type === 'store' && !r.deleted && !r.conflict);
  const items = stores.map(store => ({ store, issues: profileIssues(store) })).filter(x => x.issues.length);
  const pairs = [], reviewed = [], index = new Map(), seen = new Set(), reviewedIds = new Set();
  const byId = new Map(stores.map(store => [store.id, store]));
  // Keep saved decisions accessible even when the pending-pair display is full.
  for (const store of stores) for (const decision of store.qualityDistinct || []) {
    const other = byId.get(decision.store); if (!other || other.id === store.id) continue;
    const id = JSON.stringify([store.id, other.id].sort());
    if (!reviewedIds.has(id) && distinctReviewed(store, other) && duplicateEvidence(store, other).length) {
      reviewedIds.add(id); reviewed.push({ a: store, b: other, reasons: duplicateEvidence(store, other) });
    }
  }
  let limited = false;
  outer: for (const store of stores) {
    for (const key of profileKeys(store)) {
      const group = index.get(key) || [];
      for (const other of group) {
        const ids = [store.id, other.id].sort(), id = JSON.stringify(ids);
        if (seen.has(id)) continue;
        if (seen.size >= 100000) { limited = true; break outer; }
        seen.add(id);
        const pair = { a: other, b: store, reasons: duplicateEvidence(other, store) };
        if (reviewedIds.has(id)) continue;
        if (pairs.length >= limit) { limited = true; break outer; }
        else pairs.push(pair);
      }
      group.push(store); index.set(key, group);
    }
  }
  return { stores: stores.length, items, pairs, reviewed, limited, conflicts: records.filter(r => r.type === 'store' && r.conflict) };
}
export function setDistinctReview(bundle, leftId, rightId, device, forget = false) {
  const records = project(bundle), a = records.find(r => r.type === 'store' && r.id === leftId), b = records.find(r => r.type === 'store' && r.id === rightId);
  if (!a || !b || a.id === b.id || [a, b].some(s => s.deleted || s.conflict)) throw new Error('門市已變更、刪除或有同步衝突，請重新檢查。');
  if (!forget && !duplicateEvidence(a, b).length) throw new Error('目前已沒有這組疑似重複，請重新檢查。');
  const next = structuredClone(bundle);
  for (const [self, other] of [[a, b], [b, a]]) {
    const old = self.qualityDistinct || [], remaining = old.filter(r => r.store !== other.id);
    if (!forget && self.id < other.id) {
      if (remaining.length >= 200) throw new Error('此門市已達 200 組核對紀錄，請先檢查已確認清單。');
      remaining.push({ store: other.id, self: profileSnapshot(self), other: profileSnapshot(other) });
    }
    if (JSON.stringify(old) !== JSON.stringify(remaining)) next.ops.push(revision('store', self.id, { ...self.heads[0].data, qualityDistinct: remaining }, self.heads.map(h => h.id), device));
  }
  return validateBundle(next);
}
export function sourceSuggestions(store) {
  const values = new Map();
  for (const source of store.csvSources || []) {
    const mapping = guessMapping(source.headers);
    for (const field of FILL_FIELDS) {
      if (store[field]?.trim()) continue;
      const index = mapping[field === 'mapUrl' ? 'url' : field], raw = index >= 0 ? source.cells[index] : '';
      if (!raw?.trim()) continue;
      const value = raw.trim(), max = ['address', 'mapUrl'].includes(field) ? 2000 : 500;
      if (value.length > max) continue;
      const bucket = values.get(field) || new Map();
      bucket.set(value, { value, file: source.file, line: source.line });
      values.set(field, bucket);
    }
  }
  return Object.fromEntries([...values].map(([field, bucket]) => [field, [...bucket.values()]]));
}
export function fillProfile(bundle, id, additions, device, expectedParents) {
  const store = project(bundle).find(r => r.type === 'store' && r.id === id);
  if (!store || store.deleted || store.conflict || JSON.stringify(store.heads.map(h => h.id).sort()) !== JSON.stringify([...expectedParents].sort())) throw new Error('門市內容已變更，請重新開啟補登。');
  const data = structuredClone(store.heads[0].data); let changed = false;
  for (const [field, raw] of Object.entries(additions)) {
    if (!FILL_FIELDS.includes(field) || typeof raw !== 'string') throw new Error('補登欄位不正確。');
    const value = raw.trim(); if (!value) continue;
    if (data[field]?.trim()) throw new Error(PROFILE_FIELDS[field] + '已有資料，請重新檢查。');
    data[field] = value; changed = true;
  }
  if (!changed) throw new Error('請至少補上一個欄位；未知資料可以留空。');
  const next = structuredClone(bundle); next.ops.push(revision('store', id, data, store.heads.map(h => h.id), device));
  return validateBundle(next);
}
export const FIELD_NAMES = { name: '藥局／地點名稱（必要）', note: '備註原文', url: 'Google Maps 網址', address: '地址', city: '縣市', district: '地區', channel: '通路／屬性', contact: '拜訪窗口', date: '拜訪日期（不是匯出日期）' };
const aliases = { contact: ['contact', '拜訪窗口', '聯絡人', '窗口'], name: ['title', 'name', '名稱', '地點名稱', '藥局名稱', '門市名稱', '標題'], note: ['筆記', 'note', 'notes', 'comment', 'comments', '留言', '備註', '備註內容', '說明', 'description', '紀錄'], url: ['url', 'google maps url', '網址', '連結', '地圖網址'], address: ['address', '地址'], city: ['city', '縣市', '城市'], district: ['district', '地區', '行政區'], channel: ['channel', '通路', '門市屬性'], date: ['visit date', '拜訪日期'] };
export function decodeCSV(bytes, encoding = 'auto') {
  let codec = encoding;
  if (codec === 'auto') codec = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
  try { const text = new TextDecoder(codec, { fatal: true }).decode(bytes); if (text.includes('\0')) throw new Error(); return text; }
  catch { throw new Error('文字編碼無法讀取。請改選 Big5 或正確的 UTF-16 編碼，勿以亂碼繼續匯入。'); }
}
export function parseCSV(input, delimiter = 'auto') {
  let text = input.replace(/^\uFEFF/, ''), startLine = 1;
  const directive = text.match(/^sep=([,;\t])\r?\n/i);
  if (directive) { text = text.slice(directive[0].length); startLine++; if (delimiter === 'auto') delimiter = directive[1]; }
  if (delimiter === 'auto') {
    const counts = { ',': 0, ';': 0, '\t': 0 }; let quoted = false;
    for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; } else if (!quoted && (c === '\n' || c === '\r')) break; else if (!quoted && Object.hasOwn(counts, c)) counts[c]++; }
    delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }
  if (![',', ';', '\t'].includes(delimiter)) throw new Error('不支援的分隔符號。');
  const rows = []; let cells = [], field = '', quoted = false, closed = false, line = startLine, rowLine = line;
  function cell() { cells.push(field); field = ''; closed = false; }
  function row() { cell(); if (cells.some(c => c !== '')) rows.push({ cells, line: rowLine }); cells = []; rowLine = line + 1; }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else { field += c; if (c === '\n' || c === '\r' && text[i + 1] !== '\n') line++; } continue; }
    if (c === delimiter) cell();
    else if (c === '\r' || c === '\n') { row(); if (c === '\r' && text[i + 1] === '\n') i++; line++; rowLine = line; }
    else if (c === '"') { if (field || closed) throw new Error(`第 ${line} 行引號格式不正確。`); quoted = true; }
    else { if (closed) throw new Error(`第 ${line} 行結束引號後有多餘文字。`); field += c; }
  }
  if (quoted) throw new Error('CSV 有未關閉的引號；原檔未修改。');
  if (field || cells.length || closed) row();
  if (rows.length < 2) throw new Error('需要第一列欄位名稱，以及至少一列資料。');
  const headers = rows.shift().cells;
  if (headers.length > 100 || rows.length > 1500) throw new Error('每個 CSV 最多 100 欄、1,500 列，請先拆成較小檔案。');
  for (const r of rows) if (r.cells.length !== headers.length) throw new Error(`第 ${r.line} 行有 ${r.cells.length} 欄，標題有 ${headers.length} 欄。請先修正分隔符號或引號，避免錯位。`);
  return { headers, rows, delimiter };
}
export function guessMapping(headers) {
  const norm = h => h.trim().toLowerCase();
  return Object.fromEntries(Object.keys(FIELD_NAMES).map(k => {
    // Google exports distinguish the user's 筆記 from the separate 留言 field.
    const personalNotes = headers.map((h, i) => norm(h) === '筆記' ? i : -1).filter(i => i >= 0);
    if (k === 'note' && personalNotes.length === 1) return [k, personalNotes[0]];
    const matches = headers.map((h, i) => aliases[k].includes(norm(h)) ? i : -1).filter(i => i >= 0);
    return [k, matches.length === 1 ? matches[0] : -1];
  }));
}
export function originalDate(raw) {
  if (!raw.trim()) return '';
  const m = raw.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/); if (!m) return '';
  const [, y, month, day] = m, d = new Date(Date.UTC(+y, +month - 1, +day));
  return d.getUTCFullYear() === +y && d.getUTCMonth() === +month - 1 && d.getUTCDate() === +day ? `${y}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : '';
}
function specificMapURL(s) {
  try { const u = new URL(s.trim()); if (u.protocol !== 'https:') return ''; const h = u.hostname;
    const short = h === 'maps.app.goo.gl' && u.pathname.length > 2 || h === 'goo.gl' && u.pathname.startsWith('/maps/');
    const google = ['www.google.com', 'maps.google.com', 'www.google.com.tw', 'maps.google.com.tw'].includes(h);
    const specific = /!1s[^!]+/.test(u.pathname + u.search) || ['cid', 'query_place_id'].some(k => (u.searchParams.get(k) || '').length > 3) || /^place_id:.+/.test(u.searchParams.get('q') || '');
    return short || google && specific ? s.trim() : '';
  } catch { return ''; }
}
export function identity(data) {
  const key = mapKey(data.mapUrl || '');
  // Link formatting is not a store identity. Short links remain review evidence only.
  if (key && !key.startsWith('short:')) return `map:${key}`;
  return data.name.trim() && data.address?.trim() ? `address:${comparisonText(data.name)}\n${comparisonText(data.address)}` : '';
}
export function identityRuleAllows(store, incoming) {
  const key = mapKey(incoming.mapUrl || '');
  if (!key || key.startsWith('short:')) return false;
  const name = comparisonText(incoming.name), address = comparisonText(incoming.address);
  return (store.csvIdentityRules || []).some(rule => rule.decision === 'same' && rule.mapKey === key && rule.names.some(alias => comparisonText(alias) === name) && (!address || !rule.addresses.length || rule.addresses.some(value => comparisonText(value) === address)));
}
export const SOP1_VERSION = '1.2.19';
export const sourceListKey = list => normalizeListName(list).normalize('NFKC').trim().toLocaleLowerCase('zh-Hant');
export function sourceTextFields(file, raw) {
  const mapped = new Set(Object.values(file.mapping).filter(i => i >= 0));
  return file.headers.flatMap((header, column) => {
    const text = raw.cells[column];
    if (!text?.trim()) return [];
    const label = header.trim().toLowerCase();
    const kind = column === file.mapping.note ? 'note' : ['標籤', 'tags', 'label', 'labels'].includes(label) ? 'tag' : mapped.has(column) ? 'profile' : 'supplement';
    return [{ column, header, kind, text }];
  });
}
export function csvSourceSupplements(sources = []) {
  const seen = new Set(), result = [];
  for (const source of sources) {
    if (!source || !Array.isArray(source.supplements) || !Array.isArray(source.headers) || !Array.isArray(source.cells)) continue;
    for (const field of source.supplements) {
      const column = field?.column;
      if (!Number.isInteger(column) || column < 0 || column >= source.headers.length || typeof field.text !== 'string' || !field.text.trim() || field.header !== source.headers[column] || field.text !== source.cells[column]) continue;
      const key = JSON.stringify([source.blob, source.fingerprint, source.list, column, field.text]);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ column, header: field.header, text: field.text, file: source.file, line: source.line, list: source.list, blob: source.blob, fingerprint: source.fingerprint });
    }
  }
  return result;
}
const sameSourceRow = (source, row, file) => source.fingerprint === row.fingerprint && sourceListKey(source.list) === sourceListKey(file.list);
function supplementChoices(file, raw, row, sources = []) {
  const adopted = csvSourceSupplements(sources.filter(source => sameSourceRow(source, row, file)));
  return sourceTextFields(file, raw).filter(field => field.kind === 'supplement').map(({ column, header, text }) => ({ column, header, text,
    included: adopted.some(field => field.column === column && field.header === header && field.text === text) }));
}
export function csvSupplementChoices(plan, row, records = []) {
  const file = plan.files[row.fileIndex], raw = file?.rows[row.rowIndex];
  if (!file || !raw) return [];
  const target = csvTargetChoice(plan, row);
  // A duplicate row may be skipped while its already-adopted fields remain
  // visible. This hint only affects display; skipped rows cannot adopt fields.
  const storeId = target.startsWith('store:') ? target.slice(6) : target === 'skip' ? row.matchedStoreId : null;
  const store = storeId ? records.find(record => record.type === 'store' && record.id === storeId && !record.deleted && !record.conflict && (target !== 'skip' || identity(row.data) && identity(row.data) === identity(record))) : null;
  return supplementChoices(file, raw, row, store?.csvSources || []);
}
function supplementSelection(plan, row, records) {
  const choices = csvSupplementChoices(plan, row, records), columns = row.supplementColumns === undefined ? [] : row.supplementColumns;
  if (!Array.isArray(columns) || columns.length > 100 || new Set(columns).size !== columns.length || columns.some(column => !Number.isInteger(column) || !choices.some(field => field.column === column))) throw new Error('補充欄位選擇不正確，請重新核對原始欄位');
  if (columns.length && (row.choice === 'skip' || row.reviewExcluded)) throw new Error('已略過或裁定排除的列不能補選欄位');
  return choices.filter(field => columns.includes(field.column) && !field.included);
}
function supplementalOnly(plan, row, store) {
  const file = plan.files[row.fileIndex];
  // Once a known source row offers field selection, clearing the last checkbox
  // must not turn the same preview into a reapplication of historical notes.
  return !!store && (store.csvSources || []).some(source => sameSourceRow(source, row, file)) &&
    (csvSupplementChoices(plan, row, [store]).length > 0 || profileChanges({ ...row, choice: 'store:' + store.id }, [store]).some(change => change.fillable));
}
function listMetadata(file, raw) {
  const fields = sourceTextFields(file, raw);
  return fields.length > 0 && fields.every(f => f.kind === 'tag');
}
export function displayText(text) {
  // Presentation-only. Source text and sentence order stay intact.
  return String(text || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[\t ]+$/g, '')).join('\n').trim();
}
function profileContradictions(a, b) {
  const messages = [];
  if (a.name?.trim() && b.name?.trim() && comparisonText(a.name) !== comparisonText(b.name)) messages.push('相同地點識別但門市名稱不同，須核對改名或錯連');
  if (a.address?.trim() && b.address?.trim() && comparisonText(a.address) !== comparisonText(b.address)) messages.push('相同地點識別但地址不同，須核對搬遷或分店');
  return messages;
}
function prepareSOP1(plan, records) {
  const stores = new Map(records.filter(r => r.type === 'store').map(r => [r.id, r]));
  const rows = new Map(plan.rows.map(r => [r.key, r]));
  for (const row of plan.rows) {
    const file = plan.files[row.fileIndex], raw = file.rows[row.rowIndex];
    row.textFields = sourceTextFields(file, raw);
    row.cleanedNote = displayText(row.note);
    row.sop1 = { version: SOP1_VERSION, metadata: listMetadata(file, raw), extraAccepted: false, manualAccepted: false };
    if (row.sop1.metadata) { row.choice = 'skip'; row.reason = '清單層級標籤：原檔保留，不建立門市或拜訪'; continue; }
    if (row.errors.length) { row.choice = 'review'; continue; }
    if (row.choice === 'skip') continue;
    const other = row.choice.startsWith('store:') ? stores.get(row.choice.slice(6)) : row.choice.startsWith('row:') ? rows.get(row.choice.slice(4))?.data : null;
    const contradictions = other && !identityRuleAllows(other, row.data) ? profileContradictions(row.data, other) : [];
    // Name-only classification is a review aid, not a deletion or customer judgment.
    const scopeQuestion = !/藥|醫|診所|健康|保健/.test(row.data.name) && /咖啡|餐廳|餐館|飯店|旅館|酒店|民宿|公園|機場|牛排|麵店|早午餐|烤肉|餐酒|牛肉麵|車站|咖哩|拉麵/.test(row.data.name);
    const weakIdentity = !identity(row.data);
    if (contradictions.length || scopeQuestion || weakIdentity) {
      row.choice = 'review';
      row.reason = [...contradictions, ...(scopeQuestion ? ['名稱可能是非藥局地點，請確認是否納入此 App'] : []), ...(weakIdentity ? ['沒有穩定地點ID或名稱＋地址，請指定門市或明確確認新增'] : [])].join('；');
    }
  }
  plan.sop1Version = SOP1_VERSION;
  return plan;
}
export function sop1Report(plan, bundle) {
  if (plan.mode === 'new-only' || newStorePlans.has(plan)) return newStoreOnlyReport(plan, bundle);
  const records = project(bundle), byStore = new Map(records.filter(r => r.type === 'store').map(r => [r.id, r]));
  const byRow = new Map(plan.rows.map(r => [r.key, r])), blockers = [], summaries = [], streams = new Map(), mergeTargets = mergeTargetMap(plan);
  const effectiveVisitStream = visit => {
    const keeper = mergeTargets.get(visit.store);
    return keeper ? remappedVisitStream(visit, visit.store, keeper) : visitStream(visit);
  };
  function target(row, chain = new Set()) {
    if (chain.has(row.key)) return '';
    chain.add(row.key);
    if (row.choice === 'new') return 'new:' + row.key;
    if (row.choice.startsWith('store:')) {
      const store = byStore.get(row.choice.slice(6));
      return store && !store.deleted && !store.conflict ? row.choice : '';
    }
    if (row.choice.startsWith('row:')) {
      const other = byRow.get(row.choice.slice(4));
      return other && other.choice !== 'skip' && !other.errors.length ? target(other, chain) : '';
    }
    return '';
  }
  const fail = (row, message) => blockers.push({ key: row.key, file: plan.files[row.fileIndex].file, line: row.line, message });
  for (const row of plan.rows) {
    try { supplementSelection(plan, row, records); }
    catch (error) { fail(row, error.message); }
    if (row.reviewExcluded && row.choice !== 'skip') fail(row, '此列已裁定排除，須重新核對資料包才可納入');
    if (row.choice === 'skip') { summaries.push({ key: row.key, kind: row.sop1?.metadata ? 'metadata' : 'skipped' }); continue; }
    if (row.choice === 'review') { fail(row, row.reason || '門市尚未核對'); continue; }
    if (row.errors.length) { fail(row, row.errors.join('；')); continue; }
    const resolved = target(row);
    if (!resolved) { fail(row, '門市連結尚未完成、被略過、已刪除或有衝突'); continue; }
    const selectedStore = resolved.startsWith('store:') ? byStore.get(resolved.slice(6)) : null;
    const mergedSource = [...byStore.values()].some(store => store.storeMergeHistory?.length &&
      (store === selectedStore || identity(row.data) && identity(row.data) === identity(store) ||
        [store.name, ...(store.csvAliases || [])].some(name => comparisonText(name) === comparisonText(row.data.name))));
    if (mergedSource) { fail(row, '此來源涉及已合併門市，須另行核對原筆記串流；本批不會自動新建、覆蓋或還原'); continue; }
    const file = plan.files[row.fileIndex];
    if (csvSupplementChoices(plan, row, records).some(field => !field.included) && !row.sop1?.extraAccepted) fail(row, '尚有其他非空白文字欄，須核對勾選結果；未勾選只保留原始來源');
    const fieldsOnly = supplementalOnly(plan, row, selectedStore);
    const stream = resolved + ':' + sourceListKey(file.list), bucket = streams.get(stream) || [];
    if (!fieldsOnly) bucket.push(row);
    streams.set(stream, bucket);
    const existing = resolved.startsWith('store:') ? records.filter(v => v.type === 'visit' && !v.deleted && effectiveVisitStream(v) === csvStream(resolved.slice(6), file.list)) : [];
    if (existing.length > 1 || existing.some(v => v.conflict)) fail(row, '同一來源有多筆備註或同步衝突，請先在 App 核對');
    const old = existing[0];
    let kind = !row.note?.trim() ? 'no-note' : old ? (old.googleText ?? old.text) === row.note && (!row.date || row.date === old.date) ? 'unchanged' : 'new-version' : 'new-note';
    if (old && row.noteProvided && !row.note) kind = 'retain-missing';
    const manual = !fieldsOnly && old && row.note && old.text !== row.note && (old.googleText === undefined || old.text !== old.googleText) && row.note !== old.googleText;
    if (manual && !row.sop1?.manualAccepted) fail(row, 'App 手動修改與新來源文字不同，須先確認保留 App 文字及保存來源新版');
    summaries.push({ key: row.key, target: resolved, kind: fieldsOnly ? 'supplement-only' : kind, manual: !!manual });
  }
  for (const group of streams.values()) {
    const notes = new Set(group.filter(r => r.noteProvided).map(r => JSON.stringify([r.note, r.date])));
    if (notes.size > 1) for (const row of group) fail(row, '同一門市、同一來源清單在本批有不同備註或日期，不能以檔案順序決定新版');
  }
  // Reviewed groups are user decisions, not another automatic identity heuristic.
  const assigned = new Map();
  for (const group of plan.reviewGroups || []) {
    const members = group.rows.map(key => byRow.get(key)), active = members.filter(r => r.choice !== 'skip');
    if (group.merge) {
      const candidates = group.candidates.map(id => byStore.get(id)).filter(Boolean), verified = reviewedMergePlan(group, candidates, records);
      const samePlan = verified && !verified.blocked && verified.keeper === group.merge.keeper && JSON.stringify(verified.merged.map(s => s.id).sort()) === JSON.stringify(group.merge.merged.map(s => s.id).sort());
      if (!samePlan || group.choice !== 'store:' + group.merge.keeper) {
        for (const row of active) fail(row, '已裁定既有門市整併計畫已失效，請重新產生預覽');
        continue;
      }
    }
    if (!active.length) continue;
    const targets = new Set(active.map(r => target(r)).filter(Boolean));
    if (active.length !== members.length || targets.size !== 1) { for (const row of active) fail(row, '已裁定的同組來源須一起指定，不能只移動或略過其中一列'); continue; }
    const resolved = [...targets][0], prior = assigned.get(resolved);
    if (prior && prior.id !== group.id) {
      for (const key of [...prior.rows, ...group.rows]) fail(byRow.get(key), '兩個已裁定分開的組指向同一現有門市，請先核對，不能自動合併或搬移舊備註');
    } else assigned.set(resolved, group);
  }
  if (plan.vaultId !== bundle.vaultId || plan.baseRevision !== bundleRevision(bundle)) blockers.push({ key: '', message: 'App 資料已變更，請重新預覽' });
  return { version: SOP1_VERSION, ready: !blockers.length, blockers, rows: summaries, counts: Object.fromEntries([...new Set(summaries.map(s => s.kind))].map(kind => [kind, summaries.filter(s => s.kind === kind).length])) };
}
export function normalizeListName(name = '') {
  let value = name.trim().replace(/\.csv$/i, '').trim();
  while (/\s*\(\d+\)$/.test(value)) value = value.replace(/\s*\(\d+\)$/, '').trim();
  return value;
}
export function csvStream(storeId, list) { return `google-csv:${storeId}:${normalizeListName(list).toLocaleLowerCase('zh-Hant')}`; }
function visitStream(record) {
  if (record.type !== 'visit') return '';
  if (record.csvStream) return record.csvStream;
  const source = [...(record.csvSources || [])].reverse().find(s => s?.list);
  return source && record.store ? csvStream(record.store, source.list) : '';
}
export async function prepareCSV(file, bytes, encoding = 'auto', delimiter = 'auto') {
  if (bytes.length > CSV_LIMIT) throw new Error('單一 CSV 上限 2 MB；請拆分檔案。');
  const parsed = parseCSV(decodeCSV(bytes, encoding), delimiter), blob = await hashBytes(bytes);
  if (parsed.headers.some(h => h.length > 20000)) throw new Error('CSV 欄位名稱超過長度上限，請先核對第一列。');
  const warnings = [], names = new Map();
  parsed.headers.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    if (!key) warnings.push('第 ' + (i + 1) + ' 欄沒有欄位名稱，請核對對應');
    if (names.has(key)) warnings.push('第 ' + (i + 1) + ' 欄與第 ' + (names.get(key) + 1) + ' 欄同名，請以欄位位置和原文核對');
    else names.set(key, i);
  });
  for (const [field, options] of Object.entries(aliases)) if (parsed.headers.filter(h => options.includes(h.trim().toLowerCase())).length > 1) warnings.push(FIELD_NAMES[field] + (field === 'note' && parsed.headers.filter(h => h.trim() === '筆記').length === 1 ? '依 Google 格式優先對應「筆記」，請核對其他備註欄位' : '有多個可能欄位，請自行指定'));
  return { file, bytes, blob, ...parsed, warnings, mapping: guessMapping(parsed.headers), list: normalizeListName(file), encoding, channel: '' };
}
function validateMapping(file) {
  const used = new Set();
  for (const field of Object.keys(FIELD_NAMES)) {
    const index = file.mapping[field] ?? -1;
    if (!Number.isInteger(index) || index < -1 || index >= file.headers.length) throw new Error(file.file + '：欄位對應超出範圍，請重新指定。');
    if (index >= 0 && used.has(index)) throw new Error(file.file + '：同一個 CSV 欄位不可重複對應，請核對第 ' + (index + 1) + ' 欄。');
    if (index >= 0) used.add(index);
  }
  if (!Number.isInteger(file.mapping.name) || file.mapping.name < 0) throw new Error(file.file + '：請指定藥局名稱欄位。');
  if (!file.list?.trim() || file.list.length > 200) throw new Error(file.file + '：請填寫 1–200 字的來源清單名稱，以便追蹤備註版本。');
}
const bundleRevision = bundle => bundle.ops.map(o => o.id).sort().join(',');
// Source snapshots held outside the editable UI plan are the authority for the
// new-only writer. Changing a mapping/source requires a fresh preview.
const newStorePlans = new WeakMap();
const exclusionKey = identity => JSON.stringify([identity.mapKey, identity.name, identity.address]);
function exclusionState(bundle) {
  validateBundle(bundle);
  const events = new Map(), revocations = new Map(), revoked = new Set();
  for (const source of bundle.ops.filter(op => op.type === 'source')) for (const event of source.data.csvExclusionEvents || []) events.set(event.id, { event, source });
  for (const { event } of events.values()) if (event.action === 'revoke') {
    const target = events.get(event.target).event, key = exclusionKey(target.identity), list = revocations.get(key) || [];
    list.push(event.id); revocations.set(key, list); revoked.add(event.target);
  }
  const groups = new Map();
  for (const { event, source } of events.values()) if (event.action === 'exclude') {
    const key = exclusionKey(event.identity);
    // A concurrent/stale exclusion cannot undo a revoke. Re-exclusion must be
    // explicit and must have observed every revoke of this exact identity.
    if (revoked.has(event.id) || (revocations.get(key) || []).some(id => !event.seenRevocations.includes(id))) continue;
    const group = groups.get(key) || []; group.push({ event, source }); groups.set(key, group);
  }
  const list = [...groups.values()].map(group => {
    group.sort((a, b) => a.event.id.localeCompare(b.event.id));
    const { event, source } = group[0];
    return { id: event.id, eventIds: group.map(item => item.event.id), identity: structuredClone(event.identity), ...event.profile,
      file: source.data.file, line: event.line, at: source.at, sourceSnapshot: source.entity };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { events, revocations, list };
}
export function csvExclusionList(bundle) { return exclusionState(bundle).list; }
const newRowSignature = row => JSON.stringify([row.key, row.fileIndex, row.rowIndex, row.line, row.data, row.note, row.noteProvided, row.date, row.fingerprint]);
const newFileSignature = file => JSON.stringify([file.file, file.list, file.blob, file.headers, file.rows, file.mapping, file.channel, file.encoding, file.delimiter]);
function newOnlyRawRow(file, raw, fileIndex, rowIndex, fingerprint) {
  const get = field => file.mapping[field] >= 0 ? raw.cells[file.mapping[field]] ?? '' : '';
  const data = { name: get('name'), address: get('address'), mapUrl: get('url'), city: get('city'), district: get('district'), channel: get('channel') || file.channel, attr: '', contact: get('contact') };
  const note = get('note'), rawDate = get('date'), date = originalDate(rawDate), errors = [], issues = profileIssues(data);
  if (!data.name.trim()) errors.push('缺少地點名稱');
  for (const [field, label] of Object.entries(PROFILE_FIELDS)) {
    const max = field === 'name' ? 200 : ['address', 'mapUrl'].includes(field) ? 2000 : 500;
    if ((data[field] || '').length > max) errors.push(label + '超過長度上限，不會截斷原文');
  }
  if (note.length > 20000) errors.push('備註超過20,000字上限，不會截斷原文');
  const warnings = issues.filter(issue => issue.kind === 'warning').map(issue => issue.message);
  if (rawDate && !date) warnings.push('日期格式不明，須先核對');
  return { key: `${fileIndex}:${rowIndex}`, fileIndex, rowIndex, line: raw.line, data, note, noteProvided: file.mapping.note >= 0, date, fingerprint,
    errors, warnings, issues, textFields: sourceTextFields(file, raw), cleanedNote: displayText(note), candidates: [], fillFields: [], supplementColumns: [], choice: 'skip',
    sop1: { version: SOP1_VERSION, metadata: listMetadata(file, raw), extraAccepted: false, manualAccepted: false } };
}
function newOnlyHistory(bundle, records) {
  const keys = new Map(), fingerprints = new Map(), seenSources = new Set();
  const add = (index, key, id) => { if (!key || !id) return; let bucket = index.get(key); if (!bucket) index.set(key, bucket = new Set()); bucket.add(id); };
  const addData = (data, id) => {
    for (const key of profileKeys(data)) add(keys, key, id);
    for (const name of data.csvAliases || []) add(keys, 'name:' + comparisonText(name), id);
    for (const rule of data.csvIdentityRules || []) {
      for (const name of rule.names || []) add(keys, 'name:' + comparisonText(name), id);
      for (const address of rule.addresses || []) add(keys, 'address:' + comparisonText(address), id);
      if (rule.mapKey) add(keys, 'map:' + rule.mapKey, id);
    }
  };
  for (const op of bundle.ops) {
    const id = op.type === 'store' ? op.entity : op.type === 'visit' ? op.data.store : null;
    if (!id) continue;
    if (op.type === 'store') addData(op.data, id);
    for (const source of op.data.csvSources || []) {
      const sourceKey = JSON.stringify([id, source.blob, source.fingerprint, source.list]);
      if (seenSources.has(sourceKey)) continue;
      seenSources.add(sourceKey); add(fingerprints, source.fingerprint, id);
      const mapping = guessMapping(source.headers), read = field => mapping[field] >= 0 ? source.cells[mapping[field]] || '' : '';
      addData({ name: read('name'), address: read('address'), mapUrl: read('url') }, id);
    }
  }
  return { keys, fingerprints, stores: new Map(records.filter(record => record.type === 'store').map(store => [store.id, store])) };
}
function newOnlySameCurrent(data, store) {
  if (!store || store.deleted || store.conflict || store.mergedInto || store.storeMergeHistory?.length || store.csvIdentityPending) return false;
  if (comparisonText(data.name) !== comparisonText(store.name)) return false;
  const map = mapKey(data.mapUrl), otherMap = mapKey(store.mapUrl);
  if (map && otherMap && map !== otherMap) return false;
  if (data.address?.trim() && store.address?.trim() && comparisonText(data.address) !== comparisonText(store.address)) return false;
  return !!(map && !map.startsWith('short:') && map === otherMap || data.address?.trim() && store.address?.trim() && comparisonText(data.address) === comparisonText(store.address));
}
function classifyNewOnly(files, rows, bundle) {
  const history = newOnlyHistory(bundle, project(bundle)), batchKeys = new Map(), duplicateKeys = new Map();
  const add = (index, key, rowIndex) => { if (!key) return; let group = index.get(key); if (!group) index.set(key, group = []); group.push(rowIndex); };
  const signatures = rows.map(row => JSON.stringify([files[row.fileIndex].headers, files[row.fileIndex].rows[row.rowIndex].cells, row.data, row.noteProvided, row.date]));
  // Keep this signal independently of same-batch classification: an explicit
  // exclusion must never hide a later existing-record conflict/history match.
  const historyCandidates = rows.map(row => [...new Set([...(history.fingerprints.get(row.fingerprint) || []), ...profileKeys(row.data).flatMap(key => [...(history.keys.get(key) || [])])])]);
  const result = rows.map((row, index) => {
    for (const key of profileKeys(row.data)) add(batchKeys, key, index);
    add(duplicateKeys, signatures[index], index);
    if (row.sop1.metadata) return { status: 'excluded', reason: '清單標籤行只保留原始來源，不建立門市' };
    if (row.errors.length) return { status: 'review', reason: row.errors.join('；') };
    const matched = historyCandidates[index];
    if (matched.length === 1 && newOnlySameCurrent(row.data, history.stores.get(matched[0]))) return { status: 'existing', reason: '已匹配現有門市；本模式保留全部既有內容並略過', matchedStoreId: matched[0] };
    if (matched.length) return { status: 'review', reason: '命中既有／歷史名稱、來源、身分裁定或非有效門市，需另外核對；本次不新增', candidateStoreIds: matched };
    if (!identity(row.data)) return { status: 'review', reason: '缺少穩定地點識別或名稱加地址，無法判定新店候選' };
    if (row.warnings.length) return { status: 'review', reason: row.warnings.join('；') };
    if (!/藥|醫|診所|健康|保健/.test(row.data.name) && /咖啡|餐廳|餐館|飯店|旅館|酒店|民宿|公園|機場|牛排|麵店|早午餐|烤肉|餐酒|牛肉麵|車站|咖哩|拉麵/.test(row.data.name)) return { status: 'review', reason: '名稱可能不在本次門市範圍，需另外核對' };
    return { status: 'new', reason: '未命中可辨識既有資料的新店候選；請勾選需要新增者' };
  });
  // Look at the whole batch before offering any new row: first-row-wins would
  // silently resolve conflicting same-store evidence.
  for (const group of batchKeys.values()) {
    if (group.length < 2 || new Set(group.map(index => signatures[index])).size < 2) continue;
    for (const index of group) if (result[index].status !== 'excluded') result[index] = { status: 'review', reason: '同批有相同名稱、地址或地點識別但原始列不同，須另外核對；本次不新增' };
  }
  for (const group of duplicateKeys.values()) {
    if (group.length < 2 || group.some(index => result[index].status !== 'new')) continue;
    for (const index of group.slice(1)) result[index] = { status: 'duplicate', reason: '同批完全相同原始列僅列一個新店候選；只建立所選列的清單關聯，其餘完整原檔保留於來源快照', duplicateOf: rows[group[0]].key };
  }
  const exclusions = csvExclusionList(bundle);
  for (const [index, row] of rows.entries()) {
    const identity = csvExclusionIdentity(row.data), current = result[index];
    // Memory never turns an uncertain identity into permission to create a
    // store, and it never changes an existing store's import classification.
    if (!historyCandidates[index].length && !['existing', 'excluded'].includes(current.status)) {
      const related = exclusions.filter(item => item.identity.mapKey === mapKey(row.data.mapUrl || '') ||
        item.identity.name === comparisonText(row.data.name) || item.identity.address && item.identity.address === comparisonText(row.data.address));
      if (related.length) {
        const exact = identity ? related.filter(item => exclusionKey(item.identity) === exclusionKey(identity)) : [];
        result[index] = exact.length
          ? { status: 'remembered', reason: '已明確記住不匯入此地點；原始來源仍保留，可在排除清單撤銷', exclusionIds: exact.map(item => item.id) }
          : { status: 'review', reason: '已記住排除的地點出現名稱、地址或地點識別變化，須重新核對；不會自動隱藏或新增', exclusionIdentityChanged: true };
      }
    }
    result[index].canExclude = !historyCandidates[index].length && !!identity && ['new', 'review', 'duplicate'].includes(result[index].status);
  }
  return result;
}
async function planNewStoresOnly(files, bundle) {
  if (!Array.isArray(files) || !files.length || files.length > 10) throw new Error('每批需1至10個CSV。');
  const sources = structuredClone(files), rows = [];
  let totalBytes = 0;
  for (const [fileIndex, file] of sources.entries()) {
    if (!(file.bytes instanceof Uint8Array) || file.bytes.length > CSV_LIMIT || (totalBytes += file.bytes.length) > 5 * 1024 * 1024 || await hashBytes(file.bytes) !== file.blob) throw new Error('CSV原始bytes或雜湊不符，請重新選檔');
    const parsed = parseCSV(decodeCSV(file.bytes, file.encoding || 'auto'), file.delimiter || 'auto');
    if (JSON.stringify([parsed.headers, parsed.rows]) !== JSON.stringify([file.headers, file.rows])) throw new Error('CSV原始內容與解析列不符，請重新選檔');
    validateMapping(file);
    for (const [rowIndex, raw] of file.rows.entries()) {
      const fingerprint = await hashBytes(utf8.encode(JSON.stringify([file.headers, raw.cells])));
      rows.push(newOnlyRawRow(file, raw, fileIndex, rowIndex, fingerprint));
    }
  }
  if (rows.length > 1500) throw new Error('每批最多1,500列，請分批匯入。');
  const classifications = classifyNewOnly(sources, rows, bundle);
  const plan = { files: structuredClone(sources), rows: structuredClone(rows), baseRevision: bundleRevision(bundle), vaultId: bundle.vaultId, sop1Version: SOP1_VERSION, mode: 'new-only', exclusions: csvExclusionList(bundle), revokeExclusionIds: [] };
  for (const [index, row] of plan.rows.entries()) { row.newStoreOnly = classifications[index]; row.reason = classifications[index].reason; }
  newStorePlans.set(plan, { files: sources, rows, rowSignatures: rows.map(newRowSignature), fileSignatures: sources.map(newFileSignature) });
  return plan;
}
function newStoreOnlyReport(plan, bundle) {
  const proof = newStorePlans.get(plan), blockers = [], summaries = [];
  const fail = (row, message) => blockers.push({ key: row?.key || '', file: row && proof?.files[row.fileIndex]?.file, line: row?.line, message });
  if (!proof || plan.mode !== 'new-only') fail(null, '只新增新門市的預覽已失效，請重新預覽');
  if (plan.vaultId !== bundle.vaultId || plan.baseRevision !== bundleRevision(bundle)) fail(null, 'App資料已變更，請重新預覽');
  if (plan.reviewPackageId !== undefined || plan.reviewGroups !== undefined) fail(null, '只新增新門市模式不接受已核對資料包或整併裁定');
  if (!proof) return { version: SOP1_VERSION, ready: false, blockers, rows: [], counts: {} };
  if (!Array.isArray(plan.files) || plan.files.length !== proof.files.length || plan.files.some((file, i) => newFileSignature(file) !== proof.fileSignatures[i])) fail(null, 'CSV來源或欄位對應已改變，請重新預覽');
  if (!Array.isArray(plan.rows) || plan.rows.length !== proof.rows.length) fail(null, 'CSV預覽列不完整，請重新預覽');
  const classifications = classifyNewOnly(proof.files, proof.rows, bundle);
  const exclusions = csvExclusionList(bundle), revokeIds = plan.revokeExclusionIds;
  if (!Array.isArray(revokeIds) || revokeIds.length > exclusions.length || new Set(revokeIds).size !== revokeIds.length || revokeIds.some(id => !exclusions.some(item => item.id === id))) fail(null, '撤銷排除的選擇已失效，請重新預覽');
  const decisions = new Map();
  for (const [index, canonical] of proof.rows.entries()) {
    const row = plan.rows?.[index], classification = classifications[index];
    if (!row || newRowSignature(row) !== proof.rowSignatures[index]) { fail(canonical, 'CSV預覽資料與原始列不符，請重新預覽'); continue; }
    if (row.review !== undefined || row.reviewExcluded !== undefined || !Array.isArray(row.fillFields) || row.fillFields.length) fail(row, '只新增新門市模式不能補登既有欄位或套用裁定');
    if (!['new', 'skip', 'exclude'].includes(row.choice) || row.choice === 'new' && classification.status !== 'new' || row.choice === 'exclude' && !classification.canExclude) fail(row, '只有新店候選可以新增；記住排除須有穩定地點識別及完整身分，其餘列只能略過');
    const identity = csvExclusionIdentity(canonical.data);
    if (identity && ['new', 'exclude'].includes(row.choice)) {
      const key = exclusionKey(identity), prior = decisions.get(key);
      if (prior && prior !== row.choice) fail(row, '同一精確地點不能同時新增與記住排除');
      decisions.set(key, row.choice);
    }
    const checkedRow = { ...canonical, choice: row.choice === 'exclude' ? 'skip' : row.choice, supplementColumns: row.supplementColumns, sop1: row.sop1 };
    const checkedPlan = { files: proof.files, rows: [checkedRow] };
    try { supplementSelection(checkedPlan, checkedRow, []); } catch (error) { fail(row, error.message); }
    if (row.choice === 'new' && csvSupplementChoices(checkedPlan, checkedRow, []).length && !row.sop1?.extraAccepted) fail(row, '尚有其他非空白文字欄，須核對勾選結果；未勾選只保留原始來源');
    summaries.push({ key: row.key, kind: row.choice === 'exclude' ? 'remember-exclusion' : row.choice === 'new' && classification.status === 'new' ? row.note?.trim() ? 'new-note' : 'no-note' : classification.status === 'excluded' ? 'metadata' : 'skipped', newStoreOnly: classification });
  }
  return { version: SOP1_VERSION, ready: !blockers.length, blockers, rows: summaries, counts: Object.fromEntries([...new Set(summaries.map(row => row.kind))].map(kind => [kind, summaries.filter(row => row.kind === kind).length])) };
}
function buildNewStoresOnly(plan, bundle, device) {
  const report = newStoreOnlyReport(plan, bundle);
  if (!report.ready) throw new Error('只新增新門市檢查未通過：' + report.blockers[0].message);
  const proof = newStorePlans.get(plan), next = structuredClone(bundle), at = new Date().toISOString(), batch = uuid(), sourceIds = proof.files.map(() => uuid()), newStores = new Set();
  next.schema = 2;
  const summary = { sourceSnapshots: 0, stores: 0, linked: 0, notes: 0, updatedNotes: 0, missingNotes: 0, restoredNotes: 0, unchangedNotes: 0, duplicateNotes: 0, filledFields: 0, adoptedSupplements: 0, skipped: 0, rows: 0, mergeGroups: 0, mergedStores: 0, movedVisits: 0, excludedPlaces: 0, revokedExclusions: 0, auditSnapshots: 0 };
  const memory = exclusionState(bundle), remembered = new Set(), eventsByFile = new Map();
  for (const [index, canonical] of proof.rows.entries()) {
    if (plan.rows[index].choice !== 'exclude') continue;
    const identity = csvExclusionIdentity(canonical.data), key = exclusionKey(identity);
    if (remembered.has(key)) continue;
    remembered.add(key);
    const event = { id: uuid(), action: 'exclude', identity, profile: { name: canonical.data.name, address: canonical.data.address, mapUrl: canonical.data.mapUrl },
      line: canonical.line, fingerprint: canonical.fingerprint, seenRevocations: [...(memory.revocations.get(key) || [])].sort() };
    const list = eventsByFile.get(canonical.fileIndex) || []; list.push(event); eventsByFile.set(canonical.fileIndex, list); summary.excludedPlaces++;
  }
  for (const [index, file] of proof.files.entries()) {
    if (!(plan.files[index].bytes instanceof Uint8Array) || plan.files[index].bytes.length !== file.bytes.length || file.bytes.some((byte, i) => byte !== plan.files[index].bytes[i])) throw new Error('CSV原始bytes已改變，請重新預覽');
    const encoded = b64(file.bytes);
    if (Object.hasOwn(next.blobs, file.blob) && next.blobs[file.blob] !== encoded) throw new Error('原始CSV雜湊相同但內容不同，停止匯入');
    next.blobs[file.blob] = encoded;
    const csvExclusionEvents = eventsByFile.get(index);
    next.ops.push(revision('source', sourceIds[index], { file: file.file, list: file.list, batch, blob: file.blob, rows: file.rows.length, headers: [...file.headers], encoding: file.encoding || 'auto', delimiter: file.delimiter || 'auto', ...(csvExclusionEvents ? { csvExclusionEvents } : {}) }, [], device));
    summary.sourceSnapshots++;
  }
  const audits = new Map();
  for (const id of plan.revokeExclusionIds) {
    const { source } = memory.events.get(id), audit = audits.get(source.entity) || { source, events: [] };
    audit.events.push({ id: uuid(), action: 'revoke', target: id }); audits.set(source.entity, audit); summary.revokedExclusions++;
  }
  for (const { source, events } of audits.values()) {
    const data = { ...structuredClone(source.data), batch, csvExclusionEvents: events, csvExclusionAuditOf: source.entity };
    next.ops.push(revision('source', uuid(), data, [], device)); summary.auditSnapshots++;
  }
  for (const [index, canonical] of proof.rows.entries()) {
    const row = plan.rows[index];
    if (row.choice === 'skip' || row.choice === 'exclude') { summary.skipped++; continue; }
    const file = proof.files[canonical.fileIndex], raw = file.rows[canonical.rowIndex], id = uuid();
    const supplements = supplementChoices(file, raw, canonical).filter(field => (row.supplementColumns || []).includes(field.column)).map(({ column, header, text }) => ({ column, header, text, kind: 'supplement' }));
    const source = { fingerprint: canonical.fingerprint, sourceSnapshot: sourceIds[canonical.fileIndex], batch, file: file.file, line: canonical.line, list: file.list, at, blob: file.blob, headers: [...file.headers], cells: [...raw.cells], sop1Version: SOP1_VERSION, supplements, disposition: 'new', supplementReviewed: !!row.sop1?.extraAccepted, manualReviewed: false };
    newStores.add(id);
    next.ops.push(revision('store', id, { ...canonical.data, csvSources: [source], lists: [file.list] }, [], device));
    summary.stores++; summary.rows++; summary.adoptedSupplements += supplements.length;
    if (canonical.noteProvided && canonical.note) {
      next.ops.push(revision('visit', uuid(), { store: id, date: canonical.date, source: 'Google Maps CSV 匯入', text: canonical.note, googleText: canonical.note, next: '', topics: [], people: [], attachments: [], csvStream: csvStream(id, file.list), sourceMissing: false, googleUpdatePending: false, csvSources: [source] }, [], device));
      summary.notes++;
    }
  }
  const priorEntities = new Set(bundle.ops.map(op => op.entity));
  const additions = next.ops.slice(bundle.ops.length);
  if (JSON.stringify(next.ops.slice(0, bundle.ops.length)) !== JSON.stringify(bundle.ops) || Object.entries(bundle.blobs).some(([key, value]) => next.blobs[key] !== value) ||
    new Set(additions.map(op => op.entity)).size !== additions.length || additions.some(op => priorEntities.has(op.entity) || !['store', 'visit', 'source'].includes(op.type) || op.parents.length || op.deleted || op.type === 'visit' && !newStores.has(op.data.store))) throw new Error('只新增模式不能變更任何既有實體或來源');
  validateBundle(next);
  if (utf8.encode(JSON.stringify(next)).length > MAX_BYTES - 65536) throw new Error('匯入後超過資料庫24MB上限；尚未寫入');
  return { bundle: next, summary, batch };
}
export async function planCSV(files, bundle, options = {}) {
  if (options.mode === 'new-only') return planNewStoresOnly(files, bundle);
  if (options.mode !== undefined && options.mode !== 'standard') throw new Error('CSV匯入模式不正確');
  const records = project(bundle), stores = records.filter(r => r.type === 'store'), visits = records.filter(r => r.type === 'visit' && !r.deleted && !r.conflict), seenBatch = new Set();
  const rows = [], batchIdentities = new Map(), batchNames = new Map(), storeIndex = new Map(), rowIndex = new Map(), exactIndex = new Map();
  const add = (index, key, item) => { if (!key) return; const group = index.get(key) || []; group.push(item); index.set(key, group); };
  for (const store of stores) {
    add(exactIndex, identity(store), store);
    for (const key of profileKeys(store)) add(storeIndex, key, store);
    const primaryName = comparisonText(store.name), aliasKeys = new Set((store.csvAliases || []).map(comparisonText).filter(name => name && name !== primaryName));
    // A saved alias with changed identity evidence is a review signal only. It must
    // never silently create a second store or reuse the old adjudication.
    for (const name of aliasKeys) add(storeIndex, 'name:' + name, store);
  }
  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    validateMapping(f);
    for (const [ri, r] of f.rows.entries()) {
      const get = field => f.mapping[field] >= 0 ? r.cells[f.mapping[field]] ?? '' : '';
      const data = { name: get('name'), address: get('address'), mapUrl: get('url'), city: get('city'), district: get('district'), channel: get('channel') || f.channel, attr: '', contact: get('contact') };
      const note = get('note'), rawDate = get('date'), date = originalDate(rawDate), fingerprint = await hashBytes(utf8.encode(JSON.stringify([f.headers, r.cells]))), key = `${fi}:${ri}`;
      const warnings = [], errors = [];
      if (!data.name.trim()) errors.push('缺少地點名稱');
      for (const [field, label] of Object.entries(PROFILE_FIELDS)) { const max = field === 'name' ? 200 : ['address', 'mapUrl'].includes(field) ? 2000 : 500; if ((data[field] || '').length > max) errors.push(label + '超過 ' + max + ' 字上限，不會截斷原文'); }
      if (note.length > 20000) errors.push('備註超過 20,000 字上限，不會截斷原文');
      if (rawDate && !date) warnings.push('日期格式不明，將標示未提供，原始值保留');
      const noteProvided = f.mapping.note >= 0;
      if (!noteProvided) warnings.push('未對應備註欄位，既有備註及來源缺失狀態不變');
      else if (!note) warnings.push('本次匯出沒有備註；若同一來源以前有內容，會保留舊文並標示狀態');
      else if (!note.trim()) warnings.push('備註只有空白字元，原文仍完整保留，請核對來源');
      const issues = profileIssues(data);
      warnings.push(...issues.filter(i => i.kind !== 'error').map(i => i.message));
      const id = identity(data), matches = exactIndex.get(id) || [], names = storeIndex.get('name:' + comparisonText(data.name)) || [];
      const keys = profileKeys(data), similar = [...new Set(keys.flatMap(k => storeIndex.get(k) || []))], batchSimilar = [...new Set(keys.flatMap(k => rowIndex.get(k) || []))];
      const candidates = similar.map(s => ({ choice: 'store:' + s.id, data: s, reasons: duplicateEvidence(data, s) }));
      const batchCandidates = batchSimilar.map(r => ({ choice: 'row:' + r.key, data: r.data, reasons: duplicateEvidence(data, r.data) }));
      const batchFingerprint = normalizeListName(f.list).toLocaleLowerCase('zh-Hant') + ':' + fingerprint;
      let choice = 'new', reason = '新增門市', matchedStoreId;
      if (seenBatch.has(batchFingerprint)) { choice = 'skip'; reason = '同一來源清單的相同原始列已在本批出現'; }
      else if (errors.length) { choice = 'skip'; reason = errors.join('；'); }
      else if ([...matches, ...names].some(store => store.mergedInto || store.storeMergeHistory?.length)) { choice = 'review'; reason = '此來源涉及已合併門市，須另行核對原筆記串流；不會自動新建、覆蓋或還原'; }
      else if (matches.length === 1 && !matches[0].conflict && !matches[0].deleted) {
        const matched = matches[0]; matchedStoreId = matched.id; choice = `store:${matched.id}`; reason = '相同地圖網址或名稱＋地址';
        const stream = csvStream(matched.id, f.list), current = visits.filter(v => visitStream(v) === stream);
        const sameStoreRow = (matched.csvSources || []).some(s => s.fingerprint === fingerprint && normalizeListName(s.list).toLocaleLowerCase('zh-Hant') === normalizeListName(f.list).toLocaleLowerCase('zh-Hant'));
        const sameState = !noteProvided || (!note ? !current.length || current.length === 1 && current[0].sourceMissing : current.length === 1 && (current[0].googleText ?? current[0].text) === note && (!date || current[0].date === date) && !current[0].sourceMissing);
        const missingSupplements = supplementChoices(f, r, { fingerprint }, matched.csvSources || []).some(field => !field.included);
        const fillable = FILL_FIELDS.some(field => data[field]?.trim() && !matched[field]?.trim());
        if (sameStoreRow && sameState && !missingSupplements && !fillable) { choice = 'skip'; reason = '目前版本已包含相同原始列'; }
      }
      else if (matches.length || names.length) { choice = 'review'; reason = [...matches, ...names].some(store => store.mergedInto)
        ? '命中已合併門市的舊名稱或地點識別；請核對保留主檔，不會自動復活舊店或另建門市'
        : '同名、已刪除或多個可能門市，請指定'; }
      else if (id && batchIdentities.has(id)) { choice = `row:${batchIdentities.get(id)}`; reason = '連結本批相同網址／地址的門市'; }
      else if (batchNames.has(data.name.trim())) { choice = 'review'; reason = '本批有同名門市，不能只依名稱合併'; }
      else if (candidates.length || batchCandidates.length) { choice = 'review'; reason = '有相似名稱、地址或地點識別，請比對來源後指定'; }
      if (choice === 'new') { if (id) batchIdentities.set(id, key); batchNames.set(data.name.trim(), key); }
      seenBatch.add(batchFingerprint);
      rows.push({ key, fileIndex: fi, rowIndex: ri, line: r.line, data, note, noteProvided, date, fingerprint, choice, reason, warnings, errors, issues, candidates: [...candidates, ...batchCandidates], fillFields: [], supplementColumns: [], ...(matchedStoreId ? { matchedStoreId } : {}) });
      for (const key of keys) add(rowIndex, key, rows.at(-1));
    }
  }
  if (rows.length > 1500) throw new Error('每批最多 1,500 列，請分批匯入。');
  return prepareSOP1({ files, rows, baseRevision: bundleRevision(bundle), vaultId: bundle.vaultId }, records);
}
export function profileChanges(row, records) {
  if (!row.choice.startsWith('store:')) return [];
  const store = records.find(s => s.type === 'store' && s.id === row.choice.slice(6) && !s.deleted && !s.conflict);
  if (!store) return [];
  return Object.keys(PROFILE_FIELDS).filter(field => row.data[field]?.trim() && row.data[field] !== (store[field] || '')).map(field => ({ field, label: PROFILE_FIELDS[field], previous: store[field] || '', incoming: row.data[field], fillable: FILL_FIELDS.includes(field) && !store[field]?.trim() }));
}
export function buildCSVImport(plan, bundle, device) {
  if (plan.mode === 'new-only' || newStorePlans.has(plan)) return buildNewStoresOnly(plan, bundle, device);
  if (plan.vaultId !== bundle.vaultId || plan.baseRevision !== bundleRevision(bundle)) throw new Error('資料已在預覽後變更，請重新產生匯入預覽；尚未寫入這批資料。');
  const sop = sop1Report(plan, bundle);
  if (!sop.ready) throw new Error('SOP1 尚未通過：' + sop.blockers[0].message + '。這批尚未寫入 App 或關聯圖。');
  const next = structuredClone(bundle), initial = project(bundle), states = new Map(initial.filter(r => r.type === 'store').map(r => [r.id, { data: structuredClone(r.heads[0].data), parents: r.heads.map(h => h.id), invalid: r.deleted || r.conflict }])); next.schema = 2;
  const resolution = new Map(), at = new Date().toISOString(), batch = uuid(), changed = new Set(), visitOps = [], sourceOps = [], mergeStoreOps = [], movedVisitRecords = new Map(), sourceSnapshotIds = plan.files.map(() => uuid());
  const summary = { sourceSnapshots: 0, stores: 0, linked: 0, notes: 0, updatedNotes: 0, missingNotes: 0, restoredNotes: 0, unchangedNotes: 0, duplicateNotes: 0, filledFields: 0, adoptedSupplements: 0, skipped: 0, rows: 0, mergeGroups: 0, mergedStores: 0, movedVisits: 0 };
  for (const [index, f] of plan.files.entries()) {
    const encoded = b64(f.bytes);
    if (Object.hasOwn(next.blobs, f.blob) && next.blobs[f.blob] !== encoded) throw new Error('原始 CSV 雜湊相同但內容不同，停止匯入。');
    next.blobs[f.blob] = encoded;
    const data = { file: f.file, list: f.list, batch, blob: f.blob, rows: f.rows.length, headers: [...f.headers], encoding: f.encoding || 'auto', delimiter: f.delimiter || 'auto', ...(plan.reviewPackageId ? { reviewPackageId: plan.reviewPackageId } : {}) };
    sourceOps.push(revision('source', sourceSnapshotIds[index], data, [], device)); summary.sourceSnapshots++;
  }
  for (const group of plan.reviewGroups || []) {
    if (!group.merge) continue;
    const candidates = group.candidates.map(id => initial.find(r => r.type === 'store' && r.id === id)).filter(Boolean), verified = reviewedMergePlan(group, candidates, initial);
    if (!verified || verified.blocked || verified.keeper !== group.merge.keeper || JSON.stringify(verified.merged.map(s => s.id).sort()) !== JSON.stringify(group.merge.merged.map(s => s.id).sort())) throw new Error('已裁定既有門市整併計畫已失效，請重新產生預覽。');
    const keeper = states.get(verified.keeper);
    if (!keeper || keeper.invalid) throw new Error('整併的保留門市已刪除或有衝突，請重新預覽。');
    const decisionKey = group.merge.decisionKey || (plan.reviewPackageId + ':' + group.id), rule = group.identityRule;
    const donors = verified.merged.map(item => ({ item, state: states.get(item.id), record: initial.find(r => r.type === 'store' && r.id === item.id) }));
    if (donors.some(d => !d.state || d.state.invalid || !d.record)) throw new Error('要整併的既有門市已刪除或有衝突，請重新預覽。');
    for (const { state: donor } of donors) for (const field of MERGE_PROFILE_FIELDS) if (!keeper.data[field]?.trim() && donor.data[field]?.trim()) keeper.data[field] = donor.data[field];
    const combinedSources = uniqueObjects([...(keeper.data.csvSources || []), ...donors.flatMap(d => d.state.data.csvSources || [])]);
    keeper.data.csvSources = combinedSources;
    keeper.data.lists = uniqueStrings([...(keeper.data.lists || []), ...donors.flatMap(d => d.state.data.lists || [])]);
    keeper.data.csvAliases = uniqueStrings([keeper.data.name, ...(keeper.data.csvAliases || []), ...donors.flatMap(d => [d.state.data.name, ...(d.state.data.csvAliases || [])]), ...group.names]);
    keeper.data.csvDecisionGroups = uniqueStrings([...(keeper.data.csvDecisionGroups || []), ...donors.flatMap(d => d.state.data.csvDecisionGroups || []), decisionKey]);
    keeper.data.csvIdentityRules = uniqueObjects([...(keeper.data.csvIdentityRules || []), ...donors.flatMap(d => d.state.data.csvIdentityRules || []), rule]);
    const pendingSources = combinedSources.filter(source => source.review?.pending);
    const covered = source => Array.isArray(source.review?.names) && source.review.names.length && source.review.names.every(name => rule.names.some(allowed => comparisonText(allowed) === comparisonText(name)));
    const opaquePending = [keeper, ...donors.map(d => d.state)].some(state => state.data.csvIdentityPending) && !pendingSources.length;
    keeper.data.csvIdentityPending = !!group.pending || opaquePending || pendingSources.some(source => !covered(source));
    changed.add(verified.keeper); summary.mergeGroups++;
    for (const { item, state: donor, record } of donors) {
      mergeStoreOps.push(revision('store', item.id, { ...donor.data, mergedInto: verified.keeper, mergeDecision: decisionKey }, donor.parents, device, true));
      donor.invalid = true; summary.mergedStores++;
      for (const visit of initial.filter(r => r.type === 'visit' && !r.deleted && r.store === item.id)) {
        const data = structuredClone(visit.heads[0].data), stream = remappedVisitStream(visit, item.id, verified.keeper);
        data.store = verified.keeper;
        if (stream) data.csvStream = stream;
        const op = revision('visit', visit.id, data, visit.heads.map(h => h.id), device);
        visitOps.push(op); movedVisitRecords.set(visit.id, { ...visit, ...data, heads: [op], versions: [...visit.versions, op], conflict: false }); summary.movedVisits++;
      }
    }
  }
  const visitsByStream = new Map();
  for (const original of initial.filter(r => r.type === 'visit' && !r.deleted)) {
    const visit = movedVisitRecords.get(original.id) || original, stream = visitStream(visit);
    if (!stream) continue;
    const group = visitsByStream.get(stream) || [];
    group.push(visit); visitsByStream.set(stream, group);
  }
  function resolve(row, chain = new Set()) {
    if (resolution.has(row.key)) return resolution.get(row.key);
    if (chain.has(row.key)) throw new Error('門市連結形成循環。'); chain.add(row.key);
    let id;
    if (row.choice === 'new') { id = uuid(); states.set(id, { data: { ...row.data, csvSources: [], lists: [] }, parents: [], invalid: false }); summary.stores++; }
    else if (row.choice.startsWith('store:')) { id = row.choice.slice(6); if (!states.has(id) || states.get(id).invalid) throw new Error('選取的門市已刪除或有衝突，請重新預覽。'); }
    else if (row.choice.startsWith('row:')) { const target = plan.rows.find(r => r.key === row.choice.slice(4)); if (!target || target.choice === 'skip' || target.choice === 'review' || target.errors.length) throw new Error('要連結的同批門市被略過或尚未確認。'); id = resolve(target, chain); }
    else throw new Error('請先指定所有待確認列要新增、連結或略過。');
    resolution.set(row.key, id); return id;
  }
  for (const row of plan.rows) {
    if (row.choice === 'skip') { summary.skipped++; continue; }
    if (row.errors.length) throw new Error(`第 ${row.line} 行：${row.errors.join('；')}。請略過或修正原檔。`);
    const id = resolve(row), state = states.get(id), f = plan.files[row.fileIndex], raw = f.rows[row.rowIndex];
    const selected = supplementChoices(f, raw, row, state.data.csvSources || []).filter(field => (row.supplementColumns || []).includes(field.column) && !field.included);
    const prior = (state.data.csvSources || []).some(source => sameSourceRow(source, row, f));
    const currentState = visitsByStream.get(csvStream(id, f.list)) || [];
    const same = row.noteProvided === false || (!row.note ? !currentState.length || currentState.length === 1 && currentState[0].sourceMissing : currentState.length === 1 && (currentState[0].googleText ?? currentState[0].text) === row.note && (!row.date || row.date === currentState[0].date) && !currentState[0].sourceMissing);
    const known = !row.review || (state.data.csvDecisionGroups || []).includes(row.review.key);
    const fieldsOnly = sop.rows.find(item => item.key === row.key)?.kind === 'supplement-only';
    if (known && prior && (same || fieldsOnly) && !currentState.some(visit => visit.conflict) && !row.fillFields.length && !selected.length) { summary.skipped++; continue; }
    if (row.review) {
      if (!known) {
        state.data.csvDecisionGroups = [...(state.data.csvDecisionGroups || []), row.review.key];
        if (row.review.pending) state.data.csvIdentityPending = true;
      }
      state.data.csvAliases = [...new Set([...(state.data.csvAliases || []), ...row.review.names])];
      if (row.review.identityRule) {
        const rules = state.data.csvIdentityRules || [], incoming = row.review.identityRule;
        const priorRule = rules.find(rule => rule.mapKey === incoming.mapKey);
        if (priorRule && JSON.stringify(priorRule) !== JSON.stringify(incoming)) throw new Error('既有門市的身分裁定證據不同，請重新核對後再匯入。');
        if (!priorRule) state.data.csvIdentityRules = [...rules, structuredClone(incoming)];
      }
    }
    for (const field of row.fillFields || []) {
      const original = initial.find(s => s.type === 'store' && s.id === id);
      if (!csvTargetChoice(plan, row).startsWith('store:') || !original || !FILL_FIELDS.includes(field) || original[field]?.trim() || !row.data[field]?.trim()) throw new Error('補欄位選取已失效，請重新核對匯入預覽。');
      if (state.data[field]?.trim() && state.data[field] !== row.data[field]) throw new Error(PROFILE_FIELDS[field] + '在本批有不同補值，請取消其中一個選取後再匯入。');
      if (!state.data[field]?.trim()) { state.data[field] = row.data[field]; summary.filledFields++; }
    }
    if (state.parents.length && !changed.has(id)) summary.linked++;
    const source = { fingerprint: row.fingerprint, sourceSnapshot: sourceSnapshotIds[row.fileIndex], batch, file: f.file, line: row.line, list: f.list, at, blob: f.blob, headers: [...f.headers], cells: [...raw.cells], sop1Version: SOP1_VERSION, supplements: selected.map(({ column, header, text }) => ({ column, header, text, kind: 'supplement' })), disposition: row.choice, supplementReviewed: !!row.sop1?.extraAccepted, manualReviewed: !!row.sop1?.manualAccepted };
    summary.adoptedSupplements += selected.length;
    if (row.review) source.review = structuredClone(row.review);
    state.data.csvSources = [...(state.data.csvSources || []), source];
    state.data.lists = [...new Set([...(state.data.lists || []), ...(f.list ? [f.list] : [])])];
    // Existing profiles are not overwritten, including their names, addresses and map URLs.
    changed.add(id); summary.rows++;
    if (fieldsOnly) continue;
    const stream = csvStream(id, f.list), current = visitsByStream.get(stream) || [];
    if (current.length > 1) throw new Error(`第 ${row.line} 行：同一 Google 備註來源已有多筆舊紀錄，為避免錯誤合併，請先在 App 檢查。`);
    const existing = current[0];
    if (row.noteProvided === false) continue;
    if (existing?.conflict) throw new Error(f.file + ' 第 ' + row.line + ' 行：備註有同步衝突，請先核對後再匯入。');
    if (!existing && row.note) {
      const entity = uuid(), data = { store: id, date: row.date, source: 'Google Maps CSV 匯入', text: row.note, googleText: row.note, next: '', topics: [], people: [], attachments: [], csvStream: stream, sourceMissing: false, googleUpdatePending: false, csvSources: [source] };
      const op = revision('visit', entity, data, [], device); visitOps.push(op); visitsByStream.set(stream, [{ id: entity, type: 'visit', ...data, heads: [op], versions: [op] }]); summary.notes++;
    } else if (existing) {
      const base = structuredClone(existing.heads[0].data), parents = existing.heads.map(h => h.id);
      const previousGoogleText = existing.googleText ?? existing.text;
      if (row.note && (previousGoogleText !== row.note || existing.sourceMissing || row.date && row.date !== existing.date)) {
        const manuallyEdited = existing.googleText === undefined || existing.text !== existing.googleText;
        const data = { ...base, store: id, date: row.date || existing.date || '', source: 'Google Maps CSV 匯入', text: manuallyEdited ? existing.text : row.note, googleText: row.note, csvStream: stream, sourceMissing: false, googleUpdatePending: manuallyEdited && existing.text !== row.note, csvSources: [source] };
        const op = revision('visit', existing.id, data, parents, device); visitOps.push(op); visitsByStream.set(stream, [{ ...existing, ...data, heads: [op], versions: [...existing.versions, op] }]);
        if (existing.sourceMissing && previousGoogleText === row.note) summary.restoredNotes++; else summary.updatedNotes++;
      } else if (!row.note && !existing.sourceMissing) {
        const data = { ...base, csvStream: stream, sourceMissing: true, csvSources: [source] };
        const op = revision('visit', existing.id, data, parents, device); visitOps.push(op); visitsByStream.set(stream, [{ ...existing, ...data, heads: [op], versions: [...existing.versions, op] }]); summary.missingNotes++;
      } else { summary.unchangedNotes++; summary.duplicateNotes++; }
    }
  }
  for (const id of changed) { const s = states.get(id); next.ops.push(revision('store', id, s.data, s.parents, device)); }
  next.ops.push(...mergeStoreOps, ...sourceOps, ...visitOps); validateBundle(next);
  if (utf8.encode(JSON.stringify(next)).length > MAX_BYTES - 65536) throw new Error('匯入後超過資料庫 24 MB 上限。這批尚未寫入，請減少檔案或分庫。');
  return { bundle: next, summary, batch };
}

export const REVIEW_FORMAT = 'pharmacy-csv-review-1';
export const REVIEW_LIMIT = 8 * 1024 * 1024;
// A review package contains original CSV bytes and a complete row partition. It is
// not a database backup and cannot write or resolve existing App data by itself.
export async function prepareReviewedCSV(text) {
  if (typeof text !== 'string' || utf8.encode(text).length > REVIEW_LIMIT) throw new Error('已核對資料包超過8 MB上限。');
  let input; try { input = JSON.parse(text); } catch { throw new Error('已核對資料包不是有效JSON。'); }
  const fail = () => { throw new Error('已核對資料包不完整或裁定與來源不一致，尚未寫入。'); };
  if (input?.format !== REVIEW_FORMAT || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > 10 || !Array.isArray(input.groups) || input.groups.length > 1500 || !Array.isArray(input.excluded)) fail();
  const files = [], sources = new Map(); let total = 0;
  for (const entry of input.files) {
    if (typeof entry.file !== 'string' || !entry.file || entry.file.length > 500 || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.content)) fail();
    let bytes; try { bytes = unb64(entry.content); } catch { fail(); }
    total += bytes.length; if (total > 5 * 1024 * 1024 || bytes.length > CSV_LIMIT || await hashBytes(bytes) !== entry.sha256) fail();
    if (sources.has(entry.sha256)) fail(); // Ambiguous references must not choose an arbitrary copy.
    const f = await prepareCSV(entry.file, bytes);
    if (entry.list !== f.list) fail();
    sources.set(entry.sha256, f); files.push(f);
  }
  const base = await planCSV(files, { schema: 2, vaultId: 'review-validation', ops: [], blobs: {} });
  const index = new Map(base.rows.map(r => [`${files[r.fileIndex].blob}:${r.line}`, r])), seen = new Set(), ids = new Set(), groups = [];
  function member(ref) {
    if (!ref || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isInteger(ref.line) || typeof ref.fingerprint !== 'string') fail();
    const key = `${ref.sha256}:${ref.line}`, row = index.get(key);
    if (!row || seen.has(key) || row.fingerprint !== ref.fingerprint) fail();
    seen.add(key); return row;
  }
  for (const g of input.groups) {
    if (!g || typeof g.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(g.id) || ids.has(g.id) || typeof g.label !== 'string' || !g.label.trim() || g.label.length > 200 || typeof g.pending !== 'boolean' || !Array.isArray(g.rows) || !g.rows.length || g.rows.length > 1500) fail();
    ids.add(g.id);
    const members = g.rows.map(member);
    if (members.some(r => r.sop1.metadata || r.errors.length)) fail();
    const names = [...new Set(members.map(r => r.data.name))];
    if (names.length > 100) fail();
    let identityRule;
    if (g.identityRule !== undefined) {
      const rule = g.identityRule, memberKeys = [...new Set(members.map(r => mapKey(r.data.mapUrl || '')).filter(Boolean))];
      if (!rule || rule.decision !== 'same' || typeof rule.mapKey !== 'string' || !rule.mapKey || rule.mapKey.startsWith('short:') || memberKeys.length !== 1 || memberKeys[0] !== rule.mapKey || typeof rule.label !== 'string' || rule.label !== g.label || typeof rule.source !== 'string' || !rule.source || rule.source.length > 200 || typeof rule.decidedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rule.decidedAt) || !Array.isArray(rule.names) || rule.names.length < 2 || rule.names.length > 100 || rule.names.some(n => typeof n !== 'string' || !n.trim() || n.length > 200 || !names.includes(n)) || new Set(rule.names).size !== names.length || !names.every(n => rule.names.includes(n)) || !Array.isArray(rule.addresses) || rule.addresses.length > 100 || rule.addresses.some(a => typeof a !== 'string' || !a.trim() || a.length > 2000)) fail();
      identityRule = structuredClone(rule);
    }
    groups.push({ id: g.id, label: g.label, pending: g.pending, rows: members.map(r => r.key), names, ...(identityRule ? { identityRule } : {}) });
  }
  const excluded = input.excluded.map(ref => member(ref).key);
  if (seen.size !== base.rows.length) fail();
  // Canonical content-derived key makes whitespace-only reformatting idempotent.
  const packageId = await hashBytes(utf8.encode(JSON.stringify({ files: files.map(f => [f.blob, f.list]), groups, excluded })));
  return { files, groups, excluded, packageId };
}
const MERGE_PROFILE_FIELDS = ['address', 'city', 'district', 'channel', 'contact', 'attr'];
const mergeFieldLabel = field => PROFILE_FIELDS[field] || ({ attr: '屬性' }[field] || field);
const sameMergeValue = (a, b) => comparisonText(a) === comparisonText(b);
const uniqueStrings = values => [...new Set(values.filter(v => typeof v === 'string' && v))];
const uniqueObjects = values => {
  const seen = new Set();
  return values.filter(value => { const key = JSON.stringify(value); if (seen.has(key)) return false; seen.add(key); return true; });
};
function remappedVisitStream(visit, fromStore, toStore) {
  const stream = visitStream(visit);
  if (!stream) return '';
  const prefix = 'google-csv:' + fromStore + ':';
  if (stream.startsWith(prefix)) return 'google-csv:' + toStore + ':' + stream.slice(prefix.length);
  const source = [...(visit.csvSources || [])].reverse().find(s => s?.list);
  return source?.list ? csvStream(toStore, source.list) : '';
}
function relatedInsightMappingHistory(records, selectedIds) {
  // CSV's legacy same-store merge cannot rebind shared relationship mappings.
  // Keep both owned and externally referenced mappings, including withdrawn
  // mappings and tombstones, until an explicit relation-aware merge is reviewed.
  return records.some(store => store.type === 'store' && [store, ...(store.versions || []).map(version => version.data)].some(data =>
    Array.isArray(data.preVisitInsightRelations) && data.preVisitInsightRelations.length &&
    (selectedIds.has(store.id) || data.preVisitInsightRelations.some(relation =>
      Array.isArray(relation.members) && relation.members.some(member => selectedIds.has(member.storeId))))));
}
function reviewedMergePlan(group, candidates, records) {
  const rule = group.identityRule;
  if (!rule || rule.decision !== 'same') return null;
  const active = candidates.filter(s => !s.deleted);
  const scoped = active.filter(s => rule.names.some(name => comparisonText(name) === comparisonText(s.name)) && mapKey(s.mapUrl || '') === rule.mapKey && (!rule.addresses.length || !s.address?.trim() || rule.addresses.some(address => comparisonText(address) === comparisonText(s.address))));
  if (scoped.length < 2) return null;
  if (scoped.some(s => s.conflict)) return { blocked: '已裁定同店的既有門市存在同步衝突，不能自動整併' };
  if (scoped.some(store => store.monthlyVisits?.length || store.versions?.some(version => version.data.monthlyVisits?.length))) return { blocked: '既有門市保有每月必訪名單或歷史，須先核對月份與門市歸屬，不能透過 CSV 自動整併' };
  const scopedIds = new Set(scoped.map(s => s.id));
  if (relatedInsightMappingHistory(records, scopedIds)) return { blocked: '既有門市涉及共用人物關係或其歷史，須先核對關係成員與審核來源，不能透過 CSV 自動整併' };
  const unrelated = active.filter(s => !scopedIds.has(s.id));
  if (unrelated.length) return { blocked: '同店裁定附近仍有裁定範圍外的既有門市候選，不能自動整併' };
  const keepers = scoped.filter(s => comparisonText(s.name) === comparisonText(rule.label));
  if (keepers.length !== 1) return { blocked: '同店裁定命中多筆既有門市，但無法唯一決定保留哪一筆 App 門市' };
  const keeper = keepers[0], merged = scoped.filter(s => s.id !== keeper.id);
  if (scoped.some(s => (s.qualityDistinct || []).length) || records.some(s => s.type === 'store' && (s.qualityDistinct || []).some(r => scopedIds.has(r.store)))) return { blocked: '既有資料含「確認為不同門市」紀錄，須先人工核對後才能整併' };
  for (const donor of merged) for (const field of MERGE_PROFILE_FIELDS) {
    const a = keeper[field]?.trim(), b = donor[field]?.trim();
    if (a && b && !sameMergeValue(a, b)) return { blocked: '已裁定同店的兩筆既有門市「' + mergeFieldLabel(field) + '」不同，不能自動覆蓋' };
  }
  for (const store of scoped) for (const prior of store.csvIdentityRules || []) {
    if (prior.mapKey === rule.mapKey && JSON.stringify(prior) !== JSON.stringify(rule)) return { blocked: '既有門市保存了不同的身分裁定證據，不能自動整併' };
  }
  const activeVisits = records.filter(r => r.type === 'visit' && !r.deleted);
  if (activeVisits.some(v => scopedIds.has(v.store) && v.conflict)) return { blocked: '要整併的門市有拜訪同步衝突，須先解決衝突' };
  const seenStreams = new Set(activeVisits.filter(v => v.store === keeper.id).map(visitStream).filter(Boolean));
  let movedVisits = 0;
  for (const donor of merged) for (const visit of activeVisits.filter(v => v.store === donor.id)) {
    const current = visitStream(visit), target = remappedVisitStream(visit, donor.id, keeper.id);
    if (current && !target) return { blocked: '既有 Google 來源無法安全改連到保留門市，停止自動整併' };
    if (target && seenStreams.has(target)) return { blocked: '兩筆既有門市在同一來源清單各有拜訪版本，不能自動決定哪一筆保留' };
    if (target) seenStreams.add(target);
    movedVisits++;
  }
  const sourceCount = scoped.reduce((n, s) => n + (s.csvSources || []).length, 0);
  const aliases = uniqueStrings(scoped.flatMap(s => [s.name, ...(s.csvAliases || [])]).concat(rule.names));
  const decisions = uniqueStrings(scoped.flatMap(s => s.csvDecisionGroups || []));
  const rules = uniqueObjects(scoped.flatMap(s => s.csvIdentityRules || []).concat([rule]));
  const lists = uniqueStrings(scoped.flatMap(s => s.lists || []));
  if (sourceCount > 20000 || aliases.length > 100 || decisions.length + 1 > 200 || rules.length > 200 || lists.length > 2000) return { blocked: '整併後會超過門市來源或裁定紀錄上限，停止自動整併' };
  return { keeper: keeper.id, keeperName: keeper.name, merged: merged.map(s => ({ id: s.id, name: s.name })), movedVisits };
}
function mergeTargetMap(plan) {
  return new Map((plan.reviewGroups || []).flatMap(g => g.merge ? g.merge.merged.map(s => [s.id, g.merge.keeper]) : []));
}
function plannedVisitStream(plan, visit) {
  const keeper = mergeTargetMap(plan).get(visit.store);
  return keeper ? remappedVisitStream(visit, visit.store, keeper) : visitStream(visit);
}
export function setReviewedGroupChoice(plan, id, choice) {
  const group = plan.reviewGroups?.find(g => g.id === id);
  if (!group || !['new', 'review', 'skip'].includes(choice) && !choice.startsWith('store:')) throw new Error('裁定組或匯入方式不正確。');
  if (group.merge && choice !== 'store:' + group.merge.keeper) throw new Error('此組已有精確同店裁定與安全整併計畫；若要改變去向，請取消本批並重新裁定。');
  if (group.mergeBlocked && choice !== 'review') throw new Error('此組同店裁定目前無法安全整併，不能以手動改指門市繞過阻擋。');
  const first = group.rows[0]; group.choice = choice;
  for (const key of group.rows) {
    const row = plan.rows.find(r => r.key === key);
    row.choice = ['skip', 'review'].includes(choice) || key === first ? choice : 'row:' + first;
    row.fillFields = []; row.supplementColumns = []; row.sop1.extraAccepted = false; row.sop1.manualAccepted = false;
  }
}
export async function planReviewedCSV(review, bundle) {
  const plan = await planCSV(review.files, bundle), records = project(bundle), stores = records.filter(r => r.type === 'store');
  const byRow = new Map(plan.rows.map(r => [r.key, r]));
  plan.reviewGroups = structuredClone(review.groups); plan.reviewPackageId = review.packageId;
  for (const key of review.excluded) { const row = byRow.get(key); row.choice = 'skip'; row.reviewExcluded = true; row.reason = '依已核對裁定排除本批；原始來源保留'; }
  for (const g of plan.reviewGroups) {
    const members = g.rows.map(key => byRow.get(key)), decisionKey = `${review.packageId}:${g.id}`;
    const known = stores.filter(s => s.csvDecisionGroups?.includes(decisionKey));
    const sourced = stores.filter(s => members.some(r => s.csvSources?.some(src => src.fingerprint === r.fingerprint && sourceListKey(src.list) === sourceListKey(plan.files[r.fileIndex].list))));
    const exact = stores.filter(s => g.names.some(n => comparisonText(n) === comparisonText(s.name)) && members.some(r => identity(r.data) && identity(r.data) === identity(s)));
    const related = stores.filter(s => members.some(r => duplicateEvidence(r.data, s).length));
    const matches = known.length ? known : sourced.length ? sourced : exact;
    const candidates = [...new Map([...known, ...sourced, ...exact, ...related].map(s => [s.id, s])).values()];
    const merge = reviewedMergePlan(g, candidates, records);
    let chosen;
    if (merge?.blocked) { g.mergeBlocked = merge.blocked; chosen = 'review'; }
    else if (merge) { g.merge = { ...merge, decisionKey }; chosen = 'store:' + merge.keeper; }
    else chosen = matches.length === 1 && !matches[0].deleted && !matches[0].conflict ? 'store:' + matches[0].id : matches.length || related.length ? 'review' : 'new';
    g.candidates = candidates.map(s => s.id);
    for (const row of members) {
      row.review = { key: decisionKey, group: g.id, pending: g.pending, label: g.label, names: g.names, ...(g.identityRule ? { identityRule: structuredClone(g.identityRule) } : {}) };
      row.data.name = g.label; // Display label only. CSV cells/fingerprints are never changed.
      row.reason = g.mergeBlocked || (g.merge ? '依已核對同店裁定，將既有門市整併至「' + g.merge.keeperName + '」；原版本與來源保留' : chosen === 'review' ? '與App既有門市有可能重疊或衝突，請對照原文後指定整組去向' : chosen === 'new' ? '依已核對分組新增；仍須確認本機匯入預覽' : '依原始來源或地點與名稱對照App既有門市；既有名稱保持不變');
    }
    setReviewedGroupChoice(plan, g.id, chosen);
  }
  return plan;
}
export function csvTargetChoice(plan, row, seen = new Set()) {
  if (!row || seen.has(row.key)) return 'review';
  seen.add(row.key);
  return row.choice.startsWith('row:') ? csvTargetChoice(plan, plan.rows.find(r => r.key === row.choice.slice(4)), seen) : row.choice;
}
export function exportCSVPreview(plan, bundle) {
  const report = sop1Report(plan, bundle), records = project(bundle);
  const candidateIds = new Set((plan.reviewGroups || []).flatMap(g => g.candidates));
  for (const row of plan.rows) {
    const target = csvTargetChoice(plan, row);
    if (target.startsWith('store:')) candidateIds.add(target.slice(6));
    for (const c of row.candidates) if (c.choice.startsWith('store:')) candidateIds.add(c.choice.slice(6));
  }
  const sourceRefs = sources => (sources || []).map(s => ({ file: s.file, line: s.line, list: s.list, fingerprint: s.fingerprint }));
  return { format: 'pharmacy-csv-preview-1', mode: plan.mode || 'standard', createdAt: new Date().toISOString(), imported: false, ready: report.ready, counts: report.counts,
    reviewPackageId: plan.reviewPackageId,
    groups: (plan.reviewGroups || []).map(g => ({ id: g.id, name: g.label, pending: g.pending, choice: g.choice, rows: g.rows, candidates: g.candidates, ...(g.merge ? { merge: structuredClone(g.merge) } : {}), ...(g.mergeBlocked ? { mergeBlocked: g.mergeBlocked } : {}) })),
    existingStores: records.filter(s => s.type === 'store' && candidateIds.has(s.id)).map(s => ({ id: s.id, name: s.name, address: s.address, mapUrl: s.mapUrl, deleted: s.deleted, conflict: s.conflict, sources: sourceRefs(s.csvSources),
      notes: records.filter(v => v.type === 'visit' && v.store === s.id && (!v.deleted || v.conflict)).map(v => ({ id: v.id, text: v.text, sourceText: v.googleText, date: v.date, conflict: v.conflict, sources: sourceRefs(v.csvSources), versions: v.conflict ? v.heads.map(h => ({ text: h.data.text, sourceText: h.data.googleText, date: h.data.date, deleted: h.deleted })) : undefined })) })),
    blockers: report.blockers.map(b => ({ ...b, name: plan.rows.find(r => r.key === b.key)?.data.name || '' })),
    rows: plan.rows.map(row => {
      const file = plan.files[row.fileIndex], target = csvTargetChoice(plan, row), storeId = target.startsWith('store:') ? target.slice(6) : '';
      const old = records.filter(r => r.type === 'visit' && !r.deleted && plannedVisitStream(plan, r) === csvStream(storeId, file.list));
      return { key: row.key, file: file.file, line: row.line, name: row.data.name, target, pending: !!row.review?.pending, newStoreOnly: report.rows.find(r => r.key === row.key)?.newStoreOnly, action: report.rows.find(r => r.key === row.key)?.kind || 'blocked', incomingText: row.note, fillFields: [...row.fillFields], supplementColumns: [...(row.supplementColumns || [])], supplements: csvSupplementChoices(plan, row, records).map(field => ({ ...field, selected: (row.supplementColumns || []).includes(field.column) })), existing: old.map(v => ({ text: v.text, sourceText: v.googleText, date: v.date, conflict: v.conflict })) };
    }) };
}
