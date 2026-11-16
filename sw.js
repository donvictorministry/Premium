/* MISSION NOTE service worker: offline app shell, runtime caching, update management, periodic background analytics. */
const VERSION = 'mission-note-v1.0.0';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'api.js', 'rich-text.js', 'editor.js', 'account.js', 'pin.js', 'qrcode.js', 'share.js', 'page-cover.js', 'manifest.json'];
const CDN = ['https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'];
const NEVER_CACHE = ['script.google.com', 'script.googleusercontent.com', 'ipapi.co', 'placehold.co'];
const SLOT = 6 * 3600 * 1000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await Promise.all(CDN.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && c.put(u, r)).catch(() => {})));
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (NEVER_CACHE.some(h => url.hostname.endsWith(h))) return;
  if (req.mode === 'navigate') { e.respondWith(shell(req)); return; }
  if (url.origin === location.origin) { e.respondWith(swr(req)); return; }
  if (CDN.includes(req.url)) { e.respondWith(cacheFirst(req)); }
});
async function shell(req) {
  const c = await caches.open(VERSION);
  const hit = (await c.match('index.html')) || (await c.match('./'));
  const net = fetch(req).then(r => { if (r.ok) c.put('index.html', r.clone()); return r; }).catch(() => null);
  return hit || (await net) || new Response('Offline', { status: 503 });
}
async function swr(req) {
  const c = await caches.open(VERSION), hit = await c.match(req);
  const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || new Response('', { status: 504 });
}
async function cacheFirst(req) {
  const c = await caches.open(VERSION), hit = await c.match(req.url); if (hit) return hit;
  try { const r = await fetch(req.url, { mode: 'cors' }); if (r.ok) c.put(req.url, r.clone()); return r; } catch (e) { return new Response('', { status: 504 }); }
}

/* ---- scheduled execution where supported (Periodic Background Sync) ---- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('missionnote', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onupgradeneeded = () => { r.transaction.abort(); }; });
const kvGet = async k => { try { const d = await idb(); return await new Promise(res => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result ? q.result.v : undefined); q.onerror = () => res(undefined); }); } catch (e) { return undefined; } };
const kvSet = async (k, v) => { try { const d = await idb(); await new Promise(res => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put({ k, v }); t.oncomplete = res; t.onerror = res; }); } catch (e) {} };

async function backgroundAnalytics() {
  const api = await kvGet('apiUrl'), dev = await kvGet('device'), sched = (await kvGet('sched')) || {}, ses = await kvGet('session');
  if (!api || api.indexOf('PASTE') === 0 || !dev || Date.now() - (sched.analytics || 0) < SLOT - 60000) return;
  let g = {};
  try { const r = await fetch('https://ipapi.co/json/', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); g = { city: j.city, region: j.region, country: j.country_name, isp: j.org, timezone: j.timezone }; } } catch (e) {}
  g.language = self.navigator.language; g.platform = 'Android'; g.ua = self.navigator.userAgent; g.screen = '';
  try {
    const r = await fetch(api, { method: 'POST', body: JSON.stringify({ action: 'analytics', event: 'scheduled-bg', device: dev.id, token: ses && ses.exp > Date.now() ? ses.token : undefined, a: g }) });
    const j = await r.json(); if (j.ok) { sched.analytics = Date.now(); await kvSet('sched', sched); }
  } catch (e) {}
}
self.addEventListener('periodicsync', e => {
  if (e.tag !== 'mn-schedule') return;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window' });
    if (list.length) list.forEach(c => c.postMessage({ type: 'RUN_SCHEDULE' }));
    else await backgroundAnalytics(); // sync and restore need the app: they run as catch-up when it opens
  })());
});
