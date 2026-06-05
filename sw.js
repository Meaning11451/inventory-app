// ============================================
// Service Worker v5 - 智能缓存 + 手机号客户识别修复
// ============================================

const APP_VERSION = 'v5';
const CACHE_NAME = `inventory-${APP_VERSION}`;

// ==================== Install ====================

self.addEventListener('install', () => {
  self.skipWaiting();
});

// ==================== Activate ====================

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// ==================== Fetch ====================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Supabase API：Network-First
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTML 页面：Network-First（优先用最新版本）
  if (request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // JS / CSS / 图片 / 字体：Cache-First
  event.respondWith(cacheFirst(request));
});

// ==================== 缓存策略 ====================

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return new Response('', { status: 408 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.open(CACHE_NAME).then(c => c.match(request));
    if (cached) return cached;

    return new Response(
      JSON.stringify({ error: 'offline', message: '当前处于离线状态' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
