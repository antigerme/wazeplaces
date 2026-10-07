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
// sai da página, e o foco que estava nele cai no <body>. Os painéis do fim da
// fila (`noMoreCards`, `loadErrorState`) nascem escondidos, como no HTML, e o
// botão de cada um só está na tela com o painel à mostra (`m.mostrarPainel`).
function tela({ comFoto = true } = {}) {
  const doc = { body: { nome: 'body' } };
  doc.activeElement = doc.body;
  const camadas = { modal: false, foto: false, mapa: false };
  // `sel`: o seletor que o elemento CASA (`matches`), como os botões do card.
  const el = (nome, { visivel = true, sel = null } = {}) => {
    const e = { nome, isConnected: true, disabled: false, closest: () => null };
    e.getClientRects = () => (visivel && e.isConnected ? [1] : []);
    e.focus = () => { if (e.isConnected && visivel && !e.disabled) doc.activeElement = e; };
    e.matches = (s) => !!sel && s.split(',').map((x) => x.trim()).includes(sel);
    return e;
  };
  // `travados`: os botões que o card novo traz `disabled` (o ✕ e o ✓ do card
  // "sem foto", ou os três na janela do Desfazer).
  const novoCard = (opcoes = {}) => {
    const botao = (nome, sel) => { const b = el(nome, { sel }); b.disabled = (opcoes.travados || []).includes(sel); return b; };
    const filhos = { '.card-image': el('foto do card', { visivel: opcoes.comFoto !== false }), '.card-map': el('mapa do card'),
      '.card-btn-reject': botao('✕ do card', '.card-btn-reject'), '.card-btn-skip': botao('↑ do card', '.card-btn-skip'),
      '.card-btn-read': botao('✓ do card', '.card-btn-read') };
    return { filhos, contains: (x) => Object.values(filhos).includes(x), querySelector: (s) => filhos[s] || null };
  };
  let card = novoCard({ comFoto });
  // Sem card na frente (a fila acabou, a busca corre), o próximo só CHEGA.
  const trocarCard = (novo) => {
    if (card) {
      for (const f of Object.values(card.filhos)) f.isConnected = false;
      if (card.contains(doc.activeElement)) doc.activeElement = doc.body;
    }
    card = novo;
  };
  const ajuda = el('ⓘ Ajuda');
  const cabecalho = el('↻ do cabeçalho');
  const undoBtn = el('Desfazer');
  let aoClicar = null;
  undoBtn.addEventListener = (tipo, fn) => { if (tipo === 'click') aoClicar = fn; };
  const paineis = { noMoreCards: false, loadErrorState: false };   // à mostra?
  const painel = (id) => ({ classList: { contains: (c) => c === 'hidden' && !paineis[id] } });
  const botaoDoPainel = (nomeDele, id) => {
    const b = el(nomeDele);
    b.getClientRects = () => (paineis[id] && b.isConnected ? [1] : []);
    b.focus = () => { if (paineis[id]) doc.activeElement = b; };
    return b;
  };
  const reloadBtn = botaoDoPainel('Verificar novamente', 'noMoreCards');
  const retryLoadBtn = botaoDoPainel('Tentar de novo', 'loadErrorState');
  doc.querySelector = (s) => (s === '#cardStack .place-card:not(.card-fundo)' ? card : null);
  doc.getElementById = (id) => ({
    helpBtn: ajuda, undoBtn, undoContainer: { appendChild() {} },
    filtersModal: { classList: { contains: (c) => (c === 'hidden' ? !camadas.modal : false) } },
    noMoreCards: painel('noMoreCards'), loadErrorState: painel('loadErrorState'), reloadBtn, retryLoadBtn,
  })[id] || null;
  doc.createElement = () => ({});
  // A sessão de pé (o foco prometido ao card que chegar só vale com ela, R9-3-02).
  const AppState = { authenticated: true };
  const deps = {
    document: doc, MODAL_IDS: ['filtersModal'], AppState, acoesTravadas: () => false,
    Lightbox: { isOpen: () => camadas.foto }, MapaLightbox: { isOpen: () => camadas.mapa },
    removeUndoBanner: () => {}, escapeHtml: (s) => s, t: (k) => k, UNDO_WINDOW_MS: 3000,
  };
  // O `aplicarFocoDoTeclado` (R7-2-06) de verdade: é ele que pousa o foco que o
  // fechar de uma ampliação PROMETE quando não há card nem painel (R9-3-02).
  const nomes = ['dentroDeCamada', 'focavelNaTela', 'devolverFoco', 'topOpenModal', 'cardDaFrente',
    'devolverFocoDaAmpliacao', 'botaoDoPainelDoFim', 'focoPerdido', 'semCamadaAberta', 'mantendoFocoNoCard',
    'veioDoTeclado', 'mostrarDesfazer', 'aplicarFocoDoTeclado'];
  const app = new Function(...Object.keys(deps), 'let ultimoFocoForaDasCamadas = null;\nlet focoDoTeclado = null;\n'
    + nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')}, promessa: () => focoDoTeclado };`)(...Object.values(deps));
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
  const mostrarPainel = (id) => { paineis[id] = true; };
  return { app, doc, camadas, card: () => card, novoCard, trocarCard, ajuda, cabecalho, undoBtn, clicarDesfazer,
    mostrarPainel, reloadBtn, retryLoadBtn, AppState };
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
  // A fila acabou e o painel do fim ainda não veio (a busca corre): sem card nem
  // painel, o foco fica PROMETIDO a quem chegar, nunca no ⓘ do topo (R9-3-02,
  // abaixo). Com o painel, o botão dele (R8-3-06, logo abaixo).
  const f = tela();
  f.card().filhos['.card-image'].focus();
  f.app.mantendoFocoNoCard(() => f.trocarCard(null));
  assert.notEqual(f.doc.activeElement, f.ajuda, 'com a fila no fim e sem painel, o foco foi pro ⓘ do topo (R9-3-02)');
  assert.deepEqual(f.app.promessa(), ['.card-image', '.card-map'], 'com a fila no fim e sem painel, o foco não ficou prometido');
});

// ── R8-3-06: a fila que ACABA com a foto ampliada aberta ──────────────────────
// (auditoria de 2026-10-03). Aprovar a foto do ÚLTIMO pedido e fechar a foto: a
// aprovação pousada anda a fila ao fechar (`avancarSeAprovado`), a fila acaba no
// "Tudo limpo!" e o foco ia pro ⓘ da Ajuda, no topo da página — MEDIDO nos dois
// motores, enquanto o MESMO último pedido decidido pelo Enter no ✓ do card leva
// o foco ao "Verificar novamente" (R7-2-06). O fechar (`devolverFocoDaAmpliacao`,
// de verdade) vai ao botão do painel que tomou o lugar do card.
test('R8-3-06 a fila que acaba ao fechar a foto: o foco vai ao "Verificar novamente" (ou ao "Tentar de novo" na falha), não ao ⓘ do topo', () => {
  for (const [painel, botao] of [['noMoreCards', 'reloadBtn'], ['loadErrorState', 'retryLoadBtn']]) {
    const m = tela();
    const fotoDoCard = m.card().filhos['.card-image'];   // quem abriu a foto
    m.trocarCard(null);                                   // o fechar anda a fila: ela acaba…
    m.mostrarPainel(painel);                              // …e o painel toma o lugar do card
    m.app.devolverFocoDaAmpliacao(fotoDoCard, ['.card-image', '.card-map']);
    assert.equal(m.doc.activeElement, m[botao],
      `${painel}: DEFEITO — a fila acabou ao fechar a foto e o foco foi parar em ${nome(m.doc)}, não no botão do painel`);
  }
  // A escrita que pousa com a foto JÁ fechada e o foco no card (R5-3-07): o mesmo.
  const p = tela();
  p.card().filhos['.card-image'].focus();
  p.app.mantendoFocoNoCard(() => { p.trocarCard(null); p.mostrarPainel('noMoreCards'); });
  assert.equal(p.doc.activeElement, p.reloadBtn, `a aprovação que pousou com a foto fechada largou o foco em ${nome(p.doc)}`);
  // CONTROLE: com um card na frente, o foco vai a ele (o painel escondido não conta).
  const c = tela();
  const novo = c.novoCard();
  c.trocarCard(novo);
  c.app.devolverFocoDaAmpliacao(null, ['.card-image', '.card-map']);
  assert.equal(c.doc.activeElement, novo.filhos['.card-image'], `CONTROLE: com card na frente, o foco foi a ${nome(c.doc)}`);
  // CONTROLE: com um modal por cima, o foco é dele — nada se mexe.
  const md = tela();
  md.trocarCard(null);
  md.mostrarPainel('noMoreCards');
  md.camadas.modal = true;
  md.app.devolverFocoDaAmpliacao(null, ['.card-image', '.card-map']);
  assert.equal(md.doc.activeElement, md.doc.body, `CONTROLE: com um modal aberto, o foco foi a ${nome(md.doc)}`);
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

// ── R8-4-03: o redesenho do MESMO pedido devolve o foco ao MESMO botão ──────
// O card "sem foto" que o sinal de volta redesenha (`recuperarCardSemFoto`): o ↑
// era o único botão vivo, o teclado estava nele, e o foco caía no <body> (MEDIDO,
// r4 da auditoria: "foco antes: card-btn-skip · foco depois: BODY"). Com
// `mesmoBotao`, ele vai ao ↑ do card novo — travado, ao ✕ (que agora pode estar
// vivo) —, e só então à foto ou ao mapa.
test('R8-4-03 o card "sem foto" redesenhado com o sinal de volta: o foco do ↑ vai ao ↑ do card novo, não ao <body>', () => {
  const montar = () => {
    const m = tela({ comFoto: false });
    // O card sem a foto: ✕ e ✓ travados, o teclado no ↑.
    m.trocarCard(m.novoCard({ comFoto: false, travados: ['.card-btn-reject', '.card-btn-read'] }));
    m.card().filhos['.card-btn-skip'].focus();
    return m;
  };
  const m = montar();
  assert.equal(nome(m.doc), '↑ do card', 'PRÉ-CONDIÇÃO: o teclado está no ↑ do card sem a foto');
  const novo = m.novoCard({ comFoto: false });
  m.app.mantendoFocoNoCard(() => m.trocarCard(novo), { mesmoBotao: true });
  assert.equal(m.doc.activeElement, novo.filhos['.card-btn-skip'],
    `o redesenho do card largou o foco do ↑ em ${nome(m.doc)} — quem usa o teclado recomeça do topo da página`);
  // O ↑ do card novo travado: o ✕, que agora está vivo.
  const t = montar();
  const semPular = t.novoCard({ comFoto: false, travados: ['.card-btn-skip'] });
  t.app.mantendoFocoNoCard(() => t.trocarCard(semPular), { mesmoBotao: true });
  assert.equal(t.doc.activeElement, semPular.filhos['.card-btn-reject'], `com o ↑ travado, o foco caiu em ${nome(t.doc)}`);
  // Os três travados (a janela do Desfazer): a foto ou o mapa, como antes.
  const j = montar();
  const tudoTravado = j.novoCard({ comFoto: false, travados: ['.card-btn-reject', '.card-btn-skip', '.card-btn-read'] });
  j.app.mantendoFocoNoCard(() => j.trocarCard(tudoTravado), { mesmoBotao: true });
  assert.equal(j.doc.activeElement, tudoTravado.filhos['.card-map'], `com os três travados, o foco caiu em ${nome(j.doc)}`);
  // O ✓ focado vai ao ✓ (o equivalente é o MESMO botão, não sempre o ↑).
  const v = tela();
  v.card().filhos['.card-btn-read'].focus();
  const comLido = v.novoCard();
  v.app.mantendoFocoNoCard(() => v.trocarCard(comLido), { mesmoBotao: true });
  assert.equal(v.doc.activeElement, comLido.filhos['.card-btn-read'], `o foco do ✓ caiu em ${nome(v.doc)}`);
});

test('R8-4-03 CONTROLES: sem `mesmoBotao` (outro pedido na frente) a regra é a de antes; o foco fora dos botões segue a foto', () => {
  // As escritas do lightbox podem TROCAR o pedido da frente: lá o foco vai à foto ou ao mapa (R5-3-07).
  const c = tela();
  c.card().filhos['.card-btn-skip'].focus();
  const outro = c.novoCard();
  c.app.mantendoFocoNoCard(() => c.trocarCard(outro));
  assert.equal(c.doc.activeElement, outro.filhos['.card-image'], 'sem `mesmoBotao`, o foco mudou de regra');
  // Com `mesmoBotao`, o foco que estava na foto vai à foto (não é botão de ação).
  const f = tela();
  f.card().filhos['.card-image'].focus();
  const comFoto = f.novoCard();
  f.app.mantendoFocoNoCard(() => f.trocarCard(comFoto), { mesmoBotao: true });
  assert.equal(f.doc.activeElement, comFoto.filhos['.card-image']);
  // E o foco de FORA do card (ou o do dedo, no <body>) segue onde está.
  const fora = tela();
  fora.cabecalho.focus();
  fora.app.mantendoFocoNoCard(() => fora.trocarCard(fora.novoCard()), { mesmoBotao: true });
  assert.equal(fora.doc.activeElement, fora.cabecalho);
  const dedo = tela();
  dedo.app.mantendoFocoNoCard(() => dedo.trocarCard(dedo.novoCard()), { mesmoBotao: true });
  assert.equal(dedo.doc.activeElement, dedo.doc.body);
});

// A régua do "botão do painel do fim" é UMA: a do `aplicarFocoDoTeclado` sem
// card (R7-2-06), que leva ao painel o foco prometido ao teclado, e a do fechar
// da foto (R8-3-06, `botaoDoPainelDoFim`). As duas funções de VERDADE, no mesmo
// estado de tela: se uma ganhar um painel (ou trocar a ordem) e a outra não, o
// mesmo fim de fila leva o foco a lugares diferentes conforme o caminho.
test('R8-3-06 o fechar da foto e o foco prometido ao teclado escolhem o MESMO botão do painel do fim', () => {
  const estados = [[], ['noMoreCards'], ['loadErrorState'], ['noMoreCards', 'loadErrorState']];
  for (const visiveis of estados) {
    const m = tela();
    m.trocarCard(null);
    for (const id of visiveis) m.mostrarPainel(id);
    const doFechar = m.app.botaoDoPainelDoFim();
    const deps = { document: m.doc, acoesTravadas: () => false, topOpenModal: () => null, cardDaFrente: () => null,
      Lightbox: { isOpen: () => false }, MapaLightbox: { isOpen: () => false } };
    const aplicar = new Function(...Object.keys(deps), "let focoDoTeclado = '.card-btn-reject';\n"
      + [fatiar('focavelNaTela'), fatiar('aplicarFocoDoTeclado')].join('\n') + '\nreturn aplicarFocoDoTeclado;')(...Object.values(deps));
    m.doc.activeElement = m.doc.body;
    aplicar();
    const doTeclado = m.doc.activeElement === m.doc.body ? null : m.doc.activeElement;
    assert.equal(doFechar, doTeclado,
      `painéis ${JSON.stringify(visiveis)}: o fechar da foto escolhe ${doFechar && doFechar.nome} e o teclado ${doTeclado && doTeclado.nome}`);
  }
});

// ── R9-3-02: a fila acaba com a próxima página NO AR: o foco é PROMETIDO ──────
// (auditoria de 2026-10-06, o incompleto do R8-3-06). Aprovar a foto do ÚLTIMO
// pedido e fechar a foto com a busca da página seguinte ainda correndo: sem card
// e sem painel na tela (o esqueleto), o fechar levava o foco ao ⓘ da Ajuda, no
// topo da página, e ele FICAVA lá quando o "Tudo limpo!" ou o card novo chegavam
// — MEDIDO nos dois motores (r34 D1 e D2), enquanto o mesmo último pedido decidido
// pelo Enter no ✓ do card leva o foco ao painel ou ao card novo (o
// `aplicarFocoDoTeclado` espera, R7-2-06). O fechar promete o foco pela MESMA
// régua: o card que chegar recebe o foco no mesmo lugar (a foto ou o mapa dele),
// o painel, no botão dele. `devolverFocoDaAmpliacao` e `aplicarFocoDoTeclado`
// de verdade; quem os chama na chegada é o `renderCurrentCard`/`showNoPlaces`.
test('R9-3-02 fechar a foto sem card e sem painel (a busca no ar): o foco não vai ao ⓘ — o painel ou o card que chegar o recebe', () => {
  const fechar = (m, quem = m.card().filhos['.card-image'], noCard = ['.card-image', '.card-map']) => {
    m.trocarCard(null);                                   // o fechar anda a fila: ela acaba, sem painel (a busca corre)
    m.app.devolverFocoDaAmpliacao(quem, noCard);
  };
  // D1: a busca volta vazia — o painel "Tudo limpo!" chega e leva o foco.
  const d1 = tela();
  fechar(d1);
  assert.notEqual(d1.doc.activeElement, d1.ajuda,
    'DEFEITO: a fila acabou com a busca no ar e o fechar da foto levou o foco ao ⓘ do topo (e ele ficaria lá)');
  assert.deepEqual(d1.app.promessa(), ['.card-image', '.card-map'], 'DEFEITO: o foco não ficou prometido a quem chegar');
  d1.app.aplicarFocoDoTeclado();                          // antes de o painel chegar: espera
  assert.deepEqual(d1.app.promessa(), ['.card-image', '.card-map'], 'sem card nem painel, a promessa caiu antes da chegada');
  d1.mostrarPainel('noMoreCards');
  d1.app.aplicarFocoDoTeclado();                          // o `showNoPlaces`
  assert.equal(d1.doc.activeElement, d1.reloadBtn, `o "Tudo limpo!" chegou e o foco ficou em ${nome(d1.doc)}`);
  assert.equal(d1.app.promessa(), null, 'a promessa ficou pendurada depois de pousar');
  // A falha ao carregar: o "Tentar de novo".
  const fa = tela();
  fechar(fa);
  fa.mostrarPainel('loadErrorState');
  fa.app.aplicarFocoDoTeclado();
  assert.equal(fa.doc.activeElement, fa.retryLoadBtn, `a falha chegou e o foco ficou em ${nome(fa.doc)}`);
  // D2: a busca traz um pedido novo — o foco vai à foto do card que chegou.
  const d2 = tela();
  fechar(d2);
  const novo = d2.novoCard();
  d2.trocarCard(novo);
  d2.app.aplicarFocoDoTeclado();                          // o `renderCurrentCard`
  assert.equal(d2.doc.activeElement, novo.filhos['.card-image'], `o card novo chegou e o foco ficou em ${nome(d2.doc)}`);
  // O card que chega sem a foto (o que abre no mapa): o mapa.
  const sm = tela();
  fechar(sm);
  const semFoto = sm.novoCard({ comFoto: false });
  sm.trocarCard(semFoto);
  sm.app.aplicarFocoDoTeclado();
  assert.equal(sm.doc.activeElement, semFoto.filhos['.card-map'], `o card sem foto chegou e o foco ficou em ${nome(sm.doc)}`);
  // O fechar do MAPA promete o mapa primeiro (a régua dele).
  const mp = tela();
  fechar(mp, mp.card().filhos['.card-map'], ['.card-map', '.card-image']);
  const outro = mp.novoCard();
  mp.trocarCard(outro);
  mp.app.aplicarFocoDoTeclado();
  assert.equal(mp.doc.activeElement, outro.filhos['.card-map'], `o fechar do mapa: o card novo chegou e o foco ficou em ${nome(mp.doc)}`);
});

test('R9-3-02 CONTROLES: sem sessão vale a reserva; o lugar que a pessoa escolheu ganha; um modal por cima não é mexido', () => {
  // Sem sessão (a queda fecha as camadas): não vem card — a reserva, como antes.
  const s = tela();
  s.AppState.authenticated = false;
  s.trocarCard(null);
  s.app.devolverFocoDaAmpliacao(null, ['.card-image', '.card-map']);
  assert.equal(s.doc.activeElement, s.ajuda, `CONTROLE: sem sessão, o foco foi a ${nome(s.doc)} (a reserva é o ⓘ)`);
  assert.equal(s.app.promessa(), null, 'CONTROLE: sem sessão, o foco ficou prometido a um card que não vem');
  // A pessoa levou o foco a outro lugar (o Tab) antes de o card chegar: o lugar dela ganha.
  const t = tela();
  t.trocarCard(null);
  t.app.devolverFocoDaAmpliacao(null, ['.card-image', '.card-map']);
  t.cabecalho.focus();
  const novo = t.novoCard();
  t.trocarCard(novo);
  t.app.aplicarFocoDoTeclado();
  assert.equal(t.doc.activeElement, t.cabecalho, 'CONTROLE: o card que chegou arrancou o foco de onde a pessoa o pôs');
  assert.equal(t.app.promessa(), null, 'CONTROLE: a promessa sobreviveu à escolha da pessoa');
  // Um modal por cima: o foco é dele, e nada é prometido.
  const md = tela();
  md.trocarCard(null);
  md.camadas.modal = true;
  md.app.devolverFocoDaAmpliacao(null, ['.card-image', '.card-map']);
  assert.deepEqual([md.doc.activeElement, md.app.promessa()], [md.doc.body, null], 'CONTROLE: com um modal aberto, o fechar mexeu no foco');
  // CONTROLE: com o painel JÁ na tela (o R8-3-06), o foco vai a ele na hora, sem promessa.
  const p = tela();
  p.trocarCard(null);
  p.mostrarPainel('noMoreCards');
  p.app.devolverFocoDaAmpliacao(null, ['.card-image', '.card-map']);
  assert.deepEqual([p.doc.activeElement, p.app.promessa()], [p.reloadBtn, null], 'CONTROLE: com o painel na tela, o foco não foi ao botão dele na hora');
});

// ── R9-3-04: o redesenho do MESMO pedido pela escrita da foto mantém o ✕ ───────
// (auditoria de 2026-10-06). Sem o Desfazer, a exclusão no ar não trava o card:
// quem fecha a foto (Esc) e vai pelo Tab até o ✕ perdia o lugar quando a
// resposta chegava, pousando ou falhando — o card era redesenhado e o foco ia
// pra foto do card (`tabindex="-1"`, fora da ordem do Tab), e o Enter seguinte
// não fazia nada (MEDIDO nos dois motores, r39 A e B). O redesenho é do MESMO
// pedido: o foco num ✕ ↑ ✓ vai ao MESMO botão do card novo (o `mesmoBotao` do
// R8-4-03). O `devolverFoto` (a falha, e o Desfazer pela tecla z) e o
// `mantendoFocoNoCard` de verdade; o `.then` e o irmão em
// test/lightbox-escritas ("R5-3-07 excluir sem o Desfazer…").
test('R9-3-04 a foto que volta (a falha, o Desfazer) redesenha o MESMO pedido: o foco no ✕ ↑ ✓ fica no mesmo botão — na foto, fica na foto', () => {
  const devolverCom = (m, P, novo) => new Function('Lightbox', 'AppState', 'showCurrentPlace', 'mantendoFocoNoCard',
    fatiar('devolverFoto') + '\nreturn devolverFoto;')({ place: null }, { currentPlace: P }, () => m.trocarCard(novo), m.app.mantendoFocoNoCard);
  for (const sel of ['.card-btn-reject', '.card-btn-skip', '.card-btn-read']) {
    const m = tela();
    m.card().filhos[sel].focus();                       // o Tab levou o foco ao botão
    const P = { imageUrls: [], approvedImageIds: [] };
    const novo = m.novoCard();
    devolverCom(m, P, novo)({ id: 'f1', place: P, idx: 0, url: 'https://venue-image.waze.com/f1.jpg' });
    assert.equal(m.doc.activeElement, novo.filhos[sel],
      `DEFEITO: o redesenho do MESMO pedido levou o foco do ${sel} a ${nome(m.doc)} — o Enter seguinte não decide nada`);
  }
  // CONTROLE: o foco na foto do card (onde o Esc o pôs) fica na foto do card novo.
  const f = tela();
  f.card().filhos['.card-image'].focus();
  const P = { imageUrls: [], approvedImageIds: [] };
  const novo = f.novoCard();
  devolverCom(f, P, novo)({ id: 'f1', place: P, idx: 0, url: 'https://venue-image.waze.com/f1.jpg' });
  assert.equal(f.doc.activeElement, novo.filhos['.card-image'], `CONTROLE: o foco na foto do card foi a ${nome(f.doc)}`);
});

// E a regra é ESTRUTURAL: todo redesenho pelo `showCurrentPlace` debaixo do foco
// é do MESMO pedido (quem chama confere `AppState.currentPlace === place` antes)
// e passa o `mesmoBotao`; o que TROCA o pedido é o `advanceQueue`, que não passa.
// Lê só código (gotcha #67): o comentário cita os nomes.
test('R9-3-04 todo `mantendoFocoNoCard(showCurrentPlace…)` passa `{ mesmoBotao: true }` — o `advanceQueue`, que troca o pedido, não', () => {
  const codigo = SEM;
  const redesenhos = [...codigo.matchAll(/mantendoFocoNoCard\(showCurrentPlace\b([^)]*)\)/g)];
  assert.ok(redesenhos.length >= 5, `CONTROLE: só ${redesenhos.length} redesenhos pelo \`showCurrentPlace\` achados — o guard estaria cego`);
  const sem = redesenhos.filter((m) => !/^,\s*\{\s*mesmoBotao:\s*true\s*\}$/.test(m[1]));
  assert.deepEqual(sem.map((m) => m[0]), [], 'um redesenho do MESMO pedido deixou de levar o foco do ✕ ↑ ✓ ao mesmo botão');
  const trocas = [...codigo.matchAll(/mantendoFocoNoCard\(advanceQueue\b([^)]*)\)/g)];
  assert.ok(trocas.length >= 1 && trocas.every((m) => m[1] === ''), 'o `advanceQueue` (OUTRO pedido na frente) passou a levar o foco ao mesmo botão');
});
