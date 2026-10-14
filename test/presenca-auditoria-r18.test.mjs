// A presença e a conversa depois da auditoria da rodada 18 (R18-5-01, R18-5-02
// e R18-5-03; lote 22). Os rótulos são os do relatório dessa rodada. Cada teste
// foi visto REPROVANDO com o conserto desfeito (as sabotagens estão no relatório
// do lote 22).
//
// O instrumento é o js/presenca.js INTEIRO no navegador de mentira do
// `_presenca-cliente.mjs`, como nas rodadas anteriores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const EU = '12444348';
const CAF = '183164343';

const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
const chega = async (c, n) => c.P.presencaQuadro(fluxoDe(c), { inboxMessage: { messageId: uuid(900000 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts: T + n })) } });
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const FALHA = { success: false, errorCategory: 'transient', error: 'x', httpCode: 500 };
const linhasPulou = (c) => c.chamadas.dfato.filter(([k, o]) => k === 'chat.lida' && o && o.pulou);
const pedidosDe = (c, desde, acao) => c.chamadas.chat.slice(desde).filter((x) => x.acao === acao);

// ── R18-5-01: a conversa já CARREGOU nesta página; a reabertura tem o `abrir`
// falhando; uma mensagem chega ao vivo com a conversa na tela. O histórico velho
// tem mensagem dela, e a rajada (ou o fechamento, ou a volta do fundo) mandava
// um "lida" que o Waze aplica à conversa INTEIRA: a mensagem 2, que a pílula
// contava e a tela nunca mostrou, virava "Lida" pra quem a mandou.
async function reabreComAbrirFalhando({ listaConta, como }) {
  const srv = { naoLidas: 0, abrirOk: true };
  let c;
  c = novoCliente({ agora: T + 10, api: {
    presencaApp: () => ({ success: true, agora: c.relogio.agora, online: [], conversas: srv.naoLidas ? [{ id: CAF, nome: 'cafanha', naoLidas: srv.naoLidas, atividade: T + 2, ultima: { deMim: false, ts: T + 2, recibo: false, texto: 'x', card: null } }] : [] }),
    chat: (x) => {
      if (x.acao === 'abrir') return srv.abrirOk ? { success: true, mensagens: [], maisAntigas: false, lida: true } : FALHA;
      if (x.acao === 'lida') { srv.naoLidas = 0; return { success: true }; }
      return { success: true };
    } } });
  c.P.presencaMontar();
  await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();          // 1ª abertura OK: carregada
  const h = c.P.Presenca.historico.get(CAF);
  fechar(c); await tick(); await tick();
  if (listaConta) { c.relogio.agora = T + 2000; srv.naoLidas = 1; await c.P.presencaAtualizar(); await tick(); }   // a 2 só a LISTA conhece
  srv.abrirOk = false;
  const a0 = c.chamadas.chat.length;
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();          // reabre, o `abrir` falha
  c.relogio.agora = T + 3000; srv.naoLidas += 1; await chega(c, 3); await tick();   // a 3 chega ao vivo, com a conversa na tela
  if (como === 'volta') {
    c.relogio.agora = T + 60000; c.doc.visibilityState = 'visible';
    c.P.presencaAoVoltar(); await tick();
  }
  const msg2naTela = c.$('conversaMsgs').innerHTML.includes('msg 2');
  const msg3naTela = c.$('conversaMsgs').innerHTML.includes('msg 3');
  if (como === 'fechamento') { fechar(c); await tick(); await tick(); }
  else { await c.rodarTimers(); await tick(); await tick(); }
  return { c, h, srv, lidas: pedidosDe(c, a0, 'lida'), msg2naTela, msg3naTela };
}

for (const como of ['rajada', 'fechamento', 'volta']) {
  test(`R18-5-01 com o histórico velho na tela e o \`abrir\` falhando, o "lida" da ${como} não marca a não vista`, async () => {
    const r = await reabreComAbrirFalhando({ listaConta: true, como });
    assert.equal(r.h.carregada, true, 'CONTROLE: a conversa já tinha carregado nesta página');
    assert.equal(r.h.primeiraFalhou, true, 'CONTROLE: o `abrir` da reabertura falhou');
    assert.equal(r.h.naoVistoAoAbrir, 1, 'CONTROLE: a pílula contava a mensagem 2 e a tela não a tem');
    assert.equal(r.msg2naTela, false, 'CONTROLE: a mensagem 2 NÃO está na tela');
    assert.equal(r.msg3naTela, true, 'CONTROLE: a 3, que chegou com a conversa na tela, está');
    assert.equal(r.lidas.length, 0, 'DEFEITO: o "lida" marcou no Waze a conversa inteira, com a mensagem 2 nunca vista');
    assert.equal(r.srv.naoLidas, 2, 'DEFEITO: o Waze deu a não vista como lida');
    assert.equal(linhasPulou(r.c).length >= 1, true, 'o diário diz que o "lida" deixou de sair (havia um a mandar)');
  });
}

test('R18-5-01 CONTROLE: sem nada que a lista contasse, o "lida" da mensagem vista ao vivo segue saindo', async () => {
  for (const como of ['rajada', 'fechamento']) {
    const r = await reabreComAbrirFalhando({ listaConta: false, como });
    assert.equal(r.h.naoVistoAoAbrir || 0, 0, 'CONTROLE: nada que a lista contasse');
    assert.equal(r.lidas.length, 1, `o "lida" da ${como} tem que sair (a mensagem 3 foi vista)`);
    assert.equal(linhasPulou(r.c).length, 0, 'e nenhuma linha de "pulou"');
  }
});

// ── R18-5-02: a primeira página não falhou, mas está PARADA (a espera do
// perfil). `presencaSemVerAoAbrir` exigia `primeiraFalhou`: ao fechar a conversa
// nesse estado a dívida nascia com o que a tela mostrou, o perfil voltava e o
// `presencaSincronizar` a pagava marcando a mensagem 2.
async function fechaEsperandoOPerfil({ silenciosa }) {
  const srv = { msgs: [], lidoAte: 0, lidas: [] };
  let c;
  c = novoCliente({ agora: T + 10, api: {
    presencaApp: () => { const u = srv.msgs.at(-1); return { success: true, agora: c.relogio.agora, online: [], conversas: u ? [{ id: CAF, nome: 'cafanha', naoLidas: srv.msgs.filter((m) => m > srv.lidoAte).length, atividade: T + u, ultima: { deMim: false, ts: T + u, recibo: false, texto: 'x', card: null } }] : [] }; },
    chat: (x) => {
      if (x.acao === 'abrir') return { success: true, mensagens: srv.msgs.map((n) => ({ id: uuid(n), ts: T + n, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto', texto: 'msg ' + n, contexto: { app: 'wazeplaces' } })), maisAntigas: false, lida: true };
      if (x.acao === 'lida') { srv.lidas.push(srv.msgs.filter((m) => m > srv.lidoAte)); srv.lidoAte = Math.max(0, ...srv.msgs); return { success: true }; }
      return { success: true };
    } } });
  c.P.presencaMontar();
  const perfil = c.AppState.profile;
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  srv.msgs.push(1); c.relogio.agora = T + 1000; await chega(c, 1); await tick();
  fechar(c); await tick(); await tick();                               // a 1 foi vista e lida
  if (silenciosa) srv.msgs.push(2);                                    // a 2 só a LISTA conhece
  c.relogio.agora = T + 2000; await c.P.presencaAtualizar(); await tick();
  srv.msgs.push(3); c.relogio.agora = T + 3000; await chega(c, 3); await tick();    // a 3 chega com a conversa fechada
  c.AppState.profile = null;                                           // a renovação silenciosa
  c.relogio.agora = T + 10000;
  c.P.presencaAbrirConversa(CAF); await tick();
  const h = c.P.Presenca.historico.get(CAF);
  const esperaPerfil = !!h.esperaPerfil;
  const naoVisto = h.naoVistoAoAbrir || 0;
  fechar(c); await tick(); await tick();
  const devendoAoFechar = c.P.Presenca.lidaDevendo.has(CAF);
  c.AppState.profile = perfil; c.relogio.agora = T + 20000;
  const a0 = srv.lidas.length;
  await c.P.presencaSincronizar(); await tick(); await tick();
  return { c, esperaPerfil, naoVisto, devendoAoFechar, lidasNoPerfil: srv.lidas.slice(a0) };
}

test('R18-5-02 fechar na espera do perfil, com a não vista: não nasce dívida, e o perfil de volta não marca a mensagem 2', async () => {
  const r = await fechaEsperandoOPerfil({ silenciosa: true });
  assert.equal(r.esperaPerfil, true, 'CONTROLE: a primeira página esperava o perfil (não falhou)');
  assert.equal(r.naoVisto, 1, 'CONTROLE: a pílula contava a mensagem 2');
  assert.deepEqual(r.lidasNoPerfil, [], 'DEFEITO: o perfil de volta pagou a dívida e o "lida" cobriu a mensagem 2, nunca vista');
  assert.equal(r.devendoAoFechar, false, 'a dívida não podia nascer');
});

test('R18-5-02 CONTROLE: o mesmo fechamento sem a mensagem 2 deixa a dívida nascer e o perfil de volta paga a mensagem vista', async () => {
  const r = await fechaEsperandoOPerfil({ silenciosa: false });
  assert.equal(r.esperaPerfil, true);
  assert.equal(r.naoVisto, 0, 'CONTROLE: nada que a lista contasse');
  assert.equal(r.devendoAoFechar, true, 'a dívida nasce');
  assert.deepEqual(r.lidasNoPerfil, [[3]], 'e o perfil de volta paga só a mensagem 3');
});

// ── R18-5-03: a linha `chat.lida { pulou: 'naoVista' }` só sai quando havia
// MESMO um "lida" a mandar.
test('R18-5-03 só perguntada (a lista conta 1, o `abrir` falha, nada visto, fecha): nenhum "lida" devido, nenhuma linha de "pulou"', async () => {
  let c;
  c = novoCliente({ agora: T + 10, api: {
    presencaApp: () => ({ success: true, agora: c.relogio.agora, online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas: 1, atividade: T + 2, ultima: { deMim: false, ts: T + 2, recibo: false, texto: 'x', card: null } }] }),
    chat: (x) => (x.acao === 'abrir' ? FALHA : { success: true }) } });
  c.P.presencaMontar(); await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  const h = c.P.Presenca.historico.get(CAF);
  assert.equal(h.primeiraFalhou, true, 'CONTROLE: o `abrir` falhou');
  assert.equal(h.naoVistoAoAbrir, 1, 'CONTROLE: a pílula contava 1');
  fechar(c); await tick(); await tick();
  assert.equal(c.P.Presenca.lidaDevendo.size, 0, 'CONTROLE: nada devido');
  assert.equal(c.chamadas.chat.filter((x) => x.acao === 'lida').length, 0, 'CONTROLE: nenhum "lida" saiu');
  assert.equal(linhasPulou(c).length, 0, 'DEFEITO: o diário disse que o "lida" deixou de sair quando nenhum estava devido');
});

test('R18-5-03 a dívida que nasceu com a página no ar e morre com a falha dela deixa UMA linha (havia um "lida" devido)', async () => {
  const soltas = [];
  const srv = { naoLidas: 0 };
  let c;
  c = novoCliente({ agora: T + 10, api: {
    presencaApp: () => ({ success: true, agora: c.relogio.agora, online: [], conversas: srv.naoLidas ? [{ id: CAF, nome: 'cafanha', naoLidas: srv.naoLidas, atividade: T + 2, ultima: { deMim: false, ts: T + 2, recibo: false, texto: 'x', card: null } }] : [] }),
    chat: (x) => {
      if (x.acao === 'abrir') return soltas.length === 0 && !srv.segunda ? { success: true, mensagens: [], maisAntigas: false, lida: true } : new Promise((ok) => soltas.push(ok));
      return { success: true };
    } } });
  c.P.presencaMontar();
  await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();          // 1ª abertura OK
  fechar(c); await tick(); await tick();
  srv.segunda = true; srv.naoLidas = 1; c.relogio.agora = T + 2000; await c.P.presencaAtualizar(); await tick();   // a 2 só a lista conta
  c.P.presencaAbrirConversa(CAF); await tick();                        // o `abrir` fica no ar
  c.relogio.agora = T + 3000; srv.naoLidas += 1; await chega(c, 3); await tick();    // a 3, vista ao vivo
  fechar(c); await tick(); await tick();                               // fecha com a página no ar: a dívida nasce
  const h = c.P.Presenca.historico.get(CAF);
  assert.equal(h.naoVistoAoAbrir, 1, 'CONTROLE: a pílula contava a mensagem 2');
  assert.equal(c.P.Presenca.lidaDevendo.has(CAF), true, 'CONTROLE: a dívida nasceu com a página no ar (R16-5-01)');
  soltas.shift()(FALHA); await tick(); await tick();                   // a página falha
  assert.equal(c.P.Presenca.lidaDevendo.has(CAF), false, 'a dívida saiu sem pagar');
  assert.equal(linhasPulou(c).length, 1, 'havia um "lida" devido que deixou de sair: UMA linha');
});

// R18-5-01 com a página NO AR (a 2ª abertura ainda esperando o `abrir`): o "lida"
// da mensagem vista ao vivo não sai agora (marcaria a não vista), vira dívida.
test('R18-5-01 com o `abrir` da reabertura NO AR e o histórico velho, o fechamento não manda "lida": a mensagem vista fica devendo', async () => {
  const soltas = [];
  const srv = { naoLidas: 0, segunda: false };
  let c;
  c = novoCliente({ agora: T + 10, api: {
    presencaApp: () => ({ success: true, agora: c.relogio.agora, online: [], conversas: srv.naoLidas ? [{ id: CAF, nome: 'cafanha', naoLidas: srv.naoLidas, atividade: T + 2, ultima: { deMim: false, ts: T + 2, recibo: false, texto: 'x', card: null } }] : [] }),
    chat: (x) => {
      if (x.acao === 'abrir') return srv.segunda ? new Promise((ok) => soltas.push(ok)) : { success: true, mensagens: [], maisAntigas: false, lida: true };
      return { success: true };
    } } });
  c.P.presencaMontar();
  await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  fechar(c); await tick(); await tick();
  srv.segunda = true; srv.naoLidas = 1; c.relogio.agora = T + 2000; await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick();
  const h = c.P.Presenca.historico.get(CAF);
  assert.equal(h.carregada, true, 'CONTROLE: o histórico velho está na tela');
  assert.equal(h.carregando, true, 'CONTROLE: o `abrir` está no ar');
  assert.equal(h.naoVistoAoAbrir, 1, 'CONTROLE: a pílula contava a mensagem 2');
  c.relogio.agora = T + 3000; await chega(c, 3); await tick();
  const a0 = c.chamadas.chat.length;
  fechar(c); await tick(); await tick();
  assert.equal(pedidosDe(c, a0, 'lida').length, 0, 'DEFEITO: o "lida" do fechamento marcou a conversa inteira, com a mensagem 2 nunca vista');
  assert.equal(c.P.Presenca.lidaDevendo.has(CAF), true, 'a mensagem 3, vista, fica devendo o "lida"');
});
