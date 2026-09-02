// CACHE_NAME = 'waze-places-' + serial de zona DNS (YYYYMMDDnn). js/version.js é a
// FONTE ÚNICA do serial; a auditoria (test/version.test.mjs) trava a paridade/formato.
// Serial novo = shell novo = ciclo de atualização. Bump = mexer AQUI e no version.js.
const CACHE_NAME = 'waze-places-2026090201';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/min/sw-register.js',
  '/js/min/version.js',
  '/js/min/qr.js',
  '/js/min/i18n.js',
  '/js/min/app.js',
  '/js/min/api.js',
  '/js/min/mapa.js',
  '/js/min/swipe.js',
  '/fonts/inter-latin-wght-normal.woff2',
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
  // Todo JS/CSS/JSON é código nosso agora (o vendor Tailwind de 407KB saiu na
  // pré-compilação) → network-first, sem exceção. O css/app.css gerado muda
  // junto com o HTML, então precisa da mesma garantia anti-skew (gotcha #18).
  // Fontes (.woff2) caem no ramo cache-first abaixo — imutáveis por natureza.
  const isCode = /\.(js|css|json)$/i.test(url.pathname);

  if (isHTML || isCode) {
    // SEM `cache: 'reload'`, e a diferença é grande. Ele existia pra impedir que
    // um `Cache-Control` LONGO em JS/CSS fizesse o navegador servir versão velha
    // do cache HTTP local, com F5 não pegando o novo e só o Ctrl+Shift+R
    // resolvendo (que celular não tem). Só que o servidor hoje manda
    // `no-cache, must-revalidate` nesses arquivos — e `no-cache` já OBRIGA a
    // perguntar ao servidor antes de reusar. A garantia virou do cabeçalho; o
    // `reload` só sobrava, e sobrava caro: ele pula o cache e NÃO manda
    // `If-None-Match`, então todo carregamento rebaixava a app inteira.
    //
    // MEDIDO no fio, com o SW no controle, num F5:
    //   cache: 'reload'   → 0 requisições condicionais, 0 × 304, 680 KB
    //   cache: 'no-cache' → 0 requisições condicionais, 0 × 304, 680 KB (igual!)
    //   sem opção         → 10 condicionais, 10 × 304, 4,2 KB
    // E com um deploy no meio, os dois pegam a versão nova — o arquivo que
    // mudou vem 200 com bytes novos, os que não mudaram vêm 304 (13,7 KB
    // contra 1369 KB). O anti-skew (gotcha #18) continua de pé.
    //
    // ISTO DEPENDE DE DUAS COISAS, e `test/vm-estaticos.test.mjs` cobra as duas:
    // o servidor mandar `no-cache` nesses tipos, e mandar ETag. Sem ETag não há
    // o que revalidar e a revalidação vira download inteiro — era o caso da VM.
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
