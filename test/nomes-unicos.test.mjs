// Os scripts do app são CLÁSSICOS e dividem o mesmo escopo global: uma
// `function` declarada duas vezes não dá erro nenhum — a última vence, calada.
// Foi o que a junção dos consertos da auditoria de 2026-09-26 produziu: dois
// branches paralelos criaram um `devolverFoco` cada (o do fechar de modal e o
// do painel do Histórico), e o fechar de modal passou a chamar o do painel,
// sem nenhum sintoma além de testes de harness com o nome errado. O `const`
// e o `let` repetidos já quebram na carga (e o smoke vê); a `function` e o
// `var` repetidos não quebram nada — daí este guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../js/', import.meta.url);
const ARQUIVOS = readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();

// Declaração de TOPO: começa na coluna 0 (o código do app é indentado dentro
// de função, então o que está na coluna 0 é do escopo do script).
const DECLARACAO = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/;

function declaracoesDeTopo(texto) {
  const nomes = [];
  let emComentario = false;
  for (const linha of texto.split('\n')) {
    if (emComentario) { if (linha.includes('*/')) emComentario = false; continue; }
    if (/^\s*\/\*/.test(linha) && !linha.includes('*/')) { emComentario = true; continue; }
    const m = DECLARACAO.exec(linha);
    if (m) nomes.push(m[1] || m[2]);
  }
  return nomes;
}

test('nenhum nome de topo é declarado duas vezes nos scripts do app (o escopo global é UM só)', () => {
  const onde = new Map();
  for (const f of ARQUIVOS) {
    for (const nome of declaracoesDeTopo(readFileSync(new URL(f, DIR), 'utf8'))) {
      if (!onde.has(nome)) onde.set(nome, []);
      onde.get(nome).push(f);
    }
  }
  const repetidos = [...onde].filter(([, lista]) => lista.length > 1)
    .map(([nome, lista]) => `${nome} (${lista.join(', ')})`);
  assert.deepEqual(repetidos, [], 'nome de topo declarado mais de uma vez — a última declaração vence, calada');
});

test('CONTROLE: o varredor enxerga função, função assíncrona e const de topo, e ignora o indentado', () => {
  const nomes = declaracoesDeTopo([
    'function a() {}',
    'async function b() {}',
    'const c = 1;',
    '    function naoConta() {}',
    '/*',
    'function dentroDeComentario() {}',
    '*/',
  ].join('\n'));
  assert.deepEqual(nomes, ['a', 'b', 'c']);
  // E o app de verdade tem centenas: se o varredor não achasse nada, o guard
  // de cima passaria vazio.
  const doApp = declaracoesDeTopo(readFileSync(new URL('app.js', DIR), 'utf8'));
  assert.ok(doApp.length > 300, `o varredor achou só ${doApp.length} declarações no app.js`);
  assert.ok(doApp.includes('devolverFoco') && doApp.includes('devolverFocoAoPainel'));
});
