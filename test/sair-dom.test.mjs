// O "Sair" é "limpar de tudo" — e isso vale pro DOM também (auditoria de
// 2026-10-02, R6-1-05).
//
// O lote 9 limpou a região viva do card (`#cardLiveRegion`), mas o resto do
// dado de TERCEIRO seguia no DOM da tela de entrada depois do "Sair" — MEDIDO
// no Chromium, varrendo a página por uma marca posta nos pedidos de mentira:
// a lista de autores rejeitados do Histórico (nome e `creatorId`, o mesmo dado
// que `waze_places_autores` apaga), a folha do autor (o nome dele), a última
// foto ampliada (o nome do local na pílula, o de quem mandou a foto na
// contagem e no `alt`) e o perfil de quem o portão recusou no "Acesso restrito".
// Na mesma página, a próxima conta que ligasse o modo dev levava tudo isso no
// relatório.
//
// O conserto mora nos caminhos de FECHAR (a limpeza de cada modal, que vale pro
// botão, o Esc, o fundo, o voltar e o modal que abre por cima; o `close` da
// foto ampliada) e na tela de entrada (a lista de autores, que a folha do autor
// redesenha com o painel fechado). Este teste roda as funções DE VERDADE,
// fatiadas do app.js, num DOM de mentira, e VARRE o DOM inteiro pela marca —
// com o CONTROLE de que a varredura a enxerga antes de fechar.
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
  assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
function fatiarConst(nome) {
  const m = new RegExp('^const ' + nome + ' = ', 'm').exec(APP_SEM);
  assert.ok(m, `const ${nome} sumiu do app.js`);
  return APP_SEM.slice(m.index, fechar(APP_SEM, m.index)) + ';';
}
// Um MÉTODO do objeto `Lightbox`, como texto de método.
function metodoDoLightbox(nome) {
  const ini = APP_SEM.indexOf('const Lightbox = {');
  assert.ok(ini >= 0, 'o objeto Lightbox sumiu do app.js');
  const fim = fechar(APP_SEM, ini);
  const m = new RegExp('^    ' + nome + '\\(', 'm').exec(APP_SEM.slice(ini, fim));
  assert.ok(m, `Lightbox.${nome} sumiu`);
  const i = ini + m.index;
  let par = 0, k = APP_SEM.indexOf('(', i);
  for (let j = k; j < fim; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { k = j + 1; break; } }
  }
  return APP_SEM.slice(i, fechar(APP_SEM, k)).trim();
}

const MARCA = 'PRIV';

// Um elemento de mentira: texto, HTML, classes e ATRIBUTOS (o `alt` e o
// `title` andam com o atributo, como no DOM).
function elemento(id, { oculto = false } = {}) {
  const classes = new Set(oculto ? ['hidden'] : []);
  const attrs = {};
  const el = {
    id, textContent: '', innerHTML: '', style: {}, isConnected: true, disabled: false,
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)), remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; if (on) classes.add(c); else classes.delete(c); return on; },
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    hasAttribute(k) { return k in attrs; },
    getClientRects: () => (classes.has('hidden') ? [] : [{}]),
    focus() {},
    closest: () => null,
    querySelector: () => null,
    attrs,
  };
  for (const a of ['alt', 'title']) {
    Object.defineProperty(el, a, { get: () => (a in attrs ? attrs[a] : ''), set: (v) => { attrs[a] = String(v); }, enumerable: true });
  }
  return el;
}

// Os nós que o app ESCREVE com dado de terceiro, e os modais em volta deles.
const NOS = ['autoresBody', 'autorTitle', 'autorCorpo', 'accessDeniedProfile', 'accessDeniedMessage',
  'lightboxImage', 'lightboxCount', 'lightboxNomeTxt', 'lightboxAnuncio', 'cardLiveRegion'];
const MODAIS = ['filtersModal', 'autorModal', 'accessDeniedModal', 'helpModal', 'logoutModal'];

function montar() {
  const els = {};
  for (const id of NOS) els[id] = elemento(id);
  for (const id of MODAIS) els[id] = elemento(id, { oculto: true });
  for (const id of ['imageLightbox', 'authScreen', 'appScreen', 'filtersBtn', 'refreshBtn', 'userProfileBadge', 'brandTitle', 'helpBtn']) {
    els[id] = elemento(id);
  }
  const body = { id: 'BODY', style: {} };
  const document = {
    body, activeElement: body,
    documentElement: { classList: { remove() {}, add() {} } },
    getElementById: (id) => els[id] || null,
    querySelectorAll: () => [],
  };
  const AppState = { authenticated: true, profile: { id: 1 } };
  const deps = {
    document, AppState, window: { Presenca: { desligar() {}, esquecerAberta() {}, esquecerLista() {} } },
    dfato() {}, URL: { revokeObjectURL() {} },
    CamadaVoltar: { empilhar() {}, consumir() {} },
    mostrarControlesDeSessao() {}, limparCabecalhoDoPerfil() {},
    pararTickerPareamento() {}, limparQrPareamento() {}, mostrarInstrucoesDoPareamento() {},
    fecharEdicaoNome() {}, avancarSeAprovado() {}, devolverFocoDaAmpliacao() {},
    Treino: { sair() {} },
    aoFecharCamada() {},   // o "Como funciona" adiado (R7-7-01), em test/como-funciona
  };
  const MODAL_IDS = MODAIS;
  const corpo = [
    'let autoresExpandido = false, escadaAberta = false, conquistaTocada = null, novasDestaAbertura = null;',
    'let resumoAtual = null, lastFocusedBeforeModal = null, ultimoFocoForaDasCamadas = null;',
    'let pairQrVenceEm = 0, aberturaDoPareamento = 0;',
    `const MODAL_IDS = ${JSON.stringify(MODAL_IDS)};`,
    // A foto ampliada: o `close` DE VERDADE num objeto com o que ele lê.
    'const Lightbox = { aberto: true, _quemAbriu: null, isOpen() { return this.aberto; }, resetZoom() {},',
    '  ' + metodoDoLightbox('close').replace(/^close\(/, 'fecharDeVerdade(') + ' };',
    'Lightbox.close = function (o) { const r = this.fecharDeVerdade(o); this.aberto = false; return r; };',
    fatiar('openModal'), fatiar('closeModal'), fatiar('topOpenModal'), fatiar('devolverFoco'),
    fatiar('focavelNaTela'), fatiar('dentroDeCamada'), fatiar('esvaziarListaDeAutores'), fatiar('showAuthScreen'),
    // A região viva da foto ampliada (lote 10, R6-3-08): o `close` a esvazia, e
    // ela pode dizer o nome do local ("Renomeado para …").
    fatiar('anunciarNoLightbox'),
    fatiarConst('LIMPEZA_AO_FECHAR'),
    'return { openModal, closeModal, showAuthScreen, Lightbox };',
  ].join('\n');
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, corpo)(...chaves.map((k) => deps[k]));
  // O que os desenhos do app deixam nesses nós (com a marca no lugar do dado de
  // terceiro): a lista de autores, a folha do autor, o perfil recusado, a foto
  // ampliada (contagem com o autor, nome do local na pílula, o `alt`).
  const preencher = () => {
    els.autoresBody.innerHTML = `<span>autor${MARCA}repetido</span><button data-autor="7777" aria-label="Esquecer autor${MARCA}repetido"></button>`;
    els.autorTitle.textContent = `autor${MARCA}repetido`;
    els.autorCorpo.innerHTML = `<p>Você rejeitou 2 pedidos de autor${MARCA}repetido</p>`;
    els.accessDeniedProfile.innerHTML = `<strong>editor${MARCA}negado</strong> · L1 · não-AM`;
    els.accessDeniedProfile.classList.remove('hidden');
    els.lightboxImage.setAttribute('src', `https://venue-image.waze.com/thumbs/thumb700_${MARCA}.jpg`);
    els.lightboxImage.alt = `Padaria${MARCA}, foto 1 de 1`;
    els.lightboxCount.textContent = `autor${MARCA}foto · há 2 dias`;
    els.lightboxCount.title = '01/10/2026';
    els.lightboxNomeTxt.textContent = `Padaria${MARCA}`;
    els.lightboxAnuncio.textContent = `Renomeado para “Padaria${MARCA}”`;
  };
  // A VARREDURA: texto, HTML e todo atributo de todo nó, pela marca.
  const varrer = () => Object.values(els).flatMap((el) => {
    const achou = [];
    for (const [onde, v] of [['texto', el.textContent], ['html', el.innerHTML], ...Object.entries(el.attrs)]) {
      if (String(v || '').includes(MARCA)) achou.push(`${el.id}:${onde}`);
    }
    return achou;
  });
  return { app, els, preencher, varrer, AppState };
}

test('R6-1-05: depois de fechar (por qualquer caminho) e do "Sair", o DOM não guarda dado de terceiro', () => {
  const m = montar();
  m.preencher();
  // CONTROLE: a varredura ENXERGA o dado de terceiro antes — sem isto, "nada
  // achado" passaria com o instrumento cego.
  const antes = m.varrer();
  for (const no of ['autoresBody', 'autorTitle', 'autorCorpo', 'accessDeniedProfile', 'lightboxImage', 'lightboxCount', 'lightboxNomeTxt']) {
    assert.ok(antes.some((x) => x.startsWith(no + ':')), `CONTROLE: a varredura não viu o dado de terceiro no #${no} — ela está cega`);
  }
  // A pessoa usou tudo e fechou cada camada (o botão, o Esc, o fundo e o voltar
  // passam pelo `closeModal`; a foto, pelo `close` dela) — e deu "Sair".
  for (const id of ['filtersModal', 'autorModal', 'accessDeniedModal']) {
    m.els[id].classList.remove('hidden');
    m.app.closeModal(id);
  }
  m.app.Lightbox.close();
  // Fechar já limpa (é o caminho que vale pros quatro jeitos de fechar), antes
  // de a tela de entrada aparecer.
  assert.deepEqual(m.varrer(), [], 'DEFEITO: a camada FECHADA seguiu com dado de terceiro no DOM');
  m.app.showAuthScreen();
  assert.deepEqual(m.varrer(), [], 'DEFEITO: depois do "Sair", o DOM ainda guarda dado de terceiro');
  assert.ok(m.els.accessDeniedProfile.classList.contains('hidden'), 'o perfil recusado vazio ficou visível no diálogo');
  assert.ok(m.els.lightboxCount.classList.contains('hidden'), 'a contagem vazia da foto ficou visível');
});

test('R6-1-05: o modal escondido por OUTRO que abre por cima (a Ajuda, de onde sai o "Sair") também é limpo', () => {
  const m = montar();
  m.preencher();
  // A folha do autor aberta; a pessoa abre a Ajuda (o `openModal` esconde a folha com a limpeza dela).
  m.els.autorModal.classList.remove('hidden');
  m.app.openModal('helpModal');
  assert.ok(m.els.autorModal.classList.contains('hidden'), 'CONTROLE: a Ajuda não escondeu a folha do autor');
  const sobrou = m.varrer().filter((x) => /^autor(Title|Corpo):/.test(x));
  assert.deepEqual(sobrou, [], 'a folha do autor escondida pela Ajuda guardou o nome do autor');
});

test('R6-1-05: a lista de autores redesenhada com o painel FECHADO sai na tela de entrada', () => {
  // A folha do autor (o interruptor, o "Esquecer") redesenha o Histórico mesmo
  // com os Filtros fechados — depois de a limpeza do fechamento o ter esvaziado.
  const m = montar();
  m.els.autoresBody.innerHTML = `<span>autor${MARCA}</span>`;
  m.app.showAuthScreen();
  assert.equal(m.els.autoresBody.innerHTML, '', 'DEFEITO: a lista de autores ficou no DOM da tela de entrada');
  // CONTROLE: a tela de entrada limpa também a região viva do card (lote 9) — o
  // harness roda a função de verdade.
  m.els.cardLiveRegion.textContent = `Novo pedido: Padaria${MARCA}`;
  m.app.showAuthScreen();
  assert.equal(m.els.cardLiveRegion.textContent, '');
});
