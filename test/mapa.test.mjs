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
  // No equador, z0, um tile de 512px cobre a circunferência da Terra (a do
  // WGS84, 40.075.016,686 m) — e é de 512 que a projeção do app é feita.
  const CIRC = 40075016.686;
  assert.ok(Math.abs(M.mapaMetrosPorPixel(0, 0) - CIRC / M.MAPA_TILE) < 0.01,
    `z0 no equador: ${M.mapaMetrosPorPixel(0, 0)} m/px, e um tile de ${M.MAPA_TILE}px cobre ${CIRC} m`);
  // Âncora dura: ~1,194 m/px em z16 no equador (40.075.016,686 / 512 / 2^16).
  // Esta linha ancorava 2,38865 — o valor da conta de tile de 256 px, que é o
  // DOBRO — e a de cima era `>= 0`, sempre verdadeira: o teste aprovava a
  // barra de escala que media o dobro (auditoria de 2026-09-26).
  assert.ok(Math.abs(M.mapaMetrosPorPixel(0, 16) - 1.19433) < 0.001,
    `z16 no equador: ${M.mapaMetrosPorPixel(0, 16)} m/px, esperado ~1,194`);
  // Longe do equador o pixel cobre MENOS chão — é isso que faz a barra de
  // escala precisar da latitude em vez de uma tabela fixa por zoom.
  assert.ok(M.mapaMetrosPorPixel(60, 16) < M.mapaMetrosPorPixel(0, 16));
});

// O oráculo INDEPENDENTE da conta: a distância no chão entre dois pontos
// (haversine, sem nada do app) dividida pela distância em pixels que a PRÓPRIA
// projeção do app põe entre eles. É a projeção que posiciona tile e marcador,
// então a escala só não mente se bater com ela — em qualquer zoom e latitude.
test('escala: m/px é o da PROJEÇÃO que desenha os marcadores (a barra não mede o dobro)', () => {
  const R = 6378137;   // raio equatorial do WGS84, o do Mercator da web
  const hav = (a, b) => {
    const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  for (const lat of [0, -12.9, -23.55, 38.7, 51.5, 60]) {
    for (const z of [4, 10, 13, 16, 17, 19]) {
      const a = [lat, 10], b = [lat, 10.0005];   // ~55 m leste-oeste no equador
      const px = M.mapaProjetar(b[0], b[1], z).x - M.mapaProjetar(a[0], a[1], z).x;
      const pelaProjecao = hav(a, b) / px;
      const daConta = M.mapaMetrosPorPixel(lat, z);
      assert.ok(Math.abs(daConta / pelaProjecao - 1) < 0.001,
        `lat ${lat} z${z}: a conta diz ${daConta.toFixed(4)} m/px e a projeção põe ${pelaProjecao.toFixed(4)} (${(daConta / pelaProjecao).toFixed(2)}×)`);
    }
  }
});

test('barra de escala: valor redondo, traço do tamanho do alvo, e medindo o que diz — em TODO zoom', () => {
  for (const alvo of [80, 112]) {
    for (const lat of [0, -23.55, 51.5, 64]) {
      for (let z = M.MAPA_Z_NAV_MIN; z <= M.MAPA_Z_NAV_MAX; z++) {
        const mpp = M.mapaMetrosPorPixel(lat, z);
        const e = M.mapaEscala(mpp, alvo);
        const onde = `alvo ${alvo}px, lat ${lat}, z${z} (${mpp.toFixed(2)} m/px)`;
        assert.ok(e, `${onde}: sem escala`);
        // 1, 2 ou 5 × 10^n: é o que se lê de relance.
        const mant = e.metros / Math.pow(10, Math.floor(Math.log10(e.metros) + 1e-9));
        assert.ok([1, 2, 5].some((k) => Math.abs(mant - k) < 1e-9), `${onde}: ${e.metros} m não é um valor redondo`);
        // O traço fica perto do alvo — com a lista que parava em 50 km, nos
        // zooms 4 a 6 ele encolhia pra 22–38 px, menor que o próprio texto.
        assert.ok(e.px >= alvo * 0.5 && e.px <= alvo * 1.5, `${onde}: traço de ${e.px}px pra um alvo de ${alvo}`);
        // E ele mede o que o rótulo diz (o arredondamento pro pixel inteiro é
        // o único erro que sobra).
        assert.ok(Math.abs(e.px * mpp - e.metros) <= mpp * 0.5 + 1e-9,
          `${onde}: o traço de ${e.px}px mede ${(e.px * mpp).toFixed(1)} m e o rótulo diz ${e.metros} m`);
      }
    }
  }
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

test('C11 um ponto longe NÃO derruba os que cabem: ficam no mapa junto do primeiro', () => {
  // MEDIDO no card: posição proposta a 5 m e uma entrada a 30 km → o mapa
  // mostrava SÓ o local (a proposta sumia) e a legenda só "antes".
  const d = (m) => m / 111320;
  const perto = [AMBEV_ANTES[0] + d(5), AMBEV_ANTES[1]];
  const longe = [AMBEV_ANTES[0] + d(30000), AMBEV_ANTES[1]];
  const r = M.mapaMontar([AMBEV_ANTES, perto, longe], 359, 200, 'row');
  assert.deepEqual(r.idx, [0, 1], 'a proposta a 5 m saiu do mapa por causa da entrada a 30 km');
  assert.deepEqual(r.foraDoMapa, [2], 'só a entrada longe fica de fora — e ela tem que ser NOMEADA');
  for (const px of r.pixels) {
    assert.ok(px.left >= 0 && px.left <= 359 && px.top >= 0 && px.top <= 200, `marcador fora da caixa: ${JSON.stringify(px)}`);
  }
  // A ORDEM decide quem fica: o longe no meio da lista não desloca os de depois.
  const r2 = M.mapaMontar([AMBEV_ANTES, longe, perto], 359, 200, 'row');
  assert.deepEqual(r2.idx, [0, 2], 'o ponto que cabe, depois do que não cabe, sumiu ou trocou de índice');
  assert.deepEqual(r2.foraDoMapa, [1]);
  // Os índices são da lista que ENTROU: um ponto inválido antes não os desloca.
  const r3 = M.mapaMontar([[0, 0], AMBEV_ANTES, longe, perto], 359, 200, 'row');
  assert.deepEqual(r3.idx, [1, 3], 'o índice dos desenhados deixou de ser o da lista que entrou');
  assert.deepEqual(r3.foraDoMapa, [2], 'o índice de quem ficou fora deixou de ser o da lista que entrou');
  // CONTROLE: tudo cabendo, todo mundo desenhado e ninguém de fora.
  const r4 = M.mapaMontar([AMBEV_ANTES, perto, AMBEV_DEPOIS], 359, 200, 'row');
  assert.deepEqual(r4.idx, [0, 1, 2]);
  assert.deepEqual(r4.foraDoMapa, []);
});

test('C4 mapa ampliado de um pedido que não cabe no card: abre com TODOS os pontos na tela', () => {
  // MEDIDO: o pedido que move o local 82 km abria o ampliado em z17 com o
  // centro no MEIO dos dois pontos — nenhum marcador na tela (um a 74.915 px,
  // o outro a −73.883), e o "Voltar ao pedido" voltava ao mesmo vazio.
  const W = 393, H = 852;
  const longe = [AMBEV_ANTES[0] + 82000 / 111320, AMBEV_ANTES[1]];
  const e = M.mapaEnquadrarAmpliado([AMBEV_ANTES, longe], W, H, 'row');
  assert.ok(e.z >= M.MAPA_Z_NAV_MIN && e.z < M.MAPA_Z_MIN, `z ${e.z} fora da faixa em que só o ampliado chega`);
  const g = M.mapaGrade(e.centro, e.z, W, H, 'row');
  for (const ll of [AMBEV_ANTES, longe]) {
    const p = g.projetar(ll);
    assert.ok(p.left >= 0 && p.left <= W && p.top >= 0 && p.top <= H, `ponto fora da tela: ${JSON.stringify(p)}`);
  }
  // O MAIOR zoom que mostra os dois — um a mais e algum sai.
  assert.ok(!M.mapaCabe([AMBEV_ANTES, longe], W, H, e.z + 1), `abriu mais aberto que o necessário (z${e.z})`);
});

test('C4 CONTROLE: pedido que cabe abre no MESMO enquadramento de antes (o do card, centro no meio)', () => {
  const W = 393, H = 852;
  const pts = [AMBEV_ANTES, AMBEV_DEPOIS];
  const e = M.mapaEnquadrarAmpliado(pts, W, H, 'row');
  assert.equal(e.z, M.mapaMontar(pts, W, H, 'row').z, 'o ampliado deixou de abrir no zoom do card');
  assert.deepEqual(e.centro, [(AMBEV_ANTES[0] + AMBEV_DEPOIS[0]) / 2, (AMBEV_ANTES[1] + AMBEV_DEPOIS[1]) / 2]);
  // E o que não cabe nem no zoom mais aberto da navegação fica como o card:
  // ancorado no primeiro ponto (que o card mostra e diz o resto em palavra).
  const outroContinente = [AMBEV_ANTES[0] + 40, AMBEV_ANTES[1] + 90];
  const x = M.mapaEnquadrarAmpliado([AMBEV_ANTES, outroContinente], W, H, 'row');
  assert.equal(x.z, M.mapaMontar([AMBEV_ANTES, outroContinente], W, H, 'row').z);
  assert.deepEqual(x.centro, AMBEV_ANTES, 'sem zoom que caiba, o ampliado não abriu no local');
  assert.equal(M.mapaEnquadrarAmpliado([[0, 0]], W, H, 'row'), null, 'sem coordenada válida não há enquadramento');
});

test('L16 o enquadramento do ampliado diz QUAIS pontos ficaram fora (só quando nem o z4 dá conta)', () => {
  // O ampliado não avisava nada e a legenda prometia o marcador que estava a
  // 2.500 km, fora da tela (auditoria de 2026-09-26). Quem desenha precisa
  // saber quais ficaram de fora — e só esses: o que cabe num zoom da
  // navegação é MOSTRADO, e aviso ali seria ruído.
  const W = 393, H = 852;
  const outroContinente = [AMBEV_ANTES[0] + 40, AMBEV_ANTES[1] + 90];
  const x = M.mapaEnquadrarAmpliado([AMBEV_ANTES, AMBEV_DEPOIS, outroContinente], W, H, 'row');
  assert.deepEqual(x.foraDoMapa, [2], 'o ponto de outro continente não saiu como "fora do mapa"');
  // CONTROLES: o que cabe no card, e o que só cabe num zoom da navegação.
  assert.deepEqual(M.mapaEnquadrarAmpliado([AMBEV_ANTES, AMBEV_DEPOIS], W, H, 'row').foraDoMapa, []);
  const longe = [AMBEV_ANTES[0] + 82000 / 111320, AMBEV_ANTES[1]];
  assert.deepEqual(M.mapaEnquadrarAmpliado([AMBEV_ANTES, longe], W, H, 'row').foraDoMapa, [],
    '82 km cabem num zoom da navegação: não é "fora do mapa"');
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

// ── Mapa NAVEGÁVEL (o ampliado) ──────────────────────────────────────────

test('grade: cobre a caixa e sobra uma fileira, pra arrastar não abrir buraco', () => {
  const c = [-15.7942, -47.8822];
  for (const [w, h] of [[412, 915], [852, 393], [280, 653]]) {
    const g = M.mapaGrade(c, 16, w, h, 'row');
    // Todo pixel da caixa tem tile por baixo.
    const cobre = (x, y) => g.tiles.some((t) => x >= t.left && x < t.left + g.tamanho
      && y >= t.top && y < t.top + g.tamanho);
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [w / 2, h / 2]]) {
      assert.ok(cobre(x, y), `${w}×${h}: canto (${x},${y}) sem tile`);
    }
    // E a fileira extra: existe tile começando ANTES do canto e depois do fim.
    assert.ok(g.tiles.some((t) => t.left < 0), `${w}×${h}: sem fileira extra à esquerda`);
    assert.ok(g.tiles.some((t) => t.left + g.tamanho > w), `${w}×${h}: sem fileira extra à direita`);
  }
});

test('projetar e desprojetar são inversas — é o que faz o arrasto ser fiel', () => {
  // Se elas divergirem, arrastar 100px anda uma distância errada e o mapa
  // "escorrega" debaixo do dedo. Erro tem que ser de arredondamento, não mais.
  for (const z of [4, 10, 16, 19]) {
    for (const c of [[-15.79, -47.88], [48.85, 2.35], [-33.86, 151.2], [64.1, -21.9]]) {
      const g = M.mapaGrade(c, z, 412, 915, 'row');
      for (const [px, py] of [[0, 0], [206, 457], [411, 914]]) {
        const ll = g.desprojetar(px, py);
        const de = g.projetar(ll);
        assert.ok(Math.abs(de.left - px) < 0.01 && Math.abs(de.top - py) < 0.01,
          `z${z} ${c}: (${px},${py}) → ${ll} → (${de.left},${de.top})`);
      }
    }
  }
});

test('o zoom do mapa navegável vai mais fundo que o do card, e trava nos limites', () => {
  // O card economiza rede num slide que ninguém pediu; aqui a pessoa PEDIU.
  assert.ok(M.MAPA_Z_NAV_MAX > M.MAPA_Z_MAX, 'o ampliado deixou de aproximar mais que o card');
  assert.ok(M.MAPA_Z_NAV_MIN < M.MAPA_Z_MIN, 'o ampliado deixou de afastar mais que o card');
  for (const [pedido, esperado] of [[99, M.MAPA_Z_NAV_MAX], [-5, M.MAPA_Z_NAV_MIN], [16.4, 16]]) {
    assert.equal(M.mapaGrade([-15.79, -47.88], pedido, 412, 915, 'row').z, esperado,
      `zoom ${pedido} devia virar ${esperado}`);
  }
});

test('a grade não explode em tiles, nem no zoom mais aberto', () => {
  // Cada tile é rede. Uma caixa de celular não pode pedir dezenas.
  for (const z of [4, 8, 12, 16, 19]) {
    const g = M.mapaGrade([-15.79, -47.88], z, 412, 915, 'row');
    assert.ok(g.tiles.length <= 24, `z${z}: ${g.tiles.length} tiles numa tela só`);
  }
});
