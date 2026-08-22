// WebSocket (RFC 6455) do lado servidor, só com o que a sala usa — handshake,
// quadros de texto e o fechamento. Node puro, zero dependência.
//
// Existe porque o projeto tem DOIS servidores e a promessa é que a VM faça o
// mesmo que a Cloudflare. Lá o WebSocket é do runtime; aqui não há runtime que
// o traga, e trazer uma biblioteca custaria o `npm install` que o backend
// inteiro não tem ("zero dependências" é valor declarado, não acidente).
//
// O que ESTÁ implementado: handshake, quadros mascarados do cliente, texto,
// continuação (fragmentação), ping/pong, close, e teto de tamanho. O que NÃO
// está: extensões (permessage-deflate é negociado e recusado — a sala manda
// JSON pequeno) e quadros binários, que a sala não usa e portanto recusa.

import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP = { CONT: 0x0, TEXTO: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

/**
 * Responde ao upgrade e devolve uma conexão, ou `null` se o pedido não for um
 * handshake válido (aí o socket já foi encerrado).
 *
 * @param {number} maxBytes teto do payload remontado
 */
export function aceitarWebSocket(req, socket, maxBytes) {
  const chave = req.headers['sec-websocket-key'];
  const versao = String(req.headers['sec-websocket-version'] || '');
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (upgrade !== 'websocket' || !chave || versao !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(chave + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new ConexaoWS(socket, maxBytes);
}

class ConexaoWS {
  constructor(socket, maxBytes) {
    this.socket = socket;
    this.maxBytes = maxBytes || 65536;
    this.buf = Buffer.alloc(0);
    this.frag = null;          // remontagem de mensagem fragmentada
    this.fragTam = 0;
    this.fechada = false;
    this.ouvintes = { mensagem: [], fim: [] };

    socket.setNoDelay(true);
    socket.on('data', (d) => this.receber(d));
    // `end` E `close`, e o `end` é o que importa: o socket de um upgrade fica
    // meio-aberto (`allowHalfOpen`), então quando o outro lado some o Node
    // emite só `end` — `close` fica esperando NÓS fecharmos a escrita, o que
    // não acontece sozinho. Ouvindo só `close`, quem fechava a app continuava
    // na lista dos outros pra sempre: a presença deixava de ser a conexão.
    socket.on('end', () => this.encerrar());
    socket.on('close', () => this.encerrar());
    socket.on('error', () => this.encerrar());
  }

  on(evento, fn) { (this.ouvintes[evento] || []).push(fn); return this; }
  emitir(evento, arg) { for (const fn of this.ouvintes[evento] || []) { try { fn(arg); } catch { /* ouvinte ruim não derruba a conexão */ } } }

  receber(pedaco) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, pedaco]) : pedaco;
    // Um `data` do TCP pode trazer meio quadro, um quadro e meio, ou vários.
    // Tratar como "um data = um quadro" é o erro clássico daqui, e ele só
    // aparece com payload grande — exatamente o SDP.
    for (;;) {
      const q = this.lerQuadro();
      if (q === null) return;          // falta byte: espera o próximo `data`
      if (q === false) return;         // protocolo violado: já fechou
      this.tratar(q);
      if (this.fechada) return;
    }
  }

  lerQuadro() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const rsv = b[0] & 0x70;
    const op = b[0] & 0x0f;
    const mascarado = (b[1] & 0x80) !== 0;
    let tam = b[1] & 0x7f;
    let i = 2;

    // Quadro do CLIENTE tem que vir mascarado (RFC 6455 §5.1). Aceitar sem
    // máscara é o buraco que permite envenenar cache de proxy.
    if (!mascarado || rsv) { this.fechar(1002, 'protocolo'); return false; }

    if (tam === 126) {
      if (b.length < i + 2) return null;
      tam = b.readUInt16BE(i); i += 2;
    } else if (tam === 127) {
      if (b.length < i + 8) return null;
      const alto = b.readUInt32BE(i);
      // Payload de 4GB não é caso de uso: é alguém pedindo pra alocar memória.
      if (alto !== 0) { this.fechar(1009, 'grande demais'); return false; }
      tam = b.readUInt32BE(i + 4); i += 8;
    }
    if (tam > this.maxBytes) { this.fechar(1009, 'grande demais'); return false; }
    if (b.length < i + 4 + tam) return null;

    const mask = b.subarray(i, i + 4); i += 4;
    const dados = Buffer.allocUnsafe(tam);
    for (let k = 0; k < tam; k++) dados[k] = b[i + k] ^ mask[k & 3];
    this.buf = b.subarray(i + tam);
    return { fin, op, dados };
  }

  tratar(q) {
    if (q.op === OP.CLOSE) { this.fechar(1000, ''); return; }
    if (q.op === OP.PING) { this.enviarQuadro(OP.PONG, q.dados); return; }
    if (q.op === OP.PONG) return;
    if (q.op === OP.BIN) { this.fechar(1003, 'binario'); return; }

    if (q.op === OP.TEXTO) {
      if (!q.fin) { this.frag = [q.dados]; this.fragTam = q.dados.length; return; }
      this.emitir('mensagem', q.dados.toString('utf8'));
      return;
    }
    if (q.op === OP.CONT) {
      if (!this.frag) { this.fechar(1002, 'continuacao solta'); return; }
      this.fragTam += q.dados.length;
      // O teto vale pela mensagem REMONTADA: fragmentar não pode ser o jeito
      // de passar por cima do limite.
      if (this.fragTam > this.maxBytes) { this.fechar(1009, 'grande demais'); return; }
      this.frag.push(q.dados);
      if (q.fin) {
        const inteiro = Buffer.concat(this.frag);
        this.frag = null;
        this.emitir('mensagem', inteiro.toString('utf8'));
      }
    }
  }

  enviar(texto) { this.enviarQuadro(OP.TEXTO, Buffer.from(String(texto), 'utf8')); }

  enviarQuadro(op, dados) {
    if (this.fechada || this.socket.destroyed) return;
    const n = dados.length;
    let cab;
    // Quadro do SERVIDOR nunca é mascarado (RFC 6455 §5.1).
    if (n < 126) { cab = Buffer.allocUnsafe(2); cab[1] = n; }
    else if (n < 65536) { cab = Buffer.allocUnsafe(4); cab[1] = 126; cab.writeUInt16BE(n, 2); }
    else { cab = Buffer.allocUnsafe(10); cab[1] = 127; cab.writeUInt32BE(0, 2); cab.writeUInt32BE(n, 6); }
    cab[0] = 0x80 | op;
    try { this.socket.write(Buffer.concat([cab, dados])); } catch { this.encerrar(); }
  }

  fechar(codigo = 1000, motivo = '') {
    if (this.fechada) return;
    const m = Buffer.from(String(motivo), 'utf8');
    const dados = Buffer.allocUnsafe(2 + m.length);
    dados.writeUInt16BE(codigo, 0);
    m.copy(dados, 2);
    this.enviarQuadro(OP.CLOSE, dados);
    this.encerrar();
  }

  encerrar() {
    if (this.fechada) return;
    this.fechada = true;
    try { this.socket.end(); } catch { /* já foi */ }
    this.emitir('fim');
  }
}
