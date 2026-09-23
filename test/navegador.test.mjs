// O navegador dos testes é o MAIS NOVO, e todo script que abre um passa por UMA
// porta (`tools/navegador.mjs`). Este arquivo cobra as duas coisas.
//
// A história (a longa está no CLAUDE.md, no parágrafo do smoke de browser): o
// CI fixou o Playwright 1.49.1 — Chromium 131, de novembro de 2024 — por uns 21
// meses, enquanto o sandbox tinha o 1.56.1 global e o editor roda o Chrome da
// vez, que se atualiza sozinho. Dois defeitos de INSTRUMENTO só existiam numa
// das versões e viraram "não reproduz aqui". E o carregador, copiado em quatro
// smokes, tinha um defeito que morava em dois dos quatro: cópia é como a
// correção chega num lugar e não no outro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { _paraTeste } from '../tools/navegador.mjs';

const ler = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
// Sem comentário na conta (gotcha #67): os arquivos CITAM o padrão errado
// justamente pra explicar por que ele é errado.
const semComentario = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Os scripts que abrem navegador hoje. Serve de ALCANCE: se um deles deixar de
// passar pela fonte única, ou o guard parar de enxergá-lo, reprova.
const ABREM_NAVEGADOR = [
  'smoke-browser.mjs', 'smoke-offline.mjs', 'smoke-presenca.mjs', 'smoke-fluxo.mjs',
  'diag-replay.mjs', 'diag-tela.mjs', 'smoke-diag-tela.mjs', 'gerar-splash.mjs',
];

test('todo script que abre navegador passa pela fonte única', () => {
  const arquivos = readdirSync(new URL('../tools/', import.meta.url))
    .filter((f) => f.endsWith('.mjs') && f !== 'navegador.mjs');
  const usam = [];
  for (const f of arquivos) {
    const codigo = semComentario(ler(`tools/${f}`));
    // Carregar por fora é a porta por onde a versão divergia calada.
    assert.doesNotMatch(codigo, /node_modules\/playwright/,
      `${f} importa um playwright por CAMINHO — passe pelo tools/navegador.mjs`);
    assert.doesNotMatch(codigo, /resolve\(\s*'playwright'/,
      `${f} resolve o playwright por conta própria — passe pelo tools/navegador.mjs`);
    assert.doesNotMatch(codigo, /import\(\s*'playwright'\s*\)|from\s+'playwright'/,
      `${f} importa o playwright direto — passe pelo tools/navegador.mjs`);
    // Abrir por fora pula a linha do log que diz QUAL navegador rodou.
    assert.doesNotMatch(codigo, /\bchromium\.launch\(/,
      `${f} abre o Chromium por conta própria — use abrirChromium`);
    // Versão cravada num script é o pino que ficou 21 meses sem ninguém mexer.
    assert.doesNotMatch(codigo, /playwright@\d/, `${f} crava uma versão do Playwright`);
    if (/from '\.\/navegador\.mjs'|import\('\.\/navegador\.mjs'\)/.test(codigo)) usam.push(f);
  }
  for (const f of ABREM_NAVEGADOR) {
    assert.ok(usam.includes(f),
      `${f} não passa pelo tools/navegador.mjs — voltou a carregar por conta própria, ou o guard perdeu alcance`);
  }
});

test('a fonte única: o do repo primeiro, o global só pedido, a versão no log e sem plano B', () => {
  const src = semComentario(ler('tools/navegador.mjs'));

  // O pacote publicado é CJS por baixo: por CAMINHO o import devolve só o
  // `default`. Foi isso que fez a tentativa "do repo" falhar calada.
  assert.match(src, /mod\s*&&\s*mod\.chromium\s*\?\s*mod\s*:\s*\(mod\s*&&\s*mod\.default\)/,
    'a fonte única deixou de aceitar a forma CJS (namespace só com `default`)');

  // O global do sandbox só entra PEDIDO. Toda importação dele tem que estar
  // dentro do bloco do `PLAYWRIGHT_GLOBAL === '1'`.
  const abre = "if (process.env.PLAYWRIGHT_GLOBAL === '1') {";
  const ini = src.indexOf(abre);
  assert.ok(ini >= 0, 'sumiu o pedido explícito pro global do sandbox');
  let prof = 0;
  let fim = -1;
  for (let i = ini + abre.length - 1; i < src.length; i++) {
    if (src[i] === '{') prof++;
    else if (src[i] === '}' && --prof === 0) { fim = i; break; }
  }
  const usosDoGlobal = [...src.matchAll(/import\(GLOBAL_DO_SANDBOX\)/g)].map((m) => m.index);
  assert.ok(usosDoGlobal.length >= 1, 'o guard não achou a importação do global — perdeu alcance');
  for (const pos of usosDoGlobal) {
    assert.ok(pos > ini && pos < fim,
      'o global do sandbox passou a ser importado SEM o pedido explícito — é a divergência calada de volta');
  }

  // O log diz com o que testou: a versão do Playwright, a origem e a do navegador.
  assert.match(src, /console\.log\(`navegador: Chromium \$\{browser\.version\(\)\} · Playwright \$\{pw\.versao\} \(\$\{pw\.origem\}\)`\)/,
    'a linha que diz QUAL navegador rodou sumiu ou mudou de forma');

  // Sem plano B: se o Chromium do Playwright não abrir, o script para.
  assert.doesNotMatch(src, /channel\s*:/,
    'voltou o "tenta o Chrome do sistema" — outro navegador, com outra versão, entrando em silêncio');
});

test('comparar versões é por NÚMERO, não por texto', () => {
  const { maisNova } = _paraTeste;
  assert.equal(maisNova('1.64.0', '1.63.0'), true);
  assert.equal(maisNova('1.63.1', '1.63.0'), true);
  assert.equal(maisNova('2.0.0', '1.99.9'), true);
  assert.equal(maisNova('1.63.0', '1.63.0'), false, 'a mesma versão não é mais nova');
  assert.equal(maisNova('1.62.1', '1.63.0'), false);
  // O caso que uma comparação de TEXTO erra: '1.10' < '1.9' em ordem de string.
  assert.equal(maisNova('1.10.0', '1.9.0'), true);
  assert.equal(maisNova('1.9.0', '1.10.0'), false);
});

test('o carregador aceita as duas formas do módulo, e só com o `chromium`', () => {
  const { comChromium } = _paraTeste;
  const chromium = { launch() {} };
  assert.equal(comChromium({ chromium }).chromium, chromium, 'forma ESM (nomeados)');
  assert.equal(comChromium({ default: { chromium } }).chromium, chromium, 'forma CJS (só `default`)');
  assert.equal(comChromium({ default: {} }), null, 'módulo sem `chromium` não serve');
  assert.equal(comChromium(null), null);
});

test('o CI testa com o Playwright MAIS NOVO, por um botão só', () => {
  const ci = ler('.github/workflows/ci.yml');
  // O navegador de quem usa a app se atualiza sozinho; o do teste também tem
  // que ser o da vez. Fixar uma versão é EXCEÇÃO: se um Playwright novo vier
  // quebrado, fixe aqui e no workflow, com o motivo e a data — ato deliberado,
  // não um pino esquecido por 21 meses.
  assert.match(ci, /PLAYWRIGHT_VERSAO:\s*latest\s*$/m, 'o CI deixou de usar o Playwright mais novo');
  assert.match(ci, /npm i --no-save "playwright@\$PLAYWRIGHT_VERSAO"/,
    'o CI instala o Playwright sem passar pelo botão PLAYWRIGHT_VERSAO');
  assert.doesNotMatch(ci, /playwright@\d/, 'o CI voltou a cravar uma versão do Playwright');
});
