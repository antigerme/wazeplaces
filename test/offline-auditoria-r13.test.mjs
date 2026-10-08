// Rodada 13 da auditoria (2026-10-07), a parte do OFFLINE — o lote 17. Os
// buracos na fila guardada do "Disponível offline", todos MEDIDOS no navegador
// (os roteiros da rodada 13):
//
//  · R13-2-04 — a varredura que uma prova de rede dispara no MEIO de um "Marcar
//    todos" gravava os 30 alvos na fila guardada (eles seguem na fila, em
//    andamento, até o fim do lote) e podava os pousos dos 25 que o Waze já tinha
//    marcado: reaberto sem rede, os 25 voltavam como card, e o ✕ num deles ia ao
//    Waze. O mesmo com o pedido aprovado que fica na fila até a foto fechar;
//  · R13-4-03 — duas abas com filas diferentes: a poda de uma apagava do cache do
//    APARELHO o mapa dos pedidos que só a outra tinha, o "feito nesta janela" da
//    outra (memória dela) não sabia, e a varredura seguinte terminava "Pronto —
//    13" com 6 sem mapa; e a linha da aba que não gravou por último dizia
//    "Pronto — 12" sobre a fila guardada da outra;
//  · R13-4-04 — a gravação da fila guardada (e a reabertura depois de uma busca
//    que falhou) perguntava a sessão ao `getSession`, que com a memória vazia
//    ADOTA a sessão que outra aba guardou no aparelho (R9-1-03): a busca que
//    respondia depois da queda deixava a aba "logada" na tela de entrada, gravava
//    a fila sem dono, e a fila guardada abria por baixo da tela de entrada.
//
// Os testes RODAM o código de verdade, fatiado do app.js — e o api.js INTEIRO,
// num contexto do `vm`, porque é o `getSession` dele que adota. Cada um tem o
// CONTROLE que dá o resultado oposto, e foi visto REPROVANDO com o conserto
// desfeito (sabotagem no relatório do lote 17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const MIN = ler('js/min/app.js');
const I18N = ler('js/i18n.js');
const API_JS = ler('js/api.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Pula a ASSINATURA antes de casar chaves (parâmetro padrão com `{}`).
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
const linhaDoFonte = (re, o) => { const m = re.exec(APP_SEM); assert.ok(m, `${o} sumiu do app.js`); return m[0]; };
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function(`return (${m[1]});`)();
};
// As declarações de MÓDULO, tiradas do fonte (um nome trocado lá reprova aqui).
const DECLARACOES = [
  linhaDoFonte(/^const pousosDaPagina = new Map\(\);$/m, 'os pousos da página'),
  linhaDoFonte(/^const pedidosEmAndamento = new Set\(\);$/m, 'os pedidos em andamento'),
  linhaDoFonte(/^const pedidosQuePousaram = new WeakSet\(\);$/m, 'os pedidos (objetos) que pousaram'),
  linhaDoFonte(/^const decididosPorOutraAbaComCardAqui = new WeakSet\(\);$/m, 'o card que a outra aba decidiu'),
  linhaDoFonte(/^const CANAL_DO_OFFLINE = '[^']+';$/m, 'o nome do canal do offline'),
  linhaDoFonte(/^let canalDoOffline = null;$/m, 'o canal do offline'),
];
const CONTA_KEY = constante('CONTA_KEY');
const SAIDA_KEY = constante('SAIDA_KEY');
const OFFLINE_POUSOS_KEY = constante('OFFLINE_POUSOS_KEY');
const OFFLINE_POUSOS_MAX = constante('OFFLINE_POUSOS_MAX');
const OFFLINE_STORE = constante('OFFLINE_STORE');
const POUSO_NA_MEMORIA_MS = constante('POUSO_NA_MEMORIA_MS');
const OFFLINE_CICLO_MS = constante('OFFLINE_CICLO_MS');

const tique = (ms = 2) => new Promise((ok) => setTimeout(ok, ms));
// O relógio de PAREDE andou desde `t` (com o relógio grosso, anda em degraus):
// pouso e gravação no mesmo milissegundo empatariam, e o teste mediria o empate.
async function relogioAndou(t = Date.now()) {
  const fim = performance.now() + 2000;
  while (Date.now() <= t) {
    if (performance.now() > fim) assert.fail('o relógio de parede não andou');
    await tique(1);
  }
}

const P = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i });
const chave = (p) => p.venueID + '|' + p.updateRequestID;
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();

// O api.js de VERDADE, sobre um armazenamento (`Map`) que as abas DIVIDEM: é o
// `getSession` dele que, com a memória vazia, grava nela a sessão do aparelho.
function apiSobre(aparelho) {
  const ctx = {
    navigator: { language: 'pt', onLine: true },
    document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: {
      getItem: (k) => (aparelho.has(k) ? aparelho.get(k) : null),
      setItem: (k, v) => { aparelho.set(k, String(v)); },
      removeItem: (k) => { aparelho.delete(k); },
    },
    console, setTimeout, clearTimeout,
  };
  ctx.window = {};
  vm.createContext(ctx);
  vm.runInContext(I18N + '\n' + API_JS + '\nthis.API = API; this.safeLS = safeLS;', ctx);
  return { API: ctx.API, safeLS: ctx.safeLS };
}

// A base do IndexedDB, de mentira e DIVIDIDA (é do aparelho). A transação fecha
// num `setTimeout`, como a de verdade fecha numa tarefa à parte. `leituras`:
// quantas vezes a base foi LIDA.
function baseDeMentira() {
  const guardado = new Map();
  const ganchos = { leituras: 0 };
  const offlineDB = async () => ({
    close() {},
    transaction: () => {
      const tx = {};
      const fim = () => setTimeout(() => tx.oncomplete && tx.oncomplete());
      tx.objectStore = () => ({
        put: (v, k) => { guardado.set(k, structuredClone(v)); fim(); },
        get: (k) => {
          const r = {};
          ganchos.leituras++;
          setTimeout(() => { r.result = guardado.has(k) ? structuredClone(guardado.get(k)) : undefined; if (r.onsuccess) r.onsuccess(); fim(); });
          return r;
        },
      });
      return tx;
    },
  });
  return { guardado, ganchos, offlineDB };
}

// ═══ uma ABA: a gravação, os pousos e a reabertura de verdade ════════════════
// `memoria`: a sessão na MEMÓRIA desta aba (`null`: a queda a soltou). O
// aparelho e a base são das duas abas.
const NOMES = ['chaveDoPedido', 'filaReal', 'marcarEmAndamento', 'registrarPouso', 'carregarFilaDeSaida',
  'offlineLerPousos', 'offlinePodarPousos', 'semOsJaDecididos', 'marcaDaSessao', 'marcaDestaAba', 'contaAgora',
  'mesmoLugar', 'offlineGravarFila', 'offlineLerFila', 'filaGuardadaDestaConta', 'offlineTentarAbrirSemRede'];
function aba({ aparelho, base, fila = [], memoria = null, perfil = null, autenticada = true, onLine = true,
  recuperarJanela = async () => {} } = {}) {
  const { API, safeLS } = apiSobre(aparelho);
  if (memoria) API.sessionToken = memoria;
  const diario = [];
  const AppState = { authenticated: autenticada, queue: fila.slice(), currentPlace: fila[0] || null,
    filters: { countryId: 30 }, profile: perfil, preferences: { offlineDisponivel: true },
    fetchEpoch: 0, hasMore: false, loadError: true, serverTotal: 0 };
  const deps = {
    AppState, API, safeLS, Treino: { ativo: false, _salvo: null }, navigator: { onLine },
    CONTA_KEY, SAIDA_KEY, OFFLINE_POUSOS_KEY, OFFLINE_POUSOS_MAX, OFFLINE_STORE, POUSO_NA_MEMORIA_MS,
    offlineLigado: () => AppState.preferences.offlineDisponivel === true,
    offlineDB: base.offlineDB, dfato: (k, o) => diario.push([k, o || {}]),
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }),
    offlineRecuperarJanela: () => recuperarJanela({ AppState, API }),
    pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {},
    updatePendingCount: () => {}, sortQueue: () => {}, showCurrentPlace: () => diario.push(['card', {}]),
  };
  const chaves = Object.keys(deps);
  const fonte = [
    'let filaDeOnde = null, offlineFilaGravadaEm = null, offlineFilaGravadaChaves = null, offlineFilaPreparada = null,',
    '    offlineJanelaServida = null, ultimaEscritaOkEm = 0, offlineEpoca = 0;',
    ...DECLARACOES,
    ...NOMES.map(fatiar),
    `return { ${NOMES.join(', ')} };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  return { app, AppState, API, diario };
}
// O aparelho de uma conta (4242) com a sessão `token` guardada nele.
function aparelhoCom(token) {
  return new Map([['waze_session_token', token], [CONTA_KEY, JSON.stringify({ id: '4242', s: marcaDe(token) })]]);
}
// Reaberto SEM rede: página NOVA (memória vazia, a sessão do aparelho adotada na
// abertura), a mesma base e o mesmo aparelho, e a reabertura de verdade.
async function reabrirSemRede(aparelho, base) {
  const C = aba({ aparelho, base, memoria: aparelho.get('waze_session_token'), onLine: false });
  await C.app.offlineTentarAbrirSemRede();
  return C.AppState.queue.map(chave);
}

// ═══ R13-2-04 · "Marcar todos" × a varredura no meio ═════════════════════════
// O roteiro o1 da auditoria: a fila guardada coberta antes do lote; "Marcar
// todos" em 30, o 1º pedaço (25) pousa; uma prova de rede dispara a varredura,
// que grava a fila (desde = agora) e poda os pousos mais velhos; o 2º pedaço
// pousa e o lote acaba. `fora`: o pedido que o lote deixa de fora (o já lido),
// que segue como card.
async function loteComVarreduraNoMeio({ varreNoMeio = true } = {}) {
  const aparelho = aparelhoCom('tok-a');
  const base = baseDeMentira();
  const alvos = Array.from({ length: 30 }, (_, i) => P(i));
  const fora = P(99);
  const A = aba({ aparelho, base, fila: [...alvos, fora], memoria: 'tok-a', perfil: { id: 4242 } });
  assert.equal(await A.app.offlineGravarFila(), true, 'PRÉ-CONDIÇÃO: a fila não foi gravada antes do lote');
  await relogioAndou();
  A.app.marcarEmAndamento(alvos, true);          // o lote no ar (`handleBatchMarkRead`)
  A.app.registrarPouso(alvos.slice(0, 25));      // o 1º pedaço pousou
  const tPouso = Date.now();
  await relogioAndou(tPouso);
  let gravadaNoMeio = null;
  if (varreNoMeio) {
    await A.app.offlineGravarFila();             // a varredura da prova de rede
    gravadaNoMeio = base.guardado.get('fila').places.map(chave);
  }
  await relogioAndou();
  A.app.registrarPouso(alvos.slice(25));         // o 2º pedaço pousou
  A.app.marcarEmAndamento(alvos, false);         // o fim do lote: os 30 saem da fila
  A.AppState.queue = [fora];
  return { gravadaNoMeio, reaberta: await reabrirSemRede(aparelho, base) };
}

test('R13-2-04: a varredura no MEIO de um "Marcar todos" não grava os alvos — reaberto sem rede, o que o lote marcou não volta como card', async () => {
  const r = await loteComVarreduraNoMeio();
  assert.deepEqual(r.gravadaNoMeio, ['v99|u99'],
    `DEFEITO: a gravação do meio do lote levou os alvos (em andamento, ou já marcados) pra fila guardada: ${r.gravadaNoMeio.length} pedidos`);
  assert.deepEqual(r.reaberta, ['v99|u99'],
    `DEFEITO: reaberto sem rede, ${r.reaberta.length - 1} pedidos que o lote marcou voltaram como card — o ✕ num deles iria ao Waze`);
  // CONTROLE (o do auditor): o mesmo lote SEM a varredura no meio — a fila
  // guardada de antes do lote, com os 30 pousos, reabre só com o de fora.
  const c = await loteComVarreduraNoMeio({ varreNoMeio: false });
  assert.deepEqual(c.reaberta, ['v99|u99'], 'CONTROLE: sem a varredura no meio, a reabertura trouxe pedido do lote');
});

// O outro pedido que POUSA e fica na fila: o aprovado com a foto ainda aberta
// (`concluirAprovacao` → `placeResolvidoPorAprovacao`), que só sai quando ela
// fecha. Uma varredura nesse meio o gravava, e podava o pouso dele.
async function aprovadoComAFotoAberta({ objetoNovo = false } = {}) {
  const aparelho = aparelhoCom('tok-a');
  const base = baseDeMentira();
  const Y = P(1), Z = P(2);
  const A = aba({ aparelho, base, fila: [Y, Z], memoria: 'tok-a', perfil: { id: 4242 } });
  assert.equal(await A.app.offlineGravarFila(), true, 'PRÉ-CONDIÇÃO: a fila não foi gravada');
  await relogioAndou();
  A.app.registrarPouso(Y);                       // a aprovação pousou; Y segue na fila
  await relogioAndou();
  // CONTROLE pelo OBJETO: a busca de depois trouxe o MESMO pedido de novo (o
  // lido, com "lidos também") — outro objeto, card legítimo.
  if (objetoNovo) A.AppState.queue[0] = { ...Y };
  await A.app.offlineGravarFila();               // a varredura nesse meio
  return { gravada: base.guardado.get('fila').places.map(chave), reaberta: await reabrirSemRede(aparelho, base) };
}

test('R13-2-04: o pedido APROVADO com a foto ainda aberta (ele fica na fila até ela fechar) não vai pra fila guardada', async () => {
  const r = await aprovadoComAFotoAberta();
  assert.deepEqual(r.gravada, ['v2|u2'], `DEFEITO: o pedido aprovado foi gravado na fila guardada: ${r.gravada}`);
  assert.deepEqual(r.reaberta, ['v2|u2'], `DEFEITO: reaberto sem rede, o pedido aprovado voltou como card: ${r.reaberta}`);
});

test('R13-2-04: CONTROLE — pelo OBJETO, não pela chave: o mesmo pedido que ENTROU de novo numa busca de depois é gravado e reabre', async () => {
  const r = await aprovadoComAFotoAberta({ objetoNovo: true });
  assert.deepEqual(r.gravada, ['v1|u1', 'v2|u2'],
    'a regra ficou larga demais: o pedido que voltou numa busca de depois (card legítimo) ficou fora da fila guardada');
  assert.deepEqual(r.reaberta, ['v1|u1', 'v2|u2']);
});

// ═══ R13-4-04 · a gravação e a reabertura não ADOTAM a sessão de outra aba ═══
// O roteiro p7: duas abas da MESMA conta com sessões diferentes — a B entrou de
// novo, e o aparelho guarda a `tok-b`. A sessão de A cai com a busca no ar: a
// queda solta só a memória de A (a guardada é a de B). A busca responde depois.
test('R13-4-04: a gravação SEM sessão na memória não adota a sessão que outra aba guardou — e não grava fila sem dono', async () => {
  const aparelho = aparelhoCom('tok-b');
  const base = baseDeMentira();
  const A = aba({ aparelho, base, fila: [P(1), P(2), P(3)], memoria: null, perfil: null, autenticada: false });
  assert.equal(await A.app.offlineGravarFila(Date.now()), false, 'DEFEITO: a fila foi gravada pela aba sem sessão');
  assert.equal(A.API.sessionToken, null,
    'DEFEITO: a gravação ADOTOU a sessão da outra aba — a aba fica "logada" na tela de entrada');
  assert.equal(base.guardado.has('fila'), false, 'DEFEITO: a fila sem dono foi gravada por cima da boa');
  // CONTROLE: com a sessão desta aba na memória, grava — com a marca DELA, e a conta.
  const B = aba({ aparelho, base, fila: [P(1), P(2), P(3)], memoria: 'tok-a', perfil: { id: 4242 } });
  assert.equal(await B.app.offlineGravarFila(Date.now()), true, 'CONTROLE: com sessão a fila não foi gravada');
  const g = base.guardado.get('fila');
  assert.equal(g.s, marcaDe('tok-a'), 'a fila guardada não leva a marca da sessão de quem a gravou');
  assert.equal(g.conta, '4242');
});

test('R13-4-04: a fila guardada não abre na aba SEM sessão (a busca que falhou depois da queda) — nem é lida, nem adota a sessão da outra', async () => {
  const aparelho = aparelhoCom('tok-b');
  const base = baseDeMentira();
  // A fila guardada da B, desta conta e deste lugar.
  base.guardado.set('fila', { t: Date.now(), desde: Date.now(), regiao: 'row', pais: '30', busca: 'b', conta: '4242',
    s: marcaDe('tok-b'), places: [P(1), P(2), P(3)] });
  // A aba que caiu na tela de entrada: sem sessão, sem perfil (`derrubarSessao`).
  const A = aba({ aparelho, base, memoria: null, perfil: null, autenticada: false });
  assert.equal(await A.app.offlineTentarAbrirSemRede(true, 0), false,
    'DEFEITO: a fila guardada abriu na aba sem sessão, por baixo da tela de entrada');
  assert.deepEqual(A.AppState.queue, []);
  assert.equal(A.API.sessionToken, null, 'DEFEITO: a reabertura ADOTOU a sessão da outra aba');
  // Sem sessão, ela nem é LIDA — e o diário não diz "outra conta" de uma fila que é
  // desta conta (a aba só caiu): quem volta a buscar é a entrada.
  assert.equal(base.ganchos.leituras, 0, 'a aba sem sessão leu a fila guardada');
  assert.ok(!A.diario.some(([k]) => k === 'offline.outraConta'),
    'o diário da aba sem sessão diz que a fila guardada é de OUTRA conta');
  // A pergunta "é desta conta?" sozinha, sem a guarda da sessão: também não adota.
  assert.equal(A.app.filaGuardadaDestaConta(base.guardado.get('fila')), false,
    'DEFEITO: sem sessão na memória, a fila da sessão do aparelho passou por desta aba');
  assert.equal(A.API.sessionToken, null, 'DEFEITO: a pergunta de quem é a fila ADOTOU a sessão da outra aba');
  // CONTROLE: a aba COM a sessão (a B, ou a A depois de entrar de novo) a abre.
  const B = aba({ aparelho, base, memoria: 'tok-b', perfil: null });
  assert.equal(await B.app.offlineTentarAbrirSemRede(true, 0), true, 'CONTROLE: com sessão a fila guardada não abriu');
  assert.deepEqual(B.AppState.queue.map(chave), ['v1|u1', 'v2|u2', 'v3|u3']);
});

test('R13-4-04: a sessão que CAI enquanto a base é lida também não deixa a fila guardada entrar', async () => {
  const aparelho = aparelhoCom('tok-a');
  const base = baseDeMentira();
  base.guardado.set('fila', { t: Date.now(), desde: Date.now(), regiao: 'row', pais: '30', busca: 'b', conta: '4242',
    s: marcaDe('tok-a'), places: [P(1), P(2)] });
  // A queda chega no meio da leitura da janela (o último `await` antes de a fila
  // entrar), como o `derrubarSessao` a faz: a sessão, o perfil e o "logado" saem.
  const cair = async ({ AppState, API }) => { AppState.authenticated = false; AppState.profile = null; API.soltarSessao(); };
  const A = aba({ aparelho, base, memoria: 'tok-a', perfil: { id: 4242 }, recuperarJanela: cair });
  assert.equal(await A.app.offlineTentarAbrirSemRede(true, 0), false,
    'DEFEITO: a sessão caiu durante a leitura e a fila guardada entrou por baixo da tela de entrada');
  assert.deepEqual(A.AppState.queue, []);
  // CONTROLE: sem a queda no meio, a mesma fila abre.
  const B = aba({ aparelho, base, memoria: 'tok-a', perfil: { id: 4242 } });
  assert.equal(await B.app.offlineTentarAbrirSemRede(true, 0), true, 'CONTROLE: a fila guardada não abriu');
});

// ═══ R13-4-03 · duas abas, UMA fila guardada e UM cache do mapa ══════════════
// O roteiro p3, com a varredura, a poda, a linha e o canal de VERDADE sobre a
// base, o cache e o canal de mentira que as duas abas dividem. Um tile por
// pedido; o relógio anda 1 ms por leitura, dentro de UMA janela.
function navegador() {
  const canais = new Map();
  let entregas = 0;
  class CanalDeMentira {
    constructor(nome) {
      this.nome = nome;
      this.onmessage = null;
      if (!canais.has(nome)) canais.set(nome, new Set());
      canais.get(nome).add(this);
    }
    // Às OUTRAS instâncias, numa tarefa à parte, por cópia (como o de verdade),
    // com TETO de entregas: um aviso que gerasse outro viraria laço (gotcha #19).
    postMessage(msg) {
      const dado = structuredClone(msg);
      for (const outro of canais.get(this.nome)) {
        if (outro === this || ++entregas > 50) continue;
        setTimeout(() => { if (typeof outro.onmessage === 'function') outro.onmessage({ data: structuredClone(dado) }); }, 0);
      }
    }
    close() { canais.get(this.nome).delete(this); }
  }
  return { BroadcastChannel: CanalDeMentira };
}
const entregue = () => new Promise((ok) => setTimeout(ok, 5));

const NOMES_VARREDURA = ['filaReal', 'chaveDoPedido', 'offlineGravarFila', 'offlineLerFila', 'offlinePodarTiles',
  'offlineVarrer', 'offlinePrecisaVarrer', 'offlineTalvezVarrer', 'filaGuardadaEsperandoOTreino', 'atualizarLinhaDoOffline',
  'abrirCanalDoOffline', 'avisarOutrasAbasDaFilaGuardada', 'aoGravarFilaGuardadaEmOutraAba'];
function aparelhoDeDuasAbas({ canal = true } = {}) {
  const base = baseDeMentira();
  const cache = new Map();
  const caches = {
    has: async () => cache.size > 0,
    open: async () => ({
      keys: async () => [...cache.keys()].map((url) => ({ url })),
      delete: async (r) => { cache.delete(r.url); },
    }),
  };
  const relogio = { agora: 1492385 * OFFLINE_CICLO_MS + 1000 };   // começo de uma janela
  const nav = navegador();
  function aba(fila) {
    const diario = [];
    const baixados = [];
    const el = { textContent: '', innerHTML: '' };
    const AppState = { authenticated: true, queue: fila.slice(), filters: {} };
    const deps = {
      AppState, Treino: { ativo: false }, navigator: { onLine: true }, offlineLigado: () => true,
      Date: { now: () => relogio.agora++ },
      offlineDB: base.offlineDB, OFFLINE_STORE, OFFLINE_TILES_CACHE: 'waze-places-tiles', caches,
      BroadcastChannel: canal ? nav.BroadcastChannel : undefined,
      offlinePodarPousos: () => {}, dfato: (k) => diario.push(k),
      filaDeOnde: null, lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), contaAgora: () => '4242',
      marcaDestaAba: () => 'm-tok',
      OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS, OFFLINE_CONCORRENCIA: 1,
      OFFLINE_ANUNCIAR_A_CADA: 50, OFFLINE_TENTATIVAS_POR_ITEM: constante('OFFLINE_TENTATIVAS_POR_ITEM'),
      offlineItensDaFila: async () => AppState.queue.map((p) => ({ u: 'tile-' + p.venueID, tile: true })),
      // O tile "404" é defeito do item (4xx): não vai pro cache.
      offlineBaixar: async (u) => { baixados.push(u); if (/404/.test(u)) return 'definitivo'; cache.set(u, true); return true; },
      offlineSondarRede: async () => true, offlineAnunciarTiles: () => {}, offlineGravarJanela: () => {},
      setTimeout: (fn) => { fn(); return 0; },
      document: { getElementById: () => el }, t: (k) => k, escapeHtml: (s) => s,
    };
    const chaves = Object.keys(deps);
    const app = new Function(...chaves, [
      'let offlineVarrendo = false, offlinePedidaDeNovo = false, offlineUltimoGesto = Date.now(), offlineJanelaServida = null,',
      '    offlineUltimoResultado = null, offlineEpoca = 0, offlineFilaGravadaEm = null, offlineFilaPreparada = null,',
      '    offlineFilaGravadaChaves = null, offlineFilaVarrida = null,',
      '    offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set() };',
      ...DECLARACOES.filter((d) => /CANAL_DO_OFFLINE|canalDoOffline/.test(d)),
      ...NOMES_VARREDURA.map(fatiar),
      'abrirCanalDoOffline();',
      `return { varrer: offlineVarrer, gravarFila: offlineGravarFila, gatilho: offlineTalvezVarrer,
        precisaVarrer: offlinePrecisaVarrer,
        linha: () => { atualizarLinhaDoOffline(0, 0); const e = document.getElementById('prefOfflineDesc'); return e.innerHTML || e.textContent; },
        // A linha como ESTÁ na tela agora, sem redesenhar (as Preferências abertas).
        naTela: () => { const e = document.getElementById('prefOfflineDesc'); return e.innerHTML || e.textContent; },
        estado: () => ({ resultado: offlineUltimoResultado, varrendo: offlineVarrendo, gravada: offlineFilaGravadaEm,
          preparada: offlineFilaPreparada }) };`,
    ].join('\n'))(...chaves.map((k) => deps[k]));
    // A busca que traz pedido novo, como o `fetchNextPage`: põe na fila, grava a
    // fila e chama a varredura.
    const buscar = async (novos) => {
      AppState.queue.push(...novos);
      await app.gravarFila(relogio.agora);
      await app.varrer();
    };
    return { ...app, AppState, diario, baixados, buscar };
  }
  // Os pedidos que estão na fila guardada da base e não têm o tile no cache.
  const semMapaNaGuardada = () => (base.guardado.get('fila') || { places: [] }).places
    .map((p) => 'tile-' + p.venueID).filter((u) => !/404/.test(u) && !cache.has(u));
  // Um aviso no canal, como o de uma aba que gravou a fila `t` (só o canal: nada
  // na base).
  const avisar = (t) => new nav.BroadcastChannel(CANAL).postMessage({ v: 1, filaGuardada: t });
  return { aba, base, cache, semMapaNaGuardada, avisar, canal: () => nav.BroadcastChannel };
}
const CANAL = /^const CANAL_DO_OFFLINE = '([^']+)';$/m.exec(APP_SEM)[1];
// O FIM de uma varredura nova (a que um gatilho disparou sem devolver a promessa):
// pelo diário, por SINAL POSITIVO e com teto — nunca por prazo fixo.
async function varreduraTerminou(aba, antes, rotulo) {
  const fim = performance.now() + 5000;
  const prontas = () => aba.diario.filter((k) => k === 'offline.pronto' || k === 'offline.parcial').length;
  while (!(prontas() > antes && !aba.estado().varrendo)) {
    if (performance.now() > fim) assert.fail(`${rotulo}: a varredura não terminou em 5 s`);
    await tique(2);
  }
}
const PRONTO = /prefs\.offline\.prontoA/;
const PENDENTE = /prefs\.offline\.pendenteA/;
const comuns = () => [1, 2, 3, 4, 5, 6].map(P);
const so = (de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => P(de + i));

test('R13-4-03: a poda da OUTRA aba apaga o mapa que esta deu como pronto — a varredura seguinte, na MESMA janela, confere com o cache e o baixa de novo', async () => {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba([...comuns(), ...so(40, 45)]);
  await A.varrer();
  assert.equal(A.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a preparação de A não ficou pronta');
  const B = ap.aba([...comuns(), ...so(30, 35)]);
  await B.varrer();
  await entregue();
  assert.equal(B.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a preparação de B não ficou pronta');
  assert.ok(B.diario.includes('offline.podou'), 'PRÉ-CONDIÇÃO: a poda de B não apagou nada');
  assert.equal(ap.cache.has('tile-v40'), false, 'PRÉ-CONDIÇÃO: a poda de B não apagou o mapa dos pedidos que só A tem');
  // A busca de A traz um pedido novo, na MESMA janela: A grava a fila dela e varre.
  const antes = A.baixados.length;
  await A.buscar([P(50)]);
  await entregue();
  assert.equal(A.estado().resultado, 'pronto');
  assert.deepEqual(A.baixados.slice(antes).sort(), [...so(40, 45), P(50)].map((p) => 'tile-' + p.venueID).sort(),
    'DEFEITO: a varredura pulou como "prontos" os tiles que a poda da outra aba apagou');
  assert.deepEqual(ap.semMapaNaGuardada(), [],
    'DEFEITO: a fila guardada ficou com pedidos SEM mapa no aparelho — e a linha diz "Pronto"');
  assert.match(A.linha(), PRONTO);
});

test('R13-4-03: CONTROLE — a conferência com o cache não baixa de novo o que está lá, nem o tile que é defeito do item (4xx)', async () => {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba([P(1), P(2), P(404)]);
  await A.varrer();
  assert.equal(A.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: o tile 4xx segurou a preparação');
  const antes = A.baixados.length;
  await A.buscar([P(5)]);
  assert.deepEqual(A.baixados.slice(antes), ['tile-v5'],
    'a conferência baixou de novo o que está no cache — ou pediu de novo o tile que é defeito do item (o R5-4-1)');
  assert.equal(A.estado().resultado, 'pronto');
});

test('R13-4-03: a linha da aba que NÃO gravou por último não diz "Pronto" sobre a fila da outra — e o próximo gatilho prepara a dela', async () => {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba([...comuns(), ...so(40, 45)]);
  await A.varrer();
  assert.match(A.linha(), PRONTO, 'PRÉ-CONDIÇÃO: a preparação de A não ficou pronta');
  assert.equal(A.precisaVarrer(), false, 'PRÉ-CONDIÇÃO: A, pronta, ainda pede varredura');
  // B abre com a fila dela e varre: a fila guardada do aparelho passa a ser a de B,
  // e a poda de B leva o mapa de 40..45.
  const B = ap.aba([...comuns(), ...so(30, 35)]);
  await B.varrer();
  await entregue();
  // As Preferências abertas em A: a linha muda SOZINHA, com o aviso.
  assert.match(A.naTela(), PENDENTE,
    `DEFEITO: com as Preferências abertas, a linha de A segue dizendo "Pronto" sobre a fila guardada de B: ${A.naTela()}`);
  const linhaA = A.linha();
  assert.doesNotMatch(linhaA, PRONTO,
    `DEFEITO: a linha de A diz "Pronto" com a fila guardada sendo a de B (e o mapa de 6 pedidos de A fora do aparelho): ${linhaA}`);
  assert.match(linhaA, PENDENTE);
  assert.equal(A.precisaVarrer(), true, 'DEFEITO: o próximo gatilho de A não prepararia a fila dela');
  // O gatilho de A (a prova de rede, abrir as Preferências): a fila dela volta a ser
  // a guardada, com o mapa inteiro — e agora é a linha de B que deixa de dizer "Pronto".
  const antes = A.diario.filter((k) => k === 'offline.pronto' || k === 'offline.parcial').length;
  A.gatilho();
  await varreduraTerminou(A, antes, 'o gatilho de A');
  await entregue();
  assert.equal(A.estado().resultado, 'pronto');
  assert.deepEqual(ap.semMapaNaGuardada(), [], 'a fila guardada de A ficou sem o mapa que a poda de B levou');
  assert.match(A.linha(), PRONTO);
  assert.match(B.linha(), PENDENTE, 'a linha de B segue "Pronto" com a fila guardada sendo a de A');
});

test('R13-4-03: CONTROLE — uma aba só, ou o aviso da MESMA fila que esta tem: a linha segue "Pronto", nada é preparado de novo e o carimbo fica', async () => {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba([...comuns(), ...so(40, 45)]);
  await A.varrer();
  await entregue();
  assert.match(A.linha(), PRONTO);
  assert.equal(A.precisaVarrer(), false);
  const t = A.estado().gravada;
  // O aviso da MESMA fila guardada que A tem (o carimbo dela), e um aviso que não
  // é desta versão: nada muda — nem a linha, nem o diário, nem o carimbo.
  ap.avisar(t);
  new (ap.canal())('waze-places-offline').postMessage({ v: 1, filaGuardada: 'x' });
  await entregue();
  assert.match(A.naTela(), PRONTO, 'o aviso da própria fila guardada de A mudou a linha');
  assert.equal(A.precisaVarrer(), false, 'o aviso da própria fila guardada de A pediu outra varredura');
  assert.ok(!A.diario.includes('offline.outraAba'), 'o diário de A diz que outra aba gravou OUTRA fila — era a mesma');
  assert.equal(A.estado().gravada, t, 'um aviso que não é desta versão trocou o carimbo da fila guardada');
  // A MESMA fila regravada mantém o carimbo e segue coberta (o R6-4-2).
  await A.gravarFila();
  assert.equal(A.estado().gravada, t, 'a mesma fila, regravada depois do aviso, perdeu o carimbo');
  assert.match(A.linha(), PRONTO);
  // E o aviso de OUTRA fila chega a A (a instrumentação enxerga o aviso).
  ap.avisar(t + 1);
  await entregue();
  assert.match(A.naTela(), PENDENTE, 'CONTROLE: o aviso de outra fila guardada não chegou a A');
});

test('R13-4-03: sem `BroadcastChannel` (iOS < 15.4) nada quebra — segue como antes', async () => {
  const ap = aparelhoDeDuasAbas({ canal: false });
  const A = ap.aba([...comuns(), ...so(40, 45)]);
  await A.varrer();
  const B = ap.aba([...comuns(), ...so(30, 35)]);
  await B.varrer();
  assert.equal(B.estado().resultado, 'pronto');
  // A não fica sabendo (não há canal), mas a varredura dela confere o cache: a
  // fila guardada que ela gravar sai com o mapa inteiro.
  await A.buscar([P(50)]);
  assert.deepEqual(ap.semMapaNaGuardada(), []);
});

// ═══ os testes fatiam o FONTE; o app carrega o `js/min/` (gotcha #22) ═════════
test('o bundle GERADO tem os consertos (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  for (const nome of ['marcaDestaAba', 'filaGuardadaDestaConta', 'pedidosQuePousaram', 'abrirCanalDoOffline',
    'avisarOutrasAbasDaFilaGuardada', 'aoGravarFilaGuardadaEmOutraAba', 'CANAL_DO_OFFLINE']) {
    const re = new RegExp('\\b' + nome + '\\b', 'g');
    assert.ok(contar(APP_SEM, re) > 0, `PRÉ-CONDIÇÃO: ${nome} sumiu do fonte`);
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${nome} — falta \`npm run js\``);
  }
});
