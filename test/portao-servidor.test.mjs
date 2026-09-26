// O servidor, pela auditoria de 2026-09-25. Cada teste daqui foi visto
// REPROVANDO com o conserto desfeito (gotcha #28, pergunta 1).
//
// O furo principal era o portão: o `isUserAllowed` (L2+AM ou staff) só roda no
// `testar-cookies`, e duas portas laterais o contornavam — o `sessao` criava
// sessão de cookies crus (e era o PADRÃO de quem não mandava `action`), e o
// `resolveCookies` aceitava `cookies` crus no corpo de QUALQUER rota.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { dispatch, categorizeWazeError, filterWazeCookies, prepareAuth } from '../server/core.mjs';
import { readBody } from '../server/corpo.mjs';
import { sessaoDeTeste } from './_sessao.mjs';

const NETSCAPE = (d, n, v, httpOnly = false) => `${httpOnly ? '#HttpOnly_' : ''}${d}\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NETSCAPE('.waze.com', '_csrf_token', 'csrf-abc'), NETSCAPE('.waze.com', '_web_session', 'sess-xyz')].join('\n');

// Troca o fetch por um Waze que ANOTA cada chamada e responde o que o teste mandar.
async function comWaze(responder, fn) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    chamadas.push({ url: String(url), init });
    return responder(String(url), init);
  };
  try {
    return { r: await fn(), chamadas };
  } finally {
    globalThis.fetch = original;
  }
}
const naoPodiaIrAoWaze = () => { throw new Error('não podia ter ido ao Waze'); };
const json = (o, status = 200) => new Response(typeof o === 'string' ? o : JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

// ── o portão ────────────────────────────────────────────────────────────────

test('sessao: não cria sessão — nem com `create`, nem sem `action` (era o padrão)', async () => {
  const s = await sessaoDeTeste(COOKIES);
  const antes = s.store.mem.size;
  for (const corpo of [{ cookies: COOKIES }, { action: 'create', cookies: COOKIES }, {}]) {
    const { r, chamadas } = await comWaze(naoPodiaIrAoWaze, () => dispatch('sessao', corpo, s.ctx));
    assert.equal(r.status, 400, JSON.stringify(corpo).slice(0, 60));
    assert.equal(r.body.errorKey, 'srv.err.badAction');
    assert.ok(!r.body.sessionToken, 'devolveu token sem passar pelo portão do login');
    assert.equal(chamadas.length, 0);
  }
  assert.equal(s.store.mem.size, antes, 'gravou sessão no store');
});

// Toda rota que age em nome de alguém. Os corpos passam na validação de cada
// uma, então o 401 só pode vir da falta de sessão.
const ROTAS = {
  'validar-place': { venueID: 'v1', updateRequestID: 'u1' },
  'marcar-lido': { venueID: 'v1', updateRequestID: 'u1' },
  'guardar-pedido': { venueID: 'v1', updateRequestID: 'u1', value: true },
  'buscar-places': { countryId: 30 },
  'renomear-local': { venueID: 'v1', nome: 'Padaria' },
  'excluir-foto': { venueID: 'v1', imageID: 'i1', lat: -23.5, lon: -46.6 },
  perfil: {},
  'lista-paises': {},
  'lista-estados': { countryId: 30 },
  parear: { action: 'create' },
  'presenca-waze': { caixa: [-1, -1, 1, 1] },
  'presenca-app': { pais: 30, userId: '1' },
  chat: { acao: 'naoLidas' },
};

test('rotas: `cookies` crus no corpo NÃO valem como sessão — 401, sem ir ao Waze', async () => {
  const s = await sessaoDeTeste(COOKIES);
  for (const [rota, extra] of Object.entries(ROTAS)) {
    const { r, chamadas } = await comWaze(naoPodiaIrAoWaze, () => dispatch(rota, { cookies: COOKIES, region: 'row', ...extra }, s.ctx));
    assert.equal(r.status, 401, `${rota}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    assert.equal(r.body.errorCategory, 'unauthorized', rota);
    assert.equal(chamadas.length, 0, `${rota} foi ao Waze com os cookies crus`);
  }
});

test('rotas: CONTROLE — com a sessão, as mesmas rotas vão ao Waze (o instrumento enxerga)', async () => {
  const s = await sessaoDeTeste(COOKIES);
  for (const rota of ['validar-place', 'marcar-lido', 'perfil']) {
    const { chamadas } = await comWaze(() => json({}), () => dispatch(rota, { ...s.dados, region: 'row', ...ROTAS[rota] }, s.ctx));
    assert.ok(chamadas.length > 0, `${rota} com sessão não chamou o Waze — o teste acima passaria por vácuo`);
  }
});

test('sessao destroy: token inventado não gasta o apagamento do KV (a cota curta)', async () => {
  const s = await sessaoDeTeste(COOKIES);
  let apagamentos = 0;
  const apagar = s.store.delete;
  s.store.delete = async (k) => { apagamentos++; return apagar(k); };
  for (const lixo of ['inventado', { x: 1 }, 42]) {
    const r = await dispatch('sessao', { action: 'destroy', sessionToken: lixo }, s.ctx);
    assert.equal(r.body.success, true, 'o "Sair" responde igual — quem saiu não precisa saber');
  }
  assert.equal(apagamentos, 0, 'apagou no KV por um token que não existe');
  await dispatch('sessao', { action: 'destroy', sessionToken: s.sessionToken }, s.ctx);
  assert.equal(apagamentos, 1, 'a sessão de verdade não foi apagada');
  assert.equal(await s.sessions.loadSession(s.sessionToken), null);
});

// O `/Session` com os campos do portão — tipos MEDIDOS nas duas contas do owner.
const SESSAO_WAZE = (campos) => ({ userName: 'fulano', areas: [], managedAreas: [], ...campos });

test('perfil: reconfere o portão — quem caiu abaixo de L2+AM perde a sessão', async () => {
  const casos = [
    [{ rank: 1, isAreaManager: true, isStaff: false }, true],    // L2+AM, a fronteira
    [{ rank: 0, isAreaManager: false, isStaff: true }, true],    // staff
    [{ rank: 0, isAreaManager: true, isStaff: false }, false],   // L1+AM
    [{ rank: 5, isAreaManager: false, isStaff: false }, false],  // L6 sem área
  ];
  for (const [campos, entra] of casos) {
    const s = await sessaoDeTeste(COOKIES);
    const { r } = await comWaze(() => json(SESSAO_WAZE(campos)), () => dispatch('perfil', { ...s.dados, region: 'row' }, s.ctx));
    const quem = JSON.stringify(campos);
    if (entra) {
      assert.equal(r.status, 200, quem);
      assert.equal(r.body.success, true, quem);
      assert.ok(await s.sessions.loadSession(s.sessionToken), `${quem}: a sessão de quem passa sumiu`);
    } else {
      assert.equal(r.status, 403, quem);
      assert.equal(r.body.errorCategory, 'access_denied', quem);
      assert.equal(r.body.profile.userName, 'fulano', 'o diálogo de acesso negado mostra o perfil');
      assert.equal(await s.sessions.loadSession(s.sessionToken), null, `${quem}: a sessão seguiu valendo`);
    }
  }
});

test('perfil: /Session SEM os campos do portão não derruba ninguém (mudança do Waze não desloga todo mundo)', async () => {
  for (const campos of [{}, { rank: '0', isAreaManager: true, isStaff: false }, { rank: 0, isAreaManager: null, isStaff: false }]) {
    const s = await sessaoDeTeste(COOKIES);
    const { r } = await comWaze(() => json(SESSAO_WAZE(campos)), () => dispatch('perfil', { ...s.dados, region: 'row' }, s.ctx));
    assert.equal(r.status, 200, JSON.stringify(campos));
    assert.ok(await s.sessions.loadSession(s.sessionToken));
  }
});

// ── o resto do servidor ─────────────────────────────────────────────────────

test('dispatch: nome herdado de Object.prototype não é rota', async () => {
  for (const nome of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    const r = await dispatch(nome, {}, {});
    assert.equal(r.status, 404, `/api/${nome} respondeu ${r.status}`);
  }
});

test('2xx: o texto do corpo não vira "já tratado" — só o errorList decide', () => {
  const c = (h, b) => categorizeWazeError(h, b).category;
  for (const nome of ['Duplicate Keys Ltd', 'Already Home', 'No Longer Bar', 'Updated By Another Café']) {
    assert.notEqual(c(200, JSON.stringify({ venues: { v1: { name: nome } } })), 'already_processed', nome);
  }
  // CONTROLE: o errorList vale em 2xx, e a pista de texto segue valendo em ERRO.
  assert.equal(c(200, JSON.stringify({ errorList: [{ code: 702, details: 'was not found' }] })), 'already_processed');
  assert.equal(c(400, 'this request was already handled'), 'already_processed');
});

test('renomear-local: nome com "Duplicate" grava e o app fica sabendo (não volta como "já tratado")', async () => {
  const s = await sessaoDeTeste(COOKIES);
  const nome = 'Duplicate Keys Ltd';
  const { r } = await comWaze(() => json({ status: 0, synced: true, venues: { v1: { name: nome } } }),
    () => dispatch('renomear-local', { ...s.dados, region: 'row', venueID: 'v1', nome }, s.ctx));
  assert.equal(r.body.success, true, JSON.stringify(r.body));
  assert.equal(r.body.nome, nome);
});

test('#HttpOnly_ (curl, extensões do Firefox): a sessão HttpOnly entra, não vira comentário', async () => {
  const arq = ['# Netscape HTTP Cookie File',
    NETSCAPE('.waze.com', '_csrf_token', 'csrf-abc'),
    NETSCAPE('.waze.com', '_web_session', 'sess-xyz', true),
    NETSCAPE('.google.com', 'SID', 'de-terceiro', true)].join('\n');
  const { cookieHeader, csrf } = prepareAuth(filterWazeCookies(arq));
  assert.match(cookieHeader, /(^|; )_web_session=sess-xyz(;|$)/, 'o _web_session HttpOnly ficou de fora');
  assert.equal(csrf, 'csrf-abc');
  assert.doesNotMatch(cookieHeader, /SID=/, 'cookie de terceiro vazou pro Waze');

  // Ponta a ponta pelo login: o Cookie que sai pro Waze leva a sessão.
  const s = await sessaoDeTeste(COOKIES);
  const { r, chamadas } = await comWaze(() => json(SESSAO_WAZE({ rank: 1, isAreaManager: true, isStaff: false })),
    () => dispatch('testar-cookies', { cookies: arq, region: 'row' }, s.ctx));
  assert.equal(r.body.success, true, JSON.stringify(r.body));
  assert.match(String(chamadas[0].init.headers.Cookie), /_web_session=sess-xyz/);
});

test('corpo `null` do Waze: resposta inválida, não "Erro interno"', async () => {
  for (const rota of ['perfil', 'lista-paises', 'lista-estados']) {
    const s = await sessaoDeTeste(COOKIES);
    const { r } = await comWaze(() => json('null'), () => dispatch(rota, { ...s.dados, region: 'row', countryId: 30 }, s.ctx));
    assert.equal(r.status, 500, rota);
    assert.equal(r.body.errorKey, 'srv.err.badWazeResponse', `${rota}: ${r.body.errorKey}`);
  }
  // A releitura do excluir-foto: `null` virava TypeError dentro do `relerLocal`.
  const s = await sessaoDeTeste(COOKIES);
  const { r, chamadas } = await comWaze(() => json('null'),
    () => dispatch('excluir-foto', { ...s.dados, region: 'row', venueID: 'v1', imageID: 'i1', lat: -23.5, lon: -46.6 }, s.ctx));
  assert.equal(r.body.errorKey, 'srv.err.badWazeResponse', `excluir-foto: ${r.body.errorKey}`);
  assert.ok(chamadas.every((c) => (c.init.method || 'GET') === 'GET'), 'escreveu no Waze sem ter lido o local');
});

test('releitura do excluir-foto: o prazo gravado no store respeita o mínimo do KV (60 s)', async () => {
  const s = await sessaoDeTeste(COOKIES);
  // Store fiel ao KV do Cloudflare: `expirationTtl` abaixo de 60 LANÇA.
  const prazos = [];
  const gravar = s.store.put;
  s.store.put = async (k, v, ttl) => {
    prazos.push(ttl);
    if (ttl !== undefined && ttl < 60) throw new Error(`Invalid expiration_ttl of ${ttl}. Expiration TTL must be at least 60.`);
    return gravar(k, v, ttl);
  };
  const venue = { id: 'v1', images: [{ id: 'i1', approved: true }, { id: 'i2', approved: true }] };
  await comWaze((url, init) => (init.method === 'POST' ? json({ status: 0 }) : json({ venues: { objects: [venue] } })),
    () => dispatch('excluir-foto', { ...s.dados, region: 'row', venueID: 'v1', imageID: 'i1', lat: -23.5, lon: -46.6, action: 'preparar' }, s.ctx));
  const doCache = prazos.filter((p) => p !== undefined && p < 3600);
  assert.ok(doCache.length > 0, 'a releitura não tentou gravar o cache — o teste não mediu nada');
  assert.ok(doCache.every((p) => p >= 60), `prazo abaixo do mínimo do KV: ${doCache}`);
});

test('VM: acento cortado na divisa entre dois pedaços do corpo chega inteiro', async () => {
  const texto = JSON.stringify({ nome: 'São João 🌽' });
  const bytes = Buffer.from(texto, 'utf8');
  // Corta DENTRO do "ã" (2 bytes em UTF-8) e dentro do emoji (4 bytes).
  const i = bytes.indexOf(Buffer.from('ã')) + 1;
  const j = bytes.indexOf(Buffer.from('🌽')) + 2;
  const req = new EventEmitter();
  req.destroy = () => {};
  const res = { headersSent: false, writeHead() {}, end() {} };
  const lido = readBody(req, res);
  req.emit('data', bytes.subarray(0, i));
  req.emit('data', bytes.subarray(i, j));
  req.emit('data', bytes.subarray(j));
  req.emit('end');
  assert.equal(await lido, texto);
});

// ── o que SAI do aparelho no login ──────────────────────────────────────────
// O cookies.txt das extensões é o navegador INTEIRO (medido no do owner: 4.370
// cookies de 362 domínios, 21 do waze.com). O servidor sempre filtrou na
// entrada, mas o chaveiro completo viajava até ele.
import { readFileSync } from 'node:fs';
const API_JS = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
function fatiarDoApi(nome) {
  const i = API_JS.search(new RegExp('^function ' + nome + '\\(', 'm'));
  assert.ok(i >= 0, `${nome} sumiu do api.js`);
  let prof = 0, fim = -1;
  for (let j = API_JS.indexOf('{', i); j < API_JS.length; j++) {
    if (API_JS[j] === '{') prof++;
    else if (API_JS[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  return new Function(API_JS.slice(i, fim) + `; return ${nome};`)();
}

test('login: só as linhas do Waze saem do aparelho (e o formato de cabeçalho vai como veio)', () => {
  const so = fatiarDoApi('soCookiesDoWaze');
  const arq = ['# Netscape HTTP Cookie File',
    NETSCAPE('.google.com', 'SID', 'de-terceiro'),
    NETSCAPE('.waze.com', '_csrf_token', 'csrf-abc'),
    NETSCAPE('.waze.com', '_web_session', 'sess-xyz', true),
    NETSCAPE('www.waze.com', 'outro', 'v'),
    NETSCAPE('github.com', 'user_session', 'de-terceiro', true),
    NETSCAPE('evilwaze.com', 'x', 'de-terceiro'),
    NETSCAPE('waze.com.br', 'y', 'de-terceiro')].join('\n');
  const saiu = so(arq);
  assert.doesNotMatch(saiu, /de-terceiro/, 'cookie de outro site saiu do aparelho');
  assert.match(saiu, /_csrf_token\tcsrf-abc/);
  assert.match(saiu, /^#HttpOnly_\.waze\.com\t.*_web_session\tsess-xyz$/m, 'a sessão HttpOnly ficou pra trás');
  assert.match(saiu, /www\.waze\.com\t.*outro/);
  // Formato de cabeçalho (o que a extensão do Chrome manda): sem domínio pra filtrar.
  assert.equal(so('_csrf_token=a; _web_session=b'), '_csrf_token=a; _web_session=b');
  // E o servidor aceita o que sobrou, como aceitava o arquivo inteiro.
  const { cookieHeader, csrf } = prepareAuth(filterWazeCookies(saiu));
  assert.equal(csrf, 'csrf-abc');
  assert.match(cookieHeader, /_web_session=sess-xyz/);
});

test('login: o testar-cookies manda o arquivo FILTRADO, e sem linha do Waze nem sai', async () => {
  // O `testCookies` do API chama o `soCookiesDoWaze`; o guard é de fonte porque
  // o objeto API não se instancia fora do navegador.
  const corpo = /async testCookies\([^)]*\) \{([\s\S]*?)\n    \},/.exec(API_JS);
  assert.ok(corpo, 'testCookies sumiu do api.js');
  assert.match(corpo[1], /const soDoWaze = soCookiesDoWaze\(cookies\);/);
  assert.match(corpo[1], /cookies: soDoWaze,/, 'o testar-cookies voltou a mandar o arquivo inteiro');
  assert.match(corpo[1], /if \(!soDoWaze\.trim\(\)\) \{\s*return \{ success: false, errorKey: 'srv\.err\.cookieFormatExport'/);
});

// ── a América do Norte ──────────────────────────────────────────────────────
// `na-Descartes` NÃO EXISTE: MEDIDO em 2026-09-25, `Session`, `info/config`,
// `LocationSearch/Countries` e `Issues/Search/List` dão 404 lá e 200 em
// `/Descartes/` (a fila dos EUA com 512 pedidos). Todo editor dos EUA e do
// Canadá que escolhia "NA" ficava sem app.
test('região NA: toda chamada vai pro servidor SEM prefixo (`/Descartes/`), e `world` é a mesma coisa', async () => {
  for (const region of ['na', 'world', 'NA']) {
    const s = await sessaoDeTeste(COOKIES);
    const rotas = [['buscar-places', { countryId: 235 }], ['perfil', {}], ['lista-paises', {}], ['marcar-lido', { venueID: 'v1', updateRequestID: 'u1' }]];
    for (const [rota, extra] of rotas) {
      const { chamadas } = await comWaze(() => json({}), () => dispatch(rota, { ...s.dados, region, ...extra }, s.ctx));
      assert.ok(chamadas.length > 0, `${rota} não chamou o Waze`);
      for (const c of chamadas) {
        assert.match(c.url, /^https:\/\/www\.waze\.com\/Descartes\//, `${region} ${rota}: ${c.url}`);
      }
    }
  }
  // CONTROLE: as outras regiões seguem com prefixo.
  const s = await sessaoDeTeste(COOKIES);
  for (const [region, prefixo] of [['row', 'row-Descartes'], ['il', 'il-Descartes'], ['xx', 'row-Descartes']]) {
    const { chamadas } = await comWaze(() => json({}), () => dispatch('perfil', { ...s.dados, region }, s.ctx));
    assert.ok(chamadas[0].url.startsWith(`https://www.waze.com/${prefixo}/`), `${region}: ${chamadas[0].url}`);
  }
});

test('excluir-foto: foto PENDENTE (a de um pedido) não sai pela lixeira — só a aprovada', async () => {
  const s = await sessaoDeTeste(COOKIES);
  const venue = { id: 'v1', images: [{ id: 'aprovada', approved: true }, { id: 'pendente', approved: false }] };
  const responder = (url, init) => (init.method === 'POST' ? json({ status: 0 }) : json({ venues: { objects: [venue] } }));
  const pend = await comWaze(responder, () => dispatch('excluir-foto', { ...s.dados, region: 'row', venueID: 'v1', imageID: 'pendente', lat: -23.5, lon: -46.6 }, s.ctx));
  assert.equal(pend.r.status, 400);
  assert.equal(pend.r.body.errorKey, 'srv.err.photoNotApproved');
  assert.ok(pend.chamadas.every((c) => (c.init.method || 'GET') === 'GET'), 'escreveu a lista sem a foto pendente');
  // CONTROLE: a aprovada sai (a escrita acontece).
  const s2 = await sessaoDeTeste(COOKIES);
  const apr = await comWaze(responder, () => dispatch('excluir-foto', { ...s2.dados, region: 'row', venueID: 'v1', imageID: 'aprovada', lat: -23.5, lon: -46.6 }, s2.ctx));
  assert.ok(apr.chamadas.some((c) => c.init.method === 'POST'), 'a foto aprovada não foi excluída — o teste não distingue');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Auditoria de 2026-09-26 (lote 5). Mesma regra do topo: cada teste daqui foi
//  visto REPROVANDO com o conserto desfeito.
// ═══════════════════════════════════════════════════════════════════════════

test('parear cancel: código que não existe não gasta o apagamento do KV (a cota curta)', async () => {
  // Mesmo defeito que o `sessao destroy` já teve: a rota não pede sessão, e
  // cada POST com um código qualquer gastava um apagamento do KV (1.000/dia no
  // plano grátis). Com a cota no fim, o "Sair" e o resgate de verdade param.
  const s = await sessaoDeTeste(COOKIES);
  let apagamentos = 0;
  const apagar = s.store.delete;
  s.store.delete = async (k) => { apagamentos++; return apagar(k); };
  // Os dois tamanhos válidos (6 e 20 símbolos do alfabeto), o digitado com
  // hífen e lixo de toda forma.
  for (const code of ['ABC234', 'ABCDEFGHJKLMNPQRSTUV', 'abc-234', 'x', null, { a: 1 }]) {
    const r = await dispatch('parear', { action: 'cancel', code }, s.ctx);
    assert.equal(r.body.success, true, 'o cancelar responde igual — quem saiu não precisa saber');
  }
  assert.equal(apagamentos, 0, 'apagou no KV por um código que não existe');
  // CONTROLE: o código emitido de verdade é apagado, e o resgate depois falha.
  const criado = await dispatch('parear', { action: 'create', ...s.dados }, s.ctx);
  assert.equal(criado.status, 200);
  await dispatch('parear', { action: 'cancel', code: criado.body.code }, s.ctx);
  assert.equal(apagamentos, 1, 'o código emitido não foi apagado — o instrumento não enxerga o apagamento');
  const resgate = await dispatch('parear', { action: 'claim', code: criado.body.code }, s.ctx);
  assert.equal(resgate.body.errorKey, 'srv.err.pairCodeInvalid', 'o código cancelado ainda entrou');
});

// Sessão gravada há 2 h: passa da trava de 1 h do `refreshCookies`, então uma
// regravação indevida ACONTECE (sem isto o teste passaria por causa da trava).
function envelhecerSessoes(store, segundos = 7200) {
  const antes = Math.floor(Date.now() / 1000) - segundos;
  for (const [k, v] of store.mem) store.mem.set(k, antes + v.slice(v.indexOf('|')));
}
// Resposta do Waze com o cookie de sessão ROTACIONADO (gotcha #43).
const comRotacao = (corpo, valor) => {
  const h = new Headers({ 'content-type': 'application/json' });
  h.append('set-cookie', `_web_session=${valor}; path=/; secure; HttpOnly`);
  return new Response(JSON.stringify(corpo), { status: 200, headers: h });
};

test('testar-cookies: um sessionToken no corpo NÃO deixa o login regravar aquela sessão', async () => {
  // O ataque: um token de sessão L6 liberada + o cookies.txt de uma conta L1
  // sem área. O portão recusa a L1 — mas a regravação do cookie rotacionado
  // trocava os cookies da sessão L6 pelos da L1, e o token passava a agir como
  // ela, sem nunca ter passado pelo portão.
  const COOKIES_A = [NETSCAPE('.waze.com', '_csrf_token', 'csrf-A'), NETSCAPE('.waze.com', '_web_session', 'sessao-da-conta-A')].join('\n');
  const COOKIES_B = [NETSCAPE('.waze.com', '_csrf_token', 'csrf-B'), NETSCAPE('.waze.com', '_web_session', 'sessao-da-conta-B')].join('\n');
  for (const [perfilB, esperado] of [
    [{ userName: 'conta-b', rank: 0, isAreaManager: false, isStaff: false }, 403],   // o portão recusa
    [{ userName: 'conta-b', rank: 1, isAreaManager: true, isStaff: false }, 200],    // o portão aceita: sessão NOVA
  ]) {
    const s = await sessaoDeTeste(COOKIES_A);
    envelhecerSessoes(s.store);
    const { r } = await comWaze(() => comRotacao(perfilB, 'sessao-B-rotacionada'),
      () => dispatch('testar-cookies', { cookies: COOKIES_B, region: 'row', sessionToken: s.sessionToken }, s.ctx));
    assert.equal(r.status, esperado, JSON.stringify(r.body).slice(0, 120));
    const guardada = await s.sessions.loadSession(s.sessionToken);
    assert.match(guardada, /sessao-da-conta-A/, `a sessão A perdeu os próprios cookies (portão ${esperado})`);
    assert.doesNotMatch(guardada, /csrf-B|conta-B|B-rotacionada/, `a sessão A passou a guardar a conta B (portão ${esperado})`);
    if (esperado === 200) assert.notEqual(r.body.sessionToken, s.sessionToken, 'o login devolveu a sessão A em vez de criar a dele');
  }
  // CONTROLE: a MESMA rotação numa AÇÃO com o token A regrava a sessão A — o
  // instrumento enxerga a regravação, e a trava de 1 h não está escondendo nada.
  const s = await sessaoDeTeste(COOKIES_A);
  envelhecerSessoes(s.store);
  await comWaze(() => comRotacao({}, 'sessao-A-rotacionada'),
    () => dispatch('marcar-lido', { ...s.dados, region: 'row', venueID: 'v1', updateRequestID: 'u1' }, s.ctx));
  assert.match(await s.sessions.loadSession(s.sessionToken), /sessao-A-rotacionada/,
    'CONTROLE: a ação não regravou o cookie rotacionado — o teste acima passaria por vácuo');
});

// O "Waze" de um local só, com a lista de fotos mudando no tempo — a leitura
// por bbox devolve a lista ATUAL e a escrita a SUBSTITUI inteira (gotcha #57).
function wazeDeUmLocal(V, fotos) {
  const w = { fotos, leituras: 0, escritas: [] };
  w.responder = (url, init) => {
    if ((init.method || 'GET') === 'GET') { w.leituras++; return json({ venues: { objects: [{ id: V, images: w.fotos }] } }); }
    const sub = JSON.parse(init.body).actions._subActions[0];
    if (sub.name === 'UPDATE_PLACE_UPDATE') {   // aprovar: a pendente vira aprovada
      const id = sub._subActions[0].attributes.id;
      w.fotos = w.fotos.map((f) => (f.id === id ? { ...f, approved: true } : f));
      return json({});
    }
    w.fotos = sub.attributes.images;
    w.escritas.push(w.fotos);
    return json({ status: 0, synced: true, venues: { [V]: { id: V, images: w.fotos } } });
  };
  return w;
}

test('excluir-foto: exclusões em série não empurram o prazo da releitura — a foto nova de outro editor fica', async () => {
  // A regravação do cache depois de excluir usava a hora da ESCRITA: cada
  // exclusão renovava o prazo de uma lista que não ficou mais nova, e a
  // leitura dos 0 s servia a exclusão dos 20 s (o prazo é de 15).
  const s = await sessaoDeTeste(COOKIES);
  const w = wazeDeUmLocal('v1', [{ id: 'A', approved: true }, { id: 'B', approved: true }, { id: 'C', approved: true }]);
  const excluir = (imageID, extra = {}) =>
    dispatch('excluir-foto', { ...s.dados, region: 'row', venueID: 'v1', imageID, lat: -23.5, lon: -46.6, ...extra }, s.ctx);
  const relogio = Date.now;
  let agora = relogio();
  Date.now = () => agora;
  try {
    await comWaze(w.responder, async () => {
      await excluir('A', { action: 'preparar' });   //  0 s: toca na lixeira → LÊ
      agora += 10_000; await excluir('A');          // 10 s: confirma, com a leitura dos 0 s (dentro dos 15)
      agora += 6_000;                               // 16 s: OUTRO editor sobe a foto D
      w.fotos = [...w.fotos, { id: 'D', approved: true }];
      await excluir('B', { action: 'preparar' });   // 16 s: toca na lixeira de novo
      agora += 4_000; await excluir('B');           // 20 s: confirma
    });
  } finally {
    Date.now = relogio;
  }
  const ids = (l) => l.map((i) => i.id);
  assert.ok(w.fotos.some((i) => i.id === 'D'),
    `a foto que outro editor subiu aos 16 s foi APAGADA — escritas: ${JSON.stringify(w.escritas.map(ids))}`);
  assert.equal(w.leituras, 2, 'a leitura dos 0 s serviu além do prazo (ou o cache parou de servir dentro dele)');
  assert.deepEqual(w.escritas.map(ids), [['B', 'C'], ['C', 'D']]);
});

test('validar-place: aprovar a foto esquece a releitura guardada — a exclusão seguinte relê', async () => {
  // Tocou na lixeira de uma foto (a releitura fica guardada), desistiu,
  // aprovou a pendente e, segundos depois, foi excluir: a releitura ainda via a
  // aprovada como PENDENTE.
  for (const [alvo, esperado] of [
    ['NOVA', [{ id: 'VELHA', approved: true }]],    // era "só foto aprovada pode ser excluída"
    ['VELHA', [{ id: 'NOVA', approved: true }]],    // gravava de volta o `approved: false` velho
  ]) {
    const s = await sessaoDeTeste(COOKIES);
    const w = wazeDeUmLocal('v1', [{ id: 'VELHA', approved: true }, { id: 'NOVA', approved: false }]);
    const base = { ...s.dados, region: 'row', venueID: 'v1', lat: -23.5, lon: -46.6 };
    const { r } = await comWaze(w.responder, async () => {
      await dispatch('excluir-foto', { ...base, imageID: 'VELHA', action: 'preparar' }, s.ctx);
      const ap = await dispatch('validar-place', { ...s.dados, region: 'row', venueID: 'v1', updateRequestID: 'NOVA', approve: true }, s.ctx);
      assert.equal(ap.body.action, 'approved', 'pré-condição: a aprovação passou');
      return dispatch('excluir-foto', { ...base, imageID: alvo }, s.ctx);
    });
    assert.equal(r.body.success, true, `excluir ${alvo} depois de aprovar: ${r.body.errorKey || JSON.stringify(r.body)}`);
    assert.deepEqual(w.escritas, [esperado], `excluir ${alvo}: gravou uma lista velha`);
  }
});

test('validar-place: rejeitar NÃO toca na releitura guardada (é o gesto de todo swipe; a cota do KV é contada)', async () => {
  const s = await sessaoDeTeste(COOKIES);
  const lidas = [];
  const ler = s.store.get;
  s.store.get = async (k) => { lidas.push(k); return ler(k); };
  const w = wazeDeUmLocal('v1', []);
  await comWaze(w.responder, () => dispatch('validar-place', { ...s.dados, region: 'row', venueID: 'v1', updateRequestID: 'u1' }, s.ctx));
  assert.equal(lidas.filter((k) => String(k).startsWith('reler_')).length, 0, 'rejeitar leu a releitura do KV');
  // CONTROLE: aprovar lê (o instrumento enxerga a leitura).
  await comWaze(w.responder, () => dispatch('validar-place', { ...s.dados, region: 'row', venueID: 'v1', updateRequestID: 'u1', approve: true }, s.ctx));
  assert.equal(lidas.filter((k) => String(k).startsWith('reler_')).length, 1, 'CONTROLE: aprovar não consultou a releitura');
});

import { cabecalhoParaNetscape } from '../server/core.mjs';

test('login com cookies em formato de CABEÇALHO: a sessão acompanha a rotação do cookie (gotcha #43)', async () => {
  // O `testar-cookies` aceita `a=b; c=d`, mas a regravação do cookie
  // rotacionado só entende linha Netscape: guardada como cabeçalho, a sessão
  // nunca acompanhava o `_web_session` novo e azedava em dias.
  const s = await sessaoDeTeste(COOKIES);
  const perfil = { userName: 'fulano', rank: 1, isAreaManager: true, isStaff: false };
  const login = await comWaze(() => json(perfil),
    () => dispatch('testar-cookies', { cookies: '_csrf_token=csrf-C; _web_session=ORIGINAL', region: 'row' }, s.ctx));
  assert.equal(login.r.status, 200, JSON.stringify(login.r.body));
  // O fio pro Waze não muda: o mesmo cabeçalho e o mesmo CSRF de antes.
  assert.equal(login.chamadas[0].init.headers.Cookie, '_csrf_token=csrf-C; _web_session=ORIGINAL');
  assert.equal(login.chamadas[0].init.headers['X-CSRF-Token'], 'csrf-C');
  const token = login.r.body.sessionToken;
  envelhecerSessoes(s.store);
  const acao = await comWaze(() => comRotacao({}, 'ROTACIONADO'),
    () => dispatch('marcar-lido', { sessionToken: token, region: 'row', venueID: 'v1', updateRequestID: 'u1' }, s.ctx));
  assert.equal(acao.chamadas[0].init.headers.Cookie, '_csrf_token=csrf-C; _web_session=ORIGINAL',
    'a sessão guardada mudou o cookie que vai pro Waze');
  assert.match(await s.sessions.loadSession(token), /ROTACIONADO/,
    'a sessão de quem entrou com o cabeçalho não acompanhou a rotação — azeda em dias');
  // E a chamada seguinte já sai com o valor novo.
  const depois = await comWaze(() => json({}),
    () => dispatch('marcar-lido', { sessionToken: token, region: 'row', venueID: 'v1', updateRequestID: 'u2' }, s.ctx));
  assert.equal(depois.chamadas[0].init.headers.Cookie, '_csrf_token=csrf-C; _web_session=ROTACIONADO');
});

test('cabeçalho que não dá pra converter sem perda segue aceito como veio (o login não falha pelo parser)', async () => {
  for (const cab of [
    '_csrf_token=c; _web_session=a; _web_session=b',   // nome repetido: o navegador manda os dois
    '_csrf_token=c; _web_session=; x=1',               // valor vazio: a linha Netscape seria descartada
    '_csrf_token=c; _web_session=a b',                 // espaço no valor: o Netscape é lido por /\s+/
    '_csrf_token=c; solto',                            // par sem `=`
  ]) {
    assert.equal(cabecalhoParaNetscape(cab), cab, cab);
    const s = await sessaoDeTeste(COOKIES);
    const { r, chamadas } = await comWaze(() => json({ userName: 'fulano', rank: 1, isAreaManager: true, isStaff: false }),
      () => dispatch('testar-cookies', { cookies: cab, region: 'row' }, s.ctx));
    assert.equal(r.status, 200, `${cab}: ${JSON.stringify(r.body)}`);
    assert.equal(chamadas[0].init.headers.Cookie, cab, 'o cabeçalho que vai pro Waze mudou');
  }
  // CONTROLE: o caso comum converte (sem isto as asserções acima passariam
  // com um conversor que nunca converte), e o Netscape passa intocado.
  assert.equal(cabecalhoParaNetscape('_csrf_token=c;_web_session=s\nx=1'),
    ['_csrf_token\tc', '_web_session\ts', 'x\t1'].map((f) => '.waze.com\tTRUE\t/\tTRUE\t0\t' + f).join('\n'));
  assert.equal(cabecalhoParaNetscape(COOKIES), COOKIES);
});

import { DUPLICADO_ESPERA_MS } from '../server/core.mjs';

// Um pedido DUPLICATE: a busca faz uma releitura por bbox pra achar o NOME do
// local apontado (ver `resolverDuplicados`).
const DUP_ORIGEM = '205391388.2053651740.4527272';
const DUP_ALVO = '205391388.2053651740.12920425';
const BUSCA_COM_DUPLICADO = { users: { objects: [] }, venues: { objects: [{
  id: DUP_ORIGEM, name: 'Estacionamento', permissions: -1, images: [],
  geometry: { type: 'Point', coordinates: [-46.6, -23.5] },
  venueUpdateRequests: [{ id: 'ur-dup', type: 'REQUEST', subType: 'FLAG', flagType: 'DUPLICATE',
    flagSubjectType: 'VENUE', flagEntityID: DUP_ALVO, isRead: false }],
}] }, mapIssues: { venueUpdateRequests: { hasMore: false } } };
const RELEITURA_DO_ALVO = { venues: { objects: [{ id: DUP_ALVO, name: 'Natan Estacionamento',
  geometry: { type: 'Point', coordinates: [-46.6, -23.49914] } }] } };

test('buscar-places: a releitura do duplicado tem TETO próprio — presa, a busca sai sem o nome', { timeout: 60_000 }, async () => {
  // Sem teto próprio, a leitura acessória herdava os 30 s do `callWaze`, e
  // busca lenta + releitura presa passavam dos 45 s em que o cliente desiste.
  const s = await sessaoDeTeste(COOKIES);
  // A releitura fica PRESA até o teste soltar — ou até o `callWaze` abortar
  // (sem obedecer ao aborto, o teste sem o conserto nunca terminaria).
  const soltar = [];
  const t0 = Date.now();
  const { r, chamadas } = await comWaze((url, init) => {
    if (/Issues\/Search\/List/.test(url)) return json(BUSCA_COM_DUPLICADO);
    return new Promise((ok, erro) => {
      soltar.push(() => ok(json(RELEITURA_DO_ALVO)));
      init.signal?.addEventListener('abort', () => erro(new Error('abortado')));
    });
  }, () => dispatch('buscar-places', { ...s.dados, region: 'row' }, s.ctx));
  const levou = Date.now() - t0;
  // Retrato ANTES de soltar: a leitura solta ainda escreveria no objeto.
  const duplicado = r.body.places?.[0]?.duplicado;
  soltar.forEach((f) => f());           // senão o processo espera os 30 s dela
  assert.ok(chamadas.some((c) => /\/Features/.test(c.url)), 'pré-condição: a busca tentou a releitura');
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 120));
  assert.equal(r.body.places.length, 1);
  assert.equal(duplicado, undefined, 'inventou o nome de uma releitura que não voltou');
  assert.ok(levou < DUPLICADO_ESPERA_MS + 2000,
    `a busca esperou a releitura acessória por ${levou} ms (teto: ${DUPLICADO_ESPERA_MS} ms)`);

  // CONTROLE: releitura que volta a tempo traz o nome — o teto não corta o caminho normal.
  const s2 = await sessaoDeTeste(COOKIES);
  const rapida = await comWaze((url) => json(/Issues\/Search\/List/.test(url) ? BUSCA_COM_DUPLICADO : RELEITURA_DO_ALVO),
    () => dispatch('buscar-places', { ...s2.dados, region: 'row' }, s2.ctx));
  assert.equal(rapida.r.body.places[0].duplicado?.nome, 'Natan Estacionamento', 'CONTROLE: o nome do duplicado não chegou');
});

test('o teto do duplicado cabe no prazo do cliente: busca (teto do callWaze) + releitura < 45 s do `_post`', () => {
  // A justificativa do número, conferida nas FONTES: se alguém subir o teto do
  // duplicado (ou encurtar o do cliente), a busca volta a se perder pelo enfeite.
  const core = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');
  const tetoBusca = /async function callWaze\(url[\s\S]*?controller\.abort\(\), (\d+)\)/.exec(core);
  const tetoCliente = /async _post\([\s\S]*?controller\.abort\(\), (\d+)\)/.exec(API_JS);
  assert.ok(tetoBusca && tetoCliente, 'não achei os tetos nas fontes — o instrumento quebrou, não a regra');
  const soma = Number(tetoBusca[1]) + DUPLICADO_ESPERA_MS;
  assert.ok(soma < Number(tetoCliente[1]),
    `busca (${tetoBusca[1]} ms) + releitura (${DUPLICADO_ESPERA_MS} ms) = ${soma} ms não cabe nos ${tetoCliente[1]} ms do cliente`);
});

test('ids: objeto, lista ou texto enorme não vão ao Waze em NENHUMA rota de escrita — o mesmo 400 de id ausente', async () => {
  // O `idValido` nascia só no LOTE do marcar-lido; o marcar-lido de um item,
  // o validar-place, o guardar-pedido, o renomear-local e o excluir-foto
  // mandavam um objeto ou um texto de 200 KB pro Waze como veio.
  const s = await sessaoDeTeste(COOKIES);
  // [rota, corpo com `id` no campo testado, a chave do 400 que a rota já dá pra id AUSENTE]
  const casos = (id) => [
    ['marcar-lido', { venueID: id, updateRequestID: 'u1' }, 'srv.err.incompleteData'],
    ['marcar-lido', { venueID: 'v1', updateRequestID: id }, 'srv.err.incompleteData'],
    ['validar-place', { venueID: id, updateRequestID: 'u1' }, 'srv.err.incompleteParams'],
    ['validar-place', { venueID: 'v1', updateRequestID: id }, 'srv.err.incompleteParams'],
    ['guardar-pedido', { venueID: id, updateRequestID: 'u1', value: true }, 'srv.err.incompleteParams'],
    ['guardar-pedido', { venueID: 'v1', updateRequestID: id, value: true }, 'srv.err.incompleteParams'],
    ['renomear-local', { venueID: id, nome: 'Padaria' }, 'srv.err.incompleteParams'],
    ['excluir-foto', { venueID: id, imageID: 'i1', lat: -23.5, lon: -46.6 }, 'srv.err.incompleteParams'],
    ['excluir-foto', { venueID: 'v1', imageID: id, lat: -23.5, lon: -46.6 }, 'srv.err.incompleteParams'],
  ];
  for (const lixo of [{ $objeto: [1, 2, 3] }, ['v1'], 'X'.repeat(200_000), '', true]) {
    for (const [rota, corpo, chave] of casos(lixo)) {
      const { r, chamadas } = await comWaze(naoPodiaIrAoWaze, () => dispatch(rota, { ...s.dados, region: 'row', ...corpo }, s.ctx));
      const quem = `${rota} ${JSON.stringify(corpo).slice(0, 70)}`;
      assert.equal(chamadas.length, 0, `${quem}: foi ao Waze`);
      assert.equal(r.status, 400, quem);
      assert.equal(r.body.errorKey, chave, quem);
    }
  }
  // CONTROLE: id de verdade — texto (o formato medido) e número — vai ao Waze
  // em todas elas; sem isto, uma rota que recusasse TUDO passaria acima.
  for (const bom of ['206439966.2064334125.43319751', 43319751]) {
    for (const [rota, corpo] of casos(bom)) {
      const { chamadas } = await comWaze(() => json({}), () => dispatch(rota, { ...s.dados, region: 'row', ...corpo }, s.ctx));
      assert.ok(chamadas.length > 0, `CONTROLE: ${rota} ${JSON.stringify(corpo).slice(0, 70)} não foi ao Waze`);
    }
  }
});
