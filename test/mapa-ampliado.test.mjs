// O MAPA AMPLIADO desenhado de verdade — auditoria de 2026-09-26.
//
// `test/mapa.test.mjs` cobre a conta (`mapaGrade`, `mapaEnquadrarAmpliado`);
// aqui é o que o `MapaLightbox` faz com ela: os métodos `desenhar` e
// `desenharMarcas` do app.js, fatiados do fonte, com o `mapaGrade` do
// js/mapa.js e só o DOM de mentira.
//  - L17: o tile que FALHA não é pedido de novo a cada quadro do arraste
//    (medido: 432 pedidos num arraste de 40 px, o mesmo tile até 30×).
//  - L16: o ponto que não cabe em zoom nenhum é DITO (o aviso do card) e a
//    legenda fala só do que está na tela.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const M = createRequire(import.meta.url)(new URL('../js/mapa.js', import.meta.url).pathname);

function fechar(txt, i) {
  let prof = 0;
  for (let j = txt.indexOf('{', i); j < txt.length; j++) {
    if (txt[j] === '{') prof++;
    else if (txt[j] === '}' && --prof === 0) return j + 1;
  }
  throw new Error('não fechou');
}
function fatiar(nome) {
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  return APP_SEM.slice(m.index, fechar(APP_SEM, i));
}
function metodo(nome) {
  const ini = APP_SEM.indexOf('const MapaLightbox = {');
  const m = new RegExp('^    ' + nome + '\\(', 'm').exec(APP_SEM.slice(ini));
  assert.ok(m, `MapaLightbox.${nome} sumiu`);
  const i = ini + m.index;
  return APP_SEM.slice(i, fechar(APP_SEM, APP_SEM.indexOf(')', i))).trim();
}

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.className = ''; this._t = ''; this.dataset = {}; this.pai = null;
    this.attrs = {}; this.classes = new Set(); }
  // Atributos e classes, pro que o `close` e os botões do zoom escrevem (R7-1-02, R7-3-09).
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  set href(v) { this.attrs.href = String(v); }
  get href() { return this.attrs.href || ''; }
  // O `title` (o nome no marcador) anda com o atributo, como no DOM.
  set title(v) { this.attrs.title = String(v); }
  get title() { return this.attrs.title || ''; }
  get classList() {
    const c = this.classes;
    return { add: (x) => c.add(x), remove: (x) => c.delete(x), contains: (x) => c.has(x), toggle: (x, v) => (v ?? !c.has(x) ? c.add(x) : c.delete(x)) };
  }
  appendChild(c) { this.children.push(c); c.pai = this; return c; }
  remove() { if (this.pai) this.pai.children = this.pai.children.filter((x) => x !== this); this.pai = null; }
  set textContent(v) { this._t = v; this.children = []; }
  get textContent() { return this._t + this.children.map((c) => c.textContent || '').join(''); }
}

function mapa({ w = 412, h = 915 } = {}) {
  const els = { mapaLightbox: Object.assign(new El('div'), { clientWidth: w, clientHeight: h }),
    mapaLbTiles: new El('div'), mapaLbMarks: new El('div'), mapaLbEscala: new El('span'), mapaLbLegenda: new El('span'),
    mapaLbMais: new El('button'), mapaLbMenos: new El('button') };
  const criados = [];
  class Image extends El { constructor() { super('img'); criados.push(this); } }
  const deps = {
    document: { getElementById: (id) => els[id] || null, createElement: (tag) => new El(tag), createTextNode: (x) => ({ textContent: x }) },
    Image, mapaGrade: M.mapaGrade, mapaEscala: M.mapaEscala, window: { mapaEscala: M.mapaEscala },
    API: { getRegion: () => 'row' }, registrarFalhaDeTile: () => {}, t: (k, v) => (v ? `${k}${JSON.stringify(v)}` : k),
    i18nLocale: () => 'pt-BR', innerWidth: w, innerHeight: h, ESCALA_ALVO_AMPLIADO_PX: 112,
    MAPA_Z_NAV_MAX: M.MAPA_Z_NAV_MAX, MAPA_Z_NAV_MIN: M.MAPA_Z_NAV_MIN,
  };
  const helpers = ['escreverEscala', 'avisoForaDoMapa', 'formatarMetros', 'distanciaKm'].map(fatiar).join('\n');
  const obj = new Function(...Object.keys(deps), helpers + `\nreturn {
    centro: null, z: 16, pontos: [], _tiles: new Map(), _falhos: new Set(), _fora: [],
    atualizarStreetView() {},
    ${metodo('atualizarLimitesDoZoom')},
    ${metodo('desenhar')},
    ${metodo('desenharMarcas')}
  };`)(...Object.values(deps));
  return { obj, els, criados };
}

test('L17 o tile que FALHOU não é pedido de novo a cada quadro do arraste', () => {
  const { obj, els, criados } = mapa();
  Object.assign(obj, { centro: [-22.38, -42.56], z: 17, pontos: [{ ll: [-22.38, -42.56], cls: 'mapa-atual', rot: 'card.map.aqui' }] });
  obj.desenhar();
  const n = criados.length;
  assert.ok(n >= 4, `CONTROLE: a grade pediu só ${n} tiles`);
  for (const im of criados.slice()) im.onerror();          // todos dão 404
  assert.equal(els.mapaLbTiles.children.length, 0, 'a <img> quebrada ficou no DOM (gotcha #55)');
  for (let q = 0; q < 5; q++) obj.desenhar();              // 5 quadros de arraste
  assert.equal(criados.length, n, `${criados.length - n} tiles pedidos DE NOVO depois de falhar (um por quadro)`);
  assert.equal(els.mapaLbTiles.children.length, 0);
  // E reabrir tenta de novo: o `open` esquece o que falhou.
  assert.match(metodo('open'), /this\._falhos\.clear\(\);/, 'reabrir o mapa não tenta de novo os tiles que falharam');
});

// Um movimento de 2.510 km leste-oeste (o caso medido): não cabe nem no z4.
const LOCAL = [-23.55, -46.63], LONGE = [-23.55, -22.0];
const pontos = () => [
  { ll: LOCAL, cls: 'mapa-atual', rot: 'card.map.antes' },
  { ll: LONGE, cls: 'mapa-proposto', rot: 'card.map.depois', fora: 'card.map.foraDoMapa', distM: 2510000 },
];
const legenda = (els) => els.mapaLbLegenda.children.map((s) => s.children[1].textContent);
const aviso = (els) => (els.mapaLbMarks.children.find((e) => e.className === 'mapa-fora') || {}).textContent || null;

test('L16 o ponto que não cabe em zoom nenhum: o ampliado AVISA, e a legenda não o promete', () => {
  const { obj, els } = mapa();
  const enq = M.mapaEnquadrarAmpliado(pontos().map((p) => p.ll), 412, 915, 'row');
  assert.deepEqual(enq.foraDoMapa, [1], 'PRÉ-CONDIÇÃO: o ponto longe tinha que não caber');
  Object.assign(obj, { centro: enq.centro, z: enq.z, pontos: pontos(), _fora: enq.foraDoMapa });
  obj.desenhar();
  assert.match(aviso(els) || '', /^card\.map\.foraDoMapa\{/, `o ampliado não disse que a proposta ficou fora: ${aviso(els)}`);
  assert.match(aviso(els) || '', /2[.,\u00a0 ]?510/, 'o aviso não traz a distância');
  assert.deepEqual(legenda(els), ['card.map.antes'], 'a legenda prometeu o marcador que está a 2.500 km, fora da tela');
  // Arrastando até o ponto longe, ele entra na tela: o aviso sai e a legenda o ganha.
  obj.centro = LONGE.slice();
  obj.desenhar();
  assert.equal(aviso(els), null, 'o aviso ficou com o ponto NA TELA');
  assert.deepEqual(legenda(els), ['card.map.depois']);
});

test('L16 CONTROLE: o pedido que cabe não ganha aviso, e a legenda tem os dois', () => {
  const { obj, els } = mapa();
  const perto = [LOCAL, [LOCAL[0] + 0.0004, LOCAL[1]]];
  const ps = pontos(); ps[1].ll = perto[1];
  const enq = M.mapaEnquadrarAmpliado(perto, 412, 915, 'row');
  Object.assign(obj, { centro: enq.centro, z: enq.z, pontos: ps, _fora: enq.foraDoMapa });
  obj.desenhar();
  assert.equal(aviso(els), null);
  assert.deepEqual(legenda(els), ['card.map.antes', 'card.map.depois']);
});

// ── R7-3-09: o "+" no zoom MÁXIMO e o "−" no MÍNIMO parecem travados ─────────
// (auditoria de 2026-10-02). O `zoom` sai calado no limite, e os dois botões
// seguiam com cara de vivos — o toque não fazia nada (MEDIDO nos dois motores).
// `aria-disabled` (o `disabled` tiraria o foco de quem chegou pelo teclado) e o
// esmaecido do CSS, escritos pelo `desenhar()`, por onde todo zoom passa.
test('R7-3-09 no zoom máximo o "+" e no mínimo o "−" ficam aria-disabled (e esmaecidos), sem perder o foco', () => {
  const { obj, els } = mapa();
  const ps = [{ ll: LOCAL, cls: 'mapa-atual', rot: 'card.map.aqui' }];
  const estado = () => [els.mapaLbMais.getAttribute('aria-disabled'), els.mapaLbMenos.getAttribute('aria-disabled')];
  Object.assign(obj, { centro: LOCAL.slice(), z: 17, pontos: ps });
  obj.desenhar();
  assert.deepEqual(estado(), [null, null], 'CONTROLE: no meio do alcance, um dos botões nasceu travado');
  obj.z = M.MAPA_Z_NAV_MAX; obj.desenhar();
  assert.deepEqual(estado(), ['true', null], `DEFEITO: no zoom máximo (${M.MAPA_Z_NAV_MAX}) o "+" segue com cara de vivo`);
  obj.z = M.MAPA_Z_NAV_MIN; obj.desenhar();
  assert.deepEqual(estado(), [null, 'true'], `DEFEITO: no zoom mínimo (${M.MAPA_Z_NAV_MIN}) o "−" segue com cara de vivo (ou o "+" não voltou)`);
  obj.z = 17; obj.desenhar();
  assert.deepEqual(estado(), [null, null], 'saindo do limite, o botão seguiu travado');
  // `aria-disabled`, NUNCA `disabled`: este tira o foco de quem chegou ali pelo teclado.
  assert.ok(!('disabled' in els.mapaLbMais.attrs) && els.mapaLbMais.disabled === undefined, 'o "+" virou `disabled`');
  assert.doesNotMatch(metodo('atualizarLimitesDoZoom'), /\.disabled\s*=/, 'o limite do zoom passou a escrever `disabled`');
  // O esmaecido mora no CSS que o app CARREGA (o gerado), o mesmo dos outros travados.
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  for (const id of ['mapaLbMais', 'mapaLbMenos']) {
    assert.match(css, new RegExp(`#${id}\\[aria-disabled=(?:"true"|true)\\][^{]*\\{[^}]*opacity:\\s*\\.4`),
      `o #${id} travado não esmaece no css/app.css (rode npm run css)`);
  }
});

// ── R7-1-02: fechar o mapa ampliado SOLTA o pedido — o DOM e a memória ──────
// (auditoria de 2026-10-02). Depois do "Sair", o mapa ampliado guardava no DOM o
// nome do local duplicado e o das entradas (o `title` dos marcadores), o link
// do Street View com a coordenada do pedido e os tiles da área, e na memória os
// pontos: o relatório do modo dev da próxima conta os levava (o DOM vai inteiro).
// O `open`, o `close`, o `desenhar` e os gestos de VERDADE.
function mapaQueFecha() {
  const els = { mapaLightbox: Object.assign(new El('div'), { clientWidth: 412, clientHeight: 915 }),
    mapaLbTiles: new El('div'), mapaLbMarks: new El('div'), mapaLbEscala: new El('span'), mapaLbLegenda: new El('span'),
    mapaLbMais: new El('button'), mapaLbMenos: new El('button'), mapaLbStreetView: new El('a'), mapaLbClose: new El('button') };
  els.mapaLightbox.classes.add('hidden');
  els.mapaLbClose.focus = () => {};
  const criados = [];
  class Image extends El { constructor() { super('img'); criados.push(this); } }
  const log = [];
  const deps = {
    document: { getElementById: (id) => els[id] || null, createElement: (tag) => new El(tag), createTextNode: (x) => ({ textContent: x }),
      body: { style: {} }, activeElement: null },
    Image, mapaGrade: M.mapaGrade, mapaEscala: M.mapaEscala, mapaEnquadrarAmpliado: M.mapaEnquadrarAmpliado,
    window: { mapaEscala: M.mapaEscala, mapaGrade: M.mapaGrade },
    API: { getRegion: () => 'row' }, registrarFalhaDeTile: () => {}, t: (k, v) => (v ? `${k}${JSON.stringify(v)}` : k),
    i18nLocale: () => 'pt-BR', innerWidth: 412, innerHeight: 915, ESCALA_ALVO_AMPLIADO_PX: 112,
    MAPA_Z_NAV_MAX: M.MAPA_Z_NAV_MAX, MAPA_Z_NAV_MIN: M.MAPA_Z_NAV_MIN, STREET_VIEW_URL: 'https://www.google.com/maps/@',
    CamadaVoltar: { empilhar() {}, consumir() { log.push('consumiu'); } },
    devolverFocoDaAmpliacao: () => log.push('foco'),
    // Os pontos do pedido (os nomes são de TERCEIRO: o duplicado e a entrada).
    pontosDoMapa: (p) => [{ ll: p.mapa.centro, cls: 'mapa-atual', rot: 'card.map.aqui' },
      { ll: [p.mapa.centro[0] + 0.0002, p.mapa.centro[1]], cls: 'mapa-entrada mapa-e-nova', rot: 'card.map.entradaNova', nome: 'EntradaPRIV' },
      { ll: [p.mapa.centro[0] + 0.0009, p.mapa.centro[1] - 0.0009], cls: 'mapa-duplicado', rot: 'card.map.duplicado', nome: 'DuplicadoPRIV' }],
  };
  const helpers = ['escreverEscala', 'avisoForaDoMapa', 'formatarMetros', 'distanciaKm', 'linkStreetView'].map(fatiar).join('\n');
  const obj = new Function(...Object.keys(deps), helpers + `\nreturn {
    centro: null, z: 16, pontos: [], _tiles: new Map(), _falhos: new Set(), _fora: [], _inicial: null, _local: null,
    isOpen() { return !document.getElementById('mapaLightbox').classList.contains('hidden'); },
    ${['open', 'close', 'pontoDoStreetView', 'atualizarStreetView', 'atualizarLimitesDoZoom', 'desenhar', 'desenharMarcas',
    'arrastar', 'zoom', 'recentrar'].map(metodo).join(',\n')}
  };`)(...Object.values(deps));
  // A VARREDURA: texto e atributos de tudo que a camada guarda, pela marca.
  const varrer = () => {
    const achou = [];
    const visitar = (e, onde) => {
      if (!e) return;
      if (String(e.textContent || '').includes('PRIV')) achou.push(onde + ':texto');
      for (const [k, v] of Object.entries(e.attrs || {})) if (String(v).includes('PRIV')) achou.push(`${onde}:${k}`);
      for (const c of e.children || []) visitar(c, onde);
    };
    for (const [id, e] of Object.entries(els)) visitar(e, id);
    return achou;
  };
  return { obj, els, criados, log, varrer };
}
const PEDIDO_DUP = { venueID: 'v1', updateRequestID: 'u1', mapa: { centro: [-23.5, -46.6], proposto: null, movidoM: null, entradas: [] } };

test('R7-1-02 fechar o mapa ampliado tira do DOM e da memória o que era do pedido (nomes, Street View, tiles, pontos)', () => {
  const m = mapaQueFecha();
  m.obj.open(PEDIDO_DUP);
  assert.equal(m.obj.isOpen(), true, 'PRÉ-CONDIÇÃO: o mapa não abriu');
  // CONTROLE: aberto, a varredura ENXERGA os nomes de terceiro nos marcadores,
  // e há tiles, o link do Street View com a coordenada e os pontos na memória.
  assert.ok(m.varrer().some((x) => x.startsWith('mapaLbMarks')), 'CONTROLE: a varredura não viu os nomes nos marcadores (ela está cega)');
  assert.ok(m.els.mapaLbTiles.children.length > 0, 'CONTROLE: o mapa abriu sem tiles');
  assert.match(m.els.mapaLbStreetView.getAttribute('href') || '', /viewpoint=-23\.5/, 'CONTROLE: o Street View sem a coordenada do pedido');
  assert.equal(m.obj.pontos.length, 3, 'CONTROLE: os pontos do pedido não estão na memória');
  m.obj.close();
  assert.equal(m.obj.isOpen(), false);
  assert.deepEqual(m.varrer(), [], 'DEFEITO: o mapa FECHADO seguiu com o nome do duplicado e das entradas no DOM');
  assert.equal(m.els.mapaLbTiles.children.length, 0, 'DEFEITO: os tiles da área ficaram no mapa fechado');
  assert.equal(m.els.mapaLbLegenda.children.length, 0, 'a legenda do pedido ficou no mapa fechado');
  assert.equal(m.els.mapaLbStreetView.getAttribute('href'), null, 'DEFEITO: o link do Street View guardou a coordenada do pedido');
  assert.deepEqual([m.obj.pontos, m.obj._fora, m.obj._local, m.obj._inicial, m.obj.centro, m.obj._tiles.size],
    [[], [], null, null, null, 0], 'DEFEITO: a memória guardou os pontos do pedido depois de fechar');
  assert.deepEqual(m.log, ['consumiu', 'foco'], 'fechar deixou de consumir o voltar ou de devolver o foco');
  // O que chega DEPOIS de fechar (o quadro de um arraste no ar, o duplo toque
  // que solta o dedo, a tecla) não desenha a camada escondida nem quebra.
  const n = m.criados.length;
  m.obj.arrastar(40, 0); m.obj.zoom(1, 10, 10); m.obj.desenhar(); m.obj.recentrar();
  assert.equal(m.criados.length, n, 'o gesto que chegou depois de fechar pediu tiles pra camada escondida');
  assert.deepEqual(m.varrer(), [], 'o gesto que chegou depois de fechar redesenhou os marcadores');
  // E reabrir monta tudo de novo, do zero.
  m.obj.open(PEDIDO_DUP);
  assert.ok(m.varrer().some((x) => x.startsWith('mapaLbMarks')) && m.els.mapaLbTiles.children.length > 0,
    'reabrir não montou o mapa de novo');
});
