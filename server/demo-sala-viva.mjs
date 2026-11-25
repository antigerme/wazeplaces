// ═══════════════════════════════════════════════════════════════════════════
//  A sala VIVA: o que o Durable Object e a VM têm em comum
// ═══════════════════════════════════════════════════════════════════════════
//
// `demo-sala.mjs` é a regra (pura). Isto aqui é a sala no ar: guarda o estado
// em memória, atende as ações, mantém as conexões SSE abertas e empurra a visão
// de cada um quando algo muda. O adaptador só entrega quatro coisas de fora:
//
//   agora()         o relógio (o teste o anda);
//   salvar(snap)    gravar o retrato da sala (o `storage` do DO, um arquivo na VM);
//   agendar(ts)     acordar o `tick` em `ts` (o alarme do DO, um setTimeout na VM);
//   apagar()        a sala venceu: some com tudo.
//
// Por que SSE e não WebSocket: o Node não tem servidor WebSocket (o CLAUDE.md
// registra isso), e o SSE é só uma resposta que não termina — a mesma `Response`
// serve nos dois lugares, sem escrever protocolo à mão. Quem fala PRO servidor
// usa um POST por ação. E a chave do apresentador viaja no CORPO, nunca na URL:
// por isso o cliente lê o fluxo com `fetch` (POST), não com `EventSource`.
//
// A difusão é AGRUPADA (COALESCER_MS): cem votos num segundo viram poucas
// mensagens por celular, em vez de cem. Ação do apresentador e mudança de fase
// saem na hora. O retrato é gravado com atraso (SALVAR_MS), porque cada gravação
// é uma linha escrita no plano grátis (100 mil/dia) — fora o instante em que a
// fase muda, que grava na hora.
import { novaSala, aplicar, avancar, visao, resultado, proximoPrazo, ehApresentador } from './demo-sala.mjs';

export const MAX_CLIENTES = 400;
export const COALESCER_MS = 250;
export const PING_MS = 20000;
export const SALVAR_MS = 3000;

const TIPOS_CONVIDADO = new Set(['entrar', 'votar', 'palpitar']);
const TIPOS_HOST = new Set(['comecar', 'revelar', 'proximo', 'pausar', 'retomar', 'recado', 'encerrar', 'votarRef']);
// As que mudam a fase da sala: saem pros celulares e pro disco sem esperar.
const URGENTES = new Set(['comecar', 'revelar', 'proximo', 'pausar', 'retomar', 'recado', 'encerrar']);

// O motivo cru da regra → o que o cliente recebe. `motivo` vai junto na resposta:
// quem decide o que mostrar (re-entrar, esperar, desistir) é o cliente.
const STATUS = {
  'sem-permissao': [403, 'srv.err.demoSemPermissao', 'Sem permissão'],
  encerrada: [409, 'srv.err.demoEncerrada', 'A demo já terminou'],
  prazo: [409, 'srv.err.demoEncerrada', 'A demo já terminou'],
  cheia: [409, 'srv.err.demoCheia', 'A sala está cheia'],
  apelido: [400, 'srv.err.demoApelido', 'Apelido inválido'],
  'fora-da-sala': [404, 'srv.err.demoForaDaSala', 'Você não está nesta sala'],
};
const AGORA_NAO = new Set(['fechada', 'fase', 'nao-comecou', 'pausada', 'nao-revelado', 'sem-voto', 'sala-vazia', 'modo', 'sem-referencia']);
export function respostaDeRecusa(motivo) {
  if (STATUS[motivo]) { const [status, errorKey, error] = STATUS[motivo]; return { status, body: { success: false, error, errorKey, motivo } }; }
  if (AGORA_NAO.has(motivo)) return { status: 409, body: { success: false, error: 'Agora não', errorKey: 'srv.err.demoAgora', motivo } };
  return { status: 400, body: { success: false, error: 'Pedido inválido', errorKey: 'srv.err.demoPedido', motivo } };
}

const naoAchou = () => ({ status: 404, body: { success: false, error: 'Demo não encontrada', errorKey: 'srv.err.demoNaoEncontrada' } });
const ENC = new TextEncoder();
const evento = (nome, dados, id) => ENC.encode(`event: ${nome}\n${id !== undefined ? `id: ${id}\n` : ''}data: ${JSON.stringify(dados)}\n\n`);
const PING = ENC.encode(': ping\n\n');

// Os timers do sistema, em FUNÇÕES: o `setTimeout` solto dentro de um objeto, chamado como
// `this.timers.set(...)`, leva `this` = o objeto, e o workerd (e o navegador) recusam com
// "Illegal invocation". O Node tolera, e é por isso que só o `wrangler dev` mostrou.
const TIMERS_DO_SISTEMA = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h),
  setIntervalo: (fn, ms) => setInterval(fn, ms),
  clearIntervalo: (h) => clearInterval(h),
};

export class SalaViva {
  constructor({ agora = Date.now, salvar = async () => {}, agendar = () => {}, apagar = async () => {}, timers = TIMERS_DO_SISTEMA } = {}) {
    this.agora = agora;
    this.salvar = salvar;
    this.agendar = agendar;
    this.apagar = apagar;
    this.timers = timers;
    this.est = null;
    this.deck = null; // { convidado: [...], apresentador: [...], regiao }
    this.clientes = new Set();
    this.timerDifusao = null;
    this.timerSalvar = null;
    this.timerPing = null;
    this.sujo = false;
    this.fechada = false;
  }

  existe() { return this.est !== null; }

  // ── ciclo de vida ──
  criar({ cfg, deck }) {
    if (this.est) return { ok: false, motivo: 'existe' };
    this.est = novaSala(cfg, this.agora());
    this.deck = deck;
    this._depoisDeMudar(true);
    return { ok: true };
  }
  carregar(snap) {
    if (!snap || !snap.est || !snap.deck) return false;
    this.est = snap.est;
    this.deck = snap.deck;
    this._agendar();
    return true;
  }
  snapshot() { return { est: this.est, deck: this.deck }; }

  // O alarme (ou o setTimeout) chegou: o tempo andou sozinho.
  async tick() {
    if (!this.est) return;
    const agora = this.agora();
    if (agora >= this.est.cfg.expiraEm) { await this.expirar(); return; }
    if (avancar(this.est, agora)) this._depoisDeMudar(true);
    else this._agendar();
  }
  async expirar() {
    this.fechada = true;
    for (const c of this.clientes) { try { c.controller.close(); } catch { /* já fechado */ } }
    this.clientes.clear();
    this._limparTimers();
    this.est = null;
    this.deck = null;
    await this.apagar();
  }

  // ── ações (POST) ──
  async acao(req) {
    if (!this.est) return naoAchou();
    const agora = this.agora();
    if (!req || typeof req !== 'object') return respostaDeRecusa('pedido');
    // O tempo que andou desde a última vez (contagem, relógio do pedido, recado):
    // aplicado ANTES de qualquer coisa, e difundido se mudou algo.
    if (avancar(this.est, agora)) this._depoisDeMudar(true);
    const { tipo } = req;
    if (tipo === 'info') return { status: 200, body: { success: true, ...this._info(), visao: this._visaoDe(req, agora) } };
    if (tipo === 'visao') {
      const v = this._visaoDe(req, agora);
      return v ? { status: 200, body: { success: true, visao: v } } : respostaDeRecusa('sem-permissao');
    }
    if (tipo === 'resultado') {
      if (!this._ehHost(req)) return respostaDeRecusa('sem-permissao');
      return { status: 200, body: { success: true, resultado: resultado(this.est), apresentador: this.deck.apresentador, regiao: this.deck.regiao, visao: visao(this.est, 'host', null, agora) } };
    }
    const doHost = TIPOS_HOST.has(tipo);
    if (!doHost && !TIPOS_CONVIDADO.has(tipo)) return respostaDeRecusa('tipo');
    const r = aplicar(this.est, doHost ? { ...req, ator: 'host' } : { ...req, ator: 'convidado' }, agora);
    if (!r.ok) return respostaDeRecusa(r.motivo);
    // A ENTRADA grava na hora (uma por pessoa: rara, e perdê-la numa eviction do DO tiraria a
    // pessoa da sala); o voto não — esse é agrupado, porque é o que mais acontece.
    this._depoisDeMudar(URGENTES.has(tipo), tipo === 'entrar');
    const { ok, ...resto } = r;
    return { status: 200, body: { success: true, ...resto, visao: this._visaoDe(req, agora) } };
  }

  _ehHost(req) { return req.hostHash !== undefined && ehApresentador(this.est, req.hostHash); }
  _visaoDe(req, agora) {
    if (req.hostHash !== undefined) return this._ehHost(req) ? visao(this.est, 'host', null, agora) : null;
    return visao(this.est, 'convidado', req.parte, agora);
  }
  _info() {
    const c = this.est.cfg;
    return { cfg: { modo: c.modo, tempoMs: c.tempoMs, total: c.total, referencia: c.referencia, max: c.max, votosAte: c.votosAte, expiraEm: c.expiraEm }, convidado: this.deck.convidado };
  }

  // ── o fluxo (SSE) ──
  fluxo(req) {
    if (!this.est) return naoAchou();
    const host = req.hostHash !== undefined;
    if (host && !this._ehHost(req)) return respostaDeRecusa('sem-permissao');
    if (!host && !this.est.partes[req.parte]) return respostaDeRecusa('fora-da-sala');
    // No teto, ANTES de recusar: sonda todos (um batimento agora). Cliente que o runtime já perdeu só
    // é percebido na escrita seguinte (no workerd, atrás do Worker, o `cancel` chega assim: ~um
    // batimento depois) — e sem isto o teto seria gasto por celulares que já saíram.
    if (this.clientes.size >= MAX_CLIENTES) this._sondar();
    if (this.clientes.size >= MAX_CLIENTES) return { status: 429, body: { success: false, error: 'Conexões demais', errorKey: 'srv.err.demoCheia', motivo: 'cheia' } };
    const cliente = { ator: host ? 'host' : 'convidado', parte: req.parte, controller: null, ultimoSeq: -1 };
    const corpo = new ReadableStream({
      start: (controller) => {
        cliente.controller = controller;
        this.clientes.add(cliente);
        this._enviar(cliente, this.agora());
        this._ligarPing();
      },
      cancel: () => { this.clientes.delete(cliente); if (!this.clientes.size) this._desligarPing(); },
    });
    return new Response(corpo, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  _enviar(cliente, agora) {
    const v = cliente.ator === 'host' ? visao(this.est, 'host', null, agora) : visao(this.est, 'convidado', cliente.parte, agora);
    if (v.seq === cliente.ultimoSeq) return;
    cliente.ultimoSeq = v.seq;
    try { cliente.controller.enqueue(evento('estado', v, v.seq)); } catch { this.clientes.delete(cliente); }
  }
  _difundir() {
    this.timerDifusao = null;
    if (!this.est) return;
    const agora = this.agora();
    for (const c of [...this.clientes]) this._enviar(c, agora);
  }
  _ligarPing() {
    if (this.timerPing) return;
    this.timerPing = this.timers.setIntervalo(() => this._sondar(), PING_MS);
    if (this.timerPing && typeof this.timerPing.unref === 'function') this.timerPing.unref();
  }
  // Um batimento em todos: mantém a conexão viva na borda (ociosa, ela cai) e tira quem já saiu.
  _sondar() {
    for (const c of [...this.clientes]) { try { c.controller.enqueue(PING); } catch { this.clientes.delete(c); } }
    if (!this.clientes.size) this._desligarPing();
  }
  _desligarPing() {
    if (this.timerPing) this.timers.clearIntervalo(this.timerPing);
    this.timerPing = null;
  }

  // ── o que fazer depois de mudar o estado ──
  _depoisDeMudar(urgente, gravarAgora = false) {
    this.sujo = true;
    if (urgente) {
      if (this.timerDifusao) { this.timers.clear(this.timerDifusao); this.timerDifusao = null; }
      this._difundir();
      this._gravarJa();
    } else {
      if (!this.timerDifusao) {
        this.timerDifusao = this.timers.set(() => this._difundir(), COALESCER_MS);
        if (this.timerDifusao && typeof this.timerDifusao.unref === 'function') this.timerDifusao.unref();
      }
      if (gravarAgora) this._gravarJa();
      else if (!this.timerSalvar) {
        this.timerSalvar = this.timers.set(() => { this.timerSalvar = null; this._gravarJa(); }, SALVAR_MS);
        if (this.timerSalvar && typeof this.timerSalvar.unref === 'function') this.timerSalvar.unref();
      }
    }
    this._agendar();
  }
  _gravarJa() {
    if (this.timerSalvar) { this.timers.clear(this.timerSalvar); this.timerSalvar = null; }
    if (!this.est || !this.sujo) return;
    this.sujo = false;
    Promise.resolve(this.salvar(this.snapshot())).catch(() => { this.sujo = true; });
  }
  _agendar() {
    if (this.est) this.agendar(Math.min(proximoPrazo(this.est), this.est.cfg.expiraEm));
  }
  _limparTimers() {
    for (const k of ['timerDifusao', 'timerSalvar']) if (this[k]) { this.timers.clear(this[k]); this[k] = null; }
    this._desligarPing();
  }

  // Gravar TUDO o que estiver pendente (antes de a VM sair, ou o DO ser descartado).
  async fechar() {
    this._limparTimers();
    if (this.est && this.sujo) { this.sujo = false; await this.salvar(this.snapshot()); }
  }
}
