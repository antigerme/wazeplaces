// A TELA na rodada 14 da auditoria (lote 18, área "tela"; relatório r14-8): o
// teclado, o leitor de tela e o ícone de um aviso — o JS de verdade, fatiado do
// app.js.
//
//  R14-8-01 · a SETA com o foco num ✕ ↑ ✓ do card tirava o card com o botão
//             focado e o foco caía no <body>; o Enter no MESMO botão já levava o
//             foco ao equivalente do card seguinte (C10). MEDIDO nos dois motores.
//  R14-8-13 · o aviso de primeira vez "Rejeição enviada ao Waze…" saía com o
//             RELÓGIO do `hint`, que no app quer dizer "esperando envio".
//  R14-8-14 · trocar o idioma com um card na tela deixava a região viva do card
//             no idioma anterior até o próximo card.
//
// (O R14-8-05, a idade de MESES em francês, mora em test/idade.test.mjs; os do
// Galaxy Fold — R14-8-03, -11 e -12 —, em test/tela-fold.test.mjs.)
//
// O foco pousando de verdade, nos dois motores, está no bloco "O CARD"
// (card/teclado) do `tools/smoke-browser.mjs`; o ícone do aviso, no bloco "OS
// AVISOS DE UMA VEZ".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const SEM = APP.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

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

// ═══ R14-8-01 · a SETA com o foco dentro do card ═════════════════════════════
// O `handleKeyDown`, o `prometerFocoDaSeta`, o `direcaoTravada` e o
// `aplicarFocoDoTeclado` DE VERDADE, com o DOM de mentira: o `triggerSwipe`
// tira o card da tela (o botão focado sai do documento e o foco cai no <body>)
// e o card seguinte nasce, como no app; o `aplicarFocoDoTeclado` é o que o
// `renderCurrentCard` chama depois da tarefa.
function montarSeta() {
  const doc = { body: { nome: '<body>' }, activeElement: null, getElementById: () => null };
  doc.activeElement = doc.body;
  const botao = (nome, { disabled = false } = {}) => {
    const b = { nome, disabled, tagName: 'BUTTON', isConnected: true, getClientRects: () => [1], closest: () => null };
    b.focus = () => { if (!b.disabled && b.isConnected) doc.activeElement = b; };
    return b;
  };
  const cardFake = (letra, { semFoto = false } = {}) => {
    const els = {
      '.card-btn-reject': botao('✕ ' + letra, { disabled: semFoto }), '.card-btn-skip': botao('↑ ' + letra),
      '.card-btn-read': botao('✓ ' + letra, { disabled: semFoto }), '.card-image-next': botao('a seta da foto ' + letra),
    };
    if (semFoto) els['.card-sem-foto'] = { nome: 'o aviso da foto' };
    return { letra, els, querySelector: (s) => els[s] || null, contains: (el) => Object.values(els).includes(el) };
  };
  const estado = { card: cardFake('A'), saiu: [], travado: false };
  // O card SAI com o gesto: o botão focado deixa o documento, o foco cai no
  // <body> e o card seguinte é o da frente.
  const sair = () => {
    for (const b of Object.values(estado.card.els)) b.isConnected = false;
    doc.activeElement = doc.body;
    estado.card = cardFake('B');
  };
  const deps = {
    document: doc,
    window: { triggerSwipe: (dir) => { estado.saiu.push(dir); sair(); } },
    AppState: { currentPlace: { updateRequestID: 'uA' }, pendingAction: null },
    MapaLightbox: { isOpen: () => false }, Lightbox: { isOpen: () => false, ampliada: () => false },
    topOpenModal: () => null, trapTabInModal() {}, closeModal() {}, desfazerAcaoPendente() {},
    acoesTravadas: () => estado.travado, agirNoPedidoDoGesto() {}, pedidoDoCard: () => null,
    handleReject() {}, handleMarkAsRead() {}, handleSkip() {}, desfazerPeloTeclado: () => false,
    avisarTravaAoTocar() {}, cardDaFrente: () => estado.card,
  };
  const fonte = [constante('TECLAS_DE_CURSOR'), fatiar('focoEmCampoDeTexto'), constante('AREAS_DO_CARD_QUE_ROLAM'),
    fatiar('focoEmAreaQueRola'), fatiar('atalhoDoNavegador'), constante('TECLAS_DOS_ATALHOS_DO_NAVEGADOR'),
    constante('BOTAO_DA_ACAO'), 'let focoDoTeclado = null;', fatiar('focavelNaTela'), fatiar('direcaoTravada'),
    fatiar('prometerFocoDaSeta'), fatiar('aplicarFocoDoTeclado'), fatiar('handleKeyDown'),
    'return { handleKeyDown, aplicarFocoDoTeclado, pendente: () => focoDoTeclado };'].join('\n');
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, fonte)(...nomes.map((n) => deps[n]));
  const tecla = (key) => { const e = { key, preventDefault() { this.parou = true; } }; app.handleKeyDown(e); return e; };
  const focado = () => (doc.activeElement && doc.activeElement.nome) || '?';
  return { app, doc, estado, tecla, focado, cardFake };
}

test('R14-8-01: a SETA com o foco num ✕ ↑ ✓ do card leva o foco ao MESMO botão do card que fica — como o Enter', () => {
  for (const [seta, sel, nome] of [
    ['ArrowLeft', '.card-btn-reject', '← com o foco no ✕'],
    ['ArrowUp', '.card-btn-skip', '↑ com o foco no ↑'],
    ['ArrowRight', '.card-btn-read', '→ com o foco no ✓'],
    // O "Entendi" do "Como funciona" e o fim da série do autor põem o foco no ✕;
    // a seta seguinte decide o que decidir, e o foco segue no ✕ (o lugar dele).
    ['ArrowRight', '.card-btn-reject', '→ com o foco no ✕'],
    ['ArrowUp', '.card-btn-read', '↑ com o foco no ✓'],
  ]) {
    const m = montarSeta();
    m.estado.card.els[sel].focus();
    assert.equal(m.doc.activeElement, m.estado.card.els[sel], `PRÉ-CONDIÇÃO (${nome}): o botão não ficou com o foco`);
    const e = m.tecla(seta);
    assert.equal(e.parou, true, `PRÉ-CONDIÇÃO (${nome}): a seta não ficou com o app`);
    assert.equal(m.estado.saiu.length, 1, `PRÉ-CONDIÇÃO (${nome}): a seta não decidiu`);
    assert.equal(m.doc.activeElement, m.doc.body, `PRÉ-CONDIÇÃO (${nome}): o card não saiu com o foco`);
    m.app.aplicarFocoDoTeclado();
    assert.equal(m.doc.activeElement, m.estado.card.els[sel],
      `DEFEITO (${nome}): o foco ficou em ${m.focado()} — o card saiu com o botão focado e quem usa teclado ou leitor de tela perdeu o lugar`);
    assert.equal(m.app.pendente(), null, `${nome}: o foco prometido ficou pendurado depois de pousar`);
  }
});

test('R14-8-01: de OUTRO controle do card (a seta da foto), a seta leva o foco ao ✕ do card que fica', () => {
  const m = montarSeta();
  m.estado.card.els['.card-image-next'].focus();
  m.tecla('ArrowLeft');
  m.app.aplicarFocoDoTeclado();
  assert.equal(m.doc.activeElement, m.estado.card.els['.card-btn-reject'], `o foco ficou em ${m.focado()}`);
  // Card de foto sem a foto chegando: ✕ e ✓ travados, e o foco vai ao ↑ (a régua do C10).
  const s = montarSeta();
  s.estado.card.els['.card-btn-reject'].focus();
  const sair = s.estado;
  s.tecla('ArrowLeft');
  sair.card = s.cardFake('C', { semFoto: true });
  s.app.aplicarFocoDoTeclado();
  assert.equal(s.doc.activeElement, sair.card.els['.card-btn-skip'], `card sem foto: o foco ficou em ${s.focado()}`);
});

test('R14-8-01 CONTROLE: com o foco FORA do card, ou na seta que não decide, nada é prometido', () => {
  // O foco num controle do cabeçalho: a seta decide, e o foco não pula pro card
  // — quem não estava no card não é levado a ele.
  const f = montarSeta();
  const fora = { nome: 'Filtros', tagName: 'BUTTON', isConnected: true, getClientRects: () => [1], closest: () => null, focus() { f.doc.activeElement = fora; } };
  fora.focus();
  f.tecla('ArrowLeft');
  assert.equal(f.estado.saiu.length, 1, 'CONTROLE: a seta deixou de decidir');
  // Nada prometido JÁ na tecla: o `aplicarFocoDoTeclado` apagaria a promessa
  // com o foco vivo noutro lugar, e a asserção depois dele não distinguiria —
  // mas o controle de fora que SOME junto (a barra "Primeiro os de…" no fim da
  // série) deixaria a promessa pousar no card.
  assert.equal(f.app.pendente(), null, 'a seta prometeu o foco de quem nem estava no card');
  f.doc.activeElement = fora;   // o controle de fora não saiu com o card
  f.app.aplicarFocoDoTeclado();
  assert.equal(f.doc.activeElement, fora, 'o foco foi arrancado de um controle fora do card');
  // Sem foco nenhum (o <body>): idem.
  const b = montarSeta();
  b.tecla('ArrowUp');
  b.app.aplicarFocoDoTeclado();
  assert.equal(b.doc.activeElement, b.doc.body, 'a seta sem foco nenhum pôs o foco no card (o foco pulando pela tela)');
  // ← num card de foto SEM a foto não decide nada (`direcaoTravada`): o foco
  // fica onde está, sem promessa pendurada.
  const t = montarSeta();
  t.estado.card = t.cardFake('A', { semFoto: true });
  t.estado.card.els['.card-btn-skip'].focus();
  t.estado.saiu.length = 0;
  t.app.handleKeyDown({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(t.app.pendente(), null, 'a seta que não decide (card sem foto) deixou uma promessa de foco pendurada');
  // A trava (a janela do Desfazer): a seta não decide nem promete.
  const j = montarSeta();
  j.estado.travado = true;
  j.estado.card.els['.card-btn-reject'].focus();
  j.tecla('ArrowLeft');
  assert.deepEqual(j.estado.saiu, [], 'CONTROLE: a seta decidiu com o card travado');
  assert.equal(j.app.pendente(), null, 'a seta travada prometeu o foco');
});

test('R14-8-01: as TRÊS setas passam pela promessa, ANTES do `triggerSwipe`', () => {
  // O comportamento acima já reprova a ordem invertida (o `triggerSwipe` tira o
  // foco do card antes); isto diz QUAL seta perdeu a chamada.
  const teclas = fatiar('handleKeyDown');
  for (const [k, d] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up']]) {
    const re = new RegExp(`e\\.key === '${k}'\\) \\{\\s*e\\.preventDefault\\(\\);\\s*prometerFocoDaSeta\\('${d}'\\);\\s*if \\(window\\.triggerSwipe\\)`);
    assert.match(teclas, re, `a seta ${k} decide sem prometer o foco ao card que fica`);
  }
});

// ═══ R14-8-13 · o ícone do aviso de primeira vez ═════════════════════════════
// O `showToast` e o `avisarConsequencia` DE VERDADE, com o DOM de mentira.
const CAMINHO_RELOGIO = 'M12 8v4l3 3';
const CAMINHO_INFO = 'M13 16h-1v-4h-1m1-4h.01';
function montarAviso() {
  const toasts = [];
  const containers = {};
  const container = (id) => (containers[id] ||= { id, children: [], appendChild(el) { this.children.push(el); toasts.push({ container: id, el }); },
    removeChild() {}, get firstElementChild() { return this.children[0]; } });
  const relogios = [];
  const deps = {
    document: {
      getElementById: (id) => container(id),
      createElement: () => ({ style: {}, className: '', innerHTML: '', title: '', addEventListener() {}, querySelector: () => null, remove() {} }),
    },
    window: { getSelection: () => ({ isCollapsed: true }) },
    setTimeout: (fn, ms) => { relogios.push(ms); return relogios.length; }, clearTimeout() {},
    dlog() {}, t: (k) => k, escapeHtml: (s) => s, console, TOAST_COPIAVEL_RECHECA_MS: 1500,
    Treino: { ativo: false }, AppState: { preferences: {} }, avisoDeUmaVezSaiAgora: () => true, savePreferences() {},
    // O punho do aviso de uma vez, que o treino tira da tela e devolve no fim (R14-7-A5, área "treino"):
    // aqui só se registra (a junção do lote 18 pôs as duas mudanças na mesma linha).
    anotarAvisoDeUmaVezNaTela() {},
  };
  const fonte = [fatiar('showToast'), constante('CONSEQUENCIA_AVISADA'), fatiar('avisarConsequencia'),
    'return { showToast, avisarConsequencia };'].join('\n');
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, fonte)(...nomes.map((n) => deps[n]));
  return { app, toasts, relogios };
}

test('R14-8-13: o aviso de primeira vez da consequência sai com o "i" de informação, não com o relógio de "esperando envio"', () => {
  for (const tipo of ['reject', 'read']) {
    const m = montarAviso();
    m.app.avisarConsequencia(tipo);
    assert.equal(m.toasts.length, 1, `PRÉ-CONDIÇÃO (${tipo}): o aviso não saiu`);
    const { container, el } = m.toasts[0];
    assert.equal(container, 'bannerContainer', `${tipo}: o aviso deixou de ser o banner do topo`);
    assert.match(el.className, /from-cyan-700/, `${tipo}: o aviso perdeu a cor do banner de dica`);
    assert.equal(m.relogios[0], 7000, `${tipo}: o aviso mudou de duração`);
    assert.ok(!el.innerHTML.includes(CAMINHO_RELOGIO),
      `DEFEITO (${tipo}): o aviso "${'consequencia.' + tipo}" saiu com o RELÓGIO — no app ele é "parado esperando envio", dito sobre o que acabou de SAIR (R14-8-13)`);
    assert.ok(el.innerHTML.includes(CAMINHO_INFO), `${tipo}: o aviso não saiu com o "i" de informação`);
    assert.match(el.innerHTML, /^<svg class="w-6 h-6 flex-shrink-0"/, `${tipo}: o ícone não tem o tamanho dos outros banners (24px)`);
  }
});

test('R14-8-13 CONTROLE: o relógio continua com o que é sobre TEMPO, e o "i" é o MESMO do aviso de informação', () => {
  const m = montarAviso();
  m.app.showToast('toast.undoHint', 'hint', 20000, () => {});
  m.app.showToast('auto.andando', 'hint', 600000);
  m.app.showToast('qualquer', 'info');
  const [dica, recusa, info] = m.toasts.map((x) => x.el.innerHTML);
  assert.ok(dica.includes(CAMINHO_RELOGIO), 'a dica do Desfazer perdeu o relógio');
  assert.ok(recusa.includes(CAMINHO_RELOGIO), 'o "Rejeitando N…" perdeu o relógio');
  // Mesmo conceito, mesmo ícone: o desenho do "i" do banner é o do `info`.
  const caminho = (h) => (/ d="([^"]+)"/.exec(h) || [])[1];
  const n = montarAviso();
  n.app.avisarConsequencia('reject');
  assert.equal(caminho(n.toasts[0].el.innerHTML), caminho(info), 'o "i" da consequência não é o mesmo desenho do aviso de informação');
});

// ═══ R14-8-14 · a região viva do card no idioma novo ═════════════════════════
// O `aplicarIdioma` de verdade, com o resto do app de buraco negro (a função que
// não é fornecida existe e não faz nada), e o `showCurrentPlace` fazendo o que o
// `renderCurrentCard` faz com a região viva — o TRECHO DE VERDADE, recortado.
function buracoNegro(nome, chamou) {
  const f = function () {};
  return new Proxy(f, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then' || typeof k !== 'string') return undefined;
      return buracoNegro(nome + '.' + k, chamou);
    },
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}
function trechoDoAnuncio() {
  const render = fatiar('renderCurrentCard');
  const i = render.indexOf("const liveRegion = document.getElementById('cardLiveRegion');");
  assert.ok(i >= 0, 'o renderCurrentCard não escreve mais a região viva do card — o instrumento quebrou');
  const ini = render.indexOf('if (liveRegion && place !== pedidoAnunciado) {', i);
  assert.ok(ini > i, 'a regra do `pedidoAnunciado` sumiu do renderCurrentCard');
  let prof = 0;
  for (let j = render.indexOf('{', ini); j < render.length; j++) {
    if (render[j] === '{') prof++;
    else if (render[j] === '}' && --prof === 0) return render.slice(i, j + 1);
  }
  throw new Error('o trecho do anúncio não fechou');
}
function montarIdioma({ lingua = 'pt' } = {}) {
  const regiao = { escritas: [], _t: '' };
  Object.defineProperty(regiao, 'textContent', { get() { return this._t; }, set(v) { this._t = String(v); this.escritas.push(this._t); } });
  const PEDIDO = { updateRequestID: 'u1', name: 'Congregação Cristã No Brasil' };
  const estado = { lingua };
  const chamou = [];
  const deps = {
    setLang: (l) => { estado.lingua = l; },
    t: (k, v) => `${estado.lingua}:${k}` + (v ? `(${Object.values(v).join('|')})` : ''),
    document: { getElementById: (id) => (id === 'cardLiveRegion' ? regiao : null) },
    SELETORES_IDIOMA: [], LANG_KEY: 'waze_places_lang', safeLS: { set() {} },
    AppState: { profile: null, currentPlace: PEDIDO, authenticated: false, queue: [PEDIDO] },
    Treino: { retraduzirExemplos() {} }, showToast() {}, estadoDaDicaDeOrdem: null,
    identidadeDoPlace: (p) => ({ titulo: p.name }), rotuloDoTipo: () => 'card.updateType.UPDATE',
  };
  const escopo = new Proxy(deps, {
    has: (tt, k) => typeof k === 'string' && (k in tt || !(k in globalThis)),
    get: (tt, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in tt) return tt[k];
      if (typeof k !== 'string') return undefined;
      return buracoNegro(k, chamou);
    },
    set: (tt, k, v) => { tt[k] = v; return true; },
  });
  const corpo = [
    'let pedidoAnunciado = null;',
    // O que o `renderCurrentCard` faz com a região viva, recortado dele.
    `function showCurrentPlace() { const place = AppState.currentPlace; ${trechoDoAnuncio()} }`,
    fatiar('aplicarIdioma'),
    'return { aplicarIdioma, showCurrentPlace, anunciado: () => pedidoAnunciado };',
  ].join('\n');
  const app = new Function('__escopo', `with (__escopo) {\n${corpo}\n}`)(escopo);
  return { app, regiao, estado, PEDIDO, frente: (p) => { deps.AppState.currentPlace = p; } };
}

test('R14-8-14: trocar o idioma com um card na tela não deixa a região viva no idioma de antes — nem anuncia o mesmo card de novo', () => {
  const m = montarIdioma();
  m.app.showCurrentPlace();
  assert.match(m.regiao.textContent, /^pt:card\.live\.newRequest/, 'PRÉ-CONDIÇÃO: o card na tela não foi anunciado em português');
  assert.equal(m.app.anunciado(), m.PEDIDO);
  const antes = m.regiao.escritas.length;
  m.app.aplicarIdioma('fr');
  assert.ok(!m.regiao.textContent.startsWith('pt:'),
    `DEFEITO: a região viva do card ficou no idioma de ANTES depois da troca pro francês ("${m.regiao.textContent}") — o leitor de tela lê português (R14-8-14)`);
  const novas = m.regiao.escritas.slice(antes).filter(Boolean);
  assert.deepEqual(novas, [],
    'a troca de idioma ANUNCIOU o card de novo — o pedido não mudou (quem diz quando ele muda é o `pedidoAnunciado`)');
  assert.equal(m.regiao.textContent, '', 'a região viva não foi esvaziada');
  assert.equal(m.app.anunciado(), m.PEDIDO, 'a troca de idioma mexeu no `pedidoAnunciado` (o card seria anunciado de novo no próximo redesenho)');
  // CONTROLE: o PRÓXIMO card fala, e no idioma NOVO — a régua de anunciar
  // segue viva (sem isto, "não anunciou" passaria com a região morta).
  m.frente({ updateRequestID: 'u2', name: 'Padaria' });
  m.app.showCurrentPlace();
  assert.match(m.regiao.textContent, /^fr:card\.live\.newRequest\(Padaria/, 'CONTROLE: o card seguinte não foi anunciado no idioma novo');
});
