// O "Restam" enquanto a fila CARREGA e quando ela FALHA (auditoria de
// 2026-10-02, R6-2-04 e R6-2-05). Zero não é "não sei": zero é "tudo limpo", o
// oposto — o `updatePendingCount` escreve "…" com a busca no ar e "—" com a
// falha. Dois buracos nessa promessa, os dois MEDIDOS no navegador:
//
//   · R6-2-04 — "Restam 0+" com o esqueleto na tela, na abertura e no ↻ (s47,
//     a busca levando 3 s): o `startFetching` escrevia o contador ANTES de o
//     `fetchNextPage` ligar o `fetching`, e nada o reescrevia durante a busca.
//   · R6-2-05 — "Restam 0+" sob o "Falha ao carregar" (s36, Chromium e WebKit):
//     a contagem animada do ↻ (40 → 0, ~460 ms) seguia escrevendo por cima do
//     "—" que a falha rápida (502 em ~50 ms) tinha escrito.
//
// Aqui RODAM as funções de verdade, fatiadas do app.js: o `startFetching`, o
// `fetchNextPage`, o `updatePendingCount` e o `setCount`, com o relógio de
// quadros (`requestAnimationFrame`) e a API de mentira. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
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
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  i = APP_SEM.indexOf('{', i);
  let prof = 0, fim = APP_SEM.length;
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fim);
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function('return (' + m[1] + ');')();
};
const achar = (nome) => new RegExp('^(async )?function ' + nome + '\\(', 'm').test(APP_SEM);
const pedido = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i });

// O app: a busca, a tela de carregar e o contador de verdade. A API segura a
// resposta até o teste soltar (`soltar(resposta)`); os quadros andam quando o
// teste manda (`quadros(ms)`), como no `contadorDeMentira` do R5-2-10.
function montar({ serverTotal = 0, texto = '—', fila = [], myArea = false, perfilNoAr = false, onLine = true } = {}) {
  let relogio = 0;
  const pendentes = new Map();
  let proximo = 0;
  const el = { textContent: texto, classList: { add() {}, remove() {} } };
  const AppState = {
    authenticated: true, hasMore: true, fetching: false, fetchEpoch: 0, queue: fila.slice(), currentPlace: null,
    serverTotal, serverBlocked: 0, blockedPartial: false, loadError: false, ultimaBusca: null,
    filters: { unreadOnly: true, types: constante('TYPES_ALL').slice(), residential: '', myArea, stateId: '', managedAreaId: '',
      categories: [], sortOrder: 'newest' },
    profile: null,
  };
  let soltarPerfil = () => {};
  if (perfilNoAr) AppState._profilePromise = new Promise((ok) => { soltarPerfil = () => { AppState.profile = { areas: [] }; ok(); }; });
  let soltar = null;
  const tela = [];
  const deps = {
    AppState, TYPES_ALL: constante('TYPES_ALL'), PREFETCH_THRESHOLD: constante('PREFETCH_THRESHOLD'),
    MAX_EMPTY_PAGES: constante('MAX_EMPTY_PAGES'), MAX_PAGINAS_POR_BUSCA: constante('MAX_PAGINAS_POR_BUSCA'),
    COUNT_ANIM_MAX_MS: constante('COUNT_ANIM_MAX_MS'), COUNT_ANIM_MIN_MS: constante('COUNT_ANIM_MIN_MS'),
    ORDEM_PADRAO: 'newest', navigator: { onLine }, Treino: { ativo: false }, console: { error: () => {} },
    API: { fetchPlaces: () => new Promise((ok) => { soltar = ok; }) },
    performance: { now: () => relogio },
    requestAnimationFrame: (cb) => { proximo++; pendentes.set(proximo, cb); return proximo; },
    cancelAnimationFrame: (id) => { pendentes.delete(id); },
    prefersReducedMotion: () => false, popCount: () => {},
    atualizarPontoNoIcone: () => {}, atualizarAvisoDeSessao: () => {}, updatePendingTotalHint: () => {},
    document: { getElementById: (id) => (id === 'pendingCount' ? el : { classList: { add() {}, remove() {} } }) },
    dfato: () => {}, dlog: () => {}, dlogVigiar: () => {}, dlogVoltou: () => {}, dlogCapturarAuto: () => {},
    handleUnauthorized: () => {}, showToast: () => {}, msgDoServidor: (r, d) => d, t: (k) => k,
    guardarPrazoDaSessao: () => {}, offlineGravarFila: () => {}, trackSeenCategories: () => {},
    sortQueue: () => {}, aplicarRecusaAutomatica: () => {}, aoMudarAFilaPorBaixo: () => {}, offlineVarrer: () => {},
    bloqueadosPorPagina: new Map(), pedidosQueEntraramNaFila: new Set(), pedidosEmAndamento: new Set(),
    pousosDaPagina: new Map(), offlineLigado: () => false, offlineLerPousos: () => [], carregarFilaDeSaida: () => [],
    lugarAgora: () => ({ regiao: 'row', pais: '30' }), refazerPerfilSeFaltar: () => {},
    caixaDaMinhaArea: () => [1, 2, 3, 4], desligarMinhaAreaSemCaixa: () => {},
    caixaDaMinhaAreaEm: () => [1, 2, 3, 4],   // a caixa no servidor da busca (R9-6-04)
    showLoading: (v) => tela.push(v ? 'esqueleto' : 'sem-esqueleto'), removeCurrentCardEl: () => {},
    showCurrentPlace: () => tela.push('card'), maybePrefetch: () => {}, showNoPlaces: () => tela.push('vazio'),
    abrirGuardadaDepoisDaFalha: async () => false,
  };
  const nomes = ['chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila',
    'ordemDoWaze', 'ordemPrecisaDaFilaInteira', 'fetchNextPage', 'startFetching', 'setCount', 'updatePendingCount'];
  // A função do conserto: no código de antes ela não existe, e o teste tem de
  // reprovar pelo COMPORTAMENTO, não por não achá-la.
  if (achar('pararContagemEmCurso')) nomes.push('pararContagemEmCurso');
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let filaDeOnde = null; let rebuscasAuto = 0; let filaEsperaPerfil = false;
    let ultimaBuscaFalhouPorRede = false; let buscaSemResposta = false; let buscaEsperaOPerfil = false;\n`
    + nomes.map(fatiar).join('\n') + '\nreturn { startFetching, fetchNextPage, updatePendingCount };')(...chaves.map((k) => deps[k]));
  // Roda os quadros pendentes até `ms` adiante (cada um agenda o seguinte).
  const quadros = (ms) => {
    for (const fim = relogio + ms; relogio < fim;) {
      relogio += 16;
      const agora = [...pendentes.entries()];
      pendentes.clear();
      for (const [, cb] of agora) cb(relogio);
    }
  };
  const tique = () => new Promise((ok) => setTimeout(ok, 0));
  return { app, AppState, el, quadros, tique, tela, soltar: (r) => soltar(r), soltarPerfil: () => soltarPerfil(),
    contando: () => pendentes.size > 0 };
}

const TRES = { success: true, places: [pedido(1), pedido(2), pedido(3)], hasMore: false, page: 1, total: 3, blocked: 0 };
const FALHA = { success: false, error: 'x', errorCategory: 'unknown', httpCode: 502 };

// O ↻ com 40 pedidos: o `resetQueue` zera a fila e redesenha o contador — a
// contagem animada 40 → 0 começa —, e o `startFetching` sai logo atrás.
function atualizar(m) {
  m.AppState.queue = [];
  m.AppState.serverTotal = 0;
  m.AppState.hasMore = true;
  m.AppState.fetchEpoch++;
  m.app.updatePendingCount();          // o do `resetQueue`
  return m.app.startFetching();
}

test('R6-2-04: na ABERTURA, com a busca no ar e a fila vazia, o "Restam" diz "…" — nunca "0+"', async () => {
  const m = montar({ texto: '—' });
  const busca = m.app.startFetching();
  await m.tique();
  m.quadros(800);
  assert.equal(m.AppState.fetching, true, 'PRÉ-CONDIÇÃO: a busca está no ar');
  assert.equal(m.el.textContent, '…', `com o esqueleto na tela e a busca no ar, o "Restam" disse "${m.el.textContent}"`);
  m.soltar(TRES);
  await busca;
  m.quadros(800);
  assert.equal(m.el.textContent, '3', 'a busca chegou e o "Restam" não mostrou o que veio');
  assert.deepEqual(m.tela, ['esqueleto', 'sem-esqueleto', 'card']);
});

test('R6-2-04/05: no ↻ com 40 pedidos, o "Restam" passa a "…" e a contagem 40 → 0 não escreve por cima', async () => {
  const m = montar({ serverTotal: 40, texto: '40+', fila: Array.from({ length: 40 }, (_, i) => pedido(i)) });
  const busca = atualizar(m);
  await m.tique();
  assert.equal(m.el.textContent, '…', `logo depois do ↻, o "Restam" disse "${m.el.textContent}"`);
  m.quadros(1500);                       // a contagem do `resetQueue` teria terminado
  assert.equal(m.el.textContent, '…', `a contagem 40 → 0 escreveu "${m.el.textContent}" por cima do "…"`);
  assert.equal(m.contando(), false, 'sobrou quadro da contagem agendado');
  m.soltar(TRES);
  await busca;
  m.quadros(800);
  assert.equal(m.el.textContent, '3');
});

test('R6-2-05: no ↻ com 40 pedidos, a busca que FALHA rápido deixa "—" — a contagem não vira "0+" sob o "Falha ao carregar"', async () => {
  const m = montar({ serverTotal: 40, texto: '40+', fila: Array.from({ length: 40 }, (_, i) => pedido(i)) });
  const busca = atualizar(m);
  await m.tique();
  m.quadros(48);                         // ~50 ms: a contagem ainda no começo
  m.soltar(FALHA);                       // a borda com a origem fora: 502
  await busca;
  assert.equal(m.AppState.loadError, true, 'PRÉ-CONDIÇÃO: a falha marcou o "não sei"');
  assert.deepEqual(m.tela.slice(-1), ['vazio'], 'PRÉ-CONDIÇÃO: o painel de falha');
  m.quadros(1500);
  assert.equal(m.el.textContent, '—', `"Restam ${m.el.textContent}" com o painel "Falha ao carregar" na tela`);
  assert.equal(m.contando(), false, 'sobrou quadro da contagem agendado');
});

test('R6-2-05: SEM REDE a busca nem sai e o "—" fica — a contagem do lote que esvaziou a fila não escreve por cima', async () => {
  // O "Rejeitar os N" levou os 40 da fila (a contagem 40 → 0 começa) e a fila
  // vazia busca de novo: sem rede, o `fetchNextPage` marca o "não sei" na hora,
  // sem passar pelo "…" — é o "—" que tem de parar a contagem.
  const m = montar({ serverTotal: 40, texto: '40+', onLine: false });
  m.AppState.serverTotal = 0;
  m.app.updatePendingCount();
  m.quadros(48);
  await m.app.fetchNextPage();
  assert.equal(m.AppState.loadError, true, 'PRÉ-CONDIÇÃO: sem rede, o "não sei"');
  m.quadros(1500);
  assert.equal(m.el.textContent, '—', `sem rede e sem fila, o "Restam" disse "${m.el.textContent}"`);
  assert.equal(m.contando(), false, 'sobrou quadro da contagem agendado');
});

test('R6-2-05: a contagem PARA também no "—" de quem sai (deslogado) e no "…"', () => {
  for (const [estado, esperado] of [[{ authenticated: false }, '—'], [{ fetching: true }, '…'], [{ loadError: true }, '—']]) {
    const m = montar({ serverTotal: 40, texto: '40+' });
    m.AppState.serverTotal = 0;
    m.app.updatePendingCount();          // a contagem 40 → 0 começa
    m.quadros(48);
    Object.assign(m.AppState, estado);
    m.app.updatePendingCount();
    m.quadros(1500);
    assert.equal(m.el.textContent, esperado, `${JSON.stringify(estado)}: a contagem escreveu "${m.el.textContent}" por cima`);
  }
  // CONTROLE: sem escrita direta no meio, a contagem chega ao alvo (o relógio de quadros anda).
  const c = montar({ serverTotal: 40, texto: '40+' });
  c.AppState.serverTotal = 0;
  c.app.updatePendingCount();
  c.quadros(1500);
  assert.equal(c.el.textContent, '0+');
});

test('R6-2-04: "Minha área" ESPERANDO o perfil pra buscar — o "Restam" diz "…" a espera inteira', async () => {
  const m = montar({ texto: '—', myArea: true, perfilNoAr: true });
  const busca = m.app.startFetching();
  await m.tique();
  m.quadros(800);
  assert.equal(m.AppState.fetching, false, 'PRÉ-CONDIÇÃO: a busca ainda nem saiu (espera o perfil)');
  assert.equal(m.el.textContent, '…', `esperando o perfil, o "Restam" disse "${m.el.textContent}"`);
  m.soltarPerfil();
  await m.tique();
  assert.equal(m.AppState.fetching, true, 'PRÉ-CONDIÇÃO: com o perfil, a busca saiu');
  assert.equal(m.el.textContent, '…');
  m.soltar(TRES);
  await busca;
  m.quadros(800);
  assert.equal(m.el.textContent, '3');
});

test('R6-2-04: CONTROLE — a busca de fundo com cards na fila mostra o número, não "…"', async () => {
  const m = montar({ serverTotal: 5, texto: '5+', fila: [pedido(1), pedido(2), pedido(3), pedido(4), pedido(5)] });
  m.AppState.currentPlace = m.AppState.queue[0];
  const busca = m.app.fetchNextPage();    // o `maybePrefetch`
  await m.tique();
  m.quadros(800);
  assert.equal(m.AppState.fetching, true);
  assert.equal(m.el.textContent, '5+', `com cards na fila, a busca de fundo trocou o número por "${m.el.textContent}"`);
  m.soltar({ success: true, places: [pedido(6)], hasMore: false, page: 1, total: 1, blocked: 0 });
  await busca;
  m.quadros(800);
  assert.equal(m.el.textContent, '6');
});
