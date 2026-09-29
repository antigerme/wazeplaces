// O zoom da foto ampliada (pinça, roda, duplo toque) tem uma invariante: o ponto
// da foto que está sob o dedo CONTINUA sob o dedo. A fórmula antiga só a cumpria
// com a foto centrada (t = 0); depois do primeiro zoom ela escorregava t·(r − 1)
// a cada passo (auditoria de 2026-09-25). `Lightbox.zoomTo` EXECUTADO, com um
// retângulo que inclui a transformação, como o do navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function lightbox() {
  const ini = APP.indexOf('    zoomTo(scale, cx, cy) {');
  assert.ok(ini > 0, 'zoomTo sumiu');
  let prof = 0, fim = -1;
  for (let j = APP.indexOf('{', ini); j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const zoomTo = APP.slice(ini, fim).trim();
  // Layout da foto: centro (200, 400), 300×200. O retângulo VISUAL inclui o
  // translate e o scale (origem no centro), como o getBoundingClientRect.
  const C = { x: 200, y: 400 }, W = 300, H = 200;
  const lb = { scale: 1, tx: 0, ty: 0, _applyTransform() {} };
  const img = { getBoundingClientRect: () => ({ left: C.x + lb.tx - (W * lb.scale) / 2, top: C.y + lb.ty - (H * lb.scale) / 2,
    width: W * lb.scale, height: H * lb.scale }) };
  const document = { getElementById: () => img };
  lb.zoomTo = new Function('document', 'return function ' + zoomTo.replace(/^zoomTo/, 'zoomTo'))(document);
  // Onde um ponto da foto (em coordenadas da foto, centradas) aparece na tela.
  lb.naTela = (u) => ({ x: C.x + lb.tx + lb.scale * u.x, y: C.y + lb.ty + lb.scale * u.y });
  lb.naFoto = (p) => ({ x: (p.x - C.x - lb.tx) / lb.scale, y: (p.y - C.y - lb.ty) / lb.scale });
  return lb;
}

test('zoom: o ponto sob o dedo fica sob o dedo — também DEPOIS do primeiro zoom', () => {
  const lb = lightbox();
  const passos = [[2, 250, 420], [3, 120, 330], [2.5, 310, 470], [4, 200, 400], [1.5, 90, 350]];
  for (const [s, x, y] of passos) {
    const dedo = { x, y };
    const u = lb.naFoto(dedo);
    lb.zoomTo(s, x, y);
    const depois = lb.naTela(u);
    assert.ok(Math.abs(depois.x - x) < 1e-6 && Math.abs(depois.y - y) < 1e-6,
      `zoom ${s} em (${x},${y}): o ponto da foto foi parar em (${depois.x.toFixed(1)},${depois.y.toFixed(1)})`);
  }
});

test('zoom: voltar a 1× recentra a foto', () => {
  const lb = lightbox();
  lb.zoomTo(3, 260, 430);
  lb.zoomTo(1, 50, 50);
  assert.deepEqual([lb.scale, lb.tx, lb.ty], [1, 0, 0]);
});

// ── L14: a roda em PIXELS, só a vertical (auditoria de 2026-09-26) ───────────
// No mapa cada EVENTO de roda era um nível de zoom (20 eventos de trackpad de
// −4 subiam 2 níveis) e, no mapa e na foto, a rolagem só horizontal (deltaY 0)
// caía no "afastar". `deltaDaRoda` de verdade.
function fatiarFuncao(nome) {
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(APP);
  assert.ok(m, `${nome} sumiu`);
  let prof = 0;
  for (let j = APP.indexOf('{', APP.indexOf(')', m.index)); j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}' && --prof === 0) return APP.slice(m.index, j + 1);
  }
  throw new Error('não fechou');
}
test('L14 a roda: horizontal não é zoom, e o delta vira PIXELS (linha e página multiplicam)', () => {
  const delta = new Function('window', 'RODA_DENTE_PX', fatiarFuncao('deltaDaRoda') + '\nreturn deltaDaRoda;')(
    { innerHeight: 800 }, 100);
  assert.equal(delta({ deltaX: 40, deltaY: 0, deltaMode: 0 }), 0, 'rolagem só HORIZONTAL virou zoom (afastava)');
  assert.equal(delta({ deltaX: 30, deltaY: -4, deltaMode: 0 }), 0, 'a horizontal que DOMINA virou zoom');
  assert.equal(delta({ deltaX: 0, deltaY: -4, deltaMode: 0 }), -4, 'CONTROLE: o trackpad vertical sumiu');
  assert.equal(delta({ deltaX: 0, deltaY: 100, deltaMode: 0 }), 100);
  assert.equal(delta({ deltaX: 0, deltaY: 3, deltaMode: 1 }), 120, 'a roda em modo LINHA (3 linhas por dente) não virou pixels');
  assert.equal(delta({ deltaX: 0, deltaY: 1, deltaMode: 2 }), 800, 'a roda em modo PÁGINA não virou pixels');
  // O mapa ACUMULA até um dente por nível; a foto é proporcional ao delta.
  const setup = fatiarFuncao('setupMapaLightbox');
  assert.match(setup, /if \(Math\.abs\(rodaAcum\) < RODA_DENTE_PX\) return;/, 'o mapa voltou a dar um nível por EVENTO de roda');
  const foto = fatiarFuncao('setupLightbox');
  assert.match(foto, /Math\.pow\(1\.2, -dy \/ RODA_DENTE_PX\)/, 'a foto voltou a dar 1,2× por EVENTO de roda');
});

// ── L15: o duplo toque do mapa tolera o tremor do dedo ──────────────────────
// (auditoria de 2026-09-26). QUALQUER movimento virava arraste e matava o
// duplo toque: com 1 px de tremor o mapa não aproximava (a foto, com 3, sim).
// O `setupMapaLightbox` de verdade, com o DOM, a janela e o relógio de mentira.
function mapaComGestos() {
  const log = [];
  const lb = { h: {}, addEventListener(t, fn) { this.h[t] = fn; } };
  const win = {};
  let T = 1000;
  const deps = {
    document: { getElementById: (id) => (id === 'mapaLightbox' ? lb : { addEventListener() {} }) },
    MapaLightbox: { zoom: (d) => log.push('zoom' + d), arrastar: () => {}, isOpen: () => true },
    addEventListener: (t, fn) => { win[t] = fn; }, removeEventListener: (t) => { delete win[t]; },
    requestAnimationFrame: (fn) => { fn(); return 1; }, cancelAnimationFrame: () => {},
    performance: { now: () => T }, Date: { now: () => T },
    deltaDaRoda: () => 0, RODA_DENTE_PX: 100,
  };
  const src = ['DUPLO_TOQUE_MS', 'DUPLO_TOQUE_RAIO_PX', 'TOQUE_FOLGA_PX'].map((c) => {
    const m = new RegExp('^const ' + c + ' = (\\d+);', 'm').exec(APP);
    assert.ok(m, `${c} sumiu`);
    return `const ${c} = ${m[1]};`;
  }).join('\n');
  new Function(...Object.keys(deps), src + '\n' + fatiarFuncao('setupMapaLightbox') + '\nsetupMapaLightbox();')(...Object.values(deps));
  const alvo = { closest: () => null };
  const toque = (x, y, tremor = 0) => {
    lb.h.pointerdown({ target: alvo, pointerId: 1, clientX: x, clientY: y, preventDefault() {} });
    if (tremor) win.pointermove({ pointerId: 1, clientX: x + tremor, clientY: y + tremor });
    win.pointerup({ pointerId: 1, clientX: x + tremor, clientY: y + tremor });
    lb.h.click({ target: alvo, clientX: x + tremor, clientY: y + tremor });
    T += 120;
  };
  return { toque, log, esperar: (ms) => { T += ms; } };
}

test('L15 duplo toque no mapa: aproxima com o tremor de um dedo; arraste e toques longe não', () => {
  for (const tremor of [0, 1, 3]) {
    const m = mapaComGestos();
    m.toque(200, 450, tremor); m.toque(200, 450, tremor);
    assert.deepEqual(m.log, ['zoom1'], `duplo toque com ${tremor} px de tremor não aproximou (a foto aproxima)`);
  }
  // CONTROLE: arrastar de verdade não é toque, e não aproxima.
  const a = mapaComGestos();
  a.toque(200, 450, 30); a.toque(200, 450, 30);
  assert.deepEqual(a.log, [], 'um ARRASTE de 30 px contou como toque e aproximou');
  // Dois toques LONGE um do outro não são um duplo toque (a régua da foto).
  const l = mapaComGestos();
  l.toque(100, 200); l.toque(300, 600);
  assert.deepEqual(l.log, [], 'dois toques a 450 px um do outro aproximaram');
  // Depois de um duplo toque, o terceiro não aproxima de novo.
  const t3 = mapaComGestos();
  t3.toque(200, 450); t3.toque(200, 450); t3.toque(200, 450);
  assert.deepEqual(t3.log, ['zoom1'], 'o terceiro toque aproximou de novo');
  // E o tempo: toques espaçados não são duplo toque.
  const d = mapaComGestos();
  d.toque(200, 450); d.esperar(400); d.toque(200, 450);
  assert.deepEqual(d.log, [], 'dois toques a 520 ms um do outro aproximaram');
});
