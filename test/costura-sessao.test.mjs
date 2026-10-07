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
  // E a extensão renovando em silêncio (`extPerguntando`, que o aviso da trava
  // lê — R5-2-07), também parada por padrão. E nenhum login desta aba no ar (o
  // colar, o código), que a resposta da extensão à volta à aba confere (R11-1-03).
  for (const [k, v] of Object.entries({ loteDeLidosEmVoo: false, escritasConferindo: 0,
    aprovandoAgora: false, excluindoAgora: false, renomeacoesNoAr: new Set(), extPerguntando: false, extRenovando: false,
    authInFlight: false, resgateEmVoo: false })) if (!(k in deps)) deps[k] = v;
  // A trava também lê a APROVAÇÃO no ar do pedido da tela (`aprovacaoDaTelaNoAr`):
  // quem fatia a trava leva a função junto, e o conjunto é de verdade (o buraco
  // negro devolveria uma função — verdadeira — e travaria tudo).
  if (nomes.includes('acoesTravadas') && !nomes.includes('aprovacaoDaTelaNoAr')) nomes = [...nomes, 'aprovacaoDaTelaNoAr'];
  if (nomes.includes('aprovacaoDaTelaNoAr') && !('aprovacoesNoAr' in deps)) deps.aprovacoesNoAr = new Set();
  if (nomes.includes('aprovacaoDaTelaNoAr') && !('aprovacoesDaQueda' in deps)) deps.aprovacoesDaQueda = new Map();
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
      getRegion: () => 'row', getCountry: () => 30, getSession: () => token, get sessionToken() { return token; }, setSession: (t) => { token = t; },
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
  // O aviso sem sessão sai pela função da trava (R5-2-07): fatiada, a de verdade.
  const h = montar(['acoesTravadas', 'avisoDaTrava', 'rejeitarLoteDoAutor'], deps);
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
    // As escritas de verdade são `async`: o envio da janela espera a promessa
    // pra dizer o desfecho no irmão (R11-3-05).
    enviarExclusao: () => { log.push('ENVIOU:excluir'); return Promise.resolve(true); },
    enviarAprovacao: () => { log.push('ENVIOU:aprovar'); return Promise.resolve(true); },
    enviarRenomeacao: () => { log.push('ENVIOU:renomear'); return Promise.resolve(true); },
    registrarDesfazer: () => log.push('desfazer-do-editor'),
    mostrarDesfazer: () => log.push('banner'),
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, UNDO_WINDOW_MS: 3000,
    API: { getSession: () => 'tok-A', get sessionToken() { return 'tok-A'; }, setSession() {}, getRegion: () => 'row', prepararExclusao() {},
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
function montarVoo({ janela = false, extras = [] } = {}) {
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
      getRegion: () => 'row', getCountry: () => 30, getSession: () => token, get sessionToken() { return token; }, setSession: (t) => { token = t; },
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
    aprovacaoDelaJaPousou: () => false,   // a aprovação de foto sem resposta (R7-3-08): aqui, nenhuma
  };
  const h = montar(['sessaoTrocou', 'callWithRetry', 'acoesTravadas', 'pousouNoWaze', 'descontarGestoSemSessao',
    'chaveDoPedido', 'marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'enfileirarSaida',
    'marcarNaSaida', 'tirarDaFilaDeSaida', 'marcarEmAndamento', 'handleActionResult', 'scheduleAction',
    'anotarAntesDoEnvio', 'anotarSeAbriuASaida', 'decisaoDepoisDaQueda', 'devolverPedidoRecusado',
    'handleReject', 'handleMarkAsRead', 'derrubarSessao', ...extras], deps);
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

// ═══ R7-2-01 · a decisão no ar quando a conta DESTA aba fica em dúvida ═══════
// A aba sem perfil, com o aparelho tomado por OUTRA sessão (R6-1-04), travava
// as decisões NOVAS — e o ✕ que já estava na janela do Desfazer saía no fim
// dela com a sessão desta aba; o pouso gravava o Histórico, os autores, as
// conquistas e a marca do primeiro ✕ no aparelho, já de OUTRA conta (MEDIDO,
// auditoria de 2026-10-02). Quando a dúvida acende vale o que a queda faz: a
// janela é cancelada (a decisão volta como card) e a época troca — a resposta
// do que estava no ar não grava nada no aparelho.
const DUVIDA = ['conferirContaDestaAba'];

test('R7-2-01: a dúvida ACENDE com o ✕ na janela do Desfazer — a decisão não sai, volta como card e o placar desconta', async () => {
  const m = montarVoo({ janela: true, extras: DUVIDA });
  m.h.handleReject();
  await tique();
  assert.ok(m.AppState.pendingAction, 'PRÉ-CONDIÇÃO: o ✕ está na janela do Desfazer');
  assert.equal(m.gravados.at(-1).rejected, 1, 'PRÉ-CONDIÇÃO: o gesto gravou o +1');
  m.h.conferirContaDestaAba();
  assert.equal(m.AppState.pendingAction, null, 'DEFEITO: a janela seguiu correndo com a conta desta aba em dúvida');
  assert.equal(m.AppState.contaEmDuvida, true);
  assert.equal(m.AppState.queue[0], m.P, 'a decisão cancelada não voltou como o card da frente');
  assert.equal(m.gravados.at(-1).rejected, 0, 'o +1 de uma decisão que não saiu ficou gravado');
  await tique(10);
  assert.deepEqual(m.pendentes, [], 'a decisão saiu pro Waze mesmo com a janela cancelada');
  // Um aviso a mais da outra aba (a dúvida já acesa) não cancela nem troca a época de novo.
  const epoca = m.deps.epocaDaSessao;
  m.h.conferirContaDestaAba();
  assert.equal(m.deps.epocaDaSessao, epoca, 'a época trocou de novo com a dúvida já acesa');
});

test('R7-2-01: a resposta do ✕ que estava NO AR chega com a conta em dúvida — não grava nada no aparelho', async () => {
  for (const [caso, resposta] of [['pousou', { success: true }], ['caiu a rede', { success: false, errorCategory: 'transient' }]]) {
    const m = montarVoo({ extras: DUVIDA });
    m.h.handleReject();
    await tique();
    assert.equal(m.pendentes.length, 1, `${caso}: PRÉ-CONDIÇÃO: o ✕ saiu e está no ar`);
    m.h.conferirContaDestaAba();
    m.pendentes[0](resposta);
    await tique(20);
    for (const gravaria of ['recordHistory', 'registrarRejeicaoDeAutor', 'registrarAcaoConfirmada', 'avisarConsequencia']) {
      assert.ok(!m.h.chamou.includes(gravaria), `DEFEITO (${caso}): a resposta com a conta em dúvida chegou a ${gravaria}`);
    }
    assert.equal(m.h.carregarFilaDeSaida().length, 0, `${caso}: a decisão ficou na fila de saída do aparelho de outra conta`);
    if (caso === 'caiu a rede') {
      assert.equal(m.AppState.stats.rejected, 0, 'a decisão que não pousou ficou contada');
      assert.ok(m.AppState.queue.includes(m.P), 'a decisão que não pousou não voltou como card');
    }
  }
  // CONTROLE: a mesma resposta SEM a dúvida grava como sempre (o instrumento enxerga).
  const c = montarVoo();
  c.h.handleReject();
  await tique();
  c.pendentes[0]({ success: true });
  await tique(20);
  assert.ok(c.h.chamou.includes('recordHistory'), 'CONTROLE: sem dúvida a resposta não gravou — o teste perdeu o sentido');
});

test('R7-2-01: a dúvida para o "Marcar todos" no ar e solta a trava dele — como a queda', () => {
  const m = montarVoo({ extras: DUVIDA });
  m.deps.loteDeLidosEmVoo = true;
  m.h.conferirContaDestaAba();
  assert.equal(m.deps.loteDeLidosEmVoo, false, 'o lote da época que acabou travaria o card depois de a dúvida se resolver');
  assert.ok(m.h.chamou.includes('cancelarPendenciasDoLightbox'), 'as escritas do lightbox na janela seguiram correndo');
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
    API: { getRegion: () => 'row', getSession: () => token, get sessionToken() { return token; }, setSession: (t) => { token = t; }, setRegion() {}, setCountry() {},
      markAsReadBatch: () => new Promise((ok) => portoes.push(ok)), destroySession: async () => ({ success: true }) },
    callWithRetry: (fn) => fn(), entrarPelaExtensao: () => new Promise(() => {}),
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, console,
  };
  const h = montar(['acoesTravadas', 'acoesTravadasForaDaJanela', 'avisoDaTrava', 'openBatchReadConfirm', 'handleBatchMarkRead',
    'marcarEmAndamento', 'chaveDoPedido', 'derrubarSessao', 'handleLogout'], deps);
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

// ═══ V6b · o "Marcar todos" que a queda corta no meio: o que JÁ pousou sai ═════
// Com a sessão caindo e a extensão renovando com a MESMA conta, a fila atravessa
// a queda — e o lote saía pela época trocada ANTES de tirar da fila o que o Waze
// já tinha marcado. MEDIDO no navegador (s15, também na main c6d9f91): lote de
// 60, o 1º pedaço (25) pousa, a sessão cai e renova, o 2º volta 401 → a fila
// seguia com os 60 cards, 25 já marcados no Waze, "Restam" 60 e placar 0.
// Pedaços de UM pedido aqui: a queda cai entre o 1º e o 2º.
function montarLoteComQueda({ pedaco = 1 } = {}) {
  const portoes = [];
  const portoesUm = [];   // o caminho UM A UM (`markAsRead`)
  const log = [];
  const pousos = [];
  const { safeLS } = lsFalso();
  const P = [1, 2, 3].map((i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i }));
  const AppState = { authenticated: true, profile: { id: 'A' }, queue: P.slice(), currentPlace: P[0],
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 3, fetchEpoch: 0, hasMore: false,
    pendingAction: null, inFlightActions: 0, preferences: {} };
  const deps = {
    AppState, safeLS, epocaDaSessao: 0, loteDeLidosContado: null, Treino: { ativo: false },
    LOTE_LIDOS_PEDACO: pedaco, pedidosEmAndamento: new Set(), pareamentosEmitidos: new Set(),
    API: { getRegion: () => 'row', getSession: () => 'tok-A', get sessionToken() { return 'tok-A'; }, setSession() {}, setRegion() {}, setCountry() {},
      markAsReadBatch: () => new Promise((ok) => portoes.push(ok)), markAsRead: () => new Promise((ok) => portoesUm.push(ok)) },
    callWithRetry: (fn) => fn(), entrarPelaExtensao: () => new Promise(() => {}),
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, console,
    registrarPouso: (ps) => pousos.push(...(Array.isArray(ps) ? ps : [ps]).map((p) => p.updateRequestID)),
    recordHistory: () => log.push('historico'), registrarLoteConfirmado: () => log.push('conquistas'),
    showToast: (m, tipo) => log.push('toast:' + tipo), msgDoServidor: (r, d) => d, t: (k) => k,
    updateStats() {}, saveStats() {}, updatePendingCount() {}, removeCurrentCardEl: () => log.push('tirou-card'),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; log.push('card:' + (AppState.currentPlace ? AppState.currentPlace.updateRequestID : '-')); },
    startFetching: () => log.push('busca'), showNoPlaces: () => log.push('vazio'), devolverPedidoRecusado: () => log.push('devolveu'),
  };
  const h = montar(['acoesTravadas', 'acoesTravadasForaDaJanela', 'avisoDaTrava', 'openBatchReadConfirm', 'handleBatchMarkRead',
    'marcarEmAndamento', 'chaveDoPedido', 'derrubarSessao'], deps);
  const marcarTodos = () => { h.openBatchReadConfirm(); return h.handleBatchMarkRead(); };
  // O 1º pedaço pousa; o 2º fica no ar, e a sessão cai e renova com a MESMA conta.
  const ateAQueda = async () => {
    const lote = marcarTodos();
    await tique();
    assert.equal(portoes.length, 1, 'PRÉ-CONDIÇÃO: o 1º pedaço saiu');
    portoes[0]({ success: true });
    await tique();
    assert.equal(portoes.length, 2, 'PRÉ-CONDIÇÃO: o 2º pedaço está no ar');
    h.derrubarSessao('srv.err.cookiesExpired');
    AppState.authenticated = true;                  // a renovação pela extensão
    // Embrulhada: devolver a promessa crua de uma função `async` a ADOTA, e o
    // `await` de quem chama esperaria o lote — que só termina depois.
    return { lote, desde: log.length };
  };
  const fila = () => AppState.queue.map((p) => p.updateRequestID);
  return { h, deps, AppState, portoes, portoesUm, log, pousos, marcarTodos, ateAQueda, fila };
}

// O que pousou ANTES da queda conta NA HORA, na sessão dele, como o ✕ de um card
// que pousou (R10-2-03: somado só no fim do laço, fechar o app no meio o
// perdia); a resposta que chega DEPOIS da queda não grava nada.
test('V6b: "Marcar todos" cortado pela queda, renovando com a MESMA conta — o que o Waze JÁ marcou sai da fila; a resposta de depois da queda não conta', async () => {
  const m = montarLoteComQueda();
  const { lote, desde } = await m.ateAQueda();
  m.portoes[1]({ success: false, errorCategory: 'unauthorized' });   // a resposta da sessão que caiu
  await lote;
  const depois = m.log.slice(desde);   // o "marcando…" do começo do lote é de antes da queda
  assert.deepEqual(m.fila(), ['u2', 'u3'], 'o pedido que o Waze já marcou seguiu na fila como card — decidível de novo');
  assert.equal(m.AppState.serverTotal, 2, 'o "Restam" seguiu contando o pedido já marcado');
  assert.equal(m.AppState.currentPlace && m.AppState.currentPlace.updateRequestID, 'u2',
    'o card da frente não foi refeito: ficou na tela o pedido já marcado');
  assert.equal(m.AppState.stats.read, 1,
    'o placar: o u1, que pousou ANTES da queda, conta (R10-2-03); a resposta da sessão que caiu, não');
  assert.deepEqual(m.log.slice(0, desde).filter((l) => l === 'historico' || l === 'conquistas'), ['historico', 'conquistas'],
    'o u1, que pousou antes da queda, não entrou no Histórico e nas conquistas na hora em que pousou');
  assert.ok(!depois.includes('historico') && !depois.includes('conquistas'),
    `com a sessão trocada o lote gravou: ${depois}`);
  // O ÚNICO aviso é o de que o lote não saiu inteiro (R8-2-04): o u2 e o u3
  // seguem pendentes, e a renovação diria "sua fila continua aqui" com a pessoa
  // achando que tinha marcado. Nada de "N marcados".
  assert.deepEqual(depois.filter((l) => l.startsWith('toast')), ['toast:error'],
    `com a sessão trocada o lote disse outra coisa (ou nada) sobre o que não saiu: ${depois}`);
  assert.ok(depois.includes('card:u2'), `a tela não foi refeita: ${depois}`);
  assert.equal(m.portoes.length, 2, 'o lote seguiu mandando pedaços depois da queda');
});

test('V6b: o pedaço cuja resposta POUSA depois da queda também sai da fila — e ganha o pouso', async () => {
  const m = montarLoteComQueda();
  const { lote } = await m.ateAQueda();
  m.portoes[1]({ success: true });                   // chegou depois da queda, e o Waze marcou
  await lote;
  assert.deepEqual(m.fila(), ['u3'], 'o pedido que pousou depois da queda seguiu como card');
  assert.equal(m.AppState.serverTotal, 1);
  assert.deepEqual(m.pousos, ['u1', 'u2'], 'o que pousou depois da queda ficou sem pouso (a fila guardada o devolveria)');
  assert.equal(m.AppState.stats.read, 1,
    'o placar: só o u1, que pousou ANTES da queda (R10-2-03) — a resposta da sessão que caiu (o u2) contou');
  assert.equal(m.portoes.length, 2, 'o lote seguiu mandando pedaços depois da queda');
});

test('V6b: a queda no meio do caminho UM A UM também para o lote — e o que já pousou sai da fila', async () => {
  // Pedaços de DOIS: o 1º volta "já resolvido" (o lote do Waze para no primeiro
  // resolvido) e o app vai um a um; a queda cai no 2º do um a um.
  const m = montarLoteComQueda({ pedaco: 2 });
  const lote = m.marcarTodos();
  await tique();
  m.portoes[0]({ success: false, errorCategory: 'already_processed' });
  await tique();
  assert.equal(m.portoesUm.length, 1, 'PRÉ-CONDIÇÃO: o um a um começou');
  m.portoesUm[0]({ success: true });                 // u1 pousa antes da queda
  await tique();
  assert.equal(m.portoesUm.length, 2, 'PRÉ-CONDIÇÃO: o u2 está no ar');
  m.h.derrubarSessao('srv.err.cookiesExpired');
  m.AppState.authenticated = true;
  m.portoesUm[1]({ success: false, errorCategory: 'unauthorized' });
  await lote;
  assert.deepEqual(m.fila(), ['u2', 'u3'], 'o pedido que pousou no um a um seguiu na fila');
  assert.equal(m.AppState.serverTotal, 2);
  assert.equal(m.portoes.length, 1, 'o lote mandou o pedaço seguinte DEPOIS da queda (com a sessão que caiu)');
  assert.equal(m.AppState.stats.read, 1, 'o placar: só o u1, que pousou no um a um ANTES da queda (R10-2-03)');
});

test('V6b: CONTROLE — sem a queda, o lote inteiro sai da fila e conta (o instrumento distingue)', async () => {
  const m = montarLoteComQueda();
  const lote = m.marcarTodos();
  for (let i = 0; i < 3; i++) { await tique(); m.portoes[i]({ success: true }); }
  await lote;
  assert.deepEqual(m.fila(), []);
  assert.equal(m.AppState.stats.read, 3, 'sem queda o lote deixou de contar');
  assert.ok(m.log.includes('historico') && m.log.includes('toast:success'), `sem queda, o lote não gravou nem avisou: ${m.log}`);
});

test('V6b: CONTROLE — com OUTRA conta a fila foi refeita: a resposta velha não mexe na fila nova', async () => {
  const m = montarLoteComQueda();
  const { lote } = await m.ateAQueda();
  // Outra conta entrou: a fila é trocada (`esquecerOutraConta` → `resetQueue`).
  const Q = { venueID: 'q1', updateRequestID: 'uq1' };
  m.AppState.fetchEpoch++;
  m.AppState.queue = [Q, { venueID: 'u2x', updateRequestID: 'u2' }];
  m.AppState.currentPlace = Q;
  m.AppState.serverTotal = 2;
  const logAntes = m.log.length;
  m.portoes[1]({ success: true });
  await lote;
  assert.deepEqual(m.fila(), ['uq1', 'u2'], 'a resposta da sessão de A mexeu na fila de B');
  assert.equal(m.AppState.serverTotal, 2, 'a resposta da sessão de A descontou o "Restam" da fila de B');
  assert.equal(m.AppState.currentPlace, Q);
  assert.deepEqual(m.pousos, ['u1'], 'a resposta da sessão de A gravou pouso na fila de B');
  assert.deepEqual(m.log.slice(logAntes), [], 'a resposta da sessão de A redesenhou a tela de B');
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
    API: { setSession: (t) => { deps.token = t; }, getSession: () => deps.token || null,
      temSessaoNaMemoria: () => !!deps.token, get sessionToken() { return deps.token || null; } }, token: null,
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

// ═══ R6-1-06 · a foto ampliada da conta anterior na renovação com OUTRA conta ═══
// X (L6+AM) com a foto de um pedido de foto nova ampliada; a sessão cai e a
// extensão renova com Y (L2+AM). A fila virava a de Y, mas a foto de X seguia
// aberta por cima, com o "Aprovar" à mostra e HABILITADO — e o toque não fazia
// nada (o portão recusa). Botão morto com cara de vivo, sobre um pedido que nem
// está na fila de quem entrou (MEDIDO no Chromium, auditoria de 2026-10-02).
// A troca de conta com o que a anterior tinha ABERTO. O fechamento é o de
// verdade (`fecharCamadasAbertas`, o da queda): cada camada aberta fecha pela
// limpeza dela, sem mexer no voltar, e as entradas saem de uma vez no fim. A foto
// ampliada de mentira faz o que o `Lightbox.close` faz ao fechar: anda a fila se
// uma aprovação pousou esperando ela fechar (`avancarSeAprovado`).
function trocaComCamadas({ atravessou = true, foto = false, mapa = false, modal = null, aprovacaoPousada = null,
  emitidos = [], soFechar = false } = {}) {
  const log = [];
  const camada = (nome, aberto) => ({ aberto, isOpen() { return this.aberto; },
    close() {
      this.aberto = false;
      log.push('fechou ' + nome);
      if (nome === 'a foto' && deps.placeResolvidoPorAprovacao) log.push('andou a fila: ' + deps.placeResolvidoPorAprovacao.venueID);
    } });
  const modais = {};
  for (const id of ['pairShowModal', 'autorModal', 'filtersModal', 'helpModal']) {
    const aberto = { v: id === modal };
    modais[id] = { id, classList: { contains: (c) => (c === 'hidden' ? !aberto.v : false) }, fechar() { aberto.v = false; } };
  }
  const deps = {
    AppState: { stats: {}, queue: [{ venueID: 'xA' }] }, filaAtravessouSessao: atravessou, safeLS: { remove() {} },
    carregarFilaDeSaida: () => [], window: { Presenca: { esquecer: () => log.push('conversa esquecida') } },
    Lightbox: camada('a foto', foto), MapaLightbox: camada('o mapa', mapa),
    placeResolvidoPorAprovacao: aprovacaoPousada, pareamentosEmitidos: new Set(emitidos),
    API: { cancelarPareamento: (c) => { log.push('cancelou ' + c); return Promise.resolve({ success: true }); } },
    MODAL_IDS: Object.keys(modais), document: { getElementById: (id) => modais[id] || null, activeElement: null, body: {} },
    closeModal: (id, o) => { modais[id].fechar(); log.push('fechou ' + id + (o && o.viaHistorico ? '' : ' (com voltar)')); },
    CamadaVoltar: { profundidade: (foto || mapa || modal) ? 1 : 0, consumindo: false },
    history: { go: (n) => log.push('voltar ' + n) }, devolverFoco: () => {}, focavelNaTela: () => true,
    resetQueue: () => log.push('fila trocada'), startFetching: () => log.push('busca'),
  };
  const h = montar(['esquecerOutraConta', 'fecharOQueEraDaContaAnterior', 'fecharCamadasAbertas', 'semCamadaAberta',
    'topOpenModal'], deps);
  // `soFechar`: só o fechamento da QUEDA, sem a troca de conta (o controle do instrumento).
  if (soFechar) h.fecharCamadasAbertas();
  else h.esquecerOutraConta('222');
  return { log, deps };
}

test('R6-1-06: OUTRA conta na renovação — a foto e o mapa AMPLIADOS fecham ANTES de a fila trocar', () => {
  const t = trocaComCamadas({ foto: true, mapa: true });
  assert.deepEqual(t.log, ['conversa esquecida', 'fechou o mapa', 'fechou a foto', 'voltar -1', 'fila trocada', 'busca'],
    `DEFEITO: a foto ampliada da conta anterior ficou aberta por cima da fila de quem entrou: ${t.log.join(' | ')}`);
  // CONTROLE: a fila nasceu nesta sessão (o pedido na foto é de quem entrou): nada fecha.
  const c = trocaComCamadas({ atravessou: false, foto: true, mapa: true });
  assert.deepEqual(c.log, ['conversa esquecida'], 'a foto de um pedido da própria fila fechou sem motivo');
});

// ═══ R7-1-01 · o QR, a folha do autor e o Histórico da conta anterior ═══════════
// A troca de conta pela renovação fechava só a foto e o mapa: o QR do "Conectar
// outro aparelho" de X seguia na tela, desenhado e VÁLIDO (quem o escaneasse
// entrava como X por até 5 min), e a folha do autor e o Histórico mostravam o
// que tinha acabado de sair do aparelho (MEDIDO no Chromium e no WebKit,
// auditoria de 2026-10-02).
test('R7-1-01: OUTRA conta — os códigos de X são CANCELADOS e o que estava aberto (QR, folha, Histórico) FECHA', () => {
  for (const modal of ['pairShowModal', 'autorModal', 'filtersModal']) {
    const t = trocaComCamadas({ modal, emitidos: ['PRIVQRSTUVWXYZ234567', 'PRV234'] });
    assert.ok(t.log.includes('cancelou PRIVQRSTUVWXYZ234567') && t.log.includes('cancelou PRV234'),
      `DEFEITO: o código de X segue valendo depois de Y entrar: ${t.log.join(' | ')}`);
    assert.equal(t.deps.pareamentosEmitidos.size, 0, 'os códigos cancelados seguem na lista desta página');
    // Pela função da queda: a limpeza de cada camada, SEM o voltar de cada uma,
    // e as entradas de uma vez — e antes da fila trocar.
    const i = t.log.indexOf('fechou ' + modal);
    assert.ok(i >= 0, `DEFEITO: ${modal} da conta anterior ficou aberto por cima da fila de quem entrou: ${t.log.join(' | ')}`);
    assert.ok(t.log.indexOf('voltar -1') > i && t.log.indexOf('fila trocada') > t.log.indexOf('voltar -1'),
      `${modal}: fora da ordem do fechamento da queda (gotcha #65): ${t.log.join(' | ')}`);
    // DEPOIS do esquecimento da conversa: o fechamento dela pagaria o "lida" com a sessão de quem entrou.
    assert.ok(t.log.indexOf('conversa esquecida') < i);
  }
  // Com a fila DESTA sessão (o login pela tela de entrada, a abertura): os
  // códigos de X também saem, e os diálogos fecham; a foto, de um pedido de
  // quem entrou, fica (o controle do R6-1-06).
  const n = trocaComCamadas({ atravessou: false, modal: 'pairShowModal', emitidos: ['PRIVQRSTUVWXYZ234567'] });
  assert.ok(n.log.includes('cancelou PRIVQRSTUVWXYZ234567'), 'sem a fila trocando, o código de X seguiu valendo');
  assert.ok(n.log.includes('fechou pairShowModal'), 'sem a fila trocando, o QR de X ficou na tela');
  // CONTROLE: nada aberto e nenhum código — nada se fecha nem se cancela (e o foco não é mexido).
  const v = trocaComCamadas();
  assert.deepEqual(v.log, ['conversa esquecida', 'fila trocada', 'busca']);
});

// ═══ R7-3-01 (b) · fechar a foto na troca não anda a fila da conta ANTERIOR ═══
// Com uma aprovação POUSADA esperando a foto fechar, o fechamento da troca de
// conta andava a fila de X: o card seguinte de X era anunciado e o "Como
// funciona" de quem entrou abria no mesmo tique do voltar pendente — e o
// "Entendi" tirava a pessoa do app (gotcha #65; MEDIDO nos dois motores).
test('R7-3-01 (b): a troca de conta esquece a aprovação pousada ANTES de fechar a foto — a fila de X não anda', () => {
  const t = trocaComCamadas({ foto: true, aprovacaoPousada: { venueID: 'xA' } });
  assert.ok(t.log.includes('fechou a foto'), 'PRÉ-CONDIÇÃO: a foto da conta anterior fecha');
  assert.ok(!t.log.some((l) => l.startsWith('andou a fila')),
    `DEFEITO: fechar a foto andou a fila da conta ANTERIOR: ${t.log.join(' | ')}`);
  assert.equal(t.deps.placeResolvidoPorAprovacao, null);
  // CONTROLE: o mesmo fechamento SEM a troca de conta (o da queda comum, em que a
  // fila é da mesma pessoa) anda a fila — o instrumento enxerga o defeito.
  const c = trocaComCamadas({ foto: true, aprovacaoPousada: { venueID: 'xA' }, soFechar: true });
  assert.ok(c.log.includes('andou a fila: xA'), `CONTROLE: o fechamento não andou a fila — o teste perdeu o sentido: ${c.log.join(' | ')}`);
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
    // A conta que ESTA aba confirmou: A, que estava triando (ver `aoConhecerConta`, R11-1-01).
    contaConfirmadaNestaAba: { id: '111', s: marcaDe('tokA') },
    EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, setTimeout, clearTimeout,
    // O teto da espera pelo perfil, curto aqui (o caso do perfil que nunca chega).
    AVISO_RENOVADA_ESPERA_PERFIL_MS: 30,
    API: { setSession: (t) => { token = t; }, getSession: () => token, get sessionToken() { return token; } },
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
    'esquecerOutraConta', 'marcaDaSessao', 'marcaDestaAba'], deps);
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
    API: { setSession: (t) => sessoes.push(t), getSession: () => null, get sessionToken() { return null; }, setRegion() {}, setCountry() {},
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
  // A aba LOGADA (aberta sem rede, com a sessão salva): a sessão está na memória dela.
  const AppState = { authenticated: true, profile: perfil, preferences: { presenca: true }, stats: {} };
  const presencaWme = { ligarNaProxima: true, desligarPendente: false, ultimaEm: 0, perfilVisivel: null, perfilEm: 0 };
  const deps = {
    AppState, presencaWme, dfato: () => {},
    API: { getSession: () => 'tok-A', temSessaoNaMemoria: () => true, sessionToken: 'tok-A',
      presencaWaze: async (c) => { enviados.push(c); return { success: true }; } },
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
    API: { getSession: () => token, get sessionToken() { return token; }, getRegion: () => 'row', getCountry: () => 30 },
    offlineLigado: () => true, offlineLerFila: async () => fila, offlineLerJanela: async () => null,
    lugarAgora: () => ({ regiao: 'row', pais: '30' }), offlineJanelaServida: null, filaDeOnde: null,
    semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
    pedidosQueEntraramNaFila: new Set(),
  };
  return montar(['marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'mesmoLugar', 'filaGuardadaDestaConta', 'offlineTentarAbrirSemRede'], deps);
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
    safeLS: { get: () => null }, CONTA_KEY: constante('CONTA_KEY'), API: { getSession: () => 'tok-A', get sessionToken() { return 'tok-A'; } },
    offlineDB: async () => ({ close() {}, transaction: () => {
      const tx = { objectStore: () => ({ put: (v) => { puts.push(v); setTimeout(() => tx.oncomplete()); } }) };
      return tx;
    } }),
  };
  const h = montar(['marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'filaReal', 'offlineGravarFila'], deps);
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
    resgateNoAr: null,   // nenhum resgate de código no ar (R12-1-01)
    CONTA_KEY: constante('CONTA_KEY'), SAIDA_KEY: constante('SAIDA_KEY'), HISTORY_KEY: constante('HISTORY_KEY'),
    CONQUISTAS_KEY: constante('CONQUISTAS_KEY'), t: (k) => k, window: {},
    API: { getSession: () => token, testCookies: async () => { token = 'tok-B'; return { success: true, sessionToken: 'tok-B', ...(contaNoLogin ? { conta: '222' } : {}) }; } },
    showMainScreen: () => { AppState.authenticated = true; },
    esquecerAutores: () => log.push('autores-apagados'),
    // O Histórico de verdade é um balde por dia; aqui basta o total.
    recordHistory: (tipo, n) => { AppState.history = AppState.history || { _total: { rejected: 0 } }; AppState.history._total.rejected += n; },
    registrarRejeicaoDeAutor: () => log.push('autor-de-B'),
  };
  const h = montar(['marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'conhecerContaDoLogin', 'aoConhecerConta', 'esquecerOutraConta',
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
      getSession: () => 'tok-A', get sessionToken() { return 'tok-A'; }, getRegion: () => 'row', getCountry: () => pais, setCountry: (p) => { pais = p; }, setRegion() {},
      getProfile: async () => (perfilN++ === 0
        ? { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.sessionMissing' }   // o blip do KV
        : { success: true, profile: { id: 111, userName: 'a', editableCountryIDs: [73] } }),      // edita na França
      listCountries: async () => ({ success: true, countries: [{ id: 30, name: 'Brazil' }, { id: 73, name: 'France' }] }),
    },
    t: (k, v) => k + (v && v.pais ? '(' + v.pais + ')' : ''), showToast: (m) => toasts.push(m),
    aoConhecerConta: () => {}, marcarSessaoViva: () => {},
  };
  // A lista de países pela ida que os Filtros dividem (`pedirListaDePaises`, R8-6-04),
  // guardada por região (R9-6-01).
  deps.listasDePaisesNoAr = new Map();
  deps.listasDePaisesGuardadas = new Map();
  deps.geracaoDasListasDePaises = 0;
  const h = montar(['loadProfileAndAuxData', 'handleUnauthorized', 'definirPerfil', 'completarPerfilChegado',
    'paisDoPerfil', 'irProPaisDoPerfil', 'refazerFilaReal', 'pedirListaDePaises'], deps);
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
  // A lista da região nova pela fonte única (`pedirListaDePaises`, R9-6-01).
  Object.assign(deps, { listasDePaisesNoAr: new Map(), listasDePaisesGuardadas: new Map(), geracaoDasListasDePaises: 0 });
  const h = montar(['irProPaisDoPerfil', 'pedirListaDePaises', 'refazerFilaReal'], deps);
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
    ABA_DESTA_PAGINA: 'aba-teste', SAIDA_REIVINDICACAO_MS: 60000,   // a marca da aba (test/contas-abas, F1)
    API: {
      getSession: () => 'tok-A', get sessionToken() { return 'tok-A'; },
      getRegion: () => 'row',   // a região em que a sonda pergunta (R8-6-03)
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
  const h = montar(['marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido', 'marcarNaSaida',
    'marcarSessaoViva', 'sessaoVivaDepoisDe', 'recuarSaida', 'saidaEmRecuo', 'moverProFimDaSaida', 'reivindicadoPorOutraAba',
    'esvaziarFilaDeSaida', 'handleUnauthorized'], deps);
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

// ═══ R7-1-05 · o ✕ que leva 401 não sai de novo pela ESPERA da trava ══════════
// O K14 fez o esvaziamento esperar a conferência da sessão — mas só na ENTRADA.
// A resposta 401 do ✕ é prova de rede, e a prova chama o esvaziamento ANTES de a
// resposta chegar a quem a pediu (o `_post`): ele entra com o `verificandoSessao`
// ainda falso e espera a trava ENTRE ABAS, que o navegador entrega numa TAREFA.
// Nessa espera o executor recebe o 401, solta o pedido e começa a conferência; a
// passada, que já tinha passado pelas guardas, mandava a MESMA decisão de novo
// (MEDIDO no navegador: duas idas ao Waze em 7 a 11 ms; auditoria de 2026-10-02,
// R7-1-05). Aqui roda o caminho de verdade — o `handleReject`, o
// `scheduleAction`, o `handleActionResult`, o `handleUnauthorized`, o
// esvaziamento e a `travaDaSaida` —, com a trava do navegador de mentira
// entregando numa tarefa (`setImmediate`), como a de verdade.
function montarXQueLeva401() {
  const { safeLS } = lsFalso();
  const envios = [];
  const travas = { pedidas: 0, presas: new Set() };
  let sonda;
  const AppState = {
    authenticated: true, profile: { id: 111 }, currentPlace: null, queue: [],
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 10, fetchEpoch: 0,
    preferences: { undoEnabled: false }, pendingAction: null, inFlightActions: 0,
  };
  const deps = {
    AppState, safeLS, epocaDaSessao: 0, Treino: { ativo: false },
    navigator: {
      onLine: true,
      locks: {
        // A trava do navegador: entregue numa TAREFA, nunca na hora.
        request(nome, opcoes, cb) {
          if (typeof opcoes === 'function') { cb = opcoes; opcoes = {}; }
          travas.pedidas++;
          return new Promise((fim) => setImmediate(() => {
            if (travas.presas.has(nome)) { fim(opcoes.ifAvailable ? cb(null) : undefined); return; }
            travas.presas.add(nome);
            Promise.resolve(cb({ name: nome })).then((v) => { travas.presas.delete(nome); fim(v); });
          }));
        },
      },
    },
    marcaDaAbaConferida: Promise.resolve(), SAIDA_TRAVA: constante('SAIDA_KEY'),   // `SAIDA_TRAVA = SAIDA_KEY`
    ABA_DESTA_PAGINA: 'aba-teste', SAIDA_REIVINDICACAO_MS: 60000,
    SAIDA_KEY: constante('SAIDA_KEY'), SAIDA_MAX: constante('SAIDA_MAX'), CONTA_KEY: constante('CONTA_KEY'),
    SAIDA_RECUO_401_MS: constante('SAIDA_RECUO_401_MS'), SAIDA_TENTATIVAS_POR_ITEM: constante('SAIDA_TENTATIVAS_POR_ITEM'),
    TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1, 1], SAIDA_RITMO_MS: 0, VERIFICA_SESSAO_MS: 0,
    esvaziandoSaida: false, saidaPedidaDeNovo: false, saidaEsperandoConta: false, verificandoSessao: false,
    conferenciaDaSessao: null, sessaoVivaEm: { s: null, em: 0 }, saidaRecuo: { s: null, n: 0, ate: 0 }, ultimaEscritaOkEm: 0,
    pedidosEmAndamento: new Set(), descargaNaFila: new WeakSet(), anotadoAntesDoEnvio: new WeakSet(),
    direcaoTravada: () => false, canDisableUndo: () => true, presencaWmeDaAcao: () => null,
    advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; },
    registrarPousoDeSaida: () => {}, rebuscarDepoisDeFalha: () => {}, definirPerfil: (r) => !!(r && r.success && r.profile),
    derrubarSessao: () => { AppState.authenticated = false; },
    historyTodayKey: () => '2026-10-02', ondeAgora: () => '30', getLang: () => 'pt', t: (k) => k,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, console,
    API: {
      getRegion: () => 'row', getCountry: () => 30, getSession: () => 'tok-A', get sessionToken() { return 'tok-A'; },
      // Como o `_post`: a resposta CHEGA (uma volta de rede), a prova de rede
      // roda (o `API.aoProvarRede`, que só chama sem esvaziamento no ar) e SÓ
      // DEPOIS a resposta volta a quem pediu.
      rejectPlace: async (v) => {
        envios.push(v);
        await new Promise((ok) => setImmediate(ok));
        if (!deps.esvaziandoSaida) h.esvaziarFilaDeSaida();
        return deps.proxima ? deps.proxima(v) : { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.cookiesExpired', httpCode: 401 };
      },
      getProfile: () => new Promise((ok) => { sonda = ok; }),
    },
  };
  const h = montar(['sessaoTrocou', 'callWithRetry', 'acoesTravadas', 'chaveDoPedido', 'marcaDaSessao', 'marcaDestaAba', 'contaAgora',
    'carregarFilaDeSaida', 'salvarFilaDeSaida', 'enfileirarSaida', 'marcarNaSaida', 'tirarDaFilaDeSaida', 'marcarEmAndamento',
    'reivindicacaoDestaAba', 'reivindicadoPorOutraAba', 'soltarMarcaDosItens', 'marcarSessaoViva', 'sessaoVivaDepoisDe',
    'recuarSaida', 'saidaEmRecuo', 'moverProFimDaSaida', 'travaDaSaida', 'esvaziarFilaDeSaida', 'handleUnauthorized',
    'handleActionResult', 'scheduleAction', 'anotarAntesDoEnvio', 'anotarSeAbriuASaida', 'carimboDoGesto', 'handleReject'], deps);
  const P = { venueID: 'v1', updateRequestID: 'u1', creatorId: 9 };
  AppState.queue = [P, { venueID: 'v2', updateRequestID: 'u2', creatorId: 9 }];
  AppState.currentPlace = P;
  return { h, deps, AppState, envios, travas, responderSonda: (r) => sonda(r), temSonda: () => !!sonda };
}

test('R7-1-05: o ✕ que leva 401 vai ao Waze UMA vez — a passada que esperou a trava não manda a mesma decisão de novo', async () => {
  const m = montarXQueLeva401();
  m.h.handleReject();                                   // o ✕, sem a janela do Desfazer
  // A conferência começou (o 401 chegou ao executor) e a trava pedida pela
  // prova de rede já foi entregue (e devolvida).
  await ateQue(() => m.temSonda() && m.travas.pedidas >= 1 && !m.deps.esvaziandoSaida,
    'a resposta 401, a conferência e a passada que esperou a trava');
  await tique(10);                                      // o que saísse A MAIS teria tempo de sair
  assert.equal(m.travas.pedidas, 1, 'PRÉ-CONDIÇÃO: a prova de rede da resposta não chamou o esvaziamento (o instrumento não mede a corrida)');
  assert.deepEqual(m.envios, ['v1'],
    `DEFEITO: com a sessão sendo conferida, a mesma decisão saiu de novo: ${m.envios.join(',')}`);
  assert.equal(m.travas.presas.size, 0, 'a passada que desistiu ficou com a trava entre abas (a próxima nunca esvaziaria)');
  assert.equal(m.h.carregarFilaDeSaida().length, 1, 'a decisão que levou 401 tem de ficar na fila de saída');
  // O veredito: MORTA — nada mais sai; a decisão espera o próximo login.
  m.responderSonda({ success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.cookiesExpired' });
  await tique(10);
  assert.deepEqual(m.envios, ['v1'], 'depois do veredito de sessão morta, a decisão saiu de novo');
  assert.equal(m.h.carregarFilaDeSaida().length, 1);
});

test('R7-1-05: CONTROLE — a conferência diz VIVA: a decisão sai de novo, UMA vez, DEPOIS do veredito (a trava foi devolvida)', async () => {
  const m = montarXQueLeva401();
  m.h.handleReject();
  await ateQue(() => m.temSonda() && m.travas.pedidas >= 1 && !m.deps.esvaziandoSaida, 'a conferência começou');
  await tique(10);
  const antesDoVeredito = [...m.envios];
  m.deps.proxima = () => ({ success: true });           // a partir daqui o Waze aceita
  m.responderSonda({ success: true, profile: { id: 111 } });
  await ateQue(() => m.h.carregarFilaDeSaida().length === 0, 'a fila de saída vazia depois do alarme falso');
  await tique(10);
  assert.deepEqual(antesDoVeredito, ['v1'], 'antes do veredito a decisão já tinha saído de novo');
  assert.deepEqual(m.envios, ['v1', 'v1'], 'confirmada a sessão, a decisão não saiu (ou saiu mais de uma vez)');
  assert.equal(m.travas.pedidas, 2, 'o esvaziamento do alarme falso não pegou a trava (a passada anterior a prendeu?)');
});

// ═══ R6-1-03 · o card travado na queda SEM extensão (o celular) ═══════════════
// A queda pergunta "tem extensão aí?" por 350 ms em TODO aparelho, e o aviso da
// trava lia a pergunta como "a extensão está renovando": no celular (onde ela
// nem instala), o toque no card travado logo depois da queda dizia "Espere a
// conferência da sessão terminar e toque de novo" — e em seguida vinha "Sua
// sessão no app não vale mais" (MEDIDO no Android emulado, o toque 100 ms
// depois da queda, no Chromium e no WebKit, auditoria de 2026-10-02).
test('R6-1-03: "espere a conferência" só DEPOIS do `aguarde` da extensão — a pergunta sozinha não é renovação', async () => {
  const rodar = async (resposta) => {
    const window = janelaFalsa();
    const deps = { window, AppState: { authenticated: false, queue: [] }, epocaDaSessao: 1, saiuNestaPagina: false,
      extNegado: null, extNegadoNestaPagina: false, filaAtravessouSessao: false,
      EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, setTimeout: () => 1, clearTimeout: () => {},
      API: { setSession() {}, getSession: () => null, get sessionToken() { return null; } } };
    const h = montar(['entrarPelaExtensao', 'avisoDaTrava'], deps);
    const p = h.entrarPelaExtensao({ silencioso: true, manterFila: true });
    assert.equal(deps.extPerguntando, true, 'CONTROLE: a pergunta à extensão não saiu');
    const naPergunta = h.avisoDaTrava();
    window.responder({ source: 'wazeplaces-ext', action: 'aguarde' });
    const renovando = h.avisoDaTrava();
    window.responder({ source: 'wazeplaces-ext', ...resposta });
    await p;
    return { naPergunta, renovando, depois: h.avisoDaTrava() };
  };
  const semSessao = await rodar({ action: 'sem-sessao' });
  assert.equal(semSessao.naPergunta, 'api.error.noSession',
    'DEFEITO: com a extensão nem confirmada (o celular), o card travado mandou esperar a conferência');
  assert.equal(semSessao.renovando, 'toast.esperaSessao', 'com a extensão RENOVANDO, o card travado disse "Sessão expirada" (R5-2-07)');
  assert.equal(semSessao.depois, 'api.error.noSession', 'a renovação acabou (e não deu) e o card travado segue mandando esperar');
  // CONTROLE: a renovação que DÁ CERTO também solta a marca.
  const entrou = await rodar({ action: 'sessao', token: 'tokB' });
  assert.equal(entrou.renovando, 'toast.esperaSessao');
  assert.equal(entrou.depois, 'api.error.noSession', 'a marca da renovação ficou acesa depois de ela acabar');
});

// R7-1-09: o fim da renovação que não deu ACENDE a marca da queda dita (o toque
// no card travado cala até a tela de entrada, test/card-foco-trava); uma queda
// nova a apaga, e a sessão que volta (`showMainScreen`) também.
test('R7-1-09: a queda é dada por DITA só quando a renovação acaba sem dar — e a sessão que volta a apaga', async () => {
  const montarQueda = (renovou) => {
    const deps = {
      AppState: { authenticated: true, pendingAction: null, queue: [], fetchEpoch: 0 }, epocaDaSessao: 0, quedaAnunciada: true,
      API: { sessionToken: 'tok', setSession() {}, soltarSessao() {}, getSession: () => 'tok' },
      MOTIVO_DA_QUEDA: constante('MOTIVO_DA_QUEDA'), UNAUTHORIZED_REDIRECT_MS: 0, setTimeout: () => 1,
      AVISO_RENOVADA_ESPERA_PERFIL_MS: 0,
      entrarPelaExtensao: async () => renovou, tirarNegadoDaExtensao: () => null, t: (k) => k,
    };
    return { h: montar(['derrubarSessao'], deps), deps };
  };
  const q = montarQueda(false);
  q.h.derrubarSessao('srv.err.sessionExpired');
  assert.equal(q.deps.quedaAnunciada, false, 'a queda NOVA herdou a marca da anterior (calaria o "espere a conferência")');
  await tique();
  assert.equal(q.deps.quedaAnunciada, true, 'DEFEITO: a renovação acabou sem dar e a queda não ficou dita');
  // CONTROLE: a renovação que DEU não deixa a queda dita.
  const r = montarQueda(true);
  r.h.derrubarSessao('srv.err.sessionExpired');
  await tique(); await tique();
  assert.equal(r.deps.quedaAnunciada, false, 'a renovação que deu deixou a queda dita');
  // A sessão que volta (`showMainScreen`) apaga a marca.
  const deps = { AppState: { authenticated: false }, quedaAnunciada: true,
    document: { getElementById: () => ({ classList: { add() {}, remove() {} } }) } };
  montar(['showMainScreen'], deps).showMainScreen();
  assert.equal(deps.quedaAnunciada, false, 'a sessão voltou e a marca da queda ficou — o card travado seguinte ficaria calado');
});

test('R6-1-03: a renovação que NÃO deu tira o "espere a conferência" da tela ANTES do aviso de queda', async () => {
  const log = [];
  const deps = {
    AppState: { authenticated: true, pendingAction: null, queue: [], fetchEpoch: 0 }, epocaDaSessao: 0,
    API: { sessionToken: 'tok', setSession() {}, soltarSessao() {}, getSession: () => 'tok' },
    MOTIVO_DA_QUEDA: constante('MOTIVO_DA_QUEDA'), UNAUTHORIZED_REDIRECT_MS: 0, setTimeout: () => 1,
    // A extensão perguntada (e o toque no card travado mostrou o aviso da espera) — e não renovou.
    entrarPelaExtensao: async () => false, tirarNegadoDaExtensao: () => null,
    dispensarAvisoDaTrava: () => log.push('sai o "espere"'), showToast: (m) => log.push(m), t: (k) => k,
  };
  const h = montar(['derrubarSessao'], deps);
  h.derrubarSessao('srv.err.sessionExpired');
  await tique();
  assert.deepEqual(log, ['sai o "espere"', 'toast.sessionExpired.local'],
    `DEFEITO: o "espere a conferência" ficou na tela com o "a sessão não vale mais": ${log.join(' | ')}`);
});
