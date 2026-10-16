// R21-6-05 · o atalho do Desfazer (o z) fora do layout latino.
//
// `e.key === 'z'` só vale no teclado latino: com o layout hebraico ou o russo ativo, a tecla física do Z
// entrega `key` "ז" / "я" (e `code` "KeyZ"), e o "z desfaz" que a Ajuda promete (`help.howToUse.step5`)
// não acontecia — nem o Ctrl+Z. O servidor `il` (hebraico) existe. Hoje os TRÊS lugares onde o teclado
// desfaz (o mapa ampliado, a foto ampliada e a tela do card) perguntam à MESMA função, `teclaDoDesfazer`:
// o `key` "z"/"Z" de sempre, e a tecla física do Z (`code` "KeyZ") quando o `key` é UMA letra de outro
// alfabeto. O que NÃO desfaz está medido aqui como CONTROLE: o AZERTY (o w físico é letra latina), o
// Dvorak (a tecla física do Z imprime ";"), a tecla morta, o IME, o `key` sem valor e o campo de texto.
//
// Duas camadas, como no resto da suíte: a função com eventos sintéticos, e o `handleKeyDown` de VERDADE
// (fatiado do app.js) com as camadas de mentira. O que só o navegador responde — o `keydown` despachado
// com a janela do Desfazer aberta, nos dois motores — foi medido com o roteiro `tecla-z` da rodada 21.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} caracteres — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
function constante(nome) {
  const m = new RegExp('^const ' + nome + ' = [\\s\\S]*?;\\n', 'm').exec(SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
}

// ═══ A função ═══════════════════════════════════════════════════════════════════
const teclaDoDesfazer = new Function(fatiar('teclaDeComposicao') + '\n' + fatiar('teclaDoDesfazer') + '\nreturn teclaDoDesfazer;')();

// Cada linha: [rótulo, evento]. O `code` é o da tecla FÍSICA; o `key`, o que o layout ativo imprime nela.
const DESFAZEM = [
  ['latino: o z', { key: 'z', code: 'KeyZ' }],
  ['latino: o Z maiúsculo (Shift)', { key: 'Z', code: 'KeyZ', shiftKey: true }],
  ['QWERTZ: o z impresso fica na tecla física do Y', { key: 'z', code: 'KeyY' }],
  ['AZERTY: o z impresso fica na tecla física do W', { key: 'z', code: 'KeyW' }],
  ['hebraico (zayin)', { key: 'ז', code: 'KeyZ' }],
  ['russo, minúscula', { key: 'я', code: 'KeyZ' }],
  ['russo, maiúscula (Shift ou CapsLock)', { key: 'Я', code: 'KeyZ' }],
  ['grego (zeta)', { key: 'ζ', code: 'KeyZ' }],
  ['árabe', { key: 'ئ', code: 'KeyZ' }],
  ['coreano (hangul)', { key: 'ㅋ', code: 'KeyZ' }],
  ['japonês (kana)', { key: 'つ', code: 'KeyZ' }],
  ['tailandês', { key: 'ผ', code: 'KeyZ' }],
  // O modificador não é da função (é da `atalhoDoNavegador`): o Ctrl/⌘+Z do app segue valendo no layout do idioma.
  ['Ctrl+Z no hebraico', { key: 'ז', code: 'KeyZ', ctrlKey: true }],
  ['⌘+Z no russo', { key: 'я', code: 'KeyZ', metaKey: true }],
];
const NAO_DESFAZEM = [
  ['AZERTY: o w físico é letra LATINA (quem quer o z aperta a tecla que diz z)', { key: 'w', code: 'KeyZ' }],
  ['QWERTZ: o y que está na tecla física do Z', { key: 'y', code: 'KeyZ' }],
  ['Dvorak: a tecla física do Z imprime ponto e vírgula', { key: ';', code: 'KeyZ' }],
  ['pontuação ou dígito na tecla física do Z', { key: '1', code: 'KeyZ' }],
  ['letra latina com acento (AltGr+Z no polonês)', { key: 'ż', code: 'KeyZ' }],
  ['letra latina estendida', { key: 'ž', code: 'KeyZ' }],
  ['tecla morta', { key: 'Dead', code: 'KeyZ' }],
  ['IME do Windows (key "Process", keyCode 229)', { key: 'Process', code: 'KeyZ', keyCode: 229 }],
  ['IME compondo, com letra de outro alfabeto', { key: 'ז', code: 'KeyZ', isComposing: true }],
  ['IME do Safari (keyCode 229, isComposing falso)', { key: 'ז', code: 'KeyZ', keyCode: 229, isComposing: false }],
  ['IME compondo, com o z latino', { key: 'z', code: 'KeyZ', isComposing: true }],
  ['sem valor', { key: 'Unidentified', code: 'KeyZ' }],
  ['key vazio', { key: '', code: 'KeyZ' }],
  ['sem key', { code: 'KeyZ' }],
  ['key que não é texto', { key: 122, code: 'KeyZ' }],
  ['DUAS letras no key', { key: 'זז', code: 'KeyZ' }],
  ['a letra de outro alfabeto numa OUTRA tecla física', { key: 'ז', code: 'KeyX' }],
  ['a letra de outro alfabeto sem code', { key: 'ז' }],
  ['o russo na tecla do 1', { key: 'я', code: 'Digit1' }],
  ['outra tecla qualquer', { key: 'x', code: 'KeyX' }],
  ['Enter', { key: 'Enter', code: 'Enter' }],
  ['Escape', { key: 'Escape', code: 'Escape' }],
];

test('R21-6-05: a tecla do Desfazer — o z latino de sempre e a tecla FÍSICA do Z nos alfabetos que não são o latino', () => {
  for (const [rotulo, ev] of DESFAZEM) {
    assert.equal(teclaDoDesfazer(ev), true, `DEFEITO: ${rotulo} (${JSON.stringify(ev)}) não desfaz`);
  }
});

test('R21-6-05: CONTROLES — AZERTY, Dvorak, tecla morta, IME, sem valor e a letra noutra tecla NÃO desfazem', () => {
  for (const [rotulo, ev] of NAO_DESFAZEM) {
    assert.equal(teclaDoDesfazer(ev), false, `${rotulo} (${JSON.stringify(ev)}) desfez`);
  }
  assert.equal(teclaDoDesfazer(null), false);
  assert.equal(teclaDoDesfazer(undefined), false);
  assert.equal(teclaDoDesfazer({}), false);
});

// ═══ O teclado de verdade: as três camadas ═════════════════════════════════════
// A camada de CIMA: null (a tela do card), 'foto', 'mapa' ou 'modal'. `campo`: o foco num campo de texto.
function montar({ camada = null, campo = false } = {}) {
  const log = [];
  const doc = { activeElement: campo ? { tagName: 'INPUT', type: 'text', isContentEditable: false, classList: [], closest: () => null } : null,
    getElementById: (id) => ({ id }) };
  const deps = {
    document: doc,
    window: { triggerSwipe: (dir) => log.push('decidiu:' + dir) },
    AppState: { currentPlace: { updateRequestID: 'uA' }, pendingAction: null },
    MapaLightbox: { isOpen: () => camada === 'mapa', close: () => log.push('mapa:fechou'),
      zoom: (d) => log.push('mapa:zoom' + d), arrastar: (dx, dy) => log.push(`mapa:anda ${dx},${dy}`) },
    Lightbox: { isOpen: () => camada === 'foto', ampliada: () => false, prev: () => log.push('foto:anterior'),
      next: () => log.push('foto:proxima'), panBy: () => {}, zoomPeloTeclado: () => {} },
    topOpenModal: () => (camada === 'modal' ? { id: 'pairModal' } : null),
    trapTabInModal: () => log.push('tab'), closeModal: () => log.push('modal:fechou'),
    recuarNaFoto: () => log.push('foto:recuou'),
    desfazerPeloTeclado: () => { log.push('desfez'); return true; },
    acoesTravadas: () => false, avisarTravaAoTocar: () => log.push('aviso-da-trava'),
    agirNoPedidoDoGesto: () => {}, pedidoDoCard: () => null,
    handleReject: () => log.push('rejeitou'), handleMarkAsRead: () => log.push('leu'), handleSkip: () => log.push('pulou'),
    prometerFocoDaSeta: () => {},
  };
  const fonte = [constante('TECLAS_DE_CURSOR'), fatiar('focoEmCampoDeTexto'), constante('AREAS_DO_CARD_QUE_ROLAM'),
    fatiar('focoEmAreaQueRola'), fatiar('atalhoDoNavegador'), fatiar('teclaDeComposicao'), fatiar('teclaDoDesfazer'),
    constante('TECLAS_DOS_ATALHOS_DO_NAVEGADOR'), constante('SETAS_QUE_ANDAM'), fatiar('handleKeyDown'), 'return handleKeyDown;'].join('\n');
  const handle = new Function(...Object.keys(deps), fonte)(...Object.values(deps));
  const tecla = (ev) => {
    const e = { key: undefined, code: undefined, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...ev,
      preventDefault() { this.parou = true; } };
    handle(e);
    return { presa: !!e.parou, fez: log.splice(0) };
  };
  return { tecla };
}
const CAMADAS = [[null, 'tela do card'], ['foto', 'foto ampliada'], ['mapa', 'mapa ampliado']];

test('R21-6-05: no card, na foto ampliada e no mapa ampliado o hebraico, o russo e o grego desfazem — e ficam com a tecla', () => {
  for (const [camada, onde] of CAMADAS) {
    for (const [rotulo, ev] of DESFAZEM) {
      const r = montar({ camada }).tecla(ev);
      assert.deepEqual(r.fez, ['desfez'], `DEFEITO (${onde}): ${rotulo} não chegou ao Desfazer (${r.fez.join(', ') || 'nada'})`);
      assert.equal(r.presa, true, `${onde}: ${rotulo} desfez sem ficar com a tecla (o navegador faria o dele por cima)`);
    }
  }
});

test('R21-6-05: CONTROLES nas três camadas — AZERTY, Dvorak, tecla morta, IME e sem valor não desfazem nem mexem em nada', () => {
  for (const [camada, onde] of CAMADAS) {
    for (const [rotulo, ev] of NAO_DESFAZEM) {
      const r = montar({ camada }).tecla(ev);
      // Enter e Escape são de outros ramos (o Esc fecha a foto/o mapa): só interessa que NENHUM deles desfez.
      assert.ok(!r.fez.includes('desfez'), `${onde}: ${rotulo} desfez`);
      if (!['Enter', 'Escape'].includes(ev.key)) assert.deepEqual(r.fez, [], `${onde}: ${rotulo} fez algo (${r.fez.join(', ')})`);
    }
  }
});

test('R21-6-05: com o foco num campo de texto (o nome do local, o código de pareamento, a conversa) o z de OUTRO alfabeto é uma LETRA — não desfaz', () => {
  for (const [camada, onde] of [...CAMADAS, ['modal', 'diálogo aberto']]) {
    for (const ev of [{ key: 'ז', code: 'KeyZ' }, { key: 'я', code: 'KeyZ' }, { key: 'ז', code: 'KeyZ', ctrlKey: true }]) {
      const r = montar({ camada, campo: true }).tecla(ev);
      assert.ok(!r.fez.includes('desfez'), `DEFEITO (${onde}): a letra ${ev.key}${ev.ctrlKey ? ' com Ctrl' : ''} digitada num campo desfez a decisão`);
    }
  }
  // CONTROLE: o mesmo evento, sem campo, desfaz (o instrumento enxerga o desfazer). O diálogo aberto
  // fica de fora de propósito: com ele aberto o card de trás não decide nada (a mesma regra do z latino).
  for (const [camada, onde] of CAMADAS) {
    assert.deepEqual(montar({ camada }).tecla({ key: 'ז', code: 'KeyZ' }).fez, ['desfez'], `CONTROLE (${onde}): sem campo focado o z não desfez`);
  }
  assert.deepEqual(montar({ camada: 'modal' }).tecla({ key: 'z', code: 'KeyZ' }).fez, [], 'CONTROLE: com o diálogo aberto nem o z latino desfaz (o ramo do modal retorna antes)');
});

test('R21-6-05: a tecla do IME e a composição nunca desfazem — nem sem campo de texto, nem com o z latino', () => {
  for (const [camada, onde] of CAMADAS) {
    for (const ev of [{ key: 'Process', code: 'KeyZ', keyCode: 229 }, { key: 'ז', code: 'KeyZ', isComposing: true }, { key: 'z', code: 'KeyZ', isComposing: true },
      { key: 'ז', code: 'KeyZ', keyCode: 229 }]) {
      assert.deepEqual(montar({ camada }).tecla(ev).fez, [], `${onde}: ${JSON.stringify(ev)} desfez no meio da composição`);
    }
  }
});

test('R21-6-05: o Tab segue preso nas camadas (a função nova não engoliu o ramo que vem depois dela)', () => {
  for (const camada of ['foto', 'mapa']) {
    assert.deepEqual(montar({ camada }).tecla({ key: 'Tab', code: 'Tab' }).fez, ['tab'], `${camada}: o Tab deixou de entrar na volta da camada`);
  }
});

test('R21-6-05 (estrutura): os TRÊS lugares perguntam à teclaDoDesfazer, nenhum compara `key` com z, e só ela lê o `code` KeyZ', () => {
  const teclado = fatiar('handleKeyDown');
  assert.equal((teclado.match(/\bteclaDoDesfazer\(e\)/g) || []).length, 3, 'o handleKeyDown tem que perguntar à teclaDoDesfazer nos três lugares (mapa, foto, card)');
  assert.match(teclado, /MapaLightbox\.isOpen\(\)[\s\S]*?else if \(teclaDoDesfazer\(e\) && !focoEmCampoDeTexto\(\)\)[\s\S]*?if \(Lightbox\.isOpen\(\)\)[\s\S]*?else if \(teclaDoDesfazer\(e\) && !focoEmCampoDeTexto\(\)\)/,
    'o mapa e a foto ampliada tem que perguntar à teclaDoDesfazer SEM o campo de texto focado');
  assert.match(teclado, /if \(teclaDoDesfazer\(e\) && desfazerPeloTeclado\(\)\) \{/, 'a tela do card perguntava à teclaDoDesfazer e deixou de perguntar');
  // Nenhuma comparação do `key` com z no resto do app (nem a cópia da regra velha).
  const velhas = [...SEM.matchAll(/\.key\s*===?\s*['"][zZ]['"]/g)];
  assert.equal(velhas.length, 0, 'alguém compara o `key` com "z"/"Z" por conta própria — é a regra velha voltando (a comparação mora na teclaDoDesfazer)');
  assert.match(fatiar('teclaDoDesfazer'), /tecla === 'z' \|\| tecla === 'Z'/, 'PRÉ-CONDIÇÃO: a comparação com o z mora na teclaDoDesfazer');
  const kz = [...SEM.matchAll(/['"]KeyZ['"]/g)].length;
  assert.equal(kz, 1, 'o `code` KeyZ aparece em mais de um lugar do app');
  assert.match(fatiar('teclaDoDesfazer'), /e\.code === 'KeyZ'/, 'PRÉ-CONDIÇÃO: o KeyZ mora na teclaDoDesfazer');
  // A função respeita a composição: ela mesma pergunta à `teclaDeComposicao` (não depende de o handleKeyDown cortar antes).
  assert.match(fatiar('teclaDoDesfazer'), /teclaDeComposicao\(e\)/, 'a teclaDoDesfazer deixou de respeitar a composição do IME');
});
