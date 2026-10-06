// O DIAGNÓSTICO QUE SOBREVIVE A FECHAR O APP (v2026.09.22-06).
//
// Relato do owner: capturou o defeito com o botão duas vezes, fechou o app,
// reabriu — e o número sumiu. Capturas, diário, chamadas e erros viviam só em
// memória. E o defeito daquele dia só existia ATRAVESSANDO um fechar e
// reabrir: a prova de antes de fechar era exatamente o que sumia.
//
// Com o modo dev ligado, cada abertura guarda no aparelho (IndexedDB próprio)
// o que o relatório levaria dela, e as seguintes a devolvem. Sai ao baixar, ao
// desligar o modo dev, no "Sair", ou em 24 h.
//
// Estes testes RODAM a poda, o corte do corpo das chamadas e o retrato da
// abertura (fatiados do fonte), e travam a estrutura. O percurso inteiro, com
// páginas novas, o botão tocado de verdade e o relatório lido, está na seção
// 9c do `tools/smoke-offline.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

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
  assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
  return corpo;
}

// Constante do fonte, AVALIADA (gotcha #49); `DLOG_MAX_MOMENTOS` resolvido
// antes porque o teto das guardadas é definido em função dele.
const constante = (nome, ctx = {}) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function(...Object.keys(ctx), 'return (' + m[1] + ');')(...Object.values(ctx));
};
const DLOG_MAX_MOMENTOS = constante('DLOG_MAX_MOMENTOS');
const DIAG = {
  DIAG_GUARDA_MS: constante('DIAG_GUARDA_MS'),
  DIAG_ABERTURAS_MAX: constante('DIAG_ABERTURAS_MAX'),
  DIAG_CAPTURAS_GUARDADAS_MAX: constante('DIAG_CAPTURAS_GUARDADAS_MAX', { DLOG_MAX_MOMENTOS }),
};

const podar = new Function(...Object.keys(DIAG), fatiar('diagPodarAberturas') + '\nreturn diagPodarAberturas;')(
  ...Object.values(DIAG));
const HORA = 60 * 60 * 1000;
const AGORA = 1_800_000_000_000;
const ab = (id, inicioH, salvoH, nCapturas = 0) => ({
  id, inicio: AGORA - inicioH * HORA, salvoEm: AGORA - salvoH * HORA,
  momentos: Array.from({ length: nCapturas }, (_, i) => ({ t: id + ':' + i, motivo: 'manual' })),
});

// ── a poda ────────────────────────────────────────────────────────────────
test('o prazo é de 24 h e o que passou sai do aparelho', () => {
  assert.equal(DIAG.DIAG_GUARDA_MS, 24 * HORA, 'o prazo prometido na Ajuda é 24 h');
  const r = podar([ab('velha', 30, 24.01), ab('limite', 26, 24), ab('nova', 2, 1)], AGORA);
  assert.deepEqual(r.manter.map((a) => a.id).sort(), ['limite', 'nova']);
  assert.deepEqual(r.sair, ['velha'], 'a vencida tem que sair do aparelho, não só da tela');
});

test('ficam só as aberturas mais RECENTES, e a de agora nunca sai por isso', () => {
  const max = DIAG.DIAG_ABERTURAS_MAX;
  const lista = Array.from({ length: max + 3 }, (_, i) => ab('a' + i, i + 1, i + 0.5));
  const r = podar(lista, AGORA);
  assert.equal(r.manter.length, max);
  assert.equal(r.manter[0].id, 'a0', 'a mais nova vem primeiro');
  assert.deepEqual(r.sair.sort(), ['a' + max, 'a' + (max + 1), 'a' + (max + 2)].sort());
});

test('as capturas SOMADAS não passam do teto — a abertura mais nova e as capturas mais novas ganham', () => {
  const teto = DIAG.DIAG_CAPTURAS_GUARDADAS_MAX;
  assert.equal(teto, DLOG_MAX_MOMENTOS, 'o teto guardado é o mesmo do anel desta abertura (~1,8 MB)');
  const r = podar([ab('antiga', 5, 4, teto), ab('recente', 1, 0.5, teto - 3)], AGORA);
  const recente = r.manter.find((a) => a.id === 'recente');
  const antiga = r.manter.find((a) => a.id === 'antiga');
  assert.equal(recente.momentos.length, teto - 3, 'a mais recente não pode perder captura pra antiga');
  assert.equal(antiga.momentos.length, 3);
  assert.deepEqual(antiga.momentos.map((m) => m.t), ['antiga:' + (teto - 3), 'antiga:' + (teto - 2), 'antiga:' + (teto - 1)],
    'da abertura cortada ficam as capturas MAIS NOVAS');
  assert.deepEqual(r.cortadas, ['antiga'], 'a cortada tem que ser regravada, senão o aparelho segue com as 12');
  const total = r.manter.reduce((s, a) => s + a.momentos.length, 0);
  assert.equal(total, teto);
});

// ── R7-4-03: com DUAS ABAS, a poda vai pela hora da CAPTURA ────────────────
// A ordem era a da ABERTURA (`inicio`): a aba aberta por último guardava as dela
// e cortava as da outra, mesmo sendo as da outra as mais novas — e a aba mais
// velha gravava a própria abertura já sem as capturas dela. MEDIDO no navegador
// (x4 da auditoria): A abre, B abre depois, B registra 12 telas e A registra 2,
// as MAIS NOVAS de todas — na base, A 0 · B 12, com o botão de A mostrando "2".
const iso = (horasAtras) => new Date(AGORA - horasAtras * HORA).toISOString();
const telas = (id, horas, motivo = 'manual') => horas.map((h, i) => ({ t: iso(h), motivo, n: id + i }));
test('R7-4-03: duas abas — as capturas mais NOVAS ficam, seja qual for a aba aberta por último', () => {
  const teto = DIAG.DIAG_CAPTURAS_GUARDADAS_MAX;
  // A abriu ANTES (inicio 3 h atrás) e fez as 2 telas mais novas; B abriu depois e fez 12, mais velhas.
  const horasB = Array.from({ length: teto }, (_, i) => 2 - i * 0.05);
  const A = { id: 'A', inicio: AGORA - 3 * HORA, salvoEm: AGORA - 0.01 * HORA, momentos: telas('A', [0.3, 0.2]) };
  const B = { id: 'B', inicio: AGORA - 2.5 * HORA, salvoEm: AGORA - 0.5 * HORA, momentos: telas('B', horasB) };
  for (const ordem of [[A, B], [B, A]]) {
    const r = podar(ordem, AGORA);
    const de = (id) => r.manter.find((a) => a.id === id).momentos;
    assert.equal(de('A').length, 2, 'as 2 telas mais NOVAS (as da aba aberta antes) foram cortadas');
    assert.equal(de('B').length, teto - 2, 'a aba aberta depois ficou com mais que o teto deixa');
    assert.deepEqual(de('B').map((m) => m.n), B.momentos.slice(-(teto - 2)).map((m) => m.n),
      'da aba B saíram as capturas erradas (têm que sair as mais VELHAS dela)');
    assert.deepEqual(de('B').map((m) => m.t), [...de('B').map((m) => m.t)].sort(),
      'as capturas que ficam têm que seguir na ORDEM do anel');
    assert.deepEqual(r.cortadas, ['B']);
  }
  // CONTROLE: com as de A mais VELHAS que as 12 de B, ficam as 12 de B — é a regra.
  const Avelha = { ...A, momentos: telas('A', [2.9, 2.8]) };
  const c = podar([Avelha, B], AGORA);
  assert.equal(c.manter.find((a) => a.id === 'A').momentos.length, 0);
  assert.equal(c.manter.find((a) => a.id === 'B').momentos.length, teto);
});

test('R7-4-03: a abertura que está GRAVANDO agora nunca é a que sai — vale a última gravação, não a hora de abrir', () => {
  const max = DIAG.DIAG_ABERTURAS_MAX;
  // A mais velha de abrir é a que grava AGORA (a aba aberta há horas); as outras abriram depois e fecharam.
  // A captura dela é AUTOMÁTICA: com tela da pessoa, a abertura sai do teto de
  // aberturas (R8-4-09) e o teste deixaria de medir a ordem pela última gravação.
  const atual = { id: 'atual', inicio: AGORA - 10 * HORA, salvoEm: AGORA, momentos: telas('atual', [0.01], 'auto:buscaFalhou') };
  const outras = Array.from({ length: max }, (_, i) => ({ id: 'o' + i, inicio: AGORA - (9 - i) * HORA, salvoEm: AGORA - (8.5 - i) * HORA, momentos: [] }));
  const r = podar([atual, ...outras], AGORA);
  assert.ok(r.manter.some((a) => a.id === 'atual'), 'a gravação da abertura de agora apagou a ela mesma (era a mais velha de abrir)');
  assert.ok(!r.sair.includes('atual'));
  assert.equal(r.manter.length, max);
  assert.deepEqual(r.sair, ['o0'], 'saiu a de atividade mais VELHA');
});

// R7-4-02 na cópia guardada: o teto vale com as telas da PESSOA na frente das
// automáticas (a mesma regra do anel), senão as automáticas de uma busca que
// falha empurravam pra fora do aparelho as telas que a pessoa registrou.
test('R7-4-02: na poda, as telas da PESSOA ficam na frente das automáticas, mesmo as mais velhas', () => {
  const teto = DIAG.DIAG_CAPTURAS_GUARDADAS_MAX;
  const atual = { id: 'atual', inicio: AGORA - HORA, salvoEm: AGORA,
    momentos: telas('auto', Array.from({ length: teto }, (_, i) => 0.5 - i * 0.01), 'auto:buscaFalhou') };
  const antes = { id: 'antes', inicio: AGORA - 3 * HORA, salvoEm: AGORA - 2 * HORA, momentos: telas('man', [2.5, 2.4]) };
  const r = podar([atual, antes], AGORA);
  assert.equal(r.manter.find((a) => a.id === 'antes').momentos.length, 2, 'as telas da pessoa saíram do aparelho pelas automáticas');
  assert.equal(r.manter.find((a) => a.id === 'atual').momentos.length, teto - 2);
  assert.deepEqual(r.manter.find((a) => a.id === 'atual').momentos.map((m) => m.n),
    atual.momentos.slice(2).map((m) => m.n), 'das automáticas, saíram as que não eram as mais VELHAS');
  // CONTROLE: só automáticas — as mais novas ficam, como sempre.
  const so = podar([atual, { ...antes, momentos: telas('a2', [2.5, 2.4], 'auto:erroDeJs') }], AGORA);
  assert.equal(so.manter.find((a) => a.id === 'antes').momentos.length, 0);
});

// ── R8-4-09: o teto de ABERTURAS não leva as telas da pessoa ────────────────
// O corte por aberturas vinha ANTES da prioridade das telas da pessoa: a 6ª
// abertura que gravava tirava a mais velha INTEIRA, com as telas que a pessoa
// registrou, mesmo com as outras 5 sem captura nenhuma (MEDIDO no navegador, r9
// da auditoria: base [0,0,0,0,0] e o botão ainda em "2"; aberto de novo, "0").
// No Android, que encerra o app no fundo, cada volta é uma abertura nova.
test('R8-4-09: a abertura com tela da PESSOA não sai pelo teto de aberturas — as 5 sem tela seguem o teto', () => {
  const max = DIAG.DIAG_ABERTURAS_MAX;
  // O1 (a mais velha) com 2 telas da pessoa; depois, `max` aberturas sem captura.
  const o1 = { id: 'o1', inicio: AGORA - 10 * HORA, salvoEm: AGORA - 9.5 * HORA, momentos: telas('o1', [9.8, 9.7]) };
  const depois = Array.from({ length: max }, (_, i) => ({ id: 'd' + i, inicio: AGORA - (9 - i) * HORA, salvoEm: AGORA - (8.5 - i) * HORA, momentos: [] }));
  const r = podar([o1, ...depois], AGORA);
  const ficou = r.manter.find((a) => a.id === 'o1');
  assert.ok(ficou, 'a abertura com as telas da PESSOA saiu INTEIRA pelo teto de aberturas — as telas somem sem download');
  assert.equal(ficou.momentos.length, 2, 'as telas da pessoa foram cortadas');
  assert.deepEqual(r.sair, [], 'saiu uma abertura que o teto (entre as SEM tela) ainda comporta');
  assert.equal(r.manter.filter((a) => !(a.momentos || []).length).length, max, 'o teto entre as aberturas SEM tela mudou');
  // CONTROLE: a mesma O1 com capturas só AUTOMÁTICAS segue o teto de sempre e sai.
  const auto = { ...o1, momentos: telas('o1', [9.8, 9.7], 'auto:buscaFalhou') };
  const c = podar([auto, ...depois], AGORA);
  assert.deepEqual(c.sair, ['o1'], 'a abertura só com automáticas ganhou a exceção das telas da pessoa');
  assert.equal(c.manter.length, max);
  // E uma 6ª SEM tela tira a mais velha das SEM tela, nunca a O1.
  const mais = { id: 'd' + max, inicio: AGORA - 0.5 * HORA, salvoEm: AGORA - 0.2 * HORA, momentos: [] };
  const r2 = podar([o1, ...depois, mais], AGORA);
  assert.deepEqual(r2.sair, ['d0'], 'o teto entre as SEM tela não tirou a de atividade mais velha delas');
  assert.ok(r2.manter.some((a) => a.id === 'o1'));
});

test('R8-4-09: o custo segue limitado — as capturas não passam do teto, e abertura cuja tela não coube volta ao teto de aberturas', () => {
  const max = DIAG.DIAG_ABERTURAS_MAX;
  const teto = DIAG.DIAG_CAPTURAS_GUARDADAS_MAX;
  // teto + 3 aberturas com UMA tela da pessoa cada (a hora da tela acompanha a
  // da abertura), mais `max` + 2 SEM tela, mais novas que todas.
  const comTela = Array.from({ length: teto + 3 }, (_, i) => ({ id: 't' + i, inicio: AGORA - (20 - i) * HORA,
    salvoEm: AGORA - (19.5 - i) * HORA, momentos: telas('t' + i, [19.6 - i]) }));
  const semTela = Array.from({ length: max + 2 }, (_, i) => ({ id: 's' + i, inicio: AGORA - (3 - i * 0.1) * HORA,
    salvoEm: AGORA - (2 - i * 0.1) * HORA, momentos: [] }));
  const r = podar([...comTela, ...semTela], AGORA);
  const capturas = r.manter.reduce((s, a) => s + (a.momentos || []).length, 0);
  assert.equal(capturas, teto, 'as capturas guardadas passaram do teto (ou ficaram abaixo dele)');
  // As 3 telas MAIS VELHAS não cabem no teto: as aberturas delas voltam ao teto de
  // aberturas — e, mais velhas que as SEM tela, saem.
  assert.deepEqual(r.sair.filter((id) => id.startsWith('t')).sort(), ['t0', 't1', 't2'],
    'a abertura cuja tela não coube no teto de capturas seguiu protegida (o custo deixa de ser limitado)');
  assert.ok(r.manter.length <= max + teto, `aberturas demais guardadas: ${r.manter.length}`);
  assert.equal(r.manter.filter((a) => a.id.startsWith('s')).length, max, 'o teto entre as SEM tela não valeu');
  // A abertura com tela da pessoa leva junto as automáticas dela, pelo teto de capturas de sempre.
  const mista = { id: 'mista', inicio: AGORA - 5 * HORA, salvoEm: AGORA - 4.5 * HORA,
    momentos: [...telas('m', [4.9]), ...telas('ma', [4.8, 4.7], 'auto:erroDeJs')] };
  const r3 = podar([mista, ...semTela.slice(0, max)], AGORA);
  assert.equal(r3.manter.find((a) => a.id === 'mista').momentos.length, 3, 'as automáticas da abertura protegida foram cortadas sem passar do teto');
});

test('a poda não inventa: registro sem id é ignorado, e sem nada a cortar nada muda', () => {
  const a = ab('ok', 1, 1, 2);
  const r = podar([a, { semId: true }, null], AGORA);
  assert.deepEqual(r.manter, [a]);
  assert.equal(r.manter[0], a, 'sem corte, o registro volta o MESMO (não é regravado à toa)');
  assert.deepEqual(r.sair, []);
  assert.deepEqual(r.cortadas, []);
  assert.deepEqual(podar(undefined, AGORA), { manter: [], sair: [], cortadas: [] });
});

// ── o que vai pro aparelho ────────────────────────────────────────────────
test('a chamada guardada vai SEM corpo — nem o do pedido nem a fila da resposta', () => {
  const semCorpo = new Function(fatiar('diagChamadaSemCorpo') + '\nreturn diagChamadaSemCorpo;')();
  const c = { t: 'x', rota: 'buscar-places', http: 200, ok: true, ms: 12, n: 300,
              corpoReq: { sessionToken: '[token]' }, corpoResposta: '{"places":[…]}', _bytes: 2e6 };
  assert.deepEqual(semCorpo(c), { t: 'x', rota: 'buscar-places', http: 200, ok: true, ms: 12, n: 300 });
});

test('a abertura guarda só o que NÃO foi entregue: capturas não baixadas, e o diário depois do download', () => {
  const baixados = new WeakSet();
  const m1 = { t: 'm1', motivo: 'manual' }, m2 = { t: 'm2', motivo: 'manual' };
  baixados.add(m1);
  const ctx = {
    DIAG_ABERTURA: { id: 'esta', inicio: 1000 },
    APP_VERSION: '2026092206',
    dfatoAnel: [{ t: 100, k: 'antes' }, { t: 300, k: 'depois' }],
    dlogAnel: [{ t: 200, k: 'dlog-antes' }, { t: 400, k: 'dlog-depois' }],
    API: { chamadas: [{ t: new Date(150).toISOString(), rota: 'perfil', corpoReq: {} },
                      { t: new Date(350).toISOString(), rota: 'buscar-places', corpoResposta: 'x' }] },
    diagErros: [{ t: new Date(120).toISOString(), msg: 'velho' }, { t: new Date(380).toISOString(), msg: 'novo' }],
    dlogMomentos: [m1, m2],
    dlogJaBaixados: baixados,
    diagChamadaSemCorpo: new Function(fatiar('diagChamadaSemCorpo') + '\nreturn diagChamadaSemCorpo;')(),
    diagBaixadoEm: 0,
  };
  const montar = (baixadoEm) => new Function(...Object.keys(ctx),
    fatiar('diagRegistroDaAbertura') + '\nreturn diagRegistroDaAbertura;')(...Object.values({ ...ctx, diagBaixadoEm: baixadoEm }));
  const sem = montar(0)('oculta');
  assert.equal(sem.id, 'esta');
  assert.equal(sem.salvoPor, 'oculta');
  assert.deepEqual(sem.diario.map((e) => e.k), ['antes', 'dlog-antes', 'depois', 'dlog-depois'], 'diário junto e em ordem');
  assert.deepEqual(sem.momentos, [m2], 'a captura JÁ BAIXADA não pode ser guardada de novo');
  assert.ok(sem.chamadas.every((c) => !('corpoReq' in c) && !('corpoResposta' in c)), 'chamada guardada com corpo');
  const depois = montar(250)('oculta');
  assert.deepEqual(depois.diario.map((e) => e.k), ['depois', 'dlog-depois'], 'o diário anterior ao download já foi entregue');
  assert.deepEqual(depois.chamadas.map((c) => c.rota), ['buscar-places']);
  assert.deepEqual(depois.erros.map((e) => e.msg), ['novo']);
});

// ── a estrutura ───────────────────────────────────────────────────────────
test('quem não liga o modo dev não paga nada — nem abre a base', () => {
  assert.match(fatiar('diagGuardarAbertura'), /^function diagGuardarAbertura\(motivo\) \{\s*if \(!dlogLigado\(\)\) return Promise\.resolve\(false\);/,
    'a gravação tem que sair na PRIMEIRA linha sem o modo dev');
  assert.match(fatiar('diagCarregarAberturas'), /^async function diagCarregarAberturas\(\) \{\s*if \(!dlogLigado\(\)\) return;/,
    'a leitura na abertura tem que sair na PRIMEIRA linha sem o modo dev');
  // IndexedDB, não localStorage: 1,8 MB num `setItem` síncrono trava o swipe.
  for (const f of ['diagGuardarAbertura', 'diagCarregarAberturas', 'diagRegistroDaAbertura', 'diagAplicarPoda']) {
    assert.doesNotMatch(fatiar(f), /safeLS\.set|localStorage\.setItem/, `${f} passou a gravar no localStorage`);
  }
  // Base PRÓPRIA: a do offline é apagada inteira quando aquele toggle desliga.
  assert.notEqual(constante('DIAG_DB'), constante('OFFLINE_DB'));
});

test('grava na CAPTURA, ao ir pro fundo e ao sair — nunca por swipe', () => {
  const cap = fatiar('dlogCapturar');
  const iPush = cap.indexOf('dlogMomentos.push(m);');
  const iGuarda = cap.indexOf("diagGuardarAbertura('captura');");
  assert.ok(iPush > 0 && iGuarda > iPush, 'a captura tem que ir pro aparelho DEPOIS de entrar no anel');
  const setup = fatiar('setupGuardaDoDiagnostico');
  assert.match(setup, /visibilitychange[\s\S]*?hidden[\s\S]*?diagGuardarAbertura\('oculta'\)/, 'faltou gravar ao ir pro fundo');
  assert.match(setup, /pagehide[\s\S]*?diagGuardarAbertura\('saida'\)/, 'faltou gravar ao sair');
  // Nenhum dos anéis grava sozinho: o do modo dev anota cada ação.
  assert.doesNotMatch(fatiar('dlog'), /diagGuardarAbertura/, 'o diário do modo dev passou a gravar a cada anotação');
  assert.doesNotMatch(fatiar('dfato'), /diagGuardarAbertura/, 'o diário passou a gravar a cada anotação');
  // A ordem no initApp: a ação da janela do Desfazer vai pra fila de saída
  // ANTES de o diagnóstico ser guardado, e a leitura vem depois do modo dev.
  const init = fatiar('initApp');
  const iDescarga = init.indexOf('setupDescargaAoSair();');
  const iGuardaAoSair = init.indexOf('setupGuardaDoDiagnostico();');
  assert.ok(iDescarga > 0 && iGuardaAoSair > iDescarga, 'a guarda do diagnóstico tem que vir DEPOIS da descarga da ação');
  const iDev = init.indexOf('loadDevMode();');
  const iCarrega = init.indexOf('diagCarregarAberturas();');
  assert.ok(iDev > 0 && iCarrega > iDev, 'a leitura do guardado tem que vir DEPOIS de o modo dev ser lido');
});

test('as gravações andam em FILA, e o retrato é tirado depois do await', () => {
  const g = fatiar('diagGuardarAbertura');
  assert.match(g, /const esta = diagGuardando\.then\(/, 'a gravação saiu da fila — uma velha pousaria por cima da nova');
  assert.match(g, /diagGuardando = esta\.catch\(/);
  const iAwait = g.indexOf('await diagLerGuardado(db)');
  const iRetrato = g.indexOf('diagRegistroDaAbertura(motivo)');
  assert.ok(iAwait > 0 && iRetrato > iAwait, 'o retrato tem que ser tirado DEPOIS do await');
  // E o apagar entra na MESMA fila — esperando a gravação em voo com TETO (uma
  // gravação pendurada o prendia pra sempre, O10), e com a época barrando a
  // gravação que acordar depois dele.
  assert.match(fatiar('diagEsquecerGuardado'),
    /const antes = Promise\.race\(\[diagGuardando, [\s\S]*?const esta = antes\.then\([\s\S]*?deleteDatabase\(DIAG_DB\)[\s\S]*?diagGuardando = esta/,
    'o apagar saiu da fila — uma gravação em voo recriaria a base logo depois');
});

test('o que foi guardado SAI ao baixar, ao desligar o modo dev e no Sair', () => {
  const baixar = fatiar('baixarDiagnostico');
  const iMarca = baixar.indexOf('dlogMarcarBaixados(corpo.entregue.momentos);');
  // O que FOI no arquivo — e só isso: a base inteira levava o que a outra aba
  // gravou depois da leitura (R6-4-5; o percurso roda mais abaixo).
  const iApaga = baixar.indexOf('diagEsquecerEntregue(corpo.entregue.aberturas);');
  assert.ok(iMarca > 0 && iApaga > iMarca, 'baixar tem que apagar o guardado que foi entregue');
  assert.doesNotMatch(baixar, /diagEsquecerGuardado\(\)/, 'baixar voltou a apagar a base INTEIRA');
  assert.match(baixar, /diagBaixadoEm = corpo\.entregue\.em;/,
    'sem o carimbo do RETRATO, o que já foi entregue volta a ser guardado — ou o que não foi se perde');
  const apagar = fatiar('dlogApagar');
  assert.match(apagar, /diagAberturasAnteriores = \[\];/, 'desligar o dev deixou as guardadas na memória');
  assert.match(apagar, /diagEsquecerGuardado\(\);/, 'desligar o dev deixou as guardadas no aparelho');
  // (O `else`: na OUTRA aba o "Sair" apaga só a memória — test/contas-abas.)
  assert.match(fatiar('handleLogout'), /^\s+(?:else )?dlogApagar\(\);/m, 'o Sair deixou o diagnóstico (DOM com dado de terceiro) no aparelho');
});

test('o número do botão e o aviso do desligar contam as guardadas; baixar as marca', () => {
  const marca = fatiar('dlogMarcarBaixados');
  assert.match(marca, /: \[\.\.\.dlogMomentos, \.\.\.diagMomentosAnteriores\(\)\];/,
    'sem a lista do retrato, marcar tem que levar as guardadas também');
  assert.match(fatiar('diagCorpo'), /momentos: \[\.\.\.momentosNoArquivo, \.\.\.diagMomentosAnteriores\(aberturasNoArquivo\)\]/,
    'o relatório não entrega as guardadas — o aviso do desligar diria "não baixadas" do que já foi entregue');
});

// ── D11 (auditoria de 2026-09-26): o que chega ENQUANTO o arquivo é montado ──
// O carimbo do "baixado" era posto no FIM do download, depois de serializar e
// empacotar: o que entrava no anel nesse intervalo não ia no arquivo e saía da
// cópia guardada (o registro guarda só o que veio DEPOIS do carimbo), e a
// captura feita ali era marcada como baixada sem ter ido. Aqui o
// `baixarDiagnostico` de verdade roda com o empacotador fazendo exatamente isso:
// uma anotação no diário e uma captura NO MEIO do zip.
test('D11: o carimbo do "baixado" é o do RETRATO — o que chega durante o zip fica pra cópia guardada', async () => {
  const R = 1_800_000_000_000;
  const ctx = {
    dfatoAnel: [{ t: R - 5, k: 'antes' }], dlogAnel: [],
    dlogMomentos: [], dlogJaBaixados: new WeakSet(), diagBaixadoEm: 0,
    diagAberturasAnteriores: [], API: { chamadas: [] }, diagErros: [],
  };
  const noArquivo = { t: 'm1', motivo: 'manual' };
  ctx.dlogMomentos.push(noArquivo);
  let agora = R;
  const apagados = [];
  const deps = {
    document: { getElementById: () => null, createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: class { constructor(p) { this.p = p; } },
    setTimeout: () => 0, t: (k) => k, APP_VERSION: '2026092601', CompressionStream: function () {},
    showToast: (msg, tipo) => { if (tipo === 'error') throw new Error('o download falhou: ' + msg); },
    atualizarFabDev: () => {}, diagEsquecerEntregue: () => apagados.push(agora),
    Date: class extends Date { static now() { return agora; } },
    // O relatório: o retrato é tirado AGORA (R), com a captura que existe.
    diagCorpo: async () => {
      const corpo = { resumo: {} };
      Object.defineProperty(corpo, 'entregue', { value: { em: agora, momentos: [...ctx.dlogMomentos], aberturas: [] } });
      return corpo;
    },
    // O empacotamento leva tempo — e o app segue vivo: uma anotação e uma captura.
    zipar: async () => {
      agora = R + 400;
      ctx.dfatoAnel.push({ t: agora, k: 'durante.zip' });
      ctx.dlogMomentos.push({ t: 'm2', motivo: 'manual' });
      agora = R + 900;
      return new Uint8Array(4);
    },
  };
  const nomes = [...Object.keys(ctx), ...Object.keys(deps)];
  const app = new Function(...nomes, `
    ${fatiar('diagMomentosAnteriores')}
    ${fatiar('dlogMarcarBaixados')}
    ${fatiar('diagChamadaSemCorpo')}
    ${fatiar('diagRegistroDaAbertura')}
    ${fatiar('baixarDiagnostico')}
    const DIAG_ABERTURA = { id: 'esta', inicio: 1 };
    return { baixar: baixarDiagnostico, registro: diagRegistroDaAbertura, baixadoEm: () => diagBaixadoEm };
  `)(...nomes.map((n) => (n in ctx ? ctx[n] : deps[n])));
  await app.baixar();
  assert.equal(apagados.length, 1, 'PRÉ-CONDIÇÃO: o download não chegou ao fim');
  assert.equal(app.baixadoEm(), R, 'o carimbo do baixado foi posto no FIM do download, não no retrato');
  assert.ok(ctx.dlogJaBaixados.has(noArquivo), 'a captura que FOI no arquivo não ficou marcada');
  const guardado = app.registro('oculta');
  assert.deepEqual(guardado.diario.map((e) => e.k), ['durante.zip'],
    'o que o diário anotou durante o zip sumiu da cópia guardada (e não foi no arquivo)');
  assert.deepEqual(guardado.momentos.map((m) => m.t), ['m2'],
    'a captura feita durante o zip foi marcada como baixada sem ter ido no arquivo');
});

test('o relatório leva as aberturas anteriores, e o resumo acusa o que elas capturaram', () => {
  const corpo = fatiar('diagCorpo');
  // As do RETRATO, com a outra aba marcada (R7-4-04: ver o teste abaixo).
  assert.match(corpo, /const aberturasMarcadas = diagMarcarSimultaneas\(aberturasNoArquivo, DIAG_ABERTURA\.inicio, vivas\);/,
    'o relatório parou de marcar a outra aba aberta junto');
  assert.match(corpo, /aberturasAnteriores: aberturasMarcadas,/, 'o relatório parou de levar as aberturas anteriores');
  assert.match(corpo, /aberturaAtual: \{ id: DIAG_ABERTURA\.id,/, 'sem a abertura atual, não se sabe de qual as outras vieram');
  assert.match(corpo, /\.concat\(aberturasMarcadas\.flatMap\(/,
    'os alertas das capturas anteriores saíram do resumo — é o defeito que atravessa fechar e reabrir');
  assert.match(corpo, /abertura: a\.id,/, 'o alerta de uma captura anterior tem que dizer de QUAL abertura veio');
  assert.match(corpo, /\.\.\.\(a\.simultanea \? \{ outraAba: true \} : \{\}\),/,
    'o alerta de uma captura da OUTRA ABA não diz que ela não é de uma abertura anterior');
  // As vivas são perguntadas JUNTO com a releitura da base, e esperadas antes do retrato.
  assert.match(corpo, /const vivasPromessa = diagAberturasVivas\(prazo\);/, 'o relatório deixou de perguntar quais aberturas seguem vivas');
  const iVivas = corpo.indexOf('const vivas = await vivasPromessa;');
  const iRetrato = corpo.indexOf('const retratoEm = Date.now();');
  assert.ok(iVivas > 0 && iRetrato > iVivas, 'as aberturas vivas têm que chegar ANTES do retrato');
});

// ── R7-4-04: a OUTRA ABA aberta não é uma abertura ANTERIOR ─────────────────
// Desde o R6-4-5 o relatório leva o que a outra aba aberta gravou, e ela chegava
// em `aberturasAnteriores` igual a uma abertura que FECHOU: no relatório do
// auditor, a "anterior" tinha começado 343 ms DEPOIS da do relatório.
test('R7-4-04: a abertura que gravou DEPOIS de esta abrir, ou que segue viva, é marcada como OUTRA ABA', () => {
  const marcar = new Function(fatiar('diagMarcarSimultaneas') + '\nreturn diagMarcarSimultaneas;')();
  const INICIO = AGORA;
  const antes = { id: 'antes', inicio: INICIO - 2 * HORA, salvoEm: INICIO - HORA, momentos: [] };   // fechou antes
  const junto = { id: 'junto', inicio: INICIO + 343, salvoEm: INICIO + 1525, momentos: [{ t: 'x' }] }; // o caso do auditor
  const velhaViva = { id: 'velhaViva', inicio: INICIO - HORA, salvoEm: INICIO - 1000, momentos: [] }; // aberta antes, viva
  const r = marcar([antes, junto, velhaViva], INICIO, new Set(['junto', 'velhaViva']));
  assert.equal(r[0], antes, 'a abertura que FECHOU antes desta tem que voltar a MESMA, sem marca');
  assert.deepEqual([r[1].simultanea, r[1].abertaAgora], [true, true], 'a que gravou depois de esta abrir não foi marcada');
  assert.equal(r[1].momentos, junto.momentos, 'a marca copiou as capturas (tem que ser a mesma lista)');
  assert.deepEqual([r[2].simultanea, r[2].abertaAgora], [true, true], 'a aberta antes, viva agora, não foi marcada');
  // Sem saber quais vivem (o navegador sem `navigator.locks`): vale a hora.
  const semTravas = marcar([antes, junto, velhaViva], INICIO, null);
  assert.equal(semTravas[0], antes);
  assert.deepEqual([semTravas[1].simultanea, semTravas[1].abertaAgora], [true, null], 'sem as travas, a hora tem que bastar');
  assert.equal(semTravas[2], velhaViva, 'sem as travas e sem gravar depois, não há como dizer — fica como estava');
  // A que gravou depois e já FECHOU: junto com esta, e fechada.
  const fechou = marcar([junto], INICIO, new Set());
  assert.deepEqual([fechou[0].simultanea, fechou[0].abertaAgora], [true, false]);
  assert.deepEqual(marcar(undefined, INICIO, null), []);
});

test('R7-4-04: a abertura que GRAVA segura a trava com o id dela, e o relatório lê as vivas pelo nome', async () => {
  const g = fatiar('diagGuardarAbertura');
  assert.match(g, /^function diagGuardarAbertura\(motivo\) \{\s*if \(!dlogLigado\(\)\) return Promise\.resolve\(false\);\s*diagSegurarAbertura\(\);/,
    'a abertura que grava não segura a trava dela (o relatório da outra aba não a veria viva)');
  // A trava RODADA, contra um `navigator.locks` de mentira.
  const DIAG_ABERTURA_TRAVA = /^const DIAG_ABERTURA_TRAVA = '([^']+)';/m.exec(APP_SEM)[1];
  const montar = (navigator) => new Function('navigator', 'DIAG_ABERTURA', 'DIAG_ABERTURA_TRAVA',
    `let diagAberturaSegura = false;\n${fatiar('diagSegurarAbertura')}\n${fatiar('diagAberturasVivas')}
    return { diagSegurarAbertura, diagAberturasVivas };`)(navigator, { id: 'esta' }, DIAG_ABERTURA_TRAVA);
  const pedidos = [];
  const app = montar({ locks: {
    request: (nome, opcoes, fn) => { pedidos.push([nome, opcoes]); fn({}); return Promise.resolve(); },
    query: async () => ({ held: [{ name: DIAG_ABERTURA_TRAVA + 'outra' }, { name: '__abaDaSaida:x' }, { name: DIAG_ABERTURA_TRAVA + 'esta' }] }),
  } });
  app.diagSegurarAbertura();
  app.diagSegurarAbertura();
  assert.deepEqual(pedidos, [[DIAG_ABERTURA_TRAVA + 'esta', { ifAvailable: true }]],
    'a trava tem que ser pedida UMA vez, com o id desta abertura');
  const vivas = await app.diagAberturasVivas(Date.now() + 1000);
  assert.deepEqual([...vivas].sort(), ['esta', 'outra'], 'as vivas saem dos nomes das travas — e só das do diagnóstico');
  // Sem `navigator.locks`: não dá pra saber, e nada quebra.
  const sem = montar({});
  sem.diagSegurarAbertura();
  assert.equal(await sem.diagAberturasVivas(Date.now() + 1000), null);
  // E a pergunta tem TETO: o relatório tem orçamento.
  const pendurada = montar({ locks: { request: () => Promise.resolve(), query: () => new Promise(() => {}) } });
  assert.equal(await pendurada.diagAberturasVivas(Date.now() + 30), null, 'a pergunta pendurada segurou o relatório');
});

test('a Ajuda diz a verdade sobre o que fica no aparelho, nos 4 idiomas', () => {
  // A frase dizia "não são gravados em lugar nenhum" enquanto o offline já
  // guardava a fila e o mapa — e o modo dev passou a guardar capturas. O app
  // não mente sobre si (é a mesma régua do `help.privacy.zeroKnowledge`): a
  // frase cita o NOME que a tela usa pra cada exceção, e o prazo do CÓDIGO.
  const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  const valores = (chave) => [...I18N.matchAll(new RegExp(`'${chave.replace(/\./g, '\\.')}': '([^']*)'`, 'g'))].map((m) => m[1]);
  const frases = valores('help.privacy.notStored');
  const offline = valores('prefs.offline.label');
  const dev = valores('prefs.devMode.label').map((v) => v.replace(/\s*🛠️\s*$/u, ''));
  assert.equal(frases.length, 4, 'a frase de privacidade tem que existir nas 4 línguas');
  assert.equal(offline.length, 4);
  assert.equal(dev.length, 4);
  const horas = DIAG.DIAG_GUARDA_MS / HORA;
  for (let i = 0; i < 4; i++) {
    assert.ok(frases[i].includes(offline[i]), `a Ajuda (${i}) não cita o "${offline[i]}", que guarda a fila e o mapa`);
    assert.ok(frases[i].includes(dev[i]), `a Ajuda (${i}) não cita o "${dev[i]}", que guarda as capturas`);
    assert.ok(frases[i].includes(`${horas} h`), `a Ajuda (${i}) não diz o prazo do código (${horas} h)`);
  }
  // E o que o aparelho guarda sempre inclui as ações esperando envio (a fila de
  // saída, com o autor de cada pedido): mesmo termo do indicador na tela.
  const aparelho = valores('help.privacy.device');
  const indicador = valores('indicator.waiting').map((v) => v.replace('{n} ', ''));
  assert.equal(aparelho.length, 4);
  for (let i = 0; i < 4; i++) {
    const nucleo = indicador[i].split(' ').slice(-1)[0];   // "envio" / "send" / "envío" / "d’envoi"
    assert.ok(aparelho[i].includes(nucleo), `a Ajuda (${i}) não conta as ações esperando envio ("${nucleo}")`);
  }
});

test('o que o botão do modo dev registra tem UM nome por língua, e o arquivo baixado o nome do botão (T5)', () => {
  // Em português a tela diz "registrar a tela" e "N registros não baixados", e
  // a Ajuda dizia "as capturas" pra mesma coisa; em inglês o aviso mandava
  // baixar o "report" — que o botão, a Ajuda e o aviso de pronto chamam de
  // "diagnostics" (e "Report", no card, é o reporte de um pedido). Auditoria
  // de 2026-09-29. O nome vem da TELA: o do aviso do desligar e o do botão.
  const I18N = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
  const valores = (chave) => [...I18N.matchAll(new RegExp(`'${chave.replace(/\./g, '\\.')}': '([^']*)'`, 'g'))].map((m) => m[1]);
  const aviso = valores('toast.devPerdeCaptura');     // "Há {n} registros não baixados: baixe o diagnóstico…"
  const ajuda = valores('help.privacy.notStored');
  const botao = valores('filters.diag.btn');          // "Baixar diagnóstico"
  assert.equal(aviso.length, 4);
  assert.equal(ajuda.length, 4);
  assert.equal(botao.length, 4);
  for (let i = 0; i < 4; i++) {
    const nome = (/\{n\} (\S+)/.exec(aviso[i]) || [])[1];
    assert.ok(nome, `PRÉ-CONDIÇÃO: o aviso (${i}) mudou de forma — não achei o nome depois de {n}`);
    assert.ok(ajuda[i].includes(nome), `a Ajuda (${i}) chama de outro nome o que a tela chama de "${nome}"`);
    const arquivo = botao[i].split(/\s+/).pop().toLowerCase();
    assert.ok(aviso[i].toLowerCase().includes(arquivo), `o aviso (${i}) manda baixar outra coisa que não o "${arquivo}" do botão`);
    assert.ok(ajuda[i].toLowerCase().includes(arquivo), `a Ajuda (${i}) chama de outro nome o "${arquivo}" do botão`);
  }
});

// ── O10: a base do diagnóstico tem TETO (auditoria de 2026-09-26) ────────────
// O IndexedDB do WebKit às vezes não responde. A gravação com a abertura
// pendurada prendia a fila `diagGuardando`, e o apagar do "Sair" e do desligar
// do modo dev — que entra na MESMA fila — nunca rodava (p11: 3 s depois, o
// `deleteDatabase` nem tinha sido chamado).
function baseDoDiag({ abrir }) {
  let apagou = 0;
  const gravados = [];
  const indexedDB = {
    open: () => abrir(gravados),
    deleteDatabase: () => { apagou++; const r = {}; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; },
  };
  const deps = { indexedDB, DIAG_DB: 'waze_places_diag', DIAG_STORE: 'aberturas', DIAG_DB_TETO_MS: 30,
    DIAG_ABERTURA: { id: 'esta' }, dlogLigado: () => true, dfato: () => {}, modoDevDesligadoNoArmazenamento: () => false,
    diagSegurarAbertura: () => {},
    diagRegistroDaAbertura: () => ({ id: 'esta', salvoEm: Date.now(), inicio: Date.now(), momentos: [] }),
    diagPodarAberturas: (l) => ({ manter: l, sair: [], cortadas: [] }) };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let diagGuardando = Promise.resolve(), diagEpoca = 0;
    ${['diagDB', 'diagLerGuardado', 'diagAplicarPoda', 'diagGuardarAbertura', 'diagEsquecerGuardado'].map(fatiar).join('\n')}
    return { diagGuardarAbertura, diagEsquecerGuardado };`)(...chaves.map((k) => deps[k]));
  return { app, apagou: () => apagou, gravados };
}
const comTetoDe = (ms, p) => Promise.race([p.then(() => 'terminou'), new Promise((ok) => setTimeout(() => ok('PENDUROU'), ms))]);

test('O10: a abertura PENDURADA da base não prende o apagar do "Sair"', async () => {
  const b = baseDoDiag({ abrir: () => ({}) });               // nem success, nem error
  b.app.diagGuardarAbertura('oculta');
  assert.equal(await comTetoDe(1000, b.app.diagEsquecerGuardado()), 'terminou', 'o apagar esperou a gravação pendurada pra sempre');
  assert.equal(b.apagou(), 1, 'a base do diagnóstico não foi apagada');
});

test('O10: a gravação que ACORDA depois do apagar não grava nada (a época)', async () => {
  // A abertura responde, mas a leitura do que está guardado pendura; quando ela
  // acordar, o apagar já passou — e a gravação não pode recriar a base.
  let soltarLeitura = null;
  const b = baseDoDiag({ abrir: (gravados) => {
    const req = {};
    const db = {
      close() {},
      transaction: () => {
        const tx = {
          objectStore: () => ({
            getAll: () => { const r = {}; soltarLeitura = () => { r.result = []; r.onsuccess(); }; return r; },
            delete: () => {}, put: (a) => { gravados.push(a.id); },
          }),
        };
        setTimeout(() => tx.oncomplete && tx.oncomplete(), 5);
        return tx;
      },
    };
    setTimeout(() => { req.result = db; req.onsuccess(); }, 0);
    return req;
  } });
  b.app.diagGuardarAbertura('oculta');
  // A gravação COMEÇA (abre a base e pede a leitura) — e a leitura pendura.
  for (let i = 0; i < 40 && !soltarLeitura; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(soltarLeitura, 'PRÉ-CONDIÇÃO: a gravação não chegou a pedir a leitura — não mediria a gravação EM VOO');
  assert.equal(await comTetoDe(1000, b.app.diagEsquecerGuardado()), 'terminou', 'a leitura pendurada prendeu o apagar');
  assert.equal(b.apagou(), 1);
  soltarLeitura();                                            // a gravação acorda DEPOIS
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(b.gravados, [], 'a gravação que acordou depois do apagar recriou a base');
  // E a gravação pedida ANTES do apagar mas ainda na FILA (nem começou) também
  // não grava: a época é a do pedido.
  soltarLeitura = null;
  b.app.diagGuardarAbertura('oculta');
  await b.app.diagEsquecerGuardado();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(soltarLeitura, null, 'a gravação que o apagar venceu ainda abriu a base e leu');
  assert.deepEqual(b.gravados, []);
});

test('O10: uma gravação com a abertura PENDURADA não prende as seguintes (o teto da base)', async () => {
  // A 1ª abertura nunca responde; a 2ª abre. Sem o teto, a 2ª gravação — que
  // entra na fila atrás da 1ª — nunca rodava: o diário do "ir pro fundo" some.
  let aberturas = 0;
  const b = baseDoDiag({ abrir: (gravados) => {
    if (++aberturas === 1) return {};
    const req = {};
    const db = { close() {}, transaction: () => {
      const tx = { objectStore: () => ({
        getAll: () => { const r = {}; setTimeout(() => { r.result = []; r.onsuccess(); }, 0); return r; },
        delete: () => {}, put: (a) => gravados.push(a.id) }) };
      setTimeout(() => tx.oncomplete && tx.oncomplete(), 5);
      return tx;
    } };
    setTimeout(() => { req.result = db; req.onsuccess(); }, 0);
    return req;
  } });
  b.app.diagGuardarAbertura('oculta');
  const segunda = b.app.diagGuardarAbertura('saida');
  assert.equal(await comTetoDe(1000, segunda), 'terminou', 'a gravação seguinte ficou presa atrás da abertura pendurada');
  assert.deepEqual(b.gravados, ['esta'], 'a gravação seguinte não gravou');
});

// ── D2 (auditoria de 2026-09-26): DUAS ABAS, e o que sobra sem o modo dev ─────
// Desligar o modo dev ou dar "Sair" numa aba não chegava à outra: ela seguia com
// o FAB e o modo dev na memória, e a captura seguinte RECRIAVA a base com o DOM
// da tela. E a poda de 24 h só rodava com o modo dev ligado. O percurso com duas
// páginas de verdade está na seção 9e do `tools/smoke-offline.mjs`.
function abaComModoDev({ guardado, memoria = { unlocked: true, active: true } }) {
  const apagou = [], fab = [];
  const AppState = { devMode: { ...memoria } };
  const localStorage = { getItem: (k) => (k === 'waze_places_devmode' ? guardado() : null) };
  const deps = { AppState, localStorage, DEVMODE_KEY: 'waze_places_devmode',
    HISTORY_KEY: 'h', CONQUISTAS_KEY: 'c', AUTORES_KEY: 'a',
    dlogApagar: () => apagou.push(1), atualizarFabDev: () => fab.push(1), updateDevBadge() {}, renderDevModeSection() {},
    diagAjustarRecursos() {}, enforceDevGatedFilters() {}, atualizarSeloDeConquista() {}, agendarRedesenhoDoHistorico() {},
    sincronizarComOutraAba() {} };   // o "Sair", o placar e as preferências da outra aba: test/contas-abas
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, ['devModeDoArmazenamento', 'modoDevDesligadoNoArmazenamento',
    'aoMudarModoDevEmOutraAba', 'aoGravarEmOutraAba'].map(fatiar).join('\n')
    + '\nreturn { aoGravarEmOutraAba, desligado: modoDevDesligadoNoArmazenamento };')(...chaves.map((k) => deps[k]));
  return { app, AppState, apagou, fab };
}

test('D2: o modo dev desligado (ou o "Sair") noutra aba chega a esta — ela apaga o que o modo dev gravou', () => {
  let guardado = JSON.stringify({ unlocked: true, active: true });
  const aba = abaComModoDev({ guardado: () => guardado });
  guardado = JSON.stringify({ unlocked: true, active: false });     // desligado na OUTRA aba
  aba.app.aoGravarEmOutraAba({ key: 'waze_places_devmode' });
  assert.equal(aba.AppState.devMode.active, false, 'esta aba seguiu com o modo dev ligado na memória');
  assert.equal(aba.apagou.length, 1, 'esta aba não apagou o que o modo dev gravou (o DOM das capturas, a base)');
  // O "Sair" da outra aba: ele desliga o modo dev e tira o token — o aviso do
  // token (que chega primeiro) já lê o armazenamento como ele ficou.
  guardado = JSON.stringify({ unlocked: true, active: true });
  const sair = abaComModoDev({ guardado: () => guardado });
  guardado = JSON.stringify({ unlocked: false, active: false });
  sair.app.aoGravarEmOutraAba({ key: 'waze_session_token' });
  assert.equal(sair.apagou.length, 1, 'o "Sair" da outra aba não chegou a esta');
  // A outra aba LIMPANDO o armazenamento inteiro.
  guardado = JSON.stringify({ unlocked: true, active: true });
  const limpou = abaComModoDev({ guardado: () => guardado });
  guardado = null;
  limpou.app.aoGravarEmOutraAba({ key: null });
  assert.equal(limpou.apagou.length, 1, 'a limpeza da outra aba não desligou o modo dev desta');
});

test('D2: a QUEDA da sessão noutra aba (o modo dev segue ligado) NÃO apaga a evidência', () => {
  // A queda é o que o diagnóstico existe pra mostrar — e a própria aba que caiu
  // o preserva (`derrubarSessao` não chama o `dlogApagar`).
  const guardado = JSON.stringify({ unlocked: true, active: true });
  const aba = abaComModoDev({ guardado: () => guardado });
  aba.app.aoGravarEmOutraAba({ key: 'waze_session_token' });
  assert.equal(aba.apagou.length, 0, 'a queda da sessão noutra aba apagou o diagnóstico desta');
  assert.equal(aba.AppState.devMode.active, true);
  // Chave alheia não mexe no modo dev; armazenamento ilegível não decide nada.
  aba.app.aoGravarEmOutraAba({ key: 'waze_places_stats' });
  assert.equal(aba.fab.length, 1, 'só o aviso do token devia ter reavaliado o botão');
  const ilegivel = abaComModoDev({ guardado: () => { throw new Error('bloqueado'); } });
  ilegivel.app.aoGravarEmOutraAba({ key: 'waze_places_devmode' });
  assert.equal(ilegivel.apagou.length, 0, 'armazenamento ilegível desligou o modo dev');
  assert.equal(ilegivel.app.desligado(), false, 'ilegível não pode contar como "desligado no armazenamento"');
});

test('D2: a gravação confere o modo dev no ARMAZENAMENTO — desligado lá, não abre a base', async () => {
  // O armazenamento diz "desligado" (a outra aba desligou, e o aviso ainda não
  // chegou a esta: a memória diz ligado).
  const montar = (desligadoLa) => {
    const conta = { aberturas: 0 };
    const deps = { indexedDB: { open: () => { conta.aberturas++; return {}; }, deleteDatabase: () => ({}) },
      DIAG_DB: 'waze_places_diag', DIAG_STORE: 'aberturas', DIAG_DB_TETO_MS: 30, DIAG_ABERTURA: { id: 'esta' },
      dlogLigado: () => true, dfato: () => {}, modoDevDesligadoNoArmazenamento: () => desligadoLa,
      diagSegurarAbertura: () => {},
      diagRegistroDaAbertura: () => ({ id: 'esta', salvoEm: 1, inicio: 1, momentos: [] }),
      diagPodarAberturas: (l) => ({ manter: l, sair: [], cortadas: [] }) };
    const chaves = Object.keys(deps);
    const app = new Function(...chaves, `let diagGuardando = Promise.resolve(), diagEpoca = 0;
      ${['diagDB', 'diagLerGuardado', 'diagAplicarPoda', 'diagGuardarAbertura'].map(fatiar).join('\n')}
      return { diagGuardarAbertura };`)(...chaves.map((k) => deps[k]));
    return { app, conta };
  };
  const la = montar(true);
  assert.equal(await la.app.diagGuardarAbertura('captura'), false, 'gravou com o modo dev desligado no armazenamento');
  assert.equal(la.conta.aberturas, 0, 'abriu (e criaria) a base com o modo dev desligado no armazenamento');
  // CONTROLE: ligado lá também, a gravação vai à base (a abertura pendura aqui
  // de propósito — o que se mede é ela ter sido PEDIDA).
  const ok = montar(false);
  ok.app.diagGuardarAbertura('captura');
  for (let i = 0; i < 20 && !ok.conta.aberturas; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(ok.conta.aberturas, 1, 'CONTROLE: com o modo dev ligado a gravação não foi à base — a medida acima não distingue nada');
});

test('D2: com o modo dev DESLIGADO, a sobra no aparelho sai na abertura — sem criar a base', async () => {
  const montar = ({ ligado = false, bases = [], semDatabases = false }) => {
    const esquecido = [], fatos = [], retratos = [];
    const indexedDB = semDatabases ? {} : { databases: async () => bases.map((name) => ({ name })) };
    const deps = { indexedDB, DIAG_DB: 'waze_places_diag', dlogLigado: () => ligado,
      dfato: (k) => fatos.push(k), diagEsquecerGuardado: async () => { esquecido.push(1); return true; },
      diagEsquecerRetratos: (lidos) => retratos.push(lidos) };
    const chaves = Object.keys(deps);
    const f = new Function(...chaves, fatiar('diagFaxinaSemModoDev') + '\nreturn diagFaxinaSemModoDev;')(...chaves.map((k) => deps[k]));
    return { f, esquecido, fatos, retratos };
  };
  const sobra = montar({ bases: ['waze_places_diag', 'waze_places_offline'] });
  assert.equal(await sobra.f(), true);
  assert.equal(sobra.esquecido.length, 1, 'a sobra do diagnóstico ficou no aparelho com o modo dev desligado');
  assert.deepEqual(sobra.fatos, ['diag.sobraApagada']);
  // O retrato do fechar (no localStorage) sai também — TODOS, sem lista.
  assert.deepEqual(sobra.retratos, [undefined], 'o retrato do fechar ficou no aparelho com o modo dev desligado');
  const nada = montar({ bases: ['waze_places_offline'] });
  await nada.f();
  assert.equal(nada.esquecido.length, 0, 'sem a base, a faxina não tem o que fazer (e não pode criar nada)');
  const ligado = montar({ ligado: true, bases: ['waze_places_diag'] });
  await ligado.f();
  assert.equal(ligado.esquecido.length, 0, 'com o modo dev LIGADO a faxina apagou o guardado — quem cuida ali é a poda de 24 h');
  assert.deepEqual(ligado.retratos, [], 'com o modo dev LIGADO a faxina apagou o retrato do fechar — ele é da abertura seguinte');
  const cego = montar({ semDatabases: true });
  await cego.f();
  assert.equal(cego.esquecido.length, 1, 'sem `databases()` o apagar (que não cria nada) tem que acontecer às cegas');
  assert.deepEqual(cego.fatos, [], 'às cegas não se sabe se havia sobra — o diário não pode afirmar');
  // E a faxina NUNCA abre a base: nem `open` no corpo dela.
  assert.doesNotMatch(fatiar('diagFaxinaSemModoDev'), /indexedDB\.open\(/, 'a faxina abre a base (e a criaria vazia)');
  // A abertura do app chama a faxina depois de ler o modo dev.
  const init = fatiar('initApp');
  const iDev = init.indexOf('loadDevMode();'), iFax = init.indexOf('diagFaxinaSemModoDev();');
  assert.ok(iDev > 0 && iFax > iDev, 'a faxina tem que rodar DEPOIS de o modo dev ser lido');
});

// ── D2 (auditoria de 2026-09-29): FECHAR sem ir pro fundo ────────────────────
// Recarregar a página ou fechar a aba ABORTA a gravação na base (assíncrona):
// medido, recarregar perdeu a abertura em 5 de 5, fechar em 2 de 5. No
// `pagehide` vai um RETRATO compacto pro localStorage, de forma SÍNCRONA, e a
// abertura seguinte o junta à base e o apaga. O percurso inteiro (recarregar e
// fechar de verdade, com o controle do modo dev desligado) está na seção 9f do
// `tools/smoke-offline.mjs`.
function armazenamento(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  const escritas = [];
  return {
    m, escritas,
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { escritas.push(k); m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}
const DIAG_RETRATO_KEY = constante('DIAG_RETRATO_KEY');
const DIAG_RETRATO_TETO = constante('DIAG_RETRATO_TETO');
const compacto = new Function(fatiar('diagRetratoCompacto') + '\nreturn diagRetratoCompacto;')();
const juntarRetrato = new Function(fatiar('diagJuntarRetrato') + '\nreturn diagJuntarRetrato;')();

test('D2: o retrato do fechar vai SEM as capturas, e sem nada a guardar não escreve', () => {
  const reg = { id: 'a', inicio: 1, salvoEm: 5, salvoPor: 'saida', versao: 'v',
    diario: [{ t: 1, k: 'x' }], chamadas: [{ t: new Date(2).toISOString(), rota: 'perfil', http: 200 }], erros: [],
    momentos: [{ t: 'm', motivo: 'manual', dom: 'x'.repeat(150000) }] };
  const txt = compacto(reg, DIAG_RETRATO_TETO);
  const r = JSON.parse(txt);
  assert.ok(!('momentos' in r) && !txt.includes('xxxx'), 'o retrato levou as capturas (~150 KB cada) pro localStorage');
  assert.equal(r.retrato, true, 'o retrato não se identifica — o leitor não o separa da gravação da base');
  assert.deepEqual([r.id, r.salvoEm, r.salvoPor, r.diario, r.chamadas, r.erros],
    [reg.id, reg.salvoEm, reg.salvoPor, reg.diario, reg.chamadas, reg.erros]);
  assert.ok(!('cortados' in r), 'cabendo no teto, nada foi cortado');
  assert.equal(compacto({ ...reg, diario: [], chamadas: [], erros: [] }, DIAG_RETRATO_TETO), null,
    'sem diário, chamada nem erro, o retrato não tem o que guardar');
});

test('D2: o retrato tem TETO e corta do mais VELHO — o fim do diário, as chamadas e os erros ficam', () => {
  const diario = Array.from({ length: 3000 }, (_, i) => ({ t: 1000 + i, k: 'dlog.acao', n: i, d: 'y'.repeat(60) }));
  const chamadas = Array.from({ length: 60 }, (_, i) => ({ t: new Date(5000 + i).toISOString(), rota: 'buscar-places', http: 200, n: i }));
  const erros = Array.from({ length: 50 }, (_, i) => ({ t: new Date(6000 + i).toISOString(), tipo: 'error', msg: 'e' + i }));
  const txt = compacto({ id: 'a', inicio: 1, salvoEm: 9, salvoPor: 'saida', diario, chamadas, erros }, DIAG_RETRATO_TETO);
  assert.ok(txt && txt.length <= DIAG_RETRATO_TETO, `o retrato passou do teto: ${txt && txt.length}`);
  const r = JSON.parse(txt);
  assert.ok(r.diario[0].n > 0, 'PRÉ-CONDIÇÃO: o teto não cortou nada — o caso não mede o corte');
  assert.equal(r.diario[r.diario.length - 1].n, 2999, 'o corte levou o FIM do diário — o que aconteceu logo antes de fechar');
  assert.equal(r.cortados.diario, r.diario[0].n, 'o retrato não diz quanto do diário cortou');
  assert.equal(r.chamadas.length, 60, 'as chamadas (anel curto) foram cortadas antes do diário');
  assert.equal(r.erros.length, 50, 'os erros (anel curto) foram cortados antes do diário');
  // Nem cortado cabe (entrada maior que o teto): não escreve um retrato vazio, nem estoura.
  assert.equal(compacto({ id: 'a', salvoEm: 9, diario: [{ t: 1, k: 'x', d: 'z'.repeat(DIAG_RETRATO_TETO + 10) }] }, DIAG_RETRATO_TETO), null);
});

test('D2: o retrato só é escrito com o modo dev LIGADO (na memória E no armazenamento), na chave DESTA abertura', () => {
  const montar = ({ ligado = true, desligadoLa = false, cheio = false } = {}) => {
    const ls = armazenamento({ waze_places_stats: '{}' });
    if (cheio) ls.setItem = () => { throw new DOMException('cheio', 'QuotaExceededError'); };
    const deps = { dlogLigado: () => ligado, modoDevDesligadoNoArmazenamento: () => desligadoLa, localStorage: ls,
      diagRetratoCompacto: compacto, DIAG_RETRATO_KEY, DIAG_RETRATO_TETO, DIAG_ABERTURA: { id: 'esta-abertura' },
      diagRegistroDaAbertura: (motivo) => ({ id: 'esta-abertura', salvoEm: 7, salvoPor: motivo, diario: [{ t: 1, k: 'x' }],
                                              chamadas: [], erros: [], momentos: [] }) };
    const chaves = Object.keys(deps);
    const f = new Function(...chaves, fatiar('diagRetratoAoSair') + '\nreturn diagRetratoAoSair;')(...chaves.map((k) => deps[k]));
    return { f, ls };
  };
  const ok = montar();
  assert.equal(ok.f(), true);
  assert.deepEqual(ok.ls.escritas, [DIAG_RETRATO_KEY + ':esta-abertura'], 'o retrato não foi pra chave desta abertura');
  assert.equal(JSON.parse(ok.ls.getItem(DIAG_RETRATO_KEY + ':esta-abertura')).salvoPor, 'saida');
  const semDev = montar({ ligado: false });
  assert.equal(semDev.f(), false);
  assert.deepEqual(semDev.ls.escritas, [], 'com o modo dev DESLIGADO o fechar escreveu no aparelho');
  const la = montar({ desligadoLa: true });
  assert.equal(la.f(), false);
  assert.deepEqual(la.ls.escritas, [], 'desligado noutra aba (o aviso ainda não chegou), o fechar escreveu no aparelho');
  assert.equal(montar({ cheio: true }).f(), false, 'a cota cheia derrubou o `pagehide`');
  // Desligado, nem o retrato é montado: a PRIMEIRA linha sai.
  assert.match(fatiar('diagRetratoAoSair'), /^function diagRetratoAoSair\(\) \{\s*if \(!dlogLigado\(\)\) return false;/,
    'o retrato tem que sair na PRIMEIRA linha sem o modo dev — é o custo de quem não o liga');
});

test('D2: o `pagehide` grava o retrato SÍNCRONO antes de pedir a gravação da base', () => {
  assert.match(fatiar('setupGuardaDoDiagnostico'),
    /addEventListener\('pagehide', \(\) => \{\s*diagRetratoAoSair\(\);\s*diagGuardarAbertura\('saida'\);\s*\}\)/,
    'o fechar voltou a depender só da gravação assíncrona, que o navegador aborta');
});

test('D2: a abertura seguinte JUNTA o retrato ao que a base tinha da mesma abertura', () => {
  const t = (s) => new Date(s).toISOString();
  const base = { id: 'x', inicio: 1, salvoEm: 100, salvoPor: 'captura', momentos: [{ t: 'cap', motivo: 'manual' }],
    diario: [{ t: 10, k: 'velho' }, { t: 60, k: 'meio' }], chamadas: [{ t: t(20), rota: 'perfil' }], erros: [{ t: t(30), msg: 'e1' }] };
  const retrato = { id: 'x', inicio: 1, salvoEm: 200, salvoPor: 'saida', retrato: true, cortados: { diario: 1 },
    diario: [{ t: 60, k: 'meio' }, { t: 150, k: 'fim' }], chamadas: [{ t: t(20), rota: 'perfil' }, { t: t(160), rota: 'buscar-places' }], erros: [] };
  const j = juntarRetrato(base, retrato);
  assert.deepEqual(j.momentos, base.momentos, 'as capturas da base (as únicas que existem) sumiram na junção');
  assert.deepEqual(j.diario.map((e) => e.k), ['velho', 'meio', 'fim'],
    'o diário juntado repete ou perde entrada: fica da base só o que é ANTERIOR ao retrato');
  assert.deepEqual(j.chamadas.map((c) => c.rota), ['perfil', 'buscar-places'], 'as chamadas (hora em ISO) não juntaram');
  assert.deepEqual(j.erros, base.erros, 'o retrato sem erros apagou os erros da base');
  assert.equal(j.salvoPor, 'saida');
  assert.equal(j.retrato, true);
  // A base MAIS NOVA (a gravação do `pagehide` chegou a terminar) já tem tudo.
  const novaNaBase = { ...base, salvoEm: 300 };
  assert.equal(juntarRetrato(novaNaBase, retrato), novaNaBase, 'a base mais nova foi trocada pelo retrato (cortado)');
  // Sem nada na base: o retrato vira o registro, sem capturas.
  const so = juntarRetrato(null, retrato);
  assert.deepEqual(so.momentos, []);
  assert.deepEqual(so.diario, retrato.diario);
});

// Uma base em memória, com o jeito do IndexedDB (respostas no tique seguinte).
function baseNaMemoria(registros = [], { segurarAbertura = null } = {}) {
  const loja = new Map(registros.map((r) => [r.id, r]));
  const indexedDB = {
    open: () => {
      const req = {};
      const responder = () => {
        req.result = {
          objectStoreNames: { contains: () => true }, close() {},
          transaction: () => {
            const tx = {};
            tx.objectStore = () => ({
              getAll: () => { const r = {}; setTimeout(() => { r.result = [...loja.values()]; r.onsuccess(); }, 0); return r; },
              put: (a) => { loja.set(a.id, a); },
              delete: (id) => { loja.delete(id); },
            });
            setTimeout(() => tx.oncomplete && tx.oncomplete(), 1);
            return tx;
          },
        };
        req.onsuccess();
      };
      if (segurarAbertura) segurarAbertura(() => responder()); else setTimeout(responder, 0);
      return req;
    },
    deleteDatabase: () => ({}),
  };
  return { indexedDB, loja };
}
function carregador({ ls, base, ligado = () => true }) {
  const deps = { localStorage: ls, indexedDB: base.indexedDB, dlogLigado: ligado, dfato: () => {}, atualizarFabDev: () => {},
    DIAG_ABERTURA: { id: 'agora' }, DIAG_DB: 'waze_places_diag', DIAG_STORE: 'aberturas', DIAG_DB_TETO_MS: 200,
    DIAG_RETRATO_KEY, ...DIAG };
  const chaves = Object.keys(deps);
  return new Function(...chaves, `let diagAberturasAnteriores = [], diagEpoca = 0;
    ${['diagDB', 'diagLerGuardado', 'diagAplicarPoda', 'diagPodarAberturas', 'diagMomentosAnteriores',
       'diagLerRetratos', 'diagEsquecerRetratos', 'diagJuntarRetrato', 'diagCarregarAberturas'].map(fatiar).join('\n')}
    return { carregar: diagCarregarAberturas, anteriores: () => diagAberturasAnteriores, apagar: () => { diagEpoca++; } };`)(
    ...chaves.map((k) => deps[k]));
}

test('D2: a abertura com o modo dev leva o retrato pra base e APAGA a chave — só a que leu, e o lixo', async () => {
  const agora = Date.now(), H = 3600e3;
  const k = (id) => DIAG_RETRATO_KEY + ':' + id;
  const base = baseNaMemoria([{ id: 'antiga', inicio: agora - 2 * H, salvoEm: agora - H, salvoPor: 'captura',
    momentos: [{ t: 'cap', motivo: 'manual' }], diario: [{ t: agora - 1.5 * H, k: 'antes' }], chamadas: [], erros: [] }]);
  const ls = armazenamento({
    [k('antiga')]: JSON.stringify({ id: 'antiga', inicio: agora - 2 * H, salvoEm: agora - H / 2, salvoPor: 'saida', retrato: true,
                                    diario: [{ t: agora - H / 2 - 10, k: 'fim' }], chamadas: [], erros: [] }),
    [k('fechou')]: JSON.stringify({ id: 'fechou', inicio: agora - H / 4, salvoEm: agora - 60e3, salvoPor: 'saida', retrato: true,
                                    diario: [{ t: agora - 70e3, k: 'so-no-retrato' }], chamadas: [], erros: [] }),
    [k('vencida')]: JSON.stringify({ id: 'vencida', inicio: agora - 30 * H, salvoEm: agora - 25 * H, salvoPor: 'saida',
                                     diario: [{ t: agora - 25 * H, k: 'velha' }], chamadas: [], erros: [] }),
    [k('lixo')]: '{nao é json',
    waze_places_stats: '{"read":1}',
  });
  const app = carregador({ ls, base });
  await app.carregar();
  const antiga = base.loja.get('antiga');
  assert.deepEqual(antiga.diario.map((e) => e.k), ['antes', 'fim'], 'o retrato não foi juntado ao que a base tinha');
  assert.equal(antiga.momentos.length, 1, 'a captura que a base tinha sumiu na junção');
  assert.deepEqual(base.loja.get('fechou').diario.map((e) => e.k), ['so-no-retrato'],
    'a abertura que só existia no retrato (a gravação da base foi abortada) não foi pra base');
  assert.ok(!base.loja.has('vencida'), 'o retrato de mais de 24 h entrou na base — o prazo é o mesmo');
  assert.deepEqual([...ls.m.keys()], ['waze_places_stats'], 'sobrou retrato no localStorage, ou a leitura apagou chave alheia');
  assert.deepEqual(app.anteriores().map((a) => a.id).sort(), ['antiga', 'fechou'], 'o relatório desta abertura não traz os retratos');
});

test('D2: desligado o modo dev enquanto a base abria, nada do retrato volta pro aparelho', async () => {
  const agora = Date.now();
  let soltar = null;
  const base = baseNaMemoria([], { segurarAbertura: (fn) => { soltar = fn; } });
  const chave = DIAG_RETRATO_KEY + ':x';
  const ls = armazenamento({ [chave]: JSON.stringify({ id: 'x', salvoEm: agora - 1000, inicio: agora - 5000, diario: [{ t: agora - 2000, k: 'a' }] }) });
  const app = carregador({ ls, base });
  const pronto = app.carregar();
  for (let i = 0; i < 40 && !soltar; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(soltar, 'PRÉ-CONDIÇÃO: a abertura da base não foi pedida');
  app.apagar();              // o `dlogApagar` sobe a época (e apaga as chaves: ver o layout.test)
  soltar();
  await pronto;
  assert.equal(base.loja.size, 0, 'o retrato foi pra base DEPOIS de o modo dev desligar');
  // CONTROLE: sem desligar no meio, o mesmo retrato vai pra base.
  const base2 = baseNaMemoria([]);
  const ls2 = armazenamento({ [chave]: ls.getItem(chave) });
  await carregador({ ls: ls2, base: base2 }).carregar();
  assert.equal(base2.loja.size, 1, 'CONTROLE: o retrato não foi pra base nem sem desligar — a medida acima não distingue nada');
});

test('D2: apagar os retratos leva TODOS os da chave e nenhum outro; o da leitura, só se não mudou', () => {
  const montar = (ls) => new Function('localStorage', 'DIAG_RETRATO_KEY',
    fatiar('diagLerRetratos') + '\n' + fatiar('diagEsquecerRetratos') + '\nreturn { ler: diagLerRetratos, esquecer: diagEsquecerRetratos };')(ls, DIAG_RETRATO_KEY);
  const ls = armazenamento({ [DIAG_RETRATO_KEY + ':a']: '{"id":"a","salvoEm":1}', [DIAG_RETRATO_KEY + ':b']: 'x',
                             waze_places_diag_outra: 'fica', waze_places_stats: 'fica' });
  const f = montar(ls);
  const lidos = f.ler();
  assert.equal(lidos.length, 2);
  assert.equal(lidos.find((l) => l.k.endsWith(':b')).r, null, 'o retrato ilegível foi lido como válido');
  ls.m.set(DIAG_RETRATO_KEY + ':a', '{"id":"a","salvoEm":2}');     // reescrito DEPOIS da leitura
  f.esquecer(lidos);
  assert.deepEqual([...ls.m.keys()].sort(), ['waze_places_diag_outra', DIAG_RETRATO_KEY + ':a', 'waze_places_stats'],
    'apagou o retrato reescrito depois da leitura (ou deixou o lido)');
  f.esquecer();
  assert.deepEqual([...ls.m.keys()].sort(), ['waze_places_diag_outra', 'waze_places_stats'],
    'sem lista, sobrou retrato — ou saiu chave que não é retrato');
});

// ── R5-4-5 (auditoria de 2026-10-01): ONDE falta o que o teto cortou ─────────
// O teto do retrato corta os mais VELHOS. Juntado à base da mesma abertura, o
// começo vem dela, e a falta fica no MEIO — a junção mantinha o `cortados` do
// retrato e a triagem dizia "faltam 273 no começo", com 172 faltando no meio.
// A junção agora troca `cortados` por `lacunas` (onde e quantos).
const T5 = 1_790_000_000_000;
const ent5 = (i) => ({ t: T5 + i * 1000, k: 'acao', n: i, d: 'x'.repeat(100) });
const diario5 = (de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => ent5(de + i));
const retrato5 = (de, ate) => JSON.parse(compacto({ id: 'ab', inicio: T5, salvoEm: T5 + ate * 1000, salvoPor: 'saida',
  diario: diario5(de, ate), chamadas: [], erros: [] }, DIAG_RETRATO_TETO));
const base5 = (ate, extra = {}) => ({ id: 'ab', inicio: T5, salvoEm: T5 + ate * 1000 + 500, salvoPor: 'oculta',
  diario: diario5(0, ate), chamadas: [], erros: [], momentos: [{ t: 'cap', motivo: 'manual' }], ...extra });

test('R5-4-5: o retrato guarda a hora do PRIMEIRO cortado de cada lista', () => {
  const r = retrato5(0, 700);
  assert.ok(r.cortados.diario > 0, 'PRÉ-CONDIÇÃO: o teto não cortou');
  assert.equal(r.cortadosDesde.diario, T5, 'sem a hora do primeiro cortado, a junção não sabe quantos dos cortados a base já tinha');
});

test('R5-4-5: juntado à base, o que o teto cortou falta no MEIO — a junção diz onde e quantos', () => {
  const r = retrato5(0, 700);
  const C = r.cortados.diario;
  assert.ok(C > 101, `PRÉ-CONDIÇÃO: o teto cortou ${C}, e o caso precisa cortar além do que a base tem (101)`);
  const j = juntarRetrato(base5(100), r);
  const ns = j.diario.map((e) => e.n);
  assert.deepEqual(j.lacunas, { diario: { n: C - 101, de: T5 + 100 * 1000, ate: T5 + C * 1000 } },
    'a junção não marcou a falta no MEIO, entre o último da base e o primeiro do retrato');
  assert.ok(!('cortados' in j) && !('cortadosDesde' in j), 'o `cortados` do retrato ficou — e a triagem diria "no começo"');
  // CONTROLE: o diário juntado tem MESMO esse buraco, com esse tamanho.
  assert.equal(701 - ns.length, j.lacunas.diario.n, 'a conta da lacuna não bate com o que falta no diário juntado');
  assert.ok(ns.includes(100) && !ns.includes(101) && !ns.includes(C - 1) && ns.includes(C), 'o buraco não está onde a lacuna diz');
  assert.equal(j.momentos.length, 1, 'a captura da base sumiu na junção');
});

test('R5-4-5: a conta da lacuna — o anel girado, o retrato da versão anterior, a base que cobre tudo, e sem base', () => {
  // O anel girou antes do fechar: o retrato começa no 50, e só o que a base
  // tinha DESDE o primeiro cortado conta (51 de 101).
  const girado = retrato5(50, 750);
  const jg = juntarRetrato(base5(100), girado);
  assert.equal(jg.lacunas.diario.n, girado.cortados.diario - 51, 'contou a base inteira, e não só o trecho que o teto cortou');
  // O retrato da versão anterior (sem `cortadosDesde`): conta tudo o que a base tinha antes dele.
  const r = retrato5(0, 700);
  const { cortadosDesde, ...antigo } = r;
  assert.equal(juntarRetrato(base5(100), antigo).lacunas.diario.n, r.cortados.diario - 101);
  // A base tinha tudo o que o teto cortou: não falta nada.
  assert.equal(juntarRetrato(base5(400), r).lacunas, undefined, 'a base cobria o corte inteiro, e a junção acusou falta');
  // Sem base: falta no COMEÇO (`de` nulo), e os cortados inteiros.
  assert.deepEqual(juntarRetrato(null, r).lacunas, { diario: { n: r.cortados.diario, de: null, ate: T5 + r.cortados.diario * 1000 } });
  // A base mais NOVA que o retrato fica como está.
  const nova = base5(800);
  assert.equal(juntarRetrato(nova, r), nova);
  // A lacuna que a base já tinha segue, se está inteira antes do retrato; a que ele cobre, sai.
  const comLacuna = base5(100, { lacunas: { diario: { n: 5, de: T5 + 10000, ate: T5 + 20000 }, chamadas: { n: 2, de: null, ate: T5 + 900000 } } });
  const jl = juntarRetrato(comLacuna, { ...r, chamadas: [{ t: new Date(T5 + 600000).toISOString(), rota: 'perfil' }] });
  assert.deepEqual(jl.lacunas.chamadas, undefined, 'a lacuna da base que o retrato cobre ficou');
  assert.equal(jl.lacunas.diario.n, r.cortados.diario - 101, 'a lacuna nova não veio por cima');
});

// ── R6-4-4 e R6-4-5 (auditoria de 2026-10-01): DUAS ABAS e o que é do APARELHO ─
// A outra aba aberta grava as capturas dela na base na hora, e esta só as
// conhecia se fossem de antes de ela abrir. Duas consequências, medidas no
// navegador: desligar o modo dev AQUI (que apaga a base e, pelo aviso do
// navegador, a memória da outra) contava só os registros desta aba e desligava
// no 1º toque, calado (t3); e BAIXAR aqui apagava a base inteira, com as
// capturas da outra que não tinham ido no arquivo (t3b). Aqui as funções rodam
// DE VERDADE sobre uma base de mentira que, como o IndexedDB, devolve CÓPIAS.
function baseClonada(registros = []) {
  const loja = new Map(registros.map((r) => [r.id, structuredClone(r)]));
  const indexedDB = {
    open: () => {
      const req = {};
      setTimeout(() => {
        req.result = {
          objectStoreNames: { contains: () => true }, close() {},
          transaction: () => {
            const tx = {};
            tx.objectStore = () => ({
              getAll: () => { const r = {}; setTimeout(() => { r.result = [...loja.values()].map((x) => structuredClone(x)); r.onsuccess(); }, 0); return r; },
              put: (a) => { loja.set(a.id, structuredClone(a)); },
              delete: (id) => { loja.delete(id); },
            });
            setTimeout(() => tx.oncomplete && tx.oncomplete(), 1);
            return tx;
          },
        };
        req.onsuccess();
      }, 0);
      return req;
    },
    deleteDatabase: () => { const r = {}; setTimeout(() => { loja.clear(); r.onsuccess && r.onsuccess(); }, 0); return r; },
  };
  return { indexedDB, loja };
}
// O ouvinte do interruptor do modo dev, recortado do app.js (a arrow inteira).
function ouvinteDoInterruptor() {
  const ini = APP_SEM.indexOf("$('prefDevModeActive').addEventListener('change', async (e) =>");
  assert.ok(ini > 0, 'sumiu o ouvinte do interruptor do modo dev');
  const arrow = APP_SEM.indexOf('async (e) =>', ini);
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', arrow); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}' && --prof === 0) return APP_SEM.slice(arrow, j + 1);
  }
  throw new Error('o ouvinte não fechou');
}
const ID_ESTA = 'esta-aba';
const cap = (t, motivo = 'manual') => ({ t, motivo, dom: '<html></html>' });
const reg = (id, salvoEm, momentos, extra = {}) => ({ id, inicio: salvoEm - 60e3, salvoEm, salvoPor: 'captura', versao: 'x',
  diario: [], chamadas: [], erros: [], momentos, ...extra });
// UMA aba: o módulo do diagnóstico (as funções de verdade) sobre a base dada.
function abaDoDiag({ base, anteriores = [], minhas = [], ligadoLa = true }) {
  const { indexedDB, loja } = baseClonada(base);
  const toasts = [];
  let apagou = 0;
  const AppState = { devMode: { unlocked: true, active: true }, preferences: { undoEnabled: true } };
  const deps = {
    indexedDB, DIAG_DB: 'waze_places_diag', DIAG_STORE: 'aberturas', DIAG_DB_TETO_MS: 500, DIAG_GUARDA_MS: DIAG.DIAG_GUARDA_MS,
    DIAG_ABERTURA: { id: ID_ESTA, inicio: AGORA - HORA }, AppState, API: { chamadas: [] },
    dlogLigado: () => AppState.devMode.active, modoDevDesligadoNoArmazenamento: () => !ligadoLa,
    atualizarFabDev: () => {}, dfato: () => {},
    Date: { now: () => AGORA }, showToast: (m) => toasts.push(m), t: (k, v) => `${k}|${v.n}`,
    saveDevMode() {}, updateDevBadge() {}, diagAjustarRecursos() {}, enforceDevGatedFilters() {},
    canDisableUndo: () => true, savePreferences() {}, renderUndoGateUI() {},
    dlogApagar: () => { apagou++; },
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `
    let diagAberturasAnteriores = __anteriores, diagEpoca = 0, diagGuardando = Promise.resolve(), diagBaixadoEm = 0;
    let dlogMomentos = __minhas, dfatoAnel = [], dlogAnel = [], diagErros = [];
    let desligarDevConfirmadoAte = 0, desligarDevVez = 0;
    const dlogJaBaixados = new WeakSet();
    ${['diagDB', 'diagLerGuardado', 'diagAplicarPoda', 'diagMomentosAnteriores', 'diagCapturasAnterioresDoEditor',
       'dlogCapturasDoEditor', 'dlogNaoBaixados', 'dlogMarcarBaixados', 'diagChamadaSemCorpo', 'diagRegistroDaAbertura',
       'diagAtualizarAnteriores', 'diagEsquecerEntregue'].map(fatiar).join('\n')}
    const ouvinte = ${ouvinteDoInterruptor()};
    return { ouvinte, diagAtualizarAnteriores, diagEsquecerEntregue, dlogNaoBaixados, dlogMarcarBaixados,
      anteriores: () => diagAberturasAnteriores, baixouEm: (t) => { diagBaixadoEm = t; },
      minhas: () => dlogMomentos, baixado: (m) => dlogJaBaixados.has(m) };`
    .replace('__anteriores', 'arguments[arguments.length - 2]').replace('__minhas', 'arguments[arguments.length - 1]'));
  const fns = app(...chaves.map((k) => deps[k]), structuredClone(anteriores), minhas);
  return { ...fns, AppState, loja, toasts, apagou: () => apagou };
}
const tocar = async (aba, ligar = false) => { const e = { target: { checked: ligar } }; await aba.ouvinte(e); return e.target.checked; };

test('R6-4-4: desligar o modo dev conta os registros não baixados do APARELHO — os da OUTRA aba, que estão na base', async () => {
  // A outra aba registrou 2 telas DEPOIS de esta abrir: estão na base, não na memória daqui.
  const outra = reg('outra', AGORA - 5000, [cap('o1'), cap('o2'), cap('oa', 'auto:arraste')]);
  const aba = abaDoDiag({ base: [outra] });
  assert.equal(aba.dlogNaoBaixados(), 0, 'PRÉ-CONDIÇÃO: esta aba já sabia das capturas da outra');
  const marcado = await tocar(aba);
  assert.equal(marcado, true, 'o 1º toque desligou o modo dev — e apagaria, calado, as 2 telas da outra aba');
  assert.deepEqual(aba.toasts, ['toast.devPerdeCaptura|2'], 'o aviso não contou os registros do aparelho (só os da pessoa: o automático não entra)');
  assert.equal(aba.apagou(), 0);
  assert.equal(aba.AppState.devMode.active, true);
  // O número do botão desta aba diz o mesmo que o aviso — e elas vão no relatório daqui, como o aviso manda.
  assert.equal(aba.dlogNaoBaixados(), 2, 'o botão desta aba discorda do aviso');
  // O 2º toque (em até 15 s) desliga e apaga.
  await tocar(aba);
  assert.equal(aba.AppState.devMode.active, false, 'o 2º toque não desligou');
  assert.equal(aba.apagou(), 1);
  // CONTROLE: nada não baixado no aparelho — o 1º toque desliga, sem aviso.
  const vazia = abaDoDiag({ base: [reg('outra', AGORA - 5000, [cap('oa', 'auto:arraste')])] });
  assert.equal(await tocar(vazia), false);
  assert.equal(vazia.AppState.devMode.active, false, 'CONTROLE: sem registro da pessoa no aparelho o 1º toque não desligou');
  assert.deepEqual(vazia.toasts, []);
});

test('R6-4-4: um toque que chega DURANTE a leitura da base decide — a leitura antiga não desliga o que foi religado', async () => {
  const aba = abaDoDiag({ base: [] });
  const desligando = tocar(aba);             // lê a base (assíncrono)…
  const religou = await tocar(aba, true);    // …e a pessoa religa no meio
  await desligando;
  assert.equal(religou, true);
  assert.equal(aba.AppState.devMode.active, true, 'a leitura do 1º toque desligou o modo dev que a pessoa religou');
  assert.equal(aba.apagou(), 0, 'apagou o que o modo dev gravou com ele religado');
});

test('R6-4-4: a releitura traz a versão NOVA da outra aba e mantém marcado o que esta já baixou', async () => {
  const v1 = reg('outra', AGORA - 9000, [cap('o1')]);
  const aba = abaDoDiag({ base: [reg('outra', AGORA - 2000, [cap('o1'), cap('o2')])], anteriores: [v1] });
  aba.dlogMarcarBaixados();                   // esta aba baixou: a o1 foi no arquivo
  assert.equal(aba.dlogNaoBaixados(), 0, 'PRÉ-CONDIÇÃO');
  await aba.diagAtualizarAnteriores();
  const outra = aba.anteriores().find((a) => a.id === 'outra');
  assert.deepEqual(outra.momentos.map((m) => m.t), ['o1', 'o2'], 'a versão nova da outra aba não entrou');
  assert.equal(aba.dlogNaoBaixados(), 1, 'a o1, já baixada, voltou a contar como não baixada (ou a o2 não contou)');
  // CONTROLE: a versão IGUAL (mesmo `salvoEm`) não troca nada.
  const igual = abaDoDiag({ base: [v1], anteriores: [v1] });
  const antes = igual.anteriores()[0];
  await igual.diagAtualizarAnteriores();
  assert.equal(igual.anteriores()[0], antes, 'a mesma versão foi trocada');
  // E o que passou do prazo de 24 h (a poda ainda não rodou) não volta pra memória.
  const vencida = abaDoDiag({ base: [reg('velha', AGORA - 25 * HORA, [cap('v1')])] });
  await vencida.diagAtualizarAnteriores();
  assert.deepEqual(vencida.anteriores(), [], 'a abertura vencida (mais de 24 h) voltou pro relatório e pro aviso');
});

test('R6-4-5: baixar numa aba apaga do aparelho SÓ o que foi no arquivo — o que a outra aba gravou depois fica', async () => {
  const antiga = reg('antiga', AGORA - 3 * HORA, [cap('a1')]);              // uma abertura fechada
  const outra = reg('outra', AGORA - 5000, [cap('o1'), cap('o2')]);        // a outra aba, aberta
  const estaNaBase = reg(ID_ESTA, AGORA - 4000, [cap('m1')]);
  const aba = abaDoDiag({ base: [antiga, outra, estaNaBase], anteriores: [antiga], minhas: [cap('m1')] });
  // O relatório relê o aparelho: a outra aba entra nele (ver `diagCorpo`).
  await aba.diagAtualizarAnteriores();
  assert.deepEqual(aba.anteriores().map((a) => a.id).sort(), ['antiga', 'outra'],
    'o relatório desta aba não leva o que a OUTRA gravou depois de esta abrir');
  const noArquivo = aba.anteriores();
  const entregues = noArquivo.map((a) => ({ id: a.id, salvoEm: a.salvoEm }));
  // Enquanto o arquivo é montado, a outra aba registra mais uma tela (versão nova na base)…
  aba.loja.set('outra', structuredClone(reg('outra', AGORA - 100, [cap('o1'), cap('o2'), cap('o3')])));
  // …e esta registra uma depois do retrato.
  aba.minhas().push(cap('m2'));
  // O download: marca o que foi, carimba o retrato e apaga o entregue.
  aba.dlogMarcarBaixados([aba.minhas()[0], ...noArquivo.flatMap((a) => a.momentos)]);
  aba.baixouEm(AGORA - 3000);
  await aba.diagEsquecerEntregue(entregues);
  assert.equal(aba.loja.has('antiga'), false, 'a abertura que foi no arquivo ficou no aparelho');
  assert.ok(aba.loja.has('outra'), 'a outra aba gravou DEPOIS da leitura, e o download apagou o que não foi no arquivo');
  assert.deepEqual(aba.loja.get('outra').momentos.map((m) => m.t), ['o1', 'o2', 'o3']);
  // A desta aba volta só com o que NÃO foi entregue.
  assert.deepEqual(aba.loja.get(ID_ESTA).momentos.map((m) => m.t), ['m2'],
    'a abertura desta aba ficou com o que já foi entregue (ou perdeu o que veio depois do retrato)');
  // CONTROLE: a versão que FOI no arquivo, se ninguém a regravou, sai.
  const b = abaDoDiag({ base: [outra], anteriores: [] });
  await b.diagAtualizarAnteriores();
  await b.diagEsquecerEntregue(b.anteriores().map((a) => ({ id: a.id, salvoEm: a.salvoEm })));
  assert.equal(b.loja.has('outra'), false, 'CONTROLE: o que foi entregue, e não mudou, ficou no aparelho');
});

test('R6-4-5: o relatório relê o aparelho ANTES do retrato, e o download apaga pela lista DO RETRATO', () => {
  const corpo = fatiar('diagCorpo');
  const iInicio = corpo.indexOf('const anterioresDoAparelho = diagAtualizarAnteriores().catch(() => false);');
  const iEspera = corpo.indexOf('await anterioresDoAparelho;');
  const iRetrato = corpo.indexOf('const retratoEm = Date.now();');
  assert.ok(iInicio > 0 && iEspera > iInicio && iRetrato > iEspera,
    'o relatório não relê o aparelho antes do retrato — leva só o que esta aba viu ao abrir');
  assert.match(corpo, /^\s+const aberturasNoArquivo = diagAberturasAnteriores;$/m);
  assert.match(corpo, /aberturas: aberturasNoArquivo\.map\(\(a\) => \(\{ id: a\.id, salvoEm: a\.salvoEm \}\)\)/,
    'o download não sabe QUAIS versões foram no arquivo');
});
