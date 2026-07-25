// Teste de INTEGRAÇÃO do backend: exercita dispatch() ponta-a-ponta —
// sessão real (criptografada) → resolveCookies → callWaze → parsing → resposta.
// O único ponto mockado é o `fetch` ao Waze (o sandbox bloqueia *.waze.com, e
// mesmo fora dele não queremos teste dependente de rede/credencial).
//
// Complementa test/core.test.mjs, que testa as funções puras isoladamente:
// aqui garantimos que o CONTRATO DA RESPOSTA (os campos que o frontend lê)
// não quebra — inclusive os campos novos `totalAll`/`blocked` do contador D13.

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { dispatch, makeSessions } from '../server/core.mjs';

const NETSCAPE = (domain, name, value) =>
  `${domain}\tTRUE\t/\tTRUE\t9999999999\t${name}\t${value}`;

const COOKIES = [
  NETSCAPE('.waze.com', '_csrf_token', 'csrf-abc'),
  NETSCAPE('.waze.com', '_web_session', 'sess-xyz'),
].join('\n');

function memStore() {
  const m = new Map();
  return {
    get: (h) => m.get('sess_' + h) ?? null,
    put: (h, blob) => { m.set('sess_' + h, blob); },
    delete: (h) => { m.delete('sess_' + h); },
  };
}

async function ctxComSessao() {
  const sessions = makeSessions({ store: memStore(), keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const token = await sessions.createSession(COOKIES);
  return { ctx: { sessions }, token };
}

// Resposta do Waze com 2 venues: um editável (permissions -1) e um sem
// permissão (permissions 0), cada um com 1 PUR de IMAGE não-lido.
const wazePayload = () => JSON.stringify({
  users: { objects: [{ id: 7, userName: 'fulano' }] },
  streets: { objects: [] }, cities: { objects: [] }, states: { objects: [] },
  mapIssues: { venueUpdateRequests: { hasMore: false } },
  venues: {
    objects: [
      {
        id: 'v-editavel', name: 'Bar do Zé', permissions: -1, categories: ['BAR'], images: [],
        venueUpdateRequests: [{ id: 'ur-1', type: 'IMAGE', createdBy: 7, isRead: false }],
      },
      {
        id: 'v-bloqueado', name: 'Fora da minha área', permissions: 0, categories: ['SHOPPING'], images: [],
        venueUpdateRequests: [{ id: 'ur-2', type: 'IMAGE', createdBy: 7, isRead: false }],
      },
    ],
  },
});

// Substitui o fetch global só durante o teste, devolvendo o payload e
// capturando a request pra inspecionar headers/corpo enviados ao Waze.
async function comFetchMockado(responder, fn) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    chamadas.push({ url: String(url), opts });
    return responder(String(url), opts);
  };
  try {
    return { resultado: await fn(), chamadas };
  } finally {
    globalThis.fetch = original;
  }
}

const ok = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });

test('dispatch buscar-places: contrato da resposta + totalAll/blocked (D13)', async () => {
  const { ctx, token } = await ctxComSessao();
  const { resultado, chamadas } = await comFetchMockado(
    () => ok(wazePayload()),
    () => dispatch('buscar-places', {
      sessionToken: token, region: 'row', countryId: 30, page: 1,
      unreadOnly: true, types: ['VENUE', 'IMAGE'],
    }, ctx));

  assert.equal(resultado.status, 200);
  const b = resultado.body;
  assert.equal(b.success, true);
  assert.equal(b.places.length, 1, 'só o venue editável vira card');
  assert.equal(b.places[0].venueID, 'v-editavel');
  assert.equal(b.total, 1);
  assert.equal(b.blocked, 1, 'o venue sem permissão é contado, não ignorado');
  assert.equal(b.totalAll, 2, 'total da região = editáveis + bloqueados');
  assert.equal(b.hasMore, false);

  // O que foi ENVIADO ao Waze (headers críticos — mexer aqui quebra a comunicação)
  assert.equal(chamadas.length, 1);
  const { url, opts } = chamadas[0];
  assert.ok(url.includes('/Issues/Search/List'), `url inesperada: ${url}`);
  assert.equal(opts.method, 'POST');
  assert.ok(opts.headers.Cookie.includes('_csrf_token=csrf-abc'));
  assert.ok(opts.headers.Cookie.includes('_web_session=sess-xyz'));
  assert.equal(opts.headers['X-CSRF-Token'], 'csrf-abc');
  assert.ok(String(opts.headers.Referer).includes('waze.com'));
  const enviado = JSON.parse(opts.body);
  assert.deepEqual(enviado.userPropertiesFilter, { isRead: false }, 'default = não lidos');
  assert.equal(enviado.venueUpdateRequestsFilter.types, null, 'types vai null (array parcial dá HTTP 406)');
  assert.equal(enviado.countryId, 30);
});

test('dispatch buscar-places: sem sessão → 401 sem tocar o Waze', async () => {
  const { ctx } = await ctxComSessao();
  const { resultado, chamadas } = await comFetchMockado(
    () => ok('{}'),
    () => dispatch('buscar-places', { sessionToken: 'inexistente', region: 'row' }, ctx));
  assert.equal(resultado.status, 401);
  assert.equal(resultado.body.success, false);
  assert.equal(chamadas.length, 0, 'não pode chamar o Waze sem sessão válida');
});

test('dispatch marcar-lido: race do Waze (500 + code 300) vira already_processed', async () => {
  const { ctx, token } = await ctxComSessao();
  const { resultado } = await comFetchMockado(
    () => new Response(JSON.stringify({ errorList: [{ code: 300, details: 'Failed to handle request' }] }), { status: 500 }),
    () => dispatch('marcar-lido', {
      sessionToken: token, region: 'row', venueID: 'v1', updateRequestID: 'ur1',
    }, ctx));
  assert.equal(resultado.body.success, false);
  assert.equal(resultado.body.errorCategory, 'already_processed');
});

test('dispatch validar-place: SEMPRE approve:false (a app nunca aprova)', async () => {
  const { ctx, token } = await ctxComSessao();
  const { chamadas } = await comFetchMockado(
    () => ok('{}'),
    () => dispatch('validar-place', {
      sessionToken: token, region: 'row', venueID: 'v1', updateRequestID: 'ur1', approve: true,
    }, ctx));
  assert.equal(chamadas.length, 1);
  const enviado = JSON.parse(chamadas[0].opts.body);
  const json = JSON.stringify(enviado);
  assert.ok(!/"approve"\s*:\s*true/.test(json), `pedido não pode conter approve:true — ${json.slice(0, 300)}`);
});

test('dispatch: endpoint desconhecido → 404; sufixo .php tolerado', async () => {
  const { ctx, token } = await ctxComSessao();
  const r404 = await dispatch('nao-existe', {}, { sessions: null });
  assert.equal(r404.status, 404);

  const { resultado } = await comFetchMockado(
    () => ok(wazePayload()),
    () => dispatch('buscar-places.php', { sessionToken: token, region: 'row' }, ctx));
  assert.equal(resultado.status, 200, 'compat de cache antigo com .php');
});
