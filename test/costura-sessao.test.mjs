// A COSTURA entre os consertos do ciclo de vida da sessão e da conta
// (auditoria de 2026-09-26, rodada 3): cada rodada anterior consertou um pedaço
// — a época da sessão, a conta dona dos dados, a renovação pela extensão, a
// queda fechando as camadas —, e os defeitos daqui moravam ENTRE eles. Cada
// teste foi visto REPROVANDO com o conserto desfeito.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" que aceita qualquer chamada e anota o nome
// (`h.chamou`). Assim a função pode crescer sem o teste quebrar por detalhe,
// e o que importa pro caso é fornecido — e conferido — explicitamente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const APP = ler('js/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP_SEM = semComentario(APP);

function fatiarDe(fonte, nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    if (fonte[j] === '{') prof++;
    else if (fonte[j] === '}' && --prof === 0) {
      const corpo = fonte.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// Um "buraco negro": aceita qualquer propriedade e qualquer chamada, e anota as
// chamadas pelo caminho (`safeLS.get`, `document.getElementById`…).
function buracoNegro(nome, chamou) {
  const f = function () {};
  return new Proxy(f, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then' || typeof k !== 'string') return undefined;
      return buracoNegro(nome + '.' + k, chamou);
    },
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}

// `nomes`: as funções do app.js a rodar. `deps`: o que elas enxergam (funções
// e as variáveis de módulo — `epocaDaSessao`, `saiuNestaPagina`… —, que leem e
// escrevem direto no objeto). O resto é buraco negro, anotado em `chamou`.
function montar(nomes, deps, fonte = APP_SEM) {
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      return buracoNegro(k, chamou);
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map((n) => fatiarDe(fonte, n)).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}

const tique = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// ═══ K1 · a decisão de A não sai com o token de B ═════════════════════════════

test('K1: a retentativa confere a época ANTES de sair — a sessão que caiu no meio não manda o resto', async () => {
  const deps = { epocaDaSessao: 7, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1, 1], navigator: { onLine: true } };
  const { callWithRetry } = montar(['sessaoTrocou', 'callWithRetry'], deps);
  const tentativas = [];
  const fn = () => { tentativas.push(deps.epocaDaSessao); if (tentativas.length === 1) deps.epocaDaSessao++; return Promise.resolve({ success: false, errorCategory: 'transient' }); };
  const r = await callWithRetry(fn, 7);
  assert.deepEqual(tentativas, [7], 'a retentativa saiu depois de a sessão cair');
  assert.equal(r.errorCategory, 'session_changed');
  // CONTROLE: na MESMA sessão, a política de sempre (1 + 2 retentativas).
  tentativas.length = 0;
  const r2 = await callWithRetry(() => { tentativas.push(1); return Promise.resolve({ success: false, errorCategory: 'transient' }); }, deps.epocaDaSessao);
  assert.equal(tentativas.length, 3, 'a política de retentativa sumiu');
  assert.equal(r2.errorCategory, 'transient');
});

test('K1: a época do GESTO vale até pra PRIMEIRA tentativa, e o "Sair" (null) apaga o token velho mesmo assim', async () => {
  const deps = { epocaDaSessao: 3, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1, 1], navigator: { onLine: true } };
  const { callWithRetry } = montar(['sessaoTrocou', 'callWithRetry'], deps);
  let saiu = 0;
  const r = await callWithRetry(() => { saiu++; return Promise.resolve({ success: true }); }, 2);
  assert.equal(saiu, 0, 'um envio de outra época saiu');
  assert.equal(r.errorCategory, 'session_changed');
  const apagar = await callWithRetry(() => { saiu++; return Promise.resolve({ success: true }); }, null);
  assert.equal(saiu, 1, 'o "Sair" tem que apagar a sessão no servidor com o token explícito');
  assert.equal(apagar.success, true);
});

test('K1: o ✕ de A em voo, a sessão cai e a extensão renova com B — a retentativa NÃO sai com o token de B', async () => {
  const envios = [];
  const pendentes = [];
  let token = 'tok-A';
  const AppState = {
    authenticated: true, profile: { id: 'A' }, queue: [], currentPlace: null,
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 10,
    preferences: { undoEnabled: false }, pendingAction: null, inFlightActions: 0,
  };
  const deps = {
    AppState, epocaDaSessao: 0, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [5, 5],
    navigator: { onLine: true }, Treino: { ativo: false },
    API: {
      getRegion: () => 'row', getCountry: () => 30, getSession: () => token, setSession: (t) => { token = t; },
      rejectPlace: (v) => {
        if (!token) return Promise.resolve({ success: false, errorCategory: 'unauthorized' });
        envios.push({ v, token });
        return new Promise((ok) => pendentes.push(ok));
      },
    },
    acoesTravadas: () => !AppState.authenticated || !!AppState.pendingAction, direcaoTravada: () => false,
    canDisableUndo: () => true, UNDO_WINDOW_MS: 3000,
    advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; },
    presencaWmeDaAcao: () => null, marcarEmAndamento: () => {},
    // Segura a renovação: aqui ela é feita à mão, com o token de OUTRA conta.
    entrarPelaExtensao: () => new Promise(() => {}),
    console,
  };
  const h = montar(['sessaoTrocou', 'callWithRetry', 'scheduleAction', 'handleReject', 'derrubarSessao'], deps);
  const P = { venueID: 'v1', updateRequestID: 'u1', creatorId: 9 };
  AppState.queue = [P, { venueID: 'v2', updateRequestID: 'u2' }]; AppState.currentPlace = P;
  h.handleReject();                                  // A: ✕ (sem Desfazer: sai na hora)
  await tique(2);
  assert.equal(envios.length, 1);
  h.derrubarSessao('srv.err.cookiesExpired');         // a sessão de A cai...
  token = 'tok-B';                                    // ...e a extensão renova com B
  AppState.authenticated = true;
  pendentes[0]({ success: false, errorCategory: 'transient', httpCode: 502 });   // 1ª tentativa: 5xx
  await tique(40);
  assert.ok(!envios.some((e) => e.token === 'tok-B'), 'DEFEITO: a decisão de A foi enviada com o token de B: ' + JSON.stringify(envios));
});

// ═══ K1/K9 · sem sessão, nada decide ═════════════════════════════════════════

test('K1/K9: sem sessão (a queda, a renovação pela extensão) o ✕ ✓ ↑ não decide — e a queda TRAVA o card na tela', () => {
  const agendou = [];
  const AppState = { authenticated: true, profile: { id: 'A' }, currentPlace: { venueID: 'v1', updateRequestID: 'u1' },
    queue: [], stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 3, pendingAction: null, preferences: {} };
  const deps = {
    AppState, epocaDaSessao: 0, Treino: { ativo: false }, direcaoTravada: () => false,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    scheduleAction: (tipo) => agendou.push(tipo), API: { getRegion: () => 'row', getCountry: () => 30, setSession() {} },
    entrarPelaExtensao: () => new Promise(() => {}),
  };
  const h = montar(['acoesTravadas', 'handleReject', 'handleMarkAsRead', 'handleSkip', 'derrubarSessao'], deps);
  h.derrubarSessao('srv.err.cookiesExpired');
  assert.equal(AppState.authenticated, false);
  assert.ok(h.chamou.includes('aplicarTravaDeAcao'), 'a queda não reaplica a trava: os botões seguem com cara de vivos');
  h.handleReject(); h.handleMarkAsRead(); h.handleSkip();
  assert.deepEqual(agendou, [], 'DEFEITO: gesto aceito sem sessão — a decisão sairia com o token de quem entrasse');
  assert.deepEqual(AppState.stats, { read: 0, rejected: 0, skipped: 0 }, 'o placar contou um gesto recusado');
  // CONTROLE: com a sessão de volta, o mesmo gesto decide.
  AppState.authenticated = true;
  h.handleReject();
  assert.deepEqual(agendou, ['reject']);
});

test('K1: a sessão voltando (showMainScreen) DESTRAVA o card', () => {
  const AppState = { authenticated: false };
  const deps = { AppState, document: { getElementById: () => ({ classList: { add() {}, remove() {} } }) } };
  const h = montar(['showMainScreen'], deps);
  h.showMainScreen();
  assert.equal(AppState.authenticated, true);
  const i = h.chamou.indexOf('aplicarTravaDeAcao');
  assert.ok(i >= 0, 'a entrada não reaplica a trava: o card da renovação seguiria travado');
});

test('K9: a sessão cai DURANTE a saída do card (350 ms): o gesto não vale e o card que saiu VOLTA', () => {
  const agiu = [];
  const P = { venueID: 'v1', updateRequestID: 'u1' };
  const AppState = { authenticated: false, currentPlace: P, pendingAction: null };
  const deps = { AppState, aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null };
  const h = montar(['acoesTravadas', 'agirNoPedidoDoGesto'], deps);
  h.agirNoPedidoDoGesto(P, () => agiu.push('handler'));
  assert.deepEqual(agiu, [], 'o gesto recusado chegou ao handler');
  assert.ok(h.chamou.includes('showCurrentPlace'), 'DEFEITO: o card saiu da tela e não voltou — pedido na frente, invisível');
  // CONTROLE: com sessão, o gesto age e ninguém redesenha.
  const k = montar(['acoesTravadas', 'agirNoPedidoDoGesto'], { ...deps, AppState: { ...AppState, authenticated: true } });
  k.agirNoPedidoDoGesto(P, () => agiu.push('handler'));
  assert.deepEqual(agiu, ['handler']);
  assert.ok(!k.chamou.includes('showCurrentPlace'));
});

test('K1: sem sessão, as escritas do lightbox (excluir, aprovar, renomear pelo Enter) não abrem janela', () => {
  for (const autenticado of [false, true]) {
    const banners = [];
    const place = { venueID: 'v1', updateRequestID: 'u1', name: 'Nome Velho', lat: -23, lon: -46 };
    const deps = {
      AppState: { authenticated: autenticado, preferences: { undoEnabled: true }, currentPlace: null },
      Treino: { ativo: false }, canDisableUndo: () => false, podeRenomearAqui: () => true,
      Lightbox: { place, idx: 1, urls: ['a', 'b'], podeAprovarAtual: () => true, idFotoAtual: () => 'f1',
        marcarComoAprovada() {}, removerFoto() {} },
      document: { getElementById: (id) => (id === 'lightboxNomeInput' ? { value: 'Nome Novo' } : null) },
      aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
      mostrarDesfazer: (msg) => banners.push(msg), setTimeout: () => 1, clearTimeout() {}, UNDO_WINDOW_MS: 3000,
    };
    const h = montar(['pedirExclusaoDaFoto', 'aprovarFotoAtual', 'confirmarRenomear'], deps);
    h.pedirExclusaoDaFoto(); h.aprovarFotoAtual(); h.confirmarRenomear();
    if (!autenticado) assert.deepEqual(banners, [], 'DEFEITO: escrita do lightbox aberta sem sessão: ' + banners.join(', '));
    else assert.equal(banners.length, 3, 'CONTROLE: com sessão, as três abrem a janela do Desfazer');
  }
});

test('K1: sem sessão o lote do autor não sai, e diz por quê (não "espere o Desfazer")', () => {
  const agendou = [];
  const toasts = [];
  const deps = {
    AppState: { authenticated: false, pendingAction: null, queue: [], stats: { rejected: 0 } },
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    Treino: { ativo: false }, t: (k) => k, showToast: (m) => toasts.push(m),
    scheduleAction: () => agendou.push('lote'), pedidosDoAutorNaFila: () => [{ venueID: 'v1', updateRequestID: 'u1' }],
  };
  const h = montar(['acoesTravadas', 'rejeitarLoteDoAutor'], deps);
  h.rejeitarLoteDoAutor({ creatorId: 9 });
  assert.deepEqual(agendou, [], 'o lote saiu sem sessão');
  assert.deepEqual(toasts, ['api.error.noSession']);
});

// ═══ K1 (L6) · as escritas do lightbox não sobrevivem à sessão ═══════════════

function montarLightboxComJanelas() {
  const timers = [];
  const log = [];
  const place = { venueID: 'v1', updateRequestID: 'u1', name: 'Nome Velho', lat: -23, lon: -46 };
  const AppState = { authenticated: true, preferences: { undoEnabled: true }, currentPlace: null, pendingAction: null,
    stats: { read: 0, rejected: 0, skipped: 0 } };
  const deps = {
    AppState, epocaDaSessao: 0, Treino: { ativo: false }, canDisableUndo: () => false, podeRenomearAqui: () => true,
    Lightbox: { place, idx: 1, urls: ['a', 'b'], podeAprovarAtual: () => true, idFotoAtual: () => 'f1',
      marcarComoAprovada: () => log.push('marcou'), desmarcarAprovada: () => log.push('desmarcou'), removerFoto: () => log.push('removeu') },
    document: { getElementById: (id) => (id === 'lightboxNomeInput' ? { value: 'Nome Novo' } : null) },
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    aplicarNomeNaTela: (p, n) => log.push('nome:' + n), devolverFoto: () => log.push('devolveu'),
    enviarExclusao: () => log.push('ENVIOU:excluir'), enviarAprovacao: () => log.push('ENVIOU:aprovar'),
    enviarRenomeacao: () => log.push('ENVIOU:renomear'), registrarDesfazer: () => log.push('desfazer-do-editor'),
    mostrarDesfazer: () => log.push('banner'),
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, UNDO_WINDOW_MS: 3000,
    API: { getSession: () => 'tok-A', setSession() {}, getRegion: () => 'row', prepararExclusao() {},
      setRegion() {}, setCountry() {}, cancelarPareamento: () => Promise.resolve(), chamadas: [] },
    entrarPelaExtensao: () => new Promise(() => {}), console, pareamentosEmitidos: new Set(),
  };
  const h = montar(['acoesTravadas', 'pedirExclusaoDaFoto', 'aprovarFotoAtual', 'confirmarRenomear',
    'cancelarPendenciasDoLightbox', 'derrubarSessao', 'handleLogout'], deps);
  // As três janelas abertas, uma depois da outra (cada uma despacha a anterior,
  // então cada uma é aberta num lightbox "limpo").
  return { h, deps, timers, log, AppState };
}

for (const [nome, acabar] of [['a queda', (h) => h.derrubarSessao('srv.err.sessionExpired')], ['o "Sair"', (h) => h.handleLogout()]]) {
  test(`K1 (L6): ${nome} com escrita do lightbox na janela CANCELA a escrita e desfaz o que ela antecipou`, async () => {
    for (const abrir of ['pedirExclusaoDaFoto', 'aprovarFotoAtual', 'confirmarRenomear']) {
      const m = montarLightboxComJanelas();
      m.h[abrir]();
      assert.ok(m.log.includes('banner'), `${abrir}: a janela não abriu — o teste não mediria nada`);
      acabar(m.h);
      await tique();
      assert.equal(m.deps.exclusaoPendente || m.deps.aprovacaoPendente || m.deps.renomeacaoPendente, null,
        `${abrir}: a pendência sobreviveu a ${nome}`);
      for (const t of m.timers) t();                 // a janela "vence" depois
      assert.ok(!m.log.some((l) => l.startsWith('ENVIOU')), `DEFEITO (${abrir}): a escrita saiu depois de ${nome}: ${m.log.join(' ')}`);
      assert.ok(m.log.some((l) => ['devolveu', 'desmarcou', 'nome:Nome Velho'].includes(l)),
        `${abrir}: o que a escrita antecipou na tela não voltou`);
      assert.ok(!m.log.includes('desfazer-do-editor'), `${abrir}: o cancelamento do app contou como Desfazer do editor`);
    }
  });
}

test('K1 (L6): CONTROLE — sem a sessão acabar, a janela vence e a escrita SAI', () => {
  for (const abrir of ['pedirExclusaoDaFoto', 'aprovarFotoAtual', 'confirmarRenomear']) {
    const m = montarLightboxComJanelas();
    m.h[abrir]();
    for (const t of m.timers) t();
    assert.ok(m.log.some((l) => l.startsWith('ENVIOU')), `${abrir}: a escrita não saiu nem com a janela vencida`);
  }
});

// ═══ K7 · a ação em voo quando a sessão cai ═══════════════════════════════════

function lsFalso() {
  const guardado = new Map();
  return { guardado, safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) } };
}

function montarVoo() {
  const { safeLS, guardado } = lsFalso();
  const pendentes = [];
  const gravados = [];
  const AppState = {
    authenticated: true, profile: { id: 'A' }, currentPlace: null, queue: [],
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 10,
    preferences: { undoEnabled: false }, pendingAction: null, inFlightActions: 0,
  };
  let token = 'tok-A';
  const deps = {
    AppState, safeLS, epocaDaSessao: 0, navigator: { onLine: true }, Treino: { ativo: false },
    SAIDA_KEY: constante('SAIDA_KEY'), SAIDA_MAX: constante('SAIDA_MAX'), CONTA_KEY: constante('CONTA_KEY'),
    TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1, 1], UNDO_WINDOW_MS: 3000,
    API: {
      getRegion: () => 'row', getCountry: () => 30, getSession: () => token, setSession: (t) => { token = t; },
      rejectPlace: () => new Promise((ok) => pendentes.push(ok)), markAsRead: () => new Promise((ok) => pendentes.push(ok)),
    },
    direcaoTravada: () => false, canDisableUndo: () => true, presencaWmeDaAcao: () => null,
    advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; },
    saveStats: () => gravados.push({ ...AppState.stats }), msgDoServidor: (r, f) => f, t: (k) => k,
    historyTodayKey: () => '2026-09-26', ondeAgora: () => '30', getLang: () => 'pt',
    pedidosEmAndamento: new Set(), descargaNaFila: new WeakSet(),
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    entrarPelaExtensao: () => new Promise(() => {}), console,
  };
  const h = montar(['sessaoTrocou', 'callWithRetry', 'acoesTravadas', 'pousouNoWaze', 'descontarGestoSemSessao',
    'chaveDoPedido', 'marcaDaSessao', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'enfileirarSaida',
    'marcarNaSaida', 'tirarDaFilaDeSaida', 'marcarEmAndamento', 'handleActionResult', 'scheduleAction',
    'handleReject', 'handleMarkAsRead', 'derrubarSessao'], deps);
  const P = { venueID: 'v1', updateRequestID: 'u1', creatorId: 9 };
  AppState.queue = [P, { venueID: 'v2', updateRequestID: 'u2', creatorId: 9 }];
  AppState.currentPlace = P;
  return { h, deps, AppState, pendentes, gravados, guardado };
}

test('K7: o ✕/✓ em voo, a sessão cai e a resposta (401) chega depois — o +1 GRAVADO no placar volta', async () => {
  for (const [gesto, chave] of [['handleReject', 'rejected'], ['handleMarkAsRead', 'read']]) {
    const m = montarVoo();
    m.h[gesto]();
    await tique();
    assert.equal(m.gravados.at(-1)[chave], 1, 'o gesto gravou o +1');
    m.h.derrubarSessao('srv.err.cookiesExpired');
    m.pendentes[0]({ success: false, errorCategory: 'unauthorized', httpCode: 401 });
    await tique();
    assert.equal(m.gravados.at(-1)[chave], 0, `DEFEITO (${gesto}): o +1 ficou gravado sem a decisão ter pousado no Waze`);
    assert.equal(m.AppState.stats[chave], 0);
    assert.equal(m.h.carregarFilaDeSaida().length, 0, 'a resposta de outra época entrou na fila de saída');
  }
});

test('K7: CONTROLE — a mesma resposta ANTES da queda vai pra fila de saída e o placar fica', async () => {
  const m = montarVoo();
  m.h.handleReject();
  await tique();
  m.pendentes[0]({ success: false, errorCategory: 'unauthorized', httpCode: 401 });
  await tique();
  m.h.derrubarSessao('srv.err.cookiesExpired');
  assert.equal(m.h.carregarFilaDeSaida().length, 1, 'o que a pessoa fez evaporou');
  assert.equal(m.gravados.at(-1).rejected, 1);
});

test('K7: a decisão que POUSOU (sucesso ou "já tratado") depois da queda fica no placar', async () => {
  for (const r of [{ success: true }, { success: false, errorCategory: 'already_processed' }]) {
    const m = montarVoo();
    m.h.handleMarkAsRead();
    await tique();
    m.h.derrubarSessao('srv.err.cookiesExpired');
    m.pendentes[0](r);
    await tique();
    assert.equal(m.AppState.stats.read, 1, `${JSON.stringify(r)}: tirou do placar uma decisão que pousou`);
  }
});

test('K7: placar TROCADO depois do gesto (outra conta, "Sair") não é descontado pela resposta atrasada', async () => {
  const m = montarVoo();
  m.h.handleReject();
  await tique();
  m.h.derrubarSessao('srv.err.cookiesExpired');
  m.AppState.stats = { read: 0, rejected: 4, skipped: 0 };   // o placar de quem entrou
  m.pendentes[0]({ success: false, errorCategory: 'unauthorized', httpCode: 401 });
  await tique();
  assert.equal(m.AppState.stats.rejected, 4, 'a resposta de A descontou o placar de quem entrou depois');
});

test('K7: o LOTE manual com a sessão caindo no meio devolve só o placar otimista do que não pousou', async () => {
  const pendentes = [];
  const AppState = { authenticated: true, stats: { read: 0, rejected: 13, skipped: 0 }, queue: [], serverTotal: 20, inFlightActions: 0 };
  const deps = {
    AppState, epocaDaSessao: 0, navigator: { onLine: true }, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1, 1],
    API: { rejectPlace: () => new Promise((ok) => pendentes.push(ok)) },
    saveStats: () => {}, recordHistory: () => {}, registrarPouso: () => {}, registrarRejeicaoDeAutor: () => {},
  };
  const h = montar(['sessaoTrocou', 'callWithRetry', 'pousouNoWaze', 'descontarGestoSemSessao', 'enviarLote'], deps);
  // O lote de 4 já contou +4 no placar otimista (13 = 9 de antes + 4 do lote).
  const lote = [1, 2, 3, 4].map((i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i }));
  const envio = h.enviarLote(lote, { regiao: 'row', silencioso: true });
  await tique(); pendentes[0]({ success: true });           // 1º pousou
  await tique(); deps.epocaDaSessao++;                        // a sessão cai com o 2º no ar
  pendentes[1]({ success: false, errorCategory: 'unauthorized' });
  await envio;
  assert.equal(AppState.stats.rejected, 13 - 3, 'DEFEITO: o placar otimista dos 3 que não pousaram ficou');
});

// ═══ K2 · a renovação com OUTRA conta não mantém a fila nem o cabeçalho de A ══

function janelaFalsa() {
  const ouvintes = new Set();
  const w = {
    location: { origin: 'https://app' },
    addEventListener: (t, fn) => { if (t === 'message') ouvintes.add(fn); },
    removeEventListener: (t, fn) => ouvintes.delete(fn),
    postMessage: () => {},
    // O que a ponte da extensão responderia.
    responder: (data) => { for (const fn of [...ouvintes]) fn({ source: w, origin: w.location.origin, data }); },
  };
  return w;
}

function montarExtensao(extra = {}) {
  const window = janelaFalsa();
  const deps = {
    window, AppState: { authenticated: false, queue: [{ venueID: 'vA' }] }, epocaDaSessao: 1, saiuNestaPagina: false,
    extPerguntando: false, extNegado: null, extNegadoNestaPagina: false, filaAtravessouSessao: false,
    EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, setTimeout: () => 1, clearTimeout: () => {},
    API: { setSession: (t) => { deps.token = t; }, getSession: () => deps.token || null }, token: null,
    ...extra,
  };
  const h = montar(['entrarPelaExtensao'], deps);
  return { h, deps, window };
}

test('K2: a renovação da QUEDA mantém a fila (marcada como de outra sessão); a volta à aba começa uma NOVA', async () => {
  const q = montarExtensao();
  const p = q.h.entrarPelaExtensao({ silencioso: true, manterFila: true });
  q.window.responder({ source: 'wazeplaces-ext', action: 'sessao', token: 'tokB' });
  assert.equal(await p, true);
  assert.ok(!q.h.chamou.includes('resetQueue'), 'a renovação da queda jogou fora a fila de quem estava triando');
  assert.equal(q.deps.filaAtravessouSessao, true, 'a fila que atravessou a sessão não ficou marcada');
  // A volta à aba vem da TELA DE ENTRADA: silenciosa, mas com fila nova.
  const v = montarExtensao();
  const p2 = v.h.entrarPelaExtensao({ silencioso: true });
  v.window.responder({ source: 'wazeplaces-ext', action: 'sessao', token: 'tokB' });
  assert.equal(await p2, true);
  assert.ok(v.h.chamou.includes('resetQueue'), 'DEFEITO: a volta à aba manteve a fila da sessão que caiu');
});

test('K2: só a queda pede pra manter a fila — a volta à aba e a abertura não', () => {
  const chamadas = (APP_SEM.match(/entrarPelaExtensao\(\{[^}]*\}\)/g) || []);
  const comManter = chamadas.filter((c) => /manterFila/.test(c));
  assert.equal(comManter.length, 1, 'manter a fila é só da renovação da queda: ' + chamadas.join(' | '));
  assert.match(fatiarDe(APP_SEM, 'derrubarSessao'), /entrarPelaExtensao\(\{ silencioso: true, manterFila: true \}\)/);
});

test('K2: OUTRA conta revelada pelo perfil — a fila que atravessou a sessão sai e a de quem entrou é buscada', () => {
  for (const atravessou of [true, false]) {
    const deps = { AppState: { stats: {} }, filaAtravessouSessao: atravessou, safeLS: { remove() {} },
      carregarFilaDeSaida: () => [], window: {} };
    const h = montar(['esquecerOutraConta'], deps);
    h.esquecerOutraConta('222');
    const refez = h.chamou.includes('resetQueue') && h.chamou.includes('startFetching');
    if (atravessou) assert.ok(refez, 'DEFEITO: com a conta trocada, a fila da anterior seguiu na tela');
    else assert.ok(!h.chamou.includes('resetQueue'), 'fila nascida nesta sessão refeita: uma busca a mais no free tier');
  }
});

test('K2: a queda limpa o cabeçalho de quem estava (o perfil que chegar o redesenha)', () => {
  const deps = { AppState: { authenticated: true, pendingAction: null }, epocaDaSessao: 0,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    entrarPelaExtensao: () => new Promise(() => {}) };
  const h = montar(['derrubarSessao'], deps);
  h.derrubarSessao('srv.err.cookiesExpired');
  assert.ok(h.chamou.includes('limparCabecalhoDoPerfil'), 'DEFEITO: o nome e a foto de A seguem no cabeçalho durante e depois da renovação');
});

// ═══ K3 · o "Sair" no meio da renovação não é desfeito ═══════════════════════

test('K3: "Sair" com a extensão ainda respondendo — o token atrasado NÃO entra de novo', async () => {
  const sessoes = [];
  const window = janelaFalsa();
  const AppState = { authenticated: false, queue: [], stats: { read: 0, rejected: 0, skipped: 0 }, pendingAction: null };
  const deps = {
    window, AppState, epocaDaSessao: 1, saiuNestaPagina: false, extPerguntando: false, extNegado: null,
    extNegadoNestaPagina: false, filaAtravessouSessao: false, EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000,
    setTimeout: () => 1, clearTimeout: () => {}, pareamentosEmitidos: new Set(),
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    API: { setSession: (t) => sessoes.push(t), getSession: () => null, setRegion() {}, setCountry() {},
      cancelarPareamento: () => Promise.resolve(), chamadas: [] },
  };
  const h = montar(['entrarPelaExtensao', 'handleLogout'], deps);
  const p = h.entrarPelaExtensao({ silencioso: true, manterFila: true });   // a renovação da queda
  await h.handleLogout();                                                    // a pessoa toca "Sair"
  const antes = h.chamou.filter((c) => c === 'showMainScreen').length;
  window.responder({ source: 'wazeplaces-ext', action: 'sessao', token: 'tokA2' });
  assert.equal(await p, false, 'DEFEITO: a resposta atrasada da extensão contou como entrada');
  assert.ok(!sessoes.includes('tokA2'), 'DEFEITO: a sessão voltou depois do "Sair"');
  assert.equal(h.chamou.filter((c) => c === 'showMainScreen').length, antes, 'o app reabriu por cima da tela de entrada');
});

test('K3: CONTROLE — sem o "Sair" no meio, o mesmo token entra', async () => {
  const q = montarExtensao();
  const p = q.h.entrarPelaExtensao({ silencioso: true, manterFila: true });
  q.window.responder({ source: 'wazeplaces-ext', action: 'sessao', token: 'tokA2' });
  assert.equal(await p, true);
  assert.equal(q.deps.token, 'tokA2');
});

test('K3: a renovação que falha DEPOIS do "Sair" não diz "sua sessão expirou" nem refaz a tela', async () => {
  let soltar;
  const toasts = [];
  const deps = {
    AppState: { authenticated: true, pendingAction: null }, epocaDaSessao: 0,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    entrarPelaExtensao: () => new Promise((ok) => { soltar = ok; }), t: (k) => k, tirarNegadoDaExtensao: () => null,
    showToast: (m) => toasts.push(m), setTimeout: (fn) => { fn(); return 1; },
    MOTIVO_DA_QUEDA: constante('MOTIVO_DA_QUEDA'), UNAUTHORIZED_REDIRECT_MS: 0,
  };
  const h = montar(['derrubarSessao'], deps);
  h.derrubarSessao('srv.err.cookiesExpired');
  deps.epocaDaSessao++;                 // o "Sair" (o handleLogout sobe a época na 1ª linha)
  soltar(false);
  await tique();
  assert.deepEqual(toasts, [], 'DEFEITO: aviso de sessão expirada depois do "Sair"');
  assert.ok(!h.chamou.includes('fecharCamadasAbertas'), 'a queda refez a tela por cima da do "Sair"');
  // CONTROLE: sem o "Sair", a falha avisa e leva à entrada.
  const k = montar(['derrubarSessao'], { ...deps, epocaDaSessao: 0 });
  k.derrubarSessao('srv.err.cookiesExpired');
  soltar(false);
  await tique();
  assert.ok(toasts.includes('toast.sessionExpired.waze'));
  assert.ok(k.chamou.includes('fecharCamadasAbertas'));
});

test('K3: "Sair" DEPOIS de a renovação falhar e ANTES de a tela de entrada vir — a queda não a refaz', async () => {
  let soltar;
  const adiados = [];
  const deps = {
    AppState: { authenticated: true, pendingAction: null }, epocaDaSessao: 0,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    entrarPelaExtensao: () => new Promise((ok) => { soltar = ok; }), t: (k) => k, tirarNegadoDaExtensao: () => null,
    setTimeout: (fn) => { adiados.push(fn); return 1; },
    MOTIVO_DA_QUEDA: constante('MOTIVO_DA_QUEDA'), UNAUTHORIZED_REDIRECT_MS: 1200,
  };
  const h = montar(['derrubarSessao'], deps);
  h.derrubarSessao('srv.err.cookiesExpired');
  soltar(false);
  await tique();
  assert.equal(adiados.length, 1, 'CONTROLE: a tela de entrada não foi agendada — o teste não mediria nada');
  deps.epocaDaSessao++;                 // o "Sair" nos 1,2 s de espera
  adiados[0]();
  assert.ok(!h.chamou.includes('fecharCamadasAbertas'), 'DEFEITO: a queda refez a tela de entrada por cima da do "Sair"');
});

// ═══ K4 · a troca de conta zera a base dos pulados junto com o placar ════════

test('K4: B entra no aparelho de A (5 pulados) e pula 1 — a fila NÃO termina em "Tudo limpo!"', () => {
  const AppState = { stats: { read: 30, rejected: 40, skipped: 5 }, queue: [], loadError: false, currentPlace: null,
    pendingAction: null, inFlightActions: 0 };
  const deps = { AppState, puladosNoInicioDaFila: 5, tratouNestaFila: true, filaAtravessouSessao: false,
    safeLS: { remove() {} }, carregarFilaDeSaida: () => [], window: {},
    document: { getElementById: () => ({ classList: { contains: () => false } }) } };
  const h = montar(['esquecerOutraConta', 'puladosNestaFila', 'filaZeradaConfirmada'], deps);
  h.esquecerOutraConta('222');                  // o perfil revela B
  AppState.stats.skipped++;                     // B pula o último pedido da fila
  assert.equal(h.puladosNestaFila(), 1, 'DEFEITO: o pulado de B não conta — a base ainda é a da conta anterior');
  assert.equal(h.filaZeradaConfirmada(), false, 'a fila com um PULADO foi dada como limpa (conquista e confete)');
});
