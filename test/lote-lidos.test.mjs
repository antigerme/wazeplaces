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
// `carimboReal`: o `carimboDoGesto` e o `ondeAgora` DE VERDADE, com o país e o
// dia do filtro mudáveis por `lugar` (R6-7-4); sem ele, um carimbo neutro.
// `semSessao`/`renovando`: a sessão caiu, e a extensão está (ou não) renovando
// em silêncio (`extRenovando`) — o aviso de quem toca vem do `avisoDaTrava`.
// `duvida`: a conta desta aba em DÚVIDA (R6-1-04: outra sessão tomou o aparelho,
// e o perfil desta aba ainda não disse de quem ela é — R7-2-02).
function montar(fila, { resolvidos = [], segurar = false, seguraDepois = 0, pendentes = {}, falhar = false, carimboReal = false,
  semSessao = false, renovando = false, duvida = false } = {}) {
  const lugar = { pais: 30, dia: '2026-09-25' };
  const historicoCompleto = [];
  const lidos = new Set();
  const chamadas = [];
  const toasts = [];
  const mensagens = [];   // o TEXTO de cada aviso (a chave, pelo `t` de mentira)
  const modais = [];      // os diálogos abertos
  const historico = [];
  const log = [];
  const tela = [];
  const pousos = [];
  const mensagem = { textContent: '' };
  const AppState = { authenticated: !semSessao, queue: fila.slice(), currentPlace: fila[0], stats: { read: 0 }, serverTotal: fila.length, hasMore: false,
    pendingAction: null, inFlightActions: 0, fetchEpoch: 0, filters: { stateId: '', myArea: false },
    ...(duvida ? { contaEmDuvida: true } : {}) };
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
    closeModal: () => {}, openModal: (id) => modais.push(id),
    showToast: (m, tipo) => { toasts.push(tipo); mensagens.push(m); }, msgDoServidor: (r, d) => d,
    t: (k, v) => (v && v.n != null ? k + '#' + v.n : k),
    removeUndoBanner: () => {}, updateInFlightIndicator: () => {}, callWithRetry: (fn) => fn(),
    API: {
      getRegion: () => 'row', getCountry: () => lugar.pais,
      markAsReadBatch: async (itens) => { chamadas.push(itens.length); log.push('lote'); await portao(); return processar(itens); },
      markAsRead: async (v, u) => { chamadas.push(1); await portao(); return processar([{ venueID: v, updateRequestID: u }]); },
    },
    handleUnauthorized: () => {},
    aprovacaoDelaJaPousou: () => false,   // a aprovação de foto sem resposta (R8-2-01): aqui, nenhuma
    recordHistory: (tipo, n, dia, onde) => { historico.push([tipo, n]); historicoCompleto.push({ dia, onde }); },
    historyTodayKey: () => lugar.dia, getLang: () => 'pt',
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
    // O aviso de quem toca sem sessão (R6-2-01): o do `avisoDaTrava` de verdade,
    // que lê se a extensão está renovando (`extRenovando`, desde o R6-1-03: só
    // depois do `aguarde` da ponte).
    extRenovando: renovando,
    // A dúvida mesma, lida na hora (`contaDestaAbaEmDuvida`): segue de pé enquanto o perfil não chega.
    contaDestaAbaEmDuvida: () => duvida,
  };
  // O momento do gesto (R6-7-4): o de verdade, ou um neutro.
  if (!carimboReal) deps.carimboDoGesto = () => ({ dia: null, onde: null });
  const chaves = Object.keys(deps);
  const corpo = ['openBatchReadConfirm', 'handleBatchMarkRead', 'acoesTravadas', 'acoesTravadasForaDaJanela', 'aprovacaoDaTelaNoAr',
    'marcarEmAndamento', 'devolverPedidoRecusado', 'avisoDaTrava', ...(carimboReal ? ['ondeAgora', 'carimboDoGesto'] : [])]
    .map(fatiar).join('\n');
  app = new Function(...chaves, 'let loteDeLidosContado = null; let tratouNestaFila = false; let loteDeLidosEmVoo = false; let escritasConferindo = 0;\n' + corpo
    + '\nreturn { openBatchReadConfirm, handleBatchMarkRead, acoesTravadas };')(...chaves.map((k) => deps[k]));
  return { app, AppState, lidos, chamadas, toasts, mensagens, modais, historico, log, tela, emAndamento, pousos, entraram, mensagem,
    soltar: () => soltar(), lugar, historicoCompleto };
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
  // No um a um, cada pedido entra no Histórico quando POUSA (R10-2-03): a soma é a do placar.
  assert.ok(m.historico.every(([tipo]) => tipo === 'read'), `o lote de lidos gravou outra coisa: ${JSON.stringify(m.historico)}`);
  assert.equal(m.historico.reduce((s, [, n]) => s + n, 0), 3, 'o Histórico não contou o lote como o placar conta');
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

// ── R6-7-4: o "Marcar todos" entra no Histórico no país e no dia do GESTO ──────
// O lote anda em pedaços pela rede, e os Filtros seguem alcançáveis com ele no
// ar: lidos no fim, o país e o dia eram os de DEPOIS de um "Aplicar" — o
// Histórico creditava os lidos ao país novo (auditoria de 2026-10-01). Com o
// `carimboDoGesto` e o `ondeAgora` de verdade, e o país trocando no meio.
test('R6-7-4: trocar o país (e virar o dia) com o "Marcar todos" no ar não muda onde ele entra no Histórico', async () => {
  const m = montar([pedido(1), pedido(2), pedido(3)], { segurar: true, carimboReal: true });
  m.app.openBatchReadConfirm();
  const lote = m.app.handleBatchMarkRead();
  await umTique();
  m.lugar.pais = 73; m.lugar.dia = '2026-09-26';          // "Aplicar" a França com o lote no ar
  m.soltar();
  await lote;
  assert.deepEqual(m.historico, [['read', 3]], 'PRÉ-CONDIÇÃO: o lote pousou');
  assert.deepEqual(m.historicoCompleto, [{ dia: '2026-09-25', onde: '30' }],
    `o "Marcar todos" entrou no Histórico no país (ou no dia) de DEPOIS do "Aplicar": ${JSON.stringify(m.historicoCompleto)}`);
});

// ── R6-2-01: o "Marcar todos" SEM SESSÃO não some calado ─────────────────────
// Durante a renovação silenciosa pela extensão (até 8 s, com os Filtros
// abertos), o diálogo contava e o toque dizia "Marcando 3 como lidos…" — e nada
// saía: sem token o `api.js` devolve "sem sessão" sem ir à rede, e o
// `handleUnauthorized` volta na hora. Depois vinha "Acesso renovado… sua fila
// continua aqui" com os pedidos pendentes (MEDIDO no navegador, s38, Chromium e
// WebKit: 0 `marcar-lido`, lidos 20). A guarda é a do "Rejeitar os N", com o
// aviso do `avisoDaTrava` de verdade.
test('R6-2-01: sem sessão, o "Marcar todos" não abre o diálogo — e diz por quê (a espera da sessão na renovação)', () => {
  const m = montar([pedido(1), pedido(2), pedido(3)], { semSessao: true, renovando: true });
  m.app.openBatchReadConfirm();
  assert.deepEqual(m.modais, [], 'o diálogo abriu sem sessão: o confirmar não manda nada');
  assert.deepEqual(m.mensagens, ['toast.esperaSessao'],
    `o toque sem sessão ficou calado (ou com outro aviso): ${JSON.stringify(m.mensagens)}`);
  // Fora da renovação (sem a extensão), o aviso é a sessão expirada — o mesmo da trava do card.
  const fora = montar([pedido(1)], { semSessao: true });
  fora.app.openBatchReadConfirm();
  assert.deepEqual([fora.modais, fora.mensagens], [[], ['api.error.noSession']]);
  // CONTROLE: com a sessão viva, o diálogo abre contando os três.
  const c = montar([pedido(1), pedido(2), pedido(3)]);
  c.app.openBatchReadConfirm();
  assert.deepEqual(c.modais, ['batchReadModal']);
  assert.equal(c.mensagem.textContent, 'modal.batchRead.bodyPlural#3');
});

test('R6-2-01: a sessão cai com o diálogo ABERTO — o confirmar não diz "Marcando", não manda nada e diz por quê', async () => {
  const m = montar([pedido(1), pedido(2), pedido(3)], { renovando: true });
  m.app.openBatchReadConfirm();
  assert.deepEqual(m.modais, ['batchReadModal'], 'PRÉ-CONDIÇÃO: com a sessão viva o diálogo abriu');
  m.AppState.authenticated = false;                 // a queda, e a extensão renovando
  await m.app.handleBatchMarkRead();
  assert.deepEqual(m.chamadas, [], 'o lote foi mandado sem sessão');
  assert.ok(!m.mensagens.some((x) => /^toast\.batchMarking/.test(x)),
    `disse "Marcando…" de um lote que não sai: ${JSON.stringify(m.mensagens)}`);
  assert.deepEqual(m.mensagens, ['toast.esperaSessao'], 'o lote que não saiu ficou calado');
  assert.equal(m.AppState.stats.read, 0);
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v1', 'v2', 'v3'], 'os pedidos saíram da fila sem ser marcados');
  assert.deepEqual(m.log, [], 'o lote sem sessão chegou a despachar pendências e ligar a trava dele');
  // CONTROLE: a sessão viva no confirmar — o lote sai e conta.
  const c = montar([pedido(1), pedido(2), pedido(3)], { renovando: true });
  c.app.openBatchReadConfirm();
  await c.app.handleBatchMarkRead();
  assert.deepEqual(c.chamadas, [3]);
  assert.deepEqual(c.mensagens, ['toast.batchMarkingPlural#3', 'toast.batchDonePlural#3']);
});

// ── R7-2-02: o "Marcar todos" segue a trava do CARD com a conta em DÚVIDA ─────
// A aba sem perfil, com o aparelho tomado por OUTRA sessão (R6-1-04), trava o
// card ("espere a conferência da sessão") — e o "Marcar todos" abria, marcava a
// fila inteira com a sessão desta aba e gravava o placar e o Histórico no
// aparelho, já de OUTRA conta (MEDIDO no Chromium e no WebKit, auditoria de
// 2026-10-02). O diálogo e o envio seguem a trava do card, menos a janela do
// Desfazer (que o lote despacha), com o aviso dela.
test('R7-2-02: com a conta em DÚVIDA o "Marcar todos" não abre — e diz por quê (a espera da sessão)', () => {
  const m = montar([pedido(1), pedido(2), pedido(3)], { duvida: true });
  assert.equal(m.app.acoesTravadas(), true, 'PRÉ-CONDIÇÃO: a dúvida trava o card');
  m.app.openBatchReadConfirm();
  assert.deepEqual(m.modais, [], 'DEFEITO: o diálogo abriu com a conta em dúvida — o confirmar marcaria a fila no aparelho de outra conta');
  assert.deepEqual(m.mensagens, ['toast.esperaSessao'], `o toque ficou calado (ou com outro aviso): ${JSON.stringify(m.mensagens)}`);
  // CONTROLE: a mesma fila sem a dúvida abre o diálogo.
  const c = montar([pedido(1), pedido(2), pedido(3)]);
  c.app.openBatchReadConfirm();
  assert.deepEqual(c.modais, ['batchReadModal']);
});

test('R7-2-02: a dúvida acende com o diálogo ABERTO — o confirmar não manda nada, não conta e diz por quê', async () => {
  const d = montar([pedido(1), pedido(2), pedido(3)], { duvida: true });
  d.AppState.contaEmDuvida = false;                 // o diálogo abre ANTES de a dúvida acender
  d.app.openBatchReadConfirm();
  assert.deepEqual(d.modais, ['batchReadModal'], 'PRÉ-CONDIÇÃO: o diálogo abriu antes de a dúvida acender');
  d.AppState.contaEmDuvida = true;                  // outra sessão toma o aparelho com ele aberto
  await d.app.handleBatchMarkRead();
  assert.deepEqual(d.chamadas, [], 'DEFEITO: o lote saiu com a conta desta aba em dúvida');
  assert.equal(d.AppState.stats.read, 0, 'o placar (do aparelho de outra conta) contou o lote');
  assert.deepEqual(d.historico, [], 'o Histórico (do aparelho de outra conta) ganhou o lote');
  assert.deepEqual(d.mensagens, ['toast.esperaSessao'], `o lote que não saiu ficou calado: ${JSON.stringify(d.mensagens)}`);
  // CONTROLE: a dúvida que se desfez antes do confirmar (o perfil chegou: a MESMA conta) — o lote sai.
  const c = montar([pedido(1), pedido(2), pedido(3)], { duvida: true });
  c.AppState.contaEmDuvida = false;
  c.app.openBatchReadConfirm();
  await c.app.handleBatchMarkRead();
  assert.deepEqual(c.chamadas, [3], 'CONTROLE: sem a dúvida o lote não saiu — o teste perdeu o sentido');
});

// A trava do lote é a do card MENOS as janelas do Desfazer (que ele despacha) e
// a aprovação no ar (cujo pedido ele deixa de fora, V7): nada mais, nada menos.
// Uma função só pra cada uma, e esta confere que elas não se descolam — o que
// trava o lote trava o card.
test('R7-2-02: a trava do lote é a do card sem a janela do Desfazer — o que trava um trava o outro', () => {
  const corpo = ['acoesTravadas', 'acoesTravadasForaDaJanela', 'aprovacaoDaTelaNoAr'].map(fatiar).join('\n');
  const avaliar = (estado) => new Function('AppState', 'aprovacaoPendente', 'exclusaoPendente', 'renomeacaoPendente',
    'loteDeLidosEmVoo', 'escritasConferindo', 'contaDestaAbaEmDuvida', 'aprovacoesNoAr', 'aprovacoesDaQueda', 'chaveDoPedido',
    corpo + '\nreturn [acoesTravadas(), acoesTravadasForaDaJanela()];')(
    { authenticated: estado.sessao !== false, pendingAction: estado.janela ? {} : null, currentPlace: pedido(1),
      contaEmDuvida: !!estado.duvida, fetchEpoch: 0 },
    estado.aprovacao ? {} : null, null, null, !!estado.lote, estado.conferindo ? 1 : 0, () => !!estado.duvida,
    new Set(estado.noAr ? ['v1|u1'] : []), new Map(), (p) => p.venueID + '|' + p.updateRequestID);
  for (const [caso, estado, lote] of [
    ['sem sessão', { sessao: false }, true],
    ['o lote no ar', { lote: true }, true],
    ['a conferência de um 401', { conferindo: true }, true],
    ['a conta em dúvida', { duvida: true }, true],
    ['a janela do Desfazer (o lote a despacha)', { janela: true }, false],
    ['a janela de uma aprovação (o lote a despacha)', { aprovacao: true }, false],
    ['a aprovação no ar (o lote deixa o pedido de fora)', { noAr: true }, false],
    ['nada', {}, false],
  ]) {
    const [card, doLote] = avaliar(estado);
    assert.equal(doLote, lote, `${caso}: a trava do lote ${lote ? 'não segurou' : 'segurou'} o "Marcar todos"`);
    if (doLote) assert.equal(card, true, `${caso}: o lote travou e o card não — as duas réguas se descolaram`);
    if (caso !== 'nada') assert.equal(card, true, `CONTROLE (${caso}): o card não travou — o caso não exercita a trava`);
  }
});
