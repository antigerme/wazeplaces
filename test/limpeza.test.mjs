// Auditoria de sobras — o que a app deixa para trás quando ninguém está olhando.
//
// Nada aqui quebra em uso normal: o QR fica desenhado depois de fechar, o
// timer segue rodando, o histórico cresce um balde por dia. Não há erro no
// console nem tela quebrada — só lixo acumulando e credencial na tela sem
// motivo. Por isso vira teste: é o tipo de coisa que ninguém percebe voltando.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const APP = read('js/app.js');
const NODE = read('server/node.mjs');

test('limpeza de modal vale para TODOS os caminhos de fechamento', () => {
  // Modal fecha por botão, Esc e clique no scrim. Amarrar a limpeza ao botão
  // deixa os outros dois vazando — foi exatamente o que aconteceu: fechando o
  // pareamento por Esc, o setInterval seguia rodando pelo resto da sessão.
  assert.match(APP, /const LIMPEZA_AO_FECHAR/, 'sumiu o mapa de limpeza por modal');
  const fechar = APP.match(/function closeModal\(id\)[\s\S]*?\n\}/);
  assert.ok(fechar, 'sumiu o closeModal');
  assert.match(fechar[0], /LIMPEZA_AO_FECHAR\[id\]/,
    'closeModal parou de chamar a limpeza — Esc e scrim voltam a vazar');
  // O ticker não pode depender só do botão.
  const mapa = APP.match(/const LIMPEZA_AO_FECHAR = \{[\s\S]*?\n\};/);
  assert.ok(mapa, 'não consegui ler o mapa de limpeza');
  assert.match(mapa[0], /pararTickerPareamento\(\)/, 'o ticker do pareamento saiu da limpeza');
  assert.match(mapa[0], /limparQrPareamento\(\)/, 'o QR não é mais apagado ao fechar');
  assert.match(mapa[0], /dataset\.raw/, 'o código cru continua guardado depois de fechar');
});

test('o QR é apagado, não só sobrescrito na próxima abertura', () => {
  // Canvas guarda o último desenho pra sempre. Sem apagar, reabrir mostra o QR
  // do código ANTERIOR até a resposta chegar — e QR de pareamento é credencial.
  assert.match(APP, /function limparQrPareamento/, 'sumiu o limparQrPareamento');
  const limpar = APP.match(/function limparQrPareamento\(\)[\s\S]*?\n\}/);
  assert.match(limpar[0], /clearRect/, 'limparQrPareamento parou de limpar o canvas');
  // E também antes de pedir código novo, porque a resposta demora.
  const abrir = APP.match(/async function abrirPareamento\(\)[\s\S]*?\n\}/);
  assert.ok(abrir, 'sumiu o abrirPareamento');
  assert.match(abrir[0], /limparQrPareamento\(\)/, 'o QR velho fica na tela enquanto o novo carrega');
});

test('o histórico não cresce para sempre — e o Total continua verdadeiro', () => {
  // Um balde por dia, sem poda, é crescimento sem fim; e como o recordHistory
  // serializa o objeto INTEIRO a cada ação confirmada, o custo de cada swipe
  // cresceria junto. Mas podar somando só o que sobrou faria o "Total"
  // encolher sozinho — daí o acumulador separado.
  assert.match(APP, /const HISTORY_MAX_DIAS/, 'sumiu o limite de dias do histórico');
  assert.match(APP, /function podarHistorico/, 'sumiu a poda do histórico');
  const carregar = APP.match(/function loadHistory\(\)[\s\S]*?\n\}/);
  assert.ok(carregar, 'sumiu o loadHistory');
  assert.match(carregar[0], /podarHistorico/, 'o histórico parou de ser podado ao carregar');
  assert.match(carregar[0], /_total/, 'sumiu a migração do formato antigo para o acumulador');

  const stats = APP.match(/function getHistoryStats\(\)[\s\S]*?\n\}/);
  assert.ok(stats, 'sumiu o getHistoryStats');
  assert.match(stats[0], /h\._total/, 'o "Total" voltou a somar só os baldes — vai encolher com a poda');
  assert.doesNotMatch(stats[0], /acc\.total\.read \+=/, 'o "Total" está somando balde de novo');

  const gravar = APP.match(/function recordHistory\([\s\S]*?\n\}/);
  assert.match(gravar[0], /_total/, 'o acumulador parou de ser alimentado');
});

test('o GC da VM poda pareamento pelo TTL dele, sem tocar em sessão viva', () => {
  // Pareamento vale 5 minutos e sessão 21 dias, mas os dois moram no mesmo
  // diretório com o mesmo prefixo. Cortar tudo por SESSION_TTL deixa o
  // pareamento 6000× mais tempo no disco do que ele vale.
  const gc = NODE.match(/async function gcSessions\(\)[\s\S]*?\n\}/);
  assert.ok(gc, 'sumiu o gcSessions do adaptador da VM');
  assert.ok(gc[0].includes(String.raw`/^(\d+)\|/`),
    'o GC parou de reconhecer o carimbo de expiração do pareamento');

  // O corte NUNCA pode casar um blob de sessão: apagaria gente logada.
  // Sessão é `base64(iv)::base64(ct)` — o alfabeto base64 não tem `|`.
  const CORTE = /^(\d+)\|/;
  const SESSOES = ['TC8P4JuiM1nFsoan::5y+RVDIi', '0000aaaa::bbbb', '123abc::deff'];
  for (const blob of SESSOES) {
    assert.equal(CORTE.test(blob), false, `o corte casaria uma sessão: ${blob}`);
  }
  assert.equal(CORTE.test('1785193636|UX2AgQaeqY2uabP'), true, 'o corte deixou de pegar pareamento');
});
