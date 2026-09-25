// A varredura do "Disponível offline", pela auditoria de 2026-09-25: um item
// que falha SEMPRE (foto que o Waze tirou do ar, tile 404) voltava pro fim da
// fila até o teto GLOBAL — 1.001 tentativas numa URL só, e a linha parada em
// "Preparando… 499 de 500". E com o resultado "parcial" cada ação disparava
// outra varredura, martelando as mesmas URLs. Cada teste foi visto REPROVANDO
// com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const APP_SEM = APP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function fatiar(nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(APP_SEM);
  assert.ok(m, `${nome} sumiu do app.js`);
  let prof = 0;
  for (let j = APP_SEM.indexOf('{', APP_SEM.indexOf(')', m.index)); j < APP_SEM.length; j++) {
    if (APP_SEM[j] === '{') prof++;
    else if (APP_SEM[j] === '}') { prof--; if (prof === 0) return APP_SEM.slice(m.index, j + 1); }
  }
  throw new Error('não fechou');
}
const constante = (nome) => Number(new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM)[1]);

// Roda a varredura de VERDADE contra downloads de mentira. `baixar(u)` diz o que
// cada URL devolve (true | false | 'definitivo'); conta as tentativas por URL.
async function varrer(itens, baixar, { treino = false } = {}) {
  const tentativas = new Map();
  const diario = [];
  let gravou = 0;
  const podas = [];
  const st = { varrendo: false, pedida: false, janela: null, resultado: null, gesto: Date.now(), epoca: 0 };
  const deps = {
    AppState: { authenticated: true, queue: [{ venueID: 'v' }] },
    Treino: { ativo: treino },
    navigator: { onLine: true },
    offlineLigado: () => true,
    OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: 1200000, OFFLINE_CONCORRENCIA: 1,
    OFFLINE_ANUNCIAR_A_CADA: 50, OFFLINE_TENTATIVAS_POR_ITEM: constante('OFFLINE_TENTATIVAS_POR_ITEM'),
    offlineGravarFila: async () => { gravou++; }, offlineItensDaFila: async () => itens.map((u) => ({ u, tile: /tile/.test(u) })),
    offlineBaixar: async (u) => { tentativas.set(u, (tentativas.get(u) || 0) + 1); return baixar(u); },
    offlineAnunciarTiles: () => {}, atualizarLinhaDoOffline: () => {}, offlineGravarJanela: () => {},
    offlinePodarTiles: async (manter) => { podas.push([...manter].sort()); return 0; },
    dfato: (k, o) => diario.push([k, o]),
    setTimeout: (fn) => { fn(); return 0; },
  };
  const corpo = fatiar('offlineVarrer')
    .replace(/offlineVarrendo/g, '__st.varrendo').replace(/offlinePedidaDeNovo/g, '__st.pedida')
    .replace(/offlineJanelaServida/g, '__st.janela').replace(/offlineUltimoResultado/g, '__st.resultado')
    .replace(/offlineUltimoGesto/g, '__st.gesto').replace(/offlineEpoca/g, '__st.epoca');
  const chaves = Object.keys(deps);
  const offlineVarrer = new Function(...chaves, '__st', corpo + '\nreturn offlineVarrer;')(...chaves.map((k) => deps[k]), st);
  await offlineVarrer();
  return { st, tentativas, diario, gravou, podas };
}

test('uma foto QUEBRADA com o resto andando: poucas tentativas, e a preparação fica PRONTA', async () => {
  const itens = ['foto-quebrada', ...Array.from({ length: 30 }, (_, i) => 'tile-' + i)];
  const { st, tentativas } = await varrer(itens, (u) => u !== 'foto-quebrada');
  assert.ok(tentativas.get('foto-quebrada') <= 3, `a foto quebrada foi tentada ${tentativas.get('foto-quebrada')} vezes`);
  assert.equal(st.resultado, 'pronto', 'uma foto que o Waze tirou do ar segurou a preparação inteira');
  assert.notEqual(st.janela, null, 'a janela não virou: os cards seguiriam pedindo a foto crua');
});

test('tile 4xx é DEFINITIVO: não se repete', async () => {
  const { st, tentativas } = await varrer(['tile-404', 'tile-ok'], (u) => (u === 'tile-404' ? 'definitivo' : true));
  assert.equal(tentativas.get('tile-404'), 1);
  assert.equal(st.resultado, 'pronto');
});

test('CONTROLE: com a REDE parada (nada anda), o resultado é PARCIAL, e as tentativas têm teto', async () => {
  const itens = Array.from({ length: 5 }, (_, i) => 'tile-' + i);
  const { st, tentativas } = await varrer(itens, () => false);
  assert.equal(st.resultado, 'parcial', 'sem rede nenhuma a preparação se disse pronta');
  assert.equal(st.janela, null);
  for (const [u, n] of tentativas) assert.ok(n <= 3, `${u} tentado ${n} vezes`);
});

test('offlineBaixar: tile 4xx é "definitivo", 5xx e rede caída são falha de REDE (tenta de novo)', async () => {
  const guardados = [];
  const deps = {
    offlineEpoca: 0, OFFLINE_TILES_CACHE: 'waze-places-tiles',
    caches: { open: async () => ({ put: async (u) => guardados.push(u) }) },
    Image: class {},
  };
  const chaves = Object.keys(deps);
  const baixarCom = (resposta) => new Function(...chaves, 'fetch', fatiar('offlineBaixar') + '\nreturn offlineBaixar;')(
    ...chaves.map((k) => deps[k]), async () => { if (resposta === 'rede') throw new TypeError('Failed to fetch'); return { ok: resposta < 300, status: resposta }; });
  assert.equal(await baixarCom(404)('https://www.waze.com/row-tiles/live/base/1', true), 'definitivo');
  assert.equal(await baixarCom(410)('https://www.waze.com/row-tiles/live/base/2', true), 'definitivo');
  assert.equal(await baixarCom(503)('https://www.waze.com/row-tiles/live/base/3', true), false);
  assert.equal(await baixarCom('rede')('https://www.waze.com/row-tiles/live/base/4', true), false);
  assert.equal(await baixarCom(200)('https://www.waze.com/row-tiles/live/base/5', true), true);
  assert.deepEqual(guardados, ['https://www.waze.com/row-tiles/live/base/5']);
});

// A fila do TREINO é de exemplos (parte sintética, com id que não existe):
// gravada como a fila do offline, ela voltava como fila de VERDADE na próxima
// abertura sem rede — e as ações iam pro Waze. Qualquer resposta durante o
// treino (a lista da presença, o perfil) dispara a varredura pela prova de rede.
test('treino: a varredura NÃO grava nem baixa a fila de exemplos', async () => {
  const { st, tentativas, gravou } = await varrer(['tile-1', 'foto-1'], () => true, { treino: true });
  assert.equal(gravou, 0, 'a fila do treino foi gravada como a fila do offline');
  assert.equal(tentativas.size, 0);
  assert.equal(st.varrendo, false);
});

function gravarCom({ treinoAgora = false, treinoDuranteOAbrir = false } = {}) {
  const puts = [];
  const real = [{ venueID: 'real-1' }, { venueID: 'real-2' }];
  const exemplos = [{ venueID: 'exemplo', _treino: true }];
  const AppState = { queue: real, filters: { countryId: 30 } };
  const Treino = { ativo: treinoAgora };
  const deps = {
    AppState, Treino, offlineLigado: () => true, OFFLINE_STORE: 'fila',
    offlineDB: async () => {
      // O treino começa ENQUANTO a base abre: troca a fila, como o `Treino.entrar`.
      if (treinoDuranteOAbrir) { Treino.ativo = true; AppState.queue = exemplos; }
      return {
        close() {},
        transaction: () => {
          const tx = { objectStore: () => ({ put: (v) => { puts.push(v); setTimeout(() => tx.oncomplete()); } }) };
          return tx;
        },
      };
    },
    offlinePodarPousos: () => {}, dfato: () => {},
  };
  const chaves = Object.keys(deps);
  const gravar = new Function(...chaves, fatiar('offlineGravarFila') + '\nreturn offlineGravarFila;')(...chaves.map((k) => deps[k]));
  return { gravar, puts };
}

test('offlineGravarFila: no treino não grava; e o treino que começa com a base ABRINDO não troca a fila gravada', async () => {
  const a = gravarCom({ treinoAgora: true });
  assert.equal(await a.gravar(), false);
  assert.equal(a.puts.length, 0, 'gravou a fila de exemplos');

  const b = gravarCom({ treinoDuranteOAbrir: true });
  assert.equal(await b.gravar(), true);
  assert.deepEqual(b.puts[0].places.map((p) => p.venueID), ['real-1', 'real-2'],
    'a fila lida DEPOIS do await era a do treino');

  // CONTROLE: sem treino, grava a fila de verdade.
  const c = gravarCom();
  assert.equal(await c.gravar(), true);
  assert.equal(c.puts[0].places.length, 2);
});

// O cache do mapa só CRESCIA: cada fila nova somava os tiles dela aos de todas
// as anteriores (auditoria de 2026-09-25). A varredura PRONTA poda ao que a fila
// usa; a parcial não mexe (a lista dela não é a da fila inteira).
test('varredura PRONTA poda o cache do mapa aos tiles da fila; a PARCIAL não poda', async () => {
  const ok = await varrer(['tile-a', 'foto-1', 'tile-b'], () => true);
  assert.equal(ok.st.resultado, 'pronto');
  assert.deepEqual(ok.podas, [['tile-a', 'tile-b']], 'a poda não recebeu os tiles da fila');
  const parcial = await varrer(['tile-a', 'tile-b'], () => false);
  assert.equal(parcial.st.resultado, 'parcial');
  assert.deepEqual(parcial.podas, [], 'podou numa varredura PARCIAL');
});

test('offlinePodarTiles: apaga só o que não é da fila, e não cria o cache de quem nunca ligou', async () => {
  const guardados = ['https://t/1', 'https://t/2', 'https://t/3'];
  const apagados = [];
  let criou = false;
  const deps = {
    offlineEpoca: 0, OFFLINE_TILES_CACHE: 'waze-places-tiles',
    caches: {
      has: async () => guardados.length > 0,
      open: async () => { criou = true; return { keys: async () => guardados.map((url) => ({ url })), delete: async (r) => { apagados.push(r.url); } }; },
    },
  };
  const chaves = Object.keys(deps);
  const podar = new Function(...chaves, fatiar('offlinePodarTiles') + '\nreturn offlinePodarTiles;')(...chaves.map((k) => deps[k]));
  assert.equal(await podar(new Set(['https://t/2']), 0), 2);
  assert.deepEqual(apagados.sort(), ['https://t/1', 'https://t/3']);
  // Sem cache (quem nunca ligou o offline): não abre — `open` CRIARIA um vazio.
  guardados.length = 0; criou = false;
  assert.equal(await podar(new Set(), 0), 0);
  assert.equal(criou, false, 'a poda criou o cache do mapa pra quem nunca o teve');
});
