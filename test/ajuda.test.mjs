// A Ajuda é uma coluna de seções no MESMO molde: um título e, logo embaixo, o
// corpo (lista ou parágrafo). A seção "Quem está no app" nasceu fora dele
// (#150, 2026-08-22) — lista em 16px, sem o `text-sm` das vizinhas (14px), e
// título sem os dois-pontos — e ficou assim um mês, até o owner olhar a tela.
// Nenhum teste via, porque nenhum comparava uma seção com as outras.
//
// Este arquivo cobra o molde de TODA seção, pra próxima não nascer igual:
//   · o corpo logo depois do título (ul/ol/p) tem `text-sm`;
//   · título de seção termina em dois-pontos em TODOS os idiomas; o de CAIXA
//     (maiúsculas, dentro dos cartões "Como processar" e "Legenda") não;
//   · dentro de um idioma, todos os títulos usam a MESMA forma de dois-pontos
//     (o francês põe espaço antes, os outros não) — sem cravar tipografia aqui.
// E a posição que o owner escolheu pra seção da presença: logo depois de "Como usar:".
// O tamanho que a TELA dá (não só a classe) é medido no smoke de browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function loadDict() {
  const ctx = { navigator: { language: 'pt' }, document: { documentElement: {} } };
  vm.createContext(ctx);
  vm.runInContext(read('js/i18n.js'), ctx);
  return ctx.I18N_DICT;
}
const DICT = loadDict();

// O bloco do #helpModal, SEM comentários: eles citam chave e classe justamente
// onde elas importam, e casar a menção é o gotcha #67.
function modalDeAjuda() {
  const html = read('index.src.html').replace(/<!--[\s\S]*?-->/g, '');
  const ini = html.indexOf('<div id="helpModal"');
  assert.ok(ini > 0, 'o #helpModal sumiu do index.src.html');
  const tag = /<(\/?)div\b[^>]*>/g;
  tag.lastIndex = ini;
  let prof = 0, m;
  while ((m = tag.exec(html))) {
    prof += m[1] ? -1 : 1;
    if (prof === 0) return html.slice(ini, tag.lastIndex);
  }
  throw new Error('o #helpModal não fecha — o recorte do teste está errado');
}

// Cada título de seção e o elemento que vem logo depois dele.
function secoes() {
  const bloco = modalDeAjuda();
  const out = [];
  const re = /<h4\b([^>]*)>[\s\S]*?<\/h4>\s*<(\w+)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(bloco))) {
    const attr = (s, nome) => (s.match(new RegExp(`\\b${nome}="([^"]*)"`)) || [])[1] || '';
    out.push({
      chave: attr(m[1], 'data-i18n'),
      caixa: attr(m[1], 'class').split(/\s+/).includes('uppercase'),
      corpo: m[2],
      classesDoCorpo: attr(m[3], 'class').split(/\s+/),
    });
  }
  return out;
}

const SECOES = secoes();

test('ajuda: o recorte acha as seções (controle do instrumento)', () => {
  // Um recorte que devolve NADA passaria nos testes de baixo sem conferir nada
  // (gotcha #62). As chaves abaixo são seções que existem hoje.
  const chaves = SECOES.map((s) => s.chave);
  for (const k of ['help.howToProcess.title', 'help.legend.title', 'help.howToUse.title', 'help.presenca.title', 'help.privacy.title']) {
    assert.ok(chaves.includes(k), `a seção ${k} não foi achada no #helpModal — ${JSON.stringify(chaves)}`);
  }
  assert.ok(SECOES.filter((s) => /^(ul|ol|p)$/.test(s.corpo)).length >= 7, 'menos de 7 corpos de seção achados');
});

test('ajuda: todo corpo de seção (lista ou parágrafo) tem text-sm', () => {
  for (const s of SECOES) {
    if (!/^(ul|ol|p)$/.test(s.corpo)) continue;   // a grade do "Como processar" tem régua própria
    assert.ok(s.classesDoCorpo.includes('text-sm'),
      `a seção ${s.chave} tem o <${s.corpo}> sem text-sm (${s.classesDoCorpo.join(' ')}) — ela sai maior que as outras`);
  }
});

test('ajuda: título de seção termina em dois-pontos em todos os idiomas; o de caixa, não', () => {
  const LANGS = Object.keys(DICT);
  assert.ok(LANGS.length >= 4, `só ${LANGS.length} idioma(s)`);
  for (const lang of LANGS) {
    const formas = new Set();
    for (const s of SECOES) {
      const txt = DICT[lang][s.chave];
      assert.ok(typeof txt === 'string' && txt.length, `${lang}: ${s.chave} sem texto`);
      if (s.caixa) {
        assert.ok(!/:\s*$/.test(txt), `${lang}: o título de caixa ${s.chave} não leva dois-pontos: "${txt}"`);
        continue;
      }
      assert.ok(/:$/.test(txt), `${lang}: o título ${s.chave} não termina em dois-pontos, como as vizinhas: "${txt}"`);
      formas.add(/\s:$/.test(txt) ? JSON.stringify(txt.slice(-2)) : '":"');
    }
    assert.equal(formas.size, 1, `${lang}: os títulos usam formas diferentes de dois-pontos: ${[...formas].join(' e ')}`);
  }
});

test('ajuda: "Quem está no app" vem logo depois de "Como usar:"', () => {
  // Decisão do owner (2026-09-24): é recurso de uso, e quem procura o que é a
  // pílula 👥 não devia ter que passar por privacidade e extensões de login.
  const chaves = SECOES.map((s) => s.chave);
  assert.equal(chaves.indexOf('help.presenca.title'), chaves.indexOf('help.howToUse.title') + 1,
    `ordem atual: ${chaves.join(' → ')}`);
});
