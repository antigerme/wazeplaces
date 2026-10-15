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
  const tela = { gesto: false, camada: false };
  const AppState = {
    authenticated: true, hasMore, fetching: false, fetchEpoch: 0, queue: queue.slice(), currentPlace: null,
    serverTotal: queue.length, serverBlocked: 0, blockedPartial: false, loadError: false, ultimaBusca: null,
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
    // A tela, que o teste controla: o gesto no card e a camada por cima (R24-6-A7).
    tela, cardDaFrente: () => ({ id: 'card' }), cardSobGesto: () => tela.gesto, semCamadaAberta: () => !tela.camada,
    mantendoFocoNoCard: (redesenhar) => redesenhar(),
    // A sessão da busca (a que cai no meio é descartada, R14-1-02).
    epocaDaSessao: 0,
  };
  const nomes = ['chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila', 'fetchNextPage',
    'referenciaDaOrdem', 'distanciaKm', 'pontoDoPlace', 'sortQueue', 'manterFocoNaFrente', 'assinaturaDeBusca', 'reordenarFilaNaTela'];
  // A troca do card com as páginas por vir: no código de antes não existe.
  for (const novo of ['reordenarEsperandoAsPaginas', 'atenderReordenacaoAdiada']) if (achar(novo)) nomes.push(novo);
  // As funções do conserto: no código de antes elas não existem, e o teste tem
  // de reprovar pelo COMPORTAMENTO, não por não achá-las.
  // `ordemValida` (e a espera do perfil): a fila inteira se decide pela ordem que
  // VALE, não pela salva (R56-3).
  for (const opcional of ['ordemDoWaze', 'ordemPrecisaDaFilaInteira', 'ordemValida', 'ordemSalvaEsperaOPerfil',
    'buscarORestoDaFila', 'caixaDaMinhaArea', 'desligarMinhaAreaSemCaixa']) {
    if (achar(opcional)) nomes.push(opcional);
  }
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let filaDeOnde = null; let rebuscasAuto = 0; let filaEsperaPerfil = false;
    let reordenacaoVez = 0; let reordenacaoAdiada = null;
    let referenciasDoPerfil = ${JSON.stringify(referencias)}; let posicaoGps = null;\n`
    + nomes.map(fatiar).join('\n') + '\nreturn { fetchNextPage, sortQueue, assinaturaDeBusca, reordenarFilaNaTela, atender: typeof atenderReordenacaoAdiada === "function" ? atenderReordenacaoAdiada : () => {} };')(...chaves.map((k) => deps[k]));
  return { app, AppState, log, tela };
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

// Segura as páginas 2+ do Waze de mentira até o teste soltar (a fila grande
// chegando devagar) — a abertura, que lê só a página 1, não é afetada.
function segurarPaginas(waze) {
  let soltar; const porta = new Promise((ok) => { soltar = ok; });
  const orig = waze.buscar;
  waze.buscar = async (page, f) => { if (page >= 2) await porta; return orig(page, f); };
  return soltar;
}
const tique = () => new Promise((ok) => setTimeout(ok, 0));
async function assentar(m) {
  for (let i = 0; i < 40; i++) await tique();
  for (let i = 0; i < 200 && m.AppState.fetching; i++) await tique();
  for (let i = 0; i < 20; i++) await tique();
}
const CASA = { casa: [-23, -43], trabalho: null };
// A pessoa abre com a fila pela metade (a página 1 pela ordem padrão), escolhe
// "Perto de casa" e aplica: a assinatura não muda, então é o
// `reordenarFilaNaTela`, com um card na tela.
async function abrirEAplicar({ itens = ITENS, segurar = true } = {}) {
  const waze = wazeVivo(itens);
  const soltar = segurar ? segurarPaginas(waze) : () => {};
  const m = montar(waze, { sortOrder: 'newest', referencias: CASA });
  await abrir(m);
  const frente = m.AppState.currentPlace;
  m.AppState.filters.sortOrder = 'casa';
  const antes = waze.pedidas.length;
  m.app.reordenarFilaNaTela();
  return { waze, soltar, m, frente, antes };
}

test('R24-6-A7: trocar pra "Perto de casa" com a fila em 2 páginas — o card FICA enquanto elas vêm, e o primeiro é o mais perto da fila INTEIRA', async () => {
  const { waze, soltar, m, frente, antes } = await abrirEAplicar();
  await assentar(m);
  // Com a página 2 ainda no Waze: o card da tela não saiu de debaixo do dedo, e
  // o RESTO já está na ordem nova (quem tratar o card agora segue por ela).
  assert.equal(m.AppState.currentPlace, frente, 'o card da tela trocou ANTES das páginas chegarem');
  assert.equal(m.AppState.queue[0], frente);
  assert.deepEqual(m.log, [], 'o card foi redesenhado antes de as páginas chegarem');
  soltar();
  await assentar(m);
  assert.equal(m.AppState.queue.length, 554, 'o resto da fila não veio');
  // O primeiro da fila é o mais perto de casa da fila INTEIRA (V540, na página 2),
  // e não o mais perto da página 1 com o resto atrás dele — MEDIDO no Brasil
  // (500+199): o 1º a 55 km e um de 2 km em 2º.
  assert.equal(m.AppState.currentPlace.venueID, 'V540', 'o primeiro card não é o mais perto de casa da fila inteira');
  assert.equal(m.AppState.queue[0], m.AppState.currentPlace, 'o card da tela e o topo da fila divergiram');
  assert.deepEqual(m.log, ['card:V540'], 'o card deve trocar UMA vez, quando as páginas chegaram');
  const rad = (g) => g * Math.PI / 180;
  const km = (p) => {   // haversine, como o app
    const [la, lo] = p.mapa.centro, dla = rad(la + 23), dlo = rad(lo + 43);
    const h = Math.sin(dla / 2) ** 2 + Math.cos(rad(-23)) * Math.cos(rad(la)) * Math.sin(dlo / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };
  const q = m.AppState.queue;
  for (let i = 1; i < q.length; i++) assert.ok(km(q[i - 1]) <= km(q[i]) + 1e-9, `fora de ordem no ${i}`);
  // Custo: as MESMAS páginas que a busca nova leria (a abertura com essa ordem
  // leu [1,2]), uma vez — nenhuma a mais.
  assert.deepEqual(waze.pedidas.slice(antes).map((p) => p.page), [1, 2], 'a troca de ordem pediu páginas a mais (ou a menos)');
});

test('R24-6-A7: CONTROLE — a fila de UMA página troca o card na hora e não pede nada ao Waze', async () => {
  const { waze, m, antes } = await abrirEAplicar({ itens: ITENS.slice(0, 300), segurar: false });
  assert.equal(m.AppState.hasMore, false);
  assert.equal(m.log.length, 1, 'com a fila inteira na mão a troca do card deve ser imediata (síncrona)');
  assert.equal(m.AppState.queue[0], m.AppState.currentPlace);
  await assentar(m);
  assert.equal(waze.pedidas.length, antes, 'a fila de uma página gastou requisição na troca de ordem');
  assert.equal(m.log.length, 1);
});

test('R24-6-A7: CONTROLE — a ordem padrão e "Mais antigos" não passam pela espera (a ordem do Waze já é a certa na página 1)', async () => {
  for (const ordem of ['newest']) {
    const waze = wazeVivo(ITENS);
    const m = montar(waze, { sortOrder: 'oldest' });
    await abrir(m);
    m.AppState.filters.sortOrder = ordem;
    const antes = waze.pedidas.length;
    m.app.reordenarFilaNaTela();
    assert.equal(m.log.length, 1, `a ordem ${ordem} deixou de trocar o card na hora`);
    await assentar(m);
    assert.equal(waze.pedidas.length, antes, 'a ordem padrão pediu páginas');
  }
});

test('R24-6-A7: o card na MÃO da pessoa (o gesto) não é arrancado — a troca espera o fim do gesto, se o card ainda é o mesmo', async () => {
  const { soltar, m, frente } = await abrirEAplicar();
  m.tela.gesto = true;
  soltar();
  await assentar(m);
  assert.equal(m.AppState.currentPlace, frente, 'o card foi trocado com o dedo nele');
  assert.deepEqual(m.log, []);
  // O arraste voltou ao lugar (sem decidir): o fim do gesto atende a troca.
  m.tela.gesto = false;
  m.app.atender();
  assert.equal(m.AppState.currentPlace.venueID, 'V540', 'o fim do gesto não atendeu a troca do card');
  assert.deepEqual(m.log, ['card:V540']);
  // E atendida uma vez: o próximo aviso de fim de gesto não redesenha.
  m.app.atender();
  assert.equal(m.log.length, 1);
});

test('R24-6-A7: uma camada por cima (a foto, um modal) segura a troca até fechar', async () => {
  const { soltar, m, frente } = await abrirEAplicar();
  m.tela.camada = true;
  soltar();
  await assentar(m);
  assert.equal(m.AppState.currentPlace, frente, 'o card foi trocado por baixo de uma camada aberta');
  m.tela.camada = false;
  m.app.atender();   // o `aoFecharCamada`
  assert.equal(m.AppState.currentPlace.venueID, 'V540');
});

test('R24-6-A7: a pessoa JÁ tratou o card enquanto as páginas vinham — nada é trocado, e o resto segue ordenado (o próximo é o mais perto)', async () => {
  const { soltar, m, frente } = await abrirEAplicar();
  // O gesto decidiu o card: o `advanceQueue` o tira e o próximo assume.
  m.AppState.queue.shift();
  m.AppState.currentPlace = m.AppState.queue[0];
  const novoNaTela = m.AppState.currentPlace;
  assert.notEqual(novoNaTela, frente);
  soltar();
  await assentar(m);
  assert.equal(m.AppState.currentPlace, novoNaTela, 'o card que a pessoa já tinha na tela foi arrancado');
  assert.deepEqual(m.log, []);
  m.tela.gesto = false; m.app.atender();
  assert.deepEqual(m.log, [], 'o fim de um gesto posterior trocou um card que não era o do pedido');
  // O card da tela segue na frente da fila e o resto está na ordem nova: o mais
  // perto (da página 2) é o próximo.
  assert.equal(m.AppState.queue[0], novoNaTela);
  assert.equal(m.AppState.queue[1].venueID, 'V540');
});

test('R24-6-A7: a fila refeita no meio (↻, filtro, "Sair") descarta a troca — nada de card de uma fila que não existe mais', async () => {
  const { soltar, m } = await abrirEAplicar();
  m.AppState.fetchEpoch++;   // o `resetQueue`
  soltar();
  await assentar(m);
  assert.deepEqual(m.log, [], 'a troca do card de uma fila antiga atravessou o ↻');
});

test('R24-6-A7: duas trocas de ordem seguidas — só a última troca o card, uma vez', async () => {
  const waze = wazeVivo(ITENS);
  const soltar = segurarPaginas(waze);
  const m = montar(waze, { sortOrder: 'newest', referencias: CASA });
  await abrir(m);
  m.AppState.filters.sortOrder = 'casa';
  m.app.reordenarFilaNaTela();
  m.AppState.filters.sortOrder = 'casa';
  m.app.reordenarFilaNaTela();
  soltar();
  await assentar(m);
  assert.deepEqual(m.log, ['card:V540'], 'as duas trocas redesenharam o card');
});

// ── R56-3: a fila inteira se decide pela ordem que VALE, não pela salva ─────────
// "Perto de casa" salva com um perfil SEM casa (tirada no WME, ou outra conta no
// aparelho), ou o GPS sem posição, ordenam por DATA — os Filtros mostram "Mais
// recentes" —, e mesmo assim toda busca lia TODAS as páginas antes do primeiro
// card: uma requisição a mais por página no free tier (MEDIDO, n1-casa: páginas
// [1,2] na abertura e no ↻, contra [1] com "Mais recentes").
function precisaDaFilaInteira({ ordem, perfil = { id: 1 }, referencias = null, gps = null }) {
  const AppState = { filters: { sortOrder: ordem }, profile: perfil };
  return new Function('AppState', 'ORDEM_PADRAO', 'ORDENS_POR_DISTANCIA',
    `let referenciasDoPerfil = ${JSON.stringify(referencias)}; let posicaoGps = ${JSON.stringify(gps)};\n`
    + ['referenciaDaOrdem', 'ordemSalvaEsperaOPerfil', 'ordemValida', 'ordemPrecisaDaFilaInteira'].map(fatiar).join('\n')
    + '\nreturn ordemPrecisaDaFilaInteira();')(AppState, constante('ORDEM_PADRAO'), constante('ORDENS_POR_DISTANCIA'));
}

test('R56-3: a ordem por distância SEM referência (a fila sai por data) não lê a fila inteira', () => {
  assert.equal(precisaDaFilaInteira({ ordem: 'casa' }), false,
    '"Perto de casa" salva com um perfil sem casa: a fila sai por data e mesmo assim a busca leria todas as páginas');
  assert.equal(precisaDaFilaInteira({ ordem: 'trabalho', referencias: { casa: [-23, -46], trabalho: null } }), false,
    '"Perto do trabalho" sem trabalho no perfil leria todas as páginas');
  assert.equal(precisaDaFilaInteira({ ordem: 'gps' }), false, 'o GPS sem posição leria todas as páginas');
});

test('R56-3: CONTROLES — com a referência, antes do perfil, e "Mais antigos" a fila inteira segue sendo lida', () => {
  assert.equal(precisaDaFilaInteira({ ordem: 'casa', referencias: { casa: [-23, -46], trabalho: null } }), true,
    'a ordem por distância COM a casa deixou de ler a fila inteira (o mais perto ficaria na página 2)');
  assert.equal(precisaDaFilaInteira({ ordem: 'gps', gps: { ll: [-23, -46] } }), true);
  // Antes do perfil, pode ser que a casa exista: a ordem salva segue valendo.
  assert.equal(precisaDaFilaInteira({ ordem: 'casa', perfil: null }), true, 'a ordem salva deixou de esperar o perfil');
  assert.equal(precisaDaFilaInteira({ ordem: 'oldest' }), true);
  assert.equal(precisaDaFilaInteira({ ordem: 'newest' }), false);
});

// ── A troca do card espera o gesto e a camada: quem atende ───────────────────
test('R24-6-A7: o fim do gesto e o fechamento de TODA camada atendem a troca do card que esperava', () => {
  assert.match(fatiar('aoFimDoGesto'), /^\s+atenderReordenacaoAdiada\(\);$/m,
    'o fim do gesto não atende a troca do card — o card segurado pelo dedo ficaria fora da ordem nova');
  assert.match(fatiar('aoFecharCamada'), /^\s+atenderReordenacaoAdiada\(\);$/m,
    'o fechamento da camada não atende a troca do card');
  // E o caminho imediato continua sendo o de sempre quando a ordem não precisa da fila inteira.
  assert.match(fatiar('reordenarFilaNaTela'), /if \(ordemPrecisaDaFilaInteira\(\) && AppState\.hasMore && reordenarEsperandoAsPaginas\(\)\) return;/,
    'o `reordenarFilaNaTela` deixou de esperar as páginas antes de trocar o card');
});

test('R24-6-A7: o "Sair" do treino, com a ordem trocada nos Filtros e páginas por vir, também espera elas antes de fixar o primeiro', () => {
  assert.match(APP_SEM, /if \(s\.ordemMudou && ordemPrecisaDaFilaInteira\(\) && !\(AppState\.hasMore && reordenarEsperandoAsPaginas\(\)\)\) buscarORestoDaFila\(\);/,
    'o `Treino.sair()` voltou a trazer o resto atrás do card, sem trocá-lo pelo mais perto da fila inteira');
});
