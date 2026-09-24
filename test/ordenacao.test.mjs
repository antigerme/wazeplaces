// A ordem da fila, e a invariante que ela quase derrubou.
//
// O contrato que o resto do app inteiro assume: **o card na tela é sempre o
// `queue[0]`**. `advanceQueue` remove o TOPO (`shift()`), mas a ação é enviada
// pro `currentPlace` — divergindo os dois, o app trata o que você vê e apaga
// OUTRO da fila, que some sem ser tratado, enquanto o seu volta na sua frente
// depois. MEDIDO no navegador nas três ordens (recentes, antigos, perto de
// casa). O aquecimento é a segunda vítima da mesma causa: ele mira no
// `queue[1]` do instante em que dispara e nada o reagenda.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function fatiar(nome) {
  const ini = APP.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu do app.js`);
  const resto = APP.slice(ini + 1);
  const fim = resto.search(/\n(?:async function |function |const |let |\/\/ ──|\/\/ ═)/);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  return APP.slice(ini, ini + 1 + fim);
}

// ── A invariante ───────────────────────────────────────────────────────────

test('a página nova NÃO reordena por baixo de um card na tela', () => {
  const corpo = fatiar('fetchNextPage');
  assert.match(corpo, /if \(AppState\.currentPlace\) AppState\.ordemPendente = true;\s*\n\s*else sortQueue\(\);/,
    'o fetchNextPage voltou a ordenar com card na tela — a ação passa a cair no pedido errado');
  assert.ok(!/^\s*sortQueue\(\);\s*$/m.test(corpo),
    'sobrou um sortQueue() incondicional no fetchNextPage');
});

// Posição de uma CHAMADA de verdade: ancorada no início da linha, nunca no
// nome solto. Os comentários deste trecho explicam a ordem citando as funções
// pelo nome, e um `indexOf` cru casa com a MENÇÃO e reprova código certo —
// gotcha #14, que aconteceu na primeira escrita deste teste (e nos dois PRs
// anteriores desta sessão, sempre do mesmo jeito).
function posDaChamada(corpo, chamada) {
  const i = corpo.search(new RegExp('^\\s+' + chamada.replace(/[.()[\]]/g, '\\$&'), 'm'));
  assert.notEqual(i, -1, `sumiu a chamada ${chamada}`);
  return i;
}

test('a ordem adiada é aplicada no advanceQueue, com o card JÁ fora', () => {
  const corpo = fatiar('advanceQueue');
  const posShift = posDaChamada(corpo, 'AppState.queue.shift()');
  const posSort = posDaChamada(corpo, 'sortQueue()');
  const posMostra = posDaChamada(corpo, 'showCurrentPlace()');
  assert.ok(posShift < posSort,
    'reordenou ANTES de tirar o card — é exatamente o defeito que se está consertando');
  // E antes de mostrar o próximo: é o `showCurrentPlace` que agenda o
  // aquecimento, então reordenar depois dele faria a foto pré-carregada ser a
  // do card errado — o mesmo prejuízo, no segundo lugar.
  assert.ok(posSort < posMostra,
    'reordenou depois de mostrar o próximo — o aquecimento passa a mirar no card errado');
  assert.match(corpo, /AppState\.ordemPendente = false;/, 'a flag não é consumida — a fila reordenaria a cada swipe');
});

test('a flag nasce declarada e morre no resetQueue', () => {
  assert.match(APP, /ordemPendente: false,/, 'o estado não é declarado no AppState');
  assert.match(fatiar('resetQueue'), /AppState\.ordemPendente = false;/,
    'a fila vai embora e a ordem pendente fica — o próximo advance ordenaria por nada');
});

// ── Trocar só a ordem não vai à rede ───────────────────────────────────────

test('a assinatura de busca é por EXCLUSÃO, não por lista de inclusão', () => {
  // Esta é a parte que decide se um filtro NOVO vai continuar rebuscando. Com
  // lista de inclusão, quem adicionasse um campo e esquecesse de somá-lo aqui
  // faria o app parar de ir ao Waze — em silêncio, e só pra esse filtro.
  const corpo = fatiar('assinaturaDeBusca');
  assert.match(corpo, /const \{ sortOrder, \.\.\.doServidor \} = AppState\.filters;/,
    'a assinatura deixou de ser "tudo menos a ordem" — filtro novo pode nascer sem re-busca');
  assert.match(corpo, /Object\.keys\(doServidor\)\.sort\(\)/,
    'sem ordenar as chaves, a assinatura depende da ordem de inserção do objeto');
  assert.match(corpo, /API\.getRegion\(\)/, 'a região saiu da assinatura');
  assert.match(corpo, /API\.getCountry\(\)/, 'o país saiu da assinatura');
});

test('só a ordem evita a rede; qualquer filtro de busca continua rebuscando', () => {
  const corpo = fatiar('applyFiltersFromModal');
  assert.match(corpo, /const buscaAntes = assinaturaDeBusca\(\);/, 'sumiu a foto dos filtros antes da mutação');
  assert.match(corpo, /if \(assinaturaDeBusca\(\) === buscaAntes && AppState\.queue\.length\) \{[\s\S]{0,120}reordenarFilaNaTela\(\);[\s\S]{0,40}return;/,
    'o atalho local deixou de exigir que a busca seja IDÊNTICA — filtro de verdade pararia de rebuscar');
  // A foto tem que ser tirada ANTES de qualquer mutação, senão ela já nasce
  // igual ao estado novo e a comparação sempre dá "não mudou nada".
  assert.ok(corpo.indexOf('const buscaAntes') < corpo.indexOf('AppState.filters.unreadOnly ='),
    'a assinatura é capturada depois de mutar os filtros — a comparação vira sempre verdadeira');
  // E o caminho de rede continua existindo.
  assert.match(corpo, /resetQueue\(\);\s*\n\s*startFetching\(\);/, 'sumiu o caminho de re-busca');
});

test('reordenar na tela mantém o card e o topo em sincronia', () => {
  const corpo = fatiar('reordenarFilaNaTela');
  assert.match(corpo, /sortQueue\(\);/, 'não reordena');
  assert.match(corpo, /AppState\.currentPlace = AppState\.queue\[0\];/,
    'reordena sem repor o currentPlace — recria a divergência que o resto do arquivo conserta');
  assert.match(corpo, /showCurrentPlace\(\);/, 'não redesenha o card — a tela ficaria mostrando o pedido antigo');
});

// ── O aquecimento ──────────────────────────────────────────────────────────

test('o aquecimento tem um gatilho só, e ele vem DEPOIS da reordenação', () => {
  // `agendarAquecimento` é chamado quando um card entra no DOM, e lê
  // `queue[1]` no instante em que dispara. Nada o reagenda — por isso a ordem
  // precisa estar resolvida antes de o card entrar.
  const chamadas = [...APP.matchAll(/agendarAquecimento\(/g)].length;
  assert.equal(chamadas, 2, 'o aquecimento ganhou ou perdeu um gatilho — confira se a ordem já está resolvida nele');
  assert.match(fatiar('prefetchNextImage'), /AppState\.queue\[1\]/,
    'o aquecimento deixou de mirar no próximo da fila');
});
