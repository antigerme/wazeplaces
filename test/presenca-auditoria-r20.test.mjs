// A presença e a conversa depois da auditoria da rodada 20 (R20-5; lote 24).
// O rótulo é o do relatório dessa rodada. Cada teste foi visto REPROVANDO com o
// conserto desfeito (as sabotagens estão no relatório do lote 24).
//
// O instrumento é o js/presenca.js INTEIRO no navegador de mentira do
// `_presenca-cliente.mjs`, como nas rodadas anteriores. Os cenários vêm dos
// roteiros do auditor (p1, p3, p4, p5, p6), cada um com o seu CONTROLE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const EU = '12444348';
const CAF = '183164343';

const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
// A mensagem `n` chega pelo tempo real, com a hora `ts` no quadro.
const chega = async (c, n, ts = T + n) => c.P.presencaQuadro(fluxoDe(c), { inboxMessage: { messageId: uuid(900000 + n), messageType: 'X',
  message: b64(await bytesDeMensagem({ id: uuid(n), de: CAF, para: EU, texto: 'msg ' + n, ctx: { app: 'wazeplaces' }, ts })) } });
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const FALHA = { success: false, errorCategory: 'transient', error: 'x', httpCode: 500 };
const visibilidade = (c, v) => { c.doc.visibilityState = v; for (const fn of c.doc._ouv.visibilitychange || []) fn(); };
const pagehide = (c) => { for (const fn of c.win._ouv.pagehide || []) fn({}); };

// Um Waze de mentira que guarda as mensagens com a hora de cada uma (`ts`), diz
// a lista e a página, e anota o que cada "lida" cobriu.
function waze({ falhaAbrir = false } = {}) {
  const srv = { ts: {}, lidoAte: 0, lidas: [], abrirOk: !falhaAbrir, lidaOk: true, presoAbrir: [], segurarAbrir: false, presoLista: [], segurarLista: false };
  const ids = () => Object.keys(srv.ts).map(Number);
  const maior = () => Math.max(0, ...Object.values(srv.ts));
  let c;
  const lista = () => {
    const u = ids().at(-1);
    return { success: true, agora: c.relogio.agora, online: [], conversas: u ? [{ id: CAF, nome: 'cafanha', naoLidas: ids().filter((n) => srv.ts[n] > srv.lidoAte).length, atividade: srv.ts[u], ultima: { deMim: false, ts: srv.ts[u], recibo: false, texto: 'x', card: null } }] : [] };
  };
  const msgs = () => ids().map((n) => ({ id: uuid(n), ts: srv.ts[n], de: { tipo: 1, id: CAF }, para: { tipo: 1, id: EU }, classe: 'texto', texto: 'msg ' + n, contexto: { app: 'wazeplaces' } }));
  const api = {
    presencaApp: () => { const r = lista(); if (!srv.segurarLista) return r; return new Promise((res) => srv.presoLista.push(() => res(r))); },
    chat: (x) => {
      if (x.acao === 'abrir') {
        if (srv.segurarAbrir) return new Promise((res) => srv.presoAbrir.push(res));
        if (!srv.abrirOk) return FALHA;
        srv.lidoAte = maior();
        return { success: true, mensagens: msgs(), maisAntigas: false, lida: true };
      }
      if (x.acao === 'lida' && !srv.lidaOk) return FALHA;
      if (x.acao === 'lida') { srv.lidas.push(ids().filter((n) => srv.ts[n] > srv.lidoAte)); srv.lidoAte = maior(); return { success: true }; }
      return { success: true };
    },
  };
  return { srv, api, ligar: (cliente) => { c = cliente; }, add: (n, ts) => { srv.ts[n] = ts; return ts; }, msgs };
}

// ── R20-5-01: o ramo "olhando" da `presencaAplicarLista` só registrava o que a
// tela não tem com a primeira página ADIADA. Com o `abrir` NO AR (a lista chega
// com a página ainda vindo) e o `abrir` falhando depois, a marca nascia 0 e o
// "lida" da mensagem 3, vista ao vivo, cobria a 2, que nunca esteve na tela.
async function p1({ listaAntes, abrirFalha = true }) {
  const w = waze();
  const c = novoCliente({ agora: T + 10, api: w.api });
  w.ligar(c);
  c.P.presencaMontar();
  w.add(1, T + 1);
  await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick(); fechar(c); await tick(); await tick();   // a 1: vista e lida
  w.add(2, T + 2);                                   // a 2 chega ao Waze; o tempo real não a entrega
  c.relogio.agora = T + 100000;
  c.$('presencaPill').classList.remove('hidden');
  w.srv.segurarAbrir = true;
  if (listaAntes) {
    await c.P.presencaAtualizar(); await tick();     // CONTROLE: a lista chega ANTES de abrir
    c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  } else {
    w.srv.segurarLista = true;
    c.$('presencaPill').disparar('click'); await tick();           // a pílula pede a lista (presa)
    c.P.presencaAbrirConversa(CAF); await tick(); await tick();   // o `abrir` fica no ar
    w.srv.segurarLista = false;
    c.relogio.agora = T + 101000;
    w.srv.presoLista.splice(0).forEach((f) => f()); await tick(); await tick();   // a lista chega com a página NO AR
  }
  const h = c.P.Presenca.historico.get(CAF);
  const noAr = { carregando: h.carregando, naoVisto: h.naoVistoAoAbrir || 0 };
  w.srv.segurarAbrir = false;
  w.srv.presoAbrir.splice(0).forEach((r) => r(abrirFalha ? FALHA : { success: true, mensagens: w.msgs(), maisAntigas: false, lida: true }));
  await tick(); await tick();
  const depois = { falhou: !!h.primeiraFalhou, naoVisto: h.naoVistoAoAbrir || 0 };
  w.add(3, T + 3); c.relogio.agora = T + 150000;
  await chega(c, 3); await tick();                    // a 3 chega ao vivo e é vista
  await c.rodarTimers(); await tick(); await tick();
  fechar(c); await tick(); await tick();
  return { noAr, depois, lidas: w.srv.lidas, c };
}

test('R20-5-01 a lista que chega com o `abrir` NO AR, e o `abrir` falha: a marca nasce e o "lida" da 3 não cobre a 2', async () => {
  const r = await p1({ listaAntes: false });
  assert.equal(r.noAr.carregando, true, 'CONTROLE: a lista tem que chegar com a primeira página AINDA no ar');
  assert.equal(r.noAr.naoVisto, 1, 'a marca nasceu com a página no ar (o R16-5-01 exige a dívida nascendo assim)');
  assert.equal(r.depois.falhou, true, 'CONTROLE: o `abrir` falhou');
  assert.equal(r.depois.naoVisto, 1, 'a marca ficou depois da falha');
  assert.deepEqual(r.lidas, [], 'o "lida" da 3 cobriu a 2, que a tela nunca teve ("Lida" antes da hora pra quem a mandou)');
});

test('R20-5-01 CONTROLE: a mesma lista chegando ANTES de abrir já dava a marca e nenhum "lida"', async () => {
  const r = await p1({ listaAntes: true });
  assert.equal(r.depois.naoVisto, 1);
  assert.deepEqual(r.lidas, []);
});

test('R20-5-01 com a primeira página BOA o `abrir` marca tudo na chegada: a marca zera e nada fica retido', async () => {
  const r = await p1({ listaAntes: false, abrirFalha: false });
  assert.equal(r.depois.falhou, false);
  assert.equal(r.depois.naoVisto, 0, 'a primeira página boa zera a marca');
  assert.equal(r.c.P.presencaSemVerAoAbrir(CAF), false);
});

// ── R20-5-02: a lista que chega com a página ESCONDIDA e a primeira página
// falhada: a volta (`presencaVistasNaVolta`) zerava a conta sem registrar.
async function p3({ listaAntes }) {
  const w = waze();
  const c = novoCliente({ agora: T + 10, api: w.api });
  w.ligar(c);
  c.P.presencaMontar();
  w.add(1, T + 1);
  await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick(); fechar(c); await tick(); await tick();
  w.add(2, T + 2);                                    // só a lista conhece
  c.relogio.agora = T + 100000;
  w.srv.abrirOk = false;
  if (listaAntes) { await c.P.presencaAtualizar(); await tick(); }
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();     // o `abrir` falha
  const h = c.P.Presenca.historico.get(CAF);
  visibilidade(c, 'hidden');
  c.relogio.agora = T + 101000;
  if (!listaAntes) { await c.P.presencaAtualizar(); await tick(); }   // a lista chega ESCONDIDA
  const escondida = { naLista: c.P.Presenca.conversas.find((x) => x.id === CAF)?.naoLidas, naoVisto: h.naoVistoAoAbrir || 0 };
  c.relogio.agora = T + 110000;
  visibilidade(c, 'visible'); await tick(); await tick();
  const volta = { naoVisto: h.naoVistoAoAbrir || 0 };
  w.add(3, T + 3); c.relogio.agora = T + 150000;
  await chega(c, 3); await tick();
  await c.rodarTimers(); await tick(); await tick();
  fechar(c); await tick(); await tick();
  return { escondida, volta, lidas: w.srv.lidas };
}

test('R20-5-02 a lista que chega ESCONDIDA e a primeira página falhada: a volta registra a marca e o "lida" não cobre a 2', async () => {
  const r = await p3({ listaAntes: false });
  assert.equal(r.escondida.naLista, 1, 'CONTROLE: a lista chegou escondida contando a 2');
  assert.equal(r.volta.naoVisto, 1, 'a volta zerou a conta sem registrar a marca');
  assert.deepEqual(r.lidas, [], 'o "lida" da 3 cobriu a 2, que a tela nunca teve');
});

test('R20-5-02 CONTROLE: a lista antes de abrir dá a marca e nenhum "lida"', async () => {
  const r = await p3({ listaAntes: true });
  assert.equal(r.volta.naoVisto, 1);
  assert.deepEqual(r.lidas, []);
});

// ── R20-5-03: o `pagehide` com a página já ESCONDIDA refazia a dívida com o
// histórico inteiro e pagava "lida" da mensagem que chegou com a tela apagada.
async function p4({ pagina, ordem }) {
  const w = waze({ falhaAbrir: pagina === 'falha' });
  const c = novoCliente({ agora: T + 10, api: w.api });
  w.ligar(c);
  c.P.presencaMontar();
  await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  visibilidade(c, 'hidden'); await tick();
  c.relogio.agora = T + 60000;
  w.add(5, T + 5);
  await chega(c, 5); await tick();                    // chega com a tela apagada: ninguém viu
  const antes = w.srv.lidas.length;
  if (ordem === 'pagehide-depois') { pagehide(c); }
  else { pagehide(c); visibilidade(c, 'hidden'); }    // a ordem dos eventos não pode mudar o resultado
  await tick(); await tick();
  return { lidasDepoisDoPagehide: w.srv.lidas.length - antes, naTela: c.$('conversaMsgs').innerHTML.includes('msg 5') };
}

test('R20-5-03 o `pagehide` com a página ESCONDIDA e a primeira página falhada não paga "lida" do que chegou com a tela apagada', async () => {
  const r = await p4({ pagina: 'falha', ordem: 'pagehide-depois' });
  assert.equal(r.naTela, true, 'CONTROLE: a mensagem entrou na conversa (e ninguém a viu)');
  assert.equal(r.lidasDepoisDoPagehide, 0);
});

test('R20-5-03 CONTROLE: com a primeira página boa o `pagehide` escondido também não manda "lida"', async () => {
  const r = await p4({ pagina: 'ok', ordem: 'pagehide-depois' });
  assert.equal(r.lidasDepoisDoPagehide, 0);
});

test('R20-5-03 com o `pagehide` ainda VISÍVEL a dívida do que foi visto TEM que nascer e ser paga (nas duas ordens dos eventos)', async () => {
  // A 2 chegou ao vivo com a conversa fechada e a reabertura a mostra (a
  // primeira página falhou): quem a viu foi a pessoa, com a tela acesa.
  for (const ordem of ['pagehide-primeiro', 'visibilidade-primeiro']) {
    const w = waze();
    const c = novoCliente({ agora: T + 10, api: w.api });
    w.ligar(c);
    c.P.presencaMontar();
    w.add(1, T + 1);
    await c.P.presencaAtualizar(); await tick();
    c.P.presencaAbrirConversa(CAF); await tick(); await tick(); fechar(c); await tick(); await tick();
    c.relogio.agora = T + 5000;
    w.add(2, T + 2); await chega(c, 2); await tick();          // a 2: ao vivo, com a conversa fechada
    w.srv.abrirOk = false;
    c.relogio.agora = T + 10000;
    c.P.presencaAbrirConversa(CAF); await tick(); await tick();
    const h = c.P.Presenca.historico.get(CAF);
    assert.equal(h.primeiraFalhou, true, `${ordem}: CONTROLE: a primeira página falhou`);
    assert.equal(h.naoVistoAoAbrir || 0, 0, `${ordem}: CONTROLE: a 2 está na tela, nada falta`);
    assert.deepEqual(w.srv.lidas, [], `${ordem}: CONTROLE: nenhum "lida" ainda`);
    if (ordem === 'pagehide-primeiro') { pagehide(c); visibilidade(c, 'hidden'); }
    else { visibilidade(c, 'hidden'); pagehide(c); }
    await tick(); await tick();
    assert.equal(w.srv.lidas.length, 1, `${ordem}: a mensagem vista não foi paga ao sair (ficaria "1 mensagem nova")`);
  }
});

// ── R20-5-09: a subtração `naoLidas − vistas.n` SUBCONTA quando as vistas foram
// lidas em outro aparelho (o WME): a não vista some e o "lida" a cobre.
async function p5({ lidoFora, defasagem = 0, volta = false }) {
  const w = waze();
  const c = novoCliente({ agora: T + 10, api: w.api });
  w.ligar(c);
  c.P.presencaMontar();
  const add = (n) => { c.relogio.agora += 1000; return w.add(n, c.relogio.agora); };
  add(1); await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick(); fechar(c); await tick(); await tick();   // a 1: vista e lida
  const ts2 = add(2);
  await chega(c, 2, ts2 - defasagem); await tick();    // a 2 chega ao vivo com a conversa fechada
  if (lidoFora) w.srv.lidoAte = ts2;                   // ...e é lida no WME, em outro aparelho
  let ts3 = null;
  if (!volta) {
    ts3 = add(3);                                      // a 3 só a lista conhece
    c.relogio.agora += 70000; await c.P.presencaAtualizar(); await tick();
  }
  w.srv.abrirOk = false;
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();    // reabre: a primeira página falha
  const h = c.P.Presenca.historico.get(CAF);
  if (volta) {
    // O "lida" que a ida pro fundo paga falha: nada fica confirmado, e a 2 (na
    // tela, lida fora) segue contando em `vistas.n` — é o que faz a subtração
    // dar zero na lista que chega escondida. Com ele confirmado, `n` cairia a 0
    // e a subtração sozinha acertaria (o teste não distinguiria o conserto).
    w.srv.lidaOk = false;
    visibilidade(c, 'hidden'); await tick(); await tick();
    ts3 = add(3);
    c.relogio.agora += 70000; await c.P.presencaAtualizar(); await tick();   // a lista chega ESCONDIDA contando a 3
    w.srv.lidaOk = true;
    visibilidade(c, 'visible'); await tick(); await tick();
  }
  const naoVisto = h.naoVistoAoAbrir || 0;
  const n4 = add(4); await chega(c, 4, n4); await tick();
  await c.rodarTimers(); await tick(); await tick();
  fechar(c); await tick(); await tick();
  return { naoVisto, lidas: w.srv.lidas, ts3 };
}

test('R20-5-09 a 2 lida no WME e a 3 só na lista: a marca é 1 e o "lida" da 4 não cobre a 3', async () => {
  const r = await p5({ lidoFora: true });
  assert.equal(r.naoVisto, 1, 'a subtração deu zero (a 2 está na tela e foi lida fora) e a 3 sumiu');
  assert.deepEqual(r.lidas, []);
});

test('R20-5-09 CONTROLE: com a 2 NÃO lida fora a marca já era 1', async () => {
  const r = await p5({ lidoFora: false });
  assert.equal(r.naoVisto, 1);
  assert.deepEqual(r.lidas, []);
});

test('R20-5-09 pela VOLTA: a lista que chega escondida contando só a 3 (a 2 lida no WME) também registra a marca', async () => {
  const r = await p5({ lidoFora: true, volta: true });
  assert.equal(r.naoVisto, 1, 'a volta zerou a conta e a subtração deu zero');
  // (Ir pro fundo paga, com razão, o "lida" da 2 que a tela mostrava — vazio no
  // Waze, que a 2 já foi lida fora. O que não pode é um "lida" que cubra a 3.)
  assert.deepEqual(r.lidas.flat(), [], 'um "lida" cobriu a 3, que a tela nunca teve');
});

test('R20-5-09 a mensagem lida no WME (a lista conta ZERO) não retém o "lida" da próxima vista', async () => {
  // O `naoLidas > 0` é obrigatório: sem ele a última da lista, mais nova que a
  // vista mas já lida lá fora, punha a marca em 1 e a 3, vista ao vivo, voltava
  // como "1 mensagem nova". É o p6 do auditor.
  const w = waze();
  const c = novoCliente({ agora: T + 10, api: w.api });
  w.ligar(c);
  c.P.presencaMontar();
  const add = (n) => { c.relogio.agora += 1000; return w.add(n, c.relogio.agora); };
  add(1); await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick(); fechar(c); await tick(); await tick();
  const ts2 = add(2); w.srv.lidoAte = ts2;             // a 2 chega e é lida no WME (o tempo real não a entrega)
  c.relogio.agora += 70000; await c.P.presencaAtualizar(); await tick();   // a lista: zero, a última dela é mais nova que a vista
  w.srv.abrirOk = false;
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  const h = c.P.Presenca.historico.get(CAF);
  assert.equal(h.naoVistoAoAbrir || 0, 0, 'a lista conta zero: não há mensagem a reter');
  const n3 = add(3); await chega(c, 3, n3); await tick();
  await c.rodarTimers(); await tick(); await tick();
  fechar(c); await tick(); await tick();
  assert.equal(w.srv.lidas.length, 1, 'a 3 foi vista: um "lida" tem que sair');
});

test('R20-5-09 o Waze re-carimba ao guardar: a mensagem que a tela JÁ tem não vira "não vista" por uma diferença de hora', async () => {
  // A 2 chega ao vivo com a hora de ANTES de ele a guardar (335 ms a menos que a
  // da lista). A tela a tem; a marca é 0 e o "lida" da 3 sai.
  const r = await p5({ lidoFora: false, defasagem: 335, volta: false });
  // Aqui a 3 só a lista conhece (naoLidas 2, a 2 e a 3): a marca é 1, pela 3.
  assert.equal(r.naoVisto, 1);
  // O mesmo com a 2 sendo a ÚLTIMA da lista: só ela, já na tela, defasada.
  const w = waze();
  const c = novoCliente({ agora: T + 10, api: w.api });
  w.ligar(c);
  c.P.presencaMontar();
  const add = (n) => { c.relogio.agora += 1000; return w.add(n, c.relogio.agora); };
  add(1); await c.P.presencaAtualizar(); await tick();
  c.P.presencaAbrirConversa(CAF); await tick(); await tick(); fechar(c); await tick(); await tick();
  const ts2 = add(2);
  await chega(c, 2, ts2 - 335); await tick();
  c.relogio.agora += 70000; await c.P.presencaAtualizar(); await tick();   // a lista conta a 2 (naoLidas 1), com a hora do Waze
  w.srv.abrirOk = false;
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();
  const h = c.P.Presenca.historico.get(CAF);
  assert.equal(c.$('conversaMsgs').innerHTML.includes('msg 2'), true, 'CONTROLE: a 2 está na tela');
  assert.equal(h.naoVistoAoAbrir || 0, 0, 'a 2 está na tela: a hora re-carimbada não a faz "não vista"');
  const n3 = add(3); await chega(c, 3, n3); await tick();
  await c.rodarTimers(); await tick(); await tick();
  fechar(c); await tick(); await tick();
  assert.equal(w.srv.lidas.length, 1, 'a 3 foi vista: um "lida" tem que sair');
});

test('R20-5-09 (achado do fuzz) a lista VELHA que chega depois de 3 mensagens vistas ao vivo: as vistas depois dela não comem a não vista que ela conta', async () => {
  // A lista saiu contando só a 1 (que o tempo real nunca entregou). A conversa
  // abre, a primeira página falha, três mensagens chegam e são vistas; só então
  // a lista chega. `naoLidas (1) − vistas (3)` dava zero, a marca ficava 0 e o
  // "lida" da 5 cobria a 1. As vistas que a lista PODE ter contado são as até a
  // régua dela (`ateDaLista`).
  const w = waze();
  const c = novoCliente({ agora: T + 10, api: w.api });
  w.ligar(c);
  c.P.presencaMontar();
  const add = (n) => { c.relogio.agora += 1000; return w.add(n, c.relogio.agora); };
  add(1);                                              // só a lista vai conhecer
  w.srv.segurarLista = true;
  c.P.presencaAtualizar(); await tick();               // a lista sai contando a 1 e fica presa
  w.srv.abrirOk = false;
  c.P.presencaAbrirConversa(CAF); await tick(); await tick();   // a primeira página falha
  for (const n of [2, 3, 4]) { const ts = add(n); await chega(c, n, ts); await tick(); }   // vistas ao vivo
  w.srv.segurarLista = false;
  c.relogio.agora += 300;
  w.srv.presoLista.splice(0).forEach((f) => f()); await tick(); await tick();   // a lista velha chega
  const h = c.P.Presenca.historico.get(CAF);
  assert.equal(c.P.Presenca.conversas.find((x) => x.id === CAF)?.naoLidas, 0, 'CONTROLE: a conversa olhada fica lida na lista');
  assert.equal(h.naoVistoAoAbrir || 0, 1, 'a marca ficou 0: as vistas de DEPOIS da lista comeram a não vista dela');
  const n5 = add(5); await chega(c, 5, n5); await tick();
  await c.rodarTimers(); await tick(); await tick();
  fechar(c); await tick(); await tick();
  assert.equal(w.srv.lidas.flat().includes(1), false, 'o "lida" cobriu a 1, que a tela nunca teve');
});

test('R20-5-09 o comentário não promete o "lado seguro" sem dizer onde ele falha', () => {
  const fonte = readFileSync(new URL('../js/presenca.js', import.meta.url), 'utf8');
  const i = fonte.indexOf('function presencaNaoVistaDaLista');
  assert.ok(i > 0, 'sumiu presencaNaoVistaDaLista');
  const antes = fonte.slice(fonte.lastIndexOf('// Das não lidas que o Waze conta', i), i);
  assert.match(antes, /FALTA quando as vistas foram lidas em outro\s+\/\/\s+aparelho/, 'o comentário não diz que a subtração falta com as vistas lidas fora');
});

// ── R20-5-04: o "Sair" noutra aba chegando por `pageshow`/`visibilitychange`
// na página congelada: a volta da presença roda ANTES de o app.js encerrar a
// aba, e saía um pedido com a sessão que já se foi (e a instalação do chat
// recriava `waze_places_chat`).
function voltaDaPaginaCongelada(c, via) {
  c.relogio.agora += 120_000;      // o teto de 60 s da volta já passou
  if (via === 'pageshow') { for (const fn of c.win._ouv.pageshow || []) fn({ persisted: true }); }
  else { visibilidade(c, 'hidden'); visibilidade(c, 'visible'); }
}

for (const via of ['pageshow', 'visibilitychange']) {
  test(`R20-5-04 (${via}) o "Sair" de outra aba (sem token e sem conta): nenhum pedido sai e a chave do chat não volta`, async () => {
    const c = novoCliente({ agora: T + 10 });
    c.P.presencaMontar();
    await c.P.presencaAtualizar(); await tick();
    // O "Sair" da outra aba limpou o aparelho INTEIRO.
    c.armazenado.delete('waze_session_token'); c.armazenado.delete('waze_places_conta'); c.armazenado.delete('waze_places_chat');
    const antes = c.chamadas.presencaApp.length;
    voltaDaPaginaCongelada(c, via);
    await tick(); await tick();
    assert.equal(c.chamadas.presencaApp.length - antes, 0, 'saiu um pedido com a sessão encerrada');
    assert.equal(c.armazenado.has('waze_places_chat'), false, 'a chave do chat foi recriada depois do "Sair"');
  });

  test(`R20-5-04 (${via}) CONTROLE: com o token no aparelho a volta pede a lista`, async () => {
    const c = novoCliente({ agora: T + 10 });
    c.P.presencaMontar();
    await c.P.presencaAtualizar(); await tick();
    const antes = c.chamadas.presencaApp.length;
    voltaDaPaginaCongelada(c, via);
    await tick(); await tick();
    assert.equal(c.chamadas.presencaApp.length - antes, 1, 'o instrumento não enxerga a volta (sem token ela deveria ter 0 por causa do conserto, não por falha dele)');
  });

  test(`R20-5-04 (${via}) CONTROLE: a QUEDA da sessão guardada noutra aba (sem token, COM a conta) não é o "Sair": a volta segue`, async () => {
    const c = novoCliente({ agora: T + 10 });
    c.P.presencaMontar();
    await c.P.presencaAtualizar(); await tick();
    c.armazenado.delete('waze_session_token');
    c.armazenado.set('waze_places_conta', JSON.stringify({ id: EU, s: 'x' }));
    const antes = c.chamadas.presencaApp.length;
    voltaDaPaginaCongelada(c, via);
    await tick(); await tick();
    assert.equal(c.chamadas.presencaApp.length - antes, 1, 'a aba viva parou de pedir durante a queda da outra (R14-1-03)');
  });
}

test('R20-5-04 nenhum caminho da presença recria `waze_places_chat` com o aparelho encerrado (o escritor é um só)', () => {
  const c = novoCliente({ agora: T + 10 });
  c.armazenado.delete('waze_session_token');
  c.armazenado.delete('waze_places_conta');
  c.P.chatInstalacao();
  c.P.chatConhecer(CAF);
  c.P.chatGuardarAConfirmar(uuid(77));
  c.P.chatMarcarLidaAte(CAF, T + 5);
  assert.equal(c.armazenado.has('waze_places_chat'), false, 'um escritor da chave ignora o "Sair" de outra aba');
  // CONTROLE: com a sessão guardada, o mesmo escritor grava.
  c.armazenado.set('waze_session_token', 'token-de-teste');
  c.P.chatInstalacao();
  assert.equal(c.armazenado.has('waze_places_chat'), true, 'CONTROLE: o instrumento não vê o escritor gravar');
});

test('R20-5-04 a régua do aparelho é a MESMA do `aoSairEmOutraAba` do app.js (token E conta, e o aparelho LÊ)', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const pres = readFileSync(new URL('../js/presenca.js', import.meta.url), 'utf8');
  const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const a = app.indexOf('function aoSairEmOutraAba()');
  assert.ok(a > 0);
  // Lote 25 (R21-1-02): a régua ganhou a pergunta "o aparelho lê?" — a mesma função nos dois lados.
  assert.match(semComentario(app.slice(a, a + 400)),
    /^function aoSairEmOutraAba\(\) \{\s*if \(safeLS\.get\('waze_session_token'\) \|\| safeLS\.get\(CONTA_KEY\)\) return false;\s*if \(!armazenamentoLegivel\(\)\) return false;/);
  const p = pres.indexOf('function presencaAparelhoSaiu()');
  assert.ok(p > 0);
  assert.match(semComentario(pres.slice(p, p + 400)),
    /^function presencaAparelhoSaiu\(\) \{\s*return !safeLS\.get\('waze_session_token'\) && !safeLS\.get\(CONTA_KEY\) && armazenamentoLegivel\(\);\s*\}/);
  // E a guarda está na ENTRADA da volta, antes de qualquer pedido.
  const v = pres.indexOf('function presencaAoVoltar()');
  assert.match(semComentario(pres.slice(v, v + 1200)), /^function presencaAoVoltar\(\) \{\s*if \(presencaAparelhoSaiu\(\)\) return;/);
});

// ── R20-5-05: a folha do pedido que chegou pela conversa (texto do Waze, de
// outro aparelho) fica na direção do TEXTO.
function htmlSemComentario() {
  return readFileSync(new URL('../index.src.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
}

test('R20-5-05 a folha do pedido: nome, endereço e categoria (texto do Waze) têm `dir="auto"`', () => {
  const html = htmlSemComentario();
  for (const id of ['pedidoNome', 'pedidoEnd', 'pedidoCat']) {
    const tag = html.match(new RegExp(`<[a-z0-9]+ id="${id}"[^>]*>`));
    assert.ok(tag, `sumiu #${id} do HTML`);
    assert.match(tag[0], /\sdir="auto"/, `#${id} sem dir="auto"`);
  }
  // CONTROLE do instrumento: um id sem o atributo não passa.
  const tagDe = html.match(/<[a-z0-9]+ id="pedidoDe"[^>]*>/);
  assert.ok(tagDe && !/\sdir=/.test(tagDe[0]), 'o #pedidoDe é frase do app: o nome é isolado no JS, não o `dir`');
});

function abrirPedido(deQuem) {
  const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const fatiar = (nome) => {
    const ini = APP.indexOf('function ' + nome + '(');
    const fim = APP.slice(ini + 1).search(/\n(?:function |async function |const |let )/);
    return APP.slice(ini, ini + 1 + fim);
  };
  const regex = APP.slice(APP.indexOf('const LETRA_DA_DIREITA_PRA_ESQUERDA'), APP.indexOf(';\n', APP.indexOf('const LETRA_DA_DIREITA_PRA_ESQUERDA')) + 2);
  const isolar = new Function(regex + '\n' + fatiar('isolarTextoDoWaze') + '\nreturn isolarTextoDoWaze;')();
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      const attrs = {};
      els.set(id, { id, textContent: '', src: '', href: '', onerror: null, setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; }, removeAttribute(k) { delete attrs[k]; },
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} } });
    }
    return els.get(id);
  };
  const abrir = new Function('document', 'identidadeDoPlace', 't', 'rotuloDeEnum', 'linkWmeDoPedido', 'API', 'openModal', 'isolarTextoDoWaze',
    fatiar('abrirPedidoRecebido') + '\nreturn abrirPedidoRecebido;')(
    { getElementById: el }, (d) => ({ titulo: d.name, tituloEhEndereco: false }), (k, v) => (v ? `${k}${JSON.stringify(v)}` : k), (p, k) => k,
    () => 'https://www.waze.com/editor?env=row&venues=9.9.9', { getRegion: () => 'row' }, () => {}, isolar);
  abrir({ venueID: '1.2.3', name: 'x', address: 'y', categories: [], updateTypeKey: 'IMAGE' }, deQuem);
  return el('pedidoDe').textContent;
}

test('R20-5-05/06 "de {nome}" no cabeçalho do pedido: o nome RTL vai isolado dentro da frase do app; o LTR sai idêntico', () => {
  const rtl = abrirPedido('דני_כהן');
  assert.equal(rtl, 'presenca.pedido.de{"nome":"⁨דני_כהן⁩"}', 'o nome do Waze não foi isolado na frase do app');
  assert.equal(abrirPedido('cafanha'), 'presenca.pedido.de{"nome":"cafanha"}', 'LTR: a frase tem que sair idêntica byte a byte');
  assert.equal(abrirPedido(''), 'presenca.pedido.de{"nome":"presenca.anon"}', 'sem nome, a palavra do app (CONTROLE de que o teste lê o texto)');
});

// ── R20-5-06: a prévia montada pelo app (📍 nome · tipo) com nome RTL.
function previaDaLista(ultima) {
  const c = novoCliente({ agora: T + 10 });
  c.P.Presenca.conversas = [{ id: '997', nome: 'Ana', naoLidas: 1, atividade: T, ultima }];
  c.P.Presenca.online = [];
  c.$('presencaModal').classList.remove('hidden');
  c.P.presencaRenderLista();
  const html = c.$('presencaLista').innerHTML;
  const m = html.match(/<span([^>]*) class="presenca-l2[^"]*">([^<]*)<\/span>/);
  assert.ok(m, 'a prévia não foi desenhada: ' + html.slice(0, 200));
  return { attrs: m[1], texto: m[2].replace(/&#39;/g, "'") };
}

test('R20-5-06 a prévia do pedido com nome RTL: o nome é isolado e o parágrafo fica na direção do app (sem `dir="auto"`)', () => {
  const r = previaDaLista({ deMim: false, ts: T, recibo: false, texto: '', card: { name: 'מסעדה הרצל (סניף 2)', updateTypeKey: 'IMAGE' } });
  assert.match(r.texto, /^📍 ⁨מסעדה הרצל \(סניף 2\)⁩ · /, 'o nome RTL não foi isolado: a primeira letra forte decidia o parágrafo');
  assert.doesNotMatch(r.attrs, /dir=/, 'o `dir="auto"` voltaria a seguir o nome e inverter a frase do app');
});

test('R20-5-06 a função local de isolar é a MESMA do app.js na mesma lista de textos (duas cópias não divergem)', () => {
  const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const i = APP.indexOf('const LETRA_DA_DIREITA_PRA_ESQUERDA');
  const doApp = new Function(APP.slice(i, APP.indexOf(';\n', i) + 2)
    + APP.slice(APP.indexOf('function isolarTextoDoWaze('), APP.indexOf('\n}\n', APP.indexOf('function isolarTextoDoWaze(')) + 3)
    + '\nreturn isolarTextoDoWaze;')();
  const c = novoCliente({ agora: T + 10 });
  const lista = ['Padaria Pão Quente', 'Zé (filial 2)', '', null, undefined, 'Café 24h – Centro', '東京タワー',
    'מסעדת השף – הנמל 12 (סניף 2)', 'مطعم الأصالة (فرع 2)', 'Café שלום', 'ܐܒܓ', 'ހަތް', '\u0590', '\u08FF', '\uFB1D', '\uFDFF', '\uFE70', '\uFEFF'];
  for (const x of lista) assert.equal(c.P.presencaIsolarTextoDoWaze(x), doApp(x), `divergem em ${JSON.stringify(x)}`);
  // CONTROLE: o instrumento enxerga o isolamento (hebraico isolado, latim idêntico).
  assert.equal(doApp('שלום'), '\u2068שלום\u2069');
  assert.equal(doApp('Padaria'), 'Padaria');
});

test('R20-5-06 a prévia do pedido com nome LTR sai idêntica byte a byte (e sem isolar)', () => {
  const ultima = { deMim: false, ts: T, recibo: false, texto: '', card: { name: 'Padaria Estrela (filial 2)', updateTypeKey: 'IMAGE' } };
  const c = novoCliente({ agora: T + 10 });
  const crua = c.P.presencaPrevia(ultima);
  const r = previaDaLista(ultima);
  assert.equal(r.texto, crua.replace(/'/g, "'"), 'LTR: a frase mudou');
  assert.doesNotMatch(r.texto, /[⁦-⁩]/, 'LTR não pode levar marca de isolamento');
  assert.equal(c.P.presencaPrevia(ultima, { isolar: true }), crua, 'LTR: a versão isolada tem que ser a crua');
});

test('R20-5-06 o texto de GENTE (a mensagem, a pergunta que veio com o pedido) segue com `dir="auto"`', () => {
  const msg = previaDaLista({ deMim: false, ts: T, recibo: false, texto: 'שלום מה שלומך היום (סניף 2)', card: null });
  assert.match(msg.attrs, /dir="auto"/, 'a mensagem de texto perdeu o dir="auto"');
  const pergunta = previaDaLista({ deMim: false, ts: T, recibo: false, texto: 'מה דעתך על זה?', card: { name: 'x', updateTypeKey: 'IMAGE' } });
  assert.match(pergunta.attrs, /dir="auto"/, 'a pergunta do pedido perdeu o dir="auto"');
  assert.match(pergunta.texto, /^📍 מה דעתך על זה\?$/, 'CONTROLE: com pergunta a prévia é a pergunta, sem montar o nome');
});

test('R20-5-06 o texto acessível (aria-label) segue sem marca de isolamento', () => {
  const c = novoCliente({ agora: T + 10 });
  c.P.Presenca.conversas = [{ id: '997', nome: 'Ana', naoLidas: 1, atividade: T, ultima: { deMim: false, ts: T, recibo: false, texto: '', card: { name: 'מסעדה', updateTypeKey: 'IMAGE' } } }];
  c.P.Presenca.online = [];
  c.$('presencaModal').classList.remove('hidden');
  c.P.presencaRenderLista();
  const aria = c.$('presencaLista').innerHTML.match(/aria-label="([^"]*)"/)[1];
  assert.doesNotMatch(aria, /[⁦-⁩]/, 'o leitor de tela leria a marca');
});
