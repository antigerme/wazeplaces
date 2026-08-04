// O mini-mapa contra PEDIDOS REAIS — sem browser, sem rede, no `npm test`.
//
// `test/mapa.test.mjs` cobre a matemática com pontos que EU escolhi. Este roda
// a mesma matemática sobre os 51 pedidos reais de 6 países que já estão no
// repo pro smoke, e é onde as duas coisas se encontram: o dado é real e a
// verificação é pura, então cabe na suíte de zero dependência em vez de
// depender de browser.
//
// Ironia que motivou o arquivo: o mapa era o recurso mais novo da app e o
// menos coberto contra dado de verdade.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = createRequire(import.meta.url)(join(ROOT, 'js/mapa.js'));
const FIXTURES = JSON.parse(readFileSync(join(ROOT, 'tools/fixtures-paises.json'), 'utf8'));

// A caixa do slide, nos dois aparelhos onde 100% das falhas de layout
// apareceram. Largura da viewport, altura típica do slot da foto.
const CAIXAS = [['Galaxy Fold', 280, 150], ['paisagem', 852, 130], ['Pixel 7', 412, 250]];

// Os pontos que o card monta, na MESMA ordem do `renderMapa` — é essa ordem
// que casa cada pixel devolvido com o seu marcador.
const pontosDo = (f) => [f.mapa && f.mapa.centro, f.mapa && f.mapa.proposto,
  ...((f.mapa && f.mapa.entradas) || []).map((e) => e.ll)].filter(Boolean);

test('todo pedido real de 6 países produz um mapa desenhável', () => {
  let comMapa = 0;
  for (const f of FIXTURES) {
    assert.ok(f.mapa, `${f._pais} · ${f.purType}: veio sem dado de mapa — "onde fica isto" é pergunta de TODO tipo`);
    const pts = pontosDo(f);
    assert.ok(pts.length > 0, `${f._pais} · ${f.purType}: mapa sem um ponto sequer`);
    for (const [nome, w, h] of CAIXAS) {
      const r = M.mapaMontar(pts, w, h, 'row');
      assert.ok(r, `${f._pais} · ${f.purType} · ${nome}: mapaMontar devolveu null com ${pts.length} pontos`);
      comMapa++;
    }
  }
  assert.equal(comMapa, FIXTURES.length * CAIXAS.length);
});

test('nenhum marcador cai fora da caixa — nem os que a app decidiu não desenhar', () => {
  for (const f of FIXTURES) {
    const pts = pontosDo(f);
    for (const [nome, w, h] of CAIXAS) {
      const r = M.mapaMontar(pts, w, h, 'row');
      for (const px of r.pixels) {
        assert.ok(px.left >= 0 && px.left <= w && px.top >= 0 && px.top <= h,
          `${f._pais} · ${f.purType} · ${nome}: marcador em (${Math.round(px.left)}, ${Math.round(px.top)}) fora de ${w}×${h}`);
      }
      // Quem não coube tem que estar NOMEADO em `foraDoMapa` — é o que permite
      // o card dizer em palavra o que o mapa não pode mostrar. Marcador que
      // some calado faz o editor concluir que nada mudou de lugar.
      assert.equal(r.pixels.length + r.foraDoMapa.length, pts.length,
        `${f._pais} · ${f.purType} · ${nome}: ${pts.length} pontos viraram ${r.pixels.length} marcadores + ${r.foraDoMapa.length} avisos`);
    }
  }
});

test('orçamento de rede: o mapa não estoura tiles por card', () => {
  // Cada tile custa 29–147 KB no celular do editor.
  //
  // Este teste já pagou por si: ele pegou que em PAISAGEM (caixa de 852px,
  // mais larga que o tile de 512) o encaixe desistia e o mapa chegava a SEIS
  // tiles, média 3,24 — eu só tinha medido a caixa retrato. Generalizado pra
  // minimizar tiles atravessados em vez de "caber num tile só", a média foi
  // pra 1,29 (Fold), 2,27 (paisagem) e 1,29 (Pixel 7), pior caso 4.
  let total = 0, n = 0, pior = 0;
  for (const f of FIXTURES) {
    const pts = pontosDo(f);
    for (const [nome, w, h] of CAIXAS) {
      const r = M.mapaMontar(pts, w, h, 'row');
      assert.ok(r.tiles.length <= 4,
        `${f._pais} · ${f.purType} · ${nome}: ${r.tiles.length} tiles num card só`);
      total += r.tiles.length; n++;
      pior = Math.max(pior, r.tiles.length);
    }
  }
  const media = total / n;
  // Medido: 1,62 na média das três caixas. O teto de 2,0 dá folga pra ruído
  // de fixture nova sem deixar passar uma regressão do encaixe (que levaria
  // pra ~2,3).
  assert.ok(media <= 2.0, `${media.toFixed(2)} tiles por card em média — o encaixe parou de economizar rede`);
});

test('o zoom escolhido é coerente com a distância que precisa caber', () => {
  for (const f of FIXTURES) {
    const pts = pontosDo(f);
    if (pts.length < 2) continue;
    const r = M.mapaMontar(pts, 412, 250, 'row');
    if (r.foraDoMapa.length) continue;   // esse caso já tem teste próprio
    // Se cabe no zoom escolhido, tem que caber — e no zoom seguinte (mais
    // fechado) NÃO deve caber, senão estamos jogando fora detalhe de graça.
    assert.ok(M.mapaCabe(pts, 412, 250, r.z),
      `${f._pais} · ${f.purType}: o zoom ${r.z} não comporta os pontos que ele deveria enquadrar`);
    if (r.z < M.MAPA_Z_MAX) {
      assert.ok(!M.mapaCabe(pts, 412, 250, r.z + 1),
        `${f._pais} · ${f.purType}: cabia em z${r.z + 1} e o mapa abriu mais que o necessário`);
    }
  }
});

test('a região do editor manda na URL do tile, em todos os pedidos', () => {
  for (const reg of ['row', 'na', 'il']) {
    for (const f of FIXTURES.slice(0, 8)) {
      const r = M.mapaMontar(pontosDo(f), 412, 250, reg);
      for (const t of r.tiles) {
        assert.ok(t.url.startsWith(`https://www.waze.com/${reg}-tiles/live/base/`),
          `região ${reg} ignorada em ${f._pais}: ${t.url}`);
      }
    }
  }
});

test('as fixtures cobrem o que o mapa precisa saber desenhar', () => {
  // Uma fixture só de "local parado" não exercita a linha do movimento nem o
  // marcador de entrada. Se a cobertura cair, o teste acima passa medindo nada.
  const comProposto = FIXTURES.filter((f) => f.mapa && f.mapa.proposto).length;
  const comEntrada = FIXTURES.filter((f) => f.mapa && f.mapa.entradas.length).length;
  const comEntradaNova = FIXTURES.filter((f) => f.mapa
    && f.mapa.entradas.some((e) => e.estado === 'nova')).length;
  assert.ok(comEntrada >= 5, `só ${comEntrada} fixtures com ponto de entrada`);
  // `proposto` e `nova` são raros por natureza (só pedidos que mexem em
  // posição); o piso é baixo de propósito, mas zero significaria que o mapa
  // está sendo testado sem nunca desenhar uma mudança.
  assert.ok(comProposto + comEntradaNova >= 1,
    'nenhuma fixture exercita mudança de posição — o mapa nunca desenha a linha nem a entrada nova');
});
