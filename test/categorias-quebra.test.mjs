// Decisão de tela 5 (2026-10-20): a categoria crua quebra depois do «_», com <wbr>,
// e não no meio da palavra. Elemento, não caractere invisível (a cópia levaria o
// espaço de largura zero e alguns leitores de tela o anunciam).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fatiar(nome) {
  const ini = APP.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu`);
  const resto = APP.slice(ini + 1);
  const fim = resto.search(/\n(?:function |const |\/\/ ──)/);
  return APP.slice(ini, fim > 0 ? ini + 1 + fim : undefined);
}

// Um DOM mínimo: nós de texto e <wbr>.
function el() {
  const filhos = [];
  return {
    filhos,
    set textContent(v) { filhos.length = 0; if (v) filhos.push({ tipo: 'texto', v }); },
    appendChild(n) { filhos.push(n); },
    get texto() { return filhos.filter((f) => f.tipo === 'texto').map((f) => f.v).join(''); },
  };
}
const documento = { createTextNode: (v) => ({ tipo: 'texto', v }), createElement: (tag) => ({ tipo: tag }) };
const escrever = new Function('document', fatiar('escreverCategorias') + '\nreturn escreverCategorias;')(documento);

test('cada «_» ganha um <wbr> logo depois, e o texto não muda', () => {
  const e = el();
  escrever(e, 'RESIDENCE_HOME, SUPERMARKET_GROCERY');
  assert.equal(e.texto, 'RESIDENCE_HOME, SUPERMARKET_GROCERY');
  assert.deepEqual(e.filhos.map((f) => f.tipo === 'texto' ? f.v : '<wbr>'),
    ['RESIDENCE_', '<wbr>', 'HOME, SUPERMARKET_', '<wbr>', 'GROCERY']);
});

test('sem «_» não há <wbr>; o que já estava no elemento é trocado, não somado', () => {
  const e = el();
  e.textContent = 'velho';
  escrever(e, 'BAR');
  assert.deepEqual(e.filhos.map((f) => f.tipo), ['texto']);
  assert.equal(e.texto, 'BAR');
});

test('nenhum caractere invisível: a quebra é o elemento', () => {
  const corpo = fatiar('escreverCategorias');
  // O caractere é montado por código: um escape digitado vira o caractere de verdade ao gravar o arquivo.
  assert.doesNotMatch(corpo, new RegExp('\\\\u200b|' + String.fromCharCode(0x200b), 'i'));
  assert.doesNotMatch(corpo, /innerHTML/);
});

test('o card e a folha do pedido recebido passam pela MESMA função', () => {
  const codigo = semComentario(APP);
  assert.match(codigo, /escreverCategorias\(card\.querySelector\('\.card-category'\)/);
  assert.match(codigo, /escreverCategorias\(\$\('pedidoCat'\)/);
});
