// A fila que MUDA por baixo do card na tela (auditoria de 2026-09-25).
//
// Três coisas eram calculadas a partir da fila no instante em que o card entrou,
// e ficavam velhas quando ela mudava depois — uma página que chega, a recusa
// automática tirando pedidos:
//   · o foco num autor (o "Ver +N"): a ordenação pendente espalhava a série
//     dele no próximo card, e a barra do foco sumia depois de um pedido só;
//   · o "Ver +N" do card: seguia contando a fila de antes;
//   · o card de FUNDO da pilha: anunciava um pedido, e entrava outro.
// Cada teste foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const SEM = APP.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  const a = SEM.indexOf('{', SEM.indexOf(')', m.index));
  let prof = 0;
  for (let j = a; j < SEM.length; j++) {
    if (SEM[j] === '{') prof++;
    else if (SEM[j] === '}' && --prof === 0) return SEM.slice(m.index, j + 1);
  }
  throw new Error('não fechou: ' + nome);
}

// ── o foco no autor sobrevive à ordenação ────────────────────────────────────
function ordenar(queue, { autorEmFoco = null, sortOrder = 'newest' } = {}) {
  const AppState = { queue, autorEmFoco, filters: { sortOrder } };
  const fn = new Function('AppState', 'referenciaDaOrdem', 'pontoDoPlace', 'distanciaKm',
    fatiar('sortQueue') + '\n' + fatiar('manterFocoNaFrente') + '\nreturn sortQueue;')(
    AppState, () => null, () => null, () => 0);
  fn();
  return AppState.queue.map((p) => p.id);
}
const P = (id, creatorId, dateAdded) => ({ id, creatorId, dateAdded });

test('a ordenação pendente NÃO espalha a série do autor em foco', () => {
  // Foco no autor 7: a série dele na frente. Chega uma página, o card anda, e
  // o `advanceQueue` aplica a ordem pendente — por data, o 7 estava espalhado.
  const fila = [P('a7', 7, 100), P('b7', 7, 900), P('x', 1, 500), P('y', 2, 800), P('c7', 7, 300)];
  const saida = ordenar(fila.slice(), { autorEmFoco: 7 });
  assert.deepEqual(saida.slice(0, 3).sort(), ['a7', 'b7', 'c7'], `a série do autor em foco se espalhou: ${saida}`);
  assert.deepEqual(saida, ['b7', 'c7', 'a7', 'y', 'x'], 'dentro de cada grupo a ordem pedida continua valendo');
  // Controle: sem foco, a ordem é só a de data.
  assert.deepEqual(ordenar(fila.slice()), ['b7', 'y', 'x', 'c7', 'a7']);
});

test('a ordenação reordena NO LUGAR — quem segura a fila segue vendo a mesma', () => {
  const fila = [P('x', 1, 500), P('a7', 7, 100)];
  const AppState = { queue: fila, autorEmFoco: 7, filters: { sortOrder: 'newest' } };
  new Function('AppState', 'referenciaDaOrdem', 'pontoDoPlace', 'distanciaKm',
    fatiar('sortQueue') + '\n' + fatiar('manterFocoNaFrente') + '\nreturn sortQueue;')(
    AppState, () => null, () => null, () => 0)();
  assert.equal(AppState.queue, fila, 'trocou o array da fila');
  assert.deepEqual(fila.map((p) => p.id), ['a7', 'x']);
});

test('a ordem pedida EXPLICITAMENTE encerra o foco (o gesto mais recente ganha)', () => {
  assert.match(fatiar('reordenarFilaNaTela'), /limparFocoAutor\(\);\s*sortQueue\(\);/,
    'trocar a ordem deixou a série do autor na frente da ordem que a pessoa acabou de pedir');
});

// ── o "Ver +N" e o card de fundo acompanham a fila ──────────────────────────
function montar({ aquecido = true, fundoPedido = 'v|u2' } = {}) {
  const log = [];
  const linha = { _selos: { remove: () => log.push('selos-sai') }, querySelector: (s) => (s === '.selos-proc' ? linha._selos : null) };
  const card = { querySelector: (s) => (s === '.card-creator-row' ? linha : null) };
  const fundo = fundoPedido === null ? null : { dataset: { pedido: fundoPedido } };
  const A = { venueID: 'v', updateRequestID: 'u1' };
  const AppState = { currentPlace: A, queue: [A, { venueID: 'v', updateRequestID: 'u2' }] };
  const deps = {
    AppState, cardDaFrente: () => card,
    renderSelosDeProcedencia: () => log.push('selos'),
    montarCardDeFundo: () => log.push('fundo'),
    chaveDoPedido: (p) => (p ? p.venueID + '|' + p.updateRequestID : null),
    document: { querySelector: () => fundo },
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let aquecimentoDaFrenteFeito = ${aquecido};\n${fatiar('aoMudarAFilaPorBaixo')}\nreturn aoMudarAFilaPorBaixo;`)(
    ...chaves.map((k) => deps[k]));
  return { app, log, AppState };
}

test('a fila mudou por baixo: o "Ver +N" é recalculado e o card de fundo é refeito SÓ se o próximo mudou', () => {
  const m = montar();
  m.AppState.queue.splice(1, 1, { venueID: 'v', updateRequestID: 'u9' });   // a recusa tirou o u2
  m.app();
  assert.deepEqual(m.log, ['selos-sai', 'selos', 'fundo'], `o card não acompanhou a fila: ${m.log}`);
  // Controle: o próximo é o MESMO — nada de refazer a pilha à toa.
  const igual = montar();
  igual.app();
  assert.deepEqual(igual.log, ['selos-sai', 'selos']);
  // A fila ganhou o próximo que faltava (era o último da fila).
  const sem = montar({ fundoPedido: null });
  sem.app();
  assert.ok(sem.log.includes('fundo'), 'a pilha não apareceu quando o próximo chegou');
});

test('antes de o aquecimento montar o fundo, não se monta nada (ele lê a fila de agora na hora dele)', () => {
  const m = montar({ aquecido: false, fundoPedido: null });
  m.app();
  assert.ok(!m.log.includes('fundo'), 'montou o card de fundo competindo com a foto do card da frente');
  assert.ok(m.log.includes('selos'));
});

test('quem muda a fila por baixo chama o acerto, e o card de fundo diz qual pedido anuncia', () => {
  const busca = fatiar('fetchNextPage');
  assert.match(busca, /aplicarRecusaAutomatica\(\);\s*aoMudarAFilaPorBaixo\(\);/,
    'a página que chega com o card na tela não acerta o card');
  const recusa = fatiar('aplicarRecusaAutomatica');
  assert.match(recusa, /AppState\.queue = AppState\.queue\.filter\(\(x\) => !fora\.has\(x\)\);\s*updatePendingCount\(\);\s*aoMudarAFilaPorBaixo\(\);/,
    'a recusa automática tira pedidos da fila sem acertar o card');
  assert.match(fatiar('montarCardDeFundo'), /fundo\.dataset\.pedido = chaveDoPedido\(proximo\) \|\| '';/);
  const aq = fatiar('agendarAquecimento');
  assert.match(aq, /aquecimentoDaFrenteFeito = false;/);
  assert.match(aq, /disparado = true;\s*aquecimentoDaFrenteFeito = true;/);
});

// ── a barra do foco cumpre o que diz (auditoria do card, 2026-09-29, C11) ────
// A barra promete "Tocar para voltar à ordem normal" (é o nome dela pro leitor
// de tela, nas quatro línguas), e o toque só escondia a barra: MEDIDO no
// navegador, X1,X2,X3,Y1,Y2 depois do toque, com a ordem normal X1,Y1,X2,Y2,X3.
// Aqui rodam o `voltarAOrdemNormal`, o `limparFocoAutor` e a ordenação de
// verdade; a prova na tela (o toque, o card de fundo) mora no bloco "O CARD"
// do `tools/smoke-browser.mjs`.
function voltarPelaBarra(queue, { autorEmFoco }) {
  const log = [];
  const AppState = { queue, autorEmFoco, currentPlace: queue[0], filters: { sortOrder: 'newest' } };
  // O foco do teclado depois da barra (`veioDoTeclado`/`focarDepoisDoFocoNoAutor`)
  // tem teste próprio em test/card-foco-trava; aqui o toque é do dedo.
  const fn = new Function('AppState', 'referenciaDaOrdem', 'pontoDoPlace', 'distanciaKm', 'renderFocoAutor',
    'updatePendingCount', 'aoMudarAFilaPorBaixo', 'veioDoTeclado', 'focarDepoisDoFocoNoAutor',
    [fatiar('sortQueue'), fatiar('manterFocoNaFrente'), fatiar('limparFocoAutor'), fatiar('voltarAOrdemNormal'),
      'return voltarAOrdemNormal;'].join('\n'))(
    AppState, () => null, () => null, () => 0, () => log.push('barra'), () => log.push('conta'), () => log.push('porBaixo'),
    () => false, () => log.push('foco'));
  fn();
  return { ids: AppState.queue.map((p) => p.id), AppState, log };
}

test('r4 C11 tocar na barra do foco VOLTA à ordem normal — e o card da tela fica na frente', () => {
  const X1 = P('X1', 7, 5000), Y1 = P('Y1', 8, 4000), X2 = P('X2', 7, 3000), Y2 = P('Y2', 8, 2000), X3 = P('X3', 7, 1000);
  // Foco no autor 7, X1 na tela: o resto volta à ordem de data.
  const r = voltarPelaBarra([X1, X2, X3, Y1, Y2], { autorEmFoco: 7 });
  assert.deepEqual(r.ids, ['X1', 'Y1', 'X2', 'Y2', 'X3'], `o toque na barra não devolveu a ordem normal: ${r.ids}`);
  assert.equal(r.AppState.autorEmFoco, null, 'o toque não saiu do foco');
  assert.ok(r.log.includes('barra'), 'a barra não foi redesenhada (segue prometendo um foco que acabou)');
  assert.ok(r.log.includes('porBaixo'), 'o card de fundo e o "Ver +N" não acompanham a fila nova');
  // O card da tela NÃO troca, nem quando a ordem normal o poria atrás: foco
  // no 8, Y1 na tela, e X1 é mais novo que ele.
  const s = voltarPelaBarra([Y1, Y2, X1, X2, X3], { autorEmFoco: 8 });
  assert.deepEqual(s.ids, ['Y1', 'X1', 'X2', 'Y2', 'X3'], `trocou o card da tela (ou não ordenou o resto): ${s.ids}`);
  assert.equal(s.AppState.currentPlace, Y1);
  // CONTROLE: a ordenação ingênua da fila INTEIRA tiraria o Y1 da frente — é
  // essa diferença que o caso de cima distingue.
  assert.deepEqual(ordenar([Y1, Y2, X1, X2, X3]), ['X1', 'Y1', 'X2', 'Y2', 'X3']);
  // Sem foco, o toque não mexe em nada.
  const n = voltarPelaBarra([Y1, X1], { autorEmFoco: null });
  assert.deepEqual(n.ids, ['Y1', 'X1']);
  assert.deepEqual(n.log, []);
});

test('r4 C11 o toque na barra chama quem VOLTA à ordem; a ordem nova do filtro segue encerrando o foco', () => {
  assert.match(SEM, /\$\('focoAutorBar'\)\.addEventListener\('click', voltarAOrdemNormal\);/,
    'a barra do foco voltou a só esconder a si mesma — o texto dela promete voltar à ordem normal');
  // E a barra PROMETE isso nas quatro línguas: se a promessa mudar, este teste
  // é o lugar de rever o que o toque faz.
  const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  const promessas = [...I18N.matchAll(/'card\.focoAutor\.aria(?:Um)?':\s*'([^']*)'/g)].map((m) => m[1]);
  assert.equal(promessas.length, 8, `achei ${promessas.length} textos da barra, e são 2 chaves × 4 línguas`);
  for (const p of promessas) assert.match(p, /ordem normal|normal order|orden normal|ordre normal/, `a barra deixou de prometer a ordem normal: "${p}"`);
});
