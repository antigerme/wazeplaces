// F3 (auditoria da fila, 2026-09-26): a decisão que o Waze RECUSA de vez
// (`unknown`) deixa o pedido PENDENTE lá — e ele tem que voltar a ser card.
//
// Antes o placar voltava ("Rejeitados" −1, "Restam" +1) e o pedido SUMIA: ele
// já tinha passado pela fila (`pedidosQueEntraramNaFila`), então nenhuma busca o
// trazia de volta, e o fim da fila dizia "Tudo limpo!", com a conquista, sobre
// um pedido pendente — MEDIDO no navegador: "Restam 1" com o painel de festa na
// tela. Os testes RODAM o `handleActionResult`, o pouso da fila de saída e a
// busca de verdade, fatiados do app.js. Cada um foi visto REPROVANDO com o
// conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function achar(nome) {
  return new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
}
function fatiar(nome) {
  const m = achar(nome);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  i = APP_SEM.indexOf('{', i);
  let prof = 0, fim = APP_SEM.length;
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fim);
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function('return (' + m[1] + ');')();
};
const pedido = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 100 + i, createdBy: 'autor' + i });
const chave = (p) => p.venueID + '|' + p.updateRequestID;
const RECUSA = { success: false, errorCategory: 'unknown', errorKey: 'srv.err.wazeGeneric', httpCode: 406 };

// O app: a resposta da ação, o pouso da fila de saída, o "Tudo limpo" e a
// busca de verdade. O Waze de mentira devolve os pedidos que seguem pendentes.
function montar({ fila = [], naTela = true, pendentesNoWaze = [], painel = false } = {}) {
  const guardado = new Map();
  const log = [];
  const painelClasses = new Set(painel ? [] : ['hidden']);
  const AppState = {
    authenticated: true, hasMore: false, fetching: false, fetchEpoch: 3, queue: fila.slice(),
    currentPlace: naTela ? fila[0] || null : null, serverTotal: fila.length, serverBlocked: 0, blockedPartial: false,
    loadError: false, ultimaBusca: null, ordemPendente: false, pendingAction: null, inFlightActions: 0,
    stats: { read: 0, rejected: 5, skipped: 0 },
    filters: { unreadOnly: true, types: constante('TYPES_ALL').slice(), residential: '', myArea: false, stateId: '',
      managedAreaId: '', categories: [], sortOrder: 'newest' },
    profile: null,
  };
  const waze = { pedidas: 0, async buscar() {
    waze.pedidas++;
    return { success: true, places: pendentesNoWaze.map((p) => ({ ...p })), hasMore: false, total: pendentesNoWaze.length, blocked: 0 };
  } };
  const deps = {
    AppState, TYPES_ALL: constante('TYPES_ALL'), PREFETCH_THRESHOLD: constante('PREFETCH_THRESHOLD'),
    MAX_EMPTY_PAGES: constante('MAX_EMPTY_PAGES'), MAX_PAGINAS_POR_BUSCA: constante('MAX_PAGINAS_POR_BUSCA'),
    navigator: { onLine: true }, Treino: { ativo: false },
    safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) },
    SAIDA_KEY: 'waze_places_saida', SAIDA_MAX: 1000,
    API: { getRegion: () => 'row', getSession: () => 'tok', fetchPlaces: (page, f) => waze.buscar(page, f) },
    dlog: () => {}, dfato: () => {}, dlogVigiar: () => {}, dlogVoltou: () => {}, dlogCapturarAuto: () => {},
    registrarPouso: () => log.push('pouso'), recordHistory: () => {}, registrarRejeicaoDeAutor: () => {},
    avisarConsequencia: () => {}, registrarAcaoConfirmada: () => log.push('confirmada'),
    showToast: (m, tipo) => log.push('toast:' + tipo), msgDoServidor: (r, d) => d, t: (k) => k,
    handleUnauthorized: () => log.push('confere'),
    updateStats: () => {}, saveStats: () => {}, updateInFlightIndicator: () => {},
    updatePendingCount: () => log.push('restam:' + AppState.serverTotal),
    aoMudarAFilaPorBaixo: () => log.push('fundo:' + (AppState.queue[1] ? chave(AppState.queue[1]) : '-')),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; painelClasses.add('hidden'); log.push('card'); },
    startFetching: () => log.push('busca'),
    historyTodayKey: () => '2026-09-26', ondeAgora: () => '30', contaAgora: () => null, marcaDaSessao: () => 'marca',
    guardarPrazoDaSessao: () => {}, offlineGravarFila: () => {}, trackSeenCategories: () => {}, sortQueue: () => {},
    aplicarRecusaAutomatica: () => {}, offlineVarrer: () => {}, offlineLigado: () => false, offlineLerPousos: () => [],
    bloqueadosPorPagina: new Map(), pedidosQueEntraramNaFila: new Set(fila.map(chave)), pousosDaPagina: new Map(),
    pedidosEmAndamento: new Set(), console: { error: () => {} }, lugarAgora: () => ({ regiao: 'row', pais: '30' }),
    document: { getElementById: (id) => (id === 'noMoreCards' ? { classList: { contains: (c) => painelClasses.has(c) } } : null) },
    ORDEM_PADRAO: 'newest', refazerPerfilSeFaltar: () => {},
  };
  const nomes = ['chaveDoPedido', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'enfileirarSaida', 'tirarDaFilaDeSaida',
    'marcarNaSaida', 'handleActionResult', 'registrarPousoDeSaida', 'semOsJaDecididos', 'registrarEntradaNaFila',
    'semOsQueJaPassaramPelaFila', 'fetchNextPage', 'puladosNestaFila', 'filaZeradaConfirmada', 'ordemDoWaze', 'ordemPrecisaDaFilaInteira'];
  // O conserto mora numa função nova: no código de antes ela não existe, e o
  // teste tem de reprovar pelo COMPORTAMENTO, não por não achar a função.
  if (achar('devolverPedidoRecusado')) nomes.push('devolverPedidoRecusado');
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `
    const descargaNaFila = new WeakSet(), anotadoAntesDoEnvio = new WeakSet(); let filaDeOnde = null; let rebuscasAuto = 0;
    let tratouNestaFila = true; let puladosNoInicioDaFila = 0;
    ${nomes.map(fatiar).join('\n')}
    return { handleActionResult, registrarPousoDeSaida, fetchNextPage, filaZeradaConfirmada, carregarFilaDeSaida, salvarFilaDeSaida };`)(
    ...chaves.map((k) => deps[k]));
  return { app, AppState, log, deps, waze };
}

test('F3: ✕ recusado de vez com card na tela — o pedido volta como o PRÓXIMO card e o "Restam" sobe junto', () => {
  const recusado = pedido(0);
  const m = montar({ fila: [pedido(1), pedido(2)] });          // o gesto já tirou o v0; v1 está na tela
  m.AppState.serverTotal = 2;                                    // e já descontou o "Restam"
  m.app.handleActionResult('reject', recusado, RECUSA, 'row', m.AppState.fetchEpoch);
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v1', 'v0', 'v2'],
    `o pedido recusado não voltou pra fila (fila: ${m.AppState.queue.map((p) => p.venueID).join(',')}) — ele segue pendente no Waze e some`);
  assert.equal(m.AppState.currentPlace.venueID, 'v1', 'trocou o card que estava na tela, debaixo do dedo');
  assert.equal(m.AppState.serverTotal, 3, 'o "Restam" não acompanha a fila');
  assert.equal(m.AppState.stats.rejected, 4, 'o placar do gesto recusado não desceu');
  assert.ok(m.log.includes('fundo:v0|u0'), 'o card de fundo segue anunciando outro pedido');
  assert.ok(m.log.includes('toast:error'), 'a recusa foi calada');
});

test('F3: o recusado era o ÚLTIMO — o "Tudo limpo!" dá lugar ao card, e a conquista não sai', () => {
  const recusado = pedido(0);
  const m = montar({ fila: [], naTela: false, painel: true });  // o gesto esvaziou a fila: o painel está na tela
  m.AppState.serverTotal = 0;
  m.app.handleActionResult('reject', recusado, RECUSA, 'row', m.AppState.fetchEpoch);
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v0'], 'o pedido recusado não voltou pra fila');
  assert.ok(m.log.includes('card'), 'o pedido voltou pra fila e ficou atrás do "Tudo limpo!"');
  assert.equal(m.AppState.serverTotal, 1);
  assert.equal(m.app.filaZeradaConfirmada({ confirmando: true, place: pedido(9) }), false,
    '"Tudo limpo" com o pedido recusado de volta na fila');
});

test('F3: fila REFEITA desde o gesto (↻, filtro) — ele não entra na fila nova, e a busca é que o traz de volta', async () => {
  const recusado = pedido(0);
  const m = montar({ fila: [pedido(5)], pendentesNoWaze: [pedido(5), recusado] });
  const epocaDoGesto = m.AppState.fetchEpoch;
  m.AppState.fetchEpoch++;                                       // o ↻ refez a fila (o v0 estava em andamento)
  m.AppState.serverTotal = 1;
  m.app.handleActionResult('reject', recusado, RECUSA, 'row', epocaDoGesto);
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v5'], 'o pedido de outra fila entrou na fila nova');
  assert.equal(m.AppState.serverTotal, 1, 'o "Restam" da fila nova contou um pedido que ela não tem');
  assert.equal(m.AppState.hasMore, true, 'a fila diz que acabou: o pedido pendente nunca mais volta');
  await m.app.fetchNextPage();
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v5', 'v0'], 'a busca não trouxe o pedido recusado de volta');
  assert.equal(m.AppState.serverTotal, 2, 'o "Restam" contou o pedido que voltou mais de uma vez');
});

test('F3: recusa no POUSO da fila de saída — a busca traz o pedido de volta, contado UMA vez', async () => {
  // A fila de saída guarda só os ids: o card volta pela busca, que diz o que o
  // Waze tem agora. Antes o "Restam" subia na hora e o pedido nunca voltava
  // (ele já tinha passado pela fila) — e, reaberto o app, voltava e contava de novo.
  const recusado = pedido(0);
  const m = montar({ fila: [pedido(5)], pendentesNoWaze: [pedido(5), recusado] });
  m.deps.pedidosQueEntraramNaFila.add(chave(recusado));          // ele passou por ESTA fila, e saiu no gesto
  m.AppState.serverTotal = 1;
  const item = { tipo: 'reject', venueID: 'v0', updateRequestID: 'u0', t: 1, dia: '2026-09-26', onde: '30' };
  m.app.registrarPousoDeSaida('reject', { venueID: 'v0', updateRequestID: 'u0' }, RECUSA, item);
  assert.equal(m.AppState.stats.rejected, 4, 'o placar do gesto recusado não desceu');
  assert.ok(m.log.includes('toast:error'));
  assert.equal(m.AppState.hasMore, true, 'a fila diz que acabou: a busca que traria o pedido nunca sai');
  await m.app.fetchNextPage();
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v5', 'v0'],
    'o pedido recusado não voltou: ele já tinha passado pela fila e nenhuma busca o traz');
  assert.equal(m.AppState.serverTotal, 2, `o "Restam" contou o pedido que voltou ${m.AppState.serverTotal - 1} vezes`);
});

test('F3: "Tudo limpo" só com NADA que ainda possa voltar — outro pedido em andamento ou esperando na fila de saída segura a conquista', () => {
  const esta = pedido(1);
  const m = montar({ fila: [], naTela: false, painel: true });
  // CONTROLE: só o pedido que está sendo confirmado → a fila está limpa.
  m.deps.pedidosEmAndamento.add(chave(esta));
  assert.equal(m.app.filaZeradaConfirmada({ confirmando: true, place: esta }), true,
    'a confirmação do último pedido não dá "Tudo limpo" — a conquista ficaria inalcançável');
  // Outro pedido ainda no ar (a janela dele acabou e o envio não voltou): ele pode ser recusado e voltar.
  m.deps.pedidosEmAndamento.add(chave(pedido(2)));
  assert.equal(m.app.filaZeradaConfirmada({ confirmando: true, place: esta }), false,
    '"Tudo limpo" com outro pedido no ar — se o Waze o recusar, ele volta pra fila depois da conquista');
  m.deps.pedidosEmAndamento.delete(chave(pedido(2)));
  // Outro pedido esperando na fila de saída (sem rede): idem.
  m.app.salvarFilaDeSaida([{ tipo: 'read', venueID: 'v3', updateRequestID: 'u3' }]);
  assert.equal(m.app.filaZeradaConfirmada({ confirmando: true, place: esta }), false,
    '"Tudo limpo" com pedido ainda esperando envio na fila de saída');
  // O próprio item da fila de saída que está pousando não conta contra ele.
  m.app.salvarFilaDeSaida([{ tipo: 'read', venueID: 'v1', updateRequestID: 'u1' }]);
  assert.equal(m.app.filaZeradaConfirmada({ confirmando: true, place: esta }), true);
});

test('F3: CONTROLE — a confirmação do ÚLTIMO pedido (ele mesmo em andamento) segue dando "Tudo limpo"', () => {
  // A regra nova não pode tornar a conquista inalcançável: o pedido que está
  // sendo confirmado segue "em andamento" até o fim do envio, e é a confirmação
  // DELE que pergunta. Se ele não for passado adiante, ele se barra sozinho.
  const m = montar({ fila: [], naTela: false, painel: true });
  const ultimo = pedido(1);
  m.deps.pedidosEmAndamento.add(chave(ultimo));
  const ctxs = [];
  const deps = {
    Treino: { ativo: false }, carregarConquistas: () => ({ seq: 0, n: {} }), salvarConquistas() {},
    registrarIdiomaUsado() {}, getLang: () => 'pt', contagemDoAutor: () => 0, loadHistory: () => ({}),
    checarConquistas: (x) => ctxs.push(x || {}), filaZeradaConfirmada: (o) => m.app.filaZeradaConfirmada(o),
    checkUndoGateUnlock() {},
  };
  const chaves = Object.keys(deps);
  const registrar = new Function(...chaves, fatiar('registrarAcaoConfirmada') + '\nreturn registrarAcaoConfirmada;')(...chaves.map((k) => deps[k]));
  registrar('reject', ultimo);
  assert.equal(ctxs.at(-1).filaZerada, true,
    'a confirmação do último pedido não deu "Tudo limpo": ela não diz qual pedido confirma, e ele se barra sozinho');
});

test('F3: o gesto entrega a FILA dele à resposta (`epocaFila`) — ✕ e ✓', () => {
  // Sem a época do gesto, a resposta não sabe se a fila é a mesma, e o pedido
  // recusado não volta como card: só pela busca, depois.
  for (const [fn, tipo] of [['handleReject', 'reject'], ['handleMarkAsRead', 'read']]) {
    const corpo = fatiar(fn);
    assert.match(corpo, /const epocaFila = AppState\.fetchEpoch;/, `${fn} não guarda a fila do gesto`);
    assert.match(corpo, new RegExp(`handleActionResult\\('${tipo}', place, result, regiao, epocaFila, gesto\\);`),
      `${fn} não entrega a fila do gesto à resposta`);
  }
});

// ── R5-2-10: o "Restam" com o número VELHO no fim de uma contagem ───────────────
// Uma contagem animada ainda correndo (a página que chega) terminava escrevendo
// o alvo VELHO por cima do novo, quando a mudança seguinte era pequena (< 2): o
// ramo direto escrevia o valor mas não parava a contagem. MEDIDO (s16): +30 com a
// contagem de 400 ms, um ✕ confirmado 300 ms depois → "Restam" 33 na tela com 32.
function contadorDeMentira() {
  const estado = { reduzido: false };
  let relogio = 0;
  const quadros = new Map();
  let proximo = 0;
  const el = { textContent: '3', classList: { add() {}, remove() {} } };
  const deps = {
    performance: { now: () => relogio },
    requestAnimationFrame: (cb) => { proximo++; quadros.set(proximo, cb); return proximo; },
    cancelAnimationFrame: (id) => { quadros.delete(id); },
    prefersReducedMotion: () => estado.reduzido, popCount: () => {},
    COUNT_ANIM_MAX_MS: constante('COUNT_ANIM_MAX_MS'), COUNT_ANIM_MIN_MS: constante('COUNT_ANIM_MIN_MS'),
  };
  const nomes = Object.keys(deps);
  const setCount = new Function(...nomes, fatiar('setCount') + '\nreturn setCount;')(...nomes.map((n) => deps[n]));
  // Roda os quadros pendentes num instante (cada um agenda o seguinte).
  const quadro = (t) => { relogio = t; const agora = [...quadros.entries()]; quadros.clear(); for (const [, cb] of agora) cb(t); };
  return { el, setCount, quadro, estado, pendentes: () => quadros.size };
}

test('R5-2-10: uma mudança PEQUENA no meio de uma contagem para a contagem — a tela fica com o número novo', () => {
  const m = contadorDeMentira();
  m.setCount(m.el, 33);                 // a página chegou: 3 → 33, contando
  m.quadro(0);
  const dur = Math.min(constante('COUNT_ANIM_MAX_MS'), constante('COUNT_ANIM_MIN_MS') + 30 * 6);
  m.quadro(dur * 0.6);                  // no meio: a tela mostra um intermediário
  const meio = Number(m.el.textContent);
  assert.ok(meio > 3 && meio < 33, `PRÉ-CONDIÇÃO: a contagem está no meio (${meio})`);
  m.setCount(m.el, meio + 1);           // o ✕ confirmado: mudança de 1
  assert.equal(m.el.textContent, String(meio + 1));
  for (let i = 1; i <= 5; i++) m.quadro(dur * (1 + i));
  assert.equal(m.el.textContent, String(meio + 1),
    `a contagem velha terminou escrevendo ${m.el.textContent} por cima do número novo (${meio + 1})`);
  assert.equal(m.pendentes(), 0, 'sobrou quadro da contagem velha agendado');
});

test('R5-2-10: o mesmo no ramo do movimento REDUZIDO — e o CONTROLE da contagem que chega ao fim', () => {
  const m = contadorDeMentira();
  m.setCount(m.el, 33);                 // contando
  m.quadro(0);
  m.quadro(100);
  m.estado.reduzido = true;             // a pessoa liga o "reduzir movimento" no meio
  m.setCount(m.el, 50);                 // a próxima escrita é direta
  for (let i = 1; i <= 10; i++) m.quadro(100 + i * 200);
  assert.equal(m.el.textContent, '50', `a contagem velha terminou escrevendo ${m.el.textContent} por cima do 50`);
  // CONTROLE: sem mudança no meio, a contagem chega ao alvo.
  const c = contadorDeMentira();
  c.setCount(c.el, 33);
  for (let i = 0; i <= 10; i++) c.quadro(i * 100);
  assert.equal(c.el.textContent, '33', 'CONTROLE: a contagem deixou de chegar ao alvo');
});

// ── R5-2-09: com o foco no autor, o recusado devolvido não entra no MEIO da série ──
// O C5 devolve o recusado "como o próximo card" (`splice(1, …)`); com o foco num
// autor, o devolvido de OUTRO autor entrava entre o card da tela e o resto da
// série: depois dele a barra sumia (`autorEmFoco = null`) e a série perdia a
// prioridade — MEDIDO no navegador (s17). As funções de verdade.
function montarDevolucaoComFoco({ foco = 'X' } = {}) {
  const p = (id, autor) => ({ venueID: 'v' + id, updateRequestID: 'u' + id, creatorId: autor });
  const AppState = { autorEmFoco: foco, queue: [p('x2', 'X'), p('x4', 'X'), p('x5', 'X'), p('y3', 'Y')], fetchEpoch: 0,
    serverTotal: 4, hasMore: false };
  AppState.currentPlace = AppState.queue[0];
  const deps = {
    AppState, chaveDoPedido: (x) => x.venueID + '|' + x.updateRequestID, updatePendingCount: () => {},
    aoMudarAFilaPorBaixo: () => {}, pedidosQueEntraramNaFila: new Set(), showCurrentPlace: () => {}, startFetching: () => {},
    // A série do foco é a da régua única (`serieDoAutor`, R6-2-02).
    pedidosEmAndamento: new Set(),
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, fatiar('devolverPedidoRecusado') + '\n' + fatiar('manterFocoNaFrente')
    + '\n' + fatiar('serieDoAutor') + '\nreturn devolverPedidoRecusado;')(...chaves.map((k) => deps[k]));
  return { devolver: app, AppState, p, fila: () => AppState.queue.map((x) => x.updateRequestID) };
}

test('R5-2-09: com o foco no autor, o recusado de OUTRO autor volta DEPOIS da série — e o do mesmo autor, dentro dela', () => {
  const m = montarDevolucaoComFoco();
  m.devolver(m.p('y1', 'Y'), 0);
  assert.deepEqual(m.fila(), ['ux2', 'ux4', 'ux5', 'uy1', 'uy3'],
    'o recusado de outro autor entrou no meio da série em foco (a barra sumiria depois do card da tela)');
  assert.equal(m.AppState.serverTotal, 5);
  const s = montarDevolucaoComFoco();
  s.devolver(s.p('x9', 'X'), 0);
  assert.deepEqual(s.fila(), ['ux2', 'ux9', 'ux4', 'ux5', 'uy3'], 'o recusado do autor em foco saiu da série');
});

test('R5-2-09: CONTROLE — sem foco, o recusado volta como o PRÓXIMO card (o que o C5 promete)', () => {
  const m = montarDevolucaoComFoco({ foco: null });
  m.devolver(m.p('y1', 'Y'), 0);
  assert.deepEqual(m.fila(), ['ux2', 'uy1', 'ux4', 'ux5', 'uy3']);
  // E o card da TELA nunca sai da frente: com o foco marcado mas outro autor na
  // tela (a série acabou), a devolução não reordena nada por baixo dele.
  const o = montarDevolucaoComFoco();
  o.AppState.queue.unshift(o.p('y8', 'Y'));
  o.AppState.currentPlace = o.AppState.queue[0];
  o.devolver(o.p('y1', 'Y'), 0);
  assert.equal(o.AppState.queue[0], o.AppState.currentPlace, 'a devolução tirou o card da tela da frente da fila');
  assert.deepEqual(o.fila(), ['uy8', 'uy1', 'ux2', 'ux4', 'ux5', 'uy3']);
});
