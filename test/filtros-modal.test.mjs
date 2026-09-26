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

// ── F10 (a): trocar a REGIÃO e tocar "Aplicar" com os países carregando ─────
// O seletor de país dizia "Carregando…" e o "Aplicar" gravava a região NOVA com
// o país da ANTIGA — MEDIDO no navegador: `na/30` (o Brasil no servidor da
// América do Norte) e "Tudo limpo!".
function montarRegiao({ resposta }) {
  const el = {
    filterRegion: { value: 'row' }, filterCountry: seletor(), applyFilters: { disabled: false },
    filterMyArea: { checked: false }, filterState: seletor(),
  };
  const log = [];
  let soltar = null;
  const deps = {
    document: { getElementById: (id) => el[id] || null, createElement: () => ({}) },
    $: (id) => el[id] || null,
    AppState: { countries: [{ id: 30, name: 'Brazil' }], statesByCountry: {}, filters: { stateId: '', myArea: false } },
    API: { getRegion: () => 'row', getCountry: () => '30',
      listCountries: () => new Promise((ok) => { soltar = ok; }), listStates: async () => ({ success: true, states: [] }) },
    escapeHtml: (x) => String(x), t: (k) => k, showToast: (m, tipo) => log.push(tipo + ':' + m),
    ordenarPorNome: (l) => l, i18nLocale: () => 'pt-BR',
  };
  const chaves = Object.keys(deps);
  const nomes = ['aoTrocarRegiaoNoModal', 'populateCountrySelect', 'loadStatesIntoSelect'];
  const app = new Function(...chaves, 'let cargaDeEstados = 0;\n' + nomes.map(fatiar).join('\n')
    + '\nreturn { aoTrocarRegiaoNoModal };')(...chaves.map((k) => deps[k]));
  return { app, el, log, soltar: (r) => soltar(r) };
}
const umTique = () => new Promise((ok) => setTimeout(ok, 0));

test('F10a: com os países da região nova CARREGANDO, o "Aplicar" espera — e volta quando a lista chega', async () => {
  const m = montarRegiao({});
  m.el.filterRegion.value = 'na';
  const troca = m.app.aoTrocarRegiaoNoModal({ target: m.el.filterRegion });
  await umTique();
  assert.equal(m.el.applyFilters.disabled, true,
    'o "Aplicar" segue vivo com os países carregando: grava a região nova com o país da antiga (na/30)');
  m.soltar({ success: true, countries: [{ id: 235, name: 'United States' }, { id: 40, name: 'Canada' }] });
  await troca;
  assert.equal(m.el.applyFilters.disabled, false, 'a lista chegou e o "Aplicar" ficou morto');
  assert.equal(m.el.filterCountry.value, '235');
});

test('F10a: a lista da região nova NÃO carrega — a troca não se completa: volta a região aplicada, com os países dela, e diz', async () => {
  const m = montarRegiao({});
  m.el.filterRegion.value = 'na';
  const troca = m.app.aoTrocarRegiaoNoModal({ target: m.el.filterRegion });
  await umTique();
  m.soltar({ success: false, errorCategory: 'transient' });
  await troca;
  assert.equal(m.el.filterRegion.value, 'row', 'o seletor diz NA sem país nenhum: o "Aplicar" gravaria NA com o Brasil');
  assert.equal(m.el.filterCountry.value, '30', 'os países da região aplicada não voltaram');
  assert.equal(m.el.applyFilters.disabled, false, 'o "Aplicar" ficou morto depois da falha');
  assert.ok(m.log.some((l) => l.startsWith('error:')), 'a troca de região desfeita calada');
});

test('F10a: reabrir os Filtros com a troca de região no ar devolve o "Aplicar"', () => {
  // Reabrir põe o seletor de região de volta na aplicada; a troca que estava no
  // ar vê isso e desiste (sem reabilitar nada) — quem devolve o botão é a abertura.
  assert.match(fatiar('openFiltersModal'), /^\s+\$\('applyFilters'\)\.disabled = false;/m,
    'a troca de região abandonada deixava o "Aplicar" morto na abertura seguinte');
});

// ── F10 (b): a lista de ESTADOS que não carrega ─────────────────────────────
// O seletor mostrava "Todos os estados" e o "Aplicar" gravava isso por cima do
// estado salvo, calado (sinal ruim ao abrir os Filtros).
function montarEstados({ stateId = '2', paisAplicado = '30', resposta }) {
  const sel = seletor();
  const deps = {
    document: { getElementById: () => sel, createElement: () => ({}) },
    AppState: { statesByCountry: {}, filters: { stateId } },
    API: { getCountry: () => paisAplicado, listStates: async (pais) => resposta(pais) },
    escapeHtml: (x) => String(x), t: (k) => k, ordenarPorNome: (l) => l,
  };
  const chaves = Object.keys(deps);
  const load = new Function(...chaves, 'let cargaDeEstados = 0;\n' + fatiar('loadStatesIntoSelect') + '\nreturn loadStatesIntoSelect;')(...chaves.map((k) => deps[k]));
  return { load, sel };
}

test('F10b: a lista de estados FALHA — o seletor não diz "Todos" e o "Aplicar" não apaga o estado salvo', async () => {
  const m = montarEstados({ resposta: () => ({ success: false, errorCategory: 'transient' }) });
  await m.load('30');
  assert.equal(m.sel.dataset.carregando, '1',
    'a falha soltou o seletor: o "Aplicar" grava o "Todos" dele por cima do estado salvo');
  assert.notEqual(m.sel.mostrado, 'filters.state.all', 'o seletor diz "Todos os estados" com um estado salvo valendo');
});

test('F10b: trocar de PAÍS no modal não pré-seleciona o estado salvo de outro país (o mesmo número existe nos dois)', async () => {
  const estados = { 30: [{ id: 2, name: 'Bahia' }, { id: 5, name: 'Acre' }], 73: [{ id: 2, name: 'Bretagne' }, { id: 3, name: 'Normandie' }] };
  const m = montarEstados({ resposta: (pais) => ({ success: true, states: estados[pais] }) });
  await m.load(73);
  assert.equal(m.sel.value, '', `a França abriu com "${m.sel.mostrado}" selecionado: o estado 2 salvo era a Bahia`);
  // CONTROLE: no país aplicado, o estado salvo segue selecionado.
  const c = montarEstados({ resposta: (pais) => ({ success: true, states: estados[pais] }) });
  await c.load('30');
  assert.equal(c.sel.value, '2');
  assert.equal(c.sel.dataset.carregando, undefined);
});
