// A FILA REAL com o treino aberto, de novo (auditoria da rodada 10, 2026-10-07).
//
// O treino troca a fila da tela pela de EXEMPLOS e guarda a real
// (`Treino._salvo`) até o `sair()`. O lote 13 firmou a regra "nada que refaça a
// fila SEM gesto da pessoa encerra o treino por baixo dela" (R9-7-04); a rodada
// 10 achou o que ainda escapava, cada um MEDIDO no navegador pelos auditores com
// o controle sem o treino:
//   R10-1-01 — a TROCA DE CONTA pela renovação silenciosa (`esquecerOutraConta`)
//              refazia a fila pelo `resetQueue`, que ENCERRA o treino: a faixa
//              "nada é enviado ao Waze" sumia, o card da frente virava um pedido
//              da conta que entrou e o ✕ seguinte ia ao Waze no nome dela. E o
//              que o treino guardava — a fila e os exemplos, clones dela — era da
//              conta ANTERIOR. Com a área da anterior no filtro, a fila da tela
//              (os exemplos) contava como "há fila" sempre;
//   R10-7-02 — o aviso do país anotado no treino se perdia quando ele terminava
//              pelo ↻ (o "Aplicar" está em test/filtros-aplicar.test.mjs, com a
//              página dos Filtros de lá);
//   R10-4-04 — com a fila guardada do offline esperando o "Sair", desligar e
//              religar o "Disponível offline" apagava a base e deixava a
//              anotação: a linha dizia "4 pedidos guardados" com nada no aparelho;
//   R10-4-06 — o perfil que chega no treino anotava a recusa automática a todo
//              L6+AM, sem autor nenhum marcado: o relatório dizia que ela rodaria
//              no "Sair".
// (A observação do R10-7 — o aviso do treino por cima do card real depois do
// "Sair" — está em test/treino-avisos.test.mjs, com a pilha de avisos de lá.)
//
// Os testes RODAM o código de verdade — o objeto `Treino` e as funções, fatiados
// do app.js — num escopo só: o que o teste não fornece é um "buraco negro" que
// aceita qualquer chamada. Cada um tem o CONTROLE sem o treino (o desfecho de
// sempre, que valida o instrumento), e foi visto REPROVANDO com o conserto
// desfeito (as sabotagens estão no relatório do lote 14).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fechar(txt, i, abre = '{', fecha = '}') {
  let prof = 0;
  for (let j = txt.indexOf(abre, i); j < txt.length; j++) {
    if (txt[j] === abre) prof++;
    else if (txt[j] === fecha) { prof--; if (prof === 0) return j + 1; }
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
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
// A declaração `const Treino = {…};` INTEIRA.
function treinoDeVerdade() {
  const m = /^const Treino = /m.exec(APP_SEM);
  assert.ok(m, 'o objeto Treino sumiu do app.js');
  return APP_SEM.slice(m.index, fechar(APP_SEM, m.index + m[0].length)) + ';';
}
// O `$('id').addEventListener('click', …)` INTEIRO, como está no
// `setupAppListeners`: pelos parênteses, nunca por distância (gotcha #67).
function ouvinte(id) {
  const corpo = fatiar('setupAppListeners');
  const marca = `$('${id}').addEventListener(`;
  const ini = corpo.indexOf(marca);
  assert.ok(ini >= 0, `o ouvinte de #${id} sumiu do setupAppListeners`);
  let par = 0, j = ini + marca.length - 1;
  for (; j < corpo.length; j++) {
    if (corpo[j] === '(') par++;
    else if (corpo[j] === ')') { par--; if (par === 0) break; }
  }
  return corpo.slice(ini, j + 1) + ';';
}

function buracoNegro() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro()),
    apply: () => buracoNegro(), set: () => true,
  });
}
// As funções de verdade num escopo só, com `deps` por fora: o que não está nem
// nelas nem no `globalThis` vira buraco negro. As variáveis de módulo que elas
// escrevem (`filaAtravessouSessao`, `offlineEpoca`…) moram em `deps`.
function rodar(deps, fontes, devolve) {
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : typeof k === 'string' ? buracoNegro() : undefined),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return new Function('__escopo', `with (__escopo) {\n${fontes.join('\n')}\nreturn { ${devolve.join(', ')} };\n}`)(escopo);
}
const tique = () => new Promise((ok) => setImmediate(ok));
const tiques = async (n) => { for (let i = 0; i < n; i++) await tique(); };

function elemento(iniciais = []) {
  const classes = new Set(iniciais);
  return {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)), replace: (a, b) => { if (classes.delete(a)) classes.add(b); } },
    textContent: '', innerHTML: '', removeAttribute() {}, setAttribute() {}, children: [],
  };
}
// Um pedido com a MARCA de quem o mandou (`PRIV` + o prefixo da conta): é por
// ela que se procura dado de terceiro onde ele não pode estar.
const PRIV = (pre, i, extra = {}) => ({ venueID: pre + i, updateRequestID: 'u' + pre + i, name: 'PadariaPRIV' + pre + i,
  address: 'RuaPRIV ' + pre + i, createdBy: 'autorPRIV' + pre + i, creatorId: 7000 + i, updateTypeKey: 'VENUE',
  purType: 'NEW_PLACE', imageUrls: [], mapa: { centro: [-23.5 - i / 1000, -46.6] },
  dateAdded: 1785203731191 - i * 1000, ...extra });
const ids = (fila) => (fila || []).map((p) => p.updateRequestID);
const lugares = (fila) => (fila || []).map((p) => p.venueID);
const soSinteticos = (fila) => (fila || []).length > 0 && fila.every((p) => !!p._exemplo);
// O que trava a ENTRADA no treino (`Treino.motivoDeRecusa`): sem isto o buraco
// negro — que é verdadeiro — a recusaria.
const LIVRE = () => ({ loteDeLidosEmVoo: false, aprovacaoPendente: null, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map() });

// ═══ R10-1-01 · a TROCA DE CONTA com o treino aberto ═══════════════════════════
// A sessão de X cai e a extensão renova em silêncio com a de Y. A fila na tela
// (com o treino aberto, a que ele guarda) é a de X, e ATRAVESSOU a sessão
// (`filaAtravessouSessao`). Quando o perfil (ou a ponte) diz que a conta é
// outra, o `esquecerOutraConta` tira do aparelho o que era de X e manda refazer
// a fila. Aqui rodam a troca, o `resetQueue`, a `refazerFilaReal`, o
// `offlineEsquecer` e o relatório do treino de verdade; o fechamento das camadas
// é de mentira (o "Treino concluído" aberto fecha pela limpeza dele: o `sair()`).
function montarTroca({ atravessou = true, area = false, fila = 'x' } = {}) {
  const log = [];
  const els = { treinoBanner: elemento(['hidden']) };
  const real = fila === 'vazia' ? [] : [1, 2, 3, 4].map((i) => PRIV(fila, i));
  const AppState = {
    authenticated: true, pendingAction: null, fetchEpoch: 5, fetching: false, hasMore: true, loadError: false,
    queue: real.slice(), currentPlace: real[0] || null, stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: real.length,
    autorEmFoco: null, preferences: { comoFuncionaVisto: true }, history: {}, conquistas: {},
    filters: { managedAreaId: area ? '5' : '', myArea: false, stateId: '' },
  };
  const base = { fila: { places: real.slice() } };   // a base do offline, com a fila guardada
  const fim = { aberto: false };                       // o "Treino concluído"
  let app = null;
  const deps = {
    AppState, ...LIVRE(), document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    t: (k, v) => k + (v && v.pais ? '(' + v.pais + ')' : ''),
    showToast: (m) => { log.push('toast:' + m); return { remover() {}, dispensar() {}, texto() {} }; },
    startFetching: () => log.push('busca'),
    showCurrentPlace: () => log.push('card:' + ((AppState.currentPlace || {}).venueID || '-')),
    carregarFilaDeSaida: () => [], safeLS: { get: () => null, set() {}, remove() {} },
    filaAtravessouSessao: atravessou,
    // O offline (o `offlineEsquecer` de verdade): a base e o cache.
    offlineEpoca: 0, offlineJanelaServida: 7, offlineUltimoResultado: 'pronto', offlineFilaGravadaEm: 1,
    offlineFilaGravadaChaves: null, offlineFilaPreparada: 1, offlineFilaVarrida: null, offlineFeitosNaJanela: null,
    diagTilesGuardadosQueFalharam: [],
    indexedDB: { deleteDatabase: () => { delete base.fila; log.push('base apagada'); } },
    window: { caches: true }, caches: { delete: async () => {} },
    OFFLINE_DB: 'waze_places_offline', OFFLINE_TILES_CACHE: 'waze-places-tiles', OFFLINE_POUSOS_KEY: 'waze_places_offline_pousos',
    // O relatório do treino (`diagSeguro` de verdade).
    DIAG_FUNDO: 12, Element: class {},
    // A fila nova (o `resetQueue` de verdade).
    pedidosQueEntraramNaFila: new Set(), bloqueadosPorPagina: new Map(),
    // O card trocado com o foco do teclado nele (o de verdade está em test/lightbox-foco-card).
    mantendoFocoNoCard: (redesenhar, opcoes) => { log.push('foco:' + JSON.stringify(opcoes || {})); redesenhar(); },
    fecharOQueEraDaContaAnterior: (comAFila) => {
      log.push('camadas' + (comAFila ? ' (todas)' : ''));
      if (comAFila && fim.aberto) { fim.aberto = false; app.Treino.sair(); }
    },
  };
  app = rodar(deps, [
    ...['filaReal', 'filaRealComDevolvidos', 'refazerFilaReal', 'resetQueue', 'esquecerOutraConta', 'offlineEsquecer',
      'diagSeguro', 'diagTreinoAgora', 'diagTreinoGuardado'].map(fatiar),
    treinoDeVerdade(),
  ], ['Treino', 'esquecerOutraConta', 'diagTreinoGuardado', 'filaReal']);
  return { app, AppState, log, els, base, fim, deps };
}

// O que a conta ANTERIOR deixou anotado no treino: a fila guardada do offline que
// a abertura sem rede leu nele, o perfil dela (o país, a recusa automática), um
// recusado de vez que voltaria no "Sair" e o foco num autor.
function anotarDaContaAnterior(m) {
  m.app.Treino.anotarFilaGuardada(4, 1785200000000);
  m.app.Treino.anotarFilaRefeita({ chave: 'toast.paisDoPerfil', pais: 'France', regiao: 'row', id: 73 });
  m.app.Treino.anotarPerfil();
  m.app.Treino.anotarRecusa();
  m.app.Treino._salvo.devolver.push(PRIV('x', 9));
  m.app.Treino._salvo.autorEmFoco = 7001;
}

test('R10-1-01: OUTRA conta na renovação silenciosa com o treino ABERTO — o treino segue, sem nada da conta anterior, e a fila de quem entrou vem no "Sair"', () => {
  // CONTROLE: sem o treino, a fila da conta anterior sai da tela e a de quem
  // entrou é buscada (K2) — o instrumento enxerga a troca.
  const c = montarTroca();
  c.app.esquecerOutraConta('5151');
  assert.deepEqual([ids(c.AppState.queue), c.log.filter((l) => l === 'busca')], [[], ['busca']],
    'CONTROLE: sem o treino a troca de conta não refez a fila — o teste perdeu o sentido');

  const m = montarTroca();
  m.app.Treino.entrar();
  anotarDaContaAnterior(m);
  assert.match(JSON.stringify(m.AppState.queue), /PRIVx/, 'PRÉ-CONDIÇÃO: os exemplos não são clones da fila da conta anterior');
  assert.match(JSON.stringify(m.app.diagTreinoGuardado()), /PRIVx/, 'PRÉ-CONDIÇÃO: o relatório do treino não leva a fila guardada');
  // O que o `derrubarSessao` guarda pra dizer "sua fila continua aqui" (a época da fila na tela).
  const filaDaQueda = m.AppState.fetchEpoch;
  // E a época da fila REAL guardada: é por ela que o ✕ da conta anterior, que a
  // queda devolve depois (`decisaoDepoisDaQueda`), acha a fila do gesto.
  const epocaDaFilaReal = m.app.Treino._salvo.epoca;
  const desde = m.log.length;
  m.app.esquecerOutraConta('5151');
  const depois = m.log.slice(desde);
  assert.equal(m.app.Treino.ativo, true,
    'DEFEITO: a troca de conta encerrou o treino CALADO — a faixa some e o ✕ seguinte vai ao Waze no nome de quem entrou (R10-1-01)');
  assert.ok(m.els.treinoBanner.classList.contains('flex'), 'a faixa "nada é enviado ao Waze" sumiu');
  assert.deepEqual(depois.filter((l) => l === 'busca'), [], 'a fila de quem entrou foi buscada com o treino aberto');
  assert.ok(depois.includes('toast:toast.outraConta'), 'o aviso da troca de conta não saiu');
  // Nada da conta anterior: nem nos exemplos (na tela e no relatório) nem no que o treino guarda pro "Sair".
  assert.ok(soSinteticos(m.AppState.queue),
    `DEFEITO: os exemplos na tela seguem clones dos pedidos da conta anterior (${lugares(m.AppState.queue)})`);
  assert.equal(m.app.Treino.restam, m.AppState.queue.length, 'o "Restam" do treino não acompanhou os exemplos novos');
  const iCard = depois.indexOf('card:' + m.AppState.queue[0].venueID);
  assert.ok(iCard >= 0, 'o card da frente não foi redesenhado com o exemplo');
  // O card é trocado SEM gesto, e o teclado pode estar no ✕ dele (a trava da
  // queda o devolve quando a sessão volta): o exemplo novo nasce guardando o foco.
  const iFoco = depois.indexOf('foco:{"mesmoBotao":true}');
  assert.ok(iFoco >= 0 && iFoco < iCard, `o exemplo novo não foi montado guardando o foco do teclado — ele caía no <body> (${depois.join(' | ')})`);
  for (const [onde, txt] of [['a fila da tela', JSON.stringify(m.AppState.queue)], ['o card da frente', JSON.stringify(m.AppState.currentPlace)],
    ['o relatório do treino', JSON.stringify(m.app.diagTreinoGuardado())]]) {
    assert.doesNotMatch(txt, /PRIV/, `DEFEITO: dado de terceiro da conta anterior ficou n${onde === 'a fila da tela' ? 'a' : 'o'} ${onde}: ${txt.slice(0, 160)}`);
  }
  const s = m.app.Treino._salvo;
  assert.deepEqual({ queue: s.queue, currentPlace: s.currentPlace, autorEmFoco: s.autorEmFoco, devolver: s.devolver,
    abrirGuardada: s.abrirGuardada, filaGuardadaLida: s.filaGuardadaLida, avisoDoPais: s.avisoDoPais,
    perfilChegou: s.perfilChegou, recusaPedida: s.recusaPedida, refazerFila: s.refazerFila },
  { queue: [], currentPlace: null, autorEmFoco: null, devolver: [], abrirGuardada: false, filaGuardadaLida: null,
    avisoDoPais: null, perfilChegou: false, recusaPedida: false, refazerFila: true },
  'o treino guardou o que era da conta anterior (ou não anotou a fila de quem entrou pro "Sair")');
  assert.notEqual(m.AppState.fetchEpoch, filaDaQueda,
    'a fila da tela mudou e a época não: a renovação da queda diria "sua fila continua aqui" depois do "Outra conta entrou"');
  // O ✕ da conta anterior que volta recusado depois da troca acha uma fila
  // REFEITA: não espera o "Sair" no treino de quem entrou (nem vai no relatório dele).
  assert.equal(m.app.Treino.guardarDevolucao(PRIV('x', 8), epocaDaFilaReal), false,
    'o recusado da conta anterior ficou guardado no treino de quem entrou');
  assert.deepEqual(m.app.Treino._salvo.devolver, []);
  // O "Sair": a fila de quem entrou é buscada, e o aviso de país da conta anterior não sai.
  const antesDoSair = m.log.length;
  m.app.Treino.sair();
  const noSair = m.log.slice(antesDoSair);
  assert.equal(m.app.Treino.ativo, false);
  assert.deepEqual(noSair.filter((l) => l === 'busca'), ['busca'], 'o "Sair" não buscou a fila de quem entrou');
  assert.deepEqual(ids(m.AppState.queue), [], 'o "Sair" devolveu a fila da conta anterior');
  assert.ok(!noSair.some((l) => l.startsWith('toast:toast.paisDoPerfil')), 'o aviso de país da conta ANTERIOR saiu pra quem entrou');
});

test('R10-1-01: com o "Treino concluído" aberto, a troca de conta fecha o diálogo e busca a fila de quem entrou UMA vez — sem mostrar a da anterior', () => {
  const m = montarTroca();
  m.app.Treino.entrar();
  // Os exemplos acabaram (`Treino.agir` no último): o diálogo final está aberto.
  m.AppState.queue = [];
  m.AppState.currentPlace = null;
  m.fim.aberto = true;
  const desde = m.log.length;
  m.app.esquecerOutraConta('5151');
  const depois = m.log.slice(desde);
  assert.equal(m.fim.aberto, false, 'PRÉ-CONDIÇÃO: o fechamento das camadas não fechou o "Treino concluído"');
  assert.equal(m.app.Treino.ativo, false, 'o fechamento do diálogo (o "Ir para a fila") não saiu do treino');
  assert.ok(!depois.some((l) => /^card:x/.test(l)),
    `DEFEITO: o "Sair" do diálogo mostrou a fila da conta ANTERIOR antes de refazê-la (${depois.join(' | ')})`);
  assert.deepEqual(depois.filter((l) => l === 'busca'), ['busca'],
    'a fila de quem entrou foi buscada mais de uma vez — uma busca jogada fora no free tier');
  assert.deepEqual(ids(m.AppState.queue), []);
});

test('R10-1-01: CONTROLE — a fila nascida NESTA sessão (o login já disse a conta) não sai do treino: nada a trocar, nada a buscar', () => {
  const m = montarTroca({ atravessou: false });
  m.app.Treino.entrar();
  const exemplos = lugares(m.AppState.queue);
  m.app.esquecerOutraConta('5151');
  assert.equal(m.app.Treino.ativo, true);
  assert.deepEqual(lugares(m.AppState.queue), exemplos, 'os exemplos da fila de quem entrou foram trocados sem motivo');
  assert.deepEqual(ids(m.app.filaReal()), ['ux1', 'ux2', 'ux3', 'ux4'], 'a fila guardada (de quem entrou) saiu do treino');
  assert.equal(m.app.Treino._salvo.refazerFila, false, 'uma fila desta sessão foi mandada refazer: uma busca a mais');
  assert.deepEqual(m.log.filter((l) => l === 'busca'), []);
});

test('R10-1-01 (a hipótese do auditor): a ÁREA da conta anterior no filtro, com o treino aberto — quem conta é a fila REAL, nunca os exemplos', () => {
  // CONTROLE: sem o treino, a fila que saiu filtrada pela área da anterior é
  // refeita, e a área sai do filtro (F4).
  const c = montarTroca({ atravessou: false, area: true, fila: 'y' });
  c.app.esquecerOutraConta('5151');
  assert.deepEqual([c.AppState.filters.managedAreaId, c.log.filter((l) => l === 'busca')], ['', ['busca']],
    'CONTROLE: sem o treino a fila filtrada pela área da conta anterior não foi refeita — o teste perdeu o sentido');
  // A fila real é de QUEM ENTROU (a busca saiu com a sessão dela), filtrada pela
  // área da anterior: o treino segue, os exemplos ficam — são dela — e o "Sair" refaz.
  const m = montarTroca({ atravessou: false, area: true, fila: 'y' });
  m.app.Treino.entrar();
  const exemplos = lugares(m.AppState.queue);
  m.app.esquecerOutraConta('5151');
  assert.equal(m.app.Treino.ativo, true, 'DEFEITO: a área da conta anterior encerrou o treino por baixo da pessoa');
  assert.deepEqual(lugares(m.AppState.queue), exemplos, 'os exemplos da própria fila de quem entrou foram trocados');
  assert.equal(m.app.Treino._salvo.refazerFila, true, 'a fila que saiu pela área da anterior não ficou pra refazer no "Sair"');
  assert.deepEqual(m.log.filter((l) => l === 'busca'), [], 'a fila foi buscada com o treino aberto');
  m.app.Treino.sair();
  assert.deepEqual(m.log.filter((l) => l === 'busca'), ['busca'], 'o "Sair" não refez a fila');
  // A fila real VAZIA: nada saiu pela área — e os EXEMPLOS não contam como fila.
  const v = montarTroca({ atravessou: false, area: true, fila: 'vazia' });
  v.app.Treino.entrar();
  assert.ok(soSinteticos(v.AppState.queue), 'PRÉ-CONDIÇÃO: com a fila real vazia, o treino não pôs os exemplos sintéticos');
  v.app.esquecerOutraConta('5151');
  assert.equal(v.app.Treino.ativo, true,
    'DEFEITO: os EXEMPLOS contaram como a fila que saiu pela área da conta anterior, e o treino foi encerrado');
  assert.equal(v.app.Treino._salvo.refazerFila, false, 'a fila real vazia foi mandada refazer');
  assert.equal(v.AppState.filters.managedAreaId, '', 'a área da conta anterior ficou no filtro');
});

// ═══ R10-7-02 · o aviso do país quando o treino termina pelo ↻ ═════════════════
// O perfil diz que a pessoa edita OUTRO país com o treino aberto: o lugar muda já
// e o aviso "Mostrando a fila de France…" fica anotado pro "Sair" (R9-7-04). O ↻
// encerra o treino pelo `resetQueue`, que levava o `_salvo` — e o aviso — junto.
// Aqui rodam o ouvinte do ↻ como está no `setupAppListeners`, o
// `irProPaisDoPerfil`, o `resetQueue`, a `refazerFilaReal` e o `Treino` de verdade.
function montarRefresh() {
  const log = [];
  const els = { treinoBanner: elemento(['hidden']) };
  const lugar = { regiao: 'row', pais: 30 };
  const real = [1, 2, 3].map((i) => PRIV('b', i));
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: true,
    queue: real.slice(), currentPlace: real[0], stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 3, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true }, filters: { myArea: false, stateId: '', managedAreaId: '' },
    countries: [{ id: 30, name: 'Brazil' }, { id: 73, name: 'France' }], statesByCountry: {} };
  const ouvintes = {};
  const deps = {
    AppState, ...LIVRE(), navigator: { onLine: true }, epocaDaSessao: 0,
    document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    $: (id) => ({ addEventListener: (ev, fn) => { ouvintes[id] = fn; } }),
    API: { getRegion: () => lugar.regiao, getCountry: () => lugar.pais, setRegion: (r) => { lugar.regiao = r; },
      setCountry: (p) => { lugar.pais = Number(p); } },
    t: (k, v) => k + (v && v.pais ? '(' + v.pais + ')' : ''),
    showToast: (m) => { log.push('toast:' + m); return { remover() {}, dispensar() {}, texto() {} }; },
    startFetching: () => log.push('busca:' + lugar.regiao + '/' + lugar.pais),
    pedidosQueEntraramNaFila: new Set(), bloqueadosPorPagina: new Map(),
  };
  const app = rodar(deps, [
    ...['filaReal', 'refazerFilaReal', 'resetQueue', 'avisarPaisDoTreinoEncerrado', 'irProPaisDoPerfil'].map(fatiar),
    treinoDeVerdade(), ouvinte('refreshBtn'),
  ], ['Treino', 'irProPaisDoPerfil']);
  return { app, AppState, log, lugar, ouvintes };
}

test('R10-7-02: o ↻ que encerra o treino traz o aviso do país que o perfil anotou nele — como o "Sair"', async () => {
  // CONTROLE: pelo "Sair" (o conserto do R9-7-04), a fila da França vem com o aviso.
  const c = montarRefresh();
  c.app.Treino.entrar();
  await c.app.irProPaisDoPerfil({ regiao: 'row', pais: 73 });
  assert.deepEqual([c.app.Treino.ativo, c.lugar.pais, c.log.filter((l) => l.startsWith('toast:'))], [true, 73, []],
    'PRÉ-CONDIÇÃO: o perfil não anotou o país no treino (ou o aviso saiu com os exemplos na tela)');
  c.app.Treino.sair();
  assert.deepEqual(c.log.filter((l) => /^(toast|busca)/.test(l)), ['toast:toast.paisDoPerfil(France)', 'busca:row/73'],
    'CONTROLE: o "Sair" não trouxe a fila da França com o aviso — o teste perdeu o sentido');
  // Pelo ↻.
  const m = montarRefresh();
  m.app.Treino.entrar();
  await m.app.irProPaisDoPerfil({ regiao: 'row', pais: 73 });
  m.ouvintes.refreshBtn();
  assert.equal(m.app.Treino.ativo, false, 'PRÉ-CONDIÇÃO: o ↻ não encerrou o treino');
  assert.deepEqual(m.log.filter((l) => /^(toast|busca)/.test(l)),
    ['busca:row/73', 'toast:toast.refreshing', 'toast:toast.paisDoPerfil(France)'],
    `DEFEITO: o ↻ trouxe a fila da França sem o aviso do país (${m.log.join(' | ')}) — R10-7-02`);
});

test('R10-7-02: CONTROLE — o ↻ no treino SEM aviso anotado não inventa um', () => {
  const m = montarRefresh();
  m.app.Treino.entrar();
  m.ouvintes.refreshBtn();
  assert.deepEqual(m.log.filter((l) => /^(toast|busca)/.test(l)), ['busca:row/30', 'toast:toast.refreshing']);
});

// ═══ R10-4-04 · o "Disponível offline" desligado e religado no treino ═══════════
// A reabertura sem rede leu a fila guardada (4 pedidos) com o treino aberto: ela
// espera o "Sair" dele (R8-4-04), e a linha a conta (R9-4-03). Desligar o
// interruptor apaga a base (`offlineEsquecer`); religar grava a fila REAL, que no
// treino está vazia. A anotação ficava, e a linha dizia "4 pedidos guardados"
// com nada no aparelho. Aqui rodam o interruptor, o `offlineEsquecer`, a gravação
// e a linha de verdade, sobre uma base de mentira.
const JANELA_AGORA = () => Math.floor(Date.now() / 1200000);
const T_FILA = 1785200000000;
function montarInterruptor({ comTreino }) {
  const els = {};
  const guardada = [1, 2, 3, 4].map((i) => PRIV('g', i));
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    // Sem o treino, a fila guardada ABRIU (é a da tela); com ele, ela espera o "Sair".
    queue: comTreino ? [] : guardada.slice(), currentPlace: comTreino ? null : guardada[0],
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 0, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true, offlineDisponivel: true }, filters: { myArea: false } };
  const base = { fila: { places: guardada.slice(), t: T_FILA } };
  const deps = {
    AppState, ...LIVRE(), navigator: { onLine: false }, escapeHtml: (s) => s,
    document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    OFFLINE_CICLO_MS: 1200000, OFFLINE_STORE: 'fila', OFFLINE_DB: 'waze_places_offline',
    OFFLINE_TILES_CACHE: 'waze-places-tiles', OFFLINE_POUSOS_KEY: 'waze_places_offline_pousos',
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), contaAgora: () => '111',
    marcaDaSessao: (t) => 'm-' + t, marcaDestaAba: () => 'm-tok', API: { getSession: () => 'tok' },
    safeLS: { get: () => null, set() {}, remove() {} },
    t: (k, v) => (v ? k + JSON.stringify(v) : k),
    // A base do offline: o `put` grava, e a transação fecha num tique; apagar a apaga.
    offlineDB: async () => ({ close() {}, transaction: () => {
      const tx = { objectStore: () => ({ put: (v, k) => { base[k] = JSON.parse(JSON.stringify(v)); setTimeout(() => tx.oncomplete()); } }) };
      return tx;
    } }),
    indexedDB: { deleteDatabase: () => { delete base.fila; } },
    window: { caches: true }, caches: { delete: async () => {} },
    // A última preparação COMPLETA cobriu a fila guardada (`filaCoberta` = o `t` dela), nesta janela.
    filaDeOnde: { regiao: 'row', pais: '30', busca: 'b' }, offlineVarrendo: false, offlinePedidaDeNovo: false,
    offlineUltimoGesto: Date.now(), offlineJanelaServida: JANELA_AGORA(), offlineUltimoResultado: null, offlineEpoca: 0,
    offlineFilaGravadaEm: comTreino ? null : T_FILA, offlineFilaGravadaChaves: null, offlineFilaPreparada: T_FILA,
    offlineFilaVarrida: null, offlineFeitosNaJanela: null, diagTilesGuardadosQueFalharam: [],
  };
  const app = rodar(deps, [
    ...['chaveDoPedido', 'filaReal', 'filaGuardadaEsperandoOTreino', 'offlineLigado', 'offlineGravarFila', 'offlineMarcarGesto',
      'offlinePrecisaVarrer', 'atualizarLinhaDoOffline', 'offlineAoMudarInterruptor', 'offlineEsquecer'].map(fatiar),
    treinoDeVerdade(),
  ], ['Treino', 'offlineAoMudarInterruptor', 'offlineEsquecer', 'filaGuardadaEsperandoOTreino', 'atualizarLinhaDoOffline']);
  const linha = () => {
    app.atualizarLinhaDoOffline(0, 0);
    const html = (els.prefOfflineDesc || {}).innerHTML || '';
    return [...html.matchAll(/prefs\.offline\.\w+(\{"n":\d+\})?/g)].map((x) => x[0]).join(' ');
  };
  return { app, AppState, base, linha };
}

test('R10-4-04: no treino, desligar e religar o "Disponível offline" apaga a fila guardada — e a linha deixa de dizer que ela está no aparelho', async () => {
  // CONTROLE: sem o treino, a fila guardada está na tela: o religar a grava de
  // novo, e a linha conta o que está no aparelho.
  const c = montarInterruptor({ comTreino: false });
  c.app.offlineAoMudarInterruptor(false);
  c.app.offlineAoMudarInterruptor(true);
  await tiques(5);
  assert.deepEqual([c.base.fila ? ids(c.base.fila.places) : [], c.linha()],
    [['ug1', 'ug2', 'ug3', 'ug4'], 'prefs.offline.esperaAPlural{"n":4} prefs.offline.esperaB'],
    'CONTROLE: sem o treino o religar não regravou a fila (ou a linha não a contou) — o teste perdeu o sentido');
  // Com o treino: a fila guardada espera o "Sair" dele.
  const m = montarInterruptor({ comTreino: true });
  m.app.Treino.entrar();
  m.app.Treino.anotarFilaGuardada(4, T_FILA);
  assert.equal(m.linha(), 'prefs.offline.prontoAPlural{"n":4} prefs.offline.prontoSemRedeB',
    'PRÉ-CONDIÇÃO: a linha não contou a fila guardada que espera o "Sair" (R9-4-03)');
  m.app.offlineAoMudarInterruptor(false);
  m.app.offlineAoMudarInterruptor(true);
  await tiques(5);
  assert.equal(m.base.fila, undefined, 'PRÉ-CONDIÇÃO: o desligar não apagou a base (ou o religar gravou os exemplos)');
  assert.equal(m.linha(), 'prefs.offline.vazioA prefs.offline.vazioB',
    `DEFEITO: a linha diz "${m.linha()}" com a base VAZIA — a anotação do treino sobreviveu ao esquecer (R10-4-04)`);
  assert.equal(m.app.filaGuardadaEsperandoOTreino(), null, 'o treino segue dizendo que a fila guardada espera o "Sair"');
  assert.equal(m.app.Treino._salvo.abrirGuardada, false, 'o "Sair" do treino ainda tentaria abrir a fila guardada que saiu');
});

test('R10-4-04: o esquecer feito NOUTRA aba (`soMemoria`: a base já saiu por lá) também solta a anotação do treino', async () => {
  const m = montarInterruptor({ comTreino: true });
  m.app.Treino.entrar();
  m.app.Treino.anotarFilaGuardada(4, T_FILA);
  await m.app.offlineEsquecer({ soMemoria: true });
  assert.equal(m.app.filaGuardadaEsperandoOTreino(), null, 'a anotação da fila que a outra aba apagou ficou no treino');
  assert.ok(m.base.fila, 'o "só memória" apagou a base daqui');
});

// ═══ R10-4-06 · a recusa automática anotada no treino SEM o que recusar ════════
// O perfil que chega com o treino aberto roda a recusa automática (é de L6+AM),
// que no treino só ANOTA pro "Sair" (R8-7-03). Ela anotava antes de olhar se havia
// alvo: todo relatório de L6+AM feito no treino depois do perfil dizia "a recusa
// automática pedida com o treino aberto roda no Sair", sem autor nenhum marcado.
// Aqui rodam a recusa, o `Treino` e o relatório de verdade.
const P = (id, autor) => ({ venueID: 'v' + id, updateRequestID: 'u' + id, name: 'Local ' + id, creatorId: autor,
  createdBy: 'autor' + autor, updateTypeKey: 'VENUE', imageUrls: [], dateAdded: 1785203731191 - id * 1000 });
function montarRecusa({ fila, ligados = [], andamento = [] }) {
  const log = [];
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: fila.slice(), currentPlace: fila[0], stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: fila.length,
    autorEmFoco: null, preferences: { comoFuncionaVisto: true } };
  const deps = {
    AppState, ...LIVRE(), document: { getElementById: () => elemento() }, t: (k) => k,
    showToast: () => ({ texto() {}, dispensar() {}, remover() {} }),
    podeRecusarAutomaticoAqui: () => true, contaConfirmada: () => true, autoLigado: (id) => ligados.includes(id),
    pedidosEmAndamento: new Set(andamento),
    recusaAutomaticaRodando: false, recusaAutomaticaPedidaDeNovo: false, recusaAutomaticaNestaFila: false,
    enviarLote: async (alvos) => { log.push(...alvos.map((p) => 'rejeita:' + p.updateRequestID)); },
    API: { getRegion: () => 'row' }, carimboDoGesto: () => null, DIAG_FUNDO: 12, Element: class {},
  };
  const app = rodar(deps, [
    ...['chaveDoPedido', 'filaReal', 'aplicarRecusaAutomatica', 'diagSeguro', 'diagTreinoAgora', 'diagTreinoGuardado'].map(fatiar),
    treinoDeVerdade(),
  ], ['Treino', 'aplicarRecusaAutomatica', 'diagTreinoGuardado']);
  return { app, AppState, log };
}

const CASOS_DA_RECUSA = [
  // O autor 777 marcado, com um pedido na fila real (que não é o da frente): há o que recusar.
  { caso: 'o autor marcado tem pedido na fila real', fila: [P(1, 1), P(2, 777), P(3, 2)], ligados: [777],
    anota: true, controle: ['rejeita:u2'] },
  // Nenhum autor marcado: o perfil de todo L6+AM chegando no treino.
  { caso: 'nenhum autor marcado', fila: [P(1, 1), P(2, 777), P(3, 2)], ligados: [], anota: false, controle: [] },
  // O único pedido do autor é o card da FRENTE da fila real — o que volta à tela no
  // "Sair", e que a recusa deixa de fora (o interruptor diz "os PRÓXIMOS").
  { caso: 'o único pedido do autor é o card da frente', fila: [P(1, 777), P(2, 1)], ligados: [777], anota: false, controle: [] },
  // O único pedido do autor está EM ANDAMENTO (a aprovação de foto no ar): duas decisões.
  { caso: 'o único pedido do autor está em andamento', fila: [P(1, 1), P(2, 777)], ligados: [777], andamento: ['v2|u2'],
    anota: false, controle: [] },
];

for (const { caso, fila, ligados, andamento, anota, controle } of CASOS_DA_RECUSA) {
  test(`R10-4-06: no treino, a recusa automática só fica pedida pro "Sair" com o que recusar na fila real — ${caso}`, async () => {
    // CONTROLE: fora do treino, a mesma fila e os mesmos autores — a recusa age (ou não) assim.
    const c = montarRecusa({ fila, ligados, andamento });
    await c.app.aplicarRecusaAutomatica();
    await tiques(3);
    assert.deepEqual(c.log, controle, 'CONTROLE: fora do treino a recusa não agiu como de costume — o teste perdeu o sentido');
    const m = montarRecusa({ fila, ligados, andamento });
    m.app.Treino.entrar();
    await m.app.aplicarRecusaAutomatica();
    await tiques(3);
    assert.deepEqual(m.log, [], 'a recusa automática agiu com o treino aberto');
    assert.equal(m.app.Treino._salvo.recusaPedida, anota,
      anota ? 'a recusa com alvo na fila real não ficou pedida pro "Sair" (R8-7-03)'
        : 'DEFEITO: a recusa ficou pedida pro "Sair" sem nada a recusar — o relatório diz que ela vai rodar (R10-4-06)');
    assert.equal(m.app.diagTreinoGuardado().recusaPedida, anota, 'o relatório do treino não diz o que o treino guarda');
  });
}
