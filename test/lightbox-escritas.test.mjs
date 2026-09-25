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
  const corpo = ['podeAprovarAtual', 'marcarComoAprovada', 'desmarcarAprovada', 'removerFoto'].map(metodo).join(',\n');
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

// ── o caminho SEM Desfazer: só aplica o que o Waze confirmou ────────────────
function montarEscritas({ resposta, preferencias = { undoEnabled: false } }) {
  const log = [];
  const L = lightbox();
  const A = pedidoDeFoto('ur-A');
  abrir(L, A, [FOTO('velha'), FOTO('ur-A')], 1);
  const AppState = { preferences: preferencias, serverTotal: 5, currentPlace: A };
  const deps = {
    AppState, Lightbox: L, Treino: { ativo: false }, epocaDaSessao: 0,
    canDisableUndo: () => true, estadoAprovando: () => {}, lixeiraOcupada: () => {},
    API: { aprovarPedido: async () => resposta, excluirFoto: async () => resposta, prepararExclusao: () => {} },
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
  assert.match(fatiar('enviarAprovacao'), /await callWithRetry\(\(\) => API\.aprovarPedido\(/);
  assert.match(fatiar('enviarExclusao'), /await callWithRetry\(\(\) => API\.excluirFoto\(/);
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
