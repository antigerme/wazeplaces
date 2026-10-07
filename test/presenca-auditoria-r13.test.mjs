// A presença e a conversa depois da auditoria da rodada 13 (R13-5): a pílula
// que dizia "2 mensagens novas" (uma já vista) com o "lida" que JÁ VOLTOU — o
// caso irmão do R12-5-01, que só refazia a conta com ele no ar. Os rótulos
// R13-5-n são os do relatório dessa rodada. Cada teste foi visto REPROVANDO com
// o conserto desfeito.
//
// O instrumento é o js/presenca.js INTEIRO no navegador de mentira do
// `_presenca-cliente.mjs`, como nas rodadas anteriores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const EU = '12444348';
const CAF = '183164343';

const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c, emLote = false) => ({ ctl: new AbortController(), emLote, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
// A mensagem `n` da CAF, com a hora `T + n` (a do Waze), chegando pelo tempo
// real — ao vivo, ou no LOTE que abre toda conexão (a reconexão reentrega).
const chega = async (c, n, { lote = false } = {}) => c.P.presencaQuadro(fluxoDe(c, lote), { inboxMessage: { messageId: uuid(900000 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts: T + n })) } });
// A lista do Waze: a conversa com a CAF, cuja ÚLTIMA mensagem é a `n` (hora
// `T + n`), com `naoLidas` não lidas.
const lista = (n, naoLidas) => ({ online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas, atividade: T + n,
  ultima: { deMim: false, ts: T + n, recibo: false, texto: 'msg ' + n, card: null } }] });
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const pilula = (c) => ({ selo: c.$('presencaCount').textContent, rotulo: c.$('presencaPill').getAttribute('aria-label') });
const conta = (c) => c.P.presencaNaoLidasDe(CAF);

// ── R13-5-01: com o "lida" que JÁ VOLTOU, a pílula com a vista contada ──────

// A conversa ABERTA: a 1 chega com ela na tela (vista), e ela fecha — o "lida"
// da 1 sai (`T + 3000`) e fica no ar. A carona de uma ação SAI depois dele
// (`T + 3500`) e é lida no Waze ANTES de ele ser processado, já com a resposta
// da CAF (a `n`) guardada: conta a 1 (vista) e a resposta — 2. Os três passos
// seguintes vêm na `ordem` pedida, meio segundo um do outro: L, a lista (a
// carona) chega; V, o "lida" VOLTA (o caso comum: ele é rápido, e a carona
// espera a ação); R, a resposta chega pelo tempo real — ao vivo, ou no LOTE da
// reconexão (`lote`). Cada passo anota a conta que ficou depois dele.
async function lidaQueVolta({ ordem, n = 3600, naoLidas = 2, lote = false }) {
  let soltar = null;
  const c = novoCliente({ agora: T, api: { chat: (x) => {
    if (x.acao === 'abrir') return { success: true, mensagens: [], maisAntigas: false, lida: true };
    if (x.acao === 'lida') return new Promise((ok) => { soltar = ok; });
    return { success: true };
  } } });
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  c.relogio.agora = T + 1000; await chega(c, 1);            // vista
  c.relogio.agora = T + 3000; fechar(c); await tick();       // o "lida" da 1 sai (e fica no ar)
  const r = { noAr: typeof soltar === 'function' };
  const passos = {
    L: async () => { c.P.presencaAoCarona(lista(n, naoLidas), T + 3500, 30); await tick(); },
    V: async () => { soltar({ success: true }); await tick(); await tick(); },
    R: async () => { r.lidaNoArNaResposta = !!c.P.presencaLidaNoAr(CAF); await chega(c, n, { lote }); await tick(); },
  };
  let agora = 4000;
  for (const p of ordem) {
    c.relogio.agora = T + agora;
    agora += 500;
    await passos[p]();
    r[p] = conta(c);
  }
  r.pilula = pilula(c);
  r.voltou = c.P.Presenca.lidaVoltouEm.has(CAF);
  // Nada mais acontece (sem ação, sem lista nova): fica assim.
  c.relogio.agora = T + 60_000; await tick();
  r.aos60s = conta(c);
  return { c, r };
}

test('R13-5-01 o "lida" que JÁ VOLTOU: a resposta que a lista contou junto com a vista conta UMA assim que chega — sem esperar a lista seguinte', async () => {
  // VLR: o "lida" volta antes de a lista chegar (o caso do relatório); LVR: a
  // lista chega com ele no ar e ele volta antes da resposta. Nas duas, a
  // resposta encontra o "lida" já de volta.
  for (const ordem of ['VLR', 'LVR']) {
    const { r } = await lidaQueVolta({ ordem });
    assert.equal(r.noAr, true, `${ordem} CONTROLE: o "lida" do fechamento tinha que estar no ar quando a lista saiu`);
    assert.equal(r.L, 2, `${ordem} CONTROLE: antes da resposta, a lista conta a vista e a resposta — o histórico ainda não a explica`);
    assert.equal(r.voltou, true, `${ordem} CONTROLE: o "lida" tinha que ter voltado`);
    assert.equal(r.lidaNoArNaResposta, false, `${ordem} CONTROLE: com o "lida" ainda no ar seria o R12-5-01, não o irmão dele`);
    assert.equal(r.R, 1, `${ordem} DEFEITO: com a resposta no histórico, a pílula seguiu dizendo "2 mensagens novas" (uma já vista) — a conta da lista não foi refeita`);
    assert.equal(r.pilula.selo, '1', `${ordem}: a pílula mostrou ${r.pilula.selo}`);
    assert.equal(r.pilula.rotulo, 'presenca.pill.msg{"n":1}', `${ordem}: o nome da pílula disse o plural`);
    assert.equal(r.aos60s, 1, `${ordem}: a conta mudou sozinha depois`);
  }
  // CONTROLE: a resposta pelo tempo real ANTES da lista (a recontagem na
  // chegada dela, R10-5-04) dá 1 o tempo todo — e a com o "lida" ainda no ar
  // quando a resposta chega (o R12-5-01) também, depois da resposta.
  const { r: antes } = await lidaQueVolta({ ordem: 'RVL' });
  assert.deepEqual([antes.R, antes.V, antes.L, antes.aos60s], [1, 1, 1, 1], 'CONTROLE: com a resposta antes da lista, a conta tinha que ser 1 o tempo todo');
  const { r: noAr } = await lidaQueVolta({ ordem: 'LRV' });
  assert.equal(noAr.lidaNoArNaResposta, true, 'CONTROLE: aqui o "lida" ainda estava no ar quando a resposta chegou');
  assert.deepEqual([noAr.L, noAr.R, noAr.V, noAr.aos60s], [2, 1, 1, 1], 'CONTROLE: com o "lida" no ar, a resposta já refazia a conta (R12-5-01)');
});

test('R13-5-01 pelo LOTE: a resposta guardada antes de a lista sair, entregue na reconexão depois de o "lida" voltar, também refaz a conta', async () => {
  // A 3200 foi guardada ANTES de a lista sair (`T + 3500`): a régua de sempre a
  // deixa fora das vivas (a lista já a contou) — mas a conta da lista, com a
  // vista dentro, ficava 2 até a lista seguinte.
  for (const ordem of ['VLR', 'LVR']) {
    const { r } = await lidaQueVolta({ ordem, n: 3200, lote: true });
    assert.equal(r.L, 2, `${ordem} CONTROLE: antes do lote, a lista conta a vista e a resposta`);
    assert.equal(r.lidaNoArNaResposta, false, `${ordem} CONTROLE: o "lida" já tinha voltado`);
    assert.equal(r.R, 1, `${ordem} DEFEITO: a resposta chegou no lote e a pílula seguiu dizendo "2 mensagens novas" (uma já vista)`);
    assert.equal(r.aos60s, 1);
  }
  const { r: k } = await lidaQueVolta({ ordem: 'RVL', n: 3200, lote: true });
  assert.deepEqual([k.R, k.V, k.L], [1, 1, 1], 'CONTROLE: com o lote antes da lista, a conta tinha que ser 1');
});

test('R13-5-01 a conta refeita com o "lida" de volta não come a mensagem que só a LISTA conhece', async () => {
  // A lista conta a 1 (vista), a 3600 e a 3700. A 3600 chega; a 3700 ainda
  // não: o histórico não explica a lista (a última dela, a 3700, não está
  // aqui), e a conta não pode cair abaixo das duas que ninguém viu.
  let soltar = null;
  const c = novoCliente({ agora: T, api: { chat: (x) => {
    if (x.acao === 'abrir') return { success: true, mensagens: [], maisAntigas: false, lida: true };
    if (x.acao === 'lida') return new Promise((ok) => { soltar = ok; });
    return { success: true };
  } } });
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  c.relogio.agora = T + 1000; await chega(c, 1);
  c.relogio.agora = T + 3000; fechar(c); await tick();
  assert.equal(typeof soltar, 'function', 'CONTROLE: o "lida" do fechamento tinha que estar no ar');
  c.relogio.agora = T + 3800; soltar({ success: true }); await tick(); await tick();
  c.relogio.agora = T + 4000; c.P.presencaAoCarona(lista(3700, 3), T + 3500, 30); await tick();
  assert.equal(conta(c), 3, 'CONTROLE: a lista conta a vista e as duas respostas');
  c.relogio.agora = T + 4500; await chega(c, 3600); await tick();
  assert.ok(conta(c) >= 2, `a conta refeita perdeu a resposta que só a lista conhece: ${conta(c)}`);
  c.relogio.agora = T + 4600; await chega(c, 3700); await tick();
  assert.equal(conta(c), 2, 'DEFEITO: com as duas respostas no histórico, a conta tinha que ser as duas que ninguém viu (a vista ficou contada)');
  c.relogio.agora = T + 60_000; await tick();
  assert.equal(conta(c), 2, 'a conta das respostas que ninguém viu mudou sozinha');
});

test('R13-5-01 CONTROLE: a lista que saiu DEPOIS de o "lida" voltar não é recontada — e a resposta que ela conta segue contando', async () => {
  // O Waze já tinha processado o "lida" quando leu esta lista: ela conta só a
  // resposta. A régua não a confunde com a que saiu com ele no ar.
  let soltar = null;
  const c = novoCliente({ agora: T, api: { chat: (x) => {
    if (x.acao === 'abrir') return { success: true, mensagens: [], maisAntigas: false, lida: true };
    if (x.acao === 'lida') return new Promise((ok) => { soltar = ok; });
    return { success: true };
  } } });
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  c.relogio.agora = T + 1000; await chega(c, 1);
  c.relogio.agora = T + 3000; fechar(c); await tick();
  c.relogio.agora = T + 3200; soltar({ success: true }); await tick(); await tick();
  c.relogio.agora = T + 4000; c.P.presencaAoCarona(lista(3600, 1), T + 3500, 30); await tick();
  assert.equal(conta(c), 1, 'CONTROLE: a lista que saiu depois do "lida" conta só a resposta');
  c.relogio.agora = T + 4500; await chega(c, 3600); await tick();
  assert.equal(conta(c), 1, 'a resposta que a lista contou e o tempo real entregou depois deixou de contar, ou contou duas vezes');
  // E a mensagem que chega DEPOIS da lista (a lista não a conhece) soma.
  c.relogio.agora = T + 5000; await chega(c, 4800); await tick();
  assert.equal(conta(c), 2, 'a mensagem nova, que nenhuma lista contou, não somou');
});
