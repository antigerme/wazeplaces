// Decisão de tela 7 (2026-10-20): a escala do mini-mapa some quando a legenda a cobre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fatiar(nome) {
  const ini = APP.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu`);
  const resto = APP.slice(ini + 1);
  const fim = resto.search(/\n(?:function |const |\/\/ ──)/);
  return APP.slice(ini, fim > 0 ? ini + 1 + fim : undefined);
}
const ajustar = new Function(fatiar('ajustarEscalaDoMapa') + '\nreturn ajustarEscalaDoMapa;')();

function caixa({ largura = 280, escala, legendas }) {
  const classes = new Set();
  const retangulo = (r) => ({ ...r, left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h, width: r.w, height: r.h });
  const esc = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, getBoundingClientRect: () => retangulo(escala) };
  const legs = legendas.map((r) => ({ getBoundingClientRect: () => retangulo(r) }));
  return {
    classes, clientWidth: largura,
    querySelector: (q) => (q === '.card-map-scale' ? esc : null),
    querySelectorAll: (q) => (q === '.card-map-legend > *' ? legs : []),
  };
}

test('legenda por cima da escala: a escala sai', () => {
  const box = caixa({ escala: { x: 8, y: 60, w: 60, h: 20 }, legendas: [{ x: 8, y: 8, w: 70, h: 20 }, { x: 8, y: 50, w: 100, h: 24 }] });
  ajustar(box);
  assert.ok(box.classes.has('escala-coberta'));
});

test('legenda em outro lugar: a escala fica', () => {
  const box = caixa({ escala: { x: 8, y: 120, w: 60, h: 20 }, legendas: [{ x: 8, y: 8, w: 70, h: 20 }, { x: 90, y: 8, w: 90, h: 20 }] });
  ajustar(box);
  assert.equal(box.classes.has('escala-coberta'), false);
});

test('a marca de um desenho anterior é tirada antes de medir (escondida a escala não tem retângulo)', () => {
  const box = caixa({ escala: { x: 8, y: 120, w: 60, h: 20 }, legendas: [{ x: 8, y: 8, w: 70, h: 20 }] });
  box.classes.add('escala-coberta');
  ajustar(box);
  assert.equal(box.classes.has('escala-coberta'), false);
});

test('caixa fora da tela (largura 0) não decide nada', () => {
  const box = caixa({ largura: 0, escala: { x: 8, y: 60, w: 60, h: 20 }, legendas: [{ x: 8, y: 50, w: 100, h: 24 }] });
  ajustar(box);
  assert.equal(box.classes.has('escala-coberta'), false);
});

test('o renderMapa chama o ajuste ao fim, e o CSS esconde a classe', () => {
  const corpo = semComentario(fatiar('renderMapa'));
  assert.match(corpo, /ajustarEscalaDoMapa\(box\);\s*return true;/);
  assert.match(CSS, /\.card-map-scale\.escala-coberta\s*\{\s*display:\s*none;\s*\}/);
});
