// All matching runs on the device. Labels describe text evidence, never clinical advice.
export const TOPIC_RULES = [
  { key: 'ortho', name: '角膜塑型片', terms: ['角膜塑型', '角膜塑形', '塑形片', '塑型片'] },
  { key: 'ha', name: '玻尿酸／HA', terms: ['玻尿酸', 'HA', 'HAUD', 'HAMD'] },
  { key: 'price', name: '價格與毛利', terms: ['價格', '比價', '便宜', '毛利', '太貴', '很貴'] },
  { key: 'display', name: '陳列', terms: ['陳列'] },
  { key: 'training', name: '課程與訓練', terms: ['上課', '課程', '訓練', 'CME'] },
  { key: 'sample', name: '試用品', terms: ['試用', 'Sample'] },
  { key: 'preservative', name: '防腐劑', terms: ['防腐'] },
  { key: 'unit', name: '單支包裝', terms: ['單支'] },
  { key: 'cataract', name: '白內障', terms: ['白內障', 'Cata'] },
  { key: 'laser', name: '近視雷射', terms: ['雷射', '雷視'] },
  { key: 'dryeye', name: '乾眼', terms: ['乾眼'] },
  { key: 'rx', name: '處方與診所', terms: ['處方', '眼科', '診所'] },
  { key: 'stock', name: '缺貨與常備', terms: ['缺貨', '常備'] },
  { key: 'elderly', name: '年長客群', terms: ['老人', '年長', '長輩', '老人家'] }
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
export function evidenceKind(text, rule) {
  const lines = matchingLines(text, rule?.terms || []);
  if (!lines.length) return { label: '手動連結', kind: 'manual', lines };
  if (rule.key === 'person-mention') return { label: lines.some(s => /很像|長得像|長的像/.test(s)) ? '含外貌比喻，非人際關係證據' : '同名／稱呼線索，身分未核對', kind: 'question', lines };
  if (rule.key !== 'ortho') return { label: '原文提及', kind: 'mention', lines };
  const negative = lines.filter(s => /沒有角膜|沒有塑[型形]|沒遇到|沒有遇|未遇到|未觀察|無相關/.test(s));
  const question = lines.filter(s => /怎麼用|如何使用|可不可以|能不能|問我/.test(s));
  if (negative.length && negative.length < lines.length) return { label: '正反描述並存', kind: 'mixed', lines };
  if (negative.length) return { label: '含否定／未遇到', kind: 'negative', lines };
  if (question.length) return { label: '詢問／待釐清', kind: 'question', lines };
  return { label: '原文提及', kind: 'mention', lines };
}
export function entityRule(entity) {
  if (!entity) return null;
  if (entity.type === 'person' && entity.mentionTerm) return { key: 'person-mention', terms: [entity.mentionTerm] };
  return TOPIC_RULES.find(t => entity.ruleKey === t.key || entity.type === 'topic' && entity.name === t.name) || null;
}
export function sourceTags(store) {
  return [...new Set((store.csvSources || []).flatMap(s => s.headers.flatMap((h, i) => ['標籤', 'tags', 'label', 'labels'].includes(h.trim().toLowerCase()) && s.cells[i].trim() ? [s.cells[i]] : [])))];
}
