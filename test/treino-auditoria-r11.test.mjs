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
