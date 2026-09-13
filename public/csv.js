import { b64, hashBytes, uuid, revision, project, validateBundle, MAX_BYTES } from './core.js';
const utf8 = new TextEncoder();
export const CSV_LIMIT = 2 * 1024 * 1024;
export const FIELD_NAMES = { name: '藥局／地點名稱（必要）', note: '備註原文', url: 'Google Maps 網址', address: '地址', city: '縣市', district: '地區', channel: '通路／屬性', date: '拜訪日期（不是匯出日期）' };
const aliases = { name: ['title', 'name', '名稱', '地點名稱', '藥局名稱', '門市名稱', '標題'], note: ['筆記', 'note', 'notes', 'comment', 'comments', '留言', '備註', '備註內容', '說明', 'description', '紀錄'], url: ['url', 'google maps url', '網址', '連結', '地圖網址'], address: ['address', '地址'], city: ['city', '縣市', '城市'], district: ['district', '地區', '行政區'], channel: ['channel', '通路', '門市屬性'], date: ['visit date', '拜訪日期'] };
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
    const index = aliases[k].map(alias => headers.findIndex(h => norm(h) === alias)).find(i => i >= 0);
    return [k, index ?? -1];
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
export function identity(data) { const url = specificMapURL(data.mapUrl || ''); return url ? `url:${url}` : data.name.trim() && data.address?.trim() ? `address:${data.name.trim()}\n${data.address.trim()}` : ''; }
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
  return { file, bytes, blob, ...parsed, mapping: guessMapping(parsed.headers), list: normalizeListName(file), encoding, channel: '' };
}
export async function planCSV(files, bundle) {
  const records = project(bundle), stores = records.filter(r => r.type === 'store'), visits = records.filter(r => r.type === 'visit' && !r.deleted && !r.conflict), seenBatch = new Set();
  const rows = [], batchIdentities = new Map(), batchNames = new Map();
  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    if (!Number.isInteger(f.mapping.name) || f.mapping.name < 0) throw new Error(`${f.file}：請指定藥局名稱欄位。`);
    for (const [ri, r] of f.rows.entries()) {
      const get = field => f.mapping[field] >= 0 ? r.cells[f.mapping[field]] ?? '' : '';
      const data = { name: get('name'), address: get('address'), mapUrl: get('url'), city: get('city'), district: get('district'), channel: get('channel') || f.channel, attr: '', contact: '' };
      const note = get('note'), rawDate = get('date'), date = originalDate(rawDate), fingerprint = await hashBytes(utf8.encode(JSON.stringify([f.headers, r.cells]))), key = `${fi}:${ri}`;
      const warnings = [], errors = [];
      if (!data.name.trim()) errors.push('缺少地點名稱');
      if (data.name.length > 200 || ['city', 'district', 'channel'].some(k => data[k].length > 500) || data.address.length > 2000 || data.mapUrl.length > 2000 || note.length > 20000) errors.push('欄位超過長度上限；不會截斷原文');
      if (rawDate && !date) warnings.push('日期格式不明，將標示未提供，原始值保留');
      if (!note) warnings.push('本次匯出沒有備註；若同一來源以前有內容，會保留舊文並標示狀態');
      const id = identity(data), matches = id ? stores.filter(s => identity(s) === id) : [], sourceUrlMatches = data.mapUrl.trim() ? stores.filter(s => s.mapUrl?.trim() === data.mapUrl.trim()) : [], names = stores.filter(s => s.name.trim() === data.name.trim());
      let choice = 'new', reason = '新增門市';
      if (seenBatch.has(fingerprint)) { choice = 'skip'; reason = '相同原始列已在本批出現'; }
      else if (errors.length) { choice = 'skip'; reason = errors.join('；'); }
      else if ((matches.length === 1 || !matches.length && sourceUrlMatches.length === 1) && !(matches[0] || sourceUrlMatches[0]).conflict && !(matches[0] || sourceUrlMatches[0]).deleted) {
        const matched = matches[0] || sourceUrlMatches[0]; choice = `store:${matched.id}`; reason = matches.length ? '相同地圖網址或名稱＋地址' : '與已核對門市保存的來源網址完全相同';
        const stream = csvStream(matched.id, f.list), current = visits.filter(v => visitStream(v) === stream);
        const sameStoreRow = (matched.csvSources || []).some(s => s.fingerprint === fingerprint);
        const sameState = !note ? !current.length || current.length === 1 && current[0].sourceMissing : current.length === 1 && (current[0].googleText ?? current[0].text) === note && !current[0].sourceMissing;
        if (sameStoreRow && sameState) { choice = 'skip'; reason = '目前版本已包含相同原始列'; }
      }
      else if (matches.length || names.length) { choice = 'review'; reason = '同名、已刪除或多個可能門市，請指定'; }
      else if (id && batchIdentities.has(id)) { choice = `row:${batchIdentities.get(id)}`; reason = '連結本批相同網址／地址的門市'; }
      else if (batchNames.has(data.name.trim())) { choice = 'review'; reason = '本批有同名門市，不能只依名稱合併'; }
      if (choice === 'new') { if (id) batchIdentities.set(id, key); batchNames.set(data.name.trim(), key); }
      seenBatch.add(fingerprint);
      rows.push({ key, fileIndex: fi, rowIndex: ri, line: r.line, data, note, date, fingerprint, choice, reason, warnings, errors });
    }
  }
  if (rows.length > 1500) throw new Error('每批最多 1,500 列，請分批匯入。');
  return { files, rows };
}
export function buildCSVImport(plan, bundle, device) {
  const next = structuredClone(bundle), initial = project(bundle), states = new Map(initial.filter(r => r.type === 'store').map(r => [r.id, { data: structuredClone(r.heads[0].data), parents: r.heads.map(h => h.id), invalid: r.deleted || r.conflict }])); next.schema = 2;
  const resolution = new Map(), at = new Date().toISOString(), batch = uuid(), changed = new Set(), visitOps = [], addedBlobs = new Set();
  const summary = { stores: 0, linked: 0, notes: 0, updatedNotes: 0, missingNotes: 0, restoredNotes: 0, unchangedNotes: 0, duplicateNotes: 0, skipped: 0, rows: 0 };
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
    if (state.parents.length && !changed.has(id)) summary.linked++;
    const source = { fingerprint: row.fingerprint, batch, file: f.file, line: row.line, list: f.list, at, blob: f.blob, headers: [...f.headers], cells: [...raw.cells] };
    state.data.csvSources = [...(state.data.csvSources || []), source];
    state.data.lists = [...new Set([...(state.data.lists || []), ...(f.list ? [f.list] : [])])];
    // Existing profiles are not overwritten, including their names, addresses and map URLs.
    changed.add(id); summary.rows++;
    if (!addedBlobs.has(f.blob)) { next.blobs[f.blob] = b64(f.bytes); addedBlobs.add(f.blob); }
    const stream = csvStream(id, f.list), current = visitsByStream.get(stream) || [];
    if (current.length > 1) throw new Error(`第 ${row.line} 行：同一 Google 備註來源已有多筆舊紀錄，為避免錯誤合併，請先在 App 檢查。`);
    const existing = current[0];
    if (!existing && row.note) {
      const entity = uuid(), data = { store: id, date: row.date, source: 'Google Maps CSV 匯入', text: row.note, googleText: row.note, next: '', topics: [], people: [], attachments: [], csvStream: stream, sourceMissing: false, googleUpdatePending: false, csvSources: [source] };
      const op = revision('visit', entity, data, [], device); visitOps.push(op); visitsByStream.set(stream, [{ id: entity, type: 'visit', ...data, heads: [op], versions: [op] }]); summary.notes++;
    } else if (existing) {
      const base = structuredClone(existing.heads[0].data), parents = existing.heads.map(h => h.id);
      const previousGoogleText = existing.googleText ?? existing.text;
      if (row.note && (previousGoogleText !== row.note || existing.sourceMissing)) {
        const manuallyEdited = existing.googleText !== undefined && existing.text !== existing.googleText;
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
