// A linha do "Disponível offline" depois da auditoria da rodada 23 (R23-6 F3):
// "Prêt — 0 demandes sur l’appareil" — em francês o zero é SINGULAR, e a chave
// escolhida só por `n === 1` mandava o 0 pro plural. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
const ctx = { navigator: { language: 'pt' }, document: { documentElement: {} } };
vm.createContext(ctx);
vm.runInContext(I18N, ctx);
const DICT = ctx.I18N_DICT;

const marca = APP.indexOf('function atualizarLinhaDoOffline(');
assert.ok(marca > 0, 'atualizarLinhaDoOffline sumiu do app.js');
let prof = 0, fim = -1;
for (let j = APP.indexOf('{', APP.indexOf(')', marca)); j < APP.length; j++) {
  if (APP[j] === '{') prof++;
  else if (APP[j] === '}' && --prof === 0) { fim = j + 1; break; }
}
const FONTE = APP.slice(marca, fim);

// A linha, no idioma `lang`, com `n` pedidos guardados, preparada, com rede.
function linha(lang, n, { semRede = false } = {}) {
  const el = { innerHTML: '', textContent: '' };
  const t = (k, v) => String(DICT[lang][k]).replace(/\{(\w+)\}/g, (_, x) => (v && x in v ? v[x] : '{' + x + '}'));
  const T0 = 1785200000000;
  const f = new Function('document', 'navigator', 'offlineLigado', 'filaReal', 'filaGuardadaEsperandoOTreino',
    'offlineFilaGravadaEm', 'offlineFilaPreparada', 'offlineJanelaServida', 'offlinePrecisaVarrer', 'OFFLINE_CICLO_MS',
    'offlineVarrendo', 'offlineUltimoResultado', 'offlineSemEspaco', 'escapeHtml', 't',
    FONTE + '\nreturn atualizarLinhaDoOffline;')(
    { getElementById: () => el }, { onLine: !semRede }, () => true, () => Array.from({ length: n }, (_, i) => ({ i })),
    () => null, T0, T0, Math.floor(Date.now() / 1200000), () => false, 1200000, false, null, false, (s) => s, t);
  f(0, 0);
  return el.innerHTML.replace(/<[^>]*>/g, '');
}

test('R23-6 F3: a fila vazia e pronta, em francês, diz "0 demande" (singular) — e pt/en/es seguem no plural', () => {
  assert.match(linha('fr', 0), /^Prêt — 0 demande sur/, 'DEFEITO: o zero foi pro plural em francês');
  assert.match(linha('pt', 0), /^Pronto — 0 pedidos no aparelho/);
  assert.match(linha('en', 0), /^Ready — 0 requests on your device/);
  assert.match(linha('es', 0), /^Listo: 0 solicitudes en el dispositivo/);
});

test('R23-6 F3: CONTROLE — 1 é singular e 2 é plural nos quatro idiomas', () => {
  assert.match(linha('fr', 1), /^Prêt — 1 demande sur/);
  assert.match(linha('fr', 2), /^Prêt — 2 demandes sur/);
  assert.match(linha('pt', 1), /^Pronto — 1 pedido no aparelho/);
  assert.match(linha('pt', 2), /^Pronto — 2 pedidos no aparelho/);
  assert.match(linha('en', 1), /^Ready — 1 request on/);
  assert.match(linha('es', 1), /^Listo: 1 solicitud en/);
});

test('R23-6 F3: a chave do zero existe nas quatro línguas e vale o plural onde o zero é plural', () => {
  for (const lang of Object.keys(DICT)) assert.ok(DICT[lang]['prefs.offline.prontoAZero'], `${lang} sem prontoAZero`);
  for (const lang of ['pt', 'en', 'es']) assert.equal(DICT[lang]['prefs.offline.prontoAZero'], DICT[lang]['prefs.offline.prontoAPlural'], lang);
  assert.equal(DICT.fr['prefs.offline.prontoAZero'], DICT.fr['prefs.offline.prontoA']);
});
