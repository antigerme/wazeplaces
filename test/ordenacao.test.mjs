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

// O card na tela fica no `queue[0]`, e a ordem nova vale JÁ pro RESTO — nunca
// "no próximo card". Adiada (`ordemPendente`, até v2026.10.01-02), o card de
// FUNDO e o aquecimento anunciavam o `queue[1]` da ordem velha, e o próximo
// card era outro: MEDIDO, s48 (chega um pedido mais recente) e s49 ("Perto de
// casa" com o perfil chegando depois do 1º card); auditoria de 2026-10-02,
// R6-2-06. As funções de verdade: o `sortQueue` com a série do foco.
function ordenarComCardNaTela(fila, opcoes, { autorEmFoco = null } = {}) {
  const AppState = { queue: fila.slice(), currentPlace: fila[0], autorEmFoco, filters: { sortOrder: 'newest' } };
  const sortQueue = new Function('AppState', 'referenciaDaOrdem', 'pontoDoPlace', 'distanciaKm', 'pedidosEmAndamento', 'chaveDoPedido',
    fatiar('sortQueue') + '\n' + fatiar('manterFocoNaFrente') + '\n' + fatiar('serieDoAutor') + '\nreturn sortQueue;')(
    AppState, () => null, () => null, () => 0, new Set(), (p) => (p ? p.id : null));
  sortQueue(opcoes);
  return { ids: AppState.queue.map((p) => p.id), AppState };
}
const P = (id, dateAdded, creatorId = 1) => ({ id, dateAdded, creatorId });

test('a página nova reordena SÓ O RESTO — o card da tela fica no `queue[0]` e o próximo já é o da ordem', () => {
  // u1 na tela (o mais antigo), e chega u0, o mais RECENTE ("Mais recentes").
  const fila = [P('u1', 100), P('u2', 300), P('u3', 200), P('u0', 500)];
  const r = ordenarComCardNaTela(fila, { semTrocarOCardDaTela: true });
  assert.deepEqual(r.ids, ['u1', 'u0', 'u2', 'u3'],
    `a ordem nova não valeu pro resto (o próximo seria outro que não o da pilha): ${r.ids}`);
  assert.equal(r.AppState.queue[0], r.AppState.currentPlace, 'o card da tela saiu do `queue[0]` — a ação cairia no pedido errado');
  // CONTROLE: a ordem da fila INTEIRA tiraria o u1 da frente — é essa diferença que o caso de cima distingue.
  assert.deepEqual(ordenarComCardNaTela(fila).ids, ['u0', 'u2', 'u3', 'u1']);
  // E com o foco num autor, a série dele segue na frente do resto (atrás do card da tela).
  const foco = ordenarComCardNaTela([P('x1', 100, 7), P('y1', 400, 8), P('x2', 200, 7), P('y0', 500, 8)],
    { semTrocarOCardDaTela: true }, { autorEmFoco: 7 });
  assert.deepEqual(foco.ids, ['x1', 'x2', 'y0', 'y1']);
});

test('quem pede a ordem com um card na tela (a página que chega, o perfil que traz a casa) ordena SÓ O RESTO', () => {
  const busca = fatiar('fetchNextPage');
  assert.match(busca, /^\s+sortQueue\(\{ semTrocarOCardDaTela: true \}\);\s*\n\s*aplicarRecusaAutomatica\(\);\s*\n\s*aoMudarAFilaPorBaixo\(\);/m,
    'a página que chega com o card na tela não ordena o resto já (ou não refaz o card de fundo depois)');
  assert.ok(!/^\s*sortQueue\(\);\s*$/m.test(busca),
    'sobrou um sortQueue() da fila INTEIRA no fetchNextPage — com o card na tela, a ação cai no pedido errado');
  assert.match(fatiar('completarPerfilChegado'),
    /^\s+sortQueue\(\{ semTrocarOCardDaTela: true \}\);\s*\n\s*if \(AppState\.currentPlace\) aoMudarAFilaPorBaixo\(\);/m,
    'o perfil que chega com o card na tela não ordena o resto já (ou não refaz o card de fundo)');
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
