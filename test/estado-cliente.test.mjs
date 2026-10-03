// O estado do app, pela auditoria de 2026-09-25: o treino, o "Sair" no meio de
// uma resposta, a janela do Desfazer com o app indo pro fundo e o país de quem
// entra. Cada teste foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
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
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
function montar(nomes, deps, devolve) {
  const chaves = Object.keys(deps);
  return new Function(...chaves, nomes.map(fatiar).join('\n') + `\nreturn { ${devolve.join(', ')} };`)(...chaves.map((k) => deps[k]));
}

// ── histórico depois do "Sair" ──────────────────────────────────────────────
test('"Sair" e entrar de novo na MESMA página: a ação confirmada grava o histórico em vez de lançar', () => {
  const guardado = new Map();
  const AppState = { history: null };
  const deps = {
    AppState, HISTORY_KEY: 'waze_places_history',
    localStorage: { getItem: (k) => (guardado.has(k) ? guardado.get(k) : null) },
    podarHistorico: () => false, salvarHistorico: (h) => guardado.set('waze_places_history', JSON.stringify(h)),
    historyTodayKey: () => '2026-09-25', ondeAgora: () => '30', contaAgora: () => null,
    agendarRedesenhoDoHistorico: () => {},   // o painel aberto se redesenha (test/aba-historico)
    garantirLinhaDeBaseDasConquistas: () => {},   // a 1ª passada das conquistas (R6-7-13)
  };
  const { recordHistory } = montar(['loadHistory', 'recordHistory'], deps, ['recordHistory']);
  // O "Sair" deixa o histórico como o `handleLogout` deixa:
  const sair = fatiar('handleLogout');
  const m = /AppState\.history = ([^;]+);/.exec(sair);
  assert.ok(m, 'o "Sair" não mexe mais no histórico em memória — o guard ficaria cego');
  AppState.history = new Function('return ' + m[1])();
  assert.doesNotThrow(() => recordHistory('reject', 1), 'toda ação confirmada depois do "Sair" lança no recordHistory');
  assert.equal(JSON.parse(guardado.get('waze_places_history'))._total.rejected, 1);
  // CONTROLE: o `{}` de antes quebra, então o teste enxerga o defeito.
  AppState.history = {};
  assert.throws(() => recordHistory('reject', 1));
});

// ── época da sessão ──────────────────────────────────────────────────────────
test('época da sessão: "Sair" e queda de sessão sobem a época ANTES de tudo', () => {
  for (const nome of ['handleLogout', 'derrubarSessao']) {
    const corpo = fatiar(nome);
    const i = corpo.indexOf('epocaDaSessao++');
    assert.ok(i > 0, `${nome} não sobe a época`);
    assert.ok(i < corpo.indexOf('\n', corpo.indexOf('{') + 1) + 200, `${nome}: a época sobe tarde demais`);
  }
});

test('época da sessão: resposta de ação em voo que chega depois do "Sair" não grava NADA', async () => {
  const efeitos = [];
  const agendadas = [];
  const estado = { epoca: 0 };
  const AppState = { currentPlace: { venueID: 'v1', updateRequestID: 'u1' }, stats: { rejected: 0 }, serverTotal: 5 };
  let soltar;
  const deps = {
    AppState, acoesTravadas: () => false, direcaoTravada: () => false, Treino: { ativo: false },
    updateStats: () => {}, saveStats: () => {}, advanceQueue: () => {},
    get epocaDaSessao() { return estado.epoca; },
    API: { getRegion: () => 'row', getCountry: () => 30, rejectPlace: () => new Promise((ok) => { soltar = ok; }) },
    scheduleAction: (tipo, place, ex) => agendadas.push(ex),
    presencaWmeDaAcao: () => null, callWithRetry: (fn) => fn(), carimboDoGesto: () => null,
    presencaWmeAoResponder: () => efeitos.push('presenca'),
    handleActionResult: () => efeitos.push('resultado'),
    // O placar do gesto volta só pro que NÃO pousou (test/costura-sessao, K7):
    // a resposta aqui é sucesso, então ele também não pode mexer. Quem trata a
    // resposta atrasada é o `decisaoDepoisDaQueda` (medido lá, com o de verdade):
    // aqui ele só diz que foi chamado — e com o quê.
    pousouNoWaze: (r) => !!(r && r.success), descontarGestoSemSessao: () => efeitos.push('descontou'),
    anotarAntesDoEnvio: () => true,
    decisaoDepoisDaQueda: (tipo, place, r) => efeitos.push('depoisDaQueda:' + (r && r.success ? 'pousou' : 'nao')),
  };
  // `epocaDaSessao` é lido como variável solta: passa por um getter no escopo.
  const chaves = Object.keys(deps).filter((k) => k !== 'epocaDaSessao');
  const corpo = fatiar('handleReject').replace(/epocaDaSessao/g, '__estado.epoca');
  const fn = new Function(...chaves, '__estado', corpo + '\nreturn handleReject;')(...chaves.map((k) => deps[k]), estado);
  fn();
  const envio = agendadas[0]();
  estado.epoca++;                       // o "Sair" enquanto a ação voava
  soltar({ success: true });
  await envio;
  assert.deepEqual(efeitos, ['depoisDaQueda:pousou'],
    'a resposta de depois do "Sair" gravou histórico/autor/fila de saída (ou não foi tratada como de outra sessão)');
  efeitos.length = 0;
  // CONTROLE: sem o "Sair" no meio, a mesma resposta pousa.
  AppState.currentPlace = { venueID: 'v2', updateRequestID: 'u2' };
  fn();
  const envio2 = agendadas[1]();
  soltar({ success: true });
  await envio2;
  assert.deepEqual(efeitos, ['presenca', 'resultado']);
});

test('época da sessão: fila de saída, lote e perfil conferem a época DEPOIS do await', () => {
  const casos = {
    esvaziarFilaDeSaida: /: await API\.rejectPlace\([^)]*\);\s*if \(epoca !== epocaDaSessao\) \{ enviados = 0; break; \}/,
    // Com a época mudada nada grava — só o placar otimista do que não pousou
    // volta (test/costura-sessao, K7), a anotação dele sai da fila de saída e,
    // na fila que atravessou a queda, ele volta como card (V1). O bloco não
    // tem chave NENHUMA dentro: nada de ramo que grave.
    enviarLote: /await callWithRetry\(\(\) => API\.rejectPlace\([^)]*\)\);\s*if \(epoca !== epocaDaSessao\) \{[^{}]*if \(!aoLandar\) descontarGestoSemSessao\([^;]*;[^{}]*return;\s*\}/,
    loadProfileAndAuxData: /API\.listCountries\(\)\s*\]\);\s*if \(epoca !== epocaDaSessao\) return;/,
    // A época do GESTO vai junto pro `callWithRetry` (ver test/costura-sessao),
    // e a resposta de outra sessão vai inteira pro `decisaoDepoisDaQueda`.
    handleMarkAsRead: /API\.markAsRead\([^)]*\), epoca\);\s*if \(epoca !== epocaDaSessao\) \{\s*decisaoDepoisDaQueda\('read', place, result, placar, epocaFila\);\s*return;\s*\}/,
    // As DUAS esperas do guardar: a ida e a conferência do 401 (C7 da
    // auditoria do card, 2026-09-29). A conferência só começa na MESMA época, e
    // depois das duas a época mudada sai sem gravar nada — só o aviso da estrela
    // que não foi guardada, com a fila do gesto na tela (R6-2-08).
    handleSkip: /const enviar = \(\) => API\.guardarPedido\([^)]*\);\s*let r = await callWithRetry\(enviar, epoca\);\s*if \(epoca === epocaDaSessao && r && r\.errorCategory === 'unauthorized'\) \{\s*r = await refazerDepoisDo401\(epoca, enviar\);\s*\}\s*if \(epoca !== epocaDaSessao\) \{\s*if \([^{}]*\) showToast\(t\('toast\.guardarFalhou'\), 'error'\);\s*return;\s*\}/,
  };
  for (const [nome, re] of Object.entries(casos)) assert.match(fatiar(nome), re, `${nome} grava depois do "Sair"`);
});

// ── a janela do Desfazer com o app indo pro fundo ───────────────────────────
function montarAgenda() {
  const AppState = { pendingAction: null, preferences: { undoEnabled: true }, stats: { read: 0, rejected: 2, skipped: 0 },
    serverTotal: 10, queue: [{ venueID: 'z', updateRequestID: 'z' }], inFlightActions: 0 };
  const log = [];
  const timers = [];
  const deps = {
    AppState, dlog: () => {}, dlogPlace: () => null,
    marcarEmAndamento: () => {}, removeUndoBanner: () => log.push('banner-fora'),
    aplicarTravaDeAcao: () => log.push('trava'), updateInFlightIndicator: () => {},
    canDisableUndo: () => false, registrarJanelaSemUndo: () => {}, zerarJanelasSemUndo: () => {},
    updateStats: () => {}, saveStats: () => {}, updatePendingCount: () => {},
    showCurrentPlace: () => log.push('mostrou'), showUndoBanner: () => log.push('banner'),
    t: (k) => k, enfileirarSaida: () => true, API: { getRegion: () => 'row' },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    UNDO_WINDOW_MS: 3000,
    console: { error: () => {} },
  };
  const { scheduleAction } = montar(['scheduleAction'], deps, ['scheduleAction']);
  return { scheduleAction, AppState, log };
}

test('Desfazer: executar ANTES da hora (app indo pro fundo) tira o banner — "Desfazer" depois seria mentira', async () => {
  const { scheduleAction, AppState, log } = montarAgenda();
  scheduleAction('reject', { venueID: 'v1', updateRequestID: 'u1' }, async () => {});
  assert.ok(AppState.pendingAction);
  log.length = 0;
  AppState.pendingAction.execute();
  assert.ok(log.includes('banner-fora'), 'a ação saiu e o banner "Desfazer" ficou na tela');
});

test('Desfazer: o LOTE cancelado ao ir pro fundo FECHA a janela e devolve os pedidos à fila', () => {
  const { scheduleAction, AppState, log } = montarAgenda();
  const lote = [{ venueID: 'a', updateRequestID: 'a' }, { venueID: 'b', updateRequestID: 'b' }];
  AppState.stats.rejected += 2; AppState.serverTotal -= 2;          // o gesto do lote
  scheduleAction('reject', lote, async () => {}, { aoSair: 'cancel' });
  log.length = 0;
  AppState.pendingAction.cancel(true);                                // o `descarregarAcaoPendente`
  assert.equal(AppState.pendingAction, null, 'a janela ficou aberta: ✕ ↑ ✓, gesto e teclado mortos até recarregar');
  assert.ok(log.includes('banner-fora'), 'o banner ficou preso');
  assert.ok(log.includes('trava'), 'os botões não foram reabilitados');
  assert.deepEqual(AppState.queue.slice(0, 2).map((p) => p.venueID), ['a', 'b'], 'os pedidos do lote sumiram sem sair');
  assert.equal(AppState.stats.rejected, 2);
  assert.equal(AppState.serverTotal, 10);
});

test('o modo "saindo" acaba quando a página VOLTA (visível ou bfcache)', () => {
  const d = fatiar('setupDescargaAoSair');
  assert.match(d, /else if \(document\.visibilityState === 'visible' && typeof API !== 'undefined' && API\.setSaindo\) API\.setSaindo\(false\);/,
    'depois da primeira ida ao fundo, toda requisição ficava com keepalive e sem o teto de 45 s');
  assert.match(d, /addEventListener\('pageshow', \(\) => \{ if \(typeof API !== 'undefined' && API\.setSaindo\) API\.setSaindo\(false\); \}\)/);
});

// ── o treino ──────────────────────────────────────────────────────────────────
function montarTreino(estado = {}, { loteNoAr = false, aprovacaoNoAr = false, aprovacaoNaJanela = false, aprovacaoDaQueda = null, extraDeps = {} } = {}) {
  const log = [];
  // A aprovação de foto no ar (R5-2-04): já saiu (`aprovacaoNoAr`), ou estava na
  // janela do Desfazer e SAI no despacho das pendências do lightbox ao entrar.
  const aprovacoes = new Set(aprovacaoNoAr ? ['vF|uF'] : []);
  // A de uma sessão que CAIU, com a fila em que estava (`aprovacoesDaQueda`):
  // 'nestaFila' (a fila que atravessou a queda) ou 'outraFila' (já refeita).
  const daQueda = new Map(aprovacaoDaQueda ? [['vF|uF', aprovacaoDaQueda === 'nestaFila' ? 0 : -1]] : []);
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: true,
    queue: [], currentPlace: null, stats: { read: 7, rejected: 3, skipped: 1 }, serverTotal: 40,
    preferences: { comoFuncionaVisto: false }, ...estado };
  const el = () => ({ classList: { replace() {}, add() {}, remove() {} }, textContent: '', children: [] });
  const deps = {
    AppState, document: { getElementById: el },
    removeUndoBanner: () => log.push('banner-fora'), savePreferences: () => log.push('prefs'), showLoading: () => {},
    updateStats: () => {}, updatePendingCount: () => {}, showCurrentPlace: () => log.push('card'),
    fecharCamadasDeFoto: () => {}, removeCurrentCardEl: () => {}, maybePrefetch: () => log.push('prefetch'),
    startFetching: () => log.push('busca'), showNoPlaces: () => log.push('vazio'),
    t: (k) => k, showToast: (m) => log.push('toast:' + m), openModal: () => {},
    loteDeLidosEmVoo: loteNoAr,
    // As escritas do lightbox na janela do Desfazer saem ao entrar (L25).
    enviarPendenciasDoLightbox: () => { log.push('lightbox:enviou'); if (aprovacaoNaJanela) aprovacoes.add('vF|uF'); },
    aprovacoesNoAr: aprovacoes, aprovacoesDaQueda: daQueda,
    // A aprovação ainda na JANELA do Desfazer (R6-2-07): o despacho a poria no ar.
    aprovacaoPendente: aprovacaoNaJanela ? { enviar: () => {} } : null,
    ...extraDeps,
  };
  const i = APP_SEM.indexOf('const Treino = {');
  assert.ok(i >= 0, 'o objeto Treino sumiu');
  const objeto = APP_SEM.slice(i + 'const Treino = '.length, fechar(APP_SEM, i));
  const chaves = Object.keys(deps);
  const Treino = new Function(...chaves, 'return (' + objeto + ');')(...chaves.map((k) => deps[k]));
  return { Treino, AppState, log };
}

test('treino: entrar com a busca EM VOO descarta a busca, não toca no `fetching`, e o placar real fica intacto', () => {
  const { Treino, AppState, log } = montarTreino({ fetching: true, _fetchPromise: new Promise(() => {}) });
  Treino.entrar();
  assert.equal(Treino.ativo, true);
  assert.equal(AppState.fetchEpoch, 1, 'a busca em voo pousaria os pedidos reais na fila de TREINO');
  assert.equal(AppState.fetching, true, 'o treino mexeu no `fetching` da busca real');
  assert.deepEqual(AppState.stats, { read: 7, rejected: 3, skipped: 1 }, 'o treino trocou o placar REAL');
  assert.equal(AppState.serverTotal, 40);
  Treino.agir('reject');
  assert.equal(Treino.stats.rejected, 1, 'o treino não conta no placar dele');
  assert.equal(AppState.stats.rejected, 3, 'o treino contou no placar REAL');
  // A busca terminou (a época mudou, o resultado foi descartado) e a pessoa sai:
  AppState.fetching = false; AppState._fetchPromise = null;
  log.length = 0;
  Treino.sair();
  assert.equal(AppState.fetching, false, 'o `sair()` restaurou `fetching = true` sem promessa — a aba congelava');
  assert.ok(log.includes('busca'), 'a fila real vazia não voltou a buscar depois do treino');
});

test('treino (F1): com o lote de lidos NO AR ele não liga — e diz por quê', () => {
  // O lote termina sobre a fila REAL; trocada pela de treino, o `sair()`
  // devolvia como card os pedidos que o lote tinha marcado.
  const { Treino, AppState, log } = montarTreino({ queue: [{ venueID: 'r1', updateRequestID: 'r1' }] }, { loteNoAr: true });
  const fila = AppState.queue;
  Treino.entrar();
  assert.equal(Treino.ativo, false, 'o treino trocou a fila debaixo do lote no ar');
  assert.equal(AppState.queue, fila);
  assert.ok(log.includes('toast:toast.esperaLote'), 'recusou calado');
  // CONTROLE: sem o lote no ar, entra.
  const c = montarTreino({ queue: [{ venueID: 'r1', updateRequestID: 'r1' }] });
  c.Treino.entrar();
  assert.equal(c.Treino.ativo, true);
});

// ── R5-2-04: a aprovação de foto NO AR pousa sobre a fila REAL ─────────────────
// Trocada pela de treino, o pedido aprovado não saía dela (o `tirarAprovadoDaFila`
// procura na fila de treino) e voltava no `sair()` como card, destravado — MEDIDO
// no navegador (s15): o ✕ seguinte mandava uma rejeição do pedido aprovado.
test('R5-2-04: com a aprovação de foto NO AR o treino não liga — e diz por quê', () => {
  const { Treino, AppState, log } = montarTreino({ queue: [{ venueID: 'vF', updateRequestID: 'uF' }] }, { aprovacaoNoAr: true });
  const fila = AppState.queue;
  Treino.entrar();
  assert.equal(Treino.ativo, false, 'o treino trocou a fila debaixo da aprovação no ar');
  assert.equal(AppState.queue, fila);
  assert.ok(log.includes('toast:toast.esperaAprovacao'), `recusou calado (ou com outro aviso): ${log}`);
});

test('R5-2-04: a aprovação que está na JANELA do Desfazer segura o treino também — e segue na janela (R6-2-07)', () => {
  const { Treino, log } = montarTreino({ queue: [{ venueID: 'vF', updateRequestID: 'uF' }] }, { aprovacaoNaJanela: true });
  Treino.entrar();
  assert.equal(Treino.ativo, false, 'o treino ligou com a aprovação a caminho do ar');
  assert.ok(log.includes('toast:toast.esperaAprovacao'));
  // A recusa vem ANTES do despacho (R6-2-07): a aprovação segue na janela,
  // desfazível, com o banner dela — o treino recusado não pode mandá-la.
  assert.ok(!log.includes('lightbox:enviou'), 'o treino que ia ser recusado despachou a aprovação da janela');
  assert.ok(!log.includes('banner-fora'), 'o treino recusado tirou o banner do Desfazer da aprovação');
  // CONTROLE: sem aprovação nenhuma, entra.
  const c = montarTreino({ queue: [{ venueID: 'r1', updateRequestID: 'r1' }] });
  c.Treino.entrar();
  assert.equal(c.Treino.ativo, true);
});

// A aprovação de uma sessão que CAIU, com a resposta ainda no ar, na fila que
// atravessou a queda (a renovação com a MESMA conta): o pouso dela tira o pedido
// DESTA fila (`aprovacaoPousouDepoisDaQueda`), e com a de treino no lugar ele
// voltava no `sair()` como card — o R5-2-04 de novo, pela porta da queda.
test('R5-2-04 × queda: a aprovação da sessão que caiu, ainda no ar NA FILA que ficou, segura o treino — a de uma fila refeita não', () => {
  const { Treino, AppState, log } = montarTreino({ queue: [{ venueID: 'vF', updateRequestID: 'uF' }] }, { aprovacaoDaQueda: 'nestaFila' });
  const fila = AppState.queue;
  Treino.entrar();
  assert.equal(Treino.ativo, false, 'o treino trocou a fila debaixo da aprovação que atravessou a queda');
  assert.equal(AppState.queue, fila);
  assert.ok(log.includes('toast:toast.esperaAprovacao'), `recusou calado (ou com outro aviso): ${log}`);
  // CONTROLE: a de uma fila que já foi refeita (outra conta, ↻) não pousa nesta, e não segura.
  const c = montarTreino({ queue: [{ venueID: 'r1', updateRequestID: 'r1' }] }, { aprovacaoDaQueda: 'outraFila' });
  c.Treino.entrar();
  assert.equal(c.Treino.ativo, true, 'a aprovação de uma fila que já foi refeita segurou o treino');
});

// ── R6-2-07: a recusa do treino vem ANTES de despachar qualquer coisa ──────────
// Com um ✕ na janela do Desfazer e a aprovação de OUTRO pedido no ar (o caminho
// L22), "Praticar" mandava o ✕ na hora — o banner sumia, e com ele a chance de
// desfazer — e DEPOIS recusava o treino: o efeito sem a ação pedida (MEDIDO no
// navegador, s35: o ✕ saiu em ~470 ms e o treino ficou fechado).
test('R6-2-07: com a aprovação no ar, o treino recusado NÃO manda o ✕ da janela do Desfazer', () => {
  const executou = [];
  const janela = { type: 'reject', execute: () => executou.push('reject') };
  const { Treino, AppState, log } = montarTreino({ queue: [{ venueID: 'vA', updateRequestID: 'uA' }], pendingAction: janela },
    { aprovacaoNoAr: true });
  Treino.entrar();
  assert.equal(Treino.ativo, false, 'PRÉ-CONDIÇÃO: o treino é recusado');
  assert.ok(log.includes('toast:toast.esperaAprovacao'));
  assert.deepEqual(executou, [], 'o treino recusado mandou o ✕ da janela do Desfazer');
  assert.equal(AppState.pendingAction, janela, 'a janela do Desfazer foi fechada pelo treino que não abriu');
  assert.ok(!log.includes('banner-fora'), 'o banner do Desfazer sumiu com o treino recusado');
  assert.ok(!log.includes('lightbox:enviou'), 'as escritas do lightbox saíram com o treino recusado');
  // CONTROLE: a aprovação já pousou — o treino abre, e aí o ✕ sair é o desenho de entrar.
  const c = montarTreino({ queue: [{ venueID: 'vA', updateRequestID: 'uA' }], pendingAction: { type: 'reject', execute: () => executou.push('c') } });
  c.Treino.entrar();
  assert.equal(c.Treino.ativo, true);
  assert.deepEqual(executou, ['c']);
});

test('treino: deslogado ele NÃO liga (a tela de card nem existe)', () => {
  const { Treino } = montarTreino({ authenticated: false });
  Treino.entrar();
  assert.equal(Treino.ativo, false, 'o treino ligou invisível; o login seguinte rodaria a fila real em modo treino');
});

test('treino: entrar marca o "Como funciona" como visto — senão ele abria por cima, no mesmo tique (gotcha #65)', () => {
  const { Treino, AppState } = montarTreino();
  Treino.entrar();
  assert.equal(AppState.preferences.comoFuncionaVisto, true);
  assert.match(fatiar('mostrarComoFuncionaSePrimeiraVez'), /if \(Treino\.ativo\) return;/);
});

test('treino: fila nova (sair, entrar, atualizar, filtro) ENCERRA o treino sem devolver a fila de antes', () => {
  assert.match(fatiar('resetQueue'), /if \(Treino\.ativo\) Treino\.encerrar\(\);/);
  const { Treino } = montarTreino({ queue: [{ venueID: 'r1', updateRequestID: 'r1' }] });
  Treino.entrar();
  Treino.encerrar();
  assert.equal(Treino.ativo, false);
  assert.equal(Treino._salvo, null, 'guardou a fila de antes: um `sair()` depois devolveria a fila da conta anterior');
  // E nada busca durante o treino (o laço do `startFetching` giraria à toa).
  assert.match(fatiar('startFetching'), /^async function startFetching\(\) \{\s*if \(Treino\.ativo\) return;/);
  assert.match(fatiar('maybePrefetch'), /^function maybePrefetch\(\) \{\s*if \(Treino\.ativo\) return;/);
});

// ── R6-7-2: o "Como funciona" não abre por cima de camada aberta ─────────────
// A primeira busca demorando, a pessoa abre o "Conectar outro aparelho" (ou os
// Filtros) e o primeiro card chega: o aviso da primeira vez abria por cima — o
// `openModal` esconde a camada e roda a limpeza dela, apagando o QR no meio do
// pareamento e a escolha ainda não aplicada dos Filtros (auditoria de
// 2026-10-01, MEDIDO no navegador: `pixelsQr: 0`).
function montarComoFunciona() {
  const camada = { modal: null, foto: false, mapa: false };
  const abertos = [];
  const AppState = { preferences: { comoFuncionaVisto: false }, currentPlace: { venueID: 'v1' } };
  const deps = {
    AppState, Treino: { ativo: false }, cardDaFrente: () => ({}),
    topOpenModal: () => camada.modal, Lightbox: { isOpen: () => camada.foto }, MapaLightbox: { isOpen: () => camada.mapa },
    savePreferences: () => {}, abrirComoFunciona: () => abertos.push('comoFunciona'),
  };
  const { mostrarComoFuncionaSePrimeiraVez } = montar(['semCamadaAberta', 'mostrarComoFuncionaSePrimeiraVez'], deps,
    ['mostrarComoFuncionaSePrimeiraVez']);
  return { mostrar: mostrarComoFuncionaSePrimeiraVez, AppState, abertos, camada };
}

test('R6-7-2: o "Como funciona" da 1ª vez NÃO abre por cima de uma camada aberta — e espera o próximo card sem ela', () => {
  for (const [nome, abre] of [['do "Conectar outro aparelho"', (c) => { c.modal = { id: 'pairShowModal' }; }],
    ['dos Filtros', (c) => { c.modal = { id: 'filtersModal' }; }], ['da foto ampliada', (c) => { c.foto = true; }],
    ['do mapa ampliado', (c) => { c.mapa = true; }]]) {
    const m = montarComoFunciona();
    abre(m.camada);
    m.mostrar();
    assert.deepEqual(m.abertos, [], `abriu por cima ${nome}: o openModal a esconde e apaga o que a pessoa fazia`);
    assert.equal(m.AppState.preferences.comoFuncionaVisto, false,
      `por cima ${nome}, deu-se por visto sem ter aparecido — nunca mais apareceria`);
    // A camada fechou e o PRÓXIMO card montou: aí sim.
    Object.assign(m.camada, { modal: null, foto: false, mapa: false });
    m.mostrar();
    assert.deepEqual(m.abertos, ['comoFunciona'], `depois ${nome} fechar, o próximo card não mostrou o aviso`);
  }
  // CONTROLE: sem camada nenhuma ele abre na hora, e uma vez só.
  const c = montarComoFunciona();
  c.mostrar(); c.mostrar();
  assert.deepEqual(c.abertos, ['comoFunciona']);
  assert.equal(c.AppState.preferences.comoFuncionaVisto, true);
});

// ── R6-7-6: o card de foto nova do TREINO abre na foto em decisão, com ✨ ──────
// O treino troca o `updateRequestID` pelo inerte, e é por ele que o card acha a
// foto proposta: o card de foto nova abria na foto ANTIGA, sem ✨ nem a borda
// âmbar — o treino escolhe os cards por variedade justamente pra ensinar o de
// foto (auditoria de 2026-10-01; na fila do owner, em 13 de 76 pedidos de foto a
// proposta não é a 1ª).
test('R6-7-6: no treino, o pedido de foto nova abre na foto PROPOSTA — a mesma do modo real', () => {
  const { Treino } = montarTreino();
  const { fotosDoCard } = montar(['fotosDoCard'], {}, ['fotosDoCard']);
  const real = { venueID: 'v1', updateRequestID: 'u1', purType: 'NEW_PHOTO',
    imageUrls: ['https://venue-image.waze.com/thumbs/thumb347_antiga111.jpg', 'https://venue-image.waze.com/thumbs/thumb347_u1.jpg'] };
  assert.equal(fotosDoCard(real).emDecisao, 1, 'CONTROLE: no modo real a proposta é a 2ª');
  const treino = Treino.neutralizar(real);
  assert.equal(treino.updateRequestID, Treino.UR_INERTE, 'PRÉ-CONDIÇÃO: o pedido de treino segue inerte pras escritas');
  const f = fotosDoCard(treino);
  assert.equal(f.emDecisao, 1, 'o card de treino não acha a foto em decisão — sem ✨, e o lightbox também não');
  assert.equal(f.inicial, 1, 'o card de treino abre na foto ANTIGA');
});

// ── R6-7-7: o foco no autor não atravessa o treino ──────────────────────────
// "Primeiro os de X" é ordem da fila REAL. Ele aparecia no treino (mentindo: a
// ordem lá é de variedade) e se apagava no 1º card de outro autor — a fila real
// voltava com a série na frente e sem a barra; e o foco escolhido NO treino
// sobrava na fila real (auditoria de 2026-10-01, MEDIDO no navegador).
function barraDeMentira() {
  const classes = new Set(['hidden']);
  const barra = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), replace() {}, contains: (c) => classes.has(c) } };
  const el = () => ({ classList: { replace() {}, add() {}, remove() {} }, textContent: '', children: [] });
  return { barra, visivel: () => !classes.has('hidden'),
    document: { getElementById: (id) => (id === 'focoAutorBar' ? barra : el()) } };
}
test('R6-7-7: o foco da fila real sai da tela no treino e VOLTA no `sair()`; o escolhido no treino não sobra', () => {
  const tela = barraDeMentira();
  tela.barra.classList.remove('hidden');               // "Primeiro os de X" na fila real
  const real = [{ venueID: 'v1', creatorId: 500 }, { venueID: 'v2', creatorId: 600 }];
  const { Treino, AppState } = montarTreino({ queue: real, currentPlace: real[0], autorEmFoco: 500 },
    { extraDeps: { document: tela.document } });
  Treino.entrar();
  assert.equal(AppState.autorEmFoco, null, 'o foco da fila REAL valeu no treino, cuja ordem é por variedade');
  AppState.autorEmFoco = 600;                          // "Ver +N" num card de treino
  tela.barra.classList.remove('hidden');
  Treino.sair();
  assert.equal(AppState.autorEmFoco, 500, 'o foco da fila real não voltou (ou o do treino sobrou nela)');
  assert.equal(tela.visivel(), false, 'a barra do TREINO ficou na tela depois de sair');
  // A fila nova (o `resetQueue` encerra o treino) também: o do treino não sobra.
  const t2 = montarTreino({ queue: real, currentPlace: real[0], autorEmFoco: null }, { extraDeps: { document: barraDeMentira().document } });
  t2.Treino.entrar();
  t2.AppState.autorEmFoco = 600;
  t2.Treino.encerrar();
  assert.equal(t2.AppState.autorEmFoco, null, 'o foco escolhido no treino sobrou na fila nova');
});

// ── R6-7-8: o "de N na região" é da fila REAL ────────────────────────────────
test('R6-7-8: no treino, o "de N na região" da fila real sai de baixo do "Restam" do treino — e volta fora dele', () => {
  const classes = new Set();
  const hint = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, textContent: '', title: '',
    removeAttribute() {} };
  const el = { pendingCount: { textContent: '' }, pendingTotalHint: hint };
  const Treino = { ativo: true, restam: 30 };
  const AppState = { authenticated: true, serverTotal: 35, serverBlocked: 100, blockedPartial: false, hasMore: false,
    fetching: false, loadError: false };
  const { updatePendingCount } = montar(['updatePendingCount', 'updatePendingTotalHint'], {
    AppState, Treino, document: { getElementById: (id) => el[id] || null }, t: (k, v) => k + JSON.stringify(v || {}),
    setCount: (e, n) => { e.textContent = String(n); }, atualizarPontoNoIcone() {}, atualizarAvisoDeSessao() {},
    // O "…" e o "—" do R6-2-04/05 (lote 10 da fila): a busca esperando o perfil, e
    // parar a contagem animada que estiver em curso.
    buscaEsperaOPerfil: false, pararContagemEmCurso() {},
  }, ['updatePendingCount']);
  updatePendingCount();
  assert.equal(el.pendingCount.textContent, '30', 'PRÉ-CONDIÇÃO: o "Restam" é o do treino');
  assert.ok(classes.has('hidden'), `o "de N na região" da fila real ficou embaixo dos exemplos (${hint.textContent})`);
  // CONTROLE: fora do treino, ele volta — "de 135 na região".
  Treino.ativo = false;
  updatePendingCount();
  assert.ok(!classes.has('hidden'));
  assert.match(hint.textContent, /"total":"135"/);
});

// ── R6-7-10: trocar o idioma no treino retraduz os EXEMPLOS ─────────────────
test('R6-7-10: com a fila vazia o treino usa exemplos — trocar o idioma os retraduz (o nome, o endereço e o autor)', () => {
  let lang = 'pt';
  const { Treino, AppState } = montarTreino({ queue: [] }, { extraDeps: { t: (k) => lang + ':' + k } });
  Treino.entrar();
  assert.equal(AppState.queue.length, 3, 'PRÉ-CONDIÇÃO: o treino de fila vazia é de exemplos');
  assert.equal(AppState.queue[0].name, 'pt:treino.c1.nome');
  lang = 'en';
  Treino.retraduzirExemplos();
  assert.deepEqual(AppState.queue.map((p) => [p.name, p.address, p.createdBy]), [
    ['en:treino.c1.nome', 'en:treino.c1.endereco', 'en:treino.autor'],
    ['en:treino.c2.nome', 'en:treino.c2.endereco', 'en:treino.autor'],
    ['en:treino.c3.nome', 'en:treino.c3.endereco', 'en:treino.autor']], 'os exemplos ficaram no idioma de antes');
  // E o pedido REAL do treino não é tocado (o nome dele é do Waze).
  const r = montarTreino({ queue: [{ venueID: 'r1', name: 'Padaria Real' }, { venueID: 'r2', name: 'B' }, { venueID: 'r3', name: 'C' }] });
  r.Treino.entrar();
  r.Treino.retraduzirExemplos();
  assert.equal(r.AppState.queue.find((p) => p.venueID === 'r1').name, 'Padaria Real');
});

// ── R6-7-11: o convite de instalar mora no "Tudo limpo!", e só ali ──────────
// A regra é a do confete: a tela de quem TERMINOU a fila. O convite aparecia em
// todo painel vazio — no "Confira o país e a região" de quem não tratou nada,
// disputando com a instrução de conferir os filtros, e no "Fim da fila" com
// pulados (auditoria de 2026-10-01, MEDIDO no navegador com o passo a passo do iOS).
function montarPainelComConvite({ tratou, skipped = 0, base = 0 }) {
  const cls = () => { const c = new Set(); return { set: c, add: (x) => c.add(x), remove: (x) => c.delete(x),
    contains: (x) => c.has(x), toggle: (x, f) => { if (f) c.add(x); else c.delete(x); } }; };
  const els = {};
  for (const id of ['installInvite', 'installInviteBtn', 'installIosSteps']) els[id] = { classList: cls() };
  els.installInvite.classList.add('hidden');
  const noMore = { classList: cls(), querySelector: () => null, dataset: { bordaRolagem: '1' }, offsetWidth: 0 };
  els.noMoreCards = noMore;
  const deps = {
    AppState: { loadError: false, hasMore: false, serverTotal: 0, stats: { skipped } },
    document: { getElementById: (id) => els[id] || null },
    dfato() {}, dlogCapturarAuto() {}, marcarTelaPronta() {}, removeCurrentCardEl() {}, showLoading() {},
    marcarBordaRolagem() {}, checarConquistas() {}, dlog() {}, filaZeradaConfirmada: () => false, trocarTextoI18n() {},
    convitePodeAparecer: () => true,   // o navegador oferece (ou é iOS) e ninguém dispensou
    queueMicrotask: () => {},
  };
  const chaves = Object.keys(deps);
  // `recusaAutomaticaNestaFila` (R6-2-11): só muda a FRASE; convite e confete são do trabalho da pessoa.
  // `focoDoTeclado` (R7-2-06): o painel leva o foco prometido ao teclado; aqui ninguém usa teclado.
  const api = new Function(...chaves, `let tratouNestaFila = ${tratou}; let puladosNoInicioDaFila = ${base}; let promptInstalacao = null; let recusaAutomaticaNestaFila = false; let focoDoTeclado = null;\n`
    + ['puladosNestaFila', 'filaTerminouLimpa', 'atualizarConviteInstalar', 'showNoPlaces'].map(fatiar).join('\n')
    + '\nreturn { showNoPlaces, atualizarConviteInstalar };')(...chaves.map((k) => deps[k]));
  return { ...api, convite: () => !els.installInvite.classList.contains('hidden'), festa: () => noMore.classList.contains('celebrate') };
}
test('R6-7-11: o convite de instalar sai só no painel de quem TERMINOU a fila — a mesma condição do confete', () => {
  for (const [nome, caso] of [['"Confira o país e a região" (não tratou nada)', { tratou: false }],
    ['"Fim da fila" (com pulados)', { tratou: true, skipped: 3, base: 1 }]]) {
    const m = montarPainelComConvite(caso);
    m.showNoPlaces();
    assert.equal(m.convite(), false, `o convite apareceu no ${nome}`);
    assert.equal(m.festa(), false, 'PRÉ-CONDIÇÃO: este painel não tem festa');
    // O prompt do navegador chega DEPOIS (beforeinstallprompt) e redesenha o convite.
    m.atualizarConviteInstalar();
    assert.equal(m.convite(), false, `o prompt que chegou depois pôs o convite no ${nome}`);
  }
  // CONTROLE: no "Tudo limpo!" de quem terminou, convite e confete juntos.
  const c = montarPainelComConvite({ tratou: true });
  c.showNoPlaces();
  assert.equal(c.festa(), true);
  assert.equal(c.convite(), true, 'o convite sumiu do "Tudo limpo!"');
});

// ── R6-7-12: os botões de instalar somem — o foco do teclado não cai no <body> ─
// "Agora não" esconde o convite, e o "Instalar o aplicativo" da Ajuda se esconde
// depois do diálogo do navegador (o prompt é de uso único), com a Ajuda ainda
// aberta. Pelo teclado, o foco caía no <body> (auditoria de 2026-10-01, MEDIDO
// nos dois). Ele vai a um vizinho que FICA; com o dedo, nada muda de lugar.
function montarInstalar() {
  const ouvintes = {};
  const els = {};
  const elemento = (id) => (els[id] = els[id] || { id, addEventListener: (tipo, fn) => { ouvintes[id] = fn; },
    classList: { toggle() {}, add() {}, remove() {} } });
  const doc = { activeElement: null, body: { id: 'body' }, getElementById: elemento };
  const focos = [];
  const deps = {
    document: doc, window: { addEventListener() {} }, safeLS: { set() {} }, CHAVE_INSTALL_DISPENSADO: 'x',
    atualizarConviteInstalar() {}, atualizarBotaoInstalar() {},
    devolverFoco: (alvo) => { focos.push(alvo ? alvo.id : null); },
  };
  const chaves = Object.keys(deps);
  const estado = new Function(...chaves, 'let promptInstalacao = null;\n'
    + ['veioDoTeclado', 'focoPerdido', 'setupInstalarApp'].map(fatiar).join('\n')
    + '\nreturn { setupInstalarApp, darPrompt: (p) => { promptInstalacao = p; } };')(...chaves.map((k) => deps[k]));
  estado.setupInstalarApp();
  const clicar = (id, { teclado }) => {
    const alvo = elemento(id);
    doc.activeElement = alvo;          // o foco está no botão (Tab até ele, ou o toque)
    return ouvintes[id]({ detail: teclado ? 0 : 1, currentTarget: alvo });
  };
  return { clicar, focos, darPrompt: estado.darPrompt };
}
test('R6-7-12: "Agora não" e "Instalar" pelo teclado levam o foco a um vizinho que fica — com o dedo, não', async () => {
  const m = montarInstalar();
  m.clicar('installDismissBtn', { teclado: true });
  assert.deepEqual(m.focos, ['reloadBtn'], 'o "Agora não" escondeu o convite com o foco nele, e o foco caiu no <body>');
  m.darPrompt({ prompt() {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  await m.clicar('installAppBtn', { teclado: true });
  assert.deepEqual(m.focos, ['reloadBtn', 'closeHelp'], 'o "Instalar" da Ajuda sumiu com o foco nele, com a Ajuda aberta');
  m.darPrompt({ prompt() {}, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  await m.clicar('installInviteBtn', { teclado: true });
  assert.deepEqual(m.focos, ['reloadBtn', 'closeHelp', 'reloadBtn'], 'o "Instalar" do convite sumiu com o foco nele');
  // CONTROLE: com o dedo (ou o mouse) o foco não é movido — a regra do app.
  const d = montarInstalar();
  d.clicar('installDismissBtn', { teclado: false });
  d.darPrompt({ prompt() {}, userChoice: Promise.resolve() });
  await d.clicar('installAppBtn', { teclado: false });
  assert.deepEqual(d.focos, [], 'o toque moveu o foco');
});

test('Ajuda: Praticar, Conectar outro aparelho e Sair só aparecem com sessão', () => {
  for (const id of ['abrirTreino', 'pairCreateBtn', 'logoutBtn']) {
    assert.match(HTML, new RegExp(`<button id="${id}" data-so-com-sessao `), `${id} aparece na tela de entrada`);
  }
  assert.match(fatiar('showAuthScreen'), /mostrarControlesDeSessao\(false\);/);
  assert.match(fatiar('showMainScreen'), /mostrarControlesDeSessao\(true\);/);
});

// ── o país de quem entra ─────────────────────────────────────────────────────
function montarPais({ pais = 30, regiao = 'row', perfis = {}, myArea = false } = {}) {
  const pedidos = [];
  const deps = {
    AppState: { filters: { myArea } },
    REGIOES_DO_WAZE: ['row', 'na', 'il'],
    epocaDaSessao: 0,
    // Sem pedido registrado, nada mudou desde ele (o achado 10 tem o seu
    // teste em test/filtros-aplicar.test.mjs).
    lugarDoPedidoDoPerfil: null,
    API: {
      getCountry: () => pais, getRegion: () => regiao,
      getProfile: async (r) => { pedidos.push(r); return perfis[r] || { success: true, profile: { editableCountryIDs: [] } }; },
    },
  };
  const { paisDoPerfil } = montar(['paisDoPerfil'], deps, ['paisDoPerfil']);
  return { paisDoPerfil, pedidos };
}

test('país: quem edita na França abre na França (e não no "Tudo limpo!" do Brasil)', async () => {
  const { paisDoPerfil, pedidos } = montarPais();
  assert.deepEqual(await paisDoPerfil({ editableCountryIDs: [73, 181] }, 0), { regiao: 'row', pais: 73 });
  assert.deepEqual(pedidos, [], 'perguntou a outro servidor com a lista daqui cheia');
});

test('país: quem JÁ está onde edita não é mexido — nem custa requisição', async () => {
  const { paisDoPerfil, pedidos } = montarPais({ pais: 181 });
  assert.equal(await paisDoPerfil({ editableCountryIDs: [73, 181] }, 0), null);
  assert.deepEqual(pedidos, []);
});

test('país: lista VAZIA aqui = edita em outro servidor — pergunta lá (EUA no NA)', async () => {
  const { paisDoPerfil, pedidos } = montarPais({
    perfis: { na: { success: true, profile: { editableCountryIDs: [235] } } },
  });
  assert.deepEqual(await paisDoPerfil({ editableCountryIDs: [] }, 0), { regiao: 'na', pais: 235 });
  assert.deepEqual(pedidos, ['na'], 'perguntou a mais servidores que o necessário');
});

test('país: staff e "Minha área" escolhem sozinhos', async () => {
  assert.equal(await montarPais().paisDoPerfil({ isStaff: true, editableCountryIDs: [73] }, 0), null);
  assert.equal(await montarPais({ myArea: true }).paisDoPerfil({ editableCountryIDs: [73] }, 0), null);
});

test('país: vale a cada abertura, depois do perfil — e troca de verdade (fila nova)', () => {
  // O país mora no que COMPLETA a chegada do perfil — a carga da abertura e o
  // alarme falso que traz o 1º perfil passam por ele (auditoria de 2026-09-26).
  const l = fatiar('loadProfileAndAuxData');
  assert.match(l, /if \(definirPerfil\(profileRes\)\) await completarPerfilChegado\(profileRes\.profile, epoca\);/);
  const c = fatiar('completarPerfilChegado');
  assert.match(c, /const destino = await paisDoPerfil\(perfil, epoca\);\s*if \(destino && epoca === epocaDaSessao\) await irProPaisDoPerfil\(destino\);/);
  const ir = fatiar('irProPaisDoPerfil');
  for (const re of [/API\.setCountry\(pais\);/, /AppState\.filters\.stateId = '';/, /saveFilters\(\);/, /resetQueue\(\);/, /startFetching\(\);/]) {
    assert.match(ir, re);
  }
});

// ── os filtros (auditoria de 2026-09-25) ─────────────────────────────────────
test('filtros: trocar a REGIÃO traz os países dela, e o "Aplicar" com lista carregando não apaga país nem estado', () => {
  // O handler virou função com nome (F10a, auditoria da fila de 2026-09-26),
  // que test/filtros-modal.test.mjs RODA — com a lista chegando e falhando.
  assert.match(APP_SEM, /\$\('filterRegion'\)\.addEventListener\('change', aoTrocarRegiaoNoModal\);/,
    'a troca de região no modal deixou de trazer os países dela');
  assert.match(fatiar('aoTrocarRegiaoNoModal'), /const r = await API\.listCountries\(regiao\);/,
    'a troca de região no modal seguia com os países da região anterior');
  const aplicar = fatiar('applyFiltersFromModal');
  assert.match(aplicar, /if \(!\$\('filterState'\)\.dataset\.carregando\) AppState\.filters\.stateId = \$\('filterState'\)\.value;/);
  assert.match(aplicar, /if \(!\$\('filterCountry'\)\.dataset\.carregando && \$\('filterCountry'\)\.value\) API\.setCountry\(\$\('filterCountry'\)\.value\);/);
});

// A dica "Mostrando apenas países que você pode editar" só se ACENDIA: depois de
// uma lista filtrada, ela seguia na tela com a lista INTEIRA — a da região nova
// (o ouvinte da troca traz todos os países dela) ou a de um perfil sem países
// editáveis ali (auditoria de textos, 2026-09-26). Roda a função e o ouvinte
// DE VERDADE, recortados do app.js.
test('filtros: a dica de "só os países que você pode editar" diz o que A LISTA é — some com a lista inteira e na troca de região', async () => {
  const el = (extra = {}) => {
    const cls = new Set(['hidden']);
    return {
      dataset: {}, innerHTML: '', value: '',
      classList: {
        add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
        toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; },
      },
      ...extra,
    };
  };
  const els = { filterCountry: el(), filterCountryHint: el(), filterRegion: el({ value: 'row' }), filterMyArea: el({ checked: false }) };
  const AppState = { profile: { editableCountryIDs: [30] }, countries: [{ id: 30, name: 'Brazil' }, { id: 73, name: 'France' }] };
  // A troca de região passa pela MESMA função (R66-4, test/filtros-aplicar): ela
  // sabe a região aplicada e tira a área do país que deixou de ser mostrado.
  const { populateCountrySelect } = montar(['populateCountrySelect'], {
    document: { getElementById: (id) => els[id] || null }, AppState, API: { getCountry: () => 30, getRegion: () => 'row' },
    ordenarPorNome: (l) => l, escapeHtml: (x) => String(x), aoMudarPaisNaTela: () => {},
  }, ['populateCountrySelect']);
  const dica = () => !els.filterCountryHint.classList.contains('hidden');

  populateCountrySelect();
  assert.equal(dica(), true, 'CONTROLE: com a lista filtrada pelo perfil, a dica aparece');
  assert.equal((els.filterCountry.innerHTML.match(/<option/g) || []).length, 1, 'CONTROLE: a lista filtrada tem só o país editável');
  for (const editaveis of [[], [999]]) {
    AppState.profile = { editableCountryIDs: editaveis };
    populateCountrySelect();
    assert.equal(dica(), false, `lista inteira (editáveis ${JSON.stringify(editaveis)}) e a dica dizendo "só os que você pode editar"`);
  }

  // O ouvinte da troca de região: a função com nome do F10a, recortada do app.js
  // e rodada com a lista da região nova chegando.
  assert.match(APP_SEM, /\$\('filterRegion'\)\.addEventListener\('change', aoTrocarRegiaoNoModal\);/, 'sumiu o ouvinte da troca de região');
  const { aoTrocarRegiaoNoModal } = montar(['aoTrocarRegiaoNoModal'], {
    document: { getElementById: (id) => els[id] || null }, AppState,
    API: { getRegion: () => 'row', getCountry: () => 30,
      listCountries: async () => ({ success: true, countries: [{ id: 235, name: 'United States' }, { id: 40, name: 'Canada' }] }) },
    escapeHtml: (x) => String(x), t: (k) => k, ordenarPorNome: (l) => l, loadStatesIntoSelect: async () => {},
    populateCountrySelect, showToast: () => {},
    // A espera do "Aplicar" e a área que volta a "Nenhuma" (test/filtros-modal).
    esperaDosFiltros: { regiao: false, gps: false }, aplicarEsperaDosFiltros: () => {}, aoMudarPaisNaTela: () => {},
    cargaDePaises: 0,   // o número de cada carga da lista de países (R56-6, test/filtros-aplicar)
  }, ['aoTrocarRegiaoNoModal']);
  const ouvinte = aoTrocarRegiaoNoModal;
  AppState.profile = { editableCountryIDs: [30] };
  populateCountrySelect();
  assert.equal(dica(), true, 'CONTROLE: a dica acesa antes da troca');
  els.filterRegion.value = 'na';
  await ouvinte({ target: { value: 'na' } });
  assert.equal((els.filterCountry.innerHTML.match(/<option/g) || []).length, 2, 'CONTROLE: a troca trouxe a lista inteira da região');
  assert.equal(dica(), false, 'trocou a região, veio a lista inteira dela, e a dica seguiu dizendo "só os que você pode editar"');
});

test('filtros: a carga de estados VELHA não sobrescreve a nova (trocar de país no meio)', async () => {
  const opcoes = [];
  const select = { dataset: {}, set innerHTML(v) { opcoes.length = 0; }, appendChild: (o) => opcoes.push(o.value), value: '' };
  const soltar = {};
  const deps = {
    document: { getElementById: () => select, createElement: () => ({}) },
    AppState: { statesByCountry: {}, filters: { stateId: '' } },
    API: { listStates: (pais) => new Promise((ok) => { soltar[pais] = ok; }) },
    escapeHtml: (x) => x, t: (k) => k, ordenarPorNome: (l) => l,
  };
  const chaves = Object.keys(deps);
  const load = new Function(...chaves, 'let cargaDeEstados = 0;\n' + fatiar('loadStatesIntoSelect') + '\nreturn loadStatesIntoSelect;')(...chaves.map((k) => deps[k]));
  const velha = load(30);
  assert.equal(select.dataset.carregando, '1', 'o seletor carregando não se marca como tal');
  const nova = load(73);
  soltar[73]({ success: true, states: [{ id: 'fr1', name: 'Île-de-France' }] });
  await nova;
  soltar[30]({ success: true, states: [{ id: 'br1', name: 'Bahia' }] });
  await velha;
  assert.deepEqual(opcoes, ['fr1'], 'a resposta do país ANTERIOR sobrescreveu os estados do país escolhido');
  assert.equal(select.dataset.carregando, undefined);
});

test('"Sair" nesta página: voltar à aba não reloga sozinho pela extensão', () => {
  assert.match(fatiar('handleLogout'), /saiuNestaPagina = true;/);
  assert.match(APP_SEM, /if \(document\.visibilityState !== 'visible'\) return;\s*if \(saiuNestaPagina\) return;/,
    'depois de "Sair", trocar de aba e voltar entrava de novo pela extensão');
});

test('perfil que FALHOU é pedido de novo na próxima prova de rede (no máximo 1×/min), e o que dependia dele reage', () => {
  const r = fatiar('refazerPerfilSeFaltar');
  assert.match(r, /if \(!AppState\.authenticated \|\| AppState\.profile\) return;/);
  assert.match(r, /if \(Date\.now\(\) - perfilPedidoEm < PERFIL_REFAZER_MS\) return;/, 'sem teto, cada resposta pediria o perfil de novo');
  // Pelo CORPO da prova de rede, não pela vizinhança: outra carona entrando
  // depois da linha (a foto do card "sem foto") não pode reprovar código certo.
  const prova = APP_SEM.slice(APP_SEM.indexOf('API.aoProvarRede = () => {'));
  assert.match(prova.slice(0, prova.indexOf('\n};')), /^\s+refazerPerfilSeFaltar\(\);/m, 'a prova de rede não refaz o perfil que falhou');
  const l = fatiar('loadProfileAndAuxData');
  assert.match(l, /perfilPedidoEm = Date\.now\(\);/);
  assert.match(l, /if \(definirPerfil\(profileRes\)\) await completarPerfilChegado\(/,
    'a carga do perfil deixou de completar a chegada dele');
  assert.match(fatiar('completarPerfilChegado'), /^async function completarPerfilChegado\(perfil, epoca\) \{\s*aplicarRecusaAutomatica\(\);/,
    'a recusa automática (L6) não reage ao perfil que chegou depois da fila');
});

test('a queda da sessão com ação na janela do Desfazer GRAVA o placar revertido', () => {
  // O gesto grava o +1 na hora; o `cancel()` sem argumento reverte só em
  // memória. Quem fecha o app depois da queda ficava com um pedido a mais no
  // placar pra sempre (auditoria de 2026-09-25). Desde o V1 (2026-09-29) é o
  // `cancel(true)`, que também devolve o pedido à fila (medido em
  // test/costura-sessao.test.mjs); o `saveStats` logo depois segue valendo.
  const d = fatiar('derrubarSessao');
  const i = d.indexOf('AppState.pendingAction.cancel(true);');
  assert.ok(i > 0, 'a queda deixou de cancelar a ação pendente');
  const bloco = d.slice(i, d.indexOf('}', i));
  assert.match(bloco, /saveStats\(\);/, 'o placar revertido não é gravado na queda da sessão');
});

test('fila que termina com PULADOS não diz "Tudo limpo!" nem "confira o país": diz que eles seguem pendentes', () => {
  // Auditoria de 2026-09-25: quem pulava tudo via "Tudo limpo!" e "confira o
  // país e a região" — os pulados seguem pendentes, e o "Verificar novamente"
  // logo abaixo os traz de volta.
  const el = (i18n) => ({ attrs: { 'data-i18n': i18n }, textContent: '', classList: { add() {}, remove() {}, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, dataset: { bordaRolagem: '1' } });
  const h3 = el('states.empty.title'), p = el('states.empty.body');
  const noMore = { ...el(''), querySelector: (sel) => (sel.startsWith('h3') ? h3 : p), offsetWidth: 0 };
  const rodar = ({ skipped, base, tratou }) => {
    const deps = {
      AppState: { loadError: false, hasMore: false, serverTotal: 0, stats: { skipped } },
      document: { getElementById: (id) => (id === 'noMoreCards' ? noMore : null) },
      dfato() {}, dlogCapturarAuto() {}, marcarTelaPronta() {}, removeCurrentCardEl() {}, showLoading() {},
      atualizarConviteInstalar() {}, marcarBordaRolagem() {}, checarConquistas() {}, dlog() {},
      // A conquista "Tudo limpo" é perguntada no fim da tarefa (ver
      // test/conquistas-momento.test.mjs); aqui só interessa a frase.
      filaZeradaConfirmada: () => false,
      trocarTextoI18n: (e, k) => { if (e) e.attrs['data-i18n'] = k; },
    };
    const chaves = Object.keys(deps);
    // `recusaAutomaticaNestaFila`: a recusa automática não agiu (R6-2-11 tem teste próprio, em lote-autor).
    // E o `focoDoTeclado` (R7-2-06): ninguém usa teclado aqui.
    const fn = new Function(...chaves, `let tratouNestaFila = ${tratou}; let puladosNoInicioDaFila = ${base}; let recusaAutomaticaNestaFila = false; let focoDoTeclado = null;\n`
      + fatiar('puladosNestaFila') + '\n' + fatiar('filaTerminouLimpa') + '\n' + fatiar('showNoPlaces')
      + '\nreturn showNoPlaces;')(...chaves.map((k) => deps[k]));
    fn();
    return [h3.attrs['data-i18n'], p.attrs['data-i18n']];
  };
  assert.deepEqual(rodar({ skipped: 12, base: 9, tratou: false }), ['states.empty.titlePulados', 'states.empty.bodyPulados']);
  assert.deepEqual(rodar({ skipped: 12, base: 9, tratou: true }), ['states.empty.titlePulados', 'states.empty.bodyPulados']);
  // CONTROLES: sem pulados, as duas frases de antes.
  assert.deepEqual(rodar({ skipped: 9, base: 9, tratou: true }), ['states.empty.title', 'states.empty.body']);
  assert.deepEqual(rodar({ skipped: 9, base: 9, tratou: false }), ['states.empty.title', 'states.empty.bodyNada']);
  // A linha de base é zerada quando a fila recomeça e ao carregar o placar.
  assert.match(fatiar('resetQueue'), /puladosNoInicioDaFila = AppState\.stats\.skipped \|\| 0;/);
  assert.match(APP_SEM, /loadStats\(\);\s*puladosNoInicioDaFila = AppState\.stats\.skipped \|\| 0;/);
});

test('o "Sair" cancela os códigos de pareamento que o aparelho emitiu', () => {
  const sair = fatiar('handleLogout');
  assert.match(sair, /for \(const code of pareamentosEmitidos\) API\.cancelarPareamento\(code\)/,
    'o QR mostrado antes do "Sair" segue valendo 5 min');
  assert.equal((APP_SEM.match(/pareamentosEmitidos\.add\(r\.code\);/g) || []).length, 2,
    'os DOIS códigos (QR e o curto) têm que ser lembrados');
});
