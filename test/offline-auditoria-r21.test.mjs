// Rodada 21 da auditoria (2026-10-14), a parte do OFFLINE, do ARMAZENAMENTO e do DIAGNÓSTICO — o lote 25.
// Os roteiros do auditor (r21-4: x-start-open, x-start-get, x-a4-pendurado, x-varredura-pendurada, x-diag-getall,
// x-diagdb, x-escala-so3, x-fold-2x, x-fab-toast2, x-dfato, x-corpo-corta, x-resumo) foram reproduzidos no
// navegador ANTES do conserto; aqui, os mesmos cenários sobre o código de verdade, fatiado do app.js, com um
// IndexedDB de mentira que CONTA as conexões e sabe PENDURAR (a leitura que nunca chama de volta, a transação que
// nunca completa, o `open` que nunca responde) e um `caches` que sabe não responder. Cada teste tem o CONTROLE que
// dá o resultado oposto, e foi visto REPROVANDO com o conserto desfeito (as sabotagens estão no relatório do lote).
//
// Instrumento: toda espera por algo que o código SABOTADO deixaria pendurado corre contra uma sentinela do
// próprio teste (`comSentinela`): o `node --test` não tem teto por teste, e a regressão tem de aparecer como
// asserção com NOME, não como o processo que nunca termina (gotcha #19, a rede falsa de harness tem teto).
//
//  · R21-4-01 — o teto de 5 s do armazenamento cobria só o `open`: o `get`, a transação, o `getAll`, o
//    `caches.open` e o `put` que não chamavam de volta prendiam a abertura, o relatório, o interruptor do modo dev
//    e a varredura pra sempre;
//  · R21-4-02 — a abertura esperava duas leituras em série, cada uma com o teto de 5 s;
//  · R21-4-03 — o relatório não trazia a ESCALA do texto do sistema;
//  · R21-4-04 — a barra ✕ ↑ ✓ cortada ou fora da janela não tinha sentinela;
//  · R21-4-05 — as repetições que o limitador do `dfato` ainda não escreveu faltavam no relatório;
//  · R21-4-06 — o FAB de baixo era coberto por 2 avisos (ou um de duas linhas com o texto maior);
//  · R21-4-07 — a leitura da base do diagnóstico a recriava depois do "Sair" de outra aba;
//  · R21-4-08 — a sonda de rede lia só o cabeçalho e dizia "a rede anda" com o corpo cortado;
//  · R21-4-09 — a triagem do offline não citava a leitura que falhou e apontava "outra aba" sem ter lido a base.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const MIN = ler('js/min/app.js');
const DIAG_RESUMO = ler('tools/diag-resumo.mjs');
const DIAG_TELA = ler('tools/diag-tela.mjs');
const DIAG_REPLAY = ler('tools/diag-replay.mjs');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const semComentario = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Pula a ASSINATURA antes de casar chaves (parâmetro padrão com `{}`).
function fatiar(nome, fonte = APP_SEM, minimo = 40) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu da fonte`);
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
      assert.ok(corpo.length > minimo, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
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
const PENDURADO = Symbol('pendurado');
const comSentinela = (p, ms = 2000) => Promise.race([p, tique(ms).then(() => PENDURADO)]);
const chaveDoPedido = new Function(fatiar('chaveDoPedido') + '\nreturn chaveDoPedido;')();
// A espera do armazenamento com TETO, a de verdade, criada FORA do escopo dos harnesses (vários trocam o
// `setTimeout` por um que roda na hora, e o teto dela, lá dentro, estouraria sempre).
const esperarComTeto = new Function(fatiar('esperarComTeto') + '\nreturn esperarComTeto;')();

// ═══ O IndexedDB de mentira: CONTA as conexões, e sabe PENDURAR ════════════════════════════════
// `modo`:
//   'ok'          responde a tudo;
//   'open-mudo'   o `indexedDB.open` nunca responde;
//   'open-tarde'  o `open` responde DEPOIS do teto (`atrasoOpen`) — a conexão que chega fora de hora tem de fechar;
//   'get-mudo'    o `get` nunca chama de volta (a transação aberta, a resposta que não vem);
//   'getall-mudo' o `getAll` nunca chama de volta;
//   'tx-mudo'     a transação de escrita nunca completa nem aborta (o `oncomplete` que não vem);
//   'get-lento'   o `get` responde depois de `atrasoGet` ms (a base lenta, não pendurada).
// Um navegador pendurado também não chama o `onabort` do que foi abortado: `tx.abort()` aqui só ANOTA
// (`abortos`), e a escrita só vale se a transação COMPLETA sem ter sido abortada (`pend` aplicado no `oncomplete`).
function idbDeMentira(modo = 'ok', { existe = true } = {}) {
  const st = { modo, atrasoOpen: 150, atrasoGet: 80, abertas: 0, opens: 0, criada: existe, dados: new Map(), conexoes: [], txs: [], abortos: 0 };
  const indexedDB = {
    open() {
      st.opens++;
      const req = {};
      if (st.modo === 'open-mudo') return req;
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
          transaction(loja, modoTx) {
            const tx = { abortado: false, error: null, modo: modoTx, pend: [] };
            st.txs.push(tx);
            tx.abort = () => { tx.abortado = true; st.abortos++; };
            tx.objectStore = () => ({
              get(chave) {
                const r = {};
                if (st.modo === 'get-mudo') return r;
                setTimeout(() => { r.result = st.dados.get(chave); if (r.onsuccess) r.onsuccess(); }, st.modo === 'get-lento' ? st.atrasoGet : 0);
                return r;
              },
              getAll() {
                const r = {};
                if (st.modo === 'getall-mudo' || st.getAllMudo) return r;
                setTimeout(() => { r.result = [...st.dados.values()]; if (r.onsuccess) r.onsuccess(); });
                return r;
              },
              put(valor, chave) { tx.pend.push(['put', chave === undefined ? valor.id : chave, valor]); },
              delete(chave) { tx.pend.push(['delete', chave]); },
            });
            if (st.modo !== 'tx-mudo') {
              setTimeout(() => {
                if (tx.abortado) return;
                for (const [op, k, v] of tx.pend) { if (op === 'put') st.dados.set(k, v); else st.dados.delete(k); }
                if (tx.oncomplete) tx.oncomplete();
              }, 5);
            }
            return tx;
          },
        };
        st.abertas++; st.conexoes.push(db);
        req.result = db;
        if (req.onsuccess) req.onsuccess();
      }, st.modo === 'open-tarde' ? st.atrasoOpen : 0);
      return req;
    },
    deleteDatabase() { setTimeout(() => { st.criada = false; st.dados.clear(); }); return {}; },
  };
  return { st, indexedDB };
}

// As funções DE VERDADE do offline contra a base de mentira, com os tetos pequenos (a espera é a do relógio).
function aparelho(modo = 'ok', { tetoDb = 60, tetoItem = 80, existe = true, caches = null } = {}) {
  const { st, indexedDB } = idbDeMentira(modo, { existe });
  const anel = [];
  const log = { anunciou: 0 };
  const AppState = { queue: [{ venueID: 'v1', updateRequestID: 'u1', name: 'Terceiro' }, { venueID: 'v2', updateRequestID: 'u2', name: 'Outro' }], filters: {}, preferences: {} };
  const deps = {
    indexedDB, AppState, Treino: { ativo: false, esquecerFilaGuardada() {} }, OFFLINE_DB: 'waze_places_offline', OFFLINE_STORE: 'fila',
    OFFLINE_DB_TETO_MS: tetoDb, OFFLINE_ITEM_TETO_MS: tetoItem, OFFLINE_POUSOS_KEY: 'p', safeLS: { remove() {} },
    window: caches ? { caches } : {}, caches, OFFLINE_TILES_CACHE: 'waze-places-tiles', esperarComTeto,
    offlineLigado: () => true, offlinePodarPousos: () => {}, offlineAnunciarTiles: () => { log.anunciou++; },
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), contaAgora: () => '111', marcaDestaAba: () => 'm-tok', chaveDoPedido,
    avisarOutrasAbasDaFilaGuardada: () => {}, chavesQueEsperamAConta: () => new Set(), dfatoAnel: anel,
  };
  const nomes = Object.keys(deps);
  const corpo = [
    'let offlineEpoca = 0, offlineJanelaServida = null, offlineLendoAJanela = null, offlineUltimoResultado = null, offlineSegurarAte = 0, offlineSemEspaco = false,',
    '    offlineFilaGravadaEm = null, offlineFilaGravadaChaves = null, offlineFilaPreparada = null, offlineFilaVarrida = null, filaDeOnde = null,',
    '    diagTilesGuardadosQueFalharam = [], offlineFeitosNaJanela = null;',
    'const DFATO_TETO = 120, DFATO_LIMITE_SERIE = 3, DFATO_LIMITE_MS = 10 * 60000; const dfatoLimite = new Map();',
    ...['dfato', 'filaReal', 'pedidoForaDaFilaGuardada', 'offlineErroDeCota', 'offlineDB', 'offlineGravarFila', 'offlineGravarJanela',
      'offlineLerChave', 'offlineLerRegistroDaJanela', 'offlineLerFila', 'offlineRecuperarJanela', 'offlineEsquecer'].map((n) => fatiar(n)),
    'return { gravarFila: offlineGravarFila, gravarJanela: offlineGravarJanela, lerFila: offlineLerFila, lerJanela: offlineLerRegistroDaJanela,',
    '         lerChave: offlineLerChave, recuperar: offlineRecuperarJanela, esquecer: offlineEsquecer, abrir: offlineDB,',
    '         janela: () => offlineJanelaServida, lendo: () => offlineLendoAJanela, epoca: () => offlineEpoca };',
  ].join('\n');
  const fn = new Function(...nomes, corpo)(...nomes.map((k) => deps[k]));
  return { ...fn, st, anel, log, AppState };
}

// ═══ R21-4-01 · a leitura que NUNCA chama de volta tem teto, depois do `open` também ═══════════
test('R21-4-01: a leitura da fila cujo `get` NUNCA responde é abandonada no teto — `undefined` (a leitura FALHOU), a transação é abortada e a conexão FECHA', async () => {
  const a = aparelho('ok');
  assert.equal(await a.gravarFila(), true, 'PRÉ-CONDIÇÃO: a fila não foi pra base de mentira');
  a.st.modo = 'get-mudo';
  const r = await comSentinela(a.lerFila());
  assert.notEqual(r, PENDURADO, 'DEFEITO: a leitura da fila ficou pendurada pra sempre — o teto de 5 s cobria só o `open`');
  assert.equal(r, undefined, 'a leitura que estourou o teto saiu como base VAZIA (`null`), não como falha (`undefined`)');
  assert.equal(a.st.abertas, 0, 'DEFEITO: a conexão da leitura pendurada ficou aberta (segura o `deleteDatabase` do "Sair")');
  assert.ok(a.st.abortos >= 1, 'a transação pendurada não foi abortada');
  // CONTROLE: a mesma leitura, com a base respondendo, devolve a fila e fecha.
  a.st.modo = 'ok';
  assert.equal((await comSentinela(a.lerFila())).places.length, 2, 'CONTROLE: a leitura boa deixou de devolver a fila');
  assert.equal(a.st.abertas, 0);
});

test('R21-4-01: o registro da janela cujo `get` NUNCA responde também falha no teto (`undefined`) e fecha a conexão', async () => {
  const a = aparelho('ok');
  await a.gravarJanela(1492385, 5);
  assert.equal((await a.lerJanela()).janela, 1492385, 'PRÉ-CONDIÇÃO: a janela não foi pra base de mentira');
  a.st.modo = 'get-mudo';
  const r = await comSentinela(a.lerJanela());
  assert.notEqual(r, PENDURADO, 'DEFEITO: a leitura do registro da janela ficou pendurada — a abertura do app esperava por ela');
  assert.equal(r, undefined);
  assert.equal(a.st.abertas, 0, 'DEFEITO: a conexão ficou aberta');
  // O que só pergunta "tem registro?" trata a falha como sem registro (como sempre): `offlineRecuperarJanela` não lança.
  const b = aparelho('get-mudo');
  const rec = await comSentinela(b.recuperar());
  assert.notEqual(rec, PENDURADO, 'DEFEITO: a recuperação da janela ficou pendurada');
  assert.equal(b.janela(), null, 'a janela foi dada sem ter sido lida');
});

test('R21-4-01: o `open` que responde DEPOIS do teto não deixa a conexão aberta — e a leitura já falhou no teto', async () => {
  const a = aparelho('open-tarde', { tetoDb: 50 });
  a.st.atrasoOpen = 160;
  const r = await comSentinela(a.lerFila());
  assert.equal(r, undefined, 'a leitura cujo `open` estourou o teto não falhou');
  assert.equal(a.st.opens, 1);
  await tique(260);
  assert.equal(a.st.abertas, 0, 'DEFEITO: a conexão que chegou depois do teto ficou aberta (ninguém mais a espera)');
  assert.equal(a.st.conexoes.length, 1, 'PRÉ-CONDIÇÃO: a conexão tardia nem chegou a abrir — o teste não exercita o caminho');
  assert.equal(a.st.conexoes[0].fechada, true);
});

test('R21-4-01: a gravação da fila cuja transação NUNCA completa estoura o teto (`falhou`), é ABORTADA e fecha a conexão — a varredura não fica "varrendo" pra sempre', async () => {
  const a = aparelho('tx-mudo', { tetoItem: 70 });
  const r = await comSentinela(a.gravarFila());
  assert.notEqual(r, PENDURADO, 'DEFEITO: a gravação ficou pendurada — `offlineVarrendo` verdadeiro pra sempre e todo gatilho virava `offlinePedidaDeNovo`');
  assert.equal(r, 'falhou', 'a gravação que estourou o teto não saiu como falha de gravação (`falhou`)');
  assert.ok(a.st.abortos >= 1, 'DEFEITO: a gravação estourada não foi ABORTADA — ela poderia terminar depois, com a memória dizendo "falhou" e a base com a fila');
  assert.equal(a.st.abertas, 0, 'DEFEITO: a conexão da gravação pendurada ficou aberta');
  assert.equal(a.st.dados.has('fila'), false, 'a fila foi pra base apesar do aborto');
  const falha = a.anel.find((e) => e.k === 'offline.gravacaoFalhou');
  assert.ok(falha && falha.e === 'TimeoutError', `o diário não diz que foi o teto: ${JSON.stringify(falha)}`);
  // A conclusão TARDIA da transação (um navegador que acorda) não muda nada: já falhou.
  const tx = a.st.txs.at(-1);
  if (tx.oncomplete) tx.oncomplete();
  await tique(10);
  assert.equal(a.st.dados.has('fila'), false);
  // CONTROLE: com a base respondendo a gravação dá certo e a fila está lá.
  const boa = aparelho('ok');
  assert.equal(await boa.gravarFila(), true);
  assert.ok(boa.st.dados.has('fila'));
});

test('R21-4-01: a gravação da janela cuja transação NUNCA completa também estoura o teto, aborta e fecha', async () => {
  const a = aparelho('tx-mudo', { tetoItem: 70 });
  const r = await comSentinela(a.gravarJanela(1492385, null));
  assert.notEqual(r, PENDURADO, 'DEFEITO: a gravação da janela ficou pendurada');
  assert.ok(a.st.abortos >= 1, 'a transação da janela não foi abortada');
  assert.equal(a.st.abertas, 0, 'DEFEITO: a conexão da gravação da janela ficou aberta');
  assert.equal(a.st.dados.has('janela'), false);
  // CONTROLE
  const boa = aparelho('ok');
  await boa.gravarJanela(1492385, null);
  assert.equal((await boa.lerJanela()).janela, 1492385);
});

test('R21-4-01: o "Sair" não fica esperando o `caches.delete` que não responde — o aviso ao worker sai assim mesmo', async () => {
  const cacheMudo = { delete: () => new Promise(() => {}) };
  const a = aparelho('ok', { tetoItem: 60, caches: cacheMudo });
  const r = await comSentinela(a.esquecer(), 1500);
  assert.notEqual(r, PENDURADO, 'DEFEITO: o `offlineEsquecer` ficou pendurado no `caches.delete` — o worker nunca era avisado da lista nova');
  assert.equal(a.log.anunciou, 1, 'o worker não foi avisado depois do apagamento');
  assert.equal(a.epoca(), 1, 'a época não subiu');
  // CONTROLE: o `delete` que responde também avisa (a mesma ordem).
  const b = aparelho('ok', { caches: { delete: async () => true } });
  await b.esquecer();
  assert.equal(b.log.anunciou, 1);
});

// ── a espera do armazenamento: UMA, e a estrutura que impede o próximo abridor de nascer sem teto ──
test('R21-4-01: `esperarComTeto` — resolve o que chega a tempo, REJEITA com TimeoutError o que não chega, ABORTA quem o executor devolveu e não segura o relógio', async () => {
  assert.equal(await esperarComTeto(Promise.resolve(7), 500), 7);
  await assert.rejects(esperarComTeto(new Promise(() => {}), 40), (e) => e.name === 'TimeoutError');
  // O executor devolve quem desfaz o que ficou no ar: chamado UMA vez, no estouro.
  let abortou = 0;
  await assert.rejects(esperarComTeto(() => () => { abortou++; }, 40), (e) => e.name === 'TimeoutError');
  assert.equal(abortou, 1, 'DEFEITO: a operação estourada não foi abortada');
  // Resolvida a tempo, o aborto NÃO roda (a gravação que deu certo não é desfeita).
  abortou = 0;
  assert.equal(await esperarComTeto((ok) => { setTimeout(() => ok('feito'), 5); return () => { abortou++; }; }, 500), 'feito');
  await tique(30);
  assert.equal(abortou, 0, 'a operação que terminou a tempo foi abortada');
  // O erro da própria operação passa como está (não vira timeout).
  const erro = new Error('quebrou');
  await assert.rejects(esperarComTeto(Promise.reject(erro), 500), (e) => e === erro);
  await assert.rejects(esperarComTeto((ok, no) => { throw erro; }, 500), (e) => e === erro);
  // O que chega DEPOIS do teto não faz nada (não ressuscita a promessa).
  let tarde;
  const p = esperarComTeto((ok) => { tarde = ok; }, 30);
  await assert.rejects(p, (e) => e.name === 'TimeoutError');
  tarde('tarde');
});

test('R21-4-01 (fonte): nenhum abridor de base fica sem teto na operação seguinte — toda função que abre `diagDB`/`offlineDB` espera pelo `esperarComTeto` (ou por quem o usa)', () => {
  const nomes = [...APP_SEM.matchAll(/^(?:async )?function ([A-Za-z0-9_$]+)\(/gm)].map((m) => m[1]);
  const ABRIDORES = /await (?:diagDB|offlineDB)\(/;
  // Quem espera o armazenamento por conta própria ou delega a quem tem teto.
  const COM_TETO = /\besperarComTeto\(|\bdiagLerGuardado\(|\bdiagAplicarPoda\(/;
  const corpoDe = (n) => fatiar(n, APP_SEM, 0);
  const usuarios = nomes.filter((n) => ABRIDORES.test(corpoDe(n)));
  assert.ok(usuarios.length >= 6, `o guard ficou cego: só achou ${usuarios.length} funções que abrem a base (${usuarios.join(', ')})`);
  for (const n of usuarios) {
    assert.match(corpoDe(n), COM_TETO, `DEFEITO: ${n} abre a base e espera a operação seguinte SEM teto — o \`open\` tem 5 s, mas o \`get\`/\`getAll\`/transação que não chamam de volta ficam pendurados pra sempre`);
  }
  // E quem espera por conta própria é UMA primitiva: nenhuma espera crua de transação (`tx.oncomplete`) sobrou fora dela.
  for (const n of nomes) {
    if (n === 'esperarComTeto') continue;
    const corpo = corpoDe(n);
    if (/await new Promise\([^)]*\)\s*=>\s*\{[^}]*\.oncomplete/.test(corpo.replace(/\n/g, ' '))) {
      assert.fail(`DEFEITO: ${n} espera uma transação com \`await new Promise\` cru — passa por \`esperarComTeto\``);
    }
  }
  // As funções que o teto protege (pelo nome) de fato o usam.
  for (const n of ['offlineLerChave', 'offlineGravarFila', 'offlineGravarJanela', 'diagLerGuardado', 'diagAplicarPoda', 'offlineCacheGrava',
    'offlineDesfazerTile', 'offlinePodarTiles', 'offlineEsquecer']) {
    assert.match(fatiar(n), /\besperarComTeto\(/, `${n} deixou de passar pelo \`esperarComTeto\``);
  }
  // CONTROLE do instrumento: o detector enxerga o abridor sem teto (uma função inventada) e o com teto.
  assert.equal(ABRIDORES.test('async function x() { db = await diagDB(); await new Promise((ok) => { tx.oncomplete = ok; }); }') && !COM_TETO.test('async function x() { db = await diagDB(); await new Promise(() => {}); }'), true, 'CONTROLE: o guard não enxerga a falta de teto');
});

test('R21-4-01 (fonte): o relatório, o interruptor do modo dev e a leitura da base do diagnóstico passam pelo prazo', () => {
  // O relatório: a releitura das outras aberturas corre dentro do `lerLocal` (o orçamento), e o que não chegou vira `coleta.semResposta`.
  const corpo = fatiar('diagCorpo');
  assert.match(corpo, /lerLocal\(rotuloDaBase, diagAtualizarAnteriores\)/, 'DEFEITO: a releitura da base do diagnóstico corre fora do `lerLocal` (o botão fica em "Juntando tudo…")');
  assert.match(corpo, /semRespostaLocal\.push\(rotuloDaBase\)/, 'o que não deu pra ler da base não vai pra `coleta.semResposta`');
  // O interruptor do modo dev: a leitura que ele espera é a da função com teto.
  assert.match(fatiar('diagAtualizarAnteriores'), /diagLerGuardado\(db, prazo - Date\.now\(\)\)/, 'o `getAll` da releitura não tem o que sobrou do orçamento');
  assert.match(APP_SEM, /await diagAtualizarAnteriores\(\)\.catch\(\(\) => false\);/, 'o interruptor do modo dev deixou de esperar a releitura com teto');
  // A releitura devolve `false` (não lança) quando não deu pra ler.
  assert.match(fatiar('diagAtualizarAnteriores'), /else return false;/, 'a releitura que falha deixou de devolver `false`');
});

// ═══ R21-4-01 · o cache do mapa que NÃO RESPONDE: `offlineBaixar` e a varredura de verdade ═════════
const JANELA = 1492385;
const CICLO = constanteBruta('OFFLINE_CICLO_MS');
const TILE = (i) => 'https://www.waze.com/row-tiles/live/base/' + i;
const itensDe = (n) => Array.from({ length: n }, (_, i) => TILE('t' + i));
const ok200 = { status: 200 };
const PARA_SEMPRE = Symbol('para-sempre');
const erroDe = (nome, msg = nome) => Object.assign(new Error(msg), { name: nome });

// A varredura DE VERDADE sobre um `fetch` e um `caches` de mentira, com os tetos pequenos.
//   `cache`: 'ok' | 'open-mudo' (o `caches.open` nunca responde) | 'put-mudo' (o `put` do tile nunca responde) |
//            'put-corpo-parado' (o `put` só rejeita quando o pedido é ABORTADO: o corpo que pendura, é rede) |
//            'sonda-mudo' (o `put` do tile rejeita por rede e a gravação MÍNIMA nunca responde);
//   `rede(u, quem)`: `{ status }`, um `Error` ou `PARA_SEMPRE` (a conexão que pendura até o aborto);
//   `corpoDaSonda`: 'ok' | 'corta' (a resposta da sonda traz o cabeçalho e o corpo é cortado).
function varredura({ itens, rede = () => ok200, cache = 'ok', tetoItem = 40, graca = 30, corpoDaSonda = 'ok', gravacao = true, lerFila = 'boa' }) {
  const relogio = { agora: JANELA * CICLO + 1000 };
  const log = { baixar: 0, sonda: 0, janelas: [], sondaDoCache: 0, apagouSonda: 0, leu: 0 };
  const noCache = new Map();
  const diario = [];
  const gravando = new Map();
  const ehSonda = (u) => /sonda\.invalid/.test(u);
  const resposta = (r, signal, quem) => ({ ok: r.status >= 200 && r.status < 300, status: r.status, body: null, signal,
    arrayBuffer: async () => { if (quem === 'sonda' && corpoDaSonda === 'corta') throw new TypeError('network error'); return new ArrayBuffer(0); },
    headers: { get: (h) => (r.headers && r.headers[h.toLowerCase()]) ?? null } });
  const cacheDeMentira = {
    put: (u, resp) => {
      if (ehSonda(u)) {
        log.sondaDoCache++;
        if (cache === 'sonda-mudo') return new Promise(() => {});
        noCache.set(u, true); return Promise.resolve();
      }
      if (cache === 'put-mudo') return new Promise(() => {});
      if (cache === 'put-corpo-parado') return new Promise((_, no) => resp.signal.addEventListener('abort', () => no(erroDe('AbortError'))));
      if (cache === 'sonda-mudo') return Promise.reject(new TypeError('network error'));
      noCache.set(u, true); return Promise.resolve();
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
    OFFLINE_ITEM_TETO_MS: tetoItem, OFFLINE_SONDA_TETO_MS: constanteBruta('OFFLINE_SONDA_TETO_MS'),
    OFFLINE_TILES_CACHE: 'waze-places-tiles',
    OFFLINE_4XX_PASSAGEIRO: new Function('return ' + /^const OFFLINE_4XX_PASSAGEIRO = (new Set\(\[[^\]]*\]\));/m.exec(APP_SEM)[1])(),
    OFFLINE_LIMITE_PAUSA_MS: constanteBruta('OFFLINE_LIMITE_PAUSA_MS'),
    OFFLINE_LIMITE_PAUSA_MAX_MS: constanteBruta('OFFLINE_LIMITE_PAUSA_MAX_MS'),
    OFFLINE_COTA_PAUSA_MS: constanteBruta('OFFLINE_COTA_PAUSA_MS'),
    OFFLINE_SONDA_URL: constanteBruta('OFFLINE_SONDA_URL'), OFFLINE_ABORTO_GRACA_MS: graca, esperarComTeto,
    offlineGravandoTile: gravando, offlineGeracaoDeTile: 0, Image: class {},
    caches: { open: () => (cache === 'open-mudo' ? new Promise(() => {}) : Promise.resolve(cacheDeMentira)),
              has: async () => noCache.size > 0, delete: async () => true },
    Response,
    offlineItensDaFila: async () => itens.map((u) => ({ u, tile: true })),
    offlineGravarJanela: (j, cobertura) => { log.janelas.push([j, cobertura]); }, offlinePodarTiles: async () => 0, offlineAnunciarTiles: () => {},
    atualizarLinhaDoOffline: () => {}, dfato: (k, o, lim) => diario.push([k, o, lim]),
    chavesQueEsperamAConta: () => new Set(), contar: (k) => { log[k] = (log[k] || 0) + 1; },
    gravacao, lerFilaModo: lerFila,
    setTimeout: (fn, ms) => { if (ms === 400) { fn(); return 0; } return setTimeout(fn, ms); },
  };
  const fetchDe = (quem) => (u, init = {}) => {
    log[quem]++;
    const r = rede(u, quem);
    if (r === PARA_SEMPRE) return new Promise((_, no) => { if (init.signal) init.signal.addEventListener('abort', () => no(erroDe('AbortError'))); });
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(resposta(r, init.signal, quem));
  };
  const chaves = Object.keys(deps);
  const corpo = [
    'let offlineVarrendo = false, offlinePedidaDeNovo = false, offlineUltimoGesto = Date.now(), offlineJanelaServida = null,',
    '    offlineUltimoResultado = null, offlineSegurarAte = 0, offlineSemEspaco = false, offlineEpoca = 0, offlineFilaGravadaEm = null, offlineFilaPreparada = null,',
    '    offlineFilaVarrida = null, offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set(), guardados: new Set() };',
    'async function offlineGravarFila() { contar("gravou"); if (gravacao === true) offlineFilaGravadaEm = 5; return gravacao; }',
    'async function offlineLerFila() { contar("leu"); if (lerFilaModo === "falha") return undefined; if (lerFilaModo === "vazia") return null;',
    '  return { t: 5, places: [{ venueID: "v", updateRequestID: "u" }] }; }',
    ...['filaReal', 'chaveDoPedido', 'pedidoForaDaFilaGuardada', 'offlineDesfazerTile', 'offlineRecuoDoLimite', 'offlineErroDeCota', 'offlineCacheGrava'].map((n) => fatiar(n)),
    fatiar('offlineBaixar').replace(/\bfetch\(/g, 'fetchBaixar('),
    fatiar('offlineSondarRede').replace(/\bfetch\(/g, 'fetchSonda('),
    fatiar('offlineVarrer'),
    `return { varrer: offlineVarrer, baixar: offlineBaixar, esquecer: () => { offlineEpoca++; },
      estado: () => ({ resultado: offlineUltimoResultado, janela: offlineJanelaServida, segurarAte: offlineSegurarAte, varrendo: offlineVarrendo,
        semEspaco: offlineSemEspaco, preparada: offlineFilaPreparada, feitos: [...offlineFeitosNaJanela.us] }),
      gesto: () => { offlineUltimoGesto = Date.now(); } };`,
  ].join('\n');
  const app = new Function(...chaves, 'fetchBaixar', 'fetchSonda', corpo)(...chaves.map((k) => deps[k]), fetchDe('baixar'), fetchDe('sonda'));
  return { app, relogio, log, noCache, diario, gravando, cacheDeMentira };
}
const ultimo = (x, k) => [...x.diario].reverse().find(([nome]) => nome === k)?.[1];
const ultimoLimite = (x, k) => [...x.diario].reverse().find(([nome]) => nome === k)?.[2];
const nomes = (x) => x.diario.map(([k]) => k);

test('R21-4-01: `offlineBaixar` separa o CACHE que não responde (`mudo`) da REDE que pendura (`teto`) — e a gravação mínima que não responde também é cache', async () => {
  const info = {};
  // O `caches.open` que nunca responde.
  const a = varredura({ itens: [], cache: 'open-mudo' });
  assert.equal(await comSentinela(a.app.baixar(TILE('x'), true, info)), 'mudo', 'DEFEITO: o `caches.open` pendurado não vira `mudo` (ou pendurou o download pra sempre)');
  assert.equal(info.erro, 'TimeoutError');
  // O `put` do tile que nunca responde.
  const b = varredura({ itens: [], cache: 'put-mudo' });
  assert.equal(await comSentinela(b.app.baixar(TILE('x'), true, {})), 'mudo', 'DEFEITO: o `put` pendurado não vira `mudo`');
  // A gravação MÍNIMA (a que separa "o cache não grava" da rede) que também não responde.
  const c = varredura({ itens: [], cache: 'sonda-mudo' });
  assert.equal(await comSentinela(c.app.baixar(TILE('x'), true, {})), 'mudo', 'DEFEITO: a gravação mínima pendurada não vira `mudo`');
  // CONTROLE — a REDE que pendura (a conexão parada até o aborto) segue sendo `teto`, não cache quebrado.
  const d = varredura({ itens: [], rede: () => PARA_SEMPRE });
  assert.equal(await comSentinela(d.app.baixar(TILE('x'), true, {})), 'teto', 'CONTROLE: a rede pendurada deixou de ser `teto`');
  // CONTROLE — o corpo que pendura depois do cabeçalho (o `put` rejeita quando o pedido é abortado) também é rede.
  const e = varredura({ itens: [], cache: 'put-corpo-parado' });
  assert.equal(await comSentinela(e.app.baixar(TILE('x'), true, {})), 'teto', 'CONTROLE: o corpo parado virou `mudo` — a rede ruim, o caso comum, seria contada como cache quebrado');
  // CONTROLE — o cache que responde grava e devolve `true`, sem sobra em `offlineGravandoTile`.
  const f = varredura({ itens: [] });
  assert.equal(await comSentinela(f.app.baixar(TILE('x'), true, {})), true);
  assert.equal(f.noCache.size, 1);
  assert.equal(f.gravando.size, 0, 'a entrada de "gravando" ficou depois do sucesso');
});

test('R21-4-01: o `put` que responde TARDE, depois do "Sair" de outra aba, não deixa o tile de terceiro no cache; sem "Sair", só a entrada sai', async () => {
  // O `put` fica no ar; o item estoura (`mudo`); o "Sair" (a época sobe) chega; o `put` termina e GRAVA o tile.
  const x = varredura({ itens: [], cache: 'ok' });
  let terminar;
  x.cacheDeMentira.put = (u) => new Promise((ok) => { terminar = () => { x.noCache.set(u, true); ok(); }; });
  const r = await comSentinela(x.app.baixar(TILE('tardio'), true, {}));
  assert.equal(r, 'mudo');
  assert.equal(x.gravando.size, 1, 'PRÉ-CONDIÇÃO: a entrada de "gravando" saiu antes de o `put` terminar — o desfazer não saberia que o tile é desta gravação');
  x.app.esquecer();                       // o "Sair" de outra aba (a época sobe)
  terminar();                             // o `put` pendurado acorda e grava
  await tique(30);
  assert.equal(x.noCache.has(TILE('tardio')), false, 'DEFEITO: o tile de terceiro gravado DEPOIS do "Sair" ficou no cache');
  assert.equal(x.gravando.size, 0);
  // CONTROLE: sem "Sair", o `put` tardio só limpa a entrada (o tile gravado é do aparelho e fica).
  const y = varredura({ itens: [], cache: 'ok' });
  let terminar2;
  y.cacheDeMentira.put = (u) => new Promise((ok) => { terminar2 = () => { y.noCache.set(u, true); ok(); }; });
  assert.equal(await comSentinela(y.app.baixar(TILE('tardio2'), true, {})), 'mudo');
  terminar2();
  await tique(30);
  assert.equal(y.noCache.has(TILE('tardio2')), true, 'CONTROLE: o desfazer apagou um tile sem "Sair" nenhum');
  assert.equal(y.gravando.size, 0, 'a entrada de "gravando" ficou');
});

const LIMITE = constanteBruta('OFFLINE_LIMITE_PAUSA_MS');
const COTA_PAUSA = constanteBruta('OFFLINE_COTA_PAUSA_MS');
for (const modo of ['open-mudo', 'put-mudo', 'sonda-mudo']) {
  test(`R21-4-01: com o cache do mapa que NÃO RESPONDE (${modo}) a varredura termina PARCIAL (\`cacheMudo\`), com a pausa CURTA, sem a sonda — nunca "pronto", nunca pendurada`, async () => {
    const x = varredura({ itens: itensDe(6), cache: modo });
    const fim = await comSentinela(x.app.varrer(), 5000);
    assert.notEqual(fim, PENDURADO, 'DEFEITO: a varredura ficou pendurada no cache que não responde (`offlineVarrendo` pra sempre; todo gatilho vira `offlinePedidaDeNovo`)');
    const e = x.app.estado();
    assert.equal(e.varrendo, false, 'a varredura seguiu "varrendo"');
    assert.equal(e.resultado, 'parcial', 'DEFEITO: o cache que não responde terminou "pronto"');
    assert.equal(nomes(x).includes('offline.pronto'), false);
    assert.equal(x.log.janelas.length, 0, 'a janela foi gravada (a linha das Preferências diria "Pronto")');
    assert.equal(e.preparada, null);
    const p = ultimo(x, 'offline.parcial');
    assert.equal(p?.cacheMudo, true, 'o diário não diz que o cache não respondeu');
    assert.equal(p?.cache, undefined, 'a causa foi dita como RECUSA do aparelho (`cache`), que pausa 10 min por um "não" que não houve');
    assert.equal(p?.cota, undefined);
    assert.match(String(ultimoLimite(x, 'offline.parcial')?.causa ?? ''), /cacheMudo/, 'a causa do limitador não distingue o cache mudo');
    assert.equal(x.log.sonda, 0, 'gastou a sonda de rede com uma falha que é do aparelho');
    assert.equal(p?.definitivos, 0, 'o tile virou definitivo');
    assert.ok(e.segurarAte >= x.relogio.agora + LIMITE - 1, 'sem a pausa');
    assert.ok(e.segurarAte < x.relogio.agora + COTA_PAUSA - 1, 'DEFEITO: a pausa é a LONGA da recusa (10 min) — um cache que travou pode voltar, e a pessoa perde só um minuto');
    assert.deepEqual(e.feitos, [], 'o tile que não gravou ficou como "feito"');
    // Dentro da pausa nada é baixado.
    const antes = x.log.baixar;
    await x.app.varrer();
    assert.equal(x.log.baixar, antes, 'a varredura pediu tile durante a pausa');
  });
}

test('R21-4-01 (CONTROLES da varredura): o cache que responde fecha "pronto"; a REDE que pendura fica "teto" (sem `cacheMudo`); o corpo parado também', async () => {
  const boa = varredura({ itens: itensDe(6) });
  await comSentinela(boa.app.varrer(), 5000);
  assert.equal(boa.app.estado().resultado, 'pronto', 'CONTROLE: o cache que responde deixou de fechar "pronto"');
  assert.equal(boa.noCache.size, 6);
  assert.equal(ultimo(boa, 'offline.parcial'), undefined);
  // A rede pendurada: as conexões estouram o teto do item, e a varredura PARA parcial — mas a causa NÃO é o cache.
  const rede = varredura({ itens: itensDe(6), rede: () => PARA_SEMPRE });
  assert.notEqual(await comSentinela(rede.app.varrer(), 5000), PENDURADO, 'a rede pendurada prendeu a varredura');
  assert.equal(rede.app.estado().resultado, 'parcial');
  assert.equal(ultimo(rede, 'offline.parcial')?.cacheMudo, undefined, 'DEFEITO: a rede pendurada foi contada como cache que não responde');
  assert.equal(ultimo(rede, 'offline.parcial')?.cache, undefined);
  // O corpo parado (o `put` rejeita ao abortar): também rede.
  const corpo = varredura({ itens: itensDe(6), cache: 'put-corpo-parado' });
  assert.notEqual(await comSentinela(corpo.app.varrer(), 5000), PENDURADO);
  assert.equal(corpo.app.estado().resultado, 'parcial');
  assert.equal(ultimo(corpo, 'offline.parcial')?.cacheMudo, undefined, 'DEFEITO: o corpo parado (rede) foi contado como cache mudo');
});

test('R21-4-01: depois da pausa curta a varredura RETOMA — o cache que voltou fecha "pronto" (a pessoa não perde mais que um minuto)', async () => {
  const x = varredura({ itens: itensDe(4), cache: 'open-mudo' });
  await comSentinela(x.app.varrer(), 5000);
  assert.equal(x.app.estado().resultado, 'parcial');
  // O cache volta a responder; o relógio passa da pausa.
  x.relogio.agora += LIMITE + 1000;
  // (O `caches.open` do harness é o mesmo objeto: troca o modo pelo cache de mentira.)
  const y = varredura({ itens: itensDe(4), cache: 'ok' });
  await comSentinela(y.app.varrer(), 5000);
  assert.equal(y.app.estado().resultado, 'pronto');
  assert.equal(y.noCache.size, 4);
});

test('R21-4-01: a poda do cache do mapa e a conferência do cache cujo `caches.has` NÃO RESPONDE terminam no teto — a varredura não fica presa no fim', async () => {
  const deps = { OFFLINE_TILES_CACHE: 'waze-places-tiles', OFFLINE_ITEM_TETO_MS: 50, esperarComTeto, caches: { has: () => new Promise(() => {}) },
    offlineFeitosNaJanela: { epoca: 0, us: new Set(), guardados: new Set() } };
  const nomesDeps = Object.keys(deps);
  const podar = new Function(...nomesDeps, 'let offlineEpoca = 0;\n' + fatiar('offlinePodarTiles') + '\nreturn offlinePodarTiles;')(...nomesDeps.map((k) => deps[k]));
  const r = await comSentinela(podar(new Set(), 0));
  assert.notEqual(r, PENDURADO, 'DEFEITO: a poda ficou pendurada no `caches.has` — ela é AGUARDADA no fim da varredura (`offlineVarrendo` pra sempre)');
  assert.equal(r, 0, 'a poda que estourou o teto deve devolver "não podou nada" (0)');
  // CONTROLE: a poda com o cache respondendo apaga o que não é da fila.
  const apagados = [];
  const cacheBom = { keys: async () => [{ url: 'a' }, { url: 'b' }], delete: async (req) => { apagados.push(req.url); return true; } };
  const deps2 = { ...deps, caches: { has: async () => true, open: async () => cacheBom } };
  const podar2 = new Function(...nomesDeps, 'let offlineEpoca = 0;\n' + fatiar('offlinePodarTiles') + '\nreturn offlinePodarTiles;')(...nomesDeps.map((k) => deps2[k]));
  assert.equal(await podar2(new Set(['a']), 0), 1);
  assert.deepEqual(apagados, ['b']);
});

test('R21-4-01 (fonte): a varredura envolve as leituras do cache em `esperarComTeto` e trata o `mudo` com a pausa CURTA', () => {
  const varrer = fatiar('offlineVarrer');
  assert.match(varrer, /ok === 'mudo'\) \{[\s\S]*?cacheMudo = true;[\s\S]*?OFFLINE_LIMITE_PAUSA_MS[\s\S]*?desistidosPorRede\.push\(it\);/,
    'o ramo `mudo` da varredura não marca `cacheMudo`, não usa a pausa curta ou não devolve o item à retomada');
  assert.doesNotMatch(varrer.match(/ok === 'mudo'\) \{[\s\S]*?desistidosPorRede\.push\(it\);/)[0], /OFFLINE_COTA_PAUSA_MS/, 'o `mudo` usa a pausa LONGA da recusa');
  assert.match(varrer, /\.\.\.\(cacheMudo \? \{ cacheMudo: true \} : \{\}\)/, 'o diário não leva `cacheMudo`');
  assert.match(varrer, /\(cacheMudo \? '\|cacheMudo' : ''\)/, 'a causa do limitador não leva `cacheMudo`');
  // As duas conferências de cache da varredura têm teto.
  assert.equal([...varrer.matchAll(/await esperarComTeto\(\(async \(\) =>/g)].length, 2, 'as leituras do cache da varredura (guardados e tiles negados) saíram do `esperarComTeto`');
  // O `offlineBaixar` espera o `open` e o `put` contra a promessa `mudo` e trata o `TimeoutError` ANTES do `estourou`.
  const baixar = fatiar('offlineBaixar');
  assert.match(baixar, /Promise\.race\(\[caches\.open\(OFFLINE_TILES_CACHE\), mudo\]\)/);
  assert.match(baixar, /Promise\.race\(\[gravando, mudo\]\)/);
  assert.ok(baixar.indexOf("e.name === 'TimeoutError'") < baixar.indexOf('if (estourou) return'), 'o `TimeoutError` é decidido DEPOIS do `estourou`: o cache mudo viraria `teto` (rede)');
});

// ═══ R21-4-02 · a abertura espera UMA leitura da janela, com limite curto, dividida com a fila ═══
test('R21-4-02: o limite da espera da janela na abertura é curto (300–500 ms) — a base saudável responde em milissegundos e nada muda', () => {
  const ms = constanteBruta('OFFLINE_JANELA_ESPERA_MS');
  assert.ok(ms >= 300 && ms <= 500, `o limite é ${ms} ms: abaixo de 300 a base saudável perde a janela (a foto crua, o lie-fi sem cobertura); acima de 500 o card volta a esperar a base lenta`);
});

function esperaNaAbertura({ ms = 40 } = {}) {
  const log = { tarde: 0, lidas: 0 };
  let leitura = null;
  const deps = { OFFLINE_JANELA_ESPERA_MS: ms, aoChegarAJanelaTarde: () => { log.tarde++; }, offlineRecuperarJanela: () => { log.lidas++; return leitura; } };
  const nomesDeps = Object.keys(deps);
  const espera = new Function(...nomesDeps, fatiar('offlineEsperarAJanelaNaAbertura') + '\nreturn offlineEsperarAJanelaNaAbertura;')(...nomesDeps.map((k) => deps[k]));
  return { espera, log, leitura: (p) => { leitura = p; } };
}

test('R21-4-02: a leitura da janela que NÃO responde não segura a abertura — passado o limite a espera devolve `false`; a leitura segue no ar e, quando chega, o card é refeito', async () => {
  const x = esperaNaAbertura({ ms: 40 });
  let chegar;
  x.leitura(new Promise((ok) => { chegar = ok; }));
  const t0 = Date.now();
  const r = await comSentinela(x.espera(), 1500);
  assert.notEqual(r, PENDURADO, 'DEFEITO: a abertura ficou pendurada na leitura da janela (a base lenta gastava os 5 s do teto, e a que não responde, o app todo)');
  assert.equal(r, false, 'a espera que estourou o limite não devolveu `false`');
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(x.log.tarde, 0, 'o card foi refeito antes de a janela chegar');
  chegar();
  await tique(10);
  assert.equal(x.log.tarde, 1, 'DEFEITO: a janela que chegou depois do limite não refez o card sem foto (a foto crua que ninguém aqueceu fica na tela)');
});

test('R21-4-02 (CONTROLE): a leitura que responde dentro do limite devolve `true` e NÃO refaz o card — a base saudável não muda nada', async () => {
  const x = esperaNaAbertura({ ms: 200 });
  x.leitura(Promise.resolve());
  assert.equal(await comSentinela(x.espera(), 1500), true);
  await tique(30);
  assert.equal(x.log.tarde, 0, 'CONTROLE: a janela que chegou a tempo refez o card (pisca em toda abertura)');
  // A leitura que REJEITA também libera a abertura (e não refaz nada): a falha é "sem janela".
  const y = esperaNaAbertura({ ms: 200 });
  y.leitura(Promise.reject(new Error('base quebrada')));
  assert.equal(await comSentinela(y.espera(), 1500), true);
});

test('R21-4-02: `offlineRecuperarJanela` DIVIDE a leitura em voo (uma abertura da base) e o "Sair" no meio descarta o que foi lido', async () => {
  const a = aparelho('get-lento', { tetoDb: 500 });
  a.st.atrasoGet = 60;
  await (async () => { a.st.modo = 'ok'; await a.gravarJanela(1492385, 5); a.st.modo = 'get-lento'; })();
  const opens0 = a.st.opens;
  const p1 = a.recuperar();
  const guardada = a.lendo();
  assert.ok(guardada, 'a leitura em voo não está guardada para ser dividida');
  const p2 = a.recuperar();
  assert.equal(a.lendo(), guardada, 'DEFEITO: a segunda chamada abriu outra leitura em vez de dividir a que está no ar');
  await comSentinela(Promise.all([p1, p2]));
  assert.equal(a.st.opens - opens0, 1, 'a base foi aberta mais de uma vez pela mesma leitura');
  assert.equal(a.janela(), 1492385, 'a janela lida não entrou na memória');
  assert.equal(a.lendo(), null, 'a leitura terminada ficou guardada: a próxima nunca leria de novo');
  // O "Sair" (a época sobe) com a leitura no ar: a janela da base que saiu NÃO entra na memória daqui.
  const b = aparelho('ok', { tetoDb: 500 });
  await b.gravarJanela(1492385, 5);
  b.st.modo = 'get-lento'; b.st.atrasoGet = 60;
  const lendo = b.recuperar();
  await b.esquecer({ soMemoria: true });
  await comSentinela(lendo);
  assert.equal(b.st.dados.get('janela')?.janela, 1492385, 'PRÉ-CONDIÇÃO: a janela não estava na base (o "Sair" só da memória não a apaga)');
  assert.equal(b.janela(), null, 'DEFEITO: a leitura que começou antes do "Sair" pôs a janela da base que saiu na memória');
  assert.equal(b.lendo(), null);
});

// A reabertura sem rede de verdade (as leituras REAIS sobre a base de mentira): a janela e a fila saem JUNTAS.
function reabrirDeVerdade({ modo = 'ok', tetoDb = 80, janelaGravada = true } = {}) {
  const { st, indexedDB } = idbDeMentira(modo);
  const log = [];
  const AppState = { authenticated: true, queue: [], hasMore: false, loadError: true, serverTotal: 0, fetchEpoch: 0 };
  const deps = {
    indexedDB, OFFLINE_DB: 'waze_places_offline', OFFLINE_STORE: 'fila', OFFLINE_DB_TETO_MS: tetoDb, OFFLINE_ITEM_TETO_MS: 200, esperarComTeto,
    AppState, navigator: { onLine: false }, offlineLigado: () => true,
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), dfato: (k, d, lim) => log.push([k, d, lim]),
    semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }), pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {},
    updatePendingCount: () => {}, sortQueue: () => {}, showCurrentPlace: () => log.push(['card']),
    contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, marcaDestaAba: () => 'm-tok', API: { getSession: () => 'tok' }, chaveDoPedido,
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let offlineJanelaServida = null, filaDeOnde = null, offlineFilaGravadaEm = null, offlineFilaPreparada = null,
      offlineFilaGravadaChaves = null, offlineEpoca = 0, offlineLendoAJanela = null;
    ${['mesmoLugar', 'filaGuardadaDestaConta', 'offlineDB', 'offlineLerChave', 'offlineLerFila', 'offlineLerRegistroDaJanela', 'offlineRecuperarJanela',
       'offlineTentarAbrirSemRede'].map((n) => fatiar(n)).join('\n')}
    return { abrir: offlineTentarAbrirSemRede, janela: () => offlineJanelaServida, lendo: () => offlineLendoAJanela };`)(...chaves.map((k) => deps[k]));
  if (janelaGravada) st.dados.set('janela', { janela: 1492385, t: 1, filaCoberta: 5 });
  return { app, st, log, AppState };
}

test('R21-4-02: a reabertura sem rede começa a leitura da JANELA junto com a da FILA (uma abertura cada, ao mesmo tempo) — com a base lenta o painel de falha não leva o dobro do teto', async () => {
  const x = reabrirDeVerdade({ modo: 'open-mudo', tetoDb: 80 });
  const t0 = Date.now();
  const p = x.app.abrir();
  await tique(10);
  assert.equal(x.st.opens, 2, 'DEFEITO: as duas leituras não saíram juntas — a base lenta gasta o teto duas vezes, em série (o painel de falha saía aos 10,2 s)');
  assert.ok(x.app.lendo(), 'a leitura da janela não está guardada para ser dividida com a abertura');
  const r = await comSentinela(p, 3000);
  assert.notEqual(r, PENDURADO, 'a reabertura ficou pendurada');
  assert.equal(r, false);
  // A leitura que FALHOU deixa a linha no diário (R20, A4) — e a fila não abre.
  assert.deepEqual(x.log.map(([k]) => k), ['offline.leituraFalhou']);
  assert.equal(x.AppState.queue.length, 0);
  // Um orçamento só: o tempo total é o de UMA espera do teto (80 ms), não o de duas em série (160+).
  assert.ok(Date.now() - t0 < 150, `a reabertura levou ${Date.now() - t0} ms com o teto de 80 ms: as leituras voltaram a ser em série`);
  // CONTROLE: com a base respondendo, a fila abre e a janela entra na memória.
  const boa = reabrirDeVerdade({ modo: 'ok' });
  const fila = { t: Date.now(), desde: Date.now(), conta: '111', regiao: 'row', pais: '30', busca: 'b', places: [{ venueID: 'v1', updateRequestID: 'u1' }] };
  boa.st.dados.set('fila', fila);
  assert.equal(await comSentinela(boa.app.abrir()), true, 'CONTROLE: a base boa deixou de abrir a fila guardada');
  assert.equal(boa.app.janela(), 1492385, 'a janela da base boa não chegou à memória');
});

test('R21-4-02: `aoChegarAJanelaTarde` refaz SÓ o card sem foto da frente, fora de gesto, e com a janela na memória — o de foto carregada não pisca', () => {
  const montar = ({ janela = 1492385, semFoto = true, gesto = false, temCard = true, place = true } = {}) => {
    const log = { redesenhou: 0, linha: 0, fato: [] };
    const card = { querySelector: (s) => (s === '.card-sem-foto' && semFoto ? {} : null) };
    const deps = { atualizarLinhaDoOffline: () => { log.linha++; }, AppState: { currentPlace: place ? { venueID: 'v' } : null },
      cardDaFrente: () => (temCard ? card : null), cardSobGesto: () => gesto, dfato: (k) => log.fato.push(k),
      mantendoFocoNoCard: (f) => { log.redesenhou++; }, showCurrentPlace: () => {} };
    const n = Object.keys(deps);
    const fn = new Function(...n, `let offlineJanelaServida = ${janela};\n${fatiar('aoChegarAJanelaTarde')}\nreturn aoChegarAJanelaTarde;`)(...n.map((k) => deps[k]));
    return { fn, log };
  };
  const a = montar(); a.fn();
  assert.equal(a.log.redesenhou, 1, 'DEFEITO: o card sem foto não foi refeito com a janela chegada');
  assert.equal(a.log.linha, 1, 'a linha das Preferências não foi atualizada (a cobertura chegou junto da janela)');
  assert.deepEqual(a.log.fato, ['foto.janelaChegou']);
  for (const [rotulo, opt] of [['card de foto carregada', { semFoto: false }], ['card sob gesto', { gesto: true }], ['sem janela na memória', { janela: 'null' }],
    ['sem card na tela', { temCard: false }], ['sem pedido atual', { place: false }]]) {
    const o = montar(opt); o.fn();
    assert.equal(o.log.redesenhou, 0, `CONTROLE: refez o card (${rotulo})`);
  }
});

test('R21-4-02 (fonte): a abertura com rede passa pela espera LIMITADA — nunca pela leitura crua; a reabertura sem rede inicia a janela ANTES da fila', () => {
  const abrir = fatiar('abrirComSessaoSalva');
  assert.match(abrir, /if \(offlineLigado\(\) && offlineJanelaServida === null\) await offlineEsperarAJanelaNaAbertura\(\);/, 'a abertura deixou de usar a espera limitada');
  assert.doesNotMatch(abrir, /await offlineRecuperarJanela\(\)/, 'DEFEITO: a abertura voltou a esperar a leitura da janela SEM limite');
  const sem = fatiar('offlineTentarAbrirSemRede');
  const iJanela = sem.indexOf('offlineRecuperarJanela()');
  const iFila = sem.indexOf('await offlineLerFila()');
  assert.ok(iJanela > 0 && iFila > 0 && iJanela < iFila, 'DEFEITO: a leitura da janela não começa ANTES da espera da fila — as duas voltam a ser em série');
  assert.match(sem, /const lendoAJanela = offlineRecuperarJanela\(\);/);
  assert.doesNotMatch(APP_SEM.match(/async function offlineRecuperarJanela\(\) \{[\s\S]*?\n\}/)[0], /\bawait\s+offlineDB\(/, 'a recuperação da janela abre a base por conta própria');
});

// ═══ R21-4-01 (diagnóstico) e R21-4-07 · a base do diagnóstico: tetos, e quem só LÊ não a recria ═══
function diagAparelho(modo = 'ok', { existe = true, tetoDb = 60, dados = [], ligado = true } = {}) {
  const { st, indexedDB } = idbDeMentira(modo, { existe });
  for (const a of dados) st.dados.set(a.id, a);
  const log = { fab: 0, entregues: 0 };
  const deps = { indexedDB, DIAG_DB: 'waze_places_diag', DIAG_STORE: 'aberturas', DIAG_DB_TETO_MS: tetoDb, DIAG_GUARDA_MS: 24 * 3600e3, esperarComTeto,
    dlogLigado: () => ligado, dlogJaBaixados: new WeakSet(), diagMarcaDoMomento: (m) => (m && m.t) + '|' + (m && m.motivo),
    atualizarFabDev: () => { log.fab++; }, diagAplicarEntregues: () => { log.entregues++; } };
  const nomesDeps = Object.keys(deps);
  const corpo = [
    'let diagEpoca = 0, diagAberturasAnteriores = []; const DIAG_ABERTURA = { id: "esta-aba" };',
    ...['diagDB', 'diagLerGuardado', 'diagAplicarPoda', 'diagAtualizarAnteriores'].map((n) => fatiar(n)),
    'return { db: diagDB, ler: diagLerGuardado, aplicar: diagAplicarPoda, atualizar: diagAtualizarAnteriores, anteriores: () => diagAberturasAnteriores,',
    '         esquecer: () => { diagEpoca++; } };',
  ].join('\n');
  const fn = new Function(...nomesDeps, corpo)(...nomesDeps.map((k) => deps[k]));
  return { ...fn, st, log };
}
const abertura = (id, extra = {}) => ({ id, inicio: 1, salvoEm: Date.now(), salvoPor: 'pagehide', diario: [], chamadas: [], erros: [], momentos: [], ...extra });

test('R21-4-01: o `getAll` da base do diagnóstico que NUNCA responde estoura o teto (`TimeoutError`), é abortado — e a releitura devolve `false` em vez de pendurar o relatório e o interruptor do modo dev', async () => {
  const d = diagAparelho('getall-mudo', { dados: [abertura('outra')] });
  const db = await d.db();
  await assert.rejects(comSentinela(d.ler(db, 50)).then((r) => { if (r === PENDURADO) throw new Error('PENDURADO'); return r; }), (e) => e.name === 'TimeoutError',
    'DEFEITO: o `getAll` pendurado não estoura o teto (o relatório ficava em "Juntando tudo…" por mais de 75 s)');
  assert.ok(d.st.abortos >= 1, 'a transação pendurada não foi abortada');
  db.close();
  // A releitura inteira: não lança, não pendura, devolve `false` (o relatório anota `coleta.semResposta`) e FECHA a conexão.
  const e = diagAparelho('getall-mudo', { dados: [abertura('outra')] });
  const r = await comSentinela(e.atualizar(), 1500);
  assert.notEqual(r, PENDURADO, 'DEFEITO: `diagAtualizarAnteriores` ficou pendurada — o interruptor do modo dev (a caixa desmarcava e o modo seguia ligado) e o relatório esperam por ela');
  assert.equal(r, false);
  assert.equal(e.st.abertas, 0, 'DEFEITO: a conexão da releitura pendurada ficou aberta');
  assert.deepEqual(e.anteriores(), [], 'o que não foi lido entrou na memória');
  // CONTROLE: com a base respondendo, a releitura traz a outra aba e devolve `true`.
  const ok = diagAparelho('ok', { dados: [abertura('outra')] });
  assert.equal(await comSentinela(ok.atualizar()), true);
  assert.deepEqual(ok.anteriores().map((a) => a.id), ['outra']);
  assert.equal(ok.st.abertas, 0);
});

test('R21-4-01: o `open` e o `getAll` dividem UM orçamento — a releitura cujo `open` consome quase todo o teto não ganha outro pro `getAll`', async () => {
  // O `open` demora ~83% do teto (lento, mas responde); o `getAll` não responde. Com dois tetos em série o interruptor
  // do modo dev esperava o dobro (10 s com o teto de 5 s); com UM orçamento, o total fica perto do teto.
  const d = diagAparelho('open-tarde', { tetoDb: 300, dados: [abertura('outra')] });
  d.st.atrasoOpen = 250;
  d.st.getAllMudo = true;
  const t0 = Date.now();
  const r = await comSentinela(d.atualizar(), 3000);
  const gasto = Date.now() - t0;
  assert.equal(r, false, 'PRÉ-CONDIÇÃO: a releitura não falhou — o `getAll` pendurado não foi exercitado');
  assert.ok(gasto >= 250, `PRÉ-CONDIÇÃO: o \`open\` lento nem demorou (${gasto} ms)`);
  assert.ok(gasto < 450, `DEFEITO: a releitura levou ${gasto} ms com o orçamento de 300 ms: o \`open\` e o \`getAll\` voltaram a ter um teto cada (o dobro em série)`);
  assert.equal(d.st.abertas, 0);
});

test('R21-4-01: a gravação (poda) da base do diagnóstico cuja transação NUNCA completa estoura o teto, é ABORTADA e rejeita — a fila `diagGuardando` não fica presa', async () => {
  const d = diagAparelho('tx-mudo');
  const db = await d.db();
  const poda = { sair: ['velha'], manter: [abertura('esta-aba')], cortadas: [] };
  const r = await comSentinela(d.aplicar(db, poda, new Set(['esta-aba'])).then(() => 'ok', (e) => e.name), 1500);
  assert.notEqual(r, PENDURADO, 'DEFEITO: a gravação da base do diagnóstico ficou pendurada — o apagar do "Sair" e do desligar entra na MESMA fila e nunca rodava');
  assert.equal(r, 'TimeoutError');
  assert.ok(d.st.abortos >= 1, 'a gravação estourada não foi abortada');
  db.close();
  // CONTROLE: com a base respondendo a poda aplica (delete + put).
  const ok = diagAparelho('ok', { dados: [abertura('velha')] });
  const db2 = await ok.db();
  await ok.aplicar(db2, poda, new Set(['esta-aba']));
  db2.close();
  assert.deepEqual([...ok.st.dados.keys()], ['esta-aba']);
});

test('R21-4-07: a leitura da base do diagnóstico NÃO a recria depois do "Sair" de outra aba — `diagDB({ soLer: true })` aborta a criação e a releitura devolve "nada a reler"', async () => {
  const d = diagAparelho('ok', { existe: false });
  await assert.rejects(d.db({ soLer: true }), (e) => e.semBase === true, 'a abertura de leitura não diz "sem base"');
  assert.equal(d.st.criada, false, 'DEFEITO: abrir pra LER criou a base do diagnóstico (que o "Sair" da outra aba acabou de apagar)');
  // A releitura inteira (a do relatório e a do desligar): `true` (nada falhou), nenhuma base criada, memória intacta.
  const r = await comSentinela(d.atualizar());
  assert.equal(r, true, 'a base que não existe foi tratada como falha de leitura');
  assert.equal(d.st.criada, false, 'DEFEITO: `diagAtualizarAnteriores` recriou a base — o aparelho fica com `waze_places_diag` de volta, sem dado mas com o nome');
  assert.deepEqual(d.anteriores(), []);
  assert.equal(d.st.abertas, 0);
  // CONTROLE: quem GRAVA abre sem `soLer` e cria a base (o instrumento enxerga a criação).
  const g = diagAparelho('ok', { existe: false });
  const db = await g.db();
  assert.equal(g.st.criada, true, 'CONTROLE: o abridor de escrita deixou de criar a base — a medição de cima estaria cega');
  db.close();
});

test('R21-4-07: a abertura do app só LÊ a base quando não há retrato do fechar pra juntar — com retrato a base precisa existir', async () => {
  const montar = ({ retratos }) => {
    const { st, indexedDB } = idbDeMentira('ok', { existe: false });
    const log = { aplicou: 0, fato: [] };
    const DIAG_ABERTURA = { id: 'esta-aba' };
    const deps = { indexedDB, DIAG_DB: 'waze_places_diag', DIAG_STORE: 'aberturas', DIAG_DB_TETO_MS: 60, DIAG_GUARDA_MS: 24 * 3600e3, esperarComTeto,
      dlogLigado: () => true, diagPodarEntregas: () => {}, diagAberturasVivas: async () => null, diagLerRetratos: () => retratos,
      diagJuntarRetrato: (guardada, r) => ({ ...(guardada || {}), id: r.id, salvoEm: Date.now(), momentos: [] }),
      diagPodarAberturas: (lista) => ({ manter: lista, sair: [], cortadas: [] }),
      diagAplicarPoda: async () => { log.aplicou++; }, diagEsquecerRetratos: () => {}, diagMomentosAnteriores: () => [],
      dfato: (k) => log.fato.push(k), atualizarFabDev: () => {} };
    const n = Object.keys(deps);
    const fn = new Function(...n, `let diagEpoca = 0, diagAberturasAnteriores = [], diagOutrasVivasAoAbrir = null; const DIAG_ABERTURA = ${JSON.stringify(DIAG_ABERTURA)};\n`
      + ['diagDB', 'diagLerGuardado', 'diagCarregarAberturas'].map((nome) => fatiar(nome)).join('\n') + '\nreturn { abrir: diagCarregarAberturas, anteriores: () => diagAberturasAnteriores };')(...n.map((k) => deps[k]));
    return { fn, st, log };
  };
  const sem = montar({ retratos: [] });
  await comSentinela(sem.fn.abrir(), 1500);
  assert.equal(sem.st.criada, false, 'DEFEITO: a abertura do app, sem nada a juntar, criou a base do diagnóstico em todo aparelho que liga o modo dev');
  assert.deepEqual(sem.log.fato, ['diag.aberturas'], 'a abertura sem base não terminou normalmente');
  assert.equal(sem.log.aplicou, 0);
  // CONTROLE: com retrato do fechar, a base é criada e recebe o que o fechar deixou.
  const com = montar({ retratos: [{ r: { id: 'fechou' } }] });
  await comSentinela(com.fn.abrir(), 1500);
  assert.equal(com.st.criada, true, 'CONTROLE: com retrato a base não foi criada — o fechar/recarregar perderia a abertura');
  assert.equal(com.log.aplicou, 1);
  assert.equal(com.st.abertas, 0);
});

// ═══ R21-4-08 · a sonda de rede lê o corpo ATÉ O FIM ══════════════════════════════════════════════
function sondaDe({ status = 200, corpo = 'ok', tetoMs = 60, fetchRejeita = false }) {
  const log = { arrayBuffer: 0, cancel: 0 };
  const deps = { OFFLINE_SONDA_TETO_MS: tetoMs, OFFLINE_4XX_PASSAGEIRO: new Set([408, 425, 429]), offlineRecuoDoLimite: () => 60000,
    fetch: (u, init) => {
      if (fetchRejeita) return Promise.reject(new TypeError('Failed to fetch'));
      const r = { ok: status >= 200 && status < 300, status, body: { cancel: () => { log.cancel++; return Promise.resolve(); } },
        arrayBuffer: () => {
          log.arrayBuffer++;
          if (corpo === 'corta') return Promise.reject(new TypeError('network error'));
          if (corpo === 'parado') return new Promise((_, no) => init.signal.addEventListener('abort', () => no(erroDe('AbortError'))));
          return Promise.resolve(new ArrayBuffer(8));
        } };
      return Promise.resolve(r);
    } };
  const n = Object.keys(deps);
  const sonda = new Function(...n, fatiar('offlineSondarRede') + '\nreturn offlineSondarRede;')(...n.map((k) => deps[k]));
  return { sonda, log };
}

test('R21-4-08: a sonda lê o corpo da resposta BOA até o fim — o cabeçalho com o corpo cortado NÃO é "a rede anda"', async () => {
  const boa = sondaDe({});
  assert.equal(await comSentinela(boa.sonda('https://t/1')), true);
  assert.equal(boa.log.arrayBuffer, 1, 'a sonda não leu o corpo da resposta boa');
  assert.equal(boa.log.cancel, 0, 'a sonda CANCELOU o corpo da resposta boa (só o cabeçalho foi conferido)');
  const cortada = sondaDe({ corpo: 'corta' });
  assert.equal(await comSentinela(cortada.sonda('https://t/1')), false, 'DEFEITO: a rede que entrega o cabeçalho e corta o corpo foi dada como "anda" (os itens viravam `definitivo` e a preparação "Pronto" com ZERO tiles)');
  const parada = sondaDe({ corpo: 'parado', tetoMs: 50 });
  const t0 = Date.now();
  assert.equal(await comSentinela(parada.sonda('https://t/1'), 1500), false, 'DEFEITO: o corpo parado pendurou a sonda ou foi dado como "anda"');
  assert.ok(Date.now() - t0 < 800, 'o teto da sonda não vale pro corpo');
  const semRede = sondaDe({ fetchRejeita: true });
  assert.equal(await comSentinela(semRede.sonda('https://t/1')), false);
});

test('R21-4-08 (CONTROLES): o servidor que RESPONDE com erro continua sendo rede de pé SEM ler o corpo; 408/425/429 seguem `limite`', async () => {
  for (const status of [404, 500, 503]) {
    const x = sondaDe({ status, corpo: 'corta' });
    assert.equal(await comSentinela(x.sonda('https://t/1')), true, `CONTROLE: o ${status} deixou de ser "a rede anda" (a decisão do R5-4-1)`);
    assert.equal(x.log.arrayBuffer, 0, `o corpo de um ${status} foi lido (não é nosso de guardar)`);
    assert.equal(x.log.cancel, 1, `o corpo do ${status} não foi cancelado`);
  }
  const info = {};
  const lim = sondaDe({ status: 429 });
  assert.equal(await comSentinela(lim.sonda('https://t/1', info)), 'limite');
  assert.equal(info.recuoMs, 60000);
  assert.equal(lim.log.arrayBuffer, 0);
});

test('R21-4-08: na varredura, o corpo cortado na sonda NÃO dá os itens por `definitivo` — termina PARCIAL; com a rede de pé (corpo inteiro) o caminho de sempre segue', async () => {
  const rede = (u, quem) => (quem === 'baixar' ? new TypeError('Failed to fetch') : ok200);
  const cortado = varredura({ itens: itensDe(4), rede, corpoDaSonda: 'corta' });
  assert.notEqual(await comSentinela(cortado.app.varrer(), 5000), PENDURADO);
  assert.equal(cortado.app.estado().resultado, 'parcial', 'DEFEITO: com a rede cortando o corpo a preparação terminou "pronto" (itens `definitivo` pela sonda que só viu o cabeçalho)');
  assert.equal(nomes(cortado).includes('offline.pronto'), false);
  assert.ok(cortado.log.sonda >= 1, 'PRÉ-CONDIÇÃO: a sonda nem foi consultada — o teste não exercita o caminho');
  assert.equal(cortado.noCache.size, 0);
  // CONTROLE: a rede anda de verdade (a sonda lê o corpo inteiro) e o tile é que é defeituoso: o item sai `definitivo` (decisão antiga).
  const inteiro = varredura({ itens: itensDe(4), rede, corpoDaSonda: 'ok' });
  await comSentinela(inteiro.app.varrer(), 5000);
  assert.equal(inteiro.app.estado().resultado, 'pronto', 'CONTROLE: a rede de pé deixou de dar o item defeituoso por definitivo');
  assert.equal(ultimo(inteiro, 'offline.pronto')?.definitivos, 4);
});

// ═══ R21-4-05 · as repetições que o limitador ainda não escreveu entram no relatório ══════════════
function diarioDeMentira() {
  const deps = { Date: { now: () => relogio.agora } };
  const relogio = { agora: Date.UTC(2026, 9, 14, 12, 0, 0) };
  const n = Object.keys(deps);
  const corpo = [
    'let dfatoAnel = []; const DFATO_TETO = 120, DFATO_LIMITE_SERIE = 3, DFATO_LIMITE_MS = 10 * 60000; const dfatoLimite = new Map();',
    fatiar('dfato'), fatiar('dfatoPendentes'),
    'return { dfato, pendentes: dfatoPendentes, anel: () => dfatoAnel, limite: dfatoLimite };',
  ].join('\n');
  const fn = new Function(...n, corpo)(...n.map((k) => deps[k]));
  return { ...fn, relogio };
}
const somaDeLinhas = (linhas, k) => linhas.filter((l) => l.k === k).reduce((n, l) => n + 1 + (l.juntas || 0), 0);

test('R21-4-05: `dfatoPendentes` devolve UMA linha por chave com repetições ainda não escritas (a última suprimida, `juntas` = as outras) — a conta do leitor fecha, e o estado não é tocado', () => {
  const d = diarioDeMentira();
  for (let i = 0; i < 6; i++) { d.dfato('offline.parcial', { cache: true, i }, { causa: 'cache:SecurityError' }); d.relogio.agora += 1000; }
  assert.equal(d.anel().length, 3, 'PRÉ-CONDIÇÃO: o limitador não suprimiu (3 linhas escritas, 3 repetições pendentes)');
  assert.equal(somaDeLinhas(d.anel(), 'offline.parcial'), 3);
  const pend = d.pendentes();
  assert.equal(pend.length, 1, 'DEFEITO: as repetições pendentes não saem (o relatório mostrava 3 passadas de 6)');
  assert.equal(pend[0].k, 'offline.parcial');
  assert.equal(pend[0].i, 5, 'a linha não leva os dados da ÚLTIMA repetição suprimida');
  assert.equal(pend[0].juntas, 2, 'o `juntas` não leva as outras repetições (3 suprimidas = esta linha + 2)');
  assert.equal(pend[0].t, d.relogio.agora - 1000, 'a hora não é a da última repetição suprimida');
  assert.equal(somaDeLinhas([...d.anel(), ...pend], 'offline.parcial'), 6, 'a soma 1+juntas do leitor não fecha com as 6 passadas');
  // Não muda o estado: chamar de novo dá o mesmo, o anel segue igual, e uma repetição nova ainda soma.
  assert.deepEqual(d.pendentes(), pend);
  assert.equal(d.anel().length, 3);
  d.dfato('offline.parcial', { cache: true, i: 6 }, { causa: 'cache:SecurityError' });
  assert.equal(d.pendentes()[0].juntas, 3, 'ler as pendentes zerou/alterou o contador do limitador');
  // Uma linha só: nenhuma pendente → vazio; a que o limitador já escreveu na 4ª+10min não fica duplicada.
  const limpo = diarioDeMentira();
  limpo.dfato('x', { a: 1 }, { causa: 'c' });
  assert.deepEqual(limpo.pendentes(), [], 'CONTROLE: sem repetição suprimida saiu linha');
  limpo.dfato('y', { a: 1 });
  assert.deepEqual(limpo.pendentes(), [], 'CONTROLE: o fato sem limitador gerou pendência');
  d.relogio.agora += 11 * 60000;
  d.dfato('offline.parcial', { cache: true, i: 7 }, { causa: 'cache:SecurityError' });
  assert.deepEqual(d.pendentes(), [], 'CONTROLE: depois de a série escrever a linha dos 10 min a pendência segue listada (duplicaria a passada)');
  assert.equal(somaDeLinhas(d.anel(), 'offline.parcial'), 8, 'a linha dos 10 min não carrega as repetições juntadas');
});

test('R21-4-05: cada chave com pendência vira a sua linha — duas causas e duas chaves, sem mexer uma na outra', () => {
  const d = diarioDeMentira();
  for (let i = 0; i < 5; i++) d.dfato('offline.gravacaoFalhou', { e: 'TimeoutError', i }, { causa: 'falhou:TimeoutError' });
  for (let i = 0; i < 4; i++) d.dfato('offline.leituraFalhou', { i }, { causa: 'leitura' });
  const pend = d.pendentes();
  assert.deepEqual(pend.map((l) => l.k).sort(), ['offline.gravacaoFalhou', 'offline.leituraFalhou']);
  assert.equal(pend.find((l) => l.k === 'offline.gravacaoFalhou').juntas, 1);
  assert.equal(pend.find((l) => l.k === 'offline.leituraFalhou' ).i, 3);
  assert.equal(somaDeLinhas([...d.anel(), ...pend], 'offline.gravacaoFalhou'), 5);
  assert.equal(somaDeLinhas([...d.anel(), ...pend], 'offline.leituraFalhou'), 4);
});

test('R21-4-05 (fonte): o diário do RELATÓRIO e o da cópia guardada (o retrato do `pagehide` e a gravação da abertura) levam as pendentes', () => {
  const diario = /diario: \[\.\.\.dfatoAnel, \.\.\.dfatoPendentes\(\), \.\.\.dlogAnel\]/;
  assert.match(fatiar('diagRegistroDaAbertura'), diario, 'a cópia guardada (a abertura gravada na base) não leva as pendentes');
  // O relatório e o retrato do `pagehide` montam o diário no `diagCorpo` / no retrato: a fonte única é `dfatoPendentes()`.
  const usos = [...APP_SEM.matchAll(/\.\.\.dfatoPendentes\(\)/g)].length;
  assert.ok(usos >= 2, `só ${usos} lugar(es) leem as pendentes: o relatório (diagCorpo) e a cópia guardada precisam das duas pontas`);
  assert.match(fatiar('diagCorpo').replace(/\s+/g, ' ') + APP_SEM.slice(APP_SEM.indexOf('function diagRetratoAoSair')).slice(0, 3000), /dfatoPendentes\(\)/, 'o relatório não lê as pendentes');
  // O MIN (o que o navegador roda) tem a função.
  assert.match(MIN, /function dfatoPendentes\(/, 'js/min/app.js sem a função (rode `npm run js`)');
});

// ═══ R21-4-06 · o FAB de baixo acompanha a altura MEDIDA da pilha de avisos ═════════════════════════
const FAB = 44;
function telaDoFab({ pilhaTop = null, altura = 740, largura = 360 } = {}) {
  const pilha = pilhaTop === null ? null : { getBoundingClientRect: () => ({ top: pilhaTop, height: altura - pilhaTop }) };
  const deps = {
    document: { getElementById: (id) => (id === 'notifyStack' ? pilha : null), querySelector: (s) => (s === 'header' ? { getBoundingClientRect: () => ({ bottom: 69 }) } : null) },
    innerHeight: altura, innerWidth: largura,
    DEV_FAB_RESERVA_TOAST: constanteBruta('DEV_FAB_RESERVA_TOAST'), DEV_FAB_FOLGA_TOAST: constanteBruta('DEV_FAB_FOLGA_TOAST'), DEV_FAB_MARGEM: constanteBruta('DEV_FAB_MARGEM'),
  };
  const n = Object.keys(deps);
  return new Function(...n, fatiar('devFabReservaDeBaixo') + '\n' + fatiar('devFabCoords') + '\nreturn { reserva: devFabReservaDeBaixo, coords: devFabCoords };')(...n.map((k) => deps[k]));
}

test('R21-4-06: a reserva de baixo é a altura MEDIDA da pilha de avisos (+ o vão), com o piso de sempre — 2 toasts, ou um de duas linhas com o texto maior, não cobrem mais o FAB', () => {
  const piso = constanteBruta('DEV_FAB_RESERVA_TOAST'), folga = constanteBruta('DEV_FAB_FOLGA_TOAST');
  // Sem pilha / sem aviso / um toast curto: o piso — o FAB fica onde sempre ficou.
  assert.equal(telaDoFab().reserva(), piso);
  assert.equal(telaDoFab({ pilhaTop: 740 }).reserva(), piso, 'a pilha vazia (altura 0) mudou a reserva');
  const umCurto = telaDoFab({ pilhaTop: 676 });
  assert.equal(umCurto.reserva(), piso, 'DEFEITO: um toast curto mexeu o FAB de onde ele sempre ficou');
  assert.equal(umCurto.coords('baixo-dir', FAB, FAB).y, 740 - FAB - piso);
  // Os casos MEDIDOS (360×740): 2 toasts → pilha em 600; 1,5× com um toast de 2 linhas → 584; 3 toasts → 544.
  for (const [rotulo, topo] of [['2 toasts', 600], ['1 toast de 2 linhas a 1,5×', 584], ['3 toasts', 544]]) {
    const t = telaDoFab({ pilhaTop: topo });
    const y = t.coords('baixo-dir', FAB, FAB).y;
    assert.equal(t.reserva(), 740 - topo + folga, `${rotulo}: a reserva não é a altura da pilha + o vão`);
    assert.ok(y + FAB + folga <= topo, `DEFEITO (${rotulo}): o FAB (${y}–${y + FAB}) invade a pilha de avisos (começa em ${topo}) e o toast engole o toque`);
  }
  // CONTROLE do instrumento: com a reserva FIXA (o código de antes) os casos acima se cobrem — a medida enxerga o defeito.
  const velho = telaDoFab({ pilhaTop: 600 });
  const yVelho = 740 - FAB - piso;
  assert.ok(yVelho + FAB > 600, 'CONTROLE: a reserva fixa já não cobre o FAB nos 360×740 com 2 toasts — o cenário não exercita o defeito');
  assert.ok(velho.coords('baixo-dir', FAB, FAB).y < yVelho);
  // Os cantos de cima e do meio não dependem da pilha.
  const cima = telaDoFab({ pilhaTop: 544 }).coords('cima-dir', FAB, FAB).y;
  assert.equal(cima, telaDoFab().coords('cima-dir', FAB, FAB).y);
  // Nunca sobe acima do topo (uma pilha altíssima): o limite é o cabeçalho.
  assert.equal(telaDoFab({ pilhaTop: 40 }).coords('baixo-dir', FAB, FAB).y, 69 + 8);
  // Pilha que falha ao medir: vale o piso, sem lançar.
  const quebrada = telaDoFab({ pilhaTop: 600 });
  const deps = { document: { getElementById: () => ({ getBoundingClientRect: () => { throw new Error('x'); } }) }, innerHeight: 740, DEV_FAB_RESERVA_TOAST: piso, DEV_FAB_FOLGA_TOAST: folga };
  const n = Object.keys(deps);
  assert.equal(new Function(...n, fatiar('devFabReservaDeBaixo') + '\nreturn devFabReservaDeBaixo;')(...n.map((k) => deps[k]))(), piso);
  assert.ok(quebrada);
});

test('R21-4-06: a pilha de avisos é OBSERVADA, e o callback só AGENDA (gotcha #35) — o reposicionamento é um por quadro, só do FAB de baixo, visível e fora de gesto', () => {
  const montar = ({ canto = 'baixo-dir', escondido = false, comPilha = true, comObserver = true } = {}) => {
    const log = { posicionou: 0, quadros: [], observadores: [] };
    class RO { constructor(cb) { this.cb = cb; log.observadores.push(this); } observe(e) { this.alvo = e; } }
    const fab = { classList: { contains: (c) => c === 'hidden' && escondido }, dataset: { canto } };
    const deps = { document: { getElementById: (id) => (id === 'notifyStack' ? (comPilha ? {} : null) : id === 'devFab' ? fab : null) },
      ResizeObserver: comObserver ? RO : undefined, requestAnimationFrame: (f) => { log.quadros.push(f); }, posicionarFabDev: () => { log.posicionou++; } };
    const n = Object.keys(deps);
    const fn = new Function(...n, fatiar('acompanharAReservaDoFab') + '\nreturn acompanharAReservaDoFab;')(...n.map((k) => deps[k]));
    return { fn, log };
  };
  const a = montar(); a.fn();
  assert.equal(a.log.observadores.length, 1, 'a pilha de avisos não é observada');
  assert.ok(a.log.observadores[0].alvo, 'o observador não observa nada');
  // Três avisos no mesmo quadro: UM agendamento, e NADA escrito dentro do callback.
  a.log.observadores[0].cb(); a.log.observadores[0].cb(); a.log.observadores[0].cb();
  assert.equal(a.log.posicionou, 0, 'DEFEITO: o callback do ResizeObserver reposiciona na hora (re-entra no mesmo quadro, o aviso vira toast vermelho — gotcha #35)');
  assert.equal(a.log.quadros.length, 1, 'três mudanças no mesmo quadro agendaram mais de um reposicionamento');
  a.log.quadros[0]();
  assert.equal(a.log.posicionou, 1, 'o quadro seguinte não reposicionou o FAB de baixo');
  a.log.observadores[0].cb(); a.log.quadros[1]();
  assert.equal(a.log.posicionou, 2, 'o agendamento ficou travado depois do primeiro (o próximo aviso não reposiciona)');
  // Os outros estados NÃO reposicionam.
  for (const [rotulo, opt] of [['FAB no canto de cima', { canto: 'cima-dir' }], ['FAB no meio', { canto: 'meio-esq' }], ['FAB escondido', { escondido: true }]]) {
    const o = montar(opt); o.fn(); o.log.observadores[0].cb(); o.log.quadros[0]();
    assert.equal(o.log.posicionou, 0, `CONTROLE: reposicionou com o ${rotulo}`);
  }
  // Sem a pilha ou sem ResizeObserver: nada observado e nada lançado.
  assert.equal(montar({ comPilha: false }).log.observadores.length, 0);
  const sem = montar({ comObserver: false }); assert.doesNotThrow(() => sem.fn());
  // E o botão liga a observação uma vez, ao nascer.
  assert.match(fatiar('ligarFabDev'), /\bacompanharAReservaDoFab\(\);/, 'DEFEITO: o FAB nasce sem acompanhar a pilha de avisos');
});

// ═══ R21-4-04 · a sentinela da barra ✕ ↑ ✓ cortada ou fora da janela ═════════════════════════════════
function sentinelas() {
  return new Function(['diagMapaForaDaCaixa', 'diagAlvoPequeno', 'diagSentinelas'].map((n) => fatiar(n)).join('\n') + '\nreturn diagSentinelas;')();
}
const botao = (sel, y, h = 48, extra = {}) => ({ sel, x: 20, y, w: 56, h, noCentro: 'ele mesmo', camadaAberta: false, naCamada: false, ...extra });
const telaSa = ({ innerH = 740, cartaoY = 80, cartaoH = 600, botoesY = 616, h = 48, frente = {}, botoes = {} } = {}) => ({
  janela: { innerW: 360, innerH },
  varsCss: { '--kb-inset': '0px', '--header-h': '69px' },
  foco: { tag: 'BUTTON', id: 'x', emModal: false, abreTeclado: false },
  tema: { htmlClasse: 'dark', guardado: 'dark' },
  geometria: [
    { sel: '.place-card:not(.card-fundo)', x: 12, y: cartaoY, w: 336, h: cartaoH, noCentro: 'ele mesmo', camadaAberta: false, naCamada: false, ...frente },
    botao('.card-btn-reject', botoesY, h, botoes), botao('.card-btn-skip', botoesY, h, botoes), botao('.card-btn-read', botoesY, h, botoes),
  ],
});
const chavesDe = (r) => r.map((a) => a.chave).sort();

test('R21-4-04: a barra ✕ ↑ ✓ FORA DA JANELA ou CORTADA pelo cartão dispara `barraDeAcoesForaDaTela`; a barra sã, não — e o Fold a 2× (números medidos) alerta', () => {
  const diag = sentinelas();
  assert.deepEqual(diag(telaSa()), [], 'CONTROLE: a tela sã gerou alerta');
  // Fora da janela (o botão acaba em 764 numa janela de 740), com o cartão acabando depois dela.
  const fora = diag(telaSa({ botoesY: 716, cartaoH: 700 }));
  assert.deepEqual(chavesDe(fora), ['barraDeAcoesForaDaTela'], 'DEFEITO: a barra fora da janela não alerta (a pessoa não decide nada e o arquivo dizia `alertas: []`)');
  assert.deepEqual(fora[0].cortadaPor, ['janela']);
  assert.equal(fora[0].botoesAte, 764);
  assert.equal(fora[0].janelaAte, 740);
  // Dentro da janela mas CORTADA pelo cartão (o cartão acaba em 650; a barra em 690, a janela em 740).
  const cortada = diag(telaSa({ cartaoH: 570, botoesY: 640 }));
  assert.deepEqual(chavesDe(cortada), ['barraDeAcoesForaDaTela'], 'a barra cortada pelo cartão não alerta');
  assert.deepEqual(cortada[0].cortadaPor, ['cartão']);
  // O caso REAL medido no Galaxy Fold a 2× (280×653): o cartão acaba em 638 e os botões em 680.
  const fold = diag({ ...telaSa({ innerH: 653, cartaoY: 70, cartaoH: 568, botoesY: 632 }), janela: { innerW: 280, innerH: 653 } });
  assert.deepEqual(chavesDe(fold), ['barraDeAcoesForaDaTela'], 'o Fold a 2× (limitação conhecida) é um verdadeiro positivo e precisa alertar');
  assert.equal(fold[0].botoesAte, 680);
  assert.deepEqual(fold[0].cortadaPor, ['janela', 'cartão']);
  // A tolerância é a do arredondamento (2 px) dos dois lados: a barra sã termina bem antes do fim do cartão.
  assert.deepEqual(diag(telaSa({ cartaoY: 80, cartaoH: 584, botoesY: 616, h: 50 })), [], 'a tolerância de 2 px (cartão) virou alerta');
  assert.deepEqual(chavesDe(diag(telaSa({ cartaoY: 80, cartaoH: 584, botoesY: 616, h: 51 }))), ['barraDeAcoesForaDaTela'], '3 px além do cartão deixou de alertar');
  assert.deepEqual(diag(telaSa({ innerH: 666, cartaoH: 600, botoesY: 616, h: 52 })), [], 'a tolerância de 2 px (janela) virou alerta (a barra acaba 2 px além da janela)');
  assert.deepEqual(chavesDe(diag(telaSa({ innerH: 666, cartaoH: 600, botoesY: 616, h: 53 }))), ['barraDeAcoesForaDaTela'], '3 px além da janela deixou de alertar');
});

test('R21-4-04: a sentinela CALA onde a barra não está parada — card sob gesto, teclado aberto, sem o card da frente, sem a janela, card de fundo — e NÃO cala com modal aberto nem com os botões desabilitados', () => {
  const diag = sentinelas();
  const defeito = { botoesY: 716, cartaoH: 700 };
  assert.deepEqual(chavesDe(diag(telaSa(defeito))), ['barraDeAcoesForaDaTela'], 'PRÉ-CONDIÇÃO: o defeito base não alerta');
  assert.deepEqual(diag(telaSa({ ...defeito, frente: { sobGesto: true } })), [], 'DEFEITO: alertou com o card sob um GESTO (os retângulos são os do card deslocado)');
  const teclado = telaSa(defeito); teclado.varsCss['--kb-inset'] = '300px'; teclado.foco = { tag: 'INPUT', id: 'q', emModal: true, abreTeclado: true };
  assert.deepEqual(diag(teclado), [], 'alertou com o teclado aberto (a janela encolhe de verdade)');
  const campo = telaSa(defeito); campo.foco = { tag: 'INPUT', id: 'q', emModal: true, abreTeclado: true };
  assert.deepEqual(diag(campo), [], 'alertou com um campo de texto focado');
  const semFrente = telaSa(defeito); semFrente.geometria.shift();
  assert.deepEqual(diag(semFrente), [], 'alertou sem o card da frente');
  const semJanela = telaSa(defeito); semJanela.janela = {};
  assert.deepEqual(diag(semJanela), [], 'alertou sem a altura da janela');
  const soFundo = telaSa({ botoesY: 590 });
  soFundo.geometria.push(botao('.card-btn-read', 716, 48, { noFundo: true }));
  assert.deepEqual(diag(soFundo), [], 'alertou pelos botões do card de FUNDO (a pilha os esconde de propósito)');
  // NÃO cala: camada aberta (o relatório sai com os Filtros abertos) e botões desabilitados (a janela do Desfazer).
  const modal = telaSa(defeito); for (const g of modal.geometria) { g.camadaAberta = true; g.naCamada = false; }
  assert.deepEqual(chavesDe(diag(modal)), ['barraDeAcoesForaDaTela'], 'DEFEITO: a camada aberta calou a sentinela — o relatório costuma sair com os Filtros abertos');
  const desab = telaSa(defeito); for (const g of desab.geometria.slice(1)) g.desab = true;
  assert.deepEqual(chavesDe(diag(desab)), ['barraDeAcoesForaDaTela'], 'os botões desabilitados calaram a sentinela');
});

test('R21-4-04 (fonte): `sobGesto` vem do sinal POSITIVO do swipe (nunca do `style.transform`), e o card da frente é o único que o leva', () => {
  const g = fatiar('diagGeometria');
  assert.match(g, /cardSobGesto\(e\)/, 'a geometria não pergunta ao swipe se há gesto no card');
  assert.doesNotMatch(g, /style\.transform/, 'a geometria lê o `style.transform` (a volta pro lugar o deixa escrito)');
  assert.match(g, /classList\.contains\('place-card'\) && !e\.classList\.contains\('card-fundo'\) && cardSobGesto\(e\)\s*\n?\s*\? \{ sobGesto: true \} : \{\}/, 'o `sobGesto` não é restrito ao card da frente, ou não é posto na geometria');
  assert.match(MIN, /barraDeAcoesForaDaTela/, 'js/min/app.js sem a sentinela (rode `npm run js`)');
});

// ═══ R21-4-03 · a ESCALA do texto no relatório, na triagem e na remontagem ═══════════════════════════
function escalaCom({ raiz = '24px', ajuste = '100%', remPx = 24, pxPx = 16, lanca = false }) {
  const log = { removeu: 0, anexou: 0 };
  const el = () => {
    const e = { style: { cssText: '' }, children: [], parentNode: null, appendChild(c) { this.children.push(c); },
      getBoundingClientRect() {
        if (lanca) throw new Error('sem layout');
        return { height: /height:\s*1rem/.test(this.style.cssText) ? remPx : /height:\s*16px/.test(this.style.cssText) ? pxPx : 0 };
      } };
    return e;
  };
  const document = { createElement: () => el(), body: { appendChild(e) { log.anexou++; e.parentNode = { removeChild: () => { log.removeu++; } }; } } };
  const cs = { fontSize: raiz, getPropertyValue: (p) => (p === '-webkit-text-size-adjust' ? ajuste : '') };
  const fn = new Function('document', fatiar('diagEscalaDoTexto') + '\nreturn diagEscalaDoTexto;')(document);
  return { r: fn(cs), log };
}

test('R21-4-03: `diagEscalaDoTexto` lê a raiz, o `text-size-adjust` e a caixa RENDERIZADA de 1rem contra a de 16px — e tira a sonda do DOM, sem lançar', () => {
  const { r, log } = escalaCom({});
  assert.deepEqual(r, { raizPx: 24, ajuste: '100%', caixaRem: 24, caixaPx: 16 }, 'DEFEITO: o relatório não traz a escala do texto (a raiz, o ajuste e a prova da caixa)');
  assert.equal(log.anexou, 1);
  assert.equal(log.removeu, 1, 'a sonda ficou no DOM');
  // CONTROLE: a escala normal.
  assert.deepEqual(escalaCom({ raiz: '16px', remPx: 16 }).r, { raizPx: 16, ajuste: '100%', caixaRem: 16, caixaPx: 16 });
  // A raiz mente: a caixa renderizada de 1rem diz a escala que o layout viu.
  assert.equal(escalaCom({ raiz: '16px', remPx: 20 }).r.caixaRem, 20);
  // Sem layout (o `getBoundingClientRect` lança): campos nulos, nunca lança, e a sonda sai.
  const quebrada = escalaCom({ lanca: true });
  assert.deepEqual(quebrada.r, { raizPx: 24, ajuste: '100%', caixaRem: null, caixaPx: null });
  assert.equal(quebrada.log.removeu, 1, 'a sonda ficou no DOM depois do erro');
  // O que não se leu sai nulo (não 0, não NaN).
  const vazio = escalaCom({ raiz: '', ajuste: '' });
  assert.equal(vazio.r.raizPx, null);
  assert.equal(vazio.r.ajuste, null);
});

test('R21-4-03 (fonte): a escala sai do `computado` (aditivo, sem subir o `DIAG_VERSAO`), pelo computado da raiz', () => {
  assert.match(fatiar('diagComputado'), /fora\.escala = diagEscalaDoTexto\(cs\);/, 'o `computado` não leva a escala');
  assert.match(fatiar('diagComputado'), /const cs = getComputedStyle\(document\.documentElement\);[\s\S]*?diagEscalaDoTexto\(cs\)/, 'a escala não vem do computado da RAIZ');
  assert.match(MIN, /diagEscalaDoTexto/, 'js/min/app.js sem a escala (rode `npm run js`)');
});

function triagem(rel) {
  const base = { _versaoDoDiag: 11, _gerado: '2026-10-14T23:00:00.000Z', app: { versao: '2026101405', rotulo: '2026.10.14-05' },
    ambiente: { ua: 'x', online: true, fuso: 'America/Sao_Paulo', tela: { w: 390, h: 844, dpr: 3, janela: '390x844' } },
    resumo: { momentos: 0, chamadas: 0, falhas: 0, errosDeJs: 0, rede: true, offline: 'pronto',
      telaAgora: { tela: 'app', painel: 'card', cardMontado: true, modais: [], lightbox: false }, alertas: [] },
    diario: [], chamadas: [], momentos: [], erros: [], localStorage: {} };
  const dir = mkdtempSync(join(tmpdir(), 'diag-r21-'));
  const arq = join(dir, 'd.json');
  writeFileSync(arq, JSON.stringify({ ...base, ...rel }));
  return execFileSync(process.execPath, [new URL('../tools/diag-resumo.mjs', import.meta.url).pathname, arq], { encoding: 'utf8', timeout: 20000 });
}
const secaoOffline = (s) => { const i = s.indexOf('── OFFLINE'); return s.slice(i, s.indexOf('\n──', i + 5)); };
const OFFLINE_BASE = () => ({ ligado: true, janelaServida: 1492385, janelaAtual: 1492385, resultado: 'pronto', varrendo: false,
  filaGravadaEm: 1000, filaPreparada: null, filaVarrida: 1000, cobreAFila: false, precisaVarrer: false,
  filaGuardada: { n: 4, idadeMin: 3, carimboMin: 3, t: 1000, soNestaAba: 0, soNaGuardada: 0 }, janelaGuardada: null, filaCobertaGuardada: null,
  tilesNoCache: 3, tilesGuardadosQueFalharam: 0, pousosGravados: 0 });
const computadoCom = (escala) => ({ janela: { innerW: 390, innerH: 844 }, geometria: [], ...(escala === undefined ? {} : { escala }) });

test('R21-4-03: a triagem diz "texto ×N" quando a raiz e a caixa de 1rem concordam e N ≠ 1 — e ATENÇÃO quando discordam; a escala normal e o relatório antigo não ganham linha', () => {
  const linhaTexto = (s) => s.split('\n').filter((l) => /texto ×|text-size|ATENÇÃO: texto/.test(l)).join('\n');
  const grande = triagem({ computado: computadoCom({ raizPx: 24, ajuste: '100%', caixaRem: 24, caixaPx: 16 }) });
  assert.match(linhaTexto(grande), /texto ×1,5: a raiz está em 24 px \(a normal é 16\) e a caixa de 1rem mediu 24 px contra 16 px da de 16px/, `DEFEITO: o texto grande não é dito:\n${linhaTexto(grande)}`);
  assert.doesNotMatch(linhaTexto(grande), /ATENÇÃO/);
  // A raiz diz 1,5× e a caixa não: o layout não recebeu a escala que a raiz afirma.
  const discorda = triagem({ computado: computadoCom({ raizPx: 24, ajuste: '100%', caixaRem: 16, caixaPx: 16 }) });
  assert.match(linhaTexto(discorda), /ATENÇÃO: texto ×1,5 pela raiz \(24 px\), mas a caixa de 1rem mediu ×1 \(16 px contra 16 px\)/, linhaTexto(discorda));
  // A raiz diz 1× e a caixa de 1rem diz outra coisa.
  const raizMente = triagem({ computado: computadoCom({ raizPx: 16, ajuste: '100%', caixaRem: 20, caixaPx: 16 }) });
  assert.match(linhaTexto(raizMente), /ATENÇÃO: texto ×1 pela raiz \(16 px\), mas a caixa de 1rem mediu ×1,25/, linhaTexto(raizMente));
  // Sem a prova da caixa (sonda que não mediu): a raiz sozinha não afirma que o layout a viu.
  const semCaixa = triagem({ computado: computadoCom({ raizPx: 24, ajuste: null, caixaRem: null, caixaPx: null }) });
  assert.match(linhaTexto(semCaixa), /ATENÇÃO: texto ×1,5 pela raiz \(24 px\), mas a caixa de 1rem não foi medida/, linhaTexto(semCaixa));
  // O text-size-adjust diferente do padrão entra na linha.
  const adjust = triagem({ computado: computadoCom({ raizPx: 24, ajuste: '120%', caixaRem: 24, caixaPx: 16 }) });
  assert.match(linhaTexto(adjust), /text-size-adjust 120%/);
  // CONTROLES: a escala normal e o relatório de ANTES do campo não dizem nada — a saída é IDÊNTICA à do relatório antigo
  // (nenhuma linha a mais), e a linha de texto nunca leva lixo.
  const antigo = triagem({ computado: computadoCom() });
  assert.equal(linhaTexto(antigo), '');
  for (const [rotulo, rel] of [['escala normal', computadoCom({ raizPx: 16, ajuste: '100%', caixaRem: 16, caixaPx: 16 })],
    ['campo todo nulo', computadoCom({ raizPx: null, ajuste: null, caixaRem: null, caixaPx: null })]]) {
    assert.equal(triagem({ computado: rel }), antigo, `CONTROLE (${rotulo}): a triagem mudou`);
  }
  for (const linha of [grande, discorda, raizMente, semCaixa, adjust].map(linhaTexto)) {
    assert.doesNotMatch(linha, /undefined|NaN|\[object/, `lixo na linha de texto: ${linha}`);
  }
});

test('R21-4-03: `diag-tela` e `diag-replay` remontam com a RAIZ do aparelho (a letra grande), só entre 8 e 96 px, e o relatório antigo segue com a de 16 px', () => {
  const tela = new Function(fatiar('escalaDaTela', semComentario(DIAG_TELA), 0) + '\nreturn escalaDaTela;')();
  const comRaiz = (px) => ({ computado: { escala: { raizPx: px } } });
  assert.equal(tela(comRaiz(16), comRaiz(24)), 24, 'a captura (o instante dela) não vale mais que o relatório');
  assert.equal(tela(comRaiz(24), {}), 24, 'sem a escala da captura vale a do relatório');
  assert.equal(tela({}, {}), null, 'relatório antigo: nenhuma escala');
  for (const ruim of [7, 97, NaN, '24', null, undefined, Infinity, -16]) assert.equal(tela(comRaiz(ruim), {}), null, `raiz ${String(ruim)} entrou num estilo`);
  assert.equal(tela(comRaiz(8), {}), 8);
  assert.equal(tela(comRaiz(96), {}), 96);
  const replay = new Function(fatiar('escalaDoRelatorio', semComentario(DIAG_REPLAY), 0) + '\nreturn escalaDoRelatorio;')();
  assert.equal(replay(comRaiz(24)), 24);
  assert.equal(replay(comRaiz(16)), null, 'a raiz normal é "nenhuma escala"');
  assert.equal(replay({}), null);
  for (const ruim of [7, 97, NaN, '24', null]) assert.equal(replay(comRaiz(ruim)), null, `raiz ${String(ruim)} chegou à página`);
  // Estrutura: o estilo entra DEPOIS do CSS do app (o mesmo seletor, o último ganha) e só se ≠ 16; o replay aplica antes de desenhar.
  const t = semComentario(DIAG_TELA);
  assert.match(t, /raizPx !== null && raizPx !== 16 \? `<style>html\{font-size:\$\{raizPx\}px\}<\/style>` : ''/, 'a remontagem não injeta a raiz do aparelho');
  assert.ok(t.indexOf('<style>${css}</style>${escala}') > 0, 'a raiz não vem logo depois do CSS do app');
  const r = semComentario(DIAG_REPLAY);
  assert.match(r, /if \(raizPx\) document\.documentElement\.style\.fontSize = raizPx \+ 'px';/, 'o replay não aplica a raiz');
  assert.ok(r.indexOf("document.documentElement.style.fontSize = raizPx") < r.indexOf('showCurrentPlace();'), 'a raiz é aplicada DEPOIS de o card ser desenhado');
});

// ═══ R21-4-09 · a triagem do offline cita a leitura que falhou, e só aponta "outra aba" se esta LEU a base ═══
test('R21-4-09: a triagem cita `offline.leituraFalhou` (quantas vezes, com as repetições que o limitador juntou, e a última hora) e diz que a causa é a leitura, não outra aba', () => {
  const s = secaoOffline(triagem({ offline: OFFLINE_BASE(), diario: [
    { t: Date.UTC(2026, 9, 14, 15, 0, 0), k: 'offline.leituraFalhou', causa: 'leitura' },
    { t: Date.UTC(2026, 9, 14, 15, 5, 0), k: 'offline.leituraFalhou', causa: 'leitura', juntas: 2 }] }));
  assert.match(s, /ATENÇÃO: a leitura da fila guardada FALHOU 4 vez\(es\) na reabertura sem rede \(2 registrada\(s\), \+2 que o app juntou\)/, `DEFEITO: a leitura que falhou na reabertura não é dita:\n${s}`);
  assert.match(s, /`offline\.leituraFalhou`/, 'a frase não aponta o registro do diário');
  assert.match(s, /a causa é a leitura da base, não outra aba/);
  // Uma só linha, sem repetição: a frase não inventa "juntas".
  const uma = secaoOffline(triagem({ offline: OFFLINE_BASE(), diario: [{ t: Date.UTC(2026, 9, 14, 15, 0, 0), k: 'offline.leituraFalhou' }] }));
  assert.match(uma, /FALHOU 1 vez\(es\) na reabertura sem rede \(a última às /);
  assert.doesNotMatch(uma, /registrada\(s\)/);
  // CONTROLES: sem o evento, nenhuma linha; com o offline desligado, a seção nem fala dele.
  const sem = secaoOffline(triagem({ offline: OFFLINE_BASE(), diario: [] }));
  assert.doesNotMatch(sem, /leituraFalhou|na reabertura sem rede/, 'CONTROLE: sem o evento a seção cita a leitura que falhou');
  const desligado = triagem({ offline: { ligado: false }, diario: [{ t: 1, k: 'offline.leituraFalhou' }] });
  assert.doesNotMatch(desligado, /na reabertura sem rede/, 'CONTROLE: o offline desligado ganhou a frase');
});

test('R21-4-09: "a fila guardada é OUTRA" só sai se esta aba CHEGOU A LER (ou gravar) a base — sem o carimbo dela, a nota diz que não dá pra afirmar; o relatório antigo e a aba que leu seguem como sempre', () => {
  const comOutra = (extra) => secaoOffline(triagem({ offline: { ...OFFLINE_BASE(), cobreAFila: false, ...extra,
    filaGuardada: { n: 3, idadeMin: 0, carimboMin: 0, t: 5000, soNestaAba: 0, soNaGuardada: 3 } } }));
  const naoLeu = comOutra({ filaGravadaEm: null });
  assert.doesNotMatch(naoLeu, /a fila guardada é OUTRA/, `DEFEITO: a aba que não leu a base foi mandada procurar uma segunda aba:\n${naoLeu}`);
  assert.match(naoLeu, /esta aba não conhece o carimbo da fila guardada \(não leu a base nem gravou nela\)/);
  assert.match(naoLeu, /veja a leitura que falhou, acima, quando houver/);
  // CONTROLE: a aba que leu/gravou (carimbo conhecido) tem a nota de sempre.
  const leu = comOutra({ filaGravadaEm: 1000 });
  assert.match(leu, /nota: a fila guardada é OUTRA — esta aba tem 0 pedido\(s\) que ela não tem, e ela tem 3 que esta aba não tem/, leu);
  assert.doesNotMatch(leu, /não conhece o carimbo/);
  // CONTROLE: o relatório de ANTES do campo (`filaGravadaEm` ausente) não é "desconhecido": segue a nota de sempre.
  const { filaGravadaEm, ...semCampo } = OFFLINE_BASE();
  const antigo = secaoOffline(triagem({ offline: { ...semCampo, cobreAFila: false, filaGuardada: { n: 3, idadeMin: 0, carimboMin: 0, t: 5000, soNestaAba: 0, soNaGuardada: 3 } } }));
  assert.match(antigo, /a fila guardada é OUTRA/, 'CONTROLE: o relatório antigo perdeu a nota de sempre');
  assert.doesNotMatch(antigo, /não conhece o carimbo/);
});

test('R21-4-01/09: a base do diagnóstico que não respondeu entra na lista das leituras LOCAIS — a triagem diz "o navegador não respondeu (não é a rede)"', () => {
  const s = triagem({ coleta: { ms: 10200, orcamentoMs: 10000, semResposta: ['base do diagnóstico'] } });
  assert.match(s, /ATENÇÃO: 1 leitura\(s\) LOCAL\(IS\) do navegador sem resposta no orçamento — o navegador não respondeu \(não é a rede\): .*base do diagnóstico/, s);
  assert.doesNotMatch(s, /rede pendurada na hora do relatório/, 'a base do diagnóstico foi dita como REDE pendurada');
});
