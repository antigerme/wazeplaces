// Rodada 12 da auditoria (2026-10-07), a parte das DUAS ABAS — o lote 16. Com o
// app aberto em duas abas da mesma conta, a decisão de uma chega à outra pelo
// aviso da fila de saída (`storage`) e pelo canal dos pousos (lote 15), e a
// outra ANOTA o card que tem. Cinco caminhos ficavam de fora, e em todos o mesmo
// pedido recebia uma SEGUNDA decisão no Waze (MEDIDO no navegador, roteiros e1,
// e2, e14, e16, n5 e n5b da rodada 12):
//
//  · R12-2-01 — a recusa automática NO AR: os alvos já saíram da fila, e o aviso
//    não os via — o pedido que a pessoa marcou como lido na outra aba saía daqui
//    rejeitado, segundos depois;
//  · R12-2-02 — a BUSCA no ar (a abertura da segunda aba, o ↻, a troca de filtro)
//    que voltava depois do pouso de lá trazia o pedido como card;
//  · R12-2-04 — o pouso que chegava com a sessão já caída (a renovação no meio)
//    não avisava ninguém: sem sessão na memória, o aviso não saía;
//  · R12-2-05 — o aviso que chegava com a conta desta aba em DÚVIDA era jogado
//    fora, e não voltava quando o perfil dizia que era a mesma conta;
//  · R12-4-01 — a fila guardada do offline levava o card da tela que a outra aba
//    decidiu e podava o pouso de lá: reaberto sem rede, ele voltava como card.
//
// Os testes RODAM o código de verdade, fatiado do app.js (o canal entre abas é
// um de mentira com a semântica do de verdade: entrega às OUTRAS instâncias,
// numa tarefa à parte, por cópia). Cada um tem o CONTROLE que reprova como o app
// de antes, e foi visto REPROVANDO com o conserto desfeito (sabotagem no
// relatório do lote 16).
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
// As declarações de MÓDULO, tiradas do fonte (um nome trocado lá reprova aqui).
const DECLARACOES = [
  linhaDoFonte(/^const CANAL_DOS_POUSOS = '[^']+';$/m, 'o nome do canal dos pousos'),
  linhaDoFonte(/^let canalDosPousos = null;$/m, 'o canal dos pousos'),
  linhaDoFonte(/^const decididasPorOutraAba = new Map\(\);$/m, 'as chaves que a outra aba decidiu'),
  linhaDoFonte(/^const DECIDIDAS_POR_OUTRA_ABA_MAX = \d+;$/m, 'o teto das chaves que a outra aba decidiu'),
  linhaDoFonte(/^const avisosDePousoSemConta = \[\];$/m, 'os avisos que esperam a conta'),
  linhaDoFonte(/^const AVISOS_DE_POUSO_SEM_CONTA_MAX = \d+;$/m, 'o teto dos avisos que esperam a conta'),
];
const CONTA_KEY = constante('CONTA_KEY');
const SAIDA_KEY = constante('SAIDA_KEY');
const POUSO_NA_MEMORIA_MS = constante('POUSO_NA_MEMORIA_MS');
const OFFLINE_POUSOS_KEY = constante('OFFLINE_POUSOS_KEY');
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
// O relógio de PAREDE andou desde `t` (com o relógio grosso, anda em degraus).
async function relogioAndou(t = Date.now()) {
  const fim = performance.now() + 2000;
  while (Date.now() <= t) {
    if (performance.now() > fim) assert.fail('o relógio de parede não andou');
    await tique(1);
  }
}

// O canal de mentira: entrega às OUTRAS instâncias do mesmo nome, numa tarefa à
// parte, por cópia (como o de verdade). Com TETO de entregas: uma aba que
// respondesse ao aviso avisando de volta viraria um laço, e o teste penduraria em
// vez de reprovar (gotcha #19).
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
      for (const outro of canais.get(this.nome)) {
        if (outro === this || ++entregas > 50) continue;
        setTimeout(() => { if (typeof outro.onmessage === 'function') outro.onmessage({ data: structuredClone(dado) }); }, 0);
      }
    }
    close() { canais.get(this.nome).delete(this); }
  }
  return { BroadcastChannel: CanalDeMentira, postados, entregue: () => new Promise((ok) => setTimeout(ok, 5)) };
}

const P = (i, autor = 700 + i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, creatorId: autor, createdBy: 'autor' + autor });
const chave = (p) => p.venueID + '|' + p.updateRequestID;
const ids = (fila) => (fila || []).map((p) => p.updateRequestID);

// ═══ uma ABA, com o canal e a conta de verdade ═══════════════════════════════
// A fila `fila` (o da frente na tela), num `aparelho` (Map) que as abas dividem.
// `token`: a sessão na MEMÓRIA desta aba (`null`: sem sessão).
const NOMES_ABA = ['chaveDoPedido', 'filaReal', 'filaRealComDevolvidos', 'anotarDecididosPorOutraAba',
  'lembrarDecididasPorOutraAba', 'decididoNaOutraAbaDepoisDe', 'esquecerDecididasPorOutraAba',
  'tirarDaFilaOQueAOutraAbaDecidiu', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'offlineLerPousos', 'registrarPouso',
  'semOsJaDecididos', 'abrirCanalDosPousos', 'quemDecideAgora', 'avisarOutrasAbasDoPouso', 'aoPousarEmOutraAba',
  'aplicarPousoDeOutraAba', 'guardarAvisoSemConta', 'aplicarAvisosQueEsperavamAConta', 'marcaDaSessao', 'marcaDestaAba', 'contaAgora',
  'aoConhecerConta', 'carimbarContaNaSaida', 'sessaoDestaAbaEhAGuardada',
  // O "invisível" pedido antes do perfil, que o `aoConhecerConta` carimba (R12-5-05, a junção do lote 16).
  'invisivelPedidoAntesDoPerfil', 'carimbarContaNoInvisivel',
  // O aviso que chega à aba SEM sessão na memória (R13-2-03, test/abas-auditoria-r13.test.mjs).
  'aoPousarSemSessaoNaMemoria', 'guardaASessaoQueCaiu'];

function aba(nav, { fila, aparelho, token = 'tok-x', perfil = { id: 4242 }, abrirCanal = true } = {}) {
  const log = [];
  const AppState = { queue: fila.slice(), currentPlace: fila[0] || null, serverTotal: fila.length, profile: perfil,
    stats: { read: 5, rejected: 5, skipped: 5 }, pendingAction: null, fetchEpoch: 0 };
  let leituras = 0;
  const API = {
    sessionToken: token,
    temSessaoNaMemoria() { return !!this.sessionToken; },
    // Como o de verdade: com a memória vazia, LÊ o aparelho e o adota (R9-1-03).
    getSession() {
      if (!this.sessionToken) { leituras++; this.sessionToken = aparelho.get('waze_session_token') || null; }
      return this.sessionToken;
    },
  };
  const deps = {
    AppState, API, Treino: { ativo: false, _salvo: null },
    BroadcastChannel: nav ? nav.BroadcastChannel : undefined,
    safeLS: { get: (k) => (aparelho.has(k) ? aparelho.get(k) : null), set: (k, v) => aparelho.set(k, String(v)),
      remove: (k) => aparelho.delete(k) },
    SAIDA_KEY, CONTA_KEY, POUSO_NA_MEMORIA_MS, OFFLINE_POUSOS_KEY, OFFLINE_POUSOS_MAX: 1000, offlineLigado: () => false,
    updatePendingCount: () => log.push('restam'), aoMudarAFilaPorBaixo: () => log.push('fundo'),
    esquecerOutraConta: (id, o) => log.push('esqueceu:' + id + (o && o.soMemoria ? ':memoria' : '')),
    esvaziarFilaDeSaida: () => log.push('esvaziou'),
    document: { querySelector: () => null },
  };
  const chaves = Object.keys(deps);
  const fonte = [
    'let ultimaEscritaOkEm = 0, contaConfirmadaNestaAba = null, filaAtravessouSessao = false, saidaEsperandoConta = false;',
    'const decididosPorOutraAbaComCardAqui = new WeakSet(), pedidosEmAndamento = new Set(), pousosDaPagina = new Map();',
    ...DECLARACOES,
    ...NOMES_ABA.map(fatiar),
    `return { ${NOMES_ABA.join(', ')}, marcado: (p) => decididosPorOutraAbaComCardAqui.has(p), pousosDaPagina,
      decididas: decididasPorOutraAba, esperando: avisosDePousoSemConta, canal: () => canalDosPousos };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  if (abrirCanal) app.abrirCanalDosPousos();
  return { app, AppState, API, log, leituras: () => leituras };
}

// O aparelho de duas abas da mesma conta: a sessão guardada nele é a da A
// (`tok-x`); a conta confirmada com ela entra no `duasAbas`.
function aparelhoDaConta() {
  return new Map([['waze_session_token', 'tok-x']]);
}
function duasAbas({ fila, tokenB = 'tok-x', perfilB = { id: 4242 }, canalNaB = true, nav = navegador() } = {}) {
  const ap = aparelhoDaConta();
  const A = aba(nav, { fila, aparelho: ap });
  ap.set(CONTA_KEY, JSON.stringify({ id: '4242', s: A.app.marcaDaSessao('tok-x') }));
  const B = aba(nav, { fila, aparelho: ap, token: tokenB, perfil: perfilB, abrirCanal: canalNaB });
  return { A, B, nav, ap };
}

// ═══ R12-2-04 · o pouso no meio da renovação avisa com a marca do GESTO ══════
test('R12-2-04: o pouso que chega com a sessão já CAÍDA avisa a outra aba com a marca de quem decidiu (a do gesto)', async () => {
  const fila = [0, 1, 2].map((i) => P(i));
  const { A, B, nav } = duasAbas({ fila });
  // O gesto: o "Marcar todos" (ou a aprovação) sai com a sessão de agora.
  const quem = A.app.quemDecideAgora();
  assert.deepEqual(quem, { s: A.app.marcaDaSessao('tok-x'), conta: '4242' }, 'a marca do gesto não é a sessão e a conta de agora');
  // A sessão de A CAI com o pedaço no ar: a renovação pergunta à extensão, e a
  // memória fica sem sessão nem perfil até ela responder.
  A.API.sessionToken = null;
  A.AppState.profile = null;
  // O pedaço pousa NESSE meio (o `posQueda` do "Marcar todos").
  A.app.registrarPouso([{ ...fila[0] }, { ...fila[1] }], quem);
  await nav.entregue();
  assert.deepEqual(ids(B.AppState.queue), ['u0', 'u2'],
    `DEFEITO: o pouso no meio da renovação não chegou à outra aba, que seguiu com os pedidos como card: ${ids(B.AppState.queue)}`);
  assert.equal(B.app.marcado(fila[0]), true, 'o card da TELA da outra aba não ficou anotado: o ✕ de lá iria pro Waze');
  assert.equal(A.leituras(), 0, 'DEFEITO: o aviso fez a aba sem sessão ler o aparelho (R9-1-03)');
  assert.equal(A.API.sessionToken, null, 'a aba adotou a sessão guardada no aparelho');
  // CONTROLE: o mesmo pouso SEM a marca do gesto (o app de antes) não avisa
  // ninguém — a outra aba segue com os três (a medida enxerga o defeito).
  const c = duasAbas({ fila });
  c.A.API.sessionToken = null;
  c.A.AppState.profile = null;
  c.A.app.registrarPouso([{ ...fila[0] }, { ...fila[1] }]);
  await c.nav.entregue();
  assert.equal(c.nav.postados.length, 0, 'CONTROLE: sem sessão na memória e sem a marca do gesto, o aviso saiu');
  assert.deepEqual(ids(c.B.AppState.queue), ['u0', 'u1', 'u2']);
});

test('R12-2-04: a marca do gesto não abre a porta pra OUTRA conta — e a mensagem leva só chaves, conta e marca', async () => {
  const fila = [0, 1, 2].map((i) => P(i));
  const { A, B, nav } = duasAbas({ fila, tokenB: 'tok-y', perfilB: { id: 5151 } });
  const quem = A.app.quemDecideAgora();
  A.API.sessionToken = null;
  A.AppState.profile = null;
  A.app.registrarPouso([{ ...fila[1] }], quem);
  await nav.entregue();
  assert.deepEqual(ids(B.AppState.queue), ['u0', 'u1', 'u2'], 'DEFEITO: o pouso de OUTRA conta tirou pedido da fila desta');
  assert.equal(B.app.esperando.length, 0, 'a aba de conta CONHECIDA guardou o aviso de outra conta');
  assert.equal(nav.postados.length, 1, 'PRÉ-CONDIÇÃO: o aviso saiu');
  const msg = nav.postados[0].dado;
  assert.deepEqual(Object.keys(msg).sort(), ['chaves', 'conta', 's', 'v'], `a mensagem leva campos a mais: ${Object.keys(msg)}`);
  assert.ok(!JSON.stringify(msg).includes('tok-x'), 'o TOKEN da sessão foi pro canal');
});

// ═══ R12-2-05 · o aviso que chega com a conta em dúvida espera o perfil ══════
// A B abriu com a sessão `tok-y` e o perfil não chegou; a A tem a sessão guardada
// (`tok-x`) e a conta confirmada com ela. A conta da B não se sabe ainda (a
// guardada foi vista com OUTRA sessão): o aviso da A não dava pra conferir.
test('R12-2-05: o aviso que chega com a conta desta aba em DÚVIDA espera o perfil — e, a MESMA conta, vale (com a hora em que chegou)', async () => {
  const fila = [0, 1, 2].map((i) => P(i));
  const { A, B, nav } = duasAbas({ fila, tokenB: 'tok-y', perfilB: null });
  A.app.registrarPouso([{ ...fila[0] }, { ...fila[1] }]);        // o "Marcar todos" da A
  await nav.entregue();
  assert.deepEqual(ids(B.AppState.queue), ['u0', 'u1', 'u2'], 'PRÉ-CONDIÇÃO: sem saber a própria conta, a B não podia aplicar o aviso');
  assert.equal(B.app.esperando.length, 1, 'DEFEITO: o aviso que não deu pra conferir foi jogado fora');
  const chegou = B.app.esperando[0].em;
  await relogioAndou(chegou);
  // O perfil chega: a MESMA conta. É o `aoConhecerConta` de verdade (o do `definirPerfil`).
  B.AppState.profile = { id: 4242 };
  B.app.aoConhecerConta({ id: 4242 });
  assert.deepEqual(ids(B.AppState.queue), ['u0', 'u2'],
    `DEFEITO: com a dúvida resolvida como a MESMA conta, o que a outra aba decidiu seguiu na fila: ${ids(B.AppState.queue)}`);
  assert.equal(B.app.marcado(fila[0]), true, 'DEFEITO: o card da tela não ficou anotado — o ✕ dele iria pro Waze');
  assert.equal(B.app.esperando.length, 0, 'o aviso aplicado seguiu esperando');
  assert.equal(B.app.pousosDaPagina.get('v1|u1'), chegou,
    'a busca no ar (R12-2-02) compara com a hora em que o aviso CHEGOU, não com a hora do perfil');
  assert.ok(!B.log.some((x) => String(x).startsWith('esqueceu')), 'a mesma conta foi tratada como troca de conta');
});

test('R12-2-05: o perfil diz OUTRA conta — os avisos que esperavam saem sem efeito', async () => {
  const fila = [0, 1, 2].map((i) => P(i));
  const { A, B, nav } = duasAbas({ fila, tokenB: 'tok-y', perfilB: null });
  A.app.registrarPouso([{ ...fila[0] }, { ...fila[1] }]);
  await nav.entregue();
  assert.equal(B.app.esperando.length, 1, 'PRÉ-CONDIÇÃO: o aviso esperava a conta');
  B.AppState.profile = { id: 5151 };
  B.app.aoConhecerConta({ id: 5151 });
  assert.deepEqual(ids(B.AppState.queue), ['u0', 'u1', 'u2'], 'DEFEITO: o aviso de OUTRA conta tirou pedido da fila desta');
  assert.equal(B.app.marcado(fila[0]), false, 'DEFEITO: o aviso de outra conta anotou o card desta');
  assert.equal(B.app.esperando.length, 0, 'o aviso de outra conta seguiu esperando');
  assert.equal(B.app.decididas.size, 0);
});

test('R12-2-05: os avisos que esperam têm TETO (saem os mais antigos), e o "Sair" os leva — a troca de conta, não', async () => {
  const fila = [0, 1, 2].map((i) => P(i));
  const { B } = duasAbas({ fila, tokenB: 'tok-y', perfilB: null });
  for (let i = 0; i < AVISOS_MAX + 10; i++) B.app.aoPousarEmOutraAba({ v: 1, chaves: ['va|' + i], conta: '4242', s: 'outra' });
  assert.equal(B.app.esperando.length, AVISOS_MAX, `os avisos que esperam a conta não têm teto: ${B.app.esperando.length}`);
  assert.deepEqual(B.app.esperando[0].chaves, ['va|10'], 'o teto não tirou os MAIS ANTIGOS');
  B.app.lembrarDecididasPorOutraAba(['vz|1']);
  // A troca de conta tira só as chaves: os avisos que esperam são do `aoConhecerConta` que a revelou.
  B.app.esquecerDecididasPorOutraAba();
  assert.equal(B.app.decididas.size, 0);
  assert.equal(B.app.esperando.length, AVISOS_MAX, 'a troca de conta levou os avisos que o `aoConhecerConta` vai aplicar');
  B.app.esquecerDecididasPorOutraAba({ comOsAvisos: true });
  assert.equal(B.app.esperando.length, 0, 'o "Sair" deixou os avisos (ids de pedidos de terceiros) na memória');
});

// O "Sair" e a troca de conta chamam a limpeza, e o `aoConhecerConta` aplica os
// avisos DEPOIS da troca de conta (que tira o que era da anterior).
test('R12-2-01/05: o "Sair" leva as chaves e os avisos; a troca de conta, as chaves; o perfil aplica os avisos depois da troca', () => {
  assert.match(fatiar('handleLogout'), /^\s+if \(typeof esquecerDecididasPorOutraAba === 'function'\) esquecerDecididasPorOutraAba\(\{ comOsAvisos: true \}\);$/m,
    'o "Sair" deixou na memória o que a outra aba decidiu (ids de pedidos de terceiros)');
  assert.match(fatiar('esquecerOutraConta'), /^\s+if \(typeof esquecerDecididasPorOutraAba === 'function'\) esquecerDecididasPorOutraAba\(\);$/m,
    'a troca de conta deixou as chaves da conta anterior');
  const conhecer = fatiar('aoConhecerConta');
  const aplica = conhecer.search(/^\s+if \(typeof aplicarAvisosQueEsperavamAConta === 'function'\) aplicarAvisosQueEsperavamAConta\(id\);$/m);
  const troca = conhecer.search(/^\s+if \(antes && antes\.id && String\(antes\.id\) !== id\) esquecerOutraConta\(id\);$/m);
  assert.ok(aplica > 0 && troca > 0 && aplica > troca, 'os avisos que esperavam a conta não são aplicados DEPOIS da troca de conta');
});

// ═══ R12-2-02 · a BUSCA no ar quando o pouso da outra aba chega ══════════════
// O `fetchNextPage` de VERDADE na aba B, com o Waze de mentira segurado pelo
// teste (a busca da abertura da segunda aba, a do ↻, a da troca de filtro), e o
// canal de verdade entre as duas.
const NOMES_BUSCA = ['chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila',
  'ordemDoWaze', 'ordemPrecisaDaFilaInteira', 'fetchNextPage', 'filaReal', 'filaRealComDevolvidos',
  'anotarDecididosPorOutraAba', 'lembrarDecididasPorOutraAba', 'tirarDaFilaOQueAOutraAbaDecidiu',
  'abrirCanalDosPousos', 'aoPousarEmOutraAba', 'aplicarPousoDeOutraAba', 'guardarAvisoSemConta', 'marcaDaSessao', 'contaAgora'];

function abaComBusca(nav, { aparelho, token = 'tok-x' }) {
  const respostas = [];
  let pedidas = 0;
  const AppState = {
    authenticated: true, hasMore: true, fetching: false, fetchEpoch: 0, queue: [], currentPlace: null,
    serverTotal: 0, serverBlocked: 0, blockedPartial: false, loadError: false, ultimaBusca: null,
    filters: { unreadOnly: true, types: constante('TYPES_ALL').slice(), residential: '', myArea: false, stateId: '',
      managedAreaId: '', categories: [], sortOrder: 'newest' },
    profile: { id: 4242 }, pendingAction: null,
  };
  const deps = {
    AppState, TYPES_ALL: constante('TYPES_ALL'), PREFETCH_THRESHOLD: constante('PREFETCH_THRESHOLD'),
    MAX_EMPTY_PAGES: constante('MAX_EMPTY_PAGES'), MAX_PAGINAS_POR_BUSCA: constante('MAX_PAGINAS_POR_BUSCA'),
    navigator: { onLine: true },
    API: {
      sessionToken: token,
      temSessaoNaMemoria() { return !!this.sessionToken; },
      getSession() { return this.sessionToken; },
      // O Waze responde quando o TESTE solta (`responder`).
      fetchPlaces: (page) => new Promise((ok) => { pedidas++; respostas.push((places) => ok({ success: true, places,
        hasMore: false, page, total: places.length, blocked: 0 })); }),
    },
    dfato: () => {}, dlog: () => {}, dlogVigiar: () => {}, dlogVoltou: () => {}, dlogCapturarAuto: () => {},
    handleUnauthorized: () => {}, showToast: () => {}, msgDoServidor: (r, d) => d, t: (k) => k,
    rebuscasAuto: 0, guardarPrazoDaSessao: () => {}, offlineGravarFila: () => {}, trackSeenCategories: () => {},
    sortQueue: () => {}, aplicarRecusaAutomatica: () => {}, aoMudarAFilaPorBaixo: () => {}, updatePendingCount: () => {},
    offlineVarrer: () => {}, bloqueadosPorPagina: new Map(), pedidosQueEntraramNaFila: new Set(),
    pedidosEmAndamento: new Set(), pousosDaPagina: new Map(), offlineLigado: () => false,
    offlineLerPousos: () => [], carregarFilaDeSaida: () => [],
    Treino: { ativo: false }, console: { error: () => {} },
    lugarAgora: () => ({ regiao: 'row', pais: '30' }), ORDEM_PADRAO: 'newest', filaEsperaPerfil: false,
    BroadcastChannel: nav.BroadcastChannel, POUSO_NA_MEMORIA_MS,
    safeLS: { get: (k) => (aparelho.has(k) ? aparelho.get(k) : null), set: (k, v) => aparelho.set(k, String(v)),
      remove: (k) => aparelho.delete(k) },
    CONTA_KEY,
  };
  const nomes = Object.keys(deps);
  const fonte = [
    'let filaDeOnde = null;',
    'const decididosPorOutraAbaComCardAqui = new WeakSet();',
    ...DECLARACOES,
    ...NOMES_BUSCA.map(fatiar),
    `return { ${NOMES_BUSCA.join(', ')}, canal: () => canalDosPousos };`,
  ].join('\n');
  const app = new Function(...nomes, fonte)(...nomes.map((n) => deps[n]));
  app.abrirCanalDosPousos();
  return { app, AppState, deps, pedidas: () => pedidas, responder: (places) => respostas.shift()(places) };
}

// A A pousa `quais` (o "Marcar todos" dela) com a busca da B no AR, e o Waze
// responde a busca DEPOIS (com o que tinha quando ela chegou lá).
async function buscaComPousoNoMeio({ quais, waze, canalNaB = true, antesDaBusca = false }) {
  const nav = navegador();
  const ap = aparelhoDaConta();
  const fila = waze.map((p) => ({ ...p }));
  const A = aba(nav, { fila, aparelho: ap });
  ap.set(CONTA_KEY, JSON.stringify({ id: '4242', s: A.app.marcaDaSessao('tok-x') }));
  const B = abaComBusca(nav, { aparelho: ap });
  if (!canalNaB) B.app.canal().close();
  const pousar = async () => {
    A.app.registrarPouso(quais.map((p) => ({ ...p })));
    await nav.entregue();
  };
  if (antesDaBusca) { await pousar(); await relogioAndou(); }
  const busca = B.app.fetchNextPage();
  await ateQue(() => B.pedidas() === 1, 'PRÉ-CONDIÇÃO: a busca da aba B saiu');
  if (!antesDaBusca) await pousar();
  B.responder(waze.map((p) => ({ ...p })));
  await busca;
  return B;
}

test('R12-2-02: a BUSCA que estava no ar quando o pouso da outra aba chegou não traz o pedido decidido como card', async () => {
  const [p1, p2, p3] = [1, 2, 3].map((i) => P(i));
  const B = await buscaComPousoNoMeio({ quais: [p1, p2], waze: [p1, p2, p3] });
  assert.deepEqual(ids(B.AppState.queue), ['u3'],
    `DEFEITO: a busca que estava no ar trouxe como card o que a outra aba decidiu — o ✕ daqui iria pro Waze: ${ids(B.AppState.queue)}`);
  assert.equal(B.AppState.serverTotal, 1, 'o "Restam" contou o que a outra aba decidiu');
  // CONTROLE: a B SEM o canal (o app de antes) — os três entram (a medida enxerga o defeito).
  const c = await buscaComPousoNoMeio({ quais: [p1, p2], waze: [p1, p2, p3], canalNaB: false });
  assert.deepEqual(ids(c.AppState.queue), ['u1', 'u2', 'u3'], 'CONTROLE: sem o canal, a busca devia trazer os três');
});

test('R12-2-02: a decisão de ANTES de a busca sair — quem manda é o Waze (com "lidos também", o lido volta como card, como numa aba só)', async () => {
  const [p1, p3] = [1, 3].map((i) => P(i));
  // A A marcou p1 como lido; a busca da B sai DEPOIS, e o Waze (com "lidos
  // também") ainda o devolve, pendente: é card legítimo, como seria depois de um
  // ↻ numa aba só.
  const B = await buscaComPousoNoMeio({ quais: [p1], waze: [p1, p3], antesDaBusca: true });
  assert.deepEqual(ids(B.AppState.queue), ['u1', 'u3'],
    'a regra ficou larga demais: a busca que saiu DEPOIS da decisão de lá deixou de fora o que o Waze devolveu');
});

test('R12-2-02: o aviso da FILA DE SAÍDA (a decisão pelo card da outra aba) também vale pra busca no ar', async () => {
  const [p1, p2, p3] = [1, 2, 3].map((i) => P(i));
  const nav = navegador();
  const B = abaComBusca(nav, { aparelho: aparelhoDaConta() });
  B.app.canal().close();                       // só o aviso da fila de saída (o navegador sem o canal)
  const busca = B.app.fetchNextPage();
  await ateQue(() => B.pedidas() === 1, 'PRÉ-CONDIÇÃO: a busca saiu');
  // A outra aba anotou o ✓ dela na fila de saída (o `storage` chega aqui), e ele
  // POUSOU e saiu de lá antes de a busca voltar: a fila de saída já está vazia.
  B.app.anotarDecididosPorOutraAba({ key: SAIDA_KEY, oldValue: '[]',
    newValue: JSON.stringify([{ tipo: 'read', venueID: 'v2', updateRequestID: 'u2' }]) });
  B.app.tirarDaFilaOQueAOutraAbaDecidiu();
  B.responder([p1, p2, p3].map((p) => ({ ...p })));
  await busca;
  assert.deepEqual(ids(B.AppState.queue), ['u1', 'u3'],
    `DEFEITO: a decisão que a outra aba pôs na fila de saída voltou como card pela busca no ar: ${ids(B.AppState.queue)}`);
});

// ═══ R12-2-01 · a recusa automática NO AR ════════════════════════════════════
// O harness do teste R10-2-01 (test/lotes-auditoria-r10.test.mjs): as funções da
// recusa, do lote e do registro de autores de verdade, num escopo onde o que o
// teste não fornece é um "buraco negro" — mais o aviso da outra aba de verdade.
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
const lsFalso = () => {
  const guardado = new Map();
  return { guardado, localStorage: { getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
    setItem: (k, v) => guardado.set(k, String(v)), removeItem: (k) => guardado.delete(k) } };
};
const GESTO = { dia: '2026-10-07', onde: '30', t: 1, lang: 'pt' };
const OK = { success: true };
const hoje = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; };
const AUTOR = 777;
const pedidoDe = (i, autor) => ({ venueID: 'v' + i, updateRequestID: (autor === AUTOR ? 'x' : 'u') + i, creatorId: autor,
  createdBy: autor === AUTOR ? 'spam' : 'autor' + autor });

// A fila do roteiro do auditor (e1): u1 na tela (outro autor), x2–x7 do autor
// marcado com a recusa LIGADA, e u8.
function montarRecusa() {
  const { guardado, localStorage } = lsFalso();
  const AUTORES_KEY = constante('AUTORES_KEY');
  guardado.set(AUTORES_KEY, JSON.stringify({ v: [], r: { [String(AUTOR)]: [6, 'spam', hoje(), 1] } }));
  const fila = [pedidoDe(1, 1001), ...[2, 3, 4, 5, 6, 7].map((i) => pedidoDe(i, AUTOR)), pedidoDe(8, 1008)];
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { read: 0, rejected: 20, skipped: 0 },
    serverTotal: fila.length, fetchEpoch: 0, hasMore: false, inFlightActions: 0, autores: null, pendingAction: null };
  const enviados = [];
  const portoes = [];
  const deps = {
    AppState, localStorage, textoDaCopia: new WeakMap(), epocaDaSessao: 0, Treino: { ativo: false, _salvo: null },
    AUTORES_KEY, AUTORES_MAX_VISTOS: constante('AUTORES_MAX_VISTOS'),
    AUTORES_MAX_REINCIDENTES: constante('AUTORES_MAX_REINCIDENTES'), AUTORES_MAX_DIAS: constante('AUTORES_MAX_DIAS'),
    podeRecusarAutomaticoAqui: () => true, contaConfirmada: () => true,
    pedidosEmAndamento: new Set(), recusaAutomaticaRodando: false, recusaAutomaticaPedidaDeNovo: false,
    recusaAutomaticaNestaFila: false,
    navigator: { onLine: true }, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [40, 40],
    API: { getRegion: () => 'row', rejectPlace: (v, u) => new Promise((ok) => { enviados.push(u); portoes.push(ok); }) },
    carimboDoGesto: () => GESTO, chaveDoPedido: chave,
    showToast: () => ({ texto() {}, dispensar() {} }), t: (k) => k,
    renderHistory: () => {}, registrarPouso: () => {}, recordHistory: () => {},
    aprovacaoDelaJaPousou: () => false, dfato: () => {}, handleUnauthorized: () => {},
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
    reivindicacaoDestaAba: () => ({}),
    // O aviso da OUTRA aba, de verdade (a anotação, as chaves, a retirada).
    decididosPorOutraAbaComCardAqui: new WeakSet(), decididasPorOutraAba: new Map(),
    DECIDIDAS_POR_OUTRA_ABA_MAX: constante('DECIDIDAS_POR_OUTRA_ABA_MAX'), pousosDaPagina: new Map(), POUSO_NA_MEMORIA_MS,
  };
  const h = montar(['aplicarRecusaAutomatica', 'enviarLote', 'callWithRetry', 'autoLigado', 'loadAutores', 'salvarAutores',
    'podarAutores', 'diaDeHoje', 'registrarRejeicaoDeAutor', 'copiaEmDia', 'lembrarTextoDaCopia',
    'filaReal', 'filaRealComDevolvidos', 'anotarDecididosPorOutraAba', 'lembrarDecididasPorOutraAba',
    'decididoNaOutraAbaDepoisDe', 'tirarDaFilaOQueAOutraAbaDecidiu', 'aplicarPousoDeOutraAba'], deps);
  return { h, deps, AppState, enviados, portoes, fila: () => AppState.queue.map((p) => p.updateRequestID),
    soltar: (resp) => portoes.shift()(resp) };
}

// Solta o que chegar ao Waze de mentira até a recusa terminar, com teto.
async function terminar(m, recusa, tetoMs = 3000) {
  const fim = performance.now() + tetoMs;
  while (m.deps.recusaAutomaticaRodando) {
    if (performance.now() > fim) assert.fail('a recusa automática não terminou');
    while (m.portoes.length) m.soltar(OK);
    await tique(2);
  }
  await recusa;
}

// O roteiro do auditor (e1): o 1º alvo está no ar quando a OUTRA aba decide o x5
// — que já saiu da fila desta (os alvos saem antes do envio).
async function recusaComDecisaoLa(m, decidir) {
  const recusa = m.h.aplicarRecusaAutomatica();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedido do autor saiu');
  assert.ok(!m.AppState.queue.some((p) => p.updateRequestID === 'x5'), 'PRÉ-CONDIÇÃO: o x5 já saiu da fila (é alvo da recusa no ar)');
  if (decidir) decidir();
  await terminar(m, recusa);
}

test('R12-2-01: a recusa automática NO AR não rejeita o pedido que a OUTRA aba decidiu — e ele sai da fila, sem voltar como card', async () => {
  const m = montarRecusa();
  // O "Marcar todos" da outra aba pousa o x5: o aviso do canal chega aqui.
  await recusaComDecisaoLa(m, () => m.h.aplicarPousoDeOutraAba(['v5|x5']));
  assert.deepEqual(m.enviados, ['x2', 'x3', 'x4', 'x6', 'x7'],
    `DEFEITO: a recusa no ar mandou rejeitar o pedido que a pessoa decidiu na outra aba (lido lá, rejeitado aqui): ${m.enviados}`);
  assert.deepEqual(m.fila(), ['u1', 'u8'], 'DEFEITO: o pedido decidido lá voltou pra fila como card (seria decidido de novo aqui)');
  assert.equal(m.AppState.serverTotal, m.AppState.queue.length,
    `o "Restam" (${m.AppState.serverTotal}) não acompanha a fila (${m.AppState.queue.length} cards)`);
  assert.equal(m.AppState.stats.rejected, 25, 'o placar conta só os 5 que esta aba rejeitou');
  // CONTROLE: ninguém decide nada lá — os seis vão (o instrumento enxerga o x5).
  const c = montarRecusa();
  await recusaComDecisaoLa(c, null);
  assert.deepEqual(c.enviados, ['x2', 'x3', 'x4', 'x5', 'x6', 'x7'], 'CONTROLE: sem a decisão da outra aba, os seis deviam sair');
  assert.equal(c.AppState.stats.rejected, 26);
});

test('R12-2-01: o mesmo pelo aviso da FILA DE SAÍDA (o ✓ do card da outra aba)', async () => {
  const m = montarRecusa();
  await recusaComDecisaoLa(m, () => m.h.anotarDecididosPorOutraAba({ key: SAIDA_KEY, oldValue: '[]',
    newValue: JSON.stringify([{ tipo: 'read', venueID: 'v5', updateRequestID: 'x5' }]) }));
  assert.deepEqual(m.enviados, ['x2', 'x3', 'x4', 'x6', 'x7'],
    `DEFEITO: a recusa no ar mandou rejeitar o pedido que a outra aba pôs na fila de saída: ${m.enviados}`);
  assert.deepEqual(m.fila(), ['u1', 'u8']);
});

test('R12-2-01: decidido lá ANTES de a recusa pegar a lista — quem manda é o Waze, e a recusa age (como numa aba só)', async () => {
  const m = montarRecusa();
  // O x5 não estava na fila desta quando a outra aba o marcou como lido; entrou
  // DEPOIS, por uma busca que já reflete o Waze (com "lidos também" ele segue
  // pendente lá). É card legítimo, e a recusa do autor marcado o rejeita.
  const x5 = m.AppState.queue.find((p) => p.updateRequestID === 'x5');
  m.AppState.queue = m.AppState.queue.filter((p) => p !== x5);
  m.h.aplicarPousoDeOutraAba(['v5|x5']);
  m.AppState.queue.push({ ...x5 });
  await relogioAndou();
  const recusa = m.h.aplicarRecusaAutomatica();
  await terminar(m, recusa);
  assert.ok(m.enviados.includes('x5'),
    `a regra ficou larga demais: o que a outra aba decidiu ANTES de a lista ser tirada não sai mais: ${m.enviados}`);
});

// ═══ R12-2-04 · os dois caminhos que pousam com a sessão caída ═══════════════
const espiaoDoCanal = () => { const posts = []; return { posts, canal: { postMessage: (msg) => posts.push(structuredClone(msg)) } }; };
const sessaoDeMentira = (token) => ({
  sessionToken: token,
  temSessaoNaMemoria() { return !!this.sessionToken; },
  getSession() { return this.sessionToken; },
  getRegion: () => 'row',
});
const NOMES_AVISO = ['registrarPouso', 'avisarOutrasAbasDoPouso', 'quemDecideAgora', 'marcaDaSessao', 'marcaDestaAba', 'contaAgora'];
const depsDoAviso = (canal) => ({ canalDosPousos: canal, pousosDaPagina: new Map(), POUSO_NA_MEMORIA_MS,
  offlineLigado: () => false, ultimaEscritaOkEm: 0, CONTA_KEY, safeLS: { get: () => null, set() {}, remove() {} } });
// A QUEDA da sessão com a escrita no ar: a época troca (`derrubarSessao`) e a
// memória fica sem sessão nem perfil até a renovação responder.
const cair = (m) => { m.deps.epocaDaSessao = 1; m.deps.API.sessionToken = null; m.deps.AppState.profile = null; };

test('R12-2-04: o "Marcar todos" cujo pedaço pousa no meio da renovação avisa a outra aba com a marca do GESTO', async () => {
  const espiao = espiaoDoCanal();
  const fila = [1, 2, 3].map((i) => P(i));
  const portoes = [];
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { read: 40, rejected: 0, skipped: 0 },
    serverTotal: fila.length, fetchEpoch: 0, hasMore: false, pendingAction: null, inFlightActions: 0, profile: { id: 4242 } };
  const API = { ...sessaoDeMentira('tok-gesto'),
    markAsReadBatch: () => new Promise((ok) => portoes.push(ok)), markAsRead: () => new Promise((ok) => portoes.push(ok)) };
  const deps = {
    AppState, API, ...depsDoAviso(espiao.canal), LOTE_LIDOS_PEDACO: 2, epocaDaSessao: 0, Treino: { ativo: false },
    STATS_KEY: constante('STATS_KEY'), localStorage: lsFalso().localStorage,
    pedidosEmAndamento: new Set(), loteDeLidosContado: null, loteDeLidosEmVoo: false, escritasConferindo: 0,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, contaDestaAbaEmDuvida: () => false,
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), callWithRetry: (fn) => fn(),
    carimboDoGesto: () => GESTO, chaveDoPedido: chave, decididosPorOutraAbaComCardAqui: new WeakSet(),
    showToast: () => {}, t: (k) => k, msgDoServidor: (r, d) => d,
    document: { getElementById: () => ({ textContent: '' }) }, openModal: () => {}, closeModal: () => {},
  };
  const h = montar(['openBatchReadConfirm', 'handleBatchMarkRead', 'acoesTravadas', 'acoesTravadasForaDaJanela',
    'aprovacaoDaTelaNoAr', 'avisoDaTrava', 'marcarEmAndamento', 'saveStats', ...NOMES_AVISO], deps);
  h.openBatchReadConfirm();
  const lote = h.handleBatchMarkRead();
  await ateQue(() => portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedaço saiu');
  cair(h);
  portoes.shift()({ success: true });             // o pedaço pousa no meio da renovação
  await lote;
  assert.equal(espiao.posts.length, 1, 'DEFEITO: o pedaço que pousou no meio da renovação não avisou a outra aba');
  assert.deepEqual(espiao.posts[0], { v: 1, chaves: ['v1|u1', 'v2|u2'], conta: '4242', s: h.marcaDaSessao('tok-gesto') },
    'o aviso não leva a marca de QUEM decidiu (a sessão e a conta do gesto)');
  // CONTROLE: sem sessão na memória, o pouso sem a marca do gesto não avisa —
  // é o que o "Marcar todos" fazia (a medida enxerga o defeito).
  h.registrarPouso([{ ...fila[2] }]);
  assert.equal(espiao.posts.length, 1, 'CONTROLE: o pouso sem sessão e sem a marca do gesto avisou');
});

test('R12-2-04: a aprovação de foto que pousa no meio da renovação avisa a outra aba com a marca do GESTO', async () => {
  const espiao = espiaoDoCanal();
  const place = { ...P(9), purType: 'NEW_PHOTO' };
  let soltar = null;
  const AppState = { queue: [place], currentPlace: place, serverTotal: 1, fetchEpoch: 0, profile: { id: 4242 } };
  const API = { ...sessaoDeMentira('tok-gesto'), aprovarPedido: () => new Promise((ok) => { soltar = ok; }) };
  const deps = {
    AppState, API, ...depsDoAviso(espiao.canal), epocaDaSessao: 0, chaveDoPedido: chave,
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), decididosPorOutraAbaComCardAqui: new WeakSet(),
    vezDasFotosNoLocal: () => ({ anterior: null, soltar() {} }), callWithRetry: (fn) => fn(),
    Lightbox: { marcarComoAprovada() {}, esquecerProposta() {}, desmarcarAprovada() {}, isOpen: () => false, place: null },
    showToast: () => {}, t: (k) => k,
  };
  const h = montar(['enviarAprovacao', 'aprovacaoPousouDepoisDaQueda', 'pousouNoWaze', 'contarIdasSemResposta', ...NOMES_AVISO], deps);
  const envio = h.enviarAprovacao({ id: 'u9', place, idx: 0, regiao: 'row', epocaFila: 0 });
  await ateQue(() => typeof soltar === 'function', 'PRÉ-CONDIÇÃO: a aprovação saiu');
  cair(h);
  soltar({ success: true });                       // pousa no meio da renovação
  assert.equal(await envio, false, 'PRÉ-CONDIÇÃO: a resposta depois da queda não grava nada aqui');
  assert.deepEqual(espiao.posts, [{ v: 1, chaves: ['v9|u9'], conta: '4242', s: h.marcaDaSessao('tok-gesto') }],
    'DEFEITO: a aprovação que pousou no meio da renovação não avisou a outra aba (ou sem a marca do gesto)');
});

// ═══ R12-4-01 · a fila guardada e o card que a outra aba decidiu ═════════════
// As funções do offline de verdade (a gravação, a poda dos pousos e o filtro da
// reabertura), com a base do IndexedDB de mentira e o aparelho dividido.
const NOMES_OFFLINE = ['chaveDoPedido', 'filaReal', 'filaRealComDevolvidos', 'anotarDecididosPorOutraAba',
  'lembrarDecididasPorOutraAba', 'tirarDaFilaOQueAOutraAbaDecidiu', 'carregarFilaDeSaida', 'offlineLerPousos',
  'offlinePodarPousos', 'offlineGravarFila', 'semOsJaDecididos', 'marcaDaSessao', 'marcaDestaAba', 'contaAgora'];
function baseDeMentira() {
  const guardado = {};
  return {
    guardado,
    offlineDB: async () => ({
      close() {},
      transaction: () => {
        const tx = { objectStore: () => ({ put: (v, k) => { guardado[k] = structuredClone(v); setTimeout(() => tx.oncomplete()); } }) };
        return tx;
      },
    }),
  };
}
function abaOffline({ aparelho, base, fila }) {
  const AppState = { queue: fila.slice(), currentPlace: fila[0] || null, serverTotal: fila.length, profile: { id: 4242 },
    filters: { countryId: 30 }, pendingAction: null };
  const deps = {
    AppState, API: sessaoDeMentira('tok-x'), Treino: { ativo: false, _salvo: null },
    safeLS: { get: (k) => (aparelho.has(k) ? aparelho.get(k) : null), set: (k, v) => aparelho.set(k, String(v)),
      remove: (k) => aparelho.delete(k) },
    SAIDA_KEY, CONTA_KEY, OFFLINE_POUSOS_KEY, POUSO_NA_MEMORIA_MS, offlineLigado: () => true,
    OFFLINE_STORE: constante('OFFLINE_STORE'), offlineDB: base.offlineDB, dfato: () => {},
    updatePendingCount: () => {}, aoMudarAFilaPorBaixo: () => {},
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }),
  };
  const chaves = Object.keys(deps);
  const fonte = [
    'let filaDeOnde = null, offlineFilaGravadaEm = null, offlineFilaGravadaChaves = null, offlineFilaPreparada = null;',
    'const decididosPorOutraAbaComCardAqui = new WeakSet(), pedidosEmAndamento = new Set(), pousosDaPagina = new Map();',
    ...DECLARACOES,
    ...NOMES_OFFLINE.map(fatiar),
    `return { ${NOMES_OFFLINE.join(', ')}, marcado: (p) => decididosPorOutraAbaComCardAqui.has(p) };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  return { app, AppState };
}

// O roteiro do auditor (n5): B decide X, o card da TELA de A (✓ com rede, e B
// tem o offline ligado: o pouso vai pro aparelho); A o mantém na tela, anotado
// (R10-2-02). A janela venceu: a varredura de A grava a fila (desde = agora) e
// poda o pouso de B, mais velho. Reaberto sem rede, X volta?
async function guardadaDepoisDaOutraAba({ decide = true, objetoNovo = false } = {}) {
  const ap = aparelhoDaConta();
  const base = baseDeMentira();
  const fila = [1, 2, 3].map((i) => P(i));
  const A = abaOffline({ aparelho: ap, base, fila });
  if (decide) {
    const tB = Date.now();
    ap.set(OFFLINE_POUSOS_KEY, JSON.stringify([['v1|u1', tB]]));
    A.app.anotarDecididosPorOutraAba({ key: SAIDA_KEY, oldValue: '[]',
      newValue: JSON.stringify([{ tipo: 'read', venueID: 'v1', updateRequestID: 'u1' }]) });
    A.app.tirarDaFilaOQueAOutraAbaDecidiu();
    assert.equal(A.AppState.currentPlace, fila[0], 'PRÉ-CONDIÇÃO: o card da tela fica (R10-2-02)');
    assert.equal(A.app.marcado(fila[0]), true, 'PRÉ-CONDIÇÃO: o card da tela ficou anotado');
    // O mesmo pedido que ENTRA de novo (outro objeto: o ↻ com "lidos também").
    if (objetoNovo) A.AppState.queue[0] = A.AppState.currentPlace = { ...fila[0] };
    await relogioAndou(tB);
  }
  assert.equal(await A.app.offlineGravarFila(), true, 'PRÉ-CONDIÇÃO: a fila não foi gravada');
  const g = base.guardado.fila;
  // Reaberto sem rede: página NOVA (memória vazia), a mesma base e o mesmo aparelho.
  const C = abaOffline({ aparelho: ap, base, fila: [] });
  return { guardada: g.places.map(chave), reaberta: C.app.semOsJaDecididos(g.places, g.desde).places.map(chave),
    pousos: C.app.offlineLerPousos() };
}

test('R12-4-01: a fila guardada NÃO leva o card que a outra aba decidiu — reaberto sem rede, ele não volta como card', async () => {
  const r = await guardadaDepoisDaOutraAba();
  assert.deepEqual(r.guardada, ['v2|u2', 'v3|u3'],
    `DEFEITO: a fila guardada levou o card da tela que a OUTRA aba decidiu: ${r.guardada}`);
  assert.deepEqual(r.reaberta, ['v2|u2', 'v3|u3'],
    `DEFEITO: reaberto sem rede, o pedido que a outra aba decidiu voltou como card — e a 2ª decisão iria ao Waze: ${r.reaberta}`);
  // É a poda que tornava a gravação fatal: o pouso de lá, mais velho que a lista
  // gravada, sai do aparelho — sem a exclusão, nada mais o segurava.
  assert.deepEqual(r.pousos, [], 'PRÉ-CONDIÇÃO: a gravação de agora podou o pouso da outra aba');
  // CONTROLE: sem a decisão da outra aba, o mesmo pedido é gravado e reabre (a medida enxerga o X).
  const c = await guardadaDepoisDaOutraAba({ decide: false });
  assert.deepEqual(c.guardada, ['v1|u1', 'v2|u2', 'v3|u3']);
  assert.deepEqual(c.reaberta, ['v1|u1', 'v2|u2', 'v3|u3']);
});

test('R12-4-01: pelo OBJETO anotado, não pela chave — o mesmo pedido que entra de novo (o ↻ com "lidos também") é gravado', async () => {
  const r = await guardadaDepoisDaOutraAba({ objetoNovo: true });
  assert.deepEqual(r.guardada, ['v1|u1', 'v2|u2', 'v3|u3'],
    'a regra ficou larga demais: o pedido que voltou numa busca de depois (card legítimo) ficou fora da fila guardada');
});

// ═══ os testes fatiam o FONTE; o app carrega o `js/min/` (gotcha #22) ═════════
test('o bundle GERADO tem os consertos (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  for (const nome of ['lembrarDecididasPorOutraAba', 'decididoNaOutraAbaDepoisDe', 'esquecerDecididasPorOutraAba',
    'quemDecideAgora', 'aplicarPousoDeOutraAba', 'guardarAvisoSemConta', 'aplicarAvisosQueEsperavamAConta']) {
    const re = new RegExp('\\b' + nome + '\\b', 'g');
    assert.ok(contar(APP_SEM, re) > 0, `PRÉ-CONDIÇÃO: ${nome} sumiu do fonte`);
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${nome} — falta \`npm run js\``);
  }
});
