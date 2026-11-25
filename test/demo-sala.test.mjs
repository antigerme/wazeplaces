// A máquina de estados da sala da demo (server/demo-sala.mjs): PURA, então o
// teste anda o tempo com `agora`. Cada regra daqui foi vista REPROVANDO com a
// sabotagem (gotcha #28, pergunta 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  novaSala, aplicar, avancar, visao, resultado, proximoPrazo, validarConfig,
  SALA_CONTAGEM_MS, SALA_RECADO_MS, SALA_GRACA_MS, SALA_RECADO_MAX,
} from '../server/demo-sala.mjs';

const T0 = 1_800_000_000_000;
const HOST = 'a'.repeat(64);
const cfg = (extra = {}) => ({
  id: 'b'.repeat(40), hostHash: HOST, modo: 'sinc', tempoMs: 20000, referencia: false, total: 4, max: 3,
  criadoEm: T0, votosAte: T0 + 3 * 3600_000, expiraEm: T0 + 48 * 3600_000, ...extra,
});
const sala = (extra) => novaSala(cfg(extra), T0);
const pid = (n) => 'parte-de-teste-' + String(n).padStart(4, '0'); // 19 caracteres
const host = (tipo, extra = {}) => ({ ator: 'host', hostHash: HOST, tipo, ...extra });
const entra = (est, n, agora = T0, nome = 'Pessoa' + n) => aplicar(est, { tipo: 'entrar', parte: pid(n), nome }, agora);

// Uma sala com `n` pessoas, já na triagem (sincronizada, pedido 1 aberto).
function emAndamento(extra = {}, n = 2) {
  const est = sala(extra);
  for (let i = 1; i <= n; i++) assert.equal(entra(est, i).ok, true);
  assert.equal(aplicar(est, host('comecar'), T0).ok, true);
  avancar(est, T0 + SALA_CONTAGEM_MS);
  assert.equal(est.fase, 'andamento');
  return est;
}
const TA = T0 + SALA_CONTAGEM_MS; // o instante em que a triagem abre

// ── config ──────────────────────────────────────────────────────────────────

test('config: o que não é do contrato não cria sala', () => {
  assert.equal(validarConfig(cfg()), null);
  for (const [k, v] of [['id', 'x'], ['hostHash', 'zz'], ['modo', 'torneio'], ['tempoMs', 7000], ['referencia', 'sim'], ['total', 0], ['total', 61], ['max', 0], ['votosAte', 'amanhã']]) {
    assert.ok(validarConfig(cfg({ [k]: v })), `${k}=${v} devia reprovar`);
    assert.throws(() => novaSala(cfg({ [k]: v }), T0));
  }
});

// ── entrar ──────────────────────────────────────────────────────────────────

test('entrar: apelido limpo; repetido vira "Nome 2"; reentrada não gasta vaga; teto é do servidor', () => {
  const est = sala();
  assert.equal(aplicar(est, { tipo: 'entrar', parte: pid(1), nome: '  Maria   SP ' }, T0).nome, 'Maria SP');
  assert.equal(aplicar(est, { tipo: 'entrar', parte: pid(2), nome: 'maria sp' }, T0).nome, 'maria sp 2');
  const de = aplicar(est, { tipo: 'entrar', parte: pid(1), nome: 'Outro Nome' }, T0 + 5);
  assert.deepEqual(de, { ok: true, nome: 'Maria SP', reentrou: true }, 'reentrar devolve a pessoa de sempre');
  assert.equal(est.ordem.length, 2);
  assert.equal(entra(est, 3).ok, true);
  const cheia = entra(est, 4);
  assert.deepEqual(cheia, { ok: false, motivo: 'cheia' });
  assert.equal(entra(est, 3).reentrou, true, 'quem já está continua entrando com a sala cheia');
});

test('entrar: apelido no limite de 20 continua cabendo com o sufixo', () => {
  const est = sala();
  const vinte = 'x'.repeat(20);
  aplicar(est, { tipo: 'entrar', parte: pid(1), nome: vinte }, T0);
  const dois = aplicar(est, { tipo: 'entrar', parte: pid(2), nome: vinte }, T0);
  assert.equal([...dois.nome].length, 20);
  assert.ok(dois.nome.endsWith(' 2'));
});

test('entrar: id de parte ruim, apelido só invisível e a parte "ref" não passam', () => {
  const est = sala();
  assert.equal(aplicar(est, { tipo: 'entrar', parte: 'curto', nome: 'A' }, T0).motivo, 'parte');
  assert.equal(aplicar(est, { tipo: 'entrar', parte: 'ref', nome: 'A' }, T0).motivo, 'parte');
  assert.equal(aplicar(est, { tipo: 'entrar', parte: pid(1), nome: String.fromCodePoint(0x202E, 0x200B) }, T0).motivo, 'apelido');
  assert.equal(aplicar(est, { tipo: 'entrar', parte: pid(1), nome: 42 }, T0).motivo, 'apelido');
  assert.equal(est.ordem.length, 0);
});

test('entrar: sala encerrada e janela vencida recusam', () => {
  const est = sala();
  aplicar(est, host('encerrar'), T0);
  assert.equal(entra(est, 1).motivo, 'encerrada');
  const velha = sala();
  assert.equal(entra(velha, 1, T0 + 3 * 3600_000).motivo, 'encerrada', 'o prazo encerra a sala antes de entrar');
  assert.equal(velha.motivoFim, 'prazo');
});

// ── começar e a contagem ────────────────────────────────────────────────────

test('começar: só o apresentador, só do saguão e só com gente na sala', () => {
  const est = sala();
  assert.equal(aplicar(est, host('comecar'), T0).motivo, 'sala-vazia');
  entra(est, 1);
  assert.equal(aplicar(est, { ator: 'host', hostHash: 'f'.repeat(64), tipo: 'comecar' }, T0).motivo, 'sem-permissao');
  assert.equal(aplicar(est, { ator: 'host', tipo: 'comecar' }, T0).motivo, 'sem-permissao');
  assert.equal(aplicar(est, { ator: 'convidado', hostHash: HOST, tipo: 'comecar' }, T0).motivo, 'tipo');
  assert.equal(est.fase, 'saguao');
  assert.equal(aplicar(est, host('comecar'), T0).ok, true);
  assert.equal(est.fase, 'contagem');
  assert.equal(aplicar(est, host('comecar'), T0).motivo, 'fase');
});

test('contagem: 3 s e a triagem abre; no sincronizado o pedido 1 vem com o relógio de 20 s', () => {
  const est = sala();
  entra(est, 1);
  aplicar(est, host('comecar'), T0);
  assert.equal(avancar(est, T0 + SALA_CONTAGEM_MS - 1), false);
  assert.equal(est.fase, 'contagem');
  assert.equal(avancar(est, TA), true);
  assert.equal(est.fase, 'andamento');
  assert.equal(est.atual, 1);
  assert.equal(est.fimEm, TA + 20000);
  const livre = sala({ modo: 'livre' });
  entra(livre, 1);
  aplicar(livre, host('comecar'), T0);
  avancar(livre, TA);
  assert.equal(livre.atual, 0, 'no livre não há pedido em foco');
  assert.equal(livre.fimEm, null);
});

// ── votar: o modo livre ─────────────────────────────────────────────────────

test('livre: não se vota antes de começar; qualquer pedido vale; a PRIMEIRA vez vale', () => {
  const est = sala({ modo: 'livre' });
  entra(est, 1);
  assert.equal(aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' }, T0).motivo, 'nao-comecou');
  aplicar(est, host('comecar'), T0);
  assert.equal(aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' }, T0 + 100).motivo, 'nao-comecou', 'na contagem também não');
  avancar(est, TA);
  assert.equal(aplicar(est, { tipo: 'votar', parte: pid(1), idx: 3, voto: 'L' }, TA).ok, true);
  const dois = aplicar(est, { tipo: 'votar', parte: pid(1), idx: 3, voto: 'R' }, TA + 1);
  assert.deepEqual(dois, { ok: true, repetido: true });
  assert.equal(est.partes[pid(1)].votos, '--L-', 'o Desfazer é desligado: a segunda escolha não vale');
});

test('votar: índice, voto e pessoa de fora são recusados', () => {
  const est = emAndamento({ modo: 'livre' }, 1);
  const v = (extra) => aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R', ...extra }, TA);
  assert.equal(v({ idx: 0 }).motivo, 'indice');
  assert.equal(v({ idx: 5 }).motivo, 'indice');
  assert.equal(v({ idx: 1.5 }).motivo, 'indice');
  assert.equal(v({ voto: 'X' }).motivo, 'voto');
  assert.equal(v({ voto: 'r' }).motivo, 'voto');
  assert.equal(v({ parte: pid(99) }).motivo, 'fora-da-sala');
});

test('livre: terminar os pedidos carimba o fim', () => {
  const est = emAndamento({ modo: 'livre', total: 2 }, 1);
  aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' }, TA + 10);
  assert.equal(est.partes[pid(1)].terminouEm, null);
  aplicar(est, { tipo: 'votar', parte: pid(1), idx: 2, voto: 'P' }, TA + 20);
  assert.equal(est.partes[pid(1)].terminouEm, TA + 20);
});

// ── votar: o sincronizado ───────────────────────────────────────────────────

test('sinc: só se vota no pedido em foco, e só até a revelação', () => {
  const est = emAndamento();
  const v = (idx, voto = 'R', parte = pid(1), agora = TA + 100) => aplicar(est, { tipo: 'votar', parte, idx, voto }, agora);
  assert.equal(v(2).motivo, 'fechada', 'o pedido 2 ainda não abriu');
  assert.equal(v(1).ok, true);
  aplicar(est, host('revelar'), TA + 200);
  assert.equal(v(1, 'L', pid(2), TA + 300).motivo, 'fechada', 'revelado, ninguém mais vota');
});

test('sinc: o tempo acaba, a sala revela sozinha — e o voto da folga ainda entra', () => {
  const est = emAndamento();
  const fim = TA + 20000;
  assert.equal(avancar(est, fim + SALA_GRACA_MS - 1), false);
  assert.equal(aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' }, fim + 500).ok, true, 'um voto que saiu antes do fim e chegou depois');
  assert.equal(avancar(est, fim + SALA_GRACA_MS), true);
  assert.deepEqual(est.revelados, [1]);
  assert.equal(aplicar(est, { tipo: 'votar', parte: pid(2), idx: 1, voto: 'L' }, fim + SALA_GRACA_MS + 1).motivo, 'fechada');
});

test('sinc: "próximo" exige a revelação, abre o seguinte e o último encerra a demo', () => {
  const est = emAndamento({ total: 2, tempoMs: 0 });
  assert.equal(est.fimEm, null, 'sem limite de tempo não há relógio');
  assert.equal(aplicar(est, host('proximo'), TA + 1).motivo, 'nao-revelado');
  aplicar(est, host('revelar'), TA + 2);
  assert.equal(aplicar(est, host('proximo'), TA + 3).ok, true);
  assert.equal(est.atual, 2);
  assert.equal(est.abertoEm, TA + 3);
  aplicar(est, host('revelar'), TA + 4);
  aplicar(est, host('proximo'), TA + 5);
  assert.equal(est.fase, 'encerrada');
  assert.equal(est.motivoFim, 'fim');
});

test('sinc: revelar duas vezes é inofensivo, e fora do sincronizado não existe', () => {
  const est = emAndamento();
  aplicar(est, host('revelar'), TA);
  const seq = est.seq;
  assert.deepEqual(aplicar(est, host('revelar'), TA + 1), { ok: true, repetido: true });
  assert.equal(est.seq, seq, 'repetir não conta como mudança');
  const livre = emAndamento({ modo: 'livre' });
  assert.equal(aplicar(livre, host('revelar'), TA).motivo, 'fase');
  assert.equal(aplicar(livre, host('proximo'), TA).motivo, 'fase');
});

// ── palpite ─────────────────────────────────────────────────────────────────

test('palpite: primeiro o voto; vale a primeira vez; só no sincronizado, no pedido em foco', () => {
  const est = emAndamento();
  const p = (palpite = 'L', parte = pid(1), idx = 1, agora = TA + 5) => aplicar(est, { tipo: 'palpitar', parte, idx, palpite }, agora);
  assert.equal(p().motivo, 'sem-voto');
  aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' }, TA + 1);
  assert.equal(p().ok, true);
  assert.deepEqual(p('R'), { ok: true, repetido: true });
  assert.equal(est.partes[pid(1)].palpites, 'L---');
  assert.equal(p('X').motivo, 'voto');
  assert.equal(p('L', pid(1), 2).motivo, 'fechada');
  aplicar(est, host('revelar'), TA + 9);
  assert.equal(p('L', pid(2)).motivo, 'fechada', 'depois da revelação não se palpita');
  assert.equal(aplicar(emAndamento({ modo: 'livre' }), { tipo: 'palpitar', parte: pid(1), idx: 1, palpite: 'R' }, TA).motivo, 'modo');
});

// ── pausa ───────────────────────────────────────────────────────────────────

test('pausa: congela o voto e o relógio; retomar devolve o tempo que faltava', () => {
  const est = emAndamento();
  assert.equal(aplicar(est, host('pausar'), TA + 8000).ok, true);
  assert.equal(est.fase, 'pausada');
  assert.equal(est.restanteMs, 12000);
  assert.equal(aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' }, TA + 9000).motivo, 'pausada');
  assert.equal(avancar(est, TA + 600_000), false, 'pausada o relógio não corre: ninguém é revelado por baixo');
  assert.deepEqual(est.revelados, []);
  assert.equal(aplicar(est, host('retomar'), TA + 600_000).ok, true);
  assert.equal(est.fase, 'andamento');
  assert.equal(est.fimEm, TA + 600_000 + 12000);
  assert.equal(aplicar(est, host('retomar'), TA + 600_001).motivo, 'fase');
  assert.equal(aplicar(sala(), host('pausar'), T0).motivo, 'fase', 'no saguão não há o que pausar');
});

// ── recado ──────────────────────────────────────────────────────────────────

test('recado: limpo, de uma linha, com teto, e some sozinho em 6 s', () => {
  const est = emAndamento();
  assert.equal(aplicar(est, host('recado', { texto: '  Olhem   a tela!  ' }), TA).ok, true);
  assert.equal(visao(est, 'convidado', pid(1), TA + 1).recado.texto, 'Olhem a tela!');
  assert.equal(visao(est, 'convidado', pid(1), TA + SALA_RECADO_MS - 1).recado.texto, 'Olhem a tela!');
  assert.equal(visao(est, 'convidado', pid(1), TA + SALA_RECADO_MS).recado, null);
  avancar(est, TA + SALA_RECADO_MS);
  assert.equal(est.recado, null);
  aplicar(est, host('recado', { texto: 'x'.repeat(200) }), TA);
  assert.equal([...est.recado.texto].length, SALA_RECADO_MAX);
  assert.equal(aplicar(est, host('recado', { texto: '' }), TA).motivo, 'recado');
  assert.equal(aplicar(est, host('recado', { texto: String.fromCodePoint(0x202E, 0x200B) }), TA).motivo, 'recado');
  assert.equal(aplicar(est, host('recado', { texto: 'a\nb\u0000c' }), TA).ok, true);
  assert.equal(est.recado.texto, 'a b c');
});

// ── a referência do apresentador ────────────────────────────────────────────

test('referência: só se foi pedida; não conta como pessoa nem gasta vaga', () => {
  const sem = emAndamento();
  assert.equal(aplicar(sem, host('votarRef', { idx: 1, voto: 'R' }), TA).motivo, 'sem-referencia');
  const est = emAndamento({ referencia: true, max: 2 }, 2);
  assert.equal(aplicar(est, host('votarRef', { idx: 1, voto: 'R' }), TA + 1).ok, true);
  assert.equal(est.ordem.includes('ref'), true);
  assert.equal(visao(est, 'host', null, TA + 2).naSala, 2, 'o apresentador não é "pessoa na sala"');
  assert.equal(resultado(est).pessoas.length, 2);
  assert.equal(resultado(est).ref, 'R---');
  assert.equal(aplicar(est, host('votarRef', { idx: 1, voto: 'L' }), TA + 3).repetido, true, 'a referência também vale a primeira');
});

test('referência: ESCONDIDA do convidado até a revelação; o apresentador sempre vê a dele', () => {
  const est = emAndamento({ referencia: true });
  aplicar(est, host('votarRef', { idx: 1, voto: 'P' }), TA + 1);
  aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' }, TA + 2);
  const antes = visao(est, 'convidado', pid(1), TA + 3);
  assert.ok(!('refAtual' in antes), 'antes da revelação o convidado não pode saber');
  assert.ok(!JSON.stringify(antes).includes('"ref"'));
  assert.equal(visao(est, 'host', null, TA + 3).ref, 'P---');
  aplicar(est, host('revelar'), TA + 4);
  assert.equal(visao(est, 'convidado', pid(1), TA + 5).refAtual, 'P');
});

// ── o que cada um VÊ ────────────────────────────────────────────────────────

test('visão do convidado no sincronizado: antes da revelação só vê QUANTOS votaram, nunca a barra', () => {
  const est = emAndamento();
  aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' }, TA + 1);
  aplicar(est, { tipo: 'votar', parte: pid(2), idx: 1, voto: 'L' }, TA + 2);
  const v = visao(est, 'convidado', pid(1), TA + 3);
  assert.equal(v.votaram, 2);
  assert.ok(!('sala' in v) && !('pedidos' in v) && !('pessoas' in v), 'a distribuição e a lista de pessoas não vão pro celular');
  assert.equal(v.votos, 'R---', 'só os votos dele');
  aplicar(est, host('revelar'), TA + 4);
  const d = visao(est, 'convidado', pid(1), TA + 5);
  assert.deepEqual({ R: d.sala.R, L: d.sala.L, P: d.sala.P, n: d.sala.n }, { R: 1, L: 1, P: 0, n: 2 });
  assert.equal(d.sala.maioria, null, 'empate não tem maioria');
});

test('visão do apresentador: no sincronizado a barra do pedido em foco espera a revelação; no livre enche ao vivo', () => {
  const est = emAndamento();
  aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' }, TA + 1);
  assert.deepEqual(visao(est, 'host', null, TA + 2).pedidos[0], { n: 1 });
  aplicar(est, host('revelar'), TA + 3);
  assert.deepEqual(visao(est, 'host', null, TA + 4).pedidos[0], { R: 1, L: 0, P: 0, n: 1 });
  const livre = emAndamento({ modo: 'livre' });
  aplicar(livre, { tipo: 'votar', parte: pid(1), idx: 2, voto: 'P' }, TA + 1);
  assert.deepEqual(visao(livre, 'host', null, TA + 2).pedidos[1], { R: 0, L: 0, P: 1, n: 1 });
  assert.deepEqual(visao(livre, 'host', null, TA + 2).pessoas[0], { nome: 'Pessoa1', feitos: 1, terminou: false });
});

test('visão: o saguão mostra os nomes (a sala enche); depois a lista sai do caminho', () => {
  const est = sala();
  entra(est, 1); entra(est, 2);
  assert.deepEqual(visao(est, 'host', null, T0).nomes, ['Pessoa1', 'Pessoa2']);
  assert.deepEqual(visao(est, 'convidado', pid(1), T0).nomes, ['Pessoa1', 'Pessoa2']);
  aplicar(est, host('comecar'), T0);
  avancar(est, TA);
  assert.ok(!('nomes' in visao(est, 'convidado', pid(1), TA)));
});

test('visão do convidado que não entrou: marca "fora" e não vaza nada', () => {
  const est = emAndamento();
  const v = visao(est, 'convidado', pid(99), TA);
  assert.equal(v.fora, true);
  assert.ok(!('votos' in v) && !('nome' in v));
});

test('visão: o tempo do servidor e a sequência vão junto (o cliente acerta o relógio e descarta o velho)', () => {
  const est = emAndamento();
  const a = visao(est, 'convidado', pid(1), TA + 7);
  assert.equal(a.agora, TA + 7);
  const antes = est.seq;
  aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' }, TA + 8);
  assert.ok(visao(est, 'convidado', pid(1), TA + 9).seq > antes);
  assert.equal(a.fimEm, TA + 20000);
});

// ── fim ─────────────────────────────────────────────────────────────────────

test('encerrar: só o apresentador; depois disso ninguém entra nem vota; o resultado fica', () => {
  const est = emAndamento({ modo: 'livre' });
  aplicar(est, { tipo: 'votar', parte: pid(1), idx: 1, voto: 'R' }, TA + 1);
  assert.equal(aplicar(est, { ator: 'host', hostHash: '0'.repeat(64), tipo: 'encerrar' }, TA + 2).motivo, 'sem-permissao');
  assert.equal(aplicar(est, host('encerrar'), TA + 3).ok, true);
  assert.equal(est.motivoFim, 'apresentador');
  assert.deepEqual(aplicar(est, host('encerrar'), TA + 4), { ok: true, repetido: true });
  assert.equal(aplicar(est, { tipo: 'votar', parte: pid(1), idx: 2, voto: 'R' }, TA + 5).motivo, 'encerrada');
  assert.equal(entra(est, 9, TA + 6).motivo, 'encerrada');
  assert.equal(resultado(est).pedidos[0].R, 1, 'o que foi votado antes fica');
});

test('prazo: a janela de votação vence sozinha e a sala se encerra', () => {
  const est = emAndamento({ modo: 'livre' });
  assert.equal(avancar(est, T0 + 3 * 3600_000), true);
  assert.equal(est.fase, 'encerrada');
  assert.equal(est.motivoFim, 'prazo');
  assert.equal(visao(est, 'convidado', pid(1), T0 + 3 * 3600_000).encerrada.motivo, 'prazo');
});

test('proximoPrazo: o alarme acorda no que vence primeiro, em cada fase', () => {
  const est = sala();
  assert.equal(proximoPrazo(est), T0 + 3 * 3600_000, 'no saguão: o fim da janela');
  entra(est, 1);
  aplicar(est, host('comecar'), T0);
  assert.equal(proximoPrazo(est), T0 + SALA_CONTAGEM_MS);
  avancar(est, TA);
  assert.equal(proximoPrazo(est), TA + 20000 + SALA_GRACA_MS, 'sincronizado: o tempo do pedido + a folga');
  aplicar(est, host('recado', { texto: 'oi' }), TA + 1000);
  assert.equal(proximoPrazo(est), TA + 1000 + SALA_RECADO_MS, 'o recado vence antes');
  aplicar(est, host('revelar'), TA + 2000);
  avancar(est, TA + 1000 + SALA_RECADO_MS);
  assert.equal(proximoPrazo(est), T0 + 3 * 3600_000, 'revelado e sem recado: só a janela');
  aplicar(est, host('encerrar'), TA + 9000);
  assert.equal(proximoPrazo(est), T0 + 48 * 3600_000, 'encerrada: a hora de apagar a sala');
});

test('resultado: contagens por pedido e a matriz completa por pessoa', () => {
  const est = emAndamento({ modo: 'livre', total: 3 }, 2);
  for (const [n, votos] of [[1, ['R', 'L', 'P']], [2, ['R', 'R', 'P']]]) {
    votos.forEach((v, i) => aplicar(est, { tipo: 'votar', parte: pid(n), idx: i + 1, voto: v }, TA + i));
  }
  const r = resultado(est);
  assert.deepEqual(r.pedidos.map((c) => [c.R, c.L, c.P]), [[2, 0, 0], [1, 1, 0], [0, 0, 2]]);
  assert.deepEqual(r.pessoas.map((p) => p.votos), ['RLP', 'RRP']);
  assert.equal(r.pessoas[0].terminouEm, TA + 2);
});
