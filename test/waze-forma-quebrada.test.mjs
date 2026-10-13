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
