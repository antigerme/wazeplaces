// Reincidência de autor: a contagem, os dois tetos e a poda.
//
// O módulo mora no js/app.js (script de browser, não módulo), então o teste
// FATIA a fonte e a executa num escopo de mentira — mesmo padrão do
// test/qr.test.mjs. Fatiar em vez de reimplementar é o que garante que o teste
// exercite o código que roda no aparelho, e não uma cópia que envelhece.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

// ── o corte ──────────────────────────────────────────────────────────────
const INICIO = "const AUTORES_KEY = 'waze_places_autores';";
const FIM = 'function renderAutores() {';
assert.ok(fonte.includes(INICIO), 'o módulo de autores sumiu do app.js');
assert.ok(fonte.includes(FIM), 'renderAutores sumiu — o corte do teste precisa ser revisto');
const trecho = fonte.slice(fonte.indexOf(INICIO), fonte.indexOf(FIM));

function montar(agoraMs = Date.UTC(2026, 7, 24, 12)) {
  const guardado = new Map();
  const escopo = {
    AppState: { autores: null },
    localStorage: {
      getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
      setItem: (k, v) => guardado.set(k, String(v)),
      removeItem: (k) => guardado.delete(k),
    },
    safeLS: { remove: (k) => guardado.delete(k) },
    renderHistory: () => {},
    Date: { now: () => agoraMs, UTC: Date.UTC },
  };
  const nomes = Object.keys(escopo);
  const corpo = trecho + '\nreturn { registrarRejeicaoDeAutor, contagemDoAutor, listaDeAutores,'
    + ' esquecerAutor, esquecerAutores, loadAutores, podarAutores, AUTORES_KEY,'
    + ' AUTORES_MAX_REINCIDENTES, AUTORES_MAX_VISTOS, AUTORES_MAX_DIAS, AUTOR_LIMIAR_DESTAQUE };';
  const api = new Function(...nomes, corpo)(...nomes.map((n) => escopo[n]));
  return { ...api, guardado, escopo, dia: Math.floor(agoraMs / 86400000) };
}

const place = (id, nome) => ({ creatorId: id, createdBy: nome });

test('autores: a PRIMEIRA rejeição não vira contagem — vai pro anel', () => {
  const m = montar();
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  assert.equal(m.contagemDoAutor(place(111, 'world_abc')), 0,
    'uma rejeição não é reincidência, e contá-la chamaria de spammer quem errou uma vez');
  assert.deepEqual(m.listaDeAutores(), [], 'ninguém deveria aparecer na lista ainda');
  const guardado = JSON.parse(m.guardado.get(m.AUTORES_KEY));
  assert.deepEqual(guardado.v, ['111'], 'o id deveria estar no anel dos vistos-uma-vez');
});

test('autores: a SEGUNDA promove, e daí a contagem sobe de uma em uma', () => {
  const m = montar();
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  assert.equal(m.contagemDoAutor(place(111, 'world_abc')), 2);
  const guardado = JSON.parse(m.guardado.get(m.AUTORES_KEY));
  assert.deepEqual(guardado.v, [], 'ao ser promovido, o id sai do anel — senão conta duas vezes');
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  assert.equal(m.contagemDoAutor(place(111, 'world_abc')), 3);
});

test('autores: a chave é o ID, então trocar de nome NÃO perde o histórico', () => {
  // 69% dos autores da fila real são `world_xxxxx` — nome gerado, que muda no
  // dia em que a pessoa escolhe um. Pelo nome, a contagem zeraria justo aí.
  const m = montar();
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  m.registrarRejeicaoDeAutor(place(111, 'world_abc'));
  m.registrarRejeicaoDeAutor(place(111, 'ze_das_couves'));   // escolheu um nome
  assert.equal(m.contagemDoAutor(place(111, 'ze_das_couves')), 3, 'a contagem seguiu o id');
  assert.equal(m.listaDeAutores()[0].nome, 'ze_das_couves', 'a lista mostra o nome NOVO');
});

test('autores: pedido sem autor não registra nada', () => {
  // 11% dos pedidos do tipo VENUE chegam sem `createdBy` — medido na fila real.
  const m = montar();
  for (const p of [place(null, null), place(undefined, 'x'), place('', 'y'), {}]) {
    m.registrarRejeicaoDeAutor(p);
  }
  assert.deepEqual(m.listaDeAutores(), []);
  const cru = m.guardado.get(m.AUTORES_KEY);
  assert.ok(cru === undefined || JSON.parse(cru).v.length === 0,
    'pedido sem autor não pode ocupar espaço no anel');
});

test('autores: a poda tira quem parou há mais de AUTORES_MAX_DIAS', () => {
  const m = montar();
  const a = m.loadAutores();
  a.r['111'] = [9, 'antigo', m.dia - m.AUTORES_MAX_DIAS - 1];
  a.r['222'] = [2, 'recente', m.dia];
  assert.equal(m.podarAutores(a), true, 'a poda deveria ter mexido');
  assert.deepEqual(Object.keys(a.r), ['222'], 'o antigo deveria ter saído, o recente ficado');
});

test('autores: no teto, sai quem tem a rejeição mais ANTIGA (não a menor contagem)', () => {
  const m = montar();
  const a = m.loadAutores();
  // contagem ALTA e parada informa menos que contagem 2 de hoje.
  a.r['velho'] = [99, 'velho', m.dia - 5];
  for (let i = 0; i < m.AUTORES_MAX_REINCIDENTES; i++) a.r['n' + i] = [2, 'n' + i, m.dia];
  m.podarAutores(a);
  assert.equal(Object.keys(a.r).length, m.AUTORES_MAX_REINCIDENTES, 'o teto não segurou');
  assert.ok(!a.r['velho'], 'devia sair o mais antigo, mesmo com a maior contagem');
});

test('autores: o anel também tem teto, e descarta o mais antigo', () => {
  const m = montar();
  for (let i = 0; i < m.AUTORES_MAX_VISTOS + 10; i++) m.registrarRejeicaoDeAutor(place(i, 'a' + i));
  const guardado = JSON.parse(m.guardado.get(m.AUTORES_KEY));
  assert.equal(guardado.v.length, m.AUTORES_MAX_VISTOS, 'o anel passou do teto');
  assert.equal(guardado.v[0], '10', 'os 10 primeiros deveriam ter saído pela frente');
});

test('autores: o logout apaga a lista inteira', () => {
  const m = montar();
  m.registrarRejeicaoDeAutor(place(111, 'a'));
  m.registrarRejeicaoDeAutor(place(111, 'a'));
  m.esquecerAutores();
  assert.equal(m.guardado.get(m.AUTORES_KEY), undefined, 'a chave sobreviveu ao logout');
  assert.equal(m.escopo.AppState.autores, null, 'o cache em memória sobreviveu ao logout');
});

test('autores: esquecer um autor tira só ele', () => {
  const m = montar();
  for (const id of [111, 222]) { m.registrarRejeicaoDeAutor(place(id, 'a' + id)); m.registrarRejeicaoDeAutor(place(id, 'a' + id)); }
  m.esquecerAutor('111');
  assert.deepEqual(m.listaDeAutores().map((x) => x.id), ['222']);
});

test('autores: armazenamento corrompido não derruba a app', () => {
  const m = montar();
  m.guardado.set(m.AUTORES_KEY, '{"v":"não é array","r":42}');
  m.escopo.AppState.autores = null;
  assert.doesNotThrow(() => m.registrarRejeicaoDeAutor(place(111, 'a')));
  assert.equal(m.contagemDoAutor(place(111, 'a')), 0);
});

// ── guardas ESTÁTICAS: o que o corte acima não alcança ───────────────────
test('autores: só REJEIÇÃO conta — marcar como lido não', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function handleActionResult');
  assert.ok(i > 0, 'handleActionResult sumiu');
  const bloco = semComentarios.slice(i, i + 900);
  assert.match(bloco, /actionType === 'reject'\s*\)\s*registrarRejeicaoDeAutor/,
    'a chamada precisa estar atrás de uma comparação estrita com reject:\n'
    + 'contar "lido" transformaria quem manda muita coisa BOA em reincidente');
});

test('autores: o selo só aparece a partir de 2, e o destaque só no limiar', () => {
  const semComentarios = fonte.replace(/\/\/[^\n]*/g, '');
  const i = semComentarios.indexOf('function renderSelosDeProcedencia');
  const bloco = semComentarios.slice(i, semComentarios.indexOf('function ', i + 10));
  assert.match(bloco, /reincidente >= 2/, 'o piso de 2 saiu do selo');
  assert.match(bloco, /reincidente >= AUTOR_LIMIAR_DESTAQUE \? 'selo-reinc' : 'selo-src'/,
    'o rosa precisa ficar atrás do limiar — abaixo dele a app CONTA, não acusa');
});

test('autores: o core manda o id numérico junto com o nome', () => {
  const core = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');
  const i = core.indexOf('createdBy: creatorName,');
  assert.ok(i > 0, 'o campo createdBy sumiu do core');
  assert.match(core.slice(i, i + 700), /\n\s*creatorId,/,
    'sem o creatorId a contagem cai de volta no nome, que muda sozinho');
});
