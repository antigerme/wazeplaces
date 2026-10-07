// O LOTE e a PASSADA da fila de saída diante do que o card já sabia tratar
// (auditoria de 2026-10-06, rodada 8 — o lote 12 da fila):
//
//  · a APROVAÇÃO de foto que pousou com a resposta perdida (R8-2-01 = R8-3-05 =
//    R8-7-05). O ✕ e o ✓ do card já a reconheciam (R7-3-08); o "Rejeitar os N",
//    a recusa automática e o "Marcar todos" contavam um rejeitado (ou um lido)
//    no placar e no Histórico, sem o "Curador", e a folha do lote dizia "1 já
//    tratado por outro editor" sobre a aprovação da própria pessoa;
//  · a CONFERÊNCIA de sessão que começa NO MEIO de uma passada da fila de saída
//    (R8-2-02 = R8-1-06). As guardas só valiam na entrada: o ✕ que levava 401
//    com a passada dormindo o ritmo saía de novo, e os itens seguintes saíam
//    durante a conferência;
//  · o 401 no "Marcar todos" (R8-2-04): não marcava, não mandava de novo e não
//    dizia que não tinha marcado.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js: o que o teste não
// fornece vira um "buraco negro" que aceita qualquer chamada (o `montar` de
// test/costura-sessao). Cada teste foi visto REPROVANDO com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const MIN = ler('js/min/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Pula a ASSINATURA antes de casar chaves: `enviarLote(places, opts = {})` tem
// um `{}` de parâmetro padrão.
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let par = 0, i = APP_SEM.indexOf('(', m.index);
  for (let j = i; j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '(') par++;
    else if (APP_SEM[j] === ')') { par--; if (par === 0) { i = j + 1; break; } }
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
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};

// Um "buraco negro": aceita qualquer propriedade e qualquer chamada.
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

// `nomes`: as funções do app.js a rodar. `deps`: o que elas enxergam — funções
// e as variáveis de módulo (`epocaDaSessao`, `verificandoSessao`…), que elas leem
// e escrevem direto no objeto. O resto é buraco negro.
function montar(nomes, deps) {
  for (const [k, v] of Object.entries({ loteDeLidosEmVoo: false, escritasConferindo: 0, aprovandoAgora: false,
    excluindoAgora: false, renomeacoesNoAr: new Set(), extPerguntando: false, extRenovando: false,
    aprovacoesNoAr: new Set(), aprovacoesDaQueda: new Map() })) if (!(k in deps)) deps[k] = v;
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

const tique = (ms = 2) => new Promise((ok) => setTimeout(ok, ms));
// Espera por CONDIÇÃO, com teto de tempo real — nunca por prazo fixo.
async function ateQue(cond, rotulo, tetoMs = 5000) {
  const fim = performance.now() + tetoMs;
  while (!cond()) {
    if (performance.now() > fim) assert.fail(`${rotulo}: não aconteceu em ${tetoMs / 1000} s`);
    await tique(2);
  }
}

const lsFalso = () => {
  const guardado = new Map();
  return { get: (k) => (guardado.has(k) ? guardado.get(k) : null), set: (k, v) => guardado.set(k, String(v)), remove: (k) => guardado.delete(k) };
};
const chave = (p) => p.venueID + '|' + p.updateRequestID;
const GESTO = { dia: '2026-10-06', onde: '30', t: 1, lang: 'pt' };
const JA_TRATADO = { success: false, errorCategory: 'already_processed', errorKey: 'srv.err.alreadyProcessed', httpCode: 404 };
const R401 = { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.sessionExpired', httpCode: 401 };
const VIVA = { success: true, profile: { id: 111 } };
const MORTA = { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.cookiesExpired' };

// A MEMÓRIA de verdade das idas sem resposta (R6-3-04) e o desfecho da aprovação
// (R7-3-08): as mesmas funções que o card usa.
const MEMORIA = ['chaveDoPedido', 'idasSemRespostaDeAntes', 'lembrarIdasSemResposta', 'aprovacaoDelaJaPousou',
  'desfechoDaAprovacaoDela'];
// A aprovação da foto de `p` pousou e a resposta se perdeu (a rede caiu na
// volta): o app disse "Erro de conexão" e guardou a ida — é o estado que o
// `enviarAprovacao` deixa (test/lightbox-escritas, R7-3-08).
const aprovacaoSemResposta = (h, p) => h.lembrarIdasSemResposta('aprovar|' + chave(p), 1, false, h.deps.epocaDaSessao);

const foto = (i, autor = 777) => ({ venueID: 'v' + i, updateRequestID: 'uf' + i, creatorId: autor, createdBy: 'spam', purType: 'NEW_PHOTO' });
const pedido = (i, autor = 777) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: autor, createdBy: 'spam' });

// ═══ R8-2-01 · os LOTES e a aprovação que pousou sem resposta ════════════════

// O lote do autor (`enviarLote`, com a folha do resultado de verdade).
// `respostas[venueID]`: o que o Waze responde à rejeição de cada pedido.
function montarLote({ respostas, placar = 0, fila = [] }) {
  const log = [];
  const naSaida = [];
  const faltam = [];
  const els = { autorTitle: { textContent: '' }, autorCorpo: { innerHTML: '' } };
  const AppState = { authenticated: true, stats: { read: 0, rejected: placar, skipped: 0 }, serverTotal: 3, fetchEpoch: 0,
    queue: fila.slice(), currentPlace: fila[0] || null, hasMore: false, inFlightActions: 0 };
  const deps = {
    AppState, epocaDaSessao: 0, idasSemRespostaGuardadas: new Map(), IDAS_SEM_RESPOSTA_TETO: constante('IDAS_SEM_RESPOSTA_TETO'),
    Treino: { ativo: false }, callWithRetry: (fn) => fn(),
    API: { getRegion: () => 'row', rejectPlace: async (v) => respostas[v] },
    registrarPouso: (p) => log.push('pouso:' + p.venueID),
    recordHistory: (tipo, n) => log.push(`historico:${tipo}:${n}`),
    registrarRejeicaoDeAutor: (p) => log.push('reincidencia:' + p.venueID),
    registrarAcaoConfirmada: (tipo, p) => log.push('confirmada:' + p.venueID),
    contarConquista: (k) => log.push('conquista:' + k),
    // A fila de SAÍDA de mentira: o lote da pessoa anota cada pedido antes de mandar.
    carregarFilaDeSaida: () => naSaida.slice(), salvarFilaDeSaida: () => {},
    enfileirarSaida: (tipo, p) => { naSaida.push(p.venueID); return true; },
    tirarDaFilaDeSaida: (tipo, p) => { const i = naSaida.indexOf(p.venueID); if (i < 0) return false; naSaida.splice(i, 1); return true; },
    reivindicacaoDestaAba: () => ({}),
    document: { getElementById: (id) => els[id] || null },
    topOpenModal: () => null, Lightbox: { isOpen: () => false }, MapaLightbox: { isOpen: () => false },
    openModal: (id) => log.push('abriu:' + id), showToast: (m) => log.push('toast:' + m),
    t: (k, v) => (v && v.n != null ? `${k}#${v.n}` : k), escapeHtml: (x) => x,
  };
  const h = montar([...MEMORIA, 'enviarLote', 'mostrarResultadoDoLote'], deps);
  const enviar = (places, opts) => h.enviarLote(places, { regiao: 'row', gesto: GESTO, ...opts,
    aoProgredir: (n) => faltam.push(n) });
  return { h, AppState, log, naSaida, faltam, els, enviar };
}

test('R8-2-01: "Rejeitar os N" com o pedido cuja APROVAÇÃO pousou sem resposta — o desfecho é o da aprovação, não "outro editor"', async () => {
  const f1 = foto(1), x2 = pedido(2);
  const m = montarLote({ respostas: { v1: JA_TRATADO, v2: { success: true } }, placar: 2 });   // o gesto contou os 2 (otimista)
  aprovacaoSemResposta(m.h, f1);
  assert.equal(m.h.aprovacaoDelaJaPousou(f1), true, 'PRÉ-CONDIÇÃO: a memória da aprovação sem resposta não pegou');
  await m.enviar([f1, x2]);
  assert.equal(m.AppState.stats.rejected, 1,
    `DEFEITO: o pedido que a pessoa APROVOU contou como rejeitado no placar (${m.AppState.stats.rejected} de 1)`);
  assert.deepEqual(m.log.filter((l) => /^(historico|confirmada):/.test(l)), ['historico:reject:1', 'confirmada:v2'],
    'DEFEITO: a aprovação entrou no Histórico (ou nas conquistas) como rejeição');
  assert.equal(m.log.filter((l) => l === 'conquista:fotos').length, 1, 'DEFEITO: o "Curador" não contou a aprovação dela');
  assert.doesNotMatch(m.els.autorCorpo.innerHTML, /jaTratados/,
    'DEFEITO: a folha disse "já tratado por outro editor" sobre a aprovação da própria pessoa');
  // A folha conta o que ela sabe dizer: o rejeitado. A aprovação fica calada,
  // como no ✕ do card — dizer "você já tinha aprovado" pediria frase nova.
  assert.equal(m.els.autorTitle.textContent, 'autor.lote.tituloUm#1');
  assert.match(m.els.autorCorpo.innerHTML, /autor\.lote\.rejeitadosUm#1/);
  assert.ok(m.log.includes('pouso:v1'), 'o pedido resolvido pela aprovação não pousou (a busca o traria de volta)');
  assert.deepEqual(m.naSaida, [], 'a anotação do pedido aprovado ficou na fila de saída (sairia de novo)');
  assert.equal(m.h.idasSemRespostaDeAntes('aprovar|' + chave(f1)), 0, 'a memória do alvo sobreviveu ao desfecho');
  assert.equal(m.faltam.at(-1), 0, `o lote terminou dizendo que ainda falta ${m.faltam.at(-1)}`);
  // CONTROLE: sem a aprovação dela, o "já tratado" é de OUTRO editor — conta,
  // vai pro Histórico e a folha diz.
  const c = montarLote({ respostas: { v1: JA_TRATADO, v2: { success: true } }, placar: 2 });
  await c.enviar([f1, x2]);
  assert.equal(c.AppState.stats.rejected, 2, 'CONTROLE: o "já tratado" de outro editor deixou de contar');
  assert.deepEqual(c.log.filter((l) => /^historico:/.test(l)), ['historico:reject:1', 'historico:reject:1']);
  assert.ok(!c.log.includes('conquista:fotos'), 'CONTROLE: o "Curador" contou sem aprovação nenhuma');
  assert.match(c.els.autorCorpo.innerHTML, /autor\.lote\.jaTratadosUm#1/, 'CONTROLE: a folha deixou de dizer "outro editor"');
  assert.equal(c.els.autorTitle.textContent, 'autor.lote.titulo#2');
});

test('R8-2-01: a RECUSA AUTOMÁTICA (conta ao pousar) — o "Curador" conta, e o placar, que nem subiu, não desce', async () => {
  // O enviado ANTES do aprovado: o placar já tem um, e descontar o aprovado o
  // levaria a zero (com o aprovado primeiro, o `Math.max(0, …)` esconderia).
  const x2 = pedido(2), f1 = foto(1);
  const m = montarLote({ respostas: { v1: JA_TRATADO, v2: { success: true } }, fila: [pedido(9, 1)] });
  aprovacaoSemResposta(m.h, f1);
  await m.enviar([x2, f1], { silencioso: true, contarAoLandar: true });
  assert.equal(m.AppState.stats.rejected, 1,
    `DEFEITO: a recusa automática descontou do placar o que ele nunca contou (${m.AppState.stats.rejected} de 1)`);
  assert.equal(m.log.filter((l) => l === 'conquista:fotos').length, 1, 'DEFEITO: o "Curador" não contou a aprovação dela');
  assert.equal(m.AppState.serverTotal, 1, 'o pedido resolvido pela aprovação não desceu o "Restam"');
  assert.deepEqual(m.faltam, [1, 0], `o aviso da recusa terminou contando um que faltava: ${m.faltam}`);
  assert.deepEqual(m.log.filter((l) => l.startsWith('abriu:')), [], 'a recusa automática abriu a folha');
  // CONTROLE: sem a aprovação dela, nada de "Curador".
  const c = montarLote({ respostas: { v1: JA_TRATADO, v2: { success: true } }, fila: [pedido(9, 1)] });
  await c.enviar([x2, f1], { silencioso: true, contarAoLandar: true });
  assert.equal(c.AppState.stats.rejected, 1);
  assert.ok(!c.log.includes('conquista:fotos'), 'CONTROLE: o "Curador" contou sem aprovação nenhuma');
});

// O "Marcar todos" (`handleBatchMarkRead`) com o Waze de mentira na regra MEDIDA:
// o lote para no primeiro pedido já resolvido (test/lote-lidos), e o pedido que a
// aprovação resolveu está resolvido.
function montarMarcarTodos({ fila, resolvidos = [], pedaco = constante('LOTE_LIDOS_PEDACO'), loteResponde = null,
  umResponde = null, perfil = () => VIVA, quedaRefazAFila = false }) {
  const log = [];
  const chamadas = [];
  const lidos = new Set();
  const AppState = { authenticated: true, profile: { id: 111 }, queue: fila.slice(), currentPlace: fila[0],
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: fila.length, fetchEpoch: 0, hasMore: false,
    pendingAction: null, inFlightActions: 0, preferences: {} };
  const processar = (itens) => {
    for (const it of itens) {
      if (resolvidos.includes(it.updateRequestID)) return JA_TRATADO;
      lidos.add(it.updateRequestID);
    }
    return { success: true };
  };
  const mensagem = { textContent: '' };
  const deps = {
    AppState, epocaDaSessao: 0, idasSemRespostaGuardadas: new Map(), IDAS_SEM_RESPOSTA_TETO: constante('IDAS_SEM_RESPOSTA_TETO'),
    LOTE_LIDOS_PEDACO: pedaco, pedidosEmAndamento: new Set(), Treino: { ativo: false },
    TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1, 1], VERIFICA_SESSAO_MS: 0, navigator: { onLine: true },
    verificandoSessao: false, conferenciaDaSessao: null, sessaoVivaEm: { s: null, em: 0 },
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    API: {
      getRegion: () => 'row', getSession: () => 'tok-A', get sessionToken() { return 'tok-A'; },
      markAsReadBatch: async (itens) => {
        chamadas.push('lote:' + itens.map((i) => i.venueID).join('+'));
        const n = chamadas.filter((c) => c.startsWith('lote:')).length;
        return (loteResponde && loteResponde(n)) || processar(itens);
      },
      markAsRead: async (v, u) => {
        chamadas.push('um:' + v);
        const n = chamadas.filter((c) => c.startsWith('um:')).length;
        return (umResponde && umResponde(n, v)) || processar([{ venueID: v, updateRequestID: u }]);
      },
      // A sonda de verdade é uma ida ao servidor, e a resposta chega DEPOIS do 401
      // que a pediu. Respondida no MESMO milissegundo (máquina rápida), ela empatava
      // a hora da confirmação (`sessaoVivaEm.em`) com a do 401 (`levou`), e o
      // `sessaoVivaDepoisDe` — estrito, e certo — não reenviava: reprovou o CI do
      // #258 uma vez, e reprova sempre com o relógio de parede congelado ou grosso
      // (`node --import tools/relogio-grosso.mjs --test`). Responde quando o relógio
      // ANDA, com teto (relógio parado não pendura o teste: ele reprova).
      getProfile: async () => {
        chamadas.push('perfil');
        const t0 = Date.now();
        const teto = performance.now() + 2000;
        while (Date.now() <= t0 && performance.now() < teto) await tique(1);
        return perfil(chamadas.filter((c) => c === 'perfil').length);
      },
    },
    // A queda (a sonda diz MORTA): a época muda, o lote no ar sai da trava. Com
    // `quedaRefazAFila`, a fila foi refeita (outra conta entrou, o "Sair").
    derrubarSessao: () => {
      deps.epocaDaSessao++; deps.loteDeLidosEmVoo = false; AppState.authenticated = false;
      if (quedaRefazAFila) AppState.fetchEpoch++;
    },
    definirPerfil: (r) => !!(r && r.success && r.profile),
    registrarPouso: (ps) => log.push(...(Array.isArray(ps) ? ps : [ps]).map((p) => 'pouso:' + p.venueID)),
    recordHistory: (tipo, n) => log.push(`historico:${tipo}:${n}`),
    registrarLoteConfirmado: (n) => log.push('conquistas:' + n),
    contarConquista: (k) => log.push('conquista:' + k),
    carimboDoGesto: () => GESTO,
    showToast: (m, tipo) => log.push(`toast:${tipo}:${m}`), msgDoServidor: (r, d) => d,
    t: (k, v) => (v && v.n != null ? `${k}#${v.n}` : k),
    document: { getElementById: (id) => (id === 'batchReadMessage' ? mensagem : null) },
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
  };
  const h = montar([...MEMORIA, 'acoesTravadas', 'acoesTravadasForaDaJanela', 'aprovacaoDaTelaNoAr', 'avisoDaTrava',
    'marcarEmAndamento', 'marcaDaSessao', 'marcaDestaAba', 'marcarSessaoViva', 'sessaoVivaDepoisDe', 'sessaoTrocou', 'callWithRetry',
    'handleUnauthorized', 'refazerDepoisDo401', 'openBatchReadConfirm', 'handleBatchMarkRead'], deps);
  // O lote, e a conferência que ele (ou o código de antes, sem esperá-la) abriu.
  const marcarTodos = async () => {
    h.openBatchReadConfirm();
    await h.handleBatchMarkRead();
    await ateQue(() => !deps.verificandoSessao, 'a conferência da sessão terminou');
    await tique(5);
  };
  const toasts = () => log.filter((l) => l.startsWith('toast:'));
  const fila_ = () => AppState.queue.map((p) => p.venueID);
  return { h, deps, AppState, log, chamadas, lidos, marcarTodos, toasts, fila: fila_ };
}

test('R8-2-01: "Marcar todos" com o pedido cuja APROVAÇÃO pousou sem resposta — sai da fila e do "Restam" sem virar lido', async () => {
  const f1 = foto(1);
  const m = montarMarcarTodos({ fila: [f1, pedido(2), pedido(3)], resolvidos: ['uf1'] });
  aprovacaoSemResposta(m.h, f1);
  assert.equal(m.h.aprovacaoDelaJaPousou(f1), true, 'PRÉ-CONDIÇÃO: a memória da aprovação sem resposta não pegou');
  await m.marcarTodos();
  assert.deepEqual(m.chamadas, ['lote:v1+v2+v3', 'um:v1', 'um:v2', 'um:v3'],
    'PRÉ-CONDIÇÃO: o lote parou no pedido resolvido e foi um a um');
  assert.equal(m.AppState.stats.read, 2, `DEFEITO: o pedido que a pessoa APROVOU contou como lido (${m.AppState.stats.read} de 2)`);
  // No um a um cada pedido conta quando POUSA (R10-2-03): a SOMA é que diz se a
  // aprovação entrou como lido.
  const somar = (prefixo) => m.log.filter((l) => l.startsWith(prefixo)).reduce((s, l) => s + Number(l.slice(prefixo.length)), 0);
  assert.deepEqual([somar('historico:read:'), somar('conquistas:'), m.log.filter((l) => /^historico:(?!read:)/.test(l)).length],
    [2, 2, 0], 'DEFEITO: a aprovação entrou no Histórico (ou nas conquistas) como lido');
  assert.deepEqual(m.toasts(), ['toast:info:toast.batchMarkingPlural#3', 'toast:success:toast.batchDonePlural#2'],
    'DEFEITO: o aviso contou a aprovação entre os marcados como lidos');
  assert.equal(m.log.filter((l) => l === 'conquista:fotos').length, 1, 'DEFEITO: o "Curador" não contou a aprovação dela');
  assert.deepEqual(m.fila(), [], 'o pedido resolvido pela aprovação ficou na fila como card (decidível de novo)');
  assert.equal(m.AppState.serverTotal, 0, 'o "Restam" seguiu contando o pedido resolvido pela aprovação');
  assert.ok(m.log.includes('pouso:v1'), 'o pedido resolvido pela aprovação não pousou');
  assert.equal(m.h.idasSemRespostaDeAntes('aprovar|' + chave(f1)), 0, 'a memória do alvo sobreviveu ao desfecho');
  // A fila SÓ com o aprovado: nada de "0 marcados", e a fila anda.
  const so = montarMarcarTodos({ fila: [f1], resolvidos: ['uf1'] });
  aprovacaoSemResposta(so.h, f1);
  await so.marcarTodos();
  assert.deepEqual([so.fila(), so.AppState.stats.read, so.toasts()], [[], 0, ['toast:info:toast.batchMarking#1']],
    'só com o pedido aprovado na fila, o lote disse que marcou (ou não o tirou da fila)');
  // CONTROLE: sem a aprovação dela, o resolvido é de OUTRO editor — conta como lido.
  const c = montarMarcarTodos({ fila: [f1, pedido(2), pedido(3)], resolvidos: ['uf1'] });
  await c.marcarTodos();
  assert.equal(c.AppState.stats.read, 3, 'CONTROLE: o "já tratado" de outro editor deixou de contar');
  assert.deepEqual(c.toasts().at(-1), 'toast:success:toast.batchDonePlural#3');
  assert.ok(!c.log.includes('conquista:fotos'), 'CONTROLE: o "Curador" contou sem aprovação nenhuma');
});

// ═══ R8-2-04 · o "Marcar todos" que leva 401 ═════════════════════════════════

test('R8-2-04: o "Marcar todos" leva 401 e a sessão está VIVA (alarme falso) — o lote sai de novo, UMA vez, e conta', async () => {
  const m = montarMarcarTodos({ fila: [pedido(1), pedido(2), pedido(3)], loteResponde: (n) => (n === 1 ? R401 : null) });
  await m.marcarTodos();
  assert.deepEqual(m.chamadas, ['lote:v1+v2+v3', 'perfil', 'lote:v1+v2+v3'],
    'DEFEITO: com a sessão confirmada viva, o lote que levou o 401 não saiu de novo (ou saiu antes do veredito)');
  assert.equal(m.AppState.stats.read, 3, 'o lote que saiu de novo não contou');
  assert.deepEqual(m.fila(), [], 'os pedidos marcados seguiram na fila');
  assert.deepEqual(m.toasts(), ['toast:info:toast.batchMarkingPlural#3', 'toast:info:toast.sessionKeptAlive',
    'toast:success:toast.batchDonePlural#3']);
});

test('R8-2-04: a 2ª ida leva OUTRO 401 (a escrita, não a sessão) — o lote para, não confere de novo e DIZ que não marcou', async () => {
  const m = montarMarcarTodos({ fila: [pedido(1), pedido(2), pedido(3)], loteResponde: () => R401 });
  await m.marcarTodos();
  assert.deepEqual(m.chamadas, ['lote:v1+v2+v3', 'perfil', 'lote:v1+v2+v3'],
    `uma conferência e UMA 2ª ida, nada mais: ${m.chamadas.join(', ')}`);
  assert.equal(m.AppState.stats.read, 0);
  assert.deepEqual(m.fila(), ['v1', 'v2', 'v3'], 'os pedidos que não foram marcados saíram da fila');
  assert.equal(m.toasts().at(-1), 'toast:error:toast.batchError',
    `DEFEITO: o lote que não saiu ficou calado (avisos: ${m.toasts().join(' | ')})`);
});

test('R8-2-04: a sonda não CONFIRMA a sessão (rede) — o lote não sai de novo, e diz que não marcou', async () => {
  const m = montarMarcarTodos({ fila: [pedido(1), pedido(2)], loteResponde: () => R401,
    perfil: () => ({ success: false, errorCategory: 'transient' }) });
  await m.marcarTodos();
  assert.deepEqual(m.chamadas, ['lote:v1+v2', 'perfil'], 'o lote saiu de novo sem a sessão confirmada');
  assert.deepEqual(m.fila(), ['v1', 'v2']);
  assert.equal(m.toasts().at(-1), 'toast:error:toast.batchError', `DEFEITO: calado (avisos: ${m.toasts().join(' | ')})`);
});

test('R8-2-04: o 401 é a QUEDA (a sonda diz morta) — o lote não sai de novo, e diz que não marcou com a fila do gesto na tela', async () => {
  const m = montarMarcarTodos({ fila: [pedido(1), pedido(2), pedido(3)], loteResponde: () => R401, perfil: () => MORTA });
  await m.marcarTodos();
  assert.equal(m.deps.epocaDaSessao, 1, 'PRÉ-CONDIÇÃO: a sessão não caiu');
  assert.deepEqual(m.chamadas, ['lote:v1+v2+v3', 'perfil'], 'o lote saiu de novo com a sessão que caiu');
  assert.equal(m.AppState.stats.read, 0);
  assert.deepEqual(m.fila(), ['v1', 'v2', 'v3']);
  assert.deepEqual(m.toasts(), ['toast:info:toast.batchMarkingPlural#3', 'toast:error:toast.batchError'],
    'DEFEITO: a queda cortou o lote calada — a renovação diria "sua fila continua aqui" com a pessoa achando que marcou');
  // CONTROLE: a fila do gesto foi embora (o "Sair", outra conta) — não há a quem avisar.
  const c = montarMarcarTodos({ fila: [pedido(1), pedido(2)], loteResponde: () => R401, perfil: () => MORTA, quedaRefazAFila: true });
  await c.marcarTodos();
  assert.deepEqual(c.toasts(), ['toast:info:toast.batchMarkingPlural#2'], 'com a fila refeita, o lote avisou de uma fila que não está mais na tela');
});

test('R8-2-04: UMA conferência com 2ª ida por lote — o 401 de um pedaço SEGUINTE não sai de novo nem confere de novo', async () => {
  const m = montarMarcarTodos({ fila: [pedido(1), pedido(2), pedido(3), pedido(4)], pedaco: 2,
    loteResponde: (n) => (n === 1 || n === 3 ? R401 : null) });
  await m.marcarTodos();
  // O 1º pedaço: 401, conferência, 2ª ida que pousa. O 2º: 401 depois de a
  // sessão ter sido confirmada viva NESTE lote — é a escrita, não a sessão.
  assert.deepEqual(m.chamadas, ['lote:v1+v2', 'perfil', 'lote:v1+v2', 'lote:v3+v4'],
    `o 2º 401 do lote saiu de novo (ou conferiu a sessão de novo): ${m.chamadas.join(', ')}`);
  assert.equal(m.AppState.stats.read, 2);
  assert.deepEqual(m.fila(), ['v3', 'v4']);
  assert.deepEqual(m.toasts().slice(-2), ['toast:success:toast.batchDonePlural#2', 'toast:error:toast.batchError'],
    `o pedaço que saiu e o que não saiu: ${m.toasts().join(' | ')}`);
});

test('R8-2-04: o 401 no caminho UM A UM também se refaz com a sessão viva', async () => {
  // O lote para no v2 (resolvido por outro editor) e vai um a um; o v1 leva 401.
  const m = montarMarcarTodos({ fila: [pedido(1), pedido(2)], resolvidos: ['u2'], umResponde: (n) => (n === 1 ? R401 : null) });
  await m.marcarTodos();
  assert.deepEqual(m.chamadas, ['lote:v1+v2', 'um:v1', 'perfil', 'um:v1', 'um:v2'],
    'DEFEITO: o pedido do um a um que levou 401 não saiu de novo com a sessão viva');
  assert.equal(m.AppState.stats.read, 2);
  assert.deepEqual(m.fila(), []);
});

// ═══ R8-2-02 · a conferência que começa NO MEIO de uma passada da fila de saída ═══

// A passada de verdade, com o ✕ de verdade (`handleReject` → `scheduleAction` →
// `handleActionResult` → `handleUnauthorized`). O RITMO entre um item e o
// próximo fica nas mãos do teste (`ritmos`): é nele que a passada dorme, e é
// nele que a conferência começa. As respostas do Waze também (`responder`).
// Como o `_post`, a resposta que CHEGA é prova de rede e chama o esvaziamento
// (que, com a passada no ar, não faz nada).
const SAIDA_KEY = constante('SAIDA_KEY');
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();
const itemDaSaida = (v) => ({ tipo: 'reject', venueID: v, updateRequestID: 'u' + v, conta: '111', s: marcaDe('tok-A'), regiao: 'row' });
const P = (v) => ({ venueID: v, updateRequestID: 'u' + v, creatorId: 9 });

function montarPassada({ saida, fila = [] }) {
  const safeLS = lsFalso();
  safeLS.set(SAIDA_KEY, JSON.stringify(saida));
  const envios = [];        // { v, conferindo, epoca }
  const noAr = [];          // { v, ok }
  const ritmos = [];
  const RITMO = constante('SAIDA_RITMO_MS');
  const ritmo = { auto: false };
  let sonda = null;
  const AppState = {
    authenticated: true, profile: { id: 111 }, currentPlace: fila[0] || null, queue: fila.slice(),
    stats: { read: 0, rejected: saida.length, skipped: 0 }, serverTotal: 10, fetchEpoch: 0,
    preferences: { undoEnabled: false }, pendingAction: null, inFlightActions: 0,
  };
  const deps = {
    AppState, safeLS, epocaDaSessao: 0, Treino: { ativo: false }, navigator: { onLine: true },
    SAIDA_KEY, SAIDA_MAX: constante('SAIDA_MAX'), CONTA_KEY: constante('CONTA_KEY'),
    SAIDA_RECUO_401_MS: constante('SAIDA_RECUO_401_MS'), SAIDA_TENTATIVAS_POR_ITEM: constante('SAIDA_TENTATIVAS_POR_ITEM'),
    SAIDA_RITMO_MS: RITMO, TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1, 1], VERIFICA_SESSAO_MS: 0,
    ABA_DESTA_PAGINA: 'aba-teste', SAIDA_REIVINDICACAO_MS: 60000,
    esvaziandoSaida: false, saidaPedidaDeNovo: false, saidaEsperandoConta: false, verificandoSessao: false,
    conferenciaDaSessao: null, sessaoVivaEm: { s: null, em: 0 }, saidaRecuo: { s: null, n: 0, ate: 0 }, ultimaEscritaOkEm: 0,
    pedidosEmAndamento: new Set(), descargaNaFila: new WeakSet(), anotadoAntesDoEnvio: new WeakSet(),
    direcaoTravada: () => false, canDisableUndo: () => true, presencaWmeDaAcao: () => null,
    advanceQueue: () => { AppState.queue.shift(); AppState.currentPlace = AppState.queue[0] || null; },
    registrarPousoDeSaida: () => {}, rebuscarDepoisDeFalha: () => {}, definirPerfil: (r) => !!(r && r.success && r.profile),
    derrubarSessao: () => { deps.epocaDaSessao++; AppState.authenticated = false; },
    historyTodayKey: () => '2026-10-06', ondeAgora: () => '30', getLang: () => 'pt', t: (k) => k,
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null, console,
    // A trava ENTRE ABAS, sempre livre: aqui a corrida é dentro da aba.
    travaDaSaida: async () => ({ reserva: false, soltar() {} }),
    setTimeout: (fn, ms) => {
      if (ms === RITMO && !ritmo.auto) { ritmos.push(fn); return 0; }
      return setTimeout(fn, ms === RITMO ? 0 : ms);
    },
    API: {
      getRegion: () => 'row', getCountry: () => 30, getSession: () => 'tok-A', get sessionToken() { return 'tok-A'; },
      rejectPlace: (v) => {
        envios.push({ v, conferindo: deps.verificandoSessao, epoca: deps.epocaDaSessao });
        const resposta = deps.proxima ? Promise.resolve(deps.proxima(v)) : new Promise((ok) => noAr.push({ v, ok }));
        return resposta.then(async (r) => {
          await new Promise((ok) => setImmediate(ok));
          if (!deps.esvaziandoSaida) h.esvaziarFilaDeSaida();
          return r;
        });
      },
      getProfile: () => new Promise((ok) => { sonda = ok; }),
    },
  };
  const h = montar(['sessaoTrocou', 'callWithRetry', 'acoesTravadas', 'aprovacaoDaTelaNoAr', 'chaveDoPedido', 'marcaDaSessao', 'marcaDestaAba', 'contaAgora',
    'carregarFilaDeSaida', 'salvarFilaDeSaida', 'enfileirarSaida', 'marcarNaSaida', 'tirarDaFilaDeSaida', 'marcarEmAndamento',
    'reivindicacaoDestaAba', 'reivindicadoPorOutraAba', 'soltarMarcaDosItens', 'marcarSessaoViva', 'sessaoVivaDepoisDe',
    'recuarSaida', 'saidaEmRecuo', 'moverProFimDaSaida', 'esvaziarFilaDeSaida', 'handleUnauthorized',
    'handleActionResult', 'scheduleAction', 'anotarAntesDoEnvio', 'anotarSeAbriuASaida', 'carimboDoGesto', 'handleReject'], deps);
  const responder = (v, r) => {
    const i = noAr.findIndex((x) => x.v === v);
    assert.ok(i >= 0, `${v} não está no ar`);
    noAr.splice(i, 1)[0].ok(r);
  };
  return {
    h, deps, AppState, ritmos, ritmo, responder,
    envios: () => envios.map((e) => e.v),
    enviosConferindo: () => envios.filter((e) => e.conferindo).map((e) => e.v),
    noAr: (v) => noAr.some((x) => x.v === v),
    temSonda: () => !!sonda,
    responderSonda: (r) => { const s = sonda; sonda = null; s(r); },
    fila: () => JSON.parse(safeLS.get(SAIDA_KEY) || '[]').map((x) => x.venueID),
    // A passada terminou — ou mandou A MAIS do que o teste espera (com o
    // defeito, ela fica presa esperando a resposta do envio que não devia sair).
    passadaAcabouOuMandou: (n) => !deps.esvaziandoSaida || envios.length > n,
  };
}

test('R8-2-02: o ✕ que leva 401 com a passada DORMINDO o ritmo vai ao Waze UMA vez — a passada acorda e para', async () => {
  const m = montarPassada({ saida: [itemDaSaida('v1')], fila: [P('v2'), P('v3')] });
  m.h.esvaziarFilaDeSaida();                         // a rede voltou: a passada manda o v1
  await ateQue(() => m.noAr('v1'), 'o v1 no ar');
  m.h.handleReject();                                // o ✕ no v2, sem Desfazer: anotado e mandado
  await ateQue(() => m.noAr('v2'), 'o ✕ do v2 no ar');
  m.responder('v1', { success: true });              // o v1 pousa: a passada dorme o ritmo antes do próximo
  await ateQue(() => m.ritmos.length === 1, 'a passada dormindo o ritmo');
  m.responder('v2', R401);                           // o 401 do ✕ chega DURANTE o ritmo
  await ateQue(() => m.temSonda() && !m.deps.pedidosEmAndamento.has('v2|uv2'),
    'a conferência começou e o executor soltou o v2 do "em andamento"');
  assert.equal(m.deps.verificandoSessao, true, 'PRÉ-CONDIÇÃO: a conferência não está no ar');
  assert.deepEqual(m.fila(), ['v2'], 'PRÉ-CONDIÇÃO: a decisão que levou o 401 não ficou na fila de saída');
  m.ritmos.shift()();                                // a passada acorda
  await ateQue(() => m.passadaAcabouOuMandou(2), 'a passada acordou');
  await tique(10);
  assert.deepEqual(m.envios(), ['v1', 'v2'],
    `DEFEITO: a passada mandou de novo, com a conferência no ar, a decisão que acabou de levar 401: ${m.envios().join(',')}`);
  // O veredito VIVA (alarme falso): quem chama de novo é o fim da conferência, e
  // a decisão sai UMA vez, depois dele.
  m.deps.proxima = () => ({ success: true });
  m.responderSonda(VIVA);
  await ateQue(() => m.fila().length === 0, 'a fila de saída vazia depois do alarme falso');
  await tique(10);
  assert.deepEqual(m.envios(), ['v1', 'v2', 'v2'], 'confirmada a sessão, a decisão não saiu (ou saiu mais de uma vez)');
  assert.deepEqual(m.enviosConferindo(), [], 'saiu decisão com a conferência no ar');
});

test('R8-2-02: CONTROLE — o veredito MORTA: a decisão que levou o 401 espera o próximo login, sem sair de novo', async () => {
  const m = montarPassada({ saida: [itemDaSaida('v1')], fila: [P('v2'), P('v3')] });
  m.h.esvaziarFilaDeSaida();
  await ateQue(() => m.noAr('v1'), 'o v1 no ar');
  m.h.handleReject();
  await ateQue(() => m.noAr('v2'), 'o ✕ do v2 no ar');
  m.responder('v1', { success: true });
  await ateQue(() => m.ritmos.length === 1, 'a passada dormindo o ritmo');
  m.responder('v2', R401);
  await ateQue(() => m.temSonda() && !m.deps.pedidosEmAndamento.has('v2|uv2'), 'a conferência começou');
  m.ritmos.shift()();
  await ateQue(() => m.passadaAcabouOuMandou(2), 'a passada acordou');
  m.responderSonda(MORTA);
  await ateQue(() => !m.deps.verificandoSessao, 'o veredito');
  await tique(10);
  assert.deepEqual(m.envios(), ['v1', 'v2'], 'com a sessão morta, a decisão saiu de novo');
  assert.deepEqual(m.fila(), ['v2'], 'a decisão de quem perdeu a sessão tem de ficar na fila de saída');
});

test('R8-2-02 (R8-1-06): a conferência de OUTRA chamada começa no meio da passada — os itens seguintes esperam o veredito', async () => {
  const m = montarPassada({ saida: [itemDaSaida('q1'), itemDaSaida('q2'), itemDaSaida('q3')] });
  m.h.esvaziarFilaDeSaida();
  await ateQue(() => m.noAr('q1'), 'o q1 no ar');
  m.h.handleUnauthorized();                          // o 401 de outra chamada (a busca, a presença)
  await ateQue(() => m.temSonda(), 'a conferência começou');
  m.responder('q1', { success: true });
  await ateQue(() => m.ritmos.length === 1, 'a passada dormindo o ritmo');
  m.ritmos.shift()();
  await ateQue(() => m.passadaAcabouOuMandou(1), 'a passada acordou');
  await tique(10);
  assert.deepEqual(m.envios(), ['q1'],
    `DEFEITO: com a conferência no ar, a passada seguiu mandando os itens: ${m.envios().join(',')}`);
  // VIVA: o fim da conferência esvazia, e os dois saem depois do veredito.
  m.ritmo.auto = true;
  m.deps.proxima = () => ({ success: true });
  m.responderSonda(VIVA);
  await ateQue(() => m.fila().length === 0, 'a fila de saída vazia depois do alarme falso');
  assert.deepEqual(m.envios(), ['q1', 'q2', 'q3']);
  assert.deepEqual(m.enviosConferindo(), [], 'saiu item com a conferência no ar');
});

test('R8-2-02: a REDE cai no meio da passada — o próximo item não sai (o envio já nasceria condenado)', async () => {
  const rodar = async (caiu) => {
    const m = montarPassada({ saida: [itemDaSaida('q1'), itemDaSaida('q2')] });
    m.h.esvaziarFilaDeSaida();
    await ateQue(() => m.noAr('q1'), 'o q1 no ar');
    m.responder('q1', { success: true });
    await ateQue(() => m.ritmos.length === 1, 'a passada dormindo o ritmo');
    if (caiu) m.deps.navigator.onLine = false;
    m.ritmos.shift()();
    await ateQue(() => m.passadaAcabouOuMandou(1), 'a passada acordou');
    await tique(10);
    return m.envios();
  };
  assert.deepEqual(await rodar(true), ['q1'], 'DEFEITO: sem rede, a passada mandou o item seguinte');
  // CONTROLE: com a rede de pé, o item seguinte sai — o instrumento enxerga o envio.
  assert.deepEqual(await rodar(false), ['q1', 'q2'], 'CONTROLE: com rede, o item seguinte não saiu');
});

test('R8-2-02: a sessão TROCA no ritmo (a queda renovada) — a passada da sessão que caiu não manda; a da nova manda UMA vez', async () => {
  const m = montarPassada({ saida: [itemDaSaida('q1'), itemDaSaida('q2')] });
  m.h.esvaziarFilaDeSaida();
  await ateQue(() => m.noAr('q1'), 'o q1 no ar');
  m.responder('q1', { success: true });
  await ateQue(() => m.ritmos.length === 1, 'a passada dormindo o ritmo');
  m.deps.epocaDaSessao++;                            // caiu e a extensão renovou (a MESMA conta), durante o ritmo
  m.ritmos.shift()();
  await ateQue(() => m.passadaAcabouOuMandou(1), 'a passada acordou');
  await tique(10);
  assert.deepEqual(m.envios(), ['q1'],
    'DEFEITO: a passada da sessão que caiu mandou o item com a sessão nova — a resposta seria jogada fora e o item, mandado de novo');
  // A renovação chama o esvaziamento: o item sai pela passada da sessão nova, UMA vez.
  m.ritmo.auto = true;
  m.deps.proxima = () => ({ success: true });
  m.h.esvaziarFilaDeSaida();
  await ateQue(() => m.fila().length === 0, 'a fila de saída vazia depois da renovação');
  assert.deepEqual(m.envios(), ['q1', 'q2']);
});

// A guarda de cada item são as MESMAS condições da entrada (mais a sessão da
// passada), e mora depois da última espera antes do envio — o ritmo e, na
// reserva sem a trava do navegador, a reivindicação. Condição nova na entrada
// que não chegue aqui reprova: era assim que a do K14/R7-1-05 valia só no topo.
test('R8-2-02: a guarda de CADA item tem as condições da entrada — depois da última espera, antes do envio', () => {
  const f = fatiar('esvaziarFilaDeSaida');
  const entrada = /if \((!AppState\.authenticated \|\|[^\n]*?)\) \{\s*esvaziandoSaida = false;\s*trava\.soltar\(\);/.exec(f);
  assert.ok(entrada, 'a guarda de depois da espera da trava mudou de forma — o teste não a acha');
  const termos = entrada[1].split('||').map((s) => s.trim());
  assert.ok(termos.length >= 4, `a guarda da entrada perdeu condições: ${termos.join(' | ')}`);
  const iLaco = f.indexOf('while (f.length)');
  const iReivindica = f.indexOf('await reivindicarNaSaida(item)', iLaco);
  const iEnvio = f.indexOf('await API.', iLaco);
  assert.ok(iLaco > 0 && iReivindica > iLaco && iEnvio > iReivindica,
    'a ordem do laço mudou (o ritmo, a reivindicação e o envio) — o teste não sabe mais onde a guarda deve estar');
  const guarda = /if \(([^;]*?)\) break;/.exec(f.slice(iReivindica + 'await reivindicarNaSaida(item)'.length, iEnvio));
  assert.ok(guarda, 'DEFEITO: não há guarda entre a última espera e o envio — a conferência que começa no meio não para a passada');
  const cond = guarda[1].replace(/\s+/g, ' ');
  for (const t of termos) assert.ok(cond.includes(t), `DEFEITO: a guarda de cada item não confere "${t}", que a entrada confere`);
  assert.ok(cond.includes('epoca !== epocaDaSessao'), 'DEFEITO: a guarda de cada item não confere a sessão da passada');
});

// Os testes de cima fatiam o FONTE; o app carrega o `js/min/` (gotcha #22). Os
// nomes de topo sobrevivem ao minificador: quantas vezes cada um é CHAMADO tem
// de bater nos dois.
test('o bundle GERADO tem os consertos (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  for (const re of [/saidaEmRecuo\(/g, /aprovacaoDelaJaPousou\(/g, /desfechoDaAprovacaoDela\(/g, /refazerDepoisDo401\(/g]) {
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${re} — falta \`npm run js\``);
  }
});
