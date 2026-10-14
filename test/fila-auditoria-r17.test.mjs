// A FILA, os avisos, as contas e a foto ampliada na rodada 17 da auditoria (o lote 21):
//
//  · R17-1-05 = R17-2-02 — a decisão ✕/✓ cuja 1ª ida volta `transient` DEPOIS da queda
//    deixava o pedido preso em `pedidosDoLoteSemEnviar` (o diálogo do "Sair" da sessão
//    renovada dizia "1 pedido esperando envio" sem nada esperando);
//  · R17-2-05 — o card alvo de um "Marcar todos" ainda no ar voltava a ser decidível
//    depois da queda com renovação (ou da conta em dúvida resolvida como a mesma).
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não fornece
// vira um "buraco negro" (o molde do test/fila-auditoria-r16.test.mjs). Cada teste foi
// visto REPROVANDO com o conserto desfeito (as sabotagens estão no relatório do lote) e
// carrega um CONTROLE que reprova se o instrumento não enxergar o defeito (gotcha #28).
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

// ═══ R17-1-05 = R17-2-02 · a ida que volta `transient` DEPOIS da queda ═════════
// O ✕ sai; a sessão cai e é renovada (`soltarOsLotesDaSessaoQueAcabou` esvazia o
// conjunto do "Sair"); a ida em voo volta `transient`. O laço do `callWithRetry`
// chamava `aoEsperar(true)` com a época JÁ trocada e recolocava a chave, e a espera
// saía sem o `aoEsperar(false)`: a chave ficava até o próximo "Sair".
function decisaoComQueda() {
  const tela = dialogoDoSair();
  const place = P(1);
  const respostas = [];
  const recuos = [];
  const AppState = { authenticated: true, currentPlace: place, queue: [], stats: { read: 0, rejected: 0, skipped: 0 },
    serverTotal: 1, fetchEpoch: 0, pendingAction: null, inFlightActions: 0 };
  const ida = () => new Promise((ok) => respostas.push(ok));
  const deps = {
    AppState, document: tela.document, epocaDaSessao: 0, Treino: { ativo: false }, navigator: { onLine: true },
    TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1500, 3500],
    setTimeout: (fn) => { recuos.push(fn); return recuos.length; },
    pedidosEmAndamento: new Set([chaveDe(place)]), pedidosDoLoteSemEnviar: new Set(), escritasEsperandoAVez: new Set(),
    API: { getRegion: () => 'row', rejectPlace: ida },
    carregarFilaDeSaida: () => [], reivindicadoPorOutraAba: () => false,
    t: (k, v) => k + ':' + (v && v.n),
    acoesTravadas: () => false, direcaoTravada: () => false, gestoNoDecididoPorOutraAba: () => false,
    anotarAntesDoEnvio: () => 'anotada', presencaWmeDaAcao: () => null, presencaWmeAoResponder() {}, handleActionResult() {},
    decisaoDepoisDaQueda() {}, paisDaFila: () => '30', quemDecideAgora: () => null, carimboDoGesto: () => ({ dia: '2026-10-14', onde: '30', t: 1, lang: 'pt' }),
    scheduleAction: (t, p, executor) => { deps.executor = executor(); },
  };
  const h = montar(['handleReject', 'callWithRetry', 'sessaoTrocou', 'marcarEmAndamento', 'marcarLoteSemEnviar',
    'redesenharAvisoDoSairSeAberto', 'desenharAvisoDoSair', 'soltarOsLotesDaSessaoQueAcabou', 'chaveDoPedido'], deps);
  // O que os três sítios de queda fazem: troca a época e solta os lotes da sessão que acabou.
  const cair = () => { deps.epocaDaSessao++; h.soltarOsLotesDaSessaoQueAcabou(); };
  return { h, deps, tela, place, respostas, recuos, cair };
}

test('R17-1-05: o ✕ cuja ida volta `transient` DEPOIS da queda não deixa o pedido no conjunto do "Sair" — o diálogo da sessão renovada não conta o que não espera nada', async () => {
  const m = decisaoComQueda();
  m.h.handleReject();
  await tiques();
  assert.equal(m.respostas.length, 1, 'PRÉ-CONDIÇÃO: a 1ª ida está no ar');
  m.cair();                                            // a queda com renovação, com a ida ainda no ar
  m.respostas.shift()({ success: false, errorCategory: 'transient', httpCode: 503 });
  await m.deps.executor;                               // o executor termina (a resposta é `session_changed`)
  assert.equal(m.recuos.length, 0, 'a decisão esperou um recuo de uma sessão que já acabou (não há o que retentar)');
  assert.deepEqual([...m.deps.pedidosDoLoteSemEnviar], [],
    'DEFEITO: a chave do pedido ficou no conjunto do "Sair" depois da queda (R17-1-05)');
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), '',
    'DEFEITO: o diálogo do "Sair" da sessão renovada conta um pedido esperando envio sem nada esperando: «' + m.tela.texto() + '»');
});

test('R17-1-05: CONTROLES — sem queda o recuo conta no diálogo (o instrumento enxerga a frase); a queda DURANTE o recuo também não deixa nada', async () => {
  const m = decisaoComQueda();
  m.h.handleReject();
  await tiques();
  m.respostas.shift()({ success: false, errorCategory: 'transient', httpCode: 503 });
  await ateQue(() => m.recuos.length === 1, 'PRÉ-CONDIÇÃO: a decisão não entrou no recuo');
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saida:1', 'CONTROLE: o recuo de uma sessão viva tem que contar no diálogo');
  m.cair();                                            // a época muda DURANTE o recuo (o caso que já funcionava)
  m.recuos.shift()();
  await m.deps.executor;
  assert.deepEqual([...m.deps.pedidosDoLoteSemEnviar], [], 'a queda durante o recuo deixou a chave');
  assert.equal(m.respostas.length, 0, 'a retentativa saiu com a sessão trocada');
});

test('R17-1-05 (estrutura): o laço do `callWithRetry` confere a sessão ANTES de avisar a espera', () => {
  const corpo = fatiar('callWithRetry');
  const i = corpo.indexOf('aoEsperar(true)');
  assert.ok(i > 0, 'o `aoEsperar(true)` sumiu do laço');
  assert.match(corpo.slice(0, i), /if \(outraSessao\(\)\) return sessaoTrocou\(\);\s*if \(typeof aoEsperar === 'function'\) $/,
    'a época tem que ser conferida colada no aviso da espera (R17-1-05)');
});

// ═══ R17-2-05 · o card alvo de um "Marcar todos" ainda no ar ═══════════════════
// Os pedidos do lote seguem NA FILA até a resposta. A queda com renovação e a conta
// em dúvida resolvida como a mesma desligam o `loteDeLidosEmVoo` (o lote morto não
// trava a sessão que vem), mas o pedaço continua no ar no Waze: o ✕ no card da
// frente (um dos alvos) mandava uma decisão DIFERENTE da do lote, e o ✓ um "lido"
// repetido. O lote não usa a fila de saída, então nada o impedia.
function loteNoAr({ n = 4 } = {}) {
  const places = Array.from({ length: n }, (_, i) => P(i + 1, { creatorId: 2000 + i }));
  const portoesLote = [];
  const decididos = [];                                 // o que o "Waze" recebeu fora do lote
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
    API: { markAsReadBatch: () => new Promise((ok) => portoesLote.push(ok)), getRegion: () => 'row',
      rejectPlace: (v, u) => { decididos.push('rejeitar ' + v + '|' + u); return Promise.resolve({ success: true }); },
      markAsRead: (v, u) => { decididos.push('lido ' + v + '|' + u); return Promise.resolve({ success: true }); } },
    callWithRetry: (fn) => fn(), carimboDoGesto: () => ({ dia: '2026-10-14', onde: '30', t: 1, lang: 'pt' }),
    decididosPorOutraAbaComCardAqui: new WeakSet(), removeUndoBanner() {}, aplicarTravaDeAcao() {},
    showToast: (m) => { toasts.push(m); return { remover() {} }; }, t: (k, v) => k + ':' + (v && v.n),
    direcaoTravada: () => false, gestoNoDecididoPorOutraAba: () => false, scheduleAction: (tipo) => { decididos.push('agendou ' + tipo); },
    updateInFlightIndicator() {}, aoMudarAFilaPorBaixo() {}, updatePendingCount() {}, updateStats() {}, saveStats() {}, advanceQueue() {},
    pousouNoWaze: (r) => !!(r && r.success), registrarPouso() {}, recordHistory() {}, registrarLoteConfirmado() {},
    carregarFilaDeSaida: () => [], reivindicadoPorOutraAba: () => false, aprovacaoDelaJaPousou: () => false,
    registrarPousoDepoisDaQueda() {}, showCurrentPlace() {}, startFetching() {}, showNoPlaces() {},
  };
  const h = montar(['acoesTravadas', 'aprovacaoDaTelaNoAr', 'loteDeLidosDaTelaNoAr', 'avisoDaTrava', 'handleReject', 'handleMarkAsRead',
    'handleSkip', 'openBatchReadConfirm', 'handleBatchMarkRead', 'marcarEmAndamento', 'marcarLoteSemEnviar', 'redesenharAvisoDoSairSeAberto',
    'soltarOsLotesDaSessaoQueAcabou', 'chaveDoPedido', 'acoesTravadasForaDaJanela'], deps);
  // A queda com renovação / a conta em dúvida resolvida como a MESMA: a época muda, o lote deixa de travar a sessão.
  const cair = () => { deps.epocaDaSessao++; deps.loteDeLidosEmVoo = false; h.soltarOsLotesDaSessaoQueAcabou(); };
  return { h, deps, places, portoesLote, decididos, AppState, toasts, cair };
}

test('R17-2-05: depois da queda com renovação o card alvo do "Marcar todos" ainda no ar NÃO decide — ✕, ✓ e ↑ são barrados, e o aviso é o da espera do lote', async () => {
  const m = loteNoAr();
  m.h.openBatchReadConfirm();
  const lote = m.h.handleBatchMarkRead();
  await tiques();
  assert.equal(m.portoesLote.length, 1, 'PRÉ-CONDIÇÃO: o pedaço está no ar');
  assert.equal(m.h.acoesTravadas(), true, 'PRÉ-CONDIÇÃO: com o lote no ar o card está travado (o `loteDeLidosEmVoo`)');
  m.cair();
  assert.equal(m.deps.loteDeLidosEmVoo, false, 'PRÉ-CONDIÇÃO: a queda soltou a trava do lote (por desenho)');
  assert.equal(m.h.acoesTravadas(), true,
    'DEFEITO: o card alvo do lote que segue no ar voltou a ser decidível depois da queda (R17-2-05)');
  assert.equal(m.h.avisoDaTrava(), 'toast.esperaLote', 'o toque no card travado tem que dizer que espera o lote');
  m.h.handleReject(); m.h.handleMarkAsRead(); m.h.handleSkip();
  assert.deepEqual(m.decididos, [], 'DEFEITO: uma segunda decisão sobre o pedido do lote saiu: ' + JSON.stringify(m.decididos));
  assert.deepEqual(m.AppState.stats, { read: 0, rejected: 0, skipped: 0 }, 'o placar andou com a decisão barrada');
  // O lote responde: a trava do card sai, e os alvos saem do mapa.
  m.portoesLote.shift()({ success: true });
  await lote;
  assert.equal(m.deps.alvosDoLoteDeLidosNoAr.size, 0, 'os alvos ficaram no mapa depois do fim do lote');
  assert.equal(m.h.acoesTravadas(), false, 'o card ficou travado depois do fim do lote');
});

test('R17-2-05: CONTROLES — sem lote o card decide; um card que NÃO é alvo não trava; o lote de uma sessão que acabou não trava o card de OUTRO pedido', async () => {
  const sem = loteNoAr();
  assert.equal(sem.h.acoesTravadas(), false, 'CONTROLE: sem lote, o card decide');
  sem.h.handleReject();
  assert.deepEqual(sem.decididos, ['agendou reject'], 'CONTROLE: o ✕ sem lote tem que ir (o instrumento enxerga a decisão)');
  const m = loteNoAr();
  m.h.openBatchReadConfirm();
  m.h.handleBatchMarkRead();
  await tiques();
  m.cair();
  // Um pedido que chegou depois (não é alvo): o card dele decide, na sessão nova.
  m.AppState.currentPlace = P(9);
  assert.equal(m.h.acoesTravadas(), false, 'o lote velho travou o card de um pedido que não é dele');
  // A treino não conta: o card de exemplo nunca é alvo.
  m.AppState.currentPlace = { ...m.places[0], _treino: true };
  assert.equal(m.h.acoesTravadas(), false, 'o card de treino herdou a trava do lote');
});

test('R17-2-05: o lote que acaba tira SÓ os alvos dele — um lote da sessão nova que pegou o mesmo pedido mantém a trava', () => {
  const corpo = fatiar('handleBatchMarkRead');
  assert.match(corpo, /for \(const p of alvos\) alvosDoLoteDeLidosNoAr\.set\(chaveDoPedido\(p\), epoca\);/,
    'o lote não registra os alvos dele com a época');
  assert.match(corpo, /if \(alvosDoLoteDeLidosNoAr\.get\(k\) === epoca\) alvosDoLoteDeLidosNoAr\.delete\(k\);/,
    'o `finally` tira os alvos sem conferir a época do lote');
  assert.match(fatiar('handleLogout'), /pedidosEmAndamento\.clear\(\);\s*alvosDoLoteDeLidosNoAr\.clear\(\);/,
    'o "Sair" não esvazia os alvos do lote (dado de terceiro e trava de quem sai)');
});

test('R17-2-05 (estrutura): a trava do card olha o lote da tela dentro do `acoesTravadas` (botão, gesto e tecla passam por ele) e o aviso diz o porquê', () => {
  assert.match(fatiar('acoesTravadas'), /\|\| loteDeLidosDaTelaNoAr\(\)/);
  assert.match(fatiar('avisoDaTrava'), /if \(loteDeLidosEmVoo \|\| loteDeLidosDaTelaNoAr\(\)\) return 'toast\.esperaLote';/);
});

// ═══ R17-1-02 + R17-2-04 · o canto "Enviando N…" × o lote de lidos e a fila de saída ═══
// (a) o "Marcar todos" no ar na queda com renovação deixava o "Enviando 1…" no canto até a
//     ida responder (o indicador só conhecia lote de OUTRA sessão nos de rejeição);
// (b) o filtro do lote velho escondia do canto também a decisão que já voltou da ida com a
//     rede fora e ESPERA envio (a sessão renovada a manda).
function indicador({ noAr = 1, lotes = [], epoca = 1, fila = [], loteNoAr = false, lidosNoAr = 0 } = {}) {
  const els = new Map();
  const document = {
    getElementById: (id) => (id === 'logoutModal' ? { classList: { contains: () => true } } : els.get(id) || null),
    createElement: () => ({ className: '', title: '', innerHTML: '', style: {}, remove() { els.delete(this.id); } }),
    body: { appendChild: (el) => { els.set(el.id, el); } },
  };
  const deps = { document, AppState: { authenticated: true, inFlightActions: noAr }, carregarFilaDeSaida: () => fila,
    t: (k, v) => `${k}:${v.n}`, escapeHtml: (x) => String(x), desenharAvisoDoSair: () => {}, atualizarFabDev: () => {},
    pedidosEmAndamento: new Set(), chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID, reivindicadoPorOutraAba: () => false,
    SAIDA_REIVINDICACAO_MS: 60000, setTimeout: () => 0, clearTimeout: () => {},
    loteDeLidosEmVoo: loteNoAr, lidosDoLoteNoAr: lidosNoAr, epocaDaSessao: epoca, rejeicoesDeLoteNoAr: new Set(lotes) };
  const chaves = Object.keys(deps);
  const atualizar = new Function(...chaves, 'let indicadorMarcaVence = null;\n' + fatiar('saindoPelaOutraAba') + '\n'
    + fatiar('updateInFlightIndicator') + '\nreturn updateInFlightIndicator;')(...chaves.map((k) => deps[k]));
  const texto = () => {
    const el = els.get('inFlightIndicator');
    return el ? (/<span class="sr-only">([^<]*)</.exec(el.innerHTML) || [])[1] : null;
  };
  atualizar();
  return { texto };
}
const item = (i, rv) => ({ tipo: 'reject', venueID: 'v' + i, updateRequestID: 'u' + i, ...(rv ? { rv: 'aba-1', rvEm: 1 } : {}) });

test('R17-1-02: o "Marcar todos" de uma sessão que acabou não diz "Enviando 1…" — o lote de lidos entra no indicador como os de rejeição', () => {
  const pedidos = [P(1), P(2), P(3)];
  const lote = { epoca: 0, restam: 3, acoes: 1, pedidos, lidos: true };
  // A sessão agora é a 1; o lote é da 0. Só a unidade dele ocupa o `inFlightActions`.
  assert.equal(indicador({ noAr: 1, lotes: [lote], epoca: 1 }).texto(), null,
    'DEFEITO: o canto diz que algo está saindo por um lote de lidos de uma sessão que acabou (R17-1-02)');
  // CONTROLE: sem o registro do lote o canto diz "Enviando 1…" (o instrumento enxerga o defeito).
  assert.equal(indicador({ noAr: 1, lotes: [], epoca: 1 }).texto(), 'indicator.sending:1', 'CONTROLE: sem o registro do lote o canto devia mostrar a unidade');
  // CONTROLE: o lote da sessão de AGORA segue com a conta própria (pedidos no ar), sem contar em dobro.
  assert.equal(indicador({ noAr: 1, lotes: [{ ...lote, epoca: 1 }], epoca: 1, loteNoAr: true, lidosNoAr: 3 }).texto(), 'indicator.sending:3',
    'o lote de lidos da sessão de agora contou em dobro (ou deixou de contar)');
});

test('R17-1-02: o lote de lidos de verdade se registra no indicador ao começar e sai dele ao acabar — em qualquer desfecho', async () => {
  const m = loteNoAr();
  m.h.openBatchReadConfirm();
  const lote = m.h.handleBatchMarkRead();
  await tiques();
  const regs = [...m.deps.rejeicoesDeLoteNoAr];
  assert.equal(regs.length, 1, 'PRÉ-CONDIÇÃO: o lote no ar tem que estar no registro do indicador');
  assert.deepEqual([regs[0].epoca, regs[0].acoes, regs[0].lidos, regs[0].pedidos.length], [0, 1, true, 4]);
  m.portoesLote.shift()({ success: false, errorCategory: 'unknown' });   // falha de verdade: o `finally` roda do mesmo jeito
  await lote;
  assert.equal(m.deps.rejeicoesDeLoteNoAr.size, 0, 'o lote acabou e o registro ficou no indicador (o canto contaria uma unidade para sempre)');
});

test('R17-2-04: a decisão que já voltou da ida com a rede fora e ESPERA envio segue no canto depois da queda — só as que ainda levam a marca de envio do lote velho saem', () => {
  const pedidos = [P(1), P(2), P(3), P(4)];
  const lote = { epoca: 0, restam: 3, acoes: 1, pedidos };
  // a (fila, sem marca): esperando de verdade; b (no ar) e c, d (não saíram): marcadas, voltam à fila.
  const fila = [item(1, false), item(2, true), item(3, true), item(4, true)];
  assert.equal(indicador({ noAr: 1, lotes: [lote], epoca: 1, fila }).texto(), 'indicator.waiting:1',
    'DEFEITO: o canto sumiu com a decisão que espera envio (o diálogo do "Sair" conta 1) — R17-2-04');
  // CONTROLE: todas marcadas (nenhuma voltou da ida) — nada espera, o canto some (a regra do R16-1-03 segue).
  assert.equal(indicador({ noAr: 1, lotes: [lote], epoca: 1, fila: fila.map((x) => ({ ...x, rv: 'aba-1', rvEm: 1 })) }).texto(), null,
    'as anotações do lote velho com marca viraram "esperando envio" (R16-1-03 desfeito)');
  // CONTROLE: decisão sem marca que NÃO é do lote velho segue contando.
  assert.equal(indicador({ noAr: 0, lotes: [], epoca: 1, fila: [item(9, false)] }).texto(), 'indicator.waiting:1');
});
