// O foco que uma escrita da foto ampliada tira debaixo do teclado DEPOIS de a
// foto fechar (auditoria de 2026-09-30, R5-3-07 — a família do C10). MEDIDO nos
// dois motores, com o foco no <body> nos três caminhos:
//
//  1 · aprovar e fechar antes da resposta (o caminho padrão com o Desfazer, que
//      fechar despacha): o fechar devolve o foco à foto do card (L12), a
//      aprovação pousa e o card ANDA (`tirarAprovadoDaFila`);
//  2 · excluir sem o Desfazer e fechar com a escrita no ar: ela pousa e o card é
//      REDESENHADO (`showCurrentPlace`);
//  3 · o Desfazer de uma escrita da foto usado na tela do card — o Enter no
//      "Desfazer" (o banner some com o foco nele) e a tecla z (o `devolverFoto`
//      redesenha o card).
//
// As funções rodam DE VERDADE, fatiadas do app.js, com o documento de mentira.
// O que só o navegador responde — o foco pousando de fato, nos dois motores —
// foi medido com os roteiros da auditoria (o relatório do lote 9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const SEM = APP.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = SEM.indexOf('(', m.index);
  for (let j = i; j < SEM.length; j++) {
    if (SEM[j] === '(') par++;
    else if (SEM[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  let prof = 0;
  for (let j = SEM.indexOf('{', i); j < SEM.length; j++) {
    if (SEM[j] === '{') prof++;
    else if (SEM[j] === '}' && --prof === 0) {
      const corpo = SEM.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}

// A tela de mentira: o card da frente (foto, mapa, ✕), o cabeçalho, a Ajuda, o
// banner do Desfazer e as camadas. Trocar o card é como o DOM troca: o de antes
// sai da página, e o foco que estava nele cai no <body>.
function tela({ comFoto = true } = {}) {
  const doc = { body: { nome: 'body' } };
  doc.activeElement = doc.body;
  const camadas = { modal: false, foto: false, mapa: false };
  const el = (nome, { visivel = true } = {}) => {
    const e = { nome, isConnected: true, disabled: false, closest: () => null };
    e.getClientRects = () => (visivel && e.isConnected ? [1] : []);
    e.focus = () => { if (e.isConnected && visivel) doc.activeElement = e; };
    return e;
  };
  const novoCard = (opcoes = {}) => {
    const filhos = { '.card-image': el('foto do card', { visivel: opcoes.comFoto !== false }), '.card-map': el('mapa do card'),
      '.card-btn-reject': el('✕ do card') };
    return { filhos, contains: (x) => Object.values(filhos).includes(x), querySelector: (s) => filhos[s] || null };
  };
  let card = novoCard({ comFoto });
  const trocarCard = (novo) => {
    for (const f of Object.values(card.filhos)) f.isConnected = false;
    if (card.contains(doc.activeElement)) doc.activeElement = doc.body;
    card = novo;
  };
  const ajuda = el('ⓘ Ajuda');
  const cabecalho = el('↻ do cabeçalho');
  const undoBtn = el('Desfazer');
  let aoClicar = null;
  undoBtn.addEventListener = (tipo, fn) => { if (tipo === 'click') aoClicar = fn; };
  doc.querySelector = (s) => (s === '#cardStack .place-card:not(.card-fundo)' ? card : null);
  doc.getElementById = (id) => ({
    helpBtn: ajuda, undoBtn, undoContainer: { appendChild() {} },
    filtersModal: { classList: { contains: (c) => (c === 'hidden' ? !camadas.modal : false) } },
  })[id] || null;
  doc.createElement = () => ({});
  const deps = {
    document: doc, MODAL_IDS: ['filtersModal'],
    Lightbox: { isOpen: () => camadas.foto }, MapaLightbox: { isOpen: () => camadas.mapa },
    removeUndoBanner: () => {}, escapeHtml: (s) => s, t: (k) => k, UNDO_WINDOW_MS: 3000,
  };
  const nomes = ['dentroDeCamada', 'focavelNaTela', 'devolverFoco', 'topOpenModal', 'cardDaFrente',
    'devolverFocoDaAmpliacao', 'focoPerdido', 'semCamadaAberta', 'mantendoFocoNoCard', 'veioDoTeclado', 'mostrarDesfazer'];
  const app = new Function(...Object.keys(deps), 'let ultimoFocoForaDasCamadas = null;\n'
    + nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(...Object.values(deps));
  // O clique no "Desfazer" como o navegador o entrega: o Enter no botão focado
  // chega com `detail` 0; o mouse e o dedo, com 1. O banner some com o foco nele.
  const clicarDesfazer = ({ detail, aoDesfazer }) => {
    app.mostrarDesfazer('undo.photoDeleted', () => {
      undoBtn.isConnected = false;
      if (doc.activeElement === undoBtn) doc.activeElement = doc.body;
      aoDesfazer();
    });
    undoBtn.isConnected = true;
    aoClicar({ detail, currentTarget: undoBtn });
  };
  return { app, doc, camadas, card: () => card, novoCard, trocarCard, ajuda, cabecalho, undoBtn, clicarDesfazer };
}

const nome = (doc) => doc.activeElement && doc.activeElement.nome;

test('R5-3-07 o card trocado (ou redesenhado) debaixo do foco: o foco vai à foto do card que ficou, não ao <body>', () => {
  const m = tela();
  m.card().filhos['.card-image'].focus();          // o fechar da foto o pôs aqui (L12)
  const novo = m.novoCard();
  m.app.mantendoFocoNoCard(() => m.trocarCard(novo));
  assert.equal(m.doc.activeElement, novo.filhos['.card-image'],
    `o foco caiu em ${nome(m.doc)} quando a escrita da foto trocou o card — quem usa o teclado recomeça do topo da página`);
  // Do ✕ do card também (o redesenho leva qualquer controle focado dele).
  const r = tela();
  r.card().filhos['.card-btn-reject'].focus();
  const outro = r.novoCard();
  r.app.mantendoFocoNoCard(() => r.trocarCard(outro));
  assert.equal(r.doc.activeElement, outro.filhos['.card-image'], `o foco caiu em ${nome(r.doc)}`);
  // Sem a foto (o card que abre no mapa), o mapa.
  const s = tela();
  s.card().filhos['.card-image'].focus();
  const semFoto = s.novoCard({ comFoto: false });
  s.app.mantendoFocoNoCard(() => s.trocarCard(semFoto));
  assert.equal(s.doc.activeElement, semFoto.filhos['.card-map'], `sem a foto, o foco caiu em ${nome(s.doc)}`);
  // A fila acabou (o "Tudo limpo!"): sem card, o lugar de sempre (`devolverFoco`).
  const f = tela();
  f.card().filhos['.card-image'].focus();
  f.app.mantendoFocoNoCard(() => f.trocarCard(null));
  assert.equal(f.doc.activeElement, f.ajuda, `com a fila no fim, o foco caiu em ${nome(f.doc)}`);
});

test('R5-3-07 CONTROLES: o foco que a pessoa levou pra FORA do card, o que sobreviveu e o de camada aberta ficam onde estão', () => {
  // A pessoa foi ao cabeçalho: o redesenho do card não a puxa de volta.
  const fora = tela();
  fora.cabecalho.focus();
  fora.app.mantendoFocoNoCard(() => fora.trocarCard(fora.novoCard()));
  assert.equal(fora.doc.activeElement, fora.cabecalho, 'o foco foi arrancado do cabeçalho por um redesenho do card');
  // Quem usa o dedo ou o mouse tem o foco no <body>: o redesenho não o põe no card.
  const dedo = tela();
  dedo.app.mantendoFocoNoCard(() => dedo.trocarCard(dedo.novoCard()));
  assert.equal(dedo.doc.activeElement, dedo.doc.body, 'o redesenho pôs no card o foco de quem não o tinha lá (o dedo, o mouse)');
  // O controle focado sobreviveu ao redesenho: nada muda.
  const vivo = tela();
  const foto = vivo.card().filhos['.card-image'];
  foto.focus();
  vivo.app.mantendoFocoNoCard(() => {});
  assert.equal(vivo.doc.activeElement, foto);
  // Uma camada abriu por cima (aria-modal): o card de TRÁS não recebe o foco.
  for (const camada of ['modal', 'foto', 'mapa']) {
    const c = tela();
    c.card().filhos['.card-image'].focus();
    c.app.mantendoFocoNoCard(() => { c.trocarCard(c.novoCard()); c.camadas[camada] = true; });
    assert.equal(c.doc.activeElement, c.doc.body, `com a camada "${camada}" aberta, o foco foi pro card por trás dela`);
  }
});

test('R5-3-07 Enter no "Desfazer" de uma escrita da foto, na tela do card: o foco vai à foto do card, não ao <body>', () => {
  const m = tela();
  m.undoBtn.isConnected = true;
  m.undoBtn.focus();
  const novo = m.novoCard();
  m.clicarDesfazer({ detail: 0, aoDesfazer: () => m.trocarCard(novo) });   // o `devolverFoto` redesenha
  assert.equal(m.doc.activeElement, novo.filhos['.card-image'],
    `o Desfazer pelo teclado largou o foco em ${nome(m.doc)} (o banner sumiu com o foco nele)`);
  // O da aprovação e o da renomeação não redesenham o card: o foco vai à foto dele.
  const a = tela();
  a.undoBtn.isConnected = true;
  a.undoBtn.focus();
  a.clicarDesfazer({ detail: 0, aoDesfazer: () => {} });
  assert.equal(a.doc.activeElement, a.card().filhos['.card-image'], `o foco caiu em ${nome(a.doc)}`);
  // CONTROLE: o mouse e o dedo (detail 1) não têm o foco movido — a regra do C10.
  const mouse = tela();
  mouse.undoBtn.isConnected = true;
  mouse.undoBtn.focus();
  mouse.clicarDesfazer({ detail: 1, aoDesfazer: () => mouse.trocarCard(mouse.novoCard()) });
  assert.equal(mouse.doc.activeElement, mouse.doc.body, 'o clique do mouse/dedo pôs o foco no card');
  // CONTROLE: com a foto ou o mapa abertos quem segura o foco é a camada
  // (`removeUndoBanner`): o card por trás dela não o recebe.
  for (const camada of ['foto', 'mapa']) {
    const c = tela();
    c.camadas[camada] = true;
    c.undoBtn.isConnected = true;
    c.undoBtn.focus();
    c.clicarDesfazer({ detail: 0, aoDesfazer: () => {} });
    assert.equal(c.doc.activeElement, c.doc.body, `com a camada "${camada}" aberta, o foco foi pro card por trás dela`);
  }
});

// Os caminhos que trocam ou redesenham o card passam pelo `mantendoFocoNoCard`
// — as funções de verdade, com quem guarda o foco anotando a ordem.
test('R5-3-07 a aprovação que anda a fila e a foto que volta passam pelo foco do card', () => {
  const ordem = [];
  const guarda = (redesenhar) => { ordem.push('guarda'); redesenhar(); };
  const A = { venueID: 'vA', updateRequestID: 'uA' }, B = { venueID: 'vB', updateRequestID: 'uB' };
  const tirar = new Function('AppState', 'advanceQueue', 'updatePendingCount', 'aoMudarAFilaPorBaixo', 'mantendoFocoNoCard',
    fatiar('tirarAprovadoDaFila') + '\nreturn tirarAprovadoDaFila;');
  tirar({ queue: [A, B], currentPlace: A }, () => ordem.push('andou'), () => {}, () => {}, guarda)(A);
  assert.deepEqual(ordem, ['guarda', 'andou'], 'a aprovação pousada anda a fila por fora do foco do card (caminho 1)');
  // CONTROLE: o aprovado que não está na frente sai da fila sem mexer no card.
  ordem.length = 0;
  const Q = { queue: [A, B], currentPlace: A };
  tirar(Q, () => ordem.push('andou'), () => {}, () => {}, guarda)(B);
  assert.deepEqual(ordem, []);
  assert.deepEqual(Q.queue, [A]);
  // A foto que volta (o Desfazer pela tecla z, a falha): o card é redesenhado.
  ordem.length = 0;
  const P = { imageUrls: [], approvedImageIds: [] };
  const devolver = new Function('Lightbox', 'AppState', 'showCurrentPlace', 'mantendoFocoNoCard',
    fatiar('devolverFoto') + '\nreturn devolverFoto;')(
    { place: null }, { currentPlace: P }, () => ordem.push('redesenhou'), guarda);
  devolver({ id: 'f1', place: P, idx: 0, url: 'https://venue-image.waze.com/f1.jpg' });
  assert.deepEqual(ordem, ['guarda', 'redesenhou'], 'a foto que volta redesenha o card por fora do foco (caminho 3, a tecla z)');
});
