// A demo — o que é PURO (server/demo.mjs). Cada teste daqui foi visto
// REPROVANDO com a regra desfeita (gotcha #28, pergunta 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEMO_UNDO_GATE_BASE, MIN_RANK_DEMO, cotaDaDemo, podeCriarDemo, gerarTexto, limparCodigo, ehSegredo, ehCodigoCurto,
  limparApelido, limparPais, votosValidos, votosDoTexto, textoDeVotos, montarRetrato, CAMPOS_DO_DIFF_NA_DEMO,
  DEMO_APELIDO_MAX, DEMO_SEGREDO_LEN, DEMO_CODIGO_LEN, DEMO_ALFABETO,
} from '../server/demo.mjs';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../server/core.mjs', import.meta.url), 'utf8');

// ── a cota: a do MENOR nível que entra no app ───────────────────────────────

test('a cota da demo é a do menor nível que entra: 30 hoje, e acompanha as duas pontas', () => {
  const minRank = Number(/^const MIN_RANK_WAZE = (\d+);/m.exec(core)[1]);
  assert.equal(cotaDaDemo(minRank), 30);
  assert.equal(cotaDaDemo(0), 60, 'se o portão baixar pra L1, a demo volta a 60');
  assert.equal(cotaDaDemo(minRank, 90), 45, 'se a base do Desfazer mudar, a demo muda junto');
});

test('paridade: o UNDO_GATE_BASE do app.js é o da demo (senão a demo mente sobre a cota)', () => {
  const noApp = Number(/^const UNDO_GATE_BASE = (\d+);/m.exec(app)[1]);
  assert.equal(DEMO_UNDO_GATE_BASE, noApp);
});

// ── quem cria: L6+ com área gerenciada ──────────────────────────────────────

test('podeCriarDemo: L6+AM ou staff; L5+AM, L6 sem AM e perfil estragado não', () => {
  assert.equal(MIN_RANK_DEMO, 5, 'rank 0-indexed: L6 é 5');
  assert.equal(podeCriarDemo({ rank: 5, isAreaManager: true }), true);
  assert.equal(podeCriarDemo({ rank: 6, isAreaManager: true }), true);
  assert.equal(podeCriarDemo({ rank: 4, isAreaManager: true }), false, 'L5+AM é o portão do destrutivo, não o da demo');
  assert.equal(podeCriarDemo({ rank: 5, isAreaManager: false }), false);
  assert.equal(podeCriarDemo({ rank: 5, isAreaManager: 'true' }), false, 'booleano estrito');
  assert.equal(podeCriarDemo({ rank: '5', isAreaManager: true }), false);
  assert.equal(podeCriarDemo({ rank: 0, isStaff: true }), true);
  assert.equal(podeCriarDemo(null), false);
  assert.equal(podeCriarDemo({}), false);
});

test('paridade: MIN_RANK_DEMO do app.js é o do servidor', () => {
  assert.equal(Number(/^const MIN_RANK_DEMO = (\d+);/m.exec(app)?.[1] ?? NaN), MIN_RANK_DEMO);
});

// ── segredo e código ────────────────────────────────────────────────────────

test('gerarTexto: só o alfabeto sem ambíguos, no tamanho pedido, sem viés de resto', () => {
  const s = gerarTexto(DEMO_SEGREDO_LEN);
  assert.equal(s.length, 20);
  assert.ok([...s].every((c) => DEMO_ALFABETO.includes(c)));
  assert.ok(!/[01OI]/.test(DEMO_ALFABETO), 'o alfabeto não tem 0, O, 1 nem I');
  // Aleatório de mentira com byte 255 (≥ limite): tem de ser rejeitado, não mapeado.
  let rodada = 0;
  const falso = (n) => Uint8Array.from({ length: n }, (_, i) => (rodada++ < 4 ? 255 : i % 32));
  const t = gerarTexto(6, falso);
  assert.equal(t.length, 6);
  assert.ok([...t].every((c) => DEMO_ALFABETO.includes(c)));
  assert.notEqual(new Set(Array.from({ length: 20 }, () => gerarTexto(20))).size, 1, 'saiu sempre o mesmo');
});

test('limparCodigo e os dois formatos: o que se digita (minúscula, hífen, espaço) entra', () => {
  assert.equal(limparCodigo(' k7q-2m9 '), 'K7Q2M9');
  assert.equal(ehCodigoCurto(limparCodigo('k7q-2m9')), true);
  assert.equal(ehCodigoCurto('K7Q2M'), false);
  assert.equal(ehCodigoCurto('K7Q2M0'), false, '0 não existe no alfabeto');
  assert.equal(ehSegredo(gerarTexto(DEMO_SEGREDO_LEN)), true);
  assert.equal(ehSegredo(gerarTexto(DEMO_CODIGO_LEN)), false);
  assert.equal(limparCodigo(null), '');
});

// ── apelido: texto que a pessoa digita e o apresentador projeta ─────────────

test('limparApelido: tira controle bidi e largura zero, junta espaços, corta em PONTOS DE CÓDIGO', () => {
  assert.equal(limparApelido('  Maria   SP '), 'Maria SP');
  assert.equal(limparApelido('a' + String.fromCodePoint(0x202E) + 'b' + String.fromCodePoint(0x200B) + 'c'), 'a b c'.replace(/ /g, ' '), 'U+202E e U+200B viram espaço');
  assert.equal(limparApelido('' + String.fromCodePoint(0x202E) + '' + String.fromCodePoint(0x2066) + ''), null, 'só invisível não é apelido');
  assert.equal(limparApelido(''), null);
  assert.equal(limparApelido(42), null);
  assert.equal(limparApelido('אביב'), 'אביב', 'hebraico e árabe seguem intactos');
  assert.equal(limparApelido('سارة'), 'سارة');
  const longo = limparApelido('x'.repeat(50));
  assert.equal([...longo].length, DEMO_APELIDO_MAX);
  assert.equal([...limparApelido('😀'.repeat(30))].length, DEMO_APELIDO_MAX, 'emoji não vira meio caractere');
  assert.equal(limparPais('  França '), 'França');
});

// ── votos ───────────────────────────────────────────────────────────────────

test('votos: um caractere por pedido; tamanho errado ou símbolo estranho não passa', () => {
  assert.equal(votosValidos('RLP-RL', 6), true);
  assert.equal(votosValidos('RLP-R', 6), false, 'tamanho');
  assert.equal(votosValidos('RLPXRL', 6), false, 'símbolo');
  assert.equal(votosValidos('rlprl-', 6), false, 'minúscula');
  assert.equal(votosValidos(['R'], 1), false, 'não é texto');
  assert.deepEqual(votosDoTexto('RLP-'), ['R', 'L', 'P', null]);
  assert.equal(textoDeVotos(['R', null, 'P', 'X']), 'R-P-');
});

// ── o retrato ───────────────────────────────────────────────────────────────

const pedido = (n, extra = {}) => ({
  venueID: 'real-venue-' + n, updateRequestID: 'real-ur-' + n, name: 'Local ' + n, categories: ['BAKERY'], address: 'Rua ' + n,
  updateType: 'Nova Foto', updateTypeKey: 'IMAGE', reqType: 'IMAGE', reqSubType: '', purType: 'NEW_PHOTO',
  createdBy: 'world_12345', creatorId: 987654, creatorRank: 3, flagComment: 'ligue 11 99999-0000', source: 'MOBILE_CLIENT',
  imageUrls: ['https://venue-image.waze.com/thumbs/thumb700_1.jpg'], lat: -23.5, lon: -46.6, dateAdded: 1700000000,
  changes: [], mapa: null, ...extra,
});

test('retrato: o convidado não recebe autor, comentário livre nem id real', () => {
  const { convidado, apresentador } = montarRetrato([pedido(1), pedido(2)], 30);
  const bruto = JSON.stringify(convidado);
  for (const proibido of ['world_12345', '987654', 'ligue 11', 'real-venue', 'real-ur', 'createdBy', 'creatorId', 'flagComment']) {
    assert.ok(!bruto.includes(proibido), 'vazou: ' + proibido);
  }
  assert.deepEqual(convidado.map((c) => c.updateRequestID), ['demo-1', 'demo-2']);
  assert.deepEqual(apresentador[1], { n: 2, venueID: 'real-venue-2', updateRequestID: 'real-ur-2' }, 'o apresentador guarda o id real (↗)');
});

test('retrato: ALLOWLIST — campo novo do Waze nasce fora', () => {
  const { convidado } = montarRetrato([pedido(1, { campoNovoDoWaze: 'segredo', telefoneDoAutor: '11 99999' })], 30);
  assert.ok(!('campoNovoDoWaze' in convidado[0]) && !JSON.stringify(convidado).includes('segredo'));
});

test('retrato: residencial fica de fora (foto de casa), pelos dois sinais', () => {
  const { convidado } = montarRetrato([
    pedido(1, { categories: ['RESIDENCE_HOME'] }), pedido(2, { residential: true }), pedido(3),
  ], 30);
  assert.deepEqual(convidado.map((c) => c.name), ['Local 3']);
  assert.equal(convidado[0].n, 1, 'a numeração é a do retrato, sem buraco');
});

test('retrato: respeita o máximo e o corte vale DEPOIS de tirar os residenciais', () => {
  const lista = [pedido(1, { residential: true }), ...Array.from({ length: 40 }, (_, i) => pedido(i + 2))];
  const { convidado, apresentador } = montarRetrato(lista, 30);
  assert.equal(convidado.length, 30);
  assert.equal(apresentador.length, 30);
  assert.equal(montarRetrato([pedido(1)], 30).convidado.length, 1, 'menos que o máximo é aceito');
  assert.equal(montarRetrato(null, 30).convidado.length, 0);
});

test('retrato: o diff só leva campo conhecido e sem texto livre de terceiros', () => {
  const mud = (field) => ({ field, label: field, from: 'a', to: 'b' });
  const { convidado } = montarRetrato([pedido(1, { changes: [mud('name'), mud('description'), mud('phone'), mud('url'), mud('aliases'), mud('externalProviderIDs'), mud('campoNovo'), mud('categories')] })], 30);
  assert.deepEqual(convidado[0].changes.map((c) => c.field), ['name', 'categories']);
  for (const livre of ['description', 'phone', 'url', 'aliases', 'externalProviderIDs']) assert.ok(!CAMPOS_DO_DIFF_NA_DEMO.has(livre), livre);
});

test('retrato: o alvo da denúncia só passa quando é FOTO; duplicado sai sem o id do outro local', () => {
  const foto = montarRetrato([pedido(1, { flagType: 'LOW_QUALITY', flagSubjectType: 'IMAGE', flagEntityID: '555' })], 30).convidado[0];
  assert.equal(foto.flagEntityID, '555');
  const dup = montarRetrato([pedido(2, { flagType: 'DUPLICATE', flagSubjectType: 'VENUE', flagEntityID: 'outro-local-77', duplicado: { id: 'outro-local-77', nome: 'Gêmeo', distM: 40, ll: [-23.5, -46.6] } })], 30).convidado[0];
  assert.equal(dup.flagEntityID, null);
  assert.deepEqual(dup.duplicado, { nome: 'Gêmeo', distM: 40, ll: [-23.5, -46.6] });
  assert.ok(!JSON.stringify(dup).includes('outro-local-77'));
});

test('retrato: foto só de host do Waze (a imagem de terceiro não entra num link público)', () => {
  const { convidado } = montarRetrato([pedido(1, { imageUrls: ['https://venue-image.waze.com/a.jpg', 'https://evil.example/x.jpg', 'http://venue-image.waze.com/b.jpg', 'https://evilwaze.com/c.jpg', 42] })], 30);
  assert.deepEqual(convidado[0].imageUrls, ['https://venue-image.waze.com/a.jpg']);
});
