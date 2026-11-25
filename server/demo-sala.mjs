// ═══════════════════════════════════════════════════════════════════════════
//  A SALA da demo: a máquina de estados, PURA
// ═══════════════════════════════════════════════════════════════════════════
//
// Uma sala é uma demo no ar: o saguão que enche, a contagem, a triagem (cada um
// no seu ritmo, ou o apresentador conduzindo um pedido por vez), a pausa e o
// fim. Aqui mora SÓ a regra. Quem guarda o estado e empurra as mudanças pros
// celulares é o adaptador (o Durable Object no Worker, um gerenciador em
// memória na VM); os dois chamam as mesmas funções, e é por isso que elas não
// leem relógio, não guardam nada e não falam com a rede: `agora` entra como
// argumento, e o teste anda o tempo.
//
// O contrato com o adaptador, em quatro verbas:
//   · `novaSala(cfg, agora)`        o estado inicial;
//   · `aplicar(est, req, agora)`    uma AÇÃO (muda o estado, devolve {ok,…});
//   · `visao(est, ator, parte, agora)`  o que ESTE cliente pode ver agora;
//   · `proximoPrazo(est)`           quando o adaptador deve acordar de novo.
//
// Regras de produto que moram aqui (cada uma com teste):
//   · o voto vale a PRIMEIRA vez (o Desfazer é desligado na demo);
//   · no modo sincronizado só se vota no pedido em foco, enquanto ele não foi
//     revelado; no livre, em qualquer um;
//   · o voto do apresentador (a referência) fica escondido até a revelação;
//   · a barra de votos do sincronizado não existe pro convidado antes da
//     revelação;
//   · o teto de pessoas e a janela de votação são do servidor, não do cliente.
import { limparApelido, limparPais, DEMO_APELIDO_MAX } from './demo.mjs';
import { analisar, contarVotos as contar, contarPalpites, maioriaDe as maioria, pedidoVisivel } from './demo-resultado.mjs';

export const SALA_CONTAGEM_MS = 3000;
export const SALA_RECADO_MS = 6000;
export const SALA_RECADO_MAX = 60;
// Um voto que sai do celular um instante antes do fim do tempo chega um
// instante depois: a revelação automática espera essa folga.
export const SALA_GRACA_MS = 1500;
export const MODOS = ['livre', 'sinc'];
export const TEMPOS_MS = [0, 10000, 20000, 30000];
export const SALA_TOTAL_MAX = 60;

const VOTO = new Set(['R', 'L', 'P']);
const NADA = '-';
const hex = (s, n) => typeof s === 'string' && s.length === n && /^[0-9a-f]+$/.test(s);
const inteiro = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

// Comparação em tempo constante da chave do apresentador (já em hash).
function mesmoHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const troca = (s, i, c) => s.slice(0, i) + c + s.slice(i + 1);

// ── o estado inicial ────────────────────────────────────────────────────────
export function validarConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return 'config';
  if (!hex(cfg.id, 40)) return 'id';
  if (!hex(cfg.hostHash, 64)) return 'hostHash';
  if (!MODOS.includes(cfg.modo)) return 'modo';
  if (!TEMPOS_MS.includes(cfg.tempoMs)) return 'tempoMs';
  if (typeof cfg.referencia !== 'boolean') return 'referencia';
  if (!inteiro(cfg.total, 1, SALA_TOTAL_MAX)) return 'total';
  if (!inteiro(cfg.max, 1, 300)) return 'max';
  for (const k of ['criadoEm', 'votosAte', 'expiraEm']) if (!Number.isFinite(cfg[k])) return k;
  return null;
}

export function novaSala(cfg, agora) {
  const erro = validarConfig(cfg);
  if (erro) throw new Error('config da sala inválida: ' + erro);
  return {
    v: 1,
    cfg: { id: cfg.id, hostHash: cfg.hostHash, modo: cfg.modo, tempoMs: cfg.tempoMs, referencia: cfg.referencia, total: cfg.total, max: cfg.max, criadoEm: cfg.criadoEm, votosAte: cfg.votosAte, expiraEm: cfg.expiraEm },
    fase: 'saguao', // saguao → contagem → andamento ⇄ pausada → encerrada
    seq: 0,
    criadoEm: agora,
    partes: {},
    ordem: [],
    atual: 0, // sincronizado: o pedido em foco (1..total)
    abertoEm: null,
    comecouEm: null, // o instante em que a contagem acabou e a triagem começou (a duração e o ritmo saem daqui)
    fimEm: null,
    revelados: [],
    restanteMs: null,
    contagemAte: null,
    recado: null,
    encerradoEm: null,
    motivoFim: null,
  };
}

const ehRevelado = (est, idx) => est.revelados.includes(idx);
const pessoas = (est) => est.ordem.filter((p) => p !== 'ref');

function novaParte(est, nome, pais, agora) {
  return { nome, pais: pais ?? null, em: agora, votos: NADA.repeat(est.cfg.total), palpites: NADA.repeat(est.cfg.total), terminouEm: null };
}

// O apelido que já existe vira "Maria 2": dois "Maria" no mesmo palco se
// confundem, e o resultado fala por apelido.
function apelidoLivre(est, nome) {
  const usados = new Set(est.ordem.map((p) => est.partes[p].nome.toLowerCase()));
  if (!usados.has(nome.toLowerCase())) return nome;
  for (let n = 2; n < 1000; n++) {
    const sufixo = ' ' + n;
    const candidato = [...nome].slice(0, DEMO_APELIDO_MAX - sufixo.length).join('') + sufixo;
    if (!usados.has(candidato.toLowerCase())) return candidato;
  }
  return nome;
}

// ── o tempo: o que muda sozinho ─────────────────────────────────────────────
// Devolve true se mudou algo. O adaptador chama isto no começo de TODA ação e
// no alarme de `proximoPrazo`: nenhuma regra depende de alguém estar chamando.
export function avancar(est, agora) {
  let mudou = false;
  if (est.fase === 'contagem' && agora >= est.contagemAte) {
    est.fase = 'andamento';
    est.contagemAte = null;
    est.comecouEm = agora;
    if (est.cfg.modo === 'sinc') abrirPedido(est, 1, agora);
    mudou = true;
  }
  if (est.fase === 'andamento' && est.cfg.modo === 'sinc' && est.fimEm !== null && !ehRevelado(est, est.atual) && agora >= est.fimEm + SALA_GRACA_MS) {
    est.revelados.push(est.atual); // o tempo acabou: a sala revela sozinha
    mudou = true;
  }
  if (est.recado && agora >= est.recado.ate) { est.recado = null; mudou = true; }
  if (est.fase !== 'encerrada' && agora >= est.cfg.votosAte) {
    encerrarSala(est, agora, 'prazo');
    mudou = true;
  }
  if (mudou) est.seq++;
  return mudou;
}

function abrirPedido(est, idx, agora) {
  est.atual = idx;
  est.abertoEm = agora;
  est.fimEm = est.cfg.tempoMs > 0 ? agora + est.cfg.tempoMs : null;
}
function encerrarSala(est, agora, motivo) {
  est.fase = 'encerrada';
  est.encerradoEm = agora;
  est.motivoFim = motivo;
  est.fimEm = null;
  est.restanteMs = null;
}

export function proximoPrazo(est) {
  if (est.fase === 'encerrada') return est.cfg.expiraEm;
  const prazos = [est.cfg.votosAte];
  if (est.fase === 'contagem') prazos.push(est.contagemAte);
  if (est.fase === 'andamento' && est.cfg.modo === 'sinc' && est.fimEm !== null && !ehRevelado(est, est.atual)) prazos.push(est.fimEm + SALA_GRACA_MS);
  if (est.recado) prazos.push(est.recado.ate);
  return Math.min(...prazos);
}

// Esta chave é a do apresentador? (O adaptador pergunta isso sem aplicar ação.)
export const ehApresentador = (est, hostHash) => mesmoHash(hostHash, est.cfg.hostHash);

// ── as ações ────────────────────────────────────────────────────────────────
const nao = (motivo) => ({ ok: false, motivo });

// O recado do apresentador aparece no topo do celular de todo mundo: sem
// controle bidi nem largura zero, uma linha só, no máximo SALA_RECADO_MAX.
function limparRecado(bruto) {
  if (typeof bruto !== 'string') return null;
  const limpo = bruto.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return limpo ? [...limpo].slice(0, SALA_RECADO_MAX).join('') : null;
}

function votoNoPedido(est, parte, idx, voto, agora, { ref }) {
  if (!inteiro(idx, 1, est.cfg.total)) return nao('indice');
  if (!VOTO.has(voto)) return nao('voto');
  const p = est.partes[parte];
  if (!p) return nao('fora-da-sala'); // quem nem entrou ouve isso antes de "ainda não começou"
  if (est.fase === 'encerrada') return nao('encerrada');
  if (est.fase !== 'andamento') return nao(est.fase === 'pausada' ? 'pausada' : 'nao-comecou');
  if (est.cfg.modo === 'sinc' && (idx !== est.atual || ehRevelado(est, idx))) return nao('fechada');
  if (p.votos[idx - 1] !== NADA) return { ok: true, repetido: true }; // vale a primeira
  p.votos = troca(p.votos, idx - 1, voto);
  if (!ref && !p.votos.includes(NADA)) p.terminouEm = agora;
  est.seq++;
  return { ok: true };
}

export function aplicar(est, req, agora) {
  if (!req || typeof req !== 'object') return nao('pedido');
  avancar(est, agora);
  const { tipo } = req;

  // ── convidado ──
  if (tipo === 'entrar') {
    if (est.fase === 'encerrada') return nao('encerrada');
    if (agora >= est.cfg.votosAte) return nao('prazo');
    if (typeof req.parte !== 'string' || !/^[A-Za-z0-9_-]{16,40}$/.test(req.parte)) return nao('parte');
    if (req.parte === 'ref') return nao('parte');
    const ja = est.partes[req.parte];
    if (ja) return { ok: true, nome: ja.nome, reentrou: true };
    const nome = limparApelido(req.nome);
    if (!nome) return nao('apelido');
    if (pessoas(est).length >= est.cfg.max) return nao('cheia');
    const final = apelidoLivre(est, nome);
    est.partes[req.parte] = novaParte(est, final, limparPais(req.pais), agora);
    est.ordem.push(req.parte);
    est.seq++;
    return { ok: true, nome: final };
  }
  if (tipo === 'votar') return votoNoPedido(est, req.parte, req.idx, req.voto, agora, { ref: false });
  if (tipo === 'palpitar') {
    if (est.cfg.modo !== 'sinc') return nao('modo');
    if (est.fase !== 'andamento') return nao(est.fase === 'encerrada' ? 'encerrada' : 'nao-comecou');
    if (!inteiro(req.idx, 1, est.cfg.total) || req.idx !== est.atual || ehRevelado(est, req.idx)) return nao('fechada');
    if (!VOTO.has(req.palpite)) return nao('voto');
    const p = est.partes[req.parte];
    if (!p) return nao('fora-da-sala');
    if (p.votos[req.idx - 1] === NADA) return nao('sem-voto'); // primeiro o voto, depois o palpite
    if (p.palpites[req.idx - 1] !== NADA) return { ok: true, repetido: true };
    p.palpites = troca(p.palpites, req.idx - 1, req.palpite);
    est.seq++;
    return { ok: true };
  }

  // ── apresentador ──
  if (req.ator !== 'host') return nao('tipo');
  if (!mesmoHash(req.hostHash, est.cfg.hostHash)) return nao('sem-permissao');
  switch (tipo) {
    case 'comecar':
      if (est.fase !== 'saguao') return nao('fase');
      if (pessoas(est).length < 1) return nao('sala-vazia');
      est.fase = 'contagem';
      est.contagemAte = agora + SALA_CONTAGEM_MS;
      est.seq++;
      return { ok: true };
    case 'revelar':
      if (est.cfg.modo !== 'sinc' || est.fase !== 'andamento') return nao('fase');
      if (ehRevelado(est, est.atual)) return { ok: true, repetido: true };
      est.revelados.push(est.atual);
      est.seq++;
      return { ok: true };
    case 'proximo':
      if (est.cfg.modo !== 'sinc' || est.fase !== 'andamento') return nao('fase');
      if (!ehRevelado(est, est.atual)) return nao('nao-revelado');
      if (est.atual >= est.cfg.total) encerrarSala(est, agora, 'fim');
      else abrirPedido(est, est.atual + 1, agora);
      est.seq++;
      return { ok: true };
    case 'pausar':
      if (est.fase !== 'andamento') return nao('fase');
      est.fase = 'pausada';
      est.restanteMs = est.fimEm !== null ? Math.max(0, est.fimEm - agora) : null;
      est.fimEm = null;
      est.seq++;
      return { ok: true };
    case 'retomar':
      if (est.fase !== 'pausada') return nao('fase');
      est.fase = 'andamento';
      if (est.cfg.modo === 'sinc' && est.restanteMs !== null) est.fimEm = agora + est.restanteMs;
      est.restanteMs = null;
      est.seq++;
      return { ok: true };
    case 'recado': {
      const limpo = limparRecado(req.texto);
      if (!limpo) return nao('recado');
      est.recado = { texto: limpo, ate: agora + SALA_RECADO_MS, n: est.seq + 1 };
      est.seq++;
      return { ok: true };
    }
    case 'encerrar':
      if (est.fase === 'encerrada') return { ok: true, repetido: true };
      encerrarSala(est, agora, 'apresentador');
      est.seq++;
      return { ok: true };
    case 'votarRef': {
      if (!est.cfg.referencia) return nao('sem-referencia');
      if (!est.partes.ref) { est.partes.ref = novaParte(est, 'Apresentador', null, agora); est.ordem.push('ref'); }
      return votoNoPedido(est, 'ref', req.idx, req.voto, agora, { ref: true });
    }
    default:
      return nao('tipo');
  }
}

// ── o que cada um VÊ ────────────────────────────────────────────────────────
function base(est, agora) {
  const sinc = est.cfg.modo === 'sinc';
  return {
    seq: est.seq,
    agora,
    fase: est.fase,
    modo: est.cfg.modo,
    total: est.cfg.total,
    tempoMs: est.cfg.tempoMs,
    referencia: est.cfg.referencia,
    naSala: pessoas(est).length,
    contagemAte: est.fase === 'contagem' ? est.contagemAte : null,
    atual: sinc ? est.atual : null,
    fimEm: sinc && est.fase === 'andamento' ? est.fimEm : null,
    restanteMs: est.fase === 'pausada' ? est.restanteMs : null,
    comecouEm: est.comecouEm ?? null,
    revelado: sinc ? ehRevelado(est, est.atual) : null,
    votaram: sinc && est.atual ? contar(est, est.atual).n : null,
    recado: est.recado && agora < est.recado.ate ? { texto: est.recado.texto, n: est.recado.n } : null,
    encerrada: est.fase === 'encerrada' ? { motivo: est.motivoFim } : null,
  };
}

// O voto de referência do apresentador, como ELE o vê numa tela que a sala também vê: o que ele já
// votou aparece como «*» (confirmação neutra, sem dizer qual), e o voto de verdade só sai quando o
// pedido pode ser mostrado. Sem isto o palco projetaria a resposta antes da revelação.
function refMascarada(est) {
  const r = est.partes.ref;
  if (!r) return null;
  return r.votos.split('').map((c, i) => (c === NADA ? NADA : pedidoVisivel(est, i + 1) ? c : '*')).join('');
}

const apelidos = (est) => pessoas(est).map((p) => est.partes[p].nome);

// `ator`: 'host' ou 'convidado' (com `parte`). O convidado NÃO recebe a barra do
// pedido em foco antes da revelação, nem o voto de ninguém: só contagens.
export function visao(est, ator, parte, agora) {
  const v = base(est, agora);
  const sinc = est.cfg.modo === 'sinc';
  if (ator === 'host') {
    v.papel = 'host';
    if (est.fase === 'saguao') v.nomes = apelidos(est);
    v.pessoas = pessoas(est).map((p) => {
      const x = est.partes[p];
      return { nome: x.nome, pais: x.pais, feitos: x.votos.split('').filter((c) => c !== NADA).length, terminou: x.terminouEm !== null };
    });
    // A divisão dos votos só sai quando já pode ser MOSTRADA (`pedidoVisivel`): no sincronizado, depois
    // da revelação; no livre, só no fim — a barra ao vivo orientaria quem ainda está votando.
    v.pedidos = Array.from({ length: est.cfg.total }, (_, i) => {
      const idx = i + 1;
      return pedidoVisivel(est, idx) ? contar(est, idx) : { n: contar(est, idx).n };
    });
    if (sinc && est.atual && ehRevelado(est, est.atual)) v.palpites = contarPalpites(est, est.atual);
    else if (sinc && est.atual) v.palpites = { n: contarPalpites(est, est.atual).n };
    v.ref = refMascarada(est);
    return v;
  }
  v.papel = 'convidado';
  if (est.fase === 'saguao') v.nomes = apelidos(est);
  const p = est.partes[parte];
  if (!p) { v.fora = true; return v; }
  v.nome = p.nome;
  v.votos = p.votos;
  v.palpites = p.palpites;
  if (sinc && est.atual && ehRevelado(est, est.atual)) {
    const c = contar(est, est.atual);
    v.sala = { ...c, maioria: maioria(c) };
    v.salaPalpites = contarPalpites(est, est.atual);
    if (est.cfg.referencia && est.partes.ref) v.refAtual = est.partes.ref.votos[est.atual - 1];
  }
  if (!sinc) v.feitos = p.votos.split('').filter((c) => c !== NADA).length;
  return v;
}

// O resultado do apresentador. A divisão dos votos obedece à MESMA regra da visão (`pedidoVisivel`):
// pedir o resultado no meio da demo não tira a barra que a visão esconde.
export function resultado(est) {
  const encerrada = est.fase === 'encerrada';
  const a = analisar(est);
  return {
    cfg: { modo: est.cfg.modo, tempoMs: est.cfg.tempoMs, total: est.cfg.total, referencia: est.cfg.referencia, criadoEm: est.cfg.criadoEm, votosAte: est.cfg.votosAte, expiraEm: est.cfg.expiraEm },
    fase: est.fase,
    comecouEm: est.comecouEm ?? null,
    encerradoEm: est.encerradoEm,
    motivoFim: est.motivoFim,
    pedidos: Array.from({ length: est.cfg.total }, (_, i) => {
      const idx = i + 1;
      return pedidoVisivel(est, idx) ? { ...contar(est, idx), maioria: a.pedidos[i].maioria, classe: a.pedidos[i].classe, topo: a.pedidos[i].topo } : { n: contar(est, idx).n };
    }),
    ref: refMascarada(est),
    pessoas: pessoas(est).map((p) => {
      const x = est.partes[p];
      const feitos = x.votos.split('').filter((c) => c !== NADA).length;
      // Quem votou o quê é do FIM: durante a demo o resultado diz só o avanço de cada um.
      return encerrada
        ? { nome: x.nome, pais: x.pais, votos: x.votos, palpites: x.palpites, feitos, entrouEm: x.em, terminouEm: x.terminouEm }
        : { nome: x.nome, pais: x.pais, feitos, entrouEm: x.em, terminouEm: x.terminouEm };
    }),
    analise: encerrada ? { premios: a.premios, resumo: a.resumo } : null,
  };
}
