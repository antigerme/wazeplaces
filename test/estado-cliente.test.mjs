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
    historyTodayKey: () => '2026-09-25', ondeAgora: () => '30',
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
    API: { getRegion: () => 'row', rejectPlace: () => new Promise((ok) => { soltar = ok; }) },
    scheduleAction: (tipo, place, ex) => agendadas.push(ex),
    presencaWmeDaAcao: () => null, callWithRetry: (fn) => fn(),
    presencaWmeAoResponder: () => efeitos.push('presenca'),
    handleActionResult: () => efeitos.push('resultado'),
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
  assert.deepEqual(efeitos, [], 'a resposta de depois do "Sair" gravou histórico/autor/fila de saída');
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
    enviarLote: /await callWithRetry\(\(\) => API\.rejectPlace\([^)]*\)\);\s*if \(epoca !== epocaDaSessao\) return;/,
    loadProfileAndAuxData: /API\.listCountries\(\)\s*\]\);\s*if \(epoca !== epocaDaSessao\) return;/,
    handleMarkAsRead: /API\.markAsRead\([^)]*\)\);\s*if \(epoca !== epocaDaSessao\) return;/,
    handleSkip: /API\.guardarPedido\([^)]*\)\);\s*if \(epoca !== epocaDaSessao\) return;/,
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
function montarTreino(estado = {}) {
  const log = [];
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: true,
    queue: [], currentPlace: null, stats: { read: 7, rejected: 3, skipped: 1 }, serverTotal: 40,
    preferences: { comoFuncionaVisto: false }, ...estado };
  const el = () => ({ classList: { replace() {}, add() {}, remove() {} }, textContent: '', children: [] });
  const deps = {
    AppState, document: { getElementById: el },
    removeUndoBanner: () => {}, savePreferences: () => log.push('prefs'), showLoading: () => {},
    updateStats: () => {}, updatePendingCount: () => {}, showCurrentPlace: () => log.push('card'),
    fecharCamadasDeFoto: () => {}, removeCurrentCardEl: () => {}, maybePrefetch: () => log.push('prefetch'),
    startFetching: () => log.push('busca'), showNoPlaces: () => log.push('vazio'),
    t: (k) => k, showToast: () => {}, openModal: () => {},
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
  const l = fatiar('loadProfileAndAuxData');
  assert.match(l, /const destino = await paisDoPerfil\(profileRes\.profile, epoca\);\s*if \(destino && epoca === epocaDaSessao\) await irProPaisDoPerfil\(destino\);/);
  const ir = fatiar('irProPaisDoPerfil');
  for (const re of [/API\.setCountry\(pais\);/, /AppState\.filters\.stateId = '';/, /saveFilters\(\);/, /resetQueue\(\);/, /startFetching\(\);/]) {
    assert.match(ir, re);
  }
});

// ── os filtros (auditoria de 2026-09-25) ─────────────────────────────────────
test('filtros: trocar a REGIÃO traz os países dela, e o "Aplicar" com lista carregando não apaga país nem estado', () => {
  assert.match(APP_SEM, /\$\('filterRegion'\)\.addEventListener\('change', async \(e\) => \{[\s\S]{0,400}const r = await API\.listCountries\(regiao\);/,
    'a troca de região no modal seguia com os países da região anterior');
  const aplicar = fatiar('applyFiltersFromModal');
  assert.match(aplicar, /if \(!\$\('filterState'\)\.dataset\.carregando\) AppState\.filters\.stateId = \$\('filterState'\)\.value;/);
  assert.match(aplicar, /if \(!\$\('filterCountry'\)\.dataset\.carregando && \$\('filterCountry'\)\.value\) API\.setCountry\(\$\('filterCountry'\)\.value\);/);
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
  assert.match(l, /presencaWmeAoCarregarPerfil\(profileRes\.visivelNoWme\);\s*aplicarRecusaAutomatica\(\);/,
    'a recusa automática (L6) não reage ao perfil que chegou depois da fila');
});

test('a queda da sessão com ação na janela do Desfazer GRAVA o placar revertido', () => {
  // O gesto grava o +1 na hora; o `cancel()` sem argumento reverte só em
  // memória. Quem fecha o app depois da queda ficava com um pedido a mais no
  // placar pra sempre (auditoria de 2026-09-25).
  const d = fatiar('derrubarSessao');
  const i = d.indexOf('AppState.pendingAction.cancel();');
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
      trocarTextoI18n: (e, k) => { if (e) e.attrs['data-i18n'] = k; },
    };
    const chaves = Object.keys(deps);
    const fn = new Function(...chaves, `let tratouNestaFila = ${tratou}; let puladosNoInicioDaFila = ${base};\n`
      + fatiar('showNoPlaces') + '\nreturn showNoPlaces;')(...chaves.map((k) => deps[k]));
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
