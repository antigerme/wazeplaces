// Auditoria de layout — trava as defesas contra o bug que NENHUM teste de
// estouro horizontal pega (gotcha #25): rótulo que transborda a própria célula
// e invade a vizinha. O documento não cresce, `scrollWidth` continua igual ao
// `clientWidth`, e mesmo assim os textos se sobrepõem na tela do celular.
//
// A prova de verdade é medir caixa contra caixa num browser (foi assim que o
// bug apareceu, com Playwright em 23 aparelhos × 3 idiomas). Isso não cabe no
// CI, que roda `node --test` sem dependência nenhuma — então o que fica aqui é
// a rede estrutural: se alguém remover o degrau responsivo dos rótulos ou a
// regra de 2 colunas, o CI reclama antes de o layout quebrar em produção
// (silenciosamente, como quebrou da primeira vez).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const HTML = read('index.html');
const CSS = read('css/styles.css');
// Comentário que explica uma regra proibida contém o texto da regra proibida.
// Sem descomentar, o guard acusa a própria documentação.
const CSS_SEM_COMENTARIO = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

const ROTULOS = ['stats.read', 'stats.rejected', 'stats.skipped', 'stats.pending'];

// As chaves `stats.*` aparecem DUAS vezes no HTML: no grid do topo e no
// cabeçalho da aba Histórico. Só o grid do topo tem o problema de largura de
// coluna, então tudo aqui olha apenas o bloco do #statsGrid.
function blocoDoGrid() {
  const linhas = HTML.split('\n');
  const i = linhas.findIndex((l) => l.includes('id="statsGrid"'));
  assert.notEqual(i, -1, 'o grid de stats perdeu o id="statsGrid"');
  // O grid tem 4 células de ~4 linhas; 30 linhas cobrem com folga e param
  // muito antes de chegar na aba Histórico.
  return linhas.slice(i, i + 30);
}

test('os 4 rótulos do grid de stats existem', () => {
  const bloco = blocoDoGrid();
  for (const chave of ROTULOS) {
    assert.ok(
      bloco.some((l) => l.includes(`data-i18n="${chave}"`)),
      `rótulo ${chave} sumiu do #statsGrid`
    );
  }
});

test('rótulo de stats: 11px em rem e tracking só a partir de sm', () => {
  // "RECHAZADOS" (es) é a string mais larga e decide o layout. Em
  // 11px+tracking-wider ela mede 82px, e a coluna só chega lá num aparelho de
  // 390px — então o tracking fica de `sm` pra cima. Sem ele, medido, sobram
  // 5px de folga até em 360px.
  const bloco = blocoDoGrid();
  for (const chave of ROTULOS) {
    const linha = bloco.find((l) => l.includes(`data-i18n="${chave}"`));
    assert.ok(linha, `linha do rótulo ${chave} não encontrada no #statsGrid`);
    assert.match(linha, /tracking-normal/, `${chave}: falta zerar o tracking em tela pequena`);
    assert.match(linha, /sm:tracking-wider/, `${chave}: falta o degrau sm:tracking-wider`);
    assert.doesNotMatch(
      linha,
      /(?<!sm:)\btracking-wider\b/,
      `${chave}: tracking-wider sem prefixo sm: volta a colidir abaixo de 390px`
    );
  }
});

test('nenhum texto abaixo de 11px, e em rem pra acompanhar a fonte do sistema', () => {
  // Piso do M3 (label-small 11sp) e do HIG (caption 11pt). E o tamanho vai em
  // `rem`: em `px` o texto ignora a preferência de fonte do usuário — o
  // Dynamic Type do HIG simplesmente não funciona.
  for (const arquivo of ['index.html', 'js/i18n.js', 'js/app.js']) {
    const px = [...read(arquivo).matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => m[1]);
    assert.deepEqual(px, [], `${arquivo}: tamanho de texto em px (${px.join(', ')}) — use rem`);
  }
  const rems = [...HTML.matchAll(/text-\[([\d.]+)rem\]/g)].map((m) => parseFloat(m[1]));
  for (const r of rems) {
    assert.ok(r * 16 >= 11 - 0.01, `text-[${r}rem] = ${r * 16}px, abaixo do piso de 11px`);
  }
});

// Sem isto, cada teste que usa a media query morreria com um TypeError de
// `null[0]` em vez de dizer o que quebrou.
function mediaQueryEstreita() {
  const m = CSS.match(/@media \(max-width: 359\.98px\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'sumiu a media query de 359.98px que faz o 2×2 do grid de stats');
  return m[0];
}

test('grid de stats vira 2 colunas abaixo de 360px', () => {
  assert.match(HTML, /id="statsGrid"/, 'o grid de stats perdeu o id que a regra de CSS usa');
  const bloco = mediaQueryEstreita();
  assert.match(bloco, /#statsGrid/, 'a media query não mira mais o #statsGrid');
  assert.match(bloco, /grid-template-columns:\s*repeat\(2,/, 'a media query não põe 2 colunas');
  // `divide-x` põe borda à esquerda de todo filho a partir do 2º; em 2 colunas
  // isso deixa um risco solto na borda esquerda da 2ª fileira.
  assert.match(bloco, /nth-child\(odd\)/, 'falta tirar a borda esquerda dos ímpares no 2×2');
  assert.match(bloco, /nth-child\(n \+ 3\)/, 'falta a divisória horizontal entre as fileiras');
});

test('regra que precisa vencer utility do Tailwind tem especificidade pra isso', () => {
  // O styles.css carrega ANTES do tailwind.css. Empate de especificidade →
  // vence o Tailwind. Isso já mordeu três vezes, sempre em silêncio:
  //   · `.modal-root { padding-bottom }`  perdeu pro `p-4`
  //   · `.auth-opt-pair { color: #fff }`  perdeu pro `text-slate-700`
  //   · `.auth-opt-upload { background }` perdeu pro `bg-gradient-to-r`
  // Seletor de UMA classe só nunca vence uma utility. Aqui a regra é: quem
  // sobrescreve utility precisa de pelo menos duas classes no seletor.
  const i = CSS_SEM_COMENTARIO.indexOf('@media (pointer: coarse)');
  assert.notEqual(i, -1, 'sumiu o bloco @media (pointer: coarse) da tela de entrada');
  // Contagem de chaves: regex de "fim do bloco" quebra com indentação.
  let nivel = 0, fim = i;
  for (let k = CSS_SEM_COMENTARIO.indexOf('{', i); k < CSS_SEM_COMENTARIO.length; k++) {
    if (CSS_SEM_COMENTARIO[k] === '{') nivel++;
    else if (CSS_SEM_COMENTARIO[k] === '}' && --nivel === 0) { fim = k; break; }
  }
  const bloco = CSS_SEM_COMENTARIO.slice(i, fim);
  // Só as propriedades que uma utility do Tailwind também escreve. `order`, por
  // exemplo, não é disputado aqui — cobrar duas classes dele seria ruído.
  const DISPUTADAS = /(^|;)\s*(color|background-color|background-image|padding[a-z-]*|margin[a-z-]*|border-color)\s*:/;
  for (const m of bloco.matchAll(/([^{};]+)\{([^}]*)\}/g)) {
    if (!DISPUTADAS.test(';' + m[2])) continue;
    for (const parte of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      const classes = (parte.match(/\./g) || []).length;
      assert.ok(classes >= 2,
        `"${parte}" tem ${classes} classe(s) e escreve propriedade que o Tailwind também escreve: ` +
        `empata em especificidade e PERDE por ordem de carga`);
    }
  }
});

test('o teclado virtual não pode voltar a engolir os modais', () => {
  // Três camadas, e cada uma sozinha deixa buraco: o <meta> resolve nos
  // navegadores que o implementam, o --kb-inset cobre o resto, e o teto de
  // altura garante que modal alto role em vez de vazar. Ver "Regra de ouro de
  // interface" no CLAUDE.md — foi assim que o modal do código ficou atrás do
  // teclado no celular do owner.
  const meta = HTML.match(/<meta name="viewport"[^>]*>/);
  assert.ok(meta, 'sumiu o <meta viewport>');
  assert.match(meta[0], /interactive-widget=resizes-content/, 'o viewport não encolhe mais com o teclado');
  assert.doesNotMatch(meta[0], /user-scalable=no|maximum-scale/, 'zoom bloqueado quebra WCAG 1.4.4');
  // O padding que sobe o modal precisa ser utility (`pb-*`), não regra em
  // styles.css: como regra ele empata com o `p-4` do Tailwind e PERDE, porque
  // o tailwind.css carrega depois. Já medi isso acontecendo — o padding ficava
  // em 16px com o teclado aberto e a defesa era decorativa.
  assert.doesNotMatch(
    CSS_SEM_COMENTARIO,
    /\.modal-root\s*\{[^}]*padding-bottom/,
    'o padding do teclado voltou pro styles.css, onde perde pro p-4 do Tailwind'
  );
  const JS = read('js/app.js');
  assert.match(JS, /visualViewport/, 'sumiu a medição do teclado pelo visualViewport');
  assert.match(JS, /--kb-inset/, 'ninguém mais escreve o --kb-inset');
  // Todo modal do MODAL_IDS precisa da classe, senão fica de fora da defesa.
  const ids = (JS.match(/MODAL_IDS\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
  const modais = [...ids.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(modais.length >= 8, `esperava >= 8 modais em MODAL_IDS, achei ${modais.length}`);
  const linhas = HTML.split('\n');
  for (const id of modais) {
    const i = linhas.findIndex((l) => l.includes(`id="${id}"`));
    assert.notEqual(i, -1, `modal ${id} não achado no HTML`);
    // O scrim (raiz) sobe com o teclado; o teto de altura fica no CARD, que é
    // o filho — checar tudo na mesma linha deixaria o teto passar batido.
    assert.match(linhas[i], /modal-root/, `modal ${id} sem .modal-root — fica fora da defesa do teclado`);
    assert.match(linhas[i], /pb-\[calc\(1rem\+var\(--kb-inset,0px\)\)\]/, `modal ${id} não sobe com o teclado`);
    assert.match(linhas[i + 1], /max-h-\[calc\([^\]]*--kb-inset/, `modal ${id} sem teto de altura que desconte o teclado`);
  }
});

test('não oferecemos ação impossível no aparelho', () => {
  const JS = read('js/app.js');
  // Extensão da Chrome Web Store não instala em navegador de celular.
  assert.match(CSS, /\.sem-extensao \.auth-opt-ext\s*\{[^}]*display:\s*none/, 'o card da extensão voltou a aparecer no celular');
  assert.match(JS, /function podeInstalarExtensao/, 'sumiu a detecção de suporte a extensão');
  // Por SO, não por ponteiro: notebook com tela de toque instala extensão.
  assert.match(JS, /userAgentData|Android\|iPhone/, 'a detecção deixou de olhar o sistema');
  assert.doesNotMatch(
    CSS.match(/@media \(pointer: coarse\)[\s\S]*?\n\}\n\}/m)?.[0] || '',
    /\.auth-opt-ext\s*\{[^}]*display:\s*none/,
    'esconder a extensão por pointer:coarse tira a opção de quem tem notebook com toque'
  );
});

test('o convite de instalação do PWA é nosso, não a barra do navegador', () => {
  const JS = read('js/app.js');
  // Sem preventDefault o Chrome mostra barra fixa no rodapé, tapando conteúdo.
  const fn = JS.match(/window\.addEventListener\('beforeinstallprompt'[\s\S]*?\}\);/);
  assert.ok(fn, 'ninguém mais escuta beforeinstallprompt');
  assert.match(fn[0], /preventDefault\(\)/, 'a barra nativa do Chrome voltou a aparecer sozinha');
  assert.match(HTML, /id="installAppBtn"/, 'sumiu o botão de instalar da Ajuda');
  const linha = HTML.split('\n').find((l) => l.includes('id="installAppBtn"'));
  assert.match(linha, /\bhidden\b/, 'o botão precisa nascer oculto — só aparece se der pra instalar');
});

test('o countdown do dev mode não volta a ser toast', () => {
  // O toast é bottom-center em z-[70] com pointer-events-auto, e a versão fica
  // no fim do modal de Ajuda: o countdown por toast cobria o próprio alvo, então
  // do 5º toque em diante o clique ia pro toast e os 3 últimos nunca chegavam —
  // dev mode impossível de desbloquear, em qualquer aparelho (gotcha #26).
  // Isso é oclusão, que só um browser mede de verdade; o que dá pra travar aqui
  // é a decisão: countdown inline, nunca toast.
  assert.match(HTML, /id="devTapHint"/, 'sumiu o #devTapHint onde o countdown aparece');
  const JS = read('js/app.js');
  const fn = JS.match(/function setupDevModeTapTrigger[\s\S]*?\n\}/);
  assert.ok(fn, 'setupDevModeTapTrigger sumiu do app.js');
  assert.match(fn[0], /devTapHint/, 'o countdown não escreve mais no #devTapHint');
  assert.match(fn[0], /toast\.devCountdown/, 'sumiu a string do countdown');
  // O toast de conquista PODE ficar: aí já desbloqueou, não há mais toque a receber.
  const trecho = fn[0].slice(fn[0].indexOf('devCountdown') - 400, fn[0].indexOf('devCountdown'));
  assert.doesNotMatch(trecho, /showToast/, 'o countdown voltou a ser toast — volta a tapar o próprio alvo');
});

test('as divisórias do grid continuam vindo do Tailwind (dark herda a cor)', () => {
  // A borda de cima do 2×2 não declara cor: herda o `border-color` que o
  // `divide-slate-*` / `dark:divide-*` já põem. Se alguém trocar por uma cor
  // fixa no CSS, o dark mode passa a mentir (gotcha #23).
  const linha = HTML.split('\n').find((l) => l.includes('id="statsGrid"'));
  assert.match(linha, /divide-x/, 'o #statsGrid perdeu o divide-x');
  assert.match(linha, /dark:divide-/, 'o #statsGrid perdeu a cor de divisória do dark mode');
  assert.doesNotMatch(
    mediaQueryEstreita(),
    /border-(top|left)-color/,
    'a media query fixou cor de borda — deixa o dark herdar'
  );
});
