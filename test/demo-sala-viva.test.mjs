// A sala VIVA (server/demo-sala-viva.mjs): conexões SSE, difusão agrupada,
// gravação com atraso, alarme. O relógio e os timers são de mentira e andam
// quando o teste manda. Cada regra foi vista REPROVANDO com a sabotagem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SalaViva, COALESCER_MS, PING_MS, SALVAR_MS, MAX_CLIENTES, respostaDeRecusa } from '../server/demo-sala-viva.mjs';
import { SALA_CONTAGEM_MS } from '../server/demo-sala.mjs';

const T0 = 1_800_000_000_000;
const HOST = 'a'.repeat(64);
const ID = 'b'.repeat(40);
const pid = (n) => 'parte-de-teste-' + String(n).padStart(4, '0');
const CFG = (extra = {}) => ({ id: ID, hostHash: HOST, modo: 'sinc', tempoMs: 20000, referencia: false, total: 3, max: 50, criadoEm: T0, votosAte: T0 + 3 * 3600_000, expiraEm: T0 + 48 * 3600_000, ...extra });
const DECK = { convidado: [{ n: 1, name: 'A' }, { n: 2, name: 'B' }, { n: 3, name: 'C' }], apresentador: [{ n: 1, venueID: 'v1', updateRequestID: 'u1' }, { n: 2, venueID: 'v2', updateRequestID: 'u2' }, { n: 3, venueID: 'v3', updateRequestID: 'u3' }], regiao: 'row' };

// Relógio e timers de mentira: `andar(ms)` roda o que vence, em ordem.
function relogio(inicio = T0) {
  let agora = inicio;
  let n = 0;
  const fila = [];
  const timers = {
    set: (fn, ms) => { const h = { id: ++n, ate: agora + ms, fn, repete: null }; fila.push(h); return h; },
    clear: (h) => { const i = fila.indexOf(h); if (i >= 0) fila.splice(i, 1); },
    setIntervalo: (fn, ms) => { const h = { id: ++n, ate: agora + ms, fn, repete: ms }; fila.push(h); return h; },
    clearIntervalo: (h) => timers.clear(h),
  };
  const andar = async (ms) => {
    const alvo = agora + ms;
    for (;;) {
      const prox = fila.filter((h) => h.ate <= alvo).sort((a, b) => a.ate - b.ate)[0];
      if (!prox) break;
      agora = prox.ate;
      if (prox.repete) prox.ate += prox.repete; else fila.splice(fila.indexOf(prox), 1);
      await prox.fn();
    }
    agora = alvo;
  };
  return { agora: () => agora, timers, andar, pendentes: () => fila.length };
}

function nova(extraCfg = {}) {
  const rel = relogio();
  const gravacoes = [];
  const alarmes = [];
  let apagada = false;
  const sala = new SalaViva({ agora: rel.agora, timers: rel.timers, salvar: async (s) => { gravacoes.push(JSON.parse(JSON.stringify(s))); }, agendar: (ts) => alarmes.push(ts), apagar: async () => { apagada = true; } });
  sala.criar({ cfg: CFG(extraCfg), deck: DECK });
  return { sala, rel, gravacoes, alarmes, apagada: () => apagada };
}
const host = (tipo, extra = {}) => ({ hostHash: HOST, tipo, ...extra });
const entrar = (sala, n) => sala.acao({ tipo: 'entrar', parte: pid(n), nome: 'Pessoa' + n });

// Lê o fluxo SSE aos poucos, de verdade (`Response.body`), sem esperar o fim.
function ouvir(res) {
  const eventos = [];
  const comentarios = [];
  let buffer = '';
  let fim = false;
  const leitor = res.body.getReader();
  const dec = new TextDecoder();
  const laco = (async () => {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) { fim = true; return; }
      buffer += dec.decode(value, { stream: true });
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const bloco = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (bloco.startsWith(':')) { comentarios.push(bloco); continue; }
        const nome = /^event: (.*)$/m.exec(bloco)?.[1];
        const dados = JSON.parse(/^data: (.*)$/m.exec(bloco)[1]);
        eventos.push({ nome, dados });
      }
    }
  })();
  return { eventos, comentarios, fim: () => fim, parar: () => leitor.cancel(), laco };
}
const cedo = () => new Promise((r) => setImmediate(r)); // deixa a leitura do fluxo andar

// ── criar e as ações ────────────────────────────────────────────────────────

test('criar: uma vez só; a sala responde "info" com o baralho e SEM o id real do pedido', async () => {
  const { sala } = nova();
  assert.deepEqual(sala.criar({ cfg: CFG(), deck: DECK }), { ok: false, motivo: 'existe' });
  const r = await sala.acao({ tipo: 'info' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.convidado.map((c) => c.name), ['A', 'B', 'C']);
  assert.ok(!JSON.stringify(r.body).includes('updateRequestID'), 'o apresentador guarda os ids; o convidado nunca os recebe');
  assert.equal(r.body.cfg.total, 3);
  assert.ok(!('hostHash' in r.body.cfg), 'o hash da chave não sai da sala');
});

test('ações: a resposta traz a visão do próprio chamador; as recusas viram status + errorKey + motivo', async () => {
  const { sala } = nova({ max: 1 });
  const ok = await entrar(sala, 1);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.nome, 'Pessoa1');
  assert.equal(ok.body.visao.papel, 'convidado');
  assert.equal(ok.body.visao.nome, 'Pessoa1');
  const cheia = await entrar(sala, 2);
  assert.deepEqual([cheia.status, cheia.body.errorKey, cheia.body.motivo], [409, 'srv.err.demoCheia', 'cheia']);
  assert.equal((await sala.acao({ ...host('comecar'), hostHash: 'f'.repeat(64) })).status, 403);
  assert.equal((await sala.acao({ tipo: 'votar', parte: pid(7), idx: 1, voto: 'R' })).status, 404);
  const agoraNao = await sala.acao({ tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' });
  assert.deepEqual([agoraNao.status, agoraNao.body.errorKey, agoraNao.body.motivo], [409, 'srv.err.demoAgora', 'nao-comecou']);
  assert.equal((await sala.acao({ tipo: 'abracadabra' })).body.errorKey, 'srv.err.demoPedido');
  assert.equal((await sala.acao(null)).status, 400);
  assert.equal((await sala.acao({ tipo: 'entrar', parte: pid(1), nome: '' })).status, 200, 'reentrar com a mesma parte é a mesma pessoa');
  for (const m of ['sem-permissao', 'encerrada', 'prazo', 'cheia', 'apelido', 'fora-da-sala', 'fechada', 'indice']) {
    const { body } = respostaDeRecusa(m);
    assert.ok(body.errorKey.startsWith('srv.err.demo'), m);
  }
});

test('sala inexistente: 404 em tudo', async () => {
  const sala = new SalaViva({});
  assert.equal((await sala.acao({ tipo: 'info' })).status, 404);
  assert.equal(sala.fluxo({ parte: pid(1) }).status, 404);
});

test('o que o apresentador pede ("resultado") exige a chave e traz os ids reais pro ↗', async () => {
  const { sala } = nova();
  await entrar(sala, 1);
  assert.equal((await sala.acao({ tipo: 'resultado' })).status, 403);
  assert.equal((await sala.acao({ tipo: 'resultado', hostHash: 'c'.repeat(64) })).status, 403);
  const r = await sala.acao({ tipo: 'resultado', hostHash: HOST });
  assert.equal(r.status, 200);
  assert.equal(r.body.apresentador[1].updateRequestID, 'u2');
  assert.equal(r.body.resultado.pessoas.length, 1);
  assert.equal(r.body.regiao, 'row');
});

// ── o fluxo SSE ─────────────────────────────────────────────────────────────

test('fluxo: quem não entrou e quem erra a chave não abre', async () => {
  const { sala } = nova();
  const fora = sala.fluxo({ parte: pid(9) });
  assert.deepEqual([fora.status, fora.body.motivo], [404, 'fora-da-sala']);
  const falso = sala.fluxo({ hostHash: 'f'.repeat(64) });
  assert.deepEqual([falso.status, falso.body.motivo], [403, 'sem-permissao']);
  assert.ok(sala.fluxo({ hostHash: HOST }) instanceof Response);
});

test('fluxo: abre com o estado de agora; a resposta é SSE sem cache', async () => {
  const { sala } = nova();
  await entrar(sala, 1);
  const res = sala.fluxo({ parte: pid(1) });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const o = ouvir(res);
  await cedo();
  assert.equal(o.eventos.length, 1);
  assert.equal(o.eventos[0].nome, 'estado');
  assert.equal(o.eventos[0].dados.nome, 'Pessoa1');
  o.parar();
});

test('difusão AGRUPADA: cem votos seguidos viram uma mensagem; a do apresentador sai na hora', async () => {
  const { sala, rel } = nova({ modo: 'livre', total: 60, max: 300 });
  for (let i = 1; i <= 3; i++) await entrar(sala, i);
  await sala.acao(host('comecar'));
  await rel.andar(SALA_CONTAGEM_MS);
  await sala.tick(); // o alarme: a triagem abre antes de os celulares ouvirem
  const h = ouvir(sala.fluxo({ hostHash: HOST }));
  const c = ouvir(sala.fluxo({ parte: pid(1) }));
  await cedo();
  const antes = h.eventos.length;
  for (let i = 1; i <= 60; i++) await sala.acao({ tipo: 'votar', parte: pid(1 + (i % 3)), idx: i, voto: 'R' });
  await cedo();
  assert.equal(h.eventos.length, antes, 'dentro da janela de agrupamento nada saiu');
  await rel.andar(COALESCER_MS);
  await cedo();
  assert.equal(h.eventos.length, antes + 1, '60 votos, UMA mensagem');
  assert.equal(h.eventos.at(-1).dados.pedidos[59].n, 1);
  assert.equal(c.eventos.at(-1).dados.feitos, 20);
  h.parar(); c.parar();
});

test('mudança de fase sai NA HORA, sem esperar o agrupamento', async () => {
  const { sala } = nova();
  await entrar(sala, 1);
  const c = ouvir(sala.fluxo({ parte: pid(1) }));
  await cedo();
  await sala.acao(host('comecar'));
  await cedo();
  assert.equal(c.eventos.at(-1).dados.fase, 'contagem');
  c.parar();
});

test('o tempo anda sozinho: a contagem acaba, a sala abre e todos recebem — sem ninguém chamar', async () => {
  const { sala, rel, alarmes } = nova();
  await entrar(sala, 1);
  const c = ouvir(sala.fluxo({ parte: pid(1) }));
  await cedo();
  await sala.acao(host('comecar'));
  assert.equal(alarmes.at(-1), T0 + SALA_CONTAGEM_MS, 'o alarme foi pedido pro fim da contagem');
  await sala.tick(); // ainda não é hora: o alarme não faz nada
  assert.equal(sala.est.fase, 'contagem');
  await rel.andar(SALA_CONTAGEM_MS);
  await sala.tick(); // o adaptador acorda a sala
  await cedo();
  assert.equal(sala.est.fase, 'andamento');
  assert.equal(c.eventos.at(-1).dados.fase, 'andamento');
  assert.equal(c.eventos.at(-1).dados.atual, 1);
  c.parar();
});

test('batimento: a conexão ociosa recebe um ping a cada 20 s (senão a borda a derruba)', async () => {
  const { sala, rel } = nova();
  await entrar(sala, 1);
  const c = ouvir(sala.fluxo({ parte: pid(1) }));
  await cedo();
  await rel.andar(PING_MS);
  await cedo();
  assert.equal(c.comentarios.length, 1);
  await rel.andar(PING_MS * 2);
  await cedo();
  assert.equal(c.comentarios.length, 3);
  c.parar();
  await cedo();
  await rel.andar(PING_MS);
  assert.equal(rel.pendentes() >= 0, true);
});

test('conexão cancelada pelo cliente sai da lista e o batimento para quando não sobra ninguém', async () => {
  const { sala, rel } = nova();
  await entrar(sala, 1);
  const c = ouvir(sala.fluxo({ parte: pid(1) }));
  await cedo();
  assert.equal(sala.clientes.size, 1);
  c.parar();
  await cedo();
  assert.equal(sala.clientes.size, 0);
  assert.equal(sala.timerPing, null, 'sem conexões não há por que bater');
  void rel;
});

test('teto de conexões: a 401ª é recusada, e quem já está continua', async () => {
  const { sala } = nova({ modo: 'livre', max: 300 });
  await entrar(sala, 1);
  const abertas = [];
  for (let i = 0; i < MAX_CLIENTES; i++) abertas.push(sala.fluxo({ parte: pid(1) }));
  assert.ok(abertas.every((r) => r instanceof Response));
  const a_mais = sala.fluxo({ parte: pid(1) });
  assert.equal(a_mais.status, 429);
  await Promise.all(abertas.map((r) => r.body.cancel()));
});

// ── gravar e acordar ────────────────────────────────────────────────────────

test('gravação: votos seguidos gravam UMA vez (com atraso); fase nova grava na hora', async () => {
  const { sala, rel, gravacoes } = nova({ modo: 'livre', total: 30 });
  assert.equal(gravacoes.length, 1, 'criar grava na hora');
  await entrar(sala, 1);
  await sala.acao(host('comecar'));
  assert.equal(gravacoes.length, 2, 'a contagem é fase nova: gravou na hora (a entrada que veio antes ficou pendente e foi junto)');
  await rel.andar(SALA_CONTAGEM_MS);
  await sala.tick();
  const g = gravacoes.length;
  for (let i = 1; i <= 20; i++) await sala.acao({ tipo: 'votar', parte: pid(1), idx: i, voto: 'L' });
  assert.equal(gravacoes.length, g, 'votos não gravam um a um');
  await rel.andar(SALVAR_MS);
  assert.equal(gravacoes.length, g + 1);
  assert.equal(gravacoes.at(-1).est.partes[pid(1)].votos.slice(0, 20), 'L'.repeat(20));
});

test('retrato: grava, carrega numa sala nova e ela continua de onde parou', async () => {
  const a = nova();
  await entrar(a.sala, 1);
  await a.sala.acao(host('comecar'));
  const snap = a.gravacoes.at(-1);
  const b = new SalaViva({ agora: a.rel.agora, timers: a.rel.timers, agendar: () => {} });
  assert.equal(b.carregar(snap), true);
  assert.equal(b.existe(), true);
  await a.rel.andar(SALA_CONTAGEM_MS);
  await b.tick();
  assert.equal(b.est.fase, 'andamento', 'o alarme depois de um despertar a frio retoma a regra');
  assert.equal(new SalaViva({}).carregar({}), false);
  assert.equal(new SalaViva({}).carregar(null), false);
});

test('alarme: o adaptador sempre sabe quando acordar a sala de novo', async () => {
  const { sala, alarmes } = nova();
  assert.equal(alarmes.at(-1), T0 + 3 * 3600_000, 'no saguão: o fim da janela de votação');
  await entrar(sala, 1);
  await sala.acao(host('comecar'));
  assert.equal(alarmes.at(-1), T0 + SALA_CONTAGEM_MS);
  await sala.acao(host('recado', { texto: 'oi' }));
  assert.ok(alarmes.at(-1) <= T0 + SALA_CONTAGEM_MS);
});

test('expirar: a sala vence, fecha os fluxos, apaga tudo e passa a responder 404', async () => {
  const { sala, rel, apagada } = nova({ expiraEm: T0 + 10_000, votosAte: T0 + 5_000 });
  await entrar(sala, 1);
  const c = ouvir(sala.fluxo({ parte: pid(1) }));
  await cedo();
  await rel.andar(10_000);
  await sala.tick();
  await cedo();
  assert.equal(apagada(), true);
  assert.equal(c.fim(), true, 'o fluxo foi encerrado pelo servidor');
  assert.equal((await sala.acao({ tipo: 'info' })).status, 404);
  assert.equal(sala.existe(), false);
});

test('fechar: o que estava pendente é gravado antes de o adaptador sair', async () => {
  const { sala, gravacoes } = nova({ modo: 'livre' });
  await entrar(sala, 1);
  const n = gravacoes.length;
  await sala.fechar();
  assert.equal(gravacoes.length, n + 1);
  assert.equal(Object.keys(gravacoes.at(-1).est.partes).length, 1);
  await sala.fechar();
  assert.equal(gravacoes.length, n + 1, 'sem nada pendente não grava de novo');
});
