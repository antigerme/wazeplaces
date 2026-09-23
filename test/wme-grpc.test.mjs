// O fio gRPC-web da presença e do chat do WME (server/wme-grpc.mjs).
//
// CONTRATO com bytes REAIS: cada pedido que a gravação do owner mostra o WME
// mandando é remontado pelos nossos construtores e tem que sair IGUAL, byte a
// byte. É a única régua que não depende de eu ter entendido o esquema: se um
// campo trocar de número, de ordem ou de tipo, o teste reprova. As respostas
// reais são lidas pelos nossos leitores e conferidas contra o que o WME mostrou.
//
// A fixture (test/wme-grpc.fixture.json) só tem trocas entre as duas contas do
// owner — nada de terceiro, nada de token (ver `_procedencia` lá dentro).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as g from '../server/wme-grpc.mjs';

const F = JSON.parse(readFileSync(new URL('./wme-grpc.fixture.json', import.meta.url), 'utf8'));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const req = (k) => deB64(F[k].req);
const res = (k) => (F[k].res == null ? null : deB64(F[k].res));
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const um = (campos, n) => campos.find((c) => c.n === n)?.v;
const todos = (campos, n) => campos.filter((c) => c.n === n).map((c) => c.v);
const texto = (u8) => new TextDecoder().decode(u8);
const idDe = (u8) => texto(um(g.lerCampos(u8), 2));

// Refaz o cabeçalho WMP a partir do pedido gravado (id da requisição e instalação).
function cabecalhoDe(pedido) {
  const h = g.lerCampos(um(g.lerCampos(pedido), 1));
  return g.cabecalhoWmp({ requisicao: texto(um(h, 1)), instalacao: texto(um(h, 4)) });
}

// ── contrato: os bytes do WME ──────────────────────────────────────────────

const REMONTAR = {
  atualizarPosicao: (p) => {
    const e = g.lerEditorOnline(um(g.lerCampos(p), 1));
    return g.corpoAtualizarPresenca({ userId: e.id, lat: e.lat, lon: e.lon });
  },
  atualizarVisivel: (p) => {
    const e = g.lerEditorOnline(um(g.lerCampos(p), 1));
    return g.corpoAtualizarPresenca({ userId: e.id, visivel: e.visivel });
  },
  listarVazio: (p) => {
    const caixa = g.lerCampos(um(g.lerCampos(p), 1));
    const canto = (v) => {
      const c = g.lerCampos(v);
      return [Number(BigInt.asIntN(64, um(c, 101))) / 1e6, Number(BigInt.asIntN(64, um(c, 102))) / 1e6];
    };
    const [a, b] = [canto(um(caixa, 1)), canto(um(caixa, 2))];
    return g.corpoListarOnline([a[0], a[1], b[0], b[1]]);
  },
  enviarTexto: (p) => {
    const m = g.lerMensagem(um(g.lerCampos(p), 2));
    return g.corpoEnviarTexto({ cabecalho: cabecalhoDe(p), ts: m.ts, id: m.id, para: m.para.id, de: m.de.id, texto: m.texto });
  },
  reciboEntregue: (p) => {
    const m = g.lerMensagem(um(g.lerCampos(p), 2));
    return g.corpoRecibo({ cabecalho: cabecalhoDe(p), ts: m.ts, id: m.id, para: m.para.id, de: m.de.id, tipo: m.recibo.tipo === 'lida' ? 2 : 1, ids: m.recibo.ids });
  },
  marcarLida: (p) => g.corpoMarcarLida({ cabecalho: cabecalhoDe(p), com: idDe(um(g.lerCampos(p), 2)) }),
  confirmar: (p) => g.corpoConfirmar({ cabecalho: cabecalhoDe(p), ids: todos(g.lerCampos(p), 2).map(texto) }),
  naoLidas: (p) => g.corpoSoCabecalho(cabecalhoDe(p)),
  provedorPedido: (p) => g.corpoSoCabecalho(cabecalhoDe(p)),
  perfis: (p) => g.corpoPerfis({ cabecalho: cabecalhoDe(p), ids: todos(g.lerCampos(p), 2).map(idDe) }),
  mensagens: (p) => {
    const c = g.lerCampos(p);
    const antes = um(c, 3);
    return g.corpoMensagens({ cabecalho: cabecalhoDe(p), com: idDe(um(c, 2)), antesDe: antes == null ? null : Number(antes), porPagina: Number(um(c, 5)) });
  },
  conversas: (p) => {
    const c = g.lerCampos(p);
    const antes = um(c, 2), lido = um(c, 6);
    return g.corpoConversas({ cabecalho: cabecalhoDe(p), antesDe: antes == null ? null : Number(antes), porPagina: Number(um(c, 4)), lidoAte: lido == null ? null : Number(lido) });
  },
};
REMONTAR.reciboLida = REMONTAR.reciboEntregue;
REMONTAR.enviarTexto2 = REMONTAR.enviarTexto;
REMONTAR.mensagensAntes = REMONTAR.mensagens;

test('contrato: todo quadro gravado tem um remontador (fixture nova não passa calada)', () => {
  const quadros = Object.keys(F).filter((k) => !k.startsWith('_'));
  assert.ok(quadros.length >= 15, `só ${quadros.length} quadros na fixture`);
  for (const k of quadros) assert.ok(REMONTAR[k], `o quadro "${k}" não tem remontador — ele não estaria sendo conferido`);
});

for (const nome of Object.keys(REMONTAR)) {
  test(`contrato: ${nome} (${F[nome].metodo}) sai byte a byte igual ao do WME`, () => {
    const gravado = req(nome);
    assert.equal(hex(REMONTAR[nome](gravado)), hex(gravado));
  });
}

// ── leitura das respostas reais ────────────────────────────────────────────

test('presença: lê o registro que o Waze devolve ao atualizar (posição e visibilidade)', () => {
  assert.deepEqual(g.lerEditorOnline(res('atualizarPosicao')),
    { id: 183164343, nome: 'cafanha', rank: 0, visivel: true, lat: -12.597498, lon: -39.511208 });
  // Atualizando só a visibilidade, o registro volta sem posição.
  assert.deepEqual(g.lerEditorOnline(res('atualizarVisivel')),
    { id: 183164343, nome: 'cafanha', rank: 0, visivel: true, lat: null, lon: null });
});

test('presença: lista vazia vem como quadro VAZIO, e a cheia é o mesmo registro repetido', () => {
  assert.deepEqual(g.lerListaOnline(res('listarVazio')), []);
  // A lista gravada com gente dentro tinha terceiros e não entrou na fixture;
  // o formato é `repeated OnlineEditor` no campo 1, montado com o registro real.
  const lista = g.junta(g.campo.bytes(1, res('atualizarPosicao')), g.campo.bytes(1, res('atualizarPosicao')));
  const eds = g.lerListaOnline(lista);
  assert.equal(eds.length, 2);
  assert.equal(eds[0].nome, 'cafanha');
});

test('chat: lê as mensagens gravadas — texto, recibo de entregue e de lida', () => {
  const m = g.lerMensagem(um(g.lerCampos(req('enviarTexto')), 2));
  assert.equal(m.classe, 'texto');
  assert.equal(m.texto, 'Olá antigerme');
  assert.deepEqual([m.de.id, m.para.id], ['183164343', '12444348']);
  const e = g.lerMensagem(um(g.lerCampos(req('reciboEntregue')), 2));
  assert.deepEqual([e.classe, e.recibo.tipo, e.recibo.ids], ['recibo', 'entregue', [m.id]]);
  const l = g.lerMensagem(um(g.lerCampos(req('reciboLida')), 2));
  assert.equal(l.recibo.tipo, 'lida');
});

test('chat: lê as respostas reais de envio, marcar lida, não lidas, perfis e conversas', () => {
  const m = g.lerMensagem(um(g.lerCampos(req('enviarTexto')), 2));
  const envio = g.lerEnvio(res('enviarTexto'));
  assert.equal(envio.id, m.id, 'o Waze devolve o MESMO id que o cliente gerou');
  assert.ok(envio.ts >= m.ts, 'a hora do servidor não é anterior à do cliente');
  const recibos = g.lerMarcarLida(res('marcarLida')).recibos;
  assert.equal(recibos.length, 2, 'marcar lida gera os DOIS recibos (entregue e lida) no servidor');
  for (const r of recibos) assert.match(r, /^[0-9a-f-]{36}$/);
  assert.deepEqual(g.lerNaoLidas(res('naoLidas')), { total: 0, lidoAte: 1790182189049 });
  assert.deepEqual(g.lerPerfis(res('perfis')), [{ id: '183164343', nome: 'cafanha' }]);
  assert.deepEqual(g.lerConversas(res('conversas')), { conversas: [], maisAntigas: false, lidoAte: 1790182189049 });
  assert.deepEqual(g.lerMensagens(res('mensagens')), { mensagens: [], maisAntigas: false });
});

test('chat: o contexto invisível vai e volta, e o remetente é opcional', () => {
  const ctx = { wp_card: JSON.stringify({ v: 1, nome: 'Posto Exemplo', extra: 'x'.repeat(1900) }) };
  const cab = g.cabecalhoWmp({ requisicao: '00000000-0000-4000-8000-000000000000', instalacao: '11111111-1111-4111-8111-111111111111' });
  const corpo = g.corpoEnviarTexto({ cabecalho: cab, ts: 1790182219825, id: '22222222-2222-4222-8222-222222222222', para: '12444348', texto: 'oi', ctx });
  const m = g.lerMensagem(um(g.lerCampos(corpo), 2));
  assert.deepEqual(m.contexto, ctx, 'o contexto de ~2 KB não voltou igual');
  assert.equal(m.de, null, 'sem remetente, o campo 4 não pode ir (o Waze usa o dono do cookie)');
});

test('chat: o token do fluxo sai em base64, e o prazo em milissegundos', () => {
  // Bytes SINTÉTICOS de propósito: a resposta real traz token e chave e nunca
  // entra em fixture.
  const t = g.campo.msg(1,
    g.campo.bytes(1, Uint8Array.from([1, 2, 3])),
    g.campo.inteiro(2, 86399912947),
    g.campo.texto(3, 'https://exemplo.invalido/'),
    g.campo.texto(4, 'chave-falsa'));
  assert.deepEqual(g.lerProvedor(t), { token: 'AQID', expiraEmMs: 86399912, base: 'https://exemplo.invalido/', chave: 'chave-falsa' });
});

// ── enquadramento gRPC-web ─────────────────────────────────────────────────

function quadro(flag, corpo) {
  const q = new Uint8Array(5 + corpo.length);
  q[0] = flag;
  new DataView(q.buffer).setUint32(1, corpo.length);
  q.set(corpo, 5);
  return q;
}
const b64 = (u8) => btoa(String.fromCharCode(...u8));

test('gRPC-web: ida e volta, com dados e trailer em pedaços de base64 EMENDADOS', () => {
  const dados = res('atualizarPosicao');
  assert.equal(g.quadroGrpcWebTexto(dados), b64(quadro(0, dados)), 'o quadro do pedido mudou');
  const trailer = new TextEncoder().encode('grpc-status:0\r\ngrpc-message:\r\n');
  // Cada quadro no seu próprio base64 com padding — é o que o servidor manda.
  const texto = b64(quadro(0, dados)) + b64(quadro(0x80, trailer));
  assert.ok(texto.slice(0, -4).includes('='), 'pré-condição: o padding tem que cair NO MEIO do texto');
  const r = g.lerRespostaGrpcWeb(texto);
  assert.equal(r.status, 0);
  assert.equal(hex(r.dados), hex(dados));
});

test('gRPC-web: a mensagem de erro chega com escape de URL e sai legível', () => {
  const trailer = new TextEncoder().encode("grpc-status:7\r\ngrpc-message:(403) cannot modify another user%27s data, Code 101\r\n");
  const r = g.lerRespostaGrpcWeb(b64(quadro(0x80, trailer)));
  assert.equal(r.status, 7);
  assert.equal(r.dados, null);
  assert.equal(r.mensagem, "(403) cannot modify another user's data, Code 101");
  assert.equal(g.decodificarMensagemGrpc('%E0%A4%A'), '%E0%A4%A', 'escape quebrado não pode derrubar a leitura');
});

test('gRPC-web: resposta sem trailer devolve status null (quem chama olha os cabeçalhos)', () => {
  const r = g.lerRespostaGrpcWeb(b64(quadro(0, res('perfis'))));
  assert.equal(r.status, null);
  assert.deepEqual(g.lerPerfis(r.dados), [{ id: '183164343', nome: 'cafanha' }]);
});

// ── protobuf ───────────────────────────────────────────────────────────────

test('protobuf: coordenada negativa viaja em 10 bytes e volta igual', () => {
  const corpo = g.corpoListarOnline([-141.349438, -52.304068, 62.787579, 31.044247]);
  const caixa = g.lerCampos(um(g.lerCampos(corpo), 1));
  const a = g.lerCampos(um(caixa, 1));
  assert.equal(Number(BigInt.asIntN(64, um(a, 101))), -141349438);
  assert.equal(Number(BigInt.asIntN(64, um(a, 102))), -52304068);
});

test('protobuf: bytes truncados ou tipo de fio desconhecido LANÇAM (nunca leem lixo)', () => {
  const bom = res('perfis');
  assert.throws(() => g.lerCampos(bom.subarray(0, bom.length - 3)), /truncado/);
  assert.throws(() => g.lerCampos(Uint8Array.from([0x0b])), /tipo de fio/);
  assert.throws(() => g.lerCampos(Uint8Array.from([0x00, 0x01])), /campo 0/);
});

test('presença: pedir nada para atualizar é erro de programação, não pedido vazio', () => {
  assert.throws(() => g.corpoAtualizarPresenca({ userId: 1 }), /nada a atualizar/);
});
