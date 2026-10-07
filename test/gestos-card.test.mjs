// OS GESTOS DO CARD QUE NÃO PODEM DECIDIR PEDIDO — auditoria de 2026-09-26.
//
// O `swipe.js` roda de VERDADE aqui, num documento de mentira: os eventos são
// despachados na ordem em que o navegador os despacha, e o que se confere é o
// desfecho — se `onSwipeLeft/Right/Up` foi chamado. Guard de texto não
// serviria: o defeito de cada item abaixo era uma ORDEM de eventos, não uma
// linha ausente. A prova no navegador de verdade (toque por CDP, mouse do
// Playwright) mora no `tools/smoke-browser.mjs`, bloco "GESTOS QUE NÃO
// DECIDEM"; este arquivo é o que roda no `npm test`, sem browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SWIPE = readFileSync(new URL('../js/swipe.js', import.meta.url), 'utf8');

// Um card na tela, os ouvintes do `document`, um relógio que ANDA (o flick
// mede velocidade: com o relógio parado todo arraste viraria flick) e o
// registro do que o gesto decidiu.
function montar({ largura = 400 } = {}) {
  const ouvintes = {};
  const doc = {
    addEventListener: (t, fn) => { (ouvintes[t] ||= new Set()).add(fn); },
    removeEventListener: (t, fn) => { if (ouvintes[t]) ouvintes[t].delete(fn); },
  };
  const decidiu = [];
  const relogio = { agora: 1000 };
  // Timers ADIADOS até o `esvaziar()`: o clique que o navegador gera junto do
  // `mouseup` chega ANTES de qualquer `setTimeout` — com timer imediato, a
  // armadilha do clique se desarmaria antes de ele existir.
  const timers = [];
  const ctx = {
    document: doc, window: { innerWidth: largura }, navigator: {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    performance: { now: () => relogio.agora }, console,
    onSwipeLeft: (card) => decidiu.push(['left', card]),
    onSwipeRight: (card) => decidiu.push(['right', card]),
    onSwipeUp: (card) => decidiu.push(['up', card]),
  };
  vm.createContext(ctx);
  vm.runInContext(SWIPE + '\nthis.__estado = () => ({ isDragging, dragTouchId, animating });', ctx);
  const ouvintesDoCard = {};
  // Os selos do gesto (`.swipe-left` …) guardam a opacidade que o arraste pôs.
  const selos = {};
  const card = {
    style: {}, classList: { add() {}, remove() {}, contains: () => false },
    querySelector: (sel) => (selos[sel] ||= { style: {}, querySelector: () => null }),
    addEventListener: (t, fn) => { (ouvintesDoCard[t] ||= []).push(fn); },
  };
  ctx.enableSwipeOnCard(card);
  const alvo = { closest: () => null };
  const ev = (type, extra = {}) => ({ type, target: alvo, currentTarget: card, preventDefault() { this.cancelado = true; }, ...extra });
  const toque = (identifier, clientX, clientY) => ({ identifier, clientX, clientY });
  // Despacho: `touchstart`/`mousedown` nascem NO card; move/fim vão pro `document`.
  const noCard = (type, extra) => { const e = ev(type, extra); for (const fn of ouvintesDoCard[type] || []) fn(e); return e; };
  const noDoc = (type, extra) => { const e = ev(type, extra); for (const fn of [...(ouvintes[type] || [])]) fn(e); return e; };
  const passo = (ms = 16) => { relogio.agora += ms; };
  const esvaziar = () => { while (timers.length) timers.shift()(); };
  return { ctx, card, selos, decidiu, noCard, noDoc, toque, passo, esvaziar, estado: () => ctx.__estado(), ouvintes, ouvintesDoCard };
}

// Um dedo de (x0,y0) a (x1,y1) em `n` passos DEVAGAR — abaixo da velocidade
// de flick, pra só a distância decidir.
function arrastarDevagar(g, id, [x0, y0], [x1, y1], n = 20) {
  const t0 = g.toque(id, x0, y0);
  g.noCard('touchstart', { touches: [t0], changedTouches: [t0] });
  let t = t0;
  for (let i = 1; i <= n; i++) {
    g.passo(40);
    t = g.toque(id, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
    g.noDoc('touchmove', { touches: [t], changedTouches: [t] });
  }
  g.passo(200);
  g.noDoc('touchend', { touches: [], changedTouches: [t] });
  g.esvaziar();
}

// ── C1: a PINÇA não decide ────────────────────────────────────────────────
test('C1 pinça: o segundo dedo cancela o arraste — abrindo, fechando e com os dois juntos', () => {
  // Os três desfechos MEDIDOS antes do conserto, com toque de verdade na foto:
  // abrindo → 1 lido; fechando → 1 rejeitado; juntos → 1 lido.
  const cenarios = {
    'abrindo, dedos em tempos diferentes': (g) => {
      const a = g.toque(0, 160, 300), b = g.toque(1, 240, 300);
      g.noCard('touchstart', { touches: [a], changedTouches: [a] });
      g.passo(30);
      g.noCard('touchstart', { touches: [a, b], changedTouches: [b] });
      for (let i = 1; i <= 10; i++) {
        g.passo(16);
        const a2 = g.toque(0, 160 - i * 12, 300), b2 = g.toque(1, 240 + i * 12, 300);
        g.noDoc('touchmove', { touches: [a2, b2], changedTouches: [a2, b2] });
      }
      g.noDoc('touchend', { touches: [], changedTouches: [g.toque(0, 40, 300), g.toque(1, 360, 300)] });
    },
    'fechando': (g) => {
      const a = g.toque(0, 60, 300), b = g.toque(1, 340, 300);
      g.noCard('touchstart', { touches: [a], changedTouches: [a] });
      g.passo(30);
      g.noCard('touchstart', { touches: [a, b], changedTouches: [b] });
      for (let i = 1; i <= 10; i++) {
        g.passo(16);
        const a2 = g.toque(0, 60 + i * 11, 300), b2 = g.toque(1, 340 - i * 11, 300);
        g.noDoc('touchmove', { touches: [a2, b2], changedTouches: [a2, b2] });
      }
      g.noDoc('touchend', { touches: [], changedTouches: [g.toque(0, 170, 300), g.toque(1, 230, 300)] });
    },
    'os dois dedos no MESMO evento': (g) => {
      const a = g.toque(0, 160, 300), b = g.toque(1, 240, 300);
      g.noCard('touchstart', { touches: [a, b], changedTouches: [a, b] });
      for (let i = 1; i <= 10; i++) {
        g.passo(16);
        const a2 = g.toque(0, 160 - i * 12, 300), b2 = g.toque(1, 240 + i * 12, 300);
        g.noDoc('touchmove', { touches: [a2, b2], changedTouches: [a2, b2] });
      }
      g.noDoc('touchend', { touches: [], changedTouches: [g.toque(0, 40, 300), g.toque(1, 360, 300)] });
    },
    // Pinça, o PRIMEIRO dedo sai e o segundo segue arrastando: com um dedo só
    // na tela o `touchmove` não denuncia nada — quem pega é o início.
    'o primeiro dedo sai e o segundo arrasta': (g) => {
      const a = g.toque(0, 160, 300), b = g.toque(1, 240, 300);
      g.noCard('touchstart', { touches: [a], changedTouches: [a] });
      g.passo(30);
      g.noCard('touchstart', { touches: [a, b], changedTouches: [b] });
      g.passo(30);
      g.noDoc('touchend', { touches: [b], changedTouches: [a] });
      let b2 = b;
      for (let i = 1; i <= 20; i++) {
        g.passo(40);
        b2 = g.toque(1, 240 + i * 8, 300);
        g.noDoc('touchmove', { touches: [b2], changedTouches: [b2] });
      }
      g.passo(200);
      g.noDoc('touchend', { touches: [], changedTouches: [b2] });
    },
    // O segundo dedo que encosta FORA do card não passa pelo `handleDragStart`
    // (o ouvinte de início mora no card): só o `touchmove` o vê.
    'segundo dedo fora do card': (g) => {
      const a = g.toque(0, 200, 300);
      g.noCard('touchstart', { touches: [a], changedTouches: [a] });
      for (let i = 1; i <= 10; i++) {
        g.passo(16);
        const a2 = g.toque(0, 200 - i * 20, 300), fora = g.toque(1, 380, 800);
        g.noDoc('touchmove', { touches: [a2, fora], changedTouches: [a2] });
      }
      g.noDoc('touchend', { touches: [], changedTouches: [g.toque(0, 0, 300), g.toque(1, 380, 800)] });
    },
  };
  for (const [nome, fazer] of Object.entries(cenarios)) {
    const g = montar();
    fazer(g);
    g.esvaziar();
    assert.deepEqual(g.decidiu.map((d) => d[0]), [], `${nome}: a pinça decidiu o pedido`);
    assert.equal(g.estado().isDragging, false, `${nome}: o arraste ficou preso depois da pinça`);
  }
});

test('C1 CONTROLE: um dedo só segue decidindo — e o arraste ÓRFÃO não trava o próximo', () => {
  // Sem este controle, "a pinça não decide" passaria com o gesto morto.
  const g = montar();
  arrastarDevagar(g, 0, [300, 300], [60, 310]);
  assert.deepEqual(g.decidiu.map((d) => d[0]), ['left'], 'um dedo arrastando longe deixou de rejeitar');
  // Órfão: o card saiu do DOM no meio do gesto e o `touchend` nunca chegou.
  // O toque seguinte tem que valer — com o MESMO identifier (o Android reusa o
  // 0) e com um NOVO (o iOS numera sempre pra frente). É o id novo que separa
  // "cancela e começa de novo" de "ignora enquanto houver arraste": com a
  // segunda forma o gesto seguinte morre, e o card fica mudo até recarregar.
  for (const idNovo of [0, 7]) {
    const h = montar();
    const a = h.toque(0, 300, 300);
    h.noCard('touchstart', { touches: [a], changedTouches: [a] });
    h.passo(40);
    h.noDoc('touchmove', { touches: [h.toque(0, 250, 300)], changedTouches: [h.toque(0, 250, 300)] });
    // … e o `touchend` se perdeu. O dedo volta:
    arrastarDevagar(h, idNovo, [300, 300], [60, 300]);
    assert.deepEqual(h.decidiu.map((d) => d[0]), ['left'],
      `id ${idNovo}: o arraste órfão engoliu o gesto seguinte (ou o decidiu duas vezes)`);
    assert.equal(h.estado().isDragging, false, `id ${idNovo}: sobrou arraste preso`);
  }
});

// ── C2: o arrastar NATIVO de imagem não prende o card ao mouse ────────────
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Um arraste de mouse de (x0,y0) a (x1,y1), com o botão principal apertado.
function arrastarMouse(g, [x0, y0], [x1, y1], n = 10) {
  g.noCard('mousedown', { button: 0, buttons: 1, clientX: x0, clientY: y0 });
  for (let i = 1; i <= n; i++) {
    g.passo(40);
    g.noDoc('mousemove', { buttons: 1, clientX: x0 + (x1 - x0) * i / n, clientY: y0 + (y1 - y0) * i / n });
  }
  g.passo(200);
}

test('C2 mouse: a foto e os tiles do mapa não são arrastáveis', () => {
  // A causa: <img> é arrastável por padrão, e o arrastar nativo engole o
  // `mouseup`. MEDIDO no computador: o card parava a 40px e o clique seguinte
  // em Filtros abria o modal E pulava o pedido.
  const tpl = HTML.match(/<template id="cardTemplate">[\s\S]*?<\/template>/)[0];
  const img = tpl.match(/<img\b[^>]*class="card-image[^"]*"[^>]*>/);
  assert.ok(img, 'sumiu a <img class="card-image"> do template');
  assert.match(img[0], /draggable="false"/, 'a foto do card voltou a ser arrastável: o mouse prende o card de novo');
  const i = semComentario(APP).indexOf('function renderMapa(');
  const corpo = semComentario(APP).slice(i, semComentario(APP).indexOf('\nfunction ', i + 10));
  assert.match(corpo, /const im = new Image\(\);[\s\S]{0,200}im\.draggable = false;/,
    'os tiles do mini-mapa voltaram a ser arrastáveis: arrastar o card pelo mapa prende o card ao mouse');
});

test('C2 mouse: com o NOSSO arraste em curso o nativo não começa — fora dele, sim', () => {
  const g = montar();
  const dragstart = () => { const e = { type: 'dragstart', preventDefault() { this.cancelado = true; } };
    for (const fn of g.ouvintesDoCard.dragstart || []) fn(e); return e; };
  assert.ok(g.ouvintesDoCard.dragstart && g.ouvintesDoCard.dragstart.length, 'o card não escuta `dragstart`');
  // CONTROLE: sem arraste nosso, o nativo passa (link do ↗ arrastado pra outra aba).
  assert.equal(dragstart().cancelado, undefined, 'o card passou a proibir TODO arrastar nativo, até o do link');
  g.noCard('mousedown', { button: 0, buttons: 1, clientX: 200, clientY: 300 });
  assert.equal(dragstart().cancelado, true, 'o arrastar nativo começou por cima do nosso: o mouse fica preso ao card');
});

test('C2 mouse: botão SOLTO sem `mouseup` cancela — o clique seguinte não decide nada', () => {
  // O cenário do relato: arrastou pela foto, o nativo engoliu o `mouseup`, o
  // cursor anda SOLTO e o clique em Filtros cometia a ação da posição.
  const g = montar();
  arrastarMouse(g, [300, 300], [200, 300]);
  g.noDoc('mousemove', { buttons: 0, clientX: 180, clientY: 40 });   // o botão já não está apertado
  assert.equal(g.estado().isDragging, false, 'o cursor andando sem botão seguiu arrastando o card');
  g.noDoc('mousedown', { buttons: 1, clientX: 380, clientY: 20 });
  g.noDoc('mouseup', { buttons: 0, clientX: 380, clientY: 20 });
  g.esvaziar();
  assert.deepEqual(g.decidiu.map((d) => d[0]), [], 'o clique fora do card cometeu a ação do arraste perdido');
  // CONTROLE: o mesmo arraste com o botão apertado até o fim decide.
  const h = montar();
  arrastarMouse(h, [300, 300], [60, 300]);
  h.noDoc('mouseup', { buttons: 0, clientX: 60, clientY: 300 });
  h.esvaziar();
  assert.deepEqual(h.decidiu.map((d) => d[0]), ['left'], 'CONTROLE: o arraste de mouse deixou de decidir');
});

test('C2 mouse: o clique colado ao soltar de um ARRASTE não abre foto nem mapa — o de um clique parado, sim', () => {
  const clicar = (g) => {
    let chegou = true;
    const e = { type: 'click', stopPropagation() { chegou = false; }, preventDefault() {} };
    for (const fn of [...(g.ouvintes.click || [])]) fn(e);
    return chegou;
  };
  // Arrastou 60px e soltou (o card volta): o `click` que o navegador gera
  // junto do `mouseup` não pode chegar à foto.
  const g = montar();
  arrastarMouse(g, [300, 300], [240, 300]);
  g.noDoc('mouseup', { buttons: 0, clientX: 240, clientY: 300 });
  assert.equal(clicar(g), false, 'o clique do fim do arraste chegou à foto: o lightbox abre por cima do card');
  // E só ESSE: o clique seguinte, de verdade, passa.
  g.esvaziar();
  assert.equal(clicar(g), true, 'a armadilha não se desarmou: o próximo clique na foto não abre mais nada');
  // Nem sempre VEM clique depois do `mouseup` (o elemento apertado saiu do DOM
  // no meio — o card trocado). A armadilha tem que se desarmar sozinha, senão
  // engole o próximo clique de verdade, em qualquer botão da tela.
  const k = montar();
  arrastarMouse(k, [300, 300], [240, 300]);
  k.noDoc('mouseup', { buttons: 0, clientX: 240, clientY: 300 });
  k.esvaziar();
  assert.equal(clicar(k), true, 'sem clique colado, a armadilha ficou armada e engoliu o clique seguinte');
  // CONTROLE: apertar e soltar parado é clique — tem que chegar.
  const h = montar();
  h.noCard('mousedown', { button: 0, buttons: 1, clientX: 300, clientY: 300 });
  h.noDoc('mouseup', { buttons: 0, clientX: 302, clientY: 301 });
  assert.equal(clicar(h), true, 'CONTROLE: o clique parado na foto deixou de abrir o lightbox');
});

// ── C6: puxar pra BAIXO não decide ────────────────────────────────────────
test('C6 diagonal pra baixo: nem decide nem acende o selo do lado', () => {
  // MEDIDO com toque de verdade num celular de 393px: (−105, +300) → 1
  // rejeitado; (+105, +300) → 1 lido. Pra baixo o card não tem gesto.
  for (const dx of [-105, 105]) {
    const g = montar({ largura: 393 });
    const a = g.toque(0, 200, 200);
    g.noCard('touchstart', { touches: [a], changedTouches: [a] });
    let t = a;
    for (let i = 1; i <= 20; i++) {
      g.passo(30);
      t = g.toque(0, 200 + dx * i / 20, 200 + 300 * i / 20);
      g.noDoc('touchmove', { touches: [t], changedTouches: [t] });
    }
    const lado = dx < 0 ? '.swipe-left' : '.swipe-right';
    assert.equal(g.selos[lado].style.opacity, 0,
      `(${dx}, +300): o selo do lado acendeu (${g.selos[lado].style.opacity}) prometendo uma ação que o soltar não faz`);
    g.passo(150);
    g.noDoc('touchend', { touches: [], changedTouches: [t] });
    g.esvaziar();
    assert.deepEqual(g.decidiu.map((d) => d[0]), [], `(${dx}, +300): puxar pra baixo decidiu o pedido`);
  }
});

test('C6 CONTROLE: o gesto HORIZONTAL com desvio segue decidindo, e o ↑ na diagonal segue pulando', () => {
  // Sem estes, "pra baixo não decide" passaria com o gesto lateral morto.
  const casos = [[[-300, 40], 'left'], [[260, 180], 'right'], [[-105, -300], 'up']];
  for (const [[dx, dy], esperado] of casos) {
    const g = montar({ largura: 393 });
    arrastarDevagar(g, 0, [200, 400], [200 + dx, 400 + dy]);
    assert.deepEqual(g.decidiu.map((d) => d[0]), [esperado], `(${dx}, ${dy}) deixou de decidir "${esperado}"`);
  }
  // E o selo acende no arraste lateral — é o retorno do gesto.
  const h = montar({ largura: 393 });
  const a = h.toque(0, 300, 400);
  h.noCard('touchstart', { touches: [a], changedTouches: [a] });
  h.passo(30);
  const b = h.toque(0, 150, 440);
  h.noDoc('touchmove', { touches: [b], changedTouches: [b] });
  assert.equal(h.selos['.swipe-left'].style.opacity, 1, 'CONTROLE: o selo do lado não acende nem no arraste lateral');
});

// ── C3: a ação vale pro pedido que o GESTO viu ────────────────────────────
// As peças do app.js que decidem, fatiadas do fonte e postas no MESMO contexto
// do swipe.js — a composição é que é o teste: o card viaja do gesto até o
// handler, e o handler confere o pedido dele contra o da frente.
function fatiarApp(nome) {
  const f = semComentario(APP);
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(f);
  assert.ok(m, `${nome} sumiu do app.js`);
  let prof = 0;
  for (let j = f.indexOf('{', f.indexOf(')', m.index)); j < f.length; j++) {
    if (f[j] === '{') prof++;
    else if (f[j] === '}' && --prof === 0) return f.slice(m.index, j + 1);
  }
  throw new Error('não fechou ' + nome);
}
function montarComApp() {
  const g = montar({ largura: 393 });
  const agiu = [];
  g.ctx.AppState = { currentPlace: null };
  // A trava (sem sessão, janela do Desfazer) é testada em test/costura-sessao;
  // a do card de foto sem a foto (`direcaoTravada`), no r4 C4 logo abaixo.
  g.ctx.acoesTravadas = () => false;
  g.ctx.direcaoTravada = () => false;
  g.ctx.showCurrentPlace = () => {};
  for (const [h, tipo] of [['handleReject', 'reject'], ['handleMarkAsRead', 'read'], ['handleSkip', 'skip']]) {
    g.ctx[h] = () => agiu.push([tipo, g.ctx.AppState.currentPlace]);
  }
  vm.runInContext(['const pedidoDoElemento = new WeakMap();',
    ...['pedidoDoCard', 'agirNoPedidoDoGesto', 'onSwipeLeft', 'onSwipeRight', 'onSwipeUp'].map(fatiarApp),
    'this.__registrar = (card, p) => pedidoDoElemento.set(card, p);'].join('\n'), g.ctx);
  return { ...g, agiu };
}

test('C3 a fila anda durante a saída do card: a ação NÃO cai no pedido seguinte', () => {
  // MEDIDO: aprovar a foto de B, fechar o lightbox e dar ✓/→/arraste em B com
  // a resposta da aprovação pousando nos 350 ms da saída → a ação saiu pra C.
  const A = { updateRequestID: 'uA' }, C = { updateRequestID: 'uC' };
  for (const [dx, tipo] of [[-300, 'reject'], [300, 'read']]) {
    const g = montarComApp();
    g.ctx.AppState.currentPlace = A;
    g.ctx.__registrar(g.card, A);
    const a = g.toque(0, 200, 400);
    g.noCard('touchstart', { touches: [a], changedTouches: [a] });
    let t = a;
    for (let i = 1; i <= 20; i++) {
      g.passo(40);
      t = g.toque(0, 200 + dx * i / 20, 400);
      g.noDoc('touchmove', { touches: [t], changedTouches: [t] });
    }
    g.passo(200);
    g.noDoc('touchend', { touches: [], changedTouches: [t] });
    // A resposta da aprovação pousa AGORA: `advanceQueue` põe C na frente.
    g.ctx.AppState.currentPlace = C;
    g.esvaziar();
    assert.deepEqual(g.agiu, [], `${tipo}: o gesto em A agiu em ${g.agiu.map((x) => x[1] && x[1].updateRequestID)}`);
  }
  // CONTROLE: sem a fila andar, o mesmo gesto age — e age em A.
  const h = montarComApp();
  h.ctx.AppState.currentPlace = A;
  h.ctx.__registrar(h.card, A);
  arrastarDevagar(h, 0, [300, 400], [0, 400]);
  assert.deepEqual(h.agiu.map((x) => [x[0], x[1].updateRequestID]), [['reject', 'uA']],
    'CONTROLE: o gesto no card da frente deixou de agir');
});

test('C3 botão e teclado: o triggerSwipe entrega o card que saiu, e o mesmo pedido redesenhado segue valendo', () => {
  const A = { updateRequestID: 'uA' }, C = { updateRequestID: 'uC' };
  const g = montarComApp();
  g.ctx.window.cardDaFrente = () => g.card;
  g.ctx.AppState.currentPlace = A;
  g.ctx.__registrar(g.card, A);
  // O caminho da seta: o callback do teclado, como está no handleKeyDown.
  g.ctx.triggerSwipe('right', (card) => g.ctx.agirNoPedidoDoGesto(g.ctx.pedidoDoCard(card), g.ctx.handleMarkAsRead));
  g.ctx.AppState.currentPlace = C;          // a fila andou durante os 350 ms
  g.esvaziar();
  assert.deepEqual(g.agiu, [], 'a seta em A agiu no pedido que entrou na frente');
  // O mesmo pedido REDESENHADO (outro elemento, mesmo objeto) não é troca de
  // pedido: a exclusão de uma foto dele redesenha o card e a ação segue.
  const h = montarComApp();
  h.ctx.window.cardDaFrente = () => h.card;
  h.ctx.AppState.currentPlace = A;
  h.ctx.__registrar(h.card, A);
  h.ctx.triggerSwipe('left', (card) => h.ctx.agirNoPedidoDoGesto(h.ctx.pedidoDoCard(card), h.ctx.handleReject));
  // Durante a saída o card de A é REDESENHADO: elemento novo, pedido igual.
  const outro = { ...h.card };
  h.ctx.__registrar(outro, A);
  h.ctx.window.cardDaFrente = () => outro;
  h.esvaziar();
  assert.deepEqual(h.agiu.map((x) => x[0]), ['reject'], 'CONTROLE: a seta no card da frente deixou de agir');
});

test('C3 os TRÊS caminhos passam pela conferência, e o card registra o pedido dele', () => {
  const f = semComentario(APP);
  const render = fatiarApp('renderCurrentCard');
  assert.match(render, /const card = montarCard\(place\);\s*pedidoDoElemento\.set\(card, place\);/,
    'o card da frente não registra o pedido que mostra: a conferência não tem com o que comparar');
  assert.match(render, /window\.triggerSwipe\(direction, \(\) => agirNoPedidoDoGesto\(place, handler\)\)/,
    'os botões ✕ ↑ ✓ voltaram a agir no pedido da frente de 350 ms depois');
  const teclas = fatiarApp('handleKeyDown');
  for (const h of ['handleReject', 'handleMarkAsRead', 'handleSkip']) {
    assert.match(teclas, new RegExp(`\\(card\\) => agirNoPedidoDoGesto\\(pedidoDoCard\\(card\\), ${h}\\)`),
      `a seta de ${h} voltou a agir no pedido da frente de 350 ms depois`);
  }
  for (const [fn, h] of [['onSwipeLeft', 'handleReject'], ['onSwipeRight', 'handleMarkAsRead'], ['onSwipeUp', 'handleSkip']]) {
    assert.match(fatiarApp(fn), new RegExp(`agirNoPedidoDoGesto\\(pedidoDoCard\\(card\\), ${h}\\)`),
      `o arraste (${fn}) voltou a agir no pedido da frente de 350 ms depois`);
  }
  assert.ok(!/window\.triggerSwipe\('(left|right|up)', handle/.test(f), 'sobrou seta passando o handler cru ao triggerSwipe');
});

// ── r4 C4: a foto em decisão falha DURANTE a saída pelo ✕ (auditoria do card, 2026-09-29)
// MEDIDO no navegador: foto de "Nova foto" falhando sem rede 200 ms depois do
// ✕ — no meio dos 350 ms da saída. O `onerror` marca o card que está SAINDO, o
// handler recusa pela `direcaoTravada`, e o card ficava FORA da tela (x=-709,
// opacidade 0) como pedido atual, com só o card de fundo (inerte) visível e o ↑
// inalcançável. A prova no navegador de verdade mora no bloco "O CARD" do
// `tools/smoke-browser.mjs`; aqui roda a composição swipe.js + app.js.
test('r4 C4 a foto em decisão falha sem rede nos 350 ms da saída: ✕ e ✓ não valem, e o card VOLTA', () => {
  const A = { updateRequestID: 'uA' };
  // O arraste SEM esvaziar os timers: a foto tem de falhar depois de o dedo
  // soltar e antes de a saída terminar.
  const arrastar = (g, [x0, y0], [x1, y1]) => {
    let t = g.toque(0, x0, y0);
    g.noCard('touchstart', { touches: [t], changedTouches: [t] });
    for (let i = 1; i <= 20; i++) {
      g.passo(40);
      t = g.toque(0, x0 + (x1 - x0) * i / 20, y0 + (y1 - y0) * i / 20);
      g.noDoc('touchmove', { touches: [t], changedTouches: [t] });
    }
    g.passo(200);
    g.noDoc('touchend', { touches: [], changedTouches: [t] });
  };
  const caminhos = {
    // Botão e seta: o `triggerSwipe` com o callback que o `renderCurrentCard`
    // e o `handleKeyDown` passam.
    'botão/seta ✕': (g) => g.ctx.triggerSwipe('left', (card) => g.ctx.agirNoPedidoDoGesto(g.ctx.pedidoDoCard(card), g.ctx.handleReject)),
    'botão/seta ✓': (g) => g.ctx.triggerSwipe('right', (card) => g.ctx.agirNoPedidoDoGesto(g.ctx.pedidoDoCard(card), g.ctx.handleMarkAsRead)),
    'arraste ✕': (g) => arrastar(g, [300, 400], [0, 400]),
    'arraste ✓': (g) => arrastar(g, [60, 400], [390, 400]),
  };
  const montarCaso = (semFotoNoMeio) => {
    const g = montarComApp();
    const voltou = [];
    g.ctx.showCurrentPlace = () => voltou.push(g.ctx.AppState.currentPlace);
    g.ctx.window.cardDaFrente = () => g.card;
    g.ctx.AppState.currentPlace = A;
    g.ctx.__registrar(g.card, A);
    const estado = { semFoto: false };
    // A `direcaoTravada` do app: ✕ e ✓ travados num card de foto sem a foto.
    g.ctx.direcaoTravada = (d) => estado.semFoto && (d === 'left' || d === 'right');
    return { g, voltou, falhar: () => { estado.semFoto = semFotoNoMeio; } };
  };
  for (const [nome, fazer] of Object.entries(caminhos)) {
    const { g, voltou, falhar } = montarCaso(true);
    fazer(g);
    falhar();                 // o `onerror` da foto em decisão chega no meio da saída
    g.esvaziar();
    assert.deepEqual(g.agiu, [], `${nome}: decidiu uma foto que ninguém viu`);
    assert.deepEqual(voltou, [A],
      `${nome}: DEFEITO — o card saiu da tela e não voltou (o pedido fica na frente, invisível, com o ↑ inalcançável)`);
  }
  // O ↑ segue valendo num card sem a foto: pular é o que o aviso manda fazer.
  const p = montarCaso(true);
  p.g.ctx.triggerSwipe('up', (card) => p.g.ctx.agirNoPedidoDoGesto(p.g.ctx.pedidoDoCard(card), p.g.ctx.handleSkip));
  p.falhar();
  p.g.esvaziar();
  assert.deepEqual(p.g.agiu.map((x) => x[0]), ['skip'], 'o ↑ deixou de pular um card de foto sem a foto');
  assert.deepEqual(p.voltou, [], 'o ↑ remontou o card em vez de pular');
  // CONTROLE: com a foto chegando, o MESMO ✕ e o mesmo arraste agem — e
  // ninguém remonta. Sem isto, "não agiu" passaria com o gesto morto.
  for (const nome of ['botão/seta ✕', 'arraste ✕']) {
    const c = montarCaso(false);
    caminhos[nome](c.g);
    c.falhar();
    c.g.esvaziar();
    assert.deepEqual(c.g.agiu.map((x) => [x[0], x[1].updateRequestID]), [['reject', 'uA']], `CONTROLE ${nome}: o ✕ deixou de agir`);
    assert.deepEqual(c.voltou, [], `CONTROLE ${nome}: remontou o card com a foto boa`);
  }
});

// ── C7: o teclado numa área do card que ROLA ──────────────────────────────
// O `handleKeyDown` de verdade, fatiado, com o resto do app de mentira. As
// constantes vêm do fonte também: uma cópia aqui passaria com a de lá mudada.
function constanteDoApp(nome) {
  const m = new RegExp('^const ' + nome + ' = [^;]+;', 'm').exec(semComentario(APP));
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
}
const DEPS_DO_TECLADO = ['document', 'window', 'AppState', 'MapaLightbox', 'Lightbox', 'topOpenModal',
  'trapTabInModal', 'closeModal', 'desfazerAcaoPendente', 'acoesTravadas', 'agirNoPedidoDoGesto',
  'pedidoDoCard', 'handleReject', 'handleMarkAsRead', 'handleSkip', 'desfazerPeloTeclado', 'avisarTravaAoTocar'];
function montarTeclado() { return montarTecladoCom({}); }
function montarTecladoCom(trocas) {
  const doc = { activeElement: null, getElementById: () => null };
  const saiu = [];
  const deps = {
    document: doc,
    window: { triggerSwipe: (dir) => saiu.push(dir) },
    AppState: { currentPlace: { updateRequestID: 'uA' }, pendingAction: null },
    // A foto em 1× (`ampliada`, a régua das setas da foto, R8-3-01): o zoom não
    // é o assunto daqui (test/lightbox-tab e test/lightbox-zoom).
    MapaLightbox: { isOpen: () => false }, Lightbox: { isOpen: () => false, ampliada: () => false },
    topOpenModal: () => null, trapTabInModal() {}, closeModal() {}, desfazerAcaoPendente() {},
    acoesTravadas: () => false, agirNoPedidoDoGesto() {}, pedidoDoCard: () => null,
    handleReject() {}, handleMarkAsRead() {}, handleSkip() {}, desfazerPeloTeclado: () => false,
    avisarTravaAoTocar() {},
    ...trocas,
  };
  const fonte = [constanteDoApp('TECLAS_DE_CURSOR'), fatiarApp('focoEmCampoDeTexto'),
    constanteDoApp('AREAS_DO_CARD_QUE_ROLAM'), fatiarApp('focoEmAreaQueRola'),
    // Ctrl, ⌘ ou Alt com seta é do navegador (test/atalhos-do-navegador.test.mjs).
    fatiarApp('atalhoDoNavegador'), constanteDoApp('TECLAS_DOS_ATALHOS_DO_NAVEGADOR'),
    fatiarApp('handleKeyDown'), 'return handleKeyDown;'].join('\n');
  const handle = new Function(...DEPS_DO_TECLADO, fonte)(...DEPS_DO_TECLADO.map((k) => deps[k]));
  // Um elemento com foco: `closest` responde como o do navegador pra lista de classes dele.
  const focar = (classes, tagName = 'DIV') => {
    doc.activeElement = { tagName, classList: classes,
      closest: (sel) => (sel.split(',').some((s) => classes.includes(s.trim().replace(/^\./, ''))) ? doc.activeElement : null) };
  };
  const tecla = (key) => { const e = { key, preventDefault() { this.parou = true; } }; handle(e); return e; };
  return { deps, saiu, focar, tecla };
}

test('C7 foco na lista de mudanças ou no texto do reporte: as setas ROLAM e não decidem', () => {
  // MEDIDO: com o foco na lista, ↓ rolava e ↑ PULAVA o card; ← → rejeitavam e marcavam lido.
  for (const area of ['card-changes-list', 'card-flag-comment-text']) {
    const k = montarTeclado();
    k.focar([area]);
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']) {
      const e = k.tecla(key);
      assert.equal(e.parou, undefined, `${area}: ${key} teve o padrão cancelado — a lista não rola`);
    }
    assert.deepEqual(k.saiu, [], `${area}: tecla de cursor decidiu o pedido (${k.saiu.join(', ')})`);
  }
});

test('C7 CONTROLE: fora das áreas que rolam as setas seguem decidindo', () => {
  // Sem este controle, "a lista não decide" passaria com o teclado morto no card inteiro.
  const k = montarTeclado();
  k.focar(['card-btn-reject'], 'BUTTON');
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp']) k.tecla(key);
  k.deps.document.activeElement = null;
  k.tecla('ArrowLeft');
  assert.deepEqual(k.saiu, ['left', 'right', 'up', 'left'], 'o teclado deixou de decidir fora da lista');
});

// ── C8: a tecla z desfaz também as ações de FOTO ──────────────────────────
test('C8 z desfaz no lightbox e no card — e nunca com o campo do nome focado', () => {
  // MEDIDO: excluir uma foto e apertar z no lightbox → a exclusão SAIU 3 s
  // depois; fechar com Esc e apertar z → idem.
  let pediu = 0;
  const m = montarTecladoCom({ desfazerPeloTeclado: () => { pediu++; return true; } });
  m.deps.Lightbox.isOpen = () => true;
  const e1 = m.tecla('z');
  assert.equal(pediu, 1, 'z no lightbox não pediu o desfazer');
  assert.equal(e1.parou, true, 'z no lightbox desfez sem cancelar a tecla');
  // Renomeando: o z é uma LETRA do nome.
  m.focar([], 'INPUT');
  m.deps.document.activeElement.type = 'text';
  m.tecla('z');
  assert.equal(pediu, 1, 'z digitado no campo do nome desfez a ação (e sumiu da palavra)');
  // No card (lightbox fechado), o mesmo caminho.
  m.deps.document.activeElement = null;
  m.deps.Lightbox.isOpen = () => false;
  const e2 = m.tecla('Z');
  assert.equal(pediu, 2, 'z no card não pediu o desfazer');
  assert.equal(e2.parou, true);
});

test('C8 o desfazer do teclado aperta o MESMO botão do banner — e não inventa ação sem janela aberta', () => {
  const corpo = fatiarApp('desfazerPeloTeclado');
  const rodar = ({ pendingAction = null, pendente = null, botao = true } = {}) => {
    const log = [];
    const doc = { getElementById: (id) => (id === 'undoBtn' && botao ? { click: () => log.push('clicou') } : null) };
    const f = new Function('AppState', 'desfazerAcaoPendente', 'exclusaoPendente', 'aprovacaoPendente', 'renomeacaoPendente', 'document',
      corpo + '\nreturn desfazerPeloTeclado;')({ pendingAction }, () => log.push('card'),
      pendente === 'exclusao' ? {} : null, pendente === 'aprovacao' ? {} : null, pendente === 'renomeacao' ? {} : null, doc);
    return { devolveu: f(), log };
  };
  assert.deepEqual(rodar({ pendingAction: {} }), { devolveu: true, log: ['card'] }, 'o z do card deixou de desfazer o swipe');
  for (const p of ['exclusao', 'aprovacao', 'renomeacao']) {
    assert.deepEqual(rodar({ pendente: p }), { devolveu: true, log: ['clicou'] }, `z com a ${p} na janela não apertou o Desfazer`);
  }
  // Sem janela aberta nada acontece — e o botão de outro contexto não é apertado à toa.
  assert.deepEqual(rodar({}), { devolveu: false, log: [] }, 'z sem janela aberta apertou alguma coisa');
});

// ── r4 C14: o card TRAVADO responde com o porquê (auditoria do card, 2026-09-29)
// Com a trava SEM banner na tela — o "Marcar todos" no ar depois que o toast
// dele some, a conferência de um 401, a sessão renovando — o ✕ ↑ ✓ estão
// `disabled`, o arraste não começa e as setas voltam: MEDIDO, tocar no ✕
// travado não respondia nada. Os três caminhos passam pelo
// `avisarTravaAoTocar` do app.js (que cala na janela do Desfazer e tem
// intervalo próprio: test/card-foco-trava). Aqui: as setas, o arraste e o
// `triggerSwipe`; o toque no botão `disabled` (pointerdown/up na barra) se
// mede no navegador, no bloco "O CARD" do `tools/smoke-browser.mjs`.
test('r4 C14 as setas com o card travado não decidem — e pedem o aviso do porquê', () => {
  let avisos = 0;
  const k = montarTecladoCom({ acoesTravadas: () => true, avisarTravaAoTocar: () => { avisos++; } });
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp']) {
    const e = k.tecla(key);
    assert.equal(e.parou, true, `${key} travado deixou o navegador rolar a página`);
  }
  assert.deepEqual(k.saiu, [], 'a seta decidiu com o card travado');
  assert.equal(avisos, 3, 'DEFEITO: a seta no card travado voltou calada (o intervalo entre avisos é do app.js)');
  // CONTROLE: destravado, a seta decide e ninguém pede aviso.
  let avisosLivre = 0;
  const livre = montarTecladoCom({ avisarTravaAoTocar: () => { avisosLivre++; } });
  livre.tecla('ArrowLeft');
  assert.deepEqual(livre.saiu, ['left']);
  assert.equal(avisosLivre, 0);
  // E tecla que não é de decidir não pede nada, travada ou não.
  k.tecla('ArrowDown'); k.tecla('Tab');
  assert.equal(avisos, 3, 'tecla que não decide pediu o aviso da trava');
});

test('r4 C14 ARRASTAR o card travado pede o aviso; tocar parado, tocar num botão e rolar a lista não', () => {
  const montarTravado = () => {
    const g = montar({ largura: 393 });
    const pedidos = [];
    g.ctx.window.acoesTravadas = () => true;
    g.ctx.window.avisarTravaAoTocar = () => pedidos.push(1);
    return { g, pedidos };
  };
  // O dedo andando como num arraste: o card não sai (nada decidido, nenhum
  // arraste começado) e o aviso é pedido UMA vez por gesto.
  for (const [dx, dy] of [[-200, 0], [200, 10], [0, -200]]) {
    const { g, pedidos } = montarTravado();
    arrastarDevagar(g, 0, [200, 400], [200 + dx, 400 + dy]);
    assert.deepEqual(g.decidiu, [], `(${dx}, ${dy}) decidiu com o card travado`);
    assert.equal(g.estado().isDragging, false, `(${dx}, ${dy}) começou um arraste com o card travado`);
    assert.equal(pedidos.length, 1, `(${dx}, ${dy}) DEFEITO: arrastar o card travado não pediu o aviso (ou pediu ${pedidos.length}×)`);
  }
  // Com o MOUSE, igual.
  const mo = montarTravado();
  arrastarMouse(mo.g, [300, 400], [60, 400]);
  mo.g.noDoc('mouseup', { button: 0, buttons: 0, clientX: 60, clientY: 400 });
  mo.g.esvaziar();
  assert.deepEqual(mo.g.decidiu, []);
  assert.equal(mo.pedidos.length, 1, 'arrastar com o mouse o card travado não pediu o aviso');
  // Toque PARADO (ampliar a foto com o lote no ar é legítimo): nada de "espere".
  const parado = montarTravado();
  const a = parado.g.toque(0, 200, 400);
  parado.g.noCard('touchstart', { touches: [a], changedTouches: [a] });
  parado.g.passo(80);
  const a2 = parado.g.toque(0, 203, 402);
  parado.g.noDoc('touchmove', { touches: [a2], changedTouches: [a2] });
  parado.g.noDoc('touchend', { touches: [], changedTouches: [a2] });
  assert.equal(parado.pedidos.length, 0, 'um toque parado no card travado respondeu "espere"');
  // Começando num BOTÃO (o toque do botão travado é outro caminho) ou numa
  // área que ROLA: o dedo andando ali não é tentativa de decidir.
  for (const cls of ['button', '.card-changes-list']) {
    const t = montarTravado();
    const alvo = { closest: (sel) => (sel.split(',').map((x) => x.trim()).includes(cls) ? {} : null) };
    const b = t.g.toque(0, 200, 400);
    t.g.noCard('touchstart', { touches: [b], changedTouches: [b], target: alvo });
    for (let i = 1; i <= 10; i++) {
      t.g.passo(40);
      const b2 = t.g.toque(0, 200, 400 - i * 20);
      t.g.noDoc('touchmove', { touches: [b2], changedTouches: [b2], target: alvo });
    }
    t.g.noDoc('touchend', { touches: [], changedTouches: [t.g.toque(0, 200, 200)], target: alvo });
    assert.equal(t.pedidos.length, 0, `arrastar a partir de ${cls} pediu o aviso da trava`);
  }
  // CONTROLE: destravado, o mesmo arraste decide e não pede aviso.
  const livre = montar({ largura: 393 });
  let pediuLivre = 0;
  livre.ctx.window.acoesTravadas = () => false;
  livre.ctx.window.avisarTravaAoTocar = () => { pediuLivre++; };
  arrastarDevagar(livre, 0, [200, 400], [0, 400]);
  assert.deepEqual(livre.decidiu.map((d) => d[0]), ['left'], 'CONTROLE: o arraste destravado deixou de decidir');
  assert.equal(pediuLivre, 0);
});

test('r4 C14 o botão e a seta que chegam travados ao triggerSwipe também pedem o aviso', () => {
  const g = montar({ largura: 393 });
  let pediu = 0, agiu = 0;
  g.ctx.window.acoesTravadas = () => true;
  g.ctx.window.avisarTravaAoTocar = () => { pediu++; };
  g.ctx.window.cardDaFrente = () => g.card;
  g.ctx.triggerSwipe('left', () => { agiu++; });
  g.esvaziar();
  assert.equal(agiu, 0, 'o triggerSwipe agiu com o card travado');
  assert.equal(pediu, 1, 'o triggerSwipe travado voltou calado');
});

// ── R10-4-01: o GESTO no card é sinal positivo do swipe.js ────────────────
// O redesenho do card de foto que a rede devolveu (e o canto do FAB) perguntava
// ao `style.transform` se havia gesto no card — e a volta pro lugar depois de um
// arraste solto sem decidir deixa `translate(0, 0) rotate(0deg)` ESCRITO: o card
// de foto travado que a pessoa tentou arrastar nunca mais saía de "A foto
// precisa de sinal" (MEDIDO, n23 e n4b da auditoria da rodada 10). Agora quem
// responde é o swipe.js (`gestoNoCard`): o dedo no card, a volta pro lugar e a
// saída — e o fim do gesto é avisado (`aoFimDoGesto`), uma vez.
test('R10-4-01 o gesto no card: o arraste, a volta pro lugar e a saída — e o fim avisa UMA vez', () => {
  const g = montar({ largura: 400 });
  const fins = [];
  g.ctx.window.aoFimDoGesto = (card) => fins.push(card);
  assert.equal(g.ctx.gestoNoCard(g.card), false, 'PRÉ-CONDIÇÃO: card parado com gesto');
  // O dedo no card, abaixo do limiar: é gesto.
  let t = g.toque(0, 200, 400);
  g.noCard('touchstart', { touches: [t], changedTouches: [t] });
  for (let i = 1; i <= 4; i++) { g.passo(40); t = g.toque(0, 200 + 15 * i, 400); g.noDoc('touchmove', { touches: [t], changedTouches: [t] }); }
  assert.equal(g.ctx.gestoNoCard(g.card), true, 'o dedo no card não conta como gesto');
  // Solta sem decidir: a VOLTA pro lugar ainda é o gesto — e deixa o transform de repouso escrito.
  g.passo(200);
  g.noDoc('touchend', { touches: [], changedTouches: [t] });
  assert.equal(g.card.style.transform, 'translate(0, 0) rotate(0deg)', 'PRÉ-CONDIÇÃO: a volta pro lugar deixou de escrever o transform de repouso');
  assert.equal(g.ctx.gestoNoCard(g.card), true, 'a volta pro lugar (400 ms) não conta como gesto');
  assert.deepEqual(fins, [], 'o fim do gesto foi avisado antes de o card parar');
  g.esvaziar();
  assert.equal(g.ctx.gestoNoCard(g.card), false,
    'o card PAROU (com o transform de repouso escrito) e segue "com gesto" — o card de foto nunca mais sai do aviso');
  assert.deepEqual(fins, [g.card], 'o fim da volta pro lugar não foi avisado (ou foi mais de uma vez)');
  // Pegou de novo NO MEIO da volta: só a volta mais nova avisa o fim. (Devagar,
  // abaixo do limiar e da velocidade do flick: um passo só de 60 px em 40 ms é
  // FLICK, e o card saía — a primeira versão deste trecho media a saída.)
  const h = montar({ largura: 400 });
  const finsH = [];
  h.ctx.window.aoFimDoGesto = (card) => finsH.push(card);
  for (let volta = 0; volta < 2; volta++) {
    let u = h.toque(0, 200, 400);
    h.noCard('touchstart', { touches: [u], changedTouches: [u] });
    assert.equal(h.estado().isDragging, true, `PRÉ-CONDIÇÃO: o ${volta + 1}º arraste não começou (o card estava saindo?)`);
    for (let i = 1; i <= 4; i++) { h.passo(40); u = h.toque(0, 200 + 15 * i, 400); h.noDoc('touchmove', { touches: [u], changedTouches: [u] }); }
    h.passo(200); h.noDoc('touchend', { touches: [], changedTouches: [u] });
  }
  assert.deepEqual(h.decidiu, [], 'PRÉ-CONDIÇÃO: um dos dois arrastes decidiu (era pra voltar pro lugar)');
  assert.equal(h.ctx.gestoNoCard(h.card), true);
  h.esvaziar();
  assert.deepEqual([finsH.length, h.ctx.gestoNoCard(h.card)], [1, false], 'a volta superada avisou o fim do gesto');
  // A SAÍDA (o ↑): gesto até a animação acabar; o fim é avisado DEPOIS da decisão.
  const s = montar({ largura: 400 });
  const ordem = [];
  s.ctx.window.aoFimDoGesto = () => ordem.push('fim');
  s.ctx.onSwipeUp = () => ordem.push('decidiu');
  let v = s.toque(0, 200, 500);
  s.noCard('touchstart', { touches: [v], changedTouches: [v] });
  for (let i = 1; i <= 20; i++) { s.passo(40); v = s.toque(0, 200, 500 - 10 * i); s.noDoc('touchmove', { touches: [v], changedTouches: [v] }); }
  s.passo(200);
  s.noDoc('touchend', { touches: [], changedTouches: [v] });
  assert.equal(s.ctx.gestoNoCard(s.card), true, 'o card SAINDO não conta como gesto');
  s.esvaziar();
  assert.deepEqual([ordem, s.ctx.gestoNoCard(s.card)], [['decidiu', 'fim'], false]);
  // CONTROLE: o arraste ÓRFÃO (o card trocado no meio do gesto) não prende o card que entrou.
  const o = montar({ largura: 400 });
  const w = o.toque(0, 200, 400);
  o.noCard('touchstart', { touches: [w], changedTouches: [w] });
  assert.equal(o.estado().isDragging, true);
  assert.equal(o.ctx.gestoNoCard({ style: {} }), false, 'o arraste órfão do card que saiu travou o card que entrou');
  assert.equal(o.ctx.gestoNoCard(null), false);
});

// A COMPOSIÇÃO: o swipe.js de verdade e a recuperação do card de foto de
// verdade (fatiadas do app.js), no mesmo contexto. O card está sem a foto, ✕ e ✓
// travados (`direcaoTravada`): o arraste pro lado volta pro lugar.
function montarCardDeFotoTravado() {
  const g = montar({ largura: 400 });
  const place = { venueID: 'v1', updateRequestID: 'ur1', purType: 'NEW_PHOTO', imageUrls: ['https://venue-image.waze.com/ur1'] };
  const redesenhos = [];
  const diario = [];
  class Image { set src(u) { this._src = u; } }
  Object.assign(g.ctx, {
    AppState: { currentPlace: place },
    cardDaFrente: () => g.card, dfato: (k) => diario.push(k), navigator: { onLine: true },
    showCurrentPlace: () => redesenhos.push(1), mantendoFocoNoCard: (redesenhar) => redesenhar(),
    urlDaFoto: (u) => u, Image, fotoServidorResponde: async () => false, FOTO_PROVA_TETO_MS: 10000,
  });
  // O card de foto SEM a foto (o aviso na caixa da imagem).
  g.card.querySelector = (sel) => (sel === '.card-sem-foto' ? {} : { style: {}, querySelector: () => null });
  g.ctx.window.direcaoTravada = (d) => d === 'left' || d === 'right';
  g.ctx.__errosNoFim = [];
  // (O canto do FAB que espera o gesto, R10-4-05, é medido no test/fab-dev.)
  g.ctx.posicionarFabDev = () => {};
  vm.runInContext(['let provandoFotoDe = null, redesenhoDoCardAdiado = null, fabEsperaOGesto = false;',
    ...['fotosDoCard', 'cardSobGesto', 'aoFimDoGesto', 'recuperarCardSemFoto', 'redesenharCardAdiado'].map(fatiarApp),
    // O swipe.js ENGOLE o erro de quem ouve o fim do gesto (nunca derruba o
    // gesto): um erro aqui passaria calado. O ouvinte de teste o deixa à mostra.
    'window.aoFimDoGesto = (c) => { try { aoFimDoGesto(c); } catch (e) { __errosNoFim.push(String(e)); } };'].join('\n'), g.ctx);
  // Arrasta pro lado além do limiar e SOLTA: a direção está travada, o card volta.
  const arrastar = ({ soltar = true } = {}) => {
    let t = g.toque(0, 120, 400);
    g.noCard('touchstart', { touches: [t], changedTouches: [t] });
    for (let i = 1; i <= 20; i++) { g.passo(40); t = g.toque(0, 120 + 8 * i, 400); g.noDoc('touchmove', { touches: [t], changedTouches: [t] }); }
    if (soltar) { g.passo(200); g.noDoc('touchend', { touches: [], changedTouches: [t] }); }
    return t;
  };
  return { g, place, redesenhos, diario, arrastar };
}

test('R10-4-01 composição: o card de foto travado que a pessoa ARRASTOU sai do aviso quando a rede volta (swipe.js + app.js)', () => {
  // Arrastou, soltou, o card parou — e a rede é provada depois (o n4b `arraste-antes`, o n23).
  const a = montarCardDeFotoTravado();
  a.arrastar();
  a.g.esvaziar();
  assert.deepEqual([a.g.decidiu.length, a.g.card.style.transform], [0, 'translate(0, 0) rotate(0deg)'],
    'PRÉ-CONDIÇÃO: o arraste com ✕ e ✓ travados decidiu, ou não voltou pro lugar');
  a.g.ctx.recuperarCardSemFoto({ redeProvada: true });
  assert.deepEqual([a.redesenhos.length, a.diario], [1, ['foto.redeProvada']],
    'o card que a pessoa tentou arrastar seguiu com "A foto precisa de sinal" e ✕/✓ travados com a rede provada');
  // A rede provada chega com o DEDO no card (o n4b `arraste`): espera, e o card sai quando o dedo solta e o card para.
  const b = montarCardDeFotoTravado();
  const t = b.arrastar({ soltar: false });
  b.g.ctx.recuperarCardSemFoto({ redeProvada: true });
  assert.equal(b.redesenhos.length, 0, 'arrancou o card de debaixo do dedo');
  b.g.passo(200);
  b.g.noDoc('touchend', { touches: [], changedTouches: [t] });
  assert.equal(b.redesenhos.length, 0, 'redesenhou no meio da volta pro lugar');
  b.g.esvaziar();
  assert.deepEqual([b.redesenhos.length, b.diario], [1, ['foto.redeProvada']],
    'a rede provada no meio do arraste se perdeu — o card seguiu travado');
  assert.deepEqual(b.g.ctx.__errosNoFim, [], 'o fim do gesto lançou (o swipe.js engole: passaria calado)');
  // CONTROLE: sem arraste nenhum, a rede provada solta o card na hora.
  const c = montarCardDeFotoTravado();
  c.g.ctx.recuperarCardSemFoto({ redeProvada: true });
  assert.equal(c.redesenhos.length, 1, 'CONTROLE: a rede provada deixou de soltar o card parado');
  // CONTROLE do instrumento: o MESMO arraste, com a direção livre, decide — o card
  // que volta pro lugar acima voltou pela trava, não por um arraste curto demais.
  const d = montarCardDeFotoTravado();
  d.g.ctx.window.direcaoTravada = () => false;
  d.arrastar();
  d.g.esvaziar();
  assert.deepEqual(d.g.decidiu.map((x) => x[0]), ['right'], 'CONTROLE: o arraste do teste não passa do limiar');
});
