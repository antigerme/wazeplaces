// A presença e a conversa depois da auditoria da rodada 11 (R11-5): a resposta
// que a LISTA já contou e o tempo real entrega depois dela contada duas vezes,
// o envio (e o histórico) que FALHA sem chegar ao leitor de tela, e a pílula que
// some com o foco do teclado nela. Os rótulos R11-5-n são os do relatório dessa
// rodada. Cada teste foi visto REPROVANDO com o conserto desfeito.
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
// A lista do Waze: a conversa com a CAF, cuja ÚLTIMA mensagem é a `n` (hora
// `T + n`), com `naoLidas` não lidas.
const lista = (n, naoLidas) => ({ online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas, atividade: T + n,
  ultima: { deMim: false, ts: T + n, recibo: false, texto: 'msg ' + n, card: null } }] });
const doHistorico = (n) => ({ id: uuid(n), ts: T + n, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto',
  texto: 'msg ' + n, recibo: null, contexto: { app: 'wazeplaces' } });
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const pilula = (c) => ({ escondida: c.$('presencaPill').classList.contains('hidden'),
  balao: !c.$('presencaIconMsg').classList.contains('hidden'), selo: c.$('presencaCount').textContent,
  rotulo: c.$('presencaPill').getAttribute('aria-label') });
const conta = (c) => c.P.presencaNaoLidasDe(CAF);

// ── R11-5-01: a resposta contada pela lista E pelo tempo real ──────────────

// A conversa com a CAF já existia (a 3, lida). A carona de uma ação SAI em
// `T + 4000`, e a CAF manda a resposta (a 4200) depois de o pedido sair e
// antes de o Waze ler a lista: a lista a CONTA. O tempo real a entrega DEPOIS
// de a lista ser aplicada (`listaPrimeiro`, o defeito) ou antes (o caso que a
// régua da lista já cobria). `guardadaAntes`: a resposta guardada antes de o
// pedido sair (a 3900), no lote — a régua de sempre.
async function respostaContada({ ordem, lote = false, guardadaAntes = false }) {
  const c = novoCliente({ agora: T + 1000 });
  c.P.presencaAoCarona(lista(3, 0), T + 900, 30);
  const n = guardadaAntes ? 3900 : 4200;
  const aplicar = () => c.P.presencaAoCarona(lista(n, 1), T + 4000, 30);
  if (ordem === 'listaPrimeiro') {
    c.relogio.agora = T + 4500; aplicar(); await tick();
    c.relogio.agora = T + 4700; await chega(c, n, { lote }); await tick();
  } else {
    c.relogio.agora = T + 4330; await chega(c, n, { lote }); await tick();
    c.relogio.agora = T + 4500; aplicar(); await tick();
  }
  const r = { conta: conta(c), pilula: pilula(c) };
  c.relogio.agora = T + 40_000;
  c.P.presencaAoCarona(lista(n, 1), T + 39_000, 30);         // a lista seguinte (outra carona)
  await tick();
  return { ...r, seguinte: conta(c) };
}

test('R11-5-01 a resposta que a LISTA já contou e o tempo real entrega DEPOIS dela conta UMA vez — ao vivo e no lote', async () => {
  for (const lote of [false, true]) {
    const r = await respostaContada({ ordem: 'listaPrimeiro', lote });
    const como = lote ? 'no lote' : 'ao vivo';
    assert.equal(r.conta, 1, `DEFEITO (${como}): a resposta contada pela lista contou de novo pelo tempo real — "2 mensagens novas" com uma só`);
    assert.equal(r.pilula.selo, '1', `${como}: a pílula mostrou ${r.pilula.selo}`);
    assert.equal(r.pilula.rotulo, 'presenca.pill.msg{"n":1}', `${como}: o nome da pílula disse o plural`);
    assert.equal(r.seguinte, 1, `${como}: a lista seguinte não ficou em 1`);
    // CONTROLE: o tempo real ANTES da lista (a régua que já existia) — 1.
    const k = await respostaContada({ ordem: 'fluxoPrimeiro', lote });
    assert.equal(k.conta, 1, `CONTROLE (${como}): o tempo real antes da lista tinha que contar 1`);
    assert.equal(k.seguinte, 1);
  }
  // CONTROLE: a resposta guardada ANTES de o pedido da lista sair, reentregue
  // no lote depois dela — a régua de sempre (`atualizadaEm`) já a deixava fora.
  const g = await respostaContada({ ordem: 'listaPrimeiro', lote: true, guardadaAntes: true });
  assert.equal(g.conta, 1, 'CONTROLE: a resposta guardada antes de a lista sair tinha que contar 1');
});

test('R11-5-01 a régua da lista só leva o que ELA contou: a mensagem depois dela, e a que ela não conta mais, seguem contando', async () => {
  // A lista conta a 4200. A 5000 (hora DEPOIS da régua da lista) chega ANTES
  // da 4200: é nova — 2. A régua é a GUARDADA: a `atividade` da conversa a
  // prévia já reescreveu com a hora da própria 5000.
  const c = novoCliente({ agora: T + 1000 });
  c.P.presencaAoCarona(lista(3, 0), T + 900, 30);
  c.relogio.agora = T + 4500; c.P.presencaAoCarona(lista(4200, 1), T + 4000, 30); await tick();
  c.relogio.agora = T + 4700; await chega(c, 5000); await tick();
  assert.equal(conta(c), 2, 'DEFEITO: a mensagem com hora DEPOIS da régua da lista foi tomada como contada por ela');
  // A 4200, que a lista contou, chega depois: segue 2.
  c.relogio.agora = T + 5200; await chega(c, 4200); await tick();
  assert.equal(conta(c), 2, 'a resposta contada pela lista contou de novo (ou sumiu) depois de uma mensagem nova');
  // A lista contou a 4200, mas a conversa estava NA TELA: a conta dela vale
  // zero ("olhando é lida"). Fechada antes de a 4200 chegar, a 4200 é nova —
  // e ninguém a viu: conta 1.
  const d = novoCliente({ agora: T + 1000, api: { chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [], maisAntigas: false, lida: true } : { success: true }) } });
  d.P.presencaAoCarona(lista(3, 0), T + 900, 30);
  d.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  d.relogio.agora = T + 4500; d.P.presencaAoCarona(lista(4200, 1), T + 4000, 30); await tick();
  assert.equal(conta(d), 0, 'CONTROLE: com a conversa na tela, a lista tinha que valer zero');
  fechar(d);
  d.relogio.agora = T + 4700; await chega(d, 4200); await tick();
  assert.equal(conta(d), 1, 'a resposta que ninguém viu, chegada com a conversa fechada, deixou de contar (a régua levou de uma conta já zerada)');
});

// A conversa ABERTA: a 1 chega com ela na tela (vista), e ela fecha — o "lida"
// da 1 sai e fica no AR (o Waze lento). A carona de uma ação saiu ANTES dele
// (`T + 2000`) e é lida no Waze DEPOIS de ele ser processado e de a CAF
// responder (a 3500): a lista conta só a resposta. O tempo real a entrega com a
// conversa fechada, e o "lida" volta.
test('R11-5-01 a resposta que a lista contou, entregue depois dela, NÃO SOME quando o "lida" que saiu depois da lista volta', async () => {
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
  assert.equal(typeof soltar, 'function', 'CONTROLE: o "lida" do fechamento tinha que estar no ar');
  c.relogio.agora = T + 4000; c.P.presencaAoCarona(lista(3500, 1), T + 2000, 30); await tick();
  assert.equal(conta(c), 1, 'CONTROLE: a lista conta a resposta');
  c.relogio.agora = T + 4500; await chega(c, 3500); await tick();
  assert.equal(conta(c), 1, 'DEFEITO: a resposta contada pela lista contou de novo pelo tempo real');
  soltar({ success: true });
  await tick(); await tick();
  // O "lida" (que saiu DEPOIS da lista) zera a conta dela — e a resposta, que
  // chegou depois dele, segue contando: ela não pode ter ido junto.
  assert.equal(conta(c), 1, 'DEFEITO: a resposta que ninguém viu SUMIU com o "lida" que voltou (ela tinha ficado fora da conta)');
  assert.equal(pilula(c).balao, true, 'a pílula perdeu o balão da resposta');
  // A lista seguinte (o Waze ainda conta a resposta) segue em 1.
  c.relogio.agora = T + 6000; c.P.presencaAoCarona(lista(3500, 1), T + 5000, 30); await tick();
  assert.equal(conta(c), 1);
});

test('R11-5-01 a lista que o Waze leu ANTES da resposta, chegando depois dela, não a esquece', async () => {
  const c = novoCliente({ agora: T + 1000 });
  c.P.presencaAoCarona(lista(3, 0), T + 900, 30);
  // A carona que saiu em T + 4000, lida depois da resposta (a conta).
  c.relogio.agora = T + 4500; c.P.presencaAoCarona(lista(4200, 1), T + 4000, 30); await tick();
  c.relogio.agora = T + 4700; await chega(c, 4200); await tick();
  assert.equal(conta(c), 1, 'CONTROLE: a resposta contada pela lista conta 1');
  // Outra lista, que saiu DEPOIS (T + 4100) mas foi lida no Waze ANTES de a
  // resposta existir: ela não a conta. Chega agora, e vale (é a mais nova).
  c.relogio.agora = T + 5000; c.P.presencaAoCarona(lista(3, 0), T + 4100, 30); await tick();
  assert.equal(conta(c), 1, 'DEFEITO: a lista lida antes da resposta a apagou — a resposta que ninguém viu sumiu da pílula');
});

// A conversa ABERTA: a 1 chega com ela na tela, e ela fecha — o "lida" da 1
// sai e fica no AR. A carona sai DEPOIS dele (`T + 3500`) e é lida no Waze
// ANTES de ele ser processado: conta a 1 (vista) e a resposta (a 3600). O tempo
// real entrega a resposta, e o "lida" volta: a conta é refeita pelo histórico
// (R10-5-04) — que agora TEM a resposta, que já conta como viva.
test('R11-5-01 depois do "lida" que deu certo, a recontagem pelo histórico não conta de novo a resposta que já conta ao vivo', async () => {
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
  c.relogio.agora = T + 4000; c.P.presencaAoCarona(lista(3600, 2), T + 3500, 30); await tick();
  c.relogio.agora = T + 4500; await chega(c, 3600); await tick();
  assert.ok(conta(c) <= 2, `a resposta contou de novo pelo tempo real: ${conta(c)}`);
  soltar({ success: true });
  await tick(); await tick();
  assert.equal(conta(c), 1, 'DEFEITO: depois do "lida", a resposta contou pela lista refeita E pela viva — "2 mensagens novas" com uma só');
});
