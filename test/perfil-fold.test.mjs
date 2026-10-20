// Decisão de tela 2 (2026-10-20): no Galaxy Fold (≤ 290 px) o perfil desce pra uma segunda fileira do cabeçalho.
// A regra vale com o PERFIL na tela e é CONSTANTE: o ícone de gente some quando não há ninguém no app, e um
// cabeçalho que subisse e descesse 36 px mexeria o card por um motivo que não é do card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const APPCSS = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
const ini = CSS.indexOf('@media (max-width: 290px) {');
const bloco = CSS.slice(ini, CSS.indexOf('\n}\n', ini) + 3);
const COM_PERFIL = 'header:has(#userProfileBadge:not(.hidden))';

test('a segunda fileira vale ≤ 290 px e só com o perfil na tela (a tela de entrada não é tocada)', () => {
  assert.ok(ini > 0, 'sumiu o degrau do Fold');
  const seletores = [...bloco.matchAll(/^\s*([^{}\n]+?)\s*\{/gm)].map((m) => m[1]).filter((s) => !s.startsWith('@'));
  assert.ok(seletores.length >= 4);
  for (const s of seletores) assert.ok(s.startsWith(COM_PERFIL), `a regra «${s}» vale sem o perfil na tela`);
});

test('NÃO depende do ícone de gente: o cabeçalho não pode subir e descer com quem entra e sai', () => {
  assert.ok(!/presencaPill/.test(bloco), 'o degrau do Fold passou a depender do ícone de gente');
});

test('o perfil vai à 2ª fileira, alinhado à direita, e os botões ficam na 1ª', () => {
  assert.match(bloco, /> \.container \{\s*flex-wrap: wrap;/);
  assert.match(bloco, /#userProfileBadge \{[^}]*order: 2;[^}]*flex: 1 0 100%;[^}]*justify-content: flex-end;/);
  assert.match(bloco, /> \.container > div:last-child \{[^}]*order: 1;[^}]*margin-left: auto;/);
});

test('o 320 px (iPhone SE de 1ª geração) e acima ficam como estavam', () => {
  assert.ok(!/@media \(max-width: (29[1-9]|3\d\d)px\)[^{]*\{[^@]*flex-wrap: wrap/.test(CSS.slice(ini - 20)), 'a segunda fileira vazou além de 290 px');
});

test('o CSS gerado tem o degrau (css/app.css não ficou velho)', () => {
  assert.ok(APPCSS.includes('(max-width:290px)'), 'rode npm run css');
});
