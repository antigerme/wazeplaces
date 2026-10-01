// "Marcar todos como lidos", pela auditoria de 2026-09-25. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
//
// MEDIDO com a conta L2 (e o lido devolvido e conferido): o lote do Waze NÃO é
// atômico — ele processa EM ORDEM e para no primeiro pedido já resolvido.
// [real, inexistente, real] → HTTP 500 código 300, com o PRIMEIRO marcado e o
// terceiro não. O app mostrava "Já tratado ou modificado…" e não fazia nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', APP_SEM.indexOf(')', m.index)); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) return APP_SEM.slice(m.index, j + 1); }
  }
  throw new Error('não fechou');
}
const pedido = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i });

// O Waze de mentira com a regra MEDIDA: o lote para no primeiro já resolvido.
// `segurar`: as respostas esperam o teste soltar (`m.soltar()`) — é o lote NO AR.
// `seguraDepois`: com `segurar`, as N primeiras requisições respondem na hora e
// só as seguintes esperam — o lote NO MEIO (um pedaço já pousou, o outro no ar).
// `pendentes`: as ações de foto na janela do Desfazer ({ aprovacao, exclusao, renomeacao }).
function montar(fila, { resolvidos = [], segurar = false, seguraDepois = 0, pendentes = {}, falhar = false } = {}) {
  const lidos = new Set();
  const chamadas = [];
  const toasts = [];
  const historico = [];
  const log = [];
  const tela = [];
  const pousos = [];
  const mensagem = { textContent: '' };
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { read: 0 }, serverTotal: fila.length, hasMore: false,
    pendingAction: null, inFlightActions: 0, fetchEpoch: 0 };
  const processar = (itens) => {
    if (falhar) return { success: false, errorCategory: 'unknown', httpCode: 406 };
    for (const it of itens) {
      if (resolvidos.includes(it.updateRequestID)) return { success: false, errorCategory: 'already_processed', httpCode: 500 };
      lidos.add(it.updateRequestID);
    }
    return { success: true };
  };
  let soltar = () => {};
  const segurado = segurar ? new Promise((ok) => { soltar = ok; }) : Promise.resolve();
  const portao = () => (chamadas.length > seguraDepois ? segurado : Promise.resolve());
  const pendente = (nome) => (pendentes[nome] ? { enviar: () => log.push(nome) } : null);
  let app = null;
  const emAndamento = new Set();
  const entraram = new Set(fila.map((p) => p.venueID + '|' + p.updateRequestID));
  const deps = {
    // A constante DO APP, lida do fonte: fixar 25 aqui deixaria a sabotagem da
    // constante passar (o harness não a enxergaria).
    AppState, Treino: { ativo: false }, epocaDaSessao: 0,
    LOTE_LIDOS_PEDACO: Number(/^const LOTE_LIDOS_PEDACO = (\d+);/m.exec(APP_SEM)[1]),
    chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID,
    closeModal: () => {}, openModal: () => {}, showToast: (m, tipo) => toasts.push(tipo), msgDoServidor: (r, d) => d,
    t: (k, v) => (v && v.n != null ? k + '#' + v.n : k),
    removeUndoBanner: () => {}, updateInFlightIndicator: () => {}, callWithRetry: (fn) => fn(),
    API: {
      getRegion: () => 'row',
      markAsReadBatch: async (itens) => { chamadas.push(itens.length); log.push('lote'); await portao(); return processar(itens); },
      markAsRead: async (v, u) => { chamadas.push(1); await portao(); return processar([{ venueID: v, updateRequestID: u }]); },
    },
    handleUnauthorized: () => {}, recordHistory: (tipo, n) => historico.push([tipo, n]),
    registrarPouso: (ps) => pousos.push(...(Array.isArray(ps) ? ps : [ps]).map((p) => p.updateRequestID)),
    registrarLoteConfirmado: () => {}, updateStats: () => {}, saveStats: () => {}, removeCurrentCardEl: () => {},
    // A TELA depois do lote vai num registro à parte: o `log` é o da ordem das
    // travas e dos envios, que os testes do F1 leem pela última linha.
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; tela.push('card'); },
    startFetching: () => tela.push('busca'), showNoPlaces: () => tela.push('vazio'), updatePendingCount: () => {},
    aoMudarAFilaPorBaixo: () => {}, pedidosQueEntraramNaFila: entraram,
    // O texto do diálogo ("Marcar os N"): é o que a pessoa lê antes de confirmar.
    document: { getElementById: (id) => (id === 'batchReadMessage' ? mensagem : null) },
    pedidosEmAndamento: emAndamento, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(),
    aplicarTravaDeAcao: () => log.push('trava:' + app.acoesTravadas()),
    aprovacaoPendente: pendente('aprovacao'), exclusaoPendente: pendente('exclusao'), renomeacaoPendente: pendente('renomeacao'),
  };
  const chaves = Object.keys(deps);
  const corpo = ['openBatchReadConfirm', 'handleBatchMarkRead', 'acoesTravadas', 'aprovacaoDaTelaNoAr', 'marcarEmAndamento',
    'devolverPedidoRecusado']
    .map(fatiar).join('\n');
  app = new Function(...chaves, 'let loteDeLidosContado = null; let tratouNestaFila = false; let loteDeLidosEmVoo = false; let escritasConferindo = 0;\n' + corpo
    + '\nreturn { openBatchReadConfirm, handleBatchMarkRead, acoesTravadas };')(...chaves.map((k) => deps[k]));
  return { app, AppState, lidos, chamadas, toasts, historico, log, tela, emAndamento, pousos, entraram, mensagem, soltar: () => soltar() };
}
const umTique = () => new Promise((ok) => setTimeout(ok, 0));

test('marca SÓ o que o diálogo contou — a releitura que pousou com ele aberto fica de fora', async () => {
  const m = montar([pedido(1), pedido(2), pedido(3)]);
  m.app.openBatchReadConfirm();
  m.AppState.queue.push(pedido(4), pedido(5));          // a busca pousou com o diálogo aberto
  await m.app.handleBatchMarkRead();
  assert.deepEqual([...m.lidos].sort(), ['u1', 'u2', 'u3'], 'marcou pedido que a pessoa nunca viu, sem Desfazer');
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v4', 'v5']);
});

test('um já resolvido no meio: o pedaço vai UM A UM, e o resto é marcado (o lote do Waze para no primeiro)', async () => {
  const m = montar([pedido(1), pedido(2), pedido(3)], { resolvidos: ['u2'] });
  m.app.openBatchReadConfirm();
  await m.app.handleBatchMarkRead();
  assert.ok(m.lidos.has('u3'), 'o que vinha DEPOIS do resolvido ficou sem marcar');
  assert.deepEqual(m.AppState.queue, [], 'o resolvido por outro editor ficou na fila');
  assert.deepEqual(m.historico, [['read', 3]], 'o Histórico não contou o lote como o placar conta');
  assert.equal(m.AppState.stats.read, 3);
  assert.ok(!m.toasts.includes('error'), 'erro por um pedido que outro editor já tinha tratado');
});

test('fila grande vai em PEDAÇOS: uma divergência custa um pedaço, não a fila inteira', async () => {
  const fila = Array.from({ length: 60 }, (_, i) => pedido(i + 1));
  const m = montar(fila, { resolvidos: ['u30'] });
  m.app.openBatchReadConfirm();
  await m.app.handleBatchMarkRead();
  assert.equal(m.lidos.size, 59);
  assert.equal(m.chamadas[0], 25, 'o primeiro pedaço não tem o tamanho combinado');
  assert.ok(m.chamadas.length <= 3 + 25, `${m.chamadas.length} requisições pra 60 pedidos`);
});

// ── F1: o lote NO AR (auditoria da fila, 2026-09-26) ────────────────────────
// Enquanto o lote estava no ar nada travava: o ✕ no card da frente mandava uma
// SEGUNDA decisão pro mesmo pedido (medido: lidos 8 + rejeitados 1 pra 8
// pedidos), um segundo "Marcar todos" mandava o mesmo lote de novo (placar em
// dobro), e o ↻ trazia de volta como card o que o lote já tinha marcado.
test('F1: com o lote no ar, ✕ ↑ ✓, gesto e teclado ficam TRAVADOS — e soltam no fim', async () => {
  const m = montar([pedido(1), pedido(2), pedido(3)], { segurar: true });
  m.app.openBatchReadConfirm();
  const lote = m.app.handleBatchMarkRead();
  await umTique();
  assert.equal(m.app.acoesTravadas(), true,
    'o lote está no ar e o card segue decidível: o ✕ manda uma SEGUNDA decisão pro mesmo pedido');
  assert.ok(m.log.includes('trava:true'), 'os botões do card não foram travados na tela');
  m.soltar();
  await lote;
  assert.equal(m.app.acoesTravadas(), false, 'o lote terminou e a trava ficou presa: o card morre');
  assert.equal(m.log.at(-1), 'trava:false', 'os botões não voltaram no fim do lote');
});

test('F1: um SEGUNDO "Marcar todos" com o primeiro no ar não manda nada de novo', async () => {
  const m = montar([pedido(1), pedido(2), pedido(3)], { segurar: true });
  m.app.openBatchReadConfirm();
  const l1 = m.app.handleBatchMarkRead();
  await umTique();
  m.app.openBatchReadConfirm();
  const l2 = m.app.handleBatchMarkRead();
  m.soltar();
  await Promise.all([l1, l2]);
  assert.deepEqual(m.chamadas, [3], `o mesmo lote saiu duas vezes: ${m.chamadas.join(',')}`);
  assert.equal(m.AppState.stats.read, 3, 'o placar contou o lote em dobro');
  assert.deepEqual(m.historico, [['read', 3]]);
});

test('F1: ↻ no meio do lote — os pedidos ficam "em andamento" (a busca não os traz) e o "Restam" da fila nova não é descontado', async () => {
  const m = montar([pedido(1), pedido(2), pedido(3)], { segurar: true });
  m.app.openBatchReadConfirm();
  const lote = m.app.handleBatchMarkRead();
  await umTique();
  assert.deepEqual([...m.emAndamento].sort(), ['v1|u1', 'v2|u2', 'v3|u3'],
    'os pedidos do lote não estão "em andamento": a busca do ↻ os devolve como card, e eles já foram marcados');
  // O ↻: `resetQueue` (época nova) e a busca, que traz só o que não está em andamento.
  m.AppState.fetchEpoch++;
  m.AppState.queue = [pedido(4)];
  m.AppState.currentPlace = m.AppState.queue[0];
  m.AppState.serverTotal = 1;
  m.soltar();
  await lote;
  assert.equal(m.AppState.serverTotal, 1, `o lote descontou da fila NOVA: "Restam" ${m.AppState.serverTotal} com 1 card`);
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v4']);
  assert.equal(m.emAndamento.size, 0, 'os pedidos do lote ficaram presos em "em andamento"');
  assert.equal(m.AppState.stats.read, 3, 'o que o lote marcou deixou de contar no placar');
});

test('F1: as ações de FOTO na janela do Desfazer saem ANTES do lote (o banner é o mesmo)', async () => {
  const m = montar([pedido(1), pedido(2)], { pendentes: { aprovacao: true, exclusao: true, renomeacao: true } });
  m.app.openBatchReadConfirm();
  await m.app.handleBatchMarkRead();
  const iLote = m.log.indexOf('lote');
  for (const nome of ['aprovacao', 'exclusao', 'renomeacao']) {
    const i = m.log.indexOf(nome);
    assert.ok(i >= 0 && i < iLote, `a ${nome} pendente não foi despachada antes do lote (log: ${m.log.join(' ')})`);
  }
});

test('F1: o lote que FALHA também solta a trava e o "em andamento" — e os pedidos seguem na fila', async () => {
  const m = montar([pedido(1), pedido(2)], { segurar: true, falhar: true });
  m.app.openBatchReadConfirm();
  const lote = m.app.handleBatchMarkRead();
  await umTique();
  assert.equal(m.app.acoesTravadas(), true, 'o lote que vai falhar também está no ar');
  m.soltar();
  await lote;
  assert.equal(m.app.acoesTravadas(), false, 'a falha deixou a trava presa: o card morre');
  assert.equal(m.emAndamento.size, 0, 'a falha deixou os pedidos presos em "em andamento": a busca nunca mais os traz');
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v1', 'v2'], 'o que não foi marcado saiu da fila');
  assert.equal(m.AppState.serverTotal, 2);
  assert.ok(m.toasts.includes('error'), 'a falha do lote foi calada');
});

// ═══ Auditoria de 2026-09-29: o "Marcar todos" e a decisão que não pode sumir ══
// Cada teste foi visto REPROVANDO com o conserto desfeito.

// ── O4: o pouso é registrado a CADA PEDAÇO, não no fim do laço ────────────────
// Fechar o app no meio de um lote de 60 deixava os 25 que o Waze já marcou sem
// pouso, e a reabertura sem rede os devolvia como card (medido no navegador,
// f3-lote-lidos: 25 de volta). O pouso é o que a reabertura consulta.
test('O4: com um pedaço já marcado e o outro no ar, o pouso do primeiro JÁ está registrado', async () => {
  const fila = Array.from({ length: 30 }, (_, i) => pedido(i + 1));
  const m = montar(fila, { segurar: true, seguraDepois: 1 });
  m.app.openBatchReadConfirm();
  const lote = m.app.handleBatchMarkRead();
  for (let i = 0; i < 5; i++) await umTique();
  assert.deepEqual(m.chamadas, [25, 5], 'PRÉ-CONDIÇÃO: o 1º pedaço (25) pousou e o 2º está no ar');
  assert.equal(m.pousos.length, 25,
    `o 1º pedaço marcado no Waze está sem pouso (${m.pousos.length}): fechado o app agora, ele volta como card sem rede`);
  m.soltar();
  await lote;
  assert.equal(m.pousos.length, 30, 'o 2º pedaço não registrou o pouso');
  assert.equal(new Set(m.pousos).size, 30, 'o mesmo pedido pousou duas vezes (o fim do laço registrando de novo)');
});

test('O4: no caminho UM A UM (um já resolvido no pedaço) cada pedido pousa na hora', async () => {
  const m = montar([pedido(1), pedido(2), pedido(3)], { resolvidos: ['u2'], segurar: true, seguraDepois: 2 });
  m.app.openBatchReadConfirm();
  const lote = m.app.handleBatchMarkRead();
  for (let i = 0; i < 5; i++) await umTique();
  assert.deepEqual(m.chamadas, [3, 1, 1], 'PRÉ-CONDIÇÃO: o lote parou no resolvido e o um a um está no 2º pedido');
  assert.deepEqual(m.pousos, ['u1'], 'o pedido já marcado no um a um está sem pouso até o fim do laço');
  m.soltar();
  await lote;
  assert.deepEqual(m.pousos.sort(), ['u1', 'u2', 'u3']);
});

// ── V7: o pedido EM ANDAMENTO fica fora do "Marcar todos" ─────────────────────
// A aprovação de foto no ar deixa o card na fila até a resposta, e o lote o
// levava junto: uma SEGUNDA decisão sobre o mesmo pedido, contada no placar
// (medido no navegador, s12: o diálogo contou 3 e o lote levou a foto aprovada).
test('V7: a aprovação no ar deixa o pedido na fila — o diálogo não o conta e o lote não o leva', async () => {
  const m = montar([pedido(1), pedido(2), pedido(3)]);
  m.emAndamento.add('v1|u1');                       // a aprovação de foto de v1 está no ar
  m.app.openBatchReadConfirm();
  assert.equal(m.mensagem.textContent, 'modal.batchRead.bodyPlural#2',
    'o diálogo contou o pedido com a aprovação no ar — dizia 3 com 2 a decidir');
  await m.app.handleBatchMarkRead();
  assert.deepEqual([...m.lidos].sort(), ['u2', 'u3'], 'o lote mandou uma 2ª decisão pro pedido com a aprovação no ar');
  assert.equal(m.AppState.stats.read, 2, 'o placar contou o pedido da aprovação duas vezes');
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v1'], 'o pedido da aprovação saiu da fila pelo lote');
});

test('V7: e o que entra em andamento com o diálogo ABERTO também fica de fora', async () => {
  const m = montar([pedido(1), pedido(2)]);
  m.app.openBatchReadConfirm();                     // o diálogo contou os dois…
  m.emAndamento.add('v2|u2');                       // …e a aprovação de v2 saiu com ele aberto
  await m.app.handleBatchMarkRead();
  assert.deepEqual([...m.lidos], ['u1']);
});

// ── V9: ↻ com o lote no ar, e o Waze recusa ───────────────────────────────────
// A fila nova veio sem os pedidos do lote (estavam em andamento), e o que o
// Waze recusou não voltava: "Tudo limpo! … Confira o país" com os pendentes
// (medido no navegador, s9).
test('V9: ↻ no meio do "Marcar todos" e o Waze recusa — o que NÃO foi marcado volta pela busca', async () => {
  const m = montar([pedido(1), pedido(2), pedido(3)], { segurar: true, falhar: true });
  m.app.openBatchReadConfirm();
  const lote = m.app.handleBatchMarkRead();
  await umTique();
  m.AppState.fetchEpoch++;                           // o ↻: a fila nova vem VAZIA (os três em andamento)
  m.AppState.queue = [];
  m.AppState.currentPlace = null;
  m.AppState.serverTotal = 0;
  m.soltar();
  await lote;
  assert.equal(m.AppState.hasMore, true, 'a fila diz que acabou: os pedidos pendentes nunca mais voltam');
  assert.ok(!m.entraram.has('v1|u1'), 'eles "já passaram pela fila": nenhuma busca os traz');
  assert.deepEqual(m.tela, ['busca'], `com a tela vazia, ninguém busca (tela: ${m.tela.join(',')})`);
  assert.deepEqual(m.AppState.queue, [], 'os do lote entraram na fila nova (de outro filtro)');
});

test('V9: CONTROLE — o lote recusado SEM ↻: os pedidos seguem na mesma fila, e nada é buscado', async () => {
  const m = montar([pedido(1), pedido(2), pedido(3)], { falhar: true });
  m.app.openBatchReadConfirm();
  await m.app.handleBatchMarkRead();
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v1', 'v2', 'v3']);
  assert.equal(m.AppState.hasMore, false);
  assert.ok(!m.tela.includes('busca'));
});
