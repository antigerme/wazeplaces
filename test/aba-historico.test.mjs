// A aba Histórico: o painel que o editor está OLHANDO tem que mostrar o que é.
//
// O painel é HTML escrito pelo JS (`renderHistory`), e até a auditoria de
// 2026-09-25 ele só era desenhado quando o modal ABRIA. Tudo que mudava com ele
// aberto ficava velho na tela: o idioma trocado nas Preferências (o mesmo
// modal), a ação que pousava, a outra aba do app gravando por cima. E cada
// toque no painel reescrevia o innerHTML e jogava o foco no `<body>`.
//
// Cada teste foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fechar(txt, i) {
  let prof = 0;
  for (let j = txt.indexOf('{', i); j < txt.length; j++) {
    if (txt[j] === '{') prof++;
    else if (txt[j] === '}') { prof--; if (prof === 0) return j + 1; }
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
// `preludio` declara o estado de MÓDULO que as funções leem (os `let` do app).
function montar(nomes, deps, devolve, preludio = '') {
  const chaves = Object.keys(deps);
  return new Function(...chaves, preludio + '\n' + nomes.map(fatiar).join('\n') + `\nreturn { ${devolve.join(', ')} };`)(...chaves.map((k) => deps[k]));
}
const classes = (...iniciais) => {
  const s = new Set(iniciais);
  return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
    toggle: (c, f) => { const ter = f === undefined ? !s.has(c) : !!f; if (ter) s.add(c); else s.delete(c); return ter; } };
};
const fimDaTarefa = () => new Promise((ok) => setTimeout(ok, 0));

// ── H1: o painel é desenhado ao ENTRAR na aba, e redesenhado com ela aberta ──
test('H1: entrar na aba Histórico DESENHA o painel, e antes de marcar as novas como vistas', () => {
  const ordem = [];
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, { id, classList: classes(), setAttribute() {}, tabIndex: 0 }); return els.get(id); };
  const deps = {
    document: { getElementById: el },
    FILTER_TABS: [{ tab: 'filtersTabFilters', panel: 'filtersPanelFilters' }, { tab: 'filtersTabPrefs', panel: 'filtersPanelPrefs' },
                  { tab: 'filtersTabHistory', panel: 'filtersPanelHistory' }],
    renderHistory: () => ordem.push('desenhou'), marcarConquistasVistas: () => ordem.push('marcou'),
  };
  const { switchFilterTab } = montar(['switchFilterTab'], deps, ['switchFilterTab']);
  switchFilterTab('filtersTabPrefs');
  assert.deepEqual(ordem, [], 'as Preferências não são o Histórico');
  switchFilterTab('filtersTabHistory');
  assert.deepEqual(ordem, ['desenhou', 'marcou'],
    'entrar na aba não redesenha — trocar o idioma nas Preferências deixava o Histórico no idioma antigo');
});

function montarPainel({ modalAberto = true, abaNaTela = true } = {}) {
  const desenhos = { n: 0 };
  const modal = { classList: classes(...(modalAberto ? [] : ['hidden'])) };
  const painel = { classList: classes(...(abaNaTela ? [] : ['hidden'])) };
  const guardado = new Map();
  const AppState = { history: null, authenticated: true };
  const deps = {
    AppState, HISTORY_KEY: 'waze_places_history',
    document: { getElementById: (id) => ({ filtersModal: modal, filtersPanelHistory: painel })[id] || null },
    localStorage: { getItem: (k) => (guardado.has(k) ? guardado.get(k) : null) },
    podarHistorico: () => false, salvarHistorico: (h) => guardado.set('waze_places_history', JSON.stringify(h)),
    historyTodayKey: () => '2026-09-25', ondeAgora: () => '30',
    renderHistory: () => { desenhos.n++; },
  };
  const api = montar(['historicoNaTela', 'agendarRedesenhoDoHistorico', 'loadHistory', 'recordHistory'], deps,
    ['recordHistory', 'historicoNaTela'], 'let redesenhoDoHistoricoAgendado = false;');
  return { ...api, desenhos, modal, painel };
}

test('H1: a ação que POUSA com o painel aberto aparece nele — um desenho por tarefa', async () => {
  const m = montarPainel();
  // Um pouso grava histórico três vezes numa tarefa só (o lote, por exemplo).
  m.recordHistory('reject', 1);
  m.recordHistory('reject', 1);
  m.recordHistory('read', 1);
  assert.equal(m.desenhos.n, 0, 'desenhou no meio da gravação: o autor e as conquistas ainda não estavam gravados');
  await fimDaTarefa();
  assert.equal(m.desenhos.n, 1,
    `o painel aberto ${m.desenhos.n ? 'foi desenhado ' + m.desenhos.n + ' vezes' : 'não mostrou o que pousou'} — só fechando e reabrindo o modal`);
});

test('H1: CONTROLE — com o painel fora da tela, pousar não desenha nada', async () => {
  for (const cenario of [{ modalAberto: false }, { abaNaTela: false }]) {
    const m = montarPainel(cenario);
    m.recordHistory('read', 1);
    await fimDaTarefa();
    assert.equal(m.desenhos.n, 0, `desenhou o Histórico fora da tela (${JSON.stringify(cenario)})`);
  }
});

test('H1: trocar de idioma com o painel NA TELA o redesenha', () => {
  const desenhos = [];
  const deps = {
    setLang: () => {}, safeLS: { set: () => {} }, LANG_KEY: 'waze_places_lang', applyI18n: () => {},
    SELETORES_IDIOMA: [], document: { getElementById: () => null }, popularOrdenacoes: () => {},
    AppState: { profile: null, currentPlace: null, authenticated: true },
    renderProfileHeader: () => {}, showCurrentPlace: () => {}, updateStats: () => {}, updatePendingCount: () => {},
    renderUndoGateUI: () => {}, atualizarLinhaDoOffline: () => {}, atualizarSeloDeConquista: () => {},
    registrarIdiomaUsado: () => {}, window: {}, showToast: () => {}, t: (k) => k,
    historicoNaTela: () => true, renderHistory: () => desenhos.push('en'),
  };
  const { aplicarIdioma } = montar(['aplicarIdioma'], deps, ['aplicarIdioma']);
  aplicarIdioma('en');
  assert.deepEqual(desenhos, ['en'], 'o Histórico na tela ficou no idioma antigo');
});

// O anel das novas: o painel agora é redesenhado com a aba aberta, e o anel
// não pode sumir no primeiro redesenho — "nesta abertura a pessoa ainda
// precisa ver o que destravou".
function montarVitrine() {
  const g = { c: { coruja: '2026-09-25' }, novas: ['coruja'], patenteNova: true };
  const AppState = { conquistas: g };
  const deps = {
    AppState, carregarConquistas: () => g, salvarConquistas() {}, atualizarSeloDeConquista() {},
    conquistasVisiveis: () => [{ id: 'primeiraFaxina', emoji: '🧹' }, { id: 'coruja', emoji: '🌙' }],
    escapeHtml: (s) => String(s), t: (k) => k,
    getHistoryStats: () => ({ total: { read: 150, rejected: 0 } }), patenteDe: () => 1,
    PATENTES: [{ id: 'aprendiz', emoji: '🧤', min: 0 }, { id: 'gari', emoji: '🧹', min: 100 }, { id: 'lixeiro', emoji: '🗑️', min: 500 }],
  };
  const preludio = 'let conquistaTocada = null, novasDestaAbertura = null, autoresExpandido = false, escadaAberta = false;';
  const api = montar(['marcarConquistasVistas', 'htmlConquistas', 'htmlPatente'], deps, ['marcarConquistasVistas', 'htmlConquistas',
    'htmlPatente', 'fecharModal: () => { novasDestaAbertura = null; }'], preludio);
  return { ...api, g };
}
const aneis = (html) => [...html.matchAll(/class="conq-cel [^"]*\bnova\b[^"]*"\s+data-conq="(\w+)"/g)].map((m) => m[1]);
const patenteComAnel = (html) => /class="conq-card nova"/.test(html);

test('H1: o anel da conquista nova SOBREVIVE ao redesenho da mesma abertura, e some na próxima', () => {
  const m = montarVitrine();
  assert.deepEqual(aneis(m.htmlConquistas()), ['coruja'], 'CONTROLE: antes de ver, a coruja tem anel');
  assert.ok(patenteComAnel(m.htmlPatente()), 'CONTROLE: antes de ver, a patente nova tem anel');
  m.marcarConquistasVistas();                      // entrou na aba: é ter visto (o ponto apaga)
  assert.deepEqual(m.g.novas, [], 'marcar como vista não limpou as novas — o ponto voltaria');
  assert.equal(m.g.patenteNova, false);
  assert.deepEqual(aneis(m.htmlConquistas()), ['coruja'],
    'o redesenho da MESMA abertura (ação que pousa, toque numa célula) apagou o anel antes de ser visto');
  assert.ok(patenteComAnel(m.htmlPatente()),
    'o redesenho da mesma abertura apagou o anel da PATENTE (ela não tem célula na grade)');
  // Fechou o modal: a próxima abertura não tem mais anel.
  assert.match(fatiar('closeModal'), /LIMPEZA_AO_FECHAR\[id\]/);
  const limpeza = APP_SEM.match(/filtersModal\(\) \{([^}]*)\}/);
  assert.ok(limpeza && /novasDestaAbertura = null/.test(limpeza[1]),
    'fechar Filtros não solta o que a abertura mostrou como novo — o anel ficaria pra sempre');
  m.fecharModal();
  assert.deepEqual(aneis(m.htmlConquistas()), [], 'o anel sobreviveu ao fechamento do modal');
  assert.ok(!patenteComAnel(m.htmlPatente()), 'o anel da patente sobreviveu ao fechamento do modal');
});

// ── H3: o app aberto em DUAS abas ───────────────────────────────────────────
// Cada aba guarda histórico, conquistas e autores em memória e grava a
// estrutura INTEIRA a cada ação: a última a gravar apagava a outra (medido: 5
// pedidos numa aba e 1 na outra davam `_total` 100/1 em vez de 105/1). O
// navegador avisa a OUTRA aba (evento `storage`); aqui o aviso é entregue à
// mão, na ordem em que o navegador o entregaria.
function armazenamentoCompartilhado(inicial = {}) {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
  const abas = [], pendentes = [];
  return {
    dados, abas,
    para(aba) {
      return {
        getItem: (k) => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); for (const o of abas) if (o !== aba) pendentes.push([o, k]); },
        removeItem: (k) => { dados.delete(k); for (const o of abas) if (o !== aba) pendentes.push([o, k]); },
      };
    },
    // O que o navegador entrega à outra aba antes do próximo gesto dela.
    entregar() { while (pendentes.length) { const [aba, key] = pendentes.shift(); aba.aoGravarEmOutraAba({ key }); } },
    descartarAvisos() { pendentes.length = 0; },
    ler: (k) => JSON.parse(dados.get(k)),
  };
}
function abrirAba(comp) {
  const aba = { selo: 0, redesenhos: 0 };
  const AppState = { history: null, conquistas: null, autores: null, authenticated: true };
  const deps = {
    AppState, localStorage: comp.para(aba),
    HISTORY_KEY: 'waze_places_history', CONQUISTAS_KEY: 'waze_places_conquistas', AUTORES_KEY: 'waze_places_autores',
    AUTORES_MAX_DIAS: 30, AUTORES_MAX_REINCIDENTES: 500, AUTORES_MAX_VISTOS: 6000, diaDeHoje: () => 20000,
    podarHistorico: () => false, historyTodayKey: () => '2026-09-25', ondeAgora: () => '30',
    atualizarSeloDeConquista: () => { aba.selo++; }, agendarRedesenhoDoHistorico: () => { aba.redesenhos++; },
  };
  const nomes = ['salvarHistorico', 'loadHistory', 'recordHistory', 'carregarConquistas', 'salvarConquistas',
    'loadAutores', 'salvarAutores', 'podarAutores', 'registrarRejeicaoDeAutor', 'aoGravarEmOutraAba'];
  Object.assign(aba, montar(nomes, deps, nomes), { AppState });
  comp.abas.push(aba);
  return aba;
}

test('H3: o trabalho de uma aba NÃO some quando a outra grava — histórico', () => {
  const comp = armazenamentoCompartilhado({ waze_places_history: { _total: { read: 100, rejected: 0 } } });
  const A = abrirAba(comp), B = abrirAba(comp);
  A.loadHistory(); B.loadHistory();                    // as duas já leram (a aba Histórico aberta, p.ex.)
  for (let i = 0; i < 5; i++) A.recordHistory('read', 1);
  comp.entregar();
  B.recordHistory('reject', 1);
  assert.deepEqual(comp.ler('waze_places_history')._total, { read: 105, rejected: 1 },
    'a aba B gravou a cópia VELHA por cima: os 5 pedidos da aba A sumiram do Histórico');
  assert.ok(B.redesenhos >= 1, 'o painel aberto da aba avisada não é redesenhado');
});

test('H3: CONTROLE — sem o aviso do navegador a perda acontece (o teste mede o que diz medir)', () => {
  const comp = armazenamentoCompartilhado({ waze_places_history: { _total: { read: 100, rejected: 0 } } });
  const A = abrirAba(comp), B = abrirAba(comp);
  A.loadHistory(); B.loadHistory();
  for (let i = 0; i < 5; i++) A.recordHistory('read', 1);
  comp.descartarAvisos();
  B.recordHistory('reject', 1);
  assert.deepEqual(comp.ler('waze_places_history')._total, { read: 100, rejected: 1 });
});

test('H3: conquistas e autores também — e o ponto da aba avisada segue o aparelho', () => {
  const comp = armazenamentoCompartilhado();
  const A = abrirAba(comp), B = abrirAba(comp);
  A.carregarConquistas(); B.carregarConquistas();
  A.carregarConquistas().c.coruja = '2026-09-25';      // destravou na aba A
  A.salvarConquistas();
  comp.entregar();
  assert.equal(B.selo, 1, 'o ponto da aba B não olhou o aparelho depois do aviso');
  B.carregarConquistas().seq = 0;                      // um Desfazer na aba B
  B.salvarConquistas();
  assert.ok(comp.ler('waze_places_conquistas').c.coruja, 'a aba B apagou a conquista que a aba A destravou');

  A.loadAutores(); B.loadAutores();
  A.registrarRejeicaoDeAutor({ creatorId: 1, createdBy: 'autor_a' });
  A.registrarRejeicaoDeAutor({ creatorId: 1, createdBy: 'autor_a' });
  comp.entregar();
  B.registrarRejeicaoDeAutor({ creatorId: 2, createdBy: 'autor_b' });
  assert.ok(comp.ler('waze_places_autores').r['1'], 'a aba B apagou a reincidência que a aba A registrou');
});

test('H3: a outra aba limpando tudo solta as três cópias; chave alheia não mexe em nada', () => {
  const comp = armazenamentoCompartilhado();
  const A = abrirAba(comp);
  A.loadHistory(); A.carregarConquistas(); A.loadAutores();
  A.aoGravarEmOutraAba({ key: 'waze_places_stats' });
  assert.ok(A.AppState.history && A.AppState.conquistas && A.AppState.autores, 'chave alheia soltou as cópias');
  assert.equal(A.redesenhos, 0, 'chave alheia redesenhou o painel');
  A.aoGravarEmOutraAba({ key: null });                 // localStorage.clear() na outra aba
  assert.deepEqual([A.AppState.history, A.AppState.conquistas, A.AppState.autores], [null, null, null],
    'a limpeza da outra aba não soltou as cópias em memória');
});

test('H3: o app escuta o aviso — o ouvinte é ligado na abertura', () => {
  const ouvintes = [];
  const aoGravarEmOutraAba = () => {};
  const { setupSincroniaEntreAbas } = montar(['setupSincroniaEntreAbas'],
    { window: { addEventListener: (tipo, fn) => ouvintes.push([tipo, fn]) }, aoGravarEmOutraAba }, ['setupSincroniaEntreAbas']);
  setupSincroniaEntreAbas();
  assert.deepEqual(ouvintes, [['storage', aoGravarEmOutraAba]], 'ninguém escuta o evento storage');
  assert.match(fatiar('initApp'), /^\s+setupSincroniaEntreAbas\(\);/m, 'a abertura do app não liga a sincronia entre abas');
});
