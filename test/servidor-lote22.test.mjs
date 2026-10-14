// Lote 22 (rodada 18, área "servidor e documentos"): o que o servidor LÊ do corpo
// sem conferir o tipo, e o que o cliente guarda e o servidor recusa.
//
// R18-6-02 — `excluir-foto` lia `lat`/`lon` com `Number()`: `null`, `''`, `true` e
//            `[]` viravam 0 e a releitura ia ao Waze em (0°, 0°).
// R18-6-03 — `types`, `residential` e `unreadOnly` falhavam calados: `types: [1, 5]`
//            dava 200 com zero cards ("Tudo limpo!") e `residential: 'false'` virava
//            `true` — o OPOSTO de excluir os residenciais.
// R18-6-04 — a caixa de "Minha área" (a do `perfil`) podia sair além de ±180/±90, que
//            a busca recusa (400 permanente).
// R18-6-05 — `waze_country = '-5'` no aparelho virava -5 e a busca dava 400 a cada abertura.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { dispatch, PUR_TIPOS } from '../server/core.mjs';
import { sessaoDeTeste } from './_sessao.mjs';

const NS = (n, v) => `.waze.com\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NS('_csrf_token', 'csrf-abc'), NS('_web_session', 'sess-xyz')].join('\n');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const ler = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

// Um Waze de mentira que guarda cada ida (URL e corpo).
async function comWaze(resposta, fn) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), corpo: init.body ? JSON.parse(init.body) : null });
    return resposta(String(url));
  };
  try { return { r: await fn(), chamadas }; } finally { globalThis.fetch = original; }
}

// ── R18-6-02: a coordenada do local ─────────────────────────────────────────
async function excluir(extra) {
  const s = await sessaoDeTeste(COOKIES);
  return comWaze(() => json({ venues: { objects: [] } }),
    () => dispatch('excluir-foto', { ...s.dados, region: 'row', venueID: 'v1', imageID: 'i1', ...extra }, s.ctx));
}
const bboxLido = (chamadas) => {
  const u = chamadas.find((c) => /Features\?/.test(c.url));
  return u ? decodeURIComponent(new URL(u.url).searchParams.get('bbox')) : null;
};

test('R18-6-02: CONTROLE — coordenada de número (inclusive 0, 0 e os extremos) chega ao Waze na caixa do local', async () => {
  const { r, chamadas } = await excluir({ lat: -23, lon: -46 });
  assert.equal(r.status, 404, 'o Waze de mentira não tem o local: 404 venueGone, mas a leitura SAIU');
  assert.equal(r.body.errorKey, 'srv.err.venueGone');
  assert.equal(bboxLido(chamadas), '-46.0002,-23.0002,-45.9998,-22.9998');
  // 0 e 0 de NÚMERO são o ponto (0°, 0°) de verdade — vale, como valia.
  assert.ok(bboxLido((await excluir({ lat: 0, lon: 0 })).chamadas), '0, 0 numéricos foram recusados');
  for (const [lat, lon] of [[90, 180], [-90, -180]]) {
    assert.ok(bboxLido((await excluir({ lat, lon })).chamadas), `os extremos ${lat}, ${lon} foram recusados`);
  }
});

test('R18-6-02: lat/lon que não são dois números finitos na faixa são 400 incompleteParams, sem ir ao Waze (excluir E preparar)', async () => {
  const ruins = [
    [null, null], ['', ''], [true, []], [[], []], [false, false], [{}, {}], [[-23], [-46]],
    ['-23', '-46'], ['abc', 'def'], [NaN, NaN], [Infinity, 0], [0, -Infinity],
    [91, 0], [-91, 0], [0, 181], [0, -181], [-23, undefined], [undefined, -46], [undefined, undefined], [-23, null],
  ];
  for (const acao of [undefined, 'preparar']) {
    for (const [lat, lon] of ruins) {
      const { r, chamadas } = await excluir({ lat, lon, ...(acao ? { action: acao, aquecimento: 'gesto-lote22' } : {}) });
      const quem = `${acao || 'excluir'} lat=${String(lat)} lon=${String(lon)}`;
      assert.equal(r.status, 400, `${quem}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
      assert.equal(r.body.errorKey, 'srv.err.incompleteParams', quem);
      assert.equal(chamadas.length, 0, `${quem}: foi ao Waze`);
    }
  }
});

// ── R18-6-03: types, residential, unreadOnly ────────────────────────────────
// Duas fixtures: um NEW_PLACE e uma NEW_PHOTO, pra "cards" separar os filtros.
const WAZE_COM_DOIS = {
  users: { objects: [] },
  venues: { objects: [
    { id: 'v1', name: 'A', permissions: -1, geometry: { type: 'Point', coordinates: [1, 2] }, venueUpdateRequests: [{ id: 'u1', type: 'VENUE', isRead: false }] },
    { id: 'v2', name: 'B', permissions: -1, geometry: { type: 'Point', coordinates: [1, 2] }, venueUpdateRequests: [{ id: 'u2', type: 'IMAGE', isRead: false }] },
  ] },
};
async function buscar(extra) {
  const s = await sessaoDeTeste(COOKIES);
  const { r, chamadas } = await comWaze(() => json(WAZE_COM_DOIS),
    () => dispatch('buscar-places', { ...s.dados, region: 'row', countryId: 30, ...extra }, s.ctx));
  const lista = chamadas.find((c) => /Issues\/Search\/List/.test(c.url));
  return { r, chamadas, enviado: lista ? lista.corpo : null };
}
const recusada = (x, quem) => {
  assert.equal(x.r.status, 400, `${quem}: HTTP ${x.r.status} ${JSON.stringify(x.r.body).slice(0, 100)}`);
  assert.equal(x.r.body.errorKey, 'srv.err.badRequest', quem);
  assert.equal(x.chamadas.length, 0, `${quem}: foi ao Waze`);
};

test('R18-6-03: CONTROLE — o que o app manda em `types` segue valendo (ausente, null, [], um tipo, os 7, e o que não é lista) e filtra', async () => {
  const cards = async (extra) => {
    const x = await buscar(extra);
    assert.equal(x.r.status, 200, JSON.stringify(extra) + ' ' + JSON.stringify(x.r.body).slice(0, 100));
    return x.r.body.places.length;
  };
  assert.equal(await cards({}), 2);
  assert.equal(await cards({ types: undefined }), 2);
  assert.equal(await cards({ types: null }), 2);
  assert.equal(await cards({ types: [] }), 2, 'lista vazia segue valendo "todos"');
  // O que não é lista segue sem filtro de tipo, como sempre foi (o app só manda lista).
  for (const naoLista of ['NEW_PLACE', 5, true, {}]) assert.equal(await cards({ types: naoLista }), 2, `types ${JSON.stringify(naoLista)}`);
  assert.equal(await cards({ types: ['NEW_PLACE'] }), 1);
  assert.equal(await cards({ types: ['NEW_PLACE', 'NEW_PHOTO'] }), 2);
  assert.equal(await cards({ types: Object.keys(PUR_TIPOS) }), 2, 'os 7 tipos do WME');
});

test('R18-6-03: `types` (lista) com tipo desconhecido, número, caixa baixa ou objeto dentro é 400 — não "zero cards" com 200', async () => {
  const ruins = [[1, 5], ['new_place'], ['FOO'], ['NEW_PLACE', 'FOO'], [''], [null], [['NEW_PLACE']], [{ a: 1 }],
    ['constructor'], ['__proto__'], ['toString']];
  for (const v of ruins) recusada(await buscar({ types: v }), `types ${JSON.stringify(v)}`);
});

test('R18-6-03: todo valor de `types` que o CLIENTE pode mandar (TYPES_ALL, TYPES_PADRAO) é um tipo do servidor', () => {
  // O cliente manda `AppState.filters.types`, que sai de TYPES_ALL (e do padrão, subconjunto).
  const fonte = ler('js/app.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const m = fonte.match(/const TYPES_ALL = \[([^\]]+)\]/);
  assert.ok(m, 'não achei TYPES_ALL no app.js (o guard perdeu o alvo)');
  const todos = [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
  assert.equal(todos.length, 7, 'TYPES_ALL deixou de ter os 7 tipos do WME: revise a lista branca do servidor');
  for (const t of todos) assert.ok(Object.hasOwn(PUR_TIPOS, t), `o cliente manda "${t}", que o servidor passaria a recusar`);
  assert.deepEqual([...todos].sort(), Object.keys(PUR_TIPOS).sort(), 'o servidor conhece tipo que o cliente não tem (ou o contrário)');
});

test('R18-6-03: `residential` e `unreadOnly` são booleano ESTRITO; ausente/null valem o padrão de sempre', async () => {
  // CONTROLE: o corpo que o app manda hoje, e cada booleano de verdade, chegam ao Waze como vieram.
  const base = await buscar({});
  assert.equal(base.r.status, 200);
  assert.equal(base.enviado.venueUpdateRequestsFilter.residential, null, 'o app padrão NÃO filtra residencial (true anonimiza a fila)');
  assert.deepEqual(base.enviado.userPropertiesFilter, { isRead: false });
  for (const [campo, valor, onde] of [
    ['residential', true, (e) => e.venueUpdateRequestsFilter.residential],
    ['residential', false, (e) => e.venueUpdateRequestsFilter.residential],
  ]) {
    const x = await buscar({ [campo]: valor });
    assert.equal(x.r.status, 200);
    assert.equal(onde(x.enviado), valor, `${campo}: ${valor} não chegou como veio`);
  }
  assert.deepEqual((await buscar({ unreadOnly: false })).enviado.userPropertiesFilter, {}, '"lidos também" não chegou');
  assert.deepEqual((await buscar({ unreadOnly: true })).enviado.userPropertiesFilter, { isRead: false });
  // Ausente e null: o padrão — e o null NÃO é "false" (que excluiria os residenciais / mostraria os lidos).
  for (const v of [undefined, null]) {
    const x = await buscar({ residential: v, unreadOnly: v });
    assert.equal(x.r.status, 200, String(v));
    assert.equal(x.enviado.venueUpdateRequestsFilter.residential, null, `residential ${v}: virou filtro`);
    assert.deepEqual(x.enviado.userPropertiesFilter, { isRead: false }, `unreadOnly ${v}: virou "lidos também"`);
  }
  // O que não é booleano: 400, antes do Waze.
  for (const campo of ['residential', 'unreadOnly']) {
    for (const v of ['false', 'true', '', 0, 1, [], {}, ['true'], 'abc']) {
      recusada(await buscar({ [campo]: v }), `${campo} ${JSON.stringify(v)}`);
    }
  }
});

// ── R18-6-04: a caixa de "Minha área" cabe no que a busca aceita ────────────
test('R18-6-04: a caixa do perfil sai limitada a lon ±180 / lat ±90 (e a busca por ela passa); dentro dos limites, nada muda', async () => {
  const bboxDe = async (geometry) => {
    const s = await sessaoDeTeste(COOKIES);
    const { r } = await comWaze(() => json({ id: 1, userName: 'x', rank: 5, isAreaManager: true, isStaff: false, areas: [{ type: 'drive', geometry }] }),
      () => dispatch('perfil', { ...s.dados, region: 'row' }, s.ctx));
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 120));
    return r.body.profile.areas[0].bbox;
  };
  const poligono = (...pts) => ({ type: 'Polygon', coordinates: [pts] });
  // CONTROLE: a área normal sai como sempre saiu (inclusive colada nos limites).
  assert.deepEqual(await bboxDe(poligono([-47, -23], [-46, -23], [-46, -22], [-47, -22], [-47, -23])), [-47, -23, -46, -22]);
  assert.deepEqual(await bboxDe(poligono([-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90])), [-180, -90, 180, 90]);
  // Vértice além do globo: polígono que cruza a linha de data com longitude contínua, e ponto flutuante.
  const fiji = await bboxDe(poligono([170, -20], [190, -20], [190, -15], [170, -15], [170, -20]));
  assert.deepEqual(fiji, [170, -20, 180, -15]);
  assert.deepEqual(await bboxDe(poligono([-180.0000001, 10], [180.0000001, 10], [0, 90.00000001], [0, -90.00000001])), [-180, -90, 180, 90]);
  // E o que sai é o que a busca por área ACEITA — o 400 permanente era justamente isso.
  for (const caixa of [fiji, [-180, -90, 180, 90]]) {
    const x = await buscar({ bbox: caixa });
    assert.equal(x.r.status, 200, `a caixa ${JSON.stringify(caixa)} que o perfil devolve foi recusada pela busca`);
  }
});

// ── R18-6-05: o país guardado no aparelho ───────────────────────────────────
function apiComStorage(guardado) {
  const dados = new Map(Object.entries(guardado));
  const ctx = {
    console, setTimeout, clearTimeout, navigator: { language: 'pt', onLine: true }, window: {}, document: { cookie: '' },
    localStorage: {
      getItem: (k) => (dados.has(k) ? dados.get(k) : null),
      setItem: (k, v) => { dados.set(k, String(v)); },
      removeItem: (k) => { dados.delete(k); },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(ler('js/api.js') + '\nthis.API = API;', ctx);
  return { API: ctx.API, dados };
}

test('R18-6-05: `waze_country` guardado só vale se for inteiro POSITIVO — o resto é o Brasil, e o servidor aceita o que o app manda', async () => {
  const esperado = { '30': 30, '235': 235, '0': 30, 'abc': 30, '-5': 30, '-1': 30, '': 30 };
  for (const [guardado, pais] of Object.entries(esperado)) {
    const { API } = apiComStorage({ waze_country: guardado });
    assert.equal(API.getCountry(), pais, `waze_country=${JSON.stringify(guardado)}`);
    // O que sai do cliente é o que a busca aceita (era o 400 countryRequired a cada abertura).
    const s = await sessaoDeTeste(COOKIES);
    const { r } = await comWaze(() => json({ mapIssues: {}, venues: {} }),
      () => dispatch('buscar-places', { ...s.dados, region: 'row', countryId: API.getCountry(), page: 1 }, s.ctx));
    assert.equal(r.status, 200, `waze_country=${JSON.stringify(guardado)} → busca ${r.status} ${r.body.errorKey || ''}`);
  }
  // A escrita pelo setCountry segue a mesma régua (e grava o que valeu).
  const { API, dados } = apiComStorage({});
  API.setCountry(-5);
  assert.equal(API.getCountry(), 30);
  assert.equal(dados.get('waze_country'), '30');
  API.setCountry('73');
  assert.equal(API.getCountry(), 73);
});
