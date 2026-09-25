// O zoom da foto ampliada (pinça, roda, duplo toque) tem uma invariante: o ponto
// da foto que está sob o dedo CONTINUA sob o dedo. A fórmula antiga só a cumpria
// com a foto centrada (t = 0); depois do primeiro zoom ela escorregava t·(r − 1)
// a cada passo (auditoria de 2026-09-25). `Lightbox.zoomTo` EXECUTADO, com um
// retângulo que inclui a transformação, como o do navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function lightbox() {
  const ini = APP.indexOf('    zoomTo(scale, cx, cy) {');
  assert.ok(ini > 0, 'zoomTo sumiu');
  let prof = 0, fim = -1;
  for (let j = APP.indexOf('{', ini); j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const zoomTo = APP.slice(ini, fim).trim();
  // Layout da foto: centro (200, 400), 300×200. O retângulo VISUAL inclui o
  // translate e o scale (origem no centro), como o getBoundingClientRect.
  const C = { x: 200, y: 400 }, W = 300, H = 200;
  const lb = { scale: 1, tx: 0, ty: 0, _applyTransform() {} };
  const img = { getBoundingClientRect: () => ({ left: C.x + lb.tx - (W * lb.scale) / 2, top: C.y + lb.ty - (H * lb.scale) / 2,
    width: W * lb.scale, height: H * lb.scale }) };
  const document = { getElementById: () => img };
  lb.zoomTo = new Function('document', 'return function ' + zoomTo.replace(/^zoomTo/, 'zoomTo'))(document);
  // Onde um ponto da foto (em coordenadas da foto, centradas) aparece na tela.
  lb.naTela = (u) => ({ x: C.x + lb.tx + lb.scale * u.x, y: C.y + lb.ty + lb.scale * u.y });
  lb.naFoto = (p) => ({ x: (p.x - C.x - lb.tx) / lb.scale, y: (p.y - C.y - lb.ty) / lb.scale });
  return lb;
}

test('zoom: o ponto sob o dedo fica sob o dedo — também DEPOIS do primeiro zoom', () => {
  const lb = lightbox();
  const passos = [[2, 250, 420], [3, 120, 330], [2.5, 310, 470], [4, 200, 400], [1.5, 90, 350]];
  for (const [s, x, y] of passos) {
    const dedo = { x, y };
    const u = lb.naFoto(dedo);
    lb.zoomTo(s, x, y);
    const depois = lb.naTela(u);
    assert.ok(Math.abs(depois.x - x) < 1e-6 && Math.abs(depois.y - y) < 1e-6,
      `zoom ${s} em (${x},${y}): o ponto da foto foi parar em (${depois.x.toFixed(1)},${depois.y.toFixed(1)})`);
  }
});

test('zoom: voltar a 1× recentra a foto', () => {
  const lb = lightbox();
  lb.zoomTo(3, 260, 430);
  lb.zoomTo(1, 50, 50);
  assert.deepEqual([lb.scale, lb.tx, lb.ty], [1, 0, 0]);
});
