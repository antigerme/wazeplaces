// CACHE_NAME = 'waze-places-' + serial de zona DNS (YYYYMMDDnn). js/version.js é a
// FONTE ÚNICA do serial; a auditoria (test/version.test.mjs) trava a paridade/formato.
// Serial novo = shell novo = ciclo de atualização. Bump = mexer AQUI e no version.js.
const CACHE_NAME = 'waze-places-2026101705';
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
const swConta = { doCache: 0, cacheSemEntrada: 0, esperouLeitura: 0, foraDaLista: 0, cacheVencido: 0 };

// TODA espera da Cache API do worker tem teto (auditoria R23-4-02). O app já
// trata a Cache API muda com `esperarComTeto` (R21-4-01); o worker tem a mesma
// exposição e não tinha: com `has`/`keys`/`match` sem responder, o tile do mapa
// ficava pendurado para TODO editor (inclusive quem nunca ligou o offline: o
// ramo roda para todo tile do Waze) e a ativação não terminava. O worker é
// ESTRITAMENTE ADITIVO: vencido o teto, o que não deu pra ler vale como "não
// está guardado" e o pedido vai à rede, como iria sem worker. 1,5 s é folga
// larga pro cache que responde (milissegundos) e curta pro que não responde.
const SW_CACHE_TETO_MS = 1500;
// Mas «lento» NÃO é «mudo» (R24-4-03): o teto curto troca a espera por um PALPITE
// («não está guardado») e o palpite só é inofensivo com rede, onde o pedido vai à
// rede como iria sem worker. SEM rede, esperar a leitura do cache lento é a única
// saída — vencido o teto curto, o worker tenta a rede e, SE ELA FALHAR, volta a
// esperar a MESMA leitura por este teto bem maior. Cache mudo continua não
// pendurando: com rede vai à rede em ~1,5 s, sem rede o erro vem depois disto.
const SW_CACHE_ESPERA_SEM_REDE_MS = 10000;
// O que o `comTeto` devolve quando QUER distinguir "não deu pra ler" de "leu e não tem".
const VENCIDO = Symbol('vencido');
// Resolve com `vencido` se a promessa passa do teto OU rejeita. Nunca rejeita.
function comTeto(promessa, vencido, teto = SW_CACHE_TETO_MS) {
  return new Promise((resolve) => {
    const relogio = setTimeout(() => { swConta.cacheVencido++; resolve(vencido); }, teto);
    Promise.resolve(promessa).then(
      (v) => { clearTimeout(relogio); resolve(v); },
      () => { clearTimeout(relogio); resolve(vencido); },
    );
  });
}
// A segunda espera da MESMA leitura (a rede falhou): teto longo, sem contar de novo
// em `cacheVencido` (a operação já foi contada ao passar do teto curto).
function esperarCacheLento(promessa) {
  return new Promise((resolve) => {
    const relogio = setTimeout(() => resolve(undefined), SW_CACHE_ESPERA_SEM_REDE_MS);
    Promise.resolve(promessa).then(
      (v) => { clearTimeout(relogio); resolve(v); },
      () => { clearTimeout(relogio); resolve(undefined); },
    );
  });
}

// As páginas que ABRIRAM DA CÓPIA GUARDADA porque a origem respondeu 5xx à
// navegação (o `clientId` delas): o código delas também sai da cópia guardada
// quando a origem responde 5xx (ver o `fetch`). Em memória, e com teto: a página
// é aberta e carrega o que precisa em segundos, na mesma vida do worker.
const paginasDoCache = new Set();
function lembrarPaginaDoCache(id) {
  paginasDoCache.add(id);
  if (paginasDoCache.size > 20) paginasDoCache.delete(paginasDoCache.values().next().value);
}

// Só a leitura MAIS NOVA vale: a partida do worker e o aviso da varredura podem
// pedir duas seguidas, e elas terminavam fora de ordem — a velha, com MENOS
// tiles, sobrescrevia a nova, e o tile recém-guardado sumia do mapa sem rede
// (auditoria de 2026-09-25).
let hidratacaoGeracao = 0;
// `tilesHidratados` diz que a lista PODE SER USADA (a leitura terminou OU o worker
// desistiu dela por teto); `listaLida` diz que a leitura TERMINOU de verdade. A
// diferença é a do cache lento: a lista que o worker deu por vazia porque a Cache
// API demorou não prova que o tile não está guardado, e sem rede o tile fora dela
// ainda tem que tentar o cache devagar (R24-4-03).
let listaLida = false;
let leituraAtual = Promise.resolve();
function hidratarTiles() {
  const geracao = ++hidratacaoGeracao;
  tilesHidratados = false;
  listaLida = false;
  // Cada etapa (has, open, keys) tem teto PRÓPRIO: um teto sobre a soma
  // transformava três operações de 0,6 s numa lista «vazia» (R24-4-03). Passou do
  // teto, o worker DESISTE de esperar (o portão abre, com a lista que já se tinha)
  // mas a leitura segue sem teto no fundo: se um dia terminar, atualiza a lista.
  let desistir;
  const portao = new Promise((ok) => { desistir = ok; });
  const etapa = (p) => {
    const relogio = setTimeout(() => { swConta.cacheVencido++; desistir(); }, SW_CACHE_TETO_MS);
    return Promise.resolve(p).then(
      (v) => { clearTimeout(relogio); return v; },
      (e) => { clearTimeout(relogio); throw e; },
    );
  };
  const leitura = (async () => {
    let lista = new Set();
    try {
      // `caches.has` antes de `open`: `open` CRIA o cache, e quem nunca ligou o
      // offline não precisa ganhar um vazio a cada partida do worker.
      if (await etapa(caches.has(TILES_CACHE))) {
        const c = await etapa(caches.open(TILES_CACHE));
        lista = new Set((await etapa(c.keys())).map((r) => r.url));
      }
    } catch (e) { lista = new Set(); }
    if (geracao !== hidratacaoGeracao) return;
    tilesGuardados = lista;
    swHidratadoEm = Date.now();
    tilesHidratados = true;
    listaLida = true;
  })();
  leituraAtual = leitura;
  // O que segura o tile e a ativação é o PORTÃO: a leitura que não termina não
  // pode prendê-los. Vencido, a lista que já se tinha (vazia, se o worker acabou
  // de acordar) passa a valer — com rede o tile que ela não conhece vai à rede.
  hidratacao = Promise.race([leitura, portao]).then(() => {
    if (geracao === hidratacaoGeracao) tilesHidratados = true;
  });
  return hidratacao;
}
// A leitura MAIS NOVA, até o fim DE VERDADE (para o ramo sem rede). Quem espera
// tem teto próprio (`esperarCacheLento`); as voltas são só cinto.
function esperarLeituraCompleta(voltas = 0) {
  return leituraAtual.then(() => (listaLida || voltas >= 5 ? undefined : esperarLeituraCompleta(voltas + 1)));
}
// Espera a leitura MAIS NOVA da lista. Esperar só a promessa capturada no
// pedido não basta (auditoria de 2026-09-26, O11): pedido durante a leitura N,
// com a N+1 começando antes de a N terminar — a N sai cedo (geração velha) sem
// tocar na lista, e o tile era decidido contra a lista VELHA (ou vazia, logo
// depois de acordar) e ia à rede, que sem sinal não há. Relê `hidratacao` (a
// mais nova) até a lista estar pronta; o teto de voltas é só cinto — por
// construção a leitura mais nova sempre termina marcando a lista pronta.
function esperarListaMaisNova(voltas = 0) {
  return hidratacao.then(() => (tilesHidratados || voltas >= 5 ? undefined : esperarListaMaisNova(voltas + 1)));
}
// A espera do tile no ramo "lista ainda sendo lida", com teto próprio: cada
// leitura já é limitada, mas as voltas acima encadeiam várias.
function esperarListaComTeto() { return comTeto(esperarListaMaisNova(), undefined); }
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
// O que o app PRECISA pra abrir sem rede: a página e tudo que ela carrega
// (`test/offline.test.mjs` confere contra os <script> e o <link> do HTML).
// `/index.html` NÃO entra: no Cloudflare ele é um 307 pra `/`, e o `cache.add`
// guardava a resposta REDIRECIONADA — que o Chrome recusa numa navegação, então
// o fallback de HTML abria a página de erro do navegador.
const CRITICOS = [
  '/',
  '/css/app.css',
  '/js/min/version.js',
  '/js/min/i18n.js',
  '/js/min/api.js',
  '/js/min/mapa.js',
  '/js/min/swipe.js',
  '/js/min/app.js',
  '/js/min/presenca.js',
  '/js/min/sw-register.js',
];
// O resto ajuda, e a falta de um não impede nada: o QR vem sob demanda, a fonte
// tem a do sistema como reserva, e os ícones são do atalho e do instalar.
const OPCIONAIS = [
  '/js/min/qr.js',
  '/fonts/inter-latin-wght-normal.woff2',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-maskable.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Os críticos são ATÔMICOS (`addAll`): com um deles faltando a instalação
      // FALHA, o worker novo é descartado e o antigo segue no controle com o
      // cache inteiro — o navegador tenta de novo depois. Era `allSettled` em
      // tudo: com sinal fraco no deploy, a instalação "dava certo" pela metade,
      // o `activate` apagava o cache ANTIGO (o completo) e, sem rede, o app não
      // abria mais. Os opcionais seguem tolerantes.
      .then(cache => cache.addAll(CRITICOS)
        .then(() => Promise.allSettled(OPCIONAIS.map(u => cache.add(u)))))
  );
});

self.addEventListener('activate', event => {
  // O `claim` NÃO espera a leitura da lista de tiles (R23-4-02): o `fetch` do tile
  // espera por ela, com teto, quando precisa. Esperá-la aqui deixava a ativação — e
  // a navegação que depende do `claim` — presa a uma Cache API que não responde. A própria
  // faxina tem teto pelo mesmo motivo; vencido, os caches antigos ficam e o
  // próximo `activate` os leva (apaga tudo que não é o desta versão).
  event.waitUntil(
    comTeto(caches.keys().then(cacheNames => {
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
    }), undefined).then(() => {
      // Relê a lista a cada ativação, SEM esperá-la: o worker novo nasce (e lê a lista, no
      // topo) enquanto o antigo ainda comanda, e o aviso `TILES_GUARDADOS` da varredura vai
      // pro controlador de ANTES — sem esta releitura, o tile guardado nessa janela ficava
      // fora da lista dele. `hidratarTiles()` segura os tiles (com teto) e não segura o claim.
      hidratarTiles();
      return self.clients.claim();
    })
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
      // Só o MAPA sai do cache: a `<img>` do tile (destino `image`), que é quem o
      // desenha. O `fetch` da própria VARREDURA (destino vazio) passa direto
      // (auditoria de 2026-09-26, O7): respondido daqui, o tile guardado nunca
      // mais ia à rede — a "revalidação barata com 304" de cada janela não
      // acontecia, e o cache ficava com o tile da primeira varredura pra sempre.
      // A marca é o DESTINO, e não o modo de cache do pedido: MEDIDO, com o
      // cache HTTP desligado (DevTools, ou qualquer rota do Playwright) a
      // própria `<img>` chega aqui com `cache: 'reload'` — tomado como marca, o
      // mapa guardado sumiria justamente de quem testa. A `<img>` COM rede segue
      // saindo do cache, e isso é decidido: o worker é ESTRITAMENTE ADITIVO (o
      // que ele devolve não falha), no "lie-fi" o mapa aparece na hora em vez de
      // pendurar, e quem mantém o guardado em dia é a varredura de cada janela,
      // que agora revalida de verdade.
      if (event.request.destination !== 'image') return;
      // `caches.match` com o nome, e não `open` + `match`: o `open` CRIARIA o
      // cache que o "Sair" ou o desligar acabou de apagar.
      // Com TETO (R23-4-02): o cache que não responde vale como "sem entrada" —
      // COM rede. SEM rede (R24-4-03) o palpite não serve: o cache LENTO que
      // responde é a única saída, então a rede que falha manda voltar a esperar a
      // MESMA leitura por `SW_CACHE_ESPERA_SEM_REDE_MS`. Cache mudo não responde
      // nunca: aí o erro da rede é o que a imagem teria sem worker, só mais tarde.
      const doCache = () => {
        const leitura = caches.match(event.request, { cacheName: TILES_CACHE });
        return comTeto(leitura, VENCIDO).then((hit) => {
          // O vencido já foi contado em `cacheVencido`: não conta de novo como "sem entrada".
          if (hit !== VENCIDO) { swConta[hit ? 'doCache' : 'cacheSemEntrada']++; return hit || fetch(event.request); }
          return fetch(event.request).catch((erro) => esperarCacheLento(leitura).then((h) => {
            if (h) { swConta.doCache++; return h; }
            throw erro;
          }));
        });
      };
      // A lista NÃO foi lida até o fim (o worker desistiu dela por teto): o tile que
      // ela não conhece pode estar guardado. Com rede, vai à rede; sem rede, espera
      // a leitura da lista (e do tile) por quanto der.
      const daRedeOuDaListaLenta = () => fetch(event.request).catch((erro) =>
        esperarCacheLento(esperarLeituraCompleta()).then(() => {
          if (tilesGuardados.has(url.href)) return doCache();
          throw erro;
        }));
      if (tilesHidratados) {
        // O caminho de sempre, ESTRITAMENTE ADITIVO: sem entrada, não responde.
        if (tilesGuardados.has(url.href)) event.respondWith(doCache());
        else if (!listaLida) event.respondWith(daRedeOuDaListaLenta());
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
        event.respondWith(esperarListaComTeto().then(() => {
          if (tilesGuardados.has(url.href)) return doCache();
          return listaLida ? fetch(event.request) : daRedeOuDaListaLenta();
        }));
      }
    }
    return;
  }

  if (url.pathname.startsWith('/api/')) return;

  // O diagnóstico compara o que o aparelho TEM com o que o servidor SERVE, e o
  // lado do servidor não pode passar por aqui: o `/` e os ícones caem no
  // cache-first abaixo (a comparação dava "igual" SEMPRE) e, sem rede, o
  // network-first devolve o cache ("conferido, igual" sem ter conferido nada).
  // Com `?diag-rede` o pedido vai direto à rede — e sem rede FALHA, que é a
  // resposta certa (auditoria de 2026-09-25).
  if (url.searchParams.has('diag-rede')) return;

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
    // A cópia GUARDADA deste pedido (ou `undefined`).
    // Com TETO (R23-4-02): sem rede e com a Cache API muda, `Response.error()`
    // ao fim do teto é melhor que pendurar a navegação. UM teto sobre a cadeia
    // inteira (a página e, depois, o `/`), e o teto é o LONGO (R24-4-03): este caminho só
    // roda com a rede já falha (o `.catch`) ou com a borda respondendo 5xx (a origem fora
    // do ar, que é a mesma coisa), e aí o cache lento que responde é a única saída — dois
    // tetos curtos em série davam `Response.error()` a um `caches.match` de 1,6 s, que
    // antes do lote 27 esperava. A resposta 5xx, se houver, segue como último recurso.
    const daCopiaGuardada = () => comTeto(
      caches.match(event.request, isHTML ? { ignoreSearch: true } : undefined).then(cached => {
        if (cached) return cached;
        // Fallback HTML só pra navegação. NUNCA devolver HTML pra request de JS/CSS
        // (browser engasga ao tentar parsear HTML como script — ver gotcha #11).
        // `ignoreSearch` acima e `/` aqui: o atalho do manifest abre
        // `/?action=filters`, que nunca foi guardado com essa query — e o
        // `/index.html` de antes era uma resposta redirecionada, recusada.
        if (isHTML) return caches.match('/');
        return undefined;
      }), undefined, SW_CACHE_ESPERA_SEM_REDE_MS);
    const navegacao = event.request.mode === 'navigate';
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // A ORIGEM FORA DO AR: a resposta CHEGA, com 5xx — a VM caída atrás
          // do Cloudflare é "502 Bad Gateway" —, e o `.catch` abaixo só pega a
          // rede que não responde. A navegação com 5xx conta como falha e cai
          // na página guardada (auditoria de 2026-09-29, O1: o app instalado,
          // com tudo no cache e a fila guardada, abria a página de erro da borda).
          // E o CÓDIGO dessa página também, só dela: MEDIDO com a navegação
          // sozinha, a página guardada abria e os scripts vinham 502 — o app não
          // subia. A página que veio da REDE segue sem o desvio, que é o que o
          // anti-skew protege (gotcha #18: HTML novo com JS velho). Sem cópia
          // guardada, a resposta da borda vai como veio.
          if (response && response.status >= 500 && (navegacao || paginasDoCache.has(event.clientId))) {
            return daCopiaGuardada().then((guardada) => {
              if (!guardada) return response;
              if (navegacao && event.resultingClientId) lembrarPaginaDoCache(event.resultingClientId);
              return guardada;
            });
          }
          if (response && response.status === 200 && response.type === 'basic') {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone)).catch(() => {});
          }
          return response;
        })
        .catch(() => daCopiaGuardada().then((guardada) => guardada || Response.error()))
    );
    return;
  }

  // Com TETO (R23-4-02): vencido, vale como "não guardado" e vai à rede; se a
  // rede falhar, volta a esperar o cache lento (R24-4-03).
  const leituraDoAsset = caches.match(event.request);
  event.respondWith(
    comTeto(leituraDoAsset, VENCIDO).then(cached => {
      if (cached && cached !== VENCIDO) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache)).catch(() => {});
        return response;
      }).catch((erro) => {
        if (cached !== VENCIDO) throw erro;
        return esperarCacheLento(leituraDoAsset).then((h) => { if (h) return h; throw erro; });
      });
    })
  );
});
