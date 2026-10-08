// Rodada 14 da auditoria (2026-10-07), a parte do OFFLINE e do DIAGNÓSTICO — o
// lote 18. Todos MEDIDOS no navegador pelos roteiros da rodada 14 (r14-4):
//
//  · R14-4-01 — duas abas com a MESMA fila: a segunda gravava os mesmos pedidos
//    com carimbo novo e avisava a primeira, que passava a dizer "Ainda não
//    preparado" (sem rede: "O mapa e as fotos chegam quando houver sinal") com
//    tudo no aparelho; e cada preparação de uma derrubava a cobertura da outra,
//    sem fim (4 gatilhos alternados, 4 preparações da fila inteira);
//  · R14-4-02 — o pedido que a OUTRA aba decidiu, com o aviso dele ESPERANDO a
//    conta desta aba, ia pra fila guardada e a poda apagava a prova do pouso:
//    reaberto sem rede, ele voltava como card;
//  · R14-4-04 — a gravação da fila guardada não conferia a ÉPOCA do offline
//    depois de abrir a base: o "Sair" de OUTRA aba apaga a base, e a gravação
//    que já estava a caminho (a resposta de uma busca chegou antes do aviso) a
//    abria de novo — abrir CRIA a base — e gravava nela os pedidos de terceiros,
//    com a aba já sem sessão.
//
// Os testes RODAM o código de verdade, fatiado do app.js, sobre uma base do
// IndexedDB de mentira que se comporta como a de verdade no que importa aqui: a
// abertura leva uma tarefa, a transação só fecha depois de TODOS os pedidos dela
// (inclusive os feitos no `onsuccess` de outro), e apagar a base apaga tudo.
// Cada teste tem o CONTROLE que dá o resultado oposto, e foi visto REPROVANDO
// com o conserto desfeito (sabotagem no relatório do lote 18).
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

// ── UMA aba: a gravação e o esquecer DE VERDADE ──────────────────────────────
// `sessao`: o token na MEMÓRIA desta aba (o `marcaDestaAba` de verdade lê o
// `API.sessionToken`). `canal`: o que esta aba avisou às outras.
const NOMES = ['chaveDoPedido', 'filaReal', 'marcaDaSessao', 'marcaDestaAba', 'offlineGravarFila', 'offlineEsquecer'];
function aba({ base, fila = [], sessao = 'tok-a' } = {}) {
  const diario = [];
  const avisos = [];
  const podas = [];
  const API = { sessionToken: sessao, soltarSessao() { this.sessionToken = null; } };
  const AppState = { authenticated: !!sessao, queue: fila.slice(), currentPlace: fila[0] || null, filters: { countryId: 30 },
    preferences: { offlineDisponivel: true } };
  const deps = {
    AppState, API, Treino: { ativo: false, _salvo: null, esquecerFilaGuardada() {} },
    window: {}, safeLS: { remove() {} },
    OFFLINE_STORE, OFFLINE_DB, OFFLINE_POUSOS_KEY, OFFLINE_TILES_CACHE: 'waze-places-tiles',
    offlineDB: base.offlineDB, indexedDB: base.indexedDB,
    offlineLigado: () => AppState.preferences.offlineDisponivel === true,
    contaAgora: () => (API.sessionToken ? '4242' : null),
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }),
    avisarOutrasAbasDaFilaGuardada: (t) => avisos.push(t),
    offlinePodarPousos: (desde) => podas.push(desde),
    offlineAnunciarTiles: () => {}, dfato: (k, o) => diario.push([k, o || {}]),
  };
  const chaves = Object.keys(deps);
  const fonte = [
    'let filaDeOnde = null, offlineFilaGravadaEm = null, offlineFilaGravadaChaves = null, offlineFilaPreparada = null,',
    '    offlineFilaVarrida = null, offlineJanelaServida = null, offlineUltimoResultado = null, offlineEpoca = 0,',
    '    diagTilesGuardadosQueFalharam = [], offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set(), guardados: new Set() };',
    'const decididosPorOutraAbaComCardAqui = new WeakSet(), pedidosEmAndamento = new Set(), pedidosQuePousaram = new WeakSet();',
    ...NOMES.map(fatiar),
    `return { ${NOMES.join(', ')}, estado: () => ({ gravada: offlineFilaGravadaEm, epoca: offlineEpoca }) };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  // O aviso do "Sair" de OUTRA aba, como o `handleLogout({ porOutraAba })` o
  // aplica aqui: a memória do offline sai (a base, a outra já apagou) e a sessão
  // é solta.
  const sairDeOutraAba = () => { app.offlineEsquecer({ soMemoria: true }); API.soltarSessao(); AppState.authenticated = false; };
  return { app, AppState, API, diario, avisos, podas, sairDeOutraAba };
}

// ═══ R14-4-04 · a gravação depois do "Sair" de outra aba ═════════════════════
// O roteiro e7 do auditor, com a ordem da corrida FORÇADA: a outra aba deu
// "Sair" (apagou a base), esta começou a gravar (a resposta de uma busca chegou)
// ANTES de o aviso do "Sair" chegar aqui, e o aviso chega com a gravação no ar.
async function gravacaoComOSairNoMeio({ quando }) {
  const base = baseIDB();
  base.guardado.set('fila', { t: 1, places: [P(9)] });   // a fila guardada de antes do "Sair"
  base.ganchos.existe = true;
  const A = aba({ base, fila: [P(1), P(2), P(3)] });
  base.indexedDB.deleteDatabase();                        // o "Sair" da outra aba apagou a base
  if (quando === 'antes') A.sairDeOutraAba();             // CONTROLE: o aviso chegou antes
  if (quando === 'naTransacao') {
    // O aviso chega com a transação NO AR: o `put` já gravou, e ela ainda não fechou.
    base.ganchos.aoGravar = (k) => { if (k === 'fila') A.sairDeOutraAba(); };
  }
  const gravacao = A.app.offlineGravarFila();
  if (quando === 'naAbertura') A.sairDeOutraAba();        // o aviso chega enquanto a base abre
  const gravou = await gravacao;
  await tique(5);
  return { gravou, A, base };
}

test('R14-4-04: o "Sair" de outra aba chega com a base ABRINDO — a gravação não recria a base com os pedidos de terceiros', async () => {
  const r = await gravacaoComOSairNoMeio({ quando: 'naAbertura' });
  assert.equal(r.gravou, false, 'DEFEITO: a gravação seguiu depois do "Sair" da outra aba');
  assert.equal(r.base.guardado.has('fila'), false,
    `DEFEITO: a base apagada pelo "Sair" voltou com a fila guardada: ${JSON.stringify([...r.base.guardado.keys()])}`);
  // Nem por um instante: a página que morre entre gravar e apagar deixaria a fila no aparelho.
  assert.equal(r.base.ganchos.gravacoes, 0, 'DEFEITO: a fila foi gravada (e só depois apagada) com a época já trocada');
  assert.equal(r.base.ganchos.existe, false, 'DEFEITO: a base que a abertura recriou VAZIA ficou no aparelho depois do "Sair"');
  assert.deepEqual(r.A.avisos, [], 'a gravação desfeita avisou as outras abas de uma fila que não existe');
  assert.deepEqual(r.A.podas, [], 'a gravação desfeita podou os pousos');
  assert.equal(r.A.app.estado().gravada, null, 'a memória da aba ficou com o carimbo de uma fila que não existe');
});

test('R14-4-04: o "Sair" de outra aba chega com a transação NO AR — o que ela gravou sai da base', async () => {
  const r = await gravacaoComOSairNoMeio({ quando: 'naTransacao' });
  assert.equal(r.gravou, false, 'DEFEITO: a gravação devolveu "gravou" com a época trocada no meio');
  assert.equal(r.base.guardado.has('fila'), false,
    'DEFEITO: a fila gravada com a transação no ar ficou na base depois do "Sair" da outra aba');
  assert.equal(r.base.ganchos.existe, false, 'DEFEITO: a base recriada pela gravação ficou no aparelho');
  assert.deepEqual(r.A.avisos, [], 'a gravação desfeita avisou as outras abas');
  assert.equal(r.A.app.estado().gravada, null, 'a memória da aba ficou com o carimbo de uma fila que não existe');
});

test('R14-4-04: CONTROLE — sem "Sair" no meio, grava; e com o aviso ANTES (a sessão solta), não grava nem abre a base', async () => {
  const ok = await gravacaoComOSairNoMeio({ quando: 'nunca' });
  assert.equal(ok.gravou, true, 'CONTROLE: sem o "Sair" no meio a fila não foi gravada');
  assert.deepEqual(ok.base.guardado.get('fila').places.map(chave), ['v1|u1', 'v2|u2', 'v3|u3']);
  assert.equal(ok.A.avisos.length, 1, 'CONTROLE: a gravação não avisou as outras abas');
  // A única vez em que a base foi apagada é a do "Sair" de mentira, antes de tudo.
  assert.equal(ok.base.ganchos.apagamentos, 1, 'a gravação sem "Sair" no meio apagou a base');
  assert.equal(ok.base.ganchos.existe, true);
  const antes = await gravacaoComOSairNoMeio({ quando: 'antes' });
  assert.equal(antes.gravou, false);
  assert.equal(antes.base.ganchos.aberturas, 0, 'sem sessão a gravação nem abre a base (R13-4-04)');
  assert.equal(antes.base.guardado.size, 0);
});

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

const NOMES_ABA = ['filaReal', 'chaveDoPedido', 'marcaDaSessao', 'marcaDestaAba', 'offlineGravarFila', 'offlineLerFila',
  'offlineGravarJanela', 'offlineLerRegistroDaJanela', 'offlineRecuperarJanela', 'offlinePodarTiles', 'offlineVarrer',
  'offlinePrecisaVarrer', 'offlineTalvezVarrer', 'offlineMarcarGesto', 'filaGuardadaEsperandoOTreino',
  'atualizarLinhaDoOffline', 'abrirCanalDoOffline', 'avisarOutrasAbasDaFilaGuardada', 'aoGravarFilaGuardadaEmOutraAba'];
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
      `return { gravarFila: offlineGravarFila, varrer: offlineVarrer, recuperarJanela: offlineRecuperarJanela,
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

test('R14-4-01: a segunda aba com a MESMA fila mantém o carimbo da fila coberta — a primeira segue "Pronto", com rede e sem', async () => {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba(MESMA());
  await A.abrir();
  await entregue();
  assert.equal(A.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a preparação de A não ficou pronta');
  assert.match(A.linha(), PRONTO, 'PRÉ-CONDIÇÃO: A preparada não diz "Pronto"');
  const tA = ap.base.guardado.get('fila').t;
  const postsAntes = ap.posts();
  // B abre com a MESMA fila (o mesmo filtro, os mesmos pedidos): grava e prepara.
  const B = ap.aba(MESMA(), { sessao: 'tok-b' });
  await B.abrir();
  await entregue();
  assert.equal(B.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a preparação de B não ficou pronta');
  assert.equal(ap.base.guardado.get('fila').t, tA,
    'DEFEITO: a segunda aba gravou os MESMOS pedidos com carimbo NOVO — a primeira perde a cobertura do que preparou');
  assert.equal(ap.posts() - postsAntes, 0, 'DEFEITO: a gravação da MESMA fila avisou as outras abas de "outra fila"');
  assert.ok(!A.diario.includes('offline.outraAba'), 'DEFEITO: A recebeu o aviso de "outra fila" — era a mesma');
  // As Preferências abertas em A: a linha não muda sozinha pra "Ainda não preparado".
  assert.match(A.naTela(), PRONTO,
    `DEFEITO: com tudo no aparelho, a linha de A passou a dizer "Ainda não preparado": ${A.naTela()}`);
  assert.match(A.linha(), PRONTO);
  assert.match(B.linha(), PRONTO);
  assert.equal(A.precisaVarrer(), false, 'DEFEITO: o próximo gatilho de A prepararia de novo a fila que ela já preparou');
  // Sem rede, a linha diz o que está no aparelho.
  A.navigator.onLine = false;
  const semRede = A.linha();
  assert.match(semRede, /prefs\.offline\.prontoSemRedeB/,
    `DEFEITO: sem rede, a linha de A diz que o mapa e as fotos ainda vão chegar — com os dois no aparelho: ${semRede}`);
});

test('R14-4-01: os gatilhos ALTERNADOS das duas abas com a mesma fila não preparam de novo (era uma preparação por gatilho, sem fim)', async () => {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba(MESMA());
  await A.abrir();
  const B = ap.aba(MESMA(), { sessao: 'tok-b' });
  await B.abrir();
  await entregue();
  assert.deepEqual([A.estado().resultado, B.estado().resultado], ['pronto', 'pronto'], 'PRÉ-CONDIÇÃO');
  const antes = A.preparacoes() + B.preparacoes();
  const gravacoesAntes = ap.base.ganchos.gravacoes;
  for (let i = 0; i < 4; i++) await gatilhoAteOFim(i % 2 === 0 ? A : B);
  const preparou = A.preparacoes() + B.preparacoes() - antes;
  assert.equal(preparou, 0, `DEFEITO: 4 gatilhos alternados prepararam a fila ${preparou} vezes — cada uma grava a fila inteira`);
  assert.equal(ap.base.ganchos.gravacoes, gravacoesAntes, 'os gatilhos alternados gravaram na base');
  assert.match(A.linha(), PRONTO);
  assert.match(B.linha(), PRONTO);
});

test('R14-4-01: CONTROLE — com filas DIFERENTES a fila guardada é a de quem gravou por último: a outra diz "Ainda não preparado" e o gatilho dela prepara (o R13-4-03)', async () => {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba([...MESMA(), P(40), P(41)]);
  await A.abrir();
  const B = ap.aba([...MESMA(), P(30), P(31)], { sessao: 'tok-b' });
  await B.abrir();
  await entregue();
  assert.ok(A.diario.includes('offline.outraAba'), 'CONTROLE: a fila de OUTROS pedidos não avisou a primeira aba');
  assert.match(A.naTela(), PENDENTE, 'CONTROLE: A diz "Pronto" sobre a fila guardada de B (o R13-4-03 voltou)');
  assert.equal(ap.cache.has('tile-v40'), false, 'PRÉ-CONDIÇÃO: a poda de B não levou o mapa dos pedidos que só A tem');
  const antes = A.preparacoes();
  await gatilhoAteOFim(A);
  assert.equal(A.preparacoes() - antes, 1, 'CONTROLE: o gatilho de A não preparou a fila dela');
  assert.deepEqual(A.baixados.filter((u) => /v4[01]$/.test(u)).sort(), ['tile-v40', 'tile-v40', 'tile-v41', 'tile-v41'],
    'CONTROLE: A não baixou DE NOVO o mapa que a poda de B levou (o custo de uma fila guardada por aparelho)');
  assert.match(A.linha(), PRONTO);
  assert.match(B.naTela(), PENDENTE, 'CONTROLE: B diz "Pronto" com a fila guardada sendo a de A');
});

// As duas abas preparando JUNTAS (o `online` chega às duas): nenhuma está coberta
// quando a outra grava, então a segunda grava com carimbo novo e avisa. Quem
// termina primeiro grava no registro da janela qual fila cobriu — e é por ele
// (não pela memória de cada aba) que a gravação seguinte da outra, com os
// mesmos pedidos, reconhece a fila coberta: as duas convergem, em vez de cada
// preparação de uma descobrir a da outra pra sempre.
test('R14-4-01: as duas abas preparando JUNTAS a mesma fila convergem — uma preparação a mais (sem baixar nada) e os gatilhos param', async () => {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba(MESMA());
  A.rede.segura = true;
  const preparoDeA = A.abrir();                      // A prepara, com os downloads presos
  await ateQue(() => A.rede.presos.length > 0, 'PRÉ-CONDIÇÃO: a preparação de A não chegou aos downloads');
  assert.equal(A.estado().varrendo, true, 'PRÉ-CONDIÇÃO: a preparação de A não está no ar');
  const B = ap.aba(MESMA(), { sessao: 'tok-b' });
  await B.abrir();                                   // B prepara inteira enquanto a de A segue no ar
  await entregue();
  assert.equal(B.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a preparação de B não ficou pronta');
  A.soltar();
  await preparoDeA;
  await entregue();
  assert.equal(A.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a preparação de A não ficou pronta');
  // A preparação de A cobriu o carimbo de ANTES de B gravar: o próximo gatilho
  // dela confere, sem baixar nada — e reconhece pela base a fila que B cobriu.
  const baixadosA = A.baixados.length;
  await gatilhoAteOFim(A);
  assert.equal(A.baixados.length, baixadosA, 'a preparação a mais de A baixou de novo o que está no aparelho');
  assert.match(A.linha(), PRONTO);
  assert.match(B.naTela(), PRONTO,
    `DEFEITO: a preparação a mais de A (a mesma fila) fez B dizer "Ainda não preparado": ${B.naTela()}`);
  const antes = A.preparacoes() + B.preparacoes();
  for (let i = 0; i < 4; i++) await gatilhoAteOFim(i % 2 === 0 ? B : A);
  const preparou = A.preparacoes() + B.preparacoes() - antes;
  assert.equal(preparou, 0, `DEFEITO: as duas abas não convergem — 4 gatilhos alternados prepararam ${preparou} vezes`);
});

// A fila guardada mantém o carimbo com PARTE dos pedidos só se é a que ESTA aba
// gravou por último. Parte da fila de OUTRA aba com o carimbo dela tirava da base
// os pedidos que só a outra tem — e a poda daqui, o mapa deles —, com a outra
// dizendo "Pronto": a classe do R13-4-03 de volta.
test('R14-4-01: PARTE da fila de OUTRA aba não mantém o carimbo dela — a aba que tem pedidos a mais deixa de dizer "Pronto"', async () => {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba(MESMA());
  await A.abrir();
  const B = ap.aba(MESMA(), { sessao: 'tok-b' });
  await B.abrir();
  await entregue();
  // A busca de A traz um pedido NOVO: carimbo novo, e A o prepara.
  await A.buscar([P(7)]);
  await entregue();
  assert.equal(A.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a preparação de A com o pedido novo não ficou pronta');
  assert.match(A.linha(), PRONTO, 'PRÉ-CONDIÇÃO');
  assert.ok(B.diario.includes('offline.outraAba'), 'PRÉ-CONDIÇÃO: a fila com o pedido novo não avisou B');
  // B (sem o pedido novo) prepara a fila dela: os 6, PARTE dos 7 da fila guardada.
  await gatilhoAteOFim(B);
  assert.deepEqual(ap.base.guardado.get('fila').places.map(chave).sort(), MESMA().map(chave).sort(),
    'PRÉ-CONDIÇÃO: a fila guardada não é a de B');
  assert.notEqual(ap.base.guardado.get('fila').t, A.estado().preparada,
    'DEFEITO: a fila de B (sem o pedido de A) ficou com o carimbo que A preparou');
  assert.match(A.naTela(), PENDENTE,
    `DEFEITO: A diz "Pronto — 7" com a fila guardada sem o pedido dela (e o mapa dele fora do aparelho): ${A.naTela()}`);
  assert.equal(ap.cache.has('tile-v7'), false, 'PRÉ-CONDIÇÃO: a poda de B não levou o mapa do pedido que só A tem');
});

test('R14-4-01: CONTROLE — a aba sozinha: a mesma fila (ou parte dela) regravada mantém o carimbo; com pedido NOVO, não (o R6-4-2)', async () => {
  const ap = aparelhoDeDuasAbas();
  const A = ap.aba(MESMA());
  await A.abrir();
  const t = ap.base.guardado.get('fila').t;
  assert.equal(await A.gravarFila(), true);
  assert.equal(ap.base.guardado.get('fila').t, t, 'a MESMA fila regravada ganhou outro carimbo');
  A.AppState.queue.shift();                          // um pedido decidido sai
  assert.equal(await A.gravarFila(), true);
  assert.equal(ap.base.guardado.get('fila').t, t, 'a fila com um pedido A MENOS ganhou outro carimbo');
  assert.match(A.linha(), PRONTO);
  A.AppState.queue.push(P(9));                       // pedido NOVO: carimbo novo
  assert.equal(await A.gravarFila(), true);
  assert.notEqual(ap.base.guardado.get('fila').t, t, 'a fila com um pedido NOVO manteve o carimbo da coberta');
  assert.match(A.linha(), PENDENTE);
  // Os pedidos da fila guardada vão junto, com o MESMO carimbo, na mesma transação.
  const resumo = ap.base.guardado.get('filaChaves');
  assert.equal(resumo.t, ap.base.guardado.get('fila').t, 'os pedidos guardados não levam o carimbo da fila');
  assert.deepEqual(resumo.chaves, ap.base.guardado.get('fila').places.map(chave).sort());
});

// ═══ R14-4-02 · o aviso de pouso que ESPERA a conta × a fila guardada ═════════
// O roteiro e3 do auditor, com o aviso do canal dos pousos, a espera pela conta,
// a gravação, a poda dos pousos e a reabertura sem rede DE VERDADE — e o api.js
// INTEIRO, num contexto do `vm`, sobre o armazenamento (`Map`) que as abas
// dividem. A aba A tem a sessão `tok-a`, sem o perfil (a conta DESTA aba
// desconhecida); a B, outra sessão da MESMA conta, decide v3 por um caminho que
// só passa pelo canal (o pouso do "Marcar todos", da recusa automática, da
// aprovação de foto).
const CONTA_KEY = constante('CONTA_KEY');
const SAIDA_KEY = constante('SAIDA_KEY');
const OFFLINE_POUSOS_MAX = constante('OFFLINE_POUSOS_MAX');
const POUSO_NA_MEMORIA_MS = constante('POUSO_NA_MEMORIA_MS');
const DECL_AVISOS = [
  /^const pousosDaPagina = new Map\(\);$/m, /^const pedidosEmAndamento = new Set\(\);$/m,
  /^const pedidosQuePousaram = new WeakSet\(\);$/m, /^const decididosPorOutraAbaComCardAqui = new WeakSet\(\);$/m,
  /^const decididasPorOutraAba = new Map\(\);$/m, /^const DECIDIDAS_POR_OUTRA_ABA_MAX = \d+;$/m,
  /^const avisosDePousoSemConta = \[\];$/m, /^const AVISOS_DE_POUSO_SEM_CONTA_MAX = \d+;$/m,
].map((re) => { const m = re.exec(APP_SEM); assert.ok(m, `a declaração ${re} sumiu do app.js`); return m[0]; });

// O api.js de VERDADE, sobre um armazenamento (`Map`) que as abas DIVIDEM.
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

const NOMES_AVISO = ['chaveDoPedido', 'filaReal', 'filaRealComDevolvidos', 'marcaDaSessao', 'marcaDestaAba', 'contaAgora',
  'registrarPouso', 'carregarFilaDeSaida', 'offlineLerPousos', 'offlinePodarPousos', 'semOsJaDecididos', 'mesmoLugar',
  'offlineGravarFila', 'offlineLerFila', 'filaGuardadaDestaConta', 'offlineTentarAbrirSemRede',
  'anotarDecididosPorOutraAba', 'lembrarDecididasPorOutraAba', 'tirarDaFilaOQueAOutraAbaDecidiu', 'aoPousarEmOutraAba',
  'aoPousarSemSessaoNaMemoria', 'aplicarPousoDeOutraAba', 'guardarAvisoSemConta', 'aplicarAvisosQueEsperavamAConta',
  'chavesQueEsperamAConta'];
// `perfil`: o perfil desta aba (sem ele, a conta é a guardada no aparelho — se a
// marca for a desta sessão).
function abaDaConta({ aparelho, base, fila = [], sessao, perfil = null, onLine = true }) {
  const { API, safeLS } = apiSobre(aparelho);
  API.sessionToken = sessao;
  const diario = [];
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0] || null, filters: { countryId: 30 },
    profile: perfil, preferences: { offlineDisponivel: true }, pendingAction: null, fetchEpoch: 0, hasMore: false,
    loadError: true, serverTotal: fila.length };
  const deps = {
    AppState, API, safeLS, Treino: { ativo: false, _salvo: null }, navigator: { onLine },
    CONTA_KEY, SAIDA_KEY, OFFLINE_POUSOS_KEY, OFFLINE_POUSOS_MAX, OFFLINE_STORE, OFFLINE_DB, POUSO_NA_MEMORIA_MS,
    offlineLigado: () => AppState.preferences.offlineDisponivel === true,
    offlineDB: base.offlineDB, indexedDB: base.indexedDB, dfato: (k, o) => diario.push([k, o || {}]),
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), offlineRecuperarJanela: async () => {},
    pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {}, updatePendingCount: () => {},
    sortQueue: () => {}, showCurrentPlace: () => {}, aoMudarAFilaPorBaixo: () => {},
    guardaASessaoQueCaiu: () => true,
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, [
    'let filaDeOnde = null, offlineFilaGravadaEm = null, offlineFilaGravadaChaves = null, offlineFilaPreparada = null,',
    '    offlineJanelaServida = null, ultimaEscritaOkEm = 0, offlineEpoca = 0, contaConfirmadaNestaAba = null;',
    ...DECL_AVISOS,
    ...NOMES_AVISO.map(fatiar),
    `return { ${NOMES_AVISO.join(', ')}, esperando: () => avisosDePousoSemConta.length };`,
  ].join('\n'))(...chaves.map((k) => deps[k]));
  return { app, AppState, API, diario };
}
// O aparelho da conta 4242, com a sessão `tok-b` guardada e confirmada com ela
// (a da OUTRA aba, que entrou de novo): a marca não é a de `tok-a`, e a conta de
// A só se sabe pelo perfil (o R6-1-04).
function aparelhoDaOutraAba() {
  return new Map([['waze_session_token', 'tok-b'], [CONTA_KEY, JSON.stringify({ id: '4242', s: marcaDe('tok-b') })]]);
}
// Reaberto SEM rede: página NOVA, a mesma base e o mesmo aparelho.
async function reabrirSemRede(aparelho, base, sessao = 'tok-a') {
  const C = abaDaConta({ aparelho, base, sessao, onLine: false });
  await C.app.offlineTentarAbrirSemRede();
  return C.AppState.queue.map(chave);
}
async function relogioAndou(t = Date.now()) {
  const fim = performance.now() + 2000;
  while (Date.now() <= t) {
    if (performance.now() > fim) assert.fail('o relógio de parede não andou');
    await tique(1);
  }
}
// `caso`: 'reposicao' (a busca de A grava a fila, desde = o começo dela) ou
// 'varredura' (a preparação que a resposta do perfil dispara: desde = agora);
// `pouso`: B decide v3; `perfilAntes`: a conta de A já se sabe quando o aviso
// chega; `contaDoAviso`: a conta de quem decidiu.
async function avisoEsperandoAConta({ caso = 'reposicao', pouso = true, perfilAntes = false, contaDoAviso = '4242' } = {}) {
  const aparelho = aparelhoDaOutraAba();
  const base = baseIDB();
  const fila = [1, 2, 3, 4, 5, 6].map(P);
  const A = abaDaConta({ aparelho, base, fila, sessao: 'tok-a', perfil: perfilAntes ? { id: 4242 } : null });
  assert.equal(await A.app.offlineGravarFila(Date.now()), true, 'PRÉ-CONDIÇÃO: a fila de A não foi gravada');
  await relogioAndou();
  if (pouso) {
    // B decide v3: o pouso vai pro aparelho (o offline está ligado lá) e o aviso
    // chega a A pelo canal, com a conta e a marca da sessão de B.
    const B = abaDaConta({ aparelho, base, fila: [P(3)], sessao: 'tok-b', perfil: { id: 4242 } });
    B.app.registrarPouso([B.AppState.queue[0]]);
    A.app.aoPousarEmOutraAba({ v: 1, chaves: ['v3|u3'], conta: contaDoAviso, s: marcaDe('tok-b') });
  }
  const esperando = A.app.esperando();
  await relogioAndou();
  // A grava a fila COM o aviso esperando a conta.
  if (caso === 'reposicao') {
    const inicioDaBusca = Date.now();
    A.AppState.queue.push(P(7));
    assert.equal(await A.app.offlineGravarFila(inicioDaBusca), true, 'PRÉ-CONDIÇÃO: a reposição de A não gravou');
  } else {
    assert.equal(await A.app.offlineGravarFila(), true, 'PRÉ-CONDIÇÃO: a preparação de A não gravou');
  }
  const guardada = base.guardado.get('fila').places.map(chave);
  const pousos = A.app.offlineLerPousos().map((e) => e[0]);
  // O perfil de A chega: a conta se sabe, e os avisos que esperavam valem (ou não).
  if (!perfilAntes) {
    A.AppState.profile = { id: 4242 };
    A.app.aplicarAvisosQueEsperavamAConta('4242');
  }
  const naMemoria = A.AppState.queue.map(chave);
  // E a próxima gravação, com a conta já sabida.
  await relogioAndou();
  await A.app.offlineGravarFila();
  const depois = base.guardado.get('fila').places.map(chave);
  return { esperando, guardada, pousos, naMemoria, depois, reaberta: await reabrirSemRede(aparelho, base) };
}

test('R14-4-02: o pedido que a outra aba decidiu, com o aviso ESPERANDO a conta desta, não vai pra fila guardada — reaberto sem rede, não volta (a reposição)', async () => {
  const r = await avisoEsperandoAConta({ caso: 'reposicao' });
  assert.equal(r.esperando, 1, 'PRÉ-CONDIÇÃO: o aviso do pouso não ficou esperando a conta de A');
  assert.ok(!r.guardada.includes('v3|u3'),
    `DEFEITO: a reposição de A gravou na fila guardada o pedido que B decidiu: ${r.guardada}`);
  assert.ok(!r.naMemoria.includes('v3|u3'), 'PRÉ-CONDIÇÃO: o perfil chegou e o pedido decidido não saiu da fila de A');
  assert.ok(!r.reaberta.includes('v3|u3'),
    `DEFEITO: reaberto sem rede, o pedido que B decidiu voltou como card — o ✕ seria uma segunda decisão: ${r.reaberta}`);
  assert.deepEqual(r.reaberta, ['v1|u1', 'v2|u2', 'v4|u4', 'v5|u5', 'v6|u6', 'v7|u7']);
});

test('R14-4-02: o mesmo com a gravação da PREPARAÇÃO que a resposta do perfil dispara (antes do `definirPerfil`)', async () => {
  const r = await avisoEsperandoAConta({ caso: 'varredura' });
  assert.equal(r.esperando, 1, 'PRÉ-CONDIÇÃO');
  assert.ok(!r.guardada.includes('v3|u3'), `DEFEITO: a preparação gravou o pedido que B decidiu: ${r.guardada}`);
  assert.ok(!r.reaberta.includes('v3|u3'), `DEFEITO: reaberto sem rede, o pedido que B decidiu voltou como card: ${r.reaberta}`);
});

test('R14-4-02: CONTROLE — sem o pouso o pedido vai e volta (o instrumento o vê); com a conta já sabida o aviso vale na hora; e o aviso de OUTRA conta não tira nada', async () => {
  const sem = await avisoEsperandoAConta({ pouso: false });
  assert.ok(sem.guardada.includes('v3|u3') && sem.reaberta.includes('v3|u3'),
    'CONTROLE: sem o pouso o pedido não foi gravado ou não reabriu — o teste perdeu o sentido');
  const antes = await avisoEsperandoAConta({ perfilAntes: true });
  assert.equal(antes.esperando, 0, 'CONTROLE: com a conta sabida o aviso esperou');
  assert.ok(!antes.guardada.includes('v3|u3') && !antes.reaberta.includes('v3|u3'));
  // O aviso de OUTRA conta: fica fora enquanto espera, e a conta que chega (outra)
  // o descarta — o pedido segue pendente pra esta, e a próxima gravação o inclui.
  const outra = await avisoEsperandoAConta({ contaDoAviso: '9999' });
  assert.equal(outra.esperando, 1, 'PRÉ-CONDIÇÃO: o aviso de outra conta não esperou');
  assert.ok(outra.naMemoria.includes('v3|u3'), 'o aviso de OUTRA conta tirou o pedido da fila desta');
  assert.ok(outra.depois.includes('v3|u3'), 'DEFEITO: o pedido da fila desta conta não voltou à fila guardada na gravação seguinte');
  assert.ok(outra.reaberta.includes('v3|u3'), 'o pedido pendente desta conta não reabriu sem rede');
});

// ═══ os testes fatiam o FONTE; o app carrega o `js/min/` (gotcha #22) ═════════
test('o bundle GERADO tem os consertos (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  for (const nome of ['offlineGravarFila', 'offlineEpoca', 'filaChaves', 'chavesQueEsperamAConta']) {
    const re = new RegExp('\\b' + nome + '\\b', 'g');
    assert.ok(contar(APP_SEM, re) > 0, `PRÉ-CONDIÇÃO: ${nome} sumiu do fonte`);
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${nome} — falta \`npm run js\``);
  }
});
