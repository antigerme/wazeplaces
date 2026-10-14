// A presença e a conversa depois da auditoria da rodada 21 (R21-5; lote 25).
// O rótulo é o do relatório dessa rodada. Cada teste foi visto REPROVANDO com o
// conserto desfeito (as sabotagens estão no relatório do lote 25).
//
// O instrumento é o js/presenca.js INTEIRO no navegador de mentira do
// `_presenca-cliente.mjs`, como nas rodadas anteriores. Os cenários vêm dos
// roteiros do auditor (cen-lidaVelha, bro-lacos2), cada um com o seu CONTROLE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const T = 1790400000000;
const tick = async (n = 2) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const EU = '12444348';
const CAF = '183164343';

const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
// A mensagem `n` chega pelo tempo real, com a hora `ts` no quadro.
const chega = async (c, n, ts) => c.P.presencaQuadro(fluxoDe(c), { inboxMessage: { messageId: uuid(900000 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts })) } });
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const FALHA = { success: false, errorCategory: 'transient', error: 'x', httpCode: 500 };
const CP = readFileSync(new URL('../js/presenca.js', import.meta.url), 'utf8');
// O código sem os comentários, linha a linha (gotcha #67: guard que lê o fonte
// lê CÓDIGO, e se amarra na estrutura).
const CODIGO = CP.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
// O corpo de uma função de topo, casando as chaves.
function corpoDe(nome) {
  const ini = CODIGO.search(new RegExp(`^(?:async )?function ${nome}\\(`, 'm'));
  assert.ok(ini >= 0, `sumiu a função ${nome}`);
  let prof = 0;
  for (let i = CODIGO.indexOf('{', CODIGO.indexOf(')', ini)); i < CODIGO.length; i++) {
    if (CODIGO[i] === '{') prof++;
    else if (CODIGO[i] === '}' && --prof === 0) return CODIGO.slice(ini, i + 1);
  }
  throw new Error(`não delimitei ${nome}`);
}

// ── R21-5-01: a resposta VELHA de um "lida" apagava a dívida de uma mensagem
// MAIS NOVA. O "lida" A (cobre até a 2) demora a voltar; a 3 é vista e o "lida"
// B dela falha (vira dívida); a resposta de A chega e quitava a dívida da 3 —
// que A não cobre. Fechada a conversa, nada pagava, a 3 ficava não lida no Waze
// e a pílula voltava a dizer "1 mensagem nova" de mensagem vista. A falha de A
// fazia o mesmo (irmão achado ao reproduzir: o ramo da falha também quitava).
//
// Um Waze de mentira que guarda as mensagens com a hora de cada uma, diz a
// lista e a página, e anota o que cada "lida" cobriu e como terminou. O "lida"
// preso (`hold`) é processado quando CHEGA ao Waze ou, com `processaDepois`,
// quando é SOLTO — o caso em que o Waze o viu depois de a 3 existir.
function waze({ processaDepois = false } = {}) {
  const srv = { ts: {}, lidoAte: 0, lidas: [], lida: 'ok', presos: [] };
  const ids = () => Object.keys(srv.ts).map(Number);
  const maior = () => Math.max(0, ...Object.values(srv.ts));
  let c;
  const lista = () => {
    const u = ids().at(-1);
    return { success: true, agora: c.relogio.agora, online: [], conversas: u ? [{ id: CAF, nome: 'cafanha', naoLidas: ids().filter((n) => srv.ts[n] > srv.lidoAte).length, atividade: srv.ts[u], ultima: { deMim: false, ts: srv.ts[u], recibo: false, texto: 'x', card: null } }] : [] };
  };
  const msgs = () => ids().map((n) => ({ id: uuid(n), ts: srv.ts[n], de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto', texto: 'msg ' + n, contexto: { app: 'wazeplaces' } }));
  const api = {
    presencaApp: () => lista(),
    chat: (x) => {
      if (x.acao === 'abrir') { srv.lidoAte = maior(); return { success: true, mensagens: msgs(), maisAntigas: false, lida: true }; }
      if (x.acao === 'lida') {
        const reg = { cobre: ids().filter((n) => srv.ts[n] > srv.lidoAte), modo: srv.lida };
        srv.lidas.push(reg);
        if (srv.lida === 'fail') return FALHA;
        if (srv.lida === 'hold') {
          if (!processaDepois) srv.lidoAte = maior();
          return new Promise((res) => srv.presos.push((resposta) => { if (resposta.success && processaDepois) srv.lidoAte = maior(); res(resposta); }));
        }
        srv.lidoAte = maior();
        return { success: true };
      }
      return { success: true };
    },
  };
  return { srv, api, ligar: (cliente) => { c = cliente; }, add: (n, ts) => { srv.ts[n] = ts; return ts; },
    naoLidas: () => ids().filter((n) => srv.ts[n] > srv.lidoAte) };
}

const pilula = (c) => (c.$('presencaPill').classList.contains('hidden') ? 'oculta' : c.$('presencaCount').textContent);

// O cenário do auditor: A (cobre a 2) preso, a 3 vista, B (cobre a 3) falha.
// `velha`: 'sucesso' | 'falha' | 'nunca' é como a resposta de A volta.
async function cenarioLidaVelha({ velha, processaDepois = false }) {
  const w = waze({ processaDepois });
  const c = novoCliente({ agora: T + 10, api: w.api });
  w.ligar(c);
  c.P.presencaMontar();
  w.add(1, T + 1000);
  c.relogio.agora = T + 1000;
  await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(4); fechar(c); await tick(4);     // a 1: vista e lida
  c.relogio.agora += 100;
  c.P.presencaAbrirConversa(CAF); await tick(4);                               // reaberta: a 1 na tela
  w.srv.lida = 'hold';
  c.relogio.agora += 1000; w.add(2, c.relogio.agora); await chega(c, 2, c.relogio.agora); await tick();   // a 2, vista
  c.relogio.agora += 1300; await c.rodarTimers(); await tick(4);               // "lida" A (cobre a 2): preso
  const noAr = !!c.P.presencaLidaNoAr(CAF);
  w.srv.lida = 'fail';
  c.relogio.agora += 1000; w.add(3, c.relogio.agora); await chega(c, 3, c.relogio.agora); await tick();   // a 3, vista
  c.relogio.agora += 1300; await c.rodarTimers(); await tick(4);               // "lida" B (cobre a 3): FALHA
  const antes = { devendo: c.P.Presenca.lidaDevendo.has(CAF), guardada: (c.guardado().devendo || {})[CAF] || null };
  if (velha === 'sucesso') { w.srv.presos.shift()({ success: true }); await tick(4); }
  if (velha === 'falha') { w.srv.presos.shift()(FALHA); await tick(4); }
  const depois = { devendo: c.P.Presenca.lidaDevendo.has(CAF), guardada: (c.guardado().devendo || {})[CAF] || null };
  w.srv.lida = 'ok';
  fechar(c); await tick(4);
  c.relogio.agora += 3000; await c.rodarTimers(); await tick(4);
  c.relogio.agora += 3000; await c.rodarTimers(); await tick(4);
  const naoLidoNoWaze = w.naoLidas();
  await c.P.presencaAtualizar(); await tick(4);
  return { c, w, noAr, antes, depois, naoLidoNoWaze, pilula: pilula(c),
    lidas: w.srv.lidas.map((l) => `${l.cobre.join(',')}:${l.modo}`), guardadaNoFim: (c.guardado().devendo || {})[CAF] || null,
    devendoNoFim: c.P.Presenca.lidaDevendo.has(CAF) };
}

test('R21-5-01 CONTROLE: sem a resposta velha, a dívida da 3 é paga no fechamento — nada fica não lido e a pílula some', async () => {
  const r = await cenarioLidaVelha({ velha: 'nunca' });
  assert.equal(r.noAr, true, 'CONTROLE: o "lida" A tinha que estar no ar (preso)');
  assert.equal(r.antes.devendo, true, 'CONTROLE: a falha do "lida" B tinha que deixar a conversa devendo');
  assert.ok(r.antes.guardada && r.antes.guardada.ate > 0, 'CONTROLE: a dívida está GRAVADA no aparelho');
  assert.deepEqual(r.naoLidoNoWaze, [], 'a dívida da 3 não foi paga no fechamento');
  assert.equal(r.pilula, 'oculta');
  assert.deepEqual(r.lidas, ['2:hold', '3:fail', '3:ok'], 'o fechamento paga a 3 com um "lida" só');
  assert.equal(r.guardadaNoFim, null, 'paga, a dívida sai do aparelho');
});

test('R21-5-01 a resposta VELHA (sucesso) de um "lida" NÃO apaga a dívida da mensagem mais nova — o fechamento a paga', async () => {
  const r = await cenarioLidaVelha({ velha: 'sucesso' });
  assert.equal(r.antes.devendo, true, 'CONTROLE: a conversa devia antes da resposta velha');
  assert.equal(r.depois.devendo, true, 'DEFEITO: a resposta velha de A quitou a dívida da 3, que A não cobre');
  assert.deepEqual(r.depois.guardada, r.antes.guardada, 'DEFEITO: a resposta velha apagou a dívida GRAVADA no aparelho');
  assert.deepEqual(r.naoLidoNoWaze, [], 'DEFEITO: a 3 ficou não lida no Waze, vista e sem dívida a pagá-la');
  assert.equal(r.pilula, 'oculta', 'DEFEITO: a pílula voltou a dizer "1 mensagem nova" de mensagem vista');
  assert.deepEqual(r.lidas, ['2:hold', '3:fail', '3:ok'], 'o fechamento paga a 3 (igual ao controle)');
  assert.equal(r.guardadaNoFim, null);
});

test('R21-5-01 a resposta VELHA (FALHA) também não apaga a dívida da mais nova — o ramo da falha quitava do mesmo jeito', async () => {
  const r = await cenarioLidaVelha({ velha: 'falha' });
  assert.equal(r.antes.devendo, true, 'CONTROLE: a conversa devia antes da resposta velha');
  assert.equal(r.depois.devendo, true, 'DEFEITO: a falha velha de A quitou a dívida da 3 (que o "lida" B deixou devendo)');
  assert.deepEqual(r.depois.guardada, r.antes.guardada, 'DEFEITO: a falha velha apagou a dívida GRAVADA no aparelho');
  assert.deepEqual(r.naoLidoNoWaze, [], 'DEFEITO: a 3 ficou não lida no Waze, vista e sem dívida a pagá-la');
  assert.equal(r.pilula, 'oculta');
  assert.deepEqual(r.lidas, ['2:hold', '3:fail', '3:ok']);
  assert.equal(r.guardadaNoFim, null);
});

test('R21-5-01 se o Waze processou A DEPOIS da 3, o estado final está certo — o custo é no máximo um "lida" a mais', async () => {
  const r = await cenarioLidaVelha({ velha: 'sucesso', processaDepois: true });
  assert.deepEqual(r.naoLidoNoWaze, [], 'A cobriu a 3 no Waze e nada pode ter ficado não lido');
  assert.equal(r.pilula, 'oculta');
  assert.equal(r.guardadaNoFim, null, 'a dívida não pode sobrar no aparelho');
  assert.equal(r.devendoNoFim, false);
  // O "lida" a mais: o Waze ainda não tinha processado A quando o B saiu (cobre a
  // 2 e a 3 na visão dele), e o do fechamento já não tem nada a cobrir (`:ok`).
  assert.deepEqual(r.lidas, ['2:hold', '2,3:fail', ':ok'], 'o custo de manter a dívida passou de um "lida" a mais');
});

test('R21-5-01 CONTROLE: sem mensagem mais nova, a resposta que volta QUITA a dívida — o sucesso continua pagando', async () => {
  // A 2 é vista e o "lida" da rajada falha (dívida); o próximo gatilho a paga e o
  // sucesso tira a dívida de memória e do aparelho. Sem a 3, nada é mais novo.
  const w = waze();
  const c = novoCliente({ agora: T + 10, api: w.api });
  w.ligar(c);
  c.P.presencaMontar();
  w.add(1, T + 1000);
  c.relogio.agora = T + 1000;
  await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(4);
  w.srv.lida = 'fail';
  c.relogio.agora += 1000; w.add(2, c.relogio.agora); await chega(c, 2, c.relogio.agora); await tick();
  c.relogio.agora += 1300; await c.rodarTimers(); await tick(4);              // o "lida" falha: dívida
  assert.equal(c.P.Presenca.lidaDevendo.has(CAF), true, 'CONTROLE: a falha devia deixar a conversa devendo');
  assert.ok((c.guardado().devendo || {})[CAF], 'CONTROLE: a dívida está no aparelho');
  w.srv.lida = 'ok';
  await c.P.presencaSincronizar(); await tick(4);                              // o gatilho que paga
  assert.equal(c.P.Presenca.lidaDevendo.has(CAF), false, 'DEFEITO: o "lida" que deu certo não quitou a dívida');
  assert.equal((c.guardado().devendo || {})[CAF], undefined, 'DEFEITO: a dívida paga ficou no aparelho');
  assert.deepEqual(w.naoLidas(), []);
});

test('R21-5-01 as duas respostas do "lida" passam por `presencaTemMaisNovaQue` — nem o sucesso quita nem a falha cria ou tira a dívida da mais nova', () => {
  const corpo = corpoDe('presencaMarcarLida');
  const chamadas = [...corpo.matchAll(/presencaTemMaisNovaQue\(id, ultimaDela\)/g)];
  assert.equal(chamadas.length, 2, 'cada ramo da resposta (sucesso e falha) tem que perguntar pela mensagem mais nova');
  // O sucesso: o `presencaQuitarDivida` da resposta fica DEPOIS da pergunta.
  assert.match(corpo, /if \(r && r\.success\) \{[\s\S]*?if \(!presencaTemMaisNovaQue\(id, ultimaDela\)\) presencaQuitarDivida\(id\);[\s\S]*?\} else \{/,
    'o sucesso voltou a quitar a dívida sem conferir a mensagem mais nova');
  // A falha: nenhuma quitação no ramo (a que existe não é desta resposta mexer).
  const falha = corpo.slice(corpo.indexOf('} else {', corpo.indexOf('if (r && r.success) {')));
  assert.doesNotMatch(falha, /presencaQuitarDivida\(/, 'a falha voltou a quitar a dívida — a velha apaga a da mais nova');
  assert.match(falha, /if \(!presencaTemMaisNovaQue\(id, ultimaDela\)\) presencaDever\(id\);/);
});
