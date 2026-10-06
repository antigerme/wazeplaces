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
  // O caminho do perfil (achados 10 e 11).
  'loadProfileAndAuxData', 'definirPerfil', 'completarPerfilChegado', 'paisDoPerfil', 'irProPaisDoPerfil',
  'redesenharLugarNosFiltros',
  // Os editáveis por servidor (R7-6-02), e a peneira com o perfil que chega (R7-6-01).
  'anotarEditaveis', 'editaveisLidos', 'peneirarPaisesComOPerfil',
  // A lista de países que a carga e os Filtros dividem (R8-6-04).
  'pedirListaDePaises',
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
  const log = { salvos: [], fechou: 0, toasts: [], dfato: [], buscas: 0, listCountries: [], listStates: [], getProfile: [] };
  const listas = { paises: null, estados: null, perfil: null };   // respostas SEGURAS (promessas que o teste solta)
  const estado = { regiao, pais };
  const API = {
    getRegion: () => estado.regiao, setRegion: (r) => { estado.regiao = r; },
    getCountry: () => estado.pais, setCountry: (p) => { estado.pais = parseInt(p, 10) || 30; },
    listCountries: (r) => {
      log.listCountries.push(r || estado.regiao);
      if (listas.paises) return listas.paises(r || estado.regiao);
      return Promise.resolve({ success: true, countries: paises });
    },
    getProfile: (r) => {
      log.getProfile.push(r || estado.regiao);
      if (listas.perfil) return listas.perfil(r || estado.regiao);
      return Promise.resolve({ success: true, profile: perfil || { id: 1, editableCountryIDs: [], managedAreas: [] } });
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
    estadoDaDicaDeOrdem: null, cargaDeEstados: 0, cargaDePaises: 0,
    epocaDaSessao: 0, filaEsperaPerfil: false, perfilPedidoEm: 0, lugarDoPedidoDoPerfil: null,
    editaveisPorServidor: { conta: null, lidos: {} },
    listasDePaisesNoAr: new Map(),
    REGIOES_DO_WAZE: ['row', 'na', 'il'],
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

// ═══ Achado 10 · o país do perfil não desfaz o lugar que a pessoa aplicou ═══
// Pelo atalho do PWA, os Filtros abrem com o perfil e os países da abertura
// ainda no ar. A pessoa aplica a NA e os EUA; quando a carga chega, o perfil é
// o do servidor da ROW (editáveis `[30]`) — e a levava pro Brasil DENTRO da
// NA: `na/30`, uma fila que não existe. MEDIDO no navegador antes do conserto
// (scratchpad/l8-filtros/irmao-v3.mjs), com o controle de a carga chegar antes.
const BR_FR = [{ id: 30, name: 'Brazil' }, { id: 73, name: 'France' }];
async function cargaSegura(p) {
  const soltar = {};
  p.listas.perfil = () => new Promise((ok) => { soltar.perfil = ok; });
  p.listas.paises = () => new Promise((ok) => { soltar.paises = ok; });
  const carga = p.app.loadProfileAndAuxData();
  await tique();
  return { carga, soltar };
}
// O que o "Aplicar" faz com o lugar (a região e o país gravados, o cache de
// países zerado), com o modal fechado.
function aplicarLugar(p, regiao, pais) {
  p.estado.regiao = regiao; p.estado.pais = pais;
  p.AppState.countries = []; p.AppState.statesByCountry = {};
  p.els.filtersModal.classList.add('hidden');
}

test('achado 10: a carga da abertura chegando DEPOIS de a pessoa aplicar outra região não a tira de lá', async () => {
  const p = pagina({ regiao: 'row', pais: 30 });
  const { carga, soltar } = await cargaSegura(p);
  aplicarLugar(p, 'na', 235);
  soltar.paises({ success: true, countries: BR_FR });
  soltar.perfil({ success: true, profile: { id: 1, editableCountryIDs: [30], managedAreas: [] } });
  await carga;
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['na', 235],
    `o perfil da ROW levou a pessoa pra ${p.estado.regiao}/${p.estado.pais} — o Brasil no servidor da NA`);
  assert.deepEqual(p.AppState.countries, [], 'a lista de países da ROW virou a lista da NA');
  assert.ok(!p.log.dfato.some((d) => d.startsWith('pais.doPerfil')), 'o país do perfil foi aplicado por cima da escolha');
});

test('achado 10: CONTROLE — sem troca no meio, o perfil ainda leva quem edita na França pra França', async () => {
  const p = pagina({ regiao: 'row', pais: 30 });
  const { carga, soltar } = await cargaSegura(p);
  soltar.paises({ success: true, countries: BR_FR });
  soltar.perfil({ success: true, profile: { id: 1, editableCountryIDs: [73], managedAreas: [] } });
  await carga;
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 73]);
  assert.deepEqual(p.AppState.countries, BR_FR, 'a lista da região que não mudou não entrou no cache');
});

test('achado 10: a pessoa aplica outro lugar enquanto o app pergunta aos OUTROS servidores — a escolha dela vale', async () => {
  // Lista vazia aqui = edita noutro servidor: o `paisDoPerfil` pergunta a NA.
  const p = pagina({ regiao: 'row', pais: 30 });
  const soltar = {};
  p.listas.perfil = (r) => (r === 'row'
    ? Promise.resolve({ success: true, profile: { id: 1, editableCountryIDs: [], managedAreas: [] } })
    : new Promise((ok) => { soltar[r] = ok; }));
  p.listas.paises = () => Promise.resolve({ success: true, countries: BR_FR });
  const carga = p.app.loadProfileAndAuxData();
  await tique(5);
  assert.ok(soltar.na, 'o instrumento não segurou a pergunta à NA');
  aplicarLugar(p, 'row', 73);
  soltar.na({ success: true, profile: { id: 1, editableCountryIDs: [235] } });
  await tique(5);
  if (soltar.il) soltar.il({ success: true, profile: { id: 1, editableCountryIDs: [] } });
  await carga;
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 73], 'a resposta da NA desfez o país que a pessoa aplicou');
});

test('achado 10: a pessoa aplica outro lugar enquanto a lista da região do perfil vem — nada se grava por cima', async () => {
  const p = pagina({ regiao: 'row', pais: 30 });
  let soltar;
  p.listas.paises = (r) => new Promise((ok) => { soltar = () => ok({ success: true, countries: r === 'na' ? [{ id: 235, name: 'United States' }] : BR_FR }); });
  const ida = p.app.irProPaisDoPerfil({ regiao: 'na', pais: 235 });
  await tique();
  aplicarLugar(p, 'row', 73);
  soltar();
  await ida;
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 73], 'a ida pro país do perfil gravou por cima da escolha feita durante a espera');
});

test('achado 10: pelo ALARME FALSO (o 1º perfil barrado por um 401 passageiro), a escolha feita no meio também vale', async () => {
  // O `handleUnauthorized` completa o 1º perfil com a sonda: o lugar que vale é
  // o registrado pela carga que levou o 401 (a costura K11 cobre o caso SEM
  // troca no meio, que ainda leva quem edita na França pra França).
  const p = pagina({ regiao: 'row', pais: 30 });
  let n = 0;
  p.listas.perfil = () => Promise.resolve(n++ === 0
    ? { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.sessionMissing' }
    : { success: true, profile: { id: 1, editableCountryIDs: [30], managedAreas: [] } });
  p.listas.paises = () => Promise.resolve({ success: true, countries: BR_FR });
  Object.assign(p.deps, { VERIFICA_SESSAO_MS: 0, verificandoSessao: false, sessaoVivaEm: { s: null, em: 0 } });
  p.AppState.authenticated = true;
  let sonda;
  p.deps.setTimeout = (f) => { sonda = f; return 1; };   // a sonda espera o teste
  const app = montar([...FUNCOES, 'handleUnauthorized'], p.deps);
  await app.loadProfileAndAuxData();                      // o perfil levou o 401: a sonda fica armada
  assert.ok(sonda, 'o instrumento não armou a sonda do alarme falso');
  aplicarLugar(p, 'na', 235);                             // a pessoa aplica NA/EUA no meio
  sonda();
  await tique(10);
  assert.ok(p.AppState.profile, 'CONTROLE: a sonda trouxe o perfil');
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['na', 235], 'o perfil do alarme falso desfez a escolha feita no meio');
});

test('achado 10: o registro do pedido é UM por vez — o teto do pedido é menor que o intervalo de refazer o perfil', () => {
  // O `lugarDoPedidoDoPerfil` é o do ÚLTIMO pedido de perfil. Ele só serve se
  // duas cargas nunca se sobrepõem: se a 1ª ainda pudesse responder depois de
  // a 2ª registrar o lugar dela, a 1ª decidiria sobre um lugar que não era o do
  // seu pedido (e o `na/30` voltaria). Hoje não se sobrepõem por construção: o
  // pedido morre aos 45 s (`_post`), e o `refazerPerfilSeFaltar` só pede de novo
  // 60 s depois — e só sem perfil. Subir um ou baixar o outro reabre o buraco.
  const api = ler('js/api.js');
  const post = api.slice(api.indexOf('async _post('), api.indexOf('async _post(') + 1500);
  const teto = /setTimeout\(\(\) => controller\.abort\(\), (\d+)\)/.exec(post);
  assert.ok(teto, 'o teto do pedido sumiu do `_post` — o instrumento não o achou');
  const refazer = constante('PERFIL_REFAZER_MS');
  assert.ok(Number(teto[1]) < refazer,
    `o pedido pode durar ${teto[1]} ms e o perfil é refeito com ${refazer} ms: duas cargas se sobrepõem`);
  assert.match(fatiar('refazerPerfilSeFaltar'), /if \(!AppState\.authenticated \|\| AppState\.profile\) return;/,
    'o perfil passou a ser refeito com um perfil já em mãos');
});

// ═══ Achado 11 · os Filtros abertos acompanham o lugar que mudou por baixo ═══
test('achado 11: com os Filtros abertos, o país do perfil que muda por baixo muda NA TELA — e o "Aplicar" não o desfaz', async () => {
  // Quem edita na França abre no Brasil, com os Filtros abertos (o atalho) — e
  // com uma área gerenciada do Brasil aplicada.
  const perfil = { id: 1, editableCountryIDs: [], managedAreas: [{ id: 9001, name: 'Área SP' }] };
  const p = pagina({ regiao: 'row', pais: 30, perfil, filtros: { managedAreaId: '9001' }, estados: { 73: [{ id: 5, name: 'Bretagne' }] } });
  await p.abrir();
  assert.deepEqual([p.els.filterCountry.value, p.els.filterManagedArea.value], ['30', '9001'], 'CONTROLE: os Filtros abriram no Brasil, com a área');
  await p.app.irProPaisDoPerfil({ regiao: 'row', pais: 73 });
  await tique();
  assert.equal(p.els.filterCountry.value, '73', `o país aplicado virou a França e o seletor segue mostrando "${p.els.filterCountry.mostrado}"`);
  assert.equal(p.els.filterManagedArea.value, '', 'o país virou a França e a área de São Paulo seguiu na tela');
  // Só desmarcar um tipo e aplicar: o lugar é o de agora, sem a área de antes.
  p.app.applyFiltersFromModal();
  assert.equal(p.estado.pais, 73, 'o "Aplicar" pôs o Brasil de volta, calado');
  assert.equal(p.log.salvos.at(-1).managedAreaId, '', 'o "Aplicar" pôs a área do Brasil de volta, na França');
});

test('achado 11: se a pessoa escolheu OUTRO país no modal, a escolha dela vale', async () => {
  const p = pagina({ regiao: 'row', pais: 30, paises: [...BR_FR, { id: 181, name: 'Portugal' }] });
  await p.abrir();
  p.els.filterCountry.value = '181';   // a pessoa escolheu Portugal
  await p.app.irProPaisDoPerfil({ regiao: 'row', pais: 73 });
  await tique();
  assert.equal(p.els.filterCountry.value, '181', 'o redesenho desfez o país que a pessoa escolheu');
  p.app.applyFiltersFromModal();
  assert.equal(p.estado.pais, 181);
});

test('achado 11: com os países ainda chegando, quem os põe no seletor já escolhe o país de agora', async () => {
  const p = pagina({ regiao: 'row', pais: 30 });
  let soltar;
  p.listas.paises = () => new Promise((ok) => { soltar = ok; });
  const abrindo = p.abrir();
  await tique();
  assert.equal(p.els.filterCountry.dataset.carregando, '1', 'CONTROLE: os países ainda vêm');
  p.listas.paises = null;
  await p.app.irProPaisDoPerfil({ regiao: 'row', pais: 73 });
  soltar({ success: true, countries: BR_FR });
  await abrindo;
  assert.equal(p.els.filterCountry.value, '73', 'a lista chegou e o seletor mostrou o país de antes');
  assert.equal(p.log.listCountries.length, 1, 'o redesenho pediu os países de novo com a lista já no ar');
});

test('achado 11: com os Filtros FECHADOS, nada se redesenha (nem se pede de novo)', async () => {
  const p = pagina({ regiao: 'row', pais: 30 });
  await p.abrir();
  p.els.filtersModal.classList.add('hidden');   // fechou sem aplicar
  p.AppState.countries = [];                     // e o cache foi embora (outra região aplicada e desfeita)
  const pedidos = p.log.listCountries.length;
  await p.app.irProPaisDoPerfil({ regiao: 'row', pais: 73 });
  await tique();
  assert.equal(p.log.listCountries.length, pedidos, 'redesenhou os Filtros fechados — e pediu os países à toa');
  assert.equal(p.els.filterCountry.value, '30', 'mexeu no seletor dos Filtros fechados');
  assert.equal(p.estado.pais, 73, 'CONTROLE: o país do perfil foi aplicado');
});

// ═══ Achado 12 · voltar pra região aplicada devolve o lugar aplicado ════════
test('achado 12: trocar a região no modal e VOLTAR pra aplicada devolve o país, o estado e a área aplicados', async () => {
  const LISTAS = { na: [{ id: 235, name: 'United States' }, { id: 40, name: 'Canada' }], row: BR_FR };
  const perfil = { id: 1, editableCountryIDs: [], managedAreas: [{ id: 9001, name: 'Área Chicago' }] };
  const p = pagina({ regiao: 'na', pais: 235, perfil, filtros: { stateId: '7', managedAreaId: '9001' },
    estados: { 235: [{ id: 7, name: 'Illinois' }], 30: [{ id: 1, name: 'Acre' }] } });
  p.listas.paises = (r) => Promise.resolve({ success: true, countries: LISTAS[r] });
  await p.abrir();
  assert.deepEqual([p.els.filterCountry.value, p.els.filterState.value, p.els.filterManagedArea.value], ['235', '7', '9001'],
    'CONTROLE: os Filtros abriram no lugar aplicado');
  for (const r of ['row', 'na']) {
    p.els.filterRegion.value = r;
    await p.app.aoTrocarRegiaoNoModal({ target: p.els.filterRegion });
  }
  assert.equal(p.els.filterCountry.value, '235', `voltou pra NA e o seletor escolheu "${p.els.filterCountry.mostrado}" em vez dos EUA`);
  assert.equal(p.els.filterState.value, '7', 'voltou pra NA e o estado aplicado não voltou');
  assert.equal(p.els.filterManagedArea.value, '9001', 'voltou pra NA e a área aplicada não voltou');
  p.app.applyFiltersFromModal();
  assert.deepEqual([p.estado.regiao, p.estado.pais, p.log.salvos.at(-1).stateId, p.log.salvos.at(-1).managedAreaId],
    ['na', 235, '7', '9001'], 'o "Aplicar" mudou o lugar que a pessoa só foi e voltou');
  // CONTROLE: na região que NÃO é a aplicada, vale o 1º da lista e a área sai (F7).
  p.els.filterRegion.value = 'row';
  await p.app.aoTrocarRegiaoNoModal({ target: p.els.filterRegion });
  assert.deepEqual([p.els.filterCountry.value, p.els.filterManagedArea.value], ['30', '']);
});

// ═══ R56-6 · a lista que chega DEPOIS não desfaz a escolha da pessoa ════════
// Trocada a região NA → ROW → NA, as duas idas à NA passavam pela conferência
// da região: a primeira a chegar soltava a lista e o "Aplicar", a pessoa
// escolhia os EUA, e a outra punha o 1º da lista de volta e zerava a área —
// MEDIDO no navegador: 235 escolhido, 40 no fim (auditoria da rodada 5). Cada
// carga da lista de países tem um número (`cargaDePaises`), e só a última a
// começar escreve. A pessoa daqui escolhe ASSIM QUE O SELETOR DEIXA (a lista na
// tela, sem "carregando", destravado), em qualquer ordem de chegada: é o que
// ela faria, e é o que separa "a lista velha não escreve" de "escreveu antes".
const LISTAS_R56 = {
  // O 1º da lista é o Canadá, como no navegador (lá a lista sai ordenada pelo nome).
  na: [{ id: 40, name: 'Canada' }, { id: 235, name: 'United States' }],
  row: BR_FR,
};
const podeEscolher = (sel, valor) => !sel.dataset.carregando && !sel.disabled && sel.opcoes.some((o) => o.value === String(valor));
// O ouvinte do seletor de país (setupModalListeners), com a escolha da pessoa.
async function escolherPais(p, valor) {
  p.els.filterCountry.value = String(valor);
  p.app.aoMudarPaisNaTela();
  await p.app.loadStatesIntoSelect(parseInt(valor, 10), p.els.filterRegion.value);
}
function segurarPaises(p) {
  const segurados = [];
  p.listas.paises = (r) => new Promise((ok) => segurados.push({ r, ok }));
  return segurados;
}
function trocarRegioes(p, regioes) {
  return regioes.map((r) => {
    p.els.filterRegion.value = r;
    return p.app.aoTrocarRegiaoNoModal({ target: p.els.filterRegion });
  });
}

test('R56-6: NA → ROW → NA — a lista que chega depois não desfaz o país e a área que a pessoa escolheu', async () => {
  const perfil = { id: 1, editableCountryIDs: [], managedAreas: [{ id: 9001, name: 'Área Chicago' }] };
  const casos = [
    ['a 1ª ida à NA chega antes', ['na', 'row', 'na'], [0, 1, 2]],
    ['a última ida à NA chega antes', ['na', 'row', 'na'], [2, 0, 1]],
    ['CONTROLE: uma ida só à NA', ['na'], [0]],
  ];
  for (const [nome, regioes, ordem] of casos) {
    const p = pagina({ regiao: 'row', pais: 30, perfil });
    await p.abrir();
    const segurados = segurarPaises(p);
    const trocas = trocarRegioes(p, regioes);
    await tique();
    assert.deepEqual(segurados.map((x) => x.r), regioes, `${nome}: o instrumento não segurou as listas`);
    let escolheu = false;
    for (const i of ordem) {
      segurados[i].ok({ success: true, countries: LISTAS_R56[segurados[i].r] });
      await tique();
      if (!escolheu && podeEscolher(p.els.filterCountry, 235)) {
        await escolherPais(p, 235);           // os EUA, o 2º da lista
        p.els.filterManagedArea.value = '9001';   // e uma área
        escolheu = true;
      }
    }
    await Promise.all(trocas);
    assert.ok(escolheu, `${nome}: o seletor nunca deixou a pessoa escolher`);
    assert.equal(p.els.filterCountry.value, '235',
      `${nome}: a pessoa escolheu os EUA e o seletor mostra "${p.els.filterCountry.mostrado}"`);
    assert.equal(p.els.filterManagedArea.value, '9001', `${nome}: a lista que chegou depois zerou a área escolhida`);
    assert.equal(p.els.applyFilters.disabled, false, `${nome}: o "Aplicar" ficou morto`);
    p.app.applyFiltersFromModal();
    assert.deepEqual([p.estado.regiao, p.estado.pais, p.log.salvos.at(-1).managedAreaId], ['na', 235, '9001'],
      `${nome}: o "Aplicar" gravou ${p.estado.regiao}/${p.estado.pais}`);
  }
});

test('R56-6: a lista da ABERTURA chegando depois de a região ir e VOLTAR não desfaz o país escolhido na lista da troca', async () => {
  // O 1º uso, sem a lista em cache: a abertura pede os países da região aplicada.
  for (const [nome, ordem] of [['a da troca chega antes', [2, 0, 1]], ['a da abertura chega antes', [0, 2, 1]]]) {
    const p = pagina({ regiao: 'row', pais: 30 });
    const segurados = segurarPaises(p);
    const abrindo = p.abrir();
    await tique();
    const trocas = trocarRegioes(p, ['na', 'row']);
    await tique();
    assert.deepEqual(segurados.map((x) => x.r), ['row', 'na', 'row'], `${nome}: o instrumento não segurou as listas`);
    let escolheu = false;
    for (const i of ordem) {
      segurados[i].ok({ success: true, countries: LISTAS_R56[segurados[i].r] });
      await tique();
      if (!escolheu && podeEscolher(p.els.filterCountry, 73)) { await escolherPais(p, 73); escolheu = true; }
    }
    await abrindo;
    await Promise.all(trocas);
    assert.ok(escolheu, `${nome}: o seletor nunca deixou a pessoa escolher`);
    assert.equal(p.els.filterCountry.value, '73',
      `${nome}: a pessoa escolheu a França e o seletor mostra "${p.els.filterCountry.mostrado}"`);
    p.app.applyFiltersFromModal();
    assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 73], `${nome}: o "Aplicar" gravou ${p.estado.regiao}/${p.estado.pais}`);
  }
});

test('R56-6: reabrir os Filtros com trocas no ar — a resposta delas não escreve no modal reaberto', async () => {
  const p = pagina({ regiao: 'row', pais: 30 });
  await p.abrir();
  const segurados = segurarPaises(p);
  const trocas = trocarRegioes(p, ['na', 'row']);
  await tique();
  // Fechou sem aplicar e reabriu: a lista da ROW está no cache, e a abertura a escreve na hora.
  p.els.filtersModal.classList.add('hidden');
  await p.abrir();
  assert.ok(podeEscolher(p.els.filterCountry, 73), 'CONTROLE: o modal reaberto mostra a lista da região aplicada');
  await escolherPais(p, 73);
  for (const s of segurados) { s.ok({ success: true, countries: LISTAS_R56[s.r] }); await tique(); }
  await Promise.all(trocas);
  assert.deepEqual(segurados.map((x) => x.r), ['na', 'row'], 'CONTROLE: as duas trocas ficaram no ar');
  assert.equal(p.els.filterCountry.value, '73',
    `a troca de antes de fechar escreveu no modal reaberto: "${p.els.filterCountry.mostrado}" no lugar da França`);
  assert.equal(p.els.applyFilters.disabled, false);
  p.app.applyFiltersFromModal();
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 73]);
});

test('R56-6: a troca que NÃO carrega devolve a lista da região aplicada pela abertura — com o "Minha área" marcado na tela travando o país', async () => {
  for (const [nome, depoisDaFalha] of [['a da abertura chega antes', 'abertura'], ['a pedida de novo chega antes', 'nova']]) {
    const p = pagina({ regiao: 'row', pais: 30 });
    const segurados = segurarPaises(p);
    const abrindo = p.abrir();   // o 1º uso: a lista da ROW vem
    await tique();
    // A pessoa marca "Minha área" com a lista chegando (o ouvinte trava os três).
    p.els.filterMyArea.checked = true;
    for (const id of ['filterCountry', 'filterState', 'filterManagedArea']) p.els[id].disabled = true;
    const [troca] = trocarRegioes(p, ['na']);
    await tique();
    segurados[1].ok({ success: false, errorCategory: 'transient' });   // a NA não carrega
    await tique();
    assert.equal(p.els.filterRegion.value, 'row', `${nome}: a troca que não carregou não devolveu a região aplicada`);
    // A lista da abertura e a pedida de novo (se o caminho da falha a pedir), na ordem do caso.
    const abertura = segurados[0];
    const outras = segurados.slice(2);
    const ordem = depoisDaFalha === 'abertura' ? [abertura, ...outras] : [...outras, abertura];
    for (const s of ordem) { s.ok({ success: true, countries: LISTAS_R56[s.r] }); await tique(); }
    await abrindo;
    await troca;
    assert.deepEqual(p.els.filterCountry.opcoes.map((o) => o.value), ['30', '73'],
      `${nome}: a troca desfeita deixou o seletor de país com "${p.els.filterCountry.mostrado}"`);
    assert.equal(p.els.filterCountry.value, '30');
    assert.equal(p.els.filterCountry.dataset.carregando, undefined, `${nome}: o seletor seguiu "carregando"`);
    assert.equal(p.els.filterCountry.disabled, true,
      `${nome}: o "Minha área" está marcado na tela e o seletor de país voltou destravado`);
    assert.equal(p.els.applyFilters.disabled, false, `${nome}: o "Aplicar" ficou morto depois da falha`);
    assert.ok(p.log.toasts.some((l) => l.startsWith('error:')), `${nome}: a troca de região desfeita calada`);
  }
});

test('R56-6: a troca de região que começa com os estados da abertura chegando não é destravada por eles', async () => {
  const p = pagina({ regiao: 'row', pais: 30 });
  let soltarEstados;
  p.listas.estados = () => new Promise((ok) => { soltarEstados = ok; });
  const abrindo = p.abrir();   // os países vêm; os estados do Brasil ficam no ar
  await tique();
  assert.equal(p.els.filterState.dataset.carregando, '1', 'CONTROLE: os estados da abertura estão no ar');
  p.listas.paises = () => new Promise(() => {});   // a lista da NA não chega neste teste
  trocarRegioes(p, ['na']);
  await tique();
  assert.equal(p.els.filterCountry.disabled, true, 'CONTROLE: a troca travou o seletor de país');
  soltarEstados({ success: true, states: [{ id: 25, name: 'São Paulo' }] });
  await abrindo;
  assert.equal(p.els.filterCountry.disabled, true,
    'os estados da abertura chegaram e destravaram o seletor de país com a lista da troca ainda carregando');
  assert.equal(p.els.filterCountry.dataset.carregando, '1');
  assert.equal(p.els.applyFilters.disabled, true, 'CONTROLE: o "Aplicar" segue esperando a lista da troca');
});

// ═══ Achado 11, com a REGIÃO trocada pelo perfil e a lista da abertura no ar ═
// Quem só edita na NA abre os Filtros pelo atalho, antes do perfil. O perfil
// chega e leva a pessoa pra NA/EUA com a lista de países da ABERTURA (a da ROW)
// ainda vindo: o redesenho não mexia na tela "carregando", e a lista da ROW,
// chegando depois, punha os países da NA debaixo do seletor de região em `row`
// — MEDIDO no navegador: o "Aplicar" gravava `row/235`, os EUA no servidor da
// ROW, uma fila vazia (achado do lote 9, ao consertar o R56-6).
test('achado 11, região: com a lista da ABERTURA no ar, o perfil que leva pra OUTRA região leva a tela junto', async () => {
  const NA = [{ id: 40, name: 'Canada' }, { id: 235, name: 'United States' }];
  for (const [nome, listaAntes] of [['a lista da abertura chega DEPOIS do perfil', false], ['CONTROLE: a lista da abertura chega ANTES', true]]) {
    const p = pagina({ regiao: 'row', pais: 30 });
    let soltarRow;
    p.listas.paises = (r) => (r === 'row' ? new Promise((ok) => { soltarRow = ok; }) : Promise.resolve({ success: true, countries: NA }));
    const abrindo = p.abrir();   // pelo atalho, antes do perfil: a lista da ROW vem
    await tique();
    assert.equal(p.els.filterCountry.dataset.carregando, '1', `${nome}: CONTROLE — a lista da abertura está no ar`);
    if (listaAntes) { soltarRow({ success: true, countries: BR_FR }); await tique(); }
    await p.app.irProPaisDoPerfil({ regiao: 'na', pais: 235 });   // quem só edita na NA
    await tique();
    if (!listaAntes) soltarRow({ success: true, countries: BR_FR });
    await abrindo;
    const tela = `${p.els.filterRegion.value}/${p.els.filterCountry.value} com os países ${p.els.filterCountry.opcoes.map((o) => o.value)}`;
    assert.equal(p.els.filterRegion.value, 'na', `${nome}: o perfil levou pra NA/EUA e a tela ficou em ${tela}`);
    assert.deepEqual(p.els.filterCountry.opcoes.map((o) => o.value), ['40', '235'], `${nome}: a tela ficou em ${tela}`);
    assert.equal(p.els.filterCountry.value, '235', `${nome}: a tela ficou em ${tela}`);
    assert.deepEqual(p.AppState.countries.map((c) => c.id), [40, 235], `${nome}: a lista da ROW virou a lista de países da NA`);
    assert.equal(p.log.listCountries.length, 2, `${nome}: o redesenho pediu a lista de novo (${p.log.listCountries})`);
    assert.equal(p.els.applyFilters.disabled, false);
    p.app.applyFiltersFromModal();
    assert.deepEqual([p.estado.regiao, p.estado.pais], ['na', 235], `${nome}: o "Aplicar" gravou ${p.estado.regiao}/${p.estado.pais}`);
  }
});

test('achado 11, região: com uma troca da PESSOA no ar, o perfil não toma o seletor dela — e o "Aplicar" não morre', async () => {
  const p = pagina({ regiao: 'row', pais: 30 });
  await p.abrir();
  const segurados = segurarPaises(p);
  const trocas = trocarRegioes(p, ['na', 'row']);   // a pessoa foi à NA e voltou: a troca da ROW está no ar
  await tique();
  const indo = p.app.irProPaisDoPerfil({ regiao: 'na', pais: 235 });
  await tique();
  assert.deepEqual(segurados.map((x) => x.r), ['na', 'row', 'na'], 'o instrumento não segurou as listas');
  segurados[2].ok({ success: true, countries: LISTAS_R56.na });   // a lista que o perfil pediu
  await indo;
  for (const i of [0, 1]) { segurados[i].ok({ success: true, countries: LISTAS_R56[segurados[i].r] }); await tique(); }
  await Promise.all(trocas);
  assert.equal(p.els.applyFilters.disabled, false,
    'o "Aplicar" ficou morto: o redesenho tomou o seletor da troca que a pessoa deixou no ar, e ela nunca soltou a espera');
  assert.equal(p.els.filterRegion.value, 'row', 'o redesenho passou por cima da troca de região que a pessoa fez');
  // O que se vê é o que o "Aplicar" grava: a região do seletor e a lista dela.
  assert.deepEqual(p.els.filterCountry.opcoes.map((o) => o.value), ['30', '73']);
  const naTela = [p.els.filterRegion.value, Number(p.els.filterCountry.value)];
  p.app.applyFiltersFromModal();
  assert.deepEqual([p.estado.regiao, p.estado.pais], naTela, `o "Aplicar" gravou ${p.estado.regiao}/${p.estado.pais} e a tela dizia ${naTela.join('/')}`);
});

test('achado 11, região: se a pessoa escolheu OUTRO país no modal, a escolha dela vale também quando o perfil troca a região', async () => {
  const p = pagina({ regiao: 'row', pais: 30 });
  p.listas.paises = (r) => Promise.resolve({ success: true, countries: LISTAS_R56[r] });
  await p.abrir();
  await escolherPais(p, 73);   // a pessoa escolheu a França
  await p.app.irProPaisDoPerfil({ regiao: 'na', pais: 235 });
  await tique();
  assert.deepEqual([p.els.filterRegion.value, p.els.filterCountry.value], ['row', '73'],
    `o perfil levou pra NA e passou por cima da França que a pessoa escolheu: ${p.els.filterRegion.value}/${p.els.filterCountry.value}`);
  p.app.applyFiltersFromModal();
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 73]);
});

// ═══ R66-4 · a lista de países é a MESMA na abertura e na volta à região ═════
// A troca de região punha a lista INTEIRA, inclusive ao VOLTAR pra região
// aplicada: pro mesmo servidor os Filtros mostravam duas listas — na abertura só
// os países que a pessoa edita, com a dica; depois da ida e volta, todos, sem
// ela —, e na volta dava pra aplicar um que ela não edita (o filtro de
// permissão do servidor descarta tudo: fila vazia). E a reabertura dos Filtros
// mostrava OUTRO país no lugar do aplicado, que um "Aplicar" tocado só pra
// desmarcar um tipo gravava, calado (auditoria da rodada 6). MEDIDO no
// navegador: na volta "30,73,181" sem a dica, escolhido 73, aplicado `row/73`,
// reaberto mostrando o 30, e o "Aplicar" gravando `row/30`.
const LISTAS_R66 = {
  row: [{ id: 30, name: 'Brazil' }, { id: 73, name: 'France' }, { id: 181, name: 'Portugal' }],
  na: [{ id: 235, name: 'United States' }, { id: 40, name: 'Canada' }],
};
function paginaR66(extra = {}) {
  const p = pagina({ perfil: { id: 1, editableCountryIDs: [30], managedAreas: [] }, ...extra });
  // Uma lista NOVA a cada pedido, como a da rede: com o mesmo objeto, a abertura
  // e a troca não se distinguiriam por identidade.
  p.listas.paises = (r) => Promise.resolve({ success: true, countries: LISTAS_R66[r].map((c) => ({ ...c })) });
  return p;
}
const telaDoPais = (p) => ({
  opcoes: p.els.filterCountry.opcoes.map((o) => o.value).join(','),
  pais: p.els.filterCountry.value,
  dica: !p.els.filterCountryHint.classList.contains('hidden'),
});
async function trocarRegiao(p, r) {
  p.els.filterRegion.value = r;
  await p.app.aoTrocarRegiaoNoModal({ target: p.els.filterRegion });
}
// O "Aplicar" tocado só pra desmarcar um tipo.
function aplicarSoDesmarcandoUmTipo(p) {
  p.deps.document.querySelectorAll = (q) => (q === '.filter-type:checked' ? [{ value: 'NEW_PLACE' }] : []);
  p.app.applyFiltersFromModal();
}

test('R66-4: ir e voltar de região mostra a MESMA lista da abertura — só os editáveis, com a dica — e o país que a pessoa não edita não entra', async () => {
  const p = paginaR66();
  await p.abrir();
  const abertura = telaDoPais(p);
  assert.deepEqual(abertura, { opcoes: '30', pais: '30', dica: true }, 'CONTROLE: a abertura não peneirou pelos países do perfil');
  await trocarRegiao(p, 'na');
  // CONTROLE: na região que não é a do perfil, a lista vai inteira e sem a dica.
  assert.deepEqual(telaDoPais(p), { opcoes: '235,40', pais: '235', dica: false }, 'CONTROLE: a NA não veio inteira');
  await trocarRegiao(p, 'row');
  assert.deepEqual(telaDoPais(p), abertura, 'de volta à região aplicada, os Filtros mostram outra lista que a da abertura');
  // A França não é opção: escolhê-la não acontece, e o "Aplicar" fica no Brasil.
  p.els.filterCountry.value = '73';
  assert.equal(p.els.filterCountry.value, '', 'a França (que a pessoa não edita) é opção na volta');
  p.app.applyFiltersFromModal();
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 30]);
});

test('R66-4: o país APLICADO que a pessoa não edita entra como opção — o seletor não mostra outro no lugar dele, e o "Aplicar" não o troca calado', async () => {
  // Aplicado `row/73` (escolhido antes de o perfil chegar, ou numa versão de antes).
  const p = paginaR66({ pais: 73 });
  await p.abrir();
  const tela = telaDoPais(p);
  assert.equal(tela.pais, '73', `os Filtros mostram o ${tela.pais} no lugar do país aplicado (73)`);
  assert.deepEqual(tela.opcoes.split(',').sort(), ['30', '73'], 'a lista não é a dos editáveis mais o aplicado');
  assert.equal(tela.dica, false, 'a dica diz "só os países que você pode editar" com um que a pessoa não edita na lista');
  aplicarSoDesmarcandoUmTipo(p);
  assert.equal(p.estado.pais, 73, `o "Aplicar" tocado só pra desmarcar um tipo gravou o ${p.estado.pais}, calado`);
  // E a ida e volta mantém o aplicado.
  await trocarRegiao(p, 'na');
  await trocarRegiao(p, 'row');
  assert.equal(p.els.filterCountry.value, '73', 'na volta à região aplicada, o seletor saiu do país aplicado');
  // CONTROLE: com o aplicado editável, a lista é só a dos editáveis, com a dica.
  const q = paginaR66({ pais: 30 });
  await q.abrir();
  assert.deepEqual(telaDoPais(q), { opcoes: '30', pais: '30', dica: true });
});

// ═══ R7-6-03 · o "Sair" esquece a lista de países da região de antes ═══════
// O "Sair" repunha região e país (`row/30`), mas deixava em memória a lista de
// países (e os estados) da região de ANTES — e a lista só é pedida com o cache
// VAZIO. Entrando de novo na MESMA aba, com a lista da ROW falhando (sinal ruim)
// ou ainda chegando, os Filtros mostravam os países da NA debaixo da ROW, e o
// "Aplicar" tocado sem mexer em nada gravava `row/235`, os EUA no servidor da
// ROW — uma fila vazia (MEDIDO no navegador, auditoria da rodada 7). Aqui o
// `handleLogout` roda DE VERDADE, nos três caminhos (este "Sair", o da outra aba
// e a recusa do portão), com o lugar e a lista da página de verdade.
const LISTA_NA = [{ id: 235, name: 'United States' }, { id: 40, name: 'Canada' }];
function sairNaPagina(p, modo) {
  Object.assign(p.API, {
    sessionToken: 'tok', chamadas: [],
    getSession() { return this.sessionToken; }, setSession(t) { this.sessionToken = t; },
    soltarSessao() { this.sessionToken = null; },
    destroySession: async () => ({ success: true }), cancelarPareamento: async () => {},
    // A outra aba relê o lugar do aparelho, que o "Sair" de lá deixou de fábrica.
    esquecerLugar: () => { p.estado.regiao = 'row'; p.estado.pais = 30; },
  });
  Object.assign(p.deps, {
    pareamentosEmitidos: new Set(), epocaDaSessao: 0,
    filtrosDeFabrica: () => ({ types: ['NEW_PLACE', 'NEW_PHOTO'], residential: '', stateId: '', managedAreaId: '',
      myArea: false, unreadOnly: true, categories: [], sortOrder: 'newest' }),
  });
  const { handleLogout } = montar(['handleLogout'], p.deps);
  return handleLogout(modo);
}
// Uma sessão na NA (os EUA), com a lista da NA (e estados) em memória.
async function sessaoNaNA() {
  const p = pagina({ regiao: 'na', pais: 235, perfil: { id: 1, editableCountryIDs: [235], managedAreas: [] },
    estados: { 235: [{ id: 7, name: 'Illinois' }] } });
  p.listas.paises = (r) => Promise.resolve(r === 'na'
    ? { success: true, countries: LISTA_NA.map((c) => ({ ...c })) }
    : { success: false, errorCategory: 'transient' });
  await p.abrir();
  p.els.filtersModal.classList.add('hidden');
  assert.deepEqual(p.AppState.countries.map((c) => c.id), [235, 40], 'PRÉ-CONDIÇÃO: a lista da NA está em memória');
  assert.ok(p.AppState.statesByCountry[235], 'PRÉ-CONDIÇÃO: os estados dos EUA estão em memória');
  return p;
}

test('R7-6-03: o "Sair" esquece a lista de países e os estados da região de antes — nos três caminhos', async () => {
  for (const modo of [undefined, { porOutraAba: true }, { recusado: true }]) {
    const nome = JSON.stringify(modo || {});
    const p = await sessaoNaNA();
    await sairNaPagina(p, modo);
    assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 30], `${nome}: PRÉ-CONDIÇÃO: o lugar voltou ao de fábrica`);
    assert.deepEqual(p.AppState.countries, [], `${nome}: a lista da NA seguiu em memória debaixo da ROW`);
    assert.deepEqual(p.AppState.statesByCountry, {}, `${nome}: os estados da região de antes seguiram em memória`);
  }
});

test('R7-6-03: entrando de novo na mesma aba, com a lista da ROW falhando, os Filtros não mostram os países da NA — e o "Aplicar" fica na ROW', async () => {
  const p = await sessaoNaNA();
  await sairNaPagina(p);
  // Quem entra de novo (na mesma aba) edita no Brasil; a lista da ROW não vem.
  p.AppState.profile = { id: 1, editableCountryIDs: [30], managedAreas: [] };
  await p.abrir();
  const tela = telaDoPais(p);
  assert.ok(!tela.opcoes.split(',').includes('235'),
    `os Filtros em ${p.els.filterRegion.value} mostram os países da NA: ${tela.opcoes}`);
  aplicarSoDesmarcandoUmTipo(p);
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 30],
    `o "Aplicar" tocado sem mexer no lugar gravou ${p.estado.regiao}/${p.estado.pais}`);
  // CONTROLE: com a lista da ROW chegando, os Filtros a mostram, peneirada.
  const q = await sessaoNaNA();
  await sairNaPagina(q);
  q.AppState.profile = { id: 1, editableCountryIDs: [30], managedAreas: [] };
  q.listas.paises = (r) => Promise.resolve({ success: true, countries: (r === 'na' ? LISTA_NA : BR_FR).map((c) => ({ ...c })) });
  await q.abrir();
  assert.deepEqual(telaDoPais(q), { opcoes: '30', pais: '30', dica: true });
});

// ═══ R7-6-04 · a lista de PAÍSES que não carrega ═══════════════════════════
// Com a lista de países falhando (o servidor, a rede), o seletor de país ficava
// VAZIO e destravado, com os estados do país aplicado logo abaixo — o caso
// irmão, a lista de ESTADOS que falha, já dizia "Lista não carregou" (MEDIDO no
// navegador, auditoria da rodada 7: `paises-500` e `paises-rede` com o seletor
// em branco). Agora diz o mesmo, e segue "carregando" pro "Aplicar" não mexer.
test('R7-6-04: a lista de países que NÃO carrega diz isso, como a de estados — e o "Aplicar" não mexe no país nem no estado', async () => {
  const falhas = [['o servidor (500)', { success: false, errorCategory: 'transient', httpCode: 500 }],
    ['a rede', { success: false, errorCategory: 'transient', _motivo: 'rede' }]];
  for (const [nome, resposta] of falhas) {
    const p = pagina({ filtros: { stateId: '25' }, estados: { 30: [{ id: 25, name: 'São Paulo' }] } });
    p.listas.paises = () => Promise.resolve(resposta);
    await p.abrir();
    const pais = p.els.filterCountry;
    assert.equal(pais.mostrado, 'filters.state.naoCarregou', `${nome}: o seletor de país ficou "${pais.mostrado}"`);
    assert.equal((pais.querySelector('option[value=""]') || {}).i18n, 'filters.state.naoCarregou',
      `${nome}: a opção sem data-i18n não acompanha a troca de idioma`);
    assert.equal(pais.dataset.carregando, '1', `${nome}: o seletor de país não segue "carregando" — o "Aplicar" mexeria no país`);
    assert.equal(pais.disabled, false, `${nome}: o seletor ficou travado (o de estados, na mesma falha, não fica)`);
    assert.equal(p.els.filterState.mostrado, 'filters.state.naoCarregou',
      `${nome}: o estado mostra "${p.els.filterState.mostrado}" debaixo de um país que a tela não mostra`);
    assert.equal(p.els.filterState.dataset.carregando, '1');
    assert.deepEqual(p.log.listStates, [], `${nome}: pediu os estados de um país que a tela não mostra`);
    aplicarSoDesmarcandoUmTipo(p);
    assert.deepEqual([p.estado.regiao, p.estado.pais, p.log.salvos.at(-1).stateId], ['row', 30, '25'],
      `${nome}: o "Aplicar" mexeu no lugar ou no estado`);
    // Reabrir os Filtros tenta de novo — e com a lista chegando, ela aparece
    // (CONTROLE: o instrumento distingue a lista da falha).
    p.listas.paises = () => Promise.resolve({ success: true, countries: BR_FR.map((c) => ({ ...c })) });
    await p.abrir();
    assert.deepEqual(telaDoPais(p), { opcoes: '30,73', pais: '30', dica: false }, `${nome}: reabrir não pediu a lista de novo`);
    assert.equal(p.els.filterState.value, '25', `${nome}: o estado aplicado não voltou com a lista`);
  }
});

test('R7-6-04: a carga de estados que ainda vinha não escreve por cima do "Lista não carregou" do país', async () => {
  // A pessoa trocou de país (os estados dele no ar), fechou e reabriu os
  // Filtros com a lista de países indo e falhando.
  const p = pagina({ estados: {} });
  await p.abrir();
  let soltarEstados;
  p.listas.estados = () => new Promise((ok) => { soltarEstados = ok; });
  const velha = p.app.loadStatesIntoSelect(73, 'row');
  p.els.filtersModal.classList.add('hidden');
  p.AppState.countries = [];
  p.listas.paises = () => Promise.resolve({ success: false, errorCategory: 'transient' });
  await p.abrir();
  soltarEstados({ success: true, states: [{ id: 3, name: 'Normandie' }] });
  await velha;
  assert.equal(p.els.filterState.mostrado, 'filters.state.naoCarregou',
    `a carga de estados de antes escreveu "${p.els.filterState.mostrado}" debaixo do país que não carregou`);
  assert.equal(p.els.filterState.dataset.carregando, '1');
});

// ═══ R7-6-02 · quem edita só noutro servidor tem a peneira na 1ª sessão ═════
// O app abre na ROW (de fábrica, e depois de todo "Sair"). O perfil de lá vem
// com `editableCountryIDs []`, e o `paisDoPerfil` pergunta o NA e leva a pessoa
// pros EUA — mas o perfil que ficava era o da ROW, vazio, e a lista que a
// pergunta trouxe ia embora. Nos Filtros dessa sessão a lista do NA ia inteira,
// sem a dica, e dava pra aplicar o Canadá, onde a pessoa não edita (fila
// vazia); reaberto o app, o perfil é lido no NA e a peneira valia (MEDIDO no
// navegador, auditoria da rodada 7). Aqui a carga do perfil roda DE VERDADE
// (`loadProfileAndAuxData` → `paisDoPerfil` → `irProPaisDoPerfil`).
function paginaQueEditaNaNA({ regiao = 'row', pais = 30 } = {}) {
  const p = pagina({ regiao, pais });
  p.listas.perfil = (r) => Promise.resolve({ success: true,
    profile: { id: 1, editableCountryIDs: r === 'na' ? [235] : [], managedAreas: [] } });
  p.listas.paises = (r) => Promise.resolve({ success: true, countries: (r === 'na' ? LISTA_NA : BR_FR).map((c) => ({ ...c })) });
  return p;
}

test('R7-6-02: quem edita só na NA, levado pra lá pelo perfil da ROW, tem a MESMA peneira da reabertura — sem pedido a mais', async () => {
  const p = paginaQueEditaNaNA();
  await p.app.loadProfileAndAuxData();
  await tique(5);
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['na', 235], 'PRÉ-CONDIÇÃO: o perfil não levou a pessoa pros EUA');
  assert.deepEqual(p.log.getProfile, ['row', 'na'], 'PRÉ-CONDIÇÃO: o perfil não foi perguntado no NA');
  await p.abrir();
  const primeira = telaDoPais(p);
  assert.deepEqual(primeira, { opcoes: '235', pais: '235', dica: true },
    `a 1ª sessão mostra a lista do NA sem a peneira: ${JSON.stringify(primeira)}`);
  // O Canadá (onde a pessoa não edita) não é opção, e o "Aplicar" fica nos EUA.
  p.els.filterCountry.value = '40';
  assert.equal(p.els.filterCountry.value, '', 'o Canadá, onde a pessoa não edita, é opção');
  aplicarSoDesmarcandoUmTipo(p);
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['na', 235]);
  assert.deepEqual(p.log.getProfile, ['row', 'na'], 'a peneira custou um pedido de perfil a mais');
  // CONTROLE: reaberto, o perfil é lido no NA — a mesma lista, com a dica.
  const q = paginaQueEditaNaNA({ regiao: 'na', pais: 235 });
  await q.app.loadProfileAndAuxData();
  await q.abrir();
  assert.deepEqual(q.log.getProfile, ['na'], 'CONTROLE: a reabertura perguntou a outro servidor');
  assert.deepEqual(telaDoPais(q), primeira, 'a mesma pessoa vê duas listas, conforme a sessão começou');
});

test('R7-6-02: o que o app leu nos outros servidores é DESTA conta — a sonda do alarme falso não apaga, e outra conta começa sem nada', async () => {
  const p = paginaQueEditaNaNA();
  await p.app.loadProfileAndAuxData();
  await tique(5);
  assert.deepEqual(p.app.editaveisLidos('na'), [235], 'PRÉ-CONDIÇÃO: a lista do NA não ficou');
  assert.deepEqual(p.app.editaveisLidos('row'), [], 'a lista do servidor em que o perfil foi pedido não ficou');
  assert.equal(p.app.editaveisLidos('il'), null, 'um servidor que ninguém perguntou virou "não edita lá"');
  // A sonda de um 401 que se revela alarme falso traz um perfil NOVO (outro
  // objeto) da MESMA conta, pela porta única (`definirPerfil`): o que foi lido
  // segue valendo — sem isto, a "Minha área" perdia o país pelo resto da sessão.
  p.app.definirPerfil({ success: true, profile: { id: 1, editableCountryIDs: [235], managedAreas: [] } });
  assert.deepEqual([p.app.editaveisLidos('na'), p.app.editaveisLidos('row')], [[235], []],
    'o perfil novo da MESMA conta (a sonda do alarme falso) apagou o que o app tinha lido');
  // Outra conta entra: nada da anterior vale.
  p.app.definirPerfil({ success: true, profile: { id: 2, editableCountryIDs: [], managedAreas: [] } });
  assert.equal(p.AppState.profile.id, 2, 'PRÉ-CONDIÇÃO: o perfil de outra conta não entrou');
  assert.equal(p.app.editaveisLidos('na'), null, 'a lista do NA da conta anterior vale pra quem entrou');
  // E sem perfil (o "Sair"), nada vale.
  p.AppState.profile = null;
  assert.equal(p.app.editaveisLidos('na'), null, 'sem perfil, a lista lida de alguém vale');
  // E a pergunta que FALHOU não diz que a pessoa não edita lá.
  const f = pagina();
  f.listas.perfil = (r) => Promise.resolve(r === 'row'
    ? { success: true, profile: { id: 1, editableCountryIDs: [], managedAreas: [] } }
    : { success: false, errorCategory: 'transient' });
  await f.app.loadProfileAndAuxData();
  await tique(5);
  assert.deepEqual(f.log.getProfile, ['row', 'na', 'il'], 'PRÉ-CONDIÇÃO: os outros servidores não foram perguntados');
  assert.equal(f.app.editaveisLidos('na'), null, 'a pergunta que falhou virou "não edita no NA"');
});

// ═══ R7-6-01 · o perfil que chega com os Filtros ABERTOS passa pela peneira ══
// Pelo atalho do PWA (`/?action=filters`), ou com a rede lenta, a lista de
// países entrava no seletor ANTES do perfil — todos os países, sem a dica — e o
// perfil que chegava não a refazia: dava pra escolher e aplicar um país que a
// pessoa não edita DEPOIS de o perfil chegar (fila vazia, "Confira o país e a
// região"), e a reabertura seguinte a devolvia ao país do perfil, com aviso
// (MEDIDO no navegador, auditoria da rodada 7). É o R66-4 por um terceiro
// caminho. Aqui a carga do perfil roda DE VERDADE, com o perfil segurado até os
// Filtros abrirem — a ordem do atalho.
async function filtrosAbertosAntesDoPerfil({ pais = 30, filtros = {}, estados = {}, perfil = { id: 1, editableCountryIDs: [30], managedAreas: [] } } = {}) {
  const p = pagina({ perfil: null, pais, filtros, estados });
  p.listas.paises = () => Promise.resolve({ success: true, countries: LISTAS_R66.row.map((c) => ({ ...c })) });
  let soltar;
  p.listas.perfil = () => new Promise((ok) => { soltar = ok; });
  const carga = p.app.loadProfileAndAuxData();
  await p.abrir();
  const chegar = async () => { soltar({ success: true, profile: perfil }); await carga; await tique(5); };
  return { p, chegar };
}

test('R7-6-01: o perfil que chega com os Filtros abertos peneira a lista que já estava na tela — e o país que a pessoa não edita sai', async () => {
  const { p, chegar } = await filtrosAbertosAntesDoPerfil();
  assert.deepEqual(telaDoPais(p), { opcoes: '30,73,181', pais: '30', dica: false }, 'PRÉ-CONDIÇÃO: os Filtros abriram antes do perfil');
  await chegar();
  assert.equal(p.AppState.profile && p.AppState.profile.id, 1, 'PRÉ-CONDIÇÃO: o perfil não chegou');
  assert.deepEqual(telaDoPais(p), { opcoes: '30', pais: '30', dica: true },
    `o perfil chegou com os Filtros abertos e a lista seguiu sem a peneira: ${JSON.stringify(telaDoPais(p))}`);
  p.els.filterCountry.value = '73';
  assert.equal(p.els.filterCountry.value, '', 'a França (que a pessoa não edita) segue sendo opção depois do perfil');
  aplicarSoDesmarcandoUmTipo(p);
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 30]);
  // CONTROLE: os Filtros abertos DEPOIS do perfil mostram a mesma lista.
  const q = paginaR66();
  await q.abrir();
  assert.deepEqual(telaDoPais(q), { opcoes: '30', pais: '30', dica: true });
});

test('R7-6-01: o país que a pessoa escolheu ANTES do perfil fica na tela — editável ou não (achado 11) —, e os outros que ela não edita saem', async () => {
  const perfil = { id: 1, editableCountryIDs: [30, 181], managedAreas: [{ id: 9001, name: 'Área SP' }] };
  const estados = { 30: [{ id: 25, name: 'São Paulo' }], 73: [{ id: 3, name: 'Normandie' }], 181: [{ id: 9, name: 'Lisboa' }] };
  // (a) Escolheu Portugal (que ela edita): fica, com os estados dele, e a lista
  //     é só a dos editáveis, com a dica.
  const a = await filtrosAbertosAntesDoPerfil({ perfil, estados, filtros: { stateId: '25', managedAreaId: '9001' } });
  await escolherPais(a.p, 181);
  await a.chegar();
  assert.deepEqual(telaDoPais(a.p), { opcoes: '30,181', pais: '181', dica: true },
    `o perfil desfez o Portugal que a pessoa escolheu: ${JSON.stringify(telaDoPais(a.p))}`);
  assert.equal(a.p.els.filterState.mostrado, 'filters.state.all', 'o estado de Portugal não ficou');
  // (b) Escolheu a França (que ela NÃO edita) antes de o app saber disso: a
  //     escolha é dela e fica (o perfil não a troca calado), e com ela a lista
  //     deixa de ser "só os editáveis" — sem a dica. O Portugal (editável)
  //     segue opção, e o que mais ela não edita, não.
  const b = await filtrosAbertosAntesDoPerfil({ perfil, estados, filtros: { stateId: '25', managedAreaId: '9001' } });
  await escolherPais(b.p, 73);
  const estadosAntes = b.p.els.filterState.opcoes.map((o) => o.value).join(',');
  await b.chegar();
  assert.equal(b.p.els.filterCountry.value, '73', `o perfil trocou a França que a pessoa escolheu por "${b.p.els.filterCountry.mostrado}"`);
  assert.deepEqual(b.p.els.filterCountry.opcoes.map((o) => o.value).sort(), ['181', '30', '73'],
    `a lista não é a dos editáveis mais a escolhida: ${b.p.els.filterCountry.opcoes.map((o) => o.value)}`);
  assert.ok(b.p.els.filterCountryHint.classList.contains('hidden'),
    'a dica diz "só os países que você pode editar" com a França (que ela não edita) na lista');
  assert.equal(b.p.els.filterState.opcoes.map((o) => o.value).join(','), estadosAntes,
    'o perfil mexeu nos estados do país que ficou na tela');
  assert.ok(estadosAntes.split(',').includes('3'), 'PRÉ-CONDIÇÃO: os estados da França não estavam na tela');
});

test('R7-6-01: o país APLICADO que a pessoa não edita (escolhido antes do perfil) fica — e a lista leva ele, sem a dica (R66-4)', async () => {
  // O caso b7 da auditoria: pelo atalho, a pessoa aplica a França enquanto o
  // perfil vem (o país do perfil não decide mais: achado 10) e reabre os
  // Filtros; o perfil chega com eles abertos.
  const { p, chegar } = await filtrosAbertosAntesDoPerfil();
  await escolherPais(p, 73);
  p.app.applyFiltersFromModal();
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 73], 'PRÉ-CONDIÇÃO: a França não foi aplicada');
  await p.abrir();
  await chegar();
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 73], 'PRÉ-CONDIÇÃO: o perfil desfez o lugar aplicado no meio (achado 10)');
  assert.equal(p.els.filterCountry.value, '73', `o perfil trocou o país aplicado por "${p.els.filterCountry.mostrado}" na tela`);
  assert.deepEqual(p.els.filterCountry.opcoes.map((o) => o.value).sort(), ['30', '73']);
  assert.ok(p.els.filterCountryHint.classList.contains('hidden'), 'a dica diz "só os que você pode editar" com um que a pessoa não edita na lista');
});

test('R7-6-01: com OUTRA região na tela (a troca da pessoa), ou com a lista ainda chegando, o perfil não mexe no seletor nem pede nada', async () => {
  // Outra região na tela: os editáveis deste perfil são de outro servidor.
  const { p, chegar } = await filtrosAbertosAntesDoPerfil();
  p.listas.paises = (r) => Promise.resolve({ success: true, countries: LISTAS_R66[r].map((c) => ({ ...c })) });
  await trocarRegiao(p, 'na');
  const naTela = telaDoPais(p);
  assert.deepEqual(naTela, { opcoes: '235,40', pais: '235', dica: false }, 'PRÉ-CONDIÇÃO: a NA não está na tela');
  const pedidos = p.log.listCountries.length;
  await chegar();
  assert.deepEqual(telaDoPais(p), naTela, 'o perfil mexeu na lista de outra região');
  assert.equal(p.log.listCountries.length, pedidos, 'o perfil pediu a lista de países de novo');
  // A lista ainda chegando: quem a puser no seletor peneira com o perfil de agora.
  const q = pagina({ perfil: null });
  let soltarLista;
  q.listas.paises = () => new Promise((ok) => { soltarLista = ok; });
  const abrindo = q.abrir();
  await tique();
  q.app.definirPerfil({ success: true, profile: { id: 1, editableCountryIDs: [30], managedAreas: [] } });
  assert.equal(q.els.filterCountry.dataset.carregando, '1', 'o perfil mexeu no seletor que dizia "Carregando…"');
  soltarLista({ success: true, countries: LISTAS_R66.row.map((c) => ({ ...c })) });
  await abrindo;
  assert.deepEqual(telaDoPais(q), { opcoes: '30', pais: '30', dica: true });
  assert.equal(q.log.listCountries.length, 1, 'o perfil pediu a lista de países de novo');
  // A troca de região DA PESSOA no ar, voltando pra aplicada (NA → ROW): o
  // seletor é dela até a lista chegar (`cargaDePaises`), e o perfil não escreve nele.
  const r = pagina({ perfil: null });
  r.listas.paises = (rg) => Promise.resolve({ success: true, countries: LISTAS_R66[rg].map((c) => ({ ...c })) });
  await r.abrir();
  await trocarRegiao(r, 'na');
  const segurados = segurarPaises(r);
  const volta = trocarRegioes(r, ['row'])[0];
  await tique();
  assert.equal(r.els.filterCountry.dataset.carregando, '1', 'PRÉ-CONDIÇÃO: a volta pra ROW não está no ar');
  r.app.definirPerfil({ success: true, profile: { id: 1, editableCountryIDs: [30], managedAreas: [] } });
  assert.equal(r.els.filterCountry.mostrado, 'filters.carregando',
    `o perfil escreveu "${r.els.filterCountry.mostrado}" no seletor que a troca de região da pessoa segurava`);
  segurados[0].ok({ success: true, countries: LISTAS_R66.row.map((c) => ({ ...c })) });
  await volta;
  assert.deepEqual(telaDoPais(r), { opcoes: '30', pais: '30', dica: true }, 'a lista da volta não passou pela peneira do perfil');
  // A lista da abertura NÃO carregou (R7-6-04) e a pessoa foi à NA e voltou: o
  // seletor mostra a lista da volta, que o app não guardou (`AppState.countries`
  // segue vazio). O perfil não a troca por nada — antes, um seletor vazio.
  const v = pagina({ perfil: null });
  v.listas.paises = () => Promise.resolve({ success: false, errorCategory: 'transient' });
  await v.abrir();
  v.listas.paises = (rg) => Promise.resolve({ success: true, countries: LISTAS_R66[rg].map((c) => ({ ...c })) });
  await trocarRegiao(v, 'na');
  await trocarRegiao(v, 'row');
  const naVolta = telaDoPais(v);
  assert.deepEqual([naVolta.opcoes, v.AppState.countries.length], ['30,73,181', 0], 'PRÉ-CONDIÇÃO: a volta não mostra a lista sem guardá-la');
  v.app.definirPerfil({ success: true, profile: { id: 1, editableCountryIDs: [30], managedAreas: [] } });
  assert.deepEqual(telaDoPais(v), naVolta, `o perfil trocou a lista da tela por ${JSON.stringify(telaDoPais(v))}`);
});

// ═══ R8-6-03 · o 1º perfil que chega pela SONDA do 401 anota os editáveis ═══
// O perfil da abertura que leva um 401 passageiro (o blip do KV, o WAF) nunca
// anotava os editáveis, e o que a sonda do alarme falso trazia também não: com
// "Minha área", o país da área (`paisDaMinhaArea`) ficava desconhecido até
// recarregar — o Histórico gravava as decisões sem lugar e a carona marcava o
// país do filtro (MEDIDO no navegador, auditoria da rodada 8: pela sonda,
// `editaveisLidos('row') = null` e o ✕ no Histórico com `onde {}`; pela carga
// normal, `[73]` e `onde {"73":1}`). Aqui a carga e a sonda rodam DE VERDADE
// (`loadProfileAndAuxData` → `handleUnauthorized`), com a sonda segura até o
// teste soltar: os editáveis são do servidor em que ela PERGUNTOU, mesmo com
// outra região aplicada enquanto a resposta vinha.
function paginaDaSonda({ primeiroLeva401 = true } = {}) {
  const p = pagina({ regiao: 'row', pais: 30, filtros: { myArea: true } });
  const perfil = { id: 1, editableCountryIDs: [73], managedAreas: [] };
  let n = 0;
  let soltarSonda = null;
  p.listas.perfil = () => {
    n++;
    if (primeiroLeva401 && n === 1) return Promise.resolve({ success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.sessionMissing' });
    if (primeiroLeva401 && n === 2) return new Promise((ok) => { soltarSonda = () => ok({ success: true, profile: perfil }); });
    return Promise.resolve({ success: true, profile: perfil });
  };
  Object.assign(p.deps, { VERIFICA_SESSAO_MS: 0, verificandoSessao: false, sessaoVivaEm: { s: null, em: 0 },
    caixaDaMinhaArea: () => [2.2, 48.8, 2.5, 48.9] });
  p.AppState.authenticated = true;
  let sonda = null;
  p.deps.setTimeout = (f) => { sonda = f; return 1; };   // a sonda espera o teste
  const app = montar([...FUNCOES, 'handleUnauthorized', 'paisDaMinhaArea', 'ondeAgora'], p.deps);
  return { p, app, sonda: () => sonda, soltarSonda: () => soltarSonda() };
}

test('R8-6-03: o 1º perfil que chega pela sonda do alarme falso anota os editáveis — "Minha área" sabe o país da área sem recarregar', async () => {
  // CONTROLE: pela carga normal, o instrumento enxerga a anotação.
  const c = paginaDaSonda({ primeiroLeva401: false });
  await c.app.loadProfileAndAuxData();
  await tique(5);
  assert.deepEqual([c.app.editaveisLidos('row'), c.app.paisDaMinhaArea(), c.app.ondeAgora()], [[73], 73, '73'],
    'CONTROLE: a carga normal não anotou os editáveis (o instrumento não mede a anotação)');
  // O 1º perfil leva o 401; a sonda traz o perfil.
  const m = paginaDaSonda();
  await m.app.loadProfileAndAuxData();
  assert.ok(m.sonda(), 'PRÉ-CONDIÇÃO: o 401 do perfil não armou a sonda do alarme falso');
  assert.equal(m.p.AppState.profile, null, 'PRÉ-CONDIÇÃO: o perfil da abertura entrou apesar do 401');
  m.sonda()();
  await tique(5);
  m.soltarSonda();
  await tique(10);
  assert.equal(m.p.AppState.profile && m.p.AppState.profile.id, 1, 'PRÉ-CONDIÇÃO: a sonda não trouxe o perfil');
  assert.deepEqual(m.app.editaveisLidos('row'), [73],
    'o perfil da sonda não anotou os editáveis: com "Minha área", o país da área fica desconhecido até recarregar');
  assert.equal(m.app.paisDaMinhaArea(), 73, 'com "Minha área", o país da área (a marca da carona) ficou desconhecido');
  assert.equal(m.app.ondeAgora(), '73', 'com "Minha área", o Histórico grava as decisões sem lugar');
  assert.deepEqual(m.p.log.getProfile, ['row', 'row'], 'a anotação custou um pedido de perfil a mais');
});

test('R8-6-03: os editáveis da sonda são do servidor em que ela PERGUNTOU — a região aplicada no meio não os leva', async () => {
  const m = paginaDaSonda();
  await m.app.loadProfileAndAuxData();
  m.sonda()();                                  // a sonda pergunta à ROW...
  await tique(5);
  aplicarLugar(m.p, 'na', 235);                  // ...e a pessoa aplica NA/EUA enquanto a resposta vem
  m.soltarSonda();
  await tique(10);
  assert.equal(m.p.AppState.profile && m.p.AppState.profile.id, 1, 'PRÉ-CONDIÇÃO: a sonda não trouxe o perfil');
  assert.deepEqual([m.p.estado.regiao, m.p.estado.pais], ['na', 235], 'PRÉ-CONDIÇÃO: o perfil da sonda desfez o lugar aplicado no meio');
  assert.equal(m.app.editaveisLidos('na'), null, 'os editáveis da ROW (a da sonda) foram anotados como os da NA');
  assert.deepEqual(m.app.editaveisLidos('row'), [73], 'os editáveis que a sonda leu na ROW não ficaram na ROW');
});

// ═══ R8-6-04 · a lista de países é UMA ida, dividida pela carga e pelos Filtros ═
// Pelo atalho do ícone (`/?action=filters`) os Filtros abrem com a carga da
// abertura no ar, e o `popularPaisEstado` só olhava se a lista já tinha
// CHEGADO: saíam dois `lista-paises` iguais — dois pedidos ao nosso `/api` (o
// free tier) e duas idas ao Waze (MEDIDO no navegador, auditoria da rodada 8:
// 2 pelo atalho; 1 com os Filtros abertos depois da carga). E com a ida dos
// Filtros falhando e a da carga dando certo, o seletor ficava em "Lista não
// carregou" com a lista na memória. Aqui a carga e a abertura dos Filtros rodam
// DE VERDADE, na ordem do atalho (a carga primeiro), com a lista segura.
test('R8-6-04: os Filtros abertos com a carga da abertura no ar não pedem a lista de países de novo — e mostram a que chega', async () => {
  const p = pagina({ regiao: 'row', pais: 30 });
  const { carga, soltar } = await cargaSegura(p);
  const abrindo = p.abrir();
  await tique();
  assert.equal(p.els.filterCountry.dataset.carregando, '1', 'PRÉ-CONDIÇÃO: os Filtros não abriram com a lista no ar');
  assert.deepEqual(p.log.listCountries, ['row'], `os Filtros abertos com a carga no ar pediram a lista de novo: ${p.log.listCountries}`);
  soltar.paises({ success: true, countries: BR_FR });
  await abrindo;
  assert.deepEqual(telaDoPais(p), { opcoes: '30,73', pais: '30', dica: false }, 'a lista que a carga trouxe não chegou ao seletor');
  soltar.perfil({ success: true, profile: { id: 1, editableCountryIDs: [30], managedAreas: [] } });
  await carga;
  await tique(5);
  assert.deepEqual(p.log.listCountries, ['row'], `a abertura pelo atalho custou ${p.log.listCountries.length} idas da lista`);
  // CONTROLE: com a ida da carga FALHANDO, os Filtros abertos depois pedem de
  // novo (o R7-6-04) — o instrumento conta a 2ª ida quando ela existe.
  const q = pagina({ regiao: 'row', pais: 30 });
  q.listas.paises = () => Promise.resolve({ success: false, errorCategory: 'transient' });
  q.listas.perfil = () => Promise.resolve({ success: true, profile: { id: 1, editableCountryIDs: [30], managedAreas: [] } });
  await q.app.loadProfileAndAuxData();
  await q.abrir();
  assert.deepEqual(q.log.listCountries, ['row', 'row'], 'CONTROLE: a lista que falhou na carga não foi pedida de novo pelos Filtros');
});

test('R8-6-04: a lista que a carga trouxe serve aos Filtros abertos ANTES de o perfil chegar — sem outra ida', async () => {
  // A carga guardava a lista só junto do perfil (`Promise.all`): os Filtros
  // abertos nesse meio a viam vazia e pediam outra.
  const p = pagina({ regiao: 'row', pais: 30 });
  const { carga, soltar } = await cargaSegura(p);
  soltar.paises({ success: true, countries: BR_FR });
  await tique(5);
  await p.abrir();                                   // o perfil ainda vem
  assert.equal(p.AppState.profile, null, 'PRÉ-CONDIÇÃO: o perfil já tinha chegado');
  assert.deepEqual(p.log.listCountries, ['row'], 'a lista que a carga trouxe não serviu aos Filtros abertos antes do perfil: outra ida');
  assert.deepEqual(telaDoPais(p), { opcoes: '30,73', pais: '30', dica: false });
  soltar.perfil({ success: true, profile: { id: 1, editableCountryIDs: [30], managedAreas: [] } });
  await carga;
});

test('R8-6-04: a ida de uma sessão não serve à seguinte — com o "Sair" no meio, a lista de quem entrou é pedida de novo, e a velha não entra', async () => {
  const p = pagina({ regiao: 'row', pais: 30 });
  const { carga, soltar } = await cargaSegura(p);   // a lista da sessão de antes fica no ar
  p.deps.epocaDaSessao++;                            // o "Sair" (ou a queda) e a sessão seguinte
  p.listas.paises = () => Promise.resolve({ success: true, countries: BR_FR.map((c) => ({ ...c })) });
  await p.abrir();
  assert.deepEqual(p.log.listCountries, ['row', 'row'],
    'os Filtros da sessão nova esperaram a ida da sessão que saiu (o 401 dela mandaria a sessão nova à conferência)');
  assert.deepEqual(telaDoPais(p), { opcoes: '30,73', pais: '30', dica: false });
  // A resposta da sessão de antes chega depois: não entra na memória da de agora.
  p.AppState.countries = [];
  soltar.paises({ success: true, countries: [{ id: 999, name: 'De quem saiu' }] });
  soltar.perfil({ success: true, profile: { id: 1, editableCountryIDs: [30], managedAreas: [] } });
  await carga;
  await tique(5);
  assert.deepEqual(p.AppState.countries, [], 'a lista da sessão que saiu entrou na memória da sessão de agora');
});

// ═══ R8-6-06 · "Minha área" de quem só edita noutro servidor ═══════════════
// O `paisDoPerfil` saía na 1ª linha com "Minha área", e a busca pela caixa da
// área vai ao servidor da REGIÃO: OUTRA conta entrando no mesmo aparelho (a
// renovação pela extensão, outra pessoa no navegador) herdava o "Minha área"
// ligado e a região da anterior, e quem só edita na NA seguia buscando a área
// dele no servidor da ROW — MEDIDO no navegador, a busca saía `row bbox` e o
// perfil só era perguntado na ROW; sem "Minha área", a mesma pessoa ia pra
// `na/235` (auditoria da rodada 8). Decisão do owner: com "Minha área", o
// perfil corrige a REGIÃO quando a lista daqui é vazia, e "Minha área" fica
// ligado; com a lista daqui cheia, nada muda. Aqui a carga do perfil roda DE
// VERDADE (`loadProfileAndAuxData` → `paisDoPerfil` → `irProPaisDoPerfil`).
function paginaMinhaArea({ myArea, editaveis }) {
  const p = pagina({ regiao: 'row', pais: 30, filtros: { myArea } });
  p.listas.perfil = (r) => Promise.resolve({ success: true,
    profile: { id: 1, editableCountryIDs: editaveis[r] || [], managedAreas: [] } });
  p.listas.paises = (r) => Promise.resolve({ success: true, countries: (r === 'na' ? LISTA_NA : BR_FR).map((c) => ({ ...c })) });
  // A caixa da área existe (sem ela, "Minha área" desliga e diz por quê), e a
  // área gerenciada salva não entra: a fila só é refeita pelo lugar.
  Object.assign(p.deps, { caixaDaMinhaArea: () => [-74.1, 40.6, -73.8, 40.9], esquecerAreaForaDoPerfil: () => false });
  return p;
}

test('R8-6-06: com "Minha área", quem só edita noutro servidor vai pra REGIÃO da área — "Minha área" fica, e sem aviso de país', async () => {
  const p = paginaMinhaArea({ myArea: true, editaveis: { na: [235] } });
  await p.app.loadProfileAndAuxData();
  await tique(5);
  assert.deepEqual(p.log.getProfile, ['row', 'na'], `o perfil não foi perguntado nos outros servidores: ${p.log.getProfile}`);
  assert.equal(p.estado.regiao, 'na',
    `"Minha área" seguiu buscando a caixa da área no servidor da ROW (${p.estado.regiao}/${p.estado.pais})`);
  assert.equal(p.estado.pais, 235, `o país ficou de outro servidor: ${p.estado.regiao}/${p.estado.pais}`);
  assert.equal(p.AppState.filters.myArea, true, '"Minha área" foi desligado');
  assert.equal(p.log.buscas, 1, 'a fila não foi refeita no servidor da área');
  assert.ok(!p.log.toasts.some((x) => x.includes('toast.paisDoPerfil')),
    `o aviso "Mostrando a fila de {país}" saiu com "Minha área", que segue mostrando a fila da área: ${p.log.toasts}`);
  assert.ok(p.log.dfato.some((d) => d.startsWith('pais.doPerfil:') && d.includes('"minhaArea":true')),
    `o diário não marca a ida pela região da área: ${p.log.dfato}`);
  // CONTROLE: sem "Minha área", a mesma pessoa vai pro mesmo lugar — com o aviso.
  const c = paginaMinhaArea({ myArea: false, editaveis: { na: [235] } });
  await c.app.loadProfileAndAuxData();
  await tique(5);
  assert.deepEqual([c.estado.regiao, c.estado.pais, c.log.buscas], ['na', 235, 1]);
  assert.ok(c.log.toasts.some((x) => x.includes('toast.paisDoPerfil')), 'CONTROLE: sem "Minha área", o aviso do país não saiu');
});

test('R8-6-06: com "Minha área" e a área NESTE servidor, nada muda — o país do filtro fica, e nenhum outro servidor é perguntado', async () => {
  const p = paginaMinhaArea({ myArea: true, editaveis: { row: [73] } });
  await p.app.loadProfileAndAuxData();
  await tique(5);
  assert.deepEqual([p.estado.regiao, p.estado.pais], ['row', 30], `"Minha área" teve o lugar trocado: ${p.estado.regiao}/${p.estado.pais}`);
  assert.deepEqual(p.log.getProfile, ['row'], 'perguntou a outro servidor com a lista daqui cheia');
  assert.deepEqual([p.log.buscas, p.log.toasts], [0, []]);
  // CONTROLE: sem "Minha área", o país vai pra França.
  const c = paginaMinhaArea({ myArea: false, editaveis: { row: [73] } });
  await c.app.loadProfileAndAuxData();
  await tique(5);
  assert.deepEqual([c.estado.regiao, c.estado.pais], ['row', 73]);
});
