// Rodada 14 da auditoria (2026-10-07), a parte das DUAS ABAS, da QUEDA e dos
// LOTES — o lote 18. Medido no navegador pelos roteiros do auditor (r14-2/s/k1,
// k1b, k2, k2c, k2d e k4; r14-8, o "Marcar todos" lento):
//
//  · R14-2-01 — a recusa automática que POUSA depois da queda (a renovação que
//    mantém a fila) deixava o "Restam" um acima por pedido: o ramo da época do
//    `enviarLote` registrava o pouso e não descia o contador, e a fila terminava
//    em "Tudo limpo!" com "Restam 1".
//
// Os testes RODAM o código de verdade, fatiado do app.js, num escopo onde o que
// o teste não fornece é um "buraco negro" (o harness das rodadas 12 e 13). Cada
// um tem o CONTROLE que reprova como o app de antes, e foi visto REPROVANDO com
// o conserto desfeito (sabotagem no relatório do lote 18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const MIN = readFileSync(new URL('../js/min/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Pula a ASSINATURA antes de casar chaves: `enviarLote(places, opts = {})` tem
// um `{}` de parâmetro padrão.
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
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
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function(`return (${m[1]});`)();
};
const CONTA_KEY = constante('CONTA_KEY');
const OFFLINE_POUSOS_KEY = constante('OFFLINE_POUSOS_KEY');
const POUSO_NA_MEMORIA_MS = constante('POUSO_NA_MEMORIA_MS');

const tique = (ms = 2) => new Promise((ok) => setTimeout(ok, ms));
// Espera por CONDIÇÃO, com teto de tempo real — nunca por prazo fixo.
async function ateQue(cond, rotulo, tetoMs = 5000) {
  const fim = performance.now() + tetoMs;
  while (!cond()) {
    if (performance.now() > fim) assert.fail(`${rotulo}: não aconteceu em ${tetoMs / 1000} s`);
    await tique(2);
  }
}
// O relógio de PAREDE andou desde `t` (com o relógio grosso, anda em degraus):
// o dublê de rede só responde depois disso, como uma rede de verdade.
async function relogioAndou(t = Date.now()) {
  const fim = performance.now() + 2000;
  while (Date.now() <= t) {
    if (performance.now() > fim) assert.fail('o relógio de parede não andou');
    await tique(1);
  }
}

// ═══ o harness: o código de verdade num escopo com "buraco negro" ════════════
function buracoNegro(nome, chamou) {
  const f = function () {};
  return new Proxy(f, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then' || typeof k !== 'string') return undefined;
      return buracoNegro(nome + '.' + k, chamou);
    },
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}
function montar(nomes, deps) {
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      return buracoNegro(k, chamou);
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map(fatiar).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}
// O aparelho (o `localStorage`), dividido por quem o recebe.
function aparelho() {
  const guardado = new Map();
  return { guardado, safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null),
    set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) } };
}
// O canal dos pousos, espiado: o que esta aba AVISOU às outras.
const espiaoDoCanal = () => { const posts = []; return { posts, canal: { postMessage: (msg) => posts.push(structuredClone(msg)) } }; };
const sessaoDeMentira = (token) => ({
  sessionToken: token,
  temSessaoNaMemoria() { return !!this.sessionToken; },
  getSession() { return this.sessionToken; },
  getRegion: () => 'row', getCountry: () => 30,
});
const P = (i, autor = 700 + i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, creatorId: autor, createdBy: 'autor' + autor });
const ids = (fila) => (fila || []).map((p) => p.updateRequestID);
const PERFIL = { id: 4242 };

// O pouso de verdade (memória, aparelho com o offline ligado, e o aviso às outras
// abas), com a régua de depois da queda e a conta de agora.
const NOMES_POUSO = ['registrarPousoDepoisDaQueda', 'registrarPouso', 'avisarOutrasAbasDoPouso', 'quemDecideAgora',
  'marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'chaveDoPedido', 'offlineLerPousos', 'pousouNoWaze'];
const depsDoPouso = (canal, safeLS) => ({
  canalDosPousos: canal, pousosDaPagina: new Map(), POUSO_NA_MEMORIA_MS, ultimaEscritaOkEm: 0,
  offlineLigado: () => true, OFFLINE_POUSOS_KEY, OFFLINE_POUSOS_MAX: constante('OFFLINE_POUSOS_MAX'), CONTA_KEY, safeLS,
  // Nenhum "Sair" nesta página (ver `registrarPousoDepoisDaQueda`).
  saiuNestaPagina: false,
});
const pousosNoAparelho = (safeLS) => JSON.parse(safeLS.get(OFFLINE_POUSOS_KEY) || '[]').map((e) => e[0]);

// A QUEDA da sessão com a decisão no ar: a época troca (`derrubarSessao`) e a
// memória fica sem sessão nem perfil até a renovação responder.
const cair = (m) => { m.deps.epocaDaSessao++; m.deps.API.sessionToken = null; m.deps.AppState.profile = null; m.deps.AppState.authenticated = false; };
// A RENOVAÇÃO pela extensão (`manterFila`): a sessão nova, o perfil da MESMA
// conta, e a fila de antes na tela.
const renovar = (m) => { m.deps.API.sessionToken = 'tok-renovado'; m.deps.AppState.profile = { ...PERFIL }; m.deps.AppState.authenticated = true; };
// Entrar DE NOVO (cookies, código, adoção): a sessão nova e a fila NOVA
// (`resetQueue`), que a busca da sessão nova traz sem o que estava em andamento.
const entrarDeNovo = (m, fila = []) => {
  renovar(m);
  m.deps.AppState.fetchEpoch++;
  m.deps.AppState.queue = fila.slice();
  m.deps.AppState.currentPlace = fila[0] || null;
  m.deps.AppState.serverTotal = fila.length;
  m.deps.AppState.hasMore = false;
};
// O "Sair": a fila refeita e a página sem sessão.
const sair = (m) => { m.deps.saiuNestaPagina = true; m.deps.AppState.fetchEpoch++; m.deps.AppState.queue = []; m.deps.AppState.currentPlace = null; };

// ═══ a recusa automática e o "Rejeitar os N" (o `enviarLote` de verdade) ═════
// O 1º pedido do lote está NO AR quando a sessão cai; `entre(m)` mexe na aba
// entre a queda e a resposta (a renovação, entrar de novo, o "Sair"); a resposta
// chega depois.
const AUTOR = 777;
const pedidoDe = (i, autor) => ({ venueID: 'v' + i, updateRequestID: (autor === AUTOR ? 'x' : 'u') + i, creatorId: autor,
  createdBy: autor === AUTOR ? 'spam' : 'autor' + autor });

function montarLote({ auto = true } = {}) {
  const espiao = espiaoDoCanal();
  const { safeLS } = aparelho();
  const fila = [pedidoDe(1, 1001), pedidoDe(2, AUTOR), pedidoDe(3, AUTOR), pedidoDe(4, AUTOR), pedidoDe(5, 1005)];
  const portoes = [];
  const enviados = [];
  const agendadas = [];
  const buscas = [];
  const AppState = { authenticated: true, profile: { ...PERFIL }, queue: fila.slice(), currentPlace: fila[0],
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: fila.length, fetchEpoch: 0, hasMore: false,
    inFlightActions: 0, pendingAction: null, autores: null, autorEmFoco: null };
  const API = { ...sessaoDeMentira('tok-gesto'),
    rejectPlace: (v, u) => new Promise((ok) => { enviados.push(u); portoes.push(ok); }) };
  const deps = {
    AppState, API, ...depsDoPouso(espiao.canal, safeLS), epocaDaSessao: 0, Treino: { ativo: false, _salvo: null },
    acoesTravadas: () => false, scheduleAction: (tipo, places, ex) => agendadas.push(ex),
    pedidosDoAutorNaFila: () => AppState.queue.filter((p) => p.creatorId === AUTOR),
    callWithRetry: (fn) => fn(), carimboDoGesto: () => ({ dia: '2026-10-07', onde: '30', t: 1, lang: 'pt' }),
    carregarFilaDeSaida: () => [], salvarFilaDeSaida: () => {}, enfileirarSaida: () => true, tirarDaFilaDeSaida: () => true,
    reivindicacaoDestaAba: () => ({}), pedidosEmAndamento: new Set(), pedidosQueEntraramNaFila: new Set(),
    // A recusa automática: L6+AM, a conta dona do aparelho, o 777 marcado com o interruptor LIGADO.
    podeRecusarAutomaticoAqui: () => true, contaConfirmada: () => true, autoLigado: (id) => id === AUTOR,
    recusaAutomaticaRodando: false, recusaAutomaticaPedidaDeNovo: false, recusaAutomaticaNestaFila: false,
    decididosPorOutraAbaComCardAqui: new WeakSet(), decididoNaOutraAbaDepoisDe: () => false,
    showToast: () => ({ texto() {}, dispensar() {} }), t: (k) => k, updateStats: () => {}, saveStats: () => {},
    updatePendingCount: () => {}, aoMudarAFilaPorBaixo: () => {},
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
    startFetching: () => buscas.push(AppState.fetchEpoch), maybePrefetch: () => {},
  };
  const h = montar(['rejeitarLoteDoAutor', 'aplicarRecusaAutomatica', 'enviarLote', 'marcarEmAndamento',
    'descontarGestoSemSessao', 'devolverPedidoRecusado', ...NOMES_POUSO], deps);
  const disparar = async (entre, resposta = { success: true }) => {
    let fim;
    if (auto) fim = h.aplicarRecusaAutomatica();
    else {
      h.rejeitarLoteDoAutor(fila[1]);
      assert.equal(agendadas.length, 1, 'PRÉ-CONDIÇÃO: o "Rejeitar os N" agendou o lote');
      fim = agendadas[0]();
    }
    await ateQue(() => portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedido do lote saiu ao Waze');
    cair(h);
    entre(h);
    await relogioAndou();
    portoes.shift()(resposta);
    await fim;
  };
  return { h, deps, AppState, espiao, safeLS, fila, enviados, buscas, disparar, agendadas, portoes };
}

// ═══ R14-2-01 · a recusa automática que pousa depois da queda e o "Restam" ═══
test('R14-2-01: a recusa automática que POUSA depois da queda desce o "Restam" — a fila que atravessou a queda termina em 0, não em 1', async () => {
  const m = montarLote();
  await m.disparar(renovar);
  assert.deepEqual(m.enviados, ['x2'], 'PRÉ-CONDIÇÃO: depois da queda o laço parou (só o 1º saiu)');
  assert.deepEqual(ids(m.AppState.queue), ['u1', 'u5', 'x3', 'x4'],
    `PRÉ-CONDIÇÃO: o que não saiu voltou pra fila que atravessou a queda: ${ids(m.AppState.queue)}`);
  assert.equal(m.AppState.serverTotal, m.AppState.queue.length,
    `DEFEITO: o pedido que pousou depois da queda seguiu no "Restam" (${m.AppState.serverTotal} com ${m.AppState.queue.length} cards) — o fim da fila diria "Tudo limpo!" com "Restam 1"`);
  // CONTROLE: a mesma recusa pousando ANTES da queda — o ramo do sucesso, que
  // já descia (a medida distingue: a régua é a mesma nos dois).
  const c = montarLote();
  await c.disparar(() => {}, { success: true });
  assert.equal(c.AppState.serverTotal, c.AppState.queue.length, 'CONTROLE: sem a queda, o "Restam" não bate com a fila');
});

test('R14-2-01: CONTROLES — a fila REFEITA tem o "Restam" dela, e o "Rejeitar os N" (placar otimista) já desceu no gesto', async () => {
  // Entrou de novo (a fila nova, da busca da sessão nova): o pouso da fila velha
  // não mexe no "Restam" da nova.
  const r = montarLote();
  await r.disparar((h) => entrarDeNovo(h, [pedidoDe(8, 1008), pedidoDe(9, 1009)]));
  assert.equal(r.AppState.serverTotal, 2, `a fila NOVA perdeu um do "Restam" pelo pouso da velha: ${r.AppState.serverTotal}`);
  // O "Rejeitar os N" desce o "Restam" no GESTO (otimista), e o que não pousou
  // volta como card com o "Restam" subindo junto (`devolverPedidoRecusado`): o
  // pouso depois da queda não desce de novo.
  const l = montarLote({ auto: false });
  await l.disparar(renovar);
  assert.deepEqual(ids(l.AppState.queue), ['u1', 'x3', 'x4', 'u5'], `PRÉ-CONDIÇÃO: o que não pousou voltou: ${ids(l.AppState.queue)}`);
  assert.equal(l.AppState.serverTotal, l.AppState.queue.length,
    `o "Rejeitar os N" desceu o "Restam" de novo no pouso de depois da queda: ${l.AppState.serverTotal} com ${l.AppState.queue.length} cards`);
});

// ═══ R14-2-02 · a decisão que NÃO pousou, com a fila REFEITA por quem entrou ═══
// Entrar de novo depois da queda (cookies, código, a sessão do aparelho
// adotada) refaz a fila, e a busca nova deixa de fora o que estava EM ANDAMENTO.
// O que não pousou segue pendente no Waze e não voltava por ninguém: "Tudo
// limpo!" com os pedidos pendentes. Agora passa pela devolução da fila refeita
// (`devolverPedidoRecusado`, de verdade): o objeto velho NÃO entra na fila nova,
// o "pode haver mais" reabre, e sem card na tela a busca da sessão de AGORA sai.
test('R14-2-02: a recusa automática cortada pela queda, com a fila REFEITA por quem entrou de novo — o que não saiu volta pela BUSCA da sessão de agora', async () => {
  const m = montarLote();
  await m.disparar((h) => entrarDeNovo(h, []));
  assert.deepEqual(m.enviados, ['x2'], 'PRÉ-CONDIÇÃO: depois da queda o laço parou (x3 e x4 nunca saíram)');
  assert.deepEqual(ids(m.AppState.queue), [], 'o objeto velho entrou na fila NOVA (quem decide o que volta é a busca)');
  assert.equal(m.AppState.hasMore, true,
    'DEFEITO: o que não saiu sumiu — a fila nova seguiu dizendo que não há mais nada ("Tudo limpo!" com x3 e x4 pendentes)');
  assert.deepEqual(m.buscas, [1], `DEFEITO: com a tela sem card, a busca da sessão de agora não saiu: ${m.buscas}`);
  // Com card na tela, a busca espera a fila acabar (o "pode haver mais" reaberto).
  const c = montarLote();
  await c.disparar((h) => entrarDeNovo(h, [pedidoDe(8, 1008)]));
  assert.deepEqual([ids(c.AppState.queue), c.AppState.hasMore, c.buscas], [['u8'], true, []],
    'com card na tela, a devolução trocou a fila (ou buscou por cima do card)');
});

test('R14-2-02: CONTROLES do lote — o "Sair" (sem sessão) não devolve nem busca; a renovação (a fila que atravessou) devolve como card', async () => {
  const s = montarLote();
  await s.disparar(sair);
  assert.deepEqual([ids(s.AppState.queue), s.AppState.hasMore, s.buscas], [[], false, []],
    'depois do "Sair", o lote da sessão anterior mexeu na página (devolveu ou buscou)');
  const r = montarLote();
  await r.disparar(renovar);
  assert.deepEqual(ids(r.AppState.queue), ['u1', 'u5', 'x3', 'x4'], 'CONTROLE: a renovação não devolveu o que não saiu como card');
  assert.deepEqual(r.buscas, [], 'CONTROLE: a renovação buscou');
});

// O "Rejeitar os N" com o 1º pedido RECUSADO pelo Waze antes da queda (ele vai
// pra devolução do fim do lote) e o 2º no ar quando a sessão cai.
async function rejeitarComRecusaAntesDaQueda(entre) {
  const m = montarLote({ auto: false });
  m.h.rejeitarLoteDoAutor(m.fila[1]);
  assert.equal(m.agendadas.length, 1, 'PRÉ-CONDIÇÃO: o "Rejeitar os N" agendou o lote');
  const fim = m.agendadas[0]();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o x2 saiu');
  m.portoes.shift()({ success: false, errorCategory: 'unknown' });        // recusa de verdade, antes da queda
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o x3 saiu');
  cair(m.h);
  entre(m.h);
  await relogioAndou();
  m.portoes.shift()({ success: false, errorCategory: 'unauthorized', httpCode: 401 });
  await fim;
  return m;
}

test('R14-2-02: o "Rejeitar os N" com uma recusa ANTES da queda — entrando de novo, volta pela busca; depois do "Sair", nada', async () => {
  const e = await rejeitarComRecusaAntesDaQueda((h) => entrarDeNovo(h, []));
  assert.deepEqual([ids(e.AppState.queue), e.AppState.hasMore, e.buscas], [[], true, [1]],
    'DEFEITO: entrando de novo, o recusado e os que não saíram sumiram (ou o objeto velho entrou na fila nova)');
  const s = await rejeitarComRecusaAntesDaQueda(sair);
  assert.deepEqual([ids(s.AppState.queue), s.AppState.hasMore, s.buscas], [[], false, []],
    'depois do "Sair", o recusado da sessão anterior foi devolvido (ou buscou) na página sem sessão');
});

// O ✕/✓ do card: o `handleReject`/`handleMarkAsRead` de verdade, a decisão no
// ar, a QUEDA, e a resposta (401: não pousou) chegando depois de `entre(m)`.
function montarCard(fila = [1, 2, 3].map((i) => P(i))) {
  const espiao = espiaoDoCanal();
  const { safeLS } = aparelho();
  let soltar = null;
  const agendadas = [];
  const buscas = [];
  const AppState = { authenticated: true, profile: { ...PERFIL }, queue: fila.slice(), currentPlace: fila[0],
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: fila.length, fetchEpoch: 0, pendingAction: null,
    hasMore: false, autorEmFoco: null };
  const rede = () => new Promise((ok) => { soltar = ok; });
  const API = { ...sessaoDeMentira('tok-gesto'), rejectPlace: rede, markAsRead: rede };
  const deps = {
    AppState, API, ...depsDoPouso(espiao.canal, safeLS), epocaDaSessao: 0, Treino: { ativo: false },
    acoesTravadas: () => false, direcaoTravada: () => false,
    advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; },
    scheduleAction: (tipo, place, ex) => agendadas.push(ex), callWithRetry: (fn) => fn(),
    anotarAntesDoEnvio: () => true, tirarDaFilaDeSaida: () => true,
    anotadoAntesDoEnvio: new WeakSet(), descargaNaFila: new WeakSet(), pedidosQueEntraramNaFila: new Set(),
    updateStats() {}, saveStats() {}, updatePendingCount() {}, aoMudarAFilaPorBaixo() {},
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
    startFetching: () => buscas.push(AppState.fetchEpoch),
  };
  const h = montar(['handleReject', 'handleMarkAsRead', 'decisaoDepoisDaQueda', 'descontarGestoSemSessao',
    'devolverPedidoRecusado', ...NOMES_POUSO], deps);
  const decidir = async (gesto, entre, resposta = { success: false, errorCategory: 'unauthorized', httpCode: 401 }) => {
    h[gesto]();
    assert.equal(agendadas.length, 1, 'PRÉ-CONDIÇÃO: o gesto agendou o envio');
    const envio = agendadas[0]();
    await ateQue(() => typeof soltar === 'function', 'PRÉ-CONDIÇÃO: a decisão saiu ao Waze');
    cair(h);
    entre(h);
    await relogioAndou();
    soltar(resposta);
    await envio;
  };
  return { h, deps, AppState, espiao, safeLS, fila, buscas, decidir };
}

for (const [gesto, chaveDoPlacar] of [['handleReject', 'rejected'], ['handleMarkAsRead', 'read']]) {
  test(`R14-2-02: o ${chaveDoPlacar === 'rejected' ? '✕' : '✓'} que voltou 401 com a fila REFEITA por quem entrou de novo — o pedido volta pela busca, e não some`, async () => {
    // O roteiro k1b do auditor: a busca nova traz D2 (D1 em andamento fica de fora).
    const m = montarCard([P(1), P(2)]);
    await m.decidir(gesto, (h) => entrarDeNovo(h, [P(2)]));
    assert.equal(m.AppState.stats[chaveDoPlacar], 0, 'PRÉ-CONDIÇÃO: o placar do gesto que não pousou desceu (K7)');
    assert.deepEqual(ids(m.AppState.queue), ['u2'], 'o objeto velho entrou na fila nova');
    assert.equal(m.AppState.hasMore, true,
      'DEFEITO: o pedido que não pousou sumiu — decidido o u2, a fila diria "Tudo limpo!" com o u1 pendente');
    // Sem card na tela (a fila nova veio vazia): a busca da sessão de agora sai já.
    const v = montarCard([P(1)]);
    await v.decidir(gesto, (h) => entrarDeNovo(h, []));
    assert.deepEqual(v.buscas, [1], `DEFEITO: com a tela sem card, a busca não saiu: ${v.buscas}`);
  });
}

test('R14-2-02: CONTROLES do card — o "Sair" não devolve nem busca; a renovação devolve como o próximo card (V1); o que POUSOU não volta', async () => {
  const s = montarCard([P(1)]);
  await s.decidir('handleReject', sair);
  assert.deepEqual([ids(s.AppState.queue), s.AppState.hasMore, s.buscas], [[], false, []],
    'depois do "Sair", a resposta da sessão anterior devolveu ou buscou');
  const r = montarCard();
  await r.decidir('handleReject', renovar);
  assert.deepEqual(ids(r.AppState.queue), ['u2', 'u1', 'u3'], 'CONTROLE: a renovação não devolveu o pedido como o próximo card');
  const p = montarCard([P(1)]);
  await p.decidir('handleReject', (h) => entrarDeNovo(h, []), { success: true });
  assert.deepEqual([p.AppState.hasMore, p.buscas], [false, []], 'o que POUSOU depois da queda voltou a ser procurado');
});

// O "Marcar todos" de verdade, em pedaços de 2: o 1º pedaço no ar, a QUEDA, e
// `entre(m)` antes da resposta (que pousa: o Waze marcou o 1º pedaço); o 2º
// pedaço nunca sai.
async function marcarTodosComQueda(entre) {
  const espiao = espiaoDoCanal();
  const { safeLS } = aparelho();
  const fila = [1, 2, 3].map((i) => P(i));
  const portoes = [];
  const buscas = [];
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { read: 40, rejected: 0, skipped: 0 },
    serverTotal: fila.length, fetchEpoch: 0, hasMore: false, pendingAction: null, inFlightActions: 0, profile: { ...PERFIL },
    autorEmFoco: null };
  const API = { ...sessaoDeMentira('tok-gesto'),
    markAsReadBatch: () => new Promise((ok) => portoes.push(ok)), markAsRead: () => new Promise((ok) => portoes.push(ok)) };
  const deps = {
    AppState, API, ...depsDoPouso(espiao.canal, safeLS), LOTE_LIDOS_PEDACO: 2, epocaDaSessao: 0, Treino: { ativo: false },
    pedidosEmAndamento: new Set(), pedidosQueEntraramNaFila: new Set(), loteDeLidosContado: null, loteDeLidosEmVoo: false,
    escritasConferindo: 0, aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    contaDestaAbaEmDuvida: () => false, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), callWithRetry: (fn) => fn(),
    carimboDoGesto: () => ({ dia: '2026-10-07', onde: '30', t: 1, lang: 'pt' }), decididosPorOutraAbaComCardAqui: new WeakSet(),
    showToast: () => ({ texto() {}, dispensar() {} }), t: (k) => k, msgDoServidor: (r, d) => d,
    document: { getElementById: () => ({ textContent: '' }) }, openModal: () => {}, closeModal: () => {},
    updatePendingCount() {}, aoMudarAFilaPorBaixo() {}, removeCurrentCardEl() {},
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
    startFetching: () => buscas.push(AppState.fetchEpoch), showNoPlaces() {},
  };
  const h = montar(['openBatchReadConfirm', 'handleBatchMarkRead', 'acoesTravadas', 'acoesTravadasForaDaJanela',
    'aprovacaoDaTelaNoAr', 'avisoDaTrava', 'marcarEmAndamento', 'devolverPedidoRecusado', ...NOMES_POUSO], deps);
  h.openBatchReadConfirm();
  const lote = h.handleBatchMarkRead();
  await ateQue(() => portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedaço saiu');
  cair(h);
  entre(h);
  await relogioAndou();
  portoes.shift()({ success: true });            // o 1º pedaço pousa depois da queda
  await lote;
  return { h, deps, AppState, espiao, safeLS, buscas, portoes };
}

test('R14-2-02: o "Marcar todos" cortado pela queda, com a fila REFEITA por quem entrou de novo — o pedaço que nunca saiu volta pela busca', async () => {
  const m = await marcarTodosComQueda((h) => entrarDeNovo(h, []));
  assert.equal(m.portoes.length, 0, 'PRÉ-CONDIÇÃO: o 2º pedaço (o u3) nunca saiu');
  assert.deepEqual(pousosNoAparelho(m.safeLS), ['v1|u1', 'v2|u2'], 'PRÉ-CONDIÇÃO: o pedaço que pousou depois da queda ganhou o pouso');
  assert.deepEqual(ids(m.AppState.queue), [], 'o objeto velho entrou na fila nova');
  assert.equal(m.AppState.hasMore, true,
    'DEFEITO: o pedido que o lote não marcou sumiu — a fila nova dizia "Tudo limpo!" com ele pendente no Waze');
  assert.deepEqual(m.buscas, [1], `DEFEITO: a tela sem card não buscou o que não saiu: ${m.buscas}`);
  // CONTROLE: o "Sair" (sem sessão) não devolve nem busca.
  const s = await marcarTodosComQueda(sair);
  assert.deepEqual([s.AppState.hasMore, s.buscas], [false, []], 'depois do "Sair", o lote da sessão anterior devolveu ou buscou');
});

// ═══ os testes fatiam o FONTE; o app carrega o `js/min/` (gotcha #22) ═════════
test('o bundle GERADO tem os consertos da rodada 14 (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  // R14-2-01: o "Restam" no ramo da época, pela mesma régua do sucesso. O
  // esbuild troca os nomes LOCAIS (não os de topo, como o `AppState`): conta-se
  // o desconto do "Restam" um a um nos dois lados.
  assert.match(fatiar('enviarLote'), /pousou && aoLandar && naFilaDoLote\(\)\) AppState\.serverTotal = /,
    'PRÉ-CONDIÇÃO: o conserto sumiu do fonte');
  const desconto = /AppState\.serverTotal\s*=\s*Math\.max\(0,\s*AppState\.serverTotal\s*-\s*1\)/g;
  assert.ok(contar(APP_SEM, desconto) > 0, 'PRÉ-CONDIÇÃO: o instrumento não acha o desconto no fonte');
  assert.equal(contar(MIN, desconto), contar(APP_SEM, desconto), 'js/min/app.js está atrás do fonte — falta `npm run js`');
  // R14-2-02: a sessão de pé decide a devolução da fila refeita, nos três ramos.
  const sessaoDePe = /AppState\.authenticated\s*===\s*(?:true|!0)/g;
  for (const nome of ['enviarLote', 'decisaoDepoisDaQueda', 'handleBatchMarkRead']) {
    assert.ok(contar(fatiar(nome), sessaoDePe) > 0, `PRÉ-CONDIÇÃO: o conserto sumiu de ${nome}`);
  }
  assert.equal(contar(MIN, sessaoDePe), contar(APP_SEM, sessaoDePe), 'js/min/app.js está atrás do fonte — falta `npm run js`');
});
