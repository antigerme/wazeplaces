// Patentes e Conquistas — as regras PURAS, sem browser.
//
// O que este arquivo trava, e por que cada coisa está aqui:
//
//  1. A ESCADA nas BORDAS. Um `>=` virando `>` move todo mundo um degrau e
//     ninguém percebe: a tela continua plausível.
//  2. O PORTÃO. `curador` e `corretor` não podem ser destravadas por quem não
//     passa no portão L6 — cadeado que nunca abre é beco sem saída, e destravar
//     o que a pessoa não pode fazer é pior ainda.
//  3. A ORDEM É FIXA e as de portão ficam no FIM. É a ordem que decide QUAL
//     anunciar quando duas caem juntas, e é o que faz esconder duas não deixar
//     buraco na grade.
//  4. A GEOGRAFIA. Estado chaveado por `pais:estado`, senão o mesmo número em
//     países diferentes vira um lugar só. E balde ANTIGO (sem `onde`) não pode
//     derrubar o render — é a migração `historico-onde`.
//  5. O DICIONÁRIO cobre cada id nas quatro línguas. Chave faltando não quebra
//     nada: aparece a chave crua na tela.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIGRACOES } from '../tools/migracoes.mjs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');

// Âncora em DECLARAÇÃO, nunca em distância (gotcha #67).
function fatiar(nome, tipo = 'function') {
  const marca = tipo === 'function' ? 'function ' + nome + '(' : 'const ' + nome + ' =';
  const ini = APP.indexOf(marca);
  assert.ok(ini >= 0, `${nome} sumiu do app.js`);
  const resto = APP.slice(ini + 1);
  const fim = resto.search(/\n(?:async function |function |const |let |\/\/ ──|\/\/ ═)/);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  return APP.slice(ini, ini + 1 + fim);
}
// UM escopo só: `patenteDe` lê `PATENTES`, `avaliarConquistas` lê `CONQUISTAS`
// e `maiorSequenciaDeDias` lê `diaISO`/`DIA_MS`. Fatiar cada uma isolada dava
// "is not defined" — e é o tipo de erro que some se o teste só checar o retorno.
const NOMES = [['PATENTES', 'const'], ['CONQUISTAS', 'const'], ['DIA_MS', 'const'],
               ['diaISO', 'const'], ['patenteDe', 'function'], ['avaliarConquistas', 'function'],
               ['maiorSequenciaDeDias', 'function'], ['geografiaDoHistorico', 'function']];
const EXPORTA = NOMES.map(([n]) => n).join(', ');
// eslint-disable-next-line no-new-func
const M = new Function(NOMES.map(([n, t]) => fatiar(n, t)).join('\n') + `\nreturn { ${EXPORTA} };`)();
const { PATENTES, CONQUISTAS, patenteDe, avaliarConquistas,
        maiorSequenciaDeDias, geografiaDoHistorico } = M;

// ── 1. A ESCADA ────────────────────────────────────────────────────────────
test('a escada sobe, começa em 0 e tem seis degraus com nome único', () => {
  assert.equal(PATENTES.length, 6, 'a escada mudou de tamanho — revisite o dicionário junto');
  assert.equal(PATENTES[0].min, 0, 'o primeiro degrau precisa aceitar quem nunca tratou nada');
  const ids = PATENTES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'id de patente repetido');
  for (let i = 1; i < PATENTES.length; i++) {
    assert.ok(PATENTES[i].min > PATENTES[i - 1].min,
      `o degrau ${i} (${PATENTES[i].id}) não é maior que o anterior — a barra andaria pra trás`);
  }
  // "Síndico" saiu: não existe nas outras três línguas sem virar frase.
  assert.ok(!ids.includes('sindico'), 'o degrau "sindico" voltou — ele não traduz (ver CLAUDE.md)');
});

test('patenteDe acerta as BORDAS — é onde um >= virando > move todo mundo', () => {
  for (let i = 0; i < PATENTES.length; i++) {
    const min = PATENTES[i].min;
    assert.equal(patenteDe(min), i, `${min} tratados deveria ser exatamente o degrau ${i}`);
    if (i > 0) {
      assert.equal(patenteDe(min - 1), i - 1, `${min - 1} deveria ficar no degrau de baixo`);
    }
  }
  assert.equal(patenteDe(0), 0);
  assert.equal(patenteDe(PATENTES[PATENTES.length - 1].min + 99999), PATENTES.length - 1,
    'acima do topo continua no topo');
  // CONTROLE: entrada que não é número não pode saltar a escada.
  for (const lixo of [undefined, null, NaN, -5, 'muitos']) {
    assert.equal(patenteDe(lixo), 0, `${String(lixo)} deveria cair no primeiro degrau`);
  }
});

// ── 2 e 3. A LISTA, A ORDEM E O PORTÃO ─────────────────────────────────────
test('as de portão ficam no FIM, pra esconder não deixar buraco', () => {
  const comPortao = CONQUISTAS.map((c, i) => (c.l6 ? i : -1)).filter((i) => i >= 0);
  assert.ok(comPortao.length > 0, 'sumiram as conquistas de portão');
  const esperado = CONQUISTAS.length - comPortao.length;
  assert.deepEqual(comPortao, comPortao.map((_, k) => esperado + k),
    'conquista de portão no MEIO da lista: escondê-la deixa buraco na grade');
});

test('o portão não destrava o que ele guarda — nos dois sentidos', () => {
  const cheio = { fotos: 99, nomes: 99 };
  const semPortao = avaliarConquistas(Object.assign({ gateL6: false }, cheio), {});
  assert.ok(!semPortao.includes('curador') && !semPortao.includes('corretor'),
    'destravou conquista de L6 pra quem não passa no portão');
  // CONTROLE: com o portão, as MESMAS entradas destravam. Sem isto, "nenhuma
  // destravou" passaria também se a avaliação estivesse quebrada inteira.
  const comPortao = avaliarConquistas(Object.assign({ gateL6: true }, cheio), {});
  assert.ok(comPortao.includes('curador') && comPortao.includes('corretor'),
    'com o portão elas deveriam destravar — a avaliação está quebrada, não o portão');
});

test('cada conquista tem a SUA condição, e ela é o limiar exato', () => {
  const casos = [
    ['primeiraFaxina', { tratados: 10 }, { tratados: 9 }],
    ['centuriao',      { hoje: 100 },    { hoje: 99 }],
    ['maoFirme',       { seq: 100 },     { seq: 99 }],
    ['colecionador',   { guardados: 10 }, { guardados: 9 }],
    ['andarilho',      { estados: 3 },   { estados: 2 }],
    ['viajante',       { paises: 2 },    { paises: 1 }],
    ['poliglota',      { idiomas: 2 },   { idiomas: 1 }],
    ['semanaCheia',    { diasSeguidos: 7 }, { diasSeguidos: 6 }],
    ['curador',        { fotos: 10, gateL6: true }, { fotos: 9, gateL6: true }],
    ['corretor',       { nomes: 5, gateL6: true },  { nomes: 4, gateL6: true }],
    ['detetive',       { duplicado: true },   {}],
    ['elefante',       { reincidente: true }, {}],
    ['tudoLimpo',      { filaZerada: true },  {}],
    ['coruja',         { madrugada: true },   {}],
    ['segundaChance',  { desfez: true },      {}],
    ['primeiroResumo', { resumo: true },      {}],
  ];
  assert.equal(casos.length, CONQUISTAS.length,
    'conquista nova sem caso aqui — o limiar dela nunca seria testado');
  for (const [id, bate, naoBate] of casos) {
    assert.ok(avaliarConquistas(bate, {}).includes(id), `${id}: a condição não destravou no limiar`);
    assert.ok(!avaliarConquistas(naoBate, {}).includes(id), `${id}: destravou ABAIXO do limiar`);
  }
});

test('o que já foi ganho não volta a ser anunciado', () => {
  const ctx = { tratados: 99999, hoje: 999, seq: 999, guardados: 99, estados: 9, paises: 9,
                idiomas: 9, diasSeguidos: 99, duplicado: true, reincidente: true,
                filaZerada: true, madrugada: true, desfez: true, resumo: true };
  const todas = avaliarConquistas(ctx, {});
  assert.ok(todas.length > 5, 'controle: com tudo satisfeito, várias deveriam destravar');
  const jaTem = Object.fromEntries(todas.map((id) => [id, '2026-01-01']));
  assert.deepEqual(avaliarConquistas(ctx, jaTem), [],
    'reanunciou conquista já ganha — o banner sairia a cada swipe');
});

test('a ordem do anúncio é a ORDEM DA LISTA, não a da avaliação', () => {
  const ctx = { tratados: 10, duplicado: true };
  const r = avaliarConquistas(ctx, {});
  const pos = r.map((id) => CONQUISTAS.findIndex((c) => c.id === id));
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b),
    'a ordem saiu embaralhada — qual conquista ganha o banner viraria sorteio');
});

// ── 4. A GEOGRAFIA ─────────────────────────────────────────────────────────
test('estado é chaveado por país:estado — o mesmo número existe em dois países', () => {
  const h = { '2026-09-01': { read: 1, rejected: 0, onde: { '30:5': 1 } },
              '2026-09-02': { read: 1, rejected: 0, onde: { '73:5': 1 } } };
  const g = geografiaDoHistorico(h);
  assert.equal(g.paises.size, 2, 'não separou os dois países');
  assert.equal(g.estados.size, 2,
    'juntou dois estados diferentes num só: o id 5 existe no Brasil E na França');
});

test('país SEM estado conta país e não conta estado', () => {
  const g = geografiaDoHistorico({ '2026-09-01': { read: 1, rejected: 0, onde: { 30: 1 } } });
  assert.equal(g.paises.size, 1);
  assert.equal(g.estados.size, 0, 'inventou um estado a partir de um filtro de país inteiro');
});

test('MIGRACAO historico-onde: balde antigo não derruba nada', () => {
  // Balde gravado antes de v2026.09.14-01 não tem `onde`.
  const h = { '2026-08-01': { read: 3, rejected: 2 },
              '2026-09-14': { read: 1, rejected: 0, onde: { '30:5': 1 } },
              _total: { read: 4, rejected: 2 } };
  const g = geografiaDoHistorico(h);
  assert.equal(g.paises.size, 1, 'o balde antigo não pode contribuir nem atrapalhar');
  assert.equal(g.estados.size, 1);
  // E o registro tem que EXISTIR, com a família certa: é isso que faz alguém
  // revisitar o `|| {}` em vez de ele virar código eterno.
  const m = MIGRACOES.find((x) => x.id === 'historico-onde');
  assert.ok(m, 'a migração historico-onde saiu do registro mas o código ainda tolera balde sem `onde`');
  assert.equal(m.familia, 'aparelho', 'é migração de localStorage: a família decide o prazo');
});

// ── a sequência de dias ────────────────────────────────────────────────────
test('maiorSequenciaDeDias conta a MAIOR corrida, e um buraco a quebra', () => {
  const dias = (...ds) => Object.fromEntries(ds.map((d) => [d, { read: 1, rejected: 0 }]));
  assert.equal(maiorSequenciaDeDias({}), 0);
  assert.equal(maiorSequenciaDeDias(dias('2026-09-01')), 1);
  assert.equal(maiorSequenciaDeDias(dias('2026-09-01', '2026-09-02', '2026-09-03')), 3);
  // buraco no dia 3: duas corridas de 2, não uma de 4
  assert.equal(maiorSequenciaDeDias(dias('2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05')), 2,
    'atravessou um dia sem trabalho — a "Semana cheia" sairia sem a semana');
  // atravessa a virada do mês
  assert.equal(maiorSequenciaDeDias(dias('2026-08-30', '2026-08-31', '2026-09-01')), 3,
    'a corrida quebrou na virada do mês');
  // dia zerado não conta, e o `_total` não é um dia
  assert.equal(maiorSequenciaDeDias({ '2026-09-01': { read: 0, rejected: 0 },
                                      '2026-09-02': { read: 1, rejected: 0 },
                                      _total: { read: 1, rejected: 0 } }), 1,
    'contou um dia sem trabalho, ou tratou o acumulador como se fosse um dia');
});

// ── 5. O DICIONÁRIO ────────────────────────────────────────────────────────
test('cada patente e cada conquista tem texto nas QUATRO línguas', () => {
  const linguas = ['pt', 'en', 'es', 'fr'];
  let achados = 0;
  for (const l of linguas) {
    const ini = I18N.indexOf(`\n  ${l}: {`);
    assert.ok(ini > 0, `o dicionário ${l} sumiu`);
    const fim = I18N.indexOf('\n  },', ini);
    assert.ok(fim > ini, `não consegui delimitar o dicionário ${l}`);
    achados++;
    const bloco = I18N.slice(ini, fim);
    for (const p of PATENTES) {
      assert.ok(bloco.includes(`'conq.rank.${p.id}'`), `${l}: falta conq.rank.${p.id}`);
    }
    for (const c of CONQUISTAS) {
      assert.ok(bloco.includes(`'conq.${c.id}.nome'`), `${l}: falta conq.${c.id}.nome`);
      assert.ok(bloco.includes(`'conq.${c.id}.como'`), `${l}: falta conq.${c.id}.como`);
    }
  }
  assert.equal(achados, 4, 'controle: o arquivo deixou de ter os quatro blocos');
});

// ── o que o desenho PROMETE, e o código tem que continuar cumprindo ────────
test('nenhuma conquista mostra progresso — "3 de 10" é o mecanismo de pressão', () => {
  const html = fatiar('htmlConquistas');
  assert.ok(!/\{\s*a:\s*[a-z]+\s*,\s*b:\s*[a-z]+\s*\}[\s\S]{0,80}data-conq/.test(html),
    'entrou contador de progresso dentro da célula');
  // A célula carrega EMOJI e NOME, e nada mais: a condição mora fora dela,
  // porque na largura da grade ela parte palavra (medido).
  const cel = html.slice(html.indexOf('data-conq'), html.indexOf('</button>'));
  assert.ok(!cel.includes('.como'), 'a condição voltou pra dentro da célula');
});

test('sem sequência viva: nada conta "dias seguidos AGORA"', () => {
  const chk = fatiar('checarConquistas');
  assert.ok(!/sequenciaAtual|streak|diasSeguidosAgora/i.test(chk),
    'apareceu contador de sequência viva — é pressão, não celebração (ver CLAUDE.md)');
  // "Semana cheia" é a MAIOR corrida da história, não a corrente: uma vez
  // ganha, ela não pode ser perdida.
  assert.match(chk, /diasSeguidos:\s*maiorSequenciaDeDias\(h\)/,
    'a "Semana cheia" deixou de sair da maior corrida histórica');
});
