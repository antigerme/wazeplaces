// wme-grpc.mjs — o fio gRPC-web da presença e do chat do Waze, sem I/O.
//
// PURO de propósito, como o `marca-app.mjs`: nada de fetch, relógio, cripto ou
// plataforma. Monta e lê bytes; quem chama o Waze é o `core.mjs`
// (`callWazeGrpc`). Roda igual no Worker e no Node, por isso só usa
// `Uint8Array`, `TextEncoder`/`TextDecoder` e `btoa`/`atob` (nada de Buffer).
//
// De onde vem cada formato (MEDIDO em 2026-09-23, gravações do owner + WME
// v2.370 + chamadas ao vivo com as contas antigerme e cafanha):
//
//   · PRESENÇA — `com.waze.mapeditor.web.api.MapEditorWebServer`, em
//     `/<região>-Descartes/grpc/`. É o que o WME chama para mostrar e mover os
//     avatares de “editores online”. A lista é PÚBLICA (responde sem cookie); a
//     escrita exige o cookie DA PRÓPRIA pessoa e o id dela — com o id de outra
//     o Waze recusa (status 7, “cannot modify another user's data”), e sem id
//     também (status 3). A pessoa some da lista ~15 min depois da ÚLTIMA
//     atualização, de posição ou de visibilidade; a visibilidade fica gravada
//     no perfil.
//
//   · CHAT — `com.waze.wmp.Messaging` e `…MessagingHistory`, em `/<geoEnv>-wmp/`.
//     O backend é global: `row-wmp`, `na-wmp` e `il-wmp` devolvem a mesma coisa
//     (`usa-wmp` dá 404). O REMETENTE é o dono do cookie: mandado trocado ou
//     omitido, o Waze grava como vindo da sessão.
//
// Os bytes que o WME manda estão travados em test/wme-grpc.test.mjs contra
// quadros REAIS das gravações — construtor que diverge do WME reprova.

// ─────────────────────────────────────────────────────────────────────────
// protobuf — montar
// ─────────────────────────────────────────────────────────────────────────

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

// varint de 64 bits. Negativo vira complemento de 2 em 10 bytes, que é como o
// int64 do protobuf viaja — é o caso das coordenadas (graus × 1e6).
function varint(valor) {
  let x = BigInt.asUintN(64, BigInt(valor));
  const out = [];
  do {
    let b = Number(x & 0x7fn);
    x >>= 7n;
    if (x) b |= 0x80;
    out.push(b);
  } while (x);
  return Uint8Array.from(out);
}

export function junta(...partes) {
  const lista = partes.filter(Boolean);
  let total = 0;
  for (const p of lista) total += p.length;
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of lista) { out.set(p, i); i += p.length; }
  return out;
}

const chave = (n, tipo) => varint((n << 3) | tipo);
const comTamanho = (n, bytes) => junta(chave(n, 2), varint(bytes.length), bytes);

export const campo = {
  inteiro: (n, v) => junta(chave(n, 0), varint(v)),
  bool: (n, v) => junta(chave(n, 0), varint(v ? 1 : 0)),
  texto: (n, s) => comTamanho(n, codificador.encode(String(s))),
  bytes: (n, b) => comTamanho(n, b),
  msg: (n, ...partes) => comTamanho(n, junta(...partes)),
};

// ─────────────────────────────────────────────────────────────────────────
// protobuf — ler
// ─────────────────────────────────────────────────────────────────────────

function lerVarint(u8, i) {
  let r = 0n;
  let desloc = 0n;
  for (let k = 0; k < 10; k++) {
    if (i >= u8.length) throw new Error('protobuf truncado');
    const b = u8[i++];
    r |= BigInt(b & 0x7f) << desloc;
    if (!(b & 0x80)) return [r, i];
    desloc += 7n;
  }
  throw new Error('varint longo demais');
}

// Lista plana dos campos de UMA mensagem: [{ n, t, v }]. `v` é BigInt no
// varint e Uint8Array no resto. Não desce em mensagem aninhada: quem lê sabe o
// esquema e desce campo a campo — adivinhar pelo formato já confundiu texto
// curto com mensagem, e aqui não há por que adivinhar.
export function lerCampos(u8) {
  const out = [];
  let i = 0;
  while (i < u8.length) {
    let k;
    [k, i] = lerVarint(u8, i);
    const n = Number(k >> 3n);
    const t = Number(k & 7n);
    if (n <= 0) throw new Error('campo 0');
    if (t === 0) {
      let v;
      [v, i] = lerVarint(u8, i);
      out.push({ n, t, v });
    } else if (t === 2) {
      let tam;
      [tam, i] = lerVarint(u8, i);
      const fim = i + Number(tam);
      if (fim > u8.length) throw new Error('protobuf truncado');
      out.push({ n, t, v: u8.subarray(i, fim) });
      i = fim;
    } else if (t === 1 || t === 5) {
      const fim = i + (t === 1 ? 8 : 4);
      if (fim > u8.length) throw new Error('protobuf truncado');
      out.push({ n, t, v: u8.subarray(i, fim) });
      i = fim;
    } else {
      throw new Error('tipo de fio desconhecido: ' + t);
    }
  }
  return out;
}

const todos = (campos, n) => campos.filter((c) => c.n === n).map((c) => c.v);
const um = (campos, n) => {
  for (const c of campos) if (c.n === n) return c.v;
  return undefined;
};
// int64 com sinal → Number. Os valores daqui (ids, milissegundos, graus × 1e6)
// cabem folgados no inteiro seguro do JavaScript.
const numero = (v) => (typeof v === 'bigint' ? Number(BigInt.asIntN(64, v)) : null);
const textoDe = (v) => (v instanceof Uint8Array ? decodificador.decode(v) : null);
const sub = (v) => (v instanceof Uint8Array ? lerCampos(v) : []);

// ─────────────────────────────────────────────────────────────────────────
// gRPC-web texto: o corpo é base64 de quadros [1 byte flag][4 bytes tamanho]
// ─────────────────────────────────────────────────────────────────────────

function paraBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function deBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function quadroGrpcWebTexto(mensagem) {
  const q = new Uint8Array(5 + mensagem.length);
  q[0] = 0;
  new DataView(q.buffer).setUint32(1, mensagem.length);
  q.set(mensagem, 5);
  return paraBase64(q);
}

// A resposta pode chegar em VÁRIOS pedaços de base64 emendados, cada um com o
// próprio padding (um por quadro, é o que o servidor faz): decodificar tudo de
// uma vez quebra no primeiro `=` do meio.
function base64Emendado(texto) {
  const limpo = String(texto).replace(/\s+/g, '');
  const partes = [];
  let ini = 0;
  for (let i = 3; i < limpo.length; i += 4) {
    if (limpo[i] === '=') { partes.push(deBase64(limpo.slice(ini, i + 1))); ini = i + 1; }
  }
  if (ini < limpo.length) partes.push(deBase64(limpo.slice(ini)));
  return junta(...partes);
}

// { dados, status, mensagem }. `status` null quando a resposta não trouxe
// trailer (quem chama pode achá-lo nos cabeçalhos HTTP — resposta só de
// trailer, que o Waze usa nos erros, às vezes vem assim).
//
// Quadro que declara mais bytes do que chegaram LANÇA, como o `lerCampos` faz
// com protobuf truncado. O `subarray` não reclama de fim além do fim — devolvia
// só o pedaço que veio —, e uma resposta cortada no meio, sem trailer e com
// HTTP 200, era lida como completa: metade da lista de online virava a lista
// inteira, com sucesso (auditoria de 2026-09-26). Lançando, o `callWazeGrpc`
// a marca `malformada`, e sem status isso é `transient` — cortar é de rede.
export function lerRespostaGrpcWeb(texto) {
  const bytes = base64Emendado(texto);
  let dados = null;
  let trailer = '';
  let i = 0;
  while (i + 5 <= bytes.length) {
    const flag = bytes[i];
    const tam = new DataView(bytes.buffer, bytes.byteOffset + i + 1, 4).getUint32(0);
    if (i + 5 + tam > bytes.length) throw new Error('quadro gRPC-web truncado');
    const corpo = bytes.subarray(i + 5, i + 5 + tam);
    i += 5 + tam;
    if (flag & 0x80) trailer += decodificador.decode(corpo);
    else if (dados === null) dados = corpo;
  }
  const st = /grpc-status:\s*(\d+)/i.exec(trailer);
  const msg = /grpc-message:\s*([^\r\n]*)/i.exec(trailer);
  return { dados, status: st ? Number(st[1]) : null, mensagem: msg ? decodificarMensagemGrpc(msg[1]) : '' };
}

// A mensagem de erro do gRPC vem com escape de URL; malformada, fica crua.
export function decodificarMensagemGrpc(s) {
  try { return decodeURIComponent(String(s)); } catch { return String(s); }
}

// ─────────────────────────────────────────────────────────────────────────
// PRESENÇA
// ─────────────────────────────────────────────────────────────────────────

export const SERVICO_PRESENCA = 'com.waze.mapeditor.web.api.MapEditorWebServer';

// Ponto do Waze: 101 = longitude, 102 = latitude, em graus × 1e6. A ordem é a
// do GeoJSON ([lon, lat]) — ler ao contrário dá um lugar plausível e errado.
const ponto = (n, lon, lat) => campo.msg(n, campo.inteiro(101, Math.round(lon * 1e6)), campo.inteiro(102, Math.round(lat * 1e6)));
const lerPonto = (v) => {
  const c = sub(v);
  const lon = numero(um(c, 101));
  const lat = numero(um(c, 102));
  return lon === null || lat === null ? null : { lon: lon / 1e6, lat: lat / 1e6 };
};

// caixa = [lonMin, latMin, lonMax, latMax], a mesma ordem das caixas do app.
export function corpoListarOnline(caixa) {
  const [lonMin, latMin, lonMax, latMax] = caixa;
  return campo.msg(1, ponto(1, lonMin, latMin), ponto(2, lonMax, latMax));
}

// Posição e/ou visibilidade numa chamada só. O WME manda uma de cada vez (a
// posição a cada movimento do mapa, a visibilidade no interruptor); com uma só,
// os bytes são os dele — travado no teste.
export function corpoAtualizarPresenca({ userId, lat, lon, visivel }) {
  const temPosicao = Number.isFinite(lat) && Number.isFinite(lon);
  const temVisivel = typeof visivel === 'boolean';
  if (!temPosicao && !temVisivel) throw new Error('nada a atualizar');
  const editor = [campo.inteiro(1, userId)];
  const caminhos = [];
  if (temPosicao) { editor.push(ponto(2, lon, lat)); caminhos.push(campo.texto(1, 'location')); }
  if (temVisivel) { editor.push(campo.bool(3, visivel)); caminhos.push(campo.texto(1, 'visible')); }
  return junta(campo.msg(1, ...editor), campo.msg(2, ...caminhos), campo.bool(3, true));
}

export function lerEditorOnline(u8) {
  const c = lerCampos(u8);
  const pos = um(c, 2) ? lerPonto(um(c, 2)) : null;
  const vis = um(c, 3);
  const rank = um(c, 5);
  return {
    id: numero(um(c, 1)),
    nome: textoDe(um(c, 4)),
    // rank CRU, como o Waze manda (0-indexado; a tela soma 1 — gotcha #15)
    rank: rank === undefined ? null : numero(rank),
    visivel: vis === undefined ? null : vis !== 0n,
    lat: pos ? pos.lat : null,
    lon: pos ? pos.lon : null,
  };
}

// Resposta vazia (ninguém online na caixa) vem com o quadro de dados VAZIO.
export function lerListaOnline(u8) {
  if (!u8 || !u8.length) return [];
  return todos(lerCampos(u8), 1).map(lerEditorOnline);
}

// ─────────────────────────────────────────────────────────────────────────
// CHAT (WMP)
// ─────────────────────────────────────────────────────────────────────────

export const SERVICO_MENSAGENS = 'com.waze.wmp.Messaging';
export const SERVICO_HISTORICO = 'com.waze.wmp.MessagingHistory';

// Cabeçalho de toda chamada: id da requisição, tipo de aparelho (100 = WEB),
// id da INSTALAÇÃO e o aplicativo (2 = WAZE_MAP_EDITOR, o mesmo que o WME usa).
// A instalação é o “aparelho” para o chat: cada uma ganha o próprio token do
// fluxo de tempo real, e a mesma instalação recebe sempre o mesmo token.
export function cabecalhoWmp({ requisicao, instalacao }) {
  return campo.msg(1, campo.texto(1, requisicao), campo.inteiro(2, 100), campo.texto(4, instalacao), campo.inteiro(6, 2));
}

// Identificador de conversa: 1 = pessoa (o id numérico do Waze, como texto).
const identificador = (n, id, tipo = 1) => campo.msg(n, campo.inteiro(1, tipo), campo.texto(2, String(id)));
const lerIdentificador = (v) => {
  const c = sub(v);
  return { tipo: numero(um(c, 1)), id: textoDe(um(c, 2)) };
};

// Contexto: pares chave/valor que viajam com a mensagem e voltam no histórico.
// O chat do WME não os mostra (usa um para o id de sugestão de edição);
// medido: um resumo de card de 2 KB voltou byte a byte.
const contexto = (obj) => campo.msg(5, ...Object.entries(obj).map(([k, v]) => campo.msg(4, campo.texto(1, k), campo.texto(2, v))));

// Mensagem: 1 hora (ms) · 2 id · 3 destino · 4 remetente · 5 contexto ·
// 6 classe (1 texto, 2 recibo) · 101 conteúdo · 102 recibo. A ordem dos campos
// é a do WME (por número), e é ela que mantém os bytes iguais aos dele.
//
// O REMETENTE é opcional porque o Waze o ignora: grava sempre o dono do cookie
// (medido mandando trocado e mandando sem). Vai quando se sabe, pra o pedido
// sair igual ao do WME.
function mensagem({ ts, id, para, de, ctx, classe, corpo }) {
  return campo.msg(2,
    campo.inteiro(1, ts),
    campo.texto(2, id),
    identificador(3, para),
    de != null ? identificador(4, de) : null,
    ctx && Object.keys(ctx).length ? contexto(ctx) : null,
    campo.inteiro(6, classe),
    corpo);
}

export function corpoEnviarTexto({ cabecalho, ts, id, para, de = null, texto, ctx = null }) {
  const conteudo = campo.msg(101, campo.inteiro(1, 1), campo.msg(101, campo.texto(1, texto)));
  return junta(cabecalho, mensagem({ ts, id, para, de, ctx, classe: 1, corpo: conteudo }));
}

// Recibo: 1 = entregue, 2 = lida. É mensagem também, mandada pelo cliente —
// é o que faz o ✓✓ aparecer para quem mandou.
export function corpoRecibo({ cabecalho, ts, id, para, de = null, tipo, ids }) {
  const recibo = campo.msg(102, campo.inteiro(1, tipo), ...ids.map((m) => campo.msg(2, campo.texto(1, m))));
  return junta(cabecalho, mensagem({ ts, id, para, de, classe: 2, corpo: recibo }));
}

// Página de conversas. A 1ª leva a marca de leitura (`lidoAte`, que vem da
// contagem de não lidas); as seguintes, `antesDe` = a atividade da última
// conversa da página anterior (é o que o WME faz — conferido na gravação).
export function corpoConversas({ cabecalho, antesDe = null, porPagina = 50, lidoAte = null }) {
  return junta(cabecalho,
    antesDe != null ? campo.inteiro(2, antesDe) : null,
    campo.inteiro(4, porPagina),
    lidoAte != null ? campo.inteiro(6, lidoAte) : null);
}

// Histórico de uma conversa. O campo 7 = 1 vai sempre, como no WME.
export function corpoMensagens({ cabecalho, com, antesDe = null, porPagina = 50 }) {
  return junta(cabecalho,
    identificador(2, com),
    antesDe != null ? campo.inteiro(3, antesDe) : null,
    campo.inteiro(5, porPagina),
    campo.inteiro(7, 1));
}

export const corpoSoCabecalho = (cabecalho) => cabecalho;
export const corpoMarcarLida = ({ cabecalho, com }) => junta(cabecalho, identificador(2, com));
export const corpoConfirmar = ({ cabecalho, ids }) => junta(cabecalho, ...ids.map((m) => campo.texto(2, m)));
export const corpoPerfis = ({ cabecalho, ids }) => junta(cabecalho, ...ids.map((m) => identificador(2, m)));

// ── leitura ──

export function lerMensagem(v) {
  const c = sub(v);
  const classe = numero(um(c, 6));
  const out = {
    id: textoDe(um(c, 2)),
    ts: numero(um(c, 1)),
    de: um(c, 4) ? lerIdentificador(um(c, 4)) : null,
    para: um(c, 3) ? lerIdentificador(um(c, 3)) : null,
    classe: classe === 1 ? 'texto' : classe === 2 ? 'recibo' : 'outro',
    texto: null,
    recibo: null,
    contexto: null,
  };
  if (um(c, 101)) {
    const conteudo = sub(um(c, 101));
    const t = um(conteudo, 101);
    if (t) out.texto = textoDe(um(sub(t), 1)) ?? '';
  }
  if (um(c, 102)) {
    const r = sub(um(c, 102));
    out.recibo = {
      tipo: ({ 1: 'entregue', 2: 'lida' })[numero(um(r, 1))] || 'outro',
      ids: todos(r, 2).map((info) => textoDe(um(sub(info), 1))),
    };
  }
  if (um(c, 5)) {
    const pares = todos(sub(um(c, 5)), 4).map(sub);
    out.contexto = Object.fromEntries(pares.map((p) => [textoDe(um(p, 1)), textoDe(um(p, 2))]));
  }
  return out;
}

export function lerEnvio(u8) {
  const c = lerCampos(u8);
  return { ts: numero(um(c, 1)), id: textoDe(um(c, 2)) };
}

export function lerConversas(u8) {
  if (!u8 || !u8.length) return { conversas: [], maisAntigas: false, lidoAte: null };
  const c = lerCampos(u8);
  const conversas = todos(c, 1).map((item) => {
    const i = sub(item);
    const perfil = um(i, 2) ? sub(um(i, 2)) : [];
    return {
      com: um(i, 1) ? lerIdentificador(um(i, 1)) : null,
      nome: textoDe(um(perfil, 2)),
      ultima: um(i, 3) ? lerMensagem(um(i, 3)) : null,
      naoLidas: numero(um(i, 4)) ?? 0,
      bloqueada: um(i, 5) !== undefined && um(i, 5) !== 0n,
      atividade: numero(um(i, 8)),
      silenciada: um(i, 9) !== undefined && um(i, 9) !== 0n,
    };
  });
  return { conversas, maisAntigas: um(c, 2) !== undefined, lidoAte: numero(um(c, 3)) };
}

export function lerMensagens(u8) {
  if (!u8 || !u8.length) return { mensagens: [], maisAntigas: false };
  const c = lerCampos(u8);
  return { mensagens: todos(c, 1).map(lerMensagem), maisAntigas: um(c, 2) !== undefined };
}

export function lerNaoLidas(u8) {
  if (!u8 || !u8.length) return { total: 0, lidoAte: null };
  const c = lerCampos(u8);
  const contagem = um(c, 1) ? sub(um(c, 1)) : [];
  return { total: numero(um(contagem, 1)) ?? 0, lidoAte: numero(um(c, 2)) };
}

export function lerPerfis(u8) {
  if (!u8 || !u8.length) return [];
  return todos(lerCampos(u8), 1).map((p) => {
    const c = sub(p);
    const idf = um(c, 1) ? lerIdentificador(um(c, 1)) : null;
    return { id: idf ? idf.id : null, nome: textoDe(um(c, 2)) };
  });
}

// Os ids devolvidos são dos RECIBOS que o próprio servidor gerou (entregue e
// lida) — marcar como lida já avisa o remetente, sem o cliente mandar nada.
export function lerMarcarLida(u8) {
  if (!u8 || !u8.length) return { recibos: [] };
  return { recibos: todos(lerCampos(u8), 2).map(textoDe) };
}

// Token do fluxo de tempo real (vale 24 h), endereço e chave. O token viaja em
// base64 porque é assim que o fluxo o recebe (`auth_token_payload`).
export function lerProvedor(u8) {
  const t = um(lerCampos(u8), 1);
  if (!t) return null;
  const c = sub(t);
  const token = um(c, 1);
  const expiraMicros = numero(um(c, 2));
  return {
    token: token ? paraBase64(token) : null,
    expiraEmMs: expiraMicros == null ? null : Math.floor(expiraMicros / 1000),
    base: textoDe(um(c, 3)),
    chave: textoDe(um(c, 4)),
  };
}
