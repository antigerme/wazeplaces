// A presença e a conversa depois da auditoria de 2026-10-02 (rodada 7, R7-5):
// a dívida do "lida" paga marcando a mensagem que só a LISTA conhecia e
// ninguém viu, a lista devolvendo a mensagem VISTA como "1 mensagem nova"
// enquanto há dívida, o "invisível" que só era gravado quando a falha voltava,
// a lista de carona entrando com o instante da RESPOSTA e o "lida" da rajada
// perdido quando o app vai pro fundo. Os rótulos R7-5-n são os do relatório
// dessa rodada. Cada teste foi visto REPROVANDO com o conserto desfeito.
//
// Dois instrumentos, como no `presenca-auditoria-r6`: o js/presenca.js INTEIRO
// no navegador de mentira do `_presenca-cliente.mjs`, e as funções do app.js
// FATIADAS e rodadas num escopo de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const EU = '12444348';
const CAF = '183164343';
const OUTRA = '555000111';
const APP_CTX = { app: 'wazeplaces' };
const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const inbox = (bytes, n = 1) => ({ inboxMessage: { messageId: uuid(900 + n), messageType: 'X', message: b64(bytes) } });
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
const lidas = (c, com) => c.chamadas.chat.filter((x) => x.acao === 'lida' && (!com || x.com === com));
// A mensagem `n` da CAF, com a hora `T + n` (a do Waze), chegando pelo tempo real.
const chega = async (c, n, de = CAF) => c.P.presencaQuadro(fluxoDe(c),
  inbox(await bytesDeMensagem({ id: uuid(n), de, para: EU, texto: 'msg ' + n, ctx: APP_CTX, ts: T + n }), n));
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const SEM_REDE = { success: false, errorCategory: 'transient', _motivo: 'TypeError' };

// O Waze de mentira, com a conversa da CAF guardada nele: as mensagens DELA
// (a `n` tem a hora `T + n`), quais seguem NÃO LIDAS, e a lista de conversas
// montada do que ele guarda, como o de verdade — a ÚLTIMA mensagem da conversa
// (dela, minha ou um recibo) e quantas dela seguem não lidas. O "lida" (e o
// `abrir`) marca a conversa INTEIRA, o `MarkConversationRead`. `segurar`
// prende o primeiro "lida" no ar até o teste soltar.
function comWaze({ segurar = false } = {}) {
  const rede = { fora: false };
  const dela = [];
  const extra = { minha: null, recibo: null };
  const preso = { soltar: null };
  const marcar = (com) => { if (com === CAF) for (const m of dela) m.lida = true; };
  function conversaDaCaf() {
    const todas = [
      ...dela.map((m) => ({ deMim: false, ts: m.ts, recibo: false })),
      ...(extra.minha ? [{ deMim: true, ts: extra.minha, recibo: false }] : []),
      ...(extra.recibo ? [{ deMim: false, ts: extra.recibo, recibo: true }] : []),
    ].sort((a, b) => b.ts - a.ts);
    const u = todas[0] || null;
    return { id: CAF, nome: 'cafanha', naoLidas: dela.filter((m) => !m.lida).length, atividade: u ? u.ts : 0,
      ultima: u ? { ...u, texto: 'x', card: null } : null };
  }
  const c = novoCliente({ agora: T, api: {
    chat: (x) => {
      if (x.acao === 'abrir') { marcar(x.com); return { success: true, mensagens: [], maisAntigas: false, lida: true }; }
      if (x.acao === 'lida') {
        if (segurar && !preso.usado && x.com === CAF) {
          preso.usado = true;
          return new Promise((ok) => { preso.soltar = (r) => { if (r && r.success) marcar(x.com); ok(r); }; });
        }
        if (rede.fora) return SEM_REDE;
        marcar(x.com);
        return { success: true };
      }
      return { success: true };
    },
    presencaApp: () => ({ success: true, online: [], agora: c.relogio.agora, conversas: [conversaDaCaf()] }),
  } });
  // Conhecida desde o começo: a primeira mensagem dela não pede o nome no meio.
  c.P.Presenca.conversas = [conversaDaCaf()];
  return {
    c, rede, preso,
    guardar: (n) => dela.push({ n, ts: T + n, lida: false }),
    lerNoWme: () => marcar(CAF),                            // a pessoa leu pelo WME, noutro aparelho
    responder: (n) => { extra.minha = T + n; },
    recibo: (n) => { extra.recibo = T + n; },
    naoLida: (n) => dela.some((m) => m.n === n && !m.lida),
    lista: () => ({ online: [], conversas: [conversaDaCaf()] }),
  };
}

// A conversa com a CAF aberta, a mensagem 1 dela VISTA, e o "lida" falhando na
// rajada E no fechamento: a dívida fica, com a mensagem 1 não lida no Waze.
async function comDivida(w) {
  const { c } = w;
  c.P.presencaAbrirConversa(CAF);
  await tick();
  w.rede.fora = true;
  w.guardar(1);
  await chega(c, 1);                                        // a 1, NA TELA
  await c.rodarTimers();                                    // a rajada: falha
  await tick();
  fechar(c);                                                // o fechamento paga… e falha de novo
  await tick();
  w.rede.fora = false;                                      // o sinal volta
  assert.deepEqual([...c.P.Presenca.lidaDevendo], [CAF], 'CONTROLE: tem que haver a dívida');
  assert.equal(lidas(c, CAF).length, 2, 'CONTROLE: a rajada e o fechamento tinham que ter tentado (e falhado)');
  assert.equal(w.naoLida(1), true, 'CONTROLE: a mensagem vista segue não lida no Waze');
}

// A lista nova (o toque na pílula, a volta do fundo): passado o teto de um minuto.
async function listaNova(c) {
  c.relogio.agora += 61_000;
  await c.P.presencaAtualizar();
  await tick();
}

// Abrir e fechar a conversa com OUTRA pessoa: o fechamento paga as dívidas.
async function fecharOutra(c) {
  c.P.presencaAbrirConversa(OUTRA);
  await tick();
  fechar(c);
  await tick();
}

// ── R7-5-01: a dívida não marca a mensagem que só a LISTA conhece ───────────

test('R7-5-01 a lista que traz mensagem DELA mais nova que a última vista tira a dívida — fechar outra conversa e o `presencaSincronizar` não a marcam como lida', async () => {
  const w = comWaze();
  await comDivida(w);
  w.guardar(2);                                             // a 2 chega ao Waze; o tempo real está fora
  await listaNova(w.c);
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [], 'DEFEITO: a lista contou uma mensagem nova e a dívida ficou — pagá-la marca a que ninguém viu');
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 2, 'a conta da lista (a nova e a vista, que o Waze segue contando) sumiu');
  await fecharOutra(w.c);
  await w.c.P.presencaSincronizar();
  await tick();
  assert.equal(lidas(w.c, CAF).length, 2, 'DEFEITO: o "lida" da conversa inteira saiu com a mensagem 2, que ninguém viu');
  assert.equal(w.naoLida(2), true, 'DEFEITO: a mensagem 2 (não vista) foi marcada como lida no Waze');
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 2, 'a não lida sumiu daqui sem ninguém ter visto');
});

test('R7-5-01 CONTROLE: sem mensagem nova, a dívida fica — e o fechamento de outra conversa a paga', async () => {
  const w = comWaze();
  await comDivida(w);
  await listaNova(w.c);
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [CAF], 'a lista sem mensagem nova tirou a dívida — a vista ficaria não lida');
  await fecharOutra(w.c);
  assert.equal(lidas(w.c, CAF).length, 3, 'o fechamento de outra conversa não pagou a dívida');
  assert.equal(w.naoLida(1), false, 'a mensagem vista seguiu não lida no Waze');
  assert.equal(w.c.P.Presenca.lidaDevendo.size, 0);
});

test('R7-5-01 a lista conta mais não lidas do que as vistas, com a ÚLTIMA mensagem sendo MINHA — a dívida também sai', async () => {
  const w = comWaze();
  await comDivida(w);
  w.guardar(2);                                             // a 2 dela, que não chegou aqui…
  w.responder(3);                                           // …e a minha resposta depois: a última é MINHA
  await listaNova(w.c);
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [], 'DEFEITO: a lista conta 2 não lidas, a pessoa viu 1, e a dívida ficou');
  await w.c.P.presencaSincronizar();
  await tick();
  assert.equal(w.naoLida(2), true, 'a mensagem 2 (não vista) foi marcada como lida no Waze');
  // CONTROLE: só a minha resposta depois da vista — a conta é a da vista, e a dívida fica.
  const s = comWaze();
  await comDivida(s);
  s.responder(3);
  await listaNova(s.c);
  assert.deepEqual([...s.c.P.Presenca.lidaDevendo], [CAF], 'a resposta minha (sem mensagem nova dela) tirou a dívida');
  assert.equal(s.c.P.presencaNaoLidasDe(CAF), 0, 'a mensagem vista voltou como "1 mensagem nova" (R7-5-02, a última sendo minha)');
});

test('R7-5-01 lida pelo WME noutro aparelho, e chega a 2: a lista conta só ela — a dívida sai e a conta NÃO é zerada', async () => {
  // A conta da lista (1) não passa das vistas sem confirmar (1, a vista): quem
  // denuncia a nova é a ÚLTIMA mensagem, dela e mais nova que a vista. Zerar
  // aqui escondia justamente a mensagem que ninguém viu (o R7-5-02 do avesso).
  const w = comWaze();
  await comDivida(w);
  w.lerNoWme();
  w.guardar(2);
  await listaNova(w.c);
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 1, 'DEFEITO: a mensagem 2 (não vista) sumiu da conta — a lista foi zerada pela dívida');
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [], 'DEFEITO: a dívida ficou com uma mensagem nova que a pessoa não viu');
  await fecharOutra(w.c);
  assert.equal(w.naoLida(2), true, 'a mensagem 2 (não vista) foi marcada como lida no Waze');
});

test('R7-5-01 um RECIBO dela como última da conversa não é mensagem nova: a dívida fica, e a vista não volta como nova', async () => {
  const w = comWaze();
  await comDivida(w);
  w.recibo(5);                                              // o "lida" dela de uma mensagem minha, depois da vista
  await listaNova(w.c);
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [CAF], 'DEFEITO: o recibo contou como mensagem não vista e a dívida saiu');
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 0);
  await fecharOutra(w.c);
  assert.equal(w.naoLida(1), false, 'a dívida não foi paga');
});

test('R7-5-01 a lista que chegou ANTES de a dívida nascer (com a conversa na tela) é conferida na hora de pagar', async () => {
  const caso = async (comNova) => {
    const w = comWaze();
    const { c } = w;
    c.P.presencaAbrirConversa(CAF);
    await tick();
    w.rede.fora = true;
    w.guardar(1);
    await chega(c, 1);                                      // a 1, na tela: a rajada corre
    if (comNova) w.guardar(2);                              // a 2 chega ao Waze; o tempo real não a traz
    await listaNova(c);                                     // a lista chega com a conversa na tela
    await c.rodarTimers();                                  // a rajada falha: a dívida nasce DEPOIS da lista
    await tick();
    assert.deepEqual([...c.P.Presenca.lidaDevendo], [CAF], 'CONTROLE: a dívida tem que ter nascido');
    w.rede.fora = false;
    fechar(c);                                              // o fechamento paga as dívidas
    await tick();
    return { lidas: lidas(c, CAF).length, nova: w.naoLida(2), vista: w.naoLida(1) };
  };
  const r = await caso(true);
  assert.equal(r.lidas, 1, 'DEFEITO: o fechamento pagou a dívida com a lista dizendo que havia mensagem nova');
  assert.equal(r.nova, true, 'DEFEITO: a mensagem 2 (não vista) foi marcada como lida no Waze');
  // CONTROLE: sem a mensagem nova, o fechamento paga.
  const s = await caso(false);
  assert.equal(s.lidas, 2, 'o fechamento deixou de pagar a dívida');
  assert.equal(s.vista, false);
});

test('R7-5-01 a mensagem que chega com o "lida" no ar e a conversa FECHADA não deixa a dívida nascer — pagá-la marcaria essa também', async () => {
  const caso = async (comNova) => {
    const w = comWaze({ segurar: true });
    const { c } = w;
    c.P.presencaAbrirConversa(CAF);
    await tick();
    w.guardar(1);
    await chega(c, 1);                                      // a 1, na tela
    await c.rodarTimers();                                  // o "lida" da rajada sai… e fica no ar
    await tick();
    fechar(c);                                              // a pessoa fecha a conversa
    await tick();
    if (comNova) { w.guardar(2); await chega(c, 2); }       // a 2 chega pelo tempo real, fora da vista
    w.preso.soltar(SEM_REDE);                               // e só então o "lida" volta, com falha
    await tick();
    const devendo = [...c.P.Presenca.lidaDevendo];
    await c.P.presencaSincronizar();                        // o próximo gatilho que paga as dívidas
    await tick();
    return { devendo, nova: w.naoLida(2), vista: w.naoLida(1), naoLidas: c.P.presencaNaoLidasDe(CAF) };
  };
  const r = await caso(true);
  assert.deepEqual(r.devendo, [], 'DEFEITO: a dívida nasceu com uma mensagem que a pessoa não viu');
  assert.equal(r.nova, true, 'DEFEITO: a mensagem 2 (não vista) foi marcada como lida no Waze');
  assert.ok(r.naoLidas >= 1, 'a não lida sumiu daqui');
  // CONTROLE: sem a mensagem nova, a dívida nasce e o próximo gatilho a paga.
  const s = await caso(false);
  assert.deepEqual(s.devendo, [CAF], 'sem mensagem nova, a falha deixou de virar dívida');
  assert.equal(s.vista, false, 'a dívida não foi paga');
});

test('R7-5-01 o `presencaSincronizar` paga a dívida DEPOIS da lista que ele pede — paga antes, ela marcava a mensagem que só essa lista conta', async () => {
  const w = comWaze();
  await comDivida(w);
  w.guardar(2);                                             // a 2 chega ao Waze; a lista daqui ainda não a conhece
  w.c.relogio.agora += 61_000;                              // a lista não está fresca: o sincronizar pede uma
  await w.c.P.presencaSincronizar();
  await tick();
  assert.equal(w.c.chamadas.presencaApp.length, 1, 'CONTROLE: o sincronizar tinha que pedir a lista');
  assert.equal(w.naoLida(2), true, 'DEFEITO: a dívida foi paga antes da lista — a mensagem 2 (não vista) foi marcada');
  assert.equal(lidas(w.c, CAF).length, 2);
  // CONTROLE: sem a mensagem nova, a lista que ele pede não impede: a dívida sai.
  const s = comWaze();
  await comDivida(s);
  s.c.relogio.agora += 61_000;
  await s.c.P.presencaSincronizar();
  await tick();
  assert.equal(s.naoLida(1), false, 'o sincronizar deixou de pagar a dívida');
});

// ── R7-5-02: com a dívida, a lista vale ZERO pra mensagem que a pessoa viu ───

test('R7-5-02 com a dívida, a lista de CARONA não devolve a mensagem VISTA como "1 mensagem nova" — e não pede nada', async () => {
  const w = comWaze();
  await comDivida(w);
  const pilula = () => ({ escondida: w.c.$('presencaPill').classList.contains('hidden'),
    balao: !w.c.$('presencaIconMsg').classList.contains('hidden'), selo: w.c.$('presencaCount').textContent });
  for (let i = 0; i < 2; i++) {                             // duas ações ✕ com a lista de carona
    w.c.relogio.agora += 40_000;
    w.c.P.presencaAoCarona(w.lista(), w.c.relogio.agora - 100, 30);
    await tick();
    assert.equal(w.c.P.presencaNaoLidasDe(CAF), 0, 'DEFEITO: a mensagem vista voltou como "1 mensagem nova"');
    assert.deepEqual(pilula(), { escondida: true, balao: false, selo: '' }, 'a pílula virou balão com a mensagem vista');
  }
  assert.equal(lidas(w.c, CAF).length, 2, 'a lista de carona pediu um "lida" (é por swipe: nada sai daqui)');
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [CAF], 'a dívida tinha que seguir esperando o fechamento');
  // E a da pílula (o pedido da lista) também.
  await listaNova(w.c);
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 0);
  // CONTROLE: a lista com mensagem NOVA não é zerada (o R7-5-01).
  w.guardar(2);
  w.c.relogio.agora += 40_000;
  w.c.P.presencaAoCarona(w.lista(), w.c.relogio.agora - 100, 30);
  await tick();
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 2, 'a mensagem nova (não vista) sumiu da conta');
});

