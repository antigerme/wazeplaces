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
  const corpo = ['podeAprovarAtual', 'marcarComoAprovada', 'desmarcarAprovada', 'removerFoto', 'indiceDaFoto'].map(metodo).join(',\n');
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
function montarEscritas({ resposta, preferencias = { undoEnabled: false }, fotoNaTela = true }) {
  const log = [];
  const L = lightbox();
  const A = pedidoDeFoto('ur-A');
  abrir(L, A, [FOTO('velha'), FOTO('ur-A')], 1);
  const AppState = { authenticated: true, preferences: preferencias, serverTotal: 5, currentPlace: A };
  const deps = {
    AppState, Lightbox: L, Treino: { ativo: false }, epocaDaSessao: 0,
    canDisableUndo: () => true, estadoAprovando: () => {}, lixeiraOcupada: () => {},
    fotoDoLightboxNaTela: () => fotoNaTela, manterFocoNoLightbox: () => log.push('foco'), marcarEmAndamento: () => {},
    API: { aprovarPedido: async () => { log.push('api:aprovar'); return resposta; },
      excluirFoto: async () => { log.push('api:excluir'); return resposta; }, prepararExclusao: () => {} },
    registrarPouso: () => log.push('pouso'), updateStats: () => {}, contarConquista: () => {},
    advanceQueue: () => log.push('avancou'), handleUnauthorized: () => {}, showToast: (m, tipo) => log.push('toast:' + tipo),
    msgDoServidor: () => '', t: (k) => k, devolverFoto: () => log.push('devolveu'), showCurrentPlace: () => {},
    aplicarTravaDeAcao: () => {}, removeUndoBanner: () => {}, mostrarDesfazer: () => {},
    setTimeout: () => 0, clearTimeout: () => {}, UNDO_WINDOW_MS: 3000,
    callWithRetry: (fn) => fn(),
  };
  let placeResolvido = null;
  const nomes = ['enviarAprovacao', 'concluirAprovacao', 'aprovarFotoAtual', 'enviarExclusao', 'pedirExclusaoDaFoto'];
  const chaves = Object.keys(deps);
  const corpo = nomes.map(fatiar).join('\n')
    .replace(/placeResolvidoPorAprovacao = /g, '__res.v = ')
    .replace(/aprovacaoPendente/g, '__pend.a').replace(/exclusaoPendente/g, '__pend.e');
  const app = new Function(...chaves, '__res', '__pend', corpo + `\nreturn { ${nomes.join(', ')} };`)(
    ...chaves.map((k) => deps[k]), { get v() { return placeResolvido; }, set v(x) { placeResolvido = x; } }, { a: null, e: null });
  return { app, L, A, log, AppState, resolvido: () => placeResolvido };
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
  assert.match(fatiar('enviarAprovacao'), /const enviar = \(\) => API\.aprovarPedido\([^\n]*\n\s+let r = await callWithRetry\(enviar\)/);
  assert.match(fatiar('enviarExclusao'), /const enviar = \(\) => API\.excluirFoto\([^\n]*\n\s+let r = await callWithRetry\(enviar\)/);
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
  };
  const chaves = Object.keys(deps);
  const nomes = ['aplicarNosIrmaos', 'enviarExclusao', 'enviarRenomeacao', 'aplicarNomeNaTela'];
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
function montarL1({ respostas, viva, caiNaSonda = false }) {
  const log = [];
  const L = lightbox();
  const P = { venueID: 'v1', updateRequestID: 'ur-P', purType: 'NEW_PHOTO', name: 'Padaria Nova',
    lat: -23, lon: -46, approvedImageIds: ['a1'], imageUrls: [FOTO('ur-P')] };
  const irmao = { venueID: 'v1', updateRequestID: 'ur-Q', name: 'Padaria Velha', imageUrls: [FOTO('a1'), FOTO('ur-P')], approvedImageIds: ['a1'] };
  abrir(L, P, [FOTO('ur-P')], 0);
  const AppState = { queue: [P, irmao], currentPlace: P, serverTotal: 5 };
  let idas = 0;
  let app = null;
  const proxima = async () => { idas++; return respostas[Math.min(idas, respostas.length) - 1]; };
  const deps = {
    AppState, Lightbox: L, callWithRetry: (fn) => fn(),
    API: { excluirFoto: proxima, aprovarPedido: proxima, renomearLocal: proxima },
    handleUnauthorized: async () => { log.push('confere'); if (caiNaSonda) app.setEpoca(1); },
    sessaoVivaDepoisDe: () => viva,
    aplicarTravaDeAcao: () => log.push('trava:' + app.conferindo()),
    showToast: (m, tipo) => log.push(`toast:${tipo}:${m}`), msgDoServidor: (r) => (r && r.error) || '', t: (k) => k,
    devolverFoto: () => log.push('devolveu'), showCurrentPlace: () => {}, contarConquista: () => {},
    montarCardDeFundo: () => {}, cardDaFrente: () => null, document: { getElementById: () => null },
    registrarPouso: () => log.push('pouso'), updateStats: () => {}, advanceQueue: () => log.push('avancou'),
    marcarEmAndamento: () => {},
  };
  const nomes = ['refazerDepoisDo401', 'enviarExclusao', 'enviarAprovacao', 'concluirAprovacao',
    'enviarRenomeacao', 'aplicarNosIrmaos', 'aplicarNomeNaTela'];
  const chaves = Object.keys(deps);
  app = new Function(...chaves, 'epocaDaSessao', 'escritasConferindo', 'placeResolvidoPorAprovacao',
    nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')},
      setEpoca: (v) => { epocaDaSessao = v; }, conferindo: () => escritasConferindo };`)(
    ...chaves.map((k) => deps[k]), 0, 0, null);
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

test('L1 a sessão CAI na conferência: nada é revertido nem avisado depois (a época mudou)', async () => {
  const m = montarL1({ respostas: [R401, { success: true }], viva: true, caiNaSonda: true });
  assert.equal(await m.app.enviarExclusao({ id: 'a1', place: m.P, idx: 0, url: FOTO('a1') }), false);
  assert.equal(m.idas(), 1, 'escreveu no Waze depois de a sessão cair');
  assert.ok(!m.log.includes('devolveu') && erros(m.log).length === 0);
  assert.equal(m.app.conferindo(), 0, 'a trava ficou presa depois da queda');
});

test('L1 a conferência do 401 TRAVA as ações, como a janela do Desfazer', () => {
  const trava = new Function('AppState', 'aprovacaoPendente', 'exclusaoPendente', 'renomeacaoPendente', 'escritasConferindo',
    fatiar('acoesTravadas') + '\nreturn acoesTravadas;');
  const AppState = { pendingAction: null };
  assert.equal(trava(AppState, null, null, null, 0)(), false, 'CONTROLE: sem nada pendente, nada trava');
  assert.equal(trava(AppState, null, null, null, 1)(), true,
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
  const devolverFoto = new Function('Lightbox', 'AppState', 'showCurrentPlace', fatiar('devolverFoto') + '\nreturn devolverFoto;')(
    L, { currentPlace: null }, () => {});
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
  const rodar = (travado, editando) => new Function('document', 'acoesTravadas', 'cardDaFrente', 'editandoNome',
    fatiar('aplicarTravaDeAcao') + '\naplicarTravaDeAcao();')(
    { getElementById: (id) => el[id] || null }, () => travado, () => null, () => editando);
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
  const AppState = { preferences: { undoEnabled: !semJanela }, serverTotal: 5, currentPlace: A };
  const timers = [];
  let responder = null;
  const emAndamento = new Set();
  const deps = {
    AppState, Lightbox: L, Treino: { ativo: false }, epocaDaSessao: 0, pedidosEmAndamento: emAndamento,
    canDisableUndo: () => true, estadoAprovando: () => {}, fotoDoLightboxNaTela: () => true, manterFocoNoLightbox: () => {},
    API: { aprovarPedido: () => new Promise((ok) => { responder = () => ok(resposta); }) },
    registrarPouso: () => log.push('pouso'), updateStats: () => {}, contarConquista: () => {}, advanceQueue: () => {},
    handleUnauthorized: () => {}, showToast: () => {}, msgDoServidor: () => '', t: (k) => k,
    aplicarTravaDeAcao: () => {}, removeUndoBanner: () => {}, mostrarDesfazer: () => {}, registrarDesfazer: () => {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, UNDO_WINDOW_MS: 3000,
    callWithRetry: (fn) => fn(), sessaoVivaDepoisDe: () => false, escritasConferindo: 0,
    // A busca de verdade (`semOsJaDecididos`), sem fila de saída nem pouso: o
    // que a tira da fila nova é só o "em andamento".
    carregarFilaDeSaida: () => [], pousosDaPagina: new Map(), offlineLigado: () => false, offlineLerPousos: () => [],
  };
  const nomes = ['chaveDoPedido', 'marcarEmAndamento', 'semOsJaDecididos', 'enviarAprovacao', 'concluirAprovacao',
    'aprovarFotoAtual', 'refazerDepoisDo401'];
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
