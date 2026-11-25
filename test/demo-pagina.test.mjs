// A página do CONVIDADO da demo (js/demo.js) — o que é PURO, sem navegador, e a
// paridade com o servidor. O que depende do DOM é do `npm run test:demo`.
// Cada teste foi visto REPROVANDO com a regra desfeita (gotcha #28, pergunta 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DEMO_SEGREDO_LEN, DEMO_CODIGO_LEN, DEMO_ALFABETO, DEMO_APELIDO_MAX, DEMO_PAIS_MAX } from '../server/demo.mjs';
import { SALA_RECADO_MS } from '../server/demo-sala.mjs';
import { SalaViva } from '../server/demo-sala-viva.mjs';

const fonte = readFileSync(new URL('../js/demo.js', import.meta.url), 'utf8');
// Sem `document`, o script só expõe `window.DemoPuro` (é o que ele faz em Node).
const janela = {};
vm.runInNewContext(fonte, { window: janela, crypto: globalThis.crypto, btoa: globalThis.btoa });
const P = janela.DemoPuro;
const plano = (o) => ({ ...o });   // o objeto vem de OUTRO realm (o vm): o deepStrictEqual compara protótipo

test('a página expõe as funções puras sem tocar no DOM', () => {
  assert.ok(P && typeof P.telaDaVisao === 'function' && typeof P.lerEventos === 'function');
});

// ── paridade com o servidor (o que a tela ACEITA é o que o servidor aceita) ──
test('paridade: tamanhos, alfabeto e teto do recado são os do servidor', () => {
  assert.equal(P.SEGREDO_LEN, DEMO_SEGREDO_LEN);
  assert.equal(P.CODIGO_LEN, DEMO_CODIGO_LEN);
  assert.equal(P.ALFABETO, DEMO_ALFABETO);
  assert.equal(P.APELIDO_MAX, DEMO_APELIDO_MAX);
  assert.equal(P.PAIS_MAX, DEMO_PAIS_MAX);
  assert.equal(P.RECADO_MS, SALA_RECADO_MS, 'o recado some da tela quando o servidor o apaga');
});

test('o código digitado entra igual ao que o apresentador vê («K7Q-2M9»)', () => {
  assert.equal(P.formatarCodigo(' k7q2m9 '), 'K7Q-2M9');
  assert.equal(P.formatarCodigo('k7q-2m9'), 'K7Q-2M9');
  assert.equal(P.formatarCodigo('K7Q2M9XYZ'), 'K7Q-2M9', 'corta em 6');
  assert.equal(P.formatarCodigo('k7'), 'K7');
  assert.equal(P.formatarCodigo(null), '');
  assert.equal(P.codigoPronto('K7Q-2M9'), true);
  assert.equal(P.codigoPronto('K7Q-2M'), false);
});

test('segredoDoHash: 20 símbolos do alfabeto (sem 0/O/1/I), com ou sem «#»', () => {
  const ok = 'ABCDEFGHJKLMNPQRSTUV';
  assert.equal(P.segredoDoHash('#' + ok), ok);
  assert.equal(P.segredoDoHash(ok.toLowerCase()), ok, 'minúscula entra');
  assert.equal(P.segredoDoHash('#' + ok.slice(0, 19)), null, 'curto');
  assert.equal(P.segredoDoHash('#' + ok + 'A'), null, 'longo');
  assert.equal(P.segredoDoHash('#' + ok.slice(0, 19) + '0'), null, '0 não existe no alfabeto');
  assert.equal(P.segredoDoHash('#' + ok.slice(0, 19) + 'O'), null);
  assert.equal(P.segredoDoHash(''), null);
});

test('cortar conta PONTOS DE CÓDIGO (emoji não vira meio caractere)', () => {
  assert.equal([...P.cortar('😀'.repeat(30), 20)].length, 20);
  assert.equal(P.cortar('abc', 20), 'abc');
  assert.equal(P.cortar(null, 5), '');
});

// ── o fluxo SSE: o cliente lê os BYTES que o servidor escreve ───────────────
test('lerEventos: junta pedaços, ignora batimento e guarda o resto que ainda não fechou', () => {
  const a = P.lerEventos(': ping\n\nevent: estado\nid: 3\ndata: {"seq":3}\n\nevent: esta');
  assert.equal(a.eventos.length, 1);
  assert.equal(a.eventos[0].nome, 'estado');
  assert.equal(JSON.parse(a.eventos[0].dados).seq, 3);
  assert.equal(a.resto, 'event: esta', 'o evento que não fechou espera o próximo pedaço');
  const b = P.lerEventos(a.resto + 'do\ndata: {"seq":4}\n\n');
  assert.equal(JSON.parse(b.eventos[0].dados).seq, 4);
  assert.equal(P.lerEventos('event: estado\r\ndata: {"seq":5}\r\n\r\n').eventos.length, 1, 'CRLF também');
  assert.equal(P.lerEventos(': so batimento\n\n').eventos.length, 0);
});

test('lerEventos lê o que a SalaViva de verdade escreve no fluxo (o formato é um só)', async () => {
  const agora = Date.now();
  const sala = new SalaViva();
  sala.criar({
    cfg: { id: 'b'.repeat(40), hostHash: 'a'.repeat(64), modo: 'livre', tempoMs: 0, referencia: false, total: 2, max: 10, criadoEm: agora, votosAte: agora + 1e6, expiraEm: agora + 2e6 },
    deck: { convidado: [{ n: 1 }, { n: 2 }], apresentador: [{ n: 1 }, { n: 2 }], regiao: 'row' },
  });
  await sala.acao({ tipo: 'entrar', parte: 'parte-de-teste-0001', nome: 'Ana', pais: '' });
  const r = sala.fluxo({ parte: 'parte-de-teste-0001' });
  const leitor = r.body.getReader();
  const { value } = await leitor.read();
  const { eventos } = P.lerEventos(new TextDecoder().decode(value));
  await leitor.cancel();
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].nome, 'estado');
  const v = JSON.parse(eventos[0].dados);
  assert.equal(v.papel, 'convidado');
  assert.equal(v.nome, 'Ana');
  assert.equal(v.fase, 'saguao');
});

// ── a tela que a visão pede ─────────────────────────────────────────────────
const V = (o) => ({ seq: 1, fase: 'andamento', modo: 'livre', total: 3, votos: '---', palpites: '---', atual: null, revelado: null, ...o });

test('telaDaVisao: cada fase tem a sua tela', () => {
  const pend = new Map();
  assert.equal(P.telaDaVisao(null, pend), 'abrindo');
  assert.equal(P.telaDaVisao(V({ fora: true }), pend), 'entrada');
  assert.equal(P.telaDaVisao(V({ fase: 'saguao' }), pend), 'saguao');
  assert.equal(P.telaDaVisao(V({ fase: 'contagem' }), pend), 'contagem');
  assert.equal(P.telaDaVisao(V({ fase: 'encerrada' }), pend), 'fim');
  assert.equal(P.telaDaVisao(V({}), pend), 'triagem');
  assert.equal(P.telaDaVisao(V({ fase: 'pausada' }), pend), 'triagem', 'pausada mostra o card (com o véu por cima)');
});

test('livre: o card é o primeiro SEM voto; tudo votado é «terminou»', () => {
  const pend = new Map();
  assert.deepEqual(plano(P.pedidoDaVez(V({ votos: 'R--' }), pend)), { idx: 2, motivo: null });
  assert.deepEqual(plano(P.pedidoDaVez(V({ votos: 'RL-' }), pend)), { idx: 3, motivo: null });
  assert.deepEqual(plano(P.pedidoDaVez(V({ votos: 'RLP' }), pend)), { idx: null, motivo: 'terminou' });
  assert.equal(P.telaDaVisao(V({ votos: 'RLP' }), pend), 'fim');
  // o voto que ainda está saindo conta (otimista), senão o card voltaria na tela
  pend.set(1, 'R');
  assert.deepEqual(plano(P.pedidoDaVez(V({ votos: '---' }), pend)), { idx: 2, motivo: null });
});

test('sincronizado: só o pedido da vez; depois do voto espera; revelado mostra a sala', () => {
  const pend = new Map();
  const base = { modo: 'sinc', atual: 2 };
  assert.equal(P.telaDaVisao(V({ ...base, votos: '---' }), pend), 'triagem');
  assert.equal(P.telaDaVisao(V({ ...base, votos: '-R-' }), pend), 'aguarda');
  assert.equal(P.telaDaVisao(V({ ...base, votos: '-R-', revelado: true }), pend), 'revelacao');
  assert.equal(P.telaDaVisao(V({ ...base, votos: '---', revelado: true }), pend), 'revelacao', 'quem não votou também vê a sala');
  // voto de OUTRO pedido não conta pro atual (CONTROLE: se contasse, esta daria «aguarda»)
  assert.equal(P.telaDaVisao(V({ ...base, votos: 'R--' }), pend), 'triagem');
  pend.set(2, 'L');
  assert.equal(P.telaDaVisao(V({ ...base, votos: '---' }), pend), 'aguarda', 'o voto pendente já vale');
});

test('votoEm: a palavra do servidor vale; o pendente só completa; «-» é nada', () => {
  const pend = new Map([[2, 'L']]);
  assert.equal(P.votoEm('R--', pend, 1), 'R');
  assert.equal(P.votoEm('R--', pend, 2), 'L');
  assert.equal(P.votoEm('R--', pend, 3), null);
  assert.equal(P.votoEm('RP-', new Map([[2, 'L']]), 2), 'P', 'o servidor ganha do otimista');
  assert.equal(P.votoEm(undefined, pend, 2), 'L');
});

// ── as barras ───────────────────────────────────────────────────────────────
test('percentuais somam SEMPRE 100 (três terços não podem dar 99)', () => {
  assert.deepEqual({ ...P.percentuais({ R: 1, L: 1, P: 1 }) }, { R: 34, P: 33, L: 33 });
  for (const c of [{ R: 7, L: 3, P: 0 }, { R: 1, L: 2, P: 4 }, { R: 13, L: 13, P: 14 }, { R: 1, L: 0, P: 0 }]) {
    const p = P.percentuais(c);
    assert.equal(p.R + p.L + p.P, 100, JSON.stringify(c));
  }
  assert.deepEqual({ ...P.percentuais({ R: 0, L: 0, P: 0 }) }, { R: 0, P: 0, L: 0 }, 'sala vazia não divide por zero');
  assert.deepEqual({ ...P.percentuais({ R: 1, L: 1, P: 0 }) }, { R: 50, P: 0, L: 50 });
});

test('contarVotos: só R, L e P contam', () => {
  assert.deepEqual({ ...P.contarVotos('RL-P-R') }, { R: 2, L: 1, P: 1, n: 4 });
  assert.deepEqual({ ...P.contarVotos(undefined) }, { R: 0, L: 0, P: 0, n: 0 });
});

// ── o que a página NÃO pode ter ─────────────────────────────────────────────
test('a página da demo não tem script inline (a CSP só autoriza o do tema do app, por hash)', () => {
  const html = readFileSync(new URL('../demo.src.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=/.test(m[1]));
  assert.equal(inline.length, 0, 'script inline: a CSP o bloquearia em silêncio');
  assert.ok(!/\son[a-z]+=/i.test(html.replace(/data-[^=]+=/g, '')), 'atributo de evento inline (onclick…) também é bloqueado');
});

test('o segredo da sala NUNCA vai em URL de requisição (só no corpo)', () => {
  const sem = fonte.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/fetch\([^)]*(segredo|E\.segredo)/.test(sem), 'o segredo foi parar numa URL');
  assert.ok(!/EventSource/.test(sem), 'EventSource só faz GET: o segredo teria de ir na URL');
  assert.ok(/fetch\('\/api\/demo-ao-vivo',\s*\{\s*method: 'POST'/.test(sem), 'o fluxo deixou de ser POST com o segredo no corpo');
});

test('a chave do armazenamento da demo não é de «waze*» (o Sair do app não a conhece, e não deve)', () => {
  const m = /const CHAVE_PARTICIPANTE = '([^']+)'/.exec(fonte);
  assert.ok(m && !/^waze/i.test(m[1]), 'chave com prefixo waze cairia no guard do logout do app');
});
