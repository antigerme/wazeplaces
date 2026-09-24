// O ícone das ordens do "Ordenar por" — e por que ele NÃO mora no dicionário.
//
// Ele morava: `'filters.sort.casa': '🏠 Perto de casa'`, com o argumento de que
// assim o `applyI18n` o trocava junto com o texto. Duas coisas quebravam nisso:
//
//  (a) o rótulo da ordem padrão é INTERPOLADO numa frase — o aviso de GPS
//      negado diz "a ordem voltou pra «…»" —, então o emoji ia parar no meio
//      da prosa, entre aspas;
//  (b) a régua "o mesmo conceito usa o mesmo ícone em todo o app" ficava
//      espalhada por 4 dicionários, sem um lugar onde conferir.
//
// Agora o ícone é do CONCEITO (um mapa), e o dicionário volta a ser texto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
const ORDENS = ['newest', 'oldest', 'casa', 'trabalho', 'gps'];

test('TODA ordem tem ícone — nenhuma fica sem, que era a assimetria', () => {
  const m = APP.match(/const ORDEM_ICONE = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(m, 'sumiu o ORDEM_ICONE');
  for (const o of ORDENS) {
    assert.match(m[1], new RegExp(o + ":\\s*'\\p{Extended_Pictographic}", 'u'),
      `a ordem "${o}" ficou sem ícone — é exatamente a assimetria que se estava consertando`);
  }
});

test('o dicionário NÃO carrega ícone, em nenhuma língua', () => {
  // É isto que impede o emoji de vazar pra prosa. Vale pras 4 línguas: basta
  // uma esquecida pra o hint sair com emoji só naquele idioma.
  const linhas = I18N.split('\n').filter((l) => /'filters\.sort\.(newest|oldest|casa|trabalho|gps)':/.test(l));
  assert.ok(linhas.length >= 4 * 3, `esperava as chaves nas 4 línguas, achei ${linhas.length} linhas`);
  for (const l of linhas) {
    assert.ok(!/\p{Extended_Pictographic}/u.test(l),
      `ícone de volta no dicionário — ele vaza pro aviso de GPS negado: ${l.trim()}`);
  }
});

test('o rótulo da ordem PADRÃO entra na frase sem decoração', () => {
  // O caso concreto: `filters.sort.hint.negado` interpola `{padrao}`.
  const i = APP.indexOf("negado: ['filters.sort.hint.negado'");
  assert.notEqual(i, -1, 'sumiu o hint de GPS negado');
  const linha = APP.slice(i, APP.indexOf('\n', i));
  assert.match(linha, /padrao: t\('filters\.sort\.' \+ ORDEM_PADRAO\)/,
    'a frase passou a usar o rótulo DECORADO — o emoji volta pro meio da prosa');
  assert.ok(!/rotuloDaOrdem/.test(linha), 'a frase chamou o rótulo com ícone');
});

test('o select decora as CINCO opções, e não só as de distância', () => {
  const i = APP.indexOf('function popularOrdenacoes');
  const corpo = APP.slice(i, APP.indexOf('\n}', i));
  assert.match(corpo, /rotuloDaOrdem\(ordem\)/, 'as opções de distância perderam o ícone');
  assert.match(corpo, /for \(const ordem of \['newest', 'oldest'\]\)[\s\S]{0,200}rotuloDaOrdem\(ordem\)/,
    'as duas de DATA deixaram de ser decoradas — volta a assimetria de 3 com ícone e 2 sem');
});

test('trocar de idioma redecora (senão o applyI18n come o ícone)', () => {
  // As opções de data vivem no HTML com `data-i18n`, então o `applyI18n`
  // reescreve o textContent delas e leva o ícone junto. Sem esta chamada, o
  // ícone some das duas ao trocar de idioma — e só das duas.
  assert.match(HTML, /<option value="newest" data-i18n="filters\.sort\.newest">/,
    'a opção de data saiu do HTML com data-i18n: revise se a redecoração ainda é necessária');
  const i = APP.indexOf('function aplicarIdioma');
  const corpo = APP.slice(i, APP.indexOf('\n}', i));
  const posI18n = corpo.indexOf('applyI18n()');
  const posPop = corpo.indexOf('popularOrdenacoes()');
  assert.ok(posPop !== -1, 'a troca de idioma parou de redecorar as ordens');
  assert.ok(posI18n < posPop, 'redecorou ANTES do applyI18n — ele apaga o ícone logo depois');
});

test('o rótulo não repete o que o campo já diz', () => {
  // "Ordenar por: Mais recentes primeiro" — o "primeiro" é redundante, e era
  // ele que estourava a largura no Galaxy Fold quando o ícone entrou.
  // MEDIDO: com "primeiro", fr dava 152px numa caixa de 150; sem, 140px.
  for (const [lang, proibido] of [['pt', 'primeiro'], ['en', 'first'], ['es', 'primero'], ['fr', 'd’abord']]) {
    const re = new RegExp("'filters\\.sort\\.(newest|oldest)': '[^']*" + proibido, 'i');
    assert.ok(!re.test(I18N), `o rótulo de ${lang} voltou a repetir "${proibido}" — no Fold ele não cabe com o ícone`);
  }
});
