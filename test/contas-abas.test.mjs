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

function montarDecisao({ guardado = {}, naMemoria = true, autenticado = true, appNaTela = true, perguntando = false, perfil = 111 } = {}) {
  const ap = aparelho(guardado);
  const log = [];
  const deps = {
    safeLS: ap.safeLS, localStorage: ap.localStorage, CONTA_KEY, STATS_KEY, PREFERENCES_KEY,
    API: { temSessaoNaMemoria: () => naMemoria, sessionToken: naMemoria ? 'tok-desta' : null },
    AppState: { authenticated: autenticado, profile: perfil ? { id: perfil } : null },
    document: { getElementById: (id) => (id === 'appScreen'
      ? { classList: { contains: (c) => (c === 'hidden' ? !appNaTela : false) } } : null) },
    extPerguntando: perguntando,
    handleLogout: (o) => log.push(['sair', o]),
    relerPlacarDeOutraAba: () => log.push('placar'),
    relerPreferenciasDeOutraAba: () => log.push('preferencias'),
  };
  const h = montar(['sincronizarComOutraAba', 'aoSairEmOutraAba', 'aoEntrarOutraContaEmOutraAba', 'contaSegueNoAparelho',
    'sessaoDestaAbaEhAGuardada'], deps);
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
function montarSair({ tokenNoAparelho = 'tok-A' } = {}) {
  const ap = aparelho({ [TOKEN]: tokenNoAparelho, [CONTA_KEY]: '{"id":"111"}', [STATS_KEY]: '{"rejected":3}' });
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
    esquecerLugar: () => log.push('esqueceu o lugar'),
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
    dlogApagar: (o) => log.push(['dlog', o || null]),
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
    // Qual sessão a OUTRA aba tirou do aparelho (o aviso do token, R8-1-03):
    // `null` é "não se sabe". Quem testa o "Sair" de lá diz qual foi.
    tokenTiradoPorOutraAba: null,
  };
  const h = montar(['handleLogout', 'preferenciasDeFabrica', 'sessaoDestaAbaEhAGuardada'], deps);
  return { h, ap, log, AppState, API, deps, statsAntes };
}

test('A1: na OUTRA aba o "Sair" solta a memória e a tela, e não grava nem apaga NADA no aparelho', async () => {
  const m = montarSair();
  // A outra aba tirou do aparelho a MESMA sessão desta (o aviso do token disse
  // qual): ela já a apagou no servidor, e daqui nada sai (R8-1-03).
  m.deps.tokenTiradoPorOutraAba = 'tok-A';
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
  // O que o modo dev guardou no aparelho, a aba que saiu apagou: aqui, só a memória.
  assert.deepEqual(m.log.find((x) => Array.isArray(x) && x[0] === 'dlog'), ['dlog', { soMemoria: true }],
    'a outra aba apagou (de novo) a base do diagnóstico no aparelho');
  assert.ok(!m.log.includes('autores') && !m.log.includes('prazo'), 'a outra aba apagou (de novo) chaves do aparelho');
  // As preferências voltam ao de fábrica ANTES do `resetQueue` (com o offline
  // ligado, ele abriria a base apagada de novo).
  assert.ok(m.log.includes('fila:' + JSON.stringify(m.h.preferenciasDeFabrica())));
  assert.ok(m.log.includes('cancelou:ABC234'), 'o QR que esta aba mostrava seguiu entrando na conta que saiu');
  assert.ok(m.log.includes('toast:toast.saiuNoutraAba'));
  for (const tela of ['showAuthScreen', 'removeCurrentCardEl', 'esquecerFocoAutor', 'presencaWmeZerar']) {
    assert.ok(m.h.chamou.includes(tela), `a outra aba não passou por ${tela}`);
  }
});

test('A1: CONTROLE — o "Sair" desta aba grava e apaga o aparelho (o espião enxerga escrita)', async () => {
  const m = montarSair();
  await m.h.handleLogout();
  for (const esperado of ['apaga:' + TOKEN, 'apaga:' + CONTA_KEY, 'grava:' + STATS_KEY, 'grava:' + PREFERENCES_KEY, 'apaga:waze_places_saida']) {
    assert.ok(m.ap.escritas.includes(esperado), `CONTROLE: o "Sair" não fez ${esperado} — o espião está cego`);
  }
  assert.ok(m.log.includes('destroy:tok-A') && m.log.includes('diario:saiu') && m.log.includes('fechou:logoutModal'));
  assert.deepEqual(m.log.find((x) => Array.isArray(x) && x[0] === 'presenca'), ['presenca', null]);
  assert.deepEqual(m.log.find((x) => Array.isArray(x) && x[0] === 'dlog'), ['dlog', null], 'o "Sair" daqui deixou o diagnóstico no aparelho');
  assert.ok(m.log.includes('toast:toast.loggedOut'));
});

// ═══ R6-1-11 · a recusa TERMINAL do portão na reconferência ══════════════════
// O `perfil` reconfere o portão a cada abertura: quem caiu abaixo dele perde a
// sessão (o servidor a apaga) e vê o "Acesso restrito". Ia pela regra da QUEDA,
// que deixa o aparelho como está pra a mesma pessoa voltar — mas aqui não há
// volta, e o "Sair" só existe com sessão: o Histórico, a lista de autores (nome
// de terceiro) e a fila de saída (id e nome de quem mandou o pedido) ficavam no
// aparelho sem caminho pra apagar (MEDIDO no Chromium, auditoria de
// 2026-10-02). Agora sai o que é da conta, pela MESMA lista do "Sair".
test('R6-1-11: o portão que fecha na reconferência apaga do aparelho o que é da conta — a MESMA lista do "Sair"', async () => {
  const m = montarSair();
  // A sessão já caiu (o `derrubarSessao` roda antes) e o servidor já a apagou.
  m.API.sessionToken = null;
  m.ap.dados.delete(TOKEN);
  await m.h.handleLogout({ recusado: true });
  for (const esperado of ['apaga:' + CONTA_KEY, 'apaga:waze_places_saida', 'apaga:waze_places_history',
    'apaga:waze_places_conquistas', 'apaga:waze_places_autores', 'grava:' + STATS_KEY, 'grava:' + PREFERENCES_KEY]) {
    assert.ok(m.ap.escritas.includes(esperado), `DEFEITO: a recusa do portão deixou no aparelho o que o "Sair" apaga (${esperado})`);
  }
  assert.deepEqual([m.AppState.history, m.AppState.conquistas, m.AppState.autores], [null, null, null]);
  assert.deepEqual(m.log.find((x) => Array.isArray(x) && x[0] === 'presenca'), ['presenca', null], 'o chat guardado ficou no aparelho');
  assert.deepEqual(m.log.find((x) => Array.isArray(x) && x[0] === 'offline'), ['offline', null], 'a fila guardada do offline ficou no aparelho');
  // Não é o "Sair": não há diálogo do "Sair" a fechar (fechar o que não está
  // aberto mente no diário), nem sessão a destruir — o servidor já a apagou.
  assert.ok(!m.log.includes('fechou:logoutModal'), 'a recusa "fechou" o diálogo do "Sair", que nem estava aberto');
  assert.ok(!m.log.some((x) => typeof x === 'string' && x.startsWith('destroy:')), 'a recusa mandou destruir uma sessão que o servidor já apagou');
  assert.ok(!m.log.includes('setSession:null'), 'a recusa mexeu no token do aparelho de novo (a queda já o tirou)');
  assert.ok(m.log.includes('toast:toast.loggedOut'), 'o aviso de que os dados saíram não apareceu');
});

test('R6-1-11: a recusa passa pela limpeza só com a sessão DESTA aba sendo a do aparelho — e antes do diálogo', () => {
  for (const [caso, guardado, esperado] of [
    ['a sessão do aparelho', 'tok-A', ['derrubou', 'sair:recusado', 'negado', 'entrada']],
    // CONTROLE: a sessão guardada é OUTRA (outra aba, talvez outra conta): o
    // aparelho não é desta, e aqui cai só a memória, como na queda.
    ['outra sessão no aparelho', 'tok-OUTRA', ['derrubou', 'negado', 'entrada']],
  ]) {
    const ap = aparelho({ [TOKEN]: guardado });
    const log = [];
    const deps = {
      safeLS: ap.safeLS, API: { sessionToken: 'tok-A' },
      // A queda de verdade tira o token do aparelho ANTES de chamar o `depois`:
      // de quem é o aparelho tem de ser lido antes dela.
      derrubarSessao: (k, { depois }) => {
        log.push('derrubou');
        if (ap.safeLS.get(TOKEN) === deps.API.sessionToken) ap.safeLS.remove(TOKEN);
        deps.API.sessionToken = null;
        depois();
      },
      handleLogout: (o) => log.push(o && o.recusado === true ? 'sair:recusado' : 'sair:' + JSON.stringify(o)),
      showAccessDenied: () => log.push('negado'), showAuthScreen: () => log.push('entrada'),
    };
    const h = montar(['recusaDoPortao', 'sessaoDestaAbaEhAGuardada'], deps);
    h.recusaDoPortao({ errorKey: 'srv.err.accessDenied', errorCategory: 'access_denied' });
    assert.deepEqual(log, esperado, `${caso}: ${log.join(' → ')}`);
  }
});

// O fechamento das camadas DE VERDADE no que ele dispara: a foto ampliada fecha
// pelo `avancarSeAprovado` (que MANDA a aprovação pendente) e a conversa pela
// limpeza que paga o "lida" esperando a rajada (`presencaPagarLida`).
function montarSairComCamadas() {
  const m = montarSair();
  const saiu = [];
  Object.assign(m.deps, {
    renomeacaoPendente: null, exclusaoPendente: null, placeResolvidoPorAprovacao: null,
    aprovacaoPendente: { enviar: () => saiu.push('aprovação:' + m.API.sessionToken), cancelar: () => { m.deps.aprovacaoPendente = null; } },
    // A dívida do "lida" mora num conjunto próprio desde o R6-5-1: o "lida" da
    // rajada que não pode sair (sem o perfil) vira dívida, e o fechamento paga
    // as dívidas (`presencaPagarDevidas`).
    Presenca: { lidaPendente: '777', lidaDevendo: new Set(), timers: {} }, PRESENCA_ID: /^\d{1,19}$/,
    presencaMarcarLida: (id) => saiu.push('lida:' + id + ':' + m.API.sessionToken),
  });
  m.deps.window.Presenca.esquecer = (o) => {
    m.log.push(['presenca', o || null]);
    m.deps.Presenca.lidaPendente = null;
    m.deps.Presenca.lidaDevendo.clear();
  };
  const fonte = APP_SEM + '\n' + ['presencaPagarLida', 'presencaPagarDevidas', 'presencaEu'].map((n) => fatiarDe(PRESENCA_SEM, n)).join('\n');
  const h = montar(['handleLogout', 'preferenciasDeFabrica', 'sessaoDestaAbaEhAGuardada', 'cancelarPendenciasDoLightbox',
    'avancarSeAprovado', 'presencaPagarLida', 'presencaPagarDevidas', 'presencaEu'], m.deps, fonte);
  m.deps.fecharCamadasAbertas = () => { m.log.push('camadas'); h.avancarSeAprovado(); h.presencaPagarLida({ fechando: true }); };
  return { ...m, h, saiu };
}

test('F2: na OUTRA aba as camadas fecham DEPOIS do que estava pendente — a aprovação na janela e o "lida" não saem com a sessão de quem saiu', async () => {
  for (const outraConta of [false, true]) {
    const m = montarSairComCamadas();
    await m.h.handleLogout({ porOutraAba: true, outraConta });
    assert.ok(m.log.includes('camadas'), 'as camadas não fecharam');
    assert.deepEqual(m.saiu, [],
      `DEFEITO${outraConta ? ' (outra conta)' : ''}: o fechamento das camadas mandou o que estava pendente, com a sessão de quem saiu: ${m.saiu.join(' ')}`);
    assert.equal(m.deps.aprovacaoPendente, null, 'a aprovação na janela não foi cancelada');
    assert.equal(m.deps.Presenca.lidaPendente, null, 'o "lida" pendente ficou pra quem entrar');
    assert.equal(m.deps.Presenca.lidaDevendo.size, 0, 'o "lida" devido ficou pra quem entrar');
  }
  // CONTROLE: o fechamento com a aprovação pendente e o perfil de pé (a ordem de antes) manda os dois.
  const c = montarSairComCamadas();
  c.deps.fecharCamadasAbertas();
  assert.deepEqual(c.saiu, ['aprovação:tok-A', 'lida:777:tok-A'], 'CONTROLE: o harness não enxerga o que o fechamento manda');
});

test('R5-5-X: a tela de entrada não guarda o anúncio do último card (nome de local de terceiro) — nem no "Sair"', () => {
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', classList: { add() {}, remove() {}, toggle() {} } });
  els.cardLiveRegion = { textContent: 'Novo pedido: Padaria Estrela, Local novo' };
  const deps = { document: { documentElement: { classList: { remove() {} } }, getElementById: el, querySelectorAll: () => [] },
    AppState: { authenticated: true, profile: { id: 1 } }, window: {} };
  const h = montar(['showAuthScreen'], deps);
  h.showAuthScreen();
  assert.equal(els.cardLiveRegion.textContent, '', 'DEFEITO: o nome do local do último card seguiu na região viva da tela de entrada');
  // O "Sair" passa por ela, nas duas abas.
  assert.match(fatiarDe(APP_SEM, 'handleLogout'), /^\s+showAuthScreen\(\);/m);
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

function abrirAba(comp, { preferencias = { undoEnabled: true, semUndoSeguidas: 0, presenca: true, pularGuarda: false },
  perfilId = 111, token = 'tok' } = {}) {
  const aba = { escreveuNoAviso: [], desenhou: 0, noAviso: false };
  const localStorage = comp.para(aba);
  const safeLS = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
  const AppState = { authenticated: true, stats: { read: 0, rejected: 0, skipped: 0 }, preferences: { ...preferencias },
    history: null, conquistas: null, autores: null, profile: perfilId ? { id: perfilId } : null };
  const deps = {
    AppState, localStorage, safeLS, STATS_KEY, PREFERENCES_KEY, CONTA_KEY, DEVMODE_KEY: 'waze_places_devmode',
    HISTORY_KEY: 'waze_places_history', CONQUISTAS_KEY: 'waze_places_conquistas', AUTORES_KEY: 'waze_places_autores',
    preferenciasCarregadas: true, puladosNoInicioDaFila: 0,
    // Os dois com sessão: o token e a conta no aparelho (nenhum "Sair" aqui).
    API: { temSessaoNaMemoria: () => true, sessionToken: token }, extPerguntando: false,
    aoMudarModoDevEmOutraAba: () => {}, atualizarSeloDeConquista: () => {}, agendarRedesenhoDoHistorico: () => {},
    desenharPlacar: () => { aba.desenhou++; }, updateStats: () => {},
    desenharChavesDePreferencia: () => {}, atualizarSeloDePular: () => {}, atualizarLinhaDoOffline: () => {},
    presencaWme: { ligarNaProxima: false, desligarPendente: true },
    window: { Presenca: { desligar: () => { aba.presencaDesligada = (aba.presencaDesligada || 0) + 1; }, renderPilula: () => {} } },
    offlineEsquecer: (o) => { aba.offlineSoltou = o; },
    handleLogout: (o) => { aba.saiu = o || true; },
    SAIDA_KEY: 'waze_places_saida', updateInFlightIndicator: () => { aba.indicador = (aba.indicador || 0) + 1; },
  };
  const nomes = ['aoGravarEmOutraAba', 'sincronizarComOutraAba', 'aoSairEmOutraAba', 'aoEntrarOutraContaEmOutraAba',
    'contaSegueNoAparelho', 'sessaoDestaAbaEhAGuardada', 'relerPlacarDeOutraAba', 'placarGuardado',
    'relerPreferenciasDeOutraAba', 'lerPreferenciasGuardadas', 'preferenciasDeFabrica', 'saveStats', 'savePreferences',
    'descontarGestoSemSessao', 'puladosNestaFila', 'presencaLigada'];
  const fonte = APP_SEM + '\n' + fatiarDe(PRESENCA_SEM, 'presencaLigada');
  Object.assign(aba, montar(nomes, deps, fonte), { AppState, deps });
  comp.abas.push(aba);
  return aba;
}
const sessaoNoAparelho = { [TOKEN]: 'tok', [CONTA_KEY]: { id: '111', s: 'x' } };
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

test('A2: o placar que chega da outra aba só se DESENHA — o aviso do Desfazer é da aba em que a decisão se confirmou', () => {
  const ap = aparelho({ [STATS_KEY]: { read: 0, rejected: 30, skipped: 0 } });
  const log = [];
  const deps = {
    localStorage: ap.localStorage, STATS_KEY, puladosNoInicioDaFila: 0,
    AppState: { stats: { read: 0, rejected: 29, skipped: 0 } }, Treino: { ativo: false },
    checkUndoGateUnlock: () => log.push('gate'), setCount: () => log.push('conta'), updatePendingCount: () => log.push('restam'),
    document: { getElementById: () => ({}) },
  };
  const h = montar(['relerPlacarDeOutraAba', 'placarGuardado', 'desenharPlacar', 'updateStats', 'registrarAcaoConfirmada'], deps);
  h.relerPlacarDeOutraAba();
  assert.equal(deps.AppState.stats.rejected, 30);
  assert.deepEqual(log, ['conta', 'conta', 'conta', 'restam']);
  assert.ok(!log.includes('gate'), 'a aba que só RELEU o placar comemorou a cota (a da decisão já comemorou)');
  // O gesto também só desenha: o placar é otimista, e a janela do Desfazer
  // ainda pode devolver o pedido (R6-7-5) — a cota se avalia na confirmação.
  log.length = 0;
  h.updateStats();
  assert.ok(!log.includes('gate'), 'o GESTO voltou a comemorar a cota, dentro da janela do Desfazer');
  // CONTROLE: a confirmação avalia a cota (o instrumento enxerga a chamada).
  log.length = 0;
  h.registrarAcaoConfirmada('reject', { venueID: 'v1' });
  assert.ok(log.includes('gate'), 'a confirmação de uma decisão não avalia a cota do Desfazer');
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
    // O Histórico conta o CONFIRMADO (R7-7-05): aqui nada fica no ar, então ele
    // acompanha o placar.
    loadHistory: () => ({ _total: { read: deps.AppState.stats.read, rejected: deps.AppState.stats.rejected } }),
  };
  const h = montar(['esquecerEscolhasDaContaAnterior', 'savePreferences', 'guardarPerfilDoPortao', 'perfilDoPortao',
    'getUndoUnlockThreshold', 'getUndoTreatedCount', 'undoGateAtingido', 'initUndoGateSeen', 'pedidosConfirmados',
    'checkUndoGateUnlock', 'canDisableUndo'], deps);
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

// ═══ R6-7-5 · o aviso "o Desfazer virou opcional" sai na CONFIRMAÇÃO ═══════════
// O placar é OTIMISTA: o gesto que cruzava a cota comemorava DENTRO da janela do
// Desfazer, que ainda podia devolver o pedido. Desfeito, o aviso seguia na tela
// levando a um interruptor travado ("falta 1"), e a marca de "visto" já estava
// gravada — o desbloqueio de verdade, um pedido depois, nunca era anunciado
// (auditoria de 2026-10-01, MEDIDO no navegador). Funções DE VERDADE: o gesto (o
// `updateStats`), a confirmação (`registrarAcaoConfirmada`), a cota e a dica.
function montarCota({ confirmados = 29 } = {}) {
  // L2 (cota 30) com 29 tratados, a linha de base decidida ("ainda não") e 25
  // janelas sem desfazer nas costas — a dica por comportamento já pediria pra sair.
  // `confirmados`: quantos deles o Waze JÁ confirmou (o acumulador do Histórico,
  // R7-7-05); o resto está no ar. Cada confirmação do teste soma 1 ANTES do
  // `registrarAcaoConfirmada`, como o `recordHistory` do app.
  const prefs = { undoEnabled: true, undoGateSeen: false, dicaDesfazerVista: false, semUndoSeguidas: 25 };
  const hist = { _total: { read: 0, rejected: confirmados } };
  const ap = aparelho({ [constante('PERFIL_GATE_KEY')]: { rank: 1, isStaff: false }, [PREFERENCES_KEY]: prefs });
  const toasts = [];
  const deps = {
    safeLS: ap.safeLS, localStorage: ap.localStorage, PREFERENCES_KEY, PERFIL_GATE_KEY: constante('PERFIL_GATE_KEY'),
    AppState: { preferences: { ...prefs }, stats: { read: 0, rejected: 29, skipped: 0 }, profile: null,
      devMode: { active: false }, pendingAction: null },
    preferenciasCarregadas: true, UNDO_GATE_BASE: constante('UNDO_GATE_BASE'), DICA_SEM_UNDO: 20,
    showToast: (m) => toasts.push(m), t: (k) => k, dispararConfeteNaFila: () => {}, abrirPreferenciaDoUndo: () => {},
    Treino: { ativo: false }, loadHistory: () => hist,
  };
  const h = montar(['savePreferences', 'perfilDoPortao', 'getUndoUnlockThreshold', 'getUndoTreatedCount',
    'undoGateAtingido', 'pedidosNaJanelaDoDesfazer', 'pedidosConfirmados', 'checkUndoGateUnlock', 'canDisableUndo',
    'checkDicaDesfazer', 'updateStats', 'desenharPlacar', 'registrarAcaoConfirmada'], deps);
  const P = { venueID: 'v1', updateRequestID: 'u1' };
  // O pouso de uma decisão: o Histórico conta, e ENTÃO a confirmação avalia.
  const confirmar = (tipo, place) => { hist._total[tipo === 'read' ? 'read' : 'rejected']++; h.registrarAcaoConfirmada(tipo, place); };
  return { h, deps, toasts, P, prefs: deps.AppState.preferences, stats: deps.AppState.stats, hist, confirmar };
}

test('R6-7-5: o gesto que cruza a cota NÃO comemora na janela; desfeito, nada fica — e o desbloqueio de verdade é anunciado', () => {
  // Dos 29 do placar, 28 confirmados: a decisão anterior (v0) ainda está no ar.
  const m = montarCota({ confirmados: 28 });
  // O 30º ✕ (L2: cota 30): o placar sobe no GESTO e a janela abre.
  m.stats.rejected = 30;
  m.h.updateStats();
  m.deps.AppState.pendingAction = { type: 'reject', place: m.P };
  assert.deepEqual(m.toasts, [], 'comemorou no GESTO — a janela do Desfazer ainda pode devolver o pedido');
  // A confirmação de uma decisão ANTERIOR chega com este na janela: ele não conta.
  m.confirmar('read', { venueID: 'v0', updateRequestID: 'u0' });
  assert.deepEqual(m.toasts, [], 'comemorou contando o pedido que ainda está na janela do Desfazer');
  assert.equal(m.prefs.undoGateSeen, false);
  // Desfaz: o placar volta, a marca de "visto" segue livre.
  m.stats.rejected = 29;
  m.deps.AppState.pendingAction = null;
  m.h.updateStats();
  assert.deepEqual(m.toasts, []);
  assert.equal(m.prefs.undoGateSeen, false, 'o desfeito deixou o "visto" gravado — o desbloqueio de verdade nunca seria anunciado');
  assert.equal(m.prefs.dicaDesfazerVista, false, 'o desfeito deixou a dica por comportamento marcada como vista');
  // O 30º de verdade: o gesto, a janela, e a CONFIRMAÇÃO — aí sim, uma vez.
  m.stats.rejected = 30;
  m.h.updateStats();
  assert.deepEqual(m.toasts, []);
  m.confirmar('reject', m.P);
  assert.deepEqual(m.toasts, ['toast.undoUnlocked'], 'a confirmação que cruza a cota não anunciou o desbloqueio');
  assert.equal(m.h.canDisableUndo(), true, 'o aviso leva a um interruptor travado');
  m.confirmar('reject', m.P);
  assert.deepEqual(m.toasts, ['toast.undoUnlocked'], 'anunciou duas vezes');
});

test('R6-7-5: a dica das janelas sem desfazer não sai junto da comemoração da cota (as duas dizem o mesmo)', () => {
  // A janela que expira sem desfazer conta pra dica no FIM da janela, ANTES da
  // confirmação: com a cota recém-cruzada, a comemoração vem logo depois.
  const m = montarCota();
  m.stats.rejected = 30;
  m.h.checkDicaDesfazer();
  assert.deepEqual(m.toasts, [], 'a dica saiu e, um instante depois, a comemoração dizendo a mesma coisa');
  m.confirmar('reject', m.P);
  m.h.checkDicaDesfazer();
  assert.deepEqual(m.toasts, ['toast.undoUnlocked'], 'saiu a dica depois da comemoração (ou nenhuma das duas)');
  // CONTROLE: quem já passou da cota antes (a linha de base marcou "visto") recebe a dica.
  const c = montarCota();
  c.prefs.undoGateSeen = true;
  c.stats.rejected = 30;
  c.h.checkDicaDesfazer();
  assert.deepEqual(c.toasts, ['toast.undoHint'], 'a dica por comportamento sumiu pra quem já tinha passado da cota');
});

// ═══ R7-7-05 · o aviso "o Desfazer virou opcional" conta só o CONFIRMADO ══════
// Descontar só a janela do Desfazer não bastava: com DUAS decisões no ar (rede
// lenta), a confirmação da 1ª já avisava "N pedidos tratados", com a 2ª ainda no
// Waze. Recusada, o placar voltava pra baixo da cota, o interruptor ficava
// travado ("falta 1") e a marca de "visto" já estava gravada — o desbloqueio de
// verdade nunca era anunciado (auditoria de 2026-10-02, MEDIDO no navegador; o
// mesmo com um "Rejeitar os N" no ar). O que conta é o acumulador do Histórico,
// que só anda no pouso.
test('R7-7-05: com DUAS decisões no ar, a confirmação da 1ª não avisa; recusada a 2ª, nada fica — e o desbloqueio de verdade é anunciado', () => {
  // 28 confirmados; A e B saem (o placar vai a 30, a cota do L2) e ficam no ar.
  const m = montarCota({ confirmados: 28 });
  m.stats.rejected = 30;
  m.h.updateStats();
  // A confirma: 29 confirmados, B ainda no Waze.
  m.confirmar('reject', { venueID: 'vA', updateRequestID: 'uA' });
  assert.deepEqual(m.toasts, [], 'DEFEITO: avisou contando a decisão que ainda está no ar');
  assert.equal(m.prefs.undoGateSeen, false);
  // B é recusada de vez: o placar desce (o `handleActionResult`).
  m.stats.rejected = 29;
  m.h.updateStats();
  assert.equal(m.h.canDisableUndo(), false, 'PRÉ-CONDIÇÃO: com a recusa, o interruptor voltou a travar');
  assert.deepEqual(m.toasts, [], 'o aviso saiu e leva a um interruptor travado');
  assert.equal(m.prefs.undoGateSeen, false, 'a marca de "visto" foi gravada — o desbloqueio de verdade nunca seria anunciado');
  // C sai e confirma: 30 confirmados — aí sim, com o interruptor livre.
  m.stats.rejected = 30;
  m.confirmar('reject', { venueID: 'vC', updateRequestID: 'uC' });
  assert.deepEqual(m.toasts, ['toast.undoUnlocked'], 'o desbloqueio de verdade não foi anunciado');
  assert.equal(m.h.canDisableUndo(), true);
});

test('R7-7-05: CONTROLE — a 2ª decisão confirma, e o aviso sai na confirmação DELA, uma vez', () => {
  const m = montarCota({ confirmados: 28 });
  m.stats.rejected = 30;
  m.confirmar('reject', { venueID: 'vA', updateRequestID: 'uA' });
  assert.deepEqual(m.toasts, []);
  m.confirmar('reject', { venueID: 'vB', updateRequestID: 'uB' });
  assert.deepEqual(m.toasts, ['toast.undoUnlocked'], 'a confirmação que completa a cota não avisou');
  assert.equal(m.h.canDisableUndo(), true);
  m.confirmar('reject', { venueID: 'vD', updateRequestID: 'uD' });
  assert.deepEqual(m.toasts, ['toast.undoUnlocked'], 'avisou duas vezes');
});

test('R7-7-05: o "Rejeitar os N" no ar conta só o que POUSOU — o lote de 3 com o último recusado não avisa', () => {
  // 27 confirmados; o lote de 3 sobe o placar a 30 no gesto.
  const m = montarCota({ confirmados: 27 });
  m.stats.rejected = 30;
  m.confirmar('reject', { venueID: 'v1', updateRequestID: 'u1' });
  m.confirmar('reject', { venueID: 'v2', updateRequestID: 'u2' });
  assert.deepEqual(m.toasts, [], 'DEFEITO: o lote avisou com um pedido dele ainda no Waze');
  m.stats.rejected = 29;   // o 3º recusado de vez
  assert.equal(m.prefs.undoGateSeen, false);
  assert.equal(m.h.canDisableUndo(), false);
});

test('R7-7-05: o aviso nunca sai com o interruptor TRAVADO — mesmo com o Histórico contando mais que o placar', () => {
  // O interruptor obedece ao placar (`canDisableUndo`): se os dois divergirem,
  // vale o menor. Placar 29 com o Histórico em 30 (o placar desceu por um gesto
  // descontado depois de a confirmação já ter contado).
  const m = montarCota({ confirmados: 29 });
  m.stats.rejected = 29;
  m.confirmar('reject', m.P);
  assert.equal(m.h.canDisableUndo(), false, 'PRÉ-CONDIÇÃO: o interruptor está travado');
  assert.deepEqual(m.toasts, [], 'avisou que o Desfazer virou opcional com o interruptor travado');
  assert.equal(m.prefs.undoGateSeen, false);
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

test('A4/R56-1: a troca de conta solta casa, trabalho e o GPS; a QUEDA solta casa e trabalho e MANTÉM o GPS (o aparelho segue "Perto de mim")', () => {
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
  assert.equal(queda.deps.referenciasDoPerfil, null, 'DEFEITO: a casa de quem estava ficou pra quem entrar depois da queda');
  // A posição é do APARELHO, e o perfil que volta na renovação não a traz:
  // tirada na queda, a fila "Perto de mim" passava pra ordem por data sem aviso.
  assert.deepEqual(queda.referenciaDaOrdem('gps'), [-10, -40],
    'DEFEITO (R56-1): a queda tirou a posição do GPS — a renovação da mesma conta perde o "Perto de mim"');
  assert.equal(queda.referenciaDaOrdem('casa'), null);
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

// ═══ OUTRA CONTA entra noutra aba: a aba da conta anterior sai ════════════════

test('outra conta: OUTRA conta entra noutra aba — esta SAI, e decide no aviso da CONTA (que chega depois do do token)', () => {
  const comp = armazenamentoCompartilhado(sessaoNoAparelho);
  const A = abrirAba(comp), B = abrirAba(comp);
  // Na aba A a sessão caiu e alguém entrou com OUTRA conta — o token primeiro...
  A.deps.safeLS.set(TOKEN, 'tok-222');
  comp.entregar();
  assert.equal(B.saiu, undefined, 'a aba B saiu no aviso do TOKEN, com o aparelho ainda dizendo a conta dela');
  // ...os dados da conta anterior saem (o placar zerado, entre outros)...
  A.deps.safeLS.set(STATS_KEY, JSON.stringify({ read: 0, rejected: 0, skipped: 0 }));
  comp.entregar();
  // ...e a conta nova, por último (ver `aoConhecerConta`).
  A.deps.safeLS.set(CONTA_KEY, JSON.stringify({ id: '222', s: 'm-222' }));
  comp.entregar();
  assert.deepEqual(B.saiu, { porOutraAba: true, outraConta: true },
    'DEFEITO: a aba B seguiu com a conta anterior num aparelho que é da nova — o placar e o Histórico dela iriam pra outra conta');
  assert.deepEqual(B.escreveuNoAviso, [], 'a aba B gravou no aparelho ao receber o aviso');
});

test('outra conta: CONTROLES — a MESMA conta entrando de novo noutra aba, e a aba que ainda não sabe a sua conta, NÃO saem', () => {
  const comp = armazenamentoCompartilhado(sessaoNoAparelho);
  const A = abrirAba(comp), B = abrirAba(comp), C = abrirAba(comp, { perfilId: null });
  A.deps.safeLS.remove(TOKEN);                                          // a queda na A...
  A.deps.safeLS.set(TOKEN, 'tok-111b');                                 // ...a renovação...
  A.deps.safeLS.set(CONTA_KEY, JSON.stringify({ id: '111', s: 'm-111b' }));   // ...e a MESMA conta
  comp.entregar();
  assert.equal(B.saiu, undefined, 'a MESMA conta renovando noutra aba derrubou esta');
  // A conta de C não se sabe ainda (sem perfil na memória): quem decide é o perfil, quando chegar.
  A.deps.safeLS.set(CONTA_KEY, JSON.stringify({ id: '222', s: 'm-222' }));
  comp.entregar();
  assert.equal(C.saiu, undefined, 'a aba sem perfil saiu sem saber de quem era');
  // CONTROLE do instrumento: com a conta de outra pessoa, a mesma B sai.
  assert.deepEqual(B.saiu, { porOutraAba: true, outraConta: true });
});

// ═══ R6-1-04 · a aba SEM perfil quando OUTRA sessão toma o aparelho ══════════
// A aba A abre com a sessão de X e o perfil FALHA (5xx do Waze); na aba B entra
// Y. A não saía ("sem perfil, quem decide é o perfil") e seguia triando: o ✕
// dela ia pro Waze com a sessão de X, e o pouso gravava o Histórico, o placar,
// os autores e as conquistas no aparelho — já de Y (MEDIDO no Chromium,
// auditoria de 2026-10-02). E o perfil só era pedido de novo no teto de 1 min.
// Agora: com o dono do aparelho CONFIRMADO por outra sessão e a conta desta aba
// desconhecida, o perfil é pedido NA HORA e o card trava até ele chegar.
const marcaDe = new Function(fatiarDe(APP_SEM, 'marcaDaSessao') + '\nreturn marcaDaSessao;')();

function abaSemPerfil(comp, { token = 'tok-x' } = {}) {
  const aba = { escreveuNoAviso: [], noAviso: false, pedidosDePerfil: 0, travas: [] };
  const localStorage = comp.para(aba);
  const safeLS = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
  const AppState = { authenticated: true, profile: null, pendingAction: null, currentPlace: null,
    stats: { read: 0, rejected: 0, skipped: 0 }, preferences: { undoEnabled: true, presenca: true } };
  let soltarPerfil = null;
  const deps = {
    AppState, localStorage, safeLS, STATS_KEY, PREFERENCES_KEY, CONTA_KEY, DEVMODE_KEY: 'waze_places_devmode',
    HISTORY_KEY: 'waze_places_history', CONQUISTAS_KEY: 'waze_places_conquistas', AUTORES_KEY: 'waze_places_autores',
    SAIDA_KEY: 'waze_places_saida', preferenciasCarregadas: true, puladosNoInicioDaFila: 0,
    API: { temSessaoNaMemoria: () => true, sessionToken: token }, extPerguntando: false, extRenovando: false,
    // A trava de verdade, com nada mais travando.
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, loteDeLidosEmVoo: false, escritasConferindo: 0,
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), conferindoContaDestaAba: false,
    perfilPedidoEm: 0, PERFIL_REFAZER_MS: 60 * 1000,
    // O perfil pedido: preso até o teste soltar (ele chega ou falha).
    loadProfileAndAuxData: () => { aba.pedidosDePerfil++; return new Promise((ok) => { soltarPerfil = ok; }); },
    aplicarTravaDeAcao: () => aba.travas.push(aba.acoesTravadas()),
    handleLogout: (o) => { aba.saiu = o || true; },
    aoMudarModoDevEmOutraAba: () => {}, atualizarSeloDeConquista: () => {}, agendarRedesenhoDoHistorico: () => {},
    desenharPlacar: () => {}, updateStats: () => {}, updateInFlightIndicator: () => {},
  };
  const nomes = ['aoGravarEmOutraAba', 'sincronizarComOutraAba', 'aoSairEmOutraAba', 'aoEntrarOutraContaEmOutraAba',
    'contaSegueNoAparelho', 'sessaoDestaAbaEhAGuardada', 'contaDestaAbaEmDuvida', 'conferirContaDestaAba', 'marcaDaSessao', 'marcaDestaAba',
    'acoesTravadas', 'aprovacaoDaTelaNoAr', 'avisoDaTrava', 'relerPlacarDeOutraAba', 'placarGuardado', 'refazerPerfilSeFaltar'];
  Object.assign(aba, montar(nomes, deps), { AppState, deps, soltarPerfil: (perfil) => {
    if (perfil) AppState.profile = perfil;
    soltarPerfil();
  } });
  comp.abas.push(aba);
  return aba;
}
// A outra aba, que só escreve no aparelho (o aviso dela chega na A).
function outraAba(comp) {
  const b = { escreveuNoAviso: [], noAviso: false, aoGravarEmOutraAba() {} };
  comp.abas.push(b);
  return comp.para(b);
}
const tiqueAba = () => new Promise((ok) => setImmediate(ok));

// O armazenamento com a sessão desta aba guardada CRUA (o compartilhado grava os
// valores iniciais em JSON, e um token entre aspas não é a sessão de ninguém).
function aparelhoComASessao(token = 'tok-x', conta = { id: '4242', s: 'velha' }) {
  const comp = armazenamentoCompartilhado({ [CONTA_KEY]: conta });
  comp.dados.set(TOKEN, token);
  return comp;
}

test('R6-1-04: a aba SEM perfil não segue triando quando outra sessão toma o aparelho — o perfil é pedido NA HORA, e o card trava até ele', async () => {
  const comp = aparelhoComASessao();
  const A = abaSemPerfil(comp);
  assert.equal(A.sessaoDestaAbaEhAGuardada(), true, 'CONTROLE: a sessão desta aba não é a do aparelho na largada');
  const B = outraAba(comp);
  // Na B, a sessão de X cai e Y entra: o token primeiro…
  B.setItem(TOKEN, 'tok-y');
  comp.entregar();
  assert.equal(A.pedidosDePerfil, 0, 'no aviso do TOKEN a conta guardada ainda é a da sessão anterior: nada a conferir');
  assert.equal(A.acoesTravadas(), false, 'CONTROLE: sem o dono do aparelho confirmado, a aba não trava');
  // …e a conta de Y, vista com a sessão nova (`aoConhecerConta`).
  B.setItem(CONTA_KEY, JSON.stringify({ id: '5151', s: marcaDe('tok-y') }));
  comp.entregar();
  assert.equal(A.saiu, undefined, 'a aba sem perfil saiu sem saber de quem era');
  assert.equal(A.pedidosDePerfil, 1, 'DEFEITO: a conta desta aba não foi conferida na hora (só no teto de 1 min, numa prova de rede)');
  assert.equal(A.acoesTravadas(), true, 'DEFEITO: a aba sem perfil seguiu triando num aparelho que já é de outra conta');
  assert.equal(A.avisoDaTrava(), 'toast.esperaSessao', 'o card travado não diz que espera a sessão');
  assert.equal(A.travas.at(-1), true, 'o card não foi redesenhado travado');
  // Um aviso a mais da conta, com o perfil ainda no ar, não o pede de novo.
  B.setItem(CONTA_KEY, JSON.stringify({ id: '5151', s: marcaDe('tok-y') }));
  comp.entregar();
  assert.equal(A.pedidosDePerfil, 1, 'o perfil foi pedido duas vezes com o primeiro ainda no ar');
  // O perfil FALHA: a dúvida fica, e a trava também.
  A.soltarPerfil(null);
  await tiqueAba();
  assert.equal(A.acoesTravadas(), true, 'o perfil falhou e a aba destravou sem saber de quem é');
  // A próxima prova de rede (o teto de 1 min já passou) pede de novo PELA
  // conferência — a que destrava o card quando o perfil chegar.
  A.refazerPerfilSeFaltar();
  assert.equal(A.pedidosDePerfil, 2, 'o perfil que faltou não foi pedido de novo');
  A.soltarPerfil({ id: 5151 });
  await tiqueAba();
  assert.equal(A.travas.at(-1), false, 'o perfil chegou pelo pedido de novo e o card seguiu desenhado travado');
});

test('R6-1-04: a conta confirmada destrava — e sem dúvida nenhuma, nada é pedido nem travado', async () => {
  // A MESMA conta entrou de novo na outra aba: o perfil desta chega, e a trava sai.
  const comp = aparelhoComASessao();
  const A = abaSemPerfil(comp);
  const B = outraAba(comp);
  B.setItem(TOKEN, 'tok-x2');
  B.setItem(CONTA_KEY, JSON.stringify({ id: '4242', s: marcaDe('tok-x2') }));
  comp.entregar();
  assert.equal(A.acoesTravadas(), true, 'CONTROLE: a dúvida não acendeu');
  A.soltarPerfil({ id: 4242 });
  await tiqueAba();
  assert.equal(A.acoesTravadas(), false, 'o perfil chegou e o card seguiu travado');
  assert.equal(A.travas.at(-1), false, 'o card não foi redesenhado destravado');
  assert.equal(A.AppState.contaEmDuvida, false);
  // CONTROLE: a sessão desta aba É a do aparelho — sem dúvida, nada é pedido.
  const c = aparelhoComASessao();
  const C = abaSemPerfil(c);
  outraAba(c).setItem(CONTA_KEY, JSON.stringify({ id: '4242', s: marcaDe('tok-x') }));
  c.entregar();
  assert.equal(C.sessaoDestaAbaEhAGuardada(), true, 'CONTROLE: a sessão desta aba não é a do aparelho');
  assert.equal(C.pedidosDePerfil, 0, 'a aba da sessão do aparelho pediu o perfil à toa');
  assert.equal(C.acoesTravadas(), false);
});
// ═══ R7-1-03 / R7-2-05 · duas abas da MESMA conta, cada uma com a sua sessão ═══
// A marca da conta no aparelho (`CONTA_KEY.s`) é a da sessão GUARDADA. Duas
// abas da mesma conta com sessões diferentes (o botão do WME abrindo outra aba,
// o login de novo numa delas, a renovação de cada uma) brigavam por ela, e a
// `contaConfirmada` — o portão da recusa automática — virava falsa na aba que
// perdia, calada, até recarregar (MEDIDO, auditoria de 2026-10-02):
//   · R7-1-03: a dúvida da aba sem perfil (R6-1-04) que se resolve como a MESMA
//     conta regravava a marca com a sessão DELA, e a dona do aparelho perdia;
//   · R7-2-05: a sessão nova da outra aba (o login de novo) tirava a desta.
// Uma regra pros dois: a marca do aparelho só a sessão guardada (ou a troca de
// conta) regrava, e cada aba confirma a conta com a SUA sessão, na memória.
function abaDaConta(comp, { token, perfilId = null }) {
  const aba = { escreveuNoAviso: [], noAviso: false, aoGravarEmOutraAba() {} };
  const localStorage = comp.para(aba);
  const safeLS = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
  const AppState = { authenticated: true, profile: perfilId ? { id: perfilId } : null };
  const deps = { AppState, safeLS, localStorage, CONTA_KEY, API: { sessionToken: token, getSession: () => token },
    contaConfirmadaNestaAba: null, saidaEsperandoConta: false, filaAtravessouSessao: false,
    carimbarContaNaSaida: () => {}, esquecerOutraConta: (id) => { aba.trocou = id; }, esvaziarFilaDeSaida: () => {} };
  Object.assign(aba, montar(['aoConhecerConta', 'contaConfirmada', 'sessaoDestaAbaEhAGuardada', 'marcaDaSessao', 'marcaDestaAba'], deps),
    { AppState, deps });
  // O perfil chegou (o `definirPerfil`: o perfil na memória e a conta conferida).
  aba.perfilChegou = (id) => { AppState.profile = { id }; aba.aoConhecerConta({ id }); };
  comp.abas.push(aba);
  return aba;
}

test('R7-1-03: a dúvida que se resolve como a MESMA conta não regrava a marca do aparelho — a aba dona dele segue confirmada', () => {
  // B entrou de novo com X: a sessão guardada e a marca do aparelho são as DELA.
  const comp = aparelhoComASessao('tok-x2', { id: '4242', s: marcaDe('tok-x2') });
  const B = abaDaConta(comp, { token: 'tok-x2', perfilId: 4242 });
  const A = abaDaConta(comp, { token: 'tok-x1' });   // sem perfil: a dúvida (R6-1-04) o pediu na hora
  assert.equal(B.contaConfirmada(), true, 'PRÉ-CONDIÇÃO: a aba dona do aparelho está confirmada');
  A.perfilChegou(4242);                             // a conferência: a MESMA conta
  assert.equal(A.trocou, undefined, 'a mesma conta foi tratada como troca');
  assert.equal(comp.ler(CONTA_KEY).s, marcaDe('tok-x2'),
    'DEFEITO: a aba de OUTRA sessão regravou a marca do aparelho com a sessão dela');
  assert.equal(B.contaConfirmada(), true, 'DEFEITO: a aba dona do aparelho perdeu a recusa automática, calada');
  assert.equal(A.contaConfirmada(), true, 'a aba que confirmou a conta com a sessão dela ficou sem a recusa automática');
  // CONTROLES: a aba cuja sessão É a guardada regrava a marca (a renovação com a
  // mesma conta), e a troca de conta grava o dono novo.
  const c = aparelhoComASessao('tok-x3', { id: '4242', s: marcaDe('tok-x2') });
  abaDaConta(c, { token: 'tok-x3' }).perfilChegou(4242);
  assert.equal(c.ler(CONTA_KEY).s, marcaDe('tok-x3'), 'a sessão guardada não regravou a marca do aparelho');
  const o = aparelhoComASessao('tok-y', { id: '4242', s: marcaDe('tok-x2') });
  const Y = abaDaConta(o, { token: 'tok-y' });
  Y.perfilChegou(5151);
  assert.equal(Y.trocou, '5151', 'PRÉ-CONDIÇÃO: a troca de conta foi vista');
  assert.deepEqual(o.ler(CONTA_KEY), { id: '5151', s: marcaDe('tok-y') }, 'a troca de conta não gravou o dono novo');
  // E a troca grava o dono novo MESMO sem a sessão desta aba guardada (a queda
  // da outra aba tirou o token do aparelho): o `esquecerOutraConta` acabou de
  // apagar o que era da anterior, e um dono velho no aparelho faria o próximo
  // perfil "trocar" de novo — apagando o que é de quem entrou.
  const semToken = aparelhoComASessao('tok-x2', { id: '4242', s: marcaDe('tok-x2') });
  semToken.dados.delete(TOKEN);
  abaDaConta(semToken, { token: 'tok-y' }).perfilChegou(5151);
  assert.equal(semToken.ler(CONTA_KEY).id, '5151', 'a troca de conta sem a sessão guardada deixou o dono velho no aparelho');
});

test('R7-2-05: a OUTRA aba da mesma conta entra de novo (sessão nova) — a recusa automática desta segue', () => {
  const comp = aparelhoComASessao('tok-x1', null);   // A: a sessão dela é a guardada
  const A = abaDaConta(comp, { token: 'tok-x1' });
  A.perfilChegou(4242);
  assert.equal(A.contaConfirmada(), true, 'PRÉ-CONDIÇÃO: a aba confirmou a conta');
  // B entra de novo com a MESMA conta: o token e a marca do aparelho passam a ser os dela.
  comp.dados.set(TOKEN, 'tok-x2');
  const B = abaDaConta(comp, { token: 'tok-x2' });
  B.perfilChegou(4242);
  assert.equal(comp.ler(CONTA_KEY).s, marcaDe('tok-x2'), 'PRÉ-CONDIÇÃO: a marca do aparelho é a da sessão nova de B');
  assert.equal(B.contaConfirmada(), true);
  assert.equal(A.contaConfirmada(), true, 'DEFEITO: a sessão nova da outra aba desligou a recusa automática desta, calada');
  // CONTROLE: OUTRA conta toma o aparelho noutra aba — esta deixa de estar
  // confirmada (a lista de autores do aparelho não é mais dela).
  comp.dados.set(TOKEN, 'tok-y');
  abaDaConta(comp, { token: 'tok-y' }).perfilChegou(5151);
  assert.equal(A.contaConfirmada(), false, 'a aba de X seguiu confirmada num aparelho que é de Y');
});

function montarPerfilQueChega({ tokenDesta, tokenNoAparelho = 'tok-222', dono = '222' }) {
  const ap = aparelho({ [TOKEN]: tokenNoAparelho, [CONTA_KEY]: { id: dono, s: 'm' } });
  const log = [];
  const AppState = { authenticated: true, profile: null };
  const deps = {
    safeLS: ap.safeLS, CONTA_KEY, AppState, API: { sessionToken: tokenDesta },
    handleLogout: (o) => { log.push(['sair', o]); AppState.authenticated = false; },
    aoConhecerConta: () => log.push('tomou o aparelho'), guardarPerfilDoPortao: () => log.push('portão'),
    guardarPrazoDaSessao: () => log.push('prazo'), guardarReferencias: () => log.push('casa'),
  };
  const h = montar(['definirPerfil', 'contaSegueNoAparelho', 'sessaoDestaAbaEhAGuardada'], deps);
  return { h, ap, log, AppState };
}

test('outra conta: o perfil que chega DEPOIS numa aba que não é a do aparelho a tira — sem tomar o aparelho de volta', () => {
  const m = montarPerfilQueChega({ tokenDesta: 'tok-111' });
  assert.equal(m.h.definirPerfil({ success: true, profile: { id: 111 } }), false);
  assert.deepEqual(m.log, [['sair', { porOutraAba: true, outraConta: true }]],
    'DEFEITO: a aba tomou o aparelho da outra conta (apagando os dados dela) e gravou o portão e o prazo de outra pessoa');
  assert.equal(m.AppState.profile, null, 'o perfil de quem saiu ficou na memória');
  assert.deepEqual(m.ap.escritas, []);
  // CONTROLE: a sessão desta aba É a do aparelho — o caminho de sempre, que toma o aparelho da conta anterior.
  const c = montarPerfilQueChega({ tokenDesta: 'tok-222' });
  assert.equal(c.h.definirPerfil({ success: true, profile: { id: 111 } }), true);
  assert.deepEqual(c.log, ['tomou o aparelho', 'casa', 'portão', 'prazo']);
  assert.deepEqual(c.AppState.profile, { id: 111 });
});

test('outra conta: a sonda do 401 que traz o perfil de quem saiu não diz "sua sessão continua válida" nem busca de novo', async () => {
  for (const dono of ['222', '111']) {
    const ap = aparelho({ [TOKEN]: 'tok-222', [CONTA_KEY]: { id: dono, s: 'm' } });
    const log = [];
    const AppState = { authenticated: true, profile: { id: 111 } };
    const deps = {
      safeLS: ap.safeLS, CONTA_KEY, AppState, verificandoSessao: false, VERIFICA_SESSAO_MS: 0,
      // A região em que a sonda pergunta: os editáveis do perfil dela são dela (R8-6-03).
      API: { sessionToken: 'tok-111', getProfile: async () => ({ success: true, profile: { id: 111 } }), getRegion: () => 'row' },
      handleLogout: () => { log.push('saiu'); AppState.authenticated = false; },
      aoConhecerConta: () => {}, showToast: (msg) => log.push(msg), t: (k) => k,
      rebuscarDepoisDeFalha: () => log.push('buscou'), esvaziarFilaDeSaida: () => log.push('esvaziou'),
    };
    const h = montar(['handleUnauthorized', 'definirPerfil', 'contaSegueNoAparelho', 'sessaoDestaAbaEhAGuardada'], deps);
    await h.handleUnauthorized();
    if (dono === '222') {
      assert.deepEqual(log, ['saiu'], 'a aba que saiu disse que a sessão continua válida, ou buscou de novo: ' + log.join(' '));
    } else {
      // CONTROLE: a mesma conta no aparelho — o alarme falso de sempre.
      assert.deepEqual(log, ['toast.sessionKeptAlive', 'buscou', 'esvaziou']);
    }
  }
});

test('outra conta: a aba sai SEM tocar no aparelho, apaga a PRÓPRIA sessão no servidor e diz por quê', async () => {
  const m = montarSair({ tokenNoAparelho: 'tok-da-outra' });
  await m.h.handleLogout({ porOutraAba: true, outraConta: true });
  assert.deepEqual(m.ap.escritas, [], 'a aba mexeu no aparelho, que agora é da outra conta: ' + m.ap.escritas.join(' '));
  assert.ok(m.log.includes('destroy:tok-A'),
    'DEFEITO: a sessão desta aba (que não é a do aparelho) ficou no servidor — órfã até vencer');
  assert.ok(!m.log.includes('destroy:tok-da-outra'), 'a aba apagou no servidor a sessão da outra conta');
  assert.equal(m.API.sessionToken, null);
  assert.ok(m.log.includes('toast:toast.outraContaNoutraAba'), 'a aba saiu sem dizer que outra conta entrou');
  assert.deepEqual(m.log.find((x) => Array.isArray(x) && x[0] === 'dlog'), ['dlog', { soMemoria: true }]);
  assert.equal(m.deps.saiuNestaPagina, true, 'voltar à aba relogaria pela extensão, tomando o aparelho de volta');
  // CONTROLE: o "Sair" noutra aba não apaga nada no servidor — a que saiu já apagou a sessão (a mesma).
  const s = montarSair({ tokenNoAparelho: 'tok-da-outra' });
  s.deps.tokenTiradoPorOutraAba = 'tok-A';
  await s.h.handleLogout({ porOutraAba: true });
  assert.ok(!s.log.some((x) => typeof x === 'string' && x.startsWith('destroy:')));
  // E a sessão GUARDADA nunca é apagada daqui, nem num estado sem sentido (o mesmo token nos dois).
  const g = montarSair();
  await g.h.handleLogout({ porOutraAba: true, outraConta: true });
  assert.ok(!g.log.some((x) => typeof x === 'string' && x.startsWith('destroy:')), 'a aba apagou no servidor a sessão guardada no aparelho');
});

test('o modo dev na OUTRA aba: só a memória sai — a base do aparelho fica, e a gravação em voo desta aba não grava mais', () => {
  for (const soMemoria of [true, false]) {
    const log = [];
    const deps = {
      dlogAnel: [{ k: 'x' }], dlogMomentos: [{ dom: '<html>' }], diagAberturasAnteriores: [{}], diagBaixadoEm: 5, diagEpoca: 3,
      dlogPendencias: new Map([['m', 1]]), diagEsquecerGuardado: () => log.push('apagou a base'),
      API: { chamadas: [] }, sessionStorage: { removeItem() {} }, document: { getElementById: () => null }, atualizarFabDev() {},
    };
    const h = montar(['dlogApagar'], deps);
    h.dlogApagar(soMemoria ? { soMemoria } : undefined);
    assert.deepEqual([deps.dlogAnel, deps.dlogMomentos, deps.diagAberturasAnteriores], [[], [], []], 'a memória do modo dev ficou');
    if (soMemoria) {
      assert.deepEqual(log, [], 'a outra aba apagou a base do diagnóstico no aparelho (que pode ser de outra conta)');
      assert.equal(deps.diagEpoca, 4, 'uma gravação desta aba ainda em voo gravaria na base depois de ela sair');
    } else assert.deepEqual(log, ['apagou a base'], 'CONTROLE: o desligar de sempre parou de apagar a base');
  }
});

test('outra conta: o aviso próprio, nas 4 línguas', () => {
  const valores = [...I18N.matchAll(/'toast\.outraContaNoutraAba': '([^']+)'/g)].map((m) => m[1]);
  assert.equal(valores.length, 4, 'o aviso da troca de conta noutra aba não está nas 4 línguas');
  assert.match(fatiarDe(APP_SEM, 'handleLogout'), /outraConta \? 'toast\.outraContaNoutraAba'/);
});

// ═══ A7 · o código de pareamento não é resgatado duas vezes ══════════════════

function montarResgate({ dialogoNaTela = true } = {}) {
  let soltar;
  const pedidos = [];
  const deps = {
    resgateEmVoo: false,
    API: { resgatarPareamento: (c) => { pedidos.push(c); return new Promise((ok) => { soltar = ok; }); } },
    document: { getElementById: (id) => (id === 'pairEnterModal'
      ? { classList: { contains: (c) => (c === 'hidden' ? !dialogoNaTela : false) }, contains: () => false } : null) },
    // O foco e os diálogos da tela de entrada (R11-1-04) não são o assunto daqui.
    focoNaTelaDeEntrada: () => false, fecharModaisDaEntrada: () => {},
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

function montarAviso(itens, { dialogoAberto = true, noAr = [] } = {}) {
  const ap = aparelho({ waze_places_saida: itens });
  const el = { textContent: 'velho', escondido: true, classList: { toggle(c, v) { if (c === 'hidden') el.escondido = v; } } };
  const deps = {
    safeLS: ap.safeLS, SAIDA_KEY: 'waze_places_saida',
    t: (k, v) => k + (v ? ':' + JSON.stringify(v) : ''),
    document: { getElementById: (id) => (id === 'logoutSaidaAviso' ? el
      : id === 'logoutModal' ? { classList: { contains: (c) => (c === 'hidden' ? !dialogoAberto : false) } } : null) },
    AppState: { authenticated: false, inFlightActions: 0 },
    // O que está NO AR nesta aba (o gesto até o fim do envio) e a marca desta aba.
    pedidosEmAndamento: new Set(noAr), ABA_DESTA_PAGINA: 'aba-esta', SAIDA_REIVINDICACAO_MS: 60000,
  };
  const h = montar(['desenharAvisoDoSair', 'carregarFilaDeSaida', 'updateInFlightIndicator', 'chaveDoPedido',
    'reivindicadoPorOutraAba'], deps);
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

// ═══ lote 9 (auditoria de 2026-10-01): a decisão no ar entre abas, o placar
// órfão, o lugar da aba, o indicador, o "Sair" que conta só o que espera, e a
// área gerenciada que o perfil não tem ═══════════════════════════════════════

// A fila de saída de DUAS abas no mesmo aparelho, com as funções de verdade: a
// anotação antes do envio (com a marca da aba), o esvaziamento e o pouso.
function abaDaSaida(guardado, nome, { semTravas = false, relogio = { t: 1_000_000 } } = {}) {
  const enviados = [], diario = [], historico = [];
  const safeLS = { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) };
  const deps = {
    AppState: { authenticated: true, profile: { id: 1 }, stats: { read: 0, rejected: 5, skipped: 0 } },
    navigator: { onLine: true }, epocaDaSessao: 0, safeLS, Date: { now: () => relogio.t },
    API: { getSession: () => 'tok', get sessionToken() { return 'tok'; }, getRegion: () => 'row',
      rejectPlace: async (v) => { enviados.push(nome + ':' + v); return { success: true }; },
      markAsRead: async (v) => { enviados.push(nome + ':' + v); return { success: true }; } },
    SAIDA_KEY: 'waze_places_saida', CONTA_KEY, SAIDA_MAX: 1000, SAIDA_RITMO_MS: 0, SAIDA_RECUO_401_MS: [0, 15000, 60000, 300000],
    SAIDA_TENTATIVAS_POR_ITEM: 3, SAIDA_REIVINDICACAO_MS: 60000, SAIDA_REIVINDICACAO_ASSENTA_MS: 0, ABA_DESTA_PAGINA: 'aba-' + nome,
    travaDaSaida: async () => (semTravas ? { reserva: true, soltar() {} } : { reserva: false, soltar() {} }),
    pedidosEmAndamento: new Set(), anotadoAntesDoEnvio: new WeakSet(), descargaNaFila: new WeakSet(),
    esvaziandoSaida: false, saidaPedidaDeNovo: false, saidaEsperandoConta: false, verificandoSessao: false,
    sessaoVivaEm: { s: null, em: 0 }, saidaRecuo: { s: null, n: 0, ate: 0 }, ultimaEscritaOkEm: 0,
    setTimeout: (f) => { f(); return 1; }, dfato: (k) => diario.push(k), t: (k) => k,
    registrarPouso: () => {}, recordHistory: (tipo) => historico.push(tipo), registrarRejeicaoDeAutor: () => {},
    aprovacaoDelaJaPousou: () => false,   // a aprovação de foto sem resposta (R7-3-08): aqui, nenhuma
    registrarAcaoConfirmada: () => {}, avisarConsequencia: () => {}, showToast: () => {},
    updateStats: () => {}, saveStats: () => {}, updateInFlightIndicator: () => {}, historyTodayKey: () => '2026-10-01',
    ondeAgora: () => '30', getLang: () => 'pt',
    registrarPousoDeSaida: (tipo, place, r) => { if (r && r.success) historico.push(tipo); },
  };
  const h = montar(['marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido', 'marcarNaSaida',
    'enfileirarSaida', 'tirarDaFilaDeSaida', 'anotarAntesDoEnvio', 'reivindicacaoDestaAba', 'reivindicadoPorOutraAba',
    'reivindicarNaSaida', 'soltarReivindicacoes', 'pousouPorOutraAba', 'soltarMarcaDosItens', 'moverProFimDaSaida', 'sessaoVivaDepoisDe',
    'recuarSaida', 'saidaEmRecuo', 'esvaziarFilaDeSaida', 'handleActionResult'], deps);
  return { h, deps, enviados, diario, historico, relogio };
}
const PEDIDO = (v) => ({ venueID: v, updateRequestID: 'u' + v, creatorId: 9 });

test('F1: a decisão que uma aba ANOTOU e está mandando não sai de novo pela outra — com e sem a trava do navegador', async () => {
  for (const semTravas of [false, true]) {
    const guardado = new Map();
    const relogio = { t: 1_000_000 };
    const A = abaDaSaida(guardado, 'A', { semTravas, relogio }), B = abaDaSaida(guardado, 'B', { semTravas, relogio });
    const v0 = PEDIDO('v0');
    // A anota o ✕ antes do envio (e o manda; a resposta ainda não voltou).
    assert.equal(A.h.anotarAntesDoEnvio('reject', v0, 'row'), true);
    A.deps.pedidosEmAndamento.add(A.h.chaveDoPedido(v0));
    const anotado = JSON.parse(guardado.get('waze_places_saida'))[0];
    assert.equal(anotado.rv, 'aba-A', 'a anotação antes do envio não leva a marca da aba que manda');
    // B esvazia a fila (a resposta de qualquer chamada dela é prova de rede).
    await B.h.esvaziarFilaDeSaida();
    assert.deepEqual(B.enviados, [], `DEFEITO${semTravas ? ' (sem a trava do navegador)' : ''}: a outra aba mandou de novo a decisão que a primeira tinha no ar`);
    // CONTROLE: a marca venceu (a aba A morreu no meio do envio) — a outra manda (at-least-once).
    relogio.t += 61_000;
    await B.h.esvaziarFilaDeSaida();
    assert.deepEqual(B.enviados, ['B:v0'], 'CONTROLE: com a marca vencida a decisão ficaria presa pra sempre');
  }
});

test('F1: a página RECARREGADA na mesma aba manda o que anotou antes de morrer (a marca é da aba, não da página)', async () => {
  const guardado = new Map();
  const antes = abaDaSaida(guardado, 'A');
  antes.h.anotarAntesDoEnvio('reject', PEDIDO('v1'), 'row');      // a página morreu com o envio no ar
  const depois = abaDaSaida(guardado, 'A');                        // a MESMA aba, recarregada (memória zerada)
  await depois.h.esvaziarFilaDeSaida();
  assert.deepEqual(depois.enviados, ['A:v1'], 'a mesma aba recarregada esperou a própria marca vencer');
  // E a marca da aba mora no `sessionStorage`, que é da aba e sobrevive a
  // recarregar: a MESMA aba recarregada tem a mesma marca; outra aba, outra.
  const iife = /^let ABA_DESTA_PAGINA = (\(\(\) => \{[^]*?\n\}\)\(\));/m.exec(APP);
  assert.ok(iife, 'a marca da aba mudou de forma — o teste não a acha');
  const marcaDaAba = (sessionStorage) => new Function('sessionStorage', 'return ' + iife[1])(sessionStorage);
  const sessao = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
  const daAba = sessao();
  const primeira = marcaDaAba(daAba);
  assert.equal(marcaDaAba(daAba), primeira, 'a página recarregada na MESMA aba ganhou outra marca (e esperaria a própria vencer)');
  assert.notEqual(marcaDaAba(sessao()), primeira, 'outra aba ganhou a MESMA marca');
  const bloqueado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  assert.match(marcaDaAba(bloqueado), /^[0-9a-z]+\.[0-9a-z]+$/, 'sem o armazenamento da aba, a página ficou sem marca');
});

// ── R6-2-10 (2026-10-02): a aba DUPLICADA ────────────────────────────────────
// "Duplicar aba" (Chrome, Firefox, Safari) COPIA o `sessionStorage`, e a marca
// com ele: a cópia nascia com a MESMA marca da original, achava que a decisão
// que a original tinha no ar era DELA e a mandava de novo ao abrir — MEDIDO,
// dois envios do mesmo pedido (o Histórico ficava em 1 pelo pouso da outra
// aba). A página segura uma trava do navegador com o nome da marca; a cópia a
// acha ocupada e troca de marca. As travas daqui são as do navegador (por NOME,
// e de uma página — a que morre solta as dela), como medido no Chromium e no
// WebKit: a recarregada pega a trava, a cópia a acha ocupada.
function navegadorComTravas() {
  const donos = new Map();
  return {
    donos,
    para(pagina) {
      return {
        request(nome, opcoes, cb) {
          if (typeof opcoes === 'function') { cb = opcoes; opcoes = {}; }
          return Promise.resolve().then(() => {
            if (donos.has(nome)) return (opcoes && opcoes.ifAvailable) ? cb(null) : new Promise(() => {});
            donos.set(nome, pagina);
            return Promise.resolve(cb({ name: nome })).finally(() => { if (donos.get(nome) === pagina) donos.delete(nome); });
          });
        },
      };
    },
    morrer(pagina) { for (const [nome, dono] of [...donos]) if (dono === pagina) donos.delete(nome); },
  };
}
// O `sessionStorage` de uma aba; `copia()` é o "Duplicar aba".
function sessaoDaAba(inicial = []) {
  const m = new Map(inicial);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), copia: () => sessaoDaAba(m) };
}
// A marca de uma página que ABRE: o trecho de verdade do app.js, rodado com o
// armazenamento e as travas dela.
function abrirPaginaComMarca(sessionStorage, locks) {
  const iife = /^let ABA_DESTA_PAGINA = \(\(\) => \{[^]*?\n\}\)\(\);/m.exec(APP_SEM);
  const nome = /^const MARCA_DA_ABA_TRAVA = [^;]+;/m.exec(APP_SEM);
  const chamada = /^const marcaDaAbaConferida = segurarMarcaDaAba\(\);/m.exec(APP_SEM);
  assert.ok(iife && nome && chamada, 'a marca da aba (ou a trava dela) mudou de forma — o teste não a acha');
  const fonte = [iife[0], nome[0], fatiarDe(APP_SEM, 'segurarMarcaDaAba'), chamada[0],
    'return { marca: () => ABA_DESTA_PAGINA, conferida: marcaDaAbaConferida };'].join('\n');
  return new Function('sessionStorage', 'navigator', fonte)(sessionStorage, { locks });
}

test('R6-2-10: a aba DUPLICADA troca de marca ao abrir — e a RECARREGADA fica com a dela', async () => {
  const nav = navegadorComTravas();
  const daA = sessaoDaAba();
  const A = abrirPaginaComMarca(daA, nav.para('A'));
  await A.conferida;
  const marcaA = A.marca();
  // Duplicar aba: a cópia do `sessionStorage`, com a original viva.
  const daB = daA.copia();
  const B = abrirPaginaComMarca(daB, nav.para('B'));
  assert.equal(B.marca(), marcaA, 'PRÉ-CONDIÇÃO: a cópia não nasceu com a marca da original (o teste não mede o "Duplicar aba")');
  await B.conferida;
  assert.notEqual(B.marca(), marcaA,
    'DEFEITO: a aba duplicada ficou com a marca da original — ela mandaria de novo a decisão que a original tem no ar');
  assert.equal(daB.getItem('__abaDaSaida'), B.marca(), 'a marca nova da cópia não ficou na aba dela (recarregar a cópia voltaria à da original)');
  assert.equal(A.marca(), marcaA, 'a original perdeu a marca');
  // Recarregar a A: a página que morre solta a trava, e a recarregada fica com
  // a marca — é o que manda, na abertura, o que ela anotou antes de morrer (O2, O5).
  nav.morrer('A');
  const A2 = abrirPaginaComMarca(daA, nav.para('A2'));
  await A2.conferida;
  assert.equal(A2.marca(), marcaA, 'a página RECARREGADA perdeu a marca da aba (e esperaria a própria marca vencer)');
  // CONTROLE: sem `navigator.locks`, como antes — a cópia segue com a mesma marca.
  const C = abrirPaginaComMarca(daA.copia(), undefined);
  await C.conferida;
  assert.equal(C.marca(), marcaA, 'CONTROLE: sem a trava do navegador, a cópia mudou de marca (o instrumento mede outra coisa)');
});

test('R6-2-10: o esvaziamento da fila de saída espera a marca da aba ser conferida', async () => {
  let soltar;
  const conferida = new Promise((ok) => { soltar = ok; });
  const pedidas = [];
  const navigator = { locks: { request: (nome, op, cb) => { pedidas.push(nome); return Promise.resolve(cb({ name: nome })); } } };
  const travaDaSaida = new Function('navigator', 'marcaDaAbaConferida', 'SAIDA_TRAVA',
    fatiarDe(APP_SEM, 'travaDaSaida') + '\nreturn travaDaSaida;')(navigator, conferida, 'waze_places_saida');
  const pedido = travaDaSaida();
  await tiqueAba();
  assert.deepEqual(pedidas, [], 'DEFEITO: a aba foi esvaziar a fila de saída antes de saber se a marca é dela');
  soltar();
  const trava = await pedido;
  assert.deepEqual(pedidas, ['waze_places_saida'], 'CONTROLE: conferida a marca, o esvaziamento não pegou a trava');
  assert.equal(trava.reserva, false);
  trava.soltar();
});

test('F1: a página que SAI solta as marcas dela — a reabertura (ou a outra aba) manda NA HORA o que ela tinha no ar', async () => {
  const guardado = new Map();
  const A = abaDaSaida(guardado, 'A');
  const v0 = PEDIDO('v0');
  A.h.anotarAntesDoEnvio('reject', v0, 'row');
  A.deps.pedidosEmAndamento.add(A.h.chaveDoPedido(v0));          // a página fecha com o envio no ar
  A.h.soltarReivindicacoes({ comAsDoAr: true });                   // o `pagehide`
  const B = abaDaSaida(guardado, 'B');                             // a reabertura, noutra aba
  await B.h.esvaziarFilaDeSaida();
  assert.deepEqual(B.enviados, ['B:v0'], 'a página que saiu deixou a decisão presa até a marca dela vencer');
  // Quem chama é o `pagehide`; a aba só ESCONDIDA (o `visibilitychange`) segue viva e mantém as marcas.
  const setup = fatiarDe(APP_SEM, 'setupDescargaAoSair');
  assert.match(setup, /addEventListener\('pagehide', \(\) => \{\s*descarregarAcaoPendente\(\);[^]*?soltarReivindicacoes\(\{ comAsDoAr: true \}\)/,
    'o `pagehide` parou de soltar as marcas da página que sai');
  assert.doesNotMatch(setup.slice(setup.indexOf("'visibilitychange'")), /soltarReivindicacoes/,
    'a aba só escondida soltou as marcas — a outra mandaria de novo o que ela tem no ar');
});

test('F1: a resposta de uma decisão que a OUTRA aba já pousou não conta de novo — nem vira "outro editor"', () => {
  const guardado = new Map();
  const A = abaDaSaida(guardado, 'A');
  const v0 = PEDIDO('v0');
  A.h.anotarAntesDoEnvio('reject', v0, 'row');
  guardado.set('waze_places_saida', '[]');                       // a outra aba o mandou, pousou e tirou
  for (const r of [{ success: true }, { success: false, errorCategory: 'already_processed' }]) {
    A.h.anotarAntesDoEnvio('reject', v0, 'row');
    guardado.set('waze_places_saida', '[]');
    A.h.handleActionResult('reject', v0, r, 'row', 0);
  }
  assert.deepEqual(A.historico, [], 'DEFEITO: o Histórico contou de novo a decisão que a outra aba já tinha contado');
  assert.deepEqual(A.diario.filter((k) => k === 'saida.saiuPorOutro').length, 2);
  // CONTROLE: com o item ainda na fila, o pouso conta como sempre.
  const c = abaDaSaida(new Map(), 'A');
  c.h.anotarAntesDoEnvio('reject', v0, 'row');
  c.h.handleActionResult('reject', v0, { success: true }, 'row', 0);
  assert.deepEqual(c.historico, ['reject']);
});

// O "Rejeitar os 2" de uma aba, com as funções de verdade da fila de saída e
// as respostas do Waze nas mãos do teste.
async function loteDeDuas({ outraAbaPousaX1 = false, respostaX1, respostaX2 = { success: true } }) {
  const tique = () => new Promise((ok) => setImmediate(ok));
  const guardado = new Map();
  const historico = [], diario = [], respostas = [], folha = [];
  const deps = {
    AppState: { authenticated: true, stats: { read: 0, rejected: 2, skipped: 0 }, fetchEpoch: 0, inFlightActions: 0, queue: [], serverTotal: 0 },
    epocaDaSessao: 0, navigator: { onLine: true }, Date: { now: () => 1_000_000 },
    safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) },
    API: { getSession: () => 'tok', get sessionToken() { return 'tok'; }, getRegion: () => 'row', rejectPlace: () => new Promise((ok) => respostas.push(ok)) },
    SAIDA_KEY: 'waze_places_saida', CONTA_KEY, SAIDA_MAX: 1000, ABA_DESTA_PAGINA: 'aba-A', SAIDA_REIVINDICACAO_MS: 60000,
    callWithRetry: (fn) => fn(), marcarEmAndamento: () => {}, dfato: (k) => diario.push(k),
    recordHistory: (tipo) => historico.push(tipo), registrarPouso: () => {}, registrarRejeicaoDeAutor: () => {},
    registrarAcaoConfirmada: () => {}, mostrarResultadoDoLote: (c) => folha.push({ ...c }), updateStats: () => {},
    saveStats: () => {}, updateInFlightIndicator: () => {}, updatePendingCount: () => {}, handleUnauthorized: () => {},
    historyTodayKey: () => '2026-10-01', ondeAgora: () => '30', getLang: () => 'pt',
  };
  const h = montar(['marcaDaSessao', 'marcaDestaAba', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido',
    'enfileirarSaida', 'tirarDaFilaDeSaida', 'reivindicacaoDestaAba', 'pousouPorOutraAba', 'soltarMarcaDosItens',
    'pousouNoWaze', 'enviarLote'], deps);
  const envio = h.enviarLote([PEDIDO('x1'), PEDIDO('x2')], { regiao: 'row' });
  await tique();
  const anotados = JSON.parse(guardado.get('waze_places_saida'));
  assert.deepEqual(anotados.map((x) => x.rv), ['aba-A', 'aba-A'], 'o lote anotou sem a marca da aba que o manda');
  if (outraAbaPousaX1) guardado.set('waze_places_saida', JSON.stringify(anotados.filter((x) => x.venueID !== 'x1')));
  respostas[0](respostaX1);
  await tique(); await tique();
  if (respostas[1]) respostas[1](respostaX2);
  await envio;
  return { historico, diario, folha, saida: JSON.parse(guardado.get('waze_places_saida')) };
}

test('F1: o lote — a resposta de um pedido que a OUTRA aba já pousou não conta de novo no Histórico', async () => {
  for (const respostaX1 of [{ success: true }, { success: false, errorCategory: 'already_processed' }]) {
    const r = await loteDeDuas({ outraAbaPousaX1: true, respostaX1 });
    assert.deepEqual(r.historico, ['reject'],
      `DEFEITO (${respostaX1.success ? 'sucesso' : 'já tratado'}): o Histórico contou de novo o pedido do lote que a outra aba já tinha contado`);
    assert.ok(r.diario.includes('saida.saiuPorOutro'));
    assert.deepEqual([r.folha.at(-1).ok, r.folha.at(-1).ja], [2, 0], 'a folha disse "outro editor" sobre a decisão da própria pessoa');
    assert.deepEqual(r.saida, []);
  }
  // CONTROLE: com os dois ainda na fila, os dois contam.
  const c = await loteDeDuas({ respostaX1: { success: true } });
  assert.deepEqual(c.historico, ['reject', 'reject'], 'CONTROLE: o harness não enxerga o pouso do lote');
});

test('F1: a decisão que FICA na fila de saída (rede, 401) perde a marca desta aba — a outra a manda na hora', async () => {
  // O ✕ do card.
  for (const resposta of [{ success: false, errorCategory: 'transient' }, { success: false, errorCategory: 'unauthorized' }]) {
    const guardado = new Map();
    const A = abaDaSaida(guardado, 'A');
    const v0 = PEDIDO('v0');
    A.h.anotarAntesDoEnvio('reject', v0, 'row');
    A.h.handleActionResult('reject', v0, resposta, 'row', 0);
    const f = JSON.parse(guardado.get('waze_places_saida'));
    assert.equal(f.length, 1, 'PRÉ-CONDIÇÃO: a decisão ficou na fila de saída');
    assert.equal(f[0].rv, undefined,
      `DEFEITO (${resposta.errorCategory}): a marca ficou — a outra aba esperava até 1 min pra mandar o que ninguém mais mandava`);
    const B = abaDaSaida(guardado, 'B');
    await B.h.esvaziarFilaDeSaida();
    assert.deepEqual(B.enviados, ['B:v0']);
  }
  // Só a marca DESTA aba sai: a da outra (que o pegou depois, a marca daqui já
  // vencida) é de quem está mandando agora.
  const guardado = new Map();
  const A = abaDaSaida(guardado, 'A');
  const v0 = PEDIDO('v0');
  A.h.anotarAntesDoEnvio('reject', v0, 'row');
  const f = JSON.parse(guardado.get('waze_places_saida'));
  f[0].rv = 'aba-B';
  guardado.set('waze_places_saida', JSON.stringify(f));
  A.h.handleActionResult('reject', v0, { success: false, errorCategory: 'transient' }, 'row', 0);
  assert.equal(JSON.parse(guardado.get('waze_places_saida'))[0].rv, 'aba-B', 'a resposta desta aba tirou a marca da OUTRA, que está mandando');
  // O lote: a rede no 1º (ele fica, o 2º pousa) e o 401 no 1º (os dois ficam).
  let r = await loteDeDuas({ respostaX1: { success: false, errorCategory: 'transient' } });
  assert.deepEqual(r.saida.map((x) => [x.venueID, x.rv]), [['x1', undefined]], 'o pedido do lote que ficou na fila seguiu com a marca');
  r = await loteDeDuas({ respostaX1: { success: false, errorCategory: 'unauthorized' } });
  assert.deepEqual(r.saida.map((x) => [x.venueID, x.rv]), [['x1', undefined], ['x2', undefined]],
    'os pedidos do lote que ficaram na fila (o 401) seguiram com a marca');
});

test('F1: o fim do esvaziamento sem a trava solta as marcas desta aba — menos a do que ela ainda tem NO AR', () => {
  const guardado = new Map([['waze_places_saida', JSON.stringify([
    { tipo: 'reject', venueID: 'v1', updateRequestID: 'uv1', rv: 'aba-A', rvEm: 1 },
    { tipo: 'reject', venueID: 'v2', updateRequestID: 'uv2', rv: 'aba-A', rvEm: 1 }])]]);
  const A = abaDaSaida(guardado, 'A');
  A.deps.pedidosEmAndamento.add('v1|uv1');
  A.h.soltarReivindicacoes();
  const f = JSON.parse(guardado.get('waze_places_saida'));
  assert.equal(f[0].rv, 'aba-A', 'a marca do que está no ar saiu — a outra aba o mandaria de novo');
  assert.equal(f[1].rv, undefined, 'CONTROLE: a marca do que esperava ficou presa');
});

test('F3: o desconto de uma decisão que não pousou, num placar ÓRFÃO (o "Sair", outra conta), não desenha nem grava', () => {
  const log = [];
  const deps = { AppState: { stats: { read: 0, rejected: 0, skipped: 0 } }, updateStats: () => log.push('desenha'), saveStats: () => log.push('grava') };
  const h = montar(['descontarGestoSemSessao'], deps);
  const orfao = { read: 0, rejected: 3, skipped: 0 };
  h.descontarGestoSemSessao('rejected', orfao, 1);
  assert.equal(orfao.rejected, 2);
  assert.deepEqual(log, [], 'DEFEITO: o desconto no placar órfão gravou o placar de agora (na outra aba, depois do "Sair")');
  // CONTROLE: o placar do gesto é o de agora (a queda com renovação) — desconta, desenha e grava.
  deps.AppState.stats.rejected = 3;
  h.descontarGestoSemSessao('rejected', deps.AppState.stats, 1);
  assert.deepEqual([deps.AppState.stats.rejected, log], [2, ['desenha', 'grava']]);
});

test('F5: região e país são da ABA — o lugar que a OUTRA aba aplica não muda o desta (o ✕ e a busca seguem a fila daqui)', () => {
  const dados = new Map([['waze_region', 'row'], ['waze_country', '30']]);
  const aba = () => {
    const ctx = { navigator: { language: 'pt', onLine: true }, document: { documentElement: {}, querySelectorAll: () => [] },
      localStorage: { getItem: (k) => (dados.has(k) ? dados.get(k) : null), setItem: (k, v) => dados.set(k, String(v)), removeItem: (k) => dados.delete(k) },
      console, setTimeout, clearTimeout, window: {} };
    vm.createContext(ctx);
    vm.runInContext(I18N + '\n' + ler('js/api.js') + '\nthis.API = API;', ctx);
    return ctx.API;
  };
  const A = aba(), B = aba();
  assert.deepEqual([B.getRegion(), B.getCountry()], ['row', 30]);
  A.setRegion('na'); A.setCountry(235);                            // a OUTRA aba aplica a América do Norte
  assert.deepEqual([B.getRegion(), B.getCountry()], ['row', 30],
    'DEFEITO: a região e o país da outra aba entraram nesta — o ✕ daqui iria pro servidor de lá');
  // CONTROLE: o aparelho guardou a escolha de lá — uma aba nova (ou esta, depois do "Sair" de lá) a lê.
  assert.deepEqual([aba().getRegion(), aba().getCountry()], ['na', 235]);
  B.esquecerLugar();
  assert.deepEqual([B.getRegion(), B.getCountry()], ['na', 235]);
  // E o gesto DESTA aba troca o dela e grava, como sempre.
  B.setCountry(181);
  assert.deepEqual([B.getRegion(), B.getCountry(), dados.get('waze_country')], ['na', 181, '181']);
  // A região antiga (`world`) segue virando `na` na leitura.
  dados.set('waze_region', 'world');
  assert.equal(aba().getRegion(), 'na');
  // O "Sair" noutra aba faz esta reler o lugar de fábrica que ele gravou.
  assert.match(fatiarDe(APP_SEM, 'handleLogout'), /\} else \{\s*API\.esquecerLugar\(\);\s*\}/);
});

test('F6: a fila de saída que muda noutra aba redesenha o "esperando envio" daqui', () => {
  const comp = armazenamentoCompartilhado(sessaoNoAparelho);
  const A = abrirAba(comp), B = abrirAba(comp);
  A.deps.safeLS.set('waze_places_saida', '[]');                   // a A mandou a decisão que esperava
  comp.entregar();
  assert.equal(B.indicador, 1, 'DEFEITO: a aba B seguiu mostrando "1 esperando envio" depois de a A mandar');
  // CONTROLE: o aviso de outra chave não redesenha o indicador.
  A.deps.safeLS.set('waze_places_lang', '"pt"');
  comp.entregar();
  assert.equal(B.indicador, 1);
});

test('F7: o diálogo do "Sair" não conta como perdida a decisão que está NO AR (nesta aba ou na outra)', () => {
  const agora = Date.now();
  const itens = [ITEM('v1'), { ...ITEM('v2'), rv: 'outra-aba', rvEm: agora }, ITEM('v3')];
  let m = montarAviso(itens, { noAr: ['v1|uv1'] });
  m.h.desenharAvisoDoSair();
  assert.equal(m.el.textContent, 'modal.logout.saida:{"n":1}',
    'DEFEITO: o diálogo diz que não chega ao Waze a decisão que já está saindo');
  // CONTROLE: a marca da outra aba vencida (ela morreu) e nada no ar — as três esperam.
  m = montarAviso([ITEM('v1'), { ...ITEM('v2'), rv: 'outra-aba', rvEm: agora - 61_000 }, ITEM('v3')]);
  m.h.desenharAvisoDoSair();
  assert.equal(m.el.textContent, 'modal.logout.saidaPlural:{"n":3}');
});

test('F4: a área gerenciada salva que o perfil não tem sai do filtro — e a fila que saiu com ela é refeita', async () => {
  const montarArea = ({ area = '9001', myArea = false } = {}) => {
    const log = [];
    const deps = {
      AppState: { filters: { managedAreaId: area, myArea }, currentPlace: null, profile: null },
      saveFilters: () => log.push('grava'), resetQueue: () => log.push('fila nova'), startFetching: () => log.push('busca'),
      epocaDaSessao: 0, filaEsperaPerfil: false, paisDoPerfil: async () => null, caixaDaMinhaArea: () => [1, 2, 3, 4],
      aplicarRecusaAutomatica: () => {}, sortQueue: () => {}, window: {},
    };
    const h = montar(['completarPerfilChegado', 'esquecerAreaForaDoPerfil', 'refazerFilaReal'], deps);
    return { h, deps, log };
  };
  let m = montarArea();
  await m.h.completarPerfilChegado({ id: 2, managedAreas: [] }, 0);
  assert.equal(m.deps.AppState.filters.managedAreaId, '', 'DEFEITO: a área que o perfil não tem seguiu no filtro (os Filtros dizem "Nenhuma")');
  assert.deepEqual(m.log, ['grava', 'fila nova', 'busca'], 'a fila que saiu filtrada pela área não foi refeita');
  // CONTROLES: o perfil TEM a área — nada muda; perfil sem a lista — não decide; com "Minha área" — sai, sem refazer.
  m = montarArea();
  await m.h.completarPerfilChegado({ id: 2, managedAreas: [{ id: '9001', name: 'Área SP' }] }, 0);
  assert.deepEqual([m.deps.AppState.filters.managedAreaId, m.log], ['9001', []]);
  m = montarArea();
  await m.h.completarPerfilChegado({ id: 2 }, 0);
  assert.deepEqual([m.deps.AppState.filters.managedAreaId, m.log], ['9001', []]);
  m = montarArea({ myArea: true });
  await m.h.completarPerfilChegado({ id: 2, managedAreas: [] }, 0);
  assert.deepEqual([m.deps.AppState.filters.managedAreaId, m.log], ['', ['grava']]);
});

test('F4: a troca de conta tira do filtro a área gerenciada da conta anterior — e refaz a fila que saiu com ela', () => {
  const trocar = ({ queue = [], fetching = false, myArea = false } = {}) => {
    const log = [];
    const deps = {
      AppState: { stats: {}, preferences: {}, filters: { managedAreaId: '9001', stateId: '25', myArea }, pendingAction: null, queue, fetching },
      safeLS: aparelho().safeLS, filaAtravessouSessao: false, saveFilters: () => log.push('grava'),
      resetQueue: () => log.push('fila nova'), startFetching: () => log.push('busca'),
    };
    const h = montar(['esquecerOutraConta'], deps);
    h.esquecerOutraConta('222');
    return { deps, log };
  };
  // A abertura com a sessão salva: a busca saiu (ou está saindo) antes de o perfil dizer de quem é.
  for (const fila of [{ queue: [{ venueID: 'v1' }] }, { fetching: true }]) {
    const m = trocar(fila);
    assert.equal(m.deps.AppState.filters.managedAreaId, '', 'DEFEITO: a busca de quem entrou sairia filtrada pela área da conta anterior');
    assert.equal(m.deps.AppState.filters.stateId, '25', 'o estado é escolha do aparelho, e fica');
    assert.deepEqual(m.log, ['grava', 'fila nova', 'busca'], 'a fila que saiu filtrada pela área da conta anterior ficou na tela');
  }
  // CONTROLES: no login a conta chega antes da 1ª busca (nada a refazer); com "Minha área" a busca não usou a área.
  assert.deepEqual(trocar().log, ['grava']);
  assert.deepEqual(trocar({ queue: [{ venueID: 'v1' }], myArea: true }).log, ['grava']);
});

// ═══ R8-1-03 · o "Sair" com DUAS sessões da mesma conta, uma em cada aba ═══════
// A aba B entrou de novo (o ACESSAR do WME é uma sessão nova a cada toque; ou os
// cookies colados), e a aba A seguiu com a dela: a mesma conta, duas sessões. O
// "Sair" apagava no servidor só UMA — a da aba que saiu —, e a outra ficava viva,
// órfã, por até 21 dias, nos dois sentidos (MEDIDO no Chromium: "Sair" na B
// apagava `tok-x2` e deixava `tok-x`; na A, o espelho; auditoria de 2026-10-03).
// O contrato do "Sair" é apagar dos DOIS lados. Agora: a aba do "Sair" apaga a
// dela e a GUARDADA no aparelho (que ela tira do aparelho), e a outra aba apaga a
// dela se não for a que a do "Sair" tirou — o aviso do token diz qual.

test('R8-1-03: na OUTRA aba, com uma sessão DIFERENTE da que saiu, a aba apaga a SUA no servidor — sem tocar no aparelho', async () => {
  const m = montarSair({ tokenNoAparelho: null });
  m.ap.dados.delete(TOKEN);                       // o "Sair" de lá já tirou o token do aparelho
  m.deps.tokenTiradoPorOutraAba = 'tok-B';        // e era o da OUTRA sessão
  await m.h.handleLogout({ porOutraAba: true });
  assert.deepEqual(m.log.filter((x) => typeof x === 'string' && x.startsWith('destroy:')), ['destroy:tok-A'],
    'DEFEITO: a sessão desta aba (outra que não a do "Sair") ficou viva no servidor — órfã por até 21 dias');
  assert.deepEqual(m.ap.escritas, [], 'a aba que só soube do "Sair" mexeu no aparelho: ' + m.ap.escritas.join(' '));
  assert.ok(m.log.includes('soltou') && !m.log.includes('setSession:null'), 'o token saiu pelo `setSession` (o diário ganharia um "token-")');
  assert.equal(m.deps.tokenTiradoPorOutraAba, null, 'a marca da sessão tirada ficou pra um "Sair" seguinte');
  // CONTROLE: a outra aba tirou a MESMA sessão desta — já apagada lá, e daqui nada sai.
  const c = montarSair({ tokenNoAparelho: null });
  c.ap.dados.delete(TOKEN);
  c.deps.tokenTiradoPorOutraAba = 'tok-A';
  await c.h.handleLogout({ porOutraAba: true });
  assert.ok(!c.log.some((x) => typeof x === 'string' && x.startsWith('destroy:')), 'CONTROLE: a aba apagou de novo a sessão que a outra já apagou');
  // Sem saber qual saiu (o armazenamento limpo inteiro): apaga a dela — o servidor lê antes de apagar.
  const n = montarSair({ tokenNoAparelho: null });
  n.ap.dados.delete(TOKEN);
  await n.h.handleLogout({ porOutraAba: true });
  assert.ok(n.log.includes('destroy:tok-A'), 'sem saber qual sessão saiu, a desta ficou no servidor');
});

test('R8-1-03: o "Sair" desta aba apaga no servidor a SUA e a GUARDADA no aparelho, quando são outras', async () => {
  const m = montarSair({ tokenNoAparelho: 'tok-B' });   // a guardada é a da outra aba (que entrou de novo)
  await m.h.handleLogout();
  const apagadas = m.log.filter((x) => typeof x === 'string' && x.startsWith('destroy:')).sort();
  assert.deepEqual(apagadas, ['destroy:tok-A', 'destroy:tok-B'],
    'DEFEITO: o "Sair" tirou do aparelho a sessão da outra aba e a deixou viva no servidor: ' + apagadas.join(' '));
  // CONTROLE: a mesma sessão (o caso comum) sai UMA vez — nenhum pedido a mais no free tier.
  const c = montarSair();
  await c.h.handleLogout();
  assert.deepEqual(c.log.filter((x) => typeof x === 'string' && x.startsWith('destroy:')), ['destroy:tok-A']);
  // A recusa do portão não apaga nada: o servidor já apagou a recusada.
  const r = montarSair({ tokenNoAparelho: 'tok-B' });
  r.API.sessionToken = null;
  await r.h.handleLogout({ recusado: true });
  assert.ok(!r.log.some((x) => typeof x === 'string' && x.startsWith('destroy:')), 'a recusa do portão apagou uma sessão no servidor');
});

// O caminho INTEIRO, pelos avisos do navegador na ordem em que a outra aba grava:
// o do token (com o `oldValue`) e depois o da conta, que é onde o "Sair" costuma
// ser decidido (ver `aoSairEmOutraAba`).
test('R8-1-03: pelos avisos de verdade — o do token diz QUAL sessão saiu, e o da conta decide o "Sair"', async () => {
  const caso = async ({ desta, guardada }) => {
    const m = montarSair({ tokenNoAparelho: guardada });
    m.API.sessionToken = desta;
    m.API.temSessaoNaMemoria = function () { return !!this.sessionToken; };
    const h = montar(['aoGravarEmOutraAba', 'sincronizarComOutraAba', 'aoSairEmOutraAba', 'aoEntrarOutraContaEmOutraAba',
      'contaSegueNoAparelho', 'sessaoDestaAbaEhAGuardada', 'handleLogout', 'preferenciasDeFabrica'], m.deps);
    // A outra aba dá "Sair": tira o token e, depois, a conta.
    m.ap.dados.delete(TOKEN);
    h.aoGravarEmOutraAba({ key: TOKEN, oldValue: guardada, newValue: null });
    const antesDaConta = m.log.filter((x) => typeof x === 'string' && x.startsWith('destroy:'));
    m.ap.dados.delete(CONTA_KEY);
    h.aoGravarEmOutraAba({ key: CONTA_KEY, oldValue: '{"id":"111"}', newValue: null });
    await new Promise((ok) => setImmediate(ok));
    m.ap.escritas.length = 0;   // (o harness apagou o aparelho à mão acima)
    return { antesDaConta, apagadas: m.log.filter((x) => typeof x === 'string' && x.startsWith('destroy:')),
      saiu: m.AppState.authenticated === false, log: m.log };
  };
  const duas = await caso({ desta: 'tok-A', guardada: 'tok-B' });
  assert.ok(duas.saiu, 'PRÉ-CONDIÇÃO: a aba não saiu com o "Sair" da outra');
  assert.deepEqual(duas.antesDaConta, [], 'PRÉ-CONDIÇÃO: com a conta ainda no aparelho, o aviso do token não é o "Sair"');
  assert.deepEqual(duas.apagadas, ['destroy:tok-A'],
    'DEFEITO: o "Sair" noutra aba deixou a sessão DESTA viva no servidor (era outra que não a que saiu)');
  // CONTROLE: a mesma sessão nas duas abas — a outra já a apagou.
  const uma = await caso({ desta: 'tok-A', guardada: 'tok-A' });
  assert.ok(uma.saiu, 'PRÉ-CONDIÇÃO: a aba não saiu com o "Sair" da outra');
  assert.deepEqual(uma.apagadas, [], 'CONTROLE: a aba apagou de novo a sessão que a outra já apagou');
});

// ═══ R9-1-03 · a aba SEM sessão não puxa a sessão que OUTRA aba guardou ════════
// O `getSession` do api.js, com a memória vazia, LÊ o aparelho e GRAVA na memória
// o que leu. As guardas da abertura e da volta à aba o usavam pra perguntar "esta
// aba já entrou?", e a sessão que OUTRA aba guardou passava por elas como se fosse
// desta (auditoria de 2026-10-06, R9-1-03): (a) a abertura que perguntava à
// extensão ficava EM BRANCO, só com o cabeçalho; (b) a aba da tela de entrada
// passava a contar como logada, e o "Sair" da outra a encerrava. O `api.js` aqui
// é o DE VERDADE (num contexto do `vm`, com um armazenamento de mentira): é nele
// que mora o efeito, e um dublê o esconderia.
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
// (com o campo de cada um), a Ajuda (que não é dela) e o FOCO. O `contains` vai
// pela cadeia de pais, como no DOM. A adoção e o foco (R10-1-03, R10-1-05) leem
// isto — a tela de entrada na tela, os diálogos abertos e onde está o foco.
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
  el('langSelectHelp', { pai: el('helpModal', { oculto: dialogo !== 'helpModal' }) });
  el('appScreen', { oculto: true });
  const body = { id: 'BODY' };
  const document = { visibilityState: 'visible', body, documentElement: { id: 'HTML' }, getElementById: (id) => els[id] || null };
  Object.defineProperty(document, 'activeElement', { get: () => (foco ? els[foco] : body) });
  return {
    els, document,
    // O `closeModal` de verdade: esconde e roda a limpeza do campo.
    fechar(id) {
      els[id].classList.add('hidden');
      if (id === 'pasteModal') els.cookiesTextarea.value = '';
      if (id === 'pairEnterModal') els.pairCodeInput.value = '';
    },
    // A abertura com sessão salva mostra o app (o `showMainScreen`).
    mostrarOApp() { els.authScreen.classList.add('hidden'); els.appScreen.classList.remove('hidden'); },
  };
}
const MODAIS_DA_ENTRADA = constante('MODAIS_DA_ENTRADA');
const BOTAO_DA_ACAO = constante('BOTAO_DA_ACAO');
// As funções da ADOÇÃO da sessão do aparelho (R9-1-03 a, R10-1-03, R10-1-04),
// todas de verdade.
const ADOCAO = ['adotarSessaoDoAparelho', 'textoDigitadoNaEntrada', 'focoNaTelaDeEntrada', 'fecharModaisDaEntrada',
  'aoEntrarNestaPagina'];
// O que a adoção lê e escreve, sem sessão e sem nada no ar; `log` anota o que ela faz.
function depsDaAdocao(real, t, log, AppState) {
  return {
    API: real.API, safeLS: real.safeLS, AppState, document: t.document, MODAIS_DA_ENTRADA, BOTAO_DA_ACAO,
    extPerguntando: false, resgateEmVoo: false, authInFlight: false, saiuNestaPagina: false, extNegadoNestaPagina: false, extNegado: null,
    focoDoTeclado: null,
    // O fechamento que NÃO devolve o foco a quem abriu (ele já foi prometido, R10-1-05) é anotado.
    closeModal: (id, o) => { log.push('fechou ' + id + (o && o.focoComDestino ? ' (o foco já tem destino)' : '')); t.fechar(id); },
    resetQueue: () => log.push('fila nova'),
    // A abertura com sessão salva, com a sessão que a memória tem NA HORA — e o app na tela.
    abrirComSessaoSalva: () => { log.push('abriu com ' + real.API.sessionToken); AppState.authenticated = true; t.mostrarOApp(); },
  };
}

// A ABERTURA sem sessão, no fim da pergunta à extensão (`aoFimDaPerguntaDaAbertura`).
function aberturaSemSessao(guardado = {}, tela = {}) {
  const real = apiDeVerdade(guardado);
  const log = [];
  const AppState = { authenticated: false, profile: null };
  const t = telaDeEntrada(tela);
  const deps = {
    ...depsDaAdocao(real, t, log, AppState),
    // Uma recusa que a extensão repassou nesta pergunta (o portão negou a conta do WME).
    extNegado: { errorCategory: 'access_denied' },
    showAuthScreen: () => log.push('tela de entrada'),
    showAccessDenied: () => log.push('recusa mostrada'),
  };
  const h = montar(['aoFimDaPerguntaDaAbertura', ...ADOCAO, 'tirarNegadoDaExtensao', 'mostrarNegadoDaExtensao'], deps);
  return { ...real, h, log, AppState, deps, tela: t };
}
// A tela que a abertura decidiu — ou nenhuma: a tela EM BRANCO.
const decidiuATela = (log) => log.some((x) => x === 'tela de entrada' || x.startsWith('abriu com '));

test('R9-1-03 (a): a abertura que pergunta à extensão ADOTA a sessão que OUTRA aba guardou nesse meio — nunca a tela em branco', () => {
  // A aba abriu SEM sessão e perguntou à extensão ("Entrando pelo WME…"); nesse
  // meio a pessoa entrou pela OUTRA aba, e o token foi pro aparelho. A extensão
  // responde sem sessão.
  const m = aberturaSemSessao();
  m.dados.set(TOKEN, 'tok-da-outra');
  m.h.aoFimDaPerguntaDaAbertura(false);
  assert.ok(decidiuATela(m.log),
    'DEFEITO: a aba ficou EM BRANCO — nem a tela de entrada, nem o app (a guarda tomou a sessão da outra aba pela desta)');
  // A fila é NOVA, como em todo login (R10-1-03: a que sobra na memória é de uma sessão que caiu).
  assert.deepEqual(m.log, ['fila nova', 'abriu com tok-da-outra'],
    'a sessão que a outra aba guardou não foi ADOTADA como numa abertura com sessão salva: ' + JSON.stringify(m.log));
  assert.equal(m.deps.extNegado, null, 'a recusa que a extensão repassou ficou pendurada pra aparecer por cima do app');
  // CONTROLE: ninguém entrou — a tela de entrada (com a recusa, se houver), e a memória segue vazia.
  const c = aberturaSemSessao();
  c.h.aoFimDaPerguntaDaAbertura(false);
  assert.deepEqual(c.log, ['tela de entrada', 'recusa mostrada']);
  assert.equal(c.API.temSessaoNaMemoria(), false);
  // O login feito NESTA aba nesse meio (o `setSession` de verdade) já decidiu a tela: nada aqui.
  const l = aberturaSemSessao();
  l.API.setSession('tok-desta', 'cookies');
  l.h.aoFimDaPerguntaDaAbertura(false);
  assert.deepEqual(l.log, [], 'o fim da pergunta atropelou o login feito nesta aba');
  // O app já montado nesta aba, e a extensão que entrou: nada também.
  const a = aberturaSemSessao({ [TOKEN]: 'tok-injetado' });
  a.AppState.authenticated = true;
  a.h.aoFimDaPerguntaDaAbertura(false);
  assert.deepEqual(a.log, [], 'o fim da pergunta mexeu no app já montado');
  const e = aberturaSemSessao({ [TOKEN]: 'tok-da-extensao' });
  e.h.aoFimDaPerguntaDaAbertura(true);
  assert.deepEqual(e.log, []);
  // Quem chama: o ramo SEM sessão do `initApp`.
  assert.match(fatiarDe(APP_SEM, 'initApp'), /^\s+entrarPelaExtensao\(\)\.then\(aoFimDaPerguntaDaAbertura\);/m,
    'a abertura sem sessão deixou de passar por esta guarda');
});

// A aba da TELA DE ENTRADA: a volta a ela (`aoVoltarAAba`, em todo aparelho; a
// pergunta à extensão, onde ela instala) e os avisos do "Sair" dado na outra.
function abaDaEntrada(guardado = {}, { tela = {}, podeInstalar = true } = {}) {
  const real = apiDeVerdade(guardado);
  const log = [];
  const AppState = { authenticated: false, profile: null };
  const t = telaDeEntrada(tela);
  let responder = null;
  const deps = {
    ...depsDaAdocao(real, t, log, AppState),
    CONTA_KEY, STATS_KEY, PREFERENCES_KEY,
    podeInstalarExtensao: () => podeInstalar,
    // A pergunta fica no ar até o TESTE responder (`responderExtensao`).
    entrarPelaExtensao: (o) => {
      log.push('perguntou à extensão' + (o && o.silencioso ? ' (em silêncio)' : ''));
      return new Promise((ok) => { responder = ok; });
    },
    mostrarNegadoDaExtensao: () => log.push('recusa'),
    handleLogout: (o) => log.push(['sair', o]),
  };
  const h = montar(['aoVoltarAAba', 'perguntarAExtensaoAoVoltar', ...ADOCAO,
    'sincronizarComOutraAba', 'aoSairEmOutraAba', 'aoEntrarOutraContaEmOutraAba',
    'contaSegueNoAparelho', 'sessaoDestaAbaEhAGuardada', 'contaDestaAbaEmDuvida', 'marcaDaSessao', 'marcaDestaAba'], deps);
  return { ...real, h, log, deps, AppState, tela: t, responderExtensao: (v) => responder(v) };
}
// O "Sair" na outra aba: o token e a conta saem do aparelho, e os avisos chegam aqui na ordem em que ela gravou.
function sairNaOutra(m) {
  m.dados.delete(TOKEN);
  m.h.sincronizarComOutraAba(TOKEN);
  m.dados.delete(CONTA_KEY);
  m.h.sincronizarComOutraAba(CONTA_KEY);
}
const DA_OUTRA = { [TOKEN]: 'tok-da-outra', [CONTA_KEY]: '{"id":"4242","s":"x"}' };
const COLANDO = { dialogo: 'pasteModal', texto: 'COOKIES_QUE_ESTOU_COLANDO', foco: 'cookiesTextarea' };

// A volta à aba ADOTA a sessão da outra (R10-1-03, abaixo) — menos com TEXTO
// DIGITADO num diálogo da entrada: aí vale o que o R9-1-03 (b) garantiu, e a aba
// segue sem sessão na memória, sem virar "logada" sem mostrar o app.
test('R9-1-03 (b): a volta à aba com o "Colar cookies" digitado não puxa pra memória a sessão da outra — e o "Sair" de lá não encerra esta', () => {
  const m = abaDaEntrada(DA_OUTRA, { tela: COLANDO });
  m.h.aoVoltarAAba();
  assert.equal(m.API.temSessaoNaMemoria(), false,
    'DEFEITO: a volta à aba gravou na memória desta (que nunca entrou) a sessão que a outra guardou');
  assert.deepEqual(m.log, [],
    'com o "Colar cookies" digitado, a volta à aba fechou o diálogo, adotou a sessão da outra ou perguntou à extensão: ' + JSON.stringify(m.log));
  assert.equal(m.tela.els.cookiesTextarea.value, COLANDO.texto, 'o que estava sendo colado sumiu na volta à aba');
  sairNaOutra(m);
  assert.deepEqual(m.log, [],
    'DEFEITO: a aba que nunca entrou foi encerrada pelo "Sair" da outra — o "Colar cookies" fechava, apagando o colado, e o aviso dizia "Você saiu em outra aba"');
  // O código digitado no "Entrar com um código" vale o mesmo.
  const cod = abaDaEntrada(DA_OUTRA, { tela: { dialogo: 'pairEnterModal', texto: 'ABC-234', foco: 'pairCodeInput' } });
  cod.h.aoVoltarAAba();
  assert.deepEqual(cod.log, [], 'o código que a pessoa digitava foi jogado fora pela volta à aba');
  assert.equal(cod.API.temSessaoNaMemoria(), false);
  // CONTROLE: sem sessão nenhuma no aparelho, a volta à aba pergunta à extensão (o ouvinte enxerga a tela de entrada).
  const c = abaDaEntrada();
  c.h.aoVoltarAAba();
  assert.deepEqual(c.log, ['perguntou à extensão (em silêncio)']);
  // CONTROLE do instrumento: com a sessão da outra na memória desta (o que o
  // `getSession` de verdade faz com a memória vazia), o "Sair" de lá a encerra.
  const d = abaDaEntrada(DA_OUTRA, { tela: COLANDO });
  assert.equal(d.API.getSession(), 'tok-da-outra');
  assert.equal(d.API.temSessaoNaMemoria(), true, 'CONTROLE: o `getSession` de verdade não grava mais na memória — o mecanismo mudou, reveja o teste');
  sairNaOutra(d);
  assert.deepEqual(d.log, [['sair', { porOutraAba: true }]],
    'CONTROLE: com a sessão na memória, o "Sair" da outra aba devia encerrar esta — a medida não enxerga o defeito');
});

// ═══ R10-1-03 · a volta à aba da tela de entrada ADOTA a sessão do aparelho ═════
// A pessoa entrou pela outra aba (ou tem outra aba logada) e voltou à que estava
// na tela de entrada: ela seguia no "Bem-vindo!", sem perguntar à extensão nem
// adotar a sessão guardada, até recarregar — e o ouvinte da volta só existia
// onde a extensão instala (auditoria da rodada 10, R10-1-03, MEDIDO). DECIDIDO
// como o R9-1-03: a volta adota como a abertura, em TODO aparelho.
test('R10-1-03: a volta à aba da tela de entrada ADOTA a sessão que outra aba guardou — em todo aparelho, como a abertura', async () => {
  for (const podeInstalar of [true, false]) {
    const onde = podeInstalar ? 'computador com a extensão' : 'celular';
    const m = abaDaEntrada(DA_OUTRA, { podeInstalar });
    m.h.aoVoltarAAba();
    assert.equal(m.API.sessionToken, 'tok-da-outra',
      `DEFEITO (${onde}): a volta à aba deixou a pessoa no "Bem-vindo!" com a sessão viva no aparelho`);
    assert.deepEqual(m.log, ['fila nova', 'abriu com tok-da-outra'],
      `(${onde}) a volta não abriu como a abertura com sessão salva (fila nova, sem pergunta à extensão): ` + JSON.stringify(m.log));
    // E agora a aba É logada, com o app na tela: o "Sair" da outra a encerra, como a qualquer aba logada.
    sairNaOutra(m);
    assert.deepEqual(m.log.slice(2), [['sair', { porOutraAba: true }]], `(${onde}) o "Sair" da outra não chegou à aba que adotou`);
  }
  // O diálogo da entrada ABERTO e VAZIO (o "Colar", o "Acesso restrito"): fecha com a limpeza, e a sessão entra.
  for (const dialogo of ['pasteModal', 'accessDeniedModal']) {
    const v = abaDaEntrada(DA_OUTRA, { tela: { dialogo, texto: '  ' } });
    v.h.aoVoltarAAba();
    assert.deepEqual(v.log, ['fechou ' + dialogo, 'fila nova', 'abriu com tok-da-outra'],
      `com o ${dialogo} aberto e vazio, a volta não adotou (ou deixou o diálogo por cima do app): ` + JSON.stringify(v.log));
  }
  // CONTROLE: a página escondida, e a tela de entrada fora da tela (o "Entrando pelo WME…"): nada.
  const f = abaDaEntrada(DA_OUTRA);
  f.tela.document.visibilityState = 'hidden';
  f.h.aoVoltarAAba();
  const s = abaDaEntrada(DA_OUTRA);
  s.tela.els.authScreen.classList.add('hidden');
  s.h.aoVoltarAAba();
  for (const x of [f, s]) {
    assert.deepEqual(x.log, [], 'a volta adotou com a página escondida ou sem a tela de entrada');
    assert.equal(x.API.temSessaoNaMemoria(), false);
  }
  // CONTROLE: uma pergunta à extensão, um resgate de código ou os cookies desta aba
  // sendo conferidos, no AR — o fim deles decide (o login que a pessoa pediu vence).
  for (const noAr of ['extPerguntando', 'resgateEmVoo', 'authInFlight']) {
    const p = abaDaEntrada(DA_OUTRA);
    p.deps[noAr] = true;
    p.h.aoVoltarAAba();
    assert.deepEqual(p.log, [], `a volta adotou com ${noAr} — duas aberturas uma por cima da outra`);
    assert.equal(p.API.temSessaoNaMemoria(), false);
  }
  // O FIM da pergunta da volta: a outra aba entrou enquanto a extensão respondia
  // (sem sessão) — a sessão dela entra, como no fim da pergunta da abertura.
  const q = abaDaEntrada();
  q.h.aoVoltarAAba();
  assert.deepEqual(q.log, ['perguntou à extensão (em silêncio)'], 'PRÉ-CONDIÇÃO: sem sessão no aparelho, a volta pergunta à extensão');
  q.dados.set(TOKEN, 'tok-da-outra');
  q.responderExtensao(false);
  await tiqueAba();
  assert.deepEqual(q.log.slice(1), ['fila nova', 'abriu com tok-da-outra'],
    'a sessão que a outra aba guardou durante a pergunta da volta não entrou: ' + JSON.stringify(q.log));
  // CONTROLE: ninguém entrou nesse meio — a recusa (se houver), e a memória vazia.
  const n = abaDaEntrada();
  n.h.aoVoltarAAba();
  n.responderExtensao(false);
  await tiqueAba();
  assert.deepEqual(n.log, ['perguntou à extensão (em silêncio)', 'recusa']);
  assert.equal(n.API.temSessaoNaMemoria(), false);
  // Quem chama: o ouvinte da volta, em TODO aparelho (a pergunta à extensão é que fica onde ela instala).
  const ouvintes = fatiarDe(APP_SEM, 'setupAppListeners');
  assert.match(ouvintes, /^\s+document\.addEventListener\('visibilitychange', aoVoltarAAba\);/m,
    'a volta à aba deixou de passar por `aoVoltarAAba`');
  assert.doesNotMatch(ouvintes, /if \(podeInstalarExtensao\(\)\) document\.addEventListener\('visibilitychange'/,
    'o ouvinte da volta voltou a existir só onde a extensão instala: no celular a volta não adota');
});

// ═══ R10-1-04 · o link de pareamento que FALHA, sem sessão salva ════════════════
// O link vencido (o QR de ontem) aberto sem sessão salva deixava a pessoa no
// "Bem-vindo!" com o "Código inválido" e mais nada: a abertura pelo link não
// pergunta à extensão, e a sessão que outra aba guardou durante o resgate não era
// adotada (auditoria da rodada 10, R10-1-04, MEDIDO).
function linkDePareamento({ guardado = {}, tela = {}, outraEntra = false, entraNestaAba = false } = {}) {
  const real = apiDeVerdade(guardado);
  const log = [];
  const AppState = { authenticated: false, profile: null };
  const t = telaDeEntrada(tela);
  const deps = {
    ...depsDaAdocao(real, t, log, AppState),
    showAuthScreen: () => log.push('tela de entrada'),
    // O resgate RECUSADO (o código venceu); nesse meio, a outra aba (ou esta) pode entrar.
    // `entraNestaAba: 'so-memoria'`: o login desta aba que o aparelho NÃO guardou (o
    // armazenamento bloqueado, o modo privado) — só a memória sabe dele.
    resgatarPareamento: async (codigo, o) => {
      if (outraEntra) real.dados.set(TOKEN, 'tok-da-outra');
      if (entraNestaAba === 'so-memoria') real.API.sessionToken = 'tok-desta';
      else if (entraNestaAba) real.API.setSession('tok-desta', 'cookies');
      log.push('código inválido' + (o && o.silencioso ? ' (aviso)' : ''));
      return false;
    },
    entrarPelaExtensao: (o) => { log.push('perguntou à extensão' + (o && o.silencioso ? ' (em silêncio)' : '')); return Promise.resolve(false); },
    aoFimDaPerguntaDaAbertura: (entrou) => log.push('fim da pergunta da abertura:' + entrou),
  };
  const h = montar(['abrirPeloCodigoDaURL', ...ADOCAO], deps);
  return { ...real, h, log };
}

test('R10-1-04: o link de pareamento que falha, sem sessão salva — a sessão da outra aba entra; sem ela, a extensão é perguntada como na abertura', async () => {
  // A outra aba entrou durante o resgate: a sessão dela é adotada, sem perguntar à extensão.
  const o = linkDePareamento({ outraEntra: true });
  await o.h.abrirPeloCodigoDaURL('VENCIDO');
  assert.equal(o.API.sessionToken, 'tok-da-outra', 'DEFEITO: a sessão que a outra aba guardou durante o resgate não entrou');
  assert.deepEqual(o.log, ['tela de entrada', 'código inválido (aviso)', 'fila nova', 'abriu com tok-da-outra'],
    'o link que falhou não abriu com a sessão do aparelho como a abertura: ' + JSON.stringify(o.log));
  // Ninguém entrou: a extensão é perguntada como na ABERTURA comum (com o "Entrando pelo WME…"), e o fim é o dela.
  const n = linkDePareamento();
  await n.h.abrirPeloCodigoDaURL('VENCIDO');
  assert.deepEqual(n.log, ['tela de entrada', 'código inválido (aviso)', 'perguntou à extensão', 'fim da pergunta da abertura:false'],
    'DEFEITO: o link que falhou deixou a pessoa no "Bem-vindo!" sem perguntar à extensão: ' + JSON.stringify(n.log));
  // CONTROLE: a pessoa entrou NESTA aba durante o resgate (o colar) — nada por cima, nem
  // com o aparelho sem guardar a sessão dela (aí a extensão traria outra por cima da desta).
  for (const entraNestaAba of [true, 'so-memoria']) {
    const e = linkDePareamento({ entraNestaAba });
    await e.h.abrirPeloCodigoDaURL('VENCIDO');
    assert.deepEqual(e.log, ['tela de entrada', 'código inválido (aviso)'],
      `o fim do resgate atropelou o login feito nesta aba (${entraNestaAba}): ` + JSON.stringify(e.log));
    assert.equal(e.API.sessionToken, 'tok-desta');
  }
  // CONTROLE: a outra aba entrou, mas há TEXTO digitado no "Colar" — a tela fica como está, e a extensão
  // não é perguntada (com sessão no aparelho, ela traria outra por cima da guardada).
  const t = linkDePareamento({ outraEntra: true, tela: COLANDO });
  await t.h.abrirPeloCodigoDaURL('VENCIDO');
  assert.deepEqual(t.log, ['tela de entrada', 'código inválido (aviso)'], JSON.stringify(t.log));
  assert.equal(t.API.temSessaoNaMemoria(), false);
  // CONTROLE: com sessão SALVA, o caminho de sempre — a sessão salva abre, sem pergunta nem fila nova.
  const s = linkDePareamento({ guardado: { [TOKEN]: 'tok-salvo' } });
  await s.h.abrirPeloCodigoDaURL('VENCIDO');
  assert.deepEqual(s.log, ['código inválido (aviso)', 'abriu com tok-salvo'], JSON.stringify(s.log));
});

// ═══ R10-1-05 · o foco que estava NA tela de entrada vai ao ✕ do primeiro card ══
// A extensão que entra pela volta à aba (e a adoção da sessão do aparelho)
// esconde a tela de entrada com o foco nela — no "Colar cookies", no campo dele
// —, e o foco caía no <body>: o Tab seguinte ia ao mapa do card (auditoria da
// rodada 10, R10-1-05, MEDIDO). Ele fica prometido ao ✕ do primeiro card, como
// no login pelo teclado (R7-1-04); com o foco no <body>, nada se move.
test('R10-1-05: a ADOÇÃO com o foco na tela de entrada (ou num diálogo dela) o promete ao ✕ do primeiro card; com ele no <body>, não', () => {
  for (const tela of [{ foco: 'pasteBtn' }, { dialogo: 'pasteModal', foco: 'cookiesTextarea' },
    { dialogo: 'accessDeniedModal', foco: 'closeAccessDenied' }]) {
    const m = abaDaEntrada(DA_OUTRA, { tela });
    m.h.aoVoltarAAba();
    assert.equal(m.API.sessionToken, 'tok-da-outra', 'PRÉ-CONDIÇÃO: a volta não adotou ' + JSON.stringify(tela));
    assert.equal(m.deps.focoDoTeclado, BOTAO_DA_ACAO.left,
      `DEFEITO: o foco em ${tela.foco} caiu no <body> com a tela de entrada escondida (o Tab seguinte ia ao mapa do card)`);
    // O diálogo fecha SEM devolver o foco a quem o abriu: o "Acesso restrito" que o app
    // abriu sozinho o devolvia ao ⓘ do topo, que é vivo, e a promessa caía.
    if (tela.dialogo) assert.ok(m.log.includes(`fechou ${tela.dialogo} (o foco já tem destino)`), JSON.stringify(m.log));
  }
  // A abertura que adota também (o fim da pergunta, R9-1-03 a).
  const a = aberturaSemSessao({}, { foco: 'pasteBtn' });
  a.dados.set(TOKEN, 'tok-da-outra');
  a.h.aoFimDaPerguntaDaAbertura(false);
  assert.equal(a.deps.focoDoTeclado, BOTAO_DA_ACAO.left, 'a adoção da abertura deixou o foco da tela de entrada cair no <body>');
  // CONTROLE: ninguém estava na tela de entrada (o foco no <body>), ou ele está na Ajuda (que segue aberta): nada se move.
  for (const tela of [{}, { dialogo: 'helpModal', foco: 'langSelectHelp' }]) {
    const c = abaDaEntrada(DA_OUTRA, { tela });
    c.h.aoVoltarAAba();
    assert.equal(c.API.sessionToken, 'tok-da-outra', 'PRÉ-CONDIÇÃO: a volta não adotou ' + JSON.stringify(tela));
    assert.equal(c.deps.focoDoTeclado, null, 'o foco foi prometido ao ✕ sem estar na tela de entrada: ' + JSON.stringify(tela));
  }
});

// A extensão que ENTRA (a pergunta da volta, a da abertura): a janela de mentira
// repassa a resposta da ponte pelo `message`, como a de verdade.
function extensaoNaEntrada(tela) {
  const t = telaDeEntrada(tela);
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
  const deps = {
    window, document: t.document, MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, AppState: {},
    // A aba da tela de entrada: nenhuma sessão na memória, nenhum login no ar (R11-1-03).
    API: { setSession: (tok) => log.push('sessão ' + tok), temSessaoNaMemoria: () => false, sessionToken: null },
    authInFlight: false, resgateEmVoo: false,
    EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, epocaDaSessao: 0, extPerguntando: false, extRenovando: false,
    extNegadoNestaPagina: false, extNegado: null, saiuNestaPagina: false, filaAtravessouSessao: false, focoDoTeclado: null,
    setTimeout: () => 1, clearTimeout: () => {},
    closeModal: (id, o) => { log.push('fechou ' + id + (o && o.focoComDestino ? ' (o foco já tem destino)' : '')); t.fechar(id); },
    showMainScreen: () => { log.push('app'); t.mostrarOApp(); },
  };
  const h = montar(['entrarPelaExtensao', 'focoNaTelaDeEntrada', 'fecharModaisDaEntrada', 'aoEntrarNestaPagina'], deps);
  return { h, deps, responder, log };
}

test('R10-1-05: a extensão que ENTRA com o foco na tela de entrada o promete ao ✕ do primeiro card; com ele no <body>, não', async () => {
  for (const tela of [{ foco: 'pasteBtn' }, { dialogo: 'pasteModal', foco: 'cookiesTextarea' }]) {
    const m = extensaoNaEntrada(tela);
    const p = m.h.entrarPelaExtensao({ silencioso: true });
    m.responder({ action: 'sessao', token: 'tok-ext' });
    assert.equal(await p, true, 'PRÉ-CONDIÇÃO: a extensão não entrou');
    assert.ok(m.log.includes('app'), 'PRÉ-CONDIÇÃO: o app não foi mostrado');
    assert.equal(m.deps.focoDoTeclado, BOTAO_DA_ACAO.left,
      `DEFEITO: com o foco em ${tela.foco}, a extensão entrou e ele caiu no <body> (o Tab seguinte ia ao mapa do card)`);
    if (tela.dialogo) assert.ok(m.log.includes(`fechou ${tela.dialogo} (o foco já tem destino)`), JSON.stringify(m.log));
  }
  // CONTROLE: o foco no <body> (ninguém estava na tela de entrada): nada se move.
  const c = extensaoNaEntrada({});
  const pc = c.h.entrarPelaExtensao({ silencioso: true });
  c.responder({ action: 'sessao', token: 'tok-ext' });
  assert.equal(await pc, true);
  assert.equal(c.deps.focoDoTeclado, null, 'o foco foi prometido ao ✕ sem ninguém na tela de entrada');
  // E o foco é lido ANTES de fechar os diálogos: no app, o fechamento o devolve ao
  // botão da própria tela de entrada, que some em seguida (ou ao ⓘ do topo).
  for (const nome of ['entrarPelaExtensao', 'adotarSessaoDoAparelho']) {
    const corpo = fatiarDe(APP_SEM, nome);
    const leu = corpo.indexOf('const focoNaEntrada = focoNaTelaDeEntrada();');
    assert.ok(leu >= 0 && leu < corpo.indexOf('fecharModaisDaEntrada('), `${nome}: o foco é lido depois de fechar os diálogos da entrada`);
  }
});

// ═══ R11-1 · a rodada 11: a conta, as abas e o login DESTA aba ════════════════
// Cada teste foi visto REPROVANDO com o conserto desfeito (as sabotagens estão no
// relatório do lote 15).

// ── R11-1-01 · a troca que OUTRA aba já fez: esta solta a MEMÓRIA da anterior ──
// A aba A caiu na tela de entrada com a memória de X (a queda a mantém, pra MESMA
// conta voltar); na B entrou Y, e a troca de conta foi feita LÁ — o aparelho já
// diz Y. Voltando à A, ela adota a sessão de Y (R10-1-03), e o `aoConhecerConta`
// comparava só com o aparelho: a troca nunca rodava aqui. Sobravam o anel de
// chamadas e as capturas de X (no relatório de Y), o rascunho de X na conversa,
// os códigos de pareamento dele e o "invisível" pendente de X, que saía em nome
// de Y (auditoria da rodada 11, R11-1-01, MEDIDO). A conta que ESTA aba confirmou
// por último (`contaConfirmadaNestaAba`) diz que a conta mudou.
function montarTrocaNaMemoria({ aparelhoDiz = '5151', estaAbaConfirmou = '4242', token = 'tok-y' } = {}) {
  const guardado = { [TOKEN]: token };
  if (aparelhoDiz) guardado[CONTA_KEY] = { id: aparelhoDiz, s: marcaDe(token) };
  const ap = aparelho(guardado);
  const log = [];
  const AppState = {
    authenticated: true, profile: { id: 5151 },
    // O placar e o Histórico desta aba são CÓPIAS do aparelho: a outra aba os
    // zerou na troca, e o aviso `storage` os trouxe pra cá (Y já triou 3 lá).
    stats: { read: 2, rejected: 1, skipped: 0 }, history: { _total: { read: 2 } }, conquistas: { c: {} }, autores: { r: {} },
    // O filtro é da ABA: a área gerenciada de X segue nele.
    filters: { managedAreaId: '91', myArea: false },
    preferences: { presenca: false, presencaWmeDesligar: { conta: '4242', em: 1 } },
    queue: [], fetching: false,
  };
  // O "invisível" que X pediu com o Waze fora: pendente na memória desta aba.
  const presencaWme = { desligarPendente: true, desligarEm: 1, desligarSessao: 'x', ligarNaProxima: false };
  const API = {
    sessionToken: token,
    // O anel: as chamadas de X (a sessão que caiu nesta aba) e a abertura de Y.
    chamadas: [{ rota: 'perfil', s: marcaDe('tok-a') }, { rota: 'chat', s: marcaDe('tok-a') }, { rota: 'perfil', s: marcaDe(token) }],
    getSession() { return this.sessionToken; },
    cancelarPareamento: (c) => { log.push('cancelou ' + c); return Promise.resolve(); },
  };
  const deps = {
    safeLS: ap.safeLS, localStorage: ap.localStorage, AppState, API, presencaWme, CONTA_KEY,
    SAIDA_KEY: constante('SAIDA_KEY'), HISTORY_KEY: constante('HISTORY_KEY'), CONQUISTAS_KEY: constante('CONQUISTAS_KEY'),
    ESTRELADOS_KEY: constante('ESTRELADOS_KEY'),
    contaConfirmadaNestaAba: estaAbaConfirmou ? { id: estaAbaConfirmou, s: marcaDe('tok-a') } : null,
    saidaEsperandoConta: false, filaAtravessouSessao: false, puladosNoInicioDaFila: 0,
    // Um "Conectar outro aparelho" que X abriu: o código vale uma sessão DELE por 5 min.
    pareamentosEmitidos: new Set(['PRV234']), placeResolvidoPorAprovacao: null,
    referenciasDoPerfil: { casa: [1, 2] }, posicaoGps: { ll: [1, 2] }, Treino: { ativo: false },
    dfato: (k, d) => log.push(['dfato', k, d || null]),
    window: { Presenca: { esquecer: (o) => log.push(['conversa', o || null]) } },
    dlogApagar: (o) => log.push(['capturas', o || null]),
    offlineEsquecer: (o) => log.push(['offline', o || null]),
    esquecerAutores: () => { log.push('autores do aparelho'); ap.safeLS.remove('waze_places_autores'); },
    esquecerFocoAutor: () => log.push('foco no autor'),
    esquecerEscolhasDaContaAnterior: () => { log.push('escolhas'); ap.safeLS.set(PREFERENCES_KEY, '{}'); },
    saveStats: () => ap.safeLS.set(STATS_KEY, JSON.stringify(AppState.stats)),
    saveFilters: () => ap.safeLS.set('waze_places_filters', JSON.stringify(AppState.filters)),
    esquecerRegistrosDaPagina: (fica) => log.push(['recursos', fica]),
    esquecerListasDePaises: () => log.push('paises'),
    semCamadaAberta: () => true, topOpenModal: () => null, fecharCamadasAbertas: () => log.push('camadas'),
    showToast: (m) => log.push('toast ' + m), t: (k) => k,
    resetQueue: () => log.push('fila nova'), startFetching: () => log.push('busca'),
    // O que só desenha.
    atualizarSeloDeConquista: () => {}, esvaziarPainelDoHistorico: () => {}, updateStats: () => {},
    updateInFlightIndicator: () => {}, esvaziarFilaDeSaida: () => {},
  };
  const h = montar(['aoConhecerConta', 'esquecerOutraConta', 'fecharOQueEraDaContaAnterior', 'carimbarContaNaSaida',
    'carregarFilaDeSaida', 'salvarFilaDeSaida', 'sessaoDestaAbaEhAGuardada', 'deixarSoAsChamadasDaSessao',
    'presencaWmeZerar', 'marcaDaSessao', 'marcaDestaAba'], deps);
  return { h, ap, log, AppState, API, presencaWme, deps };
}
const TROCOU = (soMemoria) => ['dfato', 'conta.trocou', soMemoria ? { soMemoria: true } : null];

test('R11-1-01: a aba que adota (ou entra com) a conta que OUTRA aba já pôs no aparelho solta a MEMÓRIA da anterior — sem tocar no aparelho', () => {
  const m = montarTrocaNaMemoria();
  m.h.aoConhecerConta({ id: 5151 });                 // o perfil de Y chega na aba que adotou
  assert.ok(m.log.some((x) => JSON.stringify(x) === JSON.stringify(TROCOU(true))),
    'DEFEITO: a troca de conta não aconteceu nesta aba — o aparelho já dizia Y, e a memória de X ficou: ' + JSON.stringify(m.log));
  // O que a MEMÓRIA desta aba guardava de X sai.
  assert.equal(m.presencaWme.desligarPendente, false, 'o "invisível" pendente de X ficou — sairia em nome de Y, sem o gesto de Y');
  assert.equal(m.AppState.preferences.presencaWmeDesligar, undefined, 'o "invisível" de X ficou na cópia das preferências desta aba');
  assert.deepEqual(m.API.chamadas.map((c) => c.s === marcaDe('tok-y') ? 'Y' : 'X'), ['Y'],
    'o anel de chamadas ficou com as de X (iriam no relatório do modo dev de Y)');
  for (const o of [['conversa', { soMemoria: true }], ['capturas', { soMemoria: true }], ['offline', { soMemoria: true }]]) {
    assert.ok(m.log.some((x) => JSON.stringify(x) === JSON.stringify(o)), `a troca não soltou a memória de: ${o[0]} — ${JSON.stringify(m.log)}`);
  }
  assert.ok(m.log.includes('cancelou PRV234'), 'o código de pareamento que X emitiu seguiu valendo (uma sessão de X por 5 min)');
  assert.ok(m.log.includes('foco no autor'));
  assert.equal(m.AppState.filters.managedAreaId, '', 'a área gerenciada de X ficou no filtro desta aba');
  assert.equal(m.deps.posicaoGps, null);
  // E NADA no aparelho: ele já é de Y (a outra aba fez a troca lá). A única
  // escrita é a marca da sessão que o `aoConhecerConta` sempre grava.
  assert.deepEqual(m.ap.escritas, ['grava:' + CONTA_KEY],
    'a troca só da memória mexeu no aparelho, que é de Y: ' + JSON.stringify(m.ap.escritas));
  assert.deepEqual(m.AppState.stats, { read: 2, rejected: 1, skipped: 0 },
    'o placar desta aba (a cópia do aparelho: o que Y fez na outra) foi zerado');
  assert.ok(!m.log.some((x) => typeof x === 'string' && x.startsWith('toast ')), 'o aviso da troca saiu de novo (já saiu onde ela aconteceu)');
  assert.equal(m.deps.contaConfirmadaNestaAba.id, '5151', 'a conta desta aba não passou a ser Y');
  // Sem aparelho com conta nenhuma (a outra aba deu "Sair"), e quem entra AQUI é
  // outra conta (os cookies de Z colados): a memória de X sai do mesmo jeito.
  const s = montarTrocaNaMemoria({ aparelhoDiz: null });
  s.h.aoConhecerConta({ id: 5151 });
  assert.ok(s.log.some((x) => JSON.stringify(x) === JSON.stringify(TROCOU(true))), 'depois do "Sair" da outra aba, a memória de X ficou pra quem entrou aqui');
});

test('R11-1-01: CONTROLES — a MESMA conta voltando fica com o que é dela; a troca no PRÓPRIO aparelho segue inteira; a aba sem conta confirmada não troca nada', () => {
  // A mesma conta (a outra aba entrou de novo como X): nada sai — o rascunho, o
  // pendente e o anel são dela.
  const mesma = montarTrocaNaMemoria({ aparelhoDiz: '4242', estaAbaConfirmou: '4242' });
  mesma.h.aoConhecerConta({ id: 4242 });
  assert.ok(!mesma.log.some((x) => Array.isArray(x) && x[1] === 'conta.trocou'), 'a MESMA conta foi tratada como troca');
  assert.equal(mesma.presencaWme.desligarPendente, true);
  assert.equal(mesma.API.chamadas.length, 3);
  // O aparelho ainda de X (uma aba só, a queda e outra conta entrando AQUI): a
  // troca inteira, como sempre — o aparelho sai, o placar zera e o aviso sai.
  const inteira = montarTrocaNaMemoria({ aparelhoDiz: '4242' });
  inteira.h.aoConhecerConta({ id: 5151 });
  assert.ok(inteira.log.some((x) => JSON.stringify(x) === JSON.stringify(TROCOU(false))), 'a troca no próprio aparelho deixou de acontecer');
  assert.ok(inteira.log.includes('toast toast.outraConta'));
  assert.ok(inteira.ap.escritas.includes('apaga:' + constante('HISTORY_KEY')), 'a troca inteira não apagou o Histórico do aparelho');
  assert.deepEqual(inteira.AppState.stats, { read: 0, rejected: 0, skipped: 0 });
  assert.ok(inteira.log.some((x) => JSON.stringify(x) === JSON.stringify(['conversa', null])), 'a troca inteira não apagou a conversa do aparelho');
  // A aba que nunca confirmou conta (aberta agora, ou depois do "Sair" daqui): nada a trocar.
  const nova = montarTrocaNaMemoria({ estaAbaConfirmou: null });
  nova.h.aoConhecerConta({ id: 5151 });
  assert.ok(!nova.log.some((x) => Array.isArray(x) && x[1] === 'conta.trocou'), 'a aba sem conta confirmada fez uma troca que não houve');
});

test('R11-1-01: o "Sair" esquece a conta que esta aba confirmou — e a QUEDA a mantém (é ela que diz, na volta, que a conta mudou)', async () => {
  for (const porOutraAba of [false, true]) {
    const m = montarSair();
    m.deps.contaConfirmadaNestaAba = { id: '111', s: 'x' };
    if (porOutraAba) m.deps.tokenTiradoPorOutraAba = 'tok-A';
    await m.h.handleLogout(porOutraAba ? { porOutraAba: true } : undefined);
    assert.equal(m.deps.contaConfirmadaNestaAba, null,
      `DEFEITO (${porOutraAba ? 'o "Sair" da outra aba' : 'o "Sair"'}): a conta de quem saiu ficou como a desta aba — quem entrar depois "troca" de uma conta que já saiu`);
  }
  assert.doesNotMatch(fatiarDe(APP_SEM, 'derrubarSessao'), /contaConfirmadaNestaAba\s*=/,
    'a queda esquece a conta confirmada: a troca na volta à aba (R11-1-01) ficaria cega');
});

// ── R11-1-02 · o "invisível" pendente não adota a sessão da outra aba ──────────
// Com o "invisível" pendente que atravessou a queda, QUALQUER resposta da API na
// aba da tela de entrada (um código errado, um cookies.txt recusado) rodava o
// `presencaWmeRefazerDesligar`, que lia a sessão pelo `getSession` — e o
// `getSession`, com a memória vazia, GRAVA nela a que outra aba guardou: a aba
// adotava calada, a volta à aba não adotava mais, e o "Sair" da outra fechava o
// "Colar cookies" daqui (auditoria da rodada 11, R11-1-02, MEDIDO). O `api.js`
// aqui é o DE VERDADE (é nele que mora o efeito).
const T_R11 = 1791000000000;
function abaComInvisivelPendente({ autenticada = false, perfil = null, memoria = null } = {}) {
  const real = apiDeVerdade({ [TOKEN]: 'tok-y', [CONTA_KEY]: JSON.stringify({ id: '5151', s: marcaDe('tok-y') }),
    [PREFERENCES_KEY]: JSON.stringify({ presenca: false }) });
  if (memoria) real.API.sessionToken = memoria;     // a sessão DESTA aba (só a memória)
  const enviados = [];
  real.API.presencaWaze = async (c) => { enviados.push(c); return { success: true }; };
  const escritas = [];
  const localStorage = {
    getItem: (k) => (real.dados.has(k) ? real.dados.get(k) : null),
    setItem: (k, v) => { escritas.push(k); real.dados.set(k, String(v)); },
    removeItem: (k) => { escritas.push('-' + k); real.dados.delete(k); },
  };
  const AppState = { authenticated: autenticada, profile: perfil, preferences: { presenca: false } };
  // O pendente de X, de mais de um minuto atrás (o teto da repetição já passou).
  const presencaWme = { desligarPendente: true, desligarEm: T_R11 - 120000, desligarSessao: marcaDe('tok-a'),
    desligarVez: 1, desligarNoAr: 0, ligarNaProxima: false };
  const deps = {
    API: real.API, safeLS: { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) },
    localStorage, AppState, presencaWme, CONTA_KEY, PREFERENCES_KEY,
    PRESENCA_WME_DESLIGAR_REPETIR_MS: constante('PRESENCA_WME_DESLIGAR_REPETIR_MS'),
    preferenciasCarregadas: true, Date: { now: () => T_R11 }, dfato: () => {},
    ABA_DESTA_PAGINA: 'aba-a', presencaWmeConferirAbaDoCarimbo: () => {},
    sessaoVivaDepoisDe: () => false, handleUnauthorized: () => {},
  };
  const h = montar(['presencaWmeRefazerDesligar', 'presencaWmeDesligar', 'presencaWmeGravarPendente',
    'presencaWmeEsquecerGravado', 'presencaWmeAnotarDesligar', 'savePreferences', 'marcaDaSessao', 'marcaDestaAba'], deps);
  return { h, real, enviados, escritas, presencaWme };
}

test('R11-1-02: a resposta que chega à aba da TELA DE ENTRADA não adota a sessão da outra aba pelo "invisível" pendente — nem o grava com a conta de lá', async () => {
  const m = abaComInvisivelPendente();
  m.h.presencaWmeRefazerDesligar();                  // a prova de rede: um código errado respondeu
  await tiqueAba();
  assert.equal(m.real.API.temSessaoNaMemoria(), false,
    'DEFEITO: a aba da tela de entrada ADOTOU calada a sessão da outra aba (a volta à aba não adota mais, e o "Sair" de lá fecha o "Colar" daqui)');
  assert.deepEqual(m.enviados, [], 'a aba sem sessão mandou o "invisível"');
  assert.deepEqual(m.escritas, [],
    'o pendente de X foi GRAVADO no aparelho com a conta de quem entrou na outra aba (ela o mandaria): ' + JSON.stringify(m.escritas));
  assert.equal(m.presencaWme.desligarPendente, true, 'o pendente sumiu sem a troca de conta decidir');
  // CONTROLE: a mesma aba LOGADA como X, com o perfil — a medida enxerga o envio.
  const c = abaComInvisivelPendente({ autenticada: true, perfil: { id: 4242 }, memoria: 'tok-a' });
  c.h.presencaWmeRefazerDesligar();
  await tiqueAba();
  assert.deepEqual(c.enviados, [{ userId: '4242', visivel: false }], 'CONTROLE: a medida não enxerga o envio');
});

test('R11-1-02: a sessão que ADOTOU (ou entrou) antes de o perfil dizer de quem é não manda nem grava o "invisível" de quem estava', async () => {
  // A adoção da volta à aba (ou a extensão) com a busca respondendo antes do
  // perfil: logada, a sessão de Y na memória, e o perfil ainda a caminho. A
  // repetição gravava o pendente de X com a conta do aparelho — a de Y — e a
  // aba de Y o mandava (MEDIDO no navegador: `presenca-waze` com o id de Y).
  const m = abaComInvisivelPendente({ autenticada: true, memoria: 'tok-y' });
  m.h.presencaWmeRefazerDesligar();
  await tiqueAba();
  assert.deepEqual(m.escritas, [],
    'DEFEITO: o "invisível" de X foi gravado no aparelho com a conta de Y antes de o perfil dizer de quem é a sessão: ' + JSON.stringify(m.escritas));
  assert.deepEqual(m.enviados, []);
  assert.equal(m.presencaWme.desligarPendente, true, 'o pendente sumiu sem a troca de conta decidir');
});

test('R11-1-02: o desligar sem sessão NESTA aba fica pendente sem ler o aparelho pelo `getSession` — e com ela, sai', async () => {
  const m = abaComInvisivelPendente();
  m.h.presencaWmeDesligar();
  await tiqueAba();
  assert.equal(m.real.API.temSessaoNaMemoria(), false, 'DEFEITO: o desligar sem sessão nesta aba adotou a sessão da outra');
  assert.deepEqual(m.enviados, []);
  assert.equal(m.presencaWme.desligarPendente, true, 'o desligar sem sessão foi descartado (R5-5-8)');
  // CONTROLE: com a sessão desta aba e o perfil, o gesto sai.
  const c = abaComInvisivelPendente({ autenticada: true, perfil: { id: 4242 }, memoria: 'tok-a' });
  c.h.presencaWmeDesligar();
  await tiqueAba();
  assert.deepEqual(c.enviados, [{ userId: '4242', visivel: false }]);
});

// ── R11-1-03 · a pergunta à extensão da VOLTA e o login DESTA aba ──────────────
// A adoção da volta espera o login desta aba (`authInFlight`, `resgateEmVoo`), e a
// pergunta à extensão logo abaixo não: duas sessões criadas (o "Sair" apaga uma, a
// outra fica órfã por até 21 dias), e a resposta que chegava DEPOIS do login o
// TROCAVA — com outra conta no WME, a que a pessoa escolheu ia embora (auditoria
// da rodada 11, R11-1-03, MEDIDO).
test('R11-1-03: a volta à aba com um login DESTA aba no ar não pergunta à extensão — o fim dele decide', () => {
  for (const noAr of ['authInFlight', 'resgateEmVoo']) {
    const m = abaDaEntrada();
    m.deps[noAr] = true;
    m.h.aoVoltarAAba();
    assert.deepEqual(m.log, [], `DEFEITO (${noAr}): a volta perguntou à extensão com o login desta aba no ar — duas sessões no servidor`);
  }
  // CONTROLE: sem login no ar, a volta pergunta (o ouvinte enxerga a tela de entrada).
  const c = abaDaEntrada();
  c.h.aoVoltarAAba();
  assert.deepEqual(c.log, ['perguntou à extensão (em silêncio)']);
});

// A extensão que responde à pergunta da VOLTA, com o login desta aba no meio.
function extensaoNaVolta({ memoria = null, noAr = null, tokenGuardado = null } = {}) {
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
    sessionToken: memoria,
    temSessaoNaMemoria() { return !!this.sessionToken; },
    setSession(tok) { log.push('sessão ' + tok); this.sessionToken = tok; },
    destroySession: (tok) => { log.push('apagou ' + tok); return Promise.resolve({ success: true }); },
  };
  const deps = {
    window, document: t.document, MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, AppState: {}, API,
    safeLS: { get: (k) => (k === TOKEN ? tokenGuardado : null) },
    authInFlight: noAr === 'cookies', resgateEmVoo: noAr === 'codigo', callWithRetry: (fn) => fn(),
    EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, epocaDaSessao: 0, extPerguntando: false, extRenovando: false,
    extNegadoNestaPagina: false, extNegado: null, saiuNestaPagina: false, filaAtravessouSessao: false, focoDoTeclado: null,
    setTimeout: () => 1, clearTimeout: () => {},
    closeModal: (id) => t.fechar(id),
    showMainScreen: () => { log.push('app'); t.mostrarOApp(); },
    resetQueue: () => {}, loadProfileAndAuxData: () => Promise.resolve(), conhecerContaDoLogin: () => {},
    startFetching: () => {}, esvaziarFilaDeSaida: () => {},
  };
  const h = montar(['entrarPelaExtensao', 'focoNaTelaDeEntrada', 'fecharModaisDaEntrada', 'aoEntrarNestaPagina'], deps);
  return { h, deps, responder, log, API };
}

test('R11-1-03: a resposta da extensão à VOLTA não troca o login que esta aba fez (ou faz) nesse meio — e a sessão dela sai do servidor', async () => {
  for (const [caso, o] of [['os cookies colados entraram', { memoria: 'tok-c' }],
    ['os cookies sendo conferidos', { noAr: 'cookies' }], ['o código sendo resgatado', { noAr: 'codigo' }]]) {
    const m = extensaoNaVolta(o);
    const p = m.h.entrarPelaExtensao({ silencioso: true });
    m.responder({ action: 'sessao', token: 'tok-e', conta: '5151' });
    assert.equal(await p, false, `DEFEITO (${caso}): a resposta da extensão entrou por cima do login desta aba`);
    assert.ok(!m.log.includes('sessão tok-e') && !m.log.includes('app'),
      `DEFEITO (${caso}): a sessão da extensão trocou a do login que a pessoa pediu: ` + JSON.stringify(m.log));
    assert.ok(m.log.includes('apagou tok-e'), `(${caso}) a sessão da extensão ficou órfã no servidor, por até 21 dias`);
    assert.equal(m.API.sessionToken, o.memoria || null, `(${caso}) a memória desta aba mudou`);
  }
  // A sessão da extensão já é a do aparelho (a ponte dá o desfecho de UM login a
  // todas as abas que perguntam juntas, e outra a pôs lá): ela fica no servidor.
  const outra = extensaoNaVolta({ memoria: 'tok-c', tokenGuardado: 'tok-e' });
  const po = outra.h.entrarPelaExtensao({ silencioso: true });
  outra.responder({ action: 'sessao', token: 'tok-e' });
  assert.equal(await po, false);
  assert.ok(!outra.log.includes('apagou tok-e'), 'a sessão que OUTRA aba está usando foi apagada do servidor');
});

test('R11-1-03: CONTROLES — sem login desta aba a extensão entra; a mesma sessão e a renovação da queda seguem como antes', async () => {
  const m = extensaoNaVolta();
  const p = m.h.entrarPelaExtensao({ silencioso: true });
  m.responder({ action: 'sessao', token: 'tok-e' });
  assert.equal(await p, true);
  assert.deepEqual(m.log, ['sessão tok-e', 'app'], 'CONTROLE: a extensão deixou de entrar pela volta à aba');
  // A memória já com a MESMA sessão que a extensão traz: não é outro login.
  const mesma = extensaoNaVolta({ memoria: 'tok-e' });
  const pm = mesma.h.entrarPelaExtensao({ silencioso: true });
  mesma.responder({ action: 'sessao', token: 'tok-e' });
  assert.equal(await pm, true);
  // A renovação da QUEDA (`manterFila`) não é a volta: a regra não vale lá.
  const queda = extensaoNaVolta({ noAr: 'cookies' });
  const pq = queda.h.entrarPelaExtensao({ silencioso: true, manterFila: true });
  queda.responder({ action: 'sessao', token: 'tok-e' });
  assert.equal(await pq, true, 'a renovação da queda passou a recusar a sessão da extensão');
});

// ── R11-1-04 · o login DESTA aba fecha os diálogos da entrada e leva o foco ao ✕ ──
// O link de pareamento mostra a tela de entrada durante o resgate, e o login por
// cookies não travava o "Entrar com um código": o diálogo aberto nesse meio — o
// "Colar cookies" com o cookies.txt colado, o código digitado — ficava POR CIMA do
// app quando o login dava certo, e confirmá-lo fazia um segundo login (a primeira
// sessão ficava órfã). E o foco que estava na tela de entrada caía no <body>
// (auditoria da rodada 11, R11-1-04, MEDIDO).
function resgateNaEntrada(tela, { resposta = { success: true, sessionToken: 'tok-p', conta: '4242' } } = {}) {
  const t = telaDeEntrada(tela);
  const log = [];
  const deps = {
    document: t.document, MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, AppState: {}, resgateEmVoo: false, focoDoTeclado: null,
    saiuNestaPagina: false, extNegadoNestaPagina: false, extNegado: null,
    API: { resgatarPareamento: async () => resposta },
    closeModal: (id, o) => { log.push('fechou ' + id + (o && o.focoComDestino ? ' (o foco já tem destino)' : '')); t.fechar(id); },
    showToast: () => {}, t: (k) => k, msgDoServidor: (r, d) => d,
    showMainScreen: () => { log.push('app'); t.mostrarOApp(); }, resetQueue: () => {}, conhecerContaDoLogin: () => {},
    loadProfileAndAuxData: () => null, startFetching: () => {}, esvaziarFilaDeSaida: () => {},
  };
  const h = montar(['resgatarPareamento', 'focoNaTelaDeEntrada', 'fecharModaisDaEntrada', 'aoEntrarNestaPagina'], deps);
  return { h, deps, log, tela: t };
}

test('R11-1-04: o link de pareamento que DÁ CERTO fecha o "Colar cookies" aberto durante a espera — com a limpeza — e leva o foco ao ✕', async () => {
  const m = resgateNaEntrada(COLANDO);
  assert.equal(await m.h.resgatarPareamento('ABCDEFGHJKLMNPQRSTUV', { silencioso: true }), true);
  assert.ok(m.log.includes('fechou pasteModal (o foco já tem destino)'),
    'DEFEITO: o "Colar cookies", com o cookies.txt colado, ficou POR CIMA do app (e o "Confirmar" ali faria a 2ª sessão): ' + JSON.stringify(m.log));
  assert.equal(m.tela.els.cookiesTextarea.value, '', 'o cookies.txt colado (o chaveiro do navegador) ficou no campo');
  assert.equal(m.deps.focoDoTeclado, BOTAO_DA_ACAO.left, 'o foco que estava no "Colar" caiu no <body> com a tela de entrada escondida');
  // Só o foco no "Colar cookies" (o Tab, nenhum diálogo aberto): o mesmo destino.
  const f = resgateNaEntrada({ foco: 'pasteBtn' });
  await f.h.resgatarPareamento('ABCDEFGHJKLMNPQRSTUV', { silencioso: true });
  assert.equal(f.deps.focoDoTeclado, BOTAO_DA_ACAO.left, 'DEFEITO: o foco no "Colar cookies" caiu no <body> (o Tab seguinte ia ao mapa do card)');
  // CONTROLE: ninguém na tela de entrada (o foco no <body>): nada se move.
  const c = resgateNaEntrada({});
  await c.h.resgatarPareamento('ABCDEFGHJKLMNPQRSTUV', { silencioso: true });
  assert.equal(c.deps.focoDoTeclado, null, 'o foco foi prometido sem ninguém na tela de entrada');
});

test('R11-1-04: o "Entrar com um código" segue a regra do teclado — pelo mouse o foco nele não se move, pelo teclado vai ao ✕', async () => {
  const CODIGO = { dialogo: 'pairEnterModal', texto: 'ABC-DEF', foco: 'pairCodeInput' };
  const mouse = resgateNaEntrada(CODIGO);
  assert.equal(await mouse.h.resgatarPareamento('ABCDEF'), true);
  assert.ok(mouse.log.includes('fechou pairEnterModal'), 'o diálogo do código não fechou: ' + JSON.stringify(mouse.log));
  assert.equal(mouse.deps.focoDoTeclado, null, 'o código pelo MOUSE prometeu o foco ao card (R7-1-04: o mouse não move o foco)');
  const teclado = resgateNaEntrada(CODIGO);
  await teclado.h.resgatarPareamento('ABCDEF', { peloTeclado: true });
  assert.equal(teclado.deps.focoDoTeclado, BOTAO_DA_ACAO.left, 'o código pelo teclado deixou de prometer o foco (R7-1-04)');
  assert.ok(teclado.log.includes('fechou pairEnterModal (o foco já tem destino)'));
});

function loginNaEntrada(tela) {
  const t = telaDeEntrada(tela);
  const log = [];
  const deps = {
    document: t.document, MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, AppState: {}, authInFlight: false, focoDoTeclado: null,
    saiuNestaPagina: false, extNegadoNestaPagina: false, extNegado: null,
    API: { testCookies: async () => ({ success: true, sessionToken: 'tok-c', conta: '4242' }) },
    closeModal: (id, o) => { log.push('fechou ' + id + (o && o.focoComDestino ? ' (o foco já tem destino)' : '')); t.fechar(id); },
    showToast: () => ({ dispensar() {} }), t: (k) => k, msgDoServidor: (r, d) => d, setAuthLoading: () => {},
    guardarPrazoDaSessao: () => {}, showMainScreen: () => { log.push('app'); t.mostrarOApp(); }, resetQueue: () => {},
    conhecerContaDoLogin: () => {}, loadProfileAndAuxData: () => null, startFetching: () => {}, esvaziarFilaDeSaida: () => {},
  };
  const h = montar(['authenticateWithCookies', 'focoNaTelaDeEntrada', 'fecharModaisDaEntrada', 'aoEntrarNestaPagina'], deps);
  return { h, deps, log, tela: t };
}

test('R11-1-04: o login por COOKIES que dá certo fecha o "Entrar com um código" aberto durante a validação — com o código — e leva o foco ao ✕', async () => {
  const m = loginNaEntrada({ dialogo: 'pairEnterModal', texto: 'ABC-DEF', foco: 'pairCodeInput' });
  await m.h.authenticateWithCookies('cookies');
  assert.ok(m.log.includes('app'), 'PRÉ-CONDIÇÃO: o login não deu certo');
  assert.ok(m.log.includes('fechou pairEnterModal (o foco já tem destino)'),
    'DEFEITO: o diálogo do código ficou POR CIMA do app (o "Entrar" ali faria um segundo login): ' + JSON.stringify(m.log));
  assert.equal(m.tela.els.pairCodeInput.value, '', 'o código digitado ficou no campo');
  assert.equal(m.deps.focoDoTeclado, BOTAO_DA_ACAO.left, 'o foco que estava no diálogo caiu no <body>');
  // CONTROLE: pelo mouse, sem nada aberto e o foco no <body> (o botão que travou o perdeu): nada se move.
  const c = loginNaEntrada({});
  await c.h.authenticateWithCookies('cookies');
  assert.equal(c.deps.focoDoTeclado, null, 'o login pelo mouse prometeu o foco ao card (R7-1-04)');
  assert.ok(!c.log.some((x) => x.startsWith('fechou ')));
});

test('R11-1-04: a validação dos cookies trava TAMBÉM o "Entrar com um código" — o diálogo dele não abre por baixo do login', () => {
  const botoes = Object.fromEntries(['uploadBtn', 'pasteBtn', 'pairEnterBtn'].map((id) => [id, {
    id, disabled: false, isConnected: true, classes: new Set(),
    classList: { toggle(c, v) { if (v) botoes[id].classes.add(c); else botoes[id].classes.delete(c); } },
  }]));
  const doc = { body: { id: 'BODY' }, activeElement: null, getElementById: (id) => botoes[id] || null };
  const h = montar(['setAuthLoading', 'focoPerdido'], { document: doc, focoNoBotaoDeEntrada: null, focavelNaTela: () => true });
  h.setAuthLoading(true);
  assert.equal(botoes.pairEnterBtn.disabled, true,
    'DEFEITO: o "Entrar com um código" seguia aberto durante a validação — o diálogo dele ficava POR CIMA do app');
  assert.ok(botoes.pairEnterBtn.classes.has('cursor-wait'), 'o "Entrar com um código" travado não mostra a espera, como os outros dois');
  assert.ok(botoes.uploadBtn.disabled && botoes.pasteBtn.disabled, 'CONTROLE: os outros dois deixaram de travar');
  h.setAuthLoading(false);
  assert.ok(!botoes.pairEnterBtn.disabled && !botoes.pasteBtn.disabled && !botoes.uploadBtn.disabled, 'os botões não destravaram no fim');
});

// ── R11-6-02 (b) · a troca de conta que a ponte revela espera o perfil NOVO ──────
// Com a extensão que repassa a conta (0.3.4), o `conhecerContaDoLogin` rodava
// antes de existir a carga do perfil da sessão nova: a troca refazia a fila e
// buscava JÁ (`esquecerOutraConta` → `startFetching`), e a busca de "Minha área"
// esperava o perfil da sessão que caiu — já resolvido: "Falha ao carregar" por
// ~1,5 s até o perfil novo chegar, ou, com a carga anterior há mais de um
// minuto, o perfil carregado DUAS vezes (auditoria da rodada 11, R11-6-02, MEDIDO).
test('R11-6-02: a troca de conta que a ponte da extensão revela acha o perfil da sessão NOVA no ar — uma carga só', async () => {
  const t = telaDeEntrada({});
  const ouvintes = new Set();
  const window = {
    location: { origin: 'https://app' },
    addEventListener: (tipo, fn) => { if (tipo === 'message') ouvintes.add(fn); },
    removeEventListener: (tipo, fn) => ouvintes.delete(fn),
    postMessage: () => {},
  };
  const VELHA = Promise.resolve('o perfil da sessão que caiu');
  const AppState = { _profilePromise: VELHA };
  const cargas = [];
  let aBuscaDaTrocaEsperou = null;
  const deps = {
    window, document: t.document, MODAIS_DA_ENTRADA, BOTAO_DA_ACAO, AppState,
    API: { setSession: () => {}, temSessaoNaMemoria: () => false, sessionToken: null },
    authInFlight: false, resgateEmVoo: false, callWithRetry: (fn) => fn(), safeLS: { get: () => null },
    EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, epocaDaSessao: 0, extPerguntando: false, extRenovando: false,
    extNegadoNestaPagina: false, extNegado: null, saiuNestaPagina: false, filaAtravessouSessao: false, focoDoTeclado: null,
    setTimeout: () => 1, clearTimeout: () => {}, closeModal: () => {}, showMainScreen: () => {}, resetQueue: () => {},
    startFetching: () => {}, esvaziarFilaDeSaida: () => {},
    loadProfileAndAuxData: () => { const p = Promise.resolve('o perfil da sessão nova'); cargas.push(p); return p; },
    // A conta da ponte é OUTRA: a troca refaz a fila e a busca sai JÁ — esperando o `_profilePromise` de agora.
    conhecerContaDoLogin: (conta) => { if (conta === '222') aBuscaDaTrocaEsperou = AppState._profilePromise; },
  };
  const h = montar(['entrarPelaExtensao', 'focoNaTelaDeEntrada', 'fecharModaisDaEntrada', 'aoEntrarNestaPagina'], deps);
  const p = h.entrarPelaExtensao({ silencioso: true, manterFila: true });   // a renovação da queda
  for (const fn of [...ouvintes]) fn({ source: window, origin: window.location.origin, data: { source: 'wazeplaces-ext', action: 'sessao', token: 'tokB', conta: '222' } });
  assert.equal(await p, true, 'PRÉ-CONDIÇÃO: a renovação não entrou');
  assert.equal(cargas.length, 1, `o perfil foi pedido ${cargas.length} vezes pela renovação`);
  assert.notEqual(aBuscaDaTrocaEsperou, VELHA,
    'DEFEITO: a troca de conta que a ponte revela buscou esperando o perfil da sessão que CAIU — "Falha ao carregar" até o novo chegar');
  assert.equal(aBuscaDaTrocaEsperou, cargas[0], 'a troca não achou a carga do perfil da sessão nova');
});
