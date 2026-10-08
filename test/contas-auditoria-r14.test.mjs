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
//    pelo canal da sessão.
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
