// A rodada 13 da auditoria na área da FILA (lote 17). Dois achados, os dois de
// tela que diz uma coisa e faz outra:
//
// R13-2-05 — com o foco do TECLADO na barra "Primeiro os de…" (o Enter no "Ver
// +N" o leva pra lá, C10), a seta decide o último pedido do autor, o card
// seguinte é de OUTRO autor, a barra se esconde com o foco nela, e ele caía no
// <body>: quem usa teclado ou leitor de tela recomeçava do topo da página
// (MEDIDO nos dois motores, roteiro c1 da rodada 13). O R12-2-06 tinha dado
// destino ao foco só no caminho da OUTRA aba (a série vazia com o card do autor
// na tela). E o último pedido do autor sendo o FIM da fila: a barra nem saía —
// ficava por cima do "Tudo limpo!" dizendo "Primeiro os de X · 1 de 1", com o
// foco do teclado nela (MEDIDO pela seta nos dois motores, e pelo toque, na
// reprodução deste lote).
//
// R13-2-06 — a conta DESTA aba em dúvida (R6-1-04) que se resolve como a mesma
// conta: a trava (`acoesTravadas`) já soltava quando o perfil chegava, mas os
// três botões seguiam `disabled` até a carga INTEIRA do perfil terminar — o
// `completarPerfilChegado` pode perguntar a outros servidores, segundos —, e
// nesse meio o toque não dizia nada e a seta decidia (MEDIDO no navegador:
// roteiros d1 e d1b da rodada 13).
//
// As funções rodam DE VERDADE, fatiadas do app.js, com o documento de mentira.
// O foco pousando de fato, nos dois motores, está no bloco "O CARD" do
// `tools/smoke-browser.mjs` (R13-2-05). Cada teste foi visto REPROVANDO com o
// conserto desfeito, e carrega o CONTROLE do caso que tem de dar o contrário.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const MIN = readFileSync(new URL('../js/min/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = SEM.indexOf('(', m.index);
  for (let j = i; j < SEM.length; j++) {
    if (SEM[j] === '(') par++;
    else if (SEM[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  let prof = 0;
  for (let j = SEM.indexOf('{', i); j < SEM.length; j++) {
    if (SEM[j] === '{') prof++;
    else if (SEM[j] === '}' && --prof === 0) {
      const corpo = SEM.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
// Declaração de topo `const NOME = …;`, inclusive a que atravessa linhas.
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = [\\s\\S]*?;\\n', 'm').exec(SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
}
const microtarefas = () => new Promise((ok) => setTimeout(ok, 0));

// ── O documento de mentira ──────────────────────────────────────────────────
// Elemento com o que o `focavelNaTela`, o `.focus()`, a classe `hidden` e o
// `contains` usam. Escondido, ele some da tela (`getClientRects` vazio), como no
// navegador — e, como no navegador, o foco num elemento que acabou de se
// esconder SEGUE nele até alguém o mover (o navegador só o larga no <body> no
// próximo desenho).
function montarDoc() {
  const doc = { body: { nome: 'body' }, activeElement: null, els: {} };
  const el = (nome, { classes = [], disabled = false } = {}) => {
    const e = { nome, disabled, isConnected: true, textContent: '', attrs: {}, dataset: {}, classes: new Set(classes) };
    e.classList = { add: (c) => e.classes.add(c), remove: (c) => e.classes.delete(c), contains: (c) => e.classes.has(c),
      toggle: (c, f) => { if (f === undefined ? !e.classes.has(c) : f) e.classes.add(c); else e.classes.delete(c); } };
    e.getClientRects = () => (e.classes.has('hidden') ? [] : [1]);
    e.setAttribute = (k, v) => { e.attrs[k] = String(v); };
    e.getAttribute = (k) => (k in e.attrs ? e.attrs[k] : null);
    e.removeAttribute = (k) => { delete e.attrs[k]; };
    e.contains = (x) => x === e;
    e.focus = () => { doc.activeElement = e; };
    e.querySelector = () => null;
    return e;
  };
  doc.el = el;
  for (const id of ['focoAutorBar', 'focoAutorTexto', 'focoAutorContagem']) doc.els[id] = el(id, { classes: ['hidden'] });
  // O painel do fim da fila e o da falha, cada um com o botão dele.
  doc.els.noMoreCards = el('noMoreCards', { classes: ['hidden'] });
  doc.els.loadErrorState = el('loadErrorState', { classes: ['hidden'] });
  doc.els.reloadBtn = el('Verificar novamente');
  doc.els.retryLoadBtn = el('Tentar de novo');
  doc.els.cardLiveRegion = el('cardLiveRegion');
  // O botão do painel some com o painel (é filho dele).
  for (const [painel, botao] of [['noMoreCards', 'reloadBtn'], ['loadErrorState', 'retryLoadBtn']]) {
    const b = doc.els[botao];
    b.getClientRects = () => (doc.els[painel].classes.has('hidden') ? [] : [1]);
  }
  doc.getElementById = (id) => doc.els[id] || null;
  doc.querySelector = () => null;
  doc.activeElement = doc.body;
  return doc;
}
// O card da frente: o "Ver +N" (ou sem ele) e os três botões.
function cardDe(doc, { selo = false, travado = false, nome = 'card' } = {}) {
  const bs = {
    '.selo-lote': selo ? doc.el(nome + ' Ver +N') : null,
    '.card-btn-reject': doc.el(nome + ' ✕', { disabled: travado }), '.card-btn-skip': doc.el(nome + ' ↑', { disabled: travado }),
    '.card-btn-read': doc.el(nome + ' ✓', { disabled: travado }),
  };
  const classes = new Set();
  return { nome, bs, classes, querySelector: (sel) => bs[sel] || null, contains: (x) => Object.values(bs).includes(x),
    classList: { toggle: (c, f) => { if (f) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) } };
}

const P = (id, autor) => ({ venueID: 'v' + id, updateRequestID: 'u' + id, creatorId: autor, createdBy: 'autor' + autor });

// ═══ R13-2-05 · a série do autor que ACABA pela seta ═══════════════════════════
// A barra de verdade (`renderFocoAutor`), o destino do foco (`focarDepoisDoFocoNoAutor`
// e a régua sem card, `aplicarFocoDoTeclado`), o painel do fim (`showNoPlaces`) e
// o desligar do foco pelo toque na barra (`limparFocoAutor`).
function montar({ fila, foco = 7, card = {}, travado = false } = {}) {
  const doc = montarDoc();
  const AppState = { autorEmFoco: foco, queue: fila.slice(), currentPlace: fila[0] || null, serverTotal: fila.length,
    pendingAction: null, loadError: false, hasMore: false, stats: { skipped: 0 } };
  const estado = { card: fila.length ? cardDe(doc, card) : null, travado };
  const deps = {
    AppState, document: doc, pedidosEmAndamento: new Set(),
    decididosPorOutraAbaComCardAqui: new WeakSet(),
    chaveDoPedido: (p) => (p ? p.venueID + '|' + p.updateRequestID : null),
    cardDaFrente: () => estado.card,
    acoesTravadas: () => estado.travado,
    topOpenModal: () => null, Lightbox: { isOpen: () => false }, MapaLightbox: { isOpen: () => false },
    t: (k, v) => (k === 'card.focoAutor.contagem' ? `${v.n} de ${v.total}` : k + (v && v.n != null ? '#' + v.n : '')),
    // O painel do fim (`showNoPlaces`): o que não é a barra nem o foco fica parado.
    dfato() {}, dlogCapturarAuto() {}, marcarTelaPronta() {}, showLoading() {},
    removeCurrentCardEl: () => { estado.card = null; },
    atualizarConviteInstalar() {}, marcarBordaRolagem() {}, trocarTextoI18n() {},
    checarConquistas() {}, filaZeradaConfirmada: () => false,
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    'let focoDoTeclado = null; let pedidoAnunciado = null;',
    'let tratouNestaFila = true; let recusaAutomaticaNestaFila = false; let puladosNoInicioDaFila = 0;',
    constante('BOTAO_DA_ACAO'),
    ...['serieDoAutor', 'focavelNaTela', 'aplicarFocoDoTeclado', 'focarDepoisDoFocoNoAutor', 'renderFocoAutor',
      'limparFocoAutor', 'puladosNestaFila', 'filaTerminouLimpa', 'showNoPlaces'].map(fatiar),
    'return { renderFocoAutor, limparFocoAutor, showNoPlaces, aplicarFocoDoTeclado, pendente: () => focoDoTeclado };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  const barra = doc.els.focoAutorBar;
  return {
    app, doc, AppState, estado, barra,
    visivel: () => !barra.classes.has('hidden'),
    contagem: () => doc.els.focoAutorContagem.textContent,
    // O `advanceQueue` + `renderCurrentCard` de um gesto que decide o card da
    // frente: a fila anda, a barra é desenhada pelo card novo ANTES de ele
    // entrar na tela, e só então o card novo entra (o `appendChild`).
    decidirAFrente({ selo = false, travado: travadoNovo = false } = {}) {
      AppState.queue.shift();
      AppState.currentPlace = AppState.queue[0] || null;
      if (!AppState.queue.length) { app.showNoPlaces(); return; }
      app.renderFocoAutor();
      estado.card = cardDe(doc, { selo, travado: travadoNovo, nome: AppState.currentPlace.updateRequestID });
    },
  };
}

test('R13-2-05: a SETA decide o último do autor e o próximo card é de OUTRO autor — o foco do teclado vai ao card novo, nunca ao <body>', async () => {
  // A fila do roteiro c1 (Z1, Z2 do autor 7; W1, W2 do 8), com o foco no 7: a
  // série na frente. O Z1 já foi decidido; o Z2 é o último dele.
  const fila = [P('Z2', 7), P('W1', 8), P('W2', 8)];
  const m = montar({ fila });
  m.app.renderFocoAutor();
  assert.deepEqual([m.visivel(), m.contagem()], [true, '1 de 3'], 'PRÉ-CONDIÇÃO: a barra do foco no autor 7, "1 de 3"');
  m.barra.focus();                                      // o Enter no "Ver +N" leva o foco à barra (C10)
  // A seta ← no Z2: o card novo é o W1, que tem o "Ver +1" (o W2 é do mesmo autor).
  m.decidirAFrente({ selo: true });
  assert.equal(m.visivel(), false, 'PRÉ-CONDIÇÃO: a série acabou e a barra saiu');
  assert.equal(m.AppState.autorEmFoco, null, 'a série acabou com outro autor na frente e o foco no autor seguiu ligado');
  await microtarefas();
  const destino = m.doc.activeElement;
  assert.notEqual(destino, m.barra, 'DEFEITO: o foco ficou na barra escondida — o navegador o larga no <body>');
  assert.equal(destino, m.estado.card.bs['.selo-lote'],
    `DEFEITO: a barra sumiu com o foco nela e ele não foi ao caminho de volta no card novo (o "Ver +N"); está em ${destino && destino.nome}`);
  // Sem o "Ver +N" no card novo: o ✕.
  const s = montar({ fila: [P('Z2', 7), P('W1', 8)] });
  s.app.renderFocoAutor();
  s.barra.focus();
  s.decidirAFrente();
  await microtarefas();
  assert.equal(s.doc.activeElement, s.estado.card.bs['.card-btn-reject'],
    `sem o "Ver +N", o foco não foi ao ✕ do card novo (está em ${s.doc.activeElement && s.doc.activeElement.nome})`);
  // Card novo TRAVADO (a janela do Desfazer do gesto que acabou de decidir): o
  // ✕ fica PROMETIDO ao teclado, e pousa quando destravar.
  const t = montar({ fila: [P('Z2', 7), P('W1', 8)] });
  t.app.renderFocoAutor();
  t.barra.focus();
  t.decidirAFrente({ travado: true });
  await microtarefas();
  assert.equal(t.app.pendente(), '.card-btn-reject', 'com o card novo travado, o foco não ficou prometido ao ✕');
});

test('R13-2-05: CONTROLES — a série que segue mantém a barra e o foco nela; o foco em outro lugar e o toque na barra pelo mouse não são movidos', async () => {
  // A série segue: o Z1 sai, o Z2 (do mesmo autor) entra. A barra fica, contando.
  const c = montar({ fila: [P('Z1', 7), P('Z2', 7), P('W1', 8)] });
  c.app.renderFocoAutor();
  c.barra.focus();
  c.decidirAFrente();
  await microtarefas();
  assert.deepEqual([c.visivel(), c.contagem(), c.AppState.autorEmFoco], [true, '1 de 2', 7],
    'CONTROLE: com a série viva, a barra saiu (ou deixou de contar)');
  assert.equal(c.doc.activeElement, c.barra, 'CONTROLE: o foco saiu da barra que ficou');
  // O foco NÃO estava na barra (o mouse, o Tab noutro lugar): a barra sai e o
  // foco fica onde a pessoa o pôs.
  const f = montar({ fila: [P('Z2', 7), P('W1', 8)] });
  f.app.renderFocoAutor();
  const filtros = f.doc.el('Filtros');
  filtros.focus();
  f.decidirAFrente();
  await microtarefas();
  assert.equal(f.visivel(), false);
  assert.equal(f.doc.activeElement, filtros, 'CONTROLE: a série acabou e levou embora o foco que estava em OUTRO lugar');
  assert.equal(f.app.pendente(), null, 'CONTROLE: o foco ficou prometido sem ter saído da barra');
  // Quem pôs o foco em OUTRO lugar entre a barra sumir e a microtarefa ganha.
  const q = montar({ fila: [P('Z2', 7), P('W1', 8)] });
  q.app.renderFocoAutor();
  q.barra.focus();
  q.decidirAFrente();
  const dialogo = q.doc.el('diálogo');
  dialogo.focus();
  await microtarefas();
  assert.equal(q.doc.activeElement, dialogo, 'a barra que sumiu tirou o foco de quem o tinha pego depois dela');
  // O toque na barra pelo MOUSE (o clique a foca): quem DESLIGA o foco no autor
  // (`limparFocoAutor`) decide o foco — e o mouse não move nenhum. Era assim
  // antes, e a série que acaba não pode passar a mover.
  const mouse = montar({ fila: [P('Z1', 7), P('Z2', 7), P('W1', 8)] });
  mouse.app.renderFocoAutor();
  mouse.barra.focus();
  mouse.app.limparFocoAutor();
  await microtarefas();
  assert.equal(mouse.visivel(), false, 'PRÉ-CONDIÇÃO: o toque na barra a escondeu');
  assert.equal(mouse.doc.activeElement, mouse.barra,
    `o toque do MOUSE na barra moveu o foco (foi a ${mouse.doc.activeElement && mouse.doc.activeElement.nome}) — só o teclado move`);
  assert.equal(mouse.app.pendente(), null, 'o toque do mouse na barra deixou o foco prometido ao teclado');
});

test('R13-2-05: o último do autor era o FIM da fila — a barra sai de cima do "Tudo limpo!" e o foco do teclado vai ao "Verificar novamente"', async () => {
  const m = montar({ fila: [P('Z2', 7)] });
  m.app.renderFocoAutor();
  assert.deepEqual([m.visivel(), m.contagem()], [true, '1 de 1'], 'PRÉ-CONDIÇÃO: a barra "1 de 1"');
  m.barra.focus();
  m.decidirAFrente();                                   // o `advanceQueue` com a fila vazia: `showNoPlaces`
  assert.equal(m.doc.els.noMoreCards.classes.has('hidden'), false, 'PRÉ-CONDIÇÃO: o painel do fim da fila apareceu');
  assert.equal(m.visivel(), false,
    `DEFEITO: a barra ficou por cima do "Tudo limpo!" dizendo "Primeiro os de autor7 · ${m.contagem()}"`);
  assert.equal(m.AppState.autorEmFoco, 7, 'o foco no autor saiu sem card — o Desfazer do último pedido não devolve mais a barra');
  await microtarefas();
  assert.equal(m.doc.activeElement, m.doc.els.reloadBtn,
    `DEFEITO: a barra saiu com o foco nela e ele não foi ao botão do painel (está em ${m.doc.activeElement && m.doc.activeElement.nome})`);
  // Na FALHA ao carregar, o botão é o "Tentar de novo".
  const e = montar({ fila: [P('Z2', 7)] });
  e.app.renderFocoAutor();
  e.barra.focus();
  e.AppState.loadError = true;
  e.decidirAFrente();
  await microtarefas();
  assert.equal(e.doc.activeElement, e.doc.els.retryLoadBtn, 'na falha ao carregar, o foco não foi ao "Tentar de novo"');
  // Com a janela do Desfazer correndo (o último ✕), o foco ESPERA: fica prometido
  // e pousa no painel quando a janela acaba — ou no ✕ do card que o Desfazer devolve.
  const j = montar({ fila: [P('Z2', 7)] });
  j.app.renderFocoAutor();
  j.barra.focus();
  j.estado.travado = true;
  j.decidirAFrente();
  await microtarefas();
  assert.equal(j.app.pendente(), '.card-btn-reject', 'na janela do Desfazer, o foco não ficou prometido');
  assert.notEqual(j.doc.activeElement, j.doc.els.reloadBtn, 'o foco pousou no painel com a janela do Desfazer correndo');
  j.estado.travado = false;
  j.app.aplicarFocoDoTeclado();                         // a janela acaba (`aplicarTravaDeAcao`)
  assert.equal(j.doc.activeElement, j.doc.els.reloadBtn, 'a janela acabou e o foco prometido não pousou no "Verificar novamente"');
  // O Desfazer devolve o último pedido: a barra VOLTA, contando.
  const d = montar({ fila: [P('Z2', 7)] });
  d.app.renderFocoAutor();
  d.decidirAFrente();
  d.AppState.queue.unshift(P('Z2', 7));
  d.AppState.currentPlace = d.AppState.queue[0];
  d.app.renderFocoAutor();
  assert.deepEqual([d.visivel(), d.contagem(), d.AppState.autorEmFoco], [true, '1 de 1', 7],
    'o Desfazer devolveu o último pedido do autor e a barra não voltou');
});

test('R13-2-05: CONTROLE — sem o foco do teclado na barra (o toque), ela sai do "Tudo limpo!" sem mover foco nenhum', async () => {
  const m = montar({ fila: [P('Z2', 7)] });
  m.app.renderFocoAutor();
  const de = m.doc.el('outro');
  de.focus();
  m.decidirAFrente();
  await microtarefas();
  assert.equal(m.visivel(), false, 'a barra ficou por cima do "Tudo limpo!"');
  assert.equal(m.doc.activeElement, de, 'CONTROLE: o foco que não estava na barra foi movido');
  assert.equal(m.app.pendente(), null, 'CONTROLE: o foco ficou prometido sem ter saído da barra');
});

test('R13-2-05: o bundle GERADO tem o conserto (senão nada disso está no ar)', () => {
  // O painel do fim tira a barra (`showNoPlaces` → `renderFocoAutor`), e sem card
  // o destino do foco é a régua do teclado (`focarDepoisDoFocoNoAutor` →
  // `aplicarFocoDoTeclado`). O esbuild troca os nomes locais, não os de topo.
  const fim = /function showNoPlaces\(\)\{[\s\S]*?\n?\}function /.exec(MIN);
  assert.ok(fim, 'o showNoPlaces sumiu do js/min/app.js');
  assert.match(fim[0], /renderFocoAutor\(\)/, 'o js/min/app.js não tira a barra no painel do fim — rode `npm run js`');
  const foco = /function focarDepoisDoFocoNoAutor\([^)]*\)\{[\s\S]*?\n?\}function /.exec(MIN);
  assert.ok(foco, 'o focarDepoisDoFocoNoAutor sumiu do js/min/app.js');
  assert.match(foco[0], /aplicarFocoDoTeclado\(\)/, 'o js/min/app.js não leva o foco sem card ao painel — rode `npm run js`');
});

// ═══ R13-2-06 · a conta em dúvida que se resolve destrava o card NA HORA ═══════
// A aba B (sessão `tok-b`, sem perfil) num aparelho cuja sessão guardada é a da
// aba A (`tok-a`), com a conta 4242 confirmada por ela: a dúvida (R6-1-04). A
// conferência pede o perfil; ele CHEGA (o `definirPerfil` de verdade) e a carga
// segue no ar — o `completarPerfilChegado` perguntando a outros servidores —
// até o teste soltar. A trava de verdade (`acoesTravadas` e `aplicarTravaDeAcao`)
// escreve no card de mentira.
function abaEmDuvida() {
  const doc = montarDoc();
  const aparelho = new Map([['waze_session_token', 'tok-a']]);
  const safeLS = { get: (k) => (aparelho.has(k) ? aparelho.get(k) : null), set: (k, v) => aparelho.set(k, v), remove: (k) => aparelho.delete(k) };
  const AppState = { authenticated: true, profile: null, pendingAction: null, currentPlace: P('M1', 9), queue: [P('M1', 9)] };
  const estado = { card: cardDe(doc, { nome: 'M1' }), carga: null, saiu: null, pedidosDePerfil: 0 };
  const deps = {
    AppState, document: doc, safeLS, API: { sessionToken: 'tok-b' },
    cardDaFrente: () => estado.card,
    // A conta do perfil segue no aparelho? É a 4242 (a dona dele) — outra conta sai.
    contaSegueNoAparelho: (id) => String(id) === '4242',
    handleLogout: (o) => { estado.saiu = o || true; },
    aoConhecerConta() {}, guardarReferencias() {}, guardarPerfilDoPortao() {}, guardarPrazoDaSessao() {},
    renderProfileHeader() {}, presencaWmeAoCarregarPerfil() {}, presencaWmeRefazerDesligar() {},
    redesenharFiltrosComOPerfil() {}, reavaliarFotoAbertaPeloPerfil() {},
    // O que a trava de verdade toca fora do card: nada travando, nada aberto.
    aprovacaoDaTelaNoAr: () => false, guardarFocoDaTrava() {}, editandoNome: () => false, manterFocoNoLightbox() {},
    dispensarAvisoDaTrava() {}, pedirComoFuncionaAdiado() {}, aplicarFocoDoTeclado() {},
    cancelarPendenciasDoLightbox() {}, aprovacoesAtravessamAQueda() {},
    // A carga do perfil: o teste diz quando o perfil CHEGA (o `definirPerfil`,
    // no meio da carga) e quando a carga TERMINA (o fim do `completarPerfilChegado`).
    loadProfileAndAuxData: () => {
      estado.pedidosDePerfil++;
      return new Promise((fim) => { estado.carga = { fim }; });
    },
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    constante('CONTA_KEY'),
    'let epocaDaSessao = 0; let conferindoContaDestaAba = false; let loteDeLidosEmVoo = false; let escritasConferindo = 0;',
    'let aprovacaoPendente = null; let exclusaoPendente = null; let renomeacaoPendente = null;',
    'let aprovandoAgora = false; let excluindoAgora = false;',
    ...['marcaDaSessao', 'sessaoDestaAbaEhAGuardada', 'contaDestaAbaEmDuvida', 'acoesTravadas', 'aplicarTravaDeAcao',
      'conferirContaDestaAba', 'definirPerfil'].map(fatiar),
    'return { marcaDaSessao, contaDestaAbaEmDuvida, acoesTravadas, conferirContaDestaAba, definirPerfil };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  // A conta 4242, confirmada pela sessão GUARDADA (a da aba A).
  aparelho.set('waze_places_conta', JSON.stringify({ id: '4242', s: app.marcaDaSessao('tok-a') }));
  const botoes = () => ['.card-btn-reject', '.card-btn-skip', '.card-btn-read'].map((s) => estado.card.querySelector(s).disabled);
  return {
    app, AppState, estado, botoes,
    travadoNaTela: () => estado.card.classList.contains('acoes-travadas'),
    // O perfil chega no meio da carga, como no `loadProfileAndAuxData` de verdade.
    perfilChega: (perfil) => app.definirPerfil({ success: true, profile: perfil }),
    terminaCarga: () => { estado.carga.fim(); return microtarefas(); },
  };
}

test('R13-2-06: a conta em dúvida que se resolve como a MESMA destrava os botões quando o perfil CHEGA — não no fim da carga inteira', async () => {
  const b = abaEmDuvida();
  assert.equal(b.app.contaDestaAbaEmDuvida(), true, 'PRÉ-CONDIÇÃO: a conta desta aba não está em dúvida');
  b.app.conferirContaDestaAba();
  assert.equal(b.estado.pedidosDePerfil, 1, 'PRÉ-CONDIÇÃO: a conferência não pediu o perfil');
  assert.equal(b.app.acoesTravadas(), true, 'PRÉ-CONDIÇÃO: a dúvida não travou o card');
  assert.deepEqual(b.botoes(), [true, true, true], 'PRÉ-CONDIÇÃO: os botões não ficaram travados na dúvida');
  assert.equal(b.travadoNaTela(), true, 'PRÉ-CONDIÇÃO: o card não ficou com cara de travado');
  // O perfil chega (a mesma conta, 4242); a carga segue no ar.
  assert.equal(b.perfilChega({ id: 4242 }), true, 'PRÉ-CONDIÇÃO: o perfil da mesma conta foi recusado');
  assert.equal(b.app.acoesTravadas(), false, 'PRÉ-CONDIÇÃO: com o perfil, a trava não soltou');
  assert.deepEqual(b.botoes(), [false, false, false],
    'DEFEITO: o perfil chegou (a dúvida se resolveu) e os três botões seguiram `disabled` até a carga inteira terminar — o toque não diz nada e a seta decide');
  assert.equal(b.travadoNaTela(), false, 'DEFEITO: o card seguiu com cara de travado com a trava solta');
  assert.equal(b.AppState.contaEmDuvida, false, 'a dúvida resolvida seguiu acesa até o fim da carga');
  await b.terminaCarga();
  assert.deepEqual(b.botoes(), [false, false, false], 'o fim da carga travou o card de novo');
  assert.equal(b.estado.saiu, null, 'a mesma conta tirou a aba');
});

test('R13-2-06: CONTROLES — o perfil que FALHA e o de OUTRA conta não destravam o card', async () => {
  // A carga termina SEM perfil (rede, 5xx): a dúvida fica, e a trava também.
  const f = abaEmDuvida();
  f.app.conferirContaDestaAba();
  await f.terminaCarga();
  assert.equal(f.app.acoesTravadas(), true, 'CONTROLE: a carga sem perfil destravou a aba sem saber de quem ela é');
  assert.deepEqual(f.botoes(), [true, true, true], 'CONTROLE: a carga sem perfil destravou os botões');
  assert.equal(f.AppState.contaEmDuvida, true, 'CONTROLE: a dúvida se apagou sem perfil');
  // O perfil de OUTRA conta: a aba sai (`handleLogout`) e o card não destrava.
  const o = abaEmDuvida();
  o.app.conferirContaDestaAba();
  assert.equal(o.perfilChega({ id: 5151 }), false, 'CONTROLE: o perfil de outra conta foi aceito');
  assert.ok(o.estado.saiu && o.estado.saiu.outraConta, 'CONTROLE: o perfil de outra conta não tirou a aba');
  assert.deepEqual(o.botoes(), [true, true, true], 'CONTROLE: o perfil de OUTRA conta destravou os botões');
  // E sem dúvida nenhuma (o perfil chega numa aba que não estava em dúvida),
  // nada é reaplicado nem mexido: o card segue como estava.
  const n = abaEmDuvida();
  n.estado.card.querySelector('.card-btn-reject').disabled = true;   // a marca de que ninguém escreveu
  n.perfilChega({ id: 4242 });
  assert.equal(n.estado.card.querySelector('.card-btn-reject').disabled, true,
    'CONTROLE: o perfil que chegou SEM dúvida nenhuma reescreveu a trava do card');
});
