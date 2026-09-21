// UM DEDO ARRASTA, E SÓ ELE ENCERRA O GESTO.
//
// O `swipe.js` escuta `touchend` no `document` e, até v2026.09.21-07, não
// guardava QUAL dedo tinha começado o arraste. Qualquer segundo toque que
// saísse da tela era lido como "soltou o card" — e, passado o limiar, COMMITAVA.
//
// MEDIDO com controle, antes do conserto:
//   um dedo, arrasta e solta ................. card avança, 1 rejeitado  (certo)
//   segundo dedo encosta e NÃO solta ......... card fica                 (certo)
//   segundo dedo toca e SOLTA ................ card avança, 1 rejeitado  (ERRADO)
//
// O owner topou com isso tentando usar o botão do modo dev durante o arraste,
// mas o alcance é muito maior: a palma encostando na borda, o outro polegar,
// qualquer toque acidental — e acontece CALADO, que é o que o torna caro. Um
// pedido tratado sem ninguém ter decidido.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SWIPE = readFileSync(new URL('../js/swipe.js', import.meta.url), 'utf8');
const MIN = readFileSync(new URL('../js/min/swipe.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67) — e por LINHA, não com um
// replace global que come tudo depois de qualquer `https://`.
const semComentario = (s) => s.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const fatiar = (nome) => {
  const f = semComentario(SWIPE);
  const i = f.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, `não achei ${nome} no swipe.js`);
  let p = f.indexOf('{', f.indexOf(')', i)), n = 0, j = p;
  for (; j < f.length; j++) { if (f[j] === '{') n++; else if (f[j] === '}' && --n === 0) break; }
  const corpo = f.slice(p, j + 1);
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
};

test('o arraste guarda QUAL dedo começou', () => {
  const s = fatiar('handleDragStart');
  assert.match(s, /dragTouchId = t \? t\.identifier : null/,
    'o arraste parou de guardar o dedo: qualquer segundo toque volta a poder commitar o card');
  // `changedTouches[0]` e NÃO `touches[0]`: o que interessa é o dedo que ACABOU
  // de encostar, e num segundo toque ele não é o [0] da lista.
  assert.match(s, /e\.changedTouches && e\.changedTouches\[0\]/,
    'voltou a ler `touches[0]` no início: com dois dedos na tela isso pega o dedo errado');
});

test('só o dedo do arraste encerra o gesto', () => {
  const s = fatiar('handleDragEnd');
  assert.match(s, /changedTouches[\s\S]{0,120}!toqueDoArraste\(e\.changedTouches\)[\s\S]{0,20}return/,
    'o `handleDragEnd` deixou de filtrar por dedo — um toque em qualquer lugar da tela '
    + 'volta a tratar o pedido que está sendo arrastado');
  // O move tem que seguir O MESMO dedo: se o primeiro sair e o segundo ficar,
  // `touches[0]` passa a ser o outro e o card SALTA pra onde ele estiver.
  const m = fatiar('handleDragMove');
  assert.match(m, /toqueDoArraste\(e\.touches\)/,
    'o `handleDragMove` voltou ao `touches[0]`: o card salta pro segundo dedo');
  assert.match(m, /if \(!t\) return;/,
    '`touchmove` de outro dedo deixou de ser ignorado');
});

test('identifier 0 é um dedo válido', () => {
  const f = semComentario(SWIPE);
  const i = f.indexOf('function toqueDoArraste');
  assert.ok(i > 0, 'o helper `toqueDoArraste` sumiu');
  const corpo = f.slice(i, f.indexOf('\n}', i));
  // `identifier` pode ser 0 — `!dragTouchId` mandaria o arraste embora calado.
  // Mesmo cuidado que o `autorEmFoco` já exigiu com creatorId 0.
  assert.match(corpo, /dragTouchId === null/,
    'a checagem virou falsy: `identifier` 0 é um dedo legítimo e passaria a ser ignorado');
  assert.ok(!/!dragTouchId/.test(corpo),
    'voltou o teste falsy do identifier — o dedo 0 deixa de arrastar, em silêncio');
});

test('o arraste captura UM momento, e só com o modo dev ativo', () => {
  const m = fatiar('handleDragMove');
  // Pedido do owner: o defeito do mapa do card de fundo SÓ existe no meio do
  // gesto, e ele teve que fotografar a tela com o celular.
  assert.match(m, /dlogCapturarAuto\('arraste'\)/,
    'o gatilho de captura no arraste sumiu: o estado do meio do gesto volta a não '
    + 'existir no arquivo que o editor manda');
  // UMA por gesto: `touchmove` dispara dezenas de vezes e cada momento carrega
  // um `outerHTML` inteiro.
  assert.match(m, /!capturouNesteGesto/,
    'a captura deixou de ser uma por gesto — cada quadro do arraste passa a guardar um DOM');
  const st = fatiar('handleDragStart');
  assert.match(st, /capturouNesteGesto = false/,
    'a bandeira não zera no início do gesto: captura uma vez e nunca mais');
  // O portão do modo dev é do `dlogCapturarAuto` (o momento carrega nome e
  // endereço de terceiros). Chamar o `dlogCapturar` cru aqui furaria isso.
  assert.ok(!/dlogCapturar\(/.test(m),
    'a captura chama o `dlogCapturar` cru, pulando o portão do modo dev e o teto de 30s '
    + '— o momento carrega DOM com dado de terceiro');
  // E nunca pode derrubar o gesto.
  assert.match(m, /try \{[\s\S]{0,120}dlogCapturarAuto[\s\S]{0,60}\} catch/,
    'a captura saiu do try/catch: um erro nela passa a matar o arraste no meio');
  // gotcha #22: é o js/min/ que o navegador carrega.
  assert.ok(/dragTouchId/.test(MIN) && /arraste/.test(MIN),
    'js/min/swipe.js está velho — faltou `npm run js`, e o celular segue com o defeito');
});
