// A rodada 14 da auditoria do treino, das Preferências e do convite de
// instalar (2026-10-07). Cada achado foi MEDIDO no navegador pelo auditor, com o
// controle ao lado:
//   R14-7-A1 — o aviso de UMA vez que o TREINO segurou (a consequência do 1º ✕
//              que pousou com a Ajuda aberta, o desbloqueio do Desfazer, a dica)
//              só saía pelo "Ir para a fila", que fecha uma camada: pelo "Sair"
//              da faixa e pelo ↻ (e o "Aplicar") ele esperava a PRÓXIMA camada
//              fechar — e a consequência aparecia ao fechar os Filtros, fora de
//              contexto;
//   R14-7-A5 — o aviso de uma vez que JÁ estava na tela quando o treino abria
//              ficava por cima do card de treino e da faixa "nada é enviado ao
//              Waze" (até 7 s; o desbloqueio, dourado, até 20 s);
//   R14-7-A3 — com as Preferências abertas, o interruptor "Permitir desfazer
//              ações" não acompanhava o placar: vivo abaixo da cota, e desligá-lo
//              deixava a chave desligada na tela com o Desfazer ligado, calado;
//   R14-7-A4 — a frase dele prometia o Desfazer só pro "Lido" e o "Rejeitar", e
//              o interruptor desliga a janela de TODAS as ações (o ↑ com ⭐ e, pra
//              L6+AM, aprovar, excluir e corrigir o nome da foto);
//   R14-7-A2 (= R14-6-08 = R14-8-07) — o convite de instalar no iPhone mandava
//              tocar "na barra do Safari" quem está no Opera, no DuckDuckGo, no
//              app do Google e nos navegadores DENTRO de apps (Facebook,
//              Instagram), e aparecia num iOS antigo, onde nada disso adiciona à
//              Tela de Início.
//
// Os testes RODAM o código de verdade, fatiado do app.js, num escopo só: o que o
// teste não fornece é um "buraco negro" que aceita qualquer chamada. Cada um tem
// o CONTROLE (o desfecho de sempre, que valida o instrumento) e foi visto
// REPROVANDO com o conserto desfeito (as sabotagens estão no relatório do lote 18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const HTML = ler('index.src.html');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fechar(txt, i, abre = '{', fecha = '}') {
  let prof = 0;
  for (let j = txt.indexOf(abre, i); j < txt.length; j++) {
    if (txt[j] === abre) prof++;
    else if (txt[j] === fecha) { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
// As funções NOVAS deste lote só são fatiadas se existirem: no código de antes do
// conserto o teste reprova pelo COMPORTAMENTO (o que não existe vira buraco
// negro e não faz nada), não por não achá-las.
const existe = (nome) => new RegExp('^(async )?function ' + nome + '\\(', 'm').test(APP_SEM);
const fontes = (nomes) => nomes.filter(existe).map(fatiar);
const existeConst = (nome) => new RegExp('^const ' + nome + ' = ', 'm').test(APP_SEM);
// A declaração `const NOME = …;` INTEIRA: objeto, lista ou valor de uma linha.
function declaracao(nome) {
  const m = new RegExp('^const ' + nome + ' = ', 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  const ini = m.index + m[0].length;
  const c = APP_SEM[ini];
  const fim = c === '{' ? fechar(APP_SEM, ini) : c === '[' ? fechar(APP_SEM, ini, '[', ']') : APP_SEM.indexOf(';', ini);
  return APP_SEM.slice(m.index, fim) + ';';
}

function buracoNegro() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro()),
    apply: () => buracoNegro(), set: () => true,
  });
}
// As funções de verdade num escopo só, com `deps` por fora: o que não está nem
// nelas nem no `globalThis` vira buraco negro. As variáveis de MÓDULO que elas
// escrevem (`avisosAdiados`, `avisosDeUmaVezNaTela`…) moram em `deps`.
function rodar(deps, codigo, devolve) {
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : typeof k === 'string' ? buracoNegro() : undefined),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('__escopo', `with (__escopo) {\n${codigo.join('\n')}\nreturn { ${devolve.join(', ')} };\n}`)(escopo);
}
// O pedido adiado é decidido numa microtarefa (`pedirAvisosAdiados`).
const microtarefas = () => new Promise((ok) => setImmediate(ok));
function classes(...iniciais) {
  const s = new Set(iniciais);
  return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
    replace: (a, b) => { if (s.delete(a)) s.add(b); },
    toggle: (c, f) => { const ter = f === undefined ? !s.has(c) : !!f; if (ter) s.add(c); else s.delete(c); return ter; } };
}
// O que cada conserto deixou no CÓDIGO: o js/min/app.js — o que o navegador
// carrega — tem que ter o mesmo (gotcha #22). Cada seção acrescenta o dela.
const NO_BUNDLE = [];
function dicionario() {
  const ctx = { navigator: { language: 'pt-BR' }, document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, console };
  vm.createContext(ctx);
  vm.runInContext(ler('js/i18n.js') + '\nthis.D = I18N_DICT;', ctx);
  return ctx.D;
}

// ═══ R14-7-A1 e A5 · os avisos de UMA vez e o TREINO ════════════════════════
// O `Treino` de verdade (entrar, sair, encerrar), o `showToast` de verdade numa
// pilha de mentira — o banner do topo (#bannerContainer), com o teto de 3 e um
// RELÓGIO de mentira (nada sai sozinho até o teste mandar) —, o confete de
// verdade, e os três avisos com a régua da tela de verdade. L6 (cota 10).
NO_BUNDLE.push(/devolverAvisosDeUmaVezDaTela\(/g, /anotarAvisoDeUmaVezNaTela\(/g, /adiarAvisoDeUmaVez\(/g);
const FUNCOES_DOS_AVISOS = ['avisarConsequencia', 'checkUndoGateUnlock', 'checkDicaDesfazer', 'getUndoTreatedCount',
  'getUndoUnlockThreshold', 'pedidosNaJanelaDoDesfazer', 'pedidosConfirmados', 'undoGateAtingido', 'canDisableUndo',
  'semCamadaAberta', 'aoFecharCamada', 'avisoDeUmaVezSaiAgora', 'pedirAvisosAdiados', 'atenderAvisosAdiados',
  'avisosAdiadosAoVoltar', 'dispararConfeteNaFila', 'showToast',
  // as do conserto
  'adiarAvisoDeUmaVez', 'anotarAvisoDeUmaVezNaTela', 'devolverAvisosDeUmaVezDaTela'];

function no() {
  const n = {
    pai: null, className: '', title: '', style: {}, dataset: {}, _html: '', attrs: {},
    set innerHTML(v) { n._html = String(v); },
    get innerHTML() { return n._html; },
    get textContent() { return n._html.replace(/<[^>]+>/g, ''); },
    get isConnected() { return !!n.pai; },
    addEventListener() {}, querySelector: () => null, setAttribute(k, v) { n.attrs[k] = String(v); },
    remove() {
      if (!n.pai) return;
      const i = n.pai.filhos.indexOf(n);
      if (i >= 0) n.pai.filhos.splice(i, 1);
      n.pai = null;
    },
  };
  return n;
}
function pilha() {
  const p = no();
  p.filhos = [];
  p.pai = { filhos: [p] };   // a própria pilha está na página
  Object.defineProperty(p, 'children', { get: () => p.filhos });
  Object.defineProperty(p, 'firstElementChild', { get: () => p.filhos[0] || null });
  p.appendChild = (n) => { n.remove(); n.pai = p; p.filhos.push(n); return n; };
  p.removeChild = (n) => { n.remove(); return n; };
  return p;
}

function montarTreinoComAvisos({ confirmados = 50, prefs = {}, fila = 4 } = {}) {
  const els = { bannerContainer: pilha(), toastContainer: pilha(), cardStack: pilha(),
    treinoBanner: { classList: classes('hidden') }, focoAutorBar: { classList: classes('hidden') },
    noMoreCards: { classList: classes('hidden') } };
  // O relógio PARADO: o aviso só vence quando o teste manda (`vencer`).
  const timers = new Map();
  let proximo = 0;
  const vencer = () => {
    for (let volta = 0; volta < 10 && timers.size; volta++) {
      const agora = [...timers.values()];
      timers.clear();
      for (const fn of agora) fn();
    }
  };
  const tela = { modal: null, foto: false, mapa: false };
  const doc = { visibilityState: 'visible', getElementById: (id) => els[id] || null, createElement: () => no() };
  const hist = { _total: { read: confirmados, rejected: 0 } };
  const P = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, updateTypeKey: 'VENUE', imageUrls: [] });
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: Array.from({ length: fila }, (_, i) => P(i + 1)), currentPlace: null, autorEmFoco: null,
    stats: { read: confirmados, rejected: 0, skipped: 0 }, serverTotal: fila,
    preferences: { undoEnabled: true, undoGateSeen: true, dicaDesfazerVista: true, consequenciaVista: { read: true, reject: true },
      comoFuncionaVisto: true, semUndoSeguidas: 0, ...prefs },
    devMode: { active: false } };
  AppState.currentPlace = AppState.queue[0];
  const salvas = [];
  const deps = {
    AppState, document: doc,
    topOpenModal: () => tela.modal, Lightbox: { isOpen: () => tela.foto }, MapaLightbox: { isOpen: () => tela.mapa },
    perfilDoPortao: () => ({ rank: 5, isStaff: false }),
    loadHistory: () => hist,
    savePreferences: () => salvas.push(JSON.parse(JSON.stringify(AppState.preferences))),
    t: (k) => k, escapeHtml: (x) => String(x), dlog: () => {},
    setTimeout: (fn) => { const id = ++proximo; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    prefersReducedMotion: () => false,
    DICA_SEM_UNDO: 20,
    // o que seguraria o treino: nada, aqui
    loteDeLidosEmVoo: false, aprovacaoPendente: null, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(),
    // O estado de MÓDULO (os `let` do app).
    epocaDaSessao: 0, avisosAdiados: null, avisosAdiadosPedido: false, avisosDeUmaVezNaTela: [],
    comoFuncionaEsperaGesto: false,
  };
  const app = rodar(deps, [declaracao('UNDO_GATE_BASE'), declaracao('CONSEQUENCIA_AVISADA'), declaracao('Treino'),
    ...fontes(FUNCOES_DOS_AVISOS)],
  ['Treino', 'avisarConsequencia', 'checkUndoGateUnlock', 'checkDicaDesfazer', 'aoFecharCamada', 'showToast']);
  // O que está NA TELA, no banner do topo.
  const banners = () => els.bannerContainer.filhos.map((n) => n.textContent);
  const confetes = () => els.cardStack.filhos.filter((n) => /confetti/.test(n.className)).length;
  // O "Praticar" da Ajuda: fecha a Ajuda (a camada) e abre o treino no MESMO
  // tique — o ouvinte do `abrirTreino`.
  const praticar = async () => {
    tela.modal = null;
    app.aoFecharCamada(false);
    app.Treino.entrar();
    await microtarefas();
  };
  return { app, AppState, deps, tela, doc, els, hist, banners, confetes, vencer, praticar, salvas,
    prefs: () => AppState.preferences };
}

// Os quatro fins do treino. O "Ir para a fila" (e o Esc, o fundo, o voltar) é o
// fechamento do "Treino concluído": a limpeza do modal SAI do treino e o
// `closeModal` termina no `aoFecharCamada` — o caminho que já soltava os avisos.
const FINS = {
  'o "Sair" da faixa': (m) => m.app.Treino.sair(),
  'o ↻ e o "Aplicar" (o `resetQueue`)': (m) => m.app.Treino.encerrar(),
  'o "Ir para a fila" (CONTROLE)': (m) => { m.app.Treino.sair(); m.app.aoFecharCamada(false); },
};

test('R14-7-A1: a consequência que o treino SEGUROU sai quando ele acaba — pelo "Sair" da faixa e pelo ↻/"Aplicar", não só pelo "Ir para a fila"', async () => {
  for (const [fim, terminar] of Object.entries(FINS)) {
    for (const tipo of ['reject', 'read']) {
      const m = montarTreinoComAvisos({ prefs: { consequenciaVista: {} } });
      // A decisão da janela do Desfazer pousa com a Ajuda aberta: o aviso fica pendente (R13-7-01).
      m.tela.modal = { id: 'helpModal' };
      m.app.avisarConsequencia(tipo);
      assert.deepEqual(m.banners(), [], `PRÉ-CONDIÇÃO (${fim}, ${tipo}): o aviso saiu por baixo da Ajuda`);
      await m.praticar();
      assert.equal(m.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino não abriu');
      assert.deepEqual(m.banners(), [], `PRÉ-CONDIÇÃO (${fim}): o aviso da fila real saiu por cima do TREINO`);
      assert.notEqual(m.prefs().consequenciaVista[tipo], true, `PRÉ-CONDIÇÃO (${fim}): o aviso ficou gasto no treino`);
      terminar(m);
      await microtarefas();
      assert.equal(m.app.Treino.ativo, false, `PRÉ-CONDIÇÃO: ${fim} não saiu do treino`);
      assert.deepEqual(m.banners(), ['consequencia.' + tipo],
        `DEFEITO: o treino acabou por ${fim} e a consequência que ele segurou não saiu — ela esperava a PRÓXIMA camada fechar (os Filtros, fora de contexto)`);
      assert.equal(m.prefs().consequenciaVista[tipo], true, `${fim}: o aviso saiu sem ficar visto`);
      // Uma vez só: o fechamento seguinte de uma camada não repete.
      m.tela.modal = null;
      m.app.aoFecharCamada(false);
      await microtarefas();
      assert.equal(m.banners().length, 1, `${fim}: o aviso saiu duas vezes`);
    }
  }
});

test('R14-7-A1: o desbloqueio do Desfazer (banner e confete) e a dica que o treino segurou saem nos quatro fins', async () => {
  for (const [fim, terminar] of Object.entries(FINS)) {
    // O 10º confirmado do L6 com a Ajuda aberta: o desbloqueio fica pendente.
    const d = montarTreinoComAvisos({ confirmados: 10, prefs: { undoGateSeen: false, dicaDesfazerVista: false } });
    d.tela.modal = { id: 'helpModal' };
    d.app.checkUndoGateUnlock();
    assert.equal(d.prefs().undoGateSeen, false, 'PRÉ-CONDIÇÃO: o desbloqueio ficou gasto debaixo da Ajuda');
    await d.praticar();
    assert.deepEqual([d.banners(), d.confetes()], [[], 0], `PRÉ-CONDIÇÃO (${fim}): o desbloqueio saiu sobre o treino`);
    terminar(d);
    await microtarefas();
    assert.deepEqual(d.banners(), ['toast.undoUnlocked'],
      `DEFEITO: o treino acabou por ${fim} e o desbloqueio que ele segurou não saiu`);
    assert.equal(d.confetes(), 1, `${fim}: o desbloqueio saiu sem o confete`);
    assert.equal(d.prefs().undoGateSeen, true);
    // A dica (L6 bem acima da cota, a 20ª janela sem desfazer) com os Filtros abertos.
    const h = montarTreinoComAvisos({ confirmados: 50, prefs: { dicaDesfazerVista: false, semUndoSeguidas: 20 } });
    h.tela.modal = { id: 'filtersModal' };
    h.app.checkDicaDesfazer();
    assert.notEqual(h.prefs().dicaDesfazerVista, true, 'PRÉ-CONDIÇÃO: a dica ficou gasta debaixo dos Filtros');
    await h.praticar();
    assert.deepEqual(h.banners(), [], `PRÉ-CONDIÇÃO (${fim}): a dica saiu sobre o treino`);
    terminar(h);
    await microtarefas();
    assert.deepEqual(h.banners(), ['toast.undoHint'], `DEFEITO: o treino acabou por ${fim} e a dica que ele segurou não saiu`);
    assert.equal(h.prefs().dicaDesfazerVista, true);
  }
});

test('R14-7-A1: CONTROLE — o treino que acaba pelo "Sair" da CONTA (a época troca, deslogado) não mostra o aviso da sessão que acabou', async () => {
  const m = montarTreinoComAvisos({ prefs: { consequenciaVista: {} } });
  m.tela.modal = { id: 'helpModal' };
  m.app.avisarConsequencia('reject');
  await m.praticar();
  // O `handleLogout`: a época sobe antes de tudo, e o `resetQueue` encerra o treino.
  m.deps.epocaDaSessao++;
  m.AppState.authenticated = false;
  m.app.Treino.encerrar();
  await microtarefas();
  assert.deepEqual(m.banners(), [], 'o aviso de uma decisão da sessão que ACABOU saiu na tela de entrada');
  // E o treino que acaba SEM nada pendente não mostra nada (o pedido não inventa aviso).
  const c = montarTreinoComAvisos();
  await c.praticar();
  c.app.Treino.sair();
  await microtarefas();
  assert.deepEqual(c.banners(), [], 'o fim do treino mostrou um aviso que ninguém deixou pendente');
});

test('R14-7-A5: a consequência que JÁ estava na tela quando o treino abriu sai dele — e volta, inteira, quando ele acaba', async () => {
  for (const [fim, terminar] of Object.entries(FINS)) {
    const m = montarTreinoComAvisos({ prefs: { consequenciaVista: {} } });
    // O 1º ✕ pousa sem camada: o aviso sai na hora e fica visto.
    m.app.avisarConsequencia('reject');
    assert.deepEqual(m.banners(), ['consequencia.reject'], 'CONTROLE: a 1ª rejeição sem camada não avisou — o teste perdeu o sentido');
    assert.equal(m.prefs().consequenciaVista.reject, true);
    // "Praticar" com ele na tela (o auditor: 1,6 s depois).
    await m.praticar();
    assert.equal(m.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino não abriu');
    assert.deepEqual(m.banners(), [],
      'DEFEITO: "Rejeição enviada ao Waze em seu nome" ficou por cima do card de TREINO e da faixa "nada é enviado ao Waze"');
    assert.notEqual(m.prefs().consequenciaVista.reject, true,
      'DEFEITO: o aviso saiu da tela no treino e ficou GASTO — não volta onde ele explica alguma coisa');
    assert.notEqual(m.salvas.at(-1).consequenciaVista.reject, true, 'a marca desfeita não foi GRAVADA (fechada a página, ele se perdia)');
    // Nada dele no treino, nem quando uma camada fecha nele.
    m.tela.modal = null;
    m.app.aoFecharCamada(false);
    await microtarefas();
    assert.deepEqual(m.banners(), [], 'o aviso voltou por cima do treino ao fechar uma camada nele');
    terminar(m);
    await microtarefas();
    assert.deepEqual(m.banners(), ['consequencia.reject'], `o aviso que o treino tirou da tela não voltou quando ele acabou por ${fim}`);
    assert.equal(m.prefs().consequenciaVista.reject, true, `${fim}: voltou sem ficar visto`);
  }
});

test('R14-7-A5: o desbloqueio na tela (banner dourado E confete) sai com o treino e volta no fim — a dica, como estava antes dele', async () => {
  for (const dicaAntes of [false, true]) {
    const m = montarTreinoComAvisos({ confirmados: 10, prefs: { undoGateSeen: false, dicaDesfazerVista: dicaAntes } });
    m.app.checkUndoGateUnlock();
    assert.deepEqual([m.banners(), m.confetes()], [['toast.undoUnlocked'], 1], 'CONTROLE: o 10º confirmado não comemorou');
    assert.equal(m.prefs().dicaDesfazerVista, true, 'CONTROLE: o desbloqueio não marcou a dica junto');
    await m.praticar();
    assert.deepEqual([m.banners(), m.confetes()], [[], 0],
      'DEFEITO: o desbloqueio do Desfazer (banner dourado, 20 s) e o confete ficaram por cima do TREINO');
    assert.equal(m.prefs().undoGateSeen, false, 'DEFEITO: o desbloqueio saiu da tela e ficou GASTO');
    assert.equal(m.prefs().dicaDesfazerVista, dicaAntes, `a dica não voltou ao que era antes do desbloqueio (${dicaAntes})`);
    m.app.Treino.sair();
    await microtarefas();
    assert.deepEqual([m.banners(), m.confetes()], [['toast.undoUnlocked'], 1], 'o desbloqueio não voltou no fim do treino');
    assert.deepEqual([m.prefs().undoGateSeen, m.prefs().dicaDesfazerVista], [true, true]);
  }
  // A dica na tela.
  const h = montarTreinoComAvisos({ confirmados: 50, prefs: { dicaDesfazerVista: false, semUndoSeguidas: 20 } });
  h.app.checkDicaDesfazer();
  assert.deepEqual(h.banners(), ['toast.undoHint'], 'CONTROLE: a 20ª janela sem desfazer não ofereceu a dica');
  await h.praticar();
  assert.deepEqual(h.banners(), [], 'DEFEITO: a dica ficou por cima do treino');
  assert.equal(h.prefs().dicaDesfazerVista, false, 'DEFEITO: a dica saiu da tela e ficou gasta');
  h.app.Treino.encerrar();
  await microtarefas();
  assert.deepEqual(h.banners(), ['toast.undoHint'], 'a dica não voltou no fim do treino');
});

test('R14-7-A5: CONTROLES — o aviso que JÁ SAIU da tela não volta, o aviso comum fica, e o de outra sessão sai sem voltar', async () => {
  // Vencido (os 7 s passaram) antes do treino: foi visto, e o fim do treino não o repete.
  const v = montarTreinoComAvisos({ prefs: { consequenciaVista: {} } });
  v.app.avisarConsequencia('read');
  v.vencer();
  assert.deepEqual(v.banners(), [], 'PRÉ-CONDIÇÃO: o relógio de mentira não venceu o aviso');
  await v.praticar();
  v.app.Treino.sair();
  await microtarefas();
  assert.deepEqual(v.banners(), [], 'o aviso que já tinha saído da tela voltou no fim do treino (duas vezes na vida)');
  assert.equal(v.prefs().consequenciaVista.read, true, 'a marca do aviso já visto foi desfeita');
  // Um aviso comum (o resultado de uma ação) não é de uma vez: fica com o prazo dele.
  const c = montarTreinoComAvisos();
  c.app.showToast('2 rejeitados', 'hint');
  await c.praticar();
  assert.deepEqual(c.banners(), ['2 rejeitados'], 'o treino tirou da tela um aviso que não é de uma vez');
  // O de OUTRA sessão (a época trocou com ele na tela): sai da tela e não volta.
  const o = montarTreinoComAvisos({ prefs: { consequenciaVista: {} } });
  o.app.avisarConsequencia('reject');
  o.deps.epocaDaSessao++;
  await o.praticar();
  assert.deepEqual(o.banners(), [], 'o aviso da sessão anterior ficou por cima do treino');
  o.app.Treino.sair();
  await microtarefas();
  assert.deepEqual(o.banners(), [], 'o aviso de OUTRA sessão voltou no fim do treino ("rejeição enviada em seu nome" pra quem não rejeitou)');
});

test('R14-7-A5: a troca de conta esquece os avisos de uma vez que estão na tela — eram da conta anterior', () => {
  const corpo = fatiar('esquecerOutraConta');
  assert.match(corpo, /^    avisosAdiados = null;\n    avisosDeUmaVezNaTela = \[\];$/m,
    'a troca de conta não esquece os avisos de uma vez NA TELA: o treino de quem entrou os devolveria a pendentes');
});

// ═══ R14-7-A3 · o interruptor do Desfazer acompanha o placar ════════════════
// O `desenharPlacar` (por onde TODA mudança do placar passa: o gesto, o
// "Desfazer", a recusa, o placar de outra aba), a cota do Desfazer
// (`renderUndoGateUI`) e o ouvinte do interruptor, de verdade. L6: cota 10.
NO_BUNDLE.push(/preferenciasNaTela\(/g);
const L6 = { id: 12444348, userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false };
function ouvinteDoInterruptor() {
  const m = /\$\('prefUndoEnabled'\)\.addEventListener\('change', \((\w+)\) => \{\n([\s\S]*?)\n    \}\);/.exec(APP_SEM);
  assert.ok(m, 'CONTROLE: o ouvinte do interruptor "Permitir desfazer ações" sumiu do setupAppListeners');
  return `const ouvinte = (${m[1]}) => {\n${m[2]}\n};`;
}
function montarCota({ placar = 10, prefsNaTela = true, modalAberto = true, undoEnabled = true } = {}) {
  const els = {
    filtersModal: { classList: classes(...(modalAberto ? [] : ['hidden'])) },
    filtersPanelPrefs: { classList: classes(...(prefsNaTela ? [] : ['hidden'])) },
    prefUndoEnabled: { disabled: false, checked: undoEnabled },
    prefUndoGateMsg: { classList: classes('hidden'), textContent: '' },
  };
  const salvas = [];
  const AppState = { authenticated: true, profile: L6, stats: { read: placar, rejected: 0, skipped: 0 },
    preferences: { undoEnabled, undoGateSeen: true }, devMode: { active: false } };
  const deps = {
    AppState, document: { getElementById: (id) => els[id] || null },
    Treino: { ativo: false, stats: { read: 0, rejected: 0, skipped: 0 } },
    setCount: () => {}, updatePendingCount: () => {},
    savePreferences: () => salvas.push(AppState.preferences.undoEnabled),
    preferenciasCarregadas: true, safeLS: { get: () => null, set: () => {} }, PERFIL_GATE_KEY: 'waze_places_perfil_gate',
    t: (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k),
  };
  const h = rodar(deps, [declaracao('UNDO_GATE_BASE'),
    ...fontes(['updateStats', 'desenharPlacar', 'preferenciasNaTela', 'renderUndoGateUI', 'initUndoGateSeen', 'undoGateAtingido',
      'canDisableUndo', 'getUndoTreatedCount', 'getUndoUnlockThreshold', 'perfilDoPortao']),
    ouvinteDoInterruptor()], ['updateStats', 'desenharPlacar', 'renderUndoGateUI', 'ouvinte']);
  const caixa = els.prefUndoEnabled;
  // O dedo na chave: o navegador inverte o `checked` e dispara o `change`.
  const tocar = () => { caixa.checked = !caixa.checked; h.ouvinte({ target: caixa }); };
  const estado = () => ({ viva: !caixa.disabled, ligada: caixa.checked, pref: AppState.preferences.undoEnabled,
    frase: els.prefUndoGateMsg.classList.contains('hidden') ? '' : els.prefUndoGateMsg.textContent.split(' ')[0] });
  return { h, AppState, els, caixa, tocar, estado, salvas };
}

test('R14-7-A3: com as Preferências NA TELA, o interruptor acompanha o placar — a decisão que completou a cota e VOLTOU o trava de novo', () => {
  // CONTROLE: a abertura (o `openFiltersModal`) desenha a cota — viva com 10 (a 10ª no ar).
  const m = montarCota({ placar: 10 });
  m.h.renderUndoGateUI();
  assert.deepEqual(m.estado(), { viva: true, ligada: true, pref: true, frase: '' }, 'CONTROLE: com 10 (L6) o interruptor não destravou');
  // O "Desfazer" da 10ª (o banner fica por cima do modal), ou a recusa do Waze: o placar volta a 9.
  m.AppState.stats.read = 9;
  m.h.updateStats();
  assert.deepEqual(m.estado(), { viva: false, ligada: true, pref: true, frase: 'prefs.undo.gate.countdownUm' },
    'DEFEITO: o placar voltou a 9 (abaixo da cota 10) e o interruptor seguiu VIVO nas Preferências abertas');
  // E o inverso: o placar que sobe com elas na tela (o de outra aba, `relerPlacarDeOutraAba`) destrava.
  m.AppState.stats.read = 10;
  m.h.desenharPlacar(true);
  assert.deepEqual(m.estado(), { viva: true, ligada: true, pref: true, frase: '' },
    'o placar cruzou a cota com as Preferências na tela e o interruptor seguiu travado');
});

test('R14-7-A3: desligar a chave SEM a cota a devolve ao estado REAL — travada, ligada, com o que falta — e nunca a deixa mentindo', () => {
  // A chave ficou viva por baixo da cota (o caminho que o redesenho não alcança: DOM
  // velho, outra aba): o toque não desliga nada — e a tela tem que DIZER isso.
  const m = montarCota({ placar: 10 });
  m.h.renderUndoGateUI();
  m.AppState.stats.read = 9;   // sem redesenho: a chave segue viva na tela
  assert.equal(m.estado().viva, true, 'PRÉ-CONDIÇÃO: a chave já estava travada');
  m.tocar();
  assert.equal(m.AppState.preferences.undoEnabled, true, 'o toque sem a cota desligou o Desfazer');
  assert.deepEqual(m.estado(), { viva: false, ligada: true, pref: true, frase: 'prefs.undo.gate.countdownUm' },
    'DEFEITO: a chave ficou DESLIGADA na tela com o Desfazer LIGADO por baixo — o que o app mostra e o que ele faz divergem');
  // CONTROLE: com a cota, o toque desliga de verdade, e a chave fica como o dedo deixou.
  const c = montarCota({ placar: 10 });
  c.h.renderUndoGateUI();
  c.tocar();
  assert.deepEqual(c.estado(), { viva: true, ligada: false, pref: false, frase: '' }, 'CONTROLE: com a cota, desligar não desligou');
  assert.deepEqual(c.salvas, [false], 'CONTROLE: a escolha não foi gravada');
  c.tocar();
  assert.deepEqual(c.estado(), { viva: true, ligada: true, pref: true, frase: '' }, 'CONTROLE: religar não religou');
});

test('R14-7-A3: CONTROLE — fora das Preferências (os Filtros fechados, ou outra aba deles) o placar não redesenha a cota', () => {
  for (const [onde, op] of [['os Filtros fechados', { modalAberto: false }], ['a aba Filtros', { prefsNaTela: false }]]) {
    const m = montarCota({ placar: 10, ...op });
    m.h.renderUndoGateUI();   // o último desenho, de quando estavam abertas
    m.AppState.stats.read = 9;
    m.h.updateStats();
    assert.equal(m.estado().viva, true, `com ${onde}, o placar redesenhou a cota (a abertura já a desenha)`);
  }
});

// ═══ R14-7-A4 · a frase do interruptor diz o que ele desliga ════════════════
test('R14-7-A4: "Permitir desfazer ações" fala de CADA ação — não só do "Lido" e do "Rejeitar" — nos 4 idiomas, e a reserva do HTML diz o mesmo', () => {
  const D = dicionario();
  // O termo do app pra "cada ação" é o do fim do treino ("o Desfazer te dá 3s em cada ação").
  const TERMO = { pt: 'cada ação', en: 'every action', es: 'cada acción', fr: 'chaque action' };
  for (const [l, termo] of Object.entries(TERMO)) {
    assert.ok(D[l]['treino.fim.body'].includes(termo), `CONTROLE (${l}): o fim do treino não usa "${termo}" — o termo do app mudou`);
    const frase = D[l]['prefs.undo.desc'];
    assert.ok(frase.includes('{undoSeg}'), `${l}: a frase perdeu o {undoSeg}`);
    // Os nomes do ✕ e do ✓ (os selos do card) como palavra inteira.
    for (const chave of ['card.stamp.reject', 'card.stamp.read']) {
      const nome = D[l][chave];
      assert.ok(nome, `CONTROLE (${l}): o selo ${chave} sumiu do dicionário`);
      assert.doesNotMatch(frase, new RegExp('(?<!\\p{L})' + nome + '(?!\\p{L})', 'u'),
        `DEFEITO (${l}): a frase promete o Desfazer só pro "${nome}" — e o interruptor desliga a janela de TODA ação (o ↑ com ⭐, aprovar, excluir e corrigir o nome da foto)`);
    }
    assert.ok(frase.includes(termo), `${l}: a frase não diz "${termo}", o termo que o app usa pro Desfazer`);
  }
  // A reserva do HTML (o que se lê antes do JS) é a frase do pt.
  const m = /data-i18n="prefs\.undo\.desc">([^<]*)</.exec(HTML);
  assert.ok(m, 'CONTROLE: a frase sumiu do index.src.html');
  assert.equal(m[1], D.pt['prefs.undo.desc'].replace('{undoSeg}', '3'), 'a reserva do HTML diz outra coisa que o dicionário pt');
  // E o que o navegador carrega (gotcha #22): o js/min/i18n.js e o index.html gerados.
  assert.ok(ler('js/min/i18n.js').includes(D.pt['prefs.undo.desc']), 'js/min/i18n.js está atrás do fonte — falta `npm run js`');
  assert.ok(ler('index.html').includes(m[1]), 'o index.html está atrás do index.src.html — falta `npm run html`');
});

test('R14-7-A4: CONTROLE — o interruptor desliga MESMO a janela das escritas da foto e do ↑ (a frase geral é a verdade)', () => {
  // A MESMA condição do `scheduleAction` (o ✕, o ✓, o ↑ e o lote) nas três escritas
  // do lightbox: se uma delas deixar de ler o interruptor, a frase volta a ser revista.
  for (const nome of ['pedirExclusaoDaFoto', 'aprovarFotoAtual', 'confirmarRenomear']) {
    assert.match(fatiar(nome), /const semJanela = AppState\.preferences\.undoEnabled === false && canDisableUndo\(\);/,
      `${nome} não lê mais o interruptor do Desfazer`);
  }
  assert.match(fatiar('scheduleAction'), /if \(AppState\.preferences\.undoEnabled === false && canDisableUndo\(\)\) \{/,
    'o scheduleAction não lê mais o interruptor do Desfazer');
});

// ═══ R14-7-A2 · o convite de instalar: o Safari pela POSITIVA ═══════════════
// As UAs abaixo são as que cada navegador PUBLICA — conhecimento da plataforma,
// não medição (não há iPhone aqui). As de app com `Safari/` foram montadas pra
// exercitar a marca; sem o `Safari/`, a regra de cima já as pega.
NO_BUNDLE.push(/safariDoIOS\(/g, /webViewDeAppNoIOS\(/g);
const UA_BASE = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)`;
const UAS = {
  // o Safari (CONTROLE): o passo da barra do Safari, em qualquer iOS
  'Safari 17.4': [UA_BASE('17_4') + ' Version/17.4 Mobile/15E148 Safari/604.1', 'safari'],
  'Safari 15.0': [UA_BASE('15_0') + ' Version/15.0 Mobile/15E148 Safari/604.1', 'safari'],
  'Safari 16.3': [UA_BASE('16_3') + ' Version/16.3 Mobile/15E148 Safari/604.1', 'safari'],
  // os navegadores: o passo do menu deles, do iOS 16.4 em diante
  'Chrome 17.4 (CONTROLE)': [UA_BASE('17_4') + ' CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1', 'navegador'],
  'Edge 17.4 (CONTROLE)': [UA_BASE('17_4') + ' EdgiOS/123.0.2420.56 Version/17.0 Mobile/15E148 Safari/604.1', 'navegador'],
  'Opera 17.4 (OPT)': [UA_BASE('17_4') + ' Version/17.4 Mobile/15E148 Safari/604.1 OPT/4.5.0', 'navegador'],
  'Opera Mini 17.4 (OPiOS)': [UA_BASE('17_4') + ' OPiOS/16.0.15.124050 Mobile/15E148 Safari/9537.53', 'navegador'],
  'DuckDuckGo 17.4 (DuckDuckGo/7)': [UA_BASE('17_4') + ' Version/17.4 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15', 'navegador'],
  'DuckDuckGo 18.5 (Ddg/)': [UA_BASE('18_5') + ' Version/18.5 Mobile/15E148 Ddg/18.5 Safari/604.1', 'navegador'],
  'app do Google 17.4 (GSA)': [UA_BASE('17_4') + ' GSA/313.0.627131925 Mobile/15E148 Safari/604.1', 'navegador'],
  // um navegador que a lista NÃO conhece (com `Safari/`, sem `Version/`): pela
  // positiva ele não é o Safari — é o caso que a negativa errava sempre
  'navegador desconhecido 17.4': [UA_BASE('17_4') + ' Mobile/15E148 Safari/604.1', 'navegador'],
  'Chrome 16.3 (CONTROLE)': [UA_BASE('16_3') + ' CriOS/110.0.5481.83 Mobile/15E148 Safari/604.1', 'nada'],
  'Opera 16.3 (OPT)': [UA_BASE('16_3') + ' Version/16.3 Mobile/15E148 Safari/604.1 OPT/3.4.6', 'nada'],
  'DuckDuckGo 16.3': [UA_BASE('16_3') + ' Version/16.3 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15', 'nada'],
  'app do Google 16.3 (GSA)': [UA_BASE('16_3') + ' GSA/250.0.512345678 Mobile/15E148 Safari/604.1', 'nada'],
  // DENTRO de outro app: sem convite em iOS nenhum
  'Facebook 17.4': [UA_BASE('17_4') + ' Mobile/21E219 [FBAN/FBIOS;FBAV/455.0.0.39.107;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.4;FBLC/pt_BR;FBOP/5]', 'nada'],
  'Facebook 15.0': [UA_BASE('15_0') + ' Mobile/19A346 [FBAN/FBIOS;FBAV/350.0.0.0;FBDV/iPhone12,1;FBMD/iPhone;FBSN/iOS;FBSV/15.0;FBLC/pt_BR]', 'nada'],
  'Instagram 17.4': [UA_BASE('17_4') + ' Mobile/15E148 Instagram 323.0.0.24.111 (iPhone15,2; iOS 17_4; pt_BR; pt; scale=3.00; 1179x2556; 581045925)', 'nada'],
  'LINE 17.4': [UA_BASE('17_4') + ' Mobile/15E148 Safari Line/13.10.0', 'nada'],
  'WeChat 17.4': [UA_BASE('17_4') + ' Mobile/15E148 MicroMessenger/8.0.47(0x18002f2c) NetType/WIFI Language/zh_CN', 'nada'],
  'Snapchat 17.4 ("like Safari/")': [UA_BASE('17_4') + ' Mobile/15E148 Snapchat/12.80.0.33 (like Safari/8617.1.17.10.10, panda)', 'nada'],
  'LinkedIn com Safari/ (montada)': [UA_BASE('17_4') + ' Mobile/15E148 Safari/604.1 [LinkedInApp]/9.29.6', 'nada'],
  'Facebook com Safari/ (montada)': [UA_BASE('17_4') + ' Version/17.4 Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/455.0.0.39.107]', 'nada'],
  'app sem marca e sem Safari/': [UA_BASE('17_4') + ' Mobile/15E148', 'nada'],
};

function montarConvite({ userAgent, toques = 5, prompt = false }) {
  const el = (attrs = {}, innerHTML = '') => ({ classList: classes('hidden'), attrs, innerHTML,
    getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); } });
  // O 1º passo nasce com a chave e o texto do Safari (o HTML, depois do `applyI18n`).
  const els = { installInvite: el(), installInviteBtn: el(), installIosSteps: el(),
    installIosStep1: el({ 'data-i18n-html': 'install.ios.step1' }, 'T:install.ios.step1') };
  const deps = {
    navigator: { userAgent, maxTouchPoints: toques, standalone: false },
    window: { matchMedia: () => ({ matches: false }) },
    document: { getElementById: (id) => els[id] || null },
    safeLS: { get: () => null },
    CHAVE_INSTALL_DISPENSADO: 'waze_places_install_dispensado',
    promptInstalacao: prompt ? { prompt() {} } : null,
    filaTerminouLimpa: () => true,   // o "Tudo limpo!" de quem terminou a fila
    t: (k) => 'T:' + k,
  };
  const marcas = ['MARCAS_DE_NAVEGADOR_NO_IOS', 'MARCAS_DE_APP_NO_IOS'].filter(existeConst).map(declaracao);
  const h = rodar(deps, [...marcas, ...fontes(['appJaInstalada', 'ehIOS', 'webViewDeAppNoIOS', 'safariDoIOS',
    'navegadorDoIOSForaDoSafari', 'versaoDoIOS', 'iOSAdicionaATelaDeInicioAqui', 'convitePodeAparecer',
    'atualizarConviteInstalar'])], ['atualizarConviteInstalar']);
  h.atualizarConviteInstalar();
  const visivel = (id) => !els[id].classList.contains('hidden');
  const convite = visivel('installInvite');
  return { convite, botao: convite && visivel('installInviteBtn'), passos: convite && visivel('installIosSteps'),
    chave: els.installIosStep1.getAttribute('data-i18n-html'), texto: els.installIosStep1.innerHTML };
}
// O que a tela deve mostrar com cada UA: o passo do Safari, o do navegador, ou nada.
const ESPERADO = {
  safari: { convite: true, passos: true, botao: false, chave: 'install.ios.step1' },
  navegador: { convite: true, passos: true, botao: false, chave: 'install.ios.step1Navegador' },
};

test('R14-7-A2: no Opera, no DuckDuckGo e no app do Google do iPhone, o 1º passo é o do MENU do navegador — o do Safari, só no Safari', () => {
  for (const [nome, [ua, vale]] of Object.entries(UAS)) {
    if (vale === 'nada') continue;
    const m = montarConvite({ userAgent: ua });
    const visto = { convite: m.convite, passos: m.passos, botao: m.botao, chave: m.chave };
    assert.deepEqual(visto, ESPERADO[vale], vale === 'safari'
      ? `CONTROLE (${nome}): o Safari perdeu o convite ou o passo da barra do Safari`
      : `DEFEITO (${nome}): o convite manda "Toque em Compartilhar, na barra do Safari" a quem NÃO está no Safari (ou nem aparece)`);
    assert.equal(m.texto, 'T:' + m.chave, `${nome}: a chave trocou e o texto na tela não`);
  }
});

test('R14-7-A2: DENTRO de um app (Facebook, Instagram, LINE, WeChat, Snapchat…) e fora do Safari num iOS antes do 16.4, o convite NÃO aparece', () => {
  for (const [nome, [ua, vale]] of Object.entries(UAS)) {
    if (vale !== 'nada') continue;
    const m = montarConvite({ userAgent: ua });
    assert.equal(m.convite, false,
      `DEFEITO (${nome}): o convite apareceu onde não há "Adicionar à Tela de Início" — o beco sem saída da régua "isto é acionável AQUI?"`);
  }
  // CONTROLE: o Safari de um iOS antigo segue com o convite (ele sempre adicionou).
  assert.equal(montarConvite({ userAgent: UAS['Safari 15.0'][0] }).convite, true, 'CONTROLE: o Safari do iOS 15 perdeu o convite');
  // CONTROLE: o iPad que se anuncia como Mac — o Safari e o Chrome dele — segue com o convite.
  const mac = (marca) => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) ' + marca;
  const ipadSafari = montarConvite({ userAgent: mac('Version/18.0 Safari/605.1.15') });
  assert.deepEqual([ipadSafari.convite, ipadSafari.chave], [true, 'install.ios.step1'], 'CONTROLE: o Safari do iPad (UA de Mac) perdeu o convite');
  const ipadChrome = montarConvite({ userAgent: mac('CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1') });
  assert.deepEqual([ipadChrome.convite, ipadChrome.chave], [true, 'install.ios.step1Navegador'], 'CONTROLE: o Chrome do iPad perdeu o convite');
  // CONTROLE: o computador sem toque não é iOS, e com o prompt do navegador é o BOTÃO.
  assert.equal(montarConvite({ userAgent: mac('Version/18.0 Safari/605.1.15'), toques: 0 }).convite, false,
    'CONTROLE: o Mac de mesa (sem toque) ganhou o convite do iPhone');
  const pc = montarConvite({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', toques: 0, prompt: true });
  assert.deepEqual([pc.botao, pc.passos], [true, false], 'CONTROLE: o computador com o prompt perdeu o botão');
});

test('R14-7-A2: as listas de marcas são FECHADAS e cada marca diz o motivo — e o Safari se reconhece pela POSITIVA', () => {
  for (const nome of ['MARCAS_DE_NAVEGADOR_NO_IOS', 'MARCAS_DE_APP_NO_IOS']) {
    // No FONTE com os comentários: cada linha de marca leva o seu `// motivo`.
    const ini = APP.search(new RegExp('^const ' + nome + ' = \\[', 'm'));
    assert.ok(ini >= 0, `a lista ${nome} sumiu do app.js`);
    const bloco = APP.slice(ini, APP.indexOf('\n];', ini));
    const linhas = bloco.split('\n').slice(1).filter((l) => /^\s+\//.test(l));
    assert.ok(linhas.length >= 5, `CONTROLE: só ${linhas.length} marcas em ${nome} — o recorte quebrou`);
    for (const l of linhas) assert.match(l, /,\s+\/\/ \S/, `${nome}: marca sem o motivo escrito — "${l.trim()}"`);
  }
  const safari = fatiar('safariDoIOS');
  assert.match(safari, /\\bVersion\\\/\\d/, 'o Safari deixou de exigir o `Version/` (a positiva)');
  assert.match(safari, /\\bSafari\\\//, 'o Safari deixou de exigir o `Safari/`');
});

// ═══ O bundle gerado tem os consertos (gotcha #22) ═════════════════════════
test('o js/min/app.js — o que o navegador carrega — tem os consertos deste lote', () => {
  const MIN = ler('js/min/app.js');
  const contar = (txt, re) => (txt.match(re) || []).length;
  assert.ok(NO_BUNDLE.length > 0, 'CONTROLE: nenhuma seção disse o que o bundle tem que ter');
  for (const re of NO_BUNDLE) {
    assert.ok(contar(APP_SEM, re) > 0, `o app.js não tem ${re}`);
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${re} — falta \`npm run js\``);
  }
});
