// Lote 23, rodada 19 da auditoria — fila, contas, abas e telas.
//
// R19-2-01  tecla segurada decide pedidos em série
// R19-1-01  o `finally` da sessão que SAIU não mexe no estado da sessão nova
// R19-1-02  os códigos de pareamento emitidos sobrevivem à recarga (o "Sair" os cancela)
// R19-1-03  bfcache: a aba restaurada relê o aparelho
// R19-2-02  a recusa automática de duas abas abrindo juntas manda uma vez só
// R19-2-03  "Rejeitar os N" cancelado pelo segundo plano avisa
// R19-7-02  o QR do Resumo tem teto
//
// Os testes FATIAM o código de verdade do js/app.js (como os r14 a r18) e
// ignoram comentário (gotcha #67). O que só o navegador responde — a tecla
// segurada de verdade — mora num bloco do tools/smoke-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
const semComentario = (txt) => txt.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const SEM = semComentario(APP);

function fatiar(nome, fonte = SEM) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  let prof = 0;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    if (fonte[j] === '{') prof++;
    else if (fonte[j] === '}' && --prof === 0) {
      const corpo = fonte.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = [\\s\\S]*?;\\n', 'm').exec(SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
}

// ───────────────────────── R19-2-01: tecla segurada ─────────────────────────

function teclado({ camada = null, travado = false } = {}) {
  const log = [];
  const doc = { activeElement: null, getElementById: (id) => ({ id }) };
  const deps = {
    document: doc,
    window: { triggerSwipe: (dir) => log.push('decidiu:' + dir) },
    AppState: { currentPlace: { updateRequestID: 'uA' }, pendingAction: null },
    MapaLightbox: { isOpen: () => camada === 'mapa', close() {}, zoom() {}, arrastar: (dx, dy) => log.push(`mapa:anda ${dx},${dy}`) },
    Lightbox: { isOpen: () => camada === 'foto', ampliada: () => false, prev: () => log.push('foto:anterior'),
      next: () => log.push('foto:proxima'), panBy() {}, zoomPeloTeclado() {} },
    topOpenModal: () => (camada === 'modal' ? { id: 'filtersModal' } : null),
    trapTabInModal() {}, closeModal() {}, recuarNaFoto() {},
    desfazerPeloTeclado: () => { log.push('desfez'); return true; },
    acoesTravadas: () => travado, avisarTravaAoTocar: () => log.push('aviso-da-trava'),
    agirNoPedidoDoGesto: () => {}, pedidoDoCard: () => null,
    handleReject() {}, handleMarkAsRead() {}, handleSkip() {},
    prometerFocoDaSeta: () => log.push('prometeu-foco'),
  };
  const fonte = [constante('TECLAS_DE_CURSOR'), fatiar('focoEmCampoDeTexto'), constante('AREAS_DO_CARD_QUE_ROLAM'),
    fatiar('focoEmAreaQueRola'), fatiar('atalhoDoNavegador'), fatiar('teclaDeComposicao'),
    constante('TECLAS_DOS_ATALHOS_DO_NAVEGADOR'), constante('SETAS_QUE_ANDAM'), fatiar('handleKeyDown'),
    'return handleKeyDown;'].join('\n');
  const handle = new Function(...Object.keys(deps), fonte)(...Object.values(deps));
  const focar = (classes) => {
    doc.activeElement = { tagName: 'DIV', classList: classes,
      closest: (sel) => (sel.split(',').some((s) => classes.includes(s.trim().replace(/^\./, ''))) ? doc.activeElement : null) };
  };
  const tecla = (key, mods = {}) => {
    const e = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...mods,
      preventDefault() { this.parou = true; } };
    handle(e);
    return { presa: !!e.parou, fez: log.splice(0).filter((x) => x !== 'prometeu-foco') };
  };
  return { tecla, focar };
}

test('R19-2-01: a seta SEGURADA decide uma vez só — a repetição fica com o app e não decide nem avisa', () => {
  for (const [k, dir] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up']]) {
    const t = teclado();
    // CONTROLE: o primeiro keydown (sem repeat) decide. Sem isto, "a repetição não
    // decidiu" passaria com o teclado morto.
    assert.deepEqual(t.tecla(k).fez, ['decidiu:' + dir], `CONTROLE: ${k} sem repeat deixou de decidir`);
    for (let i = 0; i < 5; i++) {
      const r = t.tecla(k, { repeat: true });
      assert.deepEqual(r.fez, [], `${k} segurada decidiu de novo (${r.fez.join(', ')}) — rejeitar não volta`);
      assert.equal(r.presa, true, `${k} segurada ficou sem preventDefault: o navegador rolaria a página`);
    }
  }
});

test('R19-2-01: a repetição também não repete o aviso da trava', () => {
  const t = teclado({ travado: true });
  assert.deepEqual(t.tecla('ArrowLeft').fez, ['aviso-da-trava'], 'CONTROLE: a seta no card travado deixou de avisar');
  assert.deepEqual(t.tecla('ArrowLeft', { repeat: true }).fez, [], 'a seta segurada repetiu o aviso da trava');
});

test('R19-2-01: onde segurar a seta é rolar ou andar, a repetição segue valendo', () => {
  // Área do card que rola: a seta é da rolagem (sem preventDefault, quem rola é o navegador).
  for (const area of ['card-changes-list', 'card-flag-comment-text']) {
    const t = teclado();
    t.focar([area]);
    const r = t.tecla('ArrowDown', { repeat: true });
    assert.equal(r.presa, false, `${area}: a seta segurada deixou de rolar a lista`);
  }
  // Mapa ampliado: segurar a seta anda.
  const m = teclado({ camada: 'mapa' });
  assert.deepEqual(m.tecla('ArrowLeft', { repeat: true }).fez, ['mapa:anda 80,0'], 'mapa: a seta segurada parou de andar');
  // Foto em 1×: ← → trocam de foto, e segurar percorre o carrossel.
  const f = teclado({ camada: 'foto' });
  assert.deepEqual(f.tecla('ArrowRight', { repeat: true }).fez, ['foto:proxima'], 'foto: a seta segurada parou de trocar de foto');
});

test('R19-2-01: o Enter e o Espaço SEGURADOS num dos três botões não geram novo clique', () => {
  const fonte = fatiar('renderCurrentCard');
  // Estrutura: um ouvinte de keydown pros três botões, que só age com `repeat` e cancela a tecla.
  const m = /for \(const cls of \['\.card-btn-reject', '\.card-btn-skip', '\.card-btn-read'\]\) \{\s*card\.querySelector\(cls\)\.addEventListener\('keydown', \(ev\) => \{\s*if \(ev\.repeat && \(ev\.key === 'Enter' \|\| ev\.key === ' '\)\) ev\.preventDefault\(\);/.exec(fonte);
  assert.ok(m, 'os botões ✕ ↑ ✓ deixaram de cancelar o Enter/Espaço repetido (o click sintético decide em série)');
  // E vem ANTES de os `click` serem ligados no mesmo card.
  assert.ok(fonte.indexOf(m[0]) < fonte.indexOf("addEventListener('click', (ev) => fireAction('left'"), 'o cancelamento da repetição tem de existir no card que liga os clicks');
});

// ───────────────────── harness: funções DE VERDADE com buraco negro ─────────────────────
// O que o teste não fornece vira um "buraco negro" (o molde do test/fila-auditoria-r18.test.mjs).
function buracoNegro(nome, chamou) {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro(nome + '.' + k, chamou)),
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}
function montar(nomes, deps) {
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      return typeof k === 'string' ? buracoNegro(k, chamou) : undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map((n) => fatiar(n)).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}
const tique = () => new Promise((ok) => setImmediate(ok));
async function ateQue(cond, msg, teto = 3000) {
  const fim = Date.now() + teto;
  while (!cond()) {
    if (Date.now() > fim) assert.fail('a espera estourou: ' + msg);
    await tique();
  }
}
const chaveDe = new Function(fatiar('chaveDoPedido') + '\nreturn chaveDoPedido;')();
const P = (i, extra = {}) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 77, createdBy: 'spam', ...extra });

// ───────────────────── R19-1-01: o `finally` da sessão que SAIU ─────────────────────
// O "Sair" zera `inFlightActions`, `pedidosEmAndamento` e `pedidosDoLoteSemEnviar` e sobe a
// geração (`AppState.geracaoDoSair`); a resposta em voo da sessão anterior ainda chega, e o
// `finally` dela soltava o que agora é da sessão NOVA (a mesma decisão do mesmo pedido, ou o
// lote dela). Cada teste: A começa, "Sair" (a simulação do que o `handleLogout` faz com esses
// três), B começa, A responde — e o que é de B tem que ficar.
const sair = (deps) => {
  deps.AppState.geracaoDoSair++;
  deps.AppState.inFlightActions = 0;
  deps.pedidosEmAndamento.clear();
  deps.pedidosDoLoteSemEnviar.clear();
};
const segurada = () => { let soltar; const p = new Promise((ok) => { soltar = ok; }); return { p, soltar }; };

function decisaoDoCard() {
  const AppState = { geracaoDoSair: 0, inFlightActions: 0, pendingAction: null, preferences: { undoEnabled: false }, queue: [], currentPlace: null };
  const deps = { AppState, pedidosEmAndamento: new Set(), pedidosDoLoteSemEnviar: new Set(), canDisableUndo: () => true,
    presencaFolhaAberta: () => false, redesenharAvisoDoSairSeAberto() {}, aplicarTravaDeAcao() {}, removeUndoBanner() {},
    updateInFlightIndicator() {}, atenderOFimDaJanela() {}, API: { getRegion: () => 'row' }, setTimeout, clearTimeout };
  const h = montar(['scheduleAction', 'marcarEmAndamento', 'marcarLoteSemEnviar', 'chaveDoPedido'], deps);
  return { h, deps, AppState };
}

test('R19-1-01 (1 e 2): a resposta de A depois do "Sair" não zera o `inFlightActions` nem tira a chave de B do "em andamento"', async () => {
  const { h, deps, AppState } = decisaoDoCard();
  const place = P(7);
  const resposta = segurada();
  h.scheduleAction('reject', place, () => resposta.p);          // a decisão de A (sem o Desfazer: sai na hora)
  await ateQue(() => AppState.inFlightActions === 1, 'PRÉ-CONDIÇÃO: a decisão de A está no ar');
  assert.ok(deps.pedidosEmAndamento.has(chaveDe(place)), 'PRÉ-CONDIÇÃO: o pedido de A está em andamento');
  sair(deps);                                                    // o "Sair"
  // B entra e decide o MESMO pedido (a decisão dele fica no ar).
  const respostaB = segurada();
  h.scheduleAction('reject', place, () => respostaB.p);
  await ateQue(() => AppState.inFlightActions === 1, 'PRÉ-CONDIÇÃO: a decisão de B está no ar');
  resposta.soltar();                                             // A responde, tarde
  await tique(); await tique();
  assert.equal(AppState.inFlightActions, 1, 'DEFEITO: a resposta de A zerou o contador — o canto "Enviando 1…" de B some com a decisão dele no ar');
  assert.ok(deps.pedidosEmAndamento.has(chaveDe(place)), 'DEFEITO: a resposta de A tirou o pedido de B do "em andamento" — o ↻ o devolve como card');
  // B responde: aí sim zera, e solta.
  respostaB.soltar();
  await ateQue(() => AppState.inFlightActions === 0, 'o contador de B voltar a 0 quando ele responde');
  assert.equal(deps.pedidosEmAndamento.has(chaveDe(place)), false, 'a resposta de B não soltou o pedido dele');
});

test('R19-1-01 (1 e 2): CONTROLE — sem o "Sair", a resposta da própria decisão zera o contador e solta o pedido', async () => {
  const { h, deps, AppState } = decisaoDoCard();
  const place = P(7);
  const resposta = segurada();
  h.scheduleAction('reject', place, () => resposta.p);
  await ateQue(() => AppState.inFlightActions === 1, 'a decisão no ar');
  resposta.soltar();
  await ateQue(() => AppState.inFlightActions === 0, 'o contador voltar a 0 (o instrumento enxerga o `finally`)');
  assert.equal(deps.pedidosEmAndamento.has(chaveDe(place)), false, 'CONTROLE: o pedido não saiu do "em andamento" no fim do envio');
});

function loteDeLidos() {
  const AppState = { geracaoDoSair: 0, inFlightActions: 0, authenticated: true, queue: [], currentPlace: null, stats: { read: 0, rejected: 0, skipped: 0 },
    serverTotal: 0, fetchEpoch: 0, hasMore: false, pendingAction: null, profile: { id: 1 } };
  const portoes = [];
  const deps = {
    AppState, document: { getElementById: () => null }, epocaDaSessao: 0, Treino: { ativo: false }, LOTE_LIDOS_PEDACO: 25,
    pedidosEmAndamento: new Set(), pedidosDoLoteSemEnviar: new Set(), escritasEsperandoAVez: new Set(),
    alvosDoLoteDeLidosNoAr: new Map(), rejeicoesDeLoteNoAr: new Set(), loteDeLidosEmVoo: false, lidosDoLoteNoAr: 0,
    API: { markAsReadBatch: () => new Promise((ok) => portoes.push(ok)), getRegion: () => 'row' },
    callWithRetry: (fn) => fn(), carimboDoGesto: () => ({ dia: '2026-10-14', onde: '30', t: 1, lang: 'pt' }),
    decididosPorOutraAbaComCardAqui: new WeakSet(), showToast: () => ({ remover() {} }), t: (k) => k,
    redesenharAvisoDoSairSeAberto() {}, quemDecideAgora: () => ({ s: 'a', conta: '1' }),
    acoesTravadasForaDaJanela: () => false, aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    removeUndoBanner() {}, aplicarTravaDeAcao() {}, updateInFlightIndicator() {}, closeModal() {}, aoMudarAFilaPorBaixo() {},
    updatePendingCount() {}, updateStats() {}, saveStats() {}, registrarPouso() {}, recordHistory() {}, registrarLoteConfirmado() {},
    pousouNoWaze: (r) => !!(r && r.success), showCurrentPlace() {}, showNoPlaces() {}, startFetching() {},
  };
  const h = montar(['handleBatchMarkRead', 'marcarEmAndamento', 'marcarLoteSemEnviar', 'chaveDoPedido'], deps);
  return { h, deps, AppState, portoes };
}

test('R19-1-01 (3): o "Marcar todos" de A que responde depois do "Sair" não esvazia os "esperando envio" do lote de B', async () => {
  const m = loteDeLidos();
  const alvosA = Array.from({ length: 30 }, (_, i) => P(i, { creatorId: 1000 + i }));
  m.AppState.queue = alvosA.slice();
  m.deps.loteDeLidosContado = new Set(alvosA.map(chaveDe));
  m.deps.confirmarLote = true;
  // O lote de A: 30 pedidos, o 1º pedaço (25) no ar, 5 esperando.
  const fimA = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'PRÉ-CONDIÇÃO: o pedaço de A saiu');
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 5, 'PRÉ-CONDIÇÃO: 5 pedidos de A esperando');
  sair(m.deps);
  m.deps.epocaDaSessao++;
  // O lote de B: os mesmos 5 "sem enviar" marcados pela sessão nova (a geração de agora).
  m.h.marcarLoteSemEnviar(alvosA.slice(25), true, m.AppState.geracaoDoSair);
  m.AppState.inFlightActions = 1;                               // e a decisão de B no ar
  m.portoes.shift()({ success: true });                         // A responde
  await fimA;
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 5, 'DEFEITO: o `finally` do lote de A esvaziou o que o diálogo do "Sair" de B conta');
  assert.equal(m.AppState.inFlightActions, 1, 'DEFEITO: o lote de A zerou o contador da decisão de B');
});

test('R19-1-01 (3): CONTROLE — sem o "Sair", o lote que acaba solta o que era dele', async () => {
  const m = loteDeLidos();
  const alvosA = Array.from({ length: 30 }, (_, i) => P(i, { creatorId: 1000 + i }));
  m.AppState.queue = alvosA.slice();
  m.deps.loteDeLidosContado = new Set(alvosA.map(chaveDe));
  const fimA = m.h.handleBatchMarkRead();
  await ateQue(() => m.portoes.length === 1, 'o pedaço saiu');
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 5);
  m.portoes.shift()({ success: false, errorCategory: 'unknown' });
  await fimA;
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0, 'CONTROLE: o lote que acabou deixou pedido "esperando envio"');
  assert.equal(m.AppState.inFlightActions, 0, 'CONTROLE: o lote que acabou deixou o contador acima de 0');
});

test('R19-1-01: o "Sair" sobe a geração, e todo `finally` que solta estado compartilhado a confere', () => {
  assert.match(fatiar('handleLogout'), /^\s+AppState\.geracaoDoSair = \(AppState\.geracaoDoSair \|\| 0\) \+ 1;/m,
    'o "Sair" deixou de subir a geração: nenhuma resposta velha se distingue da nova');
  for (const nome of ['enviarLote', 'handleBatchMarkRead']) {
    const corpo = fatiar(nome);
    assert.match(corpo, /^\s+const geracao = AppState\.geracaoDoSair;/m, `${nome} não captura a geração do "Sair"`);
    assert.match(corpo, /if \(geracao === AppState\.geracaoDoSair\) AppState\.inFlightActions = Math\.max\(0, AppState\.inFlightActions - 1\);/,
      `${nome} decrementa o contador da sessão nova`);
  }
  const sched = fatiar('scheduleAction');
  assert.match(sched, /const geracao = AppState\.geracaoDoSair;\s*AppState\.inFlightActions\+\+;/, 'o executor não captura a geração junto do incremento');
  assert.match(sched, /marcarEmAndamento\(places, false, geracao\);\s*if \(geracao === AppState\.geracaoDoSair\) AppState\.inFlightActions = Math\.max/,
    'o `finally` do executor solta o que é da sessão nova');
  assert.match(fatiar('enviarAprovacao'), /marcarEmAndamento\(alvo\.place, false, geracao\);/, 'a aprovação solta o "em andamento" da sessão nova');
  // As funções de marcar ignoram a geração velha nos dois sentidos.
  assert.match(fatiar('marcarEmAndamento'), /if \(geracao !== undefined && geracao !== AppState\.geracaoDoSair\) return;/);
  assert.match(fatiar('marcarLoteSemEnviar'), /if \(geracao !== undefined && geracao !== AppState\.geracaoDoSair\) return;/);
});

test('R19-1-01 (1, 2 e 3): o "Rejeitar os N" de A que responde depois do "Sair" não solta nada do que é de B', async () => {
  const AppState = { geracaoDoSair: 0, inFlightActions: 0, authenticated: true, queue: [], currentPlace: null,
    stats: { read: 0, rejected: 3, skipped: 0 }, serverTotal: 0, fetchEpoch: 0, hasMore: false, pendingAction: null, profile: { id: 1 } };
  const portoes = [];
  const deps = {
    AppState, epocaDaSessao: 0, Treino: { ativo: false }, pedidosEmAndamento: new Set(), pedidosDoLoteSemEnviar: new Set(),
    rejeicoesDeLoteNoAr: new Set(), API: { rejectPlace: () => new Promise((ok) => portoes.push(ok)) },
    callWithRetry: (fn) => fn(), carregarFilaDeSaida: () => [], enfileirarSaida: () => true, salvarFilaDeSaida() {},
    reivindicacaoDestaAba: () => ({}), redesenharAvisoDoSairSeAberto() {}, updateInFlightIndicator() {}, updateStats() {}, saveStats() {},
    updatePendingCount() {}, aoMudarAFilaPorBaixo() {}, mostrarResultadoDoLote() {}, quemDecideAgora: () => ({ s: 'a', conta: '1' }),
    dfato() {}, registrarPouso() {}, recordHistory() {}, registrarAcaoConfirmada() {}, tirarDaFilaDeSaida() {}, soltarMarcaDosItens() {},
    pousouNoWaze: (r) => !!(r && r.success), showCurrentPlace() {},
  };
  const h = montar(['enviarLote', 'marcarEmAndamento', 'marcarLoteSemEnviar', 'chaveDoPedido'], deps);
  const lote = [P(1), P(2), P(3)];
  const fim = h.enviarLote(lote, { regiao: 'row', gesto: { dia: '2026-10-14', onde: '30' } });
  await ateQue(() => portoes.length === 1, 'PRÉ-CONDIÇÃO: a ida do 1º pedido de A saiu');
  assert.equal(AppState.inFlightActions, 1, 'PRÉ-CONDIÇÃO: o lote de A conta no ar');
  assert.equal(deps.pedidosDoLoteSemEnviar.size, 2, 'PRÉ-CONDIÇÃO: 2 pedidos de A esperando');
  sair(deps);
  deps.epocaDaSessao++;
  // B: o mesmo pedido 2 em andamento e esperando, e a decisão dele no ar.
  h.marcarEmAndamento(lote[1], true, AppState.geracaoDoSair);
  h.marcarLoteSemEnviar(lote[1], true, AppState.geracaoDoSair);
  AppState.inFlightActions = 1;
  portoes.shift()({ success: true });                            // A responde
  await fim;
  assert.equal(AppState.inFlightActions, 1, 'DEFEITO: o lote de A zerou o contador da decisão de B');
  assert.ok(deps.pedidosEmAndamento.has(chaveDe(lote[1])), 'DEFEITO: o lote de A tirou o pedido de B do "em andamento"');
  assert.ok(deps.pedidosDoLoteSemEnviar.has(chaveDe(lote[1])), 'DEFEITO: o lote de A tirou o pedido de B dos "esperando envio"');
});

// ───────────────────── R19-1-02: os códigos de pareamento sobrevivem à recarga ─────────────────────
// A lista dos códigos emitidos era um `Set` em memória: emitir o QR, recarregar e dar "Sair" mandava
// ZERO `parear/cancel`, e o código seguia valendo no servidor por até 5 min numa conta que já saiu.
// Agora a lista grava no `sessionStorage` da aba (nunca no `localStorage`: o diagnóstico o leva
// inteiro) com a hora em que cada código vence, e a "recarga" a devolve.
function trechoDaClasse() {
  const ini = SEM.indexOf('class PareamentosEmitidos extends Set {');
  assert.ok(ini > 0, 'a classe da lista de códigos emitidos sumiu do app.js');
  let prof = 0;
  for (let j = SEM.indexOf('{', ini); j < SEM.length; j++) {
    if (SEM[j] === '{') prof++;
    else if (SEM[j] === '}' && --prof === 0) return SEM.slice(ini, j + 1);
  }
  throw new Error('não fechou a classe');
}
function abaDeMentira({ guardado = null, quebrado = false } = {}) {
  const dados = new Map(guardado ? [[CHAVE_PAREAMENTOS, guardado]] : []);
  const sessionStorage = quebrado
    ? { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } }
    : { getItem: (k) => (dados.has(k) ? dados.get(k) : null), setItem: (k, v) => dados.set(k, String(v)), removeItem: (k) => dados.delete(k) };
  return { dados, sessionStorage };
}
const CHAVE_PAREAMENTOS = (/^const PAREAMENTOS_CHAVE = '([^']+)';/m.exec(SEM) || [])[1];
const relogio = { agora: 1_000_000 };
function listaDaAba(aba) {
  const fonte = `const PAREAMENTO_VALE_MS = ${(/^const PAREAMENTO_VALE_MS = ([^;]+);/m.exec(SEM) || [])[1]};\n`
    + `const PAREAMENTOS_CHAVE = '${CHAVE_PAREAMENTOS}';\n${trechoDaClasse()}\nreturn new PareamentosEmitidos().reler();`;
  const DateFalso = { now: () => relogio.agora };
  return new Function('sessionStorage', 'Date', fonte)(aba.sessionStorage, DateFalso);
}

test('R19-1-02: o código emitido sobrevive à "recarga" da aba — o "Sair" depois dela tem o que cancelar', () => {
  assert.ok(CHAVE_PAREAMENTOS, 'a chave da lista guardada sumiu do app.js');
  const aba = abaDeMentira();
  const antes = listaDaAba(aba);
  antes.add('QRQRQRQRQRQRQRQRQRQR');
  antes.add('ABC234');
  assert.equal(antes.size, 2);
  // A "recarga": uma lista nova, com o mesmo armazenamento da aba.
  const depois = listaDaAba(aba);
  assert.deepEqual([...depois].sort(), ['ABC234', 'QRQRQRQRQRQRQRQRQRQR'],
    'DEFEITO: a recarga esqueceu os códigos emitidos — o "Sair" mandaria 0 cancelamentos');
  // O "Sair" percorre a lista e a esvazia (o mesmo laço do `handleLogout`): nada fica guardado.
  const cancelados = [];
  for (const code of depois) cancelados.push(code);
  depois.clear();
  assert.equal(cancelados.length, 2);
  assert.equal(listaDaAba(aba).size, 0, 'o "Sair" cancelou os códigos, mas eles voltam na recarga seguinte');
  assert.equal(aba.dados.size, 0, 'a lista esvaziada deixou a chave no armazenamento da aba');
  // CONTROLE: sem a persistência (aba nova, sem nada guardado) a lista nasce vazia.
  assert.equal(listaDaAba(abaDeMentira()).size, 0, 'CONTROLE: aba nova com código guardado');
});

test('R19-1-02: o código que JÁ venceu não volta (o servidor o recusa), e o que vale ainda volta', () => {
  const aba = abaDeMentira();
  const l = listaDaAba(aba);
  l.add('VELHO2');
  relogio.agora += 4 * 60 * 1000;           // 4 min depois, o segundo código
  l.add('NOVO234');
  relogio.agora += 90 * 1000;                // +1,5 min: o 1º tem 5,5 min (venceu), o 2º tem 1,5
  const depois = listaDaAba(aba);
  assert.deepEqual([...depois], ['NOVO234'], 'DEFEITO: o código vencido voltou à lista (ou o válido se perdeu)');
  relogio.agora += 10 * 60 * 1000;
  assert.equal(listaDaAba(aba).size, 0, 'CONTROLE: o último também vence');
});

test('R19-1-02: tirar um código (delete) tira também do armazenamento; sem armazenamento da aba a lista segue em memória', () => {
  const aba = abaDeMentira();
  const l = listaDaAba(aba);
  l.add('AAAAAA'); l.add('BBBBBB');
  l.delete('AAAAAA');
  assert.deepEqual([...listaDaAba(aba)], ['BBBBBB'], 'o código tirado voltou na recarga');
  // A aba sem `sessionStorage` utilizável (janela privada, bloqueado): nada lança, vale em memória.
  const quebrada = listaDaAba(abaDeMentira({ quebrado: true }));
  quebrada.add('CCCCCC');
  assert.deepEqual([...quebrada], ['CCCCCC']);
  quebrada.clear();
  assert.equal(quebrada.size, 0);
  // Lixo guardado não derruba a abertura.
  for (const lixo of ['{', 'null', '"x"', '[[1,2],["",5],["ok"]]']) {
    assert.equal(listaDaAba(abaDeMentira({ guardado: lixo })).size, 0, `lixo guardado (${lixo}) virou código`);
  }
});

test('R19-1-02 (estrutura): a lista vive no `sessionStorage` (nunca no `localStorage`) e o relatório do modo dev não leva os códigos', () => {
  const classe = trechoDaClasse();
  assert.doesNotMatch(classe, /localStorage|safeLS/, 'o segredo do pareamento foi pro armazenamento do aparelho (o diagnóstico leva o localStorage inteiro)');
  assert.match(classe, /sessionStorage\.setItem\(PAREAMENTOS_CHAVE/, 'a lista deixou de gravar na aba');
  assert.match(SEM, /^const pareamentosEmitidos = new PareamentosEmitidos\(\)\.reler\(\);/m, 'a lista não relê a aba ao nascer');
  // O despejo do `sessionStorage` do relatório diz QUANTOS códigos há, nunca quais.
  const corpo = fatiar('diagCorpo');
  assert.match(corpo, /ss\[k\] = k === PAREAMENTOS_CHAVE \? '\[códigos de pareamento omitidos: ' \+ pareamentosEmitidos\.size \+ '\]' : sessionStorage\.getItem\(k\);/,
    'DEFEITO: o relatório do modo dev leva o segredo do pareamento guardado na aba');
  // O "Sair" e a troca de conta seguem cancelando e esvaziando a MESMA lista.
  for (const nome of ['handleLogout', 'fecharOQueEraDaContaAnterior']) {
    assert.match(fatiar(nome), /for \(const code of pareamentosEmitidos\) API\.cancelarPareamento\(code\)\.catch\(\(\) => \{\}\);\s*pareamentosEmitidos\.clear\(\);/,
      `${nome} deixou de cancelar e esvaziar os códigos emitidos`);
  }
});

test('R19-1-02: a Privacidade conta o código de pareamento guardado na aba — nos 4 idiomas, com o prazo da constante', async () => {
  const vm = await import('node:vm');
  const ctx = { window: {}, document: undefined, navigator: { language: 'pt' }, localStorage: { getItem: () => null, setItem() {} } };
  vm.createContext(ctx);
  vm.runInContext(I18N + '\nthis.__DICT = I18N_DICT;', ctx);
  const frases = { pt: /o código de pareamento que você mostrou, só nesta aba e por \{parearMin\} minutos/,
    en: /the pairing code you showed, only in this tab and for \{parearMin\} minutes/,
    es: /el código de emparejamiento que mostraste, solo en esta pestaña y por \{parearMin\} minutos/,
    fr: /le code d’appairage que vous avez affiché, dans cet onglet seulement et pendant \{parearMin\} minutes/ };
  assert.deepEqual(Object.keys(ctx.__DICT).sort(), Object.keys(frases).sort(), 'CONTROLE: o teste não cobre todas as línguas');
  for (const [lang, re] of Object.entries(frases)) {
    assert.match(ctx.__DICT[lang]['help.privacy.device'], re, `${lang}: a Privacidade não conta o código de pareamento guardado na aba`);
  }
  // O prazo que a tela cita é o que a lista guarda (e o do servidor: test/consistencia).
  const exibido = Number((/^const PAREAR_MIN_EXIBIDO = (\d+);/m.exec(SEM) || [])[1]);
  const guarda = (/^const PAREAMENTO_VALE_MS = (\d+) \* 60 \* 1000;/m.exec(SEM) || [])[1];
  assert.ok(exibido > 1 && Number(guarda) === exibido, `a lista guarda o código por ${guarda} min e a Ajuda diz ${exibido}`);
  // A reserva do HTML (o que se vê antes do JS) é a mesma frase.
  const html = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
  assert.match(html, /data-i18n="help\.privacy\.device">[^<]*o código de pareamento que você mostrou, só nesta aba e por 5 minutos/);
});
