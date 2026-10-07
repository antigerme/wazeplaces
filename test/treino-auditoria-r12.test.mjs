// A rodada 12 da auditoria do Histórico, das conquistas, da Ajuda e do treino
// (2026-10-07). Cada achado foi MEDIDO no navegador pelo auditor, com o
// controle ao lado:
//   R12-7-01 — a conquista (ou a patente) que destravava com a aba Histórico NA
//              TELA acendia "nova" diante da pessoa e seguia em `novas`: fechado
//              o modal, o ponto do botão de Filtros ficava aceso, e o toque
//              seguinte era desviado pro Histórico pra mostrar de novo o que ela
//              já tinha visto;
//   R12-7-02 — o perfil que chegava com os Filtros ABERTOS (o atalho do ícone, a
//              rede lenta) redesenhava só a aba Filtros: as Preferências seguiam
//              com o Desfazer travado ("Disponível depois de você logar…") e o
//              Histórico com a vitrine "1 de 14", sem o "Curador" já ganho e sem
//              o interruptor "Rejeitar sozinho", até fechar e abrir;
//   R12-7-03 — o "Ver de novo 'Como funciona'" aberto à mão na janela do Desfazer
//              ficava por baixo do banner (z-70): no iPhone SE e deitado, o toque
//              no "Entendi" caía no "Desfazer" e desfazia o ✕, sem nada ir ao Waze.
//
// Os testes RODAM o código de verdade, fatiado do app.js, num escopo só: o que o
// teste não fornece é um "buraco negro" que aceita qualquer chamada. Cada um tem
// o CONTROLE (o desfecho de sempre, que valida o instrumento) e foi visto
// REPROVANDO com o conserto desfeito (as sabotagens estão no relatório do lote 16).
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
// As funções NOVAS deste lote só são fatiadas se existirem: no código de antes do
// conserto o teste reprova pelo COMPORTAMENTO (o que não existe vira buraco
// negro e não faz nada), não por não achá-las.
const existe = (nome) => new RegExp('^(async )?function ' + nome + '\\(', 'm').test(APP_SEM);
const fontes = (nomes) => nomes.filter(existe).map(fatiar);
// Uma LISTA do app (`const X = [ … ];`), inteira — as conquistas e as patentes.
function lista(nome) {
  const m = new RegExp('^const ' + nome + ' = \\[', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  const txt = APP_SEM.slice(m.index, fechar(APP_SEM, m.index, '[', ']')) + ';';
  assert.ok(txt.length > 100, `lista('${nome}') devolveu ${txt.length} chars — o instrumento quebrou`);
  return txt;
}

function buracoNegro() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro()),
    apply: () => buracoNegro(), set: () => true,
  });
}
// As funções de verdade num escopo só, com `deps` por fora: o que não está nem
// nelas nem no `globalThis` vira buraco negro. As variáveis de MÓDULO que elas
// escrevem (`novasDestaAbertura`, `redesenhoDoHistoricoAgendado`…) moram em `deps`.
function rodar(deps, fontes, devolve) {
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : typeof k === 'string' ? buracoNegro() : undefined),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('__escopo', `with (__escopo) {\n${fontes.join('\n')}\nreturn { ${devolve.join(', ')} };\n}`)(escopo);
}
// O redesenho do painel é agendado numa microtarefa (`agendarRedesenhoDoHistorico`).
const microtarefas = () => new Promise((ok) => setImmediate(ok));

function classes(...iniciais) {
  const s = new Set(iniciais);
  return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
    toggle: (c, f) => { const ter = f === undefined ? !s.has(c) : !!f; if (ter) s.add(c); else s.delete(c); return ter; } };
}

// ═══ R12-7-01 · a conquista que acende com o Histórico NA TELA ═══════════════
const CONQ = 'waze_places_conquistas';
// O que a pessoa VIU: as células com a etiqueta "nova", e o cartão da patente.
const aneis = (html) => [...html.matchAll(/class="conq-cel [^"]*\bnova\b[^"]*"\s+data-conq="(\w+)"/g)].map((m) => m[1]);
const patenteComAnel = (html) => /class="conq-card nova"/.test(html);

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
const CONQUISTAS_INICIAIS = (extra = {}) => ({ c: {}, seq: 0, n: {}, langs: ['pt'], base: true, novas: [], patente: 0, ...extra });

const FUNCOES_DAS_CONQUISTAS = ['copiaEmDia', 'lembrarTextoDaCopia', 'carregarConquistas', 'salvarConquistas', 'patenteDe',
  'avaliarConquistas', 'conquistasComPortaoAqui', 'conquistasVisiveis', 'checarConquistas', 'temConquistaNova',
  'atualizarSeloDeConquista', 'marcarConquistasVistas', 'historicoNaTela', 'agendarRedesenhoDoHistorico',
  'verConquistasNaTela', 'verConquistasAoVoltar', 'htmlConquistas', 'htmlPatente', 'aoGravarEmOutraAba'];

// Uma ABA do app: a vitrine, o painel e o ponto de verdade, com o Histórico de
// mentira (só o total importa às conquistas de volume) e o desenho do painel
// anotando o que a pessoa VIU, pelo HTML de verdade.
// `naTela`: o modal aberto na aba Histórico. `visivel`: a página à vista.
function abrirAba(comp, { naTela = true, visivel = true, tratados = 9 } = {}) {
  const aba = { desenhos: [] };
  const els = {
    filtersModal: { classList: classes(...(naTela ? [] : ['hidden'])) },
    filtersPanelHistory: { classList: classes() },
    conqSelo: { classList: classes('hidden') },
    filtersBtn: { aria: null, setAttribute(k, v) { if (k === 'aria-label') this.aria = v; } },
  };
  const doc = { visibilityState: visivel ? 'visible' : 'hidden', getElementById: (id) => els[id] || null };
  const historico = { total: tratados };
  const AppState = { authenticated: true, conquistas: null, history: null, autores: null };
  const deps = {
    AppState, document: doc, localStorage: comp.para(aba), textoDaCopia: new WeakMap(),
    CONQUISTAS_KEY: CONQ, HISTORY_KEY: 'waze_places_history', AUTORES_KEY: 'waze_places_autores',
    DEVMODE_KEY: 'waze_places_devmode',
    // O estado de MÓDULO desta aba (os `let` do app).
    redesenhoDoHistoricoAgendado: false, novasDestaAbertura: null, escadaAberta: false, conquistaTocada: null,
    tokenTiradoPorOutraAba: null,
    t: (k) => k, escapeHtml: (s) => String(s),
    loadHistory: () => ({ _total: { read: historico.total, rejected: 0 } }),
    getHistoryStats: () => ({ total: { read: historico.total, rejected: 0 }, today: { read: 0, rejected: 0 } }),
    geografiaDoHistorico: () => ({ paises: new Set(), estados: new Set() }),
    maiorSequenciaDeDias: () => 0, historyTodayKey: () => '2026-10-07',
    podeAgirComoL6Aqui: () => false,
    renderHistory: () => { aba.desenhos.push({ aneis: aneis(aba.h.htmlConquistas()), patente: patenteComAnel(aba.h.htmlPatente()) }); },
  };
  aba.h = rodar(deps, [lista('PATENTES'), lista('CONQUISTAS'), ...fontes(FUNCOES_DAS_CONQUISTAS)], FUNCOES_DAS_CONQUISTAS);
  Object.assign(aba, { els, doc, historico, AppState });
  comp.abas.push(aba);
  return aba;
}
// O POUSO de uma decisão, na ordem de verdade: o `recordHistory` grava e agenda o
// redesenho do painel; a confirmação (`registrarAcaoConfirmada`) avalia as conquistas.
function pousar(aba, n = 1) {
  aba.historico.total += n;
  aba.h.agendarRedesenhoDoHistorico();
  aba.h.checarConquistas();
}

test('R12-7-01: a conquista que destrava com o Histórico NA TELA fica VISTA — o ponto apaga, e o toque seguinte em Filtros não desvia', async () => {
  const comp = aparelho(CONQUISTAS_INICIAIS());
  const a = abrirAba(comp, { tratados: 9 });
  pousar(a);   // o 10º: a "Primeira faxina"
  await microtarefas();
  assert.equal(a.desenhos.length, 1, 'PRÉ-CONDIÇÃO: o painel na tela não foi redesenhado com o pouso');
  assert.deepEqual(a.desenhos[0].aneis, ['primeiraFaxina'], 'PRÉ-CONDIÇÃO: a célula não acendeu "nova" diante da pessoa');
  assert.deepEqual(comp.ler().novas, [],
    'DEFEITO: a conquista que acendeu diante da pessoa seguiu "nova" no aparelho — o ponto volta a cada abertura');
  assert.equal(a.h.temConquistaNova(), false,
    'DEFEITO: o toque seguinte em Filtros seria DESVIADO pro Histórico pra mostrar o que ela já viu');
  assert.ok(a.els.conqSelo.classList.contains('hidden'), 'DEFEITO: o ponto do botão de Filtros ficou aceso');
  assert.equal(a.els.filtersBtn.aria, 'header.filters.aria', 'o nome do botão seguiu dizendo "conquista nova"');
  // O anel fica NESTA abertura: o redesenho seguinte (outro pouso, um toque
  // numa célula) ainda o mostra.
  a.h.agendarRedesenhoDoHistorico();
  await microtarefas();
  assert.deepEqual(a.desenhos.at(-1).aneis, ['primeiraFaxina'], 'o anel sumiu no redesenho da mesma abertura');
});

test('R12-7-01: a PATENTE que sobe com o Histórico na tela também fica vista', async () => {
  const comp = aparelho(CONQUISTAS_INICIAIS({ c: { primeiraFaxina: '2026-10-01' } }));
  const a = abrirAba(comp, { tratados: 99 });
  pousar(a);   // o 100º: de Aprendiz a Gari, sem conquista nova
  await microtarefas();
  assert.equal(a.desenhos.length, 1, 'PRÉ-CONDIÇÃO: o painel não foi redesenhado');
  assert.equal(a.desenhos[0].patente, true, 'PRÉ-CONDIÇÃO: o cartão da patente não acendeu "nova"');
  assert.deepEqual(a.desenhos[0].aneis, [], 'PRÉ-CONDIÇÃO: acendeu uma conquista — o caso é o da patente SOZINHA');
  assert.equal(comp.ler().patenteNova, false,
    'DEFEITO: a patente que subiu diante da pessoa seguiu "nova" — o ponto volta e o toque desvia');
  assert.equal(a.h.temConquistaNova(), false);
  assert.ok(a.els.conqSelo.classList.contains('hidden'), 'o ponto ficou aceso pela patente');
  a.h.agendarRedesenhoDoHistorico();
  await microtarefas();
  assert.equal(a.desenhos.at(-1).patente, true, 'o anel da patente sumiu no redesenho da mesma abertura');
});

test('R12-7-01: CONTROLE — com o Histórico FORA da tela, a conquista segue nova: o ponto acende e o toque leva até ela', async () => {
  for (const fora of ['os Filtros fechados', 'outra aba do modal']) {
    const comp = aparelho(CONQUISTAS_INICIAIS());
    const a = abrirAba(comp, { tratados: 9 });
    if (fora === 'os Filtros fechados') a.els.filtersModal.classList.add('hidden');
    else a.els.filtersPanelHistory.classList.add('hidden');
    pousar(a);
    await microtarefas();
    assert.equal(a.desenhos.length, 0, `desenhou o Histórico fora da tela (${fora})`);
    assert.deepEqual(comp.ler().novas, ['primeiraFaxina'], `deu por vista sem ninguém ver (${fora})`);
    assert.equal(a.h.temConquistaNova(), true, `o toque em Filtros não levaria à conquista (${fora})`);
    assert.ok(!a.els.conqSelo.classList.contains('hidden'), `o ponto não acendeu (${fora})`);
  }
});

test('R12-7-01: com a página no FUNDO, a conquista espera — e a VOLTA com o Histórico aberto a dá por vista', async () => {
  const comp = aparelho(CONQUISTAS_INICIAIS());
  const a = abrirAba(comp, { tratados: 9, visivel: false });
  pousar(a);   // a decisão que pousa com o app escondido (a descarga ao sair, a fila de saída)
  await microtarefas();
  assert.deepEqual(a.desenhos.at(-1)?.aneis, ['primeiraFaxina'], 'PRÉ-CONDIÇÃO: o painel não foi redesenhado');
  assert.deepEqual(comp.ler().novas, ['primeiraFaxina'], 'deu por vista com a página escondida, sem ninguém olhando');
  // A volta: o ouvinte do `visibilitychange`.
  a.doc.visibilityState = 'visible';
  a.h.verConquistasAoVoltar();
  await microtarefas();
  assert.deepEqual(a.desenhos.at(-1).aneis, ['primeiraFaxina'], 'a volta não mostrou o anel');
  assert.deepEqual(comp.ler().novas, [],
    'DEFEITO: a pessoa voltou com o Histórico mostrando a conquista, e ela seguiu nova (o ponto e o desvio de novo)');
  assert.ok(a.els.conqSelo.classList.contains('hidden'));
  // CONTROLE: a volta sem nada novo não redesenha nada; e com os Filtros
  // fechados, a volta não dá nada por visto.
  const n = a.desenhos.length;
  a.h.verConquistasAoVoltar();
  await microtarefas();
  assert.equal(a.desenhos.length, n, 'a volta sem nada novo redesenhou o painel');
  const c = abrirAba(aparelho(CONQUISTAS_INICIAIS()), { tratados: 9, naTela: false, visivel: false });
  pousar(c);
  await microtarefas();
  c.doc.visibilityState = 'visible';
  c.h.verConquistasAoVoltar();
  await microtarefas();
  assert.equal(c.h.temConquistaNova(), true, 'a volta com os Filtros fechados deu a conquista por vista');
  assert.equal(c.desenhos.length, 0);
  // Quem chama: o ouvinte da volta à página.
  assert.match(fatiar('setupAppListeners'), /^\s+document\.addEventListener\('visibilitychange', verConquistasAoVoltar\);$/m,
    'ninguém chama a `verConquistasAoVoltar` na volta à página');
});

test('R12-7-01: DUAS abas — a de FUNDO, com o Histórico aberto, não apaga o ponto da outra; a volta a ela, sim', async () => {
  const comp = aparelho(CONQUISTAS_INICIAIS());
  const A = abrirAba(comp, { tratados: 9, visivel: false });   // o Histórico aberto, a aba no fundo
  const B = abrirAba(comp, { tratados: 9, naTela: false });    // a pessoa tria aqui
  pousar(B);   // a "Primeira faxina" acende na B
  await microtarefas();
  assert.equal(B.h.temConquistaNova(), true, 'PRÉ-CONDIÇÃO: a B não acendeu o ponto');
  comp.entregar();   // o aviso do navegador chega à A, que redesenha o painel aberto
  await microtarefas();
  assert.deepEqual(A.desenhos.at(-1)?.aneis, ['primeiraFaxina'], 'PRÉ-CONDIÇÃO: o painel da A não foi redesenhado pelo aviso');
  assert.deepEqual(comp.ler().novas, ['primeiraFaxina'],
    'DEFEITO: a aba de FUNDO deu por vista a conquista que acendeu na outra — o ponto de lá apaga sem ninguém ter olhado');
  comp.entregar();
  assert.equal(B.h.temConquistaNova(), true, 'o ponto da B apagou');
  // A pessoa vai à A: o Histórico dela mostra a conquista, e aí ela é vista — nas duas.
  A.doc.visibilityState = 'visible';
  A.h.verConquistasAoVoltar();
  await microtarefas();
  assert.deepEqual(comp.ler().novas, [], 'a volta à A, com o Histórico mostrando a conquista, não a deu por vista');
  comp.entregar();
  assert.equal(B.h.temConquistaNova(), false, 'o ponto da B não seguiu o aparelho');
  // CONTROLE: a A À VISTA (as duas janelas lado a lado) — o Histórico dela mostra
  // a conquista na tela, e ela vale como vista. É a visibilidade que decide.
  const comp2 = aparelho(CONQUISTAS_INICIAIS());
  const A2 = abrirAba(comp2, { tratados: 9 });
  const B2 = abrirAba(comp2, { tratados: 9, naTela: false });
  pousar(B2);
  await microtarefas();
  comp2.entregar();
  await microtarefas();
  assert.deepEqual(comp2.ler().novas, [], 'o instrumento não distingue a aba à vista da escondida');
  assert.deepEqual(A2.desenhos.at(-1).aneis, ['primeiraFaxina']);
});

// ═══ R12-7-02 · o perfil que chega com os Filtros ABERTOS ═══════════════════
const L6 = { id: 12444348, userName: 'antigerme', rank: 5, isAreaManager: true, isStaff: false };
// A porta única do perfil (`definirPerfil`) DE VERDADE, com o redesenho dos
// Filtros, a cota do Desfazer e o portão de L6 de verdade. O desenho do
// Histórico anota o que a vitrine e a lista de autores mostrariam.
function montarPerfil({ aba = 'prefs', modalAberto = true } = {}) {
  const els = {
    filtersModal: { classList: classes(...(modalAberto ? [] : ['hidden'])) },
    filtersPanelHistory: { classList: classes(...(aba === 'hist' ? [] : ['hidden'])) },
    prefUndoEnabled: { disabled: false, checked: false },
    prefUndoGateMsg: { classList: classes('hidden'), textContent: '' },
  };
  const desenhos = [];
  const guardado = {};   // o aparelho SEM o nível guardado: a 1ª entrada, ou depois de uma troca de conta
  const AppState = { authenticated: true, profile: null, conquistas: null, devMode: { unlocked: false, active: false },
    stats: { read: 100, rejected: 100, skipped: 0 },
    preferences: { undoEnabled: true, undoGateSeen: true, comoFuncionaVisto: true } };
  const deps = {
    AppState, document: { visibilityState: 'visible', getElementById: (id) => els[id] || null },
    safeLS: { get: (k) => (k in guardado ? guardado[k] : null), set: (k, v) => { guardado[k] = v; } },
    PERFIL_GATE_KEY: 'waze_places_perfil_gate', preferenciasCarregadas: true,
    UNDO_GATE_BASE: Number(/^const UNDO_GATE_BASE = (\d+);$/m.exec(APP_SEM)[1]),
    t: (k) => k, savePreferences: () => {},
    redesenhoDoHistoricoAgendado: false,
    contaSegueNoAparelho: () => true,
    handleLogout: () => assert.fail('o perfil da própria conta deslogou'),
    marcarConquistasVistas: () => {},   // o R12-7-01, acima
    renderHistory: () => desenhos.push({
      vitrine: h.conquistasVisiveis().length,
      curador: h.conquistasVisiveis().some((x) => x.id === 'curador'),
      interruptor: h.podeRecusarAutomaticoAqui(),
    }),
  };
  const fns = ['definirPerfil', 'redesenharFiltrosComOPerfil', 'renderUndoGateUI', 'initUndoGateSeen', 'undoGateAtingido',
    'canDisableUndo', 'getUndoTreatedCount', 'getUndoUnlockThreshold', 'perfilDoPortao', 'guardarPerfilDoPortao',
    'agendarRedesenhoDoHistorico', 'historicoNaTela', 'verConquistasNaTela', 'conquistasVisiveis',
    'conquistasComPortaoAqui', 'podeAgirComoL6Aqui', 'podeRecusarAutomaticoAqui'];
  const h = rodar(deps, [lista('CONQUISTAS'), ...fontes(fns)], fns);
  return { h, els, desenhos, deps, AppState };
}

test('R12-7-02: o perfil que chega com os Filtros ABERTOS nas Preferências destrava o Desfazer — sem fechar e abrir', () => {
  const p = montarPerfil({ aba: 'prefs' });
  p.h.renderUndoGateUI();   // o que o `openFiltersModal` desenha, ANTES do perfil
  assert.equal(p.els.prefUndoEnabled.disabled, true, 'PRÉ-CONDIÇÃO: sem o perfil, a cota do Desfazer era conhecida');
  assert.equal(p.els.prefUndoGateMsg.textContent, 'prefs.undo.gate.noProfile', 'PRÉ-CONDIÇÃO: a frase não é a do perfil que falta');
  p.h.definirPerfil({ success: true, profile: L6 });
  assert.equal(p.els.prefUndoEnabled.disabled, false,
    'DEFEITO: o Desfazer seguiu travado com o perfil já aqui (L6, 200 tratados) — só fechando e abrindo os Filtros');
  assert.ok(p.els.prefUndoGateMsg.classList.contains('hidden'),
    'DEFEITO: seguiu "🔒 Disponível depois de você logar e o app carregar seu perfil."');
  assert.equal(p.els.prefUndoEnabled.checked, true, 'o interruptor não mostra a escolha guardada');
});

test('R12-7-02: … e com o Histórico na tela, a vitrine ganha as de L6 (o "Curador" já ganho) e a lista de autores o interruptor', async () => {
  const p = montarPerfil({ aba: 'hist' });
  p.deps.renderHistory();   // o que o `openFiltersModal` desenha, ANTES do perfil
  assert.deepEqual(p.desenhos[0], { vitrine: 14, curador: false, interruptor: false },
    'PRÉ-CONDIÇÃO: sem o perfil, a vitrine já mostrava as de L6');
  p.h.definirPerfil({ success: true, profile: L6 });
  await microtarefas();
  assert.deepEqual(p.desenhos.at(-1), { vitrine: 16, curador: true, interruptor: true },
    'DEFEITO: o Histórico na tela seguiu "1 de 14", sem o "Curador" e sem o "Rejeitar sozinho", com o perfil de L6 já aqui');
});

test('R12-7-02: CONTROLE — com os Filtros FECHADOS, o perfil não redesenha nada (a abertura desenha)', async () => {
  const p = montarPerfil({ aba: 'hist', modalAberto: false });
  p.h.renderUndoGateUI();
  p.h.definirPerfil({ success: true, profile: L6 });
  await microtarefas();
  assert.equal(p.els.prefUndoEnabled.disabled, true, 'redesenhou as Preferências dos Filtros FECHADOS');
  assert.equal(p.desenhos.length, 0, 'redesenhou o Histórico dos Filtros FECHADOS');
  // A abertura (o `openFiltersModal` chama o mesmo `renderUndoGateUI`) já mostra o certo.
  p.h.renderUndoGateUI();
  assert.equal(p.els.prefUndoEnabled.disabled, false, 'o instrumento: com o perfil, a cota do Desfazer não destrava');
});

// ═══ R12-7-03 · o "Ver de novo" à mão na janela do Desfazer ═════════════════
// A janela DE VERDADE (`scheduleAction`, com o banner e o relógio), o despacho
// e o "Desfazer" do banner. O `openModal` de mentira anota o que estava na tela
// quando o diálogo abriu.
function montarJanela() {
  const banners = [];
  const abertos = [];
  const enviados = [];
  const timers = new Map();
  let proximo = 1;
  const container = {
    get children() { return banners; },
    set innerHTML(v) { if (v === '') banners.length = 0; },
    appendChild: (el) => { banners.push(el); },
    contains: () => false,
  };
  const botaoDesfazer = { addEventListener: (tipo, fn) => { botaoDesfazer.clique = fn; } };
  const AppState = { pendingAction: null, preferences: { undoEnabled: true, comoFuncionaVisto: true },
    stats: { read: 0, rejected: 1, skipped: 0 }, queue: [], serverTotal: 3, inFlightActions: 0 };
  const deps = {
    AppState,
    document: {
      getElementById: (id) => (id === 'undoContainer' ? container : id === 'undoBtn' && banners.length ? botaoDesfazer : null),
      createElement: () => ({ className: '', innerHTML: '' }), activeElement: null,
    },
    // O relógio da janela, nas mãos do teste.
    setTimeout: (fn) => { const id = proximo++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    UNDO_WINDOW_MS: 3000, t: (k) => k, escapeHtml: (s) => String(s),
    canDisableUndo: () => false, presencaFolhaAberta: () => false,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    MapaLightbox: { isOpen: () => false },
    savePreferences: () => {},
    openModal: (id) => abertos.push({ id, banner: banners.length > 0, janela: !!AppState.pendingAction }),
  };
  const fns = ['scheduleAction', 'showUndoBanner', 'removeUndoBanner', 'desfazerAcaoPendente', 'despacharJanelaDoDesfazer',
    'enviarPendenciasDoLightbox', 'abrirComoFunciona', 'verDeNovoComoFunciona'];
  const h = rodar(deps, fontes(fns), fns);
  return {
    h, AppState, abertos, enviados, banners, botaoDesfazer,
    // O ✕ no card: a decisão entra na janela do Desfazer.
    rejeitar: () => h.scheduleAction('reject', { venueID: 'v1', updateRequestID: 'u1' }, async () => { enviados.push('v1'); }, {}),
    venceAJanela: () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
  };
}

test('R12-7-03: o "Ver de novo" aberto À MÃO na janela do Desfazer a despacha ANTES de abrir — o diálogo abre sem o banner por cima', () => {
  const m = montarJanela();
  m.rejeitar();
  assert.equal(m.banners.length, 1, 'PRÉ-CONDIÇÃO: o ✕ não pôs o banner do Desfazer na tela');
  assert.ok(m.AppState.pendingAction, 'PRÉ-CONDIÇÃO: o ✕ não abriu a janela');
  m.h.verDeNovoComoFunciona();   // ⓘ → "Ver de novo 'Como funciona'"
  assert.deepEqual(m.abertos, [{ id: 'comoFuncionaModal', banner: false, janela: false }],
    'DEFEITO: o "Como funciona" abriu com o banner do Desfazer por cima — o toque no "Entendi" cai no "Desfazer"');
  assert.deepEqual(m.enviados, ['v1'], 'a decisão do ✕ não saiu ao abrir o diálogo');
  assert.equal(m.AppState.stats.rejected, 1, 'o placar do ✕ mudou');
  m.venceAJanela();   // o relógio da janela foi desligado: nada mais sai
  assert.deepEqual(m.enviados, ['v1'], 'a decisão saiu DUAS vezes — o relógio da janela seguiu correndo');
  // O botão da Ajuda passa por aqui.
  assert.match(fatiar('setupAppListeners'), /^\s+\$\('reverComoFunciona'\)\?\.addEventListener\('click', verDeNovoComoFunciona\);$/m,
    'o "Ver de novo" da Ajuda não passa pelo despacho');
});

test('R12-7-03: CONTROLE — aberto direto, como era, o banner fica por cima do diálogo, e o toque nele DESFAZ o ✕', () => {
  // O instrumento enxerga o defeito: sem o despacho, o diálogo abre com a
  // janela correndo e o banner na tela, e o "Desfazer" devolve o ✕ por trás dele.
  const m = montarJanela();
  m.rejeitar();
  m.h.abrirComoFunciona();
  assert.deepEqual(m.abertos, [{ id: 'comoFuncionaModal', banner: true, janela: true }],
    'o instrumento não vê o banner por cima do diálogo');
  m.botaoDesfazer.clique({ detail: 1 });   // o toque na parte de baixo do "Entendi", que cai no "Desfazer"
  assert.equal(m.AppState.stats.rejected, 0, 'o instrumento não reproduz o ✕ desfeito');
  m.venceAJanela();
  assert.deepEqual(m.enviados, [], 'o instrumento não reproduz: nada vai ao Waze');
});

test('R12-7-03: CONTROLE — sem janela, o "Ver de novo" só abre o diálogo (nada sai)', () => {
  const m = montarJanela();
  m.h.verDeNovoComoFunciona();
  assert.deepEqual(m.abertos, [{ id: 'comoFuncionaModal', banner: false, janela: false }]);
  assert.deepEqual(m.enviados, [], 'o "Ver de novo" sem janela mandou alguma coisa');
});

// ═══ O bundle gerado tem os consertos (gotcha #22) ═════════════════════════
test('o js/min/app.js — o que o navegador carrega — tem os consertos deste lote', () => {
  const MIN = readFileSync(new URL('../js/min/app.js', import.meta.url), 'utf8');
  const contar = (txt, re) => (txt.match(re) || []).length;
  for (const re of [/verConquistasNaTela\(/g, /verConquistasAoVoltar\b/g, /verDeNovoComoFunciona\b/g, /renderUndoGateUI\(/g]) {
    assert.ok(contar(APP_SEM, re) > 0, `o app.js não tem ${re}`);
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${re} — falta \`npm run js\``);
  }
});
