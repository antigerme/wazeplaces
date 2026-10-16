// "Duplicado de «nome longo»" não pode ligar a rede de segurança do card
// (auditoria do card, 2026-09-29, C16).
//
// O motivo do reporte mora numa linha `flex-shrink-0`, e o valor crescia sem
// teto: com o nome do local duplicado longo, no Galaxy Fold, o card inteiro
// passava a rolar (`card-content-rola`) e o arraste pra cima deixava de pular
// (gotcha #29). MEDIDO com a fixture `nomeLongo` do smoke (6 linhas, 120 px) e
// com um nome real de 51 caracteres (4 linhas, 80 px). O valor ganhou o MESMO
// teto de duas linhas de categoria e endereço, com a frase inteira no `title`.
//
// Aqui fica a rede ESTRUTURAL; a prova na tela — a rede desligada nos 4
// idiomas, o valor em até duas linhas, o `title` com o nome inteiro, e o
// CONTROLE que tira o teto e vê a rede ligar — está no bloco DUPLICATE do
// `tools/smoke-browser.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const semComentarioHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const semComentarioJs = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('C16 o valor do motivo tem teto de DUAS linhas, como categoria e endereço', () => {
  const tpl = semComentarioHtml(ler('index.src.html')).match(/<template id="cardTemplate">[\s\S]*?<\/template>/);
  assert.ok(tpl, 'sumiu o template do card');
  const valor = tpl[0].match(/<span class="card-flag-reason-value([^"]*)"/);
  assert.ok(valor, 'sumiu o valor do motivo no card');
  const classes = valor[1].trim().split(/\s+/);
  assert.ok(classes.includes('line-clamp-2'),
    'DEFEITO: o motivo voltou a crescer sem teto — "Duplicado de «nome longo»" liga a rede de segurança no Fold');
  // O teto é o de categoria e endereço: a mesma régua, na mesma forma de linha.
  for (const irmao of ['card-category', 'card-address']) {
    const m = tpl[0].match(new RegExp(`<span class="${irmao} ([^"]*)"`));
    assert.ok(m && m[1].split(/\s+/).includes('line-clamp-2'), `${irmao} perdeu o teto de duas linhas (a régua mudou?)`);
  }
  // E a classe EXISTE no CSS gerado: classe que o Tailwind não gerou não corta
  // nada, e o HTML sozinho passaria verde.
  const css = ler('css/app.css');
  assert.match(css, /\.line-clamp-2\{[^}]*-webkit-line-clamp:2/, 'o css/app.css não tem o line-clamp-2 (rode npm run css)');
});

test('C16 o que o teto corta fica inteiro no `title`', () => {
  const app = semComentarioJs(ler('js/app.js'));
  assert.match(app, /const valorDoMotivo = card\.querySelector\('\.card-flag-reason-value'\);\s*valorDoMotivo\.textContent = motivo;\s*valorDoMotivo\.title = motivo;/,
    'o valor do motivo não leva a frase inteira no title — o nome cortado pelo teto sumiria de vez');
});
