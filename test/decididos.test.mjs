// PEDIDO JÁ DECIDIDO NÃO VOLTA COMO CARD (v2026.09.22-06).
//
// O relato: no modo avião, o owner tratou pedidos (foram pra fila de saída),
// fechou o app e reabriu — e os MESMOS pedidos voltaram como card, com a fila
// de saída ainda segurando as decisões. Dava pra decidir de novo: o placar
// contava outra vez e o Waze recebia duas decisões, que podem ser diferentes
// (ler não resolve o pedido, então um "rejeitar" depois dele vale).
//
// A causa: a fila guardada do offline é uma FOTO tirada com rede, e a
// reabertura sem rede a restaurava inteira. O mesmo buraco existia com rede,
// estreito: a busca da abertura corre junto com o esvaziamento da fila de saída.
//
// Estes testes RODAM as funções puras (fatiadas do fonte e avaliadas com o
// armazenamento de mentira) e travam a ESTRUTURA dos dois caminhos por onde
// pedido entra na fila. O percurso inteiro, com páginas novas e o service
// worker, está na seção 9b do `tools/smoke-offline.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA — não com
// replace(/\/\/[^\n]*/g), que come tudo depois de qualquer https://.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Pula a ASSINATURA antes de casar chaves (o `{}` de parâmetro padrão já
// enganou este instrumento — ver `test/fila-saida.test.mjs`).
function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  const marca = m.index;
  let par = 0, i = APP_SEM.indexOf('(', marca);
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
  const corpo = APP_SEM.slice(marca, fim);
  assert.ok(corpo.length > 60, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}

// As constantes vêm do FONTE, avaliadas — um número copiado aqui envelheceria
// calado no dia em que o de lá mudasse (gotcha #49).
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function('return (' + m[1] + ');')();
};

// Um "aparelho" de mentira: armazenamento, relógio do diário, e as funções
// reais do app.
function montar({ offline = true } = {}) {
  const guardado = new Map();
  const escritas = [];
  const safeLS = {
    get: (k) => (guardado.has(k) ? guardado.get(k) : null),
    set: (k, v) => { escritas.push(k); guardado.set(k, String(v)); },
    remove: (k) => { escritas.push('-' + k); guardado.delete(k); },
  };
  const diario = [];
  const estado = { offline };
  const fontes = ['chaveDoPedido', 'marcarEmAndamento', 'offlineLerPousos', 'registrarPouso',
    'offlinePodarPousos', 'semOsJaDecididos', 'carregarFilaDeSaida', 'salvarFilaDeSaida',
    'enfileirarSaida', 'diagResumoDaSaida'].map(fatiar).join('\n');
  const deps = {
    safeLS,
    SAIDA_KEY: constante('SAIDA_KEY'),
    SAIDA_MAX: constante('SAIDA_MAX'),
    OFFLINE_POUSOS_KEY: constante('OFFLINE_POUSOS_KEY'),
    OFFLINE_POUSOS_MAX: constante('OFFLINE_POUSOS_MAX'),
    POUSO_NA_MEMORIA_MS: constante('POUSO_NA_MEMORIA_MS'),
    pedidosEmAndamento: new Set(),
    pousosDaPagina: new Map(),
    offlineLigado: () => estado.offline,
    dfato: (k, o) => diario.push([k, o]),
    updateInFlightIndicator: () => {},
    historyTodayKey: () => '2026-09-22',
    ondeAgora: () => '30',
  };
  const nomes = Object.keys(deps);
  const app = new Function(...nomes, fontes + `
    return { chaveDoPedido, marcarEmAndamento, offlineLerPousos, registrarPouso, offlinePodarPousos,
             semOsJaDecididos, carregarFilaDeSaida, enfileirarSaida, diagResumoDaSaida };`)(...nomes.map((n) => deps[n]));
  return { app, deps, guardado, escritas, diario, estado };
}
const P = (v, u, extra = {}) => ({ venueID: v, updateRequestID: u, ...extra });

// ── a chave ───────────────────────────────────────────────────────────────
test('a chave junta os DOIS ids, e o tipo do id não muda a chave', () => {
  const { app } = montar();
  // A fila de saída e a busca não prometem o mesmo tipo pro mesmo id; se a
  // chave dependesse dele, `12 !== '12'` deixaria o filtro passar calado.
  assert.equal(app.chaveDoPedido(P('v1', 12)), app.chaveDoPedido(P('v1', '12')));
  assert.equal(app.chaveDoPedido(P(0, 0)), '0|0', 'id ZERO é id — `!id` o mandaria embora calado');
  assert.equal(app.chaveDoPedido(P('v1', undefined)), null);
  assert.equal(app.chaveDoPedido(null), null);
});

// ── o filtro ──────────────────────────────────────────────────────────────
test('o filtro tira o que está na FILA DE SAÍDA — o relato', () => {
  const { app } = montar();
  app.enfileirarSaida('reject', P('v1', 7));
  const r = app.semOsJaDecididos([P('v1', '7'), P('v2', 8)], 0);
  assert.deepEqual(r.places.map((p) => p.venueID), ['v2'], 'o pedido esperando envio voltou (e com o id em outro tipo)');
  assert.equal(r.excluidos, 1);
});

test('o filtro tira o que está na janela do Desfazer ou em voo', () => {
  const { app } = montar();
  app.marcarEmAndamento([P('v1', 1)], true);
  assert.deepEqual(app.semOsJaDecididos([P('v1', 1), P('v2', 2)], 0).places.map((p) => p.venueID), ['v2']);
  app.marcarEmAndamento(P('v1', 1), false);   // saiu da janela (Desfazer/fim do envio)
  assert.equal(app.semOsJaDecididos([P('v1', 1)], 0).places.length, 1, 'depois do Desfazer ele é pedido da fila de novo');
});

test('pouso DEPOIS de a lista ser tirada sai; pouso ANTES fica — ali quem manda é o Waze', () => {
  const { app, deps } = montar();
  deps.pousosDaPagina.set('v1|1', 1000);
  // A lista tirada em 900 pode não refletir a decisão que pousou em 1000.
  assert.equal(app.semOsJaDecididos([P('v1', 1)], 900).excluidos, 1);
  // A lista tirada em 1100 já a reflete: se o Waze ainda a mandou (um pedido
  // LIDO com "só não lidos" desligado), é porque ele continua pendente.
  assert.equal(app.semOsJaDecididos([P('v1', 1)], 1100).excluidos, 0);
  assert.equal(app.semOsJaDecididos([P('v1', 1)], 1000).excluidos, 1, 'no mesmo milissegundo, o lado seguro é tirar');
});

test('os pousos GRAVADOS valem pra reabertura — e só com o offline ligado', () => {
  const ligado = montar({ offline: true });
  ligado.guardado.set(ligado.deps.OFFLINE_POUSOS_KEY, JSON.stringify([['v3|3', 2000]]));
  assert.equal(ligado.app.semOsJaDecididos([P('v3', 3)], 1500).excluidos, 1);
  const desligado = montar({ offline: false });
  desligado.guardado.set(desligado.deps.OFFLINE_POUSOS_KEY, JSON.stringify([['v3|3', 2000]]));
  assert.equal(desligado.app.semOsJaDecididos([P('v3', 3)], 1500).excluidos, 0,
    'com o offline desligado a lista gravada não existe pro app (e nem é lida)');
});

test('o filtro não inventa: pedido sem id fica, a lista original não é mexida, e a conta bate', () => {
  const { app } = montar();
  app.enfileirarSaida('read', P('v1', 1));
  const entrada = [P('v1', 1), P(undefined, 2), P('v3', 3)];
  const copia = JSON.stringify(entrada);
  const r = app.semOsJaDecididos(entrada, 0);
  assert.equal(r.places.length, 2);
  assert.equal(r.excluidos, 1);
  assert.equal(JSON.stringify(entrada), copia, 'o filtro mexeu na lista que recebeu');
  assert.deepEqual(app.semOsJaDecididos(undefined, 0), { places: [], excluidos: 0 });
});

// ── o pouso ───────────────────────────────────────────────────────────────
test('registrarPouso: todo mundo ganha a memória; SÓ quem ligou o offline grava', () => {
  const desligado = montar({ offline: false });
  desligado.app.registrarPouso(P('v1', 1));
  assert.ok(desligado.deps.pousosDaPagina.has('v1|1'), 'a memória da página é de todo mundo (a corrida da busca)');
  assert.deepEqual(desligado.escritas, [], 'quem não ligou o offline pagou uma gravação — "quem não marca não paga nada"');
  const ligado = montar({ offline: true });
  ligado.app.registrarPouso(P('v1', 1));
  assert.deepEqual(ligado.app.offlineLerPousos().map((e) => e[0]), ['v1|1']);
});

test('registrarPouso: o LOTE grava UMA vez, e a lista tem teto', () => {
  const { app, escritas, deps } = montar();
  app.registrarPouso([P('v1', 1), P('v2', 2), P('v3', 3)]);
  assert.equal(escritas.filter((k) => k === deps.OFFLINE_POUSOS_KEY).length, 1,
    'um lote de 300 pedidos viraria 300 gravações síncronas');
  const max = deps.OFFLINE_POUSOS_MAX;
  app.registrarPouso(Array.from({ length: max + 5 }, (_, i) => P('x' + i, i)));
  const lista = app.offlineLerPousos();
  assert.equal(lista.length, max, 'estourou o teto');
  assert.equal(lista.at(-1)[0], `x${max + 4}|${max + 4}`, 'o teto tem que descartar o MAIS VELHO');
});

test('registrarPouso: a memória da página se poda sozinha numa sessão longa', () => {
  const { app, deps } = montar({ offline: false });
  const velho = Date.now() - deps.POUSO_NA_MEMORIA_MS - 1000;
  for (let i = 0; i < 501; i++) deps.pousosDaPagina.set('velho' + i + '|' + i, velho);
  app.registrarPouso(P('novo', 1));
  assert.deepEqual([...deps.pousosDaPagina.keys()], ['novo|1']);
});

test('a poda tira o que pousou ANTES da fila guardada, e apaga a chave quando esvazia', () => {
  const { app, guardado, deps } = montar();
  guardado.set(deps.OFFLINE_POUSOS_KEY, JSON.stringify([['a|1', 100], ['b|2', 200], ['c|3', 300]]));
  app.offlinePodarPousos(200);
  assert.deepEqual(app.offlineLerPousos().map((e) => e[0]), ['b|2', 'c|3'], 'o pouso EXATO do início fica');
  app.offlinePodarPousos(1000);
  assert.equal(guardado.has(deps.OFFLINE_POUSOS_KEY), false, 'lista vazia deixou a chave pra trás');
});

test('a lista gravada ilegível ou torta não derruba ninguém', () => {
  const { app, guardado, deps } = montar();
  guardado.set(deps.OFFLINE_POUSOS_KEY, '{não é json');
  assert.deepEqual(app.offlineLerPousos(), []);
  guardado.set(deps.OFFLINE_POUSOS_KEY, JSON.stringify([['ok|1', 5], 'lixo', ['sem-tempo'], [1, 2]]));
  assert.deepEqual(app.offlineLerPousos(), [['ok|1', 5]]);
});

// ── a fila de saída não aceita o mesmo pedido duas vezes ──────────────────
test('enfileirarSaida: o MESMO pedido de novo é recusado como repetido, com alarme no diário', () => {
  const { app, diario } = montar();
  assert.equal(app.enfileirarSaida('read', P('v1', 1)), true);
  assert.equal(app.enfileirarSaida('reject', P('v1', '1')), 'repetida',
    'a segunda decisão do mesmo pedido entrou — e o Waze receberia as duas');
  assert.equal(app.carregarFilaDeSaida().length, 1);
  assert.equal(app.carregarFilaDeSaida()[0].tipo, 'read', 'vale a PRIMEIRA decisão');
  assert.deepEqual(diario.map((d) => d[0]), ['saida.abriu', 'saida.repetida']);
  assert.equal(app.enfileirarSaida('read', P('v2', 2)), true, 'pedido diferente entra normalmente');
});

test('enfileirarSaida: o repetido é reconhecido mesmo com a fila CHEIA', () => {
  const { app, guardado, deps } = montar();
  const cheia = Array.from({ length: deps.SAIDA_MAX }, (_, i) => ({ tipo: 'read', venueID: 'v' + i, updateRequestID: i }));
  guardado.set(deps.SAIDA_KEY, JSON.stringify(cheia));
  assert.equal(app.enfileirarSaida('read', P('v5', 5)), 'repetida', 'cheia, o repetido tem que dizer que é repetido');
  assert.equal(app.enfileirarSaida('read', P('novo', 1)), false, 'cheia, o novo segue recusado (e o chamador avisa)');
});

// ── o resumo da fila de saída no relatório ────────────────────────────────
test('o resumo da fila de saída conta distintos, repetidos, tipos e idade — sem ids', () => {
  const { app, guardado, deps } = montar();
  const t = Date.now() - 7 * 60000;
  guardado.set(deps.SAIDA_KEY, JSON.stringify([
    { tipo: 'reject', venueID: 'v1', updateRequestID: 1, t },
    { tipo: 'read', venueID: 'v1', updateRequestID: '1', t: t + 1000 },
    { tipo: 'reject', venueID: 'v2', updateRequestID: 2, t: t + 2000, nome: 'autor' },
  ]));
  const r = app.diagResumoDaSaida();
  assert.deepEqual(r, { n: 3, distintas: 2, repetidas: 1, tipos: { reject: 2, read: 1 }, maisAntigaMin: 7 });
  assert.ok(!JSON.stringify(r).includes('v1') && !JSON.stringify(r).includes('autor'), 'o resumo levou id ou autor');
});

// ── a estrutura dos DOIS caminhos de entrada ──────────────────────────────
test('a BUSCA filtra o que chega, e conta o filtrado', () => {
  const f = fatiar('fetchNextPage');
  const iInicio = f.indexOf('const inicioDaBusca = Date.now();');
  const iPedido = f.indexOf('await API.fetchPlaces(');
  assert.ok(iInicio > 0 && iPedido > iInicio,
    'o instante da busca tem que ser tomado ANTES do pedido — depois, o pouso que acontece no meio passaria');
  assert.match(f, /const filtrada = semOsJaDecididos\(result\.places \|\| \[\], inicioDaBusca\);/,
    'a busca deixou de filtrar o que o aparelho já decidiu');
  assert.match(f, /const newPlaces = filtrada\.places;/, 'o que entra na fila tem que ser o FILTRADO');
  assert.ok(!/result\.places \|\| \[\];/.test(f.replace('semOsJaDecididos(result.places || [], inicioDaBusca);', '')),
    'sobrou um uso da lista CRUA da busca');
  const iPush = f.indexOf('AppState.queue.push(...newPlaces);');
  const iTotal = f.indexOf('AppState.serverTotal += newPlaces.length;');
  assert.ok(iPush > 0 && iTotal > 0, '"Restam" tem que contar o filtrado: o que está saindo já foi feito');
  assert.match(f, /offlineGravarFila\(inicioDaBusca\);/,
    'a fila guardada tem que valer desde o COMEÇO da busca, não da hora de gravar');
});

test('a REABERTURA SEM REDE filtra a foto, e desiste se tudo foi decidido', () => {
  const f = fatiar('offlineTentarAbrirSemRede');
  assert.match(f, /const desde = Number\.isFinite\(guardada\.desde\) \? guardada\.desde : guardada\.t;/,
    'a fila guardada por versão anterior não tem `desde`: tem que cair na hora em que foi gravada');
  assert.match(f, /const filtrada = semOsJaDecididos\(guardada\.places, desde\);/,
    'a reabertura sem rede voltou a restaurar a foto INTEIRA — o relato de volta');
  assert.match(f, /AppState\.queue = filtrada\.places;/, 'a fila tem que ser a FILTRADA');
  assert.ok(!/guardada\.places\.slice\(\)/.test(f), 'voltou a copiar a foto crua pra fila');
  assert.match(f, /if \(!filtrada\.places\.length\) \{[\s\S]*?return false;\s*\}/,
    'tudo decidido tem que cair na tela de sempre — uma fila vazia se passaria por "Tudo limpo!"');
  assert.match(f, /excluidos: filtrada\.excluidos/, 'o diário tem que dizer QUANTOS o filtro tirou — é a prova de que agiu');
});

test('a fila guardada leva o `desde`, e a poda só roda DEPOIS de a gravação fechar', () => {
  const f = fatiar('offlineGravarFila');
  assert.match(f, /desde: valeDesde,/, 'a fila guardada não leva mais o instante da lista');
  const iGrava = f.indexOf('await new Promise(');
  const iPoda = f.indexOf('offlinePodarPousos(valeDesde);');
  assert.ok(iGrava > 0 && iPoda > iGrava,
    'a poda veio antes da gravação fechar: se ela falhar, a foto velha fica sem os pousos que a corrigem');
  // A varredura grava a fila VIVA: o `desde` é agora.
  assert.match(fatiar('offlineVarrer'), /await offlineGravarFila\(\);/, 'a varredura parou de gravar a fila');
});

test('TODO pouso passa pela fonte única — um caminho de fora deixaria o pedido voltar', () => {
  const conta = (nome) => (fatiar(nome).match(/registrarPouso\(/g) || []).length;
  // O card (sucesso e "já tratado"), a fila de saída, o lote (sucesso e "já
  // tratado"), a aprovação de foto (idem) e o lote de lidos.
  assert.equal(conta('handleActionResult'), 2, 'o pouso do card saiu do handleActionResult');
  assert.equal(conta('registrarPousoDeSaida'), 1, 'o pouso da fila de saída não é registrado');
  assert.equal(conta('enviarLote'), 2, 'o pouso do lote não é registrado');
  assert.equal(conta('enviarAprovacao'), 2, 'aprovar RESOLVE o pedido: o pouso tem que ser registrado');
  assert.equal(conta('handleBatchMarkRead'), 1, 'o lote de lidos não registra o pouso');
  // E o pouso vem ANTES do que pode lançar (histórico, conquistas): se algo ali
  // quebrar, o pedido não pode voltar por causa disso.
  const h = fatiar('handleActionResult');
  assert.ok(h.indexOf('registrarPouso(place);') < h.indexOf('recordHistory(actionType, 1);'));
});

test('o pedido fica "em andamento" do GESTO até o fim do envio — e sai por todos os caminhos', () => {
  const s = fatiar('scheduleAction');
  const iMarca = s.indexOf('marcarEmAndamento(places, true);');
  assert.ok(iMarca > 0, 'o pedido na janela do Desfazer não é marcado');
  assert.ok(iMarca < s.indexOf('const timerId = setTimeout(') && iMarca < s.indexOf("undoEnabled === false && canDisableUndo()"),
    'a marca tem que vir ANTES da janela e do envio sem janela');
  // Fim do envio, Desfazer, cancelar (logout/pagehide do lote) e enfileirar ao
  // fechar sem rede. Um que falte deixa o pedido de fora da fila pra sempre.
  assert.equal((s.match(/marcarEmAndamento\(places, false\);/g) || []).length, 4,
    'algum caminho de saída da janela deixou de desmarcar o pedido');
  const iFinally = s.indexOf('} finally {');
  assert.ok(iFinally > 0 && s.indexOf('marcarEmAndamento(places, false);', iFinally) > iFinally,
    'o fim do envio tem que desmarcar no `finally` — exceção no executor não pode prender o pedido');
});

test('o LOTE marca os pedidos em andamento — a recusa automática não passa pela janela do Desfazer', () => {
  const l = fatiar('enviarLote');
  const iMarca = l.indexOf('marcarEmAndamento(places, true);');
  const iLaco = l.indexOf('for (const p of places)');
  assert.ok(iMarca > 0 && iMarca < iLaco, 'o lote tem que marcar os pedidos ANTES do primeiro envio');
  assert.match(l, /marcarEmAndamento\(p, false\);\s*progresso\(\);/,
    'cada pedido tem que sair do "em andamento" quando resolve — senão ele fica fora da fila até a página morrer');
  const iFinally = l.indexOf('} finally {');
  assert.ok(iFinally > 0 && l.indexOf('marcarEmAndamento(places, false);', iFinally) > iFinally,
    'o `finally` tem que desmarcar todos — a sessão morta no meio (`return`) deixaria os outros presos');
});

test('fechar SEM REDE com ação na janela do Desfazer enfileira de forma SÍNCRONA', () => {
  const d = fatiar('descarregarAcaoPendente');
  const iSemRede = d.indexOf('navigator.onLine === false && AppState.pendingAction.enfileirarSemRede');
  const iExecuta = d.indexOf('AppState.pendingAction.execute()');
  assert.ok(iSemRede > 0 && iExecuta > iSemRede,
    'sem rede, a ação tem que ir pra fila ANTES de tentar a rede — a volta do laço pode não existir');
  const s = fatiar('scheduleAction');
  assert.match(s, /if \(executed \|\| n !== 1 \|\| \(type !== 'read' && type !== 'reject'\)\) return false;/,
    'só ✕ e ✓ de UM pedido vão pra fila ao fechar: o lote cancela e o Pular não escreve');
  assert.match(s, /const r = enfileirarSaida\(type, places\[0\]\);\s*if \(!r\) return false;/,
    'fila cheia tem que cair no caminho de sempre, que avisa');
  assert.match(s, /if \(r === 'repetida'\) reverterPlacar\(true\);/,
    'o gesto repetido não pode contar duas vezes no placar');
});

test('a fila de saída que recusa o repetido NÃO deixa o gesto contar duas vezes', () => {
  const h = fatiar('handleActionResult');
  assert.match(h, /if \(naFila === 'repetida'\) \{[\s\S]*?AppState\.stats\[k\] = Math\.max\(0, AppState\.stats\[k\] - 1\);[\s\S]*?return;\s*\}/,
    'o repetido tem que desfazer a contagem do gesto e parar ali');
  const iRep = h.indexOf("if (naFila === 'repetida')");
  const iEnf = h.indexOf('if (naFila) return;');
  assert.ok(iRep > 0 && iEnf > iRep, "o `if (naFila) return` veio antes: 'repetida' é truthy e passaria direto");
});

test('esquecer o offline e SAIR levam os pousos junto', () => {
  assert.match(fatiar('offlineEsquecer'), /safeLS\.remove\(OFFLINE_POUSOS_KEY\);/,
    'os pousos gravados sobreviveram ao "esquecer" — são ids de pedidos de terceiros');
  const sair = fatiar('handleLogout');
  assert.match(sair, /pousosDaPagina\.clear\(\);/, 'o "Sair" deixou os pousos da página em memória');
  assert.match(sair, /pedidosEmAndamento\.clear\(\);/, 'o "Sair" deixou os pedidos em andamento em memória');
  assert.match(sair, /offlineEsquecer\(\);/);
});

test('o relatório leva a fila de saída em números e a versão subiu', () => {
  const corpo = fatiar('diagCorpo');
  assert.match(corpo, /saida: diagResumoDaSaida\(\),/, 'o resumo do relatório parou de levar a fila de saída');
  const v = Number((APP_SEM.match(/^const DIAG_VERSAO = (\d+);/m) || [])[1]);
  assert.ok(v >= 5, `a versão do diagnóstico não subiu com os campos novos (${v})`);
  assert.match(fatiar('diagOffline'), /o\.pousosGravados = offlineLerPousos\(\)\.length;/,
    'a seção offline parou de contar os pousos gravados');
});
