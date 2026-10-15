// Synthetic-only interactive keyboard-pan regression. No App database, API or external network.
// node test/qa/keyboard-pan-fixture.mjs --self-test
// node test/qa/keyboard-pan-fixture.mjs -> http://127.0.0.1:18870/
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 18870;
function extract(source) {
  const start = source.indexOf('function installPhoneEditingViewport() {');
  const end = source.indexOf('\nlet key =', start);
  assert.ok(start >= 0 && end > start, 'The actual viewport controller must be present');
  const controller = source.slice(start, end);
  assert.ok(controller.endsWith('installPhoneEditingViewport();'));
  return controller;
}
const current = extract(await fs.readFile(path.join(root, 'public/app.js'), 'utf8'));
const baselineCommit = '2f85058f52ffc6778240bc0ab6fcdc1fd8709df0';
const baseline = extract(execFileSync('git', ['show', baselineCommit + ':public/app.js'], { cwd: root, encoding: 'utf8' }));
const css = await fs.readFile(path.join(root, 'public/style.css'));
const words = Array.from({ length: 42 }, (_, i) => `${String(i + 1).padStart(2, '0')}｜完全虛構驗收文字。保留原文、選取及換行；這裡不是客戶資料。`).join('\n');
const escapeHTML = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function bootstrap() {
  const viewport = new EventTarget();
  Object.assign(viewport, { height: window.innerHeight, width: 393, offsetTop: 0, offsetLeft: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  const nativeScrollBy = window.scrollBy.bind(window);
  const nativeScrollTo = window.scrollTo.bind(window);
  const scrollCalls = [];
  window.scrollBy = (...args) => {
    const delta = typeof args[0] === 'object' ? args[0].top : args[1];
    const before = window.scrollY;
    nativeScrollBy(...args);
    scrollCalls.push({ delta, before, after: window.scrollY });
  };
  window.qa = { viewport, scrollCalls, nativeScrollTo, frameHeight: window.innerHeight };
}

function harness(mode) {
  const { viewport, scrollCalls, nativeScrollTo, frameHeight } = window.qa;
  const editor = document.getElementById('fixture-note');
  const original = editor.textContent;
  let running = false;
  const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 25))));
  function caret() {
    const selection = getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.focusNode)) return null;
    const range = selection.getRangeAt(0).cloneRange(); range.collapse(false);
    let rect = range.getBoundingClientRect();
    if (!rect.height) {
      let node = range.startContainer, offset = range.startOffset;
      if (node.nodeType !== Node.TEXT_NODE) {
        const previous = offset > 0;
        node = node.childNodes[previous ? offset - 1 : 0];
        while (node?.[previous ? 'lastChild' : 'firstChild']) node = node[previous ? 'lastChild' : 'firstChild'];
        offset = previous ? node?.textContent?.length || 0 : 0;
      }
      if (node?.nodeType === Node.TEXT_NODE && node.textContent.length) {
        range.setStart(node, Math.max(0, offset - 1)); range.setEnd(node, Math.max(1, offset));
        rect = range.getBoundingClientRect();
      } else if (node?.tagName === 'BR') rect = node.getBoundingClientRect();
    }
    return { top: rect.top, bottom: rect.bottom, height: rect.height, offset: selection.focusOffset };
  }
  function report(label, extra = {}) {
    const message = { type: 'keyboard-fixture-report', mode, label, ...extra,
      data: { originalTextUnchanged: editor.textContent === original, originalCharacters: original.length, currentCharacters: editor.textContent.length,
        storage: '未建立／讀取任何 App 資料庫、localStorage、IndexedDB 或 API。文字只存在此合成畫面。' },
      geometry: { viewportTop: viewport.offsetTop, viewportHeight: viewport.height, scrollY: window.scrollY,
        dockTop: document.querySelector('.inline-edit-actions').getBoundingClientRect().top, caret: caret(),
        cssVisibleBottom: document.documentElement.style.getPropertyValue('--phone-visible-bottom') } };
    parent.postMessage(message, location.origin);
  }
  async function keyboard(open) {
    viewport.height = open ? 400 : frameHeight; viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('resize')); await settle();
    report(open ? '模擬鍵盤已展開；仍可直接在文字框輸入。' : '模擬鍵盤已收合。');
  }
  async function prepare() {
    await keyboard(false);
    editor.focus({ preventScroll: true });
    const range = document.createRange();
    let last = editor.lastChild;
    while (last?.lastChild) last = last.lastChild;
    if (last?.nodeType === Node.TEXT_NODE) range.setStart(last, last.textContent.length);
    else range.selectNodeContents(editor);
    range.collapse(false);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    await settle();
    // Position the real DOM caret before opening the simulated keyboard.
    nativeScrollTo({ top: window.scrollY + caret().top - 250, behavior: 'instant' });
    await keyboard(true);
    // One explicit input intent enables assistance; no note text is changed.
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '' }));
    await settle();
  }
  async function run() {
    if (running) return;
    running = true;
    try {
      await prepare();
      const before = { text: editor.textContent, selection: getSelection().focusOffset, scrollY: window.scrollY, calls: scrollCalls.length };
      const trace = [];
      // Simulate repeated native visual-viewport panning with an unchanged selection.
      // Rects and window scrolling remain real browser DOM geometry, never mocked.
      for (let i = 0; i < 20; i++) {
        viewport.offsetTop = i % 2 ? 0 : 280;
        viewport.dispatchEvent(new Event('scroll'));
        document.dispatchEvent(new Event('selectionchange'));
        await settle();
        trace.push({ step: i + 1, viewportTop: viewport.offsetTop, scrollY: window.scrollY, caretTop: caret()?.top,
          scrollCalls: scrollCalls.length - before.calls });
      }
      const corrections = scrollCalls.length - before.calls;
      const unchanged = editor.textContent === before.text && getSelection().focusOffset === before.selection;
      report(corrections ? '重現：相同選取的 viewport pan 仍觸發程式捲動。' : '通過：20 次 pan＋相同選取通知沒有新增程式捲動。', {
        outcome: corrections === 0 && unchanged ? 'stable' : 'feedback', corrections, unchangedDuringRun: unchanged,
        scrollRange: Math.max(...trace.map(t => t.scrollY)) - Math.min(...trace.map(t => t.scrollY)),
        trace, correctionsTrace: scrollCalls.slice(before.calls) });
    } catch (error) { report('測試發生錯誤：' + error.message, { outcome: 'error' }); }
    finally { running = false; }
  }
  window.addEventListener('message', async event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'keyboard-fixture-action') return;
    if (event.data.action === 'run') await run();
    if (event.data.action === 'open' && !running) { await prepare(); report('已定位到合成文字末尾；可直接編輯。'); }
    if (event.data.action === 'close' && !running) await keyboard(false);
  });
  editor.addEventListener('input', () => setTimeout(() => { if (!running) report('合成文字已輸入；不寫入 App。'); }, 80));
  report('準備就緒，請執行連續 pan 測試。');
}

function page(mode) {
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>鍵盤位移驗收｜合成資料</title>
<style>body{font:16px/1.55 system-ui;margin:20px;background:#edf4f5;color:#16303b}h1{font-size:22px}.tools{display:flex;flex-wrap:wrap;gap:8px}button,a{font:inherit;padding:10px;border:1px solid #8da8aa;border-radius:8px;background:white;color:#075b59;cursor:pointer;text-decoration:none}.active{background:#087a72;color:white}.grid{display:flex;gap:20px;flex-wrap:wrap;margin-top:16px}.phone{width:393px;height:700px;border:2px solid #37575c;border-radius:12px;background:white}.result{flex:1;min-width:260px;max-width:650px;background:white;border-radius:12px;padding:16px;overflow-wrap:anywhere}pre{white-space:pre-wrap;font-size:13px}.notice{max-width:1000px}.pass{color:#087a40}.fail{color:#a34320}</style>
<h1>鍵盤捲動回授驗收 · ${mode === 'baseline' ? '修改前' : '目前修正'}</h1><p class="notice">完全虛構文字；只載入實際 CSS 與鍵盤版面控制器，沒有啟動 App、資料庫或同步。這是瀏覽器的模擬鍵盤，<strong>不是 iPhone 真機驗收</strong>。</p>
<div class="tools"><a class="${mode === 'baseline' ? 'active' : ''}" href="/?mode=baseline">修改前 baseline</a><a class="${mode === 'current' ? 'active' : ''}" href="/?mode=current">目前修正 current</a><button data-action="open">展開模擬鍵盤／定位原文</button><button data-action="close">收合模擬鍵盤</button><button data-action="run">執行 20 次 pan＋相同選取</button></div>
<p>預期：修改前會重現額外捲動；目前修正應為 0 次。兩者都必須保持文字與選取不變。可點文字框手動輸入，輸入後「原文一致」為否屬預期；重新選版本可重設。</p>
<div class="grid"><iframe class="phone" src="/frame.html?mode=${mode}" title="393px 合成手機編輯區"></iframe><section class="result"><h2 id="status">載入中</h2><p id="summary"></p><details><summary>幾何與每一步結果</summary><pre id="report"></pre></details><small>baseline 來源：本機 v1.5.69 commit ${baselineCommit}</small></section></div>
<script src="/parent.js"></script></html>`;
}
function frame(mode) {
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=393,initial-scale=1"><title>合成編輯區</title><link rel="stylesheet" href="/style.css">
<style>body{display:block!important;margin:0!important}#qa-padding{height:120px}#visit-list{padding:16px}.fixture-footer{height:950px}.inline-edit-actions{left:12px!important;right:12px!important;width:auto!important;max-width:none!important}.fixture-label{padding:16px;font-size:15px}.inline-edit-text{white-space:pre-wrap!important;line-height:1.65!important;font-size:17px!important;min-height:100px}</style>
<div class="fixture-label">合成藥局原文 · ${mode} · 可以直接輸入</div><div id="qa-padding"></div><div id="visit-list"><article class="panel"><h3>虛構門市：鍵盤版面驗收</h3><div class="inline-edit-shell editing"><div id="fixture-note" class="inline-edit-text" data-inline-edit-text="qa-keyboard-note" contenteditable="true" role="textbox" aria-multiline="true" aria-label="完全虛構的測試原文">${escapeHTML(words)}</div><div class="inline-edit-actions"><p class="muted">合成保存列；沒有任何儲存功能。</p><button type="button">合成取消</button><button type="button" class="primary">合成檢查並儲存</button></div></div></article></div><div class="fixture-footer"></div><script src="/frame.js?mode=${mode}"></script></html>`;
}
const parentScript = `const frame=document.querySelector('iframe');document.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>frame.contentWindow.postMessage({type:'keyboard-fixture-action',action:button.dataset.action},location.origin));window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='keyboard-fixture-report')return;const data=event.data;const status=document.getElementById('status');status.textContent=data.label;status.className=data.outcome==='stable'?'pass':data.outcome==='feedback'?'fail':'';document.getElementById('summary').textContent=(data.corrections===undefined?'':'程式捲動 '+data.corrections+' 次；')+'原始合成文字一致：'+(data.data.originalTextUnchanged?'是':'否（若手動輸入過屬預期）')+'。'+data.data.storage;document.getElementById('report').textContent=JSON.stringify(data,null,2);});`;

if (process.argv.includes('--self-test')) {
  assert.ok(current.includes("viewport?.addEventListener('scroll'"));
  assert.ok(baseline.includes('installPhoneEditingViewport'));
  assert.ok(css.includes(Buffer.from('--phone-visible-bottom')));
  assert.ok(!current.includes('commitRevision('));
  assert.ok(!current.includes('indexedDB'));
  assert.ok(!baseline.includes('fetch('));
  assert.ok(frame('current').includes('contenteditable="true"'));
  console.log('PASS: actual current/baseline controller extraction; actual CSS; synthetic-only content; no App runtime/database; fixed loopback server.');
} else {
  const server = http.createServer((req, res) => {
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) { res.writeHead(403).end(); return; }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const url = new URL(req.url, `http://127.0.0.1:${port}`), mode = url.searchParams.get('mode') === 'baseline' ? 'baseline' : 'current';
    const routes = {
      '/': ['text/html; charset=utf-8', page(mode)], '/qa.html': ['text/html; charset=utf-8', page(mode)],
      '/frame.html': ['text/html; charset=utf-8', frame(mode)], '/style.css': ['text/css; charset=utf-8', css],
      '/parent.js': ['text/javascript; charset=utf-8', parentScript],
      '/frame.js': ['text/javascript; charset=utf-8', `(${bootstrap.toString()})();\n${mode === 'baseline' ? baseline : current}\n(${harness.toString()})(${JSON.stringify(mode)});`]
    };
    const route = routes[url.pathname];
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; frame-ancestors 'self'; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!route) { res.writeHead(404).end('No App/API/static access is available.'); return; }
    res.writeHead(200, { 'Content-Type': route[0] }).end(route[1]);
  });
  server.listen(port, '127.0.0.1', () => console.log(`Synthetic keyboard fixture: http://127.0.0.1:${port}/\nBaseline: ${baselineCommit}\nNo App database, production API or external connections.`));
}
