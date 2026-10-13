// Rodada 15 da auditoria (2026-10-12), a parte do OFFLINE e do DIAGNÓSTICO — o
// lote 19. Os roteiros do auditor (r15-4) medidos no navegador; aqui, os mesmos
// cenários sobre o código de verdade, fatiado do app.js, com a ordem da corrida
// FORÇADA (a janela de milissegundos que só o teste abre):
//
//  · R15-4-01 — a regravação com PARTE dos pedidos mantém o carimbo (R14-4-01) e
//    não avisava a outra aba: o pular (↑) não vai pelo canal de pouso, a aba
//    parada seguia com o pedido, a poda de lá tirava o mapa dele e a linha SEM
//    REDE dizia "Pronto" sobre um card sem mapa;
//  · R15-4-02 — o download do tile e a gravação da janela não conferiam a ÉPOCA do
//    offline depois do `await`: o "Sair" de outra aba apagava o cache e a base, e
//    eles voltavam (o cache com o tile de um pedido de terceiro, a base com a
//    janela);
//  · R15-4-03 — a "idade" da fila guardada no relatório deixou de ser a da última
//    gravação (o carimbo é mantido pela mesma fila);
//  · R15-4-04 — o contador `tiles.falharam` do relatório passava de `pedidos`: o
//    `<img>` do desenho de reserva falhava depois de tirado do DOM e a falha caía
//    na conta do desenho real.
// Cada teste tem o CONTROLE que dá o resultado oposto, e foi visto REPROVANDO com
// o conserto desfeito (sabotagem no relatório do lote 19).
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

const NOMES_ABA = ['filaReal', 'chaveDoPedido', 'marcaDaSessao', 'marcaDestaAba', 'offlineGravarFila', 'pedidoForaDaFilaGuardada', 'offlineLerFila',
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
  function aba(fila, { sessao = 'tok-a' } = {}) {
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
      BroadcastChannel: nav.BroadcastChannel,
      offlinePodarPousos: () => {}, dfato: (k) => diario.push(k),
      lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), contaAgora: () => '4242',
      OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS, OFFLINE_CONCORRENCIA: 1, OFFLINE_ANUNCIAR_A_CADA: 50,
      OFFLINE_TENTATIVAS_POR_ITEM: constante('OFFLINE_TENTATIVAS_POR_ITEM'),
      offlineItensDaFila: async () => AppState.queue.map((p) => ({ u: 'tile-' + p.venueID, tile: true })),
      offlineBaixar: (u) => new Promise((ok) => {
        const r = () => { baixados.push(u); cache.set(u, true); ok(true); };
        if (rede.segura) rede.presos.push(r); else r();
      }),
      offlineSondarRede: async () => true, offlineAnunciarTiles: () => {},
      // A espera entre tentativas da varredura (400 ms) não é o que se mede aqui.
      setTimeout: (fn) => { fn(); return 0; },
      document: { getElementById: () => el }, t: (k) => k, escapeHtml: (x) => x,
    };
    const chaves = Object.keys(deps);
    const app = new Function(...chaves, [
      'let filaDeOnde = null, offlineVarrendo = false, offlinePedidaDeNovo = false, offlineUltimoGesto = Date.now(),',
      '    offlineJanelaServida = null, offlineUltimoResultado = null, offlineEpoca = 0, offlineFilaGravadaEm = null,',
      '    offlineFilaPreparada = null, offlineFilaGravadaChaves = null, offlineFilaVarrida = null,',
      '    offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set(), guardados: new Set() };',
      'const decididosPorOutraAbaComCardAqui = new WeakSet(), pedidosEmAndamento = new Set(), pedidosQuePousaram = new WeakSet();',
      ...DECL_CANAL,
      ...NOMES_ABA.map(fatiar),
      'abrirCanalDoOffline();',
      `return { receber: aoGravarFilaGuardadaEmOutraAba, decididoPorOutraAba: (p) => decididosPorOutraAbaComCardAqui.add(p), gravarFila: offlineGravarFila, varrer: offlineVarrer, recuperarJanela: offlineRecuperarJanela,
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

test('R15-4-01: B pula um pedido e prepara (PARTE, carimbo mantido) — a linha de A, que ainda o tem, deixa de dizer "Pronto"; sem rede também', async () => {
  const { ap, A, B } = await duasAbasProntas();
  const t = ap.base.guardado.get('fila').t;
  assert.equal(ap.cache.has(PEDIDO_PULADO), true, 'PRÉ-CONDIÇÃO: o mapa do pedido não está no cache antes de B podar');
  await bPulaEPrepara(ap, B);
  // PRÉ-CONDIÇÃO do defeito: o carimbo foi mantido pela regra do subconjunto e a poda levou o mapa.
  assert.equal(ap.base.guardado.get('fila').t, t, 'PRÉ-CONDIÇÃO: a fila de B (parte da guardada) não manteve o carimbo — a regra do subconjunto mudou');
  assert.equal(ap.base.guardado.get('fila').places.length, 5, 'PRÉ-CONDIÇÃO: a fila guardada não é a de B');
  assert.equal(ap.cache.has(PEDIDO_PULADO), false, 'PRÉ-CONDIÇÃO: a poda de B não levou o mapa do pedido que só A tem');
  assert.equal(A.AppState.queue.length, 6, 'PRÉ-CONDIÇÃO: A perdeu o pedido pulado por B (o pular não vai pelo canal de pouso)');
  assert.doesNotMatch(A.naTela(), PRONTO,
    `DEFEITO: A diz "Pronto — 6 pedidos" com a fila guardada sem o pedido dela (e o mapa dele fora do aparelho): ${A.naTela()}`);
  assert.ok(A.diario.includes('offline.outraAbaParte'), 'o diário de A não registrou que a outra aba regravou PARTE dos pedidos');
  // SEM rede: a linha que mentia ("Pronto — … você segue com o que está guardado").
  A.navigator.onLine = false;
  assert.doesNotMatch(A.linha(), /prefs\.offline\.prontoSemRedeB/,
    `DEFEITO: sem rede, a linha de A diz que está tudo guardado — com um card sem mapa: ${A.linha()}`);
  // E o gatilho seguinte de A prepara a fila DELA (a varredura confere o cache).
  A.navigator.onLine = true;
  assert.equal(A.precisaVarrer(), true, 'DEFEITO: o próximo gatilho de A não prepara a fila dela — a linha ficaria em "Ainda não preparado" sem nada preparando');
  const antes = A.preparacoes();
  await gatilhoAteOFim(A);
  assert.equal(A.preparacoes() - antes, 1, 'o gatilho de A não preparou');
  assert.ok(A.baixados.includes(PEDIDO_PULADO), 'A não baixou de novo o mapa do pedido que a poda de B levou');
  assert.equal(ap.cache.has(PEDIDO_PULADO), true);
  assert.match(A.linha(), PRONTO);
});

test('R15-4-01: CONTROLE — B decide o pedido pelo canal de pouso (A o tira da fila) ou nada muda: A segue "Pronto" e nenhum aviso de PARTE sai a mais', async () => {
  // (a) B pula e prepara, mas o pedido SAI da fila de A também (o pouso chegou): nada fora dos pedidos da base.
  const { ap, A, B } = await duasAbasProntas();
  const postsAntes = ap.posts();
  A.AppState.queue = A.AppState.queue.filter((p) => p.venueID !== 'v2');
  await bPulaEPrepara(ap, B);
  assert.equal(ap.posts() - postsAntes, 1, 'CONTROLE: a gravação de PARTE não avisou a outra aba (o aviso é o conserto)');
  assert.match(A.naTela(), PRONTO, `CONTROLE: A perdeu o "Pronto" sem ter pedido fora da base: ${A.naTela()}`);
  assert.ok(!A.diario.includes('offline.outraAbaParte'));
  // (b) a MESMA fila (sem parte) regravada por B: nada é avisado.
  const m = await duasAbasProntas();
  const posts = m.ap.posts();
  assert.equal(await m.B.gravarFila(), true);
  await entregue();
  assert.equal(m.ap.posts() - posts, 0, 'CONTROLE: a MESMA fila regravada avisou as outras abas');
  assert.match(m.A.naTela(), PRONTO);
});

test('R15-4-01: o aviso de uma versão anterior (sem os pedidos) e o do MESMO carimbo sem `chaves` seguem sem efeito', async () => {
  const { ap, A } = await duasAbasProntas();
  const t = ap.base.guardado.get('fila').t;
  const postsAntes = A.diario.length;
  // Chamado como o canal o entrega: o mesmo carimbo, sem `chaves`.
  const aviso = { v: 1, filaGuardada: t };
  assert.ok(A.estado().preparada === t, 'PRÉ-CONDIÇÃO: A está coberta');
  A.receber(aviso);
  assert.equal(A.estado().preparada, t, 'DEFEITO: o aviso sem `chaves` tirou a cobertura de A');
  assert.equal(A.diario.length, postsAntes, 'o aviso sem `chaves` mexeu no diário');
  // `chaves` que não é lista não conta como parte.
  A.receber({ v: 1, filaGuardada: t, chaves: 'v1|u1' });
  assert.equal(A.estado().preparada, t, 'o campo `chaves` malformado tirou a cobertura de A');
});

test('R15-4-01: o pedido que A deu por decidido pela outra aba (o card ainda aqui) não conta como "a mais"', async () => {
  const { ap, A, B } = await duasAbasProntas();
  const alvo = A.AppState.queue.find((p) => p.venueID === 'v2');
  A.decididoPorOutraAba(alvo);
  await bPulaEPrepara(ap, B);
  assert.match(A.naTela(), PRONTO, 'DEFEITO: o pedido que a outra aba decidiu (o aviso de pouso) tirou a cobertura de A');
});

// ═══ R15-4-02 · a ÉPOCA depois do `await`: o tile e a janela ═════════════════════
// O "Sair" de OUTRA aba apaga o cache do mapa e a base; a escrita que já estava a
// caminho (a ordem forçada do e7) os recria. Mesmo cenário da gravação da fila
// (R14-4-04), nos irmãos que ele não cobriu.
function tileDeMentira({ aoAbrir = null, aoGravar = null, ficaVazio = true } = {}) {
  const guardado = new Map();
  const estado = { existe: false, apagado: 0, puts: 0 };
  const cacheObj = {
    put: async (u, r) => { estado.puts++; await tique(); if (aoGravar) aoGravar(); guardado.set(u, r); },
    delete: async (u) => guardado.delete(u),
    keys: async () => [...guardado.keys()].map((url) => ({ url })),
  };
  const caches = {
    open: async () => { await tique(); estado.existe = true; if (aoAbrir) aoAbrir(); return cacheObj; },
    delete: async () => { estado.apagado++; const tinha = estado.existe; estado.existe = false; guardado.clear(); return tinha; },
  };
  const deps = {
    caches, OFFLINE_TILES_CACHE: 'waze-places-tiles', OFFLINE_ITEM_TETO_MS: 30000, AbortController,
    fetch: async () => ({ ok: true, status: 200 }),
    Image: class {}, setTimeout, clearTimeout, offlineGravandoTile: new Map(), offlineGeracaoDeTile: 0,
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, [
    'let offlineEpoca = 0;',
    fatiar('offlineDesfazerTile'), fatiar('offlineBaixar'),
    'return { baixar: offlineBaixar, esquecer: () => { offlineEpoca++; } };',
  ].join('\n'))(...chaves.map((k) => deps[k]));
  return { app, guardado, estado };
}

test('R15-4-02: o "Sair" de outra aba chega com o `caches.open` NO AR — o download não grava no cache recriado', async () => {
  let x;
  x = tileDeMentira({ aoAbrir: () => x.app.esquecer() });   // o aviso do "Sair" chega quando o cache abre
  const ok = await x.app.baixar('https://tile/17/1/2.png', true);
  assert.equal(ok, false, 'DEFEITO: o download deu certo com a época trocada no meio');
  assert.equal(x.guardado.size, 0, `DEFEITO: o tile de um pedido de terceiro foi gravado depois do "Sair": ${[...x.guardado.keys()]}`);
  assert.equal(x.estado.existe, false, 'DEFEITO: o cache que o `open` recriou VAZIO ficou no aparelho depois do "Sair"');
  // Nem por um instante: a página que morre entre gravar e apagar deixaria o tile no aparelho.
  assert.equal(x.estado.puts, 0, 'DEFEITO: o tile foi gravado (e só depois apagado) com a época já trocada');
});

test('R15-4-02: o "Sair" chega com o `put` NO AR — o tile gravado sai, e o cache que ficou vazio também', async () => {
  let x;
  x = tileDeMentira({ aoGravar: () => x.app.esquecer() });
  const ok = await x.app.baixar('https://tile/17/1/2.png', true);
  assert.equal(ok, false, 'DEFEITO: o download deu certo com a época trocada durante o `put`');
  assert.equal(x.guardado.size, 0, 'DEFEITO: o tile ficou no cache depois do "Sair"');
  assert.equal(x.estado.existe, false, 'DEFEITO: o cache recriado ficou no aparelho');
});

test('R15-4-02: CONTROLE — sem "Sair" no meio o tile fica; e um cache com tiles de um enchimento NOVO não é apagado junto', async () => {
  const ok = tileDeMentira();
  assert.equal(await ok.app.baixar('https://tile/17/1/2.png', true), true, 'CONTROLE: o download normal falhou');
  assert.deepEqual([...ok.guardado.keys()], ['https://tile/17/1/2.png']);
  assert.equal(ok.estado.existe, true);
  // A época trocou, mas o cache já tem tile de outro enchimento: só o desta gravação sai.
  let x;
  x = tileDeMentira({ aoGravar: () => x.app.esquecer() });
  x.guardado.set('https://tile/outro.png', true);
  await x.app.baixar('https://tile/17/1/2.png', true);
  assert.deepEqual([...x.guardado.keys()], ['https://tile/outro.png'], 'CONTROLE: o desfazer apagou o tile de outro enchimento');
  assert.equal(x.estado.apagado, 0, 'CONTROLE: o desfazer apagou o cache inteiro com tile de outro enchimento dentro');
});

// A janela: a `offlineGravarJanela` sobre a base de mentira (que serializa as transações).
function abaDaJanela(base) {
  const deps = { offlineDB: base.offlineDB, indexedDB: base.indexedDB, OFFLINE_STORE, OFFLINE_DB };
  const chaves = Object.keys(deps);
  return new Function(...chaves, [
    'let offlineEpoca = 0;',
    fatiar('offlineGravarJanela'),
    'return { gravar: offlineGravarJanela, esquecer: () => { offlineEpoca++; } };',
  ].join('\n'))(...chaves.map((k) => deps[k]));
}

test('R15-4-02: o "Sair" de outra aba chega com a base ABRINDO — a janela não recria a base', async () => {
  const base = baseIDB();
  const A = abaDaJanela(base);
  const gravando = A.gravar(999, 123);
  A.esquecer();                                         // o aviso chega enquanto a base abre
  await gravando;
  await tique(5);
  assert.equal(base.guardado.has('janela'), false, 'DEFEITO: a janela foi gravada depois do "Sair" da outra aba');
  assert.equal(base.ganchos.existe, false, 'DEFEITO: a base que a abertura recriou ficou no aparelho');
  assert.equal(base.ganchos.gravacoes, 0, 'DEFEITO: a janela foi gravada (e só depois apagada)');
});

test('R15-4-02: o "Sair" chega com a transação NO AR — a janela gravada sai da base', async () => {
  const base = baseIDB();
  const A = abaDaJanela(base);
  base.ganchos.aoGravar = (k) => { if (k === 'janela') A.esquecer(); };
  await A.gravar(999, 123);
  await tique(5);
  assert.equal(base.guardado.has('janela'), false, 'DEFEITO: a janela gravada com a transação no ar ficou depois do "Sair"');
  assert.equal(base.ganchos.existe, false, 'DEFEITO: a base recriada ficou no aparelho');
});

test('R15-4-02: CONTROLE — sem "Sair" no meio a janela é gravada com a fila que cobriu, e a regra do registro que cobre a fila guardada segue', async () => {
  const base = baseIDB();
  const A = abaDaJanela(base);
  await A.gravar(999, 123);
  await tique(5);
  assert.deepEqual(base.guardado.get('janela') && { janela: base.guardado.get('janela').janela, filaCoberta: base.guardado.get('janela').filaCoberta },
    { janela: 999, filaCoberta: 123 }, 'CONTROLE: a janela não foi gravada');
  assert.equal(base.ganchos.existe, true);
  // A fila guardada agora é outra (124) e o registro que está lá cobre a de agora: fica (o R14-4-01).
  base.guardado.set('filaChaves', { t: 555, chaves: ['v1|u1'] });
  base.guardado.set('janela', { janela: 1000, t: 1, filaCoberta: 555 });
  await A.gravar(1001, 123);
  await tique(5);
  assert.equal(base.guardado.get('janela').janela, 1000, 'CONTROLE: a preparação de uma fila que não é a guardada apagou o registro que cobre a de agora');
});

// ═══ R15-4-03 · a idade da fila guardada ═════════════════════════════════════
test('R15-4-03: a fila guardada leva a HORA da gravação à parte do carimbo, e o relatório mede a idade por ela', async () => {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba(MESMA());
  await A.abrir();
  const f1 = ap.base.guardado.get('fila');
  assert.ok(Number.isFinite(f1.gravadoEm), 'DEFEITO: a fila guardada não leva a hora da gravação');
  // A MESMA fila regravada mantém o carimbo, e a hora da gravação ANDA.
  ap.relogio.agora += 600000;
  assert.equal(await A.gravarFila(), true);
  const f2 = ap.base.guardado.get('fila');
  assert.equal(f2.t, f1.t, 'PRÉ-CONDIÇÃO: a mesma fila perdeu o carimbo');
  assert.ok(f2.gravadoEm > f1.gravadoEm, 'DEFEITO: a regravação da mesma fila não renovou a hora da gravação — o relatório medirá a do carimbo');
  assert.ok(f2.gravadoEm - f2.t >= 600000, 'PRÉ-CONDIÇÃO: o carimbo e a gravação não se separaram');
});

const JANELA_AGORA = 1492385;
async function diagDaFilaGuardada(fila) {
  const deps = {
    window: {}, OFFLINE_TILES_CACHE: 'waze-places-tiles', diagTilesGuardadosQueFalharam: [],
    diagOfflineAgora: () => ({ ligado: true, resultado: 'pronto', cobreAFila: true }),
    offlineLerFila: async () => fila,
    filaReal: () => fila.places, chaveDoPedido: chave,
    offlineLerPousos: () => [], offlineLerRegistroDaJanela: async () => ({ janela: JANELA_AGORA, t: 1500, filaCoberta: fila.t }),
  };
  const chaves = Object.keys(deps);
  const diagOffline = new Function(...chaves, fatiar('diagOffline') + '\nreturn diagOffline;')(...chaves.map((k) => deps[k]));
  return (await diagOffline()).filaGuardada;
}
const MIN_ATRAS = (m) => Date.now() - m * 60000;

test('R15-4-03: o relatório mede `idadeMin` pela ÚLTIMA GRAVAÇÃO e traz o carimbo à parte (`carimboMin`)', async () => {
  // A mesma fila regravada há 2 min, com o carimbo de há 3 horas.
  const g = await diagDaFilaGuardada({ t: MIN_ATRAS(180), gravadoEm: MIN_ATRAS(2), desde: MIN_ATRAS(2), places: [P(1)] });
  assert.equal(g.idadeMin, 2, `DEFEITO: a idade do relatório é a do carimbo (${g.idadeMin} min), não a da última gravação`);
  assert.equal(g.carimboMin, 180, 'o relatório perdeu a idade do carimbo');
  // A base de versão anterior não tem `gravadoEm`: as duas coincidem.
  const velha = await diagDaFilaGuardada({ t: MIN_ATRAS(30), desde: MIN_ATRAS(30), places: [P(1)] });
  assert.deepEqual([velha.idadeMin, velha.carimboMin], [30, 30], 'CONTROLE: a fila sem `gravadoEm` não cai no carimbo');
});

test('R15-4-03: a reabertura sem rede também conta a idade pela última gravação', () => {
  const corpo = fatiar('offlineTentarAbrirSemRede');
  const usos = corpo.match(/idade: Math\.round\(\(Date\.now\(\) - \(Number\.isFinite\(guardada\.gravadoEm\) \? guardada\.gravadoEm : guardada\.t\)\) \/ 60000\)/g) || [];
  assert.equal(usos.length, 2, 'o `offline.abriu` (com e sem pedido) deixou de medir a idade pela última gravação');
});

function triagem(offline) {
  const rel = { _versaoDoDiag: 11, _gerado: '2026-10-12T23:00:00.000Z', app: { versao: '2026101205', rotulo: '2026.10.12-05' },
    ambiente: { ua: 'x', online: true, tela: { w: 390, h: 844, dpr: 3, janela: '390x844' } },
    resumo: { momentos: 0, chamadas: 0, falhas: 0, errosDeJs: 0, rede: true, offline: 'pronto',
      telaAgora: { tela: 'app', painel: 'card', cardMontado: true, modais: [], lightbox: false }, alertas: [] },
    offline, diario: [], chamadas: [], momentos: [], erros: [], localStorage: {} };
  const dir = mkdtempSync(join(tmpdir(), 'diag-r15-'));
  const arq = join(dir, 'd.json');
  writeFileSync(arq, JSON.stringify(rel));
  const saida = execFileSync(process.execPath, [new URL('../tools/diag-resumo.mjs', import.meta.url).pathname, arq],
    { encoding: 'utf8', timeout: 20000 });
  const i = saida.indexOf('── OFFLINE');
  return saida.slice(i, saida.indexOf('\n──', i + 5));
}
const OFFLINE_COBRE = () => ({ ligado: true, janelaServida: JANELA_AGORA, janelaAtual: JANELA_AGORA, resultado: 'pronto',
  varrendo: false, filaGravadaEm: 2000, filaPreparada: 2000, filaVarrida: 2000, cobreAFila: true, precisaVarrer: false,
  filaGuardada: { n: 5, idadeMin: 1, carimboMin: 1, desdeMin: 1, t: 2000, soNestaAba: 0, soNaGuardada: 0 }, filaCobertaGuardada: 2000,
  janelaGuardada: JANELA_AGORA, tilesNoCache: 5, tilesGuardadosQueFalharam: 0, pousosGravados: 0 });

test('R15-4-01: a triagem alerta quando a preparação "cobre" a fila guardada e a aba tem pedidos que a fila não tem', () => {
  const comPedidoAMais = OFFLINE_COBRE();
  comPedidoAMais.filaGuardada = { ...comPedidoAMais.filaGuardada, soNestaAba: 1, soNaGuardada: 0 };
  const s = triagem(comPedidoAMais);
  assert.match(s, /cobre a fila guardada: sim/, 'PRÉ-CONDIÇÃO');
  assert.match(s, /ATENÇÃO: a preparação "cobre" a fila guardada, mas esta aba tem 1 pedido\(s\) que a fila guardada não tem/,
    `DEFEITO: o relatório diz "cobre: sim" com um pedido sem mapa e nenhum alerta:\n${s}`);
  // CONTROLE: os mesmos pedidos — nenhum alerta; e a fila guardada com pedidos a mais que esta aba não tem não é o caso.
  assert.ok(!/ATENÇÃO/.test(triagem(OFFLINE_COBRE())), 'CONTROLE: a fila coberta com os mesmos pedidos ganhou ATENÇÃO');
  const soNaGuardada = OFFLINE_COBRE();
  soNaGuardada.filaGuardada = { ...soNaGuardada.filaGuardada, soNestaAba: 0, soNaGuardada: 3 };
  assert.ok(!/ATENÇÃO/.test(triagem(soNaGuardada)), 'CONTROLE: pedido só na fila guardada (decidido aqui) virou ATENÇÃO');
});

test('R15-4-03: a triagem explica a diferença entre `idadeMin` e `carimboMin`, e o relatório do lote 18 (sem o campo) leva a nota', () => {
  const g = OFFLINE_COBRE();
  g.filaGuardada = { ...g.filaGuardada, idadeMin: 2, carimboMin: 180 };
  assert.match(triagem(g), /a fila foi gravada pela última vez há 2 min, mas o carimbo dela tem 180 min/,
    'a triagem não explica por que a idade e o carimbo se separam');
  assert.ok(!/gravada pela última vez/.test(triagem(OFFLINE_COBRE())), 'CONTROLE: idade igual ao carimbo ganhou a nota');
  const lote18 = OFFLINE_COBRE();
  delete lote18.filaGuardada.carimboMin;
  assert.match(triagem(lote18), /antes do campo `carimboMin`/, 'o relatório do lote 18 (só `idadeMin`, do carimbo) não leva a nota');
  const anterior = OFFLINE_COBRE();
  delete anterior.filaGuardada.carimboMin; delete anterior.filaGuardada.t;
  assert.ok(!/antes do campo/.test(triagem(anterior)), 'CONTROLE: o relatório sem o carimbo `t` (versão ainda mais velha) ganhou a nota');
});

// ═══ R15-4-04 · só a falha do desenho VIGENTE conta ══════════════════════════
class ElFalso {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.className = ''; this._t = ''; this.dataset = {}; }
  appendChild(c) { this.children.push(c); return c; }
  remove() { this.removido = true; }
  set textContent(v) { this._t = v; this.children = []; }
  get textContent() { return this._t; }
}
function mapaDesenhavel() {
  const partes = { '.card-map-tiles': new ElFalso('div'), '.card-map-marks': new ElFalso('div'),
    '.card-map-scale': new ElFalso('span'), '.card-map-legend': new ElFalso('span') };
  const box = Object.assign(new ElFalso('div'), { clientWidth: 359, clientHeight: 200,
    classList: { contains: () => false }, querySelector: (s) => partes[s] });
  const card = { querySelector: (s) => (s === '.card-map' ? box : null) };
  const falhas = [];
  const M = createRequire(import.meta.url)(new URL('../js/mapa.js', import.meta.url).pathname);
  const deps = {
    document: { createElement: (tag) => new ElFalso(tag), createTextNode: (x) => ({ textContent: x }) },
    window: { mapaMontar: M.mapaMontar, mapaEscala: M.mapaEscala }, mapaMontar: M.mapaMontar,
    mapaEscala: M.mapaEscala, ESCALA_ALVO_CARD_PX: 80,
    Image: class extends ElFalso { constructor() { super('img'); } },
    API: { getRegion: () => 'row' }, t: (k) => k, i18nLocale: () => 'pt-BR',
    vigiarCaixaDoMapa() {},
    // O `registrarFalhaDeTile` de verdade conta em `box.dataset.tilesFalharam`.
    registrarFalhaDeTile: (b, url) => { falhas.push(url); b.dataset.tilesFalharam = String((parseInt(b.dataset.tilesFalharam, 10) || 0) + 1); },
  };
  const nomes = ['pontosDoMapa', 'avisoForaDoMapa', 'formatarMetros', 'distanciaKm', 'escreverEscala', 'renderMapa'];
  const fatiarFn = (n) => {
    const m = new RegExp('^function ' + n + '\\(', 'm').exec(APP_SEM);
    assert.ok(m, `${n} sumiu do app.js`);
    return fatiar(n);
  };
  const renderMapa = new Function(...Object.keys(deps), nomes.map(fatiarFn).join('\n') + '\nreturn renderMapa;')(...Object.values(deps));
  const place = { mapa: { centro: [-22.0162, -47.5688], entradas: [] } };
  return { box, card, place, renderMapa, falhas, tiles: partes['.card-map-tiles'] };
}

test('R15-4-04: a falha do <img> do desenho de RESERVA, tirado do DOM, não cai na conta do desenho real', () => {
  const x = mapaDesenhavel();
  x.renderMapa(x.card, x.place, true);                        // o desenho de reserva (montarCard)
  const velhos = x.tiles.children.slice();
  assert.ok(velhos.length > 0, 'PRÉ-CONDIÇÃO: o mapa não desenhou tile');
  x.renderMapa(x.card, x.place, true);                        // o desenho real (desenharMapaComCaixa)
  const novos = x.tiles.children.slice();
  assert.equal(novos.length, velhos.length, 'PRÉ-CONDIÇÃO: os dois desenhos pedem o mesmo número de tiles');
  assert.equal(x.box.dataset.tilesFalharam, '0');
  // Sem rede: o <img> do desenho velho (fora do DOM) dispara o onerror DEPOIS.
  for (const im of velhos) im.onerror();
  assert.equal(x.box.dataset.tilesFalharam, '0',
    `DEFEITO: a falha do desenho velho entrou na conta do real (falharam ${x.box.dataset.tilesFalharam} para ${x.box.dataset.tilesPedidos} pedidos)`);
  assert.deepEqual(x.falhas, [], 'a falha do desenho velho foi para o anel de "tile guardado que falhou"');
  assert.ok(velhos.every((im) => im.removido), 'o tile velho que falhou deveria sair do DOM do mesmo jeito');
  // CONTROLE: a falha do desenho VIGENTE conta, uma por tile, e nunca passa de `pedidos`.
  for (const im of novos) im.onerror();
  assert.equal(Number(x.box.dataset.tilesFalharam), novos.length, 'CONTROLE: a falha do desenho vigente não foi contada');
  assert.ok(Number(x.box.dataset.tilesFalharam) <= Number(x.box.dataset.tilesPedidos), 'falharam passou de pedidos');
});

// ═══ os testes fatiam o FONTE; o app carrega o `js/min/` (gotcha #22) ═════════
test('o bundle GERADO tem os consertos (senão nada disso está no ar)', () => {
  const contar = (s2, re) => (s2.match(re) || []).length;
  for (const nome of ['aoManterOCarimboComPartes', 'offlineDesfazerTile', '_desenhoDoMapa', 'carimboMin', 'outraAbaParte']) {
    const re = new RegExp('\\b' + nome + '\\b', 'g');
    assert.ok(contar(APP_SEM, re) > 0, `PRÉ-CONDIÇÃO: ${nome} sumiu do fonte`);
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${nome} — falta \`npm run js\``);
  }
});
