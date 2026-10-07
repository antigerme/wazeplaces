// A presença e a conversa depois da auditoria da rodada 12 (R12-5): a pílula
// que dizia "2 mensagens novas" (uma já vista) com o "lida" no ar, o segundo
// "Enviar" sem o perfil que reescrevia a mesma frase na região viva sem limpar
// antes, a falha que o eco tirava da tela e não do leitor de tela, e a lista
// mais velha que punha de volta as conversas de antes depois da carona de outro
// país. Os rótulos R12-5-n são os do relatório dessa rodada. Cada teste foi
// visto REPROVANDO com o conserto desfeito.
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
const SEM_REDE = { success: false, errorCategory: 'transient', _motivo: 'TypeError' };
// O Waze fora com a rede boa: a resposta CHEGA (sem `_motivo`).
const WAZE_FORA = { success: false, errorCategory: 'transient', httpCode: 200 };

const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c, emLote = false) => ({ ctl: new AbortController(), emLote, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
// A mensagem `n` da CAF, com a hora `T + n` (a do Waze), chegando pelo tempo
// real — ao vivo, ou no LOTE que abre toda conexão (a reconexão reentrega).
const chega = async (c, n, { lote = false } = {}) => c.P.presencaQuadro(fluxoDe(c, lote), { inboxMessage: { messageId: uuid(900000 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts: T + n })) } });
// O ECO de uma mensagem MINHA (mesmo id), que o Waze guardou e o tempo real
// devolve a quem mandou.
const eco = async (c, m, ts) => c.P.presencaQuadro(fluxoDe(c), { inboxMessage: { messageId: uuid(800000 + ts), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: m.id, de: EU, para: CAF, texto: m.texto, ctx: { app: 'wazeplaces' }, ts: T + ts })) } });
// A lista do Waze: a conversa com a CAF, cuja ÚLTIMA mensagem é a `n` (hora
// `T + n`), com `naoLidas` não lidas.
const lista = (n, naoLidas) => ({ online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas, atividade: T + n,
  ultima: { deMim: false, ts: T + n, recibo: false, texto: 'msg ' + n, card: null } }] });
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const pilula = (c) => ({ selo: c.$('presencaCount').textContent, rotulo: c.$('presencaPill').getAttribute('aria-label') });
const conta = (c) => c.P.presencaNaoLidasDe(CAF);

// ── R12-5-01: com o "lida" no ar, a pílula com a vista contada ──────────────

// A conversa ABERTA: a 1 chega com ela na tela (vista), e ela fecha — o "lida"
// da 1 sai e fica NO AR (o Waze lento). A carona de uma ação SAI depois dele
// (`T + 3500`) e é lida no Waze ANTES de ele ser processado, já com a resposta
// da CAF (a `n`) guardada: conta a 1 (vista) e a resposta — 2. A resposta chega
// pelo tempo real DEPOIS da lista (`listaPrimeiro`, o defeito) ou antes (o
// controle, a régua de sempre). `lote`: ela vem no lote da reconexão.
async function lidaNoArComResposta({ ordem, n = 3600, lote = false }) {
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
  const aplicar = () => c.P.presencaAoCarona(lista(n, 2), T + 3500, 30);
  if (ordem === 'listaPrimeiro') {
    c.relogio.agora = T + 4000; aplicar(); await tick();
    r.depoisDaLista = conta(c);
    c.relogio.agora = T + 4500; await chega(c, n, { lote }); await tick();
    r.depoisDaResposta = conta(c);
  } else {
    c.relogio.agora = T + 3700; await chega(c, n, { lote }); await tick();
    r.depoisDaResposta = conta(c);
    c.relogio.agora = T + 4000; aplicar(); await tick();
    r.depoisDaLista = conta(c);
  }
  r.pilula = pilula(c);
  // E fica assim enquanto o "lida" voa (o Waze lento: até 45 s).
  c.relogio.agora = T + 30_000; await tick();
  r.aos30s = conta(c);
  if (r.noAr) { soltar({ success: true }); await tick(); await tick(); }
  r.depoisDoLida = conta(c);
  return r;
}

test('R12-5-01 com o "lida" no ar, a resposta que a lista contou junto com a vista conta UMA assim que chega — sem esperar o "lida" voltar', async () => {
  const r = await lidaNoArComResposta({ ordem: 'listaPrimeiro' });
  assert.equal(r.noAr, true, 'CONTROLE: o "lida" do fechamento tinha que estar no ar');
  assert.equal(r.depoisDaLista, 2, 'CONTROLE: antes da resposta, a lista conta a vista e a resposta — o histórico ainda não a explica');
  assert.equal(r.depoisDaResposta, 1, 'DEFEITO: com a resposta no histórico, a pílula seguiu dizendo "2 mensagens novas" (uma já vista) — a conta da lista não foi refeita');
  assert.equal(r.pilula.selo, '1', `a pílula mostrou ${r.pilula.selo}`);
  assert.equal(r.pilula.rotulo, 'presenca.pill.msg{"n":1}', 'o nome da pílula disse o plural');
  assert.equal(r.aos30s, 1, 'com o "lida" ainda no ar (30 s), a conta voltou a 2');
  assert.equal(r.depoisDoLida, 1, 'o "lida" que voltou mexeu na conta da resposta que ninguém viu');
  // CONTROLE: a resposta pelo tempo real ANTES da lista — a régua que já
  // existia (a recontagem na chegada da lista) dá 1 o tempo todo.
  const k = await lidaNoArComResposta({ ordem: 'respostaPrimeiro' });
  assert.deepEqual([k.depoisDaResposta, k.depoisDaLista, k.aos30s, k.depoisDoLida], [1, 1, 1, 1], 'CONTROLE: com a resposta antes da lista, a conta tinha que ser 1 o tempo todo');
});

test('R12-5-01 pelo LOTE: a resposta guardada antes de a lista sair, entregue na reconexão DEPOIS dela, também refaz a conta', async () => {
  // A 3200 foi guardada ANTES de a lista sair (T + 3500): a régua de sempre a
  // deixa fora das vivas (a lista já a contou) — mas a conta da lista, com a
  // vista dentro, ficava 2 até o "lida" voltar.
  const r = await lidaNoArComResposta({ ordem: 'listaPrimeiro', n: 3200, lote: true });
  assert.equal(r.noAr, true, 'CONTROLE: o "lida" do fechamento tinha que estar no ar');
  assert.equal(r.depoisDaLista, 2, 'CONTROLE: antes do lote, a lista conta a vista e a resposta');
  assert.equal(r.depoisDaResposta, 1, 'DEFEITO: a resposta chegou no lote e a pílula seguiu dizendo "2 mensagens novas" (uma já vista)');
  assert.equal(r.aos30s, 1);
  assert.equal(r.depoisDoLida, 1);
  const k = await lidaNoArComResposta({ ordem: 'respostaPrimeiro', n: 3200, lote: true });
  assert.deepEqual([k.depoisDaResposta, k.depoisDaLista, k.depoisDoLida], [1, 1, 1], 'CONTROLE: com o lote antes da lista, a conta tinha que ser 1');
});

test('R12-5-01 a conta refeita na chegada da resposta não come a mensagem que só a LISTA conhece', async () => {
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
  c.relogio.agora = T + 4000; c.P.presencaAoCarona(lista(3700, 3), T + 3500, 30); await tick();
  c.relogio.agora = T + 4500; await chega(c, 3600); await tick();
  assert.ok(conta(c) >= 2, `a conta refeita perdeu a resposta que só a lista conhece: ${conta(c)}`);
  c.relogio.agora = T + 4600; await chega(c, 3700); await tick();
  assert.equal(conta(c), 2, 'com as duas respostas no histórico, a conta tinha que ser as duas que ninguém viu');
  soltar({ success: true });
  await tick(); await tick();
  assert.equal(conta(c), 2, 'o "lida" que voltou mexeu nas respostas que ninguém viu');
});
