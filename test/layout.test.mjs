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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
// Quantas línguas o dicionário tem, DERIVADO do arquivo — nunca o literal 3. As
// contagens cravadas reprovaram todas de uma vez quando o francês entrou, e a
// mensagem ainda dizia "nas três línguas" com quatro no dicionário. Derivando,
// a 5ª língua não faz ninguém voltar aqui.
const N_LINGUAS = (read('js/i18n.js').match(/^  [a-z]{2}: \{$/gm) || []).length;


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

test('a ordem dos <link> mantém o NOSSO CSS vencendo o empate', () => {
  // Este teste substituiu o guard de especificidade, e a troca é a história
  // toda: o `styles.css` carregava DEPOIS do `tailwind.css`, então seletor de
  // UMA classe nosso perdia calado pra utility. Mordeu SEIS vezes:
  //   · `.modal-root { padding-bottom }`   perdeu pro `p-4`
  //   · `.auth-opt-pair { color: #fff }`   perdeu pro `text-slate-700`
  //   · `.auth-opt-upload { background }`  perdeu pro `bg-gradient-to-r`
  //   · `.auth-precondicao { display }`    perdeu pro `hidden`
  //   · `.card-content { overflow-y }`     perdeu pro `overflow-y-hidden`
  //   · `.card-map-scale { bottom }`       só funcionou POR perder (acidente)
  //
  // O guard antigo vigiava isso exigindo especificidade > (0,1,0) — mas só em
  // TRÊS blocos de media query e 17 propriedades enumeradas, ou seja, uma
  // fatia estreita do arquivo. Lista de permissões não cobre o que ninguém
  // lembrou de listar, e foi por aí que os casos 5 e 6 passaram.
  //
  // Inverter a ordem mata a classe de bug em vez de vigiá-la. Custo MEDIDO
  // antes de trocar: diff pixel a pixel de 92 cenários (23 telas × 2 temas ×
  // celular e desktop) → ZERO pixels. O que este teste protege agora é a
  // ordem em si: desfazê-la ressuscita as seis de uma vez, e em silêncio.
  // Os dois <link> viraram UM (`css/app.css`, gerado por tools/gerar-css.mjs),
  // então a ordem que importa deixou de ser a dos <link> e passou a ser a da
  // CONCATENAÇÃO. O teste segue a mudança: verifica dentro do arquivo GERADO
  // que o Tailwind vem antes do nosso CSS. Testar o HTML aqui seria testar o
  // lugar errado — o empate se decide no arquivo, não na tag.
  assert.match(HTML, /<link rel="stylesheet" href="css\/app\.css">/,
    'o index.html tem que carregar o css/app.css gerado');
  assert.equal((HTML.match(/rel="stylesheet"/g) || []).length, 1,
    'voltou a ter mais de um <link> de CSS bloqueando o render');

  const APP = read('css/app.css');
  // Marcador do Tailwind (o reset do preflight) contra um seletor que só existe
  // no nosso styles.css. Se o nosso vier primeiro, ele perde o empate calado.
  const iTw = APP.indexOf('--tw-border-spacing-x');
  const iSt = APP.indexOf('.valor-ausente');
  assert.ok(iTw >= 0, 'o css/app.css não tem a saída do Tailwind — rode `npm run css`');
  assert.ok(iSt >= 0, 'o css/app.css não tem o nosso styles.css — rode `npm run css`');
  assert.ok(iTw < iSt,
    'no css/app.css o Tailwind tem que vir ANTES do styles.css — invertido, o nosso CSS '
    + 'volta a perder o empate de especificidade pra utility, calado (gotcha #27)');

  // A saída é gerada: editar à mão volta na próxima `npm run css`.
  assert.match(APP, /^\/\* GERADO por tools\/gerar-css\.mjs/,
    'o css/app.css perdeu o cabeçalho de "não edite"');
});

test('o hash do script de tema bate com as DUAS cópias da CSP', () => {
  // O tema é aplicado por um script INLINE (para não custar requisição antes do
  // primeiro paint), e o que autoriza isso é um hash na CSP — nunca
  // `unsafe-inline`, que continua proibido.
  //
  // O risco é silencioso e caro: mexer no script sem atualizar o hash faz o
  // navegador BLOQUEAR o tema. A app abre no esquema errado (fundo claro em
  // quem usa escuro), e nada quebra a ponto de alguém notar em teste de layout.
  // Por isso o hash é RECALCULADO aqui, não conferido contra um literal.
  const HTML_ = read('index.html');
  const m = /<script>([\s\S]*?)<\/script>/.exec(HTML_);
  assert.ok(m, 'sumiu o script inline do tema');
  assert.match(m[1], /waze_places_theme/, 'o primeiro <script> inline não é o do tema');
  const hash = 'sha256-' + createHash('sha256').update(m[1], 'utf8').digest('base64');

  // As DUAS cópias: o browser aplica a INTERSEÇÃO delas (gotcha #14), então
  // faltar em uma bloqueia igual a faltar nas duas.
  const headers = read('_headers');
  assert.ok(HTML_.includes("'" + hash + "'"),
    `a meta CSP do index.html não tem o hash do script de tema (${hash}) — o tema seria bloqueado`);
  assert.ok(headers.includes("'" + hash + "'"),
    `o _headers não tem o hash do script de tema (${hash}) — o tema seria bloqueado em produção`);

  // E o `unsafe-inline` NÃO pode ter voltado junto: o hash existe pra evitá-lo.
  for (const [nome, txt] of [['index.html', HTML_], ['_headers', headers]]) {
    const sp = /script-src([^;]*);/.exec(txt);
    assert.ok(sp, `${nome}: sumiu o script-src da CSP`);
    assert.ok(!sp[1].includes("unsafe-inline"),
      `${nome}: 'unsafe-inline' voltou pro script-src — o hash existe justamente pra não precisar dele`);
    assert.ok(!sp[1].includes("unsafe-eval"), `${nome}: 'unsafe-eval' voltou pro script-src`);
  }

  // Um só: cada inline novo precisa do seu hash, e passar despercebido aqui
  // significaria um script bloqueado em silêncio.
  assert.equal((HTML_.match(/<script>/g) || []).length, 1,
    'apareceu outro <script> inline — ou ele ganha hash próprio na CSP, ou vira arquivo em js/');
});

test(':focus-visible não pode escrever border-radius', () => {
  // Escrever raio na regra de foco sobrescreve o raio do PRÓPRIO elemento: o
  // ✕ redondo dos modais e do lightbox virava quadrado enquanto focado — e ele
  // está focado, porque `openModal` foca o primeiro botão ao abrir. Ficou anos
  // escondido porque o `rounded-full` do Tailwind vencia por ordem de carga;
  // ao inverter a ordem, apareceu. Foi o ÚNICO ponto em que a inversão mudou
  // pixel nos 92 cenários medidos.
  //
  // Casa o BLOCO de `:focus-visible` e olha o corpo dele — não o arquivo
  // inteiro, senão qualquer `border-radius` de qualquer regra reprovaria.
  const CSS_ = read('css/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  let achou = 0;
  for (const m of CSS_.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)) {
    achou++;
    assert.ok(!/(^|;)\s*border-radius\s*:/.test(';' + m[2]),
      `"${m[1].trim()}" escreve border-radius e sobrescreve o raio do elemento focado `
      + '— o outline já acompanha o raio do próprio elemento nos browsers atuais');
  }
  assert.ok(achou >= 1, 'sumiu a regra de :focus-visible do styles.css (WCAG 2.4.7)');
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

    // DUAS construções valem, e a diferença não é gosto: é onde a conta é
    // feita. Diálogo CENTRALIZADO empurra o conteúdo pra cima com padding e
    // desconta o mesmo valor do teto de altura. FOLHA ancorada embaixo sobe a
    // própria raiz (`bottom`), e o teto dela é 100% da raiz já encolhida —
    // aplicar a conta do centralizado numa folha desconta o teclado DUAS vezes
    // (`max-height` já inclui o `padding-bottom`), e o campo continua coberto.
    if (linhas[i].includes('folha-modal')) {
      assert.match(CSS_SEM_COMENTARIO, /\.folha-modal\s*\{[^}]*bottom:\s*var\(--kb-inset/,
        `a folha ${id} não sobe com o teclado: falta o bottom: var(--kb-inset) em styles.css`);
      // Membro exato da lista de classes, não `\b` na string inteira: `\bfolha\b`
      // casa DENTRO de `conversa-folha` (o hífen é fronteira de palavra), então
      // a conversa era conferida contra a regra da OUTRA folha — e a sabotagem
      // de propósito passava limpa.
      const folha = ((linhas[i + 1].match(/class="([^"]*)"/) || [])[1] || '').split(/\s+/);
      const classe = ['folha', 'conversa-folha'].find((c) => folha.includes(c));
      assert.ok(classe, `a folha ${id} não usa .folha nem .conversa-folha — fica sem teto de altura`);
      const regra = CSS_SEM_COMENTARIO.match(new RegExp(`\\.${classe}\\s*\\{[^}]*\\}`));
      assert.ok(regra && /max-height:[^;]*100%/.test(regra[0]),
        `.${classe} precisa de teto em 100% da raiz (que já desconta o teclado)`);
      continue;
    }
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
  // A PROPRIEDADE, não a forma: este guard exigia o literal `flex-auto` e
  // reprovou uma correção legítima que trocou a base do flex mantendo tudo o
  // que importa. O que precisa continuar valendo é a foto CRESCER e ENCOLHER.
  assert.match(foto, /\b(flex-auto|flex-1|grow)\b/,
    'a foto voltou a ter altura fixa — a sobra vira vão de novo');
  assert.match(foto, /\bshrink-\[/, 'a foto parou de ceder espaço antes do texto');
  assert.match(foto, /min-h-\[/, 'a foto precisa de um piso, senão some em conteúdo longo');
  assert.match(foto, /max-h-\[/, 'a foto precisa de um teto, senão engole o texto');
  assert.doesNotMatch(foto, /\bh-52\b/, 'altura fixa de volta na foto');

  // E a base do flex tem que ser ZERO. Com `flex-basis: auto` ela é resolvida
  // pelo tamanho INTRÍNSECO da <img>, ou seja: a proporção da foto que o
  // usuário tirou decide quanto de altura sobra pro texto. Medido com 51
  // pedidos reais de 6 países num Galaxy Fold — 800×400: 0 estouram; 512×512:
  // 20; 1080×1920 (retrato, que é como celular fotografa): 31. O bug valia pra
  // todo tipo e todo país, e só não aparecia porque a fixture do smoke era
  // 800×400, o ÚNICO formato que nunca falha.
  assert.ok(/\bbasis-0\b/.test(foto) || /\bflex-1\b/.test(foto),
    'a foto voltou a ter base de flex automática — a proporção da imagem passa a decidir o layout');
  const CSS_ = read('css/styles.css');
  assert.match(CSS_, /\.place-card \.card-photo\s*\{[^}]*flex-basis:\s*0/,
    'sumiu o reforço de flex-basis: 0 no styles.css');

  const conteudo = linhas.find((l) => l.includes('card-content dark:'));
  assert.ok(conteudo, 'sumiu a área de texto do card');
  // A saída pro texto que estoura EXISTE, mas não é mais um `overflow-y-auto`
  // cravado: cravado ele valia sempre, e 1px de arredondamento de fração já
  // desenhava barra de rolagem no desktop (relatado e reproduzido). Agora quem
  // garante a saída é a medição CONTINUAR rodando — ResizeObserver — e ligar a
  // rolagem quando estoura de verdade. Sem o observer, girar o aparelho ou
  // aumentar a fonte cortaria o texto sem jeito de alcançar.
  const app = read('js/app.js');
  assert.match(app, /function vigiarEstouroDoConteudo/, 'sumiu a vigia do estouro do conteúdo');
  const vigia = app.match(/function vigiarEstouroDoConteudo\(el\)[\s\S]*?\n\}/)[0];
  // A propriedade, não o NOME da função: este guard já reprovou uma correção
  // legítima porque exigia o identificador `avaliar` e a correção separou
  // agendamento de escrita. O que precisa continuar valendo é a vigia ser
  // CONTÍNUA — um ResizeObserver — e não uma medição de uma vez só.
  const cb = vigia.match(/new ResizeObserver\(\s*(\w+)\s*\)/);
  assert.ok(cb, 'a vigia virou medição de uma vez só — texto que estoure depois fica cortado sem saída');
  assert.match(vigia, /card-content-rola/, 'a vigia parou de ligar a rolagem');

  // O callback do observer NÃO pode escrever no DOM. Ligar a classe muda o
  // `overflow-y`; onde a barra de rolagem ocupa largura (desktop), isso encolhe
  // o content box que o próprio observer observa e o browser emite
  // "ResizeObserver loop completed with undelivered notifications" — que
  // chegava como toast VERMELHO pro editor. Relatado com print.
  const corpoDoCb = vigia.match(new RegExp(`const ${cb[1]} = \\([^)]*\\) => \\{[\\s\\S]*?\\n    \\};`));
  assert.ok(corpoDoCb, `não achei o corpo do callback ${cb[1]} do ResizeObserver`);
  assert.doesNotMatch(corpoDoCb[0], /classList/,
    'o callback do ResizeObserver voltou a escrever no DOM — é o laço que virava toast vermelho');
  assert.match(corpoDoCb[0], /requestAnimationFrame/,
    'o callback do ResizeObserver precisa ADIAR a escrita, não fazê-la no ciclo de entrega');
  // Só mexe no DOM quando a decisão muda: em regime permanente, custo zero.
  assert.match(vigia, /if \(estoura === ligado\) return;/,
    'a vigia voltou a escrever no DOM a cada quadro, mesmo sem mudar de estado');
  // Os filhos também são observados: a caixa é `flex-1` num card de altura
  // fixa, então texto que cresce (fonte do sistema, zoom só-de-texto) NÃO muda
  // a caixa — observar só ela deixaria a rede sem nunca ligar nesse caso.
  assert.match(vigia, /for \(const filho of el\.children\) obs\.observe\(filho\);/,
    'a vigia parou de observar os filhos — fonte maior/zoom de texto não dispara nada');
  // DUAS classes no seletor: o HTML tem a utility `overflow-y-hidden` e o
  // tailwind.css carrega depois — seletor de uma classe empata e perde (gotcha
  // #27). Com uma só, a rede ligava e o conteúdo NÃO rolava. Medido.
  assert.match(read('css/styles.css'), /\.card-content\.card-content-rola \{[^}]*overflow-y: auto/,
    'o seletor da rede perdeu a segunda classe — a utility do Tailwind ganha e nada rola');
  assert.doesNotMatch(conteudo, /\bflex-1\b/, 'flex-1 no texto faz ele receber a sobra e virar vão');

  // Quem cede é a FOTO. Sem piso, a caixa de texto (`min-h-0`) encolhe abaixo do
  // próprio conteúdo e a última linha aparece cortada com a foto intacta —
  // relatado no laptop do owner. Compactar o texto NÃO resolve: a foto é
  // `flex-auto` e reabsorve na hora (medido: conteúdo 241→227px, caixa
  // 237,7→224,2px, sobra igual).
  const CSS = read('css/styles.css');
  const piso = CSS.match(/\.place-card \.card-content:not\(:has\([^\n]*\)\) \{\s*min-height: min-content;/);
  assert.ok(piso, 'sumiu o piso do texto — a caixa volta a encolher abaixo do conteúdo e cortar a última linha');
  // Escopo obrigatório, nos DOIS sentidos, e cada metade custou uma medição:
  //  · sem `:not(:has(...))` → min-content conta a lista INTEIRA e leva a barra
  //    ✕/↑/✓ pra 152-278px fora da tela num Fold (51 falhas no smoke)
  //  · sem `:not(.hidden)` → as caixas longas moram no template e são só
  //    escondidas, então o `:has` casa em TODO card e a regra não vale em
  //    lugar nenhum (a sobra voltava a 3-4px no card do relato)
  assert.match(piso[0], /\.card-changes:not\(\.hidden\)/,
    'o :has do piso parou de exigir :not(.hidden) — as caixas longas existem escondidas em todo card');
  assert.match(piso[0], /\.card-flag-comment:not\(\.hidden\)/,
    'o :has do piso parou de exigir :not(.hidden) no reporte');

  // E o piso PRECISA sair em tela estreita-e-baixa. Lá o texto quebra em mais
  // linhas e o min-content cresce onde não há altura: medido num 320×533, o
  // card de remoção jogava a barra ✕/↑/✓ 76px FORA da tela nas 4 línguas (a
  // auditoria de 960 renders pegou). Ação fora da dobra (gotcha #32) é pior que
  // última linha apertada, que ainda tem a rede de rolagem como saída.
  const estreitoEBaixo = CSS.match(
    /@media \(max-height: 700px\) and \(max-width: 360px\) \{[\s\S]*?\n\}/);
  assert.ok(estreitoEBaixo, 'sumiu o degrau de tela estreita-e-baixa');
  assert.match(estreitoEBaixo[0], /\.card-content:not\(:has\([^\n]*\)\) \{\s*min-height: 0;/,
    'o piso do texto deixou de sair em tela estreita-e-baixa — a barra de ações volta pra fora da tela');
});

test('aviso do browser não vira erro na cara do editor — e o filtro não é guarda-chuva', () => {
  // O owner levou um toast VERMELHO "Erro inesperado: ResizeObserver loop
  // completed with undelivered notifications" ao abrir a foto. Nada tinha
  // quebrado: é aviso do navegador quando um observer provoca layout que exige
  // outra rodada de entrega no mesmo quadro.
  const app = read('js/app.js');
  const filtro = app.match(/const (\w+) = \/[^\n]*ResizeObserver[^\n]*\/i?;/);
  assert.ok(filtro, 'sumiu o filtro do ruído de ResizeObserver — o aviso volta a virar toast vermelho');
  const handler = app.match(/window\.addEventListener\('error',[\s\S]*?\n\}\);/)[0];
  assert.match(handler, new RegExp(`${filtro[1]}\\.test\\(`),
    'o handler de erro parou de consultar o filtro');
  assert.match(handler, /console\.warn/,
    'o ruído tem que ficar no console — filtrado da tela não é o mesmo que invisível');
  // A parte que importa tanto quanto: erro DE VERDADE segue virando toast. Um
  // filtro largo esconderia defeito real e ninguém descobriria.
  assert.match(handler, /showToast/, 'o handler parou de avisar o editor de erro real');
  const antesDoFiltro = handler.slice(0, handler.indexOf('showToast'));
  assert.ok(/return;/.test(antesDoFiltro) && antesDoFiltro.indexOf('return;') < antesDoFiltro.length,
    'o return do filtro sumiu — o ruído voltaria a cair no caminho do toast');
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
  // O .card-content não aparece mais aqui porque a rolagem dele passou a ser
  // condicional (classe .card-content-rola, ligada pela vigia). Ele continua
  // podendo rolar, então a lista de exceção do arraste PRECISA cobri-lo —
  // é isso que se verifica agora, em vez de contar quantos têm overflow no HTML.
  // O comentário do reporte SAIU desta contagem em v2026.08.19-02: ele deixou
  // de rolar pela UTILITY: ele rola por regra do styles.css, dentro de uma
  // janela de N linhas. Como ele rola, continua obrigado a estar na lista de
  // exceção — é o que o laço abaixo cobra, e é a proteção que importa. Contar
  // quantos elementos têm `overflow-y-auto` no HTML era medir a
  // implementação; o que vale é "tudo que pode rolar está na lista".
  assert.ok(roláveis.size >= 1, `esperava ao menos 1 área rolável no template, achei ${[...roláveis]}`);
  // Roláveis CONDICIONAIS (só depois de uma classe): não aparecem com
  // `overflow-y-auto` no HTML, mas engolem o gesto igual se ficarem de fora.
  for (const cond of ['card-flag-comment-text']) {
    assert.ok(ignora[1].includes('.' + cond),
      `.${cond} rola e não está na exceção do swipe.js — o arraste engoliria a rolagem`);
    assert.match(read('css/styles.css'), new RegExp(`\\.${cond}[^}]*overflow-y: auto`),
      `.${cond} deixou de poder rolar — se foi de propósito, tire-o desta lista`);
  }
  // O .card-content nunca esteve na lista de exceção do closest() — o mecanismo
  // dele sempre foi outro: a classe da rede liga `touch-action: pan-y`, e é isso
  // que faz o browser rolar em vez de o handler capturar o arraste. Verifica o
  // mecanismo que EXISTE, não o que eu supus na primeira escrita deste guard.
  assert.match(read('css/styles.css'), /\.card-content\.card-content-rola \{[^}]*touch-action: pan-y/,
    'a rede parou de liberar o arraste vertical — com ela ligada, arrastar pra cima pularia em vez de rolar');

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

  // Só o DIFF ainda absorve a sobra. O comentário do reporte saiu daqui em
  // v2026.08.19-02, e a razão é medida: como `flex-1 min-h-0` ele ENCOLHIA
  // abaixo do conteúdo — no Galaxy Fold sobravam 10px pro texto numa linha de
  // 19px, meia linha visível, rolando, com 10 caracteres ou com 200. Não era
  // falta de espaço (o card ocupava 460px numa janela de 653): era a caixa
  // cedendo tudo. Agora ela é `flex-shrink-0`, cresce com o conteúdo até 3
  // linhas e corta — 94% a 97% dos comentários reais cabem inteiros.
  for (const caixa of ['card-changes']) {
    const l = linhaDe(caixa);
    assert.match(l, /\bflex-1\b/, `.${caixa} precisa de flex-1 pra absorver a sobra`);
    assert.match(l, /\bmin-h-0\b/, `.${caixa} sem min-h-0 não encolhe — o conteúdo estoura o card`);
    assert.match(l, /\bflex-col\b/, `.${caixa} precisa ser coluna flex pro corpo dela poder rolar`);
    assert.doesNotMatch(l, /\bmax-h-/, `.${caixa} com teto fixo volta a empurrar a rolagem pro card inteiro`);
  }
  // O `.card-flag-comment-text` saiu daqui junto com a caixa dele: ele não
  // ocupa mais a sobra, ele rola numa janela de N linhas (ver o teste abaixo).
  for (const corpo of ['card-changes-list']) {
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

// O modo dev é a PRIMEIRA opção das Preferências, e não é arrumação.
//
// Ele MODIFICA as opções abaixo: `canDisableUndo()` devolve true com dev mode
// ligado, ou seja, ele fura a trava do "Permitir desfazer ações". Ler
// "Desfazer: ligado" e só depois descobrir, mais abaixo, que existe um
// interruptor que o ignora é a ordem errada de causa e efeito — quem sobrepõe
// vem antes do que é sobreposto.
//
// Não custa nada pra quase todo editor: a seção nasce `hidden` e só aparece
// depois dos 7 toques na versão, então a aba continua começando no Idioma.
test('modo dev é a primeira opção das Preferências', () => {
  const HTML_ = read('index.html');
  const ini = HTML_.indexOf('id="filtersPanelPrefs"');
  const fim = HTML_.indexOf('id="filtersPanelHistory"', ini);
  assert.ok(ini > 0 && fim > ini, 'sumiu a aba de Preferências');
  const painel = HTML_.slice(ini, fim);
  const ordem = [...painel.matchAll(/id="(devModeSection|langSelect|prefUndoRow)"/g)].map((m) => m[1]);
  assert.deepEqual(ordem, ['devModeSection', 'langSelect', 'prefUndoRow'],
    `ordem das Preferências mudou: ${ordem.join(' → ')} — o modo dev tem que vir primeiro, porque ele fura a trava do Desfazer`);
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
  // A rampa NÃO pode ser um comprimento fixo: nas janelas curtas (a do
  // comentário é de 2 linhas, 38px) 1.5rem apaga quase a caixa inteira, e numa
  // de 1 linha apagava a única linha visível — o aviso de "tem mais" comendo
  // exatamente o que se veio ler. Isso não estoura nada e nenhuma medida de
  // altura pega: só olhando a tela, ou cobrando a regra aqui.
  assert.match(regra[0], /min\(\s*1\.5rem\s*,\s*\d+%\s*\)/,
    'a rampa do esmaecido voltou a ser fixa — em caixa curta ela apaga o conteúdo');
});

test('sem nome, o endereço vira a identidade — e a ausência não some', () => {
  // "sem nome" ocupava o slot de 1.35rem enquanto a única coisa que identificava
  // o local (o endereço) ficava em cinza pequeno logo abaixo. Invertido — e o
  // owner notou o efeito colateral: como o placeholder tinha a MESMA cara de
  // dado, não dava pra saber se o local se chamava "sem nome" ou se não tinha
  // nome. É o padrão do Google Maps (ponto sem nome é titulado pelo endereço).
  //
  // A ausência não pode sumir junto — mas o selo marca ausência INESPERADA, não
  // ausência. A justificativa que estava aqui ("RESIDENCE_HOME sem nome é forte
  // candidato a rejeitar") era raciocínio de escrivaninha sobre uma amostra
  // brasileira pequena, e o dado nega: MEDIDO em 4692 pedidos dos 13 países de
  // validação, RESIDENCE_HOME é 100% sem nome (325 de 325). Sinal que dispara
  // em toda uma classe não distingue nada dentro dela — e, em destaque no topo
  // do card, lê como alerta, convidando a rejeitar o que está normal.
  // O owner apontou: "para a categoria Residencial isso não é candidato forte a
  // rejeitar, é normal pois realmente não tem nome."
  // Onde ela É exceção o selo fica: PARKING_LOT 8,1%, PARK 8,3%,
  // CHARGING_STATION 4,0% — e ZERO em GAS_STATION (427), RESTAURANT (149) e
  // SUPERMARKET_GROCERY (125), onde um sem-nome seria genuinamente estranho.
  const APP_ = read('js/app.js');
  const fn = APP_.match(/function identidadeDoPlace\([\s\S]*?\n\}/);
  assert.ok(fn, 'sumiu a cadeia de identidade do card');
  assert.match(fn[0], /place\.address/, 'o endereço parou de virar título quando falta o nome');
  assert.match(fn[0], /card\.noName/, 'sumiu o título de último recurso (nem nome nem endereço)');

  // ── o selo marca ausência INESPERADA ──────────────────────────────────
  // Sem isto o selo volta a disparar em 100% dos residenciais, que é ruído com
  // cara de alerta. E a supressão precisa valer no CALL SITE: deixar a regra só
  // declarada numa constante que ninguém consulta é o modo silencioso de falhar.
  assert.match(APP_, /const CATEGORIAS_SEM_NOME_ESPERADO = Object\.freeze\(\[[^\]]*'RESIDENCE_HOME'/,
    'sumiu a lista de categorias em que a ausência de nome é esperada');
  const usoSelo = APP_.match(/card-no-name-badge'\)[\s\S]{0,160}?;/);
  assert.ok(usoSelo, 'sumiu o ponto onde o selo é mostrado/escondido');
  assert.match(usoSelo[0], /ausenciaDeNomeEsperada/,
    'o selo voltou a depender só de `semNome` — dispara em 100% dos residenciais');
  // A lista é de EXCEÇÃO medida, não de palpite: categoria só entra com taxa de
  // ausência perto de 100%. Hoje é uma só, e crescer sem medir é o que trouxe a
  // premissa errada da primeira vez.
  const lista = APP_.match(/const CATEGORIAS_SEM_NOME_ESPERADO = Object\.freeze\(\[([^\]]*)\]/)[1];
  const quantas = lista.split(',').filter((x) => x.trim()).length;
  assert.ok(quantas <= 2,
    `${quantas} categorias na lista — cada uma precisa de taxa medida perto de 100%, revisite este guard ao crescer`);
  assert.match(APP_, /card-no-name-badge/, 'sumiu o selo de "sem nome" — a ausência ficou invisível');
  assert.match(HTML, /card-no-name-badge/, 'sumiu o selo do template do card');
  // Endereço promovido a título não se repete embaixo.
  assert.match(APP_, /card-address-row'\)\.classList\.toggle\('hidden', ident\.tituloEhEndereco\)/,
    'o endereço voltou a aparecer duas vezes quando é o título');
  // Leitor de tela e alt da foto usam a MESMA identidade: quem não vê a tela
  // ouviria "sem nome" enquanto a tela mostra o endereço.
  assert.equal((APP_.match(/identidadeDoPlace\(place\)\.titulo/g) || []).length, 2,
    'o anúncio de leitor de tela e o alt da foto precisam da mesma identidade');
  // O endereço é mais longo que nome: em 1.35rem/2 linhas ele truncava o estado.
  const regra = CSS.match(/\.card-name\.titulo-endereco\s*\{[^}]*\}/);
  assert.ok(regra, 'sumiu a calibragem do título quando ele é endereço');
  assert.match(regra[0], /line-clamp:\s*4/, 'o teto de linhas do endereço voltou a cortar o endereço real');
});

test('placeholder não se confunde com dado', () => {
  // Um local pode se chamar "Sem categoria"? Não. Mas pode se chamar "sem nome"
  // — e era exatamente essa a dúvida do owner. Os parênteses resolvem em vez de
  // só sinalizar: ninguém batiza um local de "(desconhecido)". E são TEXTO, então
  // o leitor de tela os lê; o itálico esmaecido é só reforço visual, porque cor
  // e estilo sozinhos não transmitem informação (WCAG 1.4.1).
  const I18N = read('js/i18n.js');
  const CHAVES = ['card.noName', 'card.categories.empty', 'card.address.empty',
                  'card.type.empty', 'card.creator.empty', 'card.value.empty', 'card.value.unnamed'];
  for (const chave of CHAVES) {
    const vals = [...I18N.matchAll(new RegExp(`'${chave.replace(/\./g, '\\.')}':\\s*'([^']*)'`, 'g'))].map((m) => m[1]);
    assert.equal(vals.length, N_LINGUAS, `${chave} precisa existir nas ${N_LINGUAS} línguas`);
    for (const v of vals) {
      assert.ok(v.startsWith('(') && v.endsWith(')'),
        `${chave} = "${v}" — placeholder sem parênteses se confunde com dado do Waze`);
    }
  }
  // O selo é rótulo de estado, não valor: esse NÃO leva parênteses.
  const selo = [...I18N.matchAll(/'card\.noName\.badge':\s*'([^']*)'/g)].map((m) => m[1]);
  assert.equal(selo.length, N_LINGUAS, `card.noName.badge precisa existir nas ${N_LINGUAS} línguas`);
  for (const v of selo) assert.doesNotMatch(v, /^\(/, 'o selo não é valor — não leva parênteses');

  const APP_ = read('js/app.js');
  assert.match(APP_, /function escreverValor/, 'sumiu a marcação de valor ausente');
  const esc = APP_.match(/function escreverValor\([\s\S]*?\n\}/)[0];
  assert.match(esc, /classList\.toggle\('valor-ausente'/, 'o placeholder parou de ser marcado');
  const regra = CSS.match(/\.valor-ausente\s*\{[^}]*\}/);
  assert.ok(regra, 'sumiu o estilo do valor ausente');
  assert.match(regra[0], /font-style:\s*italic/, 'o placeholder voltou a ter a mesma cara de dado');
  // Dois seletores: uma classe só empata com utility do Tailwind e perde (#27).
  assert.match(CSS, /\.place-card \.valor-ausente/, 'seletor de uma classe só perde pra utility');
});

test('durante a janela do Desfazer ninguém prossegue, por caminho nenhum', () => {
  // Antes dava pra tratar o próximo pedido enquanto o "Desfazer" corria — e o
  // anterior era despachado sem aviso. Pior: por acidente de layout, o banner
  // cobria os botões em 6 de 8 aparelhos medidos (iPhone SE 40px, Galaxy S8+
  // 63px, laptop 67px), então o comportamento MUDAVA conforme a tela. Agora é
  // decisão explícita e igual em todo lugar.
  //
  // Os três caminhos precisam da trava: bloquear só o botão deixaria o gesto e
  // a seta do teclado como atalhos pra furar a janela.
  const APP_ = read('js/app.js');
  const SWIPE = read('js/swipe.js');
  assert.match(APP_, /function acoesTravadas/, 'sumiu o estado de trava da janela do Desfazer');
  for (const fn of ['handleMarkAsRead', 'handleReject', 'handleSkip']) {
    const corpo = APP_.match(new RegExp(`function ${fn}\\(\\)[\\s\\S]*?\\n\\}`));
    assert.ok(corpo, `sumiu o ${fn}`);
    assert.match(corpo[0], /if \(acoesTravadas\(\)\) return;/, `${fn} não respeita a trava`);
  }
  // Teclado
  const teclas = APP_.match(/function handleKeyDown\([\s\S]*?\n\}/);
  assert.match(teclas[0], /acoesTravadas\(\)[\s\S]{0,120}Arrow/, 'as setas furam a janela do Desfazer');
  // Gesto: arraste E o disparo por botão/tecla passam pelo swipe.js
  // Conta os pontos de USO (com parênteses): cada checagem escreve o nome duas
  // vezes (`x && x()`), então contar o nome cru dava 4 e mascarava a intenção.
  assert.equal((SWIPE.match(/window\.acoesTravadas\(\)/g) || []).length, 2,
    'handleDragStart e triggerSwipe precisam OS DOIS respeitar a trava');
  assert.match(APP_, /window\.acoesTravadas = acoesTravadas;/, 'o swipe.js não enxerga mais a trava');

  // Botão travado tem que PARECER travado: botão morto com cara de vivo lê como
  // app quebrada (M3/HIG). Medido: disabled=true, opacidade 0.4.
  assert.match(APP_, /\.disabled = acoesTravadas\(\)/, 'os botões não ficam disabled durante a janela');
  const CSS_ = read('css/styles.css');
  const regra = CSS_.match(/\.acoes-travadas[^{]*\{[^}]*\}/);
  assert.ok(regra, 'sumiu o estilo do botão travado');
  assert.match(regra[0], /opacity/, 'o botão travado voltou a parecer normal');
  // Dois seletores: uma classe só empata com utility do Tailwind e perde (#27).
  assert.match(regra[0], /\.acoes-travadas \.card-btn/, 'seletor de uma classe só perde pra utility');

  // E a trava tem que ACABAR: o executor limpa a pendência e destrava.
  const agenda = APP_.match(/const runExecutor = async \(\)[\s\S]*?\n    \};/);
  assert.ok(agenda, 'sumiu o runExecutor');
  assert.match(agenda[0], /aplicarTravaDeAcao\(\)/, 'a trava não é liberada quando a ação sai');
});

test('o aviso de conquista é banner (topo), não snackbar (rodapé)', () => {
  // No rodapé ele tapava os TRÊS botões do card por 8s em 2 de 3 aparelhos
  // medidos (iPhone SE e laptop 1366×768) — gotcha #26. A distinção é do M3 e
  // não é estética: snackbar confirma o que você acabou de fazer e some rápido;
  // banner é proeminente, tem ação e fica mais tempo. Este convida a abrir as
  // Preferências, não confirma nada.
  const APP_ = read('js/app.js');
  assert.match(HTML, /id="bannerContainer"/, 'sumiu o container do banner no topo');
  // Comportamento, não a expressão literal: o que importa é que os avisos
  // proeminentes (conquista e dica) escolham o container do TOPO. Antes isto
  // fixava o ternário inteiro e reprovou uma refatoração que preservava a
  // intenção — guard que trava a forma, e não o efeito, custa mais do que vale.
  const corpoToast = APP_.match(/function showToast\([\s\S]*?const toast = document\.createElement/);
  assert.ok(corpoToast, 'sumiu o showToast');
  assert.match(corpoToast[0], /bannerContainer/, 'o aviso proeminente não vai mais pro topo');
  for (const tipo of ['achievement', 'hint']) {
    assert.match(corpoToast[0], new RegExp(`'${tipo}'`),
      `"${tipo}" deixou de ser banner e voltou pro rodapé, onde tapa os botões do card`);
  }

  // Ancorado abaixo do header — senão só troca de vítima e passa a tapar os
  // botões do próprio header.
  const linha = HTML.split('\n').find((l) => l.includes('id="bannerStack"'));
  assert.ok(linha, 'sumiu o #bannerStack');
  assert.match(linha, /var\(--header-h/, 'o banner deixou de se ancorar na altura do header');
  // E essa altura é MEDIDA: o header cresce com a safe-area do iPhone e com a
  // fonte do sistema, então número fixo erraria em algum aparelho.
  assert.match(APP_, /function setupAlturaDoHeader/, 'ninguém mais mede a altura do header');
  const fn = APP_.match(/function setupAlturaDoHeader\([\s\S]*?\n\}/)[0];
  assert.match(fn, /--header-h/, 'a medida do header não é mais publicada');
  assert.match(fn, /ResizeObserver/, 'a altura do header virou medida única, não acompanha mudança');
  assert.match(APP_, /setupAlturaDoHeader\(\);/, 'o setup não é chamado na inicialização');

  // Camada: acima do card (z-50), abaixo dos modais (z-[60]).
  const z = linha.match(/z-\[(\d+)\]/);
  assert.ok(z, 'o #bannerStack perdeu a camada explícita');
  assert.ok(Number(z[1]) > 50 && Number(z[1]) < 60,
    `#bannerStack em z-[${z[1]}]: precisa ficar entre o card (50) e os modais (60)`);
});

test('a ação pendente não morre quando a página sai', () => {
  // O stat é incrementado e SALVO no swipe, mas a ação só vai pro Waze
  // UNDO_WINDOW_MS depois. Fechar a aba nessa janela fazia a ação sumir com o
  // placar dizendo que ela aconteceu — e o número fica errado pra sempre.
  // Medido nos dois builds: sem isto, 0 requisições chegam ao servidor.
  const APP_ = read('js/app.js');
  const API_ = read('js/api.js');
  assert.match(APP_, /function descarregarAcaoPendente/, 'sumiu o descarregamento da ação pendente');
  const setup = APP_.match(/function setupDescargaAoSair\([\s\S]*?\n\}/);
  assert.ok(setup, 'sumiu o setupDescargaAoSair');
  // `pagehide` cobre fechar/navegar; `visibilitychange` para oculto é o último
  // callback confiável no celular, quando o sistema mata a aba em segundo plano.
  // Checar só o NOME do evento é guard decorativo: esvaziar o corpo do listener
  // passava. O que vale é os DOIS caminhos chamarem o descarregamento.
  assert.match(setup[0], /'pagehide'/, 'parou de cobrir o fechamento da aba');
  assert.match(setup[0], /visibilityState === 'hidden'/, 'parou de cobrir a aba indo pra segundo plano');
  assert.equal((setup[0].match(/descarregarAcaoPendente/g) || []).length, 2,
    'um dos dois caminhos de saída parou de descarregar a ação');
  assert.match(APP_, /setupDescargaAoSair\(\);/, 'ninguém mais chama o setup na inicialização');
  // Fetch normal é CANCELADO no unload — sem keepalive a defesa é decorativa.
  assert.match(API_, /keepalive:\s*true/, 'sumiu o keepalive: a requisição volta a morrer no unload');
  assert.match(API_, /setSaindo/, 'sumiu o modo "a página está saindo" da API');
});

test('o HTML não tem NENHUM script inline', () => {
  // Duas razões, e a segunda é a que fecha um buraco de segurança:
  //
  // 1. A auditoria de i18n varre atributos data-i18n e chamadas t() nos
  //    arquivos js/. Script dentro do index.html não é nenhum dos dois — foi
  //    por aí que "Nova versão disponível. Atualizando..." falou português com
  //    todo mundo, com `toast.newVersion` pronto nas três línguas e sem uso.
  //
  // 2. Sem script inline, a CSP pode proibir script inline — e aí um XSS não
  //    consegue mais ler o sessionToken do localStorage. Medido nos dois
  //    builds: em produção o script injetado executava e lia o token; aqui é
  //    bloqueado. Um único <script> inline de volta obriga a reabrir o
  //    'unsafe-inline' e desfaz isso inteiro.
  // A premissa MUDOU, e a mudança é estreita: existe UM script inline, o do
  // tema, e o que o autoriza é um HASH na CSP — não `unsafe-inline`. A
  // propriedade de segurança continua inteira, porque hash libera exatamente
  // aquele texto: um script injetado por XSS tem outro conteúdo, outro hash, e
  // segue bloqueado. Quem trava o hash é o teste
  // 'o hash do script de tema bate com as DUAS cópias da CSP'.
  //
  // Aqui o que se guarda é o RESTO: nenhum inline além dele, e nenhuma string
  // de interface dentro do que é inline (razão 1 acima, que não depende de CSP).
  const inline = [...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1].trim()).filter((c) => c !== '');
  assert.equal(inline.length, 1,
    `esperava só o script do tema inline, achei ${inline.length} — cada inline novo precisa do seu hash na CSP`);
  assert.match(inline[0], /waze_places_theme/, 'o script inline do index.html não é o do tema');
  // Sem texto de interface: o que estiver aqui escapa da auditoria de i18n.
  assert.doesNotMatch(inline[0], /textContent|innerHTML|\.title\s*=|alert\(/,
    'o script inline do tema passou a escrever texto na tela — isso escapa da auditoria de i18n');
  // Handler inline (onclick=) também é script inline pra CSP.
  assert.doesNotMatch(HTML, /\son(?:click|load|error|change|submit|input)\s*=\s*["']/,
    'handler inline no HTML — bloqueado pela CSP e invisível pra auditoria');
  // E o aviso de nova versão continua saindo do dicionário.
  assert.match(read('js/sw-register.js'), /window\.t\('toast\.newVersion'\)/,
    'o aviso de nova versão saiu do dicionário');
});

test('as TRÊS cópias da CSP dizem a mesma coisa', () => {
  // O <meta> do index.html, o _headers (Cloudflare) e o SECURITY_HEADERS do
  // server/node.mjs (VM) precisam bater: o browser aplica a INTERSEÇÃO das CSPs
  // ativas, então divergência não dá erro — só faz alguma coisa parar de
  // carregar, em produção, sem aviso (gotcha #14).
  //
  // A do node.mjs entrou depois: o `_headers` é arquivo de Cloudflare e o Node
  // nunca o leu, então rodar na VM era rodar só com o <meta>, uma camada a
  // menos. A app tem que ser a MESMA nos dois destinos.
  const norm = (csp) => Object.fromEntries(
    csp.split(';').map((d) => d.trim()).filter(Boolean)
      .map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v.sort().join(' ')]; }));

  const meta = HTML.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(meta, 'sumiu o <meta> da CSP do index.html');
  const headers = read('_headers').match(/Content-Security-Policy:\s*([^\n]+)/);
  assert.ok(headers, 'sumiu a CSP do arquivo _headers');

  const vm = read('server/node.mjs').match(/const CSP = "([^"]+)"/);
  assert.ok(vm, 'o server/node.mjs parou de definir a CSP — a VM volta a rodar só com o <meta>');

  const copias = { meta: norm(meta[1]), _headers: norm(headers[1]), 'node.mjs': norm(vm[1]) };
  const nomes = Object.keys(copias);
  for (const n of nomes.slice(1)) {
    assert.deepEqual(Object.keys(copias[n]).sort(), Object.keys(copias.meta).sort(),
      `as CSPs de "meta" e "${n}" têm diretivas diferentes`);
  }
  const a = copias.meta;
  for (const k of Object.keys(a)) {
    for (const n of nomes.slice(1)) {
      assert.equal(copias[n][k], a[k],
        `diretiva "${k}" diverge:\n  meta:     ${a[k]}\n  ${n}: ${copias[n][k]}`);
    }
  }
  // O beacon do Web Analytics É injetado, e a CSP precisa dos DOIS hosts.
  //
  // Este guard já exigiu o CONTRÁRIO — que `cloudflareinsights` NÃO aparecesse,
  // por "permissão morta" —, e a premissa vinha de uma medição feita com um
  // `grep` sem o `<` do `<script`, que casava com o próprio COMENTÁRIO do
  // index.html (ele cita o host). O comentário virou a evidência de que o host
  // não era usado. Medido de novo com padrão ancorado e os dois controles
  // (comentário → 0, tag real → 1): 10 de 10 respostas trazem a tag. Bloqueado,
  // o beacon dava 1 erro de CSP por carregamento e o Web Analytics coletava
  // ZERO — enquanto o aviso de privacidade da Ajuda já prometia "medição de
  // acesso sem cookies". `tools/cf-injecao.mjs` mede isso do jeito certo.
  //
  // São dois hosts porque são dois papéis, e isso saiu de LER o beacon, não de
  // supor: o script vem de `static.cloudflareinsights.com` e a telemetria vai
  // pra `https://cloudflareinsights.com/cdn-cgi/rum` (único endpoint externo
  // dentro dos 31612 bytes dele).
  for (const n of nomes) {
    assert.match(copias[n]['script-src'] || '', /https:\/\/static\.cloudflareinsights\.com/,
      `${n}: sem static.cloudflareinsights.com em script-src o beacon injetado é bloqueado a cada carregamento`);
    assert.match(copias[n]['connect-src'] || '', /https:\/\/cloudflareinsights\.com/,
      `${n}: sem cloudflareinsights.com em connect-src o beacon carrega mas não consegue reportar`);
  }
  // E script-src não pode voltar a permitir inline.
  assert.doesNotMatch(a['script-src'] || '', /unsafe-inline/,
    "script-src voltou a permitir inline — um XSS lê o sessionToken de novo");
  assert.doesNotMatch(a['script-src'] || '', /unsafe-eval/, 'unsafe-eval de volta no script-src');
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
  // O nome do local também: o core manda null quando não tem, e quem decide o
  // que aparece é o frontend — hoje pela cadeia de identidade (ver o teste
  // "sem nome, o endereço vira a identidade").
  assert.match(APP_, /function identidadeDoPlace/, 'nome ausente voltou a vir escrito do servidor');
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
  const I18N = read('js/i18n.js');
  assert.equal((I18N.match(/'card\.type\.update':/g) || []).length, N_LINGUAS,
    `card.type.update precisa existir nas ${N_LINGUAS} línguas`);
  // O anúncio pra leitor de tela CONTINUA com a enumeração: lá ela não é
  // repetição, é a única forma de saber o que mudou sem varrer a lista.
  const live = APP_.match(/card\.live\.newRequest[\s\S]{0,200}/)[0];
  assert.match(live, /place\.updateType/, 'o leitor de tela perdeu o detalhe do que mudou');
});

test('a app cabe na tela em QUALQUER aparelho, sem rolagem de página', () => {
  // Num 1366×768 os custos fixos (header 69 + placar 87 + margens 80) mais o
  // card davam 850px: 82px de rolagem que não precisava existir — e rolagem
  // disputa com o gesto de "pular". O card passa a receber a SOBRA por uma
  // cadeia de flex, em vez de um `dvh` chutado.
  //
  // Isto valia só de 768px de largura pra cima. No celular, `h-[min(80dvh,640px)]`
  // vinha de uma fração da JANELA e ignorava os 152px (219 no aparelho estreito,
  // onde o placar vira 2×2) já gastos acima: a barra ✕/↑/✓ nascia ABAIXO DA DOBRA
  // em 4 aparelhos (87px no Fold, 92px deitado, 17px no iPhone SE, 3px no S8+).
  // E não dá pra rolar até ela com o dedo no card — `touch-action: none`, porque
  // arrastar pra cima é "pular". Ação principal fora da tela, sem gesto que a
  // traga de volta.
  for (const alvo of ['body', 'body > main', '#appScreen:not(.hidden)', '#cardStack']) {
    const re = new RegExp(alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*flex');
    assert.match(CSS_SEM_COMENTARIO, re, `a cadeia de flex perdeu o elo "${alvo}"`);
  }
  // `min-height: 0` é o que faz o elo do meio ceder: sem ele o filho flex não
  // encolhe abaixo do conteúdo e a cadeia inteira não serve pra nada.
  for (const alvo of ['body > main', '#appScreen:not\\(\\.hidden\\)']) {
    assert.match(CSS_SEM_COMENTARIO, new RegExp(alvo + '\\s*\\{[^}]*min-height:\\s*0'),
      `"${alvo}" perdeu o min-height: 0 e para de ceder`);
  }
  // A altura mora num lugar só. Classe de altura no HTML volta a competir com a
  // cadeia — e, por vencer no lugar errado, foi ela que criou o bug.
  const stack = HTML.split('\n').find((l) => l.includes('id="cardStack"'));
  assert.ok(stack, 'sumiu o #cardStack');
  assert.doesNotMatch(stack, /\bh-\[|\bmin-h-\[|\bmax-h-\[/,
    'altura de volta no HTML do #cardStack: a fração da janela ignora o que já foi gasto acima');
  // O piso de conforto continua preso à ALTURA, e não à largura: celular DEITADO
  // tem 852px de largura com 393px de altura, e um piso de 26rem ali fica maior
  // que a tela — a rolagem PIORAVA (177 → 259px, medido).
  const piso = CSS.match(/@media \(min-height: 700px\) \{[\s\S]*?\n\}/);
  assert.ok(piso && /min-height:\s*26rem/.test(piso[0]),
    'o piso de 26rem saiu do degrau de altura (ou virou incondicional)');
  assert.doesNotMatch(
    CSS_SEM_COMENTARIO,
    /@media \(min-width: \d+px\) \{[\s\S]*?#cardStack[^}]*min-height:\s*26rem/,
    'piso preso à largura pega celular deitado e piora a rolagem'
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

// ── Convite de instalar ────────────────────────────────────────────────────
// Ninguém estava instalando a app, e a medição explicou por quê: o convite só
// existia dentro do modal de Ajuda, e o iPhone NUNCA dispara
// `beforeinstallprompt` — no Safari a instalação é manual. Nada no código
// perguntava por `display-mode: standalone`, então quem já tinha instalado
// continuaria sendo convidado. O convite agora vive no "Tudo limpo!", que é o
// único momento em que o editor terminou algo e não há próxima ação esperando.

test('o convite de instalar aparece no "Tudo limpo!", não no meio do trabalho', () => {
  const linhas = HTML.split('\n');
  const iPainel = linhas.findIndex((l) => l.includes('id="noMoreCards"'));
  const iConvite = linhas.findIndex((l) => l.includes('id="installInvite"'));
  const iErro = linhas.findIndex((l) => l.includes('id="loadErrorState"'));
  assert.ok(iPainel !== -1 && iConvite !== -1, 'sumiu o #noMoreCards ou o #installInvite');
  assert.ok(iConvite > iPainel && (iErro === -1 || iConvite < iErro),
    'o convite saiu de dentro do "Tudo limpo!" — em qualquer outro lugar ele disputa com o gesto');
  // E quem o atualiza é o próprio showNoPlaces: sem essa chamada ele nunca
  // reavalia (fica visível pra quem acabou de instalar, some pra quem não).
  const app = read('js/app.js');
  const corpo = app.slice(app.indexOf('function showNoPlaces'), app.indexOf('function showNoPlaces') + 1400);
  assert.match(corpo, /atualizarConviteInstalar\(\)/,
    'showNoPlaces parou de reavaliar o convite');
});

test('quem já instalou não é convidado de novo — e o iPhone tem caminho', () => {
  const app = read('js/app.js');
  // Os DOIS sinais: `display-mode: standalone` cobre Android/desktop, e
  // `navigator.standalone` é o único que o iOS dá. Checar só um deixa metade
  // dos instalados sendo convidados pra instalar de novo.
  // Dentro do CORPO da função e sem comentários: procurar a string no arquivo
  // inteiro passava mesmo com a checagem trocada por `false` — sobrava a
  // menção no comentário. (Verificado desfazendo a correção de propósito.)
  const iInst = app.indexOf('function appJaInstalada');
  assert.notEqual(iInst, -1, 'sumiu o appJaInstalada()');
  const instalada = app.slice(iInst, app.indexOf('\n}', iInst)).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  assert.match(instalada, /display-mode:\s*standalone/, 'sumiu a checagem de display-mode: standalone');
  assert.match(instalada, /navigator\.standalone/, 'sumiu a checagem de navigator.standalone (iOS)');
  // iOS não tem beforeinstallprompt: sem os passos manuais, quem usa iPhone
  // fica sem NENHUM caminho — e o pareamento por QR empurra justamente pro
  // celular.
  assert.match(app, /function ehIOS\(/, 'sumiu a detecção de iOS');
  assert.match(HTML, /id="installIosSteps"/, 'sumiram os passos manuais do iPhone');
  for (const chave of ['install.ios.step1', 'install.ios.step2']) {
    assert.ok(HTML.includes(`data-i18n-html="${chave}"`),
      `${chave} precisa de data-i18n-html: o texto tem <strong> e data-i18n (textContent) mostraria a tag crua`);
  }
});

test('"Agora não" é definitivo: o convite não volta na próxima fila zerada', () => {
  const app = read('js/app.js');
  assert.match(app, /waze_places_install_dispensado/, 'sumiu a chave de dispensa do convite');
  const i = app.indexOf('function convitePodeAparecer');
  assert.notEqual(i, -1, 'sumiu o convitePodeAparecer()');
  const corpo = app.slice(i, i + 600);
  assert.match(corpo, /CHAVE_INSTALL_DISPENSADO/,
    'o convite parou de consultar a dispensa — volta a aparecer pra quem já disse não');
});

test('o "Tudo limpo!" não corta o convite quando a tela é curta', () => {
  // Medido: no Fold (280×653) o painel pedia 456px e só 434 apareciam, e
  // deitado (852×393) os PASSOS do iPhone ficavam fora — a instrução, no único
  // aparelho sem botão de instalar. Três defesas, e cada uma cobre um caso.
  //
  // 1. `align-items: center` de flex corta dos DOIS lados quando o conteúdo é
  //    maior que a caixa, e o pedaço de cima fica inalcançável até rolando.
  //    `margin: auto` centraliza igual e cede quando falta espaço.
  assert.match(CSS_SEM_COMENTARIO, /#noMoreCards\s*\{[^}]*overflow-y:\s*auto/,
    'o painel do "Tudo limpo!" parou de rolar quando não cabe');
  assert.match(CSS_SEM_COMENTARIO, /#noMoreCards\s*\{[^}]*align-items:\s*flex-start/,
    'voltou a centralizar por align-items: corta os dois lados e o topo some');
  assert.match(CSS_SEM_COMENTARIO, /#noMoreCards\s+\.empty-inner\s*\{[^}]*margin-top:\s*auto/,
    'sumiu a centralização por margem (a que não corta)');
  // 2. Enfeite sai antes de ação: o selo verde repete o ✓ que o título já diz.
  for (const media of [/@media\s*\(max-height:\s*700px\)\s*and\s*\(max-width:\s*360px\)/,
                       /@media\s*\(max-height:\s*480px\)\s*and\s*\(min-width:\s*600px\)/]) {
    const m = CSS.match(media);
    assert.ok(m, 'sumiu o degrau responsivo do "Tudo limpo!" pra tela curta/estreita');
    const bloco = CSS.slice(m.index, CSS.indexOf('\n}', m.index));
    assert.match(bloco, /#noMoreCards\s+\.empty-badge\s*\{[^}]*display:\s*none/,
      'o selo decorativo voltou a ocupar 64px onde faltava espaço pro botão');
  }
  // 3. Área que rola precisa DIZER que rola (gotcha #29) — senão ninguém rola.
  const app = read('js/app.js');
  const i = app.indexOf('function showNoPlaces');
  assert.match(app.slice(i, i + 1400), /marcarBordaRolagem\(noMore\)/,
    'o painel rola sem aviso nenhum de que há mais conteúdo abaixo');
});

test('deitado, a barra de ações fica sob a FOTO — o texto leva a altura inteira', () => {
  // Com as ações na coluna do texto, sobravam 193px de 268 pro conteúdo, e um
  // UPDATE comum pede 253: o card rolava por dentro nos QUATRO tipos de pedido,
  // e conteúdo que rola desliga o arraste pra cima (gotcha #29). Movendo a barra
  // pra baixo da foto, o texto recebe as duas fileiras e só o caso extremo rola.
  const m = CSS.match(/@media \(max-height: 480px\) and \(min-width: 600px\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'sumiu o degrau de paisagem');
  const bloco = m[0];
  const regra = (sel) => {
    const r = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
    const achado = bloco.match(r);
    assert.ok(achado, `sumiu a regra de paisagem pra "${sel}"`);
    return achado[1];
  };
  assert.match(regra('.place-card .card-actions'), /grid-column:\s*1/,
    'a barra de ações voltou pra coluna do texto e rouba a altura dele');
  assert.match(regra('.place-card .card-content'), /grid-row:\s*1 \/ 3/,
    'o texto perdeu a altura inteira do card');
  assert.match(regra('.place-card .card-photo'), /grid-row:\s*1\s*;/,
    'a foto voltou a ocupar as duas fileiras e empurra a barra pra coluna do texto');
});

test('o placar não "compacta" com regra que não compacta nada', () => {
  // Havia dois cortes inertes no degrau estreito: `font-size: 1.25rem` é
  // exatamente o `text-xl` do HTML (medido: 20px/28px dos dois lados) e
  // `padding: 0.75rem` era MAIOR que o `p-2`, custando 8px a mais justamente no
  // aparelho mais apertado — enquanto o comentário dizia recuperar 25px.
  // Sem comentário: o texto que EXPLICA a regra proibida contém a regra
  // proibida, e o guard acusaria a própria documentação.
  const estreito = CSS_SEM_COMENTARIO.match(/@media \(max-width: 359\.98px\) \{[\s\S]*?\n\}/);
  assert.ok(estreito, 'sumiu o degrau de placar estreito');
  assert.doesNotMatch(estreito[0], /#placar\s*\{[^}]*padding:\s*0\.75rem/,
    'o placar voltou a ganhar padding no aparelho mais apertado');
  assert.doesNotMatch(estreito[0], /font-size:\s*1\.25rem/,
    'voltou o "corte" de font-size que é idêntico ao text-xl do HTML');
  // A compactação de verdade é por ALTURA — é ela que decide se o card rola.
  // TODOS os degraus de altura, não o primeiro: assim que um segundo bloco
  // `max-height: 700px` entrou no arquivo (a faixa do treino), o `match` simples
  // passou a auditar o bloco ERRADO e reprovou uma regra intacta. Guard preso à
  // posição no arquivo mede outra coisa a cada edição.
  const baixos = [...CSS_SEM_COMENTARIO.matchAll(/@media \(max-height: 700px\) \{[\s\S]*?\n\}/g)].map((m) => m[0]);
  assert.ok(baixos.length, 'sumiu o degrau de tela baixa');
  const baixo = [baixos.join('\n')];
  assert.ok(/#placar\s*\{[^}]*padding:/.test(baixo[0]),
    'o placar deixou de compactar em tela baixa');
  // O rótulo tem piso: 11px é o mínimo legível (M3) e ele já está nele.
  assert.doesNotMatch(baixo[0], /#placarGrid[^}]*font-size:\s*0\.6[0-4]/,
    'rótulo do placar abaixo do piso de 11px');
});

// ── Dica "você nunca desfaz" ───────────────────────────────────────────────
// O aviso de desbloqueio dispara na TRANSIÇÃO de cruzar a cota, e por isso não
// alcança quem já estava acima dela quando a comemoração foi lançada
// (`initUndoGateSeen` marca essa pessoa como "já viu"). Resultado real,
// relatado por um editor: os mais ativos são justamente os que nunca ficaram
// sabendo que a espera de 3s pode ser desligada — e são os que mais perdem com
// ela. Este gatilho não depende de transição: conta janelas que expiraram sem
// ninguém desfazer.
test('a dica do Desfazer nasce de evidência, não de transição', () => {
  const app = read('js/app.js');
  // Só a expiração NATURAL conta. `execute()` forçado (sair da página, trocar
  // filtro) despacha sem dar a janela inteira — não é decisão de não desfazer.
  const timer = app.match(/const timerId = setTimeout\(\(\) => \{[\s\S]*?\}, UNDO_WINDOW_MS\);/);
  assert.ok(timer, 'sumiu a janela do Desfazer');
  assert.match(timer[0], /registrarJanelaSemUndo\(\)/,
    'a janela expira sem registrar a evidência — a dica nunca dispara');
  const forcado = app.match(/execute: \(\) => \{[\s\S]*?\n        \}/);
  assert.ok(forcado && !/registrarJanelaSemUndo/.test(forcado[0]),
    'despacho forçado conta como "não desfez" e infla a evidência');
  // Quem desfaz de vez em quando não é o público da dica.
  const undo = app.match(/undo: \(\) => \{[\s\S]*?\n        \}/);
  assert.ok(undo, 'sumiu o undo da ação pendente');
  assert.match(undo[0], /zerarJanelasSemUndo\(\)/, 'desfazer deixou de zerar a evidência');
});

test('a dica só aparece quando dá pra agir, e uma vez só', () => {
  const app = read('js/app.js');
  const i = app.indexOf('function checkDicaDesfazer');
  assert.notEqual(i, -1, 'sumiu o checkDicaDesfazer()');
  const corpo = app.slice(i, app.indexOf('\n}', i));
  // Nunca ofereça o que não dá pra fazer AQUI (regra de ouro de interface):
  // sem passar a cota o toggle está desabilitado e a dica vira beco sem saída.
  assert.match(corpo, /if \(!canDisableUndo\(\)\) return/,
    'a dica passou a oferecer o que o gate ainda bloqueia');
  assert.match(corpo, /dicaDesfazerVista/, 'a dica perdeu o marcador de "uma vez só"');
  assert.match(corpo, /undoEnabled === false\) return/,
    'a dica é oferecida a quem já desligou a espera');
  // Conquista e dica dizem a mesma coisa: quem recebe uma não recebe a outra.
  const j = app.indexOf('function checkUndoGateUnlock');
  const conquista = app.slice(j, app.indexOf('showToast', j));
  assert.match(conquista, /dicaDesfazerVista = true/,
    'cruzar a cota não silencia a dica — os dois banners saem quase juntos');
});

test('a Ajuda conta que a espera do Desfazer pode ser desligada', () => {
  // A opção existia sem estar escrita em lugar nenhum: quem não recebeu o aviso
  // só descobriria abrindo Filtros → Preferências por acaso.
  assert.match(HTML, /data-i18n-html="help\.howToUse\.step6"/,
    'a Ajuda parou de mencionar a preferência (e o markup exige data-i18n-html)');
});

// ── Contrato do "Sair" ─────────────────────────────────────────────────────
// Decisão do owner, e o motivo importa: "se pedir para sair, é realmente para
// sair/limpar de tudo" — privacidade, não conveniência. Só que nada impedia
// alguém de gravar uma chave nova no localStorage e esquecer de apagá-la; foi
// exatamente o que aconteceu com o marcador do convite de instalar, que ficou
// pra trás por descuido. Este guard obriga QUEM CRIA uma chave a decidir o que
// acontece com ela no logout — apagar ou justificar por que fica.
test('toda chave gravada no aparelho é resolvida no logout', () => {
  const app = read('js/app.js');
  const api = read('js/api.js');
  const fonte = app + '\n' + api;

  // Apagadas no logout, cada uma pelo seu meio. Sobrescrever com o padrão
  // (saveStats e cia.) conta: o valor antigo deixa de existir.
  const APAGADAS = {
    STATS_KEY: 'saveStats()',
    FILTERS_KEY: 'saveFilters()',
    PREFERENCES_KEY: 'savePreferences()',
    DEVMODE_KEY: 'saveDevMode()',
    HISTORY_KEY: 'safeLS.remove(HISTORY_KEY)',
    CHAVE_INSTALL_DISPENSADO: 'safeLS.remove(CHAVE_INSTALL_DISPENSADO)',
    SESSAO_KEY: 'esquecerPrazoDaSessao()',
    waze_session_token: 'API.setSession(null)',
    waze_region: "API.setRegion('row')",
    waze_country: 'API.setCountry(30)',
  };
  // Ficam de propósito: são preferências do APARELHO, não dados de quem entrou.
  // Apagar o idioma seria hostil — devolveria a pessoa a uma língua que ela
  // pode não ler, justamente quando está deslogada e sem o botão de Filtros.
  const MANTIDAS = ['THEME_KEY', 'LANG_KEY'];
  // Literais `waze*` que NÃO são chave de armazenamento. Categoria própria de
  // propósito: pôr em MANTIDAS diria "fica no logout", e não há nada gravado
  // pra ficar — seria documentar errado. O guard varre por prefixo (é o que o
  // torna difícil de burlar), então todo `waze*` que não for chave precisa ser
  // declarado aqui, com o motivo.
  const NAO_SAO_CHAVES = {
    wazeplaces: 'marca do protocolo de postMessage com a extensão (source do pedido)',
    'wazeplaces-ext': 'idem, a marca das respostas DELA',
  };

  // Nome da constante quando existe; senão a própria chave literal.
  const porConstante = new Map();
  for (const m of fonte.matchAll(/const\s+([A-Z_a-z]+)\s*=\s*'(waze[_a-z0-9]*)'/g)) {
    porConstante.set(m[2], m[1]);
  }
  const chaves = new Set();
  // Aceita o hífen no padrão pra que `wazeplaces-ext` seja CAPTURADO e tenha
  // que ser classificado, em vez de escapar da varredura por causa do traço.
  for (const m of fonte.matchAll(/'(waze[-_a-z0-9]*)'/g)) chaves.add(m[1]);

  const naoClassificadas = [];
  for (const chave of chaves) {
    const nome = porConstante.get(chave) || chave;
    if (chave in NAO_SAO_CHAVES) continue;
    if (!(nome in APAGADAS) && !MANTIDAS.includes(nome)) naoClassificadas.push(`${chave} (${nome})`);
  }
  assert.equal(naoClassificadas.length, 0,
    'chave nova no armazenamento sem decisão de logout — apague em handleLogout ou\n'
    + 'declare em MANTIDAS aqui, com o motivo:\n' + naoClassificadas.join('\n'));

  const i = app.indexOf('async function handleLogout');
  assert.notEqual(i, -1, 'sumiu o handleLogout');
  const corpo = app.slice(i, app.indexOf('\nfunction resetQueue', i));
  for (const [nome, chamada] of Object.entries(APAGADAS)) {
    assert.ok(corpo.includes(chamada), `o logout parou de limpar ${nome} (esperava "${chamada}")`);
  }
});

test('o logout não espera a rede pra limpar o aparelho, e não falha calado', () => {
  const app = read('js/app.js');
  const i = app.indexOf('async function handleLogout');
  const corpo = app.slice(i, app.indexOf('\nfunction resetQueue', i));
  // Ordem: o token sai do armazenamento ANTES de qualquer await de rede. Pedir
  // pra sair tem que ser instantâneo — a exclusão remota é melhor-esforço.
  const posLimpeza = corpo.indexOf('API.setSession(null)');
  const posRede = corpo.indexOf('API.destroySession(');
  assert.ok(posLimpeza !== -1 && posRede !== -1, 'sumiu a limpeza local ou a exclusão remota');
  assert.ok(posLimpeza < posRede, 'a limpeza local voltou a esperar a rede');
  // E a exclusão no servidor não pode falhar em silêncio: o `_post` devolve
  // erro em vez de lançar, então sem isto ninguém ficava sabendo.
  assert.match(corpo, /callWithRetry\(\(\) => API\.destroySession\(/,
    'a exclusão no servidor perdeu a retentativa');
  assert.match(corpo, /toast\.logoutServerFailed/,
    'a exclusão no servidor voltou a falhar sem avisar o editor');
});

test('a Ajuda diz o que a app guarda, por quanto tempo e como apagar', () => {
  // GDPR Art. 13 / LGPD Art. 9 — mas antes disso é confiança: a app pede os
  // cookies de sessão do editor, que permitem agir no Waze em nome dele.
  for (const chave of ['help.privacy.server', 'help.privacy.notStored', 'help.privacy.retention',
                       'help.privacy.device', 'help.privacy.credentials', 'help.privacy.infra']) {
    assert.ok(HTML.includes(`data-i18n="${chave}"`), `a Ajuda perdeu "${chave}"`);
  }
  // Canal para exercício de direitos (LGPD Art. 18) — com link, então -html.
  assert.ok(HTML.includes('data-i18n-html="help.privacy.contact"'),
    'sumiu o contato do responsável pelos dados');
  // Sair da app não desloga do Waze: sem isto, quem sai preocupado conclui que
  // cortou o acesso — e não cortou.
  assert.ok(HTML.includes('data-i18n-html="modal.logout.waze"'),
    'o diálogo de sair parou de avisar que os cookies seguem válidos no Waze');
});

// ── Ritmo e endereço das chamadas ao Waze (instruções permanentes do owner) ──
// Duas regras que protegem a CONTA DELE, não a minha, e que por isso não podem
// depender de eu lembrar: (1) sempre jitter, de uma fonte única; (2) a URL do
// WME é sempre a canônica, sem segmento de idioma.
test('jitter das chamadas ao Waze vem de uma fonte única', () => {
  const jit = read('tools/waze-jitter.mjs');
  assert.match(jit, /export async function pausaComJitter/, 'sumiu o pausaComJitter compartilhado');
  const min = Number(jit.match(/JITTER_MIN_MS = (\d+)/)?.[1]);
  const max = Number(jit.match(/JITTER_MAX_MS = (\d+)/)?.[1]);
  assert.ok(min >= 1000, `jitter mínimo caiu pra ${min}ms — o owner pediu "vá devagar"`);
  assert.ok(max > min, 'faixa de jitter inválida (max <= min): sem faixa não há aleatoriedade');
  assert.match(jit, /Math\.random\(\)/, 'o jitter virou pausa FIXA — intervalo constante é assinatura de automação');

  // Quem fala com o Waze importa daqui em vez de inventar o seu setTimeout.
  const probe = read('tools/waze-probe.mjs');
  assert.match(probe, /from '\.\/waze-jitter\.mjs'/, 'o probe parou de usar a fonte única do jitter');
  assert.match(probe, /await pausaComJitter\(\)/, 'o probe parou de esperar entre chamadas');
  assert.doesNotMatch(probe, /setTimeout\([^)]*\d{3,}\)/,
    'apareceu setTimeout com número no probe — use pausaComJitter(), não pausa própria');
});

test('a URL do WME é sempre a canônica, sem segmento de idioma', () => {
  for (const arq of ['js/app.js', 'server/core.mjs']) {
    const src = read(arq);
    assert.match(src, /const WME_EDITOR_URL = 'https:\/\/www\.waze\.com\/editor'/,
      `${arq} precisa declarar WME_EDITOR_URL com a URL canônica`);
  }
  // Nenhum lugar do código volta a cravar locale numa URL do waze.com. O probe
  // é exceção declarada: ele VARIA o Referer de propósito pra medir se importa.
  const fontes = ['js/app.js', 'js/i18n.js', 'server/core.mjs', 'index.html'];
  const cravados = [];
  for (const arq of fontes) {
    for (const m of read(arq).matchAll(/https:\/\/www\.waze\.com\/([a-z]{2}(?:-[A-Z]{2})?)\//g)) {
      cravados.push(`${arq} → /${m[1]}/`);
    }
  }
  assert.equal(cravados.length, 0,
    'URL do waze.com com idioma cravado (o editor cai num WME que não é o dele):\n' + cravados.join('\n'));
});

// ── O voltar do aparelho fecha a camada de cima ───────────────────────────
// Pedido de uma editora: no ritmo do swipe, ir até o ✕ do lightbox quebra a
// cadência. O risco desta feature não é ela não funcionar — é ela funcionar
// PELA METADE: se a camada fecha por outro caminho (✕, Esc, scrim) sem consumir
// a entrada de histórico, sobra uma entrada MORTA e o próximo voltar não faz
// nada. A pessoa aperta, vê a tela parada, aperta de novo e SAI DA APP. Pior
// que o ✕ que motivou o pedido.
test('voltar fecha camada, e todo fechamento consome a entrada', () => {
  const app = read('js/app.js');
  assert.match(app, /const CamadaVoltar = \{/, 'sumiu o CamadaVoltar');
  assert.match(app, /history\.pushState/, 'ninguém empilha entrada de histórico');
  assert.match(app, /addEventListener\('popstate'/, 'ninguém escuta o voltar');

  // Os DOIS fechadores consomem quando não vieram do próprio popstate.
  const lb = app.match(/close\(\{ viaHistorico = false \} = \{\}\) \{[\s\S]*?\n {4}\}/);
  assert.ok(lb, 'o Lightbox.close perdeu o parâmetro viaHistorico');
  assert.match(lb[0], /if \(!viaHistorico\) CamadaVoltar\.consumir\(\)/,
    'fechar o lightbox pelo ✕ não consome a entrada — o próximo voltar fica morto');

  const cm = app.match(/function closeModal\([^)]*\)[\s\S]*?\n\}/);
  assert.ok(cm, 'sumiu o closeModal');
  assert.match(cm[0], /if \(!viaHistorico\) CamadaVoltar\.consumir\(\)/,
    'fechar modal por Esc/scrim não consome a entrada');

  // Trocar de modal NÃO pode empilhar de novo: openModal fecha o anterior antes
  // de abrir o novo, então duas entradas deixariam um voltar sem efeito.
  const om = app.match(/function openModal\(id\)[\s\S]*?\n\}/);
  assert.ok(om, 'sumiu o openModal');
  assert.match(om[0], /if \(!jaHaviaModal\) CamadaVoltar\.empilhar\(\)/,
    'openModal empilha mesmo trocando de modal — um voltar passaria a não fechar nada');

  // O popstate precisa distinguir o pop que NÓS causamos do pop do usuário.
  assert.match(app, /if \(CamadaVoltar\.consumindo\)/,
    'o popstate não distingue o pop que nós causamos — fecharia duas camadas de uma vez');
});

// A dica do lightbox precisa citar o arrastar pra baixo: o gesto existe desde
// sempre e não estava escrito em lugar nenhum, o que é metade da reclamação
// original (a pessoa ia no ✕ porque não sabia que dava pra arrastar).
test('a dica do lightbox conta que arrastar pra baixo fecha', () => {
  const i18n = read('js/i18n.js');
  const dicas = [...i18n.matchAll(/'lightbox\.zoomHint':\s*'([^']*)'/g)].map((m) => m[1]);
  assert.ok(dicas.length >= 4, `só ${dicas.length} dicas — faltou língua`);
  for (const d of dicas) {
    assert.match(d, /fechar|close|cerrar|fermer/i,
      `a dica não diz como fechar: "${d}"`);
  }
});

// ── Foco num autor ────────────────────────────────────────────────────────
// 42% da fila vem de quem enviou 3+ pedidos. Tocar no selo traz os dele pra
// frente. É PRIORIZAÇÃO, não filtragem, e a diferença não é semântica: esconder
// os outros faria a fila "esvaziar" e a app mostrar "Tudo limpo!" com mais de
// cem pendentes. O guard trava as duas propriedades que sustentam isso.
test('foco num autor prioriza sem esconder ninguém', () => {
  const app = read('js/app.js');
  const f = app.match(/function focarAutor\(nome\)[\s\S]*?\n\}/);
  assert.ok(f, 'sumiu o focarAutor');
  // Reordena a fila INTEIRA: os do autor na frente, o resto atrás. Trocar por
  // um filter() que descarta o resto reprova aqui.
  assert.match(f[0], /\.\.\.daPessoa, \.\.\.AppState\.queue\.filter\(\(x\) => x\.createdBy !== nome\)/,
    'o foco passou a DESCARTAR os outros pedidos — a fila esvaziaria e a app diria "Tudo limpo!" mentindo');

  // A barra some sozinha quando a série acaba, senão fica anunciando um foco
  // que não existe mais assim que o card muda de autor.
  const r = app.match(/function renderFocoAutor\(\)[\s\S]*?\n\}/);
  assert.ok(r, 'sumiu o renderFocoAutor');
  assert.match(r[0], /atual\.createdBy !== nome/,
    'a barra parou de conferir se o card ainda é do autor em foco');

  // O alvo é a barra INTEIRA, não um ✕ dentro dela: no ritmo do swipe, alvo
  // pequeno é toque errado, e toque errado aqui trata o pedido errado.
  const html = read('index.html');
  const bar = html.match(/<button id="focoAutorBar"[\s\S]*?<\/button>/);
  assert.ok(bar, 'sumiu a barra de foco');
  assert.match(bar[0], /min-h-\[44px\]/, 'a barra perdeu a altura mínima de alvo');
  // Ocupar a largura toda é a PROPRIEDADE; `w-full` era só como ela estava
  // escrita quando a barra empurrava o layout. Flutuando, quem estica é o par
  // left/right. Casar a implementação antiga reprovou a correção — foi o que
  // aconteceu: guard escrito antes da barra virar flutuante.
  const estica = /w-full/.test(bar[0]) || (/\bleft-\d/.test(bar[0]) && /\bright-\d/.test(bar[0]));
  assert.ok(estica, 'a barra deixou de ocupar a largura toda — o alvo encolheu');
  // E flutuar é parte do desenho: empurrando custava 60px e nas telas baixas a
  // página passava a rolar com os botões de ação fora da tela.
  assert.match(bar[0], /absolute/, 'a barra voltou a empurrar o layout em vez de flutuar');
  assert.doesNotMatch(bar[0], /<button[\s\S]*<button/, 'apareceu botão DENTRO da barra: o ✕ é ícone, não alvo');
});

test('linha "X → X" não chega na tela, e o aviso só afirma o que foi comparado', () => {
  const CORE = read('server/core.mjs');
  const APP = read('js/app.js');
  const HTML_ = read('index.html');

  // O filtro mora no CORE porque só lá existe o valor CRU. No frontend já é
  // tarde: a geometria chega formatada, e dois polígonos diferentes podem
  // imprimir IGUAL — medido, um deles andou 84 metros. Filtrar por texto
  // esconderia mudança de verdade.
  assert.match(CORE, /export const mesmoValor/, 'sumiu o comparador de valor cru');
  assert.match(CORE, /if \(mesmoValor\(venue\[k\] \?\? null, newValue \?\? null\)\) \{/,
    'o laço de changes parou de pular campo que não mudou — volta a linha "X → X"');
  assert.match(CORE, /camposSemMudanca\+\+/, 'ninguém mais conta os campos filtrados');
  assert.match(CORE, /camposSemMudanca,/, 'o place parou de expor camposSemMudanca pro card');

  // Duas causas MUITO diferentes de "nenhuma linha", e só uma pode virar
  // afirmação: comparamos e nada muda × não veio nada pra comparar.
  assert.match(APP, /if \(place\.camposSemMudanca > 0\)/,
    'o card afirma "nada a alterar" sem saber se houve o que comparar');
  const aviso = HTML_.split('\n').find((l) => l.includes('card-sem-diferenca hidden'));
  assert.ok(aviso, 'sumiu o aviso de "nada a alterar" do template');
  assert.match(aviso, /flex-shrink-0/,
    'o aviso virou o elemento que encolhe no lugar da caixa longa (gotcha #29)');
  assert.match(aviso, /\bhidden\b/, 'o aviso deixou de nascer escondido');

  // Geometria NUNCA pode cair no diff de objeto: ela é objeto simples e o
  // sequestro desta linha desfaz em silêncio o "moveu 84 m" (aconteceu).
  assert.match(CORE, /else if \(k !== 'geometry'\)/,
    'geometria voltou a entrar no diff de objeto — o "moveu N m" vira coordenada crua');
  assert.match(APP, /c\.field !== 'geometry' && c\.objDelta/,
    'sumiu a guarda dupla que mantém a linha de geometria fora do diff de objeto');

  // Objeto/array chegando no valor do diff vira "[object Object]" no String().
  assert.match(APP, /if \(typeof v === 'object'\) \{[\s\S]{0,120}JSON\.stringify/,
    'valorDoDiff voltou a poder imprimir [object Object]');
});

test('objeto desconhecido no card não vira JSON nem [object Object]', () => {
  const APP = read('js/app.js');
  const CORE = read('server/core.mjs');

  // Objeto que a app não conhece (o Waze acrescenta campo sem avisar) tem que
  // sair legível: `chave valor · chave valor`, sem chaves nem aspas. A regra
  // segue sendo "feio, nunca invisível" — nenhuma chave e nenhum valor somem.
  assert.match(APP, /function objetoLegivel/, 'sumiu o formatador de objeto desconhecido');
  const fn = APP.match(/function objetoLegivel\(v, prof = 0\)[\s\S]*?\n\}/)[0];
  assert.match(fn, /prof >= 2/,
    'sumiu o teto de profundidade — aninhamento fundo vira sopa de palavras');
  assert.match(fn, /join\(' · '\)/, 'mudou o separador sem passar pela régua de consistência');
  // O fallback de JSON continua existindo lá no fundo: sumir com informação é
  // pior que ser feio, e essa ordem de prioridade é decisão registrada.
  assert.match(fn, /JSON\.stringify/, 'o fallback sumiu — objeto fundo ficaria invisível');
  // E o valorDeLista precisa CHAMAR o formatador, senão o JSON volta calado.
  assert.match(APP, /return objetoLegivel\(v\);/,
    'valorDeLista voltou a serializar objeto desconhecido em JSON');

  // Folha de objeto que é lista usa o MESMO vocabulário do campo de lista de
  // topo (+ entra, − sai): o card não pode ter duas gramáticas pra mesma ideia.
  assert.match(CORE, /const delta = diffDeLista\(linha\.de, linha\.para\);/,
    'folha de objeto que é lista parou de virar delta');
  assert.match(APP, /diff-obj-linha-lista/, 'sumiu a linha própria da folha-lista');
});

test('item de lista vazio aparece como placeholder, e o esmaecido não derruba o contraste', () => {
  const APP = read('js/app.js');
  const CSS = read('css/styles.css');

  // O Waze manda lista com item vazio: medido na fila real, um pedido do
  // "Posto Equador" propunha `services: [""]`. O card mostrava `Serviços: +` e
  // mais nada — lê como app quebrada, não como "adicionando um item vazio".
  assert.match(APP, /function itemDeListaAusente/, 'sumiu a detecção de item de lista vazio');
  const fn = APP.match(/function valorDeLista\([^)]*\)[\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(itemDeListaAusente\(v\)\) return t\('card\.value\.empty'\);/,
    'item de lista vazio voltou a sair como string vazia');

  // UM renderizador só. Eram dois trechos idênticos copiados — é assim que duas
  // telas do mesmo conceito divergem sem ninguém notar.
  assert.match(APP, /function itemDeLista\(v, cls, sinal, campo\)/,
    'o renderizador de item perdeu o campo — sem ele a tradução de serviço não tem como ser escopada');
  assert.equal((APP.match(/const item = \(v, cls, sinal\)/g) || []).length, 0,
    'voltou a existir renderizador de item duplicado');

  // O esmaecido do placeholder SAI dentro do +/−: o 0.8 foi medido pro
  // slate-700 sobre branco, e sobre o verde do diff dá 3.41:1 — reprova no
  // WCAG 1.4.3. O itálico fica, porque quem carrega a informação é o texto
  // entre parênteses; o estilo é reforço (WCAG 1.4.1).
  assert.match(CSS, /\.diff-add \.valor-ausente,\s*\n\.diff-del \.valor-ausente \{\s*\n\s*opacity: 1;/,
    'o esmaecido voltou pro item de lista — contraste cai pra 3.41:1 sobre o verde');
});

test('um 401 sozinho não derruba o editor da sessão', () => {
  const APP = read('js/app.js');
  const API_ = read('js/api.js');

  // Relato do owner: mandado pra tela de login sem ter pedido pra sair, com
  // DOIS toasts de "Sessão expirou" empilhados. Três coisas chegam como 401 e
  // só UMA exige relogar: cookies mortos de verdade, 403 do Waze por
  // rajada/WAF, e blip do KV. Só uma segunda chamada distingue.
  assert.match(APP, /async function handleUnauthorized\(\)/,
    'handleUnauthorized voltou a ser síncrono — não dá pra confirmar antes de derrubar');
  assert.match(APP, /const r = await API\.getProfile\(\);/,
    'sumiu a chamada que confirma se a sessão morreu mesmo');
  // Este guard já exigiu o literal `r.errorCategory !== 'unauthorized'` — e
  // ESSE literal era o bug: inferir "viva" da AUSÊNCIA do carimbo fazia um 401
  // sem categoria (o do nosso próprio store) passar por alarme falso, mantendo
  // a sessão morta e mostrando "conexão instável" pra sempre. Guard acoplado à
  // FORMA atesta a forma, não a intenção. O que precisa ser verdade é que a
  // morte seja decidida por sinais POSITIVOS e nomeados.
  assert.match(APP, /errorCategory === 'unauthorized'/,
    'a morte da sessão precisa ser decidida por um sinal POSITIVO, não pela ausência de um');
  for (const chave of ['srv.err.sessionExpired', 'srv.err.sessionMissing', 'srv.err.cookiesExpired']) {
    assert.ok(new RegExp(`errorKey === '${chave.replace(/\./g, '\\.')}'`).test(APP),
      `${chave} precisa contar como sessão morta — sem isso ela vira "conexão instável" eterna`);
  }
  assert.match(APP, /function derrubarSessao\(/, 'sumiu a derrubada explícita');

  // A confirmação também diz de QUAL lado falhou. O core já mandava chaves
  // diferentes e o frontend juntava numa frase só — separar transforma a
  // próxima ocorrência em evidência, sem precisar de HAR nem de novo cookie.
  assert.match(APP, /'srv\.err\.cookiesExpired': 'toast\.sessionExpired\.waze'/,
    'sumiu a distinção "o Waze recusou" × "nossa sessão venceu"');
  assert.match(APP, /'srv\.err\.sessionExpired': 'toast\.sessionExpired\.local'/,
    'sumiu a distinção da sessão local');
  assert.match(APP, /derrubarSessao\(r && r\.errorKey\)/,
    'a derrubada parou de receber o motivo — volta a frase única');
  // Chave desconhecida cai na frase genérica: vaga é ruim, errada é pior.
  assert.match(APP, /MOTIVO_DA_QUEDA\[errorKey\] \|\| 'toast\.sessionExpired'/,
    'sumiu o fallback pra chave que não conhecemos');

  // Trava de concorrência: ao abrir a app saem TRÊS chamadas ao Waze quase
  // juntas (perfil, países, busca). Sem ela, cada 401 fazia sua verificação e
  // seu toast — foi o que produziu os dois toasts do print.
  assert.match(APP, /if \(verificandoSessao \|\| !AppState\.authenticated\) return;/,
    'sumiu a trava — 401 concorrentes voltam a derrubar e a avisar N vezes');

  // A camada de TRANSPORTE não decide logout. Apagar ali tomava a decisão
  // antes de qualquer verificação e sem chance de retry.
  const post = API_.match(/async _post\(endpoint, body\)[\s\S]*?\n    \},/)[0];
  assert.doesNotMatch(post.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'),
    /setSession\(null\)/,
    'o _post voltou a apagar a sessão — decide logout antes de qualquer verificação');
});

test('a foto ampliada fecha pelos caminhos das DUAS plataformas', () => {
  const APP = read('js/app.js');
  // Ancora no handleKeyDown: há DOIS `if (Lightbox.isOpen())` no arquivo — o
  // outro é do popstate (botão voltar do aparelho), e a primeira versão deste
  // guard pegou o errado e reprovou o estado correto.
  // Âncora em DUAS etapas: primeiro o corpo do handleKeyDown, depois o bloco
  // da foto dentro dele. A primeira versão exigia que o bloco da foto fosse a
  // PRIMEIRA instrução da função — acoplado à posição, não à intenção — e
  // reprovou quando o mapa ampliado entrou acima dela, que é o lugar certo
  // dele. Guard preso à posição já mordeu neste repo; o que precisa continuar
  // valendo é o bloco da foto existir e tratar as teclas certas.
  const corpo = APP.match(/function handleKeyDown\(e\) \{[\s\S]*?\n\}/);
  assert.ok(corpo, 'sumiu o handleKeyDown');
  const bloco = corpo[0].match(/if \(Lightbox\.isOpen\(\)\) \{[\s\S]*?\n    \}/);
  assert.ok(bloco, 'sumiu o tratamento de teclado da foto ampliada');
  const teclas = bloco[0];

  // O mapa ampliado é a camada de CIMA: quando ele está aberto, Esc tem que
  // fechar ELE e não a foto. Ordem no código é o que decide isso — o bloco do
  // mapa precisa vir antes, e sair com `return` pra não cair no da foto.
  const iMapa = corpo[0].indexOf('MapaLightbox.isOpen()');
  const iFoto = corpo[0].indexOf('Lightbox.isOpen()', corpo[0].indexOf('MapaLightbox.isOpen()') + 21);
  assert.ok(iMapa >= 0, 'o mapa ampliado não trata teclado — Esc não fecharia ele');
  assert.ok(iMapa < iFoto, 'o bloco da foto vem antes do mapa: Esc fecharia a camada errada');

  // Esc é a convenção de desktop e continua sendo o caminho principal.
  assert.match(teclas, /e\.key === 'Escape'[\s\S]{0,60}Lightbox\.close\(\)/,
    'Esc deixou de fechar a foto');

  // ↓ espelha o arraste pra baixo do toque. Relato do owner: aprendeu o gesto
  // no celular, sentou no laptop e a mão foi pro ↓.
  assert.match(teclas, /e\.key === 'ArrowDown'[\s\S]{0,60}Lightbox\.close\(\)/,
    'a tecla ↓ parou de fechar a foto');

  // Só BAIXO: o toque fecha com `dy > 80`, e só. Inventar ↑ criaria um gesto
  // que o celular não tem — a app ficaria ensinando duas coisas diferentes.
  assert.doesNotMatch(teclas, /e\.key === 'ArrowUp'/,
    '↑ ganhou função na foto — o toque não fecha pra cima');

  // E as horizontais seguem TROCANDO de foto, não fechando.
  assert.match(teclas, /e\.key === 'ArrowLeft'[\s\S]{0,60}Lightbox\.prev\(\)/, '← deixou de trocar de foto');
  assert.match(teclas, /e\.key === 'ArrowRight'[\s\S]{0,60}Lightbox\.next\(\)/, '→ deixou de trocar de foto');

  // O arraste do toque é só pra baixo — é daqui que a tecla ↓ tira a razão.
  assert.match(APP, /dy > 80 && Math\.abs\(dy\) > Math\.abs\(dx\)/,
    'mudou o gesto de arraste da foto sem revisitar a tecla que o espelha');
});

test('card: UMA gramática de rótulo, e a caixa do reporte só existe com texto', () => {
  const HTML_ = read('index.html');
  const APP_ = read('js/app.js');

  // ── uma gramática só ──────────────────────────────────────────────────
  // Categorias e Endereço eram as ÚNICAS linhas com caixinha de ícone +
  // rótulo empilhado, enquanto Tipo/Criador/Marca/Motivo eram "RÓTULO: valor"
  // numa linha. Duas gramáticas pra dizer a mesma coisa é o que a regra de
  // ouro de consistência proíbe — e custava caro: o ícone sozinho tem 36px de
  // piso (p-2 + svg de 20px), então cada uma dessas linhas ia a 43-63px onde
  // as compactas ficam em 20. Medido: 156 dos 1872 renders da fila real
  // estouravam, e junto com o motivo fora da caixa isso zerou.
  for (const linha of ['card-category-row', 'card-address-row']) {
    const l = HTML_.split('\n').find((x) => x.includes(`class="${linha} `));
    assert.ok(l, `sumiu a linha .${linha}`);
    assert.match(l, /\bflex items-baseline\b/,
      `.${linha} saiu do padrão "RÓTULO: valor" — volta a custar 43-63px`);
    assert.doesNotMatch(l, /items-start/,
      `.${linha} voltou ao desenho empilhado com ícone`);
  }
  // O rótulo delas termina em dois-pontos como os irmãos. Sem isso a tela mostra
  // "CATEGORIAS Padaria" ao lado de "TIPO: Reporte" — o editor lê como defeito.
  const DICT = read('js/i18n.js');
  for (const chave of ['card.categories', 'card.address', 'card.type', 'card.creator']) {
    for (const m of DICT.matchAll(new RegExp(`'${chave.replace('.', '\\.')}': '([^']*)'`, 'g'))) {
      assert.match(m[1], /:$/,
        `${chave} = "${m[1]}" não termina em dois-pontos, e as linhas vizinhas terminam`);
    }
  }

  // ── a caixa do reporte segura o COMENTÁRIO, não o motivo ───────────────
  // O motivo é a informação principal, e em 40% dos reportes é a ÚNICA (medido
  // em 438 de 13 países — o número antigo aqui, "15 de 17", vinha de uma
  // amostra pequena e brasileira). Dentro da caixa, ele carregava junto ~40px
  // de moldura — borda + padding + cabeçalho — pra exibir uma linha.
  const iMotivo = HTML_.indexOf('card-flag-reason');
  const iCaixa = HTML_.indexOf('card-flag-comment ');
  assert.ok(iMotivo > 0 && iCaixa > 0, 'sumiu o motivo ou a caixa do reporte');
  assert.ok(iMotivo < iCaixa,
    'o motivo voltou pra dentro da caixa — com comentário vazio sobra moldura sem conteúdo');
  // E o JS não pode mais abrir a caixa sem texto.
  // Contar caracteres entre duas âncoras é frágil — o bloco cresceu e a
  // asserção quebrou sem nada de errado ter acontecido. Aqui se RECORTA o
  // bloco do `if` e se pergunta o que importa: ele mostra a caixa, e a
  // mostrada é a do comentário.
  const iIf = APP_.indexOf('if (place.flagComment) {');
  assert.ok(iIf > 0, 'sumiu o guard `if (place.flagComment)` do render');
  const blocoIf = APP_.slice(iIf, APP_.indexOf('\n    }', iIf));
  assert.match(blocoIf, /card-flag-comment'\)/, 'o bloco não seleciona mais a caixa do comentário');
  assert.match(blocoIf, /classList\.remove\('hidden'\)/,
    'a caixa do reporte voltou a aparecer sem comentário');

  // ── o comentário ROLA dentro da caixa, numa janela de linhas INTEIRAS ──
  // Duas coisas erradas já moraram aqui, e o teste tem que barrar as duas:
  //
  //  (a) a caixa reivindicava a sobra (`flex-1 min-h-0`) e absorvia todo o
  //      déficit — 10px de altura numa linha de 19px no Galaxy Fold, ou seja
  //      MEIA linha, com 10 caracteres ou com 200;
  //  (b) o "ver tudo" que substituiu (a) levava a caixa a `40vh` ao ser
  //      tocado, estourando o card: a rede de segurança ligava, o CARD inteiro
  //      passava a rolar (matando o arraste pra cima, gotcha #29) e o "ver
  //      menos" caía abaixo da dobra, sem caminho de volta.
  //
  // O que vale hoje: teto FIXO, múltiplo inteiro da linha, e a caixa segue
  // `flex-shrink-0`. Assim a geometria do card não muda com o comprimento do
  // texto — muda só o que acontece com o que não coube.
  const CSS_COMENT = read('css/styles.css');
  const regraTexto = CSS_COMENT.match(/^\.card-flag-comment-text \{[^}]*\}/m);
  assert.ok(regraTexto, 'sumiu a regra do texto do comentário');
  assert.match(regraTexto[0], /overflow-y: auto/,
    'o comentário parou de rolar dentro da caixa — o texto longo fica inalcançável');
  assert.match(regraTexto[0], /--linha-comentario:\s*calc\(0\.875rem \* 1\.375\)/,
    'a linha do comentário deixou de sair da fonte (text-sm × leading-snug)');
  // TODO teto do comentário é `N * var(--linha-comentario)`, com N inteiro. Um
  // teto em px, vh ou fração de linha é a volta da meia linha — e meia linha
  // não estoura nada, então NENHUM smoke pega: só se vê olhando a regra.
  const tetos = [...CSS_COMENT.matchAll(/^\s*\.card-flag-comment-text\s*\{[^}]*max-height:\s*([^;]+);/gm)]
    .map((m) => m[1].trim());
  assert.ok(tetos.length >= 3,
    `esperava o teto padrão + os das telas apertadas, achei ${tetos.length}`);
  for (const teto of tetos) {
    assert.match(teto, /^calc\(\d+ \* var\(--linha-comentario\)\)$/,
      `teto "${teto}" não é múltiplo INTEIRO da linha — meia linha visível foi o bug original`);
  }
  // Janela de UMA linha e esmaecido de borda são incompatíveis: a rampa pousa
  // sobre a única linha visível e ela sai meio apagada — o aviso de "tem mais"
  // comendo exatamente o que se veio ler. Onde a linha é uma só (o deitado, que
  // é GRADE: a foto fica na coluna ao LADO e não tem como ceder altura), o
  // esmaecido é desligado. Uma janela de 1 linha SEM esse desligamento é a
  // combinação errada, e ela não estoura nada — nenhum smoke a pegaria.
  const umaLinha = tetos.filter((t) => t.match(/\d+/)[0] === '1').length;
  if (umaLinha) {
    assert.match(CSS_COMENT, /\.card-flag-comment-text\.rola-mais \{\s*-webkit-mask-image: none;\s*mask-image: none;/,
      'há janela de 1 linha e o esmaecido segue ligado — ele apaga a única linha visível');
  }
  // O piso da foto que PAGA a 2ª linha na tela estreita. Escopado por `:has()`
  // no card que tem a caixa: piso menor pra todo card encolheria a evidência
  // de quem não tem comentário nenhum pra ler.
  assert.match(CSS_COMENT, /\.place-card:has\(\.card-flag-comment:not\(\.hidden\)\) \.card-photo \{\s*min-height: 5\.5rem/,
    'sumiu o piso menor da foto — sem ele a 2ª linha do comentário estoura o card na tela estreita');
  assert.doesNotMatch(CSS_COMENT, /card-flag-comment-mais|card-flag-comment\.expandido/,
    'voltou o "ver tudo": expandir estoura o card e o "ver menos" some abaixo da dobra');
  assert.doesNotMatch(HTML_, /card-flag-comment-mais/,
    'voltou o botão "ver tudo" ao template do card');
  assert.doesNotMatch(APP_, /card-flag-comment-mais|'expandido'/,
    'voltou o handler do "ver tudo" no render do card');
  assert.doesNotMatch(APP_, /box\.classList\.add\('flex-shrink-0'\)/,
    'voltou o malabarismo de flex que existia só porque a caixa aparecia vazia');
});

// O renomear não pode ser oferecido onde o Waze recusa.
//
// O portão exigia L6+AM e nome, e NÃO olhava se o local existe no mapa. Medido
// contra o WME real com controle (mesmo payload, mesma sessão): local
// `approved:false` → HTTP 406, `approved:true` → 200. E não é caso de canto —
// 711 de 2420 cards com nome nos 6 países obrigatórios (29%), 40% da fila do
// owner no Brasil. O editor abria a foto, digitava o nome certo, confirmava e
// levava "Erro do Waze (HTTP 406)" em `errorCategory: unknown`: o balde que
// reverte o placar e mostra erro genérico. É o beco sem saída que a regra de
// interface do projeto proíbe antes de qualquer outra coisa.
test('renomear: o portão exclui local que ainda não existe no mapa', () => {
  const APP_ = read('js/app.js');
  const fn = APP_.match(/function podeRenomearAqui\([\s\S]*?\n\}/);
  assert.ok(fn, 'sumiu o portão do renomear');
  assert.match(fn[0], /localAprovado/,
    'o portão voltou a ignorar se o local existe — oferece renomear onde o Waze devolve 406');
  // `!== false` e não `=== true`: campo ausente cai no lado permissivo, que é o
  // comportamento de hoje. O contrário esconderia o renomear de todo mundo se o
  // Waze parasse de mandar o campo — e falharia calado.
  assert.match(fn[0], /localAprovado !== false/,
    'o portão passou a exigir o campo presente — sem ele o renomear some em silêncio');
  // E o campo tem que CHEGAR: portão que lê algo que o core não manda é portão
  // fechado pra todo mundo.
  assert.match(read('server/core.mjs'), /localAprovado: venue\.approved !== false/,
    'o core parou de mandar localAprovado — o portão fecha pra todos');
});

test('lixeira do lightbox: alvo de toque e estado inicial', () => {
  // 1) Alvo de toque. A régua é 44px (HIG) / 48dp (M3) e vale pra botão NOVO
  //    também — não só pros que já estavam aqui.
  const botao = HTML.match(/<button[^>]*id="lightboxDelete"[^>]*>/);
  assert.ok(botao, 'o botão da lixeira sumiu do lightbox');
  const wh = botao[0].match(/\bw-(\d+)\b[^>]*\bh-(\d+)\b/);
  assert.ok(wh, 'a lixeira perdeu as classes de tamanho — mede-se o alvo, não se confia nele');
  assert.ok(Number(wh[1]) * 4 >= 44 && Number(wh[2]) * 4 >= 44,
    `alvo de ${Number(wh[1]) * 4}×${Number(wh[2]) * 4}px, abaixo dos 44 exigidos`);

  // 2) Nasce ESCONDIDA. Sem `hidden` no markup, ela pisca pra todo mundo entre
  //    o primeiro paint e o primeiro _render() — inclusive pra quem não é L6.
  assert.ok(/class="[^"]*\bhidden\b/.test(botao[0]), 'a lixeira não nasce escondida');

  // 3) NÃO há mais diálogo de confirmação (decisão do owner: a pessoa já fez
  //    três gestos deliberados pra chegar aqui). No lugar entrou a janela de
  //    Desfazer, que respeita a preferência do editor. Se o diálogo voltar sem
  //    alguém revisitar isto, o teste avisa.
  assert.ok(!/id="deletePhotoModal"/.test(HTML),
    'voltou o diálogo de confirmação da exclusão — a decisão foi trocá-lo pelo Desfazer');
});

test('o pedido à extensão não atropela um login que aconteceu no meio', () => {
  const app = read('js/app.js');

  // O `showAuthScreen` deixou de ser síncrono no boot: agora ele espera a
  // extensão responder. Entre o pedido e a resposta passam centenas de ms, e
  // nesse meio alguém pode ter entrado por outro caminho (colar cookies, código
  // de pareamento, token injetado). Sem guarda, a escrita atrasada derrubava a
  // sessão nova e escondia a app JÁ montada.
  //
  // Apareceu no smoke como "card sem endereço / botões 0px", mudando de
  // aparelho a cada rodada porque atinge sempre o PRIMEIRO card medido — que é
  // o sintoma clássico de escrita atrasada, não de layout.
  const bloco = app.match(/entrarPelaExtensao\(\)\.then\([\s\S]{0,700}?\}\);/);
  assert.ok(bloco, 'sumiu o handshake do boot');
  assert.match(bloco[0], /API\.getSession\(\)\s*\|\|\s*AppState\.authenticated/,
    'a guarda contra login-no-meio sumiu — showAuthScreen volta a atropelar sessão nova');

  // E o prazo curto existe pra não punir quem NÃO tem a extensão: sem resposta
  // de `aguarde`, a tela de login aparece em EXT_PRESENTE_MS.
  assert.match(app, /const EXT_PRESENTE_MS = (\d+)/, 'sumiu o prazo curto do handshake');
  const curto = Number(app.match(/const EXT_PRESENTE_MS = (\d+)/)[1]);
  assert.ok(curto <= 600, `EXT_PRESENTE_MS=${curto}ms: quem não tem a extensão espera isso olhando pro nada`);
  assert.match(app, /d\.action === 'aguarde'/, 'sumiu o "aguarde" — sem ele o prazo curto derruba quem TEM a extensão');
});

test('splash do PWA: manifest, metas e CSS não podem divergir', () => {
  // O owner viu o splash branco num Android em modo escuro, e provou com vídeo
  // e print. A causa era `background_color: #f8fafc` no manifest — ele é JSON
  // estático, pintado ANTES de qualquer CSS/JS, então nem o tema.js alcança.
  //
  // O manifest NÃO aceita variante por esquema (issue aberta no WICG), então a
  // única defesa é as cores não divergirem: o fundo do splash tem que ser o
  // mesmo `body.dark` da app, senão volta a haver troca de cor na abertura.
  const man = JSON.parse(read('manifest.json'));
  const css = read('css/styles.css');
  const html = read('index.html');

  const escuroDoCss = (css.match(/body\.dark\s*\{[^}]*background-color:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  assert.ok(escuroDoCss, 'sumiu o background-color do body.dark');
  assert.equal(man.background_color.toLowerCase(), escuroDoCss.toLowerCase(),
    'background_color do manifest divergiu do body.dark — volta o clarão na abertura');
  assert.equal(man.theme_color.toLowerCase(), escuroDoCss.toLowerCase(),
    'theme_color do manifest divergiu — volta a faixa acesa em cima do splash');

  // As duas metas por esquema são o que faz a barra de status seguir a
  // preferência ANTES do JS. Uma meta só, fixa, era metade do problema.
  const metas = [...html.matchAll(/<meta name="theme-color"[^>]*>/g)].map((m) => m[0]);
  assert.ok(metas.some((m) => /prefers-color-scheme:\s*dark/.test(m)),
    'sumiu a meta theme-color do esquema ESCURO');
  assert.ok(metas.some((m) => /prefers-color-scheme:\s*light/.test(m)),
    'sumiu a meta theme-color do esquema CLARO');

  // A media query é a aposta na brecha do MDN ("browsers MAY override
  // background_color from a prefers-color-scheme in your CSS"). Só vale
  // escopada: sem o :not(.tema-claro), quem escolheu claro num sistema escuro
  // recebe fundo escuro por baixo de uma app clara.
  assert.match(css, /@media \(prefers-color-scheme: dark\)/,
    'sumiu o gancho de prefers-color-scheme — o navegador fica sem de onde derivar');
  // Confere CADA seletor do bloco, não "a string aparece em algum lugar".
  // A primeira versão deste guard passava com metade do escopo removido: o
  // segundo seletor ainda continha o `:not`, e isso bastava pra ele. Guard que
  // aceita meia correção afirma uma proteção que não existe.
  const abre = css.indexOf('@media (prefers-color-scheme: dark)');
  const corpo = css.slice(css.indexOf('{', abre) + 1, css.indexOf('\n}', abre));
  const seletores = corpo.split('{')[0].split(',').map((x) => x.trim()).filter(Boolean);
  assert.ok(seletores.length > 0, 'bloco @media vazio');
  for (const sel of seletores) {
    assert.match(sel, /:not\(\.tema-claro\)/,
      `seletor "${sel}" sem escopo — vai pintar escuro quem ESCOLHEU claro`);
  }
  // O tema virou script INLINE no index.html (ver o teste do hash da CSP), então
  // é lá que se confere — ler `js/tema.js` passou a quebrar com ENOENT.
  const inlineTema = /<script>([\s\S]*?)<\/script>/.exec(read('index.html'));
  assert.ok(inlineTema, 'sumiu o script inline do tema');
  assert.match(inlineTema[1], /tema-claro/,
    'o script do tema parou de marcar o claro explicitamente, e o escopo acima deixa de funcionar');
});

// Dimensões de PNG e JPEG sem dependência nenhuma — o `npm test` é `node --test`
// puro e vai continuar sendo. PNG: IHDR é sempre o primeiro chunk. JPEG: varre
// os marcadores até um SOF (0xC0–0xCF, tirando 0xC4/0xC8/0xCC, que não são SOF).
function dimensoesDaImagem(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marca = buf[i + 1];
      if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
        return { altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

test('splash do iOS: todo tamanho tem o par claro+escuro, e o arquivo existe', () => {
  // O `background_color` do manifest é UM valor, então no Android a splash é
  // uma cor fixa. O iOS é o único lugar onde ela segue a PREFERÊNCIA da pessoa,
  // porque o `media` do apple-touch-startup-image aceita prefers-color-scheme.
  // Isso só funciona se as duas variantes existirem: com uma só, metade dos
  // aparelhos casa nada e volta a splash branca — e ninguém percebe, porque a
  // falha aparece por 300ms na abertura de um iPhone que o dev não tem.
  const html = read('index.html');
  const links = [...html.matchAll(/<link rel="apple-touch-startup-image"[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length >= 2, 'sumiram os apple-touch-startup-image');

  const porTamanho = new Map();
  for (const link of links) {
    const href = (/href="([^"]+)"/.exec(link) || [])[1];
    const media = (/media="([^"]+)"/.exec(link) || [])[1];
    assert.ok(href && media, `link sem href ou media: ${link}`);

    const esquema = (/prefers-color-scheme:\s*(light|dark)/.exec(media) || [])[1];
    assert.ok(esquema, `link sem prefers-color-scheme — não escolhe nada: ${link}`);
    assert.match(media, /\(orientation: portrait\)/,
      `link sem orientação: o iOS casa por orientação e este vale pra qualquer uma: ${link}`);

    const w = Number((/device-width:\s*(\d+)px/.exec(media) || [])[1]);
    const h = Number((/device-height:\s*(\d+)px/.exec(media) || [])[1]);
    const dpr = Number((/-webkit-device-pixel-ratio:\s*(\d+)/.exec(media) || [])[1]);
    assert.ok(w && h && dpr, `media incompleta (precisa de device-width/height/dpr): ${media}`);

    // O arquivo precisa ter EXATAMENTE o tamanho que a media query promete —
    // o iOS não redimensiona, ele descarta.
    const bytes = readFileSync(join(ROOT, href));
    const dim = dimensoesDaImagem(bytes);
    assert.ok(dim, `não consegui ler as dimensões de ${href}`);
    assert.deepEqual(dim, { largura: w * dpr, altura: h * dpr },
      `${href} não bate com a media query (${w}×${h} @${dpr}x = ${w * dpr}×${h * dpr})`);
    // Paleta, não RGBA: em truecolor os 34 arquivos passam de 900 KB pra
    // desenhar um retângulo com um alfinete. Se alguém regerar sem paletizar,
    // nada quebra — só engorda o repositório em silêncio.
    assert.equal(bytes[25], 3, `${href} não é PNG de paleta (tipo de cor ${bytes[25]})`);
    assert.ok(bytes.includes(Buffer.from('PLTE', 'ascii')), `${href} sem chunk PLTE`);
    assert.match(href, new RegExp(`-${esquema}\\.png$`),
      `${href} está no link do esquema ${esquema} — nome e media divergindo é o erro que ninguém vê`);

    const chave = `${w}x${h}@${dpr}`;
    if (!porTamanho.has(chave)) porTamanho.set(chave, new Set());
    porTamanho.get(chave).add(esquema);
  }

  for (const [chave, esquemas] of porTamanho) {
    assert.deepEqual([...esquemas].sort(), ['dark', 'light'],
      `o tamanho ${chave} não tem os DOIS esquemas — ${[...esquemas]} só`);
  }
});

test('capturas do manifest: arquivo existe, tamanho declarado é o real, proporção uniforme', () => {
  // O Chrome só monta o diálogo rico de instalação se as capturas conferirem, e
  // quando não conferem ele desiste em SILÊNCIO — volta o diálogo velho de uma
  // linha e ninguém liga o efeito à causa. As três regras que ele aplica:
  // dimensão entre 320 e 3840, lado maior no máximo 2,3× o menor, e mesma
  // proporção entre capturas do mesmo form_factor.
  const man = JSON.parse(read('manifest.json'));
  assert.ok(Array.isArray(man.screenshots) && man.screenshots.length >= 3,
    'o manifest precisa de pelo menos 3 capturas');

  const proporcaoPorFormato = new Map();
  for (const s of man.screenshots) {
    const bytes = readFileSync(join(ROOT, s.src));
    const dim = dimensoesDaImagem(bytes);
    assert.ok(dim, `não consegui ler as dimensões de ${s.src}`);
    assert.equal(`${dim.largura}x${dim.altura}`, s.sizes,
      `${s.src}: o manifest declara ${s.sizes} e o arquivo é ${dim.largura}x${dim.altura}`);

    const tipoEsperado = s.src.endsWith('.png') ? 'image/png' : 'image/jpeg';
    assert.equal(s.type, tipoEsperado, `${s.src}: type declarado não bate com a extensão`);
    assert.ok(s.label && s.label.length > 10, `${s.src}: sem label — é o que o leitor de tela lê`);

    const menor = Math.min(dim.largura, dim.altura), maior = Math.max(dim.largura, dim.altura);
    assert.ok(menor >= 320 && maior <= 3840, `${s.src}: fora da faixa 320–3840 do Chrome`);
    assert.ok(maior <= menor * 2.3, `${s.src}: lado maior passa de 2,3× o menor, o Chrome descarta`);

    const p = dim.largura / dim.altura;
    if (!proporcaoPorFormato.has(s.form_factor)) proporcaoPorFormato.set(s.form_factor, p);
    assert.ok(Math.abs(proporcaoPorFormato.get(s.form_factor) - p) < 0.01,
      `${s.src}: proporção diferente das outras capturas "${s.form_factor}" — o Chrome exige uniforme`);
  }

  assert.ok(man.screenshots.some((s) => s.form_factor === 'narrow'), 'sem captura narrow (celular)');
  assert.ok(man.screenshots.some((s) => s.form_factor === 'wide'), 'sem captura wide (desktop)');
});

// ── Realce do miolo: onde a tela ESCONDE a diferença ────────────────────────
//
// O card já mostra o valor antigo e o novo lado a lado, e pra quase toda
// mudança isso basta. O realce existe só pro caso em que o olho não tem pista:
// a diferença NÃO muda o tamanho da string, então as duas linhas parecem a
// mesma linha, e passar batido significa aprovar `T1 → T4` achando que nada
// mudou.
//
// Todos os casos abaixo são REAIS, colhidos em 453 mudanças de texto de 13
// países. Os negativos importam tanto quanto os positivos — em especial os que
// ficam LOGO ABAIXO de cada limiar: sem eles, afrouxar uma constante passa
// verde, e um realce que dispara em tudo vira ruído que o editor aprende a
// ignorar.
test('realce do miolo: dispara na agulha e cala no óbvio', () => {
  const app = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');
  const de = app.indexOf('const REALCE_DELTA_MAX');
  const ate = app.indexOf('function valorDoDiff');
  assert.ok(de > 0 && ate > de, 'realceDoMiolo/ladoRealcado sumiram de js/app.js');
  const escopo = new Function(
    'escapeHtml',
    app.slice(de, ate) + '; return { realceDoMiolo, ladoRealcado };'
  )((x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const { realceDoMiolo, ladoRealcado } = escopo;

  // Mesmo tamanho ou quase: o olho não tem onde se agarrar.
  const AGULHA = [
    ['Aeroport Josep Tarradellas Barcelona - El Prat T1',
     'Aeroport Josep Tarradellas Barcelona - El Prat T2', '1', '2'],
    ['CDG Terminal 2F', 'CDG Terminal 2C', 'F', 'C'],          // contexto 14: a v1 perdia
    ['The Radmore Restaurant', 'The Radmoor Restaurant', 're', 'or'],
    ['Inglesia Ni Cristo - Lokal ng Santo Tomas',
     'Iglesia Ni Cristo - Lokal ng Santo Tomas', 'n', ''],      // letra REMOVIDA
    ['Ayuntamiento Rincón del Soto', 'Ayuntamiento Rincón de Soto', 'l', ''],
    ['Ajuntament de Balenya', 'Ajuntament de Balenyà', 'a', 'à'],   // acento
    ['Hostal Hermanos Sánchez', 'Hostal Hermanos Sanchez', 'á', 'a'],
    ['Sé Catedral de Faro', 'Sé QCatedral de Faro', '', 'Q'],   // letra ENFIADA no meio
    ['Gate 7 - HPA (Philippine Army Headquarters)',
     'Gate 8 - HPA (Philippine Army Headquarters)', '7', '8'],
    ['Praia da Falésia', 'Praia da Falésiau', '', 'u'],
    // Miolo EXATAMENTE 3, o teto. Sem este caso, apertar REALCE_MIOLO_MAX pra 2
    // passa verde — e apertar custa perder agulha, que é o erro caro.
    ['CDG Terminal 2F', 'CDG Terminal T2d', '2F', 'T2d'],
    // Também miolo 3, e este é a CONCESSÃO assumida: `ALDI`→`Aldi` se vê, sim.
    // O teto ficou em 3 porque o empate é desequilibrado — realçar de mais custa
    // um destaque à toa; realçar de menos custa aprovar `2F` achando que é `2F`.
    // Se um dia isto incomodar, é aqui que se mede de novo.
    ['ALDI Marbella', 'Aldi Marbella', 'LDI', 'ldi'],
  ];
  for (const [a, b, mDe, mPara] of AGULHA) {
    const r = realceDoMiolo(a, b);
    assert.ok(r, `não realçou uma agulha: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    assert.equal(r.de[1], mDe, `miolo errado do lado antigo em ${JSON.stringify(a)}`);
    assert.equal(r.para[1], mPara, `miolo errado do lado novo em ${JSON.stringify(b)}`);
    // O realce não pode ALTERAR o texto — só pode encurtá-lo pelas pontas. As
    // três partes remontam o original quando não houve corte, e um pedaço
    // contíguo dele quando houve.
    assert.ok(a.includes(r.de.join('')), 'o lado antigo deixou de ser um trecho do original');
    assert.ok(b.includes(r.para.join('')), 'o lado novo deixou de ser um trecho do original');
    if (!r.cortaIni && !r.cortaFim) {
      assert.equal(r.de.join(''), a, 'sem corte, o lado antigo tem que remontar inteiro');
      assert.equal(r.para.join(''), b, 'sem corte, o lado novo tem que remontar inteiro');
    }
  }

  // Muda o tamanho, ou muda demais: o editor vê sem ajuda nenhuma.
  const OBVIO = [
    ['AXION Energy', 'axion energy'],
    ['111', '83'],
    ['Bom Atacarejo', 'Strapasson'],
    ['Nation Peugeot', 'Discautol Peugeot Cuiabá'],
    ['igual', 'igual'],
    // Δ de comprimento — TODOS reais, e todos logo acima do limiar. Se
    // REALCE_DELTA_MAX subir pra 2, estes começam a acender.
    ['Goose Street Car Park', 'Goose Street Car Parkuuuu'],          // Δ4
    ['Manchester Airport', 'Manchester Airport T2'],                 // Δ3
    ['Termas Prexigueiro', 'Termas de Prexigueiro'],                 // Δ3
    ['Anchor Grandsuites', 'Anchor Grandsuites/天汇'],                // Δ3
    ['Holy Cross Steel Corporation', 'Holy Cross Steel Corporationhhdh'], // Δ4
    ['Boulangerie Pâtisserie Émile Parisse', 'W Boulangerie Pâtisserie Émile Parisse'], // Δ2
    ['Praça Teófilo Braga', 'Praça Teófilo Braga 9'],                // Δ2
    // Δ0/Δ1 mas miolo GRANDE: se REALCE_MIOLO_MAX subir pra 4, acendem.
    ["Vap'Pause Roissy-en-Brie", 'Vapostore Roissy-en-Brie'],        // Δ0, miolo 5
    ['Airbnb - ChaMiLukie Lodging', 'Airbnb - ChaMiLuLiLi Lodging'], // Δ1, miolo 4
    // contexto curto: se REALCE_CONTEXTO_MIN cair, acende.
    ['Rua 71', 'Rua 20'],
  ];
  for (const [a, b] of OBVIO) {
    assert.equal(realceDoMiolo(a, b), null,
      `realçou o que se vê num relance: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
  // Tipo errado não pode explodir no meio do render do card.
  for (const v of [null, undefined, 42, {}, []]) {
    assert.equal(realceDoMiolo(v, 'x'), null);
    assert.equal(realceDoMiolo('x', v), null);
  }

  // Miolo VAZIO não vira <mark> vazio: elemento invisível no DOM engana quem
  // for medir depois (foi assim que a tira de miniaturas passou verde medindo
  // uma caixa de imagem quebrada).
  const ins = realceDoMiolo('Praia da Falésia', 'Praia da Falésiau');
  assert.ok(!ladoRealcado(ins, 'de', 'x').includes('<mark'), '<mark> vazio no lado sem miolo');
  assert.ok(ladoRealcado(ins, 'para', 'x').includes('<mark class="x">u</mark>'));
  // XSS: o valor vem do Waze e entra por innerHTML.
  const xss = realceDoMiolo('Loja do Bairro Central 1', 'Loja do Bairro Central <');
  assert.ok(xss && !ladoRealcado(xss, 'para', 'x').includes('< '), 'markup do Waze escapou cru');
  assert.ok(ladoRealcado(xss, 'para', 'x').includes('&lt;'));

  // ── JANELA: o realce tem que SOBREVIVER ao line-clamp de 3 linhas ─────────
  // MEDIDO: num Galaxy Fold a coluna do diff cabe ~15 caracteres por linha, e um
  // nome de 49 é cortado ANTES da diferença — o realce ficava invisível na tela
  // mais apertada, que é onde ele mais serve.
  const longo = realceDoMiolo(
    'Aeroport Josep Tarradellas Barcelona - El Prat T1',
    'Aeroport Josep Tarradellas Barcelona - El Prat T2');
  assert.ok(longo.cortaIni, 'não encurtou o prefixo de um valor longo');
  assert.ok(longo.de[0].length <= 16, `janela grande demais: ${longo.de[0].length}`);
  assert.ok(ladoRealcado(longo, 'de', 'x').startsWith('…'), 'faltou a reticência do corte');
  // A janela é a MESMA nos dois lados, senão as duas linhas param de se alinhar.
  assert.equal(longo.de[0], longo.para[0]);
  // Valor CURTO passa inteiro: encurtar o que já cabe seria perder à toa.
  const curto = realceDoMiolo('CDG Terminal 2F', 'CDG Terminal 2C');
  assert.ok(!curto.cortaIni && !curto.cortaFim, 'encurtou um valor que já cabia');
  assert.equal(ladoRealcado(curto, 'de', 'x'), 'CDG Terminal 2<mark class="x">F</mark>');
  // Corte no FIM também: diferença no começo de um texto longo.
  const fim = realceDoMiolo(
    'Inglesia Ni Cristo - Lokal ng Santo Tomas',
    'Iglesia Ni Cristo - Lokal ng Santo Tomas');
  assert.ok(fim.cortaFim && !fim.cortaIni, 'corte do fim não aconteceu');
  assert.ok(ladoRealcado(fim, 'para', 'x').endsWith('…'));

  // Unicode por CARACTERE, não por índice UTF-16: com s[i] um emoji se parte no
  // meio e o realce corta o próprio caractere.
  const emoji = realceDoMiolo('Restaurante do Porto 🍕', 'Restaurante do Porto 🍔');
  assert.ok(emoji, 'não realçou diferença de emoji');
  assert.equal(emoji.de[1], '🍕');
  assert.equal(emoji.para[1], '🍔');
});

// ── `.hidden` não esconde o que styles.css declara `display` ────────────────
//
// O Tailwind dá `.hidden { display: none }`, e desde v2026.08.05-04 o NOSSO CSS
// carrega DEPOIS (gotcha #22/#27) — de propósito, pra vencer o empate de
// especificidade nos estilos. O efeito colateral: qualquer `.foo { display: x }`
// em styles.css também vence o `.hidden`, e aí `classList.add('hidden')` não
// esconde COISA NENHUMA. Falha silenciosa: o JS diz que escondeu, o DOM
// concorda (a classe está lá), e só a tela mostra a verdade.
//
// Aconteceu com a pílula do nome no lightbox: `.lb-nome-btn { display: flex }`
// mora na posição 61526 do CSS compilado e o `.hidden` na 7164, então o nome do
// local apareceu DUAS vezes durante a edição — na tela do owner, não aqui.
test('.hidden vence: nada que o JS esconde pode ter display fixado em styles.css', () => {
  const css = readFileSync(join(ROOT, 'css', 'styles.css'), 'utf8');
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const app = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');

  // classes que styles.css fixa `display` (fora de @media/@supports não importa:
  // se pega em ALGUM contexto, já quebra ali)
  const comDisplay = new Set();
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/(^|[^-\w])display\s*:/.test(m[2])) continue;
    // `:not(.x)` é CONDIÇÃO, não estilo: `#appScreen:not(.hidden){display:flex}`
    // não fixa display na `.hidden` — pelo contrário, existe justamente pra
    // ceder a ela. Sem tirar isso, o guard acusa meia app.
    const seletor = m[1].replace(/:not\([^)]*\)/g, '');
    for (const cls of seletor.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
      if (cls[1] !== 'hidden') comDisplay.add(cls[1]);
    }
  }

  // ids que o app.js esconde por `.hidden`
  const escondidos = new Set();
  for (const re of [/getElementById\('([\w-]+)'\)[^;\n]*classList\.add\('hidden'\)/g,
                    /getElementById\('([\w-]+)'\)[^;\n]*classList\.toggle\('hidden'/g,
                    /\$\('([\w-]+)'\)[^;\n]*classList\.add\('hidden'\)/g]) {
    for (const m of app.matchAll(re)) escondidos.add(m[1]);
  }
  assert.ok(escondidos.size >= 5, `o varredor achou só ${escondidos.size} ids — a regex parou de casar`);

  const presos = [];
  for (const id of escondidos) {
    const el = html.match(new RegExp(`<[^>]*\\sid="${id}"[^>]*>`));
    if (!el) continue;                                   // criado em runtime
    const cls = (el[0].match(/\sclass="([^"]*)"/) || [, ''])[1].split(/\s+/);
    for (const c of cls) if (c && comDisplay.has(c)) presos.push(`#${id} tem .${c}, que fixa display em styles.css`);
  }
  assert.deepEqual(presos, [],
    'estes elementos NÃO somem com .hidden — o styles.css carrega depois e ganha:\n  ' + presos.join('\n  '));
});
