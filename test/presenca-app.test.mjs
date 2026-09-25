// A presença DO APP (fase 3): quem usa o app no país do filtro e as conversas
// que são do app, lidas do WME — pela rota `presenca-app`, de carona nas ações
// e ao abrir uma conversa (`chat` com `acao: 'abrir'`).
//
// O modelo é do owner, e é ele que estes testes travam: a infra é do Waze, mas
// o app mostra SÓ quem usa o app (a marca na posição, `marca-app.mjs`) e SÓ as
// conversas que começaram no app. Conversa de quem só usa o WME não aparece.
//
// O Waze de mentira responde por MÉTODO e anota cada pedido. Os corpos de
// resposta são montados com os mesmos construtores de protobuf do servidor; os
// campos de cada mensagem foram MEDIDOS contra o Waze na fase 1 (ver
// `docs/waze-api.md` §4.1) e o leitor é o mesmo que roda em produção.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { dispatch, filtrarOnlineDaApp, filtrarConversasDaApp, contarOnlineDaApp, contarConversasDaApp, APP_CONTEXTO } from '../server/core.mjs';
import * as g from '../server/wme-grpc.mjs';
import { marcarPosicao } from '../server/marca-app.mjs';
import { readFileSync } from 'node:fs';
import { sessaoDeTeste } from './_sessao.mjs';

const F = JSON.parse(readFileSync(new URL('./wme-grpc.fixture.json', import.meta.url), 'utf8'));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const um = (campos, n) => campos.find((c) => c.n === n)?.v;

const COOKIES = [
  '.waze.com\tTRUE\t/\tTRUE\t0\t_csrf_token\tcsrf-de-teste',
  '.waze.com\tTRUE\t/\tTRUE\t0\t_web_session\tsessao-de-teste',
].join('\n');
// Toda rota exige sessão de verdade (ver test/_sessao.mjs e `resolveCookies`).
const S = await sessaoDeTeste(COOKIES);

const EU = '12444348';
const BRASIL = 30;
const FRANCA = 73;

function quadro(flag, corpo) {
  const q = new Uint8Array(5 + corpo.length);
  q[0] = flag;
  new DataView(q.buffer).setUint32(1, corpo.length);
  q.set(corpo, 5);
  return q;
}
function respostaGrpc({ dados = null, status = 0, mensagem = '' } = {}) {
  const trailer = new TextEncoder().encode(`grpc-status:${status}\r\ngrpc-message:${encodeURIComponent(mensagem)}\r\n`);
  const corpo = (dados ? b64(quadro(0, dados)) : '') + b64(quadro(0x80, trailer));
  return new Response(corpo, { status: 200, headers: { 'content-type': 'application/grpc-web-text+proto' } });
}
function respostaJson(status, corpo) {
  return new Response(corpo, { status, headers: { 'content-type': 'application/json' } });
}

// ── construtores de resposta ─────────────────────────────────────────────────

// Um editor da lista de online: 1 id · 2 posição (101 lon, 102 lat, ×1e6) ·
// 3 visível · 4 nome · 5 rank CRU.
function editor({ id, nome, rank = 2, lat, lon, visivel = true }) {
  return g.junta(
    g.campo.inteiro(1, id),
    g.campo.msg(2, g.campo.inteiro(101, Math.round(lon * 1e6)), g.campo.inteiro(102, Math.round(lat * 1e6))),
    visivel === null ? null : g.campo.bool(3, visivel),
    g.campo.texto(4, nome),
    g.campo.inteiro(5, rank),
  );
}
const lista = (...eds) => g.junta(...eds.map((e) => g.campo.msg(1, editor(e))));

// A mensagem exatamente como o servidor a monta pra enviar (o histórico devolve
// o mesmo registro): tira o campo 2 do pedido de envio.
function msg({ id, ts = 1790182220160, de, para, texto = 'oi', ctx = null }) {
  const corpo = g.corpoEnviarTexto({ cabecalho: null, ts, id, para, de, texto, ctx });
  return um(g.lerCampos(corpo), 2);
}
// Um item da lista de conversas: 1 com quem · 2 perfil (2 = nome) · 3 última ·
// 4 não lidas · 5 bloqueada · 8 atividade.
function conversa({ com, nome, ultima = null, naoLidas = 0, bloqueada = false, atividade = 1790182220160 }) {
  return g.campo.msg(1,
    g.campo.msg(1, g.campo.inteiro(1, 1), g.campo.texto(2, String(com))),
    g.campo.msg(2, g.campo.texto(2, nome)),
    ultima ? g.campo.bytes(3, msg(ultima)) : null,
    naoLidas ? g.campo.inteiro(4, naoLidas) : null,
    bloqueada ? g.campo.bool(5, true) : null,
    g.campo.inteiro(8, atividade));
}
const conversas = (...cs) => g.junta(...cs.map(conversa));

// Uma pessoa no app: posição com a marca e o país dela.
const naApp = (id, nome, pais, lat = -23.55, lon = -46.63, extra = {}) => ({ id, nome, ...marcarPosicao({ lat, lon }, pais), ...extra });
// Quem SÓ usa o WME, no caso que a marca existe pra separar: a longitude cai,
// por acaso, nos dígitos do país (1 em 1000), e só a latitude não tem o 47. Uma
// posição qualquer seria excluída pelo PAÍS e o teste não veria a marca faltar
// — foi o que a sabotagem mostrou na primeira versão.
function soNoWme(id, nome, pais) {
  const { lon } = marcarPosicao({ lat: -23.55, lon: -46.63 }, pais);
  return { id, nome, lat: -23.550001, lon };
}

// O Waze de mentira. `r` responde por método; o que não tem resposta falha o teste.
async function comWaze(r, fn) {
  const original = globalThis.fetch;
  const pedidos = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const metodo = u.split('/').pop();
    // Só o gRPC tem corpo enquadrado; o da ação é JSON.
    const grpc = u.includes('/grpc/') || u.includes('-wmp/');
    const corpo = grpc ? g.lerRespostaGrpcWeb(init.body).dados : null;
    const p = { url: u, metodo, corpo };
    pedidos.push(p);
    const resp = r[metodo];
    if (!resp) assert.fail(`chamada inesperada ao Waze: ${metodo}`);
    return resp(p);
  };
  try {
    return { resultado: await fn(), pedidos };
  } finally {
    globalThis.fetch = original;
  }
}

// ── filtros puros ────────────────────────────────────────────────────────────

test('online do app: só quem tem a marca, no país do filtro, visível — e nunca eu', () => {
  const eds = [
    { id: 183164343, nome: 'cafanha', rank: 4, visivel: true, ...marcarPosicao({ lat: -23.55, lon: -46.63 }, BRASIL) },
    { id: 12444348, nome: 'antigerme', rank: 5, visivel: true, ...marcarPosicao({ lat: -23.5, lon: -46.6 }, BRASIL) },
    { id: 500, nome: 'na_franca', rank: 2, visivel: true, ...marcarPosicao({ lat: 48.85, lon: 2.35 }, FRANCA) },
    { rank: 2, visivel: true, ...soNoWme(501, 'so_wme', BRASIL) },
    { id: 502, nome: 'escondida', rank: 2, visivel: false, ...marcarPosicao({ lat: -22.9, lon: -43.2 }, BRASIL) },
    { id: 503, nome: 'sem_chave', rank: 2, visivel: null, ...marcarPosicao({ lat: -22.9, lon: -43.2 }, BRASIL) },
  ];
  const r = filtrarOnlineDaApp(eds, { pais: BRASIL, eu: EU });
  assert.deepEqual(r.map((e) => e.nome), ['cafanha', 'sem_chave']);
  // Forma: id como TEXTO (o mesmo das conversas), rank CRU (a tela soma 1).
  assert.deepEqual(Object.keys(r[0]).sort(), ['id', 'lat', 'lon', 'nome', 'rank']);
  assert.equal(r[0].id, '183164343');
  assert.equal(r[0].rank, 4);
  // Controle: a pessoa "só no WME" tem a longitude com o país do filtro — é a
  // marca da latitude, e só ela, que a separa. E na França a mesma lista
  // mostra a outra pessoa.
  assert.deepEqual(filtrarOnlineDaApp(eds, { pais: FRANCA, eu: EU }).map((e) => e.nome), ['na_franca']);
});

test('conversas do app: a marca na última mensagem OU já conhecida no aparelho — a do WME não aparece', () => {
  const cs = g.lerConversas(conversas(
    { com: 183164343, nome: 'cafanha', naoLidas: 2, ultima: { id: 'a0000000-0000-1000-8000-000000000001', de: '183164343', para: EU, texto: 'Esse é duplicado?\n📍 Loja · Foto nova\nhttps://www.waze.com/editor?x', ctx: { app: APP_CONTEXTO, legenda: 'Esse é duplicado?', card: JSON.stringify({ name: 'Loja', updateTypeKey: 'NEW_PHOTO' }) } } },
    { com: 600, nome: 'so_wme', ultima: { id: 'a0000000-0000-1000-8000-000000000002', de: '600', para: EU, texto: 'Oi, vi você no mapa' } },
    { com: 601, nome: 'respondeu_pelo_wme', ultima: { id: 'a0000000-0000-1000-8000-000000000003', de: '601', para: EU, texto: 'respondi daqui do WME' } },
    { com: 602, nome: 'bloqueada', bloqueada: true, ultima: { id: 'a0000000-0000-1000-8000-000000000004', de: '602', para: EU, texto: 'x', ctx: { app: APP_CONTEXTO } } },
    { com: 603, nome: 'minha', ultima: { id: 'a0000000-0000-1000-8000-000000000005', de: EU, para: '603', texto: 'mandei eu', ctx: { app: APP_CONTEXTO } } },
  )).conversas;
  const r = filtrarConversasDaApp(cs, { eu: EU, conhecidos: new Set(['601']) });
  assert.deepEqual(r.map((c) => c.nome), ['cafanha', 'respondeu_pelo_wme', 'minha'],
    'a do WME apareceu, ou a que a pessoa respondeu pelo WME sumiu');
  const [caf, , minha] = r;
  assert.equal(caf.id, '183164343');
  assert.equal(caf.naoLidas, 2);
  // A prévia é a PERGUNTA (a legenda), não o texto do Waze com link.
  assert.equal(caf.ultima.texto, 'Esse é duplicado?');
  assert.deepEqual(caf.ultima.card, { name: 'Loja', updateTypeKey: 'NEW_PHOTO' });
  assert.equal(caf.ultima.deMim, false);
  assert.equal(minha.ultima.deMim, true);
  assert.equal(minha.ultima.card, null);
});

// O PORQUÊ da lista vai pro diagnóstico do aparelho (relatório v8): é o que
// separa "ninguém usa o app agora" de "está no app, mas noutro país" e de "a
// conversa não tem a marca nem é conhecida". Com os MESMOS critérios dos
// filtros — contagem e lista que divergissem mandariam procurar defeito à toa.
test('contagens: o PORQUÊ das duas listas, com os mesmos critérios dos filtros', () => {
  const eds = [
    { id: 183164343, nome: 'cafanha', rank: 4, visivel: true, ...marcarPosicao({ lat: -23.55, lon: -46.63 }, BRASIL) },
    { id: 12444348, nome: 'antigerme', rank: 5, visivel: true, ...marcarPosicao({ lat: -23.5, lon: -46.6 }, BRASIL) },
    { id: 500, nome: 'na_franca', rank: 2, visivel: true, ...marcarPosicao({ lat: 48.85, lon: 2.35 }, FRANCA) },
    { rank: 2, visivel: true, ...soNoWme(501, 'so_wme', BRASIL) },
    { id: 502, nome: 'escondida', rank: 2, visivel: false, ...marcarPosicao({ lat: -22.9, lon: -43.2 }, BRASIL) },
    { id: 503, nome: 'sem_chave', rank: 2, visivel: null, ...marcarPosicao({ lat: -22.9, lon: -43.2 }, BRASIL) },
  ];
  // Fora eu e a invisível: cafanha, na_franca, so_wme e sem_chave no WME; três
  // com a marca; duas no Brasil — e na França, uma.
  const br = contarOnlineDaApp(eds, { pais: BRASIL, eu: EU });
  assert.deepEqual(br, { noWme: 4, comMarca: 3, noPais: 2 });
  assert.equal(br.noPais, filtrarOnlineDaApp(eds, { pais: BRASIL, eu: EU }).length, 'a contagem diverge da lista');
  assert.deepEqual(contarOnlineDaApp(eds, { pais: FRANCA, eu: EU }), { noWme: 4, comMarca: 3, noPais: 1 });

  const cs = g.lerConversas(conversas(
    { com: 183164343, nome: 'cafanha', ultima: { id: 'a0000000-0000-1000-8000-000000000001', de: '183164343', para: EU, ctx: { app: APP_CONTEXTO } } },
    { com: 600, nome: 'so_wme', ultima: { id: 'a0000000-0000-1000-8000-000000000002', de: '600', para: EU, texto: 'oi' } },
    { com: 601, nome: 'respondeu_pelo_wme', ultima: { id: 'a0000000-0000-1000-8000-000000000003', de: '601', para: EU, texto: 'x' } },
    { com: 602, nome: 'bloqueada', bloqueada: true, ultima: { id: 'a0000000-0000-1000-8000-000000000004', de: '602', para: EU, ctx: { app: APP_CONTEXTO } } },
    { com: 603, nome: 'minha', ultima: { id: 'a0000000-0000-1000-8000-000000000005', de: EU, para: '603', ctx: { app: APP_CONTEXTO } } },
  )).conversas;
  const conhecidos = new Set(['601']);
  const c = contarConversasDaApp(cs, { conhecidos });
  // A bloqueada não conta em nada; duas com a marca; uma entra por ser conhecida.
  assert.deepEqual(c, { noWaze: 4, marcadas: 2, daApp: 3 });
  assert.equal(c.daApp, filtrarConversasDaApp(cs, { eu: EU, conhecidos }).length, 'a contagem diverge da lista');
});

test('conversas do app: prévia com teto e cartão que não se lê vira null — nunca derruba a lista', () => {
  const cs = g.lerConversas(conversas(
    { com: 700, nome: 'longa', ultima: { id: 'a0000000-0000-1000-8000-000000000006', de: '700', para: EU, texto: 'x'.repeat(900), ctx: { app: APP_CONTEXTO, card: '{isto não é json' } } },
  )).conversas;
  const [c] = filtrarConversasDaApp(cs, { eu: EU, conhecidos: new Set() });
  assert.equal(c.ultima.texto.length, 140);
  assert.equal(c.ultima.card, null);
});

// ── rota presenca-app ────────────────────────────────────────────────────────

const BASE = { ...S.dados, pais: BRASIL, userId: EU };

test('presenca-app: lista e conversas numa ida, em paralelo, no servidor da região — e SEM token sem instalação', { timeout: 5000 }, async () => {
  const soltar = {};
  const chegou = new Set();
  const esperaAsDuas = (m, resp) => (p) => new Promise((ok) => {
    chegou.add(m);
    soltar[m] = () => ok(resp());
    // Só responde quando AS DUAS já saíram: em série, a segunda nunca chega e o teste estoura.
    if (chegou.size === 2) Object.values(soltar).forEach((f) => f());
  });
  const { resultado, pedidos } = await comWaze({
    listOnlineEditors: esperaAsDuas('lista', () => respostaGrpc({ dados: lista(naApp(183164343, 'cafanha', BRASIL)) })),
    ListConversations: esperaAsDuas('conv', () => respostaGrpc({ dados: conversas({ com: 183164343, nome: 'cafanha', ultima: { id: 'a0000000-0000-1000-8000-000000000001', de: '183164343', para: EU, ctx: { app: APP_CONTEXTO } } }) })),
  }, () => dispatch('presenca-app', { ...BASE, region: 'row' }, S.ctx));
  assert.equal(resultado.status, 200, JSON.stringify(resultado.body));
  assert.deepEqual(resultado.body.online.map((e) => e.nome), ['cafanha']);
  assert.deepEqual(resultado.body.conversas.map((c) => c.nome), ['cafanha']);
  assert.ok(!('chat' in resultado.body), 'sem instalação não há token pra devolver');
  assert.deepEqual(resultado.body.contagem, { online: { noWme: 1, comMarca: 1, noPais: 1 }, conversas: { noWaze: 1, marcadas: 1, daApp: 1 } },
    'o PORQUÊ da lista não veio junto');
  assert.deepEqual(pedidos.map((p) => p.metodo).sort(), ['ListConversations', 'listOnlineEditors']);
  // A lista é a do MUNDO: a caixa inteira, e o país sai da marca.
  const caixa = g.lerCampos(um(g.lerCampos(pedidos.find((p) => p.metodo === 'listOnlineEditors').corpo), 1));
  const ponto = (v) => { const c = g.lerCampos(v); return [Number(BigInt.asIntN(64, um(c, 101))) / 1e6, Number(BigInt.asIntN(64, um(c, 102))) / 1e6]; };
  assert.deepEqual([...ponto(um(caixa, 1)), ...ponto(um(caixa, 2))], [-180, -85, 180, 85]);
  assert.match(pedidos.find((p) => p.metodo === 'listOnlineEditors').url, /\/row-Descartes\/grpc\//);
  assert.match(pedidos.find((p) => p.metodo === 'ListConversations').url, /\/row-wmp\//);
});

test('presenca-app: com `token` e a instalação do aparelho, o token do tempo real vem junto — pela MESMA instalação', async () => {
  const instalacao = '0f2a8c1e-5b3d-11f1-9c4e-7d1a2b3c4d5e';
  const { resultado, pedidos } = await comWaze({
    listOnlineEditors: () => respostaGrpc({}),
    ListConversations: () => respostaGrpc({}),
    GetMessagingProvider: () => respostaGrpc({ dados: g.junta(g.campo.msg(1,
      g.campo.bytes(1, new Uint8Array([1, 2, 3])), g.campo.inteiro(2, 86_400_000_000),
      g.campo.texto(3, 'https://instantmessaging-pa.googleapis.com/'), g.campo.texto(4, 'chave-de-teste'))) }),
  }, () => dispatch('presenca-app', { ...BASE, instalacao, token: true }, S.ctx));
  assert.equal(resultado.status, 200, JSON.stringify(resultado.body));
  assert.equal(resultado.body.chat.token, 'AQID');
  assert.equal(resultado.body.chat.base, 'https://instantmessaging-pa.googleapis.com/');
  assert.equal(resultado.body.chat.chave, 'chave-de-teste');
  assert.ok(resultado.body.chat.expiraEm > Date.now() + 86_000_000);
  // A hora do SERVIDOR vai junto: é com ela que o cliente leva o prazo pro
  // relógio do aparelho (auditoria de 2026-09-25).
  assert.ok(Number.isFinite(resultado.body.agora) && Math.abs(resultado.body.agora - Date.now()) < 5000,
    'a resposta perdeu a hora do servidor');
  const cab = g.lerCampos(um(g.lerCampos(pedidos.find((p) => p.metodo === 'GetMessagingProvider').corpo), 1));
  assert.equal(new TextDecoder().decode(um(cab, 4)), instalacao, 'o token saiu para outra instalação — a do aparelho não recebe o fluxo');
  assert.deepEqual(resultado.body.online, []);
  assert.deepEqual(resultado.body.conversas, []);
});

test('presenca-app: a instalação SEM `token` não busca token — ela vai só pra confirmar', async () => {
  const { resultado, pedidos } = await comWaze({
    listOnlineEditors: () => respostaGrpc({}),
    ListConversations: () => respostaGrpc({}),
  }, () => dispatch('presenca-app', { ...BASE, instalacao: '0f2a8c1e-5b3d-11f1-9c4e-7d1a2b3c4d5e' }, S.ctx));
  assert.equal(resultado.status, 200, JSON.stringify(resultado.body));
  assert.ok(!pedidos.some((p) => p.metodo === 'GetMessagingProvider'), 'buscou token que ninguém pediu');
  assert.ok(!('chat' in resultado.body));
});

test('presenca-app: validação ANTES de qualquer rede', async () => {
  const casos = [
    { pais: undefined }, { pais: 0 }, { pais: 1000 }, { pais: '30' },
    { userId: undefined }, { userId: 'fulano' },
    { instalacao: 'nao-e-uuid' },
    { token: true },   // token é da instalação: sem ela não há o que pedir
  ];
  for (const extra of casos) {
    const { resultado, pedidos } = await comWaze({}, () => dispatch('presenca-app', { ...BASE, ...extra }, S.ctx));
    assert.equal(resultado.status, 400, JSON.stringify(extra));
    assert.equal(pedidos.length, 0, JSON.stringify(extra));
  }
});

test('presenca-app: uma parte que falha fica null e a outra chega; sessão morta é 401', async () => {
  const parcial = await comWaze({
    listOnlineEditors: () => respostaGrpc({ dados: lista(naApp(183164343, 'cafanha', BRASIL)) }),
    ListConversations: () => respostaGrpc({ status: 14, mensagem: 'unavailable' }),
  }, () => dispatch('presenca-app', BASE, S.ctx));
  assert.equal(parcial.resultado.status, 200);
  assert.deepEqual(parcial.resultado.body.online.map((e) => e.nome), ['cafanha']);
  assert.equal(parcial.resultado.body.conversas, null, 'falha passageira virou "nenhuma conversa"');
  // A parte que falhou vai DITA na contagem — é o que o diagnóstico mostra.
  assert.deepEqual(parcial.resultado.body.contagem.online, { noWme: 1, comMarca: 1, noPais: 1 });
  assert.equal(typeof parcial.resultado.body.contagem.conversas.falhou, 'string', 'a metade que falhou não foi dita');
  // Resposta que chega mas não se LÊ (bytes que não são protobuf) também é
  // dita — "não veio" e "veio ilegível" são defeitos diferentes.
  const ilegivel = await comWaze({
    listOnlineEditors: () => respostaGrpc({ dados: Uint8Array.of(0x0f) }),
    ListConversations: () => respostaGrpc({ dados: Uint8Array.of(0x0f) }),
  }, () => dispatch('presenca-app', BASE, S.ctx));
  assert.equal(ilegivel.resultado.body.online, null);
  assert.deepEqual(ilegivel.resultado.body.contagem, { online: { falhou: 'leitura' }, conversas: { falhou: 'leitura' } },
    'a resposta ilegível sumiu da contagem em vez de ser dita');

  // O status 7 com a mensagem do convidado é sessão morta (medido na fase 1).
  const morta = await comWaze({
    listOnlineEditors: () => respostaGrpc({ status: 7, mensagem: 'Operation not allowed by guest user' }),
    ListConversations: () => respostaGrpc({}),
  }, () => dispatch('presenca-app', BASE, S.ctx));
  assert.equal(morta.resultado.status, 401);
  assert.equal(morta.resultado.body.errorCategory, 'unauthorized');
  const mortaNoChat = await comWaze({
    listOnlineEditors: () => respostaGrpc({}),
    ListConversations: () => respostaJson(403, '{}'),
  }, () => dispatch('presenca-app', BASE, S.ctx));
  assert.equal(mortaNoChat.resultado.status, 401, 'o chat recusou a sessão e a rota respondeu como se nada fosse');
});

test('presenca-app: os conhecidos do aparelho têm teto de 50 e só aceitam id do Waze', async () => {
  const ultima = (com) => ({ id: `a0000000-0000-1000-8000-${String(com).padStart(12, '0')}`, de: String(com), para: EU, texto: 'pelo WME' });
  const ids = Array.from({ length: 60 }, (_, i) => 1000 + i);
  const { resultado } = await comWaze({
    listOnlineEditors: () => respostaGrpc({}),
    ListConversations: () => respostaGrpc({ dados: conversas(...ids.map((com) => ({ com, nome: 'p' + com, ultima: ultima(com) }))) }),
  }, () => dispatch('presenca-app', { ...BASE, conhecidos: [...ids.map(String), 'fulano', null] }, S.ctx));
  assert.equal(resultado.status, 200);
  const vistos = resultado.body.conversas.map((c) => Number(c.id));
  assert.equal(vistos.length, 50);
  assert.ok(!vistos.includes(1050), 'o 51º conhecido passou pelo teto');
});

// ── de carona na ação ────────────────────────────────────────────────────────

test('carona: a ação traz quem usa o app no país e as conversas do app, sem pedido novo à nossa API', async () => {
  const pres = { userId: EU, lat: -23.5, lon: -46.6, pais: BRASIL, conhecidos: ['601'] };
  const { resultado, pedidos } = await comWaze({
    Read: () => respostaJson(200, '{}'),
    updateOnlineEditor: () => respostaGrpc({ dados: editor({ id: Number(EU), nome: 'antigerme', ...marcarPosicao({ lat: -23.5, lon: -46.6 }, BRASIL) }) }),
    listOnlineEditors: () => respostaGrpc({ dados: lista(
      naApp(183164343, 'cafanha', BRASIL),
      naApp(500, 'na_franca', FRANCA, 48.85, 2.35),
      soNoWme(501, 'so_wme', BRASIL),
    ) }),
    ListConversations: () => respostaGrpc({ dados: conversas(
      { com: 601, nome: 'conhecida', ultima: { id: 'a0000000-0000-1000-8000-000000000003', de: '601', para: EU, texto: 'pelo WME' } },
      { com: 600, nome: 'so_wme', ultima: { id: 'a0000000-0000-1000-8000-000000000002', de: '600', para: EU, texto: 'oi' } },
    ) }),
  }, () => dispatch('marcar-lido', { ...S.dados, venueID: '1', updateRequestID: '2', presenca: pres }, S.ctx));
  assert.equal(resultado.status, 200, JSON.stringify(resultado.body));
  assert.equal(resultado.body.success, true);
  assert.deepEqual(resultado.body.presenca, { ok: true, marca: true });
  assert.deepEqual(resultado.body.presencaApp.online.map((e) => e.nome), ['cafanha']);
  assert.deepEqual(resultado.body.presencaApp.conversas.map((c) => c.nome), ['conhecida']);
  // As contagens vêm de carona também: 3 no WME, 2 com a marca (uma na França),
  // 1 no Brasil; 2 conversas no Waze, nenhuma marcada, 1 conhecida.
  assert.deepEqual(resultado.body.presencaApp.contagem,
    { online: { noWme: 3, comMarca: 2, noPais: 1 }, conversas: { noWaze: 2, marcadas: 0, daApp: 1 } });
  assert.equal(pedidos.filter((p) => p.metodo === 'listOnlineEditors').length, 1);
});

test('carona: a lista que falha some da resposta — a ação e a escrita seguem', async () => {
  const pres = { userId: EU, lat: -23.5, lon: -46.6, pais: BRASIL };
  const { resultado } = await comWaze({
    Read: () => respostaJson(200, '{}'),
    updateOnlineEditor: () => respostaGrpc({ dados: editor({ id: Number(EU), nome: 'antigerme', ...marcarPosicao({ lat: -23.5, lon: -46.6 }, BRASIL) }) }),
    listOnlineEditors: () => { throw new Error('rede caiu no meio'); },
    ListConversations: () => respostaGrpc({ status: 14, mensagem: 'unavailable' }),
  }, () => dispatch('marcar-lido', { ...S.dados, venueID: '1', updateRequestID: '2', presenca: pres }, S.ctx));
  assert.equal(resultado.status, 200);
  assert.equal(resultado.body.success, true);
  assert.deepEqual(resultado.body.presenca, { ok: true, marca: true });
  assert.ok(!('presencaApp' in resultado.body), 'lista que falhou inteira não pode chegar como "ninguém no app"');
});

// ── chat: abrir uma conversa ─────────────────────────────────────────────────

test('chat abrir: o histórico e o "lida" numa ida, em paralelo', { timeout: 5000 }, async () => {
  const soltar = [];
  const esperaAsDuas = (resp) => () => new Promise((ok) => {
    soltar.push(() => ok(resp()));
    if (soltar.length === 2) soltar.forEach((f) => f());
  });
  const hist = g.junta(g.campo.bytes(1, msg({ id: 'a0000000-0000-1000-8000-000000000009', de: '183164343', para: EU, texto: 'WP-TESTE oi', ctx: { app: APP_CONTEXTO } })));
  const { resultado, pedidos } = await comWaze({
    ListMessages: esperaAsDuas(() => respostaGrpc({ dados: hist })),
    MarkConversationRead: esperaAsDuas(() => respostaGrpc({ dados: deB64(F.marcarLida.res) })),
  }, () => dispatch('chat', { ...S.dados, acao: 'abrir', com: '183164343' }, S.ctx));
  assert.equal(resultado.status, 200, JSON.stringify(resultado.body));
  assert.equal(resultado.body.mensagens.length, 1);
  assert.equal(resultado.body.mensagens[0].texto, 'WP-TESTE oi');
  assert.deepEqual(resultado.body.mensagens[0].contexto, { app: APP_CONTEXTO });
  assert.equal(resultado.body.recibos.length, 2, 'os recibos que o Waze gerou ao marcar como lida sumiram');
  // As duas chamadas falam da MESMA conversa.
  const comDe = (p, n) => new TextDecoder().decode(um(g.lerCampos(um(g.lerCampos(p.corpo), n)), 2));
  assert.equal(comDe(pedidos.find((p) => p.metodo === 'ListMessages'), 2), '183164343');
  assert.equal(comDe(pedidos.find((p) => p.metodo === 'MarkConversationRead'), 2), '183164343');
});

test('chat abrir: página ANTIGA não marca como lida; conversa nova (NO_EXISTING_CONVERSATION) não é erro', async () => {
  const antiga = await comWaze({ ListMessages: () => respostaGrpc({}) },
    () => dispatch('chat', { ...S.dados, acao: 'abrir', com: '183164343', antesDe: 1790182220160 }, S.ctx));
  assert.equal(antiga.resultado.status, 200);
  assert.deepEqual(antiga.pedidos.map((p) => p.metodo), ['ListMessages'], 'rolar pra trás marcou a conversa como lida');

  const nova = await comWaze({
    ListMessages: () => respostaGrpc({}),
    MarkConversationRead: () => respostaGrpc({ status: 7, mensagem: 'NO_EXISTING_CONVERSATION' }),
  }, () => dispatch('chat', { ...S.dados, acao: 'abrir', com: '183164343' }, S.ctx));
  assert.equal(nova.resultado.status, 200, JSON.stringify(nova.resultado.body));
  assert.deepEqual(nova.resultado.body.mensagens, []);
  assert.deepEqual(nova.resultado.body.recibos, []);
});

test('chat abrir: o "lida" que falha não derruba o histórico; o histórico que falha, sim', async () => {
  const semLida = await comWaze({
    ListMessages: () => respostaGrpc({}),
    MarkConversationRead: () => respostaGrpc({ status: 14, mensagem: 'unavailable' }),
  }, () => dispatch('chat', { ...S.dados, acao: 'abrir', com: '183164343' }, S.ctx));
  assert.equal(semLida.resultado.status, 200);
  assert.deepEqual(semLida.resultado.body.recibos, []);

  const morta = await comWaze({
    ListMessages: () => respostaGrpc({ status: 16, mensagem: '' }),
    MarkConversationRead: () => respostaGrpc({}),
  }, () => dispatch('chat', { ...S.dados, acao: 'abrir', com: '183164343' }, S.ctx));
  assert.equal(morta.resultado.status, 401);

  const semCom = await comWaze({}, () => dispatch('chat', { ...S.dados, acao: 'abrir', com: 'fulano' }, S.ctx));
  assert.equal(semCom.resultado.status, 400);
  assert.equal(semCom.pedidos.length, 0);
});

// ── a confirmação do fluxo, de carona ────────────────────────────────────────
//
// O fluxo em tempo real reentrega, a cada reconexão (~6 min), tudo o que a
// instalação recebeu e não confirmou. Confirmar custaria um pedido por mensagem;
// de carona, zero. As regras que estes testes travam: vai com a instalação do
// APARELHO, nunca derruba o pedido principal, e pedido recusado não confirma.

const INST = '0f2a8c1e-5b3d-11f1-9c4e-7d1a2b3c4d5e';
const IDS = ['e656f4a0-b76e-11f1-b21f-03d86fcc0bb7', 'a6bfe37d-a3ef-42ca-a8d0-97912b1c4d94'];
const idsDoAck = (p) => g.lerCampos(p.corpo).filter((c) => c.n === 2).map((c) => new TextDecoder().decode(c.v));
const instDoAck = (p) => new TextDecoder().decode(um(g.lerCampos(um(g.lerCampos(p.corpo), 1)), 4));

test('confirmação: vai JUNTO do presenca-app, com a instalação do aparelho, e volta contada', async () => {
  const { resultado, pedidos } = await comWaze({
    listOnlineEditors: () => respostaGrpc({}),
    ListConversations: () => respostaGrpc({}),
    GetMessagingProvider: () => respostaGrpc({}),
    AckMessages: () => respostaGrpc({}),
  }, () => dispatch('presenca-app', { ...BASE, instalacao: INST, token: true, confirmar: [...IDS, 'nao-e-uuid', 42] }, S.ctx));
  assert.equal(resultado.status, 200, JSON.stringify(resultado.body));
  const ack = pedidos.find((p) => p.metodo === 'AckMessages');
  assert.ok(ack, 'a confirmação não saiu');
  assert.deepEqual(idsDoAck(ack), IDS, 'lixo na lista virou id, ou id bom ficou de fora');
  assert.equal(instDoAck(ack), INST, 'confirmou na fila de OUTRA instalação — a do aparelho segue cheia');
  assert.equal(resultado.body.confirmados, 2);
});

test('confirmação: sem instalação, ou só com lixo, nada sai — e o pedido principal segue', async () => {
  for (const extra of [{ confirmar: IDS }, { instalacao: INST, confirmar: ['x', null] }, { instalacao: INST, confirmar: [] }, { instalacao: INST, confirmar: 'e656f4a0' }]) {
    const { resultado, pedidos } = await comWaze({
      listOnlineEditors: () => respostaGrpc({}),
      ListConversations: () => respostaGrpc({}),
      GetMessagingProvider: () => respostaGrpc({}),
    }, () => dispatch('presenca-app', { ...BASE, ...extra }, S.ctx));
    assert.equal(resultado.status, 200, JSON.stringify(extra));
    assert.ok(!pedidos.some((p) => p.metodo === 'AckMessages'), JSON.stringify(extra));
    assert.ok(!('confirmados' in resultado.body), JSON.stringify(extra));
  }
});

test('confirmação: a que falha não derruba o pedido e não é contada; o teto é 100', async () => {
  const falha = await comWaze({
    listOnlineEditors: () => respostaGrpc({}),
    ListConversations: () => respostaGrpc({}),
    GetMessagingProvider: () => respostaGrpc({}),
    AckMessages: () => respostaGrpc({ status: 14, mensagem: 'unavailable' }),
  }, () => dispatch('presenca-app', { ...BASE, instalacao: INST, confirmar: IDS }, S.ctx));
  assert.equal(falha.resultado.status, 200);
  assert.ok(!('confirmados' in falha.resultado.body), 'confirmação que falhou foi contada: o cliente soltaria ids que seguem na fila');

  const muitos = Array.from({ length: 130 }, (_, i) => `00000000-0000-1000-8000-${String(i).padStart(12, '0')}`);
  const teto = await comWaze({
    listOnlineEditors: () => respostaGrpc({}),
    ListConversations: () => respostaGrpc({}),
    GetMessagingProvider: () => respostaGrpc({}),
    AckMessages: () => respostaGrpc({}),
  }, () => dispatch('presenca-app', { ...BASE, instalacao: INST, confirmar: muitos }, S.ctx));
  assert.equal(idsDoAck(teto.pedidos.find((p) => p.metodo === 'AckMessages')).length, 100);
  assert.equal(teto.resultado.body.confirmados, 100);
});

test('confirmação: vai junto de QUALQUER ação do chat — e pedido recusado não confirma nada', async () => {
  const envio = await comWaze({
    SendMessage: () => respostaGrpc({ dados: deB64(F.enviarTexto.res) }),
    AckMessages: () => respostaGrpc({}),
  }, () => dispatch('chat', { ...S.dados, acao: 'enviar', para: '183164343', texto: 'oi', instalacao: INST, confirmar: IDS }, S.ctx));
  assert.equal(envio.resultado.status, 200);
  assert.equal(envio.resultado.body.confirmados, 2);

  const abrir = await comWaze({
    ListMessages: () => respostaGrpc({}),
    MarkConversationRead: () => respostaGrpc({}),
    AckMessages: () => respostaGrpc({}),
  }, () => dispatch('chat', { ...S.dados, acao: 'abrir', com: '183164343', instalacao: INST, confirmar: IDS }, S.ctx));
  assert.equal(abrir.resultado.status, 200);
  assert.equal(abrir.resultado.body.confirmados, 2);

  for (const ruim of [
    { acao: 'enviar', para: '183164343', texto: '' },
    { acao: 'abrir', com: 'fulano' },
    { acao: 'lida', com: 'fulano' },
  ]) {
    const r = await comWaze({}, () => dispatch('chat', { ...S.dados, instalacao: INST, confirmar: IDS, ...ruim }, S.ctx));
    assert.equal(r.resultado.status, 400, JSON.stringify(ruim));
    assert.equal(r.pedidos.length, 0, `pedido recusado confirmou: ${JSON.stringify(ruim)}`);
  }

  // A ação `confirmar` já É a confirmação: não sai uma segunda de carona.
  const explicita = await comWaze({ AckMessages: () => respostaGrpc({}) },
    () => dispatch('chat', { ...S.dados, acao: 'confirmar', ids: IDS, instalacao: INST, confirmar: IDS }, S.ctx));
  assert.equal(explicita.resultado.status, 200);
  assert.equal(explicita.pedidos.length, 1);
});
