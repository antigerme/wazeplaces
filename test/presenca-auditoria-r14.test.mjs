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

// ── R14-5-01: o que a REABERTURA mostrou e ninguém marcou ───────────────────
//
// A conversa com a CAF carregada (a 1, e há mais antigas) e fechada; a 2000
// chega com ela FECHADA (o tempo real a junta ao histórico), e a REABERTURA a
// mostra. Quem a marcaria no Waze é a primeira página da reabertura (o
// `abrir`), mas ela fica pra depois: (a) a página ANTIGA no ar; (b) a espera do
// perfil. A conversa fecha antes.

// (a): `antiga` — "Ver mensagens anteriores" antes de fechar (a página antiga
// fica no ar até `soltarAntiga`). `lida` responde o "lida".
async function reabertaComAntigaNoAr({ antiga = true, lidaResp = () => ({ success: true }) } = {}) {
  let soltarAntiga = null;
  let inicial = true;
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => {
    if (x.acao === 'lida') return lidaResp(x);
    if (x.acao !== 'abrir') return { success: true };
    if (x.com !== CAF) return { success: true, mensagens: [], maisAntigas: false, lida: true };
    if (inicial) { inicial = false; return { success: true, mensagens: [doHistorico(1)], maisAntigas: true, lida: true }; }
    if (x.antesDe) return new Promise((ok) => { soltarAntiga = ok; });
    return { success: true, mensagens: [doHistorico(1), doHistorico(2000)], maisAntigas: true, lida: true };
  } } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  if (antiga) { tocarVerAnteriores(c); await tick(); }
  fechar(c);
  await tick();
  c.relogio.agora = T + 2000; await chega(c, 2000);           // com a conversa FECHADA
  const r = { contaFechada: conta(c) };
  c.relogio.agora = T + 3000;
  const antesDaReabertura = c.chamadas.chat.length;
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  r.viuA2000 = c.$('conversaMsgs').innerHTML.includes('msg 2000');
  r.naReabertura = pedidos(c, antesDaReabertura);
  c.relogio.agora = T + 3500;
  const antesDoFechamento = c.chamadas.chat.length;
  fechar(c);                                                   // FECHA antes de a antiga voltar
  await tick(); await tick();
  r.noFechamento = pedidos(c, antesDoFechamento);
  return { c, r, soltarAntiga: (resp) => soltarAntiga(resp) };
}
const ANTIGA_OK = { success: true, mensagens: [doHistorico(-5000)], maisAntigas: false, lida: false };

test('R14-5-01 (a) reaberta com a página ANTIGA no ar e fechada antes de ela voltar: o fechamento marca como lida a mensagem que a reabertura mostrou — um "lida", nenhuma primeira página', async () => {
  const { c, r, soltarAntiga } = await reabertaComAntigaNoAr();
  assert.equal(r.contaFechada, 1, 'CONTROLE: a 2000 chegou com a conversa fechada e conta como nova');
  assert.equal(r.viuA2000, true, 'CONTROLE: a reabertura mostra a 2000');
  assert.deepEqual(r.naReabertura, [], 'CONTROLE: com a antiga no ar, a reabertura não pede nada ainda (o lote 17)');
  assert.deepEqual(r.noFechamento, ['lida'], 'DEFEITO: fechada antes de a antiga voltar, a mensagem vista ficou não lida no Waze — nenhum "lida" saiu');
  assert.equal(lidaAte(c), 2000, 'o "lida" do fechamento não cobriu a 2000');
  // A antiga volta com a conversa fechada: nenhuma primeira página "que
  // ninguém vê" (o controle do lote 17 segue valendo).
  const antesDaAntiga = c.chamadas.chat.length;
  c.relogio.agora = T + 4000;
  soltarAntiga(ANTIGA_OK);
  await tick(); await tick(); await tick();
  assert.deepEqual(pedidos(c, antesDaAntiga), [], 'a antiga voltou com a conversa fechada e pediu outra página');
  // A lista seguinte — a carona de uma ação que SAIU antes do "lida" e foi lida
  // no Waze antes dele — não devolve a vista como "1 mensagem nova".
  c.relogio.agora = T + 5000;
  c.P.presencaAoCarona(lista(2000, 1), T + 3400, 30);
  await tick();
  assert.equal(conta(c), 0, 'a lista seguinte devolveu a mensagem vista como "1 mensagem nova"');
  assert.equal(c.P.Presenca.lidaDevendo.size, 0, 'o "lida" pago ficou como dívida');
  // CONTROLE: sem nada adiado, quem marca é o `abrir` da reabertura — e o
  // fechamento não manda "lida" nenhum (seria o mesmo pedido em dobro).
  const k = await reabertaComAntigaNoAr({ antiga: false });
  assert.deepEqual(k.r.naReabertura, ['abrir'], 'CONTROLE: sem a antiga no ar, a reabertura pede a primeira página');
  assert.deepEqual(k.r.noFechamento, [], 'CONTROLE: o `abrir` da reabertura já cobriu a 2000, e o fechamento mandou um "lida" a mais');
  assert.equal(lidaAte(k.c), 2000, 'CONTROLE: o `abrir` da reabertura marca a 2000');
});

test('R14-5-01 (a) o "lida" do fechamento que FALHA volta a dever, e o próximo fechamento o paga', async () => {
  let falhar = true;
  const { c } = await reabertaComAntigaNoAr({ lidaResp: () => (falhar ? { success: false, errorCategory: 'transient', _motivo: 'TypeError' } : { success: true }) });
  assert.equal(lidaAte(c), 1, 'CONTROLE: o "lida" do fechamento falhou');
  assert.ok(c.P.Presenca.lidaDevendo.has(CAF), 'o "lida" que falhou não ficou devendo');
  assert.equal(c.guardado().devendo[CAF].ate, T + 2000, 'a dívida guardada no aparelho não diz o que a pessoa viu (a 2000)');
  falhar = false;
  // Outra conversa abre e fecha: o fechamento paga as dívidas.
  c.P.presencaAbrirConversa('555000111');
  await tick(); await tick();
  fechar(c);
  await tick(); await tick();
  assert.equal(lidaAte(c), 2000, 'o fechamento seguinte não pagou a dívida da mensagem vista');
});

// (b): a reabertura na ESPERA do perfil (a renovação silenciosa).
async function reabertaNaEsperaDoPerfil({ fecharAntes = true, lista: daLista = () => ({ success: true, online: [], conversas: [] }) } = {}) {
  let inicial = true;
  const c = novoCliente({ agora: T + 10, api: {
    chat: (x) => {
      if (x.acao !== 'abrir') return { success: true };
      if (inicial) { inicial = false; return { success: true, mensagens: [doHistorico(1)], maisAntigas: true, lida: true }; }
      return { success: true, mensagens: [doHistorico(1), doHistorico(2000)], maisAntigas: true, lida: true };
    },
    presencaApp: (x) => daLista(x),
  } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  fechar(c);
  await tick();
  c.relogio.agora = T + 2000; await chega(c, 2000);            // com a conversa FECHADA
  const perfil = c.AppState.profile;
  c.AppState.profile = null;                                   // a renovação silenciosa
  c.relogio.agora = T + 3000;
  const antes = c.chamadas.chat.length;
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  const r = { viuA2000: c.$('conversaMsgs').innerHTML.includes('msg 2000') };
  if (fecharAntes) { c.relogio.agora = T + 3500; fechar(c); await tick(); await tick(); }
  r.naEspera = pedidos(c, antes);
  r.devendo = c.P.Presenca.lidaDevendo.has(CAF);
  r.guardada = (c.guardado().devendo || {})[CAF] || null;
  c.AppState.profile = perfil;                                 // o perfil volta
  c.relogio.agora = T + 70_000;
  await c.P.presencaSincronizar();
  await tick(); await tick();
  r.depoisDoPerfil = pedidos(c, antes);
  r.lidaAte = lidaAte(c);
  return { c, r };
}

test('R14-5-01 (b) reaberta na ESPERA do perfil e fechada antes de ele voltar: o "lida" da mensagem vista fica devendo e sai quando o perfil volta', async () => {
  const { r } = await reabertaNaEsperaDoPerfil();
  assert.equal(r.viuA2000, true, 'CONTROLE: a reabertura na espera mostra a 2000');
  assert.deepEqual(r.naEspera, [], 'CONTROLE: sem o perfil, nada sai (R5-5-2)');
  assert.equal(r.devendo, true, 'DEFEITO: fechada na espera do perfil, a conversa não ficou devendo o "lida" da mensagem vista');
  assert.equal(r.guardada && r.guardada.ate, T + 2000, 'a dívida guardada no aparelho não diz o que a pessoa viu (a 2000)');
  assert.deepEqual(r.depoisDoPerfil, ['lida'], 'o perfil voltou e o "lida" da mensagem vista não saiu (ou saiu uma primeira página que ninguém vê)');
  assert.equal(r.lidaAte, 2000, 'a 2000, vista na reabertura, não foi marcada como lida no Waze');
  // CONTROLE: aberta até o perfil voltar, quem marca é a primeira página que
  // esperava (o `abrir`) — e nenhum "lida" a mais.
  const { r: k } = await reabertaNaEsperaDoPerfil({ fecharAntes: false });
  assert.deepEqual(k.depoisDoPerfil, ['abrir'], 'CONTROLE: aberta, a primeira página que esperava o perfil sai quando ele volta');
  assert.equal(k.devendo, false, 'CONTROLE: aberta, nada fica devendo');
  assert.equal(k.lidaAte, 2000, 'CONTROLE: o `abrir` marca a 2000');
});

test('R14-5-01 (b) a lista que chega com o perfil e conta uma mensagem que a pessoa NÃO viu tira a dívida — nada marca o que ninguém viu (R7-5-01)', async () => {
  // A 2500 chegou durante a espera (o tempo real fica fechado sem o perfil):
  // a lista que o perfil traz a conhece, e pagar marcaria ela também.
  const { c, r } = await reabertaNaEsperaDoPerfil({ lista: () => ({ success: true, ...lista(2500, 2) }) });
  assert.equal(r.devendo, true, 'CONTROLE: fechada na espera, a conversa devia o "lida" da 2000');
  assert.deepEqual(r.depoisDoPerfil, [], 'a dívida da 2000 foi paga com a 2500, que ninguém viu, na lista — o "lida" a marcaria também');
  assert.equal(c.P.Presenca.lidaDevendo.has(CAF), false, 'a dívida ficou de pé com a mensagem que ninguém viu');
  assert.equal(conta(c), 2, 'a conta da lista não ficou (a vista e a que ninguém viu seguem não lidas no Waze)');
});

// (c): a PRIMEIRA página da abertura anterior ainda NO AR quando a conversa
// reabre (o `soltar` a devolve). Quem marca a 2000 é o "lida" depois dela (a
// rajada, R5-5-1), e a rajada só existe com a conversa na tela.
async function primeiraNoAr({ fecharAntes = true, resposta = { success: true, mensagens: [doHistorico(1)], maisAntigas: false, lida: true },
  depoisDeFechar = null } = {}) {
  let soltar = null;
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => (x.acao === 'abrir' ? new Promise((ok) => { soltar = ok; }) : { success: true }) } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick();
  fechar(c);
  await tick();
  c.relogio.agora = T + 2000; await chega(c, 2000);            // com a conversa FECHADA
  c.relogio.agora = T + 3000;
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  const r = { viuA2000: c.$('conversaMsgs').innerHTML.includes('msg 2000'), abrir: c.chamadas.chat.filter((x) => x.acao === 'abrir').length };
  if (fecharAntes) { fechar(c); await tick(); }
  if (depoisDeFechar) await depoisDeFechar(c);
  r.antesDaPrimeira = pedidos(c, 1);
  c.relogio.agora = T + 4000;
  soltar(resposta);
  await tick(); await tick(); await tick();
  c.relogio.agora = T + 6000;
  await c.rodarTimers();
  await tick(); await tick();
  r.depoisDaPrimeira = pedidos(c, 1);
  r.lidaAte = lidaAte(c);
  return { c, r };
}

test('R14-5-01 (c) a primeira página da abertura anterior no ar, a conversa reaberta e fechada antes de ela voltar: quando ela volta, sai o "lida" do que ela não cobre — um pedido', async () => {
  const { c, r } = await primeiraNoAr();
  assert.equal(r.viuA2000, true, 'CONTROLE: a reabertura mostra a 2000');
  assert.equal(r.abrir, 1, 'CONTROLE: com a primeira página no ar, a reabertura não pede outra');
  assert.deepEqual(r.antesDaPrimeira, [], 'com a primeira página no ar, o fechamento mandou um "lida" antes da resposta dela — o pedido em dobro');
  assert.deepEqual(r.depoisDaPrimeira, ['lida'], 'DEFEITO: a primeira página voltou com a conversa fechada e nada marcou a 2000, vista na reabertura');
  assert.equal(r.lidaAte, 2000, 'a 2000 não foi marcada como lida no Waze');
  assert.equal(c.P.Presenca.lidaDevendo.size, 0, 'a dívida paga ficou de pé');
  // CONTROLE: com a conversa ABERTA quando a primeira volta, quem marca é a
  // rajada (R5-5-1) — o MESMO pedido.
  const { r: k } = await primeiraNoAr({ fecharAntes: false });
  assert.deepEqual(k.depoisDaPrimeira, ['lida'], 'CONTROLE: aberta, a rajada marca a 2000');
  assert.equal(k.lidaAte, 2000);
});

test('R14-5-01 (c) a primeira página que volta com mensagem DELA mais nova que a vista não paga a dívida — o "lida" marcaria o que ninguém viu (R7-5-01)', async () => {
  // A página foi lida no Waze depois de a 2500 chegar (o tempo real ainda não
  // a trouxe): a 2500 está nela, e ninguém a viu.
  const { c, r } = await primeiraNoAr({ resposta: { success: true, mensagens: [doHistorico(1), doHistorico(2500)], maisAntigas: false, lida: true } });
  assert.deepEqual(r.depoisDaPrimeira, [], 'a primeira página trouxe a 2500, que ninguém viu, e o "lida" saiu assim mesmo');
  assert.equal(c.P.Presenca.lidaDevendo.has(CAF), false, 'a dívida ficou de pé com a mensagem que ninguém viu');
  // E a mensagem que chega pelo tempo real DEPOIS do fechamento (ninguém a viu)
  // também tira a dívida: a página volta e nada sai.
  const { r: k } = await primeiraNoAr({ depoisDeFechar: async (d) => { d.relogio.agora = T + 3500; await chega(d, 3500); } });
  assert.deepEqual(k.depoisDaPrimeira, [], 'chegou a 3500 com a conversa fechada, e o "lida" da dívida a marcou também');
  // CONTROLE: a mesma página sem a 2500 paga (o teste de cima).
  const { r: ok } = await primeiraNoAr();
  assert.deepEqual(ok.depoisDaPrimeira, ['lida'], 'CONTROLE: sem mensagem não vista, a dívida é paga');
});

test('R14-5-01 a reabertura COMUM (o `abrir` sai na hora) fechada antes de a resposta voltar não manda "lida" a mais — e só manda o que o `abrir` não marcou', async () => {
  // A conversa carregada e fechada; a 2000 chega; a reabertura pede a primeira
  // página (no ar até `soltar`), e a conversa fecha antes de ela voltar.
  async function comum(resposta) {
    let soltar = null;
    let inicial = true;
    const c = novoCliente({ agora: T + 10, api: { chat: (x) => {
      if (x.acao !== 'abrir') return { success: true };
      if (x.com !== CAF) return { success: true, mensagens: [], maisAntigas: false, lida: true };
      if (inicial) { inicial = false; return { success: true, mensagens: [doHistorico(1)], maisAntigas: false, lida: true }; }
      return new Promise((ok) => { soltar = ok; });
    } } });
    c.P.presencaAbrirConversa(CAF);
    await tick(); await tick();
    fechar(c);
    c.relogio.agora = T + 2000; await chega(c, 2000);
    c.relogio.agora = T + 3000;
    c.P.presencaAbrirConversa(CAF);
    await tick();
    fechar(c);
    await tick(); await tick();
    const noFechamento = pedidos(c, 2);
    c.relogio.agora = T + 4000;
    soltar(resposta);
    await tick(); await tick(); await tick();
    return { c, noFechamento, depois: pedidos(c, 2) };
  }
  const coberta = await comum({ success: true, mensagens: [doHistorico(1), doHistorico(2000)], maisAntigas: false, lida: true });
  assert.deepEqual(coberta.noFechamento, [], 'o fechamento mandou um "lida" com o `abrir` da reabertura no ar');
  assert.deepEqual(coberta.depois, [], 'o `abrir` marcou a 2000 e mesmo assim saiu um "lida" a mais');
  assert.equal(lidaAte(coberta.c), 2000, 'CONTROLE: o `abrir` da reabertura marca a 2000');
  // O `abrir` que NÃO marcou (`lida: false`, o Waze falhou a marca): o "lida"
  // que faltou sai — o mesmo que a rajada mandaria com a conversa aberta.
  const semMarca = await comum({ success: true, mensagens: [doHistorico(1), doHistorico(2000)], maisAntigas: false, lida: false });
  assert.deepEqual(semMarca.depois, ['lida'], 'o `abrir` não marcou e nada mandou o "lida" da 2000, vista na reabertura');
  // A primeira página que FALHA (o Waze fora) não paga nada na resposta — nada
  // sai por relógio com o Waze fora —, e a dívida fica pro próximo gesto: o
  // fechamento de outra conversa a paga, com o histórico de antes.
  const falhou = await comum({ success: false, errorCategory: 'transient', httpCode: 500 });
  assert.deepEqual(falhou.depois, [], 'a primeira página falhou e um "lida" saiu na resposta, sem gesto nenhum');
  assert.ok(falhou.c.P.Presenca.lidaDevendo.has(CAF), 'a primeira página falhou e a dívida da 2000, vista na reabertura, sumiu');
  falhou.c.P.presencaAbrirConversa('555000111');
  await tick(); await tick();
  fechar(falhou.c);
  await tick(); await tick();
  assert.ok(pedidos(falhou.c, 2).includes('lida'), 'o fechamento seguinte não pagou a dívida da 2000');
  assert.equal(lidaAte(falhou.c), 2000);
});

test('R14-5-01 a página indo pro FUNDO com a conversa reaberta (a antiga no ar): o "lida" da mensagem vista sai na hora, com keepalive', async () => {
  // Sem fechar: o celular bloqueia, ou a pessoa troca de app — e o sistema pode
  // encerrar o app no fundo antes de a antiga voltar (R7-5-05).
  let soltarAntiga = null;
  let inicial = true;
  const c = novoCliente({ agora: T + 10, api: { chat: (x) => {
    if (x.acao !== 'abrir') return { success: true };
    if (inicial) { inicial = false; return { success: true, mensagens: [doHistorico(1)], maisAntigas: true, lida: true }; }
    if (x.antesDe) return new Promise((ok) => { soltarAntiga = ok; });
    return { success: true, mensagens: [doHistorico(1), doHistorico(2000)], maisAntigas: true, lida: true };
  } } });
  c.P.presencaMontar();
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  tocarVerAnteriores(c);
  await tick();
  fechar(c);
  c.relogio.agora = T + 2000; await chega(c, 2000);
  c.relogio.agora = T + 3000;
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  assert.equal(typeof soltarAntiga, 'function', 'CONTROLE: a antiga tinha que estar no ar');
  const antes = c.chamadas.chat.length;
  c.doc.visibilityState = 'hidden';
  for (const fn of c.doc._ouv.visibilitychange || []) fn();
  await tick(); await tick();
  assert.deepEqual(pedidos(c, antes), ['lida'], 'a página foi pro fundo e o "lida" da mensagem vista não saiu');
  assert.equal(c.chamadas.saindoNoChat[antes], true, 'o "lida" de quem vai pro fundo saiu sem keepalive');
  assert.equal(lidaAte(c), 2000);
  // CONTROLE: com a conversa carregada sem nada adiado, ir pro fundo não manda nada.
  const k = novoCliente({ agora: T + 10, api: { chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [doHistorico(1)], maisAntigas: false, lida: true } : { success: true }) } });
  k.P.presencaMontar();
  k.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  k.doc.visibilityState = 'hidden';
  for (const fn of k.doc._ouv.visibilitychange || []) fn();
  await tick();
  assert.deepEqual(pedidos(k, 1), [], 'CONTROLE: sem nada adiado, ir pro fundo mandou um "lida"');
});

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

// ── R14-5-03: a conversa SEM histórico nesta página ─────────────────────────
//
// A página anterior fechou devendo o "lida" da 1 (vista e não confirmada); a
// abertura adota a dívida guardada e a paga (o "lida" fica no ar até `soltar`).
// Uma carona SAI com ele no ar e é lida no Waze antes de ele ser processado: ela
// conta a 1 (vista) e a resposta da CAF (a 3600) — 2. Os passos vêm na `ordem`
// pedida: L, a lista chega; V, o "lida" VOLTA; R, a resposta chega pelo tempo
// real. A conversa não foi aberta nesta página.
async function dividaGuardada(ordem) {
  let soltar = null;
  const c = novoCliente({ agora: T + 2000, api: {
    chat: (x) => (x.acao === 'lida' ? new Promise((ok) => { soltar = ok; }) : { success: true }),
    presencaApp: () => ({ success: true, ...lista(1, 1) }),
  } });
  c.armazenado.set('waze_places_chat', JSON.stringify({ inst: INST, conhecidos: [CAF], devendo: { [CAF]: { ate: T + 1, n: 1 } } }));
  await c.P.presencaSincronizar();
  await tick(); await tick();
  const r = { lidaNoAr: typeof soltar === 'function', semHistorico: !c.P.Presenca.historico.has(CAF) };
  const passos = {
    L: async () => { c.P.presencaAoCarona(lista(3600, 2), T + 3500, 30); await tick(); },
    V: async () => { soltar({ success: true }); await tick(); await tick(); },
    R: async () => { await chega(c, 3600); await tick(); },
  };
  let agora = 4000;
  for (const p of ordem) {
    c.relogio.agora = T + agora;
    agora += 500;
    await passos[p]();
    r[p] = conta(c);
  }
  r.selo = c.$('presencaCount').textContent;
  c.relogio.agora = T + 60_000; await tick();
  r.aos60s = conta(c);
  return { c, r };
}

test('R14-5-03 a dívida guardada que a abertura paga: a resposta que a lista contou junto com a vista conta UMA — também na conversa sem histórico nesta página', async () => {
  for (const ordem of ['VLR', 'LVR', 'RVL']) {
    const { r } = await dividaGuardada(ordem);
    assert.equal(r.lidaNoAr, true, `${ordem} CONTROLE: a abertura tinha que pagar a dívida guardada (o "lida" no ar)`);
    assert.equal(r.semHistorico, true, `${ordem} CONTROLE: a conversa não foi aberta nesta página`);
    assert.equal(r.R, 1, `${ordem} DEFEITO: com a resposta chegada, a pílula seguiu dizendo "2 mensagens novas" (uma já vista)`);
    assert.equal(r.selo, '1', `${ordem}: a pílula mostrou ${r.selo}`);
    assert.equal(r.aos60s, 1, `${ordem}: a conta mudou sozinha depois`);
  }
  // CONTROLE: a ordem LVR com a lista ANTES da resposta segue contando 2 até a
  // resposta chegar — o histórico ainda não explica a lista (como na conversa
  // com histórico, R13-5-01).
  const { r: k } = await dividaGuardada('LVR');
  assert.deepEqual([k.L, k.V], [2, 2], 'CONTROLE: antes da resposta, a lista conta a vista e a resposta');
});

test('R14-5-03 o histórico que a resposta ganha não marca nada — e o "lida" no ar que FALHA com ela chegada não volta a dever (R7-5-01)', async () => {
  let soltar = null;
  const c = novoCliente({ agora: T + 2000, api: {
    chat: (x) => (x.acao === 'lida' ? new Promise((ok) => { soltar = ok; }) : { success: true }),
    presencaApp: () => ({ success: true, ...lista(1, 1) }),
  } });
  c.armazenado.set('waze_places_chat', JSON.stringify({ inst: INST, conhecidos: [CAF], devendo: { [CAF]: { ate: T + 1, n: 1 } } }));
  await c.P.presencaSincronizar();
  await tick(); await tick();
  assert.equal(typeof soltar, 'function', 'CONTROLE: o "lida" da dívida guardada tinha que estar no ar');
  c.relogio.agora = T + 4000;
  await chega(c, 3600);                                       // ninguém a viu (a conversa está fechada)
  await tick();
  const h = c.P.Presenca.historico.get(CAF);
  assert.ok(h && h.msgs.some((m) => m.ts === T + 3600), 'CONTROLE: a resposta entrou num histórico da conversa');
  assert.equal(h.carregada, false, 'o histórico da resposta passou por carregado — e o "lida" sairia sem a conversa aberta');
  soltar({ success: false, errorCategory: 'transient', _motivo: 'TypeError' });
  await tick(); await tick();
  assert.equal(c.P.Presenca.lidaDevendo.has(CAF), false, 'o "lida" falhou e a dívida voltou com a 3600, que ninguém viu — pagá-la a marcaria');
  assert.equal((c.guardado().devendo || {})[CAF], undefined, 'a dívida com a mensagem que ninguém viu foi guardada no aparelho');
  assert.equal(conta(c), 1, 'a resposta que ninguém viu deixou de contar');
});

// ── R14-8-15: abrir a conversa não abre o teclado do celular ───────────────

test('R14-8-15 abrir a conversa no DEDO não põe o foco no campo (o teclado cobriria a conversa); com mouse, põe', () => {
  const abrir = (grosso) => {
    const c = novoCliente({ agora: T });
    const consultas = [];
    c.win.matchMedia = (q) => { consultas.push(q); return { matches: grosso && q === '(pointer: coarse)' }; };
    c.P.presencaAbrirConversa(CAF);
    return { focado: !!c.$('conversaInput').focado, consultas };
  };
  const dedo = abrir(true);
  assert.ok(dedo.consultas.includes('(pointer: coarse)'), 'CONTROLE: a abertura tinha que perguntar pelo ponteiro (a régua da tela de entrada)');
  assert.equal(dedo.focado, false, 'DEFEITO: no dedo, abrir a conversa pôs o foco no campo — o teclado do celular sobe por cima dela');
  const mouse = abrir(false);
  assert.equal(mouse.focado, true, 'com mouse, abrir a conversa deixou de pôr o foco no campo (onde já se digita)');
  // Sem `matchMedia`, o que o app sempre fez: o foco no campo.
  const c = novoCliente({ agora: T });
  c.P.presencaAbrirConversa(CAF);
  assert.equal(!!c.$('conversaInput').focado, true, 'sem matchMedia, o campo perdeu o foco');
});
