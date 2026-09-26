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

// ── H4: o foco sobrevive ao redesenho do painel ──────────────────────────────
// O painel é reescrito inteiro a cada toque (célula, escada, interruptor,
// lixeira, "Ver mais"), e o elemento focado morria junto: o foco caía no
// `<body>`. Um DOM de mentira que transforma o innerHTML em elementos, e onde
// o foco no elemento que sai do DOM cai no body, como no navegador.
function domDeMentira() {
  let ativo = null;
  const raizes = new Map();
  const doc = { body: { id: '' } };
  Object.defineProperty(doc, 'activeElement', { get: () => ativo || doc.body });
  const tags = (html) => [...String(html).matchAll(/<(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g)].map((m) => {
    const at = {};
    for (const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) at[a[1]] = a[2] ?? '';
    const classes = new Set((at.class || '').split(/\s+/).filter(Boolean));
    const el = {
      id: at.id || '', tag: m[1],
      getAttribute: (k) => (k in at ? at[k] : null),
      classList: { contains: (c) => classes.has(c) },
      dataset: { autor: at['data-autor'] }, ouvintes: {},
      addEventListener(tipo, fn) { (el.ouvintes[tipo] ||= []).push(fn); }, scrollIntoView() {},
      disparar(tipo) { for (const fn of el.ouvintes[tipo] || []) fn({}); },
      focus() { ativo = el; },
    };
    return el;
  });
  function raiz(id) {
    const r = { id, filhos: [], dataset: {}, focus() { ativo = r; }, scrollIntoView() {} };
    Object.defineProperty(r, 'innerHTML', {
      set(html) { if (r.filhos.includes(ativo)) ativo = null; r.filhos = tags(html); },
      get() { return ''; },
    });
    r.insertAdjacentHTML = (_, html) => { r.filhos.push(...tags(html)); };
    r.appendChild = (el) => { r.filhos.push(el); };
    r.contains = (el) => r.filhos.includes(el);
    r.querySelectorAll = (sel) => r.filhos.filter((e) => (sel.startsWith('.') ? e.classList.contains(sel.slice(1))
      : sel.startsWith('[') ? e.getAttribute(sel.slice(1, -1)) !== null : false));
    raizes.set(id, r);
    return r;
  }
  const aba = { id: 'filtersTabHistory', focus() { ativo = aba; } };
  const fechar = { id: 'closeFiltersFooter', focus() { ativo = fechar; } };
  doc.getElementById = (id) => {
    if (raizes.has(id)) return raizes.get(id);
    if (id === aba.id) return aba;
    if (id === fechar.id) return fechar;
    for (const r of raizes.values()) { const e = r.filhos.find((x) => x.id === id); if (e) return e; }
    return null;
  };
  return { document: doc, raiz, aba, fechar, focar: (el) => el.focus(), ativo: () => doc.activeElement };
}

function montarPainelComFoco({ autores }) {
  const dom = domDeMentira();
  dom.raiz('historyBody'); dom.raiz('autoresBody');
  const estado = { autores, esquecidos: [] };
  const deps = {
    document: dom.document,
    getHistoryStats: () => ({ today: { read: 0, rejected: 0 }, week: { read: 0, rejected: 0 }, month: { read: 0, rejected: 0 }, total: { read: 4, rejected: 2 } }),
    htmlPatente: () => '<div class="conq-card"><button type="button" id="conqEscadaBtn" class="conq-link"></button></div>',
    htmlConquistas: () => '<button type="button" class="conq-cel on" data-conq="primeiraFaxina"></button>'
      + '<button type="button" class="conq-cel off" data-conq="coruja"></button>',
    dadosDoResumo: () => ({ total: 0 }), loadHistory: () => ({}), i18nLocale: () => 'pt-BR', ligarConquistas() {},
    escapeHtml: (s) => String(s), t: (k) => k,
    listaDeAutores: () => estado.autores, AUTORES_VISIVEIS: 10, AUTORES_MAX_DIAS: 30, AUTOR_LIMIAR_DESTAQUE: 6,
    ICONE_LIXO: '', podeRecusarAutomaticoAqui: () => true, autoLigado: () => false, rejeitadoQuando: () => '',
    esquecerAutor() {}, alternarAutoDoAutor() {},
    esquecerAutorDaLista: (id) => { estado.esquecidos.push(id); },
  };
  const api = montar(['chaveDoFoco', 'devolverFoco', 'renderAutores', 'renderHistory'], deps,
    ['renderAutores', 'renderHistory'], 'let autoresExpandido = false;');
  const achar = (raizId, pred) => dom.document.getElementById(raizId).filhos.find(pred);
  return { ...api, dom, estado, achar };
}
const autor = (id, n) => ({ id, n, nome: 'autor_' + id, dia: 0 });

test('H4: tocar uma célula de conquista pelo teclado: o foco fica NA célula (a nova), não no <body>', () => {
  const m = montarPainelComFoco({ autores: [] });
  m.renderHistory();
  m.dom.focar(m.achar('historyBody', (e) => e.getAttribute('data-conq') === 'coruja'));
  m.renderHistory();                                  // o toque redesenha o painel inteiro
  const a = m.dom.ativo();
  assert.equal(a.getAttribute && a.getAttribute('data-conq'), 'coruja',
    `o foco foi para ${a.id || a.tag || 'o <body>'} — quem navega por teclado volta pro começo da página`);
  assert.ok(m.dom.document.getElementById('historyBody').contains(a), 'o foco ficou num elemento que saiu do DOM');
  // "ver a escada" (id)
  m.dom.focar(m.dom.document.getElementById('conqEscadaBtn'));
  m.renderHistory();
  assert.equal(m.dom.ativo().id, 'conqEscadaBtn', '"ver a escada" perdeu o foco no redesenho');
});

test('H4: interruptor e lixeira de autor: o foco volta pro MESMO autor — e, se ele saiu, pro vizinho', () => {
  const m = montarPainelComFoco({ autores: [autor('555', 3), autor('556', 2)] });
  m.renderAutores();
  const auto = m.achar('autoresBody', (e) => e.classList.contains('autor-auto') && e.getAttribute('data-autor') === '555');
  m.dom.focar(auto);
  m.renderAutores();                                  // o interruptor trocou
  const a = m.dom.ativo();
  assert.ok(a !== auto && a.classList && a.classList.contains('autor-auto') && a.getAttribute('data-autor') === '555',
    'o interruptor do autor perdeu o foco no redesenho');
  // A lixeira do 555: ele sai da lista, e o foco vai pra lixeira que tomou o lugar.
  m.dom.focar(m.achar('autoresBody', (e) => e.classList.contains('autor-esquecer') && e.getAttribute('data-autor') === '555'));
  m.estado.autores = [autor('556', 2)];
  m.renderAutores();
  const v = m.dom.ativo();
  assert.ok(v.classList && v.classList.contains('autor-esquecer') && v.getAttribute('data-autor') === '556',
    'esquecido o autor, o foco não foi pra lixeira vizinha');
  // O último autor esquecido: a lista some inteira — o foco vai pra aba do painel.
  m.estado.autores = [];
  m.renderAutores();
  assert.equal(m.dom.ativo(), m.dom.aba, 'com a lista vazia o foco caiu no <body> em vez da aba do painel');
});

test('H4: CONTROLE — redesenho com o foco FORA do painel não rouba o foco', () => {
  const m = montarPainelComFoco({ autores: [autor('555', 3)] });
  m.renderHistory();
  m.dom.focar(m.dom.fechar);                          // o foco no "Fechar" do rodapé
  m.renderHistory();                                  // uma ação pousou com o painel aberto
  assert.equal(m.dom.ativo(), m.dom.fechar, 'o redesenho roubou o foco de quem estava fora do painel');
});

// ── H8: esquecer pela LISTA refaz o card que mostra o `✕ N` ─────────────────
// A folha do autor refazia o card; a lista do Histórico não: o "✕ 7" seguia
// no card da frente depois de a contagem ser apagada, e tocar nele abria a
// folha dizendo "Você rejeitou 0 pedidos".
function montarEsquecer({ frente, fundo }) {
  const feito = [];
  const AppState = { currentPlace: frente, queue: [frente, fundo].filter(Boolean) };
  const deps = {
    AppState, esquecerAutor: (id) => feito.push('esqueceu:' + id),
    removeCurrentCardEl: () => feito.push('tirou'), showCurrentPlace: () => feito.push('refez'),
  };
  const { esquecerAutorDaLista } = montar(['esquecerAutorDaLista'], deps, ['esquecerAutorDaLista']);
  return { esquecerAutorDaLista, feito };
}

test('H8: esquecer pela lista do Histórico refaz o card da frente (e o de fundo) que mostra o autor', () => {
  const frente = { creatorId: 1001 }, fundo = { creatorId: 2002 };
  let m = montarEsquecer({ frente, fundo });
  m.esquecerAutorDaLista('1001');
  assert.deepEqual(m.feito, ['esqueceu:1001', 'tirou', 'refez'],
    'o card da frente seguiu com o "✕ N" de um autor que acabou de ser esquecido');
  m = montarEsquecer({ frente, fundo });
  m.esquecerAutorDaLista('2002');
  assert.deepEqual(m.feito, ['esqueceu:2002', 'tirou', 'refez'], 'o card de FUNDO seguiu com o selo do autor esquecido');
  // CONTROLE: autor fora da tela não refaz nada (devolveria o carrossel ao começo).
  m = montarEsquecer({ frente, fundo });
  m.esquecerAutorDaLista('9999');
  assert.deepEqual(m.feito, ['esqueceu:9999']);
});

test('H8: a lixeira da lista passa por esse caminho (e não pelo esquecer cru)', () => {
  const m = montarPainelComFoco({ autores: [autor('1001', 7)] });
  m.renderAutores();
  const lixeira = m.achar('autoresBody', (e) => e.classList.contains('autor-esquecer') && e.getAttribute('data-autor') === '1001');
  lixeira.disparar('click');
  assert.deepEqual(m.estado.esquecidos, ['1001'], 'a lixeira da lista esquece sem refazer o card');
});

// ── H14: o aviso da recusa automática não atribui a um autor o que é de outro ─
// Com dois autores marcados na mesma leva, "Rejeitando 4 pedidos de
// spammer_A…" — dois deles eram do spammer_B. O lote anda em ordem, então o
// que falta é o fim da lista.
async function rodarRecusa(alvos) {
  const avisos = [];
  const frente = { venueID: 'v0', creatorId: 1 };
  const AppState = { queue: [frente, ...alvos], currentPlace: frente };
  const deps = {
    AppState, podeRecusarAutomaticoAqui: () => true, Treino: { ativo: false },
    autoLigado: (id) => id !== 1, updatePendingCount() {}, aoMudarAFilaPorBaixo() {},
    t: (k, v) => k + ' ' + JSON.stringify(v),
    showToast: (msg) => { avisos.push(msg); return { texto: (m) => avisos.push(m), dispensar() {} }; },
    // O `enviarLote` anda EM ORDEM e conta o que ainda falta depois de cada um.
    enviarLote: async (lista, opts) => { for (let i = 1; i <= lista.length; i++) opts.aoProgredir(lista.length - i); },
  };
  const { aplicarRecusaAutomatica } = montar(['aplicarRecusaAutomatica'], deps, ['aplicarRecusaAutomatica'],
    'let recusaAutomaticaRodando = false;');
  await aplicarRecusaAutomatica();
  return avisos;
}
const pedidoDe = (i, id, nome) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: id, createdBy: nome });

test('H14: dois autores na recusa automática — o aviso não põe tudo na conta do primeiro', async () => {
  const avisos = await rodarRecusa([pedidoDe(2, 2001, 'spammer_A'), pedidoDe(3, 2002, 'spammer_B'),
    pedidoDe(4, 2001, 'spammer_A'), pedidoDe(5, 2002, 'spammer_B')]);
  assert.ok(!avisos.some((m) => m.includes('spammer_A') && /"n":[2-4]/.test(m)),
    `o aviso atribuiu ao spammer_A pedidos do spammer_B: ${avisos[0]}`);
  assert.equal(avisos[0], 'auto.andandoAutores {"n":4,"a":2}', 'com dois autores na leva a frase tem que ser a genérica');
  // Quando só falta o do spammer_B, a frase volta a nomear — e agora é verdade.
  assert.equal(avisos.at(-1), 'auto.andando {"n":1,"autor":"spammer_B"}');
});

test('H14: CONTROLE — um autor só continua nomeado, no singular e no plural', async () => {
  const avisos = await rodarRecusa([pedidoDe(2, 2001, 'spammer_A'), pedidoDe(4, 2001, 'spammer_A')]);
  assert.deepEqual(avisos, ['auto.andandoPlural {"n":2,"autor":"spammer_A"}', 'auto.andando {"n":1,"autor":"spammer_A"}']);
});

// ── H7 e H20: o que a folha do autor e o selo de conquista DIZEM ─────────────
const DICT = new Function('window', 'navigator', 'localStorage', 'document',
  readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8') + '\nreturn I18N_DICT;')(
  {}, { language: 'pt-BR' }, { getItem: () => null, setItem() {} }, { documentElement: {}, querySelectorAll: () => [] });

test('H7: a folha do autor não afirma um período que a contagem não tem', () => {
  // A contagem ACUMULA desde que o autor entrou na lista; os 30 dias são o
  // prazo pra ele SAIR sem rejeição nova. "Nos últimos 30 dias" mostrava 7
  // com 2 dentro da janela.
  for (const lang of Object.keys(DICT)) {
    for (const k of ['autor.sheet.sub', 'autor.sheet.subUm']) {
      const v = DICT[lang][k];
      assert.ok(v, `${lang}: falta ${k}`);
      assert.ok(!/\{dias\}|\d/.test(v), `${lang}: ${k} volta a afirmar um período: "${v}"`);
    }
  }
});

test('H20: o francês concorda com "distinction" (feminino) e diz a frase da folha em francês natural', () => {
  const fr = DICT.fr;
  const adjetivo = fr['conq.selo.aria'].split(' ')[0];            // "nouvelle distinction"
  assert.equal(fr['conq.nova'], adjetivo,
    `o selo da célula diz "${fr['conq.nova']}" e o do botão "${fr['conq.selo.aria']}" — o mesmo conceito com dois gêneros`);
  assert.ok(!/seule d[’']elle/.test(fr['autor.sheet.subUm']), `"la seule d’elle" não é francês: ${fr['autor.sheet.subUm']}`);
});
