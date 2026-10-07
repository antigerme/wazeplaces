// Conquistas: QUANDO elas são avaliadas, e com que momento.
//
// A régua da seção ("celebra o que a pessoa FEZ") quebra de um jeito que não
// dá erro nenhum: a conquista destrava pelo gesto errado, na hora errada ou
// com o dado de outro momento — e fica gravada. Tudo daqui saiu da auditoria
// de 2026-09-25 do Histórico, e cada teste foi visto REPROVANDO com o conserto
// desfeito.
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
// `preludio` declara o estado de MÓDULO que as funções leem (os `let` do app).
function montar(nomes, deps, devolve, preludio = '') {
  const chaves = Object.keys(deps);
  return new Function(...chaves, preludio + '\n' + nomes.map(fatiar).join('\n') + `\nreturn { ${devolve.join(', ')} };`)(...chaves.map((k) => deps[k]));
}

// ── H2: trocar de idioma não é trabalhar em dois idiomas ────────────────────
function depsDoIdioma(extra = {}) {
  const idiomas = [];
  const deps = {
    setLang: () => {}, registrarIdiomaUsado: (l) => idiomas.push(l),
    safeLS: { set: () => {} }, LANG_KEY: 'waze_places_lang', applyI18n: () => {},
    SELETORES_IDIOMA: [], document: { getElementById: () => null }, popularOrdenacoes: () => {},
    atualizarDicaDeOrdem: () => {}, estadoDaDicaDeOrdem: null,
    AppState: { profile: null, currentPlace: null, authenticated: false },
    renderProfileHeader: () => {}, showCurrentPlace: () => {}, updateStats: () => {}, updatePendingCount: () => {},
    renderUndoGateUI: () => {}, atualizarLinhaDoOffline: () => {}, atualizarSeloDeConquista: () => {},
    historicoNaTela: () => false, renderHistory: () => {},
    Treino: { retraduzirExemplos() {} }, updateInFlightIndicator: () => {},
    window: {}, showToast: () => {}, t: (k) => k, ...extra,
  };
  return { deps, idiomas };
}

test('H2: trocar de idioma NÃO conta pra "Poliglota" — logado (Preferências) nem deslogado (Ajuda)', () => {
  for (const authenticated of [true, false]) {
    const { deps, idiomas } = depsDoIdioma({ AppState: { profile: null, currentPlace: null, authenticated } });
    const { aplicarIdioma } = montar(['aplicarIdioma'], deps, ['aplicarIdioma']);
    aplicarIdioma('en');
    aplicarIdioma('pt');
    assert.deepEqual(idiomas, [],
      `trocar de idioma (${authenticated ? 'logado' : 'deslogado'}) registrou idioma usado — abrir o seletor e voltar destrava a Poliglota, e deslogado recria as conquistas depois do "Sair"`);
  }
});

test('H2: CONTROLE — o idioma continua entrando pelo GESTO confirmado', () => {
  // Sem isto, "nenhum idioma registrado" passaria também com a Poliglota
  // inalcançável.
  for (const nome of ['registrarAcaoConfirmada', 'registrarLoteConfirmado']) {
    assert.match(fatiar(nome), /registrarIdiomaUsado\(/, `${nome} deixou de registrar o idioma do trabalho`);
  }
});

// ── H9 e C13: "Tudo limpo" só com a fila LIMPA e o trabalho CONFIRMADO ─────
// O painel de fila vazia aparece no MESMO gesto que esvazia a fila, dentro da
// janela do Desfazer (o `advanceQueue` vem antes do `scheduleAction`). A
// conquista era dada ali: desfazer devolvia o card e ela ficava gravada (C13).
// E com pulados a tela diz "Fim da fila", mas soltava confete e dava a
// conquista do mesmo jeito (H9).
function montarFimDaFila({ skipped = 0, base = 0, tratou = true, treino = false } = {}) {
  const conquistas = [];
  const classes = new Set(['hidden']);
  const noMore = {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    querySelector: () => null, dataset: { bordaRolagem: '1' }, offsetWidth: 0,
  };
  const AppState = { loadError: false, hasMore: false, serverTotal: 0, stats: { skipped },
    queue: [], currentPlace: null, pendingAction: null, inFlightActions: 0 };
  const deps = {
    AppState, document: { getElementById: (id) => (id === 'noMoreCards' ? noMore : null) },
    dfato() {}, dlogCapturarAuto() {}, marcarTelaPronta() {}, removeCurrentCardEl() {}, showLoading() {},
    atualizarConviteInstalar() {}, marcarBordaRolagem() {}, trocarTextoI18n() {},
    // A barra "Primeiro os de…" sai com o card (R13-2-05); aqui não há foco no autor.
    renderFocoAutor() {},
    checarConquistas: (x) => conquistas.push(x || {}),
    // Nada mais em jogo que possa voltar pra fila (F3): nem em andamento, nem na fila de saída.
    pedidosEmAndamento: new Set(), carregarFilaDeSaida: () => [],
    chaveDoPedido: (p) => (p ? p.venueID + '|' + p.updateRequestID : null),
    Treino: { ativo: treino },
  };
  // `focoDoTeclado` (R7-2-06): o painel leva o foco prometido ao teclado; aqui ninguém usa teclado.
  const preludio = `let tratouNestaFila = ${tratou}; let puladosNoInicioDaFila = ${base}; let focoDoTeclado = null;`;
  const api = montar(['puladosNestaFila', 'filaTerminouLimpa', 'filaZeradaConfirmada', 'showNoPlaces'], deps,
    ['showNoPlaces', 'filaZeradaConfirmada'], preludio);
  return { ...api, AppState, conquistas, festa: () => classes.has('celebrate'),
           tudoLimpo: () => conquistas.some((c) => c.filaZerada === true) };
}
// O fim da tarefa: a pergunta da conquista vai pra lá (microtarefa).
const fimDaTarefa = () => new Promise((ok) => setTimeout(ok, 0));

test('C13: o ÚLTIMO swipe não dá "Tudo limpo" dentro da janela do Desfazer', async () => {
  const m = montarFimDaFila();
  m.showNoPlaces();                                  // o `advanceQueue` do gesto
  m.AppState.pendingAction = { type: 'reject' };     // o `scheduleAction`, no mesmo tique
  await fimDaTarefa();
  assert.equal(m.tudoLimpo(), false,
    'deu "Tudo limpo" com a ação ainda desfazível — o Desfazer devolve o card e a conquista fica gravada');
  assert.equal(m.festa(), true, 'o confete (que é da TELA) deixou de sair no último swipe');
  // Sem o Desfazer, a ação sai na hora e fica EM VOO: também não é confirmação.
  const s = montarFimDaFila();
  s.showNoPlaces();
  s.AppState.inFlightActions = 1;
  await fimDaTarefa();
  assert.equal(s.tudoLimpo(), false, 'deu "Tudo limpo" antes de o Waze responder');
});

test('C13: quem dá "Tudo limpo" é a CONFIRMAÇÃO — e o Desfazer que devolve o card impede', () => {
  const m = montarFimDaFila();
  m.showNoPlaces();
  // A janela fechou e o executor está no ar, respondendo: é a confirmação.
  m.AppState.inFlightActions = 1;
  assert.equal(m.filaZeradaConfirmada({ confirmando: true }), true,
    'a confirmação do último pedido não dá "Tudo limpo" — a conquista ficaria inalcançável');
  // CONTROLES: o Desfazer devolveu o card; ou outra ação ainda desfazível.
  m.AppState.queue = [{ venueID: 'v1' }];
  assert.equal(m.filaZeradaConfirmada({ confirmando: true }), false, 'fila com card não está limpa');
  m.AppState.queue = [];
  m.AppState.pendingAction = { type: 'read' };
  assert.equal(m.filaZeradaConfirmada({ confirmando: true }), false, 'com ação na janela do Desfazer não há confirmação');
});

test('C13: quando a confirmação chegou ANTES do painel (fila que esperava a busca), o painel dá a conquista', async () => {
  const m = montarFimDaFila();
  m.showNoPlaces();                 // nada no ar: a ação já tinha sido confirmada
  await fimDaTarefa();
  assert.equal(m.tudoLimpo(), true, 'a fila zerada com tudo confirmado não deu "Tudo limpo"');
});

test('H9: fila que termina com PULADO não solta confete nem dá "Tudo limpo"', async () => {
  const m = montarFimDaFila({ skipped: 12, base: 11 });
  m.showNoPlaces();
  await fimDaTarefa();
  assert.equal(m.festa(), false, 'confete com pedido pulado pendente — a tela diz "Fim da fila"');
  assert.equal(m.tudoLimpo(), false, '"Tudo limpo" com pedido pulado pendente');
  m.AppState.inFlightActions = 1;
  assert.equal(m.filaZeradaConfirmada({ confirmando: true }), false,
    'a confirmação deu "Tudo limpo" com pedido pulado pendente');
  // CONTROLE: sem pulado, as duas coisas.
  const c = montarFimDaFila({ skipped: 11, base: 11 });
  c.showNoPlaces();
  await fimDaTarefa();
  assert.ok(c.festa() && c.tudoLimpo(), 'sem pulado, o confete e a conquista tinham que sair');
});

test('C13: a confirmação de ação pergunta pela fila zerada (registrarAcaoConfirmada)', () => {
  const ctxs = [];
  const deps = {
    Treino: { ativo: false }, carregarConquistas: () => ({ seq: 0 }), salvarConquistas() {},
    registrarIdiomaUsado() {}, getLang: () => 'pt', contagemDoAutor: () => 0,
    checarConquistas: (x) => ctxs.push(x || {}), checkUndoGateUnlock() {},
    filaZeradaConfirmada: (o) => !!(o && o.confirmando),
  };
  const { registrarAcaoConfirmada } = montar(['registrarAcaoConfirmada'], deps, ['registrarAcaoConfirmada']);
  registrarAcaoConfirmada('reject', { creatorId: 1 });
  assert.equal(ctxs.at(-1).filaZerada, true,
    'a confirmação não pergunta pela fila zerada (ou não avisa que está confirmando) — "Tudo limpo" nunca sai');
});

// ── H11: o pouso da fila de saída usa o MOMENTO do gesto ────────────────────
// O pedido tratado sem rede pousa quando ela volta — horas depois, às vezes
// noutro dia. O Histórico já usava o dia do gesto (`item.dia`); as conquistas
// usavam o do POUSO: a "Coruja" pela hora da rede voltando, o "Centurião" pelo
// balde de HOJE (o 100º de ontem não fechava o dia de ontem) e a "Poliglota"
// pelo idioma de agora.
function montarConfirmacao({ agora, historico = {}, langAgora = 'en' }) {
  const idiomas = [], ctxs = [];
  const DataFalsa = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(agora); }
    static now() { return agora; }
  };
  const deps = {
    Treino: { ativo: false }, carregarConquistas: () => ({ seq: 0 }), salvarConquistas() {},
    registrarIdiomaUsado: (l) => idiomas.push(l), getLang: () => langAgora, contagemDoAutor: () => 0,
    checarConquistas: (x) => ctxs.push(x || {}), filaZeradaConfirmada: () => false, checkUndoGateUnlock() {},
    loadHistory: () => historico, Date: DataFalsa,
  };
  const { registrarAcaoConfirmada } = montar(['registrarAcaoConfirmada'], deps, ['registrarAcaoConfirmada']);
  return { registrarAcaoConfirmada, idiomas, ctxs };
}

test('H11: o pouso avalia Coruja, Centurião e Poliglota pelo GESTO, não pela hora em que a rede voltou', () => {
  // Gesto às 02:30 de ontem, em francês; o pouso é hoje às 14:00, em inglês.
  const gesto = new Date(2026, 8, 24, 2, 30).getTime();
  const m = montarConfirmacao({ agora: new Date(2026, 8, 25, 14, 0).getTime(),
    historico: { '2026-09-24': { read: 100, rejected: 0 }, '2026-09-25': { read: 3, rejected: 0 } } });
  m.registrarAcaoConfirmada('read', {}, { t: gesto, dia: '2026-09-24', lang: 'fr' });
  const ctx = m.ctxs.at(-1);
  assert.equal(ctx.madrugada, true, 'a "Coruja" olhou a hora do POUSO (14h), não a do gesto (2h30)');
  assert.equal(ctx.hoje, 100, `o "Centurião" contou o balde de ${ctx.hoje === undefined ? 'HOJE' : ctx.hoje}, não o do dia do gesto`);
  assert.deepEqual(m.idiomas, ['fr'], 'a "Poliglota" registrou o idioma de AGORA, não o do gesto');
});

test('H11: CONTROLE — sem o gesto (todo pouso com rede) vale agora, como sempre', () => {
  const m = montarConfirmacao({ agora: new Date(2026, 8, 25, 3, 0).getTime(),
    historico: { '2026-09-24': { read: 100, rejected: 0 } } });
  m.registrarAcaoConfirmada('read', {});
  const ctx = m.ctxs.at(-1);
  assert.equal(ctx.madrugada, true, 'sem gesto, a hora é a de agora (3h)');
  assert.equal('hoje' in ctx, false, 'sem gesto, o balde é o de hoje (o checarConquistas decide)');
  assert.deepEqual(m.idiomas, ['en']);
  // Item da fila gravado ANTES de o idioma existir: não credita o de agora.
  const v = montarConfirmacao({ agora: new Date(2026, 8, 25, 14, 0).getTime() });
  v.registrarAcaoConfirmada('read', {}, { t: new Date(2026, 8, 25, 13, 0).getTime(), dia: '2026-09-25' });
  assert.ok(!v.idiomas.includes('en'), 'item sem idioma creditou o idioma de agora à Poliglota');
});

test('H11: a fila de saída guarda o idioma do gesto, e o pouso entrega hora, dia e idioma', () => {
  const salvos = [];
  const deps = {
    carregarFilaDeSaida: () => [], salvarFilaDeSaida: (f) => salvos.push(f), chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID,
    dfato() {}, SAIDA_MAX: 1000, historyTodayKey: () => '2026-09-24', ondeAgora: () => '30', contaAgora: () => null,
    API: { getRegion: () => 'row', getSession: () => 'tok' }, getLang: () => 'fr', updateInFlightIndicator() {},
    // A marca da sessão do gesto (o dono do item sem conta, do conserto do offline):
    // a da memória desta aba (`marcaDestaAba`, R13-1-04).
    marcaDaSessao: () => 'marca', marcaDestaAba: () => 'marca',
  };
  const { enfileirarSaida } = montar(['enfileirarSaida'], deps, ['enfileirarSaida']);
  enfileirarSaida('read', { venueID: 'v1', updateRequestID: 'u1' }, 'row');
  const item = salvos.at(-1)[0];
  assert.equal(item.lang, 'fr', 'a fila de saída não guarda o idioma do gesto');
  assert.ok(Number.isFinite(item.t) && item.dia === '2026-09-24', 'a fila de saída perdeu a hora ou o dia do gesto');

  const chamadas = [];
  const depsPouso = {
    registrarPouso() {}, recordHistory() {}, registrarRejeicaoDeAutor() {},
    registrarAcaoConfirmada: (...a) => chamadas.push(a),
  };
  const { registrarPousoDeSaida } = montar(['registrarPousoDeSaida'], depsPouso, ['registrarPousoDeSaida']);
  registrarPousoDeSaida('read', { venueID: 'v1' }, { success: true }, item);
  assert.deepEqual(chamadas.at(-1)[2], { t: item.t, dia: item.dia, lang: 'fr' },
    'o pouso não entrega o momento do gesto às conquistas');
});

// ── H12: a 1ª passada silenciosa só cala o RETROATIVO ───────────────────────
// A primeira avaliação do aparelho é silenciosa (quem já tem 3.000 pedidos
// destravaria oito de uma vez). Mas ela calava TUDO: quando o primeiro evento
// era um Desfazer, a "Segunda chance" ficava gravada sem ponto nem anel.
function fatiarConst(nome) {
  const m = new RegExp('^const ' + nome + ' = \\[', 'm').exec(APP_SEM);
  assert.ok(m, `const ${nome} sumiu do app.js`);
  let prof = 0;
  for (let j = APP_SEM.indexOf('[', m.index); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '[') prof++;
    else if (APP_SEM[j] === ']') { prof--; if (prof === 0) return APP_SEM.slice(m.index, j + 1) + ';'; }
  }
  throw new Error('não fechou ' + nome);
}
function montarChecagem({ g, tratados, treino = false }) {
  const selo = { n: 0 };
  const deps = {
    AppState: { authenticated: true }, Treino: { ativo: treino },
    carregarConquistas: () => g, salvarConquistas() {}, atualizarSeloDeConquista: () => { selo.n++; },
    loadHistory: () => ({}),
    getHistoryStats: () => ({ total: { read: tratados, rejected: 0 }, today: { read: 0, rejected: 0 } }),
    geografiaDoHistorico: () => ({ paises: new Set(), estados: new Set() }),
    maiorSequenciaDeDias: () => 0, conquistasComPortaoAqui: () => false, historyTodayKey: () => '2026-09-25',
    agendarRedesenhoDoHistorico: () => { selo.redesenho = (selo.redesenho || 0) + 1; },
  };
  const chaves = Object.keys(deps);
  const corpo = [fatiarConst('PATENTES'), fatiarConst('CONQUISTAS'), fatiar('patenteDe'),
    fatiar('avaliarConquistas'), fatiar('checarConquistas')].join('\n') + '\nreturn checarConquistas;';
  const checarConquistas = new Function(...chaves, corpo)(...chaves.map((k) => deps[k]));
  return { checarConquistas, selo };
}
const gNovo = () => ({ c: {}, seq: 0, patente: null, n: {}, langs: [], base: false, novas: [], patenteNova: false });

test('H12: o primeiro evento do aparelho sendo um Desfazer ANUNCIA a "Segunda chance"', () => {
  const g = gNovo();
  const m = montarChecagem({ g, tratados: 3000 });
  m.checarConquistas({ desfez: true });
  assert.ok(g.c.segundaChance, 'a Segunda chance nem foi gravada');
  assert.deepEqual(g.novas, ['segundaChance'],
    'a de EVENTO ficou calada na passada silenciosa — gravada sem ponto nem anel, ninguém sabe que ganhou');
  assert.equal(m.selo.n, 1, 'o ponto do botão de Filtros não acendeu');
  // CONTROLE: o volume acumulado (3.000 pedidos) continua silencioso.
  assert.ok(g.c.primeiraFaxina, 'a retroativa não foi gravada');
  assert.ok(!g.novas.includes('primeiraFaxina'), 'a passada deixou de ser silenciosa pro retroativo — volta a enxurrada');
  assert.equal(g.base, true);
});

test('H12: CONTROLE — a passada silenciosa sem evento não anuncia nada', () => {
  const g = gNovo();
  const m = montarChecagem({ g, tratados: 3000 });
  m.checarConquistas();
  assert.deepEqual(g.novas, [], 'a passada silenciosa anunciou volume acumulado');
  assert.equal(m.selo.n, 0);
});

// ── H13: a resposta do renomear que chega depois do "Sair" não grava nada ───
// A aprovação e a exclusão de foto já conferiam a época da sessão; o renomear
// não: a resposta em voo contava o "Corretor" e recriava
// `waze_places_conquistas` depois do "Sair" (auditoria de 2026-09-25; o C9 do
// auditor do card é o mesmo defeito).
test('H13: renomear em voo durante o "Sair" não conta o "Corretor" nem mexe no nome', async () => {
  const efeitos = [];
  const estado = { epoca: 0 };
  let soltar, derrubar;
  // O "Sair" esvazia a fila: o pedido já não está na tela de ninguém (ver
  // `escritaDoLightboxSemSessao`, V2 — a volta da tela é só pra quem ficou).
  const AppState = { queue: [] };
  const deps = {
    callWithRetry: (fn) => fn(),
    API: { renomearLocal: () => new Promise((ok, falha) => { soltar = ok; derrubar = falha; }) },
    aplicarNosIrmaos: () => efeitos.push('irmaos'), aplicarNomeNaTela: () => efeitos.push('nome'),
    contarConquista: (k) => efeitos.push('conquista:' + k),
    handleUnauthorized: () => efeitos.push('401'), showToast: () => efeitos.push('toast'),
    msgDoServidor: () => '', t: (k) => k,
    // A renomeação no ar trava a pílula (L23); a tela é a de mentira.
    renomeacoesNoAr: new Set(), aplicarTravaDeAcao: () => {}, AppState, Lightbox: { isOpen: () => false, place: null },
  };
  // `epocaDaSessao` é variável solta no app: passa por um getter no escopo.
  const chaves = Object.keys(deps);
  // `pedidoAindaNaTela`: a régua de "quem ainda vê o pedido", das duas pontas
  // (o que não pousou volta, o que pousou vai aos irmãos — R6-3-01).
  const corpo = ['enviarRenomeacao', 'nomeDestaEscrita', 'devolverNome', 'escritaDoLightboxSemSessao', 'pedidoAindaNaTela', 'filaReal', 'filaRealComDevolvidos'].map(fatiar).join('\n')
    .replace(/epocaDaSessao/g, '__estado.epoca');
  const enviar = new Function(...chaves, '__estado', corpo + '\nreturn enviarRenomeacao;')(...chaves.map((k) => deps[k]), estado);
  // O nome NA TELA é o desta escrita quando ela sai (o `confirmarRenomear` o
  // pôs lá): é o que deixa a ida sair (ver `nomeDestaEscrita`).
  const alvo = { place: { venueID: 'v1', name: 'Nome Novo' }, novo: 'Nome Novo', antigo: 'Nome Velho' };
  // Os três desfechos: sucesso, recusa e a chamada que LANÇA (o `catch`).
  for (const desfecho of ['sucesso', 'recusa', 'lançou']) {
    efeitos.length = 0;
    const envio = enviar(alvo);
    estado.epoca++;                       // o "Sair" enquanto o renomear voava
    if (desfecho === 'lançou') derrubar(new Error('rede'));
    else soltar(desfecho === 'sucesso' ? { success: true } : { success: false, errorCategory: 'unknown' });
    await envio;
    assert.deepEqual(efeitos, [], `a resposta (${desfecho}) de depois do "Sair" gravou: ${efeitos.join(', ')}`);
  }
  // CONTROLE: sem o "Sair" no meio, a mesma resposta pousa e conta.
  efeitos.length = 0;
  const envio = enviar(alvo);
  soltar({ success: true });
  await envio;
  assert.deepEqual(efeitos, ['irmaos', 'conquista:nomes']);
});

// ── H21: o Desfazer do lightbox é o mesmo Desfazer ──────────────────────────
// Renomear, aprovar e excluir foto usam o MESMO banner do Desfazer do card,
// mas não passavam pelo `registrarDesfazer`: não contavam pra "Segunda
// chance" nem zeravam a "Mão firme" (auditoria de 2026-09-25).
function montarLightboxComJanela() {
  const reg = { desfazer: 0, banner: null };
  const timers = [];
  const place = { venueID: 'v1', updateRequestID: 'ur-1', name: 'Nome Velho', lat: -23, lon: -46 };
  const Lightbox = {
    place, idx: 1, urls: ['a', 'b'],
    podeAprovarAtual: () => true, marcarComoAprovada() {}, desmarcarAprovada() {},
    idFotoAtual: () => 'foto-1', removerFoto() {},
  };
  const deps = {
    Treino: { ativo: false }, Lightbox, AppState: { authenticated: true, preferences: { undoEnabled: true }, currentPlace: null },
    canDisableUndo: () => false, podeRenomearAqui: () => true,
    // A foto está na tela: aprovar e excluir exigem isso (L3, auditoria de 2026-09-26).
    fotoDoLightboxNaTela: () => true, manterFocoNoLightbox() {}, marcarEmAndamento() {},
    document: { getElementById: (id) => (id === 'lightboxNomeInput' ? { value: 'Nome Novo' } : null) },
    fecharEdicaoNome() {}, sairDaEdicaoNome() {}, aplicarNomeNaTela() {}, devolverFoto() {}, showCurrentPlace() {},
    API: { prepararExclusao() {}, getRegion: () => 'row' },
    enviarAprovacao: () => Promise.resolve(true), enviarExclusao: () => Promise.resolve(true), enviarRenomeacao: () => Promise.resolve(true),
    aplicarTravaDeAcao() {}, removeUndoBanner() {}, t: (k) => k,
    // Nada no ar e nada travado: cada caso abre a SUA janela (L23, L24).
    aprovandoAgora: false, excluindoAgora: false, acoesTravadas: () => false, renomeacaoNoAr: () => false,
    avisoDaTrava: () => 'toast.esperaDesfazer', showToast() {},
    mostrarDesfazer: (msg, aoDesfazer) => { reg.banner = aoDesfazer; },
    registrarDesfazer: () => { reg.desfazer++; },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, UNDO_WINDOW_MS: 3000,
    refazerSelosSeOutroNaTela: () => {},   // o "Ver +N" do card da frente (R5-2-02)
    escritasDeFotoNoLocal: new Map(),      // nenhuma escrita da lista do local no ar (R10-3-03, R11-3-01)
    anunciarDesfechoDaFoto: () => {},      // o desfecho dito no irmão quando a escrita pousa (R11-3-05)
  };
  const nomes = ['aprovarFotoAtual', 'pedirExclusaoDaFoto', 'confirmarRenomear'];
  const chaves = Object.keys(deps);
  // As pendentes são `let` de MÓDULO no app: aqui, um objeto no escopo.
  const corpo = nomes.map(fatiar).join('\n')
    .replace(/aprovacaoPendente/g, '__pend.a').replace(/exclusaoPendente/g, '__pend.e')
    .replace(/renomeacaoPendente/g, '__pend.r');
  const app = new Function(...chaves, '__pend', corpo + `\nreturn { ${nomes.join(', ')} };`)(
    ...chaves.map((k) => deps[k]), { a: null, e: null, r: null });
  return { app, reg, timers };
}

test('H21: desfazer pelo banner do lightbox (aprovar, excluir foto, renomear) conta como Desfazer', () => {
  for (const acao of ['aprovarFotoAtual', 'pedirExclusaoDaFoto', 'confirmarRenomear']) {
    const m = montarLightboxComJanela();
    m.app[acao]();
    assert.ok(m.reg.banner, `${acao}: o banner do Desfazer não apareceu — o teste não mediria nada`);
    m.reg.banner();                       // o toque no "Desfazer"
    assert.equal(m.reg.desfazer, 1,
      `${acao}: o Desfazer do lightbox não conta — nem "Segunda chance", nem zera a "Mão firme"`);
  }
});

test('H21: CONTROLE — a janela que corre até o fim (a escrita sai) não é Desfazer', () => {
  for (const acao of ['aprovarFotoAtual', 'pedirExclusaoDaFoto', 'confirmarRenomear']) {
    const m = montarLightboxComJanela();
    m.app[acao]();
    m.timers.at(-1)();                    // a janela fechou sozinha: o envio saiu
    m.reg.banner && m.reg.banner();       // o toque tardio no banner já não desfaz nada
    assert.equal(m.reg.desfazer, 0, `${acao}: contou Desfazer de uma escrita que saiu`);
  }
});

test('H1: conquista que destrava sem pouso de histórico (o pedido guardado) redesenha o painel aberto', () => {
  const g = gNovo();
  g.base = true;
  g.n = { guardados: 10 };                 // o 10º pedido guardado: "Colecionador"
  const m = montarChecagem({ g, tratados: 0 });
  m.checarConquistas();
  assert.ok(g.c.colecionador, 'CONTROLE: o Colecionador tinha que destravar');
  assert.equal(m.selo.redesenho, 1, 'a célula não acende com o painel aberto — só fechando e reabrindo o modal');
  // CONTROLE: sem nada destravando, nada a redesenhar por aqui.
  const n = montarChecagem({ g: Object.assign(gNovo(), { base: true }), tratados: 0 });
  n.checarConquistas();
  assert.ok(!n.selo.redesenho, 'agendou redesenho sem nada ter mudado na vitrine');
});

// ── "Detetive": rejeitar um duplicado (auditoria de 2026-09-29, H1) ──────────
// O card diz "Duplicado" pelo MOTIVO do reporte (`flagType`); a conquista
// olhava o `place.duplicado` — o alvo que o SERVIDOR conseguiu resolver, e ele
// nem sempre consegue (medido no navegador: "Motivo: Duplicado" na tela, ✕
// confirmado, e a conquista não contou). E o pouso da fila de saída reconstruía
// o mesmo `duplicado` a partir do item.
test('Detetive: rejeitar um duplicado conta pelo MOTIVO do reporte, com ou sem o alvo resolvido — também pela fila de saída', () => {
  const m = montarConfirmacao({ agora: new Date(2026, 8, 29, 14, 0).getTime() });
  const conta = (acao, place) => { m.registrarAcaoConfirmada(acao, place); return m.ctxs.at(-1).duplicado; };
  assert.equal(conta('reject', { flagType: 'DUPLICATE' }), true,
    'o card dizia "Duplicado" e a conquista não contou — o alvo não tinha sido resolvido');
  // CONTROLE: com o alvo resolvido conta, como sempre; outro motivo e o ✓ não.
  assert.equal(conta('reject', { flagType: 'DUPLICATE', duplicado: { id: '1.2.3', nome: 'Original' } }), true);
  assert.equal(conta('reject', { flagType: 'CLOSED' }), false, 'contou um reporte que não é de duplicado');
  assert.equal(conta('read', { flagType: 'DUPLICATE' }), false, 'contou MARCAR COMO LIDO um duplicado');

  // A fila de saída: o item guarda o motivo, e o pouso o devolve à conquista.
  const salvos = [];
  const deps = {
    carregarFilaDeSaida: () => [], salvarFilaDeSaida: (f) => salvos.push(f), chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID,
    dfato() {}, SAIDA_MAX: 1000, historyTodayKey: () => '2026-09-29', ondeAgora: () => '30', contaAgora: () => null,
    API: { getRegion: () => 'row', getSession: () => 'tok' }, getLang: () => 'pt', updateInFlightIndicator() {},
    marcaDaSessao: () => 'marca', marcaDestaAba: () => 'marca',   // a sessão do gesto, a da memória (R13-1-04)
  };
  const { enfileirarSaida } = montar(['enfileirarSaida'], deps, ['enfileirarSaida']);
  enfileirarSaida('reject', { venueID: 'v1', updateRequestID: 'u1', flagType: 'DUPLICATE' }, 'row');
  const item = salvos.at(-1)[0];
  assert.equal(item.dup, true, 'a fila de saída não guardou que era um duplicado (sem o alvo resolvido)');
  // O pedido que o esvaziamento remonta a partir do item, lido do CÓDIGO.
  const lit = /const place = (\{ venueID: item\.venueID[\s\S]*?\});/.exec(fatiar('esvaziarFilaDeSaida'));
  assert.ok(lit, 'CONTROLE: o esvaziamento não remonta mais o pedido a partir do item — o guard ficaria cego');
  const remontado = new Function('item', 'return ' + lit[1])(item);
  assert.equal(conta('reject', remontado), true, 'o duplicado rejeitado sem rede não contou pro "Detetive" no pouso');
  const outro = new Function('item', 'return ' + lit[1])({ ...item, dup: false });
  assert.equal(conta('reject', outro), false, 'CONTROLE: o item que não é duplicado contou');
});

// ── R6-7-3: decisão REAL que pousa com o treino aberto conta nas conquistas ───
// O `Treino.entrar` despacha a decisão da janela do Desfazer e entra sem esperar
// a resposta (e a fila de saída esvazia, e o "Rejeitar os N" anda): a resposta
// chega com o treino aberto. A guarda do treino nas conquistas a jogava fora —
// o Histórico contava, e o "Detetive" do duplicado rejeitado sumia pra sempre, a
// "Mão firme" não andava, e o "Primeiro resumo" baixado no treino não contava
// (auditoria de 2026-10-01, MEDIDO no navegador). Ação DE treino nunca chega
// lá: o guard dela está no topo dos handlers.
test('R6-7-3: com o treino aberto, a confirmação de uma decisão REAL conta nas conquistas (Detetive, Mão firme, Poliglota)', () => {
  const g = { seq: 0 };
  const ctxs = [], idiomas = [];
  const deps = {
    Treino: { ativo: true }, carregarConquistas: () => g, salvarConquistas() {},
    registrarIdiomaUsado: (l) => idiomas.push(l), getLang: () => 'fr', contagemDoAutor: () => 0,
    checarConquistas: (x) => ctxs.push(x || {}), filaZeradaConfirmada: () => false, checkUndoGateUnlock() {},
    loadHistory: () => ({}),
  };
  const { registrarAcaoConfirmada, registrarLoteConfirmado } = montar(['registrarAcaoConfirmada', 'registrarLoteConfirmado'], deps,
    ['registrarAcaoConfirmada', 'registrarLoteConfirmado']);
  registrarAcaoConfirmada('reject', { flagType: 'DUPLICATE' });
  assert.equal(g.seq, 1, 'a "Mão firme" não andou: a decisão real confirmada no treino foi jogada fora');
  assert.equal(ctxs.length, 1, 'as conquistas não foram avaliadas pela decisão real que pousou no treino');
  assert.equal(ctxs[0].duplicado, true, 'o "Detetive" do duplicado rejeitado sumiu');
  assert.deepEqual(idiomas, ['fr'], 'o idioma do trabalho não entrou na "Poliglota"');
  registrarLoteConfirmado(12);
  assert.equal(g.seq, 13, 'o "Marcar todos" confirmado com o treino aberto não contou na sequência');
  assert.equal(ctxs.length, 2);
});

test('R6-7-3: o checarConquistas com o treino aberto avalia o que é REAL — e o "Tudo limpo" espera a fila real', () => {
  const g = Object.assign(gNovo(), { base: true });
  const m = montarChecagem({ g, tratados: 0, treino: true });
  m.checarConquistas({ duplicado: true });
  m.checarConquistas({ resumo: true });
  assert.ok(g.c.detetive && g.novas.includes('detetive'), 'o "Detetive" da decisão real não destravou com o treino aberto');
  assert.ok(g.c.primeiroResumo && g.novas.includes('primeiroResumo'), 'o resumo baixado com o treino aberto não contou');
  // A fila NA TELA é a do treino: "zerada" ali seria a de exemplos. Quem julga
  // a real é o painel que o `sair()` desenha (o `showNoPlaces`, que pergunta).
  const f = montarFimDaFila({ treino: true });
  f.showNoPlaces();
  f.AppState.inFlightActions = 1;
  assert.equal(f.filaZeradaConfirmada({ confirmando: true }), false, 'a fila de TREINO deu "Tudo limpo"');
  // CONTROLE: fora do treino, a mesma fila zerada dá.
  const c = montarFimDaFila();
  c.showNoPlaces();
  c.AppState.inFlightActions = 1;
  assert.equal(c.filaZeradaConfirmada({ confirmando: true }), true);
});

// ── R6-7-13: a 1ª passada silenciosa não cala a AÇÃO que a provoca ───────────
// A passada silenciosa existe pro RETROATIVO (quem já tem 3.000 pedidos nas
// costas destravaria oito de uma vez). Feita na confirmação da 1ª ação do
// aparelho, ela calava a própria ação: o histórico já a tinha somado, e um
// "Marcar todos" de 12 destravava a "Primeira faxina" gravada, sem ponto nem
// etiqueta "nova" (auditoria de 2026-10-01, MEDIDO no navegador). Roda o
// `recordHistory` e o `checarConquistas` DE VERDADE, com o histórico de verdade.
function montarAparelhoNovo(historico = null) {
  const dados = new Map();
  if (historico) dados.set('waze_places_history', JSON.stringify(historico));
  const selo = { n: 0 };
  const deps = {
    AppState: { authenticated: true, history: null, conquistas: null },
    localStorage: { getItem: (k) => (dados.has(k) ? dados.get(k) : null), setItem: (k, v) => dados.set(k, String(v)) },
    HISTORY_KEY: 'waze_places_history', CONQUISTAS_KEY: 'waze_places_conquistas',
    podarHistorico: () => false, historyTodayKey: () => '2026-09-25', ondeAgora: () => '30',
    agendarRedesenhoDoHistorico() {}, atualizarSeloDeConquista: () => { selo.n++; }, conquistasComPortaoAqui: () => false,
    textoDaCopia: new WeakMap(),   // a cópia em memória × o aparelho (R9-2-03)
  };
  const chaves = Object.keys(deps);
  const corpo = [fatiarConst('PATENTES'), fatiarConst('CONQUISTAS'), ...['copiaEmDia', 'lembrarTextoDaCopia', 'patenteDe', 'avaliarConquistas', 'carregarConquistas',
    'salvarConquistas', 'checarConquistas', 'garantirLinhaDeBaseDasConquistas', 'loadHistory', 'salvarHistorico', 'recordHistory',
    'diasEntreChaves', 'chaveMaisDias', 'getHistoryStats', 'geografiaDoHistorico', 'maiorSequenciaDeDias'].map(fatiar)]
    .join('\n') + '\nreturn { recordHistory, checarConquistas, AppState };';
  const api = new Function(...chaves, corpo)(...chaves.map((k) => deps[k]));
  return { ...api, g: () => deps.AppState.conquistas, selo };
}

test('R6-7-13: aparelho novo cuja 1ª ação é um "Marcar todos" de 12 — a "Primeira faxina" sai NOVA, com ponto', () => {
  const m = montarAparelhoNovo();
  // O que o `handleBatchMarkRead` faz ao confirmar: histórico, depois conquistas.
  m.recordHistory('read', 12);
  m.checarConquistas({ madrugada: false });
  const g = m.g();
  assert.ok(g.c.primeiraFaxina, 'a "Primeira faxina" nem destravou');
  assert.ok(g.novas.includes('primeiraFaxina'),
    'a "Primeira faxina" destravou CALADA, sem etiqueta "nova": a passada silenciosa engoliu a ação que a provocou');
  assert.ok(m.selo.n >= 1, 'o ponto do botão de Filtros não acendeu');
});

test('R6-7-13: CONTROLE — o volume que JÁ estava no histórico segue silencioso na 1ª passada', () => {
  const m = montarAparelhoNovo({ _total: { read: 3000, rejected: 0 } });
  m.recordHistory('read', 1);
  m.checarConquistas({ madrugada: false });
  const g = m.g();
  assert.ok(g.c.primeiraFaxina, 'a retroativa não foi gravada');
  assert.ok(!g.novas.includes('primeiraFaxina'), 'a passada deixou de ser silenciosa pro retroativo — volta a enxurrada');
  assert.equal(g.base, true);
});

// ── R6-7-10: trocar o idioma redesenha o que o JS escreveu com `t()` ──────────
// Dois textos ficavam no idioma de antes: a frase do indicador "esperando
// envio"/"Enviando N…" (o `title` e o que o leitor de tela anuncia) e os exemplos
// do treino de fila vazia (auditoria de 2026-10-01, MEDIDO no navegador).
test('R6-7-10: o aplicarIdioma redesenha o indicador de envio e retraduz os exemplos do treino ANTES do card', () => {
  const ordem = [];
  const { deps } = depsDoIdioma({
    AppState: { profile: null, currentPlace: { venueID: 'treino1' }, authenticated: true },
    Treino: { retraduzirExemplos: () => ordem.push('exemplos') },
    showCurrentPlace: () => ordem.push('card'), updateInFlightIndicator: () => ordem.push('indicador'),
  });
  const { aplicarIdioma } = montar(['aplicarIdioma'], deps, ['aplicarIdioma']);
  aplicarIdioma('en');
  assert.ok(ordem.includes('indicador'), 'o indicador "Enviando N…" ficou no idioma de antes');
  assert.ok(ordem.includes('exemplos'), 'os exemplos do treino ficaram no idioma de antes');
  assert.ok(ordem.indexOf('exemplos') < ordem.indexOf('card'),
    `os exemplos foram retraduzidos DEPOIS de o card ser redesenhado (${ordem.join(' → ')}) — a tela segue no idioma velho`);
});
