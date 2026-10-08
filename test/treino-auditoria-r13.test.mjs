// A rodada 13 da auditoria do Histórico, das conquistas, da Ajuda e do treino
// (2026-10-07). Cada achado foi MEDIDO no navegador pelo auditor, com o
// controle ao lado:
//   R13-7-01 — os avisos de UMA vez (a consequência do 1º ✕ e do 1º ✓, o
//              desbloqueio do Desfazer, a dica "você nunca desfaz") saíam no
//              banner do topo (z-55) POR BAIXO de um modal (z-60) ou da foto
//              ampliada (z-65), ou com a página escondida — e ficavam marcados
//              como vistos: a pessoa nunca os via;
//   R13-7-02 — sem o perfil, o ponto do botão de Filtros acendia por um
//              "Curador" (ou "Corretor") que a vitrine ESCONDE (portão de L6): o
//              toque levava ao Histórico "1 de 14", sem alvo, e a dava por vista;
//              e o Histórico à vista sem perfil, redesenhado pelo aviso de OUTRA
//              aba, dava por vista a conquista que a outra ganhou;
//   R13-7-03 — no iPhone fora do Safari (Chrome, Firefox, Edge), o convite de
//              instalar mandava tocar "na barra do Safari" — e antes do iOS 16.4
//              esses navegadores nem adicionam à Tela de Início.
//
// Os testes RODAM o código de verdade, fatiado do app.js, num escopo só: o que o
// teste não fornece é um "buraco negro" que aceita qualquer chamada. Cada um tem
// o CONTROLE (o desfecho de sempre, que valida o instrumento) e foi visto
// REPROVANDO com o conserto desfeito (as sabotagens estão no relatório do lote 17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
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
// escrevem (`avisosAdiados`, `novasDestaAbertura`…) moram em `deps`.
function rodar(deps, codigo, devolve) {
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : typeof k === 'string' ? buracoNegro() : undefined),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const nomes = devolve.filter((n) => existe(n) || !/^[a-zA-Z]\w*$/.test(n));
  return new Function('__escopo', `with (__escopo) {\n${codigo.join('\n')}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
}
// O pedido adiado é decidido numa microtarefa (`pedirAvisosAdiados`).
const microtarefas = () => new Promise((ok) => setImmediate(ok));
function classes(...iniciais) {
  const s = new Set(iniciais);
  return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
    toggle: (c, f) => { const ter = f === undefined ? !s.has(c) : !!f; if (ter) s.add(c); else s.delete(c); return ter; } };
}

// ═══ R13-7-01 · os avisos de UMA vez só saem onde a pessoa os vê ════════════
// O pouso de verdade (`handleActionResult`, ramo do sucesso), o aviso de
// consequência, a confirmação (`registrarAcaoConfirmada`), a cota do Desfazer,
// a dica por comportamento (`registrarJanelaSemUndo` → `checkDicaDesfazer`) e o
// fechamento de uma camada (`aoFecharCamada`), com a régua da tela de verdade
// (`semCamadaAberta`). L6 (cota 10); cada pouso conta no Histórico ANTES de
// confirmar, como o `recordHistory` do app.
const FUNCOES_DOS_AVISOS = ['handleActionResult', 'avisarConsequencia', 'registrarAcaoConfirmada', 'checkUndoGateUnlock',
  'getUndoTreatedCount', 'getUndoUnlockThreshold', 'pedidosNaJanelaDoDesfazer', 'pedidosConfirmados', 'undoGateAtingido',
  'canDisableUndo', 'checkDicaDesfazer', 'registrarJanelaSemUndo', 'semCamadaAberta', 'aoFecharCamada',
  // as do conserto (e a pendência como fonte única, do lote 18: `adiarAvisoDeUmaVez`)
  'avisoDeUmaVezSaiAgora', 'adiarAvisoDeUmaVez', 'pedirAvisosAdiados', 'atenderAvisosAdiados', 'avisosAdiadosAoVoltar'];
function montarAvisos({ camada = null, visivel = true, treino = false, confirmados = 9, prefs = {} } = {}) {
  const toasts = [], confetes = [];
  const hist = { _total: { read: confirmados, rejected: 0 } };
  // A TELA: o modal de cima, a foto e o mapa ampliados, e a página à vista.
  const tela = { modal: camada === 'filtros' ? { id: 'filtersModal' } : camada === 'ajuda' ? { id: 'helpModal' } : null,
    foto: camada === 'foto', mapa: camada === 'mapa' };
  const doc = { visibilityState: visivel ? 'visible' : 'hidden', getElementById: () => null };
  const AppState = { authenticated: true, pendingAction: null, stats: { read: confirmados, rejected: 0, skipped: 0 },
    preferences: { undoEnabled: true, undoGateSeen: false, dicaDesfazerVista: false, consequenciaVista: {},
      comoFuncionaVisto: true, semUndoSeguidas: 0, ...prefs },
    devMode: { active: false } };
  const deps = {
    AppState, Treino: { ativo: treino }, document: doc,
    topOpenModal: () => tela.modal, Lightbox: { isOpen: () => tela.foto }, MapaLightbox: { isOpen: () => tela.mapa },
    perfilDoPortao: () => ({ rank: 5, isStaff: false }),
    loadHistory: () => hist,
    recordHistory: (tipo) => { hist._total[tipo === 'read' ? 'read' : 'rejected']++; },
    savePreferences: () => {},
    showToast: (m, tipo) => { toasts.push([m, tipo]); return { dispensar() {}, texto() {} }; },
    dispararConfeteNaFila: () => confetes.push('confete'),
    t: (k) => k,
    anotadoAntesDoEnvio: new Set(), descargaNaFila: new Set(),
    DICA_SEM_UNDO: 20,
    // O estado de MÓDULO (os `let` do app).
    epocaDaSessao: 0, avisosAdiados: null, avisosAdiadosPedido: false, comoFuncionaEsperaGesto: false,
    pedirComoFuncionaAdiado: () => {},
  };
  const app = rodar(deps, [declaracao('UNDO_GATE_BASE'), declaracao('CONSEQUENCIA_AVISADA'), ...fontes(FUNCOES_DOS_AVISOS)],
    ['handleActionResult', 'registrarJanelaSemUndo', 'aoFecharCamada', 'avisosAdiadosAoVoltar']);
  let n = 0;
  // A decisão: o placar anda no GESTO, e a resposta do Waze pousa.
  const decidir = (tipo) => {
    n++;
    AppState.stats[tipo === 'read' ? 'read' : 'rejected']++;
    app.handleActionResult(tipo, { venueID: 'v' + n, updateRequestID: 'u' + n }, { success: true }, 'row', 0, null);
  };
  // A camada FECHA, pelo caminho do app (o ✕, o Esc, o fundo): o `closeModal`, o
  // `Lightbox.close` e o `MapaLightbox.close` terminam no `aoFecharCamada`.
  const fecharCamada = async (viaHistorico = false) => {
    tela.modal = null; tela.foto = false; tela.mapa = false;
    app.aoFecharCamada(viaHistorico);
    await microtarefas();
  };
  // A página volta à vista: o ouvinte do `visibilitychange`.
  const voltar = async () => {
    doc.visibilityState = 'visible';
    app.avisosAdiadosAoVoltar?.();
    await microtarefas();
  };
  const avisos = (chave) => toasts.filter(([m]) => m === chave);
  return { app, AppState, deps, tela, doc, decidir, fecharCamada, voltar, avisos, toasts, confetes, prefs: AppState.preferences };
}

test('R13-7-01: a consequência do 1º ✕ confirmada com uma camada ABERTA não sai nem é gasta — sai quando ela fecha', async () => {
  // CONTROLE: sem camada, a 1ª rejeição confirmada avisa e marca na hora.
  const c = montarAvisos({ prefs: { undoGateSeen: true } });
  c.decidir('reject');
  assert.deepEqual(c.avisos('consequencia.reject'), [['consequencia.reject', 'hint']],
    'CONTROLE: a 1ª rejeição confirmada sem camada não avisou — o teste perdeu o sentido');
  assert.equal(c.prefs.consequenciaVista.reject, true);
  for (const camada of ['filtros', 'ajuda', 'foto', 'mapa']) {
    for (const tipo of ['reject', 'read']) {
      const m = montarAvisos({ camada, prefs: { undoGateSeen: true } });
      m.decidir(tipo);   // a decisão da janela do Desfazer, pousando com a camada na tela
      assert.deepEqual(m.avisos('consequencia.' + tipo), [],
        `DEFEITO: "${tipo}" confirmado com ${camada} aberto mostrou o aviso de 1ª vez POR BAIXO da camada (banner z-55)`);
      assert.notEqual(m.prefs.consequenciaVista[tipo], true,
        `DEFEITO: o aviso de 1ª vez de "${tipo}" ficou GASTO debaixo de ${camada} — nunca mais aparece`);
      await m.fecharCamada();
      assert.deepEqual(m.avisos('consequencia.' + tipo), [['consequencia.' + tipo, 'hint']],
        `o aviso de "${tipo}" que ${camada} segurou não saiu quando a camada fechou`);
      assert.equal(m.prefs.consequenciaVista[tipo], true);
      // Uma vez só: outro fechamento não repete.
      await m.fecharCamada();
      assert.equal(m.avisos('consequencia.' + tipo).length, 1, 'o aviso saiu duas vezes');
    }
  }
});

test('R13-7-01: o fechamento pelo VOLTAR do aparelho também mostra o aviso que esperava (é banner, sem entrada no voltar)', async () => {
  const m = montarAvisos({ camada: 'filtros', prefs: { undoGateSeen: true } });
  m.decidir('reject');
  assert.deepEqual(m.avisos('consequencia.reject'), [], 'PRÉ-CONDIÇÃO: o aviso saiu por baixo dos Filtros');
  await m.fecharCamada(true);
  assert.deepEqual(m.avisos('consequencia.reject'), [['consequencia.reject', 'hint']],
    'o aviso que esperava os Filtros fecharem não saiu quando eles fecharam pelo voltar do aparelho');
});

test('R13-7-01: o desbloqueio do Desfazer (banner e confete) com a página ESCONDIDA espera a VOLTA — e com uma camada, o fechamento', async () => {
  // CONTROLE: à vista e sem camada, o 10º confirmado (L6, cota 10) comemora uma vez.
  const c = montarAvisos();
  c.decidir('read');
  assert.deepEqual(c.avisos('toast.undoUnlocked'), [['toast.undoUnlocked', 'achievement']],
    'CONTROLE: o 10º confirmado à vista não anunciou o desbloqueio — o teste perdeu o sentido');
  assert.deepEqual(c.confetes, ['confete']);
  assert.equal(c.prefs.undoGateSeen, true);
  // A fila de saída esvaziando com o app em segundo plano.
  const m = montarAvisos({ visivel: false, prefs: { consequenciaVista: { read: true, reject: true } } });
  m.decidir('read');
  assert.deepEqual(m.avisos('toast.undoUnlocked'), [],
    'DEFEITO: o desbloqueio saiu com a página ESCONDIDA — some antes de a pessoa voltar');
  assert.deepEqual(m.confetes, [], 'DEFEITO: o confete caiu com a página escondida');
  assert.equal(m.prefs.undoGateSeen, false,
    'DEFEITO: o aviso de UMA VEZ NA VIDA ficou gasto com a página escondida — o desbloqueio nunca é anunciado');
  await m.voltar();
  assert.deepEqual(m.avisos('toast.undoUnlocked'), [['toast.undoUnlocked', 'achievement']],
    'a volta à página não mostrou o desbloqueio que esperava por ela');
  assert.deepEqual(m.confetes, ['confete']);
  assert.equal(m.prefs.undoGateSeen, true);
  // E com a foto ampliada aberta: o fechamento dela.
  const f = montarAvisos({ camada: 'foto', prefs: { consequenciaVista: { read: true, reject: true } } });
  f.decidir('read');
  assert.equal(f.prefs.undoGateSeen, false, 'DEFEITO: o desbloqueio ficou gasto debaixo da foto ampliada');
  await f.fecharCamada();
  assert.deepEqual(f.avisos('toast.undoUnlocked'), [['toast.undoUnlocked', 'achievement']]);
  assert.equal(f.prefs.undoGateSeen, true);
});

test('R13-7-01: a dica "você nunca desfaz" (a janela que vence sozinha com os Filtros abertos) espera eles fecharem', async () => {
  // L6 bem acima da cota, com 19 janelas sem desfazer: a 20ª, vencendo sozinha, oferece desligar.
  const base = { undoGateSeen: true, semUndoSeguidas: 19, consequenciaVista: { read: true, reject: true } };
  const c = montarAvisos({ confirmados: 50, prefs: base });
  c.app.registrarJanelaSemUndo();
  assert.deepEqual(c.avisos('toast.undoHint'), [['toast.undoHint', 'hint']],
    'CONTROLE: a 20ª janela sem desfazer, sem camada, não ofereceu a dica — o teste perdeu o sentido');
  assert.equal(c.prefs.dicaDesfazerVista, true);
  const m = montarAvisos({ confirmados: 50, camada: 'filtros', prefs: base });
  m.app.registrarJanelaSemUndo();
  assert.deepEqual(m.avisos('toast.undoHint'), [], 'DEFEITO: a dica saiu por baixo dos Filtros');
  assert.notEqual(m.prefs.dicaDesfazerVista, true, 'DEFEITO: a dica ficou gasta debaixo dos Filtros');
  await m.fecharCamada();
  assert.deepEqual(m.avisos('toast.undoHint'), [['toast.undoHint', 'hint']], 'a dica não saiu quando os Filtros fecharam');
  assert.equal(m.prefs.dicaDesfazerVista, true);
  // E o que mudou enquanto ela esperava vale: com um Desfazer no meio (a sequência
  // zerou), a dica que esperava não sai mais — ela diria "você nunca desfaz".
  const d = montarAvisos({ confirmados: 50, camada: 'filtros', prefs: base });
  d.app.registrarJanelaSemUndo();
  d.prefs.semUndoSeguidas = 0;   // o `zerarJanelasSemUndo` do Desfazer
  await d.fecharCamada();
  assert.deepEqual(d.avisos('toast.undoHint'), [], 'a dica pendente saiu depois de a pessoa desfazer — ela mentiria');
});

test('R13-7-01: a pendência espera enquanto a tela não está LIVRE — outra camada aberta no fechamento, ou o TREINO', async () => {
  // Fechou os Filtros e, no MESMO tique, outra camada abriu (a Ajuda): segue esperando.
  const m = montarAvisos({ camada: 'filtros', prefs: { undoGateSeen: true } });
  m.decidir('reject');
  m.tela.modal = null;
  m.app.aoFecharCamada(false);
  m.tela.modal = { id: 'helpModal' };   // aberta antes de a microtarefa rodar
  await microtarefas();
  assert.deepEqual(m.avisos('consequencia.reject'), [], 'o aviso saiu por baixo da camada que abriu no mesmo tique');
  assert.notEqual(m.prefs.consequenciaVista.reject, true);
  await m.fecharCamada();
  assert.deepEqual(m.avisos('consequencia.reject'), [['consequencia.reject', 'hint']], 'o aviso se perdeu no caminho');
  // O "Praticar" fecha a Ajuda e abre o TREINO no mesmo tique: os avisos falam da
  // fila real e esperam (a régua do R8-7-01) — e saem no próximo fechamento fora dele.
  const t = montarAvisos({ camada: 'ajuda', prefs: { undoGateSeen: true } });
  t.decidir('read');
  t.tela.modal = null;
  t.app.aoFecharCamada(false);
  t.deps.Treino.ativo = true;
  await microtarefas();
  assert.deepEqual(t.avisos('consequencia.read'), [], 'o aviso da fila real saiu por cima do card de TREINO');
  assert.notEqual(t.prefs.consequenciaVista.read, true, 'o aviso ficou gasto no treino');
  t.deps.Treino.ativo = false;   // o "Ir para a fila" do fim do treino
  await t.fecharCamada();
  assert.deepEqual(t.avisos('consequencia.read'), [['consequencia.read', 'hint']], 'o aviso que o treino segurou se perdeu');
});

test('R13-7-01: a pendência é da SESSÃO — o "Sair" ou a queda (a época troca) a descartam, sem marcar nada', async () => {
  const m = montarAvisos({ camada: 'filtros', prefs: { undoGateSeen: true } });
  m.decidir('reject');
  assert.notEqual(m.prefs.consequenciaVista.reject, true, 'PRÉ-CONDIÇÃO: o aviso foi gasto debaixo dos Filtros');
  m.deps.epocaDaSessao++;   // `handleLogout` / `derrubarSessao`
  await m.fecharCamada();
  assert.deepEqual(m.avisos('consequencia.reject'), [],
    'o aviso de uma decisão da sessão que ACABOU saiu na seguinte ("rejeição enviada em seu nome")');
  // Sem nada marcado, a próxima confirmação da sessão nova é que avisa.
  m.decidir('reject');
  assert.deepEqual(m.avisos('consequencia.reject'), [['consequencia.reject', 'hint']]);
  // E deslogado (a tela de entrada), nada sai.
  const d = montarAvisos({ camada: 'filtros', prefs: { undoGateSeen: true } });
  d.decidir('reject');
  d.AppState.authenticated = false;
  await d.fecharCamada();
  assert.deepEqual(d.avisos('consequencia.reject'), [], 'o aviso saiu na tela de entrada');
});

test('R13-7-01: a troca de conta descarta a pendência — o aviso dizia o que a ANTERIOR fez', () => {
  const corpo = fatiar('esquecerOutraConta');
  // Fora de qualquer `if`: vale na troca do aparelho e na da memória (`soMemoria`).
  assert.match(corpo, /^    avisosAdiados = null;$/m,
    'a troca de conta não descarta o aviso de UMA vez pendente: "rejeição enviada em seu nome" sairia pra quem entrou');
});

test('R13-7-01: quem pede de novo — o fechamento de TODA camada e a volta à página', () => {
  // O fechamento da camada pede SEMPRE, e não só com o "Como funciona" por ver.
  const f = fatiar('aoFecharCamada');
  assert.match(f, /\n    pedirAvisosAdiados\(\);\n\}$/, 'o fechamento da camada não pede os avisos adiados (ou só pede com o "Como funciona" por ver)');
  // Os três fechamentos terminam no `aoFecharCamada` (cobrado em test/como-funciona).
  // A volta à página.
  assert.match(fatiar('setupAppListeners'), /^\s+document\.addEventListener\('visibilitychange', avisosAdiadosAoVoltar\);$/m,
    'ninguém chama a `avisosAdiadosAoVoltar` na volta à página');
  // E os três avisos passam pela MESMA régua, antes de marcar.
  for (const [nome, qual, marca] of [['avisarConsequencia', "'consequencia', actionType", 'vistas\\[actionType\\] = true'],
    ['checkUndoGateUnlock', "'desbloqueio'", 'AppState\\.preferences\\.undoGateSeen = true'],
    ['checkDicaDesfazer', "'dica'", 'AppState\\.preferences\\.dicaDesfazerVista = true']]) {
    const corpo = fatiar(nome);
    const guarda = corpo.search(new RegExp('if \\(!avisoDeUmaVezSaiAgora\\(' + qual + '\\)\\) return;'));
    const marcou = corpo.search(new RegExp(marca));
    assert.ok(guarda > 0, `${nome} não passa pela régua da tela (avisoDeUmaVezSaiAgora)`);
    assert.ok(marcou > guarda, `${nome} marca o aviso como visto ANTES de saber se a tela o mostra`);
  }
});

// ═══ R13-7-02 · o ponto e a marca de vista contam só o que a vitrine MOSTRA ════
const CONQ = 'waze_places_conquistas';
// O que a pessoa VIU: as células com a etiqueta "nova".
const aneis = (html) => [...html.matchAll(/class="conq-cel [^"]*\bnova\b[^"]*"\s+data-conq="(\w+)"/g)].map((m) => m[1]);
const celula = (html, id) => (new RegExp(`class="(conq-cel [^"]*)"\\s+data-conq="${id}"`).exec(html) || [])[1] || null;
const vitrine = (html) => (/<span class="tnum">([^<]*)<\/span>/.exec(html) || [])[1];

// O APARELHO: o localStorage é um só pras abas, e o navegador avisa as OUTRAS
// (o evento `storage`) — aqui o aviso é entregue à mão, na ordem em que viria.
function aparelho(conquistas) {
  const dados = new Map([[CONQ, JSON.stringify(conquistas)]]);
  const abas = [], avisos = [];
  return {
    abas,
    para(aba) {
      return {
        getItem: (k) => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); for (const o of abas) if (o !== aba) avisos.push([o, k]); },
        removeItem: (k) => { dados.delete(k); for (const o of abas) if (o !== aba) avisos.push([o, k]); },
      };
    },
    entregar() { while (avisos.length) { const [aba, key] = avisos.shift(); aba.h.aoGravarEmOutraAba({ key }); } },
    ler: (k = CONQ) => JSON.parse(dados.get(k)),
  };
}
// Um L6 que aprovou 10 fotos: o "Curador" ganho e AINDA NÃO VISTO.
const CURADOR_NOVO = () => ({ c: { primeiraFaxina: '2026-10-01', curador: '2026-10-06' }, seq: 0, n: { fotos: 10 },
  langs: ['pt'], base: true, novas: ['curador'], patente: 1 });

const FUNCOES_DAS_CONQUISTAS = ['copiaEmDia', 'lembrarTextoDaCopia', 'carregarConquistas', 'salvarConquistas', 'patenteDe',
  'avaliarConquistas', 'conquistasComPortaoAqui', 'conquistasVisiveis', 'checarConquistas', 'temConquistaNova',
  'novasNaVitrine', 'atualizarSeloDeConquista', 'marcarConquistasVistas', 'historicoNaTela', 'agendarRedesenhoDoHistorico',
  'verConquistasNaTela', 'verConquistasAoVoltar', 'htmlConquistas', 'htmlPatente', 'aoGravarEmOutraAba',
  'podeAgirComoL6Aqui', 'definirPerfil', 'abrirConquistaNova', 'abrirModalNaAba', 'switchFilterTab'];
function lista(nome) {
  const m = new RegExp('^const ' + nome + ' = \\[', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  return APP_SEM.slice(m.index, fechar(APP_SEM, m.index, '[', ']')) + ';';
}
const L6 = { id: 12444348, userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false };

// Uma ABA do app: a vitrine, o painel, o ponto e o toque no botão de Filtros de
// verdade; o perfil (`AppState.profile`) é o que o portão lê. `naTela`: o modal
// aberto na aba Histórico. `visivel`: a página à vista.
function abrirAba(comp, { perfil = null, naTela = false, visivel = true } = {}) {
  const aba = { desenhos: [], abriu: [] };
  const els = {
    filtersModal: { classList: classes(...(naTela ? [] : ['hidden'])) },
    filtersPanelHistory: { classList: classes(...(naTela ? [] : ['hidden'])) },
    conqSelo: { classList: classes('hidden') },
    filtersBtn: { aria: null, setAttribute(k, v) { if (k === 'aria-label') this.aria = v; } },
  };
  // As abas e os botões do rodapé do modal (o `switchFilterTab` os troca): genéricos.
  const generico = () => ({ classList: classes(), setAttribute() {}, tabIndex: 0 });
  const doc = { visibilityState: visivel ? 'visible' : 'hidden', getElementById: (id) => els[id] || (els[id] = generico()),
    querySelectorAll: () => [] };
  const AppState = { authenticated: true, profile: perfil, conquistas: null, history: null, autores: null };
  const deps = {
    AppState, document: doc, localStorage: comp.para(aba), textoDaCopia: new WeakMap(),
    CONQUISTAS_KEY: CONQ, HISTORY_KEY: 'waze_places_history', AUTORES_KEY: 'waze_places_autores',
    DEVMODE_KEY: 'waze_places_devmode',
    redesenhoDoHistoricoAgendado: false, novasDestaAbertura: null, escadaAberta: false, conquistaTocada: null,
    tokenTiradoPorOutraAba: null,
    t: (k, v) => (v && v.a != null ? `${v.a} de ${v.b}` : k), escapeHtml: (s) => String(s),
    loadHistory: () => ({ _total: { read: 100, rejected: 100 } }),
    getHistoryStats: () => ({ total: { read: 100, rejected: 100 }, today: { read: 0, rejected: 0 } }),
    geografiaDoHistorico: () => ({ paises: new Set(), estados: new Set() }),
    maiorSequenciaDeDias: () => 0, historyTodayKey: () => '2026-10-07',
    // O que a pessoa vê quando o painel é desenhado.
    renderHistory: () => { const h = aba.h.htmlConquistas(); aba.desenhos.push({ aneis: aneis(h), curador: celula(h, 'curador'), vitrine: vitrine(h) }); },
    // O perfil chega pela porta única (`definirPerfil`): o resto dela é de outros testes.
    contaSegueNoAparelho: () => true,
    // O toque no ponto: o modal abre na aba pedida (o `openFiltersModal` desenha o painel).
    openFiltersModal: () => { els.filtersModal.classList.remove('hidden'); aba.abriu.push('filtros'); return Promise.resolve(); },
    FILTER_TABS: [{ tab: 'filtersTabFilters', panel: 'filtersPanelFilters' }, { tab: 'filtersTabPrefs', panel: 'filtersPanelPrefs' },
      { tab: 'filtersTabHistory', panel: 'filtersPanelHistory' }],
  };
  aba.h = rodar(deps, [lista('PATENTES'), lista('CONQUISTAS'), ...fontes(FUNCOES_DAS_CONQUISTAS)],
    ['temConquistaNova', 'atualizarSeloDeConquista', 'marcarConquistasVistas', 'checarConquistas', 'aoGravarEmOutraAba',
      'definirPerfil', 'abrirConquistaNova', 'agendarRedesenhoDoHistorico', 'htmlConquistas']);
  Object.assign(aba, { els, doc, AppState, deps, ponto: () => !els.conqSelo.classList.contains('hidden') });
  comp.abas.push(aba);
  return aba;
}
// O toque no botão de Filtros (o ouvinte do `setupAppListeners`): com o ponto
// aceso, ele leva ao Histórico; sem, abre os Filtros.
const tocarFiltros = (aba) => (aba.h.temConquistaNova() ? aba.h.abrirConquistaNova() : aba.deps.openFiltersModal());

test('R13-7-02: sem o PERFIL, o "Curador" ganho e não visto NÃO acende o ponto — e o toque não o dá por visto sem mostrá-lo', async () => {
  // CONTROLE: com o perfil (L6), o ponto acende e o toque leva até ele — "nova".
  const c = abrirAba(aparelho(CURADOR_NOVO()), { perfil: L6 });
  c.h.atualizarSeloDeConquista();
  assert.equal(c.ponto(), true, 'CONTROLE: com o perfil, o "Curador" novo não acendeu o ponto — o teste perdeu o sentido');
  await tocarFiltros(c);
  assert.equal(c.desenhos.at(-1)?.curador, 'conq-cel on nova', 'CONTROLE: o toque não levou ao "Curador" novo');
  // Sem o perfil (o `/Session` ainda vindo): a vitrine o ESCONDE ("1 de 14").
  const comp = aparelho(CURADOR_NOVO());
  const a = abrirAba(comp);
  a.h.atualizarSeloDeConquista();
  assert.equal(a.ponto(), false,
    'DEFEITO: o ponto acendeu por uma conquista que a vitrine esconde — o toque leva a "1 de 14", sem alvo');
  assert.equal(a.h.temConquistaNova(), false, 'DEFEITO: o toque em Filtros seria desviado pro Histórico sem nada pra mostrar');
  // Entrar no Histórico assim mesmo (pela aba): o "Curador" não aparece, e NÃO é dado por visto.
  await a.h.abrirConquistaNova();
  assert.equal(a.desenhos.at(-1)?.vitrine, '1 de 14', 'PRÉ-CONDIÇÃO: sem o perfil, a vitrine não escondia as de L6');
  assert.equal(a.desenhos.at(-1)?.curador, null);
  assert.deepEqual(comp.ler().novas, ['curador'],
    'DEFEITO: o "Curador" foi dado por VISTO sem nunca aparecer — quando o perfil chega, ele não é mais "novo"');
});

test('R13-7-02: o perfil que CHEGA acende o ponto (`definirPerfil`) — e o toque leva ao "Curador", que aí sim fica visto', async () => {
  const comp = aparelho(CURADOR_NOVO());
  const a = abrirAba(comp);
  a.h.atualizarSeloDeConquista();
  assert.equal(a.ponto(), false, 'PRÉ-CONDIÇÃO: o ponto acendeu sem o perfil');
  assert.equal(a.h.definirPerfil({ success: true, profile: L6 }), true);
  assert.equal(a.ponto(), true, 'o perfil L6 chegou e o ponto não acendeu pelo "Curador" que agora a vitrine mostra');
  assert.equal(a.els.filtersBtn.aria, 'header.filters.aria — conq.selo.aria', 'o nome do botão não diz "conquista nova"');
  await tocarFiltros(a);
  assert.equal(a.desenhos.at(-1)?.vitrine, '2 de 16');
  assert.equal(a.desenhos.at(-1)?.curador, 'conq-cel on nova', 'o toque não levou ao "Curador" novo');
  assert.deepEqual(comp.ler().novas, [], 'o "Curador" mostrado ficou "novo" — o ponto voltaria');
  assert.equal(a.ponto(), false);
  // E o perfil de quem NÃO pode (um L5) apaga o ponto que só o "Curador" acendia.
  const comp2 = aparelho(CURADOR_NOVO());
  const b = abrirAba(comp2, { perfil: L6 });
  b.h.atualizarSeloDeConquista();
  assert.equal(b.ponto(), true, 'PRÉ-CONDIÇÃO');
  b.h.definirPerfil({ success: true, profile: { ...L6, rank: 4 } });
  assert.equal(b.ponto(), false, 'o perfil sem o portão deixou o ponto aceso por uma conquista escondida');
});

test('R13-7-02: DUAS abas — a outra, À VISTA com o Histórico aberto e SEM perfil, não dá por visto o "Curador" que esta ganhou', async () => {
  for (const [nome, perfilDeA, esperado] of [['sem perfil', null, ['curador']], ['CONTROLE com perfil', L6, []]]) {
    const comp = aparelho({ c: { primeiraFaxina: '2026-10-01' }, seq: 0, n: { fotos: 10 }, langs: ['pt'], base: true, novas: [], patente: 1 });
    const A = abrirAba(comp, { perfil: perfilDeA, naTela: true });   // o Histórico aberto e à vista
    const B = abrirAba(comp, { perfil: L6 });                          // a pessoa aprova fotos aqui
    B.h.checarConquistas();   // o 10º "Aprovar": o "Curador"
    assert.deepEqual(comp.ler().novas, ['curador'], 'PRÉ-CONDIÇÃO: a B não ganhou o "Curador"');
    comp.entregar();          // o aviso do navegador chega à A, que redesenha o painel aberto
    await microtarefas();
    assert.ok(A.desenhos.length > 0, `PRÉ-CONDIÇÃO (${nome}): o painel da A não foi redesenhado pelo aviso`);
    assert.deepEqual(comp.ler().novas, esperado, nome === 'sem perfil'
      ? 'DEFEITO: a aba sem perfil deu por VISTO o "Curador" que ela nem mostra ("2 de 14") — o ponto da outra apagou'
      : 'CONTROLE: a aba com o perfil mostrou o "Curador" diante da pessoa e não o deu por visto');
    if (nome === 'sem perfil') {
      assert.equal(A.desenhos.at(-1).curador, null, 'PRÉ-CONDIÇÃO: a aba sem perfil mostrou o "Curador"');
      comp.entregar();
      assert.equal(B.h.temConquistaNova(), true, 'o ponto da B apagou sem ninguém ver o "Curador"');
    } else {
      assert.equal(A.desenhos.at(-1).curador, 'conq-cel on nova');
    }
  }
});

test('R13-7-02: a patente e as conquistas sem portão seguem como sempre sem o perfil (o conserto só tira as ESCONDIDAS)', () => {
  const comp = aparelho({ ...CURADOR_NOVO(), novas: ['curador', 'coruja'], patenteNova: true });
  const a = abrirAba(comp);
  a.h.atualizarSeloDeConquista();
  assert.equal(a.ponto(), true, 'a "Coruja" e a patente novas não acenderam o ponto sem o perfil');
  a.h.htmlConquistas();   // o desenho que o `switchFilterTab` faz antes de marcar
  a.h.marcarConquistasVistas();
  const g = comp.ler();
  assert.deepEqual(g.novas, ['curador'], 'a marca levou a escondida junto, ou deixou a "Coruja" que a vitrine mostrou');
  assert.equal(g.patenteNova, false, 'a patente (sempre na tela) não ficou vista');
});

// ═══ R13-7-03 · o convite de instalar no iPhone FORA do Safari ════════════════
const UA = (navegador, versao = '18_0', aparelhoUa = 'iPhone; CPU iPhone OS') => {
  const base = `Mozilla/5.0 (${aparelhoUa} ${versao} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) `;
  return base + ({ safari: 'Version/18.0 Mobile/15E148 Safari/604.1', chrome: 'CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
    firefox: 'FxiOS/132.0 Mobile/15E148 Safari/605.1.15', edge: 'EdgiOS/130.0.2849.80 Version/18.0 Mobile/15E148 Safari/604.1' })[navegador];
};
// O iPad que se anuncia como Mac (o padrão do iPadOS), com toque.
const UA_IPAD_MAC = (marca) => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) ' + marca;

function montarConvite({ userAgent, toques = 5, prompt = false }) {
  const el = (attrs = {}) => ({ classList: classes('hidden'), attrs, innerHTML: '',
    getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); } });
  const els = { installInvite: el(), installInviteBtn: el(), installIosSteps: el(),
    installIosStep1: el({ 'data-i18n-html': 'install.ios.step1' }) };
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
  const h = rodar(deps, fontes(['appJaInstalada', 'ehIOS', 'navegadorDoIOSForaDoSafari', 'versaoDoIOS',
    'iOSAdicionaATelaDeInicioAqui', 'convitePodeAparecer', 'atualizarConviteInstalar']), ['atualizarConviteInstalar']);
  h.atualizarConviteInstalar();
  const visivel = (id) => !els[id].classList.contains('hidden');
  return { convite: visivel('installInvite'), passos: visivel('installInvite') && visivel('installIosSteps'),
    botao: visivel('installInvite') && visivel('installInviteBtn'),
    chave: els.installIosStep1.getAttribute('data-i18n-html'), texto: els.installIosStep1.innerHTML };
}

test('R13-7-03: no Chrome, no Firefox e no Edge do iPhone, o 1º passo NÃO manda à barra do Safari — e o 2º é o mesmo', () => {
  // CONTROLE: o Safari do iPhone segue com o passo do Safari.
  const c = montarConvite({ userAgent: UA('safari') });
  assert.equal(c.convite && c.passos, true, 'CONTROLE: o Safari do iPhone ficou sem os passos — o teste perdeu o sentido');
  assert.equal(c.chave, 'install.ios.step1', 'CONTROLE: o Safari perdeu o passo da barra do Safari');
  for (const nav of ['chrome', 'firefox', 'edge']) {
    const m = montarConvite({ userAgent: UA(nav) });
    assert.equal(m.convite && m.passos, true, `${nav} do iPhone (iOS 18) ficou sem o convite, e ele adiciona à Tela de Início`);
    assert.equal(m.botao, false, `${nav}: o iPhone não tem prompt de instalar — botão é beco sem saída`);
    assert.equal(m.chave, 'install.ios.step1Navegador',
      `DEFEITO: no ${nav} do iPhone o 1º passo mandava tocar "na barra do Safari", um navegador que a pessoa não está usando`);
    assert.equal(m.texto, 'T:install.ios.step1Navegador', `${nav}: a chave trocou e o texto na tela não`);
  }
});

test('R13-7-03: fora do Safari num iOS ANTERIOR ao 16.4 o convite NÃO aparece — lá esses navegadores não adicionam à Tela de Início', () => {
  for (const nav of ['chrome', 'firefox', 'edge']) {
    for (const versao of ['16_3', '15_7', '12_5_7']) {
      const m = montarConvite({ userAgent: UA(nav, versao) });
      assert.equal(m.convite, false,
        `DEFEITO: o convite apareceu no ${nav} do iOS ${versao.replace(/_/g, '.')} — beco sem saída: ali não há "Adicionar à Tela de Início"`);
    }
    // A fronteira: o 16.4 adiciona.
    assert.equal(montarConvite({ userAgent: UA(nav, '16_4') }).convite, true, `${nav} do iOS 16.4 ficou sem o convite`);
    assert.equal(montarConvite({ userAgent: UA(nav, '17_0') }).convite, true);
    // O iPad ("CPU OS"), com a mesma régua.
    assert.equal(montarConvite({ userAgent: UA(nav, '16_3', 'iPad; CPU OS') }).convite, false, `${nav} do iPadOS 16.3`);
    assert.equal(montarConvite({ userAgent: UA(nav, '16_4', 'iPad; CPU OS') }).convite, true, `${nav} do iPadOS 16.4`);
  }
  // CONTROLE: o Safari de qualquer iOS sempre adicionou — convite com o passo dele.
  for (const versao of ['15_7', '16_3', '12_5_7']) {
    const s = montarConvite({ userAgent: UA('safari', versao) });
    assert.equal(s.convite && s.chave === 'install.ios.step1', true, `o Safari do iOS ${versao} perdeu o convite`);
  }
  // Sem a versão na UA (o iPad que se anuncia como Mac): vale como recente.
  const ipad = montarConvite({ userAgent: UA_IPAD_MAC('CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1') });
  assert.equal(ipad.convite && ipad.chave === 'install.ios.step1Navegador', true, 'o Chrome do iPad (UA de Mac) perdeu o convite');
  // CONTROLE: o computador com o prompt do navegador segue com o BOTÃO, e o Mac
  // de mesa sem toque, sem convite (não é iOS).
  const pc = montarConvite({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36', toques: 0, prompt: true });
  assert.equal(pc.botao, true, 'CONTROLE: o computador com o prompt perdeu o botão');
  assert.equal(pc.passos, false);
  assert.equal(montarConvite({ userAgent: UA_IPAD_MAC('Version/18.0 Safari/605.1.15'), toques: 0 }).convite, false,
    'CONTROLE: o Mac de mesa (sem toque) ganhou o convite do iPhone');
});

test('R13-7-03: a frase nova existe nos 4 idiomas, curta, com o "Compartilhar" em negrito e SEM "Safari"', () => {
  for (const l of ['pt', 'en', 'es', 'fr']) {
    const ini = I18N.indexOf(`\n  ${l}: {`);
    assert.ok(ini >= 0, `o bloco ${l} sumiu do i18n.js`);
    const bloco = I18N.slice(ini, I18N.indexOf('\n  },', ini));
    const m = /'install\.ios\.step1Navegador': '([^']*)'/.exec(bloco);
    assert.ok(m, `${l}: falta a chave install.ios.step1Navegador`);
    const safari = /'install\.ios\.step1': '([^']*)'/.exec(bloco)[1];
    assert.ok(!/Safari/i.test(m[1]), `${l}: a frase de FORA do Safari fala do Safari`);
    assert.equal((m[1].match(/<strong>[^<]+<\/strong>/g) || []).length, 1, `${l}: o "Compartilhar" não está em negrito, uma vez`);
    // O mesmo botão do passo do Safari (a palavra da plataforma, em negrito).
    assert.equal(/<strong>([^<]+)<\/strong>/.exec(m[1])[1], /<strong>([^<]+)<\/strong>/.exec(safari)[1], `${l}: o botão mudou de nome`);
    assert.ok(m[1].replace(/<[^>]+>/g, '').length <= 60, `${l}: a frase cresceu (${m[1].length}) — ela mora numa linha do convite`);
  }
  // O passo 1 tem id: é por ele que a chave troca (e a troca de idioma relê dela).
  assert.match(HTML, /<span id="installIosStep1" data-i18n-html="install\.ios\.step1">/,
    'o 1º passo do iPhone perdeu o id (ou o data-i18n-html: com <strong>, data-i18n mostraria a tag crua)');
});
