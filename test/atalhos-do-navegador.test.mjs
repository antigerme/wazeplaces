// Ctrl, ⌘ ou Alt com uma seta (ou com + − =) é ATALHO DO NAVEGADOR, não do app.
// MEDIDO nos dois motores (2026-10-01): na tela do card, Alt+← e ⌘+← — o Voltar
// do navegador — REJEITAVAM o pedido (Ctrl+← também), Alt+→ e ⌘+→ — o Avançar —
// o marcavam como lido, e Alt+↑ e ⌘+↑ o pulavam: um atalho do navegador virava
// uma decisão no Waze. Na foto ampliada eles trocavam de foto (e com o ↓ a
// fechavam), no mapa ampliado o moviam, e nas abas dos Filtros trocavam de aba.
//
// O `handleKeyDown` e o `setupFilterTabs` de VERDADE, fatiados do app.js, com a
// regra de verdade (`atalhoDoNavegador`) e o documento de mentira. Cada tecla
// mede as duas coisas: o app ficou com ela (`preventDefault`, e aí o navegador
// não faz o dele)? e o app fez alguma coisa com ela?
//
// O que só o navegador responde — o `defaultPrevented` que o navegador vê e o
// pedido que não sai pro Waze — foi medido com os roteiros do lote 9 da
// auditoria, no Chromium e no WebKit. O Voltar em si não se mede em headless:
// o atalho é do navegador, fora da página.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentario = (txt) => txt.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const SEM = semComentario(APP);

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = SEM.indexOf('(', m.index);
  for (let j = i; j < SEM.length; j++) {
    if (SEM[j] === '(') par++;
    else if (SEM[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  let prof = 0;
  for (let j = SEM.indexOf('{', i); j < SEM.length; j++) {
    if (SEM[j] === '{') prof++;
    else if (SEM[j] === '}' && --prof === 0) {
      const corpo = SEM.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
// Declaração de topo `const NOME = …;`, inclusive a que atravessa linhas.
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = [\\s\\S]*?;\\n', 'm').exec(SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
}

const MODIFICADORES = [['Alt', 'altKey'], ['⌘', 'metaKey'], ['Ctrl', 'ctrlKey']];
const SETAS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

// O teclado do app. `camada`: null (a tela do card), 'foto', 'mapa' ou 'modal';
// `escala`: o zoom da foto; `travado`: o card esperando (`acoesTravadas`).
function montar({ camada = null, escala = 1, travado = false } = {}) {
  const log = [];
  const doc = { activeElement: null, getElementById: (id) => ({ id }) };
  const deps = {
    document: doc,
    window: { triggerSwipe: (dir) => log.push('decidiu:' + dir) },
    AppState: { currentPlace: { updateRequestID: 'uA' }, pendingAction: null },
    MapaLightbox: { isOpen: () => camada === 'mapa', close: () => log.push('mapa:fechou'),
      zoom: (d) => log.push('mapa:zoom' + d), arrastar: (dx, dy) => log.push(`mapa:anda ${dx},${dy}`) },
    Lightbox: { isOpen: () => camada === 'foto', scale: escala, prev: () => log.push('foto:anterior'),
      next: () => log.push('foto:proxima'), panBy: (dx, dy) => log.push(`foto:anda ${dx},${dy}`),
      zoomPeloTeclado: (s) => log.push('foto:zoom' + s) },
    topOpenModal: () => (camada === 'modal' ? { id: 'filtersModal' } : null),
    trapTabInModal: () => log.push('tab'), closeModal: () => log.push('modal:fechou'),
    recuarNaFoto: () => log.push('foto:recuou'),
    desfazerPeloTeclado: () => { log.push('desfez'); return true; },
    acoesTravadas: () => travado, avisarTravaAoTocar: () => log.push('aviso-da-trava'),
    agirNoPedidoDoGesto: () => {}, pedidoDoCard: () => null,
    handleReject: () => log.push('rejeitou'), handleMarkAsRead: () => log.push('leu'), handleSkip: () => log.push('pulou'),
  };
  const fonte = [constante('TECLAS_DE_CURSOR'), fatiar('focoEmCampoDeTexto'), constante('AREAS_DO_CARD_QUE_ROLAM'),
    fatiar('focoEmAreaQueRola'), fatiar('atalhoDoNavegador'), constante('TECLAS_DOS_ATALHOS_DO_NAVEGADOR'),
    constante('SETAS_QUE_ANDAM'), fatiar('handleKeyDown'), 'return handleKeyDown;'].join('\n');
  const handle = new Function(...Object.keys(deps), fonte)(...Object.values(deps));
  // Um elemento com foco: `closest` responde como o do navegador pra lista de classes dele.
  const focar = (classes, tagName = 'DIV') => {
    doc.activeElement = { tagName, classList: classes,
      closest: (sel) => (sel.split(',').some((s) => classes.includes(s.trim().replace(/^\./, ''))) ? doc.activeElement : null) };
  };
  const tecla = (key, mods = {}) => {
    const e = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
      preventDefault() { this.parou = true; } };
    handle(e);
    return { presa: !!e.parou, fez: log.splice(0) };
  };
  return { tecla, focar, log };
}

test('atalhos: na tela do card, Alt, ⌘ e Ctrl com as setas são do navegador — não decidem o pedido, nem com o card travado', () => {
  for (const travado of [false, true]) {
    for (const [nome, mod] of MODIFICADORES) {
      for (const k of SETAS) {
        const r = montar({ travado }).tecla(k, { [mod]: true });
        const rot = `${nome}+${k}${travado ? ' (card travado)' : ''}`;
        assert.deepEqual(r.fez, [], `${rot} agiu no pedido (${r.fez.join(', ')}) — o Voltar/Avançar do navegador virou decisão no Waze`);
        assert.equal(r.presa, false, `${rot} ficou com o app (preventDefault): o navegador não faz o atalho dele`);
      }
    }
  }
  // CONTROLE: a seta sozinha decide (✕ ↑ ✓) e fica com o app — e o Shift
  // sozinho não é atalho do navegador. Sem isto, "não decidiu" passaria com o
  // teclado morto no card inteiro.
  for (const [k, dir] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up']]) {
    for (const mods of [{}, { shiftKey: true }]) {
      const r = montar().tecla(k, mods);
      assert.deepEqual(r.fez, ['decidiu:' + dir], `CONTROLE: ${mods.shiftKey ? 'Shift+' : ''}${k} deixou de decidir no card`);
      assert.equal(r.presa, true);
    }
  }
  // CONTROLE: com o card travado, a seta sozinha responde com o porquê (C14).
  assert.deepEqual(montar({ travado: true }).tecla('ArrowLeft').fez, ['aviso-da-trava'],
    'CONTROLE: a seta no card travado deixou de responder com o aviso');
});

test('atalhos: CONTROLE — Ctrl/⌘+Z segue desfazendo (é do app), na tela do card, na foto e no mapa', () => {
  for (const camada of [null, 'foto', 'mapa']) {
    for (const [nome, mods] of [['z', {}], ['Ctrl+Z', { ctrlKey: true }], ['⌘+Z', { metaKey: true }]]) {
      const r = montar({ camada }).tecla('z', mods);
      const onde = camada || 'card';
      assert.deepEqual(r.fez, ['desfez'], `${onde}: ${nome} deixou de desfazer — o Desfazer do app virou atalho do navegador`);
      assert.equal(r.presa, true, `${onde}: ${nome} desfez sem ficar com a tecla`);
    }
  }
});

test('atalhos: na foto ampliada, Alt, ⌘ e Ctrl com as setas não trocam de foto, não a fecham e não andam', () => {
  for (const escala of [1, 1.44]) {
    for (const [nome, mod] of MODIFICADORES) {
      for (const k of SETAS) {
        const r = montar({ camada: 'foto', escala }).tecla(k, { [mod]: true });
        const rot = `foto a ${escala}×: ${nome}+${k}`;
        assert.deepEqual(r.fez, [], `${rot} mexeu na foto (${r.fez.join(', ')})`);
        assert.equal(r.presa, false, `${rot} ficou com o app`);
      }
    }
  }
  // CONTROLE: sem modificador, em 1× ← → trocam de foto e ↓ é o passo pra
  // trás; ampliada, as setas andam (R5-3-06). E o Shift sozinho segue do app.
  const um = montar({ camada: 'foto' });
  assert.deepEqual(['ArrowLeft', 'ArrowRight', 'ArrowDown'].map((k) => um.tecla(k).fez[0]),
    ['foto:anterior', 'foto:proxima', 'foto:recuou'], 'CONTROLE: em 1× as setas da foto pararam');
  assert.deepEqual(um.tecla('ArrowRight', { shiftKey: true }).fez, ['foto:proxima'], 'CONTROLE: Shift+→ deixou de trocar de foto');
  assert.deepEqual(montar({ camada: 'foto', escala: 1.44 }).tecla('ArrowRight').fez, ['foto:anda -80,0'],
    'CONTROLE: ampliada, a seta deixou de andar pela foto');
});

test('atalhos: no mapa ampliado, Alt, ⌘ e Ctrl com as setas não movem o mapa', () => {
  for (const [nome, mod] of MODIFICADORES) {
    for (const k of SETAS) {
      const r = montar({ camada: 'mapa' }).tecla(k, { [mod]: true });
      assert.deepEqual(r.fez, [], `mapa: ${nome}+${k} moveu o mapa (${r.fez.join(', ')})`);
      assert.equal(r.presa, false, `mapa: ${nome}+${k} ficou com o app`);
    }
  }
  // CONTROLE: sem modificador as quatro setas andam (L13).
  const m = montar({ camada: 'mapa' });
  assert.deepEqual(SETAS.map((k) => m.tecla(k).fez[0]),
    ['mapa:anda 80,0', 'mapa:anda -80,0', 'mapa:anda 0,80', 'mapa:anda 0,-80'], 'CONTROLE: as setas do mapa pararam');
});

test('atalhos: na área do card que rola, as setas seguem da rolagem — com e sem Alt e ⌘', () => {
  // As setas da lista de mudanças e do texto do reporte ROLAM (C7): nunca
  // decidem e nunca ficam com o app (sem `preventDefault` é o navegador que rola).
  for (const area of ['card-changes-list', 'card-flag-comment-text']) {
    for (const mods of [{}, { altKey: true }, { metaKey: true }, { shiftKey: true }]) {
      for (const k of SETAS) {
        const t = montar();
        t.focar([area]);
        const r = t.tecla(k, mods);
        const rot = `${area}: ${Object.keys(mods)[0] || 'sem modificador'} + ${k}`;
        assert.deepEqual(r.fez, [], `${rot} decidiu o pedido (${r.fez.join(', ')})`);
        assert.equal(r.presa, false, `${rot} ficou com o app — a lista não rola`);
      }
    }
  }
});

// As abas dos Filtros (Filtros | Preferências | Histórico) andam com ← → Home e
// End (o padrão das abas WAI-ARIA). MEDIDO: Alt+→ e ⌘+→ — o Avançar — trocavam
// de aba, com a tecla presa.
function montarAbas() {
  const log = [];
  const doc = { activeElement: null };
  const botoes = {};
  for (const id of ['filtersTabFilters', 'filtersTabPrefs', 'filtersTabHistory']) {
    botoes[id] = { id, ouvintes: {}, addEventListener(tipo, fn) { this.ouvintes[tipo] = fn; },
      focus() { doc.activeElement = this; } };
  }
  doc.getElementById = (id) => botoes[id] || null;
  const deps = { document: doc, switchFilterTab: (id) => log.push('aba:' + id) };
  const fonte = [constante('FILTER_TABS'), fatiar('atalhoDoNavegador'), fatiar('setupFilterTabs'), 'setupFilterTabs();'].join('\n');
  new Function(...Object.keys(deps), fonte)(...Object.values(deps));
  const tecla = (id, key, mods = {}) => {
    doc.activeElement = botoes[id];
    const e = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
      preventDefault() { this.parou = true; } };
    assert.ok(botoes[id].ouvintes.keydown, `PRÉ-CONDIÇÃO: a aba ${id} não tem ouvinte de teclado`);
    botoes[id].ouvintes.keydown(e);
    return { presa: !!e.parou, fez: log.splice(0), foco: doc.activeElement && doc.activeElement.id };
  };
  return { tecla };
}

test('atalhos: nas abas dos Filtros, Alt, ⌘ e Ctrl com as setas, Home e End não trocam de aba', () => {
  for (const [nome, mod] of MODIFICADORES) {
    for (const k of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      const r = montarAbas().tecla('filtersTabPrefs', k, { [mod]: true });
      assert.deepEqual(r.fez, [], `abas: ${nome}+${k} trocou de aba (${r.fez.join(', ')})`);
      assert.equal(r.presa, false, `abas: ${nome}+${k} ficou com o app`);
      assert.equal(r.foco, 'filtersTabPrefs', `abas: ${nome}+${k} tirou o foco da aba`);
    }
  }
  // CONTROLE: sem modificador (e com o Shift sozinho), as setas, Home e End trocam de aba.
  const a = montarAbas();
  for (const [k, mods, alvo] of [['ArrowRight', {}, 'filtersTabHistory'], ['ArrowLeft', {}, 'filtersTabFilters'],
    ['End', {}, 'filtersTabHistory'], ['Home', {}, 'filtersTabFilters'], ['ArrowRight', { shiftKey: true }, 'filtersTabHistory']]) {
    const r = a.tecla('filtersTabPrefs', k, mods);
    assert.deepEqual(r.fez, ['aba:' + alvo], `CONTROLE: ${mods.shiftKey ? 'Shift+' : ''}${k} deixou de trocar de aba`);
    assert.equal(r.presa, true);
    assert.equal(r.foco, alvo, `CONTROLE: ${k} trocou de aba sem levar o foco`);
  }
});

test('atalhos: a guarda é a PRIMEIRA instrução do handleKeyDown, e a regra mora numa função só', () => {
  // Primeira instrução: nenhum ramo do teclado (o de hoje ou um novo) vê o atalho.
  const corpo = fatiar('handleKeyDown').split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  assert.equal(corpo[0], 'if (atalhoDoNavegador(e) && TECLAS_DOS_ATALHOS_DO_NAVEGADOR.includes(e.key)) return;',
    'a guarda dos atalhos do navegador deixou de ser a primeira instrução do handleKeyDown');
  assert.match(SEM, /btn\.addEventListener\('keydown', \(e\) => \{\s*if \(atalhoDoNavegador\(e\)\) return;/,
    'a lista de abas dos Filtros deixou de começar pela guarda dos atalhos do navegador');
  // Fonte única: `ctrlKey`, `metaKey` e `altKey` só na `atalhoDoNavegador`, em
  // TODO o js/ (fora o js/min/, que é gerado). Cópia da regra é como a correção
  // chega num lugar e não no outro.
  const regra = fatiar('atalhoDoNavegador');
  const MOD = /\b(ctrlKey|metaKey|altKey)\b/g;
  assert.equal((regra.match(MOD) || []).length, 3, 'PRÉ-CONDIÇÃO: a regra não lê os três modificadores');
  const fora = [];
  for (const arq of readdirSync(new URL('../js/', import.meta.url)).filter((f) => f.endsWith('.js'))) {
    let txt = semComentario(readFileSync(new URL('../js/' + arq, import.meta.url), 'utf8'));
    if (arq === 'app.js') txt = txt.replace(regra, '');
    for (const m of txt.matchAll(MOD)) fora.push(`${arq}: ${m[0]}`);
  }
  assert.deepEqual(fora, [], 'a regra dos atalhos do navegador foi copiada fora da `atalhoDoNavegador`');
});
