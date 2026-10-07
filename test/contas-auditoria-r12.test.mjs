// A conta, as abas e o login DESTA aba (auditoria da rodada 12, R12-1 e R12-5 —
// o lote 16 da área "contas"):
//
//  · R12-1-01 — dois logins DESTA aba ao mesmo tempo: o resgate do código no ar
//    (o link `/#pair=`, o "Entrar com um código") e os cookies colados e
//    confirmados no meio. Os dois davam certo, o segundo trocava o primeiro, e o
//    "Sair" apagava só o último — o outro ficava vivo no servidor, sem dono;
//  · R12-1-02 — o token que a extensão entrega DEPOIS de um "Sair" no meio da
//    pergunta era ignorado e NÃO apagado no servidor;
//  · R12-1-03 — a adoção calada (R9-1-03) por mais duas portas: a resposta de um
//    "invisível" que chega depois da queda, e o "Conectar outro aparelho" tocado
//    durante a renovação — as perguntas "esta aba tem sessão?" liam o
//    `getSession`, que com a memória vazia GRAVA nela a sessão da outra aba;
//  · R12-1-04 — o "Sair" dado noutra aba não alcançava a aba que CAIU na tela de
//    entrada: a fila, o card, o rascunho e o anel da conta que saiu ficavam nela;
//  · R12-1-05 — a volta à aba com TEXTO DIGITADO na entrada: a adoção respeitava,
//    e a pergunta à extensão da mesma volta apagava o que foi digitado;
//  · R12-5-04 — o pedido do perfil que nem teve RESPOSTA contava no teto de um
//    por minuto: com a rede voltando antes disso, nem o perfil nem o "invisível"
//    saíam;
//  · R12-5-05 — o "invisível" do gesto SEM perfil era gravado com a conta do
//    APARELHO, mesmo de outra sessão: a troca de conta o jogava fora.
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
const I18N = ler('js/i18n.js');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', i); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) {
      const corpo = APP_SEM.slice(m.index, j + 1);
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
// vazia, ele LÊ o aparelho e GRAVA na memória o que leu — adota). Um dublê
// esconderia exatamente o defeito.
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
    console, setTimeout, clearTimeout,
  };
  ctx.window = {};
  vm.createContext(ctx);
  vm.runInContext(I18N + '\n' + ler('js/api.js') + '\nthis.API = API; this.safeLS = safeLS;', ctx);
  return { API: ctx.API, safeLS: ctx.safeLS, dados };
}

// A TELA DE ENTRADA de mentira: a tela (com o "Colar cookies"), os diálogos dela
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
    mostrarOApp() { els.authScreen.classList.add('hidden'); els.appScreen.classList.remove('hidden'); },
  };
}

const TOKEN = 'waze_session_token';
const CONTA_KEY = constante('CONTA_KEY');
const STATS_KEY = constante('STATS_KEY');
const PREFERENCES_KEY = constante('PREFERENCES_KEY');
const MODAIS_DA_ENTRADA = constante('MODAIS_DA_ENTRADA');
const BOTAO_DA_ACAO = constante('BOTAO_DA_ACAO');
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();
const tique = () => new Promise((ok) => setImmediate(ok));
const COLANDO = { dialogo: 'pasteModal', texto: 'COOKIES_DE_OUTRA_CONTA', foco: 'cookiesTextarea' };

// ═══ R12-1-01 · UM login por vez nesta aba ═══════════════════════════════════
// O resgate do código e o login por cookies, os DOIS de verdade, contra um
// servidor de mentira que cria a sessão quando o TESTE solta cada resposta.
function doisLogins({ tela = {} } = {}) {
  const t = telaDeEntrada(tela);
  const log = [];
  const soltar = {};
  const AppState = {};
  const API = {
    sessionToken: null,
    temSessaoNaMemoria() { return !!this.sessionToken; },
    // Como o de verdade: o login que dá certo põe a sessão na memória (o `setSession`).
    resgatarPareamento: () => new Promise((ok) => {
      soltar.codigo = (r) => { if (r.success) { log.push('servidor criou ' + r.sessionToken); API.sessionToken = r.sessionToken; } ok(r); };
    }),
    testCookies: () => {
      log.push('os cookies foram ao servidor');
      return new Promise((ok) => {
        soltar.cookies = (r) => { if (r.success) { log.push('servidor criou ' + r.sessionToken); API.sessionToken = r.sessionToken; } ok(r); };
      });
    },
  };
  const deps = {
    document: t.document, MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, AppState, API,
    resgateEmVoo: false, resgateNoAr: null, authInFlight: false, focoDoTeclado: null,
    saiuNestaPagina: false, extNegadoNestaPagina: false, extNegado: null,
    closeModal: (id) => t.fechar(id),
    showToast: () => ({ dispensar() {} }), t: (k) => k, msgDoServidor: (r, d) => d,
    setAuthLoading: (v) => log.push('carregando:' + v), guardarPrazoDaSessao: () => {},
    showMainScreen: () => { log.push('app'); AppState.authenticated = true; t.mostrarOApp(); },
    resetQueue: () => {}, conhecerContaDoLogin: () => {}, loadProfileAndAuxData: () => null,
    startFetching: () => {}, esvaziarFilaDeSaida: () => {}, showAccessDenied: () => log.push('acesso restrito'),
  };
  const h = montar(['resgatarPareamento', 'authenticateWithCookies', 'focoNaTelaDeEntrada', 'fecharModaisDaEntrada',
    'aoEntrarNestaPagina'], deps);
  const criadas = () => log.filter((x) => x.startsWith('servidor criou '));
  return { h, deps, log, soltar, API, criadas };
}
const PAREADO = { success: true, sessionToken: 'tok-p', conta: '4242' };
const COOKIES_OK = { success: true, sessionToken: 'tok-c', conta: '4242' };

test('R12-1-01: os cookies confirmados com o resgate do código no ar ESPERAM o desfecho dele — o resgate entrou, e nenhuma segunda sessão nasce', async () => {
  const m = doisLogins();
  const resgate = m.h.resgatarPareamento('ABCDEFGHJKLMNPQRSTUV', { silencioso: true });   // o link /#pair=
  const colar = m.h.authenticateWithCookies('cookies colados');
  await tique();
  // O que a REDE viu com o resgate no ar, anotado antes de soltar qualquer resposta e conferido depois de
  // tudo terminar: o teste que reprova não deixa promessa pendurada (nem derruba os seguintes).
  const cookiesComOResgateNoAr = m.log.includes('os cookies foram ao servidor');
  m.soltar.codigo(PAREADO);
  await resgate;
  await tique();
  if (m.soltar.cookies) m.soltar.cookies(COOKIES_OK);   // só com o defeito: os cookies tinham ido ao servidor
  await colar;
  assert.ok(!cookiesComOResgateNoAr,
    'DEFEITO: os cookies saíram com o resgate do código no ar — dois logins desta aba ao mesmo tempo: ' + JSON.stringify(m.log));
  assert.deepEqual(m.criadas(), ['servidor criou tok-p'],
    'DEFEITO: duas sessões nasceram (o "Sair" apagaria só a última, a outra ficaria órfã por até 21 dias): ' + JSON.stringify(m.log));
  assert.equal(m.API.sessionToken, 'tok-p', 'a sessão da aba não é a do login que entrou');
  assert.ok(m.log.includes('carregando:false'), 'os botões da entrada ficaram travados depois da desistência');
  assert.equal(m.deps.authInFlight, false, 'o login por cookies ficou "no ar" depois de desistir');
});

test('R12-1-01: o resgate que FALHA deixa os cookies seguirem — e só eles criam sessão', async () => {
  const m = doisLogins();
  const resgate = m.h.resgatarPareamento('CODIGOVENCIDO0000000', { silencioso: true });
  const colar = m.h.authenticateWithCookies('cookies colados');
  await tique();
  m.soltar.codigo({ success: false, errorKey: 'srv.err.pairInvalid' });
  await resgate;
  await tique();
  assert.ok(m.log.includes('os cookies foram ao servidor'), 'DEFEITO: com o código recusado, os cookies colados não foram conferidos');
  m.soltar.cookies(COOKIES_OK);
  await colar;
  assert.deepEqual(m.criadas(), ['servidor criou tok-c']);
  assert.ok(m.log.includes('app'), 'o login pelos cookies não abriu o app');
});

test('R12-1-01: pelo TECLADO, quem desiste porque o resgate entrou promete o foco ao ✕ (R7-1-04); pelo mouse, não', async () => {
  for (const [peloTeclado, esperado] of [[true, BOTAO_DA_ACAO.left], [false, null]]) {
    const m = doisLogins();
    const resgate = m.h.resgatarPareamento('ABCDEFGHJKLMNPQRSTUV', { silencioso: true });
    const colar = m.h.authenticateWithCookies('cookies colados', { peloTeclado });
    await tique();
    m.soltar.codigo(PAREADO);
    await resgate;
    await tique();
    if (m.soltar.cookies) m.soltar.cookies(COOKIES_OK);   // sem a espera, os cookies tinham ido: a resposta chega
    await colar;
    assert.equal(m.deps.focoDoTeclado, esperado, `peloTeclado=${peloTeclado}: o foco ${esperado ? 'caiu no <body>' : 'foi movido pelo mouse'}`);
  }
});

test('R12-1-01: CONTROLE — sem resgate no ar, os cookies vão ao servidor na hora (o instrumento enxerga o envio)', async () => {
  const m = doisLogins();
  const colar = m.h.authenticateWithCookies('cookies colados');
  await tique();
  assert.ok(m.log.includes('os cookies foram ao servidor'), 'CONTROLE: sem resgate nenhum, os cookies esperaram por nada');
  m.soltar.cookies(COOKIES_OK);
  await colar;
  assert.deepEqual(m.criadas(), ['servidor criou tok-c']);
  assert.equal(m.deps.resgateNoAr, null, 'a promessa do resgate nasceu sem resgate');
});

test('R12-1-01: o resgate deixa a promessa do desfecho no ar enquanto corre, e a solta no fim — dê certo ou não', async () => {
  for (const r of [PAREADO, { success: false }]) {
    const m = doisLogins();
    const resgate = m.h.resgatarPareamento('ABCDEFGHJKLMNPQRSTUV', { silencioso: true });
    const desfecho = m.deps.resgateNoAr;
    m.soltar.codigo(r);
    await resgate;
    assert.ok(desfecho && typeof desfecho.then === 'function', 'o resgate no ar não deixou o desfecho pra quem espera');
    assert.equal(await desfecho, r.success === true, 'o desfecho prometido não é o do resgate');
    assert.equal(m.deps.resgateNoAr, null, 'a promessa ficou de pé depois do resgate');
  }
});

// ═══ R12-1-02 · o token da extensão depois de um "Sair" no meio da pergunta ════
function extensaoPerguntando({ tokenGuardado = null } = {}) {
  const t = telaDeEntrada({});
  const ouvintes = new Set();
  const window = {
    location: { origin: 'https://app' },
    addEventListener: (tipo, fn) => { if (tipo === 'message') ouvintes.add(fn); },
    removeEventListener: (tipo, fn) => ouvintes.delete(fn),
    postMessage: () => {},
  };
  const responder = (data) => {
    for (const fn of [...ouvintes]) fn({ source: window, origin: window.location.origin, data: { source: 'wazeplaces-ext', ...data } });
  };
  const log = [];
  const API = {
    sessionToken: null,
    temSessaoNaMemoria() { return !!this.sessionToken; },
    setSession(tok) { log.push('entrou com ' + tok); this.sessionToken = tok; },
    destroySession: (tok) => { log.push('apagou no servidor ' + tok); return Promise.resolve({ success: true }); },
  };
  const deps = {
    window, document: t.document, MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, AppState: {}, API,
    safeLS: { get: (k) => (k === TOKEN ? tokenGuardado : null) },
    authInFlight: false, resgateEmVoo: false, callWithRetry: (fn) => fn(),
    EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, epocaDaSessao: 7, extPerguntando: false, extRenovando: false,
    extNegadoNestaPagina: false, extNegado: null, saiuNestaPagina: false, filaAtravessouSessao: false, focoDoTeclado: null,
    setTimeout: () => 1, clearTimeout: () => {},
    closeModal: (id) => t.fechar(id), showMainScreen: () => log.push('app'),
    resetQueue: () => {}, loadProfileAndAuxData: () => Promise.resolve(), conhecerContaDoLogin: () => {},
    startFetching: () => {}, esvaziarFilaDeSaida: () => {},
  };
  const h = montar(['entrarPelaExtensao', 'focoNaTelaDeEntrada', 'fecharModaisDaEntrada', 'aoEntrarNestaPagina'], deps);
  return { h, deps, responder, log, API };
}

test('R12-1-02: a sessão que a extensão entrega DEPOIS do "Sair" (a renovação da queda, a abertura) sai do servidor — e não entra', async () => {
  for (const [caso, opcoes] of [['a renovação da queda', { silencioso: true, manterFila: true }], ['a abertura', {}],
    ['a volta à aba', { silencioso: true }]]) {
    const m = extensaoPerguntando();
    const p = m.h.entrarPelaExtensao(opcoes);
    m.responder({ action: 'aguarde' });
    m.deps.epocaDaSessao++;                         // o "Sair" no meio (aqui, ou noutra aba)
    m.responder({ action: 'sessao', token: 'tok-e', conta: '4242' });
    assert.equal(await p, false, `(${caso}) a resposta entrou por cima do "Sair"`);
    assert.ok(!m.log.includes('entrou com tok-e') && !m.log.includes('app'), `(${caso}) o "Sair" foi desfeito: ` + JSON.stringify(m.log));
    assert.ok(m.log.includes('apagou no servidor tok-e'),
      `DEFEITO (${caso}): a sessão que a extensão criou com os cookies da pessoa ficou no servidor, sem dono, depois do "Sair": ` + JSON.stringify(m.log));
  }
});

test('R12-1-02: a sessão da extensão que JÁ é a do aparelho (a outra aba entrou de novo com ela) fica — a régua da volta', async () => {
  const m = extensaoPerguntando({ tokenGuardado: 'tok-e' });
  const p = m.h.entrarPelaExtensao({ silencioso: true, manterFila: true });
  m.deps.epocaDaSessao++;
  m.responder({ action: 'sessao', token: 'tok-e' });
  assert.equal(await p, false);
  assert.ok(!m.log.includes('apagou no servidor tok-e'), 'a sessão que a OUTRA aba está usando foi apagada do servidor');
});

test('R12-1-02: CONTROLE — sem o "Sair" no meio, a renovação entra com a sessão da extensão, e nada é apagado', async () => {
  const m = extensaoPerguntando();
  const p = m.h.entrarPelaExtensao({ silencioso: true, manterFila: true });
  m.responder({ action: 'sessao', token: 'tok-e' });
  assert.equal(await p, true, 'CONTROLE: a renovação deixou de entrar');
  assert.deepEqual(m.log, ['entrou com tok-e', 'app']);
});

// ═══ R12-1-03 · "esta aba tem sessão?" se responde pela MEMÓRIA ═══════════════
// A aba que caiu (a memória vazia) e a OUTRA aba com a sessão guardada no
// aparelho: nenhuma das seis perguntas pode adotar a sessão de lá.
function abaSemSessaoNaMemoria({ perfil = null } = {}) {
  const real = apiDeVerdade({ [TOKEN]: 'tok-b', [CONTA_KEY]: JSON.stringify({ id: '4242', s: marcaDe('tok-b') }) });
  const deps = {
    API: real.API, safeLS: real.safeLS, CONTA_KEY, AppState: { profile: perfil },
    // A prova de vida e o recuo que a OUTRA aba deixou — da sessão dela.
    sessaoVivaEm: { s: marcaDe('tok-b'), em: 10 }, saidaRecuo: { s: marcaDe('tok-b'), n: 1, ate: Date.now() + 60000 },
    contaConfirmadaNestaAba: null, SAIDA_RECUO_401_MS: constante('SAIDA_RECUO_401_MS'), dfato: () => {},
  };
  const h = montar(['marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'contaConfirmada', 'sessaoVivaDepoisDe',
    'marcarSessaoViva', 'recuarSaida', 'saidaEmRecuo'], deps);
  return { h, real, deps };
}

test('R12-1-03: as seis perguntas pela sessão DESTA aba, com a memória vazia, não adotam a sessão que outra aba guardou', () => {
  const perguntas = {
    contaAgora: (h) => assert.equal(h.contaAgora(), null, 'a conta da OUTRA aba (vista com a sessão dela) passou como a desta'),
    contaConfirmada: (h) => assert.equal(h.contaConfirmada(), false, 'a conta foi dada como confirmada sem sessão nesta aba'),
    sessaoVivaDepoisDe: (h) => assert.equal(h.sessaoVivaDepoisDe(0), false, 'a prova de vida da OUTRA aba valeu pra esta, sem sessão'),
    marcarSessaoViva: (h) => h.marcarSessaoViva(),
    recuarSaida: (h) => h.recuarSaida(),
    saidaEmRecuo: (h) => assert.equal(h.saidaEmRecuo(), false, 'o recuo da OUTRA aba valeu pra esta, sem sessão'),
  };
  for (const [nome, perguntar] of Object.entries(perguntas)) {
    const m = abaSemSessaoNaMemoria({ perfil: nome === 'contaConfirmada' ? { id: 4242 } : null });
    perguntar(m.h);
    assert.equal(m.real.API.temSessaoNaMemoria(), false,
      `DEFEITO (${nome}): a pergunta ADOTOU calada a sessão da outra aba — a aba fica "logada" na tela de entrada, e o "Sair" de lá fecha o "Colar cookies" daqui`);
  }
  // CONTROLE do instrumento: o `getSession` de verdade, com a memória vazia, adota.
  const c = abaSemSessaoNaMemoria();
  assert.equal(c.real.API.getSession(), 'tok-b');
  assert.equal(c.real.API.temSessaoNaMemoria(), true, 'CONTROLE: o `getSession` de verdade não grava mais na memória — o mecanismo mudou, reveja o teste');
});

test('R12-1-03: CONTROLE — com a sessão desta aba na memória, as perguntas respondem por ELA', () => {
  const m = abaSemSessaoNaMemoria();
  m.real.API.sessionToken = 'tok-b';                // a mesma sessão do aparelho, nesta aba
  assert.equal(m.h.contaAgora(), '4242', 'a conta vista com a sessão desta aba deixou de valer');
  assert.equal(m.h.sessaoVivaDepoisDe(0), true, 'a prova de vida desta sessão deixou de valer');
  assert.equal(m.h.saidaEmRecuo(), true, 'o recuo desta sessão deixou de valer');
  m.real.API.sessionToken = 'tok-OUTRA';            // outra sessão: nada da de lá vale
  assert.equal(m.h.contaAgora(), null);
  assert.equal(m.h.sessaoVivaDepoisDe(0), false);
});

// O "Conectar outro aparelho" durante a renovação da queda: a Ajuda ainda mostra
// o botão, a memória está vazia, e a outra aba guardou a sessão dela.
function pareamentoNaRenovacao({ memoria = null } = {}) {
  const real = apiDeVerdade({ [TOKEN]: 'tok-b', [CONTA_KEY]: JSON.stringify({ id: '4242', s: marcaDe('tok-b') }) });
  real.API.sessionToken = memoria;
  const enviados = [];
  real.API._post = async (rota, corpo) => { enviados.push([rota, corpo.sessionToken]); return { success: true, code: 'PRIVQRSTUVWXYZ234567', expiresIn: 300 }; };
  const log = [];
  const deps = {
    API: real.API, safeLS: real.safeLS, CONTA_KEY, AppState: { profile: null, authenticated: false },
    epocaDaSessao: 3, aberturaDoPareamento: 0, pareamentosEmitidos: new Set(), pairQrVenceEm: 0,
    openModal: (id) => log.push('abriu ' + id), closeModal: (id) => log.push('fechou ' + id),
    showToast: (msg) => log.push('aviso ' + msg), t: (k) => k, msgDoServidor: (r, d) => d,
    handleUnauthorized: () => log.push('conferiu a sessão'),
    desenharQrPareamento: () => log.push('desenhou o QR'), iniciarTickerPareamento: () => {},
  };
  const h = montar(['abrirPareamento', 'pareamentoTardio', 'avisarFalhaDoPareamento', 'contaAgora', 'marcaDestaAba', 'marcaDaSessao'], deps);
  return { h, real, enviados, log, deps };
}

test('R12-1-03: "Conectar outro aparelho" sem sessão NESTA aba não adota a da outra nem cria código com ela — "não deu pra gerar"', async () => {
  const m = pareamentoNaRenovacao();
  await m.h.abrirPareamento();
  assert.equal(m.real.API.temSessaoNaMemoria(), false,
    'DEFEITO: o "Conectar outro aparelho" ADOTOU calado a sessão da outra aba (a tela de entrada vem com ela na memória)');
  assert.deepEqual(m.enviados, [], 'DEFEITO: um código de pareamento foi criado com a sessão da OUTRA aba: ' + JSON.stringify(m.enviados));
  assert.ok(m.log.includes('fechou pairShowModal') && m.log.includes('aviso toast.pairCreateError'),
    'sem sessão, o diálogo não fechou com o "não deu pra gerar o código": ' + JSON.stringify(m.log));
  assert.equal(m.deps.pareamentosEmitidos.size, 0);
});

test('R12-1-03: CONTROLE — com a sessão desta aba, o código sai com ELA (não com a guardada no aparelho)', async () => {
  const m = pareamentoNaRenovacao({ memoria: 'tok-a' });
  await m.h.abrirPareamento();
  assert.deepEqual(m.enviados, [['parear', 'tok-a']], 'o código não saiu com a sessão desta aba');
  assert.ok(m.log.includes('desenhou o QR') && !m.log.includes('fechou pairShowModal'));
  assert.equal(m.deps.pareamentosEmitidos.size, 1);
});

// A RESPOSTA de um "invisível" que chega DEPOIS da queda desta aba, com a série de
// 401 do desligar já conferida (`desligar401Em`): o `.then` perguntava pela prova
// de vida pelo `getSession` — e adotava a sessão da outra aba.
const T = 1791000000000;
function desligarNoArNaQueda({ espiaoDaProva = false } = {}) {
  const real = apiDeVerdade({ [TOKEN]: 'tok-b', [CONTA_KEY]: JSON.stringify({ id: '4242', s: marcaDe('tok-b') }),
    [PREFERENCES_KEY]: JSON.stringify({ presenca: false }) });
  real.API.sessionToken = 'tok-a';                  // a sessão DESTA aba (a outra é a guardada)
  let responder = null;
  real.API.presencaWaze = () => new Promise((ok) => { responder = ok; });
  const ap = { localStorage: { getItem: (k) => (real.dados.has(k) ? real.dados.get(k) : null), setItem: (k, v) => real.dados.set(k, String(v)),
    removeItem: (k) => real.dados.delete(k) } };
  const AppState = { authenticated: true, profile: { id: 4242 }, preferences: { presenca: false } };
  // A série de 401 do desligar JÁ conferida, e a prova de vida da sessão desta aba depois dela.
  const presencaWme = { desligarPendente: false, desligarEm: 0, desligarSessao: null, desligarVez: 1, desligarNoAr: 0,
    ligarNaProxima: false, desligar401Em: T - 5000 };
  const provas = [];
  const deps = {
    API: real.API, safeLS: real.safeLS, localStorage: ap.localStorage, AppState, presencaWme, CONTA_KEY, PREFERENCES_KEY,
    preferenciasCarregadas: true, Date: { now: () => T }, dfato: () => {}, ABA_DESTA_PAGINA: 'aba-a',
    sessaoVivaEm: { s: marcaDe('tok-a'), em: T - 1000 }, handleUnauthorized: () => {},
  };
  const nomes = ['presencaWmeDesligar', 'presencaWmeGravarPendente', 'presencaWmeEsquecerGravado', 'presencaWmeAnotarDesligar',
    'savePreferences', 'marcaDaSessao', 'marcaDestaAba', 'contaAgora'];
  if (espiaoDaProva) deps.sessaoVivaDepoisDe = (t) => { provas.push(t); return false; };
  else nomes.push('sessaoVivaDepoisDe');
  const h = montar(nomes, deps);
  // A queda desta aba: a memória solta, o perfil e o `authenticated` também.
  const cair = () => { real.API.soltarSessao(); AppState.profile = null; AppState.authenticated = false; };
  return { h, real, responder: (r) => responder(r), cair, provas, presencaWme };
}

test('R12-1-03: a resposta 401 de um "invisível" que chega DEPOIS da queda não adota a sessão da outra aba', async () => {
  const m = desligarNoArNaQueda();
  m.h.presencaWmeDesligar({ repeticao: true });    // a repetição no ar
  m.cair();
  m.responder({ success: false, errorCategory: 'unauthorized' });
  await tique();
  await tique();
  assert.equal(m.real.API.temSessaoNaMemoria(), false,
    'DEFEITO: a resposta do "invisível" ADOTOU calada a sessão da outra aba — a tela de entrada fica com ela na memória');
});

test('R12-1-03: a prova de vida só é perguntada com o 401 — a resposta boa (ou a falha de rede) não pergunta nada', async () => {
  for (const [caso, resposta, perguntas] of [['sucesso', { success: true }, 0], ['rede', { success: false, errorCategory: 'transient', _motivo: 'TypeError' }, 0],
    ['401 (CONTROLE)', { success: false, errorCategory: 'unauthorized' }, 1]]) {
    const m = desligarNoArNaQueda({ espiaoDaProva: true });
    m.h.presencaWmeDesligar({ repeticao: true });
    m.cair();
    m.responder(resposta);
    await tique();
    await tique();
    assert.equal(m.provas.length, perguntas,
      `(${caso}) a prova de vida foi perguntada ${m.provas.length} vez(es) — fora do 401 ela é pergunta à toa, e com a memória vazia era a porta da adoção`);
  }
});

// ═══ R12-1-04 · o "Sair" de outra aba alcança a aba que CAIU na tela de entrada ═
function abaNaEntrada({ guardado = {}, conta = null, fila = [], card = false } = {}) {
  const ap = aparelho(guardado);
  const log = [];
  const deps = {
    safeLS: ap.safeLS, localStorage: ap.localStorage, CONTA_KEY, STATS_KEY, PREFERENCES_KEY,
    API: { temSessaoNaMemoria: () => false, sessionToken: null },
    AppState: { authenticated: false, profile: null, queue: fila, currentPlace: fila[0] || null },
    document: {
      getElementById: (id) => (id === 'appScreen' ? { classList: { contains: (c) => c === 'hidden' } } : null),
      querySelector: (sel) => (card && sel === '#cardStack .place-card' ? { id: 'card' } : null),
    },
    contaConfirmadaNestaAba: conta, extPerguntando: false,
    handleLogout: (o) => log.push(['sair', o]),
    relerPlacarDeOutraAba: () => log.push('placar'), relerPreferenciasDeOutraAba: () => log.push('preferencias'),
  };
  const h = montar(['sincronizarComOutraAba', 'aoSairEmOutraAba', 'aoEntrarOutraContaEmOutraAba', 'contaSegueNoAparelho',
    'sessaoDestaAbaEhAGuardada', 'guardaASessaoQueCaiu'], deps);
  return { h, log, ap };
}
const NA_ENTRADA = ['sair', { porOutraAba: true, naEntrada: true }];

test('R12-1-04: o "Sair" noutra aba encerra a memória da aba que CAIU na tela de entrada — pela conta confirmada, pela fila ou pelo card', () => {
  for (const [caso, estado] of [['a conta que ela confirmou', { conta: { id: '4242', s: 'x' } }],
    ['a fila da sessão que caiu', { fila: [{ venueID: 'p0', updateRequestID: 'up0' }] }],
    ['o card no DOM', { card: true }]]) {
    const m = abaNaEntrada(estado);
    m.h.sincronizarComOutraAba(CONTA_KEY);         // o aviso da conta: o "Sair" de lá
    assert.deepEqual(m.log, [NA_ENTRADA],
      `DEFEITO (${caso}): a aba que caiu na tela de entrada guardou a memória da conta que SAIU — fila, card, rascunho e anel: ` + JSON.stringify(m.log));
  }
});

test('R12-1-04: CONTROLES — a aba que nunca entrou segue como estava, e a QUEDA noutra aba (a conta fica no aparelho) não é "Sair"', () => {
  const nova = abaNaEntrada();
  nova.h.sincronizarComOutraAba(CONTA_KEY);
  assert.deepEqual(nova.log, [], 'a aba que nunca entrou foi encerrada pelo "Sair" da outra (R9-1-03)');
  const queda = abaNaEntrada({ guardado: { [CONTA_KEY]: { id: '4242', s: 'x' } }, conta: { id: '4242', s: 'x' } });
  queda.h.sincronizarComOutraAba(TOKEN);
  assert.deepEqual(queda.log, [], 'a QUEDA da sessão noutra aba foi tratada como "Sair"');
});

// O `handleLogout` DE VERDADE, no modo da aba que caiu: tudo o que o "Sair" solta
// na memória e na tela, sem gravar no aparelho, sem fechar o que a pessoa abriu
// na tela de entrada e sem o aviso.
function montarSairNaEntrada() {
  const ap = aparelho({ [STATS_KEY]: '{"rejected":0}' });
  const log = [];
  const AppState = {
    authenticated: false, profile: null, stats: { read: 0, rejected: 0, skipped: 0 }, filters: { velho: true },
    preferences: { presenca: false }, devMode: { unlocked: false, active: false }, history: { _total: {} },
    conquistas: { c: {} }, autores: { r: {} }, pendingAction: null, inFlightActions: 0, sessaoExpiraEm: null,
    queue: [{ venueID: 'p0' }], currentPlace: { venueID: 'p0' },
  };
  const API = {
    sessionToken: null, chamadas: [{ rota: 'perfil' }, { rota: 'buscar-places' }],
    getSession() { return this.sessionToken; },
    setSession(t) { log.push('setSession:' + t); },
    soltarSessao() { this.sessionToken = null; },
    destroySession: (t) => { log.push('destroy:' + t); return Promise.resolve({ success: true }); },
    cancelarPareamento: (c) => { log.push('cancelou:' + c); return Promise.resolve(); },
    setRegion: () => log.push('regiao'), setCountry: () => log.push('pais'), esquecerLugar: () => log.push('esqueceu o lugar'),
  };
  const deps = {
    safeLS: ap.safeLS, localStorage: ap.localStorage, AppState, API,
    window: { Presenca: { esquecer: (o) => log.push(['conversa', o || null]) } },
    epocaDaSessao: 2, saiuNestaPagina: false, pareamentosEmitidos: new Set(), tokenTiradoPorOutraAba: null,
    HISTORY_KEY: constante('HISTORY_KEY'), CONQUISTAS_KEY: 'waze_places_conquistas', CHAVE_INSTALL_DISPENSADO: 'waze_places_install_dispensado',
    PERFIL_GATE_KEY: constante('PERFIL_GATE_KEY'), CONTA_KEY, SESSOES_KEY: 'waze_places_sessoes', NASCIMENTO_KEY: 'waze_places_nascimento',
    SAIDA_KEY: 'waze_places_saida', pousosDaPagina: new Set(['p9|u9']), pedidosEmAndamento: new Set(),
    referenciasDoPerfil: null, posicaoGps: null, avatarPendente: null, avatarFalhou: null, telaPronta: true,
    contaConfirmadaNestaAba: { id: '4242', s: 'x' },
    fecharCamadasAbertas: () => log.push('fechou as camadas'), closeModal: (id) => log.push('fechou:' + id),
    dlogApagar: (o) => log.push(['capturas', o || null]), resetQueue: () => log.push('fila nova'),
    filtrosDeFabrica: () => ({ fabrica: true }), offlineEsquecer: (o) => log.push(['offline', o || null]),
    esquecerAutores: () => log.push('autores do aparelho'), esquecerPrazoDaSessao: () => log.push('prazo do aparelho'),
    registrarEventoDeSessao: (e) => log.push('diario:' + e),
    saveStats: () => ap.safeLS.set(STATS_KEY, '{}'), saveFilters: () => ap.safeLS.set('waze_places_filters', '{}'),
    savePreferences: () => ap.safeLS.set(PREFERENCES_KEY, '{}'), saveDevMode: () => ap.safeLS.set('waze_places_devmode', '{}'),
    callWithRetry: (fn) => fn(), t: (k) => k, showToast: (m) => log.push('aviso ' + m),
    removeCurrentCardEl: () => log.push('o card saiu do DOM'), showAuthScreen: () => log.push('tela de entrada'),
  };
  const h = montar(['handleLogout', 'preferenciasDeFabrica'], deps);
  return { h, ap, log, AppState, API, deps };
}

test('R12-1-04: na aba que caiu, o "Sair" de lá solta a fila, o card, a conversa, as capturas e o anel — sem gravar no aparelho, sem fechar o "Colar" e sem aviso', async () => {
  const m = montarSairNaEntrada();
  await m.h.handleLogout({ porOutraAba: true, naEntrada: true });
  assert.deepEqual(m.ap.escritas, [], 'a aba que caiu mexeu no aparelho (a outra já o limpou): ' + m.ap.escritas.join(' '));
  assert.ok(m.log.includes('fila nova') && m.log.includes('o card saiu do DOM'), 'a fila e o card da conta que saiu ficaram: ' + JSON.stringify(m.log));
  assert.deepEqual(m.log.find((x) => Array.isArray(x) && x[0] === 'conversa'), ['conversa', { soMemoria: true }], 'o rascunho da conversa ficou');
  assert.deepEqual(m.log.find((x) => Array.isArray(x) && x[0] === 'capturas'), ['capturas', { soMemoria: true }]);
  assert.equal(m.API.chamadas.length, 0, 'o anel de chamadas da sessão que saiu ficou (voltaria no relatório de quem entrar)');
  assert.equal(m.deps.contaConfirmadaNestaAba, null);
  assert.equal(m.deps.saiuNestaPagina, true, 'voltar a esta aba relogaria pela extensão, desfazendo o "Sair"');
  assert.equal(m.deps.pousosDaPagina.size, 0);
  assert.ok(!m.log.includes('fechou as camadas'),
    'DEFEITO: o "Sair" da outra aba fechou o que a pessoa abriu na tela de entrada (o "Colar cookies", com o que ela digita — R9-1-03)');
  assert.ok(!m.log.some((x) => typeof x === 'string' && x.startsWith('aviso ')), 'o aviso de "Sair" apareceu numa tela que não mudou: ' + JSON.stringify(m.log));
  assert.ok(!m.log.some((x) => typeof x === 'string' && (x.startsWith('destroy:') || x.startsWith('setSession'))));
});

test('R12-1-04: CONTROLE — na aba LOGADA, o "Sair" de lá fecha as camadas e avisa, como sempre', async () => {
  const m = montarSairNaEntrada();
  m.AppState.authenticated = true;
  await m.h.handleLogout({ porOutraAba: true });
  assert.ok(m.log.includes('fechou as camadas'), 'CONTROLE: o "Sair" da outra aba deixou de fechar o que estava aberto na aba logada');
  assert.ok(m.log.includes('aviso toast.saiuNoutraAba'));
  assert.deepEqual(m.ap.escritas, []);
});

// ═══ R12-1-05 · a volta à aba com TEXTO DIGITADO não pergunta à extensão ═══════
function voltaNaEntrada(tela) {
  const real = apiDeVerdade({});                  // nenhuma sessão no aparelho: a adoção não tem o que adotar
  const t = telaDeEntrada(tela);
  const log = [];
  const deps = {
    API: real.API, safeLS: real.safeLS, AppState: { authenticated: false, profile: null }, document: t.document,
    MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, extPerguntando: false, resgateEmVoo: false, authInFlight: false,
    saiuNestaPagina: false, extNegadoNestaPagina: false, extNegado: null, focoDoTeclado: null,
    closeModal: (id) => { log.push('fechou ' + id); t.fechar(id); },
    podeInstalarExtensao: () => true,
    entrarPelaExtensao: (o) => { log.push('perguntou à extensão' + (o && o.silencioso ? ' (em silêncio)' : '')); return new Promise(() => {}); },
  };
  const h = montar(['aoVoltarAAba', 'perguntarAExtensaoAoVoltar', 'adotarSessaoDoAparelho', 'textoDigitadoNaEntrada',
    'focoNaTelaDeEntrada', 'fecharModaisDaEntrada', 'aoEntrarNestaPagina'], deps);
  return { h, log, tela: t };
}

test('R12-1-05: a volta à aba com o cookies.txt colado (ou o código digitado) não pergunta à extensão — a régua da adoção', () => {
  for (const tela of [COLANDO, { dialogo: 'pairEnterModal', texto: 'ABC-234', foco: 'pairCodeInput' }]) {
    const m = voltaNaEntrada(tela);
    m.h.aoVoltarAAba();
    assert.deepEqual(m.log, [],
      `DEFEITO (${tela.dialogo}): a volta perguntou à extensão com o texto digitado — a resposta fecharia o diálogo (o que estava colado ia embora) e entraria com a conta do WME: ` + JSON.stringify(m.log));
    const campo = tela.dialogo === 'pasteModal' ? 'cookiesTextarea' : 'pairCodeInput';
    assert.equal(m.tela.els[campo].value, tela.texto);
  }
});

test('R12-1-05: CONTROLE — sem texto digitado (o diálogo vazio, ou nenhum), a volta pergunta à extensão em silêncio', () => {
  for (const tela of [{}, { dialogo: 'pasteModal', texto: '', foco: 'cookiesTextarea' }]) {
    const m = voltaNaEntrada(tela);
    m.h.aoVoltarAAba();
    assert.deepEqual(m.log, ['perguntou à extensão (em silêncio)'], 'CONTROLE: a volta deixou de perguntar à extensão: ' + JSON.stringify(tela));
  }
});

// ═══ R12-5-04 · o pedido do perfil SEM resposta não conta no teto ═════════════
function perfilQueFalta(respostaDoPerfil) {
  const relogio = { t: T };
  const pedidos = [];
  const respostas = [];   // o soltar de CADA pedido, na ordem
  const deps = {
    AppState: { authenticated: true, profile: null }, epocaDaSessao: 0, perfilPedidoEm: 0, cargasDoPerfil: 0,
    PERFIL_REFAZER_MS: constante('PERFIL_REFAZER_MS'), lugarDoPedidoDoPerfil: null, Date: { now: () => relogio.t },
    API: {
      getRegion: () => 'row', getCountry: () => 30,
      // O perfil fica no ar até o TESTE soltar a resposta.
      getProfile: () => { pedidos.push(relogio.t); return new Promise((ok) => { respostas.push(() => ok(respostaDoPerfil)); }); },
    },
    pedirListaDePaises: () => Promise.resolve({ success: false, errorCategory: 'transient', _motivo: 'TypeError' }),
    definirPerfil: () => false, recusaDoPortao: () => {}, handleUnauthorized: () => {},
  };
  const h = montar(['loadProfileAndAuxData', 'refazerPerfilSeFaltar'], deps);
  return { h, relogio, pedidos, soltar: (i = respostas.length - 1) => respostas[i](), deps };
}
const SEM_RESPOSTA = { success: false, error: 'x', errorCategory: 'transient', _motivo: 'TypeError' };
const COM_RESPOSTA = { success: false, error: 'x', errorCategory: 'transient' };   // o 502 da borda: a resposta CHEGOU

test('R12-5-04: o perfil que nem teve RESPOSTA não segura o teto de um minuto — a prova de rede seguinte o pede de novo', async () => {
  const m = perfilQueFalta(SEM_RESPOSTA);
  const carga = m.h.loadProfileAndAuxData();      // o app reaberto sem resposta da API
  await tique();
  m.relogio.t += 5000;
  m.h.refazerPerfilSeFaltar();                    // uma prova de rede com o pedido NO AR: ele vale
  assert.equal(m.pedidos.length, 1, 'com o pedido no ar, a prova de rede pediu o perfil de novo (dois no ar)');
  m.soltar();
  await carga;
  m.relogio.t += 10000;                            // a rede volta 15 s depois da abertura
  m.h.refazerPerfilSeFaltar();                    // a resposta do esvaziamento da fila de saída
  assert.equal(m.pedidos.length, 2,
    'DEFEITO: a tentativa que nem chegou ao servidor contou no teto — com a rede de volta, o perfil (e o "invisível" que espera por ele) só sairiam depois de um minuto, no próximo gesto');
});

test('R12-5-04: CONTROLE — a tentativa que TEVE resposta (o Waze fora, a borda com 502) segue contando no teto de um minuto', async () => {
  const m = perfilQueFalta(COM_RESPOSTA);
  const carga = m.h.loadProfileAndAuxData();
  await tique();
  m.soltar();
  await carga;
  m.relogio.t += 15000;
  m.h.refazerPerfilSeFaltar();
  assert.equal(m.pedidos.length, 1, 'a resposta que CHEGOU (prova de rede) deixou de contar no teto: um perfil por resposta da API');
  m.relogio.t += 60000;
  m.h.refazerPerfilSeFaltar();
  assert.equal(m.pedidos.length, 2, 'passado o minuto, o perfil não foi pedido de novo');
});

test('R12-5-04: a carga sem resposta só devolve o teto se nenhuma outra começou depois dela', async () => {
  const m = perfilQueFalta(SEM_RESPOSTA);
  const primeira = m.h.loadProfileAndAuxData();
  await tique();
  m.relogio.t += 70000;                            // passado o minuto: a prova de rede pede de novo
  m.h.refazerPerfilSeFaltar();
  assert.equal(m.pedidos.length, 2);
  m.soltar(0);                                    // a PRIMEIRA acaba sem resposta, com a segunda no ar
  await primeira;
  m.relogio.t += 1000;
  m.h.refazerPerfilSeFaltar();
  assert.equal(m.pedidos.length, 2, 'a carga velha devolveu o teto por cima da que está no ar: dois perfis no ar');
});

// ═══ R12-5-05 · o "invisível" do gesto SEM perfil leva a marca da SESSÃO ═══════
// O aparelho diz X, de OUTRA sessão; a memória tem a sessão de Y, cujo perfil
// ainda não chegou. O gesto de desligar era gravado com a conta X; o perfil de Y
// chegava, a troca de conta jogava o pendente fora, e o `presenca-waze` nunca
// saía — o interruptor desligado, e Y visível no WME.
const X = '12444348';
const Y = '183164343';
function gestoSemPerfil({ contaDoAparelho = { id: X, s: marcaDe('tok-de-OUTRA-sessao') }, sessao = 'tok-y' } = {}) {
  const ap = aparelho({ [TOKEN]: sessao, [CONTA_KEY]: contaDoAparelho, [PREFERENCES_KEY]: { presenca: true } });
  const enviados = [];
  const AppState = {
    authenticated: true, profile: null, preferences: { presenca: true }, filters: {}, queue: [], fetching: false,
    stats: { read: 0, rejected: 0, skipped: 0 },
  };
  const presencaWme = { desligarPendente: false, desligarEm: 0, desligarSessao: null, desligarVez: 0, desligarNoAr: 0,
    ligarNaProxima: false, desligar401Em: null, desligar401Sessao: null };
  const API = {
    sessionToken: sessao,
    temSessaoNaMemoria() { return !!this.sessionToken; },
    getSession() { return this.sessionToken; },
    presencaWaze: async (c) => { enviados.push(c); return { success: true }; },
  };
  const deps = {
    API, safeLS: ap.safeLS, localStorage: ap.localStorage, AppState, presencaWme, CONTA_KEY, PREFERENCES_KEY,
    SAIDA_KEY: constante('SAIDA_KEY'), preferenciasCarregadas: true, Date: { now: () => T },
    PRESENCA_WME_DESLIGAR_REPETIR_MS: constante('PRESENCA_WME_DESLIGAR_REPETIR_MS'), ABA_DESTA_PAGINA: 'aba-y',
    contaConfirmadaNestaAba: null, saidaEsperandoConta: false, filaAtravessouSessao: false, puladosNoInicioDaFila: 0,
    Treino: { ativo: false }, dfato: () => {},
  };
  const h = montar(['presencaWmeDesligar', 'presencaWmeGravarPendente', 'presencaWmeEsquecerGravado', 'presencaWmeAnotarDesligar',
    'presencaWmeRefazerDesligar', 'presencaWmeZerar', 'savePreferences', 'aoConhecerConta', 'esquecerOutraConta',
    'invisivelPedidoAntesDoPerfil', 'carimbarContaNoInvisivel', 'carimbarContaNaSaida', 'carregarFilaDeSaida',
    'salvarFilaDeSaida', 'sessaoDestaAbaEhAGuardada', 'contaAgora', 'marcaDestaAba', 'marcaDaSessao'], deps);
  // O gesto: o interruptor desligado (o ouvinte grava a preferência e chama o desligar).
  const desligar = () => { AppState.preferences.presenca = false; h.presencaWmeDesligar(); };
  // O perfil da sessão chega, na ordem do `definirPerfil`: a conta, e o "invisível" que esperava por ele.
  const chegaOPerfil = (id) => { AppState.profile = { id: Number(id) }; h.aoConhecerConta(AppState.profile); h.presencaWmeRefazerDesligar(); };
  return { h, ap, enviados, AppState, presencaWme, desligar, chegaOPerfil };
}

test('R12-5-05: o "invisível" pedido antes do perfil sai pro dono da SESSÃO do gesto — mesmo com o aparelho dizendo outra conta', async () => {
  const m = gestoSemPerfil();
  m.desligar();
  assert.equal(m.presencaWme.desligarPendente, true, 'PRÉ-CONDIÇÃO: o gesto sem perfil não ficou pendente');
  assert.notEqual((m.AppState.preferences.presencaWmeDesligar || {}).conta, X,
    'DEFEITO: o gesto foi gravado com a conta do APARELHO, vista com OUTRA sessão — a troca de conta o jogaria fora');
  m.chegaOPerfil(Y);
  await tique();
  assert.deepEqual(m.enviados, [{ userId: Y, visivel: false }],
    'DEFEITO: o gesto de desligar de quem entrou nunca chegou ao WME — o interruptor desligado e a pessoa visível lá');
});

test('R12-5-05: CONTROLE — o perfil que chega é o da conta do aparelho: o "invisível" sai pra ela, como antes', async () => {
  const m = gestoSemPerfil();
  m.desligar();
  m.chegaOPerfil(X);
  await tique();
  assert.deepEqual(m.enviados, [{ userId: X, visivel: false }]);
});

test('R12-5-05: CONTROLE — a conta do aparelho vista com ESTA sessão grava o gesto com a conta, como sempre', () => {
  const m = gestoSemPerfil({ contaDoAparelho: { id: X, s: marcaDe('tok-y') } });
  m.desligar();
  assert.equal(m.AppState.preferences.presencaWmeDesligar.conta, X, 'a conta desta sessão, conhecida, deixou de valer pro gesto sem perfil');
});

test('R12-5-05: o gesto gravado só com a marca da sessão sobrevive ao app fechado — e sai com o perfil da MESMA sessão na reabertura', async () => {
  const m = gestoSemPerfil();
  m.desligar();
  const gravado = JSON.parse(m.ap.dados.get(PREFERENCES_KEY));
  assert.equal(gravado.presencaWmeDesligar && gravado.presencaWmeDesligar.s, marcaDe('tok-y'), 'o gesto não foi gravado com a marca da sessão');
  // A reabertura: as preferências lidas do aparelho, pela leitura de verdade.
  const AppState = { preferences: {} };
  const ler = montar(['lerPreferenciasGuardadas'], { AppState, localStorage: m.ap.localStorage, PREFERENCES_KEY });
  ler.lerPreferenciasGuardadas();
  assert.deepEqual(AppState.preferences.presencaWmeDesligar, { s: marcaDe('tok-y'), em: gravado.presencaWmeDesligar.em },
    'DEFEITO: o gesto gravado sem a conta não sobreviveu à leitura — fechar o app antes do perfil o perdia');
  // A MESMA sessão reabre (a salva), sem nada na memória da página nova, e o perfil chega.
  const r = gestoSemPerfil();
  r.ap.dados.set(PREFERENCES_KEY, m.ap.dados.get(PREFERENCES_KEY));
  r.AppState.preferences = { presenca: false, presencaWmeDesligar: AppState.preferences.presencaWmeDesligar };
  r.chegaOPerfil(Y);
  await tique();
  assert.deepEqual(r.enviados, [{ userId: Y, visivel: false }], 'o gesto guardado não saiu na reabertura com o perfil da mesma sessão');
});

test('R12-5-05: o gesto de OUTRA sessão, sem conta, tem dono desconhecido — não sai no nome de quem entrar, e sai do aparelho', async () => {
  // Página nova, com a sessão tok-z (de OUTRA conta, ou da mesma) e o gesto de
  // tok-y gravado só com a marca: o dono dele é desconhecido.
  for (const [caso, contaDoAparelho] of [['outra conta entrou', { id: X, s: marcaDe('tok-y') }],
    ['a mesma conta, noutra sessão', { id: '555', s: marcaDe('tok-y') }]]) {
    const m = gestoSemPerfil({ contaDoAparelho, sessao: 'tok-z' });
    m.AppState.preferences = { presenca: false, presencaWmeDesligar: { s: marcaDe('tok-y'), em: T } };
    m.h.savePreferences();
    m.chegaOPerfil('555');
    await tique();
    assert.deepEqual(m.enviados, [], `(${caso}) o app desligou no WME a visibilidade de quem não fez o gesto`);
    assert.equal(m.AppState.preferences.presencaWmeDesligar, undefined, `(${caso}) o gesto sem dono ficou na memória`);
    if (caso === 'a mesma conta, noutra sessão') {
      // Sem troca de conta, quem tira o gravado do APARELHO é o carimbo (a troca grava as preferências por si).
      assert.equal(JSON.parse(m.ap.dados.get(PREFERENCES_KEY)).presencaWmeDesligar, undefined,
        'o gesto sem dono ficou no aparelho, relido a cada resposta da API');
    }
  }
});
