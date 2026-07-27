// Auditoria do gerador de QR (js/qr.js).
//
// O QR do pareamento é o caminho que NÃO precisa ser explicado — aponta a
// câmera e entra. Se ele sair errado, não há erro no console nem teste que
// quebre: simplesmente ninguém consegue escanear, e o editor acha que a app
// está quebrada. Por isso os vetores dourados.
//
// Como os valores abaixo foram obtidos: durante o desenvolvimento comparei a
// saída deste gerador, MÓDULO A MÓDULO, com o pacote `qrcode` (referência
// consagrada) em 106 tamanhos de entrada, versões 1 a 6. Em 106/106 a matriz
// foi idêntica à da referência em alguma das 8 máscaras — o que prova dados,
// correção de erro, colocação e formato corretos. Os hashes aqui congelam
// exatamente aquela saída verificada, sem precisar da dependência no CI.
//
// (A escolha de máscara pode divergir da referência em casos de empate: as 8
// máscaras produzem QR válido, e o próprio formato registra qual foi usada.)

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(ROOT, 'js/qr.js'), 'utf8');
const escopo = {};
new Function('window', 'globalThis', fonte)(escopo, escopo);
const gerarQR = escopo.gerarQR;

const hash = (s) => {
  let h = 5381;
  for (const ch of s) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(16);
};
const achatar = (qr) => qr.modulos.map((r) => Array.from(r).join('')).join('');

test('qr: o gerador existe e é chamável', () => {
  assert.equal(typeof gerarQR, 'function', 'js/qr.js parou de expor gerarQR');
});

test('qr: matrizes idênticas às verificadas contra o gerador de referência', () => {
  const DOURADOS = [
    ['A', 21, 'b075cfb5'],
    ['https://places.wazebrasil.com/?pair=6C497S', 29, 'f621af34'],
    ['https://places.wazebrasil.com/?pair=ABC123', 29, '70b4bbb4'],
    ['x'.repeat(100), 41, 'ff75a95'],
  ];
  for (const [texto, tamanho, esperado] of DOURADOS) {
    const qr = gerarQR(texto);
    assert.ok(qr, `gerarQR devolveu null para ${texto.length} bytes`);
    assert.equal(qr.tamanho, tamanho, `tamanho mudou para ${JSON.stringify(texto.slice(0, 24))}`);
    assert.equal(hash(achatar(qr)), esperado,
      `a matriz mudou para ${JSON.stringify(texto.slice(0, 24))} — se foi de propósito, revalide ` +
      `contra um gerador de referência ANTES de atualizar este vetor`);
  }
});

test('qr: os padrões fixos estão onde a norma manda', () => {
  const qr = gerarQR('https://places.wazebrasil.com/?pair=6C497S');
  const n = qr.tamanho;
  const m = qr.modulos;
  // Localizador: anel escuro 7×7 com miolo 3×3, nos três cantos.
  for (const [l0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let i = 0; i < 7; i++) {
      assert.equal(m[l0][c0 + i], 1, `topo do localizador em (${l0},${c0})`);
      assert.equal(m[l0 + 6][c0 + i], 1, `base do localizador em (${l0},${c0})`);
      assert.equal(m[l0 + i][c0], 1, `esquerda do localizador em (${l0},${c0})`);
      assert.equal(m[l0 + i][c0 + 6], 1, `direita do localizador em (${l0},${c0})`);
    }
    assert.equal(m[l0 + 1][c0 + 1], 0, 'anel claro do localizador');
    assert.equal(m[l0 + 3][c0 + 3], 1, 'miolo do localizador');
  }
  // Temporização: alterna a partir da linha/coluna 6.
  for (let i = 8; i < n - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0 ? 1 : 0, `temporização horizontal em ${i}`);
    assert.equal(m[i][6], i % 2 === 0 ? 1 : 0, `temporização vertical em ${i}`);
  }
  // Módulo escuro fixo.
  assert.equal(m[n - 8][8], 1, 'sumiu o módulo escuro obrigatório');
});

test('qr: acima da capacidade devolve null em vez de um código inválido', () => {
  // Melhor não desenhar nada do que desenhar um QR que ninguém consegue ler.
  assert.equal(gerarQR('x'.repeat(200)), null, 'texto grande demais devia devolver null');
  // O link real tem folga: ~42 bytes contra 106 de capacidade na v6.
  const real = 'https://places.wazebrasil.com/?pair=6C497S';
  assert.ok(real.length < 60, 'o link de pareamento cresceu — confira a capacidade');
  assert.ok(gerarQR(real), 'o link real precisa caber');
});

test('qr: quem desenha usa o código CRU, não o formatado com separador', () => {
  // O separador do código (`6C4-97S`) é apresentação. Se ele entrar na URL, o
  // link deixa de bater com o que o servidor espera.
  const app = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
  // `function desenharQrPareamento(url)` casa primeiro se o regex não excluir a
  // DEFINIÇÃO — e aí o teste avalia a assinatura em vez da chamada.
  const chamada = [...app.matchAll(/(?<!function )desenharQrPareamento\(([^)]*)\)/g)]
    .map((m) => m[0])
    .find((x) => x.includes('/?pair='));
  assert.ok(chamada, 'ninguém mais desenha o QR do pareamento com o link');
  assert.match(chamada, /r\.code/, 'o QR precisa usar o código cru da resposta');
  assert.doesNotMatch(chamada, /formatarCodigoPareamento/, 'o QR não pode levar o separador');
});
