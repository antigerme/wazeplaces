// "REDUZIR MOVIMENTO" E A SAÍDA DO CARD — auditoria da rodada 24, R24-8-03.
//
// Com `prefers-reduced-motion: reduce` o CSS zera a duração e o card SOME NA
// HORA, mas o `animateSwipeOut` esperava os 350 ms de sempre antes de chamar o
// callback: o próximo pedido só assumia o lugar ~0,35 s depois, sem animação
// nenhuma (MEDIDO: 476 ms no Chromium, 511 ms no WebKit; 200 pedidos × 0,35 s).
//
// O `swipe.js` roda de VERDADE aqui (documento de mentira, como em
// `gestos-card.test.mjs`), com os timers ADIADOS: o que se confere é se existe
// um temporizador de 350 ms esperando e quando o callback decide. Cada teste foi
// visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SWIPE = readFileSync(new URL('../js/swipe.js', import.meta.url), 'utf8');
const MIN = readFileSync(new URL('../js/min/swipe.js', import.meta.url), 'utf8');

function montar({ reduzir, fonte = SWIPE } = {}) {
  const ouvintes = {};
  const doc = {
    addEventListener: (t, fn) => { (ouvintes[t] ||= new Set()).add(fn); },
    removeEventListener: (t, fn) => { if (ouvintes[t]) ouvintes[t].delete(fn); },
  };
  const decidiu = [], fins = [];
  const relogio = { agora: 1000 };
  const timers = [];   // [{ fn, ms }]
  const card = {
    style: {}, classList: { add() {}, remove() {}, contains: () => false },
    querySelector: () => ({ style: {}, querySelector: () => null }),
    addEventListener: () => {},
  };
  const consultas = [];
  const win = {
    innerWidth: 400,
    cardDaFrente: () => card,
    aoFimDoGesto: (c) => fins.push(c),
  };
  if (reduzir !== undefined) {
    win.matchMedia = (q) => { consultas.push(q); return { matches: reduzir && /prefers-reduced-motion: reduce/.test(q) }; };
  }
  const ctx = {
    document: doc, window: win, navigator: {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    performance: { now: () => relogio.agora }, console,
    onSwipeLeft: (c) => decidiu.push(['left', c]),
    onSwipeRight: (c) => decidiu.push(['right', c]),
    onSwipeUp: (c) => decidiu.push(['up', c]),
  };
  vm.createContext(ctx);
  vm.runInContext(fonte + '\nthis.__estado = () => ({ animating, cardSaindo });', ctx);
  return { ctx, card, decidiu, fins, timers, consultas, win, estado: () => ctx.__estado() };
}

const microtarefas = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const t350 = (g) => g.timers.filter((t) => t.ms === 350 || t.ms === 300);

for (const [nome, fonte] of [['js/swipe.js', SWIPE], ['js/min/swipe.js (o que o app carrega)', MIN]]) {
  test(`${nome}: sem Reduzir movimento a saída espera os 350 ms, como sempre (CONTROLE)`, async () => {
    const g = montar({ reduzir: false, fonte });
    g.ctx.triggerSwipe('left', (c) => g.decidiu.push(['left', c]));
    await microtarefas();
    assert.equal(g.decidiu.length, 0, 'o callback saiu antes da animação: o movimento normal mudou');
    assert.equal(t350(g).length, 1, 'sumiu o temporizador da animação de saída');
    assert.equal(g.estado().animating, true);
    g.timers.shift().fn();
    assert.equal(g.decidiu.length, 1);
    assert.equal(g.decidiu[0][1], g.card, 'o callback recebe o card que SAIU');
    assert.equal(g.fins.length, 1, 'o fim do gesto não foi avisado');
    assert.equal(g.estado().animating, false);
  });

  test(`${nome}: SEM matchMedia nenhum (navegador antigo) o movimento é o normal`, async () => {
    const g = montar({ fonte });   // window sem matchMedia
    g.ctx.triggerSwipe('right', (c) => g.decidiu.push(['right', c]));
    await microtarefas();
    assert.equal(g.decidiu.length, 0);
    assert.equal(t350(g).length, 1);
  });

  test(`${nome}: com Reduzir movimento o card conclui no MESMO quadro — nenhum temporizador de 350 ms, o callback uma vez só`, async () => {
    const g = montar({ reduzir: true, fonte });
    g.ctx.triggerSwipe('left', (c) => g.decidiu.push(['left', c]));
    // Fora da pilha de quem chamou: o callback decide pedido e o botão/a tecla
    // ainda estão no meio do tratamento do evento deles.
    assert.equal(g.decidiu.length, 0, 'o callback rodou DENTRO da chamada do gesto (reentrância)');
    assert.equal(g.estado().animating, true, 'a guarda de reentrada abriu antes de o callback rodar');
    // Um segundo gesto nesse meio-tempo não decide de novo.
    g.ctx.triggerSwipe('left', (c) => g.decidiu.push(['left2', c]));
    await microtarefas();
    assert.equal(t350(g).length, 0, 'ficou um temporizador de 350 ms: o próximo card ainda espera sem animação');
    assert.equal(g.timers.length, 0, 'sobrou temporizador na saída com Reduzir movimento');
    assert.deepEqual(g.decidiu.map((d) => d[0]), ['left'], 'a ação não rodou exatamente uma vez');
    assert.equal(g.decidiu[0][1], g.card);
    assert.equal(g.fins.length, 1, 'o fim do gesto (o que espera o card parar) não foi avisado');
    assert.equal(g.estado().animating, false);
    assert.equal(g.estado().cardSaindo, null, 'o card seguiu como "saindo"');
    assert.ok(g.consultas.some((q) => /prefers-reduced-motion: reduce/.test(q)));
  });

  test(`${nome}: a preferência é lida A CADA saída (muda com o app aberto)`, async () => {
    const g = montar({ reduzir: false, fonte });
    g.ctx.triggerSwipe('left', () => {});
    g.timers.shift().fn();
    g.win.matchMedia = () => ({ matches: true });
    g.ctx.triggerSwipe('left', (c) => g.decidiu.push(['left', c]));
    await microtarefas();
    assert.equal(g.decidiu.length, 1, 'a preferência foi lida uma vez só, na carga');
    assert.equal(g.timers.length, 0);
  });

  test(`${nome}: matchMedia que LANÇA não derruba o gesto`, async () => {
    const g = montar({ fonte });
    g.win.matchMedia = () => { throw new Error('boom'); };
    g.ctx.triggerSwipe('up', (c) => g.decidiu.push(['up', c]));
    assert.equal(t350(g).length, 1, 'com matchMedia quebrado o gesto deve seguir o movimento normal');
    g.timers.shift().fn();
    assert.equal(g.decidiu.length, 1);
  });
}
