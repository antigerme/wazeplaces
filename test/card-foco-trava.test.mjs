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
function montarAviso({ autenticado = true, lote = false, conferindo = 0, janela = false, quedaAnunciada = false } = {}) {
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
    // A extensão renovando em silêncio (R5-2-07): aqui, não.
    extPerguntando: false, extRenovando: false,
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    `let loteDeLidosEmVoo = ${lote}, escritasConferindo = ${conferindo}, quedaAnunciada = ${quedaAnunciada};`,
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

// R7-1-09: a renovação da queda ACABOU sem dar e o aviso de queda está na tela;
// nos instantes até a tela de entrada o card segue ali, travado, e o toque nele
// empilhava "Sessão expirada" sob "Sua sessão no app não vale mais" — dois avisos
// do mesmo fato (MEDIDO, auditoria de 2026-10-02). Quem acende e apaga a marca é
// a queda (test/costura-sessao, R7-1-09).
test('R7-1-09: com a queda já dita, o toque no card travado não empilha "Sessão expirada" sob o aviso de queda', () => {
  const m = montarAviso({ autenticado: false, quedaAnunciada: true });
  assert.equal(m.app.avisarTravaAoTocar(), false);
  assert.deepEqual(m.avisos, [], `DEFEITO: o toque somou um aviso ao aviso de queda: ${JSON.stringify(m.avisos)}`);
  // CONTROLE: a mesma queda ANTES de ser dita (a pergunta à extensão) avisa, como sempre.
  const c = montarAviso({ autenticado: false });
  assert.equal(c.app.avisarTravaAoTocar(), true);
  assert.deepEqual(c.avisos, [{ msg: 'api.error.noSession', tipo: 'info' }]);
  // E a marca de uma queda antiga não cala a trava de quem tem sessão (o lote no ar).
  const s = montarAviso({ lote: true, quedaAnunciada: true });
  assert.equal(s.app.avisarTravaAoTocar(), true, 'a marca da queda calou a trava de uma sessão viva');
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

// ── R5-2-05 e R5-2-06: o foco que a TRAVA e a FILA tiram debaixo do teclado ──
// (auditoria de 2026-10-01). Os três casos MEDIDOS nos dois motores, com o
// foco caindo no <body> e o CONTROLE mantendo-o no lugar:
//   · a conferência de um 401 (o "Pular guarda") trava os botões com o foco no
//     ↑ do card — botão focado que vira `disabled` perde o foco, e ninguém o
//     devolvia quando a trava acabava;
//   · uma página que chega (ou a recusa automática, ou o fim de um lote) refaz
//     os selos do card, e o foco no "Ver +N" ou no "✕ N" saía com o velho;
//   · "Rejeitar os N" pelo teclado: a folha devolve o foco ao "✕ N", que sai
//     com o card que o lote tira; o resultado, ao fechar, o largava no <body>.
// As funções de verdade, com o documento de mentira — que faz o que o navegador
// faz: o focado que vira `disabled` ou sai do DOM PERDE o foco pro <body>. Na
// tela, nos dois motores: os roteiros da auditoria (s09, s11, s19).
function documentoDeMentira() {
  return { body: { nome: 'body' }, activeElement: null, getElementById: () => null, querySelector: () => null };
}
function botaoQuePerde(d, nome, extra = {}) {
  const b = { nome, _dis: false, isConnected: true, getClientRects: () => [1], ...extra };
  Object.defineProperty(b, 'disabled', {
    get() { return b._dis; },
    set(v) { b._dis = !!v; if (v && d.activeElement === b) d.activeElement = d.body; },
  });
  b.focus = () => { if (!b._dis && b.isConnected) d.activeElement = b; };
  return b;
}

function montarTrava() {
  const d = documentoDeMentira();
  const bs = { '.card-btn-reject': botaoQuePerde(d, '✕'), '.card-btn-skip': botaoQuePerde(d, '↑'),
    '.card-btn-read': botaoQuePerde(d, '✓') };
  const card = { bs, classList: { toggle() {} }, querySelector: (sel) => bs[sel] || null };
  const estado = { travado: false };
  // O lightbox e a pílula do nome (`getElementById` → null) e o aviso da trava
  // não são o assunto aqui (test/lightbox-escritas e o C14, acima).
  const deps = {
    document: d, acoesTravadas: () => estado.travado, cardDaFrente: () => card, topOpenModal: () => null,
    Lightbox: { isOpen: () => false, place: null }, MapaLightbox: { isOpen: () => false },
    editandoNome: () => false, renomeacaoNoAr: () => false, atualizarBotaoSalvarNome: () => {},
    dispensarAvisoDaTrava: () => {},
    // O "Como funciona" adiado que espera o card destravar (R7-7-01): não é o
    // assunto aqui (test/como-funciona).
    pedirComoFuncionaAdiado: () => {},
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    'let aprovandoAgora = false, excluindoAgora = false;',
    fatiar('focavelNaTela'), constante('BOTAO_DA_ACAO'), 'let focoDoTeclado = null;',
    // O foco da foto ampliada na trava (R7-3-06): com ela fechada, sai sem mexer.
    fatiar('manterFocoNoLightbox'),
    fatiar('guardarFocoDaTrava'), fatiar('aplicarFocoDoTeclado'), fatiar('aplicarTravaDeAcao'),
    'return { aplicarTravaDeAcao, pendente: () => focoDoTeclado, pointerdown: () => { focoDoTeclado = null; } };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  return { app, estado, card, d };
}

test('R5-2-05: a trava que LIGA com o foco num ✕ ↑ ✓ do card o devolve ao MESMO botão quando acaba', () => {
  for (const sel of ['.card-btn-reject', '.card-btn-skip', '.card-btn-read']) {
    const m = montarTrava();
    m.app.aplicarTravaDeAcao();
    m.card.bs[sel].focus();                  // o C10 pousou o foco aqui (ou a pessoa deu Tab)
    assert.equal(m.d.activeElement, m.card.bs[sel], 'PRÉ-CONDIÇÃO: o foco não pousou no botão');
    m.estado.travado = true;                 // a conferência do 401, a queda da sessão
    m.app.aplicarTravaDeAcao();
    assert.equal(m.card.bs[sel].disabled, true, 'PRÉ-CONDIÇÃO: a trava não desabilitou o botão');
    assert.equal(m.d.activeElement, m.d.body, 'PRÉ-CONDIÇÃO: o focado que vira disabled perde o foco (o navegador)');
    m.estado.travado = false;                // a conferência terminou: sessão viva
    m.app.aplicarTravaDeAcao();
    assert.equal(m.d.activeElement, m.card.bs[sel],
      `DEFEITO: a trava acabou e o foco ficou no <body> em vez de voltar ao ${m.card.bs[sel].nome}`);
    assert.equal(m.app.pendente(), null, 'o pedido de foco ficou pendurado depois de pousar');
  }
});

test('R5-2-05: CONTROLES — a trava não traz pro card o foco que estava FORA dele, nem passa por cima do mouse ou do Tab', () => {
  // O foco fora do card (Filtros): a trava não o mexe, nem o leva pro card depois.
  const fora = montarTrava();
  const filtros = botaoQuePerde(fora.d, 'Filtros');
  filtros.focus();
  fora.estado.travado = true; fora.app.aplicarTravaDeAcao();
  fora.estado.travado = false; fora.app.aplicarTravaDeAcao();
  assert.equal(fora.d.activeElement, filtros, 'a trava levou pro card o foco que estava fora dele');
  assert.equal(fora.app.pendente(), null);
  // Sem foco em lugar nenhum (o dedo, o mouse): nada se move.
  const dedo = montarTrava();
  dedo.d.activeElement = dedo.d.body;
  dedo.estado.travado = true; dedo.app.aplicarTravaDeAcao();
  dedo.estado.travado = false; dedo.app.aplicarTravaDeAcao();
  assert.equal(dedo.d.activeElement, dedo.d.body, 'sem foco nos botões, a trava pôs o foco no card (o foco pulando pela tela)');
  // Pegou o mouse ou o dedo durante a trava: o pedido cai.
  const p = montarTrava();
  p.card.bs['.card-btn-skip'].focus();
  p.estado.travado = true; p.app.aplicarTravaDeAcao();
  p.app.pointerdown();
  p.estado.travado = false; p.app.aplicarTravaDeAcao();
  assert.equal(p.d.activeElement, p.d.body, 'o foco voltou ao card depois de a pessoa pegar o mouse');
  // Deu Tab pra outro lugar durante a trava: o lugar dela ganha.
  const t = montarTrava();
  t.card.bs['.card-btn-skip'].focus();
  t.estado.travado = true; t.app.aplicarTravaDeAcao();
  const outro = botaoQuePerde(t.d, 'Ajuda');
  outro.focus();
  t.estado.travado = false; t.app.aplicarTravaDeAcao();
  assert.equal(t.d.activeElement, outro, 'o foco foi arrancado de onde a pessoa o pôs durante a trava');
  assert.equal(t.app.pendente(), null);
});

function montarSelos({ depois = ['selo-lote', 'selo-reinc'], travado = false } = {}) {
  const d = documentoDeMentira();
  const caixa = (classes) => {
    const selos = classes.map((c) => botaoQuePerde(d, c, { classList: { contains: (k) => k === c } }));
    const box = {
      selos, fora: false, contains: (el) => selos.includes(el),
      // Sair do DOM leva junto o foco que estava num selo (o navegador).
      remove() {
        box.fora = true;
        for (const s of selos) s.isConnected = false;
        if (selos.includes(d.activeElement)) d.activeElement = d.body;
      },
    };
    return box;
  };
  const linha = { box: caixa(['selo-lote', 'selo-reinc']) };
  linha.querySelector = (s) => (s === '.selos-proc' && linha.box && !linha.box.fora ? linha.box : null);
  const bs = { '.card-btn-reject': botaoQuePerde(d, '✕'), '.card-btn-skip': botaoQuePerde(d, '↑'),
    '.card-btn-read': botaoQuePerde(d, '✓') };
  for (const b of Object.values(bs)) b.disabled = travado;
  const card = {
    bs, querySelector(s) {
      if (s === '.card-creator-row') return linha;
      const m = /^\.selos-proc \.([\w-]+)$/.exec(s);
      if (m) return (linha.box && !linha.box.fora && linha.box.selos.find((x) => x.nome === m[1])) || null;
      return bs[s] || null;
    },
  };
  const selo = (cls) => linha.box.selos.find((x) => x.nome === cls);
  const estado = { travado };
  const place = { venueID: 'v1', updateRequestID: 'u1' };
  const deps = {
    document: d, AppState: { currentPlace: place, queue: [place] }, cardDaFrente: () => card,
    // Refeitos com o que a fila tem AGORA (os de `depois`).
    renderSelosDeProcedencia: () => { linha.box = caixa(depois); },
    renderFocoAutor: () => {}, montarCardDeFundo: () => {}, chaveDoPedido: () => null,
    acoesTravadas: () => estado.travado, topOpenModal: () => null,
    Lightbox: { isOpen: () => false }, MapaLightbox: { isOpen: () => false },
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    'let aquecimentoDaFrenteFeito = false;', 'let focoDoTeclado = null;',
    fatiar('focavelNaTela'), constante('BOTAO_DA_ACAO'), fatiar('aplicarFocoDoTeclado'),
    fatiar('seloComFoco'), fatiar('devolverFocoAoSelo'), fatiar('aoMudarAFilaPorBaixo'),
    'return { aoMudarAFilaPorBaixo, aplicarFocoDoTeclado, pendente: () => focoDoTeclado };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  return { app, card, selo, estado, d };
}

test('R5-2-06: a fila que muda por baixo devolve o foco ao selo REFEITO — o "Ver +N" e o "✕ N"', () => {
  for (const cls of ['selo-lote', 'selo-reinc']) {
    const m = montarSelos();
    const velho = m.selo(cls);
    velho.focus();
    m.app.aoMudarAFilaPorBaixo();
    assert.notEqual(m.selo(cls), velho, 'PRÉ-CONDIÇÃO: os selos não foram refeitos');
    assert.equal(m.d.activeElement, m.selo(cls),
      `DEFEITO: a fila mudou com o foco no ${cls} e o foco ficou em ${m.d.activeElement && m.d.activeElement.nome}`);
  }
  // CONTROLES: o foco fora dos selos (num botão do card, ou em lugar nenhum) não é mexido.
  const noBotao = montarSelos();
  noBotao.card.bs['.card-btn-skip'].focus();
  noBotao.app.aoMudarAFilaPorBaixo();
  assert.equal(noBotao.d.activeElement, noBotao.card.bs['.card-btn-skip'], 'a fila que muda tirou o foco do ↑');
  const nada = montarSelos();
  nada.d.activeElement = nada.d.body;
  nada.app.aoMudarAFilaPorBaixo();
  assert.equal(nada.d.activeElement, nada.d.body, 'sem foco nos selos, a fila que muda pôs o foco no card (o foco pulando pela tela)');
  assert.equal(nada.app.pendente(), null);
});

test('R5-2-06: o selo focado que SOME com a fila leva o foco ao ✕ — prometido, se o card está travado', () => {
  // Os outros pedidos do autor saíram (a recusa automática, um lote): sem "Ver +N".
  const m = montarSelos({ depois: ['selo-reinc'] });
  m.selo('selo-lote').focus();
  m.app.aoMudarAFilaPorBaixo();
  assert.equal(m.d.activeElement, m.card.bs['.card-btn-reject'],
    `o "Ver +N" sumiu com o foco nele e o foco ficou em ${m.d.activeElement && m.d.activeElement.nome}`);
  // Na janela do Desfazer o ✕ não recebe foco: fica PROMETIDO e pousa quando destravar.
  const t = montarSelos({ depois: [], travado: true });
  t.selo('selo-lote').focus();
  t.app.aoMudarAFilaPorBaixo();
  assert.equal(t.d.activeElement, t.d.body, 'o foco foi pra um botão travado');
  assert.equal(t.app.pendente(), '.card-btn-reject', 'com o card travado, o ✕ não ficou prometido');
  t.estado.travado = false;
  for (const b of Object.values(t.card.bs)) b.disabled = false;
  t.app.aplicarFocoDoTeclado();
  assert.equal(t.d.activeElement, t.card.bs['.card-btn-reject'], 'destravado, o foco não pousou no ✕');
});

function montarFolha({ travado = false } = {}) {
  const d = documentoDeMentira();
  const card = (nome) => {
    const bs = { '.card-btn-reject': botaoQuePerde(d, nome + ':✕'), '.card-btn-skip': botaoQuePerde(d, nome + ':↑'),
      '.card-btn-read': botaoQuePerde(d, nome + ':✓') };
    for (const b of Object.values(bs)) b.disabled = travado;
    return { bs, querySelector: (s) => bs[s] || null };
  };
  const seloReinc = botaoQuePerde(d, '✕ N');            // no card do autor, que o lote tira da tela
  const estado = { travado, card: card('x1'), lote: null };
  let app;
  const deps = {
    document: d, acoesTravadas: () => estado.travado, cardDaFrente: () => estado.card,
    topOpenModal: () => null, Lightbox: { isOpen: () => false }, MapaLightbox: { isOpen: () => false },
    // `closeModal` devolve o foco a quem abriu a folha: o "✕ N".
    closeModal: () => seloReinc.focus(),
    // O lote tira o card (e o "✕ N") da tela, o próximo nasce, e o card que
    // nasce aplica o foco prometido (`renderCurrentCard`).
    rejeitarLoteDoAutor: (place, contados) => {
      estado.lote = contados;
      seloReinc.isConnected = false;
      if (d.activeElement === seloReinc) d.activeElement = d.body;
      estado.card = card('y1');
      app.aplicarFocoDoTeclado();
    },
  };
  const nomes = Object.keys(deps);
  app = new Function(...nomes, [
    'let focoDoTeclado = null;', fatiar('focavelNaTela'), constante('BOTAO_DA_ACAO'),
    fatiar('veioDoTeclado'), fatiar('aplicarFocoDoTeclado'), fatiar('rejeitarPelaFolha'),
    'return { rejeitarPelaFolha, aplicarFocoDoTeclado, pendente: () => focoDoTeclado };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  const rejeitar = botaoQuePerde(d, 'Rejeitar os 2');
  return { app, estado, d, rejeitar };
}

test('R5-2-06: "Rejeitar os N" pelo TECLADO promete o ✕ do card que fica (e pousa quando destravar)', () => {
  const m = montarFolha();
  m.rejeitar.focus();
  m.app.rejeitarPelaFolha({ detail: 0, currentTarget: m.rejeitar }, {}, ['v1|u1', 'v2|u2']);
  assert.deepEqual(m.estado.lote, ['v1|u1', 'v2|u2'], 'o lote não recebeu as chaves que a folha contou');
  assert.equal(m.d.activeElement, m.estado.card.bs['.card-btn-reject'],
    `DEFEITO: "Rejeitar os 2" pelo teclado largou o foco em ${m.d.activeElement && m.d.activeElement.nome}`);
  // Com a janela do Desfazer: o card novo nasce travado, e o ✕ pousa quando ela acaba.
  const t = montarFolha({ travado: true });
  t.rejeitar.focus();
  t.app.rejeitarPelaFolha({ detail: 0, currentTarget: t.rejeitar }, {}, ['v1|u1']);
  assert.equal(t.d.activeElement, t.d.body, 'o foco foi pra um botão travado');
  assert.equal(t.app.pendente(), '.card-btn-reject', 'na janela do Desfazer o ✕ não ficou prometido');
  t.estado.travado = false;
  for (const b of Object.values(t.estado.card.bs)) b.disabled = false;
  t.app.aplicarFocoDoTeclado();
  assert.equal(t.d.activeElement, t.estado.card.bs['.card-btn-reject'], 'a janela acabou e o foco não pousou no ✕');
  // CONTROLES: o mouse e o dedo (detail 1) e o .click() de script não movem o foco.
  for (const [rotulo, ev, focado] of [['mouse', { detail: 1 }, true], ['script', { detail: 0 }, false]]) {
    const c = montarFolha();
    if (focado) c.rejeitar.focus(); else c.d.activeElement = c.d.body;
    c.app.rejeitarPelaFolha({ ...ev, currentTarget: c.rejeitar }, {}, ['v1|u1']);
    assert.equal(c.d.activeElement, c.d.body, `${rotulo}: o "Rejeitar os N" moveu o foco pro card`);
    assert.equal(c.app.pendente(), null, `${rotulo}: o foco ficou prometido sem o teclado`);
  }
});

test('R5-2-05/06: os pontos de entrada — a trava guarda ANTES de desabilitar, e a folha decide ANTES de fechar', () => {
  const trava = fatiar('aplicarTravaDeAcao');
  const iGuarda = trava.indexOf('if (travado) guardarFocoDaTrava(card);');
  const iDisabled = trava.indexOf('b.disabled = travado');
  assert.ok(iGuarda > 0 && iDisabled > iGuarda, 'a trava guarda o foco DEPOIS de desabilitar (o botão já o perdeu)');
  const folha = fatiar('rejeitarPelaFolha');
  const iTeclado = folha.indexOf('const peloTeclado = veioDoTeclado(ev);');
  const iFecha = folha.indexOf("closeModal('autorModal');");
  assert.ok(iTeclado >= 0 && iFecha > iTeclado, 'a folha decide se veio do teclado DEPOIS de fechar (o foco já não é do botão)');
  assert.match(fatiar('aoMudarAFilaPorBaixo'), /const seloFocado = seloComFoco\(velho\);\s*if \(velho\) velho\.remove\(\);/,
    'o selo focado é lido DEPOIS de os selos velhos saírem (o foco já caiu no <body>)');
});

// ── O "Ver os N" da FOLHA pelo teclado (follow-up do R5-2-06) ────────────────
// Enter no "✕ N" abre a folha; Enter em "Ver os N" fecha a folha — que devolve
// o foco ao "✕ N" — e o `focarAutor` remonta o card: o selo sai com ele e o foco
// caía no <body> (MEDIDO no navegador, s19b). Vai à barra "Primeiro os de…", o
// caminho de volta, como no Enter do selo "Ver +N". As funções de verdade.
function montarFolhaVer({ comSerie = true } = {}) {
  const d = documentoDeMentira();
  const seloReinc = botaoQuePerde(d, '✕ N');
  let barraNaTela = false;
  const barra = botaoQuePerde(d, 'Primeiro os de…', { getClientRects: () => (barraNaTela ? [1] : []) });
  d.getElementById = (id) => (id === 'focoAutorBar' ? barra : null);
  const chamou = [];
  const deps = {
    document: d,
    closeModal: () => seloReinc.focus(),           // a folha devolve o foco a quem a abriu
    focarAutor: (id) => {
      chamou.push(id);
      if (!comSerie) return;                       // nenhum pedido do autor na fila: nada muda
      seloReinc.isConnected = false;               // o card é remontado e o selo sai com ele
      if (d.activeElement === seloReinc) d.activeElement = d.body;
      barraNaTela = true;                          // a barra "Primeiro os de…" aparece
    },
    cardDaFrente: () => null,
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    'let focoDoTeclado = null;', fatiar('focavelNaTela'), constante('BOTAO_DA_ACAO'),
    fatiar('veioDoTeclado'), fatiar('focarDepoisDoFocoNoAutor'), fatiar('verPelaFolha'),
    'return { verPelaFolha };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  return { app, d, ver: botaoQuePerde(d, 'Ver os 2'), barra, seloReinc, chamou };
}

test('"Ver os N" da FOLHA pelo TECLADO leva o foco à barra "Primeiro os de…" — como o Enter no selo "Ver +N"', () => {
  const m = montarFolhaVer();
  m.ver.focus();
  m.app.verPelaFolha({ detail: 0, currentTarget: m.ver }, { creatorId: 777 });
  assert.deepEqual(m.chamou, [777], 'o "Ver os N" deixou de pôr a série do autor na frente');
  assert.equal(m.d.activeElement, m.barra,
    `DEFEITO: pelo teclado o foco ficou em ${m.d.activeElement && m.d.activeElement.nome} em vez da barra`);
  // CONTROLES: o mouse e o dedo (detail 1) e o .click() de script não movem o foco.
  for (const [rotulo, ev, focado] of [['mouse', { detail: 1 }, true], ['script', { detail: 0 }, false]]) {
    const c = montarFolhaVer();
    if (focado) c.ver.focus(); else c.d.activeElement = c.d.body;
    c.app.verPelaFolha({ ...ev, currentTarget: c.ver }, { creatorId: 777 });
    assert.deepEqual(c.chamou, [777], `${rotulo}: o "Ver os N" deixou de pôr a série na frente`);
    assert.notEqual(c.d.activeElement, c.barra, `${rotulo}: o foco foi pra barra sem o teclado (o foco pulando pela tela)`);
  }
  // Sem pedidos do autor na fila (nada é remontado): o foco fica no "✕ N" que a folha devolveu.
  const s = montarFolhaVer({ comSerie: false });
  s.ver.focus();
  s.app.verPelaFolha({ detail: 0, currentTarget: s.ver }, { creatorId: 777 });
  assert.equal(s.d.activeElement, s.seloReinc, 'sem série a remontar, o foco saiu do "✕ N" que a folha devolveu');
});

test('"Ver os N" da FOLHA: o ouvinte passa o evento (sem ele o teclado não é reconhecido)', () => {
  assert.match(fatiar('abrirFolhaDoAutor'), /getElementById\('autorVer'\)\.addEventListener\('click', \(ev\) => verPelaFolha\(ev, place\)\);/,
    'o "Ver os N" da folha voltou a não saber se veio do teclado');
});

// ── R6-2-12: o "Esquecer" da FOLHA pelo teclado ─────────────────────────────────
// Enter no "✕ N" abre a folha; Enter em "Esquecer" fecha a folha — que devolve o
// foco ao "✕ N" — e o card é refeito sem o selo (a contagem foi apagada): o foco
// caía no <body> (MEDIDO no navegador, s44, Chromium e WebKit; o CONTROLE, Esc na
// folha, volta ao "✕ N"). O terceiro botão que fecha a folha, com o destino da
// barra que some: o "Ver +N" do card, se houver; senão ✕ ↑ ✓ (e, travado, o ✕
// prometido). As funções de verdade.
function montarFolhaEsquecer({ comVerMais = false, travado = false } = {}) {
  const d = documentoDeMentira();
  const seloReinc = botaoQuePerde(d, '✕ N');
  const novoCard = () => {
    const bs = { '.card-btn-reject': botaoQuePerde(d, '✕'), '.card-btn-skip': botaoQuePerde(d, '↑'),
      '.card-btn-read': botaoQuePerde(d, '✓') };
    for (const b of Object.values(bs)) b.disabled = travado;
    if (comVerMais) bs['.selo-lote'] = botaoQuePerde(d, 'Ver +1');
    return { bs, querySelector: (s) => bs[s] || null };
  };
  const estado = { card: null, esqueceu: null };
  const deps = {
    document: d, cardDaFrente: () => estado.card,
    closeModal: () => seloReinc.focus(),             // a folha devolve o foco a quem a abriu
    esquecerAutor: (chave) => { estado.esqueceu = chave; },
    // O card sai — e o "✕ N" com ele —, e o refeito nasce sem o selo.
    removeCurrentCardEl: () => { seloReinc.isConnected = false; if (d.activeElement === seloReinc) d.activeElement = d.body; },
    showCurrentPlace: () => { estado.card = novoCard(); },
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    'let focoDoTeclado = null;', fatiar('focavelNaTela'), constante('BOTAO_DA_ACAO'),
    fatiar('veioDoTeclado'), fatiar('focarDepoisDoFocoNoAutor'), fatiar('esquecerPelaFolha'),
    'return { esquecerPelaFolha, pendente: () => focoDoTeclado };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  return { app, d, estado, esquecer: botaoQuePerde(d, 'Esquecer') };
}

test('R6-2-12: "Esquecer" da FOLHA pelo TECLADO leva o foco ao card refeito — ao "Ver +N", senão ao ✕', () => {
  const m = montarFolhaEsquecer();
  m.esquecer.focus();
  m.app.esquecerPelaFolha({ detail: 0, currentTarget: m.esquecer }, '777');
  assert.equal(m.estado.esqueceu, '777', 'o "Esquecer" deixou de esquecer pela chave');
  assert.equal(m.d.activeElement, m.estado.card.bs['.card-btn-reject'],
    `DEFEITO: pelo teclado o foco ficou em ${m.d.activeElement && m.d.activeElement.nome}`);
  // Com outro pedido do autor na fila, o card refeito tem o "Ver +N" — é ele o primeiro.
  const v = montarFolhaEsquecer({ comVerMais: true });
  v.esquecer.focus();
  v.app.esquecerPelaFolha({ detail: 0, currentTarget: v.esquecer }, '777');
  assert.equal(v.d.activeElement, v.estado.card.bs['.selo-lote'], 'com o "Ver +N" no card, o foco não foi a ele');
  // Travado (a janela do Desfazer de antes ainda corre): o ✕ fica prometido.
  const t = montarFolhaEsquecer({ travado: true });
  t.esquecer.focus();
  t.app.esquecerPelaFolha({ detail: 0, currentTarget: t.esquecer }, '777');
  assert.equal(t.app.pendente(), '.card-btn-reject', 'com o card travado o ✕ não ficou prometido');
  // CONTROLES: o mouse e o dedo (detail 1) e o .click() de script não movem o foco.
  for (const [rotulo, ev, focado] of [['mouse', { detail: 1 }, true], ['script', { detail: 0 }, false]]) {
    const c = montarFolhaEsquecer();
    if (focado) c.esquecer.focus(); else c.d.activeElement = c.d.body;
    c.app.esquecerPelaFolha({ ...ev, currentTarget: c.esquecer }, '777');
    assert.equal(c.estado.esqueceu, '777');
    assert.equal(c.d.activeElement, c.d.body, `${rotulo}: o "Esquecer" moveu o foco pro card`);
    assert.equal(c.app.pendente(), null, `${rotulo}: o foco ficou prometido sem o teclado`);
  }
});

// ── R6-2-13: "Verificar novamente" e "Tentar novamente" pelo teclado ────────────
// Os dois somem com o painel quando o card volta, com o foco neles: pelo teclado
// o foco caía no <body> (MEDIDO no navegador, s45; pelo mouse também fica no
// <body>, o esperado). O foco é prometido ao ✕ do card que chega — e o painel
// ESCONDIDO ainda segura o foco até o próximo desenho do navegador: o card que
// chega antes disso não pode ler esse foco como "a pessoa foi pra outro lugar".
function montarPainel() {
  const d = documentoDeMentira();
  const estado = { travado: false, card: null };
  const deps = {
    document: d, acoesTravadas: () => estado.travado, cardDaFrente: () => estado.card, topOpenModal: () => null,
    Lightbox: { isOpen: () => false }, MapaLightbox: { isOpen: () => false },
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    'let focoDoTeclado = null;', fatiar('focavelNaTela'), constante('BOTAO_DA_ACAO'),
    fatiar('veioDoTeclado'), fatiar('aplicarFocoDoTeclado'), fatiar('prometerFocoAoCardQueVem'),
    'return { prometerFocoAoCardQueVem, aplicarFocoDoTeclado, pendente: () => focoDoTeclado };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  let naTela = true;
  const botao = botaoQuePerde(d, 'Verificar novamente', { getClientRects: () => (naTela ? [1] : []) });
  const cardNovo = ({ semFoto = false } = {}) => {
    const bs = { '.card-btn-reject': botaoQuePerde(d, '✕'), '.card-btn-skip': botaoQuePerde(d, '↑'),
      '.card-btn-read': botaoQuePerde(d, '✓') };
    if (semFoto) { bs['.card-btn-reject'].disabled = true; bs['.card-btn-read'].disabled = true; }
    return { bs, querySelector: (s) => bs[s] || null };
  };
  // O toque/Enter no botão; o painel some (o navegador ainda não tirou o foco
  // dele); o card chega e o `renderCurrentCard` aplica o foco prometido.
  const usar = (ev, { foco = true, card = {} } = {}) => {
    d.activeElement = foco ? botao : d.body;
    app.prometerFocoAoCardQueVem({ ...ev, currentTarget: botao });
    naTela = false;
    estado.card = cardNovo(card);
    app.aplicarFocoDoTeclado();
  };
  return { app, d, estado, botao, usar };
}

test('R6-2-13: pelo TECLADO, o card que volta recebe o foco — mesmo com o painel ainda segurando o foco escondido', () => {
  const m = montarPainel();
  m.usar({ detail: 0 });
  assert.equal(m.d.activeElement, m.estado.card.bs['.card-btn-reject'],
    `DEFEITO: o card voltou e o foco ficou em ${m.d.activeElement && m.d.activeElement.nome}`);
  assert.equal(m.app.pendente(), null);
  // Card de FOTO sem a foto: ✕ e ✓ travados, o ↑ é o vivo.
  const f = montarPainel();
  f.usar({ detail: 0 }, { card: { semFoto: true } });
  assert.equal(f.d.activeElement, f.estado.card.bs['.card-btn-skip'], 'o card sem foto não recebeu o foco no ↑');
  // CONTROLES: o mouse e o dedo (detail 1) e o .click() de script não movem o foco.
  for (const [rotulo, ev, foco] of [['mouse', { detail: 1 }, true], ['script', { detail: 0 }, false]]) {
    const c = montarPainel();
    c.usar(ev, { foco });
    assert.notEqual(c.d.activeElement, c.estado.card.bs['.card-btn-reject'], `${rotulo}: o foco pulou pro card`);
    assert.equal(c.app.pendente(), null, `${rotulo}: o foco ficou prometido sem o teclado`);
  }
  // E quem pôs o foco num controle VIVO segue ganhando (o Tab durante a busca).
  const t = montarPainel();
  t.d.activeElement = t.botao;
  t.app.prometerFocoAoCardQueVem({ detail: 0, currentTarget: t.botao });
  const filtros = botaoQuePerde(t.d, 'Filtros');
  filtros.focus();
  t.estado.card = { bs: {}, querySelector: () => botaoQuePerde(t.d, '✕') };
  t.app.aplicarFocoDoTeclado();
  assert.equal(t.d.activeElement, filtros, 'o foco foi arrancado de onde a pessoa o pôs');
});

test('R6-2-13: os dois botões dos painéis prometem o foco ANTES de trocar a fila (e antes do `await`)', () => {
  const ouvintes = fatiar('setupAppListeners');
  assert.match(ouvintes, /\$\('reloadBtn'\)\.addEventListener\('click', \(ev\) => \{\s*prometerFocoAoCardQueVem\(ev\);\s*resetQueue\(\);\s*startFetching\(\);/,
    'o "Verificar novamente" pelo teclado larga o foco no <body> quando o card volta');
  assert.match(ouvintes, /\$\('retryLoadBtn'\)\?\.addEventListener\('click', async \(ev\) => \{\s*prometerFocoAoCardQueVem\(ev\);\s*if \(await /,
    'o "Tentar novamente" pelo teclado larga o foco no <body> (ou decide depois do `await`, quando o evento já não diz nada)');
});

// ── O redesenho do MESMO card não é "Novo pedido" (follow-up do lote 10) ──────
// A região viva do card (`#cardLiveRegion`) diz "Novo pedido: <local>, <tipo>"
// a quem usa leitor de tela. O card é REDESENHADO por muita coisa que não troca
// o pedido da frente — a foto excluída sem o Desfazer, a foto que volta pelo
// Desfazer —, e cada redesenho repetia o anúncio do mesmo pedido (MEDIDO nos
// dois motores: excluir e desfazer pela tecla z davam dois "Novo pedido" do
// mesmo local). O `renderCurrentCard` e o `showNoPlaces` de VERDADE; o resto da
// tela é um buraco negro que aceita qualquer chamada.
function buracoNegro() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro()),
    apply: () => buracoNegro(), set: () => true,
  });
}
// Um painel da fila vazia (`#noMoreCards`, `#loadErrorState`): o que o
// `showNoPlaces`, o `renderCurrentCard` e o `aplicarFocoDoTeclado` leem dele.
function painelDeMentira() {
  const classes = new Set(['hidden']);   // nascem escondidos, como no HTML
  return {
    dataset: {}, offsetWidth: 0, querySelector: () => buracoNegro(),
    classList: {
      contains: (c) => classes.has(c),
      add: (...cs) => { for (const c of cs) classes.add(c); },
      remove: (...cs) => { for (const c of cs) classes.delete(c); },
    },
  };
}
function cardQueAnuncia() {
  const ditos = [];
  const regiao = { set textContent(v) { ditos.push(v); }, get textContent() { return ditos.at(-1) || ''; } };
  const AppState = { queue: [], hasMore: false, currentPlace: null, loadError: false };
  // Os painéis e os botões deles, de verdade o bastante: o botão só está NA
  // TELA com o painel dele à mostra (o `focavelNaTela` lê `getClientRects`).
  const d = documentoDeMentira();
  const paineis = { noMoreCards: painelDeMentira(), loadErrorState: painelDeMentira() };
  const naTela = (painel) => () => (paineis[painel].classList.contains('hidden') ? [] : [1]);
  const botoes = {
    reloadBtn: botaoQuePerde(d, 'Verificar novamente', { getClientRects: naTela('noMoreCards') }),
    retryLoadBtn: botaoQuePerde(d, 'Tentar novamente', { getClientRects: naTela('loadErrorState') }),
  };
  d.getElementById = (id) => (id === 'cardLiveRegion' ? regiao : paineis[id] || botoes[id] || buracoNegro());
  // O card da frente, quando há um (o `cardDaFrente`): sair da tela leva o
  // foco que estava num botão dele (o navegador).
  const estado = { card: null, travado: false, pulados: 0 };
  const cardNaTela = () => {
    const bs = { '.card-btn-reject': botaoQuePerde(d, '✕'), '.card-btn-skip': botaoQuePerde(d, '↑'),
      '.card-btn-read': botaoQuePerde(d, '✓') };
    estado.card = { bs, querySelector: (s) => bs[s] || null };
    return estado.card;
  };
  const tirarCard = () => {
    if (!estado.card) return;
    const bs = Object.values(estado.card.bs);
    for (const b of bs) b.isConnected = false;
    if (bs.includes(d.activeElement)) d.activeElement = d.body;
    estado.card = null;
  };
  const deps = {
    AppState, pedidoAnunciado: null, primeiroCardAnotado: true, focoDoTeclado: null,
    t: (k, v) => (v ? `${k}:${v.name}` : k), identidadeDoPlace: (p) => ({ titulo: p.name }), rotuloDoTipo: () => '',
    document: d, navigator: { onLine: true },
    cardDaFrente: () => estado.card, removeCurrentCardEl: tirarCard, puladosNestaFila: () => estado.pulados,
    acoesTravadas: () => estado.travado, topOpenModal: () => null,
    Lightbox: { isOpen: () => false }, MapaLightbox: { isOpen: () => false },
  };
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : typeof k === 'string' ? buracoNegro() : undefined),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const app = new Function('__escopo', `with (__escopo) {\n${constante('BOTAO_DA_ACAO')}\n${fatiar('focavelNaTela')}
    ${fatiar('pedirFocoDoTeclado')}\n${fatiar('aplicarFocoDoTeclado')}\n${fatiar('renderCurrentCard')}\n${fatiar('showNoPlaces')}
    return { renderCurrentCard, showNoPlaces, pedirFocoDoTeclado, aplicarFocoDoTeclado };\n}`)(escopo);
  return { app, AppState, ditos, d, deps, estado, paineis, botoes, cardNaTela, tirarCard };
}

test('o card REDESENHADO com o mesmo pedido na frente não anuncia "Novo pedido" — o pedido que MUDA, sim', () => {
  const m = cardQueAnuncia();
  const A = { name: 'Padaria A' }, B = { name: 'Padaria B' };
  m.AppState.queue = [A, B];
  m.app.renderCurrentCard();
  assert.deepEqual(m.ditos, ['card.live.newRequest:Padaria A'], 'CONTROLE: o primeiro card não foi anunciado');
  m.app.renderCurrentCard();                       // o redesenho (a foto excluída, a que volta)
  m.app.renderCurrentCard();
  assert.deepEqual(m.ditos, ['card.live.newRequest:Padaria A'],
    'o redesenho do MESMO card repetiu "Novo pedido" ao leitor de tela');
  m.AppState.queue.shift();                        // o ✕: o pedido da frente muda
  m.app.renderCurrentCard();
  assert.equal(m.ditos.at(-1), 'card.live.newRequest:Padaria B', 'CONTROLE: o pedido novo na frente não foi anunciado');
  m.AppState.queue.unshift(A);                     // o Desfazer devolve A pra frente
  m.app.renderCurrentCard();
  assert.equal(m.ditos.at(-1), 'card.live.newRequest:Padaria A', 'o pedido que VOLTOU pra frente não foi anunciado');
  assert.equal(m.ditos.length, 3);
});

test('a frente que fica VAZIA zera o anúncio: o mesmo pedido que volta a ela é dito de novo', () => {
  const A = { name: 'Padaria A' };
  // Pelo próprio `renderCurrentCard` (a fila acabou e ainda há o que buscar).
  const m = cardQueAnuncia();
  m.AppState.queue = [A];
  m.app.renderCurrentCard();
  m.AppState.queue = []; m.AppState.hasMore = true;
  m.app.renderCurrentCard();
  m.AppState.queue = [A];                          // o Desfazer do último devolve o MESMO pedido
  m.app.renderCurrentCard();
  assert.deepEqual(m.ditos, ['card.live.newRequest:Padaria A', 'card.live.newRequest:Padaria A'],
    'o pedido que voltou à frente vazia não foi anunciado');
  // Pelo "Tudo limpo!" direto (`showNoPlaces`, o lote que leva a fila inteira).
  // O fim da fila é dito no meio (R7-2-06, abaixo).
  const n = cardQueAnuncia();
  n.AppState.queue = [A];
  n.app.renderCurrentCard();
  n.app.showNoPlaces();
  n.app.renderCurrentCard();
  assert.deepEqual(n.ditos, ['card.live.newRequest:Padaria A', 'states.empty.title', 'card.live.newRequest:Padaria A'],
    'depois do "Tudo limpo!", o pedido que voltou à frente não foi anunciado');
});

// ── R7-2-06: o botão que some com o ÚLTIMO card, e o fim da fila ────────────────
// O C10 leva o foco do ✕ ↑ ✓ ao botão equivalente do card que chega — e, quando
// a decisão esvaziava a fila, não chegava card nenhum: o foco caía no <body> (o
// Tab seguinte recomeçava do topo da página), e nenhuma região viva mudava — quem
// usa leitor de tela não ouvia nem o fim da fila. MEDIDO nos dois motores
// (auditoria de 2026-10-02, R7-2-06: t06 e t08). O mesmo no "Verificar novamente"
// que volta sem nada e no "Rejeitar os N" que leva o resto da fila. As funções de
// VERDADE (`showNoPlaces`, `aplicarFocoDoTeclado`, `renderCurrentCard`); a tela é
// o painel de mentira e o resto, buraco negro.
// O Enter no botão do card, com ele focado (o `fireAction`), e o card saindo.
function enterNoUltimo(m, sel = '.card-btn-reject', acao = 'left') {
  const b = m.estado.card.bs[sel];
  b.focus();
  m.app.pedirFocoDoTeclado(b, true, acao);
  assert.equal(m.deps.focoDoTeclado, sel, 'PRÉ-CONDIÇÃO: o Enter no botão focado não prometeu o foco');
}
const microtarefas = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('R7-2-06: Enter no ✕ (ou ↑) do ÚLTIMO card pelo TECLADO — o foco vai ao "Verificar novamente", e o fim é dito', async () => {
  for (const [sel, acao, pulados, titulo] of [['.card-btn-reject', 'left', 0, 'states.empty.title'],
    ['.card-btn-skip', 'up', 1, 'states.empty.titlePulados']]) {
    const m = cardQueAnuncia();
    m.cardNaTela();
    enterNoUltimo(m, sel, acao);
    m.estado.pulados = pulados;
    m.app.showNoPlaces();                          // o `advanceQueue`: a fila acabou
    assert.equal(m.d.activeElement, m.d.body, 'PRÉ-CONDIÇÃO: o card não saiu com o foco');
    await microtarefas();
    assert.equal(m.d.activeElement, m.botoes.reloadBtn,
      `${acao}: DEFEITO — a fila acabou pelo teclado e o foco ficou em ${m.d.activeElement && m.d.activeElement.nome}`);
    assert.equal(m.deps.focoDoTeclado, null, `${acao}: o pedido de foco ficou pendurado depois de pousar`);
    assert.deepEqual(m.ditos, [titulo], `${acao}: o fim da fila não foi dito ao leitor de tela (ou foi outra coisa)`);
  }
});

test('R7-2-06: na FALHA ao carregar o foco vai ao "Tentar novamente" — e o anúncio é do painel dela (`role="alert"`), não repetido', async () => {
  const m = cardQueAnuncia();
  m.cardNaTela();
  enterNoUltimo(m);
  m.AppState.loadError = true;
  m.app.showNoPlaces();
  await microtarefas();
  assert.equal(m.d.activeElement, m.botoes.retryLoadBtn, `a falha ao carregar largou o foco em ${m.d.activeElement && m.d.activeElement.nome}`);
  assert.deepEqual(m.ditos, [], 'a falha foi dita também pela região do card: o painel dela já é `role="alert"` (dita duas vezes)');
  // O motivo de não repetir mora no HTML: o painel da falha se anuncia, o do fim da fila não.
  const html = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
  const abre = (id) => (new RegExp(`<div id="${id}"[^>]*>`).exec(html) || [''])[0];
  assert.match(abre('loadErrorState'), /role="alert"/, 'o painel da falha deixou de ser região viva: o anúncio dele sumiu');
  assert.doesNotMatch(abre('noMoreCards'), /aria-live|role="(status|alert|log)"/,
    'o painel do fim da fila virou região viva: o título seria dito duas vezes');
  // Os ids que o foco consulta existem, e cada botão mora no SEU painel (gotcha
  // #68: id errado devolve `null` e o foco cai no <body> sem dizer nada).
  const pos = (s) => html.indexOf(s);
  for (const [botao, de, ate] of [['reloadBtn', 'id="noMoreCards"', 'id="loadErrorState"'],
    ['retryLoadBtn', 'id="loadErrorState"', '<template id="cardTemplate"']]) {
    const j = pos(`id="${botao}"`);
    assert.ok(pos(de) > 0 && j > pos(de) && j < pos(ate), `o ${botao} não mora no painel dele (${de})`);
  }
});

test('R7-2-06: com o Desfazer o foco ESPERA a janela — e a tecla z, que devolve o card, leva o foco ao botão dele', async () => {
  // A janela acaba: o foco pousa no "Verificar novamente" (a trava que muda o aplica).
  const m = cardQueAnuncia();
  m.cardNaTela();
  enterNoUltimo(m);
  m.app.showNoPlaces();
  m.estado.travado = true;                         // o `scheduleAction` do MESMO gesto abre a janela logo depois
  await microtarefas();
  assert.equal(m.d.activeElement, m.d.body, 'o foco foi pro painel com a janela do Desfazer correndo');
  assert.equal(m.deps.focoDoTeclado, '.card-btn-reject', 'a janela apagou o pedido de foco');
  m.estado.travado = false;
  m.app.aplicarFocoDoTeclado();                    // o `aplicarTravaDeAcao` do fim da janela
  assert.equal(m.d.activeElement, m.botoes.reloadBtn, 'a janela acabou e o foco não pousou no "Verificar novamente"');
  // A tecla z na janela: o card VOLTA, e o foco vai ao ✕ dele (o que o C10 já fazia).
  const z = cardQueAnuncia();
  const A = { name: 'Padaria A' };
  z.AppState.queue = [A];
  z.app.renderCurrentCard();
  z.cardNaTela();
  enterNoUltimo(z);
  z.AppState.queue = [];
  z.app.showNoPlaces();
  z.estado.travado = true;
  await microtarefas();
  z.AppState.queue = [A];                          // o `undo()`: o pedido volta pra frente
  z.app.renderCurrentCard();
  z.cardNaTela();
  z.estado.travado = false;
  await microtarefas();
  z.app.aplicarFocoDoTeclado();                    // e o `desfazerAcaoPendente` destrava
  assert.equal(z.d.activeElement, z.estado.card.bs['.card-btn-reject'],
    `o Desfazer devolveu o card e o foco ficou em ${z.d.activeElement && z.d.activeElement.nome} — o painel o tomou antes da janela acabar`);
  assert.deepEqual(z.ditos, ['card.live.newRequest:Padaria A', 'states.empty.title', 'card.live.newRequest:Padaria A']);
});

test('R7-2-06: CONTROLES — sem o teclado nada se move, o lugar que a pessoa escolheu ganha, e sem painel a promessa espera', async () => {
  // O mouse e o dedo (sem promessa): o fim é dito, o foco não pula pela tela.
  const mouse = cardQueAnuncia();
  mouse.cardNaTela().bs['.card-btn-reject'].focus();   // o clique foca o botão (no Chromium), sem prometer nada
  mouse.app.showNoPlaces();
  await microtarefas();
  assert.equal(mouse.d.activeElement, mouse.d.body, 'sem o teclado, o fim da fila pôs o foco no painel (o foco pulando pela tela)');
  assert.deepEqual(mouse.ditos, ['states.empty.title'], 'o fim da fila não foi dito a quem usa leitor de tela pelo toque');
  // A pessoa deu Tab pra outro lugar antes de o foco pousar: o lugar dela ganha.
  const tab = cardQueAnuncia();
  tab.cardNaTela();
  enterNoUltimo(tab);
  tab.app.showNoPlaces();
  const filtros = botaoQuePerde(tab.d, 'Filtros');
  filtros.focus();
  await microtarefas();
  assert.equal(tab.d.activeElement, filtros, 'o foco foi arrancado de onde a pessoa o pôs');
  assert.equal(tab.deps.focoDoTeclado, null);
  // Sem painel na tela (a busca ainda corre): a promessa espera, e o card que chega a leva.
  const busca = cardQueAnuncia();
  busca.cardNaTela();
  enterNoUltimo(busca);
  busca.tirarCard();
  busca.app.aplicarFocoDoTeclado();
  assert.equal(busca.d.activeElement, busca.d.body, 'sem card nem painel, o foco foi parar em algum lugar');
  assert.equal(busca.deps.focoDoTeclado, '.card-btn-reject', 'sem card nem painel, a promessa caiu');
  busca.cardNaTela();
  busca.app.aplicarFocoDoTeclado();
  assert.equal(busca.d.activeElement, busca.estado.card.bs['.card-btn-reject'], 'o card que chegou depois da busca não recebeu o foco');
});

test('R7-2-06: o fim é dito quando o painel APARECE — redesenhado na tela, não repete; depois de um card, diz de novo', () => {
  const m = cardQueAnuncia();
  m.app.showNoPlaces();
  m.app.showNoPlaces();                            // desenhado de novo, já na tela
  assert.deepEqual(m.ditos, ['states.empty.title'], 'o painel redesenhado repetiu o fim da fila');
  m.AppState.queue = [{ name: 'Padaria A' }];      // o "Verificar novamente" trouxe um pedido
  m.app.renderCurrentCard();
  m.AppState.queue = [];
  m.app.showNoPlaces();                            // e a decisão esvaziou a fila de novo
  assert.deepEqual(m.ditos, ['states.empty.title', 'card.live.newRequest:Padaria A', 'states.empty.title']);
});
