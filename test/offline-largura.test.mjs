// R23-4-01: a varredura prepara os tiles para a FAIXA de larguras do card, não só
// para a do card de agora. A altura já era faixa (piso ao teto); a largura era
// uma só, e girar o aparelho COM rede — nada re-prepara — deixava o mapa de 2–4%
// dos pedidos (os de mais de um ponto) sem tile quando o sinal caía, com a linha
// das Preferências ainda em "Pronto". Aqui a geometria de verdade (js/mapa.js e as
// funções do app.js) roda contra as 51 fixtures reais dos 6 países e contra uma
// população sintética de pedidos de 2 a 4 pontos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const M = require('../js/mapa.js');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', APP_SEM.indexOf(')', m.index)); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) return APP_SEM.slice(m.index, j + 1); }
  }
  throw new Error('não fechou');
}
const consts = ['OFFLINE_CAIXA_MIN_REM', 'OFFLINE_CAIXA_PASSO_PX', 'OFFLINE_CAIXA_LARGURA_MIN_PX', 'OFFLINE_CAIXA_LARGURA_MAX_PX', 'OFFLINE_CAIXA_PASSO_LARGURA_PX']
  .map((n) => { const m = new RegExp(`^const ${n} = ([^;]+);`, 'm').exec(APP_SEM); assert.ok(m, `${n} sumiu`); return m[0]; }).join('\n');

// O estado da TELA: janela, pilha e a caixa da foto do card da frente.
function geometria({ iw, ih, w, h, pilha, rem = 16 }) {
  const ctx = {
    window: { innerWidth: iw, innerHeight: ih, mapaMontar: M.mapaMontar },
    document: {
      documentElement: {},
      getElementById: (id) => (id === 'cardStack' ? { clientHeight: pilha } : null),
    },
    getComputedStyle: () => ({ fontSize: rem + 'px' }),
    cardDaFrente: () => ({ querySelector: () => ({ clientWidth: w, clientHeight: h }) }),
    pontosDoMapa: (p) => { const m = p.mapa; const a = [m.centro]; if (m.proposto) a.push(m.proposto); for (const e of m.entradas || []) a.push(e.ll); return a.map((ll) => ({ ll })); },
    API: { getRegion: () => 'row' }, mapaMontar: M.mapaMontar,
    MAPA_TILE: M.MAPA_TILE || 512,
    Math, Set, Number, parseFloat,
  };
  vm.createContext(ctx);
  vm.runInContext([consts, fatiar('offlineFaixaDeCaixas'), fatiar('tilesDaFaixa'), fatiar('tilesDoCard'),
    'this.__faixa = offlineFaixaDeCaixas; this.__tilesDaFaixa = tilesDaFaixa; this.__tilesDoCard = tilesDoCard;'].join('\n'), ctx);
  return { faixa: ctx.__faixa(), tilesDaFaixa: ctx.__tilesDaFaixa, tilesDoCard: ctx.__tilesDoCard };
}

// Os estados REAIS do card (largura medida do `.card-photo`, altura máxima da pilha).
const RETRATO = { iw: 390, ih: 844, w: 356, h: 337, pilha: 600 };
const PAISAGEM = { iw: 844, ih: 390, w: 267, h: 190, pilha: 265 };
const FOLD_FECHADO = { iw: 280, ih: 653, w: 246, h: 221, pilha: 460 };
const FOLD_ABERTO = { iw: 717, ih: 653, w: 398, h: 194, pilha: 445 };
const DESKTOP = { iw: 1280, ih: 800, w: 398, h: 337, pilha: 640 };
// O aparelho gira (celular) ou dobra (Fold): os estados do MESMO aparelho. Toda
// (largura, altura) que o card de qualquer um deles pode ter tem de estar coberta
// pela faixa varrida em qualquer um deles.
const FAMILIAS = { celular: [RETRATO, PAISAGEM], fold: [FOLD_FECHADO, FOLD_ABERTO], desktop: [DESKTOP] };
const alturaAte = (estados) => Math.min(504, Math.max(...estados.map((e) => e.pilha)));
const LARGURAS_REAIS = [230, 246, 267, 326, 356, 398];

let semente = 20260101;
const rnd = () => (semente = (semente * 1664525 + 1013904223) % 4294967296) / 4294967296;
const deslocar = (ll, m, br) => [ll[0] + (m * Math.cos(br)) / 111320, ll[1] + (m * Math.sin(br)) / (111320 * Math.cos((ll[0] * Math.PI) / 180))];
const sinteticos = [];
for (let i = 0; i < 120; i++) {
  const c = [-23 + rnd() * 3, -46 + rnd() * 3];
  const entradas = [];
  const n = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) entradas.push({ ll: deslocar(c, Math.exp(Math.log(5) + rnd() * Math.log(800 / 5)), rnd() * 6.283) });
  sinteticos.push({ mapa: { centro: c, proposto: null, entradas } });
}
const fixturesReais = (() => {
  const fx = JSON.parse(readFileSync(new URL('../tools/fixtures-paises.json', import.meta.url), 'utf8'));
  return (Array.isArray(fx) ? fx : Object.values(fx).flat()).filter((p) => p.mapa && p.mapa.centro);
})();

// O que FALTA: tiles que algum (largura, altura) possível pede e a faixa varrida não tem.
function faltas(g, populacao, largurasPossiveis, hAte) {
  let pedidos = 0;
  for (const p of populacao) {
    const varridos = g.tilesDaFaixa(p, g.faixa);
    let falta = false;
    for (const w of largurasPossiveis) {
      for (let h = 88; h <= hAte; h += 8) for (const u of g.tilesDoCard(p, w, h)) if (!varridos.has(u)) falta = true;
    }
    if (falta) pedidos++;
  }
  return pedidos;
}

for (const [fam, estados] of Object.entries(FAMILIAS)) {
  for (const estado of estados) {
    test(`R23-4-01: faixa varrida com o ${fam} em ${estado.iw}x${estado.ih} cobre toda (largura, altura) do card nos estados do aparelho`, () => {
      const g = geometria(estado);
      const larguras = estados.map((e) => e.w);
      const hAte = alturaAte(estados);
      assert.equal(faltas(g, sinteticos, larguras, hAte), 0, 'a faixa não cobre alguma (largura, altura) do card depois de girar/dobrar: o mapa fica sem tile sem rede');
      assert.equal(faltas(g, fixturesReais, larguras, hAte), 0, 'idem, nas fixtures reais dos 6 países');
      // E a faixa inteira de larguras medidas (230–398), que cobre o aparelho que ninguém listou.
      assert.equal(faltas(g, sinteticos, LARGURAS_REAIS, hAte), 0, 'a faixa não cobre as larguras medidas do card (230–398)');
    });
  }
}

test('R23-4-01: CONTROLE — só a largura de agora (o código de antes) deixa pedidos sem tile', () => {
  // Sem este controle os testes acima passariam com qualquer faixa (a população poderia não ter pedido sensível à largura).
  const g = geometria(RETRATO);
  const sozinha = { ...g, faixa: { ...g.faixa, ws: undefined } };
  const f = faltas(sozinha, sinteticos, LARGURAS_REAIS, 504);
  assert.ok(f >= 5, `o controle não enxerga o defeito (${f} pedidos com falta numa população de ${sinteticos.length}): fixture que não distingue`);
});

test('R23-4-01: deitado, a altura máxima é a da orientação MAIOR (girar pro retrato devolve a dimensão longa)', () => {
  const g = geometria(PAISAGEM);
  assert.ok(g.faixa.hMax > 400, `deitado a faixa para em ${g.faixa.hMax}px: o retrato (até 504) fica sem cobertura`);
  assert.equal(geometria(RETRATO).faixa.hMax, 504, 'em retrato o teto continua sendo MAPA_TILE − 8');
});

test('R23-4-01: o custo fica no mesmo patamar nas fixtures reais (≤ +10% de tiles)', () => {
  const g = geometria(RETRATO);
  const antes = { ...g.faixa, ws: undefined };
  let novo = 0, velho = 0;
  const vistoNovo = new Set(), vistoVelho = new Set();
  for (const p of fixturesReais) {
    for (const u of g.tilesDaFaixa(p, g.faixa)) vistoNovo.add(u);
    for (const u of g.tilesDaFaixa(p, antes)) vistoVelho.add(u);
  }
  novo = vistoNovo.size; velho = vistoVelho.size;
  assert.ok(novo >= velho, 'a faixa nova tem que conter a antiga');
  assert.ok(novo <= velho * 1.1, `a faixa de larguras encheu a banda: ${velho} → ${novo} tiles`);
});

test('R23-4-01: o teto da faixa de larguras é o do #cardStack, e o piso fica abaixo da menor largura medida', () => {
  const max = Number(/^const OFFLINE_CAIXA_LARGURA_MAX_PX = (\d+);/m.exec(APP_SEM)[1]);
  const min = Number(/^const OFFLINE_CAIXA_LARGURA_MIN_PX = (\d+);/m.exec(APP_SEM)[1]);
  const passo = Number(/^const OFFLINE_CAIXA_PASSO_LARGURA_PX = (\d+);/m.exec(APP_SEM)[1]);
  const m = /id="cardStack" class="[^"]*max-w-\[(\d+)px\]/.exec(HTML);
  assert.ok(m, 'o #cardStack perdeu o max-w-[Npx]: a largura máxima do card deixou de estar amarrada');
  assert.equal(max, Number(m[1]), 'o teto da faixa de larguras não é o max-w do #cardStack');
  assert.ok(min <= Math.min(...LARGURAS_REAIS), `o piso (${min}) está acima da menor largura medida do card`);
  assert.ok(passo <= 64, `o passo de largura (${passo}) passou do medido como exato (zero falta até 88, margem de 1,8×)`);
  assert.match(fatiar('tilesDaFaixa'), /faixa\.ws/, 'tilesDaFaixa parou de varrer as larguras da faixa');
});
