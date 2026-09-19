import { b64, unb64, hashBytes, uuid, revision, project, validateBundle, MAX_BYTES } from './core.js';
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
export const SOP1_VERSION = '1.0.1';
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
  const records = project(bundle), byStore = new Map(records.filter(r => r.type === 'store').map(r => [r.id, r]));
  const byRow = new Map(plan.rows.map(r => [r.key, r])), blockers = [], summaries = [], streams = new Map();
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
    if (row.reviewExcluded && row.choice !== 'skip') fail(row, '此列已裁定排除，須重新核對資料包才可納入');
    if (row.choice === 'skip') { summaries.push({ key: row.key, kind: row.sop1?.metadata ? 'metadata' : 'skipped' }); continue; }
    if (row.choice === 'review') { fail(row, row.reason || '門市尚未核對'); continue; }
    if (row.errors.length) { fail(row, row.errors.join('；')); continue; }
    const resolved = target(row);
    if (!resolved) { fail(row, '門市連結尚未完成、被略過、已刪除或有衝突'); continue; }
    const file = plan.files[row.fileIndex];
    if ((row.textFields || []).some(f => f.kind === 'supplement') && !row.sop1?.extraAccepted) fail(row, '尚有其他非空白文字欄，須核對並確認保留為來源補充，不可默默漏掉');
    const stream = resolved + ':' + sourceListKey(file.list), bucket = streams.get(stream) || [];
    bucket.push(row); streams.set(stream, bucket);
    const existing = resolved.startsWith('store:') ? records.filter(v => v.type === 'visit' && !v.deleted && visitStream(v) === csvStream(resolved.slice(6), file.list)) : [];
    if (existing.length > 1 || existing.some(v => v.conflict)) fail(row, '同一來源有多筆備註或同步衝突，請先在 App 核對');
    const old = existing[0];
    let kind = !row.note?.trim() ? 'no-note' : old ? (old.googleText ?? old.text) === row.note && (!row.date || row.date === old.date) ? 'unchanged' : 'new-version' : 'new-note';
    if (old && row.noteProvided && !row.note) kind = 'retain-missing';
    const manual = old && row.note && old.text !== row.note && (old.googleText === undefined || old.text !== old.googleText) && row.note !== old.googleText;
    if (manual && !row.sop1?.manualAccepted) fail(row, 'App 手動修改與新來源文字不同，須先確認保留 App 文字及保存來源新版');
    summaries.push({ key: row.key, target: resolved, kind, manual: !!manual });
  }
  for (const group of streams.values()) {
    const notes = new Set(group.filter(r => r.noteProvided).map(r => JSON.stringify([r.note, r.date])));
    if (notes.size > 1) for (const row of group) fail(row, '同一門市、同一來源清單在本批有不同備註或日期，不能以檔案順序決定新版');
  }
  // Reviewed groups are user decisions, not another automatic identity heuristic.
  const assigned = new Map();
  for (const group of plan.reviewGroups || []) {
    const members = group.rows.map(key => byRow.get(key)), active = members.filter(r => r.choice !== 'skip');
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
export async function planCSV(files, bundle) {
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
      let choice = 'new', reason = '新增門市';
      if (seenBatch.has(batchFingerprint)) { choice = 'skip'; reason = '同一來源清單的相同原始列已在本批出現'; }
      else if (errors.length) { choice = 'skip'; reason = errors.join('；'); }
      else if (matches.length === 1 && !matches[0].conflict && !matches[0].deleted) {
        const matched = matches[0]; choice = `store:${matched.id}`; reason = '相同地圖網址或名稱＋地址';
        const stream = csvStream(matched.id, f.list), current = visits.filter(v => visitStream(v) === stream);
        const sameStoreRow = (matched.csvSources || []).some(s => s.fingerprint === fingerprint && normalizeListName(s.list).toLocaleLowerCase('zh-Hant') === normalizeListName(f.list).toLocaleLowerCase('zh-Hant'));
        const sameState = !noteProvided || (!note ? !current.length || current.length === 1 && current[0].sourceMissing : current.length === 1 && (current[0].googleText ?? current[0].text) === note && (!date || current[0].date === date) && !current[0].sourceMissing);
        if (sameStoreRow && sameState) { choice = 'skip'; reason = '目前版本已包含相同原始列'; }
      }
      else if (matches.length || names.length) { choice = 'review'; reason = '同名、已刪除或多個可能門市，請指定'; }
      else if (id && batchIdentities.has(id)) { choice = `row:${batchIdentities.get(id)}`; reason = '連結本批相同網址／地址的門市'; }
      else if (batchNames.has(data.name.trim())) { choice = 'review'; reason = '本批有同名門市，不能只依名稱合併'; }
      else if (candidates.length || batchCandidates.length) { choice = 'review'; reason = '有相似名稱、地址或地點識別，請比對來源後指定'; }
      if (choice === 'new') { if (id) batchIdentities.set(id, key); batchNames.set(data.name.trim(), key); }
      seenBatch.add(batchFingerprint);
      rows.push({ key, fileIndex: fi, rowIndex: ri, line: r.line, data, note, noteProvided, date, fingerprint, choice, reason, warnings, errors, issues, candidates: [...candidates, ...batchCandidates], fillFields: [] });
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
  if (plan.vaultId !== bundle.vaultId || plan.baseRevision !== bundleRevision(bundle)) throw new Error('資料已在預覽後變更，請重新產生匯入預覽；尚未寫入這批資料。');
  const sop = sop1Report(plan, bundle);
  if (!sop.ready) throw new Error('SOP1 尚未通過：' + sop.blockers[0].message + '。這批尚未寫入 App 或關聯圖。');
  const next = structuredClone(bundle), initial = project(bundle), states = new Map(initial.filter(r => r.type === 'store').map(r => [r.id, { data: structuredClone(r.heads[0].data), parents: r.heads.map(h => h.id), invalid: r.deleted || r.conflict }])); next.schema = 2;
  const resolution = new Map(), at = new Date().toISOString(), batch = uuid(), changed = new Set(), visitOps = [], addedBlobs = new Set();
  const summary = { stores: 0, linked: 0, notes: 0, updatedNotes: 0, missingNotes: 0, restoredNotes: 0, unchangedNotes: 0, duplicateNotes: 0, filledFields: 0, skipped: 0, rows: 0 };
  const visitsByStream = new Map();
  for (const visit of initial.filter(r => r.type === 'visit' && !r.deleted)) {
    const stream = visitStream(visit);
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
    if (row.review) {
      const known = (state.data.csvDecisionGroups || []).includes(row.review.key);
      const prior = (state.data.csvSources || []).some(s => s.fingerprint === row.fingerprint && sourceListKey(s.list) === sourceListKey(f.list));
      const current = visitsByStream.get(csvStream(id, f.list)) || [];
      const same = row.noteProvided === false || (!row.note ? !current.length || current.length === 1 && current[0].sourceMissing : current.length === 1 && (current[0].googleText ?? current[0].text) === row.note && (!row.date || row.date === current[0].date) && !current[0].sourceMissing);
      if (known && prior && same && !current.some(v => v.conflict) && !row.fillFields.length) { summary.skipped++; continue; }
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
    const source = { fingerprint: row.fingerprint, batch, file: f.file, line: row.line, list: f.list, at, blob: f.blob, headers: [...f.headers], cells: [...raw.cells], sop1Version: SOP1_VERSION, supplements: row.textFields.filter(field => field.kind === 'supplement'), disposition: row.choice, supplementReviewed: !!row.sop1?.extraAccepted, manualReviewed: !!row.sop1?.manualAccepted };
    if (row.review) source.review = structuredClone(row.review);
    state.data.csvSources = [...(state.data.csvSources || []), source];
    state.data.lists = [...new Set([...(state.data.lists || []), ...(f.list ? [f.list] : [])])];
    // Existing profiles are not overwritten, including their names, addresses and map URLs.
    changed.add(id); summary.rows++;
    if (!addedBlobs.has(f.blob)) { next.blobs[f.blob] = b64(f.bytes); addedBlobs.add(f.blob); }
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
  next.ops.push(...visitOps); validateBundle(next);
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
export function setReviewedGroupChoice(plan, id, choice) {
  const group = plan.reviewGroups?.find(g => g.id === id);
  if (!group || !['new', 'review', 'skip'].includes(choice) && !choice.startsWith('store:')) throw new Error('裁定組或匯入方式不正確。');
  const first = group.rows[0]; group.choice = choice;
  for (const key of group.rows) {
    const row = plan.rows.find(r => r.key === key);
    row.choice = ['skip', 'review'].includes(choice) || key === first ? choice : 'row:' + first;
    row.fillFields = []; row.sop1.manualAccepted = false;
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
    const chosen = matches.length === 1 && !matches[0].deleted && !matches[0].conflict ? 'store:' + matches[0].id : matches.length || related.length ? 'review' : 'new';
    g.candidates = [...new Set([...known, ...sourced, ...exact, ...related])].map(s => s.id);
    for (const row of members) {
      row.review = { key: decisionKey, group: g.id, pending: g.pending, label: g.label, names: g.names, ...(g.identityRule ? { identityRule: structuredClone(g.identityRule) } : {}) };
      row.data.name = g.label; // Display label only. CSV cells/fingerprints are never changed.
      row.reason = chosen === 'review' ? '與App既有門市有可能重疊或衝突，請對照原文後指定整組去向' : chosen === 'new' ? '依已核對分組新增；仍須確認本機匯入預覽' : '依原始來源或地點與名稱對照App既有門市；既有名稱保持不變';
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
  return { format: 'pharmacy-csv-preview-1', createdAt: new Date().toISOString(), imported: false, ready: report.ready, counts: report.counts,
    reviewPackageId: plan.reviewPackageId,
    groups: (plan.reviewGroups || []).map(g => ({ id: g.id, name: g.label, pending: g.pending, choice: g.choice, rows: g.rows, candidates: g.candidates })),
    existingStores: records.filter(s => s.type === 'store' && candidateIds.has(s.id)).map(s => ({ id: s.id, name: s.name, address: s.address, mapUrl: s.mapUrl, deleted: s.deleted, conflict: s.conflict, sources: sourceRefs(s.csvSources),
      notes: records.filter(v => v.type === 'visit' && v.store === s.id && (!v.deleted || v.conflict)).map(v => ({ id: v.id, text: v.text, sourceText: v.googleText, date: v.date, conflict: v.conflict, sources: sourceRefs(v.csvSources), versions: v.conflict ? v.heads.map(h => ({ text: h.data.text, sourceText: h.data.googleText, date: h.data.date, deleted: h.deleted })) : undefined })) })),
    blockers: report.blockers.map(b => ({ ...b, name: plan.rows.find(r => r.key === b.key)?.data.name || '' })),
    rows: plan.rows.map(row => {
      const file = plan.files[row.fileIndex], target = csvTargetChoice(plan, row), storeId = target.startsWith('store:') ? target.slice(6) : '';
      const old = records.filter(r => r.type === 'visit' && !r.deleted && visitStream(r) === csvStream(storeId, file.list));
      return { key: row.key, file: file.file, line: row.line, name: row.data.name, target, pending: !!row.review?.pending, action: report.rows.find(r => r.key === row.key)?.kind || 'blocked', incomingText: row.note, existing: old.map(v => ({ text: v.text, sourceText: v.googleText, date: v.date, conflict: v.conflict })) };
    }) };
}
