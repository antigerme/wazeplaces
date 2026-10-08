// A TELA na rodada 14 da auditoria (lote 18, área "tela"; relatório r14-8): o
// teclado, o leitor de tela e o ícone de um aviso — o JS de verdade, fatiado do
// app.js.
//
//  R14-8-01 · a SETA com o foco num ✕ ↑ ✓ do card tirava o card com o botão
//             focado e o foco caía no <body>; o Enter no MESMO botão já levava o
//             foco ao equivalente do card seguinte (C10). MEDIDO nos dois motores.
//
// (O R14-8-05, a idade de MESES em francês, mora em test/idade.test.mjs; os do
// Galaxy Fold — R14-8-03, -11 e -12 —, em test/tela-fold.test.mjs.)
//
// O foco pousando de verdade, nos dois motores, está no bloco "O CARD"
// (card/teclado) do `tools/smoke-browser.mjs`.
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
// Declaração de topo `const NOME = …;`, inclusive a que atravessa linhas.
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = [\\s\\S]*?;\\n', 'm').exec(SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
}

// ═══ R14-8-01 · a SETA com o foco dentro do card ═════════════════════════════
// O `handleKeyDown`, o `prometerFocoDaSeta`, o `direcaoTravada` e o
// `aplicarFocoDoTeclado` DE VERDADE, com o DOM de mentira: o `triggerSwipe`
// tira o card da tela (o botão focado sai do documento e o foco cai no <body>)
// e o card seguinte nasce, como no app; o `aplicarFocoDoTeclado` é o que o
// `renderCurrentCard` chama depois da tarefa.
function montarSeta() {
  const doc = { body: { nome: '<body>' }, activeElement: null, getElementById: () => null };
  doc.activeElement = doc.body;
  const botao = (nome, { disabled = false } = {}) => {
    const b = { nome, disabled, tagName: 'BUTTON', isConnected: true, getClientRects: () => [1], closest: () => null };
    b.focus = () => { if (!b.disabled && b.isConnected) doc.activeElement = b; };
    return b;
  };
  const cardFake = (letra, { semFoto = false } = {}) => {
    const els = {
      '.card-btn-reject': botao('✕ ' + letra, { disabled: semFoto }), '.card-btn-skip': botao('↑ ' + letra),
      '.card-btn-read': botao('✓ ' + letra, { disabled: semFoto }), '.card-image-next': botao('a seta da foto ' + letra),
    };
    if (semFoto) els['.card-sem-foto'] = { nome: 'o aviso da foto' };
    return { letra, els, querySelector: (s) => els[s] || null, contains: (el) => Object.values(els).includes(el) };
  };
  const estado = { card: cardFake('A'), saiu: [], travado: false };
  // O card SAI com o gesto: o botão focado deixa o documento, o foco cai no
  // <body> e o card seguinte é o da frente.
  const sair = () => {
    for (const b of Object.values(estado.card.els)) b.isConnected = false;
    doc.activeElement = doc.body;
    estado.card = cardFake('B');
  };
  const deps = {
    document: doc,
    window: { triggerSwipe: (dir) => { estado.saiu.push(dir); sair(); } },
    AppState: { currentPlace: { updateRequestID: 'uA' }, pendingAction: null },
    MapaLightbox: { isOpen: () => false }, Lightbox: { isOpen: () => false, ampliada: () => false },
    topOpenModal: () => null, trapTabInModal() {}, closeModal() {}, desfazerAcaoPendente() {},
    acoesTravadas: () => estado.travado, agirNoPedidoDoGesto() {}, pedidoDoCard: () => null,
    handleReject() {}, handleMarkAsRead() {}, handleSkip() {}, desfazerPeloTeclado: () => false,
    avisarTravaAoTocar() {}, cardDaFrente: () => estado.card,
  };
  const fonte = [constante('TECLAS_DE_CURSOR'), fatiar('focoEmCampoDeTexto'), constante('AREAS_DO_CARD_QUE_ROLAM'),
    fatiar('focoEmAreaQueRola'), fatiar('atalhoDoNavegador'), constante('TECLAS_DOS_ATALHOS_DO_NAVEGADOR'),
    constante('BOTAO_DA_ACAO'), 'let focoDoTeclado = null;', fatiar('focavelNaTela'), fatiar('direcaoTravada'),
    fatiar('prometerFocoDaSeta'), fatiar('aplicarFocoDoTeclado'), fatiar('handleKeyDown'),
    'return { handleKeyDown, aplicarFocoDoTeclado, pendente: () => focoDoTeclado };'].join('\n');
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, fonte)(...nomes.map((n) => deps[n]));
  const tecla = (key) => { const e = { key, preventDefault() { this.parou = true; } }; app.handleKeyDown(e); return e; };
  const focado = () => (doc.activeElement && doc.activeElement.nome) || '?';
  return { app, doc, estado, tecla, focado, cardFake };
}

test('R14-8-01: a SETA com o foco num ✕ ↑ ✓ do card leva o foco ao MESMO botão do card que fica — como o Enter', () => {
  for (const [seta, sel, nome] of [
    ['ArrowLeft', '.card-btn-reject', '← com o foco no ✕'],
    ['ArrowUp', '.card-btn-skip', '↑ com o foco no ↑'],
    ['ArrowRight', '.card-btn-read', '→ com o foco no ✓'],
    // O "Entendi" do "Como funciona" e o fim da série do autor põem o foco no ✕;
    // a seta seguinte decide o que decidir, e o foco segue no ✕ (o lugar dele).
    ['ArrowRight', '.card-btn-reject', '→ com o foco no ✕'],
    ['ArrowUp', '.card-btn-read', '↑ com o foco no ✓'],
  ]) {
    const m = montarSeta();
    m.estado.card.els[sel].focus();
    assert.equal(m.doc.activeElement, m.estado.card.els[sel], `PRÉ-CONDIÇÃO (${nome}): o botão não ficou com o foco`);
    const e = m.tecla(seta);
    assert.equal(e.parou, true, `PRÉ-CONDIÇÃO (${nome}): a seta não ficou com o app`);
    assert.equal(m.estado.saiu.length, 1, `PRÉ-CONDIÇÃO (${nome}): a seta não decidiu`);
    assert.equal(m.doc.activeElement, m.doc.body, `PRÉ-CONDIÇÃO (${nome}): o card não saiu com o foco`);
    m.app.aplicarFocoDoTeclado();
    assert.equal(m.doc.activeElement, m.estado.card.els[sel],
      `DEFEITO (${nome}): o foco ficou em ${m.focado()} — o card saiu com o botão focado e quem usa teclado ou leitor de tela perdeu o lugar`);
    assert.equal(m.app.pendente(), null, `${nome}: o foco prometido ficou pendurado depois de pousar`);
  }
});

test('R14-8-01: de OUTRO controle do card (a seta da foto), a seta leva o foco ao ✕ do card que fica', () => {
  const m = montarSeta();
  m.estado.card.els['.card-image-next'].focus();
  m.tecla('ArrowLeft');
  m.app.aplicarFocoDoTeclado();
  assert.equal(m.doc.activeElement, m.estado.card.els['.card-btn-reject'], `o foco ficou em ${m.focado()}`);
  // Card de foto sem a foto chegando: ✕ e ✓ travados, e o foco vai ao ↑ (a régua do C10).
  const s = montarSeta();
  s.estado.card.els['.card-btn-reject'].focus();
  const sair = s.estado;
  s.tecla('ArrowLeft');
  sair.card = s.cardFake('C', { semFoto: true });
  s.app.aplicarFocoDoTeclado();
  assert.equal(s.doc.activeElement, sair.card.els['.card-btn-skip'], `card sem foto: o foco ficou em ${s.focado()}`);
});

test('R14-8-01 CONTROLE: com o foco FORA do card, ou na seta que não decide, nada é prometido', () => {
  // O foco num controle do cabeçalho: a seta decide, e o foco não pula pro card
  // — quem não estava no card não é levado a ele.
  const f = montarSeta();
  const fora = { nome: 'Filtros', tagName: 'BUTTON', isConnected: true, getClientRects: () => [1], closest: () => null, focus() { f.doc.activeElement = fora; } };
  fora.focus();
  f.tecla('ArrowLeft');
  f.doc.activeElement = fora;   // o controle de fora não saiu com o card
  f.app.aplicarFocoDoTeclado();
  assert.equal(f.estado.saiu.length, 1, 'CONTROLE: a seta deixou de decidir');
  assert.equal(f.app.pendente(), null, 'a seta prometeu o foco de quem nem estava no card');
  assert.equal(f.doc.activeElement, fora, 'o foco foi arrancado de um controle fora do card');
  // Sem foco nenhum (o <body>): idem.
  const b = montarSeta();
  b.tecla('ArrowUp');
  b.app.aplicarFocoDoTeclado();
  assert.equal(b.doc.activeElement, b.doc.body, 'a seta sem foco nenhum pôs o foco no card (o foco pulando pela tela)');
  // ← num card de foto SEM a foto não decide nada (`direcaoTravada`): o foco
  // fica onde está, sem promessa pendurada.
  const t = montarSeta();
  t.estado.card = t.cardFake('A', { semFoto: true });
  t.estado.card.els['.card-btn-skip'].focus();
  t.estado.saiu.length = 0;
  t.app.handleKeyDown({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(t.app.pendente(), null, 'a seta que não decide (card sem foto) deixou uma promessa de foco pendurada');
  // A trava (a janela do Desfazer): a seta não decide nem promete.
  const j = montarSeta();
  j.estado.travado = true;
  j.estado.card.els['.card-btn-reject'].focus();
  j.tecla('ArrowLeft');
  assert.deepEqual(j.estado.saiu, [], 'CONTROLE: a seta decidiu com o card travado');
  assert.equal(j.app.pendente(), null, 'a seta travada prometeu o foco');
});

test('R14-8-01: as TRÊS setas passam pela promessa, ANTES do `triggerSwipe`', () => {
  // O comportamento acima já reprova a ordem invertida (o `triggerSwipe` tira o
  // foco do card antes); isto diz QUAL seta perdeu a chamada.
  const teclas = fatiar('handleKeyDown');
  for (const [k, d] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up']]) {
    const re = new RegExp(`e\\.key === '${k}'\\) \\{\\s*e\\.preventDefault\\(\\);\\s*prometerFocoDaSeta\\('${d}'\\);\\s*if \\(window\\.triggerSwipe\\)`);
    assert.match(teclas, re, `a seta ${k} decide sem prometer o foco ao card que fica`);
  }
});
