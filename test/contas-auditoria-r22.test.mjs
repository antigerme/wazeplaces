// Contas, fila de saída, campo do código e Histórico depois da auditoria da rodada 22 (lote 26).
// O rótulo é o do relatório dessa rodada. Cada teste foi visto REPROVANDO com o conserto desfeito
// (as sabotagens estão no relatório do lote).
//
//   R22-1-A1 = R22-8-01  o texto que entra no campo do código SEM `paste` (insertText, arrastar, sugestão do teclado)
//   R22-1-A2             a fila de saída que não GRAVOU (aparelho ilegível, cota cheia) não "guarda" nada
//   R22-1-A3             a troca de conta com o aparelho ilegível não herda o que escreve no Waze
//   R22-7-02             os leitores do Histórico leem só número — os mesmos, pela mesma função
//
// As funções rodam DE VERDADE, fatiadas do app.js; o que o teste não fornece vira um "buraco negro" (ver
// `contas-auditoria-r21.test.mjs`). O `safeLS` é o de VERDADE, do api.js, sobre um armazenamento de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP = ler('js/app.js');
const APP_SEM = semComentario(APP);
const SAFELS_FONTE = /^const safeLS = \{[\s\S]*?^\};/m.exec(ler('js/api.js'))[0];

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
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP);
  assert.ok(m, `sumiu a constante ${nome}`);
  return new Function(`return ${m[1]};`)();
};
const tique = () => new Promise((ok) => setImmediate(ok));

// ── os armazenamentos de mentira ────────────────────────────────────────────────────────────────────
const negado = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
const cheio = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
// Um aparelho: `ilegivel` (tudo lança), `cotaCheia` (lê, mas a escrita lança) ou o normal.
function aparelho(modo = 'normal', inicial = {}) {
  const dados = new Map(Object.entries(inicial));
  const localStorage = modo === 'ilegivel'
    ? { getItem: negado, setItem: negado, removeItem: negado }
    : {
      getItem: (k) => (dados.has(k) ? dados.get(k) : null),
      setItem: modo === 'cotaCheia' ? cheio : (k, v) => { dados.set(k, String(v)); },
      removeItem: (k) => { dados.delete(k); },
    };
  const safeLS = new Function('localStorage', SAFELS_FONTE + '\nreturn safeLS;')(localStorage);
  return { dados, localStorage, safeLS };
}
const MODOS = ['normal', 'ilegivel', 'cotaCheia'];
const SAIDA_KEY = constante('SAIDA_KEY');
const CONTA_KEY = constante('CONTA_KEY');
const pedido = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, creatorId: 900 + i, createdBy: 'autor' + i });

// ═══ R22-1-A2 · a fila de saída que não GRAVOU não "guarda" nada ═════════════════════════════════════
// `salvarFilaDeSaida` engolia o erro e o `enfileirarSaida` devolvia `true`: a decisão "anotada" nunca esteve
// no aparelho, o `tirarDaFilaDeSaida` não a achava no pouso e o `handleActionResult` concluía "outra aba a
// tirou" (`pousouPorOutraAba`) — sem Histórico, sem reincidência, sem conquista, sem o aviso de consequência;
// e a falha de rede "guardava" a decisão numa fila que não existe, sem aviso (MEDIDO: ✓ ✕ ✓ → placar 2/1,
// Histórico 0/0, `saida.saiuPorOutro` 3).
function montarSaida(modo, extra = {}, nomesExtras = []) {
  const ap = aparelho(modo);
  const eventos = [];
  const deps = {
    safeLS: ap.safeLS, SAIDA_KEY, SAIDA_MAX: 1000,
    contaAgora: () => '77', marcaDestaAba: () => 's1', historyTodayKey: () => '2026-10-15', ondeAgora: () => '30',
    getLang: () => 'pt', API: { getRegion: () => 'row' }, reivindicacaoDestaAba: () => ({}),
    decididosPorOutraAbaComCardAqui: new WeakSet(), chaveDoPedido: (p) => p.venueID + '|' + p.updateRequestID,
    dfato: (k) => eventos.push('diario:' + k), updateInFlightIndicator: () => eventos.push('indicador'),
    descargaNaFila: new WeakSet(), anotadoAntesDoEnvio: new WeakSet(),
    ...extra,
  };
  const h = montar(['carregarFilaDeSaida', 'salvarFilaDeSaida', 'salvarFilaSemOs', 'chaveDoItemDaSaida', 'enfileirarSaida', 'anotarAntesDoEnvio', 'tirarDaFilaDeSaida', ...nomesExtras], deps);
  return { ...h, ap, eventos };
}

test('R22-1-A2: `salvarFilaDeSaida` diz se GRAVOU — o aparelho normal sim; o ilegível e o de cota cheia não', () => {
  for (const [modo, esperado] of [['normal', true], ['ilegivel', false], ['cotaCheia', false]]) {
    const m = montarSaida(modo);
    assert.equal(m.salvarFilaDeSaida([{ tipo: 'read' }]), esperado, `DEFEITO (${modo}): a gravação ${esperado ? 'pegou' : 'não pegou'} e a função disse o contrário`);
  }
});

test('R22-1-A2: o `safeLS.set` do api.js devolve se gravou (é o que o `salvarFilaDeSaida` lê)', () => {
  assert.equal(aparelho('normal').safeLS.set('k', 'v'), true);
  assert.equal(aparelho('ilegivel').safeLS.set('k', 'v'), false, 'DEFEITO: a escrita recusada voltou como se tivesse pegado');
  assert.equal(aparelho('cotaCheia').safeLS.set('k', 'v'), false, 'DEFEITO: a cota cheia voltou como se tivesse pegado');
});

test('R22-1-A2: `enfileirarSaida` e `anotarAntesDoEnvio` só dizem `true` com a decisão NO aparelho', () => {
  for (const [modo, esperado] of [['normal', true], ['ilegivel', false], ['cotaCheia', false]]) {
    const m = montarSaida(modo);
    assert.equal(m.enfileirarSaida('reject', pedido(1), 'row', {}), esperado, `DEFEITO (${modo}): o enfileirar mentiu sobre a gravação`);
    const p2 = pedido(2);
    assert.equal(m.anotarAntesDoEnvio('read', p2, 'row', {}), esperado, `DEFEITO (${modo}): a anotação antes do envio mentiu`);
    assert.equal(m.deps.anotadoAntesDoEnvio.has(p2), esperado, `DEFEITO (${modo}): a decisão ficou marcada como anotada sem estar na fila`);
    if (!esperado) {
      assert.ok(!m.eventos.includes('diario:saida.abriu'), `DEFEITO (${modo}): o diário disse que a fila abriu, e ela não existe`);
      assert.ok(!m.eventos.includes('indicador'), `DEFEITO (${modo}): o indicador "esperando envio" acendeu sem nada esperando`);
    }
  }
  // CONTROLE: o repetido segue repetido (a fila que LEU o item), e a fila cheia segue sem anotar.
  const n = montarSaida('normal');
  n.enfileirarSaida('reject', pedido(1), 'row', {});
  assert.equal(n.enfileirarSaida('reject', pedido(1), 'row', {}), 'repetida', 'CONTROLE: o mesmo pedido deixou de ser "repetida"');
  const c = montarSaida('normal', { SAIDA_MAX: 1 });
  c.enfileirarSaida('reject', pedido(1), 'row', {});
  assert.equal(c.enfileirarSaida('reject', pedido(2), 'row', {}), false, 'CONTROLE: a fila cheia anotou');
});

// O `handleActionResult` de verdade, sobre a fila de saída de verdade e o aparelho de cada modo.
function montarDecisao(modo) {
  const gravou = [];
  const AppState = { stats: { read: 0, rejected: 0, skipped: 0 }, serverTotal: 10, queue: [], currentPlace: null };
  const m = montarSaida(modo, {
    AppState, registrarPouso: () => gravou.push('pouso'),
    recordHistory: (tipo) => gravou.push('historico:' + tipo), registrarRejeicaoDeAutor: () => gravou.push('autor'),
    avisarConsequencia: () => gravou.push('consequencia'), registrarAcaoConfirmada: (tipo) => gravou.push('confirmada:' + tipo),
    pousouPorOutraAba: (p, tipo) => gravou.push('outraAba:' + tipo),
    aprovacaoDelaJaPousou: () => false, dlog: () => {}, showToast: (msg, tipo) => gravou.push('toast:' + tipo),
    devolverPedidoRecusado: (p) => gravou.push('devolvido:' + p.venueID), updateStats: () => {}, saveStats: () => {},
    soltarMarcaDosItens: () => {}, marcarNaSaida: () => {}, anotarSeAbriuASaida: () => {}, handleUnauthorized: () => {},
    msgDoServidor: (r, padrao) => padrao, t: (k) => k, aoMudarAFilaPorBaixo: () => {},
  }, ['handleActionResult']);
  return { ...m, gravou, AppState };
}

test('R22-1-A2: a decisão que NÃO coube na fila de saída conta no pouso (Histórico, reincidência, aviso, conquistas) — não é "outra aba"', () => {
  for (const modo of MODOS) {
    const m = montarDecisao(modo);
    const p = pedido(1);
    m.AppState.stats.rejected = 1;
    const anotou = m.anotarAntesDoEnvio('reject', p, 'row', {});
    m.handleActionResult('reject', p, { success: true }, 'row', 0, {});
    if (modo === 'normal') {
      assert.equal(anotou, true, 'CONTROLE: o aparelho normal anotou');
      assert.deepEqual(m.carregarFilaDeSaida(), [], 'CONTROLE: o item anotado saiu da fila no pouso');
    }
    assert.deepEqual(m.gravou, ['pouso', 'historico:reject', 'autor', 'consequencia', 'confirmada:reject'],
      `DEFEITO (${modo}): o pouso não contou a decisão — ${JSON.stringify(m.gravou)}`);
  }
});

test('R22-1-A2: a falha de REDE de uma decisão que não coube na fila reverte o placar e AVISA (não a "guarda" onde não há fila)', () => {
  for (const modo of ['ilegivel', 'cotaCheia']) {
    const m = montarDecisao(modo);
    const p = pedido(1);
    m.AppState.stats.read = 1;
    m.anotarAntesDoEnvio('read', p, 'row', {});
    m.handleActionResult('read', p, { success: false, errorCategory: 'transient' }, 'row', 0, {});
    assert.equal(m.AppState.stats.read, 0, `DEFEITO (${modo}): o placar contou uma decisão que não saiu nem ficou guardada`);
    assert.ok(m.gravou.includes('devolvido:v1'), `DEFEITO (${modo}): o pedido não voltou a ser card`);
    assert.ok(m.gravou.includes('toast:error'), `DEFEITO (${modo}): a decisão se perdeu sem aviso`);
  }
  // CONTROLE: com o aparelho normal a decisão FICA na fila, o placar é mantido e não há aviso.
  const n = montarDecisao('normal');
  const p = pedido(1);
  n.AppState.stats.read = 1;
  n.anotarAntesDoEnvio('read', p, 'row', {});
  n.handleActionResult('read', p, { success: false, errorCategory: 'transient' }, 'row', 0, {});
  assert.equal(n.AppState.stats.read, 1, 'CONTROLE: o placar do trabalho que ficou guardado desceu');
  assert.deepEqual(n.carregarFilaDeSaida().map((x) => x.venueID), ['v1'], 'CONTROLE: a decisão não ficou na fila');
  assert.ok(!n.gravou.includes('toast:error'), 'CONTROLE: avisou de erro com a decisão guardada');
});

test('R22-1-A2: o "Rejeitar os N" também não anota o que a gravação recusou (guard na fonte do `enviarLote`)', () => {
  const lote = fatiarDe(APP_SEM, 'enviarLote');
  assert.match(lote, /salvarFilaDeSaida\(lista\) === false\)\s*anotados\.clear\(\)/,
    'o lote que a gravação recusou segue achando que os pedidos estão anotados');
});

// ═══ R22-1-A3 · a troca de conta com o aparelho ILEGÍVEL não herda o que escreve no Waze ═════════════════
// `antes` vem do `safeLS` (nulo quando não lê): a troca caía no ramo "só memória", que foi desenhado para
// "outra aba já limpou o aparelho" e NÃO zera o placar nem as escolhas (o ↑ que guarda o pedido, o Desfazer
// desligado) — a conta 88 herdava tudo da 77 (MEDIDO: placar `read: 3`, `pularGuarda`, `undoEnabled: false`).
function montarTroca(modo, { contaNoAparelho = null } = {}) {
  const inicial = contaNoAparelho ? { [CONTA_KEY]: JSON.stringify(contaNoAparelho) } : {};
  const ap = aparelho(modo, inicial);
  const AppState = {
    stats: { read: 3, rejected: 2, skipped: 1 }, authenticated: true, profile: { id: 88 }, history: {},
    preferences: { undoEnabled: false, pularGuarda: true, comoFuncionaVisto: true },
  };
  const deps = {
    safeLS: ap.safeLS, localStorage: ap.localStorage, CONTA_KEY, AppState, window: {}, API: { sessionToken: null },
    contaConfirmadaNestaAba: { id: '77', s: 'a' }, contaVistaNoAparelho: true, filaAtravessouSessao: true, saidaEsperandoConta: false,
    puladosNoInicioDaFila: 4, referenciasDoPerfil: {}, posicaoGps: {}, avisosAdiados: [], avisosDaQueda: [],
    invisivelPedidoAntesDoPerfil: () => null, marcaDestaAba: () => 's2', sessaoDestaAbaEhAGuardada: () => true,
    carimbarContaNaSaida: () => {}, carimbarContaNoInvisivel: () => {}, carregarFilaDeSaida: () => [], salvarFilaDeSaida: () => true,
    dfato: () => {}, Treino: { ativo: false },
  };
  const h = montar(['aoConhecerConta', 'esquecerOutraConta', 'esquecerEscolhasDaContaAnterior', 'armazenamentoLegivel'], deps);
  return { ...h, AppState, ap };
}

test('R22-1-A3: com o aparelho ILEGÍVEL a conta que entra NÃO herda o placar nem as escolhas da anterior', () => {
  for (const modo of ['ilegivel']) {
    const m = montarTroca(modo);
    m.aoConhecerConta({ id: 88 });
    assert.deepEqual(m.AppState.stats, { read: 0, rejected: 0, skipped: 0 }, `DEFEITO (${modo}): a conta nova herdou o placar da anterior`);
    assert.equal(m.AppState.preferences.pularGuarda, false, `DEFEITO (${modo}): a conta nova herdou o "↑ guarda o pedido" (escreve no Waze no nome dela)`);
    assert.equal(m.AppState.preferences.undoEnabled, true, `DEFEITO (${modo}): a conta nova herdou o Desfazer desligado, sem ter a cota`);
    assert.equal(m.deps.puladosNoInicioDaFila, 0, `DEFEITO (${modo}): a base dos pulados da anterior ficou`);
  }
});

test('R22-1-A3: CONTROLE — o aparelho que LÊ e já foi limpo pela outra aba segue na troca "só memória" (o placar de lá não se mexe)', () => {
  // Outra aba entrou com a 88 e limpou o aparelho: a conta guardada é a 88, ou não há nenhuma. Esta aba só esquece a memória.
  for (const contaNoAparelho of [null, { id: '88', s: 'b' }]) {
    const m = montarTroca('normal', { contaNoAparelho });
    m.aoConhecerConta({ id: 88 });
    assert.deepEqual(m.AppState.stats, { read: 3, rejected: 2, skipped: 1 },
      `CONTROLE (${JSON.stringify(contaNoAparelho)}): a troca só da memória zerou o placar que a outra aba governa`);
    assert.equal(m.AppState.preferences.pularGuarda, true, 'CONTROLE: a troca só da memória mexeu nas preferências da outra aba');
  }
  // E o aparelho que lê e mostra OUTRA conta faz a troca completa, como sempre.
  const m = montarTroca('normal', { contaNoAparelho: { id: '77', s: 'a' } });
  m.aoConhecerConta({ id: 88 });
  assert.deepEqual(m.AppState.stats, { read: 0, rejected: 0, skipped: 0 }, 'CONTROLE: a troca de sempre deixou de zerar o placar');
  assert.equal(m.AppState.preferences.pularGuarda, false, 'CONTROLE: a troca de sempre deixou de zerar o "↑ guarda"');
});

// ═══ R22-1-A1 · o texto que entra no campo do código SEM `paste` ═════════════════════════════════════
// O colar era o único caminho tratado. O `insertText` do IME, a sugestão da área de transferência do teclado
// do celular e o arrastar-e-soltar passavam só pelo `input`, que formata os seis primeiros alfanuméricos: o
// link virava "HTT-PSP" e a recusa dizia "Código inválido ou expirado" com o segredo ainda valendo.
const SEGREDO = 'K7Q9ZXM2P4R6T8VBWCDE';
const LINK = `https://places.wazebrasil.com/#pair=${SEGREDO}`;
function montarCampo() {
  const resgates = [];
  const pareamento = { PAIR_CODE_LEN: constante('PAIR_CODE_LEN'), PAIR_CODE_GRUPO: constante('PAIR_CODE_GRUPO'),
    PAIR_ALFABETO: constante('PAIR_ALFABETO'), PAIR_SEGREDO_LEN: constante('PAIR_SEGREDO_LEN') };
  const m = montar(['formatarCodigoPareamento', 'extrairCodigoPareamento', 'extrairSegredoDoLinkDePareamento', 'aplicarTextoNoCampoDoCodigo',
    'colarCodigoPareamento', 'textoEntrouDeUmaVezNoCampo'], { ...pareamento, window: {}, resgatarPareamento: (s) => resgates.push(s) });
  return { ...m, resgates };
}
// Os ouvintes do campo, como o `setupEventListeners` os liga: lidos da FONTE e executados sobre um campo de mentira.
function ouvintesDoCampo() {
  const m = montarCampo();
  const campo = { value: '', selectionStart: 0, setSelectionRange() {}, ouvintes: {},
    addEventListener(tipo, fn) { this.ouvintes[tipo] = fn; } };
  const blocos = [...APP_SEM.matchAll(/\$\('pairCodeInput'\)\?\.addEventListener\('(beforeinput|input)',[\s\S]*?\n    \}\);/g)];
  assert.equal(blocos.length, 2, 'sumiu um dos ouvintes (beforeinput, input) do campo do código');
  const corpo = blocos.map((b) => b[0].replace("$('pairCodeInput')?.", 'campo.')).join('\n');
  new Function('campo', 'formatarCodigoPareamento', 'aplicarTextoNoCampoDoCodigo', 'extrairSegredoDoLinkDePareamento', 'textoEntrouDeUmaVezNoCampo', corpo)(
    campo, m.formatarCodigoPareamento, m.aplicarTextoNoCampoDoCodigo, m.extrairSegredoDoLinkDePareamento, m.textoEntrouDeUmaVezNoCampo);
  return { ...m, campo };
}
// O que o NAVEGADOR faz com `texto` inserido de uma vez: o `beforeinput` (cancelável), a inserção, e o `input`.
function inserindo(c, texto, { inputType = 'insertText', antes = '', comoData = true, cancelavel = true, isComposing = false } = {}) {
  c.campo.value = antes;
  let impedido = false;
  const ev = { target: c.campo, inputType, isComposing, cancelable: cancelavel, data: comoData ? texto : null,
    dataTransfer: comoData ? null : { getData: () => texto }, preventDefault() { if (cancelavel) impedido = true; } };
  c.campo.ouvintes.beforeinput(ev);
  if (impedido) return { impedido, campo: c.campo.value };
  c.campo.value = antes + texto;
  c.campo.selectionStart = c.campo.value.length;
  c.campo.ouvintes.input({ target: c.campo, inputType, isComposing, data: comoData ? texto : null });
  return { impedido, campo: c.campo.value };
}

test('R22-1-A1: o LINK que entra por `insertText` resgata com o segredo — o campo não vira "HTT-PSP"', () => {
  const c = ouvintesDoCampo();
  const r = inserindo(c, LINK);
  assert.deepEqual(c.resgates, [SEGREDO], `DEFEITO: o link inserido sem colar não resgatou (campo: ${JSON.stringify(r.campo)})`);
  assert.equal(r.impedido, true, 'o link entrou no campo em vez de ser impedido (o campo não guarda o link)');
  assert.equal(r.campo, '', 'o campo ficou com lixo no lugar do que havia');
});

test('R22-1-A1: o link por OUTROS caminhos (arrastar-e-soltar, substituição do teclado) também resgata', () => {
  for (const inputType of ['insertFromDrop', 'insertReplacementText']) {
    const c = ouvintesDoCampo();
    inserindo(c, LINK, { inputType, comoData: inputType === 'insertReplacementText' });
    assert.deepEqual(c.resgates, [SEGREDO], `DEFEITO (${inputType}): o link não resgatou`);
  }
  // E sem o `beforeinput` cancelável (WebView antigo), a rede do `input` pega o link já dentro do campo e o tira.
  const c = ouvintesDoCampo();
  const r = inserindo(c, LINK, { cancelavel: false });
  assert.deepEqual(c.resgates, [SEGREDO], 'DEFEITO: sem o beforeinput cancelável o link não resgatou');
  assert.equal(r.campo, '', 'o link ficou dentro do campo do código');
});

test('R22-1-A1: o código DENTRO de uma frase que entra de uma vez vira o código (não "CDI-GOK")', () => {
  const casos = [['Código: KMQ-XRT https://places.wazebrasil.com', 'KMQ-XRT'], ['Seu codigo: 6C497S', '6C4-97S'], ['Entrar HXKTPW', 'HXK-TPW'],
    ['Código: 6C4–97S', '6C4-97S']];
  for (const [texto, esperado] of casos) {
    const c = ouvintesDoCampo();
    const r = inserindo(c, texto);
    assert.equal(r.campo, esperado, `DEFEITO: ${JSON.stringify(texto)} → ${JSON.stringify(r.campo)} (esperado ${esperado})`);
    assert.deepEqual(c.resgates, [], 'um código na frase resgatou como se fosse o link');
  }
});

test('R22-1-A1: CONTROLES — digitar tecla a tecla, a composição do IME e o texto sem código seguem como sempre', () => {
  // Uma tecla por vez: o formatador, sem a interpretação (que é só pro que entra de uma vez).
  const c = ouvintesDoCampo();
  let valor = '';
  for (const ch of 'abc123') valor = inserindo(c, ch, { antes: valor }).campo;
  assert.equal(valor, 'ABC-123', 'CONTROLE: digitar tecla a tecla deixou de formatar');
  // A composição do IME reescreve o campo a cada tecla: não se interpreta no meio dela.
  const d = ouvintesDoCampo();
  const comp = inserindo(d, 'HXKTPW', { inputType: 'insertCompositionText', isComposing: true });
  assert.equal(comp.impedido, false, 'CONTROLE: a composição do IME foi impedida');
  assert.equal(comp.campo, 'HXK-TPW');
  // Texto de várias letras sem código nem link: o campo o formata (os seis primeiros), como sempre.
  const e = ouvintesDoCampo();
  assert.equal(inserindo(e, 'abcd').campo, 'ABC-D', 'CONTROLE: o texto sem código deixou de ser formatado');
  assert.deepEqual(e.resgates, []);
});

test('R22-1-A1: o colar e o resto passam pela MESMA função (a que o colar usava, agora única)', () => {
  const cola = fatiarDe(APP_SEM, 'colarCodigoPareamento');
  assert.match(cola, /aplicarTextoNoCampoDoCodigo\(e\.target, texto\)/, 'o colar parou de usar a função única');
  assert.doesNotMatch(cola, /extrairSegredoDoLinkDePareamento|extrairCodigoPareamento/, 'o colar voltou a interpretar o texto por conta própria');
  const m = montarCampo();
  // O `paste` do navegador: o link resgata e o colar é impedido; o código entra no lugar; o resto segue.
  let impedido = false;
  const campo = { value: 'XY', setSelectionRange() {} };
  const evento = (texto) => ({ clipboardData: { getData: () => texto }, preventDefault: () => { impedido = true; }, target: campo });
  m.colarCodigoPareamento(evento(LINK));
  assert.deepEqual(m.resgates, [SEGREDO]);
  assert.equal(impedido, true);
  assert.equal(campo.value, 'XY', 'o colar do link mexeu no campo');
});

// ═══ R22-7-02 · os leitores do Histórico leem só número — a MESMA função ═════════════════════════════
// O lote 25 pôs a régua em `getHistoryStats`, `recordHistory` e `placarGuardado`; o Resumo do mês, o aviso do
// Desfazer, o "Centurião" e a sequência seguiam somando texto ("072", "[object Object]").
const ESTRAGADOS = [['7', 0], [{ a: 1 }, 0], [[3], 0], [null, 0], [undefined, 0], [NaN, 0], [-4, 0], [Infinity, 0], [true, 0], [5, 5], [0, 0]];
const contagem = montar(['contagemDoHistorico'], {}).contagemDoHistorico;

test('R22-7-02: `contagemDoHistorico` — número ≥ 0 passa; texto, lista, objeto, NaN, negativo e infinito valem 0', () => {
  for (const [entrada, esperado] of ESTRAGADOS) assert.equal(contagem(entrada), esperado, `${JSON.stringify(entrada)} → ${contagem(entrada)}`);
});

test('R22-7-02: o Resumo do mês soma só número — o balde com texto ou objeto não vira "072" nem "[object Object]"', () => {
  const dadosDoResumo = montar(['contagemDoHistorico', 'dadosDoResumo'], {}).dadosDoResumo;
  const h = { '2026-10-03': { read: '7', rejected: 2 }, '2026-10-04': { read: { a: 1 }, rejected: 2 }, '2026-10-05': { read: 4, rejected: [1] },
    '2026-10-06': { read: 3, rejected: 1 }, _total: { read: 99, rejected: 99 } };
  const d = dadosDoResumo(h, 2026, 9);
  assert.equal(typeof d.total, 'number', 'DEFEITO: o total do mês é texto');
  assert.deepEqual([d.lidos, d.rejeitados, d.total], [7, 5, 12], `DEFEITO: ${JSON.stringify([d.lidos, d.rejeitados, d.total])} (esperado 0+0+4+3 lidos, 2+2+0+1 rejeitados)`);
  assert.ok(!/NaN|\[object/.test(JSON.stringify(d)), 'sobrou NaN ou objeto no resumo: ' + JSON.stringify(d));
  assert.equal(d.diasAtivos, 4);
  // CONTROLE: o balde limpo soma como sempre.
  assert.equal(dadosDoResumo({ '2026-10-03': { read: 7, rejected: 2 } }, 2026, 9).total, 9, 'CONTROLE: o histórico limpo mudou');
});

test('R22-7-02: o aviso do Desfazer conta os confirmados só com número — `_total.read:"7"` não vira "72"', () => {
  for (const [total, esperado] of [[{ read: '7', rejected: 2 }, 2], [{ read: { a: 1 }, rejected: 2 }, 2], [{ read: 7, rejected: 2 }, 9], [undefined, 0]]) {
    const m = montar(['contagemDoHistorico', 'pedidosConfirmados'], { loadHistory: () => ({ _total: total }) });
    const n = m.pedidosConfirmados();
    assert.equal(n, esperado, `DEFEITO: ${JSON.stringify(total)} → ${JSON.stringify(n)} (esperado ${esperado})`);
    assert.equal(typeof n, 'number');
  }
});

test('R22-7-02: o "Centurião" (balde do dia do gesto) e a sequência leem só número', () => {
  const ctxs = [];
  const deps = { carregarConquistas: () => ({ seq: 0 }), salvarConquistas() {}, registrarIdiomaUsado() {}, getLang: () => 'pt', contagemDoAutor: () => 0,
    checarConquistas: (x) => ctxs.push(x), filaZeradaConfirmada: () => false, checkUndoGateUnlock() {}, Treino: { ativo: false },
    loadHistory: () => ({ '2026-10-14': { read: '99', rejected: { a: 1 } } }) };
  const m = montar(['contagemDoHistorico', 'registrarAcaoConfirmada', 'registrarLoteConfirmado'], deps);
  m.registrarAcaoConfirmada('read', {}, { dia: '2026-10-14', t: Date.now() });
  m.registrarLoteConfirmado(3, { dia: '2026-10-14', t: Date.now() });
  assert.deepEqual(ctxs.map((x) => x.hoje), [0, 0], `DEFEITO: o balde com texto virou "${ctxs.map((x) => x.hoje)}" no Centurião`);
  const seq = montar(['contagemDoHistorico', 'chaveMaisDias', 'maiorSequenciaDeDias'], {}).maiorSequenciaDeDias;
  assert.equal(seq({ '2026-10-01': { read: '5' }, '2026-10-02': { read: 1 }, '2026-10-03': { rejected: { a: 1 } } }), 1,
    'DEFEITO: o balde com texto contou como dia de trabalho na sequência');
});

test('R22-7-02: nenhum leitor do Histórico volta a somar `balde.read || 0` (guard na fonte)', () => {
  const sobras = APP_SEM.split('\n').filter((l) => /\b(?:balde|v|h\[k\]|total)\.(?:read|rejected) \|\| 0/.test(l));
  assert.deepEqual(sobras, [], 'um leitor do Histórico voltou a tratar o contador estragado como texto:\n' + sobras.join('\n'));
});
