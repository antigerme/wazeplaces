// O TREINO de novo (auditoria da rodada 11, 2026-10-07).
//
// O treino troca a fila da tela pela de EXEMPLOS e guarda a real
// (`Treino._salvo`) até o `sair()`. A rodada 11 achou o que ainda escapava,
// cada um MEDIDO no navegador pelo auditor, com o controle ao lado:
//   R11-7-01 — uma busca que COMEÇOU antes do treino e voltou DENTRO dele (a
//              abertura com rede lenta, ⓘ → "Praticar") seguia o `startFetching`:
//              com os exemplos acabados ("Treino concluído"), o laço chamava o
//              `fetchNextPage`, que no treino volta sem mudar nada — a aba
//              CONGELAVA (o laço do gotcha #19); com exemplos na fila, o card de
//              treino era redesenhado e o foco do teclado caía no <body>;
//   R11-7-02 — outra conta entrando com o treino aberto apagava o "já viu o Como
//              funciona", e o "Sair" do treino abria o diálogo por cima do 1º card
//              de quem entrou (pelo teclado, o Enter seguinte voltava ao treino);
//   R11-7-03 — a renovação da queda com o treino aberto guardava a época dos
//              EXEMPLOS: com a fila refeita no "Sair" (outro país), "sua fila
//              continua aqui" saía junto do "Mostrando a fila do país…"; sem o
//              refazer, a fila continuava e o aviso não saía;
//   R11-7-05 — o ↑ do treino dizia "pular daria ⭐" num exemplo de pedido que JÁ
//              tem a estrela, onde o ↑ de verdade não manda nada.
//
// Os testes RODAM o código de verdade — o objeto `Treino` e as funções, fatiados
// do app.js — num escopo só: o que o teste não fornece é um "buraco negro" que
// aceita qualquer chamada. Cada um tem o CONTROLE (o desfecho de sempre, que
// valida o instrumento) e foi visto REPROVANDO com o conserto desfeito (as
// sabotagens estão no relatório do lote 15).
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

function buracoNegro() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro()),
    apply: () => buracoNegro(), set: () => true,
  });
}
// As funções de verdade num escopo só, com `deps` por fora: o que não está nem
// nelas nem no `globalThis` vira buraco negro. As variáveis de módulo que elas
// escrevem (`ultimaBuscaFalhouPorRede`, `filaDeOnde`…) moram em `deps`.
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
// Espera por CONDIÇÃO, com teto: um prazo fixo mede a velocidade da máquina.
async function ateQue(cond, rotulo, voltas = 500) {
  for (let i = 0; i < voltas; i++) { if (cond()) return; await tique(); }
  assert.fail(`${rotulo}: não aconteceu`);
}

function elemento(iniciais = []) {
  const classes = new Set(iniciais);
  return {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)), replace: (a, b) => { if (classes.delete(a)) classes.add(b); } },
    textContent: '', innerHTML: '', removeAttribute() {}, setAttribute() {}, children: [],
  };
}
// O que trava a ENTRADA no treino (`Treino.motivoDeRecusa`): sem isto o buraco
// negro — que é verdadeiro — a recusaria.
const LIVRE = () => ({ loteDeLidosEmVoo: false, aprovacaoPendente: null, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map() });
const P = (n, extra = {}) => ({ venueID: 'v' + n, updateRequestID: 'u' + n, name: 'Local ' + n, updateTypeKey: 'VENUE',
  purType: 'NEW_PLACE', imageUrls: [], mapa: null, dateAdded: 1785203731191 - n * 1000, ...extra });

// "Praticar" e os exemplos até o fim — o "Treino concluído" aberto, com a fila
// da tela (a de exemplos) VAZIA. `ate`: quantos tratar (todos, por padrão).
function praticar(app, AppState, ate = Infinity) {
  app.Treino.entrar();
  assert.equal(app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: o treino não abriu');
  for (let i = 0; i < ate && AppState.queue.length; i++) app.Treino.agir('read');
}

// ═══ R11-7-01 · a busca que volta DENTRO do treino ═══════════════════════════
// Rodam o `startFetching`, o `fetchNextPage`, o `maybePrefetch` e o `Treino` de
// verdade. O `fetchNextPage` de verdade está lá com OUTRO nome, e quem o chama
// passa por um CONTADOR com teto: no defeito o laço gira em microtarefas, e um
// teste que esperasse por ele penduraria pra sempre (o gotcha #19 dentro do
// instrumento — timer nenhum dispara com a fila de microtarefas cheia). Passado
// o teto, o contador encerra o laço (`hasMore = false`) e anota que ele girou.
const TETO_DO_LACO = 50;

// `myArea`: "Minha área" ligada. `perfil`: o perfil já na mão (com as áreas).
// `perfilNoAr`/`caixaNoAr`: a busca espera o perfil, ou a decisão da caixa.
function montarBusca({ myArea = false, perfil = true, perfilNoAr = false, caixaNoAr = false, guardadaNoAr = false } = {}) {
  const log = [];
  const els = {};
  const buscas = [];   // cada ida ao Waze, segurada: { pagina, soltar(resposta) }
  const esperas = {};  // o perfil, a caixa e a fila guardada no ar
  const AppState = {
    authenticated: true, fetchEpoch: 0, fetching: false, _fetchPromise: null, hasMore: true, loadError: false,
    queue: [], currentPlace: null, pendingAction: null, autorEmFoco: null, serverTotal: 0, serverBlocked: 0,
    stats: { read: 0, rejected: 0, skipped: 0 }, preferences: { comoFuncionaVisto: true, pularGuarda: false },
    filters: { myArea, types: [], residential: '', stateId: '', managedAreaId: '', categories: [], unreadOnly: true },
    profile: perfil ? { id: 1, areas: [{ id: 5, bbox: [-39, -13.5, -38, -12.5] }] } : null,
    _profilePromise: null, _caixaDaMinhaAreaNoAr: null,
  };
  const segurar = (nome, aoSoltar) => new Promise((ok) => { esperas[nome] = (v) => { if (aoSoltar) aoSoltar(); ok(v); }; });
  if (perfilNoAr) AppState._profilePromise = segurar('perfil', () => { AppState.profile = { id: 1, areas: [{ id: 5, bbox: [-39, -13.5, -38, -12.5] }] }; AppState._profilePromise = null; });
  if (caixaNoAr) AppState._caixaDaMinhaAreaNoAr = segurar('caixa', () => { AppState._caixaDaMinhaAreaNoAr = null; });
  const contagem = { chamadas: 0, girou: false };
  let app = null;
  const deps = {
    AppState, ...LIVRE(),
    document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    navigator: { onLine: true },
    t: (k) => k,
    showToast: () => ({ remover() {} }),
    showLoading: (v) => log.push('carregando:' + v),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; log.push('card:' + ((AppState.currentPlace || {}).venueID || '-')); },
    showNoPlaces: () => log.push('fila vazia'),
    removeCurrentCardEl: () => log.push('tirou o card'),
    openModal: (id) => log.push('modal:' + id),
    lerServidorDaMinhaArea: () => { log.push('perguntou ao servidor da área'); return null; },
    abrirGuardadaDepoisDaFalha: () => (guardadaNoAr ? segurar('guardada') : Promise.resolve(false)),
    API: { fetchPlaces: (pagina) => new Promise((ok) => buscas.push({ pagina, soltar: ok })) },
    semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
    semOsQueJaPassaramPelaFila: (places) => ({ places: places.slice(), repetidos: 0 }),
    pedidosQueEntraramNaFila: new Set(), bloqueadosPorPagina: new Map(),
    TYPES_ALL: ['NEW_PLACE', 'NEW_PHOTO'], PREFETCH_THRESHOLD: 3, MAX_EMPTY_PAGES: 5, MAX_PAGINAS_POR_BUSCA: 20,
    ordemDoWaze: () => 'SORTING_UPDATE_TIME_DESC', ordemPrecisaDaFilaInteira: () => false,
    caixaDaMinhaAreaEm: () => [-39, -13.5, -38, -12.5], lugarAgora: () => ({ regiao: 'row', pais: '30' }),
    ultimaBuscaFalhouPorRede: false, buscaSemResposta: false, rebuscasAuto: 0, filaEsperaPerfil: false,
    buscaEsperaOPerfil: false, filaDeOnde: null,
    fetchNextPage: () => {
      contagem.chamadas++;
      if (contagem.chamadas > TETO_DO_LACO) { contagem.girou = true; AppState.hasMore = false; }
      return app.fetchNextPageDeVerdade();
    },
  };
  app = rodar(deps, [
    fatiar('startFetching'), fatiar('maybePrefetch'),
    fatiar('fetchNextPage').replace(/^function fetchNextPage\(/, 'function fetchNextPageDeVerdade('),
    treinoDeVerdade(),
  ], ['startFetching', 'fetchNextPageDeVerdade', 'Treino']);
  return { app, AppState, deps, log, buscas, esperas, contagem };
}

// O que a busca retomada fez DEPOIS de voltar — com o treino aberto, nada.
function depoisDaVolta(m, desde, chamadasAntes) {
  return { girou: m.contagem.girou, voltasDoLaco: m.contagem.chamadas - chamadasAntes, tela: m.log.slice(desde) };
}

test('R11-7-01: CONTROLE — sem o treino, a busca que volta termina o `startFetching` (o card aparece) — o instrumento enxerga o fim', async () => {
  const m = montarBusca();
  const busca = m.app.startFetching();
  await tiques(3);
  assert.equal(m.buscas.length, 1, 'PRÉ-CONDIÇÃO: a busca da abertura não saiu');
  const desde = m.log.length;
  m.buscas[0].soltar({ success: true, places: [P(1), P(2)], hasMore: false });
  await busca;
  assert.deepEqual(m.log.slice(desde), ['carregando:false', 'card:v1'], 'CONTROLE: o fim do startFetching não chegou à tela');
  assert.equal(m.contagem.girou, false);
});

test('R11-7-01 (a): a busca da abertura volta com o "Treino concluído" aberto — o `startFetching` termina sem girar, e o "Ir para a fila" traz a fila numa busca', async () => {
  const m = montarBusca();
  const busca = m.app.startFetching();
  await tiques(3);
  assert.equal(m.buscas.length, 1, 'PRÉ-CONDIÇÃO: a busca da abertura não saiu');
  // "Carregando…" com rede lenta: ⓘ → "Praticar" e os três exemplos antes de ela voltar.
  praticar(m.app, m.AppState);
  assert.equal(m.AppState.queue.length, 0, 'PRÉ-CONDIÇÃO: os exemplos não acabaram (o "Treino concluído")');
  const desde = m.log.length;
  const chamadasAntes = m.contagem.chamadas;
  m.buscas[0].soltar({ success: true, places: [P(1), P(2)], hasMore: false });
  await busca;   // termina sempre: o laço tem teto (ver o contador)
  const r = depoisDaVolta(m, desde, chamadasAntes);
  assert.equal(r.girou, false,
    `DEFEITO: o laço do startFetching girou com o treino aberto (${r.voltasDoLaco} voltas até o teto) — no app, a aba CONGELA (R11-7-01)`);
  assert.deepEqual(r.tela, [], `a busca que voltou dentro do treino mexeu na tela: ${r.tela.join(' | ')}`);
  assert.equal(m.app.Treino.ativo, true);
  assert.deepEqual(m.AppState.queue, [], 'os pedidos da busca descartada entraram na fila de exemplos');
  // O "Ir para a fila" (o `sair()`): a fila REAL vem, numa busca só.
  m.app.Treino.sair();
  await ateQue(() => m.buscas.length === 2, 'o "Sair" do treino não buscou a fila real');
  m.buscas[1].soltar({ success: true, places: [P(1), P(2)], hasMore: false });
  await ateQue(() => m.log.includes('card:v1'), 'a fila real não chegou à tela depois do "Sair"');
  assert.equal(m.buscas.length, 2, 'o "Sair" buscou mais de uma vez');
  assert.equal(m.contagem.girou, false);
});

test('R11-7-01 (b): com exemplos AINDA na fila, a busca que volta não redesenha o card de treino (o foco do teclado ficava no <body>)', async () => {
  const m = montarBusca();
  const busca = m.app.startFetching();
  await tiques(3);
  praticar(m.app, m.AppState, 1);
  assert.ok(m.AppState.queue.length > 0 && m.AppState.queue.every((p) => p._treino), 'PRÉ-CONDIÇÃO: a fila não é a de exemplos');
  const frente = m.AppState.currentPlace;
  const desde = m.log.length;
  m.buscas[0].soltar({ success: true, places: [P(1)], hasMore: false });
  await busca;
  const tela = m.log.slice(desde);
  assert.deepEqual(tela, [], `DEFEITO: o startFetching retomado mexeu no treino — o card de treino foi redesenhado e o foco do teclado caía no <body> (R11-7-01 b): ${tela.join(' | ')}`);
  assert.equal(m.AppState.currentPlace, frente, 'o exemplo da frente mudou');
});

test('R11-7-01: "Minha área" esperando o PERFIL — ele chega com o "Treino concluído" aberto: nada gira, e nada sai nem é perguntado no treino', async () => {
  const m = montarBusca({ myArea: true, perfil: false, perfilNoAr: true });
  const busca = m.app.startFetching();
  await tiques(3);
  assert.equal(m.buscas.length, 0, 'PRÉ-CONDIÇÃO: a busca não esperou o perfil');
  praticar(m.app, m.AppState);
  const desde = m.log.length;
  const chamadasAntes = m.contagem.chamadas;
  m.esperas.perfil();
  await busca;
  const r = depoisDaVolta(m, desde, chamadasAntes);
  assert.equal(r.girou, false, `DEFEITO: o laço girou com o treino aberto (${r.voltasDoLaco} voltas) — a aba CONGELA (R11-7-01)`);
  assert.deepEqual(r.tela, [], `com o treino aberto a busca retomada seguiu (a pergunta ao servidor da área, a tela): ${r.tela.join(' | ')}`);
  assert.equal(m.buscas.length, 0, 'uma busca saiu com o treino aberto');
});

test('R11-7-01: "Minha área" esperando a decisão da CAIXA (lote 14) — ela chega com o "Treino concluído" aberto: nada gira nem pergunta', async () => {
  const m = montarBusca({ myArea: true, caixaNoAr: true });
  const busca = m.app.startFetching();
  await tiques(3);
  assert.equal(m.buscas.length, 0, 'PRÉ-CONDIÇÃO: a busca não esperou a decisão da caixa');
  praticar(m.app, m.AppState);
  const desde = m.log.length;
  const chamadasAntes = m.contagem.chamadas;
  m.esperas.caixa();
  await busca;
  const r = depoisDaVolta(m, desde, chamadasAntes);
  assert.equal(r.girou, false, `DEFEITO: o laço girou com o treino aberto (${r.voltasDoLaco} voltas) — a aba CONGELA (R11-7-01)`);
  assert.deepEqual(r.tela, [], `com o treino aberto a busca retomada seguiu: ${r.tela.join(' | ')}`);
});

test('R11-7-01: a FILA GUARDADA do offline lida depois de a busca falhar — o treino abre e acaba durante a leitura: nada de "fila vazia" sob o treino', async () => {
  const m = montarBusca({ guardadaNoAr: true });
  const busca = m.app.startFetching();
  await tiques(3);
  // A busca falha por rede com a fila nova vazia: a fila guardada é lida.
  m.buscas[0].soltar({ success: false, errorCategory: 'transient', _motivo: 'rede' });
  await ateQue(() => !!m.esperas.guardada, 'PRÉ-CONDIÇÃO: a fila guardada não foi lida depois da falha');
  praticar(m.app, m.AppState);
  const desde = m.log.length;
  m.esperas.guardada(false);   // nada a abrir (o treino a anotaria)
  await busca;
  const tela = m.log.slice(desde);
  assert.deepEqual(tela, [], `DEFEITO: a busca terminou por baixo do treino ("Tudo limpo"/"Falha ao carregar" sob o "Treino concluído"): ${tela.join(' | ')}`);
});

// ═══ R11-7-02 · a troca de conta com o treino aberto e o "Como funciona" ══════
// A sessão de X cai e a extensão renova em silêncio com a de Y, com o treino
// aberto: ele SEGUE (R10-1-01), com os exemplos sintéticos, e a fila de Y vem no
// "Sair". A troca tira as marcas de "já viu" da conta anterior
// (`esquecerEscolhasDaContaAnterior`) — e o "Como funciona" ia junto, embora a
// pessoa siga no treino, que É o "Como funciona". Rodam a troca, o `resetQueue`,
// a `refazerFilaReal`, o `Treino` e a decisão de abrir o diálogo
// (`mostrarComoFuncionaSePrimeiraVez`) de verdade; a tela do card está livre.
const PX = (pre, i) => ({ venueID: pre + i, updateRequestID: 'u' + pre + i, name: 'Padaria ' + pre + i, creatorId: 7000 + i,
  updateTypeKey: 'VENUE', purType: 'NEW_PLACE', imageUrls: [], mapa: null, dateAdded: 1785203731191 - i * 1000 });
function montarTrocaCF({ fimAberto = false } = {}) {
  const log = [];
  const gravadas = [];   // cada `savePreferences`, como foi gravado
  const els = { treinoBanner: elemento(['hidden']) };
  const real = [1, 2, 3].map((i) => PX('x', i));
  const AppState = {
    authenticated: true, pendingAction: null, fetchEpoch: 5, fetching: false, hasMore: true, loadError: false,
    queue: real.slice(), currentPlace: real[0], stats: { read: 3, rejected: 2, skipped: 0 }, serverTotal: 3,
    autorEmFoco: null, history: {}, conquistas: {}, filters: { managedAreaId: '', myArea: false, stateId: '' },
    // As marcas e escolhas da conta ANTERIOR (X), que a troca tira.
    preferences: { comoFuncionaVisto: true, undoGateSeen: true, dicaDesfazerVista: true, consequenciaVista: true,
      undoEnabled: false, pularGuarda: true, semUndoSeguidas: 4 },
  };
  const fim = { aberto: false };
  let app = null;
  const deps = {
    AppState, ...LIVRE(), document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    t: (k) => k, showToast: (m) => { log.push('toast:' + m); return { remover() {} }; },
    savePreferences: () => gravadas.push(JSON.parse(JSON.stringify(AppState.preferences))),
    safeLS: { get: () => null, set() {}, remove() {} }, carregarFilaDeSaida: () => [],
    startFetching: () => log.push('busca'),
    showCurrentPlace: () => log.push('card:' + ((AppState.currentPlace || {}).venueID || '-')),
    openModal: (id) => log.push('modal:' + id),
    filaAtravessouSessao: true,
    pedidosQueEntraramNaFila: new Set(), bloqueadosPorPagina: new Map(),
    mantendoFocoNoCard: (redesenhar) => redesenhar(),
    // A tela do card LIVRE: o diálogo abriria (ver o CONTROLE).
    cardDaFrente: () => ({}), semCamadaAberta: () => true, acoesTravadas: () => false,
    CamadaVoltar: { consumindo: false }, comoFuncionaEsperaVoltar: false, comoFuncionaEsperaGesto: false,
    // O "Treino concluído" aberto fecha pela limpeza dele: o `sair()`.
    fecharOQueEraDaContaAnterior: (comAFila) => { if (comAFila && fim.aberto) { fim.aberto = false; app.Treino.sair(); } },
  };
  app = rodar(deps, [
    ...['filaReal', 'filaRealComDevolvidos', 'refazerFilaReal', 'resetQueue', 'esquecerOutraConta',
      'esquecerEscolhasDaContaAnterior', 'mostrarComoFuncionaSePrimeiraVez', 'abrirComoFunciona'].map(fatiar),
    treinoDeVerdade(),
  ], ['Treino', 'esquecerOutraConta', 'mostrarComoFuncionaSePrimeiraVez']);
  if (fimAberto) fim.aberto = true;
  return { app, AppState, log, gravadas, fim };
}
// A fila de quem entrou (Y) chega e monta o 1º card: é aí que o diálogo é decidido.
function chegaAFilaDeY(m) {
  m.AppState.queue = [1, 2].map((i) => PX('y', i));
  m.AppState.currentPlace = m.AppState.queue[0];
  m.app.mostrarComoFuncionaSePrimeiraVez();
}
const abriuOComoFunciona = (m) => m.log.includes('modal:comoFuncionaModal');

test('R11-7-02: CONTROLE — sem o treino, outra conta entra e o "Como funciona" abre pro 1º card dela (quem entra não viu nada)', () => {
  const c = montarTrocaCF();
  c.app.esquecerOutraConta('5151');
  assert.equal(c.AppState.preferences.comoFuncionaVisto, undefined, 'CONTROLE: a troca não tirou o "já viu" da conta anterior');
  assert.deepEqual(c.log.filter((l) => l === 'busca'), ['busca'], 'CONTROLE: a fila de quem entrou não foi buscada');
  chegaAFilaDeY(c);
  assert.ok(abriuOComoFunciona(c), `CONTROLE: o "Como funciona" não abriu pra quem entrou — o instrumento não enxerga a abertura: ${c.log.join(' | ')}`);
});

test('R11-7-02: com o TREINO aberto, a troca de conta mantém o "Como funciona" visto — o "Sair" não o abre por cima do 1º card de quem entrou', () => {
  const m = montarTrocaCF();
  m.app.Treino.entrar();
  assert.equal(m.AppState.preferences.comoFuncionaVisto, true, 'PRÉ-CONDIÇÃO: o treino não marcou o "Como funciona"');
  m.app.esquecerOutraConta('5151');
  assert.equal(m.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: a troca de conta encerrou o treino (R10-1-01)');
  assert.equal(m.AppState.preferences.comoFuncionaVisto, true,
    'DEFEITO: a troca de conta apagou o "já viu o Como funciona" com a pessoa no treino — o "Sair" o abre por cima do 1º card de quem entrou (R11-7-02)');
  assert.equal(m.gravadas.at(-1).comoFuncionaVisto, true, 'o "Como funciona" visto não ficou GRAVADO (o aparelho o perde ao reabrir)');
  // As outras marcas e escolhas da conta anterior saem como sempre (R4-5 A3).
  const p = m.AppState.preferences;
  assert.deepEqual({ undoGateSeen: p.undoGateSeen, dicaDesfazerVista: p.dicaDesfazerVista, consequenciaVista: p.consequenciaVista,
    undoEnabled: p.undoEnabled, pularGuarda: p.pularGuarda, semUndoSeguidas: p.semUndoSeguidas },
  { undoGateSeen: undefined, dicaDesfazerVista: undefined, consequenciaVista: undefined, undoEnabled: true, pularGuarda: false, semUndoSeguidas: 0 },
  'o treino aberto segurou outra escolha da conta anterior');
  // O "Sair" do treino: a fila de quem entrou é buscada, chega, e o diálogo NÃO abre.
  m.app.Treino.sair();
  assert.deepEqual(m.log.filter((l) => l === 'busca'), ['busca'], 'PRÉ-CONDIÇÃO: o "Sair" não buscou a fila de quem entrou');
  chegaAFilaDeY(m);
  assert.ok(!abriuOComoFunciona(m), `DEFEITO: o "Como funciona" abriu por cima do 1º card de quem entrou, logo depois do treino: ${m.log.join(' | ')}`);
});

test('R11-7-02: com o "Treino concluído" aberto na troca — o diálogo fecha, a fila de quem entrou vem, e o "Como funciona" não abre', () => {
  const m = montarTrocaCF({ fimAberto: true });
  m.app.Treino.entrar();
  m.app.esquecerOutraConta('5151');
  assert.equal(m.app.Treino.ativo, false, 'PRÉ-CONDIÇÃO: o fechamento do "Treino concluído" não saiu do treino');
  assert.equal(m.AppState.preferences.comoFuncionaVisto, true, 'DEFEITO: o "já viu o Como funciona" saiu com a pessoa no fim do treino');
  chegaAFilaDeY(m);
  assert.ok(!abriuOComoFunciona(m), `DEFEITO: o "Como funciona" abriu logo depois do "Treino concluído": ${m.log.join(' | ')}`);
});

// ═══ R11-7-03 · a renovação da queda com o treino aberto ═════════════════════
// A sessão cai e a extensão renova em silêncio (`derrubarSessao` → a ponte
// responde). No fim, "Acesso renovado pelo WME — sua fila continua aqui" sai só
// se a fila REAL continua. Com o treino aberto, a queda guardava a época dos
// EXEMPLOS, e o `sair()` com a fila refeita voltava à mesma época. Rodam a queda,
// a ponte da extensão, a troca de conta, a `refazerFilaReal`, o `resetQueue` e o
// `Treino` de verdade; o perfil da renovação chega na hora (a mesma conta).
const CONTA_KEY = /^const CONTA_KEY = '([^']+)';/m.exec(APP)[1];
const AVISO_FR = { chave: 'toast.paisDoPerfil', pais: 'France', regiao: 'row', id: 73 };
function janelaFalsa() {
  const ouvintes = new Set();
  const w = {
    location: { origin: 'https://app' },
    addEventListener: (t, fn) => { if (t === 'message') ouvintes.add(fn); },
    removeEventListener: (t, fn) => ouvintes.delete(fn),
    postMessage: () => {},
    // O que a ponte da extensão responderia.
    responder: (data) => { for (const fn of [...ouvintes]) fn({ source: w, origin: w.location.origin, data }); },
  };
  return w;
}
function montarQueda() {
  const log = [];
  const toasts = [];
  const ls = new Map();
  const safeLS = { get: (k) => (ls.has(k) ? ls.get(k) : null), set: (k, v) => ls.set(k, String(v)), remove: (k) => ls.delete(k) };
  const window = janelaFalsa();
  const els = { treinoBanner: elemento(['hidden']) };
  const real = [1, 2, 3].map((i) => PX('b', i));
  let token = 'tokA';
  const AppState = {
    authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: true, loadError: false,
    queue: real.slice(), currentPlace: real[0], stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 3,
    autorEmFoco: null, history: {}, conquistas: {}, profile: { id: 111 },
    preferences: { comoFuncionaVisto: true }, filters: { myArea: false, managedAreaId: '', stateId: '' },
  };
  let app = null;
  const deps = {
    AppState, ...LIVRE(), window, safeLS, CONTA_KEY,
    document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    epocaDaSessao: 0, quedaAnunciada: false, saiuNestaPagina: false, extPerguntando: false, extRenovando: false,
    extNegado: null, extNegadoNestaPagina: false, filaAtravessouSessao: false, puladosNoInicioDaFila: 0,
    saidaEsperandoConta: false, contaConfirmadaNestaAba: null,
    EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, AVISO_RENOVADA_ESPERA_PERFIL_MS: 30, setTimeout, clearTimeout,
    API: { setSession: (t) => { token = t; }, getSession: () => token, soltarSessao() {}, get sessionToken() { return token; } },
    sessaoDestaAbaEhAGuardada: () => true,
    t: (k, v) => k + (v && v.pais ? '(' + v.pais + ')' : ''),
    showToast: (m) => { toasts.push(m); return { remover() {} }; },
    carregarFilaDeSaida: () => [],
    // A busca da fila nova (no treino, o `startFetching` volta na hora: R11-7-01).
    startFetching: () => { if (!app.Treino.ativo) log.push('busca'); },
    rebuscarDepoisDeFalha: () => log.push('rebuscou'),
    showCurrentPlace: () => log.push('card:' + ((AppState.currentPlace || {}).venueID || '-')),
    loadProfileAndAuxData: () => Promise.resolve(),
    pedidosQueEntraramNaFila: new Set(), bloqueadosPorPagina: new Map(),
    mantendoFocoNoCard: (redesenhar) => redesenhar(),
    fecharOQueEraDaContaAnterior: () => {},
  };
  app = rodar(deps, [
    ...['derrubarSessao', 'entrarPelaExtensao', 'conhecerContaDoLogin', 'aoConhecerConta', 'esquecerOutraConta',
      'esquecerEscolhasDaContaAnterior', 'marcaDaSessao', 'filaReal', 'filaRealComDevolvidos', 'refazerFilaReal',
      'resetQueue'].map(fatiar),
    treinoDeVerdade(),
  ], ['derrubarSessao', 'Treino', 'refazerFilaReal', 'marcaDaSessao']);
  safeLS.set(CONTA_KEY, JSON.stringify({ id: '111', s: app.marcaDaSessao('tokA') }));   // X estava triando
  return { app, AppState, deps, log, toasts, window };
}
// A ponte responde com a sessão nova; a renovação termina (`rebuscou`, e a
// decisão do aviso logo depois do perfil, que chega na hora).
async function renovar(m, conta = null) {
  m.window.responder({ source: 'wazeplaces-ext', action: 'sessao', token: 'tokA2', ...(conta ? { conta } : {}) });
  await ateQue(() => m.log.includes('rebuscou'), 'a renovação da queda não terminou');
  await tiques(3);
}
const renovado = (m) => m.toasts.includes('toast.sessionRenewed');

test('R11-7-03: CONTROLE — sem o treino, a queda renovada diz "sua fila continua aqui" (a fila continuou)', async () => {
  const c = montarQueda();
  c.app.derrubarSessao('srv.err.sessionExpired');
  await renovar(c);
  assert.deepEqual(c.toasts, ['toast.sessionRenewed'], 'CONTROLE: sem o treino o aviso da renovação não saiu — o instrumento não o enxerga');
});

test('R11-7-03: o "Sair" do treino durante a renovação, SEM refazer — a fila real continua, e o aviso diz isso', async () => {
  const m = montarQueda();
  m.app.Treino.entrar();
  m.app.derrubarSessao('srv.err.sessionExpired');
  m.app.Treino.sair();
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['b1', 'b2', 'b3'], 'PRÉ-CONDIÇÃO: o "Sair" não devolveu a fila real');
  await renovar(m);
  assert.ok(renovado(m),
    `DEFEITO: a fila real continuou depois da queda e o "sua fila continua aqui" não saiu — a queda guardou a época dos EXEMPLOS (R11-7-03): ${m.toasts.join(' | ')}`);
});

test('R11-7-03: o perfil mandou refazer a fila (outro país) e o "Sair" a refaz durante a renovação — sem "sua fila continua aqui" junto do aviso do país', async () => {
  const m = montarQueda();
  m.app.Treino.entrar();
  m.app.refazerFilaReal(AVISO_FR);   // o perfil levou a outro país: anotado pro "Sair"
  m.app.derrubarSessao('srv.err.sessionExpired');
  m.app.Treino.sair();
  assert.deepEqual([m.log.filter((l) => l === 'busca'), m.toasts], [['busca'], ['toast.paisDoPerfil(France)']],
    'PRÉ-CONDIÇÃO: o "Sair" não refez a fila do país novo, com o aviso');
  await renovar(m);
  assert.ok(!renovado(m),
    `DEFEITO: "sua fila continua aqui" junto do "Mostrando a fila do país…" — a fila foi trocada (R11-7-03): ${m.toasts.join(' | ')}`);
});

test('R11-7-03: o refazer chega DURANTE a renovação e o "Sair" vem antes de ela terminar — a fila trocou, sem "sua fila continua aqui"', async () => {
  const m = montarQueda();
  m.app.Treino.entrar();
  m.app.derrubarSessao('srv.err.sessionExpired');
  m.app.refazerFilaReal(AVISO_FR);
  m.app.Treino.sair();
  await renovar(m);
  assert.ok(m.toasts.includes('toast.paisDoPerfil(France)'), 'PRÉ-CONDIÇÃO: a fila não foi refeita com o aviso do país');
  assert.ok(!renovado(m), `DEFEITO: "sua fila continua aqui" sobre a fila refeita: ${m.toasts.join(' | ')}`);
});

test('R11-7-03: a renovação termina com o treino AINDA aberto — sem refazer, o aviso sai (a fila guardada continua); com o refazer anotado, não', async () => {
  const m = montarQueda();
  m.app.Treino.entrar();
  m.app.derrubarSessao('srv.err.sessionExpired');
  await renovar(m);
  assert.ok(renovado(m), `a fila real guardada no treino continuou e o aviso não saiu: ${m.toasts.join(' | ')}`);
  m.app.Treino.sair();
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['b1', 'b2', 'b3'], 'o "Sair" não devolveu a fila real');

  const r = montarQueda();
  r.app.Treino.entrar();
  r.app.refazerFilaReal(AVISO_FR);
  r.app.derrubarSessao('srv.err.sessionExpired');
  await renovar(r);
  assert.ok(!renovado(r),
    `DEFEITO: "sua fila continua aqui" no treino, com a fila anotada pra ser trocada no "Sair" — o aviso do país vem depois e o contradiz: ${r.toasts.join(' | ')}`);
  r.app.Treino.sair();
  assert.ok(r.toasts.includes('toast.paisDoPerfil(France)'), 'o "Sair" não refez a fila com o aviso do país');
});

test('R11-7-03: OUTRA conta na renovação com o treino aberto (pela ponte) — "Outra conta entrou", e nunca "sua fila continua aqui"', async () => {
  const m = montarQueda();
  m.app.Treino.entrar();
  m.app.derrubarSessao('srv.err.sessionExpired');
  await renovar(m, '222');
  assert.ok(m.toasts.includes('toast.outraConta'), `PRÉ-CONDIÇÃO: a troca de conta não foi detectada: ${m.toasts.join(' | ')}`);
  assert.equal(m.app.Treino.ativo, true, 'PRÉ-CONDIÇÃO: a troca de conta encerrou o treino (R10-1-01)');
  assert.ok(!renovado(m), `DEFEITO: "sua fila continua aqui" junto do "Outra conta entrou": ${m.toasts.join(' | ')}`);
});

test('R11-7-03: a fila refeita no "Sair" do treino ganha uma época que NINGUÉM guardou — nem a do treino, nem a da fila real de antes', () => {
  const m = montarQueda();
  m.app.Treino.entrar();
  const epocaDoTreino = m.AppState.fetchEpoch;
  const epocaReal = m.app.Treino._salvo.epoca;
  m.app.refazerFilaReal(AVISO_FR);
  m.app.Treino.sair();
  assert.ok(![epocaDoTreino, epocaReal].includes(m.AppState.fetchEpoch),
    `DEFEITO: a fila refeita voltou com a época ${m.AppState.fetchEpoch} (treino ${epocaDoTreino}, real ${epocaReal}) — quem guardou a época do treino a toma pela mesma fila (R11-7-03)`);
  // CONTROLE: sem o refazer, a fila REAL volta com a época dela (R7-7-04).
  const c = montarQueda();
  c.app.Treino.entrar();
  const real = c.app.Treino._salvo.epoca;
  c.app.Treino.sair();
  assert.equal(c.AppState.fetchEpoch, real, 'CONTROLE: o "Sair" sem refazer não devolveu a época da fila real');
});

// ═══ R11-7-05 · o que o ↑ ENSINA no treino é o que o ↑ de verdade FAZ ═════════
// Com o "Pular guarda o pedido" ligado, o treino explicava o ↑ com "pular daria
// ⭐ ao pedido no WME" — também num exemplo de pedido que JÁ tem a estrela (a ⭐
// do card, ou a que o app já deu), onde o ↑ de verdade não manda nada (R9-7-06,
// R10-2-05). Roda o `handleSkip` de verdade NOS DOIS MODOS, com o `Treino`, o
// anel das estrelas (`estreladoPeloApp`) e a chave do pedido de verdade.
const ESTRELADOS_KEY = /^const ESTRELADOS_KEY = '([^']+)';/m.exec(APP)[1];
function montarPular({ pularGuarda = true, estrelado = null, noAnel = null } = {}) {
  const toasts = [];
  const enviadas = [];
  const ls = new Map();
  if (noAnel) ls.set(ESTRELADOS_KEY, JSON.stringify([`v${noAnel}|u${noAnel}`]));
  const els = {};
  const real = [1, 2, 3].map((n) => P(n, { isStarred: n === estrelado }));
  const AppState = { authenticated: true, fetchEpoch: 0, pendingAction: null, autorEmFoco: null, queue: real.slice(),
    currentPlace: real[0], stats: { read: 0, rejected: 0, skipped: 0 }, preferences: { comoFuncionaVisto: true, pularGuarda },
    filters: {} };
  const envio = { executor: null };
  const deps = {
    AppState, ...LIVRE(), ESTRELADOS_KEY, ESTRELADOS_MAX: 500,
    safeLS: { get: (k) => (ls.has(k) ? ls.get(k) : null), set: (k, v) => ls.set(k, String(v)), remove: (k) => ls.delete(k) },
    document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    t: (k) => k, showToast: (m) => { toasts.push(m); return { remover() {} }; },
    acoesTravadas: () => false, epocaDaSessao: 0, callWithRetry: (fn) => fn(),
    API: { getRegion: () => 'row', guardarPedido: (v, u) => { enviadas.push(v + '|' + u); return Promise.resolve({ success: true }); } },
    // A janela do Desfazer de mentira: o executor (o envio da estrela) roda já.
    scheduleAction: (tipo, place, executor) => { envio.executor = executor(); },
  };
  const app = rodar(deps, [
    ...['handleSkip', 'estreladoPeloApp', 'estreladosNoAparelho', 'anotarEstreladoPeloApp', 'chaveDoPedido',
      'atualizarSeloDePular'].map(fatiar),
    treinoDeVerdade(),
  ], ['handleSkip', 'Treino', 'atualizarSeloDePular']);
  return { app, AppState, toasts, enviadas, els, envio };
}
// O ↑ no 1º pedido: o que o treino ENSINA (a frase do aviso) e o que o modo real
// MANDA (a estrela ao Waze), sobre o MESMO pedido.
async function oQueOPularFaz(caso) {
  const t = montarPular(caso);
  t.app.Treino.entrar();
  assert.equal(t.AppState.currentPlace.venueID, 'v1', 'PRÉ-CONDIÇÃO: o 1º exemplo não é o clone do 1º pedido');
  t.app.handleSkip();
  assert.equal(t.enviadas.length, 0, 'o ↑ do TREINO mandou uma estrela de verdade');
  const r = montarPular(caso);
  r.app.handleSkip();
  await r.envio.executor;
  return { ensina: t.toasts.at(-1), manda: r.enviadas.length > 0 };
}

test('R11-7-05: o ↑ do treino ensina a ⭐ só onde o ↑ de verdade a manda — nunca num pedido que já a tem', async () => {
  const casos = [
    // CONTROLE: o pedido sem estrela — o treino ensina a ⭐ e o modo real a manda.
    { nome: 'sem estrela (CONTROLE)', caso: {}, ensina: 'treino.efeito.skipGuarda', manda: true },
    { nome: 'com a ⭐ no card (isStarred)', caso: { estrelado: 1 }, ensina: 'treino.efeito.skip', manda: false },
    { nome: 'estrelado pelo app (o anel)', caso: { noAnel: 1 }, ensina: 'treino.efeito.skip', manda: false },
    { nome: 'outro pedido no anel', caso: { noAnel: 2 }, ensina: 'treino.efeito.skipGuarda', manda: true },
    { nome: '"Pular guarda" desligado', caso: { pularGuarda: false, estrelado: 1 }, ensina: 'treino.efeito.skip', manda: false },
  ];
  for (const c of casos) {
    const r = await oQueOPularFaz(c.caso);
    assert.equal(r.manda, c.manda, `PRÉ-CONDIÇÃO (${c.nome}): o ↑ de verdade ${c.manda ? 'não mandou' : 'mandou'} a estrela — mudou a régua do handleSkip`);
    assert.equal(r.ensina, c.ensina,
      `DEFEITO (${c.nome}): o treino ensina "${r.ensina}" e o ↑ de verdade ${r.manda ? 'manda' : 'NÃO manda'} a estrela (R11-7-05)`);
    assert.equal(r.ensina === 'treino.efeito.skipGuarda', r.manda, `(${c.nome}) o que o treino ensina e o que o app faz divergem`);
  }
});

test('R11-7-05: no ÚLTIMO exemplo a frase vai no "Treino concluído" — e segue a mesma régua', () => {
  const m = montarPular({ estrelado: 3 });
  m.app.Treino.entrar();
  m.app.Treino.agir('read');
  m.app.Treino.agir('read');
  assert.equal(m.AppState.queue.length, 1, 'PRÉ-CONDIÇÃO: não sobrou só o último exemplo');
  assert.equal(m.AppState.queue[0].isStarred, true, 'PRÉ-CONDIÇÃO: o último exemplo não é o do pedido estrelado');
  m.app.handleSkip();
  assert.equal(m.els.treinoFimEfeito && m.els.treinoFimEfeito.textContent, 'treino.efeito.skip',
    'DEFEITO: o "Treino concluído" diz que pular daria ⭐ a um pedido que já a tem (R11-7-05)');
});

// ═══ Junção do lote 15 · o SELO do ↑ no card de verdade segue a MESMA régua ═══
// O agente do treino viu, sem mexer: o selo "Pular ⭐" do card REAL aparecia
// também num pedido já estrelado, onde o ↑ de verdade não manda nada — o que o
// app MOSTRA e o que ele FAZ divergindo, como no R11-7-05. O `atualizarSeloDePular`
// pergunta ao `Treino.pularGuardaria` (a régua do `handleSkip`), e o `montarCard`
// passa o pedido (o card ainda não foi registrado quando o selo é escrito).
test('junção do lote 15: o selo "Pular ⭐" do card só promete a ⭐ onde o ↑ de verdade a manda', async () => {
  const casos = [
    { nome: 'sem estrela (CONTROLE)', caso: {}, guarda: true },
    { nome: 'com a ⭐ no card (isStarred)', caso: { estrelado: 1 }, guarda: false },
    { nome: 'estrelado pelo app (o anel)', caso: { noAnel: 1 }, guarda: false },
    { nome: 'outro pedido no anel', caso: { noAnel: 2 }, guarda: true },
    { nome: '"Pular guarda" desligado', caso: { pularGuarda: false }, guarda: false },
  ];
  for (const c of casos) {
    const m = montarPular(c.caso);
    const selo = { k: null, setAttribute(a, v) { if (a === 'data-i18n') this.k = v; } };
    const card = { querySelector: (sel) => (sel.includes('swipe-stamp-up') ? selo : null) };
    m.app.atualizarSeloDePular(card, m.AppState.queue[0]);
    const { manda } = await oQueOPularFaz(c.caso);
    assert.equal(manda, c.guarda, `PRÉ-CONDIÇÃO (${c.nome}): o ↑ de verdade ${manda ? 'mandou' : 'não mandou'} a estrela — mudou a régua do handleSkip`);
    assert.equal(selo.k, c.guarda ? 'card.stamp.skipGuarda' : 'card.stamp.skip',
      `DEFEITO (${c.nome}): o selo diz "${selo.k}" e o ↑ de verdade ${manda ? 'manda' : 'NÃO manda'} a estrela`);
  }
  // O card que NASCE leva o pedido dele: sem isso o selo leria um pedido que ainda não foi registrado.
  assert.match(fatiar('montarCard'), /atualizarSeloDePular\(card, place\)/,
    'o montarCard não passa o pedido ao selo — o card novo seria decidido pelo card da frente');
});
