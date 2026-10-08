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
  return { h, deps, AppState, espiao, safeLS, fila, enviados, buscas, disparar };
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
});
