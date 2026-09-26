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
  const iMarca = baixar.indexOf('dlogMarcarBaixados();');
  const iApaga = baixar.indexOf('diagEsquecerGuardado();');
  assert.ok(iMarca > 0 && iApaga > iMarca, 'baixar tem que apagar o guardado — já foi entregue');
  assert.match(baixar, /diagBaixadoEm = Date\.now\(\);/, 'sem o carimbo, o que já foi entregue volta a ser guardado');
  const apagar = fatiar('dlogApagar');
  assert.match(apagar, /diagAberturasAnteriores = \[\];/, 'desligar o dev deixou as guardadas na memória');
  assert.match(apagar, /diagEsquecerGuardado\(\);/, 'desligar o dev deixou as guardadas no aparelho');
  assert.match(fatiar('handleLogout'), /^\s+dlogApagar\(\);/m, 'o Sair deixou o diagnóstico (DOM com dado de terceiro) no aparelho');
});

test('o número do botão e o aviso do desligar contam as guardadas; baixar as marca', () => {
  const marca = fatiar('dlogMarcarBaixados');
  assert.match(marca, /for \(const m of diagMomentosAnteriores\(\)\) dlogJaBaixados\.add\(m\);/,
    'baixar não marca as guardadas — o aviso do desligar diria "não baixadas" do que já foi entregue');
});

test('o relatório leva as aberturas anteriores, e o resumo acusa o que elas capturaram', () => {
  const corpo = fatiar('diagCorpo');
  assert.match(corpo, /aberturasAnteriores: diagAberturasAnteriores,/, 'o relatório parou de levar as aberturas anteriores');
  assert.match(corpo, /aberturaAtual: \{ id: DIAG_ABERTURA\.id,/, 'sem a abertura atual, não se sabe de qual as outras vieram');
  assert.match(corpo, /\.concat\(diagAberturasAnteriores\.flatMap\(/,
    'os alertas das capturas anteriores saíram do resumo — é o defeito que atravessa fechar e reabrir');
  assert.match(corpo, /abertura: a\.id,/, 'o alerta de uma captura anterior tem que dizer de QUAL abertura veio');
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
    DIAG_ABERTURA: { id: 'esta' }, dlogLigado: () => true, dfato: () => {},
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
