// A conta, as abas e o login DESTA aba (auditoria da rodada 13, R13-1 — o lote
// 17 da área "contas"):
//
//  · R13-1-03 — o link de pareamento que FALHA com os cookies colados e
//    confirmados durante o resgate (que esperaram o desfecho dele, R12-1-01) e
//    seguiam: o fim do link perguntava à extensão ao mesmo tempo, e a pergunta da
//    abertura (não silenciosa) não tinha a régua do login desta aba no ar — dois
//    logins na mesma aba, uma sessão órfã no servidor e o texto colado apagado;
//  · R13-1-04 — as rotas do `api.js` liam a sessão pelo `getSession`, que com a
//    memória vazia ADOTA a sessão que outra aba guardou: na renovação da queda,
//    abrir os Filtros (a lista de estados) adotava calado a sessão da outra aba;
//  · R13-1-05 — o texto colado DURANTE a pergunta silenciosa da volta à aba era
//    apagado pela resposta da extensão (a sessão, ou o "Acesso restrito" por cima);
//  · R13-1-06 — OUTRA CONTA entrando noutra aba não alcançava a aba que CAIU na
//    tela de entrada (o irmão do R12-1-04): a fila, o card e o anel da conta
//    anterior ficavam nela.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js (e o `api.js` inteiro,
// num contexto do `vm`, onde o efeito do `getSession` mora): o que o teste não
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
const API_SEM = semComentario(ler('js/api.js'));
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

// O armazenamento de UMA aba, espionado: "não grava nada" se mede contando escritas.
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

// O `api.js` DE VERDADE: é nele que mora o efeito do `getSession` (com a memória
// vazia, ele LÊ o aparelho e GRAVA na memória o que leu — adota). E o `_post` de
// verdade, com um `fetch` que anota a rota e o token de cada pedido — e responde
// DEPOIS de o relógio andar (dublê de rede nunca responde no mesmo milissegundo).
function apiDeVerdade(guardado = {}) {
  const dados = new Map(Object.entries(guardado));
  const pedidos = [];
  const ctx = {
    navigator: { language: 'pt', onLine: true },
    document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: {
      getItem: (k) => (dados.has(k) ? dados.get(k) : null),
      setItem: (k, v) => { dados.set(k, String(v)); },
      removeItem: (k) => { dados.delete(k); },
    },
    fetch: async (url, init) => {
      const corpo = JSON.parse(init.body);
      pedidos.push({ rota: String(url).split('/api/')[1], token: corpo.sessionToken || null });
      await new Promise((ok) => setTimeout(ok, 25));
      return new Response(JSON.stringify({ success: true, states: [], countries: [], places: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    },
    performance, AbortController, Response, console, setTimeout, clearTimeout,
  };
  ctx.window = {};
  vm.createContext(ctx);
  vm.runInContext(I18N + '\n' + ler('js/api.js') + '\nthis.API = API; this.safeLS = safeLS;', ctx);
  return { API: ctx.API, safeLS: ctx.safeLS, dados, pedidos };
}

// A TELA DE ENTRADA de mentira: a tela (com o "Colar cookies"), os diálogos dela
// (com o campo de cada um) e o FOCO. `digitar` abre um diálogo e escreve nele —
// a pessoa colando os cookies NO MEIO de uma pergunta.
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
    // O `closeModal` de verdade: esconde e roda a limpeza do campo.
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

const TOKEN = 'waze_session_token';
const CONTA_KEY = constante('CONTA_KEY');
const STATS_KEY = constante('STATS_KEY');
const PREFERENCES_KEY = constante('PREFERENCES_KEY');
const MODAIS_DA_ENTRADA = constante('MODAIS_DA_ENTRADA');
const BOTAO_DA_ACAO = constante('BOTAO_DA_ACAO');
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();
const tique = () => new Promise((ok) => setImmediate(ok));
const TEXTO_COLADO = '# Netscape HTTP Cookie File\n.waze.com\tTRUE\t/\tTRUE\t0\t_web_session\tconta=333';
const COLANDO = { dialogo: 'pasteModal', texto: TEXTO_COLADO, foco: 'cookiesTextarea' };

// ═══ R13-1-03 · o link de pareamento que FALHA com um login desta aba no ar ═══
// O link `/#pair=`, os cookies colados e a extensão, os TRÊS de verdade — o
// resgate, o login por cookies, a pergunta à extensão e o fim da pergunta da
// abertura —, contra o `api.js` de verdade com o servidor de mentira segurando
// cada resposta até o teste soltar.
function linkCookiesEExtensao({ tela = {} } = {}) {
  const t = telaDeEntrada(tela);
  const log = [];
  const real = apiDeVerdade({});
  const soltar = {};
  // O servidor de mentira: cada rota fica no ar até o teste soltar.
  real.API._post = (rota) => new Promise((ok) => { log.push('rota ' + rota); soltar[rota] = ok; });
  const ext = janelaComExtensao(log);
  const AppState = { authenticated: false, profile: null };
  const deps = {
    window: ext.window, document: t.document, API: real.API, safeLS: real.safeLS, AppState,
    MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000,
    resgateEmVoo: false, resgateNoAr: null, authInFlight: false, extPerguntando: false, extRenovando: false,
    extNegadoNestaPagina: false, extNegado: null, saiuNestaPagina: false, filaAtravessouSessao: false, focoDoTeclado: null,
    epocaDaSessao: 0, setTimeout: () => 1, clearTimeout: () => {}, callWithRetry: (fn) => fn(),
    closeModal: (id) => { log.push('fechou ' + id); t.fechar(id); },
    showAuthScreen: () => log.push('tela de entrada'),
    showMainScreen: () => { log.push('app com ' + real.API.sessionToken); AppState.authenticated = true; t.mostrarOApp(); },
    showToast: (m) => { log.push('aviso ' + m); return { dispensar() {} }; }, t: (k) => k, msgDoServidor: (r, d) => d,
    setAuthLoading: () => {}, guardarPrazoDaSessao: () => {}, resetQueue: () => {}, conhecerContaDoLogin: () => {},
    loadProfileAndAuxData: () => null, startFetching: () => {}, esvaziarFilaDeSaida: () => {},
    mostrarEntrandoPelaExtensao: () => {}, showAccessDenied: () => log.push('acesso restrito'),
    abrirComSessaoSalva: () => log.push('abriu com ' + real.API.sessionToken),
  };
  // O apagar no servidor passa pelo `destroySession` de verdade, que chama o `_post`.
  const h = montar(['abrirPeloCodigoDaURL', 'resgatarPareamento', 'authenticateWithCookies', 'entrarPelaExtensao',
    'aoFimDaPerguntaDaAbertura', 'adotarSessaoDoAparelho', 'textoDigitadoNaEntrada', 'focoNaTelaDeEntrada',
    'fecharModaisDaEntrada', 'aoEntrarNestaPagina', 'tirarNegadoDaExtensao', 'mostrarNegadoDaExtensao', 'negadoDaExtensao'], deps);
  const entraram = () => log.filter((x) => x.startsWith('app com ')).map((x) => x.slice('app com '.length));
  return { h, deps, log, real, soltar, tela: t, responder: ext.responder, entraram };
}
const RECUSADO = { success: false, errorKey: 'srv.err.pairCodeInvalid' };

// A espera aqui é por TIQUES, nunca pela promessa do link: com o defeito, ela
// adota a da pergunta à extensão, que só termina quando a extensão responde — o
// teste ficaria pendurado em vez de reprovar (gotcha #19).
const tiques = async (n = 3) => { for (let i = 0; i < n; i++) await tique(); };

test('R13-1-03: o link que FALHA com os cookies confirmados no ar NÃO pergunta à extensão — o login que a pessoa pediu é o único', async () => {
  // (C) a extensão responderia ANTES dos cookies; (C2) DEPOIS deles.
  for (const extensaoAntes of [true, false]) {
    const m = linkCookiesEExtensao();
    m.h.abrirPeloCodigoDaURL('CODIGOVENCIDO0000000');                 // o resgate no ar
    const colar = m.h.authenticateWithCookies(TEXTO_COLADO);          // colou e confirmou: espera o resgate (R12-1-01)
    await tiques();
    m.soltar.parear(RECUSADO);                                        // o código venceu
    await tiques();
    const perguntou = m.log.includes('perguntou à extensão');
    // A extensão logada no WME com OUTRA conta (se tiver sido perguntada).
    const extensao = () => { m.responder({ action: 'aguarde' }); m.responder({ action: 'sessao', token: 'tok-e', conta: '222' }); };
    if (extensaoAntes) extensao();
    assert.ok(m.soltar['testar-cookies'], 'PRÉ-CONDIÇÃO: os cookies não seguiram depois de o código ser recusado (R12-1-01)');
    m.soltar['testar-cookies']({ success: true, sessionToken: 'tok-c', conta: '333' });
    await colar;
    await tiques();
    if (!extensaoAntes) extensao();
    await tiques();
    assert.ok(!perguntou,
      `DEFEITO (extensão ${extensaoAntes ? 'antes' : 'depois'} dos cookies): o link recusado perguntou à extensão com os cookies colados no ar — dois logins na mesma aba: ` + JSON.stringify(m.log));
    assert.deepEqual(m.entraram(), ['tok-c'],
      'DEFEITO: entrou mais de uma sessão nesta aba (a do "Sair" apaga uma, a outra fica órfã no servidor por até 21 dias): ' + JSON.stringify(m.log));
    assert.equal(m.real.API.sessionToken, 'tok-c', 'a sessão desta aba não é a dos cookies que a pessoa colou');
  }
});

test('R13-1-03: o link que FALHA com o cookies.txt colado e NÃO confirmado não pergunta à extensão — o texto fica', async () => {
  const m = linkCookiesEExtensao({ tela: COLANDO });
  m.h.abrirPeloCodigoDaURL('CODIGOVENCIDO0000000');
  await tiques();
  m.soltar.parear(RECUSADO);
  await tiques();
  assert.ok(!m.log.includes('perguntou à extensão'),
    'DEFEITO: o link recusado perguntou à extensão com o "Colar cookies" preenchido — a resposta fecharia o diálogo, e o que estava colado ia embora: ' + JSON.stringify(m.log));
  assert.equal(m.tela.els.cookiesTextarea.value, TEXTO_COLADO);
  assert.ok(!m.tela.els.pasteModal.classList.contains('hidden'), 'o "Colar cookies" fechou');
});

test('R13-1-03: CONTROLE — o link que falha sem nada colado nem login no ar pergunta à extensão, como a abertura (R10-1-04)', async () => {
  const m = linkCookiesEExtensao();
  const link = m.h.abrirPeloCodigoDaURL('CODIGOVENCIDO0000000');
  await tiques();
  m.soltar.parear(RECUSADO);
  await tiques();
  assert.ok(m.log.includes('perguntou à extensão'), 'CONTROLE: o link que falha deixou de perguntar à extensão: ' + JSON.stringify(m.log));
  m.responder({ action: 'sessao', token: 'tok-e', conta: '222' });
  await link;
  assert.deepEqual(m.entraram(), ['tok-e'], 'CONTROLE: a extensão perguntada pelo link deixou de entrar');
});

// A pergunta à extensão em si: a resposta que chega com um login DESTA aba no meio
// não entra, e a sessão que a extensão criou sai do servidor (menos a do
// aparelho). Valia só na pergunta da VOLTA (silenciosa); a da ABERTURA (o
// `initApp` sem sessão e o link que falhou) entrava por cima do login da pessoa.
function perguntaAExtensao({ memoria = null, noAr = null, tokenGuardado = null } = {}) {
  const t = telaDeEntrada({});
  const log = [];
  const ext = janelaComExtensao(log);
  const API = {
    sessionToken: memoria,
    temSessaoNaMemoria() { return !!this.sessionToken; },
    setSession(tok) { log.push('sessão ' + tok); this.sessionToken = tok; },
    destroySession: (tok) => { log.push('apagou ' + tok); return Promise.resolve({ success: true }); },
  };
  const deps = {
    window: ext.window, document: t.document, MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, AppState: {}, API,
    safeLS: { get: (k) => (k === TOKEN ? tokenGuardado : null) },
    authInFlight: noAr === 'cookies', resgateEmVoo: noAr === 'codigo', callWithRetry: (fn) => fn(),
    EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, epocaDaSessao: 0, extPerguntando: false, extRenovando: false,
    extNegadoNestaPagina: false, extNegado: null, saiuNestaPagina: false, filaAtravessouSessao: false, focoDoTeclado: null,
    setTimeout: () => 1, clearTimeout: () => {},
    closeModal: (id) => { log.push('fechou ' + id); t.fechar(id); },
    showMainScreen: () => { log.push('app'); t.mostrarOApp(); },
    resetQueue: () => {}, loadProfileAndAuxData: () => Promise.resolve(), conhecerContaDoLogin: () => {},
    startFetching: () => {}, esvaziarFilaDeSaida: () => {}, mostrarEntrandoPelaExtensao: () => {},
  };
  const h = montar(['entrarPelaExtensao', 'textoDigitadoNaEntrada', 'focoNaTelaDeEntrada', 'fecharModaisDaEntrada', 'aoEntrarNestaPagina'], deps);
  return { h, deps, responder: ext.responder, log, API, tela: t };
}

test('R13-1-03: a resposta da extensão à pergunta da ABERTURA não troca o login desta aba (feito ou no ar) — e a sessão dela sai do servidor', async () => {
  for (const [caso, o] of [['os cookies colados entraram', { memoria: 'tok-c' }],
    ['os cookies sendo conferidos', { noAr: 'cookies' }], ['um código sendo resgatado', { noAr: 'codigo' }]]) {
    const m = perguntaAExtensao(o);
    const p = m.h.entrarPelaExtensao();                // a abertura (e o link que falhou): NÃO silenciosa
    m.responder({ action: 'aguarde' });
    m.responder({ action: 'sessao', token: 'tok-e', conta: '222' });
    assert.equal(await p, false, `DEFEITO (${caso}): a resposta da extensão entrou por cima do login desta aba`);
    assert.ok(!m.log.includes('sessão tok-e') && !m.log.includes('app'),
      `DEFEITO (${caso}): a sessão da extensão trocou a do login que a pessoa pediu: ` + JSON.stringify(m.log));
    assert.ok(m.log.includes('apagou tok-e'), `(${caso}) a sessão da extensão ficou órfã no servidor, por até 21 dias`);
    assert.equal(m.API.sessionToken, o.memoria || null, `(${caso}) a memória desta aba mudou`);
  }
  // A sessão da extensão já é a do aparelho (outra aba a pôs lá): fica no servidor.
  const outra = perguntaAExtensao({ memoria: 'tok-c', tokenGuardado: 'tok-e' });
  const po = outra.h.entrarPelaExtensao();
  outra.responder({ action: 'sessao', token: 'tok-e' });
  assert.equal(await po, false);
  assert.ok(!outra.log.includes('apagou tok-e'), 'a sessão que OUTRA aba está usando foi apagada do servidor');
});

test('R13-1-03: CONTROLES — sem login desta aba a abertura entra pela extensão; a mesma sessão também; a renovação da queda não muda', async () => {
  const m = perguntaAExtensao();
  const p = m.h.entrarPelaExtensao();
  m.responder({ action: 'sessao', token: 'tok-e' });
  assert.equal(await p, true);
  assert.deepEqual(m.log, ['perguntou à extensão', 'sessão tok-e', 'app'], 'CONTROLE: a abertura deixou de entrar pela extensão');
  const mesma = perguntaAExtensao({ memoria: 'tok-e' });
  const pm = mesma.h.entrarPelaExtensao();
  mesma.responder({ action: 'sessao', token: 'tok-e' });
  assert.equal(await pm, true, 'a memória com a MESMA sessão da extensão não é outro login');
  // A renovação da QUEDA: a resposta É o login que a aba espera, com o que estiver no ar.
  const queda = perguntaAExtensao({ noAr: 'cookies' });
  const pq = queda.h.entrarPelaExtensao({ silencioso: true, manterFila: true });
  queda.responder({ action: 'sessao', token: 'tok-e' });
  assert.equal(await pq, true, 'a renovação da queda passou a recusar a sessão da extensão');
});
