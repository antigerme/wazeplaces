// O teclado virtual e o `--kb-inset`.
//
// O bug que originou este arquivo: no PWA do iOS de um editor L2+AM o
// `--kb-inset` ficou cravado em 388px SEM teclado nenhum. Ele desconta do teto
// de altura de todos os 11 modais (`max-h-[calc(85dvh-var(--kb-inset))]`) e do
// padding que os centraliza, então o modal de Filtros foi de 690pt pra 302pt —
// reproduzido no Chromium contra o vídeo dele, que mediu 305pt. Como o valor só
// era recalculado em `resize`/`scroll` do visualViewport, e o scroll-lock do
// modal impede os dois de disparar, o estrago durava a sessão inteira.
//
// Aqui ficam a DECISÃO (`insetDoTeclado`, pura e avaliada de verdade) e a rede
// ESTRUTURAL em volta dela — quem escreve `--kb-inset` passa pela decisão, e os
// ouvintes de foco existem. As duas coisas cabem no `node --test` sem browser.
// A prova de COMPORTAMENTO — o modal medindo altura com um visualViewport falso,
// e o controle de que o teclado de verdade ainda funciona — vive no
// tools/smoke-browser.mjs, onde há Chromium.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'js/app.js'), 'utf8');

// Fatia a função pura e a avalia — nunca parseia a expressão (gotcha #49).
function montar() {
  const i = APP.indexOf('function insetDoTeclado(');
  assert.ok(i > 0, 'insetDoTeclado sumiu do app.js');
  const fim = APP.indexOf('\n}', i);
  const corpo = APP.slice(i, fim + 2);
  return new Function(corpo + '\nreturn insetDoTeclado;')();
}

const JANELA = 812; // iPhone X — o aparelho do editor que reportou

test('teclado: sem campo focado o inset é ZERO, doa o que doer a leitura', () => {
  const inset = montar();
  // 388 é o valor real que veio cravado do PWA do iOS.
  assert.equal(inset(388, JANELA, false), 0);
  assert.equal(inset(336, JANELA, false), 0);
  assert.equal(inset(10000, JANELA, false), 0);
});

test('teclado: com campo focado o inset passa — é pra isso que ele existe', () => {
  const inset = montar();
  assert.equal(inset(336, JANELA, true), 336);   // teclado do iPhone X
  assert.equal(inset(300, JANELA, true), 300);
});

test('teclado: o piso de 80px ignora a barra do navegador', () => {
  const inset = montar();
  assert.equal(inset(80, JANELA, true), 0);   // limite: NÃO passa
  assert.equal(inset(81, JANELA, true), 81);  // logo acima: passa
  assert.equal(inset(0, JANELA, true), 0);
  assert.equal(inset(-40, JANELA, true), 0);  // leitura negativa não vira inset
});

test('teclado: o teto de 75% limita o estrago sem cortar teclado legítimo', () => {
  const inset = montar();
  const teto = Math.round(JANELA * 0.75); // 609
  assert.equal(inset(700, JANELA, true), teto);
  assert.equal(inset(teto, JANELA, true), teto);
  // O caso apertado que o teto NÃO pode cortar: paisagem, janela curta e
  // teclado ocupando ~55% dela. Teto frouxo é decisão, não folga por acaso.
  assert.equal(inset(206, 375, true), 206);
  // …e a mesma janela curta com uma leitura absurda continua limitada.
  assert.equal(inset(370, 375, true), Math.round(375 * 0.75));
});

test('teclado: o portão do foco é ALLOWLIST — checkbox e botão não abrem teclado', () => {
  // `openModal` foca o primeiro focável do modal, e a app tem 12 checkboxes e
  // 70 botões: seletor frouxo daria "campo focado" em quase toda abertura, que
  // é exatamente o estado em que o bug apareceu.
  const i = APP.indexOf('const CAMPOS_COM_TECLADO');
  assert.ok(i > 0, 'CAMPOS_COM_TECLADO sumiu');
  const sel = new Function(APP.slice(i, APP.indexOf(';', APP.indexOf('input[type="week"]'))) + ';\nreturn CAMPOS_COM_TECLADO;')();
  for (const t of ['text', 'search', 'url', 'tel', 'email', 'password', 'number']) {
    assert.ok(sel.includes(`input[type="${t}"]`), `faltou input[type=${t}] na allowlist`);
  }
  for (const alvo of ['textarea', 'select']) assert.ok(sel.includes(alvo), `faltou ${alvo}`);
  // O que NÃO pode estar lá — nem como `input` genérico, nem como :not()
  assert.ok(!/input\s*[,)]/.test(sel), 'a allowlist virou seletor genérico de input');
  for (const t of ['checkbox', 'radio', 'button', 'submit', 'file']) {
    assert.ok(!sel.includes(`"${t}"`), `${t} não abre teclado e entrou na allowlist`);
  }
});

test('teclado: o inset é recalculado no foco, não só no visualViewport', () => {
  // Era a segunda metade do bug: sem estes dois ouvintes, um valor errado só
  // sairia da tela na próxima vez que o teclado se mexesse — e o scroll-lock do
  // modal garante que isso é "nunca".
  const i = APP.indexOf('function setupKeyboardInset(');
  const corpo = APP.slice(i, i + 2200);
  for (const ev of ['focusin', 'focusout']) {
    assert.match(corpo, new RegExp(`addEventListener\\('${ev}'`), `setupKeyboardInset não ouve ${ev}`);
  }
  assert.match(corpo, /visualViewport|vv\.addEventListener\('resize'/, 'perdeu o ouvinte do visualViewport');
  assert.match(corpo, /vv\.addEventListener\('scroll'/, 'perdeu o scroll do visualViewport');
});

test('teclado: quem escreve --kb-inset passa pela decisão, não pelo valor cru', () => {
  const i = APP.indexOf('function setupKeyboardInset(');
  const corpo = APP.slice(i, i + 2200);
  const escrita = corpo.match(/setProperty\('--kb-inset',\s*([^)]+)\)/);
  assert.ok(escrita, 'ninguém escreve --kb-inset em setupKeyboardInset');
  assert.match(escrita[1], /^inset\s*\+/, 'o valor escrito não é o que saiu de insetDoTeclado');
  assert.match(corpo, /const inset = insetDoTeclado\(/, 'a decisão foi contornada');
});
