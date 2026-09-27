import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coordinateFeature, splitTaiwanAddress, validateStoreEnrichment } from '../public/core.js';
import { ChromeMapsBrowser, chromeDefaults } from './chrome-maps-browser.mjs';

const GOOGLE_HOSTS = new Set(['www.google.com', 'maps.google.com', 'www.google.com.tw', 'maps.google.com.tw']);

export function validateLookupItem(item) {
  if (!item || !/^0x[a-f0-9]+:0x[a-f0-9]+$/.test(item.featureId || '') || typeof item.sourceUrl !== 'string' || item.sourceUrl.length > 2000 || coordinateFeature(item.sourceUrl) !== item.featureId || !Array.isArray(item.sourceNames) || !item.sourceNames.length || item.sourceNames.length > 100 || item.sourceNames.some(name => typeof name !== 'string' || !name.trim() || name.length > 500)) throw new Error('補查清單項目缺少安全的 Google 地點證據');
  const url = new URL(item.sourceUrl);
  if (url.protocol !== 'https:' || !GOOGLE_HOSTS.has(url.hostname) || url.username || url.password || url.port) throw new Error('只允許 Google Maps HTTPS 公開頁面');
  return item;
}

export function parseRenderedGoogleMapsPlace(rendered, requestItem, checkedAt = new Date().toISOString()) {
  validateLookupItem(requestItem);
  if (!rendered || typeof rendered.heading !== 'string' || typeof rendered.address !== 'string' || typeof rendered.finalUrl !== 'string') throw new Error('Google Maps 動態頁面資料不完整');
  if (coordinateFeature(rendered.finalUrl) !== requestItem.featureId) throw new Error('Google 地點識別不一致');
  const googleName = rendered.heading.trim();
  if (googleName !== requestItem.sourceNames[0].trim()) throw new Error('Google 公開名稱與目前門市名稱不同');
  if (!rendered.address.trim()) throw new Error('Google Maps 公開頁面沒有地址欄位');
  if (!splitTaiwanAddress(rendered.address)) throw new Error('Google 公開地址無法拆分縣市與行政區');
  return {
    featureId: requestItem.featureId,
    resolvedUrl: requestItem.sourceUrl,
    googleName,
    sourceNames: [...new Set(requestItem.sourceNames.map(name => name.trim()))],
    address: rendered.address.trim(),
    checkedAt,
  };
}

export async function enrichRequest(request, { lookup, concurrency = 4, retries = 1, onProgress = () => {} } = {}) {
  if (!request || request.format !== 'pharmacy-store-enrichment-request-1' || !Array.isArray(request.items) || !request.items.length || request.items.length > 2000 || typeof lookup !== 'function' || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6 || !Number.isInteger(retries) || retries < 0 || retries > 3) throw new Error('補查清單格式或執行設定不正確');
  const seen = new Set();
  for (const item of request.items) {
    validateLookupItem(item);
    if (seen.has(item.featureId)) throw new Error('補查清單含重複 Google 地點識別');
    seen.add(item.featureId);
  }
  const results = new Array(request.items.length);
  let cursor = 0, completed = 0;
  const worker = async workerIndex => {
    while (true) {
      const index = cursor++;
      if (index >= request.items.length) return;
      const requestItem = request.items[index];
      let error = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const rendered = await lookup(requestItem, { workerIndex, attempt });
          results[index] = { item: parseRenderedGoogleMapsPlace(rendered, requestItem) };
          error = null;
          break;
        } catch (caught) {
          const message = caught instanceof Error && caught.message ? caught.message : 'Google Maps 補查失敗';
          if (/隔離瀏覽器已停止|隔離瀏覽器未連線/.test(message)) throw new Error(message);
          error = new Error(message);
          if (/名稱與目前門市名稱不同|地址無法拆分|地點識別不一致|缺少安全的 Google 地點證據/.test(message)) break;
        }
      }
      if (error) results[index] = { unresolved: { featureId: requestItem.featureId, sourceNames: requestItem.sourceNames, reason: error.message } };
      completed++;
      onProgress({ completed, total: request.items.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, request.items.length) }, (_, index) => worker(index)));
  const output = {
    format: 'pharmacy-store-enrichment-1',
    generatedAt: new Date().toISOString(),
    items: results.flatMap(result => result.item ? [result.item] : []),
    unresolved: results.flatMap(result => result.unresolved ? [result.unresolved] : []),
  };
  validateStoreEnrichment(output);
  return output;
}

function option(args, name, fallback = '') {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const requestPath = option(args, '--request'), outputPath = option(args, '--output');
  const concurrency = Number(option(args, '--concurrency', '4'));
  const timeout = Number(option(args, '--timeout-ms', String(chromeDefaults.timeout)));
  const chromePath = option(args, '--chrome');
  if (!requestPath || !outputPath || args.includes('--help') || !Number.isInteger(timeout) || timeout < 5_000 || timeout > 120_000) throw new Error('用法：npm run enrich -- --request <補查清單.json> --output <補查結果.json> [--concurrency 1-6] [--timeout-ms 5000-120000] [--chrome <執行檔>]');
  if (fs.existsSync(path.resolve(outputPath))) throw new Error('輸出檔案已存在；為避免覆蓋私人資料，請指定新的檔名。');
  const request = JSON.parse(fs.readFileSync(path.resolve(requestPath), 'utf8'));
  const browser = await new ChromeMapsBrowser({ chromePath, timeout }).start();
  const workers = new Map();
  let lastReported = 0;
  let stopping = false;
  const stop = exitCode => {
    if (stopping) return;
    stopping = true;
    browser.close().finally(() => process.exit(exitCode));
  };
  const onInterrupt = () => stop(130);
  const onTerminate = () => stop(143);
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    const result = await enrichRequest(request, {
      concurrency,
      retries: 1,
      lookup: async (item, { workerIndex }) => {
        if (!workers.has(workerIndex)) workers.set(workerIndex, await browser.createWorker());
        return browser.lookup(workers.get(workerIndex), item.sourceUrl);
      },
      onProgress: ({ completed, total }) => {
        if (completed === total || completed - lastReported >= 10) {
          lastReported = completed;
          console.log(`補查進度：${completed}/${total}`);
        }
      },
    });
    const fd = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(result, null, 2)); } finally { fs.closeSync(fd); }
    console.log(`完成：取得 ${result.items.length} 間；待人工核對 ${result.unresolved.length} 間。結果只寫入指定本機檔案。`);
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    for (const worker of workers.values()) await browser.closeWorker(worker);
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
