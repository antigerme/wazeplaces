// Rodada 20 da auditoria (2026-10-14), a parte do OFFLINE, do DIAGNÓSTICO e do FAB — o lote 24.
// Os roteiros do auditor (r20-4: t4, t5, t6, t14, t17, t19, t22) reproduzidos no navegador antes do
// conserto; aqui, os mesmos cenários sobre o código de verdade, fatiado do app.js. Cada teste tem o
// CONTROLE que dá o resultado oposto e foi visto REPROVANDO com o conserto desfeito (sabotagens no
// relatório do lote 24).
//
//  · A1 — o leitor do diário conta as repetições que o limitador juntou (`juntas`), e a troca de
//    causa não as apaga;
//  · A2 — o registro da janela segue a convenção da fila: `undefined` é a leitura que FALHOU;
//  · A3 — a leitura da fila que falha no fim da varredura não dá a cobertura;
//  · A4 — a reabertura sem rede cuja leitura falhou deixa linha no diário;
//  · A5 — as duas leituras do relatório saem juntas, e a falha chega ao arquivo;
//  · B1 — o aparelho que não deixa GRAVAR no cache do mapa não termina "Pronto" com zero tiles;
//  · C1 — Enter segurado no botão do FAB não registra uma captura por repetição.
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

// A espera do armazenamento com TETO (R21-4-01), a de verdade, criada FORA do escopo dos harnesses (vários trocam o
// `setTimeout` por um que roda na hora, e o teto dela, lá dentro, estouraria sempre).
const esperarComTeto = new Function(fatiar('esperarComTeto') + '\nreturn esperarComTeto;')();


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
const constanteBruta = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function(`return (${m[1]});`)();
};
const tique = (ms = 1) => new Promise((ok) => setTimeout(ok, ms));
const chaveDoPedido = new Function(fatiar('chaveDoPedido') + '\nreturn chaveDoPedido;')();

// ═══ A1 · o limitador do diário e o leitor ═════════════════════════════════════════════════════
function dfatoDeMentira() {
  const anel = [];
  const dfato = new Function('dfatoAnel', 'DFATO_TETO', 'DFATO_LIMITE_SERIE', 'DFATO_LIMITE_MS', 'dfatoLimite', 'Date',
    fatiar('dfato') + '\nreturn dfato;');
  const relogio = { agora: Date.UTC(2026, 9, 14, 12, 0, 0) };
  const f = dfato(anel, 120, constanteBruta('DFATO_LIMITE_SERIE'), constanteBruta('DFATO_LIMITE_MS'), new Map(), { now: () => relogio.agora });
  return { f, anel, relogio, passo: (ms = 1000) => { relogio.agora += ms; } };
}
// O total que o LEITOR conta: cada linha vale ela e as que juntou.
const totalDoLeitor = (anel, k) => anel.filter((e) => e.k === k).reduce((n, e) => n + 1 + (e.juntas || 0), 0);

test('A1: a troca de causa NÃO apaga as repetições que o limitador deixou de fora — A×5, B, A soma 7 no leitor', () => {
  const x = dfatoDeMentira();
  for (let i = 0; i < 5; i++) { x.passo(); x.f('x.k', { c: 'A' + i }, { causa: 'A' }); }
  x.passo(); x.f('x.k', { c: 'B' }, { causa: 'B' });
  x.passo(); x.f('x.k', { c: 'A2' }, { causa: 'A' });
  assert.equal(totalDoLeitor(x.anel, 'x.k'), 7,
    `DEFEITO: o leitor conta ${totalDoLeitor(x.anel, 'x.k')} de 7 chamadas (as ${5 - 3} suprimidas de A sumiram na troca de causa): ${JSON.stringify(x.anel.map((e) => [e.c, e.juntas || 0]))}`);
  // A linha das suprimidas é a ÚLTIMA delas (dados e hora), e vem antes da causa nova.
  assert.deepEqual(x.anel.map((e) => e.c), ['A0', 'A1', 'A2', 'A4', 'B', 'A2'],
    'a linha das suprimidas não é a da ÚLTIMA repetição, antes da causa nova');
  const flush = x.anel.find((e) => e.c === 'A4');
  assert.equal(flush.juntas, 1, 'a linha das 2 suprimidas leva ela mesma + 1 em `juntas`');
  assert.ok(x.anel.indexOf(flush) < x.anel.findIndex((e) => e.c === 'B'), 'a linha das suprimidas veio depois da causa nova');
  assert.ok(flush.t < x.anel.find((e) => e.c === 'B').t, 'a hora da linha das suprimidas não é a da última repetição');
});

test('A1 (CONTROLES): sem troca de causa o total fecha como antes; sem suprimidas a troca não escreve linha extra; o anel segue de 120', () => {
  const a = dfatoDeMentira();
  for (let i = 0; i < 14; i++) { a.passo(60000); a.f('x.k', { i }, { causa: 'A' }); }
  // 14 passadas de 1 min: as 3 primeiras, e a 13ª (10 min depois da 3ª) com as 9 que juntou; a 14ª ainda pendente
  // (o total do leitor é 13 enquanto a série não fecha — a pendente sai quando a causa troca ou a janela vence).
  assert.equal(a.anel.length, 4);
  assert.equal(a.anel[3].juntas, 9);
  assert.equal(totalDoLeitor(a.anel, 'x.k'), 13);
  // Troca de causa SEM nada pendente: uma linha por chamada, nenhuma extra.
  const b = dfatoDeMentira();
  b.f('x.k', { c: 'A' }, { causa: 'A' }); b.passo(); b.f('x.k', { c: 'B' }, { causa: 'B' });
  assert.equal(b.anel.length, 2, 'a troca de causa sem suprimidas escreveu uma linha a mais');
  // O teto do anel vale também pra linha das suprimidas.
  const c = dfatoDeMentira();
  for (let i = 0; i < 130; i++) c.f('y', { i });
  for (let i = 0; i < 6; i++) { c.passo(); c.f('x.k', { i }, { causa: 'A' }); }
  c.passo(); c.f('x.k', { i: 'B' }, { causa: 'B' });
  assert.ok(c.anel.length <= 120, `o anel passou do teto (${c.anel.length})`);
});

function triagem(rel) {
  const base = { _versaoDoDiag: 11, _gerado: '2026-10-14T23:00:00.000Z', app: { versao: '2026101403', rotulo: '2026.10.14-03' },
    ambiente: { ua: 'x', online: true, fuso: 'America/Sao_Paulo', tela: { w: 390, h: 844, dpr: 3, janela: '390x844' } },
    resumo: { momentos: 0, chamadas: 0, falhas: 0, errosDeJs: 0, rede: true, offline: 'pronto',
      telaAgora: { tela: 'app', painel: 'card', cardMontado: true, modais: [], lightbox: false }, alertas: [] },
    diario: [], chamadas: [], momentos: [], erros: [], localStorage: {} };
  const dir = mkdtempSync(join(tmpdir(), 'diag-r20-'));
  const arq = join(dir, 'd.json');
  writeFileSync(arq, JSON.stringify({ ...base, ...rel }));
  return execFileSync(process.execPath, [new URL('../tools/diag-resumo.mjs', import.meta.url).pathname, arq], { encoding: 'utf8', timeout: 20000 });
}
const secaoOffline = (s) => { const i = s.indexOf('── OFFLINE'); return s.slice(i, s.indexOf('\n──', i + 5)); };
const OFFLINE_BASE = () => ({ ligado: true, janelaServida: 1492385, janelaAtual: 1492385, resultado: 'pronto', varrendo: false,
  filaGravadaEm: 1000, filaPreparada: null, filaVarrida: 1000, cobreAFila: false, precisaVarrer: false,
  filaGuardada: { n: 4, idadeMin: 3, carimboMin: 3, t: 1000, soNestaAba: 0, soNaGuardada: 0 }, janelaGuardada: null, filaCobertaGuardada: null,
  tilesNoCache: 3, tilesGuardadosQueFalharam: 0, pousosGravados: 0 });

test('A1: o leitor soma `1 + juntas` por linha — uma hora de falha não sai "3 vez(es)"', () => {
  const linhas = (juntasDaUltima) => [
    { t: 5, k: 'offline.gravacaoFalhou', cota: true }, { t: 6, k: 'offline.gravacaoFalhou', cota: true },
    { t: 7, k: 'offline.gravacaoFalhou', cota: true, ...(juntasDaUltima ? { juntas: juntasDaUltima } : {}) }];
  const com = secaoOffline(triagem({ offline: OFFLINE_BASE(), diario: linhas(40) }));
  assert.match(com, /a gravação da fila na base falhou 43 vez\(es\) no diário \(3 registrada\(s\), \+40 que o app juntou/,
    `DEFEITO: o leitor contou as linhas, não as repetições:\n${com}`);
  // CONTROLE: sem `juntas` a frase é a de sempre.
  const sem = secaoOffline(triagem({ offline: OFFLINE_BASE(), diario: linhas(0) }));
  assert.match(sem, /a gravação da fila na base falhou 3 vez\(es\) no diário \(a última/);
  assert.doesNotMatch(sem, /registrada\(s\)/);
  // `juntas` que não é número (arquivo estranho) não vira NaN.
  const ruim = secaoOffline(triagem({ offline: OFFLINE_BASE(), diario: [{ t: 5, k: 'offline.gravacaoFalhou', juntas: 'x' }] }));
  assert.match(ruim, /falhou 1 vez\(es\)/);
});

// ═══ O IndexedDB de mentira (o de r19, com a contagem de pedidos de abertura) ═════════════════════
function idbDeMentira(comportamento = 'ok') {
  const st = { comportamento, abertas: 0, abriu: 0, pedidos: 0, criada: false, dados: new Map() };
  const indexedDB = {
    open() {
      st.pedidos++;
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
              put(valor, chave) { st.dados.set(chave, valor); },
            });
            setTimeout(() => { if (!tx.abortado && tx.oncomplete) tx.oncomplete(); }, 15);
            return tx;
          },
        };
        st.abertas++; st.abriu++;
        req.result = db;
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    deleteDatabase() { return {}; },
  };
  return { st, indexedDB };
}

// ═══ A2 · o registro da janela: `null` = lido e sem registro, `undefined` = a leitura FALHOU ══════
// `tetoMs`: o teto da base (`OFFLINE_DB_TETO_MS`) — desde o R21-4-01 cobre o `open` E a leitura, UM prazo. Com 60 ms uma
// pausa do processo (CPU disputada) estourava a leitura que DEVIA dar certo (MEDIDO no r19, que tinha o mesmo desenho):
// os testes de sucesso ficam com o do app (5 s) e só quem espera o estouro (o `open` que não responde) pede um curto.
function leitoresDaBase(comportamento = 'ok', { tetoMs = 5000 } = {}) {
  const { st, indexedDB } = idbDeMentira(comportamento);
  const deps = { indexedDB, OFFLINE_DB: 'waze_places_offline', OFFLINE_STORE: 'fila', OFFLINE_DB_TETO_MS: tetoMs, esperarComTeto };
  const nomes = Object.keys(deps);
  const fn = new Function(...nomes, [fatiar('offlineDB'), fatiar('offlineLerChave'), fatiar('offlineLerFila'), fatiar('offlineLerRegistroDaJanela'), fatiar('offlineLerJanela'),
    'return { fila: offlineLerFila, registro: offlineLerRegistroDaJanela, janela: offlineLerJanela };'].join('\n'))(...nomes.map((k) => deps[k]));
  return { ...fn, st };
}

test('A2: `offlineLerRegistroDaJanela` — `null` na base lida sem registro (ou sem base), `undefined` na leitura que FALHOU', async () => {
  // Sem base: a leitura aborta a criação → "sem registro", e a base NÃO é criada.
  const sem = leitoresDaBase('ok');
  assert.equal(await sem.registro(), null, 'a base inexistente saiu como falha');
  assert.equal(sem.st.criada, false);
  // Base com o registro, base sem ele.
  const com = leitoresDaBase('ok');
  com.st.criada = true; com.st.dados.set('janela', { janela: 1492385, t: 5, filaCoberta: 4 });
  assert.equal((await com.registro()).janela, 1492385);
  const vazia = leitoresDaBase('ok');
  vazia.st.criada = true;
  assert.equal(await vazia.registro(), null, 'a base lida sem registro deixou de ser `null`');
  // As FALHAS: nenhuma pode ser confundida com "nunca preparou".
  for (const modo of ['open-lanca', 'mudo', 'get-erro']) {
    const f = leitoresDaBase('ok', { tetoMs: 250 });     // o `mudo` espera o teto estourar: curto, e o atraso só ajuda
    f.st.criada = true; f.st.dados.set('janela', { janela: 1492385, t: 5, filaCoberta: 4 });
    f.st.comportamento = modo;
    assert.equal(await f.registro(), undefined, `DEFEITO: a leitura do registro que falhou (${modo}) saiu como "sem registro" (null)`);
  }
});

test('INSTRUMENTO (R21-4-01): o harness dos leitores usa o teto do app — uma pausa de 80 ms do processo não faz falhar a leitura que DARIA CERTO', async () => {
  const parar = (ms) => { const t = performance.now(); while (performance.now() - t < ms); };
  const monta = (opcoes) => { const l = leitoresDaBase('ok', opcoes); l.st.criada = true; l.st.dados.set('janela', { janela: 1492385, t: 5, filaCoberta: 4 }); return l; };
  const a = monta();
  const lendo = a.registro();
  parar(80);
  const r = await lendo;
  assert.ok(r && r.janela === 1492385,
    `DEFEITO DO INSTRUMENTO: a leitura do harness estourou (${r === undefined ? 'undefined' : JSON.stringify(r)}) numa pausa de 80 ms — o teto dele é curto demais pra um teste de SUCESSO`);
  // CONTROLE: com o teto curto (o dos testes que esperam o estouro) a mesma pausa estoura a leitura.
  const curto = monta({ tetoMs: 60 });
  const lendoCurto = curto.registro();
  parar(80);
  assert.equal(await lendoCurto, undefined, 'CONTROLE: a pausa de 80 ms não estourou o teto de 60 ms — o instrumento não pega a pausa');
});

test('A2: os chamadores que só perguntam "tem registro?" tratam `undefined` como `null` — nada muda no comportamento', async () => {
  const f = leitoresDaBase('ok');
  f.st.criada = true; f.st.dados.set('janela', { janela: 7, t: 5, filaCoberta: 4 });
  f.st.comportamento = 'open-lanca';
  assert.equal(await f.janela(), null, '`offlineLerJanela` deixou de devolver `null` na leitura que falhou');
  // Os chamadores de `offlineLerRegistroDaJanela` no app: o relatório (distingue), `offlineLerJanela` e `offlineRecuperarJanela` (só testam se há registro).
  const chamadas = [...APP_SEM.matchAll(/^.*\bofflineLerRegistroDaJanela\(\).*$/gm)].map((m) => m[0].trim()).filter((l) => !/^async function/.test(l));
  assert.equal(chamadas.length, 3, `os chamadores de offlineLerRegistroDaJanela mudaram (${chamadas.length}) — confira o retorno novo em cada um:\n${chamadas.join('\n')}`);
  assert.match(fatiar('offlineLerJanela'), /return v \? v\.janela : null;/);
  assert.match(fatiar('offlineRecuperarJanela'), /if \(!r \|\| offlineJanelaServida !== null\) return;/);
  // `offlineRecuperarJanela` com `undefined`: não toca em nada.
  const rec = new Function('offlineLerRegistroDaJanela', 'let offlineJanelaServida = null, offlineFilaPreparada = null, offlineEpoca = 0, offlineLendoAJanela = null;\n' + fatiar('offlineRecuperarJanela')
    + '\nreturn async () => { await offlineRecuperarJanela(); return [offlineJanelaServida, offlineFilaPreparada]; };')(async () => undefined);
  assert.deepEqual(await rec(), [null, null]);
});

function diagOfflineDe({ lerFila, lerRegistro }) {
  const deps = { diagOfflineAgora: () => ({ ligado: true }), offlineLerFila: lerFila, filaReal: () => [], chaveDoPedido,
    offlineLerPousos: () => [], offlineLerRegistroDaJanela: lerRegistro, window: {}, OFFLINE_TILES_CACHE: 'c' };
  const nomes = Object.keys(deps);
  return new Function(...nomes, fatiar('diagOffline') + '\nreturn diagOffline;')(...nomes.map((k) => deps[k]));
}

test('A2: o `diagOffline` grava `{ erro }` quando o registro da janela não deu pra ler — `null` quando leu e não havia', async () => {
  const lida = { places: [{ venueID: 'v1' }], t: 1000, desde: 900, gravadoEm: 1000 };
  const falhou = await diagOfflineDe({ lerFila: async () => lida, lerRegistro: async () => undefined })();
  assert.ok(falhou.janelaGuardada && typeof falhou.janelaGuardada.erro === 'string' && falhou.janelaGuardada.erro,
    `DEFEITO: a leitura do registro que falhou vira \`${JSON.stringify(falhou.janelaGuardada)}\` no relatório`);
  assert.ok(falhou.filaCobertaGuardada && falhou.filaCobertaGuardada.erro, 'DEFEITO: a cobertura guardada sai como se nada tivesse sido lido');
  // CONTROLES: a base lida sem registro é `null` nos dois; com registro, os números.
  const nunca = await diagOfflineDe({ lerFila: async () => lida, lerRegistro: async () => null })();
  assert.deepEqual([nunca.janelaGuardada, nunca.filaCobertaGuardada], [null, null]);
  const preparou = await diagOfflineDe({ lerFila: async () => lida, lerRegistro: async () => ({ janela: 1492385, t: 5, filaCoberta: 1000 }) })();
  assert.deepEqual([preparou.janelaGuardada, preparou.filaCobertaGuardada], [1492385, 1000]);
  // E o resultado atravessa o JSON (o `undefined` some; o `{ erro }` não).
  assert.equal(JSON.parse(JSON.stringify(falhou)).janelaGuardada.erro.length > 0, true);
});

test('A2: a triagem diz "NÃO LIDA" / "NÃO LIDO" — e "nunca preparou" só quando o registro foi lido e não havia', () => {
  const erro = { erro: 'a leitura do registro da janela falhou' };
  const falhou = secaoOffline(triagem({ offline: { ...OFFLINE_BASE(), janelaGuardada: erro, filaCobertaGuardada: erro } }));
  assert.match(falhou, /gravada NÃO LIDA \(não deu pra ler o registro da janela\)/, `DEFEITO: a janela que não leu não é dita:\n${falhou}`);
  assert.match(falhou, /pelo registro do aparelho NÃO LIDO/);
  assert.doesNotMatch(falhou, /gravada null|gravada —|pelo registro do aparelho —/, 'a leitura que falhou saiu como "nunca preparou"');
  // CONTROLE: o registro lido e vazio segue dizendo `null` / "—".
  const nunca = secaoOffline(triagem({ offline: OFFLINE_BASE() }));
  assert.match(nunca, /gravada null/);
  assert.match(nunca, /pelo registro do aparelho —/);
  assert.doesNotMatch(nunca, /NÃO LID/);
});

// ═══ A5 · as duas leituras do relatório saem juntas ═══════════════════════════════════════════════
test('A5: com o IndexedDB PENDURADO as duas leituras do `diagOffline` começam juntas — e a falha chega ao arquivo como `{ erro }`', async () => {
  const { st, indexedDB } = idbDeMentira('mudo');
  const TETO = 80;
  const deps = { indexedDB, OFFLINE_DB: 'waze_places_offline', OFFLINE_STORE: 'fila', OFFLINE_DB_TETO_MS: TETO, esperarComTeto,
    diagOfflineAgora: () => ({ ligado: true }), filaReal: () => [], chaveDoPedido, offlineLerPousos: () => [], window: {}, OFFLINE_TILES_CACHE: 'c' };
  const nomes = Object.keys(deps);
  const diagOffline = new Function(...nomes, [fatiar('offlineDB'), fatiar('offlineLerChave'), fatiar('offlineLerFila'), fatiar('offlineLerRegistroDaJanela'), fatiar('diagOffline'),
    'return diagOffline;'].join('\n'))(...nomes.map((k) => deps[k]));
  const t0 = Date.now();
  const pronto = diagOffline();
  await tique(TETO / 4);
  // Em SÉRIE o segundo `open` só sairia depois do teto da primeira leitura.
  assert.equal(st.pedidos, 2,
    `DEFEITO: ${st.pedidos} pedido(s) de abertura da base aos ${TETO / 4} ms — a segunda leitura espera a primeira estourar (o teto de 5 s do app somaria 10 s, o orçamento inteiro do relatório)`);
  const o = await pronto;
  assert.ok(o.filaGuardada && o.filaGuardada.erro, `a falha da fila não chegou ao relatório: ${JSON.stringify(o.filaGuardada)}`);
  assert.ok(o.janelaGuardada && o.janelaGuardada.erro, `a falha do registro não chegou ao relatório: ${JSON.stringify(o.janelaGuardada)}`);
  // O limite de tempo é só a rede de segurança contra o relatório PENDURAR (o app tem 5 s por leitura, 10 s em série): a prova de
  // que as leituras começam juntas é a de cima (`pedidos === 2`, que não depende do relógio). Com `TETO * 3` uma pausa de 100 ms
  // do processo (CPU disputada) reprovava o teste (MEDIDO: "levou 320 ms" com teto de 80, em 1 de 25 rodadas).
  assert.ok(Date.now() - t0 < TETO * 12, `levou ${Date.now() - t0} ms (teto de uma leitura: ${TETO})`);
  // CONTROLE: a base que responde devolve os dois sem erro.
  const boa = idbDeMentira('ok');
  boa.st.criada = true;
  boa.st.dados.set('fila', { places: [{ venueID: 'v1', updateRequestID: 'u1' }], t: 9, desde: 8, gravadoEm: 9 });
  boa.st.dados.set('janela', { janela: 3, t: 4, filaCoberta: 9 });
  const dep2 = { ...deps, indexedDB: boa.indexedDB, OFFLINE_DB_TETO_MS: 5000 };   // o CONTROLE que dá certo não pode depender de o processo não parar
  const nomes2 = Object.keys(dep2);
  const d2 = new Function(...nomes2, [fatiar('offlineDB'), fatiar('offlineLerChave'), fatiar('offlineLerFila'), fatiar('offlineLerRegistroDaJanela'), fatiar('diagOffline'),
    'return diagOffline;'].join('\n'))(...nomes2.map((k) => dep2[k]));
  const ok = await d2();
  assert.equal(ok.filaGuardada.n, 1);
  assert.deepEqual([ok.janelaGuardada, ok.filaCobertaGuardada], [3, 9]);
});

test('A5: a frase ATENÇÃO da leitura que falhou NÃO manda procurar `offline.gravacaoFalhou` (não existe numa falha de leitura)', () => {
  const s = secaoOffline(triagem({ offline: { ...OFFLINE_BASE(), filaGuardada: { erro: 'a leitura da fila guardada falhou' } } }));
  assert.match(s, /a leitura da fila guardada FALHOU \(a leitura da fila guardada falhou\) — não deu pra ler a base/);
  assert.doesNotMatch(s, /offline\.gravacaoFalhou/, 'DEFEITO: a frase aponta um registro do diário que não existe numa falha de leitura');
  assert.match(s, /offline\.leituraFalhou/, 'a frase não aponta o registro certo do diário');
});

// ═══ A4 · a reabertura sem rede cuja leitura falhou ════════════════════════════════════════════════
function reabrir({ guardada }) {
  const log = [];
  const AppState = { authenticated: true, queue: [], hasMore: false, loadError: true, serverTotal: 0, fetchEpoch: 0 };
  const deps = {
    AppState, navigator: { onLine: false }, offlineLigado: () => true, offlineLerFila: async () => guardada, offlineLerRegistroDaJanela: async () => null,
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), dfato: (k, d, lim) => log.push([k, d, lim]),
    semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }), pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {},
    updatePendingCount: () => {}, sortQueue: () => {}, showCurrentPlace: () => log.push(['card']),
    contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, marcaDestaAba: () => 'm-tok', API: { getSession: () => 'tok' }, chaveDoPedido,
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let offlineJanelaServida = null, filaDeOnde = null, offlineFilaGravadaEm = null, offlineFilaPreparada = null,
      offlineFilaGravadaChaves = null, offlineEpoca = 0, offlineLendoAJanela = null;
    ${fatiar('mesmoLugar')}\n${fatiar('filaGuardadaDestaConta')}\n${fatiar('offlineRecuperarJanela')}\n${fatiar('offlineTentarAbrirSemRede')}
    return { abrir: offlineTentarAbrirSemRede };`)(...chaves.map((k) => deps[k]));
  return { app, log, AppState };
}

test('A4: a reabertura sem rede cuja leitura da base FALHOU (`undefined`) deixa `offline.leituraFalhou` no diário — e sai sem fila', async () => {
  const x = reabrir({ guardada: undefined });
  assert.equal(await x.app.abrir(), false);
  assert.deepEqual(x.log.map(([k]) => k), ['offline.leituraFalhou'], 'DEFEITO: a leitura que falhou não deixa linha no diário (é o relato "reabri e não carrega nada")');
  assert.equal(x.log[0][2].causa, 'leitura', 'a linha não passa pelo limitador (a falha permanente repete a cada busca)');
  assert.equal(x.AppState.queue.length, 0);
  // CONTROLE: a base lida SEM fila (`null`) não é falha — nenhuma linha, como sempre.
  const nula = reabrir({ guardada: null });
  assert.equal(await nula.app.abrir(), false);
  assert.deepEqual(nula.log, [], 'a base lida e vazia passou a deixar linha de falha');
  // CONTROLE: a fila lida abre (o instrumento enxerga o caminho feliz).
  const boa = reabrir({ guardada: { t: Date.now(), desde: Date.now(), conta: '111', regiao: 'row', pais: '30', busca: 'b', places: [{ venueID: 'v1', updateRequestID: 'u1' }] } });
  assert.equal(await boa.app.abrir(), true);
  assert.ok(boa.log.some(([k]) => k === 'offline.abriu') || boa.AppState.queue.length === 1);
});

// ═══ A3 / B1 · a varredura de verdade ═════════════════════════════════════════════════════════════
const JANELA = 1492385;
const CICLO = constanteBruta('OFFLINE_CICLO_MS');
const TILE = (i) => 'https://www.waze.com/row-tiles/live/base/' + i;
const itensDe = (n) => Array.from({ length: n }, (_, i) => TILE('t' + i));
const ok200 = { status: 200 };

// A varredura DE VERDADE sobre um `fetch` e um `caches` de mentira. `lerFila`: o que a releitura do fim devolve.
// `cache`: 'ok' | 'open-lanca' | 'put-rede-sonda-ok' | 'put-sonda-falha' | 'put-cota' | 'sonda-cota'.
function varredura({ itens, rede = () => ok200, lerFila = 'boa', cache = 'ok', gravacao = true }) {
  const relogio = { agora: JANELA * CICLO + 1000 };
  const log = { baixar: 0, sonda: 0, janelas: [], sondaDoCache: 0, apagouSonda: 0 };
  const noCache = new Map();
  const diario = [];
  const gravando = new Map();
  const erroDe = (nome, msg = nome) => Object.assign(new Error(msg), { name: nome });
  const ehSonda = (u) => /sonda\.invalid/.test(u);
  // A sonda lê a resposta BOA até o fim (R21-4-08): o corpo de mentira chega inteiro.
  const resposta = (r) => ({ ok: r.status >= 200 && r.status < 300, status: r.status, body: null, arrayBuffer: async () => new ArrayBuffer(0),
    headers: { get: (h) => (r.headers && r.headers[h.toLowerCase()]) ?? null } });
  const cacheDeMentira = {
    put: async (u) => {
      if (ehSonda(u)) {
        log.sondaDoCache++;
        if (cache === 'put-sonda-falha') throw erroDe('InvalidStateError');
        if (cache === 'sonda-cota') throw erroDe('QuotaExceededError');
        noCache.set(u, true); return;
      }
      if (cache === 'put-sonda-falha') throw erroDe('InvalidStateError');
      if (cache === 'put-rede-sonda-ok') throw new TypeError('network error');
      if (cache === 'put-cota') throw erroDe('QuotaExceededError');
      if (cache === 'sonda-cota') throw erroDe('TypeError', 'put');
      noCache.set(u, true);
    },
    delete: async (u) => { if (ehSonda(u)) log.apagouSonda++; return noCache.delete(u); },
    keys: async () => [...noCache.keys()].map((url) => ({ url })),
  };
  const deps = {
    AppState: { authenticated: true, queue: [{ venueID: 'v', updateRequestID: 'u' }] },
    Treino: { ativo: false }, navigator: { onLine: true },
    Date: { now: () => relogio.agora, parse: Date.parse }, offlineLigado: () => true,
    OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: CICLO, OFFLINE_CONCORRENCIA: 3, OFFLINE_ANUNCIAR_A_CADA: 50,
    OFFLINE_TENTATIVAS_POR_ITEM: constanteBruta('OFFLINE_TENTATIVAS_POR_ITEM'),
    OFFLINE_ITEM_TETO_MS: 30000, OFFLINE_SONDA_TETO_MS: constanteBruta('OFFLINE_SONDA_TETO_MS'),
    OFFLINE_TILES_CACHE: 'waze-places-tiles',
    OFFLINE_4XX_PASSAGEIRO: new Function('return ' + /^const OFFLINE_4XX_PASSAGEIRO = (new Set\(\[[^\]]*\]\));/m.exec(APP_SEM)[1])(),
    OFFLINE_LIMITE_PAUSA_MS: constanteBruta('OFFLINE_LIMITE_PAUSA_MS'),
    OFFLINE_LIMITE_PAUSA_MAX_MS: constanteBruta('OFFLINE_LIMITE_PAUSA_MAX_MS'),
    OFFLINE_COTA_PAUSA_MS: constanteBruta('OFFLINE_COTA_PAUSA_MS'),
    OFFLINE_SONDA_URL: constanteBruta('OFFLINE_SONDA_URL'), OFFLINE_ABORTO_GRACA_MS: 1000, esperarComTeto,
    offlineGravandoTile: gravando, offlineGeracaoDeTile: 0, Image: class {},
    caches: { open: async () => { if (cache === 'open-lanca') throw erroDe('SecurityError'); return cacheDeMentira; },
              has: async () => noCache.size > 0, delete: async () => true },
    Response,
    offlineItensDaFila: async () => itens.map((u) => ({ u, tile: true })),
    offlineGravarJanela: (j, cobertura) => { log.janelas.push([j, cobertura]); }, offlinePodarTiles: async () => 0, offlineAnunciarTiles: () => {},
    atualizarLinhaDoOffline: () => {}, dfato: (k, o, lim) => diario.push([k, o, lim]),
    chavesQueEsperamAConta: () => new Set(), contar: (k) => { log[k] = (log[k] || 0) + 1; },
    gravacao, lerFilaModo: lerFila,
    setTimeout: (fn, ms) => { if (ms === 400) { fn(); return 0; } return setTimeout(fn, ms); },
  };
  const fetchDe = (quem) => async (u) => {
    log[quem]++;
    const r = await rede(u, quem);
    if (r instanceof Error) throw r;
    return resposta(r);
  };
  const chaves = Object.keys(deps);
  const corpo = [
    'let offlineVarrendo = false, offlinePedidaDeNovo = false, offlineUltimoGesto = Date.now(), offlineJanelaServida = null,',
    '    offlineUltimoResultado = null, offlineSegurarAte = 0, offlineSemEspaco = false, offlineEpoca = 0, offlineFilaGravadaEm = null, offlineFilaPreparada = null,',
    '    offlineFilaVarrida = null, offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set(), guardados: new Set() };',
    'async function offlineGravarFila() { contar("gravou"); if (gravacao === true) offlineFilaGravadaEm = 5; return gravacao; }',
    'async function offlineLerFila() { contar("leu"); if (lerFilaModo === "falha") return undefined; if (lerFilaModo === "vazia") return null;',
    '  return { t: 5, places: [{ venueID: "v", updateRequestID: "u" }] }; }',
    ...['filaReal', 'chaveDoPedido', 'pedidoForaDaFilaGuardada', 'offlineDesfazerTile', 'offlineRecuoDoLimite', 'offlineErroDeCota', 'offlineCacheGrava'].map(fatiar),
    fatiar('offlineBaixar').replace(/\bfetch\(/g, 'fetchBaixar('),
    fatiar('offlineSondarRede').replace(/\bfetch\(/g, 'fetchSonda('),
    fatiar('offlineVarrer'),
    `return { varrer: offlineVarrer, estado: () => ({ resultado: offlineUltimoResultado, janela: offlineJanelaServida, segurarAte: offlineSegurarAte,
      semEspaco: offlineSemEspaco, preparada: offlineFilaPreparada, feitos: [...offlineFeitosNaJanela.us] }), gesto: () => { offlineUltimoGesto = Date.now(); } };`,
  ].join('\n');
  const app = new Function(...chaves, 'fetchBaixar', 'fetchSonda', corpo)(...chaves.map((k) => deps[k]), fetchDe('baixar'), fetchDe('sonda'));
  return { app, relogio, log, noCache, diario, gravando };
}
const ultimo = (x, k) => [...x.diario].reverse().find(([nome]) => nome === k)?.[1];
const nomes = (x) => x.diario.map(([k]) => k);

test('A3: a releitura da fila que FALHOU no fim da varredura NÃO dá a cobertura — termina PARCIAL, com a pausa curta e o rastro no diário', async () => {
  const x = varredura({ itens: itensDe(5), lerFila: 'falha' });
  await x.app.varrer();
  const e = x.app.estado();
  assert.equal(e.resultado, 'parcial', 'DEFEITO: a varredura fechou "pronto" sem ter lido a fila da base');
  assert.equal(e.preparada, null, 'DEFEITO: a cobertura foi dada (`offlineFilaPreparada`) sem a leitura');
  assert.equal(e.janela, null, 'a janela virou sem a conferência');
  assert.deepEqual(x.log.janelas, [], 'a janela foi gravada (a linha das Preferências diria "Pronto")');
  assert.equal(nomes(x).includes('offline.pronto'), false, 'o diário diz "pronto"');
  assert.equal(ultimo(x, 'offline.parcial')?.leitura, true, 'o diário não diz que a leitura da fila falhou');
  const curta = constanteBruta('OFFLINE_LIMITE_PAUSA_MS');
  assert.ok(e.segurarAte >= x.relogio.agora + curta - 1 && e.segurarAte < x.relogio.agora + constanteBruta('OFFLINE_COTA_PAUSA_MS'),
    'a pausa não é a curta (sem ela a leitura que falha seria refeita a cada gatilho)');
  assert.equal(e.semEspaco, false);
  // A retomada depois da pausa: com a base respondendo, fecha "pronto" com a cobertura.
  x.relogio.agora += curta + 1000;
  const y = varredura({ itens: itensDe(5), lerFila: 'boa' });
  await y.app.varrer();
  assert.equal(y.app.estado().resultado, 'pronto', 'CONTROLE: a leitura boa deixou de fechar "pronto"');
  assert.equal(y.app.estado().preparada, 5);
  assert.equal(y.log.janelas.length, 1);
});

test('A3 (CONTROLES): a base LIDA e sem fila (`null`) segue como era; e a gravação que não rodou não lê nada', async () => {
  // `null`: leu e não tinha a fila — o conferido "faltam pedidos" é de OUTRA ordem (semNaBase), não é falha de leitura.
  const x = varredura({ itens: itensDe(3), lerFila: 'vazia' });
  await x.app.varrer();
  assert.equal(x.app.estado().resultado, 'pronto', 'a base lida e vazia passou a ser tratada como falha de leitura');
  assert.equal(ultimo(x, 'offline.parcial'), undefined);
  // Gravação `false` ("nada a gravar"): sem cobertura a dar, nada é relido (e nada falha).
  const y = varredura({ itens: itensDe(3), lerFila: 'falha', gravacao: false });
  await y.app.varrer();
  assert.equal(y.log.leu || 0, 0, 'releu a fila sem cobertura a conferir');
  assert.equal(y.app.estado().resultado, 'pronto');
});

const comCache = (modo, n = 5) => varredura({ itens: itensDe(n), cache: modo });

test('B1: o `caches.open` que REJEITA (SecurityError) não é rede nem item — a varredura PARA parcial, com a pausa longa, sem a sonda, e NUNCA "pronto" com zero tiles', async () => {
  const x = comCache('open-lanca');
  await x.app.varrer();
  const e = x.app.estado();
  assert.equal(e.resultado, 'parcial', 'DEFEITO: o cache que não abre terminou "pronto" com ZERO tiles');
  assert.equal(nomes(x).includes('offline.pronto'), false);
  assert.equal(x.log.janelas.length, 0, 'a janela foi gravada (a linha das Preferências diria "Pronto — N pedidos no aparelho")');
  assert.equal(e.preparada, null);
  assert.equal(x.log.sonda, 0, 'DEFEITO: gastou a sonda de rede com uma falha que é do aparelho (e a sonda diz "a rede anda")');
  const p = ultimo(x, 'offline.parcial');
  assert.equal(p?.cache, true, 'o diário não diz que o cache não gravou');
  assert.equal(p?.e, 'SecurityError', 'o diário não diz o erro');
  assert.equal(p?.definitivos, 0, 'o tile virou definitivo');
  assert.ok(e.segurarAte >= x.relogio.agora + constanteBruta('OFFLINE_COTA_PAUSA_MS') - 1, 'sem a pausa longa');
  assert.deepEqual(e.feitos, [], 'o tile que não gravou ficou como "feito" na janela: a retomada não o pediria de novo');
  // Dentro da pausa nada é baixado.
  const antes = x.log.baixar;
  await x.app.varrer();
  assert.equal(x.log.baixar, antes, 'a varredura pediu tile durante a pausa');
});

test('B1: o `put` que lança com o cache INDISPONÍVEL (a gravação mínima também falha) vira `cache`; com a COTA, vira `cota` (como era)', async () => {
  const x = comCache('put-sonda-falha');
  await x.app.varrer();
  assert.equal(x.app.estado().resultado, 'parcial', 'DEFEITO: o `put` que lança terminou "pronto" com zero tiles');
  assert.equal(ultimo(x, 'offline.parcial')?.cache, true);
  assert.equal(ultimo(x, 'offline.parcial')?.cota, undefined, 'virou "sem espaço"');
  assert.equal(x.log.sonda, 0, 'gastou a sonda de rede');
  assert.equal(x.noCache.size, 0);
  assert.equal(x.gravando.size, 0, 'o tile que não gravou deixou a entrada em `offlineGravandoTile`');
  // A cota do `put` segue sendo cota (R17-4-02).
  const cota = comCache('put-cota');
  await cota.app.varrer();
  assert.equal(ultimo(cota, 'offline.parcial')?.cota, true, 'CONTROLE: a cota deixou de ser cota');
  assert.equal(ultimo(cota, 'offline.parcial')?.cache, undefined);
  assert.equal(cota.app.estado().semEspaco, true);
  // E a cota da gravação MÍNIMA (o cache cheio) também é cota, não "cache".
  const cheia = comCache('sonda-cota');
  await cheia.app.varrer();
  assert.equal(ultimo(cheia, 'offline.parcial')?.cota, true);
});

test('B1 (CONTROLE da rede): o `put` que rejeita por queda no meio do CORPO (a gravação mínima dá certo) NÃO é falha do cache — segue o caminho de sempre, com a sonda', async () => {
  const x = comCache('put-rede-sonda-ok');
  await x.app.varrer();
  const p = ultimo(x, 'offline.parcial') || ultimo(x, 'offline.pronto');
  assert.equal(p?.cache, undefined, 'DEFEITO: a queda de rede no meio do corpo virou "o aparelho não grava no cache" (pausa longa em plena estrada)');
  assert.ok(x.app.estado().segurarAte === 0 || x.app.estado().segurarAte < x.relogio.agora + constanteBruta('OFFLINE_COTA_PAUSA_MS') - 1,
    'a pausa longa foi aplicada a uma falha de rede');
  assert.ok(x.log.sonda > 0, 'a sonda de rede não foi consultada: o caminho antigo mudou');
  assert.ok(x.log.sondaDoCache > 0 && x.log.apagouSonda === x.log.sondaDoCache,
    'a gravação mínima não foi feita (ou deixou sobra no cache do mapa)');
  assert.equal([...x.noCache.keys()].some((u) => /sonda\.invalid/.test(u)), false, 'a chave da gravação mínima ficou no cache do mapa');
});

test('B1 (CONTROLE): o cache que grava e os 4xx seguem como eram — "pronto" com os tiles, "definitivo" no 404', async () => {
  const x = comCache('ok');
  await x.app.varrer();
  assert.equal(x.app.estado().resultado, 'pronto');
  assert.equal(x.noCache.size, 5);
  assert.equal(x.log.sondaDoCache, 0, 'a gravação mínima rodou sem falha nenhuma (custo em todo tile)');
  const n = varredura({ itens: itensDe(5), rede: (u) => (u.endsWith('t0') ? { status: 404 } : ok200) });
  await n.app.varrer();
  assert.equal(n.app.estado().resultado, 'pronto');
  assert.equal(ultimo(n, 'offline.pronto')?.definitivos, 1);
});

test('B1 (fonte): a falha de gravação tem valor PRÓPRIO em `offlineBaixar`, tratado na varredura como a cota (pausa longa, sem sonda); e o `dfato` leva a causa', () => {
  const baixar = fatiar('offlineBaixar');
  assert.match(baixar, /return 'cache'/);
  assert.match(baixar, /fase === 'open'/);
  assert.match(baixar, /offlineCacheGrava\(c\)/);
  const varrer = fatiar('offlineVarrer');
  assert.match(varrer, /ok === 'cache'\) \{[\s\S]*?cacheFalhou = true;[\s\S]*?OFFLINE_COTA_PAUSA_MS[\s\S]*?desistidosPorRede\.push\(it\);/);
  assert.match(varrer, /\.\.\.\(cacheFalhou \? \{ cache: true/);
  assert.match(varrer, /cacheFalhou \? '\|cache' : ''/);
  assert.match(varrer, /\.\.\.\(leituraFalhou \? \{ leitura: true \} : \{\}\)/);
});

test('B1/A3: a triagem diz o MOTIVO da pausa — nenhum dos dois novos sai "motivo não registrado no diário"', () => {
  const ate = Date.UTC(2026, 9, 14, 23, 30);
  const lerMotivo = (parcial) => secaoOffline(triagem({ offline: { ...OFFLINE_BASE(), resultado: 'parcial', segurarAteEm: ate }, diario: [{ t: 1, k: 'offline.parcial', ...parcial }] }));
  const cache = lerMotivo({ cache: true, e: 'SecurityError' });
  assert.match(cache, /em pausa até [^(]*\(o aparelho não deixou gravar no cache do mapa \(SecurityError\)\)/, `DEFEITO: ${cache}`);
  const leitura = lerMotivo({ leitura: true });
  assert.match(leitura, /\(a leitura da fila na base falhou\)/, `DEFEITO: ${leitura}`);
  for (const s of [cache, leitura]) assert.doesNotMatch(s, /motivo não registrado/);
  // CONTROLE: a causa que já existia segue.
  assert.match(lerMotivo({ semFila: true }), /\(a gravação da fila na base falhou\)/);
  assert.match(lerMotivo({}), /motivo não registrado no diário/);
});

// ═══ C1 · Enter segurado no botão do FAB ═══════════════════════════════════════════════════════════
function fabDeMentira() {
  const ouvintes = { btn: {}, janela: {} };
  const capturas = [];
  const fab = { style: {}, classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 100, top: 100, width: 44, height: 44 }) };
  const btn = { addEventListener: (t, f) => { ouvintes.btn[t] = f; }, animate: () => {} };
  const doc = { getElementById: (id) => (id === 'devFabBtn' ? btn : id === 'devFab' ? fab : null) };
  const deps = {
    document: doc, MODAL_IDS: [], MutationObserver: class { observe() {} }, requestAnimationFrame: (f) => { f(); return 1; }, cancelAnimationFrame: () => {},
    posicionarFabDev: () => {}, acompanharAReservaDoFab: () => {}, levantarOFabComAPilha: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    sessionStorage: { getItem: () => null, setItem: () => {} }, innerWidth: 400, innerHeight: 800,
    atualizarFabDev: () => {}, dlogCapturar: (m) => { capturas.push(m); return {}; },
    DEV_FAB_PEGAR_MS: 15, navigator: {}, setTimeout, clearTimeout, Math, Number,
  };
  const chaves = Object.keys(deps);
  new Function(...chaves, `let devFabFixado = false, devFabDedo = null;\n${fatiar('ligarFabDev')}\nreturn ligarFabDev;`)(...chaves.map((k) => deps[k]))();
  return { ouvintes, capturas };
}
// O que o navegador faz com Enter num <button>: um `keydown` por repetição, e o `click` (detail 0) em cada
// um que NÃO foi cancelado — o Espaço só clica ao SOLTAR.
function segurar(f, tecla, repeticoes) {
  let prevenidos = 0;
  for (let i = 0; i < repeticoes; i++) {
    const ev = { key: tecla, repeat: i > 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    if (f.ouvintes.btn.keydown) f.ouvintes.btn.keydown(ev);
    if (ev.defaultPrevented) prevenidos++;
    else if (tecla === 'Enter') f.ouvintes.btn.click({ detail: 0 });
  }
  if (tecla === ' ') f.ouvintes.btn.click({ detail: 0 });
  return prevenidos;
}

test('C1: Enter SEGURADO no botão do FAB registra UMA captura (a repetição do `keydown` é cancelada, e com ela o `click`)', () => {
  const f = fabDeMentira();
  const prevenidos = segurar(f, 'Enter', 15);
  assert.equal(prevenidos, 14, 'as 14 repetições não foram canceladas');
  assert.deepEqual(f.capturas, ['manual'], `DEFEITO: ${f.capturas.length} capturas de um Enter segurado (o anel enche de capturas idênticas e expulsa a automática)`);
  // CONTROLE: um Enter simples = 1; o Espaço segurado = 1 (clica ao soltar); o toque do dedo (detail ≥ 1) segue sem passar pelo teclado.
  const um = fabDeMentira(); segurar(um, 'Enter', 1);
  assert.deepEqual(um.capturas, ['manual']);
  const espaco = fabDeMentira(); segurar(espaco, ' ', 15);
  assert.deepEqual(espaco.capturas, ['manual']);
  const dedo = fabDeMentira(); dedo.ouvintes.btn.click({ detail: 1 });
  assert.deepEqual(dedo.capturas, [], 'o clique do dedo (detail 1) passou a capturar pelo teclado: o `pointerup` já tratou');
  // O `keydown` que NÃO é repetição (e outras teclas) não é cancelado: o Enter e o Tab precisam continuar funcionando.
  const tecla = fabDeMentira();
  const evs = [{ key: 'Enter', repeat: false }, { key: 'Tab', repeat: true }, { key: 'a', repeat: true }].map((e) => ({ ...e, preventDefault() { this.d = true; } }));
  for (const e of evs) tecla.ouvintes.btn.keydown(e);
  assert.deepEqual(evs.map((e) => !!e.d), [false, false, false], 'o `keydown` que não é Enter/Espaço repetido foi cancelado');
});

test('C1 (fonte): o `keydown` do botão do FAB mora no `ligarFabDev`, com `e.repeat` e Enter/Espaço, antes do `capturar`', () => {
  const corpo = fatiar('ligarFabDev');
  const linha = corpo.split('\n').find((l) => /btn\.addEventListener\('keydown'/.test(l));
  assert.ok(linha, 'o botão do FAB perdeu o ouvinte de `keydown`');
  assert.match(linha, /e\.repeat && \(e\.key === 'Enter' \|\| e\.key === ' '\)\) e\.preventDefault\(\)/);
});

test('o bundle GERADO tem os consertos do lote 24 (senão nada disso está no ar)', () => {
  for (const nome of ['offline.leituraFalhou', 'sonda.invalid/offline', 'a leitura do registro da janela falhou']) {
    assert.ok(MIN.includes(nome), `js/min/app.js não tem ${nome} — rode \`npm run js\``);
  }
  assert.ok(/addEventListener\("keydown",\w+=>\{\w+\.repeat&&\(\w+\.key==="Enter"\|\|\w+\.key===" "\)&&\w+\.preventDefault\(\)\}\)/.test(MIN),
    'js/min/app.js não tem o `keydown` repetido cancelado no botão do FAB');
});
