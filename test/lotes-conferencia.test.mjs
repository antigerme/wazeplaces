// O LOTE e a PASSADA da fila de saída diante do que o card já sabia tratar
// (auditoria de 2026-10-06, rodada 8 — o lote 12 da fila):
//
//  · a CONFERÊNCIA de sessão que começa NO MEIO de uma passada da fila de saída
//    (R8-2-02 = R8-1-06). As guardas só valiam na entrada: o ✕ que levava 401
//    com a passada dormindo o ritmo saía de novo, e os itens seguintes saíam
//    durante a conferência.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" que aceita qualquer chamada (o `montar` de
// test/costura-sessao). Cada teste foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const MIN = ler('js/min/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Pula a ASSINATURA antes de casar chaves: `enviarLote(places, opts = {})` tem
// um `{}` de parâmetro padrão.
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
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// Um "buraco negro": aceita qualquer propriedade e qualquer chamada.
function buracoNegro(nome, chamou) {
  const f = function () {};
  return new Proxy(f, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then' || typeof k !== 'string') return undefined;
      return buracoNegro(nome + '.' + k, chamou);
    },
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}

// `nomes`: as funções do app.js a rodar. `deps`: o que elas enxergam — funções
// e as variáveis de módulo (`epocaDaSessao`, `verificandoSessao`…), que elas leem
// e escrevem direto no objeto. O resto é buraco negro.
function montar(nomes, deps) {
  for (const [k, v] of Object.entries({ loteDeLidosEmVoo: false, escritasConferindo: 0, aprovandoAgora: false,
    excluindoAgora: false, renomeacoesNoAr: new Set(), extPerguntando: false, extRenovando: false,
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map() })) if (!(k in deps)) deps[k] = v;
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      return buracoNegro(k, chamou);
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map(fatiar).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}

const tique = (ms = 2) => new Promise((ok) => setTimeout(ok, ms));
// Espera por CONDIÇÃO, com teto de tempo real — nunca por prazo fixo.
async function ateQue(cond, rotulo, tetoMs = 5000) {
  const fim = performance.now() + tetoMs;
  while (!cond()) {
    if (performance.now() > fim) assert.fail(`${rotulo}: não aconteceu em ${tetoMs / 1000} s`);
    await tique(2);
  }
}

const lsFalso = () => {
  const guardado = new Map();
  return { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) };
};
const chave = (p) => p.venueID + '|' + p.updateRequestID;
const R401 = { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.sessionExpired', httpCode: 401 };
const VIVA = { success: true, profile: { id: 111 } };
const MORTA = { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.cookiesExpired' };

// ═══ R8-2-02 · a conferência que começa NO MEIO de uma passada da fila de saída ═══

// A passada de verdade, com o ✕ de verdade (`handleReject` → `scheduleAction` →
// `handleActionResult` → `handleUnauthorized`). O RITMO entre um item e o
// próximo fica nas mãos do teste (`ritmos`): é nele que a passada dorme, e é
// nele que a conferência começa. As respostas do Waze também (`responder`).
// Como o `_post`, a resposta que CHEGA é prova de rede e chama o esvaziamento
// (que, com a passada no ar, não faz nada).
const SAIDA_KEY = constante('SAIDA_KEY');
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();
const itemDaSaida = (v) => ({ tipo: 'reject', venueID: v, updateRequestID: 'u' + v, conta: '111', s: marcaDe('tok-A'), regiao: 'row' });
const P = (v) => ({ venueID: v, updateRequestID: 'u' + v, creatorId: 9 });

function montarPassada({ saida, fila = [] }) {
  const safeLS = lsFalso();
  safeLS.set(SAIDA_KEY, JSON.stringify(saida));
  const envios = [];        // { v, conferindo, epoca }
  const noAr = [];          // { v, ok }
  const ritmos = [];
  const RITMO = constante('SAIDA_RITMO_MS');
  const ritmo = { auto: false };
  let sonda = null;
  const AppState = {
    authenticated: true, profile: { id: 111 }, currentPlace: fila[0] || null, queue: fila.slice(),
    stats: { read: 0, rejected: saida.length, skipped: 0 }, serverTotal: 10, fetchEpoch: 0,
    preferences: { undoEnabled: false }, pendingAction: null, inFlightActions: 0,
  };
  const deps = {
    AppState, safeLS, epocaDaSessao: 0, Treino: { ativo: false }, navigator: { onLine: true },
    SAIDA_KEY, SAIDA_MAX: constante('SAIDA_MAX'), CONTA_KEY: constante('CONTA_KEY'),
    SAIDA_RECUO_401_MS: constante('SAIDA_RECUO_401_MS'), SAIDA_TENTATIVAS_POR_ITEM: constante('SAIDA_TENTATIVAS_POR_ITEM'),
    SAIDA_RITMO_MS: RITMO, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1, 1], VERIFICA_SESSAO_MS: 0,
    ABA_DESTA_PAGINA: 'aba-teste', SAIDA_REIVINDICACAO_MS: 60000,
    esvaziandoSaida: false, saidaPedidaDeNovo: false, saidaEsperandoConta: false, verificandoSessao: false,
    conferenciaDaSessao: null, sessaoVivaEm: { s: null, em: 0 }, saidaRecuo: { s: null, n: 0, ate: 0 }, ultimaEscritaOkEm: 0,
    pedidosEmAndamento: new Set(), descargaNaFila: new WeakSet(), anotadoAntesDoEnvio: new WeakSet(),
    direcaoTravada: () => false, canDisableUndo: () => true, presencaWmeDaAcao: () => null,
    advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; },
    registrarPousoDeSaida: () => {}, rebuscarDepoisDeFalha: () => {}, definirPerfil: (r) => !!(r && r.success && r.profile),
    derrubarSessao: () => { deps.epocaDaSessao++; AppState.authenticated = false; },
    historyTodayKey: () => '2026-10-06', ondeAgora: () => '30', getLang: () => 'pt', t: (k) => k,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, console,
    // A trava ENTRE ABAS, sempre livre: aqui a corrida é dentro da aba.
    travaDaSaida: async () => ({ reserva: false, soltar() {} }),
    setTimeout: (fn, ms) => {
      if (ms === RITMO && !ritmo.auto) { ritmos.push(fn); return 0; }
      return setTimeout(fn, ms === RITMO ? 0 : ms);
    },
    API: {
      getRegion: () => 'row', getCountry: () => 30, getSession: () => 'tok-A',
      rejectPlace: (v) => {
        envios.push({ v, conferindo: deps.verificandoSessao, epoca: deps.epocaDaSessao });
        const resposta = deps.proxima ? Promise.resolve(deps.proxima(v)) : new Promise((ok) => noAr.push({ v, ok }));
        return resposta.then(async (r) => {
          await new Promise((ok) => setImmediate(ok));
          if (!deps.esvaziandoSaida) h.esvaziarFilaDeSaida();
          return r;
        });
      },
      getProfile: () => new Promise((ok) => { sonda = ok; }),
    },
  };
  const h = montar(['sessaoTrocou', 'callWithRetry', 'acoesTravadas', 'aprovacaoDaTelaNoAr', 'chaveDoPedido', 'marcaDaSessao', 'contaAgora',
    'carregarFilaDeSaida', 'salvarFilaDeSaida', 'enfileirarSaida', 'marcarNaSaida', 'tirarDaFilaDeSaida', 'marcarEmAndamento',
    'reivindicacaoDestaAba', 'reivindicadoPorOutraAba', 'soltarMarcaDosItens', 'marcarSessaoViva', 'sessaoVivaDepoisDe',
    'recuarSaida', 'saidaEmRecuo', 'moverProFimDaSaida', 'esvaziarFilaDeSaida', 'handleUnauthorized',
    'handleActionResult', 'scheduleAction', 'anotarAntesDoEnvio', 'anotarSeAbriuASaida', 'carimboDoGesto', 'handleReject'], deps);
  const responder = (v, r) => {
    const i = noAr.findIndex((x) => x.v === v);
    assert.ok(i >= 0, `${v} não está no ar`);
    noAr.splice(i, 1)[0].ok(r);
  };
  return {
    h, deps, AppState, ritmos, ritmo, responder,
    envios: () => envios.map((e) => e.v),
    enviosConferindo: () => envios.filter((e) => e.conferindo).map((e) => e.v),
    noAr: (v) => noAr.some((x) => x.v === v),
    temSonda: () => !!sonda,
    responderSonda: (r) => { const s = sonda; sonda = null; s(r); },
    fila: () => JSON.parse(safeLS.get(SAIDA_KEY) || '[]').map((x) => x.venueID),
    // A passada terminou — ou mandou A MAIS do que o teste espera (com o
    // defeito, ela fica presa esperando a resposta do envio que não devia sair).
    passadaAcabouOuMandou: (n) => !deps.esvaziandoSaida || envios.length > n,
  };
}

test('R8-2-02: o ✕ que leva 401 com a passada DORMINDO o ritmo vai ao Waze UMA vez — a passada acorda e para', async () => {
  const m = montarPassada({ saida: [itemDaSaida('v1')], fila: [P('v2'), P('v3')] });
  m.h.esvaziarFilaDeSaida();                         // a rede voltou: a passada manda o v1
  await ateQue(() => m.noAr('v1'), 'o v1 no ar');
  m.h.handleReject();                                // o ✕ no v2, sem Desfazer: anotado e mandado
  await ateQue(() => m.noAr('v2'), 'o ✕ do v2 no ar');
  m.responder('v1', { success: true });              // o v1 pousa: a passada dorme o ritmo antes do próximo
  await ateQue(() => m.ritmos.length === 1, 'a passada dormindo o ritmo');
  m.responder('v2', R401);                           // o 401 do ✕ chega DURANTE o ritmo
  await ateQue(() => m.temSonda() && !m.deps.pedidosEmAndamento.has('v2|uv2'),
    'a conferência começou e o executor soltou o v2 do "em andamento"');
  assert.equal(m.deps.verificandoSessao, true, 'PRÉ-CONDIÇÃO: a conferência não está no ar');
  assert.deepEqual(m.fila(), ['v2'], 'PRÉ-CONDIÇÃO: a decisão que levou o 401 não ficou na fila de saída');
  m.ritmos.shift()();                                // a passada acorda
  await ateQue(() => m.passadaAcabouOuMandou(2), 'a passada acordou');
  await tique(10);
  assert.deepEqual(m.envios(), ['v1', 'v2'],
    `DEFEITO: a passada mandou de novo, com a conferência no ar, a decisão que acabou de levar 401: ${m.envios().join(',')}`);
  // O veredito VIVA (alarme falso): quem chama de novo é o fim da conferência, e
  // a decisão sai UMA vez, depois dele.
  m.deps.proxima = () => ({ success: true });
  m.responderSonda(VIVA);
  await ateQue(() => m.fila().length === 0, 'a fila de saída vazia depois do alarme falso');
  await tique(10);
  assert.deepEqual(m.envios(), ['v1', 'v2', 'v2'], 'confirmada a sessão, a decisão não saiu (ou saiu mais de uma vez)');
  assert.deepEqual(m.enviosConferindo(), [], 'saiu decisão com a conferência no ar');
});

test('R8-2-02: CONTROLE — o veredito MORTA: a decisão que levou o 401 espera o próximo login, sem sair de novo', async () => {
  const m = montarPassada({ saida: [itemDaSaida('v1')], fila: [P('v2'), P('v3')] });
  m.h.esvaziarFilaDeSaida();
  await ateQue(() => m.noAr('v1'), 'o v1 no ar');
  m.h.handleReject();
  await ateQue(() => m.noAr('v2'), 'o ✕ do v2 no ar');
  m.responder('v1', { success: true });
  await ateQue(() => m.ritmos.length === 1, 'a passada dormindo o ritmo');
  m.responder('v2', R401);
  await ateQue(() => m.temSonda() && !m.deps.pedidosEmAndamento.has('v2|uv2'), 'a conferência começou');
  m.ritmos.shift()();
  await ateQue(() => m.passadaAcabouOuMandou(2), 'a passada acordou');
  m.responderSonda(MORTA);
  await ateQue(() => !m.deps.verificandoSessao, 'o veredito');
  await tique(10);
  assert.deepEqual(m.envios(), ['v1', 'v2'], 'com a sessão morta, a decisão saiu de novo');
  assert.deepEqual(m.fila(), ['v2'], 'a decisão de quem perdeu a sessão tem de ficar na fila de saída');
});

test('R8-2-02 (R8-1-06): a conferência de OUTRA chamada começa no meio da passada — os itens seguintes esperam o veredito', async () => {
  const m = montarPassada({ saida: [itemDaSaida('q1'), itemDaSaida('q2'), itemDaSaida('q3')] });
  m.h.esvaziarFilaDeSaida();
  await ateQue(() => m.noAr('q1'), 'o q1 no ar');
  m.h.handleUnauthorized();                          // o 401 de outra chamada (a busca, a presença)
  await ateQue(() => m.temSonda(), 'a conferência começou');
  m.responder('q1', { success: true });
  await ateQue(() => m.ritmos.length === 1, 'a passada dormindo o ritmo');
  m.ritmos.shift()();
  await ateQue(() => m.passadaAcabouOuMandou(1), 'a passada acordou');
  await tique(10);
  assert.deepEqual(m.envios(), ['q1'],
    `DEFEITO: com a conferência no ar, a passada seguiu mandando os itens: ${m.envios().join(',')}`);
  // VIVA: o fim da conferência esvazia, e os dois saem depois do veredito.
  m.ritmo.auto = true;
  m.deps.proxima = () => ({ success: true });
  m.responderSonda(VIVA);
  await ateQue(() => m.fila().length === 0, 'a fila de saída vazia depois do alarme falso');
  assert.deepEqual(m.envios(), ['q1', 'q2', 'q3']);
  assert.deepEqual(m.enviosConferindo(), [], 'saiu item com a conferência no ar');
});

test('R8-2-02: a REDE cai no meio da passada — o próximo item não sai (o envio já nasceria condenado)', async () => {
  const rodar = async (caiu) => {
    const m = montarPassada({ saida: [itemDaSaida('q1'), itemDaSaida('q2')] });
    m.h.esvaziarFilaDeSaida();
    await ateQue(() => m.noAr('q1'), 'o q1 no ar');
    m.responder('q1', { success: true });
    await ateQue(() => m.ritmos.length === 1, 'a passada dormindo o ritmo');
    if (caiu) m.deps.navigator.onLine = false;
    m.ritmos.shift()();
    await ateQue(() => m.passadaAcabouOuMandou(1), 'a passada acordou');
    await tique(10);
    return m.envios();
  };
  assert.deepEqual(await rodar(true), ['q1'], 'DEFEITO: sem rede, a passada mandou o item seguinte');
  // CONTROLE: com a rede de pé, o item seguinte sai — o instrumento enxerga o envio.
  assert.deepEqual(await rodar(false), ['q1', 'q2'], 'CONTROLE: com rede, o item seguinte não saiu');
});

test('R8-2-02: a sessão TROCA no ritmo (a queda renovada) — a passada da sessão que caiu não manda; a da nova manda UMA vez', async () => {
  const m = montarPassada({ saida: [itemDaSaida('q1'), itemDaSaida('q2')] });
  m.h.esvaziarFilaDeSaida();
  await ateQue(() => m.noAr('q1'), 'o q1 no ar');
  m.responder('q1', { success: true });
  await ateQue(() => m.ritmos.length === 1, 'a passada dormindo o ritmo');
  m.deps.epocaDaSessao++;                            // caiu e a extensão renovou (a MESMA conta), durante o ritmo
  m.ritmos.shift()();
  await ateQue(() => m.passadaAcabouOuMandou(1), 'a passada acordou');
  await tique(10);
  assert.deepEqual(m.envios(), ['q1'],
    'DEFEITO: a passada da sessão que caiu mandou o item com a sessão nova — a resposta seria jogada fora e o item, mandado de novo');
  // A renovação chama o esvaziamento: o item sai pela passada da sessão nova, UMA vez.
  m.ritmo.auto = true;
  m.deps.proxima = () => ({ success: true });
  m.h.esvaziarFilaDeSaida();
  await ateQue(() => m.fila().length === 0, 'a fila de saída vazia depois da renovação');
  assert.deepEqual(m.envios(), ['q1', 'q2']);
});

// A guarda de cada item são as MESMAS condições da entrada (mais a sessão da
// passada), e mora depois da última espera antes do envio — o ritmo e, na
// reserva sem a trava do navegador, a reivindicação. Condição nova na entrada
// que não chegue aqui reprova: era assim que a do K14/R7-1-05 valia só no topo.
test('R8-2-02: a guarda de CADA item tem as condições da entrada — depois da última espera, antes do envio', () => {
  const f = fatiar('esvaziarFilaDeSaida');
  const entrada = /if \((!AppState\.authenticated \|\|[^\n]*?)\) \{\s*esvaziandoSaida = false;\s*trava\.soltar\(\);/.exec(f);
  assert.ok(entrada, 'a guarda de depois da espera da trava mudou de forma — o teste não a acha');
  const termos = entrada[1].split('||').map((s) => s.trim());
  assert.ok(termos.length >= 4, `a guarda da entrada perdeu condições: ${termos.join(' | ')}`);
  const iLaco = f.indexOf('while (f.length)');
  const iReivindica = f.indexOf('await reivindicarNaSaida(item)', iLaco);
  const iEnvio = f.indexOf('await API.', iLaco);
  assert.ok(iLaco > 0 && iReivindica > iLaco && iEnvio > iReivindica,
    'a ordem do laço mudou (o ritmo, a reivindicação e o envio) — o teste não sabe mais onde a guarda deve estar');
  const guarda = /if \(([^;]*?)\) break;/.exec(f.slice(iReivindica + 'await reivindicarNaSaida(item)'.length, iEnvio));
  assert.ok(guarda, 'DEFEITO: não há guarda entre a última espera e o envio — a conferência que começa no meio não para a passada');
  const cond = guarda[1].replace(/\s+/g, ' ');
  for (const t of termos) assert.ok(cond.includes(t), `DEFEITO: a guarda de cada item não confere "${t}", que a entrada confere`);
  assert.ok(cond.includes('epoca !== epocaDaSessao'), 'DEFEITO: a guarda de cada item não confere a sessão da passada');
});

// Os testes de cima fatiam o FONTE; o app carrega o `js/min/` (gotcha #22). Os
// nomes de topo sobrevivem ao minificador: quantas vezes cada um é CHAMADO tem
// de bater nos dois.
test('o bundle GERADO tem os consertos (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  for (const re of [/saidaEmRecuo\(/g, /aprovacaoDelaJaPousou\(/g, /desfechoDaAprovacaoDela\(/g, /refazerDepoisDo401\(/g]) {
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${re} — falta \`npm run js\``);
  }
});
