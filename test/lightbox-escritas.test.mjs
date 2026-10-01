// As escritas do lightbox (aprovar foto, excluir foto), pela auditoria de
// 2026-09-25. O defeito mais grave: a resposta TARDIA de uma aprovação mexia no
// lightbox que estivesse aberto na hora — o de OUTRO pedido —, pondo o ✨ e o
// botão de aprovar numa foto que não era a do pedido dele. O toque seguinte
// mandaria `approve: true` pra esse outro pedido, que podia ser um local NOVO:
// o app aprovaria um local, a regra de ouro inteira. Cada teste foi visto
// REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
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
  return APP_SEM.slice(m.index, fechar(APP_SEM, i));
}
// Um MÉTODO do objeto `Lightbox`, como texto de método (`nome(args) { … }`).
function metodo(nome) {
  const ini = APP_SEM.indexOf('const Lightbox = {');
  const fim = fechar(APP_SEM, ini);
  const re = new RegExp('^    ' + nome + '\\(', 'm');
  const m = re.exec(APP_SEM.slice(ini, fim));
  assert.ok(m, `Lightbox.${nome} sumiu`);
  const i = ini + m.index;
  let par = 0, k = APP_SEM.indexOf('(', i);
  for (let j = k; j < fim; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { k = j + 1; break; } }
  }
  return APP_SEM.slice(i, fechar(APP_SEM, k)).trim();
}

// O Lightbox com os métodos de VERDADE e a tela de mentira.
function lightbox(podeL6 = true) {
  const corpo = ['podeAprovarAtual', 'marcarComoAprovada', 'desmarcarAprovada', 'esquecerProposta', 'removerFoto', 'indiceDaFoto'].map(metodo).join(',\n');
  const L = new Function('podeAgirComoL6Aqui', `return {
    place: null, urls: [], idx: 0, newIdx: -1, eDenuncia: false, aberto: true, renders: 0,
    isOpen() { return this.aberto; }, _render() { this.renders++; }, close() { this.aberto = false; },
    ${corpo}
  };`)(() => podeL6);
  return L;
}
const FOTO = (id) => `https://venue-image.waze.com/thumbs/thumb700_${id}.jpg`;
const pedidoDeFoto = (ur) => ({ venueID: 'v-' + ur, updateRequestID: ur, purType: 'NEW_PHOTO', approvedImageIds: ['velha'] });
function abrir(L, place, urls, newIdx) {
  Object.assign(L, { place, urls: urls.slice(), idx: newIdx, newIdx, aberto: true, eDenuncia: false });
}

test('aprovar: só pedido de FOTO NOVA, e só a foto DELE (a URL traz o id do pedido)', () => {
  const L = lightbox();
  const foto = pedidoDeFoto('ur-A');
  abrir(L, foto, [FOTO('velha'), FOTO('ur-A')], 1);
  assert.equal(L.podeAprovarAtual(), true, 'CONTROLE: a foto do pedido, num pedido de foto, aprova');
  // Um local NOVO com o ✨ na tela (o estado que a continuação tardia deixava):
  const localNovo = { venueID: 'v-B', updateRequestID: 'v-B', purType: 'NEW_PLACE', approvedImageIds: [] };
  abrir(L, localNovo, [FOTO('x1'), FOTO('x2')], 1);
  assert.equal(L.podeAprovarAtual(), false, 'o botão de aprovar num pedido de LOCAL NOVO aprovaria o local');
  // Pedido de foto, mas o ✨ apontando pra foto de OUTRO id:
  abrir(L, pedidoDeFoto('ur-C'), [FOTO('ur-C'), FOTO('outra')], 1);
  assert.equal(L.podeAprovarAtual(), false, 'aprovaria o pedido olhando outra foto');
  // Um pedido que NÃO é de foto nova, mesmo com a URL trazendo o id dele (o
  // caso em que só o tipo do pedido separa): aprovar resolveria outra coisa.
  abrir(L, { venueID: 'v-Z', updateRequestID: 'ur-Z', purType: 'DELETE_PHOTO', approvedImageIds: [] }, [FOTO('ur-Z')], 0);
  assert.equal(L.podeAprovarAtual(), false, 'aprovou um pedido que não é de FOTO NOVA');
  // Sem o portão L6, nada.
  const L2 = lightbox(false);
  abrir(L2, pedidoDeFoto('ur-D'), [FOTO('ur-D')], 0);
  assert.equal(L2.podeAprovarAtual(), false);
});

test('falha TARDIA da aprovação com o lightbox em OUTRO pedido: o ✨ não aparece no pedido errado', () => {
  const L = lightbox();
  const A = pedidoDeFoto('ur-A');
  abrir(L, A, [FOTO('velha'), FOTO('ur-A')], 1);
  const alvo = { id: 'ur-A', place: A, idx: 1 };
  L.marcarComoAprovada(alvo);                      // o ✨ some na hora (janela do Desfazer)
  assert.equal(L.newIdx, -1);
  assert.ok(A.approvedImageIds.includes('ur-A'));
  // A pessoa fecha e abre o lightbox de um local NOVO; a aprovação de A falha agora.
  const B = { venueID: 'v-B', updateRequestID: 'v-B', purType: 'NEW_PLACE', approvedImageIds: [] };
  abrir(L, B, [FOTO('b0'), FOTO('b1')], -1);
  L.idx = 1;
  L.desmarcarAprovada(alvo);
  assert.equal(L.newIdx, -1, 'o ✨ da aprovação de A apareceu no lightbox de B');
  assert.equal(L.podeAprovarAtual(), false);
  assert.ok(!A.approvedImageIds.includes('ur-A'), 'a foto de A seguiu "aprovada" no dado depois da falha');
  // CONTROLE: com o lightbox ainda em A, a falha devolve o ✨ lá.
  abrir(L, A, [FOTO('velha'), FOTO('ur-A')], -1);
  L.marcarComoAprovada(alvo);
  L.desmarcarAprovada(alvo);
  assert.equal(L.newIdx, 1);
});

test('excluir: a confirmação tira a foto certa pelo ID, mesmo com a pessoa em outra foto', () => {
  const L = lightbox();
  // O ✨ fica ENTRE a foto na tela e a que sai: é o arranjo em que usar o
  // índice da tela (e não o da foto que saiu) move o ✨ pra foto errada.
  const P = { venueID: 'v1', updateRequestID: 'ur-9', purType: 'NEW_PHOTO', approvedImageIds: ['f1', 'f2'],
    imageUrls: [FOTO('f1'), FOTO('ur-9'), FOTO('f2')] };
  abrir(L, P, P.imageUrls, 1);
  L.idx = 0;                                       // a pessoa voltou pra primeira foto
  L.removerFoto('f2', P);                          // e só agora chegou a confirmação da f2
  assert.deepEqual(L.urls, [FOTO('f1'), FOTO('ur-9')]);
  assert.equal(L.newIdx, 1, 'o ✨ mudou de foto por causa de uma exclusão DEPOIS dele');
  assert.equal(L.idx, 0, 'a tela pulou de foto sozinha');
  // Com o lightbox em OUTRO pedido, só o dado muda.
  const Q = { venueID: 'v2', approvedImageIds: ['q1'], imageUrls: [FOTO('q1'), FOTO('q2')] };
  abrir(L, Q, Q.imageUrls, -1);
  L.removerFoto('f1', P);
  assert.deepEqual(L.urls, [FOTO('q1'), FOTO('q2')], 'a confirmação de P mexeu no carrossel de Q');
  assert.ok(!P.approvedImageIds.includes('f1'));
});

// ── L5: a aprovação que volta depois de uma EXCLUSÃO anterior à proposta ────
// (auditoria de 2026-09-26). O ✨ era achado pelo índice que a foto tinha no
// GESTO, e a exclusão de uma foto anterior desloca os índices. MEDIDO no
// navegador: sem Desfazer, a aprovação que voltava deixava ✨ + "Aprovar" +
// lixeira juntos na proposta e dava pra aprová-la DE NOVO ("Restam" caindo 2);
// com Desfazer, a que falhava devolvia o ✨ à foto SEGUINTE.
test('L5 aprovação confirmada depois de excluir uma foto ANTERIOR: o ✨ sai da PROPOSTA', () => {
  const L = lightbox();
  const P = { venueID: 'v1', updateRequestID: 'ur-P', purType: 'NEW_PHOTO', approvedImageIds: ['a1', 'a3'],
    imageUrls: [FOTO('a1'), FOTO('ur-P'), FOTO('a3')] };
  abrir(L, P, P.imageUrls, 1);
  const alvo = { id: 'ur-P', place: P, idx: 1 };   // o índice do GESTO
  L.idx = 0;
  L.removerFoto('a1', P);                          // a exclusão anterior confirma primeiro
  assert.equal(L.newIdx, 0, 'CONTROLE: a exclusão tinha que levar o ✨ junto pro índice 0');
  L.marcarComoAprovada(alvo);                      // e a aprovação volta agora
  assert.equal(L.newIdx, -1, 'o ✨ ficou na foto aprovada — com ele, o "Aprovar" (e uma 2ª aprovação)');
  L.idx = 0;
  assert.equal(L.podeAprovarAtual(), false, 'a proposta JÁ aprovada seguiu aprovável');
  // CONTROLE: sem exclusão no meio, a mesma aprovação tira o ✨ (os dois
  // caminhos, índice e id, concordam — é o caso que sempre passou).
  const L2 = lightbox();
  const Q = { ...P, approvedImageIds: ['a1', 'a3'], imageUrls: [FOTO('a1'), FOTO('ur-P'), FOTO('a3')] };
  abrir(L2, Q, Q.imageUrls, 1);
  L2.marcarComoAprovada({ id: 'ur-P', place: Q, idx: 1 });
  assert.equal(L2.newIdx, -1);
});

test('L5 aprovação que FALHA depois de excluir uma foto ANTERIOR: o ✨ volta pra PROPOSTA, não pra seguinte', () => {
  const L = lightbox();
  const P = { venueID: 'v1', updateRequestID: 'ur-P', purType: 'NEW_PHOTO', approvedImageIds: ['a1', 'a3'],
    imageUrls: [FOTO('a1'), FOTO('ur-P'), FOTO('a3')] };
  abrir(L, P, P.imageUrls, 1);
  const alvo = { id: 'ur-P', place: P, idx: 1 };
  L.marcarComoAprovada(alvo);                      // com Desfazer: o ✨ sai no gesto
  assert.equal(L.newIdx, -1);
  L.idx = 0;
  L.removerFoto('a1', P);                          // exclui a anterior (a lista vira [P, a3])
  L.desmarcarAprovada(alvo);                       // e a aprovação falha
  assert.equal(L.newIdx, 0, `o ✨ voltou pra foto ${L.newIdx} — a proposta é a 0 agora (a 1 é a a3, já no mapa)`);
  L.idx = 0;
  assert.equal(L.podeAprovarAtual(), true, 'a proposta deixou de poder ser aprovada de novo depois da falha');
  // A foto que saiu da lista não recebe ✨ nenhum.
  L.removerFoto('ur-P', P);
  L.desmarcarAprovada(alvo);
  assert.equal(L.newIdx, -1, 'o ✨ foi parar numa foto que não é a do pedido');
});

// ── o caminho SEM Desfazer: só aplica o que o Waze confirmou ────────────────
// `noAr`: o estado de uma escrita de foto sem janela no ar (L24). `regiao`: a
// região de AGORA, que o teste troca entre o gesto e o envio (L26).
function montarEscritas({ resposta, preferencias = { undoEnabled: false }, fotoNaTela = true, noAr = {}, regiao = { v: 'row' }, extra = {} }) {
  const log = [];
  const timers = [];
  const L = lightbox();
  const A = pedidoDeFoto('ur-A');
  abrir(L, A, [FOTO('velha'), FOTO('ur-A')], 1);
  const AppState = { authenticated: true, preferences: preferencias, serverTotal: 5, currentPlace: A, queue: [A] };
  const deps = {
    AppState, Lightbox: L, Treino: { ativo: false }, epocaDaSessao: 0,
    canDisableUndo: () => true, estadoAprovando: () => {}, lixeiraOcupada: () => {},
    fotoDoLightboxNaTela: () => fotoNaTela, manterFocoNoLightbox: () => log.push('foco'), marcarEmAndamento: () => {},
    API: { aprovarPedido: async (...a) => { log.push('api:aprovar:' + a[2]); return resposta; },
      excluirFoto: async (...a) => { log.push('api:excluir:' + a[4]); return resposta; },
      prepararExclusao: (...a) => log.push('api:preparar:' + a[3]),
      getRegion: () => regiao.v },
    // Nada de foto no ar (L24); a fila que o pedido aprovado deixa (L22).
    aprovandoAgora: false, excluindoAgora: false, ...noAr, updatePendingCount: () => {}, aoMudarAFilaPorBaixo: () => {},
    registrarPouso: () => log.push('pouso'), updateStats: () => {}, contarConquista: () => {},
    advanceQueue: () => log.push('avancou'), handleUnauthorized: () => {}, showToast: (m, tipo) => log.push('toast:' + tipo + ':' + m),
    msgDoServidor: () => '', t: (k) => k, devolverFoto: () => log.push('devolveu'), showCurrentPlace: () => {},
    aplicarTravaDeAcao: () => {}, removeUndoBanner: () => {}, mostrarDesfazer: () => {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, UNDO_WINDOW_MS: 3000,
    callWithRetry: (fn) => fn(),
    // A volta do pedido numa fila refeita (V9) é medida em test/lote-autor.test.mjs.
    voltarDaAprovacaoRecusada: () => {}, refazerSelosSeOutroNaTela: () => {},
    // A aprovação no ar trava o card do pedido (A1, medido em test/lote-autor.test.mjs).
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID,
    // O foco que fica no card trocado debaixo dele (R5-3-07) é medido à parte,
    // em test/lightbox-foco-card.test.mjs: aqui só redesenha.
    mantendoFocoNoCard: (redesenhar) => redesenhar(),
    // `extra`: troca qualquer dependência acima (R5-3-07).
    ...extra,
  };
  let placeResolvido = null;
  const nomes = ['enviarAprovacao', 'concluirAprovacao', 'aprovarFotoAtual', 'enviarExclusao', 'pedirExclusaoDaFoto',
    'tirarAprovadoDaFila', 'pousouNoWaze', 'escritaDoLightboxSemSessao', 'contarIdasSemResposta'];
  const chaves = Object.keys(deps);
  const corpo = nomes.map(fatiar).join('\n')
    .replace(/placeResolvidoPorAprovacao = /g, '__res.v = ')
    .replace(/aprovacaoPendente/g, '__pend.a').replace(/exclusaoPendente/g, '__pend.e');
  const pend = { a: null, e: null };
  const app = new Function(...chaves, '__res', '__pend', corpo + `\nreturn { ${nomes.join(', ')} };`)(
    ...chaves.map((k) => deps[k]), { get v() { return placeResolvido; }, set v(x) { placeResolvido = x; } }, pend);
  return { app, L, A, log, AppState, timers, pend, resolvido: () => placeResolvido };
}

test('sem Desfazer: aprovação que FALHA não marca a foto como aprovada (senão a lixeira apagava a pendente)', async () => {
  const { app, L, A } = montarEscritas({ resposta: { success: false, errorCategory: 'unknown' } });
  app.aprovarFotoAtual();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!A.approvedImageIds.includes('ur-A'), 'a foto pendente virou "aprovada" com a aprovação FALHADA');
  assert.equal(L.newIdx, 1, 'o ✨ sumiu de uma foto que segue pendente');
  // CONTROLE: com sucesso, marca.
  const ok = montarEscritas({ resposta: { success: true } });
  ok.app.aprovarFotoAtual();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(ok.A.approvedImageIds.includes('ur-A'));
});

test('sem Desfazer: exclusão que FALHA não tira a foto da tela', async () => {
  const { app, L, log } = montarEscritas({ resposta: { success: false, errorCategory: 'unknown' } });
  L.place.approvedImageIds = ['velha'];
  L.place.lat = -23; L.place.lon = -46;
  L.idx = 0;
  L.idFotoAtual = () => 'velha';
  app.pedirExclusaoDaFoto();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(L.urls, [FOTO('velha'), FOTO('ur-A')], 'a tela afirmou uma exclusão que o Waze recusou');
  assert.ok(log.includes('devolveu'));
});

// ── L3: a foto que NÃO CARREGOU não se aprova nem se exclui ──────────────────
// (auditoria de 2026-09-26). MEDIDO: pelo carrossel, a proposta com 404 abria
// no lightbox com o ícone de imagem quebrada, o ✨ e o "Aprovar" ativo, e
// aprovar mandava `approve: true` de uma foto que ninguém viu. A tela é medida
// no smoke; aqui, que as DUAS ações recusam por dentro (teclado ou script
// clicando o botão escondido não furam a regra).
test('L3 aprovar e excluir recusam a foto que não está na tela — sem nenhuma ida ao Waze', async () => {
  for (const [nome, acao] of [['aprovar', 'aprovarFotoAtual'], ['excluir', 'pedirExclusaoDaFoto']]) {
    const m = montarEscritas({ resposta: { success: true }, fotoNaTela: false });
    m.L.place.approvedImageIds = ['velha'];
    m.L.place.lat = -23; m.L.place.lon = -46;
    if (nome === 'excluir') { m.L.idx = 0; m.L.idFotoAtual = () => 'velha'; }
    m.app[acao]();
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(!m.log.some((l) => l.startsWith('api:')), `${nome}: foi ao Waze com a foto QUEBRADA na tela`);
    // CONTROLE: a mesma ação, com a foto na tela, vai.
    const c = montarEscritas({ resposta: { success: true }, fotoNaTela: true });
    c.L.place.approvedImageIds = ['velha'];
    c.L.place.lat = -23; c.L.place.lon = -46;
    if (nome === 'excluir') { c.L.idx = 0; c.L.idFotoAtual = () => 'velha'; }
    c.app[acao]();
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(c.log.some((l) => l.startsWith('api:')), `CONTROLE ${nome}: com a foto na tela a ação não saiu`);
  }
});

test('L3 os botões de aprovar e excluir SOMEM com a foto fora da tela, e a imagem reavalia no load/error', () => {
  const el = () => ({ hidden: false, classList: { toggle(c, v) { if (c === 'hidden') this.o.hidden = v; }, o: null } });
  const del = el(), apr = el();
  del.classList.o = del; apr.classList.o = apr;
  const rodar = (naTela) => new Function('document', 'Treino', 'editandoNome', 'fotoDoLightboxNaTela', 'Lightbox',
    fatiar('atualizarAcoesDeFoto') + '\nreturn atualizarAcoesDeFoto;')(
    { getElementById: (id) => ({ lightboxDelete: del, lightboxApprove: apr })[id] || null },
    { ativo: false }, () => false, () => naTela, { idFotoAtual: () => 'x', podeAprovarAtual: () => true })();
  rodar(true);
  assert.equal(del.hidden || apr.hidden, false, 'CONTROLE: com a foto na tela e o portão aberto, as ações aparecem');
  rodar(false);
  assert.equal(del.hidden && apr.hidden, true, 'as ações de foto ficaram na tela com a foto QUEBRADA');
  // O `_render` avalia antes de a foto chegar; quem mostra os botões quando
  // ela carrega (e confirma o sumiço quando falha) são os ouvintes da imagem.
  const setup = fatiar('setupLightbox');
  assert.match(setup, /img\.addEventListener\('load', atualizarAcoesDeFoto\)/, 'a foto que CARREGA não reavalia as ações');
  assert.match(setup, /img\.addEventListener\('error', atualizarAcoesDeFoto\)/, 'a foto que FALHA não reavalia as ações');
  // E o predicado é o do PIXEL: `complete` sozinho é verdadeiro pra imagem quebrada.
  assert.match(fatiar('fotoDoLightboxNaTela'), /img\.complete && img\.naturalWidth > 0/);
});

test('aprovar e FECHAR dentro da janela: o card avança quando a resposta chega', async () => {
  const { app, L, log, AppState, A } = montarEscritas({ resposta: { success: true }, preferencias: { undoEnabled: true } });
  L.aberto = false;                               // fechou antes da resposta
  await app.enviarAprovacao({ id: 'ur-A', place: A, idx: 1 });
  assert.ok(log.includes('avancou'), 'o pedido aprovado ficou na frente: o ✓ seguinte contaria de novo');
  // CONTROLE: com o lightbox DESTE pedido aberto, espera fechar (decisão do owner).
  const m2 = montarEscritas({ resposta: { success: true } });
  await m2.app.enviarAprovacao({ id: 'ur-A', place: m2.A, idx: 1 });
  assert.ok(!m2.log.includes('avancou'));
  assert.equal(m2.resolvido(), m2.A);
  assert.ok(AppState);
});

test('aprovar e excluir foto passam pela MESMA retentativa do resto (o renomear já passava)', () => {
  // Uma oscilação de rede virava "não deu pra aprovar/excluir" na primeira
  // falha (auditoria de 2026-09-25). Repetir é seguro nos dois: a aprovação que
  // passou volta `already_processed` (que conta), e a exclusão relê o local.
  // A ida sai por uma função (`enviar`), que o `refazerDepoisDo401` reusa
  // pra segunda ida (L1) — pela MESMA retentativa.
  // As idas são CONTADAS (`contarIdasSemResposta`): o "já feito" depois de uma
  // ida sem resposta é desta pessoa (R5-3-04, medido no fim deste arquivo).
  assert.match(fatiar('enviarAprovacao'), /const enviar = contarIdasSemResposta\(\(\) => API\.aprovarPedido\([^\n]*\n\s+let r = await callWithRetry\(enviar\)/);
  assert.match(fatiar('enviarExclusao'), /const enviar = contarIdasSemResposta\(\(\) => API\.excluirFoto\([^\n]*\n\s+let r = await callWithRetry\(enviar\)/);
  assert.match(fatiar('refazerDepoisDo401'), /await callWithRetry\(enviar\)/,
    'a segunda ida depois do 401 saiu da retentativa do resto');
});

// ── os IRMÃOS na fila (auditoria de 2026-09-25) ──────────────────────────────
// Outro pedido do MESMO local, mais adiante na fila, foi montado com o local de
// antes: mostrava a foto que acabou de sair e o nome velho.
function montarIrmaos(resposta) {
  const log = [];
  const L = lightbox();
  const A = { venueID: 'v1', updateRequestID: 'ur-A', name: 'Padaria Velha', imageUrls: [FOTO('f1'), FOTO('f2')], approvedImageIds: ['f1', 'f2'] };
  const B = { venueID: 'v1', updateRequestID: 'ur-B', name: 'Padaria Velha', imageUrls: [FOTO('f1'), FOTO('f2')], approvedImageIds: ['f1', 'f2'] };
  const C = { venueID: 'v2', updateRequestID: 'ur-C', name: 'Outro', imageUrls: [FOTO('f1')], approvedImageIds: ['f1'] };
  const AppState = { queue: [A, B, C], currentPlace: A };
  const deps = {
    AppState, Lightbox: L, epocaDaSessao: 0, callWithRetry: (fn) => fn(),
    API: { excluirFoto: async () => resposta, renomearLocal: async () => resposta },
    handleUnauthorized: () => {}, showToast: () => {}, msgDoServidor: () => '', t: (k) => k,
    devolverFoto: () => log.push('devolveu'), showCurrentPlace: () => {}, contarConquista: () => {},
    montarCardDeFundo: () => log.push('fundo'), cardDaFrente: () => null, document: { getElementById: () => null },
    // A renomeação no ar trava a pílula do local (L23).
    renomeacoesNoAr: new Set(), aplicarTravaDeAcao: () => {},
    mantendoFocoNoCard: (redesenhar) => redesenhar(),
  };
  const chaves = Object.keys(deps);
  const nomes = ['aplicarNosIrmaos', 'enviarExclusao', 'enviarRenomeacao', 'aplicarNomeNaTela',
    'nomeDestaEscrita', 'devolverNome', 'escritaDoLightboxSemSessao', 'contarIdasSemResposta'];
  const app = new Function(...chaves, nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(...chaves.map((k) => deps[k]));
  return { app, A, B, C, log };
}

test('excluir foto confirmado: os OUTROS pedidos do mesmo local perdem a foto também (e o card de fundo é refeito)', async () => {
  const { app, A, B, C, log } = montarIrmaos({ success: true });
  A.imageUrls = [FOTO('f2')];                      // a do card já saiu (é o que o lightbox faz)
  assert.equal(await app.enviarExclusao({ id: 'f1', place: A, idx: 0, url: FOTO('f1') }), true);
  assert.deepEqual(B.imageUrls, [FOTO('f2')], 'o irmão seguiu mostrando a foto que saiu do mapa');
  assert.deepEqual(B.approvedImageIds, ['f2']);
  assert.deepEqual(C.imageUrls, [FOTO('f1')], 'mexeu no pedido de OUTRO local');
  assert.ok(log.includes('fundo'), 'o card de fundo (o irmão) não foi refeito');
  // Controle: na FALHA os irmãos ficam como estão — o mapa ainda tem a foto.
  const f = montarIrmaos({ success: false, errorCategory: 'unknown' });
  await f.app.enviarExclusao({ id: 'f1', place: f.A, idx: 0, url: FOTO('f1') });
  assert.deepEqual(f.B.imageUrls, [FOTO('f1'), FOTO('f2')], 'a falha tirou a foto do irmão');
});

test('renomear confirmado: os OUTROS pedidos do mesmo local ganham o nome novo', async () => {
  const { app, A, B, C } = montarIrmaos({ success: true });
  A.name = 'Padaria Nova';
  await app.enviarRenomeacao({ place: A, novo: 'Padaria Nova', antigo: 'Padaria Velha' });
  assert.equal(B.name, 'Padaria Nova', 'o irmão seguiu com o nome velho — a pílula ofereceria corrigir de novo');
  assert.equal(C.name, 'Outro', 'mexeu no pedido de OUTRO local');
  // Controle: na falha, ninguém muda (e o do card volta).
  const f = montarIrmaos({ success: false, errorCategory: 'unknown' });
  f.A.name = 'Padaria Nova';
  await f.app.enviarRenomeacao({ place: f.A, novo: 'Padaria Nova', antigo: 'Padaria Velha' });
  assert.equal(f.B.name, 'Padaria Velha');
  assert.equal(f.A.name, 'Padaria Velha');
});

// ── L1: 401 numa escrita do lightbox (auditoria de 2026-09-26) ─────────────
// O ramo `unauthorized` das três escritas só chamava o `handleUnauthorized` e
// saía: MEDIDO no navegador, com a sonda do perfil respondendo VIVA, a foto
// seguia fora, a proposta "aprovada" e o nome trocado — e nada tinha chegado ao
// Waze. As três escritas de verdade (e o `refazerDepoisDo401`), com o Waze e a
// sonda de mentira: `respostas` é o que cada ida devolve, e `viva` diz se a
// sonda confirmou a sessão depois do 401.
const R401 = { success: false, errorCategory: 'unauthorized', error: 'HTTP 403', httpCode: 403 };
// `caiNaSonda`: a conferência deste 401 DERRUBA a sessão (e a extensão a renova
// depois: a fila e a foto aberta ficam). `saiNaSonda`: é o "Sair" que acontece
// na conferência (a fila vai embora e a foto fecha). `quedaNaIda`: a sessão cai
// por OUTRA chamada com a primeira ida no ar. `viva` pode ser uma função (ver o
// V5, em que a prova de vida só chega quando a conferência de OUTRO 401 acaba).
function montarL1({ respostas, viva, caiNaSonda = false, saiNaSonda = false, quedaNaIda = false, retentativa = null, extra = {} }) {
  const log = [];
  const L = lightbox();
  const P = { venueID: 'v1', updateRequestID: 'ur-P', purType: 'NEW_PHOTO', name: 'Padaria Nova',
    lat: -23, lon: -46, approvedImageIds: ['a1'], imageUrls: [FOTO('ur-P')] };
  const irmao = { venueID: 'v1', updateRequestID: 'ur-Q', name: 'Padaria Velha', imageUrls: [FOTO('a1'), FOTO('ur-P')], approvedImageIds: ['a1'] };
  abrir(L, P, [FOTO('ur-P')], 0);
  const AppState = { queue: [P, irmao], currentPlace: P, serverTotal: 5 };
  let idas = 0;
  let app = null;
  const proxima = async () => {
    idas++;
    if (quedaNaIda && idas === 1) app.setEpoca(1);
    return respostas[Math.min(idas, respostas.length) - 1];
  };
  const deps = {
    // `retentativa`: o `callWithRetry` de VERDADE (R5-3-04); sem ela, uma ida só.
    AppState, Lightbox: L, callWithRetry: retentativa || ((fn) => fn()),
    API: { excluirFoto: proxima, aprovarPedido: proxima, renomearLocal: proxima },
    handleUnauthorized: async () => {
      log.push('confere');
      if (caiNaSonda) app.setEpoca(1);
      if (saiNaSonda) { app.setEpoca(1); AppState.queue = []; AppState.currentPlace = null; L.aberto = false; }
    },
    sessaoVivaDepoisDe: () => (typeof viva === 'function' ? viva() : viva),
    aplicarTravaDeAcao: () => log.push('trava:' + app.conferindo()),
    showToast: (m, tipo) => log.push(`toast:${tipo}:${m}`), msgDoServidor: (r) => (r && r.error) || '', t: (k) => k,
    devolverFoto: () => log.push('devolveu'), showCurrentPlace: () => {}, contarConquista: (k) => log.push('conquista:' + k),
    montarCardDeFundo: () => {}, cardDaFrente: () => null, document: { getElementById: () => null },
    registrarPouso: () => log.push('pouso'), updateStats: () => {}, advanceQueue: () => log.push('avancou'),
    marcarEmAndamento: () => {}, voltarDaAprovacaoRecusada: () => {}, refazerSelosSeOutroNaTela: () => {},
    renomeacoesNoAr: new Set(), updatePendingCount: () => {}, aoMudarAFilaPorBaixo: () => {},
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID,
    mantendoFocoNoCard: (redesenhar) => redesenhar(),
    ...extra,
  };
  const nomes = ['refazerDepoisDo401', 'enviarExclusao', 'enviarAprovacao', 'concluirAprovacao',
    'enviarRenomeacao', 'aplicarNosIrmaos', 'aplicarNomeNaTela', 'nomeDestaEscrita', 'devolverNome',
    'escritaDoLightboxSemSessao', 'tirarAprovadoDaFila', 'pousouNoWaze', 'contarIdasSemResposta',
    'aprovacaoPousouDepoisDaQueda'];
  const chaves = Object.keys(deps);
  app = new Function(...chaves, 'epocaDaSessao', 'escritasConferindo', 'placeResolvidoPorAprovacao',
    'verificandoSessao', 'conferenciaDaSessao',
    nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')},
      setEpoca: (v) => { epocaDaSessao = v; }, conferindo: () => escritasConferindo,
      setConferencia: (p) => { verificandoSessao = !!p; conferenciaDaSessao = p; } };`)(
    ...chaves.map((k) => deps[k]), 0, 0, null, false, null);
  return { app, L, P, irmao, log, AppState, idas: () => idas };
}
const erros = (log) => log.filter((l) => l.startsWith('toast:error'));

test('L1 excluir com 401 e a sessão NÃO confirmada: a foto VOLTA e o editor é avisado', async () => {
  const m = montarL1({ respostas: [R401], viva: false });
  assert.equal(await m.app.enviarExclusao({ id: 'a1', place: m.P, idx: 0, url: FOTO('a1') }), false);
  assert.ok(m.log.includes('devolveu'), 'a foto seguiu fora da tela com a exclusão NÃO feita no Waze');
  assert.deepEqual(erros(m.log), ['toast:error:toast.photoDeleteFailed'], 'a falha não foi avisada (ou saiu com a frase do 401)');
  assert.equal(m.idas(), 1, 'sem a sessão confirmada, não pode haver segunda ida');
  assert.deepEqual(m.log.filter((l) => l === 'confere'), ['confere'], 'a sessão não foi conferida');
  // CONTROLE: um erro que não é 401 volta a tela SEM conferir a sessão.
  const c = montarL1({ respostas: [{ success: false, errorCategory: 'unknown', error: 'HTTP 500' }], viva: true });
  await c.app.enviarExclusao({ id: 'a1', place: c.P, idx: 0, url: FOTO('a1') });
  assert.ok(c.log.includes('devolveu') && !c.log.includes('confere'));
});

test('L1 excluir com 401 e a sessão confirmada VIVA: sai de novo UMA vez, e o que o Waze confirmar vale', async () => {
  const m = montarL1({ respostas: [R401, { success: true }], viva: true });
  assert.equal(await m.app.enviarExclusao({ id: 'a1', place: m.P, idx: 0, url: FOTO('a1') }), true,
    'a segunda ida deu certo e a exclusão foi dada como falha');
  assert.equal(m.idas(), 2);
  assert.ok(!m.log.includes('devolveu') && erros(m.log).length === 0, 'a foto voltou (ou houve aviso) com a exclusão FEITA');
  assert.deepEqual(m.irmao.imageUrls, [FOTO('ur-P')], 'o irmão não perdeu a foto excluída');
  // A trava vale DURANTE a conferência e sai no fim (aplicada nas duas pontas).
  assert.deepEqual(m.log.filter((l) => l.startsWith('trava:')), ['trava:1', 'trava:0']);
  assert.equal(m.app.conferindo(), 0);
  // 401 DE NOVO com a sessão viva: é a escrita que o Waze recusa. Volta a
  // tela, com a frase da exclusão (não a do 401 — a sessão está provada), e
  // não confere a sessão de novo (seria o laço de 401 da fila de saída).
  const d = montarL1({ respostas: [R401, R401], viva: true });
  assert.equal(await d.app.enviarExclusao({ id: 'a1', place: d.P, idx: 0, url: FOTO('a1') }), false);
  assert.ok(d.log.includes('devolveu'));
  assert.deepEqual(erros(d.log), ['toast:error:toast.photoDeleteFailed']);
  assert.equal(d.idas(), 2, 'mais de uma segunda ida');
  assert.equal(d.log.filter((l) => l === 'confere').length, 1, 'a sessão foi conferida duas vezes');
});

test('L1 aprovar com 401: sem sessão confirmada o ✨ e o "Aprovar" VOLTAM; confirmada, sai de novo e conclui', async () => {
  const m = montarL1({ respostas: [R401], viva: false });
  const alvo = { id: 'ur-P', place: m.P, idx: 0 };
  m.L.marcarComoAprovada(alvo);                    // o que o gesto fez (janela do Desfazer)
  assert.equal(await m.app.enviarAprovacao(alvo), false);
  assert.equal(m.L.newIdx, 0, 'a foto seguiu "aprovada" na tela com a aprovação NÃO feita no Waze');
  assert.ok(!m.P.approvedImageIds.includes('ur-P'), 'a proposta seguiu na lista das aprovadas (a lixeira a apagaria)');
  assert.deepEqual(erros(m.log), ['toast:error:toast.photoApproveFailed']);
  assert.ok(!m.log.includes('pouso'), 'um pedido NÃO aprovado foi dado como resolvido');
  // Com a sessão viva, a segunda ida resolve o pedido UMA vez.
  const v = montarL1({ respostas: [R401, { success: true }], viva: true });
  const alvoV = { id: 'ur-P', place: v.P, idx: 0 };
  v.L.marcarComoAprovada(alvoV);
  assert.equal(await v.app.enviarAprovacao(alvoV), true);
  assert.deepEqual(v.log.filter((l) => l === 'pouso'), ['pouso']);
  assert.equal(v.AppState.serverTotal, 4);
  assert.equal(v.idas(), 2);
});

test('L1 renomear com 401: sem sessão confirmada o nome VOLTA; confirmada, o nome novo fica e vai aos irmãos', async () => {
  const m = montarL1({ respostas: [R401], viva: false });
  await m.app.enviarRenomeacao({ place: m.P, novo: 'Padaria Nova', antigo: 'Padaria Velha' });
  assert.equal(m.P.name, 'Padaria Velha', 'o nome novo ficou na tela com a gravação NÃO feita no Waze');
  assert.deepEqual(erros(m.log), ['toast:error:toast.renameFailed']);
  const v = montarL1({ respostas: [R401, { success: true }], viva: true });
  await v.app.enviarRenomeacao({ place: v.P, novo: 'Padaria Nova', antigo: 'Padaria Velha' });
  assert.equal(v.P.name, 'Padaria Nova');
  assert.equal(v.irmao.name, 'Padaria Nova', 'o irmão não recebeu o nome confirmado');
  assert.equal(erros(v.log).length, 0);
});

// ── V2: a sessão ACABA com a escrita no ar (auditoria de 2026-09-29) ──────
// Com a época trocada, a escrita saía calada e a tela ficava como feita — e com
// a extensão RENOVANDO, a fila e a foto aberta continuam na tela: MEDIDO, a foto
// seguia fora, a proposta "aprovada" e o nome trocado, só com o aviso de
// "acesso renovado", e nada no Waze. A tela volta ao que o Waze tem e avisa
// (a promessa do L1); a escrita NÃO sai de novo com a sessão nova (sem a conta
// do gesto, seria o K1). E nada GRAVA — nem pouso, nem conquista.
test('V2 a sessão CAI na conferência do 401: a escrita não sai de novo, a tela VOLTA e avisa — e nada grava', async () => {
  const m = montarL1({ respostas: [R401, { success: true }], viva: true, caiNaSonda: true });
  assert.equal(await m.app.enviarExclusao({ id: 'a1', place: m.P, idx: 0, url: FOTO('a1') }), false);
  assert.equal(m.idas(), 1, 'escreveu no Waze depois de a sessão cair');
  assert.ok(m.log.includes('devolveu'), 'a foto seguiu fora da tela com a exclusão NÃO feita no Waze');
  assert.deepEqual(erros(m.log), ['toast:error:toast.photoDeleteFailed'], 'a volta da foto não foi avisada');
  assert.equal(m.app.conferindo(), 0, 'a trava ficou presa depois da queda');
  // Aprovar: o ✨ e o "Aprovar" voltam, e o pedido NÃO pousa.
  const a = montarL1({ respostas: [R401, { success: true }], viva: true, caiNaSonda: true });
  const alvoA = { id: 'ur-P', place: a.P, idx: 0 };
  a.L.marcarComoAprovada(alvoA);                   // o gesto (janela do Desfazer)
  assert.equal(await a.app.enviarAprovacao(alvoA), false);
  assert.equal(a.L.newIdx, 0, 'a proposta seguiu "aprovada" na tela com a aprovação NÃO feita no Waze');
  assert.ok(!a.P.approvedImageIds.includes('ur-P'), 'a proposta seguiu entre as aprovadas: a lixeira a apagaria');
  assert.deepEqual(erros(a.log), ['toast:error:toast.photoApproveFailed']);
  assert.ok(!a.log.includes('pouso'), 'um pedido NÃO aprovado foi dado como resolvido');
  assert.equal(a.idas(), 1);
  // Renomear: o nome de antes volta.
  const r = montarL1({ respostas: [R401, { success: true }], viva: true, caiNaSonda: true });
  await r.app.enviarRenomeacao({ place: r.P, novo: 'Padaria Nova', antigo: 'Padaria Velha' });
  assert.equal(r.P.name, 'Padaria Velha', 'o nome novo ficou na tela com a gravação NÃO feita no Waze');
  assert.deepEqual(erros(r.log), ['toast:error:toast.renameFailed']);
  assert.equal(r.irmao.name, 'Padaria Velha', 'o irmão recebeu um nome que não foi gravado');
  assert.equal(r.idas(), 1);
});

test('V2 a queda veio de OUTRA chamada com a escrita no ar: o que não pousou volta; o que pousou fica, sem gravar', async () => {
  const m = montarL1({ respostas: [R401], viva: true, quedaNaIda: true });
  assert.equal(await m.app.enviarExclusao({ id: 'a1', place: m.P, idx: 0, url: FOTO('a1') }), false);
  assert.ok(!m.log.includes('confere'), 'a escrita conferiu a sessão de NOVO, depois de a queda já ter sido decidida');
  assert.ok(m.log.includes('devolveu'), 'a foto seguiu fora da tela com a exclusão NÃO feita');
  assert.deepEqual(erros(m.log), ['toast:error:toast.photoDeleteFailed']);
  // CONTROLE: a que POUSOU antes da queda fica como está — a foto saiu do mapa
  // de verdade — e nada grava (nem os irmãos: ver `epocaDaSessao`).
  const ok = montarL1({ respostas: [{ success: true }], viva: true, quedaNaIda: true });
  assert.equal(await ok.app.enviarExclusao({ id: 'a1', place: ok.P, idx: 0, url: FOTO('a1') }), false);
  assert.ok(!ok.log.includes('devolveu') && erros(ok.log).length === 0, 'a exclusão que POUSOU foi desfeita na tela');
  assert.deepEqual(ok.irmao.imageUrls, [FOTO('a1'), FOTO('ur-P')], 'depois da queda, a resposta gravou nos irmãos');
  // A aprovação que pousou como "já tratada" também não volta. E, na fila que
  // ATRAVESSOU a queda (a renovação com a mesma conta: a fila é a do gesto), o
  // pedido resolvido ganha o pouso e sai — o V6b da aprovação (R5-2-03, ver
  // `aprovacaoPousouDepoisDaQueda`; a outra conta e o "não pousou" são medidos lá).
  const j = montarL1({ respostas: [{ success: false, errorCategory: 'already_processed' }], viva: true, quedaNaIda: true });
  // (Sem `epocaFila` aqui, como os outros alvos deste harness: a fila do gesto é
  // a de agora — `undefined` dos dois lados.)
  const alvoJ = { id: 'ur-P', place: j.P, idx: 0 };
  j.L.marcarComoAprovada(alvoJ);
  await j.app.enviarAprovacao(alvoJ);
  assert.equal(j.L.newIdx, -1, 'a aprovação que pousou (já tratada) voltou a ser proposta na tela');
  assert.ok(j.log.includes('pouso') && erros(j.log).length === 0,
    'depois da queda, o pedido resolvido na fila que atravessou ficou sem pouso (ou a tela avisou erro)');
});

test('V2 CONTROLE: o "Sair" na conferência — a fila foi embora, e nada volta nem é avisado', async () => {
  const m = montarL1({ respostas: [R401, { success: true }], viva: true, saiNaSonda: true });
  assert.equal(await m.app.enviarExclusao({ id: 'a1', place: m.P, idx: 0, url: FOTO('a1') }), false);
  assert.equal(m.idas(), 1, 'escreveu no Waze depois do "Sair"');
  assert.ok(!m.log.includes('devolveu') && erros(m.log).length === 0,
    'depois do "Sair" a escrita mexeu na tela ou avisou — sobre uma fila que não existe mais');
  const r = montarL1({ respostas: [R401, { success: true }], viva: true, saiNaSonda: true });
  await r.app.enviarRenomeacao({ place: r.P, novo: 'Padaria Nova', antigo: 'Padaria Velha' });
  assert.equal(r.P.name, 'Padaria Nova');
  assert.equal(erros(r.log).length, 0);
});

// ── V5: o 401 CONCORRENTE (auditoria de 2026-09-29) ───────────────────────
// Outra chamada já conferia a sessão quando a escrita levou o 401 (o WAF e o KV
// devolvem 401 a várias de uma vez): o `handleUnauthorized` voltava na hora,
// sem desfecho, e a escrita desistia — MEDIDO: 1 envio e a foto de volta a
// pendente, com a sessão confirmada viva 1 s depois. Agora ela espera o
// desfecho da conferência em curso.
test('V5 401 com a conferência de OUTRA chamada em curso: espera o desfecho dela e, viva, sai de novo', async () => {
  let terminar, terminou = false;
  const conferencia = new Promise((ok) => { terminar = () => { terminou = true; ok(); }; });
  const m = montarL1({ respostas: [R401, { success: true }], viva: () => terminou });
  m.app.setConferencia(conferencia);
  const envio = m.app.enviarExclusao({ id: 'a1', place: m.P, idx: 0, url: FOTO('a1') });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(m.idas(), 1, 'CONTROLE: a primeira ida saiu');
  assert.ok(!m.log.includes('devolveu'), 'desistiu ANTES de a conferência em curso terminar');
  terminar();                                      // a sonda da outra chamada respondeu: viva
  assert.equal(await envio, true, 'com a sessão confirmada viva, a exclusão foi dada como falha');
  assert.equal(m.idas(), 2, 'a escrita não saiu de novo depois da conferência em curso');
  assert.ok(!m.log.includes('devolveu') && erros(m.log).length === 0, 'a foto voltou (ou houve aviso) com a exclusão FEITA');
  // CONTROLE: a conferência em curso que DERRUBA a sessão — a escrita não sai de novo.
  let derrubar;
  const d = montarL1({ respostas: [R401, { success: true }], viva: false });
  d.app.setConferencia(new Promise((ok) => { derrubar = () => { d.app.setEpoca(1); ok(); }; }));
  const envioD = d.app.enviarExclusao({ id: 'a1', place: d.P, idx: 0, url: FOTO('a1') });
  await new Promise((r) => setTimeout(r, 5));
  derrubar();
  assert.equal(await envioD, false);
  assert.equal(d.idas(), 1, 'saiu de novo depois de a conferência em curso derrubar a sessão');
});

test('L1 a conferência do 401 TRAVA as ações, como a janela do Desfazer', () => {
  const trava = new Function('AppState', 'aprovacaoPendente', 'exclusaoPendente', 'renomeacaoPendente', 'escritasConferindo',
    'loteDeLidosEmVoo', 'aprovacaoDaTelaNoAr', fatiar('acoesTravadas') + '\nreturn acoesTravadas;');
  const AppState = { pendingAction: null, authenticated: true };
  const parado = () => false;   // nenhuma aprovação no ar (medido em test/lote-autor.test.mjs, A1)
  assert.equal(trava(AppState, null, null, null, 0, false, parado)(), false, 'CONTROLE: sem nada pendente, nada trava');
  assert.equal(trava(AppState, null, null, null, 1, false, parado)(), true,
    'com a escrita esperando a conferência, dava pra decidir de novo sobre o mesmo local');
});

// ── C10: o lightbox não pode dividir a lista com o pedido ──────────────────
// O `open` de VERDADE, com o `recolocarFoto`/`removerFoto` de verdade e o
// `devolverFoto` (o Desfazer da exclusão) de verdade.
function lightboxQueAbre() {
  const el = () => ({ classList: { add() {}, remove() {} }, focus() {} });
  const doc = { getElementById: () => el(), body: { style: {} } };
  const corpo = ['open', 'recolocarFoto', 'removerFoto', 'podeAprovarAtual'].map(metodo).join(',\n');
  const L = new Function('document', 'CamadaVoltar', 'mostrarNomeNoLightbox', 'podeAgirComoL6Aqui', `return {
    place: null, urls: [], idx: 0, newIdx: -1, eDenuncia: false, aberto: false, renders: 0,
    isOpen() { return this.aberto; }, _render() { this.renders++; }, close() { this.aberto = false; },
    ${corpo}
  };`)(doc, { empilhar() {} }, () => {}, () => true);
  const devolverFoto = new Function('Lightbox', 'AppState', 'showCurrentPlace', 'mantendoFocoNoCard',
    fatiar('devolverFoto') + '\nreturn devolverFoto;')(L, { currentPlace: null }, () => {}, (redesenhar) => redesenhar());
  return { L, devolverFoto };
}

test('C10 excluir, fechar, REABRIR e desfazer: a foto volta com o ✨ no lugar certo e aprovável', () => {
  // MEDIDO no navegador: depois do Desfazer o ✨ apontava a foto b (a errada),
  // a tira seguia com 2 miniaturas e a foto do pedido não podia ser aprovada.
  const a = FOTO('foto-a'), b = FOTO('foto-b'), c = FOTO('uNP-c');
  for (const reabre of [true, false]) {
    const { L, devolverFoto } = lightboxQueAbre();
    const P = { venueID: 'vNP', updateRequestID: 'uNP', purType: 'NEW_PHOTO', approvedImageIds: ['foto-a', 'foto-b'], imageUrls: [a, b, c] };
    L.open(P.imageUrls, 0, 2, 'x', false, P);     // do card: a MESMA lista do pedido
    L.aberto = true;
    L.removerFoto('foto-a', P);                    // excluída com a janela aberta
    if (reabre) { L.aberto = false; L.open(P.imageUrls, 1, 1, 'x', false, P); L.aberto = true; }
    const antes = L.renders;
    devolverFoto({ id: 'foto-a', place: P, idx: 0, url: a });   // Desfazer
    const nome = reabre ? 'reaberto' : 'CONTROLE sem reabrir';
    assert.deepEqual(L.urls, [a, b, c], `${nome}: a foto não voltou pro carrossel`);
    assert.equal(L.newIdx, 2, `${nome}: o ✨ ficou apontando a foto errada (${L.newIdx})`);
    assert.ok(L.renders > antes, `${nome}: o lightbox não se redesenhou (a tira segue sem a foto)`);
    L.idx = 2;
    assert.equal(L.podeAprovarAtual(), true, `${nome}: a foto do pedido deixou de poder ser aprovada`);
    assert.deepEqual(P.imageUrls, [a, b, c], `${nome}: o pedido não recebeu a foto de volta`);
    assert.notEqual(L.urls, P.imageUrls, `${nome}: o lightbox voltou a dividir a lista com o pedido`);
  }
});

// ── L4: editando o nome, o passo pra trás só sai da EDIÇÃO ───────────────────
// (auditoria de 2026-09-26). Tocar no fundo, arrastar a foto pra baixo, e Esc
// ou ↓ com o foco no ✓/✕ da edição FECHAVAM o lightbox — o nome digitado e a
// foto que servia de prova iam embora juntos. O Esc do CAMPO já só cancelava
// a edição; os quatro caminhos passam a fazer o mesmo, pelo `recuarNaFoto`.
test('L4 o passo pra trás: editando, sai da edição e a foto fica; sem edição, fecha', () => {
  for (const editando of [true, false]) {
    const log = [];
    const recuar = new Function('editandoNome', 'sairDaEdicaoNome', 'Lightbox',
      fatiar('recuarNaFoto') + '\nreturn recuarNaFoto;')(
      () => editando, () => log.push('saiu-da-edicao'), { close: () => log.push('fechou') });
    recuar();
    assert.deepEqual(log, editando ? ['saiu-da-edicao'] : ['fechou'],
      editando ? 'editando o nome, o passo pra trás FECHOU a foto (e jogou fora o nome digitado)'
               : 'CONTROLE: sem edição, o passo pra trás não fechou a foto');
  }
  // Os caminhos que eram `Lightbox.close()` direto passam por ele.
  const setup = fatiar('setupLightbox');
  assert.match(setup, /if \(e\.target === lb\) recuarNaFoto\(\);/, 'o toque no FUNDO voltou a fechar direto');
  assert.match(setup, /dy > 80 && Math\.abs\(dy\) > Math\.abs\(dx\)\) \{\s*recuarNaFoto\(\);/,
    'o arraste pra BAIXO voltou a fechar direto');
});

// ── L9: a pílula do nome na trava (auditoria de 2026-09-26) ──────────────────
// Na janela do Desfazer (aprovar, excluir, renomear) a pílula seguia com cara
// de viva, e tocá-la não fazia nada (`abrirEdicaoNome` saía calado): o gotcha
// #63 de novo. Ela ganhou o MESMO escritor dos outros botões — e esse escritor
// é o único, porque a pílula também fica `disabled` como RÓTULO na edição.
test('L9 a pílula do nome: travada na janela, rótulo na edição, viva fora dos dois — por UM escritor', () => {
  const botao = () => ({ disabled: false, querySelector: () => null });
  const el = { lightboxApprove: botao(), lightboxDelete: botao(), lightboxNomeBtn: botao() };
  // `aplicarFocoDoTeclado`/`dispensarAvisoDaTrava`/`guardarFocoDaTrava`: a trava
  // mudando é também a hora do foco prometido ao teclado pousar (e de guardar o
  // que ela tira do botão, R5-2-05) e do aviso da trava sair
  // (test/card-foco-trava); aqui eles não são o assunto.
  const rodar = (travado, editando) => new Function('document', 'acoesTravadas', 'cardDaFrente', 'editandoNome',
    'aprovandoAgora', 'excluindoAgora', 'renomeacaoNoAr', 'Lightbox', 'atualizarBotaoSalvarNome',
    'aplicarFocoDoTeclado', 'dispensarAvisoDaTrava', 'guardarFocoDaTrava', fatiar('aplicarTravaDeAcao') + '\naplicarTravaDeAcao();')(
    { getElementById: (id) => el[id] || null }, () => travado, () => null, () => editando,
    false, false, () => false, { place: null }, () => {}, () => {}, () => {}, () => {});
  rodar(false, false);
  assert.equal(el.lightboxNomeBtn.disabled, false, 'CONTROLE: sem janela e sem edição a pílula ficou morta');
  rodar(true, false);
  assert.equal(el.lightboxNomeBtn.disabled, true, 'na janela do Desfazer a pílula seguiu clicável');
  assert.equal(el.lightboxApprove.disabled, true, 'CONTROLE: o aprovar não travou junto');
  rodar(false, true);
  assert.equal(el.lightboxNomeBtn.disabled, true, 'na edição a pílula deixou de ser rótulo');
  rodar(false, false);
  assert.equal(el.lightboxNomeBtn.disabled, false, 'a pílula não voltou a ser botão');
  // O escritor é UM só: abrir e fechar a edição não escrevem o `disabled` da
  // pílula por conta própria (um desfaria o outro — a reincidência do #63).
  for (const nome of ['abrirEdicaoNome', 'fecharEdicaoNome']) {
    const f = fatiar(nome);
    assert.doesNotMatch(f, /btn\.disabled\s*=/, `${nome} voltou a escrever o disabled da pílula por fora da trava`);
    assert.match(f, /aplicarTravaDeAcao\(\)/, `${nome} não passa pela função da trava`);
  }
  // E o visual: travada fora da edição se esmaece como os outros; na edição é
  // rótulo e fica acesa.
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  const regra = css.match(/^\.lb-nome:not\(\.editando\) \.lb-nome-btn:disabled \{([^}]*)\}/m);
  assert.ok(regra && /opacity:\s*0\.4/.test(regra[1]) && /grayscale/.test(regra[1]),
    'a pílula travada ficou com cara de viva (sem o esmaecido dos outros botões travados)');
});

// ── L12: o foco não cai no <body> (auditoria de 2026-09-26) ──────────────────
// Fechar a foto ou o mapa ampliados (Esc, ✕, ↓) e sair da edição do nome com a
// foto aberta jogavam o foco no <body>; o Filtros (controle) devolvia ao botão
// que o abriu. Os dois helpers de verdade, com elementos de mentira.
function elFoco(nome, { conectado = true, visivel = true, disabled = false, dentro = null } = {}) {
  return { nome, isConnected: conectado, disabled, getClientRects: () => (visivel ? [1] : []),
    focus() { if (this.conectado !== false && visivel && !disabled) doc.activeElement = this; },
    closest: (sel) => (sel === '[role="dialog"]' ? dentro : null), conectado };
}
const doc = { activeElement: null, body: { nome: 'BODY' } };
function helpers({ modal = null, card = null, lbAberto = true, lb = null } = {}) {
  const log = [];
  const deps = {
    document: Object.assign(doc, { getElementById: (id) => (lb && lb[id]) || null }),
    topOpenModal: () => modal, cardDaFrente: () => card, devolverFoco: () => log.push('reserva'),
    Lightbox: { isOpen: () => lbAberto },
  };
  const nomes = ['focavelNaTela', 'dentroDeCamada', 'devolverFocoDaAmpliacao', 'manterFocoNoLightbox'];
  const f = new Function(...Object.keys(deps), nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(
    ...Object.values(deps));
  return { ...f, log };
}

test('L12 fechar a foto/o mapa devolve o foco a quem ABRIU, ou ao card da frente, ou à reserva', () => {
  doc.activeElement = doc.body;
  const quem = elFoco('foto do card');
  const h = helpers();
  h.devolverFocoDaAmpliacao(quem, ['.card-image']);
  assert.equal(doc.activeElement && doc.activeElement.nome, 'foto do card', 'o foco não voltou pra quem abriu a foto');
  // Quem abriu SAIU da tela (aprovar e fechar avança o card): vai pro card novo.
  doc.activeElement = doc.body;
  const novo = elFoco('foto do card NOVO');
  const h2 = helpers({ card: { querySelector: (s) => (s === '.card-image' ? novo : null) } });
  h2.devolverFocoDaAmpliacao(elFoco('velha', { conectado: false }), ['.card-image']);
  assert.equal(doc.activeElement.nome, 'foto do card NOVO', 'com o card trocado, o foco caiu fora dele');
  // Nada focável: a reserva dos modais (`devolverFoco`), nunca o <body> calado.
  doc.activeElement = doc.body;
  const h3 = helpers({ card: { querySelector: () => null } });
  h3.devolverFocoDaAmpliacao(null, ['.card-image']);
  assert.deepEqual(h3.log, ['reserva'], 'sem ninguém pra receber, não passou pela reserva');
  // Um modal por cima é dono do foco: nada se mexe.
  doc.activeElement = doc.body;
  const h4 = helpers({ modal: {} });
  h4.devolverFocoDaAmpliacao(elFoco('foto do card'), ['.card-image']);
  assert.equal(doc.activeElement, doc.body, 'com um modal aberto por cima, o foco foi parar atrás dele');
});

test('L12 com a foto aberta, o foco que se perde volta pra pílula do nome — ou pro ✕, com ela travada', () => {
  const lbEl = { contains: (x) => x && x.dentroDoLb === true };
  const pilula = Object.assign(elFoco('pílula'), { dentroDoLb: true });
  const fechar = Object.assign(elFoco('✕'), { dentroDoLb: true });
  doc.activeElement = doc.body;
  helpers({ lb: { imageLightbox: lbEl, lightboxNomeBtn: pilula, lightboxClose: fechar } }).manterFocoNoLightbox();
  assert.equal(doc.activeElement.nome, 'pílula', 'o foco perdido ficou no <body> com a foto aberta');
  doc.activeElement = doc.body;
  const travada = Object.assign(elFoco('pílula', { disabled: true }), { dentroDoLb: true });
  helpers({ lb: { imageLightbox: lbEl, lightboxNomeBtn: travada, lightboxClose: fechar } }).manterFocoNoLightbox();
  assert.equal(doc.activeElement.nome, '✕', 'com a pílula travada o foco não foi pro ✕');
  // CONTROLE: quem já está num controle VIVO da camada não é mexido.
  const outro = Object.assign(elFoco('‹'), { dentroDoLb: true });
  doc.activeElement = outro;
  helpers({ lb: { imageLightbox: lbEl, lightboxNomeBtn: pilula, lightboxClose: fechar } }).manterFocoNoLightbox();
  assert.equal(doc.activeElement.nome, '‹', 'tirou o foco de um controle vivo da camada');
  // E com a foto fechada, nada.
  doc.activeElement = doc.body;
  helpers({ lbAberto: false, lb: { imageLightbox: lbEl, lightboxNomeBtn: pilula, lightboxClose: fechar } }).manterFocoNoLightbox();
  assert.equal(doc.activeElement, doc.body);
});

test('L12 os caminhos: fechar a foto e o mapa devolvem o foco, e sair da edição o mantém na camada', () => {
  const metodo = (obj, nome) => {
    const ini = APP_SEM.indexOf(`const ${obj} = {`);
    const m = new RegExp('^    ' + nome + '\\(', 'm').exec(APP_SEM.slice(ini));
    assert.ok(m, `${obj}.${nome} sumiu`);
    const i = ini + m.index;
    return APP_SEM.slice(i, fechar(APP_SEM, APP_SEM.indexOf(')', i)));
  };
  assert.match(metodo('Lightbox', 'open'), /this\._quemAbriu = document\.activeElement;/);
  assert.match(metodo('Lightbox', 'close'), /devolverFocoDaAmpliacao\(quem, \['\.card-image', '\.card-map'\]\)/,
    'fechar a foto deixou de devolver o foco a quem abriu');
  assert.match(metodo('MapaLightbox', 'open'), /this\._quemAbriu = document\.activeElement;/);
  assert.match(metodo('MapaLightbox', 'close'), /devolverFocoDaAmpliacao\(quem, \['\.card-map', '\.card-image'\]\)/,
    'fechar o mapa deixou de devolver o foco a quem abriu');
  assert.match(fatiar('sairDaEdicaoNome'), /fecharEdicaoNome\(\);\s*manterFocoNoLightbox\(\);/,
    'sair da edição deixou de manter o foco na camada');
  // A foto do card pode RECEBER o foco de volta sem entrar no Tab.
  const html = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
  assert.match(html, /<img class="card-image [^>]*tabindex="-1"/, 'a foto do card deixou de poder receber o foco de volta');
});

// ── A APROVAÇÃO de foto é um pedido "em andamento" (achado da auditoria da
// fila, 2026-09-26). O ✕/✓ marcam o pedido do gesto ao fim do envio
// (`pedidosEmAndamento`, que o `semOsJaDecididos` consulta); a aprovação não
// marcava: um ↻ na janela do Desfazer trazia o pedido aprovado de volta como
// card na fila nova, e depois a aprovação saía e o card virava "já tratado".
// As funções de VERDADE (`aprovarFotoAtual`, `enviarAprovacao`,
// `marcarEmAndamento`, `chaveDoPedido`), com o relógio e o Waze de mentira.
function montarAprovacao({ semJanela = false, resposta = { success: true } } = {}) {
  const log = [];
  const L = lightbox();
  const A = pedidoDeFoto('ur-A');
  abrir(L, A, [FOTO('velha'), FOTO('ur-A')], 1);
  const AppState = { authenticated: true, preferences: { undoEnabled: !semJanela }, serverTotal: 5, currentPlace: A, queue: [A] };
  const timers = [];
  let responder = null;
  const emAndamento = new Set();
  const deps = {
    AppState, Lightbox: L, Treino: { ativo: false }, epocaDaSessao: 0, pedidosEmAndamento: emAndamento,
    canDisableUndo: () => true, estadoAprovando: () => {}, fotoDoLightboxNaTela: () => true, manterFocoNoLightbox: () => {},
    API: { aprovarPedido: () => new Promise((ok) => { responder = () => ok(resposta); }), getRegion: () => 'row' },
    aprovandoAgora: false, excluindoAgora: false, updatePendingCount: () => {}, aoMudarAFilaPorBaixo: () => {},
    verificandoSessao: false, conferenciaDaSessao: null,
    registrarPouso: () => log.push('pouso'), updateStats: () => {}, contarConquista: () => {}, advanceQueue: () => {},
    handleUnauthorized: () => {}, showToast: () => {}, msgDoServidor: () => '', t: (k) => k,
    aplicarTravaDeAcao: () => {}, removeUndoBanner: () => {}, mostrarDesfazer: () => {}, registrarDesfazer: () => {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, UNDO_WINDOW_MS: 3000,
    callWithRetry: (fn) => fn(), sessaoVivaDepoisDe: () => false, escritasConferindo: 0,
    // A busca de verdade (`semOsJaDecididos`), sem fila de saída nem pouso: o
    // que a tira da fila nova é só o "em andamento".
    carregarFilaDeSaida: () => [], pousosDaPagina: new Map(), offlineLigado: () => false, offlineLerPousos: () => [],
    voltarDaAprovacaoRecusada: () => {}, refazerSelosSeOutroNaTela: () => {},
    // A aprovação no ar trava o card do pedido (A1, medido em test/lote-autor.test.mjs).
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID,
    mantendoFocoNoCard: (redesenhar) => redesenhar(),
  };
  const nomes = ['chaveDoPedido', 'marcarEmAndamento', 'semOsJaDecididos', 'enviarAprovacao', 'concluirAprovacao',
    'aprovarFotoAtual', 'refazerDepoisDo401', 'tirarAprovadoDaFila', 'pousouNoWaze', 'escritaDoLightboxSemSessao',
    'contarIdasSemResposta'];
  const chaves = Object.keys(deps);
  const corpo = nomes.map(fatiar).join('\n')
    .replace(/placeResolvidoPorAprovacao = /g, '__res.v = ')
    .replace(/aprovacaoPendente/g, '__pend.a').replace(/exclusaoPendente/g, '__pend.e');
  const pend = { a: null, e: null };
  const app = new Function(...chaves, '__res', '__pend', corpo + `\nreturn { ${nomes.join(', ')} };`)(
    ...chaves.map((k) => deps[k]), { v: null }, pend);
  const chave = `${A.venueID}|${A.updateRequestID}`;
  // O ↻: a fila nova traz o MESMO pedido num objeto novo, como o Waze devolve.
  const busca = () => app.semOsJaDecididos([{ ...A }], 0).places.length;
  return { app, A, log, pend, timers, emAndamento, chave, busca, responder: () => responder && responder() };
}
const umTique = () => new Promise((r) => setTimeout(r, 0));

test('aprovação em andamento: marcada do GESTO ao fim do envio — o ↻ na janela não traz o pedido de volta', async () => {
  const m = montarAprovacao();
  assert.equal(m.busca(), 1, 'CONTROLE: antes do gesto a busca traz o pedido');
  m.app.aprovarFotoAtual();
  assert.ok(m.emAndamento.has(m.chave), 'na janela do Desfazer a aprovação não marcou o pedido: um ↻ o traria de volta');
  assert.equal(m.busca(), 0, 'na janela do Desfazer, a busca (o ↻) trouxe o pedido aprovado de volta');
  m.timers[0]();                                    // a janela fecha sozinha: a aprovação sai
  assert.ok(m.emAndamento.has(m.chave), 'com a aprovação NO AR o pedido deixou de estar em andamento');
  m.responder(); await umTique(); await umTique();
  assert.ok(!m.emAndamento.has(m.chave), 'depois do pouso o pedido ficou "em andamento" pra sempre');
  assert.deepEqual(m.log, ['pouso']);
});

test('aprovação em andamento: o Desfazer e a FALHA soltam a marca (o pedido volta a ser só um pedido da fila)', async () => {
  const d = montarAprovacao();
  d.app.aprovarFotoAtual();
  d.pend.a.desfazer();
  assert.ok(!d.emAndamento.has(d.chave), 'o Desfazer deixou o pedido marcado: nenhuma busca o traria mais');
  assert.equal(d.busca(), 1, 'desfeita a aprovação, a busca não traz mais o pedido');
  const f = montarAprovacao({ resposta: { success: false, errorCategory: 'unknown' } });
  f.app.aprovarFotoAtual();
  f.timers[0]();
  f.responder(); await umTique(); await umTique();
  assert.ok(!f.emAndamento.has(f.chave), 'a aprovação que FALHOU deixou o pedido marcado');
  // SEM Desfazer: marcado durante o voo, solto no fim.
  const s = montarAprovacao({ semJanela: true });
  s.app.aprovarFotoAtual();
  assert.ok(s.emAndamento.has(s.chave), 'sem Desfazer, a aprovação no ar não marcou o pedido');
  s.responder(); await umTique(); await umTique();
  assert.ok(!s.emAndamento.has(s.chave));
});

// ═══ Auditoria de 2026-09-29 (rodada 8): as escritas do lightbox ══════════════

// ── L24: UM escritor do `disabled` dos botões de foto ─────────────────────────
// Sem Desfazer, o `estadoAprovando` e a `lixeiraOcupada` desabilitavam o botão
// durante o envio, e a trava (`aplicarTravaDeAcao`) — que roda em todo abrir e
// fechar da edição do nome, e em todo fechar do lightbox — o reabria. MEDIDO:
// o "Aprovar" com o spinner voltava vivo e o 2º toque mandava uma 2ª aprovação
// ("Restam" caindo 2 por um pedido); a lixeira, uma 2ª exclusão.
test('L24 a escrita de foto SEM janela no ar segura o botão, mesmo quando a trava roda de novo', () => {
  const classes = () => ({ c: new Set(), toggle(k, v) { if (v) this.c.add(k); else this.c.delete(k); }, contains(k) { return this.c.has(k); } });
  const botao = () => ({ disabled: false, classList: classes(), querySelector: () => null });
  const el = { lightboxApprove: botao(), lightboxDelete: botao(), lightboxNomeBtn: botao(),
    lightboxApproveSpinner: botao(), lightboxApproveIcon: botao() };
  // `aplicarFocoDoTeclado`/`dispensarAvisoDaTrava`: o que a trava faz ao mudar
  // no card (lote 8 do card, C10 e C14); aqui não são o assunto.
  const app = new Function('document', 'acoesTravadas', 'cardDaFrente', 'editandoNome', 'renomeacaoNoAr', 'Lightbox',
    'atualizarBotaoSalvarNome', 'aplicarFocoDoTeclado', 'dispensarAvisoDaTrava',
    'let aprovandoAgora = false, excluindoAgora = false;\n'
    + ['estadoAprovando', 'lixeiraOcupada', 'aplicarTravaDeAcao'].map(fatiar).join('\n')
    + '\nreturn { estadoAprovando, lixeiraOcupada, aplicarTravaDeAcao };')(
    { getElementById: (id) => el[id] || null }, () => false, () => null, () => false, () => false, { place: null }, () => {},
    () => {}, () => {});
  app.estadoAprovando(true);
  assert.equal(el.lightboxApprove.disabled, true, 'CONTROLE: com a aprovação no ar o "Aprovar" não travou');
  app.aplicarTravaDeAcao();                         // abrir/fechar a edição do nome, fechar o lightbox
  assert.equal(el.lightboxApprove.disabled, true, 'a trava REABRIU o "Aprovar" no meio do envio: o 2º toque manda outra aprovação');
  assert.equal(el.lightboxDelete.disabled, true, 'com a aprovação no ar a lixeira (o mesmo canto) ficou viva');
  app.estadoAprovando(false);
  assert.equal(el.lightboxApprove.disabled, false, 'a resposta chegou e o "Aprovar" não destravou');
  app.lixeiraOcupada(true);
  app.aplicarTravaDeAcao();
  assert.equal(el.lightboxDelete.disabled, true, 'a trava REABRIU a lixeira no meio da exclusão: sai uma 2ª');
  assert.ok(el.lightboxDelete.classList.contains('lixeira-ocupada'));
  app.lixeiraOcupada(false);
  assert.equal(el.lightboxDelete.disabled, false);
  // O escritor é UM só: quem liga o "ocupado" não escreve o `disabled`.
  for (const nome of ['estadoAprovando', 'lixeiraOcupada']) {
    assert.doesNotMatch(fatiar(nome), /\.disabled\s*=/, `${nome} voltou a escrever o disabled por fora da trava`);
  }
});

test('L24 aprovar e excluir recusam com uma escrita de foto sem janela no ar — teclado e script não furam', async () => {
  for (const acao of ['aprovarFotoAtual', 'pedirExclusaoDaFoto']) {
    for (const noAr of [{ aprovandoAgora: true }, { excluindoAgora: true }, {}]) {
      const m = montarEscritas({ resposta: { success: true }, noAr });
      m.L.place.approvedImageIds = ['velha'];
      if (acao === 'pedirExclusaoDaFoto') { m.L.idx = 0; m.L.idFotoAtual = () => 'velha'; }
      m.app[acao]();
      await new Promise((r) => setTimeout(r, 0));
      const saiu = m.log.some((l) => l.startsWith('api:aprovar') || l.startsWith('api:excluir'));
      if (Object.keys(noAr).length) assert.ok(!saiu, `${acao} com ${Object.keys(noAr)[0]}: saiu uma 2ª escrita de foto`);
      else assert.ok(saiu, `CONTROLE ${acao}: sem nada no ar, a escrita não saiu`);
    }
  }
});

// ── L22: o aprovado que NÃO é o card da frente sai da fila pela identidade ────
// Fila [A, B (foto nova), C]: ✕ em A, a foto de B aberta, o Desfazer (o banner
// por cima da foto, ou a tecla z) devolve A pra frente, B é aprovado e a foto
// fecha. B ficava na fila já resolvido: MEDIDO, [A, B, C] com "Restam 2"; ao
// chegar nele, o ✓ mandava uma 2ª decisão ao Waze e o "Restam" terminava em 0
// com C na tela.
test('L22 aprovar B com A de volta na frente (o Desfazer): B sai da fila, A fica, e o card de fundo se refaz', () => {
  const log = [];
  const A = { venueID: 'vA', updateRequestID: 'uA' }, B = pedidoDeFoto('uB'), C = { venueID: 'vC', updateRequestID: 'uC' };
  const L = lightbox();
  abrir(L, B, [FOTO('uB')], 0);                     // a foto de B aberta
  const AppState = { queue: [A, B, C], currentPlace: A, serverTotal: 3, fetchEpoch: 0 };
  let resolvido = null;
  const deps = { AppState, Lightbox: L, registrarPouso: () => log.push('pouso'), updateStats: () => {},
    advanceQueue: () => log.push('avancou'), updatePendingCount: () => log.push('restam'),
    aoMudarAFilaPorBaixo: () => log.push('fundo'), aprovacaoPendente: null,
    mantendoFocoNoCard: (redesenhar) => redesenhar() };
  const chaves = Object.keys(deps);
  const corpo = ['concluirAprovacao', 'avancarSeAprovado', 'tirarAprovadoDaFila'].map(fatiar).join('\n')
    .replace(/placeResolvidoPorAprovacao = /g, '__res.v = ').replace(/const alvo = placeResolvidoPorAprovacao/, 'const alvo = __res.v')
    .replace(/let tratouNestaFila/g, 'var __t');
  const app = new Function(...chaves, '__res', 'let tratouNestaFila = false;\n' + corpo
    + '\nreturn { concluirAprovacao, avancarSeAprovado };')(
    ...chaves.map((k) => deps[k]), { get v() { return resolvido; }, set v(x) { resolvido = x; } });
  app.concluirAprovacao({ id: 'uB', place: B, idx: 0, epocaFila: 0 });
  assert.equal(AppState.serverTotal, 2, 'CONTROLE: a aprovação desconta o "Restam"');
  assert.deepEqual(AppState.queue, [A, B, C], 'CONTROLE: com a foto de B aberta, B espera o fechar');
  L.aberto = false;
  app.avancarSeAprovado();                          // o fechar da foto
  assert.deepEqual(AppState.queue, [A, C], 'B, já aprovado, ficou na fila: o ✓ nele mandaria uma 2ª decisão ao Waze');
  assert.equal(AppState.currentPlace, A, 'o card da frente (A, devolvido pelo Desfazer) foi trocado');
  assert.ok(!log.includes('avancou'), 'a fila andou: A saiu da frente sem ninguém decidir A');
  assert.ok(log.includes('restam') && log.includes('fundo'), 'o "Restam" e o card de fundo (que anunciava B) não se refizeram');
  // CONTROLE: quando o aprovado É o da frente, a fila anda, como sempre.
  const f = new Function('AppState', 'advanceQueue', 'updatePendingCount', 'aoMudarAFilaPorBaixo', 'mantendoFocoNoCard',
    fatiar('tirarAprovadoDaFila') + '\nreturn tirarAprovadoDaFila;');
  const Q = { queue: [A, C], currentPlace: A };
  const lg = [];
  f(Q, () => lg.push('avancou'), () => {}, () => {}, (redesenhar) => redesenhar())(A);
  assert.deepEqual(lg, ['avancou']);
  // E fora da fila (↻ e filtro refazem a fila; o pedido nem está nela): nada.
  const R = { queue: [C], currentPlace: C };
  f(R, () => lg.push('X'), () => lg.push('X'), () => lg.push('X'))(B);
  assert.deepEqual(R.queue, [C]);
  assert.ok(!lg.includes('X'));
});

// ── L23: renomear duas vezes com a primeira ainda no ar ───────────────────────
// Sem Desfazer, renomear pra B e logo pra C: com a 1ª levando uma falha
// passageira, a retentativa dela chegava DEPOIS da 2ª e o Waze ficava com "B"
// e a tela com "C"; com a 1ª falhando de vez, a tela voltava pra "A" com o
// Waze em "C". MEDIDO no navegador. Uma por local (pílula travada), a escrita
// superada não sai de novo, e a falha só volta a tela se o nome nela ainda for
// o desta escrita.
function montarRenomeio({ API }) {
  const log = [];
  const P = { venueID: 'v1', updateRequestID: 'ur-P', name: 'B' };
  const irmao = { venueID: 'v1', updateRequestID: 'ur-Q', name: 'A' };
  const outro = { venueID: 'v2', updateRequestID: 'ur-Z', name: 'Z' };
  const L = lightbox();
  abrir(L, P, [FOTO('p1')], 0);
  const AppState = { queue: [P, irmao, outro], currentPlace: P };
  const noAr = new Set();
  const deps = {
    AppState, Lightbox: L, API, callWithRetry: async (fn) => {
      // A política de verdade em miniatura: repete UMA vez o `transient`.
      const r = await fn();
      if (r && r.errorCategory === 'transient') { log.push('retentativa'); return fn(); }
      return r;
    },
    renomeacoesNoAr: noAr, aplicarTravaDeAcao: () => log.push('trava'), handleUnauthorized: () => {},
    sessaoVivaDepoisDe: () => false, showToast: (m, tipo) => log.push(`toast:${tipo}:${m}`), msgDoServidor: () => '',
    t: (k) => k, contarConquista: () => {}, montarCardDeFundo: () => {}, cardDaFrente: () => null,
    document: { getElementById: () => null },
  };
  const nomes = ['enviarRenomeacao', 'renomeacaoNoAr', 'nomeDestaEscrita', 'devolverNome', 'aplicarNomeNaTela',
    'aplicarNosIrmaos', 'escritaDoLightboxSemSessao', 'refazerDepoisDo401'];
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, 'let epocaDaSessao = 0, escritasConferindo = 0, verificandoSessao = false, conferenciaDaSessao = null;\n'
    + nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(...chaves.map((k) => deps[k]));
  return { app, P, irmao, outro, log, noAr };
}

test('L23 a pílula do local fica travada com a renomeação no ar — o irmão também; outro local, não', async () => {
  let soltar;
  const m = montarRenomeio({ API: { renomearLocal: () => new Promise((ok) => { soltar = ok; }) } });
  const envio = m.app.enviarRenomeacao({ place: m.P, novo: 'B', antigo: 'A' });
  assert.equal(m.app.renomeacaoNoAr(m.P), true, 'com a renomeação no ar, dava pra "corrigir de novo" e as duas cruzavam');
  assert.equal(m.app.renomeacaoNoAr(m.irmao), true, 'o pedido IRMÃO (o mesmo local) ficou livre pra renomear por cima');
  assert.equal(m.app.renomeacaoNoAr(m.outro), false, 'CONTROLE: travou a pílula de OUTRO local');
  assert.ok(m.log.includes('trava'), 'a trava não foi reaplicada: a pílula seguiu com cara de viva');
  soltar({ success: true });
  await envio;
  assert.equal(m.app.renomeacaoNoAr(m.P), false, 'a resposta chegou e a pílula não destravou');
  assert.equal(m.log.at(-1), 'trava', 'o fim da renomeação não reaplicou a trava');
  // E quem abre a edição e quem confirma consultam o "no ar" (e a trava).
  assert.match(fatiar('abrirEdicaoNome'), /acoesTravadas\(\) \|\| renomeacaoNoAr\(Lightbox\.place\)\) return;/,
    'a edição do nome abre com uma renomeação do local no ar');
  assert.match(fatiar('aplicarTravaDeAcao'), /pilula\.disabled = travado \|\| editandoNome\(\) \|\| renomeacaoNoAr\(Lightbox\.place\)/,
    'a pílula não trava com a renomeação no ar');
});

test('L23 a escrita SUPERADA não sai de novo, e a falha só volta a tela se o nome nela ainda é o desta escrita', async () => {
  // A 1ª ida leva uma falha passageira e, antes da retentativa, o nome na tela
  // deixa de ser o desta escrita (outra escrita passou por cima).
  let m;
  const idas = [];
  m = montarRenomeio({ API: { renomearLocal: async (v, nome) => {
    idas.push(nome);
    if (idas.length === 1) { m.P.name = 'C'; return { success: false, errorCategory: 'transient' }; }
    return { success: true };
  } } });
  await m.app.enviarRenomeacao({ place: m.P, novo: 'B', antigo: 'A' });
  assert.deepEqual(idas, ['B'], 'a retentativa gravou "B" por cima do nome que a tela mostra ("C")');
  assert.ok(m.log.includes('retentativa'), 'CONTROLE: a retentativa aconteceu (e foi ela que não saiu)');
  assert.equal(m.P.name, 'C', 'a tela saiu do nome mais novo');
  assert.ok(!m.log.some((l) => l.startsWith('toast:')), 'avisou uma falha sobre um nome que a tela já não mostra');
  // A falha de VEZ com a tela noutro nome: não volta pro "antigo" por cima dele.
  let n;
  n = montarRenomeio({ API: { renomearLocal: async () => { n.P.name = 'C'; return { success: false, errorCategory: 'unknown' }; } } });
  await n.app.enviarRenomeacao({ place: n.P, novo: 'B', antigo: 'A' });
  assert.equal(n.P.name, 'C', 'a falha da 1ª voltou a tela pro nome de ANTES por cima do nome mais novo');
  // CONTROLE: com a tela ainda no nome desta escrita, a falha volta e avisa.
  const c = montarRenomeio({ API: { renomearLocal: async () => ({ success: false, errorCategory: 'unknown' }) } });
  await c.app.enviarRenomeacao({ place: c.P, novo: 'B', antigo: 'A' });
  assert.equal(c.P.name, 'A');
  assert.deepEqual(c.log.filter((l) => l.startsWith('toast:')), ['toast:error:toast.renameFailed']);
});

// A hipótese do L23, confirmada no navegador: com a edição aberta, o Enter
// renomeava DURANTE a conferência de um 401 de outra escrita do lightbox (a
// trava ligada, o ✓ com cara de vivo). MEDIDO: 1 `renomear-local` saindo.
test('L23 (hipótese) o Enter com as ações travadas não renomeia: avisa, e a edição fica aberta', () => {
  for (const travado of [true, false]) {
    const log = [];
    const place = { venueID: 'v1', updateRequestID: 'u1', name: 'Nome Velho' };
    const deps = {
      Treino: { ativo: false }, podeRenomearAqui: () => true, AppState: { authenticated: true, preferences: { undoEnabled: true } },
      document: { getElementById: (id) => (id === 'lightboxNomeInput' ? { value: 'Nome Novo' } : null) },
      Lightbox: { place }, acoesTravadas: () => travado, avisoDaTrava: () => 'toast.esperaSessao', renomeacaoNoAr: () => false,
      showToast: (m) => log.push('toast:' + m), t: (k) => k, sairDaEdicaoNome: () => log.push('saiu'),
      fecharEdicaoNome: () => log.push('fechou'), aplicarNomeNaTela: (p, n) => log.push('nome:' + n),
      API: { getRegion: () => 'row' }, canDisableUndo: () => false, enviarRenomeacao: () => log.push('ENVIOU'),
      renomeacaoPendente: null, aprovacaoPendente: null, exclusaoPendente: null,
      setTimeout: () => 1, clearTimeout() {}, UNDO_WINDOW_MS: 3000, aplicarTravaDeAcao() {}, removeUndoBanner() {},
      registrarDesfazer() {}, mostrarDesfazer: () => log.push('banner'), manterFocoNoLightbox() {},
    };
    const chaves = Object.keys(deps);
    const confirmar = new Function(...chaves, fatiar('confirmarRenomear') + '\nreturn confirmarRenomear;')(...chaves.map((k) => deps[k]));
    confirmar();
    if (travado) {
      assert.ok(!log.includes('banner') && !log.some((l) => l.startsWith('nome:')),
        'com as ações travadas (a conferência de um 401), o Enter renomeou');
      assert.deepEqual(log, ['toast:toast.esperaSessao'], 'o Enter travado saiu calado — ou fechou a edição, perdendo o nome digitado');
    } else {
      assert.ok(log.includes('banner') && log.includes('nome:Nome Novo'), 'CONTROLE: sem trava o Enter não renomeou');
    }
  }
  // O ✓ trava junto (quem escreve o `disabled` dele é o `atualizarBotaoSalvarNome`).
  assert.match(fatiar('atualizarBotaoSalvarNome'), /ok\.disabled = acoesTravadas\(\) \|\|/, 'o ✓ da edição fica com cara de vivo durante a trava');
  assert.match(fatiar('aplicarTravaDeAcao'), /if \(editandoNome\(\)\) atualizarBotaoSalvarNome\(\);/,
    'a trava que liga e desliga não reavalia o ✓ da edição');
});

// ── L25: ↻, Filtros e Treino DESPACHAM as escritas do lightbox na janela ──────
// Eles só tiravam o banner: a janela seguia correndo sem ele, o card ficava
// travado ~2,5 s sem banner ("espere o Desfazer" de um Desfazer que sumiu), e a
// escrita saía no fim mesmo assim. MEDIDO: ↻ com a exclusão na janela, a
// exclusão saindo aos ~2,6 s. Agora ela sai na hora, como a do card.
test('L25 as três escritas do lightbox na janela SAEM com a fila trocada — pela função que o "Marcar todos" já seguia', () => {
  const saiu = [];
  const pend = (n) => ({ enviar: () => saiu.push(n) });
  const enviar = new Function('aprovacaoPendente', 'exclusaoPendente', 'renomeacaoPendente', 'console',
    fatiar('enviarPendenciasDoLightbox') + '\nreturn enviarPendenciasDoLightbox;');
  enviar(pend('aprovar'), pend('excluir'), pend('renomear'), console)();
  assert.deepEqual(saiu, ['aprovar', 'excluir', 'renomear']);
  enviar(null, null, null, console)();              // CONTROLE: sem janela nenhuma, nada
  assert.deepEqual(saiu, ['aprovar', 'excluir', 'renomear']);
  // Quem troca a fila com a sessão viva chama ANTES de tirar o banner (senão a
  // janela corre sem ele). Por LINHA, sem comentário (gotcha #67).
  for (const [nome, corpo] of [['resetQueue', fatiar('resetQueue')], ['Treino.entrar', trechoDoTreino('entrar')]]) {
    const i = corpo.indexOf('enviarPendenciasDoLightbox();');
    assert.ok(i > 0, `${nome}: não despacha as escritas do lightbox — o banner some e a janela segue correndo`);
    assert.ok(i < corpo.indexOf('removeUndoBanner();'), `${nome}: tira o banner ANTES de despachar a janela`);
  }
});
function trechoDoTreino(metodo) {
  const ini = APP_SEM.indexOf('const Treino = {');
  const m = new RegExp('^    ' + metodo + '\\(\\) \\{', 'm').exec(APP_SEM.slice(ini));
  assert.ok(m, `Treino.${metodo} sumiu`);
  const i = ini + m.index;
  return APP_SEM.slice(i, fechar(APP_SEM, i));
}

// ── L26: a região é a do GESTO — as quatro escritas do lightbox ───────────────
// Saíam com a região do ENVIO: trocada a região na janela (Filtros → NA →
// Aplicar), a exclusão e a renomeação saíam com `region=na` e voltavam como
// falha; a aprovação com a 1ª tentativa passageira ia na retentativa pra NA, e
// o `not_found` de lá contava como aprovada, calado. MEDIDO no navegador.
test('L26 aprovar, excluir e aquecer a exclusão levam a região do GESTO, não a do envio', async () => {
  const regiao = { v: 'row' };
  const e = montarEscritas({ resposta: { success: true }, preferencias: { undoEnabled: true }, regiao });
  e.L.place.approvedImageIds = ['velha'];
  e.L.place.lat = -23; e.L.place.lon = -46;
  e.L.idx = 0; e.L.idFotoAtual = () => 'velha';
  e.app.pedirExclusaoDaFoto();                      // o gesto, em row
  regiao.v = 'na';                                  // a troca de região na janela
  e.timers.at(-1)();                                // a janela vence: a exclusão sai
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(e.log.includes('api:preparar:row'), 'o aquecimento da exclusão foi sem a região do gesto');
  assert.ok(e.log.includes('api:excluir:row'), `a exclusão saiu com a região do ENVIO: ${e.log.filter((l) => l.startsWith('api:')).join(', ')}`);
  const regiaoA = { v: 'row' };
  const a = montarEscritas({ resposta: { success: true }, preferencias: { undoEnabled: true }, regiao: regiaoA });
  a.app.aprovarFotoAtual();                         // o gesto, em row
  regiaoA.v = 'na';                                 // a troca de região na janela
  a.timers.at(-1)();                                // a janela vence: a aprovação sai
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(a.log.includes('api:aprovar:row'), `a aprovação saiu com a região do ENVIO: ${a.log.filter((l) => l.startsWith('api:')).join(', ')}`);
  // E o renomear: o `alvo` carrega a região do gesto até o envio.
  assert.match(fatiar('confirmarRenomear'), /const alvo = \{ place, antigo, novo, regiao: API\.getRegion\(\) \};/);
  assert.match(fatiar('enviarRenomeacao'), /API\.renomearLocal\(local, alvo\.novo, alvo\.regiao\)/);
});

test('L26 a API honra a região que vem da ação (e sem ela, a de agora)', async () => {
  const { default: vm } = await import('node:vm');
  const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  const API_JS = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
  const corpos = [];
  const guardado = { waze_session_token: 'tok', waze_region: 'na', waze_lang: 'pt' };
  const ctx = {
    navigator: { language: 'pt-BR', onLine: true }, document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: (k) => (k in guardado ? guardado[k] : null), setItem: (k, v) => { guardado[k] = v; }, removeItem() {} },
    fetch: async (url, op) => { corpos.push(JSON.parse(op.body)); return { status: 200, headers: { get: () => null }, text: async () => '{"success":true}' }; },
    performance: { now: () => 0 }, console, setTimeout, clearTimeout, AbortController,
  };
  vm.createContext(ctx);
  vm.runInContext(I18N + '\n' + API_JS + '\nthis.API = API;', ctx);
  const API = ctx.API;
  await API.aprovarPedido('v', 'u', 'row');
  await API.excluirFoto('v', 'f', -23, -46, 'row');
  API.prepararExclusao('v', -23, -46, 'row');
  await API.renomearLocal('v', 'Nome', 'row');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(corpos.map((c) => c.region), ['row', 'row', 'row', 'row'],
    'uma escrita do lightbox foi com a região de AGORA (na), e não com a do gesto (row)');
  // CONTROLE: sem a região da ação, vale a de agora — o mesmo de sempre.
  corpos.length = 0;
  await API.aprovarPedido('v', 'u');
  await API.renomearLocal('v', 'Nome');
  assert.deepEqual(corpos.map((c) => c.region), ['na', 'na']);
});

// ── L30: aprovação "já tratada por outro editor" ─────────────────────────────
// Saía calada (o ✕ e o ✓ do card avisam) e a foto virava "aprovada" na tela,
// com a lixeira no lugar do "Aprovar": quem tratou pode ter RECUSADO, e a
// lixeira ofereceria apagar o que não está no mapa.
test('L30 a aprovação que outro editor tratou antes: avisa como o card, pousa, e a foto NÃO vira aprovada', async () => {
  for (const undoEnabled of [false, true]) {
    for (const cat of ['already_processed', 'not_found']) {
      const m = montarEscritas({ resposta: { success: false, errorCategory: cat }, preferencias: { undoEnabled } });
      m.app.aprovarFotoAtual();
      if (undoEnabled) m.timers.at(-1)();            // a janela vence
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      const rot = `${cat}, ${undoEnabled ? 'com' : 'sem'} Desfazer`;
      assert.ok(m.log.includes('toast:info:toast.alreadyProcessed'), `${rot}: o "já tratado por outro editor" não foi avisado`);
      assert.ok(!m.A.approvedImageIds.includes('ur-A'), `${rot}: a foto virou "aprovada" (a lixeira apagaria o que pode nem estar no mapa)`);
      assert.equal(m.L.newIdx, -1, `${rot}: a foto segue como proposta (✨ e "Aprovar") de um pedido que acabou`);
      m.L.idx = 1;
      assert.equal(m.L.podeAprovarAtual(), false, `${rot}: dava pra aprovar de novo`);
      assert.ok(m.log.includes('pouso'), `${rot}: o pedido tratado não pousou (voltaria como card)`);
    }
  }
  // CONTROLE: a aprovação DESTA pessoa marca a foto como aprovada, sem aviso.
  const ok = montarEscritas({ resposta: { success: true } });
  ok.app.aprovarFotoAtual();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(ok.A.approvedImageIds.includes('ur-A'));
  assert.ok(!ok.log.some((l) => l.startsWith('toast:')));
});

// ── L32: o texto alternativo da foto ampliada é o do card ────────────────────
test('L32 a foto ampliada diz o local como o card: nome, senão endereço — por uma função só', () => {
  const alt = new Function('t', fatiar('identidadeDoPlace') + '\n' + fatiar('altDaFoto') + '\nreturn altDaFoto;')(
    (k, v) => (v ? `${k}${JSON.stringify(v)}` : k));
  assert.equal(alt({ name: '', address: 'Rua das Flores, 250', purType: 'NEW_PHOTO' }, 1, 2),
    'card.img.alt{"name":"Rua das Flores, 250","i":1,"n":2}', 'o local sem nome não virou o endereço (a identidade do card)');
  assert.equal(alt({ name: 'Padaria', purType: 'NEW_PLACE' }, 2, 3), 'card.img.altNovoLocal{"name":"Padaria","i":2,"n":3}');
  // As DUAS telas pela mesma função (o mesmo pixel, o mesmo texto).
  assert.match(metodo('_render'), /img\.alt = altDaFoto\(this\.place \|\| \{ name: this\.placeName \}, this\.idx \+ 1, this\.urls\.length\);/,
    'a foto ampliada voltou a ter um texto próprio (sem nome, "Foto do place")');
  assert.match(fatiar('renderCardImages'), /img\.alt = altDaFoto\(place, currentImgIdx \+ 1, urls\.length\);/);
  // O texto velho saiu do dicionário, e o espanhol usa o termo do resto ("borrar").
  const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  assert.doesNotMatch(I18N, /lightbox\.img\.altGeneric|'lightbox\.img\.alt'/, 'a chave velha (com "place" no português e no espanhol) voltou');
  assert.match(I18N, /'srv\.err\.photoNotApproved': 'Solo se puede borrar una foto/, 'o espanhol voltou a dizer "eliminar" onde o resto diz "borrar"');
});

// ── A1: a APROVAÇÃO no ar trava o card do MESMO pedido (achado do lightbox,
// 2026-09-29; também na main c6d9f91). Com a aprovação saindo, o card do pedido
// seguia na frente com ✕ e ✓ vivos: sem o Desfazer, a rejeição saía JUNTO com a
// aprovação (duas decisões do mesmo pedido no Waze); com ele, ao fim da janela do
// ✕, com o placar contando um rejeitado de um pedido aprovado. As funções de
// VERDADE — a aprovação, a trava, o aviso, o ✕ e o ✓ e a entrada do gesto —, com
// o Waze de mentira e a época da sessão mutável (a queda).
function montarAprovacaoNoCard({ semJanela = true, resposta = { success: true } } = {}) {
  const log = [];
  const L = lightbox();
  const A = pedidoDeFoto('ur-A');
  const B = { venueID: 'v-B', updateRequestID: 'ur-B' };
  abrir(L, A, [FOTO('velha'), FOTO('ur-A')], 1);
  const AppState = { authenticated: true, preferences: { undoEnabled: !semJanela }, serverTotal: 5, currentPlace: A,
    pendingAction: null, stats: { read: 0, rejected: 0, skipped: 0 }, fetchEpoch: 0 };
  const timers = [];
  const respostas = [];
  let app = null;
  const deps = {
    AppState, Lightbox: L, Treino: { ativo: false }, pedidosEmAndamento: new Set(), aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(),
    canDisableUndo: () => true, estadoAprovando: () => {}, fotoDoLightboxNaTela: () => true, manterFocoNoLightbox: () => {},
    API: { aprovarPedido: () => new Promise((ok) => { respostas.push(() => ok(resposta)); }),
      getRegion: () => 'row', getCountry: () => 30 },
    registrarPouso: () => log.push('pouso'), updateStats: () => {}, saveStats: () => {}, contarConquista: () => {},
    advanceQueue: () => log.push('avancou'), handleUnauthorized: () => {}, showToast: () => {}, msgDoServidor: () => '', t: (k) => k,
    // A trava reaplicada: anota o que a trava diz NA HORA (o card destrava no fim?).
    aplicarTravaDeAcao: () => log.push('trava:' + app.acoesTravadas()),
    removeUndoBanner: () => {}, mostrarDesfazer: () => {}, registrarDesfazer: () => {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, UNDO_WINDOW_MS: 3000,
    callWithRetry: (fn) => fn(), sessaoVivaDepoisDe: () => false, escritasConferindo: 0, loteDeLidosEmVoo: false,
    voltarDaAprovacaoRecusada: () => {}, refazerSelosSeOutroNaTela: () => {}, direcaoTravada: () => false,
    scheduleAction: (tipo) => log.push('agendou:' + tipo), showCurrentPlace: () => log.push('card-de-volta'),
    // A escrita que não chegou ao Waze porque a sessão acabou volta na tela (lote 8
    // do lightbox, V2): aqui só se anota — o que se mede é a trava do card.
    escritaDoLightboxSemSessao: () => log.push('sem-sessao'),
    mantendoFocoNoCard: (redesenhar) => redesenhar(),
    // A resposta que POUSA depois da queda (R5-2-03): anotada; o que ela faz com a
    // fila está nos testes do R5-2-03, abaixo.
    pousouNoWaze: (r) => !!(r && (r.success || r.errorCategory === 'already_processed')),
    aprovacaoPousouDepoisDaQueda: () => log.push('pousou-depois-da-queda'),
  };
  const nomes = ['chaveDoPedido', 'marcarEmAndamento', 'enviarAprovacao', 'concluirAprovacao', 'aprovarFotoAtual',
    'refazerDepoisDo401', 'acoesTravadas', 'aprovacaoDaTelaNoAr', 'avisoDaTrava', 'handleReject', 'handleMarkAsRead',
    'agirNoPedidoDoGesto', 'contarIdasSemResposta', 'aprovacoesAtravessamAQueda'];
  const chaves = Object.keys(deps);
  const corpo = nomes.map(fatiar).join('\n')
    .replace(/placeResolvidoPorAprovacao = /g, '__res.v = ')
    .replace(/aprovacaoPendente/g, '__pend.a').replace(/exclusaoPendente/g, '__pend.e')
    .replace(/renomeacaoPendente/g, '__pend.r').replace(/epocaDaSessao/g, '__ep.v');
  const pend = { a: null, e: null, r: null };
  const ep = { v: 0 };
  // `aprovandoAgora`/`excluindoAgora`: o escritor único do `disabled` dos botões de
  // foto (lote 8 do lightbox, L24) — estado de módulo, como no app.
  app = new Function(...chaves, '__res', '__pend', '__ep',
    'let tratouNestaFila = false, aprovandoAgora = false, excluindoAgora = false;\n' + corpo
    + `\nreturn { ${nomes.join(', ')} };`)(...chaves.map((k) => deps[k]), { v: null }, pend, ep);
  const responder = async () => { respostas.shift()(); await umTique(); await umTique(); };
  return { app, A, B, AppState, log, pend, ep, timers, deps, responder, respostas };
}

test('A1: sem o Desfazer, com a aprovação NO AR o card do MESMO pedido trava — ✕, ✓ e o gesto não decidem, e o aviso diz qual espera', async () => {
  const m = montarAprovacaoNoCard();
  assert.equal(m.app.acoesTravadas(), false, 'CONTROLE: antes de aprovar, o card decide');
  m.app.aprovarFotoAtual();
  assert.equal(m.respostas.length, 1, 'PRÉ-CONDIÇÃO: a aprovação saiu e espera a resposta');
  assert.equal(m.app.acoesTravadas(), true, 'com a aprovação no ar, o card do mesmo pedido seguia decidível');
  assert.equal(m.log.at(-1), 'trava:true', 'o card não foi TRAVADO na tela quando a aprovação saiu (botão vivo com cara de vivo)');
  assert.equal(m.app.avisoDaTrava(), 'toast.esperaAprovacao', 'o aviso manda esperar outra coisa');
  m.app.handleReject();
  m.app.handleMarkAsRead();
  let decidiu = false;
  m.app.agirNoPedidoDoGesto(m.A, () => { decidiu = true; });
  assert.ok(!m.log.some((l) => l.startsWith('agendou')), `uma segunda decisão do mesmo pedido saiu com a aprovação no ar: ${m.log}`);
  assert.equal(decidiu, false, 'o gesto decidiu o pedido com a aprovação no ar');
  assert.equal(m.AppState.stats.rejected + m.AppState.stats.read, 0, 'o placar contou uma decisão que não pode sair');
  // A resposta chega: o card destrava — travar tem volta.
  await m.responder();
  assert.equal(m.app.acoesTravadas(), false, 'a aprovação respondeu e o card ficou travado');
  assert.equal(m.log.at(-1), 'trava:false', 'a trava não foi reaplicada no fim: os botões ficavam mortos');
});

test('A1: com o Desfazer, a janela trava (e diz "Desfazer"); a aprovação no ar trava depois dela (e diz "aprovação"); a FALHA também solta', async () => {
  const m = montarAprovacaoNoCard({ semJanela: false, resposta: { success: false, errorCategory: 'unknown' } });
  m.app.aprovarFotoAtual();
  assert.ok(m.pend.a, 'PRÉ-CONDIÇÃO: a janela do Desfazer da aprovação está aberta');
  assert.equal(m.app.acoesTravadas(), true);
  assert.equal(m.app.avisoDaTrava(), 'toast.esperaDesfazer', 'na janela o banner está na tela: a espera é a dele');
  m.timers[0]();                                    // a janela vence: a aprovação sai
  assert.equal(m.pend.a, null);
  assert.equal(m.app.acoesTravadas(), true, 'a janela venceu e o card do pedido destravou com a aprovação no ar');
  assert.equal(m.app.avisoDaTrava(), 'toast.esperaAprovacao');
  m.app.handleReject();
  assert.ok(!m.log.some((l) => l.startsWith('agendou')), 'o ✕ agendou a rejeição do pedido que está sendo aprovado');
  await m.responder();                               // o Waze recusa a aprovação
  assert.equal(m.app.acoesTravadas(), false, 'a aprovação FALHOU e o card ficou travado');
  m.app.handleReject();
  assert.deepEqual(m.log.filter((l) => l.startsWith('agendou')), ['agendou:reject'], 'CONTROLE: solta, o ✕ decide');
});

test('A1: CONTROLE — a aprovação no ar de OUTRO pedido não trava o card que está na tela', async () => {
  const m = montarAprovacaoNoCard();
  m.app.aprovarFotoAtual();
  assert.equal(m.app.acoesTravadas(), true, 'PRÉ-CONDIÇÃO: o card do pedido aprovado está travado');
  m.AppState.currentPlace = m.B;                    // o card da frente é de outro pedido
  assert.equal(m.app.acoesTravadas(), false, 'a aprovação de um pedido travou o card de OUTRO — a trava não é pelo pedido');
  m.app.handleReject();
  assert.deepEqual(m.log.filter((l) => l.startsWith('agendou')), ['agendou:reject']);
  await m.responder();
});

// ── A aprovação no ar ATRAVESSA a queda (follow-up do R5-2-03) ────────────────
// A queda solta as aprovações da sessão (V6) e a renovação com a MESMA conta
// mantém a fila — e o card do pedido aprovado voltava DESTRAVADO até a resposta
// chegar: MEDIDO no navegador (s18b), o ✕ mandava uma segunda decisão ao Waze, e
// o placar e a reincidência do autor contavam a rejeição de uma foto APROVADA
// (com a recusa automática, contra quem não errou). Na fila que atravessa a
// queda, o card segue travado até a resposta — pousando ou não.
test('A1 × queda: na fila que ATRAVESSA a queda, o card do pedido aprovado segue travado até a resposta — pousando ou não', async () => {
  for (const resposta of [{ success: true }, { success: false, errorCategory: 'unknown' }]) {
    const rotulo = resposta.success ? 'pousou' : 'não pousou';
    const m = montarAprovacaoNoCard({ resposta });
    m.app.aprovarFotoAtual();
    assert.equal(m.app.acoesTravadas(), true, 'PRÉ-CONDIÇÃO: travado com a aprovação no ar');
    // A queda (`derrubarSessao`: a época sobe e as aprovações no ar atravessam) e
    // a renovação com a MESMA conta: a fila fica (o `fetchEpoch` não muda).
    m.ep.v++;
    m.app.aprovacoesAtravessamAQueda();
    assert.equal(m.app.acoesTravadas(), true,
      `${rotulo}: DEFEITO — a sessão renovada destravou o card do pedido com a aprovação no ar`);
    assert.equal(m.app.avisoDaTrava(), 'toast.esperaAprovacao', `${rotulo}: o aviso manda esperar outra coisa`);
    m.app.handleReject();
    m.app.handleMarkAsRead();
    let decidiu = false;
    m.app.agirNoPedidoDoGesto(m.A, () => { decidiu = true; });
    assert.ok(!m.log.some((l) => l.startsWith('agendou')), `${rotulo}: uma segunda decisão saiu com a aprovação no ar: ${m.log}`);
    assert.equal(decidiu, false, `${rotulo}: o gesto decidiu o pedido com a aprovação no ar`);
    assert.equal(m.AppState.stats.rejected + m.AppState.stats.read, 0, `${rotulo}: o placar contou uma decisão que não pode sair`);
    // A resposta (velha) chega: o caminho da queda, e o card solta.
    await m.responder();
    assert.ok(m.log.includes(resposta.success ? 'pousou-depois-da-queda' : 'sem-sessao'),
      `${rotulo}: PRÉ-CONDIÇÃO — a resposta não passou pelo caminho da queda: ${m.log}`);
    assert.equal(m.app.acoesTravadas(), false, `${rotulo}: a resposta chegou e o card ficou travado`);
    assert.equal(m.log.at(-1), 'trava:false', `${rotulo}: a trava não foi reaplicada quando a resposta chegou`);
  }
});

test('A1 × queda: CONTROLES — a fila REFEITA (outra conta, ↻) não trava, e a resposta velha não solta a aprovação da sessão nova', async () => {
  const m = montarAprovacaoNoCard();
  m.app.aprovarFotoAtual();
  m.ep.v++;
  m.app.aprovacoesAtravessamAQueda();
  assert.equal(m.app.acoesTravadas(), true, 'PRÉ-CONDIÇÃO: na fila que atravessou, travado');
  // A fila refeita: outra conta (`esquecerOutraConta` → `resetQueue`), ↻, filtro.
  m.AppState.fetchEpoch++;
  assert.equal(m.app.acoesTravadas(), false, 'a fila refeita nasceu travada pela aprovação da sessão que caiu (V6)');
  // Na sessão nova a pessoa aprova o mesmo pedido (no app ele nem voltaria à fila
  // refeita: está em `pedidosEmAndamento`); a resposta VELHA chega depois.
  m.app.aprovarFotoAtual();
  assert.equal(m.respostas.length, 2, 'PRÉ-CONDIÇÃO: a aprovação da sessão nova saiu');
  assert.equal(m.app.acoesTravadas(), true);
  await m.responder();                               // a da sessão que caiu
  assert.equal(m.app.acoesTravadas(), true, 'a resposta da sessão que caiu soltou a trava da aprovação da sessão nova');
  await m.responder();
  assert.equal(m.app.acoesTravadas(), false);
});

test('A1: a queda passa as aprovações no ar pra fila que a atravessa; o "Sair" solta todas (V6)', () => {
  const SEM = APP_SEM;
  assert.match(fatiar('derrubarSessao'), /loteDeLidosEmVoo = false;\s*aprovacoesAtravessamAQueda\(\);/,
    'a queda não passa as aprovações no ar adiante: o card do pedido aprovado volta destravado na fila que fica');
  assert.match(fatiar('aprovacoesAtravessamAQueda'),
    /for \(const chave of aprovacoesNoAr\) aprovacoesDaQueda\.set\(chave, AppState\.fetchEpoch\);\s*aprovacoesNoAr\.clear\(\);/,
    'as aprovações da sessão que caiu não levam a fila em que estavam (ou seguem travando a sessão que vem)');
  assert.match(fatiar('handleLogout'), /loteDeLidosEmVoo = false;\s*aprovacoesNoAr\.clear\(\);\s*aprovacoesDaQueda\.clear\(\);/,
    'o "Sair" não solta as aprovações no ar: quem entra depois nasce travado pela resposta de quem saiu');
  assert.ok(SEM.includes('const aprovacoesNoAr = new Set();'));
  assert.ok(SEM.includes('const aprovacoesDaQueda = new Map();'));
});

// ── R5-3-04 (R56-4): a retentativa que volta "já feito" é a escrita DESTA pessoa
// (auditoria de 2026-09-30). A 1ª ida POUSA e a resposta se perde — a rede que
// caiu na volta, o servidor que largou o Waze lento (`transient`) —; o
// `callWithRetry` vai de novo, e a 2ª volta "já feito". O Waze não diz por quem:
// só o aparelho sabe que houve uma ida dele antes. MEDIDO no navegador, 2 idas,
// a 1ª com `route.abort('connectionreset')`: a exclusão dizia "Outro editor já
// tinha excluído 👍"; a aprovação dizia "Já tratado por outro editor 👍", tirava
// a foto das aprovadas (sem a lixeira, com ela no mapa) e não contava o
// "Curador". O `callWithRetry` de VERDADE (sem as esperas), com as escritas de
// verdade.
const TRANSIENT = { success: false, errorCategory: 'transient', error: 'Failed to fetch' };
function retentativaDeVerdade() {
  const tentativas = Number(/^const TRANSIENT_RETRY_ATTEMPTS = (\d+);$/m.exec(APP_SEM)[1]);
  return new Function('epocaDaSessao', 'sessaoTrocou', 'navigator', 'TRANSIENT_RETRY_ATTEMPTS',
    'TRANSIENT_RETRY_DELAYS_MS', 'setTimeout', fatiar('callWithRetry') + '\nreturn callWithRetry;')(
    0, () => ({ success: false, errorCategory: 'unauthorized' }), { onLine: true }, tentativas, [], (fn) => fn());
}
const avisos = (log) => log.filter((l) => l.startsWith('toast:'));

test('R5-3-04 aprovar: "já tratado" depois de uma ida SEM resposta é a aprovação desta pessoa — aprovada, com o "Curador", sem aviso', async () => {
  for (const respostas of [[TRANSIENT, { success: false, errorCategory: 'already_processed' }],
    [TRANSIENT, { success: false, errorCategory: 'not_found' }],
    [TRANSIENT, TRANSIENT, { success: false, errorCategory: 'already_processed' }]]) {
    const m = montarL1({ respostas, viva: true, retentativa: retentativaDeVerdade() });
    const alvo = { id: 'ur-P', place: m.P, idx: 0 };
    m.L.marcarComoAprovada(alvo);                  // o que o gesto fez
    const rot = respostas.map((r) => r.errorCategory).join(' → ');
    assert.equal(await m.app.enviarAprovacao(alvo), true, `${rot}: a aprovação desta pessoa foi dada como não feita`);
    assert.equal(m.idas(), respostas.length, `PRÉ-CONDIÇÃO (${rot}): a retentativa de verdade não foi de novo`);
    assert.deepEqual(avisos(m.log), [], `${rot}: a aprovação DESTA pessoa foi atribuída a outro editor`);
    assert.ok(m.P.approvedImageIds.includes('ur-P'), `${rot}: a foto saiu das aprovadas (sem a lixeira) — e ela está no mapa`);
    assert.deepEqual(m.log.filter((l) => l.startsWith('conquista:')), ['conquista:fotos'], `${rot}: o "Curador" não contou`);
    assert.deepEqual(m.log.filter((l) => l === 'pouso'), ['pouso']);
  }
  // CONTROLE: "já tratado" na 1ª ida (a resposta chegou) é OUTRO editor — o L30.
  const o = montarL1({ respostas: [{ success: false, errorCategory: 'already_processed' }], viva: true, retentativa: retentativaDeVerdade() });
  const alvoO = { id: 'ur-P', place: o.P, idx: 0 };
  o.L.marcarComoAprovada(alvoO);
  assert.equal(await o.app.enviarAprovacao(alvoO), false);
  assert.deepEqual(avisos(o.log), ['toast:info:toast.alreadyProcessed'], 'CONTROLE: o "outro editor" de verdade deixou de ser avisado');
  assert.ok(!o.P.approvedImageIds.includes('ur-P'), 'CONTROLE: a foto que OUTRO tratou virou "aprovada"');
  assert.ok(!o.log.includes('conquista:fotos'), 'CONTROLE: o "Curador" contou a curadoria de outro editor');
  // CONTROLE: o 401 é uma resposta — a escrita NÃO saiu; o "já tratado" da 2ª
  // ida (a sessão conferida viva) é de outro editor.
  const u = montarL1({ respostas: [R401, { success: false, errorCategory: 'already_processed' }], viva: true, retentativa: retentativaDeVerdade() });
  const alvoU = { id: 'ur-P', place: u.P, idx: 0 };
  u.L.marcarComoAprovada(alvoU);
  await u.app.enviarAprovacao(alvoU);
  assert.deepEqual(avisos(u.log), ['toast:info:toast.alreadyProcessed'], 'CONTROLE: o 401 contou como ida sem resposta');
});

test('R5-3-04 excluir: "já excluída" depois de uma ida SEM resposta é a exclusão desta pessoa — sem "outro editor"', async () => {
  for (const respostas of [[TRANSIENT, { success: true, jaExcluida: true }],
    [TRANSIENT, TRANSIENT, { success: true, jaExcluida: true }]]) {
    const m = montarL1({ respostas, viva: true, retentativa: retentativaDeVerdade() });
    const rot = respostas.length + ' idas';
    assert.equal(await m.app.enviarExclusao({ id: 'a1', place: m.P, idx: 0, url: FOTO('a1') }), true);
    assert.equal(m.idas(), respostas.length, `PRÉ-CONDIÇÃO (${rot}): a retentativa de verdade não foi de novo`);
    assert.deepEqual(avisos(m.log), [], `${rot}: a exclusão DESTA pessoa foi atribuída a outro editor`);
    assert.deepEqual(m.irmao.imageUrls, [FOTO('ur-P')], `${rot}: a foto excluída ficou nos irmãos`);
  }
  // CONTROLE: "já excluída" na 1ª ida (a resposta chegou) é OUTRO editor.
  const o = montarL1({ respostas: [{ success: true, jaExcluida: true }], viva: true, retentativa: retentativaDeVerdade() });
  assert.equal(await o.app.enviarExclusao({ id: 'a1', place: o.P, idx: 0, url: FOTO('a1') }), true);
  assert.deepEqual(avisos(o.log), ['toast:info:toast.photoAlreadyGone'], 'CONTROLE: o "outro editor" de verdade deixou de ser avisado');
  // CONTROLE: a ida sem resposta que NÃO pousou e não volta (três sem resposta):
  // a foto volta e a falha é avisada, como sempre.
  const f = montarL1({ respostas: [TRANSIENT, TRANSIENT, TRANSIENT], viva: true, retentativa: retentativaDeVerdade() });
  assert.equal(await f.app.enviarExclusao({ id: 'a1', place: f.P, idx: 0, url: FOTO('a1') }), false);
  assert.ok(f.log.includes('devolveu'), 'CONTROLE: a foto da exclusão que não pousou não voltou');
  assert.equal(erros(f.log).length, 1, 'CONTROLE: a falha da exclusão deixou de ser avisada');
});

// ── R5-3-07: a exclusão que pousa com a foto JÁ fechada redesenha o card pelo
// foco do card (`mantendoFocoNoCard`, medido em test/lightbox-foco-card) ──────
// MEDIDO (auditoria de 2026-09-30): excluir sem o Desfazer e fechar com a
// escrita no ar — o `.then` redesenhava o card e o foco, na foto do card desde o
// fechar (L12), caía no <body>. E o irmão do mesmo local que virou o card da
// frente (o pedido decidido no meio) é redesenhado igual.
test('R5-3-07 excluir sem o Desfazer: o card redesenhado quando a exclusão pousa passa pelo foco do card — o dele e o do irmão', async () => {
  const ordem = [];
  const extra = { mantendoFocoNoCard: (redesenhar) => { ordem.push('guarda'); redesenhar(); },
    showCurrentPlace: () => ordem.push('redesenhou'), aplicarNosIrmaos: () => {} };
  const m = montarEscritas({ resposta: { success: true }, extra });
  m.L.place.approvedImageIds = ['velha'];
  m.L.place.lat = -23; m.L.place.lon = -46;
  m.L.idx = 0;
  m.L.idFotoAtual = () => 'velha';
  m.app.pedirExclusaoDaFoto();
  m.L.aberto = false;                               // fechou com a escrita no ar
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(m.log.includes('api:excluir:row'), 'PRÉ-CONDIÇÃO: a exclusão não saiu');
  assert.deepEqual(ordem, ['guarda', 'redesenhou'], 'a exclusão pousada redesenha o card por fora do foco do card (caminho 2)');
  // O irmão do mesmo local na frente: redesenhado pelo mesmo caminho.
  ordem.length = 0;
  const i = montarL1({ respostas: [{ success: true }], viva: true,
    extra: { mantendoFocoNoCard: extra.mantendoFocoNoCard, showCurrentPlace: extra.showCurrentPlace } });
  i.AppState.currentPlace = i.irmao;
  assert.equal(await i.app.enviarExclusao({ id: 'a1', place: i.P, idx: 0, url: FOTO('a1') }), true);
  assert.deepEqual(ordem, ['guarda', 'redesenhou'], 'o irmão da frente é redesenhado por fora do foco do card');
});

// ── R5-2-03: a aprovação que POUSA depois de a sessão cair (o V6b da aprovação) ──
// A queda solta o `aprovacoesNoAr` (V6) e a renovação com a MESMA conta mantém a
// fila. Quando a resposta velha chegava dizendo que o Waze APROVOU, o ramo da
// época só tratava o "não pousou": o pedido aprovado seguia como card, contando no
// "Restam" e decidível de novo — MEDIDO no navegador (s18): o ✓ seguinte mandava
// uma segunda decisão ao Waze ("já tratado") e contava um lido a mais.
function montarAprovacaoNaQueda() {
  const log = [];
  const P = ['A', 'B', 'C'].map((x) => ({ venueID: 'v' + x, updateRequestID: 'u' + x }));
  const AppState = { authenticated: true, queue: P.slice(), currentPlace: P[0], serverTotal: 3, fetchEpoch: 0,
    stats: { read: 0, rejected: 0, skipped: 0 } };
  const respostas = [];
  const deps = {
    AppState, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID,
    callWithRetry: (fn) => fn(), API: { aprovarPedido: () => new Promise((ok) => respostas.push(ok)) },
    refazerDepoisDo401: async () => null, marcarEmAndamento: () => {}, refazerSelosSeOutroNaTela: () => {},
    aplicarTravaDeAcao: () => {}, contarConquista: () => log.push('conquista'), showToast: (m) => log.push('toast:' + m),
    msgDoServidor: () => '', t: (k) => k, voltarDaAprovacaoRecusada: () => log.push('devolveu'),
    Lightbox: { isOpen: () => false, place: null, desmarcarAprovada: () => log.push('desmarcou'), esquecerProposta: () => {} },
    escritaDoLightboxSemSessao: () => log.push('sem-sessao'),
    registrarPouso: (p) => log.push('pouso:' + p.updateRequestID), updateStats: () => {}, updatePendingCount: () => {},
    advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; log.push('avancou'); },
    aoMudarAFilaPorBaixo: () => log.push('fundo'),
    pousouNoWaze: (r) => !!(r && (r.success || r.errorCategory === 'already_processed')),
    // O da foto ampliada (R5-3-07): o `tirarAprovadoDaFila` anda a fila por ele.
    mantendoFocoNoCard: (redesenhar) => redesenhar(),
  };
  // `contarIdasSemResposta` é o da foto ampliada (R5-3-04): o `enviarAprovacao` o chama.
  const nomes = ['enviarAprovacao', 'concluirAprovacao', 'aprovacaoPousouDepoisDaQueda', 'tirarAprovadoDaFila',
    'contarIdasSemResposta'];
  const chaves = Object.keys(deps);
  const corpo = nomes.map(fatiar).join('\n')
    .replace(/placeResolvidoPorAprovacao = /g, '__res.v = ').replace(/epocaDaSessao/g, '__ep.v');
  const ep = { v: 0 };
  const res = { v: null };
  const app = new Function(...chaves, '__res', '__ep', 'let tratouNestaFila = false;\n' + corpo
    + `\nreturn { ${nomes.join(', ')} };`)(...chaves.map((k) => deps[k]), res, ep);
  // Aprova (a resposta presa), a sessão cai e renova; depois a resposta chega.
  const aprovarECair = async (place, resposta, { outraConta = false, antesDaResposta = null } = {}) => {
    const fim = app.enviarAprovacao({ place, idx: 0, epocaFila: 0 });
    await umTique();
    ep.v++;                                   // a queda (`derrubarSessao`)
    deps.aprovacoesNoAr.clear();
    if (outraConta) { AppState.fetchEpoch++; AppState.queue = [{ venueID: 'vQ', updateRequestID: 'uQ' }]; AppState.currentPlace = AppState.queue[0]; AppState.serverTotal = 1; }
    if (antesDaResposta) antesDaResposta();
    respostas.shift()(resposta);
    await fim;
  };
  return { app, AppState, log, deps, res, P, aprovarECair, fila: () => AppState.queue.map((p) => p.updateRequestID) };
}

test('R5-2-03: a aprovação que POUSA depois da queda tira o pedido da fila que atravessou — sem placar nem conquista', async () => {
  const m = montarAprovacaoNaQueda();
  await m.aprovarECair(m.P[0], { success: true });                 // o card da FRENTE
  assert.deepEqual(m.fila(), ['uB', 'uC'], 'o pedido que o Waze aprovou seguiu na fila como card');
  assert.equal(m.AppState.serverTotal, 2, 'o "Restam" seguiu contando o pedido aprovado');
  assert.ok(m.log.includes('pouso:uA'), 'o pedido aprovado ficou sem pouso (a fila guardada do offline o devolveria)');
  assert.ok(!m.log.includes('conquista'), 'a resposta da sessão que caiu contou conquista');
  // Um pedido que NÃO é o da frente sai pela identidade, sem mexer no card da tela.
  const b = montarAprovacaoNaQueda();
  await b.aprovarECair(b.P[1], { success: true });
  assert.deepEqual(b.fila(), ['uA', 'uC']);
  assert.equal(b.AppState.currentPlace, b.P[0], 'a saída do pedido aprovado trocou o card da tela');
  assert.equal(b.AppState.serverTotal, 2);
});

test('R5-2-03: CONTROLES — não pousou, OUTRA conta, e o que um gesto da sessão nova já decidiu', async () => {
  const n = montarAprovacaoNaQueda();
  await n.aprovarECair(n.P[0], { success: false, errorCategory: 'unauthorized' });
  assert.deepEqual(n.fila(), ['uA', 'uB', 'uC'], 'a aprovação que NÃO pousou tirou o pedido da fila');
  assert.ok(n.log.includes('sem-sessao') && !n.log.some((l) => l.startsWith('pouso')));
  const o = montarAprovacaoNaQueda();
  await o.aprovarECair(o.P[0], { success: true }, { outraConta: true });
  assert.deepEqual(o.fila(), ['uQ'], 'a resposta da sessão de A mexeu na fila de B');
  assert.equal(o.AppState.serverTotal, 1);
  assert.ok(!o.log.some((l) => l.startsWith('pouso')), 'a resposta da sessão de A gravou pouso com a fila de B');
  // O card ficou destravado na renovação e um gesto da sessão nova já o tirou da
  // fila (e descontou o "Restam") antes de a resposta velha chegar: nada a tirar
  // de novo, e o "Restam" não desce duas vezes.
  const g = montarAprovacaoNaQueda();
  await g.aprovarECair(g.P[1], { success: true }, { antesDaResposta: () => {
    g.AppState.queue.splice(1, 1); g.AppState.serverTotal = 2;
  } });
  assert.deepEqual(g.fila(), ['uA', 'uC']);
  assert.equal(g.AppState.serverTotal, 2, 'o "Restam" desceu duas vezes pelo mesmo pedido');
  assert.ok(g.log.includes('pouso:uB'), 'o pedido aprovado ficou sem pouso');
});
