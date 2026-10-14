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

// ── R21-5-05: o tempo real religava a 1 Hz, SEM recuo, se a conexão fechava logo
// depois do primeiro lote. `fimNormal = teveLote || vida > 60 s`, e o
// `endOfBatch` zerava o recuo: contra o Google de verdade, que abre TODA conexão
// com o lote no 1º milissegundo (MEDIDO em produção), `teveLote` é sempre
// verdadeiro — quem fechava logo depois (um intermediário, um limite do
// servidor) era "fim normal" a cada volta, no degrau 0. O auditor mediu 25 idas
// ao Google em 25 s. Agora só a DURAÇÃO diz (o piso de 60 s), e quem zera o recuo
// e a série de quedas é a conexão que entregou o lote E viveu o piso.
//
// O Google de mentira CONDUZ a conexão: o `fetch` devolve um corpo que só
// termina quando o teste manda, e o relógio manual anda entre os pedaços — o
// `new Response('...')` de uma tacada só termina no milissegundo em que abre e
// só media o fim imediato (o `desde: 0` do `fluxoDe` ainda lê "viveu pra
// sempre": estes testes passam pelo `presencaFluxoAbrir` de verdade).
const GOOGLE = 'https://instantmessaging-pa.googleapis.com/';
const enc = new TextEncoder();
const LOTE = '[{"startOfBatch":{}},{"endOfBatch":{}}';          // sem o `]`: a conexão segue aberta
const PONG = ',{"pong":{}}';                                     // o sinal de vida de 10 s do Google
function google() {
  const g = { idas: 0, abertas: [] };
  g.fetch = async () => {
    g.idas += 1;
    let controle;
    const corpo = new ReadableStream({ start(ctl) { controle = ctl; } });
    g.abertas.push({
      escrever: (txt) => controle.enqueue(enc.encode(txt)),
      fechar: () => { controle.enqueue(enc.encode(']')); controle.close(); },
      encerrar: () => controle.close(),                // fecha SEM pedaço nenhum: o último foi antes
      cair: (e = new TypeError('Failed to fetch')) => controle.error(e),
    });
    return new Response(corpo, { status: 200 });
  };
  return g;
}
function clienteDoFluxo({ tentativa = 0 } = {}) {
  const g = google();
  const c = novoCliente({ agora: T, api: { fetch: g.fetch } });
  c.P.presencaMontar();
  Object.assign(c.P.Presenca, { chat: { token: 'T', base: GOOGLE, chave: 'K', expiraEm: T + 20 * 3600e3 },
    pais: 30, atualizadaEm: T, tentadaEm: T, tokenPedidoEm: T, fluxoTentativa: tentativa });
  return { c, g };
}
// Espera a conexão que estava de pé terminar (o `finally` do `presencaFluxoAbrir`).
async function fim(c) {
  for (let i = 0; i < 50 && c.P.Presenca.fluxo; i++) await tick();
  assert.equal(c.P.Presenca.fluxo, null, 'a conexão não terminou');
}
// Abre a conexão que o garantir abre (o recuo, o primeiro) e devolve o controle dela.
async function abrir(c, g) {
  const n = g.abertas.length;
  if (c.timers.length) await c.rodarTimers(); else c.P.presencaFluxoAbrir();
  await tick(4);
  assert.equal(g.abertas.length, n + 1, 'a conexão não abriu');
  return g.abertas[n];
}
// A espera do religamento que ficou agendado (só ele deve sobrar).
function religa(c) {
  assert.equal(c.timers.length, 1, `esperava UM timer de religar: ${JSON.stringify(c.timers.map((x) => x.ms))}`);
  return c.timers[0].ms;
}
const diario = (c) => c.chamadas.dfato.filter(([k]) => k === 'presenca.fluxo').map(([, o]) => o);
// O recuo tem jitter de ±25%: confere-se a FAIXA do degrau, nunca o milissegundo.
const faixa = (base) => [Math.round(base * 0.75), Math.round(base * 1.25)];
const noDegrau = (ms, base) => ms >= faixa(base)[0] && ms <= faixa(base)[1];
// Um ciclo de conexão curta: abre, o lote, vive `ms`, fecha.
async function cicloCurto(c, g, ms = 1000) {
  const con = await abrir(c, g);
  con.escrever(LOTE); await tick(4);
  c.relogio.agora += ms;
  con.fechar(); await fim(c);
}

test('R21-5-05 a conexão que entrega o lote e FECHA em 3 s é fim CURTO: recuo de 2 s (±25%), não os 1 s do fim normal', async () => {
  const { c, g } = clienteDoFluxo();
  await cicloCurto(c, g, 3000);
  const ms = religa(c);
  assert.ok(noDegrau(ms, 2000), `DEFEITO: religou em ${ms} ms — o lote (que toda conexão traz) a deixava passar por fim normal`);
  assert.equal(c.P.Presenca.fluxoTentativa, 1, 'o recuo não subiu um degrau');
  assert.equal(c.P.Presenca.fluxoDiag.ultimoErro, 'fim curto');
  assert.deepEqual(diario(c).map((o) => o.ev + (o.erro ? ':' + o.erro : '')), ['conectou', 'caiu:fim curto']);
  assert.equal(diario(c).at(-1).durouS, 3);
});

test('R21-5-05 CONTROLE: a que VIVEU 6 min e o Google fecha tem fim normal — religa em 1 s e o recuo fica zerado', async () => {
  const { c, g } = clienteDoFluxo({ tentativa: 3 });
  const con = await abrir(c, g);
  con.escrever(LOTE); await tick(4);
  c.relogio.agora += 6 * 60e3;
  con.escrever(PONG); await tick(4);
  con.fechar(); await fim(c);
  assert.equal(religa(c), 1000, 'o fim normal deixou de religar em 1 s');
  assert.equal(c.P.Presenca.fluxoTentativa, 0, 'a conexão que viveu e entregou o lote não zerou o recuo');
  assert.equal(c.P.Presenca.fluxoDiag.ultimoErro, null);
  assert.deepEqual(diario(c), [{ ev: 'conectou' }], 'o fim normal virou queda no diário');
});

test('R21-5-05 o fim normal prova mesmo sem um pedaço depois do piso: viveu 6 min, o Google fechou — o recuo de antes zera', async () => {
  // O sinal de vida de 10 s faz a prova durante a vida; se o último pedaço veio
  // antes do piso, o fim normal da conexão que entregou o lote a faz.
  const { c, g } = clienteDoFluxo({ tentativa: 3 });
  const con = await abrir(c, g);
  con.escrever(LOTE); await tick(4);
  c.relogio.agora += 6 * 60e3;
  con.encerrar(); await fim(c);                       // fecha sem pedaço depois do piso: o último foi o lote
  assert.equal(religa(c), 1000);
  assert.equal(c.P.Presenca.fluxoTentativa, 0, 'o fim normal da conexão que entregou o lote e viveu não provou');
  assert.deepEqual(diario(c), [{ ev: 'conectou' }]);
});

test('R21-5-05 a conexão que fecha logo, em CICLO: o recuo SOBE (2, 5, 15, 30, 60 s) e o diário não enche', async () => {
  const { c, g } = clienteDoFluxo();
  const bases = [2000, 5000, 15_000, 30_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000];
  for (let i = 0; i < bases.length; i++) {
    await cicloCurto(c, g, 1000);
    const ms = religa(c);
    assert.ok(noDegrau(ms, bases[i]), `ciclo ${i + 1}: religou em ${ms} ms (esperava ~${bases[i]} ms) — o laço de 1 s/2 s voltou`);
    c.relogio.agora += ms;
  }
  // Doze quedas seguidas, e a série segue aberta: nenhuma volta no meio.
  assert.equal(c.P.Presenca.fluxoDiag.quedasSeguidas, 12);
  assert.ok(!diario(c).some((o) => o.ev === 'voltou'), 'o lote de cada conexão curta anotou uma "volta"');
  assert.deepEqual(diario(c).map((o) => o.quedas ?? o.ev), ['conectou', 1, 2, 3, 10],
    'o diário do laço: as 3 primeiras quedas e uma a cada 10 — 2 linhas por volta encheriam o anel de 120');
  // Quando uma conexão VIVE o piso, a volta entra e a série fecha.
  const con = await abrir(c, g);
  con.escrever(LOTE); await tick(4);
  c.relogio.agora += 61_000;
  con.escrever(PONG); await tick(4);
  assert.deepEqual(diario(c).at(-1), { ev: 'voltou', depoisDe: 12 });
  assert.equal(c.P.Presenca.fluxoDiag.quedasSeguidas, 0);
  assert.equal(c.P.Presenca.fluxoTentativa, 0, 'a prova não zerou o recuo com a conexão aberta');
  con.fechar(); await fim(c);
  assert.equal(religa(c), 1000);
});

test('R21-5-05 em 25 s de relógio o laço do lote faz as mesmas idas do corpo vazio (o CONTROLE do auditor): 4 ou menos, não 25', async () => {
  const idasEm25s = async (corpo) => {
    const { c, g } = clienteDoFluxo();
    let t = 0;
    const idas = [];
    while (t <= 25_000) {
      idas.push(t);
      const con = await abrir(c, g);
      if (corpo === 'lote') { con.escrever(LOTE); await tick(4); }
      con.fechar(); await fim(c);                    // fecha logo, no mesmo milissegundo
      const ms = religa(c);
      t += ms; c.relogio.agora += ms;
    }
    return idas;
  };
  const lote = await idasEm25s('lote');
  const vazio = await idasEm25s('vazio');
  assert.ok(lote.length <= 4, `DEFEITO: ${lote.length} idas ao Google em 25 s com o lote (o auditor mediu 25)`);
  assert.deepEqual([vazio.length >= 3, vazio.length <= 4], [true, true], `CONTROLE: o corpo vazio já ia pelo recuo (${vazio.length} idas)`);
  assert.ok(lote.slice(1).every((t, i) => t - lote[i] >= 1500), `intervalos de 1 s: ${JSON.stringify(lote)}`);
});

test('R21-5-05 viveu 6 min e caiu com ERRO: recomeça do 1º degrau (2 s), não do que as falhas de antes deixaram', async () => {
  const { c, g } = clienteDoFluxo({ tentativa: 3 });
  const con = await abrir(c, g);
  con.escrever(LOTE); await tick(4);
  c.relogio.agora += 6 * 60e3;
  con.escrever(PONG); await tick(4);                  // o sinal de vida depois do piso: a prova
  assert.equal(c.P.Presenca.fluxoTentativa, 0, 'a conexão aberta que viveu o piso não provou');
  assert.ok(c.P.Presenca.fluxo, 'CONTROLE: a conexão segue aberta');
  con.cair(); await fim(c);
  const ms = religa(c);
  assert.ok(noDegrau(ms, 2000), `religou em ${ms} ms: o degrau velho (30 s) valeu, e hoje a conexão que viveu recomeça de 2 s`);
  assert.equal(c.P.Presenca.fluxoTentativa, 1);
  // CONTROLE: a que cai com erro ANTES do piso herda o degrau (nada provou).
  const k = clienteDoFluxo({ tentativa: 3 });
  const kc = await abrir(k.c, k.g);
  kc.escrever(LOTE); await tick(4);
  k.c.relogio.agora += 30_000;
  kc.escrever(PONG); await tick(4);
  assert.equal(k.c.P.Presenca.fluxoTentativa, 3, 'CONTROLE: antes do piso nada pode zerar o recuo');
  kc.cair(); await fim(k.c);
  const km = religa(k.c);
  assert.ok(noDegrau(km, 30_000), `CONTROLE: caiu antes do piso e religou em ${km} ms (esperava ~30 s: o degrau em que estava)`);
  assert.equal(k.c.P.Presenca.fluxoTentativa, 4);
});

test('R21-5-05 sem lote: a que viveu o piso tem fim normal mas NÃO zera o recuo (só o lote prova); a que fecha logo é "fim sem lote"', async () => {
  const { c, g } = clienteDoFluxo({ tentativa: 3 });
  const con = await abrir(c, g);
  con.escrever('['); await tick(4);                   // nenhum lote
  c.relogio.agora += 61_000;
  con.escrever(PONG.slice(1)); await tick(4);
  con.fechar(); await fim(c);
  assert.equal(religa(c), 1000, 'viveu 61 s sem lote: o fim normal (o que valia antes) continua');
  assert.equal(c.P.Presenca.fluxoTentativa, 3, 'sem o lote a conexão não provou nada: o recuo não zera');
  // E a que fecha logo, sem lote, segue sendo erro — com o nome de sempre.
  const k = clienteDoFluxo();
  const kc = await abrir(k.c, k.g);
  kc.fechar(); await fim(k.c);
  assert.equal(k.c.P.Presenca.fluxoDiag.ultimoErro, 'fim sem lote');
  assert.ok(noDegrau(religa(k.c), 2000));
});

test('R21-5-05 o piso é de 60 s, medido de ponta a ponta: 59,999 s é fim curto, 60 s é fim normal', async () => {
  const vida = async (ms) => {
    const { c, g } = clienteDoFluxo();
    const con = await abrir(c, g);
    con.escrever(LOTE); await tick(4);
    c.relogio.agora += ms;
    con.fechar(); await fim(c);
    return { espera: religa(c), erro: c.P.Presenca.fluxoDiag.ultimoErro };
  };
  const curta = await vida(59_999);
  assert.ok(noDegrau(curta.espera, 2000), `59,999 s religou em ${curta.espera} ms`);
  assert.equal(curta.erro, 'fim curto');
  const normal = await vida(60_000);
  assert.equal(normal.espera, 1000, `60 s religou em ${normal.espera} ms`);
  assert.equal(normal.erro, null);
});

test('R21-5-05 o smoke da presença segura a conexão do Google ABERTA e mede o Google que fecha logo, com os dois controles', () => {
  // O Google de mentira do smoke era uma conexão que terminava a cada entrega
  // (`route.fulfill` não faz stream) e que o app religava em 1 s. Com o fim CURTO
  // do R21-5-05 isso escala o recuo pelo smoke inteiro (16 falhas na primeira
  // rodada). Hoje quem segura a conexão é o `fetch` da página — que ainda faz a
  // ida de verdade pela rede roteada —, e a seção 15 mede o Google que fecha
  // logo. O guard cobra que isso não volte a ser a conexão que termina.
  const fonte = readFileSync(new URL('../tools/smoke-presenca.mjs', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(fonte, /ctx\.addInitScript\(googleDeMentiraNaPagina, GOOGLE\)/, 'a página deixou de segurar a conexão do Google');
  assert.doesNotMatch(fonte, /\bacordar\b|dormir\(25_000\)/, 'a conexão do Google de mentira voltou a ficar presa até a entrega (e terminar com ela)');
  // O sinal de vida da conexão aberta fica abaixo do vigia de silêncio do app.
  const silencio = Number((CODIGO.match(/PRESENCA_FLUXO_SILENCIO_MS = ([\d_]+)/) || [])[1]?.replace(/_/g, ''));
  const pulso = Number((fonte.match(/setInterval\(\(\) => conexao\.escrever\([^)]*\), ([\d_]+)\)/) || [])[1]?.replace(/_/g, ''));
  assert.ok(silencio > 0 && pulso > 0 && pulso * 2 < silencio, `o sinal de vida (${pulso} ms) tem que caber duas vezes no vigia de silêncio do app (${silencio} ms)`);
  // A seção 15: o lote que fecha logo, o corpo vazio (o controle do auditor) e o Google saudável.
  assert.match(fonte, /console\.log\('\\n15\. o Google que fecha logo depois do lote/);
  for (const modo of ["'lote'", "'vazio'", 'null']) assert.ok(fonte.includes(`medir(caio, ${modo})`), `a seção 15 deixou de medir ${modo}`);
  assert.match(fonte, /saudavel\.idas\.length === 1 && saudavel\.estado\.aberto/, 'o controle do Google saudável sumiu');
  assert.match(fonte, /lote\.idas\.length <= 4\b/, 'o teto de idas do Google que fecha logo sumiu');
});
