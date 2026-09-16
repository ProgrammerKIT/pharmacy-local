// Local, read-only audit of explicitly selected files. Never run on repository data by glob.
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { prepareCSV, planCSV, mapKey, comparisonText, sourceListKey, SOP1_VERSION } from '../public/csv.js';
import { emptyBundle } from '../public/core.js';
const sha = value => createHash('sha256').update(value).digest('hex');
const unique = values => [...new Set(values)];

export async function auditCSV(currentPaths, previousPaths = []) {
  const files = await Promise.all(currentPaths.map(async path => prepareCSV(basename(path), new Uint8Array(await readFile(path)))));
  const previous = await Promise.all(previousPaths.map(async path => ({ name: basename(path), bytes: await readFile(path) })));
  const plan = await planCSV(files, emptyBundle('sop1-offline-audit'));
  const groups = new Map(), ledger = [], exceptions = [], notes = new Map();
  for (const row of plan.rows) {
    const file = files[row.fileIndex], raw = file.rows[row.rowIndex], ref = `${file.file}:${row.line}`, key = mapKey(row.data.mapUrl);
    const strong = key && !key.startsWith('short:') ? key : '';
    const groupKey = row.sop1.metadata ? '' : row.data.name ? strong || `unresolved:${row.key}` : '';
    const item = { row: row.key, file: file.file, list: file.list, line: row.line, sha256: sha(file.bytes), fingerprint: row.fingerprint, name: row.data.name, mapKey: key, groupKey, cells: raw.cells, textFields: row.textFields, cleanedNote: row.cleanedNote, metadata: row.sop1.metadata, proposedChoice: row.choice, reason: row.reason };
    ledger.push(item);
    if (row.sop1.metadata) exceptions.push({ level: '資訊', kind: '清單標籤', groupKey: '', refs: [ref], names: [], detail: '僅有標籤；保留原檔，不建立門市、拜訪或人物連線。' });
    else if (!row.data.name) exceptions.push({ level: '待確認', kind: '缺少名稱', groupKey: '', refs: [ref], names: [], detail: '保留原始座標或文字，須補上名稱或明確排除後才可匯入。' });
    else {
      const group = groups.get(groupKey) || { key: groupKey, names: [], refs: [], rows: [], lists: [], strong: !!strong };
      group.names.push(row.data.name); group.refs.push(ref); group.rows.push(row.key); group.lists.push(file.list); groups.set(groupKey, group);
      if (!strong) exceptions.push({ level: '待確認', kind: '無穩定地點ID', groupKey, refs: [ref], names: [row.data.name], detail: '不能只依名稱、一般搜尋URL或座標自動判為同店；先保留為獨立待核對列。' });
      if (row.reason.includes('非藥局')) exceptions.push({ level: '待確認', kind: '清單範圍', groupKey, refs: [ref], names: [row.data.name], detail: row.reason });
      if (row.note?.trim()) {
        const noteKey = groupKey + ':' + sha(row.note);
        const note = notes.get(noteKey) || { key: noteKey, groupKey, names: [], refs: [], lists: [], text: row.note, cleanedText: row.cleanedNote, sha256: sha(row.note) };
        note.names.push(row.data.name); note.refs.push(ref); note.lists.push(file.list); notes.set(noteKey, note);
      }
    }
  }
  for (const group of groups.values()) {
    group.names = unique(group.names); group.lists = unique(group.lists);
    group.nameConflict = unique(group.names.map(comparisonText)).length > 1;
    if (group.nameConflict) exceptions.push({ level: '待確認', kind: '同ID不同名稱', groupKey: group.key, names: group.names, refs: group.refs, detail: '相同 Google 地點ID，但名稱不一致；僅提出整合候選，不決定正式名稱、不合併既有App門市。' });
    group.status = group.nameConflict || !group.strong ? '待核對門市' : '地點ID一致候選；待App比對';
  }
  const nameGroups = new Map();
  for (const group of groups.values()) for (const name of group.names) { const k = comparisonText(name), matches = nameGroups.get(k) || []; matches.push(group); nameGroups.set(k, matches); }
  for (const [name, matches] of nameGroups) {
    const ids = unique(matches.map(g => g.key));
    if (ids.length > 1) exceptions.push({ level: '待確認', kind: '同名不同ID', groupKey: ids.join('\n'), names: unique(matches.flatMap(g => g.names)), refs: unique(matches.flatMap(g => g.refs)), detail: '名稱相同但地點ID不同或缺少ID；不自動合併。' });
  }
  const noteArray = [...notes.values()].map(n => ({ ...n, names: unique(n.names), lists: unique(n.lists) })), partial = [];
  for (const group of groups.values()) {
    const texts = noteArray.filter(n => n.groupKey === group.key);
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j], lines = a.cleanedText.split('\n').map(l => l.trim()).filter(l => l.length >= 8);
      const shared = unique(lines.filter(l => b.cleanedText.split('\n').map(s => s.trim()).includes(l)));
      const contained = a.cleanedText !== b.cleanedText && (a.cleanedText.includes(b.cleanedText) || b.cleanedText.includes(a.cleanedText));
      if (shared.length || contained || a.cleanedText === b.cleanedText) partial.push({ groupKey: group.key, names: group.names, refsA: a.refs, refsB: b.refs, shared, kind: a.cleanedText === b.cleanedText ? '僅排版差異' : contained ? '全文包含' : '部分整行重疊', action: '保留兩份原文，不自動刪句；清單不是時間序列，待核對後再決定顯示方式。' });
    }
  }
  const controls = files.map(file => {
    const old = previous.filter(p => sourceListKey(p.name) === sourceListKey(file.list));
    const same = old.filter(p => sha(p.bytes) === sha(file.bytes));
    const rows = ledger.filter(r => r.file === file.file);
    return { file: file.file, list: file.list, bytes: file.bytes.length, sha256: sha(file.bytes), rows: rows.length, named: rows.filter(r => r.name).length, noteRows: rows.filter(r => r.textFields.some(f => f.kind === 'note')).length, tagRows: rows.filter(r => r.textFields.some(f => f.kind === 'tag')).length, prior: same[0]?.name || old[0]?.name || '', comparison: same.length ? '逐位元完全相同' : old.length ? '內容有差異' : '未提供同來源前批', headers: file.headers };
  });
  const sourceNotes = ledger.filter(r => r.textFields.some(f => f.kind === 'note')).length;
  return { sopVersion: SOP1_VERSION, status: '待門市核對及裝置App現況比對；尚未匯入、尚未分析或建立關係', appCompared: false, controls, summary: { files: files.length, rows: ledger.length, namedRows: ledger.filter(r => r.name).length, metadataRows: ledger.filter(r => r.metadata).length, unnamedRows: ledger.filter(r => !r.name && !r.metadata).length, candidateGroups: groups.size, sourceNotes, distinctWholeNotes: notes.size, repeatedWholeNoteRows: sourceNotes - notes.size, repeatedWholeNoteGroups: noteArray.filter(n => n.refs.length > 1).length, partialPairs: partial.length, nameConflictGroups: [...groups.values()].filter(g => g.nameConflict).length, noStableIdRows: ledger.filter(r => r.name && !r.mapKey).length, sameAsPriorFiles: controls.filter(c => c.comparison === '逐位元完全相同').length }, groups: [...groups.values()], notes: noteArray, exceptions, partial, ledger };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), current = [], previous = []; let output;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output') output = args[++i];
    else if (args[i] === '--previous') previous.push(args[++i]);
    else if (args[i].startsWith('--')) throw new Error('Unknown argument: ' + args[i]);
    else current.push(args[i]);
  }
  if (!output || !current.length) throw new Error('Usage: node scripts/sop1-audit.mjs --output /private/audit.json [--previous /private/old.csv] /private/new.csv ...');
  const report = await auditCSV(current, previous);
  await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report.summary, null, 2));
}
