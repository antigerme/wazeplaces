// O FAB do modo dev, EXECUTADO com ponteiros de mentira (auditoria de
// 2026-09-25). Quatro defeitos, cada um visto reprovando com o conserto desfeito:
//   · toque DEVAGAR (segurou e soltou sem andar) fixava o botão pra sempre, e o
//     app nunca mais o tirava de cima do que viesse a cobrir;
//   · OUTRO dedo na tela movia o FAB, e o soltar dele encerrava o gesto;
//   · Enter/Espaço (teclado, leitor de tela) não capturavam nada;
//   · a posição gravada em retrato voltava FORA da tela em paisagem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
function fatiar(nome) {
  const m = new RegExp('^function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, nome + ' sumiu');
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', APP_SEM.indexOf(')', m.index)); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) return APP_SEM.slice(m.index, j + 1); }
  }
  throw new Error('não fechou');
}
const PEGAR_MS = Number(/^const DEV_FAB_PEGAR_MS = (\d+);/m.exec(APP_SEM)[1]);

function montar({ guardado = null, largura = 390, altura = 844 } = {}) {
  const ouvintesBtn = {}, ouvintesJanela = {};
  const classes = new Set();
  const fab = { style: {}, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    getBoundingClientRect: () => ({ left: 300, top: 700, width: 44, height: 44 }) };
  const btn = { addEventListener: (t, fn) => { (ouvintesBtn[t] ||= []).push(fn); }, animate() {} };
  let relogios = [];
  const sessao = new Map(guardado ? [['__devFabPos', guardado]] : []);
  const capturas = [];
  const deps = {
    document: { getElementById: (id) => (id === 'devFabBtn' ? btn : id === 'devFab' ? fab : null) },
    MODAL_IDS: [], MutationObserver: class { observe() {} },
    addEventListener: (t, fn) => { (ouvintesJanela[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { ouvintesJanela[t] = (ouvintesJanela[t] || []).filter((f) => f !== fn); },
    requestAnimationFrame: (fn) => { fn(); return 0; }, cancelAnimationFrame() {},
    setTimeout: (fn, ms) => { relogios.push(fn); return relogios.length; }, clearTimeout: (i) => { relogios[i - 1] = null; },
    sessionStorage: { getItem: (k) => sessao.get(k) ?? null, setItem: (k, v) => sessao.set(k, v) },
    navigator: {}, innerWidth: largura, innerHeight: altura, DEV_FAB_PEGAR_MS: PEGAR_MS,
    dlogCapturar: (motivo) => { capturas.push(motivo); return {}; }, atualizarFabDev() {}, posicionarFabDev() {},
  };
  const chaves = Object.keys(deps);
  const api = new Function(...chaves, 'let devFabFixado = false;\n' + fatiar('ligarFabDev')
    + '\nligarFabDev();\nreturn { fixado: () => devFabFixado };')(...chaves.map((k) => deps[k]));
  const disparar = (alvo, t, ev) => { for (const fn of [...(alvo[t] || [])]) fn({ preventDefault() {}, cancelable: true, ...ev }); };
  const ponteiro = (t, id, x, y, sobreOBotao = false) => {
    if (sobreOBotao) disparar(ouvintesBtn, t, { pointerId: id, clientX: x, clientY: y });
    if (t !== 'pointerdown') disparar(ouvintesJanela, t, { pointerId: id, clientX: x, clientY: y });
  };
  const passarOTempo = () => { const r = relogios; relogios = []; for (const fn of r) if (fn) fn(); };
  return { api, fab, ponteiro, passarOTempo, capturas, sessao, clique: (detail) => disparar(ouvintesBtn, 'click', { detail }) };
}

test('FAB: toque DEVAGAR (segura e solta sem andar) é toque — captura e NÃO fixa o botão', () => {
  const m = montar();
  m.ponteiro('pointerdown', 1, 310, 710, true);
  m.passarOTempo();                              // segurou além do tempo de pegar
  m.ponteiro('pointerup', 1, 310, 710, true);
  assert.deepEqual(m.capturas, ['manual'], 'o toque devagar não capturou');
  assert.equal(m.api.fixado(), false, 'segurar sem andar fixou o botão: o app nunca mais o reposiciona');
  // CONTROLE: arrastar fixa, e a posição é gravada.
  m.ponteiro('pointerdown', 2, 310, 710, true);
  m.ponteiro('pointermove', 2, 250, 600);
  m.ponteiro('pointerup', 2, 250, 600, true);
  assert.equal(m.api.fixado(), true, 'CONTROLE: arrastar deixou de fixar');
  assert.ok(m.sessao.get('__devFabPos'), 'o arraste não gravou a posição');
  assert.deepEqual(m.capturas, ['manual'], 'arrastar não é tocar');
});

test('FAB: OUTRO dedo na tela não move o botão nem encerra o gesto de quem o pegou', () => {
  const m = montar();
  m.ponteiro('pointerdown', 1, 310, 710, true);
  m.ponteiro('pointermove', 7, 40, 100);         // o polegar da outra mão, no card
  assert.equal(m.fab.style.left, undefined, 'o outro dedo moveu o FAB');
  m.ponteiro('pointerup', 7, 40, 100);           // e soltou
  m.ponteiro('pointermove', 1, 250, 600);        // quem pegou continua arrastando
  assert.equal(m.fab.style.left, (250 - 10) + 'px', 'o soltar do outro dedo encerrou o gesto');
  m.ponteiro('pointerup', 1, 250, 600, true);
});

test('FAB: Enter/Espaço (clique sem ponteiro) captura; o clique do dedo não captura de novo', () => {
  const m = montar();
  m.clique(0);
  assert.deepEqual(m.capturas, ['manual'], 'o teclado não capturou nada');
  m.ponteiro('pointerdown', 1, 310, 710, true);
  m.ponteiro('pointerup', 1, 310, 710, true);
  m.clique(1);                                   // o click que segue o toque
  assert.equal(m.capturas.length, 2, 'o toque capturou duas vezes (pointerup + click)');
});

test('FAB: posição gravada fora da tela (outra orientação) volta DENTRO dela', () => {
  const m = montar({ guardado: '760px|380px', largura: 390, altura: 844 });
  assert.ok(parseFloat(m.fab.style.left) <= 390 - 44, `left ${m.fab.style.left} fora da tela`);
  assert.equal(m.api.fixado(), true);
  const lixo = montar({ guardado: 'abc|def' });
  assert.equal(lixo.fab.style.left, undefined, 'posição ilegível foi aplicada');
  assert.equal(lixo.api.fixado(), false);
});
