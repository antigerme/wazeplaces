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
    // O mesmo "erro inesperado do Waze" do login, com a categoria (o app lia a
    // falta dela como `unknown`; agora vem dita).
    assert.equal(r.body.errorCategory, 'unknown', `${rota}: ${r.body.errorCategory}`);
  }
  // A releitura do excluir-foto: `null` virava TypeError dentro do `relerLocal`.
  const s = await sessaoDeTeste(COOKIES);
  const { r, chamadas } = await comWaze(() => json('null'),
    () => dispatch('excluir-foto', { ...s.dados, region: 'row', venueID: 'v1', imageID: 'i1', lat: -23.5, lon: -46.6 }, s.ctx));
  assert.equal(r.body.errorKey, 'srv.err.badWazeResponse', `excluir-foto: ${r.body.errorKey}`);
  assert.equal(r.body.errorCategory, 'unknown', `excluir-foto: ${r.body.errorCategory}`);
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
  const corpo = { ...s.dados, region: 'row', venueID: 'v1', lat: -23.5, lon: -46.6 };
  // As TRÊS gravações da lista: a do toque (na chave do toque, R13-3-03) e, numa
  // exclusão sem ela, a lista relida e a regravação depois da escrita.
  await comWaze((url, init) => (init.method === 'POST' ? json({ status: 0 }) : json({ venues: { objects: [venue] } })), async () => {
    await dispatch('excluir-foto', { ...corpo, imageID: 'preparar', action: 'preparar', aquecimento: 'gesto-prazo-01' }, s.ctx);
    const r = await dispatch('excluir-foto', { ...corpo, imageID: 'i1' }, s.ctx);
    assert.equal(r.body.success, true, JSON.stringify(r.body));
  });
  const doCache = prazos.filter((p) => p !== undefined && p < 3600);
  assert.ok(doCache.length >= 3, `a releitura não tentou gravar as três listas — o teste não mediu tudo: ${doCache}`);
  assert.ok(doCache.every((p) => p >= 60), `prazo abaixo do mínimo do KV: ${doCache}`);
  // A lista do toque tem o prefixo da releitura: é por ele que a VM a varre
  // (`sess_reler_…`, test/vm-gc).
  assert.ok([...s.store.mem.keys()].some((k) => String(k).startsWith('reler_toque_')),
    'a lista do toque não foi gravada com o prefixo da releitura — a varredura da VM não a reconheceria');
});

// A Ajuda (`help.privacy.server`) promete que a lista de fotos da lixeira sai do
// servidor até N minuto depois da ÚLTIMA vez que a pessoa toca na lixeira ou
// exclui uma foto. Medido como o KV mede: o registro some `ttl` segundos depois
// da ÚLTIMA gravação dele. A frase contava do toque, e a lista ficava 74 s
// (auditoria de 2026-09-29): ela é regravada depois da exclusão — de propósito,
// pra a exclusão seguinte não mandar de volta a foto que saiu (gotcha #57).
// Desde a rodada 13 (R13-3-03) a lista do TOQUE mora numa chave própria, e a
// exclusão do mesmo gesto que a usa não grava nada; a que relê (sem a lista do
// toque) grava e regrava, como antes. Os dois caminhos cabem na frase.
test('a lista de fotos da lixeira some até o prazo da Ajuda depois da ÚLTIMA gravação — do toque, ou da exclusão', async () => {
  const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const prometido = 60 * Number((/^const LISTA_FOTOS_MIN_EXIBIDO = (\d+);/m.exec(APP) || [])[1]);
  assert.ok(prometido > 0, 'CONTROLE: não achei o prazo que a Ajuda cita');
  let agora = 1_790_000_000;
  const relogio = Date.now;
  Date.now = () => agora * 1000;
  try {
    const GESTO = 'gesto-ajuda-01';
    // `comOToque`: a exclusão leva o gesto do toque (usa a lista dele); sem ele,
    // ela relê o local e regrava a lista.
    const cenario = async ({ excluir, comOToque = true }) => {
      const s = await sessaoDeTeste(COOKIES);
      const some = [];   // o instante em que o KV apagaria o registro, a cada gravação
      const gravar = s.store.put;
      s.store.put = async (k, v, ttl) => { if (String(k).startsWith('reler_')) some.push(agora + ttl); return gravar(k, v, ttl); };
      const venue = { id: 'v1', images: [{ id: 'i1', approved: true }, { id: 'i2', approved: true }] };
      const corpo = { ...s.dados, region: 'row', venueID: 'v1', lat: -23.5, lon: -46.6 };
      const toque = agora;
      let fimDaExclusao = null;
      await comWaze((url, init) => {
        if (init.method !== 'POST') return json({ venues: { objects: [venue] } });
        agora += 5;   // o Waze leva 5 s pra gravar
        return json({ venues: { v1: { images: [{ id: 'i2' }] } } });
      }, async () => {
        await dispatch('excluir-foto', { ...corpo, imageID: 'preparar', action: 'preparar', aquecimento: GESTO }, s.ctx);
        if (!excluir) return;
        agora += 14;   // leu o diálogo e confirmou (a lista guardada ainda vale)
        const r = await dispatch('excluir-foto', { ...corpo, imageID: 'i1', ...(comOToque ? { aquecimento: GESTO } : {}) }, s.ctx);
        assert.equal(r.body.success, true, JSON.stringify(r.body));
        fimDaExclusao = agora;
      });
      assert.ok(some.length > 0, 'CONTROLE: a lista não foi gravada — o teste não mediu nada');
      return { toque, fimDaExclusao, sumiu: some.at(-1) };
    };
    const desistiu = await cenario({ excluir: false });
    assert.ok(desistiu.sumiu - desistiu.toque <= prometido,
      `tocou e desistiu: a lista ficou ${desistiu.sumiu - desistiu.toque} s depois do toque (a Ajuda diz ${prometido} s)`);
    const excluiu = await cenario({ excluir: true });
    assert.ok(excluiu.sumiu - excluiu.fimDaExclusao <= prometido,
      `excluiu: a lista ficou ${excluiu.sumiu - excluiu.fimDaExclusao} s depois da exclusão (a Ajuda diz ${prometido} s)`);
    const releu = await cenario({ excluir: true, comOToque: false });
    assert.ok(releu.sumiu - releu.fimDaExclusao <= prometido,
      `excluiu relendo o local: a lista ficou ${releu.sumiu - releu.fimDaExclusao} s depois da exclusão (a Ajuda diz ${prometido} s)`);
    // CONTROLE: contado do TOQUE, o prazo passa quando a exclusão regrava — é por
    // isso que a frase conta da última exclusão. Se isto falhar, a regravação
    // mudou, e a frase também deve.
    assert.ok(releu.sumiu - releu.toque > prometido,
      `CONTROLE: a lista sumiu ${releu.sumiu - releu.toque} s depois do toque — a regravação depois da exclusão sumiu?`);
  } finally {
    Date.now = relogio;
  }
});

// Um corpo que começa com BOM: o Worker o lê (o `TextDecoder` tira o BOM, como
// o `request.json()` tirava), e a VM, pelo `Buffer#toString`, o deixava — o
// `JSON.parse` falhava e o mesmo POST dava 200 lá e 400 aqui (o comparador VM ×
// Worker da auditoria de 2026-09-29).
test('VM: corpo com BOM no começo é lido, como no Worker', async () => {
  const texto = JSON.stringify({ action: 'destroy', sessionToken: 'x' });
  const req = new EventEmitter();
  req.destroy = () => {};
  const res = { headersSent: false, writeHead() {}, end() {} };
  const lido = readBody(req, res);
  req.emit('data', Buffer.from([0xef, 0xbb, 0xbf]));
  req.emit('data', Buffer.from(texto));
  req.emit('end');
  const corpo = await lido;
  assert.deepEqual(JSON.parse(corpo), { action: 'destroy', sessionToken: 'x' }, `a VM não leu o corpo com BOM: ${JSON.stringify(corpo)}`);
  // CONTROLE: o Worker de verdade lê o mesmo corpo.
  const { default: worker } = await import('../worker/index.mjs');
  const env = { ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SESSIONS: { get: async () => null, put: async () => {}, delete: async () => {} }, ASSETS: { fetch: () => new Response('') } };
  const r = await worker.fetch(new Request('https://app.exemplo/api/sessao', { method: 'POST',
    body: new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(texto)]) }), env, {});
  assert.equal(r.status, 200, 'CONTROLE: o Worker não leu o corpo com BOM');
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
  // `comToque`: cada exclusão com o toque do gesto dela (o app de hoje: a lista
  // do toque, na chave do toque, serve a exclusão daquele gesto — R13-3-03); sem
  // ele, cada exclusão relê o local e REGRAVA a lista na chave da releitura, e é
  // ali que a hora da regravação importa. A escrita do Waze leva 10 s: a hora da
  // escrita e a da leitura não coincidem.
  const ids = (l) => l.map((i) => i.id);
  for (const comToque of [true, false]) {
    const s = await sessaoDeTeste(COOKIES);
    const w = wazeDeUmLocal('v1', [{ id: 'A', approved: true }, { id: 'B', approved: true }, { id: 'C', approved: true }]);
    const excluir = (imageID, extra = {}) =>
      dispatch('excluir-foto', { ...s.dados, region: 'row', venueID: 'v1', imageID, lat: -23.5, lon: -46.6, ...extra }, s.ctx);
    const relogio = Date.now;
    let agora = relogio();
    Date.now = () => agora;
    const lenta = (url, init) => {
      if ((init.method || 'GET') === 'POST') agora += 10_000;     // o Waze leva 10 s pra gravar
      return w.responder(url, init);
    };
    try {
      await comWaze(lenta, async () => {
        if (comToque) {
          await excluir('A', { action: 'preparar', aquecimento: 'gesto-serie-a' });   //  0 s: toca na lixeira → LÊ
          agora += 3_000; await excluir('A', { aquecimento: 'gesto-serie-a' });      //  3 s: confirma (a escrita vai até os 13 s)
          agora += 3_000;                                                            // 16 s: OUTRO editor sobe a foto D
          w.fotos = [...w.fotos, { id: 'D', approved: true }];
          await excluir('B', { action: 'preparar', aquecimento: 'gesto-serie-b' });   // 16 s: toca na lixeira de novo
          agora += 4_000; await excluir('B', { aquecimento: 'gesto-serie-b' });      // 20 s: confirma
        } else {
          await excluir('A');                       //  0 s: relê (a lista dos 0 s) e grava até os 10 s
          agora += 6_000;                           // 16 s: OUTRO editor sobe a foto D
          w.fotos = [...w.fotos, { id: 'D', approved: true }];
          agora += 4_000; await excluir('B');       // 20 s: a lista dos 0 s já venceu
        }
      });
    } finally {
      Date.now = relogio;
    }
    const como = comToque ? 'com o toque de cada gesto' : 'sem o toque (relendo e regravando)';
    assert.ok(w.fotos.some((i) => i.id === 'D'),
      `${como}: a foto que outro editor subiu aos 16 s foi APAGADA — escritas: ${JSON.stringify(w.escritas.map(ids))}`);
    assert.equal(w.leituras, 2, `${como}: a leitura dos 0 s serviu além do prazo (ou o cache parou de servir dentro dele)`);
    assert.deepEqual(w.escritas.map(ids), [['B', 'C'], ['C', 'D']], como);
  }
});

test('validar-place: aprovar a foto esquece a releitura guardada — a exclusão seguinte relê', async () => {
  // Tocou na lixeira de uma foto (a releitura fica guardada), desistiu,
  // aprovou a pendente e, segundos depois, foi excluir: a releitura ainda via a
  // aprovada como PENDENTE. Vale pras DUAS listas guardadas: a do toque (a chave
  // do toque, R13-3-03: a exclusão do mesmo gesto a usaria — o gesto da outra aba
  // da mesma sessão, com a aprovação desta pousando no meio) e a da releitura (a
  // regravada por uma exclusão anterior do local).
  const GESTO = 'gesto-aprova-01';
  for (const [onde, alvo, esperado] of [
    ['toque', 'NOVA', [{ id: 'VELHA', approved: true }]],     // era "só foto aprovada pode ser excluída"
    ['toque', 'VELHA', [{ id: 'NOVA', approved: true }]],     // gravava de volta o `approved: false` velho
    ['releitura', 'VELHA', [{ id: 'NOVA', approved: true }]],
  ]) {
    const s = await sessaoDeTeste(COOKIES);
    const fotos = [{ id: 'VELHA', approved: true }, { id: 'NOVA', approved: false }];
    if (onde === 'releitura') fotos.push({ id: 'OUTRA', approved: true });
    const w = wazeDeUmLocal('v1', fotos);
    const base = { ...s.dados, region: 'row', venueID: 'v1', lat: -23.5, lon: -46.6 };
    const { r } = await comWaze(w.responder, async () => {
      if (onde === 'toque') await dispatch('excluir-foto', { ...base, imageID: 'preparar', action: 'preparar', aquecimento: GESTO }, s.ctx);
      else {   // uma exclusão anterior do local relê e regrava a lista (com a NOVA pendente)
        const r0 = await dispatch('excluir-foto', { ...base, imageID: 'OUTRA' }, s.ctx);
        assert.equal(r0.body.success, true, `pré-condição: a exclusão anterior falhou: ${JSON.stringify(r0.body)}`);
        w.escritas.length = 0;
      }
      const ap = await dispatch('validar-place', { ...s.dados, region: 'row', venueID: 'v1', updateRequestID: 'NOVA', approve: true }, s.ctx);
      assert.equal(ap.body.action, 'approved', 'pré-condição: a aprovação passou');
      return dispatch('excluir-foto', { ...base, imageID: alvo, ...(onde === 'toque' ? { aquecimento: GESTO } : {}) }, s.ctx);
    });
    assert.equal(r.body.success, true, `excluir ${alvo} depois de aprovar (a lista do ${onde}): ${r.body.errorKey || JSON.stringify(r.body)}`);
    assert.deepEqual(w.escritas, [esperado], `excluir ${alvo} (a lista do ${onde}): gravou uma lista velha`);
  }
});

// R11-3-01 (auditoria da rodada 11): a aprovação que POUSA com uma exclusão do
// MESMO local no ar. A aprovação esquece a releitura guardada (o teste de cima),
// e a resposta da exclusão, que volta DEPOIS, a RECRIAVA com a lista lida antes —
// P ainda pendente. A exclusão seguinte, nos 15 s dela, gravava P de volta como
// `approved: false`: a aprovação se desfazia no Waze sem pedido nenhum (MEDIDO no
// core e de ponta a ponta). O Waze de um local só, com a RESPOSTA da escrita da
// lista presa até o teste soltar (o Waze já gravou; a resposta é que demora), e o
// relógio de mentira. `meio` roda com a escrita de X gravada e a resposta presa.
// Desde a rodada 13 (R13-3-03) a lista do TOQUE mora numa chave própria, e a
// exclusão que se baseia nela não regrava nada: a regravação (e o que este
// teste mede) é da exclusão que se baseia na lista da RELEITURA — a que ela
// mesma lê e guarda (sem o toque) ou a que uma exclusão anterior regravou. A de
// X é assim; a de Y, a de todo dia, com o toque do gesto dela.
async function exclusaoComAlgoNoMeio(meio) {
  const s = await sessaoDeTeste(COOKIES);
  const w = wazeDeUmLocal('v1', [{ id: 'X', approved: true }, { id: 'Y', approved: true }, { id: 'P', approved: false }]);
  let prender = null;
  const waze = async (url, init) => {
    const resposta = w.responder(url, init);                     // o Waze grava na hora…
    const daLista = init.method === 'POST' && JSON.parse(init.body).actions._subActions[0].name === 'UPDATE_OBJECT';
    if (daLista && prender) { const p = prender; prender = null; await p; }   // …e a resposta demora
    return resposta;
  };
  const base = { ...s.dados, region: 'row', venueID: 'v1', lat: -23.5, lon: -46.6 };
  const releitura = () => [...s.store.mem.keys()].find((k) => String(k).startsWith('reler_') && !String(k).startsWith('reler_toque_'));
  const relogio = Date.now;
  let agora = relogio();
  Date.now = () => agora;
  try {
    await comWaze(waze, async () => {
      agora += 3000;
      let soltar;
      prender = new Promise((ok) => { soltar = ok; });
      const exclX = dispatch('excluir-foto', { ...base, imageID: 'X' }, s.ctx);              //  3 s: X sai (relê e guarda a lista)
      while (!w.escritas.length) await new Promise((ok) => setTimeout(ok, 1));               // o Waze gravou X; a resposta, presa
      agora += 3000;
      await meio({ s, chave: releitura() });                                                  //  6 s
      agora += 1000;
      soltar();
      const rX = await exclX;                                                                 //  7 s: a resposta de X chega
      assert.equal(rX.body.success, true, `PRÉ-CONDIÇÃO: a exclusão de X falhou: ${JSON.stringify(rX.body)}`);
      w.depoisDeX = s.store.mem.get(releitura());
      agora += 3000;
      await dispatch('excluir-foto', { ...base, imageID: 'preparar', action: 'preparar', aquecimento: 'gesto-meio-y1' }, s.ctx);   // 10 s: a lixeira de Y (≤ 15 s)
      agora += 3000;
      const rY = await dispatch('excluir-foto', { ...base, imageID: 'Y', aquecimento: 'gesto-meio-y1' }, s.ctx);           // 13 s
      assert.equal(rY.body.success, true, `PRÉ-CONDIÇÃO: a exclusão de Y falhou: ${JSON.stringify(rY.body)}`);
    });
  } finally {
    Date.now = relogio;
  }
  return w;
}
const comPendente = (l) => l.map((f) => f.id + (f.approved === false ? '(pendente)' : ''));

test('excluir-foto: a resposta que volta DEPOIS de a aprovação do local pousar não recria a releitura que ela esqueceu — P fica aprovada (R11-3-01)', async () => {
  const w = await exclusaoComAlgoNoMeio(async ({ s }) => {
    const ap = await dispatch('validar-place', { ...s.dados, region: 'row', venueID: 'v1', updateRequestID: 'P', approve: true }, s.ctx);
    assert.equal(ap.body.action, 'approved', 'PRÉ-CONDIÇÃO: a aprovação não passou');
  });
  assert.deepEqual(comPendente(w.fotos), ['P'],
    `DEFEITO: a aprovação se desfez no Waze — a exclusão de Y gravou P de volta como pendente: ${JSON.stringify(w.escritas.map(comPendente))}`);
  assert.equal(w.depoisDeX, undefined, 'a resposta de X recriou a releitura que a aprovação esqueceu');
  assert.equal(w.leituras, 2, 'a exclusão de Y não releu o local (usou a lista de antes da aprovação)');
  // CONTROLE: sem nada no meio, a resposta de X REGRAVA a releitura (sem X), e o
  // toque e a exclusão de Y a usam sem reler — o conserto não é "nunca regravar".
  const c = await exclusaoComAlgoNoMeio(async () => {});
  assert.equal(c.leituras, 1, 'CONTROLE: sem nada no meio, a exclusão de Y releu — a regravação depois da exclusão sumiu?');
  assert.deepEqual(c.escritas.map(comPendente), [['Y', 'P(pendente)'], ['P(pendente)']]);
});

test('excluir-foto: a releitura TROCADA no meio da exclusão (outra escrita do local a regravou) não é coberta pela lista desta (R11-3-01)', async () => {
  // "Só regrava se ainda é a que esta exclusão leu" vale pra sumida E pra
  // trocada: por cima da que outra exclusão do local deixou (sem a foto DELA, Y),
  // a lista desta a devolveria na exclusão seguinte. A lista da outra tem de ser
  // DIFERENTE da que esta regravaria (sem X: [Y, P]) — igual, o teste passaria
  // com a regravação cega (visto na sabotagem: a primeira versão era igual).
  const outra = String(Math.floor(Date.now() / 1000)) + '|' + JSON.stringify({ id: 'v1', images: [{ id: 'P', approved: false }] });
  let chave = null;
  const w = await exclusaoComAlgoNoMeio(async ({ s, chave: k }) => {
    chave = k;
    assert.ok(chave, 'CONTROLE: a releitura guardada pela exclusão de X não está no store — o teste não mediria nada');
    await s.store.put(chave, outra);
  });
  assert.equal(w.depoisDeX, outra, 'a resposta desta exclusão cobriu a releitura que OUTRA escrita do local deixou');
});

// R12-3-01 (auditoria da rodada 12): o AQUECIMENTO da lixeira (`preparar`) cuja
// leitura volta DEPOIS de a exclusão do local sair. O `rel.bruto` do R11-3-01 só
// guarda a regravação da EXCLUSÃO; o aquecimento gravava sem conferir nada. Com o
// Waze lento, a leitura do toque na lixeira de X (servida com X ainda no local)
// voltava depois de a exclusão de X — que não achou a lista, releu sozinha,
// gravou e regravou sem X — e gravava por cima a lista de ANTES, com a hora
// nova: a exclusão seguinte do local, nos 15 s, mandava X de volta (MEDIDO de
// ponta a ponta, e3-preparar-tardio). Desde a rodada 13 (R13-3-03) a lista do
// toque mora numa chave PRÓPRIA (`chaveDoToque`), marcada com o gesto: ela não
// cobre a da releitura em ordem nenhuma. O Waze de um local só; as RESPOSTAS
// das leituras presas (o Waze já leu a lista, com X) esperam o teste soltar; o
// relógio é de mentira. O toque e a exclusão de X levam o MESMO gesto (o app);
// a de Y, nenhum. `pousa`: quando a leitura do aquecimento volta —
//   'depois'  : depois de a exclusão de X terminar (a do auditor);
//   'no-meio' : com a releitura da PRÓPRIA exclusão de X no ar (ela também lê o
//               local, sem lista guardada), e antes dela;
//   'antes'   : antes de X sair — o caso de todo dia, o CONTROLE.
const GESTO_X = 'gesto-toque-x1';
async function aquecimentoQueVoltaTarde({ pousa }) {
  const s = await sessaoDeTeste(COOKIES);
  const w = wazeDeUmLocal('v1', [{ id: 'X', approved: true }, { id: 'Y', approved: true }, { id: 'P', approved: false }]);
  const soltar = [];
  let segurar = { depois: 1, 'no-meio': 2, antes: 0 }[pousa];
  const waze = async (url, init) => {
    const resposta = w.responder(url, init);                  // o Waze lê (ou grava) na hora…
    if ((init.method || 'GET') === 'GET' && segurar > 0) {    // …e a resposta demora
      segurar--;
      await new Promise((ok) => { soltar.push(ok); });
    }
    return resposta;
  };
  const leu = async (n) => { while (w.leituras < n) await new Promise((ok) => setTimeout(ok, 1)); };
  const base = { ...s.dados, region: 'row', venueID: 'v1', lat: -23.5, lon: -46.6 };
  const relogio = Date.now;
  let agora = relogio();
  Date.now = () => agora;
  try {
    await comWaze(waze, async () => {
      const prep = dispatch('excluir-foto', { ...base, imageID: 'preparar', action: 'preparar', aquecimento: GESTO_X }, s.ctx);   // 0 s: o toque na lixeira de X
      await leu(1);                                                                                           // o Waze leu (com X)
      if (pousa === 'antes') await prep;
      agora += 3000;
      const exclX = dispatch('excluir-foto', { ...base, imageID: 'X', aquecimento: GESTO_X }, s.ctx);        // 3 s: a janela vence (ou a página sai), X sai
      if (pousa === 'no-meio') {
        await leu(2);                                     // a releitura da exclusão de X saiu (sem lista guardada)
        agora += 100;
        soltar[0]();                                      // o aquecimento volta com ela no ar…
        await prep;
        soltar[1]();                                      // …e depois ela
      }
      const rX = await exclX;
      assert.equal(rX.body.success, true, `PRÉ-CONDIÇÃO: a exclusão de X falhou: ${JSON.stringify(rX.body)}`);
      w.leiturasDepoisDeX = w.leituras;
      agora += 200;
      if (pousa === 'depois') soltar[0]();                // 3,2 s: a leitura do toque volta
      const rp = await prep;
      assert.equal(rp.body.success, true, `PRÉ-CONDIÇÃO: o aquecimento falhou: ${JSON.stringify(rp.body)}`);
      agora += 2000;
      const rY = await dispatch('excluir-foto', { ...base, imageID: 'Y' }, s.ctx);                           // 5,2 s: a lixeira de Y (≤ 15 s)
      assert.equal(rY.body.success, true, `PRÉ-CONDIÇÃO: a exclusão de Y falhou: ${JSON.stringify(rY.body)}`);
    });
  } finally {
    Date.now = relogio;
  }
  return w;
}

test('excluir-foto: o aquecimento da lixeira que volta DEPOIS da exclusão do local não grava a lista de antes por cima — X não volta ao Waze (R12-3-01)', async () => {
  const w = await aquecimentoQueVoltaTarde({ pousa: 'depois' });
  assert.ok(w.escritas.length === 2 && w.leituras === 2,
    `PRÉ-CONDIÇÃO: não foram 2 leituras (o toque e a exclusão de X) e 2 escritas: ${w.leituras} leituras, ${JSON.stringify(w.escritas.map(comPendente))}`);
  assert.deepEqual(comPendente(w.fotos), ['P(pendente)'],
    `DEFEITO: a exclusão de Y mandou de volta a foto que a de X tirou — o aquecimento atrasado gravou a lista de antes por cima: ${JSON.stringify(w.escritas.map(comPendente))}`);
  // CONTROLE: o aquecimento que volta ANTES (o caso de todo dia) segue servindo a
  // exclusão do gesto dele — a de X usa a lista do toque, sem reler. O conserto
  // não é "o aquecimento não serve pra nada".
  const c = await aquecimentoQueVoltaTarde({ pousa: 'antes' });
  assert.equal(c.leiturasDepoisDeX, 1, 'CONTROLE: com o aquecimento no tempo certo, a exclusão de X releu o local — a lista do toque não serviu?');
  assert.deepEqual(c.escritas.map(comPendente), [['Y', 'P(pendente)'], ['P(pendente)']]);
});

test('excluir-foto: o aquecimento que volta com a releitura da EXCLUSÃO no ar grava, e a exclusão grava e regrava por cima dele — X não volta (R12-3-01)', async () => {
  // A conferência é SÓ do aquecimento. Na releitura da exclusão ela guardaria o
  // aquecimento (lido ANTES da escrita de X, com X) e pularia a regravação, que
  // só acontece por cima do registro da própria exclusão: a de Y devolveria X.
  const w = await aquecimentoQueVoltaTarde({ pousa: 'no-meio' });
  assert.equal(w.leituras, 2, `PRÉ-CONDIÇÃO: não foram 2 leituras (o toque e a exclusão de X): ${w.leituras}`);
  assert.deepEqual(comPendente(w.fotos), ['P(pendente)'],
    `DEFEITO: a exclusão de Y mandou de volta a foto que a de X tirou: ${JSON.stringify(w.escritas.map(comPendente))}`);
  assert.deepEqual(w.escritas.map(comPendente), [['Y', 'P(pendente)'], ['P(pendente)']]);
});

test('excluir-foto: a lista guardada vale os 15 s a partir da IDA da leitura, não da resposta — a leitura lenta não estica a janela da corrida (R12-3-01)', async () => {
  // A lista é a do Waze em algum instante entre a ida e a volta; com a hora da
  // RESPOSTA, a leitura de 9 s servia a exclusão 16 s depois da ida.
  const cenario = async (depois) => {
    const s = await sessaoDeTeste(COOKIES);
    const w = wazeDeUmLocal('v1', [{ id: 'A', approved: true }, { id: 'B', approved: true }]);
    const relogio = Date.now;
    let agora = Math.floor(relogio() / 1000) * 1000;              // num segundo redondo
    Date.now = () => agora;
    const lenta = (url, init) => {
      if ((init.method || 'GET') === 'GET') agora += 9000;        // a leitura leva 9 s (o teto dela é 10)
      return w.responder(url, init);
    };
    const base = { ...s.dados, region: 'row', venueID: 'v1', lat: -23.5, lon: -46.6 };
    try {
      await comWaze(lenta, async () => {
        await dispatch('excluir-foto', { ...base, imageID: 'preparar', action: 'preparar', aquecimento: 'gesto-lento-01' }, s.ctx);   // 0 s → volta aos 9 s
        agora += depois * 1000 - 9000;
        const r = await dispatch('excluir-foto', { ...base, imageID: 'A', aquecimento: 'gesto-lento-01' }, s.ctx);
        assert.equal(r.body.success, true, JSON.stringify(r.body));
      });
    } finally {
      Date.now = relogio;
    }
    return w.leituras;
  };
  assert.equal(await cenario(16), 2,
    'DEFEITO: a lista lida aos 0 s (resposta aos 9 s) serviu a exclusão aos 16 s — a janela da corrida passou dos 15 s');
  // CONTROLE: dentro dos 15 s contados da ida, a lista guardada serve (o
  // instrumento enxerga o cache).
  assert.equal(await cenario(14), 1, 'CONTROLE: aos 14 s da ida a exclusão releu o local — a lista guardada deixou de servir');
});

// ── R13-3-02 e R13-3-03 (auditoria da rodada 13): a página SAINDO ─────────────
// Com a página saindo (o app fechado, ou trocado por outro), a escrita da foto
// não espera o toque da lixeira (`vezDasFotosNoLocal` no app): o toque e a
// escrita cruzam no servidor. O lote 16 deixava a ORDEM com o servidor — o toque
// só gravava por cima da lista que estava lá quando ele saiu —, e dois buracos
// sobravam (MEDIDO de ponta a ponta, num Waze de mentira):
//   R13-3-02: a APROVAÇÃO apaga a lista (`esquecerReleitura`); apagada, ela volta
//             a ser a de antes (nenhuma), e o toque que pousa depois a gravava —
//             com a foto aprovada ainda PENDENTE. A exclusão seguinte do local, nos
//             15 s, a mandava de volta como `approved: false` (e a foto excluída
//             na janela, de volta ao mapa).
//   R13-3-03: a conferência do toque (o `get`, e depois o `put`) não é atômica: a
//             gravação da exclusão cabia entre os dois, e a lista do toque (com a
//             foto excluída) ficava guardada; a exclusão seguinte a devolvia.
// Agora a lista do toque mora numa chave PRÓPRIA (`chaveDoToque`), que só a
// exclusão do MESMO gesto lê: ela não cobre nada.

// R13-3-03, com a ordem FORÇADA: as duas leituras do Waze presas; a do toque
// volta primeiro, a gravação dela fica presa até a exclusão gravar a lista
// dela, e a conferência da regravação da exclusão espera a gravação do toque
// terminar — a janela inteira, sem depender de tempo. É a ordem que o roteiro a5
// pegava em 4 de 9 rodadas (as duas leituras voltando no mesmo tique).
test('excluir-foto: com a página saindo, o toque e a exclusão do MESMO gesto cruzam no servidor — a gravação do toque não cobre a lista da exclusão (R13-3-03)', async () => {
  const s = await sessaoDeTeste(COOKIES);
  const w = wazeDeUmLocal('v1', [{ id: 'X', approved: true }, { id: 'Y', approved: true }, { id: 'P', approved: false }]);
  const leituras = [];
  const waze = async (url, init) => {
    const resposta = w.responder(url, init);
    if ((init.method || 'GET') === 'GET' && leituras.length < 2) await new Promise((ok) => { leituras.push(ok); });
    return resposta;
  };
  const daLista = (k) => String(k).startsWith('reler_');
  // O store: as gravações e leituras das LISTAS (a sessão passa direto) são
  // contadas, e o teste segura a que quiser.
  let puts = 0;
  let segurarProximoPut = null;       // a gravação do toque, presa até a da exclusão terminar
  let depoisDoPutDaExclusao = null;   // solta a do toque
  let segurarProximoGet = null;       // a conferência da regravação da exclusão, presa até a do toque terminar
  const putOriginal = s.store.put, getOriginal = s.store.get;
  s.store.put = async (k, v, ttl) => {
    if (!daLista(k)) return putOriginal(k, v, ttl);
    puts++;
    if (segurarProximoPut) { const p = segurarProximoPut; segurarProximoPut = null; await p; const r = await putOriginal(k, v, ttl); s.toqueGravou(); return r; }
    const r = await putOriginal(k, v, ttl);
    if (depoisDoPutDaExclusao) { const f = depoisDoPutDaExclusao; depoisDoPutDaExclusao = null; f(); }
    return r;
  };
  s.store.get = async (k) => {
    if (daLista(k) && segurarProximoGet) { const p = segurarProximoGet; segurarProximoGet = null; await p; }
    return getOriginal(k);
  };
  const base = { ...s.dados, region: 'row', venueID: 'v1', lat: -23.5, lon: -46.6 };
  const GESTO = 'gesto-cruza-x1';
  const relogio = Date.now;
  let agora = relogio();
  Date.now = () => agora;
  try {
    await comWaze(waze, async () => {
      const prep = dispatch('excluir-foto', { ...base, imageID: 'preparar', action: 'preparar', aquecimento: GESTO }, s.ctx);   // 0 s: o toque
      while (leituras.length < 1) await new Promise((ok) => setTimeout(ok, 1));
      // A página sai 1,5 s depois do toque (a janela é de 3 s). As duas leituras
      // trazem a MESMA lista (nenhuma escrita entre elas): só a hora da leitura
      // separa o registro do toque do da exclusão. No mesmo segundo, a gravação
      // do toque por cima da da exclusão nem se distinguiria — e não mediria nada
      // (visto na sabotagem: com 400 ms o lote 16 passava).
      agora += 1500;
      const exclX = dispatch('excluir-foto', { ...base, imageID: 'X', aquecimento: GESTO }, s.ctx);   // a página sai: X não espera o toque
      while (leituras.length < 2) await new Promise((ok) => setTimeout(ok, 1));
      // A ordem forçada: o toque grava DEPOIS da lista da exclusão, e ANTES da
      // conferência da regravação dela.
      let soltarToque;
      segurarProximoPut = new Promise((ok) => { soltarToque = ok; });
      let toqueGravou;
      const gravouToque = new Promise((ok) => { toqueGravou = ok; });
      s.toqueGravou = toqueGravou;
      depoisDoPutDaExclusao = () => { segurarProximoGet = gravouToque; soltarToque(); };
      leituras[0]();                                 // a leitura do toque volta (a gravação dele fica presa)…
      while (puts < 1) await new Promise((ok) => setTimeout(ok, 1));
      leituras[1]();                                 // …e a da exclusão: ela grava a lista, e só então o toque grava
      const rX = await exclX;
      assert.equal(rX.body.success, true, `PRÉ-CONDIÇÃO: a exclusão de X falhou: ${JSON.stringify(rX.body)}`);
      const rp = await prep;
      assert.equal(rp.body.success, true, `PRÉ-CONDIÇÃO: o toque falhou: ${JSON.stringify(rp.body)}`);
      assert.ok(puts >= 2, `PRÉ-CONDIÇÃO: o toque e a exclusão não gravaram as duas listas (${puts})`);
      assert.ok(Math.floor((agora - 1500) / 1000) !== Math.floor(agora / 1000),
        'PRÉ-CONDIÇÃO: a leitura do toque e a da exclusão no MESMO segundo — os dois registros seriam iguais');
      agora += 2000;
      const rY = await dispatch('excluir-foto', { ...base, imageID: 'Y' }, s.ctx);   // de volta ao app, a lixeira de Y (≤ 15 s)
      assert.equal(rY.body.success, true, `PRÉ-CONDIÇÃO: a exclusão de Y falhou: ${JSON.stringify(rY.body)}`);
    });
  } finally {
    Date.now = relogio;
  }
  assert.deepEqual(comPendente(w.fotos), ['P(pendente)'],
    `DEFEITO: a exclusão de Y mandou de volta a foto que a de X tirou — a lista do toque cobriu a da exclusão: ${JSON.stringify(w.escritas.map(comPendente))}`);
  assert.deepEqual(w.escritas.map(comPendente), [['Y', 'P(pendente)'], ['P(pendente)']]);
});

// R13-3-02: a APROVAÇÃO que pousa com o toque da lixeira no ar. (a) A página sai
// com a janela da aprovação aberta (tocou na lixeira de X, desfez, aprovou P): a
// aprovação sai sem esperar o toque. (b) A página sai com a janela da exclusão
// de X aberta (X sai sem esperar o toque) e volta; a aprovação de P, feita
// depois, espera só a exclusão de X — e sai com o toque ainda no ar. Nos dois, o
// toque volta DEPOIS da aprovação, e a lixeira de Y, nos 15 s do toque, não pode
// desaprovar P (nem devolver X).
test('validar-place: a aprovação que pousa com o TOQUE da lixeira no ar — a leitura dele, que volta depois, não desaprova a foto (R13-3-02)', async () => {
  for (const caso of ['a', 'b']) {
    const s = await sessaoDeTeste(COOKIES);
    const w = wazeDeUmLocal('v1', [{ id: 'X', approved: true }, { id: 'Y', approved: true }, { id: 'P', approved: false }]);
    let soltarToque = null;
    let segurar = true;
    const waze = async (url, init) => {
      const resposta = w.responder(url, init);
      if ((init.method || 'GET') === 'GET' && segurar) { segurar = false; await new Promise((ok) => { soltarToque = ok; }); }
      return resposta;
    };
    const base = { ...s.dados, region: 'row', venueID: 'v1', lat: -23.5, lon: -46.6 };
    const GESTO = 'gesto-aprova-x' + caso;
    const relogio = Date.now;
    let agora = relogio();
    Date.now = () => agora;
    try {
      await comWaze(waze, async () => {
        const prep = dispatch('excluir-foto', { ...base, imageID: 'preparar', action: 'preparar', aquecimento: GESTO }, s.ctx);   // 0 s: o toque em X (o Waze lento)
        while (!soltarToque) await new Promise((ok) => setTimeout(ok, 1));
        agora += 1000;
        if (caso === 'b') {                         // a página sai com a janela de X: X sai sem esperar o toque
          const rX = await dispatch('excluir-foto', { ...base, imageID: 'X', aquecimento: GESTO }, s.ctx);
          assert.equal(rX.body.success, true, `(${caso}) PRÉ-CONDIÇÃO: a exclusão de X falhou: ${JSON.stringify(rX.body)}`);
          agora += 2000;
        }
        const ap = await dispatch('validar-place', { ...s.dados, region: 'row', venueID: 'v1', updateRequestID: 'P', approve: true }, s.ctx);
        assert.equal(ap.body.action, 'approved', `(${caso}) PRÉ-CONDIÇÃO: a aprovação não passou`);
        agora += 500;
        soltarToque();                              // o toque volta DEPOIS da aprovação
        const rp = await prep;
        assert.equal(rp.body.success, true, `(${caso}) PRÉ-CONDIÇÃO: o toque falhou`);
        agora += 2000;
        const rY = await dispatch('excluir-foto', { ...base, imageID: 'Y' }, s.ctx);   // a lixeira de Y, nos 15 s do toque
        assert.equal(rY.body.success, true, `(${caso}) PRÉ-CONDIÇÃO: a exclusão de Y falhou: ${JSON.stringify(rY.body)}`);
      });
    } finally {
      Date.now = relogio;
    }
    const esperado = caso === 'a' ? ['X', 'P'] : ['P'];
    assert.deepEqual(comPendente(w.fotos), esperado,
      `DEFEITO (${caso}): a exclusão de Y desfez o que veio antes — a lista do toque, lida antes da aprovação (e da exclusão de X), valeu depois dela: ${JSON.stringify(w.escritas.map(comPendente))}`);
  }
});

// A lista do toque é do GESTO: a exclusão de OUTRO gesto (o toque desfeito e a
// lixeira tocada de novo; outra aba da mesma sessão) não a usa, e relê. Sem o
// gesto (o app de antes), o toque não lê nada e não grava nada — a exclusão
// relê na hora.
test('excluir-foto: a lista do toque só serve a exclusão do MESMO gesto — e o toque sem gesto não lê nem grava (R13-3-03)', async () => {
  const medir = async (gestoDoToque, gestoDaExclusao) => {
    const s = await sessaoDeTeste(COOKIES);
    const w = wazeDeUmLocal('v1', [{ id: 'X', approved: true }, { id: 'Y', approved: true }]);
    let gravacoes = 0;
    const gravar = s.store.put;
    s.store.put = async (k, v, ttl) => { if (String(k).startsWith('reler_')) gravacoes++; return gravar(k, v, ttl); };
    const base = { ...s.dados, region: 'row', venueID: 'v1', lat: -23.5, lon: -46.6 };
    const n = {};
    await comWaze(w.responder, async () => {
      const rp = await dispatch('excluir-foto', { ...base, imageID: 'preparar', action: 'preparar', ...(gestoDoToque ? { aquecimento: gestoDoToque } : {}) }, s.ctx);
      n.preparado = rp.body.preparado;
      n.leiturasNoToque = w.leituras;
      n.gravacoesNoToque = gravacoes;
      const r = await dispatch('excluir-foto', { ...base, imageID: 'X', ...(gestoDaExclusao ? { aquecimento: gestoDaExclusao } : {}) }, s.ctx);
      assert.equal(r.body.success, true, JSON.stringify(r.body));
      n.leiturasNaExclusao = w.leituras - n.leiturasNoToque;
    });
    return n;
  };
  const mesmo = await medir('gesto-mesmo-01', 'gesto-mesmo-01');
  assert.deepEqual([mesmo.preparado, mesmo.leiturasNoToque, mesmo.gravacoesNoToque, mesmo.leiturasNaExclusao], [true, 1, 1, 0],
    `CONTROLE: o toque e a exclusão do MESMO gesto — o toque leu e guardou, e a exclusão usou: ${JSON.stringify(mesmo)}`);
  const outro = await medir('gesto-toque-01', 'gesto-outro-01');
  assert.equal(outro.leiturasNaExclusao, 1, `a exclusão de OUTRO gesto usou a lista do toque: ${JSON.stringify(outro)}`);
  const semGesto = await medir(null, null);
  assert.deepEqual([semGesto.preparado, semGesto.leiturasNoToque, semGesto.gravacoesNoToque, semGesto.leiturasNaExclusao], [false, 0, 0, 1],
    `o toque sem gesto leu ou gravou a lista (não há pra quem): ${JSON.stringify(semGesto)}`);
});

test('validar-place: rejeitar NÃO toca na releitura guardada (é o gesto de todo swipe; a cota do KV é contada)', async () => {
  const s = await sessaoDeTeste(COOKIES);
  const lidas = [];
  const ler = s.store.get;
  s.store.get = async (k) => { lidas.push(k); return ler(k); };
  const w = wazeDeUmLocal('v1', []);
  await comWaze(w.responder, () => dispatch('validar-place', { ...s.dados, region: 'row', venueID: 'v1', updateRequestID: 'u1' }, s.ctx));
  assert.equal(lidas.filter((k) => String(k).startsWith('reler_')).length, 0, 'rejeitar leu a releitura do KV');
  // CONTROLE: aprovar lê (o instrumento enxerga a leitura) — as DUAS listas: a
  // da releitura e a do toque (R13-3-02, ver `esquecerReleitura`).
  await comWaze(w.responder, () => dispatch('validar-place', { ...s.dados, region: 'row', venueID: 'v1', updateRequestID: 'u1', approve: true }, s.ctx));
  assert.equal(lidas.filter((k) => String(k).startsWith('reler_')).length, 2, 'CONTROLE: aprovar não consultou as duas listas da lixeira');
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

import { DUPLICADO_ESPERA_MS, WAZE_ESPERA_MS, RELEITURA_ESPERA_MS } from '../server/core.mjs';

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

// O cliente desiste do pedido INTEIRO aos 45 s (`_post`, no api.js), e rota que
// faz duas chamadas ao Waze em SÉRIE só cabe nisso se a soma dos tetos couber.
// Os tetos vêm do core IMPORTADOS; o do `callWaze` é conferido também na fonte,
// porque um número à parte dentro dele faria a constante mentir.
const tetoDoCliente = () => {
  const m = /async _post\([\s\S]*?controller\.abort\(\), (\d+)\)/.exec(API_JS);
  assert.ok(m, 'não achei o teto do cliente no api.js — o instrumento quebrou, não a regra');
  return Number(m[1]);
};

test('o teto do duplicado cabe no prazo do cliente: busca (teto do callWaze) + releitura < 45 s do `_post`', () => {
  // A justificativa do número: se alguém subir o teto do duplicado (ou encurtar
  // o do cliente), a busca volta a se perder pelo enfeite.
  const core = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');
  assert.match(core, /async function callWaze\([^)]*\{ tetoMs = WAZE_ESPERA_MS \} = \{\}\)/,
    'o callWaze não espera o WAZE_ESPERA_MS por padrão — a conta abaixo não vale');
  assert.match(core, /controller\.abort\(\), tetoMs\)/, 'o timer do callWaze não usa o teto da chamada');
  const soma = WAZE_ESPERA_MS + DUPLICADO_ESPERA_MS;
  assert.ok(soma < tetoDoCliente(),
    `busca (${WAZE_ESPERA_MS} ms) + releitura (${DUPLICADO_ESPERA_MS} ms) = ${soma} ms não cabe nos ${tetoDoCliente()} ms do cliente`);
});

test('o teto da releitura do excluir-foto cabe no prazo do cliente: releitura + escrita, EM SÉRIE, < 45 s do `_post`', () => {
  // Sem a lista guardada, a exclusão relê e depois escreve. Com os dois no teto
  // cheio eram 60 s, e o cliente desistia aos 45 com a escrita já no ar: a
  // retentativa voltava "já excluída" e a pessoa lia "outro editor já tinha
  // excluído" sobre a exclusão DELA (auditoria de 2026-09-29). 3 s de folga pro
  // que não é o Waze (KV, cifra, a rede do celular até o servidor).
  const soma = RELEITURA_ESPERA_MS + WAZE_ESPERA_MS;
  assert.ok(soma + 3000 <= tetoDoCliente(),
    `releitura (${RELEITURA_ESPERA_MS} ms) + escrita (${WAZE_ESPERA_MS} ms) = ${soma} ms, sem folga nos ${tetoDoCliente()} ms do cliente`);
  assert.ok(RELEITURA_ESPERA_MS >= 3000, 'o teto da releitura ficou curto pra uma leitura de ~700 ms num dia ruim');
});

test('excluir-foto: releitura presa responde no teto DELA, sem escrever — e o erro é de rede, pro cliente tentar de novo', async () => {
  // Os prazos do core andam 20× mais rápido aqui (só os de 1 s pra cima): 10 s
  // viram 500 ms e 30 s viram 1,5 s, e a pergunta é QUAL dos dois segurou a rota.
  const ESCALA = 20;
  const setTimeoutReal = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => setTimeoutReal(fn, ms >= 1000 ? ms / ESCALA : ms, ...a);
  try {
    const corpo = { region: 'row', venueID: 'v1', imageID: 'i1', lat: -23.5, lon: -46.6 };
    // CONTROLE: com o Waze respondendo, a exclusão sai — o teto não corta o caminho normal.
    const s0 = await sessaoDeTeste(COOKIES);
    const normal = await comWaze((url, init) => (init.method === 'POST'
      ? json({ venues: { v1: { images: [{ id: 'i2' }] } } })
      : json({ venues: { objects: [{ id: 'v1', images: [{ id: 'i1', approved: true }, { id: 'i2', approved: true }] }] } })),
    () => dispatch('excluir-foto', { ...s0.dados, ...corpo }, s0.ctx));
    assert.equal(normal.r.body.success, true, `CONTROLE: ${JSON.stringify(normal.r.body)}`);

    // A releitura fica PRESA até o `callWaze` abortar.
    const s = await sessaoDeTeste(COOKIES);
    const t0 = Date.now();
    const { r, chamadas } = await comWaze((url, init) => new Promise((ok, erro) => {
      init.signal?.addEventListener('abort', () => erro(new DOMException('This operation was aborted', 'AbortError')));
    }), () => dispatch('excluir-foto', { ...s.dados, ...corpo }, s.ctx));
    const levou = Date.now() - t0;
    assert.equal(chamadas.length, 1, 'CONTROLE: a rota não fez a releitura (ou fez mais de uma chamada)');
    assert.ok(chamadas.every((c) => (c.init.method || 'GET') === 'GET'), 'escreveu no Waze sem ter lido o local');
    assert.equal(r.body.success, false);
    assert.equal(r.body.errorCategory, 'transient', `a releitura que não voltou não é erro de rede: ${JSON.stringify(r.body)}`);
    const dela = RELEITURA_ESPERA_MS / ESCALA, cheio = WAZE_ESPERA_MS / ESCALA;
    assert.ok(levou < (dela + cheio) / 2,
      `a releitura presa segurou a rota ${levou} ms — era o teto dela (${dela} ms escalados), não o cheio (${cheio})`);
  } finally {
    globalThis.setTimeout = setTimeoutReal;
  }
});

// `NaN <= 0` é falso: o countryId que não é número passava pela guarda e ia ao
// Waze como 0, voltando 200 com a lista vazia (auditoria de 2026-09-29).
test('lista-estados: countryId que não é número positivo é o 400 de país ausente, antes do Waze', async () => {
  // '1e400' e '30abc' o `parseInt` lia como 1 e 30; 1.5 não é país.
  for (const v of ['abc', true, [], {}, 'NaN', 0, -5, '', null, undefined, '0x1e', '1e400', '30abc', 1.5, [30], Infinity]) {
    const s = await sessaoDeTeste(COOKIES);
    const { r, chamadas } = await comWaze(naoPodiaIrAoWaze,
      () => dispatch('lista-estados', { ...s.dados, region: 'row', countryId: v }, s.ctx));
    assert.equal(r.status, 400, `countryId ${JSON.stringify(v)}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
    assert.equal(r.body.errorKey, 'srv.err.countryRequired', `countryId ${JSON.stringify(v)}`);
    assert.equal(chamadas.length, 0, `countryId ${JSON.stringify(v)} foi ao Waze`);
  }
  // CONTROLE: o país de verdade (número ou texto de dígitos) vai, e com ele.
  for (const v of [30, '30']) {
    const s = await sessaoDeTeste(COOKIES);
    const { r, chamadas } = await comWaze(() => json({ states: [{ id: 1, name: 'SP', countryId: 30 }] }),
      () => dispatch('lista-estados', { ...s.dados, region: 'row', countryId: v }, s.ctx));
    assert.equal(r.status, 200, `CONTROLE (${JSON.stringify(v)}): ${JSON.stringify(r.body)}`);
    assert.match(chamadas[0].url, /[?&]countryId=30$/, `CONTROLE (${JSON.stringify(v)}): ${chamadas[0].url}`);
    assert.deepEqual(r.body.states.map((e) => e.name), ['SP']);
  }
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

import vm from 'node:vm';

// O `msgDoServidor` do app.js de verdade, rodando sobre o i18n.js de verdade
// num idioma: é o que a tela de entrar mostra (`authenticateWithCookies`).
const I18N_JS = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
const APP_JS = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
function msgDoServidorEm(lang) {
  const i = APP_JS.search(/^function msgDoServidor\(/m);
  assert.ok(i >= 0, 'msgDoServidor sumiu do app.js');
  let prof = 0, fim = -1;
  for (let j = APP_JS.indexOf('{', i); j < APP_JS.length; j++) {
    if (APP_JS[j] === '{') prof++;
    else if (APP_JS[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const ctx = {
    navigator: { language: lang, onLine: true },
    document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: (k) => (k === 'waze_places_lang' ? lang : null), setItem() {}, removeItem() {} },
    console, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  // `setLang` como o app faz na abertura: o i18n.js nasce em português.
  vm.runInContext(I18N_JS + '\n' + APP_JS.slice(i, fim) + `\nsetLang(${JSON.stringify(lang)}); this.msg = msgDoServidor;`, ctx);
  return ctx.msg;
}

test('login: Waze fora do ar é erro PASSAGEIRO e traduzido — não 400 com frase em português', async () => {
  const emIngles = msgDoServidorEm('en');
  for (const [nome, responder, chave] of [
    ['HTTP 502', () => new Response('bad gateway', { status: 502 }), 'srv.err.wazeDown'],
    ['HTTP 429', () => json({}, 429), 'srv.err.wazeDown'],
    ['rede caiu', () => { throw new TypeError('fetch failed'); }, 'srv.err.connection'],
  ]) {
    const s = await sessaoDeTeste(COOKIES);
    const { r } = await comWaze(responder, () => dispatch('testar-cookies', { cookies: COOKIES, region: 'row' }, s.ctx));
    assert.ok(r.status >= 500, `${nome}: HTTP ${r.status} — falha do Waze não é "pedido errado"`);
    assert.equal(r.body.errorCategory, 'transient', nome);
    assert.equal(r.body.errorKey, chave, nome);
    assert.equal(r.body.sessionToken, undefined, `${nome}: criou sessão sem o Waze responder`);
    const tela = emIngles(r.body, 'fallback');
    assert.doesNotMatch(tela, /Erro|Servidor|conex/, `${nome}: em inglês, a tela de entrar mostrou português: "${tela}"`);
    assert.notEqual(tela, 'fallback', `${nome}: a tela caiu no texto genérico`);
  }
  // Não passageiro: erro inesperado do Waze — nunca "place não existe mais" nem
  // "já tratado", que são categorias de AÇÃO e não significam nada no login.
  for (const status of [404, 409, 418]) {
    const s = await sessaoDeTeste(COOKIES);
    const { r } = await comWaze(() => json({ erro: 'x' }, status), () => dispatch('testar-cookies', { cookies: COOKIES, region: 'row' }, s.ctx));
    assert.equal(r.body.errorKey, 'srv.err.wazeUnknown', `HTTP ${status}: ${r.body.errorKey}`);
    assert.equal(r.body.errorCategory, 'unknown', `HTTP ${status}`);
    assert.deepEqual(r.body.errorVars, { code: status });
  }
  // CONTROLE: cookie que não vale continua sendo "cookies expirados" (400) — é
  // o texto que a extensão lê pra não insistir, e o que a pessoa pode corrigir.
  const s = await sessaoDeTeste(COOKIES);
  const { r } = await comWaze(() => json({}, 403), () => dispatch('testar-cookies', { cookies: COOKIES, region: 'row' }, s.ctx));
  assert.equal(r.status, 400);
  assert.equal(r.body.errorKey, 'srv.err.cookiesExpiredRelogin');
  assert.match(r.body.error, /expirad/, 'a extensão decide "não está logado no WME" por este texto');
});

// O Waze respondendo 200 com algo que NÃO é o perfil — a página HTML de um
// desafio, `null`, um objeto sem o nome. O login dava 400 ("o pedido está
// errado") sem `errorCategory`, e as outras rotas, 500 (auditoria de
// 2026-09-29). É falha do Waze, não dos cookies da pessoa, e a tela de entrar
// e a extensão têm que ler assim.
test('login: Waze 200 com corpo que não é o perfil é 500 `unknown` — a tela diz "resposta inesperada", nunca "cookies inválidos"', async () => {
  // A extensão (`extensao-chrome/background.js`) decide "não está logado no WME"
  // casando o TEXTO do erro. Até ela ser republicada decidindo pela categoria,
  // a frase crua não pode casar — senão ela desiste dizendo que a pessoa não
  // está logada, quando quem falhou foi o Waze.
  const EXT = readFileSync(new URL('../extensao-chrome/background.js', import.meta.url), 'utf8');
  const semLoginDaExtensao = /expirad|inválid|invalid|csrf/i;
  assert.ok(EXT.includes('/expirad|inválid|invalid|csrf/i.test('),
    'CONTROLE: a extensão mudou o jeito de decidir "sem login" — reveja a frase crua e este teste');
  const telas = Object.fromEntries(['pt', 'en', 'es', 'fr'].map((l) => [l, msgDoServidorEm(l)]));
  for (const [nome, corpo] of [['página HTML', '<!doctype html><html><body>Unusual traffic</body></html>'],
    ['null', 'null'], ['objeto sem userName', '{}'], ['lista', '[]']]) {
    const s = await sessaoDeTeste(COOKIES);
    const { r } = await comWaze(() => new Response(corpo, { status: 200, headers: { 'content-type': 'text/html' } }),
      () => dispatch('testar-cookies', { cookies: COOKIES, region: 'row' }, s.ctx));
    assert.equal(r.status, 500, `${nome}: HTTP ${r.status} — falha do Waze não é "pedido errado"`);
    assert.equal(r.body.errorCategory, 'unknown', `${nome}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.errorKey, 'srv.err.badWazeResponse', nome);
    assert.equal(r.body.sessionToken, undefined, `${nome}: criou sessão sem perfil`);
    // A tela de entrar (`authenticateWithCookies` → `msgDoServidor`), nas 4 línguas.
    for (const [lang, tela] of Object.entries(telas)) {
      const vista = tela(r.body, 'FALLBACK');
      assert.notEqual(vista, 'FALLBACK', `${nome}, ${lang}: a tela caiu no texto genérico ("cookies inválidos")`);
      assert.doesNotMatch(vista, /cookie/i, `${nome}, ${lang}: a tela culpou os cookies: "${vista}"`);
      assert.match(vista, /Waze/, `${nome}, ${lang}: a tela não diz que foi o Waze: "${vista}"`);
    }
    assert.doesNotMatch(r.body.error, semLoginDaExtensao, `${nome}: a extensão leria "${r.body.error}" como falta de login`);
  }
  // CONTROLE: o perfil de verdade passa, e cookie que não vale segue "sem login".
  const s = await sessaoDeTeste(COOKIES);
  const ok = await comWaze(() => json({ id: 1, userName: 'x', rank: 5, isAreaManager: true, isStaff: false }),
    () => dispatch('testar-cookies', { cookies: COOKIES, region: 'row' }, s.ctx));
  assert.equal(ok.r.body.success, true, `CONTROLE: o perfil de verdade não entrou: ${JSON.stringify(ok.r.body)}`);
  const recusado = await comWaze(() => json({}, 403), () => dispatch('testar-cookies', { cookies: COOKIES, region: 'row' }, s.ctx));
  assert.match(recusado.r.body.error, semLoginDaExtensao, 'CONTROLE: o cookie recusado deixou de ser "sem login" pra extensão');
});

test('core: toda apiError leva errorKey — frase crua do servidor chega em português em qualquer idioma', () => {
  // A do login era a única sem chave, e o app a mostrava como veio. Linha de
  // comentário não conta (gotcha #67), nem a definição da própria função.
  const core = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');
  const chamadas = core.split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .filter((l) => /\bapiError\(/.test(l) && !/const apiError = /.test(l));
  assert.ok(chamadas.length >= 20, `achei só ${chamadas.length} apiError — o varredor quebrou, não o core`);
  const semChave = chamadas.filter((l) => !/'srv\.err\.[a-zA-Z]+'/.test(l)).map((l) => l.trim());
  assert.deepEqual(semChave, [],
    'apiError sem `srv.err.*` na mesma linha: o app mostra a frase portuguesa do servidor em qualquer idioma');
});

import * as grpc from '../server/wme-grpc.mjs';

test('presenca-waze: resposta gRPC cortada no meio (sem trailer, HTTP 200) é erro passageiro, não lista pela metade', async () => {
  const s = await sessaoDeTeste(COOKIES);
  const editor = (id) => grpc.campo.msg(1, grpc.junta(grpc.campo.inteiro(1, id), grpc.campo.bool(3, true), grpc.campo.texto(4, 'ed' + id)));
  const lista = grpc.junta(editor(1), editor(2), editor(3), editor(4));
  // Cabeçalho do quadro com o tamanho DECLARADO, seguido dos bytes que vieram.
  const quadro = (declarado, corpo) => {
    const q = new Uint8Array(5 + corpo.length);
    new DataView(q.buffer).setUint32(1, declarado);
    q.set(corpo, 5);
    return q;
  };
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const pedir = (texto) => comWaze(() => new Response(texto, { status: 200 }),
    () => dispatch('presenca-waze', { ...s.dados, region: 'row', caixa: [-50, -30, -40, -20] }, s.ctx));
  // O corte cai numa divisa de campo (2 dos 4 editores): o protobuf que sobra
  // é VÁLIDO, então só o tamanho do quadro denuncia.
  const metade = lista.subarray(0, lista.length / 2);
  assert.doesNotThrow(() => grpc.lerCampos(metade), 'pré-condição: a metade tinha que ser protobuf válido');
  const { r } = await pedir(b64(quadro(lista.length, metade)));
  assert.equal(r.body.success, false, `a metade da lista virou a lista: ${JSON.stringify(r.body.editores)}`);
  assert.equal(r.body.errorCategory, 'transient', 'cortar no meio é de rede');
  // CONTROLE: a lista inteira, do mesmo jeito (sem trailer), é lida com os 4.
  const inteira = await pedir(b64(quadro(lista.length, lista)));
  assert.equal(inteira.r.body.success, true, JSON.stringify(inteira.r.body));
  assert.deepEqual(inteira.r.body.editores.map((e) => e.id), [1, 2, 3, 4]);
});

test('perfil: a caixa da área sai de Polygon E de MultiPolygon, e anel enorme não derruba o perfil', async () => {
  // A caixa vira o filtro do "Minha área" no app. Lia `coordinates[0]` como se
  // toda área fosse Polygon (MultiPolygon dava `[null, null, null, null]`), e o
  // `Math.min(...lista)` estourava a pilha num anel grande (o perfil em 500).
  const bboxDe = async (geometry) => {
    const s = await sessaoDeTeste(COOKIES);
    const { r } = await comWaze(() => json({ id: 1, userName: 'x', rank: 5, isAreaManager: true, isStaff: false, areas: [{ type: 'drive', geometry }] }),
      () => dispatch('perfil', { ...s.dados, region: 'row' }, s.ctx));
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 120));
    return r.body.profile.areas[0].bbox;
  };
  const anel = [[-47, -23], [-46, -23], [-46, -22], [-47, -22], [-47, -23]];
  const outro = [[-40, -10], [-39, -10], [-39, -9], [-40, -10]];
  // CONTROLE: o Polygon, que sempre funcionou.
  assert.deepEqual(await bboxDe({ type: 'Polygon', coordinates: [anel] }), [-47, -23, -46, -22]);
  // MultiPolygon: a caixa cobre as DUAS partes.
  assert.deepEqual(await bboxDe({ type: 'MultiPolygon', coordinates: [[anel], [outro]] }), [-47, -23, -39, -9]);
  // 200 mil vértices num anel só.
  const grande = Array.from({ length: 200_000 }, (_, i) => [-47 + i * 1e-6, -23 + (i % 2) * 1e-3]);
  assert.deepEqual(await bboxDe({ type: 'Polygon', coordinates: [grande] }), [-47, -23, -47 + 199_999 * 1e-6, -23 + 1e-3]);
  // Sem coordenada: sem caixa (o app cai pra outra área), nunca caixa de NaN.
  assert.equal(await bboxDe(null), null);
  assert.equal(await bboxDe({ type: 'Polygon', coordinates: [] }), null);
});

// ── o 413 da VM chega a quem mandou o corpo grande ──────────────────────────
// O `readBody` respondia o 413 e chamava `req.destroy()` na linha seguinte:
// com o corpo ainda chegando, fechar assim é RST, e o RST apaga no cliente a
// resposta que ele ainda não leu. Medido (8 MB): de 11% a 46% dos pedidos
// terminavam sem o 413 (auditoria de 2026-09-26). Ver a tabela no corpo.mjs.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { request as pedidoHttp, Agent } from 'node:http';
import { MAX_BODY_BYTES } from '../server/corpo.mjs';

// O servidor em PROCESSO PRÓPRIO, com o `readBody` de verdade, na porta que o
// sistema der (0 — não disputa porta com nenhum outro teste). Processo próprio
// porque é assim que a VM roda, e é o que muda o resultado: com cliente e
// servidor no MESMO processo, o fechamento que o Node faz sozinho depois de um
// `Connection: close` passava (0 perdas em mais de 1.000) — em processos
// separados ele perdia até 8,5%. Instrumento que não reproduz o defeito aprova conserto pela
// metade (gotcha #28). Cada conexão fechada no servidor vira uma linha com os
// bytes que ele leu dela.
async function vmComReadBody(fn) {
  const codigo = `
    import { createServer } from 'node:http';
    import { readBody } from ${JSON.stringify(pathToFileURL(new URL('../server/corpo.mjs', import.meta.url).pathname).href)};
    const srv = createServer(async (req, res) => {
      req.socket.once('close', () => console.log(JSON.stringify({ fechou: req.socket.bytesRead })));
      const raw = await readBody(req, res);
      if (raw === null) return;
      res.writeHead(200);
      res.end('ok');
    });
    srv.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ porta: srv.address().port })));
  `;
  const p = spawn(process.execPath, ['--input-type=module', '-e', codigo], { stdio: ['ignore', 'pipe', 'inherit'] });
  const fechados = [];
  let resto = '';
  let avisarPorta;
  const porta = new Promise((ok) => { avisarPorta = ok; });
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    resto += d;
    let n;
    while ((n = resto.indexOf('\n')) >= 0) {
      const linha = JSON.parse(resto.slice(0, n));
      resto = resto.slice(n + 1);
      if (linha.porta) avisarPorta(linha.porta);
      if (linha.fechou !== undefined) fechados.push(linha.fechou);
    }
  });
  try {
    return await fn(await porta, fechados);
  } finally {
    p.kill();
  }
}
// O corpo, alocado UMA vez por tamanho: encher 8 MB a cada pedido custava mais
// que o pedido.
const corpos = new Map();
const corpoDe = (bytes) => corpos.get(bytes) || corpos.set(bytes, Buffer.alloc(bytes, 0x61)).get(bytes);
// POST com um corpo de `bytes`, todo de uma vez (um upload rápido). Resolve com
// a resposta, ou com o código do erro se ela não chegou.
function postGrande(porta, bytes, agent) {
  return new Promise((ok) => {
    const r = pedidoHttp({ host: '127.0.0.1', port: porta, method: 'POST', path: '/api/sessao', agent,
      headers: { 'Content-Type': 'application/json', 'Content-Length': bytes } }, (res) => {
      let corpo = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { corpo += c; });
      res.on('end', () => ok({ status: res.statusCode, corpo, conexao: res.headers.connection }));
      res.on('error', (e) => ok({ erro: e.code || e.message }));
    });
    r.on('error', (e) => ok({ erro: e.code || e.message }));
    r.on('socket', (s) => s.on('error', () => {}));
    r.end(corpoDe(bytes));
  });
}
async function fetchGrande(porta, bytes) {
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/api/sessao`, { method: 'POST', body: corpoDe(bytes),
      headers: { 'Content-Type': 'application/json' } });
    return { status: r.status, corpo: await r.text() };
  } catch (e) {
    return { erro: e.cause?.code || e.message };
  }
}

test('VM: o 413 do corpo grande CHEGA — não se perde no corte da conexão', { timeout: 120_000 }, async () => {
  // Dois clientes keep-alive, como o navegador: o `fetch` (o que mais perdia
  // com o fechamento pela metade) e o `node:http` com agente keep-alive.
  const N = 100;
  const agente = new Agent({ keepAlive: true });
  try {
    await vmComReadBody(async (porta) => {
      for (const [nome, mandar] of [['fetch', () => fetchGrande(porta, MAX_BODY_BYTES + 3_000_000)],
        ['node:http', () => postGrande(porta, MAX_BODY_BYTES + 3_000_000, agente)]]) {
        const desfechos = {};
        for (let i = 0; i < N; i++) {
          const r = await mandar();
          const chave = r.erro ? 'erro ' + r.erro : 'HTTP ' + r.status;
          desfechos[chave] = (desfechos[chave] || 0) + 1;
          if (!r.erro) assert.equal(JSON.parse(r.corpo).success, false, `${nome}: o 413 veio sem o corpo JSON`);
        }
        assert.deepEqual(desfechos, { 'HTTP 413': N }, `${nome}, ${N} corpos de 8 MB: ${JSON.stringify(desfechos)}`);
      }
    });
  } finally {
    agente.destroy();
  }
});

test('VM: depois do 413 o servidor lê o resto do corpo até um TETO, e só então fecha', { timeout: 60_000 }, async () => {
  // As duas metades do fechamento em duas etapas, conferidas no SERVIDOR (os
  // bytes que ele leu da conexão antes de fechá-la), o que é determinístico
  // onde a entrega do 413 é estatística:
  //   · corpo um pouco acima do limite (8 MB): lido ATÉ O FIM antes de fechar
  //     — fechar antes é o RST que apaga a resposta no cliente;
  //   · corpo enorme (64 MB): o dreno tem teto, e a conexão fecha bem antes do
  //     fim — o 413 existe pra PARAR de receber.
  // E o 413 avisa `Connection: close`: sem ele, um cliente keep-alive (o
  // navegador) contaria com a conexão pro pedido seguinte.
  const agente = new Agent({ keepAlive: true });
  try {
    await vmComReadBody(async (porta, fechados) => {
      for (const [total, leuTudo] of [[MAX_BODY_BYTES + 3_000_000, true], [64_000_000, false]]) {
        const antes = fechados.length;
        const r = await postGrande(porta, total, agente);
        assert.equal(r.status, 413, JSON.stringify(r));
        assert.equal(r.conexao, 'close', 'o 413 não avisa que a conexão fecha — um cliente keep-alive a reusaria');
        for (let i = 0; i < 100 && fechados.length === antes; i++) await new Promise((ok) => setTimeout(ok, 50));
        assert.equal(fechados.length, antes + 1, `${total} bytes: a conexão seguiu aberta depois do 413`);
        const lidos = fechados[antes];
        if (leuTudo) assert.ok(lidos >= total, `${total} bytes: o servidor fechou com ${lidos} lidos — o resto chegou num socket fechado (RST)`);
        else assert.ok(lidos < total / 2, `${total} bytes: o servidor leu ${lidos} depois de recusar o corpo`);
      }
    });
  } finally {
    agente.destroy();
  }
});

// ── o 413 é o MESMO nos dois adaptadores ─────────────────────────────────────
// O Worker lia o corpo inteiro com `request.json()`: o mesmo POST de 5,5 MB
// (e o de 20) dava 200 lá e 413 na VM — o app deixando de ser o mesmo nos dois
// destinos (gotcha #14; auditoria de 2026-09-29, MEDIDO no `wrangler dev`). O
// teto e a resposta moram no core, e os dois adaptadores os importam.
import { RESPOSTA_CORPO_GRANDE } from '../server/core.mjs';

function envDoWorker() {
  const kv = new Map();
  const ops = { n: 0 };
  return {
    ops,
    env: {
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      SESSIONS: {
        get: async (k) => { ops.n++; return kv.get(k) ?? null; },
        put: async (k, v) => { ops.n++; kv.set(k, v); },
        delete: async (k) => { ops.n++; kv.delete(k); },
      },
      ASSETS: { fetch: () => new Response('asset') },
    },
  };
}

test('Worker: corpo acima do teto é 413 com o MESMO JSON da VM — pelo content-length e pelo corpo em pedaços', async () => {
  const { default: worker } = await import('../worker/index.mjs');
  const url = 'https://app.exemplo/api/sessao';
  const conferir = async (res, rotulo) => {
    assert.equal(res.status, 413, `${rotulo}: HTTP ${res.status}`);
    assert.deepEqual(await res.json(), { ...RESPOSTA_CORPO_GRANDE }, `${rotulo}: o corpo do 413 não é o da VM`);
    assert.equal(res.headers.get('cache-control'), 'no-store', rotulo);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', rotulo);
  };

  // (a) Corpo JSON VÁLIDO acima do teto, com o `content-length` que o navegador manda.
  const grande = JSON.stringify({ action: 'destroy', sessionToken: 'x', lixo: 'a'.repeat(MAX_BODY_BYTES) });
  const a = envDoWorker();
  await conferir(await worker.fetch(new Request(url, {
    method: 'POST', body: grande, headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(grande)) },
  }), a.env, {}), 'content-length');
  assert.equal(a.ops.n, 0, 'o corpo grande chegou ao handler (o KV foi consultado)');
  // E o declarado decide SEM ler: nem um pedaço do corpo é pedido.
  let puxadosComTamanho = 0;
  const naoLeia = new ReadableStream({ pull(c) { puxadosComTamanho++; c.enqueue(new Uint8Array(1000)); } }, { highWaterMark: 0 });
  await conferir(await worker.fetch(new Request(url, {
    method: 'POST', body: naoLeia, duplex: 'half', headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) },
  }), envDoWorker().env, {}), 'content-length, sem ler');
  assert.equal(puxadosComTamanho, 0, `com o tamanho declarado acima do teto, o Worker leu ${puxadosComTamanho} pedaços do corpo`);

  // (b) Corpo em pedaços, SEM `content-length`: conta o que chega e para no teto,
  // sem ler o resto (o que ainda não veio nem é pedido).
  const PEDACO = 1_000_000;
  const TOTAL = 20;
  let puxados = 0;
  const fluxo = new ReadableStream({
    pull(c) {
      if (puxados >= TOTAL) { c.close(); return; }
      puxados++;
      c.enqueue(new Uint8Array(PEDACO).fill(0x61));
    },
  }, { highWaterMark: 0 });
  const b = envDoWorker();
  await conferir(await worker.fetch(new Request(url, { method: 'POST', body: fluxo, duplex: 'half' }), b.env, {}), 'em pedaços');
  assert.equal(b.ops.n, 0, 'o corpo em pedaços chegou ao handler');
  assert.ok(puxados < TOTAL, `o Worker leu os ${TOTAL} MB inteiros antes de recusar (${puxados} pedaços)`);

  // CONTROLE: logo abaixo do teto o pedido passa, e o handler roda.
  const cabe = JSON.stringify({ action: 'destroy', sessionToken: 'x', lixo: 'a'.repeat(MAX_BODY_BYTES - 200) });
  assert.ok(Buffer.byteLength(cabe) <= MAX_BODY_BYTES, 'CONTROLE: o corpo "que cabe" não cabe');
  const c = envDoWorker();
  const ok = await worker.fetch(new Request(url, { method: 'POST', body: cabe, headers: { 'Content-Type': 'application/json' } }), c.env, {});
  assert.equal(ok.status, 200, `CONTROLE: o corpo abaixo do teto não passou (HTTP ${ok.status})`);
  assert.ok(c.ops.n > 0, 'CONTROLE: o handler não rodou');
  // E o BOM do começo segue sendo tirado, como o `request.json()` tirava.
  const d = envDoWorker();
  const comBom = await worker.fetch(new Request(url, { method: 'POST',
    body: new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(JSON.stringify({ action: 'destroy', sessionToken: 'x' }))]) }), d.env, {});
  assert.equal((await comBom.json()).success, true, 'o corpo com BOM deixou de ser lido');
});

test('VM: o 413 do readBody é o MESMO JSON do Worker (o do core)', async () => {
  const req = new EventEmitter();
  req.destroy = () => {};
  req.socket = { destroy() {}, end() {} };
  const res = { headersSent: false, status: null, corpo: null,
    writeHead(s) { this.status = s; this.headersSent = true; }, end(c) { this.corpo = c; } };
  const lido = readBody(req, res);
  req.emit('data', Buffer.alloc(MAX_BODY_BYTES + 1, 0x61));
  assert.equal(await lido, null);
  assert.equal(res.status, 413);
  assert.deepEqual(JSON.parse(res.corpo), { ...RESPOSTA_CORPO_GRANDE });
});
