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

function montar({ profile = null, regiao = 'row' } = {}) {
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
    API: { getRegion: () => regiao, getCountry: () => '30',
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
    removeUndoBanner: () => {},
    enviarPendenciasDoLightbox: () => {},   // as escritas do lightbox na janela saem (L25)
    ORDEM_PADRAO: 'newest',
  };
  AppState.stats = { read: 0, rejected: 0, skipped: 0 };
  AppState.pendingAction = null;
  // A fila real e o "só retoma" de VERDADE: o perfil que chega com card na fila
  // não a refaz (R13-6-01).
  const nomes = ['chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila', 'fetchNextPage',
    'completarPerfilChegado', 'refazerFilaReal', 'resetQueue', 'ordemDoWaze', 'ordemPrecisaDaFilaInteira', 'filaReal', 'retomarBusca'];
  // A caixa da área POR SERVIDOR (R9-6-04): a busca usa a do servidor dela, lida com os editáveis.
  // E o servidor nunca lido pra conta, que não cruza com o perfil guardado (R11-6-01/03), e a
  // área noutro servidor com o lugar por decidir (R11-6-02).
  // E a decisão que ficou SEM a resposta de um servidor (R12-6).
  for (const opcional of ['caixaDaMinhaArea', 'desligarMinhaAreaSemCaixa', 'esquecerAreaForaDoPerfil', 'caixaDaMinhaAreaEm',
    'anotarEditaveis', 'servidorNuncaLido', 'editaveisLidos', 'areaNoutroServidorSemDecisao', 'decisaoSemResposta',
    'minhaAreaFalhouPorRedeEm']) if (achar(opcional)) nomes.push(opcional);
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, 'let filaDeOnde = null; let rebuscasAuto = 0; let filaEsperaPerfil = false;\n'
    + 'let tratouNestaFila = false; let puladosNoInicioDaFila = 0; let decisaoDoLugarDe = null;\n'
    + 'let editaveisPorServidor = { conta: null, lidos: {}, caixas: {} };\n'
    // A espera pelo perfil (ou pela caixa) que falhou por rede (R12-4-02).
    + 'let ultimaBuscaFalhouPorRede = false; let perfilFalhouPorRede = false;\n'
    + 'let minhaAreaFalhouPorRede = { epoca: null, regioes: new Set() };\n'
    + nomes.map(fatiar).join('\n') + '\nreturn { fetchNextPage, completarPerfilChegado, resetQueue,'
    + ` anotarEditaveis: ${nomes.includes('anotarEditaveis') ? 'anotarEditaveis' : 'null'} };`)(...chaves.map((k) => deps[k]));
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

test('F5: o "Tentar de novo" de quem usa "Minha área" pede o perfil de novo (com o teto de 1×/min)', () => {
  const s = fatiar('startFetching');
  assert.match(s, /if \(AppState\.filters\.myArea && !\(AppState\.profile && AppState\.profile\.areas\)\) \{\s*refazerPerfilSeFaltar\(\);/,
    'sem o perfil, o "Tentar de novo" repetia a mesma recusa: nada pedia o perfil de novo');
});

// R9-6-04 (auditoria da rodada 9): as `areas` do `/Session` são POR SERVIDOR
// (MEDIDO no Waze real: 8 e 1 áreas na ROW, 0 na NA e na IL), e o perfil que o
// app guarda é o do servidor em que ele foi pedido. Quem só edita na NA tem o
// perfil da ROW — sem caixa — e a área no perfil da NA, que o `paisDoPerfil`
// leu (`anotarEditaveis`). A busca na NA vai pela caixa de LÁ; pelo perfil da
// ROW, "Minha área" desligava com a frase "Seu perfil do Waze não tem área de
// edição" e a fila virava a do país.
const CAIXA_NY = [-74.1, 40.6, -73.8, 40.9];
const PERFIL_ROW_SEM_AREA = { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [], areas: [] };
test('R9-6-04: a busca vai pela caixa do servidor DELA — a área lida na NA, não o perfil da ROW sem área', async () => {
  const m = montar({ profile: PERFIL_ROW_SEM_AREA, regiao: 'na' });
  assert.ok(m.app.anotarEditaveis, 'o `anotarEditaveis` sumiu do app.js');
  m.app.anotarEditaveis(PERFIL_ROW_SEM_AREA, 'row', [], []);
  m.app.anotarEditaveis(PERFIL_ROW_SEM_AREA, 'na', [235], [{ type: 'drive', bbox: CAIXA_NY }]);
  await m.app.fetchNextPage();
  assert.equal(m.AppState.filters.myArea, true, `"Minha área" desligou na NA com a área de lá lida: ${m.log}`);
  assert.ok(!m.log.includes('toast:toast.minhaAreaSemCaixa'), 'disse "não tem área de edição" a quem tem área na NA');
  assert.deepEqual(m.buscas, [{ bbox: CAIXA_NY, stateId: null }], `a busca da NA não foi pela caixa de lá: ${JSON.stringify(m.buscas)}`);
  // CONTROLE: a MESMA pessoa buscando na ROW — o servidor sem área — desliga e diz.
  // Depois de o perfil CHEGAR, como no app (a decisão do lugar roda com ele, e
  // aqui não leva a lugar nenhum): antes de ela começar, a busca espera — é o
  // R11-6-02 (ver os testes dele, mais abaixo).
  const c = montar({ profile: PERFIL_ROW_SEM_AREA, regiao: 'row' });
  c.app.anotarEditaveis(PERFIL_ROW_SEM_AREA, 'row', [], []);
  c.app.anotarEditaveis(PERFIL_ROW_SEM_AREA, 'na', [235], [{ type: 'drive', bbox: CAIXA_NY }]);
  await c.app.completarPerfilChegado(PERFIL_ROW_SEM_AREA, 0);
  await c.app.fetchNextPage();
  assert.equal(c.AppState.filters.myArea, false, 'CONTROLE: na ROW, sem área, "Minha área" seguiu ligado');
  assert.ok(c.log.includes('toast:toast.minhaAreaSemCaixa'));
  // E a área lida é DA CONTA: outra conta não a herda (cai no perfil dela).
  const o = montar({ profile: { ...PERFIL_ROW_SEM_AREA, id: 2 }, regiao: 'na' });
  o.app.anotarEditaveis(PERFIL_ROW_SEM_AREA, 'na', [235], [{ type: 'drive', bbox: CAIXA_NY }]);
  await o.app.fetchNextPage();
  assert.deepEqual([o.AppState.filters.myArea, o.buscas], [false, [{ bbox: null, stateId: '4' }]],
    'a caixa lida pra uma conta valeu pra outra');
});

// ═══ R10-6-01 e R10-6-02 · a busca de "Minha área" ESPERA o que decide a caixa ═══
// As `areas` (e os editáveis) do `/Session` são POR SERVIDOR (R9-6-04). Dois
// caminhos ainda faziam a busca decidir a caixa com o perfil de OUTRO servidor
// (auditoria da rodada 10, MEDIDO no navegador nos dois motores):
//   · R10-6-01: quem só edita na NA, com "Minha área" e o aparelho na ROW. O
//     perfil da ROW chega sem área, e o app pergunta o `/Session` da NA. Um ↻
//     (ou um "Aplicar", também pelo atalho "Filtros" do ícone) nesse meio
//     buscava JÁ: "Minha área" desligada e gravada, com a frase "Seu perfil do
//     Waze não tem área de edição", "Tudo limpo!" (`row pais 30`), e depois a
//     fila dos EUA sem o aviso do país.
//   · R10-6-02: a região aplicada À MÃO com "Minha área", num servidor que o app
//     nunca leu: a busca ia lá com a caixa do perfil de outro servidor, sem
//     perguntar o `/Session` de lá — "Tudo limpo!" com "Minha área" ligada.
// Aqui o caminho roda DE VERDADE, fatiado do app.js: o perfil que chega
// (`completarPerfilChegado` → `paisDoPerfil` → `irProPaisDoPerfil` →
// `refazerFilaReal` → `resetQueue` + `startFetching`) e a busca (`startFetching`
// → `fetchNextPage`), com a pergunta a cada servidor segura até o teste soltar,
// e cada busca anotada com a REGIÃO em que sai e a caixa (ou o país) que leva.
const CAIXA_BR = [-47, -24, -46, -23];
const AREA_NY = [{ type: 'drive', bbox: CAIXA_NY }];
const tique = (ms = 0) => new Promise((ok) => setTimeout(ok, ms));
function montarServidores({ perfis, segurar = [], regiao = 'row', pais = 30, vazias = [] }) {
  const lugar = { regiao, pais };
  const log = [];
  const buscas = [];
  const perguntas = [];
  const soltar = {};
  const AppState = {
    authenticated: true, hasMore: true, fetching: false, fetchEpoch: 0, queue: [], currentPlace: null,
    serverTotal: 0, serverBlocked: 0, blockedPartial: false, loadError: false, ultimaBusca: null,
    filters: { unreadOnly: true, types: constante('TYPES_ALL').slice(), residential: '', myArea: true, stateId: '',
      managedAreaId: '', categories: [], sortOrder: 'newest' },
    profile: null, countries: [], statesByCountry: {}, stats: { read: 0, rejected: 0, skipped: 0 }, pendingAction: null,
  };
  // O `/Session` de cada servidor: o que o teste deu; a falha que o servidor
  // RESPONDEU (o Waze fora); ou a que NEM CHEGOU (`_motivo`, como o `_post` marca).
  // E o 401 (`semSessao`): a sessão que o servidor não reconhece.
  // E a recusa do portão (`negado`): o nível ou a área mudou no Waze (R12-6).
  const resposta = (r) => (perfis[r] === 'semResposta' ? { success: false, errorCategory: 'transient', _motivo: 'TypeError' }
    : perfis[r] === 'semSessao' ? { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.sessionExpired' }
    : perfis[r] === 'negado' ? { success: false, errorCategory: 'access_denied', errorKey: 'srv.err.notAreaManager' }
    : perfis[r] ? { success: true, profile: { ...perfis[r] } } : { success: false, errorCategory: 'transient' });
  const navegador = { onLine: true };
  const API = {
    getRegion: () => lugar.regiao, setRegion: (r) => { lugar.regiao = r; },
    getCountry: () => lugar.pais, setCountry: (p) => { lugar.pais = Number(p); },
    getProfile: (r) => {
      const de = r || lugar.regiao;
      perguntas.push(de);
      if (segurar.includes(de)) return new Promise((ok) => { soltar[de] = () => ok(resposta(de)); });
      return Promise.resolve(resposta(de));
    },
    listCountries: async (r) => ({ success: true, countries: r === 'na' ? [{ id: 235, name: 'United States' }] : [{ id: 30, name: 'Brazil' }] }),
    fetchPlaces: async (page, f) => {
      buscas.push(lugar.regiao + (f.bbox ? ' bbox ' + JSON.stringify(f.bbox) : ' pais ' + lugar.pais));
      // A fila VAZIA de quem não edita naquele servidor (`vazias`, R12-6-02): o
      // filtro de permissão do servidor tira tudo.
      if (vazias.includes(lugar.regiao)) return { success: true, places: [], hasMore: false, total: 0, blocked: 0 };
      return { success: true, places: [{ venueID: 'v' + buscas.length, updateRequestID: 'u' + buscas.length }], hasMore: false, total: 1, blocked: 0 };
    },
  };
  const el = () => ({ classList: { add() {}, remove() {}, contains: () => false, toggle() {} } });
  // A conferência da sessão (`handleUnauthorized`): por padrão só anota; o teste
  // do laço do 401 (R13-6-02) a troca pelo desfecho do alarme falso.
  const ganchos = { aoConhecerConta: () => {}, handleUnauthorized: () => log.push('confere-sessao') };
  const deps = {
    AppState, API, TYPES_ALL: constante('TYPES_ALL'), PREFETCH_THRESHOLD: constante('PREFETCH_THRESHOLD'),
    MAX_EMPTY_PAGES: constante('MAX_EMPTY_PAGES'), MAX_PAGINAS_POR_BUSCA: constante('MAX_PAGINAS_POR_BUSCA'),
    REGIOES_DO_WAZE: ['row', 'na', 'il'], navigator: navegador, Treino: { ativo: false, entradas: 0 },
    document: { getElementById: () => el() },
    dfato: () => {}, dlog: () => {}, dlogVigiar: () => {}, dlogVoltou: () => {}, dlogCapturarAuto: () => {},
    handleUnauthorized: () => ganchos.handleUnauthorized(), showToast: (m) => log.push('toast:' + m), msgDoServidor: (r, d) => d,
    t: (k, v) => k + (v && v.pais ? '(' + v.pais + ')' : ''),
    guardarPrazoDaSessao: () => {}, offlineGravarFila: () => {}, trackSeenCategories: () => {}, sortQueue: () => {},
    aplicarRecusaAutomatica: () => {}, aoMudarAFilaPorBaixo: () => {}, updatePendingCount: () => {}, offlineVarrer: () => {},
    bloqueadosPorPagina: new Map(), pedidosQueEntraramNaFila: new Set(), pedidosEmAndamento: new Set(), pousosDaPagina: new Map(),
    offlineLigado: () => false, offlineLerPousos: () => [], carregarFilaDeSaida: () => [], console: { error: () => {} },
    lugarAgora: () => ({ regiao: lugar.regiao, pais: String(lugar.pais) }), saveFilters: () => log.push('salvou'),
    refazerPerfilSeFaltar: () => {}, window: {}, redesenharLugarNosFiltros: () => {}, redesenharFiltrosComOPerfil: () => {},
    removeUndoBanner: () => {}, enviarPendenciasDoLightbox: () => {}, ORDEM_PADRAO: 'newest',
    // A carga do perfil de verdade (`loadProfileAndAuxData` → `definirPerfil` →
    // `completarPerfilChegado`, R11-6-02): a conta conhecida passa por um gancho, que o
    // teste da troca de conta faz refazer a fila como o `esquecerOutraConta` (a que
    // atravessou a queda), DENTRO do `definirPerfil`.
    aoConhecerConta: (p) => ganchos.aoConhecerConta(p), contaSegueNoAparelho: () => true, handleLogout: () => log.push('saiu'),
    guardarReferencias: () => {}, guardarPerfilDoPortao: () => {}, renderProfileHeader: () => {},
    presencaWmeAoCarregarPerfil: () => {}, presencaWmeRefazerDesligar: () => {}, reavaliarFotoAbertaPeloPerfil: () => {},
    atualizarSeloDeConquista: () => {},   // o ponto de Filtros, que também lê o portão (R13-7-02)
    recusaDoPortao: () => log.push('recusa'),
    showLoading: () => {}, removeCurrentCardEl: () => {}, showCurrentPlace: () => log.push('card'), maybePrefetch: () => {},
    showNoPlaces: () => log.push('vazio'), abrirGuardadaDepoisDaFalha: async () => false,
    listasDePaisesNoAr: new Map(), listasDePaisesGuardadas: new Map(), geracaoDasListasDePaises: 0,
    // As funções do conserto: no código de antes elas não existem, e o teste tem
    // de reprovar pelo COMPORTAMENTO, não por não achá-las (as de verdade, quando
    // existem, vencem estas).
    lerServidorDaMinhaArea: () => null, areasGerenciadasLidas: () => null,
    decisaoSemResposta: () => null, refazerDecisaoSemResposta: () => null,
    // A recomposição do alarme falso e o teto dela (R13-6-02); e o teto da espera
    // pelo perfil da fila vazia (R13-6-04), quando existe.
    MAX_REBUSCAS_AUTO: constante('MAX_REBUSCAS_AUTO'),
    ...(/^const FILA_VAZIA_ESPERA_PERFIL_MS = /m.test(APP_SEM) ? { FILA_VAZIA_ESPERA_PERFIL_MS: constante('FILA_VAZIA_ESPERA_PERFIL_MS') } : {}),
  };
  const nomes = ['chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila', 'fetchNextPage',
    'startFetching', 'completarPerfilChegado', 'paisDoPerfil', 'irProPaisDoPerfil', 'refazerFilaReal', 'resetQueue',
    'filaReal', 'retomarBusca', 'rebuscarDepoisDeFalha',
    'ordemDoWaze', 'ordemPrecisaDaFilaInteira', 'caixaDaMinhaArea', 'desligarMinhaAreaSemCaixa', 'esquecerAreaForaDoPerfil',
    'caixaDaMinhaAreaEm', 'anotarEditaveis', 'editaveisLidos', 'pedirListaDePaises', 'loadProfileAndAuxData', 'definirPerfil'];
  for (const opcional of ['lerServidorDaMinhaArea', 'areasGerenciadasLidas', 'servidorNuncaLido', 'areaNoutroServidorSemDecisao',
    'decisaoSemResposta', 'refazerDecisaoSemResposta', 'minhaAreaFalhouPorRedeEm'])
    if (achar(opcional)) nomes.push(opcional);
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, 'let filaDeOnde = null; let rebuscasAuto = 0; let filaEsperaPerfil = false;\n'
    + 'let tratouNestaFila = false; let puladosNoInicioDaFila = 0; let recusaAutomaticaNestaFila = false;\n'
    + 'let filaAtravessouSessao = false; let ultimaBuscaFalhouPorRede = false; let buscaSemResposta = false;\n'
    + 'let buscaEsperaOPerfil = false; let epocaDaSessao = 0; let lugarDoPedidoDoPerfil = null; let decisaoDoLugarDe = null;\n'
    + 'let perfilPedidoEm = 0; let cargasDoPerfil = 0;\n'
    // A espera pelo perfil (ou pela caixa) que falhou por rede (R12-4-02).
    + 'let perfilFalhouPorRede = false; let minhaAreaFalhouPorRede = { epoca: null, regioes: new Set() };\n'
    + 'let editaveisPorServidor = { conta: null, lidos: {}, caixas: {}, gerenciadas: {} };\n'
    + 'let leiturasDaMinhaArea = { epoca: null, noAr: new Map(), feitas: new Set() };\n'
    + nomes.map(fatiar).join('\n')
    + '\nreturn { startFetching, resetQueue, completarPerfilChegado, anotarEditaveis, editaveisLidos, loadProfileAndAuxData, fetchNextPage,\n'
    + '  rebuscarDepoisDeFalha, filaEsperaPerfil: () => filaEsperaPerfil,\n'
    + '  pendencia: () => (decisaoDoLugarDe && decisaoDoLugarDe.semResposta) || null,\n'
    + '  registrarPedidoDoPerfil: (l) => { lugarDoPedidoDoPerfil = l; }, novaSessao: () => { epocaDaSessao++; } };')(...chaves.map((k) => deps[k]));
  // O perfil que CHEGA, como a carga da abertura o entrega (`loadProfileAndAuxData`):
  // pedido na região de agora, anotado ali, guardado, e completado — a decisão do
  // lugar fica no ar enquanto ela pergunta aos outros servidores.
  const chegaOPerfil = () => {
    const perfil = { ...perfis[lugar.regiao] };
    app.registrarPedidoDoPerfil({ regiao: lugar.regiao, pais: lugar.pais });
    app.anotarEditaveis(perfil, lugar.regiao, perfil.editableCountryIDs, perfil.areas, perfil.managedAreas);
    AppState.profile = perfil;
    return app.completarPerfilChegado(perfil, 0);
  };
  // O ↻ (e o "Aplicar" sem mexer, e o "Aplicar" pelo atalho): fila nova, e a busca.
  const atualizar = () => { app.resetQueue(); return app.startFetching(); };
  // "Aplicar" com outra REGIÃO (e o país dela) nos Filtros.
  const aplicarRegiao = (r, p) => { lugar.regiao = r; lugar.pais = p; return atualizar(); };
  const avisos = () => log.filter((l) => l.startsWith('toast:'));
  return { app, AppState, lugar, log, buscas, perguntas, soltar, chegaOPerfil, atualizar, aplicarRegiao, avisos, navegador, ganchos };
}
const SO_NA = {
  row: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [], areas: [], managedAreas: [] },
  na: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [235], areas: AREA_NY, managedAreas: [] },
  il: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [], areas: [], managedAreas: [] },
};

test('R10-6-01: o ↻ (ou o "Aplicar") com o app perguntando ao servidor da área ESPERA — uma busca só, lá, com a caixa de lá, e "Minha área" fica', async () => {
  // CONTROLE: sem o ↻ no meio, a decisão leva a fila pra NA pela caixa de lá — o
  // instrumento enxerga a busca que a decisão faz.
  const c = montarServidores({ perfis: SO_NA, segurar: ['na'] });
  const cDecisao = c.chegaOPerfil();
  await tique();
  assert.ok(c.soltar.na, 'PRÉ-CONDIÇÃO: o `/Session` da NA não ficou no ar');
  c.soltar.na();
  await cDecisao;
  await tique(5);
  assert.deepEqual(c.buscas, ['na bbox ' + JSON.stringify(CAIXA_NY)], `CONTROLE: a decisão não buscou na NA pela caixa de lá: ${c.buscas}`);
  // O ↻ no meio da pergunta à NA.
  const m = montarServidores({ perfis: SO_NA, segurar: ['na'] });
  const decisao = m.chegaOPerfil();
  await tique();
  assert.ok(m.soltar.na, 'PRÉ-CONDIÇÃO: o `/Session` da NA não ficou no ar');
  const doToque = m.atualizar();
  await tique(5);
  assert.deepEqual(m.buscas, [], `o ↻ buscou com a pergunta à NA no ar (${m.buscas}): o "Tudo limpo!" do servidor errado`);
  assert.equal(m.AppState.filters.myArea, true, `"Minha área" foi desligada antes de a NA responder: ${m.avisos()}`);
  m.soltar.na();
  await decisao;
  await doToque;
  await tique(5);
  assert.deepEqual([m.lugar.regiao, m.lugar.pais], ['na', 235], 'PRÉ-CONDIÇÃO: a decisão não levou a fila pra NA');
  assert.deepEqual(m.buscas, ['na bbox ' + JSON.stringify(CAIXA_NY)],
    `a fila saiu ${m.buscas.length} vezes (${m.buscas}) — o ↻ buscou antes de a caixa estar decidida`);
  assert.equal(m.AppState.filters.myArea, true, '"Minha área" foi desligada a quem tem área na NA');
  assert.deepEqual(m.avisos(), [], `o app disse o que não é verdade: ${m.avisos()}`);
});

test('R10-6-01: CONTROLE — sem área em servidor NENHUM, a busca do ↻ sai depois da decisão, e "Minha área" desliga e diz', async () => {
  const semArea = { row: SO_NA.row, na: { ...SO_NA.na, editableCountryIDs: [], areas: [] }, il: SO_NA.il };
  const m = montarServidores({ perfis: semArea, segurar: ['na', 'il'] });
  const decisao = m.chegaOPerfil();
  await tique();
  const doToque = m.atualizar();
  await tique(5);
  assert.deepEqual(m.buscas, [], `o ↻ buscou antes de a decisão terminar: ${m.buscas} (o R10-6-01)`);
  m.soltar.na();
  await tique(5);
  assert.ok(m.soltar.il, 'PRÉ-CONDIÇÃO: o `/Session` de Israel não foi perguntado');
  m.soltar.il();
  await decisao;
  await doToque;
  await tique(5);
  assert.deepEqual(m.buscas, ['row pais 30'], `a espera engoliu a busca (ou ela saiu em dobro): ${m.buscas}`);
  assert.equal(m.AppState.filters.myArea, false, '"Minha área" ficou ligada sem área em servidor nenhum: o filtro mente');
  assert.deepEqual(m.avisos(), ['toast:toast.minhaAreaSemCaixa'], `o desligar não foi dito (uma vez): ${m.avisos()}`);
});

test('R10-6-02: a região aplicada À MÃO com "Minha área" — o `/Session` de lá é perguntado UMA vez, antes de a busca decidir a caixa', async () => {
  const perfis = {
    row: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [30], areas: [{ type: 'drive', bbox: CAIXA_BR }], managedAreas: [] },
    na: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [235], areas: AREA_NY, managedAreas: [] },
  };
  const m = montarServidores({ perfis });
  await m.chegaOPerfil();
  await m.atualizar();
  // CONTROLE: sem gesto (a abertura, o ↻ na região do perfil), nenhum `/Session` a mais.
  assert.deepEqual([m.perguntas, m.buscas], [[], ['row bbox ' + JSON.stringify(CAIXA_BR)]],
    'CONTROLE: a busca da região em que o perfil foi lido perguntou a outro servidor (ou não foi pela caixa de lá)');
  // A pessoa aplica a NA nos Filtros.
  await m.aplicarRegiao('na', 235);
  assert.deepEqual(m.perguntas, ['na'], `o \`/Session\` da NA não foi perguntado antes da busca: ${m.perguntas}`);
  assert.equal(m.buscas.at(-1), 'na bbox ' + JSON.stringify(CAIXA_NY),
    `a busca da NA foi com a caixa do perfil de outro servidor: ${m.buscas.at(-1)} — o "Tudo limpo!" com "Minha área" ligada`);
  assert.equal(m.AppState.filters.myArea, true);
  // Uma ida por servidor e por sessão: o ↻ seguinte não pergunta de novo.
  await m.atualizar();
  assert.deepEqual(m.perguntas, ['na'], `o ↻ seguinte perguntou à NA de novo: ${m.perguntas}`);
  assert.equal(m.buscas.at(-1), 'na bbox ' + JSON.stringify(CAIXA_NY));
});

test('R10-6-02: sem área no servidor aplicado, "Minha área" desliga e diz — e a fila é a do país (o caminho de quem já tinha lido lá)', async () => {
  const perfis = {
    row: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [30], areas: [{ type: 'drive', bbox: CAIXA_BR }], managedAreas: [] },
    na: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [], areas: [], managedAreas: [] },
  };
  const m = montarServidores({ perfis });
  await m.chegaOPerfil();
  await m.aplicarRegiao('na', 235);
  assert.deepEqual(m.perguntas, ['na'], `o \`/Session\` da NA não foi perguntado: ${m.perguntas}`);
  assert.deepEqual(m.buscas, ['na pais 235'], `a busca da NA não foi a do país: ${m.buscas}`);
  assert.equal(m.AppState.filters.myArea, false, '"Minha área" ficou ligada num servidor sem área: "Tudo limpo!" com o filtro mentindo');
  assert.deepEqual(m.avisos(), ['toast:toast.minhaAreaSemCaixa']);
});

// R11-6-01 (auditoria da rodada 11): a pergunta que o servidor respondeu com
// FALHA (o Waze fora: o 500 `transient` do core; a página de erro da borda) valia
// pela ida da sessão inteira, e a busca ia ao servidor aplicado com a caixa do
// perfil de OUTRO servidor — "Tudo limpo! … Confira o país e a região" com
// "Minha área" ligada, e nem o ↻ perguntava de novo (MEDIDO no navegador, nos dois
// motores). Este teste era o do R10-6-02 que fixava esse contrato ("a que falhou
// não sai de novo até a sessão mudar"; "a que falhou deixa a caixa do perfil que
// o app tem") — o defeito escrito como regra. Agora: a ida no ar segue dividida,
// a que FALHOU não vale (a busca ESPERA, com a tela de falha, sem a caixa de
// outro servidor), o próximo GESTO pergunta de novo, e a que LEU não sai mais.
test('R11-6-01: a ida no ar é dividida; a que o servidor respondeu com FALHA não vale — a busca espera, sem a caixa de outro servidor, e o próximo gesto pergunta de novo', async () => {
  const perfis = { row: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [30], areas: [{ type: 'drive', bbox: CAIXA_BR }], managedAreas: [] } };
  // O servidor responde com falha (o Waze fora): `perfis.na` não existe.
  const m = montarServidores({ perfis, segurar: ['na'] });
  await m.chegaOPerfil();
  m.lugar.regiao = 'na';
  m.lugar.pais = 235;
  const primeira = m.atualizar();
  await tique();
  const segunda = m.atualizar();                 // outro ↻ com a pergunta no ar
  await tique();
  assert.deepEqual(m.perguntas, ['na'], `duas buscas com a pergunta no ar perguntaram ${m.perguntas.length} vezes`);
  m.soltar.na();
  await primeira;
  await segunda;
  await tique(5);
  assert.deepEqual(m.buscas, [],
    `com a pergunta à NA falhando, a busca saiu com a caixa do perfil de OUTRO servidor: ${m.buscas} — o "Tudo limpo!" com "Minha área" ligada`);
  assert.equal(m.AppState.loadError, true, 'a busca que espera não pediu a tela de falha (com "Tentar de novo"): o painel diria "Tudo limpo!"');
  assert.equal(m.AppState.filters.myArea, true, `"Minha área" desligou sem saber se há área na NA: ${m.avisos()}`);
  // O gesto seguinte (o "Tentar de novo", o ↻) pergunta de novo — e, com a NA
  // respondendo, a busca vai pela caixa de lá.
  perfis.na = { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [235], areas: AREA_NY, managedAreas: [] };
  const terceira = m.atualizar();
  await tique();
  assert.deepEqual(m.perguntas, ['na', 'na'], `o gesto depois da falha não perguntou de novo: a falha valeu pela ida (${m.perguntas})`);
  m.soltar.na();
  await terceira;
  await tique(5);
  assert.deepEqual(m.buscas, ['na bbox ' + JSON.stringify(CAIXA_NY)], `a busca do gesto não foi pela caixa da NA: ${m.buscas}`);
  // A que LEU não sai de novo: nenhum pedido a mais no free tier.
  await m.atualizar();
  assert.deepEqual(m.perguntas, ['na', 'na'], `a NA que respondeu foi perguntada de novo: ${m.perguntas}`);
  assert.equal(m.buscas.at(-1), 'na bbox ' + JSON.stringify(CAIXA_NY));
});

test('R11-6-01: a pergunta que NEM CHEGOU (`_motivo`) — a MESMA busca não sai com a caixa de outro servidor: espera, com a tela de falha', async () => {
  const perfis = {
    row: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [30], areas: [{ type: 'drive', bbox: CAIXA_BR }], managedAreas: [] },
    na: 'semResposta',
  };
  const m = montarServidores({ perfis });
  await m.chegaOPerfil();
  assert.deepEqual(m.buscas, [], 'PRÉ-CONDIÇÃO: o perfil buscou sozinho');
  await m.aplicarRegiao('na', 235);
  assert.deepEqual(m.perguntas, ['na'], `PRÉ-CONDIÇÃO: a NA não foi perguntada (uma vez): ${m.perguntas}`);
  assert.deepEqual(m.buscas, [],
    `a MESMA busca saiu com a caixa do Brasil na NA: ${m.buscas} — o "Tudo limpo! … Confira o país e a região" até o próximo gesto`);
  assert.deepEqual([m.AppState.loadError, m.AppState.filters.myArea], [true, true],
    'a busca que espera a caixa não pediu a tela de falha, ou desligou "Minha área"');
  assert.ok(!m.log.includes('confere-sessao'), 'a pergunta que nem chegou foi tratada como sessão caída');
});

test('R11-6-01: a pergunta ao servidor aplicado que leva 401 vai pra conferência da sessão — com a busca esperando, ninguém mais a veria', async () => {
  const perfis = {
    row: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [30], areas: [{ type: 'drive', bbox: CAIXA_BR }], managedAreas: [] },
    na: 'semSessao',
  };
  const m = montarServidores({ perfis });
  await m.chegaOPerfil();
  await m.aplicarRegiao('na', 235);
  await tique(5);
  assert.deepEqual(m.perguntas, ['na'], `PRÉ-CONDIÇÃO: a NA não foi perguntada: ${m.perguntas}`);
  assert.deepEqual(m.buscas, [], `com o 401 na pergunta, a busca saiu com a caixa de outro servidor: ${m.buscas}`);
  assert.equal(m.log.filter((l) => l === 'confere-sessao').length, 1,
    'o 401 da pergunta não foi conferido: com a sessão morta, a tela ficaria em "Falha ao carregar" a cada "Tentar de novo"');
});

test('R10-6-02: o servidor que a decisão do perfil JÁ leu não é perguntado de novo — a pessoa aplicou a NA enquanto o app a perguntava', async () => {
  const m = montarServidores({ perfis: SO_NA, segurar: ['na'] });
  const decisao = m.chegaOPerfil();
  await tique();
  assert.ok(m.soltar.na, 'PRÉ-CONDIÇÃO: o `/Session` da NA não ficou no ar');
  const doAplicar = m.aplicarRegiao('na', 235);   // Filtros › NA › Aplicar, com a pergunta no ar
  await tique(5);
  m.soltar.na();
  await decisao;
  await doAplicar;
  await tique(5);
  assert.deepEqual(m.perguntas, ['na'],
    `o \`/Session\` da NA saiu ${m.perguntas.filter((r) => r === 'na').length} vezes: a resposta da decisão foi jogada fora porque o lugar mudou no meio`);
  assert.deepEqual(m.buscas, ['na bbox ' + JSON.stringify(CAIXA_NY)], `a busca do "Aplicar" não foi pela caixa da NA: ${m.buscas}`);
  assert.equal(m.AppState.filters.myArea, true);
});

test('R10-6-01: "Minha área" mudada num "Aplicar" no meio da pergunta ao servidor da área — o aviso do país diz o que a fila é', async () => {
  // Desligada: a fila vai pros EUA pelo país — com o aviso "Mostrando a fila de…".
  const off = montarServidores({ perfis: SO_NA, segurar: ['na'] });
  const decisaoOff = off.chegaOPerfil();
  await tique();
  assert.ok(off.soltar.na, 'PRÉ-CONDIÇÃO: o `/Session` da NA não ficou no ar');
  off.AppState.filters.myArea = false;               // Filtros › desmarca "Minha área" › Aplicar
  const aplicouOff = off.atualizar();
  await tique(5);
  off.soltar.na();
  await decisaoOff;
  await aplicouOff;
  await tique(5);
  assert.deepEqual([off.lugar.regiao, off.lugar.pais], ['na', 235], 'PRÉ-CONDIÇÃO: a decisão não levou a fila pros EUA');
  assert.equal(off.buscas.at(-1), 'na pais 235', `PRÉ-CONDIÇÃO: a fila dos EUA não foi a do país: ${off.buscas}`);
  assert.ok(off.avisos().includes('toast:toast.paisDoPerfil(United States)'),
    `a fila foi pros EUA pelo país sem o aviso "Mostrando a fila de…": ${off.avisos()}`);
  // Ligada: a fila é a da área, na NA — sem o aviso do país, que diria o que ela não é.
  const on = montarServidores({ perfis: SO_NA, segurar: ['na'] });
  on.AppState.filters.myArea = false;
  const decisaoOn = on.chegaOPerfil();
  await tique();
  on.AppState.filters.myArea = true;                 // Filtros › marca "Minha área" › Aplicar
  const aplicouOn = on.atualizar();
  await tique(5);
  on.soltar.na();
  await decisaoOn;
  await aplicouOn;
  await tique(5);
  assert.equal(on.buscas.at(-1), 'na bbox ' + JSON.stringify(CAIXA_NY), `PRÉ-CONDIÇÃO: a fila da NA não foi a da área: ${on.buscas}`);
  assert.ok(!on.avisos().some((a) => a.includes('toast.paisDoPerfil')),
    `o aviso "Mostrando a fila de…" saiu sobre a fila da ÁREA: ${on.avisos()}`);
});

test('R10-6-02: sem rede a pergunta nem sai, e a que NEM CHEGOU não conta — com a rede de volta, a busca pergunta (uma vez por busca)', async () => {
  const perfis = {
    row: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [30], areas: [{ type: 'drive', bbox: CAIXA_BR }], managedAreas: [] },
    na: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [235], areas: AREA_NY, managedAreas: [] },
  };
  const m = montarServidores({ perfis });
  await m.chegaOPerfil();
  // A pessoa aplica a NA num túnel: nada sai (a busca também não).
  m.navegador.onLine = false;
  await m.aplicarRegiao('na', 235);
  assert.deepEqual([m.perguntas, m.buscas], [[], []], `sem rede, a pergunta à NA saiu: ${m.perguntas} · ${m.buscas}`);
  // A rede volta (o `online`, o "Tentar de novo"): a busca pergunta à NA e vai pela caixa de lá.
  m.navegador.onLine = true;
  await m.atualizar();
  assert.deepEqual(m.perguntas, ['na'], `com a rede de volta, a NA não foi perguntada: ${m.perguntas}`);
  assert.deepEqual(m.buscas, ['na bbox ' + JSON.stringify(CAIXA_NY)],
    `com a rede de volta, a busca foi com a caixa de outro servidor: ${m.buscas} — o "Tudo limpo!" com "Minha área" ligada`);
  // A resposta que NEM CHEGOU (a rede caiu no meio, o teto de 45 s) também não conta,
  // e na MESMA busca não se repete.
  const daNa = { ...perfis, na: 'semResposta' };
  const q = montarServidores({ perfis: daNa });
  await q.chegaOPerfil();
  await q.aplicarRegiao('na', 235);
  assert.deepEqual(q.perguntas, ['na'], `a pergunta sem resposta se repetiu na mesma busca: ${q.perguntas}`);
  daNa.na = perfis.na;                               // a rede volta de verdade
  await q.atualizar();
  assert.deepEqual(q.perguntas, ['na', 'na'], `a pergunta sem resposta valeu pela ida da NA: ${q.perguntas}`);
  assert.equal(q.buscas.at(-1), 'na bbox ' + JSON.stringify(CAIXA_NY), `a busca seguinte não foi pela caixa da NA: ${q.buscas}`);
  await q.atualizar();
  assert.deepEqual(q.perguntas, ['na', 'na'], `a NA respondida foi perguntada de novo: ${q.perguntas}`);
});

// ═══ R11-6-02 · a busca de "Minha área" espera a decisão do lugar que nem começou ═══
// (auditoria da rodada 11; incompleto do R10-6-01). A conta A (edita na ROW, área
// no Brasil, "Minha área" ligada) tria; a sessão cai e a extensão renova com a
// sessão da conta B, que só edita na NA. O perfil da ROW de B revela a troca DENTRO
// do `definirPerfil` (`aoConhecerConta` → `esquecerOutraConta`), e a fila que
// atravessou a queda é refeita ALI — antes de o `completarPerfilChegado` começar a
// decisão do lugar. A busca saía na ROW com o perfil de B sem área: "Minha área"
// desligada e gravada com "Seu perfil do Waze não tem área de edição…" (a frase
// falsa), "Tudo limpo!", e só depois a fila ia pros EUA pelo país, com o aviso
// dele (MEDIDO no navegador nos dois motores, `row pais 30` → `na pais 235`). Aqui
// a carga do perfil roda DE VERDADE (`loadProfileAndAuxData` → `definirPerfil` →
// `completarPerfilChegado`), com a troca refazendo a fila no gancho da conta.
const SO_NA_B = {
  row: { id: 222, rank: 5, isAreaManager: true, editableCountryIDs: [], areas: [], managedAreas: [] },
  na: { id: 222, rank: 5, isAreaManager: true, editableCountryIDs: [235], areas: AREA_NY, managedAreas: [] },
  il: { id: 222, rank: 5, isAreaManager: true, editableCountryIDs: [], areas: [], managedAreas: [] },
};
test('R11-6-02: a troca de conta refaz a fila DENTRO do `definirPerfil` — a busca espera a decisão do lugar: uma só, na NA pela caixa de lá, sem a frase falsa', async () => {
  // CONTROLE: sem a troca refazendo a fila no meio, a decisão leva a fila pra NA
  // pela caixa de lá — o instrumento enxerga a busca que a decisão faz.
  const c = montarServidores({ perfis: SO_NA_B, segurar: ['na'] });
  const cCarga = c.app.loadProfileAndAuxData();
  await tique(5);
  assert.ok(c.soltar.na, 'PRÉ-CONDIÇÃO: a decisão do lugar não perguntou à NA');
  c.soltar.na();
  await cCarga;
  await tique(10);
  assert.deepEqual(c.buscas, ['na bbox ' + JSON.stringify(CAIXA_NY)], `CONTROLE: a decisão não buscou na NA pela caixa de lá: ${c.buscas}`);
  // A troca: o perfil de B revela outra conta, e a fila que atravessou a queda é
  // refeita no `definirPerfil` (o `esquecerOutraConta`).
  const m = montarServidores({ perfis: SO_NA_B, segurar: ['na'] });
  m.ganchos.aoConhecerConta = () => { m.app.resetQueue(); m.app.startFetching(); };
  const carga = m.app.loadProfileAndAuxData();
  await tique(5);
  assert.ok(m.soltar.na, 'PRÉ-CONDIÇÃO: a decisão do lugar não perguntou à NA');
  assert.deepEqual(m.buscas, [],
    `a fila refeita pela troca de conta buscou antes da decisão do lugar: ${m.buscas} — "Minha área" desligada com a frase falsa, e "Tudo limpo!"`);
  assert.equal(m.AppState.filters.myArea, true, `"Minha área" desligou antes de a NA responder: ${m.avisos()}`);
  assert.ok(!m.log.includes('vazio'), 'a busca que espera a decisão mostrou a tela de fila vazia (ou de falha) no meio');
  m.soltar.na();
  await carga;
  await tique(10);
  assert.deepEqual([m.lugar.regiao, m.lugar.pais], ['na', 235], 'PRÉ-CONDIÇÃO: a decisão não levou a fila pra NA');
  assert.deepEqual(m.buscas, ['na bbox ' + JSON.stringify(CAIXA_NY)],
    `a fila saiu ${m.buscas.length} vezes (${m.buscas}) — a da troca de conta foi antes da decisão`);
  assert.equal(m.AppState.filters.myArea, true, '"Minha área" foi desligada a quem tem área na NA');
  assert.deepEqual(m.avisos(), [], `o app disse o que não é verdade: ${m.avisos()}`);
  assert.ok(m.log.includes('card') && !m.log.includes('vazio'), `a tela não foi do esqueleto direto pro card: ${m.log}`);
});

test('R11-6-02: a busca chamada DIRETO com a decisão no ar (o `maybePrefetch`) espera, e a decisão a refaz; decidido o lugar, a região sem área aplicada à mão desliga e diz — nada espera pra sempre', async () => {
  const m = montarServidores({ perfis: SO_NA, segurar: ['na'] });
  const decisao = m.chegaOPerfil();
  await tique();
  assert.ok(m.soltar.na, 'PRÉ-CONDIÇÃO: o `/Session` da NA não ficou no ar');
  await m.app.fetchNextPage();                  // o `maybePrefetch` (ou qualquer chamada direta)
  assert.deepEqual(m.buscas, [], `a busca direta saiu com a decisão do lugar no ar: ${m.buscas}`);
  assert.equal(m.AppState.filters.myArea, true, `"Minha área" desligou com a decisão no ar: ${m.avisos()}`);
  m.soltar.na();
  await decisao;
  await tique(10);
  assert.deepEqual(m.buscas, ['na bbox ' + JSON.stringify(CAIXA_NY)], `a decisão não refez a fila que esperou por ela: ${m.buscas}`);
  // Decidido o lugar, a pessoa aplica à mão a ROW, onde não edita: "Minha área"
  // desliga e diz, e a fila é a do país (o caminho de sempre, R10-6-02).
  await m.aplicarRegiao('row', 30);
  assert.equal(m.buscas.at(-1), 'row pais 30', `a região aplicada à mão sem área ficou esperando (ou buscou com outra caixa): ${m.buscas}`);
  assert.equal(m.AppState.filters.myArea, false);
  assert.ok(m.avisos().includes('toast:toast.minhaAreaSemCaixa'), `o desligar não foi dito: ${m.avisos()}`);
});

test('R11-6-02: sem destino (área em servidor nenhum), a busca que esperou a decisão é refeita por ela — e aí "Minha área" desliga e diz', async () => {
  const semArea = { row: SO_NA_B.row, na: { ...SO_NA_B.na, editableCountryIDs: [], areas: [] }, il: SO_NA_B.il };
  const m = montarServidores({ perfis: semArea, segurar: ['na', 'il'] });
  m.ganchos.aoConhecerConta = () => { m.app.resetQueue(); m.app.startFetching(); };
  const carga = m.app.loadProfileAndAuxData();
  await tique(5);
  assert.deepEqual(m.buscas, [], `a fila refeita pela troca de conta buscou antes da decisão: ${m.buscas}`);
  m.soltar.na();
  await tique(5);
  assert.ok(m.soltar.il, 'PRÉ-CONDIÇÃO: a decisão não perguntou a Israel');
  m.soltar.il();
  await carga;
  await tique(10);
  assert.deepEqual(m.buscas, ['row pais 30'],
    `a busca que esperou a decisão não foi refeita por ela (ou saiu em dobro): ${m.buscas} — a tela ficaria em "Falha ao carregar"`);
  assert.equal(m.AppState.filters.myArea, false, '"Minha área" ficou ligada sem área em servidor nenhum: o filtro mente');
  assert.deepEqual(m.avisos(), ['toast:toast.minhaAreaSemCaixa'], `o desligar não foi dito (uma vez): ${m.avisos()}`);
  assert.ok(!m.log.includes('vazio'), `a tela de falha apareceu no meio: ${m.log}`);
});

test('R11-6-02: a busca chamada DIRETO no meio de uma decisão SEM destino também é refeita por ela — sem isso, ficava esperando', async () => {
  const semArea = { row: SO_NA.row, na: { ...SO_NA.na, editableCountryIDs: [], areas: [] }, il: SO_NA.il };
  const m = montarServidores({ perfis: semArea, segurar: ['na', 'il'] });
  const decisao = m.chegaOPerfil();
  await tique();
  assert.ok(m.soltar.na, 'PRÉ-CONDIÇÃO: o `/Session` da NA não ficou no ar');
  await m.app.fetchNextPage();                  // o `maybePrefetch`, no meio da decisão
  assert.deepEqual(m.buscas, [], `a busca direta saiu com a decisão do lugar no ar: ${m.buscas}`);
  m.soltar.na();
  await tique(5);
  assert.ok(m.soltar.il, 'PRÉ-CONDIÇÃO: a decisão não perguntou a Israel');
  m.soltar.il();
  await decisao;
  await tique(10);
  assert.deepEqual(m.buscas, ['row pais 30'], `a busca que esperou a decisão sem destino não foi refeita: ${m.buscas}`);
  assert.equal(m.AppState.filters.myArea, false);
  assert.deepEqual(m.avisos(), ['toast:toast.minhaAreaSemCaixa']);
});

// ═══ R12-6-02 · a fila que volta VAZIA com o lugar por decidir ESPERA ═══════
// (auditoria da rodada 12, pré-existente). Na primeira abertura (e depois de
// todo "Sair") o aparelho está no Brasil (`row/30`). Pra quem só edita na NA (ou
// em Israel), SEM "Minha área", a busca de lá volta vazia enquanto o perfil
// pergunta aos outros servidores — e a tela dizia "Tudo limpo! … Confira o país
// e a região", anunciado ao leitor de tela, até a decisão levar a pessoa pra
// fila dela (MEDIDO no navegador, nos dois motores: 1,3 s; 2,1 s com a busca
// voltando antes do perfil). A espera do fim do `startFetching` pela decisão só
// valia com "Minha área" (`filaEsperaPerfil`). Só a busca que RESPONDEU espera: a
// que falhou tem a tela dela, e no lie-fi o perfil pendura junto (ver o
// test/offline-varredura). Aqui a busca, a carga do perfil e a decisão rodam DE
// VERDADE, com a fila do Brasil vazia (o filtro de permissão).
test('R12-6-02: sem "Minha área", a fila do Brasil que volta vazia com a decisão no ar NÃO diz "Tudo limpo!" — espera, e a fila dos EUA é a que aparece', async () => {
  const m = montarServidores({ perfis: SO_NA, segurar: ['na'], vazias: ['row'] });
  m.AppState.filters.myArea = false;
  const decisao = m.chegaOPerfil();              // o perfil da ROW chegou e pergunta à NA
  await tique();
  assert.ok(m.soltar.na, 'PRÉ-CONDIÇÃO: a decisão do lugar não perguntou à NA');
  const abertura = m.app.startFetching();        // a busca da abertura, no Brasil
  await tique(5);
  assert.deepEqual(m.buscas, ['row pais 30'], `PRÉ-CONDIÇÃO: a busca do Brasil não saiu (uma vez): ${m.buscas}`);
  assert.ok(!m.log.includes('vazio'),
    'com a decisão do lugar no ar, a fila vazia do Brasil virou "Tudo limpo! … Confira o país e a região" (e o leitor de tela o anuncia)');
  m.soltar.na();
  await decisao;
  await abertura;
  await tique(10);
  assert.deepEqual([m.lugar.regiao, m.lugar.pais], ['na', 235], 'PRÉ-CONDIÇÃO: a decisão não levou a fila pros EUA');
  assert.deepEqual(m.buscas, ['row pais 30', 'na pais 235'], `as buscas: ${m.buscas}`);
  assert.ok(m.log.includes('card') && !m.log.includes('vazio'), `a tela não foi do esqueleto direto pro card: ${m.log}`);
  assert.ok(m.avisos().includes('toast:toast.paisDoPerfil(United States)'), `a fila dos EUA entrou sem o aviso: ${m.avisos()}`);
});

test('R12-6-02: a busca que volta ANTES do perfil espera ele (e a decisão que ele traz) — sem "Tudo limpo!" no meio', async () => {
  const m = montarServidores({ perfis: SO_NA, segurar: ['row', 'na'], vazias: ['row'] });
  m.AppState.filters.myArea = false;
  // A abertura: a carga do perfil e a busca saem juntas (o `initApp`).
  m.AppState._profilePromise = m.app.loadProfileAndAuxData();
  const abertura = m.app.startFetching();
  await tique(5);
  assert.ok(m.soltar.row, 'PRÉ-CONDIÇÃO: o perfil da ROW não ficou no ar');
  assert.deepEqual(m.buscas, ['row pais 30'], `PRÉ-CONDIÇÃO: a busca do Brasil não saiu antes do perfil: ${m.buscas}`);
  assert.ok(!m.log.includes('vazio'), 'a busca que voltou antes do perfil disse "Tudo limpo!" sem saber onde a pessoa edita');
  m.soltar.row();
  await tique(5);
  assert.ok(m.soltar.na, 'PRÉ-CONDIÇÃO: a decisão do lugar não perguntou à NA');
  assert.ok(!m.log.includes('vazio'), 'com o perfil na mão e a decisão no ar, "Tudo limpo!" apareceu');
  m.soltar.na();
  await m.AppState._profilePromise;
  await abertura;
  await tique(10);
  assert.deepEqual([m.lugar.regiao, m.lugar.pais], ['na', 235], 'PRÉ-CONDIÇÃO: a decisão não levou a fila pros EUA');
  assert.ok(m.log.includes('card') && !m.log.includes('vazio'), `a tela não foi do esqueleto direto pro card: ${m.log}`);
});

test('R12-6-02: CONTROLES — quem edita no Brasil: a fila com pedido aparece SEM esperar o perfil, e a vazia diz "Tudo limpo!" uma vez, sem pergunta a mais', async () => {
  const NO_BR = { row: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [30], areas: [], managedAreas: [] } };
  // A fila com pedido: o card não espera o perfil (nem a decisão).
  const c = montarServidores({ perfis: NO_BR, segurar: ['row'] });
  c.AppState.filters.myArea = false;
  c.AppState._profilePromise = c.app.loadProfileAndAuxData();
  const aberturaC = c.app.startFetching();
  await tique(5);
  assert.ok(c.soltar.row, 'PRÉ-CONDIÇÃO: o perfil não ficou no ar');
  assert.ok(c.log.includes('card'), `a fila com pedido esperou o perfil pra mostrar o card: ${c.log}`);
  c.soltar.row();
  await c.AppState._profilePromise;
  await aberturaC;
  // A fila vazia de verdade: "Tudo limpo!" quando o perfil chega — uma vez, sem
  // perguntar a outro servidor nem buscar de novo.
  const v = montarServidores({ perfis: NO_BR, segurar: ['row'], vazias: ['row'] });
  v.AppState.filters.myArea = false;
  v.AppState._profilePromise = v.app.loadProfileAndAuxData();
  const aberturaV = v.app.startFetching();
  await tique(5);
  v.soltar.row();
  await v.AppState._profilePromise;
  await aberturaV;
  await tique(10);
  assert.deepEqual(v.log.filter((l) => l === 'vazio' || l === 'card'), ['vazio'], `a fila vazia de verdade não disse "Tudo limpo!" (uma vez): ${v.log}`);
  assert.deepEqual([v.perguntas, v.buscas], [['row'], ['row pais 30']], 'a espera custou uma pergunta (ou uma busca) a mais');
});

// ═══ R12-6 (a pista) · a pergunta a OUTRO servidor que FALHA não é "não edita lá" ═══
// (auditoria da rodada 12; a régua é a do R11-6-01, decidida no lote 15). Quem só
// edita na NA, com o aparelho na ROW: a decisão do lugar pergunta o `/Session` da
// NA e de Israel (`paisDoPerfil`). A pergunta que FALHAVA — o Waze fora (o 500
// `transient`), a página de erro da borda, a que nem chegou (`_motivo`) — contava
// como "não edita lá": com "Minha área", a busca desligava o filtro e o GRAVAVA,
// com a frase falsa "Seu perfil do Waze não tem área de edição" e "Tudo limpo! …
// Confira o país e a região"; o ↻ e religar "Minha área" não perguntavam a NA de
// novo até reabrir o app; e o mesmo na troca de conta pela renovação (MEDIDO no
// navegador, nos dois motores). Agora a decisão fica PENDENTE sobre o lugar: a
// busca de "Minha área" espera ("Falha ao carregar"), e a busca seguinte — o
// "Tentar de novo", o ↻ — pergunta de novo SÓ ao servidor que não respondeu.
// Aqui a carga do perfil, a decisão e a busca rodam DE VERDADE.
const SO_NA_FALHANDO = (falha) => ({ row: SO_NA.row, na: falha, il: SO_NA.il });
async function abrirOApp(m) {
  m.AppState._profilePromise = m.app.loadProfileAndAuxData();   // a abertura: o perfil e a busca juntos
  const abertura = m.app.startFetching();
  await m.AppState._profilePromise;
  await abertura;
  await tique(10);
}

test('R12-6: "Minha área" com a NA SEM RESPOSTA na abertura — não desliga nem grava, sem a frase falsa: espera com a tela de falha, e o "Tentar de novo" pergunta SÓ à NA', async () => {
  // `undefined`: o Waze fora (o 500 `transient`); 'semResposta': a que nem chegou (`_motivo`).
  for (const falha of [undefined, 'semResposta']) {
    const perfis = SO_NA_FALHANDO(falha);
    const m = montarServidores({ perfis, vazias: ['row'] });
    await abrirOApp(m);
    const rotulo = falha || 'o Waze fora';
    assert.deepEqual(m.perguntas, ['row', 'na', 'il'], `PRÉ-CONDIÇÃO (${rotulo}): a decisão não perguntou à NA e a Israel: ${m.perguntas}`);
    assert.equal(m.AppState.filters.myArea, true, `(${rotulo}) "Minha área" desligou sem a NA ter respondido: ${m.avisos()}`);
    assert.ok(!m.log.includes('salvou'), `(${rotulo}) o filtro desligado foi GRAVADO: volta desligado na próxima abertura`);
    assert.deepEqual(m.avisos(), [], `(${rotulo}) o app disse o que não sabe: ${m.avisos()}`);
    assert.deepEqual(m.buscas, [], `(${rotulo}) buscou o país com "Minha área" sem saber se há área na NA: ${m.buscas}`);
    assert.equal(m.AppState.loadError, true, `(${rotulo}) a busca que espera não pediu a tela de falha (com "Tentar de novo")`);
    // O "Tentar de novo" (a fila nova e a busca): a NA responde agora.
    perfis.na = SO_NA.na;
    await m.atualizar();
    await tique(10);
    assert.deepEqual(m.perguntas, ['row', 'na', 'il', 'na'],
      `(${rotulo}) o gesto não perguntou de novo SÓ à NA (a falha valeu como "não edita lá", ou Israel foi perguntada de novo): ${m.perguntas}`);
    assert.deepEqual([m.lugar.regiao, m.lugar.pais], ['na', 235], `(${rotulo}) a resposta da NA não levou a fila pra lá`);
    assert.deepEqual(m.buscas, ['na bbox ' + JSON.stringify(CAIXA_NY)], `(${rotulo}) a busca não foi pela caixa da NA: ${m.buscas}`);
    assert.equal(m.AppState.filters.myArea, true);
    assert.deepEqual(m.avisos(), [], `(${rotulo}) avisos: ${m.avisos()}`);
    // A NA que respondeu não é perguntada de novo: nenhum pedido a mais.
    await m.atualizar();
    await tique(10);
    assert.deepEqual(m.perguntas, ['row', 'na', 'il', 'na'], `(${rotulo}) a NA que respondeu foi perguntada de novo: ${m.perguntas}`);
  }
});

test('R12-6: a pergunta que falha de novo segue pendente — uma ida por busca, nenhuma sem gesto, e nenhuma sem rede', async () => {
  const perfis = SO_NA_FALHANDO(undefined);
  const m = montarServidores({ perfis, vazias: ['row'] });
  await abrirOApp(m);
  // A busca que a própria decisão faz (ou que esperou por ela) não repete a pergunta.
  assert.deepEqual(m.perguntas, ['row', 'na', 'il'], `a decisão perguntou de novo sem gesto nenhum: ${m.perguntas}`);
  await m.atualizar();                           // o "Tentar de novo": a NA falha de novo
  await tique(10);
  assert.deepEqual(m.perguntas, ['row', 'na', 'il', 'na'], `o gesto perguntou ${m.perguntas.length - 3} vezes: ${m.perguntas}`);
  assert.deepEqual([m.AppState.filters.myArea, m.AppState.loadError, m.buscas], [true, true, []],
    'a segunda falha decidiu alguma coisa (desligou, buscou ou tirou a tela de falha)');
  m.navegador.onLine = false;                    // num túnel: o gesto não pergunta
  await m.atualizar();
  await tique(10);
  assert.deepEqual(m.perguntas, ['row', 'na', 'il', 'na'], `sem rede, a pergunta saiu: ${m.perguntas}`);
  m.navegador.onLine = true;                     // a rede volta: o gesto seguinte pergunta, e a NA responde
  perfis.na = SO_NA.na;
  await m.atualizar();
  await tique(10);
  assert.deepEqual(m.perguntas, ['row', 'na', 'il', 'na', 'na'], `com a rede de volta, o gesto não perguntou: ${m.perguntas}`);
  assert.deepEqual(m.buscas, ['na bbox ' + JSON.stringify(CAIXA_NY)], `a busca não foi pela caixa da NA: ${m.buscas}`);
});

test('R12-6: sem "Minha área", a NA sem resposta deixa a fila do Brasil — e o ↻ (ou religar "Minha área") pergunta de novo, sem a frase falsa', async () => {
  // A fila do Brasil vazia é verdade ("Tudo limpo! … Confira o país e a região");
  // o que não pode é a falha valer como "não edita lá" até reabrir o app.
  const perfis = SO_NA_FALHANDO(undefined);
  const m = montarServidores({ perfis, vazias: ['row'] });
  m.AppState.filters.myArea = false;
  await abrirOApp(m);
  assert.deepEqual([m.lugar.regiao, m.lugar.pais, m.buscas], ['row', 30, ['row pais 30']], 'PRÉ-CONDIÇÃO: a abertura não ficou na fila do Brasil');
  perfis.na = SO_NA.na;
  await m.atualizar();                           // o ↻ (ou o "Verificar novamente")
  await tique(10);
  assert.deepEqual(m.perguntas, ['row', 'na', 'il', 'na'], `o ↻ não perguntou de novo à NA: ${m.perguntas}`);
  assert.deepEqual([m.lugar.regiao, m.lugar.pais], ['na', 235], 'a NA respondeu e a fila não foi pros EUA');
  assert.equal(m.buscas.at(-1), 'na pais 235', `a busca dos EUA não saiu: ${m.buscas}`);
  assert.ok(m.avisos().includes('toast:toast.paisDoPerfil(United States)'), `a fila dos EUA entrou sem o aviso: ${m.avisos()}`);
  // Religar "Minha área" (Filtros › liga › Aplicar, sem mexer na região), com a NA ainda falhando.
  const r = montarServidores({ perfis: SO_NA_FALHANDO(undefined), vazias: ['row'] });
  r.AppState.filters.myArea = false;
  await abrirOApp(r);
  r.AppState.filters.myArea = true;
  await r.atualizar();                           // o "Aplicar": a NA falha de novo
  await tique(10);
  assert.deepEqual(r.perguntas, ['row', 'na', 'il', 'na'], `religar não perguntou de novo à NA: ${r.perguntas}`);
  assert.equal(r.AppState.filters.myArea, true, `religar "Minha área" a desligou de novo, com a frase falsa: ${r.avisos()}`);
  assert.deepEqual(r.avisos(), []);
});

test('R12-6: a troca de conta pela renovação com a NA sem resposta — "Minha área" fica, sem a frase falsa, e o "Tentar de novo" leva à fila da NA', async () => {
  const perfis = { row: SO_NA_B.row, il: SO_NA_B.il };   // a NA de B: o Waze fora
  const m = montarServidores({ perfis, vazias: ['row'] });
  m.ganchos.aoConhecerConta = () => { m.app.resetQueue(); m.app.startFetching(); };
  await m.app.loadProfileAndAuxData();
  await tique(10);
  assert.deepEqual(m.perguntas, ['row', 'na', 'il'], `PRÉ-CONDIÇÃO: a decisão não perguntou à NA e a Israel: ${m.perguntas}`);
  assert.equal(m.AppState.filters.myArea, true, `"Minha área" desligou na troca de conta sem a NA ter respondido: ${m.avisos()}`);
  assert.deepEqual([m.avisos(), m.buscas, m.AppState.loadError], [[], [], true],
    'a frase falsa, a busca do país ou a falta da tela de falha na troca de conta');
  perfis.na = SO_NA_B.na;
  await m.atualizar();
  await tique(10);
  assert.deepEqual(m.buscas, ['na bbox ' + JSON.stringify(CAIXA_NY)], `o "Tentar de novo" não levou à fila da área na NA: ${m.buscas}`);
});

test('R12-6: o 401 da pergunta vai à conferência da sessão, a recusa do portão é terminal — e o lugar aplicado À MÃO vale por si (sem a pergunta repetida)', async () => {
  // 401: conferido (com a busca esperando, ninguém mais o veria), e a decisão fica pendente.
  const s = montarServidores({ perfis: SO_NA_FALHANDO('semSessao'), vazias: ['row'] });
  await abrirOApp(s);
  assert.equal(s.log.filter((l) => l === 'confere-sessao').length, 1, `o 401 da pergunta à NA não foi conferido: ${s.log}`);
  assert.deepEqual([s.AppState.filters.myArea, s.avisos(), s.buscas], [true, [], []], 'o 401 valeu como "não edita lá"');
  // A recusa do portão na pergunta à NA: terminal, como na carga do perfil — e
  // Israel nem é perguntada.
  const g = montarServidores({ perfis: SO_NA_FALHANDO('negado'), vazias: ['row'] });
  await abrirOApp(g);
  assert.ok(g.log.includes('recusa'), `a recusa do portão na pergunta à NA não foi terminal: ${g.log}`);
  assert.deepEqual(g.perguntas, ['row', 'na'], `depois da recusa do portão a decisão seguiu perguntando: ${g.perguntas}`);
  // O lugar que a pessoa aplica À MÃO, com a decisão pendente no Brasil: vale a
  // régua do servidor aplicado (R11-6-01), e a pendência não pergunta junto.
  const a = montarServidores({ perfis: SO_NA_FALHANDO(undefined), vazias: ['row'] });
  await abrirOApp(a);
  await a.aplicarRegiao('na', 235);              // a NA ainda falha: só UMA pergunta a ela
  await tique(10);
  assert.deepEqual(a.perguntas, ['row', 'na', 'il', 'na'], `o lugar aplicado à mão perguntou à NA mais de uma vez: ${a.perguntas}`);
  assert.deepEqual([a.AppState.filters.myArea, a.buscas], [true, []], 'a NA aplicada à mão, sem resposta, não esperou');
  // E o país que a pessoa escolhe à mão NA MESMA região (a França, sem "Minha
  // área"): a escolha é dela — a pendência sobre o Brasil não pergunta de novo, e
  // a NA, que agora responderia, não a tira da França.
  const perfisF = SO_NA_FALHANDO(undefined);
  const f = montarServidores({ perfis: perfisF, vazias: ['row'] });
  f.AppState.filters.myArea = false;
  await abrirOApp(f);
  perfisF.na = SO_NA.na;
  await f.aplicarRegiao('row', 73);
  await tique(10);
  assert.deepEqual(f.perguntas, ['row', 'na', 'il'], `a França aplicada à mão perguntou à NA de novo: ${f.perguntas}`);
  assert.deepEqual([f.lugar.regiao, f.lugar.pais, f.buscas.at(-1)], ['row', 73, 'row pais 73'],
    `a pendência sobre o Brasil tirou a pessoa da França que ela escolheu: ${f.lugar.regiao}/${f.lugar.pais} · ${f.buscas}`);
});

// ═══ R13-6-01 · a fila guardada aberta sem rede, com "Minha área": o perfil só RETOMA ═══
// (auditoria da rodada 13; o mesmo do R13-4-02). Com "Minha área" e o
// "Disponível offline", a fila guardada abre sem rede (o lie-fi do R12-4-02, ou o
// modo avião) com o perfil ainda por chegar, e a reposição dela espera o perfil
// (`fetchNextPage` marca `filaEsperaPerfil`, também com card na fila). Quando a
// rede volta e o perfil chega, o `completarPerfilChegado` REFAZIA a fila: o
// `resetQueue` arrancava o card da mão, trazia de volta os que a pessoa pulou e
// mandava na hora a decisão da janela do Desfazer (MEDIDO no navegador, nos dois
// motores: o ✕ saía ~0,4 s depois do toque, e o pulado voltava como o card da
// frente). Sem "Minha área", a mesma fila só retoma. Aqui o perfil chega DE
// VERDADE (`completarPerfilChegado` → `retomarBusca` → `startFetching`).
const NO_BR_COM_AREA = { row: { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [30],
  areas: [{ type: 'drive', bbox: CAIXA_BR }], managedAreas: [] } };
// A fila guardada aberta sem rede, com os dois primeiros já pulados (ficam fora
// da fila), a decisão do 3º na janela do Desfazer, e a reposição esperando o perfil.
async function comAFilaGuardadaEsperandoOPerfil(m, fila) {
  m.AppState.queue = fila.map((i) => ({ venueID: 'b' + i, updateRequestID: 'ub' + i }));
  m.AppState.currentPlace = m.AppState.queue[0] || null;
  m.AppState.pendingAction = { execute: () => m.log.push('despachou'), cancel: () => {} };
  await m.app.fetchNextPage();                   // o `maybePrefetch` dos últimos cards: espera o perfil
}

test('R13-6-01: a fila guardada com card e "Minha área" — o perfil que chega só RETOMA a busca: o card fica, os pulados não voltam e a janela do Desfazer não é despachada', async () => {
  const m = montarServidores({ perfis: NO_BR_COM_AREA });
  await comAFilaGuardadaEsperandoOPerfil(m, [3, 4, 5]);
  assert.equal(m.app.filaEsperaPerfil(), true, 'PRÉ-CONDIÇÃO: a reposição da fila guardada não esperou o perfil');
  const epoca = m.AppState.fetchEpoch;
  await m.chegaOPerfil();
  await tique(10);
  assert.ok(!m.log.includes('despachou'),
    'o perfil que chegou mandou ao Waze a decisão da janela do Desfazer, antes da hora (o `resetQueue` de uma fila refeita)');
  assert.equal(m.AppState.fetchEpoch, epoca, 'o perfil que chegou REFEZ a fila com card na mão (época nova): os pulados voltam');
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['b3', 'b4', 'b5'], 'a fila da tela foi trocada');
  assert.equal(m.AppState.currentPlace && m.AppState.currentPlace.venueID, 'b3', 'o card da frente foi trocado');
  // Só retoma: a busca volta a poder repor a fila (pela caixa da área, no `maybePrefetch`).
  assert.deepEqual([m.AppState.hasMore, m.AppState.loadError, m.app.filaEsperaPerfil()], [true, false, false],
    'a busca não foi retomada: a fila guardada nunca mais se repõe');
  assert.ok(m.log.includes('card') && !m.log.includes('vazio'), `a tela não ficou no card: ${m.log}`);
  assert.equal(m.AppState.filters.myArea, true);
});

test('R13-6-01: CONTROLES — a fila VAZIA que esperou o perfil é refeita (pela caixa da área), e "Minha área" desligada pela falta de caixa também (o filtro mudou)', async () => {
  // A fila vazia: o "Minha área" sem o perfil na abertura (F5).
  const v = montarServidores({ perfis: NO_BR_COM_AREA });
  await comAFilaGuardadaEsperandoOPerfil(v, []);
  assert.equal(v.app.filaEsperaPerfil(), true, 'PRÉ-CONDIÇÃO: a busca não esperou o perfil');
  await v.chegaOPerfil();
  await tique(10);
  assert.equal(v.AppState.fetchEpoch, 1, 'a fila vazia que esperou o perfil não foi refeita');
  assert.deepEqual(v.buscas, ['row bbox ' + JSON.stringify(CAIXA_BR)], `a fila refeita não foi pela caixa da área: ${v.buscas}`);
  // Com card, mas o perfil SEM caixa: "Minha área" desliga e diz, e a fila da tela
  // (de "Minha área") é de outro filtro — é refeita, pelo país.
  const semCaixa = { row: { ...NO_BR_COM_AREA.row, areas: [] } };
  const s = montarServidores({ perfis: semCaixa });
  await comAFilaGuardadaEsperandoOPerfil(s, [3, 4, 5]);
  await s.chegaOPerfil();
  await tique(10);
  assert.equal(s.AppState.filters.myArea, false, 'PRÉ-CONDIÇÃO: "Minha área" seguiu ligada num perfil sem área');
  assert.equal(s.AppState.fetchEpoch, 1, 'a fila de "Minha área" ficou na tela com o filtro desligado (o filtro que mente)');
  assert.deepEqual(s.buscas, ['row pais 30'], `a fila do país não saiu: ${s.buscas}`);
});

// ═══ R13-6-02 · o 401 do OUTRO servidor na pergunta da decisão: nenhum laço ═══
// (auditoria da rodada 13, regressão do lote 16). A decisão do lugar fica
// PENDENTE quando o `/Session` de outro servidor não responde (R12-6), e o 401
// dele vai à conferência da sessão (`handleUnauthorized`). A sonda pergunta o
// perfil DAQUI, que responde: alarme falso, e a recomposição
// (`rebuscarDepoisDeFalha`) chamava o `startFetching`, que pergunta de novo a
// decisão pendente (`refazerDecisaoSemResposta`) — 401 de novo, e o ciclo
// recomeçava: sem "Minha área", 13 `/Session` da NA + 13 sondas, 12 "Conexão
// instável…" e 13 "Tudo limpo!" anunciados em 15 s, sem fim (MEDIDO no
// navegador, nos dois motores). A conferência aqui tem o desfecho do alarme
// falso de verdade (a recomposição); a busca, a pendência e a pergunta rodam DE
// VERDADE. Com teto: sem ele o laço do defeito penduraria o teste (gotcha #19).
test('R13-6-02: o 401 do outro servidor na pergunta da decisão pendente — a sessão é conferida UMA vez e nada pergunta de novo sozinho; o gesto pergunta', async () => {
  for (const myArea of [false, true]) {
    const perfis = SO_NA_FALHANDO('semSessao');
    const m = montarServidores({ perfis, vazias: ['row'] });
    m.AppState.filters.myArea = myArea;
    let conferencias = 0;
    m.ganchos.handleUnauthorized = () => {
      m.log.push('confere-sessao');
      if (++conferencias < 20) setTimeout(() => m.app.rebuscarDepoisDeFalha(), 0);
    };
    await abrirOApp(m);
    await tique(60);
    const rotulo = myArea ? 'com "Minha área"' : 'sem "Minha área"';
    assert.ok(m.app.pendencia(), `PRÉ-CONDIÇÃO (${rotulo}): o 401 da NA não deixou a decisão pendente`);
    assert.deepEqual(m.perguntas, ['row', 'na', 'il'],
      `(${rotulo}) a recomposição do alarme falso perguntou de novo à NA que acabou de recusar: ${m.perguntas.join(' ')} — o laço`);
    assert.equal(conferencias, 1, `(${rotulo}) a sessão foi conferida ${conferencias} vezes: o laço`);
    // O gesto (o ↻, o "Tentar de novo", o "Verificar novamente") pergunta de novo — e a NA, que agora responde, leva a pessoa à fila dela.
    perfis.na = SO_NA.na;
    await m.atualizar();
    await tique(10);
    assert.deepEqual(m.perguntas, ['row', 'na', 'il', 'na'], `(${rotulo}) o gesto não perguntou de novo à NA: ${m.perguntas}`);
    assert.deepEqual([m.lugar.regiao, m.lugar.pais], ['na', 235], `(${rotulo}) a resposta da NA não levou a fila pra lá`);
  }
});
