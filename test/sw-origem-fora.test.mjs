// A ORIGEM FORA DO AR (auditoria de 2026-09-29, O1): o service worker é
// network-first pra página e pro código, e só caía na cópia guardada quando a
// rede NÃO respondia. Uma resposta 5xx CHEGA — é o "502 Bad Gateway" da borda
// com a VM do plano B caída atrás do Cloudflare — e era devolvida como veio: o
// app instalado, com tudo no cache e a fila guardada do "Disponível offline",
// abria a página de erro da borda (medido no navegador, h3).
//
// E a navegação SOZINHA não bastava: MEDIDO com ela, a página guardada abria e
// os scripts vinham 502 — o app não subia. O código da página aberta da cópia
// guardada também sai de lá; o de uma página que veio da REDE, não (gotcha #18:
// HTML novo com JS velho é o que o network-first existe pra impedir).
//
// O service-worker.js roda de verdade, num vm, com cache e rede de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
const ORIGEM = 'https://places.exemplo';

function carregar({ rede, guardados = ['/', '/js/min/app.js', '/css/app.css'] }) {
  const ouvintes = {};
  const copia = new Map(guardados.map((c) => [c, { status: 200, corpo: 'GUARDADO:' + c }]));
  const guardadosAgora = [];
  const caminho = (req, opts) => {
    const u = new URL(typeof req === 'string' ? req : req.url, ORIGEM);
    return u.pathname + (opts && opts.ignoreSearch ? '' : u.search);
  };
  const cache = {
    put: async (req) => { guardadosAgora.push(caminho(req)); },
    addAll: async () => {}, keys: async () => [], match: async (req, opts) => copia.get(caminho(req, opts)),
  };
  const ctx = {
    self: { addEventListener: (t, fn) => { ouvintes[t] = fn; }, location: { origin: ORIGEM },
      skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { has: async () => false, open: async () => cache, keys: async () => [], delete: async () => true,
      match: async (req, opts) => copia.get(caminho(req, opts)) },
    fetch: async (req) => rede(new URL(req.url).pathname),
    Response: { error: () => ({ status: 0, erroDeRede: true }) },
    URL, console, setTimeout, clearTimeout, Promise, Date, Set, Map,
  };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  const pedir = ({ caminho: c, navegar = false, clientId = '', resultingClientId = '' }) => {
    let resposta = null;
    ouvintes.fetch({
      request: { method: 'GET', url: ORIGEM + c, mode: navegar ? 'navigate' : 'no-cors',
        headers: { get: (k) => (/accept/i.test(k) ? (navegar ? 'text/html' : '*/*') : null) } },
      clientId, resultingClientId,
      respondWith: (p) => { resposta = Promise.resolve(p); },
      waitUntil() {},
    });
    assert.ok(resposta, `o worker não respondeu por ${c}`);
    return resposta;
  };
  return { pedir, guardadosAgora };
}
const resposta = (status) => ({ status, type: 'basic', corpo: 'REDE:' + status, clone() { return this; } });

test('origem com 5xx: a NAVEGAÇÃO cai na página guardada — e o código DAQUELA página também', async () => {
  const sw = carregar({ rede: () => resposta(502) });
  const pagina = await sw.pedir({ caminho: '/', navegar: true, resultingClientId: 'aba-1' });
  assert.equal(pagina.corpo, 'GUARDADO:/', `a navegação com 502 não caiu na página guardada: ${JSON.stringify(pagina)}`);
  const js = await sw.pedir({ caminho: '/js/min/app.js', clientId: 'aba-1' });
  assert.equal(js.corpo, 'GUARDADO:/js/min/app.js', 'o script da página aberta da cópia guardada veio 502: o app não sobe');
  const css = await sw.pedir({ caminho: '/css/app.css', clientId: 'aba-1' });
  assert.equal(css.corpo, 'GUARDADO:/css/app.css');
  // O atalho do manifest (`/?action=filters`) nunca foi guardado com a query.
  const atalho = await sw.pedir({ caminho: '/?action=filters', navegar: true, resultingClientId: 'aba-2' });
  assert.equal(atalho.corpo, 'GUARDADO:/');
});

test('CONTROLE: a página que veio da REDE não troca o código por cópia guardada no 5xx (anti-skew, gotcha #18)', async () => {
  let status = 200;
  const sw = carregar({ rede: () => resposta(status) });
  const pagina = await sw.pedir({ caminho: '/', navegar: true, resultingClientId: 'aba-rede' });
  assert.equal(pagina.corpo, 'REDE:200', 'a navegação com rede não veio da rede');
  status = 502;   // a origem cai depois de a página chegar
  const js = await sw.pedir({ caminho: '/js/min/app.js', clientId: 'aba-rede' });
  assert.equal(js.status, 502, 'o script de uma página NOVA saiu da cópia guardada: HTML novo com JS velho');
  const semDono = await sw.pedir({ caminho: '/js/min/app.js' });
  assert.equal(semDono.status, 502, 'pedido de código sem página conhecida saiu da cópia guardada');
});

test('CONTROLE: 4xx é resposta (não falha), e sem cópia guardada o 5xx vai como veio', async () => {
  const quatro = carregar({ rede: () => resposta(404) });
  const r404 = await quatro.pedir({ caminho: '/caminho-que-nao-existe', navegar: true, resultingClientId: 'x' });
  assert.equal(r404.status, 404, 'um 404 da navegação virou a página guardada — caminho desconhecido é 404, igual no Worker e na VM');
  const vazio = carregar({ rede: () => resposta(503), guardados: [] });
  const r503 = await vazio.pedir({ caminho: '/', navegar: true, resultingClientId: 'y' });
  assert.equal(r503.status, 503, 'sem nada guardado, a navegação com 503 virou erro de rede em vez da página da borda');
});

test('o caminho de sempre segue igual: 200 guarda a cópia, e a rede que não responde cai na guardada', async () => {
  const ok = carregar({ rede: () => resposta(200) });
  const r = await ok.pedir({ caminho: '/js/min/app.js', clientId: 'z' });
  assert.equal(r.corpo, 'REDE:200');
  await new Promise((f) => setImmediate(f));
  assert.deepEqual(ok.guardadosAgora, ['/js/min/app.js'], 'a resposta 200 não foi guardada');
  const semRede = carregar({ rede: () => { throw new TypeError('Failed to fetch'); } });
  const pag = await semRede.pedir({ caminho: '/', navegar: true, resultingClientId: 'w' });
  assert.equal(pag.corpo, 'GUARDADO:/');
  const js = await semRede.pedir({ caminho: '/js/min/qr.js' });
  assert.equal(js.status, 0, 'código sem cópia guardada e sem rede deixou de falhar como falha de rede');
});
