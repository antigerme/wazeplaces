// A presença e a conversa depois da auditoria da rodada 14 (R14-5 e R14-8-15).
// Os rótulos são os do relatório dessa rodada, e cada seção abaixo diz o
// defeito que cobre. Cada teste foi visto REPROVANDO com o conserto desfeito.
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
const INST = 'a0000000-0000-4000-8000-000000000001';
const SESSAO_MORTA = { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.sessionExpired', httpCode: 401 };

const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c, emLote = false) => ({ ctl: new AbortController(), emLote, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
// A mensagem `n` da CAF, com a hora `T + n` (a do Waze), chegando pelo tempo real.
const chega = async (c, n, { lote = false } = {}) => c.P.presencaQuadro(fluxoDe(c, lote), { inboxMessage: { messageId: uuid(900000 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts: T + n })) } });
// A lista do Waze: a conversa com a CAF, cuja ÚLTIMA mensagem é a `n`, com `naoLidas`.
const lista = (n, naoLidas) => ({ online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas, atividade: T + n,
  ultima: { deMim: false, ts: T + n, recibo: false, texto: 'msg ' + n, card: null } }] });
const doHistorico = (n) => ({ id: uuid(n), ts: T + n, de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto',
  texto: 'msg ' + n, recibo: null, contexto: { app: 'wazeplaces' } });
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const conta = (c) => c.P.presencaNaoLidasDe(CAF);
const lidaAte = (c) => (c.P.Presenca.lidaEnviadaAte.get(CAF) || 0) - T;
// Os pedidos ao chat DEPOIS do índice `desde`: `abrir`, `abrir(antiga)`, `lida`.
const pedidos = (c, desde = 0) => c.chamadas.chat.slice(desde).map((x) => x.acao + (x.antesDe ? '(antiga)' : ''));
const tocarVerAnteriores = (c) => c.$('conversaMsgs').disparar('click', {
  target: { closest: (sel) => (sel === '.conversa-anteriores' ? {} : null) } });

// ── R14-5-02: o 401 de uma resposta da sessão ANTERIOR ──────────────────────
//
// O pedido sai com a sessão A; ela morre e a extensão a renova (a mesma conta,
// a sessão B na memória); a resposta da A chega depois, com 401. Conferir a
// sessão de AGORA (a B, viva) era uma sonda a mais e o "Conexão instável".

async function respostaTardia({ disparar, renovar = true, chat = null }) {
  let soltar = null;
  const segurar = () => new Promise((ok) => { soltar = ok; });
  const c = novoCliente({ agora: T, api: {
    presencaApp: () => segurar(),
    chat: (x) => (chat ? chat(x, segurar) : segurar()),
  } });
  await disparar(c);
  assert.equal(typeof soltar, 'function', 'CONTROLE: o pedido tinha que estar no ar');
  if (renovar) c.API.sessionToken = 'token-renovado';      // a renovação: outra sessão, a mesma conta
  soltar(SESSAO_MORTA);
  await tick(); await tick(); await tick();
  return c;
}

test('R14-5-02 a lista (`presenca-app`) da sessão anterior que volta 401 depois da renovação não confere a sessão de agora', async () => {
  const disparar = async (c) => { c.P.presencaAtualizar(); await tick(); };
  const tardia = await respostaTardia({ disparar });
  assert.equal(tardia.chamadas.unauthorized, 0, 'DEFEITO: o 401 da sessão que já se foi conferiu a sessão renovada — a sonda a mais e o "Conexão instável"');
  // CONTROLE: o 401 da sessão de AGORA confere (gotcha #42).
  const agora = await respostaTardia({ disparar, renovar: false });
  assert.equal(agora.chamadas.unauthorized, 1, 'CONTROLE: o 401 da própria sessão tinha que ser conferido');
});

test('R14-5-02 a conversa (`abrir`) da sessão anterior que volta 401 depois da renovação não confere a sessão de agora — e a tela diz que não carregou', async () => {
  const disparar = async (c) => { c.P.presencaAbrirConversa(CAF); await tick(); };
  const tardia = await respostaTardia({ disparar });
  assert.equal(tardia.chamadas.unauthorized, 0, 'DEFEITO: o 401 da sessão que já se foi conferiu a sessão renovada');
  assert.ok(tardia.$('conversaMsgs').innerHTML.includes('presenca.conversa.erro'), 'a falha do histórico deixou de aparecer');
  const agora = await respostaTardia({ disparar, renovar: false });
  assert.equal(agora.chamadas.unauthorized, 1, 'CONTROLE: o 401 da própria sessão tinha que ser conferido');
});

test('R14-5-02 o envio da sessão anterior que volta 401 depois da renovação não confere a sessão de agora — e a mensagem fica "Não enviada."', async () => {
  const chat = (x, segurar) => (x.acao === 'abrir' ? { success: true, mensagens: [], maisAntigas: false, lida: true } : segurar());
  const disparar = async (c) => {
    c.P.presencaAbrirConversa(CAF);
    await tick(); await tick();
    c.P.presencaEnviar('é a fachada?', null);
    await tick();
  };
  const tardia = await respostaTardia({ disparar, chat });
  assert.equal(tardia.chamadas.unauthorized, 0, 'DEFEITO: o 401 do envio da sessão que já se foi conferiu a sessão renovada');
  const minha = tardia.P.Presenca.historico.get(CAF).msgs.find((m) => m.meu);
  assert.equal(minha.estado, 'falhou', 'a mensagem cujo envio levou 401 deixou de ficar "Não enviada."');
  const agora = await respostaTardia({ disparar, chat, renovar: false });
  assert.equal(agora.chamadas.unauthorized, 1, 'CONTROLE: o 401 da própria sessão tinha que ser conferido');
});
