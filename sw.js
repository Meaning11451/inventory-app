// ============================================
// Service Worker - 离线缓存 + 网络恢复
// ============================================

const APP_VERSION = 'v2';
const CACHE_NAME = `inventory-app-${APP_VERSION}`;
const API_CACHE_NAME = `inventory-api-${APP_VERSION}`;

// 预缓存的 App Shell 资源
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/supabase.js',
  '/js/parser.js',
  '/js/store.js',
  '/js/sync.js',
  '/manifest.json'
];

// ==================== Install ====================

self.addEventListener('install', (event) => {
  console.log('[SW] Install', APP_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching app shell');
      return cache.addAll(APP_SHELL);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// ==================== Activate ====================

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate', APP_VERSION);
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME && key !== API_CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// ==================== Fetch ====================

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 跳过非 GET 请求
  if (event.request.method !== 'GET') return;

  // 跳过 Chrome DevTools 等非 HTTP 请求
  if (!url.protocol.startsWith('http')) return;

  // Supabase API 请求：Network-First
  if (url.hostname.includes('supabase.co') || url.pathname.startsWith('/rest/v1/')) {
    event.respondWith(networkFirst(event.request, API_CACHE_NAME));
    return;
  }

  // CDN 资源（supabase-js 等）：Cache-First
  if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('unpkg.com')) {
    event.respondWith(cacheFirst(event.request, CACHE_NAME));
    return;
  }

  // App Shell：Cache-First（Stale-While-Revalidate）
  event.respondWith(staleWhileRevalidate(event.request, CACHE_NAME));
});

// ==================== 缓存策略 ====================

// Cache-First：优先用缓存，缓存没有才走网络
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // 离线且无缓存，返回空响应
    return new Response('', { status: 408 });
  }
}

// Network-First：优先走网络，网络失败用缓存
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    // API 请求失败返回 JSON 错误
    return new Response(JSON.stringify({ error: 'offline', message: '当前处于离线状态' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Stale-While-Revalidate：立即返回缓存，同时后台更新缓存
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || fetchPromise;
}

// ==================== 后台同步 ====================

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SYNC_PENDING' });
        });
      })
    );
  }
});
