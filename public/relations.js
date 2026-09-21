// All matching runs on the device. Labels describe text evidence, never clinical advice.
export function storeIdentityPending(store) {
  return !!store && (store.csvIdentityPending === true || !!store.conflict && (store.heads || []).some(h => h.data.csvIdentityPending === true));
}
export function relationVisitAllowed(visit, stores) {
  const store = stores.find(s => s.id === visit.store);
  return !!store && !storeIdentityPending(store);
}
export const TOPIC_RULES = [
  { key: 'ortho', name: '角膜塑型片', category: '產品／品類', terms: ['角膜塑型', '角膜塑形', '塑形片', '塑型片'] },
  { key: 'ha', name: '玻尿酸／HA', category: '產品／品類', terms: ['玻尿酸', 'HA', 'HAUD', 'HAMD'] },
  { key: 'price', name: '價格與毛利', category: '疑慮／阻力', terms: ['價格', '比價', '便宜', '毛利', '太貴', '很貴'] },
  { key: 'display', name: '陳列', category: '主題／需求', terms: ['陳列'] },
  { key: 'training', name: '課程與訓練', category: '主題／需求', terms: ['上課', '課程', '訓練', 'CME'] },
  { key: 'sample', name: '試用品', category: '產品／品類', terms: ['試用', 'Sample'] },
  { key: 'preservative', name: '防腐劑', category: '產品／品類', terms: ['防腐'] },
  { key: 'unit', name: '單支包裝', category: '產品／品類', terms: ['單支'] },
  { key: 'cataract', name: '白內障', category: '主題／需求', terms: ['白內障', 'Cata'] },
  { key: 'laser', name: '近視雷射', category: '主題／需求', terms: ['雷射', '雷視'] },
  { key: 'dryeye', name: '乾眼', category: '主題／需求', terms: ['乾眼'] },
  { key: 'rx', name: '處方與診所', category: '主題／需求', terms: ['處方', '眼科', '診所'] },
  { key: 'stock', name: '缺貨與常備', category: '疑慮／阻力', terms: ['缺貨', '常備'] },
  { key: 'elderly', name: '年長客群', category: '主題／需求', terms: ['老人', '年長', '長輩', '老人家'] }
];
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function termFound(text, term) {
  return /^[a-z0-9 ]+$/i.test(term)
    ? new RegExp(`(?<![a-z0-9])${reEscape(term)}(?![a-z0-9])`, 'i').test(text)
    : text.includes(term);
}
export function matchingLines(text, terms) {
  return text.split(/\r?\n/).filter(line => terms.some(t => termFound(line, t)));
}
// These are literal, auditable reading aids; mixed/negative language remains visible.
// Status is derived only from wording around a matched term. It never upgrades a mention into a confirmed need.
function lineEvidence(line, rule) {
  const terms = (rule?.terms || []).filter(term => termFound(line, term));
  if (!terms.length) return null;
  if (rule.key === 'person-mention') {
    return /很像|長得像|長的像/.test(line)
      ? { label: '含外貌比喻，非人際關係證據', kind: 'question', line }
      : { label: '同名／稱呼線索，身分未核對', kind: 'question', line };
  }
  const negative = terms.some(term => {
    const index = line.toLowerCase().indexOf(term.toLowerCase());
    if (index < 0) return false;
    const before = line.slice(Math.max(0, index - 12), index);
    const after = line.slice(index + term.length, index + term.length + 12);
    return /(?:沒有|沒遇到|沒有遇到|未遇到|未觀察到|無相關|無此|不需要|未有)\s*$/u.test(before) ||
      /(?:沒有需求|無需求|不需要|未遇到|沒有遇到|沒遇到|未觀察到)/u.test(after);
  });
  if (negative) return { label: '否定／未遇到', kind: 'negative', line };
  if (/[？?]/u.test(line) || /怎麼用|如何使用|可不可以|能不能|是否|詢問|問我|想了解/u.test(line)) return { label: '詢問／待釐清', kind: 'question', line };
  return { label: '原文提及', kind: 'mention', line };
}
export function evidenceKind(text, rule) {
  const lines = matchingLines(text, rule?.terms || []);
  if (!lines.length) return { label: '手動連結', kind: 'manual', lines, items: [] };
  const items = lines.map(line => lineEvidence(line, rule)).filter(Boolean);
  const kinds = new Set(items.map(item => item.kind));
  if (kinds.size > 1) return { label: '正反／多種描述並存', kind: 'mixed', lines, items };
  const first = items[0] || { label: '原文提及', kind: 'mention' };
  return { label: first.label, kind: first.kind, lines, items };
}
export function entityRule(entity) {
  if (!entity) return null;
  if (entity.type === 'person' && entity.mentionTerm) return { key: 'person-mention', terms: [entity.mentionTerm] };
  return TOPIC_RULES.find(t => entity.ruleKey === t.key || entity.type === 'topic' && entity.name === t.name) || null;
}
export function sourceTags(store) {
  return [...new Set((store.csvSources || []).flatMap(s => s.headers.flatMap((h, i) => ['標籤', 'tags', 'label', 'labels'].includes(h.trim().toLowerCase()) && s.cells[i].trim() ? [s.cells[i]] : [])))];
}

const dateKey = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
const candidateSort = (a, b) => (b.latestDate || '').localeCompare(a.latestDate || '') || b.visitCount - a.visitCount || a.name.localeCompare(b.name, 'zh-Hant');
function summarizeCandidate(meta, evidence) {
  const visits = new Set(evidence.map(item => item.visitId));
  const statuses = [...new Set(evidence.map(item => item.kind))];
  const statusLabel = statuses.length > 1 ? '多種原文狀態' : evidence[0]?.label || '原文提及';
  const latestDate = evidence.map(item => dateKey(item.date)).filter(Boolean).sort().at(-1) || '';
  return { ...meta, evidence, visitCount: visits.size, lineCount: evidence.length, latestDate, statusLabel, statusKind: statuses.length > 1 ? 'mixed' : evidence[0]?.kind || 'mention' };
}
// Read-only candidate relations. They are display-time evidence indexes, never stored as confirmed entities.
export function candidateRelationsForStore(storeId, visits, stores, people = []) {
  const store = stores.find(item => item.id === storeId);
  if (!store || storeIdentityPending(store)) return [];
  const eligible = visits.filter(visit => visit.store === storeId && !visit.deleted && !visit.conflict && relationVisitAllowed(visit, stores));
  const output = [];
  for (const rule of TOPIC_RULES) {
    const evidence = [];
    for (const visit of eligible) {
      const found = evidenceKind(visit.text || '', rule);
      for (const item of found.items || []) evidence.push({ visitId: visit.id, date: visit.date || '', source: visit.source || '', field: 'text', line: item.line, label: item.label, kind: item.kind });
    }
    if (evidence.length) output.push(summarizeCandidate({ key: 'topic:' + rule.key, name: rule.name, category: rule.category, ruleKey: rule.key, sourceMode: 'candidate' }, evidence));
  }
  const followups = eligible.filter(visit => String(visit.next || '').trim()).map(visit => ({
    visitId: visit.id, date: visit.date || '', source: visit.source || '', field: 'next', line: visit.next.trim(), label: '已明確填寫', kind: 'explicit'
  }));
  if (followups.length) output.push(summarizeCandidate({ key: 'followup', name: '待跟進事項', category: '待跟進事項', sourceMode: 'explicit' }, followups));
  for (const person of people.filter(item => item.mentionTerm && !item.deleted)) {
    const evidence = [];
    for (const visit of eligible) {
      if ((visit.people || []).includes(person.id)) continue;
      const found = evidenceKind(visit.text || '', { key: 'person-mention', terms: [person.mentionTerm] });
      for (const item of found.items || []) evidence.push({ visitId: visit.id, date: visit.date || '', source: visit.source || '', field: 'text', line: item.line, label: item.label, kind: item.kind });
    }
    if (evidence.length) output.push(summarizeCandidate({ key: 'person:' + person.id, name: person.name, category: '人物提及', personId: person.id, sourceMode: 'candidate' }, evidence));
  }
  return output.sort(candidateSort);
}
export function candidateOverview(visits, stores, people = []) {
  const aggregated = new Map();
  for (const store of stores.filter(item => !item.deleted && !storeIdentityPending(item))) {
    for (const candidate of candidateRelationsForStore(store.id, visits, stores, people)) {
      let item = aggregated.get(candidate.key);
      if (!item) {
        item = { key: candidate.key, name: candidate.name, category: candidate.category, ruleKey: candidate.ruleKey, personId: candidate.personId, sourceMode: candidate.sourceMode, stores: [], storeCount: 0, visitCount: 0, lineCount: 0, latestDate: '' };
        aggregated.set(candidate.key, item);
      }
      item.stores.push({ storeId: store.id, storeName: store.name, visitCount: candidate.visitCount, lineCount: candidate.lineCount, latestDate: candidate.latestDate, statusLabel: candidate.statusLabel, statusKind: candidate.statusKind, evidence: candidate.evidence });
      item.storeCount += 1; item.visitCount += candidate.visitCount; item.lineCount += candidate.lineCount;
      if (candidate.latestDate > item.latestDate) item.latestDate = candidate.latestDate;
    }
  }
  return [...aggregated.values()].sort((a, b) => b.storeCount - a.storeCount || b.visitCount - a.visitCount || (b.latestDate || '').localeCompare(a.latestDate || '') || a.name.localeCompare(b.name, 'zh-Hant'));
}
export function candidateTrend(candidate, now = new Date()) {
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const currentStart = new Date(end); currentStart.setDate(currentStart.getDate() - 29); currentStart.setHours(0, 0, 0, 0);
  const previousStart = new Date(currentStart); previousStart.setDate(previousStart.getDate() - 30);
  const seenCurrent = new Set(), seenPrevious = new Set(), currentStores = new Set(), previousStores = new Set();
  for (const store of candidate?.stores || []) for (const evidence of store.evidence || []) {
    if (!dateKey(evidence.date)) continue;
    const when = new Date(evidence.date + 'T12:00:00');
    if (when >= currentStart && when <= end) { seenCurrent.add(evidence.visitId); currentStores.add(store.storeId); }
    else if (when >= previousStart && when < currentStart) { seenPrevious.add(evidence.visitId); previousStores.add(store.storeId); }
  }
  return { currentVisits: seenCurrent.size, previousVisits: seenPrevious.size, currentStores: currentStores.size, previousStores: previousStores.size };
}

// Read-only name-based channels. This is not store identity or corporate ownership.
// Only 佑全 / 健康人生 is a user-confirmed cross-name equivalence.
export const RETAIL_CHANNELS = Object.freeze([
  ['great-tree', '大樹', ['大樹']],
  ['you-chuan', '佑全／健康人生', ['佑全', '健康人生']],
  ['yes-chain', '躍獅', ['躍獅']],
  ['medcon', '美康', ['美康']],
  ['ding-ding', '丁丁', ['丁丁']],
  ['bo-yu', '博昱', ['博昱']],
  ['pro-chain', '專品', ['專品']],
  ['fu-kang', '富康', ['富康']],
  ['tien-kang', '天康', ['天康']],
  ['woodpecker', '博登', ['博登']],
  ['cosmed', '康是美', ['康是美']],
  ['jian-xiang', '建祥', ['建祥']],
  ['ri-sen', '日森人文', ['日森人文']],
  ['jie-deng', '婕登', ['婕登']],
  ['hong-yue', '宏越', ['宏越']],
  ['kang-zhi-you', '康之友', ['康之友']],
].map(([id, label, prefixes]) => Object.freeze({ id, label, prefixes: Object.freeze(prefixes) })));
const NAME_HEADERS = ['title', '標題', '地點名稱', '藥局名稱', '門市名稱', 'name', '名稱'];
const nameKey = value => String(value || '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
export function originalStoreNames(store) {
  const versions = [store, ...(store.conflict ? (store.heads || []).filter(h => !h.deleted).map(h => h.data) : [])];
  const sourceNames = versions.flatMap(s => (s.csvSources || []).flatMap(source => {
    // Prefer the original title when a CSV contains more than one name-like column.
    const headers = (source.headers || []).map(h => String(h).trim().toLowerCase());
    const index = NAME_HEADERS.map(h => headers.indexOf(h)).find(i => i >= 0 && String(source.cells?.[i] || '').trim());
    return index === undefined ? [] : [source.cells[index]];
  }));
  const aliases = versions.flatMap(s => s.csvAliases || []).filter(s => s.trim());
  return [...new Set(sourceNames.length ? sourceNames : aliases.length ? aliases : versions.map(s => s.name).filter(Boolean))];
}
export function retailChannel(store) {
  const names = originalStoreNames(store);
  const matches = RETAIL_CHANNELS.filter(group => names.some(name => {
    const title = nameKey(name).split(/[|｜]/u)[0];
    return group.prefixes.some(prefix => title.startsWith(prefix) &&
      (title === prefix || /藥局|藥妝|藥房/.test(title) || /^[-—–(]/u.test(title.slice(prefix.length))));
  }));
  if (matches.length > 1) return { id: 'pending', label: '通路待確認', names, candidates: matches.map(g => g.label) };
  if (!matches.length) return { id: 'ungrouped', label: '未分群', names, candidates: [] };
  return { id: matches[0].id, label: matches[0].label, names, candidates: [] };
}
export function filterStoreDirectory(stores, visits, filters = {}) {
  const query = String(filters.query || '').trim().toLowerCase(), selected = new Set(filters.groups || []);
  const active = stores.filter(s => !s.deleted || s.conflict), visitText = new Map();
  for (const visit of visits) {
    if (visit.deleted && !visit.conflict) continue;
    visitText.set(visit.store, (visitText.get(visit.store) || '') + '\n' + (visit.text || '') + '\n' + (visit.googleText || ''));
  }
  const entries = active.map(store => ({ store, group: retailChannel(store) }));
  const base = entries.filter(({ store: s, group }) => (!filters.district || s.district === filters.district) &&
    (!filters.kind || s.channel === filters.kind) && (!query ||
      [s.name, ...group.names, group.label, s.city, s.district, s.attr, s.contact, s.address, ...(s.lists || []), ...sourceTags(s), visitText.get(s.id)].join('\n').toLowerCase().includes(query)));
  const counts = new Map();
  for (const entry of base) counts.set(entry.group.id, (counts.get(entry.group.id) || 0) + 1);
  const groups = [...RETAIL_CHANNELS, { id: 'pending', label: '通路待確認' }, { id: 'ungrouped', label: '未分群' }]
    .filter((g, i) => i < 3 || counts.has(g.id) || selected.has(g.id)).map(g => ({ id: g.id, label: g.label, count: counts.get(g.id) || 0 }));
  return { entries: base.filter(e => !selected.size || selected.has(e.group.id)), groups, total: active.length, matchedBeforeGroups: base.length };
}

// A read-only evidence view, NOT a store/visit merge. Never infer event identity.
export function groupCSVNotes(visits) {
  const groups = new Map(), output = [];
  for (const visit of visits) {
    const eligible = visit.csvSources?.length && visit.googleText !== undefined && visit.text === visit.googleText && visit.text.trim() && !visit.conflict && !visit.googleUpdatePending && !visit.deleted;
    if (!eligible) { output.push(visit); continue; }
    const signature = JSON.stringify([visit.store, visit.text, visit.date || '', !!visit.sourceMissing, [...(visit.topics || [])].sort(), [...(visit.people || [])].sort(), visit.next || '', visit.attachments || [], (visit.csvSources || []).flatMap(s => s.supplements || [])]);
    const found = groups.get(signature);
    if (found) found.evidenceMembers.push(visit);
    else { const group = { ...visit, evidenceMembers: [visit] }; groups.set(signature, group); output.push(group); }
  }
  return output;
}
