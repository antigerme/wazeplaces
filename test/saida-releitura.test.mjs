// R9-2-01 — a passada da fila de saída escolhe o próximo item NA FILA DE AGORA.
//
// Entre um item e o seguinte a passada dorme o ritmo (`SAIDA_RITMO_MS`, 400 ms).
// A lista era lida depois do pouso, ANTES do ritmo, e o próximo item saía dela
// ao acordar. A decisão do card (o ✕ anotado na fila antes de sair, ver
// `anotarAntesDoEnvio`) ou a do "Rejeitar os N" que estava NO AR quando a lista
// foi lida, e cuja resposta chegou DURANTE o ritmo, já tinha saído da fila e do
// "em andamento" — e a passada, com a lista velha, a achava livre e a mandava
// ao Waze DE NOVO. MEDIDO no navegador, nos dois motores (auditoria de
// 2026-10-06, p23/p24): `["8ms u1","370ms u2","1017ms u2"]` e
// `["9ms u1","178ms x2","634ms x3","1017ms x2"]`.
//
// Aqui o aparelho roda DE VERDADE: o `handleReject` com o `scheduleAction`, a
// anotação, o `handleActionResult`, o `enviarLote` e o esvaziamento, fatiados do
// app.js. A rede é de mentira e cada resposta é solta pelo teste; o ritmo é um
// relógio de mentira, e é DENTRO dele que a resposta da outra decisão pousa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const MIN = readFileSync(new URL('../js/min/app.js', import.meta.url), 'utf8');

// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentarios = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const APP_SEM = semComentarios(APP);

// Pula a ASSINATURA antes de casar chaves (o `opts = {}` do `enviarLote` é um
// `{}` de parâmetro padrão), e reprova corpo absurdamente curto.
function fatiar(nome) {
  const marca = APP_SEM.indexOf('function ' + nome + '(');
  assert.ok(marca >= 0, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', marca);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  i = APP_SEM.indexOf('{', i);
  let prof = 0, fim = APP_SEM.length;
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(marca, fim);
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  const ini = APP_SEM.slice(Math.max(0, marca - 6), marca);
  return ini === 'async ' ? 'async ' + corpo : corpo;
}
const constante = (nome) => {
  const m = new RegExp('const ' + nome + ' = (\\d+);').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return Number(m[1]);
};
const RITMO = constante('SAIDA_RITMO_MS');

const PEDIDO = (v) => ({ venueID: v, updateRequestID: 'u' + v, creatorId: 7, createdBy: 'autor' });
// Uma decisão que falhou por rede ANTES (a passada vai mandá-la).
const NA_FILA = (v) => ({ tipo: 'reject', venueID: v, updateRequestID: 'u' + v, creatorId: 7, nome: 'autor',
  t: 1, dia: '2026-10-06', onde: '30', lang: 'pt', conta: '1', regiao: 'row' });
const OK = { success: true };
const SEM_REDE = { success: false, errorCategory: 'transient', _motivo: 'rede' };

// O aparelho. `manuais`: as decisões cuja PRIMEIRA ida o teste segura e solta
// (`responder`); toda outra ida responde sozinha — a 1ª de um pedido pousa, a
// repetida volta "já tratado" (é o Waze de verdade) —, senão a passada que manda
// de novo ficaria esperando pra sempre e o teste penduraria em vez de reprovar.
function aparelho({ fila = [], manuais = [] }) {
  const guardado = new Map([['waze_places_saida', JSON.stringify(fila)]]);
  const medidas = { envios: [], ritmos: 0, historico: [] };
  const presos = new Map();
  const gancho = { ritmo: null };
  const AppState = { authenticated: true, profile: { id: 1 }, currentPlace: null, queue: [], pendingAction: null,
    inFlightActions: 0, serverTotal: 9, fetchEpoch: 0, hasMore: false, stats: { read: 0, rejected: 1, skipped: 0 },
    preferences: { undoEnabled: false } };
  const deps = {
    AppState, epocaDaSessao: 0, navigator: { onLine: true },
    safeLS: { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) },
    SAIDA_KEY: 'waze_places_saida', SAIDA_MAX: 1000, SAIDA_RITMO_MS: RITMO, CONTA_KEY: 'waze_places_conta',
    SAIDA_RECUO_401_MS: [0, 15000, 60000, 300000], SAIDA_TENTATIVAS_POR_ITEM: 3, UNDO_WINDOW_MS: 3000,
    // O RITMO é o relógio do teste: é nele que a outra decisão pousa (`gancho.ritmo`).
    setTimeout: (fn, ms) => {
      if (ms === RITMO) {
        medidas.ritmos++;
        const h = gancho.ritmo; gancho.ritmo = null;
        Promise.resolve(h && h()).then(() => setImmediate(fn));
        return 0;
      }
      return setTimeout(fn, ms);
    },
    clearTimeout: () => {},
    dlog: () => {}, dlogPlace: () => null, dfato: () => {}, t: (k) => k, msgDoServidor: (r, d) => d,
    showToast: () => {}, showUndoBanner: () => {}, removeUndoBanner: () => {}, aplicarTravaDeAcao: () => {},
    updateInFlightIndicator: () => {}, updateStats: () => {}, updatePendingCount: () => {}, showCurrentPlace: () => {},
    saveStats: () => {}, aoMudarAFilaPorBaixo: () => {}, mostrarResultadoDoLote: () => {},
    canDisableUndo: () => true, registrarJanelaSemUndo: () => {}, zerarJanelasSemUndo: () => {},
    acoesTravadas: () => false, direcaoTravada: () => false, Treino: { ativo: false }, advanceQueue: () => {},
    presencaWmeDaAcao: () => null, presencaWmeAoResponder: () => {}, presencaFolhaAberta: () => false,
    callWithRetry: (fn) => fn(),
    registrarPouso: () => {}, recordHistory: (tipo) => medidas.historico.push(tipo),
    aprovacaoDelaJaPousou: () => false, desfechoDaAprovacaoDela: () => {},
    registrarRejeicaoDeAutor: () => {}, registrarAcaoConfirmada: () => {}, avisarConsequencia: () => {},
    historyTodayKey: () => '2026-10-06', ondeAgora: () => '30', handleUnauthorized: () => {}, paisDaFila: () => 30,
    devolverPedidoRecusado: () => {}, descontarGestoSemSessao: () => {}, decisaoDepoisDaQueda: () => {},
    marcaDaAbaConferida: Promise.resolve(), console: { error: () => {} },
    // A trava ENTRE ABAS: a do navegador, livre (uma aba só).
    travaDaSaida: async () => ({ reserva: false, soltar() {} }),
    ABA_DESTA_PAGINA: 'aba-teste', SAIDA_REIVINDICACAO_MS: 60000,
    atenderProvaDoEsvaziamento: () => {},   // a prova de rede engolida no esvaziamento (R11-4-01): aqui, nenhuma
    medidas, presos, manuais: new Set(manuais), setImmediate,
  };
  const nomes = ['marcaDaSessao', 'contaAgora', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'chaveDoPedido',
    'marcarEmAndamento', 'enfileirarSaida', 'tirarDaFilaDeSaida', 'marcarNaSaida', 'sessaoVivaDepoisDe', 'recuarSaida',
    'saidaEmRecuo', 'moverProFimDaSaida', 'registrarPousoDeSaida', 'reivindicacaoDestaAba', 'reivindicadoPorOutraAba',
    'pousouPorOutraAba', 'soltarMarcaDosItens', 'esvaziarFilaDeSaida', 'handleActionResult', 'scheduleAction',
    'anotarAntesDoEnvio', 'anotarSeAbriuASaida', 'handleReject', 'carimboDoGesto', 'pousouNoWaze', 'enviarLote'];
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `
    let esvaziandoSaida = false, saidaPedidaDeNovo = false, saidaEsperandoConta = false, tratouNestaFila = false,
      verificandoSessao = false, ultimaEscritaOkEm = 0;
    let sessaoVivaEm = { s: null, em: 0 }, saidaRecuo = { s: null, n: 0, ate: 0 };
    const pedidosEmAndamento = new Set(), descargaNaFila = new WeakSet(), anotadoAntesDoEnvio = new WeakSet();
    // O _post: toda resposta que CHEGA é prova de rede, e a prova chama o
    // esvaziamento ANTES de a resposta voltar a quem a pediu.
    const aoProvarRede = () => { esvaziarFilaDeSaida(); };
    const rede = (v) => {
      medidas.envios.push(v);
      // TETO do instrumento: um laço não prende o processo do teste.
      if (medidas.envios.length > 30) return new Promise(() => {});
      const primeira = medidas.envios.filter((x) => x === v).length === 1;
      const chegou = (r) => { if (!r._motivo) aoProvarRede(); return r; };
      if (primeira && manuais.has(v)) return new Promise((ok) => presos.set(v, (r) => ok(chegou(r))));
      return new Promise((ok) => setImmediate(() => ok(chegou(primeira ? { success: true }
        : { success: false, errorCategory: 'already_processed' }))));
    };
    const API = { getSession: () => 'tok', getRegion: () => 'row', getCountry: () => 30,
      rejectPlace: (v) => rede(v), markAsRead: (v) => rede(v) };
    ${nomes.map(fatiar).join('\n')}
    return { handleReject, enviarLote, esvaziarFilaDeSaida, carregarFilaDeSaida, emAndamento: pedidosEmAndamento };`)(
    ...chaves.map((k) => deps[k]));
  const ap = { app, AppState, medidas, gancho, guardado };
  ap.idas = (v) => medidas.envios.filter((x) => x === v).length;
  ap.noAr = (v) => presos.has(v);
  ap.responder = (v, r) => { const f = presos.get(v); assert.ok(f, `${v} não está no ar`); presos.delete(v); f(r); };
  ap.fila = () => JSON.parse(guardado.get('waze_places_saida') || '[]').map((x) => x.venueID);
  return ap;
}
const aquietar = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r)); };
async function ate(cond, rotulo) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(cond(), 'o cenário não chegou a: ' + rotulo);
}

// O ✕ do card SEM o Desfazer (quem passou da cota): anotado na fila de saída e
// mandado na hora.
function rejeitarNoCard(ap, v) {
  ap.AppState.currentPlace = PEDIDO(v);
  ap.app.handleReject();
}

test('R9-2-01: o ✕ do card que POUSA durante o ritmo não sai de novo pela passada', async () => {
  const ap = aparelho({ fila: [NA_FILA('v1')], manuais: ['v1', 'v2'] });
  const passada = ap.app.esvaziarFilaDeSaida();          // a rede voltou: a passada manda v1
  await ate(() => ap.noAr('v1'), 'v1 no ar');
  rejeitarNoCard(ap, 'v2');                               // e o ✕ do card sai logo depois
  await ate(() => ap.noAr('v2'), 'v2 no ar');
  assert.deepEqual(ap.fila(), ['v1', 'v2'], 'o ✕ não foi anotado na fila de saída antes de sair — o cenário não é o do defeito');
  // A resposta do ✕ de v2 chega DENTRO do ritmo que segue o pouso de v1.
  ap.gancho.ritmo = async () => {
    assert.ok(ap.app.emAndamento.has('v2|uv2'), 'v2 já não estava no ar quando a passada leu a fila — o cenário não é o do defeito');
    ap.responder('v2', OK);
    await aquietar();
  };
  ap.responder('v1', OK);
  await passada;
  await aquietar();
  assert.equal(ap.medidas.ritmos >= 1, true, 'a passada não dormiu o ritmo — o teste não mediria nada');
  assert.equal(ap.idas('v2'), 1,
    `DEFEITO: o ✕ de v2 foi ao Waze ${ap.idas('v2')} vezes — a passada escolheu o item na lista lida ANTES do ritmo (${ap.medidas.envios.join(' ')})`);
  assert.equal(ap.idas('v1'), 1);
  assert.deepEqual(ap.fila(), [], 'sobrou decisão na fila de saída');
  assert.deepEqual(ap.medidas.historico, ['reject', 'reject'], 'o Histórico não contou as duas decisões uma vez cada');
});

test('R9-2-01: o "Rejeitar os N" que pousa durante o ritmo não sai de novo pela passada (p24)', async () => {
  const ap = aparelho({ fila: [NA_FILA('v1')], manuais: ['v1', 'x2', 'x3'] });
  const passada = ap.app.esvaziarFilaDeSaida();
  await ate(() => ap.noAr('v1'), 'v1 no ar');
  // O lote da PESSOA (placar otimista): anota x2 e x3 na fila e manda um a um.
  const lote = ap.app.enviarLote([PEDIDO('x2'), PEDIDO('x3')], { regiao: 'row', silencioso: true });
  await ate(() => ap.noAr('x2'), 'x2 no ar');
  assert.deepEqual(ap.fila(), ['v1', 'x2', 'x3'], 'o lote não anotou os pedidos na fila de saída — o cenário não é o do defeito');
  // x2 pousa no ritmo, e o lote segue com x3 (que fica no ar).
  ap.gancho.ritmo = async () => {
    ap.responder('x2', OK);
    await ate(() => ap.noAr('x3'), 'x3 no ar');
  };
  ap.responder('v1', OK);
  await ate(() => ap.medidas.ritmos >= 1 && ap.noAr('x3'), 'o ritmo e o x3 no ar');
  await aquietar();
  ap.responder('x3', OK);
  await lote;
  await passada;
  await aquietar();
  assert.equal(ap.idas('x2'), 1,
    `DEFEITO: o x2 do lote foi ao Waze ${ap.idas('x2')} vezes — a passada usou a lista de antes do ritmo (${ap.medidas.envios.join(' ')})`);
  assert.equal(ap.idas('x3'), 1);
  assert.deepEqual(ap.fila(), []);
});

test('R9-2-01: CONTROLE — a resposta chega DEPOIS de a passada acordar: o item no ar não sai por ela', async () => {
  const ap = aparelho({ fila: [NA_FILA('v1')], manuais: ['v1', 'v2'] });
  const passada = ap.app.esvaziarFilaDeSaida();
  await ate(() => ap.noAr('v1'), 'v1 no ar');
  rejeitarNoCard(ap, 'v2');
  await ate(() => ap.noAr('v2'), 'v2 no ar');
  ap.responder('v1', OK);
  await passada;                                          // acordou com v2 ainda no ar: parou
  await aquietar();
  assert.equal(ap.idas('v2'), 1, 'a passada mandou o item que ainda estava no ar');
  ap.responder('v2', OK);
  await aquietar();
  assert.equal(ap.idas('v2'), 1);
  assert.deepEqual(ap.fila(), []);
});

test('R9-2-01: CONTROLE — o ✕ que FICA na fila (a rede caiu no ritmo) sai pela passada: o teste vê uma ida a mais', async () => {
  // Sem isto, "uma ida" no teste de cima poderia ser o instrumento cego: aqui a
  // decisão segue na fila e livre quando a passada acorda, e ELA tem de mandá-la.
  const ap = aparelho({ fila: [NA_FILA('v1')], manuais: ['v1', 'v2'] });
  const passada = ap.app.esvaziarFilaDeSaida();
  await ate(() => ap.noAr('v1'), 'v1 no ar');
  rejeitarNoCard(ap, 'v2');
  await ate(() => ap.noAr('v2'), 'v2 no ar');
  ap.gancho.ritmo = async () => { ap.responder('v2', SEM_REDE); await aquietar(); };
  ap.responder('v1', OK);
  await passada;
  await aquietar();
  assert.equal(ap.idas('v2'), 2, `a decisão que ficou na fila não saiu pela passada (${ap.medidas.envios.join(' ')})`);
  assert.deepEqual(ap.fila(), []);
});

test('R9-2-01: a passada relê a fila ANTES de escolher cada item (estrutura) — e o bundle gerado tem a releitura', () => {
  const f = fatiar('esvaziarFilaDeSaida');
  const iLaco = f.indexOf('while (f.length)');
  const iEscolhe = f.indexOf('const item = f.find(', iLaco);
  assert.ok(iLaco > 0 && iEscolhe > iLaco, 'o laço da passada mudou de forma — o teste não acha onde o item é escolhido');
  const volta = f.slice(iLaco, iEscolhe);
  assert.match(volta, /^\s+f = carregarFilaDeSaida\(\);$/m,
    'DEFEITO: o item é escolhido sem reler a fila na volta — a decisão que pousou durante o ritmo sai de novo');
  // O js/min/ é o que o navegador carrega (gotcha #22): a releitura está lá.
  const laco = MIN.indexOf('for(;') >= 0 || MIN.indexOf('while(') >= 0;
  assert.ok(laco, 'o bundle gerado não tem laço nenhum — o instrumento quebrou');
  assert.match(MIN, /=carregarFilaDeSaida\(\);const \w+=\w+\.find\(/,
    'js/min/app.js não relê a fila antes de escolher o item — faltou `npm run js`');
});
