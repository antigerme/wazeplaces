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
    AppState: { profile: null, currentPlace: null, authenticated: false },
    renderProfileHeader: () => {}, showCurrentPlace: () => {}, updateStats: () => {}, updatePendingCount: () => {},
    renderUndoGateUI: () => {}, atualizarLinhaDoOffline: () => {}, atualizarSeloDeConquista: () => {},
    historicoNaTela: () => false, renderHistory: () => {},
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
function montarFimDaFila({ skipped = 0, base = 0, tratou = true } = {}) {
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
    checarConquistas: (x) => conquistas.push(x || {}),
  };
  const preludio = `let tratouNestaFila = ${tratou}; let puladosNoInicioDaFila = ${base};`;
  const api = montar(['puladosNestaFila', 'filaZeradaConfirmada', 'showNoPlaces'], deps,
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
    checarConquistas: (x) => ctxs.push(x || {}),
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
    checarConquistas: (x) => ctxs.push(x || {}), filaZeradaConfirmada: () => false,
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
    API: { getRegion: () => 'row' }, getLang: () => 'fr', updateInFlightIndicator() {},
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
function montarChecagem({ g, tratados }) {
  const selo = { n: 0 };
  const deps = {
    AppState: { authenticated: true }, Treino: { ativo: false },
    carregarConquistas: () => g, salvarConquistas() {}, atualizarSeloDeConquista: () => { selo.n++; },
    loadHistory: () => ({}),
    getHistoryStats: () => ({ total: { read: tratados, rejected: 0 }, today: { read: 0, rejected: 0 } }),
    geografiaDoHistorico: () => ({ paises: new Set(), estados: new Set() }),
    maiorSequenciaDeDias: () => 0, conquistasComPortaoAqui: () => false, historyTodayKey: () => '2026-09-25',
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
  const deps = {
    callWithRetry: (fn) => fn(),
    API: { renomearLocal: () => new Promise((ok, falha) => { soltar = ok; derrubar = falha; }) },
    aplicarNosIrmaos: () => efeitos.push('irmaos'), aplicarNomeNaTela: () => efeitos.push('nome'),
    contarConquista: (k) => efeitos.push('conquista:' + k),
    handleUnauthorized: () => efeitos.push('401'), showToast: () => efeitos.push('toast'),
    msgDoServidor: () => '', t: (k) => k,
  };
  // `epocaDaSessao` é variável solta no app: passa por um getter no escopo.
  const chaves = Object.keys(deps);
  const corpo = fatiar('enviarRenomeacao').replace(/epocaDaSessao/g, '__estado.epoca');
  const enviar = new Function(...chaves, '__estado', corpo + '\nreturn enviarRenomeacao;')(...chaves.map((k) => deps[k]), estado);
  const alvo = { place: { venueID: 'v1' }, novo: 'Nome Novo', antigo: 'Nome Velho' };
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
    Treino: { ativo: false }, Lightbox, AppState: { preferences: { undoEnabled: true }, currentPlace: null },
    canDisableUndo: () => false, podeRenomearAqui: () => true,
    document: { getElementById: (id) => (id === 'lightboxNomeInput' ? { value: 'Nome Novo' } : null) },
    fecharEdicaoNome() {}, aplicarNomeNaTela() {}, devolverFoto() {}, showCurrentPlace() {},
    API: { prepararExclusao() {} },
    enviarAprovacao: () => Promise.resolve(true), enviarExclusao: () => Promise.resolve(true), enviarRenomeacao() {},
    aplicarTravaDeAcao() {}, removeUndoBanner() {}, t: (k) => k,
    mostrarDesfazer: (msg, aoDesfazer) => { reg.banner = aoDesfazer; },
    registrarDesfazer: () => { reg.desfazer++; },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, UNDO_WINDOW_MS: 3000,
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
