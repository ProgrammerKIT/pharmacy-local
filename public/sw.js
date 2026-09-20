const VERSION = '1.5.9';
const CACHE = `pharmacy-shell-v${VERSION}`;
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/core.js', '/db.js', '/relations.js', '/csv.js', '/csv-ui.js', '/version.js', '/update-client.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const responses = await Promise.all(ASSETS.map(async asset => {
    const response = await fetch(asset, { cache: 'no-store', redirect: 'error', credentials: 'omit' });
    if (!response.ok || response.headers.get('X-Pharmacy-Version') !== VERSION) throw new Error('Mixed or incomplete release');
    return [asset, response];
  }));
  const cache = await caches.open(CACHE);
  for (const [asset, response] of responses) await cache.put(asset, response);
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = (await caches.keys()).filter(k => k.startsWith('pharmacy-shell-') && k !== CACHE);
  for (const key of keys.slice(0, Math.max(0, keys.length - 1))) await caches.delete(key);
  await self.clients.claim();
})()));
let coordinating = false;
self.addEventListener('message', event => {
  if (event.data?.type !== 'APPLY_WHEN_SAFE' || coordinating) return;
  coordinating = true;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let committed = false;
    try {
      const answers = await Promise.all(windows.map(client => new Promise(resolve => {
        const channel = new MessageChannel();
        const finish = ready => { clearTimeout(timeout); channel.port1.close(); resolve(ready); };
        const timeout = setTimeout(() => finish(false), 2500);
        channel.port1.onmessage = response => finish(response.data?.ready === true);
        client.postMessage({ type: 'UPDATE_PREPARE' }, [channel.port2]);
      })));
      const now = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (answers.every(Boolean) && now.every(c => windows.some(old => old.id === c.id))) { await self.skipWaiting(); committed = true; }
    } finally {
      if (!committed) for (const client of windows) client.postMessage({ type: 'UPDATE_CANCEL' });
      coordinating = false;
    }
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) { event.respondWith(Promise.resolve(Response.error())); return; }
  if (event.request.method !== 'GET' || !ASSETS.includes(url.pathname)) return;
  // Never mix release caches or cache customer data / API responses.
  event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(hit => hit || Response.error()));
});
