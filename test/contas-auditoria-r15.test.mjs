// A conta, as abas, o "Sair" e o servidor (auditoria da rodada 15 — o lote 19 da
// área "contas"):
//
//  · R15-1-01 — a aba cuja sessão caiu ANTES de o perfil chegar não tinha conta
//    confirmada, e OUTRA conta entrando noutra aba não a alcançava: a fila, o card
//    (dado de terceiro) e o anel de chamadas da conta anterior ficavam nela, e ao
//    entrar depois com a conta nova a troca nem era detectada;
//  · R15-2-F4 — o diálogo do "Sair" não contava os pedidos de um LOTE (o "Rejeitar os
//    N", os pedaços seguintes do "Marcar todos") que ainda não tinham saído, e o
//    "Sair" os descarta;
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" que aceita qualquer chamada e anota o nome. Cada
// teste foi visto REPROVANDO com o conserto desfeito (as sabotagens estão no
// relatório do lote).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP = ler('js/app.js');
const APP_SEM = semComentario(APP);

function fatiarDe(fonte, nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
  }
  let prof = 0;
  for (let j = fonte.indexOf('{', i); j < fonte.length; j++) {
    if (fonte[j] === '{') prof++;
    else if (fonte[j] === '}' && --prof === 0) {
      const corpo = fonte.slice(m.index, j + 1);
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
const fatiar = (nome) => fatiarDe(APP_SEM, nome);
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// Um "buraco negro": aceita qualquer propriedade e qualquer chamada, e anota as
// chamadas pelo caminho.
function buracoNegro(nome, chamou) {
  const f = function () {};
  return new Proxy(f, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then' || typeof k !== 'string') return undefined;
      return buracoNegro(nome + '.' + k, chamou);
    },
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}

// `deps`: o que as funções enxergam (funções e as variáveis de módulo, que elas
// leem e escrevem direto no objeto). O resto é buraco negro.
function montar(nomes, deps) {
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      return buracoNegro(k, chamou);
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map(fatiar).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}

const TOKEN = 'waze_session_token';
const CONTA_KEY = constante('CONTA_KEY');
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();

// O armazenamento de UMA aba, espionado.
function aparelho(inicial = {}) {
  const dados = new Map(Object.entries(inicial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const escritas = [];
  const localStorage = {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { escritas.push('grava:' + k); dados.set(k, String(v)); },
    removeItem: (k) => { escritas.push('apaga:' + k); dados.delete(k); },
  };
  const safeLS = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), remove: (k) => localStorage.removeItem(k) };
  return { dados, escritas, localStorage, safeLS };
}

// ═══ R15-1-01 · a aba que caiu ANTES do perfil sabe de quem era a sessão ═════
// O aparelho (como ficou de uma abertura anterior) tem a conta 111 com a marca da
// sessão TOK-A; a aba abriu com ela, o `/Session` falhou (503/WAF) e a pessoa
// triou SEM o perfil; um ✕ levou o 401 → `derrubarSessao`. A fila (5) e o card
// ficam na memória, pra MESMA conta voltar.
function quedaSemPerfil({ aparelhoInicial, confirmada = null, perfil = null, token = 'TOK-A' } = {}) {
  const ap = aparelho(aparelhoInicial || { [TOKEN]: token, [CONTA_KEY]: { id: '111', s: marcaDe(token) } });
  const appScreen = { classList: { contains: () => false } };
  const deps = {
    safeLS: ap.safeLS, CONTA_KEY,
    AppState: { authenticated: true, profile: perfil, pendingAction: null, fetchEpoch: 1, queue: [{ venueID: 'p1' }, { venueID: 'p2' }], currentPlace: { venueID: 'p1' } },
    API: {
      sessionToken: token,
      temSessaoNaMemoria() { return !!this.sessionToken; },
      setSession(t) { this.sessionToken = t; if (t) ap.safeLS.set(TOKEN, t); else ap.safeLS.remove(TOKEN); },
      soltarSessao() { this.sessionToken = null; },
    },
    document: { getElementById: (id) => (id === 'appScreen' ? appScreen : null), querySelector: () => null },
    epocaDaSessao: 0, quedaAnunciada: false, Treino: { ativo: false }, sessaoCaiuNestaPagina: false,
    extPerguntando: false, contaConfirmadaNestaAba: confirmada,
    entrarPelaExtensao: () => new Promise(() => {}),   // a renovação, no ar
    avisarOutrasAbasDaQueda: () => {},
  };
  const h = montar(['derrubarSessao', 'lembrarAContaDaQueda', 'sessaoDestaAbaEhAGuardada', 'contaAgora', 'marcaDestaAba', 'marcaDaSessao',
    'outraContaTomouOAparelhoDaQueCaiu', 'contaSegueNoAparelho'], deps);
  return { h, deps, ap };
}
// OUTRA conta toma o aparelho noutra aba: o token e a conta dela.
const outraContaEntra = (ap, id = '222') => {
  ap.dados.set(TOKEN, 'TOK-C');
  ap.dados.set(CONTA_KEY, JSON.stringify({ id, s: marcaDe('TOK-C') }));
};

test('R15-1-01: a queda ANTES do perfil guarda a conta que o aparelho confirmou pra sessão que caiu — com a marca DELA', () => {
  const m = quedaSemPerfil();
  assert.equal(m.deps.contaConfirmadaNestaAba, null, 'PRÉ-CONDIÇÃO: a aba não confirmou conta (o perfil não chegou)');
  m.h.derrubarSessao('srv.err.sessionExpired');
  assert.deepEqual(m.deps.contaConfirmadaNestaAba, { id: '111', s: marcaDe('TOK-A') },
    'DEFEITO: a aba que caiu antes do perfil ficou sem conta confirmada — outra conta entrando noutra aba não a alcança');
});

test('R15-1-01: OUTRA conta toma o aparelho — a aba que caiu antes do perfil é alcançada (antes "seguia"); a MESMA conta não a encerra', () => {
  const m = quedaSemPerfil();
  m.h.derrubarSessao('srv.err.sessionExpired');
  // Sem sessão na memória (a queda a soltou) e o app fora da tela.
  m.deps.AppState.authenticated = false;
  m.deps.document.getElementById = () => ({ classList: { contains: () => true } });
  assert.equal(m.h.outraContaTomouOAparelhoDaQueCaiu(), false, 'PRÉ-CONDIÇÃO: o aparelho ainda é da 111 (token e conta guardados)');
  outraContaEntra(m.ap, '222');
  assert.equal(m.h.outraContaTomouOAparelhoDaQueCaiu(), true,
    'DEFEITO: a conta 222 tomou o aparelho e a aba que caiu antes do perfil segue com a fila, o card e o anel da 111');
  // CONTROLE: a MESMA conta entrando noutra aba (nova sessão) não encerra a que caiu.
  const mesma = quedaSemPerfil();
  mesma.h.derrubarSessao('srv.err.sessionExpired');
  mesma.deps.AppState.authenticated = false;
  mesma.deps.document.getElementById = () => ({ classList: { contains: () => true } });
  outraContaEntra(mesma.ap, '111');
  assert.equal(mesma.h.outraContaTomouOAparelhoDaQueCaiu(), false, 'a mesma conta entrando noutra aba encerrou a que caiu');
});

test('R15-1-01: CONTROLES — com o perfil vivo vale a conta dele; a conta já confirmada não é trocada; sem prova da conta, nada é inventado', () => {
  // O perfil chegou: a conta é a dele (e o `aoConhecerConta` já a guardara — aqui só o helper).
  const vivo = quedaSemPerfil({ perfil: { id: 111 } });
  vivo.h.derrubarSessao('srv.err.sessionExpired');
  assert.deepEqual(vivo.deps.contaConfirmadaNestaAba, { id: '111', s: marcaDe('TOK-A') });
  // Já confirmada: o helper não mexe (a renovação e o "Sair" são quem decidem).
  const ja = quedaSemPerfil({ confirmada: { id: '999', s: 'antiga' } });
  ja.h.derrubarSessao('srv.err.sessionExpired');
  assert.deepEqual(ja.deps.contaConfirmadaNestaAba, { id: '999', s: 'antiga' }, 'a queda trocou a conta que a aba já tinha confirmado');
  // O aparelho tem a conta de OUTRA sessão (a marca não é a desta aba): quem é o dono
  // desta sessão não se sabe, e a aba não afirma nada.
  const outra = quedaSemPerfil({ aparelhoInicial: { [TOKEN]: 'TOK-A', [CONTA_KEY]: { id: '111', s: marcaDe('TOK-Z') } } });
  outra.h.derrubarSessao('srv.err.sessionExpired');
  assert.equal(outra.deps.contaConfirmadaNestaAba, null, 'a aba afirmou uma conta que o aparelho confirmou com OUTRA sessão');
  // Sem conta nenhuma no aparelho (a aba que nunca teve perfil nem conta guardada).
  const nada = quedaSemPerfil({ aparelhoInicial: { [TOKEN]: 'TOK-A' } });
  nada.h.derrubarSessao('srv.err.sessionExpired');
  assert.equal(nada.deps.contaConfirmadaNestaAba, null, 'a aba inventou uma conta');
});

test('R15-1-01: a conta guardada na queda faz o `aoConhecerConta` da OUTRA conta limpar a memória (o relatório de quem entrou não leva o anel da anterior)', () => {
  const m = quedaSemPerfil();
  m.h.derrubarSessao('srv.err.sessionExpired');
  // A aba adota a sessão da 222 (a volta) e o perfil dela chega: o aparelho já é da 222
  // (a outra aba tirou o que era da anterior), e só esta aba sabe que a MEMÓRIA ainda é da 111.
  outraContaEntra(m.ap, '222');
  m.deps.API.sessionToken = 'TOK-C';
  const dep2 = { ...m.deps, AppState: m.deps.AppState };
  const a = montar(['aoConhecerConta', 'marcaDestaAba', 'marcaDaSessao', 'sessaoDestaAbaEhAGuardada'], dep2);
  a.aoConhecerConta({ id: 222 });
  assert.ok(a.chamou.includes('esquecerOutraConta'),
    'DEFEITO: a troca de conta só da memória não rodou — a fila e o anel da 111 seguem na aba da 222: ' + JSON.stringify(a.chamou));
});

test('R15-1-01 (estrutura): a queda não ZERA a conta confirmada (R11-1-01) — ela só a preenche quando está vazia, por um helper', () => {
  const corpo = fatiarDe(APP_SEM, 'derrubarSessao');
  assert.doesNotMatch(corpo, /contaConfirmadaNestaAba\s*=(?!=)/, 'a queda atribui a conta confirmada direto: passe pelo helper (que não mexe na que já há)');
  assert.match(corpo, /^\s+lembrarAContaDaQueda\(tokenQueCaiu\);/m, 'a queda não chama o helper que guarda a conta');
  // O helper roda ANTES de a sessão e o perfil saírem da memória (é de lá que a conta vem).
  assert.ok(corpo.indexOf('lembrarAContaDaQueda(') < corpo.indexOf('API.setSession(null)'), 'o helper roda depois de a sessão sair');
  assert.ok(corpo.indexOf('lembrarAContaDaQueda(') < corpo.indexOf('AppState.profile = null'), 'o helper roda depois de o perfil sair');
});

// ═══ R15-2-F4 · o diálogo do "Sair" conta o que o lote ainda não mandou ══════
const tique = () => new Promise((ok) => setImmediate(ok));
const tiques = async (n = 6) => { for (let i = 0; i < n; i++) await tique(); };
const chaveDe = new Function(fatiar('chaveDoPedido') + '\nreturn chaveDoPedido;')();
const P = (i, extra = {}) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 77, createdBy: 'spam', ...extra });

// O diálogo do "Sair" de mentira: o aviso (texto e `hidden`) e o modal aberto.
function dialogoDoSair({ aberto = true } = {}) {
  const classes = (ini) => { const c = new Set(ini); return { contains: (x) => c.has(x), add: (x) => c.add(x), remove: (x) => c.delete(x),
    toggle: (x, f) => (f ? c.add(x) : c.delete(x)) }; };
  const aviso = { textContent: '', classList: classes(['hidden']) };
  const modal = { classList: classes(aberto ? [] : ['hidden']) };
  return { aviso, modal, document: { getElementById: (id) => (id === 'logoutSaidaAviso' ? aviso : id === 'logoutModal' ? modal : null) },
    texto: () => (aviso.classList.contains('hidden') ? '' : aviso.textContent) };
}

// O "Rejeitar os N" de verdade (`enviarLote`): cada ida fica SEGURA até o teste soltá-la.
function loteDeRejeitar({ n = 4, fila: filaInicial = [], dialogoAberto = true } = {}) {
  const tela = dialogoDoSair({ aberto: dialogoAberto });
  const places = Array.from({ length: n }, (_, i) => P(i + 1));
  const saida = filaInicial.slice();
  const portoes = [];
  const enviados = [];
  const AppState = { authenticated: true, queue: [], currentPlace: null, stats: { read: 0, rejected: n, skipped: 0 },
    serverTotal: 0, fetchEpoch: 0, hasMore: false, inFlightActions: 0 };
  const deps = {
    AppState, document: tela.document, epocaDaSessao: 0, Treino: { ativo: false },
    pedidosEmAndamento: new Set(), pedidosDoLoteSemEnviar: new Set(), escritasEsperandoAVez: new Set(),
    API: { rejectPlace: (v) => new Promise((ok) => { enviados.push(v); portoes.push(ok); }), getRegion: () => 'row' },
    callWithRetry: (fn) => fn(),
    carregarFilaDeSaida: () => saida,
    salvarFilaDeSaida: () => {},
    enfileirarSaida: (tipo, p, reg, extra, calado, lista) => { (lista || saida).push({ tipo, venueID: p.venueID, updateRequestID: p.updateRequestID }); return true; },
    tirarDaFilaDeSaida: (tipo, p) => { const i = saida.findIndex((x) => x.venueID === p.venueID); if (i >= 0) saida.splice(i, 1); return true; },
    reivindicacaoDestaAba: () => ({}), reivindicadoPorOutraAba: () => false,
    t: (k, v) => k + ':' + (v && v.n), updateInFlightIndicator: () => {},
    pousouNoWaze: (r) => !!(r && r.success),
  };
  const h = montar(['enviarLote', 'marcarEmAndamento', 'marcarLoteSemEnviar', 'redesenharAvisoDoSairSeAberto', 'desenharAvisoDoSair', 'chaveDoPedido'], deps);
  return { h, deps, tela, places, saida, portoes, enviados, AppState };
}

test('R15-2-F4: o "Sair" aberto com o "Rejeitar os N" no ar conta os pedidos que ainda não saíram — e a conta desce a cada ida', async () => {
  const m = loteDeRejeitar({ n: 4 });
  const lote = m.h.enviarLote(m.places, { regiao: 'row', gesto: {} });
  await tiques();
  assert.equal(m.enviados.length, 1, 'PRÉ-CONDIÇÃO: só a 1ª ida do lote está no ar');
  assert.equal(m.deps.pedidosEmAndamento.size, 4, 'PRÉ-CONDIÇÃO: os 4 estão em andamento desde o gesto (é o que escondia a conta)');
  assert.equal(m.saida.length, 4, 'PRÉ-CONDIÇÃO: os 4 estão anotados na fila de saída');
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:3',
    'DEFEITO: o diálogo não diz que 3 pedidos do lote ainda não saíram e o "Sair" descarta — o aviso ficou: «' + m.tela.texto() + '»');
  // A 1ª responde, a 2ª entra no ar: a conta desce SOZINHA (o diálogo segue aberto).
  m.portoes.shift()({ success: true });
  await tiques();
  assert.equal(m.enviados.length, 2);
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:2', 'a frase não acompanhou a ida seguinte do lote: «' + m.tela.texto() + '»');
  m.portoes.shift()({ success: true });
  await tiques();
  assert.equal(m.tela.texto(), 'modal.logout.saida:1', 'com um só, a frase tem que ir no singular: «' + m.tela.texto() + '»');
  m.portoes.shift()({ success: true });
  await tiques();
  assert.equal(m.tela.texto(), '', 'o último já está no ar: nada mais a descartar, e o aviso sai');
  m.portoes.shift()({ success: true });
  await lote;
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0);
  assert.equal(m.deps.pedidosEmAndamento.size, 0);
});

test('R15-2-F4: o "Sair" no meio do lote — a ida que estava no ar volta, o laço para e o conjunto não vaza (nem soma duas vezes o que está na fila de saída)', async () => {
  // Uma decisão ANTIGA na fila de saída (de outro pedido) soma com as do lote, sem repetir nenhuma.
  const m = loteDeRejeitar({ n: 3, fila: [{ tipo: 'reject', venueID: 'v99', updateRequestID: 'u99' }] });
  const lote = m.h.enviarLote(m.places, { regiao: 'row', gesto: {} });
  await tiques();
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:3', 'a conta não é a antiga (1) + as 2 do lote que não saíram: «' + m.tela.texto() + '»');
  // O "Sair" (a época muda; `handleLogout` esvazia o conjunto, ver o guard abaixo) e a ida responde.
  m.deps.epocaDaSessao++;
  m.portoes.shift()({ success: true });
  await lote;
  assert.equal(m.enviados.length, 1, 'o laço seguiu mandando depois do "Sair"');
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0, 'o lote cortado deixou pedidos no conjunto (o próximo diálogo contaria o que já não existe)');
});

test('R15-2-F4: CONTROLES — a recusa automática (o app agindo) não entra na conta; e um ✕ só (sem lote) segue sem aviso', async () => {
  const m = loteDeRejeitar({ n: 3 });
  const lote = m.h.enviarLote(m.places, { regiao: 'row', gesto: {}, contarAoLandar: true });
  await tiques();
  m.h.desenharAvisoDoSair();
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0, 'a recusa automática registrou pedidos como decisão da pessoa');
  assert.equal(m.tela.texto(), '', 'a recusa automática entrou no aviso do "Sair": «' + m.tela.texto() + '»');
  for (let i = 0; i < 3; i++) { m.portoes.shift()({ success: true }); await tiques(); }
  await lote;
  // Um pedido isolado em andamento (o ✕ do card, já no ar) e anotado na fila: já saiu, não conta.
  const um = loteDeRejeitar({ n: 1 });
  um.saida.push({ tipo: 'reject', venueID: 'v1', updateRequestID: 'u1' });
  um.deps.pedidosEmAndamento.add(chaveDe(P(1)));
  um.h.desenharAvisoDoSair();
  assert.equal(um.tela.texto(), '', 'a decisão no ar (que chega ao Waze com o "Sair" no meio) entrou no aviso');
});

// O "Marcar todos": pedaços de LOTE_LIDOS_PEDACO, e o "Sair" para o laço depois do pedaço no ar.
function marcarTodosComDialogo({ n = 5 } = {}) {
  const tela = dialogoDoSair();
  const places = Array.from({ length: n }, (_, i) => P(i + 1, { creatorId: 1000 + i }));
  const portoes = [];
  const AppState = { authenticated: true, queue: places.slice(), currentPlace: places[0], stats: { read: 0, rejected: 0, skipped: 0 },
    serverTotal: n, fetchEpoch: 0, hasMore: false, pendingAction: null, inFlightActions: 0, profile: { id: 1 } };
  const deps = {
    AppState, document: tela.document, epocaDaSessao: 0, Treino: { ativo: false }, LOTE_LIDOS_PEDACO: 2,
    pedidosEmAndamento: new Set(), pedidosDoLoteSemEnviar: new Set(), escritasEsperandoAVez: new Set(),
    loteDeLidosContado: new Set(places.map(chaveDe)), loteDeLidosEmVoo: false, lidosDoLoteNoAr: 0,
    API: { markAsReadBatch: () => new Promise((ok) => portoes.push(ok)), markAsRead: () => new Promise((ok) => portoes.push(ok)), getRegion: () => 'row' },
    callWithRetry: (fn) => fn(), acoesTravadasForaDaJanela: () => false, aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    carimboDoGesto: () => ({ dia: '2026-10-13', onde: '30', t: 1, lang: 'pt' }),
    decididosPorOutraAbaComCardAqui: new WeakSet(),
    carregarFilaDeSaida: () => [], reivindicadoPorOutraAba: () => false,
    showToast: () => ({ remover() {}, texto() {} }), t: (k, v) => k + ':' + (v && v.n),
    pousouNoWaze: (r) => !!(r && r.success), updateInFlightIndicator: () => {},
  };
  const h = montar(['handleBatchMarkRead', 'marcarEmAndamento', 'marcarLoteSemEnviar', 'redesenharAvisoDoSairSeAberto', 'desenharAvisoDoSair', 'chaveDoPedido'], deps);
  return { h, deps, tela, places, portoes, AppState };
}

test('R15-2-F4: o "Marcar todos" (pedaços de 2, 5 pedidos) — o diálogo do "Sair" conta os pedaços que ainda não saíram, e a conta desce por pedaço', async () => {
  const m = marcarTodosComDialogo({ n: 5 });
  const lote = m.h.handleBatchMarkRead();
  await tiques();
  assert.equal(m.portoes.length, 1, 'PRÉ-CONDIÇÃO: só o 1º pedaço está no ar');
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:3',
    'DEFEITO: os 3 pedidos dos pedaços seguintes ainda não saíram e o diálogo não os conta: «' + m.tela.texto() + '»');
  m.portoes.shift()({ success: true });
  await tiques();
  assert.equal(m.portoes.length, 1, 'PRÉ-CONDIÇÃO: o 2º pedaço entrou no ar');
  assert.equal(m.tela.texto(), 'modal.logout.saida:1', 'a frase não acompanhou o pedaço seguinte: «' + m.tela.texto() + '»');
  m.portoes.shift()({ success: true });
  await tiques();
  m.portoes.shift()({ success: true });
  await lote;
  assert.equal(m.tela.texto(), '');
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0, 'o lote acabou e deixou pedidos no conjunto');
});

test('R15-2-F4: o "Marcar todos" que FALHA no 1º pedaço não deixa os seguintes no conjunto (o aviso do próximo "Sair" não conta o que já não vai sair)', async () => {
  const m = marcarTodosComDialogo({ n: 5 });
  const lote = m.h.handleBatchMarkRead();
  await tiques();
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:3', 'PRÉ-CONDIÇÃO: os 3 dos pedaços seguintes estão contados');
  m.portoes.shift()({ success: false, errorCategory: 'unknown' });    // o Waze recusa de vez: o laço para
  await lote;
  assert.equal(m.portoes.length, 0, 'PRÉ-CONDIÇÃO: o 2º pedaço nunca saiu');
  assert.equal(m.deps.pedidosDoLoteSemEnviar.size, 0,
    'DEFEITO: o lote acabou sem mandar os pedaços seguintes e eles seguem no conjunto — o "Sair" seguinte diria que descarta o que nem existe mais');
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), '');
});

test('R15-2-F4: o "Sair" tira o conjunto (junto do `pedidosEmAndamento`) — e o diálogo e os lotes usam a mesma função de marcar', () => {
  const sair = fatiarDe(APP_SEM, 'handleLogout');
  assert.match(sair, /^\s+pedidosDoLoteSemEnviar\.clear\(\);/m, 'o "Sair" não esvazia o conjunto dos pedidos de lote que não saíram');
  const aviso = fatiarDe(APP_SEM, 'desenharAvisoDoSair');
  assert.match(aviso, /pedidosDoLoteSemEnviar/, 'o aviso do "Sair" não consulta o conjunto');
  for (const nome of ['enviarLote', 'handleBatchMarkRead']) {
    const corpo = fatiarDe(APP_SEM, nome);
    assert.match(corpo, /marcarLoteSemEnviar\(/, `${nome} não registra o que ainda não saiu`);
    assert.match(corpo, /marcarLoteSemEnviar\([^)]*,\s*false(, geracao)?\)/, `${nome} não solta o que saiu`);
  }
});

// ═══ R15-3-01 · o "Sair" com a escrita de foto esperando a vez do local ═════════
// A exclusão (ou a aprovação) que saiu da janela do Desfazer e espera a resposta do
// toque na lixeira (o Waze lento) não está na fila de saída: o "Sair" confirmado a
// descartava calada, e o diálogo não dizia nada.
function escritaDeFotoEsperandoOToque({ tipo = 'excluir', dialogoAberto = true } = {}) {
  const tela = dialogoDoSair({ aberto: dialogoAberto });
  const place = { venueID: 'V1', updateRequestID: 'U1', lat: 1, lon: 2 };
  const alvo = { place, id: 'img-1', idx: 0, url: 'u', regiao: 'row' };
  const enviadas = [];
  const deps = {
    document: tela.document, epocaDaSessao: 0,
    escritasDeFotoNoLocal: new Map(), esperasSoDoAquecimento: new Set(), escritasEsperandoAVez: new Set(),
    pedidosEmAndamento: new Set(), pedidosDoLoteSemEnviar: new Set(), aprovacoesNoAr: new Set(),
    carregarFilaDeSaida: () => [], reivindicadoPorOutraAba: () => false, t: (k, v) => k + ':' + (v && v.n),
    API: { saindo: false, excluirFoto: async () => { enviadas.push('excluir'); return { success: true }; },
      aprovarPedido: async () => { enviadas.push('aprovar'); return { success: true }; } },
    aplicarTravaDeAcao() {}, callWithRetry: (fn) => fn(), fotoSaiuDoMapa: () => false,
    contarIdasSemResposta: (fn) => { const f = () => fn(); f.semResposta = false; return f; }, idasSemRespostaDeAntes: () => 0,
    lembrarIdasSemResposta() {}, anotarFotoQueSaiuDoMapa() {}, aplicarNosIrmaos() {}, pousouNoWaze: (r) => !!(r && r.success),
    decididosPorOutraAbaComCardAqui: new WeakSet(), quemDecideAgora: () => null,
    Lightbox: { marcarComoAprovada() {}, desmarcarAprovada() {}, removerFoto() {} },
  };
  const h = montar(['vezDasFotosNoLocal', 'esperaAVezDoLocal', 'vezLiberada', 'esperarAVezContandoNoSair', 'redesenharAvisoDoSairSeAberto',
    'desenharAvisoDoSair', 'chaveDoPedido', 'enviarExclusao', 'esperaDaEscritaNoSair', 'enviarAprovacao'], deps);
  // O toque na lixeira: a leitura do local, presa no Waze lento.
  const toque = h.vezDasFotosNoLocal(alvo, 'aquecer');
  const envio = tipo === 'excluir' ? h.enviarExclusao(alvo) : h.enviarAprovacao(alvo);
  return { h, deps, tela, toque, envio, enviadas };
}

for (const tipo of ['excluir', 'aprovar']) {
  test(`R15-3-01: a ${tipo === 'excluir' ? 'exclusão' : 'aprovação'} de foto que espera a leitura do toque entra no aviso do "Sair" — e sai dele quando a vez chega`, async () => {
    const m = escritaDeFotoEsperandoOToque({ tipo });
    await tiques();
    assert.deepEqual(m.enviadas, [], 'PRÉ-CONDIÇÃO: a escrita espera o toque (não saiu)');
    assert.equal(m.deps.esperasSoDoAquecimento.size, 1, 'PRÉ-CONDIÇÃO: ela é uma espera só do aquecimento');
    m.h.desenharAvisoDoSair();
    assert.equal(m.tela.texto(), 'modal.logout.foto:1',
      'DEFEITO: o "Sair" descarta a escrita que espera o toque e o diálogo não diz nada (ou diz "pedido esperando envio", que a foto não é): «' + m.tela.texto() + '»');
    // O toque responde: a vez chega, a escrita sai e o aviso (o diálogo segue aberto) some sozinho.
    m.toque.soltar();
    await m.envio;
    assert.deepEqual(m.enviadas, [tipo], 'a escrita não saiu quando o toque respondeu');
    assert.equal(m.tela.texto(), '', 'a frase seguiu dizendo que a escrita seria descartada, com ela já enviada: «' + m.tela.texto() + '»');
    assert.equal(m.deps.escritasEsperandoAVez.size, 0, 'a marca da espera ficou no conjunto');
  });
}

test('R15-3-01: o aviso soma com a fila de saída, e a descarga da página (que solta a espera) tira a marca — CONTROLES', async () => {
  // Sem espera nenhuma (o toque já voltou), nada entra no aviso e o envio sai no MESMO tique.
  const livre = escritaDeFotoEsperandoOToque();
  livre.toque.soltar();
  const semEspera = livre.h.enviarExclusao({ place: { venueID: 'V2', updateRequestID: 'U2' }, id: 'i', idx: 0, url: 'u', regiao: 'row' });
  assert.deepEqual(livre.enviadas, ['excluir'], 'sem ninguém na frente a exclusão deveria sair na hora (a descarga da página depende disso)');
  await semEspera;
  livre.h.desenharAvisoDoSair();
  assert.equal(livre.tela.texto(), '');
  // A espera solta pela DESCARGA da página (o `pagehide`): a escrita sai e a marca vai embora.
  const m = escritaDeFotoEsperandoOToque();
  await tiques();
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.foto:1');
  for (const soltar of [...m.deps.esperasSoDoAquecimento]) soltar();
  await m.envio;
  assert.equal(m.deps.escritasEsperandoAVez.size, 0);
  assert.deepEqual(m.enviadas, ['excluir']);
});

test('R15-3-01: pedidos do lote e fotos na vez juntos — duas frases, cada uma com a SUA chave e a SUA conta (plural por chave)', async () => {
  const m = loteDeRejeitar({ n: 4 });
  const lote = m.h.enviarLote(m.places, { regiao: 'row', gesto: {} });
  await tiques();
  m.deps.escritasEsperandoAVez.add({});
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:3 modal.logout.foto:1',
    'as duas contas não saíram cada uma na sua frase: «' + m.tela.texto() + '»');
  m.deps.escritasEsperandoAVez.add({});
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:3 modal.logout.fotoPlural:2', 'duas fotos têm que ir no plural: «' + m.tela.texto() + '»');
  m.deps.escritasEsperandoAVez.clear();
  m.h.desenharAvisoDoSair();
  assert.equal(m.tela.texto(), 'modal.logout.saidaPlural:3', 'sem fotos na vez, a frase dos pedidos fica sozinha: «' + m.tela.texto() + '»');
  for (let i = 0; i < 4; i++) { m.portoes.shift()({ success: true }); await tiques(); }
  await lote;
});

test('R15-3-01 (estrutura): as duas escritas esperam a vez PELA função que conta, e só quando há espera (sem espera o envio sai no mesmo tique)', () => {
  for (const nome of ['enviarExclusao', 'enviarAprovacao']) {
    const corpo = fatiarDe(APP_SEM, nome);
    assert.match(corpo, /if \(esperaAVezDoLocal\(vez\)\) (\{\s*)?await esperarAVezContandoNoSair\(vez\);/, `${nome} espera a vez sem passar pela função que conta no aviso do "Sair"`);
    assert.doesNotMatch(corpo, /await vezLiberada\(/, `${nome} voltou a esperar a vez direto`);
  }
  assert.match(fatiarDe(APP_SEM, 'desenharAvisoDoSair'), /escritasEsperandoAVez\.size/, 'o aviso não soma as escritas que esperam a vez');
  assert.match(fatiarDe(APP_SEM, 'handleLogout'), /^\s+escritasEsperandoAVez\.clear\(\);/m, 'o "Sair" não esvazia as marcas');
});

// ═══ R15-6-03 · `buscar-places` e o país que não é um país ══════════════════════
import { dispatch } from '../server/core.mjs';
import { sessaoDeTeste } from './_sessao.mjs';

const NETSCAPE = (n, v) => `.waze.com\tTRUE\t/\tTRUE\t9999999999\t${n}\t${v}`;
const COOKIES = [NETSCAPE('_csrf_token', 'csrf-abc'), NETSCAPE('_web_session', 'sess-xyz')].join('\n');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

async function comWaze(responder, fn) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => { chamadas.push({ url: String(url), init }); return responder(String(url), init); };
  try { return { r: await fn(), chamadas }; } finally { globalThis.fetch = original; }
}
const buscar = async (extra) => {
  const s = await sessaoDeTeste(COOKIES);
  return comWaze(() => json({ mapIssues: {}, venues: {} }), () => dispatch('buscar-places', { ...s.dados, region: 'row', ...extra }, s.ctx));
};
const paisQueFoiAoWaze = (chamadas) => {
  const c = chamadas.find((x) => /Issues\/Search\/List/.test(x.url));
  return c ? JSON.parse(c.init.body).countryId : 'NÃO FOI';
};

test('R15-6-03: `buscar-places` com countryId que não é um inteiro positivo é o 400 de país ausente — antes do Waze, não o Brasil em silêncio', async () => {
  // Os valores que a rota lia como 30 (ou 1, ou -5) e mandava ao Waze.
  for (const v of ['abc', true, [], {}, 'NaN', 0, '0', -5, '', '30abc', '1e400', 1.5, [30], Infinity, 2 ** 60]) {
    const { r, chamadas } = await buscar({ countryId: v });
    assert.equal(r.status, 400, `countryId ${JSON.stringify(v)}: HTTP ${r.status} — a busca seguiu com ${paisQueFoiAoWaze(chamadas)}`);
    assert.equal(r.body.errorKey, 'srv.err.countryRequired', `countryId ${JSON.stringify(v)}`);
    assert.equal(chamadas.length, 0, `countryId ${JSON.stringify(v)} foi ao Waze`);
  }
});

test('R15-6-03: CONTROLES — país de verdade (número ou texto de dígitos) vai com ele; AUSENTE segue valendo 30; a busca por área não pede país', async () => {
  for (const [v, esperado] of [[73, 73], ['73', 73], [' 145 ', 145], [30, 30]]) {
    const { r, chamadas } = await buscar({ countryId: v });
    assert.equal(r.status, 200, `CONTROLE (${JSON.stringify(v)}): ${JSON.stringify(r.body).slice(0, 100)}`);
    assert.equal(paisQueFoiAoWaze(chamadas), esperado, `CONTROLE (${JSON.stringify(v)})`);
  }
  for (const extra of [{}, { countryId: undefined }, { countryId: null }]) {
    const { r, chamadas } = await buscar(extra);
    assert.equal(r.status, 200, `CONTROLE (ausente ${JSON.stringify(extra)}): ${JSON.stringify(r.body).slice(0, 100)}`);
    assert.equal(paisQueFoiAoWaze(chamadas), 30, 'o país ausente deixou de valer 30');
  }
  // "Minha área": a caixa vai e o país não (o Waze recebe `countryId: null`), com o país do app junto.
  const area = await buscar({ countryId: 73, bbox: [-46.7, -23.6, -46.5, -23.4] });
  assert.equal(area.r.status, 200);
  assert.equal(paisQueFoiAoWaze(area.chamadas), null, 'a busca por área mandou o país junto da caixa');
});

test('R15-6-03 (estrutura): as duas rotas leem o país pela MESMA função', () => {
  const core = ler('server/core.mjs');
  const semCom = semComentario(core);
  assert.match(fatiarDe(semCom, 'handleBuscarPlaces'), /inteiroDoPais\(data\.countryId\)/, 'o buscar-places não usa a função do país');
  assert.match(fatiarDe(semCom, 'handleListaEstados'), /inteiroDoPais\(data\.countryId\)/, 'o lista-estados não usa a função do país');
  assert.doesNotMatch(fatiarDe(semCom, 'handleBuscarPlaces'), /parseInt\(data\.countryId/, 'o parseInt frouxo voltou ao buscar-places');
});
