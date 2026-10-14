// Lote 23, rodada 19 da auditoria — fila, contas, abas e telas.
//
// R19-2-01  tecla segurada decide pedidos em série
// R19-1-01  o `finally` da sessão que SAIU não mexe no estado da sessão nova
// R19-1-02  os códigos de pareamento emitidos sobrevivem à recarga (o "Sair" os cancela)
// R19-1-03  bfcache: a aba restaurada relê o aparelho
// R19-2-02  a recusa automática de duas abas abrindo juntas manda uma vez só
// R19-2-03  "Rejeitar os N" cancelado pelo segundo plano avisa
// R19-7-02  o QR do Resumo tem teto
//
// Os testes FATIAM o código de verdade do js/app.js (como os r14 a r18) e
// ignoram comentário (gotcha #67). O que só o navegador responde — a tecla
// segurada de verdade — mora num bloco do tools/smoke-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
const semComentario = (txt) => txt.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const SEM = semComentario(APP);

function fatiar(nome, fonte = SEM) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  let prof = 0;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    if (fonte[j] === '{') prof++;
    else if (fonte[j] === '}' && --prof === 0) {
      const corpo = fonte.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
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

// ───────────────────────── R19-2-01: tecla segurada ─────────────────────────

function teclado({ camada = null, travado = false } = {}) {
  const log = [];
  const doc = { activeElement: null, getElementById: (id) => ({ id }) };
  const deps = {
    document: doc,
    window: { triggerSwipe: (dir) => log.push('decidiu:' + dir) },
    AppState: { currentPlace: { updateRequestID: 'uA' }, pendingAction: null },
    MapaLightbox: { isOpen: () => camada === 'mapa', close() {}, zoom() {}, arrastar: (dx, dy) => log.push(`mapa:anda ${dx},${dy}`) },
    Lightbox: { isOpen: () => camada === 'foto', ampliada: () => false, prev: () => log.push('foto:anterior'),
      next: () => log.push('foto:proxima'), panBy() {}, zoomPeloTeclado() {} },
    topOpenModal: () => (camada === 'modal' ? { id: 'filtersModal' } : null),
    trapTabInModal() {}, closeModal() {}, recuarNaFoto() {},
    desfazerPeloTeclado: () => { log.push('desfez'); return true; },
    acoesTravadas: () => travado, avisarTravaAoTocar: () => log.push('aviso-da-trava'),
    agirNoPedidoDoGesto: () => {}, pedidoDoCard: () => null,
    handleReject() {}, handleMarkAsRead() {}, handleSkip() {},
    prometerFocoDaSeta: () => log.push('prometeu-foco'),
  };
  const fonte = [constante('TECLAS_DE_CURSOR'), fatiar('focoEmCampoDeTexto'), constante('AREAS_DO_CARD_QUE_ROLAM'),
    fatiar('focoEmAreaQueRola'), fatiar('atalhoDoNavegador'), fatiar('teclaDeComposicao'),
    constante('TECLAS_DOS_ATALHOS_DO_NAVEGADOR'), constante('SETAS_QUE_ANDAM'), fatiar('handleKeyDown'),
    'return handleKeyDown;'].join('\n');
  const handle = new Function(...Object.keys(deps), fonte)(...Object.values(deps));
  const focar = (classes) => {
    doc.activeElement = { tagName: 'DIV', classList: classes,
      closest: (sel) => (sel.split(',').some((s) => classes.includes(s.trim().replace(/^\./, ''))) ? doc.activeElement : null) };
  };
  const tecla = (key, mods = {}) => {
    const e = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...mods,
      preventDefault() { this.parou = true; } };
    handle(e);
    return { presa: !!e.parou, fez: log.splice(0).filter((x) => x !== 'prometeu-foco') };
  };
  return { tecla, focar };
}

test('R19-2-01: a seta SEGURADA decide uma vez só — a repetição fica com o app e não decide nem avisa', () => {
  for (const [k, dir] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up']]) {
    const t = teclado();
    // CONTROLE: o primeiro keydown (sem repeat) decide. Sem isto, "a repetição não
    // decidiu" passaria com o teclado morto.
    assert.deepEqual(t.tecla(k).fez, ['decidiu:' + dir], `CONTROLE: ${k} sem repeat deixou de decidir`);
    for (let i = 0; i < 5; i++) {
      const r = t.tecla(k, { repeat: true });
      assert.deepEqual(r.fez, [], `${k} segurada decidiu de novo (${r.fez.join(', ')}) — rejeitar não volta`);
      assert.equal(r.presa, true, `${k} segurada ficou sem preventDefault: o navegador rolaria a página`);
    }
  }
});

test('R19-2-01: a repetição também não repete o aviso da trava', () => {
  const t = teclado({ travado: true });
  assert.deepEqual(t.tecla('ArrowLeft').fez, ['aviso-da-trava'], 'CONTROLE: a seta no card travado deixou de avisar');
  assert.deepEqual(t.tecla('ArrowLeft', { repeat: true }).fez, [], 'a seta segurada repetiu o aviso da trava');
});

test('R19-2-01: onde segurar a seta é rolar ou andar, a repetição segue valendo', () => {
  // Área do card que rola: a seta é da rolagem (sem preventDefault, quem rola é o navegador).
  for (const area of ['card-changes-list', 'card-flag-comment-text']) {
    const t = teclado();
    t.focar([area]);
    const r = t.tecla('ArrowDown', { repeat: true });
    assert.equal(r.presa, false, `${area}: a seta segurada deixou de rolar a lista`);
  }
  // Mapa ampliado: segurar a seta anda.
  const m = teclado({ camada: 'mapa' });
  assert.deepEqual(m.tecla('ArrowLeft', { repeat: true }).fez, ['mapa:anda 80,0'], 'mapa: a seta segurada parou de andar');
  // Foto em 1×: ← → trocam de foto, e segurar percorre o carrossel.
  const f = teclado({ camada: 'foto' });
  assert.deepEqual(f.tecla('ArrowRight', { repeat: true }).fez, ['foto:proxima'], 'foto: a seta segurada parou de trocar de foto');
});

test('R19-2-01: o Enter e o Espaço SEGURADOS num dos três botões não geram novo clique', () => {
  const fonte = fatiar('renderCurrentCard');
  // Estrutura: um ouvinte de keydown pros três botões, que só age com `repeat` e cancela a tecla.
  const m = /for \(const cls of \['\.card-btn-reject', '\.card-btn-skip', '\.card-btn-read'\]\) \{\s*card\.querySelector\(cls\)\.addEventListener\('keydown', \(ev\) => \{\s*if \(ev\.repeat && \(ev\.key === 'Enter' \|\| ev\.key === ' '\)\) ev\.preventDefault\(\);/.exec(fonte);
  assert.ok(m, 'os botões ✕ ↑ ✓ deixaram de cancelar o Enter/Espaço repetido (o click sintético decide em série)');
  // E vem ANTES de os `click` serem ligados no mesmo card.
  assert.ok(fonte.indexOf(m[0]) < fonte.indexOf("addEventListener('click', (ev) => fireAction('left'"), 'o cancelamento da repetição tem de existir no card que liga os clicks');
});
