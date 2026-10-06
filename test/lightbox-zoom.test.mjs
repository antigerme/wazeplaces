// O zoom da foto ampliada (pinça, roda, duplo toque) tem uma invariante: o ponto
// da foto que está sob o dedo CONTINUA sob o dedo. A fórmula antiga só a cumpria
// com a foto centrada (t = 0); depois do primeiro zoom ela escorregava t·(r − 1)
// a cada passo (auditoria de 2026-09-25). `Lightbox.zoomTo` EXECUTADO, com um
// retângulo que inclui a transformação, como o do navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

// Um MÉTODO do `Lightbox` de verdade (`nome(...) { … }` dentro do objeto), como
// texto — o `this` é quem o chamar.
function metodoDoLightbox(nome) {
  const obj = APP.indexOf('const Lightbox = {');
  assert.ok(obj > 0, 'o objeto Lightbox sumiu');
  const ini = APP.indexOf('\n    ' + nome + '(', obj) + 1;
  assert.ok(ini > obj, `Lightbox.${nome} sumiu`);
  let prof = 0, fim = -1;
  for (let j = APP.indexOf('{', APP.indexOf(')', ini)); j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  return APP.slice(ini, fim).trim();
}

// Uma constante NUMÉRICA de topo do app.js, como ele a declara.
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = (\\d+);', 'm').exec(APP);
  assert.ok(m, `${nome} sumiu`);
  return Number(m[1]);
}

// `W`×`H`: a caixa da <img> SEM a transformação (o `offsetWidth`/`offsetHeight`
// que a régua de "ampliada" lê, R9-3-01). Por padrão a foto de 1000 px de que
// os testes de cá falam ("10 px numa foto de 1000").
function lightbox({ W = 1000, H = 600 } = {}) {
  const ini = APP.indexOf('    zoomTo(scale, cx, cy) {');
  assert.ok(ini > 0, 'zoomTo sumiu');
  let prof = 0, fim = -1;
  for (let j = APP.indexOf('{', ini); j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const zoomTo = APP.slice(ini, fim).trim();
  // Layout da foto: centro (200, 400), W×H. O retângulo VISUAL inclui o
  // translate e o scale (origem no centro), como o getBoundingClientRect.
  const C = { x: 200, y: 400 };
  const lb = { scale: 1, tx: 0, ty: 0, _applyTransform() {} };
  const img = { offsetWidth: W, offsetHeight: H,
    getBoundingClientRect: () => ({ left: C.x + lb.tx - (W * lb.scale) / 2, top: C.y + lb.ty - (H * lb.scale) / 2,
      width: W * lb.scale, height: H * lb.scale }) };
  const document = { getElementById: () => img };
  lb.zoomTo = new Function('document', 'return function ' + zoomTo.replace(/^zoomTo/, 'zoomTo'))(document);
  // A régua de "ampliada de verdade" (R8-3-01), que o `zoomTo` também usa pra
  // decidir quando o afastar volta a 1×, e o `panBy`, que só anda ampliada.
  for (const nome of ['ampliada', 'panBy', 'resetZoom']) {
    lb[nome] = new Function('document', 'ZOOM_VISIVEL_PX', 'return function ' + metodoDoLightbox(nome))(
      document, constante('ZOOM_VISIVEL_PX'));
  }
  lb.img = img;
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

// ── R8-3-01: um fio de zoom pra DENTRO é 1× pra quem LÊ a escala ─────────────
// (auditoria de 2026-10-03). O R7-3-03 deixou a roda fina e a pinça lenta do
// trackpad ampliarem a partir de 1× — certo —, e um evento de −0,4 px para a
// escala em 1,00073: invisível (a foto de 800 px fica com 801). Quem LIA a
// escala perguntava `=== 1` ou `> 1`, e a tratava como ampliada: MEDIDO no
// Chromium, a → ANDAVA a foto 80 px em vez de trocá-la, e o ↓ a andava em vez
// de fechar (o R6-3-05 de volta, por outra porta). Os consumidores perguntam a
// régua ÚNICA, `Lightbox.ampliada()`, que o `zoomTo` também usa.
const UM_FIO = Math.pow(1.2, 0.4 / 100);   // um evento de roda de −0,4 px a partir de 1×

test('R8-3-01 um fio de zoom pra DENTRO amplia (o R7-3-03), mas é 1× pra quem lê: `ampliada` diz não e o `panBy` não anda', () => {
  const lb = lightbox();
  lb.zoomTo(lb.scale * UM_FIO, 250, 420);
  assert.ok(lb.scale > 1 && lb.scale < 1.001, `PRÉ-CONDIÇÃO: um evento de −0,4 px deu ${lb.scale} (o R7-3-03 guarda o passo, invisível)`);
  assert.equal(lb.ampliada(), false,
    `DEFEITO: a escala ${lb.scale.toFixed(5)} (invisível) conta como ampliada — as setas andam a foto e o ↓ não fecha`);
  const t0 = [lb.tx, lb.ty];
  lb.panBy(-80, 0);
  assert.deepEqual([lb.tx, lb.ty], t0, 'DEFEITO: o panBy andou a foto num zoom invisível');
  // CONTROLE: a roda fina SEGUE ampliando (o R7-3-03) e, passada a régua, conta como ampliada.
  for (let i = 0; i < 39; i++) lb.zoomTo(lb.scale * UM_FIO, 250, 420);
  assert.ok(lb.ampliada(), `CONTROLE: 40 eventos de −0,4 px (escala ${lb.scale.toFixed(4)}) não contam como ampliada`);
  const t1 = lb.tx;
  lb.panBy(-80, 0);
  assert.equal(lb.tx, t1 - 80, 'CONTROLE: ampliada de verdade, o panBy deixou de andar');
});

test('R8-3-01 o afastar usa a MESMA régua: nenhum zoom que ENCOLHE para entre o 1× exato e o "ampliada"', () => {
  for (const alvo of [1.0002, 1.0009, 1.001, 1.0010001, 1.0011, 1.002]) {
    const lb = lightbox();
    lb.zoomTo(1.5, 250, 420);
    lb.zoomTo(alvo, 250, 420);
    assert.ok(lb.scale === 1 || lb.ampliada(),
      `afastar até ${alvo} deixou a escala em ${lb.scale}: nem 1× exato nem ampliada — as setas e o arraste não sabem o que ela é`);
  }
});

// Os GESTOS da foto: o `setupLightbox` de VERDADE, com a camada e a <img> de
// mentira que guardam os ouvintes, o relógio parado e o zoom de verdade.
// `tamanho`: a caixa da foto na tela (ver `lightbox`).
function gestosDaFoto(escala, tamanho) {
  const L = lightbox(tamanho);
  L.zoomTo(escala, 250, 420);
  const log = [];
  L.next = () => log.push('next');
  L.prev = () => log.push('prev');
  const no = () => ({ h: {}, addEventListener(tipo, fn) { this.h[tipo] = fn; }, setPointerCapture() {} });
  const els = { imageLightbox: no(), lightboxImage: no(), lightboxClose: no(), lightboxPrev: no(), lightboxNext: no() };
  let T = 1000;
  const constantes = ['DUPLO_TOQUE_MS', 'DUPLO_TOQUE_RAIO_PX'].map((c) => {
    const m = new RegExp('^const ' + c + ' = (\\d+);', 'm').exec(APP);
    assert.ok(m, `${c} sumiu`);
    return `const ${c} = ${m[1]};`;
  }).join('\n');
  const deps = {
    document: { getElementById: (id) => els[id] || null }, Lightbox: L, performance: { now: () => T },
    recuarNaFoto: () => log.push('recuou'), atualizarAcoesDeFoto: () => {}, avisarTravaAoTocar: () => {},
    deltaDaRoda: () => 0, RODA_DENTE_PX: 100,
  };
  new Function(...Object.keys(deps), constantes + '\n' + fatiarFuncao('setupLightbox') + '\nsetupLightbox();')(...Object.values(deps));
  const img = els.lightboxImage;
  const ev = (x, y) => ({ pointerId: 1, clientX: x, clientY: y, preventDefault() {} });
  const arrastar = ([x0, y0], [x1, y1]) => {
    img.h.pointerdown(ev(x0, y0));
    img.h.pointermove(ev((x0 + x1) / 2, (y0 + y1) / 2));
    img.h.pointermove(ev(x1, y1));
    img.h.pointerup(ev(x1, y1));
    T += 400;
  };
  const toqueDuplo = (x, y) => {
    img.h.pointerdown(ev(x, y)); img.h.pointerup(ev(x, y));
    T += 120;
    img.h.pointerdown(ev(x, y)); img.h.pointerup(ev(x, y));
    T += 400;
  };
  return { L, log, arrastar, toqueDuplo };
}

test('R8-3-01 os GESTOS num fio de zoom invisível: o arraste troca de foto e fecha, e o duplo toque AMPLIA — ampliada de verdade, o arraste anda', () => {
  const g = gestosDaFoto(UM_FIO);
  assert.ok(g.L.scale > 1 && !g.L.ampliada(), `PRÉ-CONDIÇÃO: a escala ${g.L.scale} não é o fio invisível`);
  const tx0 = g.L.tx;
  g.arrastar([300, 400], [200, 400]);               // pro lado: −100 px
  assert.deepEqual(g.log, ['next'], 'DEFEITO: num fio de zoom invisível o arraste pro lado não trocou de foto');
  assert.ok(Math.abs(g.L.tx - tx0) < 1e-9, `DEFEITO: o arraste ANDOU a foto ${(g.L.tx - tx0).toFixed(1)} px num zoom invisível`);
  g.arrastar([300, 300], [300, 420]);               // pra baixo: +120 px
  assert.deepEqual(g.log, ['next', 'recuou'], 'DEFEITO: num fio de zoom invisível o arraste pra baixo não fechou');
  g.toqueDuplo(260, 380);
  assert.equal(g.L.scale, 2.5, `DEFEITO: o duplo toque num fio de zoom invisível deixou a escala em ${g.L.scale} (só "voltou" a 1×)`);
  // CONTROLE: ampliada de verdade, o arraste ANDA (não troca nem fecha) e o duplo toque volta a 1×.
  const c = gestosDaFoto(1.44);
  const cx0 = c.L.tx;
  c.arrastar([300, 400], [200, 400]);
  assert.deepEqual(c.log, [], 'CONTROLE: ampliada, o arraste trocou de foto');
  assert.ok(Math.abs(c.L.tx - (cx0 - 100)) < 1e-9, 'CONTROLE: ampliada, o arraste não andou a foto');
  c.toqueDuplo(260, 380);
  assert.equal(c.L.scale, 1, 'CONTROLE: ampliada, o duplo toque não voltou a 1×');
});

// ── R9-3-01: a régua é em PIXELS NA TELA, não em fração da escala ─────────────
// (auditoria de 2026-10-06). Os 0,1% do R8-3-01 cobriam só o PRIMEIRO evento da
// roda fina: UM evento de roda de −1 px (o menor que o WebKit entrega) dava
// 1,00182 — a foto de 800 px com 801,5 na tela —, 12 eventos de −0,4 px davam
// 1,00879 (+7 px) e a pinça de toque com 0,5 px de tremor (dedos a 200 px),
// 1,0025 (412 → 413 px). Invisível, e a → ANDAVA a foto, o ↓ não fechava, o
// arraste não trocava e o duplo toque não ampliava (MEDIDO nos dois motores,
// r32 e r32b da auditoria). Menos de `ZOOM_VISIVEL_PX` a mais no MAIOR lado da
// foto é 1×; o tamanho é o da caixa da <img> sem a transformação.
const RODA = (px) => Math.pow(1.2, px / 100);   // o fator de UM evento de roda de −px, a partir de 1×
const FAIXA = [
  ['um evento de roda de −1 px (o menor do WebKit)', { W: 800, H: 600 }, [RODA(1)]],
  ['12 eventos de roda de −0,4 px', { W: 800, H: 600 }, Array(12).fill(RODA(0.4))],
  ['a pinça com 0,5 px de tremor (dedos a 200 px)', { W: 412, H: 309 }, [200.5 / 200]],
  ['a pinça com 2 px (dedos a 200 px)', { W: 412, H: 309 }, [202 / 200]],
];

test('R9-3-01 o zoom que não se VÊ é 1×: um evento de roda de −1 px, 12 de −0,4 px e a pinça com tremor — a régua é em pixels da foto', () => {
  for (const [nome, tam, fatores] of FAIXA) {
    const lb = lightbox(tam);
    for (const f of fatores) lb.zoomTo(lb.scale * f, 250, 420);
    const aMais = (lb.scale - 1) * Math.max(tam.W, tam.H);
    // O caso passa da régua de ANTES (0,1%): sem isso ele não distingue nada.
    assert.ok(lb.scale > 1.001, `PRÉ-CONDIÇÃO (${nome}): a escala ${lb.scale} não passa dos 0,1% — o caso não mede nada`);
    assert.equal(lb.ampliada(), false,
      `DEFEITO (${nome}): a escala ${lb.scale.toFixed(5)}, ${aMais.toFixed(1)} px a mais numa foto de ${tam.W}, conta como ampliada — as setas andam a foto e o ↓ não fecha`);
    const t0 = [lb.tx, lb.ty];
    lb.panBy(-80, 0);
    assert.deepEqual([lb.tx, lb.ty], t0, `DEFEITO (${nome}): o panBy andou a foto num zoom que não se vê`);
  }
});

test('R9-3-01 CONTROLES: o zoom que se vê é ampliada, a régua é da FOTO (o maior lado), afastar abaixo dela volta a 1× exato, e sem foto vale a fração de antes', () => {
  const limiar = constante('ZOOM_VISIVEL_PX');
  // A roda fina SEGUE ampliando a partir de 1× (o R7-3-03) e, passada a régua, conta como ampliada.
  const fina = lightbox({ W: 800, H: 600 });
  for (let i = 0; i < 40; i++) fina.zoomTo(fina.scale * RODA(0.4), 250, 420);
  assert.ok(fina.ampliada(), `40 eventos de −0,4 px (+${((fina.scale - 1) * 800).toFixed(1)} px numa foto de 800) não contam como ampliada`);
  // O MESMO 1,01 é 1× numa foto de 412 (4 px a mais) e ampliada numa de 1000 (10 px).
  const pequena = lightbox({ W: 412, H: 309 });
  pequena.zoomTo(1.01, 250, 420);
  const grande = lightbox({ W: 1000, H: 600 });
  grande.zoomTo(1.01, 250, 420);
  assert.deepEqual([pequena.ampliada(), grande.ampliada()], [false, true], 'a régua não olha o tamanho da foto na tela');
  // O MAIOR lado: a foto em pé (9:16) se vê pela altura.
  const emPe = lightbox({ W: 300, H: 533 });
  emPe.zoomTo(1.02, 250, 420);
  assert.equal(emPe.ampliada(), true, 'a foto em pé com 10,7 px a mais na ALTURA não conta como ampliada (a régua olhou só a largura)');
  // Afastar até abaixo da régua volta a 1× EXATO, recentrada (o R6-3-05 com a régua nova); acima dela, fica.
  for (const alvo of [1 + (limiar - 0.1) / 800, 1.005, 1.0002]) {
    const lb = lightbox({ W: 800, H: 600 });
    lb.zoomTo(1.5, 250, 420);
    lb.zoomTo(alvo, 250, 420);
    assert.deepEqual([lb.scale, lb.tx, lb.ty], [1, 0, 0], `afastar até ${alvo} (abaixo da régua) parou em ${lb.scale}, não em 1× exato`);
  }
  const fica = lightbox({ W: 800, H: 600 });
  fica.zoomTo(1.5, 250, 420);
  fica.zoomTo(1 + (limiar + 0.5) / 800, 250, 420);
  assert.ok(fica.scale > 1 && fica.ampliada(), `afastar até ${(limiar + 0.5)} px a mais (acima da régua) foi parar em ${fica.scale}`);
  // Sem foto na tela (carregando, quebrada: a caixa é 0): a fração de antes, 0,1%.
  const semFoto = lightbox({ W: 0, H: 0 });
  semFoto.zoomTo(1.0005, 250, 420);
  assert.equal(semFoto.ampliada(), false, 'sem foto na tela, 0,05% contou como ampliada');
  semFoto.zoomTo(1.2, 250, 420);
  assert.equal(semFoto.ampliada(), true, 'sem foto na tela, o + do teclado (1,2×) não contou como ampliada');
});

test('R9-3-01 os GESTOS na faixa logo acima dos 0,1%: o arraste troca e fecha, e o duplo toque AMPLIA — a 3%, ampliada de verdade, o arraste anda', () => {
  for (const [nome, tam, fatores] of FAIXA) {
    const escala = fatores.reduce((s, f) => s * f, 1);
    const g = gestosDaFoto(escala, tam);
    assert.ok(g.L.scale > 1.001, `PRÉ-CONDIÇÃO (${nome}): a escala ${g.L.scale} não passa dos 0,1%`);
    const tx0 = g.L.tx;
    g.arrastar([300, 400], [200, 400]);             // pro lado: −100 px
    assert.deepEqual(g.log, ['next'], `DEFEITO (${nome}): o arraste pro lado não trocou de foto`);
    assert.ok(Math.abs(g.L.tx - tx0) < 1e-9, `DEFEITO (${nome}): o arraste ANDOU a foto ${(g.L.tx - tx0).toFixed(1)} px`);
    g.arrastar([300, 300], [300, 420]);             // pra baixo: +120 px
    assert.deepEqual(g.log, ['next', 'recuou'], `DEFEITO (${nome}): o arraste pra baixo não fechou`);
    g.toqueDuplo(260, 380);
    assert.equal(g.L.scale, 2.5, `DEFEITO (${nome}): o duplo toque deixou a escala em ${g.L.scale} (só "voltou" a 1×)`);
  }
  // CONTROLE: 1,03 numa foto de 800 (24 px a mais) é ampliada: o arraste anda, não troca, e o duplo toque volta a 1×.
  const c = gestosDaFoto(1.03, { W: 800, H: 600 });
  const cx0 = c.L.tx;
  c.arrastar([300, 400], [200, 400]);
  assert.deepEqual(c.log, [], 'CONTROLE: ampliada de verdade, o arraste trocou de foto');
  assert.ok(Math.abs(c.L.tx - (cx0 - 100)) < 1e-9, 'CONTROLE: ampliada de verdade, o arraste não andou a foto');
  c.toqueDuplo(260, 380);
  assert.equal(c.L.scale, 1, 'CONTROLE: ampliada de verdade, o duplo toque não voltou a 1×');
});

// E ninguém volta a perguntar à escala por conta própria: a régua é UMA. O
// guard lê só CÓDIGO (gotcha #67) e se amarra a quem consome a escala — as
// setas (`handleKeyDown`), os gestos (`setupLightbox`) e o `panBy`.
test('R8-3-01 quem lê a escala pergunta `ampliada()`, nunca `=== 1`/`> 1` por conta própria', () => {
  const semComentario = (txt) => txt.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const consumidores = { handleKeyDown: fatiarFuncao('handleKeyDown'), setupLightbox: fatiarFuncao('setupLightbox'),
    panBy: metodoDoLightbox('panBy') };
  for (const [nome, corpo] of Object.entries(consumidores)) {
    const codigo = semComentario(corpo);
    assert.doesNotMatch(codigo, /\b(?:Lightbox|this)\.scale\s*(?:===|!==|==|>=|<=|>|<)\s*1(?![.\d])/,
      `${nome} voltou a comparar a escala com 1 por conta própria: um fio de zoom invisível vira "ampliada"`);
    assert.match(codigo, /\.ampliada\(\)/, `${nome} deixou de perguntar a régua única (\`ampliada\`)`);
  }
  assert.match(semComentario(fatiarFuncao('handleKeyDown')), /Lightbox\.ampliada\(\) && Object\.prototype\.hasOwnProperty\.call\(SETAS_QUE_ANDAM, e\.key\)/,
    'as setas da foto deixaram de perguntar a régua única');
});
