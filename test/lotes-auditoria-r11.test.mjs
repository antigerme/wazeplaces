// O "Marcar todos" diante do que muda NO MEIO dele, e o dia em que ele conta
// (auditoria de 2026-10-07, rodada 11 — o lote 15 da fila):
//
//  · R11-2-02 — a outra aba decidia um pedido de um pedaço que ainda não tinha
//    saído, e o lote o mandava assim mesmo e o contava como lido: por cima da
//    rejeição de lá, ou lido duas vezes (os alvos eram filtrados pela anotação
//    UMA vez só, no começo; no um a um, o "já tratado" virava lido);
//  · R11-2-04 — o lote que deixava o card da FRENTE de fora (já lido, decidido
//    na outra aba) não refazia a tela: o card de fundo seguia mostrando um
//    pedido que acabou de sair da fila, e o "Ver +N" seguia velho;
//  · R11-2-05 — o placar subia a cada pedaço e o "Restam" só descia no fim:
//    no meio, o que o Waze já marcou contava nos DOIS números (Lidos 65 e
//    Restam 60 num lote de 60 com 40 lidos — 125 de 100);
//  · R11-7-06 — o lote tocado às 23:59 que pousava depois da meia-noite
//    somava no balde do dia do gesto e julgava o "Centurião" pelo balde de
//    hoje: com 120 no balde do gesto, a conquista não saía.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" que aceita qualquer chamada (o `montar` de
// test/lotes-auditoria-r10). O Waze de mentira responde quando o TESTE solta
// (`portoes`): é assim que o teste fica no meio do laço. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const MIN = ler('js/min/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Pula a ASSINATURA antes de casar chaves (um `{}` de parâmetro padrão abriria e
// fecharia na hora).
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
// e as variáveis de módulo, que elas leem e escrevem direto no objeto. O resto é
// buraco negro.
function montar(nomes, deps) {
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
  return {
    guardado,
    localStorage: {
      getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
      setItem: (k, v) => guardado.set(k, String(v)),
      removeItem: (k) => guardado.delete(k),
    },
  };
};
const chave = (p) => (p && p.venueID != null && p.updateRequestID != null ? p.venueID + '|' + p.updateRequestID : null);
const GESTO = { dia: '2026-10-07', onde: '30', t: 1, lang: 'pt' };
const OK = { success: true };
const JA_TRATADO = { success: false, errorCategory: 'already_processed', httpCode: 500 };
const lido = (i, extra = {}) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 900, ...extra });

// O "Marcar todos" de verdade (`openBatchReadConfirm` + `handleBatchMarkRead`),
// com o placar GRAVADO de verdade (`saveStats`). O Waze responde quando o teste
// solta. `decididos`: a anotação da outra aba (`decididosPorOutraAbaComCardAqui`),
// um WeakSet de VERDADE que o teste enche no meio do lote, como o aviso da outra
// aba enche. `serverTotal`: o "Restam" da abertura (o Waze pode ter mais do que
// a fila carregou). Cada `updatePendingCount` fotografa o placar e o "Restam"
// que a tela mostraria naquele instante.
function montarMarcarTodos({ fila, pedaco = 2, placar = 40, serverTotal = null, decididos = new WeakSet(),
  aprovadaDela = () => false, aoMudar = null } = {}) {
  const { guardado, localStorage } = lsFalso();
  const STATS_KEY = constante('STATS_KEY');
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { read: placar, rejected: 0, skipped: 0 },
    serverTotal: serverTotal === null ? fila.length : serverTotal, fetchEpoch: 0, hasMore: false, pendingAction: null, inFlightActions: 0 };
  const mensagem = { textContent: '' };
  const portoes = [];
  const enviados = [];
  const historico = [];
  const confirmados = [];
  const desfechos = [];
  const toasts = [];
  const pelaOutraAba = [];
  const devolvidos = [];
  const telas = [];          // o que a tela mostraria a cada `updatePendingCount`: [Lidos, Restam]
  const refeitas = [];       // a fila no instante de cada `aoMudarAFilaPorBaixo`
  const deps = {
    AppState, localStorage, STATS_KEY, LOTE_LIDOS_PEDACO: pedaco, epocaDaSessao: 0, Treino: { ativo: false },
    pedidosEmAndamento: new Set(), loteDeLidosContado: null, loteDeLidosEmVoo: false, escritasConferindo: 0, tratouNestaFila: false,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, contaDestaAbaEmDuvida: () => false,
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), callWithRetry: (fn) => fn(),
    decididosPorOutraAbaComCardAqui: decididos,
    API: {
      getRegion: () => 'row',
      markAsReadBatch: (itens) => new Promise((ok) => { enviados.push(itens.map((x) => x.updateRequestID).join('+')); portoes.push(ok); }),
      markAsRead: (v, u) => new Promise((ok) => { enviados.push('um:' + u); portoes.push(ok); }),
    },
    carimboDoGesto: () => GESTO, chaveDoPedido: chave,
    recordHistory: (tipo, n, dia, onde) => historico.push([tipo, n, dia, onde]),
    registrarLoteConfirmado: (n, gesto) => confirmados.push([n, gesto && gesto.dia]),
    aprovacaoDelaJaPousou: (p) => aprovadaDela(p),
    desfechoDaAprovacaoDela: (tipo, p, contado) => desfechos.push(`${tipo}:${p.updateRequestID}:${contado}`),
    pousouPorOutraAba: (p, tipo) => pelaOutraAba.push(`${tipo}:${p.updateRequestID}`),
    devolverPedidoRecusado: (ps) => devolvidos.push(...(Array.isArray(ps) ? ps : [ps]).map((p) => p.updateRequestID)),
    showToast: (m, tipo) => toasts.push(`${tipo}:${m}`), msgDoServidor: (r, d) => d,
    t: (k, v) => (v && v.n != null ? `${k}#${v.n}` : k),
    document: { getElementById: (id) => (id === 'batchReadMessage' ? mensagem : null) },
    openModal: () => {}, closeModal: () => {},
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
    updatePendingCount: () => telas.push([AppState.stats.read, AppState.serverTotal]),
    aoMudarAFilaPorBaixo: () => { refeitas.push(AppState.queue.map((p) => p.updateRequestID)); if (aoMudar) aoMudar(); },
  };
  const h = montar(['openBatchReadConfirm', 'handleBatchMarkRead', 'acoesTravadas', 'acoesTravadasForaDaJanela',
    'aprovacaoDaTelaNoAr', 'avisoDaTrava', 'marcarEmAndamento', 'saveStats'], deps);
  const gravado = () => JSON.parse(guardado.get(STATS_KEY) || 'null');
  const soltar = (resp) => portoes.shift()(resp);
  const fila_ = () => AppState.queue.map((p) => p.updateRequestID);
  const marcarTodos = () => { h.openBatchReadConfirm(); return h.handleBatchMarkRead(); };
  return { h, deps, AppState, mensagem, portoes, enviados, historico, confirmados, desfechos, toasts, pelaOutraAba, devolvidos,
    telas, refeitas, gravado, soltar, fila: fila_, marcarTodos };
}

// Solta, um a um, o que chegar ao Waze de mentira até o lote terminar, com teto:
// o teste precisa ver o lote mandar o que não devia (não pendurar).
async function terminar(m, lote, resp = OK, tetoMs = 3000) {
  let fim = false;
  lote.then(() => { fim = true; }, () => { fim = true; });
  const teto = performance.now() + tetoMs;
  while (!fim) {
    if (performance.now() > teto) assert.fail('o lote não terminou');
    while (m.portoes.length) m.soltar(typeof resp === 'function' ? resp() : resp);
    await tique(2);
  }
  await lote;
}

// ═══ R11-2-05 · o "Restam" desce junto com o placar, pedaço a pedaço ═════════
// O roteiro do auditor (n04): lote de 60 em pedaços de 25, Lidos 40, o 2º pedaço
// segurado — no meio, "Lidos 65" e "Restam 60". Aqui pedaços de 2: o instante
// "no meio" é o 2º pedaço no ar. O "Restam" da abertura é MAIOR que a fila (o
// Waze tem mais do que veio): é o que faz o desconto em DOBRO aparecer no fim.
test('R11-2-05: no meio do "Marcar todos", o pedaço que pousou sai do "Restam" junto com o placar — e o fim não desconta de novo', async () => {
  const m = montarMarcarTodos({ fila: [1, 2, 3, 4, 5].map((i) => lido(i)), serverTotal: 10 });
  const lote = m.marcarTodos();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedaço saiu');
  // CONTROLE: nada desce antes de o Waze responder (o lote não é otimista).
  assert.deepEqual([m.AppState.stats.read, m.AppState.serverTotal], [40, 10], 'o lote contou ANTES de o Waze marcar');
  m.soltar(OK);                                       // u1+u2 pousam
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 2, 'PRÉ-CONDIÇÃO: o 2º pedaço está no ar');
  assert.equal(m.AppState.stats.read, 42, 'PRÉ-CONDIÇÃO: o pedaço que pousou conta no placar (R10-2-03)');
  assert.equal(m.AppState.serverTotal, 8,
    `DEFEITO: o pedaço que o Waze já marcou conta no "Lidos" e segue no "Restam" (Restam ${m.AppState.serverTotal}, Lidos 42)`);
  assert.deepEqual(m.telas.at(-1), [42, 8], `a TELA não foi redesenhada com o "Restam" novo: ${JSON.stringify(m.telas)}`);
  m.soltar(OK);                                       // u3+u4
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 3, 'PRÉ-CONDIÇÃO: o 3º pedaço está no ar');
  assert.deepEqual([m.AppState.stats.read, m.AppState.serverTotal], [44, 6]);
  // A soma Lidos + Restam fica a mesma em todo instante do lote.
  assert.ok(m.telas.every(([l, r]) => l + r === 50), `no meio do lote a tela contou o mesmo pedido duas vezes: ${JSON.stringify(m.telas)}`);
  m.soltar(OK);                                       // u5
  await lote;
  assert.deepEqual(m.fila(), [], 'os marcados ficaram na fila');
  assert.equal(m.AppState.serverTotal, 5,
    `DEFEITO: o fim descontou de novo o que já tinha descido pedaço a pedaço (Restam ${m.AppState.serverTotal}, devia ser 10 − 5)`);
  assert.equal(m.AppState.stats.read, 45);
  assert.deepEqual(m.toasts.filter((x) => x.startsWith('success:')), ['success:toast.batchDonePlural#5']);
});

test('R11-2-05: no caminho UM A UM, cada pedido que pousa desce o "Restam" na hora', async () => {
  const m = montarMarcarTodos({ fila: [1, 2, 3].map((i) => lido(i)), pedaco: 3 });
  const lote = m.marcarTodos();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o pedaço saiu');
  m.soltar(JA_TRATADO);                               // o Waze parou num já resolvido: um a um
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 2, 'PRÉ-CONDIÇÃO: o um a um começou');
  m.soltar(OK);                                       // u1
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 3, 'PRÉ-CONDIÇÃO: o u2 está no ar');
  assert.deepEqual([m.AppState.stats.read, m.AppState.serverTotal], [41, 2],
    'DEFEITO: o pedido que pousou no um a um conta no "Lidos" e segue no "Restam"');
  m.soltar(OK);
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 4, 'o u3 saiu');
  m.soltar(OK);
  await lote;
  assert.deepEqual([m.AppState.stats.read, m.AppState.serverTotal], [43, 0]);
});

// A fila REFEITA no meio do lote (↻, troca de filtro) tem o "Restam" dela, e a
// fila nova não tem estes pedidos (estavam em andamento): o pedaço que pousa
// DEPOIS não desce o "Restam" dela — a régua do fim (`epocaFila`), agora também
// no meio.
test('R11-2-05: com a fila REFEITA no meio (↻), o pedaço que pousa depois não desce o "Restam" da fila nova', async () => {
  const m = montarMarcarTodos({ fila: [1, 2, 3, 4].map((i) => lido(i)) });
  const lote = m.marcarTodos();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedaço saiu');
  m.soltar(OK);
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 2, 'PRÉ-CONDIÇÃO: o 2º pedaço está no ar');
  assert.equal(m.AppState.serverTotal, 2, 'PRÉ-CONDIÇÃO: o 1º pedaço desceu o "Restam" da fila do gesto');
  // O ↻: a fila é refeita (`resetQueue`) e a busca traz a nova, sem os do lote.
  m.AppState.fetchEpoch++;
  m.AppState.queue = [lido(8), lido(9)];
  m.AppState.currentPlace = m.AppState.queue[0];
  m.AppState.serverTotal = 2;
  m.soltar(OK);                                       // u3+u4 pousam depois do ↻
  await lote;
  assert.equal(m.AppState.serverTotal, 2,
    `DEFEITO: o pedaço da fila velha desceu o "Restam" da fila NOVA (${m.AppState.serverTotal})`);
  assert.deepEqual(m.fila(), ['u8', 'u9'], 'a resposta da fila velha mexeu na fila nova');
  assert.equal(m.AppState.stats.read, 44, 'o que pousou conta no placar (a decisão foi da pessoa), com ou sem ↻');
});

// ═══ R11-2-02 · o que a OUTRA aba decide com o lote no ar não vai, nem conta ══
// O roteiro do auditor (n09): lote de 30 (pedaços 25 + 5), o 1º pedaço segurado,
// e a outra aba rejeita o up27 — esta aba ANOTA o up27 (`bAnotou: true`), mas o
// lote o mandava no 2º pedaço; o Waze parava nele e o um a um contava o "já
// tratado" como LIDO: "Rejeitados 1 + Lidos 50", Histórico 31 pra 30 pedidos, e
// "30 pedidos marcados". Com ✓ lá, o up27 era marcado DUAS vezes no Waze.
test('R11-2-02: a outra aba decide um pedido de um pedaço que ainda não saiu — ele não vai ao Waze, não conta, e sai da fila', async () => {
  const fila = [1, 2, 3, 4, 5].map((i) => lido(i));
  const decididos = new WeakSet();
  const m = montarMarcarTodos({ fila, decididos });
  const lote = m.marcarTodos();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedaço saiu');
  decididos.add(fila[3]);                             // o aviso da outra aba: o u4 foi decidido lá
  await terminar(m, lote);
  assert.deepEqual(m.enviados, ['u1+u2', 'u3', 'u5'],
    `DEFEITO: o lote mandou ao Waze o pedido que a outra aba decidiu no meio dele: ${m.enviados.join(' ')}`);
  assert.equal(m.AppState.stats.read, 44, `DEFEITO: o placar contou o pedido da outra aba (Lidos ${m.AppState.stats.read})`);
  assert.equal(m.historico.reduce((s, x) => s + x[1], 0), 4, 'DEFEITO: o Histórico contou o pedido da outra aba');
  assert.deepEqual(m.toasts.filter((x) => x.startsWith('success:')), ['success:toast.batchDonePlural#4'],
    'DEFEITO: o aviso contou o pedido da outra aba como marcado aqui');
  // Ele SAI da fila, como sairia no aviso da outra aba se não estivesse em
  // andamento aqui (`tirarDaFilaOQueAOutraAbaDecidiu`), e o "Restam" desce.
  assert.deepEqual(m.fila(), [], 'o pedido decidido na outra aba ficou na fila desta, como card');
  assert.equal(m.AppState.serverTotal, 0, 'o "Restam" seguiu contando o pedido decidido na outra aba');
  assert.deepEqual(m.pelaOutraAba, [], 'o pedido que nem saiu daqui não é "pousou por outra aba"');
  assert.deepEqual(m.devolvidos, [], 'o lote devolveu à busca o que a outra aba decidiu');
});

test('R11-2-02: no UM A UM, o anotado com o pedaço no ar não sai; e o "já tratado" de um anotado no meio da ida é a decisão de lá, sem contar', async () => {
  // a) a anotação chega com o PEDAÇO no ar: o Waze para no u2 (decidido lá), e
  //    o um a um nem o manda.
  {
    const fila = [1, 2, 3].map((i) => lido(i));
    const decididos = new WeakSet();
    const m = montarMarcarTodos({ fila, pedaco: 3, decididos });
    const lote = m.marcarTodos();
    await ateQue(() => m.portoes.length === 1, 'a) PRÉ-CONDIÇÃO: o pedaço saiu');
    decididos.add(fila[1]);
    m.soltar(JA_TRATADO);
    await terminar(m, lote);
    assert.deepEqual(m.enviados, ['u1+u2+u3', 'um:u1', 'um:u3'],
      `a) DEFEITO: o um a um mandou o pedido que a outra aba decidiu: ${m.enviados.join(' ')}`);
    assert.equal(m.AppState.stats.read, 42, `a) DEFEITO: o placar contou o pedido da outra aba (${m.AppState.stats.read})`);
    assert.deepEqual(m.fila(), [], 'a) o pedido decidido na outra aba ficou na fila');
    assert.equal(m.AppState.serverTotal, 0);
  }
  // b) a anotação chega com o PEDIDO no ar, no um a um: o "já tratado" é a
  //    decisão de lá (`pousouPorOutraAba`), sem contar.
  {
    const fila = [1, 2, 3].map((i) => lido(i));
    const decididos = new WeakSet();
    const m = montarMarcarTodos({ fila, pedaco: 3, decididos });
    const lote = m.marcarTodos();
    await ateQue(() => m.portoes.length === 1, 'b) PRÉ-CONDIÇÃO: o pedaço saiu');
    m.soltar(JA_TRATADO);
    await ateQue(() => m.portoes.length === 1 && m.enviados.length === 2, 'b) PRÉ-CONDIÇÃO: o um a um começou');
    m.soltar(OK);                                     // u1
    await ateQue(() => m.portoes.length === 1 && m.enviados.length === 3, 'b) PRÉ-CONDIÇÃO: o u2 está no ar');
    decididos.add(fila[1]);                           // a outra aba decidiu o u2 enquanto ele ia
    m.soltar(JA_TRATADO);
    await terminar(m, lote);
    assert.deepEqual(m.pelaOutraAba, ['read:u2'], 'b) DEFEITO: o "já tratado" do pedido que a outra aba decidiu não foi dado a ela');
    assert.equal(m.AppState.stats.read, 42, `b) DEFEITO: o "já tratado" da outra aba contou como lido aqui (${m.AppState.stats.read})`);
    assert.equal(m.historico.reduce((s, x) => s + x[1], 0), 2, 'b) DEFEITO: o Histórico contou o pedido da outra aba');
    assert.deepEqual(m.toasts.filter((x) => x.startsWith('success:')), ['success:toast.batchDonePlural#2']);
    assert.deepEqual(m.fila(), [], 'b) o pedido decidido na outra aba ficou na fila');
  }
  // CONTROLE: sem a anotação, o "já tratado" do u2 é de OUTRO editor — conta
  // como tratado, como sempre (o instrumento distingue os dois).
  {
    const m = montarMarcarTodos({ fila: [1, 2, 3].map((i) => lido(i)), pedaco: 3 });
    const lote = m.marcarTodos();
    await ateQue(() => m.portoes.length === 1, 'CONTROLE: o pedaço saiu');
    m.soltar(JA_TRATADO);
    await ateQue(() => m.portoes.length === 1 && m.enviados.length === 2, 'CONTROLE: o um a um começou');
    m.soltar(OK);
    await ateQue(() => m.portoes.length === 1 && m.enviados.length === 3, 'CONTROLE: o u2 está no ar');
    m.soltar(JA_TRATADO);
    await terminar(m, lote);
    assert.deepEqual(m.pelaOutraAba, []);
    assert.equal(m.AppState.stats.read, 43, 'CONTROLE: o "já tratado" de outro editor deixou de contar');
  }
});

// O card da TELA anotado no meio do lote FICA (trocar o card debaixo do dedo é
// pior que um gesto a mais; o gesto nele diz por quê, `gestoNoDecididoPorOutraAba`),
// como no aviso da outra aba. Ele só pode ficar de fora no um a um: é o 1º alvo.
test('R11-2-02: o card da TELA que a outra aba decide no meio do lote fica na fila, sem contar e sem descer o "Restam"', async () => {
  const fila = [1, 2, 3].map((i) => lido(i));
  const decididos = new WeakSet();
  const m = montarMarcarTodos({ fila, pedaco: 3, decididos });
  const lote = m.marcarTodos();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o pedaço saiu');
  decididos.add(fila[0]);                             // o da tela, decidido na outra aba
  m.soltar(JA_TRATADO);
  await terminar(m, lote);
  assert.deepEqual(m.enviados, ['u1+u2+u3', 'um:u2', 'um:u3'], `o um a um mandou o card da tela decidido lá: ${m.enviados.join(' ')}`);
  assert.deepEqual(m.fila(), ['u1'], 'o card da tela decidido na outra aba saiu de baixo do dedo (ou os marcados ficaram)');
  assert.equal(m.AppState.currentPlace && m.AppState.currentPlace.updateRequestID, 'u1');
  // O gesto nele desce o "Restam" (`gestoNoDecididoPorOutraAba`): aqui, não.
  assert.equal(m.AppState.serverTotal, 1, 'o "Restam" desceu pelo card da tela, que o gesto nele vai descer de novo');
  assert.equal(m.AppState.stats.read, 42);
});

// Numa fila REFEITA no meio (↻), o que o lote não marcou volta pela busca
// (`devolverPedidoRecusado`, V9): o que a outra aba decidiu não volta.
test('R11-2-02: com a fila REFEITA no meio, o pedido que a outra aba decidiu não volta pela busca', async () => {
  const fila = [1, 2, 3].map((i) => lido(i));
  const decididos = new WeakSet();
  const m = montarMarcarTodos({ fila, pedaco: 1, decididos });
  const lote = m.marcarTodos();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedaço saiu');
  m.AppState.fetchEpoch++;                            // o ↻
  m.AppState.queue = [lido(8)];
  m.AppState.currentPlace = m.AppState.queue[0];
  decididos.add(fila[2]);                             // e a outra aba decidiu o u3
  await terminar(m, lote, () => (m.enviados.length >= 2 ? { success: false, errorCategory: 'unknown' } : OK));
  assert.deepEqual(m.enviados, ['u1', 'u2'], 'PRÉ-CONDIÇÃO: o u2 falhou de vez, e o u3 nem saiu');
  assert.deepEqual(m.devolvidos, ['u2'], `DEFEITO: a busca vai trazer de volta o pedido que a outra aba decidiu: ${m.devolvidos}`);
});

// ═══ R11-2-04 · a frente FICA: a pilha e o "Ver +N" acompanham a fila ════════
// O roteiro do auditor (n14): fila u1–u5 do mesmo autor, u1 "já lido" na frente
// (com "Apenas não lidos" desmarcado). O lote manda u2–u5 e deixa a frente — e a
// tela não era refeita: o card de FUNDO seguia "v2|u2" (marcado, fora da fila)
// e o selo "Ver +4"; tocado, a barra "Primeiro os de … 1 de 1".
test('R11-2-04: o "Marcar todos" que deixa a FRENTE de fora (já lida) refaz a pilha e o "Ver +N" com a fila de DEPOIS', async () => {
  const fila = [lido(1, { isRead: true }), ...[2, 3, 4, 5].map((i) => lido(i))];
  const m = montarMarcarTodos({ fila, pedaco: 25 });
  const lote = m.marcarTodos();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o lote saiu');
  assert.deepEqual(m.enviados, ['u2+u3+u4+u5'], 'PRÉ-CONDIÇÃO: o lote deixou a frente (já lida) de fora');
  m.soltar(OK);
  await lote;
  assert.deepEqual(m.fila(), ['u1'], 'PRÉ-CONDIÇÃO: a frente ficou e os marcados saíram');
  assert.deepEqual(m.refeitas, [['u1']],
    `DEFEITO: a fila mudou por baixo do card da frente e a pilha e o "Ver +N" não foram refeitos (ou foram com a fila de antes): ${JSON.stringify(m.refeitas)}`);
});

test('R11-2-04: a frente que a OUTRA aba decidiu (a junção) também — a pilha não fica mostrando um pedido marcado', async () => {
  const fila = [1, 2, 3].map((i) => lido(i));
  const m = montarMarcarTodos({ fila, pedaco: 25, decididos: new WeakSet([fila[0]]) });
  const lote = m.marcarTodos();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o lote saiu');
  m.soltar(OK);
  await lote;
  assert.deepEqual(m.fila(), ['u1']);
  assert.deepEqual(m.refeitas, [['u1']], `DEFEITO: a pilha seguiu com a fila de antes do lote: ${JSON.stringify(m.refeitas)}`);
});

test('R11-2-04: CONTROLE — a frente SAI no lote (o card novo nasce com a fila de agora) e o lote que falha (nada mudou): nada a refazer', async () => {
  // u3 já lido fica, e vira o card da frente NOVO (o `showCurrentPlace`).
  const sai = montarMarcarTodos({ fila: [lido(1), lido(2), lido(3, { isRead: true })], pedaco: 25 });
  const l1 = sai.marcarTodos();
  await ateQue(() => sai.portoes.length === 1, 'o lote saiu');
  sai.soltar(OK);
  await l1;
  assert.deepEqual(sai.fila(), ['u3'], 'PRÉ-CONDIÇÃO: a frente saiu no lote e sobrou um card');
  assert.equal(sai.AppState.currentPlace && sai.AppState.currentPlace.updateRequestID, 'u3', 'PRÉ-CONDIÇÃO: o card novo está na frente');
  assert.deepEqual(sai.refeitas, [], 'a frente saiu e o card novo é desenhado do zero: refazer por baixo é trabalho à toa');
  const falha = montarMarcarTodos({ fila: [lido(1, { isRead: true }), lido(2)], pedaco: 25 });
  const l2 = falha.marcarTodos();
  await ateQue(() => falha.portoes.length === 1, 'o lote saiu');
  falha.soltar({ success: false, errorCategory: 'unknown' });
  await l2;
  assert.deepEqual(falha.fila(), ['u1', 'u2'], 'PRÉ-CONDIÇÃO: o lote que falha não tira nada da fila');
  assert.deepEqual(falha.refeitas, [], 'o lote que não mudou a fila refez a pilha');
});

// E o `aoMudarAFilaPorBaixo` DE VERDADE, chamado pelo fim do lote: o card de
// fundo que mostra um pedido que saiu é refeito, e os selos do card da frente
// são recontados (sem DOM: o card, a linha dos selos e o fundo de mentira).
test('R11-2-04: o fim do lote, pelo `aoMudarAFilaPorBaixo` de verdade, refaz o card de FUNDO que mostrava um pedido marcado', async () => {
  const fila = [lido(1, { isRead: true }), ...[2, 3].map((i) => lido(i))];
  const feito = [];
  const fundo = { dataset: { pedido: 'v2|u2' } };
  const card = { querySelector: () => null };
  let real = null;
  const m = montarMarcarTodos({ fila, pedaco: 25, aoMudar: () => real() });
  const a = montar(['aoMudarAFilaPorBaixo'], {
    AppState: m.AppState, chaveDoPedido: chave, aquecimentoDaFrenteFeito: true,
    cardDaFrente: () => card, seloComFoco: () => null,
    renderSelosDeProcedencia: (c, p) => feito.push('selos:' + p.updateRequestID),
    renderFocoAutor: () => feito.push('barra'),
    montarCardDeFundo: () => feito.push('fundo:' + (chave(m.AppState.queue[1]) || '-')),
    document: { querySelector: (s) => (s === '#cardStack .card-fundo' ? fundo : null) },
  });
  real = a.aoMudarAFilaPorBaixo;
  const lote = m.marcarTodos();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o lote saiu');
  m.soltar(OK);
  await lote;
  assert.deepEqual(feito, ['selos:u1', 'barra', 'fundo:-'],
    `DEFEITO: o card de fundo seguiu mostrando o pedido que o lote marcou (ou os selos não foram recontados): ${JSON.stringify(feito)}`);
});

// ═══ R11-7-06 · o "Centurião" do lote é o balde do DIA do gesto ═══════════════
// O roteiro do auditor (c04, relógio do Playwright): 90 no dia, "Marcar todos" de
// 30 tocado às 23:59:4x, a resposta solta às 00:00:05 — o balde `2026-10-07`
// fica com 120 e `centuriao: false`. O ✓ de um card no mesmo instante dava (a
// `registrarAcaoConfirmada` já julga pelo balde do `gesto.dia`, H11).
function montarConfirmacao({ agora, historico }) {
  const ctxs = [];
  const DataFalsa = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(agora); }
    static now() { return agora; }
  };
  const deps = {
    Treino: { ativo: false }, carregarConquistas: () => ({ seq: 0 }), salvarConquistas() {},
    registrarIdiomaUsado() {}, getLang: () => 'pt', contagemDoAutor: () => 0,
    checarConquistas: (x) => ctxs.push(x || {}), filaZeradaConfirmada: () => false, checkUndoGateUnlock() {},
    loadHistory: () => historico, Date: DataFalsa, CONQUISTAS: constante('CONQUISTAS'),
  };
  const h = montar(['registrarLoteConfirmado', 'registrarAcaoConfirmada', 'avaliarConquistas'], deps);
  // CONTROLE do instrumento: a régua de VERDADE distingue 99 de 100 (sem a lista
  // de verdade, um buraco negro "incluiria" qualquer coisa).
  assert.deepEqual(h.avaliarConquistas({ hoje: 99 }, {}).includes('centuriao'), false, 'CONTROLE: o "Centurião" saiu com 99');
  assert.deepEqual(h.avaliarConquistas({ hoje: 100 }, {}).includes('centuriao'), true, 'CONTROLE: o "Centurião" não saiu com 100');
  return { h, ctxs };
}

test('R11-7-06: o "Marcar todos" que POUSA depois da meia-noite julga o "Centurião" pelo balde do DIA do gesto', () => {
  const gesto = { t: new Date(2026, 9, 7, 23, 59, 45).getTime(), dia: '2026-10-07', onde: '30', lang: 'pt' };
  const m = montarConfirmacao({ agora: new Date(2026, 9, 8, 0, 0, 5).getTime(),
    historico: { '2026-10-07': { read: 120, rejected: 0 }, '2026-10-08': { read: 0, rejected: 0 } } });
  m.h.registrarLoteConfirmado(30, gesto);
  const ctx = m.ctxs.at(-1);
  assert.equal(ctx.hoje, 120,
    `DEFEITO: o lote julgou o "Centurião" pelo balde de ${ctx.hoje === undefined ? 'HOJE (o dia novo)' : ctx.hoje}, não o do dia do gesto`);
  assert.ok(m.h.avaliarConquistas(ctx, {}).includes('centuriao'), 'com 120 no dia do gesto, o "Centurião" não sairia');
  // A MESMA régua do ✓ do card (H11): o mesmo trabalho, o mesmo julgamento.
  m.h.registrarAcaoConfirmada('read', {}, gesto);
  assert.equal(m.ctxs.at(-1).hoje, ctx.hoje, 'o ✓ do card e o lote julgam o "Centurião" do mesmo gesto por baldes diferentes');
});

test('R11-7-06: CONTROLE — sem o dia do gesto, o lote deixa o balde de hoje com o `checarConquistas`, como sempre', () => {
  const m = montarConfirmacao({ agora: new Date(2026, 9, 8, 10, 0).getTime(),
    historico: { '2026-10-07': { read: 120, rejected: 0 } } });
  m.h.registrarLoteConfirmado(12);
  assert.equal('hoje' in m.ctxs.at(-1), false, 'sem gesto, o lote inventou um balde');
  m.h.registrarLoteConfirmado(12, { t: Date.now(), dia: null });
  assert.equal('hoje' in m.ctxs.at(-1), false, 'gesto sem dia (o carimbo neutro) inventou um balde');
});

// Os testes de cima fatiam o FONTE; o app carrega o `js/min/` (gotcha #22).
test('o bundle GERADO tem os consertos (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  for (const re of [/pousouPorOutraAba\(/g, /aoMudarAFilaPorBaixo\(/g, /loadHistory\(\)\[/g, /decididosPorOutraAbaComCardAqui/g]) {
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${re} — falta \`npm run js\``);
  }
});
