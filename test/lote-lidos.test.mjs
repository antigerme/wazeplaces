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
// `pendentes`: as ações de foto na janela do Desfazer ({ aprovacao, exclusao, renomeacao }).
function montar(fila, { resolvidos = [], segurar = false, pendentes = {}, falhar = false } = {}) {
  const lidos = new Set();
  const chamadas = [];
  const toasts = [];
  const historico = [];
  const log = [];
  const AppState = { queue: fila.slice(), currentPlace: fila[0], stats: { read: 0 }, serverTotal: fila.length, hasMore: false,
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
  const portao = segurar ? new Promise((ok) => { soltar = ok; }) : Promise.resolve();
  const pendente = (nome) => (pendentes[nome] ? { enviar: () => log.push(nome) } : null);
  let app = null;
  const emAndamento = new Set();
  const deps = {
    // A constante DO APP, lida do fonte: fixar 25 aqui deixaria a sabotagem da
    // constante passar (o harness não a enxergaria).
    AppState, Treino: { ativo: false }, epocaDaSessao: 0,
    LOTE_LIDOS_PEDACO: Number(/^const LOTE_LIDOS_PEDACO = (\d+);/m.exec(APP_SEM)[1]),
    chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID,
    closeModal: () => {}, openModal: () => {}, showToast: (m, tipo) => toasts.push(tipo), t: (k) => k, msgDoServidor: (r, d) => d,
    removeUndoBanner: () => {}, updateInFlightIndicator: () => {}, callWithRetry: (fn) => fn(),
    API: {
      getRegion: () => 'row',
      markAsReadBatch: async (itens) => { chamadas.push(itens.length); log.push('lote'); await portao; return processar(itens); },
      markAsRead: async (v, u) => { chamadas.push(1); await portao; return processar([{ venueID: v, updateRequestID: u }]); },
    },
    handleUnauthorized: () => {}, registrarPouso: () => {}, recordHistory: (tipo, n) => historico.push([tipo, n]),
    registrarLoteConfirmado: () => {}, updateStats: () => {}, saveStats: () => {}, removeCurrentCardEl: () => {},
    showCurrentPlace: () => {}, startFetching: () => {}, showNoPlaces: () => {}, updatePendingCount: () => {},
    document: { getElementById: () => null },
    pedidosEmAndamento: emAndamento,
    aplicarTravaDeAcao: () => log.push('trava:' + app.acoesTravadas()),
    aprovacaoPendente: pendente('aprovacao'), exclusaoPendente: pendente('exclusao'), renomeacaoPendente: pendente('renomeacao'),
  };
  const chaves = Object.keys(deps);
  const corpo = ['openBatchReadConfirm', 'handleBatchMarkRead', 'acoesTravadas', 'marcarEmAndamento'].map(fatiar).join('\n');
  app = new Function(...chaves, 'let loteDeLidosContado = null; let tratouNestaFila = false; let loteDeLidosEmVoo = false;\n' + corpo
    + '\nreturn { openBatchReadConfirm, handleBatchMarkRead, acoesTravadas };')(...chaves.map((k) => deps[k]));
  return { app, AppState, lidos, chamadas, toasts, historico, log, emAndamento, soltar: () => soltar() };
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
