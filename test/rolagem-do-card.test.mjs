// A PÁGINA NÃO ROLA COM O CARD NO AR (relato do dono, 2026-11-07).
//
// O card gira (até 30°) e sai a 1,5× a largura da janela. Pra DIREITA o excesso
// cai do lado que rola e o canto de baixo desce, então a página ganhava
// rolagem nos dois eixos pelos ~350 ms da saída, e o app pinta as barras
// (finas, claras) nas bordas direita e de baixo: as "linhas brancas" do vídeo.
// MEDIDO a 393×740: +689 px de largura e +36 de altura pra direita, ZERO pra
// esquerda e em repouso. O conserto liga `html.card-em-voo` (overflow: hidden)
// só durante o gesto — `sincronizarCorteDaPagina`, no swipe.js.
//
// O que o navegador faz com isso mora no `tools/smoke-fluxo.mjs` (seção 7, com
// o controle sem o conserto). Aqui ficam o que dá pra provar sem navegador: a
// regra do CSS, a lógica da função (executada de verdade) e os PONTOS onde ela
// tem que ser chamada. Cada guard foi sabotado: tirado o conserto, reprova.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Por LINHA no JS (nunca `replace(/\/\/[^\n]*/g, '')`, que come URLs — gotcha #67) e por bloco no CSS.
const semComentarioJs = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const semComentarioCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const SWIPE = semComentarioJs(ler('js/swipe.js'));
const CSS = semComentarioCss(ler('css/styles.css'));

const fatiar = (src, nome) => {
  const i = src.indexOf(`function ${nome}(`);
  assert.ok(i > 0, `${nome} sumiu do swipe.js`);
  return src.slice(i, src.indexOf('\n}', i) + 2);
};

test('rolagem do card: a regra do CSS corta a página SÓ com a classe — o horizontal sempre, o vertical só se ela não rolava', () => {
  assert.match(CSS, /html\.card-em-voo\s*\{\s*overflow-x:\s*hidden;?\s*\}/,
    'html.card-em-voo { overflow-x: hidden } sumiu do styles.css: a página volta a ganhar barra horizontal com o card no ar');
  assert.match(CSS, /html\.card-em-voo:not\(\.card-pagina-rola\)\s*\{\s*overflow-y:\s*hidden;?\s*\}/,
    'o corte vertical (só pra página que NÃO rolava) sumiu: sem ele a barra de baixo volta, e sem o :not ele tira a barra clássica de quem já rola');
  // Não pode morar na raiz o tempo todo: a página rola na vertical de propósito em tela baixa.
  assert.doesNotMatch(CSS, /(^|\n)\s*html\s*\{[^}]*overflow(-x|-y)?:\s*(hidden|clip)/,
    'o corte não pode ser permanente na raiz (a rolagem vertical é de propósito em tela baixa)');
  assert.ok(ler('css/app.css').includes('html.card-em-voo{overflow-x:hidden}'), 'css/app.css gerado está velho: npm run css');
});

test('rolagem do card: a barra da PÁGINA no tema escuro — o `.dark *` não pega o próprio <html>', () => {
  // `dark` mora no <html> e no <body>; `.dark *` e `.dark ::-webkit-…` só pegam descendentes.
  assert.match(CSS, /\.dark,\s*\.dark \*\s*\{\s*scrollbar-color:/, 'scrollbar-color do tema escuro não cobre o <html>');
  for (const parte of ['track', 'thumb', 'thumb:hover']) {
    assert.match(CSS, new RegExp(`\\.dark::-webkit-scrollbar-${parte.replace(':', '\\:')}`),
      `.dark::-webkit-scrollbar-${parte} sumiu: a barra da página volta clara no tema escuro`);
  }
});

// A função, EXECUTADA: só liga com o card no DOM (o arraste ÓRFÃO deixa o `isDragging` preso),
// e mede se a página JÁ rolava na vertical no instante em que liga.
function montarCorte({ alturaDoConteudo = 740, alturaDaJanela = 740 } = {}) {
  const classes = new Set();
  const raiz = { classList: {
    toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); },
    contains: (c) => classes.has(c),
    remove: (c) => { classes.delete(c); },
  } };
  const medida = { scrollHeight: alturaDoConteudo, clientHeight: alturaDaJanela };
  const documento = { documentElement: raiz, scrollingElement: medida };
  const estado = { isDragging: false, currentCard: null, cardVoltando: null, cardSaindo: null };
  const corpo = fatiar(SWIPE, 'sincronizarCorteDaPagina');
  const roda = new Function('document', 'est', `
    let isDragging, currentCard, cardVoltando, cardSaindo;
    return function () {
      ({ isDragging, currentCard, cardVoltando, cardSaindo } = est);
      ${corpo}
      sincronizarCorteDaPagina();
    };`)(documento, estado);
  return { classes, estado, roda, medida };
}
const card = (conectado = true) => ({ isConnected: conectado });

test('rolagem do card: liga arrastando, saindo e voltando; desliga em repouso', () => {
  const t = montarCorte();
  t.roda(); assert.equal(t.classes.has('card-em-voo'), false, 'em repouso a classe não pode estar ligada');
  Object.assign(t.estado, { isDragging: true, currentCard: card() });
  t.roda(); assert.equal(t.classes.has('card-em-voo'), true, 'arrastando');
  Object.assign(t.estado, { isDragging: false, currentCard: null, cardSaindo: card() });
  t.roda(); assert.equal(t.classes.has('card-em-voo'), true, 'saindo');
  Object.assign(t.estado, { cardSaindo: null, cardVoltando: card() });
  t.roda(); assert.equal(t.classes.has('card-em-voo'), true, 'voltando');
  Object.assign(t.estado, { cardVoltando: null });
  t.roda(); assert.equal(t.classes.has('card-em-voo'), false, 'terminado o gesto');
});

test('rolagem do card: arraste ÓRFÃO (isDragging preso, card fora do DOM) NÃO prende a classe', () => {
  const t = montarCorte();
  Object.assign(t.estado, { isDragging: true, currentCard: card(false) });
  t.roda();
  assert.equal(t.classes.has('card-em-voo'), false,
    'classe presa travaria a rolagem da página inteira até alguém tocar num card');
  // E o card que saiu do DOM no meio da saída também solta.
  Object.assign(t.estado, { isDragging: false, currentCard: null, cardSaindo: card(false) });
  t.roda(); assert.equal(t.classes.has('card-em-voo'), false);
});

test('rolagem do card: a função é chamada em TODA mudança de estado do gesto', () => {
  const quando = [
    ['começo do arraste', fatiar(SWIPE, 'handleDragStart'), /isDragging = true;\s*capturouNesteGesto = false;\s*currentCard = e\.currentTarget;\s*sincronizarCorteDaPagina\(\);/],
    ['o cancelamento do arraste', fatiar(SWIPE, 'handleDragCancel'), /voltarProLugar\(currentCard\);\s*currentCard = null;\s*sincronizarCorteDaPagina\(\);/],
    ['a volta pro lugar começa', fatiar(SWIPE, 'voltarProLugar'), /cardVoltando = card;\s*sincronizarCorteDaPagina\(\);/],
    ['a volta pro lugar termina', fatiar(SWIPE, 'voltarProLugar'), /cardVoltando = null;\s*sincronizarCorteDaPagina\(\);/],
    ['a saída começa', fatiar(SWIPE, 'animateSwipeOut'), /cardSaindo = card;\s*sincronizarCorteDaPagina\(\);/],
    ['a saída termina', fatiar(SWIPE, 'animateSwipeOut'), /if \(cardSaindo === card\) cardSaindo = null;\s*sincronizarCorteDaPagina\(\);/],
    ['card novo na tela (desfaz o órfão)', fatiar(SWIPE, 'enableSwipeOnCard'), /sincronizarCorteDaPagina\(\);\s*\}$/],
  ];
  for (const [onde, corpo, re] of quando) {
    assert.match(corpo, re, `${onde}: faltou sincronizarCorteDaPagina() — a classe fica no estado velho`);
  }
});

test('rolagem do card: o diagnóstico leva a rolagem da página e a sentinela existe', () => {
  const app = ler('js/app.js');
  assert.match(app, /fora\.paginaRola = \{[\s\S]*?excessoX:[\s\S]*?cardEmVoo:/, 'o computado não traz a rolagem da página');
  assert.match(app, /diga\('paginaRolaComCardNoAr'/, 'a sentinela paginaRolaComCardNoAr sumiu');
});

test('rolagem do card: a página que JÁ rola na vertical ganha `card-pagina-rola` (o corte vertical NÃO vale)', () => {
  // 360×740 com texto 1,5×: o conteúdo passa da janela em repouso, com o card ainda parado.
  const t = montarCorte({ alturaDoConteudo: 759, alturaDaJanela: 740 });
  Object.assign(t.estado, { isDragging: true, currentCard: card() });
  t.roda();
  assert.equal(t.classes.has('card-em-voo'), true);
  assert.equal(t.classes.has('card-pagina-rola'), true, 'a página rolava e o corte vertical a pararia (scrollY 19→0 medido)');
  // A medida é do INSTANTE em que liga: o excesso que o card soma depois não a muda.
  t.medida.scrollHeight = 900; t.roda();
  assert.equal(t.classes.has('card-pagina-rola'), true);
  // Acabou o gesto: as duas saem.
  Object.assign(t.estado, { isDragging: false, currentCard: null });
  t.roda();
  assert.equal(t.classes.has('card-em-voo'), false);
  assert.equal(t.classes.has('card-pagina-rola'), false, 'a marca presa faria o PRÓXIMO gesto de uma página que não rola deixar de cortar');
});

test('rolagem do card: a página que NÃO rola não ganha `card-pagina-rola` — e o excesso do card depois não conta', () => {
  const t = montarCorte({ alturaDoConteudo: 740, alturaDaJanela: 740 });
  Object.assign(t.estado, { isDragging: true, currentCard: card() });
  t.roda();
  assert.equal(t.classes.has('card-em-voo'), true);
  assert.equal(t.classes.has('card-pagina-rola'), false);
  // O card gira, o excesso vertical aparece (+36): a classe NÃO muda no meio do gesto.
  t.medida.scrollHeight = 776; t.roda();
  assert.equal(t.classes.has('card-pagina-rola'), false, 'medir no meio do gesto contaria o excesso do próprio card');
});
