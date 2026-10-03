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
  const api = new Function(...chaves, 'let devFabFixado = false, devFabDedo = null;\n' + fatiar('ligarFabDev')
    + '\nligarFabDev();\nreturn { fixado: () => devFabFixado, dedo: () => devFabDedo };')(...chaves.map((k) => deps[k]));
  const disparar = (alvo, t, ev) => { for (const fn of [...(alvo[t] || [])]) fn({ preventDefault() {}, cancelable: true, ...ev }); };
  const ponteiro = (t, id, x, y, sobreOBotao = false) => {
    if (sobreOBotao) disparar(ouvintesBtn, t, { pointerId: id, clientX: x, clientY: y });
    if (t !== 'pointerdown') disparar(ouvintesJanela, t, { pointerId: id, clientX: x, clientY: y });
  };
  const passarOTempo = () => { const r = relogios; relogios = []; for (const fn of r) if (fn) fn(); };
  return { api, fab, classes, ponteiro, passarOTempo, capturas, sessao, clique: (detail) => disparar(ouvintesBtn, 'click', { detail }) };
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

// D7 (auditoria de 2026-09-26): DOIS dedos no botão, soltos antes de "pegar". O
// segundo `pointerdown` sobrescrevia o relógio do primeiro sem cancelá-lo; os
// dois dedos saíam, e o relógio ÓRFÃO "pegava" o botão sem dedo nenhum — ele
// ficava em `fab-pego` pra sempre (e o `posicionarFabDev` parava de movê-lo).
test('FAB: dois dedos soltos antes de pegar não deixam o botão "pego" sem dedo', () => {
  const m = montar();
  m.ponteiro('pointerdown', 1, 310, 710, true);
  m.ponteiro('pointerdown', 2, 316, 716, true);   // o segundo dedo, antes do tempo de pegar
  m.ponteiro('pointerup', 1, 310, 710, true);     // solta o primeiro…
  m.ponteiro('pointerup', 2, 316, 716, true);     // …e o segundo
  m.passarOTempo();                                // o relógio que sobrou, se sobrou, dispara aqui
  assert.ok(!m.classes.has('fab-pego'), 'o relógio órfão pegou o botão sem dedo nenhum');
  assert.equal(m.api.dedo(), null, 'soltos os dois, ainda há um dedo registrado no botão');
  // CONTROLE: UM dedo segurado além do tempo ainda pega.
  m.ponteiro('pointerdown', 3, 310, 710, true);
  m.passarOTempo();
  assert.ok(m.classes.has('fab-pego'), 'CONTROLE: segurar um dedo deixou de pegar');
  m.ponteiro('pointerup', 3, 310, 710, true);
  assert.ok(!m.classes.has('fab-pego'), 'soltar não soltou o botão');
});

test('FAB: o "pego" que sobrar SEM dedo não trava o botão — a reavaliação o solta, e o apagar também', () => {
  const pos = fatiar('posicionarFabDev');
  assert.match(pos, /if \(fab\.classList\.contains\('fab-pego'\)\) \{\s*if \(devFabDedo !== null\) return;\s*fab\.classList\.remove\('fab-pego'\);\s*\}/,
    'o posicionarFabDev voltou a respeitar o "pego" sem olhar se há dedo');
  assert.match(fatiar('dlogApagar'), /classList\.remove\('fab-pego'\)/, 'desligar o modo dev não solta o botão pego');
});

// ── R7-4-01: o banner do topo (e o rodapé de avisos) não decide o canto ──────
// O FAB mede o canto pelo que recebe o dedo ali. Com um banner do topo na tela
// (o aviso da consequência, a recusa automática), o `cima-dir` lia o banner —
// sem nada acionável nem `.nao-cobrir` — e passava por LIVRE: tocado nesse
// meio, o FAB ia pra cima do "Restam" e FICAVA lá depois de o banner sair, com
// "310" lido como "31" (MEDIDO no navegador: 21% da tinta a 390×844, 30% no SE).
// Aqui o `posicionarFabDev` RODA sobre uma tela de mentira em camadas, com o
// hit-test de verdade dela (`elementsFromPoint`, de cima pra baixo).
const constanteDoApp = (nome, ctx = {}) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function(...Object.keys(ctx), 'return (' + m[1] + ');')(...Object.values(ctx));
};
function telaDoFab({ banner = false, desfazer = false, modal = false } = {}) {
  const LARGURA = 390, ALTURA = 844;
  // Um nó: id, tag, classes, pai e a caixa. O `closest` casa seletor simples
  // (tag, #id, .classe) — o que os nós desta tela precisam; atributo não casa.
  const no = (o) => ({ classes: [], pai: null, ...o, closest(sel) {
    const simples = sel.split(',').map((s) => s.trim());
    for (let n = this; n; n = n.pai) {
      if (simples.some((s) => (s[0] === '#' ? n.id === s.slice(1) : s[0] === '.' ? n.classes.includes(s.slice(1)) : /^[a-z]+$/.test(s) && n.tag === s))) return n;
    }
    return null;
  } });
  // A GEOMETRIA DE VERDADE a 390 px (medida no navegador): o placar, o card e os
  // avisos têm a mesma calha de 16 px dos dois lados — e o FAB (334–378 no
  // `cima-dir`) passa 4 px da borda direita deles. É por essa coluna que o
  // `cima-dir` lia "livre" com o banner na tela: nos três pontos da grade, o
  // banner nos dois de dentro e o fundo da página no de fora. Placar de largura
  // CHEIA aqui achava o "Restam" na coluna de fora e escondia o defeito.
  const corpo = no({ tag: 'body', caixa: [0, 0, LARGURA, ALTURA] });
  const placar = no({ tag: 'div', id: 'placar', classes: ['nao-cobrir'], pai: corpo, caixa: [16, 62, 374, 128] });
  const restam = no({ tag: 'span', id: 'pendingCount', pai: placar, caixa: [300, 70, 374, 120] });
  const lidos = no({ tag: 'span', id: 'readCount', pai: placar, caixa: [16, 70, 100, 120] });
  const foto = no({ tag: 'img', pai: corpo, caixa: [16, 132, 374, 750] });
  const barra = no({ tag: 'div', pai: corpo, caixa: [16, 760, 374, ALTURA] });
  const botao = no({ tag: 'button', pai: barra, caixa: [16, 760, 374, ALTURA] });
  const camadas = [];   // de CIMA pra baixo
  if (banner) {
    const stack = no({ tag: 'div', id: 'bannerStack', pai: corpo, caixa: [0, 0, 0, 0] });
    const cont = no({ tag: 'div', id: 'bannerContainer', pai: stack, caixa: [16, 68, 374, 140] });
    camadas.push(no({ tag: 'div', classes: ['toast'], pai: cont, caixa: [16, 68, 374, 140] }));
  }
  if (desfazer) {
    // O Desfazer do rodapé, com o botão dele, alto o bastante pra alcançar o `baixo-*`.
    const stack = no({ tag: 'div', id: 'notifyStack', pai: corpo, caixa: [0, 0, 0, 0] });
    const cont = no({ tag: 'div', id: 'undoContainer', pai: stack, caixa: [16, 690, 374, 830] });
    camadas.push(no({ tag: 'button', id: 'undoBtn', pai: cont, caixa: [16, 690, 374, 830] }));
  }
  if (modal) camadas.push(no({ tag: 'div', id: 'helpModal', pai: corpo, caixa: [0, 0, LARGURA, ALTURA] }));
  camadas.push(restam, lidos, placar, foto, botao, barra, corpo);
  const dentro = (n, x, y) => x >= n.caixa[0] && x < n.caixa[2] && y >= n.caixa[1] && y < n.caixa[3];
  const pilha = (x, y) => camadas.filter((n) => dentro(n, x, y));
  const classes = new Set();
  const fab = { style: {}, dataset: {}, classList: { contains: (c) => classes.has(c), remove: (c) => classes.delete(c) },
    getBoundingClientRect: () => ({ width: 44, height: 44 }), contains: (n) => n === fab || n === btn };
  const btn = { style: {} };
  const document = {
    getElementById: (id) => (id === 'devFab' ? fab : id === 'devFabBtn' ? btn : null),
    querySelector: (s) => (s === 'header' ? { getBoundingClientRect: () => ({ bottom: 60 }) } : null),
    elementsFromPoint: pilha,
    elementFromPoint: (x, y) => pilha(x, y)[0] || null,
  };
  const DEV_FAB_ACIONAVEL = constanteDoApp('DEV_FAB_ACIONAVEL');
  const DEV_FAB_LEITURA = constanteDoApp('DEV_FAB_LEITURA');
  const deps = { document, innerWidth: LARGURA, innerHeight: ALTURA,
    DEV_FAB_CANTOS: constanteDoApp('DEV_FAB_CANTOS'), DEV_FAB_AMOSTRAS: constanteDoApp('DEV_FAB_AMOSTRAS'),
    DEV_FAB_MARGEM: constanteDoApp('DEV_FAB_MARGEM'), DEV_FAB_RESERVA_TOAST: constanteDoApp('DEV_FAB_RESERVA_TOAST'),
    DEV_FAB_EVITAR: constanteDoApp('DEV_FAB_EVITAR', { DEV_FAB_ACIONAVEL, DEV_FAB_LEITURA }),
    DEV_FAB_PASSAGEIROS: constanteDoApp('DEV_FAB_PASSAGEIROS') };
  const chaves = Object.keys(deps);
  const posicionar = new Function(...chaves, 'let devFabFixado = false, devFabDedo = null;\n'
    + ['devFabCoords', 'devFabSob', 'devFabVitimas', 'posicionarFabDev'].map(fatiar).join('\n')
    + '\nreturn posicionarFabDev;')(...chaves.map((k) => deps[k]));
  posicionar();
  return { canto: fab.dataset.canto, fab, btn };
}

test('R7-4-01: com o banner do topo na tela, o FAB NÃO vai pra cima do placar (mede o que fica por baixo do banner)', () => {
  // A RÉGUA: sem banner, os dois cantos de cima caem no placar, e o FAB vai pro `baixo-dir`.
  assert.equal(telaDoFab().canto, 'baixo-dir', 'PRÉ-CONDIÇÃO: sem banner, o canto livre desta tela é o baixo-dir');
  const t = telaDoFab({ banner: true });
  assert.equal(t.canto, 'baixo-dir', `com o banner na tela, o FAB foi pro ${t.canto} — em cima do "Restam", onde fica depois de o banner sair`);
  // O FAB volta a valer no hit-test depois da medição.
  assert.equal(t.fab.style.pointerEvents, undefined);
  assert.equal(t.btn.style.pointerEvents, undefined);
});

test('R7-4-01: o Desfazer do rodapé também não espanta o FAB pro meio da foto', () => {
  assert.equal(telaDoFab({ desfazer: true }).canto, 'baixo-dir',
    'o botão do Desfazer (passageiro, e por CIMA do FAB) contou como vítima do canto de baixo');
});

test('R7-4-01: CONTROLE — camada que NÃO é aviso passageiro (um modal) segue decidindo o canto', () => {
  // Com a Ajuda aberta, o placar está ESCONDIDO: o FAB mede o modal e fica no
  // canto preferido (quando a camada fecha, o observador o reavalia). Se a
  // medida ignorasse qualquer camada, ele fugiria do placar que ninguém vê — e
  // este caso é também a prova de que a tela de mentira empilha de verdade.
  assert.equal(telaDoFab({ modal: true }).canto, 'cima-dir');
});
