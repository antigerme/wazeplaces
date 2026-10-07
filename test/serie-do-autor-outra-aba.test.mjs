// R11-2-06 (auditoria de 2026-10-07, rodada 11). Com o app aberto em duas abas
// da mesma conta, o card da FRENTE que a outra aba já decidiu fica na tela
// (anotado; trocar o card debaixo do dedo é pior que um gesto a mais, R10-2-02).
// A série do autor o contava: o "Rejeitar os 3" da folha mandava 2 — o 3º era
// descontado calado no envio — e a folha dizia "2 pedidos · ✓ 2 rejeitados" sem
// dizer do outro (MEDIDO no navegador, n08 da rodada 11). DECISÃO: o pedido
// anotado fica FORA da série do autor, sem texto novo — o botão, a frase e o
// lote dizem o mesmo número. E, fora da série, o card da tela segue NA FRENTE:
// o foco no autor que passasse a série por cima dele separaria `currentPlace` de
// `queue[0]`, e o gesto seguinte tiraria da fila um pedido da série.
//
// Os testes RODAM o código de verdade, fatiado do app.js, com o CONTROLE sem a
// outra aba; vistos REPROVANDO com o conserto desfeito (relatório do lote 15).
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

const P = (i, autor = 700 + i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i, creatorId: autor, createdBy: 'autor' + autor });
const ids = (fila) => (fila || []).map((p) => p.updateRequestID);

// ═══ R11-2-06: o "Rejeitar os N" sem o pedido que a outra aba decidiu ══════════
// A folha do autor (o botão e a frase), o lote, o "Ver +N" e o foco no autor,
// com o card da FRENTE decidido na outra aba (anotado) e mais dois do autor.
function folhaDoAutor({ anotarFrente = true } = {}) {
  const X = 7777;
  const fila = [P(0, X), P(1, X), P(2, X), P(3), P(4)];
  const AppState = { authenticated: true, queue: fila.slice(), currentPlace: fila[0], stats: { rejected: 0 }, serverTotal: 5,
    hasMore: false, autorEmFoco: null };
  const decididos = new WeakSet(anotarFrente ? [fila[0]] : []);
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', checked: false, ouvintes: {},
      addEventListener(tipo, fn) { this.ouvintes[tipo] = fn; } });
    return els.get(id);
  };
  const document = { getElementById: (id) => (id === 'autorCorpo' || id === 'autorTitle'
    || el('autorCorpo').innerHTML.includes(`id="${id}"`) ? el(id) : null) };
  const log = { agendadas: [], rejeitar: [], focos: [] };
  const deps = {
    AppState, document, decididosPorOutraAbaComCardAqui: decididos, pedidosEmAndamento: new Set(),
    Treino: { ativo: false }, t: (k, v) => k + (v ? JSON.stringify(v) : ''), escapeHtml: (s) => String(s),
    contagemDoAutor: () => 6, semJanelaDeDesfazer: () => false, podeRecusarAutomaticoAqui: () => true, autoLigado: () => false,
    ICONE_OLHO: '', ICONE_X: '', ICONE_LIXO: '', ICONE_RAIO: '', openModal: () => {}, alternarAutoDoAutor: () => {},
    verPelaFolha: () => {}, esquecerPelaFolha: () => {},
    rejeitarPelaFolha: (ev, place, contados) => log.rejeitar.push(contados),
    acoesTravadas: () => false, avisoDaTrava: () => 'x', showToast: () => {}, updateStats: () => {}, saveStats: () => {},
    updatePendingCount: () => {}, removeCurrentCardEl: () => {},
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; }, maybePrefetch: () => {},
    startFetching: () => {}, showNoPlaces: () => {}, API: { getRegion: () => 'row' }, carimboDoGesto: () => null,
    scheduleAction: (tipo, places) => log.agendadas.push(places.map((p) => p.updateRequestID)), enviarLote: () => {},
    renderFocoAutor: () => {},
  };
  const nomes = ['chaveDoPedido', 'serieDoAutor', 'pedidosDoAutorNaFila', 'abrirFolhaDoAutor', 'rejeitarLoteDoAutor',
    'focarAutor', 'manterFocoNaFrente'];
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, 'let tratouNestaFila = false;\n' + nomes.map(fatiar).join('\n')
    + `\nreturn { ${nomes.join(', ')} };`)(...chaves.map((k) => deps[k]));
  return { app, AppState, fila, el, log, X };
}

test('R11-2-06: "Rejeitar os N" com o card da frente decidido na outra aba — o botão, a frase e o lote dizem o MESMO número', () => {
  const m = folhaDoAutor();
  m.app.abrirFolhaDoAutor(m.fila[0]);
  const corpo = m.el('autorCorpo').innerHTML;
  assert.ok(corpo.includes('autor.sheet.rejeitar{"n":2}'),
    `DEFEITO: o botão conta o pedido que a outra aba já decidiu ("Rejeitar os 3", e saem 2): ${corpo.match(/autor\.sheet\.rejeitar\{[^}]*\}/)}`);
  assert.ok(corpo.includes('autor.sheet.ver{"n":2}'), 'o "Ver os N" conta diferente do "Rejeitar os N"');
  assert.ok(corpo.includes('autor.sheet.sub{"n":6,"fila":2}'), `a frase da folha conta diferente do botão: ${corpo.match(/autor\.sheet\.sub[^<]*/)}`);
  // O toque entrega ao lote as chaves que a folha contou — sem a do anotado.
  m.el('autorRejeitar').ouvintes.click({});
  assert.deepEqual(m.log.rejeitar, [['v1|u1', 'v2|u2']], `a folha entregou ao lote: ${JSON.stringify(m.log.rejeitar)}`);
  m.app.rejeitarLoteDoAutor(m.fila[0], m.log.rejeitar[0]);
  assert.deepEqual(m.log.agendadas, [['u1', 'u2']], 'o lote mandou o que o botão não contou');
  assert.equal(m.AppState.stats.rejected, 2);
  // O anotado FICA como o card da tela: o gesto nele é descontado e diz por quê (R10-2-02).
  assert.deepEqual(ids(m.AppState.queue), ['u0', 'u3', 'u4']);
  assert.equal(m.AppState.currentPlace, m.fila[0]);
  // CONTROLE: sem a outra aba, os três (o instrumento distingue).
  const c = folhaDoAutor({ anotarFrente: false });
  c.app.abrirFolhaDoAutor(c.fila[0]);
  assert.ok(c.el('autorCorpo').innerHTML.includes('autor.sheet.rejeitar{"n":3}'), 'CONTROLE: a folha deixou de contar o card da frente');
  c.el('autorRejeitar').ouvintes.click({});
  c.app.rejeitarLoteDoAutor(c.fila[0], c.log.rejeitar[0]);
  assert.deepEqual(c.log.agendadas, [['u0', 'u1', 'u2']]);
});

test('R11-2-06: o "Ver +N" do card anotado segue contando os OUTROS do autor, e o foco no autor o mantém NA FRENTE', () => {
  const m = folhaDoAutor();
  assert.equal(m.app.pedidosDoAutorNaFila(m.fila[0]).filter((x) => x !== m.fila[0]).length, 2,
    'o "Ver +N" do card anotado mudou (ele conta os OUTROS pedidos do autor)');
  // O toque no "Ver +2" (ou o "Ver os 2" da folha): a série vem logo depois do card da tela.
  m.app.focarAutor(m.X);
  assert.equal(m.AppState.currentPlace, m.fila[0], 'DEFEITO: o foco no autor trocou o card da tela debaixo do dedo');
  assert.deepEqual(ids(m.AppState.queue), ['u0', 'u1', 'u2', 'u3', 'u4']);
  // Uma página que chega com o foco ligado reordena (`sortQueue` → `manterFocoNaFrente`):
  // `currentPlace` e `queue[0]` não podem se separar — o gesto seguinte tira o PRIMEIRO.
  m.AppState.queue.splice(0, m.AppState.queue.length, m.fila[0], m.fila[3], m.fila[1], m.fila[4], m.fila[2]);
  m.app.manterFocoNaFrente();
  assert.equal(m.AppState.queue[0], m.AppState.currentPlace,
    `DEFEITO: a série passou por cima do card da tela (${ids(m.AppState.queue)}) — o gesto seguinte tiraria da fila um pedido da série`);
  assert.deepEqual(ids(m.AppState.queue), ['u0', 'u1', 'u2', 'u3', 'u4']);
  // CONTROLE: sem a outra aba, o card da tela é da série e fica na frente por ela.
  const c = folhaDoAutor({ anotarFrente: false });
  c.app.focarAutor(c.X);
  assert.deepEqual(ids(c.AppState.queue), ['u0', 'u1', 'u2', 'u3', 'u4']);
});
