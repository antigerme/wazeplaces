// O TREINO guarda a fila REAL — e quem pousa sobre ela com o treino aberto tem
// que achá-la lá (auditoria de 2026-10-02, rodada 7).
//
// O treino troca a fila da tela pela de EXEMPLOS e sobe a época (`fetchEpoch`)
// pra que a busca no ar não pouse pedido real nos exemplos. Mas a fila real não
// foi REFEITA: ela fica guardada (`Treino._salvo`) e volta no `sair()`. O que
// estava no ar sobre ela — o ✕ que o próprio "Praticar" despacha da janela do
// Desfazer, a recusa automática no meio do laço — e o que chega com o treino
// aberto (o perfil, a troca de conta) era tratado como fila refeita, ou caía nos
// exemplos. MEDIDO no navegador pelos auditores:
//   R7-7-04 — o ✕ recusado de vez com o treino aberto não voltava como o
//             próximo card (sumia até uma busca, com o "Restam" um abaixo);
//   R7-2-03 — a recusa automática terminando no treino não descontava o
//             "Restam" ("Tudo limpo!" com "Restam 3");
//   R7-2-04 — o perfil chegando no treino ordenava os EXEMPLOS, e a fila real
//             voltava na ordem velha e sem a recusa automática;
//   R7-7-03 — a troca de conta com o treino aberto esquecia o foco no autor de
//             agora (nulo no treino), e o `encerrar` trazia o da conta anterior;
//   R7-2-06 — o "Sair" do treino pelo teclado largava o foco no <body>.
// E a busca que estava no ar quando o treino abriu segue descartada mesmo
// pousando DEPOIS do `sair()` — que agora devolve a época da fila real.
//
// Os testes RODAM o código de verdade — o objeto `Treino` e as funções que
// pousam, fatiados do app.js — num escopo só (um chama o outro, como no app),
// com a tela de mentira. Cada um tem o CONTROLE sem o treino, e foi visto
// REPROVANDO com o conserto desfeito (sabotagem no relatório da rodada).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fechar(txt, i) {
  let prof = 0;
  for (let j = txt.indexOf('{', i); j < txt.length; j++) {
    if (txt[j] === '{') prof++;
    else if (txt[j] === '}') { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return m[1];
};
function objetoDoTreino() {
  const i = APP_SEM.indexOf('const Treino = {');
  assert.ok(i >= 0, 'o objeto Treino sumiu');
  return APP_SEM.slice(i + 'const Treino = '.length, fechar(APP_SEM, i));
}

const tique = () => new Promise((ok) => setImmediate(ok));
// Um pedido: `autor` é o `creatorId`, `ll` o centro do mapa ([lat, lon]).
const P = (id, autor = 1000, ll = [-10, -40]) => ({ venueID: 'v' + id, updateRequestID: 'u' + id, name: 'Local ' + id,
  creatorId: autor, createdBy: 'autor' + autor, updateTypeKey: 'VENUE', imageUrls: [], dateAdded: 1785203731191 - Number(String(id).replace(/\D/g, '') || 0) * 1000,
  mapa: { centro: ll } });
const ids = (fila) => (fila || []).map((p) => p.updateRequestID);

// Um elemento de mentira: o bastante pro `encerrar`, o `entrar` e o `esquecerFocoAutor`.
function elemento() {
  const classes = new Set();
  return { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
    toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)), replace: (a, b) => { if (classes.delete(a)) classes.add(b); } },
  textContent: '', removeAttribute() {}, setAttribute() {}, children: [] };
}

// O app: o `Treino` de verdade e as funções que pousam sobre a fila — o
// `devolverPedidoRecusado`, o `enviarLote` e a recusa automática, a ordem
// (`sortQueue`, com a casa), o `completarPerfilChegado`, o `esquecerFocoAutor`
// e a decisão depois da queda —, num escopo só. O Waze é de mentira: cada
// rejeição espera o teste responder (`waze.responder`), ou responde na hora.
function montarApp(estado = {}, { wazeNaHora = false } = {}) {
  const log = [];
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: [], currentPlace: null, stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 0, autorEmFoco: null,
    inFlightActions: 0, preferences: { comoFuncionaVisto: true }, filters: { sortOrder: 'newest' }, profile: { id: 1 }, ...estado };
  const els = {};
  const waze = {
    rejeitados: [], noAr: null,
    rejectPlace(v, u) {
      waze.rejeitados.push(u);
      if (wazeNaHora) return Promise.resolve({ success: true });
      return new Promise((ok) => { waze.noAr = ok; });
    },
    // Responde a rejeição que está no ar (o laço manda uma por vez).
    async responder(r = { success: true }) {
      for (let i = 0; i < 100 && !waze.noAr; i++) await tique();
      assert.ok(waze.noAr, 'PRÉ-CONDIÇÃO: nenhuma rejeição no ar pra responder');
      const ok = waze.noAr;
      waze.noAr = null;
      ok(r);
      for (let i = 0; i < 4; i++) await tique();
    },
  };
  const deps = {
    AppState, epocaDaSessao: 0,
    document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    // a tela
    removeUndoBanner: () => {}, savePreferences: () => {}, showLoading: () => {}, updateStats: () => {},
    updatePendingCount: () => {}, showCurrentPlace: () => log.push('card:' + ((AppState.queue[0] || {}).updateRequestID || '-')),
    fecharCamadasDeFoto: () => {}, removeCurrentCardEl: () => {}, maybePrefetch: () => log.push('prefetch'),
    startFetching: () => log.push('busca'), showNoPlaces: () => log.push('vazio'), aoMudarAFilaPorBaixo: () => {},
    t: (k) => k, showToast: () => ({ texto() {}, dispensar() {} }), openModal: () => {},
    // o que seguraria o treino: nada, aqui
    loteDeLidosEmVoo: false, aprovacaoPendente: null, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(),
    enviarPendenciasDoLightbox: () => {},
    // a fila
    pedidosQueEntraramNaFila: new Set(), pedidosEmAndamento: new Set(),
    // a recusa automática (L6+AM, a conta é a dona do aparelho, o 777 marcado)
    podeRecusarAutomaticoAqui: () => true, contaConfirmada: () => true, autoLigado: (id) => id === 777,
    API: { getRegion: () => 'row', rejectPlace: (v, u) => waze.rejectPlace(v, u) },
    carimboDoGesto: () => null, callWithRetry: (fn) => fn(),
    marcarEmAndamento: () => {}, registrarPouso: () => {}, recordHistory: () => {}, registrarRejeicaoDeAutor: () => {},
    registrarAcaoConfirmada: () => {}, saveStats: () => {}, updateInFlightIndicator: () => {}, mostrarResultadoDoLote: () => {},
    handleUnauthorized: () => {}, dfato: () => {}, soltarMarcaDosItens: () => {}, enfileirarSaida: () => true,
    tirarDaFilaDeSaida: () => true, pousouPorOutraAba: () => {}, carregarFilaDeSaida: () => [], salvarFilaDeSaida: () => {},
    reivindicacaoDestaAba: () => ({}),
    // o perfil que chega (a parte dele que não é desta auditoria fica de fora)
    caixaDaMinhaArea: () => null, desligarMinhaAreaSemCaixa: () => {}, esquecerAreaForaDoPerfil: () => false,
    paisDoPerfil: async () => null, irProPaisDoPerfil: async () => {}, resetQueue: () => log.push('resetQueue'), window: {},
    // a decisão depois da queda
    anotadoAntesDoEnvio: new Set(), descargaNaFila: new Set(),
    // a ordem trocada nos Filtros (o `aplicarSoAOrdem`): a barra do foco e as páginas que faltam
    renderFocoAutor: () => {}, ordemPrecisaDaFilaInteira: () => false, buscarORestoDaFila: () => log.push('resto'),
  };
  const fontes = [
    'let recusaAutomaticaRodando = false; let recusaAutomaticaPedidaDeNovo = false; let recusaAutomaticaNestaFila = false;',
    'let filaEsperaPerfil = false; let referenciasDoPerfil = null; let posicaoGps = null;',
    ...['chaveDoPedido', 'serieDoAutor', 'manterFocoNaFrente', 'referenciaDaOrdem', 'distanciaKm', 'pontoDoPlace', 'sortQueue',
      'devolverPedidoRecusado', 'pousouNoWaze', 'descontarGestoSemSessao', 'decisaoDepoisDaQueda', 'enviarLote',
      'aplicarRecusaAutomatica', 'completarPerfilChegado', 'esquecerFocoAutor',
      'limparFocoAutor', 'reordenarFilaNaTela', 'aplicarSoAOrdem'].map(fatiar),
    'const Treino = ' + objetoDoTreino() + ';',
    'return { Treino, devolverPedidoRecusado, decisaoDepoisDaQueda, aplicarRecusaAutomatica, completarPerfilChegado, aplicarSoAOrdem,',
    '  esquecerFocoAutor, casa: (ll) => { referenciasDoPerfil = { casa: ll, trabalho: null }; } };',
  ].join('\n');
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, fontes)(...chaves.map((k) => deps[k]));
  return { app, AppState, deps, waze, log, els };
}

// ═══ R7-7-04 · o ✕ recusado de vez com o treino aberto ══════════════════════
// O ✕ estava na janela do Desfazer, e o "Praticar" o despacha (`Treino.entrar`).
// O Waze o recusa de vez com o treino aberto. Ele segue pendente lá, e sem o
// treino voltaria como o PRÓXIMO card, com o "Restam" subindo junto
// (`devolverPedidoRecusado`). Com a época do treino no lugar, a devolução o dava
// por "fila refeita": não voltava, e o "Restam" ficava um abaixo, com "+".
function recusaDoX({ comTreino, quando = 'noTreino', viaQueda = false }) {
  // O ✕ foi no v1: o gesto já o tirou da fila e descontou o "Restam" (8 → 7).
  const fila = [2, 3, 4, 5, 6, 7, 8].map((i) => P(i));
  const m = montarApp({ queue: fila.slice(), currentPlace: fila[0], serverTotal: 7 });
  for (const p of fila) m.deps.pedidosQueEntraramNaFila.add(p.venueID + '|' + p.updateRequestID);
  m.deps.pedidosQueEntraramNaFila.add('v1|u1');
  const epocaDoGesto = m.AppState.fetchEpoch;   // a FILA do gesto, como o `handleReject` a guarda
  const v1 = P(1);
  const recusar = () => {
    if (viaQueda) m.app.decisaoDepoisDaQueda('reject', v1, { success: false, errorCategory: 'unauthorized' }, m.AppState.stats, epocaDoGesto);
    else m.app.devolverPedidoRecusado(v1, epocaDoGesto);
  };
  let noTreino = null;
  if (comTreino) m.app.Treino.entrar();
  if (quando === 'noTreino') recusar();
  if (comTreino) {
    noTreino = { exemplos: m.AppState.queue.every((p) => p._treino === true), restam: m.AppState.serverTotal };
    m.app.Treino.sair();
  }
  if (quando === 'depoisDoSair') recusar();
  return { fila: ids(m.AppState.queue).slice(0, 3), n: m.AppState.queue.length, restam: m.AppState.serverTotal,
    hasMore: m.AppState.hasMore, epoca: m.AppState.fetchEpoch, noTreino };
}

test('R7-7-04: o ✕ que o "Praticar" despacha, recusado de vez com o treino aberto, volta como o PRÓXIMO card no "Sair" — com o "Restam"', () => {
  const controle = recusaDoX({ comTreino: false });
  assert.deepEqual(controle, { fila: ['u2', 'u1', 'u3'], n: 8, restam: 8, hasMore: false, epoca: 0, noTreino: null },
    'CONTROLE: sem o treino o recusado nem volta como o próximo card — o teste perdeu o sentido');
  const r = recusaDoX({ comTreino: true });
  assert.ok(r.noTreino.exemplos, 'o recusado entrou na fila de EXEMPLOS do treino');
  assert.deepEqual({ ...r, noTreino: null }, controle,
    `DEFEITO: depois do treino o ✕ recusado não voltou como o próximo card (${JSON.stringify(r)}) — some até uma busca, com o "Restam" um abaixo`);
});

test('R7-7-04: a recusa que chega DEPOIS do "Sair" acha a fila do gesto — a época dela voltou com ela', () => {
  const controle = recusaDoX({ comTreino: false, quando: 'depoisDoSair' });
  const r = recusaDoX({ comTreino: true, quando: 'depoisDoSair' });
  assert.deepEqual({ ...r, noTreino: null }, controle,
    `DEFEITO: com a época do treino ainda valendo depois do "Sair", a fila real é dada por refeita (${JSON.stringify(r)})`);
});

test('R7-7-04: a decisão que não pousou porque a SESSÃO caiu com o treino aberto (o V1) volta também', () => {
  const controle = recusaDoX({ comTreino: false, viaQueda: true });
  assert.deepEqual(controle.fila, ['u2', 'u1', 'u3'], 'CONTROLE: sem o treino a queda devolve o pedido (V1)');
  const r = recusaDoX({ comTreino: true, viaQueda: true });
  assert.deepEqual({ ...r, noTreino: null }, controle, `DEFEITO: a queda com o treino aberto perdeu o pedido (${JSON.stringify(r)})`);
});

// ═══ R7-2-03 · a recusa automática no meio, e a pessoa entra no treino ══════
// A recusa tira os pedidos do autor da fila e manda um a um, descontando o
// "Restam" a cada pouso — só na "fila do lote" (`naFilaDoLote`). O treino trocou
// a época, e os pousos do treino não descontavam: a fila real voltava com 3 cards
// e "Restam 6", e no fim "Tudo limpo!" com "Restam 3". O que falha volta pro fim
// da fila do lote — com o treino aberto, a de EXEMPLOS.
async function recusaAutomaticaComTreino(comTreino) {
  const fila = [P(1, 1), ...[2, 3, 4, 5, 6].map((i) => P('x' + i, 777)), P(7, 7), P(8, 8)];
  const m = montarApp({ queue: fila.slice(), currentPlace: fila[0], serverTotal: fila.length });
  const recusa = m.app.aplicarRecusaAutomatica();
  await m.waze.responder();                       // x2
  await m.waze.responder();                       // x3
  if (comTreino) m.app.Treino.entrar();
  await m.waze.responder();                       // x4
  await m.waze.responder();                       // x5
  await m.waze.responder({ success: false, errorCategory: 'unknown' });   // x6: recusado de vez
  await recusa;
  let exemplos = null;
  if (comTreino) {
    exemplos = m.AppState.queue.every((p) => p._treino === true);
    m.app.Treino.sair();
  }
  return { fila: ids(m.AppState.queue), restam: m.AppState.serverTotal, rejeitados: m.waze.rejeitados.length, exemplos };
}

test('R7-2-03: a recusa automática que termina com o treino aberto desconta o "Restam" da fila real — e o que falha volta pra ela', async () => {
  const controle = await recusaAutomaticaComTreino(false);
  assert.deepEqual(controle, { fila: ['u1', 'u7', 'u8', 'ux6'], restam: 4, rejeitados: 5, exemplos: null },
    'CONTROLE: sem o treino o "Restam" não bate com a fila — o teste perdeu o sentido');
  const r = await recusaAutomaticaComTreino(true);
  assert.equal(r.exemplos, true, 'um pedido REAL (o que falhou) entrou na fila de exemplos do treino');
  assert.deepEqual(r.fila, controle.fila, `DEFEITO: o que a recusa não conseguiu rejeitar não voltou pra fila real (${r.fila})`);
  assert.equal(r.restam, controle.restam,
    `DEFEITO: os pousos do treino não descontaram o "Restam" (${r.restam} sobre ${r.fila.length} cards; "Tudo limpo!" com "Restam" > 0)`);
});

// ═══ R7-2-04 · o perfil que chega com o treino aberto ═══════════════════════
// "Perto de casa" salva, a fila chega antes do perfil (com a casa). A pessoa
// entra no treino, e o perfil chega nele: o `completarPerfilChegado` ordenava a
// fila de EXEMPLOS (a ordem por variedade se perdia), a recusa automática saía na
// primeira linha (no treino a fila é de exemplos), e a fila real voltava na ordem
// de data, com os pedidos do autor marcado na tela.
async function perfilNoTreino(comTreino) {
  const CASA = [-23.0, -46.0];
  const fila = [P(1, 1, [-10, -40]), P(2, 2, [-11, -41]), P(3, 3, [-23.001, -46.001]),
    P(4, 777, [-12, -42]), P(5, 777, [-13, -43])];
  const m = montarApp({ queue: fila.slice(), currentPlace: fila[0], serverTotal: 5, filters: { sortOrder: 'casa' } },
    { wazeNaHora: true });
  let ordemDoTreino = null;
  if (comTreino) {
    m.app.Treino.entrar();
    ordemDoTreino = m.AppState.queue.map((p) => p.venueID).join(',');
  }
  // O perfil chega (o `definirPerfil` já guardou a casa).
  m.app.casa(CASA);
  await m.app.completarPerfilChegado({ id: 1 }, 0);
  let treinoDepois = null;
  if (comTreino) {
    treinoDepois = m.AppState.queue.map((p) => p.venueID).join(',');
    m.app.Treino.sair();
  }
  for (let i = 0; i < 10; i++) await tique();     // a recusa automática pousa
  return { fila: ids(m.AppState.queue), restam: m.AppState.serverTotal, rejeitados: m.waze.rejeitados.slice(),
    ordemDoTreino, treinoDepois };
}

test('R7-2-04: o perfil que chega com o treino aberto não ordena os EXEMPLOS — e a fila real volta ordenada e com a recusa automática', async () => {
  const controle = await perfilNoTreino(false);
  assert.deepEqual({ fila: controle.fila, restam: controle.restam, rejeitados: controle.rejeitados },
    { fila: ['u1', 'u3', 'u2'], restam: 3, rejeitados: ['u4', 'u5'] },
    'CONTROLE: sem o treino o perfil não ordena pela casa nem recusa — o teste perdeu o sentido');
  const r = await perfilNoTreino(true);
  assert.equal(r.treinoDepois, r.ordemDoTreino,
    `DEFEITO: o perfil reordenou a fila de EXEMPLOS (${r.ordemDoTreino} → ${r.treinoDepois}): a ordem por variedade se perdeu`);
  assert.deepEqual(r.fila, controle.fila, `DEFEITO: a fila real voltou do treino na ordem velha (${r.fila})`);
  assert.deepEqual(r.rejeitados, controle.rejeitados, 'DEFEITO: a recusa automática não rodou na fila real que voltou');
  assert.equal(r.restam, controle.restam);
});

test('R7-2-04: sem o perfil no treino, o "Sair" não reordena nem recusa nada (só quem esperava por ele)', async () => {
  const fila = [P(1, 1, [-10, -40]), P(4, 777, [-12, -42]), P(2, 2, [-11, -41])];
  const m = montarApp({ queue: fila.slice(), currentPlace: fila[0], serverTotal: 3 }, { wazeNaHora: true });
  m.app.Treino.entrar();
  m.app.Treino.sair();
  for (let i = 0; i < 10; i++) await tique();
  assert.deepEqual(ids(m.AppState.queue), ['u1', 'u4', 'u2'], 'o "Sair" reordenou a fila sem ter chegado perfil nenhum');
  assert.deepEqual(m.waze.rejeitados, [], 'o "Sair" mandou rejeições que ninguém pediu');
});

// ═══ R7-7-03 · o foco no autor, o treino e a troca de conta ═════════════════
// "Primeiro os de X" na conta A, e o treino aberto (o foco fica guardado nele).
// A sessão cai e volta com a conta B: o `esquecerOutraConta` esquece o foco — o
// de agora, nulo no treino — e o `resetQueue` logo depois encerra o treino, que
// DEVOLVIA o da conta A: a fila de B nascia com a série de X na frente.
test('R7-7-03: a troca de conta com o treino aberto esquece TAMBÉM o foco que o treino guardou', () => {
  const fila = [P(1, 500), P(2, 600), P(3, 500)];
  const m = montarApp({ queue: fila.slice(), currentPlace: fila[0], autorEmFoco: 500 });
  m.app.Treino.entrar();
  assert.equal(m.AppState.autorEmFoco, null, 'PRÉ-CONDIÇÃO: no treino o foco da fila real sai da tela');
  m.app.esquecerFocoAutor();        // a troca de conta (`esquecerOutraConta`)
  m.app.Treino.encerrar();          // o `resetQueue` logo depois
  assert.equal(m.AppState.autorEmFoco, null,
    'DEFEITO: o foco no autor da conta ANTERIOR voltou com o fim do treino — a fila da conta nova nasce com a série dele na frente');
  // CONTROLE: a MESMA conta (nada esquecido) — o foco volta, que é o desenho (R6-7-7).
  const c = montarApp({ queue: fila.slice(), currentPlace: fila[0], autorEmFoco: 500 });
  c.app.Treino.entrar();
  c.app.Treino.encerrar();
  assert.equal(c.AppState.autorEmFoco, 500, 'CONTROLE: sem a troca de conta o foco da fila real não voltou');
  // E na ordem inversa (o encerrar antes do esquecer) o resultado é o mesmo.
  const i = montarApp({ queue: fila.slice(), currentPlace: fila[0], autorEmFoco: 500 });
  i.app.Treino.entrar();
  i.app.Treino.encerrar();
  i.app.esquecerFocoAutor();
  assert.equal(i.AppState.autorEmFoco, null);
});

// ═══ A busca que estava no ar quando o treino abriu ══════════════════════════
// O `entrar()` a descarta (sobe a época), e quem busca de novo é o `sair()`.
// Agora o `sair()` DEVOLVE a época da fila real — e a busca de antes do treino,
// ainda no ar, voltaria a valer. Ela segue descartada (`Treino.entradas`).
function montarBusca() {
  const respostas = [];
  const log = [];
  const AppState = { authenticated: true, hasMore: true, fetching: false, fetchEpoch: 0, queue: [], currentPlace: null,
    serverTotal: 0, serverBlocked: 0, blockedPartial: false, loadError: false, ultimaBusca: null, pendingAction: null,
    stats: { read: 0, rejected: 0, skipped: 0 }, autorEmFoco: null, preferences: { comoFuncionaVisto: true },
    filters: { unreadOnly: true, types: [], residential: '', myArea: false, stateId: '', managedAreaId: '', categories: [], sortOrder: 'newest' },
    profile: null };
  const els = {};
  const deps = {
    AppState, TYPES_ALL: [], PREFETCH_THRESHOLD: 3, MAX_EMPTY_PAGES: 5, MAX_PAGINAS_POR_BUSCA: 20, ORDEM_PADRAO: 'newest',
    navigator: { onLine: true },
    API: { fetchPlaces: () => new Promise((ok) => respostas.push(ok)) },
    dfato: () => {}, dlog: () => {}, dlogVigiar: () => {}, dlogVoltou: () => {}, dlogCapturarAuto: () => {},
    handleUnauthorized: () => {}, showToast: () => {}, msgDoServidor: (r, d) => d, t: (k) => k,
    guardarPrazoDaSessao: () => {}, offlineGravarFila: () => {}, trackSeenCategories: () => {}, offlineVarrer: () => {},
    sortQueue: () => {}, aplicarRecusaAutomatica: () => {}, aoMudarAFilaPorBaixo: () => {}, updatePendingCount: () => {},
    bloqueadosPorPagina: new Map(), pedidosQueEntraramNaFila: new Set(), pedidosEmAndamento: new Set(), pousosDaPagina: new Map(),
    offlineLigado: () => false, offlineLerPousos: () => [], carregarFilaDeSaida: () => [], console: { error: () => {} },
    lugarAgora: () => ({ regiao: 'row', pais: '30' }),
    // o treino
    document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    removeUndoBanner: () => {}, savePreferences: () => {}, showLoading: () => {}, updateStats: () => {},
    showCurrentPlace: () => {}, fecharCamadasDeFoto: () => {}, removeCurrentCardEl: () => {},
    maybePrefetch: () => log.push('prefetch'), startFetching: () => log.push('busca'), showNoPlaces: () => {},
    openModal: () => {}, loteDeLidosEmVoo: false, aprovacaoPendente: null, aprovacoesNoAr: new Set(),
    aprovacoesDaQueda: new Map(), enviarPendenciasDoLightbox: () => {}, devolverPedidoRecusado: () => {},
  };
  const fontes = [
    'let filaDeOnde = null; let rebuscasAuto = 0; let ultimaBuscaFalhouPorRede = false; let buscaSemResposta = false; let filaEsperaPerfil = false;',
    ...['chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila', 'ordemDoWaze',
      'ordemPrecisaDaFilaInteira', 'fetchNextPage'].map(fatiar),
    'const Treino = ' + objetoDoTreino() + ';',
    'return { Treino, fetchNextPage };',
  ].join('\n');
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, fontes)(...chaves.map((k) => deps[k]));
  const pagina = (...lista) => ({ success: true, places: lista, hasMore: false, page: 1, total: lista.length, blocked: 0 });
  return { app, AppState, respostas, log, pagina };
}

test('a busca no ar quando o treino ABRIU segue descartada — pousando no treino ou depois do "Sair", que devolve a época', async () => {
  // Pousando DEPOIS do "Sair" (a época já voltou).
  const m = montarBusca();
  const s1 = m.app.fetchNextPage();
  await tique();
  assert.equal(m.respostas.length, 1, 'PRÉ-CONDIÇÃO: a busca saiu');
  m.app.Treino.entrar();
  m.app.Treino.sair();
  assert.equal(m.AppState.fetchEpoch, 0, 'PRÉ-CONDIÇÃO: o "Sair" devolveu a época da fila real');
  m.respostas[0](m.pagina(P(1), P(2)));
  await s1;
  assert.deepEqual(ids(m.AppState.queue), [],
    'DEFEITO: a busca de antes do treino pousou depois do "Sair" — a época devolvida a ressuscitou');
  assert.equal(m.AppState.fetching, false, 'a busca descartada deixou o `fetching` preso');
  // CONTROLE 1: a busca que sai DEPOIS do treino pousa.
  const s2 = m.app.fetchNextPage();
  await tique();
  m.respostas[1](m.pagina(P(1), P(2)));
  await s2;
  assert.deepEqual(ids(m.AppState.queue), ['u1', 'u2'], 'CONTROLE: a busca de depois do treino não pousou');
  // CONTROLE 2: sem treino nenhum, a mesma busca pousa (o instrumento enxerga o pouso).
  const c = montarBusca();
  const sc = c.app.fetchNextPage();
  await tique();
  c.respostas[0](c.pagina(P(1), P(2)));
  await sc;
  assert.deepEqual(ids(c.AppState.queue), ['u1', 'u2']);
  // E pousando DURANTE o treino (o que já valia): nem nos exemplos, nem na fila guardada.
  const d = montarBusca();
  d.AppState.queue = [P(9)];
  d.AppState.currentPlace = d.AppState.queue[0];
  d.AppState.hasMore = true;
  const sd = d.app.fetchNextPage();
  await tique();
  d.app.Treino.entrar();
  const exemplos = d.AppState.queue.map((p) => p.venueID).join(',');
  d.respostas[0](d.pagina(P(1), P(2)));
  await sd;
  assert.equal(d.AppState.queue.map((p) => p.venueID).join(','), exemplos, 'a busca pousou na fila de EXEMPLOS');
  assert.deepEqual(ids(d.app.Treino._salvo.queue), ['u9'], 'a busca pousou na fila guardada pelo treino');
  d.app.Treino.sair();
  assert.deepEqual(ids(d.AppState.queue), ['u9']);
});

// ═══ R7-2-06 (a parte do treino) · o "Sair" pelo teclado ════════════════════
// O "Sair" some com a faixa do treino e o card real volta: pelo teclado o foco
// caía no <body> (MEDIDO no Chromium e no WebKit). O ouvinte de VERDADE (fatiado
// do `setupAppListeners`), o `Treino` de verdade e o foco prometido ao teclado
// (`prometerFocoAoCardQueVem`/`aplicarFocoDoTeclado`), com o DOM de mentira: o
// botão escondido com a faixa não está mais na tela (`getClientRects` vazio),
// mas segura o foco até o próximo desenho — como no navegador.
//
// O ouvinte do "Sair" como está no `setupAppListeners`: a chamada INTEIRA do
// `addEventListener`, pelos parênteses (nunca por distância — gotcha #67).
function ouvinteDoSair() {
  const corpo = fatiar('setupAppListeners');
  const ini = corpo.indexOf("$('treinoSairBtn')?.addEventListener(");
  assert.ok(ini >= 0, 'o ouvinte do "Sair" do treino sumiu do setupAppListeners');
  let par = 0, j = corpo.indexOf('(', corpo.indexOf('addEventListener', ini));
  for (; j < corpo.length; j++) {
    if (corpo[j] === '(') par++;
    else if (corpo[j] === ')') { par--; if (par === 0) break; }
  }
  return corpo.slice(ini, j + 1) + ';';
}
function montarSairPeloTeclado() {
  const d = { activeElement: null, body: { nome: 'body' } };
  d.activeElement = d.body;
  const botao = (nome, naTela = () => true) => {
    const b = { nome, disabled: false, isConnected: true, getClientRects: () => (naTela() ? [1] : []),
      focus() { d.activeElement = b; } };
    return b;
  };
  const faixa = elemento();
  faixa.classList.add('flex');
  const sair = botao('Sair', () => faixa.classList.contains('flex'));
  const card = { bs: { '.card-btn-reject': botao('✕'), '.card-btn-skip': botao('↑'), '.card-btn-read': botao('✓') } };
  card.querySelector = (s) => card.bs[s] || null;
  let naTela = null;
  const els = { treinoBanner: faixa };
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: [P(1), P(2)], currentPlace: null, stats: {}, serverTotal: 2, autorEmFoco: null, preferences: { comoFuncionaVisto: true } };
  AppState.currentPlace = AppState.queue[0];
  const ouvintes = {};
  const deps = {
    AppState, document: Object.assign(d, { getElementById: (id) => (els[id] = els[id] || elemento()) }),
    $: (id) => (id === 'treinoSairBtn' ? { addEventListener: (tipo, fn) => { ouvintes[id] = fn; } } : null),
    removeUndoBanner: () => {}, savePreferences: () => {}, showLoading: () => {}, updateStats: () => {}, updatePendingCount: () => {},
    // O `renderCurrentCard`: o card real entra, e o foco prometido pousa DEPOIS da tarefa.
    showCurrentPlace: () => { naTela = AppState.queue[0] && AppState.queue[0]._treino ? null : card; if (focoDoTecladoPendente()) queueMicrotask(() => app.aplicarFocoDoTeclado()); },
    fecharCamadasDeFoto: () => {}, removeCurrentCardEl: () => { naTela = null; }, maybePrefetch: () => {}, startFetching: () => {},
    showNoPlaces: () => {}, t: (k) => k, showToast: () => {}, openModal: () => {},
    loteDeLidosEmVoo: false, aprovacaoPendente: null, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(),
    enviarPendenciasDoLightbox: () => {}, acoesTravadas: () => false, cardDaFrente: () => naTela, topOpenModal: () => null,
    Lightbox: { isOpen: () => false }, MapaLightbox: { isOpen: () => false },
  };
  let focoDoTecladoPendente = null;
  const fontes = [
    'let focoDoTeclado = null;', 'const BOTAO_DA_ACAO = ' + constante('BOTAO_DA_ACAO') + ';',
    ...['focavelNaTela', 'veioDoTeclado', 'aplicarFocoDoTeclado', 'prometerFocoAoCardQueVem'].map(fatiar),
    'const Treino = ' + objetoDoTreino() + ';',
    ouvinteDoSair(),
    'return { Treino, aplicarFocoDoTeclado, pendente: () => focoDoTeclado };',
  ].join('\n');
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, fontes)(...chaves.map((k) => deps[k]));
  focoDoTecladoPendente = () => app.pendente();
  app.Treino.entrar();
  return { app, d, sair, card, clicar: (ev) => ouvintes.treinoSairBtn({ ...ev, currentTarget: sair }) };
}

test('R7-2-06: o "Sair" do treino pelo TECLADO leva o foco ao ✕ do card real que volta — com o mouse, nada se move', async () => {
  const t = montarSairPeloTeclado();
  assert.equal(t.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino abriu');
  t.sair.focus();
  t.clicar({ detail: 0 });                          // Enter no "Sair" focado
  await tique();
  assert.equal(t.app.Treino.ativo, false, 'PRÉ-CONDIÇÃO: o treino saiu');
  assert.equal(t.d.activeElement, t.card.bs['.card-btn-reject'],
    `DEFEITO: o "Sair" sumiu com a faixa e o foco ficou em ${t.d.activeElement && t.d.activeElement.nome} — o <body> no navegador`);
  // CONTROLES: o mouse e o dedo (detail 1) e o .click() de script não movem o foco.
  for (const [rotulo, ev, focado] of [['mouse', { detail: 1 }, true], ['script', { detail: 0 }, false]]) {
    const c = montarSairPeloTeclado();
    if (focado) c.sair.focus();
    c.clicar(ev);
    await tique();
    assert.equal(c.app.Treino.ativo, false);
    assert.notEqual(c.d.activeElement, c.card.bs['.card-btn-reject'], `${rotulo}: o foco pulou pro card`);
    assert.equal(c.app.pendente(), null, `${rotulo}: o foco ficou prometido sem o teclado`);
  }
});

// ═══ Junção do lote 11 · a ORDEM trocada nos Filtros com o treino aberto ═════
// O "Aplicar" que muda SÓ a ordem (sem pedido novo ao Waze) reordena a fila da
// tela (`reordenarFilaNaTela`). Com o treino aberto, a fila da tela é a de
// EXEMPLOS: a ordem de variedade se perdia, e a fila REAL voltava no "Sair" na
// ordem velha, com o filtro dizendo "Perto de casa". MEDIDO no navegador
// (roteiro da rodada 7, no código do lote 11): exemplos v1,v2,v3,v4 →
// v3,v4,v2,v1, e a real voltando u1,u2,u3,u4; sem o treino, u3,u4,u2,u1.
function ordemNoTreino(comTreino) {
  const fila = [P(1, 1, [-10, -40]), P(2, 2, [-11, -41]), P(3, 3, [-23.001, -46.001]), P(4, 4, [-23.01, -46.01])];
  const m = montarApp({ queue: fila.slice(), currentPlace: fila[0], serverTotal: 4, autorEmFoco: 2 }, { wazeNaHora: true });
  m.app.casa([-23.0, -46.0]);
  let exemplosAntes = null, exemplosDepois = null;
  if (comTreino) { m.app.Treino.entrar(); exemplosAntes = ids(m.AppState.queue); }
  m.AppState.filters.sortOrder = 'casa';   // o "Aplicar" grava a ordem antes do ramo "só a ordem"
  m.app.aplicarSoAOrdem();
  if (comTreino) { exemplosDepois = ids(m.AppState.queue); m.app.Treino.sair(); }
  return { fila: ids(m.AppState.queue), frente: m.AppState.currentPlace && m.AppState.currentPlace.updateRequestID,
    foco: m.AppState.autorEmFoco, exemplosAntes, exemplosDepois };
}

test('junção do lote 11: a ORDEM trocada nos Filtros com o treino aberto não mexe nos EXEMPLOS — e a fila real volta nela', () => {
  const controle = ordemNoTreino(false);
  assert.deepEqual({ fila: controle.fila, frente: controle.frente, foco: controle.foco }, { fila: ['u3', 'u4', 'u2', 'u1'], frente: 'u3', foco: null },
    'CONTROLE: sem o treino a ordem por casa não reordenou a fila (ou não trocou o card, ou manteve o foco) — o teste perdeu o sentido');
  const r = ordemNoTreino(true);
  assert.deepEqual(r.exemplosDepois, r.exemplosAntes,
    `DEFEITO: a ordem nova reordenou os EXEMPLOS do treino (${r.exemplosAntes} → ${r.exemplosDepois}) — a ordem de variedade se perdeu`);
  assert.deepEqual({ fila: r.fila, frente: r.frente, foco: r.foco }, { fila: controle.fila, frente: controle.frente, foco: controle.foco },
    `DEFEITO: no "Sair", a fila real não voltou na ordem pedida (${JSON.stringify({ fila: r.fila, frente: r.frente, foco: r.foco })})`);
});
