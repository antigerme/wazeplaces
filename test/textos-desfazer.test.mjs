// O que a tela PROMETE sobre o Desfazer e sobre o fim do treino, contra o que o
// app FAZ (auditoria de 2026-09-29, lote dos textos):
//   · A5 — o fim do treino fechado por Esc, pelo fundo ou pelo voltar deixava o
//     treino preso: o card de treino já tratado na tela, "Restam 0" e os botões
//     mortos. Só o "Ir para a fila" saía do treino;
//   · A6 — o fim do treino prometia "o Desfazer te dá 3s em cada ação" com o
//     Desfazer desligado, e a primeira ação de verdade saía na hora;
//   · A10 — a folha do autor dizia "começa ao tocar" e "tocar em rejeitar já
//     escreve no Waze" com o Desfazer LIGADO (o padrão), quando o lote abre a
//     janela e nada sai.
// Roda o código DE VERDADE (fatiado do app.js), num DOM de mentira. Cada teste
// foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = ler('js/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fecharDelimitador(txt, i, abre, fecha) {
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
  const corpo = APP_SEM.slice(m.index, fecharDelimitador(APP_SEM, i, '{', '}'));
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
function fatiarConst(nome, abre, fecha) {
  const m = new RegExp('^const ' + nome + ' = ', 'm').exec(APP_SEM);
  assert.ok(m, `const ${nome} sumiu do app.js`);
  return APP_SEM.slice(m.index, fecharDelimitador(APP_SEM, m.index, abre, fecha)) + ';';
}
function dicionario() {
  const ctx = { navigator: { language: 'pt-BR' }, document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} }, console };
  vm.createContext(ctx);
  vm.runInContext(ler('js/i18n.js') + '\nthis.D = I18N_DICT;', ctx);
  return ctx.D;
}

// Um elemento de mentira com classes, atributos e o que o openModal consulta.
function elemento(id, { oculto = false } = {}) {
  const classes = new Set(oculto ? ['hidden'] : []);
  const attrs = {};
  const ouvintes = {};
  return {
    id, textContent: '', innerHTML: '', style: {}, children: [], checked: false,
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      replace: (a, b) => { if (classes.delete(a)) classes.add(b); },
      toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; if (on) classes.add(c); else classes.delete(c); return on; },
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    addEventListener(tipo, fn) { (ouvintes[tipo] = ouvintes[tipo] || []).push(fn); },
    disparar(tipo) { for (const fn of ouvintes[tipo] || []) fn({}); },
    querySelector: () => null,
    focus() {},
  };
}

// ── A5 e A6: o fim do treino ─────────────────────────────────────────────────
// O Treino, o openModal/closeModal e a limpeza dos modais num escopo só, como
// no app: a limpeza do `treinoFimModal` chama o MESMO Treino que o abriu.
function montarTreino({ undoEnabled = true, cotaPassada = true } = {}) {
  const els = new Map();
  const el = (id, op) => { const e = elemento(id, op); els.set(id, e); return e; };
  el('treinoFimModal', { oculto: true }); el('treinoBanner', { oculto: true });
  el('treinoFimEfeito', { oculto: true }); el('treinoFimCorpo'); el('noMoreCards');
  el('toastContainer'); el('helpBtn');
  for (const id of ['pasteModal', 'logoutModal', 'accessDeniedModal', 'filtersModal', 'helpModal', 'batchReadModal',
    'pairShowModal', 'pairEnterModal', 'comoFuncionaModal', 'presencaModal', 'conversaModal', 'pedidoModal',
    'autorModal', 'resumoModal']) el(id, { oculto: true });
  const log = [];
  const real = { venueID: 'real1', updateRequestID: 'r1', name: 'Local Real', updateTypeKey: 'VENUE', imageUrls: [] };
  const AppState = {
    authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: [real], currentPlace: real, stats: { read: 7, rejected: 3, skipped: 1 }, serverTotal: 40,
    preferences: { comoFuncionaVisto: true, undoEnabled }, devMode: { active: false },
  };
  const deps = {
    AppState,
    document: { getElementById: (id) => els.get(id) || null, body: { style: {} }, activeElement: null },
    dfato: () => {}, Lightbox: { isOpen: () => false },
    CamadaVoltar: { empilhar: () => log.push('empilha'), consumir: () => log.push('consome') },
    removeUndoBanner: () => {}, savePreferences: () => {}, showLoading: () => {},
    updateStats: () => {}, updatePendingCount: () => {}, showCurrentPlace: () => log.push('card:' + (AppState.currentPlace || {}).venueID),
    fecharCamadasDeFoto: () => {}, removeCurrentCardEl: () => {}, maybePrefetch: () => {},
    startFetching: () => log.push('busca'), showNoPlaces: () => log.push('vazio'),
    showToast: () => {}, t: (k) => 'T:' + k,
    loteDeLidosEmVoo: false,
    canDisableUndo: () => cotaPassada,
    // Entrar no treino despacha as escritas do lightbox que estavam na janela
    // do Desfazer (lote 8 do lightbox, L25): aqui não há nenhuma.
    enviarPendenciasDoLightbox: () => {},
  };
  const corpo = [
    'let lastFocusedBeforeModal = null, ultimoFocoForaDasCamadas = null;',
    fatiarConst('MODAL_IDS', '[', ']'),
    fatiar('openModal'), fatiar('closeModal'), fatiar('topOpenModal'),
    fatiar('devolverFoco'), fatiar('focavelNaTela'), fatiar('dentroDeCamada'),
    fatiar('trocarTextoI18n'), fatiar('semJanelaDeDesfazer'),
    fatiarConst('LIMPEZA_AO_FECHAR', '{', '}'),
    fatiarConst('Treino', '{', '}'),
    'return { Treino, openModal, closeModal };',
  ].join('\n');
  const chaves = Object.keys(deps);
  const api = new Function(...chaves, corpo)(...chaves.map((k) => deps[k]));
  // O treino inteiro, até o fim: é o `agir` do ÚLTIMO card que abre o modal.
  const ateOFim = () => {
    api.Treino.entrar();
    while (AppState.queue.length) api.Treino.agir('read');
  };
  return { ...api, AppState, els, log, ateOFim, real };
}

// O ouvinte do "Ir para a fila", rodado de verdade: o corpo da arrow do
// `addEventListener` no setupModalListeners.
function botaoIrParaAFila(closeModal, Treino) {
  const m = /\$\('treinoFimOk'\)\?\.addEventListener\('click', \(\) => ([^\n]+)\);\n/.exec(APP_SEM);
  assert.ok(m, 'CONTROLE: o ouvinte do "Ir para a fila" sumiu do setupModalListeners');
  return new Function('closeModal', 'Treino', `return () => ${m[1]};`)(closeModal, Treino);
}

test('A5: o fim do treino fechado por Esc/fundo ou pelo VOLTAR sai do treino e devolve a fila real', () => {
  for (const [caminho, opcoes] of [['Esc ou fundo', {}], ['voltar do aparelho', { viaHistorico: true }]]) {
    const m = montarTreino();
    m.ateOFim();
    assert.equal(m.Treino.ativo, true, 'CONTROLE: no fim o treino ainda está ativo (o modal é que decide)');
    assert.equal(m.els.get('treinoFimModal').classList.contains('hidden'), false, 'CONTROLE: o fim do treino não abriu');
    m.closeModal('treinoFimModal', opcoes);
    assert.equal(m.Treino.ativo, false, `fechado pelo ${caminho}, o treino ficou preso (card tratado, "Restam 0", botões mortos)`);
    assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['real1'], `fechado pelo ${caminho}, a fila real não voltou`);
    assert.equal(m.AppState.currentPlace, m.real);
    assert.ok(m.log.includes('card:real1'), `fechado pelo ${caminho}, o card real não voltou pra tela`);
    assert.equal(m.els.get('treinoBanner').classList.contains('hidden'), true, 'a faixa "nada é enviado" ficou na tela');
  }
});

test('A5: o "Ir para a fila" sai do treino UMA vez — quem sai é a limpeza do modal, e o botão só fecha', () => {
  const m = montarTreino();
  m.ateOFim();
  m.log.length = 0;   // o que conta é o que o BOTÃO faz
  let saidas = 0;
  const sair = m.Treino.sair.bind(m.Treino);
  m.Treino.sair = () => { saidas++; sair(); };
  botaoIrParaAFila(m.closeModal, m.Treino)();
  assert.equal(m.Treino.ativo, false, 'o botão não saiu do treino');
  assert.equal(saidas, 1, `o botão chamou o sair() ${saidas} vezes — a limpeza já sai`);
  assert.deepEqual(m.log.filter((x) => x.startsWith('card:')), ['card:real1'], 'o card real foi montado mais de uma vez');
});

test('A6: o fim do treino só promete os segundos do Desfazer quando ele EXISTE', () => {
  const corpo = (op) => {
    const m = montarTreino(op);
    m.ateOFim();
    const p = m.els.get('treinoFimCorpo');
    return { chave: p.getAttribute('data-i18n'), texto: p.textContent };
  };
  // Desligado E com a cota: a ação sai na hora (é o `scheduleAction`).
  assert.deepEqual(corpo({ undoEnabled: false, cotaPassada: true }),
    { chave: 'treino.fim.bodySemDesfazer', texto: 'T:treino.fim.bodySemDesfazer' },
    'com o Desfazer desligado, o fim do treino promete os segundos de uma janela que não vai abrir');
  // CONTROLE: ligado (o padrão), e desligado SEM a cota (o gate mantém a janela).
  for (const op of [{ undoEnabled: true }, { undoEnabled: false, cotaPassada: false }]) {
    assert.deepEqual(corpo(op), { chave: 'treino.fim.body', texto: 'T:treino.fim.body' },
      `com a janela do Desfazer (${JSON.stringify(op)}), a frase dela sumiu`);
  }
});

// ── A10: a folha do autor ────────────────────────────────────────────────────
function montarFolha({ undoEnabled = true, cotaPassada = true } = {}) {
  const els = new Map();
  for (const id of ['autorCorpo', 'autorTitle', 'autorVer', 'autorRejeitar', 'autorEsquecer', 'autorAuto']) {
    els.set(id, elemento(id));
  }
  const autor = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 42, createdBy: 'spammer' });
  const fila = [autor(1), autor(2), autor(3)];
  const deps = {
    AppState: { queue: fila, preferences: { undoEnabled }, devMode: { active: false } },
    document: { getElementById: (id) => els.get(id) || null },
    canDisableUndo: () => cotaPassada,
    t: (k) => k, escapeHtml: (x) => x,
    ICONE_OLHO: '', ICONE_X: '', ICONE_LIXO: '', ICONE_RAIO: '',
    contagemDoAutor: () => 6, podeRecusarAutomaticoAqui: () => false, autoLigado: () => false,
    openModal: () => {}, closeModal: () => {}, focarAutor: () => {}, rejeitarLoteDoAutor: () => {},
    alternarAutoDoAutor: () => {}, esquecerAutor: () => {}, removeCurrentCardEl: () => {}, showCurrentPlace: () => {},
  };
  const chaves = Object.keys(deps);
  const { abrirFolhaDoAutor } = new Function(...chaves,
    // `chaveDoPedido`: a folha guarda as chaves que CONTOU (lote 8 da fila, L21).
    [fatiar('pedidosDoAutorNaFila'), fatiar('chaveDoPedido'), fatiar('semJanelaDeDesfazer'), fatiar('abrirFolhaDoAutor'),
     'return { abrirFolhaDoAutor };'].join('\n'))(...chaves.map((k) => deps[k]));
  abrirFolhaDoAutor(fila[0]);
  return els.get('autorCorpo').innerHTML;
}

test('A10: a folha do autor diz o que o toque em "Rejeitar os N" faz — com e sem a janela do Desfazer', () => {
  const comJanela = montarFolha({ undoEnabled: true });
  assert.ok(comJanela.includes('autor.sheet.rejeitar.desc<'), 'com o Desfazer ligado, a linha segue dizendo "começa ao tocar"');
  assert.ok(comJanela.includes('autor.sheet.aviso<'), 'com o Desfazer ligado, o aviso segue dizendo "tocar já escreve no Waze"');
  assert.ok(!comJanela.includes('SemDesfazer'), 'com o Desfazer ligado, a folha usa a frase de quem não tem a janela');
  // Desligado E com a cota: o lote sai na hora.
  const semJanela = montarFolha({ undoEnabled: false, cotaPassada: true });
  assert.ok(semJanela.includes('autor.sheet.rejeitar.descSemDesfazer<'), 'sem a janela, a linha promete o Desfazer');
  assert.ok(semJanela.includes('autor.sheet.avisoSemDesfazer<'), 'sem a janela, o aviso promete o Desfazer');
  // CONTROLE: desligado SEM a cota o gate mantém a janela (é o `scheduleAction`).
  const gate = montarFolha({ undoEnabled: false, cotaPassada: false });
  assert.ok(!gate.includes('SemDesfazer'), 'o gate de experiência mantém a janela, e a folha disse que não');
});

// ── A fonte única: o que DIZ e o que FAZ perguntam a mesma coisa ─────────────
test('a pergunta "sai na hora?" dos textos é a MESMA do scheduleAction', () => {
  const helper = /return ([^;]+);/.exec(fatiar('semJanelaDeDesfazer'));
  assert.ok(helper, 'CONTROLE: o semJanelaDeDesfazer não devolve uma expressão');
  // A condição que manda executar SEM janela: o `if` cujo corpo roda o executor e sai.
  const agenda = /if \(([^\n]+)\) \{\s*executed = true;\s*runExecutor\(\);\s*return;/.exec(fatiar('scheduleAction'));
  assert.ok(agenda, 'CONTROLE: o scheduleAction mudou de forma — o guard ficaria cego');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(norm(agenda[1]), norm(helper[1]),
    'o envio e os textos decidem a janela do Desfazer por regras diferentes — um deles mente');
});

test('as frases: com a janela, a duração vem do {undoSeg}; sem ela, nenhuma promete o Desfazer', () => {
  const D = dicionario();
  const PARES = [
    ['treino.fim.body', 'treino.fim.bodySemDesfazer'],
    ['autor.sheet.rejeitar.desc', 'autor.sheet.rejeitar.descSemDesfazer'],
    ['autor.sheet.aviso', 'autor.sheet.avisoSemDesfazer'],
  ];
  for (const lang of Object.keys(D)) {
    for (const [com, sem] of PARES) {
      assert.ok(D[lang][com] && D[lang][sem], `${lang}: falta ${com} ou ${sem}`);
      assert.ok(D[lang][com].includes('{undoSeg}'), `${lang}/${com}: a frase de quem tem a janela não diz quanto ela dura`);
      assert.ok(!D[lang][sem].includes('{undoSeg}'), `${lang}/${sem}: a frase de quem NÃO tem a janela promete segundos`);
      assert.ok(!/\d\s*s\b/.test(D[lang][com].split('{undoSeg}').join('§')), `${lang}/${com}: duração escrita à mão`);
    }
    // O fim do treino fala do Desfazer pelo nome da tela, nos dois estados.
    for (const k of ['treino.fim.body', 'treino.fim.bodySemDesfazer', 'autor.sheet.aviso']) {
      assert.ok(D[lang][k].includes(D[lang]['undo.button']), `${lang}/${k}: não usa o nome da tela "${D[lang]['undo.button']}"`);
    }
  }
});
