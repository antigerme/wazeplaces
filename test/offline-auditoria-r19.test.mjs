// Rodada 19 da auditoria (2026-10-14), a parte do OFFLINE e do DIAGNÓSTICO — o lote 23.
// Os roteiros do auditor (r19-4: e11, e5, e17, e15, e14, e12) medidos no navegador; aqui, os mesmos
// cenários sobre o código de verdade, fatiado do app.js, com um IndexedDB de mentira que CONTA as
// conexões abertas (o dos testes de antes tinha `close() {}` e deixava o vazamento passar).
// Cada teste tem o CONTROLE que dá o resultado oposto e foi visto REPROVANDO com o conserto desfeito.
//
//  · R19-4-01 — a transação que aborta (cota, `DataError`) deixava a conexão do IndexedDB aberta: o
//    `deleteDatabase` do "Sair" ficava bloqueado e a fila de pedidos de terceiros ficava no disco;
//  · R19-4-02 — a falha permanente de gravação tomava o anel de 120 do diário (sem limitador);
//  · R19-4-03 — a leitura da fila que FALHA não é a base VAZIA (o relatório mentia "NUNCA foi gravada").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const MIN = ler('js/min/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

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
const tique = (ms = 1) => new Promise((ok) => setTimeout(ok, ms));
const chaveDoPedido = new Function(fatiar('chaveDoPedido') + '\nreturn chaveDoPedido;')();

// ═══ O IndexedDB de mentira, que CONTA as conexões ═════════════════════════════════════════════
// Modela o que importa pro "Sair": `deleteDatabase` só apaga quando NENHUMA conexão está aberta —
// as abertas recebem o `versionchange` (`onversionchange`), e a que não o trata (ou não fecha) deixa
// o apagamento BLOQUEADO (`bloqueados`), como no navegador. `comportamento`:
//   'ok'          grava e lê normalmente;
//   'put-lanca'   o `put` da chave 'fila' LANÇA `QuotaExceededError` (alguns navegadores);
//   'aborto'      o `put` passa e a transação ABORTA depois, de forma assíncrona (a cota no WebKit/iOS);
//   'get-erro'    o `get` falha (`onerror` do pedido);
//   'open-lanca'  o `indexedDB.open` lança (IndexedDB indisponível);
//   'mudo'        o `open` nunca responde (o `timeout`).
function idbDeMentira(comportamento = 'ok') {
  const st = { comportamento, abertas: 0, abriu: 0, criada: false, dados: new Map(), bloqueados: 0, apagou: 0, conexoes: [] };
  const apagarSePuder = () => {
    for (const c of st.conexoes.filter((x) => !x.fechada)) { if (typeof c.onversionchange === 'function') c.onversionchange(); }
    if (st.conexoes.some((c) => !c.fechada)) { st.bloqueados++; return false; }
    st.criada = false; st.dados.clear(); st.apagou++; return true;
  };
  const indexedDB = {
    open() {
      if (st.comportamento === 'open-lanca') throw new Error('InvalidStateError');
      const req = {};
      if (st.comportamento === 'mudo') return req;
      setTimeout(() => {
        let abortou = false;
        if (!st.criada) {
          req.result = { objectStoreNames: { contains: () => false }, createObjectStore() { st.criada = true; } };
          req.transaction = { abort() { abortou = true; } };
          if (req.onupgradeneeded) req.onupgradeneeded();
          if (abortou) { req.error = { name: 'AbortError' }; if (req.onerror) req.onerror(); return; }
        }
        const db = {
          fechada: false, onversionchange: null,
          close() { if (!this.fechada) { this.fechada = true; st.abertas--; } },
          transaction() {
            const tx = { abortado: false, error: null };
            tx.abort = () => { tx.abortado = true; setTimeout(() => tx.onabort && tx.onabort()); };
            tx.objectStore = () => ({
              get(chave) {
                const r = {};
                setTimeout(() => {
                  if (st.comportamento === 'get-erro') { r.error = { name: 'UnknownError' }; if (r.onerror) r.onerror(); return; }
                  r.result = st.dados.get(chave);
                  if (r.onsuccess) r.onsuccess();
                });
                return r;
              },
              put(valor, chave) {
                if (st.comportamento === 'put-lanca' && chave === 'fila') { const e = new Error('cota'); e.name = 'QuotaExceededError'; throw e; }
                if (st.comportamento === 'aborto') {
                  setTimeout(() => { tx.abortado = true; tx.error = { name: 'QuotaExceededError' }; if (tx.onabort) tx.onabort(); }, 2);
                  return;
                }
                st.dados.set(chave, valor);
              },
            });
            setTimeout(() => { if (!tx.abortado && tx.oncomplete) tx.oncomplete(); }, 15);
            return tx;
          },
        };
        st.abertas++; st.abriu++; st.conexoes.push(db);
        req.result = db;
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    deleteDatabase() { setTimeout(apagarSePuder, 0); return {}; },
  };
  return { st, indexedDB, apagarAgora: apagarSePuder };
}

// As funções DE VERDADE do offline contra a base de mentira.
function aparelho(comportamento = 'ok', { tetoMs = 60, relogio = null } = {}) {
  const { st, indexedDB, apagarAgora } = idbDeMentira(comportamento);
  const anel = [];
  const AppState = { queue: [{ venueID: 'v1', updateRequestID: 'u1', name: 'Terceiro' }, { venueID: 'v2', updateRequestID: 'u2', name: 'Outro' }], filters: {}, preferences: {} };
  const deps = {
    indexedDB, AppState, Treino: { ativo: false, esquecerFilaGuardada() {} }, OFFLINE_DB: 'waze_places_offline', OFFLINE_STORE: 'fila',
    OFFLINE_DB_TETO_MS: tetoMs, OFFLINE_POUSOS_KEY: 'p', safeLS: { remove() {} }, window: {},
    offlineLigado: () => true, offlinePodarPousos: () => {}, offlineAnunciarTiles: () => {},
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), contaAgora: () => '111', marcaDestaAba: () => 'm-tok', chaveDoPedido,
    avisarOutrasAbasDaFilaGuardada: () => {}, chavesQueEsperamAConta: () => new Set(),
    Date: relogio ? { now: relogio } : Date,
    dfatoAnel: anel,
  };
  const nomes = Object.keys(deps);
  const corpo = [
    'let offlineEpoca = 0, offlineJanelaServida = null, offlineUltimoResultado = null, offlineSegurarAte = 0, offlineSemEspaco = false,',
    '    offlineFilaGravadaEm = null, offlineFilaGravadaChaves = null, offlineFilaPreparada = null, offlineFilaVarrida = null, filaDeOnde = null,',
    '    diagTilesGuardadosQueFalharam = [], offlineFeitosNaJanela = null;',
    'const DFATO_TETO = 120, DFATO_LIMITE_SERIE = 3, DFATO_LIMITE_MS = 10 * 60000; const dfatoLimite = new Map();',
    ...['dfato', 'filaReal', 'pedidoForaDaFilaGuardada', 'offlineErroDeCota', 'offlineDB', 'offlineGravarFila', 'offlineGravarJanela',
      'offlineLerRegistroDaJanela', 'offlineLerFila', 'offlineEsquecer'].map(fatiar),
    'return { gravarFila: offlineGravarFila, gravarJanela: offlineGravarJanela, lerFila: offlineLerFila, lerJanela: offlineLerRegistroDaJanela,',
    '         esquecer: offlineEsquecer, abrir: offlineDB, dfato };',
  ].join('\n');
  const fn = new Function(...nomes, corpo)(...nomes.map((k) => deps[k]));
  return { ...fn, st, anel, AppState, apagarAgora, tique };
}
const aposOSair = async (a) => { await a.esquecer(); await tique(25); };

// ═══ R19-4-01 · a conexão é fechada também quando a transação FALHA ════════════════════════════
for (const [modo, rotulo] of [['put-lanca', "o `put` que lança a cota (Chromium)"], ['aborto', 'o aborto assíncrono da cota (WebKit/iOS)']]) {
  test(`R19-4-01: a gravação da fila que falha por ${rotulo} NÃO deixa a conexão aberta — e o "Sair" apaga a base`, async () => {
    const a = aparelho(modo);
    // PRÉ-CONDIÇÃO: a falha acontece de verdade (e o resultado é o da cota / da falha).
    const r = await a.gravarFila();
    assert.ok(r === 'cota' || r === 'falhou', `a gravação não falhou (${r}) — o instrumento não exercita o caminho`);
    assert.equal(a.st.abriu, 1, 'a base não chegou a abrir');
    assert.equal(a.st.abertas, 0,
      `DEFEITO: a conexão ficou aberta depois da gravação que falhou (${a.st.abertas}) — o \`deleteDatabase\` do "Sair" espera o coletor de lixo`);
    await aposOSair(a);
    assert.equal(a.st.bloqueados, 0, 'DEFEITO: o apagamento da base ficou BLOQUEADO por uma conexão esquecida');
    assert.equal(a.st.apagou, 1, 'a base (com a fila de pedidos de terceiros) não foi apagada no "Sair"');
  });
}

test('R19-4-01 (CONTROLE): a gravação que dá certo fecha a conexão e o "Sair" apaga — o instrumento enxerga o caminho feliz', async () => {
  const a = aparelho('ok');
  assert.equal(await a.gravarFila(), true);
  assert.ok(a.st.dados.has('fila'), 'a fila não foi pra base de mentira');
  assert.equal(a.st.abertas, 0);
  await aposOSair(a);
  assert.deepEqual([a.st.bloqueados, a.st.apagou, a.st.dados.size], [0, 1, 0]);
});

test('R19-4-01: a gravação da JANELA que aborta também fecha a conexão', async () => {
  const a = aparelho('aborto');
  await a.gravarJanela(1492385, null);
  await tique(30);
  assert.equal(a.st.abriu, 1, 'a base não abriu — o instrumento não exercita o caminho');
  assert.equal(a.st.abertas, 0, 'DEFEITO: a conexão da gravação da janela ficou aberta depois do aborto');
  await aposOSair(a);
  assert.equal(a.st.bloqueados, 0);
  // CONTROLE: a janela que grava fecha igual.
  const ok = aparelho('ok');
  await ok.gravarJanela(1492385, null);
  assert.equal(ok.st.abertas, 0);
  assert.equal((await ok.lerJanela()).janela, 1492385, 'a janela não voltou da base de mentira');
});

test('R19-4-01: as LEITURAS (a fila e o registro da janela) fecham a conexão também quando a leitura falha', async () => {
  const a = aparelho('ok');
  assert.equal(await a.gravarFila(), true);
  await a.gravarJanela(1492385, null);
  a.st.comportamento = 'get-erro';
  assert.equal(await a.lerFila(), undefined);
  // R20, A2: o registro da janela segue a MESMA convenção da fila — a leitura que falhou é `undefined`.
  assert.equal(await a.lerJanela(), undefined);
  assert.equal(a.st.abertas, 0, 'DEFEITO: uma leitura que falhou deixou a conexão aberta');
  // CONTROLE: a leitura que dá certo devolve e fecha.
  a.st.comportamento = 'ok';
  assert.equal((await a.lerFila()).places.length, 2);
  assert.equal((await a.lerJanela()).janela, 1492385);
  assert.equal(a.st.abertas, 0);
});

test('R19-4-01: nenhuma conexão esquecida bloqueia o "Sair" — o `offlineDB` fecha a sua quando o apagamento chega (`onversionchange`)', async () => {
  const a = aparelho('ok');
  const esquecida = await a.abrir();         // quem abriu e nunca fechou
  assert.equal(a.st.abertas, 1, 'PRÉ-CONDIÇÃO: a conexão esquecida não abriu');
  assert.equal(typeof esquecida.onversionchange, 'function', 'DEFEITO: o `offlineDB` não trata o `versionchange` — a conexão esquecida segura o `deleteDatabase`');
  await aposOSair(a);
  assert.equal(a.st.bloqueados, 0, 'DEFEITO: o apagamento ficou bloqueado pela conexão esquecida');
  assert.equal(a.st.abertas, 0);
  assert.equal(a.st.apagou, 1);
  // E a base volta a abrir logo depois (a rodada 19 mediu `timeout` de 5 s aqui).
  const depois = await Promise.race([a.abrir(), tique(500).then(() => 'TIMEOUT')]);
  assert.notEqual(depois, 'TIMEOUT');
  depois.close();
});

test('R19-4-01 (fonte): as transações do offline fecham num `finally`, e o `offlineDB` registra o `onversionchange`', () => {
  for (const nome of ['offlineGravarFila', 'offlineGravarJanela', 'offlineLerFila', 'offlineLerRegistroDaJanela']) {
    const corpo = fatiar(nome);
    assert.match(corpo, /\bfinally\s*\{[^}]*\.close\(\)/, `${nome} não fecha a conexão num \`finally\``);
  }
  assert.match(fatiar('offlineDB'), /\.onversionchange\s*=/, 'o `offlineDB` não registra o `onversionchange`');
});

// ═══ R19-4-03 · a leitura que FALHA não é a base VAZIA ════════════════════════════════════════
test('R19-4-03: `offlineLerFila` — `null` é a base vazia (ou sem base), `undefined` é a leitura que FALHOU', async () => {
  // Base que NÃO existe: a leitura aborta a criação e o resultado é "vazia".
  const sem = aparelho('ok');
  assert.equal(await sem.lerFila(), null, 'a base inexistente saiu como falha');
  assert.equal(sem.st.criada, false, 'a leitura criou a base (R17-4-04)');
  // Base com fila vazia → null; com fila → o registro.
  const vazia = aparelho('ok');
  vazia.st.criada = true; vazia.st.dados.set('fila', { places: [] });
  assert.equal(await vazia.lerFila(), null);
  const cheia = aparelho('ok');
  assert.equal(await cheia.gravarFila(), true);
  assert.equal((await cheia.lerFila()).places.length, 2);
  // As FALHAS: nenhuma pode ser confundida com a vazia.
  for (const modo of ['open-lanca', 'mudo', 'get-erro']) {
    const f = aparelho('ok');
    assert.equal(await f.gravarFila(), true);
    f.st.comportamento = modo;
    assert.equal(await f.lerFila(), undefined, `DEFEITO: a leitura que falhou (${modo}) saiu como base vazia (null)`);
  }
});

test('R19-4-03: todo chamador de `offlineLerFila` trata `undefined` como "sem fila" — e só o relatório distingue', () => {
  const chamadas = [...APP_SEM.matchAll(/^.*\bofflineLerFila\(\).*$/gm)].map((m) => m[0].trim()).filter((l) => !/^async function/.test(l));
  assert.equal(chamadas.length, 3, `os chamadores de offlineLerFila mudaram (${chamadas.length}) — confira o retorno novo em cada um:\n${chamadas.join('\n')}`);
  // A poda do fim da varredura: `naBase` é usada só com `naBase &&` / `naBase.t`.
  const varrer = fatiar('offlineVarrer');
  // R20, A3: a leitura saiu pra ANTES do ramo, e o `undefined` (a que falhou) é decidido ali:
  // `leituraFalhou` tira a cobertura. Os outros usos de `naBase` seguem sendo "tem fila?".
  assert.match(varrer, /naBase = await offlineLerFila\(\);\s*leituraFalhou = naBase === undefined;/);
  for (const uso of varrer.match(/naBase[^;\n]*/g).slice(1)) {
    assert.ok(/^naBase\s*(&&|\.)/.test(uso) || /^naBase\.t/.test(uso) || /naBase\)/.test(uso) || /^naBase = /.test(uso) || /^naBase === undefined/.test(uso),
      `uso de naBase que não é "tem fila?": ${uso}`);
  }
  // A reabertura sem rede: `if (!guardada) { …; return false; }` logo depois da leitura — e, desde o
  // R20 (A4), a leitura que FALHOU (`undefined`) deixa linha no diário antes de sair.
  assert.match(fatiar('offlineTentarAbrirSemRede'), /const guardada = await offlineLerFila\(\);\s*\n\s*if \(!guardada\) \{[\s\S]*?return false;\s*\}/,
    'a reabertura sem rede não trata a leitura que falhou como sem fila');
  // O relatório é quem distingue.
  assert.match(fatiar('diagOffline'), /f === undefined\) throw/, 'o `diagOffline` não usa o ramo da leitura que falhou');
});

test('R19-4-03: o `diagOffline` diz `{ erro }` na leitura que falhou, `null` na base vazia e o resumo na que leu', async () => {
  const montar = (lida) => {
    const deps = { diagOfflineAgora: () => ({ ligado: true }), offlineLerFila: async () => lida, filaReal: () => [], chaveDoPedido,
      offlineLerPousos: () => [], offlineLerRegistroDaJanela: async () => null, window: {}, OFFLINE_TILES_CACHE: 'c' };
    const nomes = Object.keys(deps);
    return new Function(...nomes, fatiar('diagOffline') + '\nreturn diagOffline;')(...nomes.map((k) => deps[k]));
  };
  const falhou = await montar(undefined)();
  assert.ok(falhou.filaGuardada && typeof falhou.filaGuardada.erro === 'string' && falhou.filaGuardada.erro,
    `DEFEITO: a leitura que falhou não vira \`{ erro }\` no relatório: ${JSON.stringify(falhou.filaGuardada)}`);
  assert.equal((await montar(null)()).filaGuardada, null, 'a base vazia deixou de ser `null`');
  const leu = await montar({ places: [{ venueID: 'v1' }], t: 1000, desde: 900, gravadoEm: 1000 })();
  assert.equal(leu.filaGuardada.n, 1);
});

function triagem(rel) {
  const base = { _versaoDoDiag: 11, _gerado: '2026-10-14T23:00:00.000Z', app: { versao: '2026101402', rotulo: '2026.10.14-02' },
    ambiente: { ua: 'x', online: true, fuso: 'America/Sao_Paulo', tela: { w: 390, h: 844, dpr: 3, janela: '390x844' } },
    resumo: { momentos: 0, chamadas: 0, falhas: 0, errosDeJs: 0, rede: true, offline: 'pronto',
      telaAgora: { tela: 'app', painel: 'card', cardMontado: true, modais: [], lightbox: false }, alertas: [] },
    diario: [], chamadas: [], momentos: [], erros: [], localStorage: {} };
  const dir = mkdtempSync(join(tmpdir(), 'diag-r19-'));
  const arq = join(dir, 'd.json');
  writeFileSync(arq, JSON.stringify({ ...base, ...rel }));
  return execFileSync(process.execPath, [new URL('../tools/diag-resumo.mjs', import.meta.url).pathname, arq], { encoding: 'utf8', timeout: 20000 });
}
const secaoOffline = (s) => { const i = s.indexOf('── OFFLINE'); return s.slice(i, s.indexOf('\n──', i + 5)); };
const OFFLINE_BASE = () => ({ ligado: true, janelaServida: 1492385, janelaAtual: 1492385, resultado: 'pronto', varrendo: false,
  filaGravadaEm: 1000, filaPreparada: null, filaVarrida: 1000, cobreAFila: false, precisaVarrer: false,
  filaGuardada: { n: 4, idadeMin: 3, carimboMin: 3, t: 1000, soNestaAba: 0, soNaGuardada: 0 }, janelaGuardada: null, filaCobertaGuardada: null,
  tilesNoCache: 3, tilesGuardadosQueFalharam: 0, pousosGravados: 0 });

test('R19-4-03: a triagem diz "não deu pra ler" quando a leitura da base FALHOU — e "NUNCA foi gravada" só quando ela leu e estava vazia', () => {
  const falhou = secaoOffline(triagem({ offline: { ...OFFLINE_BASE(), filaGuardada: { erro: 'timeout' } },
    diario: [{ t: 5, k: 'offline.gravacaoFalhou', cota: true }] }));
  assert.match(falhou, /a leitura da fila guardada FALHOU \(timeout\) — não deu pra ler a base/, `DEFEITO: a leitura que falhou não é dita:\n${falhou}`);
  assert.doesNotMatch(falhou, /NUNCA foi gravada/, 'DEFEITO: a leitura que falhou saiu como "a fila NUNCA foi gravada (vazia)"');
  assert.doesNotMatch(falhou, /preparação de OUTRA fila/, 'a causa errada (outra fila) foi apontada');
  assert.doesNotMatch(falhou, /ausente nesta versão/, 'a leitura que falhou saiu como "ausente nesta versão"');
  assert.match(falhou, /carimbo da fila guardada não lida/);
  // CONTROLE: a base LIDA e vazia (`null`) segue dizendo "NUNCA foi gravada".
  const vazia = secaoOffline(triagem({ offline: { ...OFFLINE_BASE(), filaGuardada: null }, diario: [{ t: 5, k: 'offline.gravacaoFalhou' }] }));
  assert.match(vazia, /a fila NUNCA foi gravada na base/);
  assert.doesNotMatch(vazia, /FALHOU \(/);
  // CONTROLE: com fila lida, nenhuma das duas.
  const lida = secaoOffline(triagem({ offline: OFFLINE_BASE() }));
  assert.doesNotMatch(lida, /NUNCA foi gravada|leitura da fila guardada FALHOU/);
});

// ═══ R19-4-02 · o limitador do diário ═════════════════════════════════════════════════════════
test('R19-4-02: a falha permanente de gravação entra 3 vezes, de novo quando a causa muda e uma a cada 10 min — com `juntas`', async () => {
  let agora = Date.UTC(2026, 9, 14, 12, 0, 0);
  const a = aparelho('put-lanca', { relogio: () => agora });
  const gravacoes = () => a.anel.filter((e) => e.k === 'offline.gravacaoFalhou');
  // 14 passadas, uma por minuto: a 3ª (aos 2 min) fecha a série, a próxima só aos 12 min (a 13ª).
  for (let i = 0; i < 14; i++) { assert.equal(await a.gravarFila(), 'cota'); agora += 60000; }
  assert.equal(gravacoes().length, 4,
    `DEFEITO: ${gravacoes().length} linhas de \`offline.gravacaoFalhou\` em 14 passadas (esperado: as 3 primeiras e a do 10º minuto depois delas)`);
  assert.equal(gravacoes()[3].juntas, 9, 'a linha seguinte à série não diz quantas ficaram de fora');
  assert.equal(gravacoes()[0].juntas, undefined, 'a primeira linha não tem o que "juntar"');
  assert.equal(gravacoes()[0].cota, true);
  // Troca de causa: entra na hora, mesmo dentro da janela de 10 min (o IndexedDB passa a estar indisponível).
  a.st.comportamento = 'open-lanca';
  assert.equal(await a.gravarFila(), 'falhou');
  // R20, A1: a repetição da causa ANTERIOR que o limitador deixou de fora (a 14ª passada) sai numa linha
  // própria antes da causa nova, em vez de se perder; a linha da causa nova é a última.
  assert.equal(gravacoes().length, 6, 'DEFEITO: a troca de causa (cota → IndexedDB indisponível) não entrou no diário');
  assert.equal(gravacoes()[4].cota, true, 'a repetição suprimida da causa anterior não foi escrita na troca de causa');
  assert.equal(gravacoes()[5].cota, undefined);
  // CONTROLE: a primeira falha de uma série NOVA, de um aparelho NOVO, é anotada — o limitador não engole o que ainda não viu.
  const b = aparelho('aborto');
  await b.gravarFila();
  assert.equal(b.anel.filter((e) => e.k === 'offline.gravacaoFalhou').length, 1);
});

test('R19-4-02 (CONTROLE): o `dfato` sem limitador não mudou — duas chamadas, duas linhas', () => {
  const anel = [];
  const dfato = new Function('dfatoAnel', 'DFATO_TETO', 'DFATO_LIMITE_SERIE', 'DFATO_LIMITE_MS', 'dfatoLimite', fatiar('dfato') + '\nreturn dfato;')(anel, 120, 3, 600000, new Map());
  for (let i = 0; i < 10; i++) dfato('qualquer', { i });
  assert.equal(anel.length, 10, 'o limitador passou a valer pra quem não pediu');
  // E o limitador por chave: duas chaves não se engolem.
  const a2 = [];
  const d2 = new Function('dfatoAnel', 'DFATO_TETO', 'DFATO_LIMITE_SERIE', 'DFATO_LIMITE_MS', 'dfatoLimite', fatiar('dfato') + '\nreturn dfato;')(a2, 120, 3, 600000, new Map());
  for (let i = 0; i < 6; i++) { d2('x', {}, { causa: 'c' }); d2('y', {}, { causa: 'c' }); }
  assert.deepEqual([a2.filter((e) => e.k === 'x').length, a2.filter((e) => e.k === 'y').length], [3, 3]);
});

test('R19-4-02: o `offline.gravacaoFalhou` e o `offline.parcial` passam pelo limitador (terceiro argumento com a causa)', () => {
  assert.match(fatiar('offlineGravarFila'), /dfato\('offline\.gravacaoFalhou',[^;]*\{ causa:/, 'a falha de gravação não passa pelo limitador');
  const varrer = fatiar('offlineVarrer');
  const i = varrer.indexOf("dfato('offline.parcial'");
  assert.ok(i > 0, 'o `offline.parcial` sumiu da varredura');
  const resto = varrer.slice(i, varrer.indexOf(';', varrer.indexOf('{ causa:', i)) + 1);
  assert.match(resto, /\{ causa: \[/, 'o `offline.parcial` não passa pelo limitador');
  assert.match(fatiar('dfato'), /DFATO_LIMITE_SERIE/);
});

test('o bundle GERADO tem os consertos do lote 23 (senão nada disso está no ar)', () => {
  for (const nome of ['onversionchange', 'DFATO_LIMITE_SERIE', 'a leitura da fila guardada falhou']) {
    assert.ok(MIN.includes(nome), `js/min/app.js não tem ${nome} — rode \`npm run js\``);
  }
});

test('R19-4-03 (cosmético): o arquivo cuja leitura de REDE ficou pendurada sai "sem resposta no orçamento", não "a cópia do aparelho não foi lida"', () => {
  const u = 'http://127.0.0.1:1/js/min/app.js';
  const cvr = { 'http://127.0.0.1:1/': { igual: true, bytesAparelho: 5, bytesServidor: 5, http: 200 }, [u]: { erro: 'sem corpo local' } };
  const pendurada = triagem({ cacheVsRede: cvr, coleta: { ms: 10005, orcamentoMs: 10000, semResposta: [u] } });
  assert.match(pendurada, /sem conferir: sem resposta no orçamento do relatório em 1 arquivo/, `DEFEITO: a causa certa não é dita:\n${pendurada}`);
  assert.doesNotMatch(pendurada, /a cópia do aparelho não foi lida/);
  // CONTROLE: o mesmo erro SEM a leitura pendurada na coleta continua sendo a cópia local.
  const local = triagem({ cacheVsRede: cvr, coleta: { ms: 90, orcamentoMs: 10000, semResposta: [] } });
  assert.match(local, /sem conferir: a cópia do aparelho não foi lida em 1 arquivo/);
});
