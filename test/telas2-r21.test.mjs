// A TELA na rodada 21 da auditoria (lote 25, área "telas 2": o texto grande nos Filtros,
// nos diálogos, no Histórico e na Ajuda, e o modo de contraste alto; relatório r21-7):
// o CSS e o HTML de verdade, lidos do fonte (sem comentário: gotcha #67).
//
//  R21-7-07 · (regressão do lote 24) com o texto do sistema ≥ 1,8× no Galaxy Fold o "Aplicar" dos
//             Filtros saía da janela e nada rolava. O CARTÃO passa a rolar e o rodapé fica preso no fim
//             dele, só numa escada de janelas em `rem` (consulta de contêiner no overlay) que cobre os
//             defeitos medidos, deixa de fora os diálogos que cabem e nenhum celular a 1×: onde cabe
//             hoje, nenhum pixel muda.
//  R21-7-05 · a célula de conquista "nova" ou "selecionada" focada pelo teclado ficava IGUAL à sem foco.
//  R21-7-06 · sem `@container`, o 2º botão dos diálogos de duas linhas ficava recuado: `space-x-3` → `gap-3`.
//  R21-7-08 · o texto da vitrine de patente e conquistas é `rem` (cresce com o texto do sistema), e o
//             cartão empilha / a grade vai a 1–2 colunas por `@container` em `rem`.
//  R21-8-03 · (o mesmo, com o Pixel de 412 px a 1,5× e o Fold a 1,15×/1,3× nos totais 0 e 1.600 como critério)
//             abaixo de 10,5rem o RESTO da vitrine refluí: cartão com 8 px de respiro, topo em UMA coluna, nome
//             da patente em 16 px × a escala, escada em duas linhas, título que quebra e a rede `overflow-wrap`.
//  R21-7-01 · contraste alto (`forced-colors: active`): interruptores, abas, barra, selos, células e botões.
//  D3/D4    · a tabela de gestos da Ajuda e os botões do pareamento / "Acesso restrito" quebram o texto.
//  R21-8-02 · as ações que EMPILHAM (texto grande) ficam presas no fim do cartão do diálogo: o botão afirmativo
//             não cai abaixo do corte da rolagem (sticky, só com a fileira de até 12,4rem E o cartão rolando
//             — `scroll-state(scrollable: block)`, com a regra sem o portão para o navegador que não o tem —: a 1× nada
//             muda, e o diálogo que empilha mas CABE também não; o fundo da fileira é a cor do cartão a 99,6%, e NÃO
//             opaca, que no Chromium liga o subpixel e muda o texto).
//  R21-8-04 · o título, a 1ª frase e o nome do perfil do "Acesso restrito" quebram a palavra que não cabe.
//  (comentário) · o `.seg-tab` dizia 6,25% onde o código usa `6.3cqw`.
//
// O que só o navegador mede (hit-test, recuo, sobreposição, o anel de foco na tinta, o estado dos
// interruptores com `forcedColors: 'active'`, e que a 1× nada muda) está nos blocos do
// `tools/smoke-browser.mjs` logo depois do "TEXTO DO SISTEMA MAIOR…" do lote 24, com os controles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const HTML = ler('index.src.html');
const CSS_CRU = ler('css/styles.css');
// Guard lê CÓDIGO, nunca comentário (gotcha #67).
const semComentarioCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = semComentarioCss(CSS_CRU);
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// ── Um leitor mínimo de CSS: as regras de TOPO (seletores + declarações) e os blocos `@…` ─────────────
// Chaves de uma regra comum não aninham aqui; o `@media`/`@container` é lido à parte, e as regras de dentro
// dele ficam em `corpo` (o mesmo leitor roda de novo sobre ele).
function lerBlocos(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    const ab = css.indexOf('{', i);
    if (ab < 0) break;
    const cabeca = css.slice(i, ab).trim();
    let nivel = 0, fim = ab;
    for (let k = ab; k < css.length; k++) {
      if (css[k] === '{') nivel++;
      else if (css[k] === '}' && --nivel === 0) { fim = k; break; }
    }
    const corpo = css.slice(ab + 1, fim);
    out.push({ cabeca, corpo, de: i });
    i = fim + 1;
  }
  return out;
}
function declaracoes(corpo) {
  const d = {};
  for (const m of corpo.matchAll(/([\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) d[m[1]] = norm(m[2]);
  return d;
}
const TOPO = lerBlocos(CSS);
// Todas as regras comuns (as de topo e as de dentro de `@media`/`@container`/`@supports`), com a condição.
function regrasComuns(blocos = TOPO, condicao = '') {
  const r = [];
  for (const b of blocos) {
    if (b.cabeca.startsWith('@')) {
      if (/^@(media|container|supports)\b/.test(b.cabeca)) r.push(...regrasComuns(lerBlocos(b.corpo), b.cabeca));
      continue;
    }
    for (const sel of b.cabeca.split(',').map(norm)) r.push({ sel, decl: declaracoes(b.corpo), condicao, corpo: b.corpo });
  }
  return r;
}
const REGRAS = regrasComuns();
const regraDe = (sel, condicao = '', prop = null) => REGRAS.find((r) => r.sel === sel && r.condicao === condicao && (!prop || prop in r.decl));
const blocoAt = (cabeca) => TOPO.find((b) => b.cabeca === cabeca);

// Especificidade (a, b, c) de um seletor simples (sem `:is()`/`:where()`), só o que o CSS daqui usa.
function especificidade(seletor) {
  let s = seletor.replace(/\[[^\]]*\]/g, ' [] ');           // atributos contam como classe
  const a = (s.match(/#[\w-]+/g) || []).length;
  const b = (s.match(/\.[\w-]+/g) || []).length + (s.match(/\[\]/g) || []).length
    + (s.match(/(?<!:):(?!:)(?!not\b)[\w-]+/g) || []).length;
  const semPseudo = s.replace(/#[\w-]+|\.[\w-]+|\[\]|::?[\w-]+(\([^)]*\))?/g, ' ');
  const c = (semPseudo.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length + (s.match(/::[\w-]+/g) || []).length;
  return [a, b, c];
}
const maior = (x, y) => { for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1; return 0; };

test('instrumento: o leitor de CSS e a especificidade enxergam o que dizem (controle)', () => {
  assert.deepEqual(especificidade(':focus-visible'), [0, 1, 0]);
  assert.deepEqual(especificidade('.dark :focus-visible'), [0, 2, 0]);
  assert.deepEqual(especificidade('.conq-cel.nova'), [0, 2, 0]);
  assert.deepEqual(especificidade('.conq-cel.nova:focus-visible'), [0, 3, 0]);
  assert.deepEqual(especificidade('.dark .conq-cel.sel:focus-visible'), [0, 4, 0]);
  assert.deepEqual(especificidade('.seg-tab[aria-selected="true"]'), [0, 2, 0]);
  assert.deepEqual(especificidade('input.ui-switch::after'), [0, 1, 2]);
  assert.deepEqual(especificidade('#filtersModal'), [1, 0, 0]);
  assert.ok(REGRAS.length > 300, `o leitor só achou ${REGRAS.length} regras: ele quebrou`);
  assert.ok(regraDe('.conq-cel.nova'), 'o leitor não achou a regra da célula nova');
  assert.ok(regraDe('.dialogo-acoes'), 'o leitor não achou a linha dos diálogos');
});

// ═══ R21-7-07 · os Filtros numa janela que o texto grande deixou pequena ═══════════════════════════════

// Estados MEDIDOS na base (rodada de conserto: a grade de 2.592 estados e 900 sorteados, em Chromium, nos 4 idiomas): [largura, altura]
// da janela em rem (o overlay menos o respiro de 1rem de cada lado) dos que ficam mais perto da borda da escada, de cada lado dela.
//  · DEFEITOS (o "Aplicar" ou o "Cancelar" fora da janela, nada que rolasse): têm que ficar DENTRO da escada — o menor folga é 0,44rem.
//  · CABE (o diálogo cabe, nada fora do cartão): têm que ficar FORA — o mais perto está 0,94rem acima da escada.
// Os dois lados se travam: encolher a escada solta um defeito, e crescê-la muda um diálogo que hoje cabe.
const DEFEITOS_MEDIDOS = [
  [8, 21.125],        // 320×740 a 2× (pt)
  [8.294, 18.882],    // 280×568 a 1,7× (pt)
  [9.111, 17.722],    // 320×568 a 1,8× (fr): o SE de 320 px
  [11.183, 16.204],   // 386×533 a 1,83× (en)
  [13.217, 15.391],   // 280×320 a 1,15× (pt): janela quase quadrada, o rodapé empilhado
  [15.391, 15.391],   // 320×320 a 1,15×
  [16.894, 11.462],   // 393×280 a 1,3× (pt): deitado
  [19.48, 8.526],     // 653×320 a 1,9× (pt): o Fold deitado, mais alto
  [7.722, 20.674],    // 280×653 a 1,8×: o Galaxy Fold fechado (o caso do auditor)
  [6.75, 18.406],     // 280×653 a 2×
];
const CABE_MEDIDO = [
  [11.932, 18.74],    // 399×594 a 1,79× (es)
  [12.449, 18.882],   // 393×568 a 1,7× (en)
  [11.852, 18.943],   // 379×573 a 1,71× (pt)
  [12.107, 18.964],   // 395×587 a 1,75× (pt)
  [11.553, 19.053],   // 412×640 a 1,9× (en)
  [9.639, 20.417],    // 365×703 a 1,96× (en)
  [13.732, 18.668],   // 443×582 a 1,76× (en)
  [15.042, 18.749],   // 469×571 a 1,72× (es)
  [23.75, 55.188],    // 412×915 a 1×
  [22.563, 55.188],   // 393×915 a 1×
];
// Aparelhos a 1× (a raiz tem 16 px): nenhum pode cair na escada — onde cabe hoje, nenhum pixel muda. São os 40 viewports
// do `presets-1x` da rodada 21 (celulares, dobráveis, tablets e desktops) e cada um deitado, mais os 26 de antes.
const APARELHOS_A_1X = [
  [280, 653], [653, 280], [320, 568], [568, 320], [360, 640], [640, 360], [360, 740], [375, 667], [667, 375], [375, 812],
  [812, 375], [390, 844], [844, 390], [393, 852], [852, 393], [412, 915], [915, 412], [414, 896], [428, 926], [430, 932],
  [932, 430], [600, 960], [768, 1024], [1024, 768], [1280, 800], [1920, 1080], [360, 780], [360, 800], [393, 851], [412, 892],
  [414, 736], [411, 731], [411, 823], [412, 846], [384, 854], [344, 882], [540, 720], [601, 962], [820, 1180], [810, 1080],
  [912, 1368], [1024, 600], [1366, 768], [1440, 900], [800, 1280], [740, 360], [780, 360], [800, 360], [851, 393], [892, 412],
  [736, 414], [896, 414], [926, 428], [731, 411], [823, 411], [846, 412], [854, 384], [882, 344], [720, 540], [960, 600],
  [962, 601], [1180, 820], [1080, 810], [1368, 912], [600, 1024], [768, 1366], [900, 1440], [1080, 1920]
];
const janelaEmRem = (L, A) => [L / 16 - 2, A / 16 - 2];

function escadaDosFiltros() {
  const b = TOPO.find((x) => /^@container filtros\b/.test(x.cabeca));
  assert.ok(b, 'sumiu o @container dos Filtros');
  const pares = [...b.cabeca.matchAll(/\(max-width:\s*([\d.]+)rem\)\s*and\s*\(max-height:\s*([\d.]+)rem\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(pares.length >= 1, 'a escada dos Filtros não tem nenhum retângulo "largura E altura"');
  return { b, pares };
}
const naEscada = (pares, l, a) => pares.some(([w, h]) => l <= w && a <= h);

test('R21-7-07 · o cartão dos Filtros rola numa ESCADA de janelas em rem (contêiner = o overlay), que cobre o defeito medido', () => {
  const ov = regraDe('#filtersModal');
  assert.ok(ov, 'a regra do overlay dos Filtros sumiu');
  // `size` é o que deixa perguntar a ALTURA; o overlay é `fixed inset-0`, então o tamanho dele não depende do conteúdo.
  assert.equal(ov.decl.container, 'filtros / size');
  assert.match(HTML, /<div id="filtersModal"[^>]*class="[^"]*\bfixed\b[^"]*\binset-0\b/, 'o overlay deixou de ser fixed inset-0: `container-type: size` zeraria o tamanho dele');
  const { b, pares } = escadaDosFiltros();
  const r = regrasComuns(lerBlocos(b.corpo), b.cabeca).find((x) => x.sel === '#filtersModal > div');
  assert.ok(r, 'a regra do cartão dentro da escada sumiu');
  assert.equal(r.decl['overflow-y'], 'auto');
  assert.equal(r.decl['overflow-x'], 'hidden');
  assert.equal(r.decl['overscroll-behavior'], 'contain');
  // O rodapé fica PRESO no fim do cartão (o "Aplicar" e o "Cancelar" à vista sem rolar), com a cor do cartão, só dentro da escada.
  const rodape = regrasComuns(lerBlocos(b.corpo), b.cabeca).find((x) => x.sel === '#filtersModal > div > .dialogo-acoes:last-child');
  assert.ok(rodape, 'o rodapé dos Filtros deixou de ficar preso dentro da escada');
  assert.equal(rodape.decl.position, 'sticky');
  assert.equal(rodape.decl.bottom, '0');
  assert.equal(rodape.decl.background, 'inherit');
  assert.ok(!REGRAS.some((x) => /#filtersModal\s*>\s*div\s*>\s*\.dialogo-acoes/.test(x.sel) && x.condicao === ''), 'o rodapé dos Filtros fica preso também fora da escada');
  // O rodapé preso cobre o fim da rolagem: o `scroll-padding-bottom` faz o foco do teclado parar ACIMA dele (17 de 17 controles ficavam
  // sob o rodapé no Fold a 2×). Dois grupos: o rodapé empilhado (linha de até 15,4rem) e o lado a lado. As condições são linhas DA escada.
  const blocosDePadding = TOPO.filter((x) => /^@container filtros\b/.test(x.cabeca) && /scroll-padding-bottom/.test(x.corpo));
  assert.equal(blocosDePadding.length, 2, 'esperava dois grupos de scroll-padding-bottom (rodapé empilhado e lado a lado)');
  const dosGrupos = blocosDePadding.map((x) => [...x.cabeca.matchAll(/\(max-width:\s*([\d.]+)rem\)\s*and\s*\(max-height:\s*([\d.]+)rem\)/g)].map((m) => [Number(m[1]), Number(m[2])]));
  assert.equal(dosGrupos[0].length + dosGrupos[1].length, pares.length, 'os grupos do scroll-padding não cobrem exatamente as linhas da escada');
  for (const [w, a] of dosGrupos.flat()) assert.ok(pares.some(([w2, a2]) => w2 === w && a2 === a), `o scroll-padding vale numa janela (${w} × ${a}rem) que não é linha da escada`);
  const valor = (blk) => declaracoes(lerBlocos(blk.corpo)[0].corpo)['scroll-padding-bottom'];
  assert.equal(valor(blocosDePadding[0]), '11rem');
  assert.equal(valor(blocosDePadding[1]), '5.5rem');
  assert.ok(dosGrupos[0].every(([w]) => w <= 15.4) && dosGrupos[1].every(([w]) => w > 15.4), 'o grupo do rodapé empilhado (≤ 15,4rem) e o do lado a lado (> 15,4rem) se misturaram');
  assert.ok(!REGRAS.some((x) => x.condicao === '' && /#filtersModal\s*>\s*div/.test(x.sel) && 'scroll-padding-bottom' in x.decl), 'o scroll-padding-bottom vale também fora da escada');
  // Cobre cada defeito medido…
  assert.ok(DEFEITOS_MEDIDOS.length >= 8, `a tabela dos defeitos medidos só tem ${DEFEITOS_MEDIDOS.length} estados: o guard perdeu o alcance`);
  for (const [l, a] of DEFEITOS_MEDIDOS) assert.ok(naEscada(pares, l, a), `o defeito medido ${l}rem × ${a}rem (o "Aplicar" fora da janela) não está na escada`);
  // …e deixa FORA cada diálogo que cabe: a escada não pode crescer sobre ele.
  for (const [l, a] of CABE_MEDIDO) assert.ok(!naEscada(pares, l, a), `o diálogo que CABE em ${l}rem × ${a}rem está na escada: o cartão passaria a rolar onde nada estoura`);
  // A quebra exata do rodapé: ele empilha com a linha de até 12,4rem = a janela de até 15,4rem (a linha é a janela menos o px-6).
  // Um canto que atravessasse os 15,4rem misturaria o rodapé empilhado (3,2rem mais alto) com o lado a lado.
  assert.ok(pares.some(([w]) => w === 15.4), 'a escada não tem um canto em 15,4rem, a largura em que o rodapé deixa de empilhar');
  assert.ok(!pares.some(([w]) => w > 15.4 && w < 15.5), 'um canto da escada atravessa a quebra do rodapé em 15,4rem');
  // …e NENHUM aparelho a 1×: a escada não pode alcançar a janela de nenhum celular com o texto de fábrica.
  for (const [L, A] of APARELHOS_A_1X) {
    const [l, a] = janelaEmRem(L, A);
    assert.ok(!naEscada(pares, l, a), `a escada alcança o aparelho ${L}×${A} a 1× (${l}rem × ${a}rem): mudaria o diálogo de hoje`);
  }
  // Fora da escada o cartão NÃO tem overflow (nem classe nem regra): o `overflow: visible` é o desenho de hoje.
  const cls = /<div id="filtersModal"[^>]*>\s*<div class="([^"]*)">/.exec(HTML)[1].split(/\s+/);
  assert.ok(!cls.some((c) => /^overflow-/.test(c)), 'o cartão dos Filtros ganhou uma classe overflow-: ele rolaria sempre, e o corpo deixaria de ser o único que rola a 1×');
  for (const r2 of REGRAS) {
    if (r2.condicao === b.cabeca) continue;
    if (!/^#filtersModal\s*>\s*div\b/.test(r2.sel)) continue;
    assert.ok(!('overflow' in r2.decl) && !('overflow-y' in r2.decl), `a regra ${r2.sel} põe overflow no cartão dos Filtros fora da escada`);
  }
  // A 1ª ideia (overflow-y: auto no OVERLAY) muda, a 1×, 1 a 2 níveis de cor nos pixels de canto do cartão: não volta.
  assert.ok(!('overflow-y' in ov.decl) && !('overflow' in ov.decl), 'o overlay dos Filtros virou rolagem: muda o raster do cartão a 1× (0 pixel é o pedido)');
});

test('R21-7-07 · o rodapé dos Filtros segue sendo a linha .dialogo-acoes com os dois botões de sempre', () => {
  const m = /<div class="dialogo-acoes flex gap-3 px-6 py-4 border-t[^"]*">\s*<button id="cancelFilters"[\s\S]*?<button id="applyFilters"/.exec(HTML);
  assert.ok(m, 'o rodapé dos Filtros mudou: cancelFilters, applyFilters e closeFiltersFooter na linha .dialogo-acoes');
});

// ═══ R21-7-05 · o anel de foco das células "nova" e "selecionada" ══════════════════════════════════════

test('R21-7-05 · o foco do teclado vence o contorno do estado nas células nova e selecionada, nos dois temas', () => {
  const claro = ['.conq-cel.nova:focus-visible', '.conq-cel.sel:focus-visible'].map((x) => regraDe(x));
  const escuro = ['.dark .conq-cel.nova:focus-visible', '.dark .conq-cel.sel:focus-visible'].map((x) => regraDe(x));
  assert.ok(claro.every(Boolean) && escuro.every(Boolean), 'sumiu a regra de foco de uma célula (nova/selecionada, claro/escuro)');
  const cor = { claro: '#0891b2', escuro: '#22d3ee' };    // o anel do app (`:focus-visible` e `.dark :focus-visible`)
  for (const r of claro) { assert.equal(r.decl['outline-color'], cor.claro, r.sel); assert.equal(r.decl['outline-offset'], '3px', r.sel); }
  for (const r of escuro) { assert.equal(r.decl['outline-color'], cor.escuro, r.sel); assert.equal(r.decl['outline-offset'], '3px', r.sel); }
  // O que o estado põe é o que o foco tem que ganhar: toda regra que fixa o contorno de uma `.conq-cel`
  // (o estado) tem especificidade MENOR que a do foco do mesmo tema — o `:focus-visible` geral é (0,1,0).
  const estados = REGRAS.filter((r) => /\.conq-cel\b/.test(r.sel) && !/:focus-visible/.test(r.sel)
    && ('outline' in r.decl || 'outline-color' in r.decl || 'outline-offset' in r.decl));
  assert.ok(estados.length >= 3, `só achei ${estados.length} regras de contorno de estado: o guard perdeu o alcance`);
  for (const [tema, regras] of [['claro', claro], ['escuro', escuro]]) {
    const piso = regras.map((r) => especificidade(r.sel)).reduce((x, y) => (maior(x, y) < 0 ? x : y));
    for (const est of estados) {
      if (tema === 'claro' && /^\.dark\b/.test(est.sel)) continue;     // o escuro não vale no claro
      assert.equal(maior(piso, especificidade(est.sel)), 1,
        `no tema ${tema} a regra de estado ${est.sel} (${especificidade(est.sel)}) empata ou vence o foco (${piso}): a célula focada fica igual à sem foco`);
    }
  }
  // SEM FOCO a célula não muda um pixel: o contorno do estado é o de sempre.
  assert.equal(regraDe('.conq-cel.nova').decl.outline, '2px solid #d97706');
  assert.equal(regraDe('.conq-cel.nova').decl['outline-offset'], '1px');
  assert.equal(regraDe('.conq-cel.sel').decl.outline, '2px solid #0e7490');
  assert.equal(regraDe('.conq-cel.sel').decl['outline-offset'], '1px');
  assert.equal(regraDe('.dark .conq-cel.sel').decl['outline-color'], '#22d3ee');
  // E o afastamento do foco (3 px + 2 de espessura = 5) cabe no vão de 6 px da grade: não toca a vizinha.
  assert.match(regraDe('.conq-grade').corpo, /gap: 6px/);
});

// ═══ R21-7-06 · o 2º botão dos diálogos de duas linhas sem recuo, com ou sem `@container` ═══════════════

test('R21-7-06 · nenhuma linha de botões dos diálogos usa space-x (a margem do 2º botão recuava sem @container)', () => {
  const linhas = HTML.match(/<div class="dialogo-acoes [^"]*">/g) || [];
  assert.ok(linhas.length >= 7, `só ${linhas.length} linhas com .dialogo-acoes`);
  for (const l of linhas) {
    assert.ok(!/\bspace-x-/.test(l), `${l}: o space-x põe margem à esquerda do 2º botão, e o empilhamento por flex-wrap não a zera sem @container`);
    assert.ok(/\bgap-3\b/.test(l), `${l}: o vão entre os botões é o gap-3`);
  }
  // O `flex-wrap` que empilha é incondicional (fora da consulta): é por isso que o recuo aparecia sem suporte.
  const linha = regraDe('.dialogo-acoes');
  assert.equal(linha.decl['flex-wrap'], 'wrap');
  assert.equal(linha.condicao, '');
  // O empilhado do lote 24 (0,3,1 + margens zeradas) fica, por defesa.
  const empilhado = REGRAS.find((r) => r.sel === '.dialogo-acoes.dialogo-acoes > button:not([hidden])');
  assert.ok(empilhado && empilhado.decl['margin-left'] === '0', 'a defesa do empilhado do lote 24 sumiu');
});

// ═══ R21-7-08 · o texto da vitrine é rem; o cartão e a grade cedem por @container em rem ═══════════════

// O N de cada `font-size`, em px a 1× (os que a vitrine tinha ANTES). `calc(N * var(--conq-px))` é N px a
// 1× — a conta é do teste: sem a tabela, um N trocado muda a vitrine de hoje sem ninguém ver.
const TAMANHOS_A_1X = {
  '.conq-emoji': 32, '.conq-eyebrow': 10.5, '.conq-nome': 18, '.conq-num': 15, '.conq-sub': 11, '.conq-link': 11,
  '.conq-deg': 13, '.conq-deg .e': 17, '.conq-deg .a': 11.5, '.conq-h h4': 11, '.conq-h span': 11,
  '.conq-cel .e': 22, '.conq-cel .n': 10.5, '.conq-dica': 12, '.conq-tag': 9,
};

test('R21-7-08 · cada font-size da vitrine é N × a unidade que cresce, com o MESMO N de antes (a 1× são os mesmos px)', () => {
  const un = REGRAS.find((r) => r.sel === '#historyBody' && r.decl['--conq-px']);
  assert.ok(un, 'a unidade --conq-px sumiu do #historyBody');
  // 1 px a 1× (a raiz tem 16 px: 0.0625rem é exatamente 1 px) e nunca MENOS que 1 px: o texto menor que o de
  // fábrica não encolhe os 9 e os 10,5 px que a vitrine já tem.
  assert.equal(un.decl['--conq-px'], 'max(1px, 0.0625rem)');
  assert.equal(0.0625 * 16, 1, 'a conta da unidade deixou de dar 1 px');
  for (const [sel, px] of Object.entries(TAMANHOS_A_1X)) {
    const r = regraDe(sel, '', 'font-size');
    assert.ok(r, `a regra de font-size de ${sel} sumiu`);
    const m = /^calc\(\s*([\d.]+)\s*\*\s*var\(--conq-px\)\s*\)$/.exec(r.decl['font-size'] || '');
    assert.ok(m, `${sel}: o font-size voltou a ser px ou perdeu a unidade (${r.decl['font-size']})`);
    assert.equal(Number(m[1]), px, `${sel}: o tamanho a 1× mudou (${m[1]} px, eram ${px})`);
  }
  // Nenhum `font-size` em px sobrou numa regra `.conq-*` (o `.lb-mini-selo` é da foto ampliada: não é daqui).
  for (const r of REGRAS) {
    if (!/\.conq-/.test(r.sel)) continue;
    assert.ok(!/^[\d.]+px$/.test(r.decl['font-size'] || ''), `${r.sel}: font-size em px (${r.decl['font-size']}) não acompanha o texto do sistema`);
  }
});

test('R21-7-08 · o cartão empilha por @container em rem no MESMO ponto em que o @media de 400 px empilha a 1×', () => {
  const cont = REGRAS.find((r) => r.sel === '#historyBody' && r.decl.container);
  assert.ok(cont, 'o #historyBody deixou de ser contêiner');
  assert.equal(cont.decl.container, 'historico / inline-size');
  // A conta, do HTML: a janela de 400 px menos o `p-4` do overlay, o `px-6` do corpo, o `p-3` da caixa e a
  // borda de 1 px dela (os dois lados de cada).
  assert.match(HTML, /id="filtersModal"[^>]*\bp-4\b/, 'o overlay dos Filtros perdeu o p-4: refaça a conta do corte do cartão');
  assert.match(HTML, /<div class="flex-1 overflow-y-auto overscroll-contain px-6 py-4">/, 'o corpo dos Filtros perdeu o px-6: refaça a conta');
  assert.match(HTML, /id="filtersPanelHistory"[^>]*>\s*<div class="bg-slate-50 border border-slate-100 rounded-xl p-3 /, 'a caixa do Histórico perdeu o p-3 ou a borda: refaça a conta');
  const cortePx = 400 - 2 * 16 - 2 * 24 - 2 * 12 - 2;
  const corteRem = cortePx / 16;
  assert.equal(corteRem, 18.375);
  const emp = TOPO.find((b) => b.cabeca === `@container historico (max-width: ${corteRem}rem)`);
  assert.ok(emp, `o @container do cartão não está em ${corteRem}rem (a conta dos 400 px do @media)`);
  // O que o @container faz é o MESMO que o @media de 400 px: as declarações são as mesmas, regra a regra.
  // (há outros `@media (max-width: 400px)` no arquivo: o da vitrine é o que traz o `.conq-topo`)
  const media = TOPO.find((b) => b.cabeca === '@media (max-width: 400px)' && /\.conq-topo\b/.test(b.corpo));
  assert.ok(media, 'o @media de 400 px da vitrine (a reserva sem @container e com o texto menor) sumiu');
  const regrasDe = (b) => Object.fromEntries(lerBlocos(b.corpo).map((x) => [norm(x.cabeca), declaracoes(x.corpo)]));
  const dMedia = regrasDe(media), dCont = regrasDe(emp);
  for (const sel of ['.conq-topo', '.conq-tot', '.conq-tot br', '.conq-rodape']) {
    assert.deepEqual(dCont[sel], dMedia[sel], `${sel}: o @container e o @media de 400 px divergem — o cartão empilharia diferente`);
  }
  assert.deepEqual(dCont['.conq-grade'], { 'grid-template-columns': 'repeat(2, 1fr)' });
  // O @media FICA, e a grade do @media de baixo também (duas colunas).
  assert.deepEqual(dMedia['.conq-topo'], { display: 'grid', 'grid-template-columns': 'auto 1fr', gap: '8px', 'align-items': 'center' });
  const mg = TOPO.filter((b) => b.cabeca === '@media (max-width: 400px)').flatMap((b) => lerBlocos(b.corpo)).find((x) => norm(x.cabeca) === '.conq-grade');
  assert.ok(mg, 'o @media de 400 px da grade (duas colunas) sumiu');
  // O @container vem DEPOIS das regras-base que ele muda (a ordem decide o empate).
  const ordem = (cab) => CSS.indexOf(cab);
  assert.ok(ordem(`@container historico (max-width: ${corteRem}rem)`) > ordem('.conq-grade {'), 'o @container do cartão vem antes da grade-base: perderia o empate');
});

test('R21-7-08 · a grade vai a UMA coluna só abaixo da vitrine do Galaxy Fold a 1× (que segue em duas, como sempre)', () => {
  const uma = TOPO.find((b) => /^@container historico \(max-width: [\d.]+rem\)$/.test(b.cabeca) && /grid-template-columns:\s*1fr/.test(b.corpo));
  assert.ok(uma, 'sumiu o @container de uma coluna da grade');
  const corte = Number(/max-width: ([\d.]+)rem/.exec(uma.cabeca)[1]);
  // A vitrine do Fold a 1×: 280 px − p-4 (32) − px-6 (48) − p-3 (24) − borda (2) = 174 px.
  const vitrineFold = (280 - 32 - 48 - 24 - 2) / 16;
  assert.equal(vitrineFold, 10.875);
  assert.ok(corte < vitrineFold, `o corte de uma coluna (${corte}rem) alcança a vitrine do Fold a 1× (${vitrineFold}rem): mudaria a grade de hoje`);
  // E tem que alcançar o que falhava: duas colunas precisam de 2 × (nome mais longo 76 + 4 de padding + 2 de borda) + 6 de vão = 170 px
  // a 1× = 10,625rem, e a conta em rem só cai com o texto maior (10,25 + 0,375/escala).
  const duasColunas = (2 * (76 + 4 + 2) + 6) / 16;
  assert.ok(corte >= 10.25 && corte < duasColunas + 0.01, `o corte (${corte}rem) está fora da faixa em que duas colunas deixam de caber (10,25 a ${duasColunas}rem)`);
});

test('R21-8-03 · até 10,5rem o RESTO da vitrine refluí (cartão com 8 px de respiro, topo em UMA coluna, nome em 16 px, escada em duas linhas, título que quebra) — e só aí', () => {
  const estreito = TOPO.find((b) => b.cabeca === '@container historico (max-width: 10.5rem)');
  assert.ok(estreito, 'sumiu o @container de até 10,5rem');
  const regras = lerBlocos(estreito.corpo).map((x) => ({ sel: norm(x.cabeca), decl: declaracoes(x.corpo) }));
  const de = (sel) => regras.find((r) => r.sel === sel)?.decl;
  assert.deepEqual(de('.conq-card'), { padding: '8px' }, 'o cartão perdeu os 8 px de respiro do corte estreito');
  assert.deepEqual(de('.conq-topo'), { 'grid-template-columns': '1fr' }, 'o topo do cartão não vira UMA coluna: o nome da patente (100 px a 1,3×) volta pra uma coluna de 67 px');
  assert.deepEqual(de('.conq-nome'), { 'font-size': 'calc(16 * var(--conq-px))' }, 'o nome da patente no corte estreito não usa 16 px × a escala');
  assert.deepEqual(de('.conq-h'), { 'flex-wrap': 'wrap', 'column-gap': '8px' }, 'o título "CONQUISTAS 5 de 16" não quebra a linha');
  const deg = de('.conq-deg');
  assert.ok(deg, 'a escada não refluí');
  assert.equal(deg['grid-template-columns'], 'auto 1fr auto');
  assert.equal(deg['grid-template-areas'], '"n n n" "e a m"', 'a escada tem que pôr o nome na linha inteira e o ícone, a pontuação e o marcador embaixo');
  for (const [filho, area] of [['.e', 'e'], ['.n', 'n'], ['.a', 'a'], ['.m', 'm']]) {
    assert.deepEqual(de('.conq-deg ' + filho), { 'grid-area': area }, `.conq-deg ${filho} não ocupa a área ${area}`);
  }
  // A REDE (quebrar a palavra) só vale dentro do corte: no modo normal ela partia o nome que passa uns px pro vão (medido: 0 → 2 palavras partidas).
  const rede = regras.find((r) => r.decl['overflow-wrap'] === 'break-word');
  assert.ok(rede && ['.conq-nome', '.conq-eyebrow', '.conq-deg .n', '.conq-h h4', '.conq-h span'].every((x) => rede.sel.split(',').map(norm).includes(x)),
    'a rede de quebra de palavra do corte estreito sumiu ou perdeu um seletor');
  for (const r of REGRAS) {
    if (r.condicao === estreito.cabeca) continue;
    if (/^\.conq-(nome|eyebrow|h h4|h span)$|^\.conq-deg \.n$/.test(r.sel)) assert.ok(r.decl['overflow-wrap'] !== 'break-word', `${r.sel}: overflow-wrap fora do corte estreito (${r.condicao || 'topo'}) parte o nome que hoje só passa pro vão`);
  }
  // O corte não alcança a vitrine do Fold a 1× (10,875rem) nem o `@media` de reserva: nada disso existe a 1×.
  assert.ok(10.5 < (280 - 32 - 48 - 24 - 2) / 16);
  // O bloco vem DEPOIS de tudo que ele troca (a ordem decide o empate): o empilhar do cartão, o `.conq-deg`, o `.conq-nome` e o `.conq-card`-base.
  const ordem = (cab) => CSS.indexOf(cab);
  for (const base of ['.conq-card {', '.conq-nome {', '.conq-deg {', '.conq-h {', '@container historico (max-width: 18.375rem)']) {
    assert.ok(ordem('@container historico (max-width: 10.5rem)') > ordem(base), `o corte estreito vem antes de ${base}: perderia o empate`);
  }
});

// ═══ D3 · a tabela de gestos da Ajuda ═══════════════════════════════════════════════════════════════

test('D3 · os ladrilhos de gesto da Ajuda quebram a palavra que não cabe SÓ abaixo da grade do Fold a 1× (que não muda), e o seletor encolhe', () => {
  assert.match(HTML, /<div class="ajuda-gestos grid grid-cols-3 gap-2 text-center text-xs">/, 'a tabela de gestos perdeu a classe ajuda-gestos');
  const g = regraDe('.ajuda-gestos');
  assert.ok(g && g.decl.container === 'ajuda-gestos / inline-size', 'a grade de gestos deixou de ser o contêiner da quebra');
  // A conta, do HTML: a janela menos o p-4 do overlay (32), o p-6 do cartão (48), o p-3 da caixa (24) e a borda (2).
  assert.match(HTML, /id="helpModal"[^>]*\bp-4\b/, 'o overlay da Ajuda perdeu o p-4: refaça a conta');
  assert.match(HTML, /<div id="helpModal"[^>]*>\s*<div class="[^"]*\bp-6\b/, 'o cartão da Ajuda perdeu o p-6: refaça a conta');
  assert.match(HTML, /<div class="bg-slate-50 border border-slate-200 rounded-xl p-3[^"]*">\s*<h4[^>]*data-i18n="help.howToProcess.title"/, 'a caixa da tabela de gestos perdeu o p-3 ou a borda: refaça a conta');
  const gradeDoFold = (280 - 32 - 48 - 24 - 2) / 16;
  assert.equal(gradeDoFold, 10.875);
  const cortes = TOPO.filter((b) => /^@container ajuda-gestos \(max-width: [\d.]+rem\)$/.test(b.cabeca));
  assert.equal(cortes.length, 2, 'esperava dois cortes: o geral e o do espanhol');
  const [geral, es] = cortes.map((b) => ({ rem: Number(/max-width: ([\d.]+)rem/.exec(b.cabeca)[1]), regras: regrasComuns(lerBlocos(b.corpo), b.cabeca) }));
  // O corte geral fica ABAIXO da grade do Fold a 1× (o menor a 1× de qualquer celular): pt/fr/en a 1× não mudam um pixel.
  assert.ok(geral.rem < gradeDoFold, `o corte geral (${geral.rem}rem) alcança a grade do Fold a 1× (${gradeDoFold}rem): quebraria o ladrilho de hoje`);
  assert.ok(geral.rem >= 10.58, `o corte geral (${geral.rem}rem) não alcança a grade em que o português já cruza a borda (10,58rem, a 412 px a 1,5×)`);
  assert.ok(geral.regras.some((r) => r.sel === '.ajuda-gestos > div' && r.decl['overflow-wrap'] === 'break-word'));
  // O espanhol cruza a borda a 1× no Fold (defeito): corte próprio, por :lang(es).
  assert.ok(es.rem > gradeDoFold && es.rem <= 12.6, `o corte do espanhol (${es.rem}rem) não cobre o Fold a 1× (${gradeDoFold}rem) ou passa de 12,6rem`);
  assert.ok(es.regras.some((r) => r.sel === ':lang(es) .ajuda-gestos > div' && r.decl['overflow-wrap'] === 'break-word'));
  // A grade de 320 px a 1× (13,4rem) e tudo acima ficam fora dos dois.
  assert.ok(es.rem < (320 - 32 - 48 - 24 - 2) / 16, 'o corte do espanhol alcança a grade de 320 px a 1×');
  // `hyphens: auto` também parte palavra que CABERIA na linha seguinte: mudaria o ladrilho de hoje.
  for (const r of [...geral.regras, ...es.regras]) assert.ok(!('hyphens' in r.decl) && !('-webkit-hyphens' in r.decl), 'hyphens: auto nos ladrilhos hifeniza o que cabe e muda o ladrilho de hoje');
  // Fora dos dois contêineres a grade não tem quebra nenhuma (o desenho de hoje).
  assert.ok(!REGRAS.some((r) => r.sel === '.ajuda-gestos > div' && r.condicao === '' && 'overflow-wrap' in r.decl), 'o overflow-wrap dos ladrilhos vale sempre: quebraria o do Fold a 1×');
  const sel = /<select id="langSelectHelp" class="([^"]*)"/.exec(HTML);
  assert.ok(sel && sel[1].split(/\s+/).includes('min-w-0'), 'o seletor de idioma da Ajuda não cede: a 2× sai pela direita do cartão');
});

// ═══ D4 · os botões do pareamento e o "Entendi" do Acesso restrito ═════════════════════════════════

test('D4 · o rótulo dos botões do pareamento e do "Acesso restrito" quebra dentro do botão', () => {
  for (const id of ['pairShowCodeBtn', 'pairCopyLinkBtn']) {
    const b = new RegExp(`<button id="${id}"[^>]*>([\\s\\S]*?)</button>`).exec(HTML);
    assert.ok(b, `${id} sumiu`);
    assert.match(b[1], /<svg class="[^"]*\bflex-shrink-0\b[^"]*"/, `${id}: o ícone tem que ser flex-shrink-0 (o rótulo é quem cede)`);
    const sp = /<span class="([^"]*)" data-i18n="[^"]+">/.exec(b[1]);
    assert.ok(sp, `${id}: o rótulo perdeu a classe`);
    const c = sp[1].split(/\s+/);
    assert.ok(c.includes('min-w-0') && c.includes('break-words'), `${id}: o rótulo (item de flex) precisa de min-w-0 e break-words pra caber no botão`);
  }
  // Os dois de TEXTO SÓ quebram por CSS, por id: a classe no HTML os tiraria do molde dos botões dos outros
  // diálogos (o `test/entrada.test.mjs` compara as classes do "Entendi" com as do afirmativo dos outros).
  const r = regraDe('#pairShowClose');
  assert.ok(r && r.decl['overflow-wrap'] === 'break-word', 'o "Fechar" do pareamento não quebra o rótulo que não cabe');
  assert.ok(REGRAS.some((x) => x.sel === '#closeAccessDenied' && x.decl['overflow-wrap'] === 'break-word'), 'o "Entendi" do Acesso restrito não quebra o rótulo que não cabe');
  for (const id of ['pairShowClose', 'closeAccessDenied']) {
    const b = new RegExp(`<button id="${id}" type="button" class="([^"]*)"`).exec(HTML);
    assert.ok(b && !b[1].split(/\s+/).includes('break-words'), `${id}: a classe break-words no HTML tira o botão do molde dos outros diálogos — a quebra mora no CSS, por id`);
  }
});

test('R21-8-04 · o "Acesso restrito" quebra a palavra que não cabe no título, na 1ª frase e no nome do perfil (Fold a 1,5×)', () => {
  // A coluna do texto ao lado do ícone é item de um `flex`: sem `min-w-0` ela não encolhe abaixo da palavra mais longa
  // («Restricted», «Acceso») e o título e a frase saem do cartão pela direita; o `break-words` parte a que não cabe.
  const col = /<div class="([^"]*)">\s*<h3 id="accessDeniedTitle"/.exec(HTML);
  assert.ok(col, 'a coluna do título do Acesso restrito mudou de forma: refaça o guard');
  const c = col[1].split(/\s+/);
  assert.ok(c.includes('min-w-0') && c.includes('break-words'), `a coluna do título do "Acesso restrito" precisa de min-w-0 e break-words (tem: ${col[1]})`);
  // O nome de quem entrou é montado pelo JS dentro da caixa do perfil: a quebra mora no CSS, por id.
  assert.ok(REGRAS.some((x) => x.sel === '#accessDeniedProfile' && x.decl['overflow-wrap'] === 'break-word'), 'o nome do perfil no Acesso restrito não quebra a palavra que não cabe');
  // `overflow-wrap` só age quando a palavra NÃO cabe: nenhuma dessas regras pode ser `anywhere` (muda o min-content) nem `hyphens`.
  for (const sel of ['#pairShowClose', '#closeAccessDenied', '#accessDeniedProfile']) {
    const r = regraDe(sel);
    assert.ok(r && !('hyphens' in r.decl) && r.decl['overflow-wrap'] === 'break-word', `${sel}: só overflow-wrap: break-word`);
  }
});

// ═══ R21-8-02 · as ações que empilharam ficam à vista ═════════════════════════════════════════════════

// Os cartões cuja fileira de ações (ou o botão único) é o ÚLTIMO filho da rolagem: cinco com a fileira `.dialogo-acoes` de dois
// botões e dois com um botão só (o fim do treino e o "Acesso restrito"), que ficam presos pela mesma regra.
const CARTOES_COM_ACOES = ['pasteModal', 'comoFuncionaModal', 'logoutModal', 'pairEnterModal', 'batchReadModal'];
const CARTOES_COM_BOTAO_UNICO = [['treinoFimModal', 'treinoFimOk'], ['accessDeniedModal', 'closeAccessDenied']];

test('R21-8-02 · a fileira de ações que EMPILHA fica presa no fim do cartão do diálogo (sticky) só quando o cartão ROLA, e só no estado empilhado', () => {
  const cartao = regraDe('.dialogo-cartao');
  assert.ok(cartao, 'sumiu a regra do cartão do diálogo');
  // O contêiner é o CARTÃO: a fileira é contêiner dos próprios botões, e um contêiner não se estiliza por si.
  assert.equal(cartao.decl.container, 'dialogo / inline-size');
  const empilha = TOPO.find((b) => /^@container \(max-width: [\d.]+rem\)$/.test(b.cabeca) && /flex:\s*1 1 100%/.test(b.corpo));
  assert.ok(empilha, 'sumiu o @container que empilha os botões');
  const corteEmpilha = Number(/max-width: ([\d.]+)rem/.exec(empilha.cabeca)[1]);
  // E ele fica abaixo da fileira do Galaxy Fold a 1× (280 − p-4 − p-6 = 200 px = 12,5rem): a 1× nenhum celular entra.
  assert.ok(corteEmpilha < (280 - 32 - 48) / 16, `o corte (${corteEmpilha}rem) alcança a fileira do Fold a 1× (12,5rem): mudaria os diálogos de hoje`);

  // ── O PORTÃO: a fileira só prende quando o cartão tem para onde rolar (consulta de rolagem do contêiner) ────────────────────
  // Presa SEMPRE (o 1º desenho), o `sticky` fazia o Chromium promover a fileira a camada própria e rasterizar o texto dos botões
  // com subpixel: 76 dos 336 diálogos empilhados que CABEM mudavam, com a geometria igual. Com o portão, onde cabe a fileira fica
  // no fluxo, como sempre. Navegador SEM `scroll-state` (o WebKit 27.2; o Firefox, até onde se sabe) fica com a regra sem o portão (`@supports not`).
  const COND = '(container-type: scroll-state)';
  const suporta = TOPO.filter((b) => b.cabeca === `@supports ${COND}`);
  const semSuporte = TOPO.filter((b) => b.cabeca === `@supports not ${COND}`);
  assert.equal(suporta.length, 1, `sumiu (ou duplicou) o @supports ${COND}`);
  assert.equal(semSuporte.length, 1, `sumiu (ou duplicou) o @supports not ${COND}: o navegador sem scroll-state ficaria sem a fileira presa`);
  const doSuporta = lerBlocos(suporta[0].corpo);
  const doSem = lerBlocos(semSuporte[0].corpo);
  // O cartão só vira contêiner de rolagem dentro do @supports; a regra de topo (`container: dialogo / inline-size`) segue valendo sozinha lá fora.
  const tipo = doSuporta.find((b) => b.cabeca === '.dialogo-cartao');
  assert.ok(tipo, 'o @supports não torna o cartão contêiner de rolagem (container-type: inline-size scroll-state)');
  assert.deepEqual(declaracoes(tipo.corpo), { 'container-type': 'inline-size scroll-state' },
    'o cartão tem que continuar `inline-size` (a largura da fileira) E ganhar `scroll-state`; mexer em outra coisa muda o contêiner nomeado');
  const comPortao = doSuporta.filter((b) => b !== tipo);
  assert.equal(comPortao.length, 1, 'o @supports (scroll-state) tem que ter só o contêiner do cartão e UM @container com o portão');
  const mPortao = /^@container dialogo \(max-width: ([\d.]+)rem\) and scroll-state\(scrollable: block\)$/.exec(comPortao[0].cabeca);
  assert.ok(mPortao, `o @container do portão mudou de forma (${comPortao[0].cabeca}): tem que ser a largura E o cartão rolando no eixo do bloco`);
  assert.equal(doSem.length, 1, 'o @supports not tem que ter só o @container da fileira presa');
  const mSem = /^@container dialogo \(max-width: ([\d.]+)rem\)$/.exec(doSem[0].cabeca);
  assert.ok(mSem, `o @container do navegador sem scroll-state mudou de forma (${doSem[0].cabeca}): só a largura`);
  // A caixa de conteúdo do cartão (a que o contêiner mede) é a largura da fileira: o MESMO corte do empilhamento, nos DOIS ramos.
  assert.equal(Number(mPortao[1]), corteEmpilha, 'a fileira prende num corte diferente do que ela empilha: ficaria presa lado a lado, ou empilhada solta');
  assert.equal(Number(mSem[1]), corteEmpilha, 'o ramo sem scroll-state prende num corte diferente do que a fileira empilha');
  // Os dois ramos têm o MESMO corpo: o que muda de um para o outro é só o portão. Corpo diferente é o navegador sem scroll-state
  // desenhando outra coisa (e o WebKit é onde o smoke mede).
  assert.equal(norm(comPortao[0].corpo), norm(doSem[0].corpo), 'os dois ramos da fileira presa têm que dizer a mesma coisa');

  const regrasPresas = regrasComuns(lerBlocos(comPortao[0].corpo), comPortao[0].cabeca);
  const r = regrasPresas.find((x) => x.sel === '.acoes-presas');
  assert.ok(r, 'a regra .acoes-presas sumiu do @container');
  assert.equal(r.decl.position, 'sticky');
  assert.equal(r.decl.bottom, '0');
  // A cor do cartão (bg-white / dark:bg-slate-800) a 99,6% (254/255) — e NÃO opaca: com a cor opaca o Chromium rasteriza o texto da fileira com
  // antisserrilhado de subpixel, e os 336 estados empilhados que CABEM mudavam de 1.000 a 2.000 pixels (MEDIDO; com 99,6%, 0 nos dois temas; a 99% o
  // escuro mudava 1 nível por arredondamento da mistura).
  assert.equal(r.decl.background, 'rgba(255, 255, 255, 0.996)', 'a fileira presa tem que ter a cor do cartão a 99,6% (claro): opaca liga o antisserrilhado de subpixel e muda o diálogo que cabe');
  const escuro = regrasPresas.find((x) => x.sel === '.dark .acoes-presas');
  assert.ok(escuro, 'a fileira presa perdeu a cor do cartão no escuro');
  assert.equal(escuro.decl.background, 'rgba(30, 41, 59, 0.996)', 'a fileira presa tem que ter a cor do cartão a 99,6% (escuro, slate-800 = 30, 41, 59)');
  // Sem margem nem padding na própria fileira: nada que mexa na altura do conteúdo (a 1× ela nem entra aqui, mas o estado
  // empilhado que CABE tem que ficar com a altura de sempre).
  for (const p of ['margin', 'margin-bottom', 'padding', 'padding-bottom', 'height']) assert.ok(!(p in r.decl), `a fileira presa mexe em ${p}: mudaria a altura do conteúdo`);
  // O sticky prende na borda do CONTEÚDO do cartão: sobra o respiro do p-6 (1,5rem) embaixo, e o ::after o pinta na largura da fileira.
  const depois = regrasPresas.find((x) => x.sel === '.acoes-presas::after');
  assert.ok(depois, 'o ::after que pinta o respiro de baixo da fileira presa sumiu');
  assert.equal(depois.decl.position, 'absolute');
  assert.equal(depois.decl.top, '100%');
  assert.equal(depois.decl.left, '0');
  assert.equal(depois.decl.right, '0', 'o respiro pintado passa da largura da fileira e alcançaria os cantos arredondados do cartão');
  // 1 px a menos que o respiro: a borda de baixo do cartão cai no meio de um pixel com o texto fracionário, e pintar até ela
  // duplicaria a cobertura da única linha que mistura a cor do cartão com a do fundo (o estado empilhado que CABE ficaria diferente).
  assert.equal(depois.decl.height, 'calc(1.5rem - 1px)');
  assert.equal(depois.decl.background, 'inherit');

  // Fora dos dois @container a classe não tem NENHUMA regra: onde cabe, nenhum pixel muda. Cada ramo tem as três (a fileira, a do
  // escuro e o ::after) e nenhuma mais — regra a mais, ou fora da consulta, valeria também lado a lado.
  const dela = REGRAS.filter((x) => /\.acoes-presas\b/.test(x.sel));
  assert.ok(!dela.some((x) => x.condicao === ''), '.acoes-presas tem regra fora do @container: valeria também lado a lado');
  assert.deepEqual(dela.map((x) => x.condicao).sort(), [
    comPortao[0].cabeca, comPortao[0].cabeca, comPortao[0].cabeca, doSem[0].cabeca, doSem[0].cabeca, doSem[0].cabeca,
  ].sort(), '.acoes-presas tem regra fora dos dois @container da fileira presa (ou faltou uma das três em algum ramo)');
  // E o `container-type` com `scroll-state` mora SÓ dentro do @supports: fora dele um navegador sem a palavra descartaria a
  // declaração inteira, e o cartão perderia a largura que o corte de 12,4rem mede.
  const comScroll = REGRAS.filter((x) => /scroll-state/.test(x.decl['container-type'] || ''));
  assert.deepEqual(comScroll.map((x) => `${x.sel} @ ${x.condicao}`), [`.dialogo-cartao @ @supports ${COND}`],
    'o container-type: scroll-state tem que aparecer uma vez só, no .dialogo-cartao dentro do @supports');
});

test('R21-8-02 · cada cartão com a fileira dentro da rolagem é contêiner, tem o p-6 e a fileira (ou o botão único) presa', () => {
  const cartaoDe = (id) => {
    const m = new RegExp(`<div id="${id}"[^>]*>\\s*<div class="([^"]*)">([\\s\\S]*?)\\n        </div>\\n`).exec(HTML);
    assert.ok(m, `${id}: o cartão mudou de forma`);
    const c = m[1].split(/\s+/);
    assert.ok(c.includes('dialogo-cartao'), `${id}: o cartão não é contêiner (dialogo-cartao)`);
    assert.ok(c.includes('p-6'), `${id}: o cartão perdeu o p-6 — o respiro de 1,5rem que o ::after pinta deixa de bater`);
    assert.ok(c.includes('overflow-y-auto'), `${id}: o cartão não rola — sticky não tem o que prender`);
    // A fileira presa tem a cor do cartão escrita à mão (255,255,255 e 30,41,59 a 99,6%): o cartão tem que ser essas duas cores.
    assert.ok(c.includes('bg-white') && c.includes('dark:bg-slate-800'), `${id}: o cartão mudou de cor — refaça o fundo da .acoes-presas (rgba(255,255,255,.996) e rgba(30,41,59,.996))`);
    return m[2];
  };
  for (const id of CARTOES_COM_ACOES) {
    assert.match(cartaoDe(id), /<div class="dialogo-acoes acoes-presas\b[^"]*">/, `${id}: a fileira de ações não é .acoes-presas`);
  }
  for (const [id, botao] of CARTOES_COM_BOTAO_UNICO) {
    assert.match(cartaoDe(id), new RegExp(`<div class="acoes-presas">\\s*<button id="${botao}"`), `${id}: o botão único não está na .acoes-presas`);
  }
  // Nenhuma outra fileira usa a classe: o rodapé dos Filtros e o do Resumo são de outro desenho.
  const total = CARTOES_COM_ACOES.length + CARTOES_COM_BOTAO_UNICO.length;
  const usos = (HTML.match(/class="[^"]*\bacoes-presas\b[^"]*"/g) || []).length;
  assert.equal(usos, total, `.acoes-presas em ${usos} lugares (esperava ${total})`);
  const cartoesNoHtml = (HTML.match(/class="[^"]*\bdialogo-cartao\b[^"]*"/g) || []).length;
  assert.equal(cartoesNoHtml, total, `.dialogo-cartao em ${cartoesNoHtml} lugares (esperava ${total})`);
});

// ═══ o comentário que mentia ══════════════════════════════════════════════════════════════════════

test('o comentário do .seg-tab diz o número que o código usa (6.3cqw, 6,3%)', () => {
  const i = CSS_CRU.indexOf('.seg-tab {');
  const trecho = CSS_CRU.slice(i, CSS_CRU.indexOf('}', i));
  assert.match(trecho, /min\(0\.8125rem, 6\.3cqw\)/, 'o código do .seg-tab mudou de número: refaça o comentário');
  const comentario = (trecho.match(/\/\*[\s\S]*?\*\//g) || []).join('\n');
  assert.match(comentario, /6\.3cqw/);
  assert.match(comentario, /6,3%/);
  assert.ok(!/6[.,]25\s*cqw/.test(comentario), 'o comentário voltou a citar 6.25cqw');
  assert.ok(!/6,25%\s+da faixa/.test(comentario), 'o comentário voltou a dizer que 6,25% da faixa são 12 px');
});

// ═══ R21-7-01 · o contraste alto do sistema (forced-colors: active) ═════════════════════════════════

const CAB_FORCADO = '@media (forced-colors: active)';
const FORCADO = TOPO.filter((b) => b.cabeca === CAB_FORCADO);
const REGRAS_FORCADO = FORCADO.flatMap((b) => regrasComuns(lerBlocos(b.corpo), CAB_FORCADO));
const forcada = (sel, prop) => REGRAS_FORCADO.find((r) => r.sel === sel && (!prop || prop in r.decl));

test('R21-7-01 · um bloco de contraste alto cobre cada componente que dizia o estado só pelo fundo', () => {
  assert.equal(FORCADO.length, 1, 'o contraste alto é UM bloco @media (forced-colors: active): o guard de layout lê a primeira ocorrência de cada texto de @media');
  // O botão preenchido por fundo é texto solto: o Tailwind zera a borda. (Seletor de elemento: quem já tem borda por classe a mantém.)
  assert.equal(forcada('button').decl.border, '1px solid ButtonText');
  assert.equal(forcada('.undo-banner button').decl.border, '1px solid ButtonText', 'o Desfazer tem `border: none` (0,1,1) e ganha do `button`');
  // O interruptor: trilho com borda, botão, e ligado em Highlight — com cores SÓ do sistema.
  const sw = forcada('input.ui-switch.ui-switch').decl;
  assert.equal(sw['forced-color-adjust'], 'none');
  assert.equal(sw.background, 'Canvas');
  assert.equal(sw.border, '2px solid ButtonText');
  const polegar = forcada('input.ui-switch.ui-switch::after').decl;
  assert.equal(polegar.background, 'ButtonText');
  assert.equal(polegar['box-shadow'], 'none');
  // A borda de 2 px empurra a origem do botão (posição absoluta é do padding box): os 3 px de antes viram 1 px,
  // e o botão de 20 px segue centrado no trilho de 22 px (1 px de folga em cima, embaixo e dos lados).
  assert.equal(polegar.top, '1px');
  assert.equal(polegar.left, '1px');
  assert.equal(regraDe('input.ui-switch::after', '', 'top').decl.top, '3px', 'o botão do interruptor fora do contraste alto mudou (era 3px)');
  assert.equal(forcada('input.ui-switch.ui-switch:checked').decl.background, 'Highlight');
  assert.equal(forcada('input.ui-switch.ui-switch:checked::after').decl.background, 'HighlightText');
  assert.equal(forcada('input.ui-switch.ui-switch:disabled').decl['border-color'], 'GrayText');
  // A aba selecionada é a inversão do sistema pra "selecionado" — FUNDO, e não contorno: o `:focus-visible` (0,1,0)
  // perde pra um contorno de estado (o do R21-7-05), e a aba focada precisa do anel.
  const aba = forcada('.seg-tab.seg-tab[aria-selected="true"]').decl;
  assert.equal(aba.background, 'Highlight');
  assert.equal(aba.color, 'HighlightText');
  assert.ok(!('outline' in aba), 'a aba selecionada usa contorno: ele esconderia o anel de foco dela');
  // O BACKPLATE: texto sobre `Highlight` não opaco ganha do navegador uma placa de Canvas atrás — e o HighlightText ficava branco sobre
  // branco (a aba vinha com uma barra branca no lugar do rótulo). `forced-color-adjust: none` tira a placa.
  assert.equal(aba['forced-color-adjust'], 'none', 'a aba selecionada sem forced-color-adjust: none perde o rótulo (branco sobre a placa branca do navegador)');
  // O cartão de cada diálogo e o aviso passageiro: sem sombra nem fundo de cor, a borda (e o fundo opaco do aviso) os separa do que está atrás.
  assert.equal(forcada('.modal-root > div').decl.border, '1px solid CanvasText');
  assert.equal(forcada('.toast').decl.background, 'Canvas');
  assert.equal(forcada('.toast').decl.border, '1px solid CanvasText');
  // A barra de progresso, o pontinho, a etiqueta "nova" e as células.
  assert.equal(forcada('.conq-barra').decl.border, '1px solid CanvasText');
  assert.equal(forcada('.conq-barra.conq-barra > i').decl.background, 'Highlight');
  assert.equal(forcada('.conq-barra.conq-barra > i').decl['forced-color-adjust'], 'none');
  assert.equal(forcada('.conq-selo.conq-selo').decl.background, 'Highlight');
  assert.equal(forcada('.conq-selo.conq-selo').decl.border, '1px solid CanvasText');
  assert.equal(forcada('.conq-tag.conq-tag').decl.border, '1px solid CanvasText');
  const on = forcada('.conq-cel.conq-cel.on').decl.border, off = forcada('.conq-cel.conq-cel.off').decl.border;
  assert.notEqual(on, off, '"ganha" e "trancada" são iguais no contraste alto');
  assert.match(on, /solid/);
  assert.match(off, /dashed/);
  assert.equal(forcada('.undo-progress').decl.background, 'Highlight');
});

test('R21-7-01 · dentro do contraste alto só entram cores DO SISTEMA (cor do autor é trocada ou, com forced-color-adjust: none, vence o modo)', () => {
  const SISTEMA = /^(Canvas|CanvasText|ButtonText|ButtonFace|ButtonBorder|Highlight|HighlightText|GrayText|LinkText|VisitedText|ActiveText|Field|FieldText|Mark|MarkText|SelectedItem|SelectedItemText|transparent|currentcolor|none)$/i;
  const props = ['color', 'background', 'background-color', 'border-color', 'outline-color'];
  let vistas = 0;
  for (const r of REGRAS_FORCADO) {
    for (const [p, v] of Object.entries(r.decl)) {
      const cores = [];
      if (props.includes(p)) cores.push(v);
      if (p === 'border' || p === 'outline') cores.push(...v.split(/\s+/).filter((x) => !/^(\d|solid$|dashed$|dotted$|double$|none$)/.test(x)));
      for (const c of cores) { vistas++; assert.match(c, SISTEMA, `${r.sel} { ${p}: ${v} } usa uma cor que não é do sistema (${c})`); }
    }
  }
  assert.ok(vistas >= 15, `o guard só viu ${vistas} cores: ele perdeu o alcance`);
});

test('R21-7-01 · cada seletor do contraste alto empata ou vence a variante .dark da regra-base que ele troca, e vem DEPOIS dela', () => {
  // O `.dark` das regras-base tem uma classe a mais: sem repetir a classe (`.x.x`), o escuro do app continuava ganhando do modo.
  const PARES = [
    ['input.ui-switch.ui-switch', '.dark input.ui-switch'],
    ['input.ui-switch.ui-switch:checked', '.dark input.ui-switch:checked'],
    ['.seg-tab.seg-tab[aria-selected="true"]', '.dark .seg-tab[aria-selected="true"]'],
    ['.conq-barra.conq-barra > i', '.dark .conq-barra > i'],
    ['.conq-cel.conq-cel.on', '.dark .conq-cel.on'],
    ['.conq-cel.conq-cel.off', '.dark .conq-cel.off'],
    ['.conq-selo.conq-selo', '.dark .conq-selo'],
    ['.conq-tag.conq-tag', '.dark .conq-tag'],
  ];
  const pos = CSS.indexOf(CAB_FORCADO);
  assert.ok(pos > 0);
  for (const [forcado, base] of PARES) {
    assert.ok(forcada(forcado), `sumiu a regra ${forcado} do contraste alto`);
    const rb = regraDe(base);
    assert.ok(rb, `sumiu a regra-base ${base}`);
    assert.ok(maior(especificidade(forcado), especificidade(base)) >= 0, `${forcado} (${especificidade(forcado)}) perde pra ${base} (${especificidade(base)}): o escuro do app venceria o modo`);
    // O bloco vem depois: o empate se decide pela ordem.
    assert.ok(CSS.lastIndexOf(base + ' {') < pos, `a regra-base ${base} vem DEPOIS do bloco do contraste alto e ganha o empate`);
  }
});

test('R21-7-01 · o contraste alto não vaza: forced-color-adjust e as regras dele só existem dentro do @media', () => {
  for (const r of REGRAS) {
    if (r.condicao === CAB_FORCADO) continue;
    assert.ok(!('forced-color-adjust' in r.decl), `${r.sel} usa forced-color-adjust fora do @media (forced-colors: active)`);
  }
  // Fora do modo, a regra-base do interruptor e a da barra seguem sem borda (o app não muda um pixel).
  assert.ok(!('border' in regraDe('input.ui-switch').decl));
  assert.ok(!('border' in regraDe('.conq-barra').decl));
});
