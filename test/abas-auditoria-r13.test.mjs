// Rodada 13 da auditoria (2026-10-07), a parte das DUAS ABAS e da QUEDA — o
// lote 17. A decisão que POUSA no Waze depois de a época da sessão trocar (a
// queda com a renovação, a conta em dúvida, o login de novo com a fila refeita)
// não deixava prova nenhuma no aparelho nem avisava a outra aba, e a aba no meio
// da renovação jogava fora o aviso que a outra mandava. Em todos os casos o MESMO
// pedido recebia uma SEGUNDA decisão no Waze (MEDIDO no navegador, roteiros
// b1/b1b/b1c/b2/v5/a1 do R13-2, s6/s11 do R13-1 e p2 do R13-4):
//
//  · R13-2-01 (= R13-1-02 = R13-4-01) — o ✕/✓ do card, o "Rejeitar os N" e a
//    recusa automática que pousam depois da troca de época não chamavam o
//    `registrarPouso`: a fila guardada do offline (tirada antes do gesto) os
//    devolvia como card na reabertura sem rede, e a outra aba não ficava sabendo;
//  · R13-2-02 — o "Marcar todos" e a aprovação de foto registravam o pouso de
//    depois da queda só com a fila do gesto: com a fila REFEITA (a pessoa entrou
//    de novo com a mesma conta), o `return` vinha antes do registro;
//  · R13-2-03 (= R13-1-01) — a aba SEM sessão na memória (a renovação no meio)
//    ignorava o aviso do canal dos pousos, e renovada com a mesma conta o ✕ dela
//    ia ao Waze.
//
// Os testes RODAM o código de verdade, fatiado do app.js, num escopo onde o que
// o teste não fornece é um "buraco negro" (o harness da rodada 12), ou em duas
// abas de mentira que dividem o aparelho e um canal de mentira com a semântica do
// de verdade. Cada um tem o CONTROLE que reprova como o app de antes, e foi visto
// REPROVANDO com o conserto desfeito (sabotagem no relatório do lote 17).
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
const linhaDoFonte = (re, o) => { const m = re.exec(APP_SEM); assert.ok(m, `${o} sumiu do app.js`); return m[0]; };
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function(`return (${m[1]});`)();
};
const CONTA_KEY = constante('CONTA_KEY');
const OFFLINE_POUSOS_KEY = constante('OFFLINE_POUSOS_KEY');
const POUSO_NA_MEMORIA_MS = constante('POUSO_NA_MEMORIA_MS');
const AVISOS_MAX = constante('AVISOS_DE_POUSO_SEM_CONTA_MAX');

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
const chave = (p) => p.venueID + '|' + p.updateRequestID;
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
const cair = (m) => { m.deps.epocaDaSessao++; m.deps.API.sessionToken = null; m.deps.AppState.profile = null; };

// A reabertura SEM REDE numa página NOVA (memória vazia, o mesmo aparelho): o
// filtro de verdade da fila guardada (`semOsJaDecididos`), com a lista tirada
// ANTES do gesto (`desde`).
function reabrirSemRede(safeLS, guardada, desde) {
  const r = montar(['semOsJaDecididos', 'chaveDoPedido', 'offlineLerPousos'], {
    safeLS, OFFLINE_POUSOS_KEY, offlineLigado: () => true, carregarFilaDeSaida: () => [],
    pousosDaPagina: new Map(), pedidosEmAndamento: new Set(),
  });
  return ids(r.semOsJaDecididos(guardada.map((p) => ({ ...p })), desde).places);
}

// ═══ R13-2-01 · o ✕/✓ do card que POUSA depois da queda ══════════════════════
// O `handleReject`/`handleMarkAsRead` de verdade: o gesto sai com a sessão de
// agora, a resposta fica no ar (o Waze de mentira), a sessão CAI, e a resposta
// chega depois. `depoisDaQueda(m)` mexe na aba entre a queda e a resposta.
function montarCard({ resposta = { success: true }, depoisDaQueda = null } = {}) {
  const espiao = espiaoDoCanal();
  const { safeLS } = aparelho();
  const fila = [1, 2, 3].map((i) => P(i));
  let soltar = null;
  const agendadas = [];
  const AppState = { authenticated: true, profile: { ...PERFIL }, queue: fila.slice(), currentPlace: fila[0],
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 3, fetchEpoch: 0, pendingAction: null };
  const rede = (tipo) => (v, u) => new Promise((ok) => { soltar = ok; rede.saiu.push(tipo + ':' + u); });
  rede.saiu = [];
  const API = { ...sessaoDeMentira('tok-gesto'), rejectPlace: rede('reject'), markAsRead: rede('read') };
  const deps = {
    AppState, API, ...depsDoPouso(espiao.canal, safeLS), epocaDaSessao: 0, Treino: { ativo: false },
    acoesTravadas: () => false, direcaoTravada: () => false, advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; },
    scheduleAction: (tipo, place, ex) => agendadas.push(ex), callWithRetry: (fn) => fn(),
    anotarAntesDoEnvio: () => true, tirarDaFilaDeSaida: () => true,
    anotadoAntesDoEnvio: new WeakSet(), descargaNaFila: new WeakSet(),
    devolverPedidoRecusado: () => {}, updateStats: () => {}, saveStats: () => {},
  };
  const h = montar(['handleReject', 'handleMarkAsRead', 'decisaoDepoisDaQueda', 'descontarGestoSemSessao', ...NOMES_POUSO], deps);
  const decidir = async (gesto) => {
    const desde = Date.now();          // a fila guardada foi tirada ANTES do gesto
    await relogioAndou(desde);
    h[gesto]();
    assert.equal(agendadas.length, 1, 'PRÉ-CONDIÇÃO: o gesto agendou o envio');
    const envio = agendadas[0]();
    await ateQue(() => typeof soltar === 'function', 'PRÉ-CONDIÇÃO: a decisão saiu ao Waze');
    cair(h);
    if (depoisDaQueda) depoisDaQueda(h);
    await relogioAndou();
    soltar(resposta);
    await envio;
    return { desde, gesto };
  };
  return { h, deps, AppState, espiao, safeLS, fila, decidir, rede };
}

for (const [gesto, tipo] of [['handleReject', 'reject'], ['handleMarkAsRead', 'read']]) {
  test(`R13-2-01: o ${tipo === 'reject' ? '✕' : '✓'} do card que POUSA depois da queda registra o pouso — a fila guardada não o devolve, e a outra aba fica sabendo pela marca do GESTO`, async () => {
    const m = montarCard();
    const { desde } = await m.decidir(gesto);
    assert.deepEqual(m.rede.saiu, [tipo + ':u1'], 'PRÉ-CONDIÇÃO: o pedido do card foi ao Waze');
    assert.deepEqual(pousosNoAparelho(m.safeLS), ['v1|u1'],
      'DEFEITO: a decisão que pousou depois da queda ficou sem a prova no aparelho (a fila guardada a devolveria)');
    assert.ok(m.deps.pousosDaPagina.has('v1|u1'), 'DEFEITO: o pouso não entrou na memória da página (a busca no ar o traria)');
    assert.deepEqual(reabrirSemRede(m.safeLS, m.fila, desde), ['u2', 'u3'],
      'DEFEITO: reaberto sem rede, o pedido decidido voltou como card — a 2ª decisão iria ao Waze');
    assert.deepEqual(m.espiao.posts, [{ v: 1, chaves: ['v1|u1'], conta: '4242', s: m.h.marcaDaSessao('tok-gesto') }],
      'DEFEITO: a outra aba não ficou sabendo do pouso (ou o aviso não leva a marca de QUEM decidiu)');
    assert.equal(m.deps.API.sessionToken, null, 'o pouso fez a aba sem sessão adotar alguma (R9-1-03)');
    // CONTROLE: a resposta que NÃO pousou (o 401 da sessão que caiu) não vira
    // pouso — o pedido segue pendente no Waze, e volta (a medida distingue).
    const c = montarCard({ resposta: { success: false, errorCategory: 'unauthorized', httpCode: 401 } });
    const rc = await c.decidir(gesto);
    assert.deepEqual(pousosNoAparelho(c.safeLS), [], 'CONTROLE: a decisão que NÃO pousou ganhou pouso');
    assert.equal(c.espiao.posts.length, 0);
    assert.deepEqual(reabrirSemRede(c.safeLS, c.fila, rc.desde), ['u1', 'u2', 'u3']);
  });
}

test('R13-2-01: o "já tratado" que chega depois da queda também é pouso (a decisão da pessoa, ou de outro editor, está no Waze)', async () => {
  const m = montarCard({ resposta: { success: false, errorCategory: 'already_processed', httpCode: 404 } });
  await m.decidir('handleReject');
  assert.deepEqual(pousosNoAparelho(m.safeLS), ['v1|u1'], 'DEFEITO: o "já tratado" de depois da queda ficou sem pouso');
});

test('R13-2-01: depois do "Sair" (sem login novo) o pouso NÃO volta à página — sair é limpar de tudo', async () => {
  const m = montarCard({ depoisDaQueda: (h) => { h.deps.saiuNestaPagina = true; } });
  await m.decidir('handleReject');
  assert.equal(m.deps.pousosDaPagina.size, 0, 'DEFEITO: a resposta de depois do "Sair" pôs um id de pedido de terceiro na memória');
  assert.deepEqual(pousosNoAparelho(m.safeLS), []);
  assert.equal(m.espiao.posts.length, 0, 'a resposta de depois do "Sair" avisou as outras abas (que saíram junto)');
});

test('R13-2-01: com OUTRA conta nesta aba agora, o pouso da conta anterior não entra (o "lido" é de cada pessoa)', async () => {
  const m = montarCard({ depoisDaQueda: (h) => { h.deps.API.sessionToken = 'tok-outra'; h.deps.AppState.profile = { id: 5151 }; } });
  await m.decidir('handleMarkAsRead');
  assert.equal(m.deps.pousosDaPagina.size, 0,
    'DEFEITO: o "lido" de quem estava entrou na memória da página de quem entrou — a busca no ar dela o tiraria da fila');
  assert.equal(m.espiao.posts.length, 0);
  // CONTROLE: a renovação com a MESMA conta (perfil de volta) — o pouso vale.
  const c = montarCard({ depoisDaQueda: (h) => { h.deps.API.sessionToken = 'tok-nova'; h.deps.AppState.profile = { ...PERFIL }; } });
  await c.decidir('handleMarkAsRead');
  assert.deepEqual(pousosNoAparelho(c.safeLS), ['v1|u1'], 'CONTROLE: a renovação com a mesma conta ficou sem o pouso');
  assert.deepEqual(c.espiao.posts[0].s, c.h.marcaDaSessao('tok-gesto'), 'o aviso não leva a marca do GESTO (leva a de agora)');
});

// ═══ R13-2-01 · o "Rejeitar os N" e a recusa automática ═════════════════════
// O `enviarLote` de verdade, pelos dois caminhos que o chamam: o gesto da folha
// do autor (`rejeitarLoteDoAutor`, o placar otimista) e a recusa automática
// (`aplicarRecusaAutomatica`, o placar que anda com o envio). O 1º pedido está no
// ar quando a sessão cai; a resposta chega depois: pousou.
const AUTOR = 777;
const pedidoDe = (i, autor) => ({ venueID: 'v' + i, updateRequestID: (autor === AUTOR ? 'x' : 'u') + i, creatorId: autor,
  createdBy: autor === AUTOR ? 'spam' : 'autor' + autor });
const diaDeHoje = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; };

function montarLote({ auto = false } = {}) {
  const espiao = espiaoDoCanal();
  const { safeLS } = aparelho();
  const fila = [pedidoDe(1, 1001), pedidoDe(2, AUTOR), pedidoDe(3, AUTOR), pedidoDe(4, AUTOR), pedidoDe(5, 1005)];
  const portoes = [];
  const enviados = [];
  const agendadas = [];
  const AppState = { authenticated: true, profile: { ...PERFIL }, queue: fila.slice(), currentPlace: fila[0],
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: fila.length, fetchEpoch: 0, hasMore: false,
    inFlightActions: 0, pendingAction: null, autores: null };
  const API = { ...sessaoDeMentira('tok-gesto'),
    rejectPlace: (v, u) => new Promise((ok) => { enviados.push(u); portoes.push(ok); }) };
  const deps = {
    AppState, API, ...depsDoPouso(espiao.canal, safeLS), epocaDaSessao: 0, Treino: { ativo: false, _salvo: null },
    acoesTravadas: () => false, scheduleAction: (tipo, places, ex) => agendadas.push(ex),
    pedidosDoAutorNaFila: () => AppState.queue.filter((p) => p.creatorId === AUTOR),
    callWithRetry: (fn) => fn(), carimboDoGesto: () => ({ dia: '2026-10-07', onde: '30', t: 1, lang: 'pt' }),
    carregarFilaDeSaida: () => [], salvarFilaDeSaida: () => {}, enfileirarSaida: () => true, tirarDaFilaDeSaida: () => true,
    reivindicacaoDestaAba: () => ({}), pedidosEmAndamento: new Set(), devolverPedidoRecusado: () => {},
    // A recusa automática: L6+AM, a conta dona do aparelho, o 777 marcado com o interruptor LIGADO.
    podeRecusarAutomaticoAqui: () => true, contaConfirmada: () => true, autoLigado: (id) => id === AUTOR,
    recusaAutomaticaRodando: false, recusaAutomaticaPedidaDeNovo: false, recusaAutomaticaNestaFila: false,
    decididosPorOutraAbaComCardAqui: new WeakSet(), decididoNaOutraAbaDepoisDe: () => false,
    showToast: () => ({ texto() {}, dispensar() {} }), t: (k) => k, updateStats: () => {}, saveStats: () => {},
  };
  const h = montar(['rejeitarLoteDoAutor', 'aplicarRecusaAutomatica', 'enviarLote', 'marcarEmAndamento',
    'descontarGestoSemSessao', ...NOMES_POUSO], deps);
  const disparar = async () => {
    const desde = Date.now();
    await relogioAndou(desde);
    let fim;
    if (auto) fim = h.aplicarRecusaAutomatica();
    else {
      h.rejeitarLoteDoAutor(fila[1]);
      assert.equal(agendadas.length, 1, 'PRÉ-CONDIÇÃO: o "Rejeitar os N" agendou o lote');
      fim = agendadas[0]();
    }
    await ateQue(() => portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedido do lote saiu ao Waze');
    cair(h);
    await relogioAndou();
    portoes.shift()({ success: true });
    await fim;
    return desde;
  };
  return { h, deps, espiao, safeLS, fila, enviados, disparar };
}

for (const [rotulo, auto] of [['o "Rejeitar os N"', false], ['a recusa automática', true]]) {
  test(`R13-2-01: ${rotulo} cujo pedido POUSA depois da queda registra o pouso — com a marca do gesto, e só dele`, async () => {
    const m = montarLote({ auto });
    const desde = await m.disparar();
    assert.deepEqual(m.enviados, ['x2'], 'PRÉ-CONDIÇÃO: depois da queda o lote parou (só o 1º saiu)');
    assert.deepEqual(pousosNoAparelho(m.safeLS), ['v2|x2'],
      `DEFEITO: o pedido do lote que pousou depois da queda ficou sem pouso (ou os que nem saíram ganharam): ${pousosNoAparelho(m.safeLS)}`);
    assert.deepEqual(m.espiao.posts, [{ v: 1, chaves: ['v2|x2'], conta: '4242', s: m.h.marcaDaSessao('tok-gesto') }],
      'DEFEITO: a outra aba não ficou sabendo do pouso — a recusa automática não passa pela fila de saída');
    assert.deepEqual(reabrirSemRede(m.safeLS, m.fila, desde), ['u1', 'x3', 'x4', 'u5'],
      'DEFEITO: reaberto sem rede, o pedido que o lote rejeitou voltou como card');
  });
}

// ═══ R13-2-02 · o "Marcar todos" e a aprovação com a fila REFEITA ═════════════
// O R12-2-04 levou a marca do gesto a esses dois caminhos, mas o registro vinha
// DEPOIS do `return` da fila do gesto: com a fila refeita (a pessoa entrou de
// novo com a MESMA conta, por cookies ou pelo código), nada pousava.
// `entrouDeNovo`: o que acontece na aba entre a queda e a resposta.
const ENTROU_DE_NOVO = {
  // A mesma conta, numa sessão nova e com a fila nova (o login por cookies faz `resetQueue`).
  mesmaConta: (h) => { h.deps.API.sessionToken = 'tok-nova'; h.deps.AppState.profile = { ...PERFIL }; h.deps.AppState.fetchEpoch++; },
  // O "Sair", sem login novo.
  sair: (h) => { h.deps.saiuNestaPagina = true; h.deps.AppState.fetchEpoch++; },
  // OUTRA conta entrou nesta aba.
  outraConta: (h) => { h.deps.API.sessionToken = 'tok-outra'; h.deps.AppState.profile = { id: 5151 }; h.deps.AppState.fetchEpoch++; },
};

async function marcarTodosComQueda(entrouDeNovo) {
  const espiao = espiaoDoCanal();
  const { safeLS } = aparelho();
  const fila = [1, 2, 3].map((i) => P(i));
  const portoes = [];
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { read: 40, rejected: 0, skipped: 0 },
    serverTotal: fila.length, fetchEpoch: 0, hasMore: false, pendingAction: null, inFlightActions: 0, profile: { ...PERFIL } };
  const API = { ...sessaoDeMentira('tok-gesto'),
    markAsReadBatch: () => new Promise((ok) => portoes.push(ok)), markAsRead: () => new Promise((ok) => portoes.push(ok)) };
  const deps = {
    AppState, API, ...depsDoPouso(espiao.canal, safeLS), LOTE_LIDOS_PEDACO: 2, epocaDaSessao: 0, Treino: { ativo: false },
    pedidosEmAndamento: new Set(), loteDeLidosContado: null, loteDeLidosEmVoo: false, escritasConferindo: 0,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, contaDestaAbaEmDuvida: () => false,
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), callWithRetry: (fn) => fn(),
    carimboDoGesto: () => ({ dia: '2026-10-07', onde: '30', t: 1, lang: 'pt' }), decididosPorOutraAbaComCardAqui: new WeakSet(),
    showToast: () => {}, t: (k) => k, msgDoServidor: (r, d) => d,
    document: { getElementById: () => ({ textContent: '' }) }, openModal: () => {}, closeModal: () => {},
  };
  const h = montar(['openBatchReadConfirm', 'handleBatchMarkRead', 'acoesTravadas', 'acoesTravadasForaDaJanela',
    'aprovacaoDaTelaNoAr', 'avisoDaTrava', 'marcarEmAndamento', ...NOMES_POUSO], deps);
  h.openBatchReadConfirm();
  const lote = h.handleBatchMarkRead();
  await ateQue(() => portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedaço saiu');
  cair(h);
  entrouDeNovo(h);
  await relogioAndou();
  portoes.shift()({ success: true });            // o pedaço pousa depois da queda
  await lote;
  return { h, deps, espiao, safeLS };
}

test('R13-2-02: o "Marcar todos" que pousa depois da queda com a fila REFEITA (a mesma conta entrou de novo) avisa a outra aba e grava o pouso', async () => {
  const m = await marcarTodosComQueda(ENTROU_DE_NOVO.mesmaConta);
  assert.deepEqual(m.espiao.posts, [{ v: 1, chaves: ['v1|u1', 'v2|u2'], conta: '4242', s: m.h.marcaDaSessao('tok-gesto') }],
    'DEFEITO: com a fila refeita, o pedaço que pousou depois da queda não avisou a outra aba — o ✕ de lá iria ao Waze');
  assert.deepEqual(pousosNoAparelho(m.safeLS), ['v1|u1', 'v2|u2'], 'DEFEITO: com a fila refeita, o pedaço ficou sem pouso no aparelho');
  // CONTROLES: o "Sair" sem login novo e OUTRA conta não registram (a medida distingue).
  for (const caso of ['sair', 'outraConta']) {
    const c = await marcarTodosComQueda(ENTROU_DE_NOVO[caso]);
    assert.equal(c.espiao.posts.length, 0, `CONTROLE (${caso}): o pouso de depois da queda avisou`);
    assert.equal(c.deps.pousosDaPagina.size, 0, `CONTROLE (${caso}): o pouso entrou na memória da página`);
  }
});

async function aprovacaoComQueda(entrouDeNovo) {
  const espiao = espiaoDoCanal();
  const { safeLS } = aparelho();
  const place = { ...P(9), purType: 'NEW_PHOTO' };
  let soltar = null;
  const AppState = { queue: [place], currentPlace: place, serverTotal: 1, fetchEpoch: 0, profile: { ...PERFIL } };
  const API = { ...sessaoDeMentira('tok-gesto'), aprovarPedido: () => new Promise((ok) => { soltar = ok; }) };
  const deps = {
    AppState, API, ...depsDoPouso(espiao.canal, safeLS), epocaDaSessao: 0,
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), decididosPorOutraAbaComCardAqui: new WeakSet(),
    vezDasFotosNoLocal: () => ({ anterior: null, soltar() {} }), callWithRetry: (fn) => fn(),
    Lightbox: { marcarComoAprovada() {}, esquecerProposta() {}, desmarcarAprovada() {}, isOpen: () => false, place: null },
    pedidoAindaNaTela: () => false, showToast: () => {}, t: (k) => k,
  };
  const h = montar(['enviarAprovacao', 'aprovacaoPousouDepoisDaQueda', 'contarIdasSemResposta', ...NOMES_POUSO], deps);
  const envio = h.enviarAprovacao({ id: 'u9', place, idx: 0, regiao: 'row', epocaFila: 0 });
  await ateQue(() => typeof soltar === 'function', 'PRÉ-CONDIÇÃO: a aprovação saiu');
  cair(h);
  entrouDeNovo(h);
  await relogioAndou();
  soltar({ success: true });                     // pousa depois da queda
  assert.equal(await envio, false, 'PRÉ-CONDIÇÃO: a resposta de depois da queda não grava nada da sessão');
  return { h, deps, espiao, safeLS };
}

test('R13-2-02: a aprovação de foto que pousa depois da queda com a fila REFEITA avisa a outra aba e grava o pouso', async () => {
  const m = await aprovacaoComQueda(ENTROU_DE_NOVO.mesmaConta);
  assert.deepEqual(m.espiao.posts, [{ v: 1, chaves: ['v9|u9'], conta: '4242', s: m.h.marcaDaSessao('tok-gesto') }],
    'DEFEITO: com a fila refeita, a aprovação que pousou depois da queda não avisou a outra aba');
  assert.deepEqual(pousosNoAparelho(m.safeLS), ['v9|u9']);
  for (const caso of ['sair', 'outraConta']) {
    const c = await aprovacaoComQueda(ENTROU_DE_NOVO[caso]);
    assert.equal(c.espiao.posts.length, 0, `CONTROLE (${caso}): a aprovação de depois da queda avisou`);
    assert.equal(c.deps.pousosDaPagina.size, 0, `CONTROLE (${caso}): o pouso entrou na memória da página`);
  }
});

// ═══ R13-2-03 · a aba SEM sessão na memória recebe o aviso do canal ══════════
// Duas abas de mentira da mesma conta, com o canal e a conta de verdade (o
// harness da rodada 12). A B confirmou a conta (o perfil chegou), e a sessão dela
// CAI: a memória fica vazia, com a fila na tela (a renovação pela extensão no ar).
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
        if (outro === this || ++entregas > 50) continue;
        setTimeout(() => { if (typeof outro.onmessage === 'function') outro.onmessage({ data: structuredClone(dado) }); }, 0);
      }
    }
    close() { canais.get(this.nome).delete(this); }
  }
  return { BroadcastChannel: CanalDeMentira, postados, entregue: () => new Promise((ok) => setTimeout(ok, 5)) };
}

const DECLARACOES = [
  linhaDoFonte(/^const CANAL_DOS_POUSOS = '[^']+';$/m, 'o nome do canal dos pousos'),
  linhaDoFonte(/^let canalDosPousos = null;$/m, 'o canal dos pousos'),
  linhaDoFonte(/^const decididasPorOutraAba = new Map\(\);$/m, 'as chaves que a outra aba decidiu'),
  linhaDoFonte(/^const DECIDIDAS_POR_OUTRA_ABA_MAX = \d+;$/m, 'o teto das chaves que a outra aba decidiu'),
  linhaDoFonte(/^const avisosDePousoSemConta = \[\];$/m, 'os avisos que esperam a conta'),
  linhaDoFonte(/^const AVISOS_DE_POUSO_SEM_CONTA_MAX = \d+;$/m, 'o teto dos avisos que esperam a conta'),
];
const NOMES_ABA = ['chaveDoPedido', 'filaReal', 'filaRealComDevolvidos', 'anotarDecididosPorOutraAba',
  'lembrarDecididasPorOutraAba', 'decididoNaOutraAbaDepoisDe', 'esquecerDecididasPorOutraAba',
  'tirarDaFilaOQueAOutraAbaDecidiu', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'offlineLerPousos', 'registrarPouso',
  'semOsJaDecididos', 'abrirCanalDosPousos', 'quemDecideAgora', 'avisarOutrasAbasDoPouso', 'aoPousarEmOutraAba',
  'aoPousarSemSessaoNaMemoria', 'guardaASessaoQueCaiu', 'aplicarPousoDeOutraAba', 'guardarAvisoSemConta',
  'aplicarAvisosQueEsperavamAConta', 'marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'aoConhecerConta',
  'carimbarContaNaSaida', 'sessaoDestaAbaEhAGuardada', 'invisivelPedidoAntesDoPerfil', 'carimbarContaNoInvisivel'];

// Uma ABA: a fila `fila` (o da frente na tela) num aparelho (`ap`, um Map) que as
// abas dividem. `token`: a sessão na MEMÓRIA desta aba.
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
    esquecerOutraConta: (id) => { log.push('esqueceu:' + id); AppState.queue = []; AppState.currentPlace = null; },
    esvaziarFilaDeSaida: () => {},
    // O card desenhado na tela, como o `guardaASessaoQueCaiu` o procura.
    document: { querySelector: (sel) => (sel === '#cardStack .place-card' && AppState.currentPlace ? {} : null) },
  };
  const chaves = Object.keys(deps);
  const fonte = [
    'let ultimaEscritaOkEm = 0, contaConfirmadaNestaAba = null, filaAtravessouSessao = false, saidaEsperandoConta = false;',
    'const decididosPorOutraAbaComCardAqui = new WeakSet(), pedidosEmAndamento = new Set(), pousosDaPagina = new Map();',
    ...DECLARACOES,
    ...NOMES_ABA.map(fatiar),
    `return { ${NOMES_ABA.join(', ')}, marcado: (p) => decididosPorOutraAbaComCardAqui.has(p), pousosDaPagina,
      decididas: decididasPorOutraAba, esperando: avisosDePousoSemConta, contaConfirmada: () => contaConfirmadaNestaAba,
      sair: () => { contaConfirmadaNestaAba = null; esquecerDecididasPorOutraAba({ comOsAvisos: true }); } };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  app.abrirCanalDosPousos();
  return { app, AppState, API, log, leituras: () => leituras };
}

// A tem a sessão guardada no aparelho (`tok-a`) e a conta confirmada com ela; B,
// a MESMA conta, com sessão própria (`tok-b`), confirmou a conta pelo perfil — ou
// não (`confirmada: false`: a sessão caiu antes de o perfil chegar). Depois a
// sessão de B CAI: memória vazia, a fila fica (a renovação no meio).
function duasAbasComQuedaNaB({ fila, confirmada = true, contaB = PERFIL.id } = {}) {
  const nav = navegador();
  const ap = new Map([['waze_session_token', 'tok-a']]);
  const A = aba(nav, { fila, ap, token: 'tok-a' });
  ap.set(CONTA_KEY, JSON.stringify({ id: String(PERFIL.id), s: A.app.marcaDaSessao('tok-a') }));
  const B = aba(nav, { fila, ap, token: 'tok-b', perfil: { id: contaB } });
  if (confirmada) {
    // O perfil de B chegou quando a conta dela era a do aparelho; depois a A
    // entrou (a mesma conta, ou outra — a aba que CAIU não sai por isso, R13-1-06).
    const dono = ap.get(CONTA_KEY);
    ap.set(CONTA_KEY, JSON.stringify({ id: String(contaB), s: B.app.marcaDaSessao('tok-b') }));
    B.app.aoConhecerConta({ id: contaB });
    ap.set(CONTA_KEY, dono);
    assert.ok(!B.log.some((x) => String(x).startsWith('esqueceu')), 'PRÉ-CONDIÇÃO: o perfil de B não foi uma troca de conta');
  }
  B.API.sessionToken = null;
  B.AppState.profile = null;
  return { nav, ap, A, B };
}

test('R13-2-03: a aba no meio da RENOVAÇÃO recebe o "Marcar todos" da outra — a mesma conta que ela confirmou vale na hora', async () => {
  const fila = [1, 2, 3, 4].map((i) => P(i));
  const { nav, A, B } = duasAbasComQuedaNaB({ fila });
  assert.equal(B.app.contaConfirmada().id, '4242', 'PRÉ-CONDIÇÃO: a B confirmou a conta antes da queda');
  A.app.registrarPouso([{ ...fila[0] }, { ...fila[1] }, { ...fila[2] }]);   // o "Marcar todos" da A
  await nav.entregue();
  assert.deepEqual(ids(B.AppState.queue), ['u1', 'u4'],
    `DEFEITO: a aba sem sessão na memória jogou fora o aviso — os pedidos que a outra marcou seguem como card: ${ids(B.AppState.queue)}`);
  assert.equal(B.app.marcado(fila[0]), true, 'DEFEITO: o card da TELA não ficou anotado — renovada a sessão, o ✕ dele iria ao Waze');
  assert.equal(B.leituras(), 0, 'DEFEITO: o aviso fez a aba sem sessão ler o aparelho (e adotar a sessão da outra, R9-1-03)');
  assert.equal(B.API.sessionToken, null, 'a aba sem sessão adotou a sessão guardada no aparelho');
  // A renovação com a MESMA conta: o card segue anotado (o gesto nele não sai).
  B.API.sessionToken = 'tok-b2';
  B.AppState.profile = { ...PERFIL };
  B.app.aoConhecerConta({ ...PERFIL });
  assert.equal(B.app.marcado(B.AppState.currentPlace), true, 'a renovação com a mesma conta desfez a anotação');
  assert.ok(!B.log.some((x) => String(x).startsWith('esqueceu')), 'a mesma conta foi tratada como troca de conta');
});

test('R13-2-03: a aba sem sessão que confirmou OUTRA conta não aplica o aviso — e não guarda nada', async () => {
  const fila = [1, 2, 3].map((i) => P(i));
  const { nav, A, B } = duasAbasComQuedaNaB({ fila, contaB: 5151 });
  A.app.registrarPouso([{ ...fila[0] }, { ...fila[1] }]);
  await nav.entregue();
  assert.deepEqual(ids(B.AppState.queue), ['u1', 'u2', 'u3'], 'DEFEITO: o pouso de OUTRA conta tirou pedido da fila desta');
  assert.equal(B.app.marcado(fila[0]), false);
  assert.equal(B.app.esperando.length, 0, 'a aba de conta CONHECIDA guardou o aviso de outra conta');
  assert.equal(B.leituras(), 0);
});

test('R13-2-03: sem conta confirmada (a sessão caiu antes do perfil), o aviso ESPERA a conta — e a renovação decide', async () => {
  const fila = [1, 2, 3].map((i) => P(i));
  for (const [contaQueEntra, fica] of [[PERFIL.id, ['u1', 'u3']], [5151, null]]) {
    const { nav, A, B } = duasAbasComQuedaNaB({ fila, confirmada: false });
    assert.equal(B.app.contaConfirmada(), null, 'PRÉ-CONDIÇÃO: a B não confirmou conta nenhuma');
    A.app.registrarPouso([{ ...fila[0] }, { ...fila[1] }]);
    await nav.entregue();
    assert.deepEqual(ids(B.AppState.queue), ['u1', 'u2', 'u3'], 'sem saber a conta, a B aplicou o aviso');
    assert.equal(B.app.esperando.length, 1, 'DEFEITO: o aviso que chegou sem a conta desta aba foi jogado fora');
    assert.equal(B.leituras(), 0, 'o aviso fez a aba sem sessão ler o aparelho');
    // A renovação revela a conta (o `aoConhecerConta` do login ou do perfil).
    B.API.sessionToken = 'tok-b2';
    B.AppState.profile = { id: contaQueEntra };
    B.app.aoConhecerConta({ id: contaQueEntra });
    assert.equal(B.app.esperando.length, 0, 'o aviso seguiu esperando depois de a conta se saber');
    if (fica) {
      assert.deepEqual(ids(B.AppState.queue), fica, `a MESMA conta: o que a outra aba decidiu seguiu como card: ${ids(B.AppState.queue)}`);
      assert.equal(B.app.marcado(fila[0]), true);
    } else {
      assert.equal(B.app.marcado(fila[0]), false, 'OUTRA conta: o aviso da anterior anotou o card');
      assert.equal(B.app.decididas.size, 0, 'OUTRA conta: as chaves da anterior ficaram');
    }
  }
});

test('R13-2-03: a aba sem sessão que não guarda nada da que caiu (nunca entrou, ou saiu) ignora o aviso — nenhum id de terceiro fica na memória', async () => {
  const fila = [1, 2].map((i) => P(i));
  const nav = navegador();
  const ap = new Map([['waze_session_token', 'tok-a']]);
  const A = aba(nav, { fila, ap, token: 'tok-a' });
  ap.set(CONTA_KEY, JSON.stringify({ id: String(PERFIL.id), s: A.app.marcaDaSessao('tok-a') }));
  // A aba que deu "Sair": sem sessão, sem conta confirmada, sem fila.
  const saiu = aba(nav, { fila, ap, token: 'tok-b' });
  saiu.app.aoConhecerConta({ ...PERFIL });
  saiu.app.sair();
  saiu.API.sessionToken = null;
  saiu.AppState.profile = null;
  saiu.AppState.queue = [];
  saiu.AppState.currentPlace = null;
  A.app.registrarPouso([{ ...fila[0] }]);
  await nav.entregue();
  assert.equal(saiu.app.esperando.length, 0, 'DEFEITO: a aba que saiu guardou na memória o aviso (id de pedido de terceiro)');
  assert.equal(saiu.app.decididas.size, 0, 'DEFEITO: a aba que saiu anotou as chaves do aviso');
  assert.equal(saiu.leituras(), 0);
  // CONTROLE: a MESMA aba com a fila da sessão que caiu guardaria (a medida distingue).
  saiu.AppState.queue = fila.slice();
  saiu.AppState.currentPlace = saiu.AppState.queue[0];
  A.app.registrarPouso([{ ...fila[1] }]);
  await nav.entregue();
  assert.equal(saiu.app.esperando.length, 1, 'CONTROLE: com a fila da sessão que caiu, o aviso não esperou a conta');
});

test('R13-2-03: os avisos que esperam na aba sem sessão têm o MESMO teto dos da conta em dúvida', () => {
  const fila = [1].map((i) => P(i));
  const { B } = duasAbasComQuedaNaB({ fila, confirmada: false });
  for (let i = 0; i < AVISOS_MAX + 10; i++) B.app.aoPousarEmOutraAba({ v: 1, chaves: ['va|' + i], conta: '4242', s: 'outra' });
  assert.equal(B.app.esperando.length, AVISOS_MAX, `os avisos que esperam a conta não têm teto: ${B.app.esperando.length}`);
  assert.deepEqual(B.app.esperando[0].chaves, ['va|10'], 'o teto não tirou os MAIS ANTIGOS');
});

// ═══ a régua de depois da queda é UMA — e só ela pode chamar o pouso ali ══════
// Todo caminho que decide um pedido e pode pousar com a época trocada passa por
// ela (os quatro de hoje); um caminho de fora deixaria o pedido voltar como card
// na fila guardada, ou gravaria depois do "Sair". Na fila do GESTO, o "Marcar
// todos" e a aprovação registram direto (o R12-2-04: a fila de pé prova que nem o
// "Sair" nem a troca de conta aconteceram).
test('o pouso de depois da queda passa pela régua — nos quatro caminhos que decidem', () => {
  const conta = (nome, re) => (fatiar(nome).match(re) || []).length;
  const regua = /registrarPousoDepoisDaQueda\(/g;
  for (const nome of ['decisaoDepoisDaQueda', 'enviarLote', 'handleBatchMarkRead', 'aprovacaoPousouDepoisDaQueda']) {
    assert.equal(conta(nome, regua), 1, `${nome}: o pouso de depois da queda não passa pela régua (ou passa duas vezes)`);
  }
  assert.equal(conta('registrarPousoDepoisDaQueda', /registrarPouso\(/g), 1, 'a régua tem de terminar no `registrarPouso` (a fonte única)');
  // O gesto tira a marca de QUEM decide antes do envio, e ela vai junto.
  for (const nome of ['handleReject', 'handleMarkAsRead']) {
    assert.match(fatiar(nome), /const quem = typeof quemDecideAgora === 'function' \? quemDecideAgora\(\) : null;\s*scheduleAction\(/,
      `${nome}: a marca de quem decide não é tirada no gesto`);
  }
});

// ═══ os testes fatiam o FONTE; o app carrega o `js/min/` (gotcha #22) ═════════
test('o bundle GERADO tem os consertos (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  for (const nome of ['registrarPousoDepoisDaQueda', 'aoPousarSemSessaoNaMemoria', 'quemDecideAgora']) {
    const re = new RegExp('\\b' + nome + '\\b', 'g');
    assert.ok(contar(APP_SEM, re) > 0, `PRÉ-CONDIÇÃO: ${nome} sumiu do fonte`);
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${nome} — falta \`npm run js\``);
  }
});
