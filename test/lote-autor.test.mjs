// O lote do autor ("Rejeitar os N") e a recusa automática — os dois passam
// pelo `enviarLote` — e a aprovação de foto, auditados na fila em 2026-09-26.
// Os testes RODAM as funções de verdade, fatiadas do app.js, com o Waze de
// mentira. Cada um foi visto REPROVANDO com o conserto desfeito.
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
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  i = APP_SEM.indexOf('{', i);
  let prof = 0, fim = APP_SEM.length;
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) { fim = j + 1; break; } }
  }
  const corpo = APP_SEM.slice(m.index, fim);
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
const pedido = (i, autor = 777) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: autor, createdBy: 'autor' + autor });
const chave = (p) => p.venueID + '|' + p.updateRequestID;
const RECUSA = { success: false, errorCategory: 'unknown', httpCode: 500 };

// O `enviarLote` de verdade. `resposta(p, n)` decide o que o Waze responde ao
// n-ésimo envio, e `antes(p, n)` roda ANTES de ele responder — é por onde o
// teste encena o ↻ no meio do laço.
// A fila de SAÍDA é de mentira, mas com a regra de verdade (o mesmo pedido
// duas vezes é "repetida"), e a devolução é a do app (`devolverPedidoRecusado`).
function montarLote({ fila = [], naTela = null, resposta = () => ({ success: true }), antes = () => {}, entraram = [], saida = [] } = {}) {
  const log = [];
  const regioes = [];
  const AppState = { stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: fila.length, queue: fila.slice(),
    currentPlace: naTela, fetchEpoch: 0, hasMore: false, inFlightActions: 0, authenticated: true };
  let n = 0;
  const naSaida = saida.slice();
  let gravacoes = 0;
  const deps = {
    AppState, epocaDaSessao: 0, callWithRetry: (fn) => fn(),
    API: { getRegion: () => 'row',
      rejectPlace: async (v, u, presenca, regiao) => { const p = { venueID: v, updateRequestID: u }; regioes.push(regiao); n++; antes(p, n); return resposta(p, n); } },
    registrarPouso: () => {}, recordHistory: () => {}, registrarRejeicaoDeAutor: () => {}, registrarAcaoConfirmada: () => {},
    marcarEmAndamento: () => {}, handleUnauthorized: () => {},
    // Com a `lista` de quem chama (o lote), só põe nela: quem grava é quem chama.
    enfileirarSaida: (tipo, p, regiao, extra, calado, lista) => {
      const f = lista || naSaida;
      if (f.some((x) => chave(x) === chave(p))) return 'repetida';
      f.push({ tipo, venueID: p.venueID, updateRequestID: p.updateRequestID });
      if (!lista) gravacoes++;
      return true;
    },
    salvarFilaDeSaida: (f) => { gravacoes++; naSaida.splice(0, naSaida.length, ...f); },
    tirarDaFilaDeSaida: (tipo, p) => { const i = naSaida.findIndex((x) => chave(x) === chave(p)); if (i >= 0) naSaida.splice(i, 1); },
    carregarFilaDeSaida: () => naSaida.slice(), dfato: (k) => log.push('diario:' + k),
    pousouNoWaze: (r) => !!(r && (r.success || r.errorCategory === 'already_processed')),
    descontarGestoSemSessao: (k, placar, q) => { placar[k] = Math.max(0, placar[k] - q); },
    updateInFlightIndicator: () => {}, updateStats: () => {}, saveStats: () => {}, updatePendingCount: () => {},
    mostrarResultadoDoLote: () => log.push('folha'), chaveDoPedido: chave,
    pedidosQueEntraramNaFila: new Set([...fila, ...entraram].map(chave)),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; log.push('card'); },
    startFetching: () => log.push('busca'),
    aoMudarAFilaPorBaixo: () => log.push('fundo:' + (AppState.queue[1] ? AppState.queue[1].venueID : '-')),
    Treino: { ativo: false },
  };
  const chaves = Object.keys(deps);
  const enviarLote = new Function(...chaves, fatiar('enviarLote') + '\n' + fatiar('devolverPedidoRecusado')
    + '\nreturn enviarLote;')(...chaves.map((k) => deps[k]));
  return { enviarLote, AppState, log, regioes, deps, naSaida, gravacoes: () => gravacoes };
}

// ── F4: o ↻ no MEIO da recusa automática ────────────────────────────────────
// A recusa tira os alvos da fila e desconta o "Restam" a cada um que POUSA. Com
// um ↻ (ou troca de filtro) no meio, a fila nova já vinha sem os que faltavam
// (estavam em andamento), e cada pouso do laço antigo descontava dela: MEDIDO no
// navegador, fila de 5 cards com "Restam 0".
test('F4: ↻ no meio da recusa automática — os pousos do laço antigo não descontam o "Restam" da fila nova', async () => {
  const alvos = [pedido(1), pedido(2), pedido(3), pedido(4)];
  const m = montarLote({
    antes: (p, n) => {
      if (n !== 2) return;
      // O ↻: fila nova (época nova), com 5 pedidos de outros autores.
      m.AppState.fetchEpoch++;
      m.AppState.queue = [pedido(10, 1), pedido(11, 1), pedido(12, 1), pedido(13, 1), pedido(14, 1)];
      m.AppState.serverTotal = 5;
    },
    // Um dos que pousam depois do ↻ outro editor já tinha tratado: o "já
    // tratado" também desce o "Restam" ao landar.
    resposta: (p) => (p.venueID === 'v4' ? { success: false, errorCategory: 'already_processed' } : { success: true }),
  });
  m.AppState.serverTotal = 9;       // a fila de antes: 5 + os 4 alvos, que o pouso desconta um a um
  await m.enviarLote(alvos, { silencioso: true, contarAoLandar: true });
  assert.equal(m.AppState.serverTotal, 5,
    `o laço antigo descontou da fila NOVA: "Restam" ${m.AppState.serverTotal} com ${m.AppState.queue.length} cards`);
  assert.equal(m.AppState.stats.rejected, 3, 'o que foi rejeitado deixou de contar no placar');
});

test('F4: ↻ no meio — o que FALHA não entra na fila nova (de outro filtro); a busca o traz, se ele for dela', async () => {
  const alvos = [pedido(1), pedido(2)];
  const m = montarLote({
    antes: (p, n) => { if (n === 1) { m.AppState.fetchEpoch++; m.AppState.queue = [pedido(10, 1)]; m.AppState.serverTotal = 1; } },
    resposta: (p) => (p.venueID === 'v2' ? RECUSA : { success: true }),
    entraram: alvos,                                // passaram pela fila antes de a recusa os tirar
  });
  await m.enviarLote(alvos, { silencioso: true, contarAoLandar: true });
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v10'], 'o pedido do laço antigo entrou na fila nova');
  assert.equal(m.AppState.serverTotal, 1);
  assert.ok(!m.deps.pedidosQueEntraramNaFila.has('v2|u2'), 'o que falhou "já passou pela fila": a busca nunca o traz');
  assert.equal(m.AppState.hasMore, true);
});

test('F4: CONTROLE — sem ↻, cada pouso desconta e quem falha volta pra fila, como sempre', async () => {
  const alvos = [pedido(1), pedido(2), pedido(3)];
  const m = montarLote({ fila: [pedido(10, 1)], naTela: null, resposta: (p) => (p.venueID === 'v3' ? RECUSA : { success: true }) });
  m.AppState.currentPlace = m.AppState.queue[0];
  m.AppState.serverTotal = 4;
  await m.enviarLote(alvos, { silencioso: true, contarAoLandar: true });
  assert.equal(m.AppState.serverTotal, 2, 'os dois que pousaram não desceram o "Restam"');
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v10', 'v3'], 'o que falhou não voltou pra fila');
});

// ── F4 (a mesma raiz): a aprovação de foto que pousa depois do ↻ ─────────────
function montarAprovacao({ epocaDoGesto = 0 } = {}) {
  const log = [];
  const place = pedido(1);
  const AppState = { serverTotal: 5, fetchEpoch: 0, currentPlace: null, queue: [pedido(9)] };
  const deps = {
    AppState, registrarPouso: () => log.push('pouso'), updateStats: () => {},
    Lightbox: { isOpen: () => false, place: null }, advanceQueue: () => log.push('avanca'),
    updatePendingCount: () => {}, aoMudarAFilaPorBaixo: () => {}, mantendoFocoNoCard: (redesenhar) => redesenhar(),
  };
  const chaves = Object.keys(deps);
  const concluir = new Function(...chaves, 'let placeResolvidoPorAprovacao = null; let tratouNestaFila = false;\n'
    + fatiar('concluirAprovacao') + '\n' + fatiar('tirarAprovadoDaFila') + '\nreturn concluirAprovacao;')(...chaves.map((k) => deps[k]));
  return { concluir: () => concluir({ id: 'u1', place, idx: 0, epocaFila: epocaDoGesto }), AppState, log };
}

test('F4: aprovação que pousa DEPOIS do ↻ não desconta o "Restam" da fila nova', () => {
  const m = montarAprovacao({ epocaDoGesto: 0 });
  m.AppState.fetchEpoch = 1;                      // o ↻ refez a fila durante a janela / o envio
  m.concluir();
  assert.equal(m.AppState.serverTotal, 5, 'a aprovação descontou da fila NOVA');
  assert.ok(m.log.includes('pouso'), 'o pouso da aprovação deixou de ser registrado');
});

test('F4: CONTROLE — a aprovação na MESMA fila desconta o "Restam", como sempre', () => {
  const m = montarAprovacao({ epocaDoGesto: 0 });
  m.concluir();
  assert.equal(m.AppState.serverTotal, 4);
});

test('F4: aprovar a foto leva a fila do GESTO no alvo (`epocaFila`)', async () => {
  let alvoEnviado = null;
  const place = pedido(1);
  const AppState = { fetchEpoch: 7, preferences: { undoEnabled: false }, authenticated: true };
  const deps = {
    AppState, Treino: { ativo: false }, canDisableUndo: () => true, estadoAprovando: () => {},
    Lightbox: { place, idx: 0, podeAprovarAtual: () => true, marcarComoAprovada: () => {} },
    // Nada de foto no ar (L24), e a região do gesto (L26).
    aprovandoAgora: false, excluindoAgora: false, API: { getRegion: () => 'row' },
    enviarAprovacao: async (alvo) => { alvoEnviado = alvo; return true; },
    aplicarTravaDeAcao: () => {}, removeUndoBanner: () => {}, mostrarDesfazer: () => {}, t: (k) => k,
    registrarDesfazer: () => {}, UNDO_WINDOW_MS: 3000,
    // Do lightbox (L3, o foco, o "em andamento" da aprovação).
    fotoDoLightboxNaTela: () => true, marcarEmAndamento: () => {}, manterFocoNoLightbox: () => {},
    refazerSelosSeOutroNaTela: () => {},   // o "Ver +N" do card da frente (R5-2-02)
  };
  const chaves = Object.keys(deps);
  const aprovar = new Function(...chaves, 'let aprovacaoPendente = null; let exclusaoPendente = null;\n'
    + fatiar('aprovarFotoAtual') + '\nreturn aprovarFotoAtual;')(...chaves.map((k) => deps[k]));
  aprovar();
  await new Promise((ok) => setTimeout(ok, 0));
  assert.ok(alvoEnviado, 'a aprovação não saiu (o instrumento não mede nada)');
  assert.equal(alvoEnviado.epocaFila, 7, 'a aprovação não sabe de que fila é: descontaria o "Restam" da fila refeita');
});

// ── L11: aprovar a foto do ÚLTIMO pedido ────────────────────────────────────
// A aprovação resolve o pedido como o ✓ resolve, mas não marcava que a pessoa
// tratou algo NESTA fila: aprovar o último terminava em "Tudo limpo!" com a
// frase de quem não tratou nada ("Confira o país e a região em Filtros") e sem
// confete — com o ✓ no mesmo pedido saía "Você processou todos…" com festa.
function montarUltimaAprovacao({ lightboxAberto = false } = {}) {
  const log = [];
  const place = pedido(1);
  const AppState = { serverTotal: 1, fetchEpoch: 0, currentPlace: place, queue: [place] };
  let app = null;
  const deps = {
    AppState, registrarPouso: () => {}, updateStats: () => {},
    Lightbox: { isOpen: () => lightboxAberto, place: lightboxAberto ? place : null },
    // O `advanceQueue` esvazia a fila e chama o `showNoPlaces`, que decide a
    // frase e a festa por `tratouNestaFila` — lido NESTE instante.
    advanceQueue: () => log.push('avanca:tratou=' + app.tratou()),
    updatePendingCount: () => {}, aoMudarAFilaPorBaixo: () => {},
    // O foco que fica no card trocado (R5-3-07) é medido em test/lightbox-foco-card.test.mjs.
    mantendoFocoNoCard: (redesenhar) => redesenhar(),
  };
  const chaves = Object.keys(deps);
  app = new Function(...chaves, 'let placeResolvidoPorAprovacao = null; let tratouNestaFila = false;\n'
    + fatiar('concluirAprovacao') + '\n' + fatiar('avancarSeAprovado') + '\n' + fatiar('tirarAprovadoDaFila')
    + '\nlet aprovacaoPendente = null;\nreturn { concluirAprovacao, avancarSeAprovado, tratou: () => tratouNestaFila };')(...chaves.map((k) => deps[k]));
  return { app, alvo: { id: 'u1', place, idx: 0, epocaFila: 0 }, log };
}

test('L11: aprovar o ÚLTIMO pedido conta como tratar a fila — o "Tudo limpo!" é o de quem terminou', () => {
  const m = montarUltimaAprovacao();
  m.app.concluirAprovacao(m.alvo);
  assert.deepEqual(m.log, ['avanca:tratou=true'],
    'a fila esvaziou pela aprovação sem "tratou nesta fila": o painel diz "Confira o país e a região", sem festa');
});

test('L11: com o lightbox aberto, a marca vem na APROVAÇÃO — o card sai depois, ao fechar', () => {
  const m = montarUltimaAprovacao({ lightboxAberto: true });
  m.app.concluirAprovacao(m.alvo);
  assert.equal(m.app.tratou(), true, 'a aprovação confirmada não marcou que a pessoa tratou algo nesta fila');
  m.app.avancarSeAprovado();
  assert.deepEqual(m.log, ['avanca:tratou=true']);
});

// ── F6: "Rejeitar os N" que ESVAZIA a fila ───────────────────────────────────
// (a) A marca de "tratou nesta fila" vinha DEPOIS do `showNoPlaces`: logo depois
// de rejeitar tudo, a tela dizia "Confira o país e a região", sem festa.
// (b) O que o Waze recusava voltava pra `AppState.queue` ATRÁS do painel vazio,
// e ninguém o desenhava — MEDIDO no navegador: fila com o pedido, "Restam 1",
// e o "Tudo limpo!" na tela.
function montarLoteDoAutor() {
  const log = [];
  const alvo = pedido(1, 555);
  const AppState = { authenticated: true, queue: [alvo, pedido(2, 555), pedido(3, 555)], currentPlace: alvo, stats: { rejected: 0 },
    serverTotal: 3, hasMore: false };
  let app = null;
  const deps = {
    AppState, acoesTravadas: () => false, avisoDaTrava: () => 'x', Treino: { ativo: false }, showToast: () => {}, t: (k) => k,
    pedidosDoAutorNaFila: () => AppState.queue.slice(), updateStats: () => {}, saveStats: () => {}, updatePendingCount: () => {},
    removeCurrentCardEl: () => {}, showCurrentPlace: () => log.push('card'), maybePrefetch: () => {}, startFetching: () => log.push('busca'),
    showNoPlaces: () => log.push('vazio:tratou=' + app.tratou()),
    API: { getRegion: () => 'row' }, scheduleAction: () => log.push('agendou'), enviarLote: () => {},
  };
  const chaves = Object.keys(deps);
  app = new Function(...chaves, 'let tratouNestaFila = false;\n' + fatiar('rejeitarLoteDoAutor')
    + '\nreturn { rejeitarLoteDoAutor, tratou: () => tratouNestaFila };')(...chaves.map((k) => deps[k]));
  return { app, alvo, log };
}

test('F6: "Rejeitar os N" que esvazia a fila — o painel é o de quem TERMINOU, não o de "confira o país"', () => {
  const m = montarLoteDoAutor();
  m.app.rejeitarLoteDoAutor(m.alvo);
  assert.ok(m.log.includes('vazio:tratou=true'),
    `o painel vazio foi desenhado sem "tratou nesta fila" (${m.log.join(' ')}): diz "Confira o país e a região", sem festa`);
});

test('F6: o que o Waze recusa no lote VOLTA como card — não fica atrás do painel vazio', async () => {
  // A fila esvaziou no gesto; o lote manda os três e o do meio é recusado.
  const alvos = [pedido(1, 555), pedido(2, 555), pedido(3, 555)];
  const m = montarLote({ resposta: (p) => (p.venueID === 'v2' ? RECUSA : { success: true }) });
  m.AppState.serverTotal = 0;
  await m.enviarLote(alvos, {});
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v2']);
  assert.ok(m.log.includes('card'), 'o pedido recusado voltou pra fila e ficou atrás do "Tudo limpo!"');
  assert.equal(m.AppState.currentPlace && m.AppState.currentPlace.venueID, 'v2');
});

test('F6: vale pra RECUSA AUTOMÁTICA com a fila vazia (a busca trouxe só pedidos do autor marcado)', async () => {
  const alvos = [pedido(1), pedido(2)];
  const m = montarLote({ resposta: (p) => (p.venueID === 'v1' ? RECUSA : { success: true }) });
  await m.enviarLote(alvos, { silencioso: true, contarAoLandar: true });
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v1']);
  assert.ok(m.log.includes('card'), 'o pedido que a recusa automática não conseguiu rejeitar ficou atrás do painel');
});

test('F6: CONTROLE — com card na tela, o que falha vai pro fim da fila sem trocar o card', async () => {
  const frente = pedido(9, 1);
  const m = montarLote({ fila: [frente], naTela: frente, resposta: () => RECUSA });
  await m.enviarLote([pedido(1)], { silencioso: true, contarAoLandar: true });
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v9', 'v1']);
  assert.ok(!m.log.includes('card'), 'redesenhou o card que estava na tela');
});

// ── F7: a recusa automática leva a REGIÃO em que os pedidos estão ────────────
// O `enviarLote` da recusa saía sem região, e o `rejectPlace` usava a do
// MOMENTO do envio: trocar a região em Filtros com o laço no ar mandava o resto
// pro servidor errado, que responde "não encontrado" — e o app conta isso como
// "já tratado por outro editor". MEDIDO: 5 rejeitados de verdade, 1 mandado ao
// servidor da América do Norte, contado como feito, e pendente no Waze.
test('F7: trocar a região com a recusa automática no ar não manda o resto pro servidor errado', async () => {
  let regiaoAgora = 'row';
  const frente = pedido(9, 1);
  const alvos = [pedido(1), pedido(2), pedido(3)];
  const AppState = { queue: [frente, ...alvos], currentPlace: frente, stats: { rejected: 0 }, serverTotal: 4,
    fetchEpoch: 0, hasMore: false, inFlightActions: 0, authenticated: true };
  const regioes = [];
  const deps = {
    AppState, podeRecusarAutomaticoAqui: () => true, contaConfirmada: () => true, Treino: { ativo: false },
    autoLigado: (id) => id === 777, updatePendingCount: () => {}, aoMudarAFilaPorBaixo: () => {},
    showToast: () => ({ texto() {}, dispensar() {} }), t: (k) => k,
    pedidosEmAndamento: new Set(), chaveDoPedido: chave, epocaDaSessao: 0, callWithRetry: (fn) => fn(),
    API: {
      getRegion: () => regiaoAgora,
      rejectPlace: async (v, u, presenca, regiao) => {
        regioes.push(regiao || regiaoAgora);
        regiaoAgora = 'na';                       // a pessoa trocou a região em Filtros e aplicou
        return { success: true };
      },
    },
    registrarPouso: () => {}, recordHistory: () => {}, registrarRejeicaoDeAutor: () => {}, registrarAcaoConfirmada: () => {},
    marcarEmAndamento: () => {}, enfileirarSaida: () => true, handleUnauthorized: () => {},
    updateInFlightIndicator: () => {}, updateStats: () => {}, saveStats: () => {}, mostrarResultadoDoLote: () => {},
    pedidosQueEntraramNaFila: new Set(), showCurrentPlace: () => {},
  };
  const chaves = Object.keys(deps);
  const recusar = new Function(...chaves, 'let recusaAutomaticaRodando = false; let recusaAutomaticaPedidaDeNovo = false;\n' + fatiar('enviarLote') + '\n'
    + fatiar('aplicarRecusaAutomatica') + '\nreturn aplicarRecusaAutomatica;')(...chaves.map((k) => deps[k]));
  await recusar();
  assert.deepEqual(regioes, ['row', 'row', 'row'],
    `a recusa mandou pedidos do servidor ROW pra ${regioes.join(', ')}: "não encontrado" lá conta como feito, e o pedido fica pendente`);
});

// ═══ Auditoria de 2026-09-29: a DECISÃO do lote não some nem é contada sem ir ══
// Cada teste foi visto REPROVANDO com o conserto desfeito (sabotagem registrada
// no relatório da rodada).

// ── O2: o "Rejeitar os N" vai INTEIRO pra fila de saída antes do 1º envio ──────
// O placar conta os N no gesto; fechar o app no meio do laço deixava os que não
// saíram em lugar nenhum — de volta como card na reabertura e contados de novo
// (medido no navegador, f5b: placar 5 com 3 enviados e v4/v5 de volta).
test('O2: o lote da pessoa é anotado INTEIRO na fila de saída antes do 1º envio — e cada resposta tira o seu', async () => {
  const alvos = [pedido(1), pedido(2), pedido(3)];
  let noMeio = null;
  let gravouAntes = null;
  const m = montarLote({ resposta: (p, n) => {
    if (n === 1) gravouAntes = m.gravacoes();
    if (n === 2) noMeio = m.naSaida.map((x) => x.venueID);
    return { success: true };
  } });
  await m.enviarLote(alvos, {});
  assert.deepEqual(noMeio, ['v2', 'v3'],
    'com o 2º no ar, o que ainda não pousou não está na fila de saída: morta a página, some com o placar já contado');
  // UMA gravação pro lote inteiro: o `setItem` é síncrono, e gravar a fila a
  // cada pedido travava a tela (MEDIDO: 79 ms no "Rejeitar os 200").
  assert.equal(gravouAntes, 1, `a anotação do lote gravou a fila de saída ${gravouAntes}× antes do 1º envio (uma por pedido)`);
  assert.deepEqual(m.naSaida, [], 'o que pousou ficou anotado pra sair de novo');
  assert.ok(!m.log.includes('diario:saida.abriu'), 'a anotação de antes do envio virou "a fila abriu" no diário');
});

test('O2: sem rede, os do lote FICAM na fila de saída (a abertura vai pro diário uma vez) e contam como "esperando envio"', async () => {
  const alvos = [pedido(1), pedido(2)];
  const m = montarLote({ resposta: () => ({ success: false, errorCategory: 'transient' }) });
  m.AppState.stats.rejected = 2;
  await m.enviarLote(alvos, {});
  assert.deepEqual(m.naSaida.map((x) => x.venueID), ['v1', 'v2']);
  assert.equal(m.AppState.stats.rejected, 2, 'o placar do trabalho que segue guardado desceu');
  assert.equal(m.log.filter((l) => l === 'diario:saida.abriu').length, 1);
});

test('O2: CONTROLE — a recusa automática NÃO anota antes (lá o placar anda com o envio)', async () => {
  const alvos = [pedido(1), pedido(2)];
  let noMeio = null;
  const m = montarLote({ resposta: (p, n) => { if (n === 2) noMeio = m.naSaida.length; return { success: true }; } });
  await m.enviarLote(alvos, { silencioso: true, contarAoLandar: true });
  assert.equal(noMeio, 0, 'a recusa automática anotou na fila de saída: o pouso de lá não soma o placar, e a ação não contaria');
});

test('O2: o pedido do lote cuja decisão JÁ esperava na fila de saída não sai nem conta (vale a primeira)', async () => {
  const alvos = [pedido(1), pedido(2)];
  const m = montarLote({ saida: [{ tipo: 'read', venueID: 'v2', updateRequestID: 'u2' }] });
  m.AppState.stats.rejected = 2;                    // o gesto contou os dois
  await m.enviarLote(alvos, {});
  assert.deepEqual(m.regioes.length, 1, 'a segunda decisão do mesmo pedido saiu pro Waze');
  assert.equal(m.AppState.stats.rejected, 1, 'o pedido repetido contou no placar');
  assert.deepEqual(m.naSaida.map((x) => x.tipo), ['read'], 'a primeira decisão saiu da fila');
});

// ── C5: o que o Waze recusa no lote volta como o PRÓXIMO card ─────────────────
// Ia pro FIM da fila, e a pilha seguia anunciando outro pedido — o ✕ de um card
// só já devolve como o próximo (`devolverPedidoRecusado`); medido no navegador:
// fila [Y1, Y2, X1] com o fundo em Y2 (t2-lote).
test('C5: no "Rejeitar os N", o recusado volta como o PRÓXIMO card, em ordem, e a pilha passa a anunciá-lo', async () => {
  const frente = pedido(9, 1);
  const m = montarLote({ fila: [frente, pedido(8, 1)], naTela: frente,
    resposta: (p) => (p.venueID === 'v1' || p.venueID === 'v3' ? RECUSA : { success: true }) });
  await m.enviarLote([pedido(1), pedido(2), pedido(3)], {});
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v9', 'v1', 'v3', 'v8'],
    'o que o Waze recusou foi pro fim da fila (ou voltou fora de ordem), e não como o próximo card');
  assert.equal(m.AppState.currentPlace.venueID, 'v9', 'trocou o card que estava na tela');
  assert.equal(m.AppState.serverTotal, 4, 'o "Restam" não acompanha os que voltaram');
  assert.ok(m.log.includes('fundo:v1'), `a pilha não foi refeita com o que voltou (${m.log.join(' ')})`);
});

// ── V9: ↻ com o "Rejeitar os N" no ar e o Waze recusando ──────────────────────
// A fila nova veio sem eles (estavam em andamento), e o que falhava só marcava
// "pode haver mais", sem buscar: "Tudo limpo!" com os pedidos pendentes
// (medido no navegador, s13).
test('V9: ↻ no meio do lote e o Waze recusa — com a tela vazia, a busca SAI na hora pra trazê-los', async () => {
  const alvos = [pedido(1), pedido(2)];
  const m = montarLote({ entraram: alvos,
    antes: (p, n) => { if (n === 1) { m.AppState.fetchEpoch++; m.AppState.queue = []; m.AppState.currentPlace = null; m.AppState.serverTotal = 0; } },
    resposta: () => RECUSA });
  await m.enviarLote(alvos, {});
  assert.deepEqual(m.AppState.queue, [], 'o pedido do lote entrou na fila nova (de outro filtro)');
  assert.equal(m.AppState.hasMore, true);
  assert.ok(m.log.includes('busca'), 'com a tela vazia ninguém busca: "Tudo limpo!" com os pedidos pendentes');
  assert.ok(!m.deps.pedidosQueEntraramNaFila.has('v1|u1'), 'o recusado "já passou pela fila": a busca nunca o traz');
});

test('V9: CONTROLE — ↻ no meio com card na fila nova: o card segue, e a busca fica pra quando a fila acabar', async () => {
  const alvos = [pedido(1)];
  const nova = pedido(5, 1);
  const m = montarLote({ entraram: alvos,
    antes: () => { m.AppState.fetchEpoch++; m.AppState.queue = [nova]; m.AppState.currentPlace = nova; m.AppState.serverTotal = 1; },
    resposta: () => RECUSA });
  await m.enviarLote(alvos, {});
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v5']);
  assert.ok(!m.log.includes('busca'), 'buscou com card na tela');
  assert.equal(m.AppState.hasMore, true);
});

// ── V9: a aprovação que o Waze recusa depois de um ↻ ───────────────────────────
function montarAprovacaoRecusada({ resposta = RECUSA } = {}) {
  const log = [];
  const P = pedido(1, 5);
  const AppState = { fetchEpoch: 0, queue: [P, pedido(2, 5)], currentPlace: P, hasMore: false, serverTotal: 2 };
  const deps = {
    AppState, epocaDaSessao: 0, callWithRetry: (fn) => fn(), API: { aprovarPedido: async () => resposta },
    Lightbox: { desmarcarAprovada: () => log.push('desmarcou') }, showToast: () => log.push('toast'), msgDoServidor: () => '',
    t: (k) => k, marcarEmAndamento: () => {}, concluirAprovacao: () => log.push('concluiu'), contarConquista: () => {},
    refazerDepoisDo401: async () => null, chaveDoPedido: chave, pedidosQueEntraramNaFila: new Set([chave(P)]),
    updatePendingCount: () => {}, aoMudarAFilaPorBaixo: () => log.push('fundo'),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; log.push('card'); },
    startFetching: () => log.push('busca'),
    aprovacoesNoAr: new Set(), aplicarTravaDeAcao: () => {}, refazerSelosSeOutroNaTela: () => {},
  };
  const chaves = Object.keys(deps);
  const enviar = new Function(...chaves, fatiar('enviarAprovacao') + '\n' + fatiar('voltarDaAprovacaoRecusada') + '\n'
    + fatiar('devolverPedidoRecusado') + '\nreturn enviarAprovacao;')(...chaves.map((k) => deps[k]));
  return { enviar: () => enviar({ id: P.updateRequestID, place: P, idx: 0, epocaFila: 0 }), AppState, log, deps, P };
}

test('V9: aprovação recusada depois de um ↻ (a fila nova veio sem o pedido) — a busca o traz de volta', async () => {
  const m = montarAprovacaoRecusada();
  m.AppState.fetchEpoch++;                           // o ↻ com a aprovação no ar
  m.AppState.queue = [];
  m.AppState.currentPlace = null;
  assert.equal(await m.enviar(), false);
  assert.equal(m.AppState.hasMore, true, 'a fila diz que acabou: o pedido pendente nunca mais volta');
  assert.ok(!m.deps.pedidosQueEntraramNaFila.has(chave(m.P)), 'o pedido "já passou pela fila": nenhuma busca o traz');
  assert.ok(m.log.includes('busca'), 'com a tela vazia ninguém busca: "Tudo limpo!" com ele pendente');
});

test('V9: CONTROLE — na MESMA fila a aprovação recusada não mexe na fila (o card nunca saiu dela), nem devolve o que outro gesto tirou', async () => {
  const m = montarAprovacaoRecusada();
  assert.equal(await m.enviar(), false);
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v1', 'v2']);
  assert.equal(m.AppState.hasMore, false);
  assert.ok(!m.log.includes('busca'));
  // Outro gesto (o ✕ do card) decidiu o pedido com a aprovação no ar: devolvê-lo seria uma 2ª decisão.
  const x = montarAprovacaoRecusada();
  x.AppState.queue = [pedido(2, 5)];
  x.AppState.currentPlace = x.AppState.queue[0];
  await x.enviar();
  assert.deepEqual(x.AppState.queue.map((p) => p.venueID), ['v2'], 'o pedido que outro gesto decidiu voltou como card');
});

// ── V4: a recusa automática que chega com ela rodando não evapora ─────────────
// "Mais antigos" e "Perto de…" leem todas as páginas numa rajada: a 2ª página
// chegava com a recusa da 1ª no ar, e os pedidos dela ficavam como card
// (medido no navegador: 5 rejeitados de 8, u101-u103 na fila; s5, t18).
function montarRecusa() {
  const frente = pedido(9, 1);
  const AppState = { queue: [frente, pedido(1), pedido(2)], currentPlace: frente, stats: { rejected: 0 }, serverTotal: 3,
    fetchEpoch: 0, hasMore: false, inFlightActions: 0, authenticated: true };
  const enviados = [];
  const portoes = [];
  const deps = {
    AppState, podeRecusarAutomaticoAqui: () => true, contaConfirmada: () => true, Treino: { ativo: false },
    autoLigado: (id) => id === 777, updatePendingCount: () => {}, aoMudarAFilaPorBaixo: () => {},
    showToast: () => ({ texto() {}, dispensar() {} }), t: (k) => k,
    pedidosEmAndamento: new Set(), chaveDoPedido: chave, epocaDaSessao: 0, callWithRetry: (fn) => fn(),
    API: { getRegion: () => 'row',
      rejectPlace: (v) => new Promise((ok) => { enviados.push(v); portoes.push(() => ok({ success: true })); }) },
    registrarPouso: () => {}, recordHistory: () => {}, registrarRejeicaoDeAutor: () => {}, registrarAcaoConfirmada: () => {},
    marcarEmAndamento: () => {}, enfileirarSaida: () => true, handleUnauthorized: () => {},
    updateInFlightIndicator: () => {}, updateStats: () => {}, saveStats: () => {}, mostrarResultadoDoLote: () => {},
    pedidosQueEntraramNaFila: new Set(), showCurrentPlace: () => {}, devolverPedidoRecusado: () => {},
  };
  const chaves = Object.keys(deps);
  const recusar = new Function(...chaves, 'let recusaAutomaticaRodando = false; let recusaAutomaticaPedidaDeNovo = false;\n'
    + fatiar('enviarLote') + '\n' + fatiar('aplicarRecusaAutomatica') + '\nreturn aplicarRecusaAutomatica;')(...chaves.map((k) => deps[k]));
  // Solta TODAS as respostas até não sobrar nenhuma no ar (as da 2ª passada inclusive).
  const soltarTudo = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 0));
      while (portoes.length) portoes.shift()();
    }
  };
  return { recusar, AppState, enviados, soltarTudo };
}

test('V4: a página que chega com a recusa no ar é atendida quando ela termina — nada do autor fica como card', async () => {
  const m = montarRecusa();
  const primeira = m.recusar();                      // a 1ª página: v1 e v2 do autor marcado
  await new Promise((r) => setTimeout(r, 0));
  m.AppState.queue.push(pedido(3), pedido(4));       // a 2ª página pousa com a recusa no ar…
  m.recusar();                                       // …e chama a recusa de novo (o `fetchNextPage` faz isto)
  await m.soltarTudo();
  await primeira;
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v9'],
    `o que chegou com a recusa no ar ficou como card: ${m.AppState.queue.map((p) => p.venueID).join(',')}`);
  assert.deepEqual(m.enviados.sort(), ['v1', 'v2', 'v3', 'v4']);
});

test('V4: CONTROLE — sem nada chegando no meio, a recusa roda UMA vez (não vira laço)', async () => {
  const m = montarRecusa();
  const p = m.recusar();
  await m.soltarTudo();
  await p;
  assert.deepEqual(m.enviados.sort(), ['v1', 'v2'], 'a recusa rodou de novo sem ninguém pedir');
});

// ── L21: "Rejeitar os N" rejeita só os N que a folha contou ────────────────────
// A folha contava ao ABRIR e o toque recontava: a busca que pousava com ela
// aberta trazia mais pedidos do autor, e saíam junto ("Rejeitar os 2", saíram
// 4 — medido no navegador, e5/t10). A régua é a do "Marcar todos".
function montarFolhaDoAutor({ emAndamento = [] } = {}) {
  const agendadas = [];
  const X1 = pedido(1);
  const AppState = { authenticated: true, queue: [X1, pedido(5, 1), pedido(2)], currentPlace: X1, stats: { rejected: 0 },
    serverTotal: 3, hasMore: false };
  const deps = {
    // O pedido EM ANDAMENTO (a aprovação de foto no ar) fica fora da série (R5-2-02).
    pedidosEmAndamento: new Set(emAndamento),
    AppState, acoesTravadas: () => false, avisoDaTrava: () => 'x', Treino: { ativo: false }, showToast: () => {}, t: (k) => k,
    chaveDoPedido: chave, updateStats: () => {}, saveStats: () => {}, updatePendingCount: () => {},
    removeCurrentCardEl: () => {}, showCurrentPlace: () => {}, maybePrefetch: () => {}, startFetching: () => {}, showNoPlaces: () => {},
    API: { getRegion: () => 'row' }, scheduleAction: (tipo, places) => agendadas.push(places.map((p) => p.venueID)), enviarLote: () => {},
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, 'let tratouNestaFila = false;\n' + fatiar('pedidosDoAutorNaFila') + '\n'
    + fatiar('rejeitarLoteDoAutor') + '\nreturn { rejeitarLoteDoAutor, pedidosDoAutorNaFila };')(...chaves.map((k) => deps[k]));
  return { app, AppState, agendadas, X1 };
}

test('L21: a busca pousa com a folha aberta e traz mais do autor — o toque rejeita SÓ os que a folha contou', async () => {
  const m = montarFolhaDoAutor();
  const contados = m.app.pedidosDoAutorNaFila(m.X1).map(chave);          // a folha abre: "Rejeitar os 2"
  assert.equal(contados.length, 2);
  m.AppState.queue.push(pedido(3), pedido(4));                          // a página chega com a folha aberta
  m.app.rejeitarLoteDoAutor(m.X1, contados);
  assert.deepEqual(m.agendadas, [['v1', 'v2']], 'saíram pedidos que a folha não contou — o botão dizia 2');
  assert.equal(m.AppState.stats.rejected, 2);
  assert.deepEqual(m.AppState.queue.map((p) => p.venueID), ['v5', 'v3', 'v4'], 'os que chegaram depois sumiram da fila');
});

test('L21: o contado que saiu da fila no meio não volta a sair; CONTROLE: sem a lista, é a fila inteira (o instrumento distingue)', async () => {
  const m = montarFolhaDoAutor();
  const contados = m.app.pedidosDoAutorNaFila(m.X1).map(chave);
  m.AppState.queue = m.AppState.queue.filter((p) => p.venueID !== 'v2');   // outra decisão levou o v2
  m.app.rejeitarLoteDoAutor(m.X1, contados);
  assert.deepEqual(m.agendadas, [['v1']]);
  const c = montarFolhaDoAutor();
  c.AppState.queue.push(pedido(3));
  c.app.rejeitarLoteDoAutor(c.X1);
  assert.deepEqual(c.agendadas, [['v1', 'v2', 'v3']]);
});

test('L21: a folha entrega ao toque as chaves que ela contou ao ABRIR', () => {
  const f = fatiar('abrirFolhaDoAutor');
  assert.match(f, /const naFila = pedidosDoAutorNaFila\(place\);/);
  assert.match(f, /const contados = naFila\.map\(chaveDoPedido\);\s*document\.getElementById\('autorRejeitar'\)\.addEventListener\('click', \(\) => \{\s*closeModal\('autorModal'\);\s*rejeitarLoteDoAutor\(place, contados\);/,
    'o toque voltou a recontar a fila: o que chegou com a folha aberta sai junto');
});

// ── R5-2-02: "Rejeitar os N" leva junto o pedido com a aprovação de foto NO AR ──
// O A1 trava o card DA TELA; o pedido aprovado que está na fila sem estar na
// frente (o Desfazer de um ✕ devolveu A pra frente com a foto de B aberta) era
// contado pela folha e rejeitado pelo lote — MEDIDO no navegador (s06): a foto que
// a pessoa APROVOU saía rejeitada no Waze, com "Restam 0" e um card na tela.
test('R5-2-02: o pedido com a aprovação NO AR fica fora da folha e do lote — e do "Ver +N"', async () => {
  const m = montarFolhaDoAutor({ emAndamento: ['v2|u2'] });
  const contados = m.app.pedidosDoAutorNaFila(m.X1).map(chave);
  assert.deepEqual(contados, ['v1|u1'], 'a folha contou o pedido cuja aprovação está no ar ("Rejeitar os 2")');
  m.app.rejeitarLoteDoAutor(m.X1, contados);
  assert.deepEqual(m.agendadas, [['v1']], 'o lote levou o pedido que está sendo aprovado — duas decisões opostas');
  // A folha aberta ANTES de a aprovação sair contou os dois; o toque leva só o que segue decidível.
  const d = montarFolhaDoAutor();
  const antes = d.app.pedidosDoAutorNaFila(d.X1).map(chave);
  assert.deepEqual(antes, ['v1|u1', 'v2|u2'], 'PRÉ-CONDIÇÃO: sem nada em andamento, a folha conta os dois');
  const m2 = montarFolhaDoAutor({ emAndamento: ['v2|u2'] });
  m2.app.rejeitarLoteDoAutor(m2.X1, antes);
  assert.deepEqual(m2.agendadas, [['v1']], 'a aprovação saiu com a folha aberta, e o toque rejeitou o pedido aprovado');
  // CONTROLE: sem nada em andamento, o lote leva os dois (o instrumento distingue).
  d.app.rejeitarLoteDoAutor(d.X1, antes);
  assert.deepEqual(d.agendadas, [['v1', 'v2']]);
});

test('R5-2-02: o "Ver +N" conta pela MESMA régua da folha (o `pedidosDoAutorNaFila`)', () => {
  const sem = APP_SEM.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const i = sem.indexOf('function renderSelosDeProcedencia(');
  const corpo = sem.slice(i, sem.indexOf('\nfunction ', i + 10));
  assert.match(corpo, /const mesmos = pedidosDoAutorNaFila\(place\)\.filter\(\(x\) => x !== place\)\.length;/,
    'o "Ver +N" voltou a contar por conta própria: mostra um número que a folha e o lote não seguem');
});

test('R5-2-02: o selo do card da frente é refeito quando OUTRO pedido entra ou sai de "em andamento"', () => {
  const log = [];
  const A = pedido(1), B = pedido(2);
  const AppState = { currentPlace: A };
  const refazer = new Function('AppState', 'aoMudarAFilaPorBaixo', fatiar('refazerSelosSeOutroNaTela') + '\nreturn refazerSelosSeOutroNaTela;')(
    AppState, () => log.push('selos'));
  refazer(B);
  assert.deepEqual(log, ['selos'], 'a aprovação de B mudou o que o "Ver +N" de A conta, e o selo não foi refeito');
  refazer(A);
  assert.deepEqual(log, ['selos'], 'CONTROLE: com o próprio pedido na tela (travado pela aprovação) não há selo de outro a refazer');
  // Os TRÊS momentos em que o pedido entra ou sai de "em andamento": o gesto, o
  // Desfazer e o fim do envio. Colado na marca, nunca por presença (gotcha #67).
  const ap = fatiar('aprovarFotoAtual');
  assert.match(ap, /marcarEmAndamento\(place, true\);\s*refazerSelosSeOutroNaTela\(place\);/,
    'o gesto da aprovação deixou de refazer o selo do card da frente');
  assert.match(ap, /marcarEmAndamento\(place, false\);\s*refazerSelosSeOutroNaTela\(place\);/,
    'o Desfazer da aprovação deixou de refazer o selo do card da frente');
  assert.match(fatiar('enviarAprovacao'), /marcarEmAndamento\(alvo\.place, false\);\s*refazerSelosSeOutroNaTela\(alvo\.place\);/,
    'o fim do envio da aprovação deixou de refazer o selo do card da frente');
});
