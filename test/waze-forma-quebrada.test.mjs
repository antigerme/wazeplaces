// R16-6-08 (auditoria de 2026-10-13): resposta 200 do Waze com a forma quebrada POR
// DENTRO — uma lista que veio como número/texto/`true`, ou um `null` no meio dela —
// estourava um TypeError no laço e saía pelo `catch` do `dispatch` como "Erro
// interno" (`srv.err.internal`, sem `errorCategory`). O contrato (CLAUDE.md,
// Convenções › Backend) é o mesmo da resposta `null`/HTML: `respostaInesperadaDoWaze()`
// — 500, `unknown`, `srv.err.badWazeResponse` — em toda rota.
// Um `null` em `venues.objects` derrubava a fila inteira de todo mundo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../server/core.mjs';
import { sessaoDeTeste } from './_sessao.mjs';

const NS = (n, v) => `.waze.com\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NS('_csrf_token', 'csrf-abc'), NS('_web_session', 'sess-xyz')].join('\n');

const BASES = {
  perfil: () => ({ id: 1, userName: 'u', rank: 5, isAreaManager: true, isStaff: false, areas: [{ type: 'drive', geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 4], [5, 6], [1, 2]]] } }],
    managedAreas: [{ id: 1, name: 'a' }], editableCountryIDs: [30] }),
  'lista-paises': () => ({ countries: [{ id: 30, name: 'Brazil', abbr: 'BR', env: 'row' }] }),
  'lista-estados': () => ({ states: [{ id: 1, name: 'X', countryId: 30 }] }),
  'buscar-places': () => ({
    mapIssues: { venueUpdateRequests: { objects: [{ id: 'u1', venueId: 'v1', type: 'VENUE', isRead: false }], hasMore: false } },
    venues: { objects: [{ id: 'v1', name: 'N', categories: ['PARK'], permissions: -1, geometry: { type: 'Point', coordinates: [1, 2] }, images: [],
      venueUpdateRequests: [{ id: 'u1', type: 'VENUE', isRead: false }] }] },
    users: { objects: [{ id: 1, userName: 'a' }] }, streets: { objects: [{ id: 1, name: 'R' }] }, cities: { objects: [{ id: 1, name: 'C' }] },
    states: { objects: [{ id: 1, name: 'S' }] },
  }),
};
const ENTRADA = { perfil: {}, 'lista-paises': {}, 'lista-estados': { countryId: 30 }, 'buscar-places': { countryId: 30 } };

async function rodar(rota, corpo) {
  const s = await sessaoDeTeste(COOKIES);
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    return await dispatch(rota, { ...s.dados, region: 'row', ...ENTRADA[rota] }, s.ctx);
  } finally {
    globalThis.fetch = original;
  }
}
const mudar = (rota, caminho, valor) => {
  const c = BASES[rota]();
  let alvo = c;
  for (const k of caminho.slice(0, -1)) alvo = alvo[k];
  alvo[caminho[caminho.length - 1]] = valor;
  return c;
};

test('CONTROLE: a resposta boa de cada rota continua 200 (o instrumento enxerga o sucesso)', async () => {
  for (const rota of Object.keys(BASES)) {
    const r = await rodar(rota, BASES[rota]());
    assert.equal(r.status, 200, `${rota}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.success, true, rota);
  }
  // E o que o laço devolve é o que o Waze mandou (nada some por causa do conserto).
  assert.equal((await rodar('lista-paises', BASES['lista-paises']())).body.countries.length, 1);
  assert.equal((await rodar('lista-estados', BASES['lista-estados']())).body.states.length, 1);
  assert.equal((await rodar('buscar-places', BASES['buscar-places']())).body.places.length, 1);
  const perfil = (await rodar('perfil', BASES.perfil())).body;
  assert.deepEqual(perfil.profile.managedAreas, [{ id: 1, name: 'a' }]);
  assert.equal(perfil.profile.areas.length, 1);
  // Lista ausente, `null`, `0` e vazia seguem sendo "sem nada", como sempre foram.
  for (const v of [undefined, null, 0, '', false, []]) {
    assert.equal((await rodar('lista-paises', { countries: v })).status, 200, `countries: ${JSON.stringify(v)}`);
    assert.equal((await rodar('buscar-places', mudar('buscar-places', ['venues', 'objects'], v))).status, 200, `venues.objects: ${JSON.stringify(v)}`);
  }
});

const QUEBRADAS = [
  ['perfil', ['areas'], [1, true, 'x']],
  ['perfil', ['managedAreas'], [1, true, 'x']],
  ['perfil', ['managedAreas', 0], [null]],
  ['lista-paises', ['countries'], [1, true, 'x']],
  ['lista-paises', ['countries', 0], [null]],
  ['lista-estados', ['states'], [1, true, 'x']],
  ['lista-estados', ['states', 0], [null]],
  ['buscar-places', ['venues', 'objects'], [1, true, 'x']],
  ['buscar-places', ['venues', 'objects', 0], [null]],
  ['buscar-places', ['users', 'objects'], [1, true, 'x']],
  ['buscar-places', ['users', 'objects', 0], [null]],
  ['buscar-places', ['streets', 'objects', 0], [null]],
  ['buscar-places', ['cities', 'objects'], [1, true]],
  ['buscar-places', ['states', 'objects', 0], [null]],
];

test('R16-6-08: lista quebrada por dentro em 200 do Waze é "resposta inesperada" (500 unknown), não "Erro interno"', async () => {
  for (const [rota, caminho, valores] of QUEBRADAS) {
    for (const v of valores) {
      const r = await rodar(rota, mudar(rota, caminho, v));
      const quem = `${rota}.${caminho.join('.')} = ${JSON.stringify(v)}`;
      assert.equal(r.status, 500, `${quem}: ${r.status}`);
      assert.equal(r.body.errorKey, 'srv.err.badWazeResponse', `DEFEITO: ${quem} saiu como ${JSON.stringify(r.body)}`);
      assert.equal(r.body.errorCategory, 'unknown', quem);
    }
  }
});

// ═══ R17-6-A1 / R17-3-03 · o RESTO do `buildPlacesFromSearch` e a releitura do local ═══
// O lote 20 cobriu as 9 listas do `listaDoWaze`; ficaram de fora as de dentro do
// local — os pedidos (um `null` no meio derrubava a fila INTEIRA do país), as marcas
// da categoria, as fotos e os pontos de entrada —, e a releitura do `excluir-foto`.
const MAIS = {
  'buscar-places': () => {
    const c = BASES['buscar-places']();
    const v = c.venues.objects[0];
    v.entryExitPoints = [{ name: 'e', point: { type: 'Point', coordinates: [1.0001, 2.0001] } }];
    v.venueUpdateRequests.push({ id: 'u2', type: 'REQUEST', subType: 'UPDATE', isRead: false,
      changedVenue: { entryExitPoints: [{ name: 'e2', point: { type: 'Point', coordinates: [1.002, 2.002] } }] } });
    c.venues.categoryBrands = { GAS_STATION: ['Shell'] };
    return c;
  },
};
const mudarMais = (caminho, valor, base = MAIS['buscar-places']) => {
  const c = base();
  let alvo = c;
  for (const k of caminho.slice(0, -1)) alvo = alvo[k];
  alvo[caminho[caminho.length - 1]] = valor;
  return c;
};

test('R17-6-A1: CONTROLE — a resposta boa com pontos de entrada, marcas e fotos continua 200 e desenha o mapa', async () => {
  const r = await rodar('buscar-places', MAIS['buscar-places']());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.places.length, 2);
  assert.equal(r.body.places[0].mapa.entradas.length, 1, 'o ponto de entrada sumiu do mapa');
  // Ausente, `null`, `0`, `''` e `[]` seguem sendo "sem nada" nas listas de dentro do local.
  for (const v of [undefined, null, 0, '', false, []]) {
    for (const caminho of [['venues', 'objects', 0, 'images'], ['venues', 'objects', 0, 'entryExitPoints'], ['venues', 'categoryBrands', 'GAS_STATION']]) {
      const q = await rodar('buscar-places', mudarMais(caminho, v));
      assert.equal(q.status, 200, `${caminho.join('.')} = ${JSON.stringify(v)}: ${JSON.stringify(q.body)}`);
    }
  }
  // Um item de lista que não é objeto, onde o laço já o tolerava, segue tolerado (foto/ponto vazio).
  for (const caminho of [['venues', 'objects', 0, 'images'], ['venues', 'objects', 0, 'entryExitPoints']]) {
    assert.equal((await rodar('buscar-places', mudarMais(caminho, [null]))).status, 200, caminho.join('.'));
  }
  // Local SEM ponto nenhum na entrada (`point` ausente) não é forma quebrada: só não desenha o marcador.
  for (const item of [{ name: 'sem ponto' }, { point: null }, { point: {} }, { point: { coordinates: null } }, { point: { coordinates: [] } }]) {
    const semPonto = await rodar('buscar-places', mudarMais(['venues', 'objects', 0, 'entryExitPoints'], [item]));
    assert.equal(semPonto.status, 200, JSON.stringify(item));
    assert.equal(semPonto.body.places[0].mapa.entradas.length, 0, JSON.stringify(item));
  }
});

const QUEBRADAS_DE_DENTRO = [
  [['venues', 'objects', 0, 'venueUpdateRequests'], [[null], [5], ['x'], [{ id: 'u1', type: 'VENUE' }, null]]],
  [['venues', 'categoryBrands'], [{ GAS_STATION: 5 }, { GAS_STATION: true }, { GAS_STATION: {} }, { GAS_STATION: 'x' }, [1]]],
  [['venues', 'objects', 0, 'images'], [5, true, {}, 'x']],
  [['venues', 'objects', 0, 'entryExitPoints'], [5, true, {}, 'x']],
  // (Ponto de entrada com coordenada quebrada NÃO está aqui: desde o lote 22 ele é ignorado — ver o teste abaixo.)
];

test('R17-6-A1: forma quebrada POR DENTRO do local é "resposta inesperada" (500 unknown), não "Erro interno"', async () => {
  for (const [caminho, valores] of QUEBRADAS_DE_DENTRO) {
    for (const v of valores) {
      const r = await rodar('buscar-places', mudarMais(caminho, v));
      const quem = `${caminho.join('.')} = ${JSON.stringify(v)}`;
      assert.equal(r.status, 500, `${quem}: ${r.status}`);
      assert.equal(r.body.errorKey, 'srv.err.badWazeResponse', `DEFEITO: ${quem} saiu como ${JSON.stringify(r.body)}`);
      assert.equal(r.body.errorCategory, 'unknown', quem);
    }
  }
});

test('Lote 22 (R18-8): um ponto de entrada/saída com coordenada quebrada é IGNORADO — o card sai com o ponto bom, sem derrubar a fila', async () => {
  const bom = { name: 'bom', point: { type: 'Point', coordinates: [1.0003, 2.0003] } };
  const quebrados = [{ point: { coordinates: [5] } }, { point: { coordinates: [5, null] } }, { point: { coordinates: [null, 5] } },
    { point: { coordinates: ['a', 'b'] } }, { point: { coordinates: [NaN, 1] } }, { point: { coordinates: 7 } }, { point: { coordinates: {} } }];
  // CONTROLE: só o bom desenha 1 entrada em cada local (o atual do local; o do pedido de mudança).
  const ctrl = await rodar('buscar-places', mudarMais(['venues', 'objects', 0, 'entryExitPoints'], [bom]));
  assert.equal(ctrl.status, 200, JSON.stringify(ctrl.body));
  assert.ok(ctrl.body.places[0].mapa.entradas.some((e) => e.nome === 'bom'), 'o ponto bom sumiu do mapa');
  for (const q of quebrados) {
    // Quebrado no local (junto de um bom) e no delta do pedido de mudança (junto do bom do delta).
    const noLocal = await rodar('buscar-places', mudarMais(['venues', 'objects', 0, 'entryExitPoints'], [q, bom]));
    const quem = JSON.stringify(q);
    assert.equal(noLocal.status, 200, `DEFEITO: ${quem} derrubou a fila: ${JSON.stringify(noLocal.body)}`);
    assert.equal(noLocal.body.places.length, 2, `${quem}: os cards do local sumiram`);
    for (const p of noLocal.body.places) assert.ok(p.mapa, `${quem}: o card ficou sem mapa`);
    assert.deepEqual(noLocal.body.places[0].mapa.entradas.map((e) => e.nome), ['bom'], `${quem}: o quebrado entrou no mapa ou o bom saiu`);
    const noDelta = await rodar('buscar-places', mudarMais(['venues', 'objects', 0, 'venueUpdateRequests', 1, 'changedVenue', 'entryExitPoints'], [q, { ...bom, name: 'bom2' }]));
    assert.equal(noDelta.status, 200, `DEFEITO (no pedido de mudança): ${quem}: ${JSON.stringify(noDelta.body)}`);
    assert.equal(noDelta.body.places.length, 2, quem);
  }
  // A posição do LOCAL quebrada e o CAMPO que não é lista seguem sendo "resposta inesperada" (outra forma quebrada).
  for (const v of [5, true, {}, 'x']) {
    const r = await rodar('buscar-places', mudarMais(['venues', 'objects', 0, 'entryExitPoints'], v));
    assert.equal(r.body.errorKey, 'srv.err.badWazeResponse', `entryExitPoints = ${JSON.stringify(v)}`);
  }
});

test('R17-6-A1: o local SEM permissão também passa pela conferência dos pedidos (a contagem do "de N na região")', async () => {
  const c = mudarMais(['venues', 'objects', 0, 'permissions'], 0);
  const ok = await rodar('buscar-places', c);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.blocked, 2, 'CONTROLE: os 2 pedidos do local bloqueado contam');
  const ruim = mudarMais(['venues', 'objects', 0, 'venueUpdateRequests'], [null], () => c);
  const r = await rodar('buscar-places', ruim);
  assert.equal(r.body.errorKey, 'srv.err.badWazeResponse', JSON.stringify(r.body));
});

// ─── A releitura do local (`excluir-foto`): `venues.objects` e `images` como o resto ───
async function excluir(corpoDoWaze, extra = {}) {
  const s = await sessaoDeTeste(COOKIES);
  const antes = new Set(s.store.mem.keys()); // a sessão; o resto que aparecer é lista do local
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), method: init.method || 'GET' });
    return new Response(JSON.stringify(init.method === 'POST' ? { status: 0 } : corpoDoWaze), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const r = await dispatch('excluir-foto', { ...s.dados, region: 'row', venueID: 'v1', imageID: 'i1', lat: -23.5, lon: -46.6, ...extra }, s.ctx);
    return { r, chamadas, puts: [...s.store.mem.keys()].filter((k) => !antes.has(k)) };
  } finally {
    globalThis.fetch = original;
  }
}

test('R17-3-03: `excluir-foto` — leitura do local com a forma quebrada é "resposta inesperada", e nada é escrito', async () => {
  const boa = await excluir({ venues: { objects: [{ id: 'v1', images: [{ id: 'i1', approved: true }, { id: 'i2', approved: true }] }] } });
  assert.equal(boa.r.status, 200, `CONTROLE: ${JSON.stringify(boa.r.body)}`);
  assert.ok(boa.chamadas.some((c) => c.method === 'POST'), 'CONTROLE: a foto boa devia ser escrita');
  const tolera = await excluir({ venues: { objects: [{ id: 'v1', images: [null, { id: 'i1', approved: true }] }] } });
  assert.equal(tolera.r.status, 200, 'CONTROLE: elemento vazio dentro de images segue tolerado');
  for (const [nome, corpo] of [
    ['venues.objects = 5', { venues: { objects: 5 } }],
    ['venues.objects = {}', { venues: { objects: {} } }],
    ['venues.objects = "x"', { venues: { objects: 'x' } }],
    ['images = 5', { venues: { objects: [{ id: 'v1', images: 5 }] } }],
    ['images = {}', { venues: { objects: [{ id: 'v1', images: {} }] } }],
    ['images = true', { venues: { objects: [{ id: 'v1', images: true }] } }],
  ]) {
    const { r, chamadas, puts } = await excluir(corpo);
    assert.equal(r.status, 500, nome);
    assert.equal(r.body.errorKey, 'srv.err.badWazeResponse', `DEFEITO: ${nome} saiu como ${JSON.stringify(r.body)}`);
    assert.equal(r.body.errorCategory, 'unknown', nome);
    assert.ok(chamadas.every((c) => c.method === 'GET'), `${nome}: escreveu no Waze`);
    assert.deepEqual(puts, [], `${nome}: gravou no KV`);
  }
  // Local que não aparece na lista (ou lista vazia/ausente) segue sendo 404 "o local sumiu".
  for (const corpo of [{ venues: { objects: [] } }, { venues: {} }, {}]) {
    const g = await excluir(corpo);
    assert.equal(g.r.status, 404, JSON.stringify(corpo));
    assert.equal(g.r.body.errorKey, 'srv.err.venueGone');
  }
});

test('R17-3-03: `excluir-foto` preparar — a mesma forma quebrada não grava lista nenhuma e a rota não vira 500', async () => {
  const rodarPreparar = async (corpo) => {
    const s = await sessaoDeTeste(COOKIES);
    const antes = new Set(s.store.mem.keys());
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(corpo), { status: 200 });
    try {
      const r = await dispatch('excluir-foto', { ...s.dados, region: 'row', action: 'preparar', venueID: 'v1', imageID: 'i1', lat: -23.5, lon: -46.6, aquecimento: 'gesto-lote21-01' }, s.ctx);
      return { r, puts: [...s.store.mem.keys()].filter((k) => !antes.has(k)) };
    } finally { globalThis.fetch = original; }
  };
  const boa = await rodarPreparar({ venues: { objects: [{ id: 'v1', images: [{ id: 'i1', approved: true }] }] } });
  assert.equal(boa.r.status, 200, `CONTROLE: ${JSON.stringify(boa.r.body)}`);
  assert.equal(boa.puts.length, 1, 'CONTROLE: a lista do toque devia ser gravada');
  for (const corpo of [{ venues: { objects: 5 } }, { venues: { objects: [{ id: 'v1', images: 5 }] } }]) {
    const { r, puts } = await rodarPreparar(corpo);
    assert.notEqual(r.body.errorKey, 'srv.err.internal', JSON.stringify(r.body));
    assert.deepEqual(puts, [], 'gravou lista de uma leitura quebrada');
  }
});
