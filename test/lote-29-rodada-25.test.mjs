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
