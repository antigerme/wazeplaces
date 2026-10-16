// A ABERTURA com "Perto de casa"/"Perto do trabalho" SALVO — auditoria da rodada
// 24 (R24-2-03 = R24-8-02; a pista da produção: o 1º card a 39 km, 2 de 3
// aberturas). A fila chegava antes do perfil, e o perfil (a casa) só é aplicado
// depois de perfil + países: o card montava por data e o mais perto ficava
// atrás. Agora, com a fila na mão e a ordem de distância salva, o card espera o
// perfil — com o TETO da espera que a fila vazia já tem —, e a casa ordena a fila
// inteira antes de haver card (`guardarReferencias`).
//
// O `startFetching` e o `fetchNextPage` RODAM de verdade, fatiados do app.js,
// contra uma API de mentira; o perfil chega quando o teste manda, e os prazos
// (`setTimeout`) são do teste. Cada teste foi visto REPROVANDO sem o conserto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
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

const CASA = [-23.55, -46.63];
const km = (k) => [CASA[0] + k / 111.2, CASA[1]];
// Na ordem de DATA (a que o Waze devolve): o 1º é o mais novo — e o mais LONGE.
const DIST = [39, 12, 1, 25, 5, 30];
const PEDIDOS = DIST.map((d, i) => ({ venueID: 'v' + (i + 1), updateRequestID: 'u' + (i + 1), dateAdded: 1000 - i, mapa: { centro: km(d) } }));

function montar({ sortOrder = 'casa', perfilNoAr = true, perfilJaChegou = false } = {}) {
  const log = [];
  const AppState = {
    authenticated: true, hasMore: true, fetching: false, fetchEpoch: 0, queue: [], currentPlace: null,
    serverTotal: 0, serverBlocked: 0, blockedPartial: false, loadError: false, ultimaBusca: null, autorEmFoco: null,
    filters: { unreadOnly: true, types: constante('TYPES_ALL').slice(), residential: '', myArea: false, stateId: '', managedAreaId: '',
      categories: [], sortOrder },
    profile: perfilJaChegou ? { id: 1 } : null,
  };
  let chegou = () => {};
  const prazos = [];
  const tratamento = { treino: { ativo: false } };
  const pedidos = [];
  const deps = {
    AppState, TYPES_ALL: constante('TYPES_ALL'), PREFETCH_THRESHOLD: constante('PREFETCH_THRESHOLD'),
    MAX_EMPTY_PAGES: constante('MAX_EMPTY_PAGES'), MAX_PAGINAS_POR_BUSCA: constante('MAX_PAGINAS_POR_BUSCA'),
    ORDENS_POR_DISTANCIA: constante('ORDENS_POR_DISTANCIA'), ORDEM_PADRAO: constante('ORDEM_PADRAO'),
    FILA_VAZIA_ESPERA_PERFIL_MS: constante('FILA_VAZIA_ESPERA_PERFIL_MS'),
    document: { getElementById: () => ({ classList: { add() {}, remove() {} } }) },
    navigator: { onLine: true }, Treino: tratamento.treino, console: { error: () => {} },
    API: { fetchPlaces: async (page) => { pedidos.push(page); return { success: true, places: PEDIDOS.map((p) => ({ ...p })), hasMore: false, page, total: 6, blocked: 0 }; },
           getRegion: () => 'row', getCountry: () => '30' },
    dfato: () => {}, dlog: () => {}, dlogVigiar: () => {}, dlogVoltou: () => {}, dlogCapturarAuto: () => {},
    handleUnauthorized: () => {}, showToast: () => {}, msgDoServidor: (r, d) => d, t: (k) => k,
    guardarPrazoDaSessao: () => {}, offlineGravarFila: () => {}, trackSeenCategories: () => {},
    aplicarRecusaAutomatica: () => {}, aoMudarAFilaPorBaixo: () => {}, offlineVarrer: () => {}, updatePendingCount: () => {},
    bloqueadosPorPagina: new Map(), pedidosQueEntraramNaFila: new Set(), pedidosEmAndamento: new Set(),
    pousosDaPagina: new Map(), offlineLigado: () => false, offlineLerPousos: () => [], carregarFilaDeSaida: () => [],
    lugarAgora: () => ({ regiao: 'row', pais: '30' }), refazerPerfilSeFaltar: () => {},
    refazerDecisaoSemResposta: () => null, lerServidorDaMinhaArea: () => null,
    showLoading: (v) => log.push(v ? 'esqueleto' : 'sem-esqueleto'), removeCurrentCardEl: () => {}, renderFocoAutor: () => {},
    epocaDaSessao: 0, cardDaFrente: () => null, maybePrefetch: () => {}, showNoPlaces: () => log.push('vazio'),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; log.push('card:' + (AppState.currentPlace && AppState.currentPlace.venueID)); },
    abrirGuardadaDepoisDaFalha: async () => false, pedidoDoCard: () => null, limparFocoAutor: () => {},
    setTimeout: (f, ms) => { prazos.push({ f, ms }); return prazos.length; },
    clearTimeout: (id) => { if (prazos[id - 1]) prazos[id - 1].f = null; },
  };
  if (perfilNoAr) {
    // O perfil CHEGA como o `definirPerfil` → `guardarReferencias` o põe: a casa na
    // memória e, sem card na tela, a fila inteira ordenada.
    AppState._profilePromise = new Promise((ok) => { chegou = () => { deps.__chegou(); ok(); }; });
  }
  const nomes = ['chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila', 'ordemDoWaze',
    'ordemPrecisaDaFilaInteira', 'ordemValida', 'ordemSalvaEsperaOPerfil', 'referenciaDaOrdem', 'distanciaKm', 'pontoDoPlace',
    'sortQueue', 'manterFocoNaFrente', 'fetchNextPage', 'startFetching', 'esperarOLugarDaFilaVazia', 'decideOLugarDeAgora'];
  const chaves = Object.keys(deps).filter((k) => k !== '__chegou');
  const app = new Function(...chaves, `let filaDeOnde = null; let rebuscasAuto = 0; let filaEsperaPerfil = false;
    let buscaEsperaOPerfil = false; let ultimaBuscaFalhouPorRede = false; let buscaSemResposta = false;
    let lugarDoPedidoDoPerfil = null; let perfilFalhouPorRede = false;
    let referenciasDoPerfil = null; let posicaoGps = null;\n`
    + nomes.map(fatiar).join('\n')
    + `\nreturn { startFetching, receberPerfil(refs) { AppState.profile = { id: 1 }; referenciasDoPerfil = refs;
      if (!AppState.currentPlace && ORDENS_POR_DISTANCIA.includes(AppState.filters.sortOrder) && referenciaDaOrdem(AppState.filters.sortOrder)) sortQueue(); },
      espera: () => buscaEsperaOPerfil };`)(...chaves.map((k) => deps[k]));
  deps.__chegou = () => {};
  return { app, AppState, log, prazos, pedidos, treino: tratamento.treino,
    chegarPerfil: (refs = { casa: CASA, trabalho: null }) => { app.receberPerfil(refs); chegou(); } };
}
const tique = () => new Promise((ok) => setTimeout(ok, 0));
const assentar = async () => { for (let i = 0; i < 30; i++) await tique(); };

test('R24-2-03: "Perto de casa" salvo e a fila ANTES do perfil — o card espera a casa, e o 1º é o mais perto (1 km), não o 1º por data (39 km)', async () => {
  const m = montar();
  const busca = m.app.startFetching();
  await assentar();
  assert.deepEqual(m.log, ['esqueleto'], 'o card montou com a fila por data antes de o perfil chegar');
  assert.equal(m.pedidos.length, 1, 'a espera pelo perfil pediu a fila mais de uma vez');
  m.chegarPerfil();
  await busca;
  assert.deepEqual(m.log.slice(-1), ['card:v3'], `o primeiro card não é o mais perto de casa (${m.log.join(',')})`);
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v3', 'v5', 'v2', 'v4', 'v6', 'v1']);
});

test('R24-2-03: o perfil que NÃO vem dentro do teto não trava a abertura — o card sai por data, como sempre', async () => {
  const m = montar();
  const busca = m.app.startFetching();
  await assentar();
  assert.deepEqual(m.log, ['esqueleto']);
  const teto = m.prazos.filter((p) => p.f && p.ms === 4000);
  assert.equal(teto.length, 1, 'a espera não tem o teto da fila vazia');
  teto[0].f();
  await busca;
  assert.equal(m.AppState.currentPlace.venueID, 'v1', 'passado o teto o card deve abrir com a fila por data');
  assert.equal(m.log.slice(-1)[0], 'card:v1');
  // E o perfil que chegar depois ordena o RESTO por baixo do card (o
  // `completarPerfilChegado`, que tem teste próprio): aqui só não se perde.
});

test('R24-2-03: CONTROLES — a ordem padrão, o GPS e o perfil que já chegou NÃO esperam nada', async () => {
  for (const [rotulo, opcoes] of [['newest', { sortOrder: 'newest' }], ['oldest', { sortOrder: 'oldest' }], ['gps', { sortOrder: 'gps' }],
    ['perfil já na mão', { perfilJaChegou: true }]]) {
    const m = montar(opcoes);
    await m.app.startFetching();
    assert.equal(m.log.slice(-1)[0].startsWith('card:'), true, `${rotulo}: esperou o perfil sem precisar (${m.log.join(',')})`);
    assert.equal(m.prazos.length, 0, `${rotulo}: armou um prazo de espera`);
  }
});

test('R24-2-03: o "Perto do trabalho" salvo espera igual ao "Perto de casa"', async () => {
  const m = montar({ sortOrder: 'trabalho' });
  const busca = m.app.startFetching();
  await assentar();
  assert.deepEqual(m.log, ['esqueleto']);
  m.chegarPerfil({ casa: null, trabalho: CASA });
  await busca;
  assert.equal(m.log.slice(-1)[0], 'card:v3');
});

test('R24-2-03: a fila refeita ou o treino aberto durante a espera — a busca antiga NÃO desenha card', async () => {
  const a = montar();
  const buscaA = a.app.startFetching();
  await assentar();
  a.AppState.fetchEpoch++;   // o ↻ / "Aplicar": outra fila
  a.chegarPerfil();
  await buscaA;
  assert.deepEqual(a.log, ['esqueleto'], 'a busca de uma fila que já não existe desenhou card');
  const b = montar();
  const buscaB = b.app.startFetching();
  await assentar();
  b.treino.ativo = true;     // o treino abriu na espera
  b.chegarPerfil();
  await buscaB;
  assert.deepEqual(b.log, ['esqueleto'], 'a busca desenhou card por cima do treino');
});

test('R24-2-03: a espera é a marca "carregando" do "Restam" (…), e é desfeita ao fim', async () => {
  const m = montar();
  const busca = m.app.startFetching();
  await assentar();
  assert.notEqual(m.app.espera(), false, 'o "Restam" não diz que a fila ainda carrega enquanto espera o perfil');
  m.chegarPerfil();
  await busca;
  assert.equal(m.app.espera(), false, 'a marca de espera ficou presa');
});
