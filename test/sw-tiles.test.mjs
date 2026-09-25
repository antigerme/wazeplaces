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
