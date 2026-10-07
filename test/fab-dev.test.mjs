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
// `gesto`: há um GESTO no card da frente (o dedo nele, a volta pro lugar, a
// saída) quando o canto é pedido — o que o swipe.js responde (R10-4-05).
function telaDoFab({ banner = false, desfazer = false, modal = false, larga = false, indicador = null, gesto = false } = {}) {
  // `larga`: a tela do computador (1280×800), medida no navegador — ver abaixo.
  const LARGURA = larga ? 1280 : 390, ALTURA = larga ? 800 : 844;
  // Um nó: id, tag, classes, pai e a caixa. O `closest` casa seletor simples
  // (tag, #id, .classe) — o que os nós desta tela precisam; atributo não casa.
  // Todo nó fica em `todos`, pro `querySelectorAll` (que casa pelo mesmo `closest`).
  const todos = [];
  const no = (o) => {
    const n = { classes: [], pai: null, ...o, closest(sel) {
      const simples = sel.split(',').map((s) => s.trim());
      for (let n = this; n; n = n.pai) {
        if (simples.some((s) => (s[0] === '#' ? n.id === s.slice(1) : s[0] === '.' ? n.classes.includes(s.slice(1)) : /^[a-z]+$/.test(s) && n.tag === s))) return n;
      }
      return null;
    },
    contains(outro) { for (let n = outro; n; n = n.pai) if (n === this) return true; return false; },
    getBoundingClientRect() { const [left, top, right, bottom] = this.caixa; return { left, top, right, bottom, width: right - left, height: bottom - top }; } };
    todos.push(n);
    return n;
  };
  // A GEOMETRIA DE VERDADE a 390 px (medida no navegador): o placar, o card e os
  // avisos têm a mesma calha de 16 px dos dois lados — e o FAB (334–378 no
  // `cima-dir`) passa 4 px da borda direita deles. É por essa coluna que o
  // `cima-dir` lia "livre" com o banner na tela: nos três pontos da grade, o
  // banner nos dois de dentro e o fundo da página no de fora. Placar de largura
  // CHEIA aqui achava o "Restam" na coluna de fora e escondia o defeito.
  // A 1280×800 (também medida, R9-4-05): o cabeçalho acaba em 69, e o placar e o
  // card ficam no MEIO (432–848) — os dois cantos de cima caem no fundo da página.
  const corpo = no({ tag: 'body', caixa: [0, 0, LARGURA, ALTURA] });
  const placar = no({ tag: 'div', id: 'placar', classes: ['nao-cobrir'], pai: corpo, caixa: larga ? [432, 77, 848, 144] : [16, 62, 374, 128] });
  const restam = no({ tag: 'span', id: 'pendingCount', pai: placar, caixa: larga ? [741, 86, 839, 114] : [300, 70, 374, 120] });
  const lidos = no({ tag: 'span', id: 'readCount', pai: placar, caixa: larga ? [440, 86, 540, 114] : [16, 70, 100, 120] });
  const foto = no({ tag: 'img', pai: corpo, caixa: larga ? [440, 152, 840, 700] : [16, 132, 374, 750] });
  const barra = no({ tag: 'div', pai: corpo, caixa: larga ? [440, 730, 840, 784] : [16, 760, 374, ALTURA] });
  const botao = no({ tag: 'button', pai: barra, caixa: larga ? [440, 730, 840, 784] : [16, 760, 374, ALTURA] });
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
  // O "N esperando envio" (`#inFlightIndicator`, `fixed top-20 right-4 z-40`):
  // a caixa MEDIDA a 1280×800 (23×17 px), e as classes que o app de verdade põe
  // nele (`classesDoIndicador`, abaixo). Abaixo de um modal, acima do placar.
  if (indicador) {
    camadas.push(no({ tag: 'div', id: 'inFlightIndicator', classes: indicador, pai: corpo,
      caixa: larga ? [1241, 80, 1264, 97] : [351, 80, 374, 97] }));
  }
  camadas.push(restam, lidos, placar, foto, botao, barra, corpo);
  const dentro = (n, x, y) => x >= n.caixa[0] && x < n.caixa[2] && y >= n.caixa[1] && y < n.caixa[3];
  const pilha = (x, y) => camadas.filter((n) => dentro(n, x, y));
  const classes = new Set();
  const fab = { style: {}, dataset: {}, classList: { contains: (c) => classes.has(c), remove: (c) => classes.delete(c) },
    getBoundingClientRect: () => ({ width: 44, height: 44 }), contains: (n) => n === fab || n === btn };
  const btn = { style: {} };
  const document = {
    getElementById: (id) => (id === 'devFab' ? fab : id === 'devFabBtn' ? btn : null),
    querySelector: (s) => (s === 'header' ? { getBoundingClientRect: () => ({ bottom: larga ? 69 : 60 }) } : null),
    querySelectorAll: (sel) => todos.filter((n) => n.closest(sel) === n),
    elementsFromPoint: pilha,
    elementFromPoint: (x, y) => pilha(x, y)[0] || null,
  };
  const DEV_FAB_ACIONAVEL = constanteDoApp('DEV_FAB_ACIONAVEL');
  const DEV_FAB_LEITURA = constanteDoApp('DEV_FAB_LEITURA');
  const cardDaFrente = { id: 'cardDaFrente' };
  const estado = { gesto };
  const deps = { document, innerWidth: LARGURA, innerHeight: ALTURA,
    DEV_FAB_CANTOS: constanteDoApp('DEV_FAB_CANTOS'), DEV_FAB_AMOSTRAS: constanteDoApp('DEV_FAB_AMOSTRAS'),
    DEV_FAB_MARGEM: constanteDoApp('DEV_FAB_MARGEM'), DEV_FAB_RESERVA_TOAST: constanteDoApp('DEV_FAB_RESERVA_TOAST'),
    DEV_FAB_EVITAR: constanteDoApp('DEV_FAB_EVITAR', { DEV_FAB_ACIONAVEL, DEV_FAB_LEITURA }), DEV_FAB_LEITURA,
    DEV_FAB_PASSAGEIROS: constanteDoApp('DEV_FAB_PASSAGEIROS'),
    cardDaFrente: () => cardDaFrente, cardSobGesto: (c) => estado.gesto && c === cardDaFrente,
    redesenharCardAdiado: () => {} };
  const chaves = Object.keys(deps);
  const { posicionar, aoFimDoGesto } = new Function(...chaves, 'let devFabFixado = false, devFabDedo = null, fabEsperaOGesto = false;\n'
    + ['devFabCoords', 'devFabSob', 'devFabVitimas', 'posicionarFabDev', 'aoFimDoGesto'].map(fatiar).join('\n')
    + '\nreturn { posicionar: posicionarFabDev, aoFimDoGesto };')(...chaves.map((k) => deps[k]));
  posicionar();
  // O fim do gesto, como o swipe.js o avisa.
  const fimDoGesto = () => { estado.gesto = false; aoFimDoGesto(); return fab.dataset.canto; };
  return { canto: fab.dataset.canto, fab, btn, fimDoGesto, posicionar, estado };
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

// ── R9-4-05: o FAB × o "N esperando envio" (deitado, tablet, computador) ─────
// Onde o placar não passa por baixo do `cima-dir` (a tela mais larga que ele), o
// canto lia como livre — e é o canto do indicador. MEDIDO no navegador: 100% do
// número coberto a 1280×800, 844×390 e 768×1024, nos dois motores. Duas coisas
// faltavam: o indicador não era `.nao-cobrir` (o FAB só evita controle e número
// MARCADO), e a grade de 3×3 do FAB não o tocava — 17 px de altura cabiam
// inteiros entre a 1ª e a 2ª linha. Aqui as classes vêm do `updateInFlightIndicator`
// DE VERDADE, e o `posicionarFabDev` roda sobre a tela medida.
// A fila de saída aqui é de pedidos com CHAVE (`v1|u1`…), e o que ESTA aba está
// mandando agora fica em `emAndamento` (o `pedidosEmAndamento` do app): a decisão
// que sai é anotada na fila ANTES do envio (`anotarAntesDoEnvio`), e só a que
// ninguém está mandando conta como esperando (R10-4-05). `outraAba`: as chaves
// que a OUTRA aba está mandando (a marca dela no item).
// O prazo da marca da outra aba (`SAIDA_REIVINDICACAO_MS`), lido do app.
const PRAZO_DA_MARCA = (() => {
  const m = /^const SAIDA_REIVINDICACAO_MS = (\d+) \* 1000;/m.exec(APP_SEM);
  assert.ok(m, 'o prazo da marca da outra aba (`SAIDA_REIVINDICACAO_MS`) mudou de forma');
  return Number(m[1]) * 1000;
})();
// `outraAba` é a marca de VERDADE no item (`rv`/`rvEm`, lida pelo
// `reivindicadoPorOutraAba` de verdade), com o relógio e os temporizadores de
// mentira: a marca vence (R11-4-03), e o redesenho no prazo dela se mede
// andando o relógio (`passar`), sem esperar 60 s nem deixar timer vivo.
function indicadorDeVerdade({ fila = 1, noAr = 0 } = {}) {
  const ids = new Map();
  const reavaliou = [];
  const relogio = { t: 5_000_000 };
  const timers = new Map();
  let proximoTimer = 0;
  const item = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i });
  let saida = Array.from({ length: fila }, (_, i) => item(i + 1));
  const emAndamento = new Set();
  const document = {
    getElementById: (id) => (id === 'logoutModal' ? { classList: { contains: () => true } } : ids.get(id) || null),
    createElement: () => {
      const el = { className: '', title: '', innerHTML: '', style: {}, remove() { ids.delete(this.id); } };
      return el;
    },
    body: { appendChild: (el) => { ids.set(el.id, el); } },
  };
  const AppState = { authenticated: true, inFlightActions: noAr };
  const chaveDoPedido = new Function(fatiar('chaveDoPedido') + '\nreturn chaveDoPedido;')();
  const Date = { now: () => relogio.t };
  const reivindicadoPorOutraAba = new Function('ABA_DESTA_PAGINA', 'SAIDA_REIVINDICACAO_MS', 'Date',
    fatiar('reivindicadoPorOutraAba') + '\nreturn reivindicadoPorOutraAba;')('aba-esta', PRAZO_DA_MARCA, Date);
  const deps = { document, AppState, carregarFilaDeSaida: () => saida.map((x) => ({ ...x })), t: (k, v) => `${k}:${v.n}`,
    escapeHtml: (x) => String(x), desenharAvisoDoSair: () => {}, atualizarFabDev: () => reavaliou.push(ids.has('inFlightIndicator')),
    pedidosEmAndamento: emAndamento, chaveDoPedido, reivindicadoPorOutraAba, SAIDA_REIVINDICACAO_MS: PRAZO_DA_MARCA, Date,
    setTimeout: (fn, ms) => { const id = ++proximoTimer; timers.set(id, { fn, quando: relogio.t + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); } };
  const chaves = Object.keys(deps);
  const atualizar = new Function(...chaves, 'let indicadorMarcaVence = null;\n' + fatiar('saindoPelaOutraAba') + '\n'
    + fatiar('updateInFlightIndicator') + '\nreturn updateInFlightIndicator;')(...chaves.map((k) => deps[k]));
  return { atualizar, reavaliou, el: () => ids.get('inFlightIndicator') || null,
    fila: (n) => { saida = Array.from({ length: n }, (_, i) => item(i + 1)); }, AppState,
    // A decisão `i` anotada na fila de saída, e saindo (em andamento) ou não.
    anotar: (i, saindo = true) => { saida.push(item(i)); if (saindo) emAndamento.add(`v${i}|u${i}`); },
    soltar: (i) => emAndamento.delete(`v${i}|u${i}`),
    tirar: (i) => { saida = saida.filter((x) => x.venueID !== 'v' + i); },
    // A OUTRA aba marcou o item `i` (a anotação antes do envio dela), agora ou em `em`.
    naOutraAba: (i, em = relogio.t) => { saida = saida.map((x) => (x.venueID === 'v' + i ? { ...x, rv: 'aba-outra', rvEm: em } : x)); },
    // O relógio anda; o temporizador que venceu roda (só ele — nenhum laço de redesenho escondido).
    passar: (ms) => {
      relogio.t += ms;
      for (const [id, tm] of [...timers].sort((x, y) => x[1].quando - y[1].quando)) {
        if (tm.quando <= relogio.t && timers.has(id)) { timers.delete(id); tm.fn(); }
      }
    },
    timers };
}
const classesDoIndicador = () => { const i = indicadorDeVerdade(); i.atualizar(); return i.el().className.split(/\s+/).filter(Boolean); };
// O `top` do indicador (R10-4-02): ancorado no cabeçalho MEDIDO, com os 80 px de
// antes como piso. É ele que diz se a caixa medida abaixo (80–97 px) ainda vale.
const topoDoIndicador = () => { const i = indicadorDeVerdade(); i.atualizar(); return i.el().style.top; };
const TOPO_ANCORADO = 'max(5rem, calc(var(--header-h, 4rem) + 11px))';

test('R9-4-05: no computador, o FAB NÃO pousa em cima do "N esperando envio" — o número é `.nao-cobrir` e a medida o enxerga', () => {
  // A RÉGUA: sem o indicador, o canto livre do computador é o preferido (`cima-dir`).
  assert.equal(telaDoFab({ larga: true }).canto, 'cima-dir', 'PRÉ-CONDIÇÃO: sem o indicador, o canto livre a 1280×800 é o cima-dir');
  const classes = classesDoIndicador();
  assert.ok(classes.includes('fixed') && classes.includes('right-4') && topoDoIndicador() === TOPO_ANCORADO,
    'PRÉ-CONDIÇÃO: o indicador mudou de lugar — a caixa medida desta tela não vale mais');
  const t = telaDoFab({ larga: true, indicador: classes });
  assert.notEqual(t.canto, 'cima-dir', 'o FAB foi pro cima-dir, em cima do "N esperando envio" (o número de decisões sem sinal)');
  assert.equal(t.canto, 'cima-esq');
  // CONTROLE: com um modal por cima, o indicador está ESCONDIDO — ele não decide o
  // canto (a medida respeita as camadas, como faz com o placar).
  assert.equal(telaDoFab({ larga: true, indicador: classes, modal: true }).canto, 'cima-dir',
    'o indicador ATRÁS de um modal tirou o FAB do canto preferido — a medida não olha quem está à vista');
  // CONTROLE do celular em pé (390): o placar já tirava o FAB dos cantos de cima.
  assert.equal(telaDoFab({ indicador: classes }).canto, 'baixo-dir');
});

test('R9-4-05: o indicador que NASCE ou SOME reavalia o FAB — e o número que só muda, não', () => {
  const i = indicadorDeVerdade({ fila: 1 });
  i.atualizar();
  assert.ok(i.el(), 'PRÉ-CONDIÇÃO: o indicador não nasceu');
  assert.deepEqual(i.reavaliou, [true], 'o indicador nasceu SEM o FAB reavaliar o canto — ele fica em cima do número que acabou de aparecer');
  i.fila(3);
  i.atualizar();
  assert.deepEqual(i.reavaliou, [true], 'o FAB foi reavaliado a cada número (é a geometria que muda, não o número)');
  i.fila(0);
  i.atualizar();
  assert.equal(i.el(), null, 'PRÉ-CONDIÇÃO: o indicador não sumiu');
  assert.deepEqual(i.reavaliou, [true, false], 'o indicador sumiu sem o FAB reavaliar — o canto que ele ocupava não volta a ser o do FAB');
});

// ── R10-4-05: o "enviando" de cada decisão com rede NÃO é número a não cobrir ──
// O indicador não é só o "N esperando envio": ele nasce em TODA decisão com rede
// ("1 enviando", durante a ida ao Waze) e some na resposta. Com o `nao-cobrir`
// em todo estado, o FAB atravessava a tela larga duas vezes a cada ✕/✓ (MEDIDO,
// n15 da auditoria da rodada 10: 6 trocas de canto em 3 decisões a 1280×800,
// 844×390 e 768×1024, nos dois motores). A marca, e com ela a reavaliação do
// canto, vale com decisão ESPERANDO envio (a fila de saída) — a que fica.
test('R10-4-05: o "1 enviando" de uma decisão com rede não é `.nao-cobrir` nem mexe no FAB — nascendo ou sumindo', () => {
  // O caminho de VERDADE de um ✕ com rede: o executor sobe o "no ar" e redesenha;
  // a decisão é anotada na fila de saída ANTES do envio (e redesenha de novo);
  // a resposta tira o item da fila; o executor solta o "em andamento", desce o
  // "no ar" e redesenha — e o indicador some.
  const i = indicadorDeVerdade({ fila: 0 });
  i.AppState.inFlightActions = 1; i.atualizar();
  i.anotar(1); i.atualizar();
  assert.ok(i.el(), 'PRÉ-CONDIÇÃO: o "1 enviando" não nasceu');
  assert.ok(!i.el().className.split(/\s+/).includes('nao-cobrir'),
    'a decisão que está SAINDO virou número a não cobrir — o FAB foge dela a cada ✕/✓');
  assert.deepEqual(i.reavaliou, [], 'o "1 enviando" nascendo reavaliou o FAB (e ele atravessa a tela a cada decisão)');
  // E na tela larga, com o "1 enviando" no canto, o FAB segue no canto preferido.
  assert.equal(telaDoFab({ larga: true, indicador: i.el().className.split(/\s+/) }).canto, 'cima-dir',
    'o "1 enviando" tirou o FAB do canto preferido no computador');
  i.tirar(1); i.atualizar();                                  // pousou
  i.soltar(1); i.AppState.inFlightActions = 0; i.atualizar(); // o fim do executor
  assert.equal(i.el(), null, 'PRÉ-CONDIÇÃO: o indicador não sumiu');
  assert.deepEqual(i.reavaliou, [], 'o "1 enviando" sumindo reavaliou o FAB (a segunda travessia da tela)');
  // CONTROLE: o MESMO ✕ sem rede — a resposta não pousa, a decisão FICA esperando
  // envio: aí, sim, é número a não cobrir, e o FAB é reavaliado (R9-4-05).
  const c = indicadorDeVerdade({ fila: 0 });
  c.AppState.inFlightActions = 1; c.atualizar();
  c.anotar(1); c.atualizar();
  c.soltar(1); c.AppState.inFlightActions = 0; c.atualizar();
  assert.ok(c.el().className.split(/\s+/).includes('nao-cobrir'), 'CONTROLE: a decisão que ficou esperando envio deixou de ser número a não cobrir (R9-4-05)');
  assert.deepEqual(c.reavaliou, [true], 'CONTROLE: a espera começou sem o FAB reavaliar o canto');
});

test('R10-4-05: com decisão ESPERANDO envio, o número fica a não cobrir — também enquanto outra sai', () => {
  // Sem rede, dois ✕: o FAB é reavaliado UMA vez ao começar a espera, e uma ao
  // acabar — não a cada decisão do meio.
  const i = indicadorDeVerdade({ fila: 0 });
  i.AppState.inFlightActions = 1; i.atualizar(); i.anotar(1); i.atualizar();
  i.soltar(1); i.AppState.inFlightActions = 0; i.atualizar();          // falhou: "1 esperando"
  assert.deepEqual(i.reavaliou, [true], 'PRÉ-CONDIÇÃO: a espera começou sem o FAB reavaliar o canto');
  i.AppState.inFlightActions = 1; i.atualizar(); i.anotar(2); i.atualizar();   // o 2º ✕ sai, com o 1º esperando
  assert.ok(i.el().className.split(/\s+/).includes('nao-cobrir'),
    'com decisão esperando, o "enviando" do ✕ seguinte tirou a marca — sem rede o FAB iria e voltaria a cada ✕');
  i.soltar(2); i.AppState.inFlightActions = 0; i.atualizar();          // falhou também: "2 esperando"
  assert.deepEqual(i.reavaliou, [true], 'o FAB foi reavaliado no meio da espera, a cada decisão');
  i.tirar(1); i.atualizar(); i.tirar(2); i.atualizar();               // a rede voltou e a fila esvaziou
  assert.equal(i.el(), null);
  assert.deepEqual(i.reavaliou, [true, false], 'a espera acabou sem o FAB voltar ao canto que o número ocupava');
  // A espera que acaba COM outra decisão saindo: o indicador fica ("1 enviando"),
  // mas deixa de ser número a não cobrir — o FAB volta já, e não precisa esperar
  // o indicador sumir (que, sem a marca, não reavalia mais nada).
  const j = indicadorDeVerdade({ fila: 1 });
  j.atualizar();
  j.AppState.inFlightActions = 1; j.atualizar(); j.anotar(9); j.atualizar();
  j.tirar(1); j.atualizar();                                          // a 1ª pousou pelo esvaziamento
  assert.ok(j.el() && !j.el().className.split(/\s+/).includes('nao-cobrir'), 'PRÉ-CONDIÇÃO: só a decisão que está saindo');
  assert.deepEqual(j.reavaliou, [true, true], 'a espera acabou com o indicador na tela, e o FAB não voltou ao canto');
  j.tirar(9); j.atualizar(); j.soltar(9); j.AppState.inFlightActions = 0; j.atualizar();
  assert.deepEqual([j.el(), j.reavaliou], [null, [true, true]]);
  // A decisão que a OUTRA aba está mandando (a marca dela no item) também não é espera.
  const o = indicadorDeVerdade({ fila: 1 });
  o.naOutraAba(1);
  o.atualizar();
  assert.ok(o.el() && !o.el().className.split(/\s+/).includes('nao-cobrir'), 'a decisão que a outra aba está mandando virou número a não cobrir');
  assert.deepEqual(o.reavaliou, []);
});

// ── R11-4-03: a decisão que a OUTRA aba está mandando é "enviando" — e a marca vence ──
// Com o app em duas abas, a decisão que a outra está mandando aparecia nesta
// como "1 esperando envio", com o relógio que quer dizer "parado esperando rede"
// — e sem o `.nao-cobrir` (R10-4-05), então no computador o FAB ficava por cima,
// cobrindo-o inteiro (MEDIDO, n25 da auditoria da rodada 11, nos dois motores).
// DECISÃO: ela conta como "enviando" (o estado que já existe: o giro, sem a
// marca), e o indicador é redesenhado quando a marca vence — um temporizador
// local no prazo dela, sem rede.
const estadoDoIndicador = (i) => {
  const el = i.el();
  if (!el) return null;
  return { titulo: el.title, gira: /animate-spin/.test(el.innerHTML), relogio: /M12 7v5l3 2/.test(el.innerHTML),
           naoCobrir: el.className.split(/\s+/).includes('nao-cobrir') };
};

test('R11-4-03: a decisão que a OUTRA aba está mandando é "enviando" (o giro), não "esperando envio" — e o FAB não se mexe', () => {
  const o = indicadorDeVerdade({ fila: 1 });
  o.naOutraAba(1);
  o.atualizar();
  assert.deepEqual(estadoDoIndicador(o), { titulo: 'indicator.sending:1', gira: true, relogio: false, naoCobrir: false },
    'DEFEITO: a decisão que a outra aba está mandando aparece como "esperando envio" (o relógio) — o que o indicador diz e o '
    + 'que o FAB lê (alguém está mandando) discordam');
  assert.deepEqual(o.reavaliou, [], 'o "enviando" da outra aba tirou o FAB do canto (o R10-4-05 de volta, por outro caminho)');
  // As duas abas mandando ao mesmo tempo: a conta é de quem está saindo.
  const d = indicadorDeVerdade({ fila: 1, noAr: 1 });
  d.naOutraAba(1);
  d.anotar(2);   // a decisão DESTA aba, no ar (anotada antes do envio, em andamento)
  d.atualizar();
  assert.equal(estadoDoIndicador(d).titulo, 'indicator.sending:2', 'a decisão da outra aba ficou fora da conta do "enviando"');
  // CONTROLE: a mesma fila sem a marca da outra aba (ninguém mandando) é "esperando", com a marca de número.
  const c = indicadorDeVerdade({ fila: 1 });
  c.atualizar();
  assert.deepEqual(estadoDoIndicador(c), { titulo: 'indicator.waiting:1', gira: false, relogio: true, naoCobrir: true },
    'CONTROLE: a decisão que ninguém está mandando deixou de ser "esperando envio"');
});

test('R11-4-03: a marca da outra aba VENCE (a aba morreu no meio do envio) — o indicador vira "esperando" no prazo dela, sozinho, e o FAB sai de cima', () => {
  const o = indicadorDeVerdade({ fila: 1 });
  o.naOutraAba(1);
  o.atualizar();
  assert.equal(o.timers.size, 1, 'PRÉ-CONDIÇÃO: nenhum redesenho agendado pro prazo da marca');
  o.passar(PRAZO_DA_MARCA - 1000);
  assert.equal(estadoDoIndicador(o).titulo, 'indicator.sending:1', 'o indicador deixou de dizer "enviando" antes de a marca vencer');
  o.passar(1100);
  assert.deepEqual(estadoDoIndicador(o), { titulo: 'indicator.waiting:1', gira: false, relogio: true, naoCobrir: true },
    'DEFEITO: a marca da outra aba venceu e o indicador seguiu girando — nada o redesenha no prazo dela');
  assert.deepEqual(o.reavaliou, [true], 'a decisão passou a esperar envio e o FAB não foi reavaliado (segue em cima do número)');
  assert.equal(o.timers.size, 0, 'sobrou temporizador depois de a marca vencer — sem marca, nada a esperar');
  // CONTROLE: a outra aba ENTREGA antes do prazo (o item sai da fila, o aviso do
  // armazenamento redesenha): o temporizador sai junto, e o prazo não faz nada.
  const c = indicadorDeVerdade({ fila: 1 });
  c.naOutraAba(1);
  c.atualizar();
  c.tirar(1);
  c.atualizar();
  assert.deepEqual([c.el(), c.timers.size], [null, 0], 'CONTROLE: a entrega da outra aba deixou o indicador ou o temporizador de pé');
  c.passar(2 * PRAZO_DA_MARCA);
  assert.deepEqual([c.el(), c.reavaliou], [null, []]);
  // E sem marca nenhuma (só decisão esperando, sem rede), nenhum temporizador: nada a esperar, nada que ande sozinho.
  const s = indicadorDeVerdade({ fila: 2 });
  s.atualizar();
  assert.equal(s.timers.size, 0, 'o indicador agendou redesenho sem marca de outra aba nenhuma');
});

// E a ORDEM do fim do envio: o executor do ✕/✓ redesenhava o indicador ANTES de
// soltar o "em andamento" — a decisão que ficou na fila (sem rede) contava como
// saindo, e o "1 esperando" nascia sem a marca, com o FAB por cima dele, até a
// próxima mudança. O lote e o "Marcar todos" já soltavam antes de redesenhar.
test('R10-4-05: o fim do envio solta o "em andamento" ANTES de redesenhar o indicador', () => {
  const m = /const runExecutor = async \(\) => \{[\s\S]*?\} finally \{([\s\S]*?)\n {8}\}/.exec(fatiar('scheduleAction'));
  assert.ok(m, 'o `finally` do executor sumiu do scheduleAction');
  const iSolta = m[1].indexOf('marcarEmAndamento(places, false);');
  const iDesenha = m[1].indexOf('updateInFlightIndicator();');
  assert.ok(iSolta >= 0 && iDesenha > iSolta,
    'o executor redesenha o indicador com a decisão ainda "em andamento" — o "1 esperando" nasce sem o `nao-cobrir`');
});

// E com o card no MEIO do gesto, o canto não é medido: a tela é a do meio do
// arraste, e o card deslocado deixa à mostra o canto que, parado, ele cobre
// (MEDIDO, n16 da auditoria: o indicador sumindo com o card seguinte arrastado
// pra direita, `baixo-dir` → `baixo-esq`, e o FAB ficava lá). A escolha espera o
// fim do gesto, que o swipe.js avisa (`aoFimDoGesto`).
test('R10-4-05: com um GESTO no card, o canto do FAB espera o card parar — e é escolhido quando ele para', () => {
  const t = telaDoFab({ gesto: true });
  assert.equal(t.canto, undefined, 'o canto foi medido com o card no meio do gesto');
  assert.equal(t.fimDoGesto(), 'baixo-dir', 'o fim do gesto não escolheu o canto que esperava');
  // O fim de OUTRO gesto, sem nada esperando, não mede de novo.
  t.fab.dataset.canto = 'marcado';
  assert.equal(t.fimDoGesto(), 'marcado', 'o fim de um gesto mediu o canto sem ninguém ter pedido');
  // CONTROLE: sem gesto, o canto é escolhido na hora (o R7-4-01 de sempre).
  assert.equal(telaDoFab().canto, 'baixo-dir');
});

// ── R10-4-02: o "N esperando envio" no iPhone com o app INSTALADO ──────────────
// Com `viewport-fit=cover` e a barra translúcida, a margem de segurança de cima
// (47 px; 59 com a Dynamic Island) entra no cabeçalho, que vai a 116–128 px — e o
// indicador, a 80 px fixos (`top-20`), ficava DEBAIXO dele: o único sinal de que
// há decisão esperando envio, sumido justo no app instalado (MEDIDO, n21 da
// auditoria da rodada 10: o dedo no meio dele caía no ⓘ). DECISÃO: ancorar na
// altura MEDIDA do cabeçalho (`--header-h`, como o `#bannerStack`), com a posição
// IDÊNTICA onde não há margem — MEDIDO no navegador a 390×844, 375×667, 280×653,
// 1280×800 (cabeçalho de 69 px) e 844×390 (53 px): 0 px de diferença. Aqui a
// fórmula de verdade é avaliada pra cada altura de cabeçalho.
test('R10-4-02: o indicador fica ABAIXO do cabeçalho medido — e onde não há margem, nos mesmos 80 px de antes', () => {
  const topo = topoDoIndicador();
  const m = /^max\((\d+(?:\.\d+)?)rem, calc\(var\(--header-h, (\d+(?:\.\d+)?)rem\) \+ (\d+)px\)\)$/.exec(topo || '');
  assert.ok(m, `o indicador não está ancorado no cabeçalho medido (top: ${JSON.stringify(topo)}) — e com a margem do iPhone instalado ele some debaixo do cabeçalho`);
  // A fórmula, com 1 rem = 16 px: o piso, a altura do cabeçalho (ou o padrão, antes de medida) e o vão.
  const px = (h) => Math.max(Number(m[1]) * 16, (h === undefined ? Number(m[2]) * 16 : h) + Number(m[3]));
  // Sem margem: os 80 px de antes, em pé e deitado, e antes de a altura ser medida.
  assert.deepEqual([px(69), px(53), px(undefined)], [80, 80, 80],
    'onde não há margem o indicador saiu do lugar em que foi desenhado (80 px)');
  // Com a margem do iPhone instalado: abaixo do cabeçalho, com o mesmo vão de hoje (80 − 69 = 11 px).
  assert.deepEqual([px(116), px(128)], [127, 139], 'com a margem de cima, o indicador não desceu junto com o cabeçalho');
  for (let h = 0; h <= 300; h++) assert.ok(px(h) >= h + 11, `com o cabeçalho de ${h} px, o indicador fica por baixo dele`);
  // E o 80 fixo não voltou como classe.
  assert.ok(!classesDoIndicador().includes('top-20'), 'voltou o `top-20` fixo');
});
