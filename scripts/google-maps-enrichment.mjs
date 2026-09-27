import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coordinateFeature, splitTaiwanAddress } from '../public/core.js';

const GOOGLE_HOSTS = new Set(['www.google.com', 'maps.google.com', 'www.google.com.tw', 'maps.google.com.tw']);
const cityPattern = '(?:臺北市|台北市|新北市|桃園市|臺中市|台中市|臺南市|台南市|高雄市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|臺東縣|台東縣|澎湖縣|金門縣|連江縣)';
const addressPattern = new RegExp(`(?:\\d{3,6}\\s*)?${cityPattern}.{1,5}?(?:區|鄉|鎮|市).{1,70}?號(?:之\\d+)?(?:\\d+樓)?`, 'g');

function decodeText(value) {
  return value.replace(/\\u([0-9a-f]{4})/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)));
}
export function parseGoogleMapsPublicPage(html, requestItem) {
  if (typeof html !== 'string' || html.length > 20 * 1024 * 1024) throw new Error('公開頁面內容無法安全解析');
  const decoded = decodeText(html);
  const title = decodeText(decoded.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || decoded.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').replace(/\s*[-–]\s*Google(?: 地圖| Maps).*$/i, '').trim();
  if (!title) throw new Error('公開頁面缺少可核對的門市名稱');
  if (!requestItem.sourceNames.some(name => name.trim() === title)) throw new Error(`公開名稱已變更：${title}`);
  const addresses = [...new Set((decoded.match(addressPattern) || []).map(value => splitTaiwanAddress(value)?.address).filter(Boolean))];
  if (addresses.length !== 1) throw new Error(addresses.length ? '公開頁面出現多個不同地址，需人工核對' : '公開頁面沒有唯一且可拆分的臺灣地址');
  return { featureId: requestItem.featureId, resolvedUrl: requestItem.sourceUrl, googleName: title, sourceNames: [...new Set([...requestItem.sourceNames, title])], address: addresses[0], checkedAt: new Date().toISOString() };
}
export async function fetchGoogleMapsPublicItem(item, fetcher = fetch) {
  if (!item || !/^0x[a-f0-9]+:0x[a-f0-9]+$/.test(item.featureId || '') || coordinateFeature(item.sourceUrl || '') !== item.featureId || !Array.isArray(item.sourceNames) || !item.sourceNames.length) throw new Error('補查清單項目缺少安全的 Google 地點證據');
  const url = new URL(item.sourceUrl); if (url.protocol !== 'https:' || !GOOGLE_HOSTS.has(url.hostname) || url.username || url.password) throw new Error('只允許 Google Maps HTTPS 公開頁面');
  url.searchParams.set('hl', 'zh-TW');
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetcher(url, { redirect: 'follow', credentials: 'omit', signal: controller.signal, headers: { Accept: 'text/html', 'Accept-Language': 'zh-TW,zh;q=0.9' } });
    if (!response.ok) throw new Error(`公開頁面回應 ${response.status}`);
    const type = response.headers.get('content-type') || ''; if (!type.includes('text/html')) throw new Error('公開頁面格式不是 HTML');
    return parseGoogleMapsPublicPage(await response.text(), item);
  } finally { clearTimeout(timeout); }
}
export async function enrichRequest(request, { fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!request || request.format !== 'pharmacy-store-enrichment-request-1' || !Array.isArray(request.items) || !request.items.length || request.items.length > 2000) throw new Error('補查清單格式不正確');
  const items = [], unresolved = [], seen = new Set();
  for (const requestItem of request.items) {
    if (seen.has(requestItem.featureId)) throw new Error('補查清單含重複 Google 地點識別'); seen.add(requestItem.featureId);
    try { items.push(await fetchGoogleMapsPublicItem(requestItem, fetcher)); }
    catch (error) { unresolved.push({ featureId: requestItem.featureId || '', sourceNames: Array.isArray(requestItem.sourceNames) ? requestItem.sourceNames : [], reason: error.message }); }
    if (requestItem !== request.items.at(-1)) await pause(250);
  }
  return { format: 'pharmacy-store-enrichment-1', generatedAt: new Date().toISOString(), items, unresolved };
}

async function main() {
  const args = process.argv.slice(2), requestPath = args[args.indexOf('--request') + 1], outputPath = args[args.indexOf('--output') + 1];
  if (!requestPath || !outputPath || args.includes('--help')) throw new Error('用法：npm run enrich -- --request <補查清單.json> --output <補查結果.json>');
  const request = JSON.parse(fs.readFileSync(path.resolve(requestPath), 'utf8'));
  const result = await enrichRequest(request);
  const fd = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(result, null, 2)); } finally { fs.closeSync(fd); }
  console.log(`完成：取得 ${result.items.length} 間；待人工核對 ${result.unresolved.length} 間。結果只寫入指定本機檔案。`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
