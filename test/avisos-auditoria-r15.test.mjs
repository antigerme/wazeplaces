// Rodada 15 da auditoria (2026-10-08), a parte dos AVISOS — o lote 19. Medido no
// navegador pelos roteiros do auditor (r15-2/s/m11, m12b e i1; r15-7/r3, r3b, r16,
// r2 e r5; r15-6/b/s14; r15-1/c2), nos dois motores:
//
//  · R15-2-F2 — o "Marcando N como lidos…" do lote e o banner "Rejeitando N…" da
//    recusa automática só saem no `finally`, que espera a resposta do Waze (até
//    45 s × 3): a queda e o "Sair" os deixavam ao lado do "Sessão encerrada e dados
//    apagados." na tela de entrada. O "Enviando 1…" também (o `inFlightActions` da
//    sessão que acabou).
//  · R15-7-F1 — o dourado do Desfazer, a dica e a consequência do 1º ✕/✓ (o banner
//    do topo, tocável) sobreviviam ao "Sair", à queda e à troca de conta: o toque
//    abria os Filtros SEM sessão e o que se mexia ali era gravado; com OUTRA conta,
//    a "Rejeição enviada em seu nome" da anterior ficava sobre a fila dela.
//  · R15-7-A3-INC — a cota do Desfazer só se redesenhava com as Preferências já na
//    tela: ao entrar na aba, a chave aparecia viva e ligada, sem o "falta N".
//  · R15-6-02 — "sua fila continua aqui" na ABERTURA, quando nunca houve fila.
//  · R15-1-02 — o "Sair" de outra aba na pergunta da abertura deixava "Entrando
//    pelo WME…" e o "Bem-vindo!" juntos na tela.
//  · R15-2-F3 — o "Enviando N…" dizia 2 no "Rejeitar os N" e 1 na recusa automática.
//
// (R15-7-CV-A2, as marcas do Yandex e do app do Bing no iPhone, está em
// test/treino-auditoria-r14.test.mjs, na tabela de UAs do convite de instalar.)
//
// Os testes RODAM o código de verdade, fatiado do app.js, num escopo onde o que o
// teste não fornece é um "buraco negro" (o harness das rodadas 12 a 14). Cada um tem
// o CONTROLE que reprova como o app de antes, e foi visto REPROVANDO com o conserto
// desfeito (sabotagem no relatório do lote 19).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const MIN = readFileSync(new URL('../js/min/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Pula a ASSINATURA antes de casar chaves: `enviarLote(places, opts = {})` tem
// um `{}` de parâmetro padrão.
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

const tique = (ms = 2) => new Promise((ok) => setTimeout(ok, ms));
// Espera por CONDIÇÃO, com teto de tempo real — nunca por prazo fixo.
async function ateQue(cond, rotulo, tetoMs = 5000) {
  const fim = performance.now() + tetoMs;
  while (!cond()) {
    if (performance.now() > fim) assert.fail(`${rotulo}: não aconteceu em ${tetoMs / 1000} s`);
    await tique(2);
  }
}
// O relógio de PAREDE andou desde `t` (com o relógio grosso, anda em degraus): o
// dublê de rede só responde depois disso, como uma rede de verdade.
async function relogioAndou(t = Date.now()) {
  const fim = performance.now() + 2000;
  while (Date.now() <= t) {
    if (performance.now() > fim) assert.fail('o relógio de parede não andou');
    await tique(1);
  }
}

// ═══ o harness: o código de verdade num escopo com "buraco negro" ═════════════
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

// Um punho de aviso de mentira (o que o `showToast` de verdade devolve).
function punho(rotulo, diario) {
  let naTela = true;
  return {
    rotulo, texto() {}, dispensar() { diario.push('esmaeceu ' + rotulo); naTela = false; },
    remover() { diario.push('removeu ' + rotulo); naTela = false; }, naTela: () => naTela,
  };
}
// O banner do topo (`#bannerContainer`) de mentira.
function bannerDeMentira(diario) {
  return { replaceChildren() { diario.push('esvaziou o banner'); } };
}

// ═══ R15-2-F2 · R15-7-F1 · os avisos saem com a sessão ═════════════════════════
function comAvisosNaTela({ lote = true, recusa = true, deUmaVez = true } = {}) {
  const diario = [];
  const banner = bannerDeMentira(diario);
  const deps = {
    avisoDoLoteMarcando: lote ? punho('Marcando', diario) : null,
    avisoDaRecusaAutomatica: recusa ? punho('Rejeitando', diario) : null,
    avisosDeUmaVezNaTela: deUmaVez ? [
      { qual: 'desbloqueio', punho: punho('dourado', diario), confete: { remove() { diario.push('removeu o confete'); } } },
      { qual: 'consequencia', tipo: 'reject', punho: punho('consequencia', diario) },
      { qual: 'dica', punho: punho('dica', diario) },
    ] : [],
    document: { getElementById: (id) => (id === 'bannerContainer' ? banner : null) },
  };
  return { diario, deps };
}

test('R15-7-F1/R15-2-F2: `dispensarAvisosDaSessao` tira da tela os avisos da sessão — os punhos, o confete e o banner do topo', () => {
  const m = comAvisosNaTela();
  const h = montar(['dispensarAvisosDaSessao'], m.deps);
  h.dispensarAvisosDaSessao();
  for (const esperado of ['removeu Marcando', 'removeu Rejeitando', 'removeu dourado', 'removeu consequencia', 'removeu dica',
    'removeu o confete', 'esvaziou o banner']) {
    assert.ok(m.diario.includes(esperado), `DEFEITO: "${esperado}" não aconteceu — o aviso seguiria na tela de entrada: ${m.diario.join(' | ')}`);
  }
  assert.deepEqual([m.deps.avisosDeUmaVezNaTela, m.deps.avisoDoLoteMarcando, m.deps.avisoDaRecusaAutomatica], [[], null, null],
    'a lista de avisos na tela (ou os punhos do lote) seguiu guardada — o treino devolveria a pendentes o aviso de OUTRA sessão');
  // CONTROLE: sem nada na tela, não sobra erro nem escrita fora do banner.
  const v = comAvisosNaTela({ lote: false, recusa: false, deUmaVez: false });
  montar(['dispensarAvisosDaSessao'], v.deps).dispensarAvisosDaSessao();
  assert.deepEqual(v.diario, ['esvaziou o banner'], 'CONTROLE: sem avisos, algo além do banner foi tocado');
});

test('R15-7-F1: a TROCA DE CONTA tira só os de uma vez (e o confete) — o resto do banner pode ser da conta que ENTROU', () => {
  const m = comAvisosNaTela();
  montar(['dispensarAvisosDaSessao'], m.deps).dispensarAvisosDaSessao({ soOsDeUmaVez: true });
  for (const esperado of ['removeu dourado', 'removeu consequencia', 'removeu dica', 'removeu o confete']) {
    assert.ok(m.diario.includes(esperado), `DEFEITO: "${esperado}" — a "Rejeição enviada em seu nome" da anterior fica sobre a fila de quem entrou`);
  }
  for (const proibido of ['removeu Marcando', 'removeu Rejeitando', 'esvaziou o banner']) {
    assert.ok(!m.diario.includes(proibido), `a troca de conta tirou o que pode ser da conta que entrou: ${proibido}`);
  }
});

test('R15-7-F1: o aviso que SAIU da tela por si (o prazo, o toque) não é tocado de novo — e quem já saiu não quebra a limpeza', () => {
  const m = comAvisosNaTela();
  m.deps.avisosDeUmaVezNaTela[0].punho.remover = () => { throw new Error('já saiu'); };
  m.deps.avisosDeUmaVezNaTela[0].confete = { remove() { throw new Error('já saiu'); } };
  montar(['dispensarAvisosDaSessao'], m.deps).dispensarAvisosDaSessao();
  assert.ok(m.diario.includes('removeu dica') && m.diario.includes('esvaziou o banner'),
    'um punho que lança na saída impediu a limpeza dos outros');
});

function montarQueda({ filaNaTela = 1, pendente = false, treino = false, filaDoTreino = 0, renovar = false } = {}) {
  const m = comAvisosNaTela();
  const diario = m.diario;   // os punhos dos avisos escrevem aqui
  const toasts = [];
  const queue = Array.from({ length: filaNaTela }, (_, i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i }));
  const AppState = { authenticated: true, profile: { id: 1 }, queue, currentPlace: queue[0] || null, fetchEpoch: 7, pendingAction: null,
    sessaoExpiraEm: null, _profilePromise: null };
  if (pendente) {
    // O pedido da janela do Desfazer: o `cancel(true)` o devolve à fila.
    const doDesfazer = { venueID: 'vD', updateRequestID: 'uD' };
    AppState.pendingAction = { cancel: (devolve) => { if (devolve) AppState.queue.unshift(doDesfazer); } };
  }
  const Treino = treino ? { ativo: true, _salvo: { queue: Array.from({ length: filaDoTreino }, (_, i) => ({ venueID: 't' + i, updateRequestID: 't' + i })), devolver: [] },
    epocaDaFilaGuardada: () => 3 } : { ativo: false };
  const deps = {
    ...m.deps, AppState, Treino, diario, toasts,
    epocaDaSessao: 0, quedaAnunciada: false, sessaoCaiuNestaPagina: false,
    API: { sessionToken: 'TOK-A', setSession() {}, soltarSessao() {} }, safeLS: { get: () => 'TOK-A' },
    entrarPelaExtensao: renovar ? async () => true : () => new Promise(() => {}),
    AVISO_RENOVADA_ESPERA_PERFIL_MS: 0, avisarOutrasAbasDaQueda: () => {},
    showToast: (msg) => { toasts.push(msg); return punho(msg, diario); }, t: (k) => k,
    // O que a queda desliga, aqui sem efeito.
    loteDeLidosEmVoo: true, saveStats() {}, registrarEventoDeSessao() {},
    removeUndoBanner: () => diario.push('tirou o Desfazer'),
  };
  const h = montar(['derrubarSessao', 'dispensarAvisosDaSessao', 'sessaoDestaAbaEhAGuardada', 'filaRealComDevolvidos', 'filaReal'], deps);
  return { h, deps, diario, toasts, AppState };
}

test('R15-7-F1/R15-2-F2: a QUEDA tira os avisos da sessão — o "Marcando N…", o "Rejeitando N…", o dourado, a dica e a consequência', () => {
  const m = montarQueda();
  m.h.derrubarSessao('srv.err.sessionExpired');
  for (const esperado of ['removeu Marcando', 'removeu Rejeitando', 'removeu dourado', 'removeu consequencia', 'removeu dica', 'esvaziou o banner']) {
    assert.ok(m.diario.includes(esperado), `DEFEITO: a queda deixou "${esperado}" por fazer — o aviso fica na tela de entrada, tocável: ${m.diario.join(' | ')}`);
  }
  // A ordem: depois do Desfazer, antes de qualquer outra coisa visível (e antes de a tela de entrada vir).
  assert.ok(m.diario.indexOf('tirou o Desfazer') < m.diario.indexOf('esvaziou o banner'));
});

test('R15-7-F1: a queda do PORTÃO recusado (`depois`) também tira os avisos — o caminho que não passa pela renovação', () => {
  const m = montarQueda();
  let abriu = false;
  m.h.derrubarSessao('srv.err.accessDenied', { depois: () => { abriu = true; } });
  assert.ok(m.diario.includes('esvaziou o banner') && m.diario.includes('removeu Marcando'),
    'o caminho do `depois` saiu antes de limpar os avisos');
  assert.equal(abriu, false, 'PRÉ-CONDIÇÃO: o `depois` roda pelo fechamento das camadas (buraco negro aqui)');
});

// ═══ R15-6-02 · "sua fila continua aqui" só com fila ═══════════════════════════
async function renovarEEsperar(opcoes) {
  const m = montarQueda({ ...opcoes, renovar: true });
  m.h.derrubarSessao('srv.err.sessionExpired');
  await tique(20);
  return m;
}

test('R15-6-02: na ABERTURA (sessão salva vencida, renovada pela extensão) nunca houve fila — o "sua fila continua aqui" NÃO sai', async () => {
  const m = await renovarEEsperar({ filaNaTela: 0 });
  assert.ok(!m.toasts.includes('toast.sessionRenewed'),
    `DEFEITO: "Acesso renovado — sua fila continua aqui" sem fila nenhuma: ${m.toasts.join(' | ')}`);
});

test('R15-6-02: CONTROLES — com fila na tela, com o pedido da janela do Desfazer devolvido à fila, o aviso sai; com o treino aberto vale a fila REAL', async () => {
  const cheia = await renovarEEsperar({ filaNaTela: 3 });
  assert.ok(cheia.toasts.includes('toast.sessionRenewed'), 'CONTROLE: com 3 cards na tela o aviso sumiu');
  // O único pedido estava na janela do Desfazer (fora da fila): o `cancel(true)` o devolve, e ele CONTINUA.
  const janela = await renovarEEsperar({ filaNaTela: 0, pendente: true });
  assert.ok(janela.toasts.includes('toast.sessionRenewed'), 'CONTROLE: o pedido da janela do Desfazer (que volta à fila) não contou como fila');
  // O treino aberto: a fila na tela são os EXEMPLOS; a real é a que ele guarda.
  const treinoSemReal = await renovarEEsperar({ filaNaTela: 3, treino: true, filaDoTreino: 0 });
  assert.ok(!treinoSemReal.toasts.includes('toast.sessionRenewed'), 'os exemplos do treino contaram como fila');
  const treinoComReal = await renovarEEsperar({ filaNaTela: 3, treino: true, filaDoTreino: 2 });
  assert.ok(treinoComReal.toasts.includes('toast.sessionRenewed'), 'CONTROLE: a fila real do treino não contou');
});

// ═══ R15-7-F1 · R15-2-F2 · R15-1-02 · o "Sair" ═════════════════════════════════
function montarSair({ spinner = true } = {}) {
  const diario = [];
  const m = comAvisosNaTela();
  const guardado = new Map([['waze_session_token', 'tok-A']]);
  const safeLS = { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) };
  const extLoginState = { escondido: !spinner, classList: { toggle: (c, f) => { if (c === 'hidden') extLoginState.escondido = !!f; diario.push('spinner ' + (f ? 'escondido' : 'visivel')); } } };
  const authScreen = { classList: { add() {}, remove() {} } };
  const AppState = { authenticated: true, profile: { id: 1 }, stats: { read: 0, rejected: 0, skipped: 0 }, filters: {}, preferences: {},
    devMode: {}, history: {}, conquistas: {}, autores: null, pendingAction: null, inFlightActions: 0, sessaoExpiraEm: null, queue: [] };
  const API = { sessionToken: 'tok-A', chamadas: [], getSession() { return this.sessionToken; }, setSession() { this.sessionToken = null; },
    soltarSessao() { this.sessionToken = null; }, destroySession: () => Promise.resolve({ success: true }), cancelarPareamento: () => Promise.resolve(),
    setRegion() {}, setCountry() {}, esquecerLugar() {} };
  const deps = {
    ...m.deps, AppState, API, safeLS, epocaDaSessao: 5, saiuNestaPagina: false, sessaoCaiuNestaPagina: false, pareamentosEmitidos: new Set(),
    tokenTiradoPorOutraAba: null, window: { Presenca: { esquecer() {} } }, callWithRetry: (fn) => fn(), t: (k) => k, showToast: (msg) => diario.push('aviso: ' + msg),
    document: { getElementById: (id) => ({ bannerContainer: m.deps.document.getElementById('bannerContainer'), extLoginState, authScreen })[id] || null },
    preferenciasDeFabrica: () => ({}), filtrosDeFabrica: () => ({}),
    removeUndoBanner: () => diario.push('tirou o Desfazer'),
    showAuthScreen: () => diario.push('tela de entrada'),
    updateInFlightIndicator: () => diario.push('indicador'),
  };
  const h = montar(['handleLogout', 'dispensarAvisosDaSessao', 'mostrarEntrandoPelaExtensao', 'sessaoDestaAbaEhAGuardada'], deps);
  // Os avisos do `comAvisosNaTela` escrevem no diário deles; junta com o do "Sair".
  m.diario.push = ((orig) => (x) => { orig(x); diario.push(x); })(m.diario.push.bind(m.diario));
  return { h, deps, diario, extLoginState, AppState };
}

test('R15-7-F1/R15-2-F2: o "Sair" tira os avisos da sessão ANTES da tela de entrada e do aviso dele — o "Marcando N…" não fica ao lado de "Sessão encerrada"', async () => {
  const m = montarSair();
  await m.h.handleLogout();
  const i = (x) => m.diario.indexOf(x);
  for (const esperado of ['removeu Marcando', 'removeu Rejeitando', 'removeu dourado', 'removeu consequencia', 'removeu dica', 'esvaziou o banner']) {
    assert.ok(i(esperado) >= 0, `DEFEITO: o "Sair" deixou "${esperado}" por fazer: ${m.diario.join(' | ')}`);
  }
  assert.ok(i('esvaziou o banner') < i('tela de entrada'), 'os avisos saíram DEPOIS da tela de entrada');
  assert.ok(i('esvaziou o banner') < i('aviso: toast.loggedOut'), 'a limpeza tirou o aviso do próprio "Sair" (ela tem que vir antes dele)');
  assert.ok(i('aviso: toast.loggedOut') >= 0, 'PRÉ-CONDIÇÃO: o "Sair" não avisou');
});

test('R15-7-F1: o "Sair" que VEIO DE OUTRA ABA (e o da tela de entrada) também tira os avisos', async () => {
  for (const opcoes of [{ porOutraAba: true }, { porOutraAba: true, naEntrada: true }]) {
    const m = montarSair();
    await m.h.handleLogout(opcoes);
    assert.ok(m.diario.includes('esvaziou o banner') && m.diario.includes('removeu Marcando'),
      `DEFEITO (${JSON.stringify(opcoes)}): os avisos da sessão que saiu seguem na tela: ${m.diario.join(' | ')}`);
  }
});

test('R15-1-02: o "Sair" de outra aba com a pergunta à extensão no ar tira o "Entrando pelo WME…" — os dois juntos eram o "Bem-vindo!" empurrado', async () => {
  const m = montarSair({ spinner: true });
  assert.equal(m.extLoginState.escondido, false, 'PRÉ-CONDIÇÃO: o spinner da pergunta da abertura não estava na tela');
  await m.h.handleLogout({ porOutraAba: true, naEntrada: true });
  assert.equal(m.extLoginState.escondido, true,
    'DEFEITO: "Entrando pelo WME…" segue na tela junto com a tela de entrada até a extensão responder (a resposta não entra mais)');
  assert.ok(m.diario.indexOf('spinner escondido') < m.diario.indexOf('tela de entrada'),
    'o spinner saiu DEPOIS da tela de entrada: os dois apareceriam juntos num quadro');
  // CONTROLE: o "Sair" comum (sem spinner) não deixa o spinner ligado.
  const c = montarSair({ spinner: false });
  await c.h.handleLogout();
  assert.equal(c.extLoginState.escondido, true);
});

// ═══ R15-7-F1 · o toque no aviso sem sessão ════════════════════════════════════
test('R15-7-F1: o aviso do Desfazer que sobrou NÃO abre as Preferências sem sessão — o toque nele era a porta pros Filtros da tela de entrada', async () => {
  for (const [authenticated, abre] of [[false, false], [true, true]]) {
    const abriu = [];
    const deps = { AppState: { authenticated }, abrirModalNaAba: (aba) => { abriu.push(aba); return Promise.resolve(); },
      document: { getElementById: () => null }, prefersReducedMotion: () => true };
    const h = montar(['abrirPreferenciaDoUndo'], deps);
    await h.abrirPreferenciaDoUndo();
    assert.deepEqual(abriu, abre ? ['filtersTabPrefs'] : [],
      authenticated ? 'CONTROLE: com sessão o aviso deixou de abrir as Preferências'
        : 'DEFEITO: o aviso tocado sem sessão abriu os Filtros por cima da tela de entrada (e o que se mexe ali é gravado)');
  }
});

// ═══ R15-7-A3-INC · a cota do Desfazer ao ENTRAR nas Preferências ═══════════════
function montarAbas({ tratados = 9, limiar = 10 } = {}) {
  const els = new Map();
  const classes = () => { const s = new Set(); return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
    toggle: (c, f) => { const ter = f === undefined ? !s.has(c) : !!f; if (ter) s.add(c); else s.delete(c); return ter; } }; };
  const el = (id) => { if (!els.has(id)) els.set(id, { id, classList: classes(), setAttribute() {}, tabIndex: 0, textContent: '', disabled: false, checked: true }); return els.get(id); };
  const placar = { n: tratados };
  const deps = {
    document: { getElementById: el },
    FILTER_TABS: [{ tab: 'filtersTabFilters', panel: 'filtersPanelFilters' }, { tab: 'filtersTabPrefs', panel: 'filtersPanelPrefs' },
      { tab: 'filtersTabHistory', panel: 'filtersPanelHistory' }],
    renderHistory() {}, marcarConquistasVistas() {}, initUndoGateSeen() {},
    AppState: { devMode: { active: false }, preferences: { undoEnabled: true } },
    getUndoTreatedCount: () => placar.n, getUndoUnlockThreshold: () => limiar,
    t: (k, v) => k + (v ? ':' + v.remaining : ''),
  };
  const h = montar(['switchFilterTab', 'renderUndoGateUI', 'canDisableUndo'], deps);
  return { h, el, placar };
}

test('R15-7-A3-INC: entrar na aba Preferências redesenha a cota do Desfazer — a chave NÃO aparece viva e ligada abaixo da cota', () => {
  const m = montarAbas({ tratados: 10 });
  // A chave nasceu viva (a abertura dos Filtros com a cota cumprida)...
  m.h.switchFilterTab('filtersTabPrefs');
  assert.equal(m.el('prefUndoEnabled').disabled, false, 'PRÉ-CONDIÇÃO: com 10 de 10 a chave está viva');
  // ...o placar CAI com as Preferências escondidas (o Desfazer do banner com os Filtros abertos na aba Filtros)...
  m.h.switchFilterTab('filtersTabFilters');
  m.placar.n = 9;
  // ...e ao voltar para a aba a chave diz a verdade, sem esperar o primeiro toque.
  m.h.switchFilterTab('filtersTabPrefs');
  assert.equal(m.el('prefUndoEnabled').disabled, true,
    'DEFEITO: a aba Preferências apareceu com a chave VIVA abaixo da cota (9 de 10) — a tela mente até o primeiro toque');
  assert.equal(m.el('prefUndoGateMsg').textContent, 'prefs.undo.gate.countdownUm:1', 'a frase "falta 1" não apareceu');
  // CONTROLE: as outras abas não redesenham a cota (ela só importa onde está a chave).
  const c = montarAbas({ tratados: 9 });
  c.h.switchFilterTab('filtersTabHistory');
  c.h.switchFilterTab('filtersTabFilters');
  assert.equal(c.el('prefUndoGateMsg').textContent, '', 'CONTROLE: a cota foi redesenhada fora das Preferências');
});

// ═══ R15-2-F2 · R15-2-F3 · o indicador "Enviando N…" ═══════════════════════════
// O indicador de verdade, com o DOM de mentira.
function indicadorDeMentira({ autenticado = true, noAr = 1, lotes = [], epoca = 0 } = {}) {
  const els = new Map();
  const document = {
    getElementById: (id) => (id === 'logoutModal' ? { classList: { contains: () => true } } : els.get(id) || null),
    createElement: () => ({ className: '', title: '', innerHTML: '', style: {}, remove() { els.delete(this.id); } }),
    body: { appendChild: (el) => { els.set(el.id, el); } },
  };
  const deps = { document, AppState: { authenticated: autenticado, inFlightActions: noAr }, carregarFilaDeSaida: () => [],
    t: (k, v) => `${k}:${v.n}`, escapeHtml: (x) => String(x), desenharAvisoDoSair: () => {}, atualizarFabDev: () => {},
    pedidosEmAndamento: new Set(), chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID, reivindicadoPorOutraAba: () => false,
    SAIDA_REIVINDICACAO_MS: 60000, setTimeout: () => 0, clearTimeout: () => {},
    loteDeLidosEmVoo: false, lidosDoLoteNoAr: 0, epocaDaSessao: epoca, rejeicoesDeLoteNoAr: new Set(lotes) };
  const chaves = Object.keys(deps);
  const atualizar = new Function(...chaves, 'let indicadorMarcaVence = null;\n' + fatiar('saindoPelaOutraAba') + '\n'
    + fatiar('updateInFlightIndicator') + '\nreturn updateInFlightIndicator;')(...chaves.map((k) => deps[k]));
  const texto = () => {
    const el = els.get('inFlightIndicator');
    return el ? (/<span class="sr-only">([^<]*)</.exec(el.innerHTML) || [])[1] : null;
  };
  atualizar();
  return { atualizar, texto, deps, existe: () => els.has('inFlightIndicator') };
}

test('R15-2-F2: SEM sessão não há "Enviando N…" — a decisão que ficou no ar é da sessão que acabou', () => {
  const m = indicadorDeMentira({ autenticado: false, noAr: 1 });
  assert.equal(m.texto(), null, 'DEFEITO: "Enviando 1…" no canto do "Bem-vindo!" (o inFlightActions da sessão que acabou)');
  // CONTROLE: a mesma conta com sessão mostra.
  assert.equal(indicadorDeMentira({ autenticado: true, noAr: 1 }).texto(), 'indicator.sending:1', 'CONTROLE: com sessão o indicador sumiu');
  // E o que já estava na tela sai quando a sessão acaba (a queda redesenha o indicador).
  const v = indicadorDeMentira({ autenticado: true, noAr: 1 });
  assert.equal(v.existe(), true, 'PRÉ-CONDIÇÃO: o indicador não estava na tela');
  v.deps.AppState.authenticated = false;
  v.atualizar();
  assert.equal(v.existe(), false, 'DEFEITO: o indicador que estava na tela ficou depois de a sessão acabar');
});

test('R15-2-F3: "Enviando N…" conta os PEDIDOS do lote de rejeição — N no "Rejeitar os N" (que soma 2 no inFlightActions) e N na recusa automática (1)', () => {
  const lote = (restam, acoes, epoca = 0) => ({ epoca, restam, acoes });
  assert.equal(indicadorDeMentira({ noAr: 2, lotes: [lote(5, 2)] }).texto(), 'indicator.sending:5',
    'DEFEITO: "Rejeitar os 5" diz outra coisa que "Enviando 5…" (era "2")');
  assert.equal(indicadorDeMentira({ noAr: 1, lotes: [lote(4, 1)] }).texto(), 'indicator.sending:4',
    'DEFEITO: a recusa automática de 4 diz outra coisa que "Enviando 4…" (era "1")');
  // Um ✕ saindo junto do lote: os dois contam.
  assert.equal(indicadorDeMentira({ noAr: 3, lotes: [lote(5, 2)] }).texto(), 'indicator.sending:6');
  // O lote nos últimos instantes (nada a responder, o `finally` por rodar) conta 1, como o "Marcar todos".
  assert.equal(indicadorDeMentira({ noAr: 1, lotes: [lote(0, 1)] }).texto(), 'indicator.sending:1');
  // CONTROLES: o ✕ sozinho é 1; o registro de OUTRA sessão não conta; sem nada no ar, nada.
  assert.equal(indicadorDeMentira({ noAr: 1 }).texto(), 'indicator.sending:1', 'CONTROLE: o ✕ sozinho não diz 1');
  // (Com o ✕ de agora, que também ocupa uma unidade: o lote de OUTRA sessão não soma os pedidos
  // dele nem a unidade dele — R16-1-03; antes a unidade dele ficava no canto.)
  assert.equal(indicadorDeMentira({ noAr: 2, lotes: [lote(5, 1, 3)], epoca: 4 }).texto(), 'indicator.sending:1',
    'CONTROLE: o lote de uma sessão que acabou seguiu contando');
  assert.equal(indicadorDeMentira({ noAr: 0 }).texto(), null, 'CONTROLE: sem nada no ar, o indicador apareceu');
});

// O `enviarLote` de verdade, com o indicador de verdade: o texto do canto a cada resposta.
function montarEnvio({ n = 5 } = {}) {
  const els = new Map();
  const document = {
    getElementById: (id) => (id === 'logoutModal' ? { classList: { contains: () => true } } : els.get(id) || null),
    createElement: () => ({ className: '', title: '', innerHTML: '', style: {}, remove() { els.delete(this.id); } }),
    body: { appendChild: (el) => { els.set(el.id, el); } },
  };
  const fila = Array.from({ length: n }, (_, i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 700 + i }));
  const portoes = [];
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { read: 0, rejected: 0, skipped: 0 },
    serverTotal: n, fetchEpoch: 0, hasMore: false, inFlightActions: 0, pendingAction: null, profile: { id: 1 }, autorEmFoco: null };
  const API = { sessionToken: 'tok', getRegion: () => 'row', temSessaoNaMemoria: () => true,
    rejectPlace: () => new Promise((ok) => portoes.push(ok)) };
  const deps = {
    document, AppState, API, epocaDaSessao: 0, Treino: { ativo: false },
    t: (k, v) => `${k}:${v && v.n}`, escapeHtml: (x) => String(x),
    carregarFilaDeSaida: () => [], salvarFilaDeSaida() {}, enfileirarSaida: () => true, tirarDaFilaDeSaida: () => true,
    reivindicacaoDestaAba: () => ({}), reivindicadoPorOutraAba: () => false, SAIDA_REIVINDICACAO_MS: 60000,
    pedidosEmAndamento: new Set(), chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID,
    callWithRetry: (fn) => fn(), carimboDoGesto: () => ({ dia: '2026-10-08', onde: '30', t: 1, lang: 'pt' }),
    rejeicoesDeLoteNoAr: new Set(), indicadorMarcaVence: null, setTimeout: () => 0, clearTimeout: () => {},
    loteDeLidosEmVoo: false, lidosDoLoteNoAr: 0,
    pousouNoWaze: (r) => !!(r && r.success), atualizarFabDev() {}, desenharAvisoDoSair() {},
  };
  const h = montar(['enviarLote', 'rejeitarLoteDoAutor', 'marcarEmAndamento', 'updateInFlightIndicator', 'saindoPelaOutraAba'], deps);
  const texto = () => {
    const el = els.get('inFlightIndicator');
    return el ? (/<span class="sr-only">([^<]*)</.exec(el.innerHTML) || [])[1] : null;
  };
  return { h, deps, fila, portoes, texto, AppState };
}

test('R15-2-F3: a recusa automática de 3 diz "Enviando 3…", 2, 1 — a cada resposta, até o fim', async () => {
  const m = montarEnvio({ n: 3 });
  const lote = m.h.enviarLote(m.fila, { contarAoLandar: true, silencioso: true });
  const vistos = [];
  for (let i = 0; i < 3; i++) {
    await ateQue(() => m.portoes.length === 1, `PRÉ-CONDIÇÃO: o ${i + 1}º pedido saiu`);
    vistos.push(m.texto());
    await relogioAndou();
    m.portoes.shift()({ success: true });
  }
  await lote;
  assert.deepEqual(vistos, ['indicator.sending:3', 'indicator.sending:2', 'indicator.sending:1'],
    `DEFEITO: o canto não contou os pedidos do lote que faltam: ${vistos}`);
  assert.equal(m.texto(), null, 'o lote acabou e o indicador ficou');
  assert.equal(m.deps.rejeicoesDeLoteNoAr.size, 0, 'o registro do lote ficou depois do fim (o canto de uma sessão futura contaria)');
});

test('R15-2-F3: o "Rejeitar os N" (dentro do `scheduleAction`, que soma 1 ao inFlightActions) diz 5, 4, 3, 2, 1 — não "2"', async () => {
  const m = montarEnvio({ n: 5 });
  // O `scheduleAction` de verdade soma 1 ao executar (o `runExecutor`) e tira no fim.
  let fim = null;
  m.deps.scheduleAction = (tipo, places, ex) => {
    m.AppState.inFlightActions++;
    m.h.updateInFlightIndicator();
    fim = ex().finally(() => { m.AppState.inFlightActions--; m.h.updateInFlightIndicator(); });
  };
  m.deps.pedidosDoAutorNaFila = () => m.fila.slice();
  m.deps.acoesTravadas = () => false;
  m.h.rejeitarLoteDoAutor(m.fila[0]);
  const vistos = [];
  for (let i = 0; i < 5; i++) {
    await ateQue(() => m.portoes.length === 1, `PRÉ-CONDIÇÃO: o ${i + 1}º pedido saiu`);
    vistos.push(m.texto());
    await relogioAndou();
    m.portoes.shift()({ success: true });
  }
  await fim;
  assert.deepEqual(vistos, [5, 4, 3, 2, 1].map((n) => 'indicator.sending:' + n),
    `DEFEITO: o "Rejeitar os 5" não diz quantos faltam: ${vistos}`);
  assert.equal(m.texto(), null, 'o lote acabou e o indicador ficou');
});

test('R15-2-F3: o lote cortado pela queda (a época trocou) também sai do registro — e o do "Sair" não deixa N no canto da sessão seguinte', async () => {
  const m = montarEnvio({ n: 3 });
  const lote = m.h.enviarLote(m.fila, { contarAoLandar: true, silencioso: true });
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedido saiu');
  assert.equal(m.deps.rejeicoesDeLoteNoAr.size, 1, 'PRÉ-CONDIÇÃO: o lote não se registrou');
  m.deps.epocaDaSessao++;                        // a queda
  await relogioAndou();
  m.portoes.shift()({ success: false, errorCategory: 'unauthorized', httpCode: 401 });
  await lote;
  assert.equal(m.deps.rejeicoesDeLoteNoAr.size, 0, 'DEFEITO: o lote cortado pela queda seguiu no registro do indicador');
});

test('R15-2-F3: `rejeitarLoteDoAutor` entrega o lote ao `scheduleAction` marcado como "dentro de uma ação" (a unidade que o indicador troca pelos pedidos)', () => {
  const abertos = [];
  const deps = {
    AppState: { authenticated: true, queue: [], stats: { rejected: 0 }, serverTotal: 0, hasMore: false },
    API: { getRegion: () => 'row' }, Treino: { ativo: false }, acoesTravadas: () => false,
    pedidosDoAutorNaFila: () => [{ venueID: 'v1', updateRequestID: 'u1' }], chaveDoPedido: () => 'k',
    carimboDoGesto: () => ({}), enviarLote: (places, opts) => { abertos.push(opts); },
    scheduleAction: (tipo, places, ex) => ex(),
  };
  montar(['rejeitarLoteDoAutor'], deps).rejeitarLoteDoAutor({ venueID: 'v1', updateRequestID: 'u1' });
  assert.equal(abertos.length, 1, 'PRÉ-CONDIÇÃO: o lote não saiu');
  assert.equal(abertos[0].dentroDeUmaAcao, true,
    'DEFEITO: o "Rejeitar os N" não diz ao `enviarLote` que o `scheduleAction` já somou a unidade dele — o canto contaria 1 a mais');
});

// ═══ os punhos CHEGAM à variável: o "Marcando N…" e o "Rejeitando N…" ═════════
// O `dispensarAvisosDaSessao` só tira o que está guardado: a atribuição do punho,
// no começo do lote, é o elo que a queda e o "Sair" usam (R15-2-F2).
const P = (i, autor = 700 + i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, creatorId: autor, createdBy: 'autor' + autor });

test('R15-2-F2: o "Marcar todos" GUARDA o punho do "Marcando N…" enquanto o lote está no ar — e solta no fim; a queda no meio o tira', async () => {
  const fila = [1, 2, 3].map((i) => P(i));
  const portoes = [];
  const diario = [];
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { read: 0, rejected: 0, skipped: 0 },
    serverTotal: 3, fetchEpoch: 0, hasMore: false, pendingAction: null, inFlightActions: 0, profile: { id: 1 }, autorEmFoco: null };
  const API = { sessionToken: 'tok', temSessaoNaMemoria: () => true, getSession: () => 'tok', getRegion: () => 'row',
    markAsReadBatch: () => new Promise((ok) => portoes.push(ok)), markAsRead: () => new Promise((ok) => portoes.push(ok)) };
  const deps = {
    AppState, API, LOTE_LIDOS_PEDACO: 2, epocaDaSessao: 0, Treino: { ativo: false }, pedidosEmAndamento: new Set(), loteDeLidosEmVoo: false,
    lidosDoLoteNoAr: 0, loteDeLidosContado: null, escritasConferindo: 0, aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    avisoDoLoteMarcando: null, avisoDaRecusaAutomatica: null, avisosDeUmaVezNaTela: [],
    contaDestaAbaEmDuvida: () => false, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), callWithRetry: (fn) => fn(),
    carimboDoGesto: () => ({ dia: '2026-10-08', onde: '30', t: 1, lang: 'pt' }), decididosPorOutraAbaComCardAqui: new WeakSet(),
    t: (k, v) => k + (v && v.n !== undefined ? ':' + v.n : ''), msgDoServidor: (r, d) => d,
    showToast: (msg) => punho(msg, diario),
    document: { getElementById: () => ({ textContent: '', replaceChildren() {} }) }, openModal() {}, closeModal() {},
    registrarPouso() {}, recordHistory() {}, registrarLoteConfirmado() {}, updateStats() {}, saveStats() {},
    updatePendingCount() {}, aoMudarAFilaPorBaixo() {}, removeCurrentCardEl() {}, showNoPlaces() {}, startFetching() {},
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
  };
  const h = montar(['openBatchReadConfirm', 'handleBatchMarkRead', 'dispensarAvisosDaSessao', 'acoesTravadas', 'acoesTravadasForaDaJanela',
    'aprovacaoDaTelaNoAr', 'avisoDaTrava', 'marcarEmAndamento', 'chaveDoPedido', 'pousouNoWaze'], deps);
  h.openBatchReadConfirm();
  const lote = h.handleBatchMarkRead();
  await ateQue(() => portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedaço saiu');
  assert.ok(deps.avisoDoLoteMarcando && deps.avisoDoLoteMarcando.rotulo === 'toast.batchMarkingPlural:3',
    'DEFEITO: o punho do "Marcando 3…" não ficou guardado — a queda e o "Sair" não têm como tirá-lo');
  // A queda no meio do lote: a sessão acaba e o aviso sai NA HORA, sem esperar o Waze.
  h.dispensarAvisosDaSessao();
  assert.ok(diario.includes('removeu toast.batchMarkingPlural:3'), 'a queda não tirou o "Marcando 3…" da tela');
  // O fim do lote (a resposta tardia) solta a variável — só se ainda é a dele.
  deps.epocaDaSessao++;
  await relogioAndou();
  portoes.shift()({ success: true });
  await lote;
  assert.equal(deps.avisoDoLoteMarcando, null, 'a variável do punho ficou depois do fim do lote');
});

test('R15-2-F2: a recusa automática GUARDA o punho do banner "Rejeitando N…" enquanto o lote está no ar — e solta no fim', async () => {
  const diario = [];
  const fila = [P(1, 5), P(2, 777), P(3, 777)];
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { rejected: 0 }, serverTotal: 3, fetchEpoch: 0 };
  let solta = null;
  const deps = {
    AppState, Treino: { ativo: false }, podeRecusarAutomaticoAqui: () => true, contaConfirmada: () => true, autoLigado: (id) => id === 777,
    pedidosEmAndamento: new Set(), chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID, recusaAutomaticaRodando: false,
    recusaAutomaticaPedidaDeNovo: false, recusaAutomaticaNestaFila: false, API: { getRegion: () => 'row' }, carimboDoGesto: () => ({}),
    avisoDoLoteMarcando: null, avisoDaRecusaAutomatica: null, avisosDeUmaVezNaTela: [],
    document: { getElementById: () => ({ replaceChildren() {} }) },
    showToast: (msg) => punho(msg, diario), t: (k) => k, decididoNaOutraAbaDepoisDe: () => false,
    enviarLote: () => new Promise((ok) => { solta = ok; }),
    updatePendingCount() {}, aoMudarAFilaPorBaixo() {}, decididosPorOutraAbaComCardAqui: new WeakSet(),
  };
  const h = montar(['aplicarRecusaAutomatica', 'dispensarAvisosDaSessao'], deps);
  const rodando = h.aplicarRecusaAutomatica();
  await ateQue(() => solta !== null, 'PRÉ-CONDIÇÃO: o lote da recusa saiu');
  assert.ok(deps.avisoDaRecusaAutomatica && /^auto\.andando/.test(deps.avisoDaRecusaAutomatica.rotulo),
    'DEFEITO: o punho do "Rejeitando N…" não ficou guardado — a queda e o "Sair" não têm como tirá-lo');
  h.dispensarAvisosDaSessao();
  assert.ok(diario.some((x) => /^removeu auto\.andando/.test(x)), 'a queda não tirou o "Rejeitando N…" da tela');
  solta();
  await rodando;
  assert.equal(deps.avisoDaRecusaAutomatica, null, 'a variável do punho ficou depois do fim da recusa');
});

test('R15-7-F1: a TROCA DE CONTA (`esquecerOutraConta`) tira os avisos de uma vez da TELA — e deixa o resto do banner', () => {
  for (const soMemoria of [false, true]) {
    const m = comAvisosNaTela();
    const AppState = { autorEmFoco: null, stats: {}, queue: [], filters: {}, preferences: {}, history: {}, conquistas: {}, autores: null };
    const deps = { ...m.deps, AppState, API: { sessionToken: null }, carregarFilaDeSaida: () => [], salvarFilaDeSaida() {},
      safeLS: { remove() {} }, filaAtravessouSessao: false, avisosAdiados: { epoca: 0 }, Treino: { ativo: false },
      showToast() {}, t: (k) => k, pareamentosEmitidos: new Set() };
    const h = montar(['esquecerOutraConta', 'dispensarAvisosDaSessao'], deps);
    h.esquecerOutraConta('222', { soMemoria });
    for (const esperado of ['removeu dourado', 'removeu consequencia', 'removeu dica', 'removeu o confete']) {
      assert.ok(m.diario.includes(esperado), `DEFEITO (soMemoria ${soMemoria}): "${esperado}" — o aviso da conta anterior fica sobre a fila de quem entrou`);
    }
    assert.deepEqual([deps.avisosAdiados, deps.avisosDeUmaVezNaTela], [null, []], 'a pendência ou a lista de avisos da conta anterior ficou');
    assert.ok(!m.diario.includes('esvaziou o banner') && !m.diario.includes('removeu Rejeitando'),
      'a troca de conta tirou o que pode ser da conta que ENTROU');
  }
});

// ═══ os testes fatiam o FONTE; o app carrega o `js/min/` (gotcha #22) ═════════
test('o bundle GERADO tem os consertos da rodada 15 dos avisos (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  // As funções e as variáveis novas são de TOPO (o esbuild não troca esses nomes).
  for (const nome of ['dispensarAvisosDaSessao', 'avisoDoLoteMarcando', 'avisoDaRecusaAutomatica', 'rejeicoesDeLoteNoAr',
    'dentroDeUmaAcao', 'YaBrowser', 'BingSapphire']) {
    // Sem `\b`: nas marcas do iPhone o nome vem depois do `\b` literal da regex ("\bYaBrowser").
    const re = new RegExp(nome, 'g');
    assert.ok(contar(APP_SEM, re) > 0, `PRÉ-CONDIÇÃO: ${nome} sumiu do fonte`);
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${nome} — falta \`npm run js\``);
  }
});
