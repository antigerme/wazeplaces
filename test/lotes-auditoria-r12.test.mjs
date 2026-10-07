// O "Marcar todos" e a OUTRA aba no REENVIO (auditoria de 2026-10-07, rodada
// 12 — o lote 16 da fila):
//
//  · R12-2-03 — o pedaço do "Marcar todos" que leva 401 sai de novo depois da
//    conferência da sessão (R8-2-04: a sonda do perfil, segundos), e o reenvio
//    levava o pedaço montado ANTES da conferência. O R11-2-02 fez o lote
//    perguntar à outra aba antes de CADA pedaço, mas a pergunta não se repetia
//    no reenvio: o pedido que a pessoa decidiu na outra aba durante a sonda ia
//    ao Waze e contava como lido. MEDIDO no navegador (roteiro e12 da rodada
//    12): lote de 30, o 2º pedaço leva 401, a outra aba rejeita o 28º durante
//    a sonda — o reenvio leva [26..30], "Lidos 30 + Rejeitados 1" pra 30
//    pedidos e "30 pedidos marcados". O um a um tinha o mesmo mecanismo, e a
//    retentativa da rede (`callWithRetry`) também.
//
// O harness roda as funções DE VERDADE, fatiadas do app.js (o 401, a
// conferência e o reenvio são os do app: `callWithRetry`, `handleUnauthorized`,
// `refazerDepoisDo401`): o que o teste não fornece vira um "buraco negro" que
// aceita qualquer chamada (o `montar` de test/lotes-conferencia). A outra aba é
// a ANOTAÇÃO de verdade (`decididosPorOutraAbaComCardAqui`, um WeakSet), que o
// teste enche no instante em que o aviso dela chegaria: durante a sonda do
// perfil, ou entre a ida que falhou e a retentativa. Cada teste foi visto
// REPROVANDO com o conserto desfeito, e cada um carrega o CONTROLE sem a outra
// aba (o reenvio leva o pedaço inteiro e conta tudo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const MIN = ler('js/min/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Pula a ASSINATURA antes de casar chaves (um `{}` de parâmetro padrão abriria e
// fecharia na hora).
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
// Resposta de um dublê de rede: só DEPOIS de o relógio de parede andar, com
// teto (relógio parado não pendura o teste: ele reprova). Respondida no mesmo
// milissegundo, a hora da confirmação da sessão empatava com a do 401 e o
// `sessaoVivaDepoisDe` — estrito, e certo — não reenviava (o CI do #258).
async function depoisDeORelogioAndar() {
  const t0 = Date.now();
  const teto = performance.now() + 2000;
  while (Date.now() <= t0 && performance.now() < teto) await tique(1);
}

const chave = (p) => p.venueID + '|' + p.updateRequestID;
const GESTO = { dia: '2026-10-07', onde: '30', t: 1, lang: 'pt' };
const JA_TRATADO = { success: false, errorCategory: 'already_processed', errorKey: 'srv.err.alreadyProcessed', httpCode: 404 };
const R401 = { success: false, errorCategory: 'unauthorized', errorKey: 'srv.err.sessionExpired', httpCode: 401 };
const SEM_REDE = { success: false, errorCategory: 'transient', errorKey: 'srv.err.network', httpCode: 0, _motivo: 'rede' };
const VIVA = { success: true, profile: { id: 111 } };
const pedido = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 600 + i, createdBy: 'autor' + i });

// O "Marcar todos" (`openBatchReadConfirm` + `handleBatchMarkRead`) com o 401, a
// conferência e o reenvio DE VERDADE, e o Waze de mentira na regra MEDIDA: o lote
// para no primeiro pedido já resolvido (test/lote-lidos). `decididos`: a anotação
// da outra aba (o WeakSet de verdade). `naSonda`: o que acontece DURANTE a sonda
// do perfil — é ali que o aviso da outra aba chega no roteiro do auditor.
function montarMarcarTodos({ fila, decididos = new WeakSet(), resolvidos = [], pedaco = constante('LOTE_LIDOS_PEDACO'),
  loteResponde = null, umResponde = null, naSonda = null }) {
  const log = [];
  const chamadas = [];
  const AppState = { authenticated: true, profile: { id: 111 }, queue: fila.slice(), currentPlace: fila[0],
    stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: fila.length, fetchEpoch: 0, hasMore: false,
    pendingAction: null, inFlightActions: 0, preferences: {} };
  const processar = (itens) => {
    for (const it of itens) if (resolvidos.includes(it.updateRequestID)) return JA_TRATADO;
    return { success: true };
  };
  const mensagem = { textContent: '' };
  const deps = {
    AppState, epocaDaSessao: 0, idasSemRespostaGuardadas: new Map(), IDAS_SEM_RESPOSTA_TETO: constante('IDAS_SEM_RESPOSTA_TETO'),
    LOTE_LIDOS_PEDACO: pedaco, pedidosEmAndamento: new Set(), Treino: { ativo: false },
    TRANSIENT_RETRY_ATTEMPTS: 2, TRANSIENT_RETRY_DELAYS_MS: [1, 1], VERIFICA_SESSAO_MS: 0, navigator: { onLine: true },
    verificandoSessao: false, conferenciaDaSessao: null, sessaoVivaEm: { s: null, em: 0 },
    aprovacaoPendente: null, exclusaoPendente: null, renomeacaoPendente: null,
    decididosPorOutraAbaComCardAqui: decididos,
    API: {
      // A sessão NA MEMÓRIA desta aba (`marcaDestaAba`, R12-1-03, a junção do lote 16).
      getRegion: () => 'row', getSession: () => 'tok-A', sessionToken: 'tok-A',
      markAsReadBatch: async (itens) => {
        chamadas.push('lote:' + itens.map((i) => i.venueID).join('+'));
        const n = chamadas.filter((c) => c.startsWith('lote:')).length;
        await depoisDeORelogioAndar();
        return (loteResponde && loteResponde(n)) || processar(itens);
      },
      markAsRead: async (v, u) => {
        chamadas.push('um:' + v);
        const n = chamadas.filter((c) => c.startsWith('um:')).length;
        await depoisDeORelogioAndar();
        return (umResponde && umResponde(n, v)) || processar([{ venueID: v, updateRequestID: u }]);
      },
      getProfile: async () => {
        chamadas.push('perfil');
        if (naSonda) naSonda();
        await depoisDeORelogioAndar();
        return VIVA;
      },
    },
    derrubarSessao: () => { deps.epocaDaSessao++; deps.loteDeLidosEmVoo = false; AppState.authenticated = false; },
    definirPerfil: (r) => !!(r && r.success && r.profile),
    registrarPouso: (ps) => log.push(...(Array.isArray(ps) ? ps : [ps]).map((p) => 'pouso:' + p.venueID)),
    recordHistory: (tipo, n) => log.push(`historico:${tipo}:${n}`),
    registrarLoteConfirmado: (n) => log.push('conquistas:' + n),
    pousouPorOutraAba: (p, tipo) => log.push(`outraAba:${tipo}:${p.venueID}`),
    contarConquista: (k) => log.push('conquista:' + k),
    carimboDoGesto: () => GESTO,
    showToast: (m, tipo) => log.push(`toast:${tipo}:${m}`), msgDoServidor: (r, d) => d,
    t: (k, v) => (v && v.n != null ? `${k}#${v.n}` : k),
    document: { getElementById: (id) => (id === 'batchReadMessage' ? mensagem : null) },
    showCurrentPlace: () => { AppState.currentPlace = AppState.queue[0] || null; },
  };
  const h = montar(['chaveDoPedido', 'idasSemRespostaDeAntes', 'lembrarIdasSemResposta', 'aprovacaoDelaJaPousou',
    'desfechoDaAprovacaoDela', 'acoesTravadas', 'acoesTravadasForaDaJanela', 'aprovacaoDaTelaNoAr', 'avisoDaTrava',
    'marcarEmAndamento', 'marcaDaSessao', 'marcaDestaAba', 'marcarSessaoViva', 'sessaoVivaDepoisDe', 'sessaoTrocou', 'callWithRetry',
    'handleUnauthorized', 'refazerDepoisDo401', 'openBatchReadConfirm', 'handleBatchMarkRead'], deps);
  // O lote, e a conferência que ele abriu.
  const marcarTodos = async () => {
    h.openBatchReadConfirm();
    await h.handleBatchMarkRead();
    await ateQue(() => !deps.verificandoSessao, 'a conferência da sessão terminou');
    await tique(5);
  };
  const somar = (prefixo) => log.filter((l) => l.startsWith(prefixo)).reduce((s, l) => s + Number(l.slice(prefixo.length)), 0);
  const toasts = () => log.filter((l) => l.startsWith('toast:'));
  const fila_ = () => AppState.queue.map((p) => p.venueID);
  return { h, deps, AppState, log, chamadas, marcarTodos, somar, toasts, fila: fila_ };
}

// ═══ R12-2-03 · o reenvio do pedaço depois de um 401 pergunta de novo ═══════
// O roteiro do auditor (e12): 30 pedidos em pedaços de 25 + 5, o 2º leva 401, e
// a outra aba rejeita o 28º durante a sonda. Aqui, um pedaço de 3: o 1º leva o
// 401, e a outra aba decide o v2 (que não é o card da tela) durante a sonda.
test('R12-2-03: o pedaço que levou 401 sai de novo SEM o pedido que a outra aba decidiu durante a conferência — e só o que saiu conta', async () => {
  const fila = [pedido(1), pedido(2), pedido(3)];
  const decididos = new WeakSet();
  const m = montarMarcarTodos({ fila, decididos, loteResponde: (n) => (n === 1 ? R401 : null),
    naSonda: () => decididos.add(fila[1]) });
  await m.marcarTodos();
  assert.ok(decididos.has(fila[1]), 'PRÉ-CONDIÇÃO: a anotação da outra aba não chegou durante a sonda');
  assert.deepEqual(m.chamadas, ['lote:v1+v2+v3', 'perfil', 'lote:v1+v3'],
    `DEFEITO: o reenvio levou ao Waze o pedido que a outra aba decidiu durante a conferência: ${m.chamadas.join(', ')}`);
  assert.equal(m.AppState.stats.read, 2, `DEFEITO: o placar contou o pedido da outra aba (Lidos ${m.AppState.stats.read})`);
  assert.equal(m.somar('historico:read:'), 2, 'DEFEITO: o Histórico contou o pedido da outra aba');
  assert.equal(m.somar('conquistas:'), 2, 'DEFEITO: as conquistas contaram o pedido da outra aba');
  assert.deepEqual(m.log.filter((l) => l.startsWith('pouso:')), ['pouso:v1', 'pouso:v3'],
    'o pouso registrou o que não saiu daqui (ou deixou de registrar o que saiu)');
  assert.deepEqual(m.toasts(), ['toast:info:toast.batchMarkingPlural#3', 'toast:info:toast.sessionKeptAlive',
    'toast:success:toast.batchDonePlural#2'], `DEFEITO: o aviso contou o pedido da outra aba: ${m.toasts().join(' | ')}`);
  // Ele SAI da fila (decidido lá), e o "Restam" desce por ele também.
  assert.deepEqual(m.fila(), [], 'o pedido decidido na outra aba ficou na fila desta, como card');
  assert.equal(m.AppState.serverTotal, 0, 'o "Restam" seguiu contando o pedido decidido na outra aba');
  // CONTROLE: sem a outra aba decidir nada, o reenvio leva o pedaço inteiro e
  // conta os três (o instrumento distingue).
  const c = montarMarcarTodos({ fila: [pedido(1), pedido(2), pedido(3)], loteResponde: (n) => (n === 1 ? R401 : null) });
  await c.marcarTodos();
  assert.deepEqual(c.chamadas, ['lote:v1+v2+v3', 'perfil', 'lote:v1+v2+v3'], 'CONTROLE: o reenvio deixou de levar o pedaço inteiro');
  assert.equal(c.AppState.stats.read, 3, 'CONTROLE: o reenvio deixou de contar');
  assert.equal(c.toasts().at(-1), 'toast:success:toast.batchDonePlural#3');
});

// A outra aba decidiu TUDO o que o pedaço levava (menos o card da tela, que é
// dela também): o reenvio não sai, nada pousa, nada conta — e o lote não diz
// "0 marcados" nem acusa erro.
test('R12-2-03: com o pedaço inteiro decidido na outra aba durante a conferência, o reenvio NÃO sai e nada conta', async () => {
  const fila = [pedido(1), pedido(2), pedido(3)];
  const decididos = new WeakSet();
  const m = montarMarcarTodos({ fila, decididos, loteResponde: (n) => (n === 1 ? R401 : null),
    naSonda: () => { for (const p of fila) decididos.add(p); } });
  await m.marcarTodos();
  assert.deepEqual(m.chamadas, ['lote:v1+v2+v3', 'perfil'],
    `DEFEITO: o reenvio saiu com pedidos que a outra aba já tinha decidido: ${m.chamadas.join(', ')}`);
  assert.equal(m.AppState.stats.read, 0, `DEFEITO: o placar contou o que a outra aba decidiu (Lidos ${m.AppState.stats.read})`);
  assert.deepEqual(m.log.filter((l) => /^(historico|conquistas|pouso):/.test(l)), [],
    'DEFEITO: o reenvio que não saiu registrou pouso, Histórico ou conquista (mesmo com zero)');
  assert.deepEqual(m.toasts(), ['toast:info:toast.batchMarkingPlural#3', 'toast:info:toast.sessionKeptAlive'],
    `o lote que não mandou nada disse que marcou (ou acusou erro): ${m.toasts().join(' | ')}`);
  // O card da tela (decidido lá) FICA — o gesto nele é descontado e diz por quê
  // (R10-2-02); os de trás saem.
  assert.deepEqual(m.fila(), ['v1']);
  assert.equal(m.AppState.serverTotal, 1);
});

// O um a um (o Waze parou num pedido já resolvido por outro editor): o pedido que
// leva 401 sai de novo UMA vez com a sessão viva (R8-2-04) — se a outra aba não o
// decidiu durante a sonda.
test('R12-2-03: no UM A UM, o pedido que levou 401 não sai de novo se a outra aba o decidiu durante a conferência', async () => {
  // O lote para no v3 (resolvido por outro editor) e vai um a um; o v2 leva 401.
  const fila = [pedido(1), pedido(2), pedido(3), pedido(4)];
  const decididos = new WeakSet();
  const m = montarMarcarTodos({ fila, decididos, resolvidos: ['u3'], umResponde: (n) => (n === 2 ? R401 : null),
    naSonda: () => decididos.add(fila[1]) });
  await m.marcarTodos();
  assert.deepEqual(m.chamadas, ['lote:v1+v2+v3+v4', 'um:v1', 'um:v2', 'perfil', 'um:v3', 'um:v4'],
    `DEFEITO: o um a um mandou de novo o pedido que a outra aba decidiu durante a conferência: ${m.chamadas.join(', ')}`);
  // v1 e v4 marcados aqui; v3, "já tratado" por outro editor, conta como feito
  // (a régua de sempre do um a um); v2 é da outra aba.
  assert.equal(m.AppState.stats.read, 3, `DEFEITO: o placar contou o pedido da outra aba (Lidos ${m.AppState.stats.read})`);
  assert.equal(m.somar('historico:read:'), 3, 'DEFEITO: o Histórico contou o pedido da outra aba');
  assert.ok(!m.log.includes('pouso:v2'), 'DEFEITO: o pedido da outra aba pousou como lido daqui');
  assert.deepEqual(m.log.filter((l) => l.startsWith('outraAba:')), [], 'o pedido que nem saiu daqui não é "pousou por outra aba"');
  assert.equal(m.toasts().at(-1), 'toast:success:toast.batchDonePlural#3');
  assert.deepEqual(m.fila(), [], 'o pedido decidido na outra aba ficou na fila');
  assert.equal(m.AppState.serverTotal, 0);
  // CONTROLE: sem a outra aba, o v2 sai de novo e conta (o R8-2-04 segue valendo).
  const c = montarMarcarTodos({ fila: [pedido(1), pedido(2), pedido(3), pedido(4)], resolvidos: ['u3'],
    umResponde: (n) => (n === 2 ? R401 : null) });
  await c.marcarTodos();
  assert.deepEqual(c.chamadas, ['lote:v1+v2+v3+v4', 'um:v1', 'um:v2', 'perfil', 'um:v2', 'um:v3', 'um:v4'],
    'CONTROLE: o pedido do um a um que levou 401 deixou de sair de novo com a sessão viva');
  assert.equal(c.AppState.stats.read, 4);
});

// A retentativa da REDE é uma ida nova também (`callWithRetry` chama o mesmo
// `enviar`): o pedido que a outra aba decidiu entre a ida que falhou e a
// retentativa não vai nela.
test('R12-2-03: a RETENTATIVA da rede também pergunta à outra aba — o pedido decidido lá entre as idas não vai', async () => {
  const fila = [pedido(1), pedido(2), pedido(3)];
  const decididos = new WeakSet();
  // A 1ª ida fica sem resposta (a rede caiu na volta), e o aviso da outra aba
  // chega antes da retentativa.
  const m = montarMarcarTodos({ fila, decididos,
    loteResponde: (n) => { if (n === 1) { decididos.add(fila[2]); return SEM_REDE; } return null; } });
  await m.marcarTodos();
  assert.deepEqual(m.chamadas, ['lote:v1+v2+v3', 'lote:v1+v2'],
    `DEFEITO: a retentativa levou o pedido que a outra aba decidiu entre as idas: ${m.chamadas.join(', ')}`);
  assert.equal(m.AppState.stats.read, 2, `DEFEITO: o placar contou o pedido da outra aba (Lidos ${m.AppState.stats.read})`);
  assert.equal(m.toasts().at(-1), 'toast:success:toast.batchDonePlural#2');
  assert.deepEqual(m.fila(), []);
  // CONTROLE: sem a outra aba, a retentativa leva os três.
  const c = montarMarcarTodos({ fila: [pedido(1), pedido(2), pedido(3)], loteResponde: (n) => (n === 1 ? SEM_REDE : null) });
  await c.marcarTodos();
  assert.deepEqual(c.chamadas, ['lote:v1+v2+v3', 'lote:v1+v2+v3']);
  assert.equal(c.AppState.stats.read, 3);
});

test('R12-2-03: o bundle GERADO tem o conserto (senão nada disso está no ar)', () => {
  // O `enviar` do pedaço monta o que vai NA HORA da ida: a chamada do lote fica
  // dentro do ramo que confere o pedaço refiltrado, e o do um a um também. O
  // esbuild troca os nomes locais, então a forma é conferida pela ESTRUTURA.
  assert.match(MIN, /\.length\?API\.markAsReadBatch\([^)]*\),\w+\):\{success:!0\}/,
    'o js/min/app.js não monta o pedaço na hora da ida — rode `npm run js`');
  assert.match(MIN, /\?API\.markAsRead\([^)]*\):\{success:!0\}/,
    'o js/min/app.js não confere a outra aba a cada ida do um a um — rode `npm run js`');
});
