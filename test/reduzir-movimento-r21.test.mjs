// «REDUZIR MOVIMENTO» e o `card-aperta` que oscilava (R21-8-01, lote 25).
//
// Com `prefers-reduced-motion: reduce` o `card-aperta` ligava e desligava a cada
// quadro, sem parar, com o card PARADO (a foto e o texto saltando 7–13 px, a barra
// ✕ ↑ ✓ fora da janela em metade dos quadros, mais de 100 layouts por segundo),
// só no Chromium. A causa estava numa linha do bloco de reduced-motion do CSS:
// `transition-duration: 0.01ms` faz de TODA mudança de propriedade de TODO elemento
// uma transição — e 0.01ms não é «sem transição»: a propriedade que muda continua
// valendo o valor de ANTES até o quadro seguinte. A `vigiarBarraDeAcoes` tira o
// `card-aperta`, MEDE a barra e a repõe no mesmo quadro; lendo o `min-height` da
// foto ainda no valor de antes, achava que a barra cabia, tirava a classe, e no
// quadro seguinte a barra saía e a classe voltava.
//
// O que estes testes travam é a CAUSA (o CSS e a premissa dela), não o sintoma: o
// sintoma só se vê num navegador e está medido no `tools/smoke-browser.mjs`
// (bloco «REDUZIR MOVIMENTO»). Guard que lê código se amarra na ESTRUTURA e ignora
// comentário (gotcha #67): o CSS é lido sem os comentários, o bloco de
// reduced-motion é achado casando chaves e não pela distância.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const CSS = ler('css/styles.css');
const APPCSS = ler('css/app.css');

// CSS sem comentário (o CSS deste app não tem `/*` dentro de string nem de url()).
const semComentarioCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
// JS sem comentário, por LINHA: tirar o `//` do meio da linha comeria o resto de
// uma URL (`https://…`) e esconderia ocorrência de verdade.
const semComentarioJs = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// O corpo de TODOS os `@media (prefers-reduced-motion: reduce)` do texto, casando
// chaves (o bloco tem regras dentro, e «até o primeiro `}`» pegaria só a 1ª).
function blocosDeReducedMotion(css) {
  const achados = [];
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let prof = 1;
    let i = re.lastIndex;
    for (; i < css.length && prof > 0; i++) {
      if (css[i] === '{') prof++;
      else if (css[i] === '}') prof--;
    }
    assert.equal(prof, 0, 'o @media de reduced-motion não fecha');
    achados.push(css.slice(re.lastIndex, i - 1));
  }
  return achados;
}

// Os valores de uma propriedade em todas as declarações do trecho, sem o `!important`.
const valores = (trecho, propriedade) =>
  [...trecho.matchAll(new RegExp('(?:^|[;{\\s])' + propriedade + '\\s*:\\s*([^;}]+)', 'g'))]
    .map((m) => m[1].replace(/!important/g, '').trim());

const RM = blocosDeReducedMotion(semComentarioCss(CSS));
const RM_MIN = blocosDeReducedMotion(APPCSS);

test('R21-8-01 · o bloco de reduced-motion existe uma vez só, no fonte e no CSS gerado', () => {
  assert.equal(RM.length, 1, `o styles.css tem ${RM.length} blocos de prefers-reduced-motion: reduce (esperava 1)`);
  assert.equal(RM_MIN.length, 1, `o app.css gerado tem ${RM_MIN.length} blocos de prefers-reduced-motion: reduce (esperava 1) — falta rodar \`npm run css\``);
});

test('R21-8-01 · as TRANSIÇÕES do reduced-motion são 0s: 0.01ms faz a vigia ler o valor de ANTES', () => {
  const bloco = RM[0];
  const universal = /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{([^}]*)\}/.exec(bloco);
  assert.ok(universal, 'a regra universal (`*, *::before, *::after`) sumiu do bloco de reduced-motion');
  assert.deepEqual(valores(universal[1], 'transition-duration'), ['0s'],
    'a regra universal do reduced-motion deixou de fixar `transition-duration: 0s !important` — com 0.01ms a `vigiarBarraDeAcoes` lê o `min-height` ANTIGO e o `card-aperta` oscila a cada quadro com o card parado');
  assert.match(universal[1], /transition-duration:\s*0s\s*!important/, 'sem o !important a utility `transition` do Tailwind (0,1,0) ganha da regra universal (0,0,0)');
  // E NENHUMA duração de transição não nula em lugar nenhum do bloco: a regra
  // universal não adianta se uma regra mais específica a desfaz.
  const duracoes = valores(bloco, 'transition-duration');
  assert.ok(duracoes.length >= 1);
  for (const v of duracoes) assert.equal(v, '0s', `o bloco de reduced-motion tem \`transition-duration: ${v}\` — só 0s é «sem transição»`);
  // O atalho `transition:` também fixa duração: só `none` (ou nada) cabe aqui.
  for (const v of valores(bloco, 'transition')) assert.equal(v, 'none', `o bloco de reduced-motion tem \`transition: ${v}\``);
  // O atraso conta como transição: 0s de duração com atraso > 0 ainda cria uma.
  for (const v of valores(bloco, 'transition-delay')) assert.equal(v, '0s', `\`transition-delay: ${v}\` no reduced-motion ainda cria transição`);
});

test('R21-8-01 · nada no app ATRASA uma transição: com 0s de duração e atraso maior que 0 ela ainda começa', () => {
  // O 0s só vale por inteiro se nenhuma regra do app der atraso: uma transição com
  // duração 0 e `transition-delay` positivo cria a transição do mesmo jeito (e a
  // propriedade segue no valor de ANTES durante o atraso). Hoje o app só escreve
  // duração; esta é a premissa do 0s, lida do código.
  const css = semComentarioCss(CSS);
  assert.deepEqual([...css.matchAll(/transition-delay\s*:\s*([^;}]+)/g)].map((m) => m[1].trim()), [],
    'o styles.css passou a usar `transition-delay`: o `transition-duration: 0s` do reduced-motion não desliga mais essa transição');
  const html = ler('index.src.html');
  const js = readdirSync(new URL('../js/', import.meta.url)).filter((f) => f.endsWith('.js'))
    .map((f) => semComentarioJs(ler('js/' + f))).join('\n');
  assert.deepEqual([...(html + js).matchAll(/(?:^|[\s"'`])(delay-(?:\d|\[)[^\s"'`]*)/g)].map((m) => m[1]), [],
    'uma classe `delay-*` do Tailwind entrou no HTML/JS: com 0s de duração ela ainda cria a transição no reduced-motion');
  assert.doesNotMatch(js, /transitionDelay|transition-delay/, 'o JS escreve um atraso de transição');
  // Os atalhos `transition:` do app listam UM tempo por transição (a duração): um
  // segundo número de tempo seria o atraso.
  for (const m of css.matchAll(/(?:^|[;{\s])transition\s*:\s*([^;}]+)/g)) {
    for (const item of m[1].split(/,(?![^(]*\))/)) {
      const tempos = item.match(/(?:^|\s)-?[\d.]+m?s(?=\s|$)/g) || [];
      assert.ok(tempos.length <= 1, `a transição «${item.trim()}» tem duração E atraso`);
    }
  }
});

test('R21-8-01 · as ANIMAÇÕES continuam em 0.01ms: o app espera o `animationend` (com `none` ele nunca dispara)', () => {
  const universal = /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{([^}]*)\}/.exec(RM[0])[1];
  assert.deepEqual(valores(universal, 'animation-duration'), ['0.01ms'],
    'a `animation-duration: 0.01ms` do reduced-motion mudou: o `animationend` que tira `count-pop`, `pref-highlight` e `conq-alvo` pode deixar de disparar');
  assert.deepEqual(valores(universal, 'animation-iteration-count'), ['1']);
  // A premissa das duas escolhas, lida do código: o app ESPERA `animationend` (então a
  // animação não pode ser `none`) e NÃO espera nenhum evento de transição (então a
  // transição pode ser 0s). Se isto mudar, a escolha de cima precisa ser repensada.
  const codigo = readdirSync(new URL('../js/', import.meta.url)).filter((f) => f.endsWith('.js'))
    .map((f) => [f, semComentarioJs(ler('js/' + f))]);
  const ouvem = (re) => codigo.filter(([, c]) => re.test(c)).map(([f]) => f);
  assert.ok(ouvem(/animationend/).includes('app.js'), 'o app deixou de esperar `animationend`: a `animation-duration: 0.01ms` pode virar `none`, mas decida isso de propósito');
  assert.deepEqual(ouvem(/transitionend|transitionrun|transitionstart|transitioncancel|ontransition/), [],
    'algum arquivo de js/ passou a esperar um evento de TRANSIÇÃO: com `transition-duration: 0s` ele nunca dispara no reduced-motion (a transição nem começa). Troque por um timer, ou reveja o 0s junto da `vigiarBarraDeAcoes`');
});

test('R21-8-01 · o CSS GERADO (o que o app carrega) tem o mesmo 0s — editar o styles.css sem `npm run css` não muda a tela', () => {
  const bloco = RM_MIN[0].replace(/\s+/g, '');
  const universal = /\*,\*::?after,\*::?before\{([^}]*)\}|\*,:after,:before\{([^}]*)\}|\*,\*::?before,\*::?after\{([^}]*)\}/.exec(bloco);
  assert.ok(universal, 'a regra universal do reduced-motion não está no app.css gerado (ou o minificador mudou a forma dela)');
  const corpo = universal[1] || universal[2] || universal[3];
  assert.match(corpo, /transition-duration:0s!important/, 'o app.css gerado não tem `transition-duration:0s!important` no reduced-motion — falta `npm run css`');
  assert.doesNotMatch(corpo, /transition-duration:\.?0*1ms/, 'o app.css gerado ainda tem a transição de 0.01ms no reduced-motion');
  assert.match(corpo, /animation-duration:\.01ms!important/, 'o app.css gerado perdeu a `animation-duration: 0.01ms`');
});
