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
