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
  // `semClick`: o WebKit (Safari, e todo navegador do iPhone) NÃO manda o
  // `click` de um toque cujo `pointerdown` teve `preventDefault` (L20); o
  // Chromium manda. O mapa não pode depender dele.
  const toque = (x, y, tremor = 0, { semClick = false } = {}) => {
    lb.h.pointerdown({ target: alvo, pointerId: 1, clientX: x, clientY: y, preventDefault() {} });
    if (tremor) win.pointermove({ pointerId: 1, clientX: x + tremor, clientY: y + tremor });
    win.pointerup({ type: 'pointerup', pointerId: 1, clientX: x + tremor, clientY: y + tremor });
    if (!semClick && lb.h.click) lb.h.click({ target: alvo, clientX: x + tremor, clientY: y + tremor });
    T += 120;
  };
  return { toque, log, lb, win, esperar: (ms) => { T += ms; } };
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

// ── L20: no iPhone o toque NÃO gera `click` (auditoria de 2026-09-29) ───────
// O `pointerdown` do mapa ampliado chama `preventDefault()` (sem ele o mouse
// arrasta a <img> do tile como imagem), e no WebKit — o Safari, e todo
// navegador do iPhone — isso mata o `click` do toque. MEDIDO com toque de
// verdade no WebKit do Playwright: 2 toques no mapa → 0 `click`, zoom 17 → 17;
// e o Street View, um <a>, não abria (0 de 2, com o ↗ do card abrindo 2 de 2).
// No Chromium, os dois funcionavam. A tela é medida no smoke de layout, nos
// dois motores; aqui, o gesto — o `setupMapaLightbox` de verdade.
test('L20 duplo toque no mapa SEM `click` (o WebKit): aproxima — o toque é decidido ao soltar', () => {
  for (const tremor of [0, 1, 3]) {
    const m = mapaComGestos();
    m.toque(200, 450, tremor, { semClick: true }); m.toque(200, 450, tremor, { semClick: true });
    assert.deepEqual(m.log, ['zoom1'], `sem o \`click\` (o iPhone), o duplo toque com ${tremor} px de tremor não aproximou`);
  }
  // CONTROLE: um toque só não aproxima — a medida não conta o soltar como zoom.
  const u = mapaComGestos();
  u.toque(200, 450, 0, { semClick: true });
  assert.deepEqual(u.log, [], 'um toque SÓ aproximou');
  // Com o `click` também (o Chromium), aproxima UMA vez, não duas.
  const c = mapaComGestos();
  c.toque(200, 450); c.toque(200, 450);
  assert.deepEqual(c.log, ['zoom1'], 'com o `click` e o soltar juntos, o duplo toque aproximou dobrado');
});

test('L20 a pinça, o toque de dois dedos e o toque que o navegador CANCELA não são toque', () => {
  const m = mapaComGestos();
  const alvo = { closest: () => null };
  const baixa = (id, x, y) => m.lb.h.pointerdown({ target: alvo, pointerId: id, clientX: x, clientY: y, preventDefault() {} });
  // Dois dedos que descem e sobem sem andar, duas vezes seguidas.
  for (let i = 0; i < 2; i++) {
    baixa(1, 180, 450); baixa(2, 240, 450);
    m.win.pointerup({ type: 'pointerup', pointerId: 2, clientX: 240, clientY: 450 });
    m.win.pointerup({ type: 'pointerup', pointerId: 1, clientX: 180, clientY: 450 });
  }
  assert.deepEqual(m.log, [], 'dois toques de DOIS dedos aproximaram como um duplo toque');
  // O `pointercancel` (o navegador tomou o gesto) não é toque.
  const k = mapaComGestos();
  for (let i = 0; i < 2; i++) {
    k.lb.h.pointerdown({ target: alvo, pointerId: 3, clientX: 200, clientY: 450, preventDefault() {} });
    k.win.pointercancel({ type: 'pointercancel', pointerId: 3, clientX: 200, clientY: 450 });
  }
  assert.deepEqual(k.log, [], 'dois gestos CANCELADOS pelo navegador aproximaram');
  // CONTROLE: depois da pinça, o duplo toque de um dedo segue valendo.
  m.toque(200, 450, 0, { semClick: true }); m.toque(200, 450, 0, { semClick: true });
  assert.deepEqual(m.log, ['zoom1'], 'CONTROLE: depois dos dois dedos, o duplo toque de um dedo deixou de aproximar');
});

test('L20 o toque no LINK do Street View passa sem o `preventDefault` do mapa — no iPhone ele abre', () => {
  const m = mapaComGestos();
  let impediu = 0;
  // `closest` de verdade pro seletor que o app usar: casa se a lista tem `a`.
  const link = { closest: (sel) => (String(sel).split(',').map((s) => s.trim()).includes('a') ? link : null) };
  m.lb.h.pointerdown({ target: link, pointerId: 7, clientX: 380, clientY: 800, preventDefault() { impediu++; } });
  assert.equal(impediu, 0, 'o pointerdown no Street View chamou preventDefault: no WebKit o toque no link não abre nada');
  // CONTROLE: no mapa mesmo ele impede (é o que segura o arraste da imagem do tile).
  const alvo = { closest: () => null };
  m.lb.h.pointerdown({ target: alvo, pointerId: 8, clientX: 200, clientY: 400, preventDefault() { impediu++; } });
  assert.equal(impediu, 1, 'CONTROLE: o toque no MAPA deixou de ter o preventDefault');
});

// ── L33: o passo do TECLADO na foto é o de um dente da roda, no centro ──────
test('L33 + e − na foto: 1,2× por tecla, no CENTRO da camada, e o − não passa de 1×', () => {
  const lb = lightbox();
  const ini = APP.indexOf('    zoomPeloTeclado(sentido) {');
  assert.ok(ini > 0, 'Lightbox.zoomPeloTeclado sumiu');
  let prof = 0, fim = -1;
  for (let j = APP.indexOf('{', ini); j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}' && --prof === 0) { fim = j + 1; break; }
  }
  // A camada (o `#imageLightbox`) centrada em (200, 400): o mesmo centro da foto do `lightbox()`.
  const camada = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }) };
  lb.zoomPeloTeclado = new Function('document', 'return function ' + APP.slice(ini, fim).trim())(
    { getElementById: (id) => (id === 'imageLightbox' ? camada : null) });
  lb.zoomTo(2, 260, 430);                          // já ampliada e deslocada: o centro tem que ficar parado
  const u = lb.naFoto({ x: 200, y: 400 });
  lb.zoomPeloTeclado(1);
  assert.ok(Math.abs(lb.scale - 2.4) < 1e-9, `o + deu ${lb.scale / 2}× (um dente da roda é 1,2×)`);
  const p = lb.naTela(u);
  assert.ok(Math.abs(p.x - 200) < 1e-6 && Math.abs(p.y - 400) < 1e-6, 'o + tirou do lugar o que estava no centro da tela');
  for (let i = 0; i < 10; i++) lb.zoomPeloTeclado(-1);
  assert.deepEqual([lb.scale, lb.tx, lb.ty], [1, 0, 0], 'o − passou de 1× ou não recentrou a foto');
});

// ── R6-3-05: a roda que vai e volta na MESMA medida para em 1× EXATO ─────────
// (auditoria de 2026-10-01). A foto aproxima e afasta por PRODUTO de fatores
// (1,2^(Δ/100), o `wheel` do `setupLightbox`), e ir e voltar não dá 1 exato:
// MEDIDO, dois dentes de 53 px (o do Chrome no Linux) pra dentro e dois pra fora
// paravam em 1,0000000000000002. A tela parecia 1×, mas as setas ANDAVAM a foto
// em vez de trocá-la e o ↓ não fechava — as duas perguntam `> 1` —, e o arraste
// de toque, que pergunta `=== 1`, nem trocava nem fechava. O `zoomTo` de verdade.
test('R6-3-05 ir e voltar na mesma medida (roda, trackpad) volta a 1× EXATO, recentrada', () => {
  for (const [dente, n] of [[53, 2], [53, 3], [7, 1], [4, 20], [125, 2], [33, 3]]) {
    // CONTROLE do instrumento: a conta crua, sem o `zoomTo`, NÃO dá 1 exato
    // nesses casos (senão o teste passaria com o defeito).
    let cru = 1;
    for (let i = 0; i < n; i++) cru *= Math.pow(1.2, dente / 100);
    for (let i = 0; i < n; i++) cru *= Math.pow(1.2, -dente / 100);
    if (dente !== 4) assert.notEqual(cru, 1, `CONTROLE: ${n}×${dente} px voltaria a 1 exato sozinho — o caso não mede nada`);
    const lb = lightbox();
    for (let i = 0; i < n; i++) lb.zoomTo(lb.scale * Math.pow(1.2, dente / 100), 250, 420);
    for (let i = 0; i < n; i++) lb.zoomTo(lb.scale * Math.pow(1.2, -dente / 100), 250, 420);
    assert.equal(lb.scale, 1, `${n} dentes de ${dente} px pra dentro e pra fora pararam em ${lb.scale}: as setas andam em vez de trocar de foto`);
    assert.deepEqual([lb.tx, lb.ty], [0, 0], 'a foto voltou a 1× fora do centro');
  }
  // CONTROLE: um zoom DE VERDADE (um dente, 1,2×) fica — a folga não engole zoom.
  const z = lightbox();
  z.zoomTo(1.2, 250, 420);
  assert.equal(z.scale, 1.2);
  z.zoomTo(1.01, 250, 420);
  assert.equal(z.scale, 1.01, 'a folga engoliu um zoom de 1% (10 px numa foto de 1000)');
});

// ── R7-3-03: a partir de 1×, a roda FINA e a pinça LENTA do trackpad ampliam ──
// (auditoria de 2026-10-02). O R6-3-05 punha a escala em 1 sempre que ela ficava
// abaixo de 1,001 — inclusive APROXIMANDO a partir de 1×. Cada evento da roda e
// da pinça de trackpad é aplicado sobre a escala de agora (1,2^(−Δ/100)), então
// todo evento abaixo de ~0,55 px caía de volta em 1 e o gesto nunca começava a
// ampliar. MEDIDO no Chromium: 40 eventos de −0,4 px deixavam a escala em 1, e
// a pinça de trackpad que ele mesmo sintetiza (CDP, ×1,5) a 20, 35 e 50 px/s
// manda 301, 172 e 121 eventos que somam −40,55 px — escala parada em 1 (a
// 70 px/s, com eventos maiores, ela ampliava). Voltar a 1 é só AFASTANDO.
test('R7-3-03 a partir de 1×, a roda fina e a pinça lenta do trackpad ampliam; afastando na mesma medida, volta a 1× EXATO', () => {
  for (const [n, soma] of [[40, -16], [301, -40.55], [172, -40.55], [121, -40.55]]) {
    const dy = soma / n;
    const fator = Math.pow(1.2, -dy / 100);
    // CONTROLE do instrumento: cada evento SOZINHO fica abaixo do limiar de
    // 0,1% (senão o caso mediria o evento grande, que sempre ampliou).
    assert.ok(fator < 1.001, `CONTROLE: o evento de ${dy.toFixed(3)} px já passava do limiar sozinho`);
    const lb = lightbox();
    for (let i = 0; i < n; i++) lb.zoomTo(lb.scale * fator, 250, 420);
    const esperado = Math.pow(1.2, -soma / 100);
    assert.ok(Math.abs(lb.scale - esperado) < 1e-9,
      `DEFEITO: ${n} eventos de ${dy.toFixed(3)} px deixaram a escala em ${lb.scale} (a soma pede ${esperado.toFixed(4)})`);
    // O R6-3-05 segue: afastando na mesma medida, a escala volta a 1× EXATO, recentrada.
    for (let i = 0; i < n; i++) lb.zoomTo(lb.scale / fator, 250, 420);
    assert.equal(lb.scale, 1, `${n} eventos pra dentro e ${n} pra fora pararam em ${lb.scale}: as setas andariam a foto`);
    assert.deepEqual([lb.tx, lb.ty], [0, 0], 'a foto voltou a 1× fora do centro');
  }
  // CONTROLE: afastando a partir de um zoom pequeno (1,0005), abaixo de 0,1% é 1×.
  const p = lightbox();
  p.zoomTo(1.0005, 250, 420);
  assert.ok(p.scale > 1, 'CONTROLE: aproximar 0,05% a partir de 1× não ampliou');
  p.zoomTo(1.0003, 250, 420);
  assert.equal(p.scale, 1, 'CONTROLE: afastando pra baixo de 0,1% a escala não voltou a 1× (o R6-3-05)');
});
