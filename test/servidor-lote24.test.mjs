// Lote 24 (rodada 20, área "servidor e filtros"): três pontas soltas da régua estrita.
//
// A1 — `parear` `create` coagia `comCodigo` com `!!`: `true`, "false", "0", "no", {} e []
//      davam o código FRACO de 6 símbolos, o segredo que "só existe sob demanda". Hoje é
//      booleano estrito (`=== true`), como o `approve` e o `token` das outras rotas.
// A3 — `loadFilters` não conferia `residential` nem `myArea`: `residential: true` abria o
//      select em "true" e a 1ª busca saía sem o filtro; `myArea: "false"` LIGAVA "Minha área".
// A4 — `creatorName` perdia o id quando o usuário estava em `users` sem `userName`: o card
//      mostrava "(desconhecido)" com `creatorId` 7. Id sem nome mostra o NÚMERO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dispatch, buildPlacesFromSearch } from '../server/core.mjs';
import { sessaoDeTeste } from './_sessao.mjs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const NS = (n, v) => `.waze.com\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NS('_csrf_token', 'csrf-abc'), NS('_web_session', 'sess-xyz')].join('\n');

// ═══ A1 · parear create: comCodigo é booleano ESTRITO ════════════════════════
test('A1: parear create — só `comCodigo === true` dá o código curto; todo o resto dá o FORTE (20 símbolos)', async () => {
  const { dados, ctx } = await sessaoDeTeste(COOKIES);
  const forte = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{20}$/;
  const truthy = ['true', 'false', '0', '1', 'no', 'sim', 1, 2, -1, {}, [], [true], { a: 1 }, 'comCodigo'];
  for (const v of truthy) {
    const r = await dispatch('parear', { action: 'create', ...dados, comCodigo: v }, ctx);
    assert.equal(r.status, 200);
    assert.match(r.body.code, forte, `DEFEITO: comCodigo=${JSON.stringify(v)} deu o código fraco`);
    assert.equal(r.body.curto, false, `comCodigo=${JSON.stringify(v)} não pode marcar o registro como curto`);
  }
  // CONTROLES: ausente/false/null/undefined/0 seguem dando o forte, e `true` o curto.
  for (const v of [undefined, false, null, 0, '']) {
    const r = await dispatch('parear', { action: 'create', ...dados, comCodigo: v }, ctx);
    assert.match(r.body.code, forte, `CONTROLE: comCodigo=${JSON.stringify(v)}`);
  }
  const curto = await dispatch('parear', { action: 'create', ...dados, comCodigo: true }, ctx);
  assert.match(curto.body.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/, 'CONTROLE: `true` precisa continuar dando o curto');
  assert.equal(curto.body.curto, true);
  // O curto resgata (o instrumento não quebrou o caminho legítimo).
  const claim = await dispatch('parear', { action: 'claim', code: curto.body.code }, ctx);
  assert.equal(claim.body.success, true);
});

test('A1: `createPairing` direto também é estrito (a camada de baixo não coage)', async () => {
  const { sessions } = await sessaoDeTeste(COOKIES);
  for (const v of ['false', 'x', 1, {}, []]) {
    const r = await sessions.createPairing('cookies-x', { comCodigo: v });
    assert.equal(r.code.length, 20, `DEFEITO: comCodigo=${JSON.stringify(v)} deu o curto`);
    assert.equal(r.curto, false);
  }
  const r = await sessions.createPairing('cookies-x', { comCodigo: true });
  assert.equal(r.code.length, 6, 'CONTROLE: true dá o curto');
  assert.equal(r.curto, true);
});

test('A1: o app só manda `comCodigo` booleano (api.js e app.js)', () => {
  const api = ler('js/api.js');
  assert.match(api, /async criarPareamento\(\{ comCodigo = false,/, 'o padrão do app é false');
  const usos = [...ler('js/app.js').matchAll(/criarPareamento\(\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(usos.length >= 1);
  for (const u of usos) if (/comCodigo/.test(u)) assert.match(u, /comCodigo: true\b/, `chamada que manda comCodigo não booleano: ${u}`);
  assert.ok(usos.some((u) => /comCodigo: true\b/.test(u)), 'CONTROLE: o pedido do código curto sumiu do app');
});

// ═══ A3 · loadFilters: residential e myArea ═════════════════════════════════
const APP = ler('js/app.js');
const SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function fatiar(nome) {
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let prof = 0;
  for (let j = SEM.indexOf('{', m.index); j < SEM.length; j++) {
    if (SEM[j] === '{') prof++;
    else if (SEM[j] === '}' && --prof === 0) return SEM.slice(m.index, j + 1);
  }
  throw new Error('não fechou: ' + nome);
}
function carregarFiltros(salvo) {
  const filtros = { types: [], residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true, categories: [], sortOrder: 'newest' };
  const deps = { AppState: { filters: filtros }, FILTERS_KEY: 'f', ORDEM_PADRAO: 'newest', sanearTiposSalvos: (x) => (Array.isArray(x) ? x : []),
    localStorage: { getItem: () => JSON.stringify(salvo) } };
  const chaves = Object.keys(deps);
  new Function(...chaves, ['idSalvoValido', 'categoriasSalvasValidas', 'loadFilters'].map(fatiar).join('\n') + '\nloadFilters();')(...chaves.map((k) => deps[k]));
  return filtros;
}

test('A3: loadFilters — `residential` só volta se for "true"/"false" (o que o select grava); o resto volta a "Indiferente"', () => {
  for (const v of [true, false, 1, 'x', 'TRUE', ' true', {}, [], ['true'], null]) {
    assert.equal(carregarFiltros({ residential: v }).residential, '', `DEFEITO: ${JSON.stringify(v)} voltou como filtro residencial`);
  }
  // CONTROLES: o que o select legítimo grava.
  for (const v of ['true', 'false', '']) assert.equal(carregarFiltros({ residential: v }).residential, v, `CONTROLE: ${JSON.stringify(v)} foi descartado`);
});

test('A3: loadFilters — `myArea` só liga com o booleano `true` (o que o checkbox grava)', () => {
  for (const v of ['false', 'true', '0', 1, 'on', {}, [], [true], null]) {
    assert.equal(carregarFiltros({ myArea: v }).myArea, false, `DEFEITO: myArea=${JSON.stringify(v)} ligou "Minha área"`);
  }
  assert.equal(carregarFiltros({ myArea: true }).myArea, true, 'CONTROLE: `true` foi descartado');
  assert.equal(carregarFiltros({ myArea: false }).myArea, false);
  assert.equal(carregarFiltros({}).myArea, false);
});

// ═══ A4 · creatorName: id sem nome mostra o NÚMERO ═══════════════════════════
function buscaComUsuario(usuario) {
  return buildPlacesFromSearch({
    users: { objects: usuario ? [usuario] : [] }, streets: { objects: [] }, cities: { objects: [] }, states: { objects: [] },
    venues: { objects: [{
      id: '1.2.3', name: 'Padaria', permissions: -1, categories: ['BAKERY'], images: [],
      venueUpdateRequests: [{ id: 'u-1', venueID: '1.2.3', type: 'REQUEST', subType: 'UPDATE', changedVenue: { name: 'Padaria Nova' }, createdBy: 7, isRead: false }],
    }] },
  }, { unreadOnly: false }).places[0];
}

test('A4: usuário em `users` sem nome utilizável mostra o id; com nome, o nome', () => {
  for (const u of [{ id: 7, userName: '' }, { id: 7 }, { id: 7, userName: null }, { id: 7, userName: 123 }, { id: 7, userName: {} }]) {
    const p = buscaComUsuario(u);
    assert.equal(p.creatorId, 7);
    assert.equal(p.createdBy, 7, `DEFEITO: ${JSON.stringify(u)} perdeu o id (o card mostraria "(desconhecido)")`);
  }
  // CONTROLES: ausente de `users` = id; com nome = nome.
  assert.equal(buscaComUsuario(null).createdBy, 7, 'CONTROLE: usuário ausente');
  assert.equal(buscaComUsuario({ id: 7, userName: 'joao' }).createdBy, 'joao', 'CONTROLE: o nome volta como nome');
});
