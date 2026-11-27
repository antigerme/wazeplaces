// A demo no APP (criar e guardar a chave do palco). O palco é a página /palco; aqui só o que o app faz.
// Cada regra foi vista REPROVANDO com a sabotagem (gotcha #28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cotaDaDemo, DEMO_VOTOS_JANELA_S, DEMO_TTL_S } from '../server/demo.mjs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const CORE = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
const semComentario = (txt) => txt.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const SEM = semComentario(APP);

function fatiar(nome, fonte = SEM) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    if (fonte[j] === '{') prof++;
    else if (fonte[j] === '}' && --prof === 0) return fonte.slice(m.index, j + 1);
  }
  throw new Error('não fechou: ' + nome);
}
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// ── paridade com o servidor ─────────────────────────────────────────────────
test('paridade: o teto de pedidos, a janela de entrada e a vida da demo são os do servidor', () => {
  const minRank = Number(/^const MIN_RANK_WAZE = (\d+);/m.exec(CORE)[1]);
  assert.equal(constante('DEMO_PEDIDOS_MAX'), cotaDaDemo(minRank), 'a frase «até N pedidos» mente se o servidor mudar a cota');
  assert.equal(constante('DEMO_JANELA_H') * 3600, DEMO_VOTOS_JANELA_S);
  assert.equal(constante('DEMO_TTL_H') * 3600, DEMO_TTL_S);
});

test('os tempos do diálogo são os que o servidor aceita, e o diálogo só oferece os dois modos', () => {
  const tempos = [...HTML.matchAll(/name="demoTempo" value="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(tempos, [0, 10000, 20000, 30000]);
  const modos = [...HTML.matchAll(/name="demoModo" value="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(modos, ['sinc', 'livre']);
  const srv = /const DEMO_TEMPOS_MS = ([^;]+);|DEMO_TEMPOS_MS\s*=\s*TEMPOS_MS|TEMPOS_MS/.test(CORE);
  assert.ok(srv, 'o core deixou de importar a lista de tempos');
});

// ── os filtros da demo são os da BUSCA ──────────────────────────────────────
test('filtrosDaDemo escreve a MESMA conta que o fetchNextPage (linha a linha, sem comentário)', () => {
  const limpa = (f) => f.split('\n').map((l) => l.replace(/\s+\/\/ .*$/, '').trim()).filter(Boolean);
  const demo = limpa(fatiar('filtrosDaDemo'));
  const busca = limpa(fatiar('fetchNextPage'));
  const ini = busca.findIndex((l) => l === 'const filters = {');
  const fim = busca.findIndex((l) => l === "if (orderBy !== 'SORTING_UPDATE_TIME_DESC') filters.orderBy = orderBy;");
  assert.ok(ini > 0 && fim > ini, 'o bloco dos filtros sumiu do fetchNextPage');
  const dela = busca.slice(ini, fim + 1);
  const minha = demo.slice(demo.indexOf('const filters = {'), demo.indexOf("if (orderBy !== 'SORTING_UPDATE_TIME_DESC') filters.orderBy = orderBy;") + 1);
  assert.deepEqual(minha, dela, 'a demo monta os filtros de um jeito e a busca de outro');
});

test('resumo do diálogo: «Residenciais» só aparece quando está ligado, com os nomes do painel de Filtros', () => {
  const dic = { 'demo.criar.naoLidos': 'NL', 'demo.criar.lidosTambem': 'LT', 'demo.criar.tiposN': 'T{n}', 'demo.criar.tiposTodos': 'TT',
    'filters.residential.only': 'SÓ', 'filters.residential.exclude': 'SEM', 'demo.criar.minhaArea': 'MA', 'demo.criar.paisId': 'P{id}' };
  const resumo = (residential) => new Function('AppState', 'API', 'TYPES_ALL', 't', fatiar('resumoDosFiltrosDaDemo') + '\nreturn resumoDosFiltrosDaDemo();')(
    { filters: { types: [], residential, unreadOnly: true, myArea: false }, countries: [{ id: 30, name: 'Brazil' }] },
    { getCountry: () => 30 }, ['a', 'b', 'c'], (k, v = {}) => (dic[k] || k).replace(/\{(\w+)\}/g, (_, x) => v[x]));
  assert.equal(resumo(''), 'Brazil · NL · TT', '«Indiferente» não vira texto');
  assert.equal(resumo('true'), 'Brazil · NL · TT · SÓ');
  assert.equal(resumo('false'), 'Brazil · NL · TT · SEM');
});

test('o diálogo de criar não promete mais «sem residenciais» (a demo segue o filtro), nas 4 línguas', () => {
  const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  const frases = [...I18N.matchAll(/'demo\.criar\.filtro': '([^']*(?:\\'[^']*)*)'/g)].map((m) => m[1]);
  assert.equal(frases.length, 4);
  for (const f of frases) assert.ok(!/resid/i.test(f), f);
});

test('filtrosDaDemo: cada filtro do apresentador chega ao corpo (e o que é padrão não vai)', () => {
  const montar = (filtros, extra = {}) => new Function('AppState', 'TYPES_ALL', 'caixaDaMinhaAreaEm', 'ordemDoWaze',
    fatiar('filtrosDaDemo') + '\nreturn filtrosDaDemo();')(
    { filters: { types: [], residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true, categories: [], ...filtros } },
    ['a', 'b', 'c'], () => [1, 2, 3, 4], () => extra.ordem || 'SORTING_UPDATE_TIME_DESC');
  assert.deepEqual({ ...montar({}) }, { unreadOnly: true });
  assert.equal(montar({ unreadOnly: false }).unreadOnly, false);
  assert.deepEqual([...montar({ types: ['a'] }).types], ['a']);
  assert.equal(montar({ types: ['a', 'b', 'c'] }).types, undefined, 'todos os tipos é o padrão: não vai');
  assert.equal(montar({ residential: 'true' }).residential, true);
  assert.equal(montar({ residential: 'false' }).residential, false);
  assert.deepEqual({ ...montar({ stateId: '9', managedAreaId: '4' }) }, { unreadOnly: true, stateId: '9', managedAreaId: '4' });
  const area = montar({ myArea: true, stateId: '9' });
  assert.deepEqual([...area.bbox], [1, 2, 3, 4]);
  assert.equal(area.stateId, undefined, 'com «Minha área» o estado e a área manual saem (a caixa manda)');
  assert.deepEqual([...montar({ categories: ['BANK'] }).categories], ['BANK']);
  assert.equal(montar({}, { ordem: 'SORTING_UPDATE_TIME_ASC' }).orderBy, 'SORTING_UPDATE_TIME_ASC');
});

// ── a chave do palco ────────────────────────────────────────────────────────
function mundo({ conta = '42', agora = 1_000_000 } = {}) {
  const ls = new Map();
  const safeLS = { get: (k) => (ls.has(k) ? ls.get(k) : null), set: (k, v) => ls.set(k, v), remove: (k) => ls.delete(k) };
  const lerPalcoDaDemo = new Function('safeLS', 'contaAgora', 'DEMO_PALCO_KEY', 'Date',
    fatiar('lerPalcoDaDemo') + '\nreturn lerPalcoDaDemo;')(safeLS, () => conta, 'waze_demo_palco', { now: () => agora });
  return { ls, safeLS, lerPalcoDaDemo };
}
const VALIDA = (extra = {}) => JSON.stringify({ demo: 'd'.repeat(40), segredo: 'S'.repeat(20), hostKey: 'H'.repeat(20), expiraEm: 2_000_000, conta: '42', ...extra });

test('lerPalcoDaDemo: só devolve a demo que ainda vale, desta conta e inteira', () => {
  const m = mundo();
  assert.equal(m.lerPalcoDaDemo(), null, 'nada guardado');
  m.ls.set('waze_demo_palco', VALIDA());
  assert.equal(m.lerPalcoDaDemo().demo, 'd'.repeat(40));
  m.ls.set('waze_demo_palco', VALIDA({ expiraEm: 999_999 }));
  assert.equal(m.lerPalcoDaDemo(), null, 'vencida não se oferece');
  m.ls.set('waze_demo_palco', VALIDA({ conta: '7' }));
  assert.equal(m.lerPalcoDaDemo(), null, 'a demo é da OUTRA conta');
  m.ls.set('waze_demo_palco', VALIDA({ hostKey: undefined }));
  assert.equal(m.lerPalcoDaDemo(), null, 'sem a chave não conduz');
  m.ls.set('waze_demo_palco', '{lixo');
  assert.equal(m.lerPalcoDaDemo(), null, 'ilegível não lança');
  assert.ok(m.ls.has('waze_demo_palco'), 'quem lê não grava nem apaga');
});

// ── criar ───────────────────────────────────────────────────────────────────
function aparelho({ resposta, podeCriar = true, trocaEpoca = false } = {}) {
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', disabled: false, checked: true, classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } }, focus() {} });
  const radios = { demoModo: { value: 'sinc' }, demoTempo: { value: '20000' } };
  const document = { getElementById: el, querySelector: (sel) => { const m = /name="(\w+)"/.exec(sel); return m ? radios[m[1]] : null; } };
  const ls = new Map();
  const chamadas = [];
  const abertos = [];
  let epocaDaSessao = 1;
  const API = { criarDemo: async (c) => { chamadas.push(c); if (trocaEpoca) epocaDaSessao++; return typeof resposta === 'function' ? resposta() : resposta; } };
  const t = (k, v) => k + (v ? JSON.stringify(v) : '');
  const fonte = fatiar('criarDemo') + '\n' + fatiar('atualizarLinhaDaDemo')
    + '\nreturn { criarDemo, get demoCriando() { return demoCriando; } };';
  const api = new Function('document', 'API', 'AppState', 'podeCriarDemoAqui', 'caixaDaMinhaAreaEm', 'filtrosDaDemo', 't', 'msgDoServidor',
    'safeLS', 'DEMO_PALCO_KEY', 'contaAgora', 'lerPalcoDaDemo', 'setTimeout', 'getEpoca', 'openModal',
    'let demoCriando = false;\nObject.defineProperty(globalThis, "epocaDaSessao", { configurable: true, get: getEpoca });\n' + fonte.replace(/\bepocaDaSessao\b/g, 'getEpoca()'))(
    document, API, { filters: { myArea: false } }, () => podeCriar, () => null, () => ({ unreadOnly: true }), t,
    (r) => r.error, { set: (k, v) => ls.set(k, v), get: (k) => ls.get(k) ?? null }, 'waze_demo_palco', () => '42', () => null, () => 0, () => epocaDaSessao, (id) => abertos.push(id));
  return { api, els, ls, chamadas, radios, abertos };
}
const OK = { success: true, demo: 'd'.repeat(40), segredo: 'S'.repeat(20), hostKey: 'H'.repeat(20), expiraEm: 9e12, criadoEm: 1, total: 30, modo: 'sinc', tempoMs: 20000, referencia: true };

test('criar: manda a escolha e os filtros, guarda a chave COM a conta e mostra o estado «criada»', async () => {
  const a = aparelho({ resposta: OK });
  await a.api.criarDemo();
  assert.equal(a.chamadas.length, 1);
  assert.deepEqual({ ...a.chamadas[0], filtros: { ...a.chamadas[0].filtros } }, { modo: 'sinc', tempoMs: 20000, referencia: true, filtros: { unreadOnly: true } });
  const guardado = JSON.parse(a.ls.get('waze_demo_palco'));
  assert.equal(guardado.hostKey, 'H'.repeat(20));
  assert.equal(guardado.conta, '42', 'a chave é DESTA conta');
  assert.deepEqual(a.abertos, ['demoProntaModal'], 'abre o diálogo «criada» (que esconde o de criar)');
  assert.equal(a.els.demoProntaResumo.textContent, 'demo.pronta.resumo{"n":30,"modo":"demo.criar.sinc"}');
});

test('criar no modo livre manda tempo 0 (o tempo por pedido não existe nele)', async () => {
  const a = aparelho({ resposta: OK });
  a.radios.demoModo.value = 'livre';
  await a.api.criarDemo();
  assert.equal(a.chamadas[0].modo, 'livre');
  assert.equal(a.chamadas[0].tempoMs, 0);
});

test('criar que falha mostra o motivo, NÃO guarda chave e destrava o botão', async () => {
  const a = aparelho({ resposta: { success: false, error: 'Só quem é L6+' } });
  await a.api.criarDemo();
  assert.equal(a.ls.size, 0);
  assert.equal(a.els.demoCriarErro.textContent, 'Só quem é L6+');
  assert.equal(a.els.demoCriarOk.disabled, false);
  assert.equal(a.api.demoCriando, false);
});

test('a resposta que chega DEPOIS do «Sair» (ou da queda) não grava a chave pra outra conta', async () => {
  const a = aparelho({ resposta: OK, trocaEpoca: true });
  await a.api.criarDemo();
  assert.equal(a.ls.size, 0, 'a época da sessão mudou durante o pedido');
});

test('quem não pode criar não cria (o botão escondido não é o portão, mas a função também recusa)', async () => {
  const a = aparelho({ resposta: OK, podeCriar: false });
  await a.api.criarDemo();
  assert.equal(a.chamadas.length, 0);
});

test('criar não roda em dobro (duplo toque)', async () => {
  let solta; const segura = new Promise((r) => { solta = r; });
  const a = aparelho({ resposta: () => segura.then(() => OK) });
  const p1 = a.api.criarDemo(); const p2 = a.api.criarDemo();
  solta(); await Promise.all([p1, p2]);
  assert.equal(a.chamadas.length, 1);
});

// ── sair é limpar de tudo ───────────────────────────────────────────────────
test('«Sair» e a troca de conta apagam a chave da demo; o outro aba só solta a memória', () => {
  const logout = fatiar('handleLogout');
  const iPor = logout.indexOf('if (!porOutraAba) {');
  assert.ok(iPor > 0);
  assert.ok(/safeLS\.remove\(DEMO_PALCO_KEY\)/.test(logout.slice(iPor)), 'o «Sair» não apaga a chave da demo');
  const troca = fatiar('esquecerOutraConta');
  const iMem = troca.indexOf('if (!soMemoria) {', troca.indexOf('AppState.history = null'));
  assert.ok(/safeLS\.remove\(DEMO_PALCO_KEY\)/.test(troca.slice(iMem, iMem + 400)), 'a troca de conta não apaga a chave da demo');
});

test('o diagnóstico NUNCA leva a chave da demo (é credencial de condução)', () => {
  assert.ok(/ls\[k\] = k === DEMO_PALCO_KEY \? '\[chave da demo omitida\]' : localStorage\.getItem\(k\)/.test(SEM));
});

test('a chave da demo só aparece onde deve (censo por função): ler, criar, sair, trocar de conta e o diagnóstico', () => {
  const donos = new Set();
  for (const m of SEM.matchAll(/DEMO_PALCO_KEY/g)) {
    const linhaIni = SEM.lastIndexOf('\n', m.index) + 1;
    if (SEM.slice(linhaIni, linhaIni + 24).startsWith('const DEMO_PALCO_KEY')) continue;   // a declaração
    const f = [...SEM.slice(0, m.index).matchAll(/^(?:async )?function (\w+)\(/gm)].pop();
    donos.add(f ? f[1] : '(topo)');
  }
  assert.deepEqual([...donos].sort(), ['criarDemo', 'diagCorpo', 'esquecerOutraConta', 'handleLogout', 'lerPalcoDaDemo'],
    'quem lê ou apaga a chave mudou: confira se o novo leitor também respeita o «Sair» e o diagnóstico');
  assert.ok(!/console\.\w+\([^)]*DEMO_PALCO_KEY/.test(SEM), 'a chave foi pro console');
});
