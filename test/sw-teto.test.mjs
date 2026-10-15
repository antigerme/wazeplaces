// R23-4-02: TODA espera da Cache API do service worker tem teto. O lote 25 pôs
// `esperarComTeto` em toda espera de armazenamento do APP; o worker tem a mesma
// exposição e ficou de fora: com `has`/`keys`/`match` sem responder, o tile do
// mapa pendurava para todo mundo (8 s medidos) e a ativação não terminava.
// O worker é ESTRITAMENTE ADITIVO: vencido o teto, o que não deu pra ler vale
// como "não guardado" e o pedido vai à rede. O service-worker.js roda de
// verdade, num vm, com uma Cache API MUDA (promessas que nunca resolvem).
//
// O relógio do worker é ACELERADO no teste (cada espera dura 1/50): o teto de
// 1,5 s de produção não faz a suíte esperar segundos, e o que se mede é o
// comportamento (resolve em vez de pendurar), não o número.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
const ORIGEM = 'https://places.exemplo';
const TILE = 'https://www.waze.com/row-tiles/live/base/17/1/2/tile.png';
const MUDA = () => new Promise(() => {});          // nunca resolve
const ESCALA = 50;
const PENDUROU = 'PENDUROU';

function carregar({ mudo = true, fetchImpl = async () => ({ daRede: true }), listaDoTile = [] } = {}) {
  const ouvintes = {};
  let claims = 0;
  const cacheMudo = mudo
    ? { has: MUDA, keys: MUDA, match: MUDA, open: MUDA, delete: MUDA }
    : { has: async () => true, keys: async () => [], match: async () => undefined, open: async () => ({ keys: async () => listaDoTile.map((url) => ({ url })) }), delete: async () => true };
  const ctx = {
    self: { addEventListener: (t, fn) => { ouvintes[t] = fn; }, location: { origin: ORIGEM }, skipWaiting() {},
      clients: { claim: async () => { claims++; } } },
    caches: cacheMudo,
    fetch: fetchImpl,
    Response: { error: () => ({ erroDeRede: true }) },
    URL, console, Promise, Date, Set, Map, clearTimeout,
    setTimeout: (fn, ms, ...a) => setTimeout(fn, Math.ceil((ms || 0) / ESCALA), ...a),
  };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  const ate = (p, ms = 400) => Promise.race([Promise.resolve(p).then((x) => x, (e) => 'ERRO: ' + e.message), new Promise((ok) => setTimeout(() => ok(PENDUROU), ms))]);
  const pedir = (req) => {
    let resposta = null;
    ouvintes.fetch({ request: { method: 'GET', headers: { get: () => '' }, ...req }, clientId: '', respondWith: (p) => { resposta = p; }, waitUntil() {} });
    return resposta;
  };
  return { ouvintes, ate, pedir, claims: () => claims };
}
const tile = { url: TILE, mode: 'no-cors', destination: 'image', cache: 'default' };

test('constante: o teto do worker existe e é curto (< 3 s)', () => {
  const m = /const SW_CACHE_TETO_MS = (\d+);/.exec(SW);
  assert.ok(m, 'sumiu o teto do worker');
  assert.ok(Number(m[1]) >= 500 && Number(m[1]) <= 3000, `teto fora da faixa: ${m[1]}`);
});

test('Cache API muda: o tile do mapa NÃO pendura — a lista vale como vazia e ele vai à rede', async () => {
  const w = carregar();
  // O worker acabou de acordar: a lista ainda está sendo lida (e a leitura não termina).
  const r = w.pedir(tile);
  assert.ok(r, 'PRÉ-CONDIÇÃO: o worker não respondeu pelo tile durante a leitura da lista');
  assert.deepEqual(JSON.parse(JSON.stringify(await w.ate(r))), { daRede: true }, 'o tile ficou pendurado esperando a lista da Cache API muda');
});

test('Cache API muda no match do tile (lista pronta): vai à rede em vez de pendurar', async () => {
  const w = carregarComListaPronta({ matchMudo: true });
  const r = (await w).pedir(tile);
  assert.ok(r, 'PRÉ-CONDIÇÃO: o tile guardado deveria ser respondido pelo worker');
  assert.deepEqual(JSON.parse(JSON.stringify(await (await w).ate(r))), { daRede: true }, 'o match mudo pendurou o tile guardado');
});

async function carregarComListaPronta({ matchMudo }) {
  // Lista pronta (has/open/keys respondem), mas `match` não.
  const ouvintes = {};
  const ctx = {
    self: { addEventListener: (t, fn) => { ouvintes[t] = fn; }, location: { origin: ORIGEM }, skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { has: async () => true, open: async () => ({ keys: async () => [{ url: TILE }] }), keys: async () => [], delete: async () => true,
      match: matchMudo ? MUDA : async () => ({ doCache: true }) },
    fetch: async () => ({ daRede: true }), Response: { error: () => ({ erroDeRede: true }) },
    URL, console, Promise, Date, Set, Map, clearTimeout,
    setTimeout: (fn, ms, ...a) => setTimeout(fn, Math.ceil((ms || 0) / ESCALA), ...a),
  };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  const ate = (p, ms = 400) => Promise.race([Promise.resolve(p).then((x) => x, (e) => 'ERRO: ' + e.message), new Promise((ok) => setTimeout(() => ok(PENDUROU), ms))]);
  const pedir = (req) => {
    let resposta = null;
    ouvintes.fetch({ request: { method: 'GET', headers: { get: () => '' }, ...req }, clientId: '', respondWith: (p) => { resposta = p; }, waitUntil() {} });
    return resposta;
  };
  return { ouvintes, ate, pedir };
}

test('CONTROLE: com a Cache API respondendo, o tile guardado sai do cache (o teto não atrapalha)', async () => {
  const w = await carregarComListaPronta({ matchMudo: false });
  const r = w.pedir(tile);
  assert.ok(r);
  assert.deepEqual(JSON.parse(JSON.stringify(await w.ate(r))), { doCache: true });
});

test('Cache API muda: a ATIVAÇÃO termina (faxina com teto, claim sem esperar a lista)', async () => {
  const w = carregar();
  let espera = null;
  w.ouvintes.activate({ waitUntil: (p) => { espera = p; } });
  assert.ok(espera, 'o activate não usou waitUntil');
  const r = await w.ate(espera, 600);
  assert.notEqual(r, PENDUROU, 'a ativação ficou presa à Cache API muda: o worker nunca assume a navegação');
  assert.equal(w.claims(), 1, 'a ativação terminou sem chamar clients.claim()');
});

test('ativação: a faxina continua apagando os caches antigos e poupa o dos tiles', async () => {
  // o cache da versão em curso vem do próprio worker: cravar o serial aqui quebrava a cada bump
  const CACHE_ATUAL = /const CACHE_NAME = '([^']+)'/.exec(SW)[1];
  const apagados = [];
  const ouvintes = {};
  const ctx = {
    self: { addEventListener: (t, fn) => { ouvintes[t] = fn; }, location: { origin: ORIGEM }, skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { has: async () => false, keys: async () => ['waze-places-2026010101', 'waze-places-tiles', CACHE_ATUAL, 'outro'],
      delete: async (n) => { apagados.push(n); return true; } },
    fetch: async () => ({}), URL, console, Promise, Date, Set, Map, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  let espera; ouvintes.activate({ waitUntil: (p) => { espera = p; } });
  await espera;
  assert.deepEqual(apagados.sort(), ['outro', 'waze-places-2026010101'], 'a faxina mudou: o cache dos tiles não pode ser apagado, os antigos têm que ser');
});

test('Cache API muda: asset cache-first (fonte/ícone) vai à rede em vez de pendurar', async () => {
  const w = carregar({ fetchImpl: async () => ({ status: 200, type: 'basic', daRede: true, clone() { return this; } }) });
  const r = w.pedir({ url: ORIGEM + '/fonts/inter-latin-wght-normal.woff2', mode: 'no-cors', destination: 'font' });
  assert.ok(r);
  const x = await w.ate(r);
  assert.ok(x && x.daRede, `o asset cache-first pendurou na Cache API muda: ${JSON.stringify(x)}`);
});

test('Cache API muda + rede fora: a navegação termina com erro de rede, não pendura', async () => {
  const w = carregar({ fetchImpl: async () => { throw new TypeError('sem rede'); } });
  const r = w.pedir({ url: ORIGEM + '/', mode: 'navigate', destination: 'document' });
  assert.ok(r);
  const x = await w.ate(r);
  assert.ok(x && x.erroDeRede, `a navegação sem rede pendurou na Cache API muda: ${JSON.stringify(x)}`);
});

test('ativação: RELÊ a lista de tiles (o aviso da varredura foi ao controlador antigo) sem o claim esperar por ela', async () => {
  let has = 0;
  const ouvintes = {};
  let claims = 0;
  const ctx = {
    self: { addEventListener: (t, fn) => { ouvintes[t] = fn; }, location: { origin: ORIGEM }, skipWaiting() {}, clients: { claim: async () => { claims++; } } },
    caches: { has: () => { has++; return has === 1 ? Promise.resolve(false) : MUDA(); }, keys: async () => [], delete: async () => true },
    fetch: async () => ({}), URL, console, Promise, Date, Set, Map, clearTimeout,
    setTimeout: (fn, ms, ...a) => setTimeout(fn, Math.ceil((ms || 0) / ESCALA), ...a),
  };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  assert.equal(has, 1, 'PRÉ-CONDIÇÃO: a leitura da partida não aconteceu');
  let espera; ouvintes.activate({ waitUntil: (p) => { espera = p; } });
  const r = await Promise.race([espera.then(() => 'terminou'), new Promise((ok) => setTimeout(() => ok(PENDUROU), 400))]);
  assert.equal(r, 'terminou', 'o claim esperou a releitura (muda) da lista');
  assert.equal(claims, 1);
  assert.equal(has, 2, 'o activate parou de reler a lista: o tile guardado enquanto o worker novo esperava ficaria fora dela');
});

test('o tile guardado cujo match não responde conta como VENCIDO, e uma vez só (não também como "sem entrada")', async () => {
  const w = await carregarComListaPronta({ matchMudo: true });
  const r = w.pedir(tile);
  await w.ate(r);
  let diag = null;
  w.ouvintes.message({ data: { type: 'DIAG' }, ports: [{ postMessage: (x) => { diag = x; } }], waitUntil() {} });
  assert.equal(diag.cacheVencido, 1, 'o teto vencido não foi contado');
  assert.equal(diag.cacheSemEntrada, 0, 'o mesmo teto foi contado também como "cache sem entrada"');
  assert.equal(diag.doCache, 0);
});
