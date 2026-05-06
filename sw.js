/**
 * UQU Academic Assistant — Service Worker v2.0
 * Strategy: Cache-First for static, Network-First for API
 */

const CACHE_STATIC  = 'uqu-static-v31';
const CACHE_DYNAMIC = 'uqu-dynamic-v31';

const STATIC_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './chat.html',
  './gpa.html',
  './plan.html',
  './profile.html',
  './locations.html',
  './manifest.json',
  './assets/styles.css',
  './assets/core.js',
  './assets/data-bridge.js',
  './assets/student-model.js',
  './assets/engine.js',
  './assets/actions.js',
  './assets/ai.js',
  './assets/effects.js',
  './assets/charts.js',
  './assets/ux.js',
  './assets/app.js',
  './assets/pomodoro.js',
  './assets/ai-fab.js',
  './assets/notifications.js',
  './assets/neon-grid.js',
  './assets/transcript-parser.js',
  './assets/diagnostics.js',
  './assets/achievements.js',
  './assets/data-io.js',
  './assets/uqu-news.js',
  './assets/chat-widgets.js',
  './assets/auth.js',
  './assets/profile-guard.js',
  './assets/firebase-config.js',
  './assets/firebase-auth.js',
  './assets/firebase-db.js',
  './assets/geo-data.js',
  './assets/live-nav.js',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap'
];

const IS_DEV_INSTALL = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

// ── Install ──
self.addEventListener('install', e => {
  if (IS_DEV_INSTALL) {
    // Dev: skip pre-caching so we never serve stale assets
    e.waitUntil(self.skipWaiting());
    return;
  }
  e.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ──
self.addEventListener('activate', e => {
  const keep = IS_DEV_INSTALL ? [] : [CACHE_STATIC, CACHE_DYNAMIC];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Dev mode: skip caching entirely on localhost so changes are picked up
//    immediately. The SW still installs (so prod behavior is testable) but
//    becomes a pass-through.
const IS_DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

// ── Fetch ──
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // ── NEVER cache non-GET requests (POST, PUT, DELETE, PATCH) ──
  if (request.method !== 'GET') return;

  // ── Dev: always go to network with cache-busting, never serve stale code ──
  if (IS_DEV) {
    e.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(request).then(r => r || new Response('Offline', { status: 503 }))));
    return;
  }

  // API calls → network only (no cache)
  if (
    url.hostname === 'api.anthropic.com'                  ||
    url.hostname === 'integrate.api.nvidia.com'           ||
    url.hostname === 'openrouter.ai'                      ||
    url.hostname === 'generativelanguage.googleapis.com'  ||
    url.hostname.includes('localhost')                    ||
    url.pathname.includes('/v1/')                         ||
    url.pathname.includes('/api/')
  ) {
    return; // pass through
  }

  // Google Fonts → cache first
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // Static assets → cache first, update in background (stale-while-revalidate)
  if (STATIC_ASSETS.some(a => request.url.endsWith(a.replace('./', '')))) {
    e.respondWith(staleWhileRevalidate(request));
    return;
  }

  // HTML navigation → network first, fallback to cache
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => { cacheResponse(request, res.clone(), CACHE_DYNAMIC); return res; })
        .catch(() => caches.match(request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Everything else → cache first
  e.respondWith(cacheFirst(request, CACHE_DYNAMIC));
});

// ── Helpers ──
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cacheResponse(request, response.clone(), cacheName);
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request).then(res => {
    if (res.ok) cacheResponse(request, res.clone(), CACHE_STATIC);
    return res;
  }).catch(() => null);
  return cached || await fetchPromise || new Response('Offline', { status: 503 });
}

async function cacheResponse(request, response, cacheName) {
  if (!response || !response.ok) return;
  // Only cache GET requests — browsers reject PUT on cache.put for non-GET
  if (request.method && request.method !== 'GET') return;
  try {
    const cache = await caches.open(cacheName);
    cache.put(request, response);
  } catch (e) { /* silently ignore cache errors */ }
}

// ── Push notifications ──
self.addEventListener('push', e => {
  const data = e.data?.json?.() ?? { title: 'تنبيه أكاديمي', body: 'لديك تحديث جديد.', icon: './icon-192.png' };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || './icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      badge: './icon-192.png',
      tag: 'uqu-notification',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || './dashboard.html'));
});
