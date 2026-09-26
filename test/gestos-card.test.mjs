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
  const ctx = {
    document: doc, window: { innerWidth: largura }, navigator: {},
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
    performance: { now: () => relogio.agora }, console,
    onSwipeLeft: (card) => decidiu.push(['left', card]),
    onSwipeRight: (card) => decidiu.push(['right', card]),
    onSwipeUp: (card) => decidiu.push(['up', card]),
  };
  vm.createContext(ctx);
  vm.runInContext(SWIPE + '\nthis.__estado = () => ({ isDragging, dragTouchId, animating });', ctx);
  const ouvintesDoCard = {};
  const card = {
    style: {}, classList: { add() {}, remove() {}, contains: () => false }, querySelector: () => null,
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
  return { ctx, card, decidiu, noCard, noDoc, toque, passo, estado: () => ctx.__estado(), ouvintes };
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
