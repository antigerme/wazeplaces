// A FILA, as contas e as telas na rodada 18 da auditoria (o lote 22):
//
//  · R18-1-01 = R18-2-01 — o Treino abria com o "Marcar todos" ainda no ar (a queda com renovação
//    e a conta em dúvida soltam o `loteDeLidosEmVoo` de propósito), e o lote que pousava com ele
//    aberto deixava na fila real guardada os pedidos que marcou como lidos;
//  · R18-1-02 — a conta nova entrava com os pedidos do lote da anterior "em andamento": a fila
//    saía vazia, "Tudo limpo!", com os pedidos pendentes dela;
//  · R18-2-03 — a conta em dúvida não redesenhava o canto "Enviando N…";
//  · R18-3-01 — a queda deixava a escrita de foto contada no diálogo do "Sair" da sessão nova;
//  · R18-3-02 — aprovar a foto aberta depois do "Marcar todos" descia o "Restam" de novo;
//  · R18-1-03 — as categorias salvas que o servidor recusa (vazia, mais de 80 caracteres);
//  · R18-1-04 — o link de pareamento colado na aba que já está no app.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não fornece vira um
// "buraco negro" (o molde do test/fila-auditoria-r17.test.mjs). Cada teste foi visto REPROVANDO
// com o conserto desfeito (as sabotagens estão no relatório do lote) e carrega um CONTROLE que
// reprova se o instrumento não enxergar o defeito (gotcha #28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const APP = ler('js/app.js');
const APP_SEM = semComentario(APP);

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

function buracoNegro(nome, chamou) {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro(nome + '.' + k, chamou)),
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
      return typeof k === 'string' ? buracoNegro(k, chamou) : undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map(fatiar).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}

const tique = () => new Promise((ok) => setImmediate(ok));
const tiques = async (n = 6) => { for (let i = 0; i < n; i++) await tique(); };
// Espera a CONDIÇÃO, com teto — nunca um prazo fixo (gotcha: teste não espera por prazo).
async function ateQue(cond, msg, teto = 3000) {
  const fim = Date.now() + teto;
  while (!cond()) {
    if (Date.now() > fim) assert.fail('a espera estourou: ' + msg);
    await tique();
  }
}
const chaveDe = new Function(fatiar('chaveDoPedido') + '\nreturn chaveDoPedido;')();
const P = (i, extra = {}) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 77, createdBy: 'spam', ...extra });

// O diálogo do "Sair" de mentira: o aviso (texto e `hidden`) e o modal aberto.
function dialogoDoSair({ aberto = true } = {}) {
  const classes = (ini) => { const c = new Set(ini); return { contains: (x) => c.has(x), add: (x) => c.add(x), remove: (x) => c.delete(x),
    toggle: (x, f) => (f ? c.add(x) : c.delete(x)) }; };
  const aviso = { textContent: '', classList: classes(['hidden']) };
  const modal = { classList: classes(aberto ? [] : ['hidden']) };
  return { aviso, modal, document: { getElementById: (id) => (id === 'logoutSaidaAviso' ? aviso : id === 'logoutModal' ? modal : null) },
    texto: () => (aviso.classList.contains('hidden') ? '' : aviso.textContent) };
}

// O trecho de um MÉTODO do objeto `Treino` (ou de outra declaração indentada), pelas chaves.
function metodo(nome) {
  const m = new RegExp('^    ' + nome + '\\(\\) \\{', 'm').exec(APP_SEM);
  assert.ok(m, `o método ${nome} sumiu do app.js`);
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', m.index); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) return APP_SEM.slice(m.index, j + 1);
  }
  throw new Error('não fechou: ' + nome);
}

// ═══ R18-1-01 = R18-2-01 · o Treino × o "Marcar todos" que a queda soltou ═══════
// A queda com renovação (e a conta em dúvida resolvida como a mesma) desligam o
// `loteDeLidosEmVoo` de propósito (o lote morto não trava a sessão que vem), mas o lote
// segue no ar e os alvos dele ficam em `alvosDoLoteDeLidosNoAr` (R17-2-05).
function conferenciaDoTreino({ lote = false, alvos = [] } = {}) {
  const deps = {
    AppState: { authenticated: true }, loteDeLidosEmVoo: lote, alvosDoLoteDeLidosNoAr: new Map(alvos),
    aprovacaoPendente: null, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), avisoDaTrava: () => 'toast.sessao',
  };
  const Treino = new Function('__escopo', `with (__escopo) { return { ${metodo('motivoDeRecusa')} }; }`)(
    new Proxy(deps, { has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)), get: (t, k) => (k === Symbol.unscopables ? undefined : t[k]) }));
  return Treino;
}

test('R18-1-01: o treino NÃO abre com o "Marcar todos" ainda no ar depois da queda — os alvos dele recusam, com o aviso da espera do lote', () => {
  const t = conferenciaDoTreino({ lote: false, alvos: [['v1|u1', 0]] });
  assert.equal(t.motivoDeRecusa(), 'toast.esperaLote',
    'DEFEITO: o treino abriu com o lote de lidos de uma sessão que acabou ainda no ar — no `sair()` os pedidos que ele marcou voltam como card');
  // CONTROLES: o lote da sessão de agora (a trava de sempre) recusa; sem lote nenhum, abre.
  assert.equal(conferenciaDoTreino({ lote: true }).motivoDeRecusa(), 'toast.esperaLote', 'CONTROLE: o lote da sessão de agora tem que recusar');
  assert.equal(conferenciaDoTreino().motivoDeRecusa(), null, 'CONTROLE: sem lote nenhum o treino abre');
});

// O "Marcar todos" de verdade (`handleBatchMarkRead`), a queda com renovação com o pedaço
// no ar, o treino aberto nesse meio (a fila real fica GUARDADA nele, a época sobe) e a
// resposta do pedaço pousando.
function loteComTreinoAberto({ treino = true, n = 4 } = {}) {
  const places = Array.from({ length: n }, (_, i) => P(i + 1, { creatorId: 2000 + i }));
  const portoes = [];
  const pousos = [];
  const toasts = [];
  const AppState = { authenticated: true, queue: places.slice(), currentPlace: places[0], stats: { read: 0, rejected: 0, skipped: 0 },
    serverTotal: n, fetchEpoch: 0, hasMore: false, pendingAction: null, inFlightActions: 0, profile: { id: 1 }, contaEmDuvida: false };
  const deps = {
    AppState, document: dialogoDoSair().document, epocaDaSessao: 0, Treino: { ativo: false }, LOTE_LIDOS_PEDACO: 25,
    pedidosEmAndamento: new Set(), pedidosDoLoteSemEnviar: new Set(), escritasEsperandoAVez: new Set(),
    alvosDoLoteDeLidosNoAr: new Map(), aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), rejeicoesDeLoteNoAr: new Set(),
    loteDeLidosContado: new Set(places.map(chaveDe)), loteDeLidosEmVoo: false, lidosDoLoteNoAr: 0, escritasConferindo: 0,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, extRenovando: false,
    contaDestaAbaEmDuvida: () => false,
    API: { markAsReadBatch: () => new Promise((ok) => portoes.push(ok)), getRegion: () => 'row' },
    callWithRetry: (fn) => fn(), carimboDoGesto: () => ({ dia: '2026-10-14', onde: '30', t: 1, lang: 'pt' }),
    decididosPorOutraAbaComCardAqui: new WeakSet(), removeUndoBanner() {}, aplicarTravaDeAcao() {},
    showToast: (m) => { toasts.push(m); return { remover() {} }; }, t: (k, v) => k + ':' + (v && v.n),
    updateInFlightIndicator() {}, aoMudarAFilaPorBaixo() {}, updatePendingCount() {}, updateStats() {}, saveStats() {},
    pousouNoWaze: (r) => !!(r && r.success), registrarPouso: (ps) => pousos.push(...[].concat(ps).map(chaveDe)),
    recordHistory() {}, registrarLoteConfirmado() {}, carregarFilaDeSaida: () => [], reivindicadoPorOutraAba: () => false,
    aprovacaoDelaJaPousou: () => false, registrarPousoDepoisDaQueda() {}, showCurrentPlace() {}, startFetching() {}, showNoPlaces() {},
    removeCurrentCardEl() {}, quemDecideAgora: () => ({ s: 'a', conta: '1' }),
  };
  const h = montar(['openBatchReadConfirm', 'handleBatchMarkRead', 'marcarEmAndamento', 'marcarLoteSemEnviar', 'redesenharAvisoDoSairSeAberto',
    'soltarOsLotesDaSessaoQueAcabou', 'chaveDoPedido', 'acoesTravadasForaDaJanela', 'acoesTravadas', 'aprovacaoDaTelaNoAr',
    'loteDeLidosDaTelaNoAr', 'avisoDaTrava'], deps);
  // O treino que abre: a fila real fica guardada, a época sobe, a tela passa a ter os exemplos.
  const abrirOTreino = () => {
    const guardada = AppState.queue;
    deps.Treino = { ativo: true, _salvo: { queue: guardada, currentPlace: AppState.currentPlace, epoca: AppState.fetchEpoch, devolver: [] },
      filaGuardada(e) { return this.ativo && this._salvo.epoca === e ? this._salvo.queue : null; } };
    AppState.fetchEpoch++;
    AppState.queue = [P(900, { _treino: true })];
    AppState.currentPlace = AppState.queue[0];
    return guardada;
  };
  return { h, deps, places, portoes, pousos, toasts, AppState, abrirOTreino };
}

async function loteQuePousaComTreino({ treino }) {
  const m = loteComTreinoAberto();
  m.h.openBatchReadConfirm();
  const fim = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o pedaço saiu');
  m.deps.epocaDaSessao++;                      // a queda com renovação (mesma conta)
  m.deps.loteDeLidosEmVoo = false;
  m.h.soltarOsLotesDaSessaoQueAcabou();
  const guardada = treino ? m.abrirOTreino() : null;
  m.portoes.shift()({ success: true });        // o Waze marcou o pedaço
  await fim;
  return { ...m, guardada };
}

test('R18-1-01: o lote que pousa com o treino aberto TIRA os pedidos da fila real guardada e desce o "Restam" dela — no `sair()` ela não devolve o que o lote marcou como lido', async () => {
  const m = await loteQuePousaComTreino({ treino: true });
  assert.deepEqual(m.guardada.map((p) => p.updateRequestID), [],
    'DEFEITO: a fila real guardada pelo treino ainda tem os pedidos que o lote marcou como lidos — voltam como card no `sair()`, e o ✕ os rejeita');
  assert.equal(m.AppState.serverTotal, 0, 'o "Restam" da fila real seguiu contando o que o lote marcou');
  assert.equal(m.pousos.length, 4, 'o pouso do que o lote marcou depois da queda não foi registrado');
  assert.equal(m.h.chamou.includes('devolverPedidoRecusado'), false,
    'o lote devolveu como "não pousou" pedidos que pousaram (ou que seguem na fila guardada)');
  assert.deepEqual(m.toasts, [m.toasts[0]], 'só o "Marcando N…" — nenhum erro: o lote inteiro pousou');
  // O treino não foi tocado: a tela segue com os exemplos.
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v900']);
  // CONTROLE: o mesmo roteiro SEM o treino tira da fila da tela (o instrumento enxerga a fila e o "Restam").
  const c = await loteQuePousaComTreino({ treino: false });
  assert.deepEqual([c.AppState.queue.length, c.AppState.serverTotal], [0, 0], 'CONTROLE: sem treino o lote deixou pedido na fila');
});

test('R18-1-01: o pedaço que NÃO pousou fica na fila guardada UMA vez — não vai também para o que o `sair()` devolve', async () => {
  const m = loteComTreinoAberto({ n: 4 });
  m.h.openBatchReadConfirm();
  m.deps.LOTE_LIDOS_PEDACO = 2;
  const fim = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedaço saiu');
  m.deps.epocaDaSessao++;
  m.deps.loteDeLidosEmVoo = false;
  m.h.soltarOsLotesDaSessaoQueAcabou();
  const guardada = m.abrirOTreino();
  m.portoes.shift()({ success: true });        // o 1º pedaço (v1, v2) pousa depois da queda; o 2º nunca sai
  await fim;
  assert.deepEqual(guardada.map((p) => p.updateRequestID), ['u3', 'u4'], 'a fila guardada não ficou com os dois que o lote não marcou');
  assert.equal(m.AppState.serverTotal, 2);
  assert.deepEqual(m.deps.Treino._salvo.devolver, [], 'o que não saiu foi devolvido DE NOVO, e entraria duas vezes no `sair()`');
  assert.ok(m.toasts.some((x) => String(x).startsWith('toast.batchError')), 'o lote que não saiu inteiro não avisou');
});

test('R18-1-01 (estrutura): o `entrar` do treino pergunta à conferência única, e ela olha os alvos do lote', () => {
  assert.match(metodo('motivoDeRecusa'), /if \(loteDeLidosEmVoo \|\| alvosDoLoteDeLidosNoAr\.size > 0\) return 'toast\.esperaLote';/);
});

// ═══ R18-1-02 · a conta nova × os alvos do "Marcar todos" da anterior ═══════════
function trocaDeConta() {
  const deps = {
    epocaDaSessao: 1, pedidosEmAndamento: new Set(['v1|u1', 'v2|u2', 'v7|u7']),
    alvosDoLoteDeLidosNoAr: new Map([['v1|u1', 0], ['v2|u2', 0], ['v3|u3', 1]]),
  };
  deps.pedidosEmAndamento.add('v3|u3');
  const h = montar(['soltarOLoteDeLidosDaContaAnterior'], deps);
  return { h, deps };
}

test('R18-1-02: a troca de conta tira do "em andamento" os alvos do lote da conta ANTERIOR — a busca de quem entrou os traz; o resto fica', () => {
  const { h, deps } = trocaDeConta();
  h.soltarOLoteDeLidosDaContaAnterior();
  assert.deepEqual([...deps.alvosDoLoteDeLidosNoAr.keys()], ['v3|u3'], 'os alvos do lote da outra época seguiram no mapa');
  assert.equal(deps.pedidosEmAndamento.has('v1|u1') || deps.pedidosEmAndamento.has('v2|u2'), false,
    'DEFEITO: os pedidos do lote da conta anterior seguiram "em andamento" — `semOsJaDecididos` os deixava fora da fila de quem entrou');
  // CONTROLES: o lote desta MESMA época (o da sessão que ainda não sabia a conta) é dela; e o "em andamento" de outra origem fica.
  assert.equal(deps.pedidosEmAndamento.has('v3|u3'), true, 'CONTROLE: o lote da sessão de agora perdeu a marca');
  assert.equal(deps.pedidosEmAndamento.has('v7|u7'), true, 'CONTROLE: um pedido em andamento por outro motivo perdeu a marca');
});

test('R18-1-02: o lote velho que acaba NÃO solta a marca do que a conta nova já decidiu', async () => {
  const m = loteComTreinoAberto({ n: 2 });
  m.h.openBatchReadConfirm();
  const fim = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o pedaço saiu');
  m.deps.epocaDaSessao++;                      // a queda com renovação, com OUTRA conta
  m.deps.loteDeLidosEmVoo = false;
  m.h.soltarOsLotesDaSessaoQueAcabou();
  const solta = montar(['soltarOLoteDeLidosDaContaAnterior'], m.deps);
  solta.soltarOLoteDeLidosDaContaAnterior();
  assert.equal(m.deps.pedidosEmAndamento.size, 0, 'PRÉ-CONDIÇÃO: a troca de conta soltou os alvos do lote');
  m.deps.pedidosEmAndamento.add(chaveDe(m.places[0]));   // a conta nova decide o mesmo pedido (o ✕ dela)
  m.portoes.shift()({ success: true });
  await fim;
  assert.equal(m.deps.pedidosEmAndamento.has(chaveDe(m.places[0])), true,
    'DEFEITO: o `finally` do lote velho soltou o "em andamento" da decisão da conta nova');
  assert.equal(m.deps.alvosDoLoteDeLidosNoAr.size, 0);
});

test('R18-1-02 (estrutura): a troca de conta solta o lote ANTES de refazer a fila de quem entrou', () => {
  const corpo = fatiar('esquecerOutraConta');
  const solta = corpo.search(/^\s+soltarOLoteDeLidosDaContaAnterior\(\);$/m);
  const refaz = corpo.search(/^\s+resetQueue\(\);$/m);
  assert.ok(solta > 0 && refaz > 0, 'faltou a chamada ou o `resetQueue` na troca de conta');
  assert.ok(solta < refaz, 'a fila de quem entrou é refeita ANTES de os alvos do lote saírem do "em andamento"');
});

// ═══ R18-2-03 · a conta em dúvida redesenha o canto "Enviando N…" ═══════════════
test('R18-2-03: a conta que ENTRA em dúvida (a época troca) redesenha o canto — depois de a época e a trava do lote mudarem', () => {
  const visto = [];
  const deps = {
    AppState: { contaEmDuvida: false, pendingAction: null }, epocaDaSessao: 0, loteDeLidosEmVoo: true, conferindoContaDestaAba: true,
    soltarOsLotesDaSessaoQueAcabou() {}, cancelarPendenciasDoLightbox() {}, aprovacoesAtravessamAQueda() {}, aplicarTravaDeAcao() {},
  };
  deps.updateInFlightIndicator = () => visto.push([deps.epocaDaSessao, deps.loteDeLidosEmVoo]);
  const h = montar(['conferirContaDestaAba'], deps);
  h.conferirContaDestaAba();
  assert.deepEqual(visto, [[1, false]],
    'DEFEITO: a dúvida trocou a época e não redesenhou o canto — o "Enviando N…" do lote de antes ficava até o próximo redesenho');
  // CONTROLE: a segunda chamada (já em dúvida) não troca a época nem redesenha.
  h.conferirContaDestaAba();
  assert.equal(visto.length, 1, 'CONTROLE: a conta que já estava em dúvida redesenhou de novo');
});

// ═══ R18-3-01 · a queda × a escrita de foto contada no diálogo do "Sair" ═══════
test('R18-3-01: a queda com renovação tira do diálogo do "Sair" a escrita de foto que esperava a retentativa — e a escrita da sessão NOVA conta de novo', async () => {
  const tela = dialogoDoSair();
  const place = P(1, { name: 'Antigo' });
  const recuos = [];
  const ida = [];
  const deps = {
    document: tela.document, epocaDaSessao: 0, navigator: { onLine: true }, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1500, 3500],
    setTimeout: (fn) => { recuos.push(fn); return recuos.length; }, escritasEsperandoAVez: new Set(), pedidosDoLoteSemEnviar: new Set(), pedidosEmAndamento: new Set(),
    renomeacoesNoAr: new Set(), aplicarTravaDeAcao() {}, carregarFilaDeSaida: () => [], reivindicadoPorOutraAba: () => false,
    API: { renomearLocal: () => new Promise((ok) => ida.push(ok)) }, t: (k, v) => k + ':' + (v && v.n),
    msgDoServidor: () => null, aplicarNosIrmaos() {}, contarConquista() {}, showToast() {}, devolverNome: () => false,
  };
  const h = montar(['enviarRenomeacao', 'nomeDestaEscrita', 'callWithRetry', 'sessaoTrocou', 'esperaDaEscritaNoSair', 'redesenharAvisoDoSairSeAberto',
    'desenharAvisoDoSair', 'soltarOsLotesDaSessaoQueAcabou', 'chaveDoPedido'], deps);
  const andando = h.enviarRenomeacao({ place, novo: 'Antigo', antigo: 'X', regiao: 'row' });
  await ateQue(() => ida.length === 1, 'a 1ª ida não saiu');
  ida.shift()({ success: false, errorCategory: 'transient', httpCode: 503 });
  await ateQue(() => recuos.length === 1, 'a escrita não entrou no recuo');
  h.desenharAvisoDoSair();
  assert.equal(tela.texto(), 'modal.logout.foto:1', 'CONTROLE: a escrita esperando a retentativa tem que contar (o instrumento enxerga a frase)');
  // A queda com renovação: a época troca e os lotes da sessão que acabou saem da conta.
  deps.epocaDaSessao++;
  h.soltarOsLotesDaSessaoQueAcabou();
  h.desenharAvisoDoSair();
  assert.equal(tela.texto(), '',
    'DEFEITO: o diálogo do "Sair" da sessão renovada ainda conta a escrita de foto condenada: «' + tela.texto() + '»');
  // A espera acaba: nada sai, e a marca não volta.
  recuos.shift()();
  await andando;
  assert.equal(ida.length, 0, 'a retentativa saiu com a sessão trocada');
  assert.equal(deps.escritasEsperandoAVez.size, 0);
  // A escrita da sessão NOVA conta como sempre.
  h.esperaDaEscritaNoSair()(true);
  h.desenharAvisoDoSair();
  assert.equal(tela.texto(), 'modal.logout.foto:1', 'a escrita da sessão nova não conta no diálogo');
});

// ═══ R18-3-02 · aprovar depois do "Marcar todos" × o "Restam" ═══════════════════
function aprovacao({ naFila }) {
  const place = P(1);
  const AppState = { serverTotal: 5, fetchEpoch: 0, currentPlace: null, queue: naFila ? [place, P(9)] : [P(9)] };
  const deps = {
    AppState, registrarPouso() {}, updateStats() {}, Lightbox: { isOpen: () => false, place: null }, advanceQueue() {},
    updatePendingCount() {}, aoMudarAFilaPorBaixo() {}, mantendoFocoNoCard: (f) => f(),
  };
  const chaves = Object.keys(deps);
  const concluir = new Function(...chaves, 'let placeResolvidoPorAprovacao = null; let tratouNestaFila = false;\n'
    + fatiar('concluirAprovacao') + '\n' + fatiar('tirarAprovadoDaFila') + '\nreturn concluirAprovacao;')(...chaves.map((k) => deps[k]));
  return { concluir: () => concluir({ id: 'u1', place, idx: 0, epocaFila: 0 }), AppState };
}

test('R18-3-02: aprovar a foto de um pedido que o lote já tirou da fila NÃO desce o "Restam" de novo — com o pedido na fila desce, como sempre', () => {
  const fora = aprovacao({ naFila: false });
  fora.concluir();
  assert.equal(fora.AppState.serverTotal, 5,
    'DEFEITO: o "Restam" desceu por um pedido que já tinha saído da fila (o lote já descontou)');
  const dentro = aprovacao({ naFila: true });
  dentro.concluir();
  assert.equal(dentro.AppState.serverTotal, 4, 'CONTROLE: com o pedido na fila a aprovação tem que descontar');
});

// ═══ R18-1-03 · as categorias salvas que o servidor recusaria ═══════════════════
test('R18-1-03: categorias salvas — texto vazio e texto com mais de 80 caracteres voltam à lista vazia (o servidor os recusa com 400)', () => {
  const f = new Function(fatiar('categoriasSalvasValidas') + '\nreturn categoriasSalvasValidas;')();
  assert.deepEqual(f(['']), [], 'DEFEITO: categoria vazia passou — a abertura dava "Falha ao carregar"');
  assert.deepEqual(f(['x'.repeat(81)]), [], 'DEFEITO: categoria de 81 caracteres passou');
  assert.deepEqual(f(['x'.repeat(300)]), [], 'DEFEITO: categoria de 300 caracteres passou');
  assert.deepEqual(f(['PARKING_LOT', '']), [], 'uma categoria ruim no meio da lista boa passou');
  // CONTROLES: o que o servidor aceita segue.
  assert.deepEqual(f(['PARKING_LOT', 'x'.repeat(80)]), ['PARKING_LOT', 'x'.repeat(80)], 'CONTROLE: o que o servidor aceita foi recusado');
  assert.deepEqual(f([]), []);
  assert.equal(f(Array.from({ length: 200 }, () => 'A')).length, 200, 'CONTROLE: 200 itens cabem');
  assert.deepEqual(f(Array.from({ length: 201 }, () => 'A')), [], '201 itens passaram');
  assert.deepEqual(f([3]), []);
});

test('R18-1-03: os tetos do app são os do servidor (`CATEGORIAS_MAX`, `CATEGORIA_TAM_MAX`)', () => {
  const core = ler('server/core.mjs');
  const max = Number(/^const CATEGORIAS_MAX = (\d+);/m.exec(core)[1]);
  const tam = Number(/^const CATEGORIA_TAM_MAX = (\d+);/m.exec(core)[1]);
  const corpo = fatiar('categoriasSalvasValidas');
  assert.match(corpo, new RegExp(`const teto = ${max};`), 'o teto de itens do app divergiu do servidor');
  assert.match(corpo, new RegExp(`const tamMax = ${tam};`), 'o teto de caracteres do app divergiu do servidor');
});

// ═══ R18-1-04 · o link de pareamento colado na aba que já está no app ═══════════
function colarNaBarra(hash) {
  const log = [];
  const deps = { window: { location: { hash, reload: () => log.push('reload') } } };
  const h = montar(['aoMudarOFragmentoDaURL'], deps);
  h.aoMudarOFragmentoDaURL();
  return log;
}

test('R18-1-04: o fragmento `#pair=` que muda com o app aberto recarrega a página (a carga resgata e tira o segredo da barra); outro fragmento não faz nada', () => {
  assert.deepEqual(colarNaBarra('#pair=ABCDEFGHJKLMNPQRSTUV'), ['reload'],
    'DEFEITO: o link de pareamento colado na aba aberta não fez nada — e o segredo ficou na barra');
  // CONTROLES.
  assert.deepEqual(colarNaBarra('#outra-coisa'), [], 'outro fragmento recarregou');
  assert.deepEqual(colarNaBarra(''), [], 'o fragmento vazio recarregou');
  assert.deepEqual(colarNaBarra('#pair='), [], 'um `pair` vazio recarregou');
});

test('R18-1-04 (estrutura): o ouvinte nasce no `initApp` ANTES do ramo do link da carga, e a função não fala com o servidor', () => {
  const corpo = fatiar('initApp');
  const ouve = corpo.search(/^\s+window\.addEventListener\('hashchange', aoMudarOFragmentoDaURL\);$/m);
  const ramo = corpo.search(/^\s+if \(codigoNaURL\) \{$/m);
  assert.ok(ouve > 0 && ramo > 0 && ouve < ramo, 'o ouvinte de `hashchange` sumiu, ou nasce depois do `return` do link da carga');
  assert.doesNotMatch(fatiar('aoMudarOFragmentoDaURL'), /API\.|fetch\(|sendBeacon/, 'a função do fragmento fala com a rede: o segredo nunca vai ao servidor');
});
