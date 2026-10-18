const CW_NAME = encodeURI(self.location.pathname.split('/').reverse()[1]);
const CACHE = CW_NAME + '-v1';
const PRECACHE_URLS = ["./build/props.js", "./build/tank_station.js", "./index.html", "./tank_station.wjson"];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => { if (e.request.method !== 'GET') return; e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))); });
