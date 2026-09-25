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
function montar(fila, { resolvidos = [] } = {}) {
  const lidos = new Set();
  const chamadas = [];
  const toasts = [];
  const historico = [];
  const AppState = { queue: fila.slice(), currentPlace: fila[0], stats: { read: 0 }, serverTotal: fila.length, hasMore: false,
    pendingAction: null, inFlightActions: 0 };
  const processar = (itens) => {
    for (const it of itens) {
      if (resolvidos.includes(it.updateRequestID)) return { success: false, errorCategory: 'already_processed', httpCode: 500 };
      lidos.add(it.updateRequestID);
    }
    return { success: true };
  };
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
      markAsReadBatch: async (itens) => { chamadas.push(itens.length); return processar(itens); },
      markAsRead: async (v, u) => { chamadas.push(1); return processar([{ venueID: v, updateRequestID: u }]); },
    },
    handleUnauthorized: () => {}, registrarPouso: () => {}, recordHistory: (tipo, n) => historico.push([tipo, n]),
    registrarLoteConfirmado: () => {}, updateStats: () => {}, saveStats: () => {}, removeCurrentCardEl: () => {},
    showCurrentPlace: () => {}, startFetching: () => {}, showNoPlaces: () => {}, updatePendingCount: () => {},
    document: { getElementById: () => null },
  };
  const chaves = Object.keys(deps);
  const corpo = fatiar('openBatchReadConfirm') + '\n' + fatiar('handleBatchMarkRead');
  const app = new Function(...chaves, 'let loteDeLidosContado = null; let tratouNestaFila = false;\n' + corpo
    + '\nreturn { openBatchReadConfirm, handleBatchMarkRead };')(...chaves.map((k) => deps[k]));
  return { app, AppState, lidos, chamadas, toasts, historico };
}

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
