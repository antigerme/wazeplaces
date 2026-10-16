// A lista de tiles que o service worker serve sem rede (auditoria de
// 2026-09-25): duas leituras seguidas (a partida do worker e o aviso da
// varredura) podiam terminar FORA DE ORDEM, e a velha — com menos tiles —
// sobrescrevia a nova. E servir o tile com `caches.open` recriava o cache que o
// "Sair" tinha apagado. O service-worker.js roda de verdade, num vm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

test('duas leituras da lista fora de ordem: vale a MAIS NOVA', async () => {
  const soltar = [];
  let chamada = 0;
  const listas = [['https://t/1'], ['https://t/1', 'https://t/2']];   // a 1ª (velha) e a 2ª (nova)
  const ctx = {
    self: { addEventListener() {}, location: { origin: 'https://places.exemplo' }, skipWaiting() {}, clients: { claim: async () => {} } },
    caches: {
      has: async () => true,
      open: async () => {
        const n = chamada++;
        return { keys: () => new Promise((ok) => { soltar[n] = () => ok(listas[Math.min(n, 1)].map((url) => ({ url }))); }) };
      },
    },
    fetch: async () => ({}), URL, console, setTimeout, clearTimeout, Promise, Date, Set, Map,
  };
  vm.createContext(ctx);
  // A leitura da PARTIDA (top-level) é a velha; a do aviso, a nova.
  vm.runInContext(SW + '\nthis.__hidratar = hidratarTiles; this.__lista = () => [...tilesGuardados];', ctx);
  await new Promise((r) => setImmediate(r));
  const nova = ctx.__hidratar();
  await new Promise((r) => setImmediate(r));
  soltar[1]();                         // a NOVA termina primeiro
  await nova;
  soltar[0]();                         // a VELHA termina depois
  await new Promise((r) => setImmediate(r));
  // JSON de ida e volta: o array vem do REALM do vm, e o `deepEqual` estrito
  // recusa o protótipo estrangeiro mesmo com o conteúdo igual (medido: a
  // primeira versão deste teste reprovava com as duas listas idênticas).
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.__lista())), ['https://t/1', 'https://t/2'], 'a leitura velha sobrescreveu a nova');
});

test('servir o tile não CRIA o cache (o "Sair" o apagou)', () => {
  // `caches.match` com o nome do cache não cria nada; `caches.open` criaria.
  const i = SW.indexOf('const doCache = () =>');
  assert.ok(i > 0, 'o doCache sumiu');
  const linha = SW.slice(i, SW.indexOf('\n', i));
  assert.match(linha, /caches\.match\(event\.request, \{ cacheName: TILES_CACHE \}\)/);
  assert.doesNotMatch(linha, /caches\.open/);
});

// ── O7: o pedido da VARREDURA passa direto (auditoria de 2026-09-26) ─────────
// O worker respondia do cache também o `fetch(u, { mode: 'cors' })` da própria
// varredura: o tile guardado nunca mais ia à rede, a "revalidação barata com
// 304" de cada janela não acontecia, e o guardado ficava o da primeira vez pra
// sempre (medido no navegador, p4: 2ª varredura com ZERO pedidos à rede).
test('O7: a <img> do mapa sai do cache (inclusive com o cache HTTP desligado); o fetch da VARREDURA vai à rede', async () => {
  const TILE = 'https://www.waze.com/row-tiles/live/base/17/1/2/tile.png';
  const ouvintes = {};
  const ctx = {
    self: { addEventListener: (t, fn) => { ouvintes[t] = fn; }, location: { origin: 'https://places.exemplo' },
      skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { has: async () => true, open: async () => ({ keys: async () => [{ url: TILE }] }),
      match: async () => ({ doCache: true }) },
    fetch: async () => ({ daRede: true }), URL, console, setTimeout, clearTimeout, Promise, Date, Set, Map,
  };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));   // a leitura da partida
  const pedir = (destination, cache) => {
    let respondeu = false;
    ouvintes.fetch({ request: { method: 'GET', url: TILE, mode: destination === 'image' ? 'no-cors' : 'cors',
      destination, cache, headers: { get: () => '' } },
      respondWith: (p) => { respondeu = true; Promise.resolve(p).catch(() => {}); } });
    return respondeu;
  };
  assert.equal(pedir('image', 'default'), true, 'CONTROLE: a <img> do mapa não saiu do cache — o offline sumiu');
  assert.equal(pedir('', 'no-cache'), false, 'o fetch da varredura saiu do cache: o tile guardado nunca é revalidado');
  assert.equal(pedir('', 'default'), false, 'fetch de script (não é o mapa) saiu do cache guardado');
  // MEDIDO: com o cache HTTP desligado (DevTools, ou qualquer rota do
  // Playwright), a `<img>` do mapa chega ao worker com `cache: 'reload'`. O modo
  // de cache não pode ser a marca — o mapa guardado sumiria de quem testa.
  assert.equal(pedir('image', 'reload'), true, 'a <img> com o cache HTTP desligado deixou de sair do cache guardado');
  // E a varredura pede mesmo `no-cache` (a outra metade da marca).
  const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(APP, /const resp = await fetch\(u, \{ mode: 'cors', cache: 'no-cache'[^}]*\}\);/,
    'a varredura parou de pedir cópia conferida — o 304 barato de cada janela não acontece');
});

// ── O11: o tile pedido durante a leitura espera a MAIS NOVA (2026-09-26) ────
// Pedido durante a leitura 1 da lista, com a leitura 2 começando antes de a 1
// terminar: o `respondWith` esperava a promessa da leitura 1 — que sai cedo
// (geração velha) sem atualizar a lista — e decidia com a lista VAZIA de quem
// acabou de acordar: o tile guardado ia à rede (p3: "FALHOU: sem rede").
test('O11: tile pedido no meio de duas leituras da lista espera a mais nova — e sai do cache', async () => {
  const TILE = 'https://www.waze.com/row-tiles/live/base/17/1/2/tile.png';
  const soltar = [];
  let chamada = 0;
  const ouvintes = {};
  const rede = [];
  const ctx = {
    self: { addEventListener: (t, fn) => { ouvintes[t] = fn; }, location: { origin: 'https://places.exemplo' },
      skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { has: async () => true,
      open: async () => { const n = chamada++; return { keys: () => new Promise((ok) => { soltar[n] = () => ok([{ url: TILE }]); }) }; },
      match: async () => ({ tipo: 'DO CACHE' }) },
    fetch: async () => { rede.push(1); throw new Error('sem rede'); },
    URL, console, setTimeout, clearTimeout, Promise, Date, Set, Map,
  };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  await new Promise((r) => setImmediate(r));          // a leitura 1 (a da partida) no ar
  let resposta = null;
  ouvintes.fetch({ request: { method: 'GET', url: TILE, mode: 'no-cors', destination: 'image', cache: 'default', headers: { get: () => '' } },
    respondWith: (p) => { resposta = Promise.resolve(p).then((x) => x, (e) => 'FALHOU: ' + e.message); } });
  assert.ok(resposta, 'PRÉ-CONDIÇÃO: o worker não respondeu pelo tile no meio da leitura');
  ouvintes.message({ data: { type: 'TILES_GUARDADOS' }, waitUntil: () => {} });   // a leitura 2 começa
  await new Promise((r) => setImmediate(r));
  soltar[0]();                                         // a 1 termina primeiro (e sai cedo)
  await new Promise((r) => setTimeout(r, 20));
  soltar[1]();                                         // a 2 termina: o tile está na lista
  const r = await Promise.race([resposta, new Promise((ok) => setTimeout(() => ok('PENDUROU'), 500))]);
  assert.equal(JSON.stringify(r), JSON.stringify({ tipo: 'DO CACHE' }), `o tile guardado não saiu do cache: ${JSON.stringify(r)}`);
  assert.equal(rede.length, 0, 'o tile guardado foi à rede (a lista velha decidiu)');
});
