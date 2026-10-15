// «REDUZIR MOVIMENTO» e o `card-aperta` que oscilava (R21-8-01, lote 25).
//
// Com `prefers-reduced-motion: reduce` o `card-aperta` ligava e desligava a cada
// quadro, sem parar, com o card PARADO (a foto e o texto saltando 7–13 px, a barra
// ✕ ↑ ✓ fora da janela em metade dos quadros, mais de 100 layouts por segundo),
// no Chromium e no WebKit (medido nos dois). A causa estava numa linha do bloco de reduced-motion do CSS:
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

// ═══ A DEFESA: a medida da vigia não depende de transição nenhuma ═══════════════
//
// O 0s acima tira a causa. Esta metade trava o que faz a vigia NÃO DEPENDER dela: a
// `vigiarBarraDeAcoes` e a `vigiarPlacar` tiram uma classe, LEEM o layout e a repõem,
// e a leitura só vale se a troca valer na hora. Enquanto escrevem, elas põem
// `card-medindo` / `placar-medindo` e o CSS desliga as transições de quem a classe muda.
//
// O comportamento é testado num MODELO DE QUADRO com o motor de estilo do Chromium no
// que importa aqui: o estilo é recalculado à força (quem lê `offsetTop`) e no fim de
// cada quadro; uma propriedade que mudou COMEÇA uma transição se o estilo de depois
// tem uma; e a transição de 0.01ms vale o valor de ANTES até o quadro seguinte. O
// MESMO modelo, sem a proteção, reproduz o laço (a barra pintada fora da janela e a
// classe escrita pra sempre): é o que o teste cobra que NÃO aconteça.
const APP = ler('js/app.js');
const SEM = semComentarioJs(APP);

// Fatia a função pela DECLARAÇÃO (nunca por distância, gotcha #67): os parênteses da
// assinatura, depois as chaves do corpo. O fonte já vem sem os comentários de linha.
function fatiar(nome, fonte = SEM) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu do fonte`);
  let par = 0;
  let i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  let prof = 0;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    if (fonte[j] === '{') prof++;
    else if (fonte[j] === '}' && --prof === 0) {
      const corpo = fonte.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} caracteres — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}

// O motor de estilo + o laço de quadros, compartilhados pelos dois modelos.
//  · `valor()`: o que o motor de estilo diz AGORA (`efetivo`), dado o que as classes pedem;
//  · um «recalcular» à força ou no fim do quadro: se o pedido ≠ o efetivo, ou a transição
//    COMEÇA (o efetivo fica, o pedido vira `pendente`) ou, com `semTransicao()`, vale já;
//  · um quadro: (1) a transição de 0.01ms termina, (2) rodam os rAF registrados ANTES
//    dele, (3) estilo e layout do fim do quadro (é ISSO que a tela pinta), (4) o
//    ResizeObserver avisa se o tamanho observado mudou.
function criarQuadros({ classes, pedido, semTransicao, transicoes, tamanho }) {
  const motor = { efetivo: pedido(), pendente: null };
  const rafs = [];
  const observadores = [];
  const pintados = [];
  let visto = tamanho(motor.efetivo);
  const recalcular = () => {
    const alvo = pedido();
    if (alvo === motor.efetivo) { motor.pendente = null; return; }
    if (transicoes && !semTransicao()) motor.pendente = alvo;
    else { motor.efetivo = alvo; motor.pendente = null; }
  };
  const quadro = () => {
    if (motor.pendente !== null) { motor.efetivo = motor.pendente; motor.pendente = null; }
    for (const f of rafs.splice(0)) f();
    recalcular();
    pintados.push(motor.efetivo);
    if (tamanho(motor.efetivo) !== visto) { visto = tamanho(motor.efetivo); for (const o of observadores) o.cb(); }
  };
  class RO { constructor(cb) { this.cb = cb; observadores.push(this); } observe() {} }
  return { motor, recalcular, quadro, RO, requestAnimationFrame: (f) => rafs.push(f), pintados, observadores };
}

// Um `classList` que só registra a escrita que MUDA o conjunto (como o DOM de verdade:
// `toggle('x', false)` sem o `x` não escreve nada).
function classListDe(classes, escritas) {
  const escreve = (c, entra) => {
    if (classes.has(c) === entra) return;
    entra ? classes.add(c) : classes.delete(c);
    escritas.push((entra ? '+' : '-') + c);
  };
  return {
    contains: (c) => classes.has(c),
    add: (c) => escreve(c, true),
    remove: (c) => escreve(c, false),
    toggle: (c, on) => { escreve(c, !!on); return !!on; },
  };
}

// ── o card ──
function montarCardComMotor({ transicoes, fonte = fatiar('vigiarBarraDeAcoes'), folga = { normal: 88, aperta: 0 } } = {}) {
  const classes = new Set();
  const escritas = [];
  // `folga`: quanto a barra passa do corpo sem o `card-aperta` e com ele. O padrão é o caso do
  // iPhone a 1,3× (passa 88 px sem, cabe com); `{ normal: 0, aperta: 0 }` é o card que já cabe.
  const q = criarQuadros({
    classes, transicoes,
    pedido: () => (classes.has('card-aperta') ? 'aperta' : 'normal'),
    semTransicao: () => classes.has('card-medindo'),
    tamanho: (ef) => folga[ef],
  });
  const barra = { offsetHeight: 95, get offsetTop() { q.recalcular(); return 459 + folga[q.motor.efetivo] - 95; } };
  const corpo = { children: [{}, {}, barra], get clientHeight() { return 459; }, querySelector: (s) => (s === '.card-actions' ? barra : null) };
  const card = { isConnected: true, classList: classListDe(classes, escritas), querySelector: (s) => (s === '.card-body' ? corpo : null) };
  const vigiar = new Function('TOLERANCIA_ARREDONDAMENTO_PX', 'requestAnimationFrame', 'ResizeObserver', 'medidasDaBarra',
    fonte + '\nreturn vigiarBarraDeAcoes;')(2, q.requestAnimationFrame, q.RO, new WeakMap());
  // A barra FORA no que a tela pintou: o fim dela passa do corpo por mais que a tolerância.
  const foraNoQuadro = (ef) => folga[ef] > 2;
  return { card, classes, escritas, q, vigiar, foraNoQuadro, folga };
}

// Roda como o app: a vigia ligada, o card no documento, a medida SÍNCRONA numa tarefa
// (fora de qualquer quadro) e depois os quadros. Devolve o que sobrou depois de assentar.
function assentarCard(m, { quadros = 50, assentaEm = 12 } = {}) {
  const medir = m.vigiar(m.card);
  medir();
  for (let i = 0; i < assentaEm; i++) m.q.quadro();
  const escritasAssentado = m.escritas.length;
  for (let i = assentaEm; i < quadros; i++) m.q.quadro();
  return {
    escritasDepois: m.escritas.length - escritasAssentado,
    foraPintado: m.q.pintados.filter(m.foraNoQuadro).length,
    quadrosPintados: m.q.pintados.length,
    ligado: m.classes.has('card-aperta'),
  };
}

test('R21-8-01 · a defesa: COM transição na medida, o card fica quieto e a barra nunca é pintada fora', () => {
  const r = assentarCard(montarCardComMotor({ transicoes: true }));
  assert.equal(r.escritasDepois, 0, 'a vigia segue escrevendo a classe com o card parado — o laço do 0.01ms voltou');
  assert.equal(r.foraPintado, 0, `a barra foi PINTADA fora do corpo em ${r.foraPintado} de ${r.quadrosPintados} quadros`);
  assert.equal(r.ligado, true, 'o card que precisa do aperto terminou sem ele');
});

test('R21-8-01 · o modelo se enxerga: SEM a proteção a mesma vigia reproduz o laço (senão o teste acima é decoração)', () => {
  const sem = fatiar('vigiarBarraDeAcoes').replace(/semTransicao\(\);/g, '');
  const r = assentarCard(montarCardComMotor({ transicoes: true, fonte: sem }));
  assert.ok(r.escritasDepois > 10, `sem a proteção o modelo escreveu a classe só ${r.escritasDepois}× depois de assentar — ele não reproduz o laço`);
  assert.ok(r.foraPintado > 10, `sem a proteção o modelo pintou a barra fora só ${r.foraPintado}× — ele não reproduz o salto`);
  // E o MESMO modelo sem transição nenhuma (o 0s) é quieto com ou sem a proteção: o 0s é a causa tratada.
  for (const fonte of [sem, fatiar('vigiarBarraDeAcoes')]) {
    const quieto = assentarCard(montarCardComMotor({ transicoes: false, fonte }));
    assert.equal(quieto.escritasDepois, 0);
    assert.equal(quieto.foraPintado, 0);
  }
});

test('R21-8-01 · a proteção cobre a escrita FINAL e a medida SÍNCRONA: soltar cedo pinta a barra fora', () => {
  const real = fatiar('vigiarBarraDeAcoes');
  // (a) a 1ª ideia: `card-medindo` só durante a medida, tirado na mesma tarefa. A decisão de VOLTAR
  // o `card-aperta` começa então uma transição a partir do valor de antes, e o quadro seguinte pinta
  // a barra fora. MEDIDO no Chromium com a regra antiga de volta: ~240 escritas em 1,5 s e ~200
  // layouts por segundo, o laço intacto.
  const mesmaTarefa = real.replace(
    /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{\s*protegido = false;\s*card\.classList\.remove\('card-medindo'\);\s*\}\)\);/,
    "protegido = false; card.classList.remove('card-medindo');");
  assert.notEqual(mesmaTarefa, real, 'o instrumento não achou o trecho do release pra sabotar');
  const a = assentarCard(montarCardComMotor({ transicoes: true, fonte: mesmaTarefa }));
  assert.ok(a.foraPintado > 0 && a.escritasDepois > 0, `soltar a proteção na mesma tarefa devia deixar o laço passar (fora ${a.foraPintado}, escritas ${a.escritasDepois}) — o modelo está cego`);
  // (b) UM requestAnimationFrame só: a medida síncrona do `appendChild` roda numa tarefa, e o rAF
  // dela roda ANTES do recálculo do mesmo quadro — a classe sai e a escrita começa uma transição.
  const umSo = real.replace(/requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{/, 'requestAnimationFrame(() => (() => {')
    .replace(/card\.classList\.remove\('card-medindo'\);\s*\}\)\);/, "card.classList.remove('card-medindo');\n        })());");
  assert.notEqual(umSo, real);
  const b = assentarCard(montarCardComMotor({ transicoes: true, fonte: umSo }), { quadros: 4, assentaEm: 0 });
  assert.ok(b.foraPintado > 0, 'com um rAF só o 1º quadro depois da medida síncrona devia pintar a barra fora (e não pintou) — o modelo está cego');
  // E o real, nos mesmos quadros, não pinta.
  const c = assentarCard(montarCardComMotor({ transicoes: true }), { quadros: 4, assentaEm: 0 });
  assert.equal(c.foraPintado, 0, 'o 1º quadro depois da medida síncrona pintou a barra fora do corpo');
});

test('R21-8-01 · a defesa em regime: o card que cabe não escreve NADA, o que não cabe protege UMA vez e solta', () => {
  // Cabendo desde o início (escala 1, janela normal): nenhuma escrita, nem a da proteção.
  const livre = montarCardComMotor({ transicoes: true, folga: { normal: 0, aperta: 0 } });
  livre.vigiar(livre.card)();
  for (let i = 0; i < 20; i++) livre.q.quadro();
  assert.deepEqual(livre.escritas, [], 'com o card cabendo a vigia escreveu no DOM — em regime o custo é zero');
  // O que não cabe: UMA proteção (e UMA saída) por rajada de escritas, não uma por escrita…
  const r = montarCardComMotor({ transicoes: true });
  assentarCard(r);
  const entradas = r.escritas.filter((e) => e === '+card-medindo').length;
  const saidas = r.escritas.filter((e) => e === '-card-medindo').length;
  assert.ok(entradas >= 1 && entradas === saidas, `a proteção entrou ${entradas}× e saiu ${saidas}×`);
  // …e o card termina SEM ela: ficar ligada deixaria as transições da subárvore desligadas pra sempre.
  assert.equal(r.classes.has('card-medindo'), false, 'o card terminou com a proteção ligada');
  assert.equal(r.escritas.slice(-1)[0], '-card-medindo', 'a última escrita da vigia devia ser a saída da proteção');
});

test('R21-8-01 · a defesa: a janela que ENCOLHE com o card já assentado deixa a barra fora UM quadro só (o da própria mudança)', () => {
  // O card cabia (escala 1); a janela encolhe e agora a barra passa 88 px sem o `card-aperta`. O quadro em
  // que o tamanho muda já nasce com a barra fora — isso nenhuma vigia evita —, mas o SEGUINTE tem que
  // pintar o card apertado: a escrita que LIGA a classe também é protegida (sem isso ela começa uma
  // transição a partir do valor de antes e a barra fica fora mais um quadro, e mais um…).
  const m = montarCardComMotor({ transicoes: true, folga: { normal: 0, aperta: 0 } });
  m.vigiar(m.card)();
  for (let i = 0; i < 10; i++) m.q.quadro();
  assert.equal(m.classes.has('card-aperta'), false, 'sanidade: o card que cabe não devia estar apertado');
  m.folga.normal = 88;
  const antes = m.q.pintados.length;
  for (let i = 0; i < 30; i++) m.q.quadro();
  const fora = m.q.pintados.slice(antes).filter(m.foraNoQuadro).length;
  assert.ok(fora <= 1, `a barra foi pintada fora em ${fora} quadros depois que a janela encolheu (só o da própria mudança é inevitável)`);
  assert.equal(m.classes.has('card-aperta'), true, 'o card que deixou de caber não ficou apertado');
});

// ── o placar ──
function montarPlacarComMotor({ transicoes, fonte = fatiar('vigiarPlacar'), alturas = { sem: 600, com: 760 }, rotulo = 90, celula = () => 77 }) {
  const classes = new Set();
  const escritas = [];
  const q = criarQuadros({
    classes, transicoes,
    pedido: () => (classes.has('placar-2x2') ? 'com' : 'sem'),
    semTransicao: () => classes.has('placar-medindo'),
    tamanho: (ef) => alturas[ef],
  });
  // Um rótulo de 90 px numa célula de 77 (o padrão): não cabe em 4 colunas, então a vigia tenta o 2×2.
  // A LARGURA da célula também lê o motor: no 2×2 as células ímpares perdem a borda esquerda (+1 px), e
  // essa borda é uma propriedade que a transição atrasaria como as outras.
  const rotuloEl = { _texto: rotulo, getClientRects: () => [1], get clientWidth() { q.recalcular(); return celula(q.motor.efetivo); } };
  const celulas = [{ children: [{}, rotuloEl] }];
  const grade = { isConnected: true, children: celulas, getClientRects: () => [1], classList: classListDe(classes, escritas) };
  // A altura da pilha é LIDA depois de a classe mudar: é onde a transição do 2×2 (row-gap, bordas) fazia a leitura pegar o valor de antes.
  const pilha = { getBoundingClientRect: () => { q.recalcular(); return { bottom: alturas[q.motor.efetivo] }; } };
  const card = {};
  const medidasDaBarra = new WeakMap();
  medidasDaBarra.set(card, { medir: () => {}, cabe: () => true });
  const document = {
    getElementById: (id) => ({ placarGrid: grade, cardStack: pilha })[id] || null,
    querySelector: () => card,
    createRange: () => { let alvo; return { selectNodeContents: (el) => { alvo = el; }, getBoundingClientRect: () => ({ width: alvo._texto }) }; },
  };
  const vigia = new Function('document', 'TOLERANCIA_ARREDONDAMENTO_PX', 'requestAnimationFrame', 'ResizeObserver', 'innerHeight', 'window', 'medidasDaBarra',
    'let medirOPlacarDeNovo = () => {};\nlet medirOPlacarComOCardNovo = () => {};\n' + fonte + '\nvigiarPlacar();\nreturn () => ({ de: medirOPlacarDeNovo, card: medirOPlacarComOCardNovo });')(
    document, 2, q.requestAnimationFrame, q.RO, 740, { addEventListener: () => {} }, medidasDaBarra);
  return { classes, escritas, q, medidas: vigia(), alturas, rotuloEl, foraNoQuadro: (ef) => alturas[ef] > 740.5,
    // o rótulo passa da célula (a mesma tolerância de 0,5 px da vigia) no que a tela pintou
    coladoNoQuadro: (ef) => rotuloEl._texto > celula(ef) + 0.5 };
}
function rodarPlacar(m, quadros) {
  const antes = m.escritas.length;
  const pintadosAntes = m.q.pintados.length;
  for (let i = 0; i < quadros; i++) m.q.quadro();
  const pintados = m.q.pintados.slice(pintadosAntes);
  return { escritas: m.escritas.length - antes, foraPintado: pintados.filter(m.foraNoQuadro).length, coladoPintado: pintados.filter(m.coladoNoQuadro).length, ligado: m.classes.has('placar-2x2') };
}
function assentarPlacar(m, { quadros = 50, assentaEm = 12 } = {}) {
  m.medidas.de();                         // a tela que aparece: a medida síncrona, numa tarefa
  for (let i = 0; i < assentaEm; i++) m.q.quadro();
  const r = rodarPlacar(m, quadros - assentaEm);
  return { escritasDepois: r.escritas, foraPintado: r.foraPintado, ligado: r.ligado };
}

test('R21-8-01 · o placar: COM transição na medida ele decide certo, fica quieto e nunca pinta a pilha fora da janela', () => {
  // O 2×2 deixa a pilha 20 px fora da janela (760 de 740): a vigia tem que voltar atrás e ficar assim.
  const r = assentarPlacar(montarPlacarComMotor({ transicoes: true }));
  assert.equal(r.ligado, false, 'o 2×2 ficou ligado com a pilha passando da janela — a leitura pegou a altura de ANTES');
  assert.equal(r.escritasDepois, 0, 'a vigia do placar segue escrevendo a classe com o placar parado');
  assert.equal(r.foraPintado, 0, 'a pilha foi pintada passando da janela');
  // E o 2×2 que CABE liga e fica (a defesa não desliga o recurso).
  const cabe = assentarPlacar(montarPlacarComMotor({ transicoes: true, alturas: { sem: 600, com: 700 } }));
  assert.equal(cabe.ligado, true, 'o 2×2 que cabe na janela não ligou');
  assert.equal(cabe.escritasDepois, 0);
  assert.equal(cabe.foraPintado, 0);
});

test('R21-8-01 · o placar: o 2×2 que JÁ está ligado é conferido SEM a classe, com a largura de verdade da célula', () => {
  // Rótulo de 77,2 px: cabe com a borda do 2×2 a menos (célula de 77,5) e NÃO cabe sem ela (76,5 + 0,5 de
  // tolerância = 77). A conferência tira a classe e mede: se a leitura pegar a célula ainda no valor do 2×2, o
  // rótulo «cabe», o 2×2 desliga, e o quadro seguinte traz os rótulos colados de volta.
  const m = montarPlacarComMotor({ transicoes: true, rotulo: 77.2, celula: (ef) => (ef === 'com' ? 77.5 : 76.5), alturas: { sem: 600, com: 700 } });
  assentarPlacar(m);
  assert.equal(m.classes.has('placar-2x2'), true, 'sanidade: o 2×2 devia ter ligado (o rótulo não cabe em 4 colunas)');
  m.q.observadores[0].cb();                // o observer avisa (o texto mudou, a fonte carregou…)
  const conferencia = rodarPlacar(m, 8);   // a conferência tira e repõe a classe: é o que ela faz
  assert.equal(conferencia.ligado, true, 'a conferência desligou o 2×2 lendo a célula ainda no valor do 2×2 — o rótulo cabia só por causa dele');
  const depois = rodarPlacar(m, 30);       // e depois dela o placar assenta
  assert.equal(depois.ligado, true);
  assert.equal(depois.escritas, 0, `o placar seguiu escrevendo a classe ${depois.escritas}× depois da conferência`);
  assert.equal(conferencia.foraPintado + depois.foraPintado, 0);
  assert.equal(conferencia.coladoPintado + depois.coladoPintado, 0, 'a tela pintou os rótulos colados (passando da célula) durante a conferência');
});

test('R21-8-01 · o placar: a troca de idioma (medida SÍNCRONA, numa tarefa) que faz o rótulo não caber decide pela altura de verdade', () => {
  // O rótulo cabia; o idioma muda e o app mede na hora (`aplicarIdioma` → `medirOPlacarDeNovo`), sem um
  // `escrever` já agendado pra socorrer. O 2×2 deixa a pilha fora da janela (760 de 740): tem que voltar
  // atrás NA MEDIDA, e nenhum quadro pode pintar a pilha passando da janela.
  const m = montarPlacarComMotor({ transicoes: true, rotulo: 60 });
  assentarPlacar(m);
  assert.deepEqual(m.escritas, [], 'sanidade: o rótulo cabia e a vigia escreveu');
  m.rotuloEl._texto = 90;
  m.medidas.de();
  const r = rodarPlacar(m, 30);
  assert.equal(r.ligado, false, 'o 2×2 ficou ligado com a pilha fora da janela');
  assert.equal(r.foraPintado, 0, `a pilha foi pintada fora da janela em ${r.foraPintado} quadros depois da troca de idioma`);
});

test('R21-8-01 · o modelo do placar se enxerga: SEM a proteção ele reproduz o laço (o iPhone a 1,8× escrevia 233× em 2 s)', () => {
  const sem = fatiar('vigiarPlacar').replace(/semTransicao\(\);/g, '');
  const r = assentarPlacar(montarPlacarComMotor({ transicoes: true, fonte: sem }));
  assert.ok(r.escritasDepois > 10, `sem a proteção o modelo escreveu a classe só ${r.escritasDepois}× depois de assentar`);
  assert.ok(r.foraPintado > 10, `sem a proteção o modelo pintou a pilha fora só ${r.foraPintado}×`);
  // Sem transição nenhuma (o 0s) o placar é quieto com ou sem a proteção.
  for (const fonte of [sem, fatiar('vigiarPlacar')]) {
    const quieto = assentarPlacar(montarPlacarComMotor({ transicoes: false, fonte }));
    assert.equal(quieto.escritasDepois, 0);
    assert.equal(quieto.foraPintado, 0);
  }
});

test('R21-8-01 · o placar em regime: rótulo que cabe não escreve NADA, e a proteção sai quando a vigia termina', () => {
  // Rótulo de 60 px numa célula de 77: cabe, a classe nunca liga e a vigia não escreve nem a proteção.
  const cabe = montarPlacarComMotor({ transicoes: true, rotulo: 60 });
  assentarPlacar(cabe);
  assert.deepEqual(cabe.escritas, [], 'com o rótulo cabendo a vigia do placar escreveu no DOM — em regime o custo é zero');
  // Rótulo que não cabe: a proteção entra com a 1ª escrita e sai no fim, e a última escrita é a saída.
  const r = montarPlacarComMotor({ transicoes: true });
  assentarPlacar(r);
  assert.ok(r.escritas.includes('+placar-medindo'), 'a vigia do placar escreveu a classe sem proteger');
  assert.equal(r.classes.has('placar-medindo'), false, 'o placar terminou com a proteção ligada');
  assert.equal(r.escritas.slice(-1)[0], '-placar-medindo', 'a última escrita da vigia do placar devia ser a saída da proteção');
});
// Os seletores de uma regra, separados por vírgula FORA de parênteses (`:not(a, b)` não parte).
function dividirSeletores(texto) {
  const saida = [];
  let prof = 0;
  let atual = '';
  for (const ch of texto) {
    if (ch === '(') prof++;
    if (ch === ')') prof--;
    if (ch === ',' && prof === 0) { saida.push(atual.trim().replace(/\s+/g, ' ')); atual = ''; } else atual += ch;
  }
  saida.push(atual.trim().replace(/\s+/g, ' '));
  return saida.filter(Boolean);
}
// As regras «chata» do CSS (sem aninhar chaves): [{ seletores, corpo }]. As de dentro de um
// `@media`/`@container` entram também, que é o que se quer: o `card-aperta` tem uma no degrau deitado.
const regrasDe = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ seletores: dividirSeletores(m[1]), corpo: m[2] }));
// O seletor sem as pseudo-classes funcionais (`:not(...)`, `:has(...)`) e sem as simples (`:nth-child(odd)` fica de fora também).
function semPseudos(seletor) {
  let saida = '';
  let prof = 0;
  for (const ch of seletor) {
    if (ch === '(') { prof++; continue; }
    if (ch === ')') { prof--; continue; }
    if (prof === 0) saida += ch;
  }
  return saida.replace(/:[a-z-]+/g, '');
}

test('R21-8-01 · JS e CSS falam da MESMA classe: `card-medindo` e `placar-medindo` desligam a transição de quem a classe muda (o card em si não)', () => {
  assert.match(fatiar('vigiarBarraDeAcoes'), /classList\.add\('card-medindo'\)/, 'a vigia da barra não usa `card-medindo`');
  assert.match(fatiar('vigiarPlacar'), /classList\.add\('placar-medindo'\)/, 'a vigia do placar não usa `placar-medindo`');
  for (const [nome, css] of [['styles.css', semComentarioCss(CSS)], ['app.css gerado', APPCSS]]) {
    const protecao = regrasDe(css).filter((r) => r.seletores.some((x) => x.includes('card-medindo') || x.includes('placar-medindo')));
    assert.equal(protecao.length, 1, `${nome}: esperava UMA regra de proteção, achei ${protecao.length}`);
    const { seletores, corpo } = protecao[0];
    assert.match(corpo.replace(/\s+/g, ''), /^transition:none!important;?$/, `${nome}: a proteção não é só \`transition: none !important\` (${corpo.trim()})`);
    const normal = seletores.map((x) => x.replace(/\s*>\s*/g, ' > '));
    for (const esperado of ['.place-card.card-medindo .card-photo', '.place-card.card-medindo .card-content', '#placarGrid.placar-medindo', '#placarGrid.placar-medindo > *']) {
      assert.ok(normal.includes(esperado), `${nome}: a proteção não alcança \`${esperado}\``);
    }
    // O card em si fica de fora: a saída do swipe é uma transição de `transform` escrita INLINE nele.
    assert.ok(!normal.includes('.place-card.card-medindo') && !normal.some((x) => /^\.place-card\.card-medindo\s*(::|:|$)/.test(x)),
      `${nome}: a proteção alcança o PRÓPRIO card — a vigia cancelaria a saída do swipe se rodasse no meio dela`);
  }
});

test('R21-8-01 · todo ALVO de um `card-aperta` e de um `placar-2x2` está na lista que a proteção desliga', () => {
  // A proteção lista os elementos que as duas classes MUDAM (em vez de `*`, que custava +20 a +35 ms por card
  // no celular de texto grande). Regra nova de `card-aperta`/`placar-2x2` com um alvo que ficou de fora volta a
  // ser uma propriedade que a vigia lê com a transição valendo — sem erro nenhum, só o laço de volta.
  const css = semComentarioCss(CSS);
  const todas = regrasDe(css).flatMap((r) => r.seletores);
  // card: o último composto depois de `.card-aperta` (as classes dele)
  const alvosDoCard = new Set();
  for (const sel of todas.filter((x) => x.includes('.card-aperta'))) {
    const depois = semPseudos(sel.slice(sel.indexOf('.card-aperta') + '.card-aperta'.length)).trim();
    assert.ok(depois, `a regra \`${sel}\` muda o PRÓPRIO card — a proteção não o alcança de propósito (a saída do swipe é inline nele)`);
    const ultimo = depois.split(/\s*[>+~]\s*|\s+/).filter(Boolean).pop();
    for (const c of ultimo.match(/\.[\w-]+/g) || []) alvosDoCard.add(c.slice(1));
  }
  assert.ok(alvosDoCard.size >= 2, 'o guard não achou os alvos do card-aperta — o instrumento quebrou');
  const protecao = regrasDe(css).find((r) => r.seletores.some((x) => x.includes('card-medindo')));
  const protegidos = new Set(protecao.seletores.filter((x) => x.startsWith('.place-card.card-medindo ')).flatMap((x) => (x.match(/\.[\w-]+/g) || []).map((c) => c.slice(1))));
  for (const alvo of alvosDoCard) {
    assert.ok(protegidos.has(alvo), `\`.card-aperta\` muda \`.${alvo}\` e a proteção \`card-medindo\` não o lista — acrescente \`.place-card.card-medindo .${alvo}\` à regra de proteção do styles.css`);
  }
  // placar: a raiz, os filhos diretos (as células) — o que for mais fundo a proteção não alcança
  const raiz = []; const filhos = []; const fundo = [];
  for (const sel of todas.filter((x) => /#placarGrid\.placar-2x2/.test(x))) {
    const depois = semPseudos(sel.slice(sel.indexOf('.placar-2x2') + '.placar-2x2'.length)).trim();
    // (`> :nth-child(odd)` sobra como `>` depois de tirar a pseudo-classe: é uma célula, filha direta.)
    if (!depois) raiz.push(sel); else if (/^>\s*[\w.#-]*$/.test(depois)) filhos.push(sel); else fundo.push(sel);
  }
  assert.ok(raiz.length >= 1 && filhos.length >= 1, 'o guard não achou os alvos do placar-2x2 — o instrumento quebrou');
  assert.deepEqual(fundo, [], `\`placar-2x2\` agora muda algo mais FUNDO que as células (${fundo.join(' | ')}): a proteção \`placar-medindo\` só alcança a grade e as células — estenda a regra`);
  const placar = protecao.seletores.map((x) => x.replace(/\s*>\s*/g, ' > '));
  assert.ok(placar.includes('#placarGrid.placar-medindo') && placar.includes('#placarGrid.placar-medindo > *'));
});
