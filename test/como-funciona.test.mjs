// O "Como funciona" da primeira vez, ADIADO (R6-7-2: ele não abre por cima de
// uma camada que a pessoa abriu enquanto a fila carregava) — e as três costuras
// que a auditoria de 2026-10-02 achou nesse adiamento:
//
// R7-7-01 — o adiado abria no 1º GESTO: o `showCurrentPlace` do `advanceQueue`
//   decidia na hora, ANTES de o `scheduleAction` abrir a janela do Desfazer, e
//   o banner dela (z-70) ficava por cima do "Entendi" e do "Quero treinar
//   antes": no iPhone SE e com o celular deitado o toque caía no "Desfazer" e
//   desfazia o ✕; pelo teclado o foco ia pro ⓘ, perdendo o ✕ do card seguinte.
// R7-7-02 — o "Ver de novo" da Ajuda aberto enquanto a fila carregava não dava o
//   diálogo por visto, e ele reabria no 1º gesto.
// R7-3-01 — fechar a foto ampliada depois de uma aprovação ANDA a fila no mesmo
//   tique do `history.back()` que o fechamento agendou: o adiado abria ali, o
//   `openModal` empilhava a entrada dele e o voltar pendente a comia (gotcha
//   #65) — o "Entendi", o Esc ou o voltar do aparelho tiravam a pessoa do app.
//
// As funções e os ouvintes DE VERDADE (a seção inteira do app.js, o
// `CamadaVoltar` e o ouvinte de `popstate` dele, o `Lightbox.close`, o
// `closeModal` e a `aplicarTravaDeAcao`), com a tela e o histórico de mentira.
// Cada teste foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fechar(txt, i) {
  let prof = 0;
  for (let j = txt.indexOf('{', i); j < txt.length; j++) {
    if (txt[j] === '{') prof++;
    else if (txt[j] === '}') { prof--; if (prof === 0) return j + 1; }
  }
  return txt.length;
}
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fechar(APP_SEM, i));
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
// Um MÉTODO de um objeto do app (`const X = { … }`), como texto de método.
function metodo(objeto, nome) {
  const ini = APP_SEM.indexOf('const ' + objeto + ' = {');
  assert.ok(ini >= 0, `${objeto} sumiu do app.js`);
  const fim = fechar(APP_SEM, ini);
  const m = new RegExp('^    ' + nome + '\\(', 'm').exec(APP_SEM.slice(ini, fim));
  assert.ok(m, `${objeto}.${nome} sumiu`);
  const i = ini + m.index;
  let par = 0, k = APP_SEM.indexOf('(', i);
  for (let j = k; j < fim; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { k = j + 1; break; } }
  }
  return APP_SEM.slice(i, fechar(APP_SEM, k)).trim();
}
function objeto(nome) {
  const i = APP_SEM.indexOf('const ' + nome + ' = {');
  assert.ok(i >= 0, `${nome} sumiu do app.js`);
  return APP_SEM.slice(i, fechar(APP_SEM, i)) + ';';
}
// A SEÇÃO do "Como funciona", do primeiro `let` ao `abrirComoFunciona`: as
// funções, as marcas e os ouvintes que ela registra no `window`.
function secao() {
  const ini = APP_SEM.indexOf('let comoFuncionaPedido = false;');
  assert.ok(ini >= 0, 'a seção do "Como funciona" mudou de forma — o instrumento ficou cego');
  const fim = fechar(APP_SEM, APP_SEM.indexOf('function abrirComoFunciona() {', ini));
  const txt = APP_SEM.slice(ini, fim);
  assert.match(txt, /window\.addEventListener\('popstate'/, 'a seção perdeu o ouvinte do voltar');
  return txt;
}
// O ouvinte de `popstate` do `CamadaVoltar`, o PRIMEIRO do arquivo: a ordem dos
// ouvintes é a ordem do arquivo, e é ele que zera o `consumindo` antes do da seção.
function ouvinteDoCamadaVoltar() {
  const ini = APP_SEM.indexOf("window.addEventListener('popstate', () => {\n    if (CamadaVoltar.consumindo)");
  assert.ok(ini >= 0, 'o ouvinte de popstate do CamadaVoltar mudou de forma');
  return APP_SEM.slice(ini, fechar(APP_SEM, ini)) + ');';
}
const microtarefas = () => new Promise((ok) => setImmediate(ok));

function montar({ visto = false, consumindo = false, treino = false } = {}) {
  const win = new EventTarget();
  const ops = [];
  const abertos = [];
  const camada = { modal: null, foto: false, mapa: false };
  const salvas = [];
  const AppState = { authenticated: true, preferences: { comoFuncionaVisto: visto }, currentPlace: { venueID: 'v1' }, pendingAction: null };
  const card = {};
  const deps = {
    window: win, AppState, Treino: { ativo: treino }, cardDaFrente: () => (AppState.currentPlace ? card : null),
    topOpenModal: () => camada.modal, Lightbox: { isOpen: () => camada.foto }, MapaLightbox: { isOpen: () => camada.mapa },
    // As outras travas do card: nenhuma aqui (a janela do Desfazer é o `pendingAction`).
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, loteDeLidosEmVoo: false,
    escritasConferindo: 0, aprovacaoDaTelaNoAr: () => false, contaDestaAbaEmDuvida: () => false,
    savePreferences: () => salvas.push({ ...AppState.preferences }),
    history: { back: () => ops.push('back'), pushState: () => ops.push('push') },
    closeModal: () => {},
    console,
  };
  const chaves = Object.keys(deps);
  const corpo = [
    objeto('CamadaVoltar'),
    ouvinteDoCamadaVoltar(),
    fatiar('semCamadaAberta'), fatiar('acoesTravadas'),
    // O `openModal` de mentira empilha como o de verdade, quando não há modal.
    "function openModal(id) { if (!camada.modal) CamadaVoltar.empilhar(); camada.modal = { id }; abertos.push(id); }",
    secao(),
    'return { CamadaVoltar, pedirComoFuncionaAdiado, mostrarComoFuncionaSePrimeiraVez, aoFecharCamada, abrirComoFunciona,',
    '  marcas: () => ({ esperaVoltar: comoFuncionaEsperaVoltar, esperaGesto: comoFuncionaEsperaGesto }) };',
  ].join('\n');
  const h = new Function(...chaves, 'camada', 'abertos', corpo)(...chaves.map((k) => deps[k]), camada, abertos);
  h.CamadaVoltar.consumindo = consumindo;
  // O navegador entregando o `popstate` (do voltar nosso ou do aparelho).
  const popstate = () => { ops.push('popstate'); win.dispatchEvent(new Event('popstate')); };
  const evento = (type, extra = {}) => win.dispatchEvent(Object.assign(new Event(type), extra));
  return { h, AppState, abertos, camada, ops, salvas, popstate, evento, win };
}

// ── R7-7-01: o gesto pede, a janela do Desfazer segura, o fim dela abre ──────
test('R7-7-01: o card que monta no GESTO pede o "Como funciona" — e a janela do Desfazer, aberta logo depois no mesmo gesto, o faz esperar até o card destravar', async () => {
  const m = montar();
  // O ✕: o `advanceQueue` monta o card seguinte (`showCurrentPlace` → pedido)
  // e, no MESMO tique, o `scheduleAction` abre a janela.
  m.h.pedirComoFuncionaAdiado();
  m.AppState.pendingAction = { type: 'reject', place: { venueID: 'v0' } };
  await microtarefas();
  assert.deepEqual(m.abertos, [], 'DEFEITO: o diálogo abriu com a janela do Desfazer — o banner cobre o "Entendi"');
  assert.equal(m.AppState.preferences.comoFuncionaVisto, false, 'deu-se por visto sem ter aparecido — nunca mais apareceria');
  // A janela acaba (o executor roda e a trava solta: `aplicarTravaDeAcao`).
  m.AppState.pendingAction = null;
  m.h.pedirComoFuncionaAdiado();
  await microtarefas();
  assert.deepEqual(m.abertos, ['comoFuncionaModal'], 'o card destravou e o diálogo que esperava não abriu');
  assert.equal(m.AppState.preferences.comoFuncionaVisto, true);
  // E uma vez só.
  m.camada.modal = null;
  m.h.pedirComoFuncionaAdiado();
  await microtarefas();
  assert.deepEqual(m.abertos, ['comoFuncionaModal'], 'abriu duas vezes');
});

test('R7-7-01: CONTROLE — sem janela (o card que chega da busca, o Desfazer desligado) ele abre na hora, e dois pedidos no mesmo tique abrem UM', async () => {
  const m = montar();
  m.h.pedirComoFuncionaAdiado();
  m.h.pedirComoFuncionaAdiado();
  await microtarefas();
  assert.deepEqual(m.abertos, ['comoFuncionaModal']);
  // E nada pede o que já foi visto.
  const v = montar({ visto: true });
  v.h.pedirComoFuncionaAdiado();
  await microtarefas();
  assert.deepEqual(v.abertos, []);
});

test('R7-7-01: o card que monta PEDE (não abre) e a trava que acaba pede de novo — os dois pontos de entrada', () => {
  const show = fatiar('showCurrentPlace');
  assert.match(show, /^\s+try \{ pedirComoFuncionaAdiado\(\); \} catch \(e\) \{ console\.error\(e\); \}$/m,
    'o card que monta não passa pelo pedido (decidir na hora abre o diálogo no gesto, antes da janela)');
  assert.ok(!/mostrarComoFuncionaSePrimeiraVez\(\)/.test(show),
    'o card que monta voltou a decidir na hora — no gesto, a janela do Desfazer abre DEPOIS desta linha');
  assert.match(fatiar('aplicarTravaDeAcao'), /^\s+if \(!travado\) pedirComoFuncionaAdiado\(\);$/m,
    'a trava que acaba (o fim da janela do Desfazer) não pede o diálogo que esperava');
});

// A `aplicarTravaDeAcao` DE VERDADE: a trava que liga não pede; a que solta pede.
test('R7-7-01: a aplicarTravaDeAcao de verdade pede o "Como funciona" quando a trava SOLTA, e só aí', () => {
  const pedidos = [];
  const estado = { travado: false };
  const botao = () => ({ disabled: false });
  const bs = { '.card-btn-reject': botao(), '.card-btn-skip': botao(), '.card-btn-read': botao() };
  const card = { classList: { toggle() {} }, querySelector: (s) => bs[s] || null };
  const deps = {
    document: { getElementById: () => null }, acoesTravadas: () => estado.travado, cardDaFrente: () => card,
    guardarFocoDaTrava: () => {}, editandoNome: () => false, renomeacaoNoAr: () => false, Lightbox: { place: null },
    atualizarBotaoSalvarNome: () => {}, dispensarAvisoDaTrava: () => {}, aplicarFocoDoTeclado: () => {},
    // o foco da foto ampliada na trava (R7-3-06, do lote da foto): aqui não é o assunto
    manterFocoNoLightbox: () => {},
    pedirComoFuncionaAdiado: () => pedidos.push(estado.travado ? 'travado' : 'livre'),
  };
  const chaves = Object.keys(deps);
  const trava = new Function(...chaves, 'let aprovandoAgora = false, excluindoAgora = false;\n'
    + fatiar('aplicarTravaDeAcao') + '\nreturn aplicarTravaDeAcao;')(...chaves.map((k) => deps[k]));
  estado.travado = true; trava();
  assert.deepEqual(pedidos, [], 'a trava que LIGA pediu o diálogo — ele abriria com o card travado');
  estado.travado = false; trava();
  assert.deepEqual(pedidos, ['livre'], 'a trava que SOLTA não pediu o diálogo que esperava');
});

// ── R7-3-01: um voltar nosso no ar ───────────────────────────────────────────
test('R7-3-01: com um voltar NOSSO no ar o diálogo não abre (nem se dá por visto) — e abre no popstate que o consome', async () => {
  const m = montar({ consumindo: true });
  m.h.pedirComoFuncionaAdiado();
  await microtarefas();
  assert.deepEqual(m.abertos, [], 'DEFEITO: abriu com o voltar pendente — ele come a entrada do diálogo (gotcha #65)');
  assert.equal(m.AppState.preferences.comoFuncionaVisto, false);
  assert.equal(m.h.marcas().esperaVoltar, true);
  // O popstate do voltar nosso: o ouvinte do CamadaVoltar o consome primeiro.
  m.popstate();
  await microtarefas();
  assert.equal(m.h.CamadaVoltar.consumindo, false, 'PRÉ-CONDIÇÃO: o ouvinte do CamadaVoltar não consumiu o voltar');
  assert.deepEqual(m.abertos, ['comoFuncionaModal'], 'o voltar foi consumido e o diálogo que esperava por ele não abriu');
  assert.deepEqual(m.ops, ['popstate', 'push'], 'a entrada do diálogo não veio DEPOIS do voltar');
  // CONTROLE: sem voltar no ar, abre na hora.
  const c = montar();
  c.h.pedirComoFuncionaAdiado();
  await microtarefas();
  assert.deepEqual(c.abertos, ['comoFuncionaModal']);
});

// O `Lightbox.close` DE VERDADE, sem o voltar do aparelho: fechar a foto depois
// de a aprovação pousar ANDA a fila no meio do fechamento, no mesmo tique do
// voltar que ele agendou.
function fotoAberta(m) {
  const els = {
    imageLightbox: { classList: { add() { m.camada.foto = false; }, remove() { m.camada.foto = true; } } },
    lightboxImage: { removeAttribute() {}, alt: '' },
  };
  const deps = {
    document: { getElementById: (id) => els[id] || null, body: { style: {} }, activeElement: null },
    CamadaVoltar: m.h.CamadaVoltar, fecharEdicaoNome: () => {}, topOpenModal: () => m.camada.modal,
    // A aprovação pousou com a foto aberta: o card anda e o novo PEDE o diálogo.
    avancarSeAprovado: () => { m.ops.push('anda'); m.h.pedirComoFuncionaAdiado(); },
    anunciarNoLightbox: () => {}, devolverFocoDaAmpliacao: () => {}, aoFecharCamada: m.h.aoFecharCamada,
  };
  m.camada.foto = true;
  m.h.CamadaVoltar.empilhar();   // a entrada que a foto empilhou ao abrir
  return new Function(...Object.keys(deps), `return {
    place: { venueID: 'v0' }, urls: ['x'], idx: 0, newIdx: -1, eDenuncia: false, placeName: 'P', _quemAbriu: null,
    isOpen() { return !!this._aberta; }, resetZoom() {}, _aberta: true,
    ${metodo('Lightbox', 'close').replace("if (!this.isOpen()) return;", "if (!this.isOpen()) return; this._aberta = false;")}
  };`)(...Object.values(deps));
}

test('R7-3-01: fechar a foto que ANDA a fila (o Lightbox.close de verdade) — o diálogo espera o voltar ser consumido, e a entrada dele fica', async () => {
  const m = montar();
  const L = fotoAberta(m);
  m.ops.length = 0;
  L.close();                      // Esc, ✕ ou o arraste: o voltar fica agendado
  await microtarefas();
  assert.deepEqual(m.abertos, [], 'DEFEITO: o diálogo abriu no mesmo tique do voltar pendente (gotcha #65)');
  assert.deepEqual(m.ops, ['back', 'anda'], 'PRÉ-CONDIÇÃO: o fechamento não agendou o voltar e andou a fila');
  m.popstate();
  await microtarefas();
  assert.deepEqual(m.abertos, ['comoFuncionaModal'], 'o voltar foi consumido e o diálogo não abriu');
  assert.deepEqual(m.ops, ['back', 'anda', 'popstate', 'push'],
    'a entrada do diálogo não veio depois do voltar — ele a comeria e o próximo voltar sairia do app');
  assert.equal(m.h.CamadaVoltar.profundidade, 1, 'a profundidade não é a do diálogo que ficou');
});

// ── O voltar DO APARELHO: empilhar depois dele, sem gesto novo, torna as
// entradas do app "puláveis" no Chrome (o voltar seguinte sai do app) ──────────
test('o VOLTAR do aparelho fechou a camada: o diálogo espera um GESTO novo (o Esc e o dedo que só desce não contam)', async () => {
  const m = montar();
  m.h.aoFecharCamada(true);
  m.h.pedirComoFuncionaAdiado();
  await microtarefas();
  assert.deepEqual(m.abertos, [], 'DEFEITO: abriu logo depois do voltar do aparelho, sem gesto — as entradas ficam puláveis');
  for (const [tipo, extra] of [['keydown', { key: 'Escape' }], ['pointerdown', { pointerType: 'touch' }],
    ['pointerup', { pointerType: 'mouse' }]]) {
    m.evento(tipo, extra);
    m.h.pedirComoFuncionaAdiado();
    await microtarefas();
    assert.deepEqual(m.abertos, [], `${tipo} ${JSON.stringify(extra)} contou como gesto — o navegador não conta`);
  }
  m.evento('pointerup', { pointerType: 'touch' });   // o dedo que SOBE: gesto
  assert.equal(m.h.marcas().esperaGesto, false, 'o dedo que sobe não contou como gesto');
  // O gesto só LIBERA: quem abre é o próximo pedido (a janela que acaba, a
  // camada que fecha) — abrir no próprio toque o poria debaixo do dedo.
  await microtarefas();
  assert.deepEqual(m.abertos, [], 'o diálogo abriu no próprio toque');
  m.h.pedirComoFuncionaAdiado();
  await microtarefas();
  assert.deepEqual(m.abertos, ['comoFuncionaModal']);
  // A tecla (que não é o Esc) e o mouse que desce também são gesto.
  for (const [tipo, extra] of [['keydown', { key: 'Enter' }], ['pointerdown', { pointerType: 'mouse' }]]) {
    const g = montar();
    g.h.aoFecharCamada(true);
    g.evento(tipo, extra);
    assert.equal(g.h.marcas().esperaGesto, false, `${tipo} ${JSON.stringify(extra)} não contou como gesto`);
  }
  // CONTROLE: fechada por um caminho do APP (✕, Esc, fundo), abre logo depois.
  const c = montar();
  c.h.aoFecharCamada(false);
  await microtarefas();
  assert.deepEqual(c.abertos, ['comoFuncionaModal'], 'a camada fechou pelo app e o diálogo que esperava não abriu');
});

test('o VOLTAR do aparelho fechando a foto que anda a fila (o Lightbox.close de verdade): o card novo pede, e o diálogo espera o gesto', async () => {
  const m = montar();
  const L = fotoAberta(m);
  L.close({ viaHistorico: true });
  await microtarefas();
  assert.deepEqual(m.abertos, [], 'DEFEITO: abriu logo depois do voltar do aparelho — o voltar seguinte sairia do app');
  m.evento('pointerup', { pointerType: 'touch' });
  m.h.pedirComoFuncionaAdiado();
  await microtarefas();
  assert.deepEqual(m.abertos, ['comoFuncionaModal']);
});

test('a camada que FECHA avisa a seção, pelos três fechamentos — com o caminho (app ou voltar do aparelho)', () => {
  const fim = (txt) => txt.trim().split('\n').slice(-3).join('\n');
  assert.match(fim(fatiar('closeModal')), /aoFecharCamada\(viaHistorico\);\s*\}$/, 'o closeModal não avisa (ou não é a última coisa)');
  assert.match(fim(metodo('Lightbox', 'close')), /aoFecharCamada\(viaHistorico\);\s*\}$/, 'o Lightbox.close não avisa');
  assert.match(fim(metodo('MapaLightbox', 'close')), /aoFecharCamada\(!!viaHistorico\);\s*\}$/, 'o MapaLightbox.close não avisa');
});

// ── R7-7-02: quem abre dá por visto ─────────────────────────────────────────
test('R7-7-02: o "Ver de novo" da Ajuda dá o diálogo por VISTO — o card que monta e o gesto seguinte não o reabrem', async () => {
  const m = montar();
  m.camada.modal = { id: 'helpModal' };
  m.h.abrirComoFunciona();         // o "Ver de novo", com a fila carregando
  assert.deepEqual(m.abertos, ['comoFuncionaModal']);
  assert.equal(m.AppState.preferences.comoFuncionaVisto, true, 'DEFEITO: o aberto à mão não se deu por visto');
  assert.ok(m.salvas.some((p) => p.comoFuncionaVisto === true), 'o visto não foi gravado');
  m.h.pedirComoFuncionaAdiado();   // o 1º card monta com ele aberto
  m.camada.modal = null;           // "Entendi"
  m.h.aoFecharCamada(false);
  m.AppState.pendingAction = { type: 'reject' };   // o 1º ✕ e a janela
  m.h.pedirComoFuncionaAdiado();
  m.AppState.pendingAction = null;
  m.h.pedirComoFuncionaAdiado();
  await microtarefas();
  assert.deepEqual(m.abertos, ['comoFuncionaModal'], 'o diálogo que a pessoa já leu reabriu');
  // O botão da Ajuda passa por esta função.
  assert.match(fatiar('setupAppListeners'), /\$\('reverComoFunciona'\)\?\.addEventListener\('click', abrirComoFunciona\);/);
});

test('o treino É o "Como funciona": com ele ativo, nada abre (nem se dá por visto)', async () => {
  const m = montar({ treino: true });
  m.h.pedirComoFuncionaAdiado();
  await microtarefas();
  assert.deepEqual(m.abertos, [], 'abriu por cima dos cards de treino');
  assert.equal(m.AppState.preferences.comoFuncionaVisto, false);
});
