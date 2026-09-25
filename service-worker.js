// CACHE_NAME = 'waze-places-' + serial de zona DNS (YYYYMMDDnn). js/version.js é a
// FONTE ÚNICA do serial; a auditoria (test/version.test.mjs) trava a paridade/formato.
// Serial novo = shell novo = ciclo de atualização. Bump = mexer AQUI e no version.js.
const CACHE_NAME = 'waze-places-2026092501';
// Cache dos tiles provisionados. Nome PRÓPRIO e fora do bump de propósito:
// ver a nota no `activate`.
const TILES_CACHE = 'waze-places-tiles';
// Quais tiles ESTÃO guardados, em memória. Existe porque `respondWith` precisa
// ser decidido de forma SÍNCRONA: perguntar ao cache exige await, e depois do
// await não dá mais pra dizer "deixa o navegador cuidar". Sem esta lista o SW
// teria que prometer resposta pra tudo — que foi exatamente o defeito.
let tilesGuardados = new Set();
// `false` até a lista ser lida do cache NESTA vida do worker — e de novo a cada
// RELEITURA (o aviso da varredura): enquanto ela corre, o tile pedido ESPERA a
// lista nova em vez de ser julgado pela velha. Sem isso, o tile que acabou de
// ser guardado e é pedido logo em seguida caía na lista antiga e ia à rede.
let tilesHidratados = false;
let hidratacao = null;

// ── O que o worker diz de si mesmo (diagnóstico do modo dev) ────────────────
// O relatório só sabia que o worker estava "ativo e controlando", e o defeito
// do mapa de 2026-09-22 — o worker ACORDANDO sem lembrar dos tiles — não
// aparecia em nada: foi preciso reproduzir derrubando o worker à força. Agora
// ele responde quando nasceu, quando leu a lista, quantos tiles conhece e o que
// fez com os que passaram por ele NESTA vida. Tudo em memória: morre junto com
// ele, e é por isso que `iniciadoEm` vem junto — diz quanto tempo os números
// cobrem. Perguntar ACORDA o worker se ele estiver parado; aí `idadeMs` sai
// pequeno, e isso já é a resposta.
const swIniciadoEm = Date.now();
let swHidratadoEm = null;
const swConta = { doCache: 0, cacheSemEntrada: 0, esperouLeitura: 0, foraDaLista: 0 };

function hidratarTiles() {
  tilesHidratados = false;
  hidratacao = (async () => {
    try {
      // `caches.has` antes de `open`: `open` CRIA o cache, e quem nunca ligou o
      // offline não precisa ganhar um vazio a cada partida do worker.
      if (await caches.has(TILES_CACHE)) {
        const c = await caches.open(TILES_CACHE);
        tilesGuardados = new Set((await c.keys()).map((r) => r.url));
      } else {
        tilesGuardados = new Set();
      }
    } catch (e) { tilesGuardados = new Set(); }
    swHidratadoEm = Date.now();
    tilesHidratados = true;
  })();
  return hidratacao;
}
// EM TODA PARTIDA do worker — não só no `activate`. Service worker é EFÊMERO:
// o Chrome o encerra depois de ~30s ocioso e o recria no próximo evento, com
// as variáveis globais ZERADAS. Até v2026.09.22-01 a lista só era lida no
// `activate` (que não roda de novo numa recriação) e no aviso da varredura, então
// depois da primeira pausa de meio minuto o worker acordava com a lista VAZIA,
// não respondia por tile nenhum e, sem rede, o mapa guardado sumia. RELATADO
// pelo owner no Android com a varredura em "Pronto" e 243 tiles no cache;
// reproduzido encerrando o worker pelo DevTools Protocol no meio do modo avião.
// O smoke nunca pegava: durante um teste curto o worker não chega a adormecer.
hidratarTiles();
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
          // O cache dos tiles do offline NÃO entra na faxina. Ele é da FILA,
          // não da versão: apagá-lo a cada deploy faria o mapa que o editor
          // provisionou sumir sem aviso — e ele descobriria na estrada.
          if (cacheName !== CACHE_NAME && cacheName !== TILES_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => hidratarTiles()).then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // O app avisa quando terminou de guardar tiles. Sem isto o SW só saberia
  // deles no próximo `activate`, e a sombra de sinal chegaria antes.
  if (event.data && event.data.type === 'TILES_GUARDADOS') {
    event.waitUntil(hidratarTiles());
  }
  // O diagnóstico pergunta por um MessageChannel e espera a resposta com teto:
  // worker de versão antiga não conhece esta mensagem e simplesmente não
  // responde, o que o relatório registra como "sem resposta".
  if (event.data && event.data.type === 'DIAG' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({
      versao: CACHE_NAME, iniciadoEm: swIniciadoEm, idadeMs: Date.now() - swIniciadoEm,
      hidratadoEm: swHidratadoEm, listaPronta: tilesHidratados, tilesNaLista: tilesGuardados.size,
      ...swConta,
    });
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

  // EXCEÇÃO ESTREITA ao "ignore tudo de fora": só o tile do mapa, e só quando
  // ele já está no nosso cache. Abrir pra todo domínio externo seria passar a
  // guardar coisa que ninguém pediu. Quem PÕE no cache é o app.js (ver
  // `offlineBaixar`); aqui só servimos o que já está lá, que é o que faz o
  // mapa existir na sombra — o tile vem com `max-age=600` e o navegador o
  // descartaria em dez minutos.
  if (url.origin !== self.location.origin) {
    // SÓ RESPONDE O QUE JÁ ESTÁ GUARDADO. Nunca chama `respondWith` pra pedir
    // à rede — e isto não é zelo, é o conserto de um defeito que QUEBROU O MAPA
    // DE TODO MUNDO na v2026.09.21-08.
    //
    // A versão anterior fazia `hit || fetch(event.request)`, e `respondWith`
    // é uma PROMESSA DE RESPONDER: se o fetch falha, a imagem falha — enquanto
    // SEM o service worker o navegador a teria carregado normalmente. Ali o
    // fetch era barrado pela CSP (`connect-src` não tinha o host do tile), e o
    // resultado foi o mapa sumir inclusive para quem NUNCA ligou o offline.
    //
    // Agora a interceptação é ESTRITAMENTE ADITIVA: sem entrada no cache, o SW
    // sai sem responder e o navegador faz o que sempre fez. `tilesGuardados` é
    // consultado de forma SÍNCRONA porque `respondWith` tem que ser decidido no
    // mesmo tique — não dá pra "desistir" depois de um await.
    // DUAS condições, e não é redundância: o caminho mantém a exceção estreita
    // aqui (nunca respondemos por domínio externo qualquer, mesmo que algo
    // estranho entre no cache), e a lista mantém a interceptação ADITIVA.
    if (/-tiles\/live\/base\//.test(url.pathname)) {
      const doCache = () => caches.open(TILES_CACHE)
        .then((c) => c.match(event.request))
        // Mesmo aqui: se o cache falhar, devolve à rede em vez de quebrar.
        .then((hit) => { swConta[hit ? 'doCache' : 'cacheSemEntrada']++; return hit || fetch(event.request); })
        .catch(() => fetch(event.request));
      if (tilesHidratados) {
        // O caminho de sempre, ESTRITAMENTE ADITIVO: sem entrada, não responde.
        if (tilesGuardados.has(url.href)) event.respondWith(doCache());
        else swConta.foraDaLista++;
      } else {
        swConta.esperouLeitura++;
        // O worker ACABOU de acordar — ou está RELENDO a lista porque a
        // varredura avisou que guardou mais — e a lista ainda está sendo lida. O
        // `respondWith` tem de ser decidido agora, e não responder aqui é
        // perder o tile: é exatamente o primeiro pedido depois da recriação,
        // e o card pede todos os tiles de uma vez. Então espera a leitura (são
        // milissegundos) e decide com a lista pronta. Se o tile não estiver
        // guardado, o worker busca por conta própria — o que a CSP do script
        // dele permite (`connect-src` com o host do tile, cobrado em
        // `test/csp-vm.test.mjs`) e dá o mesmo que o navegador daria.
        event.respondWith(hidratacao.then(() =>
          (tilesGuardados.has(url.href) ? doCache() : fetch(event.request))));
      }
    }
    return;
  }

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
    // `If-None-Match`, então todo carregamento rebaixava o app inteiro.
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
