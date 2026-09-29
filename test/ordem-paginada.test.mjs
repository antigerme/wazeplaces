// F8 (auditoria da fila, 2026-09-26): "⏳ Mais antigos" e "Perto de…" numa fila
// de MAIS DE UMA página.
//
// O `sortQueue` ordena o que está no aparelho, e dizia que "o Waze devolve tudo
// de uma vez". Até 500 pedidos é verdade; acima disso a fila vem em PÁGINAS, e
// a busca parava na primeira que trazia o bastante. MEDIDO no molde do
// test/busca-viva.test.mjs com a fila do owner (554 não lidos = 500 + 54): o
// pedido mais antigo só aparecia no card 499, e o mais perto de casa também.
//
// MEDIDO no Waze real (só leitura, conta do owner, Brasil, não lidos): a busca
// ACEITA `orderBy: 'SORTING_UPDATE_TIME_ASC'` (HTTP 200) e a página 1 muda —
// mas o critério é a hora de atualização do LOCAL, não a data do pedido, então
// nenhuma ordem do servidor dá a ordem do app. Daí as duas metades do conserto:
// uma ordem que não é a do Waze lê as páginas todas ANTES de ordenar, e "Mais
// antigos" pede ASC (a página 1 já vem perto do certo).
//
// Os testes RODAM o `fetchNextPage` e o `sortQueue` de verdade contra um Waze
// de mentira com a regra medida (página contada sobre a lista do momento) e que
// honra o `orderBy`. Cada um foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function achar(nome) { return new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM); }
function fatiar(nome) {
  const m = achar(nome);
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
const chave = (p) => `${p.venueID}|${p.updateRequestID}`;

// A fila do owner: 554 não lidos, na ordem do Waze — a hora de atualização do
// LOCAL, a mais nova primeiro (o índice 0). A data do PEDIDO acompanha, MENOS no
// V10: o pedido mais antigo de todos, num local atualizado há pouco — o caso que
// a medição achou na página 1 do DESC. É ele que separa as duas metades do
// conserto: pedindo ASC ele cai na ÚLTIMA página, então só o ASC não basta, e
// só ler as páginas todas também não o põe na frente sem ordenar.
const agora = 1790000000000;
const MAIS_ANTIGO = 'V10';
const ITENS = Array.from({ length: 554 }, (_, i) => ({
  venueID: 'V' + i, updateRequestID: 'R' + i, dateAdded: i === 10 ? agora - 999 * 60000 : agora - i * 60000,
  // o mais PERTO de casa está no fim da lista do Waze (página 2)
  mapa: { centro: i === 540 ? [-23.0001, -43.0001] : [-23 + ((i % 50) + 1) * 0.1, -43 - (i % 7) * 0.1] },
}));

// O Waze de mentira: a página contada sobre a lista do MOMENTO, 500 por página,
// e o `orderBy` honrado (ASC = a lista de trás pra frente).
function wazeVivo(itens, { porPagina = 500 } = {}) {
  const w = {
    pendentes: itens.map((p) => ({ ...p })), pedidas: [],
    async buscar(page, filtros) {
      w.pedidas.push({ page, orderBy: filtros.orderBy || 'SORTING_UPDATE_TIME_DESC' });
      const l = filtros.orderBy === 'SORTING_UPDATE_TIME_ASC' ? w.pendentes.slice().reverse() : w.pendentes;
      const fatia = l.slice((page - 1) * porPagina, page * porPagina);
      return { success: true, places: fatia.map((p) => ({ ...p })), hasMore: page * porPagina < l.length,
               page, total: fatia.length, blocked: 0 };
    },
    tratar(k) { const i = w.pendentes.findIndex((p) => chave(p) === k); if (i >= 0) w.pendentes.splice(i, 1); },
  };
  return w;
}

function montar(waze, { sortOrder = 'newest', referencias = null, queue = [], hasMore = true } = {}) {
  const log = [];
  const AppState = {
    authenticated: true, hasMore, fetching: false, fetchEpoch: 0, queue: queue.slice(), currentPlace: null,
    serverTotal: queue.length, serverBlocked: 0, blockedPartial: false, loadError: false, ultimaBusca: null, ordemPendente: false,
    autorEmFoco: null,
    filters: { unreadOnly: true, types: TYPES_ALL.slice(), residential: '', myArea: false, stateId: '', managedAreaId: '',
      categories: [], sortOrder },
    profile: null,
  };
  const deps = {
    AppState, TYPES_ALL, PREFETCH_THRESHOLD, MAX_EMPTY_PAGES: constante('MAX_EMPTY_PAGES'),
    MAX_PAGINAS_POR_BUSCA: constante('MAX_PAGINAS_POR_BUSCA'), ORDENS_POR_DISTANCIA: constante('ORDENS_POR_DISTANCIA'),
    ORDEM_PADRAO: constante('ORDEM_PADRAO'),
    navigator: { onLine: true }, Treino: { ativo: false },
    API: { fetchPlaces: (page, f) => waze.buscar(page, f), getRegion: () => 'row', getCountry: () => '30' },
    dfato: () => {}, dlog: () => {}, dlogVigiar: () => {}, dlogVoltou: () => {}, dlogCapturarAuto: () => {},
    handleUnauthorized: () => {}, showToast: () => {}, msgDoServidor: (r, d) => d, t: (k) => k,
    guardarPrazoDaSessao: () => {}, offlineGravarFila: () => {}, trackSeenCategories: () => {},
    aplicarRecusaAutomatica: () => {}, aoMudarAFilaPorBaixo: () => {}, updatePendingCount: () => {},
    offlineVarrer: () => {}, bloqueadosPorPagina: new Map(), pedidosQueEntraramNaFila: new Set(queue.map(chave)),
    pedidosEmAndamento: new Set(), pousosDaPagina: new Map(), offlineLigado: () => false,
    offlineLerPousos: () => [], carregarFilaDeSaida: () => [], console: { error: () => {} },
    lugarAgora: () => ({ regiao: 'row', pais: '30' }), refazerPerfilSeFaltar: () => {},
    limparFocoAutor: () => {}, removeCurrentCardEl: () => {},
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; log.push('card:' + (AppState.currentPlace && AppState.currentPlace.venueID)); },
  };
  const nomes = ['chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila', 'fetchNextPage',
    'referenciaDaOrdem', 'distanciaKm', 'pontoDoPlace', 'sortQueue', 'manterFocoNaFrente', 'assinaturaDeBusca', 'reordenarFilaNaTela'];
  // As funções do conserto: no código de antes elas não existem, e o teste tem
  // de reprovar pelo COMPORTAMENTO, não por não achá-las.
  for (const opcional of ['ordemDoWaze', 'ordemPrecisaDaFilaInteira', 'buscarORestoDaFila', 'caixaDaMinhaArea', 'desligarMinhaAreaSemCaixa']) {
    if (achar(opcional)) nomes.push(opcional);
  }
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let filaDeOnde = null; let rebuscasAuto = 0; let filaEsperaPerfil = false;
    let referenciasDoPerfil = ${JSON.stringify(referencias)}; let posicaoGps = null;\n`
    + nomes.map(fatiar).join('\n') + '\nreturn { fetchNextPage, sortQueue, assinaturaDeBusca, reordenarFilaNaTela };')(...chaves.map((k) => deps[k]));
  return { app, AppState, log };
}

// A abertura (o `startFetching`: busca com a fila vazia e mostra o topo) e,
// depois, a pessoa triando como no app: trata o da frente, a ordem pendente
// entra no `advanceQueue`, e a busca sai com a fila no limite.
async function abrir(m) {
  await m.app.fetchNextPage();
  m.AppState.currentPlace = m.AppState.queue[0] || null;
  return m.AppState.currentPlace;
}
async function triar(m, waze) {
  const { app, AppState } = m;
  const vistos = [];
  for (let passos = 0; passos < 5000; passos++) {
    if (AppState.queue.length === 0) {
      if (!AppState.hasMore) break;
      await app.fetchNextPage();
      if (AppState.queue.length === 0) break;
      app.sortQueue();
    }
    const p = AppState.queue[0];
    vistos.push(p);
    waze.tratar(chave(p));
    AppState.queue.shift();                        // advanceQueue
    AppState.currentPlace = null;
    if (AppState.ordemPendente) { AppState.ordemPendente = false; app.sortQueue(); }
    AppState.currentPlace = AppState.queue[0] || null;
    if (AppState.queue.length <= PREFETCH_THRESHOLD && AppState.hasMore) {
      await app.fetchNextPage();
      if (!AppState.currentPlace && AppState.queue.length) app.sortQueue();
    }
  }
  return vistos;
}

test('F8: "⏳ Mais antigos" com 554 pedidos — o PRIMEIRO card é o mais antigo da fila, e o Waze recebe o pedido em ordem ASC', async () => {
  const waze = wazeVivo(ITENS);
  const m = montar(waze, { sortOrder: 'oldest' });
  const primeiro = await abrir(m);
  const vistos = await triar(m, waze);
  const pos = vistos.findIndex((p) => p.venueID === MAIS_ANTIGO);
  assert.equal(primeiro.venueID, MAIS_ANTIGO, `"Mais antigos" começou por ${primeiro.venueID}; o mais antigo (${MAIS_ANTIGO}) só vem no card ${pos + 1}`);
  assert.ok(waze.pedidas.every((p) => p.orderBy === 'SORTING_UPDATE_TIME_ASC'),
    `"Mais antigos" não pediu a ordem ASC ao Waze: ${JSON.stringify(waze.pedidas[0])}`);
  assert.equal(vistos.length, 554, 'a triagem perdeu pedidos');
  // E a ordem vale a fila INTEIRA, não só a página 1.
  for (let i = 1; i < vistos.length; i++) {
    assert.ok(vistos[i - 1].dateAdded <= vistos[i].dateAdded, `fora de ordem no card ${i + 1}: ${vistos[i - 1].venueID} antes de ${vistos[i].venueID}`);
  }
});

test('F8: "Perto de casa" com 554 pedidos — o PRIMEIRO card é o mais perto, mesmo ele estando na página 2', async () => {
  const waze = wazeVivo(ITENS);
  const m = montar(waze, { sortOrder: 'casa', referencias: { casa: [-23, -43], trabalho: null } });
  const primeiro = await abrir(m);
  assert.equal(primeiro.venueID, 'V540', `"Perto de casa" começou por ${primeiro.venueID}; o mais perto (V540, a 15 m) estava na página 2`);
  assert.ok(waze.pedidas.every((p) => p.orderBy === 'SORTING_UPDATE_TIME_DESC'), 'a ordem por distância não pede nada diferente ao Waze');
});

test('F8: CONTROLE — com a ordem padrão (a do Waze) a abertura segue lendo UMA página: ninguém paga pelo que não escolheu', async () => {
  const waze = wazeVivo(ITENS);
  const m = montar(waze, { sortOrder: 'newest' });
  const primeiro = await abrir(m);
  assert.equal(primeiro.venueID, 'V0');
  assert.deepEqual(waze.pedidas, [{ page: 1, orderBy: 'SORTING_UPDATE_TIME_DESC' }], 'a ordem padrão passou a ler as páginas todas');
  // CONTROLE do instrumento: numa fila de uma página só, "Mais antigos" já era certo antes.
  const pequena = wazeVivo(ITENS.slice(0, 400));
  const p = montar(pequena, { sortOrder: 'oldest' });
  assert.equal((await abrir(p)).venueID, MAIS_ANTIGO);
  assert.equal(pequena.pedidas.length, 1, 'a fila de uma página só custou mais de uma leitura');
});

test('F8: o CUSTO — requisições por busca e na triagem inteira da fila de 554', async () => {
  const medir = async (sortOrder, referencias) => {
    const waze = wazeVivo(ITENS);
    const m = montar(waze, { sortOrder, referencias });
    await abrir(m);
    const naAbertura = waze.pedidas.length;
    await triar(m, waze);
    return { naAbertura, total: waze.pedidas.length };
  };
  const padrao = await medir('newest');
  const antigos = await medir('oldest');
  const casa = await medir('casa', { casa: [-23, -43], trabalho: null });
  console.log(`# custo (554 pedidos, 500 por página): padrão ${padrao.naAbertura} na abertura / ${padrao.total} no total · `
    + `"Mais antigos" ${antigos.naAbertura} / ${antigos.total} · "Perto de casa" ${casa.naAbertura} / ${casa.total}`);
  assert.equal(antigos.naAbertura, 2, '"Mais antigos" com 554 pedidos: uma página a mais, e só ela');
  assert.equal(casa.naAbertura, 2);
  assert.ok(antigos.total <= padrao.total + 1 && casa.total <= padrao.total + 1,
    'a ordem escolhida custou mais que uma página a mais na triagem inteira');
});

test('F8: trocar SÓ entre "Mais recentes" e "Mais antigos" muda o que se pede ao Waze — entra na assinatura da busca; "Perto de…" não', () => {
  const m = montar(wazeVivo([]), { sortOrder: 'newest' });
  const recentes = m.app.assinaturaDeBusca();
  m.AppState.filters.sortOrder = 'oldest';
  assert.notEqual(m.app.assinaturaDeBusca(), recentes, 'a troca pra "Mais antigos" reordena só a página que está no aparelho');
  m.AppState.filters.sortOrder = 'casa';
  assert.equal(m.app.assinaturaDeBusca(), recentes, 'a ordem por distância não muda o pedido ao Waze e não precisa refazer a fila');
});

test('F8: trocar pra "Perto de casa" com a fila PELA METADE — o resto vem na hora, e entra na ordem a partir do próximo card', async () => {
  const waze = wazeVivo(ITENS);
  const m = montar(waze, { sortOrder: 'newest', referencias: { casa: [-23, -43], trabalho: null } });
  await abrir(m);                                  // a página 1, pela ordem padrão
  assert.equal(m.AppState.queue.length, 500);
  // Filtros → "Perto de casa" → Aplicar: a assinatura não muda, então é o
  // `reordenarFilaNaTela`, com um card na tela.
  m.AppState.filters.sortOrder = 'casa';
  m.app.reordenarFilaNaTela();
  for (let i = 0; i < 50 && m.AppState.fetching === false && m.AppState.queue.length === 500; i++) await new Promise((ok) => setTimeout(ok, 0));
  for (let i = 0; i < 50 && m.AppState.fetching; i++) await new Promise((ok) => setTimeout(ok, 0));
  assert.equal(m.AppState.queue.length, 554, 'o resto da fila não veio: a ordem por distância vale só pra página 1');
  // O card da tela não troca debaixo do dedo; o próximo já é o mais perto.
  assert.equal(m.AppState.ordemPendente, true, 'a ordem do resto não ficou pendente pro próximo card');
  m.AppState.queue.shift(); m.AppState.ordemPendente = false; m.app.sortQueue();   // o advanceQueue
  assert.equal(m.AppState.queue[0].venueID, 'V540', 'o próximo card depois da troca não é o mais perto de casa');
});
