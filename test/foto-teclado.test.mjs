// Decisão de tela 6 (2026-10-20): a foto do card abre pelo teclado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const ini = APP.indexOf('function renderCardImages(');
const corpo = semComentario(APP.slice(ini, APP.indexOf('\n}\n', ini) + 3));

test('a foto vira botão focável: tabIndex 0 e role="button"', () => {
  assert.match(corpo, /img\.tabIndex = 0;/);
  assert.match(corpo, /img\.setAttribute\('role', 'button'\);/);
});

test('Enter e Espaço abrem a MESMA ampliação do toque, uma vez só quando seguradas', () => {
  const k = corpo.slice(corpo.indexOf("img.addEventListener('keydown'"));
  assert.match(k, /ev\.target !== img/, 'só com o foco na própria foto (as setas do carrossel têm as teclas delas)');
  assert.match(k, /ev\.key !== 'Enter' && ev\.key !== ' '/);
  assert.match(k, /atalhoDoNavegador\(ev\)/);
  assert.match(k, /ev\.stopPropagation\(\); ev\.preventDefault\(\);\s*if \(ev\.repeat\) return;\s*openLightbox\(/);
});

test('o nome do botão diz o que é a foto E o que o toque faz, nas 4 línguas', () => {
  assert.match(corpo, /setAttribute\('aria-label', `\$\{img\.alt\}\. \$\{t\('card\.img\.ampliar'\)\}`\)/);
  const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  assert.equal((I18N.match(/'card\.img\.ampliar':/g) || []).length, 4);
});

test('o anel de foco fica por dentro da foto (a caixa corta o que passa)', () => {
  assert.match(CSS, /\.card-image:focus-visible\s*\{\s*outline-offset:\s*-3px;\s*\}/);
});
