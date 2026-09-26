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
  assert.match(mapa, /e\.key === 'Tab'\) trapTabInModal\(e, document\.getElementById\('mapaLightbox'\)\)/);
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
