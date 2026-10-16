// A presença e a conversa depois da auditoria da rodada 19 (R19-5, F1; lote 23).
// O rótulo é o do relatório dessa rodada. Cada teste foi visto REPROVANDO com o
// conserto desfeito (as sabotagens estão no relatório do lote 23).
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

// ── R19-5-F1: `naoVistoAoAbrir` é tirado quando a conversa ABRE, da lista que a
// tela tinha. A lista que chega DEPOIS, com a conversa aberta e a primeira
// página falhada ou parada, conta a mensagem 2 que a tela não tem, e o ramo
// "olhando" da `presencaAplicarLista` a zerava sem registrar nada: o "lida" da
// mensagem 3, vista ao vivo, cobria a conversa inteira e "Lida" saía pra quem
// mandou a 2 antes de alguém a ver.
//
// Cenário comum a todos: a 1 foi vista e lida; a 2 chega ao Waze e o tempo real
// não a entrega (só a lista a conhece); a conversa reabre sem a primeira página;
// a lista chega (`como`); a 3 chega ao vivo e é vista; a rajada e o fechamento
// mandam o "lida".
async function cenario({ como, antes }) {
  const srv = { msgs: [], lidoAte: 0, lidas: [], abrirOk: true, segurar: false, presos: [] };
  let c;
  const lista = () => { const u = srv.msgs.at(-1); return { success: true, agora: c.relogio.agora, online: [{ id: CAF, nome: 'cafanha', rank: 3, lat: -23, lon: -46 }], conversas: u ? [{ id: CAF, nome: 'cafanha', naoLidas: srv.msgs.filter((m) => m > srv.lidoAte).length, atividade: T + u, ultima: { deMim: false, ts: T + u, recibo: false, texto: 'x', card: null } }] : [] }; };
  c = novoCliente({ agora: T + 10, api: {
    presencaApp: () => { const r = lista(); if (!srv.segurar) return r; return new Promise((res) => srv.presos.push(() => res(r))); },
    chat: (x) => {
      if (x.acao === 'abrir') {
        if (!srv.abrirOk) return FALHA;
        srv.lidoAte = Math.max(0, ...srv.msgs);
        return { success: true, mensagens: srv.msgs.map((n) => ({ id: uuid(n), ts: T + n, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto', texto: 'msg ' + n, contexto: { app: 'wazeplaces' } })), maisAntigas: false, lida: true };
      }
      if (x.acao === 'lida') { srv.lidas.push(srv.msgs.filter((m) => m > srv.lidoAte)); srv.lidoAte = Math.max(0, ...srv.msgs); return { success: true }; }
      return { success: true };
    } } });
  c.P.presencaMontar();
  const perfil = c.AppState.profile;
  srv.msgs.push(1); await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick(); fechar(c); await tick(); await tick();   // a 1: vista e lida
  srv.msgs.push(2);
  c.relogio.agora = T + 100000;
  c.$('presencaPill').classList.remove('hidden');
  if (como === 'pilula') {
    srv.abrirOk = false;
    if (antes) { await c.P.presencaAtualizar(); await tick(); c.P.presencaAbrirConversa(CAF); await tick(); await tick(); }
    else {
      srv.segurar = true;
      c.$('presencaPill').disparar('click'); await tick();                   // a pílula pede a lista (presa)
      c.P.presencaAbrirConversa(CAF); await tick(); await tick();           // toca na linha com ela ainda no ar
      srv.segurar = false;
      c.relogio.agora = T + 101000; for (const f of srv.presos.splice(0)) f(); await tick(); await tick();
    }
  } else if (como === 'carona') {
    srv.abrirOk = false;
    if (antes) { await c.P.presencaAtualizar(); await tick(); }
    c.P.presencaAbrirConversa(CAF); await tick(); await tick();
    if (!antes) { c.relogio.agora = T + 101000; await c.P.presencaAtualizar(); await tick(); }   // a carona de uma decisão
  } else {                                                                  // 'perfil': a conversa abre esperando o perfil
    srv.segurar = !antes;
    if (antes) { await c.P.presencaAtualizar(); await tick(); }
    else { c.P.presencaAtualizar(); await tick(); }                         // a lista sai com o perfil de pé e fica presa
    srv.segurar = false;
    c.AppState.profile = null;
    c.P.presencaAbrirConversa(CAF); await tick(); await tick();
    if (!antes) { c.relogio.agora = T + 101000; for (const f of srv.presos.splice(0)) f(); await tick(); await tick(); }
  }
  const h = c.P.Presenca.historico.get(CAF);
  const estado = { naoVisto: h.naoVistoAoAbrir || 0, falhou: !!h.primeiraFalhou, esperaPerfil: !!h.esperaPerfil, msg2naTela: c.$('conversaMsgs').innerHTML.includes('msg 2'), semVerNoDiag: c.P.presencaDiag().semVerAoAbrir };
  srv.msgs.push(3); c.relogio.agora = T + 150000; await chega(c, 3); await tick();
  if (como === 'perfil') c.AppState.profile = perfil;
  await c.rodarTimers(); await tick(); await tick();
  fechar(c); await tick(); await tick();
  return { c, h, srv, estado };
}

for (const como of ['pilula', 'carona', 'perfil']) {
  test(`R19-5-F1 (${como}) a lista que chega com a conversa aberta e sem a primeira página mantém a não vista: o "lida" da mensagem vista não cobre a 2`, async () => {
    const r = await cenario({ como, antes: false });
    if (como === 'perfil') assert.equal(r.estado.esperaPerfil, true, 'CONTROLE: a primeira página espera o perfil');
    else assert.equal(r.estado.falhou, true, 'CONTROLE: o `abrir` da reabertura falhou');
    assert.equal(r.estado.msg2naTela, false, 'CONTROLE: a mensagem 2 NÃO está na tela');
    assert.equal(r.estado.naoVisto, 1, 'DEFEITO: a lista que chegou depois contava a 2 e a evidência foi apagada');
    assert.deepEqual(r.srv.lidas, [], 'DEFEITO: o "lida" cobriu a mensagem 2, que nunca esteve na tela');
  });

  test(`R19-5-F1 (${como}) CONTROLE: a mesma lista chegando ANTES de abrir já dava naoVistoAoAbrir=1 e nenhum "lida"`, async () => {
    const r = await cenario({ como, antes: true });
    assert.equal(r.estado.naoVisto, 1);
    assert.deepEqual(r.srv.lidas, []);
  });
}

test('R19-5-F1 o diagnóstico conta as conversas abertas sem ver a mensagem (só o número)', async () => {
  const r = await cenario({ como: 'pilula', antes: false });
  assert.equal(r.estado.semVerNoDiag, 1, 'com a conversa aberta, a primeira página falhada e a marca posta, o relatório diz 1');
  assert.equal(JSON.stringify(r.c.P.presencaDiag()).includes(CAF), false, 'e nunca o id da pessoa');
});

// Não muda "olhando é lida" com a primeira página BOA na tela (decisão do owner):
// a lista que conta uma não lida na conversa aberta e carregada a zera, sem marca.
test('R19-5-F1 CONTROLE: com a primeira página boa na tela, a lista com não lida zera a conversa e nada fica retido', async () => {
  const srv = { msgs: [1], lidoAte: 0, lidas: [] };
  let c;
  c = novoCliente({ agora: T + 10, api: {
    presencaApp: () => { const u = srv.msgs.at(-1); return { success: true, agora: c.relogio.agora, online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas: srv.msgs.filter((m) => m > srv.lidoAte).length, atividade: T + u, ultima: { deMim: false, ts: T + u, recibo: false, texto: 'x', card: null } }] }; },
    chat: (x) => {
      if (x.acao === 'abrir') { srv.lidoAte = Math.max(0, ...srv.msgs); return { success: true, mensagens: srv.msgs.map((n) => ({ id: uuid(n), ts: T + n, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto', texto: 'msg ' + n, contexto: { app: 'wazeplaces' } })), maisAntigas: false, lida: true }; }
      if (x.acao === 'lida') { srv.lidas.push(1); return { success: true }; }
      return { success: true };
    } } });
  c.P.presencaMontar();
  await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  srv.msgs.push(2); srv.lidoAte = 0;                                       // o Waze conta 2 não lidas; a tela já tem a página boa
  c.relogio.agora = T + 70000; await c.P.presencaAtualizar(); await tick();
  const h = c.P.Presenca.historico.get(CAF);
  assert.equal(h.primeiraFalhou || false, false, 'CONTROLE: a primeira página foi boa');
  assert.equal(h.naoVistoAoAbrir || 0, 0, 'nada retido com a página boa');
  assert.equal(c.P.Presenca.conversas.find((x) => x.id === CAF).naoLidas, 0, '"olhando é lida": a conversa aberta fica em zero');
});

// A conta exata da marca: a lista conta TODAS as não lidas do Waze, e a mensagem
// que chegou ao vivo com a conversa na tela (a 3) está entre elas e FOI vista —
// só a 2 falta na tela. E o valor nunca diminui (o maior vale, como na abertura).
async function comAoVivoNaTela({ lidaFora }) {
  const srv = { msgs: [1], lidoAte: 0, abrirOk: true };
  let c;
  c = novoCliente({ agora: T + 10, api: {
    presencaApp: () => { const u = srv.msgs.at(-1); return { success: true, agora: c.relogio.agora, online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas: srv.msgs.filter((m) => m > srv.lidoAte).length, atividade: T + u, ultima: { deMim: false, ts: T + u, recibo: false, texto: 'x', card: null } }] }; },
    chat: (x) => {
      if (x.acao === 'abrir') {
        if (!srv.abrirOk) return FALHA;
        srv.lidoAte = Math.max(0, ...srv.msgs);
        return { success: true, mensagens: srv.msgs.map((n) => ({ id: uuid(n), ts: T + n, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto', texto: 'msg ' + n, contexto: { app: 'wazeplaces' } })), maisAntigas: false, lida: true };
      }
      return { success: true };
    } } });
  c.P.presencaMontar();
  await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick(); fechar(c); await tick(); await tick();
  srv.msgs.push(2); c.relogio.agora = T + 70000; await c.P.presencaAtualizar(); await tick();   // só a lista conhece a 2
  srv.abrirOk = false;
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  const h = c.P.Presenca.historico.get(CAF);
  const antes = h.naoVistoAoAbrir;
  srv.msgs.push(3); c.relogio.agora = T + 80000; await chega(c, 3); await tick();                  // a 3: ao vivo, na tela
  if (lidaFora) srv.lidoAte = 2;                                                                    // a 2 foi lida em outro aparelho
  c.relogio.agora = T + 140000; await c.P.presencaAtualizar(); await tick();
  return { antes, depois: h.naoVistoAoAbrir, falhou: h.primeiraFalhou, msg3naTela: c.$('conversaMsgs').innerHTML.includes('msg 3') };
}

test('R19-5-F1 a marca desconta a mensagem que a tela já tem: lista com 2 não lidas e a 3 vista ao vivo marca 1, não 2', async () => {
  const r = await comAoVivoNaTela({ lidaFora: false });
  assert.equal(r.falhou, true, 'CONTROLE: o `abrir` falhou');
  assert.equal(r.msg3naTela, true, 'CONTROLE: a 3 está na tela');
  assert.equal(r.antes, 1, 'CONTROLE: a abertura marcou a 2');
  assert.equal(r.depois, 1, 'a lista conta {2, 3} e a tela tem a 3: falta uma, não duas');
});

test('R19-5-F1 a marca nunca diminui: a lista que conta menos (a 2 lida em outro aparelho) não a apaga', async () => {
  const r = await comAoVivoNaTela({ lidaFora: true });
  assert.equal(r.antes, 1, 'CONTROLE');
  assert.equal(r.depois, 1, 'o maior vale; se a conta sobrar, o erro é um "lida" a menos');
});
