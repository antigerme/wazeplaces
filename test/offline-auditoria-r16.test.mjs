// Rodada 16 da auditoria (2026-10-13), a parte do OFFLINE — o lote 20. Os roteiros
// do auditor (r16-4) medidos no navegador; aqui, os mesmos cenários sobre o código
// de verdade, fatiado do app.js, com a ordem da corrida FORÇADA:
//
//  · R16-4-01 — o aviso de PARTE (R15-4-01) que chega com a varredura da PRÓPRIA aba
//    no ar era desfeito no fim dela: a varredura devolvia a cobertura que o aviso
//    tirou, e a linha dizia "Pronto" sobre um card sem mapa (a poda da outra aba o
//    tinha levado), sem que o gatilho seguinte reparasse;
//  · R16-4-02 — 408, 425 e 429 viravam "definitivo" (o tile entrava em `feitos` sem
//    ir ao cache e não era tentado de novo na janela);
//  · R16-4-03 — o "fora" do aviso de PARTE não era o da gravação (faltavam os
//    pedidos que esperam a conta e os que já pousaram): um predicado só.
// Cada teste tem o CONTROLE que dá o resultado oposto, e foi visto REPROVANDO com
// o conserto desfeito (sabotagem no relatório do lote 20).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

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
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function(`return (${m[1]});`)();
};
const OFFLINE_STORE = constante('OFFLINE_STORE');
const OFFLINE_DB = constante('OFFLINE_DB');
const OFFLINE_POUSOS_KEY = constante('OFFLINE_POUSOS_KEY');

const tique = (ms = 1) => new Promise((ok) => setTimeout(ok, ms));
const P = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i });
const chave = (p) => p.venueID + '|' + p.updateRequestID;
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();

// ── A base do IndexedDB, de mentira e do APARELHO (as abas a dividem) ────────
// Abrir leva uma tarefa (é nesse meio que o aviso do "Sair" chega); cada pedido
// é atendido numa tarefa à parte, na ordem; a transação fecha (`oncomplete`) só
// quando não sobra pedido — inclusive o `put` feito no `onsuccess` de um `get`,
// como na de verdade —, e UMA transação por vez: a seguinte (desta aba ou de
// outra) só começa quando a anterior fecha, como as de escrita da de verdade.
// `aoGravar(k)`: um gancho no instante em que o `put` grava.
function baseIDB() {
  const guardado = new Map();
  // `existe`: abrir a base CRIA a base (o `onupgradeneeded`), mesmo vazia.
  const ganchos = { aoGravar: null, aberturas: 0, apagamentos: 0, leituras: [], gravacoes: 0, existe: false };
  let cadeia = Promise.resolve();
  const offlineDB = async () => {
    await tique();
    ganchos.aberturas++;
    ganchos.existe = true;
    return {
      close() {},
      transaction() {
        const tx = {};
        let pendentes = 0;
        let fechou = false;
        let comecou = false;
        const esperando = [];
        let soltar;
        const anterior = cadeia;
        cadeia = new Promise((ok) => { soltar = ok; });
        const fechar = () => {
          if (fechou) return;
          fechou = true;
          setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); soltar(); });
        };
        const atender = (fazer, r) => setTimeout(() => {
          r.result = fazer();
          if (typeof r.onsuccess === 'function') r.onsuccess();
          if (--pendentes === 0) fechar();
        });
        anterior.then(() => {
          comecou = true;
          for (const [fazer, r] of esperando.splice(0)) atender(fazer, r);
          // A transação sem pedido nenhum fecha sozinha.
          if (pendentes === 0) fechar();
        });
        const pedido = (fazer) => {
          pendentes++;
          const r = {};
          if (comecou) atender(fazer, r); else esperando.push([fazer, r]);
          return r;
        };
        tx.objectStore = () => ({
          get: (k) => { ganchos.leituras.push(k); return pedido(() => (guardado.has(k) ? structuredClone(guardado.get(k)) : undefined)); },
          put: (v, k) => pedido(() => { ganchos.gravacoes++; guardado.set(k, structuredClone(v)); if (ganchos.aoGravar) ganchos.aoGravar(k); }),
        });
        return tx;
      },
    };
  };
  // Apagar a base apaga TUDO (o `deleteDatabase` de verdade, de qualquer aba).
  const indexedDB = { deleteDatabase: () => { ganchos.apagamentos++; ganchos.existe = false; guardado.clear(); } };
  return { guardado, ganchos, offlineDB, indexedDB };
}


// ═══ R14-4-01 · duas abas com a MESMA fila ═══════════════════════════════════
// O roteiro e1 do auditor, com a gravação, a varredura, a poda, a janela, a linha
// e o canal de VERDADE sobre a base (serializada), o cache do mapa e o canal de
// mentira que as abas dividem. Um tile por pedido; o relógio anda 1 ms por
// leitura, dentro de UMA janela. A abertura com rede é a de verdade: a janela
// guardada ANTES da busca (`abrirComSessaoSalva`), e a busca grava e varre
// (`fetchNextPage`).
const OFFLINE_CICLO_MS = constante('OFFLINE_CICLO_MS');
const DECL_CANAL = [
  /^const CANAL_DO_OFFLINE = '[^']+';$/m.exec(APP_SEM),
  /^let canalDoOffline = null;$/m.exec(APP_SEM),
].map((m, i) => { assert.ok(m, `a declaração ${i} do canal do offline sumiu do app.js`); return m[0]; });
const CANAL = /^const CANAL_DO_OFFLINE = '([^']+)';$/m.exec(APP_SEM)[1];

// O `BroadcastChannel` de mentira: entrega às OUTRAS instâncias do mesmo nome,
// numa tarefa à parte e por cópia, como o de verdade, e com TETO de entregas (um
// aviso que gerasse outro viraria laço, gotcha #19). `posts`: quantas mensagens
// cada nome recebeu pra entregar.
function canaisDeMentira() {
  const canais = new Map();
  const posts = new Map();
  let entregas = 0;
  class CanalDeMentira {
    constructor(nome) {
      this.nome = nome;
      this.onmessage = null;
      if (!canais.has(nome)) canais.set(nome, new Set());
      canais.get(nome).add(this);
    }
    postMessage(msg) {
      posts.set(this.nome, (posts.get(this.nome) || 0) + 1);
      const dado = structuredClone(msg);
      for (const outro of canais.get(this.nome)) {
        if (outro === this || ++entregas > 60) continue;
        setTimeout(() => { if (typeof outro.onmessage === 'function') outro.onmessage({ data: structuredClone(dado) }); }, 0);
      }
    }
    close() { canais.get(this.nome).delete(this); }
  }
  return { BroadcastChannel: CanalDeMentira, posts: (nome) => posts.get(nome) || 0 };
}
const entregue = () => new Promise((ok) => setTimeout(ok, 5));

const NOMES_ABA = ['filaReal', 'chaveDoPedido', 'chavesQueEsperamAConta', 'marcaDaSessao', 'marcaDestaAba', 'offlineGravarFila', 'pedidoForaDaFilaGuardada', 'offlineLerFila',
  'offlineGravarJanela', 'offlineLerRegistroDaJanela', 'offlineRecuperarJanela', 'offlinePodarTiles', 'offlineVarrer',
  'offlinePrecisaVarrer', 'offlineTalvezVarrer', 'offlineMarcarGesto', 'filaGuardadaEsperandoOTreino',
  'atualizarLinhaDoOffline', 'abrirCanalDoOffline', 'avisarOutrasAbasDaFilaGuardada', 'aoGravarFilaGuardadaEmOutraAba',
  'aoManterOCarimboComPartes'];
function aparelhoDeDuasAbas() {
  const base = baseIDB();
  const cache = new Map();
  const caches = {
    has: async () => cache.size > 0,
    open: async () => ({
      keys: async () => [...cache.keys()].map((url) => ({ url })),
      delete: async (r) => { cache.delete(r.url); },
    }),
  };
  const relogio = { agora: 1492385 * OFFLINE_CICLO_MS + 1000 };   // começo de uma janela
  const nav = canaisDeMentira();
  function aba(fila, { sessao = 'tok-a', semCanal = false } = {}) {
    const diario = [];
    const baixados = [];
    // `segura`: os downloads ficam presos até `soltar()` (a preparação NO AR).
    const rede = { segura: false, presos: [] };
    const el = { textContent: '', innerHTML: '' };
    const API = { sessionToken: sessao };
    const AppState = { authenticated: true, queue: fila.slice(), filters: {}, preferences: { offlineDisponivel: true } };
    const navigator = { onLine: true };
    const deps = {
      AppState, API, Treino: { ativo: false }, navigator, offlineLigado: () => true,
      Date: { now: () => relogio.agora++ },
      offlineDB: base.offlineDB, indexedDB: base.indexedDB, OFFLINE_DB, OFFLINE_STORE,
      OFFLINE_TILES_CACHE: 'waze-places-tiles', caches,
      BroadcastChannel: semCanal ? undefined : nav.BroadcastChannel,
      offlinePodarPousos: () => {}, dfato: (k) => diario.push(k),
      lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), contaAgora: () => '4242',
      OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS, OFFLINE_CONCORRENCIA: 1, OFFLINE_ANUNCIAR_A_CADA: 50,
      OFFLINE_TENTATIVAS_POR_ITEM: constante('OFFLINE_TENTATIVAS_POR_ITEM'),
      offlineItensDaFila: async () => AppState.queue.map((p) => ({ u: 'tile-' + p.venueID, tile: true })),
      offlineBaixar: (u) => new Promise((ok) => {
        const r = () => { baixados.push(u); cache.set(u, true); ok(true); };
        const segura = typeof rede.segura === 'function' ? rede.segura(u) : rede.segura;
        if (segura) rede.presos.push(r); else r();
      }),
      offlineSondarRede: async () => true, offlineAnunciarTiles: () => {},
      // A espera entre tentativas da varredura (400 ms) não é o que se mede aqui.
      setTimeout: (fn) => { fn(); return 0; },
      document: { getElementById: () => el }, t: (k) => k, escapeHtml: (x) => x,
    };
    const chaves = Object.keys(deps);
    const app = new Function(...chaves, [
      'let filaDeOnde = null, offlineVarrendo = false, offlinePedidaDeNovo = false, offlineUltimoGesto = Date.now(),',
      '    offlineJanelaServida = null, offlineUltimoResultado = null, offlineSegurarAte = 0, offlineEpoca = 0, offlineFilaGravadaEm = null,',
      '    offlineFilaPreparada = null, offlineFilaGravadaChaves = null, offlineFilaVarrida = null,',
      '    offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set(), guardados: new Set() };',
      'const decididosPorOutraAbaComCardAqui = new WeakSet(), pedidosEmAndamento = new Set(), pedidosQuePousaram = new WeakSet(), avisosDePousoSemConta = [];',
      ...DECL_CANAL,
      ...NOMES_ABA.map(fatiar),
      'abrirCanalDoOffline();',
      `return { receber: aoGravarFilaGuardadaEmOutraAba, decididoPorOutraAba: (p) => decididosPorOutraAbaComCardAqui.add(p),
        pousou: (p) => pedidosQuePousaram.add(p), esperaAConta: (chaves) => avisosDePousoSemConta.push({ chaves }), emAndamento: pedidosEmAndamento,
        manterComPartes: aoManterOCarimboComPartes, gesto: offlineMarcarGesto, gravarFila: offlineGravarFila, varrer: offlineVarrer, recuperarJanela: offlineRecuperarJanela,
        gatilho: offlineTalvezVarrer, precisaVarrer: offlinePrecisaVarrer,
        linha: () => { atualizarLinhaDoOffline(0, 0); const e = document.getElementById('prefOfflineDesc'); return e.innerHTML || e.textContent; },
        // A linha como ESTÁ na tela agora, sem redesenhar (as Preferências abertas).
        naTela: () => { const e = document.getElementById('prefOfflineDesc'); return e.innerHTML || e.textContent; },
        estado: () => ({ resultado: offlineUltimoResultado, varrendo: offlineVarrendo, gravada: offlineFilaGravadaEm,
          preparada: offlineFilaPreparada, chaves: offlineFilaGravadaChaves }) };`,
    ].join('\n'))(...chaves.map((k) => deps[k]));
    // A abertura COM rede, e a busca que traz pedido novo, como o `fetchNextPage`.
    const abrir = async () => { await app.recuperarJanela(); await app.gravarFila(relogio.agora); await app.varrer(); };
    const buscar = async (novos) => { AppState.queue.push(...novos); await app.gravarFila(relogio.agora); await app.varrer(); };
    const soltar = () => { rede.segura = false; for (const r of rede.presos.splice(0)) r(); };
    // Quantas preparações TERMINARAM (prontas ou parciais) nesta aba.
    const preparacoes = () => diario.filter((k) => k === 'offline.pronto' || k === 'offline.parcial').length;
    return { ...app, AppState, navigator, diario, baixados, rede, abrir, buscar, soltar, preparacoes };
  }
  return { aba, base, cache, relogio, posts: () => nav.posts(CANAL) };
}
// Um gatilho (a prova de rede, abrir as Preferências) e o FIM do que ele disparou:
// pelo estado, por sinal positivo e com teto — nunca por prazo fixo.
async function gatilhoAteOFim(X) {
  X.gatilho();
  const fim = performance.now() + 5000;
  while (X.estado().varrendo) {
    if (performance.now() > fim) assert.fail('a varredura do gatilho não terminou em 5 s');
    await tique(2);
  }
  await entregue();
}
// Uma condição, por sinal positivo e com teto.
async function ateQue(cond, rotulo, ms = 5000) {
  const fim = performance.now() + ms;
  while (!cond()) {
    if (performance.now() > fim) assert.fail(`${rotulo}: não aconteceu em ${ms} ms`);
    await tique(2);
  }
}

const PRONTO = /prefs\.offline\.prontoA/;
const PENDENTE = /prefs\.offline\.pendenteA/;
const MESMA = () => [1, 2, 3, 4, 5, 6].map(P);



// ═══ R15-4-01 · PARTE dos pedidos mantém o carimbo — a outra aba é avisada ═══════
// O roteiro parte2 do auditor: duas abas com a MESMA fila, as duas "Pronto"; B
// PULA (↑) um pedido, e a preparação seguinte de B (só a janela virando a
// dispara) grava a fila dela — PARTE da guardada, carimbo mantido — e poda do
// cache o mapa do pedido que só A tem.
const PEDIDO_PULADO = 'tile-v2';
async function bPulaEPrepara(ap, B) {
  B.AppState.queue = B.AppState.queue.filter((p) => p.venueID !== 'v2');   // o ↑: sai da fila de B, nada vai pro canal de pouso
  await B.varrer();
  await entregue();
}
async function duasAbasProntas() {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba(MESMA());
  await A.abrir();
  const B = ap.aba(MESMA(), { sessao: 'tok-b' });
  await B.abrir();
  await entregue();
  assert.deepEqual([A.estado().resultado, B.estado().resultado], ['pronto', 'pronto'], 'PRÉ-CONDIÇÃO: as duas abas não ficaram prontas');
  assert.match(A.naTela(), PRONTO, 'PRÉ-CONDIÇÃO: A não diz "Pronto"');
  return { ap, A, B };
}


// ═══ R16-4-01 · o aviso de PARTE com a varredura da PRÓPRIA aba no ar ════════════
// O roteiro duas-abas do auditor: A e B prontas com a MESMA fila (carimbo T). A janela
// vira nas duas; A começa a baixar (a rede de A segura o 5º tile: o mapa do pedido
// v2 já está no cache); B PULA o v2 e prepara — PARTE da fila guardada, carimbo
// mantido, e a poda de B tira o mapa do v2 do cache; A solta e termina.
const OFFLINE_CICLO = OFFLINE_CICLO_MS;
async function prontas({ semCanalA = false } = {}) {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba(MESMA(), { semCanal: semCanalA });
  await A.abrir();
  const B = ap.aba(MESMA(), { sessao: 'tok-b' });
  await B.abrir();
  await entregue();
  assert.deepEqual([A.estado().resultado, B.estado().resultado], ['pronto', 'pronto'], 'PRÉ-CONDIÇÃO: as duas abas não ficaram prontas');
  assert.equal(A.estado().preparada, A.estado().gravada, 'PRÉ-CONDIÇÃO: A não está coberta');
  return { ap, A, B };
}
// A janela VIRA nas duas (a de 20 min) e A começa a baixar, presa no 5º tile.
async function aVarreComAJanelaNova(ap, A, B) {
  ap.relogio.agora += OFFLINE_CICLO;
  A.gesto(); B.gesto();
  A.rede.segura = (u) => u === 'tile-v5';
  const varreA = A.varrer();
  await ateQue(() => A.rede.presos.length === 1, 'A chegar ao 5º tile');
  assert.equal(A.estado().varrendo, true, 'PRÉ-CONDIÇÃO: a varredura de A não está no ar');
  assert.equal(ap.cache.has('tile-v2'), true, 'PRÉ-CONDIÇÃO: A ainda não guardou o mapa do v2');
  return { varreA };   // num objeto: devolver a promessa de dentro de uma `async` a ESPERARIA, e ela está presa
}

test('R16-4-01: B pula o v2 e prepara COM a varredura de A no ar — A termina SEM cobertura: a linha não diz "Pronto" e o gatilho seguinte baixa o mapa que a poda levou', async () => {
  const { ap, A, B } = await prontas();
  const t = ap.base.guardado.get('fila').t;
  const { varreA } = await aVarreComAJanelaNova(ap, A, B);
  await bPulaEPrepara(ap, B);
  // PRÉ-CONDIÇÕES do defeito: PARTE com o carimbo mantido, a poda levou o mapa, o aviso chegou a A.
  assert.equal(ap.base.guardado.get('fila').t, t, 'PRÉ-CONDIÇÃO: a fila de B (parte da guardada) não manteve o carimbo');
  assert.equal(ap.base.guardado.get('fila').places.length, 5, 'PRÉ-CONDIÇÃO: a fila guardada não é a de B');
  assert.equal(ap.cache.has(PEDIDO_PULADO), false, 'PRÉ-CONDIÇÃO: a poda de B não levou o mapa do v2');
  assert.ok(A.diario.includes('offline.outraAbaParte'), 'PRÉ-CONDIÇÃO: o aviso de PARTE não chegou a A com a varredura no ar');
  A.soltar();
  await varreA;
  await entregue();
  assert.equal(A.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a varredura de A não terminou');
  assert.notEqual(A.estado().preparada, A.estado().gravada,
    'DEFEITO: o fim da varredura de A devolveu a cobertura que o aviso de PARTE tirou — "cobre a fila guardada" com um pedido sem mapa');
  assert.doesNotMatch(A.naTela(), PRONTO, `DEFEITO: A termina dizendo "Pronto — 6 pedidos" com o mapa do v2 fora do aparelho: ${A.naTela()}`);
  A.navigator.onLine = false;
  assert.doesNotMatch(A.linha(), /prefs\.offline\.prontoSemRedeB/,
    `DEFEITO: sem rede, a linha de A diz que está tudo guardado — com um card sem mapa: ${A.linha()}`);
  A.navigator.onLine = true;
  assert.equal(A.precisaVarrer(), true, 'DEFEITO: o gatilho seguinte de A não repara — Gravada == Preparada, e a linha não sai do lugar');
  // E o gatilho de A prepara a fila DELA, baixando só o que a poda levou.
  const antes = A.baixados.length;
  await gatilhoAteOFim(A);
  assert.deepEqual(A.baixados.slice(antes), [PEDIDO_PULADO], 'o gatilho de A não baixou SÓ o mapa que a poda de B levou');
  assert.equal(ap.cache.has(PEDIDO_PULADO), true);
  assert.match(A.linha(), PRONTO);
});

test('R16-4-01: o aviso pode NÃO chegar (iOS < 15.4 não tem o canal) — a base diz que falta pedido, e A também termina sem cobertura', async () => {
  const { ap, A, B } = await prontas({ semCanalA: true });
  const { varreA } = await aVarreComAJanelaNova(ap, A, B);
  await bPulaEPrepara(ap, B);
  assert.ok(!A.diario.includes('offline.outraAbaParte'), 'PRÉ-CONDIÇÃO: A recebeu o aviso, sem canal');
  assert.equal(ap.cache.has(PEDIDO_PULADO), false, 'PRÉ-CONDIÇÃO: a poda de B não levou o mapa do v2');
  A.soltar();
  await varreA;
  await entregue();
  assert.notEqual(A.estado().preparada, A.estado().gravada,
    'DEFEITO: sem o aviso, A terminou "cobrindo" uma fila guardada que não tem o pedido dela');
  assert.doesNotMatch(A.naTela(), PRONTO);
  assert.equal(A.precisaVarrer(), true);
});

test('R16-4-01: CONTROLE — a MESMA fila nas duas abas (B não pula nada), ou o pedido decidido pela outra aba: A termina "Pronto" e cobre a fila guardada', async () => {
  // (a) B só prepara, sem pular: nada fora da base.
  const a = await prontas();
  const { varreA } = await aVarreComAJanelaNova(a.ap, a.A, a.B);
  await a.B.varrer();
  await entregue();
  a.A.soltar();
  await varreA;
  await entregue();
  assert.equal(a.A.estado().preparada, a.A.estado().gravada, 'CONTROLE: a MESMA fila nas duas abas tirou a cobertura de A');
  assert.match(a.A.naTela(), PRONTO);
  assert.equal(a.A.precisaVarrer(), false, 'CONTROLE: A prepararia de novo a fila que já preparou');
  // (b) B pula e o pedido SAI da fila de A também (o pouso chegou): não há pedido a mais.
  const b = await prontas();
  const { varreA: varreB } = await aVarreComAJanelaNova(b.ap, b.A, b.B);
  b.A.AppState.queue = b.A.AppState.queue.filter((p) => p.venueID !== 'v2');
  await bPulaEPrepara(b.ap, b.B);
  b.A.soltar();
  await varreB;
  await entregue();
  assert.equal(b.A.estado().preparada, b.A.estado().gravada, 'CONTROLE: o pedido que A já não tem tirou a cobertura dela');
  assert.match(b.A.naTela(), PRONTO);
  // (c) o pedido que A deu por decidido pela outra aba (o card ainda aqui) não conta como "a mais".
  const c = await prontas();
  const { varreA: varreC } = await aVarreComAJanelaNova(c.ap, c.A, c.B);
  c.A.decididoPorOutraAba(c.A.AppState.queue.find((p) => p.venueID === 'v2'));
  await bPulaEPrepara(c.ap, c.B);
  c.A.soltar();
  await varreC;
  await entregue();
  assert.equal(c.A.estado().preparada, c.A.estado().gravada, 'CONTROLE: o pedido decidido pela outra aba tirou a cobertura de A');
});

test('R16-4-01: a leitura da fila guardada vem ANTES da cobertura, a época é conferida depois dela, e nada assíncrono separa a conferência da gravação da janela', () => {
  const corpo = fatiar('offlineVarrer');
  const iLer = corpo.indexOf('await offlineLerFila()');
  const iEpoca = corpo.indexOf('if (epoca !== offlineEpoca) return;', iLer);
  const iPreparada = corpo.indexOf('offlineFilaPreparada = cobertaDeFato;');
  const iJanela = corpo.indexOf('offlineGravarJanela(janela, cobertaDeFato)');
  assert.ok(iLer > 0 && iEpoca > iLer && iPreparada > iEpoca && iJanela > iPreparada,
    'a ordem é: ler a fila guardada, conferir a época, dar a cobertura (ou não) e gravar a janela');
  assert.doesNotMatch(corpo.slice(iEpoca, iJanela), /\bawait\b/,
    'um await entre a conferência da época e a gravação da janela deixa um "Sair" entrar atrás dela e apagar tudo');
  assert.doesNotMatch(corpo, /offlineFilaPreparada = filaCoberta;/, 'a cobertura voltou a ser dada sem conferir a base');
});

// ═══ R16-4-02 · 408, 425 e 429 não são "o tile não existe" ═══════════════════════
test('R16-4-02: offlineBaixar — 408, 425 e 429 são falha PASSAGEIRA (volta na retomada); os outros 4xx seguem definitivos', async () => {
  const guardados = [];
  const deps = {
    offlineEpoca: 0, OFFLINE_TILES_CACHE: 'waze-places-tiles', OFFLINE_ITEM_TETO_MS: 30000,
    OFFLINE_4XX_PASSAGEIRO: new Function('return ' + /^const OFFLINE_4XX_PASSAGEIRO = (new Set\(\[[^\]]*\]\));/m.exec(APP_SEM)[1])(),
    caches: { open: async () => ({ put: async (u) => guardados.push(u) }) },
    Image: class {}, offlineGravandoTile: new Map(), offlineGeracaoDeTile: 0,
  };
  const chaves = Object.keys(deps);
  const baixarCom = (status) => new Function(...chaves, 'fetch', fatiar('offlineBaixar') + '\nreturn offlineBaixar;')(
    ...chaves.map((k) => deps[k]), async () => ({ ok: status < 300, status }));
  const url = (i) => 'https://www.waze.com/row-tiles/live/base/' + i;
  for (const status of [408, 425, 429]) {
    // Desde o lote 21 (R17-4-01) a falha passageira tem nome próprio, 'limite': o que importa aqui
    // segue sendo que NÃO é 'definitivo' (nem sucesso) — o tile volta na retomada.
    assert.equal(await baixarCom(status)(url(status), true), 'limite',
      `DEFEITO: o ${status} é "definitivo" — o tile entra em \`feitos\` sem ir ao cache e não é tentado de novo na janela`);
  }
  // CONTROLE: o que é "não existe" segue definitivo; 5xx e 200 como sempre.
  for (const status of [400, 401, 403, 404, 410, 451]) assert.equal(await baixarCom(status)(url(status), true), 'definitivo', `CONTROLE: o ${status} deixou de ser definitivo`);
  assert.equal(await baixarCom(503)(url(503), true), false);
  assert.equal(await baixarCom(200)(url(200), true), true);
  assert.deepEqual(guardados, [url(200)], 'só o 200 vai ao cache');
});

// ═══ R16-4-03 · um "fora" só, o da gravação ══════════════════════════════════════
// O aviso de PARTE (`aoManterOCarimboComPartes`) contava como "a mais" o pedido que
// espera a conta e o que já pousou — que a gravação nunca grava, de qualquer aba.
async function perdeComOAviso(preparar) {
  const { ap, A } = await prontas();
  const t = ap.base.guardado.get('fila').t;
  const alvo = A.AppState.queue.find((p) => p.venueID === 'v2');
  preparar(A, alvo);
  const chaves = A.AppState.queue.filter((p) => p !== alvo).map(chave);
  A.manterComPartes({ v: 1, filaGuardada: t, chaves });
  return A.estado().preparada === null;
}
test('R16-4-03: o pedido que espera a conta, o que já pousou e o em andamento NÃO tiram a cobertura de A — só o pedido que a gravação gravaria', async () => {
  assert.equal(await perdeComOAviso(() => {}), true, 'CONTROLE: o pedido só desta aba (que a gravação gravaria) tem de tirar a cobertura');
  assert.equal(await perdeComOAviso((A, p) => A.esperaAConta([chave(p)])), false,
    'DEFEITO: o pedido cujo aviso de pouso espera a conta (a gravação o deixa de fora) tirou a cobertura de A');
  assert.equal(await perdeComOAviso((A, p) => A.pousou(p)), false,
    'DEFEITO: o pedido que já POUSOU com o card ainda na fila (a gravação o deixa de fora) tirou a cobertura de A');
  assert.equal(await perdeComOAviso((A, p) => A.emAndamento.add(chave(p))), false, 'CONTROLE: o pedido em andamento tirou a cobertura de A');
  assert.equal(await perdeComOAviso((A, p) => A.decididoPorOutraAba(p)), false, 'CONTROLE: o pedido decidido pela outra aba tirou a cobertura de A');
});

test('R16-4-03: a gravação, o aviso de PARTE e o fim da varredura perguntam ao MESMO predicado — nenhum conta o "fora" por conta própria (gotcha #63)', () => {
  for (const nome of ['offlineGravarFila', 'aoManterOCarimboComPartes', 'offlineVarrer']) {
    const corpo = fatiar(nome);
    assert.match(corpo, /pedidoForaDaFilaGuardada\(/, `${nome} não pergunta ao predicado único`);
    for (const cru of ['decididosPorOutraAbaComCardAqui', 'pedidosEmAndamento', 'pedidosQuePousaram']) {
      assert.doesNotMatch(corpo, new RegExp('\\b' + cru + '\\b'), `${nome} voltou a contar o "fora" por conta própria (${cru})`);
    }
  }
  const pred = fatiar('pedidoForaDaFilaGuardada');
  for (const parte of ['decididosPorOutraAbaComCardAqui', 'pedidosEmAndamento', 'pedidosQuePousaram', 'esperandoAConta']) {
    assert.match(pred, new RegExp('\\b' + parte + '\\b'), `o predicado único não cobre ${parte}`);
  }
});

test('o bundle GERADO tem os consertos do lote 20 (senão nada disso está no ar)', () => {
  for (const nome of ['pedidoForaDaFilaGuardada', 'OFFLINE_4XX_PASSAGEIRO', 'semNaBase']) {
    assert.ok(MIN.includes(nome), `js/min/app.js não tem ${nome} — rode \`npm run js\``);
  }
});

// ═══ R16-8-05 · o desfazer de uma gravação velha não apaga a da época seguinte ════
// O `put` da época 0 segue no ar quando o "Sair" de OUTRA aba chega (a época sobe, e o
// cache — recriado pelo `open` dela, depois do apagamento de lá — não é apagado aqui);
// a época seguinte guarda o MESMO tile nesse cache; o `put` velho termina e o desfazer
// dele apagava o tile da nova (MEDIDO no Chromium e no WebKit com a ordem forçada:
// `velha: false, nova: true`, e o tile fora do cache depois).
function tileComPutPreso() {
  const guardado = new Map();
  let puts = 0;
  let soltar;
  const portao = new Promise((ok) => { soltar = ok; });
  const cacheObj = {
    put: async (u, r) => { const eu = puts++; if (eu === 0) await portao; await tique(); guardado.set(u, r); },
    delete: async (u) => guardado.delete(u),
    keys: async () => [...guardado.keys()].map((url) => ({ url })),
  };
  const deps = {
    caches: { open: async () => { await tique(); return cacheObj; }, delete: async () => { guardado.clear(); return true; } },
    OFFLINE_TILES_CACHE: 'waze-places-tiles', OFFLINE_ITEM_TETO_MS: 30000, AbortController,
    fetch: async () => ({ ok: true, status: 200 }), Image: class {}, setTimeout, clearTimeout,
    offlineGravandoTile: new Map(), offlineGeracaoDeTile: 0,
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, [
    'let offlineEpoca = 0;', fatiar('offlineDesfazerTile'), fatiar('offlineBaixar'),
    'return { baixar: offlineBaixar, esquecer: () => { offlineEpoca++; } };',
  ].join('\n'))(...chaves.map((k) => deps[k]));
  return { app, guardado, soltar, putsNoAr: () => puts };
}
const TILE = 'https://tile/17/1/2.png';

test('R16-8-05: o `put` da época velha termina DEPOIS de a época seguinte guardar o mesmo tile — o desfazer dele não apaga o da nova', async () => {
  const x = tileComPutPreso();
  const velha = x.app.baixar(TILE, true);
  await ateQue(() => x.putsNoAr() === 1, 'o put da época velha ficar preso');
  x.app.esquecer();                                          // o aviso do "Sair" de outra aba: a época sobe
  assert.equal(await x.app.baixar(TILE, true), true, 'PRÉ-CONDIÇÃO: a época seguinte não guardou o tile');
  assert.equal(x.guardado.has(TILE), true, 'PRÉ-CONDIÇÃO: o tile da época nova não está no cache');
  x.soltar();
  assert.equal(await velha, false, 'a gravação da época velha tem de falhar (a época trocou)');
  assert.equal(x.guardado.has(TILE), true,
    'DEFEITO: o desfazer da gravação velha apagou o tile que a época seguinte guardou — o mapa abre sem tile e a varredura nova o deu por feito');
});

test('R16-8-05: CONTROLE — sem gravação nova para o endereço, o desfazer da velha tira o tile (R15-4-02), e o de OUTRO endereço não é tocado', async () => {
  const x = tileComPutPreso();
  const velha = x.app.baixar(TILE, true);
  await ateQue(() => x.putsNoAr() === 1, 'o put da época velha ficar preso');
  x.app.esquecer();
  assert.equal(await x.app.baixar('https://tile/17/9/9.png', true), true);   // outro endereço, da época nova
  x.soltar();
  assert.equal(await velha, false);
  assert.deepEqual([...x.guardado.keys()], ['https://tile/17/9/9.png'], 'CONTROLE: o tile da época velha ficou, ou o de outro endereço saiu');
});

// ═══ R17-4-06 (lote 21) · o carimbo NOVO sem o `BroadcastChannel` ════════════════════════════
// O R16-4-01 fechou o caso de PARTE dos pedidos sem canal (a base diz que falta pedido). O de
// carimbo NOVO — B grava OUTROS pedidos — seguia aberto no iOS < 15.4: o fim da varredura já
// tem a base na mão (`naBase.t !== filaCoberta`) e não a usava, então A terminava "Pronto"
// cobrindo uma fila que não era mais a guardada (MEDIDO no navegador, s5 do auditor: "Pronto"
// com 3 mapas fora; com o canal, "Ainda não preparado").
test('R17-4-06: B grava pedidos NOVOS (carimbo novo) e prepara, A SEM canal termina a varredura — A passa a saber que a fila guardada é outra, a linha não diz "Pronto" e o gatilho seguinte prepara', async () => {
  const { ap, A, B } = await prontas({ semCanalA: true });
  const { varreA } = await aVarreComAJanelaNova(ap, A, B);
  const tAntes = ap.base.guardado.get('fila').t;
  await B.buscar([P(7), P(8)]);
  await entregue();
  assert.notEqual(ap.base.guardado.get('fila').t, tAntes, 'PRÉ-CONDIÇÃO: a fila de B (com pedidos novos) não ganhou carimbo novo');
  assert.ok(!A.diario.includes('offline.outraAba'), 'PRÉ-CONDIÇÃO: A recebeu o aviso, sem canal');
  A.soltar();
  await varreA;
  await entregue();
  assert.equal(A.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a varredura de A não terminou');
  assert.equal(A.estado().gravada, ap.base.guardado.get('fila').t, 'DEFEITO: A não ficou sabendo qual fila está guardada (a de B)');
  assert.notEqual(A.estado().preparada, A.estado().gravada,
    'DEFEITO: A terminou "cobrindo" a fila guardada de B — com os mapas dos pedidos de B fora do aparelho');
  assert.doesNotMatch(A.naTela(), PRONTO, `DEFEITO: A termina dizendo "Pronto" sobre a fila de B: ${A.naTela()}`);
  assert.equal(A.precisaVarrer(), true, 'DEFEITO: o gatilho seguinte de A não prepara');
  assert.ok(A.diario.includes('offline.outraAba'), 'o diário de A não anotou que a fila guardada é de outra aba');
});

test('R17-4-06: CONTROLE — sem canal, a MESMA fila nas duas abas (B só prepara) e a busca da PRÓPRIA aba durante a varredura não tiram a cobertura de A', async () => {
  const a = await prontas({ semCanalA: true });
  const { varreA } = await aVarreComAJanelaNova(a.ap, a.A, a.B);
  await a.B.varrer();
  await entregue();
  a.A.soltar();
  await varreA;
  await entregue();
  assert.equal(a.A.estado().preparada, a.A.estado().gravada, 'CONTROLE: a MESMA fila tirou a cobertura de A');
  assert.match(a.A.naTela(), PRONTO);
  assert.ok(!a.A.diario.includes('offline.outraAba'), 'CONTROLE: A anotou "outra aba" sem outra aba ter gravado nada');
});
