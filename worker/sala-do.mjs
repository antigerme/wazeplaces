// Durable Object da sala — o adaptador Cloudflare da presença.
//
// Um DO por FILA (`row:30`, `row:30:5`), criado pelo próprio nome. Ninguém
// cria sala: ela existe porque alguém pediu por ela, e some quando o último
// socket fecha. Não há storage: se este arquivo passar a gravar presença, a
// Ajuda passa a mentir (ver `server/presenca.mjs`).
//
// ── POR QUE WEBSOCKET, E NÃO POLLING ────────────────────────────────────────
// Custo. Polling de 30s são ~2.880 requisições por dia POR EDITOR; dez editores
// já comem um terço do free tier do Worker sem ninguém ter conversado. Um
// WebSocket é UMA requisição, e com a Hibernation API o DO não fica na memória
// entre mensagens — o runtime guarda os sockets e acorda o objeto só quando
// chega algo.
//
// `setWebSocketAutoResponse` fecha o círculo: o keepalive do cliente é
// respondido pelo RUNTIME, sem acordar o DO. Sem isso, um heartbeat de 45s
// acordaria o objeto 80 vezes por hora pra não fazer nada.

import { makeCrachas, base64ToBytes } from '../server/core.mjs';
import { listaDePares, limpar, MAX_BODY } from '../server/presenca.mjs';

// Teto de mensagens de sinalização por socket, por janela. Um aperto de mão
// WebRTC completo são ~30 mensagens (offer, answer e os candidatos ICE); 120
// dá folga de 4 conversas simultâneas e ainda barra quem varre a sala.
const TETO_SINAIS = 120;
const JANELA_MS = 60_000;

export class SalaDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.crachas = env.ENCRYPTION_KEY
      ? makeCrachas({ keyBytes: base64ToBytes(env.ENCRYPTION_KEY) })
      : null;
    // O keepalive nunca acorda o DO — o runtime responde por ele.
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    // Contador de vazão. Vive só na memória de propósito: quem está inundando
    // mantém o DO acordado, então o contador está lá justamente quando importa.
    this.vazao = new Map();
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Esperado WebSocket', { status: 426 });
    }
    if (!this.crachas) return new Response('Presença não configurada', { status: 500 });

    // A sala vem da URL porque é ela que escolhe QUAL Durable Object atende.
    // Mas ela não é a autoridade: o crachá também diz a sala, é assinado, e é
    // ele que decide se este socket entra aqui.
    const sala = limpar(new URL(request.url).searchParams.get('s'));
    const par = new WebSocketPair();
    const [cliente, servidor] = Object.values(par);

    // `acceptWebSocket` (e não `servidor.accept()`) é o que habilita a
    // hibernação: com `accept()` o DO fica vivo enquanto o socket existir.
    this.state.acceptWebSocket(servidor);
    servidor.serializeAttachment({ sala, ident: null });

    return new Response(null, { status: 101, webSocket: cliente });
  }

  // ── protocolo ─────────────────────────────────────────────────────────────

  async webSocketMessage(ws, msg) {
    // Frame gigante: recusa ANTES de tentar entender. Sem teto, um cliente
    // hostil manda megabytes e o parse acontece de qualquer jeito.
    if (typeof msg !== 'string' || msg.length > MAX_BODY) return this.fechar(ws, 4009, 'grande demais');

    let m;
    try { m = JSON.parse(msg); } catch { return; }
    if (!m || typeof m !== 'object') return;

    const anexo = ws.deserializeAttachment() || {};

    if (m.t === 'entrar') return this.entrar(ws, anexo, m);
    // Sem crachá conferido, nada mais é atendido: um socket anônimo não vê a
    // lista nem fala com ninguém.
    if (!anexo.ident) return this.fechar(ws, 4001, 'sem cracha');
    if (m.t === 'sinal') return this.sinal(ws, anexo, m);
    if (m.t === 'sair') return this.fechar(ws, 1000, 'saiu');
  }

  async entrar(ws, anexo, m) {
    const cracha = await this.crachas.conferir(m.cracha);
    if (!cracha) return this.fechar(ws, 4003, 'cracha invalido');
    // Crachá é assinado PARA uma sala. Sem esta linha, um crachá legítimo do
    // Brasil entraria na sala de Portugal: assinatura válida, lugar errado, e
    // erro nenhum aparece.
    if (cracha.sala !== anexo.sala) return this.fechar(ws, 4004, 'outra sala');

    const ident = {
      peer: cracha.peer, nome: cracha.nome, rank: cracha.rank,
      am: !!cracha.am, staff: !!cracha.staff,
    };
    ws.serializeAttachment({ sala: anexo.sala, ident });
    ws.send(JSON.stringify({ t: 'eu', peer: ident.peer }));
    this.difundirLista();
  }

  sinal(ws, anexo, m) {
    if (!this.temVazao(anexo.ident.peer)) return;
    const para = limpar(m.para);
    if (!para || para === anexo.ident.peer) return;

    const destinos = this.sockets().filter((s) => s.ident.peer === para);
    if (!destinos.length) {
      // Dizer que sumiu é melhor que o silêncio: o outro lado fica "chamando"
      // pra sempre e ninguém sabe se a mensagem foi entregue.
      ws.send(JSON.stringify({ t: 'ausente', peer: para }));
      return;
    }
    // `tipo` e `payload` passam OPACOS: são SDP e candidato ICE. A sala não
    // olha dentro, e a mensagem de verdade nem passa por aqui — ela vai
    // cifrada pelo DataChannel, direto entre os aparelhos.
    const fora = JSON.stringify({
      t: 'sinal', de: anexo.ident.peer, nome: anexo.ident.nome,
      tipo: String(m.tipo || '').slice(0, 24), payload: m.payload ?? null,
    });
    for (const d of destinos) { try { d.ws.send(fora); } catch { /* socket morrendo */ } }
  }

  // Fechou o socket = saiu da sala. Não há prazo, não há varredura: a presença
  // É a conexão.
  webSocketClose(ws) { this.difundirLista(ws); }
  webSocketError(ws) { this.difundirLista(ws); }

  // ── auxiliares ────────────────────────────────────────────────────────────

  sockets(exceto) {
    const out = [];
    for (const ws of this.state.getWebSockets()) {
      if (ws === exceto) continue;
      const a = ws.deserializeAttachment();
      if (a && a.ident) out.push({ ws, ident: a.ident });
    }
    return out;
  }

  difundirLista(saindo) {
    const presentes = this.sockets(saindo);
    for (const { ws, ident } of presentes) {
      const lista = listaDePares(presentes.map((p) => p.ident), ident.peer);
      try { ws.send(JSON.stringify({ t: 'lista', ...lista })); } catch { /* socket morrendo */ }
    }
  }

  temVazao(peer) {
    const agora = Date.now();
    const b = this.vazao.get(peer);
    if (!b || agora - b.desde > JANELA_MS) { this.vazao.set(peer, { desde: agora, n: 1 }); return true; }
    b.n += 1;
    return b.n <= TETO_SINAIS;
  }

  fechar(ws, codigo, motivo) {
    try { ws.close(codigo, motivo); } catch { /* já fechado */ }
    this.difundirLista(ws);
  }
}
