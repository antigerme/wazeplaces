// Só o botão PRINCIPAL do mouse arrasta o card (auditoria de 2026-09-25): o
// direito (menu de contexto) e o do meio (rolagem) começavam um arraste que
// COMETIA a ação ao soltar além do limiar. O swipe.js roda de verdade num
// documento de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SWIPE = readFileSync(new URL('../js/swipe.js', import.meta.url), 'utf8');

function carregar() {
  const ouvintes = {};
  const doc = { addEventListener: (t, fn) => { (ouvintes[t] ||= []).push(fn); }, removeEventListener() {},
    querySelector: () => null, getElementById: () => null };
  const ctx = { document: doc, window: {}, navigator: {}, setTimeout, clearTimeout, requestAnimationFrame: (f) => f(), performance: { now: () => 0 }, console };
  vm.createContext(ctx);
  vm.runInContext(SWIPE + '\nthis.__estado = () => ({ isDragging });\nthis.__iniciar = handleDragStart;', ctx);
  return ctx;
}
const card = { style: {}, classList: { add() {}, remove() {}, contains: () => false }, querySelector: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 500 }) };
const alvo = { closest: () => null };

test('arraste com o botão DIREITO ou o do MEIO não começa; o principal começa (controle)', () => {
  for (const [botao, esperado] of [[2, false], [1, false], [0, true]]) {
    const c = carregar();
    try {
      c.__iniciar({ type: 'mousedown', button: botao, clientX: 100, clientY: 200, target: alvo, currentTarget: card, preventDefault() {} });
    } catch (e) { /* o resto do arraste pode precisar de DOM de verdade; o que importa é o estado */ }
    assert.equal(c.__estado().isDragging, esperado, `botão ${botao}: isDragging=${c.__estado().isDragging}`);
  }
});
