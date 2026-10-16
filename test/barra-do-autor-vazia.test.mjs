// R12-2-06 (auditoria de 2026-10-07, rodada 12 — o lote 16 da fila). Com o app
// aberto em duas abas da mesma conta e o foco num autor ("Primeiro os de X ·
// N de M"), a OUTRA aba decide a série dele inteira (o "Marcar todos" de lá). O
// card da tela, decidido lá, FICA (R10-2-02) e fica FORA da série (R11-2-06,
// decisão) — e a barra seguia na tela dizendo "Primeiro os de autor900 · 0 de
// 3", com o leitor de tela anunciando "Mostrando primeiro os 0 pedidos de
// autor900" (MEDIDO no navegador, roteiro e13 da rodada 12; o mesmo depois do
// "Rejeitar os 2" com o card anotado na frente, "0 de 2").
//
// DECISÃO (o pedido do lote 16): a série que fica VAZIA esconde a barra e solta
// o foco no autor — a regra que já valia quando o card muda de autor ("a barra
// some sozinha quando a série acaba") —, e o foco do TECLADO que estava na barra
// vai a um alvo que existe (o caminho de volta no card: o "Ver +N" ou o ✕;
// travado, o ✕ fica prometido), nunca ao <body>.
//
// As funções rodam DE VERDADE, fatiadas do app.js, com o documento de mentira:
// a barra sozinha (`renderFocoAutor`) e o caminho inteiro do aviso da outra aba
// (`anotarDecididosPorOutraAba` → `tirarDaFilaOQueAOutraAbaDecidiu` →
// `aoMudarAFilaPorBaixo` → `renderFocoAutor`). O foco pousando de fato, nos dois
// motores, está no bloco "O CARD" do `tools/smoke-browser.mjs` (R12-2-06). Cada
// teste foi visto REPROVANDO com o conserto desfeito, e carrega o CONTROLE da
// série que NÃO acabou (a barra fica, contando).
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

// ── O documento de mentira ──────────────────────────────────────────────────
// Elemento com o que o `focavelNaTela`, o `.focus()`, a classe `hidden` e o
// `contains` usam. Escondido, ele some da tela (`getClientRects` vazio), como no
// navegador.
function montarDoc() {
  const doc = { body: { nome: 'body' }, activeElement: null, els: {} };
  const el = (nome, { classes = [], disabled = false } = {}) => {
    const e = { nome, disabled, isConnected: true, textContent: '', attrs: {}, classes: new Set(classes) };
    e.classList = { add: (c) => e.classes.add(c), remove: (c) => e.classes.delete(c), contains: (c) => e.classes.has(c) };
    e.getClientRects = () => (e.classes.has('hidden') ? [] : [1]);
    e.setAttribute = (k, v) => { e.attrs[k] = String(v); };
    e.getAttribute = (k) => (k in e.attrs ? e.attrs[k] : null);
    e.contains = (x) => x === e;
    e.focus = () => { doc.activeElement = e; };
    return e;
  };
  doc.el = el;
  for (const id of ['focoAutorBar', 'focoAutorTexto', 'focoAutorContagem']) doc.els[id] = el(id, { classes: ['hidden'] });
  doc.getElementById = (id) => doc.els[id] || null;
  doc.querySelector = () => null;
  doc.activeElement = doc.body;
  return doc;
}
// O card da frente: o "Ver +N" (ou sem ele) e os três botões.
function cardDe(doc, { selo = false, travado = false } = {}) {
  const bs = {
    '.selo-lote': selo ? doc.el('Ver +N') : null,
    '.card-btn-reject': doc.el('✕', { disabled: travado }), '.card-btn-skip': doc.el('↑', { disabled: travado }),
    '.card-btn-read': doc.el('✓', { disabled: travado }),
  };
  return { bs, querySelector: (sel) => bs[sel] || null, contains: (x) => Object.values(bs).includes(x) };
}

const P = (id, autor) => ({ venueID: 'v' + id, updateRequestID: 'u' + id, creatorId: autor, createdBy: 'autor' + autor });
const chave = (p) => (p ? p.venueID + '|' + p.updateRequestID : null);
const ids = (fila) => fila.map((p) => p.updateRequestID);
const microtarefas = () => new Promise((ok) => setTimeout(ok, 0));

// O caminho INTEIRO do aviso da outra aba, com a barra de verdade: a fila do
// roteiro e13 (P1 e P2 do autor 900, X e Y de outros), com o foco no 900 — a
// série na frente, a barra "2 de 4".
function montar({ fila, foco = 900, card = {} } = {}) {
  const doc = montarDoc();
  const AppState = { autorEmFoco: foco, queue: fila.slice(), currentPlace: fila[0], serverTotal: fila.length, pendingAction: null };
  const estado = { card: cardDe(doc, card) };
  const decididos = new WeakSet();
  const deps = {
    AppState, document: doc, decididosPorOutraAbaComCardAqui: decididos, pedidosEmAndamento: new Set(),
    Treino: { ativo: false }, cardDaFrente: () => estado.card, renderSelosDeProcedencia: () => {}, montarCardDeFundo: () => {},
    updatePendingCount: () => {},
    t: (k, v) => (k === 'card.focoAutor.contagem' ? `${v.n} de ${v.total}` : k + (v && v.n != null ? '#' + v.n : '')),
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, [
    'let aquecimentoDaFrenteFeito = false;', 'let focoDoTeclado = null;', constante('BOTAO_DA_ACAO'),
    ...['chaveDoPedido', 'filaReal', 'filaRealComDevolvidos', 'anotarDecididosPorOutraAba', 'tirarDaFilaOQueAOutraAbaDecidiu',
      'seloComFoco', 'devolverFocoAoSelo', 'aoMudarAFilaPorBaixo', 'serieDoAutor', 'focavelNaTela', 'focarDepoisDoFocoNoAutor',
      'renderFocoAutor'].map(fatiar),
    'return { renderFocoAutor, avisoDaOutraAba: (ps) => { anotarDecididosPorOutraAba(null, ps.map(chaveDoPedido)); tirarDaFilaOQueAOutraAbaDecidiu(); },'
      + ' pendente: () => focoDoTeclado };',
  ].join('\n'))(...nomes.map((n) => deps[n]));
  const barra = doc.els.focoAutorBar;
  return {
    app, doc, AppState, estado, decididos, barra,
    visivel: () => !barra.classes.has('hidden'),
    contagem: () => doc.els.focoAutorContagem.textContent,
    aria: () => barra.getAttribute('aria-label'),
  };
}
const filaDoRoteiro = () => [P('P1', 900), P('P2', 900), P('X', 901), P('Y', 902)];

test('R12-2-06: a outra aba decide a série do autor em foco — a barra SOME (nada de "0 de 3") e o foco no autor sai', () => {
  const fila = filaDoRoteiro();
  const m = montar({ fila });
  m.app.renderFocoAutor();
  assert.deepEqual([m.visivel(), m.contagem(), m.aria()], [true, '2 de 4', 'card.focoAutor.aria#2'],
    'PRÉ-CONDIÇÃO: a barra do foco no autor900, "2 de 4"');
  // O aviso da outra aba (o "Marcar todos" de lá decidiu P1 e P2): P2 sai da
  // fila, P1 — o card da tela — fica, anotado (R10-2-02).
  m.app.avisoDaOutraAba([fila[0], fila[1]]);
  assert.deepEqual(ids(m.AppState.queue), ['uP1', 'uX', 'uY'], 'PRÉ-CONDIÇÃO: a fila de depois do aviso (o card da tela fica)');
  assert.ok(m.decididos.has(fila[0]), 'PRÉ-CONDIÇÃO: o card da tela ficou anotado');
  assert.equal(m.visivel(), false,
    `DEFEITO: a barra seguiu na tela com a série VAZIA — "${m.contagem()}", e o leitor de tela "${m.aria()}"`);
  assert.doesNotMatch(m.contagem(), /^0 de/, 'DEFEITO: a barra escreveu "0 de N"');
  assert.doesNotMatch(String(m.aria()), /#0$/, 'DEFEITO: o nome acessível da barra passou a dizer "os 0 pedidos"');
  assert.equal(m.AppState.autorEmFoco, null, 'DEFEITO: a série acabou e o foco no autor seguiu ligado');
  assert.equal(m.AppState.currentPlace, fila[0], 'o card da tela trocou');
  // CONTROLE: a outra aba decide só o P2 — a série ainda tem o card da tela,
  // e a barra fica, contando ("1 de 3").
  const cf = filaDoRoteiro();
  const c = montar({ fila: cf });
  c.app.renderFocoAutor();
  c.app.avisoDaOutraAba([cf[1]]);
  assert.deepEqual([c.visivel(), c.contagem(), c.aria(), c.AppState.autorEmFoco], [true, '1 de 3', 'card.focoAutor.ariaUm#1', 900],
    'CONTROLE: com a série ainda viva, a barra saiu (ou deixou de contar)');
});

test('R12-2-06: a série que acaba com o card do autor na tela some igual pela barra sozinha ("Rejeitar os N" com o anotado na frente)', () => {
  // O e4b do auditor: P1 (900, anotado, na tela) e X; o "Rejeitar os 2" levou P2 e P3.
  const fila = [P('P1', 900), P('X', 901)];
  const m = montar({ fila });
  m.decididos.add(fila[0]);
  m.app.renderFocoAutor();
  assert.equal(m.visivel(), false, `DEFEITO: a barra apareceu com a série vazia ("${m.contagem()}")`);
  assert.equal(m.AppState.autorEmFoco, null, 'DEFEITO: o foco no autor seguiu ligado com a série vazia');
  // CONTROLE: o mesmo card SEM a anotação é a série (o último dela) — a barra
  // fica, no singular.
  const c = montar({ fila: [P('P1', 900), P('X', 901)] });
  c.app.renderFocoAutor();
  assert.deepEqual([c.visivel(), c.contagem(), c.aria(), c.AppState.autorEmFoco], [true, '1 de 2', 'card.focoAutor.ariaUm#1', 900]);
});

test('R12-2-06: com o foco do TECLADO na barra, ela some e o foco vai ao ✕ do card — nunca ao <body>', async () => {
  const fila = filaDoRoteiro();
  const m = montar({ fila });
  m.app.renderFocoAutor();
  m.barra.focus();                                      // o Enter no "Ver +N" leva o foco à barra (C10)
  assert.equal(m.doc.activeElement, m.barra, 'PRÉ-CONDIÇÃO: o foco está na barra');
  m.app.avisoDaOutraAba([fila[0], fila[1]]);
  await microtarefas();
  assert.equal(m.visivel(), false, 'PRÉ-CONDIÇÃO: a barra sumiu');
  assert.equal(m.doc.activeElement, m.estado.card.bs['.card-btn-reject'],
    `DEFEITO: a barra sumiu com o foco nela e ele não foi ao ✕ do card (está em ${m.doc.activeElement && m.doc.activeElement.nome})`);
  // Card TRAVADO (a janela do Desfazer de um gesto noutra coisa): nada focável
  // agora — o ✕ fica PROMETIDO ao teclado, e pousa quando destravar.
  const tf = filaDoRoteiro();
  const t = montar({ fila: tf, card: { travado: true } });
  t.app.renderFocoAutor();
  t.barra.focus();
  t.app.avisoDaOutraAba([tf[0], tf[1]]);
  await microtarefas();
  assert.equal(t.app.pendente(), '.card-btn-reject', 'com o card travado, o foco não ficou prometido ao ✕');
  // Quem pôs o foco em OUTRO lugar antes de ele mudar (um diálogo que abriu no
  // mesmo trecho) ganha: a barra não o toma de volta.
  const qf = filaDoRoteiro();
  const q = montar({ fila: qf });
  q.app.renderFocoAutor();
  q.barra.focus();
  q.app.avisoDaOutraAba([qf[0], qf[1]]);
  const dialogo = q.doc.el('diálogo');
  dialogo.focus();
  await microtarefas();
  assert.equal(q.doc.activeElement, dialogo, 'a barra que sumiu tirou o foco de quem o tinha pego depois dela');
  // CONTROLE: o foco NÃO estava na barra (o mouse, o Tab noutro lugar) — a
  // barra some e o foco fica onde a pessoa o pôs.
  const cf = filaDoRoteiro();
  const c = montar({ fila: cf });
  c.app.renderFocoAutor();
  const outro = c.doc.el('Filtros');
  outro.focus();
  c.app.avisoDaOutraAba([cf[0], cf[1]]);
  await microtarefas();
  assert.equal(c.visivel(), false);
  assert.equal(c.doc.activeElement, outro, 'CONTROLE: a barra sumiu e levou embora o foco que estava em OUTRO lugar');
  assert.equal(c.app.pendente(), null, 'CONTROLE: o foco ficou prometido ao ✕ sem ter saído da barra');
});

test('R12-2-06: o foco sai da barra só DEPOIS de o card novo estar na tela (o `renderCurrentCard` desenha a barra antes)', async () => {
  // A barra é desenhada pelo `renderCurrentCard` ANTES de o card novo entrar no
  // DOM: mover o foco na hora pousaria no card que está SAINDO. Aqui o card da
  // frente troca logo depois da barra, no mesmo trecho síncrono — o foco tem de
  // ir ao ✕ do NOVO.
  const fila = [P('P1', 900), P('X', 901)];
  const m = montar({ fila });
  m.decididos.add(fila[0]);
  m.barra.classes.delete('hidden');
  m.barra.focus();
  const velho = m.estado.card;
  m.app.renderFocoAutor();
  m.estado.card = cardDe(m.doc);                         // o card novo entra (o `appendChild` do render)
  await microtarefas();
  assert.equal(m.doc.activeElement, m.estado.card.bs['.card-btn-reject'],
    `o foco pousou no card que estava SAINDO (${m.doc.activeElement === velho.bs['.card-btn-reject'] ? 'o velho' : m.doc.activeElement && m.doc.activeElement.nome})`);
});

test('R12-2-06: o bundle GERADO tem o conserto (senão nada disso está no ar)', () => {
  // A série vazia esconde a barra e solta o foco no autor ANTES de escrever a
  // contagem: no js/min/app.js, o `===0` com o `autorEmFoco=null` dentro do
  // `renderFocoAutor` (o esbuild troca os nomes locais).
  const r = /function renderFocoAutor\(\)\{[\s\S]*?\n?\}function /.exec(MIN);
  assert.ok(r, 'o renderFocoAutor sumiu do js/min/app.js');
  assert.match(r[0], /===0\)\{[^}]*AppState\.autorEmFoco=null/,
    'o js/min/app.js não esconde a barra da série vazia — rode `npm run js`');
});
