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
// coluna, então tudo aqui olha apenas o bloco do #placarGrid.
function blocoDoGrid() {
  const linhas = HTML.split('\n');
  const i = linhas.findIndex((l) => l.includes('id="placarGrid"'));
  assert.notEqual(i, -1, 'o grid de stats perdeu o id="placarGrid"');
  // O grid tem 4 células de ~4 linhas; 30 linhas cobrem com folga e param
  // muito antes de chegar na aba Histórico.
  return linhas.slice(i, i + 30);
}

test('os 4 rótulos do grid de stats existem', () => {
  const bloco = blocoDoGrid();
  for (const chave of ROTULOS) {
    assert.ok(
      bloco.some((l) => l.includes(`data-i18n="${chave}"`)),
      `rótulo ${chave} sumiu do #placarGrid`
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
    assert.ok(linha, `linha do rótulo ${chave} não encontrada no #placarGrid`);
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
  assert.match(HTML, /id="placarGrid"/, 'o grid de stats perdeu o id que a regra de CSS usa');
  const bloco = mediaQueryEstreita();
  assert.match(bloco, /#placarGrid/, 'a media query não mira mais o #placarGrid');
  assert.match(bloco, /grid-template-columns:\s*repeat\(2,/, 'a media query não põe 2 colunas');
  // `divide-x` põe borda à esquerda de todo filho a partir do 2º; em 2 colunas
  // isso deixa um risco solto na borda esquerda da 2ª fileira.
  assert.match(bloco, /nth-child\(odd\)/, 'falta tirar a borda esquerda dos ímpares no 2×2');
  assert.match(bloco, /nth-child\(n \+ 3\)/, 'falta a divisória horizontal entre as fileiras');
});

// (a, b, c) do seletor. `:not()`/`:is()` não somam por si — só o conteúdo.
function especificidade(sel) {
  const s = sel.replace(/::?(not|is)\(/g, '(').replace(/::[\w-]+/g, ' ELEM ');
  const a = (s.match(/#[\w-]+/g) || []).length;
  const b = (s.match(/\.[\w-]+/g) || []).length +
            (s.match(/\[[^\]]*\]/g) || []).length +
            (s.match(/:[\w-]+/g) || []).length;
  const c = (s.replace(/[#.][\w-]+|\[[^\]]*\]|:[\w-]+/g, ' ').match(/[a-zA-Z][\w-]*/g) || []).length;
  return [a, b, c];
}
// Utility do Tailwind é sempre (0,1,0). Empate PERDE, porque o tailwind.css
// carrega depois — então precisa ser estritamente maior.
const venceUtility = ([a, b, c]) => a > 0 || b > 1 || (b === 1 && c > 0);

// Corpo de cada bloco @media cujo prefixo bate, já sem o invólucro `@media (…) {`.
function corposDeMedia(prefixo) {
  const blocos = [];
  let de = 0;
  for (;;) {
    const i = CSS_SEM_COMENTARIO.indexOf(prefixo, de);
    if (i === -1) break;
    let nivel = 0, fim = i;
    for (let k = CSS_SEM_COMENTARIO.indexOf('{', i); k < CSS_SEM_COMENTARIO.length; k++) {
      if (CSS_SEM_COMENTARIO[k] === '{') nivel++;
      else if (CSS_SEM_COMENTARIO[k] === '}' && --nivel === 0) { fim = k; break; }
    }
    // Cortar o invólucro é obrigatório: sem isso o regex de regras trata o
    // próprio media query como seletor, o corpo capturado não casa a lista de
    // propriedades e o guard pula TUDO em silêncio — foi assim que ele deixou
    // passar o `.auth-precondicao` que motivou este teste.
    const cru = CSS_SEM_COMENTARIO.slice(i, fim);
    blocos.push(cru.slice(cru.indexOf('{') + 1));
    de = fim;
  }
  return blocos;
}

test('regra que precisa vencer utility do Tailwind tem especificidade pra isso', () => {
  // O styles.css carrega ANTES do tailwind.css. Empate de especificidade →
  // vence o Tailwind. Isso já mordeu QUATRO vezes, sempre em silêncio:
  //   · `.modal-root { padding-bottom }`   perdeu pro `p-4`
  //   · `.auth-opt-pair { color: #fff }`   perdeu pro `text-slate-700`
  //   · `.auth-opt-upload { background }`  perdeu pro `bg-gradient-to-r`
  //   · `.auth-precondicao { display }`    perdeu pro `hidden`
  //
  // A regra NÃO é "duas classes": um `#id` vence utility sozinho, e
  // `body > main.container` também (0,1,2). O que vale é passar de (0,1,0).
  //
  // E varre TODOS os blocos de cada prefixo — quando eu abri um segundo bloco
  // `pointer: coarse`, a versão antiga deste teste só olhava o primeiro e
  // deixou o bug passar.
  const DISPUTADAS = new RegExp('(^|;)\\s*(' + [
    'display', 'color', 'background-color', 'background-image', 'border-color',
    'padding[a-z-]*', 'margin[a-z-]*', 'gap', 'row-gap', 'column-gap',
    'min-height', 'max-height', 'min-width', 'max-width', 'height', 'width',
    'font-size', 'grid-column', 'grid-row', 'grid-template-columns',
  ].join('|') + ')\\s*:');
  const PREFIXOS = [
    '@media (pointer: coarse)',
    '@media (max-height: 700px)',
    '@media (max-height: 480px) and (min-width: 600px)',
  ];
  for (const prefixo of PREFIXOS) {
    const blocos = corposDeMedia(prefixo);
    assert.ok(blocos.length >= 1, `sumiu o bloco ${prefixo} do styles.css`);
    for (const bloco of blocos) {
      for (const m of bloco.matchAll(/([^{};]+)\{([^}]*)\}/g)) {
        if (!DISPUTADAS.test(';' + m[2])) continue;
        for (const parte of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
          const e = especificidade(parte);
          assert.ok(venceUtility(e),
            `"${parte}" tem especificidade (${e.join(',')}) e escreve propriedade que o Tailwind ` +
            `também escreve: não passa de (0,1,0) e PERDE por ordem de carga`);
        }
      }
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
  const linha = HTML.split('\n').find((l) => l.includes('id="placarGrid"'));
  assert.match(linha, /divide-x/, 'o #placarGrid perdeu o divide-x');
  assert.match(linha, /dark:divide-/, 'o #placarGrid perdeu a cor de divisória do dark mode');
  assert.doesNotMatch(
    mediaQueryEstreita(),
    /border-(top|left)-color/,
    'a media query fixou cor de borda — deixa o dark herdar'
  );
});

test('a foto do card absorve a variação de altura, o texto não vira vão', () => {
  // O card tem altura fixa e o conteúdo varia (um "Novo Local" curto × um
  // UPDATE com 4 mudanças). Quando a FOTO era fixa em h-52, a sobra ia toda pro
  // texto e virava um vão morto embaixo — 113px num Pixel 7. E no sentido
  // contrário, num iPhone SE, faltavam 29px: a linha do CRIADOR ficava cortada
  // pelo overflow-hidden do card, com `overflow-y: visible` e sem rolagem
  // possível. Mesma raiz nos dois: quem tem que ceder é a foto.
  const linhas = HTML.split('\n');
  const foto = linhas.find((l) => l.includes('card-photo'));
  assert.ok(foto, 'sumiu o container da foto (.card-photo)');
  assert.match(foto, /flex-auto/, 'a foto voltou a ter altura fixa — a sobra vira vão de novo');
  assert.match(foto, /min-h-\[/, 'a foto precisa de um piso, senão some em conteúdo longo');
  assert.match(foto, /max-h-\[/, 'a foto precisa de um teto, senão engole o texto');
  assert.doesNotMatch(foto, /\bh-52\b/, 'altura fixa de volta na foto');

  const conteudo = linhas.find((l) => l.includes('card-content dark:'));
  assert.ok(conteudo, 'sumiu a área de texto do card');
  assert.match(conteudo, /overflow-y-auto/, 'sem rolagem, o texto que não couber é cortado sem saída');
  assert.doesNotMatch(conteudo, /\bflex-1\b/, 'flex-1 no texto faz ele receber a sobra e virar vão');
});

test('rolagem dentro do card não rouba o gesto nem deixa o card preso', () => {
  const CSS_ = read('css/styles.css');
  const SWIPE = read('js/swipe.js');
  const APP_ = read('js/app.js');
  // `pan-y` só quando o texto REALMENTE não coube: senão o arraste vertical
  // pararia de "pular" no card inteiro, que é a maioria dos casos.
  assert.match(CSS_, /\.card-content-rola/, 'sumiu a classe que libera a rolagem só quando precisa');
  assert.match(APP_, /card-content-rola/, 'ninguém mais liga/desliga a classe por card');
  // O browser assumir o gesto dispara touchcancel; sem tratar, o card fica
  // preso torto e os listeners de document vazam.
  assert.match(SWIPE, /touchcancel/, 'touchcancel sem tratamento deixa o card preso no meio do arraste');
  assert.match(SWIPE, /function handleDragCancel/, 'sumiu o cancelamento limpo do arraste');
});

// O <template> do card, isolado — os testes abaixo só falam dele.
function templateDoCard() {
  const m = HTML.match(/<template id="cardTemplate">[\s\S]*?<\/template>/);
  assert.ok(m, 'sumiu o <template id="cardTemplate">');
  return m[0];
}

test('toda área rolável do card está fora do alcance do arraste', () => {
  // Esta é a pergunta que o owner fez e que este arquivo existe pra responder:
  // "como a pessoa rola, se puxar pra cima PULA o card?". A resposta só se
  // sustenta enquanto TODA área rolável estiver na lista de exceção do
  // handleDragStart. Área rolável nova que esqueça a lista volta a criar o
  // conflito — e em silêncio: o texto simplesmente não rola no celular.
  const SWIPE = read('js/swipe.js');
  const ignora = SWIPE.match(/e\.target\.closest\('([^']+)'\)/);
  assert.ok(ignora, 'sumiu a lista de exceção do handleDragStart');

  const roláveis = new Set();
  for (const m of templateDoCard().matchAll(/class="([^"]*overflow-y-auto[^"]*)"/g)) {
    const nome = m[1].split(/\s+/).find((c) => c.startsWith('card-'));
    assert.ok(nome, `área rolável sem classe card-*: ${m[1].slice(0, 60)}`);
    roláveis.add(nome);
  }
  assert.ok(roláveis.size >= 3, `esperava ao menos 3 áreas roláveis mapeadas, achei ${[...roláveis]}`);

  for (const nome of roláveis) {
    // `.card-content` é a ÚNICA exceção, e de propósito: ela é a rede de
    // segurança que só rola quando nada mais coube, e aí quem cede o gesto é o
    // `touch-action: pan-y` do `.card-content-rola`.
    if (nome === 'card-content') continue;
    assert.ok(ignora[1].includes('.' + nome),
      `.${nome} rola mas não está na exceção do swipe.js — o arraste vai engolir a rolagem`);
  }
});

test('o card tem UMA área rolável de verdade, e ela cresce com o espaço', () => {
  // Antes: o card inteiro rolava (escondendo até 423px, medido em 25 de 32
  // combinações de aparelho × tipo de pedido) E a lista de mudanças rolava
  // dentro dele — duas rolagens aninhadas numa superfície de swipe. Pior: o
  // `touch-action: pan-y` da rolagem de fora matava o gesto de "pular" em
  // quase todo card de UPDATE e de reporte.
  //
  // O desenho que resolve: tudo de altura previsível é `flex-shrink-0` e o
  // bloco longo (mudanças OU reporte — nunca os dois no mesmo pedido) leva
  // `flex-1 min-h-0`, absorvendo a sobra e rolando por dentro.
  const bloco = templateDoCard();
  const linhas = bloco.split('\n');
  const linhaDe = (cls) => {
    const l = linhas.find((x) => new RegExp(`class="[^"]*\\b${cls}\\b`).test(x));
    assert.ok(l, `sumiu o .${cls} do card`);
    return l;
  };

  for (const caixa of ['card-changes', 'card-flag-comment']) {
    const l = linhaDe(caixa);
    assert.match(l, /\bflex-1\b/, `.${caixa} precisa de flex-1 pra absorver a sobra`);
    assert.match(l, /\bmin-h-0\b/, `.${caixa} sem min-h-0 não encolhe — o conteúdo estoura o card`);
    assert.match(l, /\bflex-col\b/, `.${caixa} precisa ser coluna flex pro corpo dela poder rolar`);
    assert.doesNotMatch(l, /\bmax-h-/, `.${caixa} com teto fixo volta a empurrar a rolagem pro card inteiro`);
  }
  for (const corpo of ['card-changes-list', 'card-flag-comment-text']) {
    const l = linhaDe(corpo);
    assert.match(l, /\bflex-1\b/, `.${corpo} precisa de flex-1 pra ocupar a caixa`);
    assert.match(l, /\bmin-h-0\b/, `.${corpo} sem min-h-0 não rola: ele estica em vez de encolher`);
    assert.match(l, /\boverflow-y-auto\b/, `.${corpo} parou de rolar`);
    assert.doesNotMatch(l, /\bmax-h-/, `.${corpo} voltou pro teto fixo (era max-h-32/max-h-24)`);
  }
  // As linhas de altura previsível não podem encolher: item com base 0 (o
  // `flex-1`) tem fator de encolhimento escalado por 0 e NÃO cede — quem
  // cederia seriam justamente estas, cortando nome e endereço.
  for (const fixo of ['card-delete-banner', 'card-type-row', 'card-creator-row', 'card-brand-row']) {
    assert.match(linhaDe(fixo), /\bflex-shrink-0\b/,
      `.${fixo} sem flex-shrink-0 vira o alvo do encolhimento no lugar da caixa longa`);
  }
  // O espaçamento vem de `gap` na coluna, não do antigo wrapper `space-y-3`:
  // com `space-y-*` a margem some quando um irmão está `hidden`, e a caixa
  // longa é justamente a que aparece e some por tipo de pedido.
  const conteudo = linhaDe('card-content');
  assert.match(conteudo, /\bgap-3\b/, 'o espaçamento da coluna do card saiu do gap');
  assert.doesNotMatch(bloco, /class="space-y-3"/, 'o wrapper space-y-3 voltou pro meio da cadeia de flex');
});

test('a área que rola avisa que rola', () => {
  // Área que rola sem dizer que rola é área que ninguém rola — e aqui isso
  // custa caro: arrastar o card pra cima PULA, então quem não perceber que a
  // caixa rola nunca vê o resto da lista. O esmaecido de borda (scroll edge
  // effect do M3) some ao chegar no fim, pra não parecer corte.
  const APP_ = read('js/app.js');
  assert.match(APP_, /function marcarBordaRolagem/, 'sumiu o aviso de borda das áreas roláveis');
  const fn = APP_.match(/function marcarBordaRolagem\([\s\S]*?\n\}/)[0];
  assert.match(fn, /scrollHeight - el\.scrollTop - el\.clientHeight/, 'o aviso parou de olhar o que falta rolar');
  assert.match(fn, /addEventListener\('scroll'/, 'o aviso não some ao chegar no fim');
  assert.match(fn, /ResizeObserver/, 'a caixa é flex-1: sem observar o tamanho, o aviso mente quando ela cresce');
  for (const alvo of ['.card-changes-list', '.card-flag-comment-text', '.card-content']) {
    assert.ok(APP_.includes(`marcarBordaRolagem(card.querySelector('${alvo}'))`),
      `${alvo} rola sem avisar`);
  }
  const regra = CSS_SEM_COMENTARIO.match(/\.rola-mais\s*\{[^}]*\}/);
  assert.ok(regra, 'sumiu a regra .rola-mais');
  // Máscara, não gradiente colorido: assim funciona na caixa âmbar, na rosa, no
  // claro e no escuro sem ninguém manter três cores em sincronia. E as DUAS
  // grafias — sem o prefixo o Safari simplesmente não mostra o esmaecido, que é
  // o iPhone inteiro sem o único aviso de que a caixa rola.
  assert.match(regra[0], /(^|[\s;]) *mask-image:\s*linear-gradient/m, 'sumiu o mask-image sem prefixo');
  assert.match(regra[0], /-webkit-mask-image:\s*linear-gradient/, 'sumiu o -webkit-mask-image: iOS fica sem o aviso');
});

test('a área que rola é alcançável por teclado e tem nome', () => {
  // Medido: o Tab CHEGAVA na lista, mas só porque o Chromium ligou
  // "keyboard-focusable scrollers" — comportamento de browser, não nosso
  // markup (o tabIndex era -1). No Safari/iOS não vale, e quem usa leitor de
  // tela entrava numa região sem nome. Sendo a ÚNICA forma de ver o resto das
  // mudanças, isso é WCAG 2.1.1 (teclado) + 4.1.2 (nome).
  const bloco = templateDoCard();
  for (const [cls, chave] of [['card-changes-list', 'card.changes.aria'],
                              ['card-flag-comment-text', 'card.flagComment.aria']]) {
    const linha = bloco.split('\n').find((l) => new RegExp(`class="[^"]*\\b${cls}\\b`).test(l));
    assert.ok(linha, `sumiu o .${cls}`);
    assert.match(linha, /tabindex="0"/, `.${cls} fora da ordem do Tab em quem não é Chromium`);
    assert.match(linha, /role="group"/, `.${cls} sem papel — leitor de tela não anuncia a região`);
    assert.match(linha, new RegExp(`data-i18n-aria="${chave.replace('.', '\\.')}"`),
      `.${cls} sem nome traduzido`);
  }
});

test('nenhuma mudança proposta fica inalcançável', () => {
  // `MAX_CHANGES_DISPLAY = 4` fazia sentido com a caixa capada em 128px. Agora
  // ela rola, cresce com o card e avisa que rola — então capar só esconde: a
  // 5ª mudança não aparecia nem rolando, e a linha "+1 mais" gastava o espaço
  // de uma linha de mudança pra dizer menos.
  const APP_ = read('js/app.js');
  assert.doesNotMatch(APP_, /const MAX_CHANGES_DISPLAY\s*=/, 'o cap de mudanças voltou');
  const fn = APP_.match(/function renderCardChanges\([\s\S]*?\n\}/);
  assert.ok(fn, 'sumiu o renderCardChanges');
  assert.doesNotMatch(fn[0], /\.slice\(/, 'renderCardChanges voltou a cortar a lista');
  const I18N = read('js/i18n.js');
  assert.doesNotMatch(I18N, /card\.changes\.more/, 'sobrou a string do "+N mais"');
});

test('o frontend traduz o que o servidor manda cru', () => {
  // O core mandava rótulo, valor especial e tipo já em português — e a
  // auditoria de i18n não alcança string que chega pela REDE. Medido antes:
  // um editor em inglês lia "Nome: (vazio) → Novo Nome" e "Novo Local".
  const APP_ = read('js/app.js');
  for (const fn of ['valorDoDiff', 'rotuloDoCampo', 'rotuloDeEnum', 'humanizarEnum']) {
    assert.match(APP_, new RegExp(`function ${fn}\\(`), `sumiu o ${fn}`);
  }
  const diff = APP_.match(/function valorDoDiff\([\s\S]*?\n\}/)[0];
  for (const chave of ['card.value.empty', 'card.value.yes', 'card.value.no', 'card.value.unnamed']) {
    assert.ok(diff.includes(chave), `valorDoDiff parou de traduzir ${chave}`);
  }
  // O nome do local também: o core manda null quando não tem.
  assert.match(APP_, /card-name'\)\.textContent = place\.name \|\| t\('card\.noName'\)/,
    'nome ausente voltou a vir escrito do servidor');
  // E o tipo vai pela CHAVE, com a string pt só como último recurso.
  assert.match(APP_, /rotuloDeEnum\('card\.updateType\.', place\.updateTypeKey\)/,
    'o tipo voltou a ser a string em português do core');
});

test('o tipo do card não repete a lista de mudanças', () => {
  // O backend monta o tipo de um UPDATE como "Atualização: Id, Nome, Telefone…"
  // — exatamente os rótulos que a caixa "Mudanças propostas" mostra logo abaixo,
  // COM os valores. Os dois juntos custavam 139px (mais que a lista inteira) pra
  // dizer duas vezes a mesma coisa, e a de cima truncada.
  const APP_ = read('js/app.js');
  assert.match(APP_, /card\.type\.update/, 'o card voltou a repetir a enumeração de campos no Tipo');
  for (const lang of ['pt', 'en', 'es']) void lang;
  const I18N = read('js/i18n.js');
  assert.equal((I18N.match(/'card\.type\.update':/g) || []).length, 3,
    'card.type.update precisa existir nas três línguas');
  // O anúncio pra leitor de tela CONTINUA com a enumeração: lá ela não é
  // repetição, é a única forma de saber o que mudou sem varrer a lista.
  const live = APP_.match(/card\.live\.newRequest[\s\S]{0,200}/)[0];
  assert.match(live, /place\.updateType/, 'o leitor de tela perdeu o detalhe do que mudou');
});

test('em laptop a app cabe na tela, sem barra de rolagem de página', () => {
  // Num 1366×768 os custos fixos (header 69 + placar 87 + margens 80) mais o
  // card davam 850px: 82px de rolagem que não precisava existir — e rolagem
  // disputa com o gesto de "pular". O card passa a receber a SOBRA por uma
  // cadeia de flex, em vez de um `dvh` chutado.
  const bloco = CSS.match(/@media \(min-width: 768px\) and \(min-height: 700px\) \{[\s\S]*?\n\}/);
  assert.ok(bloco, 'sumiu a media query que faz a app caber em laptop');
  for (const alvo of ['body', 'body > main', '#appScreen:not(.hidden)', '#cardStack']) {
    assert.ok(bloco[0].includes(alvo), `a cadeia de flex perdeu o elo "${alvo}"`);
  }
  // A ALTURA no media query não é decoração: celular DEITADO tem 852px de
  // largura com 393px de altura, e só a largura fazia o piso de 26rem ficar
  // maior que a tela — a rolagem PIORAVA (177 → 259px, medido).
  assert.match(bloco[0], /min-height:\s*26rem/, 'o card perdeu o piso de altura');
  assert.doesNotMatch(
    CSS.replace(/\/\*[\s\S]*?\*\//g, ''),
    /@media \(min-width: 768px\) \{[\s\S]*?#cardStack/,
    'media query só por largura pega celular deitado e piora a rolagem'
  );
});

test('a foto cede espaço ANTES do texto', () => {
  // Sem isso, `flex-auto` dá shrink 1 aos dois e o encolhimento é proporcional
  // ao tamanho base: o texto (maior) cedia primeiro e ganhava barra de rolagem
  // com a foto folgada em 284px, muito acima do piso de 144px. Medido num
  // laptop de 768px: o texto estourava por 12px sem necessidade nenhuma.
  const foto = HTML.split('\n').find((l) => l.includes('card-photo'));
  assert.ok(foto, 'sumiu o container da foto');
  assert.match(foto, /shrink-\[\d+\]/, 'a foto voltou a ceder junto com o texto — barra de rolagem à toa');
});

test('o placar é compacto: o produto da app é o card', () => {
  // Cada pixel acima do card é pixel a menos de foto — e é a foto que o editor
  // olha pra decidir. O placar NÃO é alvo de toque, então a régua de 44/48px
  // não se aplica: o que vale é rótulo ≥ 11px (coberto por outro teste) e
  // espaçamento na grade de 8dp. Medido: 143 → 99px de custo fixo acima do card.
  const cartao = HTML.split('\n').find((l) => l.includes('id="placar"'));
  assert.ok(cartao, 'sumiu o #placar');
  assert.match(cartao, /\bp-2\b/, 'o placar voltou a ter padding grande');
  assert.doesNotMatch(cartao, /\bp-4\b/, 'padding de 16px de volta no placar');
  const bloco = HTML.split('\n').slice(
    HTML.split('\n').findIndex((l) => l.includes('id="placarGrid"')),
    HTML.split('\n').findIndex((l) => l.includes('id="placarGrid"')) + 30
  );
  const numeros = bloco.filter((l) => /id="(read|rejected|skipped|pending)Count"/.test(l));
  assert.equal(numeros.length, 4, 'esperava os 4 números do placar');
  for (const n of numeros) {
    assert.match(n, /text-xl\b/, 'número do placar voltou pro tamanho grande');
    assert.doesNotMatch(n, /text-2xl\b/, 'text-2xl de volta — custa 4px por número');
  }
});

test('espaçamento da tela do card vem de gap, não de space-y', () => {
  // `space-y-*` põe margem em todo filho a partir do 2º, e os dois elementos
  // `sr-only` (absolute, invisíveis) contavam como irmãos: o placar levava 16px
  // de margem por causa de coisa que ninguém vê. `gap` de flex ignora filho
  // absolute.
  const tela = HTML.split('\n').find((l) => l.includes('id="appScreen"'));
  assert.ok(tela, 'sumiu o #appScreen');
  assert.doesNotMatch(tela, /space-y-/, 'space-y-* de volta: os sr-only voltam a empurrar o placar');
  assert.match(
    CSS,
    /#appScreen:not\(\.hidden\)\s*\{[^}]*gap:/,
    'o espaçamento por gap sumiu do #appScreen'
  );
});

test('o vão entre a barra fixa e o placar é medido até a TINTA, não até a caixa', () => {
  // O owner insistiu que o vão era grande depois de eu já ter "compactado" —
  // e estava certo. Eu media a margem CSS (24px); o olho mede a distância até
  // o primeiro pixel do número, que somava margem + padding do cartão + borda
  // + entrelinha = 35px. O `<main>` era `py-6` por herança de quando o placar
  // não tinha borda nem elevação próprias; hoje a separação visual vem do
  // cartão, não do vão. Com `pt-2`: 19px até a tinta.
  const main = HTML.split('\n').find((l) => l.includes('<main'));
  assert.ok(main, 'sumiu o <main>');
  assert.match(main, /\bpt-2\b/, 'o topo do <main> voltou a ter respiro grande antes do placar');
  assert.doesNotMatch(main, /\bpy-6\b/, 'py-6 de volta: 24px de margem viram 35px de vão percebido');
});
