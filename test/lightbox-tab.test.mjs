// As camadas de foto e de mapa são `aria-modal`, e o Tab saía delas pro card de
// trás: Shift+Tab caía no ✓ (auditoria de 2026-09-25). `trapTabInModal`
// EXECUTADO, com o foco dentro e fora da camada.
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

function camada() {
  const doc = { activeElement: null };
  const el = (nome) => ({ nome, offsetParent: {}, focus() { doc.activeElement = this; } });
  const itens = [el('fechar'), el('anterior'), el('proxima')];
  const modal = { querySelectorAll: () => itens, contains: (x) => itens.includes(x) };
  const trap = new Function('document', fatiar('trapTabInModal') + '\nreturn trapTabInModal;')(doc);
  const tab = (shiftKey) => { let parou = false; trap({ shiftKey, preventDefault: () => { parou = true; } }, modal); return parou; };
  return { doc, itens, tab, fora: el('✓ do card de trás') };
}

test('Tab com o foco FORA da camada entra nela (e Shift+Tab pela ponta de trás)', () => {
  const c = camada();
  c.doc.activeElement = c.fora;
  assert.equal(c.tab(false), true, 'o Tab seguiu pro card de trás');
  assert.equal(c.doc.activeElement.nome, 'fechar');
  c.doc.activeElement = c.fora;
  c.tab(true);
  assert.equal(c.doc.activeElement.nome, 'proxima');
  // CONTROLE: dentro da camada, no meio, o Tab é do navegador (não se mete).
  c.doc.activeElement = c.itens[1];
  assert.equal(c.tab(false), false, 'CONTROLE: o trap passou a sequestrar o Tab do meio da camada');
  // E nas pontas dá a volta, como já dava.
  c.doc.activeElement = c.itens[2];
  c.tab(false);
  assert.equal(c.doc.activeElement.nome, 'fechar');
});

test('as duas camadas de imagem prendem o Tab (foto e mapa)', () => {
  const k = APP_SEM.slice(APP_SEM.indexOf('function handleKeyDown('));
  const mapa = k.slice(k.indexOf('MapaLightbox.isOpen()'), k.indexOf('if (Lightbox.isOpen())'));
  // O mapa leva o Desfazer na volta do Tab, como a foto (L29, auditoria de
  // 2026-09-29): a escrita da foto cuja janela corre tem o banner por cima do
  // mapa também, e preso na camada o Tab nunca chegava nele.
  assert.match(mapa, /e\.key === 'Tab'\) trapTabInModal\(e, document\.getElementById\('mapaLightbox'\), document\.getElementById\('undoContainer'\)\)/,
    'o Desfazer das ações de foto não entra na volta do Tab do mapa ampliado: visível e inalcançável pelo teclado');
  const foto = k.slice(k.indexOf('if (Lightbox.isOpen())'), k.indexOf('const openedModal'));
  // A da foto leva o Desfazer junto na volta (ver o teste de baixo).
  assert.match(foto, /e\.key === 'Tab'\) trapTabInModal\(e, document\.getElementById\('imageLightbox'\), document\.getElementById\('undoContainer'\)\)/,
    'o Desfazer das ações de foto saiu da volta do Tab do lightbox: fica visível e inalcançável pelo teclado');
});

// O Desfazer das ações de foto mora no `#notifyStack`, FORA do lightbox, e é
// desenhado por cima dele. Preso na camada, o Tab nunca chegava nele
// (auditoria de 2026-09-26: 25 Tabs, e o foco rodou pelas 6 paradas do lightbox).
function camadaComDesfazer() {
  const doc = { activeElement: null };
  const el = (nome) => ({ nome, offsetParent: {}, focus() { doc.activeElement = this; } });
  const itens = [el('fechar'), el('anterior'), el('proxima')];
  const desfazer = el('Desfazer');
  const modal = { querySelectorAll: () => itens, contains: (x) => itens.includes(x) };
  const banner = { querySelectorAll: () => [desfazer], contains: (x) => x === desfazer };
  const trap = new Function('document', fatiar('trapTabInModal') + '\nreturn trapTabInModal;')(doc);
  const tab = (shiftKey) => { let parou = false; trap({ shiftKey, preventDefault: () => { parou = true; } }, modal, banner); return parou; };
  return { doc, itens, desfazer, tab, fora: el('✓ do card de trás') };
}

test('o Desfazer que aparece por cima do lightbox entra na volta do Tab — nas duas direções', () => {
  const c = camadaComDesfazer();
  // Da última parada da camada, o Tab vai pro Desfazer (e não pro próximo do DOM).
  c.doc.activeElement = c.itens[2];
  assert.equal(c.tab(false), true, 'o Tab da última parada do lightbox não foi levado ao Desfazer');
  assert.equal(c.doc.activeElement.nome, 'Desfazer');
  // O Desfazer é "dentro": dali o Tab dá a volta pro começo da camada…
  c.tab(false);
  assert.equal(c.doc.activeElement.nome, 'fechar', 'do Desfazer o Tab escapou da camada');
  // …e o Shift+Tab faz o caminho inverso: do começo pro Desfazer, dele pra última parada.
  c.tab(true);
  assert.equal(c.doc.activeElement.nome, 'Desfazer');
  c.tab(true);
  assert.equal(c.doc.activeElement.nome, 'proxima');
  // CONTROLE: no meio da camada o Tab segue do navegador, e de fora entra pela ponta.
  c.doc.activeElement = c.itens[1];
  assert.equal(c.tab(false), false, 'CONTROLE: o trap passou a sequestrar o Tab do meio da camada');
  c.doc.activeElement = c.fora;
  c.tab(false);
  assert.equal(c.doc.activeElement.nome, 'fechar');
});

// ── L13: no mapa ampliado as QUATRO setas andam (auditoria de 2026-09-26) ────
// O ↓ fechava o mapa (copiado da foto, onde espelha o arraste pra baixo que
// fecha); no mapa o arraste pra baixo ANDA, e pelo teclado não se chegava ao
// sul do pedido. O `handleKeyDown` de verdade, com as camadas de mentira.
// Uma constante de UMA linha do app, de verdade (`const NOME = …;`).
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = [^\\n]*;$', 'm').exec(APP_SEM);
  assert.ok(m, nome + ' sumiu');
  return m[0];
}

// `escala`: o zoom da foto ampliada (R5-3-06). `apertar(tecla, modificadores)`
// devolve se o app ficou com a tecla (`preventDefault`) — o que o navegador
// não faz quando ela é dele (R5-3-05).
function teclado({ mapaAberto, fotoAberta, janelaDaFoto = false, campoFocado = false, escala = 1 }) {
  const log = [];
  const MapaLightbox = { isOpen: () => mapaAberto, close: () => log.push('mapa:fechou'),
    zoom: (d) => log.push('mapa:zoom' + d), arrastar: (dx, dy) => log.push(`mapa:anda ${dx},${dy}`) };
  const Lightbox = { isOpen: () => fotoAberta, prev: () => log.push('foto:prev'), next: () => log.push('foto:next'),
    zoomPeloTeclado: (s) => log.push('foto:zoom' + s), scale: escala, panBy: (dx, dy) => log.push(`foto:anda ${dx},${dy}`) };
  // `janelaDaFoto`: a janela do Desfazer de uma escrita da foto correndo — o
  // `desfazerPeloTeclado` de verdade aperta o botão do banner e diz que desfez.
  const deps = { MapaLightbox, Lightbox, focoEmCampoDeTexto: () => campoFocado,
    trapTabInModal: (e, ...zonas) => log.push('tab:' + zonas.map((z) => z && z.id).join('+')),
    recuarNaFoto: () => log.push('foto:recuou'),
    desfazerPeloTeclado: () => { if (!janelaDaFoto) return false; log.push('desfez'); return true; },
    document: { getElementById: (id) => ({ id }) } };
  const fonte = [constante('TECLAS_DE_CURSOR'), constante('SETAS_QUE_ANDAM'), fatiar('atalhoDoNavegador'),
    constante('TECLAS_DOS_ATALHOS_DO_NAVEGADOR'), fatiar('handleKeyDown')].join('\n');
  const h = new Function(...Object.keys(deps), fonte + '\nreturn handleKeyDown;')(...Object.values(deps));
  return { apertar: (key, mods = {}) => { let parou = false; h({ key, ...mods, preventDefault() { parou = true; } }); return parou; }, log };
}

test('L13 mapa ampliado: ← → ↑ ↓ andam (o ↓ pro SUL) e só o Esc fecha', () => {
  const m = teclado({ mapaAberto: true, fotoAberta: false });
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) m.apertar(k);
  assert.deepEqual(m.log, ['mapa:anda 80,0', 'mapa:anda -80,0', 'mapa:anda 0,80', 'mapa:anda 0,-80'],
    'as setas não andam as quatro direções no mapa (o ↓ fechava)');
  m.apertar('Escape');
  assert.equal(m.log.at(-1), 'mapa:fechou', 'o Esc deixou de fechar o mapa');
  // CONTROLE: na FOTO o ↓ segue sendo o passo pra trás (espelha o arraste).
  const f = teclado({ mapaAberto: false, fotoAberta: true });
  f.apertar('ArrowDown');
  assert.deepEqual(f.log, ['foto:recuou'], 'CONTROLE: na foto o ↓ deixou de ser o passo pra trás');
});

// ── L29: o Desfazer da foto alcançável com o MAPA ampliado aberto ──────────
// (auditoria de 2026-09-29). Excluir, aprovar ou renomear pela foto, fechar e
// abrir o mapa (o caminho natural: conferir onde o local fica) deixa a janela
// do Desfazer correndo, com o banner por cima do mapa — e ali a tecla z não
// chegava nele, nem o Tab (MEDIDO: 12 Tabs e o foco não chegou; o z não
// desfez, e a exclusão saiu). Na foto chegava. O `handleKeyDown` de verdade.
test('L29 mapa ampliado com a janela da foto: z desfaz, e o Tab leva o Desfazer na volta', () => {
  const m = teclado({ mapaAberto: true, fotoAberta: false, janelaDaFoto: true });
  m.apertar('z');
  assert.deepEqual(m.log, ['desfez'], 'no mapa ampliado a tecla z não desfaz a escrita da foto cuja janela corre');
  m.apertar('Tab');
  assert.equal(m.log.at(-1), 'tab:mapaLightbox+undoContainer',
    'o Tab do mapa ampliado não leva o Desfazer na volta — ele fica visível e inalcançável');
  // CONTROLE: na foto, os dois já valiam (é a régua que o mapa passa a seguir).
  const f = teclado({ mapaAberto: false, fotoAberta: true, janelaDaFoto: true });
  f.apertar('z'); f.apertar('Tab');
  assert.deepEqual(f.log, ['desfez', 'tab:imageLightbox+undoContainer']);
  // Sem janela nenhuma, o z não faz nada (e não desfaz o que não existe).
  const n = teclado({ mapaAberto: true, fotoAberta: false });
  n.apertar('z');
  assert.deepEqual(n.log, []);
});

// ── L33: + e − dão zoom na foto ampliada, como no mapa ─────────────────────
// (auditoria de 2026-09-29): no mapa o + aproximava (17 → 18) e na foto não
// fazia nada (escala 1 → 1).
test('L33 foto ampliada: + e − dão zoom — e com o campo do nome focado são LETRAS', () => {
  const f = teclado({ mapaAberto: false, fotoAberta: true });
  for (const k of ['+', '=', '-', '_']) f.apertar(k);
  assert.deepEqual(f.log, ['foto:zoom1', 'foto:zoom1', 'foto:zoom-1', 'foto:zoom-1'],
    'na foto ampliada + e − não dão zoom (no mapa dão)');
  // CONTROLE: no mapa, o mesmo teclado (a régua que a foto passa a seguir).
  const m = teclado({ mapaAberto: true, fotoAberta: false });
  m.apertar('+'); m.apertar('-');
  assert.deepEqual(m.log, ['mapa:zoom1', 'mapa:zoom-1']);
  // Renomeando ("Posto 24-horas"), o "-" é do NOME, não do zoom.
  const c = teclado({ mapaAberto: false, fotoAberta: true, campoFocado: true });
  c.apertar('-'); c.apertar('+');
  assert.deepEqual(c.log, [], 'com o campo do nome focado, "+" e "-" viraram zoom em vez de letras');
});

// ── R5-3-05: Ctrl, ⌘ ou Alt com + = − é ATALHO do navegador ─────────────────
// (auditoria de 2026-09-30). MEDIDO: com a foto ampliada aberta, Ctrl+= e
// Ctrl+- saíam com `preventDefault` e ampliavam a FOTO — o L33 trouxe isso do
// mapa, onde já era assim. Ctrl/⌘ com + − = é o zoom da PÁGINA: quem amplia a
// interface pelo teclado não conseguia com uma ampliação aberta, e o zoom
// nunca é bloqueado (WCAG 1.4.4). O `handleKeyDown` de verdade, nas duas.
test('R5-3-05 Ctrl, ⌘ e Alt com + = − passam pro navegador — a foto e o mapa ampliados não os engolem', () => {
  for (const [camada, aberta] of [['foto', { mapaAberto: false, fotoAberta: true }], ['mapa', { mapaAberto: true, fotoAberta: false }]]) {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      const f = teclado(aberta);
      const presas = ['+', '=', '-', '_'].filter((k) => f.apertar(k, { [mod]: true }));
      assert.deepEqual(presas, [], `${camada}: ${mod} com + − = ficou com o app (preventDefault) — o zoom da página não acontece`);
      assert.deepEqual(f.log, [], `${camada}: ${mod} com + − = ampliou a ${camada} em vez da página`);
    }
    // CONTROLE: sem o modificador — e com o Shift, que é como se digita o "+"
    // em vários teclados —, a tecla segue sendo do zoom da camada.
    const c = teclado(aberta);
    assert.equal(c.apertar('+', { shiftKey: true }), true, `CONTROLE: ${camada}: o + com Shift deixou de ser do app`);
    assert.equal(c.apertar('-'), true);
    assert.deepEqual(c.log, [`${camada}:zoom1`, `${camada}:zoom-1`], `CONTROLE: ${camada}: + e − deixaram de dar zoom`);
  }
});

// ── R5-3-06: a foto AMPLIADA anda pelas setas, como o mapa ───────────────────
// (auditoria de 2026-09-30). MEDIDO: + + levava a escala a 1,44, e a → trocava
// de foto e desfazia o zoom; numa foto só, nada. Pelo teclado se via só o miolo
// ampliado — a placa no canto da fachada ficava inalcançável. O toque já anda
// quando a foto está ampliada (o arraste só troca e fecha em 1×).
test('R5-3-06 foto ampliada (mais que 1×): as quatro setas ANDAM, no passo e no sentido do mapa — em 1×, as de sempre', () => {
  const setas = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  const f = teclado({ mapaAberto: false, fotoAberta: true, escala: 1.44 });
  for (const k of setas) assert.equal(f.apertar(k), true, `${k} na foto ampliada não ficou com o app`);
  const m = teclado({ mapaAberto: true, fotoAberta: false });
  for (const k of setas) m.apertar(k);
  assert.deepEqual(f.log, m.log.map((l) => l.replace('mapa:', 'foto:')),
    'na foto ampliada as setas não andam como no mapa (trocavam de foto e desfaziam o zoom; o ↓ fechava)');
  // CONTROLE: em 1× — ← → trocam de foto, ↓ é o passo pra trás.
  const u = teclado({ mapaAberto: false, fotoAberta: true, escala: 1 });
  for (const k of setas) u.apertar(k);
  assert.deepEqual(u.log, ['foto:prev', 'foto:next', 'foto:recuou'], 'CONTROLE: em 1× as setas da foto mudaram');
  // E com o campo do nome focado as setas são do CURSOR, ampliada ou não.
  const c = teclado({ mapaAberto: false, fotoAberta: true, escala: 1.44, campoFocado: true });
  for (const k of setas) assert.equal(c.apertar(k), false, `${k} no campo do nome não ficou com o cursor`);
  assert.deepEqual(c.log, [], 'com o campo do nome focado, as setas andaram pela foto');
});

test('L29 o Desfazer some com o foco nele e o mapa aberto: o foco volta pro ✕ do mapa, não cai no <body>', () => {
  const rodar = ({ focoNoBanner, mapaAberto }) => {
    const doc = { body: { nome: 'body' } };
    const fechar = { nome: 'mapaLbClose', focus() { doc.activeElement = this; } };
    const botao = { nome: 'undoBtn' };
    const outro = { nome: 'mapaLbMais' };
    // Apagar o banner com o foco nele joga o foco no <body>, como o navegador.
    const container = { contains: (x) => x === botao,
      set innerHTML(v) { if (doc.activeElement === botao) doc.activeElement = doc.body; } };
    doc.getElementById = (id) => ({ undoContainer: container, mapaLbClose: fechar })[id] || null;
    doc.activeElement = focoNoBanner ? botao : outro;
    new Function('document', 'manterFocoNoLightbox', 'MapaLightbox', fatiar('removeUndoBanner') + '\nremoveUndoBanner();')(
      doc, () => {}, { isOpen: () => mapaAberto });
    return doc.activeElement.nome;
  };
  assert.equal(rodar({ focoNoBanner: true, mapaAberto: true }), 'mapaLbClose',
    'o Desfazer sumiu com o foco nele e o foco caiu no <body>, fora do mapa ampliado (aria-modal)');
  assert.equal(rodar({ focoNoBanner: false, mapaAberto: true }), 'mapaLbMais', 'CONTROLE: o foco fora do banner foi mexido');
  assert.equal(rodar({ focoNoBanner: true, mapaAberto: false }), 'body', 'CONTROLE: sem o mapa aberto, o mapa não pega o foco');
});
