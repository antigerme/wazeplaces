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

// ═══ loadFilters · o filtro salvo que o servidor recusaria ═══════════════════
// O `buscar-places` passou a responder 400 a `stateId`/`managedAreaId` que não sejam inteiros
// positivos e a `categories` que não seja lista de textos (até 200). Um `localStorage` mexido à
// mão derrubava a abertura em "Falha ao carregar" a cada reabertura: o cliente descarta o que o
// filtro legítimo nunca grava, e mantém tudo que ele grava (vazio, número, dígitos, lista vazia).
function carregarFiltros(salvo) {
  const filtros = { types: [], residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true, categories: [], sortOrder: 'newest' };
  const deps = { AppState: { filters: filtros }, FILTERS_KEY: 'f', ORDEM_PADRAO: 'newest', sanearTiposSalvos: (x) => (Array.isArray(x) ? x : []),
    localStorage: { getItem: () => (salvo === undefined ? null : typeof salvo === 'string' ? salvo : JSON.stringify(salvo)) } };
  const chaves = Object.keys(deps);
  new Function(...chaves, fatiar('idSalvoValido') + '\n' + fatiar('categoriasSalvasValidas') + '\n' + fatiar('loadFilters') + '\nloadFilters();')(...chaves.map((k) => deps[k]));
  return filtros;
}

test('loadFilters: stateId e managedAreaId só voltam se forem inteiros positivos — o resto volta ao valor de fábrica', () => {
  const ruins = ['null', 'Minas', 'abc', '0', '-3', '1e3', '12.5', ' 7', '7 ', '', {}, [], [7], true, 0, -3, 1.5, NaN, null, '99999999999999999999'];
  for (const v of ruins) {
    const f = carregarFiltros({ stateId: v, managedAreaId: v });
    assert.deepEqual([f.stateId, f.managedAreaId], ['', ''], `DEFEITO: ${JSON.stringify(v)} voltou como filtro e o servidor o recusa (400)`);
  }
  // CONTROLES: o que o filtro legítimo grava volta como estava (o instrumento não descarta tudo).
  for (const v of ['27', '1', 27, 3095]) {
    const f = carregarFiltros({ stateId: v, managedAreaId: v });
    assert.deepEqual([f.stateId, f.managedAreaId], [v, v], `CONTROLE: o legítimo ${JSON.stringify(v)} foi descartado`);
  }
  const vazio = carregarFiltros({ stateId: '', managedAreaId: null });
  assert.deepEqual([vazio.stateId, vazio.managedAreaId], ['', '']);
});

test('loadFilters: categories só volta se for lista de textos até o teto do servidor (200) — a lista vazia e a boa seguem', () => {
  const ruins = ['BAKERY', { 0: 'BAKERY' }, [1, 2], ['A', null], ['A', { x: 1 }], [['A']], Array.from({ length: 201 }, (_, i) => 'C' + i), null, 5];
  for (const v of ruins) {
    assert.deepEqual(carregarFiltros({ categories: v }).categories, [], `DEFEITO: ${JSON.stringify(v).slice(0, 40)} voltou como filtro de categoria`);
  }
  assert.deepEqual(carregarFiltros({ categories: [] }).categories, [], 'CONTROLE: a lista vazia');
  assert.deepEqual(carregarFiltros({ categories: ['BAKERY', 'PARK'] }).categories, ['BAKERY', 'PARK'], 'CONTROLE: a lista boa foi descartada');
  const duzentas = Array.from({ length: 200 }, (_, i) => 'C' + i);
  assert.equal(carregarFiltros({ categories: duzentas }).categories.length, 200, 'CONTROLE: o teto é inclusivo (200 passa)');
});

test('loadFilters: o resto do filtro salvo segue como estava (tipos, país/estado em branco, "Minha área", só não lidos, ordem)', () => {
  const f = carregarFiltros({ types: ['NEW_PLACE'], residential: 'x', myArea: true, unreadOnly: false, sortOrder: 'oldest', stateId: '5', managedAreaId: '9', categories: ['A'] });
  assert.deepEqual([f.types, f.residential, f.myArea, f.unreadOnly, f.sortOrder, f.stateId, f.managedAreaId, f.categories],
    [['NEW_PLACE'], 'x', true, false, 'oldest', '5', '9', ['A']]);
});

// ═══ R17-2-01 + R17-3-01 · a espera que o "Sair" descarta sem aviso ═══════════
// (a) o pedaço do "Marcar todos" que levou 401 e espera a sonda da sessão (e a retentativa de
//     depois dela) não estava na conta do diálogo do "Sair";
// (b) a exclusão, a aprovação e a correção do nome de FOTO (e a estrela do ↑) esperando a
//     retentativa de 1,5 s e 3,5 s também não — e confirmar o "Sair" as descartava calado.
test('R17-2-01: `refazerDepoisDo401` avisa a espera — a sonda conta enquanto dura, sai da conta quando a ida volta ao ar, e a retentativa avisa a dela', async () => {
  const eventos = [];
  let sonda = null;
  const relogio = [];
  const deps = {
    epocaDaSessao: 0, escritasConferindo: 0, verificandoSessao: false, conferenciaDaSessao: null, aplicarTravaDeAcao() {},
    handleUnauthorized: () => new Promise((ok) => { sonda = ok; }), sessaoVivaDepoisDe: () => true,
    navigator: { onLine: true }, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [5, 5],
    setTimeout: (fn) => { relogio.push(fn); return relogio.length; },
  };
  const h = montar(['refazerDepoisDo401', 'callWithRetry', 'sessaoTrocou'], deps);
  let n = 0;
  const enviar = async () => { eventos.push('ida'); return ++n === 1 ? { success: false, errorCategory: 'transient' } : { success: true }; };
  const andando = h.refazerDepoisDo401(0, enviar, (sim) => eventos.push(sim ? 'espera' : 'fim'));
  await ateQue(() => !!sonda, 'a conferência não começou');
  assert.deepEqual(eventos, ['espera'], 'DEFEITO: a sonda do 401 não conta como espera (R17-2-01): ' + JSON.stringify(eventos));
  sonda();
  await ateQue(() => relogio.length === 1, 'a retentativa não entrou no recuo');
  assert.deepEqual(eventos, ['espera', 'fim', 'ida', 'espera'], 'a ordem da espera mudou: ' + JSON.stringify(eventos));
  relogio.shift()();
  const r = await andando;
  assert.equal(r.success, true);
  // (o último `fim` é o do `finally` da conferência: inofensivo, a marca já estava fora)
  assert.deepEqual(eventos, ['espera', 'fim', 'ida', 'espera', 'fim', 'ida', 'fim'], 'a espera ficou aberta no fim: ' + JSON.stringify(eventos));
  assert.equal(deps.escritasConferindo, 0);
});

test('R17-2-01: a sonda cortada pela troca de época NÃO avisa o fim (apagaria a conta da sessão que veio) — e sem `aoEsperar` nada muda', async () => {
  const eventos = [];
  let sonda = null;
  const deps = { epocaDaSessao: 0, escritasConferindo: 0, verificandoSessao: false, conferenciaDaSessao: null, aplicarTravaDeAcao() {},
    handleUnauthorized: () => new Promise((ok) => { sonda = ok; }), sessaoVivaDepoisDe: () => true, navigator: { onLine: true } };
  const h = montar(['refazerDepoisDo401', 'callWithRetry', 'sessaoTrocou'], deps);
  const andando = h.refazerDepoisDo401(0, async () => ({ success: true }), (sim) => eventos.push(sim));
  await ateQue(() => !!sonda, 'a conferência não começou');
  deps.epocaDaSessao++;                               // o "Sair"/a queda no meio da sonda
  sonda();
  assert.equal(await andando, null);
  assert.deepEqual(eventos, [true], 'o fim da espera foi avisado depois da troca de época: ' + JSON.stringify(eventos));
  // CONTROLE: a chamada de sempre (sem `aoEsperar`) segue funcionando.
  sonda = null; deps.epocaDaSessao = 0;
  const sem = h.refazerDepoisDo401(0, async () => ({ success: true }));
  await ateQue(() => !!sonda, 'a conferência não começou (sem aoEsperar)');
  sonda();
  assert.equal((await sem).success, true);
});

test('R17-2-01: o pedaço do "Marcar todos" que levou 401 conta no diálogo do "Sair" durante a sonda — e o "Sair" no meio não recoloca nada', async () => {
  let sonda = null;
  const tela = dialogoDoSair();
  const deps2 = { document: tela.document, escritasConferindo: 0, verificandoSessao: false, conferenciaDaSessao: null,
    handleUnauthorized: () => new Promise((ok) => { sonda = ok; }), sessaoVivaDepoisDe: () => true, navigator: { onLine: true },
    TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [5, 5], setTimeout: (fn) => { setImmediate(fn); return 1; } };
  const n = { v: 0 };            // a 1ª ida do pedaço leva 401; a de depois da sonda passa
  const m2 = loteNoAr();
  Object.assign(m2.deps, deps2);
  m2.deps.document = tela.document;
  m2.deps.API.markAsReadBatch = () => Promise.resolve(n.v++ === 0 ? { success: false, errorCategory: 'unauthorized' } : { success: true });
  const h = montar(['acoesTravadas', 'aprovacaoDaTelaNoAr', 'loteDeLidosDaTelaNoAr', 'avisoDaTrava', 'openBatchReadConfirm', 'handleBatchMarkRead',
    'marcarEmAndamento', 'marcarLoteSemEnviar', 'redesenharAvisoDoSairSeAberto', 'desenharAvisoDoSair', 'chaveDoPedido', 'acoesTravadasForaDaJanela',
    'refazerDepoisDo401', 'callWithRetry', 'sessaoTrocou'], m2.deps);
  tela.modal.classList.remove('hidden');
  h.openBatchReadConfirm();
  const lote = h.handleBatchMarkRead();
  await ateQue(() => !!sonda, 'o pedaço com 401 não chegou à sonda');
  h.desenharAvisoDoSair();
  assert.equal(tela.texto(), 'modal.logout.saidaPlural:4',
    'DEFEITO: o diálogo do "Sair" não conta o pedaço que espera a sonda do 401 — confirmar o descartaria sem aviso (R17-2-01): «' + tela.texto() + '»');
  sonda();
  await lote;
  assert.equal(m2.deps.pedidosDoLoteSemEnviar.size, 0, 'o conjunto vazou depois do fim do lote');
});

test('R17-3-01: a retentativa da renomeação de FOTO conta no diálogo do "Sair" (frase da foto) — e sai da conta no fim, por qualquer caminho', async () => {
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
  const h = montar(['enviarRenomeacao', 'nomeDestaEscrita', 'callWithRetry', 'sessaoTrocou', 'esperaDaEscritaNoSair', 'redesenharAvisoDoSairSeAberto', 'desenharAvisoDoSair', 'chaveDoPedido'], deps);
  const alvo = { place, novo: 'Antigo', antigo: 'X', regiao: 'row' };
  const andando = h.enviarRenomeacao(alvo);
  await ateQue(() => ida.length === 1, 'a 1ª ida não saiu');
  ida.shift()({ success: false, errorCategory: 'transient', httpCode: 503 });
  await ateQue(() => recuos.length === 1, 'a escrita não entrou no recuo');
  h.desenharAvisoDoSair();
  assert.equal(tela.texto(), 'modal.logout.foto:1',
    'DEFEITO: a correção de nome esperando a retentativa não conta no diálogo do "Sair" (R17-3-01): «' + tela.texto() + '»');
  // O "Sair" confirmado troca a época: a espera sai, a escrita para e a marca NÃO fica.
  deps.epocaDaSessao++;
  recuos.shift()();
  await andando;
  assert.equal(deps.escritasEsperandoAVez.size, 0, 'a marca da escrita cancelada ficou no conjunto (a queda não o esvazia)');
  assert.equal(ida.length, 0, 'a retentativa saiu com a sessão trocada');
});

test('R17-3-01 (estrutura): as três escritas de foto e a estrela do ↑ passam a espera ao `callWithRetry` E ao `refazerDepoisDo401`', () => {
  for (const [nome, ref] of [['enviarExclusao', /callWithRetry\(enviar, epoca, espera\)[\s\S]*refazerDepoisDo401\(epoca, enviar, espera\)/],
    ['enviarAprovacao', /callWithRetry\(enviar, epoca, espera\)[\s\S]*refazerDepoisDo401\(epoca, enviar, espera\)/],
    ['enviarRenomeacao', /callWithRetry\(enviar, undefined, espera\)[\s\S]*refazerDepoisDo401\(epoca, enviar, espera\)/]]) {
    const corpo = fatiar(nome);
    assert.match(corpo, /const espera = esperaDaEscritaNoSair\(\);/, `${nome}: sem a marca da escrita`);
    assert.match(corpo, ref, `${nome}: a espera não chega ao recuo e à conferência do 401`);
    assert.match(corpo, /finally \{[\s\S]*espera\(false\);/, `${nome}: o \`finally\` não tira a marca (a queda não esvazia o conjunto)`);
  }
  const skip = fatiar('handleSkip');
  assert.match(skip, /const espera = \(sim\) => marcarLoteSemEnviar\(place, sim\);\s*let r = await callWithRetry\(enviar, epoca, espera\);/);
  assert.match(skip, /refazerDepoisDo401\(epoca, enviar, espera\)/);
  assert.match(fatiar('handleBatchMarkRead'), /const espera = \(sim\) => marcarLoteSemEnviar\(quais\(\), sim\);\s*const r = await callWithRetry\(enviar, undefined, espera\);[\s\S]*refazerDepoisDo401\(epoca, enviar, espera\)/);
});

// ═══ R17-1-01 = R17-2-03 = R17-7-01 · o "Como funciona" aberto sozinho abre ROLADO ═══
// O `openModal` abre no topo (zera a rolagem e foca o 1º controle com `preventScroll`), mas o
// `.focus()` explícito do "Entendi" — o ÚLTIMO controle do diálogo — rolava a caixa até ele no
// celular deitado (667×375: `scrollTop` 105, o título a −53 px). A medida do `scrollTop` mora no
// smoke de layout (precisa de navegador); aqui, o foco sem rolar e a varredura dos irmãos.
test('R17-1-01: o foco do "Entendi" no diálogo aberto sozinho não rola a caixa (`preventScroll`)', () => {
  const chamadas = [];
  const entendi = { focus: (...args) => chamadas.push(['Entendi', ...args]) };
  const deps = { AppState: { preferences: { comoFuncionaVisto: false } }, savePreferences() {}, openModal: () => chamadas.push(['abre']),
    document: { getElementById: (id) => (id === 'comoFuncionaOk' ? entendi : null) } };
  const h = montar(['abrirComoFunciona'], deps);
  h.abrirComoFunciona(true);
  assert.deepEqual(chamadas[0], ['abre']);
  assert.deepEqual(chamadas[1], ['Entendi', { preventScroll: true }],
    'DEFEITO: o foco do "Entendi" rola o diálogo até o botão — título e passos saem da tela no celular deitado (R17-1-01): ' + JSON.stringify(chamadas[1]));
  // CONTROLE: aberto à mão ("Ver de novo") ninguém mexe no foco: o do `openModal` vale.
  chamadas.length = 0;
  h.abrirComoFunciona(false);
  assert.deepEqual(chamadas, [['abre']], 'CONTROLE: o aberto à mão mexeu no foco');
});

test('R17-1-01 (estrutura): nenhum `.focus()` logo depois de um `openModal(` em app.js e presenca.js rola o diálogo — todo vai com `preventScroll`', () => {
  let achados = 0;
  const vistos = [];
  for (const [arq, texto] of [['js/app.js', APP_SEM], ['js/presenca.js', semComentario(ler('js/presenca.js'))]]) {
    const linhas = texto.split('\n');
    linhas.forEach((l, i) => {
      if (!/\bopenModal\(/.test(l) || /^\s*(async )?function openModal\(/.test(l)) return;
      for (let j = i + 1; j <= Math.min(linhas.length - 1, i + 6); j++) {
        if (/\.focus\(\s*\)/.test(linhas[j])) vistos.push(`${arq}:${j + 1}`);
        if (/\.focus\(\{\s*preventScroll: true\s*\}\)/.test(linhas[j])) achados++;
      }
    });
  }
  assert.deepEqual(vistos, [], '`.focus()` solto logo depois de `openModal(` — rola o diálogo até o controle (use `{ preventScroll: true }`): ' + vistos.join(', '));
  assert.ok(achados >= 1, 'CONTROLE: o varredor não enxergou o `.focus({ preventScroll: true })` do "Entendi" — o instrumento está cego');
});

// ═══ R17-7-03 · o aviso dourado do Desfazer LEVA ATÉ a chave ═════════════════
// `abrirPreferenciaDoUndo` trocava de aba e pulsava a linha, mas não rolava até ela: fora da
// vista no celular deitado e no SE com o modo dev (MEDIDO no smoke de layout, que fica com a
// medida em pixels). Aqui, a ORDEM e o portão: rola DEPOIS de a aba trocar, sem `await` novo
// antes, e a rolagem não entra no `reduced-motion` (o pulso, sim).
function abrirDoUndo({ semMovimento = false } = {}) {
  const log = [];
  const linha = { classList: { remove: () => log.push('limpa-pulso'), add: () => log.push('pulso') }, offsetWidth: 0,
    scrollIntoView: (op) => log.push('rola:' + JSON.stringify(op)), addEventListener() {} };
  const deps = { AppState: { authenticated: true }, abrirModalNaAba: (aba) => { log.push('aba:' + aba); return Promise.resolve(); },
    document: { getElementById: (id) => (id === 'prefUndoRow' ? linha : null) }, prefersReducedMotion: () => semMovimento };
  const h = montar(['abrirPreferenciaDoUndo'], deps);
  return { h, log };
}

test('R17-7-03: o aviso dourado rola até a linha DEPOIS de trocar a aba — `nearest`, e o pulso vem depois da rolagem', async () => {
  const m = abrirDoUndo();
  await m.h.abrirPreferenciaDoUndo();
  assert.deepEqual(m.log.slice(0, 2), ['aba:filtersTabPrefs', 'rola:{"block":"nearest"}'],
    'DEFEITO: a linha não é rolada para a vista depois da troca de aba (R17-7-03): ' + m.log.join(' > '));
  assert.ok(m.log.indexOf('pulso') > m.log.indexOf('rola:{"block":"nearest"}'), 'o pulso saiu antes da rolagem (piscava fora da tela)');
});

test('R17-7-03: com movimento reduzido a rolagem fica (é o que aponta) e o pulso sai — e sem sessão nada abre nem rola', async () => {
  const m = abrirDoUndo({ semMovimento: true });
  await m.h.abrirPreferenciaDoUndo();
  assert.deepEqual(m.log, ['aba:filtersTabPrefs', 'rola:{"block":"nearest"}'], 'a rolagem entrou no portão do reduced-motion, ou o pulso saiu: ' + m.log.join(' > '));
  const sem = abrirDoUndo();
  sem.h.deps.AppState.authenticated = false;
  await sem.h.abrirPreferenciaDoUndo();
  assert.deepEqual(sem.log, [], 'CONTROLE: sem sessão o aviso que sobrou abriu os Filtros (R15-7-F1)');
});

test('R17-7-03 (estrutura): a rolagem vem depois do `abrirModalNaAba` e antes de qualquer `await` (a ordem do renderHistory)', () => {
  const corpo = fatiar('abrirPreferenciaDoUndo');
  const iAba = corpo.indexOf("abrirModalNaAba('filtersTabPrefs')");
  const iRola = corpo.indexOf("linha.scrollIntoView({ block: 'nearest' })");
  assert.ok(iAba > 0 && iRola > iAba, 'a rolagem não vem depois da troca de aba');
  assert.ok(!/\bawait\b/.test(corpo.slice(iAba, iRola)), 'um `await` entre a troca de aba e a rolagem faz a pessoa ver a aba errada');
});

// ═══ R17-1-03 · os avisos de uma vez devolvidos × a conta de quem entrou ═══════
// A renovação espera o perfil até `AVISO_RENOVADA_ESPERA_PERFIL_MS` e então restaurava os avisos
// devolvidos na queda. Com a extensão que não repassa a `conta` e o perfil acima desse teto, a troca de
// conta ainda não tinha esvaziado a guarda: a "Rejeição enviada ao Waze em seu nome…" da conta
// anterior saía sobre a fila da nova. Agora só restaura com a conta da sessão de agora CONHECIDA.
const TOKEN = 'waze_session_token';
const CONTA_KEY = new Function(`return ${/^const CONTA_KEY = ([^;]+);/m.exec(APP)[1]};`)();
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();
function renovacao({ contaConhecida }) {
  const dados = new Map([[TOKEN, 'TOK-A'], [CONTA_KEY, JSON.stringify({ id: '111', s: marcaDe('TOK-A') })]]);
  const safeLS = { get: (k) => (dados.has(k) ? dados.get(k) : null), set: (k, v) => dados.set(k, String(v)), remove: (k) => dados.delete(k) };
  const tela = dialogoDoSair();
  const chamou = [];
  const API = { sessionToken: 'TOK-A', temSessaoNaMemoria() { return !!this.sessionToken; },
    setSession(t) { this.sessionToken = t; if (t) safeLS.set(TOKEN, t); else safeLS.remove(TOKEN); }, soltarSessao() { this.sessionToken = null; } };
  const deps = {
    safeLS, CONTA_KEY, API, document: { ...tela.document, querySelector: () => null },
    AppState: { authenticated: true, profile: { id: 111 }, pendingAction: null, fetchEpoch: 1, queue: [P(1)], currentPlace: P(1), _profilePromise: null,
      preferences: { consequenciaVista: { reject: true }, undoGateSeen: true, dicaDesfazerVista: true } },
    epocaDaSessao: 1, quedaAnunciada: false, Treino: { ativo: false }, sessaoCaiuNestaPagina: false, extPerguntando: false,
    contaConfirmadaNestaAba: null, AVISO_RENOVADA_ESPERA_PERFIL_MS: 5,
    pedidosEmAndamento: new Set(), pedidosDoLoteSemEnviar: new Set(), escritasEsperandoAVez: new Set(),
    carregarFilaDeSaida: () => [], reivindicadoPorOutraAba: () => false, t: (k) => k, avisarOutrasAbasDaQueda: () => {},
    filaRealComDevolvidos: () => [P(1)],
    avisosDeUmaVezNaTela: [], avisosAdiados: null, avisosDaQueda: null, avisosAdiadosPedido: false,
    savePreferences() {}, pedirAvisosAdiados() { chamou.push('pediu'); }, showToast() { chamou.push('toast'); }, rebuscarDepoisDeFalha() {},
    // A renovação deu certo: o token novo entra, e a conta só é "conhecida" se o teste a diz (o login ou o perfil).
    entrarPelaExtensao: async () => {
      API.setSession('TOK-B');
      deps.AppState.authenticated = true;   // a renovação religa a sessão (o `showMainScreen`)
      if (contaConhecida) deps.contaConfirmadaNestaAba = { id: '111', s: marcaDe('TOK-B') };
      return true;
    },
  };
  const h = montar(['derrubarSessao', 'lembrarAContaDaQueda', 'sessaoDestaAbaEhAGuardada', 'contaAgora', 'marcaDestaAba', 'marcaDaSessao',
    'soltarOsLotesDaSessaoQueAcabou', 'redesenharAvisoDoSairSeAberto', 'desenharAvisoDoSair', 'chaveDoPedido', 'lembrarAContaDoAparelho',
    'outraContaTomouOAparelhoDaQueCaiu', 'contaSegueNoAparelho', 'devolverAvisosDeUmaVezDaTela', 'adiarAvisoDeUmaVez', 'guardarAvisoDaQueda',
    'guardarAvisosDeUmaVezDaQueda', 'restaurarAvisosDeUmaVezDaQueda', 'contaDestaSessaoConhecida', 'dispensarAvisosDaSessao'], deps);
  deps.avisosDeUmaVezNaTela = [{ qual: 'consequencia', tipo: 'reject', punho: { naTela: () => true, remover() {} }, epoca: 1 }];
  return { h, deps, chamou };
}

test('R17-1-03: a renovação com a conta de quem entrou DESCONHECIDA (sem `conta` na ponte e o perfil acima do teto) NÃO devolve os avisos — a marca de visto já foi desfeita', async () => {
  const m = renovacao({ contaConhecida: false });
  m.h.derrubarSessao('srv.err.sessionExpired');
  await ateQue(() => m.deps.API.sessionToken === 'TOK-B', 'a renovação não entrou');
  await new Promise((ok) => setTimeout(ok, 40));                    // passa o teto de espera do perfil (5 ms aqui)
  assert.equal(m.deps.avisosAdiados, null,
    'DEFEITO: os avisos da conta anterior foram devolvidos à sessão renovada antes de se saber de quem ela é (R17-1-03)');
  assert.ok(!m.chamou.includes('pediu'), 'os avisos pendentes foram pedidos com a conta desconhecida');
  assert.equal(m.deps.avisosDaQueda, null, 'a guarda ficou na memória, inerte, em vez de ser descartada');
  assert.equal(m.deps.AppState.preferences.consequenciaVista.reject, undefined, 'PRÉ-CONDIÇÃO: a marca de visto devia estar desfeita (o próximo ✕ mostra)');
});

test('R17-1-03: CONTROLE — com a conta conhecida (a ponte a repassou, ou o perfil chegou) a renovação devolve os avisos, uma vez', async () => {
  const m = renovacao({ contaConhecida: true });
  m.h.derrubarSessao('srv.err.sessionExpired');
  await ateQue(() => m.chamou.includes('pediu'), 'os avisos não foram devolvidos com a conta conhecida');
  assert.ok(m.deps.avisosAdiados && m.deps.avisosAdiados.consequencia.has('reject'), 'CONTROLE: o aviso da consequência não voltou a pendente');
});

// ═══ R17-1-04 · o seletor de categoria dos Filtros × o "Sair" ═════════════════
// O R16-6-04 zerou o ESTADO (`seenCategories`), mas as <option> da conta que saiu seguiam no DOM do
// seletor até a próxima abertura dos Filtros (o relatório do modo dev leva o DOM). O irmão do
// `esvaziarSeletorDeAreas`, chamado nos mesmos lugares e no fechamento dos Filtros.
test('R17-1-04: `esvaziarSeletorDeCategorias` deixa só "Todas as categorias" — e é o que o `populateCategorySelect` repovoa na abertura seguinte', () => {
  const select = { innerHTML: '<option value="">Todas</option><option value="CATX">CATX</option>', value: 'CATX' };
  const deps = { document: { getElementById: (id) => (id === 'filterCategory' ? select : null) }, t: (k) => 'T:' + k, escapeHtml: (x) => String(x) };
  const h = montar(['esvaziarSeletorDeCategorias'], deps);
  h.esvaziarSeletorDeCategorias();
  assert.equal(select.innerHTML, '<option value="" data-i18n="filters.category.all">T:filters.category.all</option>',
    'DEFEITO: o seletor guardou categorias da conta que saiu: ' + select.innerHTML);
  assert.equal(select.value, '');
  // CONTROLE: sem o seletor na página (as telas sem os Filtros) nada quebra.
  const sem = montar(['esvaziarSeletorDeCategorias'], { document: { getElementById: () => null }, t: (k) => k, escapeHtml: (x) => x });
  assert.doesNotThrow(() => sem.esvaziarSeletorDeCategorias());
});

test('R17-1-04 (estrutura): o "Sair"/a recusa do portão (`showAuthScreen`), a troca de conta e o fechamento dos Filtros esvaziam o seletor — junto das áreas', () => {
  assert.match(fatiar('showAuthScreen'), /esvaziarSeletorDeAreas\(\);\s*esvaziarSeletorDeCategorias\(\);/, 'a tela de entrada não esvazia o seletor de categoria');
  assert.match(fatiar('esquecerOutraConta'), /esvaziarSeletorDeAreas\(\);\s*esvaziarSeletorDeCategorias\(\);/, 'a troca de conta não esvazia o seletor de categoria');
  assert.match(APP_SEM, /filtersModal\(\) \{[\s\S]*?esvaziarSeletorDeAreas\(\);\s*esvaziarSeletorDeCategorias\(\);\s*\},/, 'o fechamento dos Filtros não esvazia o seletor de categoria');
  // O varredor dos sítios das ÁREAS: todo lugar que esvazia as áreas esvazia as categorias (o par não se separa).
  const sitiosAreas = (APP_SEM.match(/^\s+esvaziarSeletorDeAreas\(\);$/gm) || []).length;
  const sitiosCats = (APP_SEM.match(/^\s+esvaziarSeletorDeCategorias\(\);$/gm) || []).length;
  assert.equal(sitiosCats, sitiosAreas, `as categorias são esvaziadas em ${sitiosCats} lugares e as áreas em ${sitiosAreas} — o par se separou`);
  assert.ok(sitiosAreas >= 3, 'CONTROLE: o varredor não achou os sítios das áreas (instrumento cego)');
});
