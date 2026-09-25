// A BUSCA RELÊ A PARTIR DA PÁGINA 1 (v2026.09.25-02).
//
// MEDIDO em 2026-09-25, na fila real do Brasil e só lendo: o Waze conta a
// página sobre a lista do MOMENTO do pedido, já sem os lidos ("lidos também"
// 500 + 307, "só não lidos" 500 + 54, e os 4 lidos da página 1 empurraram a
// divisa exatamente 4 pedidos). O app pedia a "próxima página" só depois de a
// pessoa tratar a página 1 — e a essa altura ela já tinha andado: vinha vazia
// e o app mostrava "Tudo limpo!" com os pedidos que tinham subido.
//
// Estes testes RODAM o `fetchNextPage` de verdade (fatiado do fonte) contra um
// Waze de mentira com a mesma regra — a página contada sobre a lista viva — e
// uma pessoa triando: cada card que ela trata sai da lista do Waze (rejeitar),
// vira lido (marcar lido) ou fica (pular). O CONTROLE é a mesma triagem com a
// lógica antiga, a "próxima página": nesse Waze ela TEM que perder pedidos,
// senão o instrumento não distingue nada (gotcha #28). A tela e o gesto de
// verdade estão no bloco "A fila VIVA" do `tools/smoke-browser.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
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
  const corpo = APP_SEM.slice(m.index, fim);
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function('return (' + m[1] + ');')();
};
const TYPES_ALL = constante('TYPES_ALL');
const PREFETCH_THRESHOLD = constante('PREFETCH_THRESHOLD');
const MAX_EMPTY_PAGES = constante('MAX_EMPTY_PAGES');
const MAX_PAGINAS_POR_BUSCA = constante('MAX_PAGINAS_POR_BUSCA');

// O Waze de mentira: a lista de pendentes em ordem, e a página contada sobre a
// lista do MOMENTO (sem os lidos, com "só não lidos"). É a regra medida.
function wazeVivo(n, { porPagina = 5 } = {}) {
  const w = {
    pendentes: Array.from({ length: n }, (_, i) => ({ venueID: 'V' + (i + 1), updateRequestID: 'R' + (i + 1), lido: false })),
    porPagina, pedidas: [], semRespostaNa: null,
    lista(unreadOnly) { return unreadOnly ? w.pendentes.filter((p) => !p.lido) : w.pendentes; },
    async buscar(page, filtros) {
      w.pedidas.push(page);
      if (w.semRespostaNa === page) return { success: false, error: 'rede', errorCategory: 'transient' };
      const l = w.lista(filtros.unreadOnly !== false);
      const fatia = l.slice((page - 1) * w.porPagina, page * w.porPagina);
      return { success: true, places: fatia.map((p) => ({ venueID: p.venueID, updateRequestID: p.updateRequestID })),
               hasMore: page * w.porPagina < l.length, page, total: fatia.length, blocked: 0 };
    },
    tratar(chave, como) {
      const i = w.pendentes.findIndex((p) => `${p.venueID}|${p.updateRequestID}` === chave);
      if (i < 0) return;
      if (como === 'rejeitar') w.pendentes.splice(i, 1);
      else if (como === 'ler') w.pendentes[i].lido = true;
    },
    chegar(id) { w.pendentes.unshift({ venueID: 'V' + id, updateRequestID: 'R' + id, lido: false }); },
  };
  return w;
}

// O app: o `fetchNextPage` e os dois filtros de verdade, com o resto de
// mentira (diário, toast, gravação do offline).
function montar(waze, { unreadOnly = true, online = true } = {}) {
  const diario = [];
  const toasts = [];
  const varreduras = [];
  const AppState = {
    authenticated: true, hasMore: true, fetching: false, fetchEpoch: 0, queue: [], currentPlace: null,
    serverTotal: 0, serverBlocked: 0, blockedPartial: false, loadError: false, ultimaBusca: null,
    filters: { unreadOnly, types: TYPES_ALL.slice(), residential: '', myArea: false, stateId: '', managedAreaId: '', categories: [] },
    profile: null,
  };
  const deps = {
    AppState, TYPES_ALL, PREFETCH_THRESHOLD, MAX_EMPTY_PAGES, MAX_PAGINAS_POR_BUSCA,
    navigator: { onLine: online },
    API: { fetchPlaces: (page, filtros) => waze.buscar(page, filtros) },
    dfato: (k, o) => diario.push([k, o]),
    dlog: () => {}, dlogVigiar: () => {}, dlogVoltou: () => {}, dlogCapturarAuto: () => {},
    handleUnauthorized: () => {}, showToast: (m, tipo) => toasts.push(tipo), msgDoServidor: (r, d) => d, t: (k) => k,
    rebuscasAuto: 0, guardarPrazoDaSessao: () => {}, offlineGravarFila: () => {}, trackSeenCategories: () => {},
    sortQueue: () => {}, aplicarRecusaAutomatica: () => {}, updatePendingCount: () => {},
    offlineVarrer: () => varreduras.push(Date.now()),
    bloqueadosPorPagina: new Map(), pedidosQueEntraramNaFila: new Set(),
    pedidosEmAndamento: new Set(), pousosDaPagina: new Map(), offlineLigado: () => false,
    offlineLerPousos: () => [], carregarFilaDeSaida: () => [],
    // O treino tem fila de EXEMPLOS: a busca não roda com ele ativo.
    Treino: { ativo: false },
    console: { error: () => {} },
  };
  const fontes = ['chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila', 'fetchNextPage']
    .map(fatiar).join('\n');
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, fontes + '\nreturn { fetchNextPage };')(...nomes.map((n) => deps[n]));
  return { app, AppState, deps, diario, toasts, varreduras };
}

const chave = (p) => `${p.venueID}|${p.updateRequestID}`;

// A pessoa triando: trata o card da frente (sai da fila, como o
// `advanceQueue`), e o Waze muda do jeito de cada gesto. Com a fila no
// limite, a busca de novo — o `maybePrefetch`. Termina quando a tela seria o
// "Tudo limpo!": fila vazia e nada mais a buscar.
async function triar(m, waze, gesto, { aoTratar } = {}) {
  const { app, AppState } = m;
  const vistos = [];
  await app.fetchNextPage();
  for (let passos = 0; passos < 500; passos++) {
    if (AppState.queue.length === 0) {
      if (!AppState.hasMore) break;
      await app.fetchNextPage();                 // o `startFetching` com a fila vazia
      if (AppState.queue.length === 0) break;
    }
    const p = AppState.queue[0];
    AppState.currentPlace = p;
    vistos.push(chave(p));
    waze.tratar(chave(p), gesto(p, vistos.length));
    if (aoTratar) aoTratar(vistos.length);
    AppState.queue.shift();
    AppState.currentPlace = AppState.queue[0] || null;
    if (AppState.queue.length <= PREFETCH_THRESHOLD && AppState.hasMore) await app.fetchNextPage();
  }
  return vistos;
}

// A lógica ANTIGA, pra o controle: "a próxima página", com a mesma triagem.
async function triarComProximaPagina(waze, gesto, { unreadOnly = true } = {}) {
  const fila = [];
  const vistos = [];
  const entraram = new Set();
  let pagina = 1, hasMore = true;
  const buscar = async () => {
    const r = await waze.buscar(pagina++, { unreadOnly });
    hasMore = r.hasMore;
    for (const p of r.places) if (!entraram.has(chave(p))) { entraram.add(chave(p)); fila.push(p); }
  };
  await buscar();
  while (fila.length || hasMore) {
    if (!fila.length) { await buscar(); if (!fila.length && !hasMore) break; continue; }
    const p = fila.shift();
    vistos.push(chave(p));
    waze.tratar(chave(p), gesto(p, vistos.length));
    if (fila.length <= PREFETCH_THRESHOLD && hasMore) await buscar();
  }
  return vistos;
}

// ── o defeito medido, e o controle ─────────────────────────────────────────
test('CONTROLE: no Waze vivo, a "próxima página" perde os pedidos que subiram', async () => {
  const waze = wazeVivo(12);
  const vistos = await triarComProximaPagina(waze, () => 'rejeitar');
  const perdidos = waze.pendentes.length;
  assert.ok(perdidos > 0,
    `a lógica antiga não perdeu nada neste Waze — então ele não reproduz o defeito e os testes abaixo não provam nada (${vistos.length} vistos)`);
});

test('tratando a página 1, a busca relê do topo e não perde nem repete ninguém', async () => {
  const waze = wazeVivo(12);
  const m = montar(waze);
  const vistos = await triar(m, waze, () => 'rejeitar');
  assert.equal(new Set(vistos).size, vistos.length, `card repetido: ${vistos.join(' ')}`);
  assert.equal(vistos.length, 12, `a pessoa viu ${vistos.length} de 12 — ${waze.pendentes.length} ficaram pendentes`);
  assert.equal(waze.pendentes.length, 0, 'o "Tudo limpo!" chegou com pedido pendente no Waze');
  assert.equal(m.AppState.hasMore, false);
  assert.ok(waze.pedidas.every((p) => p === 1), `com os tratados saindo da lista, a página 1 basta: pediu ${waze.pedidas.join(',')}`);
});

test('marcando como LIDO ("só não lidos"), o lido sai da lista do Waze e a busca segue achando o resto', async () => {
  const waze = wazeVivo(12);
  const m = montar(waze);
  const vistos = await triar(m, waze, () => 'ler');
  assert.equal(new Set(vistos).size, 12, `viu ${new Set(vistos).size} de 12`);
  assert.equal(vistos.length, 12, 'card repetido');
  assert.equal(waze.lista(true).length, 0, 'sobrou não lido que nunca virou card');
});

test('"lidos também": o lido CONTINUA na lista, e a busca anda pelas páginas até achar o novo', async () => {
  const waze = wazeVivo(12);
  const m = montar(waze, { unreadOnly: false });
  const vistos = await triar(m, waze, () => 'ler');
  assert.equal(new Set(vistos).size, 12, `viu ${new Set(vistos).size} de 12`);
  assert.equal(vistos.length, 12, 'o lido voltou como card na mesma fila');
  assert.ok(waze.pedidas.includes(2) && waze.pedidas.includes(3), `tinha que andar até as páginas 2 e 3: ${waze.pedidas.join(',')}`);
  assert.ok(waze.pedidas.length <= 8, `leituras demais pra 12 pedidos: ${waze.pedidas.join(',')}`);
});

test('o PULADO continua pendente e não volta na mesma fila; o pedido que CHEGA no meio entra', async () => {
  const waze = wazeVivo(12);
  const m = montar(waze);
  const pulados = new Set();
  const vistos = await triar(m, waze, (p, n) => (n % 4 === 0 ? (pulados.add(chave(p)), 'pular') : 'rejeitar'),
    { aoTratar: (n) => { if (n === 6) { waze.chegar(90); waze.chegar(91); } } });
  assert.equal(new Set(vistos).size, vistos.length, `card repetido: ${vistos.join(' ')}`);
  assert.ok(vistos.includes('V90|R90') && vistos.includes('V91|R91'), 'o pedido que chegou durante a triagem não entrou');
  assert.equal(vistos.length, 14, `12 + 2 que chegaram: viu ${vistos.length}`);
  const sobraram = waze.pendentes.map(chave).sort();
  assert.deepEqual(sobraram, [...pulados].sort(), 'no fim, pendente só pode sobrar o que a pessoa PULOU');
});

test('o local da divisa (o medido da #247): com a página 1 já vista, a busca anda até a 2 e não repete ninguém', async () => {
  const P = (v, u) => ({ venueID: v, updateRequestID: u });
  const paginas = { 1: [P('A', 'a1'), P('B', 'b1'), P('C', 'c1'), P('C', 'c2'), P('D', 'd1')],
                    2: [P('C', 'c1'), P('C', 'c2'), P('E', 'e1'), P('F', 'f1')] };
  const waze = { pedidas: [], async buscar(page) {
    waze.pedidas.push(page);
    return { success: true, places: (paginas[page] || []).map((p) => ({ ...p })), hasMore: page === 1, blocked: 0 };
  } };
  const m = montar(waze);
  await m.app.fetchNextPage();
  assert.equal(m.AppState.queue.length, 5);
  await m.app.fetchNextPage();                       // com a fila CHEIA: a página 1 já vista não para a busca
  const chaves = m.AppState.queue.map(chave);
  assert.deepEqual(waze.pedidas, [1, 1, 2]);
  assert.equal(chaves.length, 7, `fila: ${chaves.join(' ')}`);
  assert.equal(new Set(chaves).size, 7, 'o local da divisa entrou duas vezes');
  assert.equal(m.AppState.serverTotal, 7, 'o "Restam" contou o repetido');
  const linha = m.diario.find(([k]) => k === 'busca.reposicao');
  assert.deepEqual(linha && linha[1], { paginas: 2, novos: 2, jaVistos: 7, hasMore: false });
});

// ── os tetos ──────────────────────────────────────────────────────────────
test('região sem nada editável: desiste depois de MAX_EMPTY_PAGES páginas vazias, com o D13 marcado como piso', async () => {
  const waze = wazeVivo(0);
  waze.buscar = async (page) => { waze.pedidas.push(page); return { success: true, places: [], hasMore: true, blocked: 7 }; };
  const m = montar(waze);
  await m.app.fetchNextPage();
  assert.equal(waze.pedidas.length, MAX_EMPTY_PAGES);
  assert.equal(m.AppState.hasMore, false);
  assert.equal(m.AppState.blockedPartial, true);
  assert.equal(m.AppState.serverBlocked, 7 * MAX_EMPTY_PAGES, 'o D13 conta cada página uma vez');
});

test('Waze dizendo hasMore pra sempre só com o que já passou: para no teto de páginas', async () => {
  const waze = wazeVivo(3);
  const m = montar(waze);
  await m.app.fetchNextPage();                     // os 3 entram
  const velha = waze.buscar;
  waze.buscar = async (page, f) => ({ ...(await velha(1, f)), hasMore: true });
  waze.pedidas.length = 0;
  m.AppState.hasMore = true;                       // a 1ª busca viu o fim; aqui o Waze passa a mentir
  await m.app.fetchNextPage();
  assert.equal(waze.pedidas.length, MAX_PAGINAS_POR_BUSCA);
  assert.equal(m.AppState.hasMore, false);
  assert.equal(m.AppState.queue.length, 3, 'nada repetido entrou');
});

test('D13: reler a mesma página não soma o bloqueado de novo', async () => {
  const waze = wazeVivo(12);
  const velha = waze.buscar;
  waze.buscar = async (page, f) => ({ ...(await velha(page, f)), blocked: 2 });
  const m = montar(waze);
  await triar(m, waze, () => 'rejeitar');
  assert.ok(waze.pedidas.length > 2, `precisava reler a página 1 algumas vezes: ${waze.pedidas.join(',')}`);
  assert.equal(m.AppState.serverBlocked, 2, `somou a cada leitura: ${m.AppState.serverBlocked}`);
});

// ── sem rede ──────────────────────────────────────────────────────────────
test('SEM REDE com card na fila: não pede nada e não desiste — a próxima ação busca de novo', async () => {
  const waze = wazeVivo(12);
  const m = montar(waze);
  await m.app.fetchNextPage();
  m.AppState.queue.splice(2);                        // sobraram 2 cards
  m.deps.navigator.onLine = false;
  const antes = waze.pedidas.length;
  await m.app.fetchNextPage();
  assert.equal(waze.pedidas.length, antes, 'pediu sem rede');
  assert.equal(m.AppState.hasMore, true, 'desistiu da fila por estar sem rede');
  assert.equal(m.AppState.loadError, false);
  assert.equal(m.toasts.length, 0, 'toast vermelho pra quem está sem rede tratando o que já tem');
  m.deps.navigator.onLine = true;                    // a rede voltou: a mesma busca segue
  await m.app.fetchNextPage();
  assert.ok(m.AppState.queue.length > 2, 'com a rede de volta, a busca não repôs');
});

test('SEM REDE com a fila vazia: a tela é a de "sem sinal" (loadError), nunca o "Tudo limpo!"', async () => {
  const waze = wazeVivo(12);
  const m = montar(waze, { online: false });
  await m.app.fetchNextPage();
  assert.equal(waze.pedidas.length, 0, 'pediu sem rede');
  assert.equal(m.AppState.loadError, true, 'sem o loadError o showNoPlaces desenharia "Tudo limpo!"');
  assert.equal(m.AppState.hasMore, false, 'sem isto o laço do startFetching não termina (gotcha #19)');
  assert.ok(m.diario.some(([k]) => k === 'busca.semRede'), 'o diário não anotou a busca sem rede');
});

test('uma página que falha POR REDE no meio da leitura guarda o que já veio e ESPERA calada', async () => {
  // Com card na fila, a queda no meio da busca é o "sem rede com card" do topo
  // (o `onLine` só não virou ainda): antes ela desistia da fila com toast
  // vermelho e `hasMore = false` (auditoria 2026-09-25).
  const waze = wazeVivo(12, { porPagina: 2 });
  waze.semRespostaNa = 2;
  const m = montar(waze);
  await m.app.fetchNextPage();                       // página 1: 2 novos (≤ 3), anda pra 2, que falha
  assert.deepEqual(waze.pedidas, [1, 2]);
  assert.equal(m.AppState.queue.length, 2, 'perdeu o que a página 1 trouxe');
  assert.equal(m.AppState.loadError, false, 'desistiu da fila com card na tela');
  assert.equal(m.AppState.hasMore, true, 'a próxima ação não buscaria de novo');
  assert.deepEqual(m.toasts, [], 'toast vermelho por uma queda de sinal com card na tela');
  // A próxima ação busca de novo — e, com a rede de volta, acha o resto.
  waze.semRespostaNa = null;
  await m.app.fetchNextPage();
  assert.ok(m.AppState.queue.length > 2, 'a busca seguinte não trouxe o que faltava');
});

test('falha de rede com a fila VAZIA: aí sim marca a falha (a tela é a de erro)', async () => {
  const waze = wazeVivo(12);
  waze.semRespostaNa = 1;
  const m = montar(waze);
  await m.app.fetchNextPage();
  assert.equal(m.AppState.loadError, true);
  assert.equal(m.AppState.hasMore, false, 'sem isto o laço do `startFetching` giraria');
});

// ── o diário e a varredura do offline ─────────────────────────────────────
test('a abertura não é reposição; TODA busca que traz pedido chama a varredura do offline', async () => {
  // Até a auditoria de 2026-09-25 a abertura NÃO chamava, contando com "a
  // próxima resposta que chegar" — e a primeira prova de rede (a própria busca)
  // roda antes de a fila existir: quem abria o app em casa e não triava saía
  // sem nada preparado, com as Preferências dizendo "Pronto".
  const waze = wazeVivo(12);
  const m = montar(waze);
  await m.app.fetchNextPage();
  assert.equal(m.varreduras.length, 1, 'a abertura não preparou o offline');
  assert.ok(!m.diario.some(([k]) => k === 'busca.reposicao'), 'a abertura não é reposição');
  for (const p of m.AppState.queue.splice(0, 3)) waze.tratar(chave(p), 'rejeitar');
  await m.app.fetchNextPage();
  const linha = m.diario.find(([k]) => k === 'busca.reposicao');
  assert.ok(linha, 'a reposição não foi anotada');
  assert.deepEqual(Object.keys(linha[1]).sort(), ['hasMore', 'jaVistos', 'novos', 'paginas'],
    'o diário roda pra todo editor: só contagens');
  assert.equal(m.varreduras.length, 2, 'o que entrou numa reposição não foi pra varredura');
  assert.equal(m.AppState.ultimaBusca.paginas, 1);
});

// ── o treino e a reentrância (auditoria de 2026-09-25) ────────────────────
test('treino ativo: a busca NÃO roda — pedido real pousaria na fila de exemplos', async () => {
  const waze = wazeVivo(12);
  const m = montar(waze);
  m.deps.Treino.ativo = true;
  await m.app.fetchNextPage();
  assert.deepEqual(waze.pedidas, [], 'buscou com o treino ativo');
  assert.equal(m.AppState.queue.length, 0);
  // CONTROLE: fora do treino a mesma chamada busca.
  m.deps.Treino.ativo = false;
  await m.app.fetchNextPage();
  assert.deepEqual(waze.pedidas, [1]);
});

test('`fetching` preso SEM promessa não vira laço: a busca sai de novo', async () => {
  // Era o estado que o treino deixava (restaurava `fetching = true` depois de a
  // busca terminar), e o `startFetching` girava em microtarefa pra sempre
  // porque a reentrância devolvia `Promise.resolve()` sem buscar nada.
  const waze = wazeVivo(12);
  const m = montar(waze);
  m.AppState.fetching = true;
  m.AppState._fetchPromise = null;
  await m.app.fetchNextPage();
  assert.deepEqual(waze.pedidas, [1], 'a busca não saiu com `fetching` preso');
  assert.ok(m.AppState.queue.length > 0);
  assert.equal(m.AppState.fetching, false);
});

test('a volta da rede e o "Tentar novamente" retomam SEM zerar a fila (os pulados não voltam)', () => {
  // Era `resetQueue()` + `startFetching()`: os pedidos que a pessoa PULOU nesta
  // sessão voltavam, e com card na tela o card era arrancado e a ação da janela
  // do Desfazer saía antes da hora (auditoria 2026-09-25).
  const r = fatiar('retomarBusca');
  assert.match(r, /AppState\.loadError = false;\s*AppState\.hasMore = true;\s*startFetching\(\);/);
  assert.doesNotMatch(r, /resetQueue/);
  assert.match(APP_SEM, /if \(AppState\.authenticated && AppState\.loadError && !AppState\.fetching\) \{\s*retomarBusca\(\);\s*\}/,
    'a volta da rede voltou a zerar a fila');
  assert.match(APP_SEM, /\$\('retryLoadBtn'\)\?\.addEventListener\('click', async \(\) => \{\s*if \(await offlineTentarAbrirSemRede\(\)\) return;\s*retomarBusca\(\);/,
    'o "Tentar novamente" voltou a zerar a fila (e a descartar a guardada do offline)');
  assert.match(APP_SEM, /\$\('refreshBtn'\)\.addEventListener\('click', \(\) => \{\s*if \(AppState\.fetching\) return;\s*if \(navigator\.onLine === false\) \{/,
    'o ↻ sem rede joga fora a fila (inclusive a guardada)');
});
