// Decisão de tela 4 (2026-10-20): o título e o ✕ da Ajuda ficam presos no topo do cartão que rola.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const APPCSS = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
const ini = HTML.indexOf('id="helpModal"');
const cartao = HTML.slice(ini, HTML.indexOf('id="closeHelp"', ini) + 40);
const cabecalho = cartao.slice(cartao.lastIndexOf('<div class="', cartao.indexOf('id="helpModalTitle"')));

test('o cabeçalho da Ajuda (título e ✕) é sticky, com fundo opaco nos dois temas', () => {
  const cls = /^<div class="([^"]*)"/.exec(cabecalho)[1].split(/\s+/);
  for (const c of ['sticky', '-top-6', 'z-10', 'bg-white', 'dark:bg-slate-800', '-mx-6', '-mt-6', 'px-6', 'pt-6']) {
    assert.ok(cls.includes(c), `falta ${c} no cabeçalho: ${cls.join(' ')}`);
  }
  assert.ok(cabecalho.includes('id="helpModalTitle"') && cabecalho.includes('id="closeHelp"'), 'o título e o ✕ moram dentro do cabeçalho preso');
});

test('o -top-6 desconta o padding do cartão: com top-0 o texto passava por cima do cabeçalho', () => {
  assert.ok(!/class="[^"]*\bsticky top-0\b[^"]*-mx-6/.test(cartao), 'o sticky mede a partir do conteúdo do cartão (24 px), não da borda');
});

test('o cartão que rola reserva o foco do teclado fora de baixo do cabeçalho', () => {
  assert.match(cartao, /scroll-pt-\[5rem\]/);
});

test('o CSS gerado tem as classes (o Tailwind só gera o que acha no HTML)', () => {
  for (const c of ['.sticky', '.-top-6', '.-mx-6', '.-mt-6', '.scroll-pt-\\[5rem\\]']) {
    assert.ok(APPCSS.includes(c), `${c} não está no css/app.css`);
  }
});
