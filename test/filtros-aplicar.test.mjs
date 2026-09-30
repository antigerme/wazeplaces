// A aba Filtros e o "📍 Perto de mim", rodada 4 da auditoria (2026-09-29): o
// que o modal MOSTRA tem que ser o que o "Aplicar" GRAVA (continuação do
// test/filtros-modal.test.mjs). Em cada caso daqui o "Aplicar" gravava outra
// coisa, calado: a ordem com o GPS ainda respondendo, a área e a ordem salvas
// com os Filtros abertos antes do perfil, o estado com os países chegando, a
// área e o estado de OUTRO país, a lista de países de outra região. Cada teste
// foi visto REPROVANDO com o conserto desfeito.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js, sobre um DOM de
// mentira cujo <select> se comporta como o do navegador no que importa aqui
// (opção inexistente deixa o seletor VAZIO; tirar a opção escolhida volta pra
// primeira). O que o teste não fornece vira um "buraco negro" que aceita
// qualquer chamada e a anota (o padrão do test/costura-sessao).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const APP = ler('js/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP_SEM = semComentario(APP);

function fatiar(nome, fonte = APP_SEM) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    if (fonte[j] === '{') prof++;
    else if (fonte[j] === '}' && --prof === 0) {
      const corpo = fonte.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

function buracoNegro(nome, chamou) {
  const f = function () {};
  return new Proxy(f, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then' || typeof k !== 'string') return undefined;
      return buracoNegro(nome + '.' + k, chamou);
    },
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}
function montar(nomes, deps) {
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      return buracoNegro(k, chamou);
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map((n) => fatiar(n)).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}
const tique = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ── O DOM de mentira ────────────────────────────────────────────────────────
function classes(iniciais = []) {
  const c = new Set(iniciais);
  return {
    add: (...k) => k.forEach((x) => c.add(x)), remove: (...k) => k.forEach((x) => c.delete(x)),
    contains: (k) => c.has(k),
    toggle: (k, f) => { const on = f === undefined ? !c.has(k) : !!f; if (on) c.add(k); else c.delete(k); return on; },
    _set: c,
  };
}
function elemento(extra = {}) {
  const cl = classes(extra.classes || []);
  const el = { dataset: {}, disabled: false, checked: false, value: '', textContent: '', classList: cl, ...extra };
  Object.defineProperty(el, 'className', {
    set(v) { cl._set.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cl._set.add(x)); },
    get() { return [...cl._set].join(' '); },
  });
  return el;
}
function opcao(value = '', texto = '', i18n = null) {
  let v = String(value);
  const o = {
    // Como no navegador, o `value` de uma opção é sempre TEXTO (`opt.value = 2` vira "2").
    get value() { return v; }, set value(x) { v = String(x); },
    textContent: texto, i18n, _sel: null,
    remove() {
      const s = o._sel; if (!s) return;
      const i = s.opcoes.indexOf(o); if (i < 0) return;
      const eraEscolhida = s.selectedIndex === i;
      s.opcoes.splice(i, 1);
      // Como o navegador: tirar a opção ESCOLHIDA volta pra primeira.
      if (eraEscolhida) s.selectedIndex = s.opcoes.length ? 0 : -1;
      else if (s.selectedIndex > i) s.selectedIndex--;
    },
  };
  return o;
}
function seletor(html = '') {
  const s = {
    dataset: {}, disabled: false, opcoes: [], selectedIndex: -1, classList: classes(),
    set innerHTML(h) {
      s.opcoes = [...String(h).matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map((m) => {
        const i18n = /data-i18n="([^"]*)"/.exec(m[2]);
        const o = opcao(m[1], m[3], i18n ? i18n[1] : null);
        o._sel = s;
        return o;
      });
      s.selectedIndex = s.opcoes.length ? 0 : -1;
    },
    appendChild(o) { o._sel = s; s.opcoes.push(o); if (s.selectedIndex < 0) s.selectedIndex = 0; return o; },
    querySelector(q) {
      const m = /option\[value="([^"]*)"\]/.exec(q);
      return m ? (s.opcoes.find((o) => o.value === m[1]) || null) : null;
    },
    get options() { return s.opcoes; },
    get value() { return s.selectedIndex >= 0 ? s.opcoes[s.selectedIndex].value : ''; },
    // Opção inexistente: `selectedIndex` -1 e o seletor VAZIO.
    set value(v) { s.selectedIndex = s.opcoes.findIndex((o) => o.value === String(v)); },
    get mostrado() { return s.selectedIndex >= 0 ? s.opcoes[s.selectedIndex].textContent : '(vazio)'; },
  };
  if (html) s.innerHTML = html;
  return s;
}

// A página dos Filtros: os elementos do modal, o API e o AppState, com as
// funções da área rodando de verdade.
const FUNCOES = [
  'aplicarEsperaDosFiltros', 'aoMudarPaisNaTela', 'aoTrocarRegiaoNoModal', 'populateCountrySelect',
  'loadStatesIntoSelect', 'populateManagedAreaSelect', 'populateCategorySelect', 'popularPaisEstado',
  'applyFiltersFromModal', 'assinaturaDeBusca', 'ordemDoWaze', 'esquecerPosicaoDoModal', 'pedirPosicao',
  'motivoDaFalhaDoGps', 'atualizarDicaDeOrdem', 'ordemValida', 'ordemSalvaEsperaOPerfil', 'popularOrdenacoes',
  'aoTrocarOrdenacao', 'redesenharFiltrosComOPerfil', 'referenciaDaOrdem',
];
function pagina({ regiao = 'row', pais = 30, filtros = {}, perfil = null, referencias = null, posicaoGps = null,
  paises = [{ id: 30, name: 'Brazil' }, { id: 73, name: 'France' }], estados = {}, geo = null } = {}) {
  const els = {
    filtersModal: elemento({ classes: ['hidden'] }),
    applyFilters: elemento(),
    filterRegion: elemento({ value: regiao }),
    filterCountry: seletor(), filterState: seletor('<option value="" data-i18n="filters.state.all">Todos os estados</option>'),
    filterManagedArea: seletor('<option value="" data-i18n="filters.managedArea.none">Nenhuma</option>'),
    filterCategory: seletor(), filterMyArea: elemento(), filterUnreadOnly: elemento({ checked: true }),
    filterResidential: elemento(), filterCountryHint: elemento({ classes: ['hidden'] }),
    filterSort: seletor('<option value="newest" data-i18n="filters.sort.newest">Mais recentes</option>'
      + '<option value="oldest" data-i18n="filters.sort.oldest">Mais antigos</option>'),
    filterSortHint: elemento({ classes: ['hidden'] }),
  };
  const tipos = [{ value: 'NEW_PLACE' }, { value: 'NEW_PHOTO' }];
  const log = { salvos: [], fechou: 0, toasts: [], dfato: [], buscas: 0, listCountries: [], listStates: [] };
  const listas = { paises: null, estados: null };   // respostas SEGURAS (promessas que o teste solta)
  const estado = { regiao, pais };
  const API = {
    getRegion: () => estado.regiao, setRegion: (r) => { estado.regiao = r; },
    getCountry: () => estado.pais, setCountry: (p) => { estado.pais = parseInt(p, 10) || 30; },
    listCountries: (r) => {
      log.listCountries.push(r || estado.regiao);
      if (listas.paises) return listas.paises(r || estado.regiao);
      return Promise.resolve({ success: true, countries: paises });
    },
    listStates: (c) => {
      log.listStates.push(c);
      if (listas.estados) return listas.estados(c);
      const lista = estados[c];
      return Promise.resolve(lista ? { success: true, states: lista } : { success: false, errorCategory: 'transient' });
    },
  };
  const AppState = {
    profile: perfil, countries: [], statesByCountry: {}, queue: [{ id: 1 }], seenCategories: [],
    filters: { types: ['NEW_PLACE', 'NEW_PHOTO'], residential: '', stateId: '', managedAreaId: '', myArea: false,
      unreadOnly: true, categories: [], sortOrder: 'newest', ...filtros },
  };
  const deps = {
    document: {
      getElementById: (id) => els[id] || null,
      createElement: () => opcao(),
      querySelectorAll: (q) => (q === '.filter-type:checked' ? tipos : []),
    },
    navigator: { geolocation: geo },
    AppState, API, els, log, listas,
    esperaDosFiltros: { regiao: false, gps: false },
    posicaoGps, posicaoDoModal: null, pedidoDePosicao: 0, referenciasDoPerfil: referencias,
    estadoDaDicaDeOrdem: null, cargaDeEstados: 0,
    ORDEM_PADRAO: constante('ORDEM_PADRAO'), ORDENS_POR_DISTANCIA: constante('ORDENS_POR_DISTANCIA'),
    GPS_TIMEOUT_MS: 10, TYPES_PADRAO: ['NEW_PLACE'],
    t: (k, v) => k + (v && v.padrao ? `(${v.padrao})` : ''), escapeHtml: (x) => String(x),
    ordenarPorNome: (l) => l, i18nLocale: () => 'pt-BR',
    rotuloDaOrdem: (o) => 'rotulo:' + o,
    showToast: (m, tipo) => log.toasts.push(tipo + ':' + m),
    dfato: (k, d) => log.dfato.push(d ? `${k}:${JSON.stringify(d)}` : k),
    saveFilters: () => log.salvos.push(JSON.parse(JSON.stringify(AppState.filters))),
    closeModal: () => { log.fechou++; els.filtersModal.classList.add('hidden'); },
    resetQueue: () => { log.buscas++; }, startFetching: () => {}, reordenarFilaNaTela: () => {},
    enforceDevGatedFilters: () => {},
  };
  const app = montar(FUNCOES, deps);
  // A abertura dos Filtros, na ORDEM do `openFiltersModal` (a parte que é
  // desta área), com o modal aparecendo antes da rede.
  const abrir = async () => {
    els.filterRegion.value = API.getRegion();
    deps.esperaDosFiltros.regiao = false;
    app.esquecerPosicaoDoModal();
    app.aplicarEsperaDosFiltros();
    app.populateManagedAreaSelect();
    app.populateCategorySelect();
    app.popularOrdenacoes();
    els.filterSort.value = app.ordemValida(AppState.filters.sortOrder);
    const v = els.filterSort.value;
    app.atualizarDicaDeOrdem(v === 'casa' || v === 'trabalho' ? 'perfil' : (v === 'gps' ? 'ok' : null));
    els.filtersModal.classList.remove('hidden');
    await app.popularPaisEstado();
  };
  return { app, els, log, deps, AppState, API, estado, listas, abrir };
}

// Uma geolocalização de mentira: o teste solta a resposta quando quer.
function geoControlada() {
  const pendentes = [];
  return {
    pendentes,
    getCurrentPosition(ok, falha) { pendentes.push({ ok, falha }); },
    responder(pos) { pendentes.shift().ok({ coords: { latitude: pos[0], longitude: pos[1], accuracy: 40 } }); },
    falhar(code) { pendentes.shift().falha({ code, message: 'x' }); },
  };
}

// Confere que o texto do app.js chama a função — fatiado, SEM comentários.
function chama(funcao, alvo) {
  return new RegExp('^\\s+' + alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm').test(fatiar(funcao));
}

// ═══ F1 · o "Aplicar" ESPERA a posição ═════════════════════════════════════
test('F1: com o GPS ainda respondendo, o "Aplicar" espera — e volta quando a posição chega', async () => {
  const geo = geoControlada();
  const p = pagina({ geo });
  await p.abrir();
  p.els.filterSort.value = 'gps';
  const troca = p.app.aoTrocarOrdenacao();
  await tique();
  assert.equal(p.els.applyFilters.disabled, true,
    'o "Aplicar" segue vivo com o GPS respondendo: tocado agora, grava "Mais recentes" calado');
  // O cinto: mesmo chamado por fora do botão, nada é gravado nesse meio.
  p.app.applyFiltersFromModal();
  assert.equal(p.log.salvos.length, 0, 'o "Aplicar" gravou com a posição ainda no ar');
  geo.responder([-23.55, -46.63]);
  await troca;
  assert.equal(p.els.applyFilters.disabled, false, 'a posição chegou e o "Aplicar" ficou morto');
  p.app.applyFiltersFromModal();
  assert.equal(p.log.salvos.at(-1).sortOrder, 'gps');
  assert.deepEqual(p.deps.posicaoGps.ll, [-23.55, -46.63]);
});

test('F1: a posição que FALHA também devolve o "Aplicar" (e a ordem volta pro padrão)', async () => {
  const geo = geoControlada();
  const p = pagina({ geo });
  await p.abrir();
  p.els.filterSort.value = 'gps';
  const troca = p.app.aoTrocarOrdenacao();
  await tique();
  geo.falhar(1);
  await troca;
  assert.equal(p.els.applyFilters.disabled, false, 'a posição falhou e o "Aplicar" ficou morto');
  assert.equal(p.els.filterSort.value, 'newest');
});

test('F1: a posição que vale é a do MOMENTO da escolha — nunca a de antes', async () => {
  // A ordem "Perto de mim" já aplicada, com a posição do Rio. A pessoa escolhe
  // de novo em São Paulo e toca "Aplicar" ANTES de a posição nova chegar.
  const geo = geoControlada();
  const rio = { ll: [-22.9, -43.2], precisaoM: 50 };
  const p = pagina({ geo, posicaoGps: rio, filtros: { sortOrder: 'gps' } });
  await p.abrir();
  p.els.filterSort.value = 'newest';
  await p.app.aoTrocarOrdenacao();
  p.els.filterSort.value = 'gps';
  const troca = p.app.aoTrocarOrdenacao();
  await tique();
  p.app.applyFiltersFromModal();
  assert.equal(p.log.salvos.length, 0, 'o "Aplicar" ordenou pela posição do Rio com a de São Paulo a caminho');
  geo.responder([-23.55, -46.63]);
  await troca;
  p.app.applyFiltersFromModal();
  assert.deepEqual(p.deps.posicaoGps.ll, [-23.55, -46.63], 'a fila ficou ordenada pela posição de antes');
});

test('F1: o botão tem UM escritor — o GPS que responde primeiro não o devolve com a região ainda carregando', async () => {
  const geo = geoControlada();
  const p = pagina({ geo });
  await p.abrir();
  let soltar;
  p.listas.paises = () => new Promise((ok) => { soltar = ok; });
  p.els.filterRegion.value = 'na';
  const regiao = p.app.aoTrocarRegiaoNoModal({ target: p.els.filterRegion });
  p.els.filterSort.value = 'gps';
  const troca = p.app.aoTrocarOrdenacao();
  await tique();
  geo.responder([-23.55, -46.63]);
  await troca;
  assert.equal(p.els.applyFilters.disabled, true,
    'a posição chegou e devolveu o "Aplicar" com os países da região nova ainda carregando');
  soltar({ success: true, countries: [{ id: 235, name: 'United States' }] });
  await regiao;
  assert.equal(p.els.applyFilters.disabled, false, 'CONTROLE: com as duas esperas terminadas o botão volta');
});

test('F1: trocar de ordem no meio abandona o pedido — a resposta dele não escreve nada', async () => {
  const geo = geoControlada();
  const p = pagina({ geo });
  await p.abrir();
  p.els.filterSort.value = 'gps';
  const troca = p.app.aoTrocarOrdenacao();
  await tique();
  p.els.filterSort.value = 'oldest';
  await p.app.aoTrocarOrdenacao();
  assert.equal(p.els.applyFilters.disabled, false, 'trocou pra "Mais antigos" e o "Aplicar" seguiu esperando o GPS');
  geo.responder([-23.55, -46.63]);
  await troca;
  assert.equal(p.deps.posicaoDoModal, null, 'a resposta de um pedido abandonado virou a posição do modal');
  assert.equal(p.els.filterSort.value, 'oldest');
});

test('F1: voltando pro "Perto de mim", a resposta do pedido ANTERIOR não solta o "Aplicar" nem vira a posição', async () => {
  // O caso em que só o NÚMERO do pedido separa as duas respostas: o seletor
  // está de novo em "Perto de mim", e a resposta que chega primeiro é a velha.
  const geo = geoControlada();
  const p = pagina({ geo });
  await p.abrir();
  p.els.filterSort.value = 'gps';
  const velho = p.app.aoTrocarOrdenacao();
  await tique();
  p.els.filterSort.value = 'newest';
  await p.app.aoTrocarOrdenacao();
  p.els.filterSort.value = 'gps';
  const novo = p.app.aoTrocarOrdenacao();
  await tique();
  assert.equal(geo.pendentes.length, 2, 'o instrumento não segurou os dois pedidos');
  geo.responder([-22.9, -43.2]);   // a do pedido VELHO (o Rio, horas atrás)
  await velho;
  assert.equal(p.els.applyFilters.disabled, true,
    'a resposta do pedido velho soltou o "Aplicar" com o pedido novo ainda no ar');
  assert.equal(p.deps.posicaoDoModal, null, 'a resposta do pedido velho virou a posição do modal');
  geo.responder([-23.55, -46.63]);
  await novo;
  assert.equal(p.els.applyFilters.disabled, false);
  assert.deepEqual(p.deps.posicaoDoModal.ll, [-23.55, -46.63], 'CONTROLE: a resposta do pedido novo vale');
});

test('F1: reabrir os Filtros devolve o "Aplicar" e abandona o pedido que ficou no ar', async () => {
  const geo = geoControlada();
  const p = pagina({ geo });
  await p.abrir();
  p.els.filterSort.value = 'gps';
  const troca = p.app.aoTrocarOrdenacao();
  await tique();
  p.deps.esperaDosFiltros.regiao = true;   // e uma troca de região também no ar
  await p.abrir();
  assert.equal(p.els.applyFilters.disabled, false, 'a espera da abertura anterior segurou o "Aplicar" nesta');
  geo.responder([-23.55, -46.63]);
  await troca;
  assert.equal(p.deps.posicaoDoModal, null, 'a posição da abertura anterior valeu nesta');
  // E a abertura de VERDADE faz isso: fatiada, sem comentários.
  const abre = fatiar('openFiltersModal');
  assert.match(abre, /^\s+esperaDosFiltros\.regiao = false;\s*\n\s*esquecerPosicaoDoModal\(\);\s*\n\s*aplicarEsperaDosFiltros\(\);/m,
    'a abertura dos Filtros deixou de zerar as esperas do "Aplicar"');
});

test('F1: ninguém mais escreve o `disabled` do "Aplicar" — só o escritor único', () => {
  // Gotcha #63: dois escritores no mesmo atributo, e o primeiro que termina
  // devolve o botão com o outro ainda no ar. Rastreia a VARIÁVEL (o `const
  // aplicar = $('applyFilters')` de antes escapava de um guard por instrução).
  // Só as funções que CITAM o botão: a declaração mais próxima antes de cada citação.
  const decls = [...APP_SEM.matchAll(/^(?:async )?function (\w+)\(/gm)];
  const nomes = new Set();
  for (const c of APP_SEM.matchAll(/['"]applyFilters['"]/g)) {
    const antes = decls.filter((d) => d.index < c.index).at(-1);
    if (antes) nomes.add(antes[1]);
  }
  assert.ok(nomes.has('aplicarEsperaDosFiltros'), 'o instrumento não achou nem o escritor único');
  const escritores = [];
  for (const nome of nomes) {
    const corpo = fatiar(nome);
    const vars = [...corpo.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:\$|document\.getElementById)\(\s*['"]applyFilters['"]\s*\)/g)].map((m) => m[1]);
    const alvos = ["(?:\\$|document\\.getElementById)\\(\\s*['\"]applyFilters['\"]\\s*\\)", ...vars];
    if (alvos.some((a) => new RegExp(`${a}\\.disabled\\s*=(?!=)`).test(corpo))) escritores.push(nome);
  }
  assert.deepEqual(escritores, ['aplicarEsperaDosFiltros'],
    `o "disabled" do "Aplicar" tem outro escritor: ${escritores.join(', ')} — a espera entra em \`esperaDosFiltros\``);
});

// ═══ F4 · negado não é "sem posição" ═══════════════════════════════════════
test('F4: o código do erro decide o motivo — só o 1 é permissão', async () => {
  const p = pagina();
  assert.equal(p.app.motivoDaFalhaDoGps({ code: 1 }), 'negado');
  assert.equal(p.app.motivoDaFalhaDoGps({ code: 2 }), 'indisponivel');
  assert.equal(p.app.motivoDaFalhaDoGps({ code: 3 }), 'tempo');
  assert.equal(p.app.motivoDaFalhaDoGps(null), 'indisponivel');
  // E a porta única do pedido o devolve (a API de verdade chama `falha(err)`).
  for (const [code, motivo] of [[1, 'negado'], [2, 'indisponivel'], [3, 'tempo']]) {
    const geo = geoControlada();
    const q = pagina({ geo });
    const pedido = q.app.pedirPosicao();
    geo.falhar(code);
    assert.deepEqual(await pedido, { falha: motivo });
  }
});

test('F4: sem posição COM a permissão concedida, a dica NÃO manda liberar a permissão — e o diário distingue', async () => {
  for (const [code, dica, fato] of [
    [1, 'filters.sort.hint.negado', 'gps.negado'],
    [2, 'filters.sort.hint.semPosicao', 'gps.semPosicao:{"motivo":"indisponivel"}'],
    [3, 'filters.sort.hint.semPosicao', 'gps.semPosicao:{"motivo":"tempo"}'],
  ]) {
    const geo = geoControlada();
    const p = pagina({ geo });
    await p.abrir();
    p.els.filterSort.value = 'gps';
    const troca = p.app.aoTrocarOrdenacao();
    await tique();
    geo.falhar(code);
    await troca;
    assert.equal(p.els.filterSortHint.textContent, dica + '(filters.sort.newest)',
      `código ${code}: a dica diz "${p.els.filterSortHint.textContent}"`);
    assert.ok(p.els.filterSortHint.classList.contains('text-amber-700'), `código ${code}: a dica não é de alerta`);
    assert.equal(p.log.dfato.at(-1), fato, `código ${code}: o diário não distingue o motivo`);
    assert.equal(p.els.filterSort.value, 'newest', `código ${code}: a ordem sem posição ficou em "Perto de mim"`);
  }
});

test('F4: a frase nova existe nos 4 idiomas, é outra que a do negado, e não fala de permissão', async () => {
  // O js/i18n.js é script clássico: roda num contexto à parte (como o test/i18n).
  const ctx = { navigator: { language: 'pt' }, document: { documentElement: {} } };
  vm.createContext(ctx);
  vm.runInContext(ler('js/i18n.js'), ctx);
  const dict = ctx.I18N_DICT;
  const permissao = { pt: /permiss/i, en: /permission/i, es: /permiso/i, fr: /autoris/i };
  for (const lang of ['pt', 'en', 'es', 'fr']) {
    const nova = dict[lang]['filters.sort.hint.semPosicao'];
    const negado = dict[lang]['filters.sort.hint.negado'];
    assert.ok(nova && nova.length > 30, `${lang}: falta a frase de "sem posição"`);
    assert.notEqual(nova, negado, `${lang}: a frase de "sem posição" é a do negado`);
    assert.match(nova, /\{padrao\}/, `${lang}: a frase não diz pra qual ordem voltou`);
    assert.doesNotMatch(nova, permissao[lang], `${lang}: a frase de "sem posição" manda mexer na permissão`);
    assert.match(negado, permissao[lang], `${lang}: CONTROLE — o instrumento não acha "permissão" nem no negado`);
  }
});

// ═══ F5 · a posição do modal só vale no "Aplicar" ══════════════════════════
test('F5: "Cancelar" depois de um "Perto de mim" que FALHOU mantém a ordem aplicada com a posição dela', async () => {
  const geo = geoControlada();
  const rio = { ll: [-22.9, -43.2], precisaoM: 50 };
  const p = pagina({ geo, posicaoGps: rio, filtros: { sortOrder: 'gps' } });
  await p.abrir();
  p.els.filterSort.value = 'newest';
  await p.app.aoTrocarOrdenacao();
  p.els.filterSort.value = 'gps';
  const troca = p.app.aoTrocarOrdenacao();
  await tique();
  geo.falhar(3);
  await troca;
  // "Cancelar": fecha sem o "Aplicar".
  p.els.filtersModal.classList.add('hidden');
  assert.equal(p.deps.posicaoGps, rio,
    'o pedido que falhou no modal apagou a posição da ordem JÁ aplicada: "Perto de mim" sem referência');
  assert.deepEqual(p.app.referenciaDaOrdem('gps'), rio.ll);
  assert.equal(p.AppState.filters.sortOrder, 'gps');
});

test('F5: "Cancelar" depois de um "Perto de mim" que DEU CERTO não troca a posição da fila — o "Aplicar" troca', async () => {
  const geo = geoControlada();
  const rio = { ll: [-22.9, -43.2], precisaoM: 50 };
  const p = pagina({ geo, posicaoGps: rio, filtros: { sortOrder: 'gps' } });
  await p.abrir();
  p.els.filterSort.value = 'newest';
  await p.app.aoTrocarOrdenacao();
  p.els.filterSort.value = 'gps';
  const troca = p.app.aoTrocarOrdenacao();
  await tique();
  geo.responder([-23.55, -46.63]);
  await troca;
  assert.equal(p.deps.posicaoGps, rio, 'a posição do modal virou a da fila antes do "Aplicar"');
  assert.equal(p.els.filterSortHint.textContent, 'filters.sort.hint.ok', 'CONTROLE: a dica confirmou a posição nova');
  p.app.applyFiltersFromModal();
  assert.deepEqual(p.deps.posicaoGps.ll, [-23.55, -46.63], 'o "Aplicar" não levou a posição pedida no modal');
});

// ═══ F2 · os Filtros abertos ANTES do perfil ════════════════════════════════
test('F2: sem o perfil, a ordem salva "Perto de casa" aparece — e o "Aplicar" a mantém', async () => {
  const p = pagina({ perfil: null, filtros: { sortOrder: 'casa' } });
  await p.abrir();
  assert.equal(p.els.filterSort.value, 'casa',
    `o seletor mostra "${p.els.filterSort.mostrado}" com "Perto de casa" salvo e o perfil a caminho`);
  assert.ok(!p.els.filterSort.querySelector('option[value="trabalho"]'),
    'sem o perfil, ofereceu "Perto do trabalho" — que ninguém salvou e talvez não exista');
  p.app.applyFiltersFromModal();
  assert.equal(p.log.salvos.at(-1).sortOrder, 'casa', 'o "Aplicar" trocou "Perto de casa" por "Mais recentes"');
});

test('F2: sem o perfil, a área salva aparece (dizendo que carrega) — e o "Aplicar" a mantém', async () => {
  const p = pagina({ perfil: null, filtros: { managedAreaId: '9001' } });
  await p.abrir();
  assert.equal(p.els.filterManagedArea.value, '9001',
    `o seletor mostra "${p.els.filterManagedArea.mostrado}" com a área 9001 salva: o "Aplicar" grava "nenhuma"`);
  const salva = p.els.filterManagedArea.querySelector('option[value="9001"]');
  assert.equal(salva.i18n, 'filters.carregando', 'a área sem nome não diz que o nome ainda vem');
  p.app.applyFiltersFromModal();
  assert.equal(p.log.salvos.at(-1).managedAreaId, '9001', 'o "Aplicar" apagou a área salva');
  // E a pessoa ainda pode escolher "Nenhuma".
  const q = pagina({ perfil: null, filtros: { managedAreaId: '9001' } });
  await q.abrir();
  q.els.filterManagedArea.value = '';
  q.app.applyFiltersFromModal();
  assert.equal(q.log.salvos.at(-1).managedAreaId, '', 'escolher "Nenhuma" sem o perfil não valeu');
});

test('F2: CONTROLE — com o perfil, casa e área que não existem nele caem (o comportamento de sempre)', async () => {
  const perfil = { id: 1, managedAreas: [{ id: 9002, name: 'Área Paris' }] };
  const p = pagina({ perfil, referencias: { casa: null, trabalho: null }, filtros: { sortOrder: 'casa', managedAreaId: '9001' } });
  await p.abrir();
  assert.equal(p.els.filterSort.value, 'newest', 'perfil sem casa e a ordem seguiu "Perto de casa"');
  assert.equal(p.els.filterManagedArea.value, '', 'a área que o perfil não tem seguiu escolhida');
  assert.equal(p.els.filterManagedArea.mostrado, 'filters.managedArea.none', 'a área que o perfil não tem deixou o seletor VAZIO');
  // E com o perfil que TEM as duas, elas aparecem com o nome.
  const q = pagina({ perfil: { id: 1, managedAreas: [{ id: 9001, name: 'Área SP' }] }, referencias: { casa: [-23.5, -46.6], trabalho: null },
    filtros: { sortOrder: 'casa', managedAreaId: '9001' } });
  await q.abrir();
  assert.equal(q.els.filterSort.value, 'casa');
  assert.equal(q.els.filterManagedArea.mostrado, 'Área SP');
});

test('F2: o perfil que chega com os Filtros ABERTOS os redesenha — mantendo o que a pessoa escolheu', async () => {
  const perfil = { id: 1, managedAreas: [{ id: 9001, name: 'Área SP' }] };
  // (a) Ninguém mexeu: a área ganha o nome, a ordem fica.
  const p = pagina({ perfil: null, filtros: { sortOrder: 'casa', managedAreaId: '9001' } });
  await p.abrir();
  p.AppState.profile = perfil;
  p.deps.referenciasDoPerfil = { casa: [-23.5, -46.6], trabalho: null };
  p.app.redesenharFiltrosComOPerfil();
  assert.equal(p.els.filterManagedArea.mostrado, 'Área SP', 'a área salva seguiu "Carregando…" com o perfil já aqui');
  assert.equal(p.els.filterSort.value, 'casa');
  p.app.applyFiltersFromModal();
  assert.deepEqual([p.log.salvos.at(-1).sortOrder, p.log.salvos.at(-1).managedAreaId], ['casa', '9001']);
  // (b) A pessoa escolheu "Nenhuma" enquanto o perfil vinha: fica "Nenhuma".
  const q = pagina({ perfil: null, filtros: { managedAreaId: '9001' } });
  await q.abrir();
  q.els.filterManagedArea.value = '';
  q.AppState.profile = perfil;
  q.app.redesenharFiltrosComOPerfil();
  assert.equal(q.els.filterManagedArea.value, '', 'o redesenho desfez o "Nenhuma" que a pessoa escolheu');
  // (c) O perfil chegou SEM casa: a ordem cai pro padrão e a dica sai.
  const r = pagina({ perfil: null, filtros: { sortOrder: 'casa' } });
  await r.abrir();
  r.AppState.profile = { id: 1, managedAreas: [] };
  r.deps.referenciasDoPerfil = { casa: null, trabalho: null };
  r.app.redesenharFiltrosComOPerfil();
  assert.equal(r.els.filterSort.value, 'newest', 'o perfil sem casa deixou "Perto de casa" escolhido');
  assert.ok(r.els.filterSortHint.classList.contains('hidden'), 'a dica de "vem do perfil" ficou sem a ordem dela');
  // (d) Com o modal FECHADO, nada é redesenhado.
  const s = pagina({ perfil: null, filtros: { managedAreaId: '9001' } });
  await s.abrir();
  s.els.filtersModal.classList.add('hidden');
  s.AppState.profile = perfil;
  s.app.redesenharFiltrosComOPerfil();
  assert.equal(s.els.filterManagedArea.mostrado, 'filters.carregando', 'redesenhou os Filtros FECHADOS');
});

test('F2: a porta única do perfil chama o redesenho', () => {
  assert.ok(chama('definirPerfil', 'redesenharFiltrosComOPerfil();'),
    'o `definirPerfil` não redesenha os Filtros abertos: pelo atalho do PWA eles abrem SEMPRE antes do perfil');
});

// ═══ F3 · o estado espera junto com os países ═══════════════════════════════
test('F3: com a lista de PAÍSES chegando, o estado diz que carrega — e o "Aplicar" não apaga o estado salvo', async () => {
  const p = pagina({ filtros: { stateId: '25' }, estados: { 30: [{ id: 25, name: 'São Paulo' }] } });
  let soltar;
  p.listas.paises = () => new Promise((ok) => { soltar = ok; });
  const abrindo = p.abrir();
  await tique();
  assert.equal(p.els.filterState.dataset.carregando, '1',
    `o estado mostra "${p.els.filterState.mostrado}" sem estar carregando: o "Aplicar" grava isso por cima do salvo`);
  assert.equal(p.els.filterState.mostrado, 'filters.carregando');
  p.app.applyFiltersFromModal();
  assert.equal(p.log.salvos.at(-1).stateId, '25', 'o "Aplicar" com os países chegando apagou o estado salvo');
  // CONTROLE: com os países na mão, o estado salvo aparece escolhido.
  const q = pagina({ filtros: { stateId: '25' }, estados: { 30: [{ id: 25, name: 'São Paulo' }] } });
  let soltarQ;
  q.listas.paises = () => new Promise((ok) => { soltarQ = ok; });
  const abrindoQ = q.abrir();
  await tique();
  soltarQ({ success: true, countries: [{ id: 30, name: 'Brazil' }] });
  await abrindoQ;
  assert.equal(q.els.filterState.value, '25');
  assert.equal(q.els.filterState.dataset.carregando, undefined);
  soltar({ success: true, countries: [{ id: 30, name: 'Brazil' }] });
  await abrindo;
});

// ═══ V3 · a lista da região ANTIGA chegando depois da troca ═════════════════
test('V3: a lista da região aplicada que chega DEPOIS da troca de região no modal não sobrescreve a nova', async () => {
  const LISTAS = { na: [{ id: 235, name: 'United States' }, { id: 40, name: 'Canada' }], row: [{ id: 30, name: 'Brazil' }, { id: 73, name: 'France' }] };
  for (const ordem of ['a nova chega antes', 'a aplicada chega antes']) {
    const p = pagina({ regiao: 'na', pais: 235 });
    const segurados = [];
    p.listas.paises = (r) => new Promise((ok) => segurados.push({ r, ok }));
    const abrindo = p.abrir();
    await tique();
    p.els.filterRegion.value = 'row';
    const troca = p.app.aoTrocarRegiaoNoModal({ target: p.els.filterRegion });
    await tique();
    assert.deepEqual(segurados.map((x) => x.r), ['na', 'row'], 'o instrumento não segurou as duas listas');
    const [aplicada, nova] = segurados;
    if (ordem === 'a nova chega antes') {
      nova.ok({ success: true, countries: LISTAS.row }); await troca;
      aplicada.ok({ success: true, countries: LISTAS.na }); await abrindo;
    } else {
      aplicada.ok({ success: true, countries: LISTAS.na }); await abrindo;
      nova.ok({ success: true, countries: LISTAS.row }); await troca;
    }
    const mostrados = p.els.filterCountry.opcoes.map((o) => o.value);
    assert.deepEqual(mostrados, ['30', '73'], `${ordem}: o seletor em ROW mostra os países ${mostrados} (da NA)`);
    assert.equal(p.els.applyFilters.disabled, false, `${ordem}: o "Aplicar" ficou morto`);
    p.app.applyFiltersFromModal();
    assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 30], `${ordem}: o "Aplicar" gravou ${p.estado.regiao}/${p.estado.pais}`);
  }
});

test('V3: a lista de uma região que deixou de ser a aplicada não vira a lista da região de agora', async () => {
  const p = pagina({ regiao: 'na', pais: 235 });
  let soltar;
  p.listas.paises = () => new Promise((ok) => { soltar = ok; });
  const abrindo = p.abrir();
  await tique();
  // Aplicada outra região enquanto a lista da NA vinha (o "Aplicar" zera o cache).
  p.estado.regiao = 'row';
  p.AppState.countries = [];
  p.els.filtersModal.classList.add('hidden');
  p.els.filterRegion.value = 'row';
  soltar({ success: true, countries: [{ id: 235, name: 'United States' }] });
  await abrindo;
  assert.deepEqual(p.AppState.countries, [], 'a lista da NA virou a lista de países da ROW');
});

// ═══ V10 · o estado de ANTES não vai pro país novo ══════════════════════════
test('V10: trocado o país com os estados do novo sem carregar, o "Aplicar" não leva o estado do velho', async () => {
  const p = pagina({ filtros: { stateId: '2' }, estados: { 30: [{ id: 2, name: 'Bahia' }] } });
  await p.abrir();
  assert.equal(p.els.filterState.value, '2', 'CONTROLE: o estado salvo aparece no país dele');
  p.els.filterCountry.value = '73';
  await p.app.loadStatesIntoSelect(73, 'row');   // o ouvinte do país (a França não carrega)
  assert.equal(p.els.filterState.dataset.carregando, '1', 'CONTROLE: os estados da França não carregaram');
  p.app.applyFiltersFromModal();
  assert.equal(p.estado.pais, 73);
  assert.equal(p.log.salvos.at(-1).stateId, '', 'a busca vai sair com a França e o estado 2 (a Bahia)');
  // CONTROLE: no MESMO país, a lista que não carrega segue guardando o estado salvo.
  const q = pagina({ filtros: { stateId: '2' } });
  await q.abrir();
  q.app.applyFiltersFromModal();
  assert.equal(q.log.salvos.at(-1).stateId, '2', 'a lista que não carregou apagou o estado salvo no mesmo país');
});

test('V10: trocada a REGIÃO com os estados sem carregar, o estado de antes também sai', async () => {
  const p = pagina({ filtros: { stateId: '2' }, estados: { 30: [{ id: 2, name: 'Bahia' }] } });
  await p.abrir();
  p.listas.paises = () => Promise.resolve({ success: true, countries: [{ id: 235, name: 'United States' }] });
  p.els.filterRegion.value = 'na';
  await p.app.aoTrocarRegiaoNoModal({ target: p.els.filterRegion });
  assert.equal(p.els.filterState.dataset.carregando, '1', 'CONTROLE: os estados dos EUA não carregaram');
  p.app.applyFiltersFromModal();
  assert.deepEqual([p.estado.regiao, p.estado.pais, p.log.salvos.at(-1).stateId], ['na', 235, ''],
    'a região nova saiu com o estado da antiga');
});

// ═══ F7 · a área gerenciada é do país ═══════════════════════════════════════
test('F7: trocar o país no modal volta a área pra "Nenhuma" — o que se vê é o que o "Aplicar" grava', async () => {
  const perfil = { id: 1, managedAreas: [{ id: 9001, name: 'Área SP' }, { id: 9002, name: 'Área Paris' }] };
  const p = pagina({ perfil, filtros: { managedAreaId: '9001' } });
  await p.abrir();
  assert.equal(p.els.filterManagedArea.value, '9001');
  // O ouvinte do seletor de país (anônimo no app.js): chama a mesma função.
  assert.ok(new RegExp("\\$\\('filterCountry'\\)\\.addEventListener\\('change', \\(e\\) => \\{\\s*\\n\\s*aoMudarPaisNaTela\\(\\);").test(APP_SEM),
    'o ouvinte do seletor de país não devolve a área pra "Nenhuma"');
  p.els.filterCountry.value = '73';
  p.app.aoMudarPaisNaTela();
  assert.equal(p.els.filterManagedArea.mostrado, 'filters.managedArea.none', 'trocou o país e a área de São Paulo seguiu na tela');
  p.app.applyFiltersFromModal();
  assert.deepEqual([p.estado.pais, p.log.salvos.at(-1).managedAreaId], [73, ''], 'a França saiu com a área de São Paulo');
});

test('F7: o "Aplicar" confere — a área que o seletor ainda mostra do país de antes não vai pro novo', async () => {
  const perfil = { id: 1, managedAreas: [{ id: 9001, name: 'Área SP' }, { id: 9002, name: 'Área Paris' }] };
  // O país trocado SEM o ouvinte (a lista que não tinha o país aplicado, por exemplo).
  const p = pagina({ perfil, filtros: { managedAreaId: '9001' } });
  await p.abrir();
  p.els.filterCountry.value = '73';
  p.app.applyFiltersFromModal();
  assert.equal(p.log.salvos.at(-1).managedAreaId, '', 'a busca vai sair com a França e a área 9001');
  // A área escolhida DEPOIS de trocar o país, vai.
  const q = pagina({ perfil, filtros: { managedAreaId: '9001' } });
  await q.abrir();
  q.els.filterCountry.value = '73';
  q.els.filterManagedArea.value = '9002';
  q.app.applyFiltersFromModal();
  assert.equal(q.log.salvos.at(-1).managedAreaId, '9002', 'a área que a pessoa escolheu pro país novo sumiu');
  // CONTROLE: sem trocar o país, a área fica.
  const r = pagina({ perfil, filtros: { managedAreaId: '9001' } });
  await r.abrir();
  r.app.applyFiltersFromModal();
  assert.equal(r.log.salvos.at(-1).managedAreaId, '9001');
});

test('F7: a troca de REGIÃO também devolve a área pra "Nenhuma"', async () => {
  const perfil = { id: 1, managedAreas: [{ id: 9001, name: 'Área SP' }] };
  const p = pagina({ perfil, filtros: { managedAreaId: '9001' } });
  await p.abrir();
  p.listas.paises = () => Promise.resolve({ success: true, countries: [{ id: 235, name: 'United States' }] });
  p.els.filterRegion.value = 'na';
  await p.app.aoTrocarRegiaoNoModal({ target: p.els.filterRegion });
  assert.equal(p.els.filterManagedArea.value, '', 'trocou a região e a área de São Paulo seguiu na tela');
});

// ═══ F6 · a troca de idioma alcança os textos da aba Filtros ════════════════
test('F6: as opções de TEXTO dos seletores levam o `data-i18n` — é por ele que a troca de idioma as alcança', async () => {
  const p = pagina({ perfil: null, filtros: { managedAreaId: '9001' } });
  let soltar;
  p.listas.paises = () => new Promise((ok) => { soltar = ok; });
  const abrindo = p.abrir();
  await tique();
  const chave = (sel, valor) => (sel.querySelector(`option[value="${valor}"]`) || {}).i18n;
  assert.equal(chave(p.els.filterCategory, ''), 'filters.category.all', '"Todas as categorias" sem data-i18n');
  assert.equal(chave(p.els.filterManagedArea, ''), 'filters.managedArea.none', '"Nenhuma" sem data-i18n');
  assert.equal(chave(p.els.filterManagedArea, '9001'), 'filters.carregando', 'a área que carrega sem data-i18n');
  assert.equal(chave(p.els.filterCountry, ''), 'filters.carregando', 'o país que carrega sem data-i18n');
  assert.equal(chave(p.els.filterState, ''), 'filters.carregando', 'o estado que carrega sem data-i18n');
  soltar({ success: true, countries: [{ id: 30, name: 'Brazil' }] });
  await abrindo;
  assert.equal(chave(p.els.filterState, ''), 'filters.state.naoCarregou', '"Não deu pra carregar" sem data-i18n');
  const q = pagina({ estados: { 30: [{ id: 1, name: 'Acre' }] } });
  await q.abrir();
  assert.equal(chave(q.els.filterState, ''), 'filters.state.all', '"Todos os estados" sem data-i18n');
  // Reaberto, com os estados já em cache: o "Todos" é o de antes da carga.
  await q.abrir();
  assert.equal(q.log.listStates.length, 1, 'CONTROLE: a 2ª abertura foi à rede — não é o caminho do cache');
  assert.equal(chave(q.els.filterState, ''), 'filters.state.all', '"Todos os estados" (estados em cache) sem data-i18n');
  // A troca de região também escreve o "Carregando…".
  q.listas.paises = () => new Promise(() => {});
  q.els.filterRegion.value = 'na';
  q.app.aoTrocarRegiaoNoModal({ target: q.els.filterRegion });
  assert.equal(chave(q.els.filterCountry, ''), 'filters.carregando', 'o "Carregando…" da troca de região sem data-i18n');
});

test('F6: a troca de idioma redesenha a dica da ordem no idioma novo, no estado em que ela está', () => {
  // `aplicarIdioma` e `atualizarDicaDeOrdem` DE VERDADE, com um `t` que muda
  // de idioma quando o `setLang` é chamado.
  let lang = 'pt';
  const hint = elemento({ classes: ['hidden'] });
  const deps = {
    setLang: (l) => { lang = l; }, t: (k, v) => `${lang}:${k}` + (v && v.padrao ? `(${v.padrao})` : ''),
    document: { getElementById: (id) => (id === 'filterSortHint' ? hint : null) },
    SELETORES_IDIOMA: [], AppState: { profile: null, currentPlace: null, authenticated: false },
    posicaoDoModal: null, posicaoGps: null, ORDEM_PADRAO: 'newest', estadoDaDicaDeOrdem: null,
    popularOrdenacoes: () => {}, applyI18n: () => {}, safeLS: { set() {} }, showToast: () => {},
  };
  const app = montar(['aplicarIdioma', 'atualizarDicaDeOrdem'], deps);
  app.atualizarDicaDeOrdem('semPosicao');
  assert.equal(hint.textContent, 'pt:filters.sort.hint.semPosicao(pt:filters.sort.newest)');
  app.aplicarIdioma('en');
  assert.equal(hint.textContent, 'en:filters.sort.hint.semPosicao(en:filters.sort.newest)',
    'trocou pra inglês e a dica da ordem ficou em português');
  // Sem dica, a troca não inventa uma.
  app.atualizarDicaDeOrdem(null);
  app.aplicarIdioma('fr');
  assert.ok(hint.classList.contains('hidden'), 'a troca de idioma acendeu uma dica que não estava na tela');
});
