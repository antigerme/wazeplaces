// Lote 23 (rodada 19, área "servidor/filtros e foto ampliada"): o que o CLIENTE
// ainda decidia com uma régua mais frouxa que a do servidor.
//
// R19-6-01 — `API.paisOuPadrao` usava `parseInt` e `n > 0`: '99999999999999999999'
//            (além de 2^53) passava, o servidor (`Number.isSafeInteger`) respondia 400
//            `countryRequired` a cada abertura; '1e3' virava 1 e '30abc' virava 30.
// R19-6-02 — `Lightbox.idFotoAtual` lia `lat`/`lon` com `Number()`: `null` é 0, e o card
//            sem geometria mostrava a lixeira que o servidor recusa (400) depois dos 3 s
//            do Desfazer. Regra do projeto: nunca ofereça ação impossível.
// (R19-3-02, o duplo toque da foto, está em test/lightbox-zoom.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { dispatch } from '../server/core.mjs';
import { sessaoDeTeste } from './_sessao.mjs';

const ler = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const NS = (n, v) => `.waze.com\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NS('_csrf_token', 'csrf-abc'), NS('_web_session', 'sess-xyz')].join('\n');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

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

async function buscar(countryId) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => json({ mapIssues: {}, venues: {} });
  try {
    const s = await sessaoDeTeste(COOKIES);
    return await dispatch('buscar-places', { ...s.dados, region: 'row', countryId, page: 1 }, s.ctx);
  } finally { globalThis.fetch = original; }
}

test('R19-6-01: o país guardado passa pela régua do servidor — inteiro puro e SEGURO; o resto é o Brasil, e a busca aceita o que sai', async () => {
  const esperado = {
    '30': 30, '235': 235, ' 73 ': 73, '9007199254740991': 9007199254740991,
    '99999999999999999999': 30, '9007199254740993': 30,   // além de 2^53: o servidor recusa
    '1e3': 30, '30abc': 30, '0x1f': 30, '3.9': 30, '+5': 30, '1_0': 30,   // o parseInt lia 1, 30, 0, 3, 5 e 1
    '0': 30, '-5': 30, 'abc': 30, '': 30,
  };
  for (const [guardado, pais] of Object.entries(esperado)) {
    const { API } = apiComStorage({ waze_country: guardado });
    assert.equal(API.getCountry(), pais, `waze_country=${JSON.stringify(guardado)}`);
    const r = await buscar(API.getCountry());
    // Só o que o servidor aceita pode sair (era o 400 countryRequired a cada abertura).
    assert.equal(r.status, 200, `waze_country=${JSON.stringify(guardado)} → busca ${r.status} ${r.body.errorKey || ''}`);
  }
  // CONTROLE: o que o cliente de antes mandava, o servidor recusa.
  const r = await buscar(Number('99999999999999999999'));
  assert.equal(r.status, 400, 'CONTROLE: o servidor deixou de recusar o inteiro além de 2^53');
  // `setCountry` segue a mesma régua (número ou texto de dígitos); o número fracionário e o gigante caem no Brasil.
  const { API, dados } = apiComStorage({});
  API.setCountry(73); assert.equal(API.getCountry(), 73);
  API.setCountry('145'); assert.equal(API.getCountry(), 145);
  API.setCountry(3.9); assert.equal(API.getCountry(), 30);
  API.setCountry(1e21); assert.equal(API.getCountry(), 30);
  assert.equal(dados.get('waze_country'), '30');
});

// ── R19-6-02: a lixeira só existe com a geometria que o servidor aceita ─────
function idFotoAtualDe(place, { podeExcluir = true } = {}) {
  const ini = APP.indexOf('\n    idFotoAtual() {', APP.indexOf('const Lightbox = {')) + 1;
  assert.ok(ini > 0, 'Lightbox.idFotoAtual sumiu');
  let prof = 0, fim = -1;
  for (let j = APP.indexOf('{', ini); j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}' && --prof === 0) { fim = j + 1; break; }
  }
  const metodo = APP.slice(ini, fim).trim();
  const fn = new Function('podeExcluirFotoAqui', 'return { ' + metodo + ' };')(() => podeExcluir);
  const L = { ...fn, place, urls: ['https://x/foto.jpg'], idx: 0, idAprovadoDaFoto: () => 'img-1' };
  return L.idFotoAtual();
}

test('R19-6-02: a lixeira da foto exige lat/lon NÚMEROS finitos e dentro do mapa — `null` (que `Number()` lia como 0) não serve', () => {
  const base = { venueID: 'v1', lat: -23.5, lon: -46.6 };
  assert.equal(idFotoAtualDe(base), 'img-1', 'CONTROLE: com geometria válida a lixeira não apareceu');
  assert.equal(idFotoAtualDe({ ...base, lat: 0, lon: 0 }), 'img-1', 'CONTROLE: (0, 0) é um ponto válido');
  const ruins = [null, undefined, '', '12', true, [], {}, NaN, Infinity, 91, -91];
  for (const v of ruins) {
    assert.equal(idFotoAtualDe({ ...base, lat: v }), null, `DEFEITO: lat=${String(v)} mostra a lixeira (o servidor recusa com 400)`);
  }
  for (const v of [null, undefined, '', '12', true, [], {}, NaN, -Infinity, 181, -181]) {
    assert.equal(idFotoAtualDe({ ...base, lon: v }), null, `DEFEITO: lon=${String(v)} mostra a lixeira (o servidor recusa com 400)`);
  }
  assert.equal(idFotoAtualDe({ venueID: 'v1' }), null, 'DEFEITO: sem lat/lon a lixeira aparece');
  assert.equal(idFotoAtualDe(base, { podeExcluir: false }), null, 'CONTROLE: sem o portão de L6 a lixeira apareceu');
});

test('R19-6-02: a régua do cliente é a MESMA do `coordenadaDoCorpo` do servidor — o que ele aceita, o cliente oferece, e vice-versa', async () => {
  const casos = [[-23.5, -46.6], [0, 0], [90, 180], [-90, -180], [91, 0], [0, 181], [null, null], [undefined, 1], ['1', '2'], [NaN, 0], [true, false]];
  for (const [lat, lon] of casos) {
    const cliente = idFotoAtualDe({ venueID: 'v1', lat, lon }) !== null;
    const original = globalThis.fetch;
    globalThis.fetch = async () => json({ venues: { objects: [] } });
    let servidor;
    try {
      const s = await sessaoDeTeste(COOKIES);
      const r = await dispatch('excluir-foto', { ...s.dados, region: 'row', venueID: 'v1', imageID: 'i1', lat, lon }, s.ctx);
      servidor = !(r.status === 400 && r.body.errorKey === 'srv.err.incompleteParams');
    } finally { globalThis.fetch = original; }
    assert.equal(cliente, servidor, `lat=${JSON.stringify(lat)} lon=${JSON.stringify(lon)}: cliente ${cliente ? 'oferece' : 'esconde'}, servidor ${servidor ? 'aceita' : 'recusa'}`);
  }
});

test('R19-6-02: nenhum outro lugar do cliente decide a lixeira/`preparar` com `Number(` na coordenada', () => {
  const codigo = APP.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const solto = codigo.match(/Number\(\s*[\w.]*\b(lat|lon)\b[\w.]*\s*\)/g) || [];
  assert.deepEqual(solto, [], `\`Number()\` lendo coordenada (lê null como 0): ${solto.join(' | ')}`);
});
