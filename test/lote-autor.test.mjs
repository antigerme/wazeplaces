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
function montarLote({ fila = [], naTela = null, resposta = () => ({ success: true }), antes = () => {}, entraram = [] } = {}) {
  const log = [];
  const regioes = [];
  const AppState = { stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: fila.length, queue: fila.slice(),
    currentPlace: naTela, fetchEpoch: 0, hasMore: false, inFlightActions: 0, authenticated: true };
  let n = 0;
  const deps = {
    AppState, epocaDaSessao: 0, callWithRetry: (fn) => fn(),
    API: { getRegion: () => 'row',
      rejectPlace: async (v, u, presenca, regiao) => { const p = { venueID: v, updateRequestID: u }; regioes.push(regiao); n++; antes(p, n); return resposta(p, n); } },
    registrarPouso: () => {}, recordHistory: () => {}, registrarRejeicaoDeAutor: () => {}, registrarAcaoConfirmada: () => {},
    marcarEmAndamento: () => {}, enfileirarSaida: () => true, handleUnauthorized: () => {},
    updateInFlightIndicator: () => {}, updateStats: () => {}, saveStats: () => {}, updatePendingCount: () => {},
    mostrarResultadoDoLote: () => log.push('folha'), chaveDoPedido: chave,
    pedidosQueEntraramNaFila: new Set([...fila, ...entraram].map(chave)),
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; log.push('card'); },
    Treino: { ativo: false },
  };
  const chaves = Object.keys(deps);
  const enviarLote = new Function(...chaves, fatiar('enviarLote') + '\nreturn enviarLote;')(...chaves.map((k) => deps[k]));
  return { enviarLote, AppState, log, regioes, deps };
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
  };
  const chaves = Object.keys(deps);
  const concluir = new Function(...chaves, 'let placeResolvidoPorAprovacao = null; let tratouNestaFila = false;\n'
    + fatiar('concluirAprovacao') + '\nreturn concluirAprovacao;')(...chaves.map((k) => deps[k]));
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
    enviarAprovacao: async (alvo) => { alvoEnviado = alvo; return true; },
    aplicarTravaDeAcao: () => {}, removeUndoBanner: () => {}, mostrarDesfazer: () => {}, t: (k) => k,
    registrarDesfazer: () => {}, UNDO_WINDOW_MS: 3000,
    // Do lightbox (L3, o foco, o "em andamento" da aprovação).
    fotoDoLightboxNaTela: () => true, marcarEmAndamento: () => {}, manterFocoNoLightbox: () => {},
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
  };
  const chaves = Object.keys(deps);
  app = new Function(...chaves, 'let placeResolvidoPorAprovacao = null; let tratouNestaFila = false;\n'
    + fatiar('concluirAprovacao') + '\n' + fatiar('avancarSeAprovado')
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
function montarFolhaDoAutor() {
  const agendadas = [];
  const X1 = pedido(1);
  const AppState = { authenticated: true, queue: [X1, pedido(5, 1), pedido(2)], currentPlace: X1, stats: { rejected: 0 },
    serverTotal: 3, hasMore: false };
  const deps = {
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
