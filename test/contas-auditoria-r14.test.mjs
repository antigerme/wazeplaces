// A conta, as abas, a sessão e o "Sair" (auditoria da rodada 14, R14-8 e R14-1 —
// o lote 18 da área "contas"):
//
//  · R14-8-09 — o "N esperando envio" ficava na tela de entrada depois da queda;
//  · R14-8-06 — o "Sair" aberto na janela do Desfazer descartava a decisão calado;
//  · R14-1-04 — a aba que CAIU, com a pergunta à extensão NO AR e texto colado:
//    OUTRA conta entrando noutra aba não a alcançava depois (o fim da pergunta não
//    entrava nem adotava). E o irmão: a pergunta da RENOVAÇÃO da queda que falha;
//  · a pista do lote 17 (s13) — duas abas perguntando à extensão com um login no
//    ar numa delas: a que decidia primeiro apagava no servidor a sessão que a
//    outra ia usar;
//  · R14-1-03 — duas abas da MESMA conta com sessões DIFERENTES: quando a GUARDADA
//    no aparelho caía numa delas, a outra, VIVA, ficava sem sessão no aparelho
//    (recarregá-la levava à tela de entrada, com a sessão dela órfã no servidor).
//    DECIDIDO: a viva volta a guardar a sua. O aviso do token sozinho não separa a
//    queda do "Sair" — MEDIDO: no "Sair" ele chega com a CONTA ainda no aparelho
//    (abas em processos diferentes) —, e quem diz que foi a queda é a aba que caiu,
//    pelo canal da sessão;
//  · a pista s18 (pedido extra do lote) — o "Sair" de outra aba numa aba que CAIU na
//    tela de entrada com a pergunta à extensão NO AR ia pelo caminho cheio: o
//    "Colar cookies" fechava com o texto, e "Você saiu em outra aba" aparecia numa
//    aba que nem estava logada;
//  · o resto do s15b (R14-1, pedido extra do lote) — a aba cuja sessão caiu ANTES de o
//    perfil chegar não guarda nada (conta, fila, card), o "Sair" de outra aba não a
//    alcançava, e a volta a ela perguntava à extensão e ENTRAVA de novo.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" que aceita qualquer chamada e anota o nome. Cada
// teste foi visto REPROVANDO com o conserto desfeito (as sabotagens estão no
// relatório do lote).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP = ler('js/app.js');
const APP_SEM = semComentario(APP);
const I18N = ler('js/i18n.js');

function fatiarDe(fonte, nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu do app.js`);
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
const fatiar = (nome) => fatiarDe(APP_SEM, nome);
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// Um "buraco negro": aceita qualquer propriedade e qualquer chamada, e anota as
// chamadas pelo caminho.
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

// `deps`: o que as funções enxergam (funções e as variáveis de módulo, que elas
// leem e escrevem direto no objeto). O resto é buraco negro.
function montar(nomes, deps) {
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
  const corpo = nomes.map(fatiar).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}

const TOKEN = 'waze_session_token';
const CONTA_KEY = constante('CONTA_KEY');
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();
const tique = () => new Promise((ok) => setImmediate(ok));
const tiques = async (n = 4) => { for (let i = 0; i < n; i++) await tique(); };
const TEXTO_COLADO = '# Netscape HTTP Cookie File\n.waze.com\tTRUE\t/\tTRUE\t0\t_web_session\tconta=333';

// O armazenamento de UMA aba, espionado.
function aparelho(inicial = {}) {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const escritas = [];
  const localStorage = {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { escritas.push('grava:' + k); dados.set(k, String(v)); },
    removeItem: (k) => { escritas.push('apaga:' + k); dados.delete(k); },
  };
  const safeLS = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
  return { dados, escritas, localStorage, safeLS };
}

// ═══ R14-8-09 · o "N esperando envio" e a sessão ═════════════════════════════
// A tela de mentira, com o corpo onde o indicador nasce e some.
function telaComIndicador({ autenticado = true, fila = ['v1'] } = {}) {
  const els = {};
  const elemento = (id) => {
    const classes = new Set();
    const e = {
      id, style: {}, className: '', innerHTML: '', title: '', textContent: '',
      classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, v) => (v ? classes.add(c) : classes.delete(c)) },
      remove() { delete els[this.id]; },
    };
    return e;
  };
  for (const id of ['authScreen', 'appScreen', 'filtersBtn', 'refreshBtn', 'userProfileBadge', 'brandTitle', 'cardLiveRegion']) els[id] = elemento(id);
  els.logoutModal = elemento('logoutModal');
  els.logoutModal.classList.add('hidden');
  const document = {
    getElementById: (id) => els[id] || null,
    createElement: () => elemento(''),
    body: { appendChild: (e) => { els[e.id] = e; } },
    documentElement: { classList: { remove() {}, add() {} } },
    querySelectorAll: () => [],
  };
  const AppState = { authenticated: autenticado, inFlightActions: 0, profile: { id: 111 }, pendingAction: null, fetchEpoch: 1 };
  const deps = {
    document, AppState, window: { Presenca: { desligar() {}, sincronizar() {} } },
    carregarFilaDeSaida: () => fila.map((v) => ({ tipo: 'reject', venueID: v, updateRequestID: 'u' + v })),
    pedidosEmAndamento: new Set(), chaveDoPedido: (x) => x.venueID + '|' + x.updateRequestID,
    reivindicadoPorOutraAba: () => false, indicadorMarcaVence: null, SAIDA_REIVINDICACAO_MS: 60000,
    t: (k, v) => k + (v ? ':' + JSON.stringify(v) : ''), escapeHtml: (s) => String(s),
    // O `derrubarSessao`: a sessão desta aba é a guardada, e a renovação fica no ar.
    API: { sessionToken: 'TOK-A', setSession() {}, soltarSessao() {} }, safeLS: { get: () => 'TOK-A' },
    epocaDaSessao: 0, quedaAnunciada: false, Treino: { ativo: false },
    entrarPelaExtensao: () => new Promise(() => {}), avisarOutrasAbasDaQueda: () => {},
  };
  const h = montar(['updateInFlightIndicator', 'saindoPelaOutraAba', 'showAuthScreen', 'showMainScreen', 'derrubarSessao',
    'sessaoDestaAbaEhAGuardada'], deps);
  const indicador = () => (els.inFlightIndicator ? els.inFlightIndicator.title : null);
  return { h, AppState, indicador };
}

test('R14-8-09: a QUEDA tira da tela o "N esperando envio" (sem sessão a fila de saída não aparece) — e a tela de entrada também', () => {
  for (const [caso, cair] of [['a queda (`derrubarSessao`)', (m) => m.h.derrubarSessao('srv.err.sessionExpired')],
    ['a tela de entrada (`showAuthScreen`)', (m) => m.h.showAuthScreen()]]) {
    const m = telaComIndicador();
    m.h.updateInFlightIndicator();
    assert.equal(m.indicador(), 'indicator.waiting:{"n":1}', 'PRÉ-CONDIÇÃO: o indicador não estava na tela');
    cair(m);
    assert.equal(m.AppState.authenticated, false);
    assert.equal(m.indicador(), null,
      `DEFEITO (${caso}): o "1 esperando envio" ficou na tela sem sessão — no canto do "Bem-vindo!", com o relógio de "parado esperando rede"`);
  }
});

test('R14-8-09: a sessão que VOLTA (`showMainScreen`, a renovação) mostra de novo o que espera envio', () => {
  const m = telaComIndicador({ autenticado: false });
  m.h.updateInFlightIndicator();
  assert.equal(m.indicador(), null, 'PRÉ-CONDIÇÃO: sem sessão, o indicador apareceu');
  m.h.showMainScreen();
  assert.equal(m.indicador(), 'indicator.waiting:{"n":1}',
    'DEFEITO: a sessão voltou e o que espera envio na fila de saída não apareceu (a queda o tirou da tela)');
  // CONTROLE: sem nada na fila, nada aparece.
  const v = telaComIndicador({ autenticado: false, fila: [] });
  v.h.showMainScreen();
  assert.equal(v.indicador(), null);
});

// ═══ R14-8-06 · o "Sair" aberto na janela do Desfazer ════════════════════════
function sairNaJanela({ noAr = [] } = {}) {
  const log = [];
  const el = { textContent: '', escondido: true, classList: { toggle: (c, v) => { if (c === 'hidden') el.escondido = v; } } };
  const AppState = { pendingAction: { type: 'reject', execute: () => log.push('a decisão da janela saiu') } };
  const deps = {
    AppState, t: (k, v) => k + (v ? ':' + JSON.stringify(v) : ''),
    document: { getElementById: (id) => (id === 'logoutSaidaAviso' ? el : null) },
    enviarPendenciasDoLightbox: () => log.push('as da foto saíram'),
    removeUndoBanner: () => log.push('o banner saiu'),
    openModal: (id) => log.push('abriu ' + id),
    // A decisão da janela é anotada na fila de saída quando sai, e está EM ANDAMENTO desde o gesto.
    carregarFilaDeSaida: () => noAr.map((v) => ({ tipo: 'reject', venueID: v, updateRequestID: 'u' + v })),
    pedidosEmAndamento: new Set(noAr.map((v) => v + '|u' + v)),
    chaveDoPedido: (x) => x.venueID + '|' + x.updateRequestID, reivindicadoPorOutraAba: () => false,
  };
  const h = montar(['abrirDialogoDoSair', 'despacharJanelaDoDesfazer', 'desenharAvisoDoSair'], deps);
  return { h, log, el, AppState };
}

test('R14-8-06: abrir o "Sair" na janela do Desfazer DESPACHA a janela — a decisão (e as da foto) sai, o banner sai, e só então o diálogo abre', () => {
  const m = sairNaJanela();
  m.h.abrirDialogoDoSair();
  assert.deepEqual(m.log, ['a decisão da janela saiu', 'as da foto saíram', 'o banner saiu', 'abriu logoutModal'],
    'DEFEITO: o diálogo do "Sair" abriu com a janela correndo — o banner fica por cima dele e o "Sair" descarta a decisão calado: ' + JSON.stringify(m.log));
  assert.equal(m.AppState.pendingAction, null);
  // E o "Sair" da Ajuda passa por aqui.
  assert.match(APP_SEM, /\$\('logoutBtn'\)\.addEventListener\('click', \(\) => abrirDialogoDoSair\(\)\);/,
    'o botão "Sair" não abre o diálogo pelo `abrirDialogoDoSair`');
});

test('R14-8-06: CONTROLE — a decisão que acabou de sair (em andamento) não entra no aviso; o que ESPERA envio entra, como antes', () => {
  const noAr = sairNaJanela({ noAr: ['v1'] });
  noAr.h.abrirDialogoDoSair();
  assert.equal(noAr.el.escondido, true, 'a decisão que acabou de sair foi contada como "descartada"');
  const esperando = sairNaJanela();
  esperando.h.desenharAvisoDoSair();
  assert.equal(esperando.el.escondido, true);
});

// ═══ R14-1-04 · outra conta com a pergunta à extensão NO AR ═══════════════════
const MODAIS_DA_ENTRADA = constante('MODAIS_DA_ENTRADA');
const BOTAO_DA_ACAO = constante('BOTAO_DA_ACAO');
// A tela de entrada de mentira: a tela (com o "Colar cookies"), os diálogos dela
// (com o campo de cada um) e o FOCO.
function telaDeEntrada({ dialogo = null, texto = '', foco = null } = {}) {
  const els = {};
  const el = (id, { oculto = false, pai = null } = {}) => {
    const classes = new Set(oculto ? ['hidden'] : []);
    const e = {
      id, value: '', pai,
      classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
      contains(outro) { for (let x = outro; x; x = x.pai) if (x === e) return true; return false; },
    };
    els[id] = e;
    return e;
  };
  const tela = el('authScreen');
  el('pasteBtn', { pai: tela });
  for (const [modal, campo] of [['pasteModal', 'cookiesTextarea'], ['pairEnterModal', 'pairCodeInput']]) {
    const m = el(modal, { oculto: dialogo !== modal });
    el(campo, { pai: m }).value = dialogo === modal ? texto : '';
  }
  el('closeAccessDenied', { pai: el('accessDeniedModal', { oculto: dialogo !== 'accessDeniedModal' }) });
  el('appScreen', { oculto: true });
  const body = { id: 'BODY' };
  const document = { visibilityState: 'visible', body, documentElement: { id: 'HTML' }, getElementById: (id) => els[id] || null,
    querySelector: () => null };
  Object.defineProperty(document, 'activeElement', { get: () => (foco ? els[foco] : body) });
  return {
    els, document,
    fechar(id) {
      els[id].classList.add('hidden');
      if (id === 'pasteModal') els.cookiesTextarea.value = '';
      if (id === 'pairEnterModal') els.pairCodeInput.value = '';
    },
    digitar(modal, campo, valor) { els[modal].classList.remove('hidden'); els[campo].value = valor; foco = campo; },
    mostrarOApp() { els.authScreen.classList.add('hidden'); els.appScreen.classList.remove('hidden'); },
  };
}

// A janela de mentira: o que o app posta à extensão (a pergunta) fica anotado, e
// `responder` entrega a resposta da ponte pelo `message`, como a de verdade.
function janelaComExtensao(log) {
  const ouvintes = new Set();
  const window = {
    location: { origin: 'https://app' },
    addEventListener: (tipo, fn) => { if (tipo === 'message') ouvintes.add(fn); },
    removeEventListener: (tipo, fn) => ouvintes.delete(fn),
    postMessage: (m) => { if (m && m.action === 'precisa-de-sessao') log.push('perguntou à extensão'); },
  };
  const responder = (data) => {
    for (const fn of [...ouvintes]) fn({ source: window, origin: window.location.origin, data: { source: 'wazeplaces-ext', ...data } });
  };
  return { window, responder };
}

// O `api.js` DE VERDADE (num contexto do `vm`): é nele que mora o `getSession` que
// a adoção usa.
function apiDeVerdade(guardado = {}) {
  const dados = new Map(Object.entries(guardado));
  const ctx = {
    navigator: { language: 'pt', onLine: true },
    document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: {
      getItem: (k) => (dados.has(k) ? dados.get(k) : null),
      setItem: (k, v) => { dados.set(k, String(v)); },
      removeItem: (k) => { dados.delete(k); },
    },
    performance, AbortController, Response, console, setTimeout, clearTimeout,
  };
  ctx.window = {};
  vm.createContext(ctx);
  vm.runInContext(I18N + '\n' + ler('js/api.js') + '\nthis.API = API; this.safeLS = safeLS;', ctx);
  return { API: ctx.API, safeLS: ctx.safeLS, dados };
}

// A aba que CAIU na tela de entrada (a fila, o card e a conta 111 na memória, o
// aparelho sem sessão) e volta à vista: a pergunta silenciosa à extensão sai.
function voltaDaQueCaiu({ tela = {} } = {}) {
  const t = telaDeEntrada(tela);
  const log = [];
  const real = apiDeVerdade({ [CONTA_KEY]: JSON.stringify({ id: '111', s: marcaDe('TOK-A') }) });
  real.API._post = async (rota, corpo) => { log.push('rota ' + rota + (corpo && corpo.action ? ' ' + corpo.action : '') + (corpo && corpo.sessionToken ? ' ' + corpo.sessionToken : '')); return { success: true }; };
  const ext = janelaComExtensao(log);
  const AppState = { authenticated: false, profile: null, queue: [{ venueID: 'p1' }], currentPlace: { venueID: 'p1' } };
  const deps = {
    window: ext.window, document: t.document, API: real.API, safeLS: real.safeLS, AppState, CONTA_KEY,
    MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000,
    resgateEmVoo: false, authInFlight: false, extPerguntando: false, extRenovando: false,
    extNegadoNestaPagina: false, extNegado: null, saiuNestaPagina: false, filaAtravessouSessao: false, focoDoTeclado: null,
    epocaDaSessao: 0, setTimeout: () => 1, clearTimeout: () => {}, callWithRetry: (fn) => fn(),
    podeInstalarExtensao: () => true, contaConfirmadaNestaAba: { id: '111', s: marcaDe('TOK-A') },
    closeModal: (id) => { log.push('fechou ' + id); t.fechar(id); },
    showMainScreen: () => { log.push('app com ' + real.API.sessionToken); AppState.authenticated = true; t.mostrarOApp(); },
    showAuthScreen: () => log.push('tela de entrada'),
    resetQueue: () => {}, loadProfileAndAuxData: () => null, conhecerContaDoLogin: () => {}, startFetching: () => {},
    esvaziarFilaDeSaida: () => {}, mostrarEntrandoPelaExtensao: () => {}, abrirComSessaoSalva: () => log.push('adotou'),
    showAccessDenied: () => log.push('acesso restrito'),
    handleLogout: (o) => log.push(['sair', o]), conferirContaDestaAba: () => log.push('conferiu a conta'),
    relerPlacarDeOutraAba: () => {}, relerPreferenciasDeOutraAba: () => {}, updateInFlightIndicator: () => {},
    guardarDeVoltaASessaoDestaAba: () => false,
  };
  const h = montar(['aoVoltarAAba', 'perguntarAExtensaoAoVoltar', 'entrarPelaExtensao', 'adotarSessaoDoAparelho',
    'textoDigitadoNaEntrada', 'focoNaTelaDeEntrada', 'fecharModaisDaEntrada', 'aoEntrarNestaPagina',
    'tirarNegadoDaExtensao', 'mostrarNegadoDaExtensao', 'negadoDaExtensao', 'aoFimDaPerguntaDaAbertura',
    'seOutraContaTomouOAparelhoDaQueCaiu', 'outraContaTomouOAparelhoDaQueCaiu', 'contaSegueNoAparelho',
    'sessaoDestaAbaEhAGuardada', 'sincronizarComOutraAba', 'aoSairEmOutraAba', 'aoEntrarOutraContaEmOutraAba',
    'guardaASessaoQueCaiu', 'contaDestaAbaEmDuvida', 'marcaDaSessao'], deps);
  // OUTRA conta (222) entra noutra aba: o token e a conta dela chegam ao aparelho, com o aviso.
  const outraContaEntra = () => {
    real.dados.set(TOKEN, 'TOK-C');
    h.sincronizarComOutraAba(TOKEN);
    real.dados.set(CONTA_KEY, JSON.stringify({ id: '222', s: marcaDe('TOK-C') }));
    h.sincronizarComOutraAba(CONTA_KEY);
  };
  const saiu = () => log.filter((x) => Array.isArray(x) && x[0] === 'sair').map((x) => x[1]);
  return { h, deps, log, real, tela: t, responder: ext.responder, outraContaEntra, saiu };
}
const SAIDA_DA_QUE_CAIU = { porOutraAba: true, outraConta: true, naEntrada: true };

test('R14-1-04: OUTRA conta entra com a pergunta da VOLTA no ar e o cookies.txt colado — o fim da pergunta (sem entrar nem adotar) alcança a aba que caiu, e o texto fica', async () => {
  for (const resposta of [{ action: 'sessao', token: 'TOK-EXT', conta: '111' }, { action: 'sem-sessao' }]) {
    const m = voltaDaQueCaiu();
    m.h.aoVoltarAAba();
    assert.ok(m.log.includes('perguntou à extensão'), 'PRÉ-CONDIÇÃO: a volta não perguntou à extensão');
    m.tela.digitar('pasteModal', 'cookiesTextarea', TEXTO_COLADO);   // a pessoa cola, com a pergunta no ar
    m.outraContaEntra();
    assert.deepEqual(m.saiu(), [], 'PRÉ-CONDIÇÃO: com a pergunta no ar, o aviso da outra conta já decidiu (o R13-1-06 deixa pro fim dela)');
    m.responder({ action: 'aguarde' });
    m.responder(resposta);
    await tiques();
    assert.deepEqual(m.saiu(), [SAIDA_DA_QUE_CAIU],
      `DEFEITO (${resposta.action}): a aba que caiu segue com a fila, o card e a conta da anterior, com o aparelho já de OUTRA conta: ` + JSON.stringify(m.log));
    assert.equal(m.tela.els.cookiesTextarea.value, TEXTO_COLADO, `(${resposta.action}) o que estava colado foi apagado`);
    assert.ok(!m.tela.els.pasteModal.classList.contains('hidden'), `(${resposta.action}) o "Colar cookies" fechou`);
    assert.ok(!m.log.some((x) => typeof x === 'string' && x.startsWith('app com ')), 'entrou alguma sessão nesta aba');
  }
});

test('R14-1-04: CONTROLES — a MESMA conta no aparelho não encerra nada; sem texto, a sessão da outra aba é ADOTADA (como hoje)', async () => {
  const mesma = voltaDaQueCaiu();
  mesma.h.aoVoltarAAba();
  mesma.tela.digitar('pasteModal', 'cookiesTextarea', TEXTO_COLADO);
  mesma.real.dados.set(TOKEN, 'TOK-Y');
  mesma.real.dados.set(CONTA_KEY, JSON.stringify({ id: '111', s: marcaDe('TOK-Y') }));
  mesma.responder({ action: 'sem-sessao' });
  await tiques();
  assert.deepEqual(mesma.saiu(), [], 'a MESMA conta entrando noutra aba encerrou a memória desta (a queda a mantém pra ela voltar)');
  const semTexto = voltaDaQueCaiu();
  semTexto.h.aoVoltarAAba();
  semTexto.outraContaEntra();
  semTexto.responder({ action: 'sem-sessao' });
  await tiques();
  assert.ok(semTexto.log.includes('adotou'), 'CONTROLE: sem texto, o fim da pergunta deixou de adotar a sessão do aparelho');
  assert.deepEqual(semTexto.saiu(), [], 'a adoção já limpa pela memória (aoConhecerConta): sair aqui seria em dobro');
});

test('R14-1-04: o fim da pergunta da ABERTURA que não entrou nem adotou também confere de quem é o aparelho', () => {
  const m = voltaDaQueCaiu({ tela: { dialogo: 'pasteModal', texto: TEXTO_COLADO, foco: 'cookiesTextarea' } });
  m.real.dados.set(TOKEN, 'TOK-C');
  m.real.dados.set(CONTA_KEY, JSON.stringify({ id: '222', s: marcaDe('TOK-C') }));
  m.h.aoFimDaPerguntaDaAbertura(false);
  assert.ok(m.log.includes('tela de entrada'));
  assert.deepEqual(m.saiu(), [SAIDA_DA_QUE_CAIU], 'DEFEITO: o fim da pergunta da abertura não conferiu a conta do aparelho');
  // CONTROLE: o aparelho da mesma conta.
  const c = voltaDaQueCaiu({ tela: { dialogo: 'pasteModal', texto: TEXTO_COLADO, foco: 'cookiesTextarea' } });
  c.real.dados.set(TOKEN, 'TOK-Y');
  c.h.aoFimDaPerguntaDaAbertura(false);
  assert.deepEqual(c.saiu(), []);
});

// O irmão: a pergunta da RENOVAÇÃO da queda (o app ainda na tela) no ar quando a
// outra conta entra, e a renovação falha. O `derrubarSessao` de verdade.
function quedaComRenovacaoNoAr({ conta = '222' } = {}) {
  const log = [];
  const ap = aparelho({ [TOKEN]: 'TOK-A', [CONTA_KEY]: { id: '111', s: marcaDe('TOK-A') } });
  const appScreen = { hidden: false, classList: { contains: (c) => (c === 'hidden' ? appScreen.hidden : false) } };
  let redirecionar = null;
  const deps = {
    safeLS: ap.safeLS, CONTA_KEY, AppState: { authenticated: true, profile: { id: 111 }, pendingAction: null, fetchEpoch: 1, queue: [{ venueID: 'p1' }] },
    API: {
      sessionToken: 'TOK-A',
      temSessaoNaMemoria() { return !!this.sessionToken; },
      setSession(t) { this.sessionToken = t; if (t) ap.safeLS.set(TOKEN, t); else ap.safeLS.remove(TOKEN); },
      soltarSessao() { this.sessionToken = null; },
    },
    document: { getElementById: (id) => (id === 'appScreen' ? appScreen : null), querySelector: () => null },
    epocaDaSessao: 0, quedaAnunciada: false, Treino: { ativo: false }, extPerguntando: false,
    contaConfirmadaNestaAba: { id: '111', s: marcaDe('TOK-A') },
    entrarPelaExtensao: () => Promise.resolve(false),   // a renovação não deu certo
    tirarNegadoDaExtensao: () => null,
    setTimeout: (f) => { redirecionar = f; return 1; },
    fecharCamadasAbertas: (f) => { if (typeof f === 'function') f(); },
    showAuthScreen: () => { log.push('tela de entrada'); appScreen.hidden = true; },
    handleLogout: (o) => log.push(['sair', o]),
    avisarOutrasAbasDaQueda: () => {},
  };
  const h = montar(['derrubarSessao', 'sessaoDestaAbaEhAGuardada', 'seOutraContaTomouOAparelhoDaQueCaiu',
    'outraContaTomouOAparelhoDaQueCaiu', 'contaSegueNoAparelho', 'marcaDaSessao'], deps);
  return {
    log, ap, h,
    async cair() {
      h.derrubarSessao('srv.err.sessionExpired');
      // Com a renovação no ar, OUTRA conta entra noutra aba (o token e a conta dela).
      ap.dados.set(TOKEN, 'TOK-C');
      ap.dados.set(CONTA_KEY, JSON.stringify({ id: conta, s: marcaDe('TOK-C') }));
      await tiques();
      assert.equal(typeof redirecionar, 'function', 'PRÉ-CONDIÇÃO: a renovação que falhou não agendou a tela de entrada');
      redirecionar();
    },
  };
}

test('R14-1-04 (irmão): a RENOVAÇÃO da queda falha com OUTRA conta tendo tomado o aparelho no meio — a aba que caiu não fica com a memória da anterior', async () => {
  const m = quedaComRenovacaoNoAr();
  await m.cair();
  assert.ok(m.log.includes('tela de entrada'));
  assert.deepEqual(m.log.filter((x) => Array.isArray(x)), [['sair', SAIDA_DA_QUE_CAIU]],
    'DEFEITO: a renovação que falhou deixou a aba na tela de entrada com a fila, o card e a conta da anterior (o aparelho já de OUTRA conta): ' + JSON.stringify(m.log));
  // CONTROLE: a MESMA conta no aparelho fica (a memória é pra ela voltar).
  const c = quedaComRenovacaoNoAr({ conta: '111' });
  await c.cair();
  assert.deepEqual(c.log.filter((x) => Array.isArray(x)), [], 'a MESMA conta encerrou a memória da aba que caiu');
});

// ═══ a pista do lote 17 (s13) · a sessão que a extensão entrega a VÁRIAS abas ══
const PERGUNTA_EXT_TRAVA = constante('PERGUNTA_EXT_TRAVA');
// As travas do navegador de mentira, DIVIDIDAS pelas abas: `request` segura a
// trava até o callback devolver (uma promessa, aqui), `query` diz quem segura.
// `antesDeResponder`: o que acontece ENQUANTO a pergunta ao navegador corre.
function travasDoNavegador() {
  const seguras = new Map();
  const t = {
    antesDeResponder: null,
    de: () => ({
      request(nome, cb) {
        return new Promise((ok, erro) => {
          queueMicrotask(async () => {
            seguras.set(nome, true);
            try { ok(await cb({ name: nome })); } catch (e) { erro(e); } finally { seguras.delete(nome); }
          });
        });
      },
      async query() {
        await tique();
        if (typeof t.antesDeResponder === 'function') t.antesDeResponder();
        return { held: [...seguras.keys()].map((name) => ({ name, mode: 'exclusive' })), pending: [] };
      },
    }),
    seguras,
  };
  return t;
}

// Uma ABA perguntando à extensão, sobre o aparelho de todas (`ap`, um Map) e as
// travas de todas. `noAr`: um login desta aba no meio (o login dela vence).
function abaPerguntando(nome, { ap, travas, apagadas, noAr = null, comTravas = true }) {
  const log = [];
  const ext = janelaComExtensao(log);
  const t = telaDeEntrada({});
  const API = {
    sessionToken: null,
    temSessaoNaMemoria() { return !!this.sessionToken; },
    setSession(tok) { log.push('entrou com ' + tok); this.sessionToken = tok; ap.set(TOKEN, tok); },
    destroySession: (tok) => { apagadas.push(nome + ' apagou ' + tok); return Promise.resolve({ success: true }); },
  };
  const deps = {
    window: ext.window, document: t.document, MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, AppState: {}, API,
    navigator: comTravas ? { locks: travas.de() } : {},
    PERGUNTA_EXT_TRAVA, PERGUNTA_EXT_ID: nome,
    safeLS: { get: (k) => (ap.has(k) ? ap.get(k) : null) },
    authInFlight: noAr === 'cookies', resgateEmVoo: false, callWithRetry: (fn) => fn(),
    EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, epocaDaSessao: 0, extPerguntando: false, extRenovando: false,
    extNegadoNestaPagina: false, extNegado: null, saiuNestaPagina: false, filaAtravessouSessao: false, focoDoTeclado: null,
    setTimeout: () => 1, clearTimeout: () => {},
    closeModal: (id) => t.fechar(id), showMainScreen: () => log.push('app'),
    resetQueue: () => {}, loadProfileAndAuxData: () => Promise.resolve(), conhecerContaDoLogin: () => {},
    startFetching: () => {}, esvaziarFilaDeSaida: () => {}, mostrarEntrandoPelaExtensao: () => {},
  };
  const h = montar(['entrarPelaExtensao', 'segurarTravaDaPergunta', 'outraAbaPerguntandoAExtensao', 'textoDigitadoNaEntrada',
    'focoNaTelaDeEntrada', 'fecharModaisDaEntrada', 'aoEntrarNestaPagina'], deps);
  return { h, log, API, responder: ext.responder, perguntar: () => h.entrarPelaExtensao({ silencioso: true }) };
}
const SESSAO_EXT = { action: 'sessao', token: 'TOK-EXT', conta: '111' };

test('pista s13: duas abas perguntam à extensão e uma tem um login no ar — a que decide PRIMEIRO não apaga a sessão que a outra vai usar', async () => {
  const ap = new Map(), travas = travasDoNavegador(), apagadas = [];
  const X = abaPerguntando('X', { ap, travas, apagadas, noAr: 'cookies' });
  const Y = abaPerguntando('Y', { ap, travas, apagadas });
  const px = X.perguntar(), py = Y.perguntar();
  await tiques();
  assert.equal(travas.seguras.size, 2, 'PRÉ-CONDIÇÃO: as duas perguntas não seguraram a trava delas');
  X.responder(SESSAO_EXT);                       // X decide primeiro: o login dela vence
  assert.equal(await px, false, 'PRÉ-CONDIÇÃO: o login de X no ar não venceu a sessão da extensão');
  await tiques(6);
  assert.deepEqual(apagadas, [], 'DEFEITO: X apagou no servidor a sessão que a ponte entregou também a Y, que ainda vai usá-la');
  Y.responder(SESSAO_EXT);
  assert.equal(await py, true);
  await tiques(6);
  assert.deepEqual(Y.log.filter((x) => x.startsWith('entrou')), ['entrou com TOK-EXT']);
  assert.deepEqual(apagadas, [], 'a sessão que Y usa foi apagada do servidor');
  assert.equal(travas.seguras.size, 0, 'uma pergunta acabou sem soltar a trava (a outra aba nunca mais apagaria nada)');
});

test('pista s13: as DUAS perdem (um login no ar em cada) — a ÚLTIMA a decidir apaga, uma vez só', async () => {
  const ap = new Map(), travas = travasDoNavegador(), apagadas = [];
  const X = abaPerguntando('X', { ap, travas, apagadas, noAr: 'cookies' });
  const Y = abaPerguntando('Y', { ap, travas, apagadas, noAr: 'cookies' });
  X.perguntar(); Y.perguntar();
  await tiques();
  X.responder(SESSAO_EXT);
  await tiques(6);
  assert.deepEqual(apagadas, [], 'X apagou com Y ainda perguntando');
  Y.responder(SESSAO_EXT);
  await tiques(6);
  assert.deepEqual(apagadas, ['Y apagou TOK-EXT'],
    'DEFEITO: ninguém ficou com a sessão da extensão e ela não saiu do servidor (ou saiu duas vezes): ' + JSON.stringify(apagadas));
});

test('pista s13: a outra aba guarda a sessão ENQUANTO a pergunta ao navegador corre — a conferência do aparelho se repete depois dela', async () => {
  const ap = new Map(), travas = travasDoNavegador(), apagadas = [];
  const X = abaPerguntando('X', { ap, travas, apagadas, noAr: 'cookies' });
  X.perguntar();
  await tiques();
  // Ninguém mais pergunta quando o navegador responde — mas a outra aba (que já
  // acabou a dela) acabou de guardar a sessão no aparelho.
  travas.antesDeResponder = () => ap.set(TOKEN, 'TOK-EXT');
  X.responder(SESSAO_EXT);
  await tiques(6);
  assert.deepEqual(apagadas, [], 'DEFEITO: X apagou a sessão que a outra aba guardou enquanto a conferência corria');
});

test('pista s13: CONTROLES — sozinha (ou sem as travas do navegador), a aba cujo login venceu apaga a sessão da extensão, como antes', async () => {
  const ap = new Map(), travas = travasDoNavegador(), apagadas = [];
  const X = abaPerguntando('X', { ap, travas, apagadas, noAr: 'cookies' });
  X.perguntar();
  await tiques();
  X.responder(SESSAO_EXT);
  await tiques(6);
  assert.deepEqual(apagadas, ['X apagou TOK-EXT'], 'CONTROLE: sozinha, a sessão da extensão que perdeu ficou órfã no servidor');
  const semTravas = [];
  const S = abaPerguntando('S', { ap: new Map(), travas, apagadas: semTravas, noAr: 'cookies', comTravas: false });
  S.perguntar();
  S.responder(SESSAO_EXT);
  assert.deepEqual(semTravas, ['S apagou TOK-EXT'], 'sem as travas do navegador, o caminho de antes (na hora) mudou');
  // A guardada no aparelho segue sem sair (R11-1-03).
  const g = new Map([[TOKEN, 'TOK-EXT']]), ag = [];
  const G = abaPerguntando('G', { ap: g, travas: travasDoNavegador(), apagadas: ag, noAr: 'cookies' });
  G.perguntar();
  await tiques();
  G.responder(SESSAO_EXT);
  await tiques(6);
  assert.deepEqual(ag, [], 'a sessão da extensão que já é a do aparelho saiu do servidor');
});

// ═══ R14-1-03 · a aba viva volta a guardar a sua sessão ══════════════════════
const SESSOES_KEY = constante('SESSOES_KEY');
const SESSOES_TETO = constante('SESSOES_TETO');
const CANAL_DA_SESSAO = constante('CANAL_DA_SESSAO');
const QUEDA_DE_OUTRA_ABA_VALE_MS = constante('QUEDA_DE_OUTRA_ABA_VALE_MS');
const GUARDAR_DE_VOLTA_ESPERA_MS = constante('GUARDAR_DE_VOLTA_ESPERA_MS');
// O APARELHO de várias abas com a VISÃO de cada uma: a gravação de uma chega à
// outra JUNTO com o aviso (`storage`), um por chave e na ordem em que foi feita —
// é como o navegador faz com as abas em processos diferentes, o padrão do
// computador (MEDIDO no Chromium e no WebKit). É o que faz o aviso do TOKEN, no
// "Sair" de lá, chegar com a CONTA ainda no aparelho desta aba.
function aparelhoDeAbas(inicial = {}) {
  const abas = new Map();
  const fila = [];
  const texto = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  return {
    aba(nome, ouvir = null) {
      const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, texto(v)]));
      const reg = { dados, ouvir };
      abas.set(nome, reg);
      const escrever = (k, v) => {
        const antes = dados.has(k) ? dados.get(k) : null;
        if (v === null) dados.delete(k); else dados.set(k, String(v));
        for (const outro of abas.keys()) {
          if (outro !== nome) fila.push({ para: outro, key: k, oldValue: antes, newValue: v === null ? null : String(v) });
        }
      };
      const localStorage = {
        getItem: (k) => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => escrever(k, v),
        removeItem: (k) => escrever(k, null),
      };
      const safeLS = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
      return { dados, localStorage, safeLS, ouvir: (fn) => { reg.ouvir = fn; } };
    },
    // Entrega `n` avisos (todos, sem `n`): a gravação entra na visão da aba e o
    // ouvinte dela roda. Com TETO: uma aba que respondesse gravando ao aviso da
    // outra mandaria outro de volta, e o laço penduraria o teste (gotcha #19).
    entregar(n = Infinity) {
      let i = 0;
      while (fila.length && i < n) {
        i++;
        assert.ok(i <= 200, 'LAÇO: as abas gravam em resposta ao aviso uma da outra');
        const ev = fila.shift();
        const a = abas.get(ev.para);
        if (ev.newValue === null) a.dados.delete(ev.key); else a.dados.set(ev.key, ev.newValue);
        if (a.ouvir) a.ouvir({ key: ev.key, oldValue: ev.oldValue, newValue: ev.newValue });
      }
    },
    pendentes: () => fila.map((e) => e.para + ':' + e.key),
  };
}

// O `BroadcastChannel` de mentira: cada mensagem fica na fila até o teste entregá-la
// (a ordem entre o canal e o `storage` é o teste que escolhe — no navegador não há).
function canais() {
  const inscritos = new Map();
  const fila = [];
  class CanalDeMentira {
    constructor(nome) {
      this.nome = nome;
      this.onmessage = null;
      if (!inscritos.has(nome)) inscritos.set(nome, new Set());
      inscritos.get(nome).add(this);
    }
    postMessage(msg) { for (const o of inscritos.get(this.nome)) if (o !== this) fila.push([o, structuredClone(msg)]); }
    close() { inscritos.get(this.nome).delete(this); }
  }
  return {
    BroadcastChannel: CanalDeMentira,
    entregar() {
      let i = 0;
      while (fila.length) {
        assert.ok(++i <= 50, 'LAÇO no canal');
        const [o, m] = fila.shift();
        if (typeof o.onmessage === 'function') o.onmessage({ data: m });
      }
    },
    pendentes: () => fila.length,
  };
}

// A aba A, VIVA, com a SUA sessão (a que NÃO é a guardada): o caminho do aviso
// (`aoGravarEmOutraAba` → `sincronizarComOutraAba`) e o do canal, de verdade.
const NOMES_ABA_VIVA = ['aoGravarEmOutraAba', 'sincronizarComOutraAba', 'aoSairEmOutraAba', 'aoEntrarOutraContaEmOutraAba',
  'outraContaTomouOAparelhoDaQueCaiu', 'contaSegueNoAparelho', 'sessaoDestaAbaEhAGuardada', 'guardaASessaoQueCaiu',
  'contaDestaAbaEmDuvida', 'marcaDaSessao', 'marcaDestaAba', 'abrirCanalDaSessao', 'aoCairASessaoGuardadaEmOutraAba',
  'contaSabidaDestaAba', 'guardarDeVoltaASessaoDestaAba', 'contaQuePodeGuardarDeVolta', 'marcarSessaoJaAtiva',
  'lerDiarioDeSessoes', 'registrarEventoDeSessao'];

function abaViva(ap, rede, { token = 'TOK-A', perfil = { id: 111 }, confirmada = null, noAr = null, emDuvida = false } = {}) {
  const log = [];
  const v = ap.aba('A');
  // O relógio de mentira: a guarda AGENDADA só roda quando o teste passa o tempo.
  const relogio = [];
  const API = {
    sessionToken: token,
    temSessaoNaMemoria() { return !!this.sessionToken; },
    setSession(t) {
      log.push('setSession:' + t);
      this.sessionToken = t;
      if (t) v.localStorage.setItem(TOKEN, t); else v.localStorage.removeItem(TOKEN);
    },
    soltarSessao() { this.sessionToken = null; },
  };
  const deps = {
    safeLS: v.safeLS, localStorage: v.localStorage, API, BroadcastChannel: rede.BroadcastChannel,
    AppState: { authenticated: true, profile: perfil, queue: [{ venueID: 'p1' }], currentPlace: { venueID: 'p1' }, contaEmDuvida: emDuvida },
    document: { getElementById: (id) => (id === 'appScreen' ? { classList: { contains: () => false } } : null), querySelector: () => null },
    CONTA_KEY, SESSOES_KEY, SESSOES_TETO, CANAL_DA_SESSAO, QUEDA_DE_OUTRA_ABA_VALE_MS,
    canalDaSessao: null, quedaDeOutraAba: null, tokenTiradoPorOutraAba: null,
    contaConfirmadaNestaAba: confirmada,
    extPerguntando: noAr === 'pergunta', authInFlight: noAr === 'cookies', resgateEmVoo: noAr === 'codigo',
    handleLogout: (o) => log.push(['sair', o]), conferirContaDestaAba: () => log.push('conferiu a conta'),
    dfato: (k) => log.push('dfato:' + k), GUARDAR_DE_VOLTA_ESPERA_MS, guardarDeVoltaAgendado: null,
    setTimeout: (f, ms) => { relogio.push({ f, ms }); return relogio.length; },
    clearTimeout: (id) => { if (relogio[id - 1]) relogio[id - 1].f = null; },
  };
  const h = montar(NOMES_ABA_VIVA, deps);
  v.ouvir((ev) => h.aoGravarEmOutraAba(ev));
  h.abrirCanalDaSessao();
  // O tempo passa: roda o que estava agendado (a guarda confere tudo de novo).
  const passarTempo = () => {
    for (const t of relogio.splice(0)) {
      assert.equal(t.ms, GUARDAR_DE_VOLTA_ESPERA_MS);
      if (t.f) t.f();
    }
  };
  return { h, deps, log, API, v, passarTempo, agendou: () => relogio.some((t) => t.f), guardou: () => log.includes('setSession:' + token) };
}

// O aparelho com a sessão de B guardada (a da última que entrou), da conta 111.
const COM_B = { [TOKEN]: 'TOK-B', [CONTA_KEY]: { id: '111', s: marcaDe('TOK-B') } };
// A QUEDA da sessão guardada em B, na ordem do `derrubarSessao`: o diário, o token
// sai, e o aviso pelo canal (a conta FICA).
function quedaEmB(B, canalB, { em = Date.now() } = {}) {
  B.localStorage.setItem(SESSOES_KEY, JSON.stringify([{ t: 1, e: 'token+' }, { t: 2, e: 'caiu' }]));
  B.localStorage.removeItem(TOKEN);
  B.localStorage.setItem(SESSOES_KEY, JSON.stringify([{ t: 1, e: 'token+' }, { t: 2, e: 'caiu' }, { t: 3, e: 'token-' }]));
  canalB.postMessage({ v: 1, caiu: marcaDe('TOK-B'), em });
}

test('R14-1-03: a sessão GUARDADA cai na outra aba — esta, viva e da mesma conta, volta a guardar a SUA, com a marca da conta (o aviso do canal chega ANTES da saída do token)', () => {
  const ap = aparelhoDeAbas(COM_B);
  const rede = canais();
  const A = abaViva(ap, rede);
  const B = ap.aba('B');
  quedaEmB(B, new rede.BroadcastChannel(CANAL_DA_SESSAO));
  rede.entregar();                                   // o aviso da queda chega primeiro
  assert.equal(A.v.dados.get(TOKEN), 'TOK-B', 'PRÉ-CONDIÇÃO: a saída do token já tinha chegado a esta aba');
  assert.ok(!A.agendou(), 'agendou a guarda com o aparelho ainda com o token de lá');
  ap.entregar();                                     // o diário e a saída do token chegam
  assert.ok(A.agendou(), 'DEFEITO: com o aviso da queda e o aparelho sem sessão, a aba viva não agendou a guarda da sua');
  A.passarTempo();
  assert.ok(A.guardou(),
    'DEFEITO: a aba viva não voltou a guardar a sua sessão — o aparelho ficou SEM sessão (recarregar leva à tela de entrada, e ela fica órfã no servidor): ' + JSON.stringify(A.log));
  assert.equal(A.v.dados.get(TOKEN), 'TOK-A');
  assert.deepEqual(JSON.parse(A.v.dados.get(CONTA_KEY)), { id: '111', s: marcaDe('TOK-A') },
    'a marca da conta não acompanhou a sessão guardada (a régua do `aoConhecerConta`)');
  // O diário do aparelho ganha o início dela (a sessão já estava ativa: `jaAtiva`),
  // DEPOIS da linha que a que caiu gravou logo após a saída do token.
  assert.deepEqual(JSON.parse(A.v.dados.get(SESSOES_KEY)).map((e) => e.e), ['token+', 'caiu', 'token-', 'jaAtiva']);
  assert.ok(A.log.includes('dfato:sessao.guardadaDeVolta'));
  assert.ok(!A.log.some((x) => Array.isArray(x)), 'a aba viva saiu (ou foi tratada como troca de conta): ' + JSON.stringify(A.log));
  // E a aba que caiu vê a sessão guardada: a volta a ela a adota (as regras de hoje).
  ap.entregar();
  assert.equal(B.dados.get(TOKEN), 'TOK-A');
});

test('R14-1-03: a mesma queda com a saída do token chegando ANTES do aviso do canal — quem chega por último decide', () => {
  const ap = aparelhoDeAbas(COM_B);
  const rede = canais();
  const A = abaViva(ap, rede);
  quedaEmB(ap.aba('B'), new rede.BroadcastChannel(CANAL_DA_SESSAO));
  ap.entregar();
  assert.equal(A.v.dados.get(TOKEN), undefined, 'PRÉ-CONDIÇÃO: a saída do token não chegou');
  assert.ok(!A.agendou(), 'agendou a guarda só pelo aviso do token — sem saber se foi a queda ou o "Sair"');
  rede.entregar();
  A.passarTempo();
  assert.ok(A.guardou(), 'DEFEITO: com o aviso da queda chegando depois, a aba viva não guardou a sua sessão');
  assert.equal(A.v.dados.get(TOKEN), 'TOK-A');
});

test('R14-1-03: o "SAIR" dado na outra aba — o aviso do token chega com a conta AINDA no aparelho, e esta NÃO guarda nada: sai junto, e o aparelho fica limpo', () => {
  const ap = aparelhoDeAbas(COM_B);
  const rede = canais();
  const A = abaViva(ap, rede);
  const B = ap.aba('B');
  // O `handleLogout` de B: o token sai primeiro, a conta depois (e nenhum aviso de queda).
  B.localStorage.removeItem(TOKEN);
  B.localStorage.removeItem('waze_places_history');
  B.localStorage.removeItem(CONTA_KEY);
  ap.entregar(1);                                    // só o aviso do TOKEN
  assert.ok(A.v.dados.has(CONTA_KEY),
    'PRÉ-CONDIÇÃO (a ordem MEDIDA no navegador): no aviso do token, a conta ainda está no aparelho desta aba');
  assert.ok(!A.agendou(), 'DEFEITO: a aba viva agendou a guarda da sua sessão no MEIO do "Sair" da outra — o "Sair" ficaria desfeito');
  rede.entregar();
  ap.entregar();
  A.passarTempo();
  assert.deepEqual(A.log.filter((x) => Array.isArray(x)), [['sair', { porOutraAba: true }]], 'o "Sair" de lá não chegou a esta aba');
  assert.ok(!A.guardou());
  assert.equal(B.dados.get(TOKEN), undefined, 'o aparelho ficou com uma sessão depois do "Sair"');
});

test('R14-1-03: OUTRA conta entra noutra aba logo depois da queda (os avisos chegam juntos) — a guarda, conferida de novo, não cai por cima dela', () => {
  const ap = aparelhoDeAbas(COM_B);
  const rede = canais();
  const A = abaViva(ap, rede);
  const B = ap.aba('B');
  quedaEmB(B, new rede.BroadcastChannel(CANAL_DA_SESSAO));
  rede.entregar();
  B.localStorage.setItem(TOKEN, 'TOK-C');
  B.localStorage.setItem(CONTA_KEY, JSON.stringify({ id: '222', s: marcaDe('TOK-C') }));
  ap.entregar(2);                                    // o diário e a saída do token: a outra conta ainda a caminho
  assert.ok(A.agendou(), 'PRÉ-CONDIÇÃO: a guarda nem foi agendada (o caso que a conferência de depois existe pra pegar)');
  ap.entregar();                                     // a outra conta chega: esta aba sai pela troca de sempre
  A.passarTempo();
  assert.ok(!A.guardou(),
    'DEFEITO: a sessão desta aba foi guardada POR CIMA da outra conta que acabou de entrar — e a outra é que sairia: ' + JSON.stringify(A.log));
  assert.deepEqual(A.log.filter((x) => Array.isArray(x)), [['sair', { porOutraAba: true, outraConta: true }]]);
});

test('R14-1-03: CONTROLES — outra sessão já guardada (antes ou durante a espera), a conta de outro, a mesma sessão, o aviso velho e um login desta aba no ar: nada é guardado', () => {
  // A renovação de lá (ou outro login da mesma conta) guardou OUTRA sessão antes de o aviso chegar.
  {
    const ap = aparelhoDeAbas(COM_B);
    const rede = canais();
    const A = abaViva(ap, rede);
    const B = ap.aba('B');
    quedaEmB(B, new rede.BroadcastChannel(CANAL_DA_SESSAO));
    B.localStorage.setItem(TOKEN, 'TOK-B2');
    ap.entregar();
    rede.entregar();
    A.passarTempo();
    assert.ok(!A.guardou(), 'guardou por cima da sessão que a renovação de lá acabou de guardar');
    assert.equal(A.deps.quedaDeOutraAba, null, 'o aviso ficou pendurado depois de outra sessão ser guardada');
  }
  // ... ou DURANTE a espera.
  {
    const ap = aparelhoDeAbas(COM_B);
    const rede = canais();
    const A = abaViva(ap, rede);
    const B = ap.aba('B');
    quedaEmB(B, new rede.BroadcastChannel(CANAL_DA_SESSAO));
    ap.entregar();
    rede.entregar();
    assert.ok(A.agendou(), 'PRÉ-CONDIÇÃO: a guarda não foi agendada');
    B.localStorage.setItem(TOKEN, 'TOK-B2');
    ap.entregar();
    A.passarTempo();
    assert.ok(!A.guardou(), 'a guarda agendada caiu por cima da sessão que a renovação guardou durante a espera');
  }
  for (const [caso, o, aparelhoInicial] of [
    ['o aparelho é de OUTRA conta', {}, { [TOKEN]: 'TOK-B', [CONTA_KEY]: { id: '222', s: marcaDe('TOK-B') } }],
    ['a sessão que caiu é a desta aba', { token: 'TOK-B' }, COM_B],
    ['um login desta aba (os cookies) no ar', { noAr: 'cookies' }, COM_B],
    ['um código sendo resgatado nesta aba', { noAr: 'codigo' }, COM_B],
    ['uma pergunta à extensão no ar nesta aba', { noAr: 'pergunta' }, COM_B],
    ['a conta desta aba em dúvida (R6-1-04)', { emDuvida: true }, COM_B],
    ['sem perfil e sem conta confirmada nesta aba', { perfil: null }, COM_B],
    ['a conta confirmada com OUTRA sessão', { perfil: null, confirmada: { id: '111', s: marcaDe('TOK-X') } }, COM_B],
  ]) {
    const ap = aparelhoDeAbas(aparelhoInicial);
    const rede = canais();
    const A = abaViva(ap, rede, o);
    quedaEmB(ap.aba('B'), new rede.BroadcastChannel(CANAL_DA_SESSAO));
    ap.entregar();
    rede.entregar();
    A.passarTempo();
    assert.ok(!A.log.some((x) => typeof x === 'string' && x.startsWith('setSession')),
      `(${caso}) a aba guardou uma sessão no aparelho: ` + JSON.stringify(A.log));
  }
  // O login desta aba que COMEÇA durante a espera: a conferência de depois o vê.
  {
    const ap = aparelhoDeAbas(COM_B);
    const rede = canais();
    const A = abaViva(ap, rede);
    quedaEmB(ap.aba('B'), new rede.BroadcastChannel(CANAL_DA_SESSAO));
    ap.entregar();
    rede.entregar();
    A.deps.authInFlight = true;
    A.passarTempo();
    assert.ok(!A.guardou(), 'a guarda agendada não conferiu de novo o login desta aba no ar');
  }
  // O aviso VELHO (de uma aba que ficou parada): não vale.
  const ap = aparelhoDeAbas(COM_B);
  const rede = canais();
  const A = abaViva(ap, rede);
  quedaEmB(ap.aba('B'), new rede.BroadcastChannel(CANAL_DA_SESSAO), { em: Date.now() - QUEDA_DE_OUTRA_ABA_VALE_MS - 1000 });
  ap.entregar();
  rede.entregar();
  A.passarTempo();
  assert.ok(!A.guardou(), 'o aviso velho de queda valeu');
  // CONTROLE: sem perfil, a conta confirmada COM a sessão desta aba basta.
  const c = aparelhoDeAbas(COM_B);
  const rc = canais();
  const C = abaViva(c, rc, { perfil: null, confirmada: { id: '111', s: marcaDe('TOK-A') } });
  quedaEmB(c.aba('B'), new rc.BroadcastChannel(CANAL_DA_SESSAO));
  c.entregar();
  rc.entregar();
  C.passarTempo();
  assert.ok(C.guardou(), 'CONTROLE: a conta confirmada com a sessão desta aba não bastou');
});

// O lado da aba que CAI: o `derrubarSessao` de verdade avisa as outras abas — só
// na queda da sessão GUARDADA, e nunca na recusa do portão (o `depois`, terminal).
function abaQueCai({ guardada = true, depois = null } = {}) {
  const rede = canais();
  const ouvinte = new rede.BroadcastChannel(CANAL_DA_SESSAO);
  const recebidos = [];
  ouvinte.onmessage = (ev) => recebidos.push(ev.data);
  const ap = aparelho({ [TOKEN]: guardada ? 'TOK-B' : 'TOK-OUTRA' });
  const API = {
    sessionToken: 'TOK-B',
    setSession(t) { this.sessionToken = t; if (t) ap.safeLS.set(TOKEN, t); else ap.safeLS.remove(TOKEN); },
    soltarSessao() { this.sessionToken = null; },
  };
  const deps = {
    safeLS: ap.safeLS, API, BroadcastChannel: rede.BroadcastChannel, CANAL_DA_SESSAO, canalDaSessao: null,
    AppState: { authenticated: true, profile: { id: 111 }, pendingAction: null, fetchEpoch: 1 },
    epocaDaSessao: 0, quedaAnunciada: false, Treino: { ativo: false },
    entrarPelaExtensao: () => new Promise(() => {}),   // a renovação, no ar
    fecharCamadasAbertas: (f) => { if (typeof f === 'function') f(); },
  };
  const h = montar(['derrubarSessao', 'sessaoDestaAbaEhAGuardada', 'abrirCanalDaSessao', 'avisarOutrasAbasDaQueda', 'marcaDaSessao'], deps);
  h.abrirCanalDaSessao();
  h.derrubarSessao('srv.err.sessionExpired', depois ? { depois } : undefined);
  rede.entregar();
  return { recebidos, ap };
}

test('R14-1-03: o `derrubarSessao` avisa as outras abas da QUEDA da sessão guardada — com a marca dela, nunca o token', () => {
  const q = abaQueCai();
  assert.equal(q.recebidos.length, 1, 'DEFEITO: a queda da sessão guardada não avisou as outras abas — a viva nunca volta a guardar a dela');
  assert.equal(q.recebidos[0].caiu, marcaDe('TOK-B'));
  assert.ok(!JSON.stringify(q.recebidos).includes('TOK-B'), 'o aviso levou o TOKEN (credencial) pro canal');
  assert.ok(Math.abs(q.recebidos[0].em - Date.now()) < 5000);
  assert.equal(q.ap.dados.get(TOKEN), undefined, 'PRÉ-CONDIÇÃO: a queda não tirou o token do aparelho');
});

test('R14-1-03: CONTROLES — a recusa do PORTÃO (terminal) e a queda de uma sessão que não é a guardada não avisam', () => {
  const recusa = abaQueCai({ depois: () => {} });
  assert.deepEqual(recusa.recebidos, [], 'a recusa do portão avisou as outras abas — a viva guardaria a sessão de uma conta recusada');
  const soNestaAba = abaQueCai({ guardada: false });
  assert.deepEqual(soNestaAba.recebidos, [], 'a queda de uma sessão que não é a do aparelho avisou (o aparelho segue com a da outra aba)');
});


// ═══ a pista s18 · o "Sair" de outra aba com a pergunta à extensão NO AR ══════
// A aba que CAIU na tela de entrada (a fila, o card e a conta 111 na memória), com
// a pergunta da VOLTA à extensão no ar e os cookies sendo colados; noutra aba a
// MESMA conta entra e dá "Sair". O `handleLogout` DE VERDADE (a mesma lista do
// "Sair"), com o fechamento das camadas e o aviso espionados: o fechamento de
// mentira fecha os diálogos abertos com a limpeza deles, como o de verdade.
function sairComPerguntaNoAr({ nuncaEntrou = false } = {}) {
  const t = telaDeEntrada({});
  const log = [];
  const real = apiDeVerdade(nuncaEntrou ? {} : { [CONTA_KEY]: JSON.stringify({ id: '111', s: marcaDe('TOK-A') }) });
  real.API._post = async (rota, corpo) => { log.push('rota ' + rota + (corpo && corpo.action ? ' ' + corpo.action : '') + (corpo && corpo.sessionToken ? ' ' + corpo.sessionToken : '')); return { success: true }; };
  const ext = janelaComExtensao(log);
  const AppState = { authenticated: false, profile: null, queue: nuncaEntrou ? [] : [{ venueID: 'p1' }],
    currentPlace: nuncaEntrou ? null : { venueID: 'p1' } };
  const deps = {
    window: ext.window, document: t.document, API: real.API, safeLS: real.safeLS, AppState, CONTA_KEY,
    MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000,
    resgateEmVoo: false, authInFlight: false, extPerguntando: false, extRenovando: false,
    extNegadoNestaPagina: false, extNegado: null, saiuNestaPagina: false, filaAtravessouSessao: false, focoDoTeclado: null,
    epocaDaSessao: 0, setTimeout: () => 1, clearTimeout: () => {}, callWithRetry: (fn) => fn(),
    podeInstalarExtensao: () => true,
    contaConfirmadaNestaAba: nuncaEntrou ? null : { id: '111', s: marcaDe('TOK-A') },
    tokenTiradoPorOutraAba: null, pareamentosEmitidos: new Set(),
    closeModal: (id) => { log.push('fechou ' + id); t.fechar(id); },
    fecharCamadasAbertas: () => {
      log.push('fechou as camadas');
      for (const id of ['pasteModal', 'pairEnterModal']) if (!t.els[id].classList.contains('hidden')) t.fechar(id);
    },
    showToast: (m) => log.push('aviso ' + m), t: (k) => k,
    showMainScreen: () => { log.push('app com ' + real.API.sessionToken); AppState.authenticated = true; t.mostrarOApp(); },
    showAuthScreen: () => log.push('tela de entrada'),
    resetQueue: () => {}, loadProfileAndAuxData: () => null, conhecerContaDoLogin: () => {}, startFetching: () => {},
    esvaziarFilaDeSaida: () => {}, mostrarEntrandoPelaExtensao: () => {}, abrirComSessaoSalva: () => log.push('adotou'),
    showAccessDenied: () => log.push('acesso restrito'), conferirContaDestaAba: () => log.push('conferiu a conta'),
    relerPlacarDeOutraAba: () => {}, relerPreferenciasDeOutraAba: () => {}, updateInFlightIndicator: () => {},
    guardarDeVoltaASessaoDestaAba: () => false,
  };
  const h = montar(['aoVoltarAAba', 'perguntarAExtensaoAoVoltar', 'entrarPelaExtensao', 'adotarSessaoDoAparelho',
    'textoDigitadoNaEntrada', 'focoNaTelaDeEntrada', 'fecharModaisDaEntrada', 'aoEntrarNestaPagina',
    'tirarNegadoDaExtensao', 'mostrarNegadoDaExtensao', 'negadoDaExtensao', 'aoFimDaPerguntaDaAbertura',
    'seOutraContaTomouOAparelhoDaQueCaiu', 'outraContaTomouOAparelhoDaQueCaiu', 'contaSegueNoAparelho',
    'sessaoDestaAbaEhAGuardada', 'sincronizarComOutraAba', 'aoSairEmOutraAba', 'aoEntrarOutraContaEmOutraAba',
    'guardaASessaoQueCaiu', 'contaDestaAbaEmDuvida', 'marcaDaSessao', 'handleLogout'], deps);
  // A MESMA conta entra noutra aba (o token e a conta dela) e dá "Sair": o token
  // sai, depois a conta — a ordem do `handleLogout` de lá, um aviso por chave.
  const outraAbaEntraESai = () => {
    real.dados.set(TOKEN, 'TOK-C');
    h.sincronizarComOutraAba(TOKEN);
    real.dados.set(CONTA_KEY, JSON.stringify({ id: '111', s: marcaDe('TOK-C') }));
    h.sincronizarComOutraAba(CONTA_KEY);
    real.dados.delete(TOKEN);
    h.sincronizarComOutraAba(TOKEN);
    real.dados.delete(CONTA_KEY);
    h.sincronizarComOutraAba(CONTA_KEY);
  };
  return { h, deps, log, real, tela: t, responder: ext.responder, outraAbaEntraESai };
}

test('pista s18: o "Sair" de outra aba com a pergunta da VOLTA no ar e o cookies.txt colado — o "Colar" fica com o texto, sem aviso, e a resposta da extensão não entra por cima', async () => {
  const m = sairComPerguntaNoAr();
  m.h.aoVoltarAAba();
  assert.ok(m.log.includes('perguntou à extensão'), 'PRÉ-CONDIÇÃO: a volta não perguntou à extensão');
  m.tela.digitar('pasteModal', 'cookiesTextarea', TEXTO_COLADO);
  m.outraAbaEntraESai();
  await tiques();
  assert.ok(!m.log.includes('fechou as camadas') && !m.log.includes('aviso toast.saiuNoutraAba'),
    'DEFEITO: o "Sair" de outra aba foi pelo caminho CHEIO numa aba na tela de entrada — fechou o que a pessoa abriu e avisou "Você saiu em outra aba": ' + JSON.stringify(m.log));
  assert.equal(m.tela.els.cookiesTextarea.value, TEXTO_COLADO, 'o que estava colado foi apagado');
  assert.ok(!m.tela.els.pasteModal.classList.contains('hidden'), 'o "Colar cookies" fechou');
  assert.equal(m.deps.epocaDaSessao, 1, 'a saída não subiu a época — a pergunta no ar seguiria valendo');
  assert.equal(m.deps.contaConfirmadaNestaAba, null, 'a memória da sessão que caiu ficou (R12-1-04)');
  // A pergunta que estava no ar responde DEPOIS do "Sair" de lá, com uma sessão: ela
  // não entra por cima dele (o K3/R12-1-02), e sai do servidor.
  m.responder({ action: 'aguarde' });
  m.responder({ action: 'sessao', token: 'TOK-EXT', conta: '111' });
  await tiques();
  assert.ok(!m.log.some((x) => typeof x === 'string' && x.startsWith('app com ')),
    'a resposta da extensão entrou por cima do "Sair" da outra aba: ' + JSON.stringify(m.log));
  assert.ok(m.log.includes('rota sessao destroy TOK-EXT'), 'a sessão que a extensão criou ficou órfã no servidor');
  assert.equal(m.tela.els.cookiesTextarea.value, TEXTO_COLADO);
});

test('pista s18: a aba que NUNCA entrou, com a pergunta da ABERTURA no ar — o "Sair" de outra aba cancela a pergunta sem avisar nem fechar nada', async () => {
  // NADA digitado de propósito: com texto no "Colar", a régua do R13-1-05 barraria a
  // resposta sozinha, e a medida não veria se a pergunta foi mesmo cancelada.
  const m = sairComPerguntaNoAr({ nuncaEntrou: true });
  m.h.entrarPelaExtensao().then(m.h.aoFimDaPerguntaDaAbertura);
  m.outraAbaEntraESai();
  await tiques();
  assert.ok(!m.log.includes('fechou as camadas') && !m.log.includes('aviso toast.saiuNoutraAba'),
    'DEFEITO: "Você saiu em outra aba" numa aba que nem estava logada (ou as camadas fecharam): ' + JSON.stringify(m.log));
  m.responder({ action: 'aguarde' });
  m.responder({ action: 'sessao', token: 'TOK-EXT', conta: '111' });
  await tiques();
  assert.ok(!m.log.some((x) => typeof x === 'string' && x.startsWith('app com ')),
    'DEFEITO: a resposta da extensão entrou por cima do "Sair" da outra aba (a pergunta no ar não foi cancelada): ' + JSON.stringify(m.log));
  assert.ok(m.log.includes('rota sessao destroy TOK-EXT'), 'a sessão que a extensão criou ficou órfã no servidor');
});

test('pista s18: CONTROLE da medida — sem o "Sair" no meio, a mesma resposta da extensão ENTRA (a pergunta da abertura de sempre)', async () => {
  const m = sairComPerguntaNoAr({ nuncaEntrou: true });
  const p = m.h.entrarPelaExtensao().then(m.h.aoFimDaPerguntaDaAbertura);
  m.responder({ action: 'aguarde' });
  m.responder({ action: 'sessao', token: 'TOK-EXT', conta: '111' });
  await p;
  assert.ok(m.log.includes('app com TOK-EXT'), 'CONTROLE: a pergunta da abertura deixou de entrar pela extensão — a medida acima não prova nada: ' + JSON.stringify(m.log));
});

test('pista s18: CONTROLES — sem pergunta no ar, a aba que caiu sai pelo mesmo caminho (R12-1-04); a que nunca entrou não sai; e a RENOVAÇÃO no ar (o app na tela) segue pelo caminho cheio', async () => {
  // A aba que caiu, SEM pergunta no ar: o R12-1-04 de sempre — a medida enxerga o caminho bom.
  const c = sairComPerguntaNoAr();
  c.tela.digitar('pasteModal', 'cookiesTextarea', TEXTO_COLADO);
  c.outraAbaEntraESai();
  await tiques();
  assert.ok(!c.log.includes('fechou as camadas') && !c.log.includes('aviso toast.saiuNoutraAba'), JSON.stringify(c.log));
  assert.equal(c.tela.els.cookiesTextarea.value, TEXTO_COLADO);
  assert.equal(c.deps.epocaDaSessao, 1, 'CONTROLE: a aba que caiu deixou de ser alcançada pelo "Sair" de outra aba');
  // A que nunca entrou, sem pergunta no ar: não tem o que encerrar (R9-1-03).
  const n = sairComPerguntaNoAr({ nuncaEntrou: true });
  n.outraAbaEntraESai();
  await tiques();
  assert.equal(n.deps.epocaDaSessao, 0, 'a aba que só mostrava a tela de entrada ganhou um "Sair" que não era dela');
  // A RENOVAÇÃO da queda pergunta com o app AINDA na tela: aba com sessão a encerrar, o caminho cheio.
  const r = sairComPerguntaNoAr();
  r.tela.mostrarOApp();
  r.deps.extPerguntando = true;
  r.outraAbaEntraESai();
  await tiques();
  assert.ok(r.log.includes('fechou as camadas') && r.log.includes('aviso toast.saiuNoutraAba'),
    'a aba com o app na tela (a renovação no ar) deixou de sair pelo caminho cheio: ' + JSON.stringify(r.log));
});


// ═══ o resto do s15b · a aba que caiu ANTES do perfil e o "Sair" de outra aba ══
// A sessão salva morre entre a busca da abertura e o perfil: a aba cai na tela de
// entrada sem conta confirmada, sem fila e sem card — nada do que o
// `guardaASessaoQueCaiu` procura. A marca `sessaoCaiuNestaPagina` diz que ela é "a aba
// que CAIU" assim mesmo.
function quedaAntesDoPerfil() {
  const ap = aparelho({ [TOKEN]: 'TOK-A' });
  const deps = {
    safeLS: ap.safeLS, AppState: { authenticated: true, profile: null, pendingAction: null, fetchEpoch: 1, queue: [] },
    API: {
      sessionToken: 'TOK-A',
      setSession(t) { this.sessionToken = t; if (t) ap.safeLS.set(TOKEN, t); else ap.safeLS.remove(TOKEN); },
      soltarSessao() { this.sessionToken = null; },
    },
    epocaDaSessao: 0, quedaAnunciada: false, Treino: { ativo: false }, sessaoCaiuNestaPagina: false,
    entrarPelaExtensao: () => new Promise(() => {}),   // a renovação, no ar
    avisarOutrasAbasDaQueda: () => {},
  };
  const h = montar(['derrubarSessao', 'sessaoDestaAbaEhAGuardada', 'aoEntrarNestaPagina'], deps);
  return { h, deps };
}

test('s15b: a QUEDA marca a aba como a que caiu (`sessaoCaiuNestaPagina`), e todo login que dá certo nela tira a marca', () => {
  const m = quedaAntesDoPerfil();
  m.h.derrubarSessao('srv.err.sessionExpired');
  assert.equal(m.deps.sessaoCaiuNestaPagina, true,
    'DEFEITO: a queda não marcou a aba — sem perfil, fila nem card, nada mais diz que ela é a aba que caiu');
  m.h.aoEntrarNestaPagina();
  assert.equal(m.deps.sessaoCaiuNestaPagina, false, 'entrar de novo nesta aba não tirou a marca da queda');
});

test('s15b: a aba que caiu ANTES do perfil é alcançada pelo "Sair" de outra aba — sem fechar o que está aberto nem avisar — e a volta a ela NÃO pergunta à extensão', async () => {
  // A tela de entrada da aba que caiu antes do perfil: nada na memória, só a marca.
  const m = sairComPerguntaNoAr({ nuncaEntrou: true });
  m.deps.sessaoCaiuNestaPagina = true;
  m.tela.digitar('pasteModal', 'cookiesTextarea', TEXTO_COLADO);
  // Quem grava no aparelho a partir DESTA aba passa pelo `safeLS` (o do app e o do
  // api.js de verdade, que é o mesmo objeto); a outra aba escreve direto no aparelho.
  const escritas = [];
  for (const metodo of ['set', 'remove']) {
    const original = m.real.safeLS[metodo];
    m.real.safeLS[metodo] = (...args) => { escritas.push(metodo + ' ' + String(args[0])); return original(...args); };
  }
  m.outraAbaEntraESai();
  await tiques();
  assert.equal(m.deps.epocaDaSessao, 1,
    'DEFEITO: o "Sair" de outra aba não alcançou a aba que caiu antes do perfil (R12-1-04): ' + JSON.stringify(m.log));
  assert.equal(m.deps.saiuNestaPagina, true);
  assert.equal(m.deps.sessaoCaiuNestaPagina, false, 'a marca da queda ficou depois do "Sair"');
  assert.ok(m.log.includes('tela de entrada'), 'a tela de entrada não foi redesenhada (memória e TELA, R12-1-04)');
  assert.deepEqual(escritas, [], 'a aba alcançada gravou no aparelho, que é da aba do "Sair" (R12-1-04)');
  assert.ok(!m.log.includes('fechou as camadas') && !m.log.includes('aviso toast.saiuNoutraAba'),
    'o "Sair" de outra aba fechou o que a pessoa abriu na entrada, ou avisou: ' + JSON.stringify(m.log));
  assert.equal(m.tela.els.cookiesTextarea.value, TEXTO_COLADO);
  // A volta à aba (com a extensão logada no WME): ela não é perguntada — a aba não ENTRA
  // de novo sozinha depois de a pessoa ter pedido "Sair".
  m.tela.fechar('pasteModal');
  m.h.aoVoltarAAba();
  assert.ok(!m.log.includes('perguntou à extensão'),
    'DEFEITO: depois do "Sair", a volta à aba que caiu perguntou à extensão (e entraria de novo): ' + JSON.stringify(m.log));
  assert.deepEqual(escritas, [], 'a volta à aba gravou no aparelho depois do "Sair"');
});

test('s15b: CONTROLE — a aba que NUNCA entrou não é alcançada (R9-1-03): a volta a ela pergunta à extensão e entra, como sempre', async () => {
  const m = sairComPerguntaNoAr({ nuncaEntrou: true });
  m.outraAbaEntraESai();
  await tiques();
  assert.equal(m.deps.epocaDaSessao, 0, 'a aba que nunca entrou ganhou um "Sair" que não era dela');
  assert.equal(m.deps.saiuNestaPagina, false);
  m.h.aoVoltarAAba();
  assert.ok(m.log.includes('perguntou à extensão'), 'CONTROLE: a volta à aba que nunca entrou deixou de perguntar à extensão');
  m.responder({ action: 'sessao', token: 'TOK-EXT', conta: '111' });
  await tiques();
  assert.ok(m.log.includes('app com TOK-EXT'), 'CONTROLE: a extensão deixou de entrar na aba que nunca entrou: ' + JSON.stringify(m.log));
});
