// R10-2-02 (auditoria de 2026-10-07): com o app aberto em DUAS abas da mesma
// conta, cada aba tem a sua fila de pedidos, e a decisão de uma não tirava o card
// da outra. Decidido de novo na outra aba, ele contava outra vez no placar, no
// Histórico e na "Mão firme", e dizia "Já tratado por outro editor 👍" sobre a
// decisão da própria pessoa; e, se a primeira tinha sido ✓, o ✕ da segunda era
// EXECUTADO, porque ler não resolve o pedido: o Waze recebia as duas decisões
// (MEDIDO no navegador, q07 da rodada 10, nos dois motores).
//
// A regra é a do `saida.repetida`: vale a PRIMEIRA decisão. No aviso `storage`
// da fila de saída, o que a outra aba decidiu e NÃO está na tela sai da fila
// desta (com o "Restam" e o card de fundo); o gesto no card que está NA TELA é
// descontado e não sai, com uma frase; e a decisão desta que estava na janela do
// Desfazer quando a de lá chegou também não sai.
//
// Os testes RODAM o código de verdade, fatiado do app.js — o ouvinte do aviso,
// a anotação, a retirada, os três handlers, a anotação antes do envio e o
// `enfileirarSaida` —, num escopo só, com a tela e a rede de mentira. Cada um tem
// o CONTROLE sem a decisão da outra aba (o mesmo gesto conta e sai), e foi visto
// REPROVANDO com o conserto desfeito (sabotagem no relatório do lote 14).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fechar(txt, i) {
  let prof = 0;
  for (let j = txt.indexOf('{', i); j < txt.length; j++) {
    if (txt[j] === '{') prof++;
    else if (txt[j] === '}') { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
// O OUVINTE de verdade do aviso da fila de saída (o `setupGuardaDoDiagnostico`
// o registra): é por ele que o teste entrega o aviso, e não chamando as funções
// à mão — senão tirar a retirada do ouvinte passaria com tudo verde.
const OUVINTE = (() => {
  const m = /window\.addEventListener\('storage', (\(ev\) => \{ if \(ev\.key === SAIDA_KEY\)[^\n]*\})\);/.exec(fatiar('setupGuardaDoDiagnostico'));
  assert.ok(m, 'o ouvinte do aviso da fila de saída sumiu do setupGuardaDoDiagnostico');
  return m[1];
})();

const NOMES = ['chaveDoPedido', 'filaReal', 'filaRealComDevolvidos', 'anotarDecididosPorOutraAba',
  'tirarDaFilaOQueAOutraAbaDecidiu', 'gestoNoDecididoPorOutraAba', 'avisarDecididoNaOutraAba',
  'carregarFilaDeSaida', 'salvarFilaDeSaida', 'enfileirarSaida', 'anotarAntesDoEnvio',
  'handleReject', 'handleMarkAsRead', 'handleSkip'];

const P = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, creatorId: 700 + i, createdBy: 'autor' + i });
const item = (p) => ({ tipo: 'reject', venueID: p.venueID, updateRequestID: p.updateRequestID });
const SAIDA_KEY = 'waze_places_saida';
const aviso = (antes, depois) => ({ key: SAIDA_KEY, oldValue: JSON.stringify(antes), newValue: JSON.stringify(depois) });
const ids = (fila) => (fila || []).map((p) => p.updateRequestID);

// A aba B, com a fila `fila` (o da frente na tela) e o aparelho de mentira.
function abaB({ fila, treino = null } = {}) {
  const aparelho = new Map();
  const log = [], toasts = [], rede = [], agendadas = [], diario = [];
  const AppState = { queue: fila.slice(), currentPlace: fila[0] || null, serverTotal: fila.length,
    stats: { read: 5, rejected: 5, skipped: 5 }, preferences: { pularGuarda: false }, pendingAction: null, fetchEpoch: 0 };
  if (treino) {
    // O treino ABERTO: a tela tem os exemplos, e a fila real fica guardada nele.
    treino._salvo.queue = AppState.queue;
    treino._salvo.currentPlace = AppState.currentPlace;
    AppState.queue = [{ venueID: 'treino1', updateRequestID: 'treino-inerte', _treino: true }];
    AppState.currentPlace = AppState.queue[0];
  }
  const deps = {
    AppState, Treino: treino || { ativo: false, _salvo: null },
    safeLS: { get: (k) => (aparelho.has(k) ? aparelho.get(k) : null), set: (k, v) => aparelho.set(k, String(v)),
      remove: (k) => aparelho.delete(k) },
    SAIDA_KEY, SAIDA_MAX: 1000,
    dfato: (k, d) => diario.push({ k, ...(d || {}) }),
    showToast: (m) => toasts.push(m), t: (k) => k,
    updatePendingCount: () => log.push('restam'), aoMudarAFilaPorBaixo: () => log.push('fundo'),
    advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; log.push('avancou'); },
    acoesTravadas: () => false, direcaoTravada: () => false,
    updateStats: () => {}, saveStats: () => log.push('saveStats'), updateInFlightIndicator: () => {},
    API: {
      getRegion: () => 'row', getSession: () => 'tok-B',
      rejectPlace: async (v) => { rede.push('reject:' + v); return { success: true }; },
      markAsRead: async (v) => { rede.push('read:' + v); return { success: true }; },
      guardarPedido: async (v) => { rede.push('estrela:' + v); return { success: true }; },
    },
    paisDaFila: () => 30, carimboDoGesto: () => ({ t: 1, dia: '2026-10-07', onde: '30', lang: 'pt' }),
    scheduleAction: (tipo, place, executor) => agendadas.push({ tipo, place, executor }),
    presencaWmeDaAcao: () => null, presencaWmeAoResponder: () => {},
    callWithRetry: (fn) => fn(), decisaoDepoisDaQueda: () => {},
    handleActionResult: (tipo, place) => log.push('pousou:' + tipo + ':' + place.updateRequestID),
    reivindicacaoDestaAba: () => ({ rv: 'aba-B', rvEm: 1 }),
    historyTodayKey: () => '2026-10-07', ondeAgora: () => '30', getLang: () => 'pt', contaAgora: () => '4242',
    marcaDaSessao: () => 'm', marcaDestaAba: () => 'm',   // a sessão do gesto, a da memória (R13-1-04)
    estreladoPeloApp: () => false, anotarEstreladoPeloApp: () => true,
    refazerDepoisDo401: async () => null, msgDoServidor: () => '', contarConquista: () => {},
  };
  const chaves = Object.keys(deps);
  const fonte = [
    'let tratouNestaFila = false, epocaDaSessao = 0;',
    'const decididosPorOutraAbaComCardAqui = new WeakSet(), pedidosEmAndamento = new Set(),'
      + ' descargaNaFila = new WeakSet(), anotadoAntesDoEnvio = new WeakSet();',
    ...NOMES.map(fatiar),
    `const aoAvisoDaSaida = ${OUVINTE};`,
    `return { ${NOMES.join(', ')}, aoAvisoDaSaida, tratou: () => tratouNestaFila, marcado: (p) => decididosPorOutraAbaComCardAqui.has(p),
      emAndamento: pedidosEmAndamento };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  return { app, AppState, aparelho, log, toasts, rede, agendadas, diario };
}

// ═══ o que a outra aba decidiu e NÃO está na tela sai da fila desta ═══════════
test('R10-2-02: o que a OUTRA aba decidiu e não está na tela sai da fila desta — com o "Restam" e o card de fundo', () => {
  const fila = [0, 1, 2, 3, 4].map(P);
  const b = abaB({ fila });
  // A aba A decide (o ✕/✓ é anotado na fila de saída ANTES do envio) o 2º e o 3º da fila.
  b.app.aoAvisoDaSaida(aviso([], [item(fila[1]), item(fila[2])]));
  assert.deepEqual(ids(b.AppState.queue), ['u0', 'u3', 'u4'],
    `DEFEITO: o que a outra aba decidiu seguiu na fila desta: ${ids(b.AppState.queue)}`);
  assert.equal(b.AppState.serverTotal, 3, 'o "Restam" não desceu pelo que saiu da fila');
  assert.ok(b.log.includes('restam') && b.log.includes('fundo'), `o "Restam" e o card de fundo não foram redesenhados: ${b.log}`);
  // E o da FRENTE, que a outra aba decidiu: fica na tela (anotado) — trocar o card
  // debaixo do dedo é pior que um gesto a mais.
  b.app.aoAvisoDaSaida(aviso([item(fila[1]), item(fila[2])], [item(fila[1]), item(fila[2]), item(fila[0])]));
  assert.equal(b.AppState.currentPlace, fila[0], 'o card da TELA foi trocado debaixo do dedo');
  assert.deepEqual(ids(b.AppState.queue), ['u0', 'u3', 'u4']);
  assert.equal(b.AppState.serverTotal, 3);
  assert.equal(b.app.marcado(fila[0]), true, 'o card da tela que a outra aba decidiu não ficou anotado');
});

test('R10-2-02: CONTROLE — o aviso sem decisão NOVA não tira nada, e o que esta aba tem no AR fica', () => {
  const fila = [0, 1, 2, 3].map(P);
  const b = abaB({ fila });
  // A outra aba só mexeu num item que já estava lá (soltou a marca dela, mandou pro fim).
  b.app.aoAvisoDaSaida(aviso([item(fila[2])], [{ ...item(fila[2]), rv: 'aba-A' }]));
  assert.deepEqual(ids(b.AppState.queue), ['u0', 'u1', 'u2', 'u3'], 'um aviso sem decisão nova tirou pedido da fila');
  assert.equal(b.AppState.serverTotal, 4);
  // O pedido EM ANDAMENTO aqui (o "Marcar todos" no ar o mantém na fila até a
  // resposta): é de quem o está mandando.
  b.app.emAndamento.add('v3|u3');
  b.app.aoAvisoDaSaida(aviso([], [item(fila[3])]));
  assert.deepEqual(ids(b.AppState.queue), ['u0', 'u1', 'u2', 'u3'], 'o pedido em andamento saiu da fila por baixo de quem o manda');
});

// ═══ o gesto no card NA TELA que a outra aba decidiu ══════════════════════════
for (const [handler, tipo, campo] of [['handleReject', 'reject', 'rejected'], ['handleMarkAsRead', 'read', 'read'], ['handleSkip', 'skip', 'skipped']]) {
  test(`R10-2-02: o ${tipo} no card NA TELA que a outra aba decidiu não sai, não conta, e diz por quê`, async () => {
    const fila = [0, 1, 2].map(P);
    const b = abaB({ fila });
    // A outra aba decide o da frente — e a decisão dela POUSA e sai da fila de saída.
    b.app.aoAvisoDaSaida(aviso([], [item(fila[0])]));
    b.app.aoAvisoDaSaida(aviso([item(fila[0])], []));
    b.app[handler]();
    for (const a of b.agendadas) await a.executor();
    assert.deepEqual(b.rede, [], `DEFEITO: o ${tipo} da aba B saiu pro Waze sobre a decisão da outra: ${b.rede}`);
    assert.equal(b.agendadas.length, 0, 'o gesto foi agendado (janela do Desfazer) sobre um pedido já decidido');
    assert.equal(b.AppState.stats[campo], 5, `DEFEITO: o ${tipo} contou de novo no placar`);
    assert.deepEqual(b.toasts, ['toast.decididoNaOutraAba'], `o aviso não diz que foi a outra aba: ${JSON.stringify(b.toasts)}`);
    assert.deepEqual(ids(b.AppState.queue), ['u1', 'u2'], 'o card não saiu da tela');
    assert.equal(b.AppState.serverTotal, 2, 'o "Restam" não desceu');
    assert.equal(b.app.tratou(), true, 'a fila que termina assim diria "confira o país e a região"');
    assert.deepEqual(b.diario.filter((e) => e.k === 'saida.repetida').map((e) => [e.tipo, e.outraAba]), [[tipo, true]],
      'o diário não diz que foi a OUTRA aba');
    assert.equal(b.aparelho.get(SAIDA_KEY), undefined, 'o gesto descontado foi anotado na fila de saída');
    // CONTROLE: o MESMO gesto sem a decisão da outra aba conta e é agendado.
    const c = abaB({ fila });
    c.app[handler]();
    assert.equal(c.AppState.stats[campo], 6, `CONTROLE: o ${tipo} deixou de contar`);
    assert.equal(c.agendadas.length, 1, `CONTROLE: o ${tipo} deixou de ser agendado`);
    assert.deepEqual(c.toasts, []);
  });
}

// ═══ a decisão que estava na janela do Desfazer quando a da outra chegou ══════
test('R10-2-02: o ✕ na janela do Desfazer quando a outra aba decide o MESMO pedido não sai — nem depois de a dela pousar', async () => {
  const fila = [0, 1].map(P);
  const b = abaB({ fila });
  b.app.handleReject();                                // o ✕ da B, com a janela do Desfazer
  assert.equal(b.agendadas.length, 1, 'PRÉ-CONDIÇÃO: o ✕ não foi agendado');
  assert.equal(b.AppState.stats.rejected, 6, 'PRÉ-CONDIÇÃO: o ✕ não contou no gesto');
  b.AppState.pendingAction = { type: 'reject', place: b.agendadas[0].place };
  // Na janela, a outra aba decide o mesmo pedido (✓, digamos), e a dela pousa.
  b.app.aoAvisoDaSaida(aviso([], [item(fila[0])]));
  b.app.aoAvisoDaSaida(aviso([item(fila[0])], []));
  b.AppState.pendingAction = null;                     // a janela vence
  await b.agendadas[0].executor();
  assert.deepEqual(b.rede, [], `DEFEITO: o ✕ da janela saiu depois de a decisão da outra aba pousar: ${b.rede}`);
  assert.equal(b.AppState.stats.rejected, 5, 'o ✕ descartado seguiu no placar');
  assert.deepEqual(b.toasts, ['toast.decididoNaOutraAba'], `o descarte foi calado: ${JSON.stringify(b.toasts)}`);
  assert.equal(b.aparelho.get(SAIDA_KEY), undefined, 'o ✕ descartado ficou na fila de saída (sairia no esvaziamento)');
  // CONTROLE: sem a decisão da outra aba, a janela vence e o ✕ sai.
  const c = abaB({ fila });
  c.app.handleReject();
  await c.agendadas[0].executor();
  assert.deepEqual(c.rede, ['reject:v0'], 'CONTROLE: o ✕ da janela deixou de sair');
  assert.equal(c.AppState.stats.rejected, 6);
});

// ═══ o lote do autor e a descarga: o `enfileirarSaida` ════════════════════════
test('R10-2-02: o pedido que a outra aba decidiu é "repetida" na anotação — o lote do autor e a descarga não o mandam', () => {
  const fila = [0, 1, 2].map(P);
  const b = abaB({ fila });
  b.app.aoAvisoDaSaida(aviso([], [item(fila[0])]));
  b.app.aoAvisoDaSaida(aviso([item(fila[0])], []));     // pousou lá e saiu da fila de saída
  const lista = [];
  assert.equal(b.app.enfileirarSaida('reject', fila[0], 'row', {}, true, lista), 'repetida',
    'DEFEITO: o pedido que a outra aba decidiu (já pousado) entrou de novo na fila de saída');
  assert.deepEqual(lista, []);
  assert.equal(b.diario.filter((e) => e.k === 'saida.repetida' && e.outraAba === true).length, 1);
  // CONTROLE: o pedido que ninguém decidiu é anotado.
  assert.equal(b.app.enfileirarSaida('reject', fila[1], 'row', {}, true, lista), true);
  assert.deepEqual(lista.map((x) => x.updateRequestID), ['u1']);
});

// ═══ com o TREINO aberto: a fila REAL guardada nele ════════════════════════════
test('R10-2-02: com o treino aberto, o que a outra aba decidiu sai da fila REAL guardada nele — e do que volta no "Sair"', () => {
  const fila = [0, 1, 2, 3].map(P);
  const recusado = P(9);                                // o recusado de vez que volta no `sair()`
  const treino = { ativo: true, _salvo: { devolver: [recusado] } };
  const b = abaB({ fila, treino });
  const exemplos = b.AppState.queue;
  b.app.aoAvisoDaSaida(aviso([], [item(fila[2]), item(recusado), item(fila[0])]));
  assert.deepEqual(ids(treino._salvo.queue), ['u0', 'u1', 'u3'],
    `DEFEITO: com o treino aberto, o que a outra aba decidiu seguiu na fila real: ${ids(treino._salvo.queue)}`);
  assert.deepEqual(ids(treino._salvo.devolver), [], 'o recusado que a outra aba decidiu ainda voltaria no "Sair" do treino');
  assert.equal(b.AppState.serverTotal, 3, 'o "Restam" real não desceu (só pelo que estava na fila; o devolvido ainda não contava)');
  assert.equal(b.AppState.queue, exemplos, 'a fila de EXEMPLOS foi mexida');
  assert.ok(!b.log.includes('fundo'), 'o card de fundo do TREINO foi refeito com a fila real');
  assert.equal(b.app.marcado(fila[0]), true, 'o card real da frente (que volta no "Sair") não ficou anotado');
});
