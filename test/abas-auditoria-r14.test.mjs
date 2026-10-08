// Rodada 14 da auditoria (2026-10-07), a parte das DUAS ABAS, da QUEDA e dos
// LOTES — o lote 18. Medido no navegador pelos roteiros do auditor (r14-2/s/k1,
// k1b, k2, k2c, k2d e k4; r14-8, o "Marcar todos" lento):
//
//  · R14-2-01 — a recusa automática que POUSA depois da queda (a renovação que
//    mantém a fila) deixava o "Restam" um acima por pedido: o ramo da época do
//    `enviarLote` registrava o pouso e não descia o contador, e a fila terminava
//    em "Tudo limpo!" com "Restam 1".
//  · R14-2-02 — a decisão que NÃO pousou sumia quando a pessoa entrava de novo
//    (a fila refeita sai sem o que estava em andamento): "Tudo limpo!" com os
//    pedidos pendentes. Agora volta pela busca da sessão de agora.
//  · R14-2-03 — o pouso feito com a conta desta aba DESCONHECIDA: depois da queda
//    nem era registrado (com o perfil da renovação chegando antes da resposta), e
//    sem queda o aviso sem conta era jogado fora pela aba de outra sessão da
//    mesma conta — o ✕ de lá ia ao Waze sobre o que o "Marcar todos" daqui tinha
//    marcado. A DECISÃO do owner: registrar com prova positiva de que é a mesma
//    conta, e o aviso sem conta esperar pela MARCA da sessão até a aba que o
//    mandou dizer de quem ela era.
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
  'marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'chaveDoPedido', 'offlineLerPousos', 'pousouNoWaze',
  // A prova de que a conta do gesto (desconhecida nele) é a de agora (R14-2-03).
  'contaDoGestoEhADeAgora', 'filaDoGestoSegueAqui', 'epocaDaFilaRealAgora', 'lembrarMarcaQueAvisouSemConta'];
const depsDoPouso = (canal, safeLS) => ({
  canalDosPousos: canal, pousosDaPagina: new Map(), POUSO_NA_MEMORIA_MS, ultimaEscritaOkEm: 0,
  offlineLigado: () => true, OFFLINE_POUSOS_KEY, OFFLINE_POUSOS_MAX: constante('OFFLINE_POUSOS_MAX'), CONTA_KEY, safeLS,
  // Nenhum "Sair" nesta página (ver `registrarPousoDepoisDaQueda`).
  saiuNestaPagina: false,
  marcasQueAvisaramSemConta: new Map(), MARCAS_QUE_AVISARAM_SEM_CONTA_MAX: constante('MARCAS_QUE_AVISARAM_SEM_CONTA_MAX'),
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
function montarCard(fila = [1, 2, 3].map((i) => P(i)), { semConta = false } = {}) {
  const espiao = espiaoDoCanal();
  const { safeLS } = aparelho();
  let soltar = null;
  const agendadas = [];
  const buscas = [];
  // `semConta`: o gesto sai ANTES de o perfil chegar (a extensão publicada não
  // repassa a conta, ou o perfil falhou) — a conta desta aba é desconhecida.
  const AppState = { authenticated: true, profile: semConta ? null : { ...PERFIL }, queue: fila.slice(), currentPlace: fila[0],
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

// ═══ R14-2-03 (2) · o pouso de depois da queda com a conta do GESTO desconhecida ═
// O roteiro k2 do auditor: o ✕ sai ANTES de o perfil chegar (`quem.conta`
// nula), a sessão cai, a renovação traz o perfil da MESMA conta antes da resposta,
// e a resposta pousa. A régua saía sem registrar nada — nem na página, nem no
// aparelho, nem o aviso às outras abas.
test('R14-2-03: o ✕ feito SEM a conta e que pousa depois da queda é registrado quando a fila do gesto atravessou a queda — e o aviso leva a conta provada', async () => {
  const m = montarCard(undefined, { semConta: true });
  assert.equal(m.h.quemDecideAgora().conta, null, 'PRÉ-CONDIÇÃO: o gesto sai sem a conta');
  await m.decidir('handleReject', renovar, { success: true });
  assert.ok(m.deps.pousosDaPagina.has('v1|u1'),
    'DEFEITO: o pouso de depois da queda, feito sem a conta, não entrou na memória da página (a busca no ar o traria)');
  assert.deepEqual(pousosNoAparelho(m.safeLS), ['v1|u1'], 'DEFEITO: ...nem no aparelho (a fila guardada o devolveria)');
  assert.deepEqual(m.espiao.posts, [{ v: 1, chaves: ['v1|u1'], conta: '4242', s: m.h.marcaDaSessao('tok-gesto') }],
    'DEFEITO: a outra aba não ficou sabendo (ou o aviso foi sem a conta que a fila provou)');
  // CONTROLE: a fila REFEITA (entrou de novo, outra sessão) — sem prova de que
  // a conta do gesto é a de agora, nada (pode ser outra pessoa).
  const r = montarCard(undefined, { semConta: true });
  await r.decidir('handleReject', (h) => entrarDeNovo(h, []), { success: true });
  assert.equal(r.deps.pousosDaPagina.size, 0, 'CONTROLE: sem prova, o pouso de uma conta possivelmente outra entrou na página');
  assert.deepEqual([pousosNoAparelho(r.safeLS), r.espiao.posts], [[], []], 'CONTROLE: sem prova, gravou no aparelho ou avisou');
});

test('R14-2-03: a outra prova — a marca da sessão do GESTO é a desta aba (a mesma sessão é a mesma conta), mesmo com a fila refeita', async () => {
  // A época troca sem trocar de sessão (a conta desta aba em dúvida, R6-1-04), e
  // a fila é refeita (o ↻) antes de o perfil chegar.
  const mesmaSessao = (h) => { h.deps.AppState.profile = { ...PERFIL }; h.deps.AppState.authenticated = true; h.deps.API.sessionToken = 'tok-gesto';
    h.deps.AppState.fetchEpoch++; };
  const m = montarCard(undefined, { semConta: true });
  await m.decidir('handleReject', mesmaSessao, { success: true });
  assert.ok(m.deps.pousosDaPagina.has('v1|u1'), 'DEFEITO: a mesma sessão, com a conta já sabida, não registrou o pouso');
  assert.equal(m.espiao.posts[0] && m.espiao.posts[0].conta, '4242', 'o aviso da mesma sessão saiu sem a conta provada');
  // CONTROLE: a conta do gesto CONHECIDA e diferente da de agora — nada (o R13).
  const o = montarCard();
  await o.decidir('handleMarkAsRead', (h) => { renovar(h); h.deps.AppState.profile = { id: 5151 }; }, { success: true });
  assert.equal(o.deps.pousosDaPagina.size, 0, 'CONTROLE: o "lido" de outra conta entrou na página');
});

test('R14-2-03: sem conta AGORA (a renovação no meio), o pouso vale como antes — e o aviso sai sem conta, com a marca guardada pra depois', async () => {
  const m = montarCard(undefined, { semConta: true });
  await m.decidir('handleReject', (h) => { h.deps.API.sessionToken = 'tok-renovado'; h.deps.AppState.authenticated = true; }, { success: true });
  assert.ok(m.deps.pousosDaPagina.has('v1|u1'), 'sem conta agora, o pouso deixou de valer (a regra do R13-2-01)');
  assert.deepEqual(m.espiao.posts, [{ v: 1, chaves: ['v1|u1'], conta: null, s: m.h.marcaDaSessao('tok-gesto') }]);
  assert.deepEqual([...m.deps.marcasQueAvisaramSemConta], [[m.h.marcaDaSessao('tok-gesto'), 0]],
    'a marca que avisou sem conta não ficou guardada com a fila do gesto (a prova de depois)');
});

// ═══ R14-2-03 (1) · o aviso SEM conta entre duas abas ═══════════════════════════
// Duas abas de mentira da MESMA conta, cada uma com a sua sessão, que dividem o
// aparelho e um canal com a semântica do de verdade (o harness das rodadas 12 e
// 13, com as funções de verdade).
function navegador() {
  const canais = new Map();
  const postados = [];
  let entregas = 0;
  class CanalDeMentira {
    constructor(nome) {
      this.nome = nome;
      this.onmessage = null;
      if (!canais.has(nome)) canais.set(nome, new Set());
      canais.get(nome).add(this);
    }
    postMessage(msg) {
      const dado = structuredClone(msg);
      postados.push({ de: this, dado });
      // Com TETO de entregas: uma aba que respondesse ao aviso avisando de volta
      // viraria um laço, e o teste penduraria em vez de reprovar (gotcha #19).
      for (const outro of canais.get(this.nome)) {
        if (outro === this || ++entregas > 80) continue;
        setTimeout(() => { if (typeof outro.onmessage === 'function') outro.onmessage({ data: structuredClone(dado) }); }, 0);
      }
    }
    close() { canais.get(this.nome).delete(this); }
  }
  return { BroadcastChannel: CanalDeMentira, postados, entregue: () => new Promise((ok) => setTimeout(ok, 5)) };
}

const linhaDoFonte = (re, o) => { const m = re.exec(APP_SEM); assert.ok(m, `${o} sumiu do app.js`); return m[0]; };
const DECLARACOES = [
  linhaDoFonte(/^const CANAL_DOS_POUSOS = '[^']+';$/m, 'o nome do canal dos pousos'),
  linhaDoFonte(/^let canalDosPousos = null;$/m, 'o canal dos pousos'),
  linhaDoFonte(/^const decididasPorOutraAba = new Map\(\);$/m, 'as chaves que a outra aba decidiu'),
  linhaDoFonte(/^const DECIDIDAS_POR_OUTRA_ABA_MAX = \d+;$/m, 'o teto das chaves que a outra aba decidiu'),
  linhaDoFonte(/^const avisosDePousoSemConta = \[\];$/m, 'os avisos que esperam a conta'),
  linhaDoFonte(/^const AVISOS_DE_POUSO_SEM_CONTA_MAX = \d+;$/m, 'o teto dos avisos que esperam a conta'),
  linhaDoFonte(/^const marcasQueAvisaramSemConta = new Map\(\);$/m, 'as marcas que avisaram sem a conta'),
  linhaDoFonte(/^const MARCAS_QUE_AVISARAM_SEM_CONTA_MAX = \d+;$/m, 'o teto das marcas que avisaram sem a conta'),
];
const NOMES_ABA = ['chaveDoPedido', 'filaReal', 'filaRealComDevolvidos', 'anotarDecididosPorOutraAba',
  'lembrarDecididasPorOutraAba', 'decididoNaOutraAbaDepoisDe', 'esquecerDecididasPorOutraAba',
  'tirarDaFilaOQueAOutraAbaDecidiu', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'offlineLerPousos', 'registrarPouso',
  'registrarPousoDepoisDaQueda', 'semOsJaDecididos', 'abrirCanalDosPousos', 'quemDecideAgora', 'avisarOutrasAbasDoPouso',
  'aoPousarEmOutraAba', 'aoPousarSemSessaoNaMemoria', 'guardaASessaoQueCaiu', 'aplicarPousoDeOutraAba', 'guardarAvisoSemConta',
  'aplicarAvisosQueEsperavamAConta', 'marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'aoConhecerConta',
  'carimbarContaNaSaida', 'sessaoDestaAbaEhAGuardada', 'invisivelPedidoAntesDoPerfil', 'carimbarContaNoInvisivel',
  // R14-2-03
  'contaDoGestoEhADeAgora', 'filaDoGestoSegueAqui', 'epocaDaFilaRealAgora', 'lembrarMarcaQueAvisouSemConta',
  'avisarAContaDasMarcas', 'aoSaberAContaDeUmaMarca'];

// Uma ABA: a fila `fila` (o da frente na tela) num aparelho (`ap`, um Map) que as
// abas dividem. `token`: a sessão na MEMÓRIA desta aba; `perfil: null`, a conta
// dela ainda desconhecida.
function aba(nav, { fila, ap, token, perfil = { ...PERFIL } }) {
  const log = [];
  const AppState = { queue: fila.slice(), currentPlace: fila[0] || null, serverTotal: fila.length, profile: perfil,
    stats: { read: 5, rejected: 5, skipped: 5 }, pendingAction: null, fetchEpoch: 0, preferences: {} };
  let leituras = 0;
  const API = {
    sessionToken: token,
    temSessaoNaMemoria() { return !!this.sessionToken; },
    // Como o de verdade: com a memória vazia, LÊ o aparelho e o ADOTA (R9-1-03).
    getSession() {
      if (!this.sessionToken) { leituras++; this.sessionToken = ap.get('waze_session_token') || null; }
      return this.sessionToken;
    },
  };
  const deps = {
    AppState, API, Treino: { ativo: false, _salvo: null }, BroadcastChannel: nav.BroadcastChannel,
    safeLS: { get: (k) => (ap.has(k) ? ap.get(k) : null), set: (k, v) => ap.set(k, String(v)), remove: (k) => ap.delete(k) },
    SAIDA_KEY: constante('SAIDA_KEY'), CONTA_KEY, POUSO_NA_MEMORIA_MS, OFFLINE_POUSOS_KEY, OFFLINE_POUSOS_MAX: 1000,
    offlineLigado: () => false,
    updatePendingCount: () => log.push('restam'), aoMudarAFilaPorBaixo: () => log.push('fundo'),
    esquecerOutraConta: (id) => { log.push('esqueceu:' + id); AppState.queue = []; AppState.currentPlace = null; AppState.fetchEpoch++; },
    esvaziarFilaDeSaida: () => {},
    // O card desenhado na tela, como o `guardaASessaoQueCaiu` o procura.
    document: { querySelector: (sel) => (sel === '#cardStack .place-card' && AppState.currentPlace ? {} : null) },
  };
  const chaves = Object.keys(deps);
  const fonte = [
    'let ultimaEscritaOkEm = 0, contaConfirmadaNestaAba = null, filaAtravessouSessao = false, saidaEsperandoConta = false;',
    'let saiuNestaPagina = false;',
    'const decididosPorOutraAbaComCardAqui = new WeakSet(), pedidosEmAndamento = new Set(), pousosDaPagina = new Map();',
    ...DECLARACOES,
    ...NOMES_ABA.map(fatiar),
    `return { ${NOMES_ABA.join(', ')}, marcado: (p) => decididosPorOutraAbaComCardAqui.has(p), pousosDaPagina,
      esperando: avisosDePousoSemConta, marcas: marcasQueAvisaramSemConta,
      sair: () => { contaConfirmadaNestaAba = null; esquecerDecididasPorOutraAba({ comOsAvisos: true }); } };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  app.abrirCanalDosPousos();
  return { app, AppState, API, log, leituras: () => leituras };
}

// O roteiro k2d do auditor: B (a dona do aparelho) com a conta sabida; A, outra
// sessão da MESMA conta, com a conta ainda desconhecida (o perfil não chegou).
function duasAbasComAContaDeADesconhecida({ fila, contaDeB = PERFIL } = {}) {
  const nav = navegador();
  const ap = new Map([['waze_session_token', 'tok-b']]);
  const B = aba(nav, { fila, ap, token: 'tok-b', perfil: contaDeB ? { ...contaDeB } : null });
  if (contaDeB) ap.set(CONTA_KEY, JSON.stringify({ id: String(contaDeB.id), s: B.app.marcaDaSessao('tok-b') }));
  const A = aba(nav, { fila, ap, token: 'tok-a', perfil: null });
  assert.equal(A.app.contaAgora(), null, 'PRÉ-CONDIÇÃO: a conta de A é desconhecida');
  return { nav, ap, A, B };
}
test('R14-2-03: o "Marcar todos" da aba com a conta DESCONHECIDA chega à outra sessão da mesma conta quando a conta se sabe — o ✕ de lá não vai mais ao Waze', async () => {
  const fila = [1, 2, 3, 4].map((i) => P(i));
  const { nav, A, B } = duasAbasComAContaDeADesconhecida({ fila });
  A.app.registrarPouso([{ ...fila[0] }, { ...fila[1] }, { ...fila[2] }]);   // o "Marcar todos" da A, sem a conta
  await nav.entregue();
  assert.deepEqual(nav.postados.map((x) => x.dado), [{ v: 1, chaves: ['v1|u1', 'v2|u2', 'v3|u3'], conta: null, s: A.app.marcaDaSessao('tok-a') }],
    'PRÉ-CONDIÇÃO: o aviso saiu sem a conta, com a marca da sessão de A');
  assert.deepEqual(ids(B.AppState.queue), ['u1', 'u2', 'u3', 'u4'], 'sem saber de quem era, a B aplicou o aviso');
  assert.deepEqual(B.app.esperando.map((a) => [a.conta, a.s]), [[null, A.app.marcaDaSessao('tok-a')]],
    'DEFEITO: o aviso sem conta foi jogado fora — quando a conta de A se souber, nada mais chega à B');
  // O perfil de A chega: a MESMA conta. A diz pelo canal de quem era a marca.
  A.AppState.profile = { ...PERFIL };
  A.app.aoConhecerConta({ ...PERFIL });
  await nav.entregue();
  assert.deepEqual(nav.postados.at(-1).dado, { v: 1, tipo: 'conta', s: A.app.marcaDaSessao('tok-a'), conta: '4242' },
    'DEFEITO: a aba que avisou sem conta não disse, ao saber a conta, de quem era a marca');
  assert.equal('chaves' in nav.postados.at(-1).dado, false, 'a mensagem da conta leva chaves (as versões de antes a tomariam por um pouso)');
  assert.deepEqual(ids(B.AppState.queue), ['u1', 'u4'],
    `DEFEITO: o que a A marcou seguiu como card na B — o ✕ de lá iria ao Waze, lido e rejeitado: ${ids(B.AppState.queue)}`);
  assert.equal(B.app.marcado(B.AppState.currentPlace), true, 'o card da TELA não ficou anotado (o gesto nele iria ao Waze)');
  assert.equal(B.app.esperando.length, 0, 'o aviso seguiu esperando depois de resolvido');
  assert.equal(A.app.marcas.size, 0, 'a marca resolvida ficou na memória de A');
});

test('R14-2-03: CONTROLE — a conta de A se revela OUTRA: o aviso sai sem efeito na B ("lido" é de cada pessoa)', async () => {
  const fila = [1, 2, 3].map((i) => P(i));
  const { nav, A, B } = duasAbasComAContaDeADesconhecida({ fila });
  A.app.registrarPouso([{ ...fila[0] }, { ...fila[1] }]);
  await nav.entregue();
  A.AppState.profile = { id: 5151 };
  A.app.aoConhecerConta({ id: 5151 });
  await nav.entregue();
  assert.deepEqual(ids(B.AppState.queue), ['u1', 'u2', 'u3'], 'DEFEITO: o pouso de OUTRA conta tirou pedido da fila da B');
  assert.equal(B.app.marcado(fila[0]), false);
  assert.equal(B.app.esperando.length, 0, 'o aviso de outra conta seguiu na memória da B');
});

test('R14-2-03: a B também sem a conta — o aviso passa a esperar a conta DELA, e o perfil dela decide', async () => {
  const fila = [1, 2, 3].map((i) => P(i));
  const { nav, A, B } = duasAbasComAContaDeADesconhecida({ fila, contaDeB: null });
  A.app.registrarPouso([{ ...fila[1] }]);
  await nav.entregue();
  A.AppState.profile = { ...PERFIL };
  A.app.aoConhecerConta({ ...PERFIL });
  await nav.entregue();
  assert.deepEqual(B.app.esperando.map((a) => a.conta), ['4242'], 'o aviso não passou a esperar a conta da B (com a conta de A)');
  assert.deepEqual(ids(B.AppState.queue), ['u1', 'u2', 'u3'], 'sem a conta da B, o aviso foi aplicado');
  B.AppState.profile = { ...PERFIL };
  B.app.aoConhecerConta({ ...PERFIL });
  assert.deepEqual(ids(B.AppState.queue), ['u1', 'u3'], 'a MESMA conta: o que a A decidiu seguiu como card na B');
  // Na ordem inversa — a conta da B se sabe ANTES de a A dizer de quem era a
  // marca —, o aviso pela marca SEGUE esperando: a conta da B não diz nada dele.
  const o = duasAbasComAContaDeADesconhecida({ fila, contaDeB: null });
  o.A.app.registrarPouso([{ ...fila[1] }]);
  await o.nav.entregue();
  o.B.AppState.profile = { ...PERFIL };
  o.B.app.aoConhecerConta({ ...PERFIL });
  assert.equal(o.B.app.esperando.length, 1, 'DEFEITO: a conta da B jogou fora o aviso que esperava a conta de QUEM mandou');
  o.A.AppState.profile = { ...PERFIL };
  o.A.app.aoConhecerConta({ ...PERFIL });
  await o.nav.entregue();
  assert.deepEqual(ids(o.B.AppState.queue), ['u1', 'u3'], 'na ordem inversa, o que a A decidiu seguiu como card na B');
});

test('R14-2-03: a marca só vira conta com PROVA — a fila do gesto refeita (entrou de novo) não diz nada; a que atravessou a queda diz', async () => {
  const fila = [1, 2, 3].map((i) => P(i));
  // A pousa sem a conta na sessão tok-a, e depois ENTRA DE NOVO (sessão nova, fila nova).
  const r = duasAbasComAContaDeADesconhecida({ fila });
  r.A.app.registrarPouso([{ ...fila[1] }]);
  await r.nav.entregue();
  r.A.API.sessionToken = 'tok-a2';
  r.A.AppState.fetchEpoch++;
  r.A.AppState.profile = { ...PERFIL };
  r.A.app.aoConhecerConta({ ...PERFIL });
  await r.nav.entregue();
  assert.equal(r.nav.postados.filter((x) => x.dado.tipo === 'conta').length, 0,
    'DEFEITO: sem prova (a fila foi refeita), a A disse que a marca da sessão anterior era desta conta');
  assert.deepEqual(ids(r.B.AppState.queue), ['u1', 'u2', 'u3'], 'sem prova, o aviso foi aplicado na B');
  // A RENOVAÇÃO que mantém a fila (a mesma conta): a prova da queda.
  const k = duasAbasComAContaDeADesconhecida({ fila });
  const quem = k.A.app.quemDecideAgora();
  k.A.API.sessionToken = null;                                  // a queda, com a decisão no ar
  k.A.API.sessionToken = 'tok-a2';                              // a renovação: a fila FICA
  k.A.app.registrarPousoDepoisDaQueda([{ ...fila[1] }], quem, 0);   // pousa antes do perfil (sem conta agora)
  await k.nav.entregue();
  assert.equal(k.B.app.esperando.length, 1, 'PRÉ-CONDIÇÃO: a B guardou o aviso sem conta');
  k.A.AppState.profile = { ...PERFIL };
  k.A.app.aoConhecerConta({ ...PERFIL });
  await k.nav.entregue();
  assert.deepEqual(k.nav.postados.at(-1).dado, { v: 1, tipo: 'conta', s: k.A.app.marcaDaSessao('tok-a'), conta: '4242' },
    'DEFEITO: com a fila do gesto ainda aqui, a A não disse de quem era a marca da sessão que caiu');
  assert.deepEqual(ids(k.B.AppState.queue), ['u1', 'u3'], 'DEFEITO: o pouso de depois da queda, sem a conta, não chegou à B');
});

test('R14-2-03: o "Sair" leva os avisos que esperavam pela marca e as marcas que a aba avisou sem a conta', async () => {
  const fila = [1, 2].map((i) => P(i));
  const { nav, A, B } = duasAbasComAContaDeADesconhecida({ fila });
  A.app.registrarPouso([{ ...fila[1] }]);
  await nav.entregue();
  assert.equal(B.app.esperando.length, 1, 'PRÉ-CONDIÇÃO: a B guardou o aviso');
  assert.equal(A.app.marcas.size, 1, 'PRÉ-CONDIÇÃO: a A guardou a marca');
  B.app.sair();
  A.app.sair();
  assert.deepEqual([B.app.esperando.length, A.app.marcas.size], [0, 0], 'o "Sair" deixou id de pedido de terceiro (ou a marca) na memória');
  // A aba que saiu (sem sessão, sem conta, sem fila) não guarda o aviso sem conta.
  B.API.sessionToken = null;
  B.AppState.profile = null;
  B.AppState.queue = [];
  B.AppState.currentPlace = null;
  const C = aba(nav, { fila, ap: new Map(), token: 'tok-c', perfil: null });
  C.app.registrarPouso([{ ...fila[0] }]);
  await nav.entregue();
  assert.equal(B.app.esperando.length, 0, 'a aba que saiu guardou o aviso sem conta (id de pedido de terceiro)');
  assert.equal(B.leituras(), 0, 'o aviso fez a aba sem sessão ler o aparelho (R9-1-03)');
});

test('R14-2-03: os avisos que esperam pela marca dividem o teto dos que esperam a conta', async () => {
  const fila = [1].map((i) => P(i));
  const { B } = duasAbasComAContaDeADesconhecida({ fila });
  const MAX = constante('AVISOS_DE_POUSO_SEM_CONTA_MAX');
  for (let i = 0; i < MAX + 10; i++) B.app.aoPousarEmOutraAba({ v: 1, chaves: ['va|' + i], conta: null, s: 'outra' });
  assert.equal(B.app.esperando.length, MAX, `os avisos que esperam pela marca não têm teto: ${B.app.esperando.length}`);
  assert.deepEqual(B.app.esperando[0].chaves, ['va|10'], 'o teto não tirou os MAIS ANTIGOS');
  // E a mensagem da conta mal formada não aplica nada.
  B.app.aoPousarEmOutraAba({ v: 1, tipo: 'conta', s: 'outra', conta: 'x' });
  assert.equal(B.app.esperando.length, MAX, 'uma conta mal formada resolveu os avisos');
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
  // R14-2-03: as funções novas são de TOPO (o esbuild não troca esses nomes).
  for (const nome of ['contaDoGestoEhADeAgora', 'filaDoGestoSegueAqui', 'epocaDaFilaRealAgora', 'lembrarMarcaQueAvisouSemConta',
    'avisarAContaDasMarcas', 'aoSaberAContaDeUmaMarca']) {
    const re = new RegExp('\\b' + nome + '\\b', 'g');
    assert.ok(contar(APP_SEM, re) > 0, `PRÉ-CONDIÇÃO: ${nome} sumiu do fonte`);
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${nome} — falta \`npm run js\``);
  }
});
