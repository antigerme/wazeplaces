// A BUSCA na rodada 14 da auditoria (o lote 18): a renovação da sessão pela
// extensão, a busca que responde depois da queda, a barra do foco no autor sobre
// o esqueleto e a janela do Desfazer cortada pelo refazer automático da fila.
// Todos mexem na MESMA engrenagem — `startFetching`, `fetchNextPage`,
// `rebuscarDepoisDeFalha`, `retomarBusca`, `refazerFilaReal` — e no que a chama
// na queda e na renovação.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" que aceita qualquer chamada (o molde do
// test/costura-sessao.test.mjs). As variáveis de módulo que elas leem e escrevem
// (`epocaDaSessao`, `rebuscasAuto`…) moram nos `deps`. Cada teste foi visto
// REPROVANDO com o conserto desfeito, e carrega um CONTROLE que reprova se o
// instrumento não enxergar o defeito (gotcha #28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', i); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) {
      const corpo = APP_SEM.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
// A função existe neste app.js? (as do conserto não existem no código de antes,
// e o teste tem de reprovar pelo COMPORTAMENTO, não por não achá-las.)
const achar = (nome) => new RegExp('^(async )?function ' + nome + '\\(', 'm').test(APP_SEM);
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function(`return (${m[1]});`)();
};

// Um "buraco negro": aceita qualquer propriedade e qualquer chamada.
function buracoNegro() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro()),
    apply: () => buracoNegro(), set: () => true,
  });
}
// `nomes`: as funções do app.js a rodar. `deps`: o que elas enxergam (funções e
// variáveis de módulo). O resto é buraco negro.
function montar(nomes, deps) {
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      return typeof k === 'string' ? buracoNegro() : undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map(fatiar).join('\n');
  return new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
}

const tique = (ms = 0) => new Promise((ok) => setTimeout(ok, ms));
// Espera por CONDIÇÃO, com teto de tempo real: prazo fixo mede a máquina.
async function ateQue(cond, rotulo, tetoMs = 4000) {
  const fim = performance.now() + tetoMs;
  while (!cond()) {
    if (performance.now() > fim) assert.fail(`${rotulo}: não aconteceu em ${tetoMs / 1000} s`);
    await tique(2);
  }
}

const P = (n, extra = {}) => ({ venueID: 'v' + n, updateRequestID: 'u' + n, name: 'Local ' + n, creatorId: 900 + n, ...extra });
const ids = (fila) => fila.map((p) => p.updateRequestID);

// A janela de mentira, como a ponte da extensão a vê (o `postMessage` da página).
function janelaFalsa() {
  const ouvintes = new Set();
  const w = {
    location: { origin: 'https://app' },
    addEventListener: (tipo, fn) => { if (tipo === 'message') ouvintes.add(fn); },
    removeEventListener: (tipo, fn) => ouvintes.delete(fn),
    postMessage: () => {},
    responder: (data) => { for (const fn of [...ouvintes]) fn({ source: w, origin: w.location.origin, data }); },
  };
  return w;
}
function elemento() {
  const classes = new Set();
  return { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
    toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)) } };
}

// ═══ R14-1-01 · a renovação pela extensão DEPOIS de a busca levar o 401 ═══════
// (auditoria da rodada 14; igual desde o #252). A busca que levou o 401 deixa
// `loadError` e `hasMore` falso; a renovação da queda (`entrarPelaExtensao` com
// `manterFila`) chamava o `startFetching` cru, que zerava o `loadError` — e o
// `rebuscarDepoisDeFalha` da renovação, logo depois, já não via a falha: a fila
// nunca era buscada com a sessão nova, e a tela dizia "Tudo limpo!" com a fila
// pendente no Waze (na reposição com card, com confete e a conquista). MEDIDO no
// navegador, nos dois motores (roteiro r14-1/s14). É o caminho mais comum da
// renovação: abrir o app com a sessão salva vencida e a extensão logada no WME.
//
// Aqui rodam a queda e a renovação DE VERDADE (`derrubarSessao` →
// `entrarPelaExtensao` → `rebuscarDepoisDeFalha`), a busca de verdade
// (`startFetching`, `fetchNextPage`, `maybePrefetch`) e uma extensão de mentira
// que responde a sessão nova. O Waze de mentira recusa a sessão velha (401) e
// responde a nova. `antigoCru`: o app de antes — o `startFetching` cru na
// renovação, logo antes do `esvaziarFilaDeSaida`, como era —, o CONTROLE.
const NOMES_RENOVACAO = ['derrubarSessao', 'entrarPelaExtensao', 'rebuscarDepoisDeFalha', 'startFetching', 'fetchNextPage',
  'maybePrefetch', 'esperarOLugarDaFilaVazia', ...(achar('decideOLugarDeAgora') ? ['decideOLugarDeAgora'] : [])];
function montarRenovacao({ fila = [], hasMore = true, novos = [1, 2, 3, 4, 5], antigoCru = false, segurar = false } = {}) {
  const log = [];
  const buscas = [];
  const soltas = [];
  const janela = janelaFalsa();
  const els = {};
  const AppState = {
    authenticated: true, profile: null, hasMore, fetching: false, _fetchPromise: null, fetchEpoch: 0, loadError: false,
    queue: fila.slice(), currentPlace: fila[0] || null, serverTotal: fila.length, serverBlocked: 0, blockedPartial: false,
    pendingAction: null, ultimaBusca: null, _profilePromise: null, _caixaDaMinhaAreaNoAr: null,
    filters: { unreadOnly: true, types: [], residential: '', myArea: false, stateId: '', managedAreaId: '', categories: [],
      sortOrder: 'newest' },
  };
  const resposta = (tok, pagina) => (tok === 'TOK-N'
    ? { success: true, places: novos.map((n) => P(n)), hasMore: false, page: pagina, total: novos.length, blocked: 0 }
    : { success: false, error: 'Sessão expirada', errorKey: 'srv.err.sessionExpired', errorCategory: 'unauthorized' });
  const API = {
    sessionToken: 'TOK-S',
    setSession(t) { this.sessionToken = t; },
    soltarSessao() { this.sessionToken = null; },
    temSessaoNaMemoria() { return !!this.sessionToken; },
    fetchPlaces(pagina) {
      const tok = this.sessionToken;
      buscas.push(tok + '/p' + pagina);
      // `segurar`: o teste solta cada resposta (`soltas`), com o que quiser.
      if (segurar) return new Promise((ok) => soltas.push(ok));
      return Promise.resolve(resposta(tok, pagina));
    },
  };
  const deps = {
    AppState, API, window: janela, navigator: { onLine: true },
    document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    Treino: { ativo: false, entradas: 0, epocaDaFilaGuardada: () => null },
    // a tela
    showLoading: (v) => log.push('carregando:' + v), removeCurrentCardEl: () => log.push('tirou o card'),
    renderFocoAutor: () => {}, updatePendingCount: () => {},
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; log.push('card'); },
    showNoPlaces: () => log.push(AppState.loadError ? 'falha' : 'tudoLimpo'),
    showMainScreen: () => { AppState.authenticated = true; log.push('app'); },
    showToast: (m) => log.push('aviso:' + m), t: (k) => k,
    // a busca
    semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
    semOsQueJaPassaramPelaFila: (places) => ({ places: places.slice(), repetidos: 0 }),
    registrarEntradaNaFila: () => {}, ordemDoWaze: () => 'SORTING_UPDATE_TIME_DESC', ordemPrecisaDaFilaInteira: () => false,
    refazerDecisaoSemResposta: () => null, decisaoSemResposta: () => null, abrirGuardadaDepoisDaFalha: async () => false,
    handleUnauthorized: () => log.push('confere a sessão'),
    pedidosQueEntraramNaFila: new Set(), bloqueadosPorPagina: new Map(),
    PREFETCH_THRESHOLD: constante('PREFETCH_THRESHOLD'), MAX_EMPTY_PAGES: constante('MAX_EMPTY_PAGES'),
    MAX_PAGINAS_POR_BUSCA: constante('MAX_PAGINAS_POR_BUSCA'), MAX_REBUSCAS_AUTO: constante('MAX_REBUSCAS_AUTO'),
    FILA_VAZIA_ESPERA_PERFIL_MS: constante('FILA_VAZIA_ESPERA_PERFIL_MS'),
    // a queda e a extensão
    sessaoDestaAbaEhAGuardada: () => true, EXT_PRESENTE_MS: constante('EXT_PRESENTE_MS'), EXT_ESPERA_MS: constante('EXT_ESPERA_MS'),
    AVISO_RENOVADA_ESPERA_PERFIL_MS: 1, UNAUTHORIZED_REDIRECT_MS: 1,
    focoNaTelaDeEntrada: () => null, textoDigitadoNaEntrada: () => false, authInFlight: false, resgateEmVoo: false,
    loadProfileAndAuxData: () => Promise.resolve(), resetQueue: () => log.push('fila refeita'),
    safeLS: { get: () => null },
    // O app de antes: o `startFetching` cru da renovação, na mesma volta do laço
    // (logo antes do `esvaziarFilaDeSaida`, como era).
    esvaziarFilaDeSaida: () => { if (antigoCru) h.startFetching(); },
    // as variáveis de módulo
    epocaDaSessao: 1, rebuscasAuto: 0, filaEsperaPerfil: false, ultimaBuscaFalhouPorRede: false, buscaSemResposta: false,
    buscaEsperaOPerfil: false, lugarDoPedidoDoPerfil: null, filaAtravessouSessao: false, extPerguntando: false,
    extRenovando: false, extNegado: null, extNegadoNestaPagina: false, quedaAnunciada: false, referenciasDoPerfil: null,
    focoDoTeclado: null, filaDeOnde: null,
  };
  const h = montar(NOMES_RENOVACAO, deps);
  // A conferência da sessão confirma a queda (a sonda levou 401), e a extensão,
  // logada no WME, responde com a sessão nova.
  const cairERenovar = () => {
    h.derrubarSessao('srv.err.sessionExpired');
    janela.responder({ source: 'wazeplaces-ext', action: 'aguarde' });
    janela.responder({ source: 'wazeplaces-ext', action: 'sessao', token: 'TOK-N' });
  };
  return { h, deps, AppState, API, log, buscas, soltas, cairERenovar };
}

test('R14-1-01: a abertura com a sessão salva MORTA e a extensão que renova — a fila é buscada com a sessão nova, sem "Tudo limpo!"', async () => {
  const m = montarRenovacao();
  await m.h.startFetching();                       // a abertura: a busca leva o 401
  assert.deepEqual([m.buscas, m.AppState.loadError, m.AppState.hasMore], [['TOK-S/p1'], true, false],
    'PRÉ-CONDIÇÃO: a busca da abertura não levou o 401 da sessão salva morta');
  const desde = m.log.length;
  m.cairERenovar();
  await ateQue(() => m.buscas.includes('TOK-N/p1') && !m.AppState.fetching && m.log.slice(desde).includes('card'),
    'a fila buscada com a sessão nova e o card na tela');
  await tique(5);
  assert.equal(m.API.sessionToken, 'TOK-N', 'PRÉ-CONDIÇÃO: a renovação não entrou com a sessão nova');
  assert.deepEqual(ids(m.AppState.queue), ['u1', 'u2', 'u3', 'u4', 'u5'], 'a fila não chegou depois da renovação');
  assert.ok(!m.log.slice(desde).includes('tudoLimpo'),
    `DEFEITO: "Tudo limpo!" no meio da renovação, com a fila pendente no Waze (R14-1-01): ${m.log.slice(desde)}`);
  assert.deepEqual(m.buscas, ['TOK-S/p1', 'TOK-N/p1'], 'uma busca por sessão: a da sessão morta e a da nova');
});

test('R14-1-01: CONTROLE — com o `startFetching` cru da renovação (o app de antes), a mesma abertura termina em "Tudo limpo!" sem buscar', async () => {
  const c = montarRenovacao({ antigoCru: true });
  await c.h.startFetching();
  const desde = c.log.length;
  c.cairERenovar();
  await ateQue(() => c.log.slice(desde).includes('tudoLimpo') && !c.AppState.fetching, 'o "Tudo limpo!" do app de antes');
  await tique(20);
  assert.deepEqual(c.buscas, ['TOK-S/p1'],
    'CONTROLE: o app de antes buscou com a sessão nova — o instrumento não reproduz o defeito, e o teste acima não prova nada');
  assert.equal(c.AppState.queue.length, 0);
});

test('R14-1-01: a REPOSIÇÃO com card que levou o 401 — a renovação repõe com a sessão nova, e o card da mão não é desenhado de novo', async () => {
  const m = montarRenovacao({ fila: [P(2), P(3), P(4)], novos: [5, 6] });
  m.h.maybePrefetch();                             // a fila no limite: a reposição sai e leva o 401
  await ateQue(() => !m.AppState.fetching, 'a reposição voltar');
  assert.deepEqual([m.buscas, m.AppState.loadError, m.AppState.hasMore], [['TOK-S/p1'], true, false],
    'PRÉ-CONDIÇÃO: a reposição não levou o 401');
  const desde = m.log.length;
  m.cairERenovar();
  await ateQue(() => m.buscas.includes('TOK-N/p1') && !m.AppState.fetching, 'a reposição com a sessão nova');
  await tique(5);
  assert.deepEqual(ids(m.AppState.queue), ['u2', 'u3', 'u4', 'u5', 'u6'],
    'DEFEITO: a página seguinte nunca é pedida — a pessoa decide os 3 e vê "Tudo limpo!" com pedidos pendentes (R14-1-01)');
  assert.ok(!m.log.slice(desde).includes('tirou o card') && !m.log.slice(desde).includes('card'),
    `o card que ficou na tela durante a renovação foi tirado e desenhado de novo: ${m.log.slice(desde)}`);
  // CONTROLE: o app de antes não repõe nada — e redesenha o card.
  const c = montarRenovacao({ fila: [P(2), P(3), P(4)], novos: [5, 6], antigoCru: true });
  c.h.maybePrefetch();
  await ateQue(() => !c.AppState.fetching, 'a reposição do controle voltar');
  c.cairERenovar();
  await tique(30);
  assert.deepEqual(c.buscas, ['TOK-S/p1'], 'CONTROLE: o app de antes repôs a fila — o instrumento não reproduz o defeito');
});

// ═══ R14-1-02 · a busca que responde DEPOIS da queda ══════════════════════════
// (auditoria da rodada 14; = R14-4-03 = R14-8-02). A queda não refaz a fila (ela
// a mantém pra renovação), então a época da FILA não muda, e a busca que estava
// no ar — e passou pelo servidor antes de a sessão morrer — punha os pedidos na
// fila da aba que caiu: o card montado atrás da tela de entrada e anunciado ao
// leitor de tela ("Novo pedido: …"), na região que o `showAuthScreen` acabou de
// limpar. MEDIDO no navegador, nos dois motores (roteiros r14-1/s15, s15b,
// r14-4/e5, r14-8/repro c8). A queda aqui é o estado que o `derrubarSessao`
// deixa: a época da sessão sobe, a sessão sai da memória e a aba fica sem sessão.
const cair = (m) => { m.deps.epocaDaSessao++; m.AppState.authenticated = false; m.API.sessionToken = null; };

test('R14-1-02: a busca que responde DEPOIS da queda não entra na fila, e o fim da busca não desenha nem anuncia nada', async () => {
  const m = montarRenovacao({ segurar: true });
  const busca = m.h.startFetching();
  await ateQue(() => m.soltas.length === 1, 'a busca no ar');
  cair(m);
  const desde = m.log.length;
  m.soltas[0]({ success: true, places: [P(6), P(7), P(8)], hasMore: false, page: 1, total: 3, blocked: 0 });
  await busca;
  assert.deepEqual(ids(m.AppState.queue), [],
    'DEFEITO: os pedidos da busca de antes da queda entraram na fila da aba deslogada (R14-1-02)');
  assert.deepEqual(m.log.slice(desde).filter((l) => ['card', 'falha', 'tudoLimpo'].includes(l)), [],
    `DEFEITO: o fim da busca desenhou (e anunciou) a fila na tela de entrada (R14-1-02): ${m.log.slice(desde)}`);
  // Sem sessão, a busca vale como a que levou o 401: é o que a renovação lê pra
  // buscar de novo (`rebuscarDepoisDeFalha`, R14-1-01).
  assert.deepEqual([m.AppState.loadError, m.AppState.hasMore, m.AppState.fetching], [true, false, false],
    'a busca descartada não deixou a falha que a renovação recompõe');
});

test('R14-1-02: CONTROLE — a mesma resposta ANTES da queda entra na fila e chega à tela (o instrumento enxerga a entrada)', async () => {
  const c = montarRenovacao({ segurar: true });
  const busca = c.h.startFetching();
  await ateQue(() => c.soltas.length === 1, 'a busca no ar');
  c.soltas[0]({ success: true, places: [P(6), P(7), P(8)], hasMore: false, page: 1, total: 3, blocked: 0 });
  await busca;
  assert.deepEqual(ids(c.AppState.queue), ['u6', 'u7', 'u8'], 'CONTROLE: a resposta antes da queda não entrou');
  assert.ok(c.log.includes('card'), 'CONTROLE: o card não chegou à tela');
});

test('R14-1-02: a renovação que chega ANTES da resposta velha — ela sai, e a busca sai de novo, com a sessão nova', async () => {
  const m = montarRenovacao({ segurar: true });
  const busca = m.h.startFetching();
  await ateQue(() => m.soltas.length === 1, 'a busca no ar');
  cair(m);
  m.API.sessionToken = 'TOK-N';                    // a renovação entrou antes de a resposta voltar
  m.AppState.authenticated = true;
  m.soltas[0]({ success: true, places: [P(6), P(7)], hasMore: false, page: 1, total: 2, blocked: 0 });
  await ateQue(() => m.soltas.length === 2, 'a busca de novo, com a sessão nova');
  assert.deepEqual(m.buscas, ['TOK-S/p1', 'TOK-N/p1'], 'a busca de novo não saiu com a sessão nova');
  m.soltas[1]({ success: true, places: [P(1), P(2)], hasMore: false, page: 1, total: 2, blocked: 0 });
  await busca;
  assert.deepEqual(ids(m.AppState.queue), ['u1', 'u2'], 'a fila não é a da sessão nova');
  assert.ok(m.log.includes('card'), 'a fila da sessão nova não chegou à tela');
});

// ═══ R14-2-04 · a barra "Primeiro os de…" sobre o ESQUELETO ═══════════════════
// (auditoria da rodada 14; = R14-8-04; o R13-2-05 tirou a barra do painel do
// fim, e o esqueleto ficou de fora). A fila do autor em foco acaba com a próxima
// página ainda vindo (o fim da fila com `hasMore`), ou o ↻ refaz a fila: o
// `startFetching` tirava o card e punha o esqueleto, e a barra ficava por cima
// dele dizendo "1 de 1" (pelo ↻, "2 de 3") — com o foco do teclado nela e o
// nome anunciando ao leitor de tela que a série estava na frente (MEDIDO no
// navegador, nos dois motores; roteiros r14-2/s/c5, c7 e r14-8/repro c6).
function montarBarra({ fila = [], comFocoNaBarra = true } = {}) {
  const doc = { body: { nome: 'body' }, activeElement: null, els: {} };
  const el = (nome, { classes = [] } = {}) => {
    const e = { nome, isConnected: true, textContent: '', attrs: {}, classes: new Set(classes) };
    e.classList = { add: (c) => e.classes.add(c), remove: (c) => e.classes.delete(c), contains: (c) => e.classes.has(c) };
    e.getClientRects = () => (e.classes.has('hidden') ? [] : [1]);
    e.setAttribute = (k, v) => { e.attrs[k] = String(v); };
    e.getAttribute = (k) => (k in e.attrs ? e.attrs[k] : null);
    e.contains = (x) => x === e;
    e.focus = () => { doc.activeElement = e; };
    return e;
  };
  for (const id of ['focoAutorBar', 'focoAutorTexto', 'focoAutorContagem', 'noMoreCards', 'loadErrorState']) doc.els[id] = el(id);
  doc.getElementById = (id) => doc.els[id] || null;
  const barra = doc.els.focoAutorBar;
  doc.activeElement = comFocoNaBarra ? barra : doc.body;
  const log = [];
  let soltar = null;
  const AppState = { autorEmFoco: 7, queue: fila.slice(), currentPlace: fila[0] || null, hasMore: true, loadError: false,
    authenticated: true, fetchEpoch: 0, filters: { myArea: false }, profile: { id: 1 }, _profilePromise: null,
    _caixaDaMinhaAreaNoAr: null, pendingAction: null };
  const deps = {
    AppState, document: doc, Treino: { ativo: false }, navigator: { onLine: true },
    BOTAO_DA_ACAO: constante('BOTAO_DA_ACAO'),
    showLoading: (v) => log.push('carregando:' + v), removeCurrentCardEl: () => log.push('tirou o card'),
    updatePendingCount: () => {}, refazerDecisaoSemResposta: () => null, cardDaFrente: () => null,
    aplicarFocoDoTeclado: () => log.push('foco prometido: ' + deps.focoDoTeclado),
    // A série do autor (`serieDoAutor`): o card da tela é dele.
    serieDoAutor: (id, { naTela }) => [naTela],
    t: (k, v) => (k === 'card.focoAutor.contagem' ? `${v.n} de ${v.total}` : k),
    // A próxima página, segurada até o teste soltar.
    fetchNextPage: () => new Promise((ok) => { soltar = () => { AppState.hasMore = false; ok(); }; }),
    showCurrentPlace: () => log.push('card'), showNoPlaces: () => log.push('vazio'), maybePrefetch: () => {},
    ultimaBuscaFalhouPorRede: false, buscaEsperaOPerfil: false, filaEsperaPerfil: false, lugarDoPedidoDoPerfil: null,
    focoDoTeclado: null, pedidosQueEntraramNaFila: new Set(),
  };
  const h = montar(['startFetching', 'renderFocoAutor', 'focarDepoisDoFocoNoAutor', 'focavelNaTela',
    ...(achar('decideOLugarDeAgora') ? ['decideOLugarDeAgora'] : [])], deps);
  return { h, deps, AppState, doc, barra, log, soltar: () => soltar && soltar(),
    visivel: () => !barra.classes.has('hidden') };
}

test('R14-2-04: o fim da série com a próxima página ainda vindo — a barra sai com o card, o foco no autor fica e o do teclado é prometido ao ✕', async () => {
  const m = montarBarra({ fila: [] });
  assert.equal(m.visivel(), true, 'PRÉ-CONDIÇÃO: a barra "Primeiro os de…" na tela, com o foco do teclado nela');
  const busca = m.h.startFetching();               // o último do autor saiu; o esqueleto, e a página vindo
  await tique();
  assert.ok(m.log.includes('carregando:true'), 'PRÉ-CONDIÇÃO: o esqueleto não entrou');
  assert.equal(m.visivel(), false,
    'DEFEITO: a barra "Primeiro os de… · 1 de 1" ficou por cima do esqueleto, contando uma fila que já não existe (R14-2-04)');
  assert.equal(m.AppState.autorEmFoco, 7, 'o foco no autor saiu — a página que traz a série de volta não a mostra mais');
  assert.equal(m.deps.focoDoTeclado, '.card-btn-reject', 'o foco do teclado que estava na barra não ficou prometido ao ✕');
  m.soltar();
  await busca;
});

test('R14-2-04: CONTROLE — com o card do autor na fila, a barra FICA, contando (o instrumento enxerga a barra na tela)', async () => {
  const c = montarBarra({ fila: [P(1, { creatorId: 7, createdBy: 'autor7' })] });
  await c.h.startFetching();
  assert.equal(c.visivel(), true, 'CONTROLE: a barra sumiu com o card do autor na fila');
  assert.equal(c.doc.els.focoAutorContagem.textContent, '1 de 1');
  assert.equal(c.AppState.autorEmFoco, 7);
});

// ═══ R14-2-05 + R14-6-02 · o refazer AUTOMÁTICO da fila VAZIA e a janela do Desfazer ═══
// (auditoria da rodada 14; os irmãos do R13-6-01 na fila vazia). A última
// decisão da fila — a fila guardada aberta sem sinal, ou com "Minha área" a que
// esperava o perfil — fica na janela do Desfazer com a fila VAZIA. O refazer
// sozinho dela (a rede que volta: `online` → `retomarBusca`; o perfil que chega
// com "Minha área": `completarPerfilChegado` → `retomarBusca`) passava pelo
// `resetQueue`, que DESPACHA a janela: o ✕ ia ao Waze 1,4 s depois do toque e o
// "Desfazer" sumia (MEDIDO no navegador, nos dois motores; roteiros
// r14-2/s/k3, r14-6/p1u). Agora o refazer espera o FIM da janela (`aoFim`, no
// objeto dela); o "Tentar de novo" é gesto, e despacha como o ↻.
//
// Aqui roda o `scheduleAction` de VERDADE (a janela, o timer e os ganchos do fim
// dela), com o `retomarBusca`, a `refazerFilaReal`, a `filaReal` e o
// `resetQueue` de verdade. A busca é um espião.
function montarJanela({ fila = [] } = {}) {
  const log = [];
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0] || null, hasMore: false, loadError: true,
    fetchEpoch: 0, serverTotal: fila.length, pendingAction: null, inFlightActions: 0, stats: { read: 0, rejected: 0, skipped: 0 },
    preferences: { undoEnabled: true }, serverBlocked: 0, blockedPartial: false, ultimaBusca: null };
  const deps = {
    AppState, Treino: { ativo: false }, API: { getRegion: () => 'row' },
    UNDO_WINDOW_MS: 40, canDisableUndo: () => false, presencaFolhaAberta: () => false,
    startFetching: () => log.push('busca (fila refeita)'), maybePrefetch: () => log.push('reposição'),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; log.push('card'); },
    updatePendingCount: () => {}, t: (k) => k, showToast: (m) => log.push('aviso:' + m),
    pedidosQueEntraramNaFila: new Set(), bloqueadosPorPagina: new Map(),
    tratouNestaFila: false, recusaAutomaticaNestaFila: false, filaAtravessouSessao: false, puladosNoInicioDaFila: 0,
    filaEsperaPerfil: false, rebuscasAuto: 0, filaDeOnde: null,
  };
  const h = montar(['scheduleAction', 'retomarBusca', 'refazerFilaReal', 'filaReal', 'resetQueue'], deps);
  // O ✕ no ÚLTIMO card: a janela do Desfazer abre com a fila vazia.
  const decidir = () => h.scheduleAction('reject', P(1), async () => { log.push('✕ enviado'); });
  return { h, deps, AppState, log, decidir };
}

test('R14-2-05: a rede que volta DENTRO da janela da última decisão (fila vazia) — a janela corre até o fim, e a fila é atualizada depois', async () => {
  const m = montarJanela();
  m.decidir();
  assert.ok(m.AppState.pendingAction, 'PRÉ-CONDIÇÃO: a janela do Desfazer não abriu');
  m.h.retomarBusca();                              // o `online`
  await tique(5);
  assert.deepEqual(m.log, [], `DEFEITO: o refazer automático despachou a janela do Desfazer antes da hora (R14-2-05): ${m.log}`);
  assert.ok(m.AppState.pendingAction, 'DEFEITO: o "Desfazer" sumiu antes do fim da janela (R14-2-05)');
  await ateQue(() => m.log.includes('busca (fila refeita)'), 'a fila atualizada no fim da janela');
  assert.deepEqual(m.log, ['✕ enviado', 'busca (fila refeita)'],
    'no fim da janela a decisão sai e a fila vazia é atualizada, nessa ordem, uma vez');
  assert.equal(m.AppState.fetchEpoch, 1, 'a fila vazia não foi refeita (o atualizar: os pulados sem sinal não voltam)');
});

test('R14-2-05: CONTROLE — o "Tentar de novo" (gesto) despacha a janela na hora, como o ↻ (o instrumento enxerga o despacho)', async () => {
  const c = montarJanela();
  c.decidir();
  c.h.retomarBusca({ gesto: true });
  await tique(1);
  assert.deepEqual(c.log.slice(0, 2), ['✕ enviado', 'busca (fila refeita)'],
    `CONTROLE: o gesto não despachou a janela — o instrumento não enxerga o despacho: ${c.log}`);
  assert.equal(c.AppState.pendingAction, null);
  await tique(60);
  assert.deepEqual(c.log, ['✕ enviado', 'busca (fila refeita)'], 'a fila foi refeita DUAS vezes (o fim da janela refez de novo)');
});

test('R14-2-05: desfeita a última decisão, o card volta e a busca só RETOMA (a fila não é refeita por baixo do card)', async () => {
  const m = montarJanela();
  m.decidir();
  m.h.retomarBusca();
  m.AppState.pendingAction.undo();                 // o "Desfazer" (o `desfazerAcaoPendente`)
  m.AppState.pendingAction = null;
  await tique(5);
  assert.deepEqual(m.log, ['card', 'reposição'], `o Desfazer não devolveu o card, ou a busca não só retomou: ${m.log}`);
  assert.deepEqual([m.AppState.fetchEpoch, m.AppState.loadError, m.AppState.hasMore], [0, false, true],
    'a busca não foi retomada (ou a fila foi refeita por baixo do card que voltou)');
  await tique(60);
  assert.ok(!m.log.includes('✕ enviado'), 'a decisão desfeita foi enviada');
});

test('R14-2-05: a queda (ou o "Sair") cancela a janela — e o refazer que esperava por ela não acontece', async () => {
  const m = montarJanela();
  m.decidir();
  m.h.retomarBusca();
  m.AppState.pendingAction.cancel(true);           // a queda: `derrubarSessao`
  m.AppState.pendingAction = null;
  m.AppState.authenticated = false;
  await tique(80);
  assert.ok(!m.log.includes('busca (fila refeita)') && !m.log.includes('reposição'),
    `o refazer adiado rodou depois da queda — apagaria a falha que a renovação lê (R14-1-01): ${m.log}`);
  // E com a sessão de pé: a conta em dúvida (`conferirContaDestaAba`) também
  // cancela a janela, e a aba segue com sessão — o refazer adiado não roda nela.
  const d = montarJanela();
  d.decidir();
  d.h.retomarBusca();
  d.AppState.pendingAction.cancel(true);
  d.AppState.pendingAction = null;
  await tique(80);
  assert.ok(!d.log.includes('busca (fila refeita)') && !d.log.includes('reposição'),
    `o refazer adiado rodou depois de a janela ser CANCELADA (a conta em dúvida): ${d.log}`);
  assert.ok(d.log.includes('card'), 'PRÉ-CONDIÇÃO: o cancelamento não devolveu o pedido à fila');
});

test('R14-2-05: o ↻ DENTRO da janela, com o refazer automático esperando — a fila é refeita UMA vez (a do ↻)', async () => {
  const m = montarJanela();
  m.decidir();
  m.h.retomarBusca();
  m.h.resetQueue();                                // o ↻: `resetQueue` + `startFetching`
  m.deps.startFetching();
  await tique(60);
  assert.equal(m.log.filter((l) => l === 'busca (fila refeita)').length, 1,
    `a fila foi refeita duas vezes — uma busca a mais no free tier: ${m.log}`);
  assert.equal(m.AppState.fetchEpoch, 1);
});

test('R14-2-05: a janela que acaba pela FILA DE SAÍDA (a página saindo sem rede, ou a decisão que outra aba já tinha) também atende o refazer', async () => {
  for (const [rotulo, r, fechar] of [['sem rede', true, (p) => p.enfileirarSemRede()], ['repetida', 'repetida', (p) => p.descarregar()]]) {
    const m = montarJanela();
    m.deps.enfileirarSaida = () => r;
    m.decidir();
    m.h.retomarBusca();
    await tique(1);
    assert.deepEqual(m.log, [], `(${rotulo}) PRÉ-CONDIÇÃO: o refazer não esperou a janela`);
    fechar(m.AppState.pendingAction);
    await tique(5);
    assert.ok(!m.log.includes('✕ enviado'), `(${rotulo}) PRÉ-CONDIÇÃO: a decisão saiu pela rede em vez da fila de saída`);
    assert.ok(m.log.includes('busca (fila refeita)'),
      `(${rotulo}) a janela acabou pela fila de saída e o refazer que esperava por ela não aconteceu: ${m.log}`);
  }
});

test('R14-6-02: a `refazerFilaReal` sozinha (o perfil, o país do perfil) também espera a janela da última decisão', async () => {
  const m = montarJanela();
  m.decidir();
  m.h.refazerFilaReal({ chave: 'toast.paisDoPerfil', pais: 'France' });
  await tique(5);
  assert.deepEqual(m.log, [], `a fila foi refeita (e a janela despachada) antes do fim dela: ${m.log}`);
  await ateQue(() => m.log.includes('busca (fila refeita)'), 'a fila refeita no fim da janela');
  assert.deepEqual(m.log, ['✕ enviado', 'aviso:toast.paisDoPerfil', 'busca (fila refeita)'],
    'no fim da janela a decisão sai, e só então a fila é refeita, com o aviso dela');
});
