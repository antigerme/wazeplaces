// A presença e a conversa depois da auditoria de 2026-09-30 (rodada 5, R5-5):
// o "Lida" na corrida do `abrir` (V2, V2b e V3), o `abrir` na espera do perfil,
// a resposta que chega e não é JSON, a lista que saiu antes do "lida", o "lida"
// que falhou e o foco do ✕ da tirinha. Os rótulos R5-5-n são os do relatório
// dessa rodada.
//
// Mesmo instrumento dos outros: o js/presenca.js roda INTEIRO no navegador de
// mentira do `_presenca-cliente.mjs`, e o api.js de verdade roda numa `vm`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { novoCliente, bytesDeMensagem, bytesDeRecibo, b64 } from './_presenca-cliente.mjs';

const EU = '12444348';
const CAF = '183164343';
const APP = { app: 'wazeplaces' };
const T = 1790300000000;
const tick = () => new Promise((r) => setImmediate(r));
const uuid = (n) => `a0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const inbox = (bytes, n = 1) => ({ inboxMessage: { messageId: uuid(900 + n), messageType: 'X', message: b64(bytes) } });
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
const conversa = (id, nome, atividade, naoLidas = 0) => ({ id, nome, naoLidas, atividade, ultima: null });
// Uma mensagem como o servidor a devolve no `abrir`.
const doWaze = (n, ts, de, texto = 'oi') => ({ id: uuid(n), ts, de: { tipo: 1, id: de }, para: { tipo: 1, id: de === EU ? CAF : EU },
  classe: 'texto', texto, contexto: APP });
const lidas = (c) => c.chamadas.chat.filter((x) => x.acao === 'lida');
const abrirs = (c) => c.chamadas.chat.filter((x) => x.acao === 'abrir');
// Uma promessa que o teste solta quando quer (a resposta "no ar").
function noAr() { let ok; const p = new Promise((r) => { ok = r; }); return { p, ok }; }

// ── R5-5-1: o "Lida" na corrida do `abrir` ──────────────────────────────────

test('R5-5-1 V3: o "lida" do `abrir` não cobre a mensagem guardada com ele NO AR — a rajada a marca (um pedido, só na corrida)', async () => {
  // O servidor lê o histórico e marca como lida EM PARALELO: a mensagem M,
  // guardada depois de o pedido SAIR (T), vem no histórico sem ter sido marcada.
  const caso = async (tsM) => {
    const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir'
      ? { success: true, mensagens: [doWaze(1, T - 60000, CAF, 'antiga'), doWaze(2, tsM, CAF, 'M')], maisAntigas: false, lida: true }
      : { success: true }) } });
    c.P.presencaAbrirConversa(CAF);
    await tick();
    assert.equal(c.P.Presenca.historico.get(CAF).carregada, true, 'CONTROLE: o histórico tem que ter chegado');
    await c.rodarTimers();
    await tick();
    return lidas(c).length;
  };
  assert.equal(await caso(T + 300), 1, 'a mensagem guardada com o `abrir` no ar ficou sem "lida": não lida no Waze, e quem mandou nunca vê "Lida"');
  // CONTROLE: M guardada ANTES de o pedido sair — o `abrir` a cobre, e nada a mais sai.
  assert.equal(await caso(T - 300), 0, 'sem corrida, saiu um "lida" a mais');
});

test('R5-5-1 V3: o corte é a SAÍDA do pedido no relógio do Waze (pelo `desvio`)', async () => {
  // Aparelho 2 min ADIANTADO: o relógio do Waze está 120 s atrás. M foi
  // guardada 300 ms depois de o pedido sair — no relógio do Waze, ou seja
  // ANTES da hora do aparelho: cortada pelo relógio daqui, ela contaria como
  // coberta.
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir'
    ? { success: true, mensagens: [doWaze(2, T - 120000 + 300, CAF, 'M')], maisAntigas: false, lida: true }
    : { success: true }) } });
  c.P.Presenca.desvio = -120000;
  c.P.presencaAbrirConversa(CAF);
  await tick();
  await c.rodarTimers();
  await tick();
  assert.equal(lidas(c).length, 1, 'com o aparelho adiantado, o corte no relógio DAQUI deixou a mensagem da corrida coberta');
});

test('R5-5-1 V2: o recibo que CITA a minha mensagem pelo id a marca como lida, mesmo com hora anterior à dela', async () => {
  const caso = async (citada) => {
    const c = novoCliente({ agora: T });
    const M = { id: uuid(20), ts: T + 300, meu: true, texto: 'M', estado: 'enviada' };
    c.P.Presenca.historico.set(CAF, { msgs: [M], carregada: true, maisAntigas: false });
    // O "lida" que a outra pessoa fez ao abrir a conversa sai com a hora do PEDIDO (T).
    const recibo = await bytesDeRecibo({ id: uuid(21), de: CAF, para: EU, tipo: 'lida', ids: [citada], ts: T });
    c.P.presencaQuadro(fluxoDe(c), inbox(recibo));
    return c.P.presencaEstadoDaMinha(M, c.P.chatLidaAte(CAF), 0);
  };
  assert.equal(await caso(uuid(20)), 'lida', 'a mensagem citada pelo recibo seguiu "Enviada" (o app só olhava a hora)');
  // CONTROLE: o recibo que NÃO cita a mensagem não a marca (a hora dele é anterior).
  assert.equal(await caso(uuid(99)), 'enviada', 'um recibo que não a cita a marcou como lida');
});

test('R5-5-1 V2b: citada ainda SAINDO, ela vira "Lida" quando a hora do Waze chega — pela resposta do `enviar`', async () => {
  const resposta = noAr();
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'enviar' ? resposta.p : { success: true }) } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true, maisAntigas: false });
  c.P.presencaEnviar('M', null);
  const M = c.P.Presenca.historico.get(CAF).msgs[0];
  assert.equal(M.estado, 'enviando', 'CONTROLE: a mensagem tem que estar saindo');
  const recibo = await bytesDeRecibo({ id: uuid(22), de: CAF, para: EU, tipo: 'lida', ids: [M.id], ts: T });
  c.P.presencaQuadro(fluxoDe(c), inbox(recibo));
  resposta.ok({ success: true, id: M.id, ts: T + 300 });
  await tick();
  assert.equal(M.ts, T + 300, 'CONTROLE: a hora do Waze tem que ter chegado na resposta');
  assert.equal(c.P.presencaEstadoDaMinha(M, c.P.chatLidaAte(CAF), 0), 'lida', 'a citada que estava saindo não virou "Lida" com a hora do Waze');
});

test('R5-5-1 V2b: citada ainda SAINDO, ela vira "Lida" quando a hora do Waze chega — pelo eco do tempo real', async () => {
  const resposta = noAr();   // a resposta do `enviar` NÃO chega neste teste: só o eco
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'enviar' ? resposta.p : { success: true }) } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true, maisAntigas: false });
  c.P.presencaEnviar('M', null);
  const M = c.P.Presenca.historico.get(CAF).msgs[0];
  const recibo = await bytesDeRecibo({ id: uuid(23), de: CAF, para: EU, tipo: 'lida', ids: [M.id], ts: T });
  c.P.presencaQuadro(fluxoDe(c), inbox(recibo, 1));
  const eco = await bytesDeMensagem({ id: M.id, de: EU, para: CAF, texto: 'M', ctx: APP, ts: T + 300 });
  c.P.presencaQuadro(fluxoDe(c), inbox(eco, 2));
  assert.equal(M.estado, 'enviada', 'CONTROLE: o eco tem que ter virado a mensagem pra "enviada"');
  assert.equal(c.P.presencaEstadoDaMinha(M, c.P.chatLidaAte(CAF), 0), 'lida', 'a citada que estava saindo não virou "Lida" com o eco');
  resposta.ok({ success: true, id: M.id, ts: T + 300 });
  await tick();
});

// ── R5-5-2: o `abrir` na espera do perfil ───────────────────────────────────

test('R5-5-2 na espera do perfil (a renovação silenciosa), o `abrir` não sai — e o perfil que chega o pede, com as MINHAS mensagens minhas', async () => {
  const hist = [doWaze(1, T - 60000, EU, 'minha pergunta antiga'), doWaze(2, T - 30000, CAF, 'resposta dela')];
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: hist, maisAntigas: false, lida: true } : { success: true }) } });
  c.AppState.profile = null;
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.equal(abrirs(c).length, 0, 'o `abrir` saiu sem saber de quem é a sessão');
  assert.match(c.$('conversaMsgs').innerHTML, /presenca\.conversa\.carregando/, 'a conversa não mostra "Carregando" na espera');
  // O erro do histórico na tela (o 401 que abriu a janela) e o "Tentar de novo":
  // ele também espera, e a tela volta a "Carregando".
  c.P.Presenca.historico.get(CAF).erro = true;
  c.P.presencaCarregarConversa(CAF);
  await tick();
  assert.equal(abrirs(c).length, 0, 'o "Tentar de novo" na espera mandou o `abrir`');
  assert.doesNotMatch(c.$('conversaMsgs').innerHTML, /presenca\.conversa\.erro/, 'o "Tentar de novo" na espera deixou o erro na tela');
  // Um pedido de página ANTIGA sem a primeira na tela espera a primeira.
  c.P.presencaCarregarConversa(CAF, { antes: T - 90000 });
  await tick();
  assert.equal(abrirs(c).length, 0);
  // O perfil volta (a mesma conta): a presença sincroniza e o histórico sai — a primeira página.
  c.AppState.profile = { id: Number(EU), userName: 'antigerme' };
  await c.P.presencaSincronizar();
  await tick();
  assert.equal(abrirs(c).length, 1, 'o perfil voltou e o histórico que esperava não foi pedido');
  assert.equal(abrirs(c)[0].antesDe, undefined, 'o que saiu foi a página antiga, sem a primeira na tela');
  const msgs = c.P.Presenca.historico.get(CAF).msgs;
  assert.deepEqual(msgs.map((m) => [m.texto, m.meu]), [['minha pergunta antiga', true], ['resposta dela', false]]);
  // Uma vez só: o próximo sincronizar não pede de novo.
  await c.P.presencaSincronizar();
  await tick();
  assert.equal(abrirs(c).length, 1, 'o histórico que esperou o perfil saiu de novo a cada sincronizar');
});

test('R5-5-2 com o histórico na tela, o "Ver mensagens anteriores" na espera aguarda o perfil — e sai a página ANTIGA', async () => {
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir'
    ? { success: true, mensagens: [doWaze(x.antesDe ? 1 : 3, x.antesDe ? T - 90000 : T - 1000, CAF, x.antesDe ? 'velha' : 'nova')], maisAntigas: !x.antesDe, lida: true }
    : { success: true }) } });
  c.P.presencaAbrirConversa(CAF);
  await tick();
  assert.equal(abrirs(c).length, 1, 'CONTROLE: com o perfil, a primeira página sai');
  c.AppState.profile = null;
  c.P.presencaCarregarAntigas(CAF);
  await tick();
  assert.equal(abrirs(c).length, 1, 'o "Ver mensagens anteriores" na espera mandou o `abrir`');
  assert.equal(c.P.Presenca.historico.get(CAF).antigas, 'carregando', 'o botão não mostra que está esperando');
  c.AppState.profile = { id: Number(EU), userName: 'antigerme' };
  await c.P.presencaSincronizar();
  await tick();
  assert.equal(abrirs(c).length, 2);
  assert.ok(abrirs(c)[1].antesDe, 'o perfil voltou e a página antiga que esperava não saiu');
});

test('R5-5-2 a sessão cai com o `abrir` NO AR: a resposta é da conta que perguntou — as minhas seguem minhas', async () => {
  const resposta = noAr();
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir' ? resposta.p : { success: true }) } });
  c.P.presencaAbrirConversa(CAF);
  assert.equal(abrirs(c).length, 1, 'CONTROLE: com o perfil, o `abrir` sai');
  c.AppState.profile = null;   // a queda apaga o perfil (a renovação vem depois)
  resposta.ok({ success: true, mensagens: [doWaze(1, T - 60000, EU, 'minha')], maisAntigas: false, lida: true });
  await tick();
  assert.equal(c.P.Presenca.historico.get(CAF).msgs[0].meu, true, 'a minha mensagem virou "dela" porque o perfil sumiu com o pedido no ar');
});

// ── R5-5-4: a lista que saiu antes do "lida" ────────────────────────────────

test('R5-5-4 a lista que SAIU antes de a conversa ser lida, chegando depois de fechá-la, não devolve "1 mensagem nova"', async () => {
  const caso = async ({ listaSaiDepois = false, chegaViva = false, listaLeuAViva = false } = {}) => {
    const lista = noAr();
    const c = novoCliente({ agora: T, api: {
      presencaApp: () => lista.p,
      chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [doWaze(1, T - 1000, CAF, 'M')], maisAntigas: false, lida: true } : { success: true }),
    } });
    c.P.Presenca.pais = 30;
    if (!listaSaiDepois) c.P.presencaAtualizar();          // a pílula pede a lista (lida no Waze com M não lida)
    c.relogio.agora += 100;
    c.P.presencaAbrirConversa(CAF);                       // o `abrir` marca como lida
    await tick();
    c.$('conversaModal').classList.add('hidden');
    c.P.presencaEsquecerAberta();                         // e ela fecha
    if (chegaViva) {
      c.relogio.agora += 100;
      const bytes = await bytesDeMensagem({ id: uuid(5), de: CAF, para: EU, texto: 'nova', ctx: APP, ts: T + 500 });
      c.P.presencaQuadro(fluxoDe(c), inbox(bytes, 5));    // uma mensagem NOVA, depois do "lida"
    }
    if (listaSaiDepois) { c.relogio.agora += 100; c.P.presencaAtualizar(); }
    // `listaLeuAViva`: o servidor demorou a ler a lista no Waze, e ela já viu a
    // mensagem NOVA (a M ele leu lida): conta 1, com a atividade da nova.
    lista.ok({ success: true, online: [], conversas: [conversa(CAF, 'cafanha', listaLeuAViva ? T + 500 : T - 1000, 1)], agora: c.relogio.agora });
    await tick();
    return c.P.presencaNaoLidasDe(CAF);
  };
  assert.equal(await caso(), 0, 'a lista velha devolveu "1 mensagem nova" de uma mensagem já lida no Waze');
  // CONTROLE: a lista que saiu DEPOIS do "lida" vale o que diz.
  assert.equal(await caso({ listaSaiDepois: true }), 1, 'a lista de depois do "lida" deixou de contar');
  // CONTROLE: o que chegou ao vivo DEPOIS do "lida" segue contando, com a lista velha.
  assert.equal(await caso({ chegaViva: true }), 1, 'a mensagem nova, chegada depois do "lida", sumiu da conta');
  // E o "lida" da RAJADA (o `chat/lida` confirmado) vale igual ao do `abrir`.
  {
    const lista = noAr();
    const c = novoCliente({ agora: T, api: {
      presencaApp: () => lista.p,
      chat: (x) => (x.acao === 'abrir' ? { success: true, mensagens: [], maisAntigas: false, lida: true } : { success: true }),
    } });
    c.P.Presenca.pais = 30;
    c.P.Presenca.conversas = [conversa(CAF, 'cafanha', T - 5000, 0)];   // conhecida: sem pedido de nome no meio
    c.P.presencaAbrirConversa(CAF);
    await tick();
    c.relogio.agora += 100;
    c.P.presencaAtualizar();                              // a lista sai…
    c.relogio.agora += 100;
    c.P.presencaQuadro(fluxoDe(c), inbox(await bytesDeMensagem({ id: uuid(6), de: CAF, para: EU, texto: 'M', ctx: APP, ts: T + 150 }), 6));
    await c.rodarTimers();                                // …e o "lida" da rajada sai DEPOIS dela
    await tick();
    c.$('conversaModal').classList.add('hidden');
    c.P.presencaEsquecerAberta();
    lista.ok({ success: true, online: [], conversas: [conversa(CAF, 'cafanha', T + 150, 1)], agora: c.relogio.agora });
    await tick();
    assert.equal(lidas(c).length, 1, 'CONTROLE: o "lida" da rajada tem que ter saído');
    assert.equal(c.P.presencaNaoLidasDe(CAF), 0, 'a lista que saiu antes do "lida" da rajada devolveu "1 mensagem nova"');
  }
  // E a lista velha que já VIU a nova (zerada por ter saído antes do "lida") não
  // serve de régua pra descontá-la: ela seguia contando só pela viva.
  assert.equal(await caso({ chegaViva: true, listaLeuAViva: true }), 1, 'a lista zerada descontou a mensagem nova das vivas: ela sumiu da conta');
});

// ── R5-5-5: o "lida" que falhou ─────────────────────────────────────────────

test('R5-5-5 o "lida" que falhou volta a DEVER: o fechamento o refaz (um pedido a mais, só quando falhou)', async () => {
  const caso = async (falha) => {
    const respostas = [falha, { success: true }];
    const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir'
      ? { success: true, mensagens: [], maisAntigas: false, lida: true }
      : x.acao === 'lida' ? (respostas.shift() || { success: true }) : { success: true }) } });
    c.P.presencaAbrirConversa(CAF);
    await tick();
    const bytes = await bytesDeMensagem({ id: uuid(30), de: CAF, para: EU, texto: 'viu?', ctx: APP, ts: T + 10 });
    c.P.presencaQuadro(fluxoDe(c), inbox(bytes, 30));
    await c.rodarTimers();                                // a rajada manda o "lida"
    await tick();
    const antes = lidas(c).length;
    c.$('conversaModal').classList.add('hidden');
    c.P.presencaEsquecerAberta();                         // fecha
    await tick();
    // A dívida mora em `lidaDevendo` desde o R6-5-1 (o campo da rajada é só dela).
    const devendo = [...c.P.Presenca.lidaDevendo];
    return { antes, depois: lidas(c).length, pendente: c.P.Presenca.lidaPendente || devendo[0] || null };
  };
  const rede = await caso({ success: false, errorCategory: 'transient', _motivo: 'TypeError' });
  assert.equal(rede.antes, 1, 'CONTROLE: a rajada tem que ter mandado o "lida"');
  assert.equal(rede.depois, 2, 'o "lida" que falhou por REDE não foi refeito ao fechar');
  const waze = await caso({ success: false, errorCategory: 'transient' });
  assert.equal(waze.depois, 2, 'o "lida" que falhou com o Waze fora não foi refeito ao fechar');
  assert.equal(waze.pendente, null, 'o refeito deu certo e o pendente ficou');
  // CONTROLE: o "lida" que deu certo não sai de novo ao fechar.
  const ok = await caso({ success: true });
  assert.equal(ok.depois, 1, 'o "lida" que deu certo saiu de novo ao fechar');
});

test('R5-5-5 o "lida" que falha não toma o lugar do da OUTRA conversa, que esperava a rajada', async () => {
  // O "lida" da conversa A no ar; a pessoa fecha A, abre B, chega mensagem em B
  // (a rajada de B corre) — e só então o de A volta com falha.
  const deA = noAr();
  const OUTRA = '555000111';
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir'
    ? { success: true, mensagens: [], maisAntigas: false, lida: true }
    : x.acao === 'lida' && x.com === CAF ? deA.p : { success: true }) } });
  c.P.presencaAbrirConversa(CAF);
  await tick();
  c.P.presencaQuadro(fluxoDe(c), inbox(await bytesDeMensagem({ id: uuid(40), de: CAF, para: EU, texto: 'a', ctx: APP, ts: T + 10 }), 40));
  await c.rodarTimers();                                  // o "lida" de A sai e fica no ar
  c.$('conversaModal').classList.add('hidden');
  c.P.presencaEsquecerAberta();
  c.P.presencaAbrirConversa(OUTRA);
  await tick();
  c.P.presencaQuadro(fluxoDe(c), inbox(await bytesDeMensagem({ id: uuid(41), de: OUTRA, para: EU, texto: 'b', ctx: APP, ts: T + 20 }), 41));
  assert.equal(c.P.Presenca.lidaPendente, OUTRA, 'CONTROLE: a rajada de B tem que estar correndo');
  deA.ok({ success: false, errorCategory: 'transient' });
  await tick();
  await c.rodarTimers();
  await tick();
  assert.equal(lidas(c).filter((x) => x.com === OUTRA).length, 1, 'a falha do "lida" de A tomou o lugar do de B: B ficou não lida');
});

test('R5-5-5 com a conversa AINDA aberta, o "lida" devido sai no próximo `presencaSincronizar`', async () => {
  const respostas = [{ success: false, errorCategory: 'transient' }, { success: true }];
  const c = novoCliente({ agora: T, api: { chat: (x) => (x.acao === 'abrir'
    ? { success: true, mensagens: [], maisAntigas: false, lida: true }
    : x.acao === 'lida' ? (respostas.shift() || { success: true }) : { success: true }) } });
  c.P.presencaAbrirConversa(CAF);
  await tick();
  const bytes = await bytesDeMensagem({ id: uuid(31), de: CAF, para: EU, texto: 'viu?', ctx: APP, ts: T + 10 });
  c.P.presencaQuadro(fluxoDe(c), inbox(bytes, 31));
  await c.rodarTimers();
  await tick();
  assert.equal(lidas(c).length, 1);
  await c.P.presencaSincronizar();
  await tick();
  assert.equal(lidas(c).length, 2, 'o "lida" que falhou não foi refeito com a conversa aberta');
});

// ── R5-5-7: o ✕ da tirinha não leva o foco pro <body> ───────────────────────

test('R5-5-7 o ✕ da tirinha devolve o foco ao botão de prender (que volta a aparecer) — nunca ao <body>', async () => {
  const caso = async (focoNaTirinha) => {
    const c = novoCliente();
    c.win.cardParaConversa = () => ({ venueID: 'v1', updateRequestID: 'u1', name: 'Padaria' });
    c.P.presencaMontar();
    c.P.presencaAbrirConversa(CAF);
    await tick();                                          // o histórico chegou (o redesenho que ele faz já passou)
    c.P.presencaAnexarCard();
    const tirar = c.$('conversaAnexoTirar');
    c.doc.activeElement = focoNaTirinha ? tirar : c.$('qualquerOutro');
    c.$('conversaAnexo').contains = (el) => el === tirar;
    c.$('conversaCardBtn').focado = false;
    tirar.disparar('click');
    c.doc.activeElement = null;
    return { solto: c.P.Presenca.anexo === null, botaoVisivel: !c.$('conversaCardBtn').classList.contains('hidden'),
      focoNoBotao: !!c.$('conversaCardBtn').focado };
  };
  const r = await caso(true);
  assert.equal(r.solto, true, 'CONTROLE: o ✕ tem que soltar o pedido');
  assert.equal(r.botaoVisivel, true, 'CONTROLE: o botão de prender tem que voltar');
  assert.equal(r.focoNoBotao, true, 'o foco que estava no ✕ da tirinha caiu no <body>');
  // CONTROLE: com o foco fora da tirinha (o toque), ninguém mexe no foco.
  assert.equal((await caso(false)).focoNoBotao, false, 'o ✕ puxou o foco de quem não estava na tirinha');
});

// ── R5-5-3: a resposta que CHEGA e não é JSON ───────────────────────────────

// O api.js DE VERDADE numa vm, com o `fetch` que o teste escolhe.
function apiDeVerdade(fetch) {
  const fonte = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8') + '\n'
    + readFileSync(new URL('../js/api.js', import.meta.url), 'utf8') + '\nthis.API = API;';
  const ctx = { navigator: { language: 'pt-BR', onLine: true }, document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: (k) => (k === 'waze_session_token' ? 'tok' : null), setItem() {}, removeItem() {} },
    fetch, performance, AbortController, Response, ReadableStream, console: { error() {}, log() {}, warn() {} }, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx);
  let provas = 0;
  ctx.API.aoProvarRede = () => { provas += 1; };
  return { API: ctx.API, provas: () => provas };
}
const HTML_502 = '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>error code: 502</body></html>';
const HTML_429 = '<!DOCTYPE html><html><body>Error 1027: This website has been temporarily rate limited</body></html>';

test('R5-5-3 o `_post` de verdade: a resposta que CHEGA e não é JSON não leva `_motivo` — só a que não chegou', async () => {
  for (const [status, corpo] of [[502, HTML_502], [429, HTML_429]]) {
    const a = apiDeVerdade(async () => new Response(corpo, { status, headers: { 'content-type': 'text/html' } }));
    const r = await a.API.chat({ acao: 'enviar' });
    assert.equal(r.errorCategory, 'transient', `HTTP ${status} HTML deixou de ser transiente`);
    assert.equal('_motivo' in r, false, `HTTP ${status} HTML (a resposta CHEGOU) veio marcado como "sem resposta"`);
    // A fila de saída lê `httpCode` como o status do WAZE pra aquele pedido
    // (um 5xx a manda pro fim e conta tentativa): o da borda não pode entrar.
    assert.equal('httpCode' in r, false, 'o status da BORDA entrou como `httpCode` — a fila de saída o leria como o Waze recusando o pedido');
    assert.equal(a.provas(), 0, 'a resposta não-JSON passou a contar como prova de rede (o comportamento de antes era não contar)');
    const reg = a.API.chamadas.slice(-1)[0];
    assert.equal(reg && reg.http, status, 'o registro de chamadas perdeu o status real');
  }
  // CONTROLES: a que não chegou segue marcada — o `fetch` que falha e o corpo cortado no meio.
  const semRede = apiDeVerdade(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(typeof (await semRede.API.chat({ acao: 'enviar' }))._motivo, 'string', 'a falha sem resposta perdeu o `_motivo`');
  const cortado = apiDeVerdade(async () => new Response(new ReadableStream({ start(c) { c.error(new TypeError('network error')); } }), { status: 200 }));
  assert.equal(typeof (await cortado.API.chat({ acao: 'enviar' }))._motivo, 'string', 'o corpo cortado no meio deixou de ser "sem resposta"');
});

test('R5-5-3 de ponta a ponta: com o HTML da borda, a conversa diz "Não enviada." e a lista obedece ao teto de um por minuto', async () => {
  const borda = apiDeVerdade(async () => new Response(HTML_502, { status: 502, headers: { 'content-type': 'text/html' } }));
  const resposta = await borda.API.presencaApp({ pais: 30 });
  // A frase: o que o `_post` devolve vai pra conversa.
  const c = novoCliente({ api: { chat: () => resposta } });
  c.P.Presenca.aberta = CAF;
  c.$('conversaModal').classList.remove('hidden');
  c.P.Presenca.historico.set(CAF, { msgs: [], carregada: true, maisAntigas: false });
  c.P.presencaEnviar('teste', null);
  await tick();
  const m = c.P.Presenca.historico.get(CAF).msgs[0];
  assert.equal(m.estado, 'falhou');
  assert.equal(m.motivo, 'erro', 'com a rede boa e a borda respondendo 502, a conversa disse "sem conexão"');
  // O teto: 4 voltas do segundo plano em 40 s, com a lista respondendo o HTML.
  const d = novoCliente({ api: { presencaApp: () => resposta } });
  d.P.Presenca.chat = { token: 't', base: 'https://x/', chave: 'k', expiraEm: d.relogio.agora + 86_000_000 };
  for (let i = 0; i < 4; i++) { d.P.presencaAoVoltar(); await tick(); await tick(); d.relogio.agora += 10_000; }
  assert.equal(d.chamadas.presencaApp.length, 1, 'com o HTML da borda, cada volta do segundo plano pediu a lista de novo');
});

test('R5-5-3 os leitores de `_motivo` são só os da presença (conferidos acima) — leitor novo passa por aqui', () => {
  // A marca mudou de sentido pra resposta não-JSON: quem a lê precisa ter sido
  // conferido. Hoje são três na presença (pelo `presencaSemResposta`), o
  // desligar da presença no WME e a marca do lie-fi da busca (`buscaSemResposta`,
  // R6-4-3, conferida em test/offline-varredura); o `api.js` só a escreve. A
  // pergunta de "Minha área" ao servidor aplicado à mão (`lerServidorDaMinhaArea`)
  // deixou de ler: desde o R11-6-01 só a resposta BOA vale pela ida, e a falha —
  // com ou sem resposta — não vale (conferida em test/minha-area).
  const leitores = [];
  for (const arq of ['api.js', 'app.js', 'presenca.js', 'i18n.js', 'swipe.js', 'mapa.js', 'qr.js', 'sw-register.js', 'version.js']) {
    let fonte;
    try { fonte = readFileSync(new URL('../js/' + arq, import.meta.url), 'utf8'); } catch (e) { continue; }
    fonte.split('\n').forEach((l, i) => {
      if (/^\s*\/\//.test(l) || !/_motivo/.test(l)) return;
      leitores.push(`${arq}:${/_motivo:/.test(l) ? 'escreve' : 'lê'}`);
    });
  }
  assert.deepEqual(leitores.sort(), ['api.js:escreve', 'app.js:lê', 'app.js:lê', 'presenca.js:lê'].sort(),
    `apareceu um leitor (ou escritor) novo de \`_motivo\`: ${leitores.join(', ')} — confira se ele quer "a resposta NEM chegou"`);
});
