// Fila de saída, troca de conta e contadores depois da auditoria da rodada 23 (lote 27).
// O rótulo é o do relatório dessa rodada. Cada teste foi visto REPROVANDO com o conserto desfeito
// (as sabotagens estão no relatório do lote).
//
//   R23-1-01 = R23-2-F1 = R23-8-02  o item que JÁ saiu, cuja remoção da fila o aparelho recusou gravar, não é reenviado
//   R23-2-F2                        o item de outra conta/sem dono que a gravação não tirou não congela a aba
//   R23-8-01 = R23-2-F3             a troca de conta no aparelho que LÊ e não GRAVA não herda o que escreve no Waze
//   R23-1-02                        contador guardado como texto/objeto não soma como texto
//   (R23-1-03, o 401 do lote que não diz "saida.abriu" com a fila vazia, mora em `lotes-auditoria-r10.test.mjs`, ao lado do R10-2-07)
//
// O aparelho de F1/F2 é o que a rodada chamou de "modo 1": a LEITURA funciona e a ESCRITA recusa depois de a
// fila já ter itens. As funções rodam DE VERDADE, fatiadas do app.js; o que o teste não fornece vira um
// "buraco negro" (ver `contas-auditoria-r21.test.mjs`).
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
  assert.ok(m, `${nome} sumiu`);
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
  const corpo = nomes.map((n) => fatiarDe(APP_SEM, n)).join('\n');
  const fns = new Function('__escopo', `with (__escopo) {\n${corpo}\nreturn { ${nomes.join(', ')} };\n}`)(escopo);
  return { ...fns, deps, chamou };
}
const tique = () => new Promise((ok) => setImmediate(ok));
const aquietar = async () => { for (let i = 0; i < 80; i++) await tique(); };
// Espera a passada TERMINAR — por condição, com teto —, ou o instrumento dar o laço por visto (mais de 40 idas, ou a
// fila lida além do teto): sem o conserto o laço não termina, e o teste precisa vê-lo (não pendurar).
async function passar(ap) {
  let acabou = false;
  ap.esvaziarFilaDeSaida().then(() => { acabou = true; }, () => { acabou = true; });
  const fim = performance.now() + 3000;
  while (!acabou && !ap.est.estourou && ap.med.envios.length <= 40 && performance.now() < fim) await new Promise((ok) => setTimeout(ok, 2));
  await aquietar();
}

// ── o aparelho de F1/F2: LÊ sempre, GRAVA só enquanto `grava` for verdade ──────────────────────────────
const ITEM = (v, extra = {}) => ({ tipo: 'reject', venueID: 'x' + v, updateRequestID: 'y' + v, creatorId: 9, nome: 'z',
  t: 1000 + v, dia: '2026-10-15', onde: '30', lang: 'pt', conta: '111', regiao: 'row', ...extra });

function aparelho({ itens, grava = true, conta = '111', tetoDeLeituras = 400 }) {
  const guardado = new Map([['waze_places_saida', JSON.stringify(itens)]]);
  const med = { envios: [], pousos: [], leituras: 0, tirouSemEnviar: [], placar: { read: 0, rejected: itens.length, skipped: 0 } };
  const est = { grava, estourou: false };
  const AppState = { authenticated: true, profile: { id: Number(conta) }, stats: med.placar, queue: [] };
  const safeLS = {
    get: (k) => {
      // TETO do instrumento (gotcha #19): o laço síncrono do defeito não prende o processo do teste. Passado o
      // teto a fila "some" e o laço sai sozinho; o teste reprova pela contagem.
      if (k === 'waze_places_saida' && ++med.leituras > tetoDeLeituras) { est.estourou = true; return '[]'; }
      return guardado.has(k) ? guardado.get(k) : null;
    },
    set: (k, v) => { if (!est.grava) return false; guardado.set(k, String(v)); return true; },
    remove: (k) => guardado.delete(k),
  };
  const rede = (tipo) => (venue) => {
    med.envios.push(tipo + ':' + venue);
    // TETO do instrumento: mais de 40 idas é o laço sem teto — a resposta nunca chega, o teste conta e reprova.
    if (med.envios.length > 40) return new Promise(() => {});
    return new Promise((ok) => setImmediate(() => ok({ success: true })));
  };
  const deps = {
    AppState, epocaDaSessao: 0, navigator: { onLine: true }, safeLS, SAIDA_KEY: 'waze_places_saida', SAIDA_RITMO_MS: 0,
    SAIDA_TENTATIVAS_POR_ITEM: 3, CONTA_KEY: 'waze_places_conta',
    esvaziandoSaida: false, saidaPedidaDeNovo: false, saidaEsperandoConta: false, verificandoSessao: false,
    ultimaEscritaOkEm: 0, saidaRecuo: { s: null, n: 0, ate: 0 },
    saidaTiradosSemGravar: new Map(),
    pedidosEmAndamento: new Set(),
    contaAgora: () => conta, marcaDaSessao: () => 'm', saidaEmRecuo: () => false, reivindicadoPorOutraAba: () => false,
    travaDaSaida: async () => ({ reserva: false, soltar() {} }),
    API: { getSession: () => 'tok', get sessionToken() { return 'tok'; }, rejectPlace: rede('reject'), markAsRead: rede('read') },
    registrarPousoDeSaida: (tipo, place, r) => { med.pousos.push(place.venueID); },
    atenderProvaDoEsvaziamento: () => {}, updateInFlightIndicator: () => {}, updateStats: () => {}, saveStats: () => {},
    dfato: (nome) => { if (/outraConta|semDono/.test(nome)) med.tirouSemEnviar.push(nome); }, showToast: () => {}, t: (k) => k,
    sessaoVivaDepoisDe: () => false, recuarSaida: () => {}, handleUnauthorized: () => {}, marcarNaSaida: () => true,
    moverProFimDaSaida: (it) => carregar(), console,
  };
  const m = montar(['esvaziarFilaDeSaida', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'salvarFilaSemOs', 'chaveDoItemDaSaida',
    'tirarDaFilaDeSaida'], deps);
  const carregar = m.carregarFilaDeSaida;
  return { ...m, med, est, AppState, guardado, deps,
    fila: () => m.carregarFilaDeSaida().map((x) => x.venueID),
    noAparelho: () => JSON.parse(guardado.get('waze_places_saida') || '[]').map((x) => x.venueID),
    pararDeGravar() { est.grava = false; } };
}

// ═══ R23-1-01 / F1 · o item que saiu e cuja remoção NÃO gravou não é reenviado ═════════════════════════
test('F1: com o aparelho que LÊ e não GRAVA, a passada manda cada item UMA vez (3 itens → 3 envios, não um laço)', async () => {
  const ap = aparelho({ itens: [ITEM(1), ITEM(2), ITEM(3)], grava: false });
  await passar(ap);
  assert.ok(!ap.est.estourou, 'DEFEITO: a passada leu a fila do aparelho sem parar (laço)');
  assert.deepEqual(ap.med.envios, ['reject:x1', 'reject:x2', 'reject:x3'],
    `DEFEITO: ${ap.med.envios.length} envios ao Waze para 3 itens — o item que saiu foi relido e mandado de novo (${ap.med.envios.slice(0, 6).join(' ')}…)`);
  assert.deepEqual(ap.med.pousos, ['x1', 'x2', 'x3'], 'DEFEITO: o pouso (Histórico) foi contado mais de uma vez por item');
  assert.deepEqual(ap.fila(), [], 'a fila que a página enxerga deveria estar vazia — os 3 já saíram');
  assert.deepEqual(ap.noAparelho(), ['x1', 'x2', 'x3'], 'CONTROLE: o aparelho não gravou nada, a fila dele segue como estava');
});

test('F1: CONTROLE — com o aparelho que grava (e com a cota, em que encolher cabe) é o de sempre: 3 envios, fila vazia no aparelho', async () => {
  const ap = aparelho({ itens: [ITEM(1), ITEM(2), ITEM(3)], grava: true });
  await passar(ap);
  assert.deepEqual(ap.med.envios, ['reject:x1', 'reject:x2', 'reject:x3']);
  assert.deepEqual(ap.noAparelho(), []);
  assert.equal(ap.deps.saidaTiradosSemGravar.size, 0, 'CONTROLE: sobrou lembrança em memória com o aparelho gravando');
});

test('F1: o aparelho que volta a gravar esquece a lembrança, e o MESMO pedido que entra de novo (outro `t`) não é escondido', async () => {
  const ap = aparelho({ itens: [ITEM(1), ITEM(2)], grava: false });
  await passar(ap);
  assert.equal(ap.deps.saidaTiradosSemGravar.size, 2, 'PRÉ-CONDIÇÃO: os dois itens que saíram ficaram lembrados');
  // O mesmo pedido volta como outra decisão (item novo, outro `t`): não pode ser escondido pela lembrança do antigo.
  const novo = ITEM(1, { t: 9999 });
  const lista = ap.carregarFilaDeSaida();
  lista.push(novo);
  ap.est.grava = true;
  assert.equal(ap.salvarFilaDeSaida(lista), true);
  assert.deepEqual(ap.fila(), ['x1'], 'DEFEITO: o pedido que entrou de novo ficou escondido pela lembrança do que já tinha saído');
  assert.equal(ap.deps.saidaTiradosSemGravar.size, 0, 'a gravação que pegou não limpou a lembrança');
});

test('F1: a lembrança é do ITEM (chave + `t`): outro item do mesmo pedido, gravado por outra aba, não fica escondido', async () => {
  const ap = aparelho({ itens: [ITEM(1)], grava: false });
  await passar(ap);
  assert.deepEqual(ap.fila(), [], 'PRÉ-CONDIÇÃO: o item que saiu está escondido');
  const lista = JSON.parse(ap.guardado.get('waze_places_saida'));
  lista.push(ITEM(1, { t: 777777 }));          // a MESMA decisão, de novo, com outro `t` (outra aba, outra vez)
  ap.guardado.set('waze_places_saida', JSON.stringify(lista));
  assert.deepEqual(ap.carregarFilaDeSaida().map((x) => x.t), [777777],
    'DEFEITO: o item novo do mesmo pedido ficou escondido pela lembrança do antigo (nunca sairia)');
});

test('F1: `tirarDaFilaDeSaida` não devolve "tirei" sem ter gravado nem lembrado, e o item não volta na leitura seguinte', () => {
  const ap = aparelho({ itens: [ITEM(1), ITEM(2)], grava: false });
  assert.equal(ap.tirarDaFilaDeSaida('reject', { venueID: 'x1', updateRequestID: 'y1' }), true);
  assert.deepEqual(ap.fila(), ['x2'], 'DEFEITO: o item que a descarga acabou de resolver voltou na leitura (o esvaziamento o mandaria de novo)');
  // Segunda chamada pelo mesmo pedido: já não está lá (como seria com a gravação funcionando).
  assert.equal(ap.tirarDaFilaDeSaida('reject', { venueID: 'x1', updateRequestID: 'y1' }), false);
  // CONTROLE: gravando, o item sai do aparelho de verdade.
  const ok = aparelho({ itens: [ITEM(1), ITEM(2)], grava: true });
  assert.equal(ok.tirarDaFilaDeSaida('reject', { venueID: 'x1', updateRequestID: 'y1' }), true);
  assert.deepEqual(ok.noAparelho(), ['x2']);
});

test('F1: o "Sair" esquece a lembrança em memória (guard na fonte do `handleLogout`)', () => {
  const sair = fatiarDe(APP_SEM, 'handleLogout');
  assert.match(sair, /saidaTiradosSemGravar\.clear\(\)/, 'o "Sair" deixou de esquecer os itens lembrados — sobrariam pra quem entra depois');
  assert.match(APP_SEM, /^const saidaTiradosSemGravar = new Map\(\);/m);
});

// ═══ R23-2-F2 · o item de outra conta que a gravação não tirou não congela a aba ═══════════════════════
test('F2: itens de OUTRA conta com o aparelho que não grava — a passada TERMINA (sem laço síncrono) e não manda nada', async () => {
  const ap = aparelho({ itens: [ITEM(1, { conta: '999' }), ITEM(2, { conta: '999' }), ITEM(3, { conta: '999' })], grava: false });
  await passar(ap);
  assert.ok(!ap.est.estourou, `DEFEITO: o esvaziamento leu a fila ${ap.med.leituras}× — girou sem await nos itens de outra conta (a aba congelava)`);
  assert.deepEqual(ap.med.envios, [], 'DEFEITO: decisão de OUTRA conta foi ao Waze');
  assert.deepEqual(ap.med.tirouSemEnviar, ['saida.outraConta', 'saida.outraConta', 'saida.outraConta'],
    'cada item de outra conta deveria ser tirado UMA vez (o placar dele desce uma vez)');
  assert.deepEqual(ap.AppState.stats, { read: 0, rejected: 0, skipped: 0 }, 'o placar do gesto desce uma vez por item, e para em zero');
  assert.deepEqual(ap.fila(), []);
});

test('F2: itens SEM dono (de outra sessão) — o mesmo', async () => {
  const sem = (v) => { const x = ITEM(v, { s: 'outra' }); delete x.conta; return x; };
  const ap = aparelho({ itens: [sem(1), sem(2), sem(3)], grava: false });
  await passar(ap);
  assert.ok(!ap.est.estourou, 'DEFEITO: o esvaziamento girou sem await nos itens sem dono');
  assert.deepEqual(ap.med.envios, []);
  assert.deepEqual(ap.med.tirouSemEnviar, ['saida.semDono', 'saida.semDono', 'saida.semDono']);
});

test('F2: CONTROLE — gravando, os itens de outra conta saem uma vez cada e a fila do aparelho fica vazia', async () => {
  const ap = aparelho({ itens: [ITEM(1, { conta: '999' }), ITEM(2, { conta: '999' })], grava: true });
  await passar(ap);
  assert.deepEqual(ap.med.tirouSemEnviar, ['saida.outraConta', 'saida.outraConta']);
  assert.deepEqual(ap.noAparelho(), []);
});

test('F2: `esquecerOutraConta` lembra os itens da conta anterior quando o aparelho recusa a gravação', () => {
  const ap = aparelho({ itens: [ITEM(1, { conta: '999' }), ITEM(2), ITEM(3, { conta: '999' })], grava: false });
  const deps = { ...ap.deps, window: {}, soltarOLoteDeLidosDaContaAnterior: () => {}, cancelarAsRecusasQueEsperamATrava: () => {},
    soltarAsEscritasDeFotoDaSessaoQueAcabou: () => {}, esquecerAutores: () => {}, esquecerFocoAutor: () => {}, atualizarSeloDeConquista: () => {},
    esvaziarPainelDoHistorico: () => {}, esquecerEscolhasDaContaAnterior: () => {}, puladosNoInicioDaFila: 0, referenciasDoPerfil: {}, posicaoGps: {},
    avisosAdiados: [], avisosDaQueda: [], Treino: { ativo: false } };
  const m = montar(['esquecerOutraConta', 'carregarFilaDeSaida', 'salvarFilaDeSaida', 'salvarFilaSemOs', 'chaveDoItemDaSaida'], deps);
  m.esquecerOutraConta('111');
  assert.deepEqual(m.carregarFilaDeSaida().map((x) => x.venueID), ['x2'],
    'DEFEITO: os itens da conta anterior seguem na fila que a página enxerga (o esvaziamento os tiraria de novo, em laço)');
});

// ═══ R23-8-01 / F3 · a troca de conta no aparelho que LÊ e não GRAVA ═══════════════════════════════════
function montarTroca({ contaNoAparelho = null, grava = true, contaVista }) {
  const guardado = new Map(contaNoAparelho ? [['waze_places_conta', JSON.stringify(contaNoAparelho)]] : []);
  const safeLS = {
    get: (k) => (guardado.has(k) ? guardado.get(k) : null),
    set: (k, v) => { if (!grava) return false; guardado.set(k, String(v)); return true; },
    remove: (k) => guardado.delete(k),
  };
  const AppState = { stats: { read: 3, rejected: 2, skipped: 1 }, authenticated: true, profile: { id: 88 }, history: {},
    preferences: { undoEnabled: false, pularGuarda: true, comoFuncionaVisto: true } };
  const deps = {
    safeLS, localStorage: { getItem: () => null }, CONTA_KEY: 'waze_places_conta', AppState, window: {}, API: { sessionToken: null },
    contaConfirmadaNestaAba: { id: '77', s: 'a' }, contaVistaNoAparelho: contaVista, filaAtravessouSessao: true, saidaEsperandoConta: false,
    puladosNoInicioDaFila: 4, referenciasDoPerfil: {}, posicaoGps: {}, avisosAdiados: [], avisosDaQueda: [],
    invisivelPedidoAntesDoPerfil: () => null, marcaDestaAba: () => 's2', sessaoDestaAbaEhAGuardada: () => true,
    carimbarContaNaSaida: () => {}, carimbarContaNoInvisivel: () => {}, carregarFilaDeSaida: () => [], salvarFilaDeSaida: () => true,
    salvarFilaSemOs: () => true, dfato: () => {}, Treino: { ativo: false },
  };
  const h = montar(['aoConhecerConta', 'esquecerOutraConta', 'esquecerEscolhasDaContaAnterior', 'armazenamentoLegivel', 'gravarContaNoAparelho'], deps);
  return { ...h, AppState, guardado };
}

test('F3: o aparelho que LÊ e NUNCA gravou a conta — a conta nova NÃO herda o placar nem as escolhas da anterior', () => {
  // A conta guardada vem nula porque a escrita falhou desde sempre, não porque outra aba limpou.
  const m = montarTroca({ grava: false, contaVista: false });
  m.aoConhecerConta({ id: 88 });
  assert.deepEqual(m.AppState.stats, { read: 0, rejected: 0, skipped: 0 }, 'DEFEITO: a conta nova herdou o placar da anterior');
  assert.equal(m.AppState.preferences.pularGuarda, false, 'DEFEITO: a conta nova herdou o "↑ guarda o pedido" (escreve no Waze no nome dela)');
  assert.equal(m.AppState.preferences.undoEnabled, true, 'DEFEITO: a conta nova herdou o Desfazer desligado, sem ter a cota');
  assert.equal(m.deps.contaVistaNoAparelho, false, 'a gravação recusada não pode marcar a conta como vista no aparelho');
});

test('F3: CONTROLE — esta aba GRAVOU a conta e outra aba limpou o aparelho: segue na troca "só memória"', () => {
  for (const contaNoAparelho of [null, { id: '88', s: 'b' }]) {
    const m = montarTroca({ contaNoAparelho, contaVista: true });
    m.aoConhecerConta({ id: 88 });
    assert.deepEqual(m.AppState.stats, { read: 3, rejected: 2, skipped: 1 },
      `CONTROLE (${JSON.stringify(contaNoAparelho)}): a troca só da memória zerou o placar que a outra aba governa`);
    assert.equal(m.AppState.preferences.pularGuarda, true, 'CONTROLE: a troca só da memória mexeu nas preferências da outra aba');
  }
});

test('F3: a conta que o aparelho MOSTRA (lida lá) vale como "vista", mesmo sem esta aba ter gravado', () => {
  // Outra aba gravou a 88 e esta aba lê: `contaVista` nasce falso e a leitura o acende — a troca é "só memória".
  const m = montarTroca({ contaNoAparelho: { id: '88', s: 'b' }, contaVista: false });
  m.aoConhecerConta({ id: 88 });
  assert.equal(m.deps.contaVistaNoAparelho, true, 'DEFEITO: a conta lida no aparelho não marcou o aparelho como "guarda a conta"');
  assert.deepEqual(m.AppState.stats, { read: 3, rejected: 2, skipped: 1 }, 'a troca "só memória" deveria preservar o placar da outra aba');
});

test('F3: gravar a conta com sucesso acende `contaVistaNoAparelho`; recusado, não', () => {
  const ok = montarTroca({ contaVista: false });
  assert.equal(ok.gravarContaNoAparelho('{"id":"1"}'), true);
  assert.equal(ok.deps.contaVistaNoAparelho, true);
  const no = montarTroca({ contaVista: false, grava: false });
  assert.equal(no.gravarContaNoAparelho('{"id":"1"}'), false);
  assert.equal(no.deps.contaVistaNoAparelho, false);
});

test('F3: a conta que esta aba lembra do APARELHO (queda, abertura) também prova que ele a guardava', () => {
  // Sem isso, a aba que só conheceu a conta por aqui trocava de conta pela versão COMPLETA num aparelho normal e
  // apagava o Histórico/placar que a outra aba da conta nova acabou de gravar (o dano do R11-1-01).
  for (const nome of ['lembrarAContaDaQueda', 'lembrarAContaDoAparelho']) {
    const deps = { contaConfirmadaNestaAba: null, contaVistaNoAparelho: false, contaAgora: () => '111', marcaDaSessao: () => 'm', marcaDestaAba: () => 'm' };
    const m = montar([nome], deps);
    m[nome]('tok');
    assert.deepEqual(deps.contaConfirmadaNestaAba && deps.contaConfirmadaNestaAba.id, '111', `PRÉ-CONDIÇÃO (${nome}): a aba não lembrou a conta`);
    assert.equal(deps.contaVistaNoAparelho, true, `DEFEITO (${nome}): a conta veio do aparelho e a prova de que ele a guardava não acendeu`);
  }
});

test('F3: o "Sair" apaga a prova (guard na fonte) e os dois escritores da `CONTA_KEY` passam pela função', () => {
  assert.match(fatiarDe(APP_SEM, 'handleLogout'), /contaVistaNoAparelho = false/, 'o "Sair" deixou de esquecer que o aparelho guardava a conta');
  const gravacoes = APP_SEM.match(/safeLS\.set\(CONTA_KEY/g) || [];
  assert.equal(gravacoes.length, 1, 'só a `gravarContaNoAparelho` escreve a CONTA_KEY; outro escritor não acende a prova');
});

// ═══ R23-1-02 · contador guardado como texto ou objeto ═════════════════════════════════════════════════
test('R23-1-02: `contagemDoHistorico` — inteiro ≥ 0 passa; texto, fracionário, objeto, NaN e negativo valem 0', () => {
  const { contagemDoHistorico } = montar(['contagemDoHistorico'], {});
  for (const [x, esperado] of [[5, 5], [0, 0], ['9', 0], [1.5, 0], [{ a: 1 }, 0], [[3], 0], [NaN, 0], [-1, 0], [Infinity, 0], [null, 0], [undefined, 0]]) {
    assert.equal(contagemDoHistorico(x), esperado, `${JSON.stringify(x)} → ${contagemDoHistorico(x)}`);
  }
});

test('R23-1-02: `contarConquista` soma número — "9" guardado não vira "91", objeto não vira NaN', () => {
  for (const [guardado, esperado] of [['9', 1], [{ a: 1 }, 1], [4, 5], [undefined, 1], [1.5, 1]]) {
    const g = { n: { guardados: guardado }, c: {}, langs: [] };
    const gravou = [];
    const m = montar(['contagemDoHistorico', 'contarConquista'], {
      carregarConquistas: () => g, salvarConquistas: () => gravou.push(JSON.stringify(g.n)), checarConquistas: () => {},
    });
    m.contarConquista('guardados', 1);
    assert.equal(g.n.guardados, esperado, `DEFEITO: ${JSON.stringify(guardado)} + 1 → ${JSON.stringify(g.n.guardados)}`);
    assert.equal(typeof g.n.guardados, 'number');
  }
});

test('R23-1-02: `registrarRejeicaoDeAutor` soma número — a contagem guardada como texto ou objeto não vira "91" nem NaN', () => {
  for (const [guardado, esperado] of [['9', 2], [{ a: 1 }, 2], [[4], 2], [7, 8], [1.5, 2]]) {
    const a = { v: [], r: { '77': [guardado, 'spam', 3] } };
    const m = montar(['contagemDoHistorico', 'registrarRejeicaoDeAutor'], {
      loadAutores: () => a, salvarAutores: () => {}, diaDeHoje: () => 5, podarAutores: () => {}, AUTORES_MAX_VISTOS: 6000,
    });
    m.registrarRejeicaoDeAutor({ creatorId: 77, createdBy: 'spam' });
    assert.equal(a.r['77'][0], esperado, `DEFEITO: ${JSON.stringify(guardado)} → ${JSON.stringify(a.r['77'][0])}`);
  }
});

test('R23-1-02: `checarConquistas` lê os contadores pela mesma função (guard na fonte)', () => {
  const f = fatiarDe(APP_SEM, 'checarConquistas');
  for (const c of ['guardados', 'fotos', 'nomes']) {
    assert.match(f, new RegExp(`${c}: contagemDoHistorico\\(g\\.n\\.${c}\\)`), `o contador ${c} voltou a ser lido cru`);
  }
});
