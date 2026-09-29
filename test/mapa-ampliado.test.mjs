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
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.className = ''; this._t = ''; this.dataset = {}; this.pai = null; }
  appendChild(c) { this.children.push(c); c.pai = this; return c; }
  remove() { if (this.pai) this.pai.children = this.pai.children.filter((x) => x !== this); this.pai = null; }
  set textContent(v) { this._t = v; this.children = []; }
  get textContent() { return this._t + this.children.map((c) => c.textContent || '').join(''); }
}

function mapa({ w = 412, h = 915 } = {}) {
  const els = { mapaLightbox: Object.assign(new El('div'), { clientWidth: w, clientHeight: h }),
    mapaLbTiles: new El('div'), mapaLbMarks: new El('div'), mapaLbEscala: new El('span'), mapaLbLegenda: new El('span') };
  const criados = [];
  class Image extends El { constructor() { super('img'); criados.push(this); } }
  const deps = {
    document: { getElementById: (id) => els[id] || null, createElement: (tag) => new El(tag), createTextNode: (x) => ({ textContent: x }) },
    Image, mapaGrade: M.mapaGrade, mapaEscala: M.mapaEscala, window: { mapaEscala: M.mapaEscala },
    API: { getRegion: () => 'row' }, registrarFalhaDeTile: () => {}, t: (k, v) => (v ? `${k}${JSON.stringify(v)}` : k),
    i18nLocale: () => 'pt-BR', innerWidth: w, innerHeight: h, ESCALA_ALVO_AMPLIADO_PX: 112,
  };
  const helpers = ['escreverEscala', 'avisoForaDoMapa', 'formatarMetros', 'distanciaKm'].map(fatiar).join('\n');
  const obj = new Function(...Object.keys(deps), helpers + `\nreturn {
    centro: null, z: 16, pontos: [], _tiles: new Map(), _falhos: new Set(), _fora: [],
    atualizarStreetView() {},
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
