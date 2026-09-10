// A faixa "já lido" no card.
//
// Nasceu de um relato: o editor marcava como lido, atualizava a fila e o pedido
// voltava. NÃO era bug — o filtro dele estava com "Apenas pedidos não lidos"
// desmarcado, e aí o core pede ao Waze tudo (`userPropertiesFilter: {}`) e não
// pula o já-lido. O que faltava era o card DIZER isso, e ele não podia: o
// `isRead` era lido só pra filtrar e descartado antes de chegar ao frontend.
// O rastro dele tem a MESMA marcação feita duas vezes no mesmo pedido.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const APP = read('js/app.js');
const HTML = read('index.html');
const CSS = read('css/styles.css');
const CORE = read('server/core.mjs');
const DICT = read('js/i18n.js');

test('faixa: o core PASSA o isRead — era ele que faltava', () => {
  assert.match(CORE, /isRead: !!ur\.isRead,/,
    'o core voltou a descartar o isRead, e aí o card não tem como saber');
  // Continua sendo usado pra FILTRAR também — as duas coisas, não uma no lugar
  // da outra. O filtro é o que faz o pedido lido nem voltar no padrão.
  assert.match(CORE, /userPropertiesFilter: unreadOnly \? \{ isRead: false \} : \{\}/,
    'o filtro por isRead saiu do payload ao Waze');
  assert.match(CORE, /if \(unreadOnly && ur\.isRead === true\) continue;/,
    'o pulo do já-lido na expansão saiu');
});

test('faixa: só aparece com isRead ESTRITAMENTE true', () => {
  const m = APP.match(/card-read-banner'\)\?\.classList\.toggle\('hidden', ([^)]+)\)/);
  assert.ok(m, 'ninguém liga/desliga a faixa');
  assert.equal(m[1].trim(), "place.isRead !== true",
    'a condição deixou de ser estrita: `undefined`/`0`/`""` passariam a esconder ou mostrar por coerção');
});

test('faixa: é linha de altura previsível — quem cede espaço é a FOTO', () => {
  // Gotcha #36: no card quem cede espaço é a foto. Sem `flex-shrink-0` a faixa
  // vira o alvo do encolhimento e some pela metade em vez de a foto ceder.
  const tag = HTML.match(/<div class="card-read-banner[^"]*"[^>]*>/);
  assert.ok(tag, 'a faixa sumiu do template do card');
  assert.match(tag[0], /flex-shrink-0/, 'a faixa perdeu o flex-shrink-0');
  assert.match(tag[0], /\bhidden\b/, 'a faixa nasce visível — apareceria em todo card');
  assert.match(tag[0], /data-i18n="card\.read\.banner"/, 'a faixa perdeu a chave de i18n');
  // Ela vive ACIMA da barra de ações — abaixo dela ficaria fora da dobra em
  // tela apertada, e acima da foto empurraria o conteúdo que decide.
  const iFaixa = HTML.indexOf('card-read-banner');
  const iBarra = HTML.indexOf('card-actions flex');
  assert.ok(iFaixa > 0 && iBarra > iFaixa, 'a faixa saiu de cima da barra de ações');
});

test('faixa: NÃO tem title — title não se alcança no celular', () => {
  // Mesma lição da linha "de N na região", que explica os bloqueados só num
  // `title` e por isso não explica nada no aparelho onde a app roda. Aqui é
  // ainda mais direto: a faixa EXISTE pra explicar, então esconder a explicação
  // num title seria não fazer nada.
  const tag = HTML.match(/<div class="card-read-banner[^"]*"[^>]*>/)[0];
  assert.ok(!/\btitle=/.test(tag) && !/data-i18n-title/.test(tag),
    'a explicação foi parar num title, que no celular ninguém alcança');
});

test('faixa: verde e ✓ — o MESMO conceito do botão de marcar como lido', () => {
  // Regra de consistência do projeto: mesmo conceito, mesmo ícone e mesma cor
  // em toda a app (✕ rejeitar/rosa, ✓ lido/verde, ↑ pular/âmbar).
  const bloco = CSS.slice(CSS.indexOf('.card-read-banner:not(.hidden)'),
                          CSS.indexOf('.dark .card-read-banner') + 240);
  assert.ok(bloco.length > 100, 'o bloco da faixa sumiu do styles.css');
  assert.match(bloco, /content: '\\2713/, 'o ✓ saiu da faixa');
  assert.match(bloco, /color: #065f46/,
    'a cor do texto mudou — ela foi ESCOLHIDA por medição (contraste no pixel composto)');
  assert.match(bloco, /\.dark \.card-read-banner/, 'a faixa perdeu a variante escura');
});

test('faixa: existe nas QUATRO línguas, e diz a CAUSA', () => {
  const n = (DICT.match(/'card\.read\.banner':/g) || []).length;
  const linguas = (DICT.match(/^  [a-z]{2}: \{$/gm) || []).length;
  assert.equal(n, linguas, `a chave está em ${n} línguas e o dicionário tem ${linguas}`);
  // Cada frase tem que dizer a CAUSA (o filtro), não só o estado. "Lido"
  // sozinho não responde "então por que ele voltou?", que é a pergunta que o
  // editor fez. E não pode crescer sem limite: cada linha extra sai da FOTO.
  for (const m of DICT.matchAll(/'card\.read\.banner': '([^']*)'/g)) {
    assert.ok(/filtr|filter/i.test(m[1]),
      `"${m[1]}" não menciona o filtro — vira só o estado, e o estado não explica a volta`);
    assert.ok(m[1].length <= 70,
      `"${m[1]}" tem ${m[1].length} caracteres — cada linha a mais é foto a menos`);
  }
});
