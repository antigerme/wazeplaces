// O "Sair", a conta dona dos dados do aparelho e as VÁRIAS ABAS (auditoria de
// 2026-09-29, R4-5: A1, A2, A3, A4, A7, A11 e as preferências de fábrica; é
// também o O7 do R4-2, o mesmo A2 visto pelo placar).
//
// O harness roda as funções DE VERDADE, fatiadas do app.js (e do presenca.js):
// o que o teste não fornece vira um "buraco negro" que aceita qualquer chamada
// e anota o nome (`h.chamou`) — a função pode crescer sem o teste quebrar por
// detalhe, e o que importa pro caso é fornecido e conferido. O ARMAZENAMENTO é
// sempre fornecido, e espionado: "não grava nada" se mede contando escritas.
// Cada teste foi visto REPROVANDO com o conserto desfeito (as sabotagens estão
// no relatório do lote).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP = ler('js/app.js');
const APP_SEM = semComentario(APP);
const PRESENCA_SEM = semComentario(ler('js/presenca.js'));
const I18N = ler('js/i18n.js');
const HTML = ler('index.src.html');

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

// O armazenamento de UMA aba, espionado. `escritas` é tudo que ela gravou ou
// apagou — é por aqui que "não grava nada" se mede.
function aparelho(inicial = {}) {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const escritas = [];
  const localStorage = {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { escritas.push('grava:' + k); dados.set(k, String(v)); },
    removeItem: (k) => { escritas.push('apaga:' + k); dados.delete(k); },
  };
  const safeLS = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
  return { dados, escritas, localStorage, safeLS, ler: (k) => JSON.parse(dados.get(k)) };
}

const TOKEN = 'waze_session_token';
const CONTA_KEY = constante('CONTA_KEY');
const STATS_KEY = constante('STATS_KEY');
const PREFERENCES_KEY = constante('PREFERENCES_KEY');

// ═══ A1 · o "Sair" numa aba chega às outras ═══════════════════════════════════

function montarDecisao({ guardado = {}, naMemoria = true, autenticado = true, appNaTela = true, perguntando = false } = {}) {
  const ap = aparelho(guardado);
  const log = [];
  const deps = {
    safeLS: ap.safeLS, localStorage: ap.localStorage, CONTA_KEY, STATS_KEY, PREFERENCES_KEY,
    API: { temSessaoNaMemoria: () => naMemoria },
    AppState: { authenticated: autenticado },
    document: { getElementById: (id) => (id === 'appScreen'
      ? { classList: { contains: (c) => (c === 'hidden' ? !appNaTela : false) } } : null) },
    extPerguntando: perguntando,
    handleLogout: (o) => log.push(['sair', o]),
    relerPlacarDeOutraAba: () => log.push('placar'),
    relerPreferenciasDeOutraAba: () => log.push('preferencias'),
  };
  const h = montar(['sincronizarComOutraAba', 'aoSairEmOutraAba'], deps);
  return { h, log, ap };
}
const SAIU = ['sair', { porOutraAba: true }];

test('A1: o "Sair" noutra aba (token E conta fora do aparelho) encerra esta — sem a sessão de quem saiu', () => {
  // O aviso da CONTA (o token já tinha saído antes, na mesma ordem em que a
  // outra aba gravou).
  let m = montarDecisao();
  m.h.sincronizarComOutraAba(CONTA_KEY);
  assert.deepEqual(m.log, [SAIU], 'esta aba seguiu logada depois do "Sair" da outra');
  // Sem conta guardada (a entrada pela extensão antiga, antes do perfil): decide
  // o aviso do TOKEN.
  m = montarDecisao();
  m.h.sincronizarComOutraAba(TOKEN);
  assert.deepEqual(m.log, [SAIU]);
  // A outra aba limpou o armazenamento inteiro.
  m = montarDecisao();
  m.h.sincronizarComOutraAba(null);
  assert.deepEqual(m.log, [SAIU], 'o armazenamento limpo noutra aba não encerrou esta');
  // Esta só perguntava à extensão (a abertura, ou a renovação de uma queda): a
  // resposta traria uma sessão NOVA por cima do "Sair".
  m = montarDecisao({ naMemoria: false, autenticado: false, appNaTela: false, perguntando: true });
  m.h.sincronizarComOutraAba(CONTA_KEY);
  assert.deepEqual(m.log, [SAIU], 'a pergunta à extensão em voo desfaria o "Sair" da outra aba');
});

test('A1: CONTROLES — a QUEDA noutra aba, a entrada nova e a aba já na tela de entrada não encerram nada', () => {
  // A queda tira o token e DEIXA a conta: é a conta que separa os dois.
  let m = montarDecisao({ guardado: { [CONTA_KEY]: { id: '111', s: 'x' } } });
  m.h.sincronizarComOutraAba(TOKEN);
  assert.deepEqual(m.log, [], 'a QUEDA da sessão noutra aba foi tratada como "Sair" (os dados da mesma pessoa sairiam)');
  // A outra aba já entrou de novo (renovação, ou outra pessoa): há token.
  m = montarDecisao({ guardado: { [TOKEN]: 'tok-novo' } });
  m.h.sincronizarComOutraAba(CONTA_KEY);
  assert.deepEqual(m.log, []);
  // Esta aba não tinha o que encerrar (já estava na tela de entrada).
  m = montarDecisao({ naMemoria: false, autenticado: false, appNaTela: false });
  m.h.sincronizarComOutraAba(CONTA_KEY);
  assert.deepEqual(m.log, [], 'a aba que só mostrava a tela de entrada ganhou um "Sair" que não era dela');
  // Chave alheia não decide nada.
  m = montarDecisao();
  m.h.sincronizarComOutraAba('waze_places_lang');
  assert.deepEqual(m.log, []);
});

test('A1/A2: o aviso do placar e o das preferências releem cada um o seu — e a limpeza total não relê o que já saiu', () => {
  let m = montarDecisao({ guardado: { [TOKEN]: 'tok', [CONTA_KEY]: '{"id":"1"}' } });
  m.h.sincronizarComOutraAba(STATS_KEY);
  m.h.sincronizarComOutraAba(PREFERENCES_KEY);
  assert.deepEqual(m.log, ['placar', 'preferencias']);
  // Limpeza total COM sessão aqui: é o "Sair" — e o placar e as preferências já
  // voltaram ao de fábrica com ele.
  m = montarDecisao();
  m.h.sincronizarComOutraAba(null);
  assert.deepEqual(m.log, [SAIU]);
  // O aviso é ligado no evento do navegador (o `aoGravarEmOutraAba`).
  assert.match(fatiarDe(APP_SEM, 'aoGravarEmOutraAba'), /^\s+sincronizarComOutraAba\(chave\);/m,
    'o aviso da outra aba não passa mais pelo "Sair", pelo placar e pelas preferências');
});

// O `handleLogout` DE VERDADE, nos dois modos. Tudo que ele pode gravar passa
// pelo armazenamento espionado ou por uma função anotada.
function montarSair({ porOutraAba }) {
  const ap = aparelho({ [TOKEN]: 'tok-A', [CONTA_KEY]: '{"id":"111"}', [STATS_KEY]: '{"rejected":3}' });
  const log = [];
  const statsAntes = { read: 1, rejected: 3, skipped: 0 };
  const AppState = {
    authenticated: true, profile: { id: 111 }, stats: statsAntes, filters: { velho: true },
    preferences: { undoEnabled: false, pularGuarda: true, comoFuncionaVisto: true },
    devMode: { unlocked: true, active: true }, history: { _total: {} }, conquistas: { c: {} }, autores: { r: {} },
    pendingAction: null, inFlightActions: 2, sessaoExpiraEm: 1790000000, queue: [{ venueID: 'v1' }],
  };
  const API = {
    sessionToken: 'tok-A', chamadas: [1, 2],
    getSession() { return this.sessionToken; },
    setSession(t) { log.push('setSession:' + t); this.sessionToken = t; if (t) ap.safeLS.set(TOKEN, t); else ap.safeLS.remove(TOKEN); },
    soltarSessao() { log.push('soltou'); this.sessionToken = null; },
    destroySession: (t) => { log.push('destroy:' + t); return Promise.resolve({ success: true }); },
    cancelarPareamento: (c) => { log.push('cancelou:' + c); return Promise.resolve(); },
    setRegion: (r) => { log.push('regiao:' + r); ap.safeLS.set('waze_region', r); },
    setCountry: (c) => { log.push('pais:' + c); ap.safeLS.set('waze_country', c); },
  };
  const deps = {
    safeLS: ap.safeLS, localStorage: ap.localStorage, AppState, API,
    window: { Presenca: { esquecer: (o) => log.push(['presenca', o || null]) } },
    epocaDaSessao: 5, saiuNestaPagina: false, pareamentosEmitidos: new Set(['ABC234']),
    HISTORY_KEY: constante('HISTORY_KEY'), CONQUISTAS_KEY: 'waze_places_conquistas', CHAVE_INSTALL_DISPENSADO: 'waze_places_install_dispensado',
    PERFIL_GATE_KEY: constante('PERFIL_GATE_KEY'), CONTA_KEY, SESSOES_KEY: 'waze_places_sessoes', NASCIMENTO_KEY: 'waze_places_nascimento',
    SAIDA_KEY: 'waze_places_saida',
    pousosDaPagina: new Set(['v9|u9']), pedidosEmAndamento: new Set(['v8|u8']),
    referenciasDoPerfil: { casa: [-23.5, -46.6], trabalho: null }, posicaoGps: { ll: [-23.5, -46.6] },
    avatarPendente: 'foto', avatarFalhou: null, telaPronta: true,
    fecharCamadasAbertas: () => log.push('camadas'), closeModal: (id) => log.push('fechou:' + id),
    resetQueue: () => log.push('fila:' + JSON.stringify(AppState.preferences)),
    filtrosDeFabrica: () => ({ fabrica: true }),
    offlineEsquecer: (o) => log.push(['offline', o || null]),
    esquecerAutores: () => { log.push('autores'); AppState.autores = null; ap.safeLS.remove('waze_places_autores'); },
    esquecerPrazoDaSessao: () => { log.push('prazo'); AppState.sessaoExpiraEm = null; ap.safeLS.remove('waze_places_sessao_expira'); },
    registrarEventoDeSessao: (e) => { log.push('diario:' + e); ap.safeLS.set('waze_places_sessoes', '[]'); },
    saveStats: () => ap.safeLS.set(STATS_KEY, JSON.stringify(AppState.stats)),
    saveFilters: () => ap.safeLS.set('waze_places_filters', '{}'),
    savePreferences: () => ap.safeLS.set(PREFERENCES_KEY, JSON.stringify(AppState.preferences)),
    saveDevMode: () => ap.safeLS.set('waze_places_devmode', '{}'),
    callWithRetry: (fn) => fn(), t: (k) => k, showToast: (m) => log.push('toast:' + m),
  };
  const h = montar(['handleLogout', 'preferenciasDeFabrica'], deps);
  return { h, ap, log, AppState, API, deps, statsAntes };
}

test('A1: na OUTRA aba o "Sair" solta a memória e a tela, e não grava nem apaga NADA no aparelho', async () => {
  const m = montarSair({ porOutraAba: true });
  await m.h.handleLogout({ porOutraAba: true });
  assert.deepEqual(m.ap.escritas, [],
    'DEFEITO: a aba que só soube do "Sair" mexeu no aparelho: ' + m.ap.escritas.join(' '));
  for (const proibido of ['setSession:null', 'destroy:tok-A', 'diario:saiu', 'regiao:row', 'pais:30']) {
    assert.ok(!m.log.includes(proibido), `a outra aba refez o que era da aba que saiu: ${proibido}`);
  }
  // A memória e a tela: tudo o que o "Sair" solta, solto aqui também.
  assert.equal(m.API.sessionToken, null, 'o token de quem saiu seguiu na memória (o ✕ seguinte sairia com ele)');
  assert.ok(m.log.includes('soltou'));
  assert.equal(m.AppState.authenticated, false);
  assert.equal(m.AppState.profile, null);
  assert.deepEqual(m.AppState.stats, { read: 0, rejected: 0, skipped: 0 });
  assert.notEqual(m.AppState.stats, m.statsAntes, 'o placar do gesto em voo não pode ser o de quem entrar depois');
  assert.deepEqual(m.AppState.preferences, m.h.preferenciasDeFabrica());
  assert.deepEqual([m.AppState.history, m.AppState.conquistas, m.AppState.autores, m.AppState.sessaoExpiraEm], [null, null, null, null]);
  assert.deepEqual([m.deps.referenciasDoPerfil, m.deps.posicaoGps], [null, null], 'a casa de quem saiu ficou na memória');
  assert.deepEqual([m.deps.pousosDaPagina.size, m.deps.pedidosEmAndamento.size], [0, 0]);
  assert.equal(m.deps.saiuNestaPagina, true, 'voltar a esta aba relogaria pela extensão, desfazendo o "Sair"');
  assert.equal(m.deps.epocaDaSessao, 6, 'resposta em voo desta aba gravaria depois do "Sair"');
  // O que fica aberto por cima fecha; o tempo real da conversa para; a
  // varredura do offline para — sem tocar no que é do aparelho.
  assert.ok(m.log.includes('camadas') && !m.log.includes('fechou:logoutModal'));
  assert.deepEqual(m.log.find((x) => Array.isArray(x) && x[0] === 'presenca'), ['presenca', { soMemoria: true }]);
  assert.deepEqual(m.log.find((x) => Array.isArray(x) && x[0] === 'offline'), ['offline', { soMemoria: true }]);
  assert.ok(!m.log.includes('autores') && !m.log.includes('prazo'), 'a outra aba apagou (de novo) chaves do aparelho');
  // As preferências voltam ao de fábrica ANTES do `resetQueue` (com o offline
  // ligado, ele abriria a base apagada de novo).
  assert.ok(m.log.includes('fila:' + JSON.stringify(m.h.preferenciasDeFabrica())));
  assert.ok(m.log.includes('cancelou:ABC234'), 'o QR que esta aba mostrava seguiu entrando na conta que saiu');
  assert.ok(m.log.includes('toast:toast.saiuNoutraAba'));
  for (const tela of ['showAuthScreen', 'removeCurrentCardEl', 'dlogApagar', 'esquecerFocoAutor', 'presencaWmeZerar']) {
    assert.ok(m.h.chamou.includes(tela), `a outra aba não passou por ${tela}`);
  }
});

test('A1: CONTROLE — o "Sair" desta aba grava e apaga o aparelho (o espião enxerga escrita)', async () => {
  const m = montarSair({ porOutraAba: false });
  await m.h.handleLogout();
  for (const esperado of ['apaga:' + TOKEN, 'apaga:' + CONTA_KEY, 'grava:' + STATS_KEY, 'grava:' + PREFERENCES_KEY, 'apaga:waze_places_saida']) {
    assert.ok(m.ap.escritas.includes(esperado), `CONTROLE: o "Sair" não fez ${esperado} — o espião está cego`);
  }
  assert.ok(m.log.includes('destroy:tok-A') && m.log.includes('diario:saiu') && m.log.includes('fechou:logoutModal'));
  assert.deepEqual(m.log.find((x) => Array.isArray(x) && x[0] === 'presenca'), ['presenca', null]);
  assert.ok(m.log.includes('toast:toast.loggedOut'));
});

test('A1: o api.js solta a sessão da MEMÓRIA sem tocar no aparelho — e o ✕ seguinte não sai com o token de quem saiu', async () => {
  const dados = new Map(), escritas = [], diario = [], rede = [];
  const ctx = {
    navigator: { language: 'pt', onLine: true },
    document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: {
      getItem: (k) => (dados.has(k) ? dados.get(k) : null),
      setItem: (k, v) => { escritas.push('grava:' + k); dados.set(k, String(v)); },
      removeItem: (k) => { escritas.push('apaga:' + k); dados.delete(k); },
    },
    fetch: async (url, o) => { rede.push(JSON.parse(o.body).sessionToken); return { ok: true, status: 200, json: async () => ({ success: true }) }; },
    console, setTimeout, clearTimeout,
  };
  ctx.window = { __sessaoEvento: (e) => diario.push(e) };
  vm.createContext(ctx);
  vm.runInContext(I18N + '\n' + ler('js/api.js') + '\nthis.API = API;', ctx);
  const API = ctx.API;
  API.setSession('tok-A');
  // A OUTRA aba deu "Sair": o token sai do armazenamento, não da memória desta.
  dados.delete(TOKEN);
  assert.equal(API.getSession(), 'tok-A', 'CONTROLE: a memória desta aba guardava o token (é o defeito medido)');
  escritas.length = 0; diario.length = 0;
  API.soltarSessao();
  assert.deepEqual(escritas, [], 'soltar a sessão da memória mexeu no aparelho');
  assert.deepEqual(diario, [], 'o diário de sessões ganhou um "token-" por cima do "Sair" da outra aba');
  assert.equal(API.temSessaoNaMemoria(), false);
  assert.equal(API.getSession(), null);
  const r = await API.rejectPlace('v1', 'u1');
  assert.equal(r.errorCategory, 'unauthorized');
  assert.deepEqual(rede, [], 'o ✕ saiu com o token de quem saiu');
  // CONTROLE: o `setSession(null)` anota no diário (por isso a outra aba não o usa).
  API.setSession('tok-B'); diario.length = 0;
  API.setSession(null);
  assert.deepEqual(diario, ['token-']);
});

test('A1: a conversa e o offline têm o modo "só memória" — e o de sempre segue apagando o aparelho', async () => {
  for (const soMemoria of [true, false]) {
    const ap = aparelho({ waze_places_chat: '{"instalacao":"x"}' });
    const campo = { value: 'texto que não saiu' };
    const deps = {
      safeLS: ap.safeLS, CHAT_KEY: 'waze_places_chat', presencaDesligar: () => {},
      Presenca: { rascunhos: new Map([['p1', 'rascunho']]), rascunhoDe: 'p1', ultimaPosicao: [1, 2] },
      document: { getElementById: (id) => (id === 'conversaInput' ? campo : null) },
    };
    const p = montar(['presencaEsquecer'], deps, PRESENCA_SEM);
    p.presencaEsquecer(soMemoria ? { soMemoria } : undefined);
    assert.equal(campo.value, '', 'o que ficou digitado seguiu no campo');
    assert.equal(deps.Presenca.rascunhos.size, 0);
    assert.deepEqual(ap.escritas, soMemoria ? [] : ['apaga:waze_places_chat'],
      soMemoria ? 'o "só memória" apagou a chave do chat do aparelho' : 'o esquecer de sempre parou de apagar a chave do chat');
  }
  for (const soMemoria of [true, false]) {
    const ap = aparelho({ waze_places_offline_pousos: '[]' });
    const apagados = [];
    const deps = {
      safeLS: ap.safeLS, offlineEpoca: 3, offlineJanelaServida: 7, offlineUltimoResultado: 'pronto', diagTilesGuardadosQueFalharam: [1],
      OFFLINE_POUSOS_KEY: 'waze_places_offline_pousos', OFFLINE_DB: 'waze_places_offline', OFFLINE_TILES_CACHE: 'waze-places-tiles',
      indexedDB: { deleteDatabase: (n) => apagados.push('base:' + n) },
      window: { caches: true }, caches: { delete: async (n) => apagados.push('cache:' + n) },
    };
    const o = montar(['offlineEsquecer'], deps);
    await o.offlineEsquecer(soMemoria ? { soMemoria } : undefined);
    assert.equal(deps.offlineEpoca, 4, 'a varredura em voo não parou');
    assert.equal(deps.offlineJanelaServida, null);
    if (soMemoria) assert.deepEqual([...ap.escritas, ...apagados], [], 'o "só memória" apagou o aparelho');
    else assert.deepEqual(apagados, ['base:waze_places_offline', 'cache:waze-places-tiles']);
  }
});

// ═══ A2 · o placar e as preferências entre abas ═══════════════════════════════

// DUAS abas sobre o MESMO armazenamento. O navegador avisa a OUTRA aba de cada
// escrita (evento `storage`); aqui o aviso é entregue à mão, na ordem em que o
// navegador o entregaria — ou descartado, no controle.
function armazenamentoCompartilhado(inicial = {}) {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
  const abas = [], pendentes = [];
  return {
    dados, abas,
    para(aba) {
      return {
        getItem: (k) => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => {
          if (aba.noAviso) aba.escreveuNoAviso.push(k);
          dados.set(k, String(v));
          for (const o of abas) if (o !== aba) pendentes.push([o, k]);
        },
        removeItem: (k) => { dados.delete(k); for (const o of abas) if (o !== aba) pendentes.push([o, k]); },
      };
    },
    // Com TETO: uma aba que respondesse ao aviso gravando mandaria outro de
    // volta, e o laço penduraria o teste em vez de reprová-lo (gotcha #19).
    entregar() {
      let n = 0;
      while (pendentes.length) {
        assert.ok(++n <= 200, 'LAÇO: as abas gravam em resposta ao aviso uma da outra (mais de 200 avisos seguidos)');
        const [aba, key] = pendentes.shift();
        aba.noAviso = true;
        try { aba.aoGravarEmOutraAba({ key }); } finally { aba.noAviso = false; }
      }
    },
    descartarAvisos() { pendentes.length = 0; },
    ler: (k) => JSON.parse(dados.get(k)),
  };
}

function abrirAba(comp, { preferencias = { undoEnabled: true, semUndoSeguidas: 0, presenca: true, pularGuarda: false } } = {}) {
  const aba = { escreveuNoAviso: [], desenhou: 0, noAviso: false };
  const localStorage = comp.para(aba);
  const safeLS = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
  const AppState = { authenticated: true, stats: { read: 0, rejected: 0, skipped: 0 }, preferences: { ...preferencias },
    history: null, conquistas: null, autores: null };
  const deps = {
    AppState, localStorage, safeLS, STATS_KEY, PREFERENCES_KEY, CONTA_KEY, DEVMODE_KEY: 'waze_places_devmode',
    HISTORY_KEY: 'waze_places_history', CONQUISTAS_KEY: 'waze_places_conquistas', AUTORES_KEY: 'waze_places_autores',
    preferenciasCarregadas: true, puladosNoInicioDaFila: 0,
    // Os dois com sessão: o token e a conta no aparelho (nenhum "Sair" aqui).
    API: { temSessaoNaMemoria: () => true }, extPerguntando: false,
    aoMudarModoDevEmOutraAba: () => {}, atualizarSeloDeConquista: () => {}, agendarRedesenhoDoHistorico: () => {},
    desenharPlacar: () => { aba.desenhou++; }, updateStats: () => {},
    desenharChavesDePreferencia: () => {}, atualizarSeloDePular: () => {}, atualizarLinhaDoOffline: () => {},
    presencaWme: { ligarNaProxima: false, desligarPendente: true },
    window: { Presenca: { desligar: () => { aba.presencaDesligada = (aba.presencaDesligada || 0) + 1; }, renderPilula: () => {} } },
    offlineEsquecer: (o) => { aba.offlineSoltou = o; },
    handleLogout: () => { aba.saiu = true; },
  };
  const nomes = ['aoGravarEmOutraAba', 'sincronizarComOutraAba', 'aoSairEmOutraAba', 'relerPlacarDeOutraAba', 'placarGuardado',
    'relerPreferenciasDeOutraAba', 'lerPreferenciasGuardadas', 'preferenciasDeFabrica', 'saveStats', 'savePreferences',
    'descontarGestoSemSessao', 'puladosNestaFila', 'presencaLigada'];
  const fonte = APP_SEM + '\n' + fatiarDe(PRESENCA_SEM, 'presencaLigada');
  Object.assign(aba, montar(nomes, deps, fonte), { AppState, deps });
  comp.abas.push(aba);
  return aba;
}
const sessaoNoAparelho = { [TOKEN]: 'tok', [CONTA_KEY]: { id: '1', s: 'x' } };
// Um ✕ confirmado, como o `handleReject` faz: +1 no placar e grava INTEIRO.
const rejeitar = (aba) => { aba.AppState.stats.rejected++; aba.saveStats(); };

test('A2 (O7): 3 ✕ numa aba e 1 na outra — o placar gravado diz 4, como o Histórico', () => {
  const comp = armazenamentoCompartilhado(sessaoNoAparelho);
  const A = abrirAba(comp), B = abrirAba(comp);
  for (let i = 0; i < 3; i++) { rejeitar(A); comp.entregar(); }
  rejeitar(B);
  comp.entregar();
  assert.equal(comp.ler(STATS_KEY).rejected, 4, 'DEFEITO: a aba B gravou o placar VELHO por cima — os 3 ✕ da aba A sumiram');
  assert.equal(A.AppState.stats.rejected, 4, 'a aba A não mostra o ✕ da B');
  assert.ok(B.desenhou >= 3, 'o placar relido não foi redesenhado');
  assert.deepEqual([...A.escreveuNoAviso, ...B.escreveuNoAviso], [], 'uma aba GRAVOU em resposta ao aviso da outra (laço)');
});

test('A2: CONTROLE — sem o aviso do navegador a perda acontece (o teste mede o que diz medir)', () => {
  const comp = armazenamentoCompartilhado(sessaoNoAparelho);
  const A = abrirAba(comp), B = abrirAba(comp);
  for (let i = 0; i < 3; i++) rejeitar(A);
  comp.descartarAvisos();
  rejeitar(B);
  assert.equal(comp.ler(STATS_KEY).rejected, 1);
});

test('A2: relido NO MESMO objeto — o desconto de uma decisão em voo (K7) ainda acha o placar do gesto', () => {
  const comp = armazenamentoCompartilhado(sessaoNoAparelho);
  const A = abrirAba(comp), B = abrirAba(comp);
  rejeitar(B);
  const placarDoGesto = B.AppState.stats;          // o ✕ de B, ainda no ar
  comp.entregar();
  rejeitar(A); rejeitar(A);
  comp.entregar();                                  // B relê o 3 que A gravou
  assert.equal(B.AppState.stats, placarDoGesto, 'DEFEITO: a releitura trocou o objeto — o placar do gesto ficou órfão');
  B.descontarGestoSemSessao('rejected', placarDoGesto, 1);   // a decisão de B não pousou
  comp.entregar();
  assert.equal(comp.ler(STATS_KEY).rejected, 2, 'o desconto da decisão em voo não chegou ao placar gravado');
  assert.equal(A.AppState.stats.rejected, 2);
});

test('A2: o placar que chega da outra aba só se DESENHA — o aviso do Desfazer é da aba que fez o gesto', () => {
  const ap = aparelho({ [STATS_KEY]: { read: 0, rejected: 30, skipped: 0 } });
  const log = [];
  const deps = {
    localStorage: ap.localStorage, STATS_KEY, puladosNoInicioDaFila: 0,
    AppState: { stats: { read: 0, rejected: 29, skipped: 0 } }, Treino: { ativo: false },
    checkUndoGateUnlock: () => log.push('gate'), setCount: () => log.push('conta'), updatePendingCount: () => log.push('restam'),
    document: { getElementById: () => ({}) },
  };
  const h = montar(['relerPlacarDeOutraAba', 'placarGuardado', 'desenharPlacar', 'updateStats'], deps);
  h.relerPlacarDeOutraAba();
  assert.equal(deps.AppState.stats.rejected, 30);
  assert.deepEqual(log, ['conta', 'conta', 'conta', 'restam']);
  assert.ok(!log.includes('gate'), 'a aba que só RELEU o placar comemorou a cota (a do gesto já comemorou)');
  // CONTROLE: o gesto (o `updateStats`) avalia a cota, como sempre.
  log.length = 0;
  h.updateStats();
  assert.equal(log[0], 'gate');
});

test('A2: os pulados DA OUTRA aba não contam como pulados DESTA fila (o "Tudo limpo!" daqui)', () => {
  const comp = armazenamentoCompartilhado(sessaoNoAparelho);
  const A = abrirAba(comp), B = abrirAba(comp);
  A.AppState.stats.skipped += 2; A.saveStats();
  comp.entregar();
  assert.equal(B.AppState.stats.skipped, 2, 'o placar de B não viu os pulados de A');
  assert.equal(B.puladosNestaFila(), 0, 'DEFEITO: a fila de B termina em "Fim da fila" pelos pulados da OUTRA aba');
  B.AppState.stats.skipped++; B.saveStats();
  assert.equal(B.puladosNestaFila(), 1);
});

test('A2: preferência escolhida numa aba NÃO é desfeita pela ação comum da outra', () => {
  const comp = armazenamentoCompartilhado(sessaoNoAparelho);
  const A = abrirAba(comp), B = abrirAba(comp);
  A.AppState.preferences.pularGuarda = true; A.savePreferences();
  comp.entregar();
  // Uma janela do Desfazer que expira em B grava as preferências inteiras.
  B.AppState.preferences.semUndoSeguidas++; B.savePreferences();
  comp.entregar();
  assert.equal(comp.ler(PREFERENCES_KEY).pularGuarda, true,
    'DEFEITO: um ✕ na aba B desfez o "Pular guarda o pedido" que a pessoa acabou de ligar na A');
  assert.equal(B.AppState.preferences.pularGuarda, true, 'o ↑ da aba B segue sem guardar');
  assert.equal(A.AppState.preferences.semUndoSeguidas, 1);
  // CONTROLE: sem o aviso, a escolha some.
  const c = armazenamentoCompartilhado(sessaoNoAparelho);
  const A2 = abrirAba(c), B2 = abrirAba(c);
  A2.AppState.preferences.pularGuarda = true; A2.savePreferences();
  c.descartarAvisos();
  B2.AppState.preferences.semUndoSeguidas++; B2.savePreferences();
  assert.equal(c.ler(PREFERENCES_KEY).pularGuarda, false);
});

test('A2: "Ver quem está no app" desligado numa aba — a outra fecha a conexão e não volta a mostrar a pessoa no WME', () => {
  const comp = armazenamentoCompartilhado(sessaoNoAparelho);
  const A = abrirAba(comp), B = abrirAba(comp);
  B.deps.presencaWme.ligarNaProxima = true;          // B ia ligar a visibilidade na próxima ação
  A.AppState.preferences.presenca = false; A.AppState.preferences.presencaOffEm = 1; A.savePreferences();
  comp.entregar();
  assert.equal(B.presencaLigada(), false, 'a aba B segue achando que a presença está ligada');
  assert.equal(B.deps.presencaWme.ligarNaProxima, false, 'a próxima ação de B mandaria `visivel: true` (a pessoa volta ao WME)');
  assert.equal(B.presencaDesligada, 1, 'a conexão do tempo real de B seguiu aberta');
  rejeitar(B); B.savePreferences();                  // a ação de B grava as preferências
  comp.entregar();
  assert.equal(comp.ler(PREFERENCES_KEY).presenca, false, 'DEFEITO: reaberto, o app volta a mostrar a pessoa no WME');
  // Religado na A: a próxima ação da B liga de carona (sem pedido novo).
  A.AppState.preferences.presenca = true; delete A.AppState.preferences.presencaOffEm; A.savePreferences();
  comp.entregar();
  assert.equal(B.presencaLigada(), true);
  assert.equal(B.deps.presencaWme.ligarNaProxima, true);
});

test('A2: o offline desligado numa aba PARA a varredura da outra (sem apagar de novo o aparelho)', () => {
  const comp = armazenamentoCompartilhado(sessaoNoAparelho);
  const A = abrirAba(comp, { preferencias: { undoEnabled: true, presenca: true, offlineDisponivel: true } });
  const B = abrirAba(comp, { preferencias: { undoEnabled: true, presenca: true, offlineDisponivel: true } });
  A.AppState.preferences.offlineDisponivel = false; A.savePreferences();
  comp.entregar();
  assert.deepEqual(B.offlineSoltou, { soMemoria: true }, 'a varredura de B gravaria de novo na base que A apagou');
  // Ligado: nada a parar.
  const c = armazenamentoCompartilhado(sessaoNoAparelho);
  const A2 = abrirAba(c), B2 = abrirAba(c);
  A2.AppState.preferences.offlineDisponivel = true; A2.savePreferences();
  c.entregar();
  assert.equal(B2.offlineSoltou, undefined);
  assert.equal(B2.AppState.preferences.offlineDisponivel, true);
});

test('A2: a leitura é UMA — a abertura e o aviso da outra aba passam pelo `lerPreferenciasGuardadas`', () => {
  assert.match(fatiarDe(APP_SEM, 'loadPreferences'), /^\s+lerPreferenciasGuardadas\(\);/m);
  const r = fatiarDe(APP_SEM, 'relerPreferenciasDeOutraAba');
  assert.match(r, /AppState\.preferences = preferenciasDeFabrica\(\);\s*lerPreferenciasGuardadas\(\);/,
    'a releitura não parte das de fábrica (campo apagado lá ficaria aqui)');
  // Relê só depois da primeira leitura desta aba.
  assert.match(r, /if \(!preferenciasCarregadas\) return;/);
});

// ═══ A3 · quem entra depois de uma queda não herda as escolhas da anterior ════

function montarGate({ prefs, perfilGate = { rank: 5, isStaff: false }, stats = { read: 0, rejected: 0, skipped: 0 } }) {
  const ap = aparelho({ [constante('PERFIL_GATE_KEY')]: perfilGate, [PREFERENCES_KEY]: prefs });
  const toasts = [];
  const deps = {
    safeLS: ap.safeLS, localStorage: ap.localStorage, PREFERENCES_KEY, PERFIL_GATE_KEY: constante('PERFIL_GATE_KEY'),
    AppState: { preferences: { ...prefs }, stats: { ...stats }, profile: null, devMode: { active: false } },
    preferenciasCarregadas: true, UNDO_GATE_BASE: constante('UNDO_GATE_BASE'),
    showToast: (m) => toasts.push(m), t: (k) => k, dispararConfeteNaFila: () => {}, abrirPreferenciaDoUndo: () => {},
  };
  const h = montar(['esquecerEscolhasDaContaAnterior', 'savePreferences', 'guardarPerfilDoPortao', 'perfilDoPortao',
    'getUndoUnlockThreshold', 'getUndoTreatedCount', 'undoGateAtingido', 'initUndoGateSeen', 'checkUndoGateUnlock', 'canDisableUndo'], deps);
  return { h, ap, toasts, deps };
}
// O aparelho da conta A (L6 que desligou o Desfazer e já viu tudo), cuja sessão CAIU.
const PREFS_DE_A = { undoEnabled: false, presenca: false, pularGuarda: true, offlineDisponivel: true, undoGateSeen: true,
  dicaDesfazerVista: true, comoFuncionaVisto: true, consequenciaVista: { reject: true, read: true }, semUndoSeguidas: 19 };

test('A3: B entra no aparelho de A — o Desfazer volta, as marcas de "já viu" saem, e a cota de B é comemorada', () => {
  const m = montarGate({ prefs: PREFS_DE_A });
  m.h.esquecerEscolhasDaContaAnterior();
  const p = m.deps.AppState.preferences;
  assert.equal(p.undoEnabled, true, 'DEFEITO: B herdou o Desfazer DESLIGADO que a cota de A permitiu');
  for (const marca of ['undoGateSeen', 'dicaDesfazerVista', 'comoFuncionaVisto', 'consequenciaVista']) {
    assert.equal(p[marca], undefined, `B herdou a marca "${marca}" (ele não viu nada disso)`);
  }
  assert.equal(p.semUndoSeguidas, 0, 'a dica "você nunca desfaz" sairia pra B pela contagem de A');
  // As escolhas que não escrevem no Waze em nome de ninguém ficam: a presença
  // desligada (erra pro lado da privacidade) e o offline (recurso do aparelho).
  assert.deepEqual([p.presenca, p.offlineDisponivel], [false, true], 'a troca de conta levou escolhas do aparelho');
  assert.equal(m.ap.dados.has(constante('PERFIL_GATE_KEY')), false, 'o nível de A seguiu valendo pra cota de B');
  assert.equal(m.ap.ler(PREFERENCES_KEY).undoEnabled, true, 'a troca não foi gravada');
  // O perfil de B (L2) chega: a linha de base é decidida pra ELE, e cruzar a
  // cota dele (30) é comemorado — com a janela do Desfazer até lá.
  m.h.guardarPerfilDoPortao({ rank: 1, isStaff: false });
  assert.equal(p.undoGateSeen, false);
  m.deps.AppState.stats.rejected = 29;
  assert.equal(p.undoEnabled === false && m.h.canDisableUndo(), false, 'B agiria sem a janela do Desfazer');
  m.deps.AppState.stats.rejected = 30;
  m.h.checkUndoGateUnlock();
  assert.deepEqual(m.toasts, ['toast.undoUnlocked'], 'B cruzou a PRÓPRIA cota sem o aviso de que o Desfazer ficou opcional');
  assert.equal(p.undoEnabled === false && m.h.canDisableUndo(), false, 'o 31º de B sairia sem janela, sem ele ter desligado nada');
});

test('A3: CONTROLE — sem esquecer as escolhas de A, B cruza a cota calado e age sem janela (o defeito medido)', () => {
  const m = montarGate({ prefs: PREFS_DE_A });
  m.h.guardarPerfilDoPortao({ rank: 1, isStaff: false });
  m.deps.AppState.stats.rejected = 30;
  m.h.checkUndoGateUnlock();
  assert.deepEqual(m.toasts, []);
  assert.equal(m.deps.AppState.preferences.undoEnabled === false && m.h.canDisableUndo(), true);
});

test('A3: a troca de conta passa pelo esquecer das escolhas (e a mesma conta voltando, não)', () => {
  const troca = fatiarDe(APP_SEM, 'esquecerOutraConta');
  assert.match(troca, /^\s+esquecerEscolhasDaContaAnterior\(\);/m, 'a troca de conta não esquece as escolhas de A');
  // Quem chama a troca é SÓ a conta diferente (conferido em test/conta).
  assert.match(fatiarDe(APP_SEM, 'aoConhecerConta'), /if \(antes && antes\.id && String\(antes\.id\) !== id\) esquecerOutraConta\(id\);/);
});

// O ↑ de verdade (`handleSkip`) depois da troca de conta, com o card na tela e a
// aba Preferências aberta: o executor é rodado à mão (a janela do Desfazer vence).
function montarPularDepoisDaTroca() {
  const ap = aparelho({ [PREFERENCES_KEY]: PREFS_DE_A });
  const estrelas = [], executores = [];
  const selo = { attrs: { 'data-i18n': 'card.stamp.skipGuarda' }, setAttribute(k, v) { this.attrs[k] = v; } };
  const card = { querySelector: (sel) => (sel === '.swipe-stamp-up span[data-i18n]' ? selo : null) };
  const chaves = Object.fromEntries(['prefUndoEnabled', 'prefPularGuarda', 'prefPresenca', 'prefOfflineDisponivel']
    .map((id) => [id, { checked: id === 'prefPularGuarda' || id === 'prefOfflineDisponivel', disabled: false }]));
  const deps = {
    safeLS: ap.safeLS, localStorage: ap.localStorage, PREFERENCES_KEY, PERFIL_GATE_KEY: constante('PERFIL_GATE_KEY'),
    preferenciasCarregadas: true, epocaDaSessao: 0, Treino: { ativo: false }, acoesTravadas: () => false,
    AppState: { preferences: { ...PREFS_DE_A }, currentPlace: { venueID: 'v1', updateRequestID: 'u1' }, queue: [], stats: { skipped: 0 } },
    scheduleAction: (tipo, place, executor) => executores.push(executor),
    API: { getRegion: () => 'row', guardarPedido: async (...a) => { estrelas.push(a); return { success: true }; } },
    callWithRetry: (fn) => fn(), cardDaFrente: () => card, applyI18n: () => {},
    document: { getElementById: (id) => chaves[id] || null },
  };
  const h = montar(['esquecerEscolhasDaContaAnterior', 'savePreferences', 'handleSkip', 'atualizarSeloDePular',
    'desenharChavesDePreferencia'], deps);
  return { h, ap, estrelas, executores, selo, chaves, deps };
}

test('A3: quem entra NÃO herda o "Pular guarda o pedido" — o ↑ dele não grava a estrela no Waze, no nome dele', async () => {
  const m = montarPularDepoisDaTroca();
  m.h.esquecerEscolhasDaContaAnterior();
  assert.equal(m.deps.AppState.preferences.pularGuarda, false, 'a escolha de A de guardar no ↑ ficou pra B');
  assert.equal(m.ap.ler(PREFERENCES_KEY).pularGuarda, false, 'a troca não foi gravada');
  // O que MOSTRA a escolha diz a mesma coisa: o selo do ↑ e a chave da aba Preferências.
  assert.equal(m.selo.attrs['data-i18n'], 'card.stamp.skip', 'o selo do ↑ seguiu dizendo "Pular ⭐"');
  assert.equal(m.chaves.prefPularGuarda.checked, false, 'a chave da aba Preferências seguiu ligada');
  assert.equal(m.chaves.prefUndoEnabled.checked, true, 'a chave do Desfazer seguiu desligada (a escolha de A)');
  assert.equal(m.chaves.prefOfflineDisponivel.checked, true, 'a chave do offline foi desligada (ele é recurso do aparelho, e fica)');
  m.h.handleSkip();
  await m.executores[0]();
  assert.deepEqual(m.estrelas, [], 'DEFEITO: o ↑ de B gravou a estrela no Waze, no nome dele, por uma escolha de A');
});

test('A3: CONTROLE — sem esquecer as escolhas de A, o ↑ de B grava a estrela (o harness enxerga a escrita)', async () => {
  const m = montarPularDepoisDaTroca();
  m.h.handleSkip();
  await m.executores[0]();
  assert.deepEqual(m.estrelas, [['v1', 'u1', true, 'row']]);
});

// ═══ A4 · a casa da conta anterior não ordena a fila de quem entra ═══════════

test('A4: a troca de conta e a QUEDA da sessão soltam casa, trabalho e a posição do GPS', () => {
  const casa = () => ({ casa: [-10, -40], trabalho: [-11, -41] });
  const base = () => ({
    referenciasDoPerfil: casa(), posicaoGps: { ll: [-10, -40] }, safeLS: aparelho().safeLS,
    AppState: { stats: {}, preferences: {}, pendingAction: null, authenticated: true, profile: { id: 1 } },
    filaAtravessouSessao: false, epocaDaSessao: 0,
  });
  const troca = montar(['esquecerOutraConta', 'referenciaDaOrdem'], base());
  troca.esquecerOutraConta('222');
  assert.deepEqual([troca.deps.referenciasDoPerfil, troca.deps.posicaoGps], [null, null],
    'DEFEITO: a casa de A ordena a fila de B (troca de conta)');
  assert.equal(troca.referenciaDaOrdem('casa'), null);
  const queda = montar(['derrubarSessao', 'referenciaDaOrdem'], base());
  queda.derrubarSessao('srv.err.sessionExpired', { depois: () => {} });
  assert.deepEqual([queda.deps.referenciasDoPerfil, queda.deps.posicaoGps], [null, null],
    'DEFEITO: a casa de quem estava ficou pra quem entrar depois da queda');
  // CONTROLE: a referência existia (o teste mede alguma coisa).
  assert.deepEqual(montar(['referenciaDaOrdem'], base()).referenciaDaOrdem('casa'), [-10, -40]);
});

// ═══ a QUEDA numa aba não apaga do aparelho a sessão NOVA da outra ═══════════

// UMA aba: `naMemoria` é o token que ELA carrega; o aparelho é o que a outra
// deixou. O api.js roda INTEIRO numa VM sobre o mesmo armazenamento (espionado),
// e o diário de sessões é o de verdade — alimentado também pelo gancho do
// `setSession`, como no app.
const SESSAO_KEY = constante('SESSAO_KEY');
const SESSOES_KEY = constante('SESSOES_KEY');
function montarQueda({ naMemoria, guardado }) {
  const dados = new Map(Object.entries(guardado).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const escritas = [];
  const localStorage = {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { escritas.push('grava:' + k); dados.set(k, String(v)); },
    removeItem: (k) => { escritas.push('apaga:' + k); dados.delete(k); },
  };
  const ctx = { navigator: { language: 'pt', onLine: true }, document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage, console, setTimeout, clearTimeout, window: {} };
  vm.createContext(ctx);
  vm.runInContext(I18N + '\n' + ler('js/api.js') + '\nthis.API = API; this.safeLS = safeLS;', ctx);
  ctx.API.sessionToken = naMemoria;   // a cópia da MEMÓRIA desta aba (o `setSession` gravaria no aparelho)
  const anel = [], log = [];
  const AppState = { authenticated: true, profile: { id: 4242 }, sessaoExpiraEm: 1780000000, pendingAction: null };
  const deps = {
    safeLS: ctx.safeLS, API: ctx.API, AppState, epocaDaSessao: 0, referenciasDoPerfil: null, posicaoGps: null,
    SESSAO_KEY, SESSOES_KEY, SESSOES_TETO: constante('SESSOES_TETO'), NASCIMENTO_KEY: constante('NASCIMENTO_KEY'),
    dfato: (k, d) => anel.push({ k, ...d }),
    entrarPelaExtensao: () => { log.push('extensao'); return new Promise(() => {}); },
  };
  const h = montar(['sessaoDestaAbaEhAGuardada', 'derrubarSessao', 'registrarEventoDeSessao', 'lerDiarioDeSessoes',
    'esquecerPrazoDaSessao', 'diagSessao'], deps);
  ctx.window.__sessaoEvento = (e, d) => h.registrarEventoDeSessao(e, d);
  return { h, dados, escritas, anel, log, AppState, API: ctx.API, diario: () => JSON.parse(dados.get(SESSOES_KEY) || '[]') };
}
// O diário que a OUTRA aba deixou: entrou há dois dias, viu a sessão cair há
// dez minutos e entrou de novo pela extensão.
const AGORA = Date.now(), HORA = 3600e3, MIN = 60e3;
const DIARIO_DA_OUTRA = [
  { t: AGORA - 48 * HORA, e: 'token+', via: 'cookies' },
  { t: AGORA - 10 * MIN, e: 'caiu', motivo: 'srv.err.sessionExpired', prazo: 1780000000, faltavamH: 100 },
  { t: AGORA - 10 * MIN, e: 'token-' },
  { t: AGORA - 10 * MIN + 1800, e: 'token+', via: 'extensao' },
];

test('queda só desta aba: com o token NOVO da outra no aparelho, a queda daqui não o apaga — nem anota outra queda', () => {
  const m = montarQueda({ naMemoria: 'tok-velho', guardado: {
    waze_session_token: 'tok-novo-da-outra', [SESSAO_KEY]: '1790000000', [SESSOES_KEY]: DIARIO_DA_OUTRA } });
  m.h.derrubarSessao('srv.err.sessionExpired');
  assert.equal(m.dados.get('waze_session_token'), 'tok-novo-da-outra',
    'DEFEITO: a queda desta aba (token VELHO na memória) apagou do aparelho o token NOVO da outra — que cai na entrada ao recarregar');
  assert.deepEqual(m.diario(), DIARIO_DA_OUTRA, 'o diário de sessões (do aparelho) ganhou uma queda que a outra aba já tinha anotado');
  assert.equal(m.dados.get(SESSAO_KEY), '1790000000', 'o prazo da sessão da outra aba saiu do aparelho');
  assert.deepEqual(m.escritas, [], 'a queda só desta aba mexeu no aparelho: ' + m.escritas.join(' '));
  // O ciclo da sessão da outra segue EM CURSO. Com a segunda queda anotada, ele
  // fechava em minutos — uma sessão curta que não existiu, que é o que a
  // sentinela `sessaoCaiCedo` conta.
  assert.equal(m.h.diagSessao().ciclos.at(-1).fim, 'em curso', 'o diário deu por encerrada a sessão viva da outra aba');
  // A memória e a tela DESTA aba, sim: tudo o que a queda solta.
  assert.equal(m.API.temSessaoNaMemoria(), false, 'o token velho seguiu na memória desta aba');
  assert.equal(m.AppState.authenticated, false);
  assert.equal(m.AppState.sessaoExpiraEm, null, 'a contagem do prazo da sessão que caiu seguiu na tela');
  assert.deepEqual(m.log, ['extensao'], 'a renovação pela extensão não foi tentada');
  assert.deepEqual(m.anel.at(-1), { k: 'sessao.caiu', motivo: 'srv.err.sessionExpired', soNestaAba: true },
    'o anel desta aba não diz que a queda foi só dela');
});

test('queda só desta aba: a outra já derrubou (e ainda não entrou de novo) — e com a memória vazia a pergunta não lê o aparelho', () => {
  const jaCaiu = DIARIO_DA_OUTRA.slice(0, 3);
  let m = montarQueda({ naMemoria: 'tok-velho', guardado: { [SESSOES_KEY]: jaCaiu } });
  m.h.derrubarSessao('srv.err.sessionExpired');
  assert.deepEqual(m.diario(), jaCaiu, 'a MESMA queda entrou duas vezes no diário (uma por aba)');
  assert.deepEqual(m.escritas, []);
  assert.equal(m.API.temSessaoNaMemoria(), false);
  // Sem token na memória, a sessão guardada não é desta aba — pelo `getSession`,
  // a pergunta iria buscar o do aparelho e responderia "é".
  m = montarQueda({ naMemoria: null, guardado: { waze_session_token: 'tok-da-outra' } });
  m.h.derrubarSessao('srv.err.sessionExpired');
  assert.equal(m.dados.get('waze_session_token'), 'tok-da-outra', 'a aba sem sessão apagou a sessão guardada da outra');
});

test('queda só desta aba: CONTROLE — a sessão desta aba é a guardada, e a queda apaga o aparelho como sempre', () => {
  const m = montarQueda({ naMemoria: 'tok-A', guardado: {
    waze_session_token: 'tok-A', [SESSAO_KEY]: '1790000000', [SESSOES_KEY]: [DIARIO_DA_OUTRA[0]] } });
  m.h.derrubarSessao('srv.err.cookiesExpired');
  assert.equal(m.dados.has('waze_session_token'), false, 'CONTROLE: o token morto ficou no aparelho (o espião não vê a queda)');
  assert.deepEqual(m.diario().map((l) => l.e), ['token+', 'caiu', 'token-'], 'CONTROLE: a queda não chegou ao diário');
  assert.equal(m.diario()[1].prazo, 1780000000, 'o prazo que morreu não chegou ao registro');
  assert.equal(m.dados.has(SESSAO_KEY), false, 'o prazo da sessão que morreu ficou no aparelho');
  assert.equal(m.h.diagSessao().ciclos.at(-1).fim, 'caiu');
  assert.equal(m.anel.at(-1).soNestaAba, undefined);
});

// ═══ A7 · o código de pareamento não é resgatado duas vezes ══════════════════

function montarResgate({ dialogoNaTela = true } = {}) {
  let soltar;
  const pedidos = [];
  const deps = {
    resgateEmVoo: false,
    API: { resgatarPareamento: (c) => { pedidos.push(c); return new Promise((ok) => { soltar = ok; }); } },
    document: { getElementById: (id) => (id === 'pairEnterModal'
      ? { classList: { contains: (c) => (c === 'hidden' ? !dialogoNaTela : false) } } : null) },
  };
  const h = montar(['resgatarPareamento'], deps);
  return { h, pedidos, soltar: (r) => soltar(r), deps };
}

test('A7: Enter duplo (ou Enter + "Entrar") manda UM resgate — e o segundo espera o primeiro', async () => {
  const m = montarResgate();
  const p1 = m.h.resgatarPareamento('ABC234');
  const p2 = m.h.resgatarPareamento('ABC234');
  assert.deepEqual(m.pedidos, ['ABC234'], 'DEFEITO: o mesmo código saiu duas vezes (duas sessões, duas cargas)');
  assert.equal(await p2, false);
  m.soltar({ success: true, sessionToken: 'tok', conta: '111' });
  assert.equal(await p1, true);
  assert.equal(m.deps.resgateEmVoo, false, 'a trava ficou presa depois do resgate');
  // Falha também solta a trava (o código digitado errado pode ser corrigido).
  const f = montarResgate();
  const pf = f.h.resgatarPareamento('XYZ789');
  f.soltar({ success: false, errorKey: 'srv.err.pairInvalid' });
  assert.equal(await pf, false);
  assert.equal(f.deps.resgateEmVoo, false);
});

test('A7: o Enter que chega DEPOIS de entrar (o diálogo já fechado) não resgata de novo — o link da câmera, sim', async () => {
  const m = montarResgate({ dialogoNaTela: false });
  const r = m.h.resgatarPareamento('ABC234');
  // Conferido ANTES do `await`: o pedido sai no mesmo tique, e com o defeito a
  // promessa ficaria esperando uma resposta que este teste não dá.
  assert.deepEqual(m.pedidos, [], 'o código usado saiu de novo, com o erro indo parar no diálogo fechado');
  assert.equal(await r, false);
  const url = montarResgate({ dialogoNaTela: false });
  const p = url.h.resgatarPareamento('ABC234', { silencioso: true });
  assert.deepEqual(url.pedidos, ['ABC234'], 'o link de pareamento (sem diálogo) parou de entrar');
  url.soltar({ success: true, sessionToken: 'tok' });
  assert.equal(await p, true);
});

// ═══ A11 · o diálogo do "Sair" diz o que ele descarta ════════════════════════

function montarAviso(itens, { dialogoAberto = true } = {}) {
  const ap = aparelho({ waze_places_saida: itens });
  const el = { textContent: 'velho', escondido: true, classList: { toggle(c, v) { if (c === 'hidden') el.escondido = v; } } };
  const deps = {
    safeLS: ap.safeLS, SAIDA_KEY: 'waze_places_saida',
    t: (k, v) => k + (v ? ':' + JSON.stringify(v) : ''),
    document: { getElementById: (id) => (id === 'logoutSaidaAviso' ? el
      : id === 'logoutModal' ? { classList: { contains: (c) => (c === 'hidden' ? !dialogoAberto : false) } } : null) },
    AppState: { authenticated: false, inFlightActions: 0 },
  };
  const h = montar(['desenharAvisoDoSair', 'carregarFilaDeSaida', 'updateInFlightIndicator'], deps);
  return { h, el };
}
const ITEM = (v) => ({ tipo: 'reject', venueID: v, updateRequestID: 'u' + v });

test('A11: com decisões esperando envio, o diálogo do "Sair" diz QUANTAS se perdem (plural por chave)', () => {
  let m = montarAviso([ITEM('v1'), ITEM('v2')]);
  m.h.desenharAvisoDoSair();
  assert.equal(m.el.textContent, 'modal.logout.saidaPlural:{"n":2}');
  assert.equal(m.el.escondido, false, 'DEFEITO: o "Sair" descarta 2 decisões sem dizer');
  m = montarAviso([ITEM('v1')]);
  m.h.desenharAvisoDoSair();
  assert.equal(m.el.textContent, 'modal.logout.saida:{"n":1}', '"1 pedidos" no singular');
  m = montarAviso([]);
  m.h.desenharAvisoDoSair();
  assert.deepEqual([m.el.textContent, m.el.escondido], ['', true], 'sem fila, a frase tem que sumir');
});

test('A11: a fila que muda com o diálogo ABERTO muda a frase (a rede volta, a fila esvazia)', () => {
  const m = montarAviso([], { dialogoAberto: true });
  m.el.textContent = '2 pedidos…'; m.el.escondido = false;
  m.h.updateInFlightIndicator();
  assert.deepEqual([m.el.textContent, m.el.escondido], ['', true], 'a frase seguiu dizendo que algo vai se perder');
  const f = montarAviso([ITEM('v1')], { dialogoAberto: false });
  f.h.updateInFlightIndicator();
  assert.equal(f.el.textContent, 'velho', 'com o diálogo fechado não há o que redesenhar');
  // Abrir o diálogo desenha a frase ANTES de mostrá-lo.
  assert.match(APP_SEM, /\$\('logoutBtn'\)\.addEventListener\('click', \(\) => \{\s*desenharAvisoDoSair\(\);[^\n]*\n\s*openModal\('logoutModal'\);/);
});

test('A11: a frase mora no diálogo do "Sair", nas 4 línguas, com o número de verdade', () => {
  const i = HTML.indexOf('id="logoutModal"');
  const dialogo = HTML.slice(i, HTML.indexOf('id="confirmLogout"', i));
  assert.match(dialogo, /<p id="logoutSaidaAviso" class="hidden [^"]*">/, 'a frase saiu do diálogo do "Sair"');
  for (const chave of ['modal.logout.saida', 'modal.logout.saidaPlural']) {
    const valores = [...I18N.matchAll(new RegExp(`'${chave.replace(/\./g, '\\.')}': '([^']+)'`, 'g'))].map((m) => m[1]);
    assert.equal(valores.length, 4, `${chave}: esperava 4 línguas, achei ${valores.length}`);
    for (const v of valores) assert.match(v, /\{n\}/, `${chave}: a frase não leva o número`);
  }
  assert.equal([...I18N.matchAll(/'toast\.saiuNoutraAba': '/g)].length, 4, 'o aviso da outra aba não está nas 4 línguas');
});

// ═══ as preferências de FÁBRICA são uma só ═══════════════════════════════════

test('preferências de fábrica: o app recém-aberto, o "Sair" e a releitura usam a MESMA função', () => {
  const { preferenciasDeFabrica } = montar(['preferenciasDeFabrica'], {});
  assert.deepEqual(preferenciasDeFabrica(), { undoEnabled: true, semUndoSeguidas: 0, presenca: true, pularGuarda: false });
  assert.notEqual(preferenciasDeFabrica(), preferenciasDeFabrica(), 'um objeto só pra todos: mexer num mexeria no outro');
  const estado = APP_SEM.slice(APP_SEM.indexOf('const AppState = {'), APP_SEM.indexOf('\n};', APP_SEM.indexOf('const AppState = {')));
  assert.match(estado, /^\s+preferences: preferenciasDeFabrica\(\),$/m, 'o app recém-aberto voltou a ter um literal próprio');
  assert.match(fatiarDe(APP_SEM, 'handleLogout'), /^\s+AppState\.preferences = preferenciasDeFabrica\(\);/m,
    'o "Sair" voltou a repor um literal próprio (divergia: sem `semUndoSeguidas` e sem `pularGuarda`)');
  // Nenhum outro literal de preferências no app: é assim que eles divergem.
  assert.doesNotMatch(APP_SEM.replace(fatiarDe(APP_SEM, 'preferenciasDeFabrica'), ''), /preferences\s*[:=]\s*\{/,
    'um literal de preferências apareceu fora da fonte única');
});
