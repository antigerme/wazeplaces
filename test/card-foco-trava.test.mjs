// O CARD pra quem opera pelo TECLADO e pra quem toca no card TRAVADO
// (auditoria do card, 2026-09-29).
//
//  C10 · Enter no ✕ ↑ ✓ focado levava o foco pro <body> (o Tab seguinte caía na
//        seta do carrossel do card novo), e Enter no "Desfazer" também (o Tab
//        ia pro botão de tema, no alto da página). MEDIDO nos dois motores.
//  C14 · com o card travado por um motivo SEM banner (o "Marcar todos" no ar
//        depois que o toast dele some, a conferência de um 401, a sessão
//        renovando), tocar no ✕ ↑ ✓, arrastar e as setas não respondiam nada.
//
// As funções rodam DE VERDADE, fatiadas do app.js, com o documento de mentira.
// O que só o navegador responde — o foco pousando de fato nos dois motores,
// o `pointerdown`/`pointerup` chegando num botão `disabled`, o toast na tela —
// está no bloco "O CARD" do `tools/smoke-browser.mjs`. Os caminhos do gesto e
// da seta (swipe.js e `handleKeyDown`) estão em test/gestos-card.
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

// ── C14: o aviso da trava ────────────────────────────────────────────────────
function montarAviso({ autenticado = true, lote = false, conferindo = 0, janela = false } = {}) {
  const avisos = [];
  const dispensados = [];
  const duracoes = [];
  const relogio = { agora: 1_000_000 };
  const estado = { AppState: { authenticated: autenticado, pendingAction: janela ? {} : null } };
  const deps = {
    AppState: estado.AppState, aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    // O toast devolve o controle dele, como o de verdade (`texto`, `dispensar`).
    showToast: (msg, tipo, ms) => { const n = avisos.push({ msg, tipo }); duracoes.push(ms); return { dispensar: () => dispensados.push(n - 1) }; },
    t: (k) => k,
    Date: { now: () => relogio.agora },
    // A aprovação da foto no ar do pedido da tela também trava (lote 8 da fila,
    // A1): aqui não há nenhuma.
    aprovacaoDaTelaNoAr: () => false,
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    `let loteDeLidosEmVoo = ${lote}, escritasConferindo = ${conferindo};`,
    fatiar('acoesTravadas'), fatiar('avisoDaTrava'),
    constante('AVISO_DA_TRAVA_INTERVALO_MS'), 'let avisoDaTravaEm = 0;', 'let avisoDaTravaNaTela = null;',
    fatiar('avisarTravaAoTocar'), fatiar('dispensarAvisoDaTrava'),
    'return { avisarTravaAoTocar, dispensarAvisoDaTrava, soltar: () => { loteDeLidosEmVoo = false; escritasConferindo = 0; }, intervalo: AVISO_DA_TRAVA_INTERVALO_MS };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  return { app, avisos, dispensados, duracoes, relogio, AppState: estado.AppState };
}

test('C14 o card travado SEM banner responde com o porquê — o aviso que já existe', () => {
  for (const [caso, opcoes, chave] of [
    ['o "Marcar todos" no ar', { lote: true }, 'toast.esperaLote'],
    ['a conferência de um 401', { conferindo: 1 }, 'toast.esperaSessao'],
    ['a sessão caída/renovando', { autenticado: false }, 'api.error.noSession'],
  ]) {
    const m = montarAviso(opcoes);
    assert.equal(m.app.avisarTravaAoTocar(), true, `${caso}: DEFEITO — o toque no card travado não respondeu`);
    assert.deepEqual(m.avisos, [{ msg: chave, tipo: 'info' }], `${caso}: o aviso não é o da trava que está valendo`);
  }
});

test('C14 na janela do Desfazer NÃO: o banner com a contagem já explica — e destravado, nada', () => {
  const j = montarAviso({ janela: true });
  assert.equal(j.app.avisarTravaAoTocar(), false);
  assert.deepEqual(j.avisos, [], 'a janela do Desfazer ganhou um toast em cima do banner que já diz o que é');
  const livre = montarAviso();
  assert.equal(livre.app.avisarTravaAoTocar(), false);
  assert.deepEqual(livre.avisos, [], 'o card destravado respondeu "espere"');
});

test('C14 no máximo UM aviso por intervalo: insistir no ✕ travado não empilha toasts', () => {
  const m = montarAviso({ lote: true });
  assert.equal(m.app.intervalo, 3000, 'o intervalo entre avisos mudou: reveja o texto do relatório e o smoke');
  m.app.avisarTravaAoTocar();
  m.relogio.agora += 1000; m.app.avisarTravaAoTocar();
  m.relogio.agora += 1999; m.app.avisarTravaAoTocar();
  assert.equal(m.avisos.length, 1, `${m.avisos.length} avisos em menos de 3 s`);
  m.relogio.agora += 1; m.app.avisarTravaAoTocar();
  assert.equal(m.avisos.length, 2, 'passado o intervalo, o toque seguinte não respondeu');
  // O aviso DURA o intervalo: com os 4 s de sempre, o segundo chegava com o
  // primeiro ainda na tela — dois avisos iguais empilhados.
  assert.deepEqual(m.duracoes, [m.app.intervalo, m.app.intervalo], 'o aviso dura mais que o intervalo: dois iguais empilham');
  // Destravou: o próximo toque não diz nada, nem dentro do intervalo de antes.
  m.app.soltar();
  m.relogio.agora += 3000; m.app.avisarTravaAoTocar();
  assert.equal(m.avisos.length, 2);
});

test('C14 o aviso SAI quando a trava acaba — não cobre o botão que voltou a valer', () => {
  // MEDIDO: no Fold e no iPhone SE o toast do rodapé cobre ✕ ↑ ✓ (hit-test no
  // centro dos três dá o toast); com o lote terminando antes dos 4 s dele, o
  // primeiro toque no ✕ vivo só dispensava o aviso (gotcha #26).
  const m = montarAviso({ lote: true });
  m.app.avisarTravaAoTocar();
  m.app.soltar();
  m.app.dispensarAvisoDaTrava();
  assert.deepEqual(m.dispensados, [0], 'o aviso da trava ficou na tela depois de a trava acabar');
  m.app.dispensarAvisoDaTrava();
  assert.deepEqual(m.dispensados, [0], 'dispensou duas vezes o mesmo aviso');
  // E quem dispensa é a trava que MUDA — a função da trava, e só destravada.
  assert.match(fatiar('aplicarTravaDeAcao'), /if \(!travado\) dispensarAvisoDaTrava\(\);/,
    'a trava que acaba não tira o aviso de cima dos botões');
});

test('C14 os caminhos passam pelo aviso: o toque no botão travado (pointerdown/up na barra), a seta e o swipe.js', () => {
  const render = fatiar('renderCurrentCard');
  // Botão `disabled` não recebe `click`: a barra ouve o par pointerdown/up, e
  // SÓ no MESMO botão travado (o fim de um arraste não conta).
  assert.match(render, /const barraDeAcoes = card\.querySelector\('\.card-actions'\);/,
    'a barra dos botões do card da frente não é mais ouvida');
  assert.match(render, /barraDeAcoes\.addEventListener\('pointerdown', \(ev\) => \{ tocouTravado = botaoTravado\(ev\); \}\);/);
  assert.match(render, /barraDeAcoes\.addEventListener\('pointerup', \(ev\) => \{\s*const b = botaoTravado\(ev\);\s*if \(b && b === tocouTravado\) avisarTravaAoTocar\(\);/,
    'DEFEITO: o toque no ✕ ↑ ✓ travado voltou a não responder');
  assert.match(render, /return b && b\.disabled \? b : null;/, 'o botão VIVO passou a pedir o aviso da trava');
  // O `disabled` fica: é ele que tira do Tab e faz o leitor de tela anunciar (gotcha #63).
  const trava = fatiar('aplicarTravaDeAcao');
  assert.match(trava, /if \(b\) b\.disabled = travado \|\| \(semFoto && cls !== '\.card-btn-skip'\);/,
    'a trava dos botões do card deixou de escrever o `disabled`');
  assert.doesNotMatch(trava, /aria-disabled/, 'a trava trocou o `disabled` por `aria-disabled`');
  const teclas = fatiar('handleKeyDown');
  assert.match(teclas, /if \(acoesTravadas\(\) && \['ArrowLeft', 'ArrowRight', 'ArrowUp'\]\.includes\(e\.key\)\) \{\s*e\.preventDefault\(\);\s*avisarTravaAoTocar\(\);\s*return;/,
    'a seta no card travado voltou calada');
  assert.match(SEM, /^window\.avisarTravaAoTocar = avisarTravaAoTocar;$/m,
    'o swipe.js não alcança o aviso (o arraste e o triggerSwipe travados voltariam calados)');
});

// ── C10: o foco de quem opera pelo teclado ───────────────────────────────────
// Um botão de mentira com o que o `focavelNaTela` e o `.focus()` usam.
function botao(nome, { disabled = false } = {}) {
  const b = { nome, disabled, isConnected: true, getClientRects: () => [1] };
  b.focus = () => { doc.activeElement = b; };
  return b;
}
const doc = { body: { nome: 'body' }, activeElement: null, getElementById: () => null };
function cardCom({ semFoto = false } = {}) {
  const bs = { '.card-btn-reject': botao('✕', { disabled: semFoto }), '.card-btn-skip': botao('↑'),
    '.card-btn-read': botao('✓', { disabled: semFoto }) };
  return { bs, querySelector: (sel) => bs[sel] || null };
}
function montarFoco() {
  const estado = { travado: false, card: null, camada: false };
  const deps = {
    document: doc, acoesTravadas: () => estado.travado, cardDaFrente: () => estado.card,
    topOpenModal: () => (estado.camada ? {} : null),
    Lightbox: { isOpen: () => false }, MapaLightbox: { isOpen: () => false },
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    fatiar('focavelNaTela'), constante('BOTAO_DA_ACAO'), 'let focoDoTeclado = null;',
    fatiar('pedirFocoDoTeclado'), fatiar('aplicarFocoDoTeclado'),
    'return { pedirFocoDoTeclado, aplicarFocoDoTeclado, pendente: () => focoDoTeclado, pointerdown: () => { focoDoTeclado = null; } };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  return { app, estado };
}
// O gesto: o botão acionado estava focado (teclado) ou não; o card sai (o foco
// cai no <body>) e o próximo nasce.
function acionar(m, botaoAcionado, { detail, acao, focado = true }) {
  doc.activeElement = focado ? botaoAcionado : doc.body;
  m.app.pedirFocoDoTeclado(botaoAcionado, detail === 0, acao);
  doc.activeElement = doc.body;         // o card (e o botão focado) saiu da tela
  m.estado.card = cardCom();
}

test('C10 Enter no ✕ ↑ ✓ focado: o foco vai ao botão EQUIVALENTE do card novo', () => {
  for (const [acao, sel] of [['left', '.card-btn-reject'], ['up', '.card-btn-skip'], ['right', '.card-btn-read']]) {
    const m = montarFoco();
    acionar(m, botao('velho'), { detail: 0, acao });
    m.app.aplicarFocoDoTeclado();
    assert.equal(doc.activeElement, m.estado.card.bs[sel],
      `${acao}: DEFEITO — o foco ficou em ${doc.activeElement && doc.activeElement.nome} em vez do ${m.estado.card.bs[sel].nome} do card novo`);
    assert.equal(m.app.pendente(), null, `${acao}: o pedido de foco ficou pendurado depois de pousar`);
  }
});

test('C10 só o TECLADO: o mouse e o dedo (detail 1) e o clique programático não movem o foco', () => {
  const mouse = montarFoco();
  acionar(mouse, botao('velho'), { detail: 1, acao: 'left' });
  mouse.app.aplicarFocoDoTeclado();
  assert.equal(doc.activeElement, doc.body, 'o clique do mouse/dedo pôs o foco no card novo (o foco pulando pela tela)');
  // `.click()` de script: detail 0, mas o botão não estava focado.
  const script = montarFoco();
  acionar(script, botao('velho'), { detail: 0, acao: 'left', focado: false });
  script.app.aplicarFocoDoTeclado();
  assert.equal(doc.activeElement, doc.body, 'um .click() programático moveu o foco');
  // E quem pegou o mouse/dedo depois do Enter desliga o pedido.
  const pegou = montarFoco();
  acionar(pegou, botao('velho'), { detail: 0, acao: 'left' });
  pegou.app.pointerdown();
  pegou.app.aplicarFocoDoTeclado();
  assert.equal(doc.activeElement, doc.body, 'o foco pousou depois de a pessoa pegar o mouse');
});

test('C10 o foco ESPERA o botão destravar (janela do Desfazer), e cede a quem mexeu no foco', () => {
  const m = montarFoco();
  acionar(m, botao('velho'), { detail: 0, acao: 'left' });
  m.estado.travado = true;               // a janela do Desfazer: o card novo nasce travado
  m.app.aplicarFocoDoTeclado();
  assert.equal(doc.activeElement, doc.body, 'o foco foi pra um botão travado (que o perde ao virar disabled)');
  assert.equal(m.app.pendente(), '.card-btn-reject', 'a trava apagou o pedido de foco');
  m.estado.travado = false;              // a janela acabou
  m.app.aplicarFocoDoTeclado();
  assert.equal(doc.activeElement, m.estado.card.bs['.card-btn-reject'], 'destravado, o foco não pousou no ✕ do card novo');
  // A pessoa deu Tab (ou clicou) durante a janela: o lugar dela ganha.
  const t = montarFoco();
  acionar(t, botao('velho'), { detail: 0, acao: 'up' });
  t.estado.travado = true;
  t.app.aplicarFocoDoTeclado();
  const outro = botao('Filtros');
  doc.activeElement = outro;
  t.estado.travado = false;
  t.app.aplicarFocoDoTeclado();
  assert.equal(doc.activeElement, outro, 'o foco foi arrancado de onde a pessoa o pôs');
  assert.equal(t.app.pendente(), null);
  // Uma camada aberta (modal, foto, mapa) também: foco atrás de camada `aria-modal` é foco perdido.
  const c = montarFoco();
  acionar(c, botao('velho'), { detail: 0, acao: 'left' });
  c.estado.camada = true;
  c.app.aplicarFocoDoTeclado();
  assert.equal(doc.activeElement, doc.body, 'o foco foi pro card por trás de uma camada aberta');
});

test('C10 card de foto sem a foto: ✕ e ✓ seguem travados, e o foco vai ao ↑', () => {
  const m = montarFoco();
  doc.activeElement = botao('velho');
  m.app.pedirFocoDoTeclado(doc.activeElement, true, 'left');
  doc.activeElement = doc.body;
  m.estado.card = cardCom({ semFoto: true });
  m.app.aplicarFocoDoTeclado();
  assert.equal(doc.activeElement, m.estado.card.bs['.card-btn-skip'], 'o foco não achou o único botão vivo do card sem foto');
});

test('C10 Enter no "Desfazer": o foco vai ao botão da ação DESFEITA, no card que voltou', () => {
  for (const [tipo, sel] of [['reject', '.card-btn-reject'], ['skip', '.card-btn-skip'], ['read', '.card-btn-read']]) {
    const m = montarFoco();
    const desfazer = botao('Desfazer');
    acionar(m, desfazer, { detail: 0, acao: tipo });
    m.app.aplicarFocoDoTeclado();
    assert.equal(doc.activeElement, m.estado.card.bs[sel], `${tipo}: o Desfazer pelo teclado largou o foco no <body>`);
  }
});

test('C10 os pontos de entrada: os três botões, o Desfazer, a trava que muda, o card que nasce e o ponteiro', () => {
  const render = fatiar('renderCurrentCard');
  assert.match(render, /const fireAction = \(direction, handler, ev\) => \{\s*if \(actionFired\) return;\s*actionFired = true;\s*pedirFocoDoTeclado\(ev && ev\.currentTarget, !!ev && ev\.detail === 0, direction\);/,
    'o botão do card deixou de dizer se o gesto veio do teclado');
  for (const [cls, dir, h] of [['reject', 'left', 'handleReject'], ['skip', 'up', 'handleSkip'], ['read', 'right', 'handleMarkAsRead']]) {
    assert.match(render, new RegExp(`\\.card-btn-${cls}'\\)\\.addEventListener\\('click', \\(ev\\) => fireAction\\('${dir}', ${h}, ev\\)\\);`),
      `o ${cls} não passa o evento (o teclado não é reconhecido)`);
  }
  // Depois da tarefa: o scheduleAction do mesmo gesto trava o card logo em seguida.
  assert.match(render, /if \(focoDoTeclado\) queueMicrotask\(aplicarFocoDoTeclado\);\s*\}$/,
    'o card que chega depois do gesto (a próxima página) não recebe o foco prometido');
  assert.match(fatiar('aplicarTravaDeAcao'), /aplicarFocoDoTeclado\(\);\s*\}$/,
    'a trava que muda não aplica o foco prometido (a janela do Desfazer acabando)');
  const desfazer = fatiar('desfazerAcaoPendente');
  const iPede = desfazer.indexOf("pedirFocoDoTeclado(document.getElementById('undoBtn'), !ev || ev.detail === 0, AppState.pendingAction.type);");
  const iUndo = desfazer.indexOf('AppState.pendingAction.undo();');
  assert.ok(iPede > 0 && iUndo > iPede, 'o Desfazer não pede o foco ANTES de desfazer (depois, o tipo da ação já se foi)');
  assert.match(fatiar('setupAppListeners'), /window\.addEventListener\('pointerdown', \(\) => \{ focoDoTeclado = null; \}, true\);/,
    'pegar o mouse ou o dedo não desliga o foco prometido ao teclado');
});

// ── A família do C10: o foco que o app tira debaixo do teclado ───────────────
// O par "Ver +N" ⇄ barra "Primeiro os de…", MEDIDO nos dois motores depois do
// C10: Enter no "Ver +N" (o `focarAutor` remonta o card e leva o botão focado)
// e Enter na barra (ela se esconde com o foco nela) largavam o foco no <body>.
// Na tela, nos dois motores: bloco "O CARD" do `tools/smoke-browser.mjs`.
function montarAutor() {
  const estado = { card: null };
  const deps = { document: doc, cardDaFrente: () => estado.card };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    fatiar('focavelNaTela'), constante('BOTAO_DA_ACAO'), 'let focoDoTeclado = null;',
    fatiar('veioDoTeclado'), fatiar('focarDepoisDoFocoNoAutor'),
    'return { veioDoTeclado, focarDepoisDoFocoNoAutor, pendente: () => focoDoTeclado };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  return { app, estado };
}
// Um card com o "Ver +N" (ou sem ele) e os três botões.
function cardDoAutor({ selo = true, travado = false } = {}) {
  const bs = {
    '.selo-lote': selo ? botao('Ver +N') : null,
    '.card-btn-reject': botao('✕', { disabled: travado }), '.card-btn-skip': botao('↑', { disabled: travado }),
    '.card-btn-read': botao('✓', { disabled: travado }),
  };
  return { bs, querySelector: (sel) => bs[sel] || null };
}

test('família do C10: só o TECLADO conta — Enter no botão FOCADO, nunca o mouse nem o .click() de script', () => {
  const m = montarAutor();
  const b = botao('barra');
  doc.activeElement = b;
  assert.equal(m.app.veioDoTeclado({ detail: 0, currentTarget: b }), true, 'Enter no botão focado não conta como teclado');
  assert.equal(m.app.veioDoTeclado({ detail: 1, currentTarget: b }), false, 'o clique do mouse/dedo contou como teclado');
  doc.activeElement = doc.body;
  assert.equal(m.app.veioDoTeclado({ detail: 0, currentTarget: b }), false, 'um .click() de script (botão sem foco) contou como teclado');
  assert.equal(m.app.veioDoTeclado(undefined), false);
});

test('família do C10: Enter no "Ver +N" leva o foco à barra; Enter na barra, ao "Ver +N" do card da tela', () => {
  const m = montarAutor();
  const barra = botao('Primeiro os de…');
  doc.getElementById = (id) => (id === 'focoAutorBar' ? barra : null);
  try {
    doc.activeElement = doc.body;
    m.app.focarDepoisDoFocoNoAutor(true);
    assert.equal(doc.activeElement, barra, 'entrou no foco pelo "Ver +N" e o foco não foi pra barra');
    // Saiu pela barra: o "Ver +N" do card da tela é o equivalente dela no card.
    m.estado.card = cardDoAutor();
    doc.activeElement = doc.body;
    m.app.focarDepoisDoFocoNoAutor(false);
    assert.equal(doc.activeElement, m.estado.card.bs['.selo-lote'], 'saiu pela barra e o foco não voltou ao "Ver +N"');
    // A série acabou neste card (sem "Ver +N"): o primeiro botão vivo, o ✕.
    m.estado.card = cardDoAutor({ selo: false });
    doc.activeElement = doc.body;
    m.app.focarDepoisDoFocoNoAutor(false);
    assert.equal(doc.activeElement, m.estado.card.bs['.card-btn-reject'], 'sem o "Ver +N" o foco não foi ao ✕');
    // Card travado (a janela do Desfazer): nada focável agora — o ✕ fica
    // PROMETIDO ao teclado e pousa quando destravar.
    m.estado.card = cardDoAutor({ selo: false, travado: true });
    doc.activeElement = doc.body;
    m.app.focarDepoisDoFocoNoAutor(false);
    assert.equal(doc.activeElement, doc.body, 'o foco foi pra um botão travado');
    assert.equal(m.app.pendente(), '.card-btn-reject', 'com o card travado, o foco não ficou prometido ao ✕');
  } finally { doc.getElementById = () => null; }
});

test('família do C10: a barra e o "Ver +N" passam pelo foco SÓ pelo teclado, e decidem ANTES de sumir', () => {
  const voltar = fatiar('voltarAOrdemNormal');
  const iTeclado = voltar.indexOf('const peloTeclado = veioDoTeclado(ev);');
  const iLimpa = voltar.indexOf('limparFocoAutor();');
  assert.ok(iTeclado > 0 && iLimpa > iTeclado,
    'a barra decide se veio do teclado DEPOIS de se esconder (o foco já não é dela)');
  assert.match(voltar, /aoMudarAFilaPorBaixo\(\);\s*if \(peloTeclado\) focarDepoisDoFocoNoAutor\(false\);\s*\}$/,
    'Enter na barra voltou a largar o foco no <body>');
  const selos = fatiar('renderSelosDeProcedencia');
  assert.match(selos, /const peloTeclado = veioDoTeclado\(ev\);\s*focarAutor\(s\.acao\);\s*if \(peloTeclado\) focarDepoisDoFocoNoAutor\(true\);/,
    'Enter no "Ver +N" voltou a largar o foco no <body>');
});

// O foco pousa no ✕ de um card de FOTO (o C10) e a foto falha DEPOIS: a
// `marcarCardSemFoto` desabilita o ✕ focado, e o focado que vira `disabled`
// PERDE o foco pro <body> (MEDIDO nos dois motores; na tela, o bloco "O CARD").
// Aqui roda a `marcarCardSemFoto` de verdade, com o card e o documento de mentira.
function montarSemFoto() {
  const caixa = { children: [], querySelector: () => null, appendChild() {} };
  const bs = { '.card-btn-reject': botao('✕'), '.card-btn-skip': botao('↑'), '.card-btn-read': botao('✓') };
  for (const b of Object.values(bs)) { b.classList = { add() {} }; b.matches = (sel) => sel.split(',').some((s) => bs[s.trim()] === b); }
  const card = {
    bs, querySelector: (sel) => (sel === '.card-photo' ? caixa : bs[sel] || null),
    contains: (el) => Object.values(bs).includes(el),
  };
  const deps = {
    document: { ...doc, get activeElement() { return doc.activeElement; }, createElement: () => ({ className: '', innerHTML: '' }) },
    navigator: { onLine: false }, escapeHtml: (s) => s, t: (k) => k,
  };
  const nomes = Object.keys(deps);
  const marcar = new Function(...nomes, fatiar('focavelNaTela') + '\n' + fatiar('marcarCardSemFoto') + '\nreturn marcarCardSemFoto;')(
    ...nomes.map((n) => deps[n]));
  return { card, marcar };
}

test('família do C10: a foto que falha DEPOIS de o foco pousar no ✕ (ou no ✓) leva o foco ao ↑, o vivo', () => {
  for (const sel of ['.card-btn-reject', '.card-btn-read']) {
    const m = montarSemFoto();
    doc.activeElement = m.card.bs[sel];
    m.marcar(m.card, { purType: 'NEW_PHOTO' });
    assert.equal(m.card.bs[sel].disabled, true, `PRÉ-CONDIÇÃO: o ${sel} não travou sem a foto`);
    assert.equal(doc.activeElement, m.card.bs['.card-btn-skip'],
      `DEFEITO: com o foco no ${sel}, a foto falhou e o foco ficou num botão travado (o navegador o joga no <body>)`);
  }
  // CONTROLE: o foco fora dos botões (o dedo não põe foco neles) não é mexido.
  const c = montarSemFoto();
  const fora = botao('Filtros');
  doc.activeElement = fora;
  c.marcar(c.card, { purType: 'NEW_PHOTO' });
  assert.equal(doc.activeElement, fora, 'a foto que falhou arrancou o foco de fora do card');
  doc.activeElement = doc.body;
  const d = montarSemFoto();
  d.marcar(d.card, { purType: 'NEW_PHOTO' });
  assert.equal(doc.activeElement, doc.body, 'sem foco nenhum no card, a foto que falhou pôs o foco no ↑ (o foco pulando pela tela)');
});
