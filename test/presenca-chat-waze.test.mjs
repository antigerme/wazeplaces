// As rotas `presenca-waze` e `chat` (fase 1: só servidor, nenhuma tela ainda).
//
// O `fetch` é trocado por um Waze de mentira que devolve quadros gRPC-web — os
// REAIS da fixture, sempre que existe um — e anota o que a rota mandou. Cada
// status de erro usado aqui foi MEDIDO contra o Waze de verdade (ver
// `categorizeGrpcError` no core): o teste não inventa o que o Waze responde.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { dispatch, categorizeGrpcError } from '../server/core.mjs';
import * as g from '../server/wme-grpc.mjs';

const F = JSON.parse(readFileSync(new URL('./wme-grpc.fixture.json', import.meta.url), 'utf8'));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const um = (campos, n) => campos.find((c) => c.n === n)?.v;

// Cookie de mentira no formato Netscape (o mesmo que a app guarda).
const COOKIES = [
  '.waze.com\tTRUE\t/\tTRUE\t0\t_csrf_token\tcsrf-de-teste',
  '.waze.com\tTRUE\t/\tTRUE\t0\t_web_session\tsessao-de-teste',
].join('\n');

function quadro(flag, corpo) {
  const q = new Uint8Array(5 + corpo.length);
  q[0] = flag;
  new DataView(q.buffer).setUint32(1, corpo.length);
  q.set(corpo, 5);
  return q;
}
// Resposta gRPC-web como o Waze manda: dados e trailer em base64 separados.
function respostaGrpc({ dados = null, status = 0, mensagem = '', cabecalhos = {} } = {}) {
  const trailer = new TextEncoder().encode(`grpc-status:${status}\r\ngrpc-message:${encodeURIComponent(mensagem)}\r\n`);
  const corpo = (dados ? b64(quadro(0, dados)) : '') + b64(quadro(0x80, trailer));
  return new Response(corpo, { status: 200, headers: { 'content-type': 'application/grpc-web-text+proto', ...cabecalhos } });
}

// Troca o fetch por uma função que responde por MÉTODO e anota o pedido.
async function comWaze(responder, fn) {
  const original = globalThis.fetch;
  const pedidos = [];
  globalThis.fetch = async (url, init) => {
    const metodo = String(url).split('/').pop();
    const corpo = g.lerRespostaGrpcWeb(init.body).dados;   // o pedido tem o mesmo enquadramento
    pedidos.push({ url: String(url), metodo, headers: init.headers, corpo });
    return responder(metodo, corpo);
  };
  try {
    return { resultado: await fn(), pedidos };
  } finally {
    globalThis.fetch = original;
  }
}

// ── presença ───────────────────────────────────────────────────────────────

test('presenca-waze: só a lista → UMA chamada ao listOnlineEditors, do servidor da região', async () => {
  const { resultado, pedidos } = await comWaze(() => respostaGrpc({ dados: g.junta(g.campo.bytes(1, deB64(F.atualizarPosicao.res))) }),
    () => dispatch('presenca-waze', { cookies: COOKIES, region: 'row', caixa: [-40, -13.5, -39, -12] }, {}));
  assert.equal(resultado.status, 200);
  assert.deepEqual(resultado.body.editores, [{ id: 183164343, nome: 'cafanha', rank: 0, visivel: true, lat: -12.597498, lon: -39.511208 }]);
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].url, 'https://www.waze.com/row-Descartes/grpc/com.waze.mapeditor.web.api.MapEditorWebServer/listOnlineEditors');
  const h = pedidos[0].headers;
  assert.equal(h['Content-Type'], 'application/grpc-web-text');
  assert.equal(h['X-Grpc-Web'], '1');
  assert.ok(!('X-CSRF-Token' in h), 'o WME não manda CSRF no gRPC — mandar seria uma assinatura a mais');
  assert.ok(!('X-User-Agent' in h), 'a presença do WME não se identifica como cliente de chat');
  assert.match(h.Cookie, /_web_session=sessao-de-teste/);
  assert.equal(h.Referer, 'https://www.waze.com/editor?env=row', 'Referer sem idioma, como toda URL do WME na app');
});

test('presenca-waze: a região escolhe o servidor (a presença é separada por servidor)', async () => {
  for (const [region, prefixo] of [['na', 'na-Descartes'], ['il', 'il-Descartes'], ['world', 'Descartes'], ['xx', 'row-Descartes']]) {
    const { pedidos } = await comWaze(() => respostaGrpc({ dados: new Uint8Array() }),
      () => dispatch('presenca-waze', { cookies: COOKIES, region, caixa: [-1, -1, 1, 1] }, {}));
    assert.equal(pedidos[0].url, `https://www.waze.com/${prefixo}/grpc/com.waze.mapeditor.web.api.MapEditorWebServer/listOnlineEditors`, region);
  }
});

test('presenca-waze: mover e listar saem JUNTOS, e o corpo da escrita é o do WME', async () => {
  const { resultado, pedidos } = await comWaze((metodo) => (metodo === 'updateOnlineEditor'
    ? respostaGrpc({ dados: deB64(F.atualizarPosicao.res) })
    : respostaGrpc({ dados: new Uint8Array() })),
  () => dispatch('presenca-waze', { cookies: COOKIES, userId: '183164343', posicao: { lat: -12.597498, lon: -39.511208 }, caixa: [-40, -13.5, -39, -12] }, {}));
  assert.equal(resultado.status, 200);
  assert.deepEqual(pedidos.map((p) => p.metodo).sort(), ['listOnlineEditors', 'updateOnlineEditor']);
  const escrita = pedidos.find((p) => p.metodo === 'updateOnlineEditor');
  assert.equal(b64(escrita.corpo), F.atualizarPosicao.req, 'o corpo da posição não é mais o que o WME manda');
  assert.equal(resultado.body.eu.nome, 'cafanha');
  assert.deepEqual(resultado.body.editores, []);
});

test('presenca-waze: validação antes de qualquer rede', async () => {
  const casos = [
    {},                                                         // nada a fazer
    { caixa: [-39, -12, -40, -13.5] },                           // caixa invertida
    { caixa: [-40, -13.5, -39] },                                // caixa incompleta
    { caixa: [-200, -13.5, -39, -12] },                          // fora do mundo
    { posicao: { lat: -12.6, lon: -39.5 } },                     // escrita sem id
    { posicao: { lat: -12.6, lon: -39.5 }, userId: '12a' },       // id que não é do Waze
    { posicao: { lat: 91, lon: -39.5 }, userId: '1' },            // latitude impossível
    // coerção: a string "true" não liga nada. Vai COM caixa de propósito: sem
    // ela o 400 viria de "nada a fazer", e a guarda da coerção seria decorativa
    // (a sabotagem passou assim); com ela, sem a guarda, o pedido de aparecer
    // seria IGNORADO calado e a resposta seria 200.
    { visivel: 'true', userId: '1', caixa: [-1, -1, 1, 1] },
  ];
  for (const extra of casos) {
    const { resultado, pedidos } = await comWaze(() => assert.fail('não podia ter ido ao Waze'),
      () => dispatch('presenca-waze', { cookies: COOKIES, ...extra }, {}));
    assert.equal(resultado.status, 400, JSON.stringify(extra));
    assert.equal(resultado.body.errorKey, 'srv.err.incompleteParams');
    assert.equal(pedidos.length, 0);
  }
});

// ── a classificação dos erros MEDIDOS ──────────────────────────────────────

test('presenca-waze: cookie que não vale → 401; id de OUTRA pessoa → erro NOSSO, não sessão morta', async () => {
  const guest = await comWaze(() => respostaGrpc({ status: 7, mensagem: '(403) This operation is not allowed by guest user., Code 101' }),
    () => dispatch('presenca-waze', { cookies: COOKIES, userId: '183164343', posicao: { lat: 1, lon: 1 } }, {}));
  assert.equal(guest.resultado.status, 401);
  assert.equal(guest.resultado.body.errorCategory, 'unauthorized');
  const outro = await comWaze(() => respostaGrpc({ status: 7, mensagem: "(403) cannot modify another user's data, Code 101" }),
    () => dispatch('presenca-waze', { cookies: COOKIES, userId: '12444348', posicao: { lat: 1, lon: 1 } }, {}));
  assert.equal(outro.resultado.status, 500);
  assert.equal(outro.resultado.body.errorCategory, 'unknown',
    'id errado virou "sessão morta": o cliente desconfiaria da sessão de quem não errou');
  assert.equal(outro.resultado.body.grpcStatus, 7);
});

test('categorizeGrpcError: cada status medido cai na categoria certa', () => {
  const ok = { httpCode: 200, grpcStatus: 0, grpcMessage: '', dados: new Uint8Array(), error: '' };
  const r = (extra) => categorizeGrpcError({ ...ok, ...extra });
  assert.equal(r({}), null);
  assert.equal(r({ grpcStatus: 7, grpcMessage: '(403) This operation is not allowed by guest user., Code 101' }).category, 'unauthorized');
  assert.equal(r({ grpcStatus: 7, grpcMessage: '(403) Empty CSRF token, Code 103' }).category, 'unauthorized');
  assert.equal(r({ grpcStatus: 7, grpcMessage: '' }).category, 'unauthorized', 'o chat com cookie inválido devolve 7 SEM mensagem');
  assert.equal(r({ grpcStatus: 7, grpcMessage: "(403) cannot modify another user's data, Code 101" }).category, 'unknown');
  assert.equal(r({ grpcStatus: 7, grpcMessage: 'NO_EXISTING_CONVERSATION' }).category, 'unknown');
  assert.equal(r({ grpcStatus: 16 }).category, 'unauthorized');
  for (const st of [2, 4, 8, 13, 14]) assert.equal(r({ grpcStatus: st }).category, 'transient', `status ${st}`);
  assert.equal(r({ grpcStatus: 5 }).category, 'not_found');
  assert.equal(r({ grpcStatus: 3 }).category, 'unknown', 'argumento inválido é defeito nosso, e repetir não resolve');
  assert.equal(r({ grpcStatus: null, dados: new Uint8Array([8, 1]) }), null, 'sem trailer mas com dados: chegou');
  assert.equal(r({ grpcStatus: null, dados: null }).category, 'transient', 'sem trailer e sem dados: cortou no meio');
  assert.equal(r({ httpCode: 0, error: 'fetch failed' }).category, 'transient');
  assert.equal(r({ httpCode: 403, grpcStatus: null }).category, 'unauthorized');
  assert.equal(r({ httpCode: 503, grpcStatus: null }).category, 'transient');
});

test('gRPC: status só nos CABEÇALHOS HTTP (resposta só de trailer) também é lido', async () => {
  const { resultado } = await comWaze(() => new Response('', { status: 200, headers: { 'grpc-status': '7', 'grpc-message': encodeURIComponent('(403) This operation is not allowed by guest user., Code 101') } }),
    () => dispatch('presenca-waze', { cookies: COOKIES, caixa: [-1, -1, 1, 1] }, {}));
  assert.equal(resultado.status, 401);
});

// ── chat ───────────────────────────────────────────────────────────────────

test('chat: fala com o WMP da região, identificado como o cliente de chat do WME', async () => {
  const { resultado, pedidos } = await comWaze(() => respostaGrpc({ dados: deB64(F.naoLidas.res) }),
    () => dispatch('chat', { cookies: COOKIES, region: 'na', acao: 'naoLidas' }, {}));
  assert.equal(resultado.status, 200);
  assert.deepEqual([resultado.body.total, resultado.body.lidoAte], [0, 1790182189049]);
  assert.equal(pedidos[0].url, 'https://www.waze.com/na-wmp/com.waze.wmp.Messaging/GetUnreadMessagesCount');
  assert.equal(pedidos[0].headers['X-User-Agent'], 'grpc-web-javascript/0.1');
  assert.ok(!('X-CSRF-Token' in pedidos[0].headers));
  assert.match(pedidos[0].headers.Referer, /^https:\/\/www\.waze\.com\/chat\/embed\?/);
});

test('chat: o token exige a instalação ESTÁVEL do aparelho, e a instalação vai no cabeçalho', async () => {
  const semInst = await comWaze(() => assert.fail('não podia ter ido ao Waze'),
    () => dispatch('chat', { cookies: COOKIES, acao: 'token' }, {}));
  assert.equal(semInst.resultado.status, 400, 'sem instalação, cada pedido de token criaria um aparelho novo no chat');
  const prov = g.campo.msg(1, g.campo.bytes(1, Uint8Array.from([1, 2, 3])), g.campo.inteiro(2, 86399912947),
    g.campo.texto(3, 'https://exemplo.invalido/'), g.campo.texto(4, 'chave-falsa'));
  const inst = '9539ba30-b76e-11f1-af95-b138fecb0057';
  const { resultado, pedidos } = await comWaze(() => respostaGrpc({ dados: prov }),
    () => dispatch('chat', { cookies: COOKIES, acao: 'token', instalacao: inst }, {}));
  assert.equal(resultado.status, 200);
  assert.equal(resultado.body.token, 'AQID');
  assert.equal(resultado.body.chave, 'chave-falsa');
  assert.ok(resultado.body.expiraEm > Date.now() + 23 * 3600e3, 'o prazo de 24 h virou outra coisa');
  const cab = g.lerCampos(um(g.lerCampos(pedidos[0].corpo), 1));
  assert.equal(new TextDecoder().decode(um(cab, 4)), inst);
  assert.equal(Number(um(cab, 6)), 2, 'o aplicativo tem que ser o do WME (WAZE_MAP_EDITOR = 2)');
});

test('chat enviar: texto, contexto e id do cliente; SEM remetente quando não se sabe', async () => {
  const id = 'dc76ba10-b76e-11f1-ad63-37a65b87598a';
  const { resultado, pedidos } = await comWaze(() => respostaGrpc({ dados: deB64(F.enviarTexto.res) }),
    () => dispatch('chat', { cookies: COOKIES, acao: 'enviar', para: '12444348', id, texto: 'Olá antigerme', contexto: { wp_card: '{"v":1}' } }, {}));
  assert.equal(resultado.status, 200);
  assert.equal(resultado.body.id, id);
  assert.equal(resultado.body.ts, 1790182220160);
  const m = g.lerMensagem(um(g.lerCampos(pedidos[0].corpo), 2));
  assert.deepEqual([m.classe, m.texto, m.para.id, m.de], ['texto', 'Olá antigerme', '12444348', null]);
  assert.deepEqual(m.contexto, { wp_card: '{"v":1}' });
});

test('chat enviar: validação antes de qualquer rede', async () => {
  const base = { cookies: COOKIES, acao: 'enviar', para: '12444348', texto: 'oi' };
  const casos = [
    { texto: '' }, { texto: '   ' }, { texto: 'x'.repeat(4001) }, { texto: 42 },
    { para: 'fulano' }, { id: 'nao-e-uuid' }, { de: 'x' },
    { contexto: 'texto' }, { contexto: [] }, { contexto: {} }, { contexto: { k: 1 } },
    { contexto: Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['k' + i, 'v'])) },
    { contexto: { k: 'x'.repeat(7000) } },
  ];
  for (const extra of casos) {
    const { resultado, pedidos } = await comWaze(() => assert.fail('não podia ter ido ao Waze'),
      () => dispatch('chat', { ...base, ...extra }, {}));
    assert.equal(resultado.status, 400, JSON.stringify(extra).slice(0, 80));
    assert.equal(pedidos.length, 0);
  }
  const semAcao = await comWaze(() => assert.fail('não podia ter ido ao Waze'),
    () => dispatch('chat', { cookies: COOKIES, acao: 'apagarTudo' }, {}));
  assert.equal(semAcao.resultado.status, 400, 'ação desconhecida não pode virar chamada nenhuma');
});

test('chat recibo: entregue ou lida, com os ids das mensagens — e nada além disso', async () => {
  const ids = ['dc76ba10-b76e-11f1-ad63-37a65b87598a'];
  const { resultado, pedidos } = await comWaze(() => respostaGrpc({ dados: deB64(F.reciboLida.res) }),
    () => dispatch('chat', { cookies: COOKIES, acao: 'recibo', para: '183164343', tipo: 'lida', ids }, {}));
  assert.equal(resultado.status, 200);
  const m = g.lerMensagem(um(g.lerCampos(pedidos[0].corpo), 2));
  assert.deepEqual([m.classe, m.recibo.tipo, m.recibo.ids], ['recibo', 'lida', ids]);
  for (const tipo of ['aberta', 1, undefined]) {
    const r = await comWaze(() => assert.fail('não podia ter ido ao Waze'),
      () => dispatch('chat', { cookies: COOKIES, acao: 'recibo', para: '183164343', tipo, ids }, {}));
    assert.equal(r.resultado.status, 400, String(tipo));
  }
});

test('chat lida: conversa que não existe é "nada a marcar", não erro (e só nesse caso)', async () => {
  const vazia = await comWaze(() => respostaGrpc({ status: 7, mensagem: 'NO_EXISTING_CONVERSATION' }),
    () => dispatch('chat', { cookies: COOKIES, acao: 'lida', com: '183164343' }, {}));
  assert.equal(vazia.resultado.status, 200);
  assert.deepEqual(vazia.resultado.body.recibos, []);
  // O mesmo 7 SEM essa mensagem é sessão morta: a exceção não pode engolir o resto.
  const morta = await comWaze(() => respostaGrpc({ status: 7, mensagem: '' }),
    () => dispatch('chat', { cookies: COOKIES, acao: 'lida', com: '183164343' }, {}));
  assert.equal(morta.resultado.status, 401);
  const cheia = await comWaze(() => respostaGrpc({ dados: deB64(F.marcarLida.res) }),
    () => dispatch('chat', { cookies: COOKIES, acao: 'lida', com: '183164343' }, {}));
  assert.equal(cheia.resultado.body.recibos.length, 2);
});

test('chat: conversas, mensagens, perfis e confirmar montam o pedido do WME', async () => {
  const { resultado, pedidos } = await comWaze(() => respostaGrpc({ dados: deB64(F.perfis.res) }),
    () => dispatch('chat', { cookies: COOKIES, acao: 'perfis', ids: ['183164343'] }, {}));
  assert.deepEqual(resultado.body.perfis, [{ id: '183164343', nome: 'cafanha' }]);
  assert.equal(pedidos[0].metodo, 'GetProfileInfo');
  const conv = await comWaze(() => respostaGrpc({ dados: deB64(F.conversas.res) }),
    () => dispatch('chat', { cookies: COOKIES, acao: 'conversas', lidoAte: 1790182189049 }, {}));
  assert.deepEqual(conv.resultado.body.conversas, []);
  assert.equal(Number(um(g.lerCampos(conv.pedidos[0].corpo), 6)), 1790182189049);
  const msgs = await comWaze(() => respostaGrpc({ dados: new Uint8Array() }),
    () => dispatch('chat', { cookies: COOKIES, acao: 'mensagens', com: '12444348', antesDe: 1790182220160 }, {}));
  assert.deepEqual(msgs.resultado.body.mensagens, []);
  assert.equal(Number(um(g.lerCampos(msgs.pedidos[0].corpo), 3)), 1790182220160);
  const conf = await comWaze(() => respostaGrpc({ dados: new Uint8Array() }),
    () => dispatch('chat', { cookies: COOKIES, acao: 'confirmar', ids: ['dc76ba10-b76e-11f1-ad63-37a65b87598a'] }, {}));
  assert.equal(conf.resultado.status, 200);
  for (const extra of [{ acao: 'perfis', ids: [] }, { acao: 'perfis', ids: Array(51).fill('1') }, { acao: 'mensagens' }, { acao: 'conversas', antesDe: -1 }, { acao: 'confirmar', ids: ['x'] }]) {
    const r = await comWaze(() => assert.fail('não podia ter ido ao Waze'), () => dispatch('chat', { cookies: COOKIES, ...extra }, {}));
    assert.equal(r.resultado.status, 400, JSON.stringify(extra).slice(0, 60));
  }
});

// ── a regravação do cookie também passa pelo caminho gRPC ─────────────────

test('gRPC: o cookie que o Waze rotaciona é regravado na sessão, como no caminho JSON', async () => {
  const regravados = [];
  const sessions = {
    loadSession: async () => COOKIES,
    refreshCookies: async (token, conteudo) => { regravados.push({ token, conteudo }); return true; },
  };
  const { resultado } = await comWaze(() => {
    const r = respostaGrpc({ dados: new Uint8Array() });
    r.headers.append('set-cookie', '_web_session=sessao-nova; path=/; secure; HttpOnly');
    return r;
  }, () => dispatch('presenca-waze', { sessionToken: 'tok', caixa: [-1, -1, 1, 1] }, { sessions }));
  assert.equal(resultado.status, 200);
  assert.equal(regravados.length, 1, 'a rotação do cookie não foi regravada pelo caminho gRPC');
  assert.match(regravados[0].conteudo, /_web_session\tsessao-nova/);
});
