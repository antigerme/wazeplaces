// O MINI-MAPA DO CARD desenhado de verdade — auditoria de 2026-09-26.
//
// `test/mapa.test.mjs` cobre a conta (`mapaMontar`); aqui é o que a conta vira
// na tela: qual marcador sai com qual cor, se a linha do movimento liga os
// pontos certos, o que a legenda promete e o que o aviso de "fora deste mapa"
// diz. O `renderMapa` e o `pontosDoMapa` são os do app.js, fatiados do fonte, e
// o `mapaMontar` é o do js/mapa.js; só o DOM é de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const M = createRequire(import.meta.url)(new URL('../js/mapa.js', import.meta.url).pathname);

function fatiar(nome) {
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', i); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) return APP_SEM.slice(m.index, j + 1);
  }
  throw new Error('não fechou ' + nome);
}

// Um DOM mínimo: elemento com filhos, classe, estilo e texto.
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.className = ''; this.title = ''; this._t = ''; this.dataset = {}; }
  appendChild(c) { this.children.push(c); return c; }
  set textContent(v) { this._t = v; this.children = []; }
  get textContent() { return this._t + this.children.map((c) => c.textContent || '').join(''); }
}
const t = (k, v) => (v ? `${k}${JSON.stringify(v)}` : k);

function desenhar(mapa, { w = 359, h = 200, extra = {} } = {}) {
  const partes = { '.card-map-tiles': new El('div'), '.card-map-marks': new El('div'),
    '.card-map-scale': new El('span'), '.card-map-legend': new El('span') };
  const box = Object.assign(new El('div'), { clientWidth: w, clientHeight: h,
    classList: { contains: () => false }, querySelector: (s) => partes[s] });
  const card = { querySelector: (s) => (s === '.card-map' ? box : null) };
  const deps = {
    document: { createElement: (tag) => new El(tag), createTextNode: (x) => ({ textContent: x }) },
    window: { mapaMontar: M.mapaMontar }, mapaMontar: M.mapaMontar,
    Image: class extends El { constructor() { super('img'); } },
    API: { getRegion: () => 'row' }, t, i18nLocale: () => 'pt-BR',
    vigiarCaixaDoMapa() {}, registrarFalhaDeTile() {},
  };
  const nomes = ['pontosDoMapa', 'avisoForaDoMapa', 'formatarMetros', 'distanciaKm', 'renderMapa'];
  const renderMapa = new Function(...Object.keys(deps), nomes.map(fatiar).join('\n') + '\nreturn renderMapa;')(
    ...Object.values(deps));
  renderMapa(card, { mapa, ...extra }, true);
  const marks = partes['.card-map-marks'].children;
  return {
    marcadores: marks.filter((e) => /mapa-marca/.test(e.className)).map((e) => e.className.replace('mapa-marca ', '')),
    linha: marks.find((e) => e.className === 'mapa-linha') || null,
    aviso: (marks.find((e) => e.className === 'mapa-fora') || {}).textContent || null,
    legenda: partes['.card-map-legend'].children.map((s) => s.children[1].textContent),
  };
}

const A = [-22.0162, -47.5688];
const aNorte = (metros) => [A[0] + metros / 111320, A[1]];

test('C11 proposta a 5 m e entrada a 30 km: a proposta FICA no mapa e o aviso fala da ENTRADA', () => {
  // MEDIDO no card antes do conserto: só o marcador do local, legenda "antes" e
  // o aviso "⚠ a posição proposta está a 5 m — fora deste mapa".
  const d = desenhar({ centro: A, proposto: aNorte(5), movidoM: 5,
    entradas: [{ ll: aNorte(30000), estado: 'nova', nome: 'Entrada', distM: 30000 }] });
  assert.deepEqual(d.marcadores, ['mapa-atual', 'mapa-proposto'], 'a proposta a 5 m sumiu do mapa');
  assert.ok(d.linha, 'a linha do movimento sumiu com as duas pontas na tela');
  assert.deepEqual(d.legenda, ['card.map.antes', 'card.map.depois']);
  assert.match(d.aviso || '', /^card\.map\.foraDoMapa\.entrada/, `o aviso não diz que é a ENTRADA que ficou fora: ${d.aviso}`);
  assert.match(d.aviso || '', /30/, 'o aviso não traz a distância da entrada');
});

test('C11 proposta LONGE e entrada perto: a entrada sai com a cor DELA, e não há linha até ela', () => {
  // O casamento por posição (`pontos[k]`) punha o marcador da entrada com a cor
  // da proposta e puxava a linha do movimento até a entrada.
  const d = desenhar({ centro: A, proposto: aNorte(82000), movidoM: 82000,
    entradas: [{ ll: aNorte(20), estado: 'nova', nome: 'Portão', distM: 20 }] });
  assert.deepEqual(d.marcadores, ['mapa-atual', 'mapa-entrada mapa-e-nova'], 'a entrada saiu com a cor de outro ponto');
  assert.equal(d.linha, null, 'a linha do movimento foi desenhada até a ENTRADA');
  assert.deepEqual(d.legenda, ['card.map.antes', 'card.map.entrada.nova']);
  assert.match(d.aviso || '', /^card\.map\.foraDoMapa\{/, `o aviso não fala da posição proposta: ${d.aviso}`);
  assert.match(d.aviso || '', /82/);
});

test('C11 o duplicado longe, SEM distância medida: o aviso a calcula do local', () => {
  const d = desenhar({ centro: A, entradas: [] }, { extra: { duplicado: { ll: aNorte(40000), nome: 'Outro', distM: null } } });
  assert.deepEqual(d.marcadores, ['mapa-atual']);
  assert.match(d.aviso || '', /^card\.map\.foraDoMapa\.duplicado/, `o aviso não fala do duplicado: ${d.aviso}`);
  assert.match(d.aviso || '', /40/, 'a distância não foi calculada do local');
});

test('C11 CONTROLE: tudo cabendo, todos os marcadores, a linha, e nenhum aviso', () => {
  const d = desenhar({ centro: A, proposto: aNorte(36), movidoM: 36,
    entradas: [{ ll: aNorte(15), estado: 'saindo', nome: null, distM: 15 }] });
  assert.deepEqual(d.marcadores, ['mapa-atual', 'mapa-proposto', 'mapa-entrada mapa-e-saindo']);
  assert.ok(d.linha);
  assert.equal(d.aviso, null, 'aviso de "fora do mapa" com tudo dentro');
});

test('C4 o mapa ampliado abre pelo enquadramento que MOSTRA os pontos', () => {
  // O conteúdo da conta é testado em mapa.test.mjs; aqui, que o `open` a usa —
  // e não volta ao zoom do card com o centro no meio de tudo.
  const ini = APP_SEM.indexOf('const MapaLightbox = {');
  const open = APP_SEM.slice(ini, APP_SEM.indexOf('\n    close(', ini));
  assert.match(open, /const enq = mapaEnquadrarAmpliado\(this\.pontos\.map\(\(p\) => p\.ll\), innerWidth, innerHeight, API\.getRegion\(\)\);/,
    'o mapa ampliado deixou de abrir pelo `mapaEnquadrarAmpliado`');
  assert.match(open, /this\.z = enq\.z;\s*this\.centro = enq\.centro\.slice\(\);/, 'o open não usa o zoom E o centro do mesmo enquadramento');
  assert.ok(!/mapaMontar\(/.test(open), 'o open voltou a tirar o zoom da conta do card, que enquadra só o primeiro ponto');
});

// ── C5: a caixa que ENCOLHE também refaz o mapa ────────────────────────────
function vigia() {
  let aoMudar = null;
  const quadros = [];
  const refeitos = [];
  const deps = {
    ResizeObserver: class { constructor(fn) { aoMudar = fn; } observe() {} },
    requestAnimationFrame: (fn) => { quadros.push(fn); return quadros.length; },
    renderMapa: (card, place, refazendo) => {
      refeitos.push(refazendo);
      box.dataset.mapaW = String(box.clientWidth);   // como o renderMapa de verdade
      box.dataset.mapaH = String(box.clientHeight);
    },
  };
  const box = { clientWidth: 378, clientHeight: 305, dataset: { mapaW: '378', mapaH: '305' } };
  new Function(...Object.keys(deps), fatiar('vigiarCaixaDoMapa') + '\nreturn vigiarCaixaDoMapa;')(
    ...Object.values(deps))(box, {}, {});
  const mudar = (w, h) => { box.clientWidth = w; box.clientHeight = h; aoMudar(); };
  const quadro = () => { while (quadros.length) quadros.shift()(); };
  return { box, mudar, quadro, refeitos, quadros };
}

test('C5 girar o aparelho (a caixa ENCOLHE) refaz o mini-mapa — e crescer segue refazendo', () => {
  // MEDIDO: retrato 378×305 → deitado 267×212, e o Fold 246×135 — o marcador
  // desenhado pra caixa maior ficava fora da caixa e não voltava.
  const v = vigia();
  v.mudar(267, 212);
  assert.equal(v.refeitos.length, 0, 'o observer escreveu no MESMO quadro da notificação (gotcha #35)');
  v.quadro();
  assert.equal(v.refeitos.length, 1, 'a caixa encolheu e o mapa não foi refeito: marcador fora da caixa');
  v.mudar(400, 320);
  v.quadro();
  assert.equal(v.refeitos.length, 2, 'CONTROLE: a caixa cresceu e o mapa não foi refeito');
});

test('C5 CONTROLE: sem mudança de tamanho não refaz (nada de laço), e caixa escondida não conta', () => {
  const v = vigia();
  v.mudar(378, 305);
  v.quadro();
  assert.equal(v.refeitos.length, 0, 'refez o mapa sem a caixa mudar — custo por quadro pra sempre');
  // Duas notificações antes do quadro viram UM redesenho.
  v.mudar(300, 250); v.mudar(290, 240);
  assert.equal(v.quadros.length, 1, 'duas notificações agendaram dois redesenhos');
  v.quadro();
  assert.equal(v.refeitos.length, 1);
  // Depois de refazer, o tamanho bate: a notificação seguinte não refaz de novo.
  v.mudar(290, 240);
  v.quadro();
  assert.equal(v.refeitos.length, 1, 'refez de novo com o tamanho igual ao do desenho — é o laço');
  v.mudar(0, 0);
  v.quadro();
  assert.equal(v.refeitos.length, 1, 'a caixa escondida (0×0) refez o mapa');
});
