// A PILHA — o próximo pedido aparece por baixo do atual durante o arraste.
//
// O que estes guards protegem NÃO é a aparência: é o fato de existirem DOIS
// `.place-card` na tela a partir daqui. Antes da pilha,
// `document.querySelector('.place-card')` era uma pergunta com uma resposta só;
// agora é ambígua, e dois dos nove chamadores eram destrutivos — o
// `triggerSwipe` mandaria SAIR o card errado (botão e teclado) e o
// `aplicarTravaDeAcao` travaria o de fundo deixando os do da frente vivos
// durante a janela do Desfazer. Nenhum dos dois dá erro: a tela só faz outra
// coisa. É por isso que a regra vira teste e não comentário.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const SWIPE = readFileSync(new URL('../js/swipe.js', import.meta.url), 'utf8');
const SWREG = readFileSync(new URL('../js/sw-register.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const APPCSS = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

// Guard lê CÓDIGO, nunca comentário. O comentário cita o padrão proibido
// justamente PORQUE ele é o que não se deve escrever — e nesta mesma PR isso
// reprovou três vezes: no `triggerSwipe`, na regra do véu e na varredura geral.
// Quanto melhor o comentário, mais um grep solto erra (gotcha #67).
const semComentarioJS = (s) => s.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Âncora em DECLARAÇÃO, nunca em distância (gotcha #67).
function fatiar(fonte, nome) {
  const ini = fonte.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu`);
  const resto = fonte.slice(ini + 1);
  // Fecha na PRÓXIMA declaração de topo — ou no fim do arquivo, que é o caso
  // da última função dele (o `triggerSwipe` é a última do swipe.js, e sem este
  // ramo o guard reprovava por não achar o delimitador, não por defeito).
  const fim = resto.search(/\n(?:function |const |\/\/ ──)/);
  return fonte.slice(ini, fim > 0 ? ini + 1 + fim : undefined);
}

// ── 1. QUEM É O CARD DA FRENTE ─────────────────────────────────────────────
test('cardDaFrente exclui o de fundo — e é ele que os call sites usam', () => {
  const f = fatiar(APP, 'cardDaFrente');
  assert.match(f, /:not\(\.card-fundo\)/,
    'o cardDaFrente parou de excluir o card de fundo: todo chamador passa a poder pegar o pedido errado');
  assert.match(f, /#cardStack/,
    'sem escopo no #cardStack ele alcançaria um .place-card de fora da pilha');
});

test('nenhum lugar do app.js/swipe.js volta a perguntar por `.place-card` solto', () => {
  // A regra que protege o PRÓXIMO chamador, não os de hoje: quem escrever
  // `document.querySelector('.place-card')` amanhã pega um dos dois cards, e
  // qual depende da ordem do DOM.
  //
  // Só CÓDIGO, nunca comentário — o comentário cita o padrão justamente porque
  // ele é o que não se deve escrever, e um grep solto reprovaria a explicação
  // (gotcha #67, que já mordeu três vezes nesta mesma base).
  for (const [nome, fonte] of [['app.js', APP], ['swipe.js', SWIPE]]) {
    const achados = [...semComentarioJS(fonte)
      .matchAll(/document\.querySelector\((['"`])\.place-card(?![:\w-])/g)];
    assert.equal(achados.length, 0,
      `${nome} tem ${achados.length} consulta(s) a '.place-card' sem distinguir frente e fundo — use cardDaFrente()`);
  }
});

test('o guard enxerga a sabotagem (senão ele é decoração)', () => {
  // Prova que a asserção acima reprovaria de verdade: o mesmo padrão, aplicado
  // a um texto que TEM a consulta solta, precisa achá-la.
  const sabotado = "  const card = document.querySelector('.place-card');\n";
  const achados = [...sabotado.matchAll(/document\.querySelector\((['"`])\.place-card(?![:\w-])/g)];
  assert.equal(achados.length, 1, 'o padrão do guard não acha a forma que ele existe pra barrar');
  // E não pode acusar a forma CERTA.
  const certo = "  const card = document.querySelector('#cardStack .place-card:not(.card-fundo)');\n";
  assert.equal([...certo.matchAll(/document\.querySelector\((['"`])\.place-card(?![:\w-])/g)].length, 0,
    'o guard reprovaria a forma correta');
});

test('o triggerSwipe manda sair o card da FRENTE', () => {
  const f = semComentarioJS(fatiar(SWIPE, 'triggerSwipe'));
  assert.match(f, /window\.cardDaFrente/,
    'o triggerSwipe voltou a escolher o card por conta própria — botão e seta passam a poder animar o card de baixo');
  assert.ok(!/document\.querySelector\((['"])\.place-card\1/.test(f),
    'o triggerSwipe voltou a pegar o primeiro .place-card do DOM');
});

test('a trava do Desfazer pega o card da frente', () => {
  const f = fatiar(APP, 'aplicarTravaDeAcao');
  assert.match(f, /cardDaFrente\(\)/,
    'a trava voltou a escolher um .place-card qualquer: travaria o de fundo e deixaria os botões do da frente vivos');
});

// ── 2. A PILHA NÃO ARRASTA E NÃO É ALCANÇÁVEL ──────────────────────────────
test('o gesto só é ligado no card da frente, no ponto único onde ele é ligado', () => {
  assert.match(SWREG, /contains\('place-card'\)\s*\n?\s*&&\s*!\w+\.classList\.contains\('card-fundo'\)/,
    'o observador voltou a ligar o arraste em QUALQUER .place-card — arrastar o de fundo trataria um pedido que não está na tela');
});

test('o card de fundo sai da árvore de acessibilidade e do ponteiro — as três camadas', () => {
  const f = fatiar(APP, 'montarCardDeFundo');
  assert.match(f, /setAttribute\('aria-hidden', 'true'\)/,
    'sem aria-hidden o leitor de tela anuncia DOIS pedidos, e só um está sendo tratado');
  assert.match(f, /\.inert = true/,
    'sem inert o Tab alcança um segundo ✕ ↑ ✓, idêntico ao real, agindo no pedido errado');
  assert.match(SEM_COMENTARIO, /\.place-card\.card-fundo\s*\{[^}]*pointer-events:\s*none/,
    'sem pointer-events:none o card de fundo recebe o dedo onde o da frente não cobre');
});

test('os ouvintes de ✕ ↑ ✓ ficam FORA do montarCard', () => {
  // O card de fundo é montado pela MESMA função do da frente. Se os ouvintes
  // voltarem pra lá, o botão do fundo passa a ter ação ligada — e só não
  // dispara por causa do inert/pointer-events, ou seja, por causa de OUTRA
  // camada. Aqui não há o que desfazer: ele nunca chega a ser ligado.
  const montar = semComentarioJS(fatiar(APP, 'montarCard'));
  assert.ok(!/card-btn-reject'\)\.addEventListener/.test(montar),
    'os ouvintes dos botões voltaram pro montarCard — o card de fundo passa a nascer com ação ligada');
  const render = semComentarioJS(fatiar(APP, 'renderCurrentCard'));
  assert.match(render, /card-btn-reject'\)\.addEventListener/,
    'os ouvintes sumiram do renderCurrentCard: o card da frente ficaria sem botão funcionando');
});

// ── 3. QUANDO A PILHA NÃO EXISTE ───────────────────────────────────────────
test('o card de fundo não carrega ouvinte NENHUM', () => {
  // `cloneNode(true)` copia atributo e NÃO copia ouvinte. Os dos botões já
  // ficavam de fora (moram no `renderCurrentCard`), mas o `renderCardImages`
  // pendura na foto e nas setas do carrossel — e MEDIDO no navegador, um
  // `.click()` programático na foto do card de fundo ABRIA o lightbox. Era o
  // mesmo defeito dos botões: ouvinte vivo, escondido só pelo `inert` e pelo
  // `pointer-events`, ou seja por OUTRA camada.
  const f = semComentarioJS(fatiar(APP, 'montarCardDeFundo'));
  assert.match(f, /cloneNode\(true\)/,
    'o card de fundo deixou de ser clonado: os ouvintes da foto e do carrossel voltam a ficar vivos nele');
  // O clone perde propriedades JS, e uma importa: sem o `onerror` reposto, foto
  // 404 no card de fundo vira caixa vazia em vez do "Sem Imagem".
  assert.match(f, /onerror = \(\) =>/,
    'o onerror da foto não é reposto depois do clone');
});

test('sem próximo na fila não há card de fundo', () => {
  const f = fatiar(APP, 'montarCardDeFundo');
  assert.match(f, /const proximo = AppState\.queue\[1\];/,
    'o card de fundo deixou de sair de queue[1]');
  assert.match(f, /if \(!proximo\) return;/,
    'no último pedido da fila o app passaria a desenhar algo por baixo — e o que há ali é o fim da fila, que a janela do Desfazer ainda pode desfazer');
  assert.match(f, /if \(!cardDaFrente\(\)\) return;/,
    'sem card na frente não há pilha: um card de fundo sozinho seria um pedido na tela que ninguém pode tratar');
});

test('montar o card de fundo NUNCA derruba o da frente', () => {
  const f = fatiar(APP, 'montarCardDeFundo');
  assert.match(f, /try \{[\s\S]*montarCard\(proximo\)[\s\S]*\} catch/,
    'o montarCard do fundo saiu do try: um pedido quebrado subiria até o window.onerror, que tem recuperação automática e chamaria advanceQueue() — o pedido da frente sumiria sem ninguém decidir nada');
});

test('a limpeza da área do card tira os DOIS', () => {
  const f = fatiar(APP, 'removeCurrentCardEl');
  assert.match(f, /querySelectorAll\('\.place-card'\)/,
    'voltou a querySelector: some um card só, e qual depende da ordem do DOM');
});

// ── 4. QUANDO ELA É MONTADA ────────────────────────────────────────────────
test('a pilha nasce junto do aquecimento, nunca junto do card da frente', () => {
  // A foto do card é o LCP do app. Montar o de fundo na mesma hora põe a foto
  // do PRÓXIMO pedido disputando banda com a que o editor precisa ver AGORA —
  // o defeito que o agendarAquecimento já tinha medido (189 KB atropelando 12).
  // De quebra é o que faz o custo de rede da pilha ser ZERO: o que ela desenha
  // é exatamente o que o aquecimento acabou de pedir (medido: 5 URLs únicas
  // com e sem a pilha).
  const f = fatiar(APP, 'agendarAquecimento');
  const iPre = f.indexOf('prefetchNextImage();');
  const iFundo = f.indexOf('montarCardDeFundo();');
  assert.ok(iPre >= 0, 'o aquecimento perdeu o prefetchNextImage');
  assert.ok(iFundo > iPre,
    'o card de fundo deixou de ser montado DEPOIS do aquecimento: ele passaria a pedir foto que o aquecimento ainda não pediu');
  const render = semComentarioJS(fatiar(APP, 'renderCurrentCard'));
  assert.ok(!/^\s+montarCardDeFundo\(\)/m.test(render),
    'a pilha voltou pro renderCurrentCard: a foto do próximo pedido passa a competir com o LCP');
});

// ── 5. O VÉU ───────────────────────────────────────────────────────────────
// O guard lê CÓDIGO, nunca comentário — e esta regra mordeu na primeira
// rodada: o comentário dentro da própria declaração cita `z-index:1` pra
// explicar por que o véu NÃO pode estar em 1, e o regex leu o comentário. É o
// gotcha #67 outra vez, agora no CSS: quanto melhor o comentário, mais o guard
// solto erra.
const SEM_COMENTARIO = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

test('o véu é 35% e pinta ACIMA do conteúdo do card', () => {
  const regra = SEM_COMENTARIO.match(/\.card-fundo-veu\s*\{[^}]*\}/);
  assert.ok(regra, 'a regra do véu sumiu do styles.css');
  assert.match(regra[0], /rgba\(2,\s*6,\s*23,\s*0\.35\)/,
    'o véu mudou de opacidade sem medição: a 55% o card de fundo quase funde com o fundo no tema ESCURO, e sem véu os dois cards ficam com o mesmo peso visual');
  // O z-index não é enfeite: no primeiro mockup ele era 1, o véu pintava ATRÁS
  // do `.card-body` (z-10) e as três variantes saíram IDÊNTICAS — 162 pixels
  // de 1.507.920. Eu quase reportei que escurecer não mudava nada.
  const z = /^\s*z-index:\s*(\d+)/m.exec(regra[0]);
  assert.ok(z && +z[1] > 10,
    `o véu está em z-index ${z && z[1]} — abaixo ou no mesmo nível do .card-body (z-10), ou seja invisível`);
});

test('o card da frente pinta acima do de fundo, por CLASSE e não por posição', () => {
  const zFrente = /\.place-card\s*\{\s*z-index:\s*(\d+)/.exec(SEM_COMENTARIO);
  const zFundo = /\.place-card\.card-fundo\s*\{[^}]*z-index:\s*(\d+)/.exec(SEM_COMENTARIO);
  assert.ok(zFrente && zFundo, 'as camadas da pilha sumiram do styles.css');
  assert.ok(+zFrente[1] > +zFundo[1],
    `o card de fundo (z ${zFundo[1]}) passou a pintar em cima do da frente (z ${zFrente[1]})`);
  // As três regras `:nth-child` que existiam aqui eram MORTAS — escritas pra
  // uma pilha de três cards que nunca existiu, e que não casavam com nada
  // porque o card é anexado depois do #focoAutorBar, do #loadingCard e do
  // próprio <template>. Posição no DOM muda quando alguém acrescenta um irmão.
  assert.ok(!/#cardStack \.place-card:(nth-child|first-child)/.test(SEM_COMENTARIO),
    'voltou a decidir a camada da pilha por posição no DOM');
});

test('o véu chega ao css/app.css, que é o que o app carrega', () => {
  // `styles.css` é minificado PARA DENTRO do app.css (gotcha #22): editar um
  // sem rodar `npm run css` não muda um pixel na tela.
  assert.match(APPCSS, /\.card-fundo-veu/,
    'o app.css gerado não tem o véu — falta rodar `npm run css`');
  assert.match(APPCSS, /rgba\(2,\s*6,\s*23,\s*\.?0?\.35\)/,
    'a opacidade do véu no app.css gerado não é a mesma do styles.css');
});

// ── 6. A ENTRADA DO CARD ───────────────────────────────────────────────────
//
// Decisão do owner (2026-09-20), em duas rodadas olhando o app rodar: primeiro
// "o próximo card não pode nascer com efeito nenhum" — o que tirou a mola e a
// escala —, e, depois de ver rodando o fade que tinha ficado pra
// avaliação, "pode tirar o fade". Hoje a entrada não tem efeito nenhum.
//
// O mecanismo era UM só: a classe `.card-enter`, que o `renderCurrentCard`
// pendurava no card recém-nascido. Ela fazia DUAS coisas, e é a segunda que
// explica por que estes guards olham o PAR: além de animar, ela escondia o
// card de fundo, porque o fade deixava o da frente translúcido e a pilha tem
// um card inteiro atrás (MEDIDO no pixel: 3 quadros com a foto do pedido de
// baixo e os dois nomes legíveis ao mesmo tempo).
//
// Quem reintroduzir efeito na entrada reintroduz o par — e estes testes é que
// vão cobrar isso, porque o defeito não dá erro nenhum: a tela só mostra o
// pedido errado por 150ms.
test('a entrada do card não tem efeito NENHUM', () => {
  assert.ok(!/\.card-enter/.test(SEM_COMENTARIO),
    'voltou uma regra `.card-enter` ao styles.css — o card novo passa a nascer com efeito, que é exatamente o que o owner pediu pra tirar (duas vezes)');
  assert.ok(!/@keyframes\s+cardEnter/.test(SEM_COMENTARIO),
    'os keyframes da entrada voltaram ao styles.css');
  for (const [nome, fonte] of [['app.js', APP], ['swipe.js', SWIPE]]) {
    assert.ok(!/card-enter/.test(semComentarioJS(fonte)),
      `${nome} voltou a mexer na classe da entrada — sem regra no CSS ela não anima nada, e com regra o card volta a nascer com efeito`);
  }
  // Meia remoção é a falha desta casa (gotcha #14): a constante do teto só
  // existia pra tirar a classe de qualquer jeito. Sem classe, ela é órfã.
  assert.ok(!/ENTRADA_TETO_MS/.test(APP),
    'a constante ENTRADA_TETO_MS ficou pra trás no app.js, sem classe nenhuma pra tirar');
});

test('nada esconde o card de fundo — porque nada o atravessa', () => {
  // A regra que escondia o card de fundo existia SÓ por causa da
  // translucidez do fade. Sem fade não há o que esconder, e esconder sem
  // motivo é a pilha piscando à toa. Se ela voltar sozinha, alguém reintroduziu
  // metade do par; se voltar com o fade, a decisão do owner foi revertida sem
  // passar por aqui.
  const escondem = [...SEM_COMENTARIO.matchAll(/([^{}]*\.card-fundo[^{}]*)\{([^}]*)\}/g)]
    .filter((m) => /visibility:\s*hidden/.test(m[2]));
  assert.equal(escondem.length, 0,
    'alguma regra voltou a esconder o card de fundo: ' + escondem.map((m) => m[1].trim()).join(' | '));
  // E a escotilha de reduced-motion que existia só por causa dela também não
  // pode ficar órfã — ela devolvia `visibility: visible` a um card que hoje
  // ninguém esconde.
  const rm = CSS.match(/@media\s*\(prefers-reduced-motion[^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(rm, 'o bloco de prefers-reduced-motion sumiu do styles.css');
  assert.ok(!/card-fundo/.test(rm[0].replace(/\/\*[\s\S]*?\*\//g, '')),
    'sobrou no reduced-motion uma regra sobre o card de fundo que só fazia sentido com o fade');
});

test('o CSS morto da saída não voltou', () => {
  // `.swipe-out-left/right/up` e seus keyframes existiram por muito tempo sem
  // NENHUM uso: quem anima a saída é o `animateSwipeOut`, escrevendo estilo
  // inline. Elas chegaram a me enganar numa medição — procurei a classe pra
  // saber qual card estava saindo, não achei, e conclui que o gesto não tinha
  // commitado quando tinha.
  assert.ok(!/\.swipe-out-(left|right|up)\s*\{/.test(SEM_COMENTARIO),
    'as classes .swipe-out-* voltaram ao CSS sem nenhum uso em js/');
  const usos = [APP, SWIPE].map(semComentarioJS).join('\n');
  assert.ok(!/swipe-out-/.test(usos),
    'algum arquivo passou a usar .swipe-out-* — então o CSS precisa voltar junto');
});

test('o app.css gerado não carrega animação de entrada', () => {
  // O guard acima lê o FONTE; este lê o que o app de fato CARREGA. Editar o
  // styles.css sem rodar `npm run css` não muda um pixel na tela — e aqui o
  // sintoma seria o contrário do normal: o efeito que o owner mandou tirar
  // continuaria rodando em produção com o fonte já limpo.
  assert.ok(!/card-enter|cardEnter/.test(APPCSS),
    'o app.css gerado ainda tem a animação de entrada — falta rodar `npm run css`');
  assert.ok(!/swipeOut(Left|Right|Up)/.test(APPCSS),
    'o app.css gerado ainda tem os keyframes mortos da saída');
});

// ── 7. O TIQUE NO APARELHO ─────────────────────────────────────────────────
//
// É o sinal MAIS FREQUENTE do app — um por pedido tratado, e a fila real tem
// centenas. O owner baixou de 12 pra 8ms depois de comparar no celular dele.
//
// O guard NÃO trava o número (isso seria só detector de mudança): trava o que
// pode quebrar sem ninguém ver — que ele saia de UMA constante nomeada, que
// dispare no caminho do COMMIT e que degrade calado onde a API não existe.
test('o tique do commit sai de uma constante, não de um número solto', () => {
  const f = semComentarioJS(fatiar(SWIPE, 'animateSwipeOut'));
  assert.match(f, /navigator\.vibrate\(VIBRACAO_COMMIT_MS\)/,
    'o tique voltou a ser um número escrito na linha — e aí a próxima pessoa muda sem achar o porquê, que está no comentário da constante');
  assert.match(f, /if \(navigator\.vibrate\)/,
    'sumiu a guarda de suporte: no Safari do iPhone `navigator.vibrate` não existe e isto passa a LANÇAR no meio do gesto');
  const c = /const VIBRACAO_COMMIT_MS = (\d+);/.exec(SWIPE);
  assert.ok(c, 'a constante do tique sumiu do swipe.js');
  // Faixa de sanidade, não o valor: acima disso deixa de ser tique e vira
  // zumbido, num sinal que se repete centenas de vezes por fila.
  assert.ok(+c[1] > 0 && +c[1] <= 40,
    `o tique está em ${c[1]}ms — fora da faixa de um toque seco`);
});

test('o tique dispara UMA vez, e só no commit', () => {
  const f = semComentarioJS(fatiar(SWIPE, 'animateSwipeOut'));
  assert.equal((f.match(/navigator\.vibrate\(/g) || []).length, 1,
    'mais de uma chamada de vibração no mesmo commit — o editor sentiria um tique duplo por pedido');
  // O `handleDragEnd` NÃO pode vibrar por conta própria: ele é quem decide
  // entre commitar e devolver o card ao lugar, e vibrar lá faria o gesto que
  // NÃO trata nada avisar que tratou.
  const fim = semComentarioJS(fatiar(SWIPE, 'handleDragEnd'));
  assert.ok(!/navigator\.vibrate/.test(fim),
    'o handleDragEnd passou a vibrar — o arraste que volta ao lugar não confirmou nada e não pode avisar que sim');
});

test('o tique do FAB do modo dev é OUTRO, e segue separado', () => {
  // Conceitos diferentes podem ter durações diferentes: "confirmei um pedido"
  // acontece centenas de vezes por fila; "agarrei o botão" acontece uma vez a
  // cada muitas sessões. O que não pode é um puxar o outro sem querer.
  assert.ok(!/VIBRACAO_COMMIT_MS/.test(APP),
    'o app.js passou a usar a constante do commit — se for pra compartilhar, que seja uma decisão escrita, não um reuso silencioso');
  assert.match(semComentarioJS(APP), /navigator\.vibrate && navigator\.vibrate\(\d+\)/,
    'o aviso tátil do FAB do modo dev sumiu');
});

test('o card de fundo desenha o mapa DEPOIS de entrar no DOM', () => {
  const f = fatiar(APP, 'montarCardDeFundo');
  const fSem = semComentarioJS(f);
  // `renderMapa` mede com `box.clientWidth || 400`: fora do DOM isso é 0 e ele
  // enquadra pra 400×240, um tamanho que não é o do card. No card da FRENTE o
  // erro se conserta sozinho (o ResizeObserver de `vigiarCaixaDoMapa` refaz
  // quando a caixa assenta); no de fundo NÃO, porque `cloneNode` não copia
  // propriedade JS e o observer fica no original.
  // Relatado pelo owner com duas capturas do mesmo pedido, e reproduzido:
  // caixa 359×337 nos dois, desenhada pra 359×337 na frente e 400×240 no fundo.
  const iAppend = fSem.indexOf('stack.appendChild(fundo)');
  const iMapa = fSem.indexOf('desenharMapaComCaixa(fundo');
  assert.ok(iAppend > 0, 'não achei o appendChild do card de fundo');
  assert.ok(iMapa > 0,
    'o card de fundo não redesenha mais o mapa: ele volta a guardar o enquadramento '
    + 'de uma caixa 400×240 que não é a dele, e o mapa MUDA DE TAMANHO ao virar frente');
  assert.ok(iMapa > iAppend,
    'o redesenho do mapa ficou ANTES do appendChild — fora do DOM a caixa mede 0 e '
    + '`renderMapa` cai no mesmo fallback de 400×240 que este conserto existe pra evitar');

  // O card da FRENTE tem o MESMO problema, e o observer só o conserta quando a
  // caixa CRESCE: num card com diff ela ENCOLHE em relação ao fallback (359×144
  // contra 400×240, proporção 2,49 contra 1,67 — zoom diferente) e ninguém
  // refaz. Por isso o desenho é fonte única e vale pros dois.
  const rSem = semComentarioJS(fatiar(APP, 'renderCurrentCard'));
  const jAppend = rSem.indexOf("getElementById('cardStack').appendChild(card)");
  const jMapa = rSem.indexOf('desenharMapaComCaixa(card');
  assert.ok(jAppend > 0 && jMapa > 0,
    'o card da FRENTE não desenha mais o mapa com a caixa no DOM: ele guarda o '
    + 'enquadramento do fallback sempre que a caixa real é menor que 400×240');
  assert.ok(jMapa > jAppend,
    'o desenho do mapa do card da frente ficou ANTES do appendChild — mesma caixa 0, '
    + 'mesmo fallback');

  // Só com o mapa VISÍVEL: escondido a caixa é 0 e o fallback volta.
  const h = semComentarioJS(fatiar(APP, 'desenharMapaComCaixa'));
  assert.match(h, /classList\.contains\('hidden'\)[\s\S]{0,60}return/,
    'o desenho deixou de exigir o mapa visível — caixa escondida mede 0 e cai no '
    + 'fallback de novo');
});

test('o ouvinte que amplia o mapa é pendurado UMA vez, no card da frente', () => {
  const rm = semComentarioJS(fatiar(APP, 'renderMapa'));
  // `renderMapa` roda MAIS DE UMA VEZ por card: o observer de caixa o refaz
  // quando o layout assenta. Com o ouvinte lá dentro, cada passada pendurava
  // outro no MESMO elemento — e `stopPropagation` não impede o irmão (isso
  // seria `stopImmediatePropagation`). MEDIDO antes do conserto: um clique
  // abria o lightbox 2× num card recém-montado, e 3× depois do 1º refazer.
  assert.ok(!/addEventListener\('click'/.test(rm),
    'o ouvinte de clique voltou pro `renderMapa`, que roda mais de uma vez por card: '
    + 'cada refazer pendura outro e o lightbox passa a abrir N vezes por clique');
  // E ele existe no card da FRENTE — senão o conserto virou remoção do recurso.
  const rc = semComentarioJS(fatiar(APP, 'renderCurrentCard'));
  assert.match(rc, /\.card-map'\)[\s\S]{0,200}addEventListener\('click'[\s\S]{0,200}MapaLightbox\.open\(place\)/,
    'ninguém mais amplia o mapa pelo card: tirar o ouvinte do renderMapa sem repô-lo '
    + 'aqui não é conserto, é remoção do recurso');
  // O card de FUNDO segue sem interação: quem monta os dois é o `montarCard`.
  const mc = semComentarioJS(fatiar(APP, 'montarCard'));
  assert.ok(!/\.card-map'\)[\s\S]{0,160}addEventListener\('click'/.test(mc),
    'o ouvinte do mapa entrou no `montarCard` — o card de FUNDO passaria a ter '
    + 'interação, que é o que o clone existe pra impedir');
  // gotcha #22: é o js/min/ que o navegador carrega. A âncora NÃO pode ser um
  // nome de variável local — o minificador os renomeia (`fundo` virou `e`),
  // então `renderMapa(fundo` reprovava código certo. Nome de função global
  // sobrevive, e o que muda com o conserto é a CONTAGEM de chamadas:
  // a declaração + `vigiarCaixaDoMapa` + `updateImage` + o card de fundo.
  const MIN = readFileSync(new URL('../js/min/app.js', import.meta.url), 'utf8');
  const usos = (MIN.match(/desenharMapaComCaixa\(/g) || []).length;
  assert.equal(usos, 3,
    `js/min/app.js tem ${usos} usos de desenharMapaComCaixa, esperado 3 (declaração + `
    + 'card da frente + card de fundo). Faltou `npm run js`, ou uma chamada saiu');
});

test('a distância de uma entrada proposta é até o local DO CARD — o de fundo não mede a partir do da frente', () => {
  // Auditoria de 2026-09-25: `valorDeLista` lia o centro do `AppState.currentPlace`,
  // e o card de FUNDO da pilha mostrava a entrada dele "a 3 km" do local da frente.
  const APP_ = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const fatia = (nome) => {
    const i = APP_.indexOf('function ' + nome + '(');
    return APP_.slice(i, APP_.indexOf('\n}\n', i) + 2);
  };
  const deps = {
    t: (k, v) => (k === 'card.eep.aDistancia' ? `a ${v.d}` : k),
    formatarMetros: (m) => Math.round(m) + ' m',
    itemDeListaAusente: (v) => v == null || v === '',
    nomeDoDia: String, objetoLegivel: JSON.stringify, rotuloDeEnum: String,
    AppState: { currentPlace: { mapa: { centro: [-23.0, -46.0] } } },   // o da FRENTE, longe
  };
  const nomes = Object.keys(deps);
  const valor = new Function(...nomes, fatia('valorDeLista') + '\nreturn valorDeLista;')(...nomes.map((n) => deps[n]));
  const entrada = { entry: true, point: { type: 'Point', coordinates: [-46.6333, -23.5505] } };   // GeoJSON: [lon, lat]
  const doFundo = [-23.5506, -46.6333];   // o local DESTE card, a ~11 m
  const r = valor(entrada, 'entryExitPoints', doFundo);
  assert.match(r, /a 11 m$/, `a distância não é até o local do card: ${r}`);
  // Controle: sem o centro do card, a coordenada volta (nunca a distância até OUTRO local).
  assert.match(valor(entrada, 'entryExitPoints', null), /-23\.55050, -46\.63330$/);
  // E quem monta o card passa o centro DELE.
  assert.match(fatia('renderCardChanges'), /const centroDoLocal = place\.mapa && place\.mapa\.centro;/);
  assert.match(fatia('renderCardChanges'), /itemDeLista\(v, 'diff-add', '\+', c\.field, centroDoLocal\)/);
  assert.doesNotMatch(fatia('valorDeLista'), /AppState\.currentPlace/, 'voltou a medir a partir do card da frente');
});
