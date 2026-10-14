// Rodada 18 da auditoria (2026-10-14), a parte do OFFLINE, do DIAGNÓSTICO e do FAB — o lote 22.
// Os roteiros do auditor (r18-4) medidos no navegador; aqui, os mesmos cenários sobre o código de
// verdade, fatiado do app.js. Cada teste tem o CONTROLE que dá o resultado oposto e foi visto
// REPROVANDO com o conserto desfeito (sabotagem no relatório do lote 22).
//
//  · R18-4-01/03 — o relatório aguardava as leituras locais ANTES de lançar a de rede: uma leitura
//    local pendurada comia o orçamento e a rede saudável saía "sem resposta" em tudo;
//  · R18-4-02/04 — o resumo separa local de rede, trata a seção do offline que estourou o prazo e
//    diz a pausa da varredura;
//  · R18-4-05 — a gravação da fila na base que falha deixa rastro e a varredura não fecha "pronto";
//  · R18-4-06 — todos os tiles negados com 4xx e nenhum no cache não é "pronto";
//  · R18-4-07 — o botão direito e o do meio do mouse não tocam nem pegam o FAB.
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
const constanteBruta = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function(`return (${m[1]});`)();
};
const tique = (ms = 1) => new Promise((ok) => setTimeout(ok, ms));
const nunca = () => new Promise(() => {});

// ═══ R18-4-01 / R18-4-03 · o relatório lança a rede e as leituras tardias ANTES de esperar as locais ═══
// O `diagCorpo` DE VERDADE, até o ponto em que a parte de rede termina (`await redePromessa;`):
// o corte é feito no fonte, e o resto da função (o arquivo em si) fica de fora. A rede é um
// `fetch` de mentira que responde na hora; as leituras locais penduram quando o teste manda.
function diagCorpoAteARede({ pendurar = [], redePendurada = false, orcamentoMs = 150 }) {
  const ini = APP_SEM.indexOf('async function diagCorpo(');
  const fim = APP_SEM.indexOf('    const armazenamento = { quota: null', ini);
  assert.ok(ini > 0 && fim > ini, 'o corte do diagCorpo não achou os marcadores (o instrumento quebrou)');
  const corte = APP_SEM.slice(ini, fim);
  assert.match(corte, /await redePromessa;/, 'o corte não inclui a espera da parte de rede');
  const URL_BASE = 'https://x.dev';
  const corpoDe = (u) => 'conteudo de ' + u.replace(/[?&]diag-rede=1/, '');
  const fetchFalso = (url, opts = {}) => new Promise((ok, erro) => {
    const aoAbortar = () => { const e = new Error('abortado'); e.name = 'AbortError'; erro(e); };
    if (opts.signal) { if (opts.signal.aborted) return aoAbortar(); opts.signal.addEventListener('abort', aoAbortar); }
    if (redePendurada) return;
    ok({ ok: true, status: 200, headers: { get: (h) => (h === 'date' ? 'Wed, 14 Oct 2026 12:00:00 GMT' : null) }, text: async () => corpoDe(url) });
  });
  const hangs = new Set(pendurar);
  const deps = {
    location: { origin: URL_BASE, href: URL_BASE + '/' },
    DIAG_ORCAMENTO_MS: orcamentoMs, DIAG_PISO_LOCAL_MS: 20, DIAG_FETCH_TETO_MS: 4000,
    diagAtualizarAnteriores: async () => false, diagAberturasVivas: async () => [],
    diagRecursosDaSessao: () => [], diagUrlsDoDocumento: () => [],
    diagUrlsDoCodigo: () => [URL_BASE + '/', URL_BASE + '/js/min/app.js', URL_BASE + '/css/app.css'],
    diagSemInjecaoDaBorda: (t) => t,
    diagServiceWorker: () => Promise.resolve(null),
    diagOffline: () => (hangs.has('offline') ? nunca() : Promise.resolve({ ligado: false })),
    localStorage: { length: 0 }, sessionStorage: { length: 0 },
    navigator: {
      serviceWorker: { getRegistrations: () => (hangs.has('sw') ? nunca() : Promise.resolve([])), controller: null },
      storage: { estimate: () => (hangs.has('estimate') ? nunca() : Promise.resolve({ quota: 1, usage: 0 })), persisted: async () => true },
    },
    caches: { keys: () => (hangs.has('caches') ? nunca() : Promise.resolve([])) },
    indexedDB: { databases: () => (hangs.has('idb') ? nunca() : Promise.resolve([])) },
    crypto: globalThis.crypto, TextEncoder, URL,
    fetch: fetchFalso, AbortController, setTimeout, clearTimeout, Date, Promise,
    // O `AbortSignal.timeout` do Node não segura o processo (o temporizador é `unref`): a rede pendurada
    // deixava o laço de eventos esvaziar com o teste ainda esperando. Aqui o temporizador é de verdade.
    AbortSignal: { timeout: (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; } },
  };
  const chaves = Object.keys(deps);
  const fonte = [
    ...['comPrazo', 'diagFalhaDaLeitura', 'diagFetch', 'diagCodigoEnxuto'].map(fatiar),
    corte.replace('async function diagCorpo(', 'async function diagCorpoAteARede(')
      + `\n    return { codigo, cacheVsRede, semRespostaLocal, relogio: await relogioPromessa };\n}`,
    'return diagCorpoAteARede;',
  ].join('\n');
  const f = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  return f;
}
const resumoDaRede = (r) => ({
  hash: Object.values(r.codigo).map((v) => !!(v && v.hash)),
  cvr: Object.values(r.cacheVsRede).map((v) => (v.igual === true ? 'igual' : v.semResposta ? 'semResposta' : v.erro || 'outro')),
  relogio: r.relogio.servidor ? 'ok' : (r.relogio.erro || 'sem'),
});

test('R18-4-01: UMA leitura local pendurada (registros do worker, ou caches) NÃO tira a comparação com o servidor — a rede saudável sai inteira', async () => {
  for (const que of ['sw', 'caches']) {
    const r = await diagCorpoAteARede({ pendurar: [que] })();
    const x = resumoDaRede(r);
    assert.deepEqual(x.cvr, ['igual', 'igual', 'igual'],
      `DEFEITO (${que}): a leitura local pendurada comeu o orçamento e a rede saudável saiu "${x.cvr.join(', ')}" — a comparação "o aparelho roda o código do servidor?" se perdeu`);
    assert.deepEqual(x.hash, [true, true, true], `(${que}) o código do aparelho não foi lido`);
    assert.equal(x.relogio, 'ok', `(${que}) o relógio do servidor saiu "${x.relogio}"`);
  }
});

test('R18-4-01: CONTROLES — sem nada pendurado sai igual; com a REDE pendurada o instrumento enxerga o "sem resposta"; a leitura local pendurada é anotada à parte', async () => {
  const boa = await diagCorpoAteARede({})();
  assert.deepEqual(resumoDaRede(boa).cvr, ['igual', 'igual', 'igual'], 'CONTROLE: o caso saudável deixou de ser igual');
  assert.deepEqual(boa.semRespostaLocal, []);
  const redeMorta = await diagCorpoAteARede({ redePendurada: true })();
  assert.ok(Object.values(redeMorta.codigo).every((v) => v.semResposta === true),
    'CONTROLE: com a rede pendurada o código deveria sair "sem resposta" (o instrumento ficou cego)');
  assert.equal(resumoDaRede(redeMorta).relogio, 'sem resposta');
  const sw = await diagCorpoAteARede({ pendurar: ['sw'] })();
  assert.deepEqual(sw.semRespostaLocal, ['service worker (registros)'],
    'a leitura local pendurada não foi anotada (ou arrastou a de rede junto)');
});

test('R18-4-03: o piso das leituras tardias (indexedDB.databases, seção do offline) corre JUNTO do orçamento — não depois dele, em série', async () => {
  // O corte do teste termina na rede; as duas leituras já foram LANÇADAS, e vencem no prazo do
  // orçamento (150 ms aqui), não 2 s / 6 s depois. Antes do conserto elas nem eram lançadas aqui.
  const r = diagCorpoAteARede({ pendurar: ['idb', 'offline'], orcamentoMs: 120 });
  const t0 = Date.now();
  const x = await r();
  await tique(200 - Math.min(150, Date.now() - t0));
  assert.deepEqual([...x.semRespostaLocal].sort(), ['indexedDB.databases', 'offline (base e cache do mapa)'],
    'DEFEITO: as leituras tardias só começam depois das esperas locais — o pior caso soma o piso ao orçamento (18 s medidos)');
  // CONTROLE: respondendo, não sobra nada anotado.
  const ok = await diagCorpoAteARede({ orcamentoMs: 120 })();
  await tique(200);
  assert.deepEqual(ok.semRespostaLocal, []);
});

test('R18-4-01/03: a ordem no fonte — a parte de rede e as leituras tardias nascem ANTES da primeira espera local', () => {
  const corpo = fatiar('diagCorpo');
  const primeiraEspera = Math.min(...['await registrosPromessa', 'await cachesPromessa', 'await swProprioPromessa', 'await idbPromessa', 'await offlinePromessa', 'await estimativaPromessa']
    .map((a) => { const i = corpo.indexOf(a); assert.ok(i > 0, `${a} sumiu do diagCorpo`); return i; }));
  for (const lancamento of ['const redePromessa = (async () => {', 'const relogioPromessa = (async () => {', 'const swProprioPromessa = diagServiceWorker();',
    "const idbPromessa = lerLocal('indexedDB.databases'", "const offlinePromessa = lerLocal('offline (base e cache do mapa)'"]) {
    const i = corpo.indexOf(lancamento);
    assert.ok(i > 0, `${lancamento} sumiu do diagCorpo`);
    assert.ok(i < primeiraEspera, `DEFEITO: ${lancamento} vem DEPOIS de uma espera local — uma leitura pendurada come o orçamento antes de ela sair`);
  }
  // Nenhum piso depois do orçamento: o `Math.max(prazo, Date.now() + …PISO…)` em série saiu.
  assert.doesNotMatch(corpo, /Date\.now\(\) \+ (\d \* )?DIAG_PISO_LOCAL_MS/, 'o piso voltou a ser pedido DEPOIS do orçamento, em série');
});

test('o bundle GERADO tem os consertos do lote 22 (senão nada disso está no ar)', () => {
  for (const nome of ['offline.gravacaoFalhou', 'segurarAteEm', 'tilesNegados', 'semFila']) {
    assert.ok(MIN.includes(nome), `js/min/app.js não tem ${nome} — rode \`npm run js\``);
  }
});

// ═══ R18-4-02 / R18-4-04 / R18-4-05 · a triagem ═════════════════════════════════════════════
function triagem(rel) {
  const base = { _versaoDoDiag: 11, _gerado: '2026-10-14T23:00:00.000Z', app: { versao: '2026101401', rotulo: '2026.10.14-01' },
    ambiente: { ua: 'x', online: true, fuso: 'America/Sao_Paulo', tela: { w: 390, h: 844, dpr: 3, janela: '390x844' } },
    resumo: { momentos: 0, chamadas: 0, falhas: 0, errosDeJs: 0, rede: true, offline: 'pronto',
      telaAgora: { tela: 'app', painel: 'card', cardMontado: true, modais: [], lightbox: false }, alertas: [] },
    diario: [], chamadas: [], momentos: [], erros: [], localStorage: {} };
  const dir = mkdtempSync(join(tmpdir(), 'diag-r18-'));
  const arq = join(dir, 'd.json');
  writeFileSync(arq, JSON.stringify({ ...base, ...rel }));
  return execFileSync(process.execPath, [new URL('../tools/diag-resumo.mjs', import.meta.url).pathname, arq], { encoding: 'utf8', timeout: 20000 });
}
const secaoOffline = (s) => { const i = s.indexOf('── OFFLINE'); return s.slice(i, s.indexOf('\n──', i + 5)); };
const OFFLINE_BASE = () => ({ ligado: true, janelaServida: 1492385, janelaAtual: 1492385, resultado: 'parcial', varrendo: false,
  filaGravadaEm: 1000, filaPreparada: null, filaVarrida: 1000, cobreAFila: false, precisaVarrer: true,
  filaGuardada: { n: 4, idadeMin: 3, carimboMin: 3, t: 1000, soNestaAba: 0, soNaGuardada: 0 }, janelaGuardada: null, filaCobertaGuardada: null,
  tilesNoCache: 3, tilesGuardadosQueFalharam: 0, pousosGravados: 0 });

test('R18-4-02a: a coleta separa leitura LOCAL de leitura de REDE — só o navegador sem resposta não é "rede pendurada"', () => {
  const localSo = triagem({ coleta: { ms: 10012, orcamentoMs: 10000, semResposta: ['service worker (registros)', 'caches'] } });
  assert.match(localSo, /ATENÇÃO: 2 leitura\(s\) LOCAL\(IS\) do navegador sem resposta no orçamento — o navegador não respondeu \(não é a rede\): service worker \(registros\), caches/,
    `DEFEITO: leitura local sem resposta não é dita como local:\n${localSo}`);
  assert.doesNotMatch(localSo, /rede pendurada na hora do relatório/, 'DEFEITO: a leitura local virou "rede pendurada"');
  // CONTROLE: só rede → a frase de sempre; misto → as duas, cada uma com o seu grupo.
  const redeSo = triagem({ coleta: { ms: 10012, orcamentoMs: 10000, semResposta: ['http://x/js/min/app.js', 'relógio do servidor'] } });
  assert.match(redeSo, /ATENÇÃO: 2 leitura\(s\) sem resposta no orçamento — rede pendurada na hora do relatório: \/js\/min\/app\.js, relógio do servidor/);
  assert.doesNotMatch(redeSo, /LOCAL\(IS\)/, 'CONTROLE: a rede pendurada foi dita como leitura local');
  const misto = triagem({ coleta: { ms: 10012, orcamentoMs: 10000, semResposta: ['http://x/css/app.css', 'indexedDB.databases'] } });
  assert.match(misto, /1 leitura\(s\) sem resposta no orçamento — rede pendurada na hora do relatório: \/css\/app\.css/);
  assert.match(misto, /1 leitura\(s\) LOCAL\(IS\) do navegador sem resposta no orçamento[^:]*: indexedDB\.databases/);
});

test('R18-4-02b: a seção `offline` que estourou o prazo (`semResposta: true`) NÃO sai como "ausente nesta versão"', () => {
  const o = { ...OFFLINE_BASE(), semResposta: true };
  for (const k of ['filaGuardada', 'tilesNoCache', 'janelaGuardada', 'filaCobertaGuardada', 'pousosGravados']) delete o[k];
  const s = secaoOffline(triagem({ offline: o }));
  assert.match(s, /a leitura da base e do cache do mapa NÃO chegou no orçamento/, `DEFEITO: o estouro do prazo não é dito:\n${s}`);
  assert.doesNotMatch(s, /ausente nesta versão/, `DEFEITO: a seção que estourou o prazo sai como "ausente nesta versão":\n${s}`);
  assert.match(s, /tiles guardados que falharam 0/, 'o campo do retrato síncrono não aparece');
  // CONTROLE: a seção completa continua com os valores.
  const cheia = secaoOffline(triagem({ offline: OFFLINE_BASE() }));
  assert.match(cheia, /fila guardada \{"n":4/);
  assert.doesNotMatch(cheia, /NÃO chegou no orçamento/);
});

test('R18-4-04: o resumo diz a PAUSA da varredura — até que horas (no fuso do aparelho) e por quê', () => {
  // 2026-10-14T23:00Z = 20:00 em São Paulo; a pausa vai até 20:10 lá.
  const ate = Date.parse('2026-10-14T23:10:00.000Z');
  const calma = secaoOffline(triagem({ offline: { ...OFFLINE_BASE(), segurarAteEm: ate, semEspaco: false },
    diario: [{ t: 1, k: 'offline.parcial', limite: 60 }] }));
  assert.match(calma, /em pausa até 20:10 \(o servidor de tile pediu calma/, `DEFEITO: a pausa não é dita:\n${calma}`);
  assert.match(calma, /prepara no próximo gatilho: só depois da pausa/, 'o resumo segue dizendo "sim" com a varredura parada');
  const espaco = secaoOffline(triagem({ offline: { ...OFFLINE_BASE(), segurarAteEm: ate, semEspaco: true } }));
  assert.match(espaco, /em pausa até 20:10 \(sem espaço no aparelho\)/);
  const negados = secaoOffline(triagem({ offline: { ...OFFLINE_BASE(), segurarAteEm: ate }, diario: [{ t: 1, k: 'offline.parcial', tilesNegados: 6 }] }));
  assert.match(negados, /\(o servidor de tile negou todos os tiles \(4xx\)\)/);
  // CONTROLE: sem pausa (null), nada é dito e o "sim" fica.
  const livre = secaoOffline(triagem({ offline: { ...OFFLINE_BASE(), segurarAteEm: null, semEspaco: false } }));
  assert.doesNotMatch(livre, /em pausa/);
  assert.match(livre, /prepara no próximo gatilho: sim/);
});

test('R18-4-05: a triagem diz "a fila NUNCA foi gravada" — não "preparação de OUTRA fila" — quando a base está vazia e a gravação falhou', () => {
  const sem = { ...OFFLINE_BASE(), resultado: 'pronto', filaGravadaEm: null, filaPreparada: null, filaGuardada: null, precisaVarrer: false };
  const s = secaoOffline(triagem({ offline: sem, diario: [{ t: 5, k: 'offline.gravacaoFalhou', cota: true }, { t: 6, k: 'offline.pronto', n: 4 }] }));
  assert.match(s, /a fila NUNCA foi gravada na base/, `DEFEITO: a causa não é dita:\n${s}`);
  assert.doesNotMatch(s, /preparação de OUTRA fila/, 'DEFEITO: a triagem aponta a causa errada (outra fila)');
  assert.match(s, /a gravação da fila na base falhou 1 vez\(es\) no diário .*FALTA DE ESPAÇO/, 'a falha do diário não é dita');
  // CONTROLE: com fila na base e sem a falha, a frase de sempre fica.
  const outra = secaoOffline(triagem({ offline: { ...OFFLINE_BASE(), resultado: 'pronto', precisaVarrer: false } }));
  assert.match(outra, /preparação de OUTRA fila/);
  assert.doesNotMatch(outra, /NUNCA foi gravada/);
});

test('R18-4-04: o retrato do offline (`diagOfflineAgora`) leva a pausa, o espaço e os tiles que falharam', () => {
  const retrato = (estado) => {
    const deps = { filaReal: () => [{}], filaGuardadaEsperandoOTreino: () => null, offlineLigado: () => true, OFFLINE_CICLO_MS: 1200000,
      offlinePrecisaVarrer: () => false, Date: { now: () => estado.agora }, ...{} };
    const chaves = Object.keys(deps);
    return new Function(...chaves, `let offlineJanelaServida = 1, offlineUltimoResultado = 'parcial', offlineVarrendo = false, offlineFilaGravadaEm = 1,
      offlineFilaPreparada = null, offlineFilaVarrida = 1, offlineSegurarAte = ${estado.ate}, offlineSemEspaco = ${estado.espaco},
      diagTilesGuardadosQueFalharam = [1, 2, 3];\n${fatiar('diagOfflineAgora')}\nreturn diagOfflineAgora();`)(...chaves.map((k) => deps[k]));
  };
  const em = retrato({ agora: 1000, ate: 61000, espaco: true });
  assert.equal(em.segurarAteEm, 61000, 'DEFEITO: a pausa não vai no retrato');
  assert.equal(em.semEspaco, true);
  assert.equal(em.tilesGuardadosQueFalharam, 3, 'DEFEITO: `tilesGuardadosQueFalharam` fora do retrato síncrono (sai "undefined" no resumo)');
  const livre = retrato({ agora: 90000, ate: 61000, espaco: false });
  assert.equal(livre.segurarAteEm, null, 'CONTROLE: a pausa que já passou continua valendo no retrato');
  assert.equal(livre.semEspaco, false);
});

// ═══ R18-4-05 / R18-4-06 · a varredura de verdade ═══════════════════════════════════════════
const JANELA = 1492385;
const CICLO = constanteBruta('OFFLINE_CICLO_MS');
const TILE = (i) => 'https://www.waze.com/row-tiles/live/base/' + i;
const ok200 = { status: 200 };
const itensDe = (n) => Array.from({ length: n }, (_, i) => TILE('t' + i));

// A varredura DE VERDADE sobre um `fetch` de mentira. `gravacao`: o que `offlineGravarFila` devolve.
function varredura({ itens, rede, gravacao = true, noCacheInicial = [] }) {
  const relogio = { agora: JANELA * CICLO + 1000 };
  const log = { baixar: 0, sonda: 0 };
  const noCache = new Map(noCacheInicial.map((u) => [u, true]));
  const diario = [];
  const resposta = (r) => ({ ok: r.status >= 200 && r.status < 300, status: r.status, body: null,
    headers: { get: (h) => (r.headers && r.headers[h.toLowerCase()]) ?? null } });
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
    offlineGravandoTile: new Map(), offlineGeracaoDeTile: 0, Image: class {},
    caches: { open: async () => ({ put: async (u) => { noCache.set(u, true); }, delete: async (u) => noCache.delete(u),
                                   keys: async () => [...noCache.keys()].map((url) => ({ url })) }),
              has: async () => noCache.size > 0, delete: async () => true },
    offlineItensDaFila: async () => itens.map((u) => ({ u, tile: true })),
    offlineGravarJanela: () => {}, offlinePodarTiles: async () => 0, offlineAnunciarTiles: () => {},
    atualizarLinhaDoOffline: () => {}, dfato: (k, o) => diario.push([k, o]),
    chavesQueEsperamAConta: () => new Set(), contar: (k) => { log[k] = (log[k] || 0) + 1; },
    gravacao,
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
    'async function offlineLerFila() { return { t: 5, places: [{ venueID: "v", updateRequestID: "u" }] }; }',
    ...['filaReal', 'chaveDoPedido', 'pedidoForaDaFilaGuardada', 'offlineDesfazerTile', 'offlineRecuoDoLimite', 'offlineErroDeCota'].map(fatiar),
    fatiar('offlineBaixar').replace(/\bfetch\(/g, 'fetchBaixar('),
    fatiar('offlineSondarRede').replace(/\bfetch\(/g, 'fetchSonda('),
    fatiar('offlineVarrer'),
    `return { varrer: offlineVarrer, estado: () => ({ resultado: offlineUltimoResultado, janela: offlineJanelaServida, segurarAte: offlineSegurarAte,
      semEspaco: offlineSemEspaco, feitos: [...offlineFeitosNaJanela.us] }), gesto: () => { offlineUltimoGesto = Date.now(); } };`,
  ].join('\n');
  const app = new Function(...chaves, 'fetchBaixar', 'fetchSonda', corpo)(...chaves.map((k) => deps[k]), fetchDe('baixar'), fetchDe('sonda'));
  return { app, relogio, log, noCache, diario };
}
const ultimo = (x, k) => [...x.diario].reverse().find(([nome]) => nome === k)?.[1];

test('R18-4-05: a gravação da fila que FALHOU (`falhou`) deixa a varredura PARCIAL — nunca "pronto" sem a fila na base — com a pausa curta e o rastro no diário', async () => {
  const x = varredura({ itens: itensDe(4), rede: () => ok200, gravacao: 'falhou' });
  await x.app.varrer();
  const e = x.app.estado();
  assert.equal(e.resultado, 'parcial', 'DEFEITO: a varredura fechou "pronto" sem a fila na base');
  assert.equal(e.janela, null, 'a janela virou sem a fila gravada');
  assert.equal(x.diario.some(([k]) => k === 'offline.pronto'), false, 'o diário diz "pronto"');
  assert.equal(ultimo(x, 'offline.parcial')?.semFila, true, 'o diário não diz que a fila não foi gravada');
  assert.ok(e.segurarAte >= x.relogio.agora + constanteBruta('OFFLINE_LIMITE_PAUSA_MS') - 1, 'sem pausa curta, a gravação que falha seria refeita a cada gatilho');
  assert.equal(e.semEspaco, false, 'uma falha que não é a cota virou "faltou espaço"');
  assert.equal(x.log.baixar, 4, 'os tiles ainda são baixados (o cache do mapa serve ao card), só não há cobertura');
});

test('R18-4-05: a COTA na gravação da fila vira "sem espaço" + a pausa longa, e nenhum tile é baixado à toa', async () => {
  const x = varredura({ itens: itensDe(4), rede: () => ok200, gravacao: 'cota' });
  await x.app.varrer();
  const e = x.app.estado();
  assert.equal(e.resultado, 'parcial');
  assert.equal(e.semEspaco, true, 'DEFEITO: a cota na gravação da fila não vira "faltou espaço"');
  assert.ok(e.segurarAte >= x.relogio.agora + constanteBruta('OFFLINE_COTA_PAUSA_MS') - 1, 'sem a pausa longa da cota');
  assert.equal(x.log.baixar, 0, 'baixou tile num aparelho sem espaço (o `put` dá o mesmo erro)');
  assert.equal(ultimo(x, 'offline.parcial')?.cota, true);
});

test('R18-4-05: CONTROLES — gravação ok = pronto; `false` ("nada a gravar": sem sessão, fila vazia) = pronto, como era', async () => {
  for (const g of [true, false]) {
    const x = varredura({ itens: itensDe(4), rede: () => ok200, gravacao: g });
    await x.app.varrer();
    assert.equal(x.app.estado().resultado, 'pronto', `CONTROLE: a gravação ${g} deixou de fechar "pronto"`);
    assert.equal(x.app.estado().segurarAte, 0);
  }
});

// A `offlineGravarFila` DE VERDADE, sobre uma base de mentira.
function gravarComBase({ falha, putLanca = null }) {
  const eventos = [];
  const AppState = { queue: [{ venueID: 'r1', updateRequestID: 'u1' }], filters: {} };
  const deps = {
    AppState, Treino: { ativo: false }, offlineLigado: () => true, OFFLINE_STORE: 'fila',
    offlineDB: async () => ({ close() {}, transaction: () => {
      const tx = { error: null, objectStore: () => ({
        put: () => { if (putLanca) throw putLanca; if (falha) setTimeout(() => { tx.error = falha === 'abort' ? null : falha; tx.onabort && tx.onabort(); }); else setTimeout(() => tx.oncomplete && tx.oncomplete()); },
        get: () => { const r = { result: undefined }; setTimeout(() => { if (r.onsuccess) r.onsuccess(); }); return r; } }),
        abort() { setTimeout(() => tx.onabort && tx.onabort()); } };
      return tx;
    } }),
    offlinePodarPousos: () => {}, dfato: (k, o) => eventos.push([k, o]),
    filaDeOnde: null, lugarAgora: () => ({ regiao: 'row', pais: '30' }),
    contaAgora: () => '111', marcaDestaAba: () => 'm-tok', API: { getSession: () => 'tok' }, offlineEpoca: 0,
  };
  deps.offlineErroDeCota = (e) => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
  const chaves = Object.keys(deps);
  const gravar = new Function(...chaves, ['filaReal', 'chaveDoPedido', 'pedidoForaDaFilaGuardada', 'offlineGravarFila'].map(fatiar).join('\n') + '\nreturn offlineGravarFila;')(...chaves.map((k) => deps[k]));
  return { gravar, eventos };
}
test('R18-4-05: `offlineGravarFila` que falha DEVOLVE \'falhou\'/\'cota\' e deixa `offline.gravacaoFalhou` no diário (antes: `false`, sem rastro)', async () => {
  const aborto = gravarComBase({ falha: 'abort' });
  assert.equal(await aborto.gravar(), 'falhou', 'DEFEITO: a gravação abortada devolve outra coisa — a varredura não distingue de "nada a gravar"');
  assert.deepEqual(aborto.eventos.map(([k]) => k), ['offline.gravacaoFalhou'], 'DEFEITO: a falha não deixa rastro no diário');
  assert.equal(aborto.eventos[0][1].cota, undefined);
  const cota = gravarComBase({ falha: Object.assign(new Error('q'), { name: 'QuotaExceededError' }) });
  assert.equal(await cota.gravar(), 'cota', 'DEFEITO: a cota na transação não é reconhecida');
  assert.equal(cota.eventos[0][1].cota, true);
  const sincrona = gravarComBase({ putLanca: Object.assign(new Error('q'), { name: 'QuotaExceededError' }) });
  assert.equal(await sincrona.gravar(), 'cota', 'DEFEITO: a cota lançada na hora pelo `put` vira um "abort" qualquer');
  // CONTROLE: gravação que dá certo devolve true e registra `offline.gravou`, nunca a falha.
  const boa = gravarComBase({});
  assert.equal(await boa.gravar(), true);
  assert.deepEqual(boa.eventos.map(([k]) => k), ['offline.gravou']);
});

test('R18-4-06: TODOS os tiles negados com 4xx (403, 401, 404, 451) e nenhum no cache — a varredura termina PARCIAL com a pausa longa; passada a pausa, os tiles são pedidos DE NOVO', async () => {
  for (const status of [403, 401, 404, 451]) {
    const x = varredura({ itens: itensDe(5), rede: () => ({ status }) });
    await x.app.varrer();
    const e = x.app.estado();
    assert.equal(e.resultado, 'parcial', `DEFEITO (${status}): todos os tiles negados terminaram "pronto" com o mapa fora do aparelho`);
    assert.equal(e.janela, null, `(${status}) a janela virou`);
    assert.equal(x.diario.some(([k]) => k === 'offline.pronto'), false);
    assert.equal(ultimo(x, 'offline.parcial')?.tilesNegados, 5, `(${status}) o diário não diz que os tiles foram negados`);
    assert.ok(e.segurarAte >= x.relogio.agora + constanteBruta('OFFLINE_COTA_PAUSA_MS') - 1, `(${status}) sem a pausa longa`);
    assert.equal(x.log.baixar, 5, `(${status}) o 4xx foi repetido na mesma varredura`);
    assert.deepEqual(e.feitos, [], `(${status}) os tiles negados seguem "feitos": a retomada não os pediria de novo`);
    // Dentro da pausa nada sai.
    await x.app.varrer();
    assert.equal(x.log.baixar, 5, `(${status}) a varredura pediu algo durante a pausa`);
    // Passada a pausa, com o servidor ainda negando: pede DE NOVO (uma vez por tile) e termina parcial outra vez.
    x.relogio.agora += constanteBruta('OFFLINE_COTA_PAUSA_MS') + 1000;
    x.app.gesto();
    await x.app.varrer();
    assert.equal(x.log.baixar, 10, `(${status}) a retomada não pediu os tiles de novo`);
    assert.equal(x.app.estado().resultado, 'parcial');
  }
});

test('R18-4-06: depois da pausa, com o servidor respondendo 200, a retomada baixa os tiles e fecha "pronto"', async () => {
  let servidorOk = false;
  const x = varredura({ itens: itensDe(5), rede: () => (servidorOk ? ok200 : { status: 403 }) });
  await x.app.varrer();
  assert.equal(x.app.estado().resultado, 'parcial');
  servidorOk = true;
  x.relogio.agora += constanteBruta('OFFLINE_COTA_PAUSA_MS') + 1000;
  x.app.gesto();
  await x.app.varrer();
  assert.equal(x.app.estado().resultado, 'pronto', 'DEFEITO: os tiles negados saíram da retomada (ficaram "feitos")');
  assert.equal(x.noCache.size, 5, 'a retomada não baixou os tiles');
  assert.equal(x.app.estado().semEspaco, false);
});

test('R18-4-06: CONTROLES — 404 em ALGUNS tiles segue definitivo e "pronto"; algum tile JÁ NO CACHE (de uma janela anterior) segura o "pronto"; o 5xx não mudou; 200 em tudo = pronto', async () => {
  const alguns = varredura({ itens: itensDe(5), rede: (u) => (u === TILE('t0') ? { status: 404 } : ok200) });
  await alguns.app.varrer();
  assert.equal(alguns.app.estado().resultado, 'pronto', 'CONTROLE: o 404 de UM tile virou "parcial"');
  assert.equal(alguns.app.estado().segurarAte, 0);
  const noCache = varredura({ itens: itensDe(5), rede: () => ({ status: 403 }), noCacheInicial: [TILE('t2')] });
  await noCache.app.varrer();
  assert.equal(noCache.app.estado().resultado, 'pronto', 'CONTROLE: com um tile de janela anterior no cache, os 4xx de hoje não anulam o que já está no aparelho');
  // Um tile negado (403) e o resto com 5xx: o 5xx segue como estava, e UM 4xx entre eles não faz "todos negados".
  const misto = varredura({ itens: itensDe(5), rede: (u) => (u === TILE('t0') ? { status: 403 } : { status: 503 }) });
  await misto.app.varrer();
  assert.equal(misto.app.estado().resultado, 'pronto', 'CONTROLE: um 403 entre 503s virou "todos negados"');
  const c503 = varredura({ itens: itensDe(5), rede: () => ({ status: 503 }) });
  await c503.app.varrer();
  assert.equal(c503.app.estado().resultado, 'pronto', 'o 5xx mudou (decisão do owner, R5-4-1)');
  assert.equal(c503.app.estado().segurarAte, 0);
  const bom = varredura({ itens: itensDe(5), rede: () => ok200 });
  await bom.app.varrer();
  assert.equal(bom.app.estado().resultado, 'pronto');
  assert.equal(bom.noCache.size, 5);
});

// ═══ R18-4-07 · o FAB do modo dev só responde ao botão PRINCIPAL ════════════════════════════
function fabDeMentira() {
  const ouvintes = { btn: {}, janela: {} };
  const classes = new Set();
  const capturas = [];
  const fab = { style: {}, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 44, height: 44 }) };
  const btn = { addEventListener: (t, f) => { ouvintes.btn[t] = f; }, animate: () => {} };
  const doc = { getElementById: (id) => (id === 'devFabBtn' ? btn : id === 'devFab' ? fab : null) };
  const deps = {
    document: doc, MODAL_IDS: [], MutationObserver: class { observe() {} }, requestAnimationFrame: (f) => { f(); return 1; }, cancelAnimationFrame: () => {},
    posicionarFabDev: () => {}, addEventListener: (t, f) => { ouvintes.janela[t] = f; }, removeEventListener: () => {},
    sessionStorage: { getItem: () => null, setItem: () => {} }, innerWidth: 400, innerHeight: 800,
    atualizarFabDev: () => {}, dlogCapturar: (m) => { capturas.push(m); return {}; },
    DEV_FAB_PEGAR_MS: 15, navigator: {}, setTimeout, clearTimeout, Math, Number,
  };
  const chaves = Object.keys(deps);
  const f = new Function(...chaves, `let devFabFixado = false, devFabDedo = null;\n${fatiar('ligarFabDev')}\nreturn ligarFabDev;`)(...chaves.map((k) => deps[k]));
  f();
  return { ouvintes, classes, capturas };
}
const evento = (button) => ({ button, pointerId: 1, clientX: 110, clientY: 110, cancelable: true, preventDefault() {} });

test('R18-4-07: o botão DIREITO e o do MEIO do mouse no FAB não registram captura nem "pegam" o botão', async () => {
  for (const botao of [2, 1]) {
    const f = fabDeMentira();
    f.ouvintes.btn.pointerdown(evento(botao));
    await tique(40);   // passa o tempo de pegar (15 ms aqui; 200 no app)
    assert.equal(f.classes.has('fab-pego'), false, `DEFEITO (botão ${botao}): o botão segurado "pegou" o FAB`);
    f.ouvintes.btn.pointerup(evento(botao));
    assert.deepEqual(f.capturas, [], `DEFEITO (botão ${botao}): o clique registrou uma captura (conta no selo)`);
  }
  // CONTROLE: o botão principal (0) pega depois de segurar, e solta como toque = UMA captura.
  const f = fabDeMentira();
  f.ouvintes.btn.pointerdown(evento(0));
  await tique(40);
  assert.equal(f.classes.has('fab-pego'), true, 'CONTROLE: o botão principal deixou de pegar');
  f.ouvintes.janela.pointerup(evento(0));
  const g = fabDeMentira();
  g.ouvintes.btn.pointerdown(evento(0));
  g.ouvintes.btn.pointerup(evento(0));
  assert.deepEqual(g.capturas, ['manual'], 'CONTROLE: o toque deixou de registrar a captura');
});
