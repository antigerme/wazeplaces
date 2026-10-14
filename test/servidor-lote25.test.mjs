// Lote 25 (rodada 21, área "servidor e filtros"): duas pontas que o lote 24 deixou soltas.
//
// R21-6-04 — o `creatorName` caía no id quando o `userName` não era texto, mas "texto" só até
//            `String(...)`: um nome só de espaços (ou de "\u200b") virava "(desconhecido)" no card com
//            o id CONHECIDO e gravava o autor com o nome em branco na reincidência; e o `imageAuthors`
//            aceitava qualquer valor verdadeiro (`123`, `{}`, `true`, `["a"]`), que o lightbox mostrava
//            como "[object Object]". Hoje os dois passam por UMA função (`nomeDoUsuario`).
// R21-6-03 — o `loadFilters` deixava "tela ≠ busca" em dois campos que só nascem de armazenamento
//            mexido à mão: `categories` com mais de um item (a tela mostra o 1º, a busca manda todos)
//            e `stateId` que a lista de estados do país não tem (a tela mostra "Todos os estados", a
//            busca manda o estado, e a fila vem vazia).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPlacesFromSearch, nomeDoUsuario } from '../server/core.mjs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Guard que lê CÓDIGO ignora comentário, por LINHA (gotcha #67).
const semComentario = (txt) => txt.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ═══ R21-6-04 · nomeDoUsuario: nome é texto com ao menos um caractere que se vê ═════════════════
// Um pedido do usuário 7 e uma foto do usuário 8 no mesmo local, com `users` à escolha do teste.
function busca(usuarios, { createdBy = 7 } = {}) {
  return buildPlacesFromSearch({
    users: { objects: usuarios }, streets: { objects: [] }, cities: { objects: [] }, states: { objects: [] },
    venues: { objects: [{
      id: '1.2.3', name: 'Padaria', permissions: -1, categories: ['BAKERY'],
      images: [{ id: 'img1', approved: true, creatorUserId: 8 }],
      venueUpdateRequests: [{ id: 'u-1', venueID: '1.2.3', type: 'REQUEST', subType: 'UPDATE', changedVenue: { name: 'Padaria Nova' }, createdBy, isRead: false }],
    }] },
  }, { unreadOnly: false }).places[0];
}
const doisUsuarios = (userName) => [{ id: 7, userName }, { id: 8, userName }];

// O que NÃO é nome. O espaço de largura zero e a marca de direção não são espaço pro `.trim()`:
// são caracteres de FORMATO, e a regra "não vazio depois de aparar" os deixava passar.
const SEM_NOME = [
  ['só espaços', '  '], ['espaço de largura zero', '\u200b'], ['largura zero + marca de direção', '\u200b\u200e'],
  ['marca de ordem de bytes', '\ufeff'], ['preenchimento do hangul', '\u3164'], ['quadro em branco do braile', '\u2800'],
  ['espaço sem quebra', '\u00a0'], ['tab e quebra de linha', '\t\n'], ['caractere de controle', '\u0000'],
  ['hífen suave', '\u00ad'], ['vazio', ''],
  ['número', 123], ['objeto', {}], ['verdadeiro', true], ['lista', ['a']], ['nulo', null], ['ausente', undefined],
];

test('R21-6-04: userName que não é um nome legível cai no id — o do pedido fica CRU (7) e o da foto vira texto ("8")', () => {
  for (const [rotulo, userName] of SEM_NOME) {
    const p = busca(doisUsuarios(userName));
    assert.equal(p.creatorId, 7);
    assert.equal(p.createdBy, 7, `DEFEITO (${rotulo}): o card mostraria "(desconhecido)" com o id conhecido, e a reincidência gravaria o nome em branco`);
    assert.deepEqual(p.imageAuthors, { img1: '8' }, `DEFEITO (${rotulo}): a foto saiu com ${JSON.stringify(p.imageAuthors.img1)} — o lightbox mostra String(isto)`);
  }
});

test('R21-6-04: CONTROLES — nome de verdade volta como veio (sem aparar), em qualquer escrita', () => {
  for (const nome of ['joao', ' joao ', 'world_12345', '李雷', 'ז', 'Яна', '😀', 'a\u200b', '\u200bA', 'Zoë', 'x']) {
    const p = busca(doisUsuarios(nome));
    assert.equal(p.createdBy, nome, `CONTROLE: o nome ${JSON.stringify(nome)} foi trocado no pedido`);
    assert.deepEqual(p.imageAuthors, { img1: nome }, `CONTROLE: o nome ${JSON.stringify(nome)} foi trocado na foto`);
  }
  // Sem o usuário no dicionário, ou sem ninguém no pedido: o id (cru) e o texto do id; nulo sem id.
  const semDicionario = busca([]);
  assert.equal(semDicionario.createdBy, 7);
  assert.deepEqual(semDicionario.imageAuthors, { img1: '8' });
  assert.equal(busca([], { createdBy: null }).createdBy, null, 'CONTROLE: pedido sem autor tem que seguir sem autor (não "null")');
});

test('R21-6-04: `nomeDoUsuario` — o usuário que não é objeto e o fallback que o chamador escolhe', () => {
  assert.equal(nomeDoUsuario({ userName: 'ana' }, 'x'), 'ana');
  assert.equal(nomeDoUsuario({ userName: '  ' }, 'x'), 'x');
  assert.equal(nomeDoUsuario({ userName: '\u200b' }, 7), 7, 'o fallback volta como foi dado (número cru no pedido)');
  assert.equal(nomeDoUsuario(undefined, 'x'), 'x');
  assert.equal(nomeDoUsuario(null, 'x'), 'x');
  assert.equal(nomeDoUsuario('texto', 'x'), 'x', 'um usuário que é texto não tem `userName`');
  assert.equal(nomeDoUsuario({}), null, 'sem fallback, nulo');
});

test('R21-6-04 (estrutura): pedido e foto resolvem o autor pela MESMA função, e a regra velha não voltou', () => {
  const core = semComentario(ler('server/core.mjs'));
  assert.match(core, /imageAuthors\[img\.id\] = nomeDoUsuario\(usersDict\[img\.creatorUserId\], String\(img\.creatorUserId\)\);/,
    'a foto deixou de resolver o autor por nomeDoUsuario');
  assert.match(core, /const creatorName = nomeDoUsuario\(creatorObj, creatorId\);/,
    'o pedido deixou de resolver o autor por nomeDoUsuario');
  // Só a função lê o `userName` do usuário de um pedido ou de uma foto (`u`, o parâmetro dela); o resto do
  // arquivo lê o do PERFIL de quem está logado (`profile`, `rd`), que é outra coisa.
  const leituras = [...core.matchAll(/\b([A-Za-z_]+)\.userName\b/g)].map((m) => m[1]);
  assert.deepEqual(leituras.filter((x) => x !== 'profile' && x !== 'rd' && x !== 'u'), [],
    'alguém lê `.userName` de um usuário do `users` fora da nomeDoUsuario');
  assert.equal(leituras.filter((x) => x === 'u').length, 1, 'PRÉ-CONDIÇÃO: a nomeDoUsuario deixou de ler o `userName` do parâmetro');
});

// ═══ R21-6-03 · loadFilters e a lista de estados: a tela e a busca dizem a MESMA coisa ══════════
const APP = ler('js/app.js');
const SEM = semComentario(APP);
// Recorta a função de topo do app.js (a assinatura pode ter `{}` de parâmetro padrão: pula os parênteses).
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
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} caracteres — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}

// O `loadFilters` de verdade, com o armazenamento SEMEADO (o que a abertura do app lê).
function carregarFiltros(salvo) {
  const filtros = { types: [], residential: '', stateId: '', managedAreaId: '', myArea: false, unreadOnly: true, categories: [], sortOrder: 'newest' };
  const deps = { AppState: { filters: filtros }, FILTERS_KEY: 'f', ORDEM_PADRAO: 'newest', sanearTiposSalvos: (x) => (Array.isArray(x) ? x : []),
    localStorage: { getItem: () => JSON.stringify(salvo) } };
  const chaves = Object.keys(deps);
  new Function(...chaves, ['idSalvoValido', 'categoriasSalvasValidas', 'loadFilters'].map(fatiar).join('\n') + '\nloadFilters();')(...chaves.map((k) => deps[k]));
  return filtros;
}

test('R21-6-03: loadFilters — `categories` com mais de um item volta só com o 1º, que é o que o seletor dos Filtros mostra', () => {
  for (const lista of [['PARK', 'GAS_STATION'], ['PARK', 'PARK'], ['A', 'B', 'C'], ['x'.repeat(80), 'y']]) {
    assert.deepEqual(carregarFiltros({ categories: lista }).categories, [lista[0]],
      `DEFEITO: ${JSON.stringify(lista)} saiu da carga com mais de uma — a busca mandaria todas e a tela mostraria só a primeira`);
  }
  // CONTROLES: o que o seletor legítimo grava segue igual, e a lista que o servidor recusa segue vazia.
  assert.deepEqual(carregarFiltros({ categories: ['PARK'] }).categories, ['PARK'], 'CONTROLE: a categoria única foi descartada');
  assert.deepEqual(carregarFiltros({ categories: [] }).categories, [], 'CONTROLE: a lista vazia');
  assert.deepEqual(carregarFiltros({ categories: ['PARK', ''] }).categories, [], 'CONTROLE: com uma categoria ruim a lista inteira segue recusada');
  assert.deepEqual(carregarFiltros({ categories: 'PARK' }).categories, [], 'CONTROLE: texto que não é lista segue recusado');
  // Em QUALQUER lista salva a carga deixa no máximo UMA (a invariante que a tela garante).
  const lixo = [[], ['a'], ['a', 'b'], Array.from({ length: 200 }, (_, i) => 'C' + i), Array.from({ length: 201 }, () => 'C'), [1], 'x', null, {}, ['a', null], [''] ];
  for (const v of lixo) assert.ok(carregarFiltros({ categories: v }).categories.length <= 1, `a carga deixou mais de uma categoria para ${JSON.stringify(v).slice(0, 30)}`);
});

// O `loadStatesIntoSelect` de verdade (e o `esquecerEstadoForaDaLista` que ele chama), com o seletor, a API e
// o app de mentira. `lista`: o que a API devolve; `cache`: a lista já está em `statesByCountry`.
function montarEstados({ stateId = '99999', myArea = false, pais = 30, regiao = 'row', lista = [{ id: 1, name: 'São Paulo' }, { id: 2, name: 'Bahia' }], cache = false, falha = false } = {}) {
  const log = [];
  const pendentes = {};
  const select = { dataset: {}, opcoes: [], html: '', value: '', set innerHTML(v) { this.opcoes = []; this.html = v; }, get innerHTML() { return this.html; },
    appendChild(o) { this.opcoes.push(String(o.value)); } };
  const AppState = { statesByCountry: cache ? { [pais]: lista } : {}, filters: { stateId, myArea } };
  const deps = {
    document: { getElementById: () => select, createElement: () => ({}) },
    AppState,
    API: { getCountry: () => pais, getRegion: () => regiao,
      listStates: (p) => (falha ? Promise.resolve({ success: false }) : new Promise((ok) => { pendentes[p] = () => ok({ success: true, states: lista }); })) },
    escapeHtml: (x) => String(x), t: (k) => k, ordenarPorNome: (l) => l,
    saveFilters: () => log.push('salvou:' + JSON.stringify(AppState.filters.stateId)),
    dfato: (nome, dados) => log.push('dfato:' + nome + ':' + JSON.stringify(dados)),
    refazerFilaReal: () => log.push('refez'),
  };
  const chaves = Object.keys(deps);
  const fonte = 'let cargaDeEstados = 0;\n' + fatiar('loadStatesIntoSelect') + '\n' + fatiar('esquecerEstadoForaDaLista') + '\nreturn loadStatesIntoSelect;';
  const load = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  // Carrega o país e solta a resposta da API (a lista só chega depois da ida).
  const carregar = async (p, r) => { const volta = load(p, r); if (pendentes[p]) pendentes[p](); await volta; };
  return { load, carregar, select, AppState, log, pendentes };
}

test('R21-6-03: o estado salvo que a lista do país NÃO tem sai do filtro, é gravado e a fila que saiu com ele é refeita', async () => {
  for (const salvo of ['99999', 99999, '02', '7']) {
    const t = montarEstados({ stateId: salvo });
    await t.carregar(30);
    assert.deepEqual(t.select.opcoes, ['1', '2'], 'PRÉ-CONDIÇÃO: o seletor recebeu a lista do país');
    assert.equal(t.AppState.filters.stateId, '', `DEFEITO: o estado ${JSON.stringify(salvo)} ficou no filtro — a busca sai com ele e o seletor diz "Todos os estados"`);
    assert.deepEqual(t.log, ['salvou:""', 'dfato:filtros.estadoForaDaLista:{"refez":true}', 'refez'], `${JSON.stringify(salvo)}: gravar, anotar e refazer a fila, nessa ordem`);
    assert.equal(t.select.value, '', 'o seletor fica em "Todos os estados"');
  }
});

test('R21-6-03: o mesmo vale com a lista já em memória (o caminho sem ida à rede)', async () => {
  const t = montarEstados({ cache: true });
  await t.load(30);
  assert.equal(t.AppState.filters.stateId, '', 'DEFEITO: a lista em cache não conferiu o estado salvo');
  assert.deepEqual(t.log.filter((x) => x === 'refez').length, 1);
});

test('R21-6-03: com "Minha área" a busca vai pela caixa, sem o estado — ele sai do filtro, mas nada é refeito', async () => {
  const t = montarEstados({ myArea: true });
  await t.carregar(30);
  assert.equal(t.AppState.filters.stateId, '', 'DEFEITO: o estado inexistente ficou guardado debaixo do "Minha área"');
  assert.deepEqual(t.log, ['salvou:""', 'dfato:filtros.estadoForaDaLista:{"refez":false}'], 'refez a fila que saiu SEM o estado');
});

test('R21-6-03: CONTROLES — o estado que a lista tem fica (número ou texto), selecionado, sem gravar nem refazer nada', async () => {
  for (const salvo of [2, '2', 1, '1']) {
    const t = montarEstados({ stateId: salvo });
    await t.carregar(30);
    assert.equal(t.AppState.filters.stateId, salvo, `CONTROLE: o estado ${JSON.stringify(salvo)} que existe foi apagado`);
    assert.equal(t.select.value, salvo, `CONTROLE: o seletor não mostra o estado ${JSON.stringify(salvo)}`);
    assert.deepEqual(t.log, [], 'CONTROLE: gravou ou refez a fila sem motivo');
  }
  const semEstado = montarEstados({ stateId: '' });
  await semEstado.carregar(30);
  assert.deepEqual(semEstado.log, [], 'CONTROLE: sem estado salvo não há o que conferir');
});

test('R21-6-03: a limpeza só vale para a lista do país E da região APLICADOS — a que o modal escolheu é outro lugar', async () => {
  // O país do modal não é o aplicado: o salvo continua sendo o do aplicado.
  const outroPais = montarEstados({ pais: 30 });
  await outroPais.carregar(73);
  assert.equal(outroPais.AppState.filters.stateId, '99999', 'DEFEITO: a lista da FRANÇA apagou o estado salvo do Brasil');
  assert.deepEqual(outroPais.log, []);
  // A região do modal não é a aplicada (a troca de região traz a lista dela).
  const outraRegiao = montarEstados({ regiao: 'row' });
  await outraRegiao.carregar(30, 'na');
  assert.equal(outraRegiao.AppState.filters.stateId, '99999', 'DEFEITO: a lista de OUTRA região apagou o estado salvo');
  assert.deepEqual(outraRegiao.log, []);
  // CONTROLE: a mesma região, nomeada, limpa como a sem nome.
  const mesma = montarEstados({ regiao: 'row' });
  await mesma.carregar(30, 'row');
  assert.equal(mesma.AppState.filters.stateId, '', 'CONTROLE: a região aplicada, quando nomeada, deixou de conferir');
});

test('R21-6-03: a lista VAZIA e a que FALHOU não provam nada — o estado salvo fica (o servidor também devolve [] quando o Waze muda a forma)', async () => {
  const vazia = montarEstados({ lista: [] });
  await vazia.carregar(30);
  assert.equal(vazia.AppState.filters.stateId, '99999', 'DEFEITO: a lista vazia apagou a escolha da pessoa');
  assert.deepEqual(vazia.log, []);
  const falhou = montarEstados({ falha: true });
  await falhou.carregar(30);
  assert.equal(falhou.AppState.filters.stateId, '99999', 'DEFEITO: a lista que não veio apagou a escolha da pessoa');
  assert.deepEqual(falhou.log, []);
});

test('R21-6-03: a carga que perdeu a vez (trocou de país no meio) não apaga nada — a resposta velha nem chega à conferência', async () => {
  const t = montarEstados({ pais: 30 });
  const velha = t.load(30);                 // a ida do país aplicado fica no ar
  const nova = t.load(73);                  // a pessoa trocou de país: esta carga é a dona do seletor
  t.pendentes[73](); await nova;
  t.pendentes[30](); await velha;           // a resposta velha (sem o estado salvo) chega por último
  assert.equal(t.AppState.filters.stateId, '99999', 'DEFEITO: a resposta VELHA do país aplicado limpou o estado depois de a pessoa trocar de país');
  assert.deepEqual(t.log, []);
  assert.deepEqual(t.select.opcoes, ['1', '2'], 'PRÉ-CONDIÇÃO: o seletor tem a lista da carga nova');
});

test('R21-6-03 (estrutura): só a lista de estados confere o estado salvo, e o `loadFilters` não deixa passar mais de uma categoria', () => {
  const chamadas = [...SEM.matchAll(/\besquecerEstadoForaDaLista\(/g)].length;
  assert.equal(chamadas, 2, 'a esquecerEstadoForaDaLista tem que ter a declaração e UM chamador (o loadStatesIntoSelect)');
  assert.match(fatiar('loadStatesIntoSelect'), /else if \(states\.length > 0 && \(regiao === undefined \|\| regiao === API\.getRegion\(\)\)\) esquecerEstadoForaDaLista\(\);/);
  assert.match(fatiar('loadFilters'), /AppState\.filters\.categories = categoriasSalvasValidas\(parsed\.categories\)\.slice\(0, 1\);/,
    'o loadFilters deixou de reduzir a lista de categorias à que a tela mostra');
});
