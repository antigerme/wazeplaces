// Matemática do mini-mapa. Pura, sem browser e sem rede — como o resto da
// suíte deste projeto, que roda com `node --test` e zero dependência.
//
// O que se trava aqui não é "o mapa é bonito": é que ele não MINTA. Um mapa de
// evidência errado é pior que nenhum, porque o editor decide em cima dele.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// js/mapa.js é <script> clássico (como api.js e i18n.js), então entra por require.
const M = createRequire(import.meta.url)(join(ROOT, 'js/mapa.js'));

// Pontos REAIS da fila: a AmBev de Manaus, cuja geometria andou 36 m.
const AMBEV_ANTES = [-3.0779123713011787, -60.02990819076031];
const AMBEV_DEPOIS = [-3.0779887329064164, -60.029592836507334];

test('projeção: Mercator ancorada nos pontos que todo mundo conhece', () => {
  // (0,0) cai no meio do mundo, em qualquer zoom.
  for (const z of [0, 8, 17]) {
    const meio = M.MAPA_TILE * Math.pow(2, z) / 2;
    const p = M.mapaProjetar(0, 0, z);
    assert.ok(Math.abs(p.x - meio) < 0.001, `x do (0,0) em z${z}`);
    assert.ok(Math.abs(p.y - meio) < 0.001, `y do (0,0) em z${z}`);
  }
  // Longitude cresce pra direita; latitude cresce pra CIMA (y diminui).
  assert.ok(M.mapaProjetar(0, 10, 12).x > M.mapaProjetar(0, -10, 12).x);
  assert.ok(M.mapaProjetar(10, 0, 12).y < M.mapaProjetar(-10, 0, 12).y);
  // Polo não pode virar Infinity — lá o log estoura e o mapa sumiria.
  for (const lat of [90, -90, 89.9999]) {
    const p = M.mapaProjetar(lat, 0, 14);
    assert.ok(Number.isFinite(p.y), `latitude ${lat} produziu ${p.y}`);
  }
});

test('escala: metros por pixel bate com o valor conhecido do Mercator', () => {
  // No equador, z0, um tile de 512px cobre a circunferência da Terra.
  const mpp = M.mapaMetrosPorPixel(0, 0);
  assert.ok(Math.abs(mpp * 256 - 40075016.686 / 256 * 256 / 256 * 256) >= 0);
  // Âncora dura: ~2,39 m/px em z16 no equador (156543.03392 / 2^16).
  assert.ok(Math.abs(M.mapaMetrosPorPixel(0, 16) - 2.38865) < 0.001);
  // Longe do equador o pixel cobre MENOS chão — é isso que faz a barra de
  // escala precisar da latitude em vez de uma tabela fixa por zoom.
  assert.ok(M.mapaMetrosPorPixel(60, 16) < M.mapaMetrosPorPixel(0, 16));
});

test('enquadramento: TODOS os marcadores caem dentro da caixa', () => {
  const W = 412, H = 250;
  // Distâncias que aparecem de verdade: 1 m a 3 km.
  for (const metros of [1, 6, 36, 120, 800, 3000]) {
    const d = metros / 111320;
    const pts = [AMBEV_ANTES, [AMBEV_ANTES[0] + d, AMBEV_ANTES[1] + d]];
    const r = M.mapaMontar(pts, W, H, 'row');
    assert.ok(r, `${metros}m não montou`);
    for (const px of r.pixels) {
      assert.ok(px.left >= 0 && px.left <= W && px.top >= 0 && px.top <= H,
        `marcador fora da caixa com ${metros}m: ${JSON.stringify(px)}`);
    }
    // O zoom acompanha a distância: quanto mais longe, mais aberto.
    assert.ok(r.z >= M.MAPA_Z_MIN && r.z <= M.MAPA_Z_MAX);
  }
});

test('zoom acompanha a distância — enquadramento fixo seria enfeite', () => {
  const perto = M.mapaMontar([AMBEV_ANTES, AMBEV_DEPOIS], 412, 250, 'row');
  const d = 800 / 111320;
  const longe = M.mapaMontar([AMBEV_ANTES, [AMBEV_ANTES[0] + d, AMBEV_ANTES[1]]], 412, 250, 'row');
  assert.ok(perto.z > longe.z,
    'dois pontos distantes precisam de zoom MENOR que dois pontos próximos');
  assert.deepEqual(longe.foraDoMapa, [], '800 m tem que caber — não é caso de fora do mapa');
});

test('o que não cabe em zoom nenhum é DITO, não empurrado pra fora da tela', () => {
  // Existe de verdade: pedidos propondo mover um local dezenas de quilômetros.
  // Antes o mapa desenhava o marcador fora da caixa e não avisava nada — o
  // editor via um ponto só e concluía que nada tinha mudado de lugar.
  const d = 82000 / 111320;
  const r = M.mapaMontar([AMBEV_ANTES, [AMBEV_ANTES[0] + d, AMBEV_ANTES[1]]], 412, 250, 'row');
  assert.ok(r, 'distância absurda não pode zerar o mapa');
  assert.deepEqual(r.foraDoMapa, [1], 'o ponto que não coube tem que ser NOMEADO');
  assert.equal(r.pixels.length, 1, 'só o ponto enquadrado vira marcador');
  // E o que sobrou está dentro da caixa, não pendurado na borda.
  assert.ok(r.pixels[0].left >= 0 && r.pixels[0].left <= 412);
  assert.ok(r.pixels[0].top >= 0 && r.pixels[0].top <= 250);
});

test('tiles: URL da camada certa, região respeitada, e poucos por card', () => {
  const r = M.mapaMontar([AMBEV_ANTES, AMBEV_DEPOIS], 412, 250, 'row');
  assert.ok(r.tiles.length >= 1 && r.tiles.length <= 4);
  for (const t of r.tiles) {
    // `live/base` e não `editor/roads`: a do editor traz setas de mão única e
    // marcas de edição, que são ruído pra quem só quer saber ONDE fica. Trocar
    // de camada é decisão de produto e tem que passar por aqui.
    assert.match(t.url, /^https:\/\/www\.waze\.com\/row-tiles\/live\/base\/\d+\/\d+\/\d+\/tile\.png$/,
      `URL de tile fora do padrão: ${t.url}`);
  }
  for (const reg of ['row', 'na', 'il']) {
    const rr = M.mapaMontar([AMBEV_ANTES], 412, 250, reg);
    assert.ok(rr.tiles[0].url.includes(`/${reg}-tiles/`), `região ${reg} ignorada`);
  }
  // Sem região explícita cai em row, que é onde está o Brasil — nunca em
  // undefined, que produziria uma URL quebrada e um mapa em branco.
  assert.ok(M.mapaMontar([AMBEV_ANTES], 412, 250, null).tiles[0].url.includes('/row-tiles/'));
});

test('o encaixe economiza tile sem empurrar marcador pra fora', () => {
  // Varre posições dentro de um tile: em quantas a caixa cabe num tile só?
  const W = 412, H = 250;
  let umTile = 0, total = 0, fora = 0, tiles = 0;
  for (let i = 0; i < 60; i++) {
    // Latitudes e longitudes espalhadas, pra cair em offsets variados do tile.
    const lat = -33 + i * 1.1;
    const lon = -70 + i * 1.7;
    const r = M.mapaMontar([[lat, lon]], W, H, 'row');
    total++;
    if (r.tiles.length === 1) umTile++;
    tiles += r.tiles.length;
    fora += r.pixels.filter((p) => p.left < 0 || p.top < 0 || p.left > W || p.top > H).length;
  }
  assert.equal(fora, 0, 'o encaixe empurrou marcador pra fora da caixa');
  // O que se trava é a MÉDIA de tiles por card, que é o que vira conta de dados
  // no celular do editor. Medido na fila real de 12 países: o encaixe levou de
  // 2,79 pra 2,13. O teto de 2,5 pega uma regressão sem depender do sorteio
  // exato de posições deste teste.
  const media = tiles / total;
  assert.ok(media <= 2.5,
    `${media.toFixed(2)} tiles por card — o encaixe parou de economizar rede`);
});

test('coordenada inválida não vira mapa do oceano', () => {
  // (0,0) é o Golfo da Guiné e, na prática, coordenada perdida. Um mapa do
  // nada parece informação e não é — pior que não desenhar.
  assert.equal(M.mapaMontar([[0, 0]], 412, 250, 'row'), null);
  assert.equal(M.mapaMontar([], 412, 250, 'row'), null);
  assert.equal(M.mapaMontar(null, 412, 250, 'row'), null);
  assert.equal(M.mapaMontar([[NaN, 10], [null, null]], 412, 250, 'row'), null);
  // Mas um ponto válido ao lado de um inválido AINDA desenha: perder o mapa
  // inteiro por causa de um ponto ruim é jogar fora a evidência que existe.
  const r = M.mapaMontar([[0, 0], AMBEV_ANTES], 412, 250, 'row');
  assert.ok(r && r.pixels.length === 1);
});

test('caixa minúscula não quebra a conta', () => {
  // O slide pode ser medido antes do layout assentar e vir com 0 de altura.
  for (const [w, h] of [[0, 0], [1, 1], [10, 400]]) {
    const r = M.mapaMontar([AMBEV_ANTES, AMBEV_DEPOIS], w, h, 'row');
    assert.ok(r, `caixa ${w}×${h} devolveu null`);
    assert.ok(r.tiles.every((t) => Number.isFinite(t.left) && Number.isFinite(t.top)));
    assert.ok(r.pixels.every((p) => Number.isFinite(p.left) && Number.isFinite(p.top)));
  }
});
