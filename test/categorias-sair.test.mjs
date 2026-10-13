// R16-6-04: as categorias que o seletor dos Filtros oferece (`AppState.seenCategories`)
// só cresciam. Depois do "Sair" — ou da troca de conta na mesma página — quem entrava
// via, no seletor, as categorias da fila de quem saiu (códigos de categoria, não dado
// pessoal, mas o contrato do "Sair" é limpar de tudo). O `resetQueue` NÃO as zera de
// propósito (decisão de produto: trocar de filtro ou de país não esvazia o seletor).
//
// O harness roda `handleLogout` e `esquecerOutraConta` DE VERDADE, fatiados do app.js;
// o que o teste não fornece vira um buraco negro que aceita qualquer chamada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

function fatiarDe(fonte, nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
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

function buracoNegro(nome, chamou) {
  return new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then' || typeof k !== 'string') return undefined;
      return buracoNegro(nome + '.' + k, chamou);
    },
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
      if (typeof k !== 'string') return undefined;
      return buracoNegro(k, chamou);
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map((n) => fatiarDe(APP_SEM, n)).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}

const lsVazio = { get: () => null, set: () => {}, remove: () => {} };
// A fila de quem estava na tela (GAS_STATION e PARK) e as categorias que ela já mostrou.
const seen = () => ['GAS_STATION', 'PARK'];

function sair(opcoes) {
  const AppState = { stats: {}, preferences: {}, filters: {}, pendingAction: null, queue: [], seenCategories: seen(), authenticated: true, profile: { id: 1 } };
  const deps = { AppState, safeLS: lsVazio, epocaDaSessao: 0, pareamentosEmitidos: new Set(), tokenTiradoPorOutraAba: null,
    preferenciasDeFabrica: () => ({}), filtrosDeFabrica: () => ({}) };
  const h = montar(['handleLogout', 'sessaoDestaAbaEhAGuardada'], deps);
  return h.handleLogout(opcoes).then(() => AppState);
}

test('R16-6-04: o "Sair" esvazia as categorias vistas — em todos os caminhos (normal, outra aba, recusa do portão, tela de entrada)', async () => {
  for (const [nome, opcoes] of [['normal', {}], ['outra aba', { porOutraAba: true }], ['outra conta', { porOutraAba: true, outraConta: true }],
    ['recusa do portão', { recusado: true }], ['tela de entrada', { porOutraAba: true, naEntrada: true }]]) {
    const AppState = await sair(opcoes);
    assert.deepEqual(AppState.seenCategories, [], `DEFEITO (${nome}): as categorias da conta que saiu seguiram no seletor dos Filtros`);
  }
});

function trocarDeConta({ refazer = false, queue = [], soMemoria = false } = {}) {
  const AppState = { stats: {}, preferences: {}, filters: {}, pendingAction: null, queue, fetching: false, seenCategories: seen() };
  const deps = { AppState, safeLS: lsVazio, filaAtravessouSessao: refazer, epocaDaSessao: 0,
    // a fila "real" é a da tela, fora do treino; a recontagem usa o `trackSeenCategories` de verdade
    filaReal: () => AppState.queue, i18nLocale: () => 'pt-BR' };
  const h = montar(['esquecerOutraConta', 'trackSeenCategories'], deps);
  h.esquecerOutraConta('222', { soMemoria });
  return AppState;
}

test('R16-6-04: a troca de conta tira as categorias da anterior — e reconta as da fila que fica, que é de quem entrou', () => {
  // A fila vai ser refeita (atravessou a sessão): a busca nova traz as dela; o seletor começa limpo.
  assert.deepEqual(trocarDeConta({ refazer: true, queue: [{ categories: ['GAS_STATION'] }] }).seenCategories, [],
    'DEFEITO: as categorias da conta anterior seguiram no seletor dos Filtros de quem entrou');
  // CONTROLE: a fila que fica nasceu da sessão de quem entrou — as categorias DELA continuam no seletor (e só elas).
  assert.deepEqual(trocarDeConta({ queue: [{ categories: ['BAKERY'] }, { categories: ['BAKERY', 'ZOO'] }] }).seenCategories, ['BAKERY', 'ZOO'],
    'a troca esvaziou também as categorias da fila de quem entrou');
  // Troca só da memória (a outra aba já mexeu no aparelho): mesma regra.
  assert.deepEqual(trocarDeConta({ refazer: true, soMemoria: true }).seenCategories, []);
});

test('R16-6-04: o resetQueue NÃO esvazia as categorias (decisão de produto: trocar filtro ou país não esvazia o seletor)', () => {
  const corpo = fatiarDe(APP_SEM, 'resetQueue');
  assert.doesNotMatch(corpo, /seenCategories/, 'o resetQueue passou a mexer nas categorias vistas');
});
