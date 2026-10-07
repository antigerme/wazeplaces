// A FILA REAL com o treino aberto (auditoria de 2026-10-03, rodada 8).
//
// O treino troca a fila da tela pela de EXEMPLOS e guarda a real
// (`Treino._salvo.queue`) até o `sair()`. Quem perguntava pela fila de VERDADE
// olhava a da tela — os exemplos —, e cada um errava de um jeito (MEDIDO no
// navegador pelos auditores, cada um com o controle sem o treino):
//   R8-3-02 = R8-7-02 — a escrita da foto que a queda da sessão pegou no ar
//             (`pedidoAindaNaTela`): a que POUSOU não chegava ao pedido nem ao
//             irmão, e a que NÃO chegou ao Waze não voltava na tela nem avisava;
//   R8-4-02 — a decisão da OUTRA aba (`anotarDecididosPorOutraAba`) não era
//             anotada na fila guardada, e ao sair do treino a sentinela acusava
//             "voltou como card";
//   R8-4-04 — a reabertura SEM REDE com o treino aberto durante a leitura da fila
//             guardada (`offlineTentarAbrirSemRede`) punha os pedidos REAIS como
//             cards do treino, e o "Sair" dele devolvia a fila vazia;
//   R8-4-05 — a linha do "Disponível offline" contava os exemplos;
//   R8-7-03 = R8-2-03 — a 2ª passada da recusa automática, pedida por uma página
//             que pousou com a 1ª no ar, se perdia se a 1ª terminava no treino.
// A raiz é uma só, e o conserto também: `filaReal()` responde "a fila real" (a
// guardada pelo treino, com ele aberto; senão a da tela), e o que só pode
// acontecer na fila real fica ANOTADO no treino pro `sair()`.
//
// Os testes RODAM o código de verdade — o objeto `Treino` e as funções, fatiados
// do app.js — num escopo só, com a tela de mentira. Cada um tem o CONTROLE sem o
// treino (o mesmo resultado, que valida o instrumento), e foi visto REPROVANDO
// com o conserto desfeito (sabotagem no relatório do lote 12).
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
  assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}
function objetoDoTreino() {
  const i = APP_SEM.indexOf('const Treino = {');
  assert.ok(i >= 0, 'o objeto Treino sumiu');
  return APP_SEM.slice(i + 'const Treino = '.length, fechar(APP_SEM, i));
}
// Um MÉTODO do objeto `Lightbox`, como texto de método (`nome(args) { … }`).
function metodoDoLightbox(nome) {
  const ini = APP_SEM.indexOf('const Lightbox = {');
  const fim = fechar(APP_SEM, ini);
  const m = new RegExp('^    ' + nome + '\\(', 'm').exec(APP_SEM.slice(ini, fim));
  assert.ok(m, `Lightbox.${nome} sumiu`);
  const i = ini + m.index;
  let par = 0, k = APP_SEM.indexOf('(', i);
  for (let j = k; j < fim; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { k = j + 1; break; } }
  }
  return APP_SEM.slice(i, fechar(APP_SEM, k)).trim();
}

const tique = () => new Promise((ok) => setImmediate(ok));
const P = (id, autor = 1000) => ({ venueID: 'v' + id, updateRequestID: 'u' + id, name: 'Local ' + id,
  creatorId: autor, createdBy: 'autor' + autor, updateTypeKey: 'VENUE', imageUrls: [],
  dateAdded: 1785203731191 - Number(String(id).replace(/\D/g, '') || 0) * 1000, mapa: { centro: [-10, -40] } });
const ids = (fila) => (fila || []).map((p) => p.updateRequestID);
const soExemplos = (fila) => (fila || []).length > 0 && fila.every((p) => p._treino === true || !!p._exemplo);

function elemento() {
  const classes = new Set();
  return { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
    toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)), replace: (a, b) => { if (classes.delete(a)) classes.add(b); } },
  textContent: '', innerHTML: '', removeAttribute() {}, setAttribute() {}, children: [] };
}

// O que o `Treino` de verdade usa da tela e da fila: de mentira, salvo o que cada
// teste traz de verdade (`extra`).
function depsDoTreino(AppState, log, els, extra = {}) {
  return {
    AppState, document: { getElementById: (id) => (els[id] = els[id] || elemento()) },
    removeUndoBanner: () => {}, savePreferences: () => {}, showLoading: (v) => log.push('carregando:' + v),
    updateStats: () => {}, updatePendingCount: () => {},
    showCurrentPlace: () => log.push('card:' + ((AppState.queue[0] || {}).updateRequestID || '-')),
    fecharCamadasDeFoto: () => {}, removeCurrentCardEl: () => {}, maybePrefetch: () => {},
    startFetching: () => log.push('busca'), showNoPlaces: () => log.push('vazio'),
    t: (k, v) => (v ? k + JSON.stringify(v) : k), openModal: () => {}, trocarTextoI18n: () => {}, semJanelaDeDesfazer: () => false,
    loteDeLidosEmVoo: false, aprovacaoPendente: null, aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map(),
    enviarPendenciasDoLightbox: () => {},
    // o que o `sair()` chama e não é deste arquivo
    limparFocoAutor: () => {}, sortQueue: () => {}, aplicarRecusaAutomatica: () => log.push('recusa'),
    devolverPedidoRecusado: (lista) => { AppState.queue.splice(1, 0, ...(Array.isArray(lista) ? lista : [lista])); },
    ordemPrecisaDaFilaInteira: () => false, buscarORestoDaFila: () => {},
    ...extra,
  };
}
function montar(deps, nomes, extraFonte = '', retorno = '') {
  const chaves = Object.keys(deps);
  const fonte = [extraFonte, ...nomes.map(fatiar), 'const Treino = ' + objetoDoTreino() + ';',
    `return { Treino, ${[...nomes, retorno].filter(Boolean).join(', ')} };`].join('\n');
  return new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
}

// ═══ R8-3-02 = R8-7-02 · a escrita da foto que a QUEDA pegou, com o treino aberto ═══
// A exclusão (ou a renomeação) sai, a pessoa entra no treino ("Praticar" despacha a
// janela do Desfazer, ou a escrita sem janela ainda está no ar) e a sessão cai e
// volta com a MESMA conta — a fila real atravessa a queda, guardada no treino.
//   · POUSOU (a resposta chega com a época nova): vai ao pedido e ao IRMÃO do
//     local (`aplicarNosIrmaos`), só "com o pedido na tela" (`pedidoAindaNaTela`);
//   · NÃO pousou (o 401 dela, e a conferência derruba a sessão): a tela VOLTA e o
//     aviso sai (`escritaDoLightboxSemSessao`), só "com o pedido na tela".
// Com o treino aberto, "na tela" olhava os exemplos: nada chegava, nada voltava.
const FOTO = (id) => `https://venue-image.waze.com/thumbs/thumb700_${id}.jpg`;
function montarEscritaNaQueda() {
  const log = [];
  const toasts = [];
  const els = {};
  const local = (ur) => ({ venueID: 'v1', updateRequestID: ur, name: 'Padaria Velha', updateTypeKey: 'UPDATE_DETAILS',
    imageUrls: [FOTO('f1'), FOTO('f2')], approvedImageIds: ['f1', 'f2'], creatorId: 7, createdBy: 'autor7' });
  const A = local('ur-A');
  const B = local('ur-B');                                   // o IRMÃO: o mesmo local, mais adiante na fila
  const C = { ...P(3), imageUrls: [FOTO('f1')], approvedImageIds: ['f1'] };
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: [A, B, C], currentPlace: A, stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 3, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true } };
  let responder = null;
  const ida = () => new Promise((ok) => { responder = ok; });
  // A foto ampliada FECHADA (o `Treino.entrar` a fecha): o `removerFoto` de
  // verdade só mexe no pedido.
  const Lightbox = new Function(`return { place: null, urls: [], idx: 0, newIdx: -1, isOpen() { return false; },
    close() {}, _render() {}, recolocarFoto() {}, ${metodoDoLightbox('removerFoto')} };`)();
  let app = null;
  const deps = depsDoTreino(AppState, log, els, {
    Lightbox, navigator: { onLine: true }, callWithRetry: (fn) => fn(),
    API: { excluirFoto: ida, renomearLocal: ida },
    // A conferência do 401: a sonda diz que a sessão MORREU, e a extensão a renova
    // com a mesma conta (a fila fica) — a escrita é de uma sessão que acabou.
    handleUnauthorized: async () => { log.push('confere'); app.setEpoca(1); },
    sessaoVivaDepoisDe: () => false,
    showToast: (m, tipo) => toasts.push(tipo + ':' + m), msgDoServidor: () => '',
    montarCardDeFundo: () => {}, cardDaFrente: () => null, mantendoFocoNoCard: (f) => f(), contarConquista: () => {},
    renomeacoesNoAr: new Set(), aplicarTravaDeAcao: () => {}, idasSemRespostaGuardadas: new Map(), IDAS_SEM_RESPOSTA_TETO: 50,
  });
  app = montar(deps, ['filaReal', 'filaRealComDevolvidos', 'pedidoAindaNaTela', 'escritaDoLightboxSemSessao', 'aplicarNosIrmaos', 'devolverFoto',
    'enviarExclusao', 'enviarRenomeacao', 'refazerDepoisDo401', 'contarIdasSemResposta', 'idasSemRespostaDeAntes',
    'lembrarIdasSemResposta', 'nomeDestaEscrita', 'devolverNome', 'aplicarNomeNaTela'],
  'let epocaDaSessao = 0, escritasConferindo = 0, verificandoSessao = false, conferenciaDaSessao = null;',
  'setEpoca: (v) => { epocaDaSessao = v; }');
  return { app, A, B, C, AppState, log, toasts, Lightbox, responder: (r) => responder(r) };
}

async function escritaNaQueda({ comTreino, escrita, pousa }) {
  const m = montarEscritaNaQueda();
  let envio;
  if (escrita === 'excluir') {
    // Com o Desfazer, a foto sai da tela no gesto (e a janela despachada é a que
    // não pousa); sem ele, só quando o Waze confirma (`pedirExclusaoDaFoto`).
    if (!pousa) m.Lightbox.removerFoto('f1', m.A);
    envio = m.app.enviarExclusao({ id: 'f1', place: m.A, idx: 0, url: FOTO('f1'), regiao: 'row' });
  } else {
    m.app.aplicarNomeNaTela(m.A, 'Padaria Nova');          // o nome novo na tela (`confirmarRenomear`)
    envio = m.app.enviarRenomeacao({ place: m.A, novo: 'Padaria Nova', antigo: 'Padaria Velha', regiao: 'row' });
  }
  // "Praticar": a escrita está no ar.
  if (comTreino) m.app.Treino.entrar();
  await tique();
  if (pousa) {
    m.app.setEpoca(1);                                     // a sessão caiu e voltou (a mesma conta)
    m.responder({ success: true });                        // e a resposta chega DEPOIS
  } else {
    m.responder({ success: false, errorCategory: 'unauthorized', httpCode: 401 });
  }
  const saiu = await envio;
  // Sem o Desfazer, quem tira a foto do pedido é quem esperou a resposta (o
  // `.then` do `pedirExclusaoDaFoto`), com `true`.
  if (escrita === 'excluir' && pousa && saiu === true) m.Lightbox.removerFoto('f1', m.A);
  const noTreino = comTreino ? { ativo: m.app.Treino.ativo, exemplos: soExemplos(m.AppState.queue) } : null;
  if (comTreino) m.app.Treino.sair();
  const fotos = (p) => p.imageUrls.map((u) => u.split('thumb700_')[1].replace('.jpg', ''));
  return { saiu, fila: ids(m.AppState.queue), A: fotos(m.A), B: fotos(m.B), C: fotos(m.C), nomeA: m.A.name, nomeB: m.B.name,
    toasts: m.toasts, confere: m.log.includes('confere'), noTreino };
}

for (const caso of [
  { escrita: 'excluir', pousa: true, esperado: { saiu: true, A: ['f2'], B: ['f2'], nomeA: 'Padaria Velha', nomeB: 'Padaria Velha', toasts: [] } },
  { escrita: 'renomear', pousa: true, esperado: { saiu: true, A: ['f1', 'f2'], B: ['f1', 'f2'], nomeA: 'Padaria Nova', nomeB: 'Padaria Nova', toasts: [] } },
  { escrita: 'excluir', pousa: false,
    esperado: { saiu: false, A: ['f1', 'f2'], B: ['f1', 'f2'], nomeA: 'Padaria Velha', nomeB: 'Padaria Velha', toasts: ['error:toast.photoDeleteFailed'] } },
  { escrita: 'renomear', pousa: false,
    esperado: { saiu: false, A: ['f1', 'f2'], B: ['f1', 'f2'], nomeA: 'Padaria Velha', nomeB: 'Padaria Velha', toasts: ['error:toast.renameFailed'] } },
]) {
  const rotulo = `${caso.escrita} que ${caso.pousa ? 'POUSOU depois da queda chega ao pedido e ao IRMÃO' : 'NÃO chegou ao Waze volta na tela e AVISA'}`;
  test(`R8-3-02: com o treino aberto, a escrita da foto (${rotulo}) — a fila real, guardada no treino, é a régua`, async () => {
    const corte = (r) => ({ saiu: r.saiu, A: r.A, B: r.B, nomeA: r.nomeA, nomeB: r.nomeB, toasts: r.toasts });
    const controle = await escritaNaQueda({ ...caso, comTreino: false });
    // PRÉ-CONDIÇÃO: a que não pousou passou pela conferência do 401 (que derrubou
    // a sessão); a que pousou, não.
    assert.equal(controle.confere, !caso.pousa, 'PRÉ-CONDIÇÃO: o caminho do 401 (a conferência) não foi o exercitado');
    assert.deepEqual(corte(controle), caso.esperado, 'CONTROLE: sem o treino a escrita pega pela queda não teve o desfecho de sempre — o teste perdeu o sentido');
    assert.deepEqual(controle.C, ['f1'], 'CONTROLE: mexeu no pedido de OUTRO local');
    const r = await escritaNaQueda({ ...caso, comTreino: true });
    assert.deepEqual(r.noTreino, { ativo: true, exemplos: true }, 'PRÉ-CONDIÇÃO: o desfecho chegou com o treino aberto, a tela nos exemplos');
    assert.equal(r.confere, !caso.pousa, 'PRÉ-CONDIÇÃO: o caminho do 401 (a conferência) não foi o exercitado');
    assert.deepEqual(corte(r), caso.esperado,
      `DEFEITO: com o treino aberto a escrita pega pela queda ${caso.pousa ? 'não chegou ao pedido/irmão' : 'não voltou na tela nem avisou'} (${JSON.stringify(corte(r))})`);
    assert.deepEqual(r.C, ['f1'], 'mexeu no pedido de OUTRO local');
    assert.deepEqual(r.fila, ['ur-A', 'ur-B', 'u3'], 'o "Sair" do treino não devolveu a fila real');
  });
}

test('R8-3-02: depois do "Sair" da CONTA (a fila foi embora), a escrita que não pousou não volta nem avisa — nem com o treino', async () => {
  // O mesmo "não pousou", mas a conferência acaba no "Sair": o `resetQueue`
  // encerra o treino (sem devolver a fila guardada) e a fila da tela fica vazia.
  for (const comTreino of [false, true]) {
    const m = montarEscritaNaQueda();
    m.Lightbox.removerFoto('f1', m.A);
    const envio = m.app.enviarExclusao({ id: 'f1', place: m.A, idx: 0, url: FOTO('f1'), regiao: 'row' });
    if (comTreino) m.app.Treino.entrar();
    await tique();
    m.app.setEpoca(1);
    if (comTreino) m.app.Treino.encerrar();
    m.AppState.queue = [];
    m.AppState.currentPlace = null;
    m.responder({ success: false, errorCategory: 'unauthorized', httpCode: 401 });
    assert.equal(await envio, false);
    assert.deepEqual(m.toasts, [], `${comTreino ? 'treino' : 'sem treino'}: avisou sobre um pedido que já não está na tela de ninguém`);
    assert.deepEqual(m.A.imageUrls.map((u) => u.split('thumb700_')[1].replace('.jpg', '')), ['f2'], 'devolveu a foto a um pedido que saiu da tela');
  }
});

// ═══ R8-4-02 · a decisão da OUTRA aba enquanto esta está no treino ═══════════
// A aba A decide (sem sinal) um pedido que a aba B tem na fila; a B está no
// treino. A fila de saída é do aparelho, e a B anota o pedido que APARECEU nela
// com o card já aqui (`decididosPorOutraAbaComCardAqui`): a sentinela
// `pedidoDecididoNaFila` não o conta como "voltou como card", e o `saida.repetida`
// do ✕ aqui diz `outraAba`. No treino, a B olhava os exemplos.
function montarOutraAba() {
  const log = [];
  const els = {};
  const fila = [P(1), P(2), P(3)];
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: fila.slice(), currentPlace: fila[0], stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 3, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true } };
  const deps = depsDoTreino(AppState, log, els);
  const app = montar(deps, ['chaveDoPedido', 'filaReal', 'filaRealComDevolvidos', 'diagDecididos', 'anotarDecididosPorOutraAba'],
    'const decididosPorOutraAbaComCardAqui = new WeakSet();',
    'conta: (saida) => diagDecididos(saida, AppState.queue, decididosPorOutraAbaComCardAqui), daOutraAba: (p) => decididosPorOutraAbaComCardAqui.has(p)');
  return { app, AppState, fila };
}
const item = (p) => ({ tipo: 'reject', venueID: p.venueID, updateRequestID: p.updateRequestID });
const aviso = (antes, depois) => ({ key: 'waze_places_saida', oldValue: JSON.stringify(antes), newValue: JSON.stringify(depois) });

function outraAbaDecide(comTreino) {
  const m = montarOutraAba();
  const recusado = P(0);                     // o que o Waze recusou de vez com o treino aberto: volta no `sair()`
  if (comTreino) {
    m.app.Treino.entrar();
    assert.ok(m.app.Treino.guardarDevolucao(recusado, 0), 'PRÉ-CONDIÇÃO: o recusado não ficou guardado pro `sair()`');
  } else m.AppState.queue.splice(1, 0, recusado);
  // A outra aba decide o 1º da fila e o recusado (sem sinal: ficam na fila de saída).
  const saida = [item(m.fila[0]), item(recusado)];
  m.app.anotarDecididosPorOutraAba(aviso([], saida));
  if (comTreino) m.app.Treino.sair();
  return { fila: ids(m.AppState.queue), conta: m.app.conta(saida),
    marcados: [m.fila[0], recusado].map((p) => m.app.daOutraAba(p)) };
}

test('R8-4-02: a decisão da OUTRA aba com o treino aberto é anotada na fila REAL — e no recusado que volta no "Sair"', () => {
  const controle = outraAbaDecide(false);
  assert.deepEqual(controle, { fila: ['u1', 'u0', 'u2', 'u3'], conta: { naSaida: 2, naFila: 0, porOutraAba: 2 }, marcados: [true, true] },
    'CONTROLE: sem o treino a decisão da outra aba não foi anotada — o teste perdeu o sentido');
  const r = outraAbaDecide(true);
  assert.deepEqual(r.fila, controle.fila, 'PRÉ-CONDIÇÃO: o "Sair" do treino não devolveu a mesma fila real');
  assert.deepEqual(r.conta, controle.conta,
    `DEFEITO: de volta do treino, a sentinela conta como "voltou como card" o que a OUTRA aba decidiu (${JSON.stringify(r.conta)})`);
  assert.deepEqual(r.marcados, [true, true], `DEFEITO: o ✕ aqui anotaria um \`saida.repetida\` sem \`outraAba\` (${r.marcados})`);
});

test('R8-4-02: o pedido que ENTRA na fila depois da decisão da outra aba segue contando — no treino também', () => {
  // A marca é por OBJETO: o pedido que já estava decidido quando entrou aqui
  // (a falha de entrada que a sentinela procura) não é anotado.
  const m = montarOutraAba();
  m.app.Treino.entrar();
  const saida = [item(m.fila[0])];
  m.app.anotarDecididosPorOutraAba(aviso([], saida));
  m.app.Treino.sair();
  const outro = { ...m.fila[0] };            // o mesmo pedido, entrado DE NOVO (outro objeto)
  m.AppState.queue.push(outro);
  assert.deepEqual(m.app.conta(saida), { naSaida: 1, naFila: 1, porOutraAba: 1 },
    'o pedido que entrou de novo com a decisão já na fila de saída deixou de contar — a sentinela ficou cega à falha da entrada');
});

// ═══ R8-4-04 · a reabertura SEM REDE com o treino aberto durante a leitura ═══
// O app abre sem rede e lê a fila guardada do offline (IndexedDB — no WebKit às
// vezes leva segundos). A pessoa entra no treino nesse meio. A fila lida entrava
// por cima dos EXEMPLOS (pedidos reais sob a faixa "nada é enviado"), e o "Sair"
// devolvia a fila vazia que o treino tinha guardado. Agora ela não entra: fica
// anotada no treino, e o `sair()` tenta de novo pelo MESMO caminho.
function montarReabertura({ guardada }) {
  const log = [];
  const els = {};
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: true, loadError: false,
    queue: [], currentPlace: null, stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 0, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true } };
  const leituras = [];
  const deps = depsDoTreino(AppState, log, els, {
    offlineLigado: () => true, navigator: { onLine: false },
    // A leitura da base: a 1ª espera o teste soltar; as seguintes respondem na hora.
    offlineLerFila: () => {
      if (leituras.length) { leituras.push('na hora'); return Promise.resolve(guardada()); }
      return new Promise((ok) => leituras.push(() => ok(guardada())));
    },
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), filaGuardadaDestaConta: () => true,
    offlineRecuperarJanela: async () => {}, dfato: (k, v) => log.push(k + ':' + JSON.stringify(v)),
    semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
    pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {},
  });
  const app = montar(deps, ['mesmoLugar', 'chaveDoPedido', 'offlineTentarAbrirSemRede', 'abrirGuardadaDepoisDoTreino'],
    'let filaDeOnde = null, offlineFilaGravadaEm = null, offlineFilaGravadaChaves = null, ultimaBuscaFalhouPorRede = false;');
  return { app, AppState, log, soltar: () => leituras[0](), leituras };
}
const filaDoAparelho = () => ({ places: [P(91), P(92), P(93), P(94)], t: 1785200000000, regiao: 'row', pais: 30, busca: 'b' });

async function reabreComTreino(comTreino) {
  const m = montarReabertura({ guardada: filaDoAparelho });
  const abrindo = m.app.offlineTentarAbrirSemRede();     // a abertura sem rede (`abrirComSessaoSalva`)
  await tique();
  if (comTreino) m.app.Treino.entrar();                  // ⓘ → "Praticar" durante a leitura
  m.soltar();
  const abriu = await abrindo;
  const durante = { abriu, exemplos: soExemplos(m.AppState.queue), treino: m.app.Treino.ativo };
  // A tela que fica: a da abertura (sem o treino) ou a do "Sair" (com ele).
  let desde = 0;
  if (comTreino) {
    desde = m.log.length;
    m.app.Treino.sair();
    for (let i = 0; i < 6; i++) await tique();
  }
  return { durante, fila: ids(m.AppState.queue), leituras: m.leituras.length, restam: m.AppState.serverTotal,
    hasMore: m.AppState.hasMore, log: m.log.slice(desde).filter((l) => /^(card|busca|vazio)/.test(l)) };
}

test('R8-4-04: a fila guardada lida com o treino aberto não entra nos EXEMPLOS — e entra na fila real no "Sair"', async () => {
  const controle = await reabreComTreino(false);
  assert.deepEqual(controle, { durante: { abriu: true, exemplos: false, treino: false }, fila: ['u91', 'u92', 'u93', 'u94'],
    leituras: 1, restam: 4, hasMore: true, log: ['card:u91'] },
  'CONTROLE: sem o treino a fila guardada não abriu — o teste perdeu o sentido');
  const r = await reabreComTreino(true);
  assert.deepEqual(r.durante, { abriu: false, exemplos: true, treino: true },
    `DEFEITO: a fila guardada entrou por cima dos EXEMPLOS do treino (${JSON.stringify(r.durante)}) — pedidos reais sob a faixa "nada é enviado"`);
  assert.deepEqual(r.fila, controle.fila,
    `DEFEITO: o "Sair" do treino não trouxe a fila guardada (${JSON.stringify(r.fila)}) — ela sumia até o "Tentar de novo"`);
  assert.equal(r.restam, controle.restam, 'o "Restam" da fila guardada não veio com ela');
  assert.deepEqual(r.log, ['card:u91'], `a tela depois do "Sair" não foi a do card (${r.log})`);
  assert.equal(r.leituras, 2, 'o "Sair" não leu a base de novo (o MESMO caminho da abertura)');
});

test('R8-4-04: o treino que abre e FECHA durante a leitura não segura nada — a fila guardada entra, como sem o treino', async () => {
  const m = montarReabertura({ guardada: filaDoAparelho });
  const abrindo = m.app.offlineTentarAbrirSemRede();
  await tique();
  m.app.Treino.entrar();
  m.app.Treino.sair();                                  // a fila real (vazia) voltou, com a época dela
  m.soltar();
  assert.equal(await abrindo, true, 'a fila guardada não abriu depois de um treino já fechado');
  assert.deepEqual(ids(m.AppState.queue), ['u91', 'u92', 'u93', 'u94']);
  assert.equal(m.leituras.length, 1, 'leu a base de novo sem precisar');
});

test('R8-4-04: sem a fila guardada que abra (outro lugar), o "Sair" do treino segue pra tela de sempre', async () => {
  const outroLugar = () => ({ ...filaDoAparelho(), pais: 73 });
  const m = montarReabertura({ guardada: outroLugar });
  const abrindo = m.app.offlineTentarAbrirSemRede();
  await tique();
  m.app.Treino.entrar();
  m.soltar();
  assert.equal(await abrindo, false);
  const desde = m.log.length;
  m.app.Treino.sair();
  for (let i = 0; i < 6; i++) await tique();
  assert.deepEqual(ids(m.AppState.queue), [], 'a fila de OUTRO lugar entrou');
  assert.equal(m.leituras.length, 1, 'a fila de outro lugar não fica anotada pro "Sair" (nada a abrir)');
  assert.deepEqual(m.log.slice(desde).filter((l) => /^(card|busca|vazio)/.test(l)), ['busca'], 'o "Sair" não seguiu pra busca de sempre');
});

test('R8-4-04: a leitura de uma fila REFEITA antes de o treino abrir não fica anotada — a época da leitura decide', async () => {
  // A leitura começa na fila da abertura; um ↻/filtro a refaz (a época anda) e
  // só depois o treino abre, guardando a fila NOVA. A fila guardada do aparelho
  // era da fila de antes: não é a que o treino guardou (`filaGuardada`), e
  // quem refez a fila tem a busca dele.
  const m = montarReabertura({ guardada: filaDoAparelho });
  const abrindo = m.app.offlineTentarAbrirSemRede();
  await tique();
  m.AppState.fetchEpoch++;                              // o `resetQueue` (↻, filtro) no meio da leitura
  m.app.Treino.entrar();
  m.soltar();
  assert.equal(await abrindo, false);
  assert.ok(soExemplos(m.AppState.queue), 'a fila guardada entrou nos EXEMPLOS');
  m.app.Treino.sair();
  for (let i = 0; i < 6; i++) await tique();
  assert.equal(m.leituras.length, 1, 'a leitura de uma fila refeita ficou anotada pro "Sair"');
  // CONTROLE: a mesma corrida sem o ↻ — a fila guardada é a da leitura, e entra no "Sair".
  const c = montarReabertura({ guardada: filaDoAparelho });
  const abrindoC = c.app.offlineTentarAbrirSemRede();
  await tique();
  c.app.Treino.entrar();
  c.soltar();
  assert.equal(await abrindoC, false);
  c.app.Treino.sair();
  for (let i = 0; i < 6; i++) await tique();
  assert.equal(c.leituras.length, 2, 'CONTROLE: a fila da leitura não ficou anotada pro "Sair"');
  assert.deepEqual(ids(c.AppState.queue), ['u91', 'u92', 'u93', 'u94']);
});

// ═══ R8-4-05 · a linha do "Disponível offline" com o treino aberto ═══════════
// "Pronto — N pedidos no aparelho": N era o `AppState.queue.length` — no treino,
// os 30 clones (ou os sintéticos, com a fila curta) no lugar dos 40 guardados.
function linhaDoOffline({ comTreino, onLine }) {
  const log = [];
  const els = {};
  const J = 1492385;
  const fila = Array.from({ length: 40 }, (_, i) => ({ ...P(100 + i), updateTypeKey: i % 2 ? 'VENUE' : 'UPDATE_DETAILS' }));
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: fila.slice(), currentPlace: fila[0], stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 40, autorEmFoco: null,
    preferences: { comoFuncionaVisto: true } };
  const deps = depsDoTreino(AppState, log, els, {
    navigator: { onLine }, offlineLigado: () => true, escapeHtml: (s) => s,
    OFFLINE_CICLO_MS: 1200000, Date: { now: () => J * 1200000 + 1000 },
  });
  const app = montar(deps, ['filaReal', 'filaGuardadaEsperandoOTreino', 'offlinePrecisaVarrer', 'atualizarLinhaDoOffline'],
    `let offlineJanelaServida = ${J}, offlineUltimoResultado = 'pronto', offlineVarrendo = false,
      offlineFilaPreparada = 7, offlineFilaGravadaEm = 7, offlineFilaVarrida = null;`);
  let exemplos = null;
  if (comTreino) { app.Treino.entrar(); exemplos = AppState.queue.length; }
  app.atualizarLinhaDoOffline(0, 0);
  const linha = els.prefOfflineDesc.innerHTML;
  const n = /\{"n":(\d+)\}/.exec(linha);
  return { n: n ? Number(n[1]) : null, exemplos, chave: (/prefs\.offline\.\w+B/.exec(linha) || [])[0] };
}

test('R8-4-05: a linha do "Disponível offline" conta a fila REAL — no treino também, com e sem sinal', () => {
  for (const onLine of [true, false]) {
    const controle = linhaDoOffline({ comTreino: false, onLine });
    assert.deepEqual(controle, { n: 40, exemplos: null, chave: onLine ? 'prefs.offline.prontoB' : 'prefs.offline.prontoSemRedeB' },
      'CONTROLE: fora do treino a linha não disse "Pronto — 40" — o teste perdeu o sentido');
    const r = linhaDoOffline({ comTreino: true, onLine });
    assert.equal(r.exemplos, 30, 'PRÉ-CONDIÇÃO: o treino não montou os 30 exemplos (os clones de uma página do WME)');
    assert.deepEqual(r, { ...controle, exemplos: 30 },
      `DEFEITO: ${onLine ? 'com' : 'sem'} sinal, no treino a linha contou os EXEMPLOS como "pedidos no aparelho" (${r.n})`);
  }
});

// ═══ R8-7-03 = R8-2-03 · a 2ª passada da recusa automática, pedida antes do treino ═══
// L6+AM, recusa automática ligada no autor 777. A 1ª passada está no ar (um a um),
// e uma página pousa com mais pedidos dele: a passada fica pedida de novo
// (`recusaAutomaticaPedidaDeNovo`). A pessoa entra no treino, e a 1ª termina nele:
// a 2ª saía na primeira linha (no treino a fila é de exemplos), com a marca já
// zerada, e o `sair()` só reaplicava a recusa com o perfil chegado no treino — os
// pedidos do autor marcado voltavam como card.
function montarRecusa() {
  const log = [];
  const els = {};
  const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
    queue: [], currentPlace: null, stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 0, autorEmFoco: null,
    inFlightActions: 0, preferences: { comoFuncionaVisto: true }, filters: { sortOrder: 'newest' }, profile: { id: 1 } };
  const waze = {
    rejeitados: [], noAr: null,
    rejectPlace(v, u) { waze.rejeitados.push(u); return new Promise((ok) => { waze.noAr = ok; }); },
    async responder(r = { success: true }) {
      for (let i = 0; i < 100 && !waze.noAr; i++) await tique();
      assert.ok(waze.noAr, 'PRÉ-CONDIÇÃO: nenhuma rejeição no ar pra responder');
      const ok = waze.noAr;
      waze.noAr = null;
      ok(r);
      for (let i = 0; i < 4; i++) await tique();
    },
  };
  const deps = depsDoTreino(AppState, log, els, {
    t: (k) => k, showToast: () => ({ texto() {}, dispensar() {} }), aoMudarAFilaPorBaixo: () => {},
    pedidosQueEntraramNaFila: new Set(), pedidosEmAndamento: new Set(), epocaDaSessao: 0,
    podeRecusarAutomaticoAqui: () => true, contaConfirmada: () => true, autoLigado: (id) => id === 777,
    API: { getRegion: () => 'row', rejectPlace: (v, u) => waze.rejectPlace(v, u) },
    carimboDoGesto: () => null, callWithRetry: (fn) => fn(),
    marcarEmAndamento: () => {}, registrarPouso: () => {}, recordHistory: () => {}, registrarRejeicaoDeAutor: () => {},
    registrarAcaoConfirmada: () => {}, saveStats: () => {}, updateInFlightIndicator: () => {}, mostrarResultadoDoLote: () => {},
    handleUnauthorized: () => {}, dfato: () => {}, soltarMarcaDosItens: () => {}, enfileirarSaida: () => true,
    tirarDaFilaDeSaida: () => true, pousouPorOutraAba: () => {}, carregarFilaDeSaida: () => [], salvarFilaDeSaida: () => {},
    reivindicacaoDestaAba: () => ({}), anotadoAntesDoEnvio: new Set(), descargaNaFila: new Set(),
  });
  // A recusa, o lote e a devolução de verdade (o `sair()` chama a recusa).
  delete deps.aplicarRecusaAutomatica;
  delete deps.devolverPedidoRecusado;
  const app = montar(deps, ['chaveDoPedido', 'devolverPedidoRecusado', 'pousouNoWaze', 'descontarGestoSemSessao', 'enviarLote',
    'aplicarRecusaAutomatica'],
  'let recusaAutomaticaRodando = false; let recusaAutomaticaPedidaDeNovo = false; let recusaAutomaticaNestaFila = false;',
  'pedidaDeNovo: () => recusaAutomaticaPedidaDeNovo, rodando: () => recusaAutomaticaRodando');
  return { app, AppState, waze };
}

async function segundaPassada(comTreino) {
  const m = montarRecusa();
  const pagina1 = [P(1, 1), ...[2, 3, 4, 5].map((i) => P('x' + i, 777)), P(8, 8)];
  m.AppState.queue = pagina1.slice();
  m.AppState.currentPlace = pagina1[0];
  m.AppState.serverTotal = pagina1.length;
  const primeira = m.app.aplicarRecusaAutomatica();
  await m.waze.responder();                                   // x2
  // A página 2 pousa com a 1ª passada no ar (o `fetchNextPage`: fila, "Restam" e a recusa).
  m.AppState.queue.push(P('x6', 777), P('x7', 777));
  m.AppState.serverTotal += 2;
  m.app.aplicarRecusaAutomatica();
  const pre = { pedidaDeNovo: m.app.pedidaDeNovo(), rodando: m.app.rodando() };
  if (comTreino) m.app.Treino.entrar();                      // "Praticar"
  await m.waze.responder();                                   // x3
  await m.waze.responder();                                   // x4
  await m.waze.responder();                                   // x5: a 1ª acaba (com o treino aberto, no caso dele)
  const noTreino = comTreino ? { exemplos: soExemplos(m.AppState.queue), rejeitados: m.waze.rejeitados.length } : null;
  if (comTreino) m.app.Treino.sair();
  // A 2ª passada (no fim da 1ª, ou no "Sair"): x6 e x7. Sem ela, nada fica no ar
  // e a espera tem teto (gotcha #19: o harness não pendura).
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 50 && !m.waze.noAr; k++) await tique();
    if (m.waze.noAr) await m.waze.responder();
  }
  await primeira;
  for (let i = 0; i < 10; i++) await tique();
  return { pre, noTreino, rejeitados: m.waze.rejeitados.slice(), fila: ids(m.AppState.queue), restam: m.AppState.serverTotal };
}

test('R8-7-03: a 2ª passada da recusa automática, pedida antes do treino e perdida nele, roda no "Sair" — na fila real', async () => {
  const controle = await segundaPassada(false);
  assert.deepEqual(controle.pre, { pedidaDeNovo: true, rodando: true }, 'PRÉ-CONDIÇÃO: a página não pousou com a 1ª passada no ar');
  assert.deepEqual({ rejeitados: controle.rejeitados, fila: controle.fila, restam: controle.restam },
    { rejeitados: ['ux2', 'ux3', 'ux4', 'ux5', 'ux6', 'ux7'], fila: ['u1', 'u8'], restam: 2 },
    'CONTROLE: sem o treino a 2ª passada não rejeitou a página 2 — o teste perdeu o sentido');
  const r = await segundaPassada(true);
  assert.deepEqual(r.pre, controle.pre);
  assert.deepEqual(r.noTreino, { exemplos: true, rejeitados: 4 },
    'a recusa agiu sobre os EXEMPLOS (ou a 2ª passada correu no treino)');
  assert.deepEqual({ rejeitados: r.rejeitados, fila: r.fila, restam: r.restam },
    { rejeitados: controle.rejeitados, fila: controle.fila, restam: controle.restam },
    `DEFEITO: os pedidos do autor marcado voltaram como card depois do treino (${JSON.stringify(r)})`);
});

test('R8-7-03: sem recusa pedida no treino, o "Sair" não manda rejeição nenhuma', async () => {
  const m = montarRecusa();
  m.AppState.queue = [P(1, 1), P('x2', 777), P(3, 3)];
  m.AppState.currentPlace = m.AppState.queue[0];
  m.app.Treino.entrar();
  m.app.Treino.sair();
  for (let i = 0; i < 10; i++) await tique();
  assert.deepEqual(m.waze.rejeitados, [], 'o "Sair" rodou a recusa sem ninguém pedir — rejeitaria um pedido que a pessoa podia estar vendo');
  assert.deepEqual(ids(m.AppState.queue), ['u1', 'ux2', 'u3']);
});

// ═══ A fonte única ═══════════════════════════════════════════════════════════
// Quem pergunta pela fila REAL pergunta à `filaReal` — a régua não se copia (a
// cópia é como o próximo conserto chega num lugar e não no outro).
test('filaReal: a guardada pelo treino com ele aberto; senão a da tela', () => {
  const AppState = { queue: [P(1)] };
  const Treino = { ativo: false, _salvo: { queue: [P(2)] } };
  const f = new Function('AppState', 'Treino', fatiar('filaReal') + '\nreturn filaReal;')(AppState, Treino);
  assert.equal(f(), AppState.queue, 'fora do treino a fila real é a da tela');
  Treino.ativo = true;
  assert.equal(f(), Treino._salvo.queue, 'com o treino aberto a fila real é a que ele guardou');
  Treino._salvo = null;
  assert.equal(f(), AppState.queue, 'treino sem fila guardada: a da tela');
  // Sem o `Treino` no escopo (os testes que fatiam só as funções da fila).
  const sem = new Function('AppState', fatiar('filaReal') + '\nreturn filaReal;')(AppState);
  assert.equal(sem(), AppState.queue);
});

test('filaReal: os consumidores da fila REAL perguntam a ela (e só a ela)', () => {
  // As perguntas de IDENTIDADE ("o pedido ainda é desta tela?", "os irmãos dele",
  // "a decisão da outra aba caiu num card daqui?") incluem o recusado que espera
  // o "Sair" do treino: a irmã `filaRealComDevolvidos`, que pergunta à `filaReal`
  // (R9-7-01). Quem CONTA (a linha do offline) pergunta à `filaReal` direto.
  const irma = fatiar('filaRealComDevolvidos');
  assert.match(irma, /\bfilaReal\(\)/, 'a `filaRealComDevolvidos` não parte da `filaReal`');
  assert.match(irma, /Treino\._salvo\.devolver/, 'a `filaRealComDevolvidos` não soma o recusado que espera o "Sair"');
  for (const nome of ['pedidoAindaNaTela', 'aplicarNosIrmaos', 'anotarDecididosPorOutraAba']) {
    const corpo = fatiar(nome);
    assert.match(corpo, /\bfilaRealComDevolvidos\(\)/, `${nome} não pergunta pela fila real (com o recusado do treino) à \`filaRealComDevolvidos\``);
    assert.doesNotMatch(corpo, /Treino\._salvo\.(queue|devolver)/, `${nome} copiou a régua da fila guardada em vez de usar a irmã da \`filaReal\``);
  }
  for (const nome of ['atualizarLinhaDoOffline', 'offlineGravarFila', 'offlineItensDaFila']) {
    const corpo = fatiar(nome);
    assert.match(corpo, /\bfilaReal\(\)/, `${nome} não pergunta pela fila real à \`filaReal\``);
    assert.doesNotMatch(corpo, /Treino\._salvo\.queue/, `${nome} copiou a régua da fila guardada em vez de usar a \`filaReal\``);
  }
  // A linha conta pela fila real, e não pela da tela.
  assert.doesNotMatch(fatiar('atualizarLinhaDoOffline'), /AppState\.queue/, 'a linha do offline voltou a contar a fila da TELA');
  assert.doesNotMatch(fatiar('pedidoAindaNaTela'), /AppState\.queue/, 'o "pedido ainda na tela" voltou a olhar a fila da TELA');
});

// ═══ Junção do lote 12 · a SENTINELA olha a fila real com o treino aberto ═════
// O R8-4-06 passou a gerar o relatório "dentro do treino", e a sentinela
// `pedidoDecididoNaFila` comparava a fila de saída com a `AppState.queue` — os
// exemplos. O pedido decidido que voltou à fila guardada pelo treino (o defeito
// que ela procura) passava calado ali.
test('junção do lote 12: a sentinela `pedidoDecididoNaFila` compara a fila REAL, também com o treino aberto', () => {
  const contar = (comTreino) => {
    const fila = [P(1), P(2), P(3)];
    const AppState = { authenticated: true, pendingAction: null, fetchEpoch: 0, fetching: false, hasMore: false,
      queue: fila.slice(), currentPlace: fila[0], stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 3, autorEmFoco: null,
      preferences: { comoFuncionaVisto: true } };
    let saida = [];
    const deps = depsDoTreino(AppState, [], {}, { carregarFilaDeSaida: () => saida });
    const app = montar(deps, ['chaveDoPedido', 'filaReal', 'diagDecididos', 'diagDecididosAgora'],
      'const decididosPorOutraAbaComCardAqui = new WeakSet();');
    if (comTreino) {
      app.Treino.entrar();
      assert.ok(soExemplos(AppState.queue), 'PRÉ-CONDIÇÃO: o treino não pôs os exemplos na tela');
    }
    // O 2º pedido está esperando envio E de volta na fila real: o que a sentinela procura.
    saida = [item(fila[1])];
    return app.diagDecididosAgora();
  };
  const controle = contar(false);
  assert.deepEqual(controle, { naSaida: 1, naFila: 1 }, 'CONTROLE: sem o treino a sentinela não viu o pedido de volta — o teste perdeu o sentido');
  assert.deepEqual(contar(true), controle, 'DEFEITO: com o treino aberto a sentinela olhava os exemplos, e o pedido de volta passava calado');
  // E é ela que o relatório usa (a captura de cada momento passa pelo `diagComputado`).
  assert.match(fatiar('diagComputado'), /fora\.decididos = diagDecididosAgora\(\);/,
    'o `diagComputado` deixou de contar os decididos pela fila REAL (`diagDecididosAgora`)');
});
