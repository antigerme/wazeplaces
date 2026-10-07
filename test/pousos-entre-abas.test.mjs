// R11-2-01 (auditoria de 2026-10-07, rodada 11; engloba o R11-3-03). Com o app
// aberto em DUAS abas da mesma conta, o único aviso entre elas era o `storage`
// da FILA DE SAÍDA — e por ela só passa o que o CARD decide. O "Marcar todos", a
// recusa automática e a aprovação de foto não escrevem nela, e a outra aba
// seguia com esses pedidos como card: decididos de novo lá, contavam duas vezes
// no placar, no Histórico e na "Mão firme", diziam "Já tratado por outro editor"
// sobre a decisão da própria pessoa e, depois de um "Marcar todos", o ✕ da outra
// aba ia ao Waze (MEDIDO no navegador, n01–n03 da rodada 11, nos dois motores).
//
// Toda decisão que pousa passa pelo `registrarPouso`, e ele avisa as outras abas
// por um `BroadcastChannel`; a outra aba roda o MESMO anotar + tirar da fila do
// aviso da fila de saída. (O R11-2-06, a série do autor sem o pedido anotado,
// mora em test/serie-do-autor-outra-aba.test.mjs.)
//
// Os testes RODAM o código de verdade, fatiado do app.js, em DUAS abas de
// mentira que dividem o aparelho e um canal de mentira (o `BroadcastChannel` do
// navegador entrega a mensagem às OUTRAS instâncias, nunca à que mandou, numa
// tarefa à parte e por cópia estruturada — o de mentira faz o mesmo). Cada um
// tem o CONTROLE que reprova como o app de antes, e foi visto REPROVANDO com o
// conserto desfeito (sabotagem no relatório do lote 15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fechar(txt, i) {
  let prof = 0;
  for (let j = txt.indexOf('{', i); j < txt.length; j++) {
    if (txt[j] === '{') prof++;
    else if (txt[j] === '}') { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
// Declarações de MÓDULO tiradas do fonte (um nome trocado lá reprova aqui).
const linhaDoFonte = (re, o) => { const m = re.exec(APP_SEM); assert.ok(m, `${o} sumiu do app.js`); return m[0]; };
const CANAL = linhaDoFonte(/^const CANAL_DOS_POUSOS = '[^']+';$/m, 'o nome do canal dos pousos');
const CANAL_VAR = linhaDoFonte(/^let canalDosPousos = null;$/m, 'o canal dos pousos');
// As chaves que a outra aba decidiu e os avisos que esperam a conta (rodada 12,
// test/abas-auditoria-r12.test.mjs): o aviso do canal passa por elas.
const DECIDIDAS = [
  linhaDoFonte(/^const decididasPorOutraAba = new Map\(\);$/m, 'as chaves que a outra aba decidiu'),
  linhaDoFonte(/^const DECIDIDAS_POR_OUTRA_ABA_MAX = \d+;$/m, 'o teto das chaves que a outra aba decidiu'),
  linhaDoFonte(/^const avisosDePousoSemConta = \[\];$/m, 'os avisos que esperam a conta'),
  linhaDoFonte(/^const AVISOS_DE_POUSO_SEM_CONTA_MAX = \d+;$/m, 'o teto dos avisos que esperam a conta'),
];
const CONTA_KEY = 'waze_places_conta';
const SAIDA_KEY = 'waze_places_saida';

// O navegador de mentira: o canal entrega às OUTRAS instâncias do mesmo nome,
// numa tarefa à parte, por cópia (como o de verdade). Com TETO de entregas: uma
// aba que respondesse ao aviso avisando de volta viraria um laço entre as duas,
// e o teste penduraria em vez de reprovar (gotcha #19, o entregador entre abas).
const TETO_DE_ENTREGAS = 50;
function navegador() {
  const canais = new Map();
  const postados = [];
  let entregas = 0;
  class CanalDeMentira {
    constructor(nome) {
      this.nome = nome;
      this.onmessage = null;
      if (!canais.has(nome)) canais.set(nome, new Set());
      canais.get(nome).add(this);
    }
    postMessage(msg) {
      const dado = structuredClone(msg);
      postados.push({ de: this, dado });
      for (const outro of canais.get(this.nome)) {
        if (outro === this || ++entregas > TETO_DE_ENTREGAS) continue;
        setTimeout(() => { if (typeof outro.onmessage === 'function') outro.onmessage({ data: structuredClone(dado) }); }, 0);
      }
    }
    close() { canais.get(this.nome).delete(this); }
  }
  return { BroadcastChannel: CanalDeMentira, postados, entregue: () => new Promise((ok) => setTimeout(ok, 5)) };
}

const P = (i, autor = 700 + i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, creatorId: autor, createdBy: 'autor' + autor });
const ids = (fila) => (fila || []).map((p) => p.updateRequestID);

const NOMES = ['chaveDoPedido', 'filaReal', 'filaRealComDevolvidos', 'anotarDecididosPorOutraAba',
  'tirarDaFilaOQueAOutraAbaDecidiu', 'gestoNoDecididoPorOutraAba', 'avisarDecididoNaOutraAba',
  'carregarFilaDeSaida', 'salvarFilaDeSaida', 'enfileirarSaida', 'anotarAntesDoEnvio',
  'handleReject', 'handleMarkAsRead', 'offlineLerPousos', 'registrarPouso',
  'abrirCanalDosPousos', 'avisarOutrasAbasDoPouso', 'aoPousarEmOutraAba', 'marcaDaSessao', 'contaAgora',
  'aplicarPousoDeOutraAba', 'lembrarDecididasPorOutraAba', 'decididoNaOutraAbaDepoisDe', 'esquecerDecididasPorOutraAba',
  'guardarAvisoSemConta', 'aplicarAvisosQueEsperavamAConta', 'quemDecideAgora'];

// Uma ABA, com a fila `fila` (o da frente na tela), num `aparelho` (Map) que as
// abas dividem. `token`: a sessão na MEMÓRIA desta aba (`null`: sem sessão).
function aba(nav, { fila, aparelho, token = 'tok-x', perfil = { id: 4242 }, treino = null, abrirCanal = true } = {}) {
  const log = [], toasts = [], rede = [], agendadas = [], diario = [], escritas = [];
  const AppState = { queue: fila.slice(), currentPlace: fila[0] || null, serverTotal: fila.length, profile: perfil,
    stats: { read: 5, rejected: 5, skipped: 5 }, preferences: { pularGuarda: false }, pendingAction: null, fetchEpoch: 0 };
  if (treino) {
    treino._salvo.queue = AppState.queue;
    treino._salvo.currentPlace = AppState.currentPlace;
    AppState.queue = [{ venueID: 'treino1', updateRequestID: 'treino-inerte', _treino: true }];
    AppState.currentPlace = AppState.queue[0];
  }
  let leiturasDoAparelho = 0;
  const API = {
    sessionToken: token,
    temSessaoNaMemoria() { return !!this.sessionToken; },
    // Como o de verdade: com a memória vazia, LÊ o aparelho e o adota (R9-1-03).
    getSession() {
      if (!this.sessionToken) { leiturasDoAparelho++; this.sessionToken = aparelho.get('waze_session_token') || null; }
      return this.sessionToken;
    },
    getRegion: () => 'row',
    rejectPlace: async (v) => { rede.push('reject:' + v); return { success: true }; },
    markAsRead: async (v) => { rede.push('read:' + v); return { success: true }; },
  };
  const deps = {
    AppState, API, Treino: treino || { ativo: false, _salvo: null },
    BroadcastChannel: nav ? nav.BroadcastChannel : undefined,
    safeLS: { get: (k) => (aparelho.has(k) ? aparelho.get(k) : null),
      set: (k, v) => { escritas.push(k); aparelho.set(k, String(v)); }, remove: (k) => { escritas.push('-' + k); aparelho.delete(k); } },
    SAIDA_KEY, SAIDA_MAX: 1000, CONTA_KEY, POUSO_NA_MEMORIA_MS: 600000,
    OFFLINE_POUSOS_KEY: 'waze_places_offline_pousos', OFFLINE_POUSOS_MAX: 1000, offlineLigado: () => false,
    dfato: (k, d) => diario.push({ k, ...(d || {}) }),
    showToast: (m) => toasts.push(m), t: (k) => k,
    updatePendingCount: () => log.push('restam'), aoMudarAFilaPorBaixo: () => log.push('fundo'),
    advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; log.push('avancou'); },
    acoesTravadas: () => false, direcaoTravada: () => false,
    updateStats: () => {}, saveStats: () => {}, updateInFlightIndicator: () => {},
    paisDaFila: () => 30, carimboDoGesto: () => ({ t: 1, dia: '2026-10-07', onde: '30', lang: 'pt' }),
    scheduleAction: (tipo, place, executor) => agendadas.push({ tipo, place, executor }),
    presencaWmeDaAcao: () => null, presencaWmeAoResponder: () => {},
    callWithRetry: (fn) => fn(), decisaoDepoisDaQueda: () => {},
    handleActionResult: (tipo, place) => log.push('pousou:' + tipo + ':' + place.updateRequestID),
    reivindicacaoDestaAba: () => ({ rv: 'aba', rvEm: 1 }),
    historyTodayKey: () => '2026-10-07', ondeAgora: () => '30', getLang: () => 'pt',
    refazerDepoisDo401: async () => null, msgDoServidor: () => '', contarConquista: () => {},
  };
  const chaves = Object.keys(deps);
  const fonte = [
    'let tratouNestaFila = false, epocaDaSessao = 0, ultimaEscritaOkEm = 0;',
    'const decididosPorOutraAbaComCardAqui = new WeakSet(), pedidosEmAndamento = new Set(),'
      + ' descargaNaFila = new WeakSet(), anotadoAntesDoEnvio = new WeakSet(), pousosDaPagina = new Map();',
    CANAL, CANAL_VAR, ...DECIDIDAS,
    ...NOMES.map(fatiar),
    `return { ${NOMES.join(', ')}, marcado: (p) => decididosPorOutraAbaComCardAqui.has(p), emAndamento: pedidosEmAndamento,
      canal: () => canalDosPousos, pousosDaPagina, decididas: decididasPorOutraAba, esperando: avisosDePousoSemConta };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  if (abrirCanal) app.abrirCanalDosPousos();
  return { app, AppState, API, log, toasts, rede, agendadas, diario, escritas, leituras: () => leiturasDoAparelho };
}

// O aparelho de duas abas da mesma conta, com a mesma sessão guardada.
function aparelhoDaConta(token = 'tok-x', conta = '4242', marca) {
  const ap = new Map();
  ap.set('waze_session_token', token);
  return { ap, comConta: (m) => { ap.set(CONTA_KEY, JSON.stringify({ id: conta, s: m })); return ap; } };
}
function duasAbas({ fila, tokenB = 'tok-x', perfilB = { id: 4242 }, treinoB = null, canalNaB = true, nav = navegador() } = {}) {
  const { ap, comConta } = aparelhoDaConta();
  const A = aba(nav, { fila, aparelho: ap });
  comConta(A.app.marcaDaSessao('tok-x'));
  const B = aba(nav, { fila, aparelho: ap, token: tokenB, perfil: perfilB, treino: treinoB, abrirCanal: canalNaB });
  return { A, B, nav, ap };
}

// ═══ o pouso numa aba tira o pedido da fila da outra ═══════════════════════════
test('R11-2-01: o que POUSOU numa aba sai da fila da outra — com o "Restam" e o card de fundo — e o da TELA fica, anotado', async () => {
  const fila = [0, 1, 2, 3, 4].map(P);
  const { A, B, nav } = duasAbas({ fila });
  // O "Marcar todos" da A pousa um pedaço (o `handleBatchMarkRead` chama o
  // `registrarPouso` com o pedaço inteiro) — o card da frente da B e mais dois.
  A.app.registrarPouso([fila[0], fila[1], fila[3]].map((p) => ({ ...p })));
  await nav.entregue();
  assert.deepEqual(ids(B.AppState.queue), ['u0', 'u2', 'u4'],
    `DEFEITO: o que pousou na aba A seguiu na fila da B: ${ids(B.AppState.queue)}`);
  assert.equal(B.AppState.serverTotal, 3, 'o "Restam" da B não desceu pelo que saiu');
  assert.ok(B.log.includes('restam') && B.log.includes('fundo'), `o "Restam" e o card de fundo não foram redesenhados: ${B.log}`);
  assert.equal(B.AppState.currentPlace, fila[0], 'o card da TELA da B foi trocado debaixo do dedo');
  assert.equal(B.app.marcado(fila[0]), true, 'o card da tela que a A decidiu não ficou anotado');
  // E nada volta: a B não avisa de volta, e a A (que mandou) não recebe o próprio aviso.
  assert.equal(nav.postados.filter((x) => x.de === B.app.canal()).length, 0, 'a aba que RECEBEU avisou de volta');
  assert.deepEqual(ids(A.AppState.queue), ['u0', 'u1', 'u2', 'u3', 'u4'], 'a aba que pousou recebeu o próprio aviso');
});

for (const [handler, tipo, campo] of [['handleReject', 'reject', 'rejected'], ['handleMarkAsRead', 'read', 'read']]) {
  test(`R11-2-01: o ${tipo} na OUTRA aba, no card que pousou aqui pelo "Marcar todos", pela recusa ou pela aprovação, não sai nem conta`, async () => {
    const fila = [0, 1, 2].map(P);
    const { A, B, nav } = duasAbas({ fila });
    A.app.registrarPouso({ ...fila[0] });           // a aprovação (ou a recusa) do pedido da frente pousa na A
    await nav.entregue();
    B.app[handler]();
    for (const a of B.agendadas) await a.executor();
    assert.deepEqual(B.rede, [], `DEFEITO: o ${tipo} da aba B foi ao Waze sobre o pedido que a A já decidiu: ${B.rede}`);
    assert.equal(B.AppState.stats[campo], 5, `DEFEITO: o ${tipo} da B contou de novo no placar`);
    assert.deepEqual(B.toasts, ['toast.decididoNaOutraAba'], `a B não disse que foi a outra aba: ${JSON.stringify(B.toasts)}`);
    assert.deepEqual(ids(B.AppState.queue), ['u1', 'u2'], 'o card não saiu da tela da B');
    // CONTROLE: a B SEM o canal (o app de antes) manda e conta — a medida enxerga o defeito.
    const c = duasAbas({ fila, canalNaB: false });
    c.A.app.registrarPouso({ ...fila[0] });
    await c.nav.entregue();
    c.B.app[handler]();
    for (const a of c.B.agendadas) await a.executor();
    assert.equal(c.B.rede.length, 1, `CONTROLE: sem o canal, o ${tipo} da B devia sair (o app de antes): ${c.B.rede}`);
    assert.equal(c.B.AppState.stats[campo], 6);
  });
}

test('R11-2-01: a decisão da OUTRA aba que está na janela do Desfazer quando o pouso chega não sai — vale a primeira', async () => {
  const fila = [0, 1].map(P);
  const { A, B, nav } = duasAbas({ fila });
  B.app.handleReject();                                   // o ✕ da B, com a janela do Desfazer
  assert.equal(B.agendadas.length, 1, 'PRÉ-CONDIÇÃO: o ✕ não foi agendado');
  B.AppState.pendingAction = { type: 'reject', place: B.agendadas[0].place };
  A.app.registrarPouso({ ...fila[0] });                   // a A marca o mesmo pedido como lido (o "Marcar todos")
  await nav.entregue();
  B.AppState.pendingAction = null;                        // a janela da B vence
  await B.agendadas[0].executor();
  assert.deepEqual(B.rede, [], `DEFEITO: o ✕ da janela saiu sobre a decisão que pousou na A: ${B.rede}`);
  assert.equal(B.AppState.stats.rejected, 5, 'o ✕ descartado seguiu no placar');
  assert.deepEqual(B.toasts, ['toast.decididoNaOutraAba']);
});

// ═══ só entre abas da MESMA conta ═══════════════════════════════════════════════
test('R11-2-01: só a MESMA conta — a mesma sessão, ou a mesma conta; outra conta e a aba sem sessão ficam como estão', async () => {
  const fila = [0, 1, 2].map(P);
  const pousa = async (opts) => {
    const d = duasAbas({ fila, ...opts });
    d.A.app.registrarPouso({ ...fila[1] });
    await d.nav.entregue();
    return d.B;
  };
  // Outra SESSÃO da mesma conta (a outra aba entrou de novo): vale, pela conta.
  assert.deepEqual(ids((await pousa({ tokenB: 'tok-outra-sessao' })).AppState.queue), ['u0', 'u2'],
    'a outra sessão da MESMA conta não recebeu o pouso');
  // A mesma sessão, sem o perfil ainda: vale, pela marca da sessão.
  assert.deepEqual(ids((await pousa({ perfilB: null })).AppState.queue), ['u0', 'u2'],
    'a aba da MESMA sessão, com o perfil a caminho, não recebeu o pouso');
  // OUTRA conta (outra sessão, outro perfil): nada muda.
  assert.deepEqual(ids((await pousa({ tokenB: 'tok-y', perfilB: { id: 5151 } })).AppState.queue), ['u0', 'u1', 'u2'],
    'DEFEITO: o pouso de OUTRA conta tirou pedido da fila desta');
  // Outra sessão e o perfil ainda não chegou: não se sabe de quem é — nada muda.
  assert.deepEqual(ids((await pousa({ tokenB: 'tok-y', perfilB: null })).AppState.queue), ['u0', 'u1', 'u2'],
    'a aba que não sabe a própria conta aplicou o pouso de outra sessão');
  // A aba SEM sessão na memória (a tela de entrada): nada muda, e o aparelho não é lido.
  const semSessao = await pousa({ tokenB: null });
  assert.deepEqual(ids(semSessao.AppState.queue), ['u0', 'u1', 'u2'], 'a aba sem sessão aplicou o pouso');
  assert.equal(semSessao.leituras(), 0, 'DEFEITO: o aviso fez a aba sem sessão ler o aparelho (e adotar a sessão da outra, R9-1-03)');
  assert.equal(semSessao.API.sessionToken, null);
});

test('R11-2-01: quem pousa SEM sessão na memória não avisa (e não lê o aparelho); a mensagem leva só chaves, conta e marca', async () => {
  const fila = [0, 1].map(P);
  const nav = navegador();
  const { ap } = aparelhoDaConta();
  const semSessao = aba(nav, { fila, aparelho: ap, token: null, perfil: null });
  semSessao.app.registrarPouso({ ...fila[0] });
  assert.equal(nav.postados.length, 0, 'quem pousou sem sessão na memória avisou');
  assert.equal(semSessao.leituras(), 0, 'o aviso leu o aparelho com a memória vazia');
  const A = aba(nav, { fila, aparelho: ap });
  A.app.registrarPouso([{ ...fila[0] }, { ...fila[1] }]);
  assert.equal(nav.postados.length, 1, 'um pouso (um pedaço do lote) tem de ser UM aviso');
  const msg = nav.postados[0].dado;
  assert.deepEqual(Object.keys(msg).sort(), ['chaves', 'conta', 's', 'v'], `a mensagem leva campos a mais: ${Object.keys(msg)}`);
  assert.deepEqual(msg.chaves, ['v0|u0', 'v1|u1']);
  assert.equal(msg.conta, '4242');
  assert.ok(!JSON.stringify(msg).includes('tok-x'), 'o TOKEN da sessão foi pro canal');
});

// ═══ com o treino aberto, a fila REAL ═════════════════════════════════════════
test('R11-2-01: com o treino aberto na outra aba, o pouso sai da fila REAL guardada nele — os exemplos ficam', async () => {
  const fila = [0, 1, 2, 3].map(P);
  const treino = { ativo: true, _salvo: { devolver: [] } };
  const { A, B, nav } = duasAbas({ fila, treinoB: treino });
  const exemplos = B.AppState.queue;
  A.app.registrarPouso([{ ...fila[0] }, { ...fila[2] }]);
  await nav.entregue();
  assert.deepEqual(ids(treino._salvo.queue), ['u0', 'u1', 'u3'],
    `DEFEITO: com o treino aberto, o que pousou na outra aba seguiu na fila real: ${ids(treino._salvo.queue)}`);
  assert.equal(B.app.marcado(fila[0]), true, 'o card real da frente (que volta no "Sair" do treino) não ficou anotado');
  assert.equal(B.AppState.queue, exemplos, 'a fila de EXEMPLOS foi mexida');
  assert.ok(!B.log.includes('fundo'), 'o card de fundo do TREINO foi refeito com a fila real');
});

// ═══ nada grava no aparelho, e sem o canal segue como antes ═══════════════════
test('R11-2-01: receber o aviso não grava NADA no aparelho; sem `BroadcastChannel`, segue como antes (sem erro)', async () => {
  const fila = [0, 1, 2].map(P);
  const { A, B, nav } = duasAbas({ fila });
  A.app.registrarPouso({ ...fila[2] });
  await nav.entregue();
  assert.deepEqual(ids(B.AppState.queue), ['u0', 'u1'], 'PRÉ-CONDIÇÃO: o aviso não chegou');
  assert.deepEqual(B.escritas, [], `a aba que recebeu gravou no aparelho: ${B.escritas}`);
  assert.deepEqual(A.escritas, [], `quem pousou gravou no aparelho pelo aviso (o offline está desligado): ${A.escritas}`);
  // O navegador sem o canal (iOS < 15.4): nada quebra, nada sai.
  const { ap } = aparelhoDaConta();
  const velho = aba(null, { fila, aparelho: ap });
  assert.equal(velho.app.canal(), null);
  assert.doesNotThrow(() => velho.app.registrarPouso({ ...fila[0] }));
});
