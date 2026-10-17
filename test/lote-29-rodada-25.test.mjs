// Lote 29 (rodada 25): guards de fonte dos consertos de tela/cliente. Os do servidor moram em manter-conectado-servidor.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const API = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const corpo = (src, nome) => { const i = src.indexOf(`function ${nome}(`); assert.ok(i >= 0, `sumiu ${nome}`); return src.slice(i, i + 6000); };

test('R25-7-01: trocar de aba dos Filtros zera o corpo E o cartão (nas janelas do degrau quem rola é o cartão)', () => {
  const c = corpo(APP, 'switchFilterTab');
  assert.match(c, /caixa\.scrollTop = 0/, 'o corpo deixou de ser zerado');
  assert.match(c, /cartao\s*=\s*caixa && caixa\.parentElement/, 'o cartão não é localizado a partir do corpo');
  assert.match(c, /cartao\.scrollTop = 0/, 'o cartão não é zerado: a aba nova abre rolada com as abas fora da tela');
});

test('R25-7-08: o 401 do interruptor «Manter conectado» confere a sessão como as outras rotas', () => {
  const c = corpo(APP, 'aoMudarManterConectado');
  assert.match(c, /errorCategory === 'unauthorized'[\s\S]{0,80}handleUnauthorized\(\)/, 'o 401 do gesto virou só «não deu pra mudar»');
});

test('R25-6-04 / R25-7-05: só o perfil da região da FILA manda `manter` (a sonda de outro servidor não move a entrada)', () => {
  assert.match(API, /typeof manter === 'boolean' && \(!regiao \|\| regiao === this\.getRegion\(\)\)\) corpo\.manter = manter/,
    'a sonda de outra região voltou a mandar `manter` (uma escrita de KV por troca)');
});

// ── R25-4-01 / R25-4-02: a fila de saída do lote 28 ──────────────────────────────────────────────────────────
const APP_CRU = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const fatiaDe = (nome) => {
  const i = APP_CRU.indexOf(`function ${nome}(`);
  assert.ok(i >= 0, `sumiu ${nome}`);
  const j = APP_CRU.indexOf('\n}\n', i);
  return APP_CRU.slice(i, j + 3);
};

test('R25-4-02: a impressão digital do item da fila de saída não muda quando o perfil carimba a `conta`', () => {
  const chave = new Function(`${fatiaDe('chaveDoItemDaSaida')}; return chaveDoItemDaSaida;`)();
  const base = { t: 1790000000000, tipo: 'reject', venueID: 'v1', updateRequestID: 'u1', s: 'abc' };
  assert.equal(chave({ ...base, conta: 12345 }), chave(base), 'carimbar a conta mudou a identidade do item (a decisão saía 2×)');
  assert.equal(chave({ ...base, tt: 2, tf: 3, u401: 9, rv: 'x', rvEm: 1 }), chave(base), 'os campos de estado entraram na identidade');
  // CONTROLE: outro pedido continua sendo outro item.
  assert.notEqual(chave({ ...base, venueID: 'v2' }), chave(base));
});

test('R25-4-01: `marcarNaSaida` sem o `t` (o 401 de um item já na fila) acha o item pelo PEDIDO e grava o `u401`', () => {
  const chaveDoItemDaSaida = new Function(`${fatiaDe('chaveDoItemDaSaida')}; return chaveDoItemDaSaida;`)();
  const fila = [{ t: 1790000000000, tipo: 'reject', venueID: 'v1', updateRequestID: 'u1', s: 'abc', conta: 7 }, { t: 1790000000001, tipo: 'read', venueID: 'v1', updateRequestID: 'u1', s: 'abc' }];
  let salvo = null;
  const marcar = new Function('carregarFilaDeSaida', 'salvarFilaSemOs', 'chaveDoItemDaSaida', `${fatiaDe('marcarNaSaida')}; return marcarNaSaida;`)(
    () => JSON.parse(JSON.stringify(fila)), (f, _t, mudancas) => { salvo = { f, mudancas }; }, chaveDoItemDaSaida);
  assert.equal(marcar({ tipo: 'reject', venueID: 'v1', updateRequestID: 'u1' }, { u401: 123 }), true, 'não achou o item pelo pedido');
  assert.equal(salvo.f[0].u401, 123, 'o u401 não foi gravado no item certo');
  assert.equal(salvo.f[1].u401, undefined, 'gravou também no item de OUTRO tipo do mesmo pedido');
  // Com o `t`, a identidade completa continua valendo (o caminho de sempre).
  assert.equal(marcar({ ...fila[1] }, { u401: 5 }), true);
  // CONTROLE: pedido que não está na fila não grava nada.
  salvo = null;
  assert.equal(marcar({ tipo: 'reject', venueID: 'v9', updateRequestID: 'u9' }, { u401: 1 }), false);
  assert.equal(salvo, null);
});
