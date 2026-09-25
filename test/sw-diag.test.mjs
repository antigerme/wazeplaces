// O diagnóstico compara o que o aparelho TEM com o que o servidor SERVE — e o
// lado do "servidor" passava pelo service worker (auditoria de 2026-09-25): o
// `/` e os ícones caíam no cache-first, e a comparação dava "igual" SEMPRE; sem
// rede, o network-first devolvia o cache e virava "conferido, igual". Este
// teste RODA o service-worker.js de verdade, com eventos de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function carregarSW() {
  const ouvintes = {};
  const cacheFalso = { keys: async () => [], match: async () => null, put: async () => {}, addAll: async () => {} };
  const ctx = {
    self: { addEventListener: (t, fn) => { ouvintes[t] = fn; }, location: { origin: 'https://places.exemplo' },
      skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { has: async () => false, open: async () => cacheFalso, match: async () => null, keys: async () => [], delete: async () => true },
    fetch: async () => ({ ok: true, status: 200, clone() { return this; } }),
    URL, console, setTimeout, clearTimeout, Promise, Date, Set, Map,
  };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  return ouvintes;
}
function pedir(ouvintes, caminho, { accept = '*/*', mode = 'cors' } = {}) {
  let respondeu = false;
  ouvintes.fetch({
    request: { method: 'GET', url: 'https://places.exemplo' + caminho, mode, headers: { get: (k) => (/accept/i.test(k) ? accept : null) } },
    respondWith: (p) => { respondeu = true; Promise.resolve(p).catch(() => {}); },
    waitUntil() {},
  });
  return respondeu;
}

test('service worker: o pedido do diagnóstico (`?diag-rede`) vai direto à rede, e o normal segue no cache', () => {
  const sw = carregarSW();
  assert.ok(sw.fetch, 'o service worker não registrou o ouvinte de fetch');
  // CONTROLE: sem a marca, os dois caem no worker (cache-first e network-first).
  assert.equal(pedir(sw, '/'), true, 'CONTROLE: o `/` pedido por fetch não passou pelo worker');
  assert.equal(pedir(sw, '/js/min/app.js'), true, 'CONTROLE: o JS não passou pelo worker');
  // Com a marca, NINGUÉM responde: o navegador vai à rede, e sem rede falha.
  assert.equal(pedir(sw, '/?diag-rede=1'), false, 'o `/` do diagnóstico saiu do cache do aparelho');
  assert.equal(pedir(sw, '/js/min/app.js?diag-rede=1'), false, 'o JS do diagnóstico saiu do cache do aparelho');
  assert.equal(pedir(sw, '/manifest.json?diag-rede=1'), false);
});

test('diagnóstico: o "servidor" do cacheVsRede e o relógio pedem com `diag-rede`, e toda leitura tem teto', () => {
  const semCom = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const i = semCom.indexOf('async function diagCorpo(');
  const corpo = semCom.slice(i, semCom.indexOf('\nasync function ', i + 10));
  assert.match(corpo, /diagFetch\(u \+ \(u\.indexOf\('\?'\) === -1 \? '\?' : '&'\) \+ 'diag-rede=1', \{ cache: 'reload' \}\)/,
    'o lado do servidor do cacheVsRede voltou a passar pelo service worker');
  assert.match(corpo, /diagFetch\(meu \+ '\/manifest\.json\?diag-rede=1'/, 'o relógio do servidor pode vir do cache');
  assert.doesNotMatch(corpo, /await fetch\(/, 'leitura do diagnóstico sem teto: rede pendurada trava o "Baixar"');
  assert.match(semCom, /function diagFetch\(url, opts = \{\}\) \{[\s\S]{0,200}AbortSignal\.timeout\(DIAG_FETCH_TETO_MS\)/);
});
