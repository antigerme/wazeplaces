// Decisão de tela 1 (2026-10-20): o celular deitado MUITO baixo (568×320, o iPhone SE de 1ª geração)
// usa a planta deitada — foto na coluna ao lado, ações presas sob a foto — a partir de 560 px de largura.
// Os DOIS degraus por altura mudaram o número NO LUGAR (nenhum bloco duplicado: os guards do degrau leem a
// PRIMEIRA ocorrência do @media, e uma duplicata acima os desviava).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const APPCSS = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

test('os dois degraus deitados começam em 560 px, e nenhum ficou em 600', () => {
  const quantos = (re) => (CSS.match(re) || []).length;
  assert.equal(quantos(/@media \(max-height: 480px\) and \(min-width: 560px\) \{/g), 2, 'a planta deitada e o comentário de reporte deitado');
  assert.equal(quantos(/@media \(max-height: 480px\) and \(min-width: 600px\)/g), 0, 'sobrou um degrau em 600 (o 568×320 volta a empilhar a foto)');
});

test('o CSS gerado tem a mesma regra (css/app.css não ficou velho)', () => {
  assert.ok(APPCSS.includes('(min-width:560px)') && APPCSS.includes('(max-height:480px)'), 'rode npm run css');
  assert.ok(!/\(max-height:480px\)\s*and\s*\(min-width:600px\)/.test(APPCSS));
});

test('a faixa de larguras do offline cobre a foto do 568 deitado (200–203 px)', () => {
  const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const min = Number(/^const OFFLINE_CAIXA_LARGURA_MIN_PX = (\d+);/m.exec(APP)[1]);
  assert.ok(min <= 200, `o piso da faixa (${min}) está acima da foto do 560 deitado (200 px): girar o aparelho com rede deixaria mapa sem tile`);
});
