// A presença e a conversa depois da auditoria de 2026-10-02 (rodada 7, R7-5):
// a dívida do "lida" paga marcando a mensagem que só a LISTA conhecia e
// ninguém viu, a lista devolvendo a mensagem VISTA como "1 mensagem nova"
// enquanto há dívida, o "invisível" que só era gravado quando a falha voltava,
// a lista de carona entrando com o instante da RESPOSTA e o "lida" da rajada
// perdido quando o app vai pro fundo. Os rótulos R7-5-n são os do relatório
// dessa rodada. Cada teste foi visto REPROVANDO com o conserto desfeito.
//
// Dois instrumentos, como no `presenca-auditoria-r6`: o js/presenca.js INTEIRO
// no navegador de mentira do `_presenca-cliente.mjs`, e as funções do app.js
// FATIADAS e rodadas num escopo de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { novoCliente, bytesDeMensagem, b64 } from './_presenca-cliente.mjs';

const EU = '12444348';
const CAF = '183164343';
const OUTRA = '555000111';
const APP_CTX = { app: 'wazeplaces' };
const T = 1790400000000;
const tick = () => new Promise((r) => setImmediate(r));
const uuid = (n) => `b0000000-0000-1000-8000-${String(n).padStart(12, '0')}`;
const inbox = (bytes, n = 1) => ({ inboxMessage: { messageId: uuid(900 + n), messageType: 'X', message: b64(bytes) } });
const fluxoDe = (c) => ({ ctl: new AbortController(), emLote: false, epoca: c.P.Presenca.epoca, desde: 0, vivoEm: 0 });
const lidas = (c, com) => c.chamadas.chat.filter((x) => x.acao === 'lida' && (!com || x.com === com));
// A mensagem `n` da CAF, com a hora `T + n` (a do Waze), chegando pelo tempo real.
const chega = async (c, n, de = CAF) => c.P.presencaQuadro(fluxoDe(c),
  inbox(await bytesDeMensagem({ id: uuid(n), de, para: EU, texto: 'msg ' + n, ctx: APP_CTX, ts: T + n }), n));
const fechar = (c) => { c.$('conversaModal').classList.add('hidden'); c.P.presencaEsquecerAberta(); };
const SEM_REDE = { success: false, errorCategory: 'transient', _motivo: 'TypeError' };

// O Waze de mentira, com a conversa da CAF guardada nele: as mensagens DELA
// (a `n` tem a hora `T + n`), quais seguem NÃO LIDAS, e a lista de conversas
// montada do que ele guarda, como o de verdade — a ÚLTIMA mensagem da conversa
// (dela, minha ou um recibo) e quantas dela seguem não lidas. O "lida" (e o
// `abrir`) marca a conversa INTEIRA, o `MarkConversationRead`. `segurar`
// prende o primeiro "lida" no ar até o teste soltar.
function comWaze({ segurar = false } = {}) {
  const rede = { fora: false };
  const dela = [];
  const extra = { minha: null, recibo: null };
  const preso = { soltar: null };
  const marcar = (com) => { if (com === CAF) for (const m of dela) m.lida = true; };
  function conversaDaCaf() {
    const todas = [
      ...dela.map((m) => ({ deMim: false, ts: m.ts, recibo: false })),
      ...(extra.minha ? [{ deMim: true, ts: extra.minha, recibo: false }] : []),
      ...(extra.recibo ? [{ deMim: false, ts: extra.recibo, recibo: true }] : []),
    ].sort((a, b) => b.ts - a.ts);
    const u = todas[0] || null;
    return { id: CAF, nome: 'cafanha', naoLidas: dela.filter((m) => !m.lida).length, atividade: u ? u.ts : 0,
      ultima: u ? { ...u, texto: 'x', card: null } : null };
  }
  const c = novoCliente({ agora: T, api: {
    chat: (x) => {
      if (x.acao === 'abrir') { marcar(x.com); return { success: true, mensagens: [], maisAntigas: false, lida: true }; }
      if (x.acao === 'lida') {
        if (segurar && !preso.usado && x.com === CAF) {
          preso.usado = true;
          return new Promise((ok) => { preso.soltar = (r) => { if (r && r.success) marcar(x.com); ok(r); }; });
        }
        if (rede.fora) return SEM_REDE;
        marcar(x.com);
        return { success: true };
      }
      return { success: true };
    },
    presencaApp: () => ({ success: true, online: [], agora: c.relogio.agora, conversas: [conversaDaCaf()] }),
  } });
  // Conhecida desde o começo: a primeira mensagem dela não pede o nome no meio.
  c.P.Presenca.conversas = [conversaDaCaf()];
  return {
    c, rede, preso,
    guardar: (n) => dela.push({ n, ts: T + n, lida: false }),
    lerNoWme: () => marcar(CAF),                            // a pessoa leu pelo WME, noutro aparelho
    responder: (n) => { extra.minha = T + n; },
    recibo: (n) => { extra.recibo = T + n; },
    naoLida: (n) => dela.some((m) => m.n === n && !m.lida),
    lista: () => ({ online: [], conversas: [conversaDaCaf()] }),
  };
}

// A conversa com a CAF aberta, a mensagem 1 dela VISTA, e o "lida" falhando na
// rajada E no fechamento: a dívida fica, com a mensagem 1 não lida no Waze.
async function comDivida(w) {
  const { c } = w;
  c.P.presencaAbrirConversa(CAF);
  await tick();
  w.rede.fora = true;
  w.guardar(1);
  await chega(c, 1);                                        // a 1, NA TELA
  await c.rodarTimers();                                    // a rajada: falha
  await tick();
  fechar(c);                                                // o fechamento paga… e falha de novo
  await tick();
  w.rede.fora = false;                                      // o sinal volta
  assert.deepEqual([...c.P.Presenca.lidaDevendo], [CAF], 'CONTROLE: tem que haver a dívida');
  assert.equal(lidas(c, CAF).length, 2, 'CONTROLE: a rajada e o fechamento tinham que ter tentado (e falhado)');
  assert.equal(w.naoLida(1), true, 'CONTROLE: a mensagem vista segue não lida no Waze');
}

// A lista nova (o toque na pílula, a volta do fundo): passado o teto de um minuto.
async function listaNova(c) {
  c.relogio.agora += 61_000;
  await c.P.presencaAtualizar();
  await tick();
}

// Abrir e fechar a conversa com OUTRA pessoa: o fechamento paga as dívidas.
async function fecharOutra(c) {
  c.P.presencaAbrirConversa(OUTRA);
  await tick();
  fechar(c);
  await tick();
}

// ── R7-5-01: a dívida não marca a mensagem que só a LISTA conhece ───────────

test('R7-5-01 a lista que traz mensagem DELA mais nova que a última vista tira a dívida — fechar outra conversa e o `presencaSincronizar` não a marcam como lida', async () => {
  const w = comWaze();
  await comDivida(w);
  w.guardar(2);                                             // a 2 chega ao Waze; o tempo real está fora
  await listaNova(w.c);
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [], 'DEFEITO: a lista contou uma mensagem nova e a dívida ficou — pagá-la marca a que ninguém viu');
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 2, 'a conta da lista (a nova e a vista, que o Waze segue contando) sumiu');
  await fecharOutra(w.c);
  await w.c.P.presencaSincronizar();
  await tick();
  assert.equal(lidas(w.c, CAF).length, 2, 'DEFEITO: o "lida" da conversa inteira saiu com a mensagem 2, que ninguém viu');
  assert.equal(w.naoLida(2), true, 'DEFEITO: a mensagem 2 (não vista) foi marcada como lida no Waze');
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 2, 'a não lida sumiu daqui sem ninguém ter visto');
});

test('R7-5-01 CONTROLE: sem mensagem nova, a dívida fica — e o fechamento de outra conversa a paga', async () => {
  const w = comWaze();
  await comDivida(w);
  await listaNova(w.c);
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [CAF], 'a lista sem mensagem nova tirou a dívida — a vista ficaria não lida');
  await fecharOutra(w.c);
  assert.equal(lidas(w.c, CAF).length, 3, 'o fechamento de outra conversa não pagou a dívida');
  assert.equal(w.naoLida(1), false, 'a mensagem vista seguiu não lida no Waze');
  assert.equal(w.c.P.Presenca.lidaDevendo.size, 0);
});

test('R7-5-01 a lista conta mais não lidas do que as vistas, com a ÚLTIMA mensagem sendo MINHA — a dívida também sai', async () => {
  const w = comWaze();
  await comDivida(w);
  w.guardar(2);                                             // a 2 dela, que não chegou aqui…
  w.responder(3);                                           // …e a minha resposta depois: a última é MINHA
  await listaNova(w.c);
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [], 'DEFEITO: a lista conta 2 não lidas, a pessoa viu 1, e a dívida ficou');
  await w.c.P.presencaSincronizar();
  await tick();
  assert.equal(w.naoLida(2), true, 'a mensagem 2 (não vista) foi marcada como lida no Waze');
  // CONTROLE: só a minha resposta depois da vista — a conta é a da vista, e a dívida fica.
  const s = comWaze();
  await comDivida(s);
  s.responder(3);
  await listaNova(s.c);
  assert.deepEqual([...s.c.P.Presenca.lidaDevendo], [CAF], 'a resposta minha (sem mensagem nova dela) tirou a dívida');
  assert.equal(s.c.P.presencaNaoLidasDe(CAF), 0, 'a mensagem vista voltou como "1 mensagem nova" (R7-5-02, a última sendo minha)');
});

test('R7-5-01 lida pelo WME noutro aparelho, e chega a 2: a lista conta só ela — a dívida sai e a conta NÃO é zerada', async () => {
  // A conta da lista (1) não passa das vistas sem confirmar (1, a vista): quem
  // denuncia a nova é a ÚLTIMA mensagem, dela e mais nova que a vista. Zerar
  // aqui escondia justamente a mensagem que ninguém viu (o R7-5-02 do avesso).
  const w = comWaze();
  await comDivida(w);
  w.lerNoWme();
  w.guardar(2);
  await listaNova(w.c);
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 1, 'DEFEITO: a mensagem 2 (não vista) sumiu da conta — a lista foi zerada pela dívida');
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [], 'DEFEITO: a dívida ficou com uma mensagem nova que a pessoa não viu');
  await fecharOutra(w.c);
  assert.equal(w.naoLida(2), true, 'a mensagem 2 (não vista) foi marcada como lida no Waze');
});

test('R7-5-01 um RECIBO dela como última da conversa não é mensagem nova: a dívida fica, e a vista não volta como nova', async () => {
  const w = comWaze();
  await comDivida(w);
  w.recibo(5);                                              // o "lida" dela de uma mensagem minha, depois da vista
  await listaNova(w.c);
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [CAF], 'DEFEITO: o recibo contou como mensagem não vista e a dívida saiu');
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 0);
  await fecharOutra(w.c);
  assert.equal(w.naoLida(1), false, 'a dívida não foi paga');
});

test('R7-5-01 a lista que chegou ANTES de a dívida nascer (com a conversa na tela) é conferida na hora de pagar', async () => {
  const caso = async (comNova) => {
    const w = comWaze();
    const { c } = w;
    c.P.presencaAbrirConversa(CAF);
    await tick();
    w.rede.fora = true;
    w.guardar(1);
    await chega(c, 1);                                      // a 1, na tela: a rajada corre
    if (comNova) w.guardar(2);                              // a 2 chega ao Waze; o tempo real não a traz
    await listaNova(c);                                     // a lista chega com a conversa na tela
    await c.rodarTimers();                                  // a rajada falha: a dívida nasce DEPOIS da lista
    await tick();
    assert.deepEqual([...c.P.Presenca.lidaDevendo], [CAF], 'CONTROLE: a dívida tem que ter nascido');
    w.rede.fora = false;
    fechar(c);                                              // o fechamento paga as dívidas
    await tick();
    return { lidas: lidas(c, CAF).length, nova: w.naoLida(2), vista: w.naoLida(1) };
  };
  const r = await caso(true);
  assert.equal(r.lidas, 1, 'DEFEITO: o fechamento pagou a dívida com a lista dizendo que havia mensagem nova');
  assert.equal(r.nova, true, 'DEFEITO: a mensagem 2 (não vista) foi marcada como lida no Waze');
  // CONTROLE: sem a mensagem nova, o fechamento paga.
  const s = await caso(false);
  assert.equal(s.lidas, 2, 'o fechamento deixou de pagar a dívida');
  assert.equal(s.vista, false);
});

test('R7-5-01 a mensagem que chega com o "lida" no ar e a conversa FECHADA não deixa a dívida nascer — pagá-la marcaria essa também', async () => {
  const caso = async (comNova) => {
    const w = comWaze({ segurar: true });
    const { c } = w;
    c.P.presencaAbrirConversa(CAF);
    await tick();
    w.guardar(1);
    await chega(c, 1);                                      // a 1, na tela
    await c.rodarTimers();                                  // o "lida" da rajada sai… e fica no ar
    await tick();
    fechar(c);                                              // a pessoa fecha a conversa
    await tick();
    if (comNova) { w.guardar(2); await chega(c, 2); }       // a 2 chega pelo tempo real, fora da vista
    w.preso.soltar(SEM_REDE);                               // e só então o "lida" volta, com falha
    await tick();
    const devendo = [...c.P.Presenca.lidaDevendo];
    await c.P.presencaSincronizar();                        // o próximo gatilho que paga as dívidas
    await tick();
    return { devendo, nova: w.naoLida(2), vista: w.naoLida(1), naoLidas: c.P.presencaNaoLidasDe(CAF) };
  };
  const r = await caso(true);
  assert.deepEqual(r.devendo, [], 'DEFEITO: a dívida nasceu com uma mensagem que a pessoa não viu');
  assert.equal(r.nova, true, 'DEFEITO: a mensagem 2 (não vista) foi marcada como lida no Waze');
  assert.ok(r.naoLidas >= 1, 'a não lida sumiu daqui');
  // CONTROLE: sem a mensagem nova, a dívida nasce e o próximo gatilho a paga.
  const s = await caso(false);
  assert.deepEqual(s.devendo, [CAF], 'sem mensagem nova, a falha deixou de virar dívida');
  assert.equal(s.vista, false, 'a dívida não foi paga');
});

test('R7-5-01 o `presencaSincronizar` paga a dívida DEPOIS da lista que ele pede — paga antes, ela marcava a mensagem que só essa lista conta', async () => {
  const w = comWaze();
  await comDivida(w);
  w.guardar(2);                                             // a 2 chega ao Waze; a lista daqui ainda não a conhece
  w.c.relogio.agora += 61_000;                              // a lista não está fresca: o sincronizar pede uma
  await w.c.P.presencaSincronizar();
  await tick();
  assert.equal(w.c.chamadas.presencaApp.length, 1, 'CONTROLE: o sincronizar tinha que pedir a lista');
  assert.equal(w.naoLida(2), true, 'DEFEITO: a dívida foi paga antes da lista — a mensagem 2 (não vista) foi marcada');
  assert.equal(lidas(w.c, CAF).length, 2);
  // CONTROLE: sem a mensagem nova, a lista que ele pede não impede: a dívida sai.
  const s = comWaze();
  await comDivida(s);
  s.c.relogio.agora += 61_000;
  await s.c.P.presencaSincronizar();
  await tick();
  assert.equal(s.naoLida(1), false, 'o sincronizar deixou de pagar a dívida');
});

// ── R7-5-02: com a dívida, a lista vale ZERO pra mensagem que a pessoa viu ───

test('R7-5-02 com a dívida, a lista de CARONA não devolve a mensagem VISTA como "1 mensagem nova" — e não pede nada', async () => {
  const w = comWaze();
  await comDivida(w);
  const pilula = () => ({ escondida: w.c.$('presencaPill').classList.contains('hidden'),
    balao: !w.c.$('presencaIconMsg').classList.contains('hidden'), selo: w.c.$('presencaCount').textContent });
  for (let i = 0; i < 2; i++) {                             // duas ações ✕ com a lista de carona
    w.c.relogio.agora += 40_000;
    w.c.P.presencaAoCarona(w.lista(), w.c.relogio.agora - 100, 30);
    await tick();
    assert.equal(w.c.P.presencaNaoLidasDe(CAF), 0, 'DEFEITO: a mensagem vista voltou como "1 mensagem nova"');
    assert.deepEqual(pilula(), { escondida: true, balao: false, selo: '' }, 'a pílula virou balão com a mensagem vista');
  }
  assert.equal(lidas(w.c, CAF).length, 2, 'a lista de carona pediu um "lida" (é por swipe: nada sai daqui)');
  assert.deepEqual([...w.c.P.Presenca.lidaDevendo], [CAF], 'a dívida tinha que seguir esperando o fechamento');
  // E a da pílula (o pedido da lista) também.
  await listaNova(w.c);
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 0);
  // CONTROLE: a lista com mensagem NOVA não é zerada (o R7-5-01).
  w.guardar(2);
  w.c.relogio.agora += 40_000;
  w.c.P.presencaAoCarona(w.lista(), w.c.relogio.agora - 100, 30);
  await tick();
  assert.equal(w.c.P.presencaNaoLidasDe(CAF), 2, 'a mensagem nova (não vista) sumiu da conta');
});

// ── O app.js, fatiado ────────────────────────────────────────────────────────

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', i); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) {
      const corpo = APP_SEM.slice(m.index, j + 1);
      assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
function montar(nomes, deps) {
  const chaves = Object.keys(deps);
  return new Function(...chaves, nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(...chaves.map((k) => deps[k]));
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};
const espera = () => new Promise((r) => setTimeout(r, 0));

// ── R7-5-03: o "invisível" é GRAVADO no gesto, antes de sair ─────────────────

// Um aparelho: o armazenamento sobrevive à "página" e é o mesmo pras ABAS; a
// memória (presencaWme, AppState) é de cada uma. Cada `pagina()` é uma aba (ou
// uma abertura nova). `resposta` responde o `presenca-waze` — uma promessa que
// nunca volta é o pedido PENDURADO do sinal fraco.
function aparelho() {
  const guardado = new Map();
  const localStorage = {
    getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
    setItem: (k, v) => guardado.set(k, String(v)),
    removeItem: (k) => guardado.delete(k),
  };
  const pedidos = [];
  const relogio = { agora: T };
  return {
    guardado, pedidos, relogio,
    gravado: () => (JSON.parse(guardado.get('waze_places_preferences') || '{}').presencaWmeDesligar || null),
    pagina({ nome = 'aba', perfil = { id: Number(EU) }, resposta = () => ({ success: true }), sessao = { token: 'tok' } } = {}) {
      const AppState = { preferences: { undoEnabled: true, semUndoSeguidas: 0, presenca: true, pularGuarda: false }, profile: perfil };
      const presencaWme = { ligarNaProxima: false, desligarPendente: false, desligarEm: 0, desligarSessao: null, desligarVez: 0, desligarNoAr: 0 };
      const deps = {
        AppState, presencaWme, localStorage, PREFERENCES_KEY: constante('PREFERENCES_KEY'),
        preferenciasCarregadas: true, CONTA_KEY: constante('CONTA_KEY'),
        PRESENCA_WME_DESLIGAR_REPETIR_MS: constante('PRESENCA_WME_DESLIGAR_REPETIR_MS'),
        safeLS: { get: (k) => localStorage.getItem(k) },
        dfato: () => {}, Date: { now: () => relogio.agora },
        API: { getSession: () => sessao.token, presencaWaze: async (c) => { pedidos.push({ aba: nome, ...c }); return resposta(c); } },
        // O que a releitura de OUTRA aba redesenha: aqui, nada.
        desenharChavesDePreferencia: () => {}, atualizarSeloDePular: () => {}, atualizarLinhaDoOffline: () => {},
        offlineEsquecer: () => {}, window: { Presenca: { desligar: () => {}, renderPilula: () => {} } },
      };
      const h = montar(['marcaDaSessao', 'savePreferences', 'lerPreferenciasGuardadas', 'preferenciasDeFabrica',
        'relerPreferenciasDeOutraAba', 'presencaWmeDesligar', 'presencaWmeGravarPendente', 'presencaWmeEsquecerGravado',
        'presencaWmeAnotarDesligar', 'presencaWmeRefazerDesligar', 'presencaWmeReligar', 'presencaWmeZerar'], deps);
      h.lerPreferenciasGuardadas();
      // O gesto, na ordem do ouvinte do interruptor (`prefPresenca`).
      const desligar = () => { AppState.preferences.presenca = false; AppState.preferences.presencaOffEm = relogio.agora; h.presencaWmeDesligar(); h.savePreferences(); };
      const religar = () => { AppState.preferences.presenca = true; delete AppState.preferences.presencaOffEm; h.presencaWmeReligar(); h.savePreferences(); };
      return { ...h, AppState, presencaWme, sessao, desligar, religar };
    },
  };
}
const pendurado = () => new Promise(() => {});

test('R7-5-03 o "invisível" com o pedido PENDURADO (sinal fraco) e o app fechado antes da resposta: gravado no gesto, sai na reabertura', async () => {
  const a = aparelho();
  const p1 = a.pagina({ resposta: pendurado });
  p1.desligar();
  await espera();
  assert.deepEqual(Object.keys(a.gravado() || {}), ['conta', 'em'], 'DEFEITO: com o pedido no ar, nada ficou gravado — fechar o app perde o gesto');
  assert.equal(a.gravado().conta, EU);
  // O app fecha (o pedido morre com a página) e abre de novo com rede, a mesma conta.
  const p2 = a.pagina({ resposta: () => ({ success: true }) });
  assert.equal(p2.AppState.preferences.presenca, false, 'CONTROLE: a reabertura tem que ler o interruptor desligado');
  p2.presencaWmeRefazerDesligar();                          // o `definirPerfil` chama isto quando o perfil chega
  await espera();
  assert.deepEqual(a.pedidos.slice(1).map(({ aba, ...c }) => c), [{ userId: EU, visivel: false }],
    'DEFEITO: a reabertura não mandou o "invisível" — a pessoa segue visível no WME contra o gesto');
  assert.equal(a.gravado(), null, 'o "invisível" chegou e ficou gravado (sairia de novo na próxima abertura)');
});

test('R7-5-03 com o envio no AR, a prova de rede não manda de novo nem adota o gravado — e a resposta boa o apaga', async () => {
  const a = aparelho();
  let soltar = null;
  const p = a.pagina({ resposta: () => new Promise((ok) => { soltar = ok; }) });
  p.desligar();
  await espera();
  assert.ok(a.gravado(), 'CONTROLE: gravado no gesto');
  for (let i = 0; i < 3; i++) {                             // as respostas dos swipes, com o "invisível" no ar
    a.relogio.agora += 10_000;
    p.presencaWmeRefazerDesligar();
    await espera();
  }
  assert.equal(a.pedidos.length, 1, 'a repetição saiu com o envio no ar');
  assert.equal(p.presencaWme.desligarPendente, false, 'DEFEITO: a prova de rede adotou o gravado do envio no ar');
  soltar({ success: true });
  await espera();
  assert.equal(a.gravado(), null, 'DEFEITO: a resposta boa não apagou o gravado');
  a.relogio.agora += 61_000;
  p.presencaWmeRefazerDesligar();
  await espera();
  assert.equal(a.pedidos.length, 1, 'DEFEITO: o mesmo "invisível" saiu de novo depois da resposta boa');
});

test('R7-5-03 o envio que nem volta (a promessa rejeitada) não segura a repetição pra sempre', async () => {
  // Hoje o `_post` não rejeita (devolve o erro); o `.catch` é a defesa pro dia
  // em que rejeitar — sem ele, o "envio no ar" nunca terminaria.
  const a = aparelho();
  const p = a.pagina({ resposta: () => Promise.reject(new Error('caiu')) });
  p.desligar();
  await espera();
  assert.ok(a.gravado(), 'CONTROLE: gravado no gesto');
  a.relogio.agora += 61_000;
  p.presencaWmeRefazerDesligar();
  await espera();
  assert.equal(a.pedidos.length, 2, 'DEFEITO: o envio que rejeitou ficou "no ar" pra sempre — o "invisível" não sai mais');
});

test('R7-5-03 a OUTRA aba herda o gravado: com a do gesto fechada e o pedido no ar, a prova de rede de lá o manda', async () => {
  const a = aparelho();
  const gesto = a.pagina({ nome: 'gesto', resposta: pendurado });
  const outra = a.pagina({ nome: 'outra' });
  gesto.desligar();                                         // e esta aba fecha com o pedido no ar
  await espera();
  outra.relerPreferenciasDeOutraAba();                      // o aviso `storage` chega à outra aba
  assert.equal(outra.AppState.preferences.presenca, false, 'CONTROLE: a outra aba tem que ler o interruptor desligado');
  outra.presencaWmeRefazerDesligar();                       // a próxima resposta da API, lá
  await espera();
  assert.deepEqual(a.pedidos.filter((x) => x.aba === 'outra').map(({ aba, ...c }) => c), [{ userId: EU, visivel: false }],
    'DEFEITO: a outra aba zerou o pendente supondo que o "invisível" já tinha saído — ninguém o mandou');
  assert.equal(a.gravado(), null, 'a resposta boa da outra aba não apagou o gravado');
});

test('R7-5-03 a resposta de um envio ANTERIOR não decide o gravado do envio que está no ar', async () => {
  // (a) O anterior volta BEM depois de religar e desligar de novo: o gravado do
  // envio no ar fica — e sai na reabertura, se o app fechar com ele no ar.
  const a = aparelho();
  const soltar = [];
  const p = a.pagina({ resposta: () => new Promise((ok) => soltar.push(ok)) });
  p.desligar();
  p.religar();
  p.desligar();
  await espera();
  assert.equal(a.pedidos.length, 2, 'CONTROLE: dois envios no ar');
  soltar[0]({ success: true });
  await espera();
  assert.ok(a.gravado(), 'DEFEITO: a resposta do envio anterior apagou o gravado do envio no ar');
  const p2 = a.pagina();
  p2.presencaWmeRefazerDesligar();
  await espera();
  assert.equal(a.pedidos.length, 3, 'o "invisível" do envio que morreu com o app não saiu na reabertura');
  // (b) O anterior volta com FALHA e o último, bem: nada fica pendente, e nada sai de novo.
  const b = aparelho();
  const soltarB = [];
  const q = b.pagina({ resposta: () => new Promise((ok) => soltarB.push(ok)) });
  q.desligar();
  q.religar();
  q.desligar();
  await espera();
  soltarB[0](SEM_REDE);
  await espera();
  soltarB[1]({ success: true });
  await espera();
  assert.equal(q.presencaWme.desligarPendente, false, 'DEFEITO: a falha do envio anterior deixou o "invisível" pendente por cima do que chegou');
  assert.equal(b.gravado(), null);
  b.relogio.agora += 61_000;
  q.presencaWmeRefazerDesligar();
  await espera();
  assert.equal(b.pedidos.length, 2, 'o "invisível" que já chegou saiu de novo');
});

test('R7-5-03 a troca de conta com o envio no ar: a resposta dele não deixa pendente pra conta nova, e não segura a repetição dela', async () => {
  const a = aparelho();
  const soltar = [];
  const p = a.pagina({ resposta: () => new Promise((ok) => soltar.push(ok)) });
  p.desligar();                                             // a conta A desliga; o envio fica no ar
  await espera();
  p.presencaWmeZerar();                                     // o perfil revela a conta B (o interruptor fica desligado)
  p.savePreferences();
  p.AppState.profile = { id: Number(CAF) };
  soltar[0](SEM_REDE);                                      // e a resposta de A volta, com falha
  await espera();
  assert.equal(p.presencaWme.desligarPendente, false, 'DEFEITO: a falha do envio de A deixou o "invisível" pendente pra conta B');
  assert.equal(a.gravado(), null, 'DEFEITO: o "invisível" de A foi gravado com a conta B');
  // B religa e desliga sem sessão (a renovação): fica pendente; a sessão volta, e o
  // perfil o manda — o envio de A, se ainda estivesse "no ar", não o segura.
  const b = aparelho();
  const soltarB = [];
  const q = b.pagina({ resposta: () => new Promise((ok) => soltarB.push(ok)) });
  q.desligar();                                             // A, no ar pra sempre
  await espera();
  q.presencaWmeZerar();
  q.savePreferences();
  q.AppState.profile = { id: Number(CAF) };
  q.sessao.token = null;
  q.religar();
  q.desligar();                                             // B, sem sessão: pendente
  assert.equal(q.presencaWme.desligarPendente, true, 'CONTROLE: o gesto sem sessão tem que ficar pendente');
  q.sessao.token = 'tok-B';
  q.presencaWmeRefazerDesligar();                           // o perfil de B chega
  await espera();
  assert.deepEqual(b.pedidos.map(({ aba, ...c }) => c), [{ userId: EU, visivel: false }, { userId: CAF, visivel: false }],
    'DEFEITO: o envio da conta anterior segurou o "invisível" da conta nova');
});

