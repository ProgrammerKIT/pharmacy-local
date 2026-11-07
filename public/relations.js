import { project, validateBundle, revision, uuid, hashBytes, b64, MAX_BYTES, peopleRelationshipReviewState, peopleAliasReviewState, peopleAliasGroups } from './core.js';
// All matching runs on the device. Labels describe text evidence, never clinical advice.
export function storeIdentityPending(store) {
  return !!store && (store.csvIdentityPending === true || !!store.conflict && (store.heads || []).some(h => h.data.csvIdentityPending === true));
}
export function relationVisitAllowed(visit, stores) {
  const store = stores.find(s => s.id === visit.store);
  return !!store && !storeIdentityPending(store);
}
// Auditable business vocabulary used only to read existing visit text.
// These definitions never expand, replace, or write back the user's original wording.
export const DOMAIN_GLOSSARY = Object.freeze([
  { key: 'complete', name: 'C／Complete／康復力（康富力）', category: '產品／品類', definition: 'C、Complete、康復力與康富力皆指同一項產品。', aliases: ['C', 'Complete', '康復力', '康富力'] },
  { key: 'ha', name: '玻尿酸／HA', category: '產品／品類', definition: 'HA 指玻尿酸；HAMD 指玻尿酸瓶裝；HAUD 指玻尿酸單支裝。', aliases: ['玻尿酸', 'HA', 'HAMD', 'HAUD'] },
  { key: 'dose-md', name: 'MD／瓶裝', category: '產品／劑型', definition: 'MD 指瓶裝；HAMD 是玻尿酸瓶裝。', aliases: ['MD', 'HAMD'] },
  { key: 'dose-ud', name: 'UD／單支裝', category: '產品／劑型', definition: 'UD 指單支裝；HAUD 是玻尿酸單支裝。', aliases: ['UD', 'HAUD'] },
  { key: 'dose-mdpf', name: 'MDPF／無防腐劑瓶裝', category: '產品／劑型', definition: 'MDPF 指瓶裝且不含防腐劑。', aliases: ['MDPF'] },
  { key: 'nv', name: 'N＋V／白內障術後用藥', category: '產品／品類', definition: 'N＋V 指白內障術後用藥。', aliases: ['N＋V', 'N+V'] },
  { key: 'p2', name: 'P2／第二大產品分類', category: '產品／分類', definition: 'P2 指業務產品的第二大分類。', aliases: ['P2'] },
  { key: 'artificial-tears', name: 'AF／AT／人工淚液', category: '產品／品類', definition: 'AF 與 AT 都指人工淚液。', aliases: ['AF', 'AT', '人工淚液'] },
  { key: 'dt', name: 'DT／淚膜藥膏', category: '產品／品類', definition: 'DT 指淚膜藥膏。', aliases: ['DT', '淚膜藥膏'] },
  { key: 'ao', name: 'AO／AO 清潔液', category: '產品／品類', definition: 'AO 指 AO 清潔液。', aliases: ['AO', 'AO 清潔液'] },
  { key: 'potential', name: 'P／Potential／Pool', category: '客戶／潛力', definition: 'P、Potential 與 Pool 表示潛力大或小。', aliases: ['P', 'Potential', 'Pool'] },
  { key: 'training', name: 'CME／現場上課', category: '主題／需求', definition: 'CME 與 C M E 都指現場上課。', aliases: ['CME', 'C M E', '現場上課', '上課', '課程', '訓練'] },
  { key: 'ka', name: 'KA／關鍵決策人', category: '人物／角色', definition: 'KA 指關鍵決策人。', aliases: ['KA', '關鍵決策人'] },
  { key: 'rtd', name: 'RTD／大型活動', category: '活動／作業', definition: 'RTD 指大型活動。', aliases: ['RTD', '大型活動'] },
  { key: 'dk', name: 'DK／大昌物流', category: '通路／作業', definition: 'DK 指大昌物流。', aliases: ['DK', '大昌物流'] },
  { key: 'notfieyes', name: 'NotfiEYES／回報系統', category: '系統／作業', definition: 'NotfiEYES 指回報系統。', aliases: ['NotfiEYES'] },
  { key: 'offtake', name: 'offtake／門市實質銷售', category: '銷售／指標', definition: 'offtake 與 off-take 都指門市的實質銷售。', aliases: ['offtake', 'off-take'] },
  { key: 'part-time', name: 'pt／part-time／兼職', category: '人物／角色', definition: 'pt 與 Pt 都指 part-time，也就是兼職。', aliases: ['pt', 'part-time', '兼職'] },
  { key: 'cataract', name: 'Cata／白內障', category: '主題／需求', definition: 'Cata 指白內障。', aliases: ['Cata', '白內障'] },
  { key: 'tn', name: 'TN／淚然瓶裝 15 ml', category: '產品／品類', definition: 'TN 指淚然瓶裝 15 ml。', aliases: ['TN'] },
  { key: 'tnf', name: 'TNF／TNF32／淚然單支裝 32 入', category: '產品／品類', definition: 'TNF 與 TNF32 都指淚然單支裝 32 入。', aliases: ['TNF', 'TNF32'] },
].map(item => Object.freeze({ ...item, aliases: Object.freeze([...item.aliases]) })));
const glossaryRule = key => {
  const item = DOMAIN_GLOSSARY.find(entry => entry.key === key);
  if (!item) throw new Error(`Missing domain glossary rule: ${key}`);
  return { key: item.key, name: item.name, category: item.category, definition: item.definition, terms: [...item.aliases] };
};
export const TOPIC_RULES = [
  { key: 'ortho', name: '角膜塑型片', category: '產品／品類', terms: ['角膜塑型', '角膜塑形', '塑形片', '塑型片'] },
  ...['complete', 'ha', 'dose-md', 'dose-ud', 'dose-mdpf', 'nv', 'p2', 'artificial-tears', 'dt', 'ao', 'potential'].map(glossaryRule),
  { key: 'price', name: '價格與毛利', category: '主題／需求', terms: ['價格', '比價', '便宜', '毛利', '太貴', '很貴'], candidateTerms: ['價格', '比價', '便宜', '毛利'] },
  { key: 'display', name: '陳列', category: '主題／需求', terms: ['陳列'] },
  ...['training', 'ka', 'rtd', 'dk', 'notfieyes', 'offtake', 'part-time', 'cataract', 'tn', 'tnf'].map(glossaryRule),
  { key: 'sample', name: '試用品', category: '產品／品類', terms: ['試用', 'Sample'] },
  { key: 'preservative', name: '防腐劑', category: '產品／品類', terms: ['防腐'] },
  { key: 'unit', name: '單支包裝', category: '產品／品類', terms: ['單支'] },
  { key: 'laser', name: '近視雷射', category: '主題／需求', terms: ['雷射', '雷視'] },
  { key: 'dryeye', name: '乾眼', category: '主題／需求', terms: ['乾眼'] },
  { key: 'rx', name: '處方與診所', category: '主題／需求', terms: ['處方', '眼科', '診所'] },
  { key: 'stock', name: '缺貨與常備', category: '主題／需求', terms: ['缺貨', '常備'], candidateTerms: ['常備'] },
  { key: 'elderly', name: '年長客群', category: '主題／需求', terms: ['老人', '年長', '長輩', '老人家'] }
];
const EXTRA_CANDIDATE_RULES = [
  { key: 'price-resistance', name: '價格阻力', category: '疑慮／阻力', terms: ['太貴', '很貴'] },
  { key: 'stock-shortage', name: '缺貨', category: '疑慮／阻力', terms: ['缺貨'] }
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
  const statuses = [...new Set(evidence.map(item => item.kind))], labels = [...new Set(evidence.map(item => item.label))];
  const mixed = statuses.length > 1 || labels.length > 1;
  const statusLabel = mixed ? '多種原文狀態' : evidence[0]?.label || '原文提及';
  const latestDate = evidence.map(item => dateKey(item.date)).filter(Boolean).sort().at(-1) || '';
  return { ...meta, evidence, visitCount: visits.size, lineCount: evidence.length, latestDate, statusLabel, statusKind: mixed ? 'mixed' : evidence[0]?.kind || 'mention' };
}
// Display-only grouping. It treats only Unicode width/case and whitespace differences as equivalent.
// Every original value remains in occurrences; punctuation and wording differences stay separate.
const briefComparisonKey = value => String(value || '').normalize('NFKC').replace(/\r\n?/gu, '\n')
  .split('\n').map(line => line.trim().replace(/[ \t]+/gu, ' ')).join('\n').trim().toLocaleLowerCase('zh-Hant');
export function groupVisitBriefText(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const exact = String(entry.text || ''), key = briefComparisonKey(exact) || `__empty__:${entry.visitId}`;
    if (!groups.has(key)) groups.set(key, { ...entry, text: exact.trim(), occurrences: [] });
    groups.get(key).occurrences.push({ ...entry, text: exact });
  }
  return [...groups.values()].map(group => ({
    ...group,
    count: group.occurrences.length,
    topics: [...new Set(group.occurrences.flatMap(item => item.topics || []))],
    people: [...new Set(group.occurrences.flatMap(item => item.people || []))],
  }));
}
// Read-only candidate relations. They are display-time evidence indexes, never stored as confirmed entities.
export function candidateRelationsForStore(storeId, visits, stores, people = []) {
  const store = stores.find(item => item.id === storeId);
  if (!store || storeIdentityPending(store)) return [];
  const eligible = visits.filter(visit => visit.store === storeId && !visit.deleted && !visit.conflict && relationVisitAllowed(visit, stores));
  const output = [];
  for (const baseRule of [...TOPIC_RULES, ...EXTRA_CANDIDATE_RULES]) {
    const rule = baseRule.candidateTerms ? { ...baseRule, terms: baseRule.candidateTerms } : baseRule;
    const evidence = [];
    for (const visit of eligible) {
      const visitText = String(visit.text || ''), found = evidenceKind(visitText, rule);
      for (const item of found.items || []) evidence.push({ visitId: visit.id, date: visit.date || '', source: visit.source || '', field: 'text', line: item.line, visitText, label: item.label, kind: item.kind });
    }
    if (evidence.length) output.push(summarizeCandidate({ key: 'topic:' + rule.key, name: rule.name, category: rule.category, definition: rule.definition || '', ruleKey: TOPIC_RULES.some(item => item.key === rule.key) ? rule.key : undefined, sourceMode: 'candidate' }, evidence));
  }
  const followups = eligible.filter(visit => String(visit.next || '').trim()).map(visit => ({
    visitId: visit.id, date: visit.date || '', source: visit.source || '', field: 'next', line: visit.next.trim(), visitText: String(visit.text || ''), label: '已明確填寫', kind: 'explicit'
  }));
  if (followups.length) output.push(summarizeCandidate({ key: 'followup', name: '待跟進事項', category: '待跟進事項', sourceMode: 'explicit' }, followups));
  for (const person of people.filter(item => item.mentionTerm && !item.deleted)) {
    const evidence = [];
    for (const visit of eligible) {
      if ((visit.people || []).includes(person.id)) continue;
      const visitText = String(visit.text || ''), found = evidenceKind(visitText, { key: 'person-mention', terms: [person.mentionTerm] });
      for (const item of found.items || []) evidence.push({ visitId: visit.id, date: visit.date || '', source: visit.source || '', field: 'text', line: item.line, visitText, label: item.label, kind: item.kind });
    }
    if (evidence.length) output.push(summarizeCandidate({ key: 'person:' + person.id, name: person.name, category: '人物提及', personId: person.id, sourceMode: 'candidate' }, evidence));
  }
  return output.sort(candidateSort);
}

// A display-time visit brief. It contains only existing, traceable fields and never writes a summary back.
export function visitBriefForStore(storeId, visits, stores, people = [], limits = {}) {
  const store = stores.find(item => item.id === storeId);
  if (!store || store.deleted || store.conflict || storeIdentityPending(store)) return null;
  const eligible = visits.filter(visit => visit.store === storeId && !visit.deleted && !visit.conflict && relationVisitAllowed(visit, stores))
    .slice().sort((a, b) => (dateKey(b.date) || '').localeCompare(dateKey(a.date) || '') || String(b.id).localeCompare(String(a.id)));
  const followupLimit = Math.max(1, limits.followups || 5), recentLimit = Math.max(1, limits.recent || 3), candidateLimit = Math.max(1, limits.candidates || 8);
  const followups = groupVisitBriefText(eligible.filter(visit => String(visit.next || '').trim()).map(visit => ({
    visitId: visit.id, date: dateKey(visit.date), source: visit.source || '', text: String(visit.next || ''), visitText: String(visit.text || '')
  }))).slice(0, followupLimit);
  const recent = groupVisitBriefText(eligible.slice(0, recentLimit).map(visit => ({
    visitId: visit.id, date: dateKey(visit.date), source: visit.source || '', text: String(visit.text || ''),
    people: [...(visit.people || [])], topics: [...(visit.topics || [])]
  })));
  const explicitMap = new Map();
  for (const visit of eligible) for (const [type, ids] of [['person', visit.people || []], ['topic', visit.topics || []]]) for (const id of new Set(ids)) {
    const key = `${type}:${id}`;
    if (!explicitMap.has(key)) explicitMap.set(key, { type, id, occurrences: [] });
    explicitMap.get(key).occurrences.push({ visitId: visit.id, date: dateKey(visit.date), source: visit.source || '', text: String(visit.text || '') });
  }
  const explicitLinks = [...explicitMap.values()].map(item => ({ ...item, visitCount: item.occurrences.length }));
  const candidates = candidateRelationsForStore(storeId, visits, stores, people)
    .filter(item => item.key !== 'followup').slice(0, candidateLimit);
  return { store, visitCount: eligible.length, latestDate: eligible.map(visit => dateKey(visit.date)).find(Boolean) || '', followups, candidates, recent, explicitLinks };
}
export function candidateOverview(visits, stores, people = []) {
  const aggregated = new Map();
  for (const store of stores.filter(item => !item.deleted && !storeIdentityPending(item))) {
    for (const candidate of candidateRelationsForStore(store.id, visits, stores, people)) {
      let item = aggregated.get(candidate.key);
      if (!item) {
        item = { key: candidate.key, name: candidate.name, category: candidate.category, definition: candidate.definition || '', ruleKey: candidate.ruleKey, personId: candidate.personId, sourceMode: candidate.sourceMode, stores: [], storeCount: 0, visitCount: 0, lineCount: 0, latestDate: '' };
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

const canonicalCity = value => String(value || '').trim().replace(/^台/u, '臺');
const canonicalDistrict = value => String(value || '').trim();
const safeRegionalStore = store => !!store && !store.deleted && !store.conflict && !storeIdentityPending(store);

export function regionalOptions(stores) {
  const cities = new Map();
  for (const store of stores.filter(safeRegionalStore)) {
    const city = canonicalCity(store.city), district = canonicalDistrict(store.district);
    if (!city) continue;
    if (!cities.has(city)) cities.set(city, { city, count: 0, districts: new Map() });
    const entry = cities.get(city); entry.count++;
    if (district) entry.districts.set(district, (entry.districts.get(district) || 0) + 1);
  }
  return [...cities.values()].map(entry => ({
    city: entry.city,
    count: entry.count,
    districts: [...entry.districts].map(([district, count]) => ({ district, count })).sort((a, b) => a.district.localeCompare(b.district, 'zh-Hant')),
  })).sort((a, b) => a.city.localeCompare(b.city, 'zh-Hant'));
}

function regionalSignal(meta, regionStores, comparisonStores, scopeTotal, comparisonTotal) {
  const regionStoreCount = regionStores.length, comparisonStoreCount = comparisonStores.length;
  const regionRate = scopeTotal ? regionStoreCount / scopeTotal : 0;
  const comparisonRate = comparisonTotal ? comparisonStoreCount / comparisonTotal : 0;
  const difference = regionRate - comparisonRate;
  const enoughComparison = comparisonTotal >= 2;
  const distinctive = regionStoreCount >= 2 && enoughComparison && (comparisonStoreCount === 0 || difference >= 0.15 && regionRate >= comparisonRate * 1.5);
  const concentrationLabel = distinctive
    ? comparisonStoreCount === 0 ? '區域獨有線索' : '區域較集中'
    : regionStoreCount >= 2 ? '區域內共同出現' : '單店線索';
  const allEvidence = regionStores.flatMap(store => store.evidence || []);
  const statusCounts = {};
  for (const evidence of allEvidence) statusCounts[evidence.kind || 'unknown'] = (statusCounts[evidence.kind || 'unknown'] || 0) + 1;
  const visitCount = new Set(allEvidence.map(item => item.visitId)).size;
  const latestDate = allEvidence.map(item => dateKey(item.date)).filter(Boolean).sort().at(-1) || '';
  return { ...meta, regionStores, comparisonStores, regionStoreCount, comparisonStoreCount, regionRate, comparisonRate, difference, distinctive, concentrationLabel, visitCount, lineCount: allEvidence.length, latestDate, statusCounts };
}

const REGIONAL_STOP_WORDS = new Set(['我們','你們','他們','這個','那個','這邊','這裡','目前','已經','還是','就是','覺得','可以','可能','因為','所以','但是','然後','以及','而且','如果','沒有','不是','很多','比較','一個','一次','今天','昨天','明天','店裡','門市','藥局','客人','客戶','藥師','使用','需要','知道','提供','產品','問題','附近','現在','時候','自己','對方','有點','應該','不會','不能','不要','一起','這次','下次']);
const REGIONAL_KNOWN_TERMS = new Set([...TOPIC_RULES, ...EXTRA_CANDIDATE_RULES].flatMap(rule => rule.terms).map(term => term.normalize('NFKC').toLocaleLowerCase('zh-Hant')));
const regionalSegmenter = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter('zh-Hant', { granularity: 'word' }) : null;
function regionalWords(text) {
  const raw = String(text || '').normalize('NFKC');
  const segments = regionalSegmenter ? [...regionalSegmenter.segment(raw)].filter(item => item.isWordLike).map(item => item.segment) : raw.match(/[A-Za-z][A-Za-z0-9-]{1,23}|[\p{Script=Han}]{2,8}/gu) || [];
  return [...new Set(segments.map(word => word.trim()).filter(word => {
    const normalized = word.toLocaleLowerCase('zh-Hant');
    return normalized.length >= 2 && normalized.length <= 24 && !REGIONAL_STOP_WORDS.has(word) && !REGIONAL_KNOWN_TERMS.has(normalized) && !/^\d+(?:[./:-]\d+)*$/u.test(word);
  }))];
}

// Read-only regional comparison. It only indexes current safe records and retains evidence links.
// A repeated mention measures concentration of wording, not demand, acceptance, or causation.
export function regionalInsights(cityInput, districtInput, visits, stores, people = [], topics = []) {
  const city = canonicalCity(cityInput), district = canonicalDistrict(districtInput);
  if (!city) return null;
  const before = stores.filter(store => canonicalCity(store.city) === city && (!district || canonicalDistrict(store.district) === district));
  const safeStores = stores.filter(safeRegionalStore), scopeStores = safeStores.filter(store => canonicalCity(store.city) === city && (!district || canonicalDistrict(store.district) === district));
  const comparisonStores = district
    ? safeStores.filter(store => canonicalCity(store.city) === city && canonicalDistrict(store.district) && canonicalDistrict(store.district) !== district)
    : safeStores.filter(store => canonicalCity(store.city) && canonicalCity(store.city) !== city);
  const scopeIds = new Set(scopeStores.map(store => store.id)), comparisonIds = new Set(comparisonStores.map(store => store.id));
  const usableVisits = visits.filter(visit => !visit.deleted && !visit.conflict && relationVisitAllowed(visit, safeStores));
  const scopeVisits = usableVisits.filter(visit => scopeIds.has(visit.store));
  const comparisonVisits = usableVisits.filter(visit => comparisonIds.has(visit.store));
  const candidateMap = new Map(), comparisonCandidateMap = new Map();
  const addCandidate = (map, store, candidate) => {
    if (!candidate.key.startsWith('topic:')) return;
    if (!map.has(candidate.key)) map.set(candidate.key, { key: 'candidate:' + candidate.key, candidateKey: candidate.key, name: candidate.name, category: candidate.category, definition: candidate.definition || '', sourceMode: 'candidate', stores: [] });
    map.get(candidate.key).stores.push({ storeId: store.id, storeName: store.name, visitCount: candidate.visitCount, latestDate: candidate.latestDate, statusLabel: candidate.statusLabel, statusKind: candidate.statusKind, evidence: candidate.evidence.map(item => ({ ...item, storeId: store.id, storeName: store.name })) });
  };
  for (const store of scopeStores) for (const candidate of candidateRelationsForStore(store.id, scopeVisits, scopeStores, people)) addCandidate(candidateMap, store, candidate);
  for (const store of comparisonStores) for (const candidate of candidateRelationsForStore(store.id, comparisonVisits, comparisonStores, people)) addCandidate(comparisonCandidateMap, store, candidate);
  const candidateSignals = [...candidateMap.entries()].map(([key, item]) => regionalSignal(item, item.stores, comparisonCandidateMap.get(key)?.stores || [], scopeStores.length, comparisonStores.length));

  const validTopics = new Map(topics.filter(topic => !topic.deleted && !topic.conflict).map(topic => [topic.id, topic]));
  const explicitFor = (sourceVisits, ids) => {
    const map = new Map();
    for (const visit of sourceVisits) for (const topicId of visit.topics || []) {
      const topic = validTopics.get(topicId); if (!topic || !ids.has(visit.store)) continue;
      if (!map.has(topicId)) map.set(topicId, { key: 'explicit:' + topicId, topicId, name: topic.name, category: '已明確連結主題', sourceMode: 'explicit', stores: new Map() });
      const item = map.get(topicId), store = stores.find(value => value.id === visit.store);
      if (!item.stores.has(visit.store)) item.stores.set(visit.store, { storeId: visit.store, storeName: store?.name || '', evidence: [] });
      item.stores.get(visit.store).evidence.push({ storeId: visit.store, storeName: store?.name || '', visitId: visit.id, date: visit.date || '', source: visit.source || '', field: 'topic', line: visit.text || '', label: '已明確連結', kind: 'explicit' });
    }
    return map;
  };
  const explicitMap = explicitFor(scopeVisits, scopeIds), comparisonExplicitMap = explicitFor(comparisonVisits, comparisonIds);
  const explicitSignals = [...explicitMap.entries()].map(([topicId, item]) => regionalSignal({ ...item, stores: undefined }, [...item.stores.values()], [...(comparisonExplicitMap.get(topicId)?.stores.values() || [])], scopeStores.length, comparisonStores.length));
  const literalFor = (sourceVisits, ids) => {
    const map = new Map();
    for (const visit of sourceVisits) {
      if (!ids.has(visit.store)) continue;
      const store = stores.find(value => value.id === visit.store);
      for (const line of String(visit.text || '').split(/\r?\n/u).filter(Boolean)) for (const term of regionalWords(line)) {
        const key = term.toLocaleLowerCase('zh-Hant');
        if (!map.has(key)) map.set(key, { key: 'literal:' + key, term, name: term, category: '未預設的跨店字詞', sourceMode: 'literal', stores: new Map() });
        const item = map.get(key);
        if (!item.stores.has(visit.store)) item.stores.set(visit.store, { storeId: visit.store, storeName: store?.name || '', evidence: [] });
        item.stores.get(visit.store).evidence.push({ storeId: visit.store, storeName: store?.name || '', visitId: visit.id, date: visit.date || '', source: visit.source || '', field: 'text', line, label: '相同字詞', kind: 'literal' });
      }
    }
    return map;
  };
  const literalMap = literalFor(scopeVisits, scopeIds), comparisonLiteralMap = literalFor(comparisonVisits, comparisonIds);
  const emergingSignals = [...literalMap.entries()].map(([term, item]) => regionalSignal({ ...item, stores: undefined }, [...item.stores.values()], [...(comparisonLiteralMap.get(term)?.stores.values() || [])], scopeStores.length, comparisonStores.length)).filter(item => item.regionStoreCount >= 2);
  const sortSignals = (a, b) => Number(b.distinctive) - Number(a.distinctive) || b.difference - a.difference || b.regionStoreCount - a.regionStoreCount || b.visitCount - a.visitCount || a.name.localeCompare(b.name, 'zh-Hant');
  candidateSignals.sort(sortSignals); explicitSignals.sort(sortSignals); emergingSignals.sort(sortSignals);
  const storeProfiles = scopeStores.map(store => ({
    storeId: store.id, storeName: store.name, attr: String(store.attr || '').trim(), channel: String(store.channel || '').trim(), tags: sourceTags(store),
  })).filter(store => store.attr || store.tags.length).sort((a, b) => a.storeName.localeCompare(b.storeName, 'zh-Hant'));
  const channels = new Map();
  for (const store of scopeStores) { const label = retailChannel(store).label; channels.set(label, (channels.get(label) || 0) + 1); }
  return {
    city, district, label: district ? `${city} ${district}` : city,
    comparisonLabel: district ? `${city}其他行政區` : '其他縣市',
    storeCount: scopeStores.length,
    comparisonStoreCount: comparisonStores.length,
    excludedStoreCount: Math.max(0, before.length - scopeStores.length),
    visitCount: scopeVisits.length,
    datedVisitCount: scopeVisits.filter(visit => dateKey(visit.date)).length,
    storesWithVisits: new Set(scopeVisits.map(visit => visit.store)).size,
    latestDate: scopeVisits.map(visit => dateKey(visit.date)).filter(Boolean).sort().at(-1) || '',
    candidateSignals, explicitSignals, emergingSignals: emergingSignals.slice(0, 30), storeProfiles,
    channels: [...channels].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hant')),
  };
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


// Update state is separate from the analysis provider. A timer completing is
// never evidence that all current source versions were actually analyzed.
export const PEOPLE_BRIEF_FORMAT = 'people-reading-1';
export const PEOPLE_ALIAS_POLICY = 'context-alias-1';
export function peopleBriefSourcePlan(storeId, visits, stores) {
  const store=stores.find(s=>s.id===storeId);
  if (!safeRegionalStore(store)) throw new Error('門市身分或版本尚待核對，未更新人物速覽。');
  const selected=visits.filter(v=>v.store===storeId && !v.deleted).slice().sort((a,b)=>a.id.localeCompare(b.id));
  if (selected.some(v=>v.conflict||v.googleUpdatePending||v.heads?.length!==1)) throw new Error('本店筆記來源尚待核對，保留上一份速覽。');
  const sources=selected.map(v=>({visitId:v.id,revisionId:v.heads[0].id,text:String(v.text||''),source:v.source||'',date:v.date||''}));
  // Include the store head: review/relationship changes must invalidate a view
// even if visit text did not change. No source date is inferred from op.at.
  const basis=JSON.stringify([PEOPLE_BRIEF_FORMAT,store.id,(store.heads||[]).map(h=>h.id).sort(),sources,PEOPLE_ALIAS_POLICY]);
  return {format:PEOPLE_BRIEF_FORMAT,storeId,basis,sources};
}
export function validatePeopleBriefResult(plan, result) {
  if (!result || result.format!==PEOPLE_BRIEF_FORMAT || result.storeId!==plan.storeId || result.basis!==plan.basis || !Array.isArray(result.coveredRevisions) || JSON.stringify(result.coveredRevisions.slice().sort())!==JSON.stringify(plan.sources.map(s=>s.revisionId).sort()) || !Array.isArray(result.people)) throw new Error('人物速覽未完整涵蓋這次來源版本。');
  if(new Set(result.people.map(p=>p?.name)).size!==result.people.length)throw new Error('人物稱呼重複，未完成整理。');
  if(result.people.length>100||JSON.stringify(result).length>500000)throw new Error('人物速覽超出範圍。');
  const sourceMap=new Map(plan.sources.map(s=>[s.revisionId,s]));
  for (const person of result.people) {
    if (!person || typeof person.name!=='string'||!person.name.trim()||!Array.isArray(person.items)||!person.items.length||(person.kind!==undefined&&!['local','historical','mentioned','uncertain'].includes(person.kind))) throw new Error('人物速覽格式不完整。');
    if(person.name.length>100||!plan.sources.some(s=>s.text.includes(person.name))||person.items.length>100||person.candidateGroup!==undefined&&(typeof person.candidateGroup!=='string'||person.candidateGroup.length>100))throw new Error('人物稱呼或疑似同人分組不完整。');
    if(person.candidateReason!==undefined&&(!person.candidateGroup||typeof person.candidateReason!=='string'||!person.candidateReason.trim()||person.candidateReason.length>3000))throw new Error('疑似同人理由不完整。');
    for (const item of person.items) {
      if(!item||typeof item!=='object'||Object.keys(item).some(k=>!['category','text','evidence'].includes(k))||item.category!==undefined&&!['background','interaction','relationship','topic'].includes(item.category))throw new Error('整理不可新增人工判斷或其他欄位。');
      if (typeof item.text!=='string'||!item.text.trim()||!Array.isArray(item.evidence)||!item.evidence.length) throw new Error('人物整理缺少原文依據。');
      const quoteText=item.evidence.map(e=>e.quote||'').join('\n');
      if(/[？?]|好像|可能|應該|感覺|不知道/u.test(quoteText)&&!/[？?]|好像|可能|應該|感覺|不知道|不確定|未核實|待核對|未確認|詢問|曾問|提問/u.test(item.text))throw new Error('原文的不確定性不能變成肯定事實。');
      if(/共事|同事|與.+同店/u.test(item.text)&&!/共事|同事|一起上班|同時間|同時/u.test(quoteText)&&!/不代表|未確認|不能|未明|尚不/u.test(item.text))throw new Error('任職背景不能直接推定同事關係。');
      for (const evidence of item.evidence) {
        if(!evidence||typeof evidence!=='object'||Object.keys(evidence).some(k=>!['visitId','revisionId','quote'].includes(k)))throw new Error('來源依據格式不完整。');
        const source=sourceMap.get(evidence.revisionId);
        if (!source || source.visitId!==evidence.visitId || typeof evidence.quote!=='string'||!evidence.quote.trim()||!source.text.includes(evidence.quote)) throw new Error('人物速覽的引句或來源版本不相符。');
      }
    }
  }
  // Identity merges and review decisions are never accepted from an analyzer.
  if (Object.keys(result).some(k=>!['format','storeId','basis','coveredRevisions','people'].includes(k)) || result.people.some(p=>Object.keys(p).some(k=>!['name','items','kind','candidateGroup','candidateReason'].includes(k)))) throw new Error('分析結果不可變更人物身分或人工判斷。');
  return structuredClone(result);
}

export function peopleReadingSources(bundle,storeId) {
  return project(bundle).filter(r=>r.type==='source'&&!r.deleted&&r.peopleReading?.storeId===storeId);
}
export function currentPeopleReading(bundle,storeId) {
  const history=peopleReadingSources(bundle,storeId),superseded=new Set(history.flatMap(s=>s.peopleReading.replaces));
  const heads=history.filter(s=>!superseded.has(s.id));
  return {history,heads,current:heads.length===1?heads[0]:null,conflict:heads.length>1};
}
export function peopleAliasLayout(result,reviewFor=()=>null) {
  const ranks=['local','historical','mentioned','uncertain'],used=new Set(),units=[];
  const groups=peopleAliasGroups(result);
  for(let index=0;index<result.people.length;index++){
    if(used.has(index))continue;
    const group=groups.find(g=>g.includes(index)),state=group?reviewFor(group):null;
    const indices=group&&state?.status!=='rejected'?group:[index];
    indices.forEach(i=>used.add(i));
    // Presentation only: grouping never changes a person's original kind.
    const kind=ranks.find(k=>indices.some(i=>(result.people[i].kind||'uncertain')===k));
    units.push({indices,kind,state,group:indices.length>1});
  }
  return units;
}
export function peopleReadingRequest(bundle,storeId) {
  const records=project(bundle),store=records.find(r=>r.type==='store'&&r.id===storeId);
  const plan=peopleBriefSourcePlan(storeId,records.filter(r=>r.type==='visit'),records.filter(r=>r.type==='store'));
  if(!plan.sources.length)throw new Error('本店尚無可整理的拜訪原文。');
  if(plan.sources.length>100||plan.sources.reduce((n,s)=>n+s.text.length,0)>100000)throw new Error('單店來源過多，請先分批核對；未截斷內容。');
  return {format:'pharmacy-people-request-1',vaultId:bundle.vaultId,store:{id:storeId,name:store.name},plan,
    instructions:'僅整理本店人物閱讀速覽；逐份完整閱讀原文。主動檢視字形相近、同音或異寫稱呼，但姓名相似本身不足以判定同人；必須有角色、互動或明確敘事延續等原句支持且無明確矛盾，才把各原稱呼分開保留並填同一candidateGroup及candidateReason（說明具體脈絡與仍未確定之處）。只有姓名相似或多人歧義就不分組、不猜填；沒有候選也正常。不得跨店憑同名或同區合併，不輸出人工確認或正式合併。區分本店local、歷史historical、跨店mentioned、稱呼不明uncertain，不為了排版改分類。每項category為background/interaction/relationship/topic，text保留疑問與不確定，evidence逐字引用visitId、revisionId、quote；不推定角色、年份或固定性格，不改人工判斷或待辦。完整核對來源但不必每項都形成摘要。回傳 {format:pharmacy-people-review-1,vaultId,result:{format:people-reading-1,storeId,basis,coveredRevisions,people:[{name,kind,candidateGroup可省略,candidateReason可省略,items:[{category,text,evidence}]}]}}，basis與版本照原資料，不增加其他欄位。'};
}
export function preparePeopleReading(bundle,input) {
  validateBundle(bundle);
  if(!input||input.format!=='pharmacy-people-review-1'||input.vaultId!==bundle.vaultId||Object.keys(input).some(k=>!['format','vaultId','result'].includes(k)))throw new Error('人物整理檔案或資料庫不相符。');
  const request=peopleReadingRequest(bundle,input.result?.storeId),result=validatePeopleBriefResult(request.plan,input.result);
  if(result.people.some(p=>!['local','historical','mentioned','uncertain'].includes(p.kind)||p.items.some(i=>!['background','interaction','relationship','topic'].includes(i.category))))throw new Error('人物分類與內容類別必須完整。');
  const previous=currentPeopleReading(bundle,result.storeId);
  return {storeId:result.storeId,storeName:request.store.name,result,previous:previous.current?.peopleReading.result||null,previousMode:previous.current?.peopleReading.mode||'manual',priorResults:previous.heads.map(s=>s.peopleReading.result),replaces:previous.heads.map(s=>s.id).sort(),conflict:previous.conflict};
}
export async function applyPeopleReading(bundle,input,expected,device,approvedAt=new Date().toISOString(),mode='manual') {
  const plan=preparePeopleReading(bundle,input);
  if(JSON.stringify(plan)!==JSON.stringify(expected))throw new Error('核對期間來源或整理紀錄已更新，請重新預覽。');
  if(!device||!['manual','automatic'].includes(mode)||!Number.isFinite(Date.parse(approvedAt)))throw new Error('裝置或確認時間不完整。');
  const next=structuredClone(bundle),bytes=new TextEncoder().encode(JSON.stringify(input)),blob=await hashBytes(bytes);
  if(plan.previous&&JSON.stringify(plan.previous)===JSON.stringify(plan.result)&&(plan.previousMode==='manual'||mode==='automatic'))throw new Error('這份人物速覽已保存，不重複新增。');
  next.schema=Math.max(2,next.schema);next.blobs[blob]=b64(bytes);
  next.ops.push(revision('source',uuid(),{file:'人物速覽.json',list:'人工核對人物速覽',blob,batch:uuid(),rows:plan.result.people.length,headers:[],encoding:'UTF-8',delimiter:'',peopleReading:{format:'pharmacy-reviewed-reading-1',storeId:plan.storeId,basis:plan.result.basis,result:plan.result,replaces:plan.replaces,...(mode==='automatic'?{mode,generatedAt:approvedAt}:{approvedAt})}},[],device));
  return validateBundle(next);
}

export function planPeopleRelationshipReview(bundle, readingId, personIndex, itemIndex, status) {
  validateBundle(bundle);
  if(!['confirmed','rejected','pending'].includes(status))throw new Error('請選擇確定、否定或待確認。');
  const state=peopleRelationshipReviewState(bundle,readingId,personIndex,itemIndex),storeId=state.reading.storeId;
  const saved=currentPeopleReading(bundle,storeId),request=peopleReadingRequest(bundle,storeId);
  if(saved.conflict||saved.current?.id!==readingId||state.reading.basis!==request.plan.basis)throw new Error('速覽或來源已變更，請先重新整理核對；舊判斷與原文保留。');
  return {vaultId:bundle.vaultId,storeId,storeName:request.store.name,readingId,personIndex,itemIndex,status,
    beforeStatus:state.conflict?'conflict':state.status||'unreviewed',personName:state.person.name,item:structuredClone(state.item),
    basis:request.plan.basis,replaces:state.heads.map(o=>o.entity).sort(),changed:state.conflict||state.status!==status};
}
export async function applyPeopleRelationshipReview(bundle, expected, device, reviewedAt=new Date().toISOString()) {
  if(!expected)throw new Error('缺少關係審核預覽。');
  const plan=planPeopleRelationshipReview(bundle,expected.readingId,expected.personIndex,expected.itemIndex,expected.status);
  if(JSON.stringify(plan)!==JSON.stringify(expected))throw new Error('核對期間關係判斷或來源已變更，請重新核對。');
  if(!plan.changed)return bundle;
  if(typeof device!=='string'||!device.trim()||device.length>100||!Number.isFinite(Date.parse(reviewedAt)))throw new Error('裝置或核對時間不完整。');
  const event={format:'pharmacy-people-relationship-review-1',readingId:plan.readingId,personIndex:plan.personIndex,itemIndex:plan.itemIndex,
    status:plan.status,replaces:plan.replaces,reviewedAt,reviewedBy:'Kit'};
  const next=structuredClone(bundle),bytes=new TextEncoder().encode(JSON.stringify(event)),blob=await hashBytes(bytes);
  next.schema=Math.max(2,next.schema);next.blobs[blob]=b64(bytes);
  const op=revision('source',uuid(),{file:'人物關係審核.json',list:'逐筆人物關係審核',blob,batch:uuid(),rows:1,headers:[],encoding:'UTF-8',delimiter:'',peopleRelationshipReview:event},[],device);
  op.at=reviewedAt;next.ops.push(op);
  if(new TextEncoder().encode(JSON.stringify(next)).length>MAX_BYTES)throw new Error('資料已達24 MB上限；舊歷史完整保留，本次尚未保存。');
  return validateBundle(next);
}

export function planPeopleAliasReview(bundle,readingId,personIndices,status,primaryName='') {
  validateBundle(bundle);
  if(!['confirmed','rejected','pending'].includes(status))throw new Error('請選擇同一人、不同人或待確認。');
  const state=peopleAliasReviewState(bundle,readingId,personIndices),storeId=state.reading.storeId;
  const saved=currentPeopleReading(bundle,storeId),request=peopleReadingRequest(bundle,storeId);
  if(saved.conflict||saved.current?.id!==readingId||state.reading.basis!==request.plan.basis)throw new Error('速覽或來源已變更，請重新整理核對；原判斷保留。');
  if(status==='confirmed'&&!state.people.some(p=>p.name===primaryName)||status!=='confirmed'&&primaryName!=='')throw new Error('請選擇這組人物的主要稱呼。');
  return {vaultId:bundle.vaultId,storeId,storeName:request.store.name,readingId,personIndices:personIndices.slice(),status,primaryName,
    beforeStatus:state.conflict?'conflict':state.status||'unreviewed',beforePrimaryName:state.primaryName,
    people:structuredClone(state.people),basis:request.plan.basis,replaces:state.heads.map(o=>o.entity).sort(),
    changed:state.conflict||state.status!==status||state.primaryName!==primaryName};
}
export async function applyPeopleAliasReview(bundle,expected,device,reviewedAt=new Date().toISOString()) {
  if(!expected)throw new Error('缺少同人審核預覽。');
  const plan=planPeopleAliasReview(bundle,expected.readingId,expected.personIndices,expected.status,expected.primaryName);
  if(JSON.stringify(plan)!==JSON.stringify(expected))throw new Error('核對期間人物、來源或判斷已變更，請重新核對。');
  if(!plan.changed)return bundle;
  if(typeof device!=='string'||!device.trim()||device.length>100||!Number.isFinite(Date.parse(reviewedAt)))throw new Error('裝置或確認時間不完整。');
  const event={format:'pharmacy-people-alias-review-1',readingId:plan.readingId,personIndices:plan.personIndices,status:plan.status,primaryName:plan.primaryName,replaces:plan.replaces,reviewedAt,reviewedBy:'Kit'};
  const next=structuredClone(bundle),bytes=new TextEncoder().encode(JSON.stringify(event)),blob=await hashBytes(bytes);
  next.schema=Math.max(2,next.schema);next.blobs[blob]=b64(bytes);
  const op=revision('source',uuid(),{file:'人物同人審核.json',list:'人物別名審核',blob,batch:uuid(),rows:1,headers:[],encoding:'UTF-8',delimiter:'',peopleAliasReview:event},[],device);
  op.at=reviewedAt;next.ops.push(op);
  if(new TextEncoder().encode(JSON.stringify(next)).length>MAX_BYTES)throw new Error('資料已達24 MB上限；原歷史完整保留，本次尚未保存。');
  return validateBundle(next);
}
