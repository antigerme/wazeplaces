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

// O Lightbox com os métodos de VERDADE e a tela de mentira. `L.resolvido.v` é o
// `placeResolvidoPorAprovacao` do app: o pedido cuja aprovação JÁ pousou e só
// espera a foto fechar (o `podeAprovarAtual` o lê, R6-3-01).
function lightbox(podeL6 = true) {
  const resolvido = { v: null };
  const corpo = ['podeAprovarAtual', 'idAprovadoDaFoto', 'marcarComoAprovada', 'desmarcarAprovada', 'esquecerProposta',
    'removerFoto', 'indiceDaFoto']
    .map(metodo).join(',\n').replace(/placeResolvidoPorAprovacao/g, '__res.v');
  const L = new Function('podeAgirComoL6Aqui', '__res', `return {
    place: null, urls: [], idx: 0, newIdx: -1, eDenuncia: false, aberto: true, renders: 0,
    isOpen() { return this.aberto; }, _render() { this.renders++; }, close() { this.aberto = false; },
    ${corpo}
  };`)(() => podeL6, resolvido);
  L.resolvido = resolvido;
  return L;
}

// As peças do R6-3-01/R6-3-04 que toda escrita da foto usa, DE VERDADE: a régua
// do "pedido ainda na tela" e a memória das idas sem resposta entre gestos — e a
// vez do local nas exclusões (R10-3-03), e a memória das fotos que saíram do mapa
// (R12-3-02). O anúncio ao leitor de tela (R6-3-08) é anotado no `log` de quem
// passar um.
const R6_NOMES = ['pedidoAindaNaTela', 'filaReal', 'filaRealComDevolvidos', 'idasSemRespostaDeAntes', 'lembrarIdasSemResposta',
  'vezDasFotosNoLocal', 'exclusaoDoLocalNoAr', 'fotoSaiuDoMapa', 'anotarFotoQueSaiuDoMapa'];
const r6Deps = (log = null) => ({ idasSemRespostaGuardadas: new Map(), IDAS_SEM_RESPOSTA_TETO: 50, escritasDeFotoNoLocal: new Map(),
  fotosQueSairamDoMapa: new Map(), FOTOS_QUE_SAIRAM_TETO: 50,
  anunciarNoLightbox: (texto, place) => { if (log) log.push('anuncio:' + texto); },
  // A região do CARD, pro desfecho que fecha a camada (R7-3-04).
  anunciarNoCard: (texto) => { if (log) log.push('anuncioCard:' + texto); } });
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
    // A tela: só as regiões vivas, quando o teste as quer (`exclusaoQueAnuncia`).
    document: { getElementById: () => null },
    // Nenhuma camada por cima do card além da foto ampliada (o desfecho com a
    // foto fechada, R9-3-05: `anunciarDesfechoDaFoto`, de verdade).
    semCamadaAberta: () => !L.isOpen(),
    ...r6Deps(log),
    // `extra`: troca qualquer dependência acima (R5-3-07).
    ...extra,
  };
  let placeResolvido = null;
  const nomes = ['enviarAprovacao', 'concluirAprovacao', 'aprovarFotoAtual', 'enviarExclusao', 'pedirExclusaoDaFoto',
    'anuncioDoCardAoFechar', 'anunciarDesfechoDaFoto', 'tirarAprovadoDaFila', 'pousouNoWaze', 'escritaDoLightboxSemSessao',
    'contarIdasSemResposta', ...R6_NOMES];
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

// ── Junção do lote 14 (R10-2-02): o pedido que a OUTRA aba decidiu ───────────
// Vale a primeira decisão. O gesto no card dele já é descontado; aprovar a foto
// pela foto ampliada era o caminho que sobrava (relatório do agente das duas
// abas): a aprovação saía, e o Waze recebia a decisão de lá e a daqui.
test('junção R10-2-02: aprovar a foto de um pedido que a OUTRA aba já decidiu não vai ao Waze — e diz por quê', async () => {
  const decididos = new WeakSet();
  const m = montarEscritas({ resposta: { success: true }, extra: { decididosPorOutraAbaComCardAqui: decididos } });
  decididos.add(m.A);
  m.app.aprovarFotoAtual();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(!m.log.some((l) => l.startsWith('api:')), `DEFEITO: a aprovação foi ao Waze sobre a decisão da outra aba: ${m.log}`);
  assert.ok(m.log.includes('toast:info:toast.decididoNaOutraAba'), `o toque não disse por quê: ${m.log}`);
  assert.ok(!m.A.approvedImageIds.includes('ur-A'), 'a foto virou "aprovada" na tela sem a aprovação sair');
  // CONTROLE: o mesmo pedido, sem a anotação, aprova.
  const c = montarEscritas({ resposta: { success: true }, extra: { decididosPorOutraAbaComCardAqui: new WeakSet() } });
  c.app.aprovarFotoAtual();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(c.log.some((l) => l.startsWith('api:aprovar')), `CONTROLE: sem a anotação a aprovação não saiu: ${c.log}`);
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
  // E a aprovação também (R11-3-01): ela espera a vez das fotos do local.
  assert.match(fatiar('enviarAprovacao'), /const enviar = contarIdasSemResposta\(\(\) => API\.aprovarPedido\([^\n]*\n\s+let r = await callWithRetry\(enviar, epoca\)/);
  // A exclusão passa a época do GESTO: ela pode esperar a vez do local, e a ida
  // não sai com a sessão de quem entrou nesse meio (R10-3-03).
  assert.match(fatiar('enviarExclusao'), /const enviar = contarIdasSemResposta\(\(\) => API\.excluirFoto\([^\n]*\n\s+let r = await callWithRetry\(enviar, epoca\)/);
  assert.match(fatiar('refazerDepoisDo401'), /await callWithRetry\(enviar\)/,
    'a segunda ida depois do 401 saiu da retentativa do resto');
});

// ── os IRMÃOS na fila (auditoria de 2026-09-25) ──────────────────────────────
// Outro pedido do MESMO local, mais adiante na fila, foi montado com o local de
// antes: mostrava a foto que acabou de sair e o nome velho.
function montarIrmaos(resposta, { treino = null } = {}) {
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
    // O treino (R7-3-05): fechado, salvo o teste que o abre.
    Treino: treino || { ativo: false, _salvo: null },
    ...r6Deps(),
  };
  const chaves = Object.keys(deps);
  const nomes = ['aplicarNosIrmaos', 'enviarExclusao', 'enviarRenomeacao', 'aplicarNomeNaTela',
    'nomeDestaEscrita', 'devolverNome', 'escritaDoLightboxSemSessao', 'contarIdasSemResposta', ...R6_NOMES];
  const app = new Function(...chaves, nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(...chaves.map((k) => deps[k]));
  return { app, A, B, C, log, AppState };
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
    Treino: { ativo: false, _salvo: null },   // o treino fechado (R7-3-05)
    ...r6Deps(log),
    ...extra,
  };
  const nomes = ['refazerDepoisDo401', 'enviarExclusao', 'enviarAprovacao', 'concluirAprovacao',
    'enviarRenomeacao', 'aplicarNosIrmaos', 'aplicarNomeNaTela', 'nomeDestaEscrita', 'devolverNome',
    'escritaDoLightboxSemSessao', 'tirarAprovadoDaFila', 'pousouNoWaze', 'contarIdasSemResposta',
    'aprovacaoPousouDepoisDaQueda', ...R6_NOMES];
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
  // A primeira e a última são a vez das fotos do local, que a pílula do nome lê
  // (R11-3-06): a exclusão entra nela e sai dela.
  assert.deepEqual(m.log.filter((l) => l.startsWith('trava:')), ['trava:0', 'trava:1', 'trava:0', 'trava:0']);
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
  // de verdade. E vai pra tela de quem ficou como qualquer exclusão (R6-3-01): o
  // irmão do mesmo local perde a foto também. Esta asserção dizia o contrário
  // ("nada grava, nem os irmãos") e era o defeito: excluir não grava placar,
  // Histórico nem conquista, e o irmão é a fila na tela, não o aparelho.
  const ok = montarL1({ respostas: [{ success: true }], viva: true, quedaNaIda: true });
  assert.equal(await ok.app.enviarExclusao({ id: 'a1', place: ok.P, idx: 0, url: FOTO('a1') }), true,
    'a exclusão que POUSOU depois da queda foi dada como não feita (a tela seguia com a foto)');
  assert.ok(!ok.log.includes('devolveu') && erros(ok.log).length === 0, 'a exclusão que POUSOU foi desfeita na tela');
  assert.deepEqual(ok.irmao.imageUrls, [FOTO('ur-P')], 'a foto que SAIU do mapa seguiu no irmão depois da queda (R6-3-01)');
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
  const corpo = ['open', 'recolocarFoto', 'removerFoto', 'podeAprovarAtual', 'idAprovadoDaFoto', '_anunciarFoto'].map(metodo).join(',\n')
    .replace(/placeResolvidoPorAprovacao/g, '__res.v');
  // A região viva da camada (o `_anunciarFoto` de verdade escreve nela, R9-3-05).
  const anuncios = [];
  const L = new Function('document', 'CamadaVoltar', 'mostrarNomeNoLightbox', 'podeAgirComoL6Aqui', '__res',
    't', 'anunciarNoLightbox', `return {
    place: null, urls: [], idx: 0, newIdx: -1, eDenuncia: false, aberto: false, renders: 0,
    isOpen() { return this.aberto; }, _render() { this.renders++; }, close() { this.aberto = false; },
    ${corpo}
  };`)(doc, { empilhar() {} }, () => {}, () => true, { v: null },
    (k, v) => (v ? `${k}${JSON.stringify(v)}` : k), (txt) => anuncios.push(txt));
  L.anuncios = anuncios;
  const devolverFoto = new Function('Lightbox', 'AppState', 'showCurrentPlace', 'mantendoFocoNoCard', 'fotoSaiuDoMapa',
    fatiar('devolverFoto') + '\nreturn devolverFoto;')(L, { currentPlace: null }, () => {}, (redesenhar) => redesenhar(), () => false);
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

// ── Achado de passagem do lote 13: o Desfazer da exclusão da foto DENUNCIADA ──
// O `removerFoto` tira o selo (o 🚩) junto com a foto que sai, e o `recolocarFoto`
// não o devolvia: com a camada aberta, a foto denunciada voltava SEM o 🚩 até
// reabrir, e o anúncio dizia a posição sem o selo. O card, redesenhado, estava
// certo. Medido com os métodos de verdade (`newIdx -1` depois do Desfazer).
test('o Desfazer da exclusão da foto DENUNCIADA devolve o 🚩 a ela na camada aberta', () => {
  const d = FOTO('denunciada'), o = FOTO('outra');
  const novo = () => ({ venueID: 'vFL', updateRequestID: 'uFL', purType: 'FLAGGED_PHOTO', approvedImageIds: ['denunciada', 'outra'], imageUrls: [d, o] });
  const m = lightboxQueAbre();
  const P = novo();
  m.L.open(P.imageUrls, 0, 0, 'x', true, P);       // o selo (🚩) na denunciada, que está na tela
  m.L.aberto = true;
  assert.equal(m.L.newIdx, 0, 'PRÉ-CONDIÇÃO: o selo não está na foto denunciada');
  const alvo = { id: 'denunciada', place: P, idx: 0, url: d, selo: m.L.newIdx === m.L.idx };
  m.L.removerFoto('denunciada', P);                 // excluída com a janela aberta
  assert.equal(m.L.newIdx, -1, 'PRÉ-CONDIÇÃO: a exclusão não tirou o selo com a foto');
  m.devolverFoto(alvo);                             // o Desfazer
  assert.deepEqual(m.L.urls, [d, o], 'a foto denunciada não voltou pro carrossel');
  assert.equal(m.L.newIdx, 0, `DEFEITO: a foto denunciada voltou SEM o 🚩 na camada aberta (newIdx ${m.L.newIdx})`);
  // CONTROLE: excluir OUTRA foto (não a do selo) e desfazer — o selo segue na
  // denunciada, deslocado pela foto que volta antes dela.
  const c = lightboxQueAbre();
  const Q = { ...novo(), imageUrls: [o, d] };
  c.L.open(Q.imageUrls, 0, 1, 'x', true, Q);       // a outra na tela, o 🚩 na 2ª
  c.L.aberto = true;
  const alvoOutra = { id: 'outra', place: Q, idx: 0, url: o, selo: c.L.newIdx === c.L.idx };
  assert.equal(alvoOutra.selo, false, 'PRÉ-CONDIÇÃO: a foto excluída do controle era a do selo');
  c.L.removerFoto('outra', Q);
  assert.equal(c.L.newIdx, 0, 'PRÉ-CONDIÇÃO: o selo não acompanhou a denunciada quando a outra saiu');
  c.devolverFoto(alvoOutra);
  assert.equal(c.L.newIdx, 1, `CONTROLE: o selo saiu da denunciada quando a OUTRA voltou (newIdx ${c.L.newIdx})`);
  // E o alvo da exclusão de verdade diz se a foto era a do selo.
  assert.match(fatiar('pedirExclusaoDaFoto'), /selo: Lightbox\.newIdx >= 0 && Lightbox\.newIdx === Lightbox\.idx/,
    'a exclusão deixou de anotar se a foto excluída era a do selo — o Desfazer não tem como devolvê-lo');
});

// ── R9-3-05 (b): a foto que VOLTA pelo Desfazer é dita, como toda troca de foto ──
// (auditoria de 2026-10-06). O Desfazer de uma exclusão com a foto aberta a
// recoloca (`recolocarFoto`) e ela passa a ser a da TELA, e nada era dito: quem
// usa leitor de tela ouvia só o banner saindo, enquanto o Desfazer do ✕ do card
// diz o pedido que voltou (MEDIDO nos dois motores, r41). A troca é dita com o texto
// que JÁ existe (`_anunciarFoto`: a posição e o selo); "desfeito" seria frase
// nova e fica de fora. O `open`, o `removerFoto`, o `recolocarFoto`, o
// `_anunciarFoto` e o `devolverFoto` de verdade.
test('R9-3-05 o Desfazer de uma exclusão com a foto aberta DIZ a foto que voltou — sem troca na tela, nada', () => {
  const a = FOTO('foto-a'), b = FOTO('foto-b'), c = FOTO('uNP-c');
  const novo = () => ({ venueID: 'vNP', updateRequestID: 'uNP', purType: 'NEW_PHOTO', approvedImageIds: ['foto-a', 'foto-b'], imageUrls: [a, b, c] });
  const m = lightboxQueAbre();
  const P = novo();
  m.L.open(P.imageUrls, 0, 2, 'x', false, P);
  m.L.aberto = true;
  m.L.removerFoto('foto-a', P);                     // excluída com a janela aberta: a tela mostra b
  m.L.anuncios.length = 0;
  m.devolverFoto({ id: 'foto-a', place: P, idx: 0, url: a });   // o Desfazer
  assert.deepEqual([m.L.idx, m.L.urls[m.L.idx]], [0, a], 'PRÉ-CONDIÇÃO: a foto que voltou não passou a ser a da tela');
  assert.deepEqual(m.L.anuncios, ['lightbox.anuncio.foto{"i":1,"n":3}'],
    'DEFEITO: a foto excluída voltou à tela pelo Desfazer e nada foi dito ao leitor de tela');
  // CONTROLE: com a foto JÁ fechada (o Desfazer pela tecla z, na tela do card), a
  // camada não fala — quem diz é o card, redesenhado.
  const f = lightboxQueAbre();
  const Q = novo();
  f.L.open(Q.imageUrls, 0, 2, 'x', false, Q);
  f.L.aberto = true;
  f.L.removerFoto('foto-a', Q);
  f.L.aberto = false;
  f.L.anuncios.length = 0;
  f.devolverFoto({ id: 'foto-a', place: Q, idx: 0, url: a });
  assert.deepEqual(f.L.anuncios, [], 'CONTROLE: a camada FECHADA anunciou a foto que voltou');
  // CONTROLE: a foto que nunca saiu da tela (a falha SEM o Desfazer: ela só sai
  // quando o Waze confirma) não é troca nenhuma, e nada é dito.
  const n = lightboxQueAbre();
  const R = novo();
  n.L.open(R.imageUrls, 1, 2, 'x', false, R);
  n.L.aberto = true;
  n.L.anuncios.length = 0;
  n.devolverFoto({ id: 'foto-b', place: R, idx: 1, url: b });
  assert.deepEqual(n.L.anuncios, [], 'CONTROLE: a foto que não saiu da tela foi anunciada como uma troca');
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
  // `manterFocoNoLightbox`: o foco da foto aberta na trava (R7-3-06), medido à
  // parte no fim deste arquivo.
  const rodar = (travado, editando) => new Function('document', 'acoesTravadas', 'cardDaFrente', 'editandoNome',
    'aprovandoAgora', 'excluindoAgora', 'renomeacaoNoAr', 'Lightbox', 'atualizarBotaoSalvarNome',
    'aplicarFocoDoTeclado', 'dispensarAvisoDaTrava', 'guardarFocoDaTrava', 'pedirComoFuncionaAdiado', 'manterFocoNoLightbox',
    'exclusaoDoLocalNoAr',
    fatiar('aplicarTravaDeAcao') + '\naplicarTravaDeAcao();')(
    { getElementById: (id) => el[id] || null }, () => travado, () => null, () => editando,
    false, false, () => false, { place: null }, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => false);
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
// `editando`: a edição do nome aberta (R8-3-04). `lb` também leva os painéis do
// fim da fila e os botões deles (R8-3-06), quando o teste os quer na tela.
function helpers({ modal = null, card = null, lbAberto = true, lb = null, editando = false } = {}) {
  const log = [];
  const deps = {
    document: Object.assign(doc, { getElementById: (id) => (lb && lb[id]) || null }),
    topOpenModal: () => modal, cardDaFrente: () => card, devolverFoco: () => log.push('reserva'),
    Lightbox: { isOpen: () => lbAberto }, editandoNome: () => editando,
  };
  const nomes = ['focavelNaTela', 'dentroDeCamada', 'devolverFocoDaAmpliacao', 'botaoDoPainelDoFim', 'manterFocoNoLightbox'];
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
    ...r6Deps(),
  };
  const nomes = ['chaveDoPedido', 'marcarEmAndamento', 'semOsJaDecididos', 'enviarAprovacao', 'concluirAprovacao',
    'aprovarFotoAtual', 'refazerDepoisDo401', 'tirarAprovadoDaFila', 'pousouNoWaze', 'escritaDoLightboxSemSessao',
    'contarIdasSemResposta', ...R6_NOMES];
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
    'atualizarBotaoSalvarNome', 'aplicarFocoDoTeclado', 'dispensarAvisoDaTrava', 'pedirComoFuncionaAdiado', 'exclusaoDoLocalNoAr',
    'let aprovandoAgora = false, excluindoAgora = false;\n'
    + ['estadoAprovando', 'lixeiraOcupada', 'aplicarTravaDeAcao'].map(fatiar).join('\n')
    + '\nreturn { estadoAprovando, lixeiraOcupada, aplicarTravaDeAcao };')(
    { getElementById: (id) => el[id] || null }, () => false, () => null, () => false, () => false, { place: null }, () => {},
    () => {}, () => {}, () => {}, () => false);
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
    document: { getElementById: () => null }, Treino: { ativo: false, _salvo: null },   // o treino fechado (R7-3-05)
  };
  const nomes = ['enviarRenomeacao', 'renomeacaoNoAr', 'nomeDestaEscrita', 'devolverNome', 'aplicarNomeNaTela',
    'aplicarNosIrmaos', 'escritaDoLightboxSemSessao', 'refazerDepoisDo401', 'pedidoAindaNaTela', 'filaReal', 'filaRealComDevolvidos'];
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
    ...r6Deps(),
    carimboDoGesto: () => null,   // o momento do gesto (R6-7-4); aqui se mede a trava
    paisDaFila: () => 30,         // o país do gesto, pra marca da presença (R7-6-05)
  };
  const nomes = ['chaveDoPedido', 'marcarEmAndamento', 'enviarAprovacao', 'concluirAprovacao', 'aprovarFotoAtual',
    'refazerDepoisDo401', 'acoesTravadas', 'aprovacaoDaTelaNoAr', 'avisoDaTrava', 'handleReject', 'handleMarkAsRead',
    'agirNoPedidoDoGesto', 'contarIdasSemResposta', 'aprovacoesAtravessamAQueda', 'idasSemRespostaDeAntes', 'lembrarIdasSemResposta',
    'vezDasFotosNoLocal'];
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
  // refeita: está em `pedidosEmAndamento`); a resposta VELHA chega depois. A nova
  // é do MESMO local, e espera a vez das fotos dele (R11-3-01): sai quando a velha
  // responde — e segue travando o card até a resposta DELA.
  m.app.aprovarFotoAtual();
  assert.equal(m.respostas.length, 1, 'PRÉ-CONDIÇÃO: a aprovação da sessão nova saiu sem esperar a vez do local');
  assert.equal(m.app.acoesTravadas(), true);
  await m.responder();                               // a da sessão que caiu
  assert.equal(m.respostas.length, 1, 'PRÉ-CONDIÇÃO: a aprovação da sessão nova não saiu depois da resposta velha');
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
// frente (o pedido decidido no meio) é redesenhado igual. Os dois redesenhos são
// do MESMO pedido: o foco num ✕ ↑ ✓ fica no mesmo botão (`mesmoBotao`, R9-3-04,
// medido em test/lightbox-foco-card), e a guarda anota se ele veio.
test('R5-3-07 excluir sem o Desfazer: o card redesenhado quando a exclusão pousa passa pelo foco do card — o dele e o do irmão', async () => {
  const ordem = [];
  const extra = { mantendoFocoNoCard: (redesenhar, opcoes = {}) => { ordem.push(opcoes.mesmoBotao ? 'guarda:mesmoBotao' : 'guarda'); redesenhar(); },
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
  assert.deepEqual(ordem, ['guarda:mesmoBotao', 'redesenhou'],
    'a exclusão pousada redesenha o card por fora do foco do card (caminho 2), ou sem o `mesmoBotao` (o ✕ focado vai pra foto, R9-3-04)');
  // O irmão do mesmo local na frente: redesenhado pelo mesmo caminho.
  ordem.length = 0;
  const i = montarL1({ respostas: [{ success: true }], viva: true,
    extra: { mantendoFocoNoCard: extra.mantendoFocoNoCard, showCurrentPlace: extra.showCurrentPlace } });
  i.AppState.currentPlace = i.irmao;
  assert.equal(await i.app.enviarExclusao({ id: 'a1', place: i.P, idx: 0, url: FOTO('a1') }), true);
  assert.deepEqual(ordem, ['guarda:mesmoBotao', 'redesenhou'],
    'o irmão da frente é redesenhado por fora do foco do card, ou sem o `mesmoBotao` (R9-3-04)');
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
    Lightbox: { isOpen: () => false, place: null, desmarcarAprovada: () => log.push('desmarcou'), esquecerProposta: () => {},
      marcarComoAprovada: () => {} },
    escritaDoLightboxSemSessao: () => log.push('sem-sessao'),
    registrarPouso: (p) => log.push('pouso:' + p.updateRequestID), updateStats: () => {}, updatePendingCount: () => {},
    advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; log.push('avancou'); },
    aoMudarAFilaPorBaixo: () => log.push('fundo'),
    pousouNoWaze: (r) => !!(r && (r.success || r.errorCategory === 'already_processed')),
    // O da foto ampliada (R5-3-07): o `tirarAprovadoDaFila` anda a fila por ele.
    mantendoFocoNoCard: (redesenhar) => redesenhar(),
    ...r6Deps(),
  };
  // `contarIdasSemResposta` é o da foto ampliada (R5-3-04): o `enviarAprovacao` o chama.
  const nomes = ['enviarAprovacao', 'concluirAprovacao', 'aprovacaoPousouDepoisDaQueda', 'tirarAprovadoDaFila',
    'contarIdasSemResposta', ...R6_NOMES];
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

// ── R6-3-01: a escrita da foto que POUSA depois da queda aparece na TELA ──────
// (auditoria de 2026-10-01). Sem o Desfazer, quem marcava a foto como aprovada
// era o `.then` do gesto, que recebe `false` depois da queda: com a renovação
// (a MESMA conta, a fila e a foto aberta seguem), a foto ficava com o ✨ e o
// "Aprovar" vivo — MEDIDO, o 2º toque mandava uma 2ª aprovação ao Waze, dizia
// "Já tratado por outro editor 👍" e o "Restam" descia DUAS vezes. A exclusão
// pousada seguia na foto ampliada, no pedido e no irmão. As escritas de
// verdade (`montarL1`, a queda no meio da ida); placar, Histórico e "Curador"
// continuam de fora — são da sessão que caiu.
test('R6-3-01 aprovar SEM o Desfazer, pousando depois da queda: a foto vira APROVADA na tela, sem "Aprovar" — e nada grava', async () => {
  const m = montarL1({ respostas: [{ success: true }], viva: true, quedaNaIda: true });
  const alvo = { id: 'ur-P', place: m.P, idx: 0 };
  assert.equal(m.L.podeAprovarAtual(), true, 'PRÉ-CONDIÇÃO: antes do gesto, a proposta se aprova');
  assert.equal(await m.app.enviarAprovacao(alvo), false, 'depois da queda o chamador não faz mais nada (a tela é do caminho da queda)');
  assert.equal(m.L.newIdx, -1, 'a foto que a pessoa APROVOU (e pousou) seguiu com o ✨ na tela');
  assert.ok(m.P.approvedImageIds.includes('ur-P'), 'a foto aprovada não entrou nas aprovadas (a lixeira não aparece)');
  assert.equal(m.L.podeAprovarAtual(), false, 'o "Aprovar" seguiu vivo: o 2º toque mandaria uma 2ª aprovação ao Waze');
  assert.deepEqual(m.log.filter((l) => l === 'pouso'), ['pouso']);
  assert.equal(m.AppState.serverTotal, 4, 'o "Restam" não desceu UMA vez pelo pedido aprovado');
  assert.ok(!m.log.some((l) => l.startsWith('conquista:')), 'a resposta da sessão que caiu contou o "Curador"');
  assert.deepEqual(avisos(m.log), [], 'a aprovação desta pessoa foi avisada como de outro (ou como falha)');
});

test('R6-3-01 aprovar depois da queda que volta "já tratado" por OUTRO: sai a proposta (sem lixeira), e avisa quem ainda vê o pedido', async () => {
  const m = montarL1({ respostas: [{ success: false, errorCategory: 'already_processed' }], viva: true, quedaNaIda: true });
  const alvo = { id: 'ur-P', place: m.P, idx: 0 };
  await m.app.enviarAprovacao(alvo);
  assert.equal(m.L.newIdx, -1, 'o pedido que outro editor tratou seguiu como proposta (o "Aprovar" vivo)');
  assert.ok(!m.P.approvedImageIds.includes('ur-P'), 'a foto que OUTRO tratou virou "aprovada" (a lixeira ofereceria apagá-la)');
  assert.deepEqual(avisos(m.log), ['toast:info:toast.alreadyProcessed'], 'o "outro editor" não foi avisado (o L30)');
  assert.ok(!m.log.some((l) => l.startsWith('conquista:')));
  // CONTROLE: depois do "Sair" a fila foi embora e a foto fechou — não há a quem avisar.
  let s;
  s = montarL1({ respostas: [], viva: true, extra: { API: { aprovarPedido: async () => {
    s.app.setEpoca(1); s.AppState.queue = []; s.L.aberto = false;
    return { success: false, errorCategory: 'already_processed' };
  } } } });
  await s.app.enviarAprovacao({ id: 'ur-P', place: s.P, idx: 0 });
  assert.deepEqual(avisos(s.log), [], 'depois do "Sair" a resposta velha avisou na tela de quem entrou');
});

test('R6-3-01 excluir SEM o Desfazer, pousando depois da queda: a foto sai da tela e do irmão; depois do "Sair", nada', async () => {
  const m = montarL1({ respostas: [{ success: true }], viva: true, quedaNaIda: true });
  assert.equal(await m.app.enviarExclusao({ id: 'a1', place: m.P, idx: 0, url: FOTO('a1') }), true,
    'a exclusão que POUSOU depois da queda foi dada como não feita: a foto seguia na tela e no pedido');
  assert.deepEqual(m.irmao.imageUrls, [FOTO('ur-P')], 'a foto que saiu do mapa seguiu no IRMÃO');
  assert.ok(!m.irmao.approvedImageIds.includes('a1'), 'a lixeira do irmão seguiria oferecendo apagá-la de novo');
  assert.deepEqual(avisos(m.log), []);
  // CONTROLE: o "Sair" no meio — a fila foi embora e a foto fechou. Nada muda
  // (nem o irmão, que já não é de ninguém) e nada é avisado.
  let s;
  s = montarL1({ respostas: [], viva: true, extra: { API: { excluirFoto: async () => {
    s.app.setEpoca(1); s.AppState.queue = []; s.L.aberto = false;
    return { success: true };
  } } } });
  assert.equal(await s.app.enviarExclusao({ id: 'a1', place: s.P, idx: 0, url: FOTO('a1') }), false);
  assert.deepEqual(s.irmao.imageUrls, [FOTO('a1'), FOTO('ur-P')], 'depois do "Sair" a resposta velha mexeu na fila');
  assert.deepEqual(avisos(s.log), []);
});

test('R6-3-01 o pedido cuja aprovação JÁ pousou não se aprova de novo — o botão some e o toque não sai', () => {
  const L = lightbox();
  const P = pedidoDeFoto('ur-A');
  abrir(L, P, [FOTO('velha'), FOTO('ur-A')], 1);
  assert.equal(L.podeAprovarAtual(), true, 'CONTROLE: a proposta, sem nada pousado, se aprova');
  L.resolvido.v = P;                                // pousou e espera a foto fechar
  assert.equal(L.podeAprovarAtual(), false,
    'a proposta de um pedido já resolvido seguia aprovável: 2ª escrita ao Waze e o "Restam" descendo duas vezes');
  L.resolvido.v = pedidoDeFoto('ur-OUTRO');
  assert.equal(L.podeAprovarAtual(), true, 'CONTROLE: o pousado de OUTRO pedido travou este');
});

test('R6-3-01 o "Renomear" que pousa depois da queda vai aos IRMÃOS (o mesmo buraco), sem o "Corretor"', async () => {
  const m = montarL1({ respostas: [{ success: true }], viva: true, quedaNaIda: true });
  await m.app.enviarRenomeacao({ place: m.P, novo: 'Padaria Nova', antigo: 'Padaria Velha' });
  assert.equal(m.irmao.name, 'Padaria Nova', 'o irmão do mesmo local seguiu com o nome velho (a pílula ofereceria corrigir de novo)');
  assert.ok(!m.log.some((l) => l.startsWith('conquista:')), 'a resposta da sessão que caiu contou o "Corretor"');
});

// ── R6-3-04: o "já feito" de uma ida que pousou, ENTRE gestos ──────────────────
// (auditoria de 2026-10-01). Com a rede caindo na volta, o `callWithRetry` não
// insiste (de propósito), a pessoa vê "Erro de conexão" e tenta de novo num
// gesto novo — que nascia com o contador zerado e dizia "outro editor". O
// `callWithRetry` de VERDADE, com o `navigator.onLine` de mentira.
function retentativaCom(nav) {
  const tentativas = Number(/^const TRANSIENT_RETRY_ATTEMPTS = (\d+);$/m.exec(APP_SEM)[1]);
  return new Function('epocaDaSessao', 'sessaoTrocou', 'navigator', 'TRANSIENT_RETRY_ATTEMPTS',
    'TRANSIENT_RETRY_DELAYS_MS', 'setTimeout', fatiar('callWithRetry') + '\nreturn callWithRetry;')(
    0, () => ({ success: false, errorCategory: 'unauthorized' }), nav, tentativas, [], (fn) => fn());
}
const SEM_RESPOSTA = { ...TRANSIENT, _motivo: 'TypeError' };
// `acao`: 'aprovar' ou 'excluir'. `idas`: o que cada ida faz — 'pousa-e-cai'
// (a ida SAIU, o Waze gravou, e a rede caiu na volta), 'sem-rede' (o aparelho
// já estava sem rede: a ida nem saiu) ou a resposta que ela devolve.
function montarEntreGestos(acao, idas) {
  const nav = { onLine: true };
  let n = 0;
  const ida = async () => {
    const o = idas[Math.min(n++, idas.length - 1)];
    if (o === 'pousa-e-cai') { nav.onLine = false; return SEM_RESPOSTA; }
    if (o === 'sem-rede') return SEM_RESPOSTA;
    return o;
  };
  const m = montarL1({ respostas: [], viva: true, retentativa: retentativaCom(nav),
    extra: { navigator: nav, API: { aprovarPedido: ida, excluirFoto: ida } } });
  const gesto = () => (acao === 'aprovar'
    ? m.app.enviarAprovacao({ id: 'ur-P', place: m.P, idx: 0 })
    : m.app.enviarExclusao({ id: 'a1', place: m.P, idx: 0, url: FOTO('a1') }));
  return { ...m, nav, gesto, idasFeitas: () => n };
}

test('R6-3-04 aprovar: a ida que pousou com a rede caindo, e o gesto SEGUINTE volta "já tratado" — é desta pessoa', async () => {
  const JA = { success: false, errorCategory: 'already_processed' };
  const m = montarEntreGestos('aprovar', ['pousa-e-cai', JA]);
  assert.equal(await m.gesto(), false, 'PRÉ-CONDIÇÃO: o 1º gesto falha (sem rede, sem retentativa)');
  assert.equal(m.idasFeitas(), 1, 'PRÉ-CONDIÇÃO: sem rede o `callWithRetry` não insistiu');
  m.nav.onLine = true;                              // a rede volta; a pessoa toca "Aprovar" de novo
  m.log.length = 0;
  assert.equal(await m.gesto(), true, 'o "já tratado" da ida que POUSOU no gesto anterior virou de outro editor');
  assert.deepEqual(avisos(m.log), [], 'a aprovação desta pessoa foi avisada como "Já tratado por outro editor"');
  assert.deepEqual(m.log.filter((l) => l.startsWith('conquista:')), ['conquista:fotos'], 'o "Curador" não contou');
  // CONTROLE: a ida que NEM SAIU (o aparelho já estava sem rede) não pousou —
  // o "já tratado" do gesto seguinte é de OUTRO editor.
  const c = montarEntreGestos('aprovar', ['sem-rede', JA]);
  c.nav.onLine = false;
  await c.gesto();
  c.nav.onLine = true;
  c.log.length = 0;
  assert.equal(await c.gesto(), false);
  assert.deepEqual(avisos(c.log), ['toast:info:toast.alreadyProcessed'], 'CONTROLE: a ida que nem saiu deu a esta pessoa o "já feito" de outro');
  // CONTROLE: OUTRA sessão entre os gestos (a queda, o "Sair") — a memória não vale.
  const o = montarEntreGestos('aprovar', ['pousa-e-cai', JA]);
  await o.gesto();
  o.nav.onLine = true;
  o.app.setEpoca(1);
  o.log.length = 0;
  await o.gesto();
  assert.deepEqual(avisos(o.log), ['toast:info:toast.alreadyProcessed'], 'CONTROLE: a ida de OUTRA sessão contou como desta pessoa');
  // E o desfecho ESQUECE o alvo: um 3º gesto que volta "já tratado" é de outro.
  const d = montarEntreGestos('aprovar', ['pousa-e-cai', { success: true }, JA]);
  await d.gesto(); d.nav.onLine = true; await d.gesto();
  d.log.length = 0;
  await d.gesto();
  assert.deepEqual(avisos(d.log), ['toast:info:toast.alreadyProcessed'], 'a memória do alvo sobreviveu ao desfecho');
});

test('R6-3-04 excluir: a ida que pousou com a rede caindo, e o gesto SEGUINTE volta "já excluída" — sem "outro editor"', async () => {
  const JA = { success: true, jaExcluida: true };
  const m = montarEntreGestos('excluir', ['pousa-e-cai', JA]);
  assert.equal(await m.gesto(), false, 'PRÉ-CONDIÇÃO: o 1º gesto falha');
  m.nav.onLine = true;
  m.log.length = 0;
  assert.equal(await m.gesto(), true);
  assert.deepEqual(avisos(m.log), [], 'a exclusão desta pessoa foi avisada como "Outro editor já tinha excluído"');
  // CONTROLE: sem a ida perdida antes, o "já excluída" é de outro.
  const c = montarEntreGestos('excluir', [JA]);
  await c.gesto();
  assert.deepEqual(avisos(c.log), ['toast:info:toast.photoAlreadyGone']);
});

test('R6-3-04 a memória das idas tem teto e sai no "Sair"', () => {
  const corpo = ['idasSemRespostaDeAntes', 'lembrarIdasSemResposta'].map(fatiar).join('\n');
  const g = new Map();
  const h = new Function('idasSemRespostaGuardadas', 'IDAS_SEM_RESPOSTA_TETO', 'epocaDaSessao',
    corpo + '\nreturn { idasSemRespostaDeAntes, lembrarIdasSemResposta };')(g, 3, 0);
  for (let i = 0; i < 5; i++) h.lembrarIdasSemResposta('alvo' + i, 1, false, 0);
  assert.equal(g.size, 3, 'a memória das idas sem resposta cresce sem teto');
  assert.equal(h.idasSemRespostaDeAntes('alvo4'), 1);
  assert.equal(h.idasSemRespostaDeAntes('alvo0'), 0, 'o mais velho não saiu pelo teto');
  h.lembrarIdasSemResposta('alvo4', 1, true, 0);
  assert.equal(h.idasSemRespostaDeAntes('alvo4'), 0, 'o desfecho não esqueceu o alvo');
  assert.match(fatiar('handleLogout'), /idasSemRespostaGuardadas\.clear\(\);/, 'o "Sair" não esquece as idas de quem saiu');
});

// ── R6-3-02: excluir a ÚLTIMA foto com o Desfazer não larga o foco no <body> ──
// (auditoria de 2026-10-01). O `removerFoto` esvazia a lista e FECHA a foto
// ampliada — o foco volta à foto do card —, e o redesenho do card logo depois
// a tirava da página: o foco caía no <body> com o banner do Desfazer na tela
// (MEDIDO nos dois motores). Sem o Desfazer o caminho já passava pelo foco do
// card (R5-3-07); o foco em si é medido em test/lightbox-foco-card.test.mjs.
test('R6-3-02 excluir a ÚLTIMA foto COM o Desfazer: o card redesenhado passa pelo foco do card', () => {
  const ordem = [];
  const extra = { mantendoFocoNoCard: (redesenhar) => { ordem.push('guarda'); redesenhar(); },
    showCurrentPlace: () => ordem.push('redesenhou') };
  const m = montarEscritas({ resposta: { success: true }, preferencias: { undoEnabled: true }, extra });
  m.L.place.approvedImageIds = ['velha'];
  m.L.place.lat = -23; m.L.place.lon = -46;
  m.L.urls = [FOTO('velha')]; m.L.idx = 0; m.L.newIdx = -1;   // a única foto do local
  m.L.idFotoAtual = () => 'velha';
  m.app.pedirExclusaoDaFoto();
  assert.ok(m.pend.e, 'PRÉ-CONDIÇÃO: a janela do Desfazer não abriu');
  assert.equal(m.L.aberto, false, 'PRÉ-CONDIÇÃO: a última foto saiu e a foto ampliada não fechou');
  assert.deepEqual(ordem, ['guarda', 'redesenhou'],
    'o card foi redesenhado por fora do foco do card: o foco que o fechar pôs na foto dele caía no <body>');
});

// ── R6-3-06: trocar de foto com o foco NA AÇÃO não larga o foco no <body> ──────
// (auditoria de 2026-10-01). Com o foco no "Aprovar" (ou na lixeira), ← ou →
// trocam de foto e a ação, que é DA foto, some — o navegador tira o foco dela e
// ele caía no <body>, com a camada `aria-modal` aberta (MEDIDO nos dois
// motores). O `_render` de VERDADE e o `manterFocoNoLightbox` de verdade, com o
// documento de mentira que tira o foco do que some, como o navegador.
function fotoAmpliadaComFoco({ pilulaVisivel = true } = {}) {
  const doc = { body: { nome: 'BODY' }, activeElement: null };
  const el = (nome, { oculto = false } = {}) => {
    const e = { nome, oculto, isConnected: true, disabled: false, attrs: {}, filhos: [], closest: () => null,
      getClientRects: () => (e.oculto ? [] : [1]),
      focus() { if (!e.oculto && !e.disabled) doc.activeElement = e; },
      setAttribute(k, v) { e.attrs[k] = v; }, removeAttribute(k) { delete e.attrs[k]; }, appendChild(x) { e.filhos.push(x); } };
    e.classList = {
      toggle(c, v) { if (c !== 'hidden') return; e.oculto = v === undefined ? !e.oculto : !!v; if (e.oculto && doc.activeElement === e) doc.activeElement = doc.body; },
      add(c) { this.toggle(c, true); }, remove(c) { this.toggle(c, false); }, contains: (c) => c === 'hidden' && e.oculto,
    };
    return e;
  };
  const els = { lightboxImage: el('foto'), lightboxPrev: el('‹'), lightboxNext: el('›'), lightboxCount: el('contador'),
    lightboxNewBadge: el('selo'), lightboxApprove: el('Aprovar'), lightboxDelete: el('lixeira', { oculto: true }),
    lightboxNomeBtn: el('pílula', { oculto: !pilulaVisivel }), lightboxClose: el('✕') };
  els.imageLightbox = { contains: (x) => Object.values(els).includes(x) };
  doc.getElementById = (id) => els[id] || null;
  doc.createElement = () => el('span');
  // Sem a edição do nome aberta (a troca de foto não é assunto do R8-3-04).
  const manter = new Function('document', 'Lightbox', 'editandoNome', ['focavelNaTela', 'manterFocoNoLightbox'].map(fatiar).join('\n')
    + '\nreturn manterFocoNoLightbox;')(doc, { isOpen: () => true }, () => false);
  const L = new Function('document', 'urlDaFoto', 'altDaFoto', 'idadeDaFoto', 't', 'i18nLocale', 'atualizarAcoesDeFoto',
    'manterFocoNoLightbox', `return {
      place: { name: 'Padaria' }, placeName: 'Padaria', urls: ['u0', 'u1', 'u2'], idx: 1, newIdx: 1, eDenuncia: false,
      resetZoom() {}, dataDaFotoAtual() { return null; }, autorDaFotoAtual() { return null; }, _renderTira() {},
      ${metodo('_render')}
    };`)(doc, (u) => u, () => 'alt', () => '', (k) => k, () => 'pt-BR',
    // A ação é DA foto: o "Aprovar" só na proposta (a 1), a lixeira nas outras.
    () => { els.lightboxApprove.classList.toggle('hidden', L.idx !== L.newIdx); els.lightboxDelete.classList.toggle('hidden', L.idx === L.newIdx); },
    manter);
  return { L, doc, els };
}

test('R6-3-06 → com o foco no "Aprovar" (ou na lixeira): a ação some e o foco vai à pílula do nome, não ao <body>', () => {
  const m = fotoAmpliadaComFoco();
  m.els.lightboxApprove.focus();
  assert.equal(m.doc.activeElement, m.els.lightboxApprove, 'PRÉ-CONDIÇÃO: o foco no "Aprovar"');
  m.L.idx = 2; m.L._render();                      // a → (a foto seguinte, já no mapa)
  assert.ok(m.els.lightboxApprove.oculto, 'PRÉ-CONDIÇÃO: o "Aprovar" é da OUTRA foto e sumiu');
  assert.equal(m.doc.activeElement && m.doc.activeElement.nome, 'pílula',
    'o foco caiu no <body> com a foto ampliada (aria-modal) aberta — o Tab seguinte recomeça atrás dela');
  // E da lixeira, de volta pra proposta.
  m.doc.activeElement = null;
  m.els.lightboxDelete.focus();
  m.L.idx = 1; m.L._render();
  assert.equal(m.doc.activeElement && m.doc.activeElement.nome, 'pílula', 'da lixeira, o foco caiu no <body>');
  // Sem a pílula (quem não pode renomear), o ✕ — nunca a ação que ocupou o lugar.
  const s = fotoAmpliadaComFoco({ pilulaVisivel: false });
  s.els.lightboxApprove.focus();
  s.L.idx = 2; s.L._render();
  assert.equal(s.doc.activeElement && s.doc.activeElement.nome, '✕', 'sem a pílula o foco não foi pro ✕');
  // CONTROLE: com o foco no ✕ (que não some), a troca não o mexe.
  const c = fotoAmpliadaComFoco();
  c.els.lightboxClose.focus();
  c.L.idx = 2; c.L._render();
  assert.equal(c.doc.activeElement.nome, '✕', 'CONTROLE: a troca de foto tirou o foco do ✕');
});

// ── R6-3-07: o perfil que chega com a foto ABERTA acende o que é do portão ────
// (auditoria de 2026-10-01). O `/Session` é a chamada mais lenta da abertura, e
// a renovação da sessão zera o perfil: com a foto aberta antes dele, o
// "Aprovar", a lixeira e a pílula do nome seguiam escondidos pra um L6+AM até
// fechar e reabrir (MEDIDO). O `definirPerfil` de verdade, com o portão de
// verdade (`podeAgirComoL6Aqui`, `podeRenomearAqui`) e a tela de mentira.
function fotoAbertaSemPerfil({ aberta = true } = {}) {
  const ocultos = {};
  const el = (id) => ({ textContent: '', classList: { toggle(c, v) { if (c === 'hidden') ocultos[id] = !!v; },
    add(c) { if (c === 'hidden') ocultos[id] = true; }, remove(c) { if (c === 'hidden') ocultos[id] = false; } } });
  const els = Object.fromEntries(['lightboxNome', 'lightboxZoomHint', 'lightboxNomeTxt', 'lightboxDelete', 'lightboxApprove']
    .map((id) => [id, el(id)]));
  const P = { venueID: 'v1', updateRequestID: 'ur-P', name: 'Padaria 1', localAprovado: true };
  const AppState = { profile: null };
  const deps = {
    AppState, document: { getElementById: (id) => els[id] || null }, Treino: { ativo: false },
    editandoNome: () => false, fotoDoLightboxNaTela: () => true, fecharEdicaoNome: () => {},
    contaSegueNoAparelho: () => true, handleLogout: () => {}, aoConhecerConta: () => {}, guardarReferencias: () => {},
    guardarPerfilDoPortao: () => {}, guardarPrazoDaSessao: () => {}, renderProfileHeader: () => {},
    presencaWmeAoCarregarPerfil: () => {}, presencaWmeRefazerDesligar: () => {}, redesenharFiltrosComOPerfil: () => {},
    aplicarTravaDeAcao: () => {},   // a trava da pílula, que é do local da camada (R11-3-06)
    __P: P, __aberta: aberta,
  };
  const nomes = ['definirPerfil', 'reavaliarFotoAbertaPeloPerfil', 'mostrarNomeNoLightbox', 'podeRenomearAqui',
    'podeAgirComoL6Aqui', 'atualizarAcoesDeFoto'];
  const app = new Function(...Object.keys(deps),
    // A foto aberta é a PROPOSTA (o "Aprovar" é dela): o portão é o de verdade.
    'const Lightbox = { isOpen: () => __aberta, place: __P, idFotoAtual: () => null, podeAprovarAtual: () => podeAgirComoL6Aqui() };\n'
    + nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(...Object.values(deps));
  // O que a abertura da foto faz, sem perfil ainda.
  if (aberta) { app.mostrarNomeNoLightbox(); app.atualizarAcoesDeFoto(); }
  return { app, ocultos, AppState };
}
const L6AM = { success: true, profile: { id: 12444348, rank: 5, isAreaManager: true, isStaff: false } };

test('R6-3-07 o perfil L6+AM chega com a foto aberta: o "Aprovar" e a pílula do nome aparecem — sem fechar e reabrir', () => {
  const m = fotoAbertaSemPerfil();
  assert.ok(m.ocultos.lightboxApprove && m.ocultos.lightboxNome, 'PRÉ-CONDIÇÃO: sem perfil, sem "Aprovar" nem pílula (o portão fechado)');
  assert.equal(m.app.definirPerfil(L6AM), true);
  assert.equal(m.ocultos.lightboxApprove, false, 'o perfil L6+AM chegou com a foto aberta e o "Aprovar" seguiu escondido');
  assert.equal(m.ocultos.lightboxNome, false, 'o perfil L6+AM chegou com a foto aberta e a pílula do nome seguiu escondida');
  // CONTROLE: o perfil de quem NÃO pode (L5) deixa os dois escondidos.
  const n = fotoAbertaSemPerfil();
  n.app.definirPerfil({ success: true, profile: { id: 1, rank: 4, isAreaManager: true } });
  assert.ok(n.ocultos.lightboxApprove && n.ocultos.lightboxNome, 'CONTROLE: o perfil de um L5 acendeu as ações do L6');
  // CONTROLE: com a foto fechada, o perfil não mexe nela.
  const f = fotoAbertaSemPerfil({ aberta: false });
  f.app.definirPerfil(L6AM);
  assert.deepEqual(f.ocultos, {}, 'com a foto FECHADA o perfil redesenhou as ações dela');
});

// ── R6-3-08: o leitor de tela ouve a troca de foto e o desfecho sem Desfazer ──
// (auditoria de 2026-10-01). Trocar de foto deixava o foco no ✕ e nenhuma
// região viva mudava; sem o Desfazer, aprovar e renomear davam certo sem nada
// dito. A região é a da camada (`#lightboxAnuncio`, `sr-only`).
test('R6-3-08 a troca de foto é ANUNCIADA: a posição, e o selo quando é a proposta (o termo do selo)', () => {
  const anuncios = [];
  const t = (k, v) => (v ? `${k}${JSON.stringify(v)}` : k);
  const L = new Function('t', 'anunciarNoLightbox', `return {
    urls: ['a', 'b', 'c'], idx: 0, newIdx: 1, eDenuncia: false, renders: 0, _render() { this.renders++; },
    ${['prev', 'next', '_anunciarFoto'].map(metodo).join(',\n')}
  };`)(t, (txt) => anuncios.push(txt));
  L.next();
  assert.deepEqual(anuncios, ['lightbox.anuncio.fotoSelo{"i":2,"n":3,"selo":"card.newPhoto.title"}'],
    'a → trocou a foto e nada foi anunciado (ou sem dizer que é a proposta)');
  L.next();
  assert.equal(anuncios.at(-1), 'lightbox.anuncio.foto{"i":3,"n":3}');
  L.eDenuncia = true; L.idx = 2;
  L.prev();
  assert.equal(anuncios.at(-1), 'lightbox.anuncio.fotoSelo{"i":2,"n":3,"selo":"card.flaggedPhoto.title"}', 'a denúncia não disse o selo dela');
  // Uma foto só: não há troca, nem anúncio.
  L.urls = ['a']; L.idx = 0; const antes = anuncios.length;
  L.next(); L.prev();
  assert.equal(anuncios.length, antes, 'com uma foto só, a seta anunciou uma troca que não houve');
  // A tira também troca de foto (o toque na miniatura).
  assert.match(metodo('_renderTira'), /b\.addEventListener\('click', \(\) => \{ this\.idx = i; this\._render\(\); this\._anunciarFoto\(\); \}\);/,
    'a miniatura da tira troca de foto sem anunciar');
});

test('R6-3-08 a região é da CAMADA: o anúncio da foto de outro pedido não sai, e ela se esvazia ao fechar', () => {
  const regiao = { textContent: '' };
  const P = { venueID: 'v1' }, Q = { venueID: 'v2' };
  const anunciar = (aberta, place) => new Function('document', 'Lightbox', fatiar('anunciarNoLightbox') + '\nreturn anunciarNoLightbox;')(
    { getElementById: (id) => (id === 'lightboxAnuncio' ? regiao : null) }, { isOpen: () => aberta, place });
  anunciar(true, P)('Foto aprovada', P);
  assert.equal(regiao.textContent, 'Foto aprovada');
  anunciar(true, Q)('Foto excluída', P);
  assert.equal(regiao.textContent, 'Foto aprovada', 'o desfecho do pedido P foi anunciado com a foto de OUTRO pedido na tela');
  anunciar(false, P)('Renomeado', P);
  assert.equal(regiao.textContent, 'Foto aprovada', 'o desfecho foi anunciado com a foto fechada');
  anunciar(false, P)('');
  assert.equal(regiao.textContent, '', 'sem texto, a região não se esvaziou');
  assert.match(metodo('close'), /anunciarNoLightbox\(''\);/, 'fechar a foto deixa o anúncio dela (com o nome do local) no DOM');
  const html = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
  const camada = html.slice(html.indexOf('<div id="imageLightbox"'), html.indexOf('<div id="helpModal"'));
  assert.match(camada, /<p id="lightboxAnuncio" class="sr-only" role="status" aria-live="polite"><\/p>/,
    'a região viva da foto ampliada sumiu da camada (ou deixou de ser sr-only)');
});

test('R6-3-08 sem o Desfazer, aprovar e excluir que valeram são DITOS; o que falha, não', async () => {
  const ok = montarEscritas({ resposta: { success: true } });
  ok.app.aprovarFotoAtual();
  await umTique(); await umTique();
  assert.ok(ok.log.includes('anuncio:undo.photoApproved'), 'a aprovação sem o Desfazer valeu e nada foi dito ao leitor de tela');
  const f = montarEscritas({ resposta: { success: false, errorCategory: 'unknown' } });
  f.app.aprovarFotoAtual();
  await umTique(); await umTique();
  assert.ok(!f.log.some((l) => l.startsWith('anuncio:')), 'CONTROLE: a aprovação que FALHOU foi anunciada como feita');
  const e = montarEscritas({ resposta: { success: true }, extra: { aplicarNosIrmaos: () => {} } });
  e.L.place.approvedImageIds = ['velha']; e.L.place.lat = -23; e.L.place.lon = -46;
  e.L.idx = 0; e.L.idFotoAtual = () => 'velha';
  e.app.pedirExclusaoDaFoto();
  await umTique(); await umTique();
  assert.ok(e.log.includes('anuncio:undo.photoDeleted'), 'a exclusão sem o Desfazer valeu e nada foi dito');
  // CONTROLE: com o Desfazer quem diz é o banner (na região viva dele): nada aqui.
  const j = montarEscritas({ resposta: { success: true }, preferencias: { undoEnabled: true } });
  j.app.aprovarFotoAtual();
  j.timers[0]();
  await umTique(); await umTique();
  assert.ok(!j.log.some((l) => l.startsWith('anuncio:')), 'CONTROLE: com o Desfazer, o desfecho foi dito duas vezes');
});

// O `confirmarRenomear` de verdade, com a edição aberta e o resto de mentira.
// O desfecho sem o Desfazer passa pelo `anunciarDesfechoDaFoto` de verdade, e as
// duas regiões vivas ficam no `log` (R9-3-05): `fotoAberta` é a foto DESTE
// pedido na tela quando a resposta chega (a pessoa pode tê-la fechado antes),
// `frente` o pedido do card da frente e `camada` outra camada por cima do card.
function confirmarComCampo({ autenticado = true, editando = true, travado = false, semJanela = false, gravou = true,
  fotoAberta = true, frente = null, camada = false } = {}) {
  const log = [];
  const place = { venueID: 'v1', updateRequestID: 'u1', name: 'Nome Velho' };
  const Lightbox = { place, aberta: fotoAberta, isOpen() { return this.aberta; } };
  const deps = {
    Treino: { ativo: false }, podeRenomearAqui: () => autenticado,
    AppState: { authenticated: autenticado, preferences: { undoEnabled: !semJanela }, currentPlace: frente || place },
    document: { getElementById: (id) => (id === 'lightboxNomeInput' ? { value: 'Nome Novo' } : null) },
    Lightbox, acoesTravadas: () => travado || !autenticado, avisoDaTrava: () => 'toast.esperaSessao',
    renomeacaoNoAr: () => false, editandoNome: () => editando,
    showToast: (m) => log.push('toast:' + m), t: (k, v) => (v ? `${k}${JSON.stringify(v)}` : k), sairDaEdicaoNome: () => log.push('saiu'),
    fecharEdicaoNome: () => log.push('fechou'), aplicarNomeNaTela: (p, n) => log.push('nome:' + n),
    API: { getRegion: () => 'row' }, canDisableUndo: () => true,
    enviarRenomeacao: () => { log.push('ENVIOU'); return Promise.resolve(gravou); },
    renomeacaoPendente: null, aprovacaoPendente: null, exclusaoPendente: null,
    setTimeout: () => 1, clearTimeout() {}, UNDO_WINDOW_MS: 3000, aplicarTravaDeAcao() {}, removeUndoBanner() {},
    registrarDesfazer() {}, mostrarDesfazer: () => log.push('banner'), manterFocoNoLightbox() {},
    anunciarNoLightbox: (txt, p) => log.push('anuncio:' + txt), anunciarNoCard: (txt) => log.push('anuncioCard:' + txt),
    semCamadaAberta: () => !Lightbox.isOpen() && !camada,
  };
  const confirmar = new Function(...Object.keys(deps),
    fatiar('confirmarRenomear') + '\n' + fatiar('anunciarDesfechoDaFoto') + '\nreturn confirmarRenomear;')(...Object.values(deps));
  return { confirmar, log, Lightbox };
}

test('R6-3-08 renomear sem o Desfazer: o nome que pousou é DITO; o que não pousou, não', async () => {
  const m = confirmarComCampo({ semJanela: true });
  m.confirmar();
  await umTique();
  assert.ok(m.log.includes('anuncio:lightbox.anuncio.renomeado{"nome":"Nome Novo"}'), 'o nome gravado sem o Desfazer não foi dito ao leitor de tela');
  const f = confirmarComCampo({ semJanela: true, gravou: false });
  f.confirmar();
  await umTique();
  assert.ok(!f.log.some((l) => l.startsWith('anuncio:')), 'CONTROLE: o nome que NÃO pousou foi anunciado');
  // O enviar devolve se gravou (o anúncio depende disso).
  const env = fatiar('enviarRenomeacao');
  assert.match(env, /contarConquista\('nomes'\);\s*return true;/, 'o envio que gravou não diz que gravou');
});

// ── R9-3-05 (a): o nome que pousa com a foto JÁ fechada é dito pela região do card ──
// (auditoria de 2026-10-06). Sem o Desfazer, quem corrige o nome e fecha a foto
// antes da resposta seguia no card do MESMO pedido: a região da camada não fala
// (`anunciarNoLightbox` só com a foto deste pedido aberta) e o card não diz
// "Novo pedido" de novo — o leitor de tela não ouvia que o nome valeu (MEDIDO
// nos dois motores, r40 B). É dito pela região do CARD, como o R7-3-04.
test('R9-3-05 renomear sem o Desfazer e fechar a foto antes da resposta: o nome que pousou é DITO pela região do card', async () => {
  const m = confirmarComCampo({ semJanela: true });
  m.confirmar();
  m.Lightbox.aberta = false;                        // fechou a foto com o nome no ar
  await umTique();
  assert.ok(m.log.includes('ENVIOU'), 'PRÉ-CONDIÇÃO: o nome não saiu');
  assert.ok(m.log.includes('anuncioCard:lightbox.anuncio.renomeado{"nome":"Nome Novo"}'),
    `DEFEITO: o nome pousou com a foto fechada e nada foi dito ao leitor de tela (${m.log.filter((l) => l.startsWith('anuncio')).join(', ') || 'nada'})`);
  assert.ok(!m.log.some((l) => l.startsWith('anuncio:')), 'a região da camada FECHADA falou');
  // CONTROLES: o que NÃO pousou não é dito; com OUTRO local na frente (a pessoa
  // decidiu o card e seguiu), o desfecho não é do que se vê; com outra camada por
  // cima do card (um modal, o mapa ampliado), também não.
  const outro = { venueID: 'v9', updateRequestID: 'u9', name: 'Outro Local' };
  for (const [nome, opcoes] of [['não pousou', { gravou: false }], ['outro local na frente', { frente: outro }],
    ['outra camada por cima', { camada: true }]]) {
    const c = confirmarComCampo({ semJanela: true, ...opcoes });
    c.confirmar();
    c.Lightbox.aberta = false;
    await umTique();
    assert.ok(!c.log.some((l) => l.startsWith('anuncio')), `CONTROLE (${nome}): o desfecho foi dito — ${c.log.join(', ')}`);
  }
  // CONTROLE: o IRMÃO do mesmo local na frente recebe o mesmo nome (`aplicarNosIrmaos`): é dito.
  const irmao = confirmarComCampo({ semJanela: true, frente: { venueID: 'v1', updateRequestID: 'u2', name: 'Nome Velho' } });
  irmao.confirmar();
  irmao.Lightbox.aberta = false;
  await umTique();
  assert.ok(irmao.log.includes('anuncioCard:lightbox.anuncio.renomeado{"nome":"Nome Novo"}'),
    'com o irmão do mesmo local na frente (o nome dele também mudou), o desfecho não foi dito');
});

// ── R6-3-09: o texto alternativo das fotos e a pílula dizem o nome NOVO ────────
// (auditoria de 2026-10-01). Renomeado, o `alt` da foto ampliada e o da foto
// do card seguiam com o nome ANTIGO até trocar de foto, e a pílula era
// anunciada só como "Corrigir o nome do local", sem o nome que mostra.
test('R6-3-09 renomear refaz o texto alternativo da foto ampliada e da foto do card, na posição de cada uma', () => {
  const t = (k, v) => (v ? `${k}${JSON.stringify(v)}` : k);
  const P = { venueID: 'v1', updateRequestID: 'ur-P', name: 'Padaria 1', purType: 'NEW_PHOTO',
    imageUrls: [FOTO('a'), FOTO('ur-P'), FOTO('b')] };
  const imgLb = { alt: 'velho' }, txt = { textContent: '' };
  const fotoCard = { alt: 'velho', getAttribute: (k) => (k === 'src' ? FOTO('ur-P') + '?w=1' : null) };
  const nomeCard = { textContent: '' };
  const card = { querySelector: (s) => ({ '.card-name': nomeCard, '.card-image': fotoCard })[s] || null };
  const deps = {
    document: { getElementById: (id) => ({ lightboxImage: imgLb, lightboxNomeTxt: txt })[id] || null },
    Lightbox: { place: P, isOpen: () => true, idx: 2, urls: P.imageUrls.slice() },
    AppState: { currentPlace: P }, cardDaFrente: () => card, t, urlDaFoto: (u) => u + '?w=1',
  };
  const nomes = ['aplicarNomeNaTela', 'altDaFoto', 'identidadeDoPlace', 'fotosDoCard'];
  const app = new Function(...Object.keys(deps), nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(...Object.values(deps));
  app.aplicarNomeNaTela(P, 'Padaria Nova');
  assert.equal(txt.textContent, 'Padaria Nova');
  assert.equal(imgLb.alt, 'card.img.alt{"name":"Padaria Nova","i":3,"n":3}', 'o alt da foto ampliada seguiu com o nome antigo');
  assert.equal(fotoCard.alt, 'card.img.alt{"name":"Padaria Nova","i":2,"n":3}', 'o alt da foto do card seguiu com o nome antigo (ou na posição errada)');
  // CONTROLE: a foto ampliada de OUTRO pedido não muda.
  const outra = { alt: 'de Q' };
  const d2 = { ...deps, document: { getElementById: (id) => ({ lightboxImage: outra, lightboxNomeTxt: { textContent: '' } })[id] || null },
    Lightbox: { place: { name: 'Q' }, isOpen: () => true, idx: 0, urls: ['q'] }, cardDaFrente: () => null };
  new Function(...Object.keys(d2), nomes.map(fatiar).join('\n') + '\nreturn aplicarNomeNaTela;')(...Object.values(d2))(P, 'Padaria Nova');
  assert.equal(outra.alt, 'de Q', 'CONTROLE: a renomeação de P mexeu no alt da foto de outro pedido');
});

test('R6-3-09 a pílula é anunciada com o nome que mostra: o nome acessível vem do CONTEÚDO, sem aria-label fixo', () => {
  const html = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');
  const btn = /<button id="lightboxNomeBtn"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  assert.ok(btn, 'a pílula do nome sumiu');
  const abertura = btn[0].slice(0, btn[0].indexOf('>') + 1);
  assert.doesNotMatch(abertura, /aria-label=/, 'a pílula voltou a ter um aria-label fixo: o leitor de tela não ouve o nome do local');
  assert.match(btn[1], /<span class="sr-only" data-i18n="lightbox\.rename\.rotulo">[^<]+<\/span>\s*<span id="lightboxNomeTxt"/,
    'o nome acessível da pílula perdeu o que ela faz (o sr-only antes do nome)');
});

// ── R6-3-10: o Enter no campo do nome durante a RENOVAÇÃO diz o que esperar ────
// (auditoria de 2026-10-01). Sem sessão, o Enter saía calado ANTES do aviso da
// trava (o portão, sem perfil, era o primeiro a sair), com o nome digitado e o
// ✓ travado sem motivo à vista. Na conferência de um 401 ele já avisava (L23).
test('R6-3-10 Enter na edição do nome sem sessão (a renovação): avisa o que esperar, não renomeia e não fecha a edição', () => {
  const m = confirmarComCampo({ autenticado: false });
  m.confirmar();
  assert.deepEqual(m.log, ['toast:toast.esperaSessao'], 'sem sessão, o Enter saiu calado (ou renomeou, ou fechou a edição)');
  // CONTROLE: sem a edição aberta, nada a dizer.
  const s = confirmarComCampo({ autenticado: false, editando: false });
  s.confirmar();
  assert.deepEqual(s.log, []);
  // CONTROLE: com sessão e a trava (a conferência de um 401), o L23 de sempre.
  const c = confirmarComCampo({ travado: true });
  c.confirmar();
  assert.deepEqual(c.log, ['toast:toast.esperaSessao']);
});

// ── A foto FECHADA solta o pedido (follow-up do lote 10) ──────────────────────
// O `Lightbox.place` sobrevivia ao fechamento, e a exclusão sem o Desfazer que
// terminava com a foto já fechada achava "a foto deste pedido aberta":
// REDESENHAVA a camada escondida, pedindo a foto de novo e refazendo a tira
// (MEDIDO nos dois motores: a `src` do #lightboxImage voltando depois de
// fechar). O `open`, o `close` e o `removerFoto` de VERDADE, com a tela de
// mentira.
function fotoQueFecha() {
  const classes = new Set(['hidden']);
  const els = {
    imageLightbox: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } },
    lightboxImage: { src: 'x', removeAttribute(k) { if (k === 'src') this.src = null; } },
    lightboxStrip: { innerHTML: '<button>miniatura</button>', dataset: { chave: 'a|b' } },
  };
  const deps = {
    document: { getElementById: (id) => els[id] || null, body: { style: {} }, activeElement: null },
    CamadaVoltar: { empilhar() {}, consumir() {} }, mostrarNomeNoLightbox: () => {}, fecharEdicaoNome: () => {},
    avancarSeAprovado: () => {}, topOpenModal: () => null, anunciarNoLightbox: () => {}, devolverFocoDaAmpliacao: () => {},
    aoFecharCamada: () => {},   // o "Como funciona" adiado (R7-7-01), em test/como-funciona
  };
  const L = new Function(...Object.keys(deps), `return {
    place: null, urls: [], idx: 0, newIdx: -1, eDenuncia: false, placeName: '', renders: 0,
    isOpen() { return !document.getElementById('imageLightbox').classList.contains('hidden'); },
    _render() { this.renders++; }, resetZoom() {},
    ${['open', 'close', 'removerFoto', 'idAprovadoDaFoto'].map(metodo).join(',\n')}
  };`)(...Object.values(deps));
  return { L, els };
}

test('a foto FECHADA solta o pedido: a exclusão que termina depois muda o pedido, nunca a camada escondida', () => {
  const m = fotoQueFecha();
  const P = { venueID: 'v1', updateRequestID: 'ur-P', approvedImageIds: ['f1', 'f2'], imageUrls: [FOTO('f1'), FOTO('f2'), FOTO('ur-P')] };
  m.L.open(P.imageUrls, 0, 2, 'Padaria', false, P);
  // CONTROLE: com a foto ABERTA, a exclusão que termina redesenha a camada.
  const r0 = m.L.renders;
  m.L.removerFoto('f1', P);
  assert.equal(m.L.renders, r0 + 1, 'CONTROLE: com a foto aberta, a exclusão não redesenhou a camada');
  assert.deepEqual(m.L.urls, [FOTO('f2'), FOTO('ur-P')]);
  m.L.close();
  assert.equal(m.L.place, null, 'a foto fechou e a camada seguiu presa ao pedido');
  assert.deepEqual([m.L.urls, m.L.newIdx], [[], -1], 'a camada fechada guardou as fotos do pedido');
  assert.deepEqual([m.els.lightboxStrip.innerHTML, m.els.lightboxStrip.dataset.chave], ['', ''],
    'as miniaturas do pedido ficaram na camada escondida');
  // A exclusão da f2 termina AGORA, com a foto fechada.
  const r1 = m.L.renders;
  m.L.removerFoto('f2', P);
  assert.equal(m.L.renders, r1, 'a exclusão que terminou com a foto fechada redesenhou a camada escondida (pede a foto de novo)');
  assert.deepEqual(P.imageUrls, [FOTO('ur-P')], 'o PEDIDO (na fila, na tela) não recebeu a exclusão');
  assert.ok(!P.approvedImageIds.includes('f2'));
  // E reabrir a partir do card monta a camada de novo, do zero.
  m.L.open(P.imageUrls, 0, 0, 'Padaria', false, P);
  assert.equal(m.L.place, P);
  assert.deepEqual(m.L.urls, [FOTO('ur-P')]);
});

// ═══ Auditoria de 2026-10-02 (rodada 7, R7-3): a foto ampliada ═══════════════

// ── R7-3-02: a dica de zoom não VOLTA quando o perfil chega com a foto aberta ──
// O R6-3-07 passou a chamar o `mostrarNomeNoLightbox` em todo perfil que chega
// com a foto aberta (o atrasado, a renovação da sessão, a sonda de um 401). Ele
// fazia `toggle('hidden', pode)` na dica: pra quem NÃO tem a pílula, a dica que
// o relógio do `open` já tinha tirado VOLTAVA, sem relógio, e ficava sobre a
// foto até fechar (MEDIDO nos dois motores, L4+AM). O `open` e o
// `reavaliarFotoAbertaPeloPerfil` de VERDADE, o portão de verdade, e o relógio
// de mentira.
function fotoComDica() {
  const ocultos = { imageLightbox: true, lightboxZoomHint: true, lightboxNome: true };
  const el = (id) => ({ id, textContent: '', focus() {}, classList: {
    add(c) { if (c === 'hidden') ocultos[id] = true; }, remove(c) { if (c === 'hidden') ocultos[id] = false; },
    toggle(c, v) { if (c === 'hidden') ocultos[id] = v === undefined ? !ocultos[id] : !!v; },
    contains(c) { return c === 'hidden' && !!ocultos[id]; } } });
  const els = Object.fromEntries(['imageLightbox', 'lightboxClose', 'lightboxZoomHint', 'lightboxNome', 'lightboxNomeTxt']
    .map((id) => [id, el(id)]));
  const relogios = [];
  const AppState = { profile: null };
  const deps = {
    document: { getElementById: (id) => els[id] || null, body: { style: {} }, activeElement: null },
    CamadaVoltar: { empilhar() {} }, setTimeout: (fn) => relogios.push(fn), clearTimeout: () => {},
    AppState, Treino: { ativo: false }, fecharEdicaoNome: () => {}, atualizarAcoesDeFoto: () => {},
    aplicarTravaDeAcao: () => {},   // a trava da pílula, que é do local da camada (R11-3-06)
  };
  const nomes = ['mostrarNomeNoLightbox', 'reavaliarFotoAbertaPeloPerfil', 'podeRenomearAqui', 'podeAgirComoL6Aqui'];
  const app = new Function(...Object.keys(deps),
    `const Lightbox = { urls: [], idx: 0, newIdx: -1, place: null, _render() {},
      isOpen() { return !document.getElementById('imageLightbox').classList.contains('hidden'); },
      ${metodo('open')} };\n` + nomes.map(fatiar).join('\n') + `\nreturn { Lightbox, ${nomes.join(', ')} };`)(...Object.values(deps));
  return { app, ocultos, relogios, AppState };
}
const PADARIA = { venueID: 'v1', updateRequestID: 'ur-P', name: 'Padaria 1', localAprovado: true };

test('R7-3-02 o perfil que chega com a foto aberta não traz a dica de zoom de volta: quem a mostra é o `open`, com o relógio', () => {
  const m = fotoComDica();
  m.app.Lightbox.open(['u0'], 0, -1, 'Padaria 1', false, PADARIA);
  assert.equal(m.ocultos.lightboxZoomHint, false, 'CONTROLE: a foto abriu sem a dica (quem não tem a pílula a vê)');
  assert.equal(m.relogios.length, 1, 'CONTROLE: a dica nasceu sem o relógio que a tira');
  m.relogios[0]();                                    // os 4 s
  assert.equal(m.ocultos.lightboxZoomHint, true, 'PRÉ-CONDIÇÃO: o relógio não tirou a dica');
  // O perfil de um L4+AM chega (atrasado, a renovação, a sonda de um 401).
  m.AppState.profile = { id: 7, rank: 3, isAreaManager: true, isStaff: false };
  m.app.reavaliarFotoAbertaPeloPerfil();
  assert.equal(m.ocultos.lightboxZoomHint, true, 'DEFEITO: a dica voltou sobre a foto, sem relógio — fica até fechar');
  assert.equal(m.ocultos.lightboxNome, true, 'CONTROLE: um L4 ganhou a pílula do nome');
  // CONTROLE: o L6+AM que chega com a dica ainda na tela a tira (ela some pra
  // quem tem a pílula), e a pílula aparece.
  const n = fotoComDica();
  n.app.Lightbox.open(['u0'], 0, -1, 'Padaria 1', false, PADARIA);
  n.AppState.profile = { id: 7, rank: 5, isAreaManager: true, isStaff: false };
  n.app.reavaliarFotoAbertaPeloPerfil();
  assert.equal(n.ocultos.lightboxZoomHint, true, 'CONTROLE: com a pílula na tela, a dica seguiu no mesmo canto');
  assert.equal(n.ocultos.lightboxNome, false, 'CONTROLE: o L6+AM não ganhou a pílula');
});

// ── R7-3-04: sem o Desfazer, excluir a ÚLTIMA foto é dito — pela região do card ──
// O R6-3-08 diz "Foto excluída" pela região viva da camada, só com a foto DESTE
// pedido aberta; a última foto do local FECHA a camada (`removerFoto`) antes do
// anúncio, e nada era dito em região nenhuma — o foco ia pro mapa do card, que
// é redesenhado com o MESMO pedido (sem "Novo pedido"). MEDIDO nos dois motores.
// O `pedirExclusaoDaFoto` e o `enviarExclusao` de verdade, as DUAS regiões
// de verdade (`anunciarNoLightbox`, `anunciarNoCard`), e a camada que fecha
// quando a lista esvazia (o `removerFoto` de verdade).
// `dito`: o que a região do card já dizia (o anúncio do card da frente, R8-3-07).
// `aoFechar(m)`: o que o FECHAMENTO da camada faz com o card — a aprovação que
// pousou anda a fila (`avancarSeAprovado`) e o card seguinte ou o fim da fila
// escrevem na região do card, como o `renderCurrentCard` e o `showNoPlaces`.
// `outraCamada.aberta`: um modal (ou o mapa ampliado) por cima do card (R9-3-05).
function exclusaoQueAnuncia(fotos, { fechadaAntes = false, dito = '', aoFechar = null } = {}) {
  const regioes = { lightboxAnuncio: { textContent: '' }, cardLiveRegion: { textContent: dito } };
  const doc = { getElementById: (id) => regioes[id] || null };
  const porTras = {};
  const outraCamada = { aberta: false };
  const m = montarEscritas({ resposta: { success: true }, extra: {
    aplicarNosIrmaos: () => {}, document: doc,
    anunciarNoLightbox: (...a) => porTras.lb(...a), anunciarNoCard: (...a) => porTras.card(...a),
    semCamadaAberta: () => !porTras.L.isOpen() && !outraCamada.aberta,
  } });
  porTras.L = m.L;
  porTras.lb = new Function('document', 'Lightbox', fatiar('anunciarNoLightbox') + '\nreturn anunciarNoLightbox;')(doc, m.L);
  porTras.card = new Function('document', fatiar('anunciarNoCard') + '\nreturn anunciarNoCard;')(doc);
  Object.assign(m.A, { approvedImageIds: fotos.slice(), lat: -23, lon: -46, imageUrls: fotos.map(FOTO) });
  Object.assign(m.L, { urls: fotos.map(FOTO), idx: 0, newIdx: -1, idFotoAtual: () => fotos[0] });
  if (aoFechar) {
    m.L.close = function () { this.aberto = false; aoFechar(m, regioes); };
  }
  return { ...m, regioes, outraCamada, fecharAntes: fechadaAntes };
}

test('R7-3-04 sem o Desfazer, a exclusão da ÚLTIMA foto (que fecha a camada) é dita pela região do CARD', async () => {
  const m = exclusaoQueAnuncia(['so-ela']);
  m.app.pedirExclusaoDaFoto();
  await umTique(); await umTique();
  assert.equal(m.L.aberto, false, 'PRÉ-CONDIÇÃO: a última foto saiu e a camada não fechou');
  assert.equal(m.regioes.cardLiveRegion.textContent, 'undo.photoDeleted',
    'DEFEITO: a exclusão fechou a camada e nada disse que a foto saiu (o foco foi pro mapa do card, calado)');
  assert.equal(m.regioes.lightboxAnuncio.textContent, '', 'a camada FECHADA falou');
  // CONTROLE: com outra foto, a camada segue aberta e quem diz é ela — o card, não.
  const c = exclusaoQueAnuncia(['primeira', 'segunda']);
  c.app.pedirExclusaoDaFoto();
  await umTique(); await umTique();
  assert.equal(c.L.aberto, true, 'PRÉ-CONDIÇÃO: com duas fotos a camada fechou');
  assert.equal(c.regioes.lightboxAnuncio.textContent, 'undo.photoDeleted', 'CONTROLE: a camada aberta não disse');
  assert.equal(c.regioes.cardLiveRegion.textContent, '', 'com a camada aberta, o card também falou (dito duas vezes)');
  // A pessoa FECHOU a foto antes de a resposta chegar: a camada fechada não fala,
  // e o desfecho é dito pela região do card também (R9-3-05, logo abaixo).
  const f = exclusaoQueAnuncia(['so-ela']);
  f.app.pedirExclusaoDaFoto();
  f.L.aberto = false;
  await umTique(); await umTique();
  assert.deepEqual([f.regioes.cardLiveRegion.textContent, f.regioes.lightboxAnuncio.textContent], ['undo.photoDeleted', ''],
    'com a foto fechada pela pessoa antes da resposta, o desfecho não foi dito pela região do card (R9-3-05)');
});

// ── R9-3-05 (a): a exclusão que pousa com a foto JÁ fechada é dita pela região do card ──
// (auditoria de 2026-10-06). Sem o Desfazer, excluir uma foto e fechar a foto
// ampliada antes da resposta: o card do MESMO pedido é redesenhado sem a foto e
// não diz "Novo pedido" de novo (`pedidoAnunciado`), e a região da camada só fala
// com a foto deste pedido aberta — o leitor de tela não ouvia nada (MEDIDO nos
// dois motores, r40 A: `vivas: []`, com a foto fora do card). É dito pela região
// do CARD (`anunciarDesfechoDaFoto`), como o R7-3-04, com o card deste local na
// frente e nenhuma camada por cima.
test('R9-3-05 excluir sem o Desfazer e fechar a foto antes da resposta: "Foto excluída" é DITO pela região do card', async () => {
  const m = exclusaoQueAnuncia(['primeira', 'segunda']);
  m.app.pedirExclusaoDaFoto();
  m.L.aberto = false;                               // fechou com a exclusão no ar
  await umTique(); await umTique();
  assert.deepEqual(m.A.imageUrls, [FOTO('segunda')], 'PRÉ-CONDIÇÃO: a exclusão não pousou no pedido');
  assert.equal(m.regioes.cardLiveRegion.textContent, 'undo.photoDeleted',
    'DEFEITO: a foto saiu do card com a foto ampliada fechada e nada foi dito ao leitor de tela');
  assert.equal(m.regioes.lightboxAnuncio.textContent, '', 'a camada FECHADA falou');
  // O IRMÃO do mesmo local na frente (o pedido foi decidido no meio): ele também
  // perde a foto (`aplicarNosIrmaos`), e o desfecho é do que se vê.
  const i = exclusaoQueAnuncia(['primeira', 'segunda']);
  i.app.pedirExclusaoDaFoto();
  i.L.aberto = false;
  i.AppState.currentPlace = { venueID: i.A.venueID, updateRequestID: 'ur-irmao' };
  await umTique(); await umTique();
  assert.equal(i.regioes.cardLiveRegion.textContent, 'undo.photoDeleted', 'com o irmão do mesmo local na frente, o desfecho não foi dito');
  // CONTROLES: OUTRO local na frente; outra camada por cima do card; e a foto de
  // OUTRO pedido aberta — o desfecho não é do que se vê, e nada é dito.
  const casos = [
    ['outro local na frente', (c) => { c.L.aberto = false; c.AppState.currentPlace = { venueID: 'v-outro', updateRequestID: 'u-outro' }; }],
    ['um modal por cima do card', (c) => { c.L.aberto = false; c.outraCamada.aberta = true; }],
    ['a foto de OUTRO pedido aberta', (c) => { c.L.place = pedidoDeFoto('ur-outro'); }],
  ];
  for (const [nome, depois] of casos) {
    const c = exclusaoQueAnuncia(['primeira', 'segunda']);
    c.app.pedirExclusaoDaFoto();
    depois(c);
    await umTique(); await umTique();
    assert.deepEqual([c.regioes.cardLiveRegion.textContent, c.regioes.lightboxAnuncio.textContent], ['', ''],
      `CONTROLE (${nome}): o desfecho foi dito`);
  }
});

// ── R8-3-07: "Foto excluída" não APAGA o card que o fechamento trouxe ─────────
// (auditoria de 2026-10-03, costura do R7-3-04). Aprovar a foto proposta e
// excluí-la sem o Desfazer (a lixeira é o caminho de volta da aprovação), num
// local em que ela é a ÚNICA foto: o `removerFoto` fecha a camada, o fechamento
// anda a fila (a aprovação pousada) e o card seguinte diz "Novo pedido: …" — ou
// o fim diz "Tudo limpo!" — e, na MESMA tarefa, "Foto excluída" o sobrescrevia:
// o leitor de tela só ouvia "Foto excluída" (MEDIDO nos dois motores). As duas
// frases vão juntas quando o fechamento TROCOU o card.
test('R8-3-07 a exclusão que fecha a camada e TROCA o card diz as duas coisas: "Foto excluída" e o card novo (ou o fim da fila)', async () => {
  const ANTES = 'card.live.newRequest:Padaria A';
  const B = pedidoDeFoto('ur-B');
  // O card seguinte: o fechamento traz B e o `renderCurrentCard` o diz.
  const a = exclusaoQueAnuncia(['so-ela'], { dito: ANTES, aoFechar: (m, r) => {
    m.AppState.queue = [B]; m.AppState.currentPlace = B; r.cardLiveRegion.textContent = 'card.live.newRequest:Padaria B';
  } });
  a.app.pedirExclusaoDaFoto();
  await umTique(); await umTique();
  assert.equal(a.L.aberto, false, 'PRÉ-CONDIÇÃO: a última foto saiu e a camada não fechou');
  assert.equal(a.regioes.cardLiveRegion.textContent, 'undo.photoDeleted. card.live.newRequest:Padaria B',
    'DEFEITO: "Foto excluída" apagou o anúncio do card que o fechamento trouxe — o leitor de tela nunca ouve o card novo');
  // O ÚLTIMO pedido: o fechamento acaba a fila e o painel do fim se diz.
  const b = exclusaoQueAnuncia(['so-ela'], { dito: ANTES, aoFechar: (m, r) => {
    m.AppState.queue = []; m.AppState.currentPlace = null; r.cardLiveRegion.textContent = 'states.empty.title';
  } });
  b.app.pedirExclusaoDaFoto();
  await umTique(); await umTique();
  assert.equal(b.regioes.cardLiveRegion.textContent, 'undo.photoDeleted. states.empty.title',
    'DEFEITO: "Foto excluída" apagou o "Tudo limpo!" do fim da fila');
  // O irmão de MESMO nome e tipo: o texto é igual (o Chromium nem reescreve), mas
  // é OUTRO card na frente — a frase dele segue junto.
  const A2 = pedidoDeFoto('ur-A2');
  const s = exclusaoQueAnuncia(['so-ela'], { dito: ANTES, aoFechar: (m) => { m.AppState.queue = [A2]; m.AppState.currentPlace = A2; } });
  s.app.pedirExclusaoDaFoto();
  await umTique(); await umTique();
  assert.equal(s.regioes.cardLiveRegion.textContent, 'undo.photoDeleted. ' + ANTES,
    'o card trocado por um irmão de mesmo nome não foi dito junto da exclusão');
  // CONTROLE: a fila acabou SEM o painel (a busca ainda corre): o que a região
  // tem é do card que SAIU — não vai junto, a exclusão o sobrescreve.
  const c = exclusaoQueAnuncia(['so-ela'], { dito: ANTES, aoFechar: (m) => { m.AppState.queue = []; m.AppState.currentPlace = null; } });
  c.app.pedirExclusaoDaFoto();
  await umTique(); await umTique();
  assert.equal(c.regioes.cardLiveRegion.textContent, 'undo.photoDeleted',
    'CONTROLE: com a busca correndo, o anúncio VELHO (do card que saiu) foi dito de novo junto da exclusão');
  // CONTROLE (o R7-3-04): o fechamento NÃO trocou o card (o mesmo pedido,
  // redesenhado): só "Foto excluída" — o anúncio velho não é repetido.
  const r = exclusaoQueAnuncia(['so-ela'], { dito: ANTES });
  r.app.pedirExclusaoDaFoto();
  await umTique(); await umTique();
  assert.equal(r.regioes.cardLiveRegion.textContent, 'undo.photoDeleted',
    'CONTROLE: sem trocar o card, o anúncio velho foi repetido junto da exclusão');
});

// ── R7-3-05: com o TREINO aberto, a escrita que pousa chega aos irmãos da fila REAL ──
// No treino a `AppState.queue` é a fila de EXEMPLOS (clones com o venueID real) e
// a real fica em `Treino._salvo.queue`: a exclusão (e o nome) que pousava ali só
// mudava os clones, e ao sair do treino o irmão real seguia com a foto que saiu
// — a lixeira dele dizia "Outro editor já tinha excluído 👍" sobre a exclusão
// da própria pessoa — e com o nome velho (MEDIDO nos dois motores).
test('R7-3-05 com o TREINO aberto, a exclusão e o nome que pousam chegam aos irmãos da fila REAL', async () => {
  for (const escrita of ['excluir', 'renomear']) {
    const treino = { ativo: true, _salvo: { queue: null } };
    const m = montarIrmaos({ success: true }, { treino });
    treino._salvo.queue = [m.A, m.B, m.C];                       // a fila REAL, guardada
    const exemplo = JSON.parse(JSON.stringify(m.B));            // o card do treino (um clone)
    m.AppState.queue = [exemplo];
    m.AppState.currentPlace = exemplo;
    if (escrita === 'excluir') {
      m.A.imageUrls = [FOTO('f2')];
      assert.equal(await m.app.enviarExclusao({ id: 'f1', place: m.A, idx: 0, url: FOTO('f1') }), true);
      assert.deepEqual(m.B.imageUrls, [FOTO('f2')], 'DEFEITO: o irmão da fila REAL seguiu com a foto que saiu do mapa');
      assert.deepEqual(m.B.approvedImageIds, ['f2'], 'DEFEITO: a lixeira do irmão real seguiu oferecendo a foto que saiu');
      assert.deepEqual(m.C.imageUrls, [FOTO('f1')], 'mexeu no pedido de OUTRO local');
    } else {
      m.A.name = 'Padaria Nova';
      await m.app.enviarRenomeacao({ place: m.A, novo: 'Padaria Nova', antigo: 'Padaria Velha' });
      assert.equal(m.B.name, 'Padaria Nova', 'DEFEITO: o irmão da fila REAL seguiu com o nome velho');
      assert.equal(m.C.name, 'Outro', 'mexeu no pedido de OUTRO local');
    }
  }
  // CONTROLE: o treino FECHADO não alcança uma fila guardada que sobrou.
  const fechado = { ativo: false, _salvo: { queue: null } };
  const c = montarIrmaos({ success: true }, { treino: fechado });
  const sobra = { venueID: 'v1', updateRequestID: 'ur-S', name: 'Padaria Velha', imageUrls: [FOTO('f1')], approvedImageIds: ['f1'] };
  fechado._salvo.queue = [sobra];
  c.A.imageUrls = [FOTO('f2')];
  await c.app.enviarExclusao({ id: 'f1', place: c.A, idx: 0, url: FOTO('f1') });
  assert.deepEqual(c.B.imageUrls, [FOTO('f2')], 'CONTROLE: o irmão da fila de agora não recebeu a exclusão');
  assert.deepEqual(sobra.imageUrls, [FOTO('f1')], 'CONTROLE: o treino fechado mexeu numa fila guardada que sobrou');
});

// ── R7-3-06: o foco numa ação da foto que a TRAVA desabilita fica na camada ──
// A queda da sessão com a extensão renovando, a conferência de um 401, o lote no
// ar: o `aplicarTravaDeAcao` escreve `disabled` no "Aprovar", na lixeira e na
// pílula, o botão focado perde o foco e ele caía no <body> com a camada
// `aria-modal` aberta (MEDIDO nos dois motores). A trava e o
// `manterFocoNoLightbox` de verdade, num documento que tira o foco do botão
// que vira `disabled`, como o navegador.
function trancaComFoco({ aberta = true } = {}) {
  const doc = { body: { nome: 'BODY' }, activeElement: null };
  const el = (nome) => {
    const e = { nome, isConnected: true, oculto: false, _dis: false, closest: () => null, classList: { toggle() {} },
      querySelector: () => null, getClientRects: () => (e.oculto ? [] : [1]),
      focus() { if (!e.oculto && !e._dis) doc.activeElement = e; } };
    Object.defineProperty(e, 'disabled', { get: () => e._dis,
      set: (v) => { e._dis = !!v; if (e._dis && doc.activeElement === e) doc.activeElement = doc.body; } });
    return e;
  };
  const els = { lightboxApprove: el('Aprovar'), lightboxDelete: el('lixeira'), lightboxNomeBtn: el('pílula'), lightboxClose: el('✕') };
  els.lightboxDelete.oculto = true;
  els.imageLightbox = { contains: (x) => Object.values(els).includes(x) };
  doc.getElementById = (id) => els[id] || null;
  const estado = { travado: false };
  const deps = {
    document: doc, acoesTravadas: () => estado.travado, cardDaFrente: () => null, editandoNome: () => false,
    renomeacaoNoAr: () => false, exclusaoDoLocalNoAr: () => false, Lightbox: { isOpen: () => aberta, place: null }, atualizarBotaoSalvarNome: () => {},
    aplicarFocoDoTeclado: () => {}, dispensarAvisoDaTrava: () => {}, guardarFocoDaTrava: () => {},
    // o "Como funciona" adiado que a trava solta pede (R7-7-01, do lote do Histórico): aqui não é o assunto
    pedirComoFuncionaAdiado: () => {},
  };
  const app = new Function(...Object.keys(deps), 'let aprovandoAgora = false, excluindoAgora = false;\n'
    + ['focavelNaTela', 'manterFocoNoLightbox', 'aplicarTravaDeAcao'].map(fatiar).join('\n')
    + '\nreturn { aplicarTravaDeAcao };')(...Object.values(deps));
  return { app, doc, els, estado };
}

test('R7-3-06 a trava que desabilita a ação FOCADA da foto ampliada deixa o foco na camada, não no <body>', () => {
  for (const alvo of ['lightboxApprove', 'lightboxNomeBtn']) {
    const m = trancaComFoco();
    m.app.aplicarTravaDeAcao();
    m.els[alvo].focus();
    assert.equal(m.doc.activeElement, m.els[alvo], `PRÉ-CONDIÇÃO: o foco não pousou no ${m.els[alvo].nome}`);
    m.estado.travado = true;                          // a queda da sessão, a conferência de um 401, o lote
    m.app.aplicarTravaDeAcao();
    assert.equal(m.els[alvo].disabled, true, 'PRÉ-CONDIÇÃO: a trava não desabilitou a ação');
    assert.notEqual(m.doc.activeElement, m.doc.body,
      `DEFEITO: com o foco no ${m.els[alvo].nome}, a trava o jogou no <body> com a camada aria-modal aberta`);
    assert.equal(m.doc.activeElement && m.doc.activeElement.nome, '✕',
      'o foco não foi ao ✕ (a pílula trava junto) — e nunca a uma ação que pode ser a lixeira');
    m.estado.travado = false;                         // a renovação: destrava
    m.app.aplicarTravaDeAcao();
    assert.equal(m.doc.activeElement && m.doc.activeElement.nome, '✕', 'destravar tirou o foco da camada');
  }
  // CONTROLE: o foco no ✕ (que não trava) fica onde está.
  const c = trancaComFoco();
  c.els.lightboxClose.focus();
  c.estado.travado = true;
  c.app.aplicarTravaDeAcao();
  assert.equal(c.doc.activeElement.nome, '✕', 'CONTROLE: a trava mexeu no foco que estava no ✕');
  // CONTROLE: sem trava, a ação focada segue com o foco (nada a manter).
  const v = trancaComFoco();
  v.els.lightboxApprove.focus();
  v.app.aplicarTravaDeAcao();
  assert.equal(v.doc.activeElement.nome, 'Aprovar', 'CONTROLE: sem trava o foco saiu do "Aprovar"');
});

// ── R7-3-07: o toque nas ações TRAVADAS da foto ampliada diz por quê ──────────
// O C14 ligou o aviso da trava só na barra do card. O "Aprovar", a lixeira e a
// pílula travam pela MESMA função, e o toque neles não dizia nada — com o
// "Marcar todos" no ar, nada (MEDIDO nos dois motores). Botão `disabled` não
// recebe `click`, mas o `pointerdown`/`pointerup` chegam e sobem até a camada
// (MEDIDO no C14). O `setupLightbox` de VERDADE, com a camada de mentira que
// guarda os ouvintes, e o aviso contado (a decisão de avisar é do
// `avisarTravaAoTocar`, medida no C14).
function camadaQueOuve() {
  const no = (id, pai = null) => {
    const e = { id, pai, disabled: false, ouv: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(tipo, fn) { (this.ouv[tipo] = this.ouv[tipo] || []).push(fn); },
      closest(sel) {
        const ids = sel.split(',').map((x) => x.trim().replace(/^#/, ''));
        for (let n = this; n; n = n.pai) if (ids.includes(n.id)) return n;
        return null;
      } };
    return e;
  };
  const lb = no('imageLightbox');
  const els = { imageLightbox: lb, lightboxImage: no('lightboxImage', lb), lightboxClose: no('lightboxClose', lb),
    lightboxPrev: no('lightboxPrev', lb), lightboxNext: no('lightboxNext', lb),
    lightboxApprove: no('lightboxApprove', lb), lightboxDelete: no('lightboxDelete', lb) };
  els.lightboxNome = no('lightboxNome', lb);
  els.lightboxNomeBtn = no('lightboxNomeBtn', els.lightboxNome);
  const icone = no(null, els.lightboxApprove);               // o <svg> de dentro do botão
  const avisos = [];
  // Os ouvintes da foto (o load, o arraste, a roda) não são o assunto: só se registram.
  new Function('document', 'avisarTravaAoTocar', 'atualizarAcoesDeFoto', fatiar('setupLightbox') + '\nsetupLightbox();')(
    { getElementById: (id) => els[id] || null }, () => avisos.push('aviso'), () => {});
  const tocar = (inicio, fim = inicio) => {
    for (const fn of lb.ouv.pointerdown || []) fn({ target: inicio, type: 'pointerdown' });
    for (const fn of lb.ouv.pointerup || []) fn({ target: fim, type: 'pointerup' });
  };
  return { els, icone, avisos, tocar };
}

test('R7-3-07 o toque no "Aprovar", na lixeira e na pílula TRAVADOS da foto ampliada responde (o aviso da trava, como o card)', () => {
  const m = camadaQueOuve();
  for (const id of ['lightboxApprove', 'lightboxDelete', 'lightboxNomeBtn']) m.els[id].disabled = true;
  m.tocar(m.icone);                                   // o dedo no ícone do "Aprovar" travado
  assert.deepEqual(m.avisos, ['aviso'], 'DEFEITO: o toque no "Aprovar" travado da foto ampliada não respondeu');
  m.tocar(m.els.lightboxNomeBtn);
  assert.equal(m.avisos.length, 2, 'DEFEITO: o toque na pílula do nome travada não respondeu');
  m.tocar(m.els.lightboxDelete);
  assert.equal(m.avisos.length, 3, 'DEFEITO: o toque na lixeira travada não respondeu');
  // CONTROLE: o fim de um arraste que COMEÇA na foto e termina no botão não é toque.
  m.tocar(m.els.lightboxImage, m.icone);
  assert.equal(m.avisos.length, 3, 'CONTROLE: o fim de um arraste que só terminou no botão pediu o aviso');
  // CONTROLE: o toque na foto, no ✕ ou na seta não é ação travada.
  for (const id of ['lightboxImage', 'lightboxClose', 'lightboxNext']) m.tocar(m.els[id]);
  assert.equal(m.avisos.length, 3, 'CONTROLE: o toque fora das ações pediu o aviso da trava');
  // CONTROLE: a ação VIVA (sem `disabled`) recebe o clique, não o aviso.
  m.els.lightboxApprove.disabled = false;
  m.tocar(m.icone);
  assert.equal(m.avisos.length, 3, 'CONTROLE: o "Aprovar" vivo pediu o aviso da trava');
});

// ── R8-3-03: o ✓ "Salvar nome" TRAVADO responde ao toque, como o Enter do campo ──
// (auditoria de 2026-10-03, o caso 1). Corrigindo o nome com a trava acesa (a
// sessão renovando, a conferência de um 401), o ✓ fica `disabled` e o toque nele
// não dizia nada — enquanto o Enter no campo, na MESMA trava, diz "Espere a
// conferência da sessão terminar e toque de novo." (MEDIDO nos dois motores). O
// `setupLightbox` de VERDADE, com o `avisarTravaAoTocar` e o `avisoDaTrava` de
// verdade e o toast contado; a camada de mentira guarda os ouvintes.
function edicaoQueOuve({ travado }) {
  const no = (id, pai = null) => ({ id, pai, disabled: false, ouv: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(tipo, fn) { (this.ouv[tipo] = this.ouv[tipo] || []).push(fn); },
    closest(sel) {
      const ids = sel.split(',').map((x) => x.trim().replace(/^#/, ''));
      for (let n = this; n; n = n.pai) if (ids.includes(n.id)) return n;
      return null;
    } });
  const lb = no('imageLightbox');
  const els = { imageLightbox: lb, lightboxImage: no('lightboxImage', lb), lightboxClose: no('lightboxClose', lb),
    lightboxPrev: no('lightboxPrev', lb), lightboxNext: no('lightboxNext', lb),
    lightboxApprove: no('lightboxApprove', lb), lightboxDelete: no('lightboxDelete', lb) };
  els.lightboxNome = no('lightboxNome', lb);
  els.lightboxNomeBtn = no('lightboxNomeBtn', els.lightboxNome);
  els.lightboxNomeEdit = no('lightboxNomeEdit', els.lightboxNome);
  els.lightboxNomeInput = no('lightboxNomeInput', els.lightboxNomeEdit);
  els.lightboxNomeOk = no('lightboxNomeOk', els.lightboxNomeEdit);
  const iconeOk = no(null, els.lightboxNomeOk);               // o <svg> de dentro do ✓
  const toasts = [];
  const deps = {
    document: { getElementById: (id) => els[id] || null }, atualizarAcoesDeFoto: () => {},
    acoesTravadas: () => travado, AppState: { authenticated: true, contaEmDuvida: false }, extRenovando: false,
    loteDeLidosEmVoo: null, escritasConferindo: travado ? 1 : 0, contaDestaAbaEmDuvida: () => false,
    aprovacaoDaTelaNoAr: () => false, t: (k) => k,
    showToast: (msg) => { toasts.push(msg); return { dispensar() {} }; },
  };
  const intervalo = /^const AVISO_DA_TRAVA_INTERVALO_MS = \d+;$/m.exec(APP_SEM);
  assert.ok(intervalo, 'AVISO_DA_TRAVA_INTERVALO_MS sumiu');
  new Function(...Object.keys(deps), intervalo[0] + '\nlet avisoDaTravaEm = 0, avisoDaTravaNaTela = null, quedaAnunciada = false;\n'
    + ['avisoDaTrava', 'avisarTravaAoTocar', 'setupLightbox'].map(fatiar).join('\n') + '\nsetupLightbox();')(...Object.values(deps));
  const tocar = (inicio, fim = inicio) => {
    for (const fn of lb.ouv.pointerdown || []) fn({ target: inicio, type: 'pointerdown' });
    for (const fn of lb.ouv.pointerup || []) fn({ target: fim, type: 'pointerup' });
  };
  return { els, iconeOk, toasts, tocar };
}

test('R8-3-03 o toque no ✓ "Salvar nome" TRAVADO diz o que esperar (o Enter do campo já dizia) — sem a trava, o ✓ desabilitado segue calado', () => {
  const m = edicaoQueOuve({ travado: true });
  m.els.lightboxNomeOk.disabled = true;               // a trava o desabilita (`atualizarBotaoSalvarNome`)
  m.tocar(m.iconeOk);                                 // o dedo no ícone do ✓
  assert.deepEqual(m.toasts, ['toast.esperaSessao'],
    'DEFEITO: o toque no ✓ "Salvar nome" travado não disse nada — o Enter do campo, na mesma trava, diz o que esperar');
  // CONTROLE: o fim de um arraste que começa no CAMPO e só termina no ✓ não é toque.
  const a = edicaoQueOuve({ travado: true });
  a.els.lightboxNomeOk.disabled = true;
  a.tocar(a.els.lightboxNomeInput, a.iconeOk);
  assert.deepEqual(a.toasts, [], 'CONTROLE: o fim de um arraste que só terminou no ✓ pediu o aviso');
  // CONTROLE: sem a trava, o ✓ desabilitado por nome VAZIO (ou igual ao de agora) segue calado.
  const v = edicaoQueOuve({ travado: false });
  v.els.lightboxNomeOk.disabled = true;
  v.tocar(v.iconeOk);
  assert.deepEqual(v.toasts, [], 'o ✓ desabilitado pelo nome vazio, SEM trava, pediu o aviso da trava');
  // CONTROLE: o ✓ VIVO recebe o clique (o `confirmarRenomear`), não o aviso.
  const w = edicaoQueOuve({ travado: true });
  w.tocar(w.iconeOk);
  assert.deepEqual(w.toasts, [], 'CONTROLE: o ✓ vivo pediu o aviso da trava');
});

// ── R8-3-04: corrigindo o nome, a trava com o foco no ✓ leva o foco ao CAMPO ───
// (auditoria de 2026-10-03, costura do R7-3-06). Com a edição aberta e o foco no
// ✓ "Salvar nome" (o Tab a partir do campo), a trava acende — a sessão caindo
// com a extensão renovando, a conferência de um 401 —, o ✓ vira `disabled` e
// perde o foco, e o `manterFocoNoLightbox` o levava ao ✕ que FECHA A FOTO (a
// pílula é rótulo na edição): o Enter seguinte fechava a foto e jogava fora o
// nome digitado (MEDIDO nos dois motores). A trava, o `atualizarBotaoSalvarNome`
// e o `manterFocoNoLightbox` de verdade, num documento que tira o foco do botão
// que vira `disabled`, como o navegador.
function edicaoComFoco() {
  const doc = { body: { nome: 'BODY' }, activeElement: null };
  const el = (nome) => {
    const e = { nome, isConnected: true, oculto: false, _dis: false, value: '', closest: () => null, classList: { toggle() {} },
      querySelector: () => null, getClientRects: () => (e.oculto ? [] : [1]),
      focus() { if (!e.oculto && !e._dis) doc.activeElement = e; } };
    Object.defineProperty(e, 'disabled', { get: () => e._dis,
      set: (v) => { e._dis = !!v; if (e._dis && doc.activeElement === e) doc.activeElement = doc.body; } });
    return e;
  };
  const els = { lightboxApprove: el('Aprovar'), lightboxDelete: el('lixeira'), lightboxNomeBtn: el('pílula'),
    lightboxNomeInput: el('campo'), lightboxNomeOk: el('✓'), lightboxNomeCancel: el('✕ da edição'), lightboxClose: el('✕') };
  els.lightboxApprove.oculto = true;                  // editando, as ações de foto somem
  els.lightboxDelete.oculto = true;
  els.lightboxNomeInput.value = 'Padaria Certa';      // o nome digitado, diferente do de agora
  els.imageLightbox = { contains: (x) => Object.values(els).includes(x) };
  doc.getElementById = (id) => els[id] || null;
  const estado = { travado: false };
  const deps = {
    document: doc, acoesTravadas: () => estado.travado, cardDaFrente: () => null, editandoNome: () => true,
    renomeacaoNoAr: () => false, exclusaoDoLocalNoAr: () => false, Lightbox: { isOpen: () => true, place: { name: 'Padaria 1' } },
    aplicarFocoDoTeclado: () => {}, dispensarAvisoDaTrava: () => {}, guardarFocoDaTrava: () => {}, pedirComoFuncionaAdiado: () => {},
  };
  const app = new Function(...Object.keys(deps), 'let aprovandoAgora = false, excluindoAgora = false;\n'
    + ['focavelNaTela', 'manterFocoNoLightbox', 'atualizarBotaoSalvarNome', 'aplicarTravaDeAcao'].map(fatiar).join('\n')
    + '\nreturn { aplicarTravaDeAcao };')(...Object.values(deps));
  const onde = () => doc.activeElement && doc.activeElement.nome;
  return { app, doc, els, estado, onde };
}

test('R8-3-04 corrigindo o nome, a trava que acende com o foco no ✓ leva o foco ao CAMPO — não ao ✕ que fecha a foto', () => {
  const m = edicaoComFoco();
  m.app.aplicarTravaDeAcao();
  assert.equal(m.els.lightboxNomeOk.disabled, false, 'PRÉ-CONDIÇÃO: com um nome novo no campo e sem trava, o ✓ não está vivo');
  m.els.lightboxNomeOk.focus();                       // o Tab a partir do campo
  assert.equal(m.onde(), '✓', 'PRÉ-CONDIÇÃO: o foco não pousou no ✓');
  m.estado.travado = true;                            // a queda com a extensão renovando, a conferência de um 401
  m.app.aplicarTravaDeAcao();
  assert.equal(m.els.lightboxNomeOk.disabled, true, 'PRÉ-CONDIÇÃO: a trava não desabilitou o ✓');
  assert.equal(m.onde(), 'campo',
    `DEFEITO: a trava tirou o foco do ✓ e o levou ao ${m.onde()} — o Enter seguinte fecha a foto e joga fora o nome digitado`);
  m.estado.travado = false;                           // a renovação: destrava
  m.app.aplicarTravaDeAcao();
  assert.equal(m.els.lightboxNomeOk.disabled, false, 'a trava acabou e o ✓ não voltou a valer');
  assert.equal(m.onde(), 'campo', 'destravar tirou o foco do campo');
  // CONTROLES: o foco no CAMPO e no ✕ da EDIÇÃO (que não travam) fica onde está.
  for (const [alvo, nomeDele] of [['lightboxNomeInput', 'campo'], ['lightboxNomeCancel', '✕ da edição']]) {
    const c = edicaoComFoco();
    c.app.aplicarTravaDeAcao();
    c.els[alvo].focus();
    c.estado.travado = true;
    c.app.aplicarTravaDeAcao();
    assert.equal(c.onde(), nomeDele, `CONTROLE: a trava mexeu no foco que estava no ${nomeDele}`);
  }
});

// ── R7-3-08: a aprovação POUSOU sem resposta e a pessoa decide pelo CARD ───────
// A memória das idas sem resposta (R6-3-04) valia só pro gesto seguinte NA FOTO.
// A aprovação chega ao Waze e a rede cai na volta: "Erro de conexão", o ✨ e o
// "Aprovar" de volta. Com a rede de volta, o ✕ (ou o ✓) no card volta "já
// tratado" — quem resolveu foi a aprovação DELA —, e o card dizia "Já tratado
// por outro editor 👍" e contava um Rejeitado no placar e no Histórico, de um
// pedido APROVADO (MEDIDO nos dois motores). A aprovação de VERDADE (montarL1,
// com a retentativa de verdade), e o `handleActionResult` e o
// `registrarPousoDeSaida` de verdade, com a MESMA memória e a mesma sessão.
function cardDepoisDaAprovacao({ pousou = true } = {}) {
  const memoria = new Map();
  const nav = { onLine: true };
  const ida = async () => { if (pousou) nav.onLine = false; return SEM_RESPOSTA; };
  if (!pousou) nav.onLine = false;                   // a ida nem SAI: o aparelho já sem rede
  const m = montarL1({ respostas: [], viva: true, retentativa: retentativaCom(nav),
    extra: { navigator: nav, API: { aprovarPedido: ida }, idasSemRespostaGuardadas: memoria } });
  const log = [];
  // O gesto do card JÁ contou no placar (+1, otimista).
  const AppState = { stats: { read: 1, rejected: 1, skipped: 0 } };
  const deps = {
    AppState, idasSemRespostaGuardadas: memoria, IDAS_SEM_RESPOSTA_TETO: 50, epocaDaSessao: 0,
    dlog: () => {}, anotadoAntesDoEnvio: new WeakSet(), descargaNaFila: new WeakSet(),
    tirarDaFilaDeSaida: () => true, pousouPorOutraAba: () => log.push('outraAba'),
    registrarPouso: () => log.push('pouso'), recordHistory: (tipo) => log.push('historico:' + tipo),
    registrarRejeicaoDeAutor: () => log.push('reincidencia'), avisarConsequencia: () => {},
    registrarAcaoConfirmada: (tipo) => log.push('confirmada:' + tipo),
    showToast: (msg, tipo) => log.push(`toast:${tipo}:${msg}`), t: (k) => k, msgDoServidor: (r, d) => d,
    updateStats: () => {}, saveStats: () => {}, contarConquista: (k) => log.push('conquista:' + k),
    devolverPedidoRecusado: () => log.push('devolveu'),
  };
  const nomes = ['chaveDoPedido', 'idasSemRespostaDeAntes', 'lembrarIdasSemResposta', 'aprovacaoDelaJaPousou',
    'desfechoDaAprovacaoDela', 'handleActionResult', 'registrarPousoDeSaida'];
  const h = new Function(...Object.keys(deps), nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(
    ...Object.values(deps));
  const aprovar = () => m.app.enviarAprovacao({ id: 'ur-P', place: m.P, idx: 0 });
  return { m, h, nav, log, AppState, aprovar };
}
const JA_TRATADO = { success: false, errorCategory: 'already_processed', errorKey: 'srv.err.alreadyProcessed' };

test('R7-3-08 a aprovação POUSOU sem resposta e o ✕ (ou o ✓) do card volta "já tratado": é a aprovação DELA — sem "outro editor" e sem contar a decisão', async () => {
  for (const tipo of ['reject', 'read']) {
    const x = cardDepoisDaAprovacao();
    assert.equal(await x.aprovar(), false, 'PRÉ-CONDIÇÃO: a aprovação não deu "Erro de conexão" (a resposta se perdeu)');
    assert.equal(x.h.idasSemRespostaDeAntes('aprovar|v1|ur-P'), 1, 'PRÉ-CONDIÇÃO: a ida sem resposta não ficou guardada');
    x.nav.onLine = true;                              // a rede volta; a pessoa decide pelo card
    x.h.handleActionResult(tipo, x.m.P, JA_TRATADO, 'row', 0, null);
    assert.deepEqual(x.log.filter((l) => l.startsWith('toast:')), [],
      `DEFEITO (${tipo}): a aprovação DELA foi avisada como "Já tratado por outro editor"`);
    const k = tipo === 'read' ? 'read' : 'rejected';
    assert.equal(x.AppState.stats[k], 0, `DEFEITO (${tipo}): o pedido APROVADO contou a decisão do card no placar`);
    assert.ok(!x.log.some((l) => /^(historico|confirmada):/.test(l)), `DEFEITO (${tipo}): a decisão do card entrou no Histórico`);
    assert.ok(x.log.includes('pouso'), 'o pedido resolvido não pousou (voltaria como card)');
    assert.ok(x.log.includes('conquista:fotos'), 'o "Curador" não contou a aprovação dela');
    assert.equal(x.h.idasSemRespostaDeAntes('aprovar|v1|ur-P'), 0, 'a memória do alvo sobreviveu ao desfecho');
  }
  // O mesmo pela FILA DE SAÍDA: o ✕ dado SEM rede, depois da aprovação perdida,
  // sai quando a rede volta e o Waze diz "já tratado".
  const s = cardDepoisDaAprovacao();
  await s.aprovar();
  s.nav.onLine = true;
  s.h.registrarPousoDeSaida('reject', { venueID: 'v1', updateRequestID: 'ur-P' }, JA_TRATADO, { dia: '2026-10-02' });
  assert.equal(s.AppState.stats.rejected, 0, 'DEFEITO: pela fila de saída, o pedido aprovado contou um Rejeitado');
  assert.ok(!s.log.some((l) => /^(historico|confirmada):/.test(l)), 'DEFEITO: pela fila de saída, o Rejeitado entrou no Histórico');
  // CONTROLE: a 1ª ida que NEM SAIU (o aparelho já sem rede) não pousou — o
  // "já tratado" do card é de OUTRO editor: avisa, conta e vai pro Histórico.
  const c = cardDepoisDaAprovacao({ pousou: false });
  await c.aprovar();
  assert.equal(c.h.idasSemRespostaDeAntes('aprovar|v1|ur-P'), 0, 'PRÉ-CONDIÇÃO: a ida que nem saiu ficou na memória');
  c.nav.onLine = true;
  c.h.handleActionResult('reject', c.m.P, JA_TRATADO, 'row', 0, null);
  assert.deepEqual(c.log.filter((l) => l.startsWith('toast:')), ['toast:info:toast.alreadyProcessed'],
    'CONTROLE: o "já tratado" de OUTRO editor deixou de ser avisado');
  assert.equal(c.AppState.stats.rejected, 1, 'CONTROLE: a decisão do card deixou de contar');
  assert.ok(c.log.includes('historico:reject') && !c.log.includes('conquista:fotos'), 'CONTROLE: o Histórico (ou o "Curador") errou');
  // CONTROLE: a decisão que POUSA (o pedido não estava resolvido) conta como sempre.
  const ok = cardDepoisDaAprovacao();
  await ok.aprovar();
  ok.nav.onLine = true;
  ok.h.handleActionResult('reject', ok.m.P, { success: true }, 'row', 0, null);
  assert.equal(ok.AppState.stats.rejected, 1, 'CONTROLE: o ✕ que pousou de verdade deixou de contar');
  assert.ok(ok.log.includes('historico:reject'), 'CONTROLE: o ✕ que pousou não entrou no Histórico');
});

// ═══ Rodada 10 da auditoria (2026-10-07): a foto ampliada ═══════════════════

// A camada com os métodos de VERDADE que o gesto, o card e as respostas usam,
// aberta COMO O CARD a abre: pelo `fotosDoCard` de verdade (`renderCardImages` →
// `openLightbox`) — é por ele que a camada reaberta perde a foto denunciada
// (R10-3-01) e volta a apontar a proposta (R10-3-04). `L.anuncios` é a região
// viva da camada; `resolvido`, o `placeResolvidoPorAprovacao` (o do harness das
// escritas, quando a camada é usada com ele: os dois leem o MESMO).
function camadaDeVerdade({ resolvido = { v: null } } = {}) {
  const anuncios = [];
  const el = () => ({ classList: { add() {}, remove() {} }, focus() {} });
  const doc = { getElementById: () => el(), body: { style: {} }, activeElement: null };
  const nomes = ['open', 'recolocarFoto', 'removerFoto', 'podeAprovarAtual', 'idAprovadoDaFoto', 'idFotoAtual',
    'indiceDaFoto', '_anunciarFoto', 'marcarComoAprovada', 'desmarcarAprovada', 'esquecerProposta'];
  const L = new Function('document', 'CamadaVoltar', 'mostrarNomeNoLightbox', 'podeAgirComoL6Aqui', 'podeExcluirFotoAqui',
    '__res', 't', 'anunciarNoLightbox', 'setTimeout', 'clearTimeout', `return {
    place: null, urls: [], idx: 0, newIdx: -1, eDenuncia: false, aberto: false, renders: 0,
    isOpen() { return this.aberto; }, _render() { this.renders++; }, close() { this.aberto = false; },
    ${nomes.map(metodo).join(',\n').replace(/placeResolvidoPorAprovacao/g, '__res.v')}
  };`)(doc, { empilhar() {} }, () => {}, () => true, () => true, resolvido,
    (k, v) => (v ? `${k}${JSON.stringify(v)}` : k), (txt) => anuncios.push(txt), () => 0, () => {});
  L.anuncios = anuncios;
  const fotosDoCard = new Function(fatiar('fotosDoCard') + '\nreturn fotosDoCard;')();
  L.abrirPeloCard = (P) => {
    const f = fotosDoCard(P);
    L.open(f.urls, f.inicial, f.emDecisao, P.name, f.eDenuncia, P);
    L.aberto = true;
  };
  // O `devolverFoto` de verdade (o Desfazer e a falha da exclusão), nesta camada.
  L.devolverFoto = new Function('Lightbox', 'AppState', 'showCurrentPlace', 'mantendoFocoNoCard', 'fotoSaiuDoMapa',
    fatiar('devolverFoto') + '\nreturn devolverFoto;')(L, { currentPlace: null }, () => {}, (f) => f(), () => false);
  return L;
}

// ── R10-3-01: a foto DENUNCIADA que volta numa camada REABERTA é 🚩, não ✨ ─────
// (auditoria de 2026-10-07). Excluída a foto denunciada com o Desfazer, a foto
// ampliada fechada e REABERTA pelo card dentro da janela nasce do card — que já
// não tem a denunciada — com `eDenuncia: false`. O Desfazer (e a exclusão que
// falha no Waze) devolvia a foto com o selo no lugar certo e do TIPO errado: o ✨
// "Foto nova proposta neste pedido" sobre a foto DENUNCIADA, na camada, na tira e
// no anúncio (MEDIDO nos dois motores, r43). O alvo da exclusão guarda o tipo do
// selo, e o `recolocarFoto` o devolve. O `pedirExclusaoDaFoto`, o `enviarExclusao`,
// o `devolverFoto`, o `open` (pelo `fotosDoCard`), o `removerFoto`, o
// `recolocarFoto` e o `_anunciarFoto` de verdade.
test('R10-3-01 a foto DENUNCIADA excluída e a camada REABERTA pelo card na janela: o Desfazer (e a falha) a devolvem com o 🚩, não com o ✨', async () => {
  const novo = () => ({ venueID: 'vFL', updateRequestID: 'uFL', purType: 'FLAGGED_PHOTO', flagSubjectType: 'IMAGE',
    flagEntityID: 'denunciada', name: 'Padaria', lat: -23, lon: -46,
    approvedImageIds: ['aprov-a', 'denunciada', 'aprov-b'], imageUrls: [FOTO('aprov-a'), FOTO('denunciada'), FOTO('aprov-b')] });
  const DITO = 'lightbox.anuncio.fotoSelo{"i":2,"n":3,"selo":"card.flaggedPhoto.title"}';
  for (const [caso, reabre, desfecho] of [['reaberta + Desfazer', true, 'desfazer'],
    ['reaberta + a exclusão falha no Waze', true, 'falha'], ['CONTROLE sem reabrir + Desfazer', false, 'desfazer']]) {
    const L = camadaDeVerdade();
    const m = montarEscritas({ resposta: { success: false, errorCategory: 'unknown' }, preferencias: { undoEnabled: true },
      extra: { Lightbox: L, devolverFoto: L.devolverFoto, semCamadaAberta: () => !L.isOpen(), registrarDesfazer: () => {} } });
    const P = novo();
    L.abrirPeloCard(P);
    assert.deepEqual([L.idx, L.newIdx, L.eDenuncia], [1, 1, true], `${caso}: PRÉ-CONDIÇÃO — a camada não abriu na denunciada, com o 🚩`);
    m.app.pedirExclusaoDaFoto();                    // a lixeira, com a janela do Desfazer
    assert.ok(m.pend.e && L.urls.length === 2 && L.newIdx === -1,
      `${caso}: PRÉ-CONDIÇÃO — a denunciada não saiu da camada com a janela correndo`);
    if (reabre) {
      L.close();                                    // o Esc
      L.abrirPeloCard(P);                           // o toque na foto do card, ainda na janela
      assert.deepEqual([L.urls.length, L.newIdx, L.eDenuncia], [2, -1, false],
        `${caso}: PRÉ-CONDIÇÃO — a camada reaberta não nasceu do card sem a denunciada`);
    }
    L.anuncios.length = 0;
    if (desfecho === 'desfazer') m.pend.e.desfazer();
    else { m.timers.at(-1)(); await umTique(); await umTique(); }   // a janela vence, a exclusão sai e o Waze recusa
    assert.deepEqual(L.urls, P.imageUrls, `${caso}: a denunciada não voltou pra camada`);
    assert.equal(L.newIdx, 1, `${caso}: o selo não voltou pra denunciada (newIdx ${L.newIdx})`);
    assert.equal(L.eDenuncia, true, `DEFEITO (${caso}): a foto DENUNCIADA voltou com o ✨ "Foto nova proposta neste pedido"`);
    assert.deepEqual(L.anuncios, [DITO], `${caso}: o leitor de tela não ouviu a denunciada com o 🚩 (${L.anuncios.join(', ')})`);
  }
});

// ── R10-3-02: a camada de um IRMÃO do mesmo local fala pela região dela ───────
// (auditoria de 2026-10-07). Sem o Desfazer, com a foto ampliada de B aberta (A
// decidido, B — o irmão do mesmo local — na frente), a exclusão ou o nome de A
// que pousa muda a camada de B junto (`aplicarNosIrmaos`): a foto sai da tela, a
// contagem cai, a pílula e o `alt` ganham o nome novo — e nada era dito, nem pela
// camada nem pelo card (MEDIDO nos dois motores, r44). O `anunciarDesfechoDaFoto`,
// o `anunciarNoLightbox` e o `anunciarNoCard` de verdade, nas duas regiões.
function desfechoComCamada({ aberta, frente, fila }) {
  const regioes = { lightboxAnuncio: { textContent: '' }, cardLiveRegion: { textContent: '' } };
  const Lightbox = { place: aberta, isOpen() { return !!this.place; } };
  const deps = { document: { getElementById: (id) => regioes[id] || null }, Lightbox,
    AppState: { currentPlace: frente, queue: fila }, Treino: { ativo: false, _salvo: null },
    semCamadaAberta: () => !Lightbox.isOpen() };
  const nomes = ['anunciarDesfechoDaFoto', 'anunciarNoLightbox', 'anunciarNoCard', 'filaReal', 'filaRealComDevolvidos'];
  const h = new Function(...Object.keys(deps), nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(
    ...Object.values(deps));
  return { h, regioes };
}

test('R10-3-02 a exclusão (ou o nome) de A que pousa com a foto ampliada do IRMÃO B aberta é dita pela região da camada', () => {
  const A = { venueID: 'v1', updateRequestID: 'ur-A' };
  const B = { venueID: 'v1', updateRequestID: 'ur-B' };
  const C = { venueID: 'v2', updateRequestID: 'ur-C' };
  for (const texto of ['undo.photoDeleted', 'lightbox.anuncio.renomeado{"nome":"Padaria Certa"}']) {
    const m = desfechoComCamada({ aberta: B, frente: B, fila: [B, C] });   // A decidido; B na frente, com a foto aberta
    m.h.anunciarDesfechoDaFoto(texto, A);
    assert.equal(m.regioes.lightboxAnuncio.textContent, texto, `DEFEITO: a camada do irmão mudou e nada foi dito (${texto})`);
    assert.equal(m.regioes.cardLiveRegion.textContent, '', 'a região do CARD falou com a camada aberta por cima');
  }
  // CONTROLES: a camada do PRÓPRIO pedido fala (R6-3-08); a de OUTRO local não
  // (a escrita não a mudou); a de um pedido do mesmo local FORA da fila — o B de
  // uma fila refeita debaixo da camada, que o `aplicarNosIrmaos` não alcança e
  // não mudou — também não; e, com a camada fechada e o irmão na frente, quem
  // fala é o card (R9-3-05).
  const proprio = desfechoComCamada({ aberta: A, frente: A, fila: [A, B] });
  proprio.h.anunciarDesfechoDaFoto('undo.photoDeleted', A);
  assert.equal(proprio.regioes.lightboxAnuncio.textContent, 'undo.photoDeleted', 'CONTROLE: a camada do próprio pedido deixou de falar');
  for (const [nome, aberta] of [['outro local', C], ['fora da fila', { venueID: 'v1', updateRequestID: 'ur-B' }]]) {
    const c = desfechoComCamada({ aberta, frente: B, fila: [B, C] });
    c.h.anunciarDesfechoDaFoto('undo.photoDeleted', A);
    assert.deepEqual([c.regioes.lightboxAnuncio.textContent, c.regioes.cardLiveRegion.textContent], ['', ''],
      `CONTROLE (${nome}): uma camada que a escrita de A não mudou falou do desfecho dela`);
  }
  const fechada = desfechoComCamada({ aberta: null, frente: B, fila: [B, C] });
  fechada.h.anunciarDesfechoDaFoto('undo.photoDeleted', A);
  assert.equal(fechada.regioes.cardLiveRegion.textContent, 'undo.photoDeleted',
    'CONTROLE: com a camada fechada, o card do irmão na frente deixou de falar');
});

// De ponta a ponta: o `pedirExclusaoDaFoto` sem o Desfazer, o `enviarExclusao`, o
// `aplicarNosIrmaos` e o `removerFoto` de verdade — a foto sai da camada do irmão
// E isso é dito. Nas duas formas do r44: a camada de B na foto que sai (a tela
// troca de foto) e noutra foto (só a contagem cai).
test('R10-3-02 de ponta a ponta: a exclusão de A pousa com a camada de B aberta — a foto sai dela e a região da camada diz', async () => {
  for (const naFoto of ['f1', 'f2']) {
    const regioes = { lightboxAnuncio: { textContent: '' }, cardLiveRegion: { textContent: '' } };
    const doc = { getElementById: (id) => regioes[id] || null };
    let soltar;
    const ida = new Promise((ok) => { soltar = ok; });
    const porTras = {};
    const m = montarEscritas({ resposta: null, extra: {
      document: doc, API: { excluirFoto: () => ida, getRegion: () => 'row', prepararExclusao: () => {} },
      aplicarNosIrmaos: (...a) => porTras.irmaos(...a),
      anunciarNoLightbox: (...a) => porTras.lb(...a), anunciarNoCard: (...a) => porTras.card(...a),
      semCamadaAberta: () => !porTras.L.isOpen(),
    } });
    porTras.L = m.L;
    porTras.irmaos = new Function('AppState', 'filaRealComDevolvidos', 'montarCardDeFundo',
      fatiar('aplicarNosIrmaos') + '\nreturn aplicarNosIrmaos;')(m.AppState, () => m.AppState.queue, () => {});
    porTras.lb = new Function('document', 'Lightbox', fatiar('anunciarNoLightbox') + '\nreturn anunciarNoLightbox;')(doc, m.L);
    porTras.card = new Function('document', fatiar('anunciarNoCard') + '\nreturn anunciarNoCard;')(doc);
    const fotos = (ur) => [FOTO('f1'), FOTO(ur), FOTO('f2')];
    Object.assign(m.A, { approvedImageIds: ['f1', 'f2'], imageUrls: fotos('ur-A'), lat: -23, lon: -46 });
    const B = { venueID: m.A.venueID, updateRequestID: 'ur-B', purType: 'NEW_PHOTO', approvedImageIds: ['f1', 'f2'], imageUrls: fotos('ur-B') };
    m.AppState.queue = [m.A, B];
    Object.assign(m.L, { place: m.A, urls: m.A.imageUrls.slice(), idx: 0, newIdx: 1, aberto: true });
    m.L.idFotoAtual = () => m.L.idAprovadoDaFoto(m.L.urls[m.L.idx]);
    m.app.pedirExclusaoDaFoto();                    // a f1 na camada de A, sem o Desfazer: a ida fica no ar
    // A decidido (o ✕ pelo teclado), B na frente, e a foto ampliada de B aberta.
    m.AppState.queue = [B]; m.AppState.currentPlace = B;
    Object.assign(m.L, { place: B, urls: B.imageUrls.slice(), idx: B.imageUrls.indexOf(FOTO(naFoto)), newIdx: 1, aberto: true });
    soltar({ success: true, restantes: ['f2'] });
    await umTique(); await umTique();
    assert.ok(!m.L.urls.includes(FOTO('f1')) && m.L.urls.length === 2,
      `(camada na ${naFoto}) PRÉ-CONDIÇÃO: a exclusão de A não tirou a foto da camada aberta do irmão`);
    assert.equal(regioes.lightboxAnuncio.textContent, 'undo.photoDeleted',
      `DEFEITO (camada na ${naFoto}): a foto saiu da camada aberta do irmão e nada foi dito ao leitor de tela`);
    assert.equal(regioes.cardLiveRegion.textContent, '', 'a região do card falou com a camada aberta por cima');
  }
});

// ── R10-3-03: duas exclusões do MESMO local nunca no ar ao mesmo tempo ─────────
// (auditoria de 2026-10-07). O Waze não apaga uma foto, ele substitui a lista
// inteira do local (gotcha #57), e o servidor a monta da releitura guardada, que
// só é regravada depois de a escrita voltar. Com o Desfazer, a exclusão que já
// tinha saído não segurava a próxima do mesmo local: a 2ª saía com a 1ª no ar, o
// servidor relia a lista de antes e a última escrita ganhava — uma das duas se
// desfazia no Waze, as duas com `success: true` (MEDIDO no navegador, r47, e no
// core, n46). O `pedirExclusaoDaFoto`, o `enviarExclusao`, a vez do local, o
// `aplicarNosIrmaos` e o `callWithRetry` de verdade; o Waze de mentira segura
// cada ida até o roteiro responder. `devolverDeVerdade`: o `devolverFoto` (o
// Desfazer e a falha) e o `recolocarFoto` da camada de verdade (R12-3-02).
function exclusoesNoMesmoLocal({ devolverDeVerdade = false } = {}) {
  const log = [];
  const L = lightbox();
  L.idFotoAtual = () => L.idAprovadoDaFoto(L.urls[L.idx]);
  if (devolverDeVerdade) {
    L.recolocarFoto = new Function(`return { ${metodo('recolocarFoto')} };`)().recolocarFoto;
    L._anunciarFoto = () => log.push('anunciouFoto');
  }
  const fotos = (ur) => [FOTO('f1'), FOTO(ur), FOTO('f2'), FOTO('f3')];
  const A = { venueID: 'v1', updateRequestID: 'ur-A', purType: 'NEW_PHOTO', name: 'Padaria', lat: -23, lon: -46,
    approvedImageIds: ['f1', 'f2', 'f3'], imageUrls: fotos('ur-A') };
  const B = { ...A, updateRequestID: 'ur-B', approvedImageIds: ['f1', 'f2', 'f3'], imageUrls: fotos('ur-B') };   // o irmão
  const C = { venueID: 'v2', updateRequestID: 'ur-C', purType: 'NEW_PHOTO', name: 'Outro', lat: -22, lon: -45,
    approvedImageIds: ['g1'], imageUrls: [FOTO('g1'), FOTO('ur-C')] };
  const AppState = { authenticated: true, preferences: { undoEnabled: true }, queue: [A, B, C], currentPlace: A, serverTotal: 3 };
  const idas = [];
  const timers = [];
  const deps = {
    AppState, Lightbox: L, Treino: { ativo: false, _salvo: null },
    API: {
      excluirFoto: (venueID, imageID) => new Promise((ok) => { idas.push({ id: imageID, local: venueID, responder: ok }); }),
      prepararExclusao: (venueID) => log.push('preparar:' + venueID), getRegion: () => 'row',
    },
    canDisableUndo: () => true, lixeiraOcupada: () => {}, fotoDoLightboxNaTela: () => true, manterFocoNoLightbox: () => {},
    aprovandoAgora: false, excluindoAgora: false, mantendoFocoNoCard: (f) => f(), showCurrentPlace: () => {},
    aplicarTravaDeAcao: () => {}, removeUndoBanner: () => {}, mostrarDesfazer: () => {}, registrarDesfazer: () => {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, UNDO_WINDOW_MS: 3000,
    devolverFoto: (alvo) => log.push('devolveu:' + alvo.id), showToast: (msg, tipo) => log.push(`toast:${tipo}:${msg}`),
    msgDoServidor: () => '', t: (k) => k, montarCardDeFundo: () => {},
    refazerDepoisDo401: async () => null, anuncioDoCardAoFechar: () => () => {}, anunciarDesfechoDaFoto: () => {},
    sessaoTrocou: () => ({ success: false, errorCategory: 'session_changed' }), navigator: { onLine: true },
    TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [],
    ...r6Deps(log),
  };
  const nomes = ['pedirExclusaoDaFoto', 'enviarExclusao', 'aplicarNosIrmaos', 'escritaDoLightboxSemSessao',
    'contarIdasSemResposta', 'callWithRetry', ...R6_NOMES];
  if (devolverDeVerdade) { delete deps.devolverFoto; nomes.push('devolverFoto'); }
  const chaves = Object.keys(deps);
  const corpo = nomes.map(fatiar).join('\n').replace(/aprovacaoPendente/g, '__pend.a').replace(/exclusaoPendente/g, '__pend.e');
  const pend = { a: null, e: null };
  const app = new Function(...chaves, '__pend', 'epocaDaSessao', corpo + `\nreturn { ${nomes.join(', ')},
    setEpoca: (v) => { epocaDaSessao = v; } };`)(...chaves.map((k) => deps[k]), pend, 0);
  const abrirEm = (P, foto) => Object.assign(L, { place: P, urls: P.imageUrls.slice(), idx: P.imageUrls.indexOf(FOTO(foto)),
    newIdx: 1, aberto: true });
  const irPara = (foto) => { L.idx = L.urls.indexOf(FOTO(foto)); };
  // A janela do Desfazer vence sozinha: o `enviar` que o relógio chama.
  const vencerJanela = () => timers.at(-1)();
  const responder = (id, r) => { const i = idas.find((x) => x.id === id && !x.respondida); i.respondida = true; i.responder(r); };
  return { app, L, A, B, C, AppState, log, pend, abrirEm, irPara, vencerJanela, responder, saidas: () => idas.map((i) => i.id),
    aquecidas: () => log.filter((l) => l.startsWith('preparar:')) };
}

test('R10-3-03 com o Desfazer, a 2ª exclusão do MESMO local só SAI depois da resposta da 1ª — o gesto segue livre, e a releitura não é aquecida', async () => {
  // As duas janelas uma depois da outra (a 1ª já saiu quando a 2ª é pedida) e
  // juntas (a 2ª despacha a 1ª, como tocar na lixeira de novo sempre fez).
  for (const juntas of [false, true]) {
    const caso = juntas ? 'a 2ª despacha a janela da 1ª' : 'a 1ª já no ar';
    const m = exclusoesNoMesmoLocal();
    m.abrirEm(m.A, 'f1');
    m.app.pedirExclusaoDaFoto();                   // a 1ª: some da tela, a janela corre
    if (!juntas) {
      m.vencerJanela();                            // a janela vence: a 1ª sai e fica no ar
      assert.deepEqual(m.saidas(), ['f1'], `${caso}: PRÉ-CONDIÇÃO — sem outra no ar, a 1ª não saiu NA HORA`);
    }
    m.irPara('f2');
    m.app.pedirExclusaoDaFoto();                   // a 2ª, com a 1ª no ar (ou na janela, que ela despacha)
    assert.ok(!m.L.urls.includes(FOTO('f2')), `${caso}: o GESTO da 2ª esperou a 1ª — a foto não saiu da tela na hora`);
    assert.deepEqual(m.saidas(), ['f1'], `${caso}: PRÉ-CONDIÇÃO — a 1ª não está no ar`);
    m.vencerJanela();                              // a janela da 2ª vence
    await umTique(); await umTique();
    assert.deepEqual(m.saidas(), ['f1'],
      `DEFEITO (${caso}): a 2ª exclusão do local saiu com a 1ª no ar — o servidor relê a lista de antes, e uma das duas se desfaz no Waze`);
    m.responder('f1', { success: true, restantes: ['f2'] });
    await umTique(); await umTique();
    assert.deepEqual(m.saidas(), ['f1', 'f2'], `${caso}: a 2ª não saiu depois da resposta da 1ª`);
    // O aquecimento da 2ª não sai (MEDIDO no core: lido antes da escrita da 1ª,
    // ele guardava a lista velha com a hora nova, e a 2ª devolvia a foto da 1ª).
    assert.deepEqual(m.aquecidas(), ['preparar:v1'], `${caso}: o gesto da 2ª aqueceu a releitura com a 1ª no ar`);
    // Com as duas respondidas, a vez do local ACABA: a exclusão seguinte aquece de
    // novo e sai na hora.
    m.responder('f2', { success: true, restantes: ['f3'] });
    await umTique(); await umTique();
    m.irPara('f3');
    m.app.pedirExclusaoDaFoto(); m.vencerJanela();
    assert.deepEqual(m.saidas(), ['f1', 'f2', 'f3'], `${caso}: com o local livre, a exclusão seguinte não saiu na hora`);
    assert.deepEqual(m.aquecidas(), ['preparar:v1', 'preparar:v1'], `${caso}: a vez do local não acabou — a exclusão seguinte não aqueceu a releitura`);
  }
  // CONTROLE: a exclusão de OUTRO local não espera a vez deste (nem deixa de aquecer).
  const c = exclusoesNoMesmoLocal();
  c.abrirEm(c.A, 'f1'); c.app.pedirExclusaoDaFoto(); c.vencerJanela();
  c.abrirEm(c.C, 'g1'); c.app.pedirExclusaoDaFoto(); c.vencerJanela();
  assert.deepEqual(c.saidas(), ['f1', 'g1'], 'CONTROLE: a exclusão de OUTRO local esperou a vez de um local que não é o dela');
  assert.deepEqual(c.aquecidas(), ['preparar:v1', 'preparar:v2'], 'CONTROLE: o aquecimento de outro local deixou de sair');
  // CONTROLE: a 1ª que FALHA também passa a vez (a 2ª sai, e a foto da 1ª volta).
  const f = exclusoesNoMesmoLocal();
  f.abrirEm(f.A, 'f1'); f.app.pedirExclusaoDaFoto(); f.vencerJanela();
  f.irPara('f2'); f.app.pedirExclusaoDaFoto(); f.vencerJanela();
  f.responder('f1', { success: false, errorCategory: 'unknown' });
  await umTique(); await umTique();
  assert.deepEqual(f.saidas(), ['f1', 'f2'], 'CONTROLE: a 1ª falhou e a vez do local não passou pra 2ª');
  assert.ok(f.log.includes('devolveu:f1'), 'CONTROLE: a foto da exclusão que falhou não voltou');
});

test('R10-3-03 a MESMA foto excluída de novo pelo IRMÃO, com a 1ª no ar, não vai ao Waze — nem diz "Outro editor já tinha excluído"', async () => {
  for (const pousa of [true, false]) {
    const m = exclusoesNoMesmoLocal();
    m.abrirEm(m.A, 'f1'); m.app.pedirExclusaoDaFoto(); m.vencerJanela();   // a 1ª, no ar
    m.AppState.queue = [m.B, m.C]; m.AppState.currentPlace = m.B;           // A decidido, B (o irmão) na frente
    m.abrirEm(m.B, 'f1');                          // o irmão só perde a f1 quando a 1ª pousar
    m.app.pedirExclusaoDaFoto(); m.vencerJanela();
    await umTique(); await umTique();
    assert.deepEqual(m.saidas(), ['f1'], 'PRÉ-CONDIÇÃO: a 2ª (a mesma foto, pelo irmão) saiu com a 1ª no ar');
    m.responder('f1', pousa ? { success: true, restantes: ['f2'] } : { success: false, errorCategory: 'unknown' });
    await umTique(); await umTique(); await umTique();
    if (pousa) {
      assert.deepEqual(m.saidas(), ['f1'], 'DEFEITO: a foto que a 1ª já tirou do mapa foi ao Waze de novo');
      assert.deepEqual(avisos(m.log), [], 'DEFEITO: a exclusão da própria pessoa virou "Outro editor já tinha excluído 👍" (ou outro aviso)');
    } else {
      // CONTROLE: a 1ª FALHOU (a foto segue no mapa) — a 2ª vai.
      assert.deepEqual(m.saidas(), ['f1', 'f1'], 'CONTROLE: com a 1ª recusada, a 2ª (a foto segue no mapa) não saiu');
    }
  }
});

test('R10-3-03 a sessão que CAI com a 2ª esperando a vez: ela não sai com a sessão de quem entrou — volta pra tela e avisa', async () => {
  const m = exclusoesNoMesmoLocal();
  m.abrirEm(m.A, 'f1'); m.app.pedirExclusaoDaFoto(); m.vencerJanela();
  m.irPara('f2'); m.app.pedirExclusaoDaFoto(); m.vencerJanela();
  m.app.setEpoca(1);                               // a queda, renovada com a MESMA conta (a fila fica)
  m.responder('f1', { success: true, restantes: ['f2'] });
  await umTique(); await umTique(); await umTique();
  assert.deepEqual(m.saidas(), ['f1'], 'DEFEITO: a 2ª saiu, depois da espera, com a sessão de quem entrou depois da queda');
  assert.ok(m.log.includes('devolveu:f2'), 'a foto que não chegou ao Waze não voltou pra tela');
  assert.ok(m.log.includes('toast:error:toast.photoDeleteFailed'), 'a foto voltou calada');
});

// ── R10-3-04: a proposta já aprovada não leva ✨ nem "Aprovar" ─────────────────
// (auditoria de 2026-10-07). Aprovada com o Desfazer, a foto fechada (o
// fechamento despacha a aprovação) e REABERTA pelo card antes da resposta: a
// camada nasce do card, que aponta a proposta pelo pedido, e voltava com o ✨ na
// foto que a pessoa acabou de aprovar e com o "Aprovar" E a lixeira no mesmo canto
// — com a resposta, o "Aprovar" vivo por cima da lixeira, e o toque nele não fazia
// nada (MEDIDO nos dois motores, r48). O canto pela função de VERDADE
// (`atualizarAcoesDeFoto`): quem está à mostra.
function cantoDasAcoes(L) {
  const els = { lightboxDelete: { hidden: false }, lightboxApprove: { hidden: false } };
  for (const e of Object.values(els)) e.classList = { toggle: (c, v) => { if (c === 'hidden') e.hidden = !!v; } };
  new Function('document', 'Treino', 'editandoNome', 'fotoDoLightboxNaTela', 'Lightbox',
    fatiar('atualizarAcoesDeFoto') + '\nreturn atualizarAcoesDeFoto;')(
    { getElementById: (id) => els[id] || null }, { ativo: false }, () => false, () => true, L)();
  return { aprovar: !els.lightboxApprove.hidden, lixeira: !els.lightboxDelete.hidden, selo: L.newIdx >= 0 && L.idx === L.newIdx };
}

test('R10-3-04 aprovar com o Desfazer, fechar e REABRIR pelo card com a aprovação no ar: sem ✨ e sem "Aprovar" — só a lixeira, antes e depois da resposta', async () => {
  for (const desfecho of ['vale', 'falha']) {
    let soltar;
    const ida = new Promise((ok) => { soltar = ok; });
    const ponte = { m: null };
    const L = camadaDeVerdade({ resolvido: { get v() { return ponte.m ? ponte.m.resolvido() : null; } } });
    const m = montarEscritas({ resposta: null, preferencias: { undoEnabled: true }, extra: {
      Lightbox: L, devolverFoto: L.devolverFoto, semCamadaAberta: () => !L.isOpen(), registrarDesfazer: () => {},
      API: { aprovarPedido: () => ida, getRegion: () => 'row', prepararExclusao: () => {} } } });
    ponte.m = m;
    const P = { venueID: 'vNP', updateRequestID: 'uNP', purType: 'NEW_PHOTO', name: 'Padaria', lat: -23, lon: -46,
      approvedImageIds: ['aprov-a', 'aprov-b'], imageUrls: [FOTO('aprov-a'), FOTO('uNP'), FOTO('aprov-b')] };
    m.AppState.queue = [P]; m.AppState.currentPlace = P;
    L.abrirPeloCard(P);
    assert.deepEqual(cantoDasAcoes(L), { aprovar: true, lixeira: false, selo: true }, 'PRÉ-CONDIÇÃO: a proposta não abriu com o ✨ e o "Aprovar"');
    m.app.aprovarFotoAtual();                      // aprovar, com a janela do Desfazer
    assert.deepEqual(cantoDasAcoes(L), { aprovar: false, lixeira: true, selo: false }, 'PRÉ-CONDIÇÃO: o gesto não marcou a foto como aprovada');
    L.close(); m.pend.a.enviar();                  // o Esc: o fechamento despacha a aprovação (`avancarSeAprovado`), que fica no ar
    L.abrirPeloCard(P);                            // o toque na foto do card, que segue na tela até a resposta
    assert.deepEqual(cantoDasAcoes(L), { aprovar: false, lixeira: true, selo: false },
      'DEFEITO: reaberta com a aprovação no ar, a camada voltou com o ✨ na foto aprovada e/ou o "Aprovar" e a lixeira no mesmo canto');
    soltar(desfecho === 'vale' ? { success: true } : { success: false, errorCategory: 'unknown' });
    await umTique(); await umTique();
    if (desfecho === 'vale') {
      assert.equal(m.resolvido(), P, 'PRÉ-CONDIÇÃO: a aprovação não pousou com a camada do pedido aberta');
      assert.deepEqual(cantoDasAcoes(L), { aprovar: false, lixeira: true, selo: false }, 'a resposta trouxe o ✨ ou o "Aprovar" de volta');
    } else {
      // CONTROLE: a aprovação que FALHA devolve a proposta — o ✨ e o "Aprovar", sem a lixeira.
      assert.deepEqual(cantoDasAcoes(L), { aprovar: true, lixeira: false, selo: true }, 'CONTROLE: a falha não devolveu o ✨ e o "Aprovar"');
    }
  }
  // CONTROLE: a 🚩 da foto DENUNCIADA fica no `open` — ela é uma das aprovadas
  // por definição (está no mapa).
  const D = camadaDeVerdade();
  D.abrirPeloCard({ venueID: 'vFL', updateRequestID: 'uFL', purType: 'FLAGGED_PHOTO', flagEntityID: 'denunciada', name: 'X',
    lat: -23, lon: -46, approvedImageIds: ['denunciada'], imageUrls: [FOTO('denunciada')] });
  assert.deepEqual([D.newIdx, D.eDenuncia], [0, true], 'CONTROLE: o `open` tirou a 🚩 da foto denunciada (aprovada por definição)');
});

test('R10-3-04 o canto é exclusivo por CONSTRUÇÃO: a foto aprovada só tem a lixeira, e a proposta pendente só o "Aprovar"', () => {
  const L = camadaDeVerdade();
  const P = { venueID: 'vNP', updateRequestID: 'uNP', purType: 'NEW_PHOTO', name: 'Padaria', lat: -23, lon: -46,
    approvedImageIds: ['aprov-a'], imageUrls: [FOTO('aprov-a'), FOTO('uNP')] };
  L.abrirPeloCard(P);
  assert.deepEqual(cantoDasAcoes(L), { aprovar: true, lixeira: false, selo: true }, 'PRÉ-CONDIÇÃO: a proposta pendente sem o "Aprovar"');
  // O estado contraditório — o selo apontando a proposta que já está entre as
  // aprovadas (o dado mudou por um caminho que não mexeu no `newIdx`): vale o DADO.
  P.approvedImageIds.push('uNP');
  assert.deepEqual(cantoDasAcoes(L), { aprovar: false, lixeira: true, selo: true },
    'DEFEITO: a foto já aprovada ofereceu o "Aprovar" (sozinho ou junto da lixeira, no mesmo canto)');
  // CONTROLE: a foto aprovada de sempre (sem selo) só tem a lixeira.
  L.idx = 0;
  assert.deepEqual(cantoDasAcoes(L), { aprovar: false, lixeira: true, selo: false }, 'CONTROLE: a foto no mapa perdeu a lixeira');
});

test('R10-3-04 a aprovação que VALE marca a foto como aprovada e redesenha a camada do MESMO pedido — é o envio que marca, com ou sem a janela', async () => {
  // A camada do pedido mostra a proposta SEM a marca: aberta antes de ela existir.
  const m = montarEscritas({ resposta: { success: true } });
  m.A.approvedImageIds = ['velha'];
  Object.assign(m.L, { idx: 1, newIdx: 1 });
  const antes = m.L.renders;
  assert.equal(await m.app.enviarAprovacao({ id: 'ur-A', place: m.A, idx: 1 }), true, 'PRÉ-CONDIÇÃO: a aprovação não valeu');
  assert.ok(m.A.approvedImageIds.includes('ur-A'), 'a aprovação que valeu não pôs a foto entre as aprovadas');
  assert.equal(m.L.newIdx, -1, 'DEFEITO: a aprovação que valeu deixou o ✨ (e o "Aprovar") na foto da camada aberta');
  assert.ok(m.L.renders > antes, 'a camada do pedido não foi redesenhada com a aprovação');
  // CONTROLES: a que FALHA não marca, e o "já tratado" por OUTRO editor só tira a
  // proposta, sem pô-la entre as aprovadas (L30).
  for (const [nome, resposta] of [['falha', { success: false, errorCategory: 'unknown' }],
    ['outro editor', { success: false, errorCategory: 'already_processed' }]]) {
    const c = montarEscritas({ resposta });
    Object.assign(c.L, { idx: 1, newIdx: 1 });
    await c.app.enviarAprovacao({ id: 'ur-A', place: c.A, idx: 1 });
    assert.ok(!c.A.approvedImageIds.includes('ur-A'), `CONTROLE (${nome}): a foto virou "aprovada" sem a aprovação ter valido`);
  }
});

// ═══ Rodada 11 da auditoria (2026-10-07): a foto ampliada ═══════════════════

// ── R11-3-01: a aprovação e a exclusão do MESMO local numa vez só ────────────
// Com o Desfazer, a exclusão de X que já tinha saído (a janela venceu) não
// segurava a aprovação de P, do mesmo local: ela saía e pousava, e no servidor a
// resposta da exclusão regravava a lista de antes (P pendente) — a exclusão
// seguinte mandava P de volta como `approved: false` (MEDIDO de ponta a ponta e
// no core; o lado do servidor está em test/portao-servidor). Aqui o lado do
// cliente: o `pedirExclusaoDaFoto`, o `aprovarFotoAtual`, os dois envios, a vez
// das fotos do local e o `callWithRetry` de verdade; o Waze de mentira segura
// cada ida até o teste responder. `ponte.app` deixa a trava de mentira ler o
// "exclusão no ar" de verdade (R11-3-06).
// `aquecimentoNoAr`: o aquecimento da lixeira (`API.prepararExclusao`) devolve a
// promessa do pedido, que fica no ar até o teste responder (`responderAquecimento`)
// — como o de verdade (R12-3-01). Sem a opção, ele não devolve nada (o pedido sem
// sessão, ou o dublê antigo), e nada espera por ele.
function fotosNoMesmoLocal({ aquecimentoNoAr = false } = {}) {
  const log = [];
  const aquecimentos = [];
  const L = lightbox();
  L.idFotoAtual = () => L.idAprovadoDaFoto(L.urls[L.idx]);
  const fotos = (ur) => [FOTO('f1'), FOTO(ur), FOTO('f2')];
  const A = { venueID: 'v1', updateRequestID: 'ur-A', purType: 'NEW_PHOTO', name: 'Padaria', lat: -23, lon: -46,
    approvedImageIds: ['f1', 'f2'], imageUrls: fotos('ur-A') };
  const B = { ...A, updateRequestID: 'ur-B', approvedImageIds: ['f1', 'f2'], imageUrls: fotos('ur-B') };   // o irmão
  const C = { venueID: 'v2', updateRequestID: 'ur-C', purType: 'NEW_PHOTO', name: 'Outro', lat: -22, lon: -45,
    approvedImageIds: ['g1'], imageUrls: [FOTO('g1'), FOTO('ur-C')] };
  const AppState = { authenticated: true, preferences: { undoEnabled: true }, queue: [A, B, C], currentPlace: A, serverTotal: 3, fetchEpoch: 0 };
  const idas = [];
  const timers = [];
  const decididos = new WeakSet();
  const ponte = { app: null };
  const ida = (tipo, id, local) => new Promise((ok) => { idas.push({ tipo, id, local, responder: ok }); });
  const deps = {
    AppState, Lightbox: L, Treino: { ativo: false, _salvo: null },
    API: {
      excluirFoto: (venueID, imageID) => ida('excluir', imageID, venueID),
      aprovarPedido: (venueID, ur) => ida('aprovar', ur, venueID),
      prepararExclusao: (venueID) => {
        log.push('preparar:' + venueID);
        return aquecimentoNoAr ? new Promise((ok) => { aquecimentos.push(ok); }) : undefined;
      },
      getRegion: () => 'row',
    },
    canDisableUndo: () => true, lixeiraOcupada: () => {}, estadoAprovando: () => {}, fotoDoLightboxNaTela: () => true,
    manterFocoNoLightbox: () => {}, aprovandoAgora: false, excluindoAgora: false, mantendoFocoNoCard: (f) => f(),
    showCurrentPlace: () => {}, removeUndoBanner: () => {}, mostrarDesfazer: () => {}, registrarDesfazer: () => {},
    // A trava de mentira anota o que a pílula do LOCAL aberto mostraria (R11-3-06).
    aplicarTravaDeAcao: () => { if (ponte.app && L.place) log.push('pilula:' + ponte.app.exclusaoDoLocalNoAr(L.place)); },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, UNDO_WINDOW_MS: 3000,
    devolverFoto: (alvo) => log.push('devolveu:' + alvo.id), showToast: (msg, tipo) => log.push(`toast:${tipo}:${msg}`),
    msgDoServidor: () => '', t: (k) => k, montarCardDeFundo: () => {},
    refazerDepoisDo401: async () => null, anuncioDoCardAoFechar: () => () => {}, anunciarDesfechoDaFoto: () => {},
    sessaoTrocou: () => ({ success: false, errorCategory: 'session_changed' }), navigator: { onLine: true },
    TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [],
    // A aprovação: o pouso e a trava do card são medidos noutros testes.
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(), marcarEmAndamento: () => {}, refazerSelosSeOutroNaTela: () => {},
    voltarDaAprovacaoRecusada: () => {}, registrarPouso: () => log.push('pouso'), updateStats: () => {},
    contarConquista: () => {}, updatePendingCount: () => {}, aoMudarAFilaPorBaixo: () => {}, advanceQueue: () => {},
    aprovacaoPousouDepoisDaQueda: () => {}, decididosPorOutraAbaComCardAqui: decididos,
    ...r6Deps(log),
  };
  const nomes = ['pedirExclusaoDaFoto', 'enviarExclusao', 'aprovarFotoAtual', 'enviarAprovacao', 'concluirAprovacao',
    'tirarAprovadoDaFila', 'pousouNoWaze', 'chaveDoPedido', 'aplicarNosIrmaos', 'escritaDoLightboxSemSessao',
    'contarIdasSemResposta', 'callWithRetry', ...R6_NOMES];
  const chaves = Object.keys(deps);
  const corpo = nomes.map(fatiar).join('\n').replace(/placeResolvidoPorAprovacao = /g, '__res.v = ')
    .replace(/aprovacaoPendente/g, '__pend.a').replace(/exclusaoPendente/g, '__pend.e');
  const pend = { a: null, e: null };
  const app = new Function(...chaves, '__res', '__pend', 'epocaDaSessao', 'let tratouNestaFila = false;\n' + corpo
    + `\nreturn { ${nomes.join(', ')}, setEpoca: (v) => { epocaDaSessao = v; } };`)(...chaves.map((k) => deps[k]), { v: null }, pend, 0);
  ponte.app = app;
  const abrirEm = (P, foto) => Object.assign(L, { place: P, urls: P.imageUrls.slice(), idx: P.imageUrls.indexOf(FOTO(foto)),
    newIdx: P.imageUrls.indexOf(FOTO(P.updateRequestID)), aberto: true, eDenuncia: false });
  const irPara = (foto) => { L.idx = L.urls.indexOf(FOTO(foto)); assert.ok(L.idx >= 0, `a foto ${foto} não está na camada`); };
  const vencerJanela = () => timers.at(-1)();
  const responder = (tipo, id, r) => {
    const i = idas.find((x) => x.tipo === tipo && x.id === id && !x.respondida);
    assert.ok(i, `não há ${tipo} de ${id} no ar pra responder`);
    i.respondida = true; i.responder(r);
  };
  const responderAquecimento = () => {
    const ok = aquecimentos.shift();
    assert.ok(ok, 'não há aquecimento no ar pra responder');
    ok({ success: true, preparado: true });
  };
  return { app, L, A, B, C, AppState, log, decididos, pend, abrirEm, irPara, vencerJanela, responder, responderAquecimento,
    saidas: () => idas.map((i) => i.tipo + ':' + i.id), aquecidas: () => log.filter((l) => l.startsWith('preparar:')) };
}

test('R11-3-01 com o Desfazer, a APROVAÇÃO de uma foto do local só sai depois da resposta da EXCLUSÃO dele no ar — e a exclusão seguinte espera a aprovação', async () => {
  const m = fotosNoMesmoLocal();
  m.abrirEm(m.A, 'f1');
  m.app.pedirExclusaoDaFoto(); m.vencerJanela();          // X (f1) sai e fica no ar
  assert.deepEqual(m.saidas(), ['excluir:f1'], 'PRÉ-CONDIÇÃO: a exclusão de X não saiu');
  m.irPara('ur-A');
  assert.equal(m.L.podeAprovarAtual(), true, 'PRÉ-CONDIÇÃO: a proposta P não está aprovável na camada');
  m.app.aprovarFotoAtual(); m.vencerJanela();             // a janela da aprovação vence
  await umTique(); await umTique();
  assert.deepEqual(m.saidas(), ['excluir:f1'],
    'DEFEITO: a aprovação saiu com a exclusão do MESMO local no ar — a resposta dela regrava a lista de antes, e P volta a pendente no Waze');
  m.responder('excluir', 'f1', { success: true, restantes: ['ur-A', 'f2'] });
  await umTique(); await umTique();
  assert.deepEqual(m.saidas(), ['excluir:f1', 'aprovar:ur-A'], 'a aprovação não saiu depois da resposta da exclusão');
  // A exclusão que vem DEPOIS, com a aprovação do local no ar (pela camada do
  // IRMÃO, que segue com a f2), espera ela — e não aquece a lista, que, lida
  // antes de a aprovação pousar, veria P pendente.
  m.abrirEm(m.B, 'f2');
  m.app.pedirExclusaoDaFoto(); m.vencerJanela();
  await umTique(); await umTique();
  assert.deepEqual(m.saidas(), ['excluir:f1', 'aprovar:ur-A'], 'DEFEITO: a exclusão saiu com a aprovação do MESMO local no ar');
  assert.deepEqual(m.aquecidas(), ['preparar:v1'], 'a lixeira aqueceu a lista do local com a aprovação dele no ar');
  m.responder('aprovar', 'ur-A', { success: true });
  await umTique(); await umTique();
  assert.deepEqual(m.saidas(), ['excluir:f1', 'aprovar:ur-A', 'excluir:f2'], 'a exclusão não saiu depois da resposta da aprovação');
  m.responder('excluir', 'f2', { success: true, restantes: ['ur-A'] });
  await umTique(); await umTique();
  // CONTROLE: a aprovação de OUTRO local não espera a vez deste.
  const c = fotosNoMesmoLocal();
  c.abrirEm(c.A, 'f1'); c.app.pedirExclusaoDaFoto(); c.vencerJanela();
  c.AppState.currentPlace = c.C;
  c.abrirEm(c.C, 'ur-C');
  c.app.aprovarFotoAtual(); c.vencerJanela();
  await umTique();
  assert.deepEqual(c.saidas(), ['excluir:f1', 'aprovar:ur-C'], 'CONTROLE: a aprovação de OUTRO local esperou a vez deste');
});

test('R11-3-01 × R11-3-02: a OUTRA aba decide o pedido enquanto a aprovação espera a vez do local — ela não sai, volta e diz por quê', async () => {
  for (const decide of [true, false]) {
    const m = fotosNoMesmoLocal();
    m.abrirEm(m.A, 'f1');
    m.app.pedirExclusaoDaFoto(); m.vencerJanela();
    m.irPara('ur-A');
    m.app.aprovarFotoAtual(); m.vencerJanela();           // a janela venceu: a aprovação espera a vez
    assert.ok(m.A.approvedImageIds.includes('ur-A'), 'PRÉ-CONDIÇÃO: o gesto não marcou a foto como aprovada');
    if (decide) m.decididos.add(m.A);                     // a outra aba decide (o `storage` da fila de saída)
    m.responder('excluir', 'f1', { success: true, restantes: ['ur-A', 'f2'] });
    await umTique(); await umTique();
    if (decide) {
      assert.deepEqual(m.saidas(), ['excluir:f1'], 'DEFEITO: a aprovação saiu depois de a outra aba decidir o pedido (vale a primeira)');
      assert.ok(m.log.includes('toast:info:toast.decididoNaOutraAba'), `a aprovação descartada não disse por quê: ${m.log}`);
      assert.ok(!m.A.approvedImageIds.includes('ur-A'), 'a foto seguiu "aprovada" na tela com a aprovação descartada');
    } else {
      assert.deepEqual(m.saidas(), ['excluir:f1', 'aprovar:ur-A'], 'CONTROLE: sem a outra aba, a aprovação não saiu depois da vez');
    }
  }
});

// ── R11-3-02: a aprovação na JANELA do Desfazer × a outra aba ─────────────────
// A guarda do R10-2-02 só valia no TOQUE: a outra aba decidia o pedido nos 3 s da
// janela e a aprovação saía no fim dela — o Waze recebia as duas decisões, e a
// tela dizia "Já tratado por outro editor 👍" sobre a decisão da própria pessoa
// (MEDIDO nos dois motores). Todo fim da janela passa pelo `enviar`: o relógio, e
// o despacho (fechar a foto, a lixeira, o ↻, os Filtros, o treino, a página
// saindo).
test('R11-3-02 a OUTRA aba decide o pedido DURANTE a janela da aprovação: no fim dela a aprovação não sai — volta como no Desfazer, e diz por quê', async () => {
  for (const fim of ['o relógio', 'o despacho']) {
    const decididos = new WeakSet();
    let desfeitos = 0;
    const m = montarEscritas({ resposta: { success: true }, preferencias: { undoEnabled: true },
      extra: { decididosPorOutraAbaComCardAqui: decididos, registrarDesfazer: () => { desfeitos++; } } });
    m.app.aprovarFotoAtual();
    assert.ok(m.pend.a && m.A.approvedImageIds.includes('ur-A') && m.L.newIdx === -1,
      `${fim}: PRÉ-CONDIÇÃO — a janela da aprovação não abriu (ou o gesto não marcou a foto)`);
    decididos.add(m.A);                                   // a outra aba decide, com a janela correndo
    if (fim === 'o relógio') m.timers.at(-1)(); else m.pend.a.enviar();
    await umTique();
    assert.ok(!m.log.some((l) => l.startsWith('api:')), `DEFEITO (${fim}): a aprovação da janela saiu depois de a outra aba decidir: ${m.log}`);
    assert.ok(m.log.includes('toast:info:toast.decididoNaOutraAba'), `${fim}: a aprovação descartada não disse por quê: ${m.log}`);
    assert.ok(!m.A.approvedImageIds.includes('ur-A') && m.L.newIdx === 1, `${fim}: a foto não voltou a ser a proposta (o ✨)`);
    assert.equal(m.pend.a, null, `${fim}: a janela ficou aberta`);
    assert.equal(desfeitos, 0, `${fim}: o descarte do app contou como Desfazer do editor`);
  }
  // CONTROLE: sem a outra aba, a janela vence e a aprovação sai.
  const c = montarEscritas({ resposta: { success: true }, preferencias: { undoEnabled: true },
    extra: { decididosPorOutraAbaComCardAqui: new WeakSet() } });
  c.app.aprovarFotoAtual();
  c.timers.at(-1)();
  await umTique();
  assert.ok(c.log.includes('api:aprovar:row'), `CONTROLE: sem a outra aba a aprovação da janela não saiu: ${c.log}`);
});

// ── R11-3-04: o zoom é da FOTO na tela ───────────────────────────────────────
// O `_render` zerava o zoom sempre, e o redesenho que não troca a foto — a
// RESPOSTA da aprovação, que o R10-3-04 passou a marcar de novo; o ✨ que volta
// na falha; a exclusão de OUTRA foto que pousa (essa já existia) — tirava o zoom
// de quem conferia a fachada (MEDIDO nos dois motores). A camada com os métodos
// de VERDADE (o `open`, o `_render`, o zoom, as escritas) e a tela de mentira.
function camadaComZoom() {
  const ref = { L: null };
  const el = () => ({ classList: { c: new Set(), toggle(k, v) { if (v) this.c.add(k); else this.c.delete(k); },
    add(k) { this.c.add(k); }, remove(k) { this.c.delete(k); }, contains(k) { return this.c.has(k); } },
  setAttribute() {}, removeAttribute() {}, appendChild() {}, focus() {}, textContent: '', title: '', innerHTML: '', dataset: {} });
  const img = { ...el(), style: {}, src: '', alt: '', offsetWidth: 800, offsetHeight: 600,
    getBoundingClientRect: () => { const L = ref.L; return { left: 400 + L.tx - 400 * L.scale, top: 300 + L.ty - 300 * L.scale,
      width: 800 * L.scale, height: 600 * L.scale }; } };
  const els = { lightboxImage: img, imageLightbox: el() };
  els.imageLightbox.classList.add('hidden');
  const doc = { getElementById: (id) => els[id] || (els[id] = el()), createElement: () => el(), body: { style: {} }, activeElement: null };
  // O `open`, o `close` e o `isOpen` de VERDADE: abrir de novo começa do 1×
  // porque o fechar zera o zoom (a camada fechada não redesenha).
  const nomes = ['isOpen', 'open', 'close', '_render', 'resetZoom', '_applyTransform', 'zoomTo', 'ampliada', 'next', 'prev',
    'removerFoto', 'marcarComoAprovada', 'desmarcarAprovada', 'esquecerProposta', 'recolocarFoto', 'indiceDaFoto',
    'idAprovadoDaFoto', '_anunciarFoto', 'dataDaFotoAtual', 'autorDaFotoAtual'];
  const L = new Function('document', 'CamadaVoltar', 'mostrarNomeNoLightbox', 't', 'anunciarNoLightbox', 'setTimeout',
    'clearTimeout', 'ZOOM_VISIVEL_PX', 'urlDaFoto', 'altDaFoto', 'idadeDaFoto', 'i18nLocale', 'atualizarAcoesDeFoto',
    'manterFocoNoLightbox', 'fecharEdicaoNome', 'avancarSeAprovado', 'topOpenModal', 'devolverFocoDaAmpliacao', 'aoFecharCamada', `return {
    place: null, urls: [], idx: 0, newIdx: -1, eDenuncia: false, scale: 1, tx: 0, ty: 0, _fotoComZoom: null,
    _renderTira() {},
    ${nomes.map(metodo).join(',\n')}
  };`)(doc, { empilhar() {}, consumir() {} }, () => {}, (k) => k, () => {}, () => 0, () => {}, 8, (u) => u, () => '', () => '',
    () => 'pt-BR', () => {}, () => {}, () => {}, () => {}, () => null, () => {}, () => {});
  ref.L = L;
  L.img = img;
  L.abrir = (P, foto) => { L.open(P.imageUrls, P.imageUrls.indexOf(FOTO(foto)), P.imageUrls.indexOf(FOTO(P.updateRequestID)), P.name, false, P); };
  // Ampliada e deslocada, como quem confere a fachada: o + duas vezes e as setas.
  L.ampliar = () => { L.zoomTo(1.44, 400, 300); L.tx += 80; L.ty += 40; L._applyTransform(); };
  L.zoom = () => ({ scale: L.scale, tx: L.tx, ty: L.ty, transform: img.style.transform });
  return L;
}
const pedidoComTresFotos = () => ({ venueID: 'vZ', updateRequestID: 'uZ', purType: 'NEW_PHOTO', name: 'Padaria', lat: -23, lon: -46,
  approvedImageIds: ['a1', 'a2'], imageUrls: [FOTO('a1'), FOTO('uZ'), FOTO('a2')] });

test('R11-3-04 a MESMA foto redesenhada segue ampliada — a resposta da aprovação, o ✨ que volta, a exclusão de OUTRA foto', () => {
  const casos = [
    // [nome, a foto na tela, o que acontece com ela ampliada]
    ['a RESPOSTA da aprovação com o Desfazer (o gesto já a marcou)', 'uZ', (L, P, alvo) => { L.marcarComoAprovada(alvo); }, (L, P, alvo) => L.marcarComoAprovada(alvo)],
    ['a resposta da aprovação, com OUTRA foto do pedido na tela', 'a2', (L, P, alvo) => { L.marcarComoAprovada(alvo); }, (L, P, alvo) => L.marcarComoAprovada(alvo)],
    ['a aprovação SEM o Desfazer (a foto vira aprovada na resposta)', 'uZ', () => {}, (L, P, alvo) => L.marcarComoAprovada(alvo)],
    ['a aprovação que falha (o ✨ volta)', 'uZ', (L, P, alvo) => { L.marcarComoAprovada(alvo); }, (L, P, alvo) => L.desmarcarAprovada(alvo)],
    ['o "já tratado" por outro editor (a proposta sai)', 'uZ', () => {}, (L, P, alvo) => L.esquecerProposta(alvo)],
    ['a exclusão de OUTRA foto do pedido que pousa (antes da que está na tela)', 'a2', () => {}, (L, P) => L.removerFoto('a1', P)],
  ];
  for (const [nome, foto, antes, durante] of casos) {
    const L = camadaComZoom();
    const P = pedidoComTresFotos();
    const alvo = { id: 'uZ', place: P, idx: 1 };
    L.abrir(P, foto);
    antes(L, P, alvo);
    L.ampliar();
    const z = L.zoom();
    assert.ok(z.scale > 1 && z.tx !== 0 && z.transform, `${nome}: PRÉ-CONDIÇÃO — a foto não ficou ampliada`);
    durante(L, P, alvo);
    assert.ok(L.urls[L.idx].includes(foto), `${nome}: PRÉ-CONDIÇÃO — a foto na tela mudou`);
    assert.deepEqual(L.zoom(), z, `DEFEITO (${nome}): a mesma foto voltou a 1× sozinha`);
  }
});

test('R11-3-04 CONTROLES: trocar de foto (‹ ›, a que sai da tela, a que volta pelo Desfazer) e abrir de novo recomeçam em 1×', () => {
  const casos = [
    ['a seta (outra foto)', 'a2', (L) => L.next()],
    ['a exclusão da foto NA TELA pousando (a seguinte toma o lugar)', 'a2', (L, P) => L.removerFoto('a2', P)],
    ['a foto que volta pelo Desfazer (ela vira a da tela)', 'a2', (L) => L.recolocarFoto(FOTO('a9'), 0)],
    ['abrir de novo na MESMA foto', 'a2', (L, P) => { L.close(); L.abrir(P, 'a2'); }],
  ];
  for (const [nome, foto, acao] of casos) {
    const L = camadaComZoom();
    const P = pedidoComTresFotos();
    L.abrir(P, foto);
    L.ampliar();
    assert.ok(L.zoom().scale > 1, `${nome}: PRÉ-CONDIÇÃO — a foto não ficou ampliada`);
    acao(L, P);
    assert.deepEqual(L.zoom(), { scale: 1, tx: 0, ty: 0, transform: '' }, `${nome}: a foto nova (ou a camada reaberta) herdou o zoom`);
  }
});

// ── R11-3-05: com o Desfazer, o desfecho que pousa no IRMÃO é dito ────────────
// O banner disse "Foto excluída" (ou "Renomeado para…") no gesto, sobre A. Quando
// o Waze confirma, de 3 s em diante, a camada ou o card do irmão B mudam
// (`aplicarNosIrmaos`) — e nada era dito; sem o Desfazer, o mesmo pouso é dito
// (MEDIDO nos dois motores). O mesmo anúncio, só pelo irmão.
test('R11-3-05 `anunciarDesfechoDaFoto` só pelos IRMÃOS: a camada ou o card de B falam; os do próprio A, não de novo', () => {
  const A = { venueID: 'v1', updateRequestID: 'ur-A' };
  const B = { venueID: 'v1', updateRequestID: 'ur-B' };
  const C = { venueID: 'v2', updateRequestID: 'ur-C' };
  const casos = [
    // [nome, camada aberta, card na frente, fila, região que fala (ou nenhuma)]
    ['a camada do irmão B', B, B, [B, C], 'lightboxAnuncio'],
    ['o card do irmão B na frente, sem camada', null, B, [B, C], 'cardLiveRegion'],
    ['a camada do PRÓPRIO A', A, A, [A, B, C], null],
    ['o card do PRÓPRIO A na frente', null, A, [A, B, C], null],
    ['a camada de OUTRO local', C, B, [B, C], null],
  ];
  for (const [nome, aberta, frente, fila, fala] of casos) {
    const m = desfechoComCamada({ aberta, frente, fila });
    m.h.anunciarDesfechoDaFoto('undo.photoDeleted', A, true);
    const disse = Object.entries(m.regioes).filter(([, r]) => r.textContent).map(([k]) => k);
    assert.deepEqual(disse, fala ? [fala] : [], `${nome}: ${fala ? 'o irmão mudou e nada foi dito' : 'falou de novo do que o banner já disse (ou do que a escrita não mudou)'}`);
  }
  // CONTROLE: sem o "só dos irmãos" (o caminho sem o Desfazer), a camada do próprio A fala (R6-3-08).
  const p = desfechoComCamada({ aberta: A, frente: A, fila: [A, B] });
  p.h.anunciarDesfechoDaFoto('undo.photoDeleted', A);
  assert.equal(p.regioes.lightboxAnuncio.textContent, 'undo.photoDeleted', 'CONTROLE: o caminho sem o Desfazer deixou de dizer o desfecho');
});

// De ponta a ponta, a exclusão: o `pedirExclusaoDaFoto` COM o Desfazer, o
// `enviarExclusao`, o `aplicarNosIrmaos`, o `removerFoto` e o anúncio de verdade.
test('R11-3-05 com o Desfazer, a exclusão de A pousa com a camada (ou o card) do IRMÃO B na tela: a foto sai dele e isso é DITO', async () => {
  for (const onde of ['camada de B', 'card de B', 'camada do próprio A']) {
    const regioes = { lightboxAnuncio: { textContent: '' }, cardLiveRegion: { textContent: '' } };
    const doc = { getElementById: (id) => regioes[id] || null };
    let soltar;
    const ida = new Promise((ok) => { soltar = ok; });
    const porTras = {};
    const m = montarEscritas({ resposta: null, preferencias: { undoEnabled: true }, extra: {
      document: doc, API: { excluirFoto: () => ida, getRegion: () => 'row', prepararExclusao: () => {} },
      aplicarNosIrmaos: (...a) => porTras.irmaos(...a),
      anunciarNoLightbox: (...a) => porTras.lb(...a), anunciarNoCard: (...a) => porTras.card(...a),
      semCamadaAberta: () => !porTras.L.isOpen(), registrarDesfazer: () => {},
    } });
    porTras.L = m.L;
    porTras.irmaos = new Function('AppState', 'filaRealComDevolvidos', 'montarCardDeFundo',
      fatiar('aplicarNosIrmaos') + '\nreturn aplicarNosIrmaos;')(m.AppState, () => m.AppState.queue, () => {});
    porTras.lb = new Function('document', 'Lightbox', fatiar('anunciarNoLightbox') + '\nreturn anunciarNoLightbox;')(doc, m.L);
    porTras.card = new Function('document', fatiar('anunciarNoCard') + '\nreturn anunciarNoCard;')(doc);
    const fotos = (ur) => [FOTO('f1'), FOTO(ur), FOTO('f2')];
    Object.assign(m.A, { approvedImageIds: ['f1', 'f2'], imageUrls: fotos('ur-A'), lat: -23, lon: -46 });
    const B = { venueID: m.A.venueID, updateRequestID: 'ur-B', purType: 'NEW_PHOTO', approvedImageIds: ['f1', 'f2'], imageUrls: fotos('ur-B') };
    m.AppState.queue = [m.A, B];
    Object.assign(m.L, { place: m.A, urls: m.A.imageUrls.slice(), idx: 0, newIdx: 1, aberto: true });
    m.L.idFotoAtual = () => m.L.idAprovadoDaFoto(m.L.urls[m.L.idx]);
    m.app.pedirExclusaoDaFoto();                    // a f1 de A, com a janela do Desfazer
    m.timers.at(-1)();                              // a janela vence: a exclusão sai e fica no ar
    if (onde !== 'camada do próprio A') {
      // A decidido (o ✕), B na frente — com a foto ampliada aberta, ou fechada.
      m.AppState.queue = [B]; m.AppState.currentPlace = B;
      if (onde === 'camada de B') Object.assign(m.L, { place: B, urls: B.imageUrls.slice(), idx: 0, newIdx: 1, aberto: true });
      else m.L.aberto = false;
    }
    regioes.lightboxAnuncio.textContent = ''; regioes.cardLiveRegion.textContent = '';
    soltar({ success: true, restantes: ['ur-A', 'f2'] });
    await umTique(); await umTique();
    if (onde === 'camada do próprio A') {
      assert.deepEqual([regioes.lightboxAnuncio.textContent, regioes.cardLiveRegion.textContent], ['', ''],
        'CONTROLE: a camada do próprio A (que o banner já disse, e que o pouso não muda) falou de novo');
      continue;
    }
    assert.ok(!B.imageUrls.includes(FOTO('f1')), `(${onde}) PRÉ-CONDIÇÃO: a exclusão de A não tirou a foto do irmão`);
    const regiao = onde === 'camada de B' ? 'lightboxAnuncio' : 'cardLiveRegion';
    assert.equal(regioes[regiao].textContent, 'undo.photoDeleted',
      `DEFEITO (${onde}): a foto saiu do irmão quando a exclusão pousou e nada foi dito ao leitor de tela`);
  }
});

// O nome: o envio da janela do `confirmarRenomear` diz o desfecho pelo irmão
// quando o Waze GRAVA — e não diz quando não grava.
test('R11-3-05 com o Desfazer, o nome que o Waze grava é dito pelo IRMÃO (o `anunciarDesfechoDaFoto` só dos irmãos); o que não grava, não', async () => {
  for (const gravou of [true, false]) {
    const ditos = [];
    const timers = [];
    const P = { venueID: 'v1', updateRequestID: 'ur-A', name: 'Padaria Velha' };
    const deps = {
      Treino: { ativo: false }, AppState: { authenticated: true, preferences: { undoEnabled: true } },
      editandoNome: () => true, showToast: () => {}, t: (k, v) => (v ? `${k}${JSON.stringify(v)}` : k), avisoDaTrava: () => 'x',
      podeRenomearAqui: () => true, document: { getElementById: (id) => (id === 'lightboxNomeInput' ? { value: 'Padaria Nova' } : null) },
      Lightbox: { place: P }, sairDaEdicaoNome: () => {}, acoesTravadas: () => false, renomeacaoNoAr: () => false,
      fecharEdicaoNome: () => {}, aplicarNomeNaTela: (p, n) => { p.name = n; }, API: { getRegion: () => 'row' },
      canDisableUndo: () => true, enviarRenomeacao: () => Promise.resolve(gravou), manterFocoNoLightbox: () => {},
      setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, UNDO_WINDOW_MS: 3000,
      aplicarTravaDeAcao: () => {}, removeUndoBanner: () => {}, mostrarDesfazer: () => {}, registrarDesfazer: () => {},
      anunciarDesfechoDaFoto: (...a) => ditos.push(a),
    };
    const corpo = fatiar('confirmarRenomear').replace(/renomeacaoPendente/g, '__pend.r');
    const confirmar = new Function(...Object.keys(deps), '__pend', corpo + '\nreturn confirmarRenomear;')(...Object.values(deps), { r: null });
    confirmar();
    assert.equal(timers.length, 1, 'PRÉ-CONDIÇÃO: a janela do nome não abriu');
    timers[0]();                                    // a janela vence: o nome sai
    await umTique();
    if (gravou) {
      assert.deepEqual(ditos, [['lightbox.anuncio.renomeado{"nome":"Padaria Nova"}', P, true]],
        'DEFEITO: o nome que o Waze gravou (e que vai aos irmãos) não foi dito pelo irmão');
    } else {
      assert.deepEqual(ditos, [], 'CONTROLE: o nome que NÃO foi gravado foi anunciado');
    }
  }
});

// ── R11-3-06: a pílula do nome trava com uma exclusão do local no ar ──────────
// A exclusão que tira a ÚLTIMA foto da camada a FECHA quando pousa
// (`removerFoto` → `close`), e a correção do nome aberta ia junto: o nome
// digitado sumia, sem aviso (MEDIDO nos dois motores, no próprio pedido sem o
// Desfazer e no IRMÃO com ele). Como com o nome no ar (L23): por LOCAL.
test('R11-3-06 `exclusaoDoLocalNoAr`: verdadeira do envio à resposta da exclusão, pro pedido e pro IRMÃO — não pra outro local, nem com só uma aprovação no ar', async () => {
  const m = fotosNoMesmoLocal();
  m.abrirEm(m.A, 'f1');
  m.app.pedirExclusaoDaFoto();                     // na janela do Desfazer: a trava da janela já vale, a exclusão ainda não saiu
  assert.equal(m.app.exclusaoDoLocalNoAr(m.A), false, 'PRÉ-CONDIÇÃO: na janela a exclusão ainda não saiu');
  m.vencerJanela();                                 // sai e fica no ar
  assert.equal(m.app.exclusaoDoLocalNoAr(m.A), true, 'DEFEITO: com a exclusão no ar, a pílula do local ficava viva');
  assert.equal(m.app.exclusaoDoLocalNoAr(m.B), true, 'DEFEITO: o IRMÃO (o mesmo local) ficou livre pra corrigir o nome com a exclusão no ar');
  assert.equal(m.app.exclusaoDoLocalNoAr(m.C), false, 'CONTROLE: travou a pílula de OUTRO local');
  assert.ok(m.log.includes('pilula:true'), `a trava não foi reaplicada quando a exclusão entrou no ar: ${m.log}`);
  m.responder('excluir', 'f1', { success: true, restantes: ['ur-A', 'f2'] });
  await umTique(); await umTique();
  assert.equal(m.app.exclusaoDoLocalNoAr(m.A), false, 'a resposta chegou e a pílula seguiu travada');
  assert.equal(m.log.filter((l) => l.startsWith('pilula:')).at(-1), 'pilula:false', 'o fim da exclusão não reaplicou a trava');
  // CONTROLE: só uma APROVAÇÃO do local no ar não trava a pílula — ela não tira foto.
  const c = fotosNoMesmoLocal();
  c.abrirEm(c.A, 'ur-A');
  c.app.aprovarFotoAtual(); c.vencerJanela();
  assert.deepEqual(c.saidas(), ['aprovar:ur-A'], 'CONTROLE: a aprovação não saiu');
  assert.equal(c.app.exclusaoDoLocalNoAr(c.A), false, 'CONTROLE: a aprovação no ar travou a pílula (ela não fecha a camada)');
});

// A pílula de VERDADE: o `mostrarNomeNoLightbox` (que a abertura da camada chama),
// a trava (`aplicarTravaDeAcao`, o escritor único do `disabled`), o portão e o
// "no ar" do local, com a tela de mentira. É o s9b do auditor: a camada do IRMÃO
// aberta com a exclusão do local no ar nascia com a pílula viva — e o nome no ar
// (L23) também (achado de passagem do mesmo conserto: a trava, que é do LOCAL, não
// era recalculada na abertura).
function pilulaDeVerdade({ exclusaoNoAr = false, nomeNoAr = false } = {}) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, disabled: false, textContent: '', querySelector: () => null,
    classList: { c: new Set(), toggle(k, v) { if (v) this.c.add(k); else this.c.delete(k); }, add(k) { this.c.add(k); },
      remove(k) { this.c.delete(k); }, contains(k) { return this.c.has(k); } } });
  ['lightboxNome', 'lightboxNomeBtn', 'lightboxNomeTxt', 'lightboxZoomHint', 'lightboxApprove', 'lightboxDelete', 'lightboxNomeEdit',
    'lightboxNomeInput', 'imageLightbox'].forEach(el);
  const B = { venueID: 'v1', updateRequestID: 'ur-B', name: 'Padaria', localAprovado: true };
  const escritas = new Map();
  if (exclusaoNoAr) escritas.set('v1', { ultima: null, saiu: new Set(), n: 1, exclusoes: 1 });
  const deps = {
    document: { getElementById: (id) => els[id] || null }, AppState: { profile: { id: 1, rank: 5, isAreaManager: true, isStaff: false } },
    Treino: { ativo: false }, Lightbox: { place: B, isOpen: () => true }, editandoNome: () => false, fecharEdicaoNome: () => {},
    acoesTravadas: () => false, cardDaFrente: () => null, guardarFocoDaTrava: () => {}, aprovandoAgora: false, excluindoAgora: false,
    renomeacoesNoAr: new Set(nomeNoAr ? ['v1'] : []), escritasDeFotoNoLocal: escritas, atualizarBotaoSalvarNome: () => {},
    manterFocoNoLightbox: () => {}, dispensarAvisoDaTrava: () => {}, pedirComoFuncionaAdiado: () => {}, aplicarFocoDoTeclado: () => {},
    atualizarAcoesDeFoto: () => {},
  };
  const nomes = ['mostrarNomeNoLightbox', 'aplicarTravaDeAcao', 'exclusaoDoLocalNoAr', 'renomeacaoNoAr', 'podeRenomearAqui',
    'podeAgirComoL6Aqui', 'abrirEdicaoNome'];
  const app = new Function(...Object.keys(deps), nomes.map(fatiar).join('\n') + `\nreturn { ${nomes.join(', ')} };`)(...Object.values(deps));
  return { app, els };
}

test('R11-3-06 a camada que abre no IRMÃO com uma exclusão (ou o nome) do local no ar nasce com a pílula TRAVADA — e a edição não abre', () => {
  for (const [nome, opcoes] of [['a exclusão no ar', { exclusaoNoAr: true }], ['o nome no ar (L23)', { nomeNoAr: true }]]) {
    const m = pilulaDeVerdade(opcoes);
    m.app.mostrarNomeNoLightbox();                 // o que o `open` da camada de B faz
    assert.equal(m.els.lightboxNome.classList.contains('hidden'), false, `${nome}: PRÉ-CONDIÇÃO — a pílula não apareceu (o portão)`);
    assert.equal(m.els.lightboxNomeBtn.disabled, true, `DEFEITO (${nome}): a pílula do irmão nasceu viva com a escrita do local no ar`);
    m.app.abrirEdicaoNome();                       // o teclado ou um script, por cima da trava
    assert.equal(m.els.lightboxNome.classList.contains('editando'), false, `DEFEITO (${nome}): a correção do nome abriu com a escrita do local no ar`);
  }
  // CONTROLE: sem nada no ar, a pílula nasce viva e a edição abre.
  const c = pilulaDeVerdade();
  c.app.mostrarNomeNoLightbox();
  assert.equal(c.els.lightboxNomeBtn.disabled, false, 'CONTROLE: sem escrita no ar, a pílula nasceu travada');
  c.els.lightboxNomeInput.focus = () => {}; c.els.lightboxNomeInput.setSelectionRange = () => {};
  c.app.abrirEdicaoNome();
  assert.equal(c.els.lightboxNome.classList.contains('editando'), true, 'CONTROLE: sem escrita no ar, a edição não abriu');
});

// ── R12-3-01: o AQUECIMENTO da lixeira entra na vez do local ──────────────────
// (auditoria da rodada 12). O toque na lixeira dispara a leitura do local no
// servidor (`preparar`), "dispara e esquece", fora da vez das escritas de foto do
// local (R10-3-03, R11-3-01). Com o Waze lento, ela voltava DEPOIS de a exclusão
// (ou a aprovação) do local sair e guardava no servidor a lista de ANTES, por
// cima: a exclusão seguinte do local mandava a foto de volta, e a foto
// recém-aprovada como pendente (MEDIDO de ponta a ponta, e3-preparar-tardio). O
// lado do servidor está em test/portao-servidor; aqui, o do cliente: o
// `pedirExclusaoDaFoto`, o `aprovarFotoAtual`, os envios e a vez de verdade, com
// o aquecimento no ar até o teste responder.
test('R12-3-01 com o Desfazer, o AQUECIMENTO da lixeira entra na vez do local: a exclusão — e a aprovação — do local só sai depois da resposta dele', async () => {
  const m = fotosNoMesmoLocal({ aquecimentoNoAr: true });
  m.abrirEm(m.A, 'f1');
  m.app.pedirExclusaoDaFoto();                       // o toque: a foto sai da tela, a leitura do local sai
  assert.deepEqual(m.aquecidas(), ['preparar:v1'], 'PRÉ-CONDIÇÃO: o toque não aqueceu a lista do local');
  m.vencerJanela();                                  // a janela vence com o aquecimento no ar (o Waze lento)
  await umTique(); await umTique();
  assert.deepEqual(m.saidas(), [],
    'DEFEITO: a exclusão saiu com o aquecimento do local no ar — ele volta depois e guarda no servidor a lista de antes, por cima');
  m.responderAquecimento();
  await umTique(); await umTique();
  assert.deepEqual(m.saidas(), ['excluir:f1'], 'a exclusão não saiu depois da resposta do aquecimento');
  // A APROVAÇÃO de uma foto do local também espera: tocou na lixeira, desfez (a
  // exclusão não sai, o aquecimento segue no ar) e aprovou a proposta P.
  const a = fotosNoMesmoLocal({ aquecimentoNoAr: true });
  a.abrirEm(a.A, 'f1');
  a.app.pedirExclusaoDaFoto();
  a.pend.e.desfazer();
  a.irPara('ur-A');
  assert.equal(a.L.podeAprovarAtual(), true, 'PRÉ-CONDIÇÃO: a proposta P não está aprovável na camada');
  a.app.aprovarFotoAtual(); a.vencerJanela();
  await umTique(); await umTique();
  assert.deepEqual(a.saidas(), [],
    'DEFEITO: a aprovação saiu com o aquecimento do local no ar — ele volta depois e guarda a foto aprovada como pendente');
  a.responderAquecimento();
  await umTique(); await umTique();
  assert.deepEqual(a.saidas(), ['aprovar:ur-A'], 'a aprovação não saiu depois da resposta do aquecimento');
  // CONTROLE: o aquecimento que responde DENTRO da janela (o de todo dia, ~0,7 s
  // contra 3 s) não segura nada: a exclusão sai na hora em que a janela vence.
  const c = fotosNoMesmoLocal({ aquecimentoNoAr: true });
  c.abrirEm(c.A, 'f1');
  c.app.pedirExclusaoDaFoto();
  c.responderAquecimento();
  await umTique();
  c.vencerJanela();
  assert.deepEqual(c.saidas(), ['excluir:f1'], 'CONTROLE: com o aquecimento já respondido, a exclusão esperou mesmo assim');
  // CONTROLE: o aquecimento que nem saiu (sem sessão, a API não devolve nada)
  // não segura a exclusão.
  const s = fotosNoMesmoLocal();
  s.abrirEm(s.A, 'f1');
  s.app.pedirExclusaoDaFoto(); s.vencerJanela();
  assert.deepEqual(s.saidas(), ['excluir:f1'], 'CONTROLE: o aquecimento que não saiu segurou a exclusão');
});

test('R12-3-01 a API devolve a PROMESSA do aquecimento (que só termina com a resposta), e nada sem sessão', async () => {
  const { default: vm } = await import('node:vm');
  const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  const API_JS = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
  const guardado = { waze_session_token: 'tok', waze_region: 'row', waze_lang: 'pt' };
  let responder = null;
  const ctx = {
    navigator: { language: 'pt-BR', onLine: true }, document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: (k) => (k in guardado ? guardado[k] : null), setItem: (k, v) => { guardado[k] = v; }, removeItem: (k) => { delete guardado[k]; } },
    fetch: () => new Promise((ok) => { responder = () => ok({ status: 200, headers: { get: () => null }, text: async () => '{"success":true,"preparado":true}' }); }),
    performance: { now: () => 0 }, console, setTimeout, clearTimeout, AbortController,
  };
  vm.createContext(ctx);
  vm.runInContext(I18N + '\n' + API_JS + '\nthis.API = API;', ctx);
  const p = ctx.API.prepararExclusao('v', -23, -46, 'row');
  assert.ok(p && typeof p.then === 'function', 'DEFEITO: o aquecimento não devolve a promessa — a vez do local não tem pelo que esperar');
  let terminou = false;
  p.then(() => { terminou = true; });
  await umTique();
  assert.equal(terminou, false, 'a promessa terminou antes da resposta do servidor');
  responder();
  await umTique(); await umTique();
  assert.equal(terminou, true, 'a promessa não terminou com a resposta');
  // Sem sessão não sai pedido, e não há o que esperar.
  delete guardado.waze_session_token;
  ctx.API.setSession && ctx.API.setSession(null);
  assert.equal(ctx.API.prepararExclusao('v', -23, -46, 'row'), undefined, 'sem sessão o aquecimento devolveu algo pra esperar');
});

// ── R12-3-02: a MESMA foto excluída pela camada de A e pela do IRMÃO B ─────────
// (auditoria da rodada 12). O R10-3-03 ("a segunda não vai ao Waze") só cobria a
// exclusão de B que JÁ tinha entrado na vez do local: o `saiu` morava na vez, que
// é apagada quando esvazia. A de A que POUSAVA com a de B ainda na janela do
// Desfazer levava a memória junto: a de B saía depois (um 2º pedido ao Waze, e
// "Outro editor já tinha excluído 👍" sobre a exclusão da própria pessoa), e o
// Desfazer de B nesse meio devolvia X à camada e ao pedido de B como aprovada,
// com a foto já fora do mapa (MEDIDO, s12 e s12b, com os controles). A memória
// passou pra página, por local e sessão (`fotosQueSairamDoMapa`).
test('R12-3-02 a MESMA foto pela camada do IRMÃO, com a 1ª POUSANDO na janela do Desfazer dele: não vai ao Waze, nem diz "Outro editor"', async () => {
  for (const pousa of [true, false]) {
    const m = exclusoesNoMesmoLocal();
    m.abrirEm(m.A, 'f1'); m.app.pedirExclusaoDaFoto(); m.vencerJanela();   // a 1ª (pela camada de A), no ar
    m.AppState.queue = [m.B, m.C]; m.AppState.currentPlace = m.B;           // A decidido, B (o irmão) na frente
    m.abrirEm(m.B, 'f1');                          // o irmão só perde a f1 quando a 1ª pousar
    m.app.pedirExclusaoDaFoto();                   // a 2ª: a janela do Desfazer dela corre — fora da vez
    assert.ok(m.pend.e && m.pend.e.place === m.B, 'PRÉ-CONDIÇÃO: a janela da exclusão de B não abriu');
    m.responder('f1', pousa ? { success: true, restantes: ['f2', 'f3'] } : { success: false, errorCategory: 'unknown' });
    await umTique(); await umTique(); await umTique();   // a 1ª terminou: a vez do local esvaziou
    m.vencerJanela();                              // a janela de B vence
    await umTique(); await umTique();
    if (pousa) {
      assert.deepEqual(m.saidas(), ['f1'], 'DEFEITO: a foto que a 1ª já tirou do mapa foi ao Waze de novo, pela janela do irmão');
      assert.deepEqual(avisos(m.log), [], `DEFEITO: a exclusão da própria pessoa virou "Outro editor já tinha excluído 👍" (ou outro aviso): ${m.log}`);
    } else {
      // CONTROLE: a 1ª FALHOU (a foto segue no mapa) — a de B vai.
      assert.deepEqual(m.saidas(), ['f1', 'f1'], 'CONTROLE: com a 1ª recusada, a de B (a foto segue no mapa) não saiu');
    }
  }
  // CONTROLE: a foto que saiu numa sessão ANTERIOR (a queda) não segura a
  // exclusão desta — ela vai ao Waze, e o que ele disser vale: quem diz de quem
  // foi a exclusão é a sessão. Aqui o irmão volta a mostrar a foto (um pedido
  // trazido por uma busca nova), senão não haveria o que excluir.
  const q = exclusoesNoMesmoLocal();
  q.abrirEm(q.A, 'f1'); q.app.pedirExclusaoDaFoto(); q.vencerJanela();
  q.responder('f1', { success: true, restantes: ['f2', 'f3'] });
  await umTique(); await umTique(); await umTique();
  q.app.setEpoca(1);
  q.AppState.queue = [q.B, q.C]; q.AppState.currentPlace = q.B;
  q.B.imageUrls.unshift(FOTO('f1')); q.B.approvedImageIds.push('f1');
  q.abrirEm(q.B, 'f1'); q.app.pedirExclusaoDaFoto(); q.vencerJanela();
  assert.deepEqual(q.saidas(), ['f1', 'f1'], 'CONTROLE: a foto que saiu numa sessão ANTERIOR segurou a exclusão desta');
});

test('R12-3-02 o Desfazer da exclusão do IRMÃO depois de a 1ª POUSAR não devolve a foto que já saiu do mapa — nem à camada, nem ao pedido', async () => {
  for (const pousaAntes of [true, false]) {
    const caso = pousaAntes ? 'a 1ª pousou antes do Desfazer' : 'CONTROLE: o Desfazer com a 1ª no ar';
    const m = exclusoesNoMesmoLocal({ devolverDeVerdade: true });
    m.abrirEm(m.A, 'f1'); m.app.pedirExclusaoDaFoto(); m.vencerJanela();   // a 1ª (pela camada de A), no ar
    m.AppState.queue = [m.B, m.C]; m.AppState.currentPlace = m.B;
    m.abrirEm(m.B, 'f1');
    m.app.pedirExclusaoDaFoto();                   // a 2ª (B): a janela corre
    assert.ok(!m.L.urls.includes(FOTO('f1')) && m.pend.e, `${caso}: PRÉ-CONDIÇÃO — a f1 não saiu da camada de B no gesto`);
    if (pousaAntes) {
      m.responder('f1', { success: true, restantes: ['f2', 'f3'] });
      await umTique(); await umTique(); await umTique();
    }
    m.pend.e.desfazer();                           // o Desfazer de B
    if (!pousaAntes) {
      // A foto ainda está no mapa (a 1ª não pousou): ela VOLTA — o Desfazer de sempre.
      assert.ok(m.L.urls.includes(FOTO('f1')) && m.B.approvedImageIds.includes('f1'),
        `${caso}: com a 1ª ainda no ar, o Desfazer não devolveu a foto (o conserto calou o Desfazer de todo mundo)`);
      m.responder('f1', { success: true, restantes: ['f2', 'f3'] });   // e agora ela pousa: sai do irmão
      await umTique(); await umTique(); await umTique();
    }
    assert.ok(!m.L.urls.includes(FOTO('f1')), `DEFEITO (${caso}): a foto que saiu do mapa voltou à camada do irmão: ${m.L.urls}`);
    assert.ok(!m.B.imageUrls.includes(FOTO('f1')) && !m.B.approvedImageIds.includes('f1'),
      `DEFEITO (${caso}): a foto que saiu do mapa voltou ao pedido do irmão como aprovada: ${m.B.approvedImageIds}`);
    assert.deepEqual(m.saidas(), ['f1'], `${caso}: o Desfazer mandou alguma coisa ao Waze`);
  }
  // A QUEDA da sessão depois de a 1ª pousar: ela sobe a época e SÓ ENTÃO cancela
  // a janela de B (`derrubarSessao` → `cancelarPendenciasDoLightbox`), que devolve
  // a foto. A foto saiu do mapa numa sessão que já acabou, e segue fora da tela.
  const q = exclusoesNoMesmoLocal({ devolverDeVerdade: true });
  q.abrirEm(q.A, 'f1'); q.app.pedirExclusaoDaFoto(); q.vencerJanela();
  q.AppState.queue = [q.B, q.C]; q.AppState.currentPlace = q.B;
  q.abrirEm(q.B, 'f1'); q.app.pedirExclusaoDaFoto();
  q.responder('f1', { success: true, restantes: ['f2', 'f3'] });
  await umTique(); await umTique(); await umTique();
  q.app.setEpoca(1);
  q.pend.e.cancelar();
  assert.ok(!q.L.urls.includes(FOTO('f1')) && !q.B.approvedImageIds.includes('f1'),
    'DEFEITO: a queda cancelou a janela do irmão e a foto que já tinha saído do mapa voltou à camada e ao pedido');
});

test('R12-3-02 a memória das fotos que saíram do mapa: por local e sessão, com teto, e sai no "Sair"', () => {
  const corpo = ['fotoSaiuDoMapa', 'anotarFotoQueSaiuDoMapa'].map(fatiar).join('\n');
  const g = new Map();
  let epoca = 0;
  const h = new Function('fotosQueSairamDoMapa', 'FOTOS_QUE_SAIRAM_TETO', '__epoca',
    corpo.replace(/epocaDaSessao/g, '__epoca()') + '\nreturn { fotoSaiuDoMapa, anotarFotoQueSaiuDoMapa };')(g, 3, () => epoca);
  const V1 = { venueID: 'v1' }, V2 = { venueID: 'v2' };
  h.anotarFotoQueSaiuDoMapa(V1, 'f1');
  assert.equal(h.fotoSaiuDoMapa(V1, 'f1', true), true);
  assert.equal(h.fotoSaiuDoMapa(V2, 'f1', true), false, 'a foto de um local valeu pra outro local (a chave não é por local)');
  epoca = 1;                                       // a queda
  assert.equal(h.fotoSaiuDoMapa(V1, 'f1', true), false, 'a foto que saiu numa sessão anterior valeu como "desta sessão"');
  assert.equal(h.fotoSaiuDoMapa(V1, 'f1'), true, 'pra a TELA a foto que saiu numa sessão anterior segue fora do mapa');
  for (let i = 2; i < 6; i++) h.anotarFotoQueSaiuDoMapa(V1, 'f' + i);
  assert.equal(g.size, 3, 'a memória das fotos que saíram cresce sem teto');
  assert.equal(h.fotoSaiuDoMapa(V1, 'f1'), false, 'a mais velha não saiu pelo teto');
  assert.match(fatiar('handleLogout'), /fotosQueSairamDoMapa\.clear\(\);/, 'o "Sair" não esquece as fotos que as exclusões de quem saiu tiraram do mapa');
});
