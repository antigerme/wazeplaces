// A FILA REAL com o treino aberto, de novo (auditoria da rodada 10, 2026-10-07).
//
// O treino troca a fila da tela pela de EXEMPLOS e guarda a real
// (`Treino._salvo`) até o `sair()`. O lote 13 firmou a regra "nada que refaça a
// fila SEM gesto da pessoa encerra o treino por baixo dela" (R9-7-04); a rodada
// 10 achou o que ainda escapava, cada um MEDIDO no navegador pelos auditores com
// o controle sem o treino:
//   R10-7-02 — o aviso do país anotado no treino se perdia quando ele terminava
//              pelo ↻ (o "Aplicar" está em test/filtros-aplicar.test.mjs, com a
//              página dos Filtros de lá);
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

