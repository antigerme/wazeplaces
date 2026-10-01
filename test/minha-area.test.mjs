// F5 (auditoria da fila, 2026-09-26): "Minha área" busca pela CAIXA das áreas
// do perfil — e o perfil pode não ter chegado (sinal ruim na abertura) ou não
// ter caixa nenhuma. Nos dois casos a busca saía pelo PAÍS inteiro com o filtro
// marcado na tela: "filtro que mente" (MEDIDO no navegador: `bbox: null,
// countryId: 30`, e o perfil que chegava depois não refazia a fila). Os testes
// RODAM o `fetchNextPage` e o `completarPerfilChegado` de verdade, fatiados do
// app.js. Cada um foi visto REPROVANDO com o conserto desfeito.
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
const CAIXA = [-43.3, -23.0, -43.1, -22.8];
const PERFIL_COM_AREA = { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [30], areas: [{ type: 'drive', bbox: CAIXA }] };
const PERFIL_SEM_CAIXA = { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [30], areas: [{ type: 'drive' }] };

function montar({ profile = null } = {}) {
  const log = [];
  const buscas = [];
  const AppState = {
    authenticated: true, hasMore: true, fetching: false, fetchEpoch: 0, queue: [], currentPlace: null,
    serverTotal: 0, serverBlocked: 0, blockedPartial: false, loadError: false, ultimaBusca: null, ordemPendente: false,
    filters: { unreadOnly: true, types: constante('TYPES_ALL').slice(), residential: '', myArea: true, stateId: '4',
      managedAreaId: '', categories: [], sortOrder: 'newest' },
    profile,
  };
  const deps = {
    AppState, TYPES_ALL: constante('TYPES_ALL'), PREFETCH_THRESHOLD: constante('PREFETCH_THRESHOLD'),
    MAX_EMPTY_PAGES: constante('MAX_EMPTY_PAGES'), MAX_PAGINAS_POR_BUSCA: constante('MAX_PAGINAS_POR_BUSCA'),
    navigator: { onLine: true }, Treino: { ativo: false },
    API: { getRegion: () => 'row', getCountry: () => '30',
      fetchPlaces: async (page, f) => { buscas.push({ bbox: f.bbox || null, stateId: f.stateId || null });
        return { success: true, places: [{ venueID: 'v1', updateRequestID: 'u1' }], hasMore: false, total: 1, blocked: 0 }; } },
    dfato: () => {}, dlog: () => {}, dlogVigiar: () => {}, dlogVoltou: () => {}, dlogCapturarAuto: () => {},
    handleUnauthorized: () => {}, showToast: (m) => log.push('toast:' + m), msgDoServidor: (r, d) => d, t: (k) => k,
    guardarPrazoDaSessao: () => {}, offlineGravarFila: () => {}, trackSeenCategories: () => {}, sortQueue: () => {},
    aplicarRecusaAutomatica: () => {}, aoMudarAFilaPorBaixo: () => {}, updatePendingCount: () => {}, offlineVarrer: () => {},
    bloqueadosPorPagina: new Map(), pedidosQueEntraramNaFila: new Set(), pedidosEmAndamento: new Set(), pousosDaPagina: new Map(),
    offlineLigado: () => false, offlineLerPousos: () => [], carregarFilaDeSaida: () => [], console: { error: () => {} },
    lugarAgora: () => ({ regiao: 'row', pais: '30' }), saveFilters: () => log.push('salvou'),
    refazerPerfilSeFaltar: () => log.push('pede-perfil'),
    // O que o `completarPerfilChegado` chama além do que se mede aqui.
    epocaDaSessao: 0, window: {}, paisDoPerfil: async () => null, irProPaisDoPerfil: async () => log.push('pais'),
    startFetching: () => log.push('busca'),
    // O `resetQueue` é o de VERDADE: é ele que diz que a fila nova não espera mais o perfil.
    removeUndoBanner: () => {}, offlineEsquecerFilaDeOutroLugar: () => {},
    enviarPendenciasDoLightbox: () => {},   // as escritas do lightbox na janela saem (L25)
    ORDEM_PADRAO: 'newest',
  };
  AppState.stats = { read: 0, rejected: 0, skipped: 0 };
  AppState.pendingAction = null;
  const nomes = ['chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila', 'fetchNextPage',
    'completarPerfilChegado', 'resetQueue', 'ordemDoWaze', 'ordemPrecisaDaFilaInteira'];
  for (const opcional of ['caixaDaMinhaArea', 'desligarMinhaAreaSemCaixa']) if (achar(opcional)) nomes.push(opcional);
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, 'let filaDeOnde = null; let rebuscasAuto = 0; let filaEsperaPerfil = false;\n'
    + 'let tratouNestaFila = false; let puladosNoInicioDaFila = 0;\n'
    + nomes.map(fatiar).join('\n') + '\nreturn { fetchNextPage, completarPerfilChegado, resetQueue };')(...chaves.map((k) => deps[k]));
  // A fila refeita = época nova e uma busca.
  const refez = () => AppState.fetchEpoch > 0 && log.includes('busca');
  return { app, AppState, log, buscas, refez };
}

test('F5: "Minha área" sem o perfil NÃO busca o país — espera o perfil, com a tela de falha (e sem laço)', async () => {
  const m = montar({ profile: null });
  await m.app.fetchNextPage();
  assert.deepEqual(m.buscas, [], `buscou sem a caixa da área: ${JSON.stringify(m.buscas)} — o país inteiro com "Minha área" marcado`);
  assert.equal(m.AppState.hasMore, false, 'a busca recusada deixou `hasMore`: o laço do `startFetching` giraria à toa (gotcha #19)');
  assert.equal(m.AppState.loadError, true, 'fila vazia sem a tela de falha: o painel diria "Tudo limpo!"');
});

test('F5: o perfil que CHEGA depois refaz a fila — e a busca vai pela caixa da área', async () => {
  const m = montar({ profile: null });
  await m.app.fetchNextPage();                   // recusada: o perfil não tinha chegado
  m.AppState.profile = PERFIL_COM_AREA;          // a próxima prova de rede o trouxe
  await m.app.completarPerfilChegado(PERFIL_COM_AREA, 0);
  assert.ok(m.refez(), `o perfil chegou e a fila que esperava por ele não foi refeita (${m.log.join(' ')})`);
  m.AppState.hasMore = true;
  await m.app.fetchNextPage();                   // a busca que o `startFetching` faria
  assert.deepEqual(m.buscas, [{ bbox: CAIXA, stateId: null }], 'a busca refeita não foi pela caixa da área');
});

test('F5: perfil SEM caixa utilizável — "Minha área" desliga, diz por quê, e a fila é a do país', async () => {
  const m = montar({ profile: null });
  await m.app.fetchNextPage();
  m.AppState.profile = PERFIL_SEM_CAIXA;
  await m.app.completarPerfilChegado(PERFIL_SEM_CAIXA, 0);
  assert.equal(m.AppState.filters.myArea, false, '"Minha área" segue marcado num perfil sem área: o filtro mente pra sempre');
  assert.ok(m.log.includes('salvou'), 'desligou em memória e não gravou: volta ligado na próxima abertura');
  assert.ok(m.log.includes('toast:toast.minhaAreaSemCaixa'), 'desligou calado');
  assert.ok(m.refez(), 'a fila que esperava o perfil não foi refeita');
  m.AppState.hasMore = true;
  await m.app.fetchNextPage();
  assert.deepEqual(m.buscas, [{ bbox: null, stateId: '4' }], 'a fila do país não seguiu o estado salvo');
});

test('F5: perfil JÁ na mão e sem caixa (ligou "Minha área" num perfil assim) — desliga e diz, na hora da busca', async () => {
  const m = montar({ profile: PERFIL_SEM_CAIXA });
  await m.app.fetchNextPage();
  assert.equal(m.AppState.filters.myArea, false, 'buscou o país com "Minha área" marcado');
  assert.ok(m.log.includes('toast:toast.minhaAreaSemCaixa'));
  assert.deepEqual(m.buscas, [{ bbox: null, stateId: '4' }]);
});

test('F5: CONTROLE — com a caixa, a busca vai por ela, sem refazer nada', async () => {
  const m = montar({ profile: PERFIL_COM_AREA });
  await m.app.fetchNextPage();
  assert.deepEqual(m.buscas, [{ bbox: CAIXA, stateId: null }]);
  await m.app.completarPerfilChegado(PERFIL_COM_AREA, 0);
  assert.ok(!m.refez(), 'refez a fila à toa (uma requisição a mais no free tier)');
  assert.equal(m.AppState.filters.myArea, true);
});

test('F5: a espera é da FILA — a pessoa desliga "Minha área" e aplica (fila nova); o perfil que chega depois não refaz nada', async () => {
  const m = montar({ profile: null });
  await m.app.fetchNextPage();                   // recusada: esperando o perfil
  m.AppState.filters.myArea = false;             // Filtros → desliga "Minha área" → Aplicar
  m.app.resetQueue();
  const epoca = m.AppState.fetchEpoch;
  m.log.length = 0;
  await m.app.completarPerfilChegado(PERFIL_COM_AREA, 0);
  assert.equal(m.AppState.fetchEpoch, epoca, 'o perfil refez uma fila que já não esperava por ele: joga fora o que a pessoa via');
  assert.ok(!m.log.includes('busca'));
});

test('F5: o "Tentar novamente" de quem usa "Minha área" pede o perfil de novo (com o teto de 1×/min)', () => {
  const s = fatiar('startFetching');
  assert.match(s, /if \(AppState\.filters\.myArea && !\(AppState\.profile && AppState\.profile\.areas\)\) \{\s*refazerPerfilSeFaltar\(\);/,
    'sem o perfil, o "Tentar novamente" repetia a mesma recusa: nada pedia o perfil de novo');
});
