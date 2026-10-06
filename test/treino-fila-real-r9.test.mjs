// A FILA REAL com o treino aberto, de novo (auditoria de 2026-10-06, rodada 9).
//
// O treino troca a fila da tela pela de EXEMPLOS e guarda a real
// (`Treino._salvo.queue`) até o `sair()`. A rodada 8 fez quem pergunta pela fila
// de verdade perguntar à `filaReal()`; esta achou o que ainda escapava, cada um
// MEDIDO no navegador pelos auditores com o controle sem o treino:
//   R9-7-04 — o PERFIL que chega com o treino aberto e refaz a fila (o país de
//             quem entra, a busca que esperava por ele, a área salva que ele não
//             tem) passava pelo `resetQueue`, que ENCERRA o treino: a faixa
//             "nada é enviado ao Waze" sumia, o card da frente virava um pedido
//             real e o ✕ seguinte ia pro Waze no nome da pessoa;
//   R9-7-01 = R9-3-03 — o recusado de vez que espera o "Sair" do treino
//             (`Treino._salvo.devolver`) não era "da tela": a exclusão (ou o
//             nome) que pousou não chegava a ele, e a que não chegou ao Waze não
//             voltava nem avisava;
//   R9-4-01 — a varredura do offline lê a fila DEPOIS de gravá-la (um `await`): o
//             treino que abria nesse meio a fazia preparar os EXEMPLOS e a poda
//             apagava o mapa dos pedidos reais;
//   R9-4-02 — o "Disponível offline" ligado SEM SINAL com o treino aberto não
//             guardava nada, e a linha dizia "4 pedidos guardados";
//   R9-4-03 — com a fila guardada esperando o "Sair" do treino (R8-4-04), a linha
//             dizia "Sem sinal agora. Vai preparar sozinho…".
//
// Os testes RODAM o código de verdade — o objeto `Treino` e as funções, fatiados
// do app.js — num escopo só, com a tela de mentira. Cada um tem o CONTROLE sem o
// treino (o mesmo desfecho, que valida o instrumento), e foi visto REPROVANDO com
// o conserto desfeito (sabotagem no relatório do lote 13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fechar(txt, i) {
  let prof = 0;
  for (let j = txt.indexOf('{', i); j < txt.length; j++) {
    if (txt[j] === '{') prof++;
    else if (txt[j] === '}') { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
function objetoDoTreino() {
  const i = APP_SEM.indexOf('const Treino = {');
  assert.ok(i >= 0, 'o objeto Treino sumiu');
  return APP_SEM.slice(i + 'const Treino = '.length, fechar(APP_SEM, i));
}
// Um MÉTODO do objeto `Lightbox`, como texto de método (`nome(args) { … }`).
function metodoDoLightbox(nome) {
  const ini = APP_SEM.indexOf('const Lightbox = {');
  const fim = fechar(APP_SEM, ini);
  const m = new RegExp('^    ' + nome + '\\(', 'm').exec(APP_SEM.slice(ini, fim));
  assert.ok(m, `Lightbox.${nome} sumiu`);
  const i = ini + m.index;
  let par = 0, k = APP_SEM.indexOf('(', i);
  for (let j = k; j < fim; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { k = j + 1; break; } }
  }
  return APP_SEM.slice(i, fechar(APP_SEM, k)).trim();
}

const tique = () => new Promise((ok) => setImmediate(ok));
const tiques = async (n) => { for (let i = 0; i < n; i++) await tique(); };
const P = (id, autor = 1000) => ({ venueID: 'v' + id, updateRequestID: 'u' + id, name: 'Local ' + id,
  creatorId: autor, createdBy: 'autor' + autor, updateTypeKey: 'VENUE', imageUrls: [],
  dateAdded: 1785203731191 - Number(String(id).replace(/\D/g, '') || 0) * 1000, mapa: { centro: [-10, -40] } });
const ids = (fila) => (fila || []).map((p) => p.updateRequestID);
const soExemplos = (fila) => (fila || []).length > 0 && fila.every((p) => p._treino === true || !!p._exemplo);

function elemento() {
  const classes = new Set();
  return { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
    toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)), replace: (a, b) => { if (classes.delete(a)) classes.add(b); } },
  textContent: '', innerHTML: '', removeAttribute() {}, setAttribute() {}, children: [] };
}

// O que o `Treino` de verdade usa da tela e da fila: de mentira, salvo o que cada
// teste traz de verdade (`extra`).
function depsDoTreino(AppState, log, els, extra = {}) {
  return {
    AppState, document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    removeUndoBanner: () => {}, savePreferences: () => {}, showLoading: (v) => log.push('carregando:' + v),
    updateStats: () => {}, updatePendingCount: () => {},
    showCurrentPlace: () => log.push('card:' + ((AppState.queue[0] || {}).updateRequestID || '-')),
    fecharCamadasDeFoto: () => {}, removeCurrentCardEl: () => {}, maybePrefetch: () => {},
    startFetching: () => log.push('busca'), showNoPlaces: () => log.push('vazio'),
    t: (k, v) => (v ? k + JSON.stringify(v) : k), openModal: () => {}, trocarTextoI18n: () => {}, semJanelaDeDesfazer: () => false,
    loteDeLidosEmVoo: false, aprovacaoPendente: null, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(),
    enviarPendenciasDoLightbox: () => {},
    // o que o `sair()` chama e não é deste arquivo
    limparFocoAutor: () => {}, sortQueue: () => {}, aplicarRecusaAutomatica: () => log.push('recusa'),
    devolverPedidoRecusado: (lista) => { AppState.queue.splice(1, 0, ...(Array.isArray(lista) ? lista : [lista])); },
    ordemPrecisaDaFilaInteira: () => false, buscarORestoDaFila: () => {}, abrirGuardadaDepoisDoTreino: () => log.push('guardada'),
    ...extra,
  };
}
function montar(deps, nomes, extraFonte = '', retorno = '') {
  const chaves = Object.keys(deps);
  const fonte = [extraFonte, ...nomes.map(fatiar), 'const Treino = ' + objetoDoTreino() + ';',
    `return { Treino, ${[...nomes, retorno].filter(Boolean).join(', ')} };`].join('\n');
  return new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
}

// ═══ R9-7-04 · o PERFIL que chega com o treino aberto e refaz a fila ═══════════
// Três caminhos levavam o perfil a refazer a fila — todos pelo `resetQueue`, que
// encerra o treino:
//   · o PAÍS de quem entra: o país do filtro não é um onde a pessoa edita
//     (`paisDoPerfil` → `irProPaisDoPerfil`);
//   · a área gerenciada SALVA que o perfil não tem (`esquecerAreaForaDoPerfil`);
//   · a busca que ESPERAVA o perfil ("Minha área" sem as áreas, `filaEsperaPerfil`).
// Com o treino aberto o perfil ANOTA, e o `sair()` refaz a fila (com o aviso do
// país); o LUGAR muda já, como sem o treino. O `resetQueue`, a função de
// verdade, é quem diria se o treino saiu.
const PAISES = [{ id: 30, name: 'Brazil' }, { id: 73, name: 'France' }];
function montarPerfil({ filtros = {}, listaNa = null, devolverDeVerdade = false } = {}) {
  const log = [];
  const toasts = [];
  const els = {};
  const lugar = { regiao: 'row', pais: 30 };
  const fila = [P(1), P(2), P(3)];
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: fila.slice(), currentPlace: fila[0], stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 3, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true }, filters: { myArea: false, stateId: '', managedAreaId: '', ...filtros },
    countries: PAISES.slice(), statesByCountry: {} };
  // A lista de países da região NOVA (o `irProPaisDoPerfil` a pede ANTES de a
  // região valer): o teste pode segurá-la, pra o treino abrir nesse meio.
  let soltarLista = null;
  const API = {
    getRegion: () => lugar.regiao, getCountry: () => lugar.pais,
    setRegion: (r) => { lugar.regiao = r; }, setCountry: (p) => { lugar.pais = Number(p); },
    getProfile: async (r) => ({ success: true, profile: { editableCountryIDs: r === 'na' && listaNa ? listaNa : [] } }),
    listCountries: () => new Promise((ok) => { soltarLista = () => ok({ success: true, countries: [{ id: 235, name: 'United States' }] }); }),
  };
  const deps = depsDoTreino(AppState, log, els, {
    API, REGIOES_DO_WAZE: ['row', 'na', 'il'], anotarEditaveis: () => {}, saveFilters: () => log.push('grava'),
    dfato: () => {}, showToast: (m) => toasts.push(m), redesenharLugarNosFiltros: () => {}, window: {},
    aoMudarAFilaPorBaixo: () => {}, caixaDaMinhaArea: () => [-38.5, -13, -38.2, -12.8], desligarMinhaAreaSemCaixa: () => {},
    pedidosQueEntraramNaFila: new Set(), bloqueadosPorPagina: new Map(),
    // A busca de VERDADE não roda aqui: o que importa é ONDE ela sairia.
    startFetching: () => log.push('busca:' + lugar.regiao + '/' + lugar.pais),
    t: (k, v) => k + (v && v.pais ? '(' + v.pais + ')' : ''),
    manterFocoNaFrente: () => {},
  });
  // O `devolverPedidoRecusado` de VERDADE, quando o teste mede o que ele mostra.
  const nomesDoDevolver = devolverDeVerdade ? ['chaveDoPedido', 'devolverPedidoRecusado'] : [];
  if (devolverDeVerdade) delete deps.devolverPedidoRecusado;
  const app = montar(deps, [...nomesDoDevolver, 'filaReal', 'resetQueue', 'refazerFilaReal', 'irProPaisDoPerfil', 'paisDoPerfil',
    'esquecerAreaForaDoPerfil', 'completarPerfilChegado'],
  `let epocaDaSessao = 0, lugarDoPedidoDoPerfil = null, filaEsperaPerfil = false, tratouNestaFila = false,
     recusaAutomaticaNestaFila = false, filaAtravessouSessao = false, puladosNoInicioDaFila = 0, rebuscasAuto = 0,
     filaDeOnde = null;`,
  'esperarPerfil: () => { filaEsperaPerfil = true; }');
  return { app, AppState, log, toasts, lugar, soltarLista: () => soltarLista && soltarLista() };
}

const CASOS_DO_PERFIL = {
  // O país do filtro (Brasil) não é um onde a pessoa edita: vai pra França.
  pais: { perfil: { id: 7, editableCountryIDs: [73] }, final: { lugar: 'row/73', busca: ['busca:row/73'], toasts: ['toast.paisDoPerfil(France)'] } },
  // A área gerenciada salva (5) que o perfil não tem: sai do filtro e a fila é refeita no mesmo país.
  area: { filtros: { managedAreaId: '5' }, perfil: { id: 7, editableCountryIDs: [30], managedAreas: [] },
    final: { lugar: 'row/30', busca: ['busca:row/30'], toasts: [] } },
  // "Minha área" com a busca que esperou o perfil (`filaEsperaPerfil`).
  espera: { filtros: { myArea: true }, esperando: true, perfil: { id: 7, editableCountryIDs: [30], areas: [{ bbox: [1, 2, 3, 4] }] },
    final: { lugar: 'row/30', busca: ['busca:row/30'], toasts: [] } },
};

async function perfilChegaNoTreino(caso, { comTreino }) {
  const c = CASOS_DO_PERFIL[caso];
  const m = montarPerfil({ filtros: c.filtros });
  if (c.esperando) m.app.esperarPerfil();
  if (comTreino) {
    m.app.Treino.entrar();
    assert.ok(soExemplos(m.AppState.queue), 'PRÉ-CONDIÇÃO: o treino não pôs os exemplos na tela');
  }
  const desde = m.log.length;
  await m.app.completarPerfilChegado(c.perfil, 0);
  const lugar = () => m.lugar.regiao + '/' + m.lugar.pais;
  const buscas = () => m.log.slice(desde).filter((l) => l.startsWith('busca'));
  const noTreino = comTreino ? { ativo: m.app.Treino.ativo, exemplos: soExemplos(m.AppState.queue),
    real: ids(m.app.filaReal()), buscas: buscas(), toasts: m.toasts.slice(), lugar: lugar() } : null;
  if (comTreino) m.app.Treino.sair();
  return { noTreino, final: { lugar: lugar(), busca: buscas(), toasts: m.toasts.slice() }, ativo: m.app.Treino.ativo,
    fila: ids(m.AppState.queue) };
}

for (const caso of Object.keys(CASOS_DO_PERFIL)) {
  test(`R9-7-04 (${caso}): o perfil que refaz a fila com o treino ABERTO não o encerra — a fila nova vem no "Sair"`, async () => {
    const esperado = CASOS_DO_PERFIL[caso].final;
    const controle = await perfilChegaNoTreino(caso, { comTreino: false });
    assert.deepEqual(controle.final, esperado,
      'CONTROLE: sem o treino o perfil não refez a fila como sempre — o teste perdeu o sentido');
    assert.deepEqual(controle.fila, [], 'CONTROLE: a fila não foi refeita (o `resetQueue` de verdade a zera)');
    const r = await perfilChegaNoTreino(caso, { comTreino: true });
    assert.equal(r.noTreino.ativo, true,
      'DEFEITO: o perfil encerrou o treino CALADO — a faixa "nada é enviado ao Waze" some e o ✕ seguinte vai pro Waze (R9-7-04)');
    assert.equal(r.noTreino.exemplos, true, 'DEFEITO: a fila da tela deixou de ser a de EXEMPLOS com o treino aberto');
    assert.deepEqual(r.noTreino.real, ['u1', 'u2', 'u3'], 'a fila real guardada pelo treino foi trocada por baixo dele');
    assert.deepEqual(r.noTreino.buscas, [], 'a fila real foi buscada com o treino aberto');
    assert.deepEqual(r.noTreino.toasts, [], 'o aviso "Mostrando a fila de…" saiu com a tela mostrando os exemplos');
    // O LUGAR muda já, como sem o treino: é por ele que o ↻ e os Filtros buscariam.
    assert.equal(r.noTreino.lugar, esperado.lugar, 'o lugar do perfil esperou o "Sair" — o ↻ no treino buscaria o país de antes');
    assert.equal(r.ativo, false, 'o "Sair" não saiu do treino');
    assert.deepEqual(r.final, esperado,
      `DEFEITO: o "Sair" do treino não trouxe a fila que o perfil mandou refazer (${JSON.stringify(r.final)})`);
    assert.deepEqual(r.fila, [], 'o "Sair" devolveu a fila guardada (a de antes do perfil) em vez de refazê-la');
  });
}

test('R9-7-04: CONTROLE — o perfil que NÃO refaz a fila (o país certo) não anota nada: o "Sair" devolve a fila guardada', async () => {
  const m = montarPerfil();
  m.app.Treino.entrar();
  const desde = m.log.length;
  await m.app.completarPerfilChegado({ id: 7, editableCountryIDs: [30] }, 0);
  assert.equal(m.app.Treino.ativo, true);
  m.app.Treino.sair();
  assert.deepEqual(m.log.slice(desde).filter((l) => l.startsWith('busca')), [], 'o "Sair" refez uma fila que ninguém mandou refazer');
  assert.deepEqual(ids(m.AppState.queue), ['u1', 'u2', 'u3'], 'o "Sair" não devolveu a fila real guardada');
  assert.deepEqual(m.toasts, []);
});

test('R9-7-04: o treino que abre DURANTE a espera da lista de países da região nova também segura a fila', async () => {
  // Quem só edita na NA: o perfil da ROW vem vazio, o da NA diz [235], e o
  // `irProPaisDoPerfil` espera a lista de países da NA ANTES de a região valer.
  for (const comTreino of [false, true]) {
    const m = montarPerfil({ listaNa: [235] });
    const desde = m.log.length;
    const chegando = m.app.completarPerfilChegado({ id: 7, editableCountryIDs: [] }, 0);
    await tiques(5);
    if (comTreino) m.app.Treino.entrar();              // ⓘ → "Praticar" durante a espera
    m.soltarLista();
    await chegando;
    const buscas = m.log.slice(desde).filter((l) => l.startsWith('busca'));
    if (!comTreino) {
      assert.deepEqual(buscas, ['busca:na/235'], 'CONTROLE: sem o treino a fila não foi refeita na NA — o teste perdeu o sentido');
      continue;
    }
    assert.equal(m.app.Treino.ativo, true, 'DEFEITO: o treino que abriu na espera foi encerrado pela fila nova');
    assert.deepEqual(buscas, [], 'a fila foi buscada com o treino aberto');
    assert.deepEqual([m.lugar.regiao, m.lugar.pais], ['na', 235], 'região e país não ficaram coerentes (o par do achado 10)');
    m.app.Treino.sair();
    assert.deepEqual(m.log.slice(desde).filter((l) => l.startsWith('busca')), ['busca:na/235'],
      'o "Sair" não buscou a fila da região do perfil');
  }
});

test('R9-7-04: o recusado de vez que espera o "Sair" não vira card na fila VELHA — a fila refeita é a que entra', async () => {
  // A busca esperava o perfil ("Minha área"): a fila real está VAZIA. O ✕ que
  // estava no ar volta recusado de vez com o treino aberto (vai pro `devolver`),
  // e o perfil chega mandando refazer a fila. No "Sair", devolvê-lo antes de
  // refazer o mostrava por um instante numa fila que ia ser trocada; quem o traz
  // é a busca da fila nova, como numa fila refeita sem o treino.
  const m = montarPerfil({ filtros: { myArea: true }, devolverDeVerdade: true });
  m.app.esperarPerfil();
  m.AppState.queue = [];
  m.AppState.currentPlace = null;
  m.app.Treino.entrar();
  m.app.devolverPedidoRecusado(P(9), 0);
  assert.deepEqual(ids(m.app.Treino._salvo.devolver), ['u9'], 'PRÉ-CONDIÇÃO: o recusado não ficou guardado no treino pro "Sair"');
  await m.app.completarPerfilChegado({ id: 7, editableCountryIDs: [30], areas: [{ bbox: [1, 2, 3, 4] }] }, 0);
  assert.equal(m.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o perfil encerrou o treino');
  const desde = m.log.length;
  m.app.Treino.sair();
  const depois = m.log.slice(desde).filter((l) => /^(card|busca)/.test(l));
  assert.deepEqual(depois, ['busca:row/30'], `o "Sair" mostrou o recusado na fila velha antes de refazê-la (${depois})`);
});

test('R9-7-04: os dois avisos — o do país que chegou primeiro não se perde num refazer sem país depois', async () => {
  const m = montarPerfil();
  m.app.Treino.entrar();
  m.app.Treino.anotarFilaRefeita({ chave: 'toast.paisDoPerfil', pais: 'France' });
  m.app.Treino.anotarFilaRefeita(null);
  m.app.Treino.sair();
  assert.deepEqual(m.toasts, ['toast.paisDoPerfil(France)'], 'o aviso do país se perdeu');
});

// ═══ A volta da REDE com a fila real vazia, com o treino aberto ══════════════
// O `online` (e o "Tentar de novo") com a fila VAZIA é um ATUALIZAR: os pedidos
// que passaram pela fila sem decisão — pulados sem sinal, como o card de foto sem
// a foto — voltam (`retomarBusca`, a auditoria em produção de 2026-09-25). Ele
// olhava a fila da TELA: no treino são os exemplos, e a fila real vazia não era
// vista — o "Sair" buscava SEM refazer a fila, e os pulados não voltavam ("Tudo
// limpo!" com pedidos pendentes). E no ÚLTIMO card do treino (os exemplos
// acabaram, o "Treino concluído" aberto) o `resetQueue` daqui o encerrava por
// baixo da pessoa. Mesmo caminho do R9-7-04: com o treino aberto, anota.
function montarRetomada() {
  const log = [];
  const els = {};
  const passaram = new Set(['v1|u1', 'v2|u2']);         // os pulados sem sinal
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false, loadError: true,
    queue: [], currentPlace: null, stats: { read: 0, rejected: 0, skipped: 2 }, serverTotal: 0, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true } };
  const deps = depsDoTreino(AppState, log, els, { pedidosQueEntraramNaFila: passaram, bloqueadosPorPagina: new Map(),
    showToast: () => {} });
  const app = montar(deps, ['filaReal', 'resetQueue', 'refazerFilaReal', 'retomarBusca'],
    `let tratouNestaFila = false, recusaAutomaticaNestaFila = false, filaAtravessouSessao = false, puladosNoInicioDaFila = 0,
       filaEsperaPerfil = false, rebuscasAuto = 0, filaDeOnde = null;`);
  return { app, AppState, log, passaram };
}

test('a volta da REDE com a fila real vazia e o treino aberto: o treino segue, e o "Sair" faz o atualizar (os pulados voltam)', () => {
  const c = montarRetomada();
  c.app.retomarBusca();
  assert.deepEqual([c.passaram.size, c.log], [0, ['busca']],
    'CONTROLE: sem o treino a volta da rede com a fila vazia não atualizou — o teste perdeu o sentido');
  // No meio do treino: os exemplos na tela, a fila real vazia.
  const m = montarRetomada();
  m.app.Treino.entrar();
  assert.ok(soExemplos(m.AppState.queue), 'PRÉ-CONDIÇÃO: o treino não pôs os exemplos na tela');
  m.app.retomarBusca();
  assert.equal(m.app.Treino.ativo, true, 'a volta da rede encerrou o treino');
  assert.equal(m.passaram.size, 2, 'a fila real foi refeita com o treino aberto');
  m.app.Treino.sair();
  assert.equal(m.passaram.size, 0,
    'DEFEITO: o "Sair" buscou SEM refazer a fila — os pulados sem sinal não voltam ("Tudo limpo!" com pedidos pendentes)');
  assert.deepEqual(m.log.filter((l) => l === 'busca'), ['busca'], 'o "Sair" não buscou a fila');
});

test('a volta da REDE no ÚLTIMO card do treino ("Treino concluído" aberto) não o encerra por baixo da pessoa', () => {
  const m = montarRetomada();
  m.app.Treino.entrar();
  m.AppState.queue = [];                                 // os exemplos acabaram (`Treino.agir` no último)
  m.app.retomarBusca();
  assert.equal(m.app.Treino.ativo, true, 'DEFEITO: a volta da rede encerrou o treino por baixo do "Treino concluído"');
  m.app.Treino.sair();                                   // o "Ir para a fila"
  assert.equal(m.passaram.size, 0, 'o "Ir para a fila" não fez o atualizar');
});

// ═══ R9-7-01 = R9-3-03 · o recusado que espera o "Sair" do treino ═══════════
// A e A2: dois pedidos do MESMO local (v1), com duas fotos aprovadas. O que o
// Waze recusou de vez com o treino aberto vai pra `Treino._salvo.devolver` (o
// `devolverPedidoRecusado` de verdade) e volta como o próximo card no "Sair". A
// escrita da foto que pousa — ou não — tem de chegar a ele como chegaria com ele
// na fila: é a mesma tela de quem volta do treino.
const FOTO = (id) => `https://venue-image.waze.com/thumbs/thumb700_${id}.jpg`;
function montarDevolvido() {
  const log = [];
  const toasts = [];
  const els = {};
  const local = (ur) => ({ venueID: 'v1', updateRequestID: ur, name: 'Padaria Velha', updateTypeKey: 'UPDATE_DETAILS',
    imageUrls: [FOTO('f1'), FOTO('f2')], approvedImageIds: ['f1', 'f2'], creatorId: 7, createdBy: 'autor7' });
  const A = local('ur-A');
  const A2 = local('ur-A2');
  const C = { ...P(3), imageUrls: [FOTO('f1')], approvedImageIds: ['f1'] };
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: [A, A2, C], currentPlace: A, stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 3, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true } };
  let responder = null;
  const ida = () => new Promise((ok) => { responder = ok; });
  // A foto ampliada FECHADA (o `Treino.entrar` a fecha): o `removerFoto` de
  // verdade só mexe no pedido.
  const Lightbox = new Function(`return { place: null, urls: [], idx: 0, newIdx: -1, isOpen() { return false; },
    close() {}, _render() {}, recolocarFoto() {}, ${metodoDoLightbox('removerFoto')} };`)();
  let app = null;
  const deps = depsDoTreino(AppState, log, els, {
    Lightbox, navigator: { onLine: true }, callWithRetry: (fn) => fn(),
    API: { excluirFoto: ida, renomearLocal: ida },
    // A conferência do 401: a sonda diz que a sessão MORREU, e a extensão a renova
    // com a mesma conta (a fila fica) — a escrita é de uma sessão que acabou.
    handleUnauthorized: async () => { log.push('confere'); app.setEpoca(1); },
    sessaoVivaDepoisDe: () => false,
    showToast: (m, tipo) => toasts.push(tipo + ':' + m), msgDoServidor: () => '',
    montarCardDeFundo: () => {}, cardDaFrente: () => null, mantendoFocoNoCard: (f) => f(), contarConquista: () => {},
    renomeacoesNoAr: new Set(), aplicarTravaDeAcao: () => {}, idasSemRespostaGuardadas: new Map(), IDAS_SEM_RESPOSTA_TETO: 50,
    // O `devolverPedidoRecusado` de VERDADE: é ele que guarda o recusado no treino.
    pedidosQueEntraramNaFila: new Set(), manterFocoNaFrente: () => {}, aoMudarAFilaPorBaixo: () => {},
  });
  delete deps.devolverPedidoRecusado;
  app = montar(deps, ['chaveDoPedido', 'devolverPedidoRecusado', 'filaReal', 'filaRealComDevolvidos', 'pedidoAindaNaTela',
    'escritaDoLightboxSemSessao', 'aplicarNosIrmaos', 'devolverFoto', 'enviarExclusao', 'enviarRenomeacao', 'refazerDepoisDo401',
    'contarIdasSemResposta', 'idasSemRespostaDeAntes', 'lembrarIdasSemResposta', 'nomeDestaEscrita', 'devolverNome',
    'aplicarNomeNaTela'],
  'let epocaDaSessao = 0, escritasConferindo = 0, verificandoSessao = false, conferenciaDaSessao = null;',
  'setEpoca: (v) => { epocaDaSessao = v; }');
  return { app, A, A2, C, AppState, log, toasts, Lightbox, responder: (r) => responder(r) };
}

const fotos = (p) => p.imageUrls.map((u) => u.split('thumb700_')[1].replace('.jpg', ''));

// `recusado`: QUAL dos dois o Waze recusou de vez (o ✕ dele, despachado pelo
// "Praticar") — `A` é o da foto que a escrita mexe; `A2`, o irmão. `queda`: a
// sessão cai e volta com a mesma conta antes da resposta (a fila atravessa).
// `pousa`: a escrita chega ao Waze; senão o 401 dela derruba a sessão.
async function escritaComDevolvido({ comTreino, escrita, recusado, queda, pousa }) {
  const m = montarDevolvido();
  const alvo = recusado === 'A' ? m.A : m.A2;
  // A escrita sai: a exclusão SEM o Desfazer (a foto só sai da tela quando o
  // Waze confirma), a COM ele (já saiu no gesto) quando não pousa; o nome, no gesto.
  let envio;
  if (escrita === 'excluir') {
    if (!pousa) m.Lightbox.removerFoto('f1', m.A);
    envio = m.app.enviarExclusao({ id: 'f1', place: m.A, idx: 0, url: FOTO('f1'), regiao: 'row' });
  } else {
    m.app.aplicarNomeNaTela(m.A, 'Padaria Nova');
    envio = m.app.enviarRenomeacao({ place: m.A, novo: 'Padaria Nova', antigo: 'Padaria Velha', regiao: 'row' });
  }
  // O ✕ no recusado: o card sai da fila (`advanceQueue`) e a decisão está no ar.
  m.AppState.queue = m.AppState.queue.filter((p) => p !== alvo);
  m.AppState.currentPlace = m.AppState.queue[0];
  // "Praticar" (com o ✕ no ar).
  if (comTreino) m.app.Treino.entrar();
  // O Waze recusa o ✕ de vez: o pedido volta — no "Sair", com o treino aberto.
  m.app.devolverPedidoRecusado(alvo, 0);
  const noDevolver = comTreino ? ids(m.app.Treino._salvo.devolver) : null;
  await tique();
  if (queda) m.app.setEpoca(1);                             // a sessão caiu e voltou (a mesma conta)
  m.responder(pousa ? { success: true } : { success: false, errorCategory: 'unauthorized', httpCode: 401 });
  const saiu = await envio;
  // Sem o Desfazer, quem tira a foto do próprio pedido é quem esperou a resposta.
  if (escrita === 'excluir' && pousa && saiu === true) m.Lightbox.removerFoto('f1', m.A);
  if (comTreino) m.app.Treino.sair();
  return { noDevolver, saiu, A: fotos(m.A), A2: fotos(m.A2), C: fotos(m.C), nomeA: m.A.name, nomeA2: m.A2.name,
    toasts: m.toasts, fila: ids(m.AppState.queue) };
}

const CASOS_DEVOLVIDO = [
  // s14b do auditor: a exclusão de A POUSA (sem queda); A2, o irmão, foi recusado com o treino aberto.
  { nome: 'a exclusão que POUSA chega ao IRMÃO recusado', caso: { escrita: 'excluir', recusado: 'A2', queda: false, pousa: true },
    esperado: { saiu: true, A: ['f2'], A2: ['f2'], toasts: [] } },
  { nome: 'o nome que POUSA chega ao IRMÃO recusado', caso: { escrita: 'renomear', recusado: 'A2', queda: false, pousa: true },
    esperado: { saiu: true, nomeA: 'Padaria Nova', nomeA2: 'Padaria Nova', toasts: [] } },
  // s14 do auditor: A (o da foto) foi recusado com o treino aberto; a sessão cai e volta.
  { nome: 'a exclusão que POUSA depois da queda, com o pedido recusado, chega ao irmão', caso: { escrita: 'excluir', recusado: 'A', queda: true, pousa: true },
    esperado: { saiu: true, A: ['f2'], A2: ['f2'], toasts: [] } },
  { nome: 'o nome que POUSA depois da queda, com o pedido recusado, chega ao irmão', caso: { escrita: 'renomear', recusado: 'A', queda: true, pousa: true },
    esperado: { saiu: true, nomeA: 'Padaria Nova', nomeA2: 'Padaria Nova', toasts: [] } },
  { nome: 'a exclusão que NÃO chegou ao Waze volta no pedido recusado e AVISA', caso: { escrita: 'excluir', recusado: 'A', queda: false, pousa: false },
    esperado: { saiu: false, A: ['f1', 'f2'], A2: ['f1', 'f2'], toasts: ['error:toast.photoDeleteFailed'] } },
  { nome: 'o nome que NÃO chegou ao Waze volta no pedido recusado e AVISA', caso: { escrita: 'renomear', recusado: 'A', queda: false, pousa: false },
    esperado: { saiu: false, nomeA: 'Padaria Velha', nomeA2: 'Padaria Velha', toasts: ['error:toast.renameFailed'] } },
];

for (const { nome, caso, esperado } of CASOS_DEVOLVIDO) {
  test(`R9-7-01: com o treino aberto, ${nome} — o recusado que espera o "Sair" é da tela`, async () => {
    const corte = (r) => Object.fromEntries(Object.keys(esperado).map((k) => [k, r[k]]));
    const controle = await escritaComDevolvido({ ...caso, comTreino: false });
    assert.deepEqual(corte(controle), esperado,
      'CONTROLE: sem o treino (o recusado de volta na fila) a escrita não teve o desfecho de sempre — o teste perdeu o sentido');
    assert.deepEqual(controle.C, ['f1'], 'CONTROLE: mexeu no pedido de OUTRO local');
    const r = await escritaComDevolvido({ ...caso, comTreino: true });
    const alvo = caso.recusado === 'A' ? 'ur-A' : 'ur-A2';
    assert.deepEqual(r.noDevolver, [alvo], 'PRÉ-CONDIÇÃO: o recusado não ficou guardado no treino pro "Sair"');
    assert.deepEqual(corte(r), esperado,
      `DEFEITO: o pedido recusado que espera o "Sair" do treino ficou de fora (${JSON.stringify(corte(r))}) — R9-7-01`);
    assert.deepEqual(r.C, ['f1'], 'mexeu no pedido de OUTRO local');
    assert.ok(r.fila.includes(alvo), 'o "Sair" do treino não devolveu o recusado como card');
  });
}

// ═══ R9-4-01 · a varredura do offline com o treino abrindo durante a gravação ══
// A varredura grava a fila (um `await`, o IndexedDB) e só DEPOIS lê os itens.
// O treino que abria nesse meio trocava a fila da tela pela de exemplos: 30
// clones de 35 pedidos reais — a varredura baixava os 30, dava a fila REAL por
// "Pronto" e a poda apagava do cache o mapa dos outros 5.
function montarVarredura() {
  const log = [];
  const els = {};
  const real = Array.from({ length: 35 }, (_, i) => P(100 + i));
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: real.slice(), currentPlace: real[0], stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 35, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true } };
  const baixados = [];
  const podas = [];
  const gravadas = [];
  let soltarGravacao = null;
  const deps = depsDoTreino(AppState, log, els, {
    navigator: { onLine: true }, offlineLigado: () => true, OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: 1200000,
    OFFLINE_CONCORRENCIA: 1, OFFLINE_ANUNCIAR_A_CADA: 50, OFFLINE_TENTATIVAS_POR_ITEM: 3,
    // A gravação da fila é o IndexedDB: o teste a segura, como o celular lento.
    __gravadas: gravadas, __segurarGravacao: () => new Promise((ok) => { soltarGravacao = ok; }),
    offlineFaixaDeCaixas: () => ({ w: 400, hMin: 88, hMax: 240 }),
    tilesDaFaixa: (p) => new Set(['tile-' + p.venueID]), fotosDoCard: () => ({ urls: [], inicial: 0 }),
    offlineBaixar: async (u) => { baixados.push(u); return true; }, offlineSondarRede: async () => true,
    offlineAnunciarTiles: () => {}, atualizarLinhaDoOffline: () => {}, offlineGravarJanela: () => {},
    offlinePodarTiles: async (manter) => { podas.push([...manter]); return 0; }, dfato: () => {},
    setTimeout: (fn) => { fn(); return 0; },
  });
  const app = montar(deps, ['filaReal', 'offlineItensDaFila', 'offlineVarrer'],
  `let offlineVarrendo = false, offlinePedidaDeNovo = false, offlineUltimoGesto = Date.now(), offlineJanelaServida = null,
     offlineUltimoResultado = null, offlineEpoca = 0, offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set() },
     offlineFilaGravadaEm = null, offlineFilaPreparada = null, offlineFilaVarrida = null;
   async function offlineGravarFila() {
     __gravadas.push(filaReal().length);
     await __segurarGravacao();
     offlineFilaGravadaEm = 7;
     return true;
   }`,
  'estado: () => ({ resultado: offlineUltimoResultado, preparada: offlineFilaPreparada, gravada: offlineFilaGravadaEm })');
  return { app, AppState, baixados, podas, gravadas, soltar: () => soltarGravacao && soltarGravacao() };
}

test('R9-4-01: o treino que abre com a varredura GRAVANDO a fila não a faz preparar os EXEMPLOS — nem podar o mapa da fila real', async () => {
  const rodar = async (comTreino) => {
    const m = montarVarredura();
    const varrendo = m.app.offlineVarrer();
    await tique();
    assert.deepEqual(m.gravadas, [35], 'PRÉ-CONDIÇÃO: a varredura não começou gravando a fila real');
    if (comTreino) {
      m.app.Treino.entrar();                           // ⓘ → "Praticar" com a base gravando
      assert.equal(m.AppState.queue.length, 30, 'PRÉ-CONDIÇÃO: o treino não pôs os 30 exemplos (uma página do WME) na tela');
    }
    m.soltar();
    await varrendo;
    return { baixados: new Set(m.baixados), poda: new Set(m.podas[0] || []), estado: m.app.estado() };
  };
  const todos = Array.from({ length: 35 }, (_, i) => 'tile-v' + (100 + i));
  const controle = await rodar(false);
  assert.deepEqual([...controle.baixados].sort(), [...todos].sort(), 'CONTROLE: sem o treino a varredura não baixou a fila inteira');
  assert.deepEqual([...controle.poda].sort(), [...todos].sort(), 'CONTROLE: a poda não manteve a fila inteira');
  assert.equal(controle.estado.resultado, 'pronto');
  const r = await rodar(true);
  const faltam = todos.filter((u) => !r.poda.has(u));
  assert.deepEqual(faltam, [],
    `DEFEITO: a poda apagou o mapa de ${faltam.length} pedidos REAIS — a varredura preparou os exemplos do treino (R9-4-01)`);
  assert.deepEqual([...r.baixados].sort(), [...todos].sort(), 'a varredura não baixou a fila REAL inteira');
  assert.deepEqual(r.estado, controle.estado, 'a cobertura da fila guardada não é a do controle');
});

// ═══ R9-4-02 · o "Disponível offline" ligado SEM SINAL com o treino aberto ═══
// O interruptor grava a fila na hora, "com ou sem sinal" (O9) — e a gravação
// saía cedo no treino. A linha dizia "4 pedidos guardados" com a base vazia, e
// reaberto sem sinal o app mostrava a tela de "sem sinal". O que o app MOSTRA e
// o que ele FAZ são a mesma coisa: a linha conta o que está no aparelho.
function montarInterruptor() {
  const log = [];
  const els = {};
  const real = [P(1), P(2), P(3), P(4)];
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: real.slice(), currentPlace: real[0], stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 4, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true, offlineDisponivel: false }, filters: { myArea: false } };
  const base = {};
  const deps = depsDoTreino(AppState, log, els, {
    navigator: { onLine: false }, escapeHtml: (s) => s,
    OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: 1200000, OFFLINE_STORE: 'fila',
    offlineLigado: () => AppState.preferences.offlineDisponivel === true,
    offlineEsquecer: () => {}, lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }),
    contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, API: { getSession: () => 'tok' },
    offlinePodarPousos: () => {}, dfato: () => {},
    // A base do offline: o `put` grava, e a transação fecha num tique.
    offlineDB: async () => ({ close() {}, transaction: () => {
      const tx = { objectStore: () => ({ put: (v, k) => { base[k] = JSON.parse(JSON.stringify(v)); setTimeout(() => tx.oncomplete()); } }) };
      return tx;
    } }),
    t: (k, v) => (v ? k + JSON.stringify(v) : k),
  });
  const app = montar(deps, ['chaveDoPedido', 'filaReal', 'filaGuardadaEsperandoOTreino', 'offlineGravarFila', 'offlineMarcarGesto',
    'offlineVarrer', 'offlinePrecisaVarrer', 'atualizarLinhaDoOffline', 'offlineAoMudarInterruptor'],
  `let filaDeOnde = { regiao: 'row', pais: '30', busca: 'b' }, offlineVarrendo = false, offlinePedidaDeNovo = false,
     offlineUltimoGesto = Date.now(), offlineJanelaServida = null, offlineUltimoResultado = null, offlineEpoca = 0,
     offlineFilaGravadaEm = null, offlineFilaGravadaChaves = null, offlineFilaPreparada = null, offlineFilaVarrida = null;`);
  return { app, AppState, base, linha: () => (els.prefOfflineDesc || {}).innerHTML || '' };
}

test('R9-4-02: ligar o "Disponível offline" SEM SINAL com o treino aberto guarda a fila REAL — a linha diz o que está no aparelho', async () => {
  const ligar = async (comTreino) => {
    const m = montarInterruptor();
    if (comTreino) m.app.Treino.entrar();
    m.app.offlineAoMudarInterruptor(true);
    await tiques(5);
    m.app.atualizarLinhaDoOffline(0, 0);
    const n = /\{"n":(\d+)\}/.exec(m.linha());
    return { linhaN: n ? Number(n[1]) : null, guardados: m.base.fila ? ids(m.base.fila.places) : [],
      exemplos: comTreino ? soExemplos(m.AppState.queue) : null };
  };
  const controle = await ligar(false);
  assert.deepEqual(controle, { linhaN: 4, guardados: ['u1', 'u2', 'u3', 'u4'], exemplos: null },
    'CONTROLE: sem o treino o interruptor não guardou a fila (ou a linha não a contou) — o teste perdeu o sentido');
  const r = await ligar(true);
  assert.equal(r.exemplos, true, 'PRÉ-CONDIÇÃO: o treino não pôs os exemplos na tela');
  assert.equal(r.linhaN, 4, 'a linha não contou os 4 pedidos reais');
  assert.deepEqual(r.guardados, ['u1', 'u2', 'u3', 'u4'],
    `DEFEITO: a linha diz "${r.linhaN} pedidos guardados" e o aparelho guardou ${JSON.stringify(r.guardados)} (R9-4-02)`);
});

// ═══ R9-4-03 · a linha com a fila guardada esperando o "Sair" do treino ══════
// A reabertura sem rede lê a fila guardada; o treino que abre durante a leitura
// a deixa ESPERANDO o "Sair" (R8-4-04) — a fila real do treino fica vazia. A
// linha contava a fila real (0) e dizia "Sem sinal agora. Vai preparar sozinho…"
// sobre uma fila preparada; depois do "Sair", "Pronto — 4 pedidos no aparelho".
// O texto é o mesmo de antes e de depois: a linha conta a fila que o treino guarda.
const JANELA = 1492385;
const AGORA = JANELA * 1200000 + 1000;
const T_FILA = 1785200000000;
function montarReabertura() {
  const log = [];
  const els = {};
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: true, loadError: false,
    queue: [], currentPlace: null, stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 0, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true } };
  const leituras = [];
  const guardada = () => ({ places: [P(91), P(92), P(93), P(94)], t: T_FILA, regiao: 'row', pais: 30, busca: 'b' });
  const deps = depsDoTreino(AppState, log, els, {
    offlineLigado: () => true, navigator: { onLine: false }, escapeHtml: (s) => s,
    OFFLINE_CICLO_MS: 1200000, Date: { now: () => AGORA },
    // A leitura da base: a 1ª espera o teste soltar; as seguintes respondem na hora.
    offlineLerFila: () => {
      if (leituras.length) { leituras.push('na hora'); return Promise.resolve(guardada()); }
      return new Promise((ok) => leituras.push(() => ok(guardada())));
    },
    // A última preparação COMPLETA cobriu esta fila (`filaCoberta` = o `t` dela).
    offlineLerRegistroDaJanela: async () => ({ janela: JANELA, t: AGORA - 5000, filaCoberta: T_FILA }),
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), filaGuardadaDestaConta: () => true,
    dfato: (k, v) => log.push(k + ':' + JSON.stringify(v)),
    semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
    pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {},
    t: (k, v) => (v ? k + JSON.stringify(v) : k),
  });
  delete deps.abrirGuardadaDepoisDoTreino;
  const app = montar(deps, ['mesmoLugar', 'chaveDoPedido', 'filaReal', 'filaGuardadaEsperandoOTreino', 'offlineRecuperarJanela',
    'offlineTentarAbrirSemRede', 'abrirGuardadaDepoisDoTreino', 'offlinePrecisaVarrer', 'atualizarLinhaDoOffline'],
  `let filaDeOnde = null, offlineFilaGravadaEm = null, offlineFilaGravadaChaves = null, ultimaBuscaFalhouPorRede = false,
     offlineJanelaServida = null, offlineFilaPreparada = null, offlineUltimoResultado = null, offlineVarrendo = false,
     offlineFilaVarrida = null;`);
  const linha = () => {
    app.atualizarLinhaDoOffline(0, 0);
    const html = (els.prefOfflineDesc || {}).innerHTML || '';
    return [...html.matchAll(/prefs\.offline\.\w+(\{"n":\d+\})?/g)].map((x) => x[0]).join(' ');
  };
  return { app, AppState, log, linha, soltar: () => leituras[0](), leituras };
}

test('R9-4-03: com a fila guardada esperando o "Sair" do treino, a linha conta ELA — "Pronto", como depois do "Sair"', async () => {
  // CONTROLE: sem o treino, a fila guardada abre, e a linha diz "Pronto — 4".
  const c = montarReabertura();
  const abrindoC = c.app.offlineTentarAbrirSemRede();
  await tique();
  c.soltar();
  assert.equal(await abrindoC, true, 'CONTROLE: a fila guardada não abriu');
  const pronto = 'prefs.offline.prontoAPlural{"n":4} prefs.offline.prontoSemRedeB';
  assert.equal(c.linha(), pronto, 'CONTROLE: com a fila guardada aberta, a linha não disse "Pronto — 4" — o teste perdeu o sentido');
  // Com o treino aberto DURANTE a leitura: a fila espera o "Sair".
  const m = montarReabertura();
  const abrindo = m.app.offlineTentarAbrirSemRede();
  await tique();
  m.app.Treino.entrar();                               // ⓘ → "Praticar" durante a leitura
  m.soltar();
  assert.equal(await abrindo, false, 'PRÉ-CONDIÇÃO: a fila guardada entrou por cima dos exemplos (R8-4-04)');
  assert.deepEqual(ids(m.app.filaReal()), [], 'PRÉ-CONDIÇÃO: a fila real do treino não ficou vazia');
  assert.equal(m.linha(), pronto,
    `DEFEITO: no treino, com a fila guardada esperando o "Sair", a linha disse "${m.linha()}" (R9-4-03)`);
  // E depois do "Sair": a mesma frase (a fila guardada entrou).
  m.app.Treino.sair();
  await tiques(6);
  assert.deepEqual(ids(m.AppState.queue), ['u91', 'u92', 'u93', 'u94'], 'o "Sair" não trouxe a fila guardada');
  assert.equal(m.linha(), pronto, 'depois do "Sair" a linha mudou de frase');
});

test('R9-4-03: CONTROLE — a fila guardada de OUTRO lugar não fica esperando nada: a linha segue "sem sinal" no treino', async () => {
  const m = montarReabertura();
  m.app.Treino.entrar();
  assert.equal(m.app.filaGuardadaEsperandoOTreino(), null, 'sem leitura anotada, o treino diz que há fila guardada esperando');
  assert.equal(m.linha(), 'prefs.offline.vazioA prefs.offline.vazioB');
});

// ═══ A fonte única ═══════════════════════════════════════════════════════════
// Quem refaz a fila SEM gesto da pessoa (o perfil que chega, a rede que volta)
// passa pela função que respeita o treino aberto; o `resetQueue` direto nesses
// caminhos é como o treino volta a sair calado (R9-7-04).
test('R9-7-04: o perfil e a volta da rede refazem a fila só pela `refazerFilaReal` — nunca pelo `resetQueue` direto', () => {
  assert.match(fatiar('retomarBusca'), /if \(filaReal\(\)\.length === 0\) \{\s*refazerFilaReal\(\);/,
    'a volta da rede decide pela fila da TELA (no treino, os exemplos), ou refaz sem respeitar o treino');
  for (const nome of ['completarPerfilChegado', 'irProPaisDoPerfil', 'retomarBusca']) {
    const corpo = fatiar(nome);
    assert.doesNotMatch(corpo, /\bresetQueue\(\)/, `${nome} refaz a fila pelo \`resetQueue\` direto: com o treino aberto, ele o encerra calado`);
    assert.match(corpo, /\brefazerFilaReal\(/, `${nome} não refaz a fila pela \`refazerFilaReal\``);
  }
  const refazer = fatiar('refazerFilaReal');
  assert.match(refazer, /Treino\.ativo === true\) \{ Treino\.anotarFilaRefeita\(aviso\); return; \}/,
    'a `refazerFilaReal` não anota no treino aberto antes de refazer');
  assert.match(objetoDoTreino(), /if \(s\.refazerFila\) \{[^}]*\brefazerFilaReal\(s\.avisoDoPais\); return; \}/,
    'o `sair()` do treino não refaz a fila que o perfil mandou refazer');
});
