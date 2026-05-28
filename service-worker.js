const CACHE_NAME = 'waze-places-v20';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/api.js',
  '/js/swipe.js',
  '/js/tailwindcss_3_4_17.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Estratégia: network-first pra HTML, JS, CSS e JSON (incluindo manifest).
// Garante que código (JS/CSS) e UI (HTML) ficam SEMPRE em sync. Antes desta
// versão, HTML era network-first e JS era cache-first, gerando "version skew"
// quando o user pegava HTML novo + JS velho — features novas falhavam até o
// SW novo completar install/activate/reload (Ctrl+Shift+R como workaround).
// Imagens/SVG/fontes continuam cache-first (raramente mudam, ganho de perf
// vale mais que sync exato).
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) return;

  const isHTML = event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') || '').includes('text/html');
  const isCode = /\.(js|css|json)$/i.test(url.pathname);

  if (isHTML || isCode) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Fallback HTML só pra navegação. NUNCA devolver HTML pra request de JS/CSS
          // (browser engasga ao tentar parsear HTML como script — ver gotcha #11).
          if (isHTML) return caches.match('/index.html');
          return Response.error();
        }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        return response;
      });
    })
  );
});
