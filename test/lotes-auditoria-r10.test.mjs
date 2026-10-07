// A recusa automática e o "Marcar todos" diante do que muda NO MEIO deles
// (auditoria de 2026-10-07, rodada 10 — o lote 14 da fila):
//
//  · R10-2-01 — desligar o interruptor do autor (ou o "Esquecer") com a recusa
//    automática no ar não parava nada: os pedidos que faltavam seguiam indo ao
//    Waze como rejeitados, no nome da pessoa, e com o "Esquecer" o autor voltava
//    à lista ("✕ 4 · rejeitado hoje"), recriado por essas rejeições;
//  · R10-2-03 — o "Marcar todos" somava o placar, o Histórico e as conquistas
//    só no FIM do laço: fechar o app no meio perdia o que o Waze já tinha marcado;
//  · R10-2-04 — o "Marcar todos" com "Apenas não lidos" desmarcado contava como
//    lidos os pedidos que JÁ estavam lidos (a faixa "já lido" do card);
//  · R10-2-07 — a recusa automática que levava 401 anotava "saida.abriu" no
//    diário com a fila de saída vazia.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" que aceita qualquer chamada (o `montar` de
// test/costura-sessao e de test/lotes-conferencia). O Waze de mentira responde
// quando o TESTE solta (`portoes`): é assim que o teste fica no meio do laço.
// Cada teste foi visto REPROVANDO com o conserto desfeito.
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
const chave = (p) => p.venueID + '|' + p.updateRequestID;
const GESTO = { dia: '2026-10-07', onde: '30', t: 1, lang: 'pt' };
const R401 = { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.sessionExpired', httpCode: 401 };
const OK = { success: true };
// O dia de hoje no eixo do registro de autores (o `diaDeHoje` do app): sem ele,
// a poda de 30 dias apagaria o registro montado aqui.
const hoje = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; };

// ═══ R10-2-01 · a recusa automática no ar e o gesto que a desliga ════════════

const AUTOR = 777;
const pedidoDe = (i, autor) => ({ venueID: 'v' + i, updateRequestID: (autor === AUTOR ? 'x' : 'u') + i, creatorId: autor,
  createdBy: autor === AUTOR ? 'spam' : 'autor' + autor });

// A fila do roteiro do auditor (q02): u1 na tela (outro autor), x2–x7 do autor
// marcado e u8. O registro do autor 777 com a recusa LIGADA, contagem 6. As
// funções da recusa, do interruptor, do "Esquecer" e do registro de autores são
// as de verdade, sobre um localStorage de mentira.
function montarRecusa({ portao = () => true, conta = () => true, auto = 1, decididos = null } = {}) {
  const { guardado, localStorage } = lsFalso();
  const AUTORES_KEY = constante('AUTORES_KEY');
  guardado.set(AUTORES_KEY, JSON.stringify({ v: [], r: { [String(AUTOR)]: [6, 'spam', hoje(), auto] } }));
  const fila = [pedidoDe(1, 1001), ...[2, 3, 4, 5, 6, 7].map((i) => pedidoDe(i, AUTOR)), pedidoDe(8, 1008)];
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { read: 0, rejected: 20, skipped: 0 },
    serverTotal: fila.length, fetchEpoch: 0, hasMore: false, inFlightActions: 0, autores: null };
  const enviados = [];
  const portoes = [];
  const avisos = [];
  const diario = [];
  const naSaida = [];
  const log = [];
  const deps = {
    AppState, localStorage, textoDaCopia: new WeakMap(), epocaDaSessao: 0, Treino: { ativo: false },
    AUTORES_KEY, AUTORES_MAX_VISTOS: constante('AUTORES_MAX_VISTOS'),
    AUTORES_MAX_REINCIDENTES: constante('AUTORES_MAX_REINCIDENTES'), AUTORES_MAX_DIAS: constante('AUTORES_MAX_DIAS'),
    podeRecusarAutomaticoAqui: () => portao(), contaConfirmada: () => conta(),
    pedidosEmAndamento: new Set(), recusaAutomaticaRodando: false, recusaAutomaticaPedidaDeNovo: false,
    recusaAutomaticaNestaFila: false,
    // A retentativa de VERDADE (`callWithRetry`), com esperas curtas: a recusa
    // confere antes de CADA ida, a primeira e as retentativas.
    navigator: { onLine: true }, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [40, 40],
    API: {
      getRegion: () => 'row',
      rejectPlace: (v, u) => new Promise((ok) => { enviados.push(u); portoes.push({ u, ok }); }),
    },
    carimboDoGesto: () => GESTO, chaveDoPedido: chave,
    showToast: (m) => {
      const a = { textos: [m], dispensado: false, texto(x) { a.textos.push(x); }, dispensar() { a.dispensado = true; } };
      avisos.push(a);
      return a;
    },
    t: (k, v) => (v && v.n != null ? `${k}#${v.n}` : k),
    renderHistory: () => {}, registrarPouso: () => {}, recordHistory: (tipo, n) => log.push(`historico:${tipo}:${n}`),
    aprovacaoDelaJaPousou: () => false, dfato: (k) => diario.push(k), handleUnauthorized: () => log.push('confere-sessao'),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
    // A fila de SAÍDA de mentira (o lote da PESSOA anota cada pedido antes de mandar).
    carregarFilaDeSaida: () => naSaida.slice(), salvarFilaDeSaida: (f) => naSaida.splice(0, naSaida.length, ...f),
    enfileirarSaida: (tipo, p, regiao, extra, calado, lista) => { (lista || naSaida).push(chave(p)); return true; },
    tirarDaFilaDeSaida: (tipo, p) => { const i = naSaida.indexOf(chave(p)); if (i < 0) return false; naSaida.splice(i, 1); return true; },
    reivindicacaoDestaAba: () => ({}),
  };
  if (decididos) deps.decididosPorOutraAbaComCardAqui = decididos(fila);
  const h = montar(['aplicarRecusaAutomatica', 'enviarLote', 'callWithRetry', 'autoLigado', 'alternarAutoDoAutor', 'esquecerAutor',
    'esquecerAutorDaLista', 'loadAutores', 'salvarAutores', 'podarAutores', 'diaDeHoje', 'registrarRejeicaoDeAutor',
    'listaDeAutores', 'copiaEmDia', 'lembrarTextoDaCopia'], deps);
  const registro = () => JSON.parse(guardado.get(AUTORES_KEY));
  const fila_ = () => AppState.queue.map((p) => p.updateRequestID);
  // Solta a resposta da próxima ida no ar (a da vez), com `resp`.
  const soltar = (resp) => portoes.shift().ok(resp);
  return { h, deps, AppState, enviados, portoes, avisos, diario, naSaida, log, registro, fila: fila_, soltar };
}

// Solta o que chegar ao Waze de mentira até a recusa terminar, com teto: sem o
// conserto o laço segue mandando, e o teste precisa vê-lo mandar (não pendurar).
async function terminar(m, recusa, tetoMs = 3000) {
  const fim = performance.now() + tetoMs;
  while (m.deps.recusaAutomaticaRodando) {
    if (performance.now() > fim) assert.fail('a recusa automática não terminou');
    while (m.portoes.length) m.soltar(OK);
    await tique(2);
  }
  await recusa;
}

// O roteiro do auditor (q02): o 1º pedido pousa, o 2º está no ar, e a pessoa faz
// o gesto (`gesto`). O 2º pousa (a ida que já estava no ar segue) e o resto…
async function recusaComGesto(m, gesto) {
  const recusa = m.h.aplicarRecusaAutomatica();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedido do autor saiu');
  m.soltar(OK);                                    // x2 pousa
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 2, 'PRÉ-CONDIÇÃO: o 2º pedido está no ar');
  if (gesto) gesto();
  m.soltar(OK);                                    // x3, que já estava no ar, pousa
  await terminar(m, recusa);
}

test('R10-2-01: desligar o interruptor do autor com a recusa automática no ar PARA o que falta — e o que falta volta pra fila', async () => {
  const m = montarRecusa();
  await recusaComGesto(m, () => {
    m.h.alternarAutoDoAutor(String(AUTOR));        // Filtros → Histórico → o interruptor do autor
    assert.equal(m.h.autoLigado(String(AUTOR)), false, 'PRÉ-CONDIÇÃO: o interruptor desligou');
  });
  assert.deepEqual(m.enviados, ['x2', 'x3'],
    `DEFEITO: os pedidos que faltavam seguiram indo ao Waze como rejeitados depois do gesto: ${m.enviados.join(',')}`);
  assert.deepEqual(m.fila(), ['u1', 'u8', 'x4', 'x5', 'x6', 'x7'], 'os que não saíram não voltaram pra fila como card');
  assert.equal(m.AppState.stats.rejected, 22, 'o placar conta os 2 que pousaram, e só eles');
  assert.equal(m.AppState.serverTotal, m.AppState.queue.length,
    `o "Restam" (${m.AppState.serverTotal}) não acompanha a fila (${m.AppState.queue.length} cards)`);
  assert.deepEqual(m.registro().r[String(AUTOR)], [8, 'spam', hoje(), 0],
    'o registro do autor: a contagem soma só os 2 que pousaram, e o interruptor fica desligado');
  assert.equal(m.avisos.length, 1, 'PRÉ-CONDIÇÃO: a recusa mostrou o aviso de acompanhamento');
  assert.equal(m.avisos[0].dispensado, true, 'o aviso "Rejeitando N pedidos…" ficou na tela');
  assert.equal(m.deps.recusaAutomaticaRodando, false, 'a recusa ficou presa "rodando": a próxima não sairia');
});

test('R10-2-01: CONTROLE — ninguém mexe: os 6 do autor saem (o instrumento distingue)', async () => {
  const m = montarRecusa();
  await recusaComGesto(m, null);
  assert.deepEqual(m.enviados, ['x2', 'x3', 'x4', 'x5', 'x6', 'x7']);
  assert.deepEqual(m.fila(), ['u1', 'u8']);
  assert.equal(m.AppState.stats.rejected, 26);
  assert.deepEqual(m.registro().r[String(AUTOR)], [12, 'spam', hoje(), 1]);
});

test('R10-2-01: "Esquecer" o autor com a recusa no ar — o que falta não sai, e o autor NÃO volta à lista', async () => {
  const m = montarRecusa();
  await recusaComGesto(m, () => {
    m.h.esquecerAutorDaLista(String(AUTOR));       // a lixeira da lista (ou o "Esquecer" da folha)
    assert.deepEqual(m.h.listaDeAutores(), [], 'PRÉ-CONDIÇÃO: o autor saiu da lista no gesto');
  });
  assert.deepEqual(m.enviados, ['x2', 'x3'],
    `DEFEITO: os pedidos do autor esquecido seguiram indo ao Waze como rejeitados: ${m.enviados.join(',')}`);
  assert.deepEqual(m.fila(), ['u1', 'u8', 'x4', 'x5', 'x6', 'x7']);
  assert.deepEqual(m.h.listaDeAutores(), [],
    `DEFEITO: o autor esquecido voltou à lista, recriado pelas rejeições de depois do gesto: ${JSON.stringify(m.h.listaDeAutores())}`);
  // A ida que já estava no ar (o x3) pousou DEPOIS do "Esquecer": é uma rejeição
  // que de fato chegou ao Waze, no nome da pessoa. Ela entra como entra a de
  // qualquer autor que não está no registro — no anel dos vistos uma vez (só o
  // id, sem nome nem data, fora da lista); se a pessoa rejeitar outro dele, ele
  // volta com "✕ 2".
  assert.deepEqual(m.registro(), { v: [String(AUTOR)], r: {} }, 'o registro depois do "Esquecer" e do pouso da ida no ar');
});

test('R10-2-01: o gesto durante a ESPERA de uma retentativa — a retentativa não sai (só a ida no ar segue)', async () => {
  const m = montarRecusa();
  const recusa = m.h.aplicarRecusaAutomatica();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedido saiu');
  m.soltar(OK);
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 2, 'PRÉ-CONDIÇÃO: o 2º pedido está no ar');
  m.soltar({ success: false, errorCategory: 'transient' });   // rede: o `callWithRetry` espera e tenta de novo…
  m.h.alternarAutoDoAutor(String(AUTOR));                     // …e a pessoa desliga nessa espera
  await terminar(m, recusa);
  assert.deepEqual(m.enviados, ['x2', 'x3'], `DEFEITO: a retentativa saiu depois do gesto: ${m.enviados.join(',')}`);
  assert.deepEqual(m.fila(), ['u1', 'u8', 'x3', 'x4', 'x5', 'x6', 'x7'], 'o que não pousou não voltou pra fila');
  assert.equal(m.AppState.stats.rejected, 21);
  // CONTROLE: sem o gesto, a retentativa SAI (o instrumento enxerga a retentativa).
  const c = montarRecusa();
  const rc = c.h.aplicarRecusaAutomatica();
  await ateQue(() => c.portoes.length === 1, 'CONTROLE: o 1º pedido saiu');
  c.soltar(OK);
  await ateQue(() => c.portoes.length === 1 && c.enviados.length === 2, 'CONTROLE: o 2º está no ar');
  c.soltar({ success: false, errorCategory: 'transient' });
  await terminar(c, rc);
  assert.deepEqual(c.enviados, ['x2', 'x3', 'x3', 'x4', 'x5', 'x6', 'x7'], 'CONTROLE: a retentativa não saiu');
});

test('R10-2-01: o portão (L6+AM) e a conta desta aba também são conferidos antes de cada ida', async () => {
  for (const [caso, chaveDaFalha] of [['o portão', 'portao'], ['a conta desta aba', 'conta']]) {
    const estado = { portao: true, conta: true };
    const m = montarRecusa({ portao: () => estado.portao, conta: () => estado.conta });
    await recusaComGesto(m, () => { estado[chaveDaFalha] = false; });
    assert.deepEqual(m.enviados, ['x2', 'x3'], `DEFEITO (${caso}): a recusa seguiu mandando: ${m.enviados.join(',')}`);
    assert.deepEqual(m.fila(), ['u1', 'u8', 'x4', 'x5', 'x6', 'x7'], `${caso}: o que não saiu não voltou pra fila`);
  }
});

test('R10-2-01: com DOIS autores na leva, desligar um não para o outro — o aviso anda também pelo que volta pra fila, e o lote da pessoa não pergunta nada', async () => {
  // Dois autores marcados na mesma leva: desligar UM não para o outro. O aviso
  // ("Rejeitando N…") anda também pelo que volta pra fila: sem isso, ele
  // terminava contando os que voltaram como se ainda fossem sair.
  const m = montarRecusa();
  const reg = m.registro();
  reg.r['888'] = [6, 'outro', hoje(), 1];
  m.deps.localStorage.setItem(m.deps.AUTORES_KEY, JSON.stringify(reg));
  m.AppState.queue.push({ venueID: 'v9', updateRequestID: 'y9', creatorId: 888, createdBy: 'outro' });
  m.AppState.serverTotal = m.AppState.queue.length;
  await recusaComGesto(m, () => m.h.alternarAutoDoAutor(String(AUTOR)));
  assert.deepEqual(m.enviados, ['x2', 'x3', 'y9'], `desligar um autor parou o outro (ou não parou o desligado): ${m.enviados.join(',')}`);
  assert.deepEqual(m.fila(), ['u1', 'u8', 'x4', 'x5', 'x6', 'x7']);
  const faltam = m.avisos[0].textos.map((x) => Number(String(x).split('#')[1]));
  assert.equal(faltam.at(-1), 1, `o aviso não andou pelo que voltou pra fila: terminou em ${m.avisos[0].textos.at(-1)}`);
  // O lote da PESSOA não passa o `aindaVale`: um `aindaVale` que diz não ali não
  // muda nada (o pedido já está anotado na fila de saída e contado no placar).
  const p = montarRecusa();
  const alvos = p.AppState.queue.slice(1, 3);
  const lote = p.h.enviarLote(alvos, { regiao: 'row', gesto: GESTO, aindaVale: () => false });
  await ateQue(() => p.portoes.length === 1, 'o lote da pessoa saiu');
  p.soltar(OK);
  await ateQue(() => p.portoes.length === 1, 'o 2º do lote da pessoa saiu');
  p.soltar(OK);
  await lote;
  assert.deepEqual(p.enviados, ['x2', 'x3'], 'o lote da PESSOA parou num `aindaVale` — ele é só da recusa automática');
});

// Só a recusa automática tem o `aindaVale`, e ela o passa SEMPRE: quem chama o
// `enviarLote` contando ao pousar (o app agindo sozinho) relê as condições da
// entrada a cada ida.
test('R10-2-01: todo `enviarLote` que conta ao pousar passa o `aindaVale` — com as três condições da entrada', () => {
  const chamadas = [...APP_SEM.matchAll(/enviarLote\([^;]*?contarAoLandar: true[\s\S]*?\n\s*\}\);/g)].map((x) => x[0]);
  assert.ok(chamadas.length >= 1, 'PRÉ-CONDIÇÃO: o instrumento não achou a chamada da recusa automática');
  for (const c of chamadas) {
    const m = /aindaVale: \(p\) => ([^\n]+),\n/.exec(c);
    assert.ok(m, `DEFEITO: uma chamada que conta ao pousar não confere a cada ida que a recusa ainda vale:\n${c.slice(0, 200)}`);
    for (const termo of ['podeRecusarAutomaticoAqui()', 'contaConfirmada()', 'autoLigado(p.creatorId)']) {
      assert.ok(m[1].includes(termo), `DEFEITO: o \`aindaVale\` não confere ${termo}, que a entrada confere`);
    }
  }
});

// ═══ R10-2-07 · o 401 da recusa automática e o diário ══════════════════════════

test('R10-2-07: a recusa automática que leva 401 não anota "saida.abriu" — a fila de saída nem abriu', async () => {
  const m = montarRecusa();
  const recusa = m.h.aplicarRecusaAutomatica();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedido saiu');
  m.soltar(R401);
  await recusa;
  assert.ok(m.log.includes('confere-sessao'), 'PRÉ-CONDIÇÃO: o 401 foi pra conferência da sessão');
  assert.deepEqual(m.naSaida, [], 'PRÉ-CONDIÇÃO: a recusa automática não usa a fila de saída');
  assert.deepEqual(m.fila(), ['u1', 'u8', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7'], 'PRÉ-CONDIÇÃO: os pedidos voltaram pra fila de pedidos');
  assert.ok(!m.diario.includes('saida.abriu'),
    `DEFEITO: o diário diz que a fila de saída abriu, e ela está vazia: ${JSON.stringify(m.diario)}`);
  // CONTROLE: o "Rejeitar os N" da pessoa com o mesmo 401 — aí a fila de saída
  // abriu de verdade (os pedidos ficam nela), e o diário diz isso uma vez.
  const c = montarRecusa();
  const alvos = c.AppState.queue.slice(1, 4);
  const lote = c.h.enviarLote(alvos, { regiao: 'row', gesto: GESTO });
  await ateQue(() => c.portoes.length === 1, 'CONTROLE: o lote da pessoa saiu');
  c.soltar(R401);
  await lote;
  assert.deepEqual(c.naSaida, ['v2|x2', 'v3|x3', 'v4|x4'], 'CONTROLE: os do lote não ficaram na fila de saída');
  assert.deepEqual(c.diario.filter((k) => k === 'saida.abriu'), ['saida.abriu'], 'CONTROLE: a fila de saída abriu e o diário não disse');
});

// ═══ "Marcar todos" ═════════════════════════════════════════════════════════

const lido = (i, extra = {}) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, ...extra });

// O "Marcar todos" de verdade (`openBatchReadConfirm` + `handleBatchMarkRead`),
// com o placar GRAVADO de verdade (`saveStats`): é o que a reabertura do app
// mostra. O Waze responde quando o teste solta.
function montarMarcarTodos({ fila, pedaco = 2, aprovadaDela = () => false, placar = 40, decididos = null } = {}) {
  const { guardado, localStorage } = lsFalso();
  const STATS_KEY = constante('STATS_KEY');
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { read: placar, rejected: 0, skipped: 0 },
    serverTotal: fila.length, fetchEpoch: 0, hasMore: false, pendingAction: null, inFlightActions: 0 };
  const mensagem = { textContent: '' };
  const portoes = [];
  const enviados = [];
  const historico = [];
  const confirmados = [];
  const desfechos = [];
  const toasts = [];
  const modais = [];
  const deps = {
    AppState, localStorage, STATS_KEY, LOTE_LIDOS_PEDACO: pedaco, epocaDaSessao: 0, Treino: { ativo: false },
    pedidosEmAndamento: new Set(), loteDeLidosContado: null, loteDeLidosEmVoo: false, escritasConferindo: 0, tratouNestaFila: false,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, contaDestaAbaEmDuvida: () => false,
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), callWithRetry: (fn) => fn(),
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
    showToast: (m, tipo) => toasts.push(`${tipo}:${m}`), msgDoServidor: (r, d) => d,
    t: (k, v) => (v && v.n != null ? `${k}#${v.n}` : k),
    document: { getElementById: (id) => (id === 'batchReadMessage' ? mensagem : null) },
    openModal: (id) => modais.push(id), closeModal: () => {},
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
  };
  if (decididos) deps.decididosPorOutraAbaComCardAqui = decididos(fila);
  const h = montar(['openBatchReadConfirm', 'handleBatchMarkRead', 'acoesTravadas', 'acoesTravadasForaDaJanela',
    'aprovacaoDaTelaNoAr', 'avisoDaTrava', 'marcarEmAndamento', 'saveStats'], deps);
  const gravado = () => JSON.parse(guardado.get(STATS_KEY) || 'null');
  const soltar = (resp) => portoes.shift()(resp);
  const fila_ = () => AppState.queue.map((p) => p.updateRequestID);
  return { h, deps, AppState, mensagem, portoes, enviados, historico, confirmados, desfechos, toasts, modais, gravado, soltar,
    fila: fila_ };
}

// ── R10-2-03: o que o Waze marcou conta NA HORA, pedaço a pedaço ─────────────
// O roteiro do auditor (q06): lote de 60 em pedaços de 25; o 1º pedaço pousa,
// o 2º está no ar, e a página FECHA. Reaberta: "Lidos 40" (era 40) e Histórico
// 0, com 50 marcados no Waze. Aqui, pedaços de 2: o instante "fecha agora" é o
// 2º pedaço no ar — o que está GRAVADO é o que a reabertura mostra.
test('R10-2-03: "Marcar todos" — o pedaço que o Waze marcou já está no placar GRAVADO, no Histórico e nas conquistas com o próximo no ar', async () => {
  const m = montarMarcarTodos({ fila: [1, 2, 3].map((i) => lido(i)) });
  m.h.openBatchReadConfirm();
  const lote = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 1º pedaço saiu');
  // CONTROLE: o placar do lote não é otimista — nada conta antes de o Waze responder.
  assert.equal(m.AppState.stats.read, 40, 'o lote contou ANTES de o Waze marcar');
  assert.deepEqual(m.historico, []);
  m.soltar({ success: true });                       // o 1º pedaço (u1+u2) pousa
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o 2º pedaço está no ar');
  // A página fecha AGORA: o que está gravado é o que a reabertura mostra.
  assert.equal(m.gravado() && m.gravado().read, 42,
    `DEFEITO: o pedaço que o Waze já marcou não está no placar gravado (${JSON.stringify(m.gravado())}) — fechar o app agora o perde`);
  assert.deepEqual(m.historico, [['read', 2, GESTO.dia, GESTO.onde]],
    `DEFEITO: o pedaço que o Waze já marcou não está no Histórico: ${JSON.stringify(m.historico)}`);
  assert.deepEqual(m.confirmados, [[2, GESTO.dia]], 'DEFEITO: o pedaço que o Waze já marcou não passou pelas conquistas');
  m.soltar({ success: true });                       // o 2º (u3)
  await lote;
  assert.equal(m.AppState.stats.read, 43);
  assert.equal(m.gravado().read, 43);
  assert.deepEqual(m.historico.map((x) => x[1]), [2, 1], 'o Histórico contou um pedaço duas vezes (ou deixou um de fora)');
  assert.deepEqual(m.confirmados.map((x) => x[0]), [2, 1]);
  // O aviso de fim segue UM só, com o total.
  assert.deepEqual(m.toasts.filter((x) => x.startsWith('success:')), ['success:toast.batchDonePlural#3']);
  assert.deepEqual(m.fila(), []);
});

test('R10-2-03: no caminho UM A UM (um pedido já resolvido no pedaço), cada pedido conta quando POUSA', async () => {
  // O 1º do pedaço já estava resolvido: o Waze para nele e o app vai um a um.
  const m = montarMarcarTodos({ fila: [1, 2, 3].map((i) => lido(i)), pedaco: 3 });
  m.h.openBatchReadConfirm();
  const lote = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o pedaço saiu');
  m.soltar({ success: false, errorCategory: 'already_processed' });
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 2, 'PRÉ-CONDIÇÃO: o um a um começou');
  m.soltar({ success: false, errorCategory: 'already_processed' });   // u1: outro editor já tinha lido
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 3, 'PRÉ-CONDIÇÃO: o u2 está no ar');
  assert.equal(m.gravado() && m.gravado().read, 41,
    `DEFEITO: o pedido que pousou no um a um não está no placar gravado com o próximo no ar (${JSON.stringify(m.gravado())})`);
  assert.deepEqual(m.historico.map((x) => x[1]), [1], 'DEFEITO: o pedido que pousou no um a um não está no Histórico');
  m.soltar({ success: true });
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 4, 'o u3 saiu');
  m.soltar({ success: true });
  await lote;
  assert.equal(m.AppState.stats.read, 43);
  assert.deepEqual(m.historico.map((x) => x[1]), [1, 1, 1]);
  assert.deepEqual(m.toasts.filter((x) => x.startsWith('success:')), ['success:toast.batchDonePlural#3']);
});

test('R10-2-03: o pedido que a APROVAÇÃO dela resolveu tem o desfecho dela na hora — e não vira lido', async () => {
  const m = montarMarcarTodos({ fila: [1, 2].map((i) => lido(i)), pedaco: 2, aprovadaDela: (p) => p.updateRequestID === 'u1' });
  m.h.openBatchReadConfirm();
  const lote = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o pedaço saiu');
  m.soltar({ success: false, errorCategory: 'already_processed' });
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 2, 'PRÉ-CONDIÇÃO: o um a um começou');
  m.soltar({ success: false, errorCategory: 'already_processed' });   // u1: a aprovação DELA, sem resposta
  await ateQue(() => m.portoes.length === 1 && m.enviados.length === 3, 'PRÉ-CONDIÇÃO: o u2 está no ar');
  assert.deepEqual(m.desfechos, ['read:u1:false'], 'DEFEITO: o "Curador" da aprovação dela não contou na hora');
  assert.equal(m.AppState.stats.read, 40, 'a aprovação dela contou como lido');
  m.soltar({ success: true });
  await lote;
  assert.deepEqual(m.desfechos, ['read:u1:false'], 'o desfecho da aprovação saiu duas vezes');
  assert.equal(m.AppState.stats.read, 41);
  assert.deepEqual(m.toasts.filter((x) => x.startsWith('success:')), ['success:toast.batchDone#1']);
});

// ── R10-2-04: o já lido fica de fora — do diálogo, do envio, do aviso e do placar
// O roteiro do auditor (q10): "Apenas pedidos não lidos" desmarcado, u1–u3 já
// lidos e u4–u5 não. O diálogo dizia "os 5", mandava os 5, avisava "5 pedidos
// marcados" e somava 5 — igual ao CONTROLE com os cinco não lidos.
test('R10-2-04: "Marcar todos" com pedidos JÁ LIDOS na fila — conta, manda, avisa e soma só os não lidos', async () => {
  const fila = [1, 2, 3].map((i) => lido(i, { isRead: true })).concat([4, 5].map((i) => lido(i)));
  const m = montarMarcarTodos({ fila, pedaco: 25 });
  m.h.openBatchReadConfirm();
  assert.deepEqual(m.modais, ['batchReadModal'], 'PRÉ-CONDIÇÃO: o diálogo abriu');
  assert.equal(m.mensagem.textContent, 'modal.batchRead.bodyNaoLidosPlural#2',
    `DEFEITO: o diálogo não diz os 2 NÃO LIDOS (disse "${m.mensagem.textContent}")`);
  const lote = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o lote saiu');
  assert.deepEqual(m.enviados, ['u4+u5'], `DEFEITO: o lote mandou os já lidos: ${m.enviados}`);
  m.soltar({ success: true });
  await lote;
  assert.deepEqual(m.toasts, ['info:toast.batchMarkingPlural#2', 'success:toast.batchDonePlural#2'],
    `DEFEITO: o aviso contou os já lidos: ${JSON.stringify(m.toasts)}`);
  assert.equal(m.AppState.stats.read, 42, `DEFEITO: o placar somou os já lidos (${m.AppState.stats.read})`);
  assert.deepEqual(m.historico.map((x) => x[1]), [2], 'DEFEITO: o Histórico somou os já lidos');
  // Os já lidos SEGUEM na fila, como card: continuam pendentes no Waze.
  assert.deepEqual(m.fila(), ['u1', 'u2', 'u3'], 'os já lidos saíram da fila (ou os marcados ficaram)');
  assert.equal(m.AppState.serverTotal, 3, 'o "Restam" não acompanha a fila');
});

test('R10-2-04: CONTROLE — a fila só de não lidos segue com a frase de sempre e marca todos', async () => {
  const m = montarMarcarTodos({ fila: [1, 2, 3, 4, 5].map((i) => lido(i)), pedaco: 25 });
  m.h.openBatchReadConfirm();
  assert.equal(m.mensagem.textContent, 'modal.batchRead.bodyPlural#5');
  const lote = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'o lote saiu');
  assert.deepEqual(m.enviados, ['u1+u2+u3+u4+u5']);
  m.soltar({ success: true });
  await lote;
  assert.equal(m.AppState.stats.read, 45);
  assert.deepEqual(m.fila(), []);
});

test('R10-2-04: sobrando UM não lido, a frase é a do singular; sobrando NENHUM, é a fila sem o que marcar (sem diálogo)', async () => {
  const um = montarMarcarTodos({ fila: [lido(1, { isRead: true }), lido(2)], pedaco: 25 });
  um.h.openBatchReadConfirm();
  assert.equal(um.mensagem.textContent, 'modal.batchRead.bodyNaoLidos#1');
  const nenhum = montarMarcarTodos({ fila: [lido(1, { isRead: true }), lido(2, { isRead: true })], pedaco: 25 });
  nenhum.h.openBatchReadConfirm();
  assert.deepEqual(nenhum.modais, [], 'DEFEITO: o diálogo abriu pra marcar como lido o que já está lido');
  assert.deepEqual(nenhum.toasts, ['info:toast.batchEmpty'], `a fila só de já lidos não disse que não há o que marcar: ${nenhum.toasts}`);
  // E o confirmar (o diálogo de antes, se a fila mudasse com ele aberto) não manda nada.
  await nenhum.h.handleBatchMarkRead();
  assert.deepEqual(nenhum.enviados, []);
  assert.equal(nenhum.AppState.stats.read, 40);
});

// ── Junção do lote 14: o que a OUTRA aba decidiu (R10-2-02) não vai no lote ────
// O agente das duas abas mediu (q07c): a A rejeita o card da tela; o "Marcar
// todos" da B dizia "os 4", mandava os 4 e contava 4 lidos — o mesmo pedido lido
// aqui e rejeitado lá. Os de trás já saem da fila no aviso da outra aba; o da
// tela FICA (trocar o card debaixo do dedo é pior), e o lote o deixa de fora.
test('junção R10-2-02 × R10-2-04: o "Marcar todos" deixa de fora o card que a OUTRA aba já decidiu — no diálogo, no envio e no placar', async () => {
  const fila = [1, 2, 3].map((i) => lido(i));
  const m = montarMarcarTodos({ fila, pedaco: 25, decididos: (f) => new WeakSet([f[0]]) });
  m.h.openBatchReadConfirm();
  assert.equal(m.mensagem.textContent, 'modal.batchRead.bodyPlural#2',
    `DEFEITO: o diálogo contou o pedido que a outra aba decidiu (disse "${m.mensagem.textContent}")`);
  const lote = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o lote saiu');
  assert.deepEqual(m.enviados, ['u2+u3'], `DEFEITO: o lote mandou o pedido que a outra aba decidiu: ${m.enviados}`);
  m.soltar({ success: true });
  await lote;
  assert.equal(m.AppState.stats.read, 42, `DEFEITO: o placar contou o pedido da outra aba (${m.AppState.stats.read})`);
  assert.deepEqual(m.fila(), ['u1'], 'o card da tela (decidido lá) devia ficar, e os marcados sair');
  // CONTROLE: sem a anotação, o lote leva os três (o instrumento enxerga o card da tela).
  const c = montarMarcarTodos({ fila: [1, 2, 3].map((i) => lido(i)), pedaco: 25, decididos: () => new WeakSet() });
  c.h.openBatchReadConfirm();
  const lc = c.h.handleBatchMarkRead();
  await ateQue(() => c.portoes.length === 1, 'CONTROLE: o lote saiu');
  assert.deepEqual(c.enviados, ['u1+u2+u3'], 'CONTROLE: sem a anotação o lote devia levar os três');
  c.soltar({ success: true });
  await lc;
});

test('junção R10-2-02 × R10-2-04: a outra aba decide o card da tela COM O DIÁLOGO ABERTO — o confirmar o deixa de fora', async () => {
  const fila = [1, 2, 3].map((i) => lido(i));
  const decididos = new WeakSet();
  const m = montarMarcarTodos({ fila, pedaco: 25, decididos: () => decididos });
  m.h.openBatchReadConfirm();
  assert.equal(m.mensagem.textContent, 'modal.batchRead.bodyPlural#3', 'PRÉ-CONDIÇÃO: o diálogo abriu contando os três');
  decididos.add(fila[0]);                           // o aviso da outra aba chega com o diálogo aberto
  const lote = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o lote saiu');
  assert.deepEqual(m.enviados, ['u2+u3'], `DEFEITO: o confirmar mandou o pedido que a outra aba decidiu com o diálogo aberto: ${m.enviados}`);
  m.soltar({ success: true });
  await lote;
  assert.equal(m.AppState.stats.read, 42);
});

test('junção R10-2-02 × R10-2-01: a recusa automática não manda de novo o pedido do autor que a OUTRA aba decidiu', async () => {
  const m = montarRecusa({ decididos: (f) => new WeakSet([f[2]]) });   // o x3
  const recusa = m.h.aplicarRecusaAutomatica();
  await terminar(m, recusa);
  assert.deepEqual(m.enviados, ['x2', 'x4', 'x5', 'x6', 'x7'],
    `DEFEITO: a recusa automática mandou o pedido que a outra aba decidiu: ${m.enviados.join(',')}`);
  assert.ok(m.fila().includes('x3'), 'o pedido decidido lá saiu da fila desta aba pela recusa (quem o tira é o aviso da outra aba)');
  // CONTROLE: sem a anotação, os seis vão.
  const c = montarRecusa({ decididos: () => new WeakSet() });
  const rc = c.h.aplicarRecusaAutomatica();
  await terminar(c, rc);
  assert.deepEqual(c.enviados, ['x2', 'x3', 'x4', 'x5', 'x6', 'x7'], 'CONTROLE: sem a anotação a recusa devia mandar os seis');
});

// Os testes de cima fatiam o FONTE; o app carrega o `js/min/` (gotcha #22).
test('o bundle GERADO tem os consertos (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  for (const re of [/aindaVale/g, /modal\.batchRead\.bodyNaoLidos/g, /registrarLoteConfirmado\(/g]) {
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${re} — falta \`npm run js\``);
  }
});
