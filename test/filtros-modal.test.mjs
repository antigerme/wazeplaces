// O modal de Filtros: o que ele MOSTRA tem que ser o que o "Aplicar" GRAVA
// (auditoria da fila, 2026-09-26). Em cada caso abaixo o seletor mostrava uma
// coisa e o "Aplicar" gravava outra — o filtro salvo sumia calado, ou o filtro
// que a pessoa via não era o que a busca aplicava. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  i = APP_SEM.indexOf('{', i);
  let prof = 0, fim = APP_SEM.length;
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fim);
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}

// Um <select> que se comporta como o do navegador no que importa aqui: as
// opções saem do `innerHTML`, e `value` com opção inexistente deixa o seletor
// VAZIO (`selectedIndex` -1, `value` '') — é assim que o filtro some da tela.
function seletor() {
  const s = {
    dataset: {}, disabled: false, opcoes: [], selectedIndex: -1,
    set innerHTML(html) {
      s.opcoes = [...String(html).matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => ({ value: m[1], text: m[2] }));
      s.selectedIndex = s.opcoes.length ? 0 : -1;
    },
    appendChild(o) { s.opcoes.push({ value: String(o.value), text: o.textContent }); if (s.selectedIndex < 0) s.selectedIndex = 0; },
    get value() { return s.selectedIndex >= 0 ? s.opcoes[s.selectedIndex].value : ''; },
    set value(v) { s.selectedIndex = s.opcoes.findIndex((o) => o.value === String(v)); },
    get mostrado() { return s.selectedIndex >= 0 ? s.opcoes[s.selectedIndex].text : '(vazio)'; },
  };
  return s;
}

// ── F2: a categoria SALVA sem pedido pendente ───────────────────────────────
// O seletor listava só as categorias VISTAS na fila (`seenCategories`). Com a
// categoria salva sem nenhum pedido dela hoje, a fila vinha vazia (a busca
// aplica o filtro), o seletor aparecia VAZIO, e qualquer "Aplicar" — pra trocar
// só a ordem, por exemplo — gravava "Todas" por cima, calado.
function montarCategoria({ salva, vistas }) {
  const sel = seletor();
  const deps = {
    document: { getElementById: (id) => (id === 'filterCategory' ? sel : null) },
    AppState: { filters: { categories: salva ? [salva] : [] }, seenCategories: vistas },
    escapeHtml: (x) => String(x), t: (k) => k, i18nLocale: () => 'pt-BR',
  };
  const chaves = Object.keys(deps);
  const popular = new Function(...chaves, fatiar('populateCategorySelect') + '\nreturn populateCategorySelect;')(...chaves.map((k) => deps[k]));
  popular();
  return sel;
}

test('F2: a categoria salva SEM pedido na fila aparece selecionada — e o "Aplicar" a mantém', () => {
  const sel = montarCategoria({ salva: 'PARKING_LOT', vistas: ['BAKERY', 'RESTAURANT'] });
  assert.equal(sel.value, 'PARKING_LOT',
    `o seletor mostra "${sel.mostrado}" com PARKING_LOT salvo: o próximo "Aplicar" grava "Todas" por cima`);
  // A ordem da lista continua alfabética — a salva entra no lugar dela.
  assert.deepEqual(sel.opcoes.map((o) => o.value), ['', 'BAKERY', 'PARKING_LOT', 'RESTAURANT']);
});

test('F2: CONTROLE — a categoria salva que está na fila não aparece duas vezes, e sem filtro fica "Todas"', () => {
  const sel = montarCategoria({ salva: 'BAKERY', vistas: ['BAKERY', 'RESTAURANT'] });
  assert.deepEqual(sel.opcoes.map((o) => o.value), ['', 'BAKERY', 'RESTAURANT']);
  assert.equal(sel.value, 'BAKERY');
  const todas = montarCategoria({ salva: null, vistas: ['BAKERY'] });
  assert.equal(todas.value, '');
  assert.equal(todas.mostrado, 'filters.category.all');
});
