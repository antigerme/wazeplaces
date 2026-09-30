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
  // Estado dos vizinhos que a trava lê (o lote de lidos da fila, a conferência
  // de 401 do lightbox): o buraco negro devolveria uma função, que é VERDADEIRA,
  // e travaria tudo. Quem quer medir um deles o passa nos `deps`.
  // E as escritas do lightbox no ar (a de foto sem janela, L24, e a renomeação
  // por local, L23), pelo mesmo motivo.
  for (const [k, v] of Object.entries({ loteDeLidosEmVoo: false, escritasConferindo: 0,
    aprovandoAgora: false, excluindoAgora: false, renomeacoesNoAr: new Set() })) if (!(k in deps)) deps[k] = v;
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
// Espera por CONDIÇÃO, com teto de tempo real. Um prazo fixo (`tique(30)`) mede a
// velocidade da máquina, não o resultado: a rede de mentira destes testes também
// anda por timer de verdade, e com a suíte inteira disputando a CPU o prazo do
// teste pode vencer antes do timer dela (o K14 reprovou uma vez assim).
async function ateQue(cond, rotulo, tetoMs = 5000) {
  const fim = performance.now() + tetoMs;
  while (!cond()) {
    if (performance.now() > fim) assert.fail(`${rotulo}: não aconteceu em ${tetoMs / 1000} s`);
    await tique(2);
  }
}

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
    // Cada escrita num lightbox "limpo": com a janela de uma aberta, a trava
    // (`acoesTravadas`) segura a seguinte — o `confirmarRenomear` a consulta
    // desde o L23, como o botão travado da pílula já fazia na tela.
    for (const abrir of ['pedirExclusaoDaFoto', 'aprovarFotoAtual', 'confirmarRenomear']) {
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
      // A trava e a renomeação no ar são as de verdade (o `confirmarRenomear` as
      // consulta, L23): o buraco negro devolveria "travado" pra tudo.
      const h = montar(['pedirExclusaoDaFoto', 'aprovarFotoAtual', 'confirmarRenomear', 'acoesTravadas', 'renomeacaoNoAr'], deps);
      h[abrir]();
    }
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
    'cancelarPendenciasDoLightbox', 'derrubarSessao', 'handleLogout', 'renomeacaoNoAr'], deps);
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

// `janela`: com a janela do Desfazer (a ação fica pendente até vencer); sem
// ela, o gesto sai na hora e fica EM VOO até o teste soltar a resposta.
function montarVoo({ janela = false } = {}) {
  const { safeLS, guardado } = lsFalso();
  const pendentes = [];
  const gravados = [];
  const AppState = {
    authenticated: true, profile: { id: 'A' }, currentPlace: null, queue: [],
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 10, fetchEpoch: 0,
    preferences: { undoEnabled: janela }, pendingAction: null, inFlightActions: 0,
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
    direcaoTravada: () => false, canDisableUndo: () => !janela, presencaWmeDaAcao: () => null,
    advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; },
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
    saveStats: () => gravados.push({ ...AppState.stats }), msgDoServidor: (r, f) => f, t: (k) => k,
    historyTodayKey: () => '2026-09-26', ondeAgora: () => '30', getLang: () => 'pt',
    pedidosEmAndamento: new Set(), descargaNaFila: new WeakSet(), anotadoAntesDoEnvio: new WeakSet(),
    pedidosQueEntraramNaFila: new Set(),
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    entrarPelaExtensao: () => new Promise(() => {}), console,
  };
  const h = montar(['sessaoTrocou', 'callWithRetry', 'acoesTravadas', 'pousouNoWaze', 'descontarGestoSemSessao',
    'chaveDoPedido', 'marcaDaSessao', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'enfileirarSaida',
    'marcarNaSaida', 'tirarDaFilaDeSaida', 'marcarEmAndamento', 'handleActionResult', 'scheduleAction',
    'anotarAntesDoEnvio', 'anotarSeAbriuASaida', 'decisaoDepoisDaQueda', 'devolverPedidoRecusado',
    'handleReject', 'handleMarkAsRead', 'derrubarSessao'], deps);
  const P = { venueID: 'v1', updateRequestID: 'u1', creatorId: 9 };
  AppState.queue = [P, { venueID: 'v2', updateRequestID: 'u2', creatorId: 9 }];
  AppState.currentPlace = P;
  return { h, deps, AppState, pendentes, gravados, guardado, P };
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

// ═══ V1 · a decisão que não saiu VOLTA como card na renovação da queda ════════
// A queda com a renovação pela extensão MANTÉM a fila na tela (`manterFila`). O
// que estava na janela do Desfazer era cancelado sem voltar pra ela, e a
// decisão EM VOO (✕/✓ e o "Rejeitar os N") que levava o 401 depois da queda só
// descontava o placar: o pedido não ia pro Waze nem voltava como card — já
// tinha passado pela fila, nenhuma busca o trazia, e a fila terminava em "Tudo
// limpo!" com ele pendente (auditoria de 2026-09-29, V1/O5/C1; medido no
// navegador com a renovação de verdade: s1, s3, s3b, s14, t3b, t3d).

test('V1: ✕ na janela do Desfazer e a sessão cai — o pedido VOLTA pra fila, com o placar e o "Restam" de antes', async () => {
  const m = montarVoo({ janela: true });
  m.h.handleReject();
  assert.ok(m.AppState.pendingAction, 'PRÉ-CONDIÇÃO: o ✕ está na janela do Desfazer');
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v2'], 'PRÉ-CONDIÇÃO: o gesto tirou o pedido da fila');
  m.h.derrubarSessao('srv.err.cookiesExpired');
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v1', 'v2'],
    'o pedido da janela sumiu: nem foi pro Waze, nem voltou pra fila que a renovação mantém');
  assert.equal(m.AppState.currentPlace && m.AppState.currentPlace.venueID, 'v1', 'o pedido voltou mas não está na tela');
  assert.equal(m.AppState.serverTotal, 10, 'o "Restam" não voltou junto');
  assert.equal(m.gravados.at(-1).rejected, 0, 'o placar revertido não foi gravado');
  assert.equal(m.pendentes.length, 0, 'a decisão cancelada saiu pro Waze');
});

test('V1: ✕/✓ EM VOO, a sessão cai e a resposta (401) chega depois — o pedido volta como o PRÓXIMO card', async () => {
  for (const gesto of ['handleReject', 'handleMarkAsRead']) {
    const m = montarVoo();
    m.h[gesto]();
    await tique();
    assert.equal(m.pendentes.length, 1, 'PRÉ-CONDIÇÃO: a decisão está no ar');
    m.h.derrubarSessao('srv.err.cookiesExpired');
    m.pendentes[0]({ success: false, errorCategory: 'unauthorized', httpCode: 401 });
    await tique();
    assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v2', 'v1'],
      `${gesto}: o pedido que não pousou sumiu da fila que a renovação mantém`);
    assert.equal(m.AppState.currentPlace.venueID, 'v2', `${gesto}: trocou o card da tela`);
    assert.equal(m.AppState.serverTotal, 10, `${gesto}: o "Restam" não acompanha o pedido que voltou`);
    assert.equal(m.h.carregarFilaDeSaida().length, 0, `${gesto}: a anotação da decisão ficou pra sair com a sessão de agora`);
  }
});

test('V1: CONTROLE — com a fila REFEITA desde o gesto (o "Sair", outra conta), nada volta', async () => {
  const m = montarVoo();
  m.h.handleReject();
  await tique();
  m.h.derrubarSessao('srv.err.cookiesExpired');
  m.AppState.fetchEpoch++;                                   // o `resetQueue` do "Sair" / da troca de conta
  m.AppState.queue = [{ venueID: 'v7', updateRequestID: 'u7' }];
  m.AppState.currentPlace = m.AppState.queue[0];
  m.pendentes[0]({ success: false, errorCategory: 'unauthorized', httpCode: 401 });
  await tique();
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v7'], 'o pedido da sessão anterior entrou na fila de outra');
  assert.equal(m.AppState.stats.rejected, 0, 'o placar do gesto que não pousou ficou');
  assert.equal(m.h.carregarFilaDeSaida().length, 0);
});

test('V1: a decisão EM VOO que POUSOU depois da queda não volta (e a anotação dela sai da fila de saída)', async () => {
  const m = montarVoo();
  m.h.handleReject();
  await tique();
  assert.equal(m.h.carregarFilaDeSaida().length, 1, 'PRÉ-CONDIÇÃO: a decisão foi anotada antes de sair (O2)');
  m.h.derrubarSessao('srv.err.cookiesExpired');
  m.pendentes[0]({ success: true });
  await tique();
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v2'], 'o pedido que pousou voltou como card');
  assert.equal(m.AppState.stats.rejected, 1);
  assert.equal(m.h.carregarFilaDeSaida().length, 0, 'a anotação da decisão que pousou ficou pra sair de novo');
});

function montarLoteDaQueda() {
  const pendentes = [];
  const naSaida = [];
  const log = [];
  const AppState = { authenticated: true, stats: { read: 0, rejected: 4, skipped: 0 }, serverTotal: 1, fetchEpoch: 0,
    queue: [{ venueID: 'v9', updateRequestID: 'u9' }], hasMore: false, inFlightActions: 0 };
  AppState.currentPlace = AppState.queue[0];
  const ch = (p) => p.venueID + '|' + p.updateRequestID;
  const deps = {
    AppState, epocaDaSessao: 0, navigator: { onLine: true }, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1, 1],
    API: { rejectPlace: () => new Promise((ok) => pendentes.push(ok)) },
    saveStats: () => {}, recordHistory: () => {}, registrarPouso: () => {}, registrarRejeicaoDeAutor: () => {},
    registrarAcaoConfirmada: () => {}, pedidosEmAndamento: new Set(), pedidosQueEntraramNaFila: new Set(),
    enfileirarSaida: (tipo, p) => { naSaida.push(ch(p)); return true; },
    tirarDaFilaDeSaida: (tipo, p) => { const i = naSaida.indexOf(ch(p)); if (i >= 0) naSaida.splice(i, 1); },
    carregarFilaDeSaida: () => naSaida.slice(),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; log.push('card'); },
    startFetching: () => log.push('busca'), mostrarResultadoDoLote: () => log.push('folha'),
  };
  const h = montar(['sessaoTrocou', 'callWithRetry', 'pousouNoWaze', 'descontarGestoSemSessao', 'chaveDoPedido',
    'marcarEmAndamento', 'devolverPedidoRecusado', 'enviarLote'], deps);
  // O "Rejeitar os 4": o gesto já tirou os 4 da fila e os contou no placar.
  const lote = [1, 2, 3, 4].map((i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i }));
  return { h, deps, AppState, pendentes, naSaida, log, lote };
}

test('V1: o "Rejeitar os N" EM VOO com a sessão caindo — os que não pousaram voltam pra fila da queda, em ordem', async () => {
  const m = montarLoteDaQueda();
  const envio = m.h.enviarLote(m.lote, { regiao: 'row' });
  await tique(); m.pendentes[0]({ success: true });           // o 1º pousou
  await tique(); m.deps.epocaDaSessao++;                      // a sessão cai com o 2º no ar
  m.pendentes[1]({ success: false, errorCategory: 'unauthorized' });
  await envio;
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v9', 'v2', 'v3', 'v4'],
    'os três que não pousaram sumiram da fila que a renovação mantém');
  assert.equal(m.AppState.serverTotal, 4, 'o "Restam" não acompanha os que voltaram');
  assert.equal(m.AppState.stats.rejected, 1, 'o placar otimista dos que não pousaram ficou');
  assert.deepEqual(m.naSaida, [], 'a anotação dos que não saíram ficou pra sair com a sessão de agora');
  assert.ok(!m.log.includes('folha'), 'a folha do resultado abriu depois da queda');
});

test('V1: CONTROLE — o lote em voo com a fila REFEITA (o "Sair"): nada volta, e nenhuma busca sai', async () => {
  const m = montarLoteDaQueda();
  const envio = m.h.enviarLote(m.lote, { regiao: 'row' });
  await tique(); m.pendentes[0]({ success: true });
  await tique(); m.deps.epocaDaSessao++; m.AppState.fetchEpoch++;
  m.AppState.queue = []; m.AppState.currentPlace = null; m.AppState.serverTotal = 0;
  m.pendentes[1]({ success: false, errorCategory: 'unauthorized' });
  await envio;
  assert.deepEqual(m.AppState.queue, [], 'o lote da sessão anterior entrou na fila de outra');
  assert.ok(!m.log.includes('busca'), 'o lote da sessão anterior mandou buscar na fila de outra');
  assert.equal(m.AppState.stats.rejected, 1);
});

test('V1: CONTROLE — o que o Waze RECUSOU antes da queda também não entra (nem busca) na fila de outra sessão', async () => {
  const m = montarLoteDaQueda();
  const envio = m.h.enviarLote(m.lote, { regiao: 'row' });
  await tique(); m.pendentes[0]({ success: false, errorCategory: 'unknown' });   // o 1º: recusa de verdade
  await tique(); m.deps.epocaDaSessao++; m.AppState.fetchEpoch++;               // o "Sair" com o 2º no ar
  m.AppState.queue = []; m.AppState.currentPlace = null; m.AppState.serverTotal = 0;
  m.pendentes[1]({ success: false, errorCategory: 'unauthorized' });
  await envio;
  assert.deepEqual(m.AppState.queue, [], 'o recusado da sessão anterior entrou na fila de outra');
  assert.ok(!m.log.includes('busca'), 'o recusado da sessão anterior mandou buscar na fila de outra');
});

// ═══ V6 · o "Marcar todos" de uma sessão que acabou não trava a próxima ═══════
// A trava do lote no ar (`loteDeLidosEmVoo`) não tinha época: com o lote
// pendurado (sinal ruim), sair e entrar de novo — ou a queda com a renovação —
// fazia a sessão NOVA nascer travada ("espere o lote terminar") até a resposta
// velha voltar, até 45 s (auditoria de 2026-09-29, medido no navegador: s7).
function montarLoteNaTrocaDeSessao() {
  const portoes = [];
  const { safeLS } = lsFalso();
  const P1 = { venueID: 'v1', updateRequestID: 'u1' };
  const AppState = { authenticated: true, profile: { id: 'A' }, queue: [P1, { venueID: 'v2', updateRequestID: 'u2' }],
    currentPlace: P1, stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 2, fetchEpoch: 0,
    pendingAction: null, inFlightActions: 0, preferences: {} };
  let token = 'tok-A';
  const deps = {
    AppState, safeLS, epocaDaSessao: 0, loteDeLidosContado: null, Treino: { ativo: false },
    LOTE_LIDOS_PEDACO: constante('LOTE_LIDOS_PEDACO'), pedidosEmAndamento: new Set(), pareamentosEmitidos: new Set(),
    API: { getRegion: () => 'row', getSession: () => token, setSession: (t) => { token = t; }, setRegion() {}, setCountry() {},
      markAsReadBatch: () => new Promise((ok) => portoes.push(ok)), destroySession: async () => ({ success: true }) },
    callWithRetry: (fn) => fn(), entrarPelaExtensao: () => new Promise(() => {}),
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, console,
  };
  const h = montar(['acoesTravadas', 'avisoDaTrava', 'openBatchReadConfirm', 'handleBatchMarkRead', 'marcarEmAndamento',
    'chaveDoPedido', 'derrubarSessao', 'handleLogout'], deps);
  const marcarTodos = () => { h.openBatchReadConfirm(); return h.handleBatchMarkRead(); };
  return { h, deps, AppState, portoes, marcarTodos };
}

test('V6: "Marcar todos" pendurado e a sessão cai — a sessão que VOLTA não nasce travada pelo lote dela', async () => {
  const m = montarLoteNaTrocaDeSessao();
  const velho = m.marcarTodos();
  await tique();
  assert.equal(m.h.avisoDaTrava(), 'toast.esperaLote', 'PRÉ-CONDIÇÃO: o lote está no ar e trava o card');
  m.h.derrubarSessao('srv.err.cookiesExpired');
  m.AppState.authenticated = true;                  // a renovação pela extensão
  assert.equal(m.h.acoesTravadas(), false, 'a sessão nova nasceu travada pelo lote da que caiu (até 45 s)');
  // Um lote NOVO, e o velho voltando no meio dele: o velho não solta a trava do
  // novo. (O novo leva só o que NÃO está em andamento — os do lote velho seguem
  // no ar; é a régua do V7 —, então um pedido que chegou depois.)
  m.AppState.queue.push({ venueID: 'v3', updateRequestID: 'u3' });
  const novo = m.marcarTodos();
  await tique();
  assert.equal(m.portoes.length, 2, 'PRÉ-CONDIÇÃO: o lote novo saiu');
  m.portoes[0]({ success: true });
  await velho;
  assert.equal(m.h.acoesTravadas(), true, 'o lote da sessão que caiu soltou a trava do lote da sessão nova');
  m.portoes[1]({ success: true });
  await novo;
  assert.equal(m.h.acoesTravadas(), false, 'o lote novo terminou e a trava ficou');
});

test('V6: o "Sair" com o lote no ar — quem entra não herda a trava', async () => {
  const m = montarLoteNaTrocaDeSessao();
  m.marcarTodos();
  await tique();
  assert.equal(m.h.avisoDaTrava(), 'toast.esperaLote', 'PRÉ-CONDIÇÃO: o lote está no ar');
  await m.h.handleLogout();
  m.AppState.authenticated = true;                  // entrou de novo, sem recarregar a página
  assert.equal(m.h.acoesTravadas(), false, 'a sessão de quem entrou nasceu travada pelo lote de quem saiu');
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

// A renovação da queda com OUTRA conta: a fila é trocada (`esquecerOutraConta`),
// e o "sua fila continua aqui" saía junto com o "outra conta entrou" — os dois
// avisos que o auditor viu juntos. De quem é a sessão nova, quem diz é a ponte
// (a versão que repassa a conta, K8) ou o perfil (a extensão de hoje).
async function renovarNaQueda({ contaNaPonte, perfil, contaDoPerfil, sairNaEspera = false }) {
  const { safeLS } = lsFalso();
  const CONTA_KEY = constante('CONTA_KEY');
  const window = janelaFalsa();
  const toasts = [];
  let token = 'tokA';
  let h = null;
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, queue: [{ venueID: 'vA' }],
    stats: { read: 0, rejected: 0, skipped: 0 } };
  const deps = {
    window, AppState, safeLS, CONTA_KEY, epocaDaSessao: 0, saiuNestaPagina: false,
    extPerguntando: false, extNegado: null, extNegadoNestaPagina: false, filaAtravessouSessao: false,
    puladosNoInicioDaFila: 0, saidaEsperandoConta: false,
    EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, setTimeout, clearTimeout,
    // O teto da espera pelo perfil, curto aqui (o caso do perfil que nunca chega).
    AVISO_RENOVADA_ESPERA_PERFIL_MS: 30,
    API: { setSession: (t) => { token = t; }, getSession: () => token },
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    showToast: (m) => toasts.push(m), t: (k) => k, carregarFilaDeSaida: () => [],
    // O contrato do `resetQueue` que importa aqui: a fila na tela passa a ser OUTRA.
    resetQueue: () => { AppState.fetchEpoch++; },
    // A carga do perfil que a renovação dispara: chega (e diz a conta), falha, ou nunca volta.
    loadProfileAndAuxData: () => new Promise((ok) => {
      if (perfil === 'nunca') return;
      setTimeout(() => { if (perfil === 'chega') h.aoConhecerConta({ id: contaDoPerfil }); ok(); }, 5);
    }),
  };
  h = montar(['derrubarSessao', 'entrarPelaExtensao', 'conhecerContaDoLogin', 'aoConhecerConta',
    'esquecerOutraConta', 'marcaDaSessao'], deps);
  safeLS.set(CONTA_KEY, JSON.stringify({ id: '111', s: marcaDe('tokA') }));   // A estava triando
  h.derrubarSessao('srv.err.cookiesExpired');
  window.responder({ source: 'wazeplaces-ext', action: 'sessao', token: 'tokB',
    ...(contaNaPonte ? { conta: contaNaPonte } : {}) });
  assert.equal(token, 'tokB', 'pré-condição: a renovação não entrou');
  if (sairNaEspera) { await tique(); deps.epocaDaSessao++; }   // a 1ª linha do "Sair"
  await tique(80);
  return toasts;
}

test('K2: renovação da queda com OUTRA conta — o "sua fila continua aqui" não sai junto com o da troca (pela ponte e pelo perfil)', async () => {
  for (const caso of [{ contaNaPonte: '222', perfil: 'chega', contaDoPerfil: '222' },     // a ponte nova diz
    { contaNaPonte: null, perfil: 'chega', contaDoPerfil: '222' }]) {                   // a de hoje: o perfil diz
    const toasts = await renovarNaQueda(caso);
    assert.ok(toasts.includes('toast.outraConta'), 'pré-condição: a troca de conta não foi detectada: ' + JSON.stringify(caso));
    assert.ok(!toasts.includes('toast.sessionRenewed'),
      `DEFEITO (${caso.contaNaPonte ? 'ponte' : 'perfil'}): "sua fila continua aqui" junto com "outra conta entrou" — a fila já tinha sido trocada: ${toasts.join(' | ')}`);
  }
});

test('K2: CONTROLE — a MESMA conta, o perfil que falha e o que nunca chega: a fila continua, e o aviso é esse', async () => {
  for (const caso of [{ contaNaPonte: '111', perfil: 'chega', contaDoPerfil: '111' },
    { contaNaPonte: null, perfil: 'chega', contaDoPerfil: '111' },
    { contaNaPonte: null, perfil: 'falha' },
    { contaNaPonte: null, perfil: 'nunca' }]) {                  // o teto da espera
    const toasts = await renovarNaQueda(caso);
    assert.deepEqual(toasts, ['toast.sessionRenewed'], 'a fila continuou e o aviso não saiu: ' + JSON.stringify(caso));
  }
});

test('K2/K3: "Sair" enquanto o aviso de renovação espera o perfil — ele não sai depois do "Sair"', async () => {
  const toasts = await renovarNaQueda({ contaNaPonte: null, perfil: 'nunca', sairNaEspera: true });
  assert.deepEqual(toasts, [], 'DEFEITO: "Acesso renovado… sua fila continua aqui" depois do "Sair": ' + toasts.join(' | '));
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

// ═══ K5 · desligar a presença sem o perfil ═══════════════════════════════════

function montarPresencaWme(perfil = null) {
  const enviados = [];
  const AppState = { profile: perfil, preferences: { presenca: true }, stats: {} };
  const presencaWme = { ligarNaProxima: true, desligarPendente: false, ultimaEm: 0, perfilVisivel: null, perfilEm: 0 };
  const deps = {
    AppState, presencaWme, dfato: () => {},
    API: { getSession: () => 'tok-A', presencaWaze: async (c) => { enviados.push(c); return { success: true }; } },
    filaAtravessouSessao: false, safeLS: { remove() {} }, carregarFilaDeSaida: () => [], window: {},
  };
  const h = montar(['presencaWmeDesligar', 'presencaWmeRefazerDesligar', 'presencaWmeAoCarregarPerfil',
    'presencaWmeZerar', 'definirPerfil', 'esquecerOutraConta'], deps);
  return { h, deps, enviados, AppState, presencaWme };
}

test('K5: desligar o "Ver quem está no app" SEM o perfil (aberto sem rede) — o "invisível" sai quando o perfil chega', async () => {
  const m = montarPresencaWme(null);
  m.AppState.preferences.presenca = false;     // o interruptor
  m.h.presencaWmeDesligar();
  assert.equal(m.presencaWme.desligarPendente, true, 'o desligar sem perfil não ficou pendente');
  m.h.presencaWmeRefazerDesligar();             // a rede volta ANTES de o perfil ser gravado
  assert.equal(m.presencaWme.desligarPendente, true, 'a prova de rede sem perfil apagou o pendente');
  m.h.definirPerfil({ success: true, visivelNoWme: true, profile: { id: 111 } });
  await tique();
  assert.deepEqual(m.enviados, [{ userId: '111', visivel: false }],
    'DEFEITO: o desligar feito antes do perfil nunca foi pro WME — a pessoa segue visível lá');
  assert.equal(m.presencaWme.desligarPendente, false);
});

test('K5: o "invisível" pendente de A NÃO sai pra outra conta que entrar no aparelho', async () => {
  const m = montarPresencaWme(null);
  m.AppState.preferences.presenca = false;
  m.h.presencaWmeDesligar();                    // A, sem perfil: pendente
  m.h.esquecerOutraConta('222');                // o perfil revela B
  m.AppState.profile = { id: 222 };
  m.h.presencaWmeRefazerDesligar();
  await tique();
  assert.deepEqual(m.enviados, [], 'DEFEITO: o app desligou a visibilidade de B no WME sem o gesto dela');
});

test('K5: CONTROLE — sem perfil e com o interruptor LIGADO de novo, nada fica pendente nem sai', async () => {
  const m = montarPresencaWme(null);
  m.AppState.preferences.presenca = false;
  m.h.presencaWmeDesligar();
  m.AppState.preferences.presenca = true;       // religou antes de o perfil chegar
  m.h.definirPerfil({ success: true, visivelNoWme: true, profile: { id: 111 } });
  await tique();
  assert.deepEqual(m.enviados, [], 'desligou quem religou');
});

// ═══ K6 · a fila guardada do offline tem DONO ═══════════════════════════════

const marcaDe = new Function(fatiarDe(APP_SEM, 'marcaDaSessao') + '\nreturn marcaDaSessao;')();

function montarReabertura({ token, contaGuardada = null, perfil = null, fila }) {
  const { safeLS } = lsFalso();
  if (contaGuardada) safeLS.set('waze_places_conta', JSON.stringify(contaGuardada));
  const AppState = { profile: perfil, authenticated: true, queue: [], hasMore: false, loadError: true, serverTotal: 0,
    preferences: { offlineDisponivel: true } };
  const deps = {
    AppState, safeLS, navigator: { onLine: false }, CONTA_KEY: constante('CONTA_KEY'),
    API: { getSession: () => token, getRegion: () => 'row', getCountry: () => 30 },
    offlineLigado: () => true, offlineLerFila: async () => fila, offlineLerJanela: async () => null,
    lugarAgora: () => ({ regiao: 'row', pais: '30' }), offlineJanelaServida: null, filaDeOnde: null,
    semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
    pedidosQueEntraramNaFila: new Set(),
  };
  return montar(['marcaDaSessao', 'contaAgora', 'mesmoLugar', 'filaGuardadaDestaConta', 'offlineTentarAbrirSemRede'], deps);
}
const FILA = (dono) => ({ t: Date.now(), desde: Date.now(), regiao: 'row', pais: '30', ...dono,
  places: [{ venueID: 'vA1', updateRequestID: 'uA1' }] });

test('K6: reaberta sem rede numa sessão de B (perfil a caminho), a fila guardada de A NÃO entra', async () => {
  const h = montarReabertura({ token: 'tok-B', contaGuardada: { id: '111', s: marcaDe('tok-A') },
    fila: FILA({ conta: '111', s: marcaDe('tok-A') }) });
  assert.equal(await h.offlineTentarAbrirSemRede(), false, 'DEFEITO: a fila da conta anterior abriu na sessão de B');
  assert.deepEqual(h.deps.AppState.queue, []);
  assert.ok(h.chamou.includes('dfato'));
});

test('K6: CONTROLE — a MESMA sessão reaberta sem rede abre a fila dela (com ou sem a conta gravada)', async () => {
  const comConta = montarReabertura({ token: 'tok-A', contaGuardada: { id: '111', s: marcaDe('tok-A') },
    fila: FILA({ conta: '111', s: marcaDe('tok-A') }) });
  assert.equal(await comConta.offlineTentarAbrirSemRede(), true, 'a fila da própria conta não abriu');
  // Gravada antes de o perfil chegar: sem conta, mas da mesma sessão.
  const semConta = montarReabertura({ token: 'tok-A', fila: FILA({ conta: null, s: marcaDe('tok-A') }) });
  assert.equal(await semConta.offlineTentarAbrirSemRede(), true, 'a fila desta sessão, gravada sem conta, não abriu');
  // A mesma conta numa sessão NOVA, já conhecida: abre.
  const renovada = montarReabertura({ token: 'tok-A2', contaGuardada: { id: '111', s: marcaDe('tok-A2') },
    fila: FILA({ conta: '111', s: marcaDe('tok-A') }) });
  assert.equal(await renovada.offlineTentarAbrirSemRede(), true, 'a fila da mesma conta, em outra sessão, não abriu');
});

test('K6: fila guardada sem dono (versão anterior) não entra — não há como saber de quem é', async () => {
  const h = montarReabertura({ token: 'tok-A', contaGuardada: { id: '111', s: marcaDe('tok-A') }, fila: FILA({}) });
  assert.equal(await h.offlineTentarAbrirSemRede(), false);
});

test('K6: a fila é gravada com a conta e a sessão de quem a buscou', async () => {
  const puts = [];
  const deps = {
    AppState: { queue: [{ venueID: 'v1' }], filters: {}, profile: { id: 111 } }, Treino: { ativo: false },
    offlineLigado: () => true, OFFLINE_STORE: 'fila', filaDeOnde: null, lugarAgora: () => ({ regiao: 'row', pais: '30' }),
    safeLS: { get: () => null }, CONTA_KEY: constante('CONTA_KEY'), API: { getSession: () => 'tok-A' },
    offlineDB: async () => ({ close() {}, transaction: () => {
      const tx = { objectStore: () => ({ put: (v) => { puts.push(v); setTimeout(() => tx.oncomplete()); } }) };
      return tx;
    } }),
  };
  const h = montar(['marcaDaSessao', 'contaAgora', 'offlineGravarFila'], deps);
  assert.equal(await h.offlineGravarFila(), true);
  assert.equal(puts[0].conta, '111', 'a fila guardada não diz de que conta é');
  assert.equal(puts[0].s, marcaDe('tok-A'), 'a fila guardada não diz de que sessão é');
});

// ═══ K8 · a conta é conhecida NA HORA do login ═══════════════════════════════

const NETSCAPE = (d, n, v) => `${d}\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NETSCAPE('.waze.com', '_csrf_token', 'csrf-abc'), NETSCAPE('.waze.com', '_web_session', 'sess-xyz')].join('\n');

test('K8 (servidor): o `testar-cookies` devolve de QUEM é a sessão — o portão já leu o perfil', async () => {
  const { dispatch, makeSessions } = await import('../server/core.mjs');
  const { storeEmMemoria } = await import('./_sessao.mjs');
  const sessions = makeSessions({ store: storeEmMemoria(), keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 12444348, userName: 'contaA', rank: 5, isAreaManager: true }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const r = await dispatch('testar-cookies', { cookies: COOKIES, region: 'row' }, { sessions });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
    assert.equal(r.body.conta, '12444348', 'DEFEITO: o login não diz de quem é a sessão — o app só saberia com o /perfil');
  } finally { globalThis.fetch = original; }
});

test('K8 (servidor): o pareamento leva a conta, CIFRADA, e o resgate a devolve', async () => {
  const { dispatch } = await import('../server/core.mjs');
  const { sessaoDeTeste } = await import('./_sessao.mjs');
  const s = await sessaoDeTeste(COOKIES);
  const criado = await dispatch('parear', { action: 'create', ...s.dados, conta: '987654321012' }, s.ctx);
  assert.equal(criado.status, 200);
  const registro = [...s.store.mem].find(([k]) => k.startsWith('pair_'));
  assert.ok(registro, 'CONTROLE: o registro do pareamento não foi gravado');
  assert.ok(!registro[1].includes('987654321012'), 'a conta foi gravada em claro no store, ao lado do dado cifrado');
  const resgate = await dispatch('parear', { action: 'claim', code: criado.body.code }, s.ctx);
  assert.equal(resgate.body.success, true);
  assert.equal(resgate.body.conta, '987654321012', 'DEFEITO: o aparelho que resgata não sabe de quem é a sessão');
  // Sem conta (ou fora do formato), o resgate diz que não sabe — nunca inventa.
  // E o que não é conta nem chega a ser gravado: o corpo vem do cliente, e o
  // store não guarda texto arbitrário dele.
  for (const conta of [undefined, 'x; drop', '12345678901234567890123']) {
    const c = await dispatch('parear', { action: 'create', ...s.dados, ...(conta !== undefined ? { conta } : {}) }, s.ctx);
    const reg = [...s.store.mem].find(([k]) => k.startsWith('pair_'));
    assert.equal(reg[1].split('|').length, 2, `conta ${JSON.stringify(conta)} foi gravada no registro`);
    const r = await dispatch('parear', { action: 'claim', code: c.body.code }, s.ctx);
    assert.equal(r.body.success, true);
    assert.equal(r.body.conta, null, `conta ${JSON.stringify(conta)} passou`);
  }
});

function montarLoginDeB({ contaNoLogin }) {
  const { safeLS, guardado } = lsFalso();
  safeLS.set('waze_places_conta', JSON.stringify({ id: '111', s: marcaDe('tok-A') }));   // os dados de A
  const log = [];
  let token = null;
  const AppState = { profile: null, authenticated: false, stats: { read: 7, rejected: 9, skipped: 0 }, history: null, queue: [] };
  const deps = {
    AppState, safeLS, epocaDaSessao: 0, authInFlight: false, filaAtravessouSessao: false, saidaEsperandoConta: false,
    CONTA_KEY: constante('CONTA_KEY'), SAIDA_KEY: constante('SAIDA_KEY'), HISTORY_KEY: constante('HISTORY_KEY'),
    CONQUISTAS_KEY: constante('CONQUISTAS_KEY'), t: (k) => k, window: {},
    API: { getSession: () => token, testCookies: async () => { token = 'tok-B'; return { success: true, sessionToken: 'tok-B', ...(contaNoLogin ? { conta: '222' } : {}) }; } },
    showMainScreen: () => { AppState.authenticated = true; },
    esquecerAutores: () => log.push('autores-apagados'),
    // O Histórico de verdade é um balde por dia; aqui basta o total.
    recordHistory: (tipo, n) => { AppState.history = AppState.history || { _total: { rejected: 0 } }; AppState.history._total.rejected += n; },
    registrarRejeicaoDeAutor: () => log.push('autor-de-B'),
  };
  const h = montar(['marcaDaSessao', 'contaAgora', 'conhecerContaDoLogin', 'aoConhecerConta', 'esquecerOutraConta',
    'carimbarContaNaSaida', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'authenticateWithCookies'], deps);
  return { h, AppState, log, guardado };
}

test('K8: B entra por cookies no aparelho de A — o que B faz ANTES do perfil chegar NÃO some com os dados de A', async () => {
  const m = montarLoginDeB({ contaNoLogin: true });
  await m.h.authenticateWithCookies(COOKIES);
  assert.deepEqual(m.AppState.stats, { read: 0, rejected: 0, skipped: 0 }, 'o placar de A ficou pra B');
  // B rejeita 2 antes de o perfil chegar (o gesto e a confirmação do Waze).
  m.AppState.stats.rejected += 2;
  m.AppState.history = { _total: { rejected: 2 } };
  // O perfil de B chega.
  m.h.aoConhecerConta({ id: 222 });
  assert.equal(m.AppState.stats.rejected, 2, 'DEFEITO: as rejeições de B (que pousaram no Waze) foram apagadas como se fossem de A');
  assert.equal(m.AppState.history && m.AppState.history._total.rejected, 2, 'o Histórico de B sumiu');
  assert.equal(JSON.parse(m.guardado.get('waze_places_conta')).id, '222');
});

test('K8: CONTROLE — sem a conta no login (servidor antigo), é o perfil que revela a troca, como antes', async () => {
  const m = montarLoginDeB({ contaNoLogin: false });
  await m.h.authenticateWithCookies(COOKIES);
  assert.equal(m.AppState.stats.rejected, 9, 'sem a conta, nada é apagado no login (não se sabe de quem é)');
  m.h.aoConhecerConta({ id: 222 });
  assert.equal(m.AppState.stats.rejected, 0, 'o perfil revelou outra conta e o placar de A ficou');
});

test('K8: o resgate do pareamento e a ponte da extensão também dizem a conta — e a ponte só no formato do servidor', async () => {
  const conhecidas = [];
  const conhecer = montar(['conhecerContaDoLogin'], { aoConhecerConta: (p) => conhecidas.push(p.id) });
  for (const c of ['222', 222, null, undefined, 'x', '1'.repeat(20), { id: 1 }]) conhecer.conhecerContaDoLogin(c);
  assert.deepEqual(conhecidas, ['222', '222'], 'passou conta fora do formato (a ponte é postMessage)');
  // O resgate chama com a conta que o servidor devolveu.
  const r = montar(['resgatarPareamento'], {
    API: { resgatarPareamento: async () => ({ success: true, sessionToken: 'tok-B', conta: '222' }) },
    document: { getElementById: () => null }, conhecerContaDoLogin: (c) => conhecidas.push('resgate:' + c),
    resgateEmVoo: false,   // a trava do duplo envio (test/contas-abas, A7): nenhum resgate no ar
  });
  assert.equal(await r.resgatarPareamento('ABC234'), true);
  assert.ok(conhecidas.includes('resgate:222'), 'o resgate do pareamento ignora a conta devolvida');
  // A ponte repassa a conta junto do token.
  const q = montarExtensao({ conhecerContaDoLogin: (c) => conhecidas.push('ponte:' + c) });
  const p = q.h.entrarPelaExtensao({ silencioso: true, manterFila: true });
  q.window.responder({ source: 'wazeplaces-ext', action: 'sessao', token: 'tokB', conta: '222' });
  assert.equal(await p, true);
  assert.ok(conhecidas.includes('ponte:222'), 'a conta que a ponte repassa foi ignorada');
  assert.match(ler('extensao-chrome/ponte.js'), /action: 'sessao', token: r\.sessionToken, conta: r\.conta/,
    'a ponte da extensão não repassa a conta do `testar-cookies`');
});

// ═══ K10 · o texto digitado é da conversa, não do campo ═════════════════════

const PRES_SEM = semComentario(ler('js/presenca.js'));

function montarConversas() {
  const campo = { value: '', focus() {} };
  // O estado que o `presencaAbrirConversa` lê, com a forma do de verdade (as
  // fotos que falharam nesta conversa e o nome guardado de quem se abriu).
  const Presenca = { aberta: null, anexo: null, conversas: [], online: [], vivas: new Map(), rascunhos: new Map(), rascunhoDe: null,
    fotosFalhas: new Set(), nomeDaAberta: null };
  const deps = { Presenca, PRESENCA_ID: /^\d{1,19}$/, document: { getElementById: (id) => (id === 'conversaInput' ? campo : null) } };
  const h = montar(['presencaAbrirConversa', 'presencaTrocarRascunho', 'presencaEsquecer'], deps, PRES_SEM);
  const fechar = () => { Presenca.aberta = null; Presenca.anexo = null; };   // o que o `presencaEsquecerAberta` faz
  return { h, campo, Presenca, fechar };
}

test('K10: o que foi digitado pra X não aparece — nem sai — na conversa com Y', () => {
  const m = montarConversas();
  m.h.presencaAbrirConversa('333');
  m.campo.value = 'pergunta pra X, sem enviar';
  m.fechar();
  m.h.presencaAbrirConversa('444');
  assert.equal(m.campo.value, '', 'DEFEITO: o texto digitado pra X está no campo da conversa com Y (e o Enviar o mandaria a Y)');
  m.campo.value = 'oi, Y';
  m.fechar();
  // A MESMA conversa de volta (é o que a queda de sessão preserva): o texto dela volta.
  m.h.presencaAbrirConversa('333');
  assert.equal(m.campo.value, 'pergunta pra X, sem enviar', 'o rascunho de X se perdeu ao passar por Y');
  m.h.presencaAbrirConversa('444');
  assert.equal(m.campo.value, 'oi, Y');
});

test('K10: fechar e reabrir a MESMA conversa (a queda de sessão) mantém o texto no campo', () => {
  const m = montarConversas();
  m.h.presencaAbrirConversa('333');
  m.campo.value = 'outra pra X';
  m.fechar();                                   // a queda fecha a conversa
  m.h.presencaAbrirConversa('333');             // a mesma conta entra de novo e abre X
  assert.equal(m.campo.value, 'outra pra X');
});

test('K10: o "Sair" (e a troca de conta) leva os rascunhos junto', () => {
  const m = montarConversas();
  m.h.presencaAbrirConversa('333');
  m.campo.value = 'rascunho de A pra X';
  m.fechar();
  m.h.presencaAbrirConversa('444');
  m.h.presencaEsquecer();
  m.h.presencaAbrirConversa('333');
  assert.equal(m.campo.value, '', 'o rascunho da conta que saiu voltou pra quem entrou');
});

// ═══ K11 · os países da abertura não somem com o 401 passageiro do perfil ════

test('K11: o 1º perfil barrado por um 401 passageiro — os países que chegaram BEM ficam, e o aviso sai com o nome', async () => {
  const toasts = [];
  let perfilN = 0;
  let pais = 30;
  const AppState = { profile: null, authenticated: true, countries: [], statesByCountry: {}, filters: { myArea: false, stateId: '', managedAreaId: '' },
    currentPlace: null, queue: [] };
  const deps = {
    AppState, epocaDaSessao: 0, perfilPedidoEm: 0, verificandoSessao: false, sessaoVivaEm: { s: null, em: 0 },
    VERIFICA_SESSAO_MS: 0, setTimeout: (f) => { f(); return 1; }, REGIOES_DO_WAZE: ['row', 'na', 'il'],
    API: {
      getSession: () => 'tok-A', getRegion: () => 'row', getCountry: () => pais, setCountry: (p) => { pais = p; }, setRegion() {},
      getProfile: async () => (perfilN++ === 0
        ? { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.sessionMissing' }   // o blip do KV
        : { success: true, profile: { id: 111, userName: 'a', editableCountryIDs: [73] } }),      // edita na França
      listCountries: async () => ({ success: true, countries: [{ id: 30, name: 'Brazil' }, { id: 73, name: 'France' }] }),
    },
    t: (k, v) => k + (v && v.pais ? '(' + v.pais + ')' : ''), showToast: (m) => toasts.push(m),
    aoConhecerConta: () => {}, marcarSessaoViva: () => {},
  };
  const h = montar(['loadProfileAndAuxData', 'handleUnauthorized', 'definirPerfil', 'completarPerfilChegado',
    'paisDoPerfil', 'irProPaisDoPerfil'], deps);
  await h.loadProfileAndAuxData();
  await tique(20);
  assert.equal(AppState.countries.length, 2, 'DEFEITO: os países que chegaram na abertura foram jogados fora');
  assert.ok(toasts.includes('toast.paisDoPerfil(France)'), 'o aviso do país saiu sem o nome: ' + toasts.join(' | '));
});

// ═══ K12 · a ida pro país do perfil confere a sessão depois do await ═════════

function montarIrProPais() {
  const guardado = { regiao: 'row', pais: '30' };
  const toasts = [];
  let soltar;
  const AppState = { authenticated: true, statesByCountry: {}, countries: [], filters: { stateId: '9', managedAreaId: '' } };
  const deps = {
    AppState, epocaDaSessao: 0, t: (k) => k, showToast: (m) => toasts.push(m),
    API: {
      getRegion: () => guardado.regiao, setRegion: (r) => { guardado.regiao = r; },
      getCountry: () => Number(guardado.pais), setCountry: (p) => { guardado.pais = String(p); },
      // Como o `API.listCountries` de verdade: sem a região, vale a GRAVADA.
      listCountries: (regiao) => new Promise((ok) => {
        const de = regiao || guardado.regiao;
        soltar = () => ok({ success: true, countries: de === 'na' ? [{ id: 235, name: 'United States' }] : [{ id: 30, name: 'Brazil' }] });
      }),
    },
  };
  const h = montar(['irProPaisDoPerfil'], deps);
  return { h, deps, guardado, toasts, soltar: () => soltar() };
}

test('K12: "Sair" durante a espera da lista de países — o país de quem saiu não volta, nem o aviso', async () => {
  const m = montarIrProPais();
  const p = m.h.irProPaisDoPerfil({ regiao: 'na', pais: 235 });   // A edita nos EUA
  m.deps.epocaDaSessao++;                                          // o "Sair" (repõe região e país)
  m.deps.API.setRegion('row'); m.deps.API.setCountry(30);
  m.soltar();
  await p;
  assert.deepEqual(m.guardado, { regiao: 'row', pais: '30' }, 'DEFEITO: o país de quem saiu foi regravado depois do "Sair"');
  assert.deepEqual(m.toasts, [], 'o aviso do país saiu na tela de entrada');
  assert.ok(!m.h.chamou.includes('resetQueue'), 'a fila foi refeita depois do "Sair"');
});

test('K12: a QUEDA durante a espera não deixa o par trocado (a região nova com o país velho)', async () => {
  const m = montarIrProPais();
  const p = m.h.irProPaisDoPerfil({ regiao: 'na', pais: 235 });
  m.deps.epocaDaSessao++;                                          // a queda: região e país ficam como estão
  m.soltar();
  await p;
  assert.deepEqual(m.guardado, { regiao: 'row', pais: '30' }, 'DEFEITO: região e país ficaram de lugares diferentes');
});

test('K12: CONTROLE — sem a sessão acabar, vai pro país do perfil, pedindo a lista DA REGIÃO NOVA', async () => {
  const m = montarIrProPais();
  const p = m.h.irProPaisDoPerfil({ regiao: 'na', pais: 235 });
  m.soltar();
  await p;
  assert.deepEqual(m.guardado, { regiao: 'na', pais: '235' });
  assert.deepEqual(m.toasts, ['toast.paisDoPerfil']);
  assert.equal(m.deps.AppState.countries[0].name, 'United States');
});

// ═══ K13 · o foco depois da queda com uma camada aberta ══════════════════════

function elementoFocavel(nome, doc, { visivel = true } = {}) {
  const el = { nome, visivel, isConnected: true, disabled: false,
    focus() { doc.activeElement = el; }, getClientRects: () => (el.visivel ? [1] : []), closest: () => null };
  return el;
}

function montarQuedaComCamada() {
  const doc = { body: { nome: 'BODY' }, activeElement: null, getElementById: (id) => doc.els[id] || null, els: {} };
  doc.activeElement = doc.body;
  doc.els.helpBtn = elementoFocavel('helpBtn', doc);
  doc.els.filtersBtn = elementoFocavel('filtersBtn', doc);
  doc.els.filtersModal = { classList: { contains: (c) => c === 'hidden' ? !doc.filtrosAbertos : false } };
  doc.filtrosAbertos = true;
  doc.els.accessDeniedOk = elementoFocavel('accessDeniedOk', doc);
  const deps = {
    document: doc, MODAL_IDS: ['filtersModal'], MapaLightbox: { isOpen: () => false }, Lightbox: { isOpen: () => false },
    CamadaVoltar: { profundidade: 1, consumindo: false }, history: { go() {} }, ultimoFocoForaDasCamadas: doc.els.filtersBtn,
    // O fechamento devolve o foco a quem abriu (o `closeModal` de verdade faz isso).
    closeModal: () => { doc.filtrosAbertos = false; doc.els.filtersBtn.focus(); },
  };
  const h = montar(['fecharCamadasAbertas', 'devolverFoco', 'focavelNaTela', 'dentroDeCamada'], deps);
  return { h, doc };
}

test('K13: a queda com Filtros aberto — o foco não cai no <body> quando a tela de entrada esconde quem abriu', () => {
  const m = montarQuedaComCamada();
  // A tela de entrada esconde o botão de Filtros (e o card, e o cabeçalho).
  m.h.fecharCamadasAbertas(() => { m.doc.els.filtersBtn.visivel = false; });
  assert.equal(m.doc.activeElement && m.doc.activeElement.nome, 'helpBtn',
    'DEFEITO: o foco ficou em ' + (m.doc.activeElement && m.doc.activeElement.nome) + ' (escondido) — quem usa teclado recomeça do topo');
});

test('K13: CONTROLE — o diálogo que a queda abre (o portão) fica com o foco dele', () => {
  const m = montarQuedaComCamada();
  m.h.fecharCamadasAbertas(() => { m.doc.els.filtersBtn.visivel = false; m.doc.els.accessDeniedOk.focus(); });
  assert.equal(m.doc.activeElement.nome, 'accessDeniedOk', 'a queda tirou o foco do diálogo do portão');
});

// ═══ K14 · com a sessão sendo conferida, a fila de saída espera ══════════════

function montarSaidaMorta() {
  const { safeLS } = lsFalso();
  const itens = ['v1', 'v2'].map((v) => ({ tipo: 'reject', venueID: v, updateRequestID: 'u' + v, conta: '111', s: marcaDe('tok-A'), regiao: 'row' }));
  safeLS.set('waze_places_saida', JSON.stringify(itens));
  const envios = [];
  let sonda;
  const deps = {
    AppState: { authenticated: true, profile: { id: 111 }, stats: { read: 0, rejected: 2, skipped: 0 } }, safeLS,
    navigator: { onLine: true }, epocaDaSessao: 0, esvaziandoSaida: false, saidaPedidaDeNovo: false, saidaEsperandoConta: false,
    verificandoSessao: false, sessaoVivaEm: { s: null, em: 0 }, saidaRecuo: { s: null, n: 0, ate: 0 }, ultimaEscritaOkEm: 0,
    pedidosEmAndamento: new Set(), CONTA_KEY: constante('CONTA_KEY'), SAIDA_KEY: constante('SAIDA_KEY'),
    SAIDA_RECUO_401_MS: constante('SAIDA_RECUO_401_MS'), SAIDA_TENTATIVAS_POR_ITEM: constante('SAIDA_TENTATIVAS_POR_ITEM'),
    SAIDA_RITMO_MS: 0, VERIFICA_SESSAO_MS: 0, setTimeout: (f) => { f(); return 1; },
    registrarPousoDeSaida: () => {}, rebuscarDepoisDeFalha: () => {}, derrubarSessao: () => { deps.AppState.authenticated = false; },
    t: (k) => k,
    // A trava ENTRE ABAS (R4-O6): aqui, a do navegador, sempre livre.
    travaDaSaida: async () => ({ reserva: false, soltar() {} }),
    API: {
      getSession: () => 'tok-A',
      // Como o `_post`: a resposta que CHEGA é prova de rede, e a prova chama o
      // esvaziamento ANTES de a resposta voltar pra quem pediu.
      rejectPlace: async (v) => {
        envios.push(v);
        await tique(1);
        h.esvaziarFilaDeSaida();
        return deps.proxima ? deps.proxima(v) : { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.cookiesExpired', httpCode: 401 };
      },
      getProfile: () => new Promise((ok) => { sonda = ok; }),
    },
  };
  const h = montar(['marcaDaSessao', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido', 'marcarNaSaida',
    'marcarSessaoViva', 'sessaoVivaDepoisDe', 'recuarSaida', 'saidaEmRecuo', 'moverProFimDaSaida', 'esvaziarFilaDeSaida',
    'handleUnauthorized'], deps);
  return { h, deps, envios, responderSonda: (r) => sonda(r) };
}

test('K14: sessão MORTA com a fila de saída cheia — o 1º item sai UMA vez, não duas em milissegundos', async () => {
  const m = montarSaidaMorta();
  await m.h.esvaziarFilaDeSaida();
  await tique(10);
  assert.deepEqual(m.envios, ['v1'], 'DEFEITO: com a sessão sendo conferida, o mesmo pedido saiu de novo: ' + m.envios.join(','));
  m.responderSonda({ success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.cookiesExpired' });   // morta
  await tique(10);
  assert.deepEqual(m.envios, ['v1'], 'depois do veredito de sessão morta, a fila ainda mandou pedido');
  assert.equal(m.h.carregarFilaDeSaida().length, 2, 'a fila de quem perdeu a sessão tem de ficar (sai no próximo login)');
});

test('K14: CONTROLE — a conferência diz VIVA (alarme falso): a fila sai na hora, sem esperar outro gatilho', async () => {
  const m = montarSaidaMorta();
  await m.h.esvaziarFilaDeSaida();
  await tique(10);
  m.deps.proxima = () => ({ success: true });                 // a partir daqui o Waze aceita
  m.responderSonda({ success: true, profile: { id: 111 } });  // viva
  await ateQue(() => m.h.carregarFilaDeSaida().length === 0,
    'a fila vazia depois do alarme falso (sem isso, ela ficaria esperando o próximo gatilho)');
  await tique(20);   // o que saísse A MAIS teria tempo de sair
  assert.deepEqual(m.envios, ['v1', 'v1', 'v2']);
});
