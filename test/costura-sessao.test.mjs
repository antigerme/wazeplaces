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
