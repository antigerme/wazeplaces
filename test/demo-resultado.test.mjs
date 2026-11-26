// O RESULTADO da demo (server/demo-resultado.mjs): cada número que o palco projeta.
// Cada regra foi vista REPROVANDO com a sabotagem (gotcha #28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { novaSala, aplicar, avancar } from '../server/demo-sala.mjs';
import {
  analisar, classeDoPedido, maioriaDe, chaveDoPais, contarVotos, UNANIME_DE, DIVIDIDO_ATE, RESULTADO_MIN_VOTOS,
  PREMIO_MIN_PESSOAS, FILA_DE_EXEMPLO,
} from '../server/demo-resultado.mjs';

const T0 = 1_800_000_000_000;
const HOST = 'a'.repeat(64);
const pid = (n) => 'parte-de-teste-' + String(n).padStart(4, '0');

function montar({ modo = 'livre', total = 6, pessoas = 4, paises = [] } = {}) {
  const est = novaSala({
    id: 'b'.repeat(40), hostHash: HOST, modo, tempoMs: 0, referencia: false, total, max: 50,
    criadoEm: T0, votosAte: T0 + 3600_000 * 3, expiraEm: T0 + 48 * 3600_000,
  }, T0);
  for (let n = 1; n <= pessoas; n++) {
    assert.equal(aplicar(est, { tipo: 'entrar', parte: pid(n), nome: 'P' + n, pais: paises[n - 1] ?? '' }, T0 + n).ok, true);
  }
  aplicar(est, { tipo: 'comecar', ator: 'host', hostHash: HOST }, T0 + 100);
  avancar(est, T0 + 100 + 3000);
  return est;
}
const votar = (est, n, texto, t = T0 + 4000) => [...texto].forEach((v, i) => { if (v !== '-') aplicar(est, { tipo: 'votar', parte: pid(n), idx: i + 1, voto: v }, t + i); });
const encerrar = (est, t = T0 + 600_000) => aplicar(est, { tipo: 'encerrar', ator: 'host', hostHash: HOST }, t);

// ── unânime / dividido: UMA função ──────────────────────────────────────────
test('classeDoPedido: unânime ≥ 85%, dividido ≤ 60%, e menos de 3 votos não é consenso nenhum', () => {
  assert.equal(UNANIME_DE, 0.85); assert.equal(DIVIDIDO_ATE, 0.6); assert.equal(RESULTADO_MIN_VOTOS, 3);
  assert.equal(classeDoPedido({ R: 17, L: 1, P: 0, n: 18 }), 'unanime');
  assert.equal(classeDoPedido({ R: 17, L: 3, P: 0, n: 20 }), 'unanime', '85% exatos já é unânime');
  assert.equal(classeDoPedido({ R: 16, L: 4, P: 0, n: 20 }), null, '80% não é');
  assert.equal(classeDoPedido({ R: 6, L: 4, P: 0, n: 10 }), 'dividido', '60% exatos já é dividido');
  assert.equal(classeDoPedido({ R: 7, L: 3, P: 0, n: 10 }), null, '70%: nem uma coisa nem outra');
  assert.equal(classeDoPedido({ R: 2, L: 0, P: 0, n: 2 }), null, '2×0 não é unânime: é só dois votos');
  assert.equal(classeDoPedido({ R: 0, L: 0, P: 0, n: 0 }), null);
  assert.equal(classeDoPedido({ R: 1, L: 1, P: 1, n: 3 }), 'dividido');
});

test('a contagem do resumo é a das etiquetas (mesma função, sem conta própria)', () => {
  const est = montar({ total: 3, pessoas: 5 });
  for (let n = 1; n <= 5; n++) votar(est, n, ['RRR', 'RRR', 'RRR', 'RLR', 'LPR'][n - 1]);
  encerrar(est);
  const a = analisar(est);
  assert.deepEqual(a.pedidos.map((p) => p.classe), ['unanime', 'dividido', 'unanime'].map((c, i) => classeDoPedido(contarVotos(est, i + 1))));
  assert.equal(a.resumo.unanimes, a.pedidos.filter((p) => p.classe === 'unanime').length);
  assert.equal(a.resumo.divididos, a.pedidos.filter((p) => p.classe === 'dividido').length);
});

test('maioriaDe: empate no topo não tem maioria', () => {
  assert.equal(maioriaDe({ R: 2, L: 2, P: 0 }), null);
  assert.equal(maioriaDe({ R: 3, L: 2, P: 0 }), 'R');
  assert.equal(maioriaDe({ R: 0, L: 0, P: 0 }), null);
});

// ── países ──────────────────────────────────────────────────────────────────
test('países: sem caixa nem acento é o mesmo; «Brazil» NÃO é «Brasil» (e o número diz só isso)', () => {
  assert.equal(chaveDoPais('  BRASIL '), chaveDoPais('brasil'));
  assert.equal(chaveDoPais('México'), chaveDoPais('mexico'));
  assert.notEqual(chaveDoPais('Brazil'), chaveDoPais('Brasil'));
  assert.equal(chaveDoPais(null), '');
  const est = montar({ pessoas: 5, paises: ['Brasil', 'brasil', 'México', 'mexico ', ''] });
  const r = analisar(est).resumo;
  assert.equal(r.paises, 2, 'quem não disse o país não conta');
  assert.deepEqual(r.nomesDePaises, ['Brasil', 'México'], 'a grafia mostrada é a primeira que apareceu');
});

// ── prêmios ─────────────────────────────────────────────────────────────────
test('prêmios: sala com menos de 3 pessoas ELEGÍVEIS não tem prêmio (consenso automático não é mérito)', () => {
  assert.equal(PREMIO_MIN_PESSOAS, 3);
  const est = montar({ total: 6, pessoas: 3 });
  votar(est, 1, 'RRRRRR'); votar(est, 2, 'RRRRRR'); votar(est, 3, 'RR----'); // a 3ª não passa de 2/3
  encerrar(est);
  assert.deepEqual(analisar(est).premios, []);
});

test('prêmios: o piso é 2/3 dos pedidos e acompanha o TOTAL (não cravado em 30)', () => {
  const est = montar({ total: 3, pessoas: 3 });
  votar(est, 1, 'RRL'); votar(est, 2, 'RRL'); votar(est, 3, 'RR-');   // 2 de 3 = ceil(2) → elegível
  encerrar(est);
  assert.ok(analisar(est).premios.length > 0, 'com total 3, votar em 2 basta');
  const est2 = montar({ total: 6, pessoas: 3 });
  votar(est2, 1, 'RRRRLL'); votar(est2, 2, 'RRRRLL'); votar(est2, 3, 'RRR---');  // 3 de 6, abaixo de 4
  encerrar(est2);
  assert.deepEqual(analisar(est2).premios, [], 'com total 6 o piso é 4');
});

test('prêmios: «mente coletiva» é quem mais acompanhou a sala e «alma independente» quem menos; ninguém ganha dois', () => {
  const est = montar({ total: 6, pessoas: 4 });
  votar(est, 1, 'RRRRRR'); votar(est, 2, 'RRRRRR'); votar(est, 3, 'RRRRRR');
  votar(est, 4, 'LLLLLL');   // do contrário de todo mundo
  encerrar(est);
  const { premios } = analisar(est);
  const por = Object.fromEntries(premios.map((p) => [p.chave, p]));
  assert.equal(por.almaIndependente.nome, 'P4');
  assert.equal(por.almaIndependente.a, 6, 'divergiu em 6 de 6');
  assert.equal(por.maisRapido.nome, 'P1', 'tempo igual: quem entrou antes — e o mais rápido escolhe primeiro');
  assert.equal(por.menteColetiva.nome, 'P2', 'empate: quem entrou antes entre os que ainda não ganharam');
  assert.equal(new Set(premios.map((p) => p.nome)).size, premios.length, 'cada pessoa ganha no máximo um prêmio');
});

test('prêmios: «dedo no gatilho», «coração mole» e «cauteloso» só existem com pelo menos 1 voto do tipo', () => {
  const est = montar({ total: 3, pessoas: 3 });
  votar(est, 1, 'RRR'); votar(est, 2, 'RRR'); votar(est, 3, 'RRR');
  encerrar(est);
  const chaves = analisar(est).premios.map((p) => p.chave);
  assert.ok(!chaves.includes('coracaoMole') && !chaves.includes('cauteloso'), 'ninguém votou ✓ nem ↑');
});

test('«mais rápido» e a projeção só existem no LIVRE; o tempo conta do começo da triagem, não da entrada no saguão', () => {
  const livre = montar({ total: 3, pessoas: 3 });
  // P1 entrou no saguão cedo (T0+1) e terminou em 30 s; P2 em 90 s: o saguão NÃO conta no tempo de P1.
  votar(livre, 1, 'RRR', T0 + 10_000); votar(livre, 2, 'RRR', T0 + 70_000); votar(livre, 3, 'RRR', T0 + 100_000);
  encerrar(livre);
  const a = analisar(livre);
  const rapido = a.premios.find((p) => p.chave === 'maisRapido');
  assert.ok(rapido && rapido.nome === 'P1', 'o mais rápido é quem terminou antes, contado a partir do começo da triagem');
  assert.ok(rapido.a < 20_000, 'o tempo parte de comecouEm (T0+3100), não de quando entrou: ' + rapido.a);
  assert.ok(a.resumo.projecao && a.resumo.projecao.fila === FILA_DE_EXEMPLO && a.resumo.projecao.msPorPedido > 0);
  const sinc = montar({ modo: 'sinc', total: 3, pessoas: 3 });
  votar(sinc, 1, 'R--'); votar(sinc, 2, 'R--'); votar(sinc, 3, 'R--');
  encerrar(sinc);
  const s = analisar(sinc);
  assert.ok(!s.premios.some((p) => p.chave === 'maisRapido'), 'no sincronizado quem dita o ritmo é o apresentador');
  assert.equal(s.resumo.projecao, null);
});

test('a projeção exige 3 pessoas que TERMINARAM (duas não são ritmo, são anedota)', () => {
  const est = montar({ total: 2, pessoas: 3 });
  votar(est, 1, 'RR'); votar(est, 2, 'RR'); votar(est, 3, 'R-');
  encerrar(est);
  assert.equal(analisar(est).resumo.projecao, null);
});

// ── palpites e duração ──────────────────────────────────────────────────────
test('palpites certos: só pedido REVELADO com maioria; empate não conta como acerto nem erro', () => {
  const est = montar({ modo: 'sinc', total: 2, pessoas: 3 });
  for (let n = 1; n <= 3; n++) aplicar(est, { tipo: 'votar', parte: pid(n), idx: 1, voto: n === 3 ? 'L' : 'R' }, T0 + 4000 + n);
  aplicar(est, { tipo: 'palpitar', parte: pid(1), idx: 1, palpite: 'R' }, T0 + 5000);   // certo
  aplicar(est, { tipo: 'palpitar', parte: pid(3), idx: 1, palpite: 'R' }, T0 + 5001);   // certo
  aplicar(est, { tipo: 'palpitar', parte: pid(2), idx: 1, palpite: 'L' }, T0 + 5002);   // errado
  assert.equal(analisar(est).resumo.palpites.dados, 0, 'pedido ainda fechado: palpite não é contado');
  aplicar(est, { tipo: 'revelar', ator: 'host', hostHash: HOST }, T0 + 6000);
  const p = analisar(est).resumo.palpites;
  assert.deepEqual({ ...p }, { dados: 3, certos: 2 });
});

test('duração: do começo da triagem ao encerramento; sem começo, sem número', () => {
  const est = montar({ total: 2, pessoas: 2 });
  votar(est, 1, 'RR'); votar(est, 2, 'RR');
  encerrar(est, T0 + 200_000);
  assert.equal(analisar(est).resumo.duracaoMs, T0 + 200_000 - est.comecouEm);
  const nasc = novaSala({ id: 'b'.repeat(40), hostHash: HOST, modo: 'livre', tempoMs: 0, referencia: false, total: 2, max: 5, criadoEm: T0, votosAte: T0 + 1e9, expiraEm: T0 + 2e9 }, T0);
  assert.equal(analisar(nasc).resumo.duracaoMs, null);
});

test('decisões e votos somam o que os convidados votaram (a referência do apresentador não entra)', () => {
  const est = montar({ total: 2, pessoas: 2 });
  est.cfg.referencia = true;
  aplicar(est, { tipo: 'votarRef', ator: 'host', hostHash: HOST, idx: 1, voto: 'L' }, T0 + 5000);
  votar(est, 1, 'RL'); votar(est, 2, 'R-');
  encerrar(est);
  const r = analisar(est).resumo;
  assert.equal(r.decisoes, 3);
  assert.deepEqual({ ...r.votos }, { R: 2, L: 1, P: 0 });
  assert.equal(r.pessoas, 2);
});
