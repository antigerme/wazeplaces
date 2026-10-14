// A presença e a conversa depois da auditoria da rodada 17 (R17-5-01 e R17-5-02,
// mais a observação 3: o diário). Os rótulos são os do relatório dessa rodada.
// Cada teste foi visto REPROVANDO com o conserto desfeito (as sabotagens estão
// no relatório do lote 21).
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
const pedidos = (c, desde = 0) => c.chamadas.chat.slice(desde).map((x) => x.acao + (x.com ? ':' + x.com : ''));
const lidaAte = (c) => (c.P.Presenca.lidaEnviadaAte.get(CAF) || 0) - T;
const FALHA = { success: false, errorCategory: 'transient', error: 'x', httpCode: 500 };
const guardouDivida = (c) => Object.prototype.hasOwnProperty.call(c.guardado().devendo || {}, CAF);

// ── R17-5-01: abrir, fechar, abrir com o `abrir` ainda NO AR ────────────────
// A segunda abertura já não vê a mensagem que a pílula contava (a primeira
// zerou a contagem), e com a primeira página ainda no ar a marca de "não vista"
// era SOBRESCRITA com 0. Quando a página em voo falhava, o fechamento mandava um
// "lida" que o Waze aplica à conversa inteira: a mensagem 2, que a tela nunca
// mostrou, virava "Lida" pra quem a mandou.
async function reabreComOAbrirNoAr({ antesDeAbrir }) {
  const soltas = [];
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => (x.acao === 'abrir' ? new Promise((ok) => soltas.push(ok)) : { success: true }) } });
  c.P.presencaMontar();
  if (antesDeAbrir) { c.relogio.agora = T + 2000; await chega(c, 2); }     // chega com a conversa FECHADA
  const naoLidasAntes = c.P.presencaNaoLidasDe(CAF);
  c.P.presencaAbrirConversa(CAF); await tick();                           // o `abrir` fica no ar (Waze lento)
  fechar(c); await tick();
  c.P.presencaAbrirConversa(CAF); await tick();                           // reabre com a primeira ainda no ar
  const marcaDepoisDaSegunda = c.P.Presenca.historico.get(CAF).naoVistoAoAbrir;
  soltas.shift()(FALHA); await tick(); await tick();                      // o `abrir` da primeira falha
  const h = c.P.Presenca.historico.get(CAF);
  c.relogio.agora = T + 3000; await chega(c, 3); await tick();            // chega com a conversa NA TELA
  const viuA2 = c.$('conversaMsgs').innerHTML.includes('msg 2');
  const viuA3 = c.$('conversaMsgs').innerHTML.includes('msg 3');
  const a0 = c.chamadas.chat.length;
  c.relogio.agora = T + 4000; fechar(c); await tick(); await tick();
  return { c, naoLidasAntes, marcaDepoisDaSegunda, primeiraFalhou: h.primeiraFalhou, viuA2, viuA3, noFechamento: pedidos(c, a0) };
}

test('R17-5-01 abrir, fechar e abrir com o `abrir` no ar: a segunda abertura não apaga a não vista, e o fechamento não a marca como lida', async () => {
  const r = await reabreComOAbrirNoAr({ antesDeAbrir: true });
  assert.equal(r.naoLidasAntes, 1, 'CONTROLE: a pílula contava a mensagem 2 antes de abrir');
  assert.equal(r.primeiraFalhou, true, 'CONTROLE: a página que estava no ar falhou');
  assert.equal(r.viuA2, false, 'CONTROLE: a mensagem 2 NÃO está na tela');
  assert.equal(r.viuA3, true, 'CONTROLE: a mensagem 3, que chegou com a conversa na tela, está');
  assert.equal(r.marcaDepoisDaSegunda, 1, 'DEFEITO: a segunda abertura (com a primeira página no ar) apagou a não vista da primeira');
  assert.deepEqual(r.noFechamento, [], 'DEFEITO: o "lida" do fechamento marcou no Waze a conversa inteira, com a mensagem 2 nunca vista');
  assert.equal(lidaAte(r.c) < 0, true, 'a mensagem 2 (ou a 3) foi dada como confirmada como lida');
  assert.equal(r.c.P.Presenca.lidaDevendo.has(CAF), false, 'a dívida do "lida" ficou de pé');
  assert.equal(guardouDivida(r.c), false, 'a dívida ficou GUARDADA no aparelho, pra próxima página pagar');
});

test('R17-5-01 CONTROLE: o mesmo roteiro sem nada que a pílula contasse paga a mensagem vista ao vivo (o R15-5-02 segue)', async () => {
  const r = await reabreComOAbrirNoAr({ antesDeAbrir: false });
  assert.equal(r.naoLidasAntes, 0, 'CONTROLE: nada antes de abrir');
  assert.equal(r.marcaDepoisDaSegunda, 0);
  assert.equal(r.viuA3, true, 'CONTROLE: a mensagem 3 está na tela');
  assert.deepEqual(r.noFechamento, ['lida:' + CAF], 'a mensagem VISTA ao vivo deixou de ser marcada: o conserto matou o R15-5-02');
});

test('R17-5-01 a variante da renovação: abrir sem perfil, fechar, reabrir, o perfil volta e a página falha — a não vista fica', async () => {
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => (x.acao === 'abrir' ? FALHA : { success: true }) } });
  c.P.presencaMontar();
  c.relogio.agora = T + 2000; await chega(c, 2);
  const perfil = c.AppState.profile;
  c.AppState.profile = null;                                              // a renovação silenciosa: sessão de pé, perfil ainda não voltou
  c.P.presencaAbrirConversa(CAF); await tick();                           // "Carregando" (espera o perfil)
  fechar(c); await tick();
  c.P.presencaAbrirConversa(CAF); await tick();
  const h = c.P.Presenca.historico.get(CAF);
  assert.equal(!!h.esperaPerfil, true, 'CONTROLE: a primeira página está esperando o perfil');
  assert.equal(h.naoVistoAoAbrir, 1, 'DEFEITO: a reabertura apagou a não vista enquanto a primeira página esperava o perfil');
  c.AppState.profile = perfil;                                            // o perfil chega e a página falha
  await c.P.presencaSincronizar(); await tick(); await tick();
  assert.equal(h.primeiraFalhou, true, 'CONTROLE: a página falhou');
  assert.equal(c.$('conversaMsgs').innerHTML.includes('msg 2'), false, 'CONTROLE: a mensagem 2 não está na tela');
  c.relogio.agora = T + 3000; await chega(c, 3); await tick();
  const a0 = c.chamadas.chat.length;
  fechar(c); await tick(); await tick();
  assert.deepEqual(pedidos(c, a0), [], 'DEFEITO: o fechamento marcou como lida a mensagem 2, nunca vista');
});

// ── R17-5-02: a dívida do fechamento SEM perfil nasce por fora da trava ──────
// `presencaPagarLida` sem o perfil chama `presencaDever` direto. Com a primeira
// página falhada e a não vista guardada, a dívida nascia mesmo assim; com o
// perfil de volta e a lista ainda fresca ela era paga, e o Waze marcava a
// conversa inteira.
async function fechadaSemPerfil({ antesDeAbrir }) {
  const servidor = { naoLidas: [] };
  const c = novoCliente({ agora: T + 10, api: {
    presencaApp: () => ({ success: true, agora: c.relogio.agora, online: [], conversas: servidor.naoLidas.length === 0 ? [] : [{ id: CAF, nome: 'cafanha', naoLidas: servidor.naoLidas.length, atividade: T + 3, ultima: { deMim: false, ts: T + 3, recibo: false, texto: 'x', card: null } }] }),
    chat: (x) => { if (x.acao === 'lida') { servidor.naoLidas = []; return { success: true }; } return x.acao === 'abrir' ? FALHA : { success: true }; } } });
  c.P.presencaMontar();
  await c.P.presencaAtualizar(); await tick();                            // lista FRESCA, antes de tudo
  if (antesDeAbrir) { c.relogio.agora = T + 2000; servidor.naoLidas = [2]; await chega(c, 2); }
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();             // o `abrir` falha: a tela não mostra a 2
  c.relogio.agora = T + 3000; servidor.naoLidas.push(3); await chega(c, 3); await tick();   // a 3 chega com a conversa na tela
  const perfil = c.AppState.profile;
  c.AppState.profile = null;                                              // a renovação silenciosa
  fechar(c); await tick(); await tick();
  const devendoSemPerfil = c.P.Presenca.lidaDevendo.has(CAF);
  const guardada = guardouDivida(c);
  c.AppState.profile = perfil;                                            // o perfil volta
  const a0 = c.chamadas.chat.length;
  await c.P.presencaSincronizar(); await tick(); await tick();
  return { c, servidor, devendoSemPerfil, guardada, depois: pedidos(c, a0) };
}

test('R17-5-02 fechar SEM perfil, com a primeira página falhada e a não vista guardada: não nasce dívida, e o perfil de volta não marca nada', async () => {
  const r = await fechadaSemPerfil({ antesDeAbrir: true });
  assert.equal(r.c.P.Presenca.historico.get(CAF).primeiraFalhou, true, 'CONTROLE: a primeira página falhou');
  assert.equal(r.c.P.Presenca.historico.get(CAF).naoVistoAoAbrir, 1, 'CONTROLE: a não vista está guardada');
  assert.equal(r.devendoSemPerfil, false, 'DEFEITO: a dívida nasceu pelo `presencaDever` direto do fechamento sem perfil');
  assert.equal(r.guardada, false, 'DEFEITO: a dívida foi GUARDADA no aparelho');
  assert.deepEqual(r.depois, [], 'DEFEITO: com o perfil de volta e a lista fresca, a dívida foi paga e o Waze marcou a mensagem 2, nunca vista');
  assert.equal(r.servidor.naoLidas.length, 2, 'o Waze deixou de contar as duas como não lidas');
});

test('R17-5-02 CONTROLE: o mesmo fechamento sem perfil, sem nada que a pílula contasse, segue devendo o "lida" da mensagem vista', async () => {
  const r = await fechadaSemPerfil({ antesDeAbrir: false });
  assert.equal(r.devendoSemPerfil, true, 'CONTROLE: a conversa ficou devendo a mensagem 3, vista');
  assert.equal(r.guardada, true, 'CONTROLE: a dívida foi guardada');
});

test('R17-5-02 `presencaDever` recusa a conversa com a não vista, por qualquer caminho', async () => {
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => (x.acao === 'abrir' ? FALHA : { success: true }) } });
  c.P.presencaMontar();
  c.relogio.agora = T + 2000; await chega(c, 2);
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  c.relogio.agora = T + 3000; await chega(c, 3); await tick();            // a 3 está na tela
  c.P.presencaDever(CAF);
  assert.equal(c.P.Presenca.lidaDevendo.has(CAF), false, 'DEFEITO: o `presencaDever` direto criou a dívida');
  assert.equal(guardouDivida(c), false);
  // CONTROLE: a primeira página boa limpa a marca, e aí a dívida nasce.
  c.P.Presenca.historico.get(CAF).primeiraFalhou = false;
  c.P.Presenca.historico.get(CAF).naoVistoAoAbrir = 0;
  c.P.presencaDever(CAF);
  assert.equal(c.P.Presenca.lidaDevendo.has(CAF), true, 'CONTROLE: sem a não vista a dívida nasce');
});

// ── Observação 3: o diário explica "a mensagem voltou como nova" ────────────
test('R17-5 o "lida" que deixa de sair pela não vista deixa UMA linha no diário por minuto, sem texto nem id', async () => {
  const r = await fechadaSemPerfil({ antesDeAbrir: true });
  const linhas = () => r.c.chamadas.dfato.filter(([k, o]) => k === 'chat.lida' && o.pulou);
  assert.equal(linhas().length >= 1, true, 'DEFEITO: o "lida" que deixou de sair não deixou linha no diário');
  assert.deepEqual(Object.keys(linhas()[0][1]).sort(), ['juntas', 'pulou'], 'a linha carrega só o motivo e quantas vieram juntas (nada de texto nem id)');
  assert.equal(linhas()[0][1].pulou, 'naoVista');
  // O limitador: muitos pulos no mesmo minuto não viram muitas linhas.
  const antes = linhas().length;
  for (let i = 0; i < 10; i++) r.c.P.presencaDever(CAF);
  assert.equal(linhas().length, antes, 'DEFEITO: o diário ganhou uma linha por pulo no mesmo minuto');
  r.c.relogio.agora += 61_000;
  r.c.P.presencaDever(CAF);
  assert.equal(linhas().length, antes + 1, 'passado o minuto a linha volta, contando os pulos desde a anterior');
  assert.equal(linhas().at(-1)[1].juntas >= 11, true, 'a linha não contou os pulos suprimidos desde a anterior');
  // A linha da FALHA do "lida" tem limitador próprio: o pulo, no mesmo minuto,
  // não a engole (e ela não engole o pulo).
  r.c.relogio.agora += 61_000;
  r.c.P.presencaDever(CAF);
  r.c.P.presencaAnotarMsg('chat.lida', { ok: false, categoria: 'transient' });
  assert.equal(r.c.chamadas.dfato.some(([k, o]) => k === 'chat.lida' && o.ok === false), true, 'DEFEITO: a linha do pulo engoliu a da falha do "lida" (o limitador é o mesmo)');
});

test('R17-5 CONTROLE: sem a não vista, o fechamento não deixa a linha de "pulou" no diário', async () => {
  const r = await fechadaSemPerfil({ antesDeAbrir: false });
  assert.equal(r.c.chamadas.dfato.some(([k, o]) => k === 'chat.lida' && o.pulou), false);
});
