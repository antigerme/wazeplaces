// O ✓ num card que o Waze JÁ diz lido (`isRead`, a faixa "já lido", que só existe
// com "Apenas pedidos não lidos" desmarcado) não manda nada ao Waze e não conta.
//
// Antes, o `handleMarkAsRead` não olhava o `isRead`: o gesto mandava o
// `Issues/Read` de novo e somava no placar, no Histórico e nas conquistas uma
// leitura que não aconteceu agora (o "Marcar todos" já deixava os já lidos de
// fora, R10-2-04; só o gesto individual ficou sem a guarda). Agora o ✓ aí só
// PASSA pro próximo card: sem rede, sem fila de saída, sem placar, sem janela do
// Desfazer, sem aviso (a faixa do card já disse), e o "Restam" não desce (o
// pedido segue pendente no Waze, como no Pular). O ✕ e o ↑ seguem valendo.
//
// Os testes RODAM o `handleMarkAsRead`/`handleReject`/`handleSkip` de verdade,
// fatiados do app.js, com a tela e a rede de mentira. Cada caso tem o CONTROLE
// (o mesmo gesto num card NÃO lido conta e sai), e o guard foi visto REPROVANDO
// com a guarda removida.
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

const NOMES = ['chaveDoPedido', 'filaReal', 'filaRealComDevolvidos', 'gestoNoDecididoPorOutraAba', 'avisarDecididoNaOutraAba',
  'carregarFilaDeSaida', 'salvarFilaDeSaida', 'salvarFilaSemOs', 'chaveDoItemDaSaida', 'enfileirarSaida', 'anotarAntesDoEnvio',
  'handleReject', 'handleMarkAsRead', 'handleSkip'];
const SAIDA_KEY = 'waze_places_saida';
const P = (i, extra = {}) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, creatorId: 700 + i, createdBy: 'autor' + i, ...extra });
const ids = (fila) => (fila || []).map((p) => p.updateRequestID);

function aba({ fila, treino = null, travadas = false } = {}) {
  const aparelho = new Map();
  const log = [], toasts = [], rede = [], agendadas = [], diario = [];
  const AppState = { queue: fila.slice(), currentPlace: fila[0] || null, serverTotal: fila.length,
    stats: { read: 5, rejected: 5, skipped: 5 }, preferences: { pularGuarda: false }, pendingAction: null, fetchEpoch: 0 };
  if (treino) {
    treino._salvo.queue = AppState.queue;
    treino._salvo.currentPlace = AppState.currentPlace;
    AppState.queue = [{ venueID: 'treino1', updateRequestID: 'treino-inerte', _treino: true, isRead: true }];
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
    acoesTravadas: () => travadas, direcaoTravada: () => false,
    updateStats: () => log.push('updateStats'), saveStats: () => log.push('saveStats'), updateInFlightIndicator: () => {},
    API: {
      getRegion: () => 'row', getSession: () => 'tok',
      rejectPlace: async (v) => { rede.push('reject:' + v); return { success: true }; },
      markAsRead: async (v) => { rede.push('read:' + v); return { success: true }; },
      guardarPedido: async (v) => { rede.push('estrela:' + v); return { success: true }; },
    },
    paisDaFila: () => 30, carimboDoGesto: () => ({ t: 1, dia: '2026-11-15', onde: '30', lang: 'pt' }),
    scheduleAction: (tipo, place, executor) => agendadas.push({ tipo, place, executor }),
    presencaWmeDaAcao: () => null, presencaWmeAoResponder: () => {},
    callWithRetry: (fn) => fn(), decisaoDepoisDaQueda: () => {},
    handleActionResult: (tipo, place) => log.push('pousou:' + tipo + ':' + place.updateRequestID),
    reivindicacaoDestaAba: () => ({ rv: 'aba', rvEm: 1 }),
    historyTodayKey: () => '2026-11-15', ondeAgora: () => '30', getLang: () => 'pt', contaAgora: () => '4242',
    marcaDaSessao: () => 'm', marcaDestaAba: () => 'm',
    estreladoPeloApp: () => false, anotarEstreladoPeloApp: () => true,
    refazerDepoisDo401: async () => null, msgDoServidor: () => '', contarConquista: () => {},
  };
  const chaves = Object.keys(deps);
  const fonte = [
    'let tratouNestaFila = false, epocaDaSessao = 0;',
    'const saidaTiradosSemGravar = new Map(); const decididosPorOutraAbaComCardAqui = new WeakSet(), pedidosEmAndamento = new Set(),'
      + ' descargaNaFila = new WeakSet(), anotadoAntesDoEnvio = new WeakSet();',
    ...NOMES.map(fatiar),
    `return { ${NOMES.join(', ')}, tratou: () => tratouNestaFila, emAndamento: pedidosEmAndamento };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  return { app, AppState, aparelho, log, toasts, rede, agendadas, diario };
}

test('o ✓ no card já lido só passa pro próximo: sem rede, sem placar, sem janela, sem aviso, sem "Restam"', async () => {
  const fila = [P(0, { isRead: true }), P(1), P(2)];
  const b = aba({ fila });
  b.app.handleMarkAsRead();
  for (const a of b.agendadas) await a.executor();
  assert.deepEqual(b.rede, [], `DEFEITO: o ✓ no já lido mandou o Issues/Read de novo: ${b.rede}`);
  assert.equal(b.agendadas.length, 0, 'o ✓ no já lido abriu a janela do Desfazer (não há o que desfazer)');
  assert.equal(b.AppState.stats.read, 5, 'DEFEITO: o ✓ no já lido contou no placar');
  assert.equal(b.AppState.serverTotal, 3, 'o "Restam" desceu, e o pedido segue pendente no Waze');
  assert.deepEqual(ids(b.AppState.queue), ['u1', 'u2'], 'o card não passou pro próximo');
  assert.deepEqual(b.toasts, [], `o ✓ no já lido avisou (a faixa do card já diz): ${JSON.stringify(b.toasts)}`);
  assert.equal(b.app.tratou(), false, 'a fila não foi tratada: a frase do "Tudo limpo!" mentiria');
  assert.equal(b.aparelho.get(SAIDA_KEY), undefined, 'o ✓ no já lido foi anotado na fila de saída');
  assert.equal(b.app.emAndamento.size, 0, 'o já lido ficou "em andamento" (a busca não o traria de volta)');
  assert.equal(b.log.filter((e) => e === 'saveStats').length, 0, 'gravou o placar sem ter o que gravar');
  // CONTROLE: o MESMO gesto num card NÃO lido conta, desce o "Restam" e é agendado.
  const c = aba({ fila: [P(0), P(1), P(2)] });
  c.app.handleMarkAsRead();
  assert.equal(c.AppState.stats.read, 6, 'CONTROLE: o ✓ deixou de contar');
  assert.equal(c.AppState.serverTotal, 2, 'CONTROLE: o "Restam" deixou de descer');
  assert.equal(c.agendadas.length, 1, 'CONTROLE: o ✓ deixou de ser agendado');
});

test('a guarda é ESTRITA: só `isRead === true` passa direto (texto, número e ausência seguem o caminho normal)', () => {
  for (const valor of [false, undefined, null, 'true', 1, 'sim']) {
    const b = aba({ fila: [P(0, { isRead: valor }), P(1)] });
    b.app.handleMarkAsRead();
    assert.equal(b.AppState.stats.read, 6, `isRead=${JSON.stringify(valor)} foi tratado como já lido`);
    assert.equal(b.agendadas.length, 1, `isRead=${JSON.stringify(valor)} não foi agendado`);
  }
});

test('o ✕ e o ↑ no card já lido seguem valendo (rejeitar um já lido é uso legítimo)', async () => {
  const b = aba({ fila: [P(0, { isRead: true }), P(1), P(2)] });
  b.app.handleReject();
  assert.equal(b.AppState.stats.rejected, 6, 'o ✕ no já lido deixou de contar');
  assert.equal(b.agendadas.length, 1, 'o ✕ no já lido deixou de ser agendado');
  assert.equal(b.agendadas[0].tipo, 'reject');
  const c = aba({ fila: [P(0, { isRead: true }), P(1), P(2)] });
  c.app.handleSkip();
  assert.equal(c.AppState.stats.skipped, 6, 'o ↑ no já lido deixou de contar');
  assert.equal(c.agendadas.length, 1, 'o ↑ no já lido deixou de ser agendado');
});

test('as guardas de antes mandam: trava, treino e card sem pedido não deixam o ✓ no já lido avançar a fila', () => {
  // Trava (a janela do Desfazer de OUTRA decisão, o lote no ar…): o card fica.
  const a = aba({ fila: [P(0, { isRead: true }), P(1)], travadas: true });
  a.app.handleMarkAsRead();
  assert.deepEqual(ids(a.AppState.queue), ['u0', 'u1'], 'o ✓ avançou a fila com as ações travadas');
  assert.equal(a.log.includes('avancou'), false);
  // Treino: o card de treino (até com isRead) vai pelo Treino.agir, nunca pelo atalho do já lido.
  const agiu = [];
  const treino = { ativo: true, _salvo: { queue: null, currentPlace: null }, agir: (x) => agiu.push(x) };
  const t = aba({ fila: [P(0), P(1)], treino });
  t.app.handleMarkAsRead();
  assert.deepEqual(agiu, ['read'], 'o treino deixou de ser o dono do gesto');
  assert.equal(t.log.includes('avancou'), false, 'o atalho do já lido avançou a fila de dentro do treino');
  // Sem card na tela: nada acontece (não lança).
  const v = aba({ fila: [] });
  assert.doesNotThrow(() => v.app.handleMarkAsRead());
});

test('estrutura: a guarda do já lido vem DEPOIS das guardas do gesto e ANTES de qualquer contagem', () => {
  const corpo = fatiar('handleMarkAsRead');
  const pos = (re) => { const m = re.exec(corpo); assert.ok(m, `sumiu do handleMarkAsRead: ${re}`); return m.index; };
  const guarda = pos(/if \(place\.isRead === true\) \{/);
  assert.ok(pos(/Treino\.agir\('read'\)/) < guarda, 'o treino precisa decidir ANTES do atalho do já lido');
  assert.ok(pos(/gestoNoDecididoPorOutraAba\('read'\)/) < guarda, 'a decisão da outra aba precisa vir ANTES do atalho');
  assert.ok(pos(/acoesTravadas\(\)/) < guarda, 'a trava precisa vir ANTES do atalho');
  assert.ok(guarda < pos(/AppState\.stats\.read\+\+/), 'o atalho vem DEPOIS de contar: o já lido contaria');
  assert.ok(guarda < pos(/tratouNestaFila = true/), 'o atalho vem DEPOIS de marcar a fila como tratada');
  assert.ok(guarda < pos(/scheduleAction\('read'/), 'o atalho vem DEPOIS de agendar a decisão');
  // E o atalho só passa a fila: `advanceQueue()` e `return`, sem rede nem placar.
  const bloco = corpo.slice(guarda, fechar(corpo, guarda));
  assert.match(bloco, /advanceQueue\(\);\s*return;\s*\}$/, 'o atalho do já lido deixou de só avançar a fila');
  assert.doesNotMatch(bloco, /API\.|stats|serverTotal|saveStats|showToast/, 'o atalho do já lido mexe em rede, placar ou aviso');
});
