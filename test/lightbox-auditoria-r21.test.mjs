// Lote 25, rodada 21 da auditoria — a foto ampliada: o clique do fundo e o nome do local.
//
// R21-3-03  o `click` do fundo da foto ampliada depois de um ARRASTO não fecha a camada
// R21-3-04  tirar o espaço sobrando nas pontas do nome é uma renomeação (o ✓ e o Enter pela MESMA pergunta), e o
//           Desfazer devolve o nome CRU
// (As escritas e a vez do local, R21-3-01/02, estão em test/fotos-auditoria-r21.test.mjs.)
//
// Os testes FATIAM o código de verdade do js/app.js (como os r14 a r20), ignoram comentário (gotcha #67) e rodam as
// funções DE VERDADE contra um navegador de mentira. O clique pós-arrasto com o mouse de verdade (nos dois motores) mora
// no tools/smoke-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
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
  const m = new RegExp('^const ' + nome + ' = [^\\n]*;$', 'm').exec(SEM);
  assert.ok(m, `a constante ${nome} sumiu do app.js`);
  return m[0];
}

// O que o teste não fornece vira um "buraco negro" (o molde do test/fila-auditoria-r20.test.mjs).
function buracoNegro(nome, chamou) {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro(nome + '.' + k, chamou)),
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}
function montar(nomes, deps, extra = '') {
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      return typeof k === 'string' ? buracoNegro(k, chamou) : undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map((n) => fatiar(n)).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${extra}\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}
const tique = () => new Promise((ok) => setImmediate(ok));
async function ateQue(cond, msg, teto = 3000) {
  const fim = Date.now() + teto;
  while (!cond()) {
    if (Date.now() > fim) assert.fail('a espera estourou: ' + msg);
    await tique();
  }
}

// ═══ R21-3-03 · o clique do fundo depois de um ARRASTO ═════════════════════════════════════════════════════
// Com o mouse, descer o botão na tarja preta, mover e soltar gera um `click` na camada (os dois alvos são ela) e a foto
// FECHAVA — também no arrasto pro lado, que na foto troca. O toque do dedo não gera `click` depois de arrastar.
function camadaDaFoto() {
  const no = (id) => ({ id, ouv: {}, addEventListener(tipo, fn) { (this.ouv[tipo] = this.ouv[tipo] || []).push(fn); }, setPointerCapture() {}, closest: () => null });
  const lb = no('imageLightbox');
  const els = { imageLightbox: lb, lightboxImage: no('lightboxImage'), lightboxClose: no('lightboxClose'), lightboxPrev: no('lightboxPrev'), lightboxNext: no('lightboxNext') };
  const chamadas = [];
  const deps = {
    document: { getElementById: (id) => els[id] || null }, Lightbox: { isOpen: () => true, close() { chamadas.push('fechou'); } },
    recuarNaFoto: () => chamadas.push('recuou'), atualizarAcoesDeFoto() {}, avisarTravaAoTocar() {}, deltaDaRoda: () => 0, RODA_DENTE_PX: 100,
    performance: { now: () => 1000 },
  };
  new Function(...Object.keys(deps), ['DUPLO_TOQUE_MS', 'DUPLO_TOQUE_RAIO_PX', 'TOQUE_FOLGA_PX'].map(constante).join('\n') + '\n' + fatiar('setupLightbox') + '\nsetupLightbox();')(...Object.values(deps));
  const emitir = (tipo, ev) => { for (const fn of lb.ouv[tipo] || []) fn({ type: tipo, target: lb, pointerId: 1, isPrimary: true, preventDefault() {}, ...ev }); };
  const arrastar = (de, para, { alvoDoClique = lb, mover = true } = {}) => {
    emitir('pointerdown', { clientX: de[0], clientY: de[1] });
    if (mover) {
      emitir('pointermove', { clientX: (de[0] + para[0]) / 2, clientY: (de[1] + para[1]) / 2 });
      emitir('pointermove', { clientX: para[0], clientY: para[1] });
    }
    emitir('pointerup', { clientX: para[0], clientY: para[1] });
    emitir('click', { clientX: para[0], clientY: para[1], target: alvoDoClique });
  };
  return { lb, chamadas, emitir, arrastar, img: els.lightboxImage };
}

test('R21-3-03: o ARRASTO que começa e termina no fundo (mouse) não fecha a foto — o clique parado, sim', () => {
  const m = camadaDaFoto();
  m.arrastar([330, 120], [100, 120]);                       // o arrasto pro lado, na tarja preta
  assert.deepEqual(m.chamadas, [], 'DEFEITO: o clique que o arrasto gerou no fundo FECHOU a camada');
  m.arrastar([200, 120], [200, 280]);                       // pra baixo
  assert.deepEqual(m.chamadas, [], 'DEFEITO: o arrasto pra baixo na tarja fechou a camada pelo clique');
  m.arrastar([200, 120], [200, 120], { mover: false });     // CONTROLE: o clique simples na tarja é um passo pra trás (como desenhado)
  assert.deepEqual(m.chamadas, ['recuou'], 'CONTROLE: o clique simples na tarja deixou de fechar');
  m.arrastar([200, 120], [204, 123]);                       // CONTROLE: o tremor da mão (até a folga) é clique
  assert.deepEqual(m.chamadas, ['recuou', 'recuou'], 'CONTROLE: o tremor de uns pixels deixou de ser clique');
});

test('R21-3-03: o movimento é medido na CAMADA, de qualquer gesto — o arrasto que começa sobre a foto e o navegador devolve à camada também não fecha', () => {
  const m = camadaDaFoto();
  // O `pointerdown` da <img> sobe até a camada (o alvo é a foto), e o `click` chega com o alvo da camada.
  m.emitir('pointerdown', { target: m.img, clientX: 300, clientY: 400 });
  m.emitir('pointermove', { target: m.img, clientX: 150, clientY: 400 });
  m.emitir('pointerup', { target: m.img, clientX: 150, clientY: 400 });
  m.emitir('click', { target: m.lb, clientX: 150, clientY: 400 });
  assert.deepEqual(m.chamadas, [], 'DEFEITO: o arrasto que começou na foto fechou a camada pelo clique que o navegador entregou ao fundo');
});

test('R21-3-03: o gesto acaba com o clique — o clique SEM ponteiro (teste, leitor de tela) e o seguinte a um cancelamento fecham como sempre', () => {
  const m = camadaDaFoto();
  m.arrastar([330, 120], [100, 120]);
  assert.deepEqual(m.chamadas, []);
  m.emitir('click', { clientX: 0, clientY: 0 });             // um clique sem pointerdown antes: o do arrasto já foi consumido
  assert.deepEqual(m.chamadas, ['recuou'], 'DEFEITO: o arrasto ficou "preso" e engoliu o clique seguinte');
  // O cancelamento do sistema (a palma, a ligação) apaga o gesto: nada ficou de arrasto.
  const c = camadaDaFoto();
  c.emitir('pointerdown', { clientX: 300, clientY: 120 });
  c.emitir('pointermove', { clientX: 100, clientY: 120 });
  c.emitir('pointercancel', {});
  c.emitir('click', { clientX: 100, clientY: 120 });
  assert.deepEqual(c.chamadas, ['recuou'], 'o cancelamento deixou o arrasto preso');
  // O segundo dedo (não primário) não recomeça o gesto: o arrasto do primeiro continua sendo arrasto.
  const d = camadaDaFoto();
  d.emitir('pointerdown', { clientX: 300, clientY: 120 });
  d.emitir('pointermove', { clientX: 100, clientY: 120 });
  d.emitir('pointerdown', { pointerId: 2, isPrimary: false, clientX: 100, clientY: 120 });
  d.emitir('click', { clientX: 100, clientY: 120 });
  assert.deepEqual(d.chamadas, [], 'o segundo dedo apagou o arrasto do primeiro');
});

test('R21-3-03 (estrutura): o `click` do fundo olha o arrasto; o toque parado segue passando por `recuarNaFoto`', () => {
  const setup = fatiar('setupLightbox');
  assert.match(setup, /if \(e\.target === lb && !arrastou\) recuarNaFoto\(\);/, 'o clique do fundo não confere o arrasto');
  assert.match(setup, /lb\.addEventListener\('pointermove'/, 'a camada deixou de medir o movimento');
  assert.match(setup, /> TOQUE_FOLGA_PX\) gestoNaCamada\.arrastou = true;/, 'o arrasto deixou de ser medido pela folga do toque (a do mapa)');
  // O que NÃO se mexe: a pinça nativa. Nenhum `touch-action` novo na camada (o "zoom nunca bloqueado").
  assert.doesNotMatch(HTML.slice(HTML.indexOf('id="imageLightbox"'), HTML.indexOf('id="imageLightbox"') + 400), /touch-(none|action)/,
    'a camada ganhou um touch-action: tira a pinça nativa do navegador na tarja');
});

// ═══ R21-3-04 · tirar o espaço sobrando nas pontas do nome ══════════════════════════════════════════════
const NOMES = [
  // [nome como o Waze o tem, o que está no campo, o que seria escrito (null: nada)]
  ['Padaria Teste ', 'Padaria Teste', 'Padaria Teste'],        // tirar o espaço do FIM
  [' Padaria Teste', 'Padaria Teste', 'Padaria Teste'],        // tirar o do COMEÇO
  ['Padaria Teste  ', 'Padaria Teste', 'Padaria Teste'],       // e vários
  ['Padaria  Teste', 'Padaria Teste', 'Padaria Teste'],        // o duplo no meio (já funcionava)
  ['Padaria Teste ', 'Padaria Teste ', null],                  // CONTROLE: o campo INTOCADO nunca escreve
  [' Padaria Teste', ' Padaria Teste', null],
  ['Padaria Teste', 'Padaria Teste', null],                    // CONTROLE: o mesmo nome
  ['Padaria Teste', 'Padaria Teste ', null],                   // CONTROLE: só um espaço a mais no fim (o servidor apara: o mesmo nome)
  ['Padaria Teste', ' Padaria Teste  ', null],
  ['Padaria Teste', 'Padaria Nova ', 'Padaria Nova'],          // outro nome: vai aparado
  ['Padaria Teste ', 'Padaria Nova', 'Padaria Nova'],
  ['Padaria Teste', '', null],                                 // CONTROLE: vazio
  ['Padaria Teste', '   ', null],
  ['Padaria Teste ', '   ', null],
];

test('R21-3-04: `nomeParaGravar` — tirar o espaço das pontas escreve; o campo intocado, o mesmo nome e o vazio não', () => {
  const { nomeParaGravar } = montar(['nomeParaGravar'], {});
  for (const [cru, digitado, esperado] of NOMES) {
    assert.equal(nomeParaGravar({ name: cru }, digitado), esperado,
      `nome ${JSON.stringify(cru)}, campo ${JSON.stringify(digitado)}: ${esperado === null ? 'não escreve' : 'escreve ' + JSON.stringify(esperado)}`);
  }
  assert.equal(nomeParaGravar({}, 'X'), 'X', 'pedido sem nome');
  assert.equal(nomeParaGravar(null, 'X'), 'X', 'sem pedido');
  assert.equal(nomeParaGravar({ name: 'X' }, undefined), null, 'campo sem valor');
});

function camposDoNome(nomeNoWaze, digitado, { travado = false, comJanela = false } = {}) {
  const inp = { value: digitado }, ok = { disabled: false };
  const place = { venueID: 'v1', updateRequestID: 'u1', name: nomeNoWaze };
  const log = [];
  let desfazer = null;
  const timers = [];
  const deps = {
    document: { getElementById: (id) => ({ lightboxNomeInput: inp, lightboxNomeOk: ok })[id] || null }, Lightbox: { place },
    acoesTravadas: () => travado, Treino: { ativo: false }, podeRenomearAqui: () => true,
    AppState: { authenticated: true, preferences: { undoEnabled: comJanela } }, showToast() {}, t: (k) => k, avisoDaTrava: () => 'x',
    editandoNome: () => true, sairDaEdicaoNome: () => log.push('saiu'), fecharEdicaoNome: () => log.push('fechou'),
    aplicarNomeNaTela: (p, n) => { p.name = n; log.push('nome:' + JSON.stringify(n)); }, renomeacaoNoAr: () => false,
    API: { getRegion: () => 'row' }, canDisableUndo: () => true, enviarRenomeacao: (alvo) => { log.push('ENVIOU:' + JSON.stringify(alvo.novo) + '/' + JSON.stringify(alvo.antigo)); return Promise.resolve(true); },
    renomeacaoPendente: null, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, UNDO_WINDOW_MS: 3000,
    aplicarTravaDeAcao() {}, removeUndoBanner() {}, registrarDesfazer() {}, atenderOFimDaJanela() {}, manterFocoNoLightbox() {},
    mostrarDesfazer: (msg, fn) => { desfazer = fn; }, anunciarDesfechoDaFoto() {},
  };
  const corpo = ['nomeParaGravar', 'atualizarBotaoSalvarNome', 'confirmarRenomear'].map((n) => fatiar(n)).join('\n').replace(/renomeacaoPendente/g, '__pend.r');
  const app = new Function(...Object.keys(deps), '__pend', corpo + '\nreturn { atualizarBotaoSalvarNome, confirmarRenomear };')(...Object.values(deps), { r: null });
  return { app, ok, place, log, timers, desfazer: () => desfazer && desfazer() };
}

test('R21-3-04: o ✓ e o Enter respondem à MESMA pergunta — o que o app mostra e o que ele aceita são a mesma coisa', () => {
  for (const [cru, digitado, esperado] of NOMES) {
    const m = camposDoNome(cru, digitado);
    m.app.atualizarBotaoSalvarNome();
    assert.equal(m.ok.disabled, esperado === null, `✓ com o nome ${JSON.stringify(cru)} e o campo ${JSON.stringify(digitado)}: ${esperado === null ? 'devia estar desabilitado' : 'devia estar habilitado'}`);
    m.app.confirmarRenomear();
    const enviou = m.log.find((l) => l.startsWith('ENVIOU:'));
    if (esperado === null) {
      assert.equal(enviou, undefined, `o Enter escreveu com o nome ${JSON.stringify(cru)} e o campo ${JSON.stringify(digitado)}`);
      assert.deepEqual(m.log, ['saiu'], 'sem o que escrever, o Enter só sai da edição');
    } else {
      assert.equal(enviou, 'ENVIOU:' + JSON.stringify(esperado) + '/' + JSON.stringify(cru),
        `DEFEITO: o Enter com o nome ${JSON.stringify(cru)} e o campo ${JSON.stringify(digitado)} não escreveu o aparado`);
    }
  }
  // O ✓ travado (a conferência de um 401) segue desabilitado, mesmo com um nome novo.
  const t = camposDoNome('Padaria Teste ', 'Padaria Teste', { travado: true });
  t.app.atualizarBotaoSalvarNome();
  assert.equal(t.ok.disabled, true, 'CONTROLE: o ✓ vivo durante a trava');
});

test('R21-3-04: o Desfazer devolve o nome CRU, como o Waze o tem (não o aparado, que o Waze nunca teve)', () => {
  const m = camposDoNome('Padaria Teste ', 'Padaria Teste', { comJanela: true });
  m.app.confirmarRenomear();
  assert.equal(m.place.name, 'Padaria Teste', 'PRÉ-CONDIÇÃO: o nome novo não foi pra tela');
  m.desfazer();                                       // o toque no "Desfazer" da janela
  assert.equal(m.place.name, 'Padaria Teste ', 'DEFEITO: o Desfazer devolveu outro nome que não o do Waze');
  assert.equal(m.timers.length, 1, 'a janela do Desfazer abriu');
});
