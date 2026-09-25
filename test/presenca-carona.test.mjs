// A presença DE CARONA nas ações (fase 2): `validar-place` e `marcar-lido`
// aceitam `presenca` e escrevem a posição do card no WME na MESMA ida.
//
// O Waze de mentira responde as DUAS naturezas de chamada que a ação faz — o
// JSON da ação (`/Features`, `/Issues/Read`) e o gRPC-web da presença — e
// anota tudo, com o momento de cada pedido. Os corpos de erro são os MEDIDOS
// (os mesmos de `core.test.mjs` e `presenca-chat-waze.test.mjs`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { dispatch, makeSessions, base64ToBytes } from '../server/core.mjs';
import { sessaoDeTeste } from './_sessao.mjs';
import * as g from '../server/wme-grpc.mjs';
import { temMarcaDaApp, paisDaMarca, marcarPosicao } from '../server/marca-app.mjs';

const NETSCAPE = (name, value) => `.waze.com\tTRUE\t/\tTRUE\t9999999999\t${name}\t${value}`;
const COOKIES = [NETSCAPE('_csrf_token', 'csrf-de-teste'), NETSCAPE('_web_session', 'sessao-original')].join('\n');
// Toda rota exige sessão de verdade (ver test/_sessao.mjs e `resolveCookies`).
const S = await sessaoDeTeste(COOKIES);
const um = (campos, n) => campos.find((c) => c.n === n)?.v;
const assinado = (v) => Number(BigInt.asIntN(64, BigInt(v)));
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function quadro(flag, corpo) {
  const q = new Uint8Array(5 + corpo.length);
  q[0] = flag;
  new DataView(q.buffer).setUint32(1, corpo.length);
  q.set(corpo, 5);
  return q;
}
function respostaGrpc({ dados = null, status = 0, mensagem = '', setCookie = null } = {}) {
  const trailer = new TextEncoder().encode(`grpc-status:${status}\r\ngrpc-message:${encodeURIComponent(mensagem)}\r\n`);
  const corpo = (dados ? b64(quadro(0, dados)) : '') + b64(quadro(0x80, trailer));
  const h = new Headers({ 'content-type': 'application/grpc-web-text+proto' });
  if (setCookie) h.append('set-cookie', setCookie);
  return new Response(corpo, { status: 200, headers: h });
}
function respostaJson(status, corpo, setCookie = null) {
  const h = new Headers({ 'content-type': 'application/json' });
  if (setCookie) h.append('set-cookie', setCookie);
  return new Response(corpo, { status, headers: h });
}
// O registro que o Waze devolve ao atualizar: a pessoa, com a posição gravada.
function eco({ lat, lon, id = 12444348 }) {
  return g.junta(
    g.campo.inteiro(1, id),
    g.campo.msg(2, g.campo.inteiro(101, Math.round(lon * 1e6)), g.campo.inteiro(102, Math.round(lat * 1e6))),
    g.campo.bool(3, true),
    g.campo.texto(4, 'antigerme'),
    g.campo.inteiro(5, 5),
  );
}
// Lê a escrita da presença que a rota mandou: id, posição (em µ°) e máscara.
function lerEscrita(corpoPedido) {
  const raiz = g.lerCampos(g.lerRespostaGrpcWeb(corpoPedido).dados);
  const editor = g.lerCampos(um(raiz, 1));
  const loc = um(editor, 2) ? g.lerCampos(um(editor, 2)) : null;
  const caminhos = raiz.filter((c) => c.n === 2).flatMap((c) => g.lerCampos(c.v)).map((c) => new TextDecoder().decode(c.v));
  const vis = um(editor, 3);
  return {
    userId: String(um(editor, 1)),
    lat: loc ? assinado(um(loc, 102)) / 1e6 : null,
    lon: loc ? assinado(um(loc, 101)) / 1e6 : null,
    visivel: vis === undefined ? undefined : vis !== 0n,
    caminhos,
  };
}

// Troca o fetch. Desde a fase 3 a carona faz TRÊS leituras/escritas no Waze
// além da ação, e cada uma tem seu responder:
//   `acao`      — o JSON da ação (`/Features`, `/Issues/Read`);
//   `presenca`  — a ESCRITA da posição (`updateOnlineEditor`);
//   `lista`     — quem está online (`listOnlineEditors`), padrão: ninguém;
//   `conversas` — as conversas (`ListConversations`, no `-wmp`), padrão: nenhuma.
// Cada pedido é anotado com o `tipo` e o instante em que SAIU.
const LISTA_VAZIA = () => respostaGrpc({});
const CONVERSAS_VAZIAS = () => respostaGrpc({});
function tipoDoPedido(u) {
  if (u.includes('/updateOnlineEditor')) return 'escrita';
  if (u.includes('/listOnlineEditors')) return 'lista';
  if (u.includes('-wmp/')) return 'conversas';
  return 'acao';
}
async function comWaze({ acao, presenca, lista = LISTA_VAZIA, conversas = CONVERSAS_VAZIAS }, fn) {
  const original = globalThis.fetch;
  const pedidos = [];
  const t0 = Date.now();
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const tipo = tipoDoPedido(u);
    const grpc = tipo !== 'acao';
    const p = { url: u, grpc, tipo, t: Date.now() - t0, init, corpo: init && init.body };
    pedidos.push(p);
    const r = await ({ acao, escrita: presenca, lista, conversas })[tipo](p);
    p.respondidoEm = Date.now() - t0;
    return r;
  };
  try {
    return { resultado: await fn(), pedidos };
  } finally {
    globalThis.fetch = original;
  }
}

const PRESENCA = { userId: '12444348', lat: -12.597498, lon: -39.511208, pais: 30 };
const ACAO_OK = () => respostaJson(200, '{}');
const PRESENCA_OK = (p) => {
  const e = lerEscrita(p.corpo);
  return respostaGrpc({ dados: eco({ lat: e.lat, lon: e.lon }) });
};

for (const [rota, extra, caminhoDaAcao] of [
  ['validar-place', { venueID: 'v1', updateRequestID: 'ur1' }, '/app/Features?'],
  ['marcar-lido', { venueID: 'v1', updateRequestID: 'ur1' }, '/Issues/Read'],
]) {
  test(`${rota}: com presenca → a ação E a escrita no WME, com a posição MARCADA e o país`, async () => {
    const { resultado, pedidos } = await comWaze({ acao: ACAO_OK, presenca: PRESENCA_OK },
      () => dispatch(rota, { ...S.dados, region: 'row', ...extra, presenca: PRESENCA }, S.ctx));
    assert.equal(resultado.status, 200, JSON.stringify(resultado.body));
    assert.equal(resultado.body.success, true);
    assert.deepEqual(resultado.body.presenca, { ok: true, marca: true });
    // Fase 3: além da ação e da escrita, a carona LÊ quem usa o app e as
    // conversas — uma chamada de cada, nem mais nem menos.
    assert.deepEqual(pedidos.map((p) => p.tipo).sort(), ['acao', 'conversas', 'escrita', 'lista'],
      'devia sair a ação, a escrita e as duas leituras do app, uma de cada');
    // As contagens (o PORQUÊ da lista, pro diagnóstico) vêm junto: zero aqui
    // porque o Waze de mentira devolve as duas listas vazias.
    assert.deepEqual(resultado.body.presencaApp, { online: [], conversas: [], contagem: { online: { noWme: 0, comMarca: 0, noPais: 0 }, conversas: { noWaze: 0, marcadas: 0, daApp: 0 } } });
    const acao = pedidos.find((p) => p.tipo === 'acao');
    const pres = pedidos.find((p) => p.tipo === 'escrita');
    assert.ok(acao.url.includes(caminhoDaAcao), acao.url);
    assert.equal(pres.url, 'https://www.waze.com/row-Descartes/grpc/com.waze.mapeditor.web.api.MapEditorWebServer/updateOnlineEditor');
    // A ação vai IGUAL à de sempre: a presença não entra no payload do Waze.
    assert.ok(!String(acao.corpo).includes('presenca'), 'a presença vazou pro payload da ação');
    const e = lerEscrita(pres.corpo);
    assert.equal(e.userId, '12444348');
    assert.deepEqual(e.caminhos, ['location'], 'sem pedido de ligar, a carona só move');
    assert.ok(temMarcaDaApp(e), 'a posição foi SEM a marca do app');
    assert.equal(paisDaMarca(e), 30);
    const m = marcarPosicao(PRESENCA, 30);
    assert.equal(Math.round(e.lat * 1e6), Math.round(m.lat * 1e6));
    assert.equal(Math.round(e.lon * 1e6), Math.round(m.lon * 1e6));
  });

  test(`${rota}: sem presenca → UMA chamada, e a resposta não ganha campo novo`, async () => {
    const { resultado, pedidos } = await comWaze({ acao: ACAO_OK, presenca: () => assert.fail('foi ao WME sem carona') },
      () => dispatch(rota, { ...S.dados, region: 'row', ...extra }, S.ctx));
    assert.equal(resultado.status, 200);
    assert.equal(pedidos.length, 1);
    assert.ok(!('presenca' in resultado.body), 'o contrato de quem não manda presença mudou');
  });
}

test('carona: a presença sai JUNTO com a ação (em paralelo), não depois dela', async () => {
  const { pedidos } = await comWaze({
    acao: async () => { await esperar(250); return ACAO_OK(); },
    presenca: PRESENCA_OK,
  }, () => dispatch('validar-place', { ...S.dados, region: 'row', venueID: 'v1', updateRequestID: 'ur1', presenca: PRESENCA }, S.ctx));
  const acao = pedidos.find((p) => p.tipo === 'acao');
  const pres = pedidos.find((p) => p.tipo === 'escrita');
  assert.ok(pres.t < acao.respondidoEm, `a presença só saiu depois da ação (${pres.t} ms × ${acao.respondidoEm} ms)`);
});

test('carona: pedido de ligar vai junto na MESMA escrita (location + visible)', async () => {
  const { resultado, pedidos } = await comWaze({ acao: ACAO_OK, presenca: PRESENCA_OK },
    () => dispatch('marcar-lido', { ...S.dados, region: 'row', venueID: 'v1', updateRequestID: 'ur1', presenca: { ...PRESENCA, visivel: true } }, S.ctx));
  assert.equal(resultado.body.presenca.ok, true);
  const e = lerEscrita(pedidos.find((p) => p.tipo === 'escrita').corpo);
  assert.deepEqual(e.caminhos, ['location', 'visible']);
  assert.equal(e.visivel, true);
});

test('carona: presença que FALHA nunca derruba a ação — e diz por quê', async () => {
  const casos = [
    [() => respostaGrpc({ status: 7, mensagem: '(403) This operation is not allowed by guest user., Code 101' }), 'unauthorized'],
    [() => respostaGrpc({ status: 7, mensagem: "(403) cannot modify another user's data, Code 101" }), 'unknown'],
    [() => respostaGrpc({ status: 14, mensagem: 'unavailable' }), 'transient'],
    [() => { throw new TypeError('fetch failed'); }, 'transient'],
    [() => new Response('<html>502</html>', { status: 502 }), 'transient'],
  ];
  for (const [presenca, categoria] of casos) {
    const { resultado } = await comWaze({ acao: ACAO_OK, presenca },
      () => dispatch('validar-place', { ...S.dados, region: 'row', venueID: 'v1', updateRequestID: 'ur1', presenca: PRESENCA }, S.ctx));
    assert.equal(resultado.status, 200, categoria);
    assert.equal(resultado.body.success, true, `a ação caiu junto com a presença (${categoria})`);
    assert.deepEqual(resultado.body.presenca, { ok: false, categoria });
  }
});

test('carona: a ação falhando segue com o resultado DELA, e a presença vai do mesmo jeito', async () => {
  // Corrida medida: outro editor chegou antes (404 + 702 no Features).
  const { resultado } = await comWaze({
    acao: () => respostaJson(404, JSON.stringify({ errorList: [{ code: 702, details: 'was not found on venue' }] })),
    presenca: PRESENCA_OK,
  }, () => dispatch('validar-place', { ...S.dados, region: 'row', venueID: 'v1', updateRequestID: 'ur1', presenca: PRESENCA }, S.ctx));
  assert.equal(resultado.status, 200);
  assert.equal(resultado.body.success, false);
  assert.equal(resultado.body.errorCategory, 'already_processed');
  assert.deepEqual(resultado.body.presenca, { ok: true, marca: true });
  // E a do marcar-lido (500 + code 300 é corrida, não falha de servidor).
  const lido = await comWaze({
    acao: () => respostaJson(500, JSON.stringify({ errorList: [{ code: 300, details: 'Failed to handle request' }] })),
    presenca: PRESENCA_OK,
  }, () => dispatch('marcar-lido', { ...S.dados, region: 'row', venueID: 'v1', updateRequestID: 'ur1', presenca: PRESENCA }, S.ctx));
  assert.equal(lido.resultado.body.errorCategory, 'already_processed');
  assert.equal(lido.resultado.body.presenca.ok, true);
});

test('carona: presença MALFORMADA é ignorada sem ir ao WME — e a ação sai igual', async () => {
  const ruins = [
    { ...PRESENCA, userId: '12a' },
    { ...PRESENCA, userId: undefined },
    { ...PRESENCA, pais: undefined },
    { ...PRESENCA, pais: 0 },
    { ...PRESENCA, pais: '30' },
    { ...PRESENCA, lat: 91 },
    { ...PRESENCA, lat: '-12.5' },
    { ...PRESENCA, visivel: false },      // desligar NÃO vai de carona
    { ...PRESENCA, visivel: 'true' },     // coerção
    'posição',
    42,
  ];
  for (const presenca of ruins) {
    const { resultado, pedidos } = await comWaze({ acao: ACAO_OK, presenca: () => assert.fail('foi ao WME com presença ruim'),
      lista: () => assert.fail('leu a lista com presença ruim'), conversas: () => assert.fail('leu as conversas com presença ruim') },
      () => dispatch('validar-place', { ...S.dados, region: 'row', venueID: 'v1', updateRequestID: 'ur1', presenca }, S.ctx));
    assert.equal(resultado.body.success, true, JSON.stringify(presenca));
    assert.equal(pedidos.length, 1, JSON.stringify(presenca));
    assert.deepEqual(resultado.body.presenca, { ok: false, categoria: 'invalida' }, JSON.stringify(presenca));
  }
});

test('carona: a validação da AÇÃO vem antes — pedido inválido não move ninguém', async () => {
  const { resultado, pedidos } = await comWaze({ acao: () => assert.fail('foi à ação'), presenca: () => assert.fail('foi à presença') },
    () => dispatch('validar-place', { ...S.dados, region: 'row', updateRequestID: 'ur1', presenca: PRESENCA }, S.ctx));
  assert.equal(resultado.status, 400);
  assert.equal(pedidos.length, 0);
});

test('carona: o eco do Waze CONFERE a marca — posição arredondada vira marca:false', async () => {
  // O dia em que o Waze arredondar a posição, a marca some e a lista do app
  // esvazia. A resposta de cada escrita traz a posição: é ali que se vê.
  const { resultado } = await comWaze({
    acao: ACAO_OK,
    presenca: (p) => {
      const e = lerEscrita(p.corpo);
      return respostaGrpc({ dados: eco({ lat: Number(e.lat.toFixed(4)), lon: Number(e.lon.toFixed(4)) }) });
    },
  }, () => dispatch('validar-place', { ...S.dados, region: 'row', venueID: 'v1', updateRequestID: 'ur1', presenca: PRESENCA }, S.ctx));
  assert.deepEqual(resultado.body.presenca, { ok: true, marca: false });
  // Eco sem posição: não dá pra conferir, e "não sei" não é "perdeu".
  const semPosicao = await comWaze({ acao: ACAO_OK, presenca: () => respostaGrpc({ dados: g.junta(g.campo.inteiro(1, 12444348)) }) },
    () => dispatch('validar-place', { ...S.dados, region: 'row', venueID: 'v1', updateRequestID: 'ur1', presenca: PRESENCA }, S.ctx));
  assert.deepEqual(semPosicao.resultado.body.presenca, { ok: true, marca: null });
});

test('carona: presença LENTA não segura a resposta — teto de espera, e o resto termina em segundo plano', async () => {
  let concluiu = false;
  const fundo = [];
  const t0 = Date.now();
  const { resultado } = await comWaze({
    acao: ACAO_OK,
    presenca: async (p) => { await esperar(4000); concluiu = true; return PRESENCA_OK(p); },
  }, () => dispatch('marcar-lido', { ...S.dados, region: 'row', venueID: 'v1', updateRequestID: 'ur1', presenca: PRESENCA },
    { ...S.ctx, aoFundo: (prom) => fundo.push(prom) }));
  const levou = Date.now() - t0;
  assert.equal(resultado.body.success, true);
  assert.ok(!('presenca' in resultado.body), 'esperou a presença lenta em vez de responder');
  assert.ok(levou < 2500, `a resposta esperou ${levou} ms — o teto é 1,5 s depois da ação`);
  // Duas partes vão ao segundo plano — a escrita e a leitura do app —, cada uma
  // no seu tempo. A leitura (rápida aqui) chega na resposta; a escrita, não.
  assert.equal(fundo.length, 2, 'a carona não entregou as duas partes ao segundo plano');
  assert.deepEqual(resultado.body.presencaApp, { online: [], conversas: [], contagem: { online: { noWme: 0, comMarca: 0, noPais: 0 }, conversas: { noWaze: 0, marcadas: 0, daApp: 0 } } }, 'a leitura rápida ficou presa atrás da escrita lenta');
  assert.equal(concluiu, false);
  const fins = await Promise.all(fundo);
  assert.equal(concluiu, true);
  assert.ok(fins.some((f) => f && f.ok === true && f.marca === true), 'a escrita em segundo plano não terminou direito');
});

test('carona: a região escolhe o servidor da presença (a lista é separada por servidor)', async () => {
  for (const [region, prefixo] of [['na', 'Descartes'], ['il', 'il-Descartes'], ['world', 'Descartes']]) {
    const { pedidos } = await comWaze({ acao: ACAO_OK, presenca: PRESENCA_OK },
      () => dispatch('validar-place', { ...S.dados, region, venueID: 'v1', updateRequestID: 'ur1', presenca: PRESENCA }, S.ctx));
    assert.equal(pedidos.find((p) => p.tipo === 'escrita').url,
      `https://www.waze.com/${prefixo}/grpc/com.waze.mapeditor.web.api.MapEditorWebServer/updateOnlineEditor`, region);
    // A lista de quem usa o app vem do MESMO servidor da presença.
    assert.equal(pedidos.find((p) => p.tipo === 'lista').url,
      `https://www.waze.com/${prefixo}/grpc/com.waze.mapeditor.web.api.MapEditorWebServer/listOnlineEditors`, region);
  }
});

test('carona: o cookie rotacionado é gravado pela AÇÃO, nunca pela presença', async () => {
  const mem = new Map();
  const store = { get: (h) => mem.get(h) ?? null, put: (h, v) => { mem.set(h, v); }, delete: (h) => { mem.delete(h); } };
  const sessions = makeSessions({ store, keyBytes: crypto.getRandomValues(new Uint8Array(32)) });
  const token = await sessions.createSession(COOKIES);
  // A regravação tem trava de 1 h (`SESSION_COOKIE_REFRESH`) e o `loadSession`
  // só renova o carimbo depois de 1 dia: uma sessão de 2 h atrás é a que
  // ACEITA uma regravação — sessão recém-criada não regravaria nada, e o teste
  // passaria sem provar coisa nenhuma (foi o que o controle acusou).
  for (const [h, v] of mem) mem.set(h, (Math.floor(Date.now() / 1000) - 7200) + v.slice(v.indexOf('|')));
  await comWaze({
    // A presença responde ANTES da ação: se ela carregasse o ctx, gravaria
    // primeiro e a trava de 1 h barraria a gravação da ação.
    acao: async () => { await esperar(200); return respostaJson(200, '{}', '_web_session=rotacionado-pela-acao; path=/; secure; HttpOnly'); },
    presenca: (p) => {
      const e = lerEscrita(p.corpo);
      return respostaGrpc({ dados: eco({ lat: e.lat, lon: e.lon }), setCookie: '_web_session=rotacionado-pela-presenca; path=/; secure; HttpOnly' });
    },
  }, () => dispatch('validar-place', { sessionToken: token, region: 'row', venueID: 'v1', updateRequestID: 'ur1', presenca: PRESENCA }, { sessions }));
  const guardado = await sessions.loadSession(token);
  const texto = typeof guardado === 'string' ? guardado : JSON.stringify(guardado);
  assert.ok(!texto.includes('rotacionado-pela-presenca'), 'a presença regravou o cookie (corrida com a ação)');
  // Controle: a rotação da AÇÃO tem que estar lá — senão o teste acima passaria
  // com qualquer código que simplesmente não regravasse nada.
  assert.ok(texto.includes('rotacionado-pela-acao'), 'a rotação da ação não foi gravada');
});

test('perfil: devolve a chave "visível" do WME, e null quando o Waze não manda', async () => {
  const sessao = (extra) => JSON.stringify({ id: 12444348, userName: 'antigerme', rank: 5, isAreaManager: true, ...extra });
  for (const [corpo, esperado] of [
    [sessao({ onlineEditorDetails: { id: 12444348, visible: true } }), true],
    [sessao({ onlineEditorDetails: { id: 12444348, visible: false } }), false],
    [sessao({ user: { onlineEditorDetails: { visible: true } } }), true],
    [sessao({}), null],
    [sessao({ onlineEditorDetails: { visible: 'true' } }), null],
  ]) {
    const { resultado } = await comWaze({ acao: () => respostaJson(200, corpo), presenca: () => assert.fail('perfil não vai ao gRPC') },
      () => dispatch('perfil', { ...S.dados, region: 'row' }, S.ctx));
    assert.equal(resultado.status, 200);
    assert.equal(resultado.body.visivelNoWme, esperado, corpo);
  }
});

// ── os dois ADAPTADORES ──────────────────────────────────────────────────────
// A carona só termina em segundo plano se o adaptador entregar o `aoFundo`. No
// Worker isso é o `ctx.waitUntil`: sem ele, o runtime da Cloudflare CORTA a
// escrita que passou do teto assim que a resposta sai — e o conserto que vale
// num destino e não no outro é o gotcha #14. O Worker é importado de verdade.
test('Worker: a escrita que passa do teto vai pro ctx.waitUntil (senão a Cloudflare a corta)', async () => {
  const { default: worker } = await import('../worker/index.mjs');
  const kv = new Map();
  const env = {
    ENCRYPTION_KEY: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    SESSIONS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
    ASSETS: { fetch: () => new Response('asset') },
  };
  // A sessão nasce no MESMO KV e com a MESMA chave que o Worker vai usar (o
  // prefixo `sess_` é o do adaptador): é o caminho do app, que entra pelo
  // `testar-cookies` e depois só manda o token.
  const { sessionToken } = await (async () => {
    const sessions = makeSessions({
      store: { get: async (h) => kv.get('sess_' + h) ?? null, put: async (h, v) => { kv.set('sess_' + h, v); }, delete: async (h) => { kv.delete('sess_' + h); } },
      keyBytes: base64ToBytes(env.ENCRYPTION_KEY),
    });
    return { sessionToken: await sessions.createSession(COOKIES) };
  })();
  const entregues = [];
  const ctx = { waitUntil: (p) => entregues.push(p) };
  let concluiu = false;
  const { resultado } = await comWaze({
    acao: ACAO_OK,
    presenca: async (p) => { await esperar(2500); concluiu = true; return PRESENCA_OK(p); },
  }, async () => {
    const req = new Request('https://app.exemplo/api/marcar-lido', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken, region: 'row', venueID: 'v1', updateRequestID: 'ur1', presenca: PRESENCA }),
    });
    const res = await worker.fetch(req, env, ctx);
    return { status: res.status, body: await res.json() };
  });
  assert.equal(resultado.status, 200);
  assert.equal(resultado.body.success, true);
  assert.equal(entregues.length, 2, 'o Worker não entregou a escrita e a leitura ao waitUntil');
  assert.equal(concluiu, false);
  const fins = await Promise.all(entregues);
  assert.ok(fins.some((f) => f && f.ok === true && f.marca === true), 'a escrita entregue ao waitUntil não terminou direito');
  assert.equal(concluiu, true);
});

test('Node: o adaptador da VM também entrega o aoFundo ao dispatch', () => {
  const node = readFileSync(new URL('../server/node.mjs', import.meta.url), 'utf8');
  const cod = node.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(cod, /dispatch\(route, data, \{ sessions, aoFundo \}\)/,
    'a VM chama o dispatch sem o aoFundo: a carona lenta perderia o resultado');
});
