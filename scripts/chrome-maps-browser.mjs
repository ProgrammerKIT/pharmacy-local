import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const DEFAULT_TIMEOUT = 25_000;
const CHROME_PATHS = process.platform === 'darwin' ? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
] : process.platform === 'win32' ? [
  path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
] : ['google-chrome', 'chromium', 'chromium-browser'];

function executable(candidate) {
  if (!candidate) return '';
  if (path.isAbsolute(candidate)) return fs.existsSync(candidate) ? candidate : '';
  const found = spawnSync('which', [candidate], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return found.status === 0 ? found.stdout.trim() : '';
}

export function findChrome(explicit = '') {
  for (const candidate of [explicit, process.env.CHROME_BIN, ...CHROME_PATHS]) {
    const found = executable(candidate);
    if (found) return found;
  }
  throw new Error('找不到 Google Chrome；請先安裝 Chrome，或以 --chrome 指定執行檔。');
}

class DevToolsClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
  }
  async connect() {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('無法連接隔離瀏覽器')), { once: true });
    });
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error('隔離瀏覽器操作失敗'));
      else resolve(message.result || {});
    });
    socket.addEventListener('close', () => {
      this.closed = true;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('隔離瀏覽器已停止'));
      }
      this.pending.clear();
    });
  }
  send(method, params = {}, sessionId = undefined, timeout = 30_000) {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('隔離瀏覽器未連線'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('隔離瀏覽器操作逾時'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() {
    try { this.socket?.close(); } catch { /* already closed */ }
  }
}

async function waitForDevTools(profile, child) {
  const activePort = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw new Error('Chrome 無法啟動隔離查詢');
    try {
      const [port, endpoint] = fs.readFileSync(activePort, 'utf8').trim().split(/\r?\n/);
      if (/^\d+$/.test(port) && endpoint?.startsWith('/')) return `ws://127.0.0.1:${port}${endpoint}`;
    } catch { /* Chrome has not written the endpoint yet. */ }
    await delay(100);
  }
  throw new Error('Chrome 啟動逾時');
}

const renderedExpression = `(() => {
  const clean = value => (value || '').replace(/\\s+/g, ' ').trim();
  const heading = clean(document.querySelector('h1')?.textContent);
  const buttons = [...document.querySelectorAll('button')];
  const addressButton = document.querySelector('button[data-item-id="address"]') || buttons.find(button => clean(button.getAttribute('aria-label')).startsWith('地址:'));
  const label = clean(addressButton?.getAttribute('aria-label'));
  const address = clean(label.replace(/^地址:\\s*/, '') || addressButton?.textContent);
  const body = (document.body?.innerText || '').slice(0, 6000);
  const blocked = /unusual traffic|automated queries|Before you continue to Google|在繼續前往 Google 之前/i.test(body);
  return { heading, address, finalUrl: location.href, ready: document.readyState, blocked };
})()`;

export class ChromeMapsBrowser {
  constructor({ chromePath = '', timeout = DEFAULT_TIMEOUT } = {}) {
    this.chromePath = chromePath;
    this.timeout = timeout;
    this.profile = '';
    this.child = null;
    this.client = null;
    this.targets = new Set();
  }
  async start() {
    const binary = findChrome(this.chromePath);
    this.profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-google-maps-'));
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-sync', '--disable-extensions', '--disable-default-apps', '--disable-component-update',
      '--disable-background-networking', '--disable-client-side-phishing-detection', '--disable-disk-cache',
      '--disk-cache-size=1', '--metrics-recording-only', '--mute-audio', '--no-service-autorun',
      '--password-store=basic', '--use-mock-keychain', '--lang=zh-TW', '--window-size=1280,900',
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${this.profile}`,
      'about:blank',
    ];
    this.child = spawn(binary, args, { stdio: 'ignore' });
    try {
      const endpoint = await waitForDevTools(this.profile, this.child);
      this.client = new DevToolsClient(endpoint);
      await this.client.connect();
      return this;
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async createWorker() {
    if (!this.client) throw new Error('隔離瀏覽器尚未啟動');
    const { targetId } = await this.client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.client.send('Target.attachToTarget', { targetId, flatten: true });
    this.targets.add(targetId);
    await this.client.send('Page.enable', {}, sessionId);
    await this.client.send('Runtime.enable', {}, sessionId);
    return { targetId, sessionId };
  }
  async lookup(worker, sourceUrl) {
    const url = new URL(sourceUrl);
    url.searchParams.set('hl', 'zh-TW');
    url.searchParams.set('gl', 'tw');
    const navigation = await this.client.send('Page.navigate', { url: url.toString() }, worker.sessionId);
    if (navigation.errorText) throw new Error('Google Maps 頁面載入失敗');
    const deadline = Date.now() + this.timeout;
    let last = null;
    while (Date.now() < deadline) {
      try {
        const evaluated = await this.client.send('Runtime.evaluate', { expression: renderedExpression, returnByValue: true }, worker.sessionId, 10_000);
        last = evaluated.result?.value || null;
        if (last?.blocked) throw new Error('Google Maps 暫時阻擋自動查詢，請稍後重試');
        if (last?.heading && last?.address) return last;
      } catch (error) {
        if (/暫時阻擋|隔離瀏覽器/.test(error.message)) throw error;
      }
      await delay(400);
    }
    if (last?.heading) return last;
    throw new Error('Google Maps 頁面載入逾時');
  }
  async closeWorker(worker) {
    if (!worker?.targetId || !this.client) return;
    this.targets.delete(worker.targetId);
    try { await this.client.send('Target.closeTarget', { targetId: worker.targetId }, undefined, 5_000); } catch { /* browser cleanup */ }
  }
  async close() {
    for (const targetId of [...this.targets]) {
      try { await this.client?.send('Target.closeTarget', { targetId }, undefined, 2_000); } catch { /* browser cleanup */ }
    }
    this.targets.clear();
    try { await this.client?.send('Browser.close', {}, undefined, 2_000); } catch { /* browser may close before replying */ }
    this.client?.close();
    this.client = null;
    if (this.child?.exitCode === null) {
      try { this.child.kill('SIGTERM'); } catch { /* process already stopped */ }
      await Promise.race([new Promise(resolve => this.child.once('exit', resolve)), delay(2_000)]);
      if (this.child.exitCode === null) try { this.child.kill('SIGKILL'); } catch { /* process already stopped */ }
    }
    this.child = null;
    if (this.profile) {
      try { fs.rmSync(this.profile, { recursive: true, force: true }); } catch { /* OS will clean its temporary directory */ }
      this.profile = '';
    }
  }
}

export const chromeDefaults = { timeout: DEFAULT_TIMEOUT };
