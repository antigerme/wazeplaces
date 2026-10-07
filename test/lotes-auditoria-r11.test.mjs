// O "Marcar todos" e o dia em que ele conta (auditoria de 2026-10-07, rodada
// 11 — o lote 15 da fila):
//
//  · R11-7-06 — o lote tocado às 23:59 que pousava depois da meia-noite
//    somava no balde do dia do gesto e julgava o "Centurião" pelo balde de
//    hoje: com 120 no balde do gesto, a conquista não saía.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" que aceita qualquer chamada (o `montar` de
// test/lotes-auditoria-r10). Cada teste foi visto REPROVANDO com o conserto
// desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const MIN = ler('js/min/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Pula a ASSINATURA antes de casar chaves (um `{}` de parâmetro padrão abriria e
// fecharia na hora).
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', i); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) {
      const corpo = APP_SEM.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// Um "buraco negro": aceita qualquer propriedade e qualquer chamada.
function buracoNegro(nome, chamou) {
  const f = function () {};
  return new Proxy(f, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then' || typeof k !== 'string') return undefined;
      return buracoNegro(nome + '.' + k, chamou);
    },
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}

// `nomes`: as funções do app.js a rodar. `deps`: o que elas enxergam — funções
// e as variáveis de módulo, que elas leem e escrevem direto no objeto. O resto é
// buraco negro.
function montar(nomes, deps) {
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      return buracoNegro(k, chamou);
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map(fatiar).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}

const tique = (ms = 2) => new Promise((ok) => setTimeout(ok, ms));
// Espera por CONDIÇÃO, com teto de tempo real — nunca por prazo fixo.
async function ateQue(cond, rotulo, tetoMs = 5000) {
  const fim = performance.now() + tetoMs;
  while (!cond()) {
    if (performance.now() > fim) assert.fail(`${rotulo}: não aconteceu em ${tetoMs / 1000} s`);
    await tique(2);
  }
}

const lsFalso = () => {
  const guardado = new Map();
  return {
    guardado,
    localStorage: {
      getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
      setItem: (k, v) => guardado.set(k, String(v)),
      removeItem: (k) => guardado.delete(k),
    },
  };
};
const chave = (p) => (p && p.venueID != null && p.updateRequestID != null ? p.venueID + '|' + p.updateRequestID : null);
const GESTO = { dia: '2026-10-07', onde: '30', t: 1, lang: 'pt' };
const OK = { success: true };
const JA_TRATADO = { success: false, errorCategory: 'already_processed', httpCode: 500 };
const lido = (i, extra = {}) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 900, ...extra });

// ═══ R11-7-06 · o "Centurião" do lote é o balde do DIA do gesto ═══════════════
// O roteiro do auditor (c04, relógio do Playwright): 90 no dia, "Marcar todos" de
// 30 tocado às 23:59:4x, a resposta solta às 00:00:05 — o balde `2026-10-07`
// fica com 120 e `centuriao: false`. O ✓ de um card no mesmo instante dava (a
// `registrarAcaoConfirmada` já julga pelo balde do `gesto.dia`, H11).
function montarConfirmacao({ agora, historico }) {
  const ctxs = [];
  const DataFalsa = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(agora); }
    static now() { return agora; }
  };
  const deps = {
    Treino: { ativo: false }, carregarConquistas: () => ({ seq: 0 }), salvarConquistas() {},
    registrarIdiomaUsado() {}, getLang: () => 'pt', contagemDoAutor: () => 0,
    checarConquistas: (x) => ctxs.push(x || {}), filaZeradaConfirmada: () => false, checkUndoGateUnlock() {},
    loadHistory: () => historico, Date: DataFalsa, CONQUISTAS: constante('CONQUISTAS'),
  };
  const h = montar(['registrarLoteConfirmado', 'registrarAcaoConfirmada', 'avaliarConquistas'], deps);
  // CONTROLE do instrumento: a régua de VERDADE distingue 99 de 100 (sem a lista
  // de verdade, um buraco negro "incluiria" qualquer coisa).
  assert.deepEqual(h.avaliarConquistas({ hoje: 99 }, {}).includes('centuriao'), false, 'CONTROLE: o "Centurião" saiu com 99');
  assert.deepEqual(h.avaliarConquistas({ hoje: 100 }, {}).includes('centuriao'), true, 'CONTROLE: o "Centurião" não saiu com 100');
  return { h, ctxs };
}

test('R11-7-06: o "Marcar todos" que POUSA depois da meia-noite julga o "Centurião" pelo balde do DIA do gesto', () => {
  const gesto = { t: new Date(2026, 9, 7, 23, 59, 45).getTime(), dia: '2026-10-07', onde: '30', lang: 'pt' };
  const m = montarConfirmacao({ agora: new Date(2026, 9, 8, 0, 0, 5).getTime(),
    historico: { '2026-10-07': { read: 120, rejected: 0 }, '2026-10-08': { read: 0, rejected: 0 } } });
  m.h.registrarLoteConfirmado(30, gesto);
  const ctx = m.ctxs.at(-1);
  assert.equal(ctx.hoje, 120,
    `DEFEITO: o lote julgou o "Centurião" pelo balde de ${ctx.hoje === undefined ? 'HOJE (o dia novo)' : ctx.hoje}, não o do dia do gesto`);
  assert.ok(m.h.avaliarConquistas(ctx, {}).includes('centuriao'), 'com 120 no dia do gesto, o "Centurião" não sairia');
  // A MESMA régua do ✓ do card (H11): o mesmo trabalho, o mesmo julgamento.
  m.h.registrarAcaoConfirmada('read', {}, gesto);
  assert.equal(m.ctxs.at(-1).hoje, ctx.hoje, 'o ✓ do card e o lote julgam o "Centurião" do mesmo gesto por baldes diferentes');
});

test('R11-7-06: CONTROLE — sem o dia do gesto, o lote deixa o balde de hoje com o `checarConquistas`, como sempre', () => {
  const m = montarConfirmacao({ agora: new Date(2026, 9, 8, 10, 0).getTime(),
    historico: { '2026-10-07': { read: 120, rejected: 0 } } });
  m.h.registrarLoteConfirmado(12);
  assert.equal('hoje' in m.ctxs.at(-1), false, 'sem gesto, o lote inventou um balde');
  m.h.registrarLoteConfirmado(12, { t: Date.now(), dia: null });
  assert.equal('hoje' in m.ctxs.at(-1), false, 'gesto sem dia (o carimbo neutro) inventou um balde');
});

// Os testes de cima fatiam o FONTE; o app carrega o `js/min/` (gotcha #22).
test('o bundle GERADO tem os consertos (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  for (const re of [/loadHistory\(\)\[/g]) {
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${re} — falta \`npm run js\``);
  }
});
