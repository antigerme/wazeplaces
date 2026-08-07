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

import { dispatch, makeSessions, normalizePairCode } from '../server/core.mjs';

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
      unreadOnly: true, types: ['NEW_PLACE', 'NEW_PHOTO'],
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

test('dispatch validar-place: aprovar só quando pedido EXPLICITAMENTE', async () => {
  // Este teste guardava a regra "a app NUNCA aprova". A regra mudou por decisão
  // do owner — foto é o caso em que aprovar não exige ajuste no mapa, porque
  // não há campo pra corrigir: ou serve ou não serve, e está tudo na tela.
  //
  // O que ele guarda agora é mais estrito do que antes: o padrão continua
  // sendo NÃO aprovar, e só o booleano `true` aprova. A coerção é o risco
  // real aqui — uma string "false" vinda de um form, um `1`, um objeto: todos
  // são truthy, e qualquer um deles viraria uma aprovação silenciosa de um
  // pedido que ninguém revisou.
  const { ctx, token } = await ctxComSessao();
  const flag = async (approve) => {
    const { chamadas } = await comFetchMockado(
      () => ok('{}'),
      () => dispatch('validar-place', {
        sessionToken: token, region: 'row', venueID: 'v1', updateRequestID: 'ur1',
        ...(approve === undefined ? {} : { approve }),
      }, ctx));
    assert.equal(chamadas.length, 1);
    return JSON.parse(chamadas[0].opts.body)
      .actions._subActions[0]._subActions[0].attributes.approve;
  };

  assert.equal(await flag(undefined), false, 'sem pedir, o padrão tem que ser NÃO aprovar');
  assert.equal(await flag(false), false);
  assert.equal(await flag(true), true, 'aprovar explícito precisa chegar como true');
  for (const truthy of ['true', 1, 'sim', {}, []]) {
    assert.equal(await flag(truthy), false,
      `${JSON.stringify(truthy)} é truthy e NÃO pode aprovar — só o booleano true aprova`);
  }
});

test('dispatch: rota é o nome EXATO — nada de sufixo tolerado', async () => {
  const { ctx, token } = await ctxComSessao();
  assert.equal((await dispatch('nao-existe', {}, { sessions: null })).status, 404);

  // O `.php` era resíduo da v2.x (backend PHP) e vivia como tolerância no
  // dispatch, pra cache antigo. Removido: a app está em dev/testes, não há
  // cliente velho pra atender, e tolerância silenciosa esconde erro de rota.
  const { resultado } = await comFetchMockado(
    () => ok(wazePayload()),
    () => dispatch('buscar-places.php', { sessionToken: token, region: 'row' }, ctx));
  assert.equal(resultado.status, 404, 'sufixo .php voltou a ser tolerado');
});

// ─── Pareamento computador → celular ────────────────────────────────────────
// Resolve o gargalo real da app: copiar cookies num celular é inviável. O
// editor loga no computador e traz a sessão por um código curto e efêmero.
test('dispatch parear: create exige sessão; claim entrega sessão NOVA', async () => {
  const { ctx, token } = await ctxComSessao();

  // Padrão = segredo LONGO, o do QR. Ele não é digitado, então pode ser longo
  // de graça — e precisa ser, porque a chave do blob sai dele: 6 caracteres
  // seriam ~30 bits, quebráveis offline em segundos.
  const criado = await dispatch('parear', { action: 'create', sessionToken: token }, ctx);
  assert.equal(criado.status, 200);
  assert.match(criado.body.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{20}$/,
    'segredo do QR: 20 símbolos sem ambiguidade (nada de 0/O/1/I)');
  assert.equal(criado.body.curto, false, 'sem pedir, o registro criado é o FORTE');

  // O código digitável só nasce sob demanda. Se ele existisse sempre, um dump
  // do KV traria a cópia de 30 bits ao lado da de 100 e a força do QR seria
  // decorativa — é essa a razão do `comCodigo`, não conveniência de API.
  const curto = await dispatch('parear', { action: 'create', sessionToken: token, comCodigo: true }, ctx);
  assert.match(curto.body.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/,
    'código digitado: 6 símbolos, o mesmo alfabeto');
  assert.equal(curto.body.curto, true);
  const resgateCurto = await dispatch('parear', { action: 'claim', code: curto.body.code }, ctx);
  assert.equal(resgateCurto.body.success, true, 'o código curto também tem que resgatar');

  const resgate = await dispatch('parear', { action: 'claim', code: criado.body.code }, ctx);
  assert.equal(resgate.status, 200);
  assert.ok(resgate.body.sessionToken);
  assert.notEqual(resgate.body.sessionToken, token, 'celular ganha sessão PRÓPRIA, não a mesma');

  // A sessão do computador segue viva — parear não desloga quem gerou.
  const ainda = await dispatch('perfil', { sessionToken: token, region: 'row' }, ctx);
  assert.notEqual(ainda.body.error, 'Sessão ou cookies não fornecidos');
});

test('dispatch parear: código é de USO ÚNICO', async () => {
  const { ctx, token } = await ctxComSessao();
  const { body } = await dispatch('parear', { action: 'create', sessionToken: token }, ctx);
  const primeiro = await dispatch('parear', { action: 'claim', code: body.code }, ctx);
  assert.equal(primeiro.body.success, true);
  const segundo = await dispatch('parear', { action: 'claim', code: body.code }, ctx);
  assert.equal(segundo.body.success, false);
  assert.equal(segundo.status, 400);
});

test('dispatch parear: create SEM sessão é 401 (só quem já entrou gera código)', async () => {
  const { ctx } = await ctxComSessao();
  const r = await dispatch('parear', { action: 'create', sessionToken: 'inexistente' }, ctx);
  assert.equal(r.status, 401);
});

test('dispatch parear: códigos inválidos não viram sessão', async () => {
  const { ctx } = await ctxComSessao();
  for (const ruim of ['', 'ABC', 'ZZZZZZZZ', null, 'ABC-12']) {
    const r = await dispatch('parear', { action: 'claim', code: ruim }, ctx);
    assert.equal(r.body.success, false, `código ${JSON.stringify(ruim)} não pode ser aceito`);
  }
});

test('parear: mesma mensagem pra inexistente e expirado (sem oráculo)', async () => {
  const { ctx, token } = await ctxComSessao();
  const { body } = await dispatch('parear', { action: 'create', sessionToken: token }, ctx);
  await dispatch('parear', { action: 'claim', code: body.code }, ctx); // consome
  const usado = await dispatch('parear', { action: 'claim', code: body.code }, ctx);
  const nuncaExistiu = await dispatch('parear', { action: 'claim', code: 'ABCDEF' }, ctx);
  assert.equal(usado.body.error, nuncaExistiu.body.error,
    'diferenciar os casos entregaria informação a quem estivesse chutando códigos');
});

test('normalizePairCode: aceita minúsculo, hífen e espaço', () => {
  assert.equal(normalizePairCode(' a2c-3d4 '), 'A2C3D4');
  assert.equal(normalizePairCode('ABC 123'), 'ABC123');
  assert.equal(normalizePairCode(null), '');
});

// O 401 de sessão precisa vir CARIMBADO com `errorCategory: 'unauthorized'`.
//
// Este é o teste do incidente: sem o carimbo, o `handleUnauthorized` lia "não é
// unauthorized" e concluía ALARME FALSO — mantinha a sessão morta e mostrava
// "Conexão instável" a cada tentativa, pra sempre. Só saía com logout manual.
// Atingiu todos os testadores no deploy da derivação de chave, que invalidou as
// sessões existentes de uma vez.
//
// O `categorizeWazeError` carimba as respostas do WAZE; ESTE 401 é nosso (o
// store não achou a sessão) e não passa por lá. Sem carimbo aqui, o cliente
// não tem como distinguir "precisa entrar de novo" de "a rede oscilou".
test('401 de sessão vem com errorCategory: unauthorized', async () => {
  const { ctx } = await ctxComSessao();

  const semSessao = await dispatch('perfil', { sessionToken: 'nao-existe', region: 'row' }, ctx);
  assert.equal(semSessao.status, 401);
  assert.equal(semSessao.body.errorCategory, 'unauthorized',
    'sessão inexistente sem carimbo faz o cliente achar que foi só instabilidade');
  assert.equal(semSessao.body.errorKey, 'srv.err.sessionExpired');

  const semNada = await dispatch('perfil', { region: 'row' }, ctx);
  assert.equal(semNada.status, 401);
  assert.equal(semNada.body.errorCategory, 'unauthorized',
    'requisição sem token nenhum também precisa do carimbo');
});
