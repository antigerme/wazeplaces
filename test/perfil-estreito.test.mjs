// Decisão de tela 2 (2026-10-20), a que FICOU: o perfil do cabeçalho em telas estreitas ganha largura
// SEM custar altura. A segunda fileira (20 a 36 px de card) foi desfeita porque os cards de reporte
// voltavam a rolar por dentro no Galaxy Fold. O que mede de verdade é o smoke de layout (bloco
// «O PERFIL NO CABEÇALHO DAS TELAS ESTREITAS»); aqui ficam as travas de FONTE que o smoke não vê:
// o <h1> da marca tem que seguir na árvore de acessibilidade e a regra não pode virar segunda fileira.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const html = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');

// Pega o corpo do `@media (max-width: N)` pelo número, casando chaves (o CSS tem `:has(...)` e aninhamento).
function corpoDoMedia(n) {
  const re = new RegExp('@media\\s*\\(max-width:\\s*' + n + 'px\\)\\s*\\{');
  const blocos = [];
  let m; const g = new RegExp(re.source, 'g');
  while ((m = g.exec(css))) {
    let i = m.index + m[0].length, d = 1;
    while (i < css.length && d) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++; }
    blocos.push(css.slice(m.index + m[0].length, i - 1));
  }
  return blocos;
}

test('o bloco da marca sai do fluxo (absolute), nunca com display:none, só com o perfil na tela', () => {
  const alguma = corpoDoMedia(400).some((b) => /header:has\(#userProfileBadge:not\(\.hidden\)\)\s+#brandBlock\s*\{\s*position:\s*absolute;?\s*\}/.test(b));
  assert.ok(alguma, 'falta `header:has(#userProfileBadge:not(.hidden)) #brandBlock { position: absolute }` no @media (max-width: 400px)');
  assert.ok(!/#brandBlock\s*\{[^}]*display:\s*none/.test(css), '#brandBlock com display:none tira o <h1> da árvore de acessibilidade (o js/app.js o põe em sr-only de propósito)');
});

test('até 340 px a margem lateral do cabeçalho desce a 0,5rem, só com o perfil na tela', () => {
  const alguma = corpoDoMedia(340).some((b) => /header:has\(#userProfileBadge:not\(\.hidden\)\)\s*>\s*\.container\s*\{[^}]*padding-left:\s*0\.5rem;[^}]*padding-right:\s*0\.5rem/.test(b));
  assert.ok(alguma, 'falta a regra de 0,5rem de margem lateral no @media (max-width: 340px)');
});

test('não volta a segunda fileira do perfil, que custava altura de card', () => {
  assert.ok(!/#userProfileBadge[^{}]*\{[^}]*(order:|flex-basis:\s*100%|grid-row)/.test(css), 'o perfil do cabeçalho não pode ir pra uma segunda fileira');
  assert.ok(!/header[^{}]*\.container[^{}]*\{[^}]*flex-wrap:\s*wrap/.test(css), 'o cabeçalho não pode quebrar linha');
});

test('o <h1> da marca existe no HTML (é ele que o leitor de tela lê com a marca fora do fluxo)', () => {
  assert.ok(/<h1 id="brandTitle"/.test(html));
});
