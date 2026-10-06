// A presença e a conversa depois da auditoria da rodada 9 (R9-5): a lista que
// chega com o "lida" NO AR zerando a resposta que ninguém viu, o "invisível"
// repetido por duas abas da mesma conta em sessões diferentes, o tempo real
// parado com a conversa aberta e ninguém fazendo pedido, o carimbo do envio
// que morreu com a página, o "lida" a mais quando outra aba adota a dívida, o
// diagnóstico do tempo real parado e o `n` das vistas inflado quando o "lida"
// do `abrir` falha. Os rótulos R9-5-n são os do relatório dessa rodada. Cada
// teste foi visto REPROVANDO com o conserto desfeito.
//
// Dois instrumentos, como nas rodadas anteriores: o js/presenca.js INTEIRO no
// navegador de mentira do `_presenca-cliente.mjs`, e as funções do app.js
// FATIADAS e rodadas num escopo de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const GOOGLE = 'https://instantmessaging-pa.googleapis.com/';
const EU = '12444348';
const CAF = '183164343';

const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
// A mensagem `n` da CAF, com a hora `T + n` (a do Waze), chegando pelo tempo real.
const chega = async (c, n) => c.P.presencaQuadro(fluxoDe(c), { inboxMessage: { messageId: uuid(900 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts: T + n })) } });
const lidas = (c, com = CAF) => c.chamadas.chat.filter((x) => x.acao === 'lida' && x.com === com);
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const pilula = (c) => ({ escondida: c.$('presencaPill').classList.contains('hidden'),
  balao: !c.$('presencaIconMsg').classList.contains('hidden'), selo: c.$('presencaCount').textContent });
const SEM_REDE = { success: false, errorCategory: 'transient', _motivo: 'TypeError' };

// O Waze de mentira (o do `presenca-auditoria-r8`), que sobrevive à PÁGINA: as
// mensagens da CAF (a `n` tem a hora `T + n`) e quais seguem NÃO LIDAS. O "lida"
// (e o `abrir`) marca a conversa INTEIRA. `fora` derruba o "lida"; `segurar`
// prende os "lida" no ar até o teste soltar. `marcarNaChegada`: o Waze PROCESSA
// o "lida" quando o pedido chega, e o lento é a resposta.
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
  w.pagina = ({ de = null, agora = T } = {}) => {
    const c = novoCliente({ agora, api: {
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
    if (de) for (const [k, v] of de.armazenado) c.armazenado.set(k, v);
    c.P.presencaMontar();
    return c;
  };
  return w;
}

// ── R9-5-01: a lista com o "lida" NO AR e a resposta que ninguém viu ─────────

// A conversa com a CAF aberta: a 1 chega NA TELA, a pessoa fecha e o "lida" sai
// e fica NO AR (o Waze lento). A CAF responde: a 2 chega pelo tempo real com a
// conversa FECHADA. Um ✕ traz a lista de carona, que conta a 2 como não lida.
async function lidaNoArERespostaFechada({ chegaPeloFluxo = true, marcarNaChegada = true, comNova = true } = {}) {
  const w = wazeDeMentira({ marcarNaChegada });
  const c = w.pagina();
  c.P.Presenca.conversas = [w.lista().conversas[0]];
  c.P.presencaAbrirConversa(CAF);
  await tick(); await c.rodarTimers(); await tick();       // o `abrir` (nada a marcar)
  w.guardar(1);
  await chega(c, 1);                                        // a 1, NA TELA
  w.segurar = true;
  fechar(c);                                                // o "lida" sai no fechamento… e fica no ar
  await tick();
  assert.equal(c.P.presencaComLidaNoAr().length, 1, 'CONTROLE: o "lida" tinha que estar no ar');
  c.relogio.agora += 2000;
  if (comNova) {
    w.guardar(2);
    if (chegaPeloFluxo) await chega(c, 2);                  // a 2, com a conversa FECHADA
  }
  const antes = c.P.presencaNaoLidasDe(CAF);
  c.relogio.agora += 3000;
  c.P.presencaAoCarona(w.lista(), c.relogio.agora - 100, 30);   // a carona de um ✕, que saiu DEPOIS da 2
  await tick();
  return { w, c, antes, comALista: c.P.presencaNaoLidasDe(CAF), pilula: pilula(c) };
}

test('R9-5-01 a lista que chega com o "lida" NO AR não zera a resposta que chegou pelo tempo real com a conversa FECHADA', async () => {
  const r = await lidaNoArERespostaFechada();
  assert.equal(r.antes, 1, 'CONTROLE: a 2 tinha que contar como nova antes da lista');
  assert.equal(r.comALista, 1, 'DEFEITO: a lista zerou a resposta que ninguém viu — o "lida" no ar cobre só a 1');
  assert.deepEqual(r.pilula, { escondida: false, balao: true, selo: '1' }, 'a pílula perdeu a "1 mensagem nova"');
  // E se o "lida" no ar falhar, a conta fica (a 2 segue não lida no Waze).
  r.w.presos.shift()(SEM_REDE);
  await tick(); await tick();
  assert.equal(r.c.P.presencaNaoLidasDe(CAF), 1);
  assert.equal(r.w.naoLida(2), true);
  // CONTROLE (o R8-5-05): sem mensagem nova, a VISTA segue valendo zero com o
  // "lida" no ar — a lista lida no Waze antes dele a conta, e não é nova.
  const v = await lidaNoArERespostaFechada({ marcarNaChegada: false, comNova: false });
  assert.equal(v.comALista, 0, 'CONTROLE: a lista com o "lida" no ar devolveu a vista como nova (o R8-5-05 voltou)');
  // CONTROLE da PRECISÃO: a lista que saiu ANTES de a 2 chegar (lida no Waze com
  // a 1 ainda não lida) conta a 1, a vista — e a 2 segue contando pelo tempo
  // real. Uma marca "veio mensagem fora da vista" em vez do que o "lida" cobre
  // contaria 2 aqui.
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
  const listaDeAntes = w.lista();                          // lida no Waze ANTES da 2
  const saiuEm = c.relogio.agora;
  c.relogio.agora += 2000;
  w.guardar(2);
  await chega(c, 2);
  c.relogio.agora += 3000;
  c.P.presencaAoCarona(listaDeAntes, saiuEm, 30);
  await tick();
  assert.equal(c.P.presencaNaoLidasDe(CAF), 1, 'a lista de antes da 2 somou a vista com a 2 (ou perdeu a 2)');
});

test('R9-5-01 o "lida" que DÁ CERTO não zera o que a lista que saiu DEPOIS dele contou — e zera a que saiu antes', async () => {
  // (a) A resposta que chegou pelo tempo real com a conversa fechada.
  const r = await lidaNoArERespostaFechada();
  r.w.presos.shift()({ success: true });
  await tick(); await tick();
  assert.equal(r.w.naoLida(2), true, 'CONTROLE: o Waze processou o "lida" antes da 2 — ela segue não lida lá');
  assert.equal(r.c.P.presencaNaoLidasDe(CAF), 1, 'DEFEITO: o "lida" que deu certo zerou a resposta que ninguém viu');
  assert.deepEqual(pilula(r.c), { escondida: false, balao: true, selo: '1' });
  // (b) A 2 só na lista (o tempo real não a trouxe): idem.
  const s = await lidaNoArERespostaFechada({ chegaPeloFluxo: false });
  assert.equal(s.comALista, 1, 'CONTROLE: com o "lida" no ar, a lista tinha que contar a 2');
  s.w.presos.shift()({ success: true });
  await tick(); await tick();
  assert.equal(s.c.P.presencaNaoLidasDe(CAF), 1, 'DEFEITO: o "lida" que deu certo zerou a 2, que só a lista conhecia');
  // CONTROLE: a contagem da lista que saiu ANTES do "lida" ele zera (é o que o
  // Waze fez: a conversa inteira lida) — a do app que estava no segundo plano.
  const k = novoCliente({ agora: T, api: { chat: () => ({ success: true }) } });
  k.P.Presenca.aberta = CAF;
  k.$('conversaModal').classList.remove('hidden');
  k.P.Presenca.historico.set(CAF, { msgs: [{ id: 'm1', ts: T + 1, meu: false, texto: 'oi?' }], carregada: true });
  k.doc.visibilityState = 'hidden';
  k.P.presencaAplicarLista({ online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas: 1, atividade: T + 1,
    ultima: { deMim: false, ts: T + 1, recibo: false, texto: 'oi?' } }] }, k.relogio.agora - 1000, 30, 'pedido');
  assert.equal(k.P.presencaNaoLidasDe(CAF), 1, 'CONTROLE: com o app no fundo a lista conta');
  k.doc.visibilityState = 'visible';
  await k.P.presencaMarcarLida(CAF);
  assert.equal(k.P.presencaNaoLidasDe(CAF), 0, 'o "lida" que deu certo deixou a contagem da lista de ANTES dele');
});

// ── R9-5-07: o `n` das vistas com o "lida" do `abrir` falhando ───────────────

// O histórico da CAF: `antigas` mensagens dela LIDAS há tempo no Waze, e a M1
// (não lida), que a pessoa vê ao abrir. O "lida" do `abrir` falha (`lida:
// false`) e o Waze está fora. A X chega ao Waze sem o tempo real trazê-la, a
// pessoa responde (a minha fica por último) e fecha. A rede volta.
async function nInflado({ antigas }) {
  const w = { fora: true, dela: [], lidas: new Set() };
  for (let i = 0; i < antigas; i++) { w.dela.push({ k: i + 1, ts: T - 100_000 + i }); w.lidas.add(i + 1); }
  w.dela.push({ k: 900, ts: T - 1000 });                    // a M1
  const naoLidas = () => w.dela.filter((m) => !w.lidas.has(m.k)).length;
  const marcar = () => { for (const m of w.dela) w.lidas.add(m.k); };
  const c = novoCliente({ agora: T, api: {
    chat: (x) => {
      if (x.acao === 'abrir') return { success: true, maisAntigas: false, lida: false,
        mensagens: w.dela.map((m) => ({ classe: 'texto', id: uuid(m.k), ts: m.ts, de: { id: CAF }, para: { id: EU }, texto: 't' })) };
      if (x.acao === 'lida') { if (w.fora) return SEM_REDE; marcar(); return { success: true }; }
      if (x.acao === 'enviar') return { success: true, ts: c.relogio.agora };
      return { success: true };
    },
  } });
  c.P.presencaMontar();
  c.P.Presenca.conversas = [{ id: CAF, nome: 'cafanha', naoLidas: 1, atividade: T - 1000, ultima: { deMim: false, ts: T - 1000, recibo: false, texto: 't', card: null } }];
  c.P.presencaAbrirConversa(CAF);
  await tick(); await tick();
  await c.rodarTimers(); await tick();                      // a rajada: o Waze fora → dívida
  c.relogio.agora += 3000;
  w.dela.push({ k: 901, ts: c.relogio.agora });             // a X
  c.relogio.agora += 2000;
  c.$('conversaInput').value = 'respondi';
  c.$('conversaForm').disparar('submit');
  await tick(); await tick();
  fechar(c);                                                // paga… e falha (o Waze fora)
  await tick(); await tick();
  const guardada = (c.guardado().devendo || {})[CAF] || null;
  w.fora = false;
  c.relogio.agora += 2000;
  const minha = { deMim: true, ts: c.relogio.agora - 4000, recibo: false, texto: 'respondi', card: null };
  c.P.presencaAoCarona({ online: [], conversas: [{ id: CAF, nome: 'cafanha', naoLidas: naoLidas(), atividade: minha.ts, ultima: minha }] }, c.relogio.agora - 100, 30);
  const conta = c.P.presencaNaoLidasDe(CAF);
  await c.P.presencaSincronizar();                          // o próximo "Aplicar": paga as dívidas
  await tick(); await tick();
  return { guardada, conta, xMarcada: w.lidas.has(901), lidas: lidas(c).length };
}

test('R9-5-07 com o "lida" do `abrir` falhando, as vistas não contam o histórico INTEIRO dela — e a mensagem que ninguém viu não é marcada', async () => {
  const r = await nInflado({ antigas: 5 });
  assert.deepEqual(r.guardada && r.guardada.n, 1, 'DEFEITO: a dívida guardou como vistas e não lidas as 6 mensagens dela da página (5 lidas havia muito)');
  assert.equal(r.conta, 2, 'DEFEITO: a lista com a X (que só ela conhece) valeu zero — a régua via 6 vistas');
  assert.equal(r.xMarcada, false, 'DEFEITO: a dívida paga marcou no Waze a X, que ninguém viu');
  // CONTROLE: só a M1 no histórico — o mesmo desfecho (era o caso que já funcionava).
  const k = await nInflado({ antigas: 0 });
  assert.deepEqual(k.guardada && k.guardada.n, 1);
  assert.equal(k.conta, 2);
  assert.equal(k.xMarcada, false);
});

test('R9-5-07 as que chegam com a conversa NA TELA entram no teto: vistas e não lidas no Waze, elas pagam a dívida', async () => {
  // A conversa abre sem não lidas (o teto começa em zero); o "lida" do `abrir`
  // falha, e duas mensagens chegam com ela na tela. O "lida" delas falha (o
  // Waze fora): a dívida tem DUAS vistas, e a lista que conta as duas vale zero.
  const w = wazeDeMentira();
  const c = novoCliente({ agora: T, api: {
    chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [], maisAntigas: false, lida: false } : SEM_REDE),
  } });
  c.P.presencaMontar();
  c.P.Presenca.conversas = [w.lista().conversas[0]];
  c.P.presencaAbrirConversa(CAF);
  await tick(); await c.rodarTimers(); await tick();
  w.guardar(1); w.guardar(2);
  await chega(c, 1);
  await chega(c, 2);
  await c.rodarTimers(); await tick();                      // a rajada: falha → dívida
  assert.deepEqual(c.guardado().devendo, { [CAF]: { ate: T + 2, n: 2 } }, 'DEFEITO: as que chegaram com a conversa na tela ficaram fora do teto');
  fechar(c);
  await tick();
  c.relogio.agora += 1000;
  c.P.presencaAoCarona(w.lista(), c.relogio.agora - 100, 30);   // o Waze conta as duas
  assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'DEFEITO: as duas VISTAS voltaram como "2 mensagens novas"');
  assert.deepEqual([...c.P.Presenca.lidaDevendo], [CAF], 'a dívida das vistas foi embora sem pagar');
});

// ── R9-5-05: o "lida" a mais quando a outra aba adota a dívida ───────────────

// Um aparelho com DUAS páginas: o armazenamento é um só (a B lê e grava no da A).
function compartilhar(a, b) {
  b.escopo.safeLS.get = (k) => a.escopo.safeLS.get(k);
  b.escopo.safeLS.set = (k, v) => a.escopo.safeLS.set(k, v);
  b.escopo.safeLS.remove = (k) => a.escopo.safeLS.remove(k);
}

test('R9-5-05 a outra aba adota a dívida guardada e a PAGA: esta não paga de novo — um "lida" só', async () => {
  const caso = async ({ duasAbas }) => {
    const w = wazeDeMentira();
    const A = w.pagina();
    A.P.Presenca.conversas = [w.lista().conversas[0]];
    A.P.presencaAbrirConversa(CAF);
    await tick(); await A.rodarTimers(); await tick();
    w.fora = true;
    w.guardar(1);
    await chega(A, 1);                                      // vista na tela…
    await A.rodarTimers(); await tick();                    // …e o "lida" falha: a dívida, na memória e no aparelho
    assert.ok(A.guardado().devendo, 'CONTROLE: a dívida tinha que estar no aparelho');
    w.fora = false;                                         // a rede volta
    const antes = lidas(A).length;
    let B = null;
    if (duasAbas) {
      B = w.pagina({ agora: T + 120_000 });
      compartilhar(A, B);
      await B.P.presencaSincronizar();                      // a abertura da B: adota e paga
      await tick(); await tick();
      assert.equal(lidas(B).length, 1, 'CONTROLE: a outra aba tinha que pagar a dívida que adotou');
      assert.equal(A.guardado().devendo, undefined, 'CONTROLE: a dívida paga tinha que sair do aparelho');
    }
    A.relogio.agora = T + 125_000;
    fechar(A);                                              // e esta fecha a conversa
    await tick(); await tick();
    return { comARede: lidas(A).length - antes + (B ? lidas(B).length : 0), devendo: [...A.P.Presenca.lidaDevendo], naoLida: w.naoLida(1) };
  };
  const duas = await caso({ duasAbas: true });
  assert.equal(duas.comARede, 1, `DEFEITO: com a rede de volta saíram ${duas.comARede} "lida" pela mesma dívida (a outra aba já a pagou)`);
  assert.deepEqual(duas.devendo, [], 'a dívida paga pela outra aba ficou na memória desta');
  assert.equal(duas.naoLida, false);
  // CONTROLE: com uma aba só, ela paga a dela (o sumiço não é inventado).
  const uma = await caso({ duasAbas: false });
  assert.equal(uma.comARede, 1, 'CONTROLE: com uma aba, a dívida tinha que ser paga uma vez');
  assert.equal(uma.naoLida, false);
});

// ── R9-5-03: o tempo real PARADO com a conversa aberta ───────────────────────

// O fetch do Google de mentira: `rede.fora` derruba (o aparelho sem rede); com
// rede, a conexão abre, manda o lote que abre TODA conexão e fica (viva).
const LOTE = new TextEncoder().encode('[{"startOfBatch":{}},{"endOfBatch":{}}');
function googleDeMentira(rede) {
  return (url, init) => {
    if (rede.fora) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(new Response(new ReadableStream({
      start(ctl) {
        ctl.enqueue(LOTE);
        init.signal.addEventListener('abort', () => { try { ctl.error(new DOMException('aborted', 'AbortError')); } catch (e) { /* fechado */ } });
      },
    })));
  };
}

// A conversa com a CAF ABERTA e o tempo real vivo; o modo avião derruba a
// conexão: ela PARA. Depois a rede volta SEM o evento `online` (o iPhone), e a
// pessoa fica olhando a conversa: nenhum pedido à nossa API.
async function conversaParada() {
  const rede = { fora: false };
  const c = novoCliente({ agora: T, api: {
    fetch: googleDeMentira(rede),
    presencaApp: () => ({ success: true, online: [], conversas: [], agora: c.relogio.agora }),
    chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [], maisAntigas: false, lida: true } : { success: true }),
  } });
  c.P.presencaMontar();
  Object.assign(c.P.Presenca, { atualizadaEm: T, tentadaEm: T, pais: 30, tokenPedidoEm: T,
    chat: { token: 'tk', base: GOOGLE, chave: 'k', expiraEm: T + 20 * 3600e3 } });
  c.P.presencaAbrirConversa(CAF);
  await tick(); await c.rodarTimers(); await tick();
  c.P.presencaFluxoGarantir();
  for (let i = 0; i < 4; i++) await tick();
  assert.ok(c.P.Presenca.fluxo && c.P.Presenca.fluxoDiag.conectou, 'CONTROLE: o tempo real tinha que estar aberto e vivo');
  rede.fora = true;                                         // o modo avião
  c.escopo.navigator.onLine = false;
  c.P.Presenca.fluxo.ctl.abort();                           // a conexão cai
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(c.P.Presenca.fluxoParado, true, 'CONTROLE: sem rede, o tempo real tinha que PARAR');
  const api = () => c.chamadas.presencaApp.length + c.chamadas.chat.length;
  return { c, rede, api, apiAntes: api(), googleAntes: c.chamadas.fetch.length };
}
const googleDesde = (p) => p.c.chamadas.fetch.length - p.googleAntes;

test('R9-5-03 o tempo real parado segue no recuo do próprio fluxo e religa sozinho — com a conversa só aberta, sem o `online` e sem pedido à API', async () => {
  const p = await conversaParada();
  const ESPERAS = p.c.P.PRESENCA_FLUXO_ESPERAS_MS;
  const noDegrau = (i) => p.c.timers.length === 1 && p.c.timers[0].ms >= 0.75 * ESPERAS[i] && p.c.timers[0].ms <= 1.25 * ESPERAS[i];
  assert.ok(noDegrau(0), `DEFEITO: o tempo real parado não deixou o recuo de pé — ninguém o religa com a pessoa só olhando (${JSON.stringify(p.c.timers.map((x) => x.ms))})`);
  // Sem rede, cada recuo tenta o Google (de graça pra API), falha e volta pro
  // recuo um degrau acima — até o de 1 min, e não passa dele.
  for (let i = 1; i <= ESPERAS.length + 1; i++) {
    await p.c.rodarTimers();
    for (let j = 0; j < 4; j++) await tick();
    assert.equal(googleDesde(p), i, 'o recuo sem rede não tentou o Google');
    assert.equal(p.c.P.Presenca.fluxoParado, true);
    assert.ok(noDegrau(Math.min(i, ESPERAS.length - 1)), `o recuo sem rede saiu do degrau ${Math.min(i, ESPERAS.length - 1)}: ${JSON.stringify(p.c.timers.map((x) => x.ms))}`);
  }
  // A rede volta, SEM o `online`: o próximo recuo religa.
  const antes = googleDesde(p);
  p.rede.fora = false;
  p.c.escopo.navigator.onLine = true;
  await p.c.rodarTimers();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(googleDesde(p), antes + 1, 'DEFEITO: com a rede de volta, o recuo não religou o tempo real');
  assert.ok(p.c.P.Presenca.fluxo, 'o tempo real religado não ficou aberto');
  assert.equal(p.c.P.Presenca.fluxoParado, false);
  assert.equal(p.api(), p.apiAntes, 'DEFEITO: religar o tempo real parado pediu alguma coisa à nossa API');
});

test('R9-5-03 um GESTO na conversa (o toque, a tecla) e o FOCO do app religam o parado na hora — sem pedido à API, com teto', async () => {
  const p = await conversaParada();
  p.rede.fora = false;                                      // a rede volta, sem o `online`
  p.c.escopo.navigator.onLine = true;
  p.c.$('conversaModal').disparar('pointerdown');           // o dedo na conversa
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(googleDesde(p), 1, 'DEFEITO: o toque na conversa não religou o tempo real parado');
  assert.ok(p.c.P.Presenca.fluxo);
  assert.equal(p.api(), p.apiAntes, 'religar pelo gesto pediu alguma coisa à nossa API');
  // CONTROLE: com o tempo real vivo, o gesto não abre outra conexão.
  p.c.$('conversaModal').disparar('keydown');
  await tick();
  assert.equal(googleDesde(p), 1, 'com o tempo real vivo, o gesto abriu outra conexão');
  // O gesto SEM rede tenta (de graça) e volta pro parado; o próximo, em menos de
  // 5 s, não tenta de novo (digitando, seria uma tentativa por tecla).
  const q = await conversaParada();
  q.c.$('conversaModal').disparar('keydown');
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(googleDesde(q), 1, 'o gesto sem rede não tentou o Google');
  assert.equal(q.c.P.Presenca.fluxoParado, true);
  q.c.relogio.agora += 2000;
  q.c.$('conversaModal').disparar('keydown');
  await tick();
  assert.equal(googleDesde(q), 1, 'cada tecla virou uma tentativa (o teto do gesto sumiu)');
  q.c.relogio.agora += 4000;
  q.rede.fora = false;
  q.c.escopo.navigator.onLine = true;
  for (const fn of q.c.win._ouv.focus || []) fn();          // o FOCO do app (passado o teto)
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(googleDesde(q), 2, 'DEFEITO: o foco do app não religou o tempo real parado');
  assert.equal(q.api(), q.apiAntes);
});

// ── R9-5-06: a marca, o diário e a triagem do tempo real parado ──────────────

test('R9-5-06 a marca de "parado" não acende com o tempo real ABERTO — um instante de `onLine` falso não é queda', async () => {
  const rede = { fora: false };
  const c = novoCliente({ agora: T, api: { fetch: googleDeMentira(rede) } });
  c.P.presencaMontar();
  Object.assign(c.P.Presenca, { atualizadaEm: T, tentadaEm: T, pais: 30, tokenPedidoEm: T,
    chat: { token: 'tk', base: GOOGLE, chave: 'k', expiraEm: T + 20 * 3600e3 } });
  c.P.presencaFluxoGarantir();
  for (let i = 0; i < 4; i++) await tick();
  assert.ok(c.P.Presenca.fluxo, 'CONTROLE: o tempo real tinha que estar aberto');
  c.escopo.navigator.onLine = false;                        // o rádio trocando de torre
  await c.P.presencaSincronizar();                          // o "Aplicar" dos Filtros, a volta do fundo
  c.escopo.navigator.onLine = true;
  assert.deepEqual({ aberto: c.P.presencaDiag().fluxo.aberto, parado: c.P.presencaDiag().fluxo.parado }, { aberto: true, parado: false },
    'DEFEITO: o diagnóstico diz "aberto" e "parado" juntos');
  assert.equal(c.timers.some((x) => x.id === c.P.Presenca.timers.fluxo), false, 'com a conexão viva, ficou de pé o recuo do parado');
  // CONTROLE: sem a conexão, o mesmo instante sem rede PARA.
  c.P.presencaFluxoFechar();
  c.escopo.navigator.onLine = false;
  await c.P.presencaSincronizar();
  assert.equal(c.P.presencaDiag().fluxo.parado, true, 'CONTROLE: sem conexão e sem rede, o tempo real tinha que parar');
});

test('R9-5-06 o diário conta o EPISÓDIO de tempo real parado: "parou" uma vez, e "religou" com quem religou — o recuo que falha no meio não entra', async () => {
  const p = await conversaParada();
  const linhas = () => p.c.chamadas.dfato.filter(([k, o]) => k === 'presenca.fluxo' && (o.ev === 'parou' || o.ev === 'religou')).map(([, o]) => o);
  // Três recuos sem rede, um por minuto: cada um tenta e falha.
  for (let i = 0; i < 3; i++) {
    p.c.relogio.agora += 61_000;
    await p.c.rodarTimers();
    for (let j = 0; j < 4; j++) await tick();
  }
  assert.equal(googleDesde(p), 3, 'CONTROLE: os três recuos tinham que tentar');
  assert.deepEqual(linhas().map((o) => o.ev), ['parou'], 'DEFEITO: o recuo que falha sem rede pôs uma linha por tentativa (ou o "parou" não entrou)');
  // A rede volta e a próxima resposta da API (a prova) religa.
  p.rede.fora = false;
  p.c.escopo.navigator.onLine = true;
  p.c.relogio.agora += 10_000;
  p.c.P.presencaAoProvarRede();
  for (let i = 0; i < 4; i++) await tick();
  const fim = linhas();
  assert.deepEqual(fim.map((o) => o.ev), ['parou', 'religou'], 'DEFEITO: a volta do tempo real parado não entrou no diário');
  assert.equal(fim[1].via, 'prova', 'o diário não diz quem religou');
  assert.ok(fim[1].durouS >= 190, `o diário não diz quanto o parado durou (${fim[1].durouS} s)`);
});

// O LEITOR do diagnóstico (`tools/diag-resumo.mjs`) é rodado de verdade sobre o
// relatório do auditor (o `parado: true` e o `lidaNoAr: 1` do lote 12).
test('R9-5-06 a triagem mostra o tempo real PARADO (com ATENÇÃO) e o "lida" no ar — e não acusa a conexão viva', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const rodar = (presencaApp) => {
    const dir = mkdtempSync(join(tmpdir(), 'r9-diag-'));
    const arq = join(dir, 'diag.json');
    writeFileSync(arq, JSON.stringify({ _versaoDoDiag: 11, app: { versao: '2026100601' }, ambiente: { tela: {} },
      resumo: { alertas: [], presencaApp } }));
    return execFileSync(process.execPath, [new URL('../tools/diag-resumo.mjs', import.meta.url).pathname, arq], { encoding: 'utf8' });
  };
  const base = { ligada: true, online: 0, conversas: 1, naoLidas: 0, atualizadaHaS: 30, conversaAberta: true,
    token: { valido: true, abre: true, expiraEmH: 20 }, conhecidos: 1, aConfirmar: 0, lidaDevendo: 0, contagem: null };
  const s = rodar({ ...base, lidaNoAr: 1, fluxo: { aberto: false, parado: true, tentativa: 2, aberturas: 3, quadros: 5, mensagens: 1, recibos: 0, ultimoErro: 'TypeError' } });
  assert.match(s, /tempo real aberto false · .* · parado sem rede true/, 'DEFEITO: a triagem não diz que o tempo real está parado');
  assert.match(s, /ATENÇÃO: o tempo real está PARADO pela falta de rede/, 'DEFEITO: o tempo real parado não ganhou o aviso');
  assert.match(s, /com o "lida" no ar: 1/, 'DEFEITO: a triagem não mostra o "lida" no ar');
  assert.match(s, /nota: 1 conversa tem o "lida" no ar/);
  // CONTROLE: a conexão viva (o relatório do lote 12 podia trazer as duas marcas) não ganha o aviso.
  const vivo = rodar({ ...base, lidaNoAr: 0, fluxo: { aberto: true, haS: 12, parado: true, tentativa: 0, aberturas: 1, quadros: 2, mensagens: 0, recibos: 0 } });
  assert.doesNotMatch(vivo, /ATENÇÃO: o tempo real está PARADO/, 'aviso de parado com a conexão aberta é o aviso que se aprende a ignorar');
  assert.doesNotMatch(vivo, /nota: \d+ conversas? t[eê]m? o "lida" no ar/);
  // E o relatório de antes desses campos diz que eles não vinham.
  const velho = rodar({ ...base, fluxo: { aberto: false, tentativa: 1, aberturas: 1, quadros: 0, mensagens: 0, recibos: 0 } });
  assert.match(velho, /parado sem rede \(ausente nesta versão\)/);
  assert.match(velho, /com o "lida" no ar: \(ausente nesta versão\)/);
});

