// Lote 25, rodada 21 da auditoria — as escritas da foto e a vez do local.
//
// R21-3-02 (= R21-1-01 = R21-2-01)  a conta de EXCLUSÕES da vez do local — a que trava a pílula do nome — é por
//                                    GERAÇÃO: o "Sair" a zera, a resposta de quem saiu não zera a de quem entrou, e a
//                                    ORDEM das escritas no Waze (a vez em si) atravessa a sessão
// R21-3-01                           a queda SEM renovação seguida de LOGIN novo (cookies, código, adoção, extensão) solta
//                                    as marcas "no ar" das escritas da foto; a renovação da queda (`manterFila`) não
// (O clique do fundo e o nome, R21-3-03/04, estão em test/lightbox-auditoria-r21.test.mjs; as margens laterais,
// R21-3-05, em test/telas-auditoria-r21.test.mjs; a asserção decorativa da pílula, R21-3-07, em
// test/telas-auditoria-r20.test.mjs, onde ela estava.)
//
// Os testes FATIAM o código de verdade do js/app.js (como os r14 a r20), ignoram comentário (gotcha #67) e rodam as
// funções DE VERDADE contra um navegador de mentira. O que só o navegador responde (a pílula depois do "Sair" na tela, a
// serialização no fio) mora nos blocos do tools/smoke-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const semComentario = (txt) => txt.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const SEM = semComentario(APP);

function fatiar(nome, fonte = SEM) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = fonte.indexOf('(', m.index);
  for (let j = i; j < fonte.length; j++) {
    if (fonte[j] === '(') par++;
    else if (fonte[j] === ')' && --par === 0) { i = j + 1; break; }
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

// O que o teste não fornece vira um "buraco negro" (o molde do test/fila-auditoria-r20.test.mjs).
function buracoNegro(nome, chamou) {
  return new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' || typeof k !== 'string' ? undefined : buracoNegro(nome + '.' + k, chamou)),
    apply: () => { chamou.push(nome); return buracoNegro(nome + '()', chamou); },
    set: () => true,
  });
}
function montar(nomes, deps, extra = '') {
  const chamou = [];
  const escopo = new Proxy(deps, {
    has: (t, k) => typeof k === 'string' && (k in t || !(k in globalThis)),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      return typeof k === 'string' ? buracoNegro(k, chamou) : undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const corpo = nomes.map((n) => fatiar(n)).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${extra}\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}
const tique = () => new Promise((ok) => setImmediate(ok));
async function ateQue(cond, msg, teto = 3000) {
  const fim = Date.now() + teto;
  while (!cond()) {
    if (Date.now() > fim) assert.fail('a espera estourou: ' + msg);
    await tique();
  }
}

// ═══ R21-3-02 · a vez do local atravessa o "Sair"; a PÍLULA não ═══════════════════════════════════════════
// A exclusão da sessão A que já saiu da janela do Desfazer e espera o Waze mantinha `vez.exclusoes > 0` até a
// resposta (até 45 s): "Sair" e entrar de novo com o MESMO local abria a foto com a pílula do nome `disabled`,
// calada (`acoesTravadas()` falso). A razão da trava (a exclusão que pousa fecha a camada e leva o nome em edição) não
// existe entre sessões: a resposta de A não mexe na tela de B. A ORDEM das escritas, não: a lista de fotos do local é
// substituída no Waze (gotcha #57), e a escrita de B espera a resposta de A.
function vezDeMentira() {
  const deps = {
    AppState: { geracaoDasEscritasDeFoto: 0 },
    escritasDeFotoNoLocal: new Map(), renomeacoesNoAr: new Set(), escritasConferindo: 0,
    aprovandoAgora: false, excluindoAgora: false, estadoAprovando() {}, lixeiraOcupada() {}, aplicarTravaDeAcao() {},
    API: {},
  };
  const h = montar(['vezDasFotosNoLocal', 'esperaAVezDoLocal', 'exclusaoDoLocalNoAr', 'soltarAsEscritasDeFotoDaSessaoQueAcabou'], deps);
  return { h, deps };
}

test('R21-3-02: o "Sair" destrava a pílula do local — a exclusão de quem SAIU não a trava na sessão nova, e a vez (a ordem das escritas) fica', async () => {
  const m = vezDeMentira();
  const place = { venueID: 'v1' };
  const A = m.h.vezDasFotosNoLocal({ place }, 'excluir');             // a exclusão da sessão A, no ar
  assert.equal(m.h.exclusaoDoLocalNoAr(place), true, 'PRÉ-CONDIÇÃO: a exclusão de A está na vez (a pílula trava)');
  m.h.soltarAsEscritasDeFotoDaSessaoQueAcabou();                       // o "Sair" (ou a troca de conta, ou o login novo)
  assert.equal(m.h.exclusaoDoLocalNoAr(place), false,
    'DEFEITO: a pílula do nome do local nasce TRAVADA, calada, na sessão nova, esperando a resposta da exclusão de quem saiu (até 45 s)');
  // A ORDEM no Waze atravessa a sessão: a vez segue lá, e a escrita de B espera a resposta de A (gotcha #57).
  assert.equal(m.deps.escritasDeFotoNoLocal.get('v1') && m.deps.escritasDeFotoNoLocal.get('v1').n, 1,
    'DEFEITO: o "Sair" apagou a VEZ do local — a escrita de B passaria na frente da de A no Waze (que substitui a lista inteira)');
  const aprovacaoDeB = m.h.vezDasFotosNoLocal({ place }, 'aprovar');
  assert.equal(m.h.esperaAVezDoLocal(aprovacaoDeB), true, 'CONTROLE: a escrita de B não espera a de A');
  let liberada = false;
  aprovacaoDeB.anterior.then(() => { liberada = true; });
  await tique(); await tique();
  assert.equal(liberada, false, 'DEFEITO: a escrita de B foi liberada antes da resposta de A');
  assert.equal(m.h.exclusaoDoLocalNoAr(place), false, 'CONTROLE: uma APROVAÇÃO no ar não trava a pílula (ela não tira foto da camada)');
  A.soltar();                                                          // a resposta de A chega
  await tique(); await tique();
  assert.equal(liberada, true, 'a resposta de A não liberou a vez de B');
  aprovacaoDeB.soltar();
  assert.equal(m.deps.escritasDeFotoNoLocal.size, 0, 'a vez não esvaziou com todos soltos');
});

test('R21-3-02: a resposta de A NÃO destrava a pílula enquanto a exclusão de B, do mesmo local, segue na vez — e a de B destrava', async () => {
  const m = vezDeMentira();
  const place = { venueID: 'v1' };
  const A = m.h.vezDasFotosNoLocal({ place }, 'excluir');
  m.h.soltarAsEscritasDeFotoDaSessaoQueAcabou();                       // o "Sair"
  const B = m.h.vezDasFotosNoLocal({ place }, 'excluir');             // B exclui no mesmo local (espera a vez de A)
  assert.equal(m.h.exclusaoDoLocalNoAr(place), true, 'PRÉ-CONDIÇÃO: a exclusão de B trava a pílula (o R11-3-06 da sessão nova)');
  A.soltar();                                                          // chega a resposta de A
  await tique(); await tique();
  assert.equal(m.h.exclusaoDoLocalNoAr(place), true,
    'DEFEITO: a resposta da exclusão de quem saiu destravou a pílula com a exclusão de B ainda na vez (a que fecha a camada quando pousa)');
  A.soltar();                                                          // idempotente: a segunda chamada não desconta de novo
  assert.equal(m.h.exclusaoDoLocalNoAr(place), true, 'a segunda chamada do mesmo punho descontou outra vez');
  B.soltar();
  assert.equal(m.h.exclusaoDoLocalNoAr(place), false, 'CONTROLE: a resposta da própria sessão destrava a pílula');
  assert.equal(m.deps.escritasDeFotoNoLocal.size, 0);
  // Dois "Sair" seguidos: a geração é por contagem, não um bit.
  const C = m.h.vezDasFotosNoLocal({ place }, 'excluir');
  m.h.soltarAsEscritasDeFotoDaSessaoQueAcabou();
  m.h.soltarAsEscritasDeFotoDaSessaoQueAcabou();
  const D = m.h.vezDasFotosNoLocal({ place }, 'excluir');
  C.soltar();
  assert.equal(m.h.exclusaoDoLocalNoAr(place), true, 'DEFEITO (dois "Sair"): a resposta da geração 0 descontou a da geração 2');
  D.soltar();
  assert.equal(m.h.exclusaoDoLocalNoAr(place), false);
});

test('R21-3-02: a conta é por LOCAL — o "Sair" destrava todos, e o aquecimento da lixeira nunca contou como exclusão', () => {
  const m = vezDeMentira();
  const a = { venueID: 'v1' }, b = { venueID: 'v2' };
  m.h.vezDasFotosNoLocal({ place: a }, 'excluir');
  m.h.vezDasFotosNoLocal({ place: b }, 'excluir');
  m.h.vezDasFotosNoLocal({ place: { venueID: 'v3' } }, 'aquecer');
  assert.deepEqual([a, b, { venueID: 'v3' }].map((p) => m.h.exclusaoDoLocalNoAr(p)), [true, true, false], 'PRÉ-CONDIÇÃO');
  m.h.soltarAsEscritasDeFotoDaSessaoQueAcabou();
  assert.deepEqual([a, b].map((p) => m.h.exclusaoDoLocalNoAr(p)), [false, false], 'DEFEITO: o "Sair" só destravou um dos locais');
  assert.equal(m.deps.escritasDeFotoNoLocal.size, 3, 'as vezes dos três locais têm de seguir (a ordem das escritas no Waze)');
});

// A mesma coisa com a exclusão de VERDADE (`enviarExclusao`): a escrita de B só vai ao Waze depois da resposta de A, a
// pílula destrava entre o "Sair" e a exclusão de B, trava de novo com a de B, e solta com a resposta dela.
test('R21-3-02: de ponta a ponta — a exclusão de B, no mesmo local, espera a resposta de A e a pílula acompanha a SESSÃO DE AGORA', async () => {
  const portoes = [];
  const deps = {
    AppState: { geracaoDasEscritasDeFoto: 0, authenticated: true, queue: [] },
    epocaDaSessao: 1, escritasDeFotoNoLocal: new Map(), renomeacoesNoAr: new Set(), escritasConferindo: 0,
    aprovandoAgora: false, excluindoAgora: false, estadoAprovando() {}, lixeiraOcupada() {}, aplicarTravaDeAcao() {},
    API: { excluirFoto: (venueID, id) => new Promise((ok) => portoes.push({ venueID, id, responder: ok })), saindo: false },
    callWithRetry: (fn) => fn(),
    esperasSoDoAquecimento: new Set(), escritasEsperandoAVez: new Set(), redesenharAvisoDoSairSeAberto() {},
    idasSemRespostaGuardadas: new Map(), IDAS_SEM_RESPOSTA_TETO: 50, fotosQueSairamDoMapa: new Map(), FOTOS_QUE_SAIRAM_TETO: 50,
    pedidoAindaNaTela: () => false, aplicarNosIrmaos() {}, mantendoFocoNoCard() {}, showToast() {}, msgDoServidor: () => '', t: (k) => k,
    devolverFoto() {}, escritaDoLightboxSemSessao() {}, refazerDepoisDo401: async () => null, Lightbox: { removerFoto() {} },
  };
  const h = montar(['enviarExclusao', 'esperaDaEscritaNoSair', 'vezDasFotosNoLocal', 'esperaAVezDoLocal', 'vezLiberada', 'esperarAVezContandoNoSair',
    'exclusaoDoLocalNoAr', 'soltarAsEscritasDeFotoDaSessaoQueAcabou', 'fotoSaiuDoMapa', 'anotarFotoQueSaiuDoMapa', 'contarIdasSemResposta',
    'idasSemRespostaDeAntes', 'lembrarIdasSemResposta'], deps);
  const placeA = { venueID: 'v1', updateRequestID: 'uA' }, placeB = { venueID: 'v1', updateRequestID: 'uB' };
  const a = h.enviarExclusao({ id: 'f1', place: placeA, idx: 0, url: 'x', regiao: 'row' });
  await ateQue(() => portoes.length === 1, 'a exclusão de A saiu');
  assert.equal(h.exclusaoDoLocalNoAr(placeA), true, 'PRÉ-CONDIÇÃO: a exclusão de A está no ar');
  deps.epocaDaSessao++;                                                // o "Sair" (a época sobe na primeira linha dele)
  h.soltarAsEscritasDeFotoDaSessaoQueAcabou();
  assert.equal(h.exclusaoDoLocalNoAr(placeB), false, 'DEFEITO: a pílula do mesmo local nasce travada na sessão nova');
  const b = h.enviarExclusao({ id: 'f2', place: placeB, idx: 0, url: 'y', regiao: 'row' });
  await tique(); await tique();
  assert.equal(h.exclusaoDoLocalNoAr(placeB), true, 'a exclusão de B, na vez, trava a pílula da sessão dela');
  assert.equal(portoes.length, 1, 'DEFEITO: a exclusão de B foi ao Waze antes da resposta de A — a lista de fotos do local é substituída (gotcha #57)');
  portoes[0].responder({ success: true, restantes: [] });             // a resposta de A
  await a;
  await ateQue(() => portoes.length === 2, 'a exclusão de B sair depois da resposta de A');
  assert.equal(h.exclusaoDoLocalNoAr(placeB), true, 'DEFEITO: a resposta de A destravou a pílula com a exclusão de B no ar');
  portoes[1].responder({ success: true, restantes: [] });
  await b;
  assert.equal(h.exclusaoDoLocalNoAr(placeB), false, 'CONTROLE: a resposta de B destrava a pílula');
  assert.equal(deps.escritasDeFotoNoLocal.size, 0);
});

// A conta da pílula mora no próprio `vez` (a geração é um campo dele), e não no `AppState`: o harness que fatia a vez
// com o buraco negro não precisa dele — duas leituras de `AppState.x` sem `AppState` declarado dariam dois proxies
// diferentes, e o `===` nunca seria verdadeiro.
test('R21-3-02 (estrutura): a geração da vez é do próprio `vez` — o `soltar` não lê o `AppState`', () => {
  const vez = fatiar('vezDasFotosNoLocal');
  assert.doesNotMatch(vez, /AppState/, 'a vez voltou a depender do AppState (o harness com buraco negro compararia dois proxies)');
  assert.match(vez, /const geracao = vez\.geracao;/, 'a exclusão deixou de capturar a geração em que entrou');
  assert.match(vez, /if \(excluir && v\.geracao === geracao\) v\.exclusoes = Math\.max\(0, v\.exclusoes - 1\);/,
    'o `soltar` voltou a descontar a conta de outra geração (ou sem piso)');
  const solta = fatiar('soltarAsEscritasDeFotoDaSessaoQueAcabou');
  assert.match(solta, /for \(const vez of escritasDeFotoNoLocal\.values\(\)\) \{\s*vez\.geracao = \(vez\.geracao \|\| 0\) \+ 1;\s*vez\.exclusoes = 0;\s*\}/,
    'o "Sair" não zera a conta de exclusões das vezes');
  // E NÃO apaga a vez: a ordem das escritas no Waze atravessa a sessão.
  assert.doesNotMatch(solta, /escritasDeFotoNoLocal\.(clear|delete)\(/, 'o "Sair" apagou a vez do local (a ordem das escritas no Waze)');
});

// ═══ R21-3-01 · a queda SEM renovação seguida de LOGIN novo ═══════════════════════════════════════════════
// A `derrubarSessao` não solta de propósito (a renovação com a MESMA conta e a fila que ATRAVESSA reabriria a 2ª
// aprovação do mesmo pedido). Mas se a extensão não renova, a pessoa entra de novo — mesma conta ou outra — com a fila
// REFEITA: as marcas, globais, seguiam ligadas até a resposta da sessão que caiu (até 45 s) e o "Aprovar" (com o giro), a
// lixeira — de QUALQUER pedido — e a pílula do mesmo local nasciam travados, calados.
function marcasNoAr() {
  return {
    AppState: { geracaoDasEscritasDeFoto: 0, authenticated: false, queue: [], preferences: {} },
    aprovandoAgora: true, excluindoAgora: true, escritasConferindo: 2, renomeacoesNoAr: new Set(['v1']),
    escritasDeFotoNoLocal: new Map([['v1', { ultima: null, n: 1, exclusoes: 1, escritas: 1, geracao: 0 }]]),
  };
}
function loginComMarcas(extra = {}) {
  const deps = {
    ...marcasNoAr(),
    estadoAprovando(v) { deps.aprovandoAgora = !!v; }, lixeiraOcupada(v) { deps.excluindoAgora = !!v; }, aplicarTravaDeAcao() {},
    // O que o login faz fora do assunto: nada.
    authInFlight: false, resgateEmVoo: false, resgateNoAr: null, setAuthLoading() {}, showToast: () => ({ dispensar() {} }), t: (k) => k,
    guardarPrazoDaSessao() {}, aoEntrarNestaPagina() {}, focoNaTelaDeEntrada: () => false, fecharModaisDaEntrada() {},
    showMainScreen() { deps.AppState.authenticated = true; }, resetQueue() { deps.fila = (deps.fila || 0) + 1; }, conhecerContaDoLogin() {},
    loadProfileAndAuxData: () => Promise.resolve(), startFetching() {}, esvaziarFilaDeSaida() {}, showAccessDenied() {},
    msgDoServidor: () => '', textoDigitadoNaEntrada: () => false, abrirComSessaoSalva() {},
    BOTAO_DA_ACAO: { left: '.card-btn-reject' }, focoDoTeclado: null, extPerguntando: false,
    safeLS: { get: () => 'tok-do-aparelho' },
    document: { getElementById: () => ({ classList: { contains: () => false } }) },
    ...extra,
  };
  return deps;
}
const marcasSoltas = (deps) => ({
  aprovando: deps.aprovandoAgora, excluindo: deps.excluindoAgora, renomeando: deps.renomeacoesNoAr.size, conferindo: deps.escritasConferindo,
  excl: deps.escritasDeFotoNoLocal.get('v1').exclusoes, geracao: deps.AppState.geracaoDasEscritasDeFoto,
});
const SOLTAS = { aprovando: false, excluindo: false, renomeando: 0, conferindo: 0, excl: 0, geracao: 1 };
const AINDA_NO_AR = { aprovando: true, excluindo: true, renomeando: 1, conferindo: 2, excl: 1, geracao: 0 };

test('R21-3-01: o login por COOKIES depois de uma queda sem renovação solta as marcas da foto — e a fila é refeita', async () => {
  const deps = loginComMarcas({ API: { testCookies: async () => ({ success: true, conta: '12345' }), temSessaoNaMemoria: () => false } });
  const h = montar(['authenticateWithCookies', 'soltarAsEscritasDeFotoDaSessaoQueAcabou'], deps);
  assert.deepEqual(marcasSoltas(deps), AINDA_NO_AR, 'PRÉ-CONDIÇÃO: as marcas da sessão que caiu estão ligadas');
  await h.authenticateWithCookies('cookies');
  assert.equal(deps.fila, 1, 'PRÉ-CONDIÇÃO: o login não refez a fila');
  assert.deepEqual(marcasSoltas(deps), SOLTAS,
    'DEFEITO: o "Aprovar", a lixeira e a pílula do nome de quem entrou nascem travados, calados, até a resposta da sessão que caiu');
});

test('R21-3-01: o login por CÓDIGO (pareamento) solta as marcas da foto', async () => {
  const deps = loginComMarcas({
    API: { resgatarPareamento: async () => ({ success: true, conta: '12345' }), temSessaoNaMemoria: () => false },
    document: { getElementById: () => ({ classList: { contains: () => false } }) },
  });
  const h = montar(['resgatarPareamento', 'soltarAsEscritasDeFotoDaSessaoQueAcabou'], deps);
  assert.equal(await h.resgatarPareamento('ABC123', { silencioso: true }), true, 'PRÉ-CONDIÇÃO: o resgate não entrou');
  assert.equal(deps.fila, 1);
  assert.deepEqual(marcasSoltas(deps), SOLTAS, 'DEFEITO: o login por código deixou as marcas da foto da sessão que caiu ligadas');
});

test('R21-3-01: a ADOÇÃO da sessão que outra aba guardou solta as marcas da foto', () => {
  const deps = loginComMarcas({ API: { temSessaoNaMemoria: () => false, getSession() {} } });
  const h = montar(['adotarSessaoDoAparelho', 'soltarAsEscritasDeFotoDaSessaoQueAcabou'], deps);
  assert.equal(h.adotarSessaoDoAparelho(), true, 'PRÉ-CONDIÇÃO: a adoção não aconteceu');
  assert.equal(deps.fila, 1);
  assert.deepEqual(marcasSoltas(deps), SOLTAS, 'DEFEITO: a adoção deixou as marcas da foto da sessão que caiu ligadas');
});

// A extensão: a janela de mentira repassa a resposta da ponte pelo `message`, como a de verdade.
function extensaoComMarcas() {
  const ouvintes = new Set();
  const window = {
    location: { origin: 'https://app' },
    addEventListener: (tipo, fn) => { if (tipo === 'message') ouvintes.add(fn); },
    removeEventListener: (tipo, fn) => ouvintes.delete(fn),
    postMessage() {},
  };
  const deps = loginComMarcas({
    window, MODAIS_DA_ENTRADA: [], API: { setSession() {}, temSessaoNaMemoria: () => false, sessionToken: null },
    EXT_PRESENTE_MS: 350, EXT_ESPERA_MS: 8000, epocaDaSessao: 0, extRenovando: false, extNegadoNestaPagina: false, extNegado: null,
    saiuNestaPagina: false, filaAtravessouSessao: false, setTimeout: () => 1, clearTimeout() {}, updatePendingCount() {},
    mostrarEntrandoPelaExtensao() {},
  });
  const h = montar(['entrarPelaExtensao', 'soltarAsEscritasDeFotoDaSessaoQueAcabou'], deps);
  const responder = (data) => {
    for (const fn of [...ouvintes]) fn({ source: window, origin: window.location.origin, data: { source: 'wazeplaces-ext', ...data } });
  };
  return { h, deps, responder };
}

test('R21-3-01: a extensão que ENTRA (a abertura e a volta à aba: fila refeita) solta as marcas — a RENOVAÇÃO da queda (`manterFila`) não', async () => {
  const entra = extensaoComMarcas();
  const p = entra.h.entrarPelaExtensao({ silencioso: true });
  entra.responder({ action: 'sessao', token: 'tok-ext', conta: '12345' });
  assert.equal(await p, true, 'PRÉ-CONDIÇÃO: a extensão não entrou');
  assert.equal(entra.deps.fila, 1, 'PRÉ-CONDIÇÃO: a extensão que entra refaz a fila');
  assert.deepEqual(marcasSoltas(entra.deps), SOLTAS, 'DEFEITO: a extensão que entra com a fila refeita deixou as marcas ligadas');
  // A renovação da queda: a fila ATRAVESSA, a escrita segue no ar e pousa nela — soltar reabriria a 2ª aprovação do mesmo pedido.
  const renova = extensaoComMarcas();
  const pr = renova.h.entrarPelaExtensao({ silencioso: true, manterFila: true });
  renova.responder({ action: 'sessao', token: 'tok-ext', conta: '12345' });
  assert.equal(await pr, true);
  assert.equal(renova.deps.fila, undefined, 'PRÉ-CONDIÇÃO: a renovação da queda refez a fila (ela atravessa)');
  assert.deepEqual(marcasSoltas(renova.deps), AINDA_NO_AR,
    'DEFEITO: a renovação da queda com a fila que ATRAVESSA soltou as marcas — a 2ª aprovação do mesmo pedido reabriria');
});

test('R21-3-01 (estrutura): só os logins que REFAZEM a fila soltam — o censo dos que entram, a `derrubarSessao` e o ramo `manterFila` ficam de fora', () => {
  // O censo: quem chama o `aoEntrarNestaPagina()` é um login. Login novo que aparecer tem de decidir: refaz a fila? solta.
  const loginsQueEntram = [...SEM.matchAll(/^(?:async )?function (\w+)\([^)]*\) \{[\s\S]*?^\}/gm)]
    .filter((m) => /^\s+aoEntrarNestaPagina\(\);/m.test(m[0]) && m[1] !== 'aoEntrarNestaPagina').map((m) => m[1]).sort();
  assert.deepEqual(loginsQueEntram, ['adotarSessaoDoAparelho', 'authenticateWithCookies', 'entrarPelaExtensao', 'resgatarPareamento'],
    'apareceu (ou sumiu) um caminho de login: decida se ele refaz a fila e então solta as marcas da foto da sessão que caiu');
  for (const nome of ['adotarSessaoDoAparelho', 'authenticateWithCookies', 'resgatarPareamento']) {
    assert.match(fatiar(nome), /^\s+resetQueue\(\);[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s+soltarAsEscritasDeFotoDaSessaoQueAcabou\(\);/m,
      `${nome}: refaz a fila e não solta as escritas da foto da sessão que caiu`);
  }
  const ext = fatiar('entrarPelaExtensao');
  const i = ext.indexOf('if (manterFila) {');
  const j = ext.indexOf('} else {', i);
  assert.ok(i > 0 && j > i, 'o `if (manterFila)` do entrarPelaExtensao mudou de forma');
  const ramoManter = ext.slice(i, j);
  const ramoRefaz = ext.slice(j, ext.indexOf('\n            }', j) + 14);
  assert.doesNotMatch(ramoManter, /soltarAsEscritasDeFotoDaSessaoQueAcabou/, 'a renovação da queda (a fila que atravessa) soltou as escritas da foto');
  assert.match(ramoRefaz, /resetQueue\(\);[\s\S]*soltarAsEscritasDeFotoDaSessaoQueAcabou\(\);/, 'o ramo que refaz a fila não solta as escritas da foto');
  // A queda mesma: a escrita segue no ar (a renovação com a MESMA conta mantém a fila e ela pousa nela).
  assert.doesNotMatch(fatiar('derrubarSessao'), /soltarAsEscritasDeFotoDaSessaoQueAcabou/, 'a queda com a mesma conta soltou a escrita da foto no ar');
  // O resto de quem chama continua sendo o "Sair" e a troca de conta.
  assert.match(fatiar('handleLogout'), /^\s+soltarAsEscritasDeFotoDaSessaoQueAcabou\(\);/m);
  assert.match(fatiar('esquecerOutraConta'), /^\s+soltarAsEscritasDeFotoDaSessaoQueAcabou\(\);/m);
});
