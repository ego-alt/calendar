// Offline support for the calendar.
//
// One cache: the page, our static files (fonts and icons included), and the
// JSON the views read (months, years, days, diary, stats, thumbnails).
// Pages and JSON are network-first (fresh online, last copy offline); static
// files are stale-while-revalidate. Writes (POST/PUT/PATCH/DELETE) are never
// touched: offline, they fail visibly and the entry form keeps its draft.

const CACHE = 'calendar-v4';
const ROOT = new URL(self.registration.scope).pathname;   // ends in "/"
const PASSTHROUGH = ['auth/', 'export', 'sw.js', 'healthz', 'search/data'];
const JSON_ROUTES = ['get_month', 'get_year', 'events', 'attachments', 'stats/data'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((c) => Promise.all([ROOT, `${ROOT}manifest.webmanifest`].map((u) => c.add(u).catch(() => {}))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || !url.pathname.startsWith(ROOT)) return;
    const path = url.pathname.slice(ROOT.length);
    if (PASSTHROUGH.some((p) => path.startsWith(p))) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, ROOT));
    } else if (path.startsWith('static/') || path === 'manifest.webmanifest' || path === 'favicon.ico'
               || /^attachments\/\d+\/thumb$/.test(path)) {
        event.respondWith(staleWhileRevalidate(request));
    } else if (JSON_ROUTES.some((p) => path.startsWith(p))) {
        event.respondWith(networkFirst(request));
    }
});

async function networkFirst(request, fallbackUrl) {
    const cache = await caches.open(CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (err) {
        const cached = await cache.match(request) || (fallbackUrl && await cache.match(fallbackUrl));
        if (cached) return cached;
        throw err;
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
    }).catch(() => cached);
    return cached || network;
}
