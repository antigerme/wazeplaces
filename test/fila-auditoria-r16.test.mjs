// A FILA, os avisos, as contas e o lightbox na rodada 16 da auditoria (o lote 20):
//
//  · R16-2-02 — o "Marcar todos" cujo pedaço cai no envio um a um: o diálogo do
//    "Sair" não contava os pedidos que faltavam;
//  · R16-2-03 — a decisão ✕/✓ (e o lote) esperando a RETENTATIVA do
//    `callWithRetry` (sem requisição no ar) não entrava na conta do "Sair";
//  · R16-1-03 — o lote da sessão que acabou seguia no "Enviando N…" e no diálogo
//    do "Sair" depois da queda com renovação;
//  · R16-1-01 — a aba que cai antes do perfil, com a marca do aparelho já trocada
//    por outra sessão da MESMA conta, não lembrava a conta;
//  · R16-3-02 — `pointercancel` na foto ampliada decidia como `pointerup`;
//  · R16-3-03 — a longitude do link do Street View fora de [-180, 180).
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" (o molde do test/contas-auditoria-r15.test.mjs).
// Cada teste foi visto REPROVANDO com o conserto desfeito (as sabotagens estão no
// relatório do lote), e carrega um CONTROLE que reprova se o instrumento não
// enxergar o defeito (gotcha #28).
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

// Um "buraco negro": aceita qualquer propriedade e qualquer chamada, e anota as
// chamadas pelo nome.
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

// ═══ R16-2-02 · o "Marcar todos" que cai no envio UM A UM ═════════════════════
// O Waze processa o lote EM ORDEM e PARA no primeiro pedido já resolvido
// (`already_processed`): o pedaço falha e o laço manda um por um. O pedaço tinha
// saído do conjunto dos "ainda não enviados" ao entrar no ar, e o laço individual
// não os devolvia: o diálogo do "Sair" aberto no meio não contava os que faltavam,
// e confirmar os descartava sem aviso.
function marcarTodosUmAUm({ n = 5 } = {}) {
  const tela = dialogoDoSair();
  const places = Array.from({ length: n }, (_, i) => P(i + 1, { creatorId: 1000 + i }));
  const portoesLote = [], portoesUm = [];
  const AppState = { authenticated: true, queue: places.slice(), currentPlace: places[0], stats: { read: 0, rejected: 0, skipped: 0 },
    serverTotal: n, fetchEpoch: 0, hasMore: false, pendingAction: null, inFlightActions: 0, profile: { id: 1 } };
  const deps = {
    AppState, document: tela.document, epocaDaSessao: 0, Treino: { ativo: false }, LOTE_LIDOS_PEDACO: 3,
    pedidosEmAndamento: new Set(), pedidosDoLoteSemEnviar: new Set(), escritasEsperandoAVez: new Set(),
    loteDeLidosContado: new Set(places.map(chaveDe)), loteDeLidosEmVoo: false, lidosDoLoteNoAr: 0,
    API: { markAsReadBatch: () => new Promise((ok) => portoesLote.push(ok)), markAsRead: () => new Promise((ok) => portoesUm.push(ok)), getRegion: () => 'row' },
    callWithRetry: (fn) => fn(), acoesTravadasForaDaJanela: () => false, aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    carimboDoGesto: () => ({ dia: '2026-10-13', onde: '30', t: 1, lang: 'pt' }),
    decididosPorOutraAbaComCardAqui: new WeakSet(),
    carregarFilaDeSaida: () => [], reivindicadoPorOutraAba: () => false,
    showToast: () => ({ remover() {}, texto() {} }), t: (k, v) => k + ':' + (v && v.n),
    pousouNoWaze: (r) => !!(r && r.success), updateInFlightIndicator: () => {},
  };
  const h = montar(['handleBatchMarkRead', 'marcarEmAndamento', 'marcarLoteSemEnviar', 'redesenharAvisoDoSairSeAberto', 'desenharAvisoDoSair', 'chaveDoPedido'], deps);
  return { h, deps, tela, places, portoesLote, portoesUm, AppState };
}

test('R16-2-02: o pedaço do "Marcar todos" que cai no um a um — o diálogo do "Sair" segue contando os pedidos que faltam, e a conta desce a cada ida', async () => {
  const m = marcarTodosUmAUm({ n: 5 });               // pedaços de 3: [1 2 3] [4 5]
  const lote = m.h.handleBatchMarkRead();
  await tiques();
  assert.equal(m.portoesLote.length, 1, 'PRÉ-CONDIÇÃO: só o 1º pedaço está no ar');
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:2', 'PRÉ-CONDIÇÃO: os 2 do pedaço seguinte estão contados');
  m.portoesLote.shift()({ success: false, errorCategory: 'already_processed' });   // o Waze para num já resolvido
  await tiques();
  assert.equal(m.portoesUm.length, 1, 'PRÉ-CONDIÇÃO: o laço individual mandou o 1º pedido do pedaço');
  // No ar: o pedido 1. Faltam: 2 e 3 (do pedaço que caiu) e 4 e 5 (do seguinte) = 4.
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:4',
    'DEFEITO: o pedaço caiu no um a um e o diálogo do "Sair" deixou de contar os pedidos que ainda não saíram — confirmar os descartaria sem aviso (R16-2-02): «' + m.tela.texto() + '»');
  m.portoesUm.shift()({ success: true });
  await tiques();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:3', 'a frase não acompanhou a ida seguinte do um a um: «' + m.tela.texto() + '»');
  m.portoesUm.shift()({ success: true });
  await tiques();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:2', 'a frase não acompanhou a ida seguinte do um a um: «' + m.tela.texto() + '»');
  // Acaba o um a um, o pedaço seguinte entra no ar (1 ainda por mandar: o 5).
  m.portoesUm.shift()({ success: true });
  await tiques();
  assert.equal(m.portoesLote.length, 1, 'PRÉ-CONDIÇÃO: o pedaço seguinte entrou no ar');
  assert.equal(m.tela.texto(), '', 'o pedaço seguinte entrou no ar inteiro: nada mais a descartar');
  m.portoesLote.shift()({ success: true });
  await lote;
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0, 'o lote acabou e deixou pedidos no conjunto');
  assert.equal(m.tela.texto(), '');
});

test('R16-2-02: o "Sair" no meio do um a um — a ida no ar volta, o laço para e o conjunto não vaza', async () => {
  const m = marcarTodosUmAUm({ n: 3 });               // um pedaço só: [1 2 3]
  const lote = m.h.handleBatchMarkRead();
  await tiques();
  m.portoesLote.shift()({ success: false, errorCategory: 'already_processed' });
  await tiques();
  assert.equal(m.portoesUm.length, 1, 'PRÉ-CONDIÇÃO: o 1º pedido do um a um está no ar');
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:2', 'PRÉ-CONDIÇÃO: faltam 2');
  // O "Sair" no meio do um a um: a época muda e a ida que estava no ar responde.
  m.deps.epocaDaSessao++;
  m.portoesUm.shift()({ success: true });
  await lote;
  assert.equal(m.portoesUm.length, 0, 'o laço seguiu mandando depois do "Sair"');
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0, 'o lote cortado deixou pedidos no conjunto');
});

test('R16-2-02: o pedido que a OUTRA aba decidiu durante o um a um sai da conta — não é o "Sair" que o descarta', async () => {
  const m = marcarTodosUmAUm({ n: 3 });
  const lote = m.h.handleBatchMarkRead();
  await tiques();
  m.portoesLote.shift()({ success: false, errorCategory: 'already_processed' });
  await tiques();
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:2', 'PRÉ-CONDIÇÃO: faltam 2 (o 2 e o 3)');
  m.deps.decididosPorOutraAbaComCardAqui.add(m.places[1]);   // a outra aba decide o 2 enquanto o 1 vai
  m.portoesUm.shift()({ success: true });
  await tiques();
  assert.equal(m.portoesUm.length, 1, 'PRÉ-CONDIÇÃO: o 3 entrou no ar (o 2 foi pulado)');
  assert.equal(m.tela.texto(), '',
    'DEFEITO: o pedido que a outra aba decidiu seguiu na conta do "Sair" como se ele o fosse descartar: «' + m.tela.texto() + '»');
  m.portoesUm.shift()({ success: true });
  await lote;
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0);
});

test('R16-2-02 (estrutura): o um a um devolve o pedaço ao conjunto ANTES do laço e tira cada pedido ao entrar no ar', () => {
  const corpo = fatiar('handleBatchMarkRead');
  const i = corpo.indexOf('for (const p of pedaco) {');
  assert.ok(i > 0, 'o laço individual mudou: reescreva este guard');
  const antes = corpo.slice(Math.max(0, i - 200), i);
  assert.match(antes, /marcarLoteSemEnviar\(pedaco, true\);\s*$/, 'o pedaço não volta ao conjunto antes do laço individual');
  const dentro = corpo.slice(i);
  const k = dentro.indexOf('API.markAsRead(');
  assert.ok(k > 0, 'o laço individual não manda mais pelo markAsRead');
  assert.match(dentro.slice(0, k), /marcarLoteSemEnviar\(p, false\);\s*noAr\(/, 'cada pedido não sai do conjunto ao entrar no ar');
});

// ═══ R16-2-03 · a decisão que ESPERA A RETENTATIVA conta no "Sair" ════════════
// O ✕/✓ cuja 1ª ida volta `transient` espera 1,5 s e 3,5 s do `callWithRetry`
// antes de tentar de novo: nesse tempo não há requisição no ar, ela já está na fila
// de saída E em andamento (por isso o aviso a deixava de fora), e o "Sair"
// confirmado cancela a retentativa pela época. A decisão com a requisição NO AR
// continua de fora da conta (o Waze a recebe, R15-2-F4).
const AGORA_NAO = Symbol('sem tempo');
function decisaoNaRetentativa({ tipo = 'reject' } = {}) {
  const tela = dialogoDoSair();
  const place = P(1);
  const respostas = [];                                   // cada ida fica segura até o teste soltá-la
  const fila = [{ tipo, venueID: place.venueID, updateRequestID: place.updateRequestID }];
  const AppState = { authenticated: true, currentPlace: place, queue: [], stats: { read: 0, rejected: 0, skipped: 0 },
    serverTotal: 1, fetchEpoch: 0, pendingAction: null, inFlightActions: 0 };
  const ida = () => new Promise((ok) => respostas.push(ok));
  const deps = {
    AppState, document: tela.document, epocaDaSessao: 0, Treino: { ativo: false }, navigator: { onLine: true },
    TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [15, 15],
    pedidosEmAndamento: new Set([chaveDe(place)]), pedidosDoLoteSemEnviar: new Set(), escritasEsperandoAVez: new Set(),
    API: { getRegion: () => 'row', rejectPlace: ida, markAsRead: ida },
    carregarFilaDeSaida: () => fila, reivindicadoPorOutraAba: () => false,
    t: (k, v) => k + ':' + (v && v.n),
    acoesTravadas: () => false, direcaoTravada: () => false, gestoNoDecididoPorOutraAba: () => false,
    anotarAntesDoEnvio: () => 'anotada', presencaWmeDaAcao: () => null, presencaWmeAoResponder() {}, handleActionResult() {},
    decisaoDepoisDaQueda() {}, paisDaFila: () => '30', quemDecideAgora: () => null, carimboDoGesto: () => ({ dia: '2026-10-13', onde: '30', t: 1, lang: 'pt' }),
    // O `scheduleAction` de verdade abre a janela do Desfazer; aqui o executor roda na hora.
    scheduleAction: (t, p, executor) => { deps.executor = executor(); },
  };
  const h = montar([tipo === 'reject' ? 'handleReject' : 'handleMarkAsRead', 'callWithRetry', 'sessaoTrocou', 'marcarEmAndamento',
    'marcarLoteSemEnviar', 'redesenharAvisoDoSairSeAberto', 'desenharAvisoDoSair', 'chaveDoPedido'], deps);
  return { h, deps, tela, place, respostas, fila };
}
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

for (const tipo of ['reject', 'read']) {
  test(`R16-2-03: o ${tipo === 'reject' ? '✕' : '✓'} esperando a retentativa entra no aviso do "Sair" — e sai dele quando a ida seguinte vai ao ar`, async () => {
    const m = decisaoNaRetentativa({ tipo });
    (tipo === 'reject' ? m.h.handleReject : m.h.handleMarkAsRead)();
    await tiques();
    assert.equal(m.respostas.length, 1, 'PRÉ-CONDIÇÃO: a 1ª ida está no ar');
    // A decisão com a requisição NO AR segue de fora da conta (o Waze a recebe com o "Sair" no meio).
    m.h.desenharAvisoDoSair();
    assert.equal(m.tela.texto(), '', 'a decisão com a requisição no ar entrou no aviso (R15-2-F4 a deixa de fora)');
    m.respostas.shift()({ success: false, errorCategory: 'transient', httpCode: 503 });
    await tiques();
    assert.equal(m.respostas.length, 0, 'PRÉ-CONDIÇÃO: a 2ª ida ainda espera o recuo (nada no ar)');
    // No recuo: nada no ar, o "Sair" cancelaria a retentativa — o aviso tem que contar.
    m.h.desenharAvisoDoSair();
    assert.equal(m.tela.texto(), 'modal.logout.saida:1',
      'DEFEITO: a decisão no recuo do `callWithRetry` não está na conta do "Sair", que a cancela sem aviso (R16-2-03): «' + m.tela.texto() + '»');
    // O recuo acaba e a ida seguinte vai ao ar: a decisão sai da conta SOZINHA (o diálogo segue aberto).
    await esperar(60);
    assert.equal(m.respostas.length, 1, 'PRÉ-CONDIÇÃO: a retentativa foi ao ar');
    assert.equal(m.tela.texto(), '', 'a frase seguiu dizendo que a decisão seria descartada, com ela de volta ao ar: «' + m.tela.texto() + '»');
    m.respostas.shift()({ success: true });
    await m.deps.executor;
    assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0, 'o conjunto vazou depois do fim');
  });
}

test('R16-2-03: o diálogo ABERTO acompanha o recuo (a frase aparece e some sem ninguém redesenhar) — e o "Sair" que cancela a retentativa não deixa o conjunto sujo', async () => {
  const m = decisaoNaRetentativa();
  m.h.handleReject();
  await tiques();
  m.tela.modal.classList.remove('hidden');               // o diálogo já está na tela
  m.respostas.shift()({ success: false, errorCategory: 'transient', httpCode: 503 });
  await tiques();
  assert.equal(m.tela.texto(), 'modal.logout.saida:1', 'DEFEITO: o diálogo aberto não ganhou a frase quando a decisão entrou no recuo');
  // O "Sair" confirmado: a época muda, o conjunto é esvaziado (`handleLogout`) e a retentativa não sai.
  m.deps.epocaDaSessao++;
  m.deps.pedidosDoLoteSemEnviar.clear();
  await esperar(60);
  assert.equal(m.respostas.length, 0, 'a retentativa saiu depois do "Sair"');
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0, 'a decisão cancelada ficou no conjunto');
});

test('R16-2-03: CONTROLE — sem recuo (a 1ª ida pousa) nada entra no conjunto; e `callWithRetry` só avisa DENTRO do recuo, `true` antes e `false` depois', async () => {
  const m = decisaoNaRetentativa();
  m.h.handleReject();
  await tiques();
  m.respostas.shift()({ success: true });
  await m.deps.executor;
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0);
  // `callWithRetry` sozinho, com a ordem dos avisos.
  const eventos = [];
  const deps = { epocaDaSessao: 0, navigator: { onLine: true }, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [5, 5] };
  const c = montar(['callWithRetry', 'sessaoTrocou'], deps);
  let n = 0;
  const r = await c.callWithRetry(async () => { eventos.push('ida'); return ++n < 3 ? { success: false, errorCategory: 'transient' } : { success: true }; },
    undefined, (sim) => eventos.push(sim ? 'espera' : 'fim-da-espera'));
  assert.equal(r.success, true);
  assert.deepEqual(eventos, ['ida', 'espera', 'fim-da-espera', 'ida', 'espera', 'fim-da-espera', 'ida'], 'a ordem dos avisos do recuo mudou');
  // Sem recuo (sucesso na 1ª) e sem rede (não se retenta): nenhum aviso.
  const mudo = [];
  await c.callWithRetry(async () => ({ success: true }), undefined, (sim) => mudo.push(sim));
  deps.navigator.onLine = false;
  await c.callWithRetry(async () => ({ success: false, errorCategory: 'transient' }), undefined, (sim) => mudo.push(sim));
  assert.deepEqual(mudo, [], 'o recuo avisou sem haver recuo');
  // A sessão acaba DURANTE a espera: o aviso `false` não vem (o conjunto já foi esvaziado por quem trocou a época).
  deps.navigator.onLine = true;
  const cortado = [];
  const pendente = c.callWithRetry(async () => ({ success: false, errorCategory: 'transient' }), undefined, (sim) => cortado.push(sim));
  await tique();
  deps.epocaDaSessao++;
  const rc = await pendente;
  assert.equal(rc.errorCategory, 'session_changed');
  assert.deepEqual(cortado, [true], 'o fim da espera foi avisado depois de a sessão acabar (apagaria o conjunto da sessão nova)');
});

test('R16-2-03 (estrutura): os quatro caminhos que esperam a retentativa avisam o "Sair" — ✕, ✓, o "Rejeitar os N" da pessoa e o "Marcar todos"', () => {
  assert.match(fatiar('handleReject'), /callWithRetry\(\(\) => API\.rejectPlace\([^)]*\), epoca,\s*\(sim\) => marcarLoteSemEnviar\(place, sim\)\)/);
  assert.match(fatiar('handleMarkAsRead'), /callWithRetry\(\(\) => API\.markAsRead\([^)]*\), epoca,\s*\(sim\) => marcarLoteSemEnviar\(place, sim\)\)/);
  assert.match(fatiar('enviarLote'), /undefined,\s*aoLandar \? null : \(sim\) => marcarLoteSemEnviar\(p, sim\)\)/,
    'o "Rejeitar os N" da pessoa não avisa o recuo (e a recusa automática, que é o app agindo, não pode)');
  assert.match(fatiar('handleBatchMarkRead'), /callWithRetry\(enviar, undefined, \(sim\) => marcarLoteSemEnviar\(quais\(\), sim\)\)/);
});

// ═══ R16-1-03 · o lote da sessão que ACABOU não conta mais ═══════════════════
// Depois da queda com renovação, o lote "Rejeitar os N" da sessão morta segue com a
// ida em voo (a época mudou, o laço parou e os pedidos VOLTAM à fila): o canto dizia
// "Enviando 2…" (as unidades dele no `inFlightActions`) e o diálogo do "Sair" dizia
// "5 pedidos serão descartados", com os pedidos de volta ao card.
function indicadorDeMentira({ noAr = 1, lotes = [], epoca = 0, fila = [] } = {}) {
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
    loteDeLidosEmVoo: false, lidosDoLoteNoAr: 0, epocaDaSessao: epoca, rejeicoesDeLoteNoAr: new Set(lotes) };
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

test('R16-1-03: o lote de uma sessão que acabou não diz "Enviando N…" — nem as unidades dele, nem os pedidos', () => {
  const lote = (restam, acoes, epoca) => ({ epoca, restam, acoes });
  // O "Rejeitar os 5" da sessão 3 (2 unidades no inFlightActions: o `scheduleAction` e o lote), e a sessão agora é a 4.
  assert.equal(indicadorDeMentira({ noAr: 2, lotes: [lote(5, 2, 3)], epoca: 4 }).texto(), null,
    'DEFEITO: o canto da sessão renovada segue dizendo "Enviando 2…" por um lote que parou (R16-1-03)');
  // CONTROLE: o MESMO lote na sessão dele conta os 5; e um ✕ da sessão nova junto do lote velho conta 1.
  assert.equal(indicadorDeMentira({ noAr: 2, lotes: [lote(5, 2, 4)], epoca: 4 }).texto(), 'indicator.sending:5', 'CONTROLE: o lote da sessão de agora deixou de contar');
  assert.equal(indicadorDeMentira({ noAr: 3, lotes: [lote(5, 2, 3)], epoca: 4 }).texto(), 'indicator.sending:1', 'CONTROLE: o ✕ da sessão nova some junto do lote velho');
  // O que o app fazia com lotes de duas épocas juntos (a velha e a nova).
  assert.equal(indicadorDeMentira({ noAr: 3, lotes: [lote(5, 2, 3), lote(2, 1, 4)], epoca: 4 }).texto(), 'indicator.sending:2');
});

test('R16-1-03: as anotações do lote velho na fila de saída (até a ida em voo responder) não viram "N esperando envio"', () => {
  const pedidos = [P(1), P(2), P(3)];
  const fila = pedidos.map((p) => ({ tipo: 'reject', venueID: p.venueID, updateRequestID: p.updateRequestID }));
  const velho = { epoca: 3, restam: 3, acoes: 2, pedidos };
  assert.equal(indicadorDeMentira({ noAr: 2, lotes: [velho], epoca: 4, fila }).texto(), null,
    'DEFEITO: o canto da sessão renovada diz "3 esperando envio" por anotações de um lote que voltou à fila (R16-1-03)');
  // CONTROLES: o mesmo lote na SUA sessão conta os pedidos; uma decisão de verdade esperando rede (outro pedido) segue contando.
  assert.equal(indicadorDeMentira({ noAr: 2, lotes: [{ ...velho, epoca: 4 }], epoca: 4, fila }).texto(), 'indicator.sending:3');
  const outra = { tipo: 'reject', venueID: 'v99', updateRequestID: 'u99' };
  assert.equal(indicadorDeMentira({ noAr: 2, lotes: [velho], epoca: 4, fila: [...fila, outra] }).texto(), 'indicator.waiting:1',
    'CONTROLE: a decisão que de fato espera a rede sumiu do canto junto com as do lote velho');
});

// A queda sem perfil, com o aparelho como ficou de uma abertura anterior — o molde do
// test/contas-auditoria-r15.test.mjs.
const TOKEN = 'waze_session_token';
const CONTA_KEY = new Function(`return ${/^const CONTA_KEY = ([^;]+);/m.exec(APP)[1]};`)();
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();
function aparelho(inicial = {}) {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const localStorage = {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { dados.set(k, String(v)); },
    removeItem: (k) => { dados.delete(k); },
  };
  const safeLS = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
  return { dados, safeLS };
}
function quedaComLote({ pedidosDoLote = [P(2), P(3), P(4)] } = {}) {
  const tela = dialogoDoSair();
  const ap = aparelho({ [TOKEN]: 'TOK-A', [CONTA_KEY]: { id: '111', s: marcaDe('TOK-A') } });
  const deps = {
    safeLS: ap.safeLS, CONTA_KEY,
    AppState: { authenticated: true, profile: { id: 111 }, pendingAction: null, fetchEpoch: 1, queue: [P(1)], currentPlace: P(1) },
    API: {
      sessionToken: 'TOK-A',
      temSessaoNaMemoria() { return !!this.sessionToken; },
      setSession(t) { this.sessionToken = t; if (t) ap.safeLS.set(TOKEN, t); else ap.safeLS.remove(TOKEN); },
      soltarSessao() { this.sessionToken = null; },
    },
    document: { ...tela.document, querySelector: () => null },
    epocaDaSessao: 0, quedaAnunciada: false, Treino: { ativo: false }, sessaoCaiuNestaPagina: false,
    extPerguntando: false, contaConfirmadaNestaAba: null,
    pedidosEmAndamento: new Set(pedidosDoLote.map(chaveDe)), pedidosDoLoteSemEnviar: new Set(pedidosDoLote.map(chaveDe)),
    escritasEsperandoAVez: new Set(), carregarFilaDeSaida: () => [], reivindicadoPorOutraAba: () => false,
    t: (k, v) => k + ':' + (v && v.n),
    entrarPelaExtensao: () => new Promise(() => {}),   // a renovação, no ar
    avisarOutrasAbasDaQueda: () => {},
  };
  const h = montar(['derrubarSessao', 'lembrarAContaDaQueda', 'sessaoDestaAbaEhAGuardada', 'contaAgora', 'marcaDestaAba', 'marcaDaSessao',
    'soltarOsLotesDaSessaoQueAcabou', 'redesenharAvisoDoSairSeAberto', 'desenharAvisoDoSair', 'chaveDoPedido'], deps);
  return { h, deps, tela, ap };
}

test('R16-1-03: a queda esvazia os pedidos do lote que não saíram — o diálogo do "Sair" da sessão renovada não os conta (eles voltam à fila)', () => {
  const m = quedaComLote();
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:3', 'PRÉ-CONDIÇÃO: os 3 pedidos do lote estão contados');
  m.h.derrubarSessao('srv.err.sessionExpired');
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0,
    'DEFEITO: o lote da sessão morta segue no conjunto — o "Sair" da sessão renovada diria "3 pedidos serão descartados" com eles de volta ao card (R16-1-03)');
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), '');
});

test('R16-1-03: o diálogo ABERTO na hora da queda se redesenha (a frase não fica dizendo o que já não vale)', () => {
  const m = quedaComLote();
  m.h.desenharAvisoDoSair();
  m.tela.modal.classList.remove('hidden');
  m.h.derrubarSessao('srv.err.sessionExpired');
  assert.equal(m.tela.texto(), '', 'o diálogo aberto seguiu com a frase do lote da sessão que caiu: «' + m.tela.texto() + '»');
});

test('R16-1-03: a conta em dúvida (a época também muda) esvazia o conjunto — e a troca de época passa por UMA função nos três lugares', () => {
  const deps = { AppState: { contaEmDuvida: false, pendingAction: null }, epocaDaSessao: 0, loteDeLidosEmVoo: true,
    pedidosDoLoteSemEnviar: new Set(['a']), document: dialogoDoSair().document, conferindoContaDestaAba: true,
    cancelarPendenciasDoLightbox() {}, aprovacoesAtravessamAQueda() {}, aplicarTravaDeAcao() {} };
  const m = montar(['conferirContaDestaAba', 'soltarOsLotesDaSessaoQueAcabou', 'redesenharAvisoDoSairSeAberto', 'desenharAvisoDoSair'], deps);
  m.conferirContaDestaAba();
  assert.equal(deps.epocaDaSessao, 1, 'PRÉ-CONDIÇÃO: a dúvida não trocou a época');
  assert.equal(deps.pedidosDoLoteSemEnviar.size, 0, 'DEFEITO: a conta em dúvida trocou a época e deixou o lote velho no conjunto');
  // Estrutura: toda troca de época (menos o "Sair", que esvazia tudo à mão) solta o lote logo depois.
  for (const nome of ['derrubarSessao', 'conferirContaDestaAba']) {
    assert.match(fatiar(nome), /epocaDaSessao\+\+;[^\n]*\n\s*soltarOsLotesDaSessaoQueAcabou\(\);/, `${nome} troca a época sem soltar o lote`);
  }
  assert.match(fatiar('handleLogout'), /^\s+pedidosDoLoteSemEnviar\.clear\(\);/m, 'o "Sair" não esvazia o conjunto');
});
