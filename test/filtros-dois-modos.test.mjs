// O diálogo dos Filtros em DOIS modos (v2026.10.24): o funil abre os FILTROS (um
// formulário, sem abas, com Cancelar · Aplicar), e o crachá do perfil abre o
// HISTÓRICO e as PREFERÊNCIAS (duas abas que aplicam na hora: Fechar).
//
// Eram três abas numa janela só, com dois jeitos de confirmar, e um furava o
// outro (MEDIDO em 2026-10-24, no app de pé): o filtro mudado e não aplicado
// sumia, calado, no "Fechar" das outras abas, e a preferência mudada seguia
// mudada no "Cancelar" dos Filtros.
//
// Cada teste foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const HTML_SEM = HTML.replace(/<!--[\s\S]*?-->/g, '');

function fechar(txt, i) {
  let prof = 0;
  for (let j = txt.indexOf('{', i); j < txt.length; j++) {
    if (txt[j] === '{') prof++;
    else if (txt[j] === '}') { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = ', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  return APP_SEM.slice(m.index, APP_SEM.indexOf(';\n', m.index) + 1);
}
function montar(nomes, deps, devolve, preludio = '') {
  const chaves = Object.keys(deps);
  return new Function(...chaves, preludio + '\n' + nomes.map(fatiar).join('\n') + `\nreturn { ${devolve.join(', ')} };`)(...chaves.map((k) => deps[k]));
}
const classes = (...iniciais) => {
  const s = new Set(iniciais);
  return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
    toggle: (c, f) => { const ter = f === undefined ? !s.has(c) : !!f; if (ter) s.add(c); else s.delete(c); return ter; } };
};

// ── O modo decide o título, a faixa das abas e o rodapé ─────────────────────
function dialogo() {
  const els = new Map();
  const el = (id, ...iniciais) => {
    if (!els.has(id)) {
      const attrs = {};
      els.set(id, { id, classList: classes(...iniciais), textContent: '', tabIndex: 0, scrollTop: 0, parentElement: { scrollTop: 0, parentElement: { scrollTop: 0 } },
        setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null } });
    }
    return els.get(id);
  };
  // O HTML: os Filtros à vista, as duas abas do perfil escondidas, e a faixa delas também.
  el('filtersPanelFilters'); el('filtersPanelHistory', 'hidden'); el('filtersPanelPrefs', 'hidden');
  el('filtersTabsBar', 'hidden'); el('closeFiltersFooter', 'hidden');
  const desenhos = [];
  const deps = {
    document: { getElementById: (id) => el(id) },
    t: (k) => `«${k}»`,
    renderHistory: () => desenhos.push('historico'), marcarConquistasVistas() {}, renderUndoGateUI: () => desenhos.push('cota'),
  };
  const fonte = [constante('ABA_DOS_FILTROS'), constante('FILTER_TABS')].join('\n');
  const h = montar(['switchFilterTab'], deps, ['switchFilterTab', 'ABA_DOS_FILTROS', 'FILTER_TABS'], fonte);
  const visivel = (id) => !el(id).classList.contains('hidden');
  return { h, el, visivel, desenhos };
}

test('modo Filtros: só o formulário, sem a faixa das abas, com Cancelar · Aplicar e o título "Filtros"', () => {
  const d = dialogo();
  d.h.switchFilterTab('filtersTabHistory');   // vinha do perfil
  d.h.switchFilterTab(d.h.ABA_DOS_FILTROS);
  assert.equal(d.visivel('filtersPanelFilters'), true);
  assert.equal(d.visivel('filtersPanelHistory') || d.visivel('filtersPanelPrefs'), false, 'uma aba do perfil ficou à vista nos Filtros');
  assert.equal(d.visivel('filtersTabsBar'), false, 'a faixa das abas apareceu nos Filtros — dá pra sair do formulário com um filtro pendente');
  assert.equal(d.visivel('cancelFilters') && d.visivel('applyFilters'), true, 'os Filtros sem Cancelar · Aplicar');
  assert.equal(d.visivel('closeFiltersFooter'), false, 'o "Fechar" voltou aos Filtros — é ele que jogava fora o filtro pendente');
  assert.equal(d.el('filtersModalTitle').getAttribute('data-i18n'), 'filters.section.filters');
  assert.equal(d.el('filtersModalTitle').textContent, '«filters.section.filters»');
});

test('modo do perfil: Histórico e Preferências em abas, só com Fechar, e o título que diz isso', () => {
  for (const aba of ['filtersTabHistory', 'filtersTabPrefs']) {
    const d = dialogo();
    d.h.switchFilterTab(aba);
    assert.equal(d.visivel('filtersPanelFilters'), false, `${aba}: o formulário dos Filtros ficou à vista`);
    assert.equal(d.visivel('filtersTabsBar'), true, `${aba}: a faixa das abas não apareceu`);
    assert.equal(d.visivel('cancelFilters') || d.visivel('applyFilters'), false,
      `${aba}: Cancelar/Aplicar no perfil — o "Cancelar" não desfaz uma preferência, que vale na hora`);
    assert.equal(d.visivel('closeFiltersFooter'), true);
    assert.equal(d.el('filtersModalTitle').getAttribute('data-i18n'), 'modal.perfil.title', `${aba}: o título seguiu "Filtros"`);
    assert.equal(d.el(aba).getAttribute('aria-selected'), 'true');
  }
  // As abas do perfil são DUAS, e os Filtros não estão entre elas: nenhuma seta, Home ou End
  // leva do perfil ao formulário (e vice-versa).
  const d = dialogo();
  assert.deepEqual(d.h.FILTER_TABS.map((x) => x.tab), ['filtersTabHistory', 'filtersTabPrefs']);
  assert.ok(!d.h.FILTER_TABS.some((x) => x.tab === d.h.ABA_DOS_FILTROS), 'os Filtros voltaram a ser uma aba');
});

test('o HTML: a faixa das abas nasce escondida, com Histórico e Preferências, e não há botão de aba dos Filtros', () => {
  const faixa = /<div id="filtersTabsBar" class="([^"]*)">([\s\S]*?)<\/div>\s*<\/div>/.exec(HTML_SEM);
  assert.ok(faixa, 'a faixa das abas (#filtersTabsBar) sumiu');
  assert.ok(faixa[1].split(/\s+/).includes('hidden'), 'a faixa das abas nasce à vista: o funil abriria os Filtros com abas por um quadro');
  const abas = [...faixa[2].matchAll(/role="tab" id="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(abas, ['filtersTabHistory', 'filtersTabPrefs']);
  assert.ok(!/id="filtersTabFilters"/.test(HTML_SEM), 'voltou um botão de aba dos Filtros');
  // O painel dos Filtros não é mais um tabpanel (não há aba que o rotule).
  assert.ok(!/id="filtersPanelFilters"[^>]*role="tabpanel"/.test(HTML_SEM), 'o formulário dos Filtros seguiu como tabpanel, sem aba');
});

// ── A legenda do Histórico mora junto dos números ───────────────────────────
function painelDoHistorico({ vazio = false } = {}) {
  const el = { innerHTML: '', dataset: { conqLigado: '1' }, filhos: [], appendChild(f) { this.filhos.push(f); },
    insertAdjacentHTML(_, html) { this.innerHTML += html; } };
  const v = vazio ? { read: 0, rejected: 0 } : { read: 12, rejected: 3 };
  const deps = {
    document: { getElementById: (id) => (id === 'historyBody' ? el : null), createElement: () => ({ addEventListener() {} }) },
    chaveDoFoco: () => null, devolverFocoAoPainel() {}, renderAutores() {}, ligarConquistas() {},
    getHistoryStats: () => ({ today: v, week: v, month: v, total: v }),
    htmlPatente: () => '<div class="conq-card">PATENTE</div>', htmlConquistas: () => '<div>CONQUISTAS</div>',
    t: (k) => `«${k}»`, escapeHtml: (s) => String(s), fraseDosLidosERejeitados: () => 'FRASE',
    loadHistory: () => ({}), dadosDoResumo: () => ({ total: 0 }), aparelhoCompartilhaArquivo: () => false, i18nLocale: () => 'pt-BR',
  };
  montar(['renderHistory'], deps, ['renderHistory']).renderHistory();
  return el.innerHTML;
}

test('a legenda "Lidos · Rejeitados" vem logo ACIMA das linhas — depois do cartão da patente, não antes', () => {
  const html = painelDoHistorico();
  const iPatente = html.indexOf('PATENTE');
  const iLegenda = html.indexOf('«stats.read»');
  const iLinha = html.indexOf('«stats.history.today»');
  assert.ok(iPatente >= 0 && iLegenda > 0 && iLinha > 0, 'PRÉ-CONDIÇÃO: o painel não desenhou patente, legenda e linhas');
  assert.ok(iLegenda > iPatente, 'a legenda voltou a ficar acima do cartão da patente, longe dos números');
  assert.ok(iLegenda < iLinha, 'a legenda saiu de cima das linhas');
  assert.ok(html.indexOf('«stats.rejected»') > iLegenda && html.indexOf('«stats.rejected»') < iLinha);
  // Quem não enxerga já ouve a frase de cada linha ("12 lidos, 3 rejeitados"): a legenda é só visual.
  assert.match(html.slice(html.lastIndexOf('<div', iLegenda), iLegenda), /aria-hidden="true"/, 'a legenda seria lida antes de cada frase completa');
  // Sem linhas, sem legenda.
  assert.ok(!painelDoHistorico({ vazio: true }).includes('«stats.read»'), 'o Histórico vazio mostrou a legenda de números que não existem');
  // E ela não está mais fixa no HTML, acima do painel.
  const caixa = HTML_SEM.slice(HTML_SEM.indexOf('id="filtersPanelHistory"'), HTML_SEM.indexOf('id="historyBody"'));
  assert.ok(!/data-i18n="stats\.read"/.test(caixa), 'a legenda fixa voltou ao HTML, acima da patente');
});
