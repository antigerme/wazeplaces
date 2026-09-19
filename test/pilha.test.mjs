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
    'no último pedido da fila a app passaria a desenhar algo por baixo — e o que há ali é o fim da fila, que a janela do Desfazer ainda pode desfazer');
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
  // A foto do card é o LCP da app. Montar o de fundo na mesma hora põe a foto
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

test('o véu chega ao css/app.css, que é o que a app carrega', () => {
  // `styles.css` é minificado PARA DENTRO do app.css (gotcha #22): editar um
  // sem rodar `npm run css` não muda um pixel na tela.
  assert.match(APPCSS, /\.card-fundo-veu/,
    'o app.css gerado não tem o véu — falta rodar `npm run css`');
  assert.match(APPCSS, /rgba\(2,\s*6,\s*23,\s*\.?0?\.35\)/,
    'a opacidade do véu no app.css gerado não é a mesma do styles.css');
});
