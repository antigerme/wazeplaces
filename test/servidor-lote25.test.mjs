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
