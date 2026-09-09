// As SENTINELAS do diagnóstico: o arquivo não me dá material pra investigar,
// ele diz o que está errado — no aparelho do editor, onde eu não chego.
//
// Cada uma nasce de um defeito que já chegou na tela de alguém, e a regra de
// entrada é dura: só invariante que a app GARANTE. Falso positivo aqui treina a
// ignorar a seção inteira, que é como ela deixa de servir. Por isso cada teste
// tem os DOIS lados — dispara com o defeito, cala sem ele.
//
// Uma sentinela já foi escrita e REMOVIDA por não passar nessa régua: a de
// "modal achatado" por altura. Ela não disparou no caso real (302px de 812, 37%)
// e o modal LEGÍTIMO é mais baixo ainda (236px, 29%) — nenhum limiar separa os
// dois. O comentário no `app.js` guarda o motivo; este arquivo trava que ela não
// volte por palpite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'js/app.js'), 'utf8');

// Fatia e AVALIA a função pura — nunca parseia a expressão (gotcha #49).
function montar() {
  const i = APP.indexOf('function diagSentinelas(');
  assert.ok(i > 0, 'diagSentinelas sumiu do app.js');
  const fim = APP.indexOf('\n}', i);
  return new Function(APP.slice(i, fim + 2) + '\nreturn diagSentinelas;')();
}
const chaves = (r) => r.map((a) => a.chave).sort();

// O estado SÃO: nada focado que abra teclado, sem inset, tema coerente.
const sao = () => ({
  janela: { innerW: 375, innerH: 812 },
  varsCss: { '--kb-inset': '0px', '--header-h': '69px' },
  foco: { tag: 'BUTTON', id: 'closeFilters', emModal: true, abreTeclado: false },
  tema: { htmlClasse: 'dark', guardado: 'dark' },
  geometria: [{ sel: '.card-btn-reject', x: 20, y: 700, w: 56, h: 56, noCentro: 'ele mesmo' }],
});

test('sentinelas: o estado SÃO não gera alerta nenhum (o controle)', () => {
  assert.deepEqual(montar()(sao()), []);
});

test('sentinelas: inset de teclado sem campo focado — o bug do PWA do iOS', () => {
  // Os números REAIS do aparelho do editor L2+AM (v2026.09.09-02).
  const c = sao();
  c.varsCss['--kb-inset'] = '388px';
  const r = montar()(c);
  assert.deepEqual(chaves(r), ['kbInsetSemFoco']);
  assert.equal(r[0].kbInset, 388);
});

test('sentinelas: com o teclado ABERTO de verdade ela cala — senão é ruído', () => {
  const c = sao();
  c.varsCss['--kb-inset'] = '336px';
  c.foco = { tag: 'INPUT', id: 'pairCodeInput', emModal: true, abreTeclado: true };
  assert.deepEqual(montar()(c), []);
});

test('sentinelas: foco DESCONHECIDO cai no lado que alerta, não no que cala', () => {
  // `abreTeclado: null` é o que sai num build ANTIGO, sem `campoDeTextoFocado` —
  // e build antigo é exatamente onde o defeito vive. A primeira versão pedia
  // `=== false` e ficava muda justamente ali.
  const c = sao();
  c.varsCss['--kb-inset'] = '388px';
  c.foco = { tag: 'BUTTON', abreTeclado: null };
  assert.deepEqual(chaves(montar()(c)), ['kbInsetSemFoco']);

  const semFoco = sao();
  semFoco.varsCss['--kb-inset'] = '388px';
  semFoco.foco = null;
  assert.deepEqual(chaves(montar()(semFoco)), ['kbInsetSemFoco']);
});

test('sentinelas: `tema-claro` + `dark` só alerta onde tem consequência', () => {
  const escuro = () => {
    const c = sao();
    c.media = { '(prefers-color-scheme: dark)': true };
    return c;
  };
  // Sistema ESCURO: a regra `html:not(.tema-claro)` que pinta o fundo vive
  // dentro do `@media (prefers-color-scheme: dark)`, então aqui a contradição
  // pesa — e alerta.
  const c = escuro();
  c.tema.htmlClasse = 'tema-claro sem-extensao dark';  // a classe REAL do diag dele
  assert.deepEqual(chaves(montar()(c)), ['temaContraditorio']);

  // Sistema CLARO: a media query nem se aplica. Alertar aqui seria disparar em
  // todo diagnóstico de quem trocou de tema — o ruído que mata a seção.
  const claro = sao();
  claro.tema.htmlClasse = 'tema-claro sem-extensao dark';
  assert.deepEqual(montar()(claro), []);

  // E `dark` tem que ser palavra inteira, nunca substring.
  const outro = escuro();
  outro.tema.htmlClasse = 'tema-claro modo-darkroom';
  assert.deepEqual(montar()(outro), []);
});

test('sentinelas: algo por cima de um controle (gotcha #26, 3 reincidências)', () => {
  const c = sao();
  c.geometria = [{ sel: '.card-btn-read', x: 0, y: 0, w: 56, h: 56, noCentro: '#lightboxCount' }];
  const r = montar()(c);
  assert.deepEqual(chaves(r), ['toqueInterceptado']);
  assert.equal(r[0].recebe, '#lightboxCount');
  // Controle: elemento que NÃO é controle pode ter coisa por cima (modal sobre
  // o placar é normal) — alertar ali seria ruído a cada abertura.
  const normal = sao();
  normal.geometria = [{ sel: '#placar', x: 0, y: 0, w: 343, h: 67, noCentro: '#filtersModalTitle' }];
  assert.deepEqual(montar()(normal), []);
});

test('sentinelas: alvo de toque abaixo de 44px', () => {
  const c = sao();
  c.geometria = [{ sel: '.card-btn-skip', x: 0, y: 0, w: 40, h: 56, noCentro: 'ele mesmo' }];
  assert.deepEqual(chaves(montar()(c)), ['alvoPequeno']);
  // 44 exatos é a régua, não uma falha
  const limite = sao();
  limite.geometria = [{ sel: '.card-btn-skip', x: 0, y: 0, w: 44, h: 44, noCentro: 'ele mesmo' }];
  assert.deepEqual(montar()(limite), []);
});

test('sentinelas: NÃO volta a sentinela de modal achatado por altura', () => {
  // Ela não distingue os dois casos: o achatado tinha 302px de 812 e o
  // `pairEnterModal` legítimo tem 236px. Se alguém a recriar, isto reprova.
  const achatado = sao();
  achatado.geometria = [{ sel: '.modal-root:not(.hidden) > div', x: 16, y: 61, w: 343, h: 302, noCentro: 'ele mesmo' }];
  const legitimo = sao();
  legitimo.geometria = [{ sel: '.modal-root:not(.hidden) > div', x: 16, y: 288, w: 343, h: 236, noCentro: 'ele mesmo' }];
  const s = montar();
  assert.deepEqual(s(achatado), [], 'sentinela de altura de modal voltou');
  assert.deepEqual(s(legitimo), [], 'sentinela de altura de modal voltou');
  assert.match(APP, /NÃO existe sentinela de "modal achatado" por ALTURA/,
    'o motivo da ausência saiu do app.js — sem ele alguém a recria por palpite');
});

test('sentinelas: erro na coleta vira alerta, nunca silêncio', () => {
  const r = montar()(null);
  assert.equal(r.length, 1);
  assert.equal(r[0].chave, '_erro');
});

test('diagnóstico: a camada computada é coletada e vai pro relatório', () => {
  // Existir não basta: função definida e nunca chamada é decoração, e a
  // sabotagem que apagou `fora.geometria = diagGeometria()` passou limpa numa
  // versão anterior deste teste. Aqui se cobra a DEFINIÇÃO e a CHAMADA.
  for (const [nome, chamada] of [['diagComputado', 'diagComputado()'],
                                 ['medirSafeArea', 'medirSafeArea()'],
                                 ['diagGeometria', 'diagGeometria()'],
                                 ['diagQuemEstaNoCentro', 'diagQuemEstaNoCentro(e, r)']]) {
    assert.ok(APP.includes('function ' + nome + '('), `${nome} sumiu`);
    const usos = APP.split(chamada).length - 1;
    assert.ok(usos >= 1, `${nome} está definida mas ninguém a chama`);
  }
  assert.match(APP, /fora\.safeArea = medirSafeArea\(\)/, 'a safe-area saiu do computado');
  assert.match(APP, /fora\.geometria = diagGeometria\(\)/, 'a geometria saiu do computado');
  // Uma medição só, usada nos dois lugares: duas medições seriam dois instantes
  // e o alerta poderia sumir do relatório em que acabou de aparecer.
  assert.match(APP, /const computado = diagComputado\(\);\s*\n\s*const alertas = diagSentinelas\(computado\);/,
    'o computado e as sentinelas se soltaram — ou são duas medições agora');
  assert.match(APP, /\n\s*alertas,\n/, 'os alertas saíram do resumo do topo');
  assert.match(APP, /\n\s*computado,\n/, 'a camada computada saiu do relatório');
  // Sem `abreTeclado` no coletor, a sentinela do teclado passa a alertar TODA
  // vez que alguém digitar (undefined !== true) — o falso positivo que faz a
  // seção inteira ser ignorada. É a metade do par que o `!== true` exige.
  assert.match(APP, /abreTeclado: \(typeof campoDeTextoFocado === 'function'\)/,
    'o coletor parou de dizer se o foco abre teclado — a sentinela vira ruído');
  // O visualViewport é o valor que custou a investigação inteira.
  assert.match(APP, /coberto: Math\.round\(window\.innerHeight - vv\.height - vv\.offsetTop\)/,
    'o `coberto` já subtraído saiu — deixar a conta pro leitor é deixar o erro passar');
});
