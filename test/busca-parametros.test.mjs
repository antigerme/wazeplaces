// R17-6-A2 / A3 (auditoria da rodada 17): o que a busca LÊ do corpo e o que ela
// faz com a permissão do local.
//
// A2 — `countryId` inválido já era 400 (R15-6-03); os vizinhos liam mal em
// silêncio: `stateId: 'abc'` virava "sem estado" (a fila do PAÍS inteiro, sem
// aviso), `page: 1e12` ia ao Waze como veio, e `bbox` / `categories` / `region`
// de forma errada seguiam (a região desconhecida caía em `row`, e uma decisão do
// editor ia ao servidor errado). Hoje o que VEIO e não presta é 400
// (`srv.err.badRequest`), antes do Waze; o que está AUSENTE segue valendo como
// sempre — o app só manda `null`/`''`/número/lista, e tudo isso continua passando.
// A3 — `permissions: null` bloqueava o local (`null >= 0` é verdadeiro em JS) e o
// contrato escrito é "campo ausente entra".
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, buildPlacesFromSearch } from '../server/core.mjs';
import { sessaoDeTeste } from './_sessao.mjs';

const NS = (n, v) => `.waze.com\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NS('_csrf_token', 'csrf-abc'), NS('_web_session', 'sess-xyz')].join('\n');

async function buscar(extra) {
  const s = await sessaoDeTeste(COOKIES);
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), corpo: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ mapIssues: {}, venues: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const r = await dispatch('buscar-places', { ...s.dados, region: 'row', countryId: 30, ...extra }, s.ctx);
    const lista = chamadas.find((c) => /Issues\/Search\/List/.test(c.url));
    return { r, chamadas, enviado: lista ? lista.corpo : null };
  } finally {
    globalThis.fetch = original;
  }
}
const recusada = (r, chamadas, quem) => {
  assert.equal(r.status, 400, `${quem}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
  assert.equal(r.body.errorKey, 'srv.err.badRequest', quem);
  assert.equal(chamadas.length, 0, `${quem}: foi ao Waze`);
};

test('R17-6-A2: CONTROLE — o que o app manda hoje (null, \'\', número, texto de dígitos, listas boas) segue passando e chega igual ao Waze', async () => {
  const base = await buscar({});
  assert.equal(base.r.status, 200, JSON.stringify(base.r.body));
  const f = base.enviado.venueUpdateRequestsFilter;
  assert.equal(base.enviado.stateId, null);
  assert.equal(base.enviado.managedAreaId, null);
  assert.equal(base.enviado.bbox, null);
  assert.equal(f.page, 1);
  assert.equal(f.categories, null);

  for (const extra of [{ stateId: null, managedAreaId: null, bbox: null, categories: null, page: null },
    { stateId: '', managedAreaId: '', categories: [], page: '' },
    { stateId: undefined, managedAreaId: undefined, bbox: undefined, categories: undefined, page: undefined }]) {
    const { r, enviado } = await buscar(extra);
    assert.equal(r.status, 200, JSON.stringify(extra));
    assert.equal(enviado.stateId, null);
    assert.equal(enviado.venueUpdateRequestsFilter.categories, null, 'lista vazia segue valendo "sem filtro"');
    assert.equal(enviado.venueUpdateRequestsFilter.page, 1);
  }

  const cheia = await buscar({ stateId: 2, managedAreaId: '77', page: 3, categories: ['GAS_STATION', 'PARKING_LOT'] });
  assert.equal(cheia.r.status, 200, JSON.stringify(cheia.r.body));
  assert.equal(cheia.enviado.stateId, 2);
  // A área gerenciada vai como LISTA e sem país (ver o teste «Área gerenciada» abaixo): o `managedAreaId` singular o Waze ignora.
  assert.deepEqual(cheia.enviado.managedAreaIds, [77]);
  assert.equal(cheia.enviado.managedAreaId, null);
  assert.equal(cheia.enviado.venueUpdateRequestsFilter.page, 3);
  assert.deepEqual(cheia.enviado.venueUpdateRequestsFilter.categories, ['GAS_STATION', 'PARKING_LOT']);

  const area = await buscar({ bbox: [-46.7, -23.6, -46.5, -23.4] });
  assert.equal(area.r.status, 200);
  assert.deepEqual(area.enviado.bbox, [-46.7, -23.6, -46.5, -23.4]);
  assert.equal(area.enviado.countryId, null, 'a busca por área não manda o país');
  // Os extremos válidos (a linha de data inclusive) passam.
  assert.equal((await buscar({ bbox: [-180, -90, 180, 90] })).r.status, 200);
  assert.equal((await buscar({ page: 1000 })).r.status, 200);
});

test('R17-6-A2: stateId e managedAreaId que não são um inteiro positivo são 400 — não "o país inteiro" em silêncio', async () => {
  for (const campo of ['stateId', 'managedAreaId']) {
    for (const v of ['abc', true, false, [], {}, [2], 'NaN', 0, '0', -5, '-5', '1.9', 1.9, '2abc', '1e3', Infinity, 2 ** 60, ' ']) {
      const { r, chamadas } = await buscar({ [campo]: v });
      recusada(r, chamadas, `${campo} ${JSON.stringify(v)}`);
    }
  }
});

test('R17-6-A2: page fora de 1…1000 ou que não é inteiro é 400', async () => {
  for (const v of ['abc', true, [], {}, 0, '0', -1, 1.5, '3abc', '1e12', 1e12, 1001, Infinity, NaN, [2]]) {
    const { r, chamadas } = await buscar({ page: v });
    recusada(r, chamadas, `page ${JSON.stringify(v)}`);
  }
});

test('R17-6-A2: bbox só vale com 4 números finitos (lat ±90, lon ±180) — o resto é 400, não "busca o país inteiro"', async () => {
  const ruins = [
    ['a', null, {}, 5], [1, 2, 3], [1, 2, 3, 4, 5], [], 'x', 5, true, {},
    [1, 2, 3, '4'], [1, 2, 3, null], [1, 2, 3, NaN], [Infinity, 2, 3, 4],
    [-181, 0, 0, 0], [0, 0, 181, 0], [0, -91, 0, 0], [0, 0, 0, 91],
  ];
  for (const v of ruins) {
    const { r, chamadas } = await buscar({ bbox: v });
    recusada(r, chamadas, `bbox ${JSON.stringify(v)}`);
  }
});

test('R17-6-A2: categories é lista de textos (com teto) — o resto é 400', async () => {
  const ruins = ['GAS_STATION', 5, true, {}, [{ a: 1 }, null], [1], [null], [''], [['A']], Array(201).fill('PARK'), ['X'.repeat(81)]];
  for (const v of ruins) {
    const { r, chamadas } = await buscar({ categories: v });
    recusada(r, chamadas, `categories ${JSON.stringify(v).slice(0, 40)}`);
  }
  assert.equal((await buscar({ categories: Array(200).fill('PARK') })).r.status, 200, 'o teto é 200, inclusive');
});

test('R17-6-A2: região desconhecida é 400 em qualquer rota — não cai em `row` calado; ausente e vazia seguem como sempre; `world` (o apelido que saiu) é região inválida como outra qualquer', async () => {
  // DECISÃO: 400. Cair em `row` mandava rejeitar / marcar lido / excluir foto ao servidor
  // errado, que responde "não encontrado", e o app lê isso como "já tratado".
  for (const rota of ['buscar-places', 'perfil', 'lista-paises', 'marcar-lido', 'validar-place', 'excluir-foto']) {
    for (const region of ['xx', 'constructor', '__proto__', 'toString', 'rows', 'world', true, 5, {}, []]) {
      const s = await sessaoDeTeste(COOKIES);
      const original = globalThis.fetch;
      let foi = 0;
      globalThis.fetch = async () => { foi++; return new Response('{}', { status: 200 }); };
      try {
        const r = await dispatch(rota, { ...s.dados, region, countryId: 30, venueID: 'v1', updateRequestID: 'u1', imageID: 'i1', lat: 1, lon: 2 }, s.ctx);
        assert.equal(r.status, 400, `${rota} região ${JSON.stringify(region)}: HTTP ${r.status}`);
        assert.equal(r.body.errorKey, 'srv.err.badRequest', `${rota} ${JSON.stringify(region)}`);
        assert.equal(foi, 0, `${rota} região ${JSON.stringify(region)} foi ao Waze`);
      } finally { globalThis.fetch = original; }
    }
  }
  // CONTROLE: as três regiões, a caixa alta, e a região AUSENTE (que é `row`).
  const prefixos = { row: 'row-Descartes', il: 'il-Descartes', na: 'Descartes', NA: 'Descartes', ' Row ': 'row-Descartes', '': 'row-Descartes', undefined: 'row-Descartes', null: 'row-Descartes' };
  for (const [nome, prefixo] of Object.entries(prefixos)) {
    const region = nome === 'undefined' ? undefined : nome === 'null' ? null : nome;
    const { r, chamadas } = await buscar({ region });
    assert.equal(r.status, 200, `CONTROLE região ${nome}: ${JSON.stringify(r.body)}`);
    assert.ok(chamadas[0].url.startsWith(`https://www.waze.com/${prefixo}/`), `${nome}: ${chamadas[0].url}`);
  }
});

// ─── A3 · `permissions` ──────────────────────────────────────────────────────
const rdComPermissao = (permissions, ausente = false) => {
  const venue = { id: 'v1', name: 'N', categories: [], images: [], venueUpdateRequests: [{ id: 'u1', type: 'VENUE', isRead: false }] };
  if (!ausente) venue.permissions = permissions;
  return { users: { objects: [] }, venues: { objects: [venue] } };
};

test('R17-6-A3: só um número NÃO-negativo bloqueia o local — ausente, `null` e o que não é número entram', () => {
  const entra = (rd) => {
    const { places, blocked } = buildPlacesFromSearch(rd, { unreadOnly: true });
    return { cards: places.length, blocked };
  };
  // CONTROLES: o bitmask de verdade, nos dois lados.
  assert.deepEqual(entra(rdComPermissao(-1)), { cards: 1, blocked: 0 }, 'CONTROLE: -1 (todos os bits) entra');
  assert.deepEqual(entra(rdComPermissao(-2147483648)), { cards: 1, blocked: 0 }, 'CONTROLE: negativo qualquer entra');
  assert.deepEqual(entra(rdComPermissao(0)), { cards: 0, blocked: 1 }, 'CONTROLE: 0 (nenhum bit) bloqueia');
  assert.deepEqual(entra(rdComPermissao(5)), { cards: 0, blocked: 1 }, 'CONTROLE: positivo bloqueia');
  // O contrato escrito: campo AUSENTE entra. `null` é a mesma coisa, não "0".
  assert.deepEqual(entra(rdComPermissao(undefined, true)), { cards: 1, blocked: 0 }, 'ausente');
  assert.deepEqual(entra(rdComPermissao(null)), { cards: 1, blocked: 0 }, 'DEFEITO: `permissions: null` bloqueou o local');
  assert.deepEqual(entra(rdComPermissao('5')), { cards: 1, blocked: 0 }, 'DEFEITO: o TEXTO "5" bloqueou o local');
});

// «Área gerenciada» (validado na produção, com 9 áreas de uma conta L6+AM, 2026-11-27): o Waze IGNORA o `managedAreaId`
// singular e devolve a fila do PAÍS (500 pedidos para as três áreas testadas, igual ao controle sem filtro), e com
// `countryId` junto a lista `managedAreaIds` vira E com o país (as áreas de Mendoza e de San Luis davam 0 numa busca com o
// Brasil). A lista SEM país é a que estreita: 115, 0, 4, 244, 0, 12, 48, 7 e 0 pedidos nas 9 áreas.
test('Área gerenciada: vai como LISTA e SEM país; o singular não vai mais', async () => {
  const sem = await buscar({});
  assert.equal(sem.enviado.countryId, 30, 'CONTROLE: sem área, a busca segue com o país');
  assert.equal(sem.enviado.managedAreaIds, null);
  for (const id of [77, '77']) {
    const { r, enviado } = await buscar({ managedAreaId: id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(enviado.managedAreaIds, [77], 'a área vai como lista de números');
    assert.equal(enviado.managedAreaId, null, 'o singular o Waze ignora: não vai');
    assert.equal(enviado.countryId, null, 'com país a lista vira E com ele (a área de outro país dava zero)');
  }
  // O estado e os demais filtros seguem junto (o estado só estreita DENTRO da área).
  const junto = await buscar({ managedAreaId: 77, stateId: 5, residential: false, unreadOnly: false });
  assert.equal(junto.enviado.stateId, 5);
  assert.equal(junto.enviado.venueUpdateRequestsFilter.residential, false);
  assert.deepEqual(junto.enviado.userPropertiesFilter, {});
  // A caixa («Minha área») continua sem país e SEM a lista.
  const caixa = await buscar({ bbox: [-46.7, -23.6, -46.5, -23.4], managedAreaId: null });
  assert.equal(caixa.enviado.countryId, null);
  assert.equal(caixa.enviado.managedAreaIds, null);
  // Área inválida continua sendo 400 antes do Waze.
  for (const ruim of ['abc', 0, -3, 1.5]) {
    const { r, chamadas } = await buscar({ managedAreaId: ruim });
    recusada(r, chamadas, 'managedAreaId ' + JSON.stringify(ruim));
  }
});
