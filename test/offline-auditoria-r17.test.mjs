// Rodada 17 da auditoria (2026-10-14), a parte do OFFLINE e do DIAGNÓSTICO — o lote 21. Os
// roteiros do auditor (r17-4) medidos no navegador; aqui, os mesmos cenários sobre o código
// de verdade, fatiado do app.js:
//
//  · R17-4-01 — o 429 (e 408/425) terminava em "Pronto" com o mapa vazio, gastando 3× o
//    tráfego: a sonda dizia "a rede anda" pra qualquer resposta. Agora o servidor que pede
//    calma PARA a varredura, e o pedido fica pra retomada depois de uma pausa;
//  · R17-4-05 — o item que o teto de falhas largava no meio não entrava em lugar nenhum.
// Cada teste tem o CONTROLE que dá o resultado oposto, e foi visto REPROVANDO com o conserto
// desfeito (sabotagem no relatório do lote 21).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const MIN = ler('js/min/app.js');
// Guard lê CÓDIGO, nunca comentário (gotcha #67), e por LINHA.
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Pula a ASSINATURA antes de casar chaves (parâmetro padrão com `{}`).
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
const TILE = (i) => 'https://www.waze.com/row-tiles/live/base/' + i;
const JANELA = 1492385;
const CICLO = constanteBruta('OFFLINE_CICLO_MS');

// A varredura DE VERDADE (`offlineVarrer` com `offlineBaixar` e `offlineSondarRede`), sobre um
// `fetch` de mentira que o teste escreve: `rede(u, n, quem)` devolve o que o servidor responde
// à n-ésima chamada daquele endereço (`quem`: 'baixar' | 'sonda'). Os 400 ms entre tentativas
// viram imediatos (e são anotados em `esperas`); o teto de 30 s do download segue o de verdade.
function varredura({ itens, rede, concorrencia = 3, sondaTetoMs = null, put = null, abrirCache = null }) {
  const relogio = { agora: JANELA * CICLO + 1000 };
  const chamadas = new Map();
  const log = { baixar: 0, sonda: 0, esperas: [] };
  const noCache = new Map();
  const diario = [];
  const resposta = (r) => ({
    ok: r.status >= 200 && r.status < 300, status: r.status, body: null,
    headers: { get: (h) => (r.headers && r.headers[h.toLowerCase()]) ?? null },
  });
  const deps = {
    AppState: { authenticated: true, queue: [{ venueID: 'v', updateRequestID: 'u' }] },
    Treino: { ativo: false },
    navigator: { onLine: true },
    Date: { now: () => relogio.agora, parse: Date.parse },
    offlineLigado: () => true,
    OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: CICLO, OFFLINE_CONCORRENCIA: concorrencia, OFFLINE_ANUNCIAR_A_CADA: 50,
    OFFLINE_TENTATIVAS_POR_ITEM: constanteBruta('OFFLINE_TENTATIVAS_POR_ITEM'),
    OFFLINE_ITEM_TETO_MS: 30000, OFFLINE_SONDA_TETO_MS: sondaTetoMs ?? constanteBruta('OFFLINE_SONDA_TETO_MS'),
    OFFLINE_TILES_CACHE: 'waze-places-tiles',
    OFFLINE_4XX_PASSAGEIRO: new Function('return ' + /^const OFFLINE_4XX_PASSAGEIRO = (new Set\(\[[^\]]*\]\));/m.exec(APP_SEM)[1])(),
    OFFLINE_LIMITE_PAUSA_MS: constanteBruta('OFFLINE_LIMITE_PAUSA_MS'),
    OFFLINE_LIMITE_PAUSA_MAX_MS: constanteBruta('OFFLINE_LIMITE_PAUSA_MAX_MS'),
    OFFLINE_COTA_PAUSA_MS: constanteBruta('OFFLINE_COTA_PAUSA_MS'),
    offlineGravandoTile: new Map(), offlineGeracaoDeTile: 0, Image: class {},
    caches: { open: async () => { if (abrirCache) await abrirCache(); return ({ put: async (u) => { if (put) await put(u); noCache.set(u, true); }, delete: async (u) => noCache.delete(u), keys: async () => [...noCache.keys()].map((url) => ({ url })) }); },
              has: async () => noCache.size > 0, delete: async () => true },
    offlineItensDaFila: async () => itens.map((u) => ({ u, tile: true })),
    offlineGravarJanela: () => {}, offlinePodarTiles: async () => 0, offlineAnunciarTiles: () => {},
    atualizarLinhaDoOffline: () => {}, dfato: (k, o) => diario.push([k, o]),
    chavesQueEsperamAConta: () => new Set(), contar: (k) => { log[k] = (log[k] || 0) + 1; },
    setTimeout: (fn, ms) => { if (ms === 400) { log.esperas.push(ms); fn(); return 0; } return setTimeout(fn, ms); },
  };
  // O `fetch` não sabe quem o chamou (o download ou a sonda): quem chama a sonda é o `redeAnda`,
  // que passa por `offlineSondarRede`, então as duas funções ganham um `fetch` cada — o da
  // sonda marca a chamada.
  const fetchDe = (quem) => async (u) => {
    const n = (chamadas.get(u) || 0) + 1;
    chamadas.set(u, n);
    log[quem]++;
    const r = await rede(u, n, quem, log);
    if (r instanceof Error) throw r;
    return resposta(r);
  };
  const chaves = Object.keys(deps).filter((k) => k !== 'fetch');
  const corpo = [
    'let offlineVarrendo = false, offlinePedidaDeNovo = false, offlineUltimoGesto = Date.now(), offlineJanelaServida = null,',
    '    offlineUltimoResultado = null, offlineSegurarAte = 0, offlineSemEspaco = false, offlineEpoca = 0, offlineFilaGravadaEm = null, offlineFilaPreparada = null,',
    '    offlineFilaVarrida = null, offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set(), guardados: new Set() };',
    'async function offlineGravarFila() { contar("gravou"); offlineFilaGravadaEm = 5; return true; }',
    'async function offlineLerFila() { return { t: 5, places: [{ venueID: "v", updateRequestID: "u" }] }; }',
    ...['filaReal', 'chaveDoPedido', 'pedidoForaDaFilaGuardada', 'offlineDesfazerTile', 'offlineRecuoDoLimite', 'offlineErroDeCota'].map(fatiar),
    // O download e a sonda têm `fetch` próprio (o que marca QUEM perguntou).
    fatiar('offlineBaixar').replace(/\bfetch\(/g, 'fetchBaixar('),
    fatiar('offlineSondarRede').replace(/\bfetch\(/g, 'fetchSonda('),
    fatiar('offlineVarrer'),
    `return { varrer: offlineVarrer, estado: () => ({ resultado: offlineUltimoResultado, janela: offlineJanelaServida, segurarAte: offlineSegurarAte,
      semEspaco: offlineSemEspaco, feitos: [...offlineFeitosNaJanela.us], guardados: [...offlineFeitosNaJanela.guardados] }), sondar: offlineSondarRede, baixar: offlineBaixar,
      esquecer: () => { offlineEpoca++; offlineSegurarAte = 0; }, gesto: () => { offlineUltimoGesto = Date.now(); } };`,
  ].join('\n');
  const app = new Function(...chaves, 'fetchBaixar', 'fetchSonda', corpo)(
    ...chaves.map((k) => deps[k]), fetchDe('baixar'), fetchDe('sonda'));
  return { app, relogio, log, noCache, diario, chamadas };
}
const ok200 = { status: 200 };
const itensDe = (n) => Array.from({ length: n }, (_, i) => TILE('t' + i));

// ═══ R17-4-01 · o servidor que pede calma PARA a varredura ═══════════════════════════════
test('R17-4-01: 429 em TODO tile — a varredura para na primeira resposta, termina PARCIAL (não "pronto" com o mapa vazio) e não gasta 3× o tráfego', async () => {
  const x = varredura({ itens: itensDe(7), rede: () => ({ status: 429 }) });
  await x.app.varrer();
  const e = x.app.estado();
  assert.equal(e.resultado, 'parcial', 'DEFEITO: o 429 terminou em "pronto" com o mapa fora do aparelho');
  assert.equal(e.janela, null, 'a janela virou: os cards seguiriam pedindo a foto crua, e nada retomaria o mapa');
  assert.ok(x.log.baixar <= 3, `DEFEITO: ${x.log.baixar} pedidos ao servidor que pediu calma (no máximo um por trabalhador: 3)`);
  assert.equal(x.log.sonda, 0, 'a sonda perguntou à rede que acabou de pedir calma');
  assert.equal(x.noCache.size, 0);
  assert.ok(e.segurarAte > x.relogio.agora, 'a varredura não marcou a pausa — o próximo gatilho a repetiria na hora');
  assert.equal(e.feitos.length, 0, 'o tile que levou o 429 foi dado por feito (a janela não o pediria de novo)');
});

test('R17-4-01: durante a pausa NENHUM gatilho pede nada (a prova de rede chega a cada swipe); passada a pausa, a retomada baixa tudo', async () => {
  let limitado = true;
  const x = varredura({ itens: itensDe(7), rede: () => (limitado ? { status: 429 } : ok200) });
  await x.app.varrer();
  const depoisDoPrimeiro = x.log.baixar;
  const gravouAntes = x.log.gravou, partiaisAntes = x.diario.filter(([k]) => k === 'offline.parcial').length;
  // Dez gatilhos na pausa (swipes): o servidor não ouve falar de nós.
  for (let i = 0; i < 10; i++) { x.relogio.agora += 2000; x.app.gesto(); await x.app.varrer(); }
  assert.equal(x.log.baixar, depoisDoPrimeiro, `DEFEITO: ${x.log.baixar - depoisDoPrimeiro} pedidos ao servidor DURANTE a pausa`);
  // E a varredura nem COMEÇA: não regrava a fila guardada nem anota um "parcial" por gatilho.
  assert.equal(x.log.gravou, gravouAntes, 'DEFEITO: cada gatilho da pausa regravou a fila guardada (a varredura começou à toa)');
  assert.equal(x.diario.filter(([k]) => k === 'offline.parcial').length, partiaisAntes, 'cada gatilho da pausa anotou um "parcial" no diário');
  // A pausa vence, o servidor volta: o próximo gatilho prepara tudo.
  limitado = false;
  x.relogio.agora = x.app.estado().segurarAte + 1;
  x.app.gesto();
  await x.app.varrer();
  const e = x.app.estado();
  assert.equal(e.resultado, 'pronto');
  assert.equal(x.noCache.size, 7, 'a retomada não baixou os 7 tiles');
  assert.deepEqual([...x.noCache.keys()].sort(), itensDe(7).sort());
});

test('R17-4-01: o 429 só nas 3 primeiras tentativas de cada tile (o roteiro s1 do auditor) — nenhum tile fica de fora: a retomada, passada a pausa, baixa o que faltou (antes: 5 de 7, e "Pronto")', async () => {
  const x = varredura({ itens: itensDe(7), rede: (u, n, quem) => (quem === 'baixar' && n <= 3 ? { status: 429 } : ok200) });
  await x.app.varrer();
  assert.equal(x.app.estado().resultado, 'parcial', 'PRÉ-CONDIÇÃO: o 429 não deixou a 1ª preparação parcial');
  // Cada retomada, passada a pausa, avança uma tentativa por tile (o servidor deste roteiro conta POR endereço).
  let retomadas = 0;
  while (x.app.estado().resultado !== 'pronto' && retomadas < 12) {
    x.relogio.agora = x.app.estado().segurarAte + 1;
    x.app.gesto();   // a pessoa segue triando: o app não dorme (`OFFLINE_OCIOSO_MS`)
    await x.app.varrer();
    retomadas++;
  }
  assert.equal(x.app.estado().resultado, 'pronto', 'a retomada nunca terminou');
  assert.equal(x.noCache.size, 7, `DEFEITO: ${7 - x.noCache.size} tile(s) ficaram de fora com a linha em "Pronto"`);
});

test('R17-4-01: o 408 e o 425 valem o mesmo que o 429', async () => {
  for (const status of [408, 425]) {
    const x = varredura({ itens: itensDe(4), rede: () => ({ status }) });
    await x.app.varrer();
    assert.equal(x.app.estado().resultado, 'parcial', `o ${status} terminou em "pronto"`);
    assert.ok(x.app.estado().segurarAte > x.relogio.agora);
  }
});

test('R17-4-01: o `Retry-After` legível vale (com teto de 5 min); ilegível ou inválido, o padrão de 1 min', async () => {
  const pausaCom = async (headers) => {
    const x = varredura({ itens: itensDe(3), rede: () => ({ status: 429, headers }) });
    await x.app.varrer();
    return x.app.estado().segurarAte - x.relogio.agora;
  };
  const PADRAO = constanteBruta('OFFLINE_LIMITE_PAUSA_MS');
  const MAX = constanteBruta('OFFLINE_LIMITE_PAUSA_MAX_MS');
  assert.equal(await pausaCom({ 'retry-after': '30' }), 30000, 'o Retry-After legível (30 s) não vale');
  assert.equal(await pausaCom({ 'retry-after': '99999' }), MAX, 'o Retry-After enorme passa do teto');
  assert.equal(await pausaCom({}), PADRAO, 'CONTROLE: sem o cabeçalho (o caso comum: o navegador não o deixa ler) o padrão não vale');
  assert.equal(await pausaCom({ 'retry-after': 'abobrinha' }), PADRAO, 'o valor inválido derrubou o padrão');
  assert.equal(await pausaCom({ 'retry-after': '-5' }), PADRAO, 'o valor negativo derrubou o padrão');
});

test('R17-4-01: a SONDA de verdade — 408/425/429 não são "a rede anda"; 5xx, 4xx e 200 seguem sendo (R5-4-1); a falha de rede, não', async () => {
  const sondaCom = async (rede) => {
    const x = varredura({ itens: itensDe(1), rede });
    const info = {};
    const r = await x.app.sondar(TILE('t0'), info);
    return { r, info };
  };
  for (const status of [408, 425, 429]) {
    const { r, info } = await sondaCom(() => ({ status, headers: { 'retry-after': '20' } }));
    assert.equal(r, 'limite', `DEFEITO: a sonda disse "${r}" a um ${status} — o item seria inocentado e entraria em \`feitos\` sem estar no cache`);
    assert.equal(info.recuoMs, 20000);
  }
  // CONTROLE: o 5xx FICA como o R5-4-1 decidiu ("qualquer resposta é rede de pé, até erro do servidor").
  for (const status of [200, 404, 500, 502, 503]) assert.equal((await sondaCom(() => ({ status }))).r, true, `CONTROLE: a sonda tratou o ${status} como rede parada (o R5-4-1 decidiu o contrário)`);
  assert.equal((await sondaCom(() => new Error('Failed to fetch'))).r, false, 'a falha de rede virou "a rede anda"');
});

test('R17-4-01: o item que falhou 3 vezes por OUTRO motivo e cuja sonda levou 429 NÃO vira definitivo — volta na retomada e a pausa vale', async () => {
  // 503 no download (3 tentativas) e 429 na sonda: o tile entrava em `feitos` sem estar no cache.
  const x = varredura({ itens: itensDe(1), rede: (u, n, quem) => (quem === 'sonda' ? { status: 429 } : { status: 503 }) });
  await x.app.varrer();
  assert.equal(x.log.sonda, 1, 'PRÉ-CONDIÇÃO: a sonda não foi feita');
  assert.equal(x.app.estado().resultado, 'parcial', 'DEFEITO: a sonda respondida com 429 inocentou o item');
  assert.equal(x.app.estado().feitos.length, 0);
  assert.ok(x.app.estado().segurarAte > x.relogio.agora, 'o 429 da sonda não marcou a pausa');
});

test('R17-4-01: CONTROLE — 503 em todo tile segue como o R5-4-1 decidiu ("qualquer resposta é rede de pé"); 404 é definitivo; e sem erro nenhum, 12 tiles = 12 pedidos', async () => {
  const c503 = varredura({ itens: itensDe(5), rede: (u, n, quem) => ({ status: 503 }) });
  await c503.app.varrer();
  assert.equal(c503.app.estado().resultado, 'pronto', 'CONTROLE: o 5xx passou a parar a varredura — o R5-4-1 decidiu o contrário');
  assert.equal(c503.app.estado().segurarAte, 0, 'CONTROLE: o 5xx marcou pausa');
  const c404 = varredura({ itens: itensDe(5), rede: () => ({ status: 404 }) });
  await c404.app.varrer();
  assert.equal(c404.log.baixar, 5, 'CONTROLE: o 404 foi repetido');
  assert.equal(c404.app.estado().resultado, 'pronto');
  const bom = varredura({ itens: itensDe(12), rede: () => ok200 });
  await bom.app.varrer();
  assert.equal(bom.log.baixar, 12);
  assert.equal(bom.log.sonda, 0);
  assert.equal(bom.noCache.size, 12);
  assert.equal(bom.app.estado().resultado, 'pronto');
  assert.equal(bom.app.estado().segurarAte, 0);
});

test('R17-4-01: o "esquecer" (o interruptor, o Sair) zera a pausa — o enchimento seguinte não herda a espera', async () => {
  const x = varredura({ itens: itensDe(2), rede: () => ({ status: 429 }) });
  await x.app.varrer();
  assert.ok(x.app.estado().segurarAte > 0);
  const corpo = fatiar('offlineEsquecer');
  assert.match(corpo, /^\s*offlineSegurarAte = 0;/m, 'DEFEITO: o `offlineEsquecer` não zera a pausa');
});

// ═══ R17-4-05 · o item que o teto de falhas largava no meio ═════════════════════════════
test('R17-4-05: o item que o teto de falhas (`falhas > total * 2`) larga NÃO some — a preparação termina PARCIAL, não "Pronto" sem ele', async () => {
  // Dois itens, dois trabalhadores. O A falha 3 vezes com a rede "andando" (a sonda diz que sim → definitivo)
  // enquanto a 1ª resposta do B está presa; quando ela volta, B falha mais duas vezes e estoura o teto (5 > 4).
  let soltarB;
  const presoB = new Promise((ok) => { soltarB = ok; });
  const x = varredura({
    itens: [TILE('A'), TILE('B')], concorrencia: 2,
    rede: async (u, n, quem) => {
      if (u === TILE('A')) { if (quem === 'sonda') { soltarB(); return ok200; } return { status: 503 }; }
      if (n === 1) await presoB;
      return { status: 503 };
    },
  });
  await x.app.varrer();
  assert.equal(x.log.sonda, 1, 'PRÉ-CONDIÇÃO: o A não foi dado por defeito do item pela sonda');
  assert.equal(x.app.estado().feitos.includes(TILE('A')), true, 'PRÉ-CONDIÇÃO: o A não virou definitivo');
  assert.equal(x.app.estado().resultado, 'parcial', 'DEFEITO: o B largado pelo teto de falhas ficou fora da preparação, e ela terminou "Pronto" sem ele');
  assert.equal(x.app.estado().feitos.includes(TILE('B')), false);
});

// ═══ R17-4-02 · a cota de armazenamento estourada não é "Pronto" ═════════════════════════
const cotaEstourada = (nome = 'QuotaExceededError', extra = {}) => Object.assign(new Error('full'), { name: nome }, extra);
test('R17-4-02: o `put` recusado por falta de ESPAÇO termina PARCIAL e com o motivo — não "Pronto" com 0 tiles — e a varredura para na primeira recusa', async () => {
  const x = varredura({ itens: itensDe(7), rede: () => ok200, put: async () => { throw cotaEstourada(); } });
  await x.app.varrer();
  const e = x.app.estado();
  assert.equal(e.resultado, 'parcial', 'DEFEITO: a cota estourada terminou em "pronto" com 0 tiles no aparelho');
  assert.equal(e.semEspaco, true, 'a linha não sabe que faltou espaço (diria "quando houver sinal")');
  assert.equal(e.janela, null);
  assert.equal(x.noCache.size, 0);
  assert.ok(x.log.baixar <= 3, `DEFEITO: ${x.log.baixar} downloads depois de o aparelho dizer que não cabe (no máximo um por trabalhador)`);
  assert.equal(x.log.sonda, 0, 'a sonda perguntou à rede por um erro que a rede não causou');
  assert.equal(e.feitos.length, 0, 'o tile que não coube foi dado por feito');
  assert.equal(e.segurarAte - x.relogio.agora, constanteBruta('OFFLINE_COTA_PAUSA_MS'), 'a pausa da cota não é a longa');
  assert.ok(x.diario.some(([k, o]) => k === 'offline.parcial' && o && o.cota === true), 'o diário não diz que foi a cota');
});

test('R17-4-02: a cota estourada já no `caches.open` vale o mesmo; e outros nomes do erro (Firefox antigo, código 22) também', async () => {
  for (const [nome, extra] of [['NS_ERROR_DOM_QUOTA_REACHED', {}], ['Erro qualquer', { code: 22 }]]) {
    const x = varredura({ itens: itensDe(3), rede: () => ok200, put: async () => { throw cotaEstourada(nome, extra); } });
    await x.app.varrer();
    assert.equal(x.app.estado().semEspaco, true, `${nome}/${extra.code}: não foi reconhecido como falta de espaço`);
  }
  const noOpen = varredura({ itens: itensDe(3), rede: () => ok200, abrirCache: async () => { throw cotaEstourada(); } });
  await noOpen.app.varrer();
  assert.equal(noOpen.app.estado().resultado, 'parcial', 'a cota estourada no `open` terminou "pronto"');
  assert.equal(noOpen.app.estado().semEspaco, true);
});

test('R17-4-02: CONTROLE — um erro de gravação que NÃO é cota segue como antes (falha de rede, 3 tentativas), e sem erro nenhum não há pausa nem "sem espaço"', async () => {
  const x = varredura({ itens: itensDe(2), rede: () => ok200, put: async () => { throw new Error('outra coisa'); } });
  await x.app.varrer();
  assert.equal(x.app.estado().semEspaco, false, 'CONTROLE: um erro qualquer foi tomado por falta de espaço');
  assert.equal(x.app.estado().segurarAte, 0, 'CONTROLE: um erro qualquer marcou a pausa longa');
  const bom = varredura({ itens: itensDe(5), rede: () => ok200 });
  await bom.app.varrer();
  assert.equal(bom.app.estado().semEspaco, false);
  assert.equal(bom.app.estado().resultado, 'pronto');
  assert.equal(bom.noCache.size, 5);
});

test('R17-4-02: durante a pausa ninguém pede nada; com o espaço liberado, o primeiro gatilho depois dela prepara tudo e a linha deixa de falar em espaço', async () => {
  let cheio = true;
  const x = varredura({ itens: itensDe(7), rede: () => ok200, put: async () => { if (cheio) throw cotaEstourada(); } });
  await x.app.varrer();
  const depois = x.log.baixar;
  for (let i = 0; i < 10; i++) { x.relogio.agora += 20000; x.app.gesto(); await x.app.varrer(); }
  assert.equal(x.log.baixar, depois, 'DEFEITO: cada gatilho da pausa baixou tile pra não guardar');
  cheio = false;
  x.relogio.agora = x.app.estado().segurarAte + 1;
  x.app.gesto();
  await x.app.varrer();
  assert.equal(x.app.estado().resultado, 'pronto');
  assert.equal(x.app.estado().semEspaco, false, 'o motivo antigo ficou depois do "pronto"');
  assert.equal(x.noCache.size, 7);
});

test('R17-4-02: a linha das Preferências diz que faltou ESPAÇO (e não promete sinal) nos 4 idiomas; sem o motivo, a de sempre', () => {
  const dicionario = ler('js/i18n.js');
  const langs = { pt: /espaço/i, en: /space/i, es: /espacio/i, fr: /espace/i };
  const blocos = dicionario.split(/^\s{2}(?:'?)(pt|en|es|fr)(?:'?):\s*\{/m);
  const porLang = {};
  for (let i = 1; i < blocos.length; i += 2) porLang[blocos[i]] = blocos[i + 1];
  for (const [lang, termo] of Object.entries(langs)) {
    assert.ok(porLang[lang], `bloco ${lang} do dicionário não achado`);
    for (const chave of ['semEspacoA', 'semEspacoB']) {
      const m = new RegExp(`'prefs\\.offline\\.${chave}':\\s*'([^']*)'`).exec(porLang[lang]);
      assert.ok(m, `${lang}: falta prefs.offline.${chave}`);
      assert.doesNotMatch(m[1], /sinal|signal|señal|réseau/i, `${lang}.${chave}: fala de rede, e o problema é espaço`);
      if (chave === 'semEspacoA') assert.match(m[1], termo, `${lang}.${chave}: não fala em espaço`);
    }
  }
  // A linha de verdade, fatiada.
  const el = { innerHTML: '', textContent: '' };
  const linha = (semEspaco) => {
    const deps = { navigator: { onLine: true }, document: { getElementById: () => el }, t: (k) => k, escapeHtml: (x) => x,
      offlineLigado: () => true, filaReal: () => [{}], filaGuardadaEsperandoOTreino: () => null, Date, OFFLINE_CICLO_MS: CICLO };
    const chaves = Object.keys(deps);
    return new Function(...chaves, `let offlineUltimoResultado = 'parcial', offlineSemEspaco = ${semEspaco}, offlineVarrendo = false, offlineJanelaServida = null,
      offlineFilaPreparada = null, offlineFilaGravadaEm = 1; function offlinePrecisaVarrer() { return true; }
      ${fatiar('atualizarLinhaDoOffline')}
      atualizarLinhaDoOffline(0, 0); return document.getElementById('x').innerHTML;`)(...chaves.map((k) => deps[k]));
  };
  assert.match(linha(true), /prefs\.offline\.semEspacoA[\s\S]*prefs\.offline\.semEspacoB/, 'DEFEITO: com a cota estourada a linha não diz que faltou espaço');
  assert.doesNotMatch(linha(true), /parcialA|parcialB/);
  assert.match(linha(false), /parcialA[\s\S]*parcialB/, 'CONTROLE: sem o motivo a linha deixou de ser a de sempre');
});

test('o bundle GERADO tem os consertos do lote 21 (senão nada disso está no ar)', () => {
  for (const nome of ['offlineSegurarAte', 'offlineRecuoDoLimite', 'offlineErroDeCota', 'offlineSemEspaco', 'semEspacoA']) {
    assert.ok(MIN.includes(nome), `js/min/app.js não tem ${nome} — rode \`npm run js\``);
  }
});
