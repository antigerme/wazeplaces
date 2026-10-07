// A presença e a conversa depois da auditoria da rodada 10 (R10-5): a mensagem
// que chega com a conversa aberta e a página no FUNDO fora do teto das vistas
// (regressão do lote 13), o token que a prova de rede não pedia com o `onLine`
// preso em falso, o fim normal do tempo real virando episódio de "parado", a
// lista que conta a vista junto com a resposta, a dívida que a outra aba está
// pagando paga de novo, e o `n` inflado guardado por uma versão anterior. Os
// rótulos R10-5-n são os do relatório dessa rodada. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
//
// O instrumento é o js/presenca.js INTEIRO no navegador de mentira do
// `_presenca-cliente.mjs`, como nas rodadas anteriores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const GOOGLE = 'https://instantmessaging-pa.googleapis.com/';
const EU = '12444348';
const CAF = '183164343';
const SEM_REDE = { success: false, errorCategory: 'transient', _motivo: 'TypeError' };

const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c, emLote = false) => ({ ctl: new AbortController(), emLote, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
// A mensagem `n` da CAF, com a hora `T + n` (a do Waze), chegando pelo tempo
// real — ao vivo, ou no LOTE que abre toda conexão (a reconexão reentrega).
const chega = async (c, n, { lote = false } = {}) => c.P.presencaQuadro(fluxoDe(c, lote), { inboxMessage: { messageId: uuid(900 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts: T + n })) } });
const lidas = (c, com = CAF) => c.chamadas.chat.filter((x) => x.acao === 'lida' && x.com === com);
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const pilula = (c) => ({ escondida: c.$('presencaPill').classList.contains('hidden'),
  balao: !c.$('presencaIconMsg').classList.contains('hidden'), selo: c.$('presencaCount').textContent });
// A página vai pro fundo e volta: o `visibilitychange` de verdade (o ouvinte do
// `presencaMontar`), ou o `pageshow` do bfcache — que nem sempre vem com ele.
const esconder = (c) => { c.doc.visibilityState = 'hidden'; for (const fn of c.doc._ouv.visibilitychange || []) fn(); };
const voltar = (c, { pageshow = false } = {}) => {
  c.doc.visibilityState = 'visible';
  if (pageshow) for (const fn of c.win._ouv.pageshow || []) fn({ persisted: true });
  else for (const fn of c.doc._ouv.visibilitychange || []) fn();
};

// O Waze de mentira (o das rodadas 8 e 9), que sobrevive à PÁGINA: as mensagens
// da CAF (a `n` tem a hora `T + n`) e quais seguem NÃO LIDAS. O "lida" (e o
// `abrir`) marca a conversa INTEIRA. `fora` derruba o "lida"; `segurar` prende os
// "lida" no ar até o teste soltar. `marcarNaChegada`: o Waze PROCESSA o "lida"
// quando o pedido chega, e o lento é a resposta. `pagina` aceita a marca da aba
// e as travas do navegador (`locks`), pras duas abas do R10-5-05.
function wazeDeMentira({ marcarNaChegada = false } = {}) {
  const w = { fora: false, segurar: false, presos: [], dela: [] };
  const marcar = (com) => { if (com === CAF) for (const m of w.dela) m.lida = true; };
  const conversaDaCaf = () => {
    const u = w.dela.reduce((a, m) => (!a || m.ts > a.ts ? m : a), null);
    return { id: CAF, nome: 'cafanha', naoLidas: w.dela.filter((m) => !m.lida).length, atividade: u ? u.ts : 0,
      ultima: u ? { deMim: false, ts: u.ts, recibo: false, texto: 'x', card: null } : null };
  };
  w.guardar = (n) => w.dela.push({ n, ts: T + n, lida: false });
  w.naoLida = (n) => w.dela.some((m) => m.n === n && !m.lida);
  w.lista = () => ({ online: [], conversas: [conversaDaCaf()] });
  w.pagina = ({ agora = T, aba = undefined, locks = null } = {}) => {
    const c = novoCliente({ agora, aba, api: {
      chat: (x) => {
        if (x.acao === 'abrir') { marcar(x.com); return { success: true, mensagens: [], maisAntigas: false, lida: true }; }
        if (x.acao !== 'lida') return { success: true };
        if (marcarNaChegada && !w.fora) marcar(x.com);
        const responder = () => { if (w.fora) return SEM_REDE; marcar(x.com); return { success: true }; };
        if (w.segurar) return new Promise((ok) => w.presos.push((r) => { if (r && r.success && !marcarNaChegada) marcar(x.com); ok(r || responder()); }));
        return responder();
      },
      presencaApp: () => ({ success: true, ...w.lista(), agora: c.relogio.agora }),
    } });
    if (locks) c.escopo.navigator.locks = locks;
    c.P.presencaMontar();
    return c;
  };
  return w;
}

// ── R10-5-01: o teto das vistas na VOLTA do fundo ────────────────────────────

// A conversa com a CAF ABERTA. A página vai pro fundo e a 1 chega pelo tempo
// real (fora da vista: vira "viva"); `viaLista`: uma lista chega com a página
// ainda escondida e a conta (absorve a viva). A pessoa VOLTA: a 1 está na tela,
// e o "lida" da volta FALHA (o Waze fora) — a conversa passa a dever. Ela fecha
// (o fechamento paga e falha de novo), e a carona de um ✕ traz a lista, que
// ainda conta a 1. Depois o Waze volta, e o próximo gesto paga as dívidas.
async function tetoNaVolta({ escondida = true, viaLista = false, pageshow = false } = {}) {
  const w = wazeDeMentira();
  const c = w.pagina();
  c.P.Presenca.conversas = [w.lista().conversas[0]];
  c.P.presencaAbrirConversa(CAF);
  await tick(); await c.rodarTimers(); await tick();       // o `abrir` (nada a marcar)
  if (escondida) esconder(c);
  w.guardar(1);
  c.relogio.agora += 1000;
  await chega(c, 1);
  const vivaNoFundo = (c.P.Presenca.vivas.get(CAF) || { n: 0 }).n;
  if (viaLista) {
    c.relogio.agora += 500;
    c.P.presencaAoCarona(w.lista(), c.relogio.agora - 100, 30);
    await tick();
  }
  if (escondida) { c.relogio.agora += 20_000; voltar(c, { pageshow }); }
  const naVolta = { conta: c.P.presencaNaoLidasDe(CAF), pilula: pilula(c) };
  w.fora = true;                                            // o Waze cai antes do "lida" da volta
  c.relogio.agora += 1500;
  await c.rodarTimers(); await tick(); await tick();        // a rajada: o "lida" falha → deve
  const guardada = (c.guardado().devendo || {})[CAF] || null;
  fechar(c);                                                // o fechamento paga… e falha
  await tick(); await tick();
  c.relogio.agora += 5000;
  c.P.presencaAoCarona(w.lista(), c.relogio.agora - 100, 30);   // o Waze ainda conta a 1
  await tick();
  const comALista = { conta: c.P.presencaNaoLidasDe(CAF), pilula: pilula(c), devendo: c.P.Presenca.lidaDevendo.has(CAF) };
  w.fora = false;                                           // o Waze volta
  c.relogio.agora += 5000;
  const antes = lidas(c).length;
  c.P.presencaPagarDevidas();                               // o próximo gesto que paga (o "Aplicar", outro fechamento)
  await tick(); await tick();
  return { vivaNoFundo, naVolta, guardada, comALista, pagou: lidas(c).length - antes, lidaNoWaze: !w.naoLida(1) };
}

test('R10-5-01 a mensagem que chega com a conversa aberta e a página no FUNDO, vista na volta, entra no teto: o "lida" que falha não a devolve como nova', async () => {
  const r = await tetoNaVolta();
  assert.equal(r.vivaNoFundo, 1, 'CONTROLE: com a página no fundo, a 1 tinha que chegar fora da vista');
  assert.equal(r.naVolta.conta, 0, 'DEFEITO: com a conversa de volta na tela, a 1 seguiu contando como não lida (olhando é lida)');
  assert.equal(r.naVolta.pilula.escondida, true, 'a pílula ficou com a mensagem que está na tela');
  assert.deepEqual(r.guardada, { ate: T + 1, n: 1 }, 'DEFEITO: a dívida nasceu sem a vista da volta (o teto não a contou)');
  assert.equal(r.comALista.conta, 0, 'DEFEITO: a lista devolveu a mensagem VISTA como "1 mensagem nova"');
  assert.equal(r.comALista.pilula.escondida, true);
  assert.equal(r.comALista.devendo, true, 'DEFEITO: a lista tirou a dívida sem pagar — o "lida" não sai mais');
  assert.equal(r.pagou, 1, 'com o Waze de volta, a dívida não foi paga');
  assert.equal(r.lidaNoWaze, true, 'DEFEITO: a mensagem vista seguiu não lida no Waze (quem mandou nunca vê "Lida")');
  // CONTROLE: a 1 chegando com a conversa NA TELA (o caso que o teto já contava).
  const k = await tetoNaVolta({ escondida: false });
  assert.equal(k.vivaNoFundo, 0);
  assert.deepEqual(k.guardada, { ate: T + 1, n: 1 });
  assert.equal(k.comALista.conta, 0);
  assert.equal(k.lidaNoWaze, true);
});

test('R10-5-01 a volta pelo bfcache (o `pageshow`, sem `visibilitychange`) conta a vista igual', async () => {
  const r = await tetoNaVolta({ pageshow: true });
  assert.equal(r.vivaNoFundo, 1, 'CONTROLE: a 1 tinha que chegar fora da vista');
  assert.deepEqual(r.guardada, { ate: T + 1, n: 1 }, 'a volta pelo bfcache deixou a vista fora do teto');
  assert.equal(r.comALista.conta, 0);
  assert.equal(r.lidaNoWaze, true);
});

test('R10-5-01 a LISTA que chega com a página no fundo e conta a mensagem (ela absorve a viva): na volta, o teto cobre o que ela conta', async () => {
  const r = await tetoNaVolta({ viaLista: true });
  assert.equal(r.vivaNoFundo, 1, 'CONTROLE: a 1 tinha que chegar fora da vista');
  assert.equal(r.naVolta.conta, 0, 'com a conversa de volta na tela, a contagem da lista do fundo ficou');
  assert.deepEqual(r.guardada, { ate: T + 1, n: 1 }, 'DEFEITO: a vista que a lista do fundo contava ficou fora do teto');
  assert.equal(r.comALista.conta, 0, 'DEFEITO: a lista seguinte devolveu a mensagem VISTA como nova');
  assert.equal(r.lidaNoWaze, true);
});

test('R10-5-01 sem falha nenhuma: o "lida" da volta NO AR e a lista que sai depois dele não contam a vista', async () => {
  const caso = async ({ escondida }) => {
    const w = wazeDeMentira();
    const c = w.pagina();
    c.P.Presenca.conversas = [w.lista().conversas[0]];
    c.P.presencaAbrirConversa(CAF);
    await tick(); await c.rodarTimers(); await tick();
    if (escondida) esconder(c);
    w.guardar(1);
    c.relogio.agora += 1000;
    await chega(c, 1);
    if (escondida) { c.relogio.agora += 20_000; voltar(c); }
    w.segurar = true;                                       // o Waze lento: o "lida" da volta fica no ar
    c.relogio.agora += 1500;
    await c.rodarTimers(); await tick();
    assert.equal(c.P.presencaComLidaNoAr().length, 1, 'CONTROLE: o "lida" tinha que estar no ar');
    fechar(c);
    await tick();
    c.relogio.agora += 1000;
    c.P.presencaAoCarona(w.lista(), c.relogio.agora - 100, 30);   // saiu DEPOIS do "lida", lida no Waze antes dele
    await tick();
    const comALista = c.P.presencaNaoLidasDe(CAF);
    w.presos.shift()({ success: true });
    await tick(); await tick();
    return { comALista, depoisDoLida: c.P.presencaNaoLidasDe(CAF), pilula: pilula(c) };
  };
  const r = await caso({ escondida: true });
  assert.equal(r.comALista, 0, 'DEFEITO: a lista que saiu depois do "lida" da volta contou a vista como nova');
  assert.equal(r.depoisDoLida, 0, 'DEFEITO: o "1" ficou depois de o "lida" dar certo');
  assert.equal(r.pilula.escondida, true);
  const k = await caso({ escondida: false });                // CONTROLE: a 1 chegou com a página na tela
  assert.equal(k.comALista, 0);
  assert.equal(k.depoisDoLida, 0);
});

// ── R10-5-02: o token com o `onLine` preso em falso ──────────────────────────

// Sem token que abra (o Google recusou o anterior, ou ele venceu) e o `onLine`
// preso em `onLine` (o iPhone que não manda o `online`). Três respostas da API
// (três ✕) provam a rede, espaçadas de 30 s.
async function semTokenComProvas({ onLine, tokenPedidoHaMs = 10 * 60e3, provas = 3, espaco = 30_000 }) {
  let pedidos = 0;
  const c = novoCliente({ agora: T, api: {
    presencaApp: (x) => { if (x.token) pedidos += 1; return { success: true, online: [], conversas: [], agora: c.relogio.agora,
      ...(x.token ? { chat: { token: 'tk2', base: GOOGLE, chave: 'k', expiraEm: c.relogio.agora + 20 * 3600e3 } } : {}) }; },
    fetch: () => new Promise(() => {}),                     // o Google: a conexão abre e fica
  } });
  c.P.presencaMontar();
  Object.assign(c.P.Presenca, { chat: null, pais: 30, atualizadaEm: T, tentadaEm: T, tokenPedidoEm: T - tokenPedidoHaMs });
  c.escopo.navigator.onLine = onLine;
  for (let i = 0; i < provas; i++) {
    c.relogio.agora += espaco;
    c.P.presencaAoProvarRede();
    await tick(); await tick();
  }
  const linhas = c.chamadas.dfato.filter(([k, o]) => k === 'presenca.fluxo' && (o.ev === 'parou' || o.ev === 'religou')).map(([, o]) => o.ev);
  return { pedidos, aberto: !!c.P.Presenca.fluxo, parado: c.P.Presenca.fluxoParado, google: c.chamadas.fetch.length, linhas };
}

test('R10-5-02 sem token e com o `onLine` preso em falso, a resposta da API pede o token — e o tempo real abre quando ele chega', async () => {
  const r = await semTokenComProvas({ onLine: false });
  assert.equal(r.pedidos, 1, 'DEFEITO: com o `onLine` preso em falso, a prova de rede não pediu o token — o tempo real nunca abre só com ações');
  assert.equal(r.aberto, true, 'DEFEITO: o token chegou numa resposta (a rede provada) e o tempo real não abriu');
  assert.equal(r.parado, false);
  assert.deepEqual(r.linhas, [], 'o token chegando com a rede provada virou um episódio de "parado" no diário');
  // CONTROLE: com o `onLine` verdadeiro, o mesmo (era o caso que já funcionava).
  const k = await semTokenComProvas({ onLine: true });
  assert.deepEqual({ pedidos: k.pedidos, aberto: k.aberto, parado: k.parado }, { pedidos: 1, aberto: true, parado: false });
});

test('R10-5-02 o pedido do token pela prova de rede segue com o teto de 5 min — com o `onLine` preso em falso também', async () => {
  // O último pedido de token foi há 1 min, e o provedor não o devolve (o Waze
  // falhando nele): nenhuma das provas dos 3 min seguintes pede de novo.
  let pedidos = 0;
  const c = novoCliente({ agora: T, api: {
    presencaApp: (x) => { if (x.token) pedidos += 1; return { success: true, online: [], conversas: [], agora: c.relogio.agora, chat: null }; },
    fetch: () => new Promise(() => {}),
  } });
  c.P.presencaMontar();
  Object.assign(c.P.Presenca, { chat: null, pais: 30, atualizadaEm: T, tentadaEm: T, tokenPedidoEm: T - 60e3 });
  c.escopo.navigator.onLine = false;
  for (let i = 0; i < 6; i++) { c.relogio.agora += 30_000; c.P.presencaAoProvarRede(); await tick(); await tick(); }
  assert.equal(pedidos, 0, 'a prova de rede pediu o token dentro do teto de 5 min');
  // Passado o teto (o último pedido foi há mais de 5 min), UM pedido — e só um, com as provas seguintes.
  c.relogio.agora += 2 * 60e3;
  for (let i = 0; i < 4; i++) { c.P.presencaAoProvarRede(); await tick(); await tick(); c.relogio.agora += 20_000; }
  assert.equal(pedidos, 1, `passado o teto, a prova de rede pediu o token ${pedidos} vezes`);
});

// ── R10-5-03: o fim NORMAL da conexão com o `onLine` preso em falso ──────────

// O Google de mentira: cada conexão entrega o lote que abre toda conexão e
// "vive" 6 min (o relógio anda antes de o corpo terminar), e o Google a fecha —
// o fim NORMAL. Uma hora de uso: 10 conexões.
function corpoComLote() {
  const txt = '[{"startOfBatch":true}\n,{"endOfBatch":true}\n';
  return new Response(new ReadableStream({ start(ctl) { ctl.enqueue(new TextEncoder().encode(txt)); ctl.close(); } }), { status: 200 });
}
async function umaHoraDeConexoes({ onLine, expiraEm = T + 20 * 3600e3 }) {
  let c;
  let conexoes = 0, pedidosDeToken = 0;
  const esperas = [];
  c = novoCliente({ agora: T, api: {
    presencaApp: (x) => { if (x.token) pedidosDeToken += 1; return { success: true, online: [], conversas: [], agora: c.relogio.agora,
      ...(x.token ? { chat: { token: 'tk2', base: GOOGLE, chave: 'k', expiraEm: c.relogio.agora + 20 * 3600e3 } } : {}) }; },
    fetch: async () => { conexoes += 1; c.relogio.agora += 6 * 60e3; return corpoComLote(); },
  } });
  c.P.presencaMontar();
  Object.assign(c.P.Presenca, { chat: { token: 'tk', base: GOOGLE, chave: 'k', expiraEm }, pais: 30, atualizadaEm: T, tentadaEm: T, tokenPedidoEm: T });
  c.escopo.navigator.onLine = onLine;
  let voltasParado = 0;
  c.P.presencaFluxoGarantir();
  for (let volta = 0; volta < 40 && conexoes < 10; volta++) {
    for (let i = 0; i < 5; i++) await tick();
    if (c.P.Presenca.fluxoParado) voltasParado += 1;
    for (const x of c.timers) esperas.push(x.ms);
    await c.rodarTimers();
  }
  for (let i = 0; i < 5; i++) await tick();
  const linhas = c.chamadas.dfato.filter(([k]) => k === 'presenca.fluxo').map(([, o]) => o.ev);
  return { conexoes, voltasParado, linhas, esperas, pedidosDeToken };
}

test('R10-5-03 com o `onLine` preso em falso e a rede de pé, o fim NORMAL da conexão religa sem virar episódio de "parado"', async () => {
  const r = await umaHoraDeConexoes({ onLine: false });
  assert.equal(r.conexoes, 10, 'CONTROLE: uma hora de uso são 10 conexões de 6 min');
  // A primeira abertura não tem prova nenhuma (o `onLine` falso vale): para, e
  // o recuo a abre — um episódio só. Os fins normais seguintes provam a rede.
  assert.deepEqual(r.linhas, ['parou', 'conectou', 'religou'],
    `DEFEITO: cada fim normal virou um episódio de "parado" no diário (${r.linhas.length} linhas numa hora)`);
  assert.ok(r.voltasParado <= 1, `DEFEITO: a marca de "parado" piscou em ${r.voltasParado} fins normais`);
  // A volta do fim normal é a de 1 s (`PRESENCA_FLUXO_RELIGAR_MS`), não o recuo do parado (2 s ± 25%).
  const depoisDoPrimeiro = r.esperas.slice(1);
  assert.ok(depoisDoPrimeiro.length >= 9 && depoisDoPrimeiro.every((ms) => ms === 1000),
    `os fins normais não religaram em 1 s: ${JSON.stringify(r.esperas)}`);
  // CONTROLE: com o `onLine` verdadeiro, uma linha só (o "conectou") — era o que já funcionava.
  const k = await umaHoraDeConexoes({ onLine: true });
  assert.equal(k.conexoes, 10);
  assert.deepEqual(k.linhas, ['conectou']);
  assert.equal(k.voltasParado, 0);
});

test('R10-5-03 o fim normal com o `onLine` preso em falso também renova o token que está na última hora (com o teto de 5 min)', async () => {
  // O token vence em 50 min: a partir de agora ele está na última hora, e o
  // garantir de cada fim normal pede a renovação (com o teto de 5 min).
  const r = await umaHoraDeConexoes({ onLine: false, expiraEm: T + 50 * 60e3 });
  assert.equal(r.pedidosDeToken, 1, `DEFEITO: com o \`onLine\` preso em falso, o fim normal não renovou o token da última hora (${r.pedidosDeToken} pedidos)`);
  assert.equal(r.conexoes, 10, 'o tempo real não seguiu abrindo com o token renovado');
  const k = await umaHoraDeConexoes({ onLine: true, expiraEm: T + 50 * 60e3 });   // CONTROLE
  assert.equal(k.pedidosDeToken, 1);
});

test('R10-5-03 a queda que NÃO é fim normal, com o `onLine` falso, segue parando — o portão fica pra quem não tem prova', async () => {
  const c = novoCliente({ agora: T, api: { fetch: async () => { throw new TypeError('Failed to fetch'); } } });
  c.P.presencaMontar();
  Object.assign(c.P.Presenca, { chat: { token: 'tk', base: GOOGLE, chave: 'k', expiraEm: T + 20 * 3600e3 }, pais: 30, atualizadaEm: T, tentadaEm: T, tokenPedidoEm: T });
  c.escopo.navigator.onLine = false;
  // Sem prova nenhuma (a volta do fundo, o "Aplicar", o `online` que mente): o
  // garantir não tenta o Google e deixa o tempo real PARADO, no recuo dele.
  c.P.presencaFluxoGarantir({ via: 'volta' });
  assert.equal(c.chamadas.fetch.length, 0, 'sem prova de rede, com o `onLine` falso, o garantir tentou o Google');
  assert.equal(c.P.Presenca.fluxoParado, true, 'sem prova de rede, com o `onLine` falso, o tempo real não ficou parado');
  c.P.Presenca.fluxoParado = false;
  c.P.presencaFluxoReagendar(false);                        // a conexão caiu com erro, sem rede
  assert.equal(c.P.Presenca.fluxoParado, true, 'a queda sem rede deixou de parar o tempo real');
  c.P.presencaFluxoFechar();
  c.P.Presenca.fluxoParado = false;
  c.P.presencaFluxoReagendar(true);                         // o fim NORMAL: a religada de 1 s…
  assert.equal(c.P.Presenca.fluxoParado, false);
  await c.rodarTimers(); await tick(); await tick();
  assert.equal(c.chamadas.fetch.length, 1, 'DEFEITO: o fim normal não religou com o `onLine` preso em falso');
});

// ── R10-5-04: a lista que conta a vista junto com a resposta ─────────────────

// A 1 chega NA TELA; a pessoa fecha: o "lida" sai e fica NO AR (o Waze ainda não
// o processou). A 2 chega pelo tempo real com a conversa FECHADA. Uma lista que
// saiu DEPOIS do "lida" e foi lida no Waze ANTES de ele ser processado conta a 1
// e a 2. `quando`: 'noAr' (ela chega com o "lida" voando), 'depois' (ela sai com
// ele no ar e só CHEGA depois de ele voltar). `lote`: a 2 vem no LOTE da
// reconexão, e só depois de a lista chegar (com ela, o histórico não explicava a
// lista: a 2 não estava aqui).
async function listaContaAVista({ quando = 'noAr', lote = false } = {}) {
  const w = wazeDeMentira({ marcarNaChegada: false });
  const c = w.pagina();
  c.P.Presenca.conversas = [w.lista().conversas[0]];
  c.P.presencaAbrirConversa(CAF);
  await tick(); await c.rodarTimers(); await tick();
  w.guardar(1);
  await chega(c, 1);                                        // a 1 NA TELA
  w.segurar = true;
  c.relogio.agora += 100;
  fechar(c);                                                // o "lida" sai e fica no ar
  await tick();
  assert.equal(c.P.presencaComLidaNoAr().length, 1, 'CONTROLE: o "lida" tinha que estar no ar');
  c.relogio.agora += 2000;
  w.guardar(2);
  if (!lote) await chega(c, 2);                             // a 2 com a conversa FECHADA
  c.relogio.agora += 1000;
  const lista = w.lista();                                  // lida no Waze com o "lida" ainda não processado
  const saiuEm = c.relogio.agora - 100;
  let comALista = null;
  if (quando === 'noAr') {
    c.P.presencaAoCarona(lista, saiuEm, 30);
    await tick();
    comALista = c.P.presencaNaoLidasDe(CAF);
    if (lote) { c.relogio.agora += 300; await chega(c, 2, { lote: true }); }
  }
  c.relogio.agora += 500;
  w.presos.shift()({ success: true });                      // o "lida" volta: deu certo
  await tick(); await tick();
  if (quando === 'depois') { c.relogio.agora += 500; c.P.presencaAoCarona(lista, saiuEm, 30); await tick(); }
  return { comALista, depoisDoLida: c.P.presencaNaoLidasDe(CAF), pilula: pilula(c), naoLida2NoWaze: w.naoLida(2) };
}

test('R10-5-04 a lista lida no Waze antes do "lida" ser processado não conta a vista junto com a resposta — com ele no ar e depois de ele dar certo', async () => {
  const r = await listaContaAVista();
  assert.equal(r.comALista, 1, 'DEFEITO: com o "lida" no ar, a lista contou a vista junto com a resposta (2 com uma só não vista)');
  assert.equal(r.depoisDoLida, 1, 'DEFEITO: o "lida" que deu certo deixou a vista contada como nova');
  assert.deepEqual(r.pilula, { escondida: false, balao: true, selo: '1' });
});

test('R10-5-04 a lista que SAI com o "lida" no ar e só CHEGA depois de ele voltar também não conta a vista', async () => {
  const r = await listaContaAVista({ quando: 'depois' });
  assert.equal(r.depoisDoLida, 1, 'DEFEITO: a lista que saiu com o "lida" no ar contou a vista como nova ao chegar depois dele');
  assert.deepEqual(r.pilula, { escondida: false, balao: true, selo: '1' });
  // CONTROLE: a lista que saiu DEPOIS de o "lida" voltar foi lida com ele já
  // processado — o Waze marcou a conversa INTEIRA, a 2 junto (a limitação do
  // `MarkConversationRead`), e ela diz zero: a conta não ressuscita a 2.
  const w = wazeDeMentira({ marcarNaChegada: false });
  const c = w.pagina();
  c.P.Presenca.conversas = [w.lista().conversas[0]];
  c.P.presencaAbrirConversa(CAF);
  await tick(); await c.rodarTimers(); await tick();
  w.guardar(1);
  await chega(c, 1);
  w.segurar = true;
  fechar(c);
  await tick();
  c.relogio.agora += 2000;
  w.guardar(2);
  await chega(c, 2);
  w.presos.shift()({ success: true });
  await tick(); await tick();
  c.relogio.agora += 1000;
  c.P.presencaAoCarona(w.lista(), c.relogio.agora - 100, 30);
  await tick();
  assert.equal(w.naoLida(2), false, 'CONTROLE: o Waze de mentira tinha que marcar a 2 com o "lida" (a conversa inteira)');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'a conta ressuscitou a resposta que o Waze já não conta');
});

test('R10-5-04 a resposta que só o LOTE da reconexão traz, depois da lista: o sucesso do "lida" refaz a conta', async () => {
  const r = await listaContaAVista({ lote: true });
  assert.equal(r.comALista, 2, 'CONTROLE: sem a 2 no histórico, a lista no ar não tem como ser explicada — a conta dela fica');
  assert.equal(r.depoisDoLida, 1, 'DEFEITO: com a 2 já no histórico, o "lida" que deu certo deixou a vista contada como nova');
});

test('R10-5-04 a recontagem nunca passa da conta da lista: a resposta que o "lida" marcou ao ser processado não volta', async () => {
  // A 1 vista; a pessoa fecha e o "lida" fica no ar. A 2 chega pelo tempo real
  // (fechada) e o Waze processa o "lida" DEPOIS dela: marca a 1 e a 2 (a
  // conversa inteira, a limitação do Waze). Aí chega a 3. A lista que SAIU com o
  // "lida" no ar foi lida no Waze depois de ele ser processado: conta só a 3. O
  // histórico tem a 2 e a 3 depois do que o "lida" cobre — e a conta é 1, a da
  // lista: a 2 não ressuscita (o Waze já a dá como lida, e a lista seguinte diria
  // o mesmo).
  const w = wazeDeMentira({ marcarNaChegada: false });
  const c = w.pagina();
  c.P.Presenca.conversas = [w.lista().conversas[0]];
  c.P.presencaAbrirConversa(CAF);
  await tick(); await c.rodarTimers(); await tick();
  w.guardar(1);
  await chega(c, 1);
  w.segurar = true;
  c.relogio.agora += 100;
  fechar(c);
  await tick();
  const saiuEm = c.relogio.agora + 50;                     // a lista sai com o "lida" no ar
  c.relogio.agora += 2000;
  w.guardar(2);
  await chega(c, 2);
  c.relogio.agora += 500;
  w.presos.shift()({ success: true });                      // processado agora: marca a 1 e a 2
  await tick(); await tick();
  assert.equal(w.naoLida(2), false, 'CONTROLE: o "lida" processado depois da 2 tinha que marcá-la também');
  c.relogio.agora += 500;
  w.guardar(3);
  await chega(c, 3);
  c.relogio.agora += 500;
  c.P.presencaAoCarona(w.lista(), saiuEm, 30);              // conta só a 3
  await tick();
  assert.equal(w.lista().conversas[0].naoLidas, 1, 'CONTROLE: a lista tinha que contar só a 3');
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'a recontagem passou da conta da lista e ressuscitou a resposta que o Waze já dá como lida');
});

test('R10-5-04 com a última da lista MINHA, ou só da lista (o tempo real fora), a conta da lista fica — o histórico não sabe o que ela sabe', async () => {
  // A 2 não chega pelo tempo real (só a lista a conhece): a conta fica 1 com o
  // "lida" no ar e depois dele (o R9-5-01 segue de pé).
  const w = wazeDeMentira({ marcarNaChegada: true });
  const c = w.pagina();
  c.P.Presenca.conversas = [w.lista().conversas[0]];
  c.P.presencaAbrirConversa(CAF);
  await tick(); await c.rodarTimers(); await tick();
  w.guardar(1);
  await chega(c, 1);
  w.segurar = true;
  fechar(c);
  await tick();
  c.relogio.agora += 2000;
  w.guardar(2);
  c.relogio.agora += 3000;
  c.P.presencaAoCarona(w.lista(), c.relogio.agora - 100, 30);
  await tick();
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'a resposta que só a lista conhece sumiu com o "lida" no ar');
  w.presos.shift()({ success: true });
  await tick(); await tick();
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'a resposta que só a lista conhece sumiu com o "lida" que deu certo');
  // A última da lista é MINHA (respondi noutro aparelho): a lista que conta 2 fica com 2.
  const w2 = wazeDeMentira({ marcarNaChegada: false });
  const d = w2.pagina();
  d.P.Presenca.conversas = [w2.lista().conversas[0]];
  d.P.presencaAbrirConversa(CAF);
  await tick(); await d.rodarTimers(); await tick();
  w2.guardar(1);
  await chega(d, 1);
  w2.segurar = true;
  fechar(d);
  await tick();
  d.relogio.agora += 2000;
  w2.guardar(2);
  await chega(d, 2);
  d.relogio.agora += 1000;
  const minha = { deMim: true, ts: T + 3, recibo: false, texto: 'respondi', card: null };
  d.P.presencaAoCarona({ online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas: 2, atividade: T + 3, ultima: minha }] }, d.relogio.agora - 100, 30);
  await tick();
  assert.equal(d.P.presencaNaoLidasDe(CAF), 2, 'com a última MINHA, o histórico refez a conta da lista');
});

// ── R10-5-05: a dívida que a OUTRA aba está pagando ──────────────────────────

// Um aparelho com DUAS páginas: o armazenamento é um só (a B lê e grava no da
// A), e as travas do navegador também — cada página viva segura a da marca dela
// (`segurarMarcaDaAba`, no app.js), e o `navigator.locks.query()` diz quais
// estão seguras. `semLocks`: o navegador sem a trava.
const MARCA = '__abaDaSaida:';
function compartilhar(a, b) {
  b.escopo.safeLS.get = (k) => a.escopo.safeLS.get(k);
  b.escopo.safeLS.set = (k, v) => a.escopo.safeLS.set(k, v);
  b.escopo.safeLS.remove = (k) => a.escopo.safeLS.remove(k);
}

// A aba A viu a 1 sem o Waze (a dívida, na memória e no aparelho). A B (o mesmo
// aparelho, aberta depois) adota a dívida guardada na primeira lista e a paga — o
// "lida" dela fica NO AR (o Waze lento). Aí a A fecha a conversa (o fechamento
// paga as dívidas). `b`: 'viva' (segue aberta), 'morta' (o sistema a descartou
// com o "lida" no ar — sem `pagehide`), 'falha' (o "lida" dela falha).
async function duasAbasPagando({ b = 'viva', semLocks = false, esperaAntesDeFecharMs = 5000 } = {}) {
  const travas = new Set([MARCA + 'aba-A', MARCA + 'aba-B']);
  const locks = semLocks ? null : { query: async () => ({ held: [...travas].map((name) => ({ name })), pending: [] }) };
  const w = wazeDeMentira();
  const A = w.pagina({ aba: 'aba-A', locks });
  A.P.Presenca.conversas = [w.lista().conversas[0]];
  A.P.presencaAbrirConversa(CAF);
  await tick(); await A.rodarTimers(); await tick();
  w.fora = true;
  w.guardar(1);
  await chega(A, 1);                                        // vista na tela…
  await A.rodarTimers(); await tick();                      // …e o "lida" falha: a dívida, na memória e no aparelho
  assert.ok(A.guardado().devendo, 'CONTROLE: a dívida tinha que estar no aparelho');
  w.fora = false;                                           // a rede volta
  const lidasDaA = lidas(A).length;
  const B = w.pagina({ agora: T + 120_000, aba: 'aba-B', locks });
  compartilhar(A, B);
  w.segurar = true;                                         // o Waze lento: o "lida" da B fica NO AR
  await B.P.presencaSincronizar();                          // a abertura da B: adota e paga
  await tick(); await tick();
  assert.equal(lidas(B).length, 1, 'CONTROLE: a B tinha que pagar a dívida que adotou');
  const marca = (A.guardado().devendo || {})[CAF];
  if (b === 'morta') travas.delete(MARCA + 'aba-B');
  if (b === 'falha') { w.presos.shift()(SEM_REDE); await tick(); await tick(); }
  A.relogio.agora = T + 120_000 + esperaAntesDeFecharMs;
  fechar(A);                                                // a A fecha a conversa
  for (let i = 0; i < 6; i++) await tick();                 // (a conferência da trava é assíncrona)
  const aPagouAoFechar = lidas(A).length - lidasDaA;
  // Solta o que ficou no ar: a B (a viva) recebe a resposta.
  while (w.presos.length) { w.presos.shift()({ success: true }); await tick(); await tick(); }
  // O próximo gesto da A que paga dívidas: a dela, já paga pela B, sai sem pedido.
  A.relogio.agora += 5000;
  A.P.presencaPagarDevidas();
  await tick(); await tick();
  return { marca, aPagouAoFechar, aPagouNoTotal: lidas(A).length - lidasDaA, bPagou: lidas(B).length,
    devendoNaA: A.P.Presenca.lidaDevendo.has(CAF), noAparelho: (A.guardado().devendo || {})[CAF] || null, naoLida1: w.naoLida(1) };
}

test('R10-5-05 a dívida que a OUTRA aba está pagando (o "lida" dela no ar) não é paga de novo — um "lida" só', async () => {
  const r = await duasAbasPagando();
  assert.ok(r.marca && r.marca.pagando && r.marca.pagando.aba === 'aba-B', `a aba que paga não marcou a dívida no aparelho: ${JSON.stringify(r.marca)}`);
  assert.equal(r.aPagouAoFechar, 0, 'DEFEITO: com o "lida" da outra aba no ar, esta pagou a mesma dívida de novo');
  assert.equal(r.aPagouNoTotal, 0, 'esta pagou a dívida que a outra já tinha pago');
  assert.equal(r.bPagou, 1);
  assert.equal(r.devendoNaA, false, 'a dívida paga pela outra aba ficou na memória desta');
  assert.equal(r.noAparelho, null);
  assert.equal(r.naoLida1, false);
});

test('R10-5-05 a marca só segura enquanto a outra aba VIVE e dentro do teto do "lida" no ar — e a que falha solta a dívida', async () => {
  // A aba que pagava morreu (o sistema a descartou no fundo, sem `pagehide`):
  // o "lida" dela morreu junto, e esta paga — na hora, sem esperar o teto.
  const morta = await duasAbasPagando({ b: 'morta' });
  assert.equal(morta.aPagouAoFechar, 1, 'DEFEITO: com a aba que pagava MORTA, esta esperou e a dívida ficou sem pagar');
  // O "lida" da outra aba FALHOU: a marca sai com ele, e esta paga.
  const falha = await duasAbasPagando({ b: 'falha' });
  assert.equal(falha.aPagouAoFechar, 1, 'com o "lida" da outra aba falhando, esta não pagou a dívida');
  // Sem a trava no navegador não há como saber se a outra vive: o teto do
  // "lida" no ar vale (45 s); passado ele, esta paga.
  const semTrava = await duasAbasPagando({ semLocks: true });
  assert.equal(semTrava.aPagouAoFechar, 0, 'sem `navigator.locks`, uma marca dentro do teto foi ignorada');
  const vencida = await duasAbasPagando({ semLocks: true, esperaAntesDeFecharMs: 50_000 });
  assert.equal(vencida.aPagouAoFechar, 1, 'a marca vencida (passado o teto do "lida" no ar) segurou a dívida');
});

test('R10-5-05 a marca desta MESMA aba (a página recarregada) não segura nada — e uma aba só paga uma vez', async () => {
  // A dívida guardada com a marca `pagando` desta aba: a página anterior dela
  // morreu com o "lida" no ar. A recarregada (a mesma marca) paga na abertura.
  const c = novoCliente({ agora: T + 600_000, aba: 'aba-A', api: {
    presencaApp: () => ({ success: true, online: [], agora: T + 600_000,
      conversas: [{ id: CAF, nome: 'cafanha', naoLidas: 1, atividade: T + 6, ultima: { deMim: false, ts: T + 6, recibo: false, texto: 'x', card: null } }] }),
  } });
  c.escopo.navigator.locks = { query: async () => ({ held: [{ name: MARCA + 'aba-A' }], pending: [] }) };
  c.armazenado.set('waze_places_chat', JSON.stringify({ devendo: { [CAF]: { ate: T + 6, n: 1, pagando: { aba: 'aba-A', em: T + 590_000 } } } }));
  c.P.presencaMontar();
  await c.P.presencaSincronizar();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(lidas(c).length, 1, 'DEFEITO: a página recarregada achou a própria marca "viva" e não pagou');
  assert.equal(c.guardado().devendo, undefined, 'a dívida paga não saiu do aparelho');
});

// ── R10-5-06: o `n` inflado guardado por uma versão anterior ─────────────────

// A dívida guardada pela v2026.10.06-01 (antes do teto das vistas): `n` contava
// o histórico inteiro dela. A página nova a adota na primeira lista. `ultima`:
// a última mensagem da conversa na lista — 'minha' (a pessoa respondeu), ou
// 'dela' (a M1, a vista, `T + 6`).
async function dividaGuardada({ n, naoLidas = 2, ultima = 'minha', segundaLista = null }) {
  const marcadas = [];
  let fora = false;
  let lista = { naoLidas, ultima: ultima === 'minha' ? { deMim: true, ts: T + 9, recibo: false, texto: 'resp', card: null }
    : { deMim: false, ts: T + 6, recibo: false, texto: 'x', card: null } };
  const c = novoCliente({ agora: T + 600_000, api: {
    presencaApp: () => ({ success: true, online: [], agora: c.relogio.agora,
      conversas: [{ id: CAF, nome: 'cafanha', naoLidas: lista.naoLidas, atividade: lista.ultima.ts, ultima: lista.ultima }] }),
    chat: (x) => { if (x.acao !== 'lida') return { success: true }; if (fora) return SEM_REDE; marcadas.push(x.com); return { success: true }; },
  } });
  c.armazenado.set('waze_places_chat', JSON.stringify({ devendo: { [CAF]: { ate: T + 6, n } } }));
  c.P.presencaMontar();
  if (segundaLista) fora = true;
  await c.P.presencaSincronizar();                          // a abertura: adota e paga
  await tick(); await tick();
  const naAbertura = { conta: c.P.presencaNaoLidasDe(CAF), lidas: lidas(c).length, marcadas: marcadas.length };
  if (segundaLista) {
    // O pagamento falhou (o Waze fora): a dívida volta a dever. Chega a X (só a
    // lista a conhece) e a pessoa responde noutro aparelho; a carona de um ✕
    // traz a lista que conta a M1 e a X. Depois o Waze volta e o próximo gesto paga.
    fora = false;
    lista = segundaLista;
    c.relogio.agora += 60_000;
    c.P.presencaAoCarona({ online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas: lista.naoLidas, atividade: lista.ultima.ts, ultima: lista.ultima }] },
      c.relogio.agora - 100, 30);
    await tick();
    const conta = c.P.presencaNaoLidasDe(CAF);
    c.P.presencaPagarDevidas();
    await tick(); await tick();
    return { naAbertura, conta, marcadas: marcadas.length };
  }
  return { naAbertura, devendo: c.P.Presenca.lidaDevendo.has(CAF), noAparelho: (c.guardado().devendo || {})[CAF] || null };
}

test('R10-5-06 a dívida guardada com o `n` inflado não marca no Waze a mensagem que ninguém viu', async () => {
  // A lista conta 2 (a M1, vista, e a X, nova) e a última é MINHA: com o `n`
  // inflado, a régua não via a X e a dívida paga a marcava.
  const r = await dividaGuardada({ n: 6 });
  assert.equal(r.naAbertura.marcadas, 0, 'DEFEITO: a dívida com o `n` inflado foi paga e marcou no Waze a X, que ninguém viu');
  assert.equal(r.naAbertura.conta, 2, 'a conta da lista (com a X) sumiu');
  assert.equal(r.noAparelho, null, 'a dívida que não diz o que foi visto ficou no aparelho');
  // CONTROLE: a mesma dívida com o `n` certo — o mesmo desfecho (o R7-5-01).
  const k = await dividaGuardada({ n: 1 });
  assert.deepEqual({ marcadas: k.naAbertura.marcadas, conta: k.naAbertura.conta }, { marcadas: 0, conta: 2 });
});

test('R10-5-06 o `n` guardado nunca passa da contagem do Waze: limitado a ela, ele serve às listas seguintes', async () => {
  // A primeira lista conta só a M1 (a vista, a última da conversa): a dívida é
  // adotada com o `n` limitado a 1 — e o pagamento falha. Depois chega a X (só a
  // lista a conhece) e a última passa a ser MINHA: a lista conta 2.
  const segunda = { naoLidas: 2, ultima: { deMim: true, ts: T + 9, recibo: false, texto: 'resp', card: null } };
  const r = await dividaGuardada({ n: 6, naoLidas: 1, ultima: 'dela', segundaLista: segunda });
  assert.equal(r.naAbertura.lidas, 1, 'CONTROLE: a lista que só conta a vista tinha que deixar pagar (e o Waze fora o fez falhar)');
  assert.equal(r.conta, 2, 'DEFEITO: com o `n` inflado, a lista com a X valeu zero');
  assert.equal(r.marcadas, 0, 'DEFEITO: a dívida paga marcou a X, que ninguém viu');
  // E quando a lista prova que tudo o que ela conta foi VISTO (a última é dela e
  // não passa da vista), a dívida inflada é paga — não é jogada fora.
  const viu = await dividaGuardada({ n: 6, naoLidas: 2, ultima: 'dela' });
  assert.equal(viu.naAbertura.marcadas, 1, 'a dívida cuja lista só conta o que foi visto não foi paga');
  assert.equal(viu.naAbertura.conta, 0);
});

// ── guarda de fonte: o portão do `onLine` só pra quem não tem prova ──────────
test('R10-5-02/03 os três que provam a rede abrem o tempo real sem o portão do `onLine` (`comRede`) — e só eles', () => {
  const FONTE = readFileSync(new URL('../js/presenca.js', import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const chamadas = [...FONTE.matchAll(/presencaFluxoGarantir\(\{[^}]*comRede:\s*([^,}]+)[^}]*\}\)/g)].map((m) => m[1].trim());
  assert.deepEqual(chamadas.sort(), ['fimNormal', 'true', 'true'].sort(),
    `apareceu (ou sumiu) quem abre o tempo real sem o portão do \`onLine\`: ${JSON.stringify(chamadas)} — só a prova de rede, o token que chegou numa resposta e o fim normal provam a rede`);
});
