// O TREINO, os avisos de UMA VEZ e o foco de quem usa o TECLADO ao entrar e sair
// dele (auditoria da rodada 8, 2026-10-03). MEDIDO no navegador pelo auditor:
//   R8-7-01 — uma decisão REAL que pousa com o treino aberto (o ✕ da janela do
//             Desfazer que o "Praticar" despacha, o caso que o lote 11 tornou
//             comum) mostrava — e GASTAVA — o aviso de consequência da 1ª vez e
//             o desbloqueio do Desfazer (com confete), e a folha do "Rejeitar os
//             N" abria sobre o card de treino: tudo por cima da faixa "nada é
//             enviado ao Waze", e os dois primeiros nunca mais apareciam;
//   R8-7-07 — o fim do treino fechado pelo TECLADO (Enter no "Ir para a fila",
//             Esc) largava o foco no ⓘ do topo;
//   R8-7-08 — o "Quero treinar antes" pelo teclado largava o foco no <body>;
//   R8-7-09 — o "Praticar" (e o "Quero treinar antes") SEM sessão — a renovação
//             silenciosa pela extensão — fechava o diálogo e não fazia nada.
// E na rodada 9 (2026-10-06):
//   R9-7-05 — a folha do autor aberta de um card de treino oferecia o que
//             ESCREVE: o interruptor armava a recusa automática de verdade;
//   R9-7-02 — o próximo gesto de treino apagava os avisos de VERDADE que tinham
//             chegado com ele aberto (o resultado do "Rejeitar os N"…);
//   R9-7-07 — o "Praticar" recusado pelo lote ou pela aprovação no ar fechava o
//             diálogo, e o aviso mandava tocar de novo num botão fora da tela;
//   R9-7-03 — no "Como funciona" que abre sozinho, o "Quero treinar antes" pelo
//             teclado largava o foco no ⓘ do topo.
// E na rodada 10 (2026-10-07):
//   R10-7-03 — no mesmo diálogo, o "Entendi" (e o Esc) pelo teclado largava o
//             foco no ⓘ, e o Enter seguinte reabria a Ajuda;
//   R10-7-04 — o "Praticar" da Ajuda pelo teclado, idem.
//
// Os testes RODAM as funções de verdade, fatiadas do app.js, num escopo só: o
// que o teste não fornece é um "buraco negro" que aceita qualquer chamada. Por
// isso cada um tem o CONTROLE que prova que o instrumento enxerga o que mede (o
// aviso que SAI fora do treino, a folha que ABRE sem ele, o foco que VOLTA a
// quem abriu), e foi visto REPROVANDO com o conserto desfeito (as sabotagens
// estão no relatório da rodada).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
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
// A declaração `const NOME = …;` INTEIRA: objeto, lista ou valor de uma linha.
function declaracao(nome) {
  const m = new RegExp('^const ' + nome + ' = ', 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  const ini = m.index + m[0].length;
  const c = APP_SEM[ini];
  const fim = c === '{' ? fechar(APP_SEM, ini) : c === '[' ? fechar(APP_SEM, ini, '[', ']') : APP_SEM.indexOf(';', ini);
  return APP_SEM.slice(m.index, fim) + ';';
}
// O `$('id')?.addEventListener(…)` INTEIRO, como está no `setupAppListeners`:
// pelos parênteses, nunca por distância (gotcha #67).
function ouvinte(id) {
  const corpo = fatiar('setupAppListeners');
  const marca = `$('${id}')?.addEventListener(`;
  const ini = corpo.indexOf(marca);
  assert.ok(ini >= 0, `o ouvinte de #${id} sumiu do setupAppListeners`);
  let par = 0, j = ini + marca.length - 1;
  for (; j < corpo.length; j++) {
    if (corpo[j] === '(') par++;
    else if (corpo[j] === ')') { par--; if (par === 0) break; }
  }
  return corpo.slice(ini, j + 1) + ';';
}

function buracoNegro() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro()),
    apply: () => buracoNegro(), set: () => true,
  });
}
// As funções de verdade num escopo só, com `deps` por fora: o que não está nem
// nelas nem no `globalThis` vira buraco negro. O estado compartilhado
// (`focoDoTeclado`, o foco de antes do modal) mora em `deps`, onde o teste o lê.
function rodar(deps, fontes, devolve) {
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : typeof k === 'string' ? buracoNegro() : undefined),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('__escopo', `with (__escopo) {\n${fontes.join('\n')}\nreturn { ${devolve.join(', ')} };\n}`)(escopo);
}
const tique = () => new Promise((ok) => setImmediate(ok));

// ═══ R8-7-01 · os avisos de uma vez, na CONFIRMAÇÃO de uma decisão real ═════
// O pouso de verdade (`handleActionResult`, ramo do sucesso) com o aviso de
// consequência, a confirmação (`registrarAcaoConfirmada`) e a cota do Desfazer
// (`checkUndoGateUnlock`) de verdade. L6 (cota 10) com 9 confirmados; cada pouso
// conta no Histórico ANTES de confirmar, como o `recordHistory` do app.
function montarPouso({ treino = false, confirmados = 9, vistas = {} } = {}) {
  const toasts = [], confetes = [];
  const hist = { _total: { read: confirmados, rejected: 0 } };
  const AppState = { authenticated: true, pendingAction: null, stats: { read: confirmados, rejected: 0, skipped: 0 },
    preferences: { undoEnabled: true, undoGateSeen: false, dicaDesfazerVista: false, consequenciaVista: { ...vistas } },
    devMode: { active: false } };
  const deps = {
    AppState, Treino: { ativo: treino },
    perfilDoPortao: () => ({ rank: 5, isStaff: false }),
    loadHistory: () => hist,
    recordHistory: (tipo) => { hist._total[tipo === 'read' ? 'read' : 'rejected']++; },
    savePreferences: () => {},
    showToast: (m, tipo) => { toasts.push([m, tipo]); return { dispensar() {}, texto() {} }; },
    dispararConfeteNaFila: () => confetes.push('confete'),
    t: (k) => k,
    anotadoAntesDoEnvio: new Set(), descargaNaFila: new Set(),
  };
  const app = rodar(deps, [declaracao('UNDO_GATE_BASE'), declaracao('CONSEQUENCIA_AVISADA'),
    ...['handleActionResult', 'avisarConsequencia', 'registrarAcaoConfirmada', 'checkUndoGateUnlock',
      'getUndoTreatedCount', 'getUndoUnlockThreshold', 'pedidosNaJanelaDoDesfazer', 'pedidosConfirmados'].map(fatiar)],
  ['handleActionResult']);
  let n = 0;
  // A decisão: o placar anda no GESTO, e a resposta do Waze pousa.
  const decidir = (tipo) => {
    n++;
    AppState.stats[tipo === 'read' ? 'read' : 'rejected']++;
    app.handleActionResult(tipo, { venueID: 'v' + n, updateRequestID: 'u' + n }, { success: true }, 'row', 0, null);
  };
  const avisos = (chave) => toasts.filter(([m]) => m === chave);
  return { AppState, Treino: deps.Treino, decidir, avisos, toasts, confetes };
}

test('R8-7-01: o aviso de consequência da 1ª vez NÃO sai nem é gasto com o treino aberto — sai na próxima confirmação fora dele', () => {
  // CONTROLE: sem o treino, a 1ª rejeição confirmada avisa e marca.
  const c = montarPouso();
  c.decidir('reject');
  assert.deepEqual(c.avisos('consequencia.reject'), [['consequencia.reject', 'hint']],
    'CONTROLE: a 1ª rejeição confirmada fora do treino não avisou — o teste perdeu o sentido');
  assert.equal(c.AppState.preferences.consequenciaVista.reject, true, 'CONTROLE: o aviso não ficou marcado como visto');
  for (const tipo of ['reject', 'read']) {
    const m = montarPouso({ treino: true });
    m.decidir(tipo);   // a decisão da janela do Desfazer, pousando com o treino na tela
    assert.deepEqual(m.avisos('consequencia.' + tipo), [],
      `DEFEITO: "${tipo}" confirmado com o treino aberto mostrou o aviso de 1ª vez por cima da faixa "nada é enviado ao Waze"`);
    assert.notEqual(m.AppState.preferences.consequenciaVista[tipo], true,
      `DEFEITO: o aviso de 1ª vez de "${tipo}" ficou GASTO no treino — nunca mais aparece onde ele explica alguma coisa`);
    // Fora do treino, a próxima decisão confirmada é a que avisa.
    m.Treino.ativo = false;
    m.decidir(tipo);
    assert.deepEqual(m.avisos('consequencia.' + tipo), [['consequencia.' + tipo, 'hint']],
      `o aviso de "${tipo}" que o treino segurou não saiu na próxima confirmação fora dele`);
    assert.equal(m.AppState.preferences.consequenciaVista[tipo], true);
  }
});

test('R8-7-01: o desbloqueio do Desfazer (banner e confete) NÃO sai nem é gasto com o treino aberto — sai na próxima confirmação fora dele', () => {
  // CONTROLE: sem o treino, o 10º confirmado (L6, cota 10) comemora uma vez.
  const c = montarPouso();
  c.decidir('read');
  assert.deepEqual(c.avisos('toast.undoUnlocked'), [['toast.undoUnlocked', 'achievement']],
    'CONTROLE: o 10º confirmado fora do treino não anunciou o desbloqueio — o teste perdeu o sentido');
  assert.deepEqual(c.confetes, ['confete']);
  assert.equal(c.AppState.preferences.undoGateSeen, true);
  const m = montarPouso({ treino: true });
  m.decidir('read');
  assert.deepEqual(m.avisos('toast.undoUnlocked'), [],
    'DEFEITO: o desbloqueio do Desfazer saiu sobre o card de TREINO, com a faixa "nada é enviado ao Waze"');
  assert.deepEqual(m.confetes, [], 'DEFEITO: o confete do desbloqueio caiu sobre o card de treino');
  assert.equal(m.AppState.preferences.undoGateSeen, false,
    'DEFEITO: o aviso de UMA VEZ NA VIDA ficou gasto no treino — o desbloqueio nunca mais é anunciado');
  assert.equal(m.AppState.preferences.dicaDesfazerVista, false, 'a dica por comportamento ficou silenciada pelo aviso que não saiu');
  m.Treino.ativo = false;
  m.decidir('read');
  assert.deepEqual(m.avisos('toast.undoUnlocked'), [['toast.undoUnlocked', 'achievement']],
    'o desbloqueio que o treino segurou não saiu na próxima confirmação fora dele');
  assert.deepEqual(m.confetes, ['confete']);
  assert.equal(m.AppState.preferences.undoGateSeen, true);
});

// O resultado do "Rejeitar os N" (`mostrarResultadoDoLote`). Com o treino
// aberto ele vira AVISO, como já era com outra camada aberta, e a folha não abre.
function montarResultado({ treino = false, camada = null } = {}) {
  const toasts = [], modais = [];
  const els = { autorCorpo: { innerHTML: '' }, autorTitle: { textContent: '' } };
  const deps = {
    Treino: { ativo: treino },
    document: { getElementById: (id) => els[id] || null },
    topOpenModal: () => (camada === 'filtros' ? { id: 'filtersModal' } : null),
    Lightbox: { isOpen: () => camada === 'foto' }, MapaLightbox: { isOpen: () => false },
    showToast: (m, tipo) => { toasts.push([m, tipo]); return {}; }, openModal: (id) => modais.push(id),
    t: (k, v) => (v && v.n != null ? `${k}#${v.n}` : k), escapeHtml: (x) => x,
  };
  const { mostrarResultadoDoLote } = rodar(deps, [fatiar('mostrarResultadoDoLote')], ['mostrarResultadoDoLote']);
  return { mostrar: (conta) => mostrarResultadoDoLote({ ok: 0, fila: 0, ja: 0, erro: 0, ...conta }), toasts, modais, els };
}

test('R8-7-01: o resultado do "Rejeitar os N" que pousa com o treino aberto vira AVISO — a folha "Foram pro Waze no seu nome" não abre sobre o treino', () => {
  // CONTROLE 1: sem o treino, a folha abre com a frase do que foi pro Waze.
  const c = montarResultado();
  c.mostrar({ ok: 2 });
  assert.deepEqual(c.modais, ['autorModal'], 'CONTROLE: sem o treino a folha do resultado não abriu');
  assert.match(c.els.autorCorpo.innerHTML, /autor\.lote\.rejeitados\.desc/);
  assert.deepEqual(c.toasts, []);
  // CONTROLE 2: com outra camada (os Filtros) já era aviso — o caminho que o treino passa a seguir.
  const f = montarResultado({ camada: 'filtros' });
  f.mostrar({ ok: 2 });
  assert.deepEqual([f.modais, f.toasts], [[], [['autor.lote.rejeitados#2', 'success']]],
    'CONTROLE: com os Filtros abertos o resultado não virou aviso');
  // O treino aberto.
  const m = montarResultado({ treino: true });
  m.mostrar({ ok: 2 });
  assert.deepEqual(m.modais, [], 'DEFEITO: a folha "Foram pro Waze no seu nome" abriu sobre o card de TREINO');
  assert.equal(m.els.autorCorpo.innerHTML, '', 'a folha foi escrita com o treino na tela');
  assert.deepEqual(m.toasts, [['autor.lote.rejeitados#2', 'success']],
    'o resultado do lote sumiu: com o treino aberto ele vira AVISO, com as mesmas frases');
  // E com falha no meio, o aviso é de erro (o recusado volta pra fila real no "Sair").
  const e = montarResultado({ treino: true });
  e.mostrar({ ok: 1, erro: 1 });
  assert.deepEqual(e.toasts, [['autor.lote.rejeitadosUm#1 · autor.lote.falharamUm#1', 'error']]);
});

// ═══ R8-7-09 · o treino pedido por um diálogo, SEM sessão ═══════════════════
// Os ouvintes DE VERDADE do "Praticar" (Ajuda) e do "Quero treinar antes"
// ("Como funciona"), fatiados do `setupAppListeners`, com a guarda
// (`recusarTreino`), o `Treino` de verdade (a conferência dele,
// `motivoDeRecusa`) e o `avisoDaTrava` de verdade. O `Treino.entrar` é ESPIADO
// (`espiar`): o que se mede aqui é o diálogo. Sem espiar, é o `entrar` de
// verdade, que recusa pela MESMA conferência.
// O que pode estar no ar (R9-7-07): o "Marcar todos" (`lote`) e a aprovação de
// uma foto (`aprovacao`): no ar, na janela do Desfazer ou da sessão que caiu.
function montarDialogos({ autenticado, renovando = true, lote = false, aprovacao = null, epocaDaQueda = 4, espiar = true }) {
  const toasts = [], fechados = [], entradas = [], ouvintes = {};
  const deps = {
    AppState: { authenticated: autenticado, contaEmDuvida: false, fetchEpoch: 4 },
    extRenovando: renovando, loteDeLidosEmVoo: lote, escritasConferindo: 0,
    aprovacaoPendente: aprovacao === 'janela' ? { place: { venueID: 'v1', updateRequestID: 'u1' } } : null,
    aprovacoesNoAr: new Set(aprovacao === 'noAr' ? ['v1|u1'] : []),
    // A da sessão que CAIU segura o treino só na fila que atravessou a queda (a época de agora).
    aprovacoesDaQueda: new Map(aprovacao === 'queda' ? [['v1|u1', epocaDaQueda]] : []),
    showToast: (m, tipo) => { toasts.push([m, tipo]); return {}; }, t: (k) => k,
    closeModal: (id) => fechados.push(id),
    prometerFocoAoCardQueVem: () => {}, veioDoTeclado: () => false,
    $: (id) => ({ addEventListener: (tipo, fn) => { ouvintes[id] = fn; } }),
  };
  const { Treino } = rodar(deps, [fatiar('avisoDaTrava'), fatiar('recusarTreino'), declaracao('Treino'),
    ouvinte('abrirTreino'), ouvinte('comoFuncionaTreinar')], ['Treino']);
  if (espiar) Treino.entrar = () => entradas.push('entrar');
  return { ouvintes, toasts, fechados, entradas, Treino };
}

test('R8-7-09: o "Praticar" (e o "Quero treinar antes") SEM sessão diz o que esperar e o diálogo FICA — com a sessão, abre o treino', () => {
  for (const [id, dialogo] of [['abrirTreino', 'helpModal'], ['comoFuncionaTreinar', 'comoFuncionaModal']]) {
    // CONTROLE: com a sessão, fecha o diálogo e entra no treino.
    const c = montarDialogos({ autenticado: true });
    c.ouvintes[id]({ detail: 1 });
    assert.deepEqual([c.fechados, c.entradas, c.toasts], [[dialogo], ['entrar'], []],
      `CONTROLE: com sessão, #${id} não abriu o treino — o teste perdeu o sentido`);
    // A renovação silenciosa pela extensão (o "aguarde" da ponte).
    const r = montarDialogos({ autenticado: false, renovando: true });
    r.ouvintes[id]({ detail: 1 });
    assert.deepEqual(r.toasts, [['toast.esperaSessao', 'info']],
      `DEFEITO: #${id} durante a renovação da sessão não disse nada — o toque parecia ignorado`);
    assert.deepEqual(r.fechados, [], `DEFEITO: #${id} sem sessão fechou o diálogo pra não fazer nada`);
    assert.deepEqual(r.entradas, [], `#${id} sem sessão tentou entrar no treino`);
    // Sem sessão e sem renovação (a pergunta à extensão sem resposta): a mesma guarda, a frase dela.
    const s = montarDialogos({ autenticado: false, renovando: false });
    s.ouvintes[id]({ detail: 1 });
    assert.deepEqual([s.toasts, s.fechados], [[['api.error.noSession', 'info']], []]);
  }
});

// ═══ R8-7-07 e R8-7-08 · o FOCO de quem usa o teclado ao entrar e sair ══════
// A tela de mentira, de verdade o bastante pro foco: um elemento só está NA TELA
// conectado e sem `hidden` nele nem num pai; `focus()` num elemento fora da tela
// não faz nada; tirar o card da tela leva junto o foco que estava nele (o
// navegador manda pro <body>); e o foco num elemento que ficou escondido FICA lá
// até o próximo desenho — o `aplicarFocoDoTeclado` o lê como perdido. O
// `focusin` do app (`ultimoFocoForaDasCamadas`) também. As funções de verdade:
// `openModal`/`closeModal` com a limpeza (`LIMPEZA_AO_FECHAR`), o
// `devolverFoco`, o `Treino` inteiro, o foco prometido e o `handleKeyDown` (o
// Esc), e os ouvintes do "Ir para a fila", do "Quero treinar antes", do
// "Entendi" e do "Praticar".
function montarTela({ filaReal = 2, hasMore = false } = {}) {
  const d = { body: { nome: '<body>', tagName: 'BODY', style: {} }, documentElement: { nome: '<html>' } };
  d.activeElement = d.body;
  const els = {};
  const deps = { focoDoTeclado: null, lastFocusedBeforeModal: null, ultimoFocoForaDasCamadas: null };
  const naTela = (e) => {
    for (let n = e; n; n = n.pai) if (!n.conectado || n.classes.has('hidden')) return false;
    return true;
  };
  function el(nome, { pai = null, tag = 'DIV', classes = [], dialogo = false, id = null } = {}) {
    const cs = new Set(classes);
    const e = {
      id, nome, tagName: tag, pai, classes: cs, conectado: true, disabled: false, dialogo, filhos: [], style: {}, dataset: {},
      textContent: '', setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
      get isConnected() { for (let n = e; n; n = n.pai) if (!n.conectado) return false; return true; },
      classList: {
        add: (...xs) => xs.forEach((x) => cs.add(x)), remove: (...xs) => xs.forEach((x) => cs.delete(x)),
        contains: (x) => cs.has(x),
        toggle: (x, f) => { if (f === undefined ? !cs.has(x) : f) cs.add(x); else cs.delete(x); return cs.has(x); },
        replace: (a, b) => { if (!cs.delete(a)) return false; cs.add(b); return true; },
      },
      getClientRects: () => (naTela(e) ? [1] : []),
      focus() {
        if (!naTela(e) || e.disabled) return;
        d.activeElement = e;
        if (!e.closest('[role="dialog"]')) deps.ultimoFocoForaDasCamadas = e;   // o `focusin` do app
      },
      closest: (sel) => {
        if (sel !== '[role="dialog"]') return null;
        for (let n = e; n; n = n.pai) if (n.dialogo) return n;
        return null;
      },
      contains: (x) => { for (let n = x; n; n = n.pai) if (n === e) return true; return false; },
      // `.classe` (os botões do card) ou o primeiro botão (o `openModal` focando o 1º focável).
      querySelector: (sel) => {
        const fila = [...e.filhos];
        while (fila.length) {
          const f = fila.shift();
          if (sel.startsWith('.') ? f.classes.has(sel.slice(1)) : f.tagName === 'BUTTON' && !f.disabled) return f;
          fila.push(...f.filhos);
        }
        return null;
      },
    };
    if (pai) pai.filhos.push(e);
    if (id) els[id] = e;
    return e;
  }
  const botao = (id, pai) => el(id, { pai, tag: 'BUTTON', id });
  // O cabeçalho, a área do card e os painéis do fim (nascem escondidos, como no HTML).
  const topo = el('header');
  botao('helpBtn', topo);
  const main = el('main');
  const cardStack = el('cardStack', { pai: main });
  botao('reloadBtn', el('noMoreCards', { pai: main, classes: ['hidden'], id: 'noMoreCards' }));
  botao('retryLoadBtn', el('loadErrorState', { pai: main, classes: ['hidden'], id: 'loadErrorState' }));
  el('treinoBanner', { pai: main, classes: ['hidden'], id: 'treinoBanner' });
  // Os diálogos, com os botões na ordem do HTML.
  const dialogo = (id, ...bs) => {
    const m = el(id, { classes: ['hidden'], dialogo: true, id });
    for (const b of bs) botao(b, m);
    return m;
  };
  dialogo('helpModal', 'closeHelp', 'abrirTreino');
  dialogo('comoFuncionaModal', 'comoFuncionaTreinar', 'comoFuncionaOk');
  dialogo('treinoFimModal', 'treinoFimOk');
  d.getElementById = (id) => els[id] || null;

  // O card da frente: montar troca o da tela (o `renderCurrentCard`), e o foco
  // prometido ao teclado pousa DEPOIS da tarefa, como lá.
  const estado = { card: null, buscas: 0, toasts: [] };
  let app = null;
  const tirarCard = () => {
    if (!estado.card) return;
    estado.card.conectado = false;
    if (estado.card.contains(d.activeElement)) d.activeElement = d.body;
    estado.card = null;
  };
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore,
    queue: [], currentPlace: null, stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: filaReal, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true, undoEnabled: true }, contaEmDuvida: false };
  const P = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, updateTypeKey: 'VENUE', imageUrls: [] });
  AppState.queue = Array.from({ length: filaReal }, (_, i) => P(i + 1));
  const avisarFoco = () => { if (deps.focoDoTeclado) queueMicrotask(() => app.aplicarFocoDoTeclado()); };
  const ouvintes = {};
  Object.assign(deps, {
    AppState, document: d,
    CamadaVoltar: { profundidade: 0, consumindo: false, empilhar() {}, consumir() {} },
    Lightbox: { isOpen: () => false }, MapaLightbox: { isOpen: () => false },
    acoesTravadas: () => false, extRenovando: false, escritasConferindo: 0,
    loteDeLidosEmVoo: false, aprovacaoPendente: null, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(),
    semJanelaDeDesfazer: () => false, t: (k) => k,
    showToast: (m, tipo) => { estado.toasts.push([m, tipo]); return { dispensar() {}, texto() {} }; },
    cardDaFrente: () => estado.card,
    removeCurrentCardEl: tirarCard,
    showCurrentPlace: () => {
      const p = AppState.queue[0];
      if (!p) { AppState.currentPlace = null; if (AppState.hasMore) deps.startFetching(); else deps.showNoPlaces(); return; }
      AppState.currentPlace = p;
      tirarCard();
      const card = el('card ' + (p._treino ? 'de treino ' : 'real ') + p.venueID, { pai: cardStack });
      for (const [cls, rot] of [['card-btn-reject', '✕'], ['card-btn-skip', '↑'], ['card-btn-read', '✓']]) {
        el(rot + ' ' + card.nome, { pai: card, tag: 'BUTTON', classes: [cls] });
      }
      estado.card = card;
      els.noMoreCards.classList.add('hidden');
      avisarFoco();
    },
    showNoPlaces: () => {
      AppState.currentPlace = null;
      tirarCard();
      els.noMoreCards.classList.remove('hidden');
      avisarFoco();
    },
    startFetching: () => { estado.buscas++; },
    $: (id) => ({ addEventListener: (tipo, fn) => { ouvintes[id] = fn; } }),
  });
  app = rodar(deps, [
    declaracao('MODAL_IDS'), declaracao('LIMPEZA_AO_FECHAR'), declaracao('BOTAO_DA_ACAO'),
    declaracao('TECLAS_DE_CURSOR'), declaracao('TECLAS_DOS_ATALHOS_DO_NAVEGADOR'), declaracao('Treino'),
    ...['openModal', 'closeModal', 'topOpenModal', 'devolverFoco', 'focavelNaTela', 'dentroDeCamada', 'veioDoTeclado',
      'prometerFocoAoCardQueVem', 'aplicarFocoDoTeclado', 'avisoDaTrava', 'recusarTreino', 'handleKeyDown',
      'atalhoDoNavegador', 'focoEmCampoDeTexto'].map(fatiar),
    ...['abrirTreino', 'comoFuncionaTreinar', 'comoFuncionaOk', 'treinoFimOk'].map(ouvinte),
  ], ['Treino', 'openModal', 'closeModal', 'handleKeyDown', 'aplicarFocoDoTeclado']);
  // O clique no botão: pelo teclado (Enter/Espaço no botão FOCADO, `detail` 0)
  // ou pelo mouse (`detail` 1 — e o `pointerdown`, em captura no app, solta o
  // foco prometido antes).
  const clicar = async (id, { teclado }) => {
    const b = els[id];
    if (teclado) assert.equal(d.activeElement, b, `PRÉ-CONDIÇÃO: o Enter não caiu no #${id} focado (${d.activeElement.nome})`);
    else deps.focoDoTeclado = null;
    ouvintes[id]({ detail: teclado ? 0 : 1, currentTarget: b });
    await tique();
  };
  const focado = () => d.activeElement && d.activeElement.nome;
  return { app, AppState, d, els, deps, estado, clicar, focado, P, botaoDoCard: (cls) => estado.card && estado.card.querySelector(cls) };
}

// O treino inteiro pelo TECLADO, até o "Treino concluído": o Enter no ⓘ e no
// "Praticar", e o Enter no ✓ de cada card de treino (o `fireAction` promete o
// foco ao ✓ do próximo, e o último abre o fim do treino com o foco nele).
async function ateOFimDoTreino(m) {
  m.els.helpBtn.focus();
  m.app.openModal('helpModal');
  m.els.abrirTreino.focus();
  await m.clicar('abrirTreino', { teclado: true });
  assert.equal(m.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino não abriu');
  for (let i = 0; i < 10 && m.els.treinoFimModal.classes.has('hidden'); i++) {
    const ok = m.botaoDoCard('.card-btn-read');
    ok.focus();
    assert.equal(m.d.activeElement, ok, `PRÉ-CONDIÇÃO: o ✓ do card de treino não ficou com o foco (${m.focado()})`);
    m.deps.focoDoTeclado = '.card-btn-read';   // o `pedirFocoDoTeclado` do `fireAction`
    m.app.Treino.agir('read');
    await tique();
  }
  assert.equal(m.els.treinoFimModal.classes.has('hidden'), false, 'PRÉ-CONDIÇÃO: o "Treino concluído" não abriu');
  assert.equal(m.d.activeElement, m.els.treinoFimOk, 'PRÉ-CONDIÇÃO: o fim do treino não abriu com o foco no "Ir para a fila"');
}
const SAIDAS = {
  'Enter no "Ir para a fila"': (m) => m.clicar('treinoFimOk', { teclado: true }),
  Esc: async (m) => { m.app.handleKeyDown({ key: 'Escape', preventDefault() {} }); await tique(); },
};
const SAIDAS_SEM_TECLADO = {
  'o mouse no "Ir para a fila"': (m) => m.clicar('treinoFimOk', { teclado: false }),
  'o fundo (o mouse fora do cartão)': async (m) => { m.deps.focoDoTeclado = null; m.app.closeModal('treinoFimModal'); await tique(); },
  'o voltar do aparelho': async (m) => { m.app.closeModal('treinoFimModal', { viaHistorico: true }); await tique(); },
};

test('R8-7-07: o fim do treino fechado pelo TECLADO (Enter no "Ir para a fila", Esc) leva o foco ao ✕ do card real que volta', async () => {
  for (const [caminho, sair] of Object.entries(SAIDAS)) {
    const m = montarTela();
    m.deps.showCurrentPlace();
    await ateOFimDoTreino(m);
    await sair(m);
    assert.equal(m.app.Treino.ativo, false, `PRÉ-CONDIÇÃO: ${caminho} não saiu do treino`);
    assert.equal(m.AppState.currentPlace && m.AppState.currentPlace.venueID, 'v1', `PRÉ-CONDIÇÃO: ${caminho}: a fila real não voltou`);
    assert.equal(m.d.activeElement, m.botaoDoCard('.card-btn-reject'),
      `DEFEITO: ${caminho} — o fim do treino fechou e o foco ficou em "${m.focado()}" (o ⓘ do topo, no navegador): quem usa teclado recomeça da Ajuda`);
  }
});

test('R8-7-07: CONTROLE — pelo mouse, pelo fundo e pelo voltar o foco NÃO pula pro card (a regra do C10); volta a quem abriu, como antes', async () => {
  for (const [caminho, sair] of Object.entries(SAIDAS_SEM_TECLADO)) {
    const m = montarTela();
    m.deps.showCurrentPlace();
    await ateOFimDoTreino(m);
    await sair(m);
    assert.equal(m.app.Treino.ativo, false, `PRÉ-CONDIÇÃO: ${caminho} não saiu do treino`);
    assert.notEqual(m.d.activeElement, m.botaoDoCard('.card-btn-reject'), `${caminho}: o foco pulou pro ✕ do card sem o teclado`);
    // O de sempre: quem abriu o fim do treino (o ✓ do último card) saiu com ele,
    // e o `devolverFoco` cai no ⓘ — prova também que o instrumento enxerga o
    // fechamento devolvendo o foco.
    assert.equal(m.d.activeElement, m.els.helpBtn, `${caminho}: o foco foi pra "${m.focado()}"`);
    assert.equal(m.deps.focoDoTeclado, null, `${caminho}: sobrou foco prometido ao teclado`);
  }
});

test('R8-7-07: sem card na fila real, o fim do treino pelo teclado leva o foco ao botão do painel do fim ("Verificar novamente")', async () => {
  for (const [caminho, sair] of Object.entries(SAIDAS)) {
    const m = montarTela({ filaReal: 0 });
    m.deps.showNoPlaces();   // a fila real ACABOU: "Tudo limpo!" na tela, e a pessoa abre o treino pela Ajuda
    await ateOFimDoTreino(m);
    await sair(m);
    assert.equal(m.els.noMoreCards.classes.has('hidden'), false, `PRÉ-CONDIÇÃO: ${caminho}: o painel do fim não voltou`);
    assert.equal(m.d.activeElement, m.els.reloadBtn,
      `DEFEITO: ${caminho} — sem card, o foco ficou em "${m.focado()}" e não no "Verificar novamente"`);
  }
  // E com mais por buscar (a busca que estava no ar quando o treino abriu foi
  // descartada): o "Sair" busca de novo, e o foco espera o card que ela traz.
  const m = montarTela({ filaReal: 0, hasMore: true });
  await ateOFimDoTreino(m);
  await SAIDAS.Esc(m);
  assert.equal(m.estado.buscas, 1, 'PRÉ-CONDIÇÃO: o "Sair" do treino não buscou a fila real');
  m.AppState.queue = [m.P(7)];
  m.deps.showCurrentPlace();   // a busca pousa
  await tique();
  assert.equal(m.d.activeElement, m.botaoDoCard('.card-btn-reject'), `o foco não esperou o card da busca (${m.focado()})`);
});

test('R8-7-08: "Quero treinar antes" pelo TECLADO leva o foco ao ✕ do card de TREINO — não ao <body>', async () => {
  // O "Como funciona" ADIADO: abriu no fim da janela do 1º ✕ pelo teclado, com
  // o foco guardado no ✕ do card real (o conserto do R7-7-01).
  const abrir = async () => {
    const m = montarTela();
    m.deps.showCurrentPlace();
    m.botaoDoCard('.card-btn-reject').focus();
    m.app.openModal('comoFuncionaModal');
    return m;
  };
  // CONTROLE: o "Entendi" devolve o foco ao ✕ do card real (quem abriu).
  const c = await abrir();
  const xReal = c.botaoDoCard('.card-btn-reject');
  c.els.comoFuncionaOk.focus();
  await c.clicar('comoFuncionaOk', { teclado: true });
  assert.equal(c.d.activeElement, xReal, `CONTROLE: o "Entendi" não devolveu o foco ao ✕ (${c.focado()}) — o teste perdeu o sentido`);
  // O "Quero treinar antes": o foco vai ao ✕ do card de treino que entra.
  const m = await abrir();
  m.els.comoFuncionaTreinar.focus();
  await m.clicar('comoFuncionaTreinar', { teclado: true });
  assert.equal(m.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino não abriu');
  assert.ok(m.estado.card && /de treino/.test(m.estado.card.nome), 'PRÉ-CONDIÇÃO: o card de treino não entrou');
  assert.equal(m.d.activeElement, m.botaoDoCard('.card-btn-reject'),
    `DEFEITO: o "Quero treinar antes" pelo teclado largou o foco em "${m.focado()}" — o card real saiu com ele`);
  // CONTROLE do C10: pelo mouse, nada é prometido e o foco não pula pro card.
  const s = await abrir();
  await s.clicar('comoFuncionaTreinar', { teclado: false });
  assert.equal(s.app.Treino.ativo, true);
  assert.notEqual(s.d.activeElement, s.botaoDoCard('.card-btn-reject'), 'o mouse moveu o foco pro card de treino');
  assert.equal(s.deps.focoDoTeclado, null, 'o mouse deixou o foco prometido ao teclado');
});

// ═══ R9-7-05 · a folha do autor aberta de um card de TREINO ═════════════════
// O selo "✕ N" do card de treino (o clone de um pedido real, com o autor de
// verdade) abria a folha com as linhas que ESCREVEM: o "Rejeitar os N" (recusado
// com a frase do "Marcar todos"), o interruptor "Rejeitar sozinho os próximos
// deste autor" — que ARMAVA a recusa automática de verdade: depois do "Sair" do
// treino e do ↻, o Waze recebeu as rejeições — e o "Esquecer", que apaga a
// contagem do aparelho (MEDIDO no navegador; auditoria de 2026-10-06). DECISÃO:
// no treino a folha não oferece o que escreve, como os botões da foto, que
// somem. A folha de verdade (`abrirFolhaDoAutor`), num DOM de mentira em que só
// existe o que a folha DESENHOU: ouvinte pendurado num elemento que ela não
// desenhou lança, como no navegador.
function montarFolha({ treino, doAutor = 3 }) {
  const ouvidos = [], abertos = [];
  const corpo = { innerHTML: '' }, titulo = { textContent: '' };
  const fila = [];
  for (let i = 1; i <= doAutor; i++) fila.push({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 901, createdBy: 'spammer' });
  fila.push({ venueID: 'v9', updateRequestID: 'u9', creatorId: 902, createdBy: 'outro' });
  const deps = {
    Treino: { ativo: treino },
    AppState: { queue: fila, currentPlace: fila[0], preferences: { undoEnabled: true }, devMode: { active: false } },
    pedidosEmAndamento: new Set(),
    document: {
      getElementById: (id) => {
        if (id === 'autorCorpo') return corpo;
        if (id === 'autorTitle') return titulo;
        if (!corpo.innerHTML.includes(`id="${id}"`)) return null;
        return { id, checked: false, addEventListener: (tipo) => ouvidos.push(id + ':' + tipo) };
      },
    },
    t: (k) => k, escapeHtml: (x) => String(x), canDisableUndo: () => false,
    ICONE_OLHO: '', ICONE_X: '', ICONE_LIXO: '', ICONE_RAIO: '',
    contagemDoAutor: () => 6, podeRecusarAutomaticoAqui: () => true, autoLigado: () => false,
    openModal: (id) => abertos.push(id),
  };
  const { abrirFolhaDoAutor } = rodar(deps, ['chaveDoPedido', 'serieDoAutor', 'semJanelaDeDesfazer', 'abrirFolhaDoAutor'].map(fatiar),
    ['abrirFolhaDoAutor']);
  abrirFolhaDoAutor(fila[0]);
  const ids = [...corpo.innerHTML.matchAll(/id="(\w+)"/g)].map((x) => x[1]);
  return { ids, html: corpo.innerHTML, ouvidos, abertos };
}

test('R9-7-05: a folha do autor aberta de um card de TREINO não oferece o que escreve — nem o "Rejeitar os N", nem o interruptor, nem o "Esquecer"', () => {
  // CONTROLE: fora do treino (L6+AM, 3 do autor na fila), as quatro linhas e o aviso do lote.
  const c = montarFolha({ treino: false });
  assert.deepEqual(c.ids, ['autorVer', 'autorRejeitar', 'autorAuto', 'autorEsquecer'],
    'CONTROLE: fora do treino, a folha não tinha as quatro linhas — o teste perdeu o sentido');
  assert.match(c.html, /autor\.sheet\.aviso/, 'CONTROLE: o aviso do lote sumiu fora do treino');
  assert.deepEqual(c.ouvidos, ['autorVer:click', 'autorRejeitar:click', 'autorAuto:change', 'autorEsquecer:click']);
  // No treino.
  const m = montarFolha({ treino: true });
  assert.deepEqual(m.abertos, ['autorModal'], 'a folha deixou de abrir no treino — ela ainda explica o "✕ N"');
  assert.match(m.html, /autor\.sheet\.sub/, 'a frase que explica o "✕ N" sumiu no treino');
  assert.ok(!m.ids.includes('autorAuto'),
    'DEFEITO: o interruptor "Rejeitar sozinho os próximos deste autor" no treino — ele ARMA a recusa automática de verdade');
  assert.ok(!m.ids.includes('autorRejeitar'),
    'DEFEITO: o "Rejeitar os N" oferecido no treino, pra ser recusado com a frase do "Marcar todos"');
  assert.ok(!m.ids.includes('autorEsquecer'), 'DEFEITO: o "Esquecer" no treino apaga a contagem de verdade do aparelho');
  assert.doesNotMatch(m.html, /autor\.sheet\.aviso/, 'o aviso vermelho do lote ficou no treino, sem a linha que ele descreve');
  // O que não escreve fica: o "Ver os N" só põe os exemplos do autor na frente.
  assert.deepEqual(m.ids, ['autorVer']);
  assert.deepEqual(m.ouvidos, ['autorVer:click']);
  // Com um só do autor no treino, a folha é só a frase (e o ✕ do topo).
  const um = montarFolha({ treino: true, doAutor: 1 });
  assert.deepEqual([um.ids, um.abertos], [[], ['autorModal']]);
  assert.match(um.html, /autor\.sheet\.subUm/);
});

// ═══ R9-7-02 · o próximo gesto de treino apagava os avisos de VERDADE ═══════
// `Treino.limparAvisos` (no topo de cada `agir`) tirava TODO aviso da pilha: o
// resultado do "Rejeitar os N" que pousou com o treino aberto (R8-7-01), o "Não
// deu pra excluir a foto", o "Acesso renovado pelo WME", o "Erro ao rejeitar"
// sumiam no primeiro ✕/✓/↑ de treino (MEDIDO no navegador; auditoria de
// 2026-10-06). O `showToast` de VERDADE, numa pilha de mentira com o teto de 3
// e o relógio parado (o aviso que "sai devagar" fica na pilha, como nos 250 ms
// da animação), e o `Treino` de verdade.
function montarAvisos() {
  const no = () => {
    const n = {
      pai: null, className: '', title: '', style: {}, dataset: {}, _html: '',
      set innerHTML(v) { n._html = String(v); },
      get innerHTML() { return n._html; },
      get textContent() { return n._html.replace(/<[^>]+>/g, ''); },
      addEventListener() {}, querySelector: () => null,
      remove() {
        if (!n.pai) return;
        const i = n.pai.filhos.indexOf(n);
        if (i >= 0) n.pai.filhos.splice(i, 1);
        n.pai = null;
      },
    };
    return n;
  };
  const pilha = () => {
    const p = no();
    p.filhos = [];
    Object.defineProperty(p, 'children', { get: () => p.filhos });
    Object.defineProperty(p, 'firstElementChild', { get: () => p.filhos[0] || null });
    p.appendChild = (n) => { n.remove(); n.pai = p; p.filhos.push(n); return n; };
    p.removeChild = (n) => { n.remove(); return n; };
    return p;
  };
  const els = { toastContainer: pilha(), bannerContainer: pilha() };
  const P = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, updateTypeKey: 'VENUE', imageUrls: [] });
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: [1, 2, 3, 4].map(P), currentPlace: null, stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 4,
    autorEmFoco: null, preferences: { comoFuncionaVisto: true, undoEnabled: true } };
  AppState.currentPlace = AppState.queue[0];
  const deps = {
    AppState, document: { getElementById: (id) => els[id] || null, createElement: () => no() },
    t: (k) => k, escapeHtml: (x) => String(x), dlog: () => {},
    // O relógio PARADO: nada sai sozinho durante o teste.
    setTimeout: () => 0, clearTimeout: () => {},
    loteDeLidosEmVoo: false, aprovacaoPendente: null, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(),
    Lightbox: { isOpen: () => false }, MapaLightbox: { isOpen: () => false },
    updateStats: () => {}, updatePendingCount: () => {}, removeCurrentCardEl: () => {}, showCurrentPlace: () => {},
    showLoading: () => {}, removeUndoBanner: () => {}, enviarPendenciasDoLightbox: () => {}, savePreferences: () => {},
  };
  const app = rodar(deps, [declaracao('Treino'), fatiar('showToast'), fatiar('fecharCamadasDeFoto')], ['Treino', 'showToast']);
  const naPilha = () => els.toastContainer.filhos.map((n) => n.textContent);
  return { ...app, naPilha };
}

test('R9-7-02: o próximo gesto de treino tira só o aviso que o TREINO pôs — os avisos de verdade que chegaram com ele aberto ficam', () => {
  const m = montarAvisos();
  m.Treino.entrar();
  assert.equal(m.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino não abriu');
  // O resultado do "Rejeitar os N" que a janela do Desfazer despachou pousa com o treino aberto.
  m.showToast('2 rejeitados', 'success');
  m.Treino.agir('read');
  assert.deepEqual(m.naPilha(), ['2 rejeitados', 'treino.efeito.read'],
    `DEFEITO: o 1º gesto de treino apagou o resultado do lote (${JSON.stringify(m.naPilha())})`);
  // A sessão renovada pela extensão, com o treino aberto.
  m.showToast('Acesso renovado pelo WME', 'info');
  m.Treino.agir('reject');
  assert.deepEqual(m.naPilha(), ['2 rejeitados', 'Acesso renovado pelo WME', 'treino.efeito.reject'],
    `DEFEITO: o gesto de treino apagou um aviso de verdade (${JSON.stringify(m.naPilha())})`);
  // CONTROLE (o "um aviso por vez" do treino, que tapava o "Ir para a fila"): o
  // aviso ANTERIOR do treino saiu — e saiu NA HORA. Saindo devagar, ele ainda
  // contava no teto de 3 da pilha, e o aviso novo empurrava pra fora o primeiro
  // aviso de verdade.
  m.Treino.agir('skip');
  assert.deepEqual(m.naPilha(), ['2 rejeitados', 'Acesso renovado pelo WME', 'treino.efeito.skip'],
    `o aviso do treino não saiu na hora (ou empurrou um de verdade pra fora): ${JSON.stringify(m.naPilha())}`);
  assert.equal(m.naPilha().filter((x) => x.startsWith('treino.efeito.')).length, 1, 'os avisos do treino se empilharam');
});

// ═══ R9-7-07 · o treino recusado pelo lote ou pela aprovação NO AR ══════════
// O R8-7-09 fez o diálogo FICAR na recusa pela sessão. As outras recusas do
// `Treino.entrar` — o "Marcar todos" no ar, a aprovação de uma foto no ar —
// vinham DEPOIS de fechar: a Ajuda fechava, e o aviso mandava "toque de novo"
// num botão que tinha saído da tela (MEDIDO no navegador, s21; auditoria de
// 2026-10-06). A conferência é UMA (`Treino.motivoDeRecusa`), feita antes de
// fechar, e o diálogo fica nas três.
const RECUSAS_NO_AR = [
  ['o "Marcar todos" no ar', { lote: true }, 'toast.esperaLote'],
  ['a aprovação de uma foto no ar', { aprovacao: 'noAr' }, 'toast.esperaAprovacao'],
  ['a aprovação na janela do Desfazer', { aprovacao: 'janela' }, 'toast.esperaAprovacao'],
  ['a aprovação da sessão que caiu, na fila que atravessou a queda', { aprovacao: 'queda' }, 'toast.esperaAprovacao'],
];

test('R9-7-07: "Praticar" (e "Quero treinar antes") com o "Marcar todos" ou a aprovação de uma foto NO AR diz o que esperar e o diálogo FICA', () => {
  for (const [id, dialogo] of [['abrirTreino', 'helpModal'], ['comoFuncionaTreinar', 'comoFuncionaModal']]) {
    for (const [caso, op, aviso] of RECUSAS_NO_AR) {
      const m = montarDialogos({ autenticado: true, ...op });
      m.ouvintes[id]({ detail: 1 });
      assert.deepEqual(m.fechados, [],
        `DEFEITO: #${id} com ${caso} fechou o diálogo — o aviso manda "toque de novo" num botão que saiu da tela`);
      assert.deepEqual(m.toasts, [[aviso, 'info']], `#${id} com ${caso} não disse o que esperar`);
      assert.deepEqual(m.entradas, [], `#${id} com ${caso} tentou entrar no treino`);
    }
    // CONTROLE: a aprovação da queda de OUTRA fila (refeita depois) não segura o
    // treino — fecha e entra, como com nada no ar.
    for (const op of [{}, { aprovacao: 'queda', epocaDaQueda: 3 }]) {
      const c = montarDialogos({ autenticado: true, ...op });
      c.ouvintes[id]({ detail: 1 });
      assert.deepEqual([c.fechados, c.entradas, c.toasts], [[dialogo], ['entrar'], []],
        `CONTROLE (${JSON.stringify(op)}): #${id} não abriu o treino — o teste perdeu o sentido`);
    }
  }
});

test('R9-7-07: o `Treino.entrar` recusa pela MESMA conferência dos diálogos (`motivoDeRecusa`) — duas listas divergiriam caladas', () => {
  for (const [caso, op, aviso] of RECUSAS_NO_AR) {
    const m = montarDialogos({ autenticado: true, espiar: false, ...op });
    assert.equal(m.Treino.motivoDeRecusa(), aviso, `a conferência não viu ${caso}`);
    m.Treino.entrar();
    assert.equal(m.Treino.ativo, false, `o treino abriu com ${caso}`);
    assert.deepEqual(m.toasts, [[aviso, 'info']], `o \`entrar\` com ${caso} não disse o que esperar`);
  }
  // CONTROLE: com nada no ar (e com sessão), a conferência deixa abrir; sem sessão, é a da trava.
  assert.equal(montarDialogos({ autenticado: true, espiar: false }).Treino.motivoDeRecusa(), null);
  assert.equal(montarDialogos({ autenticado: false, espiar: false }).Treino.motivoDeRecusa(), 'toast.esperaSessao');
  // A ESTRUTURA: o `entrar` não tem lista própria, e o diálogo pergunta à mesma conferência.
  const T = declaracao('Treino');
  const i = T.indexOf('\n    entrar() {');
  assert.ok(i >= 0, 'o `Treino.entrar` sumiu');
  const entrar = T.slice(i, fechar(T, i));
  assert.match(entrar, /const motivo = this\.motivoDeRecusa\(\);/, 'o `entrar` deixou de perguntar à conferência única');
  assert.doesNotMatch(entrar, /loteDeLidosEmVoo|aprovacoesNoAr|aprovacaoPendente|aprovacoesDaQueda/,
    'o `entrar` voltou a ter uma lista própria de recusas — o diálogo e ele divergem calados');
  assert.match(fatiar('recusarTreino'), /const motivo = Treino\.motivoDeRecusa\(\);/,
    'o diálogo deixou de perguntar à conferência do `entrar`');
});

test('R9-7-07: na tela, o "Praticar" recusado pelo "Marcar todos" no ar deixa a Ajuda ABERTA — e o mesmo toque, depois, abre o treino', async () => {
  const m = montarTela();
  m.deps.showCurrentPlace();
  m.els.helpBtn.focus();
  m.app.openModal('helpModal');
  m.deps.loteDeLidosEmVoo = true;   // o "Marcar todos" no ar
  await m.clicar('abrirTreino', { teclado: false });
  assert.equal(m.els.helpModal.classes.has('hidden'), false,
    'DEFEITO: a Ajuda fechou, e o aviso manda "toque de novo" num "Praticar" que saiu da tela');
  assert.equal(m.app.Treino.ativo, false, 'o treino abriu com o lote no ar');
  assert.deepEqual(m.estado.toasts, [['toast.esperaLote', 'info']]);
  // O lote terminou: o mesmo botão, que segue na tela, abre o treino.
  m.deps.loteDeLidosEmVoo = false;
  await m.clicar('abrirTreino', { teclado: false });
  assert.equal(m.els.helpModal.classes.has('hidden'), true, 'CONTROLE: com nada no ar, a Ajuda não fechou');
  assert.equal(m.app.Treino.ativo, true, 'CONTROLE: com nada no ar, o "Praticar" não abriu o treino');
});

// ═══ R9-7-03 · o "Quero treinar antes" no "Como funciona" que abre SOZINHO ══
// O "Como funciona" da primeira vez abre sozinho quando o 1º card monta, com
// NADA focado antes (o <body>). O fechamento devolvia o foco à reserva — o ⓘ do
// topo, um controle VIVO —, e o foco prometido ao ✕ do card de treino desistia
// dele: pelo teclado, o foco caía no ⓘ, e o Enter seguinte reabria a Ajuda
// (MEDIDO nos dois motores; auditoria de 2026-10-06). No adiado (o R8-7-08,
// acima) dava certo só porque quem abriu era o ✕ do card REAL, que sai com o
// `entrar`. Agora o fechamento não devolve o foco quando ele já foi prometido
// (`closeModal(…, { focoComDestino })`).
test('R9-7-03: no "Como funciona" que abre SOZINHO no 1º card, "Quero treinar antes" pelo TECLADO leva o foco ao ✕ do card de TREINO — não ao ⓘ', async () => {
  const abrir = () => {
    const m = montarTela();
    m.deps.showCurrentPlace();   // o 1º card montou…
    assert.equal(m.d.activeElement, m.d.body, 'PRÉ-CONDIÇÃO: havia foco antes do diálogo — não é o caminho do que abre sozinho');
    m.app.openModal('comoFuncionaModal');   // …e o "Como funciona" abriu sozinho
    return m;
  };
  // CONTROLE: o "Entendi" pelo MOUSE cai na reserva, o ⓘ (a regra do R6-1-07)
  // — e prova que o instrumento enxerga o fechamento devolvendo o foco a ele.
  // (Pelo TECLADO, desde o R10-7-03, o "Entendi" vai ao ✕ do card: abaixo.)
  const c = abrir();
  await c.clicar('comoFuncionaOk', { teclado: false });
  assert.equal(c.d.activeElement, c.els.helpBtn, `CONTROLE: o "Entendi" não devolveu o foco ao ⓘ (${c.focado()}) — o teste perdeu o sentido`);
  // O "Quero treinar antes" pelo teclado.
  const m = abrir();
  m.els.comoFuncionaTreinar.focus();
  await m.clicar('comoFuncionaTreinar', { teclado: true });
  assert.equal(m.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino não abriu');
  assert.ok(m.estado.card && /de treino/.test(m.estado.card.nome), 'PRÉ-CONDIÇÃO: o card de treino não entrou');
  assert.equal(m.d.activeElement, m.botaoDoCard('.card-btn-reject'),
    `DEFEITO: o "Quero treinar antes" pelo teclado largou o foco em "${m.focado()}" — o ⓘ do topo, e o Enter seguinte reabre a Ajuda`);
  // CONTROLE do C10: pelo mouse nada é prometido, e o fechamento devolve o foco à reserva, como antes.
  const s = abrir();
  await s.clicar('comoFuncionaTreinar', { teclado: false });
  assert.equal(s.app.Treino.ativo, true);
  assert.equal(s.d.activeElement, s.els.helpBtn, `pelo mouse, o foco foi pra "${s.focado()}"`);
  assert.equal(s.deps.focoDoTeclado, null, 'o mouse deixou o foco prometido ao teclado');
  // E já DENTRO do treino (Ajuda → "Ver de novo" → "Quero treinar antes"): o
  // `entrar` não troca o card, e não há card novo pra receber o foco — o
  // fechamento o devolve a quem abriu a camada (o ⓘ), como sempre. Sem isso ele
  // ficava no botão escondido, e o navegador o mandava pro <body>.
  const j = montarTela();
  j.deps.showCurrentPlace();
  j.app.Treino.entrar();
  assert.equal(j.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino não abriu');
  const cardDeTreino = j.estado.card;
  j.els.helpBtn.focus();
  j.app.openModal('helpModal');
  j.app.openModal('comoFuncionaModal');   // o "Ver de novo" da Ajuda (trocar de modal, sem fechar)
  j.els.comoFuncionaTreinar.focus();
  await j.clicar('comoFuncionaTreinar', { teclado: true });
  assert.equal(j.estado.card, cardDeTreino, 'PRÉ-CONDIÇÃO: o card de treino foi trocado — o caso é outro');
  assert.equal(j.d.activeElement, j.els.helpBtn,
    `já no treino, o "Quero treinar antes" pelo teclado largou o foco em "${j.focado()}" — o botão escondido`);
});

// ═══ R10-7-03 · o "Entendi" (e o Esc) do "Como funciona" pelo TECLADO ════════
// A frase publicada (v2026.10.03-01) diz que, pelo teclado, fechar o "Como
// funciona" devolve o foco ao ✕ do pedido, e não ao botão da Ajuda. Só valia no
// diálogo ADIADO, em que quem abriu era o ✕: no que abre SOZINHO no 1º card — o
// de toda pessoa que chega — o Enter no "Entendi" (e o Esc) levava o foco ao ⓘ
// do topo, e o Enter seguinte reabria a Ajuda (MEDIDO no navegador; auditoria de
// 2026-10-07). O "Ver de novo" da Ajuda também. Agora a limpeza do modal
// (`LIMPEZA_AO_FECHAR.comoFuncionaModal`) promete o ✕ do card NA TELA quando o
// fechamento vem do teclado, e o foco pousa logo depois.
const ABERTURAS_DO_COMO_FUNCIONA = {
  // O 1º card montou e o diálogo abriu sozinho, com NADA focado.
  'o que abre sozinho': (m) => {
    m.deps.showCurrentPlace();
    assert.equal(m.d.activeElement, m.d.body, 'PRÉ-CONDIÇÃO: havia foco antes do diálogo — não é o caminho do que abre sozinho');
    m.app.openModal('comoFuncionaModal');
  },
  // O adiado (R7-7-01): abriu no fim da janela do 1º ✕, com o foco no ✕.
  'o adiado': (m) => {
    m.deps.showCurrentPlace();
    m.botaoDoCard('.card-btn-reject').focus();
    m.app.openModal('comoFuncionaModal');
  },
  // O "Ver de novo" da Ajuda (trocar de modal, sem fechar), aberta pelo ⓘ.
  'o "Ver de novo"': (m) => {
    m.deps.showCurrentPlace();
    m.els.helpBtn.focus();
    m.app.openModal('helpModal');
    m.app.openModal('comoFuncionaModal');
  },
  // O mesmo DENTRO do treino: o card na tela é o de treino.
  'o "Ver de novo" no treino': (m) => {
    m.deps.showCurrentPlace();
    m.app.Treino.entrar();
    assert.equal(m.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino não abriu');
    m.els.helpBtn.focus();
    m.app.openModal('helpModal');
    m.app.openModal('comoFuncionaModal');
  },
};
const FECHAR_PELO_TECLADO = {
  'Enter no "Entendi"': async (m) => { m.els.comoFuncionaOk.focus(); await m.clicar('comoFuncionaOk', { teclado: true }); },
  Esc: async (m) => { m.app.handleKeyDown({ key: 'Escape', preventDefault() {} }); await tique(); },
};

test('R10-7-03: fechar o "Como funciona" pelo TECLADO (Enter no "Entendi", Esc) leva o foco ao ✕ do card NA TELA — também no que abre SOZINHO', async () => {
  for (const [abertura, abrir] of Object.entries(ABERTURAS_DO_COMO_FUNCIONA)) {
    for (const [caminho, fechar] of Object.entries(FECHAR_PELO_TECLADO)) {
      const m = montarTela();
      abrir(m);
      const card = m.estado.card;
      assert.equal(m.els.comoFuncionaModal.classes.has('hidden'), false, `PRÉ-CONDIÇÃO (${abertura}): o diálogo não abriu`);
      await fechar(m);
      assert.equal(m.els.comoFuncionaModal.classes.has('hidden'), true, `PRÉ-CONDIÇÃO (${abertura}, ${caminho}): o diálogo não fechou`);
      assert.equal(m.estado.card, card, `PRÉ-CONDIÇÃO (${abertura}, ${caminho}): o card foi trocado — o caso é outro`);
      assert.equal(m.d.activeElement, m.botaoDoCard('.card-btn-reject'),
        `DEFEITO (${abertura}, ${caminho}): o foco ficou em "${m.focado()}" — no navegador, o ⓘ do topo, e o Enter seguinte reabre a Ajuda`);
      assert.equal(m.deps.focoDoTeclado, null, `${abertura}, ${caminho}: sobrou foco prometido ao teclado`);
    }
  }
});

test('R10-7-03: CONTROLE — pelo mouse, pelo fundo e pelo voltar o foco NÃO pula pro card (o C10); sem card na tela, o teclado o devolve a quem abriu', async () => {
  // O mouse no "Entendi" do que abre sozinho: a reserva, o ⓘ — e prova que o
  // instrumento enxerga o fechamento devolvendo o foco.
  const s = montarTela();
  ABERTURAS_DO_COMO_FUNCIONA['o que abre sozinho'](s);
  await s.clicar('comoFuncionaOk', { teclado: false });
  assert.equal(s.d.activeElement, s.els.helpBtn, `pelo mouse, o foco foi pra "${s.focado()}"`);
  assert.equal(s.deps.focoDoTeclado, null, 'o mouse deixou o foco prometido ao teclado');
  // O fundo e o voltar do aparelho fecham sem `peloTeclado`: idem.
  for (const [caminho, opcoes] of [['o fundo', {}], ['o voltar do aparelho', { viaHistorico: true }]]) {
    const f = montarTela();
    ABERTURAS_DO_COMO_FUNCIONA['o que abre sozinho'](f);
    f.app.closeModal('comoFuncionaModal', opcoes);
    await tique();
    assert.equal(f.d.activeElement, f.els.helpBtn, `${caminho}: o foco foi pra "${f.focado()}"`);
    assert.equal(f.deps.focoDoTeclado, null, `${caminho}: sobrou foco prometido ao teclado`);
  }
  // Sem card na tela (o "Tudo limpo!", e o "Ver de novo" da Ajuda): o teclado
  // devolve o foco a quem abriu (o ⓘ) — e não ao botão do painel do fim.
  for (const [caminho, fechar] of Object.entries(FECHAR_PELO_TECLADO)) {
    const v = montarTela({ filaReal: 0 });
    v.deps.showNoPlaces();
    v.els.helpBtn.focus();
    v.app.openModal('helpModal');
    v.app.openModal('comoFuncionaModal');
    await fechar(v);
    assert.equal(v.els.comoFuncionaModal.classes.has('hidden'), true, `PRÉ-CONDIÇÃO (sem card, ${caminho}): o diálogo não fechou`);
    assert.equal(v.d.activeElement, v.els.helpBtn, `sem card, ${caminho}: o foco foi pra "${v.focado()}", e não pra quem abriu (o ⓘ)`);
    assert.equal(v.deps.focoDoTeclado, null, `sem card, ${caminho}: sobrou foco prometido ao teclado`);
  }
});

test('R10-7-03: com o card TRAVADO (a janela do Desfazer de um ✕ anterior), o foco do "Entendi" pelo teclado espera — e pousa no ✕ quando a trava acaba', async () => {
  const m = montarTela();
  ABERTURAS_DO_COMO_FUNCIONA['o "Ver de novo"'](m);
  let travado = true;
  m.deps.acoesTravadas = () => travado;
  await FECHAR_PELO_TECLADO['Enter no "Entendi"'](m);
  assert.notEqual(m.d.activeElement, m.botaoDoCard('.card-btn-reject'), 'o foco pousou no ✕ com o card travado');
  assert.equal(m.deps.focoDoTeclado, '.card-btn-reject', 'o foco prometido ao ✕ se perdeu na trava');
  travado = false;
  m.app.aplicarFocoDoTeclado();   // o `aplicarTravaDeAcao`, quando a trava acaba
  assert.equal(m.d.activeElement, m.botaoDoCard('.card-btn-reject'), `com a trava solta, o foco foi pra "${m.focado()}"`);
});

// ═══ R10-7-04 · o "Praticar" da Ajuda pelo TECLADO ══════════════════════════
// Os dois botões que abrem o treino levavam o foco a lugares diferentes: o
// "Quero treinar antes" ao ✕ do card de treino (R8-7-08, R9-7-03), e o
// "Praticar" ao ⓘ — o fechamento da Ajuda devolvia o foco a quem a abriu, e o
// Enter seguinte a reabria (MEDIDO no navegador; auditoria de 2026-10-07).
test('R10-7-04: "Praticar" (na Ajuda) pelo TECLADO leva o foco ao ✕ do 1º card de TREINO — não ao ⓘ', async () => {
  const abrirAjuda = (m) => {
    m.deps.showCurrentPlace();
    m.els.helpBtn.focus();
    m.app.openModal('helpModal');
  };
  const m = montarTela();
  abrirAjuda(m);
  m.els.abrirTreino.focus();
  await m.clicar('abrirTreino', { teclado: true });
  assert.equal(m.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino não abriu');
  assert.ok(m.estado.card && /de treino/.test(m.estado.card.nome), 'PRÉ-CONDIÇÃO: o card de treino não entrou');
  assert.equal(m.els.helpModal.classes.has('hidden'), true, 'PRÉ-CONDIÇÃO: a Ajuda não fechou');
  assert.equal(m.d.activeElement, m.botaoDoCard('.card-btn-reject'),
    `DEFEITO: o "Praticar" pelo teclado largou o foco em "${m.focado()}" — no navegador, o ⓘ do topo, e o Enter seguinte reabre a Ajuda`);
  // CONTROLE do C10: pelo mouse nada é prometido, e o fechamento devolve o foco
  // a quem abriu a Ajuda (o ⓘ) — o instrumento enxerga o fechamento.
  const s = montarTela();
  abrirAjuda(s);
  await s.clicar('abrirTreino', { teclado: false });
  assert.equal(s.app.Treino.ativo, true);
  assert.equal(s.d.activeElement, s.els.helpBtn, `pelo mouse, o foco foi pra "${s.focado()}"`);
  assert.equal(s.deps.focoDoTeclado, null, 'o mouse deixou o foco prometido ao teclado');
});

test('R10-7-04: o "Praticar" RECUSADO pelo teclado deixa a Ajuda aberta com o foco nele (R9-7-07); já no treino, o foco volta a quem abriu', async () => {
  // O "Marcar todos" no ar: o treino é recusado, a Ajuda FICA, e nada é
  // prometido a um card de treino que não vem.
  const r = montarTela();
  r.deps.showCurrentPlace();
  r.els.helpBtn.focus();
  r.app.openModal('helpModal');
  r.deps.loteDeLidosEmVoo = true;
  r.els.abrirTreino.focus();
  await r.clicar('abrirTreino', { teclado: true });
  assert.equal(r.els.helpModal.classes.has('hidden'), false, 'a Ajuda fechou no "Praticar" recusado');
  assert.equal(r.app.Treino.ativo, false, 'o treino abriu com o lote no ar');
  assert.deepEqual(r.estado.toasts, [['toast.esperaLote', 'info']]);
  assert.equal(r.d.activeElement, r.els.abrirTreino, `o foco saiu do "Praticar", que segue na tela (${r.focado()})`);
  assert.equal(r.deps.focoDoTeclado, null, 'o "Praticar" recusado prometeu o foco a um card de treino que não vem');
  // Já DENTRO do treino (a Ajuda aberta de dentro dele): o `entrar` não troca
  // o card, e o fechamento devolve o foco a quem abriu — como no "Quero treinar
  // antes" (R9-7-03). Sem isso ele ficava no botão escondido.
  const j = montarTela();
  j.deps.showCurrentPlace();
  j.app.Treino.entrar();
  assert.equal(j.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino não abriu');
  const cardDeTreino = j.estado.card;
  j.els.helpBtn.focus();
  j.app.openModal('helpModal');
  j.els.abrirTreino.focus();
  await j.clicar('abrirTreino', { teclado: true });
  assert.equal(j.estado.card, cardDeTreino, 'PRÉ-CONDIÇÃO: o card de treino foi trocado — o caso é outro');
  assert.equal(j.d.activeElement, j.els.helpBtn,
    `já no treino, o "Praticar" pelo teclado largou o foco em "${j.focado()}" — o botão escondido`);
});
