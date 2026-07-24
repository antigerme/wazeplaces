// CACHE_NAME = 'waze-places-' + serial de zona DNS (YYYYMMDDnn). js/version.js é a
// FONTE ÚNICA do serial; a auditoria (test/version.test.mjs) trava a paridade/formato.
// Serial novo = shell novo = ciclo de atualização. Bump = mexer AQUI e no version.js.
const CACHE_NAME = 'waze-places-2026071901';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/version.js',
  '/js/i18n.js',
  '/js/app.js',
  '/js/api.js',
  '/js/swipe.js',
  '/js/tailwindcss_3_4_17.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-maskable.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // allSettled: um asset 404 não derruba o precache inteiro (addAll é atômico).
      .then(cache => Promise.allSettled(STATIC_ASSETS.map(u => cache.add(u))))
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
  // Vendor Tailwind tem a versão no nome (immutable) → cache-first, sem re-baixar
  // 407KB a cada load. O gotcha #18 (skew) não se aplica: o nome muda com a versão.
  const isImmutableVendor = url.pathname === '/js/tailwindcss_3_4_17.js';
  const isCode = !isImmutableVendor && /\.(js|css|json)$/i.test(url.pathname);

  if (isHTML || isCode) {
    // cache: 'reload' força o SW a bypassar o HTTP cache do navegador. Sem isso,
    // um Cache-Control longo pra JS/CSS faria o browser servir versões velhas do
    // HTTP cache local, mesmo com SW network-first — F5 não pegava versão nova,
    // só Ctrl+Shift+R (que mobile não tem). Defesa adicional no servidor via
    // Cache-Control: no-cache (arquivo _headers no Cloudflare / adaptador Node).
    event.respondWith(
      fetch(event.request, { cache: 'reload' })
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
