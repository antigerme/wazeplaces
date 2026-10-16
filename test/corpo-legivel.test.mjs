// O corpo que a conversão pra texto ou número não consegue ler (auditoria do
// servidor de 2026-09-29, S10).
//
// `JSON.parse` dá objeto com `toString`/`valueOf` PRÓPRIOS a quem mandar a
// chave no JSON (`{"toString":1}`), e aí `String(v)`, `parseInt(v)` e
// `Number(v)` LANÇAM. Quase todo campo de quase toda rota passa por um deles, e
// o pedido virava o 500 genérico de "erro interno" em vez de 400 (53 achados no
// fuzz). O conserto é UM lugar só — o `dispatch`, antes do handler —, então o
// teste cobre TODAS as rotas, lidas do próprio `ROUTES` do core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { dispatch } from '../server/core.mjs';
import { sessaoDeTeste } from './_sessao.mjs';

const NETSCAPE = (d, n, v) => `${d}\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NETSCAPE('.waze.com', '_csrf_token', 'csrf-abc'), NETSCAPE('.waze.com', '_web_session', 'sess-xyz')].join('\n');

// As rotas, do `ROUTES` do core: rota nova entra no teste sozinha.
const CORE = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');
const bloco = /^const ROUTES = \{\n([\s\S]*?)^\};/m.exec(CORE);
const ROTAS = bloco ? [...bloco[1].matchAll(/^\s+'?([\w-]+)'?:\s*handle\w+,/gm)].map((m) => m[1]) : [];

async function semWaze(fn) {
  const original = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = async () => { chamadas++; throw new Error('não podia ter ido ao Waze'); };
  try { return { r: await fn(), chamadas: () => chamadas }; } finally { globalThis.fetch = original; }
}

function aninhado(niveis) {
  let o = { fim: true };
  for (let i = 0; i < niveis; i++) o = { a: o };
  return o;
}

test('corpo com toString/valueOf PRÓPRIO, em qualquer campo e profundidade, é 400 de pedido inválido — em TODA rota, antes do Waze', async () => {
  assert.ok(ROTAS.length >= 15 && ROTAS.includes('marcar-lido') && ROTAS.includes('lista-estados'),
    `CONTROLE: não li as rotas do core (${ROTAS.join(', ')})`);
  const s = await sessaoDeTeste(COOKIES);
  const hostis = [
    ['no corpo', { toString: 1 }],
    ['num campo', { venueID: { toString: 1 } }],
    ['valueOf', { countryId: { valueOf: 1 } }],
    ['dentro de outro objeto', { presenca: { userId: '1', lat: { toString: 'x' } } }],
    ['dentro de uma lista', { items: [{ venueID: 'v1', updateRequestID: { toString: 1 } }] }],
    ['lá no fundo', { contexto: { a: { b: { c: { toString: 1 } } } } }],
    ['fundo DEMAIS pra examinar (100 mil níveis)', { contexto: aninhado(100000) }],
  ];
  for (const rota of ROTAS) {
    for (const [nome, extra] of hostis) {
      const antes = s.store.mem.size;
      let r;
      const w = await semWaze(async () => { r = await dispatch(rota, { ...s.dados, region: 'row', ...extra }, s.ctx); });
      assert.equal(r.status, 400, `${rota}, ${nome}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 90)}`);
      assert.equal(r.body.errorKey, 'srv.err.badRequest', `${rota}, ${nome}`);
      assert.equal(w.chamadas(), 0, `${rota}, ${nome}: foi ao Waze`);
      assert.equal(s.store.mem.size, antes, `${rota}, ${nome}: mexeu no armazenamento`);
    }
  }
});

test('os casos do fuzz que davam o 500 genérico agora são 400 — e o que é legítimo passa', async () => {
  // Três do fuzz da auditoria, cada um numa conversão diferente: `String()` do
  // id, `parseInt()` da página e `Number()` da posição.
  const s = await sessaoDeTeste(COOKIES);
  for (const [rota, corpo] of [
    ['marcar-lido', { venueID: { toString: 1 }, updateRequestID: 'u1' }],
    ['buscar-places', { page: { toString: 1 } }],
    ['excluir-foto', { venueID: 'v1', imageID: 'i1', lat: { valueOf: 1 }, lon: -46.6 }],
  ]) {
    const { r } = await semWaze(() => dispatch(rota, { ...s.dados, region: 'row', ...corpo }, s.ctx));
    assert.notEqual(r.body.errorKey, 'srv.err.internal', `${rota}: ainda é o "erro interno"`);
    assert.equal(r.status, 400, `${rota}: HTTP ${r.status}`);
  }
  // CONTROLE: "toString" como VALOR, numa chave que só COMEÇA igual, e um
  // corpo de 3 níveis passam pela guarda (e chegam ao handler — aqui, ao 400
  // do próprio handler ou ao Waze, nunca ao `badRequest`).
  const legitimos = [
    ['lista-estados', { countryId: 30, nome: 'toString' }],
    ['lista-estados', { countryId: 30, toStringX: 1, valueOff: 2 }],
    ['marcar-lido', { venueID: 'v1', updateRequestID: 'u1', presenca: { userId: '1', lat: -23.5, lon: -46.6, pais: 30, conhecidos: ['1', '2'] } }],
  ];
  for (const [rota, corpo] of legitimos) {
    const original = globalThis.fetch;
    let foi = 0;
    globalThis.fetch = async () => { foi++; return new Response(JSON.stringify({ states: [] }), { status: 200 }); };
    try {
      const r = await dispatch(rota, { ...s.dados, region: 'row', ...corpo }, s.ctx);
      assert.notEqual(r.body.errorKey, 'srv.err.badRequest', `CONTROLE (${rota}): a guarda barrou um corpo legítimo: ${JSON.stringify(corpo)}`);
      assert.ok(foi > 0, `CONTROLE (${rota}): o pedido legítimo não chegou ao Waze`);
    } finally { globalThis.fetch = original; }
  }
});
