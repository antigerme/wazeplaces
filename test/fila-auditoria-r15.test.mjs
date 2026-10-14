// A FILA na rodada 15 da auditoria (o lote 19): a aprovação de foto que não
// pousa depois da queda numa fila refeita, a página que chega e redesenha o card
// que o Desfazer devolveu, e o refazer adiado pra janela do Desfazer que a
// DESCARGA da página (ir pro fundo, fechar) deixava morrer ou mandava como busca
// `keepalive` sem o teto de 45 s.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" que aceita qualquer chamada (o molde do
// test/busca-auditoria-r14.test.mjs). Cada teste foi visto REPROVANDO com o
// conserto desfeito, e carrega um CONTROLE que reprova se o instrumento não
// enxergar o defeito (gotcha #28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')' && --par === 0) { i = j + 1; break; }
  }
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', i); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) {
      const corpo = APP_SEM.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}

function buracoNegro() {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro()),
    apply: () => buracoNegro(), set: () => true,
  });
}
function montar(nomes, deps) {
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      return typeof k === 'string' ? buracoNegro() : undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map(fatiar).join('\n');
  return new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
}

const tique = (ms = 0) => new Promise((ok) => setTimeout(ok, ms));
async function ateQue(cond, rotulo, tetoMs = 4000) {
  const fim = performance.now() + tetoMs;
  while (!cond()) {
    if (performance.now() > fim) assert.fail(`${rotulo}: não aconteceu em ${tetoMs / 1000} s`);
    await tique(2);
  }
}
const P = (n, extra = {}) => ({ venueID: 'v' + n, updateRequestID: 'u' + n, name: 'Local ' + n, creatorId: 900 + n, ...extra });
const ids = (fila) => fila.map((p) => p.updateRequestID);

// ═══ R15-2-F0 · a aprovação de foto que NÃO pousa depois da queda, na fila REFEITA ═══
// (auditoria da rodada 15; o irmão da aprovação do R14-2-02). A aprovação sai, a
// resposta fica presa; a sessão cai e a pessoa entra DE NOVO — a fila é refeita e
// a busca da sessão nova deixa o pedido de fora, porque a aprovação o tem "em
// andamento". A resposta chega como falha (401, 5xx) ou a ida lança: o ✨ e o
// "Aprovar" voltam (`escritaDoLightboxSemSessao`, calada se o pedido não está
// na tela), mas o pedido seguia pendente no Waze sem ninguém que o trouxesse:
// "Tudo limpo!" (MEDIDO no navegador, nos dois motores; roteiro
// r15-2/s/q3-aprovacao-falha-fila-refeita.mjs). Os outros três caminhos do
// R14-2-02 (✕/✓, lote, recusa automática) devolviam; este não.
function montarAprovacao({ authenticated = true } = {}) {
  const log = [];
  const AppState = { authenticated, fetchEpoch: 1, queue: [], currentPlace: null };
  const respostas = [];
  const deps = {
    AppState, epocaDaSessao: 0, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(),
    chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID,
    aplicarTravaDeAcao: () => {}, vezDasFotosNoLocal: () => ({ soltar: () => {} }), esperaAVezDoLocal: () => false,
    idasSemRespostaDeAntes: () => 0, lembrarIdasSemResposta: () => {},
    contarIdasSemResposta: (fn) => { const f = () => fn(); f.semResposta = false; return f; },
    callWithRetry: (fn) => fn(), refazerDepoisDo401: async () => null,
    API: { aprovarPedido: () => new Promise((ok, falha) => respostas.push({ ok, falha })) },
    pousouNoWaze: (r) => !!(r && (r.success || r.errorCategory === 'already_processed')),
    marcarEmAndamento: () => {}, refazerSelosSeOutroNaTela: () => {},
    Lightbox: { desmarcarAprovada: () => log.push('desmarcou'), isOpen: () => false },
    // O pedido saiu da fila (a refeita o deixou de fora): a camada fechou, e a escrita fica calada.
    escritaDoLightboxSemSessao: (place, voltar) => { voltar(); log.push('aviso-sem-sessao'); },
    aprovacaoPousouDepoisDaQueda: () => log.push('pousou-depois-da-queda'),
    // O de verdade: só devolve se a fila do gesto NÃO é a de agora.
    devolverPedidoRecusado: (place, epocaFila) => log.push('devolveu:' + place.updateRequestID + '@' + epocaFila),
    showToast: (m) => log.push('toast:' + m), t: (k) => k, msgDoServidor: () => '',
    quemDecideAgora: () => null, decididosPorOutraAbaComCardAqui: new WeakSet(),
    console: { error: () => {} },
  };
  const h = montar(['enviarAprovacao', 'esperaDaEscritaNoSair', 'voltarDaAprovacaoRecusada'], deps);
  // Aprova (a resposta presa), a sessão cai e a fila é refeita; depois a resposta chega.
  const aprovarECair = async (resposta, { epocaFila = 0 } = {}) => {
    const place = P(1);
    const fim = h.enviarAprovacao({ id: 'foto', place, idx: 0, epocaFila, regiao: 'row' });
    await tique();
    deps.epocaDaSessao++;                          // a queda (`derrubarSessao`)
    if (resposta === 'lancar') respostas.shift().falha(new Error('rede'));
    else respostas.shift().ok(resposta);
    await fim;
  };
  return { aprovarECair, log, AppState };
}

test('R15-2-F0: a aprovação que volta como FALHA depois da queda, na fila refeita por quem entrou de novo, devolve o pedido pela busca', async () => {
  for (const falha of [{ success: false, errorCategory: 'unauthorized' }, { success: false, errorCategory: 'unknown' }]) {
    const m = montarAprovacao();
    await m.aprovarECair(falha);
    assert.ok(m.log.includes('devolveu:u1@0'),
      `DEFEITO: o pedido cuja aprovação não chegou ao Waze não voltou pela busca da fila nova (${falha.errorCategory}): "Tudo limpo!" com ele pendente (R15-2-F0): ${m.log}`);
    assert.equal(m.log.filter((l) => l.startsWith('devolveu')).length, 1, `devolveu mais de uma vez: ${m.log}`);
  }
});

test('R15-2-F0: a ida que LANÇA depois da queda (o `catch`) também devolve o pedido', async () => {
  const m = montarAprovacao();
  await m.aprovarECair('lancar');
  assert.ok(m.log.includes('devolveu:u1@0'),
    `DEFEITO: a aprovação que lançou depois da queda deixou o pedido sumir da fila refeita (R15-2-F0): ${m.log}`);
});

test('R15-2-F0: CONTROLES — o "Sair" (sem sessão) não devolve nada; a que POUSOU não devolve; a fila que atravessou a queda não precisa', async () => {
  const sair = montarAprovacao({ authenticated: false });
  await sair.aprovarECair({ success: false, errorCategory: 'unauthorized' });
  assert.ok(!sair.log.some((l) => l.startsWith('devolveu')), `depois do "Sair" o pedido voltou à fila de quem saiu: ${sair.log}`);
  // PRÉ-CONDIÇÃO do instrumento: o caminho da falha depois da queda rodou (o ✨ voltou).
  assert.ok(sair.log.includes('desmarcou') && sair.log.includes('aviso-sem-sessao'), `PRÉ-CONDIÇÃO: o ramo da queda não rodou: ${sair.log}`);

  const pousou = montarAprovacao();
  await pousou.aprovarECair({ success: true });
  assert.ok(pousou.log.includes('pousou-depois-da-queda'), `PRÉ-CONDIÇÃO: a aprovação que pousou não passou pelo ramo dela: ${pousou.log}`);
  assert.ok(!pousou.log.some((l) => l.startsWith('devolveu')), `a aprovação que POUSOU devolveu o pedido: ${pousou.log}`);

  // A fila é a MESMA (a renovação que a mantém): o pedido nunca saiu dela, e quem volta o ✨ é o `desmarcarAprovada`.
  const mantida = montarAprovacao();
  mantida.AppState.fetchEpoch = 0;
  await mantida.aprovarECair({ success: false, errorCategory: 'unauthorized' });
  assert.ok(mantida.log.includes('aviso-sem-sessao'), `PRÉ-CONDIÇÃO: o ramo da queda não rodou: ${mantida.log}`);
});

// O `voltarDaAprovacaoRecusada` de verdade devolve quando a fila é outra (o fio do conserto).
test('R15-2-F0: a devolução usa a fila do GESTO — o `voltarDaAprovacaoRecusada` só devolve na fila que não é a de agora', () => {
  const log = [];
  const AppState = { fetchEpoch: 3 };
  const h = montar(['voltarDaAprovacaoRecusada'], { AppState, devolverPedidoRecusado: (p, e) => log.push([p.updateRequestID, e]) });
  h.voltarDaAprovacaoRecusada({ place: P(1), epocaFila: 3 });
  assert.deepEqual(log, [], 'CONTROLE: na MESMA fila o pedido nunca saiu dela, não há o que devolver');
  h.voltarDaAprovacaoRecusada({ place: P(1), epocaFila: 2 });
  assert.deepEqual(log, [['u1', 2]]);
});

// ═══ R15-2-F1 · a página que chega NÃO redesenha o card que o Desfazer devolveu ═══
// (auditoria da rodada 15). O último card do que a página trouxe é decidido com a
// próxima página ainda no ar (o esqueleto na tela, `hasMore`); a pessoa desfaz, e
// o card volta com o foco do teclado no ✕ (a promessa do R14-8-01); quando a
// página chega, o fim do `startFetching` apagava o card e o desenhava de novo:
// foco no <body>, carrossel de volta à 1ª foto, e o nó que o mouse arrastava
// saía do DOM (MEDIDO no navegador, nos dois motores; roteiros
// r15-2/s/f1-desfazer-esqueleto-foco, f2-…-carrossel e g1-redesenho-no-arraste).
function montarFimDaBusca({ cardNaTela = true, cardDeOutroPedido = false } = {}) {
  const log = [];
  const D1 = P(1);
  const AppState = { autorEmFoco: null, queue: [], currentPlace: null, hasMore: true, loadError: false, authenticated: true,
    fetchEpoch: 0, filters: { myArea: false }, profile: { id: 1 }, _profilePromise: null, _caixaDaMinhaAreaNoAr: null, pendingAction: null };
  let soltar = null;
  const card = { nome: 'card-da-frente' };
  const pedidoDoElemento = new Map();
  const deps = {
    AppState, Treino: { ativo: false }, navigator: { onLine: true },
    document: { getElementById: () => ({ classList: { add() {}, remove() {}, contains: () => false } }) },
    showLoading: () => {}, removeCurrentCardEl: () => {}, renderFocoAutor: () => {}, updatePendingCount: () => {},
    refazerDecisaoSemResposta: () => null, ultimaBuscaFalhouPorRede: false, buscaEsperaOPerfil: false, filaEsperaPerfil: false,
    lugarDoPedidoDoPerfil: null, pedidosQueEntraramNaFila: new Set(),
    cardDaFrente: () => (cardNaTela ? card : null),
    pedidoDoCard: (c) => (c === card ? (cardDeOutroPedido ? P(99) : D1) : null),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; log.push('card redesenhado'); },
    aoMudarAFilaPorBaixo: () => log.push('só por baixo'),
    showNoPlaces: () => log.push('vazio'), maybePrefetch: () => log.push('reposição'),
    fetchNextPage: () => new Promise((ok) => { soltar = (novos) => { AppState.queue.push(...novos); AppState.hasMore = false; ok(); }; }),
  };
  const h = montar(['startFetching'], deps);
  return { h, deps, AppState, D1, log, soltar: (novos) => soltar(novos) };
}

test('R15-2-F1: a página que chega com o card do Desfazer JÁ na tela só acerta o que vem por baixo — não redesenha o card', async () => {
  const m = montarFimDaBusca();
  const busca = m.h.startFetching();               // o último card foi decidido; o esqueleto, e a página vindo
  await tique();
  m.AppState.queue = [m.D1]; m.AppState.currentPlace = m.D1;     // o Desfazer devolveu o card (e o foco ao ✕)
  m.soltar([P(2), P(3)]);                          // a página chega
  await busca;
  assert.deepEqual(ids(m.AppState.queue), ['u1', 'u2', 'u3']);
  assert.ok(!m.log.includes('card redesenhado'),
    `DEFEITO: a página que chegou redesenhou o card que o Desfazer acabara de devolver — foco no <body>, carrossel na 1ª foto, nó do arraste perdido (R15-2-F1): ${m.log}`);
  assert.ok(m.log.includes('só por baixo'), `o que a página trouxe não chegou ao "Ver +N", à barra e ao card de fundo: ${m.log}`);
  assert.ok(m.log.includes('reposição'), 'a reposição da fila (`maybePrefetch`) saiu do fim da busca');
});

test('R15-2-F1: CONTROLES — sem card na tela, ou com o card de OUTRO pedido, o fim da busca desenha o card (o instrumento enxerga o redesenho)', async () => {
  for (const [rotulo, opcoes] of [['sem card', { cardNaTela: false }], ['card de outro pedido', { cardDeOutroPedido: true }]]) {
    const m = montarFimDaBusca(opcoes);
    const busca = m.h.startFetching();
    await tique();
    m.soltar([P(1), P(2)]);                        // a página traz os pedidos e a tela não tem o card do primeiro
    await busca;
    assert.ok(m.log.includes('card redesenhado') && !m.log.includes('só por baixo'),
      `CONTROLE (${rotulo}): o card não foi desenhado — o instrumento não enxerga o redesenho: ${m.log}`);
  }
});

// ═══ R15-6-01 + R15-3-02/03 · o refazer ADIADO pra janela e a DESCARGA da página ═══
// (auditoria da rodada 15). O refazer sem gesto da fila vazia (`retomarBusca`,
// `refazerFilaReal`) espera o fim da janela do Desfazer (`aoFim`). Quando a
// janela acaba porque a PÁGINA vai pro fundo ou fecha (`descarregarAcaoPendente`):
//  · R15-6-01: o "Rejeitar os N" é CANCELADO na descarga (`cancel(true)`), os
//    pedidos voltam pra fila, e o `aoFim` morria com a janela: a rede que voltou
//    já tinha gasto o gatilho, e a fila ficava em "Falha ao carregar" com a rede
//    de pé e `hasMore` falso.
//  · R15-3-02: nos outros fins (o ✕/✓ e as três escritas da foto), o `aoFim`
//    rodava com o modo "saindo" LIGADO — a busca saía com `keepalive` e sem o teto
//    de 45 s (pendurada, prendia a fila até recarregar; e pra uma página que morre
//    é uma requisição jogada fora no free tier).
// Agora o refazer espera a VOLTA da página (`setupFimDoModoSaindo`), já com o modo
// desligado e a busca normal, e só se ainda for a fila dele.
//
// Aqui roda o `scheduleAction` de VERDADE (a janela do card e do lote) e as
// escritas da foto (`pedirExclusaoDaFoto`, `aprovarFotoAtual`, `confirmarRenomear`),
// com o `descarregarAcaoPendente`, o `retomarBusca`, a `refazerFilaReal` e o
// `setupFimDoModoSaindo` de verdade. A busca e o envio são espiões.
function montarDescarga({ lote = false } = {}) {
  const log = [];
  const pedidosDoLote = [P(1), P(2)];
  const AppState = { authenticated: true, queue: [], currentPlace: null, hasMore: false, loadError: true, fetchEpoch: 0,
    serverTotal: 0, pendingAction: null, inFlightActions: 0, stats: { read: 0, rejected: 0, skipped: 0 },
    preferences: { undoEnabled: true }, serverBlocked: 0, blockedPartial: false, ultimaBusca: null };
  const API = { getRegion: () => 'row', saindo: false, setSaindo(v) { this.saindo = !!v; }, prepararExclusao: () => null };
  const P1 = { venueID: 'vf', updateRequestID: 'uf', name: 'Padaria Velha', purType: 'NEW_PHOTO', approvedImageIds: ['velha'] };
  const Lightbox = { place: P1, idx: 1, newIdx: 0, eDenuncia: false, urls: ['https://x/uf.jpg', 'https://x/velha.jpg'],
    isOpen: () => true, idFotoAtual: () => 'velha', podeAprovarAtual: () => true,
    removerFoto: () => {}, marcarComoAprovada: () => {}, desmarcarAprovada: () => {} };
  // O document/window do `setupFimDoModoSaindo`: os ouvintes ficam à mão do teste.
  const ouvintes = {};
  // O diálogo do "Sair": escondido até o `openModal` o abrir (o teste o fecha à mão).
  const sair = { escondido: true };
  const elSair = { classList: { contains: (c) => c === 'hidden' && sair.escondido } };
  const doc = { visibilityState: 'visible', getElementById: (id) => (id === 'lightboxNomeInput' ? { value: 'Padaria Nova' } : id === 'logoutModal' ? elSair : null), addEventListener: (tipo, fn) => { (ouvintes['doc:' + tipo] ||= []).push(fn); } };
  const win = { addEventListener: (tipo, fn) => { (ouvintes['win:' + tipo] ||= []).push(fn); } };
  const deps = {
    AppState, API, Lightbox, document: doc, window: win, Treino: { ativo: false }, UNDO_WINDOW_MS: 40, canDisableUndo: () => false,
    presencaFolhaAberta: () => false, navigator: { onLine: true },
    epocaDaSessao: 0,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    aprovandoAgora: false, excluindoAgora: false, escritasDeFotoNoLocal: new Map(), decididosPorOutraAbaComCardAqui: new WeakSet(),
    fotoDoLightboxNaTela: () => true, podeRenomearAqui: () => true, acoesTravadas: () => false, renomeacaoNoAr: () => false,
    editandoNome: () => true, aplicarNomeNaTela: (p, n) => { p.name = n; },
    enviarExclusao: () => { log.push('exclusão enviada'); return Promise.resolve(true); },
    enviarAprovacao: () => { log.push('aprovação enviada'); return Promise.resolve(true); },
    enviarRenomeacao: () => { log.push('nome enviado'); return Promise.resolve(true); },
    devolverFoto: () => {}, soltarEsperasDoAquecimento: () => {},
    // A BUSCA: o espião diz com o modo "saindo" ligado ou não, e se está na fila.
    startFetching: () => log.push(`busca (fila refeita, saindo=${API.saindo})`),
    maybePrefetch: () => log.push(`reposição (saindo=${API.saindo})`),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
    updatePendingCount: () => {}, t: (k) => k, showToast: (m) => log.push('aviso:' + m),
    enfileirarSaida: () => true, reverterPlacar: () => {},
    pedidosQueEntraramNaFila: new Set(), bloqueadosPorPagina: new Map(),
    tratouNestaFila: false, recusaAutomaticaNestaFila: false, filaAtravessouSessao: false, puladosNoInicioDaFila: 0,
    filaEsperaPerfil: false, rebuscasAuto: 0, filaDeOnde: null,
    descargaNaFila: new Set(), reivindicacaoDestaAba: () => ({}),
    openModal: (id) => { if (id === 'logoutModal') sair.escondido = false; }, desenharAvisoDoSair: () => {},
    console: { error: (...a) => log.push('ERRO:' + a.join(' ')) },
  };
  const h = montar(['scheduleAction', 'descarregarAcaoPendente', 'retomarBusca', 'refazerFilaReal', 'filaReal', 'resetQueue',
    'janelaDoDesfazerAberta', 'atenderOFimDaJanela', 'guardarORefazerAteAVolta', 'atenderORefazerAdiadoDaDescarga',
    'setupFimDoModoSaindo', 'abrirDialogoDoSair', 'despacharJanelaDoDesfazer', 'enviarPendenciasDoLightbox', 'pedirExclusaoDaFoto', 'aprovarFotoAtual', 'confirmarRenomear'], deps);
  h.setupFimDoModoSaindo();
  // A decisão que abre a janela com a fila VAZIA: o ✕ do último card, ou o lote.
  const decidir = () => {
    if (lote) {
      AppState.stats.rejected += 2;
      h.scheduleAction('reject', pedidosDoLote, async () => { log.push('lote enviado'); }, { aoSair: 'cancel' });
    } else h.scheduleAction('reject', P(1), async () => { log.push('✕ enviado'); });
  };
  const abrirFoto = { excluir: () => h.pedirExclusaoDaFoto(), aprovar: () => h.aprovarFotoAtual(), renomear: () => h.confirmarRenomear() };
  const janelaDaFoto = () => deps.exclusaoPendente || deps.aprovacaoPendente || deps.renomeacaoPendente;
  // A página vai pro fundo / volta.
  const paraOFundo = () => { doc.visibilityState = 'hidden'; h.descarregarAcaoPendente(); };
  const volta = () => { doc.visibilityState = 'visible'; for (const fn of ouvintes['doc:visibilitychange'] || []) fn(); };
  const buscas = () => log.filter((l) => l.startsWith('busca (')).length;
  return { h, deps, AppState, API, log, decidir, abrirFoto, janelaDaFoto, paraOFundo, volta, buscas, ouvintes, pedidosDoLote, sair };
}

test('R15-6-01: o "Rejeitar os N" cancelado pela descarga da página — na volta, o refazer que esperava a janela RETOMA a busca (a fila não fica em "Falha ao carregar")', async () => {
  const m = montarDescarga({ lote: true });
  m.decidir();
  assert.ok(m.AppState.pendingAction, 'PRÉ-CONDIÇÃO: a janela do lote não abriu');
  m.h.retomarBusca();                              // o `online`, com a fila vazia por falha
  assert.equal(typeof m.AppState.pendingAction.aoFim, 'function', 'PRÉ-CONDIÇÃO: o refazer não ficou adiado na janela');
  m.paraOFundo();                                  // a descarga cancela o lote: os pedidos voltam à fila
  await tique(5);
  assert.deepEqual(ids(m.AppState.queue), ['u1', 'u2'], 'PRÉ-CONDIÇÃO: o lote cancelado não devolveu os pedidos');
  assert.equal(m.buscas(), 0, `a busca saiu com a página saindo (R15-3-02): ${m.log}`);
  m.volta();
  assert.equal(m.AppState.loadError, false,
    'DEFEITO: o refazer adiado morreu com a janela cancelada — a fila seguiu em "Falha ao carregar" com a rede de pé (R15-6-01)');
  assert.equal(m.AppState.hasMore, true, 'a busca não pode mais repor a fila: `hasMore` seguiu falso');
  assert.ok(m.log.some((l) => l.startsWith('reposição')), `a reposição da fila não foi retomada na volta: ${m.log}`);
  assert.equal(m.buscas(), 0, 'com os cards de volta o refazer só RETOMA — não refaz a fila por baixo da mão');
});

test('R15-6-01: CONTROLE — o Desfazer do lote atende o refazer adiado (o instrumento enxerga o atendimento)', async () => {
  const m = montarDescarga({ lote: true });
  m.decidir();
  m.h.retomarBusca();
  m.AppState.pendingAction.undo();
  await tique(5);
  assert.equal(m.AppState.loadError, false, 'CONTROLE: o Desfazer não atendeu o refazer adiado');
  assert.ok(m.log.some((l) => l.startsWith('reposição')), `CONTROLE: a reposição não saiu: ${m.log}`);
});

test('R15-3-02: o ✕/✓ despachado pela DESCARGA não atende o refazer com a página saindo — ele espera a volta, e sai como busca normal (sem `keepalive`)', async () => {
  const m = montarDescarga();
  m.decidir();
  m.h.retomarBusca();                              // fila vazia: o refazer fica adiado na janela
  m.paraOFundo();                                  // a descarga manda a decisão com `keepalive`
  await tique(10);
  assert.ok(m.log.includes('✕ enviado'), `PRÉ-CONDIÇÃO: a descarga não despachou a decisão: ${m.log}`);
  assert.equal(m.API.saindo, true, 'PRÉ-CONDIÇÃO: o modo "saindo" não ficou ligado');
  assert.equal(m.buscas(), 0,
    `DEFEITO: o refazer rodou com a página SAINDO — a busca sairia com keepalive e sem o teto de 45 s (R15-3-02): ${m.log}`);
  m.volta();
  assert.deepEqual(m.log.filter((l) => l.startsWith('busca (')), ['busca (fila refeita, saindo=false)'],
    `na volta o refazer tem que sair UMA vez, com o modo "saindo" já desligado: ${m.log}`);
  m.volta();                                       // outra volta: nada de busca de novo
  assert.equal(m.buscas(), 1, 'o refazer adiado rodou duas vezes');
});

test('R15-3-02: as três escritas da FOTO ampliada despachadas pela descarga — o refazer também espera a volta', async () => {
  for (const e of ['excluir', 'aprovar', 'renomear']) {
    const m = montarDescarga();
    m.abrirFoto[e]();
    assert.ok(m.janelaDaFoto(), `(${e}) PRÉ-CONDIÇÃO: a janela da foto não abriu`);
    m.h.retomarBusca();
    m.paraOFundo();
    await tique(10);
    assert.equal(m.API.saindo, true, `(${e}) PRÉ-CONDIÇÃO: o modo "saindo" não ficou ligado`);
    assert.equal(m.buscas(), 0, `(${e}) DEFEITO: o refazer rodou com a página SAINDO (R15-3-02): ${m.log}`);
    m.volta();
    assert.deepEqual(m.log.filter((l) => l.startsWith('busca (')), ['busca (fila refeita, saindo=false)'],
      `(${e}) na volta o refazer tem que sair uma vez, normal: ${m.log}`);
  }
});

test('R15-3-02: CONTROLE — sem a descarga (a janela vence sozinha, página à vista) o refazer sai no fim dela, como sempre', async () => {
  const m = montarDescarga();
  m.decidir();
  m.h.retomarBusca();
  m.AppState.pendingAction.execute();              // a janela vence
  await tique(10);
  assert.deepEqual(m.log.filter((l) => l.startsWith('busca (')), ['busca (fila refeita, saindo=false)'],
    `CONTROLE: com a página à vista o refazer tem que sair no fim da janela: ${m.log}`);
});

test('R15-3-02: o refazer que esperava a volta NÃO roda se a fila foi refeita ou a sessão acabou nesse meio', async () => {
  // ↻ / filtro: a fila já foi refeita por gesto.
  const a = montarDescarga();
  a.decidir();
  a.h.retomarBusca();
  a.paraOFundo();
  await tique(10);
  a.AppState.fetchEpoch++;                         // o ↻ da pessoa (outra fila)
  a.volta();
  assert.equal(a.buscas(), 0, `o refazer adiado rodou sobre uma fila que a pessoa já refez: ${a.log}`);
  // "Sair" / queda: a sessão acabou.
  const b = montarDescarga();
  b.decidir();
  b.h.retomarBusca();
  b.paraOFundo();
  await tique(10);
  b.AppState.authenticated = false;
  b.volta();
  assert.equal(b.buscas(), 0, `o refazer adiado rodou sem sessão: ${b.log}`);
  const c = montarDescarga();
  c.decidir();
  c.h.retomarBusca();
  c.paraOFundo();
  await tique(10);
  c.deps.epocaDaSessao++;                          // a queda e a renovação (a sessão é outra)
  c.volta();
  assert.equal(c.buscas(), 0, `o refazer adiado de uma sessão que acabou rodou na sessão nova: ${c.log}`);
  // CONTROLE dos três: na mesma fila e sessão, ele roda.
  const d = montarDescarga();
  d.decidir();
  d.h.retomarBusca();
  d.paraOFundo();
  await tique(10);
  d.volta();
  assert.equal(d.buscas(), 1, `CONTROLE: o refazer adiado não rodou na volta: ${d.log}`);
});

test('R15-6-01: a QUEDA, o "Sair" e a conta em dúvida também cancelam o lote (`cancel(true)`), e ali o refazer adiado NÃO roda — quem recompõe a fila é a renovação', async () => {
  for (const comSessao of [false, true]) {         // a queda e o "Sair" (sem sessão); a conta em dúvida (a sessão de pé)
    const m = montarDescarga({ lote: true });
    m.decidir();
    m.h.retomarBusca();
    assert.equal(typeof m.AppState.pendingAction.aoFim, 'function', 'PRÉ-CONDIÇÃO: o refazer não ficou adiado na janela');
    m.AppState.authenticated = comSessao;
    m.AppState.pendingAction.cancel(true);         // o `derrubarSessao`, não a descarga
    await tique(10);
    m.AppState.authenticated = true;               // a renovação entrou: a fila é dela
    m.volta();
    const rotulo = comSessao ? 'conta em dúvida' : 'queda';
    assert.equal(m.buscas(), 0, `(${rotulo}) o refazer adiado sobreviveu ao cancelamento da sessão: ${m.log}`);
    assert.ok(!m.log.some((l) => l.startsWith('reposição')), `(${rotulo}) o cancelamento da sessão atendeu o refazer adiado: ${m.log}`);
  }
});

// O que o `closeModal` faz com o diálogo do "Sair": a limpeza do modal, lida do
// `LIMPEZA_AO_FECHAR` DE VERDADE (a entrada `logoutModal`), rodando a função real.
function limpezaDoSair(h) {
  const m = /^    logoutModal\(\) \{([^}]*)\},?$/m.exec(APP_SEM);
  assert.ok(m, 'o `LIMPEZA_AO_FECHAR` não tem mais a entrada do `logoutModal` (R15-3-03)');
  return new Function('queueMicrotask', 'atenderORefazerAdiadoDaDescarga', m[1])(queueMicrotask, h.atenderORefazerAdiadoDaDescarga);
}

test('R15-3-03: abrir o diálogo do "Sair" despacha a decisão mas NÃO atualiza a fila — cancelar o diálogo atualiza (uma busca)', async () => {
  const m = montarDescarga();
  m.decidir();
  m.h.retomarBusca();                              // fila vazia por falha: o refazer espera a janela
  m.h.abrirDialogoDoSair();                        // despacha a janela: o ✕ sai
  await tique(10);
  assert.ok(m.log.includes('✕ enviado'), `PRÉ-CONDIÇÃO: abrir o diálogo não despachou a decisão (R14-8-06): ${m.log}`);
  assert.equal(m.sair.escondido, false, 'PRÉ-CONDIÇÃO: o diálogo não abriu');
  assert.equal(m.buscas(), 0,
    `DEFEITO: abrir o "Sair" já mandou a busca que atualiza a fila — jogada fora se a pessoa confirma (R15-3-03): ${m.log}`);
  m.sair.escondido = true;                         // cancelar: o `closeModal` esconde e roda a limpeza
  limpezaDoSair(m.h);
  await tique(10);
  assert.deepEqual(m.log.filter((l) => l.startsWith('busca (')), ['busca (fila refeita, saindo=false)'],
    `cancelado o "Sair", a fila vazia tem que ser atualizada, uma vez: ${m.log}`);
});

test('R15-3-03: o "Sair" CONFIRMADO descarta o refazer adiado — nenhuma busca', async () => {
  const m = montarDescarga();
  m.decidir();
  m.h.retomarBusca();
  m.h.abrirDialogoDoSair();
  await tique(10);
  // O `handleLogout` muda a época ANTES de fechar o diálogo (o `authenticated`
  // só cai depois): quem descarta o refazer é a época, não a falta de sessão.
  m.deps.epocaDaSessao++;
  m.sair.escondido = true;
  limpezaDoSair(m.h);
  await tique(10);
  assert.equal(m.buscas(), 0, `o "Sair" confirmado mandou a busca da fila: ${m.log}`);
  // Nem na volta da página, com a sessão nova de pé: o refazer era da que saiu.
  m.volta();
  assert.equal(m.buscas(), 0, `o refazer da sessão que saiu rodou na sessão nova: ${m.log}`);
});

test('R15-3-03: CONTROLE — sem o diálogo aberto, a janela vence e a fila é atualizada na hora (o instrumento enxerga o diálogo)', async () => {
  const m = montarDescarga();
  m.decidir();
  m.h.retomarBusca();
  assert.equal(m.sair.escondido, true, 'PRÉ-CONDIÇÃO: o diálogo estava aberto');
  m.AppState.pendingAction.execute();
  await tique(10);
  assert.equal(m.buscas(), 1, `CONTROLE: com o diálogo fechado o refazer tem que sair no fim da janela: ${m.log}`);
});

test('R15-3-03: o diálogo fechado com a página ainda no fundo não consome o refazer — quem o atende é a volta', async () => {
  const m = montarDescarga();
  m.decidir();
  m.h.retomarBusca();
  m.paraOFundo();                                  // a descarga: o refazer espera a volta
  await tique(10);
  limpezaDoSair(m.h);                              // um diálogo qualquer do "Sair" fecha com a página escondida
  await tique(10);
  assert.equal(m.buscas(), 0, `o fechamento do diálogo mandou a busca com a página ainda saindo: ${m.log}`);
  m.volta();
  assert.equal(m.buscas(), 1, `o refazer se perdeu: ${m.log}`);
});

test('R15-3-02: a ordem — o modo "saindo" é desligado ANTES de o refazer adiado rodar (a busca dele leva o teto de 45 s)', () => {
  const corpo = fatiar('setupFimDoModoSaindo');
  const i = corpo.indexOf('API.setSaindo(false)');
  const j = corpo.indexOf('atenderORefazerAdiadoDaDescarga()');
  assert.ok(i > 0 && j > i, 'o refazer adiado tem que rodar DEPOIS de o modo "saindo" acabar');
  assert.match(corpo, /visibilityState === 'visible'\) acabou\(\)/);
  assert.match(corpo, /addEventListener\('pageshow', acabou\)/, 'a volta do bfcache (`pageshow`) também atende o refazer adiado');
});

// ═══ R16-1-02 = R16-2-01 = R16-3-01 · a VOLTA da página com o diálogo do "Sair" aberto ═══
// (auditoria da rodada 16, três auditores). O R15-3-03 segura o refazer adiado
// enquanto o diálogo está aberto — mas o `acabou()` do `setupFimDoModoSaindo`
// (a volta do fundo, `pageshow`) o atendia com o diálogo AINDA na tela: uma busca
// antes de a pessoa decidir se sai, jogada fora se confirma.
test('R16-1-02: voltar do fundo com o diálogo do "Sair" ABERTO não roda o refazer adiado — cancelar o diálogo o roda (uma busca); confirmar, nenhuma', async () => {
  const m = montarDescarga();
  m.decidir();
  m.h.retomarBusca();                              // fila vazia por falha: o refazer espera a janela
  m.h.abrirDialogoDoSair();                        // despacha a janela, mantém o refazer, abre o diálogo
  await tique(10);
  assert.equal(m.sair.escondido, false, 'PRÉ-CONDIÇÃO: o diálogo não abriu');
  assert.equal(m.buscas(), 0, `PRÉ-CONDIÇÃO: abrir o "Sair" já mandou a busca: ${m.log}`);
  m.paraOFundo();                                  // a página vai pro fundo com o diálogo aberto...
  await tique(10);
  m.volta();                                       // ...e volta: o diálogo segue na tela
  await tique(10);
  assert.equal(m.buscas(), 0,
    `DEFEITO: a volta da página rodou a busca com o diálogo do "Sair" ainda aberto (R16-1-02): ${m.log}`);
  // CANCELAR: o fechamento do diálogo atende o refazer que ficou guardado — uma vez.
  m.sair.escondido = true;
  limpezaDoSair(m.h);
  await tique(10);
  assert.deepEqual(m.log.filter((l) => l.startsWith('busca (')), ['busca (fila refeita, saindo=false)'],
    `cancelado o "Sair", o refazer guardado tem que rodar, uma vez: ${m.log}`);
});

test('R16-1-02: CONFIRMAR o "Sair" depois da volta da página não deixa busca nenhuma — e o CONTROLE (diálogo fechado) roda na volta', async () => {
  const c = montarDescarga();
  c.decidir();
  c.h.retomarBusca();
  c.h.abrirDialogoDoSair();
  await tique(10);
  c.paraOFundo(); await tique(10); c.volta(); await tique(10);
  c.deps.epocaDaSessao++;                          // o `handleLogout` muda a época antes de fechar o diálogo
  c.sair.escondido = true;
  limpezaDoSair(c.h);
  await tique(10);
  assert.equal(c.buscas(), 0, `o "Sair" confirmado deixou uma busca jogada fora: ${c.log}`);
  // CONTROLE: a mesma ida ao fundo e volta, sem o diálogo aberto, roda o refazer na volta.
  const d = montarDescarga();
  d.decidir();
  d.h.retomarBusca();
  d.paraOFundo(); await tique(10);
  d.volta(); await tique(10);
  assert.equal(d.buscas(), 1, `CONTROLE: sem o diálogo aberto a volta tem que rodar o refazer: ${d.log}`);
});

test('R16-1-02 (estrutura): `atenderORefazerAdiadoDaDescarga` e `atenderOFimDaJanela` leem o diálogo pelo MESMO predicado (`#logoutModal` sem `hidden`)', () => {
  const corpoA = fatiar('atenderORefazerAdiadoDaDescarga');
  const corpoB = fatiar('atenderOFimDaJanela');
  const predicado = /getElementById\('logoutModal'\)[\s\S]*?classList\.contains\('hidden'\) === false/;
  assert.match(corpoA, predicado, 'a volta da página não confere o diálogo do "Sair"');
  assert.match(corpoB, predicado, 'o fim da janela não confere o diálogo do "Sair"');
  // E o diálogo é conferido ANTES de o refazer ser consumido (zerar e depois sair perderia o refazer).
  assert.ok(corpoA.indexOf("getElementById('logoutModal')") < corpoA.indexOf('refazerAdiadoDaDescarga = null'),
    'o refazer é consumido antes de o diálogo ser conferido: o cancelar não teria o que atender');
});
