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
// A SONDA da rede (`offlineSondarRede`) segue o MESMO modelo de rede (`baixar`
// da URL sondada), mas é contada à parte: não é tentativa de item. `st` deixa
// rodar uma SEGUNDA varredura sobre o mesmo estado (a retomada), e `agora` fixa
// o relógio (a janela).
async function varrer(itens, baixar, { treino = false, concorrencia = 1, st: estado = null, agora = null } = {}) {
  const tentativas = new Map();
  const sondas = [];
  const diario = [];
  let gravou = 0;
  const podas = [];
  const relogio = agora === null ? Date : { now: () => agora };
  const st = estado || { varrendo: false, pedida: false, janela: null, resultado: null, gesto: relogio.now(), epoca: 0,
    feitos: { janela: null, epoca: -1, us: new Set() } };
  st.gesto = relogio.now();
  const deps = {
    AppState: { authenticated: true, queue: [{ venueID: 'v' }] },
    Treino: { ativo: treino },
    navigator: { onLine: true },
    Date: relogio,
    offlineLigado: () => true,
    OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: 1200000, OFFLINE_CONCORRENCIA: concorrencia,
    OFFLINE_ANUNCIAR_A_CADA: 50, OFFLINE_TENTATIVAS_POR_ITEM: constante('OFFLINE_TENTATIVAS_POR_ITEM'),
    offlineGravarFila: async () => { gravou++; }, offlineItensDaFila: async () => itens.map((u) => ({ u, tile: /tile/.test(u) })),
    offlineBaixar: async (u) => { tentativas.set(u, (tentativas.get(u) || 0) + 1); return baixar(u); },
    offlineSondarRede: async (u) => { sondas.push(u); const r = await baixar(u); return r === true || r === 'definitivo'; },
    offlineAnunciarTiles: () => {}, atualizarLinhaDoOffline: () => {}, offlineGravarJanela: () => {},
    offlinePodarTiles: async (manter) => { podas.push([...manter].sort()); return 0; },
    dfato: (k, o) => diario.push([k, o]),
    setTimeout: (fn) => { fn(); return 0; },
  };
  const corpo = fatiar('offlineVarrer')
    .replace(/offlineVarrendo/g, '__st.varrendo').replace(/offlinePedidaDeNovo/g, '__st.pedida')
    .replace(/offlineJanelaServida/g, '__st.janela').replace(/offlineUltimoResultado/g, '__st.resultado')
    .replace(/offlineUltimoGesto/g, '__st.gesto').replace(/offlineFeitosNaJanela/g, '__st.feitos')
    .replace(/offlineEpoca/g, '__st.epoca');
  const chaves = Object.keys(deps);
  const offlineVarrer = new Function(...chaves, '__st', corpo + '\nreturn offlineVarrer;')(...chaves.map((k) => deps[k]), st);
  await offlineVarrer();
  return { st, tentativas, sondas, diario, gravou, podas };
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

// ── R5-4-1: a foto quebrada que é a ÚLTIMA (auditoria de 2026-09-30) ─────────
// O item só virava "defeito do item" se OUTRO terminasse com sucesso entre a 1ª e
// a 3ª tentativa dele — o que nunca acontece com a foto do ÚLTIMO pedido da fila,
// nem com um 404 mais lento que o resto. Ela "desistia pela rede", a preparação
// ficava "parcial" PRA SEMPRE (a janela não virava, o card pedia a foto crua) e
// cada prova de rede refazia a lista INTEIRA (medido no navegador, t2: 39 tiles
// por prova numa fila de 30 pedidos). O teste de cima põe a foto no COMEÇO, com
// um trabalhador só: o caso que nunca falha.
const tiques = (n) => new Promise((ok) => { const um = () => (n-- > 0 ? setImmediate(um) : ok()); um(); });

test('R5-4-1: a foto quebrada no FIM da fila (3 trabalhadores): a SONDA diz que a rede anda, e a preparação fica PRONTA', async () => {
  const itens = [...Array.from({ length: 30 }, (_, i) => 'tile-' + i), 'foto-quebrada'];
  // Os tiles chegam rápido e a foto demora a falhar: quando ela falha pela 1ª
  // vez o resto já terminou, e nada mais anda até ela esgotar.
  const r = await varrer(itens, async (u) => { await tiques(u === 'foto-quebrada' ? 8 : 1); return u !== 'foto-quebrada'; },
    { concorrencia: constante('OFFLINE_CONCORRENCIA') });
  assert.equal(r.tentativas.get('foto-quebrada'), 3, 'PRÉ-CONDIÇÃO: a foto quebrada não esgotou as tentativas');
  assert.ok([...r.tentativas].every(([u, n]) => u === 'foto-quebrada' || n === 1), 'PRÉ-CONDIÇÃO: um tile falhou');
  assert.equal(r.st.resultado, 'pronto', 'a foto quebrada que é a ÚLTIMA deixou a preparação "parcial" — pra sempre');
  assert.notEqual(r.st.janela, null, 'a janela não virou: o card seguiria pedindo a foto crua');
  assert.equal(r.sondas.length, 1, `a rede não foi conferida UMA vez antes de ser culpada (${r.sondas.length})`);
  assert.ok(/^tile-/.test(r.sondas[0]), 'a sonda não pediu um tile desta fila');
});

test('R5-4-1: CONTROLE — com a REDE parada a sonda diz que não: PARCIAL, e numa sonda só pros itens que esgotam juntos', async () => {
  const itens = Array.from({ length: 6 }, (_, i) => 'tile-' + i);
  const r = await varrer(itens, async () => { await tiques(1); return false; }, { concorrencia: constante('OFFLINE_CONCORRENCIA') });
  assert.equal(r.st.resultado, 'parcial', 'com a rede parada a sonda inocentou os itens e a preparação se disse pronta');
  assert.equal(r.st.janela, null);
  assert.equal(r.sondas.length, 1, `numa rede parada, cada item esgotado esperou a sua sonda (${r.sondas.length})`);
});

test('R5-4-1: a RETOMADA do "parcial" baixa só o que FALTOU — e a janela nova (ou o esquecer) renova tudo', async () => {
  const JANELA = 1492385;
  const AGORA = JANELA * 1200000 + 1000;
  const itens = Array.from({ length: 10 }, (_, i) => 'tile-' + i);
  // A rede CAI no meio: do tile-6 em diante nada passa — a sonda também não.
  let caiu = false;
  const a = await varrer(itens, async (u) => { if (u === 'tile-6') caiu = true; return !caiu; }, { agora: AGORA });
  assert.equal(a.st.resultado, 'parcial', 'PRÉ-CONDIÇÃO: com a rede caindo no meio a preparação não ficou parcial');
  // A rede volta, e a retomada (a próxima prova de rede) é na MESMA janela.
  const b = await varrer(itens, async () => true, { st: a.st, agora: AGORA + 60000 });
  assert.equal(b.st.resultado, 'pronto', 'a retomada não terminou a preparação');
  assert.equal(b.st.janela, JANELA);
  assert.deepEqual([...b.tentativas.keys()].sort(), ['tile-6', 'tile-7', 'tile-8', 'tile-9'],
    'a retomada baixou de novo o que já estava pronto — a lista INTEIRA a cada prova de rede');
  assert.deepEqual(b.podas.at(-1), itens.slice().sort(), 'a poda do "pronto" deixou de manter os tiles da fila INTEIRA');
  // CONTROLE: a janela NOVA (20 min) renova tudo — a foto vence, e "só o que
  // faltou" não pode virar "nada".
  const c = await varrer(itens, async () => true, { st: b.st, agora: AGORA + 1200000 });
  assert.equal(c.tentativas.size, 10, 'a janela nova não renovou a lista inteira');
  // E esquecer (outra época) também: o cache que o "pronto" descrevia foi apagado.
  c.st.epoca++;
  const d = await varrer(itens, async () => true, { st: c.st, agora: AGORA + 1200000 + 1000 });
  assert.equal(d.tentativas.size, 10, 'depois de esquecer, a varredura achou que o cache apagado ainda estava pronto');
});

test('offlineBaixar: tile 4xx é "definitivo", 5xx e rede caída são falha de REDE (tenta de novo)', async () => {
  const guardados = [];
  const deps = {
    offlineEpoca: 0, OFFLINE_TILES_CACHE: 'waze-places-tiles', OFFLINE_ITEM_TETO_MS: 30000,
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

function gravarCom({ treinoAgora = false, treinoDuranteOAbrir = false, lugarDaFila = null } = {}) {
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
    // O LUGAR da fila (ver `filaDeOnde`): a busca que a trouxe, ou o de agora.
    filaDeOnde: lugarDaFila, lugarAgora: () => ({ regiao: 'row', pais: '30' }),
    // E o DONO (test/costura-sessao, K6).
    contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, API: { getSession: () => 'tok' },
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

// A cota estourada ABORTA a transação do IndexedDB sem sempre passar pelo
// `onerror`: sem `onabort`, a promessa ficava pendurada e a varredura presa
// (`offlineVarrendo`) pra sempre (auditoria de 2026-09-25).
test('offlineGravarFila: transação ABORTADA (cota) devolve false em vez de pendurar', async () => {
  const AppState = { queue: [{ venueID: 'r1' }], filters: {} };
  const deps = {
    AppState, Treino: { ativo: false }, offlineLigado: () => true, OFFLINE_STORE: 'fila',
    offlineDB: async () => ({ close() {}, transaction: () => {
      const tx = { objectStore: () => ({ put: () => { setTimeout(() => tx.onabort && tx.onabort()); } }) };
      return tx;
    } }),
    offlinePodarPousos: () => {}, dfato: () => {},
    filaDeOnde: null, lugarAgora: () => ({ regiao: 'row', pais: '30' }),
    contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, API: { getSession: () => 'tok' },
  };
  const chaves = Object.keys(deps);
  const gravar = new Function(...chaves, fatiar('offlineGravarFila') + '\nreturn offlineGravarFila;')(...chaves.map((k) => deps[k]));
  const r = await Promise.race([gravar(), new Promise((ok) => setTimeout(() => ok('PENDUROU'), 500))]);
  assert.equal(r, false, 'a gravação abortada pendurou (a varredura ficaria presa)');
});

test('offlineDB: abrir a base tem teto (o IndexedDB do WebKit às vezes não responde)', async () => {
  const deps = { OFFLINE_DB: 'x', OFFLINE_STORE: 'fila', OFFLINE_DB_TETO_MS: 30,
    indexedDB: { open: () => ({}) } };   // nunca chama onsuccess/onerror
  const chaves = Object.keys(deps);
  const abrir = new Function(...chaves, fatiar('offlineDB') + '\nreturn offlineDB;')(...chaves.map((k) => deps[k]));
  await assert.rejects(Promise.race([abrir(), new Promise((_, n) => setTimeout(() => n(new Error('PENDUROU')), 500))]), /timeout/);
});

// ── O4: a fila guardada é de UM LUGAR (auditoria de 2026-09-26) ─────────────
// Ela não dizia de que região nem de que país era: trocar de região, ver a
// busca nova vir vazia e reabrir sem rede mostrava a fila da região VELHA sob o
// filtro novo — e o ✕ saía pro servidor da região nova, voltava "não
// encontrado" e contava como feito (medido no navegador, p10).
test('O4: a fila guardada leva o LUGAR da busca que a trouxe (e o de agora, sem busca)', async () => {
  const a = gravarCom({ lugarDaFila: { regiao: 'na', pais: '235' } });
  assert.equal(await a.gravar(), true);
  assert.equal(a.puts[0].regiao, 'na', 'a fila guardada não diz de que região é');
  assert.equal(a.puts[0].pais, '235', 'a fila guardada não diz de que país é');
  const b = gravarCom();
  await b.gravar();
  assert.deepEqual([b.puts[0].regiao, b.puts[0].pais], ['row', '30']);
});

function reabrir({ guardada, agora }) {
  const log = [];
  const AppState = { queue: [], hasMore: false, loadError: true, serverTotal: 0 };
  const deps = {
    AppState, navigator: { onLine: false }, offlineLigado: () => true,
    offlineLerFila: async () => guardada, offlineLerJanela: async () => null,
    lugarAgora: () => agora, dfato: (k) => log.push(k),
    semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
    pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {},
    updatePendingCount: () => {}, sortQueue: () => {}, showCurrentPlace: () => log.push('card'),
    // O DONO da fila guardada (test/costura-sessao, K6): a mesma conta.
    contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, API: { getSession: () => 'tok' },
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let offlineJanelaServida = null, filaDeOnde = null;
    ${fatiar('mesmoLugar')}\n${fatiar('filaGuardadaDestaConta')}\n${fatiar('offlineTentarAbrirSemRede')}
    return { abrir: offlineTentarAbrirSemRede, onde: () => filaDeOnde };`)(...chaves.map((k) => deps[k]));
  return { app, AppState, log };
}
const GUARDADA = (lugar) => ({ t: Date.now(), desde: Date.now(), conta: '111', ...lugar, places: [{ venueID: 'v1', updateRequestID: 'u1' }] });

test('O4: a reabertura sem rede RECUSA a fila de OUTRO lugar — e abre a do mesmo', async () => {
  const outra = reabrir({ guardada: GUARDADA({ regiao: 'row', pais: '30' }), agora: { regiao: 'na', pais: '235' } });
  assert.equal(await outra.app.abrir(), false, 'a fila da região velha abriu sob o filtro novo');
  assert.deepEqual(outra.AppState.queue, [], 'a fila de outro lugar entrou na tela');
  // Recusa, e NÃO apaga (R5-4-2: ver o teste com a base de mentira, mais abaixo).
  assert.ok(outra.log.includes('offline.outroLugar'));
  // O PAÍS também: mesma região, outro país.
  const pais = reabrir({ guardada: GUARDADA({ regiao: 'row', pais: '30' }), agora: { regiao: 'row', pais: '73' } });
  assert.equal(await pais.app.abrir(), false, 'a fila de outro país abriu');
  // Sem o lugar (versão anterior): não há como saber de onde é.
  const velha = reabrir({ guardada: GUARDADA({}), agora: { regiao: 'row', pais: '30' } });
  assert.equal(await velha.app.abrir(), false, 'a fila sem lugar abriu — pode ser de outra região');
  // CONTROLE: a do mesmo lugar abre (senão "recusar tudo" passaria no teste).
  const mesma = reabrir({ guardada: GUARDADA({ regiao: 'row', pais: '30' }), agora: { regiao: 'row', pais: '30' } });
  assert.equal(await mesma.app.abrir(), true, 'CONTROLE: a fila do mesmo lugar não abriu');
  assert.deepEqual(mesma.AppState.queue.map((p) => p.venueID), ['v1']);
  // O lugar da fila reaberta leva também a assinatura da busca (R4-O8) — aqui
  // ausente dos dois lados, que é o que o instrumento deste teste simula.
  assert.deepEqual(mesma.app.onde(), { regiao: 'row', pais: '30', busca: undefined }, 'a fila reaberta não sabe de onde é');
});

test('O4: a busca anota de onde é o que trouxe, e a fila nova zera o lugar (sem apagar a fila guardada)', async () => {
  // Todo caminho que troca de lugar zera a fila por `resetQueue`, e a busca
  // anota de onde é o que trouxe.
  const reset = fatiar('resetQueue');
  assert.match(reset, /filaDeOnde = null;/, 'a fila nova não zerou o lugar');
  const busca = fatiar('fetchNextPage');
  const iLugar = busca.indexOf('const lugarDaBusca = lugarAgora();');
  assert.ok(iLugar > 0 && iLugar < busca.indexOf('await API.fetchPlaces('), 'o lugar da busca tem que ser o do PEDIDO');
  assert.match(busca, /registrarEntradaNaFila\(newPlaces\);\s*filaDeOnde = lugarDaBusca;/,
    'o que a busca traz não diz de que lugar é');
});

// ── O9: a varredura tem TETO de tempo (auditoria de 2026-09-26) ──────────────
// Portal cativo, sinal indo e voltando: a requisição sai e nada volta. O
// `fetch` do tile e a `<img>` da foto não tinham teto, então a varredura ficava
// "varrendo" pra sempre e todo gatilho novo só marcava `offlinePedidaDeNovo`
// (medido no navegador, p9: 60 s depois, ainda varrendo).
test('O9: download PENDURADO estoura o teto — tile e foto — e conta como falha de rede (`teto`)', async () => {
  let cancelouFoto = false;
  class ImagemPendurada {
    set src(v) { if (v === '') cancelouFoto = true; }
  }
  const deps = { offlineEpoca: 0, OFFLINE_TILES_CACHE: 'waze-places-tiles', OFFLINE_ITEM_TETO_MS: 30,
    caches: { open: async () => ({ put: async () => {} }) }, Image: ImagemPendurada };
  const chaves = Object.keys(deps);
  // O `fetch` pendurado só termina se o pedido for ABORTADO — como na rede de verdade.
  const pendurado = (u, opts) => new Promise((_, falha) => {
    if (opts && opts.signal) opts.signal.addEventListener('abort', () => falha(new DOMException('abortado', 'AbortError')));
  });
  const baixar = new Function(...chaves, 'fetch', fatiar('offlineBaixar') + '\nreturn offlineBaixar;')(...chaves.map((k) => deps[k]), pendurado);
  const comTeto = (p) => Promise.race([p, new Promise((ok) => setTimeout(() => ok('PENDUROU'), 800))]);
  assert.equal(await comTeto(baixar('https://www.waze.com/row-tiles/live/base/1', true)), 'teto',
    'o tile pendurado prendeu a varredura (sem teto)');
  assert.equal(await comTeto(baixar('https://venue-image.waze.com/f.jpg', false)), 'teto',
    'a foto pendurada prendeu a varredura (sem teto)');
  assert.ok(cancelouFoto, 'desistir da foto não CANCELOU o download (o src segue pendurado)');
});

test('O9: uma RODADA de downloads pendurados para a varredura — "parcial", sem gastar o teto em cada item', async () => {
  const itens = Array.from({ length: 20 }, (_, i) => 'tile-' + i);
  const { st, tentativas } = await varrer(itens, () => 'teto');
  assert.equal(st.resultado, 'parcial');
  const total = [...tentativas.values()].reduce((a, b) => a + b, 0);
  assert.ok(total <= 2, `a varredura seguiu com a rede pendurada: ${total} downloads (cada um gasta o teto inteiro)`);
  // CONTROLE: falha de rede IMEDIATA (não pendurada) segue a regra de sempre —
  // cada item tentado até o teto de tentativas, sem parar na primeira rodada.
  const rede = await varrer(itens.slice(0, 4), () => false);
  assert.ok([...rede.tentativas.values()].every((n) => n >= 2), 'a falha imediata passou a parar a varredura como a pendurada');
});

// ── O3: a preparação PARCIAL na MESMA janela é retomada (auditoria de 2026-09-29)
// A varredura da REPOSIÇÃO (os pedidos novos que a busca trouxe) roda na mesma
// janela de 20 min da última preparação completa. O sinal caindo no meio dela
// deixava "parcial" — e a linha dizendo "Continua sozinho quando houver rede" —,
// mas todo gatilho passa pelo `offlineTalvezVarrer`, que só varria com a janela
// VIRADA: a rede voltava e nada acontecia até ela virar (medido no navegador:
// zero tiles pedidos depois da volta do sinal, contra 30 com a janela anterior).
// Aqui as três funções rodam de VERDADE, sobre o mesmo estado.
function gatilhosDaVarredura(janela) {
  const AGORA = janela * 1200000 + 1000;
  const tentativas = new Map();
  const rede = { ok: false };
  const st = { varrendo: false, pedida: false, janela, resultado: 'pronto', gesto: AGORA, epoca: 0,
    feitos: { janela: null, epoca: -1, us: new Set() } };
  const deps = {
    AppState: { authenticated: true, queue: [{ venueID: 'v' }] }, Treino: { ativo: false },
    navigator: { onLine: true }, offlineLigado: () => true, Date: { now: () => AGORA },
    OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: 1200000, OFFLINE_CONCORRENCIA: 1,
    OFFLINE_ANUNCIAR_A_CADA: 50, OFFLINE_TENTATIVAS_POR_ITEM: constante('OFFLINE_TENTATIVAS_POR_ITEM'),
    offlineGravarFila: async () => {}, offlineItensDaFila: async () => ['tile-1', 'tile-2'].map((u) => ({ u, tile: true })),
    offlineBaixar: async (u) => { tentativas.set(u, (tentativas.get(u) || 0) + 1); return rede.ok; },
    offlineSondarRede: async () => rede.ok,
    offlineAnunciarTiles: () => {}, atualizarLinhaDoOffline: () => {}, offlineGravarJanela: () => {},
    offlinePodarTiles: async () => 0, dfato: () => {}, setTimeout: (fn) => { fn(); return 0; },
  };
  const corpo = ['offlinePrecisaVarrer', 'offlineTalvezVarrer', 'offlineVarrer'].map(fatiar).join('\n')
    .replace(/offlineVarrendo/g, '__st.varrendo').replace(/offlinePedidaDeNovo/g, '__st.pedida')
    .replace(/offlineJanelaServida/g, '__st.janela').replace(/offlineUltimoResultado/g, '__st.resultado')
    .replace(/offlineUltimoGesto/g, '__st.gesto').replace(/offlineFeitosNaJanela/g, '__st.feitos')
    .replace(/offlineEpoca/g, '__st.epoca');
  const chaves = Object.keys(deps);
  const f = new Function(...chaves, '__st', corpo + '\nreturn { offlinePrecisaVarrer, offlineTalvezVarrer, offlineVarrer };')(
    ...chaves.map((k) => deps[k]), st);
  const total = () => [...tentativas.values()].reduce((a, b) => a + b, 0);
  return { f, st, rede, total };
}
const assentar = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

test('R4-O3: preparação PARCIAL na MESMA janela é retomada pelo próximo gatilho — a promessa da linha', async () => {
  const janela = 1492263;
  const g = gatilhosDaVarredura(janela);
  // A reposição na mesma janela, com o sinal caindo no meio: "parcial".
  await g.f.offlineVarrer();
  assert.equal(g.st.resultado, 'parcial', 'PRÉ-CONDIÇÃO: a varredura sem rede não ficou parcial');
  assert.equal(g.st.janela, janela, 'PRÉ-CONDIÇÃO: a janela servida mudou (o cenário é o da MESMA janela)');
  // O sinal volta; um gatilho qualquer (a prova de rede, o `online`, as Preferências).
  g.rede.ok = true;
  const antes = g.total();
  g.f.offlineTalvezVarrer();
  await assentar();
  assert.ok(g.total() > antes, 'com a rede de volta, a preparação parcial NÃO foi retomada — só a janela virando a retomava');
  assert.equal(g.st.resultado, 'pronto', 'a retomada não terminou a preparação');
});

test('R4-O3: CONTROLE — pronta na mesma janela não varre de novo; e com a varredura NO AR, o fim dela decide', async () => {
  const janela = 1492263;
  const pronta = gatilhosDaVarredura(janela);
  pronta.f.offlineTalvezVarrer();
  await assentar();
  assert.equal(pronta.total(), 0, 'a preparação PRONTA foi varrida de novo na mesma janela (gasto à toa)');
  const noAr = gatilhosDaVarredura(janela);
  noAr.st.resultado = 'parcial';
  noAr.st.varrendo = true;
  assert.equal(noAr.f.offlinePrecisaVarrer(), false, 'com a varredura no ar, o parcial de ANTES pediu outra');
  // E a janela virada segue valendo como sempre (o outro caminho da mesma função).
  const virou = gatilhosDaVarredura(janela);
  virou.st.janela = janela - 1;
  assert.equal(virou.f.offlinePrecisaVarrer(), true, 'a janela virada deixou de pedir a varredura');
});

// ── O9: ligar o "Disponível offline" JÁ SEM REDE grava a fila (auditoria de 2026-09-29)
// A linha dizia "3 pedidos guardados. O mapa e as fotos chegam quando houver
// rede." e NADA tinha sido gravado: a varredura sai antes do `offlineGravarFila`
// quando `onLine === false` — e guardar o texto não precisa de rede. Fechado e
// reaberto sem rede, a tela era a de "sem conexão" (medido no navegador, f7).
// O interruptor roda de VERDADE, com a varredura de verdade atrás dele.
function interruptor(onLine) {
  const gravacoes = [];
  const log = [];
  const AppState = { authenticated: true, queue: [{ venueID: 'v1' }, { venueID: 'v2' }, { venueID: 'v3' }], preferences: {} };
  const st = { varrendo: false, pedida: false, janela: null, resultado: 'parcial', gesto: 0, epoca: 0,
    feitos: { janela: null, epoca: -1, us: new Set() } };
  const deps = {
    AppState, Treino: { ativo: false }, navigator: { onLine },
    offlineLigado: () => AppState.preferences.offlineDisponivel === true,
    savePreferences: () => log.push('salvou'), offlineEsquecer: () => log.push('esqueceu'),
    atualizarLinhaDoOffline: () => log.push('linha'),
    OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: 1200000, OFFLINE_CONCORRENCIA: 1,
    OFFLINE_ANUNCIAR_A_CADA: 50, OFFLINE_TENTATIVAS_POR_ITEM: constante('OFFLINE_TENTATIVAS_POR_ITEM'),
    offlineGravarFila: async () => { gravacoes.push(AppState.queue.length); return true; },
    offlineItensDaFila: async () => [], offlineBaixar: async () => true, offlineSondarRede: async () => true,
    offlineAnunciarTiles: () => {}, offlineGravarJanela: () => {}, offlinePodarTiles: async () => 0,
    dfato: () => {}, setTimeout: (fn) => { fn(); return 0; },
  };
  const corpo = ['offlineMarcarGesto', 'offlineVarrer', 'offlineAoMudarInterruptor'].map(fatiar).join('\n')
    .replace(/offlineVarrendo/g, '__st.varrendo').replace(/offlinePedidaDeNovo/g, '__st.pedida')
    .replace(/offlineJanelaServida/g, '__st.janela').replace(/offlineUltimoResultado/g, '__st.resultado')
    .replace(/offlineUltimoGesto/g, '__st.gesto').replace(/offlineFeitosNaJanela/g, '__st.feitos')
    .replace(/offlineEpoca/g, '__st.epoca');
  const chaves = Object.keys(deps);
  const f = new Function(...chaves, '__st', corpo + '\nreturn offlineAoMudarInterruptor;')(...chaves.map((k) => deps[k]), st);
  return { ligar: (v) => f(v), gravacoes, log, st, AppState };
}

test('R4-O9: ligar o "Disponível offline" JÁ SEM REDE grava a fila na hora — guardar o texto não precisa de rede', async () => {
  const i = interruptor(false);
  i.ligar(true);
  await assentar();
  assert.equal(i.AppState.preferences.offlineDisponivel, true);
  assert.deepEqual(i.gravacoes, [3], 'ligado sem rede, a fila NÃO foi gravada — a linha diria "3 pedidos guardados" sem nada guardado');
  assert.equal(i.st.resultado, null, 'o resultado da varredura anterior não foi zerado ao religar');
});

test('R4-O9: CONTROLE — com rede a fila é gravada (pela varredura também), e desligar esquece', async () => {
  const i = interruptor(true);
  i.ligar(true);
  await assentar();
  assert.ok(i.gravacoes.length >= 1 && i.gravacoes.every((n) => n === 3), `com rede a fila não foi gravada: ${JSON.stringify(i.gravacoes)}`);
  i.ligar(false);
  assert.ok(i.log.includes('esqueceu'), 'desligar não esqueceu o que foi guardado');
  // E o interruptor da tela é ESTA função (não uma cópia dela).
  assert.match(APP_SEM, /\$\('prefOfflineDisponivel'\)\?\.addEventListener\('change', \(e\) => offlineAoMudarInterruptor\(e\.target\.checked\)\);/,
    'o interruptor da tela não passa mais pela função testada');
});

// ── R4-O8: a fila guardada é da BUSCA — o filtro também (auditoria de 2026-09-29)
// O O4 fechou região e país; os FILTROS eram gravados junto da fila e nunca
// lidos. Trocar de estado (ou de tipos, categoria, "Minha área", residencial,
// "lidos também"), ver a busca nova vir vazia e reabrir sem rede mostrava a fila
// do filtro VELHO sob o novo (medido no navegador, f1: estado 5 e só "Nova foto"
// abriam os 3 pedidos do Brasil inteiro). Aqui o aparelho roda de VERDADE: os
// filtros passam pelo armazenamento (`saveFilters`/`loadFilters`), a assinatura
// é a real, e a base é uma de mentira que sobrevive às "páginas".
const EXPR = (nome) => new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM)[1];
const TYPES_ALL_R = new Function('return ' + EXPR('TYPES_ALL'))();
const TYPES_PADRAO_R = new Function('TYPES_ALL', 'return ' + EXPR('TYPES_PADRAO'))(TYPES_ALL_R);
function aparelhoO8() {
  const ls = new Map();
  const base = new Map();
  const offlineDB = async () => ({
    close() {},
    transaction: () => {
      const tx = {};
      const fim = () => setTimeout(() => tx.oncomplete && tx.oncomplete());
      tx.objectStore = () => ({
        put: (v, k) => { base.set(k, JSON.parse(JSON.stringify(v))); fim(); },
        get: (k) => { const r = {}; setTimeout(() => { r.result = base.get(k); if (r.onsuccess) r.onsuccess(); fim(); }); return r; },
        delete: (k) => { base.delete(k); },
      });
      return tx;
    },
  });
  // Uma "página": memória nova, o armazenamento e a base de sempre.
  return function pagina({ onLine = false } = {}) {
    const log = [];
    const AppState = { queue: [], hasMore: false, loadError: true, serverTotal: 0, filters: null,
      stats: { skipped: 0 }, fetchEpoch: 0 };
    const deps = {
      AppState, navigator: { onLine }, Treino: { ativo: false }, offlineLigado: () => true,
      localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
      FILTERS_KEY: 'waze_places_filters', TYPES_ALL: TYPES_ALL_R, TYPES_PADRAO: TYPES_PADRAO_R, ORDEM_PADRAO: 'newest',
      API: { getRegion: () => 'row', getCountry: () => 30, getSession: () => 'tok' },
      offlineDB, OFFLINE_STORE: 'fila', offlinePodarPousos: () => {}, offlineLerJanela: async () => null,
      contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, dfato: (k, o) => log.push([k, o || {}]),
      semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
      pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {},
      updatePendingCount: () => {}, sortQueue: () => {}, showCurrentPlace: () => log.push(['card', {}]),
      // O `resetQueue` de verdade (a fila nova do Aplicar, R5-4-2).
      enviarPendenciasDoLightbox: () => {}, removeUndoBanner: () => {}, bloqueadosPorPagina: new Map(),
    };
    const nomes = ['ordemDoWaze', 'assinaturaDeBusca', 'lugarAgora', 'mesmoLugar', 'sanearTiposSalvos', 'filtrosDeFabrica',
      'saveFilters', 'loadFilters', 'offlineLerFila', 'offlineGravarFila', 'resetQueue',
      'filaGuardadaDestaConta', 'offlineTentarAbrirSemRede'];
    const chaves = Object.keys(deps);
    const app = new Function(...chaves, `let filaDeOnde = null, offlineJanelaServida = null, tratouNestaFila = false,
        filaAtravessouSessao = false, puladosNoInicioDaFila = 0, filaEsperaPerfil = false, rebuscasAuto = 0;
      ${nomes.map(fatiar).join('\n')}
      AppState.filters = filtrosDeFabrica();
      loadFilters();
      return { saveFilters, lugarAgora, offlineGravarFila, resetQueue, offlineTentarAbrirSemRede,
        buscou: (places) => { AppState.queue = places; filaDeOnde = lugarAgora(); } };`)(...chaves.map((k) => deps[k]));
    return { app, AppState, log, base };
  };
}
const PEDIDOS_O8 = () => [1, 2, 3].map((i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i }));
// A busca com rede traz a fila e a grava; a pessoa muda o filtro (e o grava);
// o app é fechado e reaberto SEM rede.
async function guardarMudarReabrir(mudar) {
  const pagina = aparelhoO8();
  const a = pagina({ onLine: true });
  a.app.buscou(PEDIDOS_O8());
  assert.equal(await a.app.offlineGravarFila(Date.now()), true, 'PRÉ-CONDIÇÃO: a fila não foi gravada');
  mudar(a.AppState.filters);
  a.app.saveFilters();
  const b = pagina({ onLine: false });
  const abriu = await b.app.offlineTentarAbrirSemRede();
  return { abriu, b, pagina };
}

test('R4-O8: reaberta sem rede sob OUTRO FILTRO, a fila guardada do filtro anterior não entra — cada filtro da busca', async () => {
  const mudancas = {
    estado: (f) => { f.stateId = '5'; },
    tipos: (f) => { f.types = ['NEW_PHOTO']; },
    categoria: (f) => { f.categories = ['PARK']; },
    'minha área': (f) => { f.myArea = true; },
    residencial: (f) => { f.residential = 'true'; },
    'lidos também': (f) => { f.unreadOnly = false; },
    'área gerenciada': (f) => { f.managedAreaId = '77'; },
  };
  for (const [nome, mudar] of Object.entries(mudancas)) {
    const r = await guardarMudarReabrir(mudar);
    assert.equal(r.abriu, false, `trocado o filtro (${nome}), a fila guardada do filtro anterior ABRIU`);
    assert.deepEqual(r.b.AppState.queue, [], `a fila do outro filtro (${nome}) entrou na tela`);
    const ev = r.b.log.find(([k]) => k === 'offline.outroLugar');
    assert.ok(ev && ev[1].filtro === true, `o diário não diz que foi o FILTRO (${nome}): ${JSON.stringify(r.b.log)}`);
  }
});

test('R4-O8: CONTROLE — trocar só a ORDEM (ou nada) mantém a fila guardada: ela abre depois de fechar e reabrir', async () => {
  for (const [nome, mudar] of Object.entries({
    nada: () => {},
    'mais antigos': (f) => { f.sortOrder = 'oldest'; },
    'perto de casa': (f) => { f.sortOrder = 'casa'; },
  })) {
    const r = await guardarMudarReabrir(mudar);
    assert.equal(r.abriu, true, `trocada só a ordem (${nome}), a fila guardada não abriu — a assinatura não sobrevive ao armazenamento`);
    assert.deepEqual(r.b.AppState.queue.map((p) => p.venueID), ['v1', 'v2', 'v3']);
  }
});

test('R4-O8: a assinatura sobrevive a fechar e reabrir mesmo com os tipos gravados FORA da ordem canônica', async () => {
  // O `loadFilters` normaliza os tipos pela ordem de `TYPES_ALL` (`sanearTiposSalvos`):
  // a MESMA escolha, lida do armazenamento, volta noutra ordem.
  const r = await guardarMudarReabrir((f) => { f.types = ['NEW_PHOTO', 'NEW_PLACE']; });
  assert.equal(r.abriu, false, 'PRÉ-CONDIÇÃO: trocar os tipos não recusou');
  // Agora a fila é gravada JÁ com os tipos fora de ordem — a escolha não muda.
  const pagina = aparelhoO8();
  const a = pagina({ onLine: true });
  a.AppState.filters.types = ['NEW_PHOTO', 'NEW_PLACE'];
  a.app.saveFilters();
  a.app.buscou(PEDIDOS_O8());
  await a.app.offlineGravarFila(Date.now());
  const b = pagina({ onLine: false });
  assert.deepEqual(b.AppState.filters.types, ['NEW_PLACE', 'NEW_PHOTO'], 'PRÉ-CONDIÇÃO: a leitura não normalizou a ordem');
  assert.equal(await b.app.offlineTentarAbrirSemRede(), true, 'a MESMA escolha de tipos, relida noutra ordem, recusou a fila');
});

test('R4-O8: fila guardada SEM a assinatura (versão anterior) não entra — não há como saber de que filtro é', async () => {
  const pagina = aparelhoO8();
  const a = pagina({ onLine: true });
  a.app.buscou(PEDIDOS_O8());
  await a.app.offlineGravarFila(Date.now());
  const velha = a.base.get('fila');
  delete velha.busca;
  a.base.set('fila', velha);
  const b = pagina({ onLine: false });
  assert.equal(await b.app.offlineTentarAbrirSemRede(), false, 'a fila sem assinatura abriu — pode ser de outro filtro');
});

// ── R5-4-2: trocar o filtro SEM REDE não apaga a fila guardada (auditoria de 2026-09-30)
// O `resetQueue` do Aplicar esquecia a fila "de outro lugar" antes de existir
// uma busca que a substituísse, e a reabertura sob o filtro novo também a
// apagava: sem rede, a preparação inteira sumia no meio da estrada, e voltar ao
// filtro de antes não a trazia mais (medido no navegador, t4 "filtroVolta":
// "fila guardada no aparelho agora: 0"). Aqui roda o `resetQueue` de VERDADE,
// como o Aplicar faz, com a base de mentira sobrevivendo às "páginas".
test('R5-4-2: trocar o filtro SEM REDE e voltar ao de antes: a fila guardada continua no aparelho e abre', async () => {
  const pagina = aparelhoO8();
  const a = pagina({ onLine: true });
  a.app.buscou(PEDIDOS_O8());
  assert.equal(await a.app.offlineGravarFila(Date.now()), true, 'PRÉ-CONDIÇÃO: a fila não foi gravada');
  // Sem rede: desmarca "Nova foto" e Aplica — a fila nova do Aplicar.
  const b = pagina({ onLine: false });
  b.AppState.filters.types = b.AppState.filters.types.filter((x) => x !== 'NEW_PHOTO');
  b.app.saveFilters();
  b.app.resetQueue();
  await assentar();
  assert.ok(b.base.has('fila'), 'trocar o filtro sem rede APAGOU a fila guardada — a preparação some no meio da estrada');
  // Sob o filtro novo, a fila do outro filtro não entra (o O8) — e a recusa não a apaga.
  assert.equal(await b.app.offlineTentarAbrirSemRede(), false, 'a fila do filtro anterior abriu sob o filtro novo');
  await assentar();
  assert.ok(b.base.has('fila'), 'a reabertura sob o filtro novo APAGOU a fila guardada');
  // De volta ao filtro de antes, ainda sem rede: remarca e Aplica.
  b.AppState.filters.types = [...b.AppState.filters.types, 'NEW_PHOTO'];
  b.app.saveFilters();
  b.app.resetQueue();
  await assentar();
  const c = pagina({ onLine: false });
  assert.equal(await c.app.offlineTentarAbrirSemRede(), true, 'de volta ao filtro de antes, sem rede, a fila guardada não abriu');
  assert.deepEqual(c.AppState.queue.map((p) => p.venueID), ['v1', 'v2', 'v3']);
});

test('R5-4-2: CONTROLE — sem trocar nada, a fila nova não mexe na guardada; e a busca com rede do filtro novo a REGRAVA', async () => {
  const pagina = aparelhoO8();
  const a = pagina({ onLine: true });
  a.app.buscou(PEDIDOS_O8());
  await a.app.offlineGravarFila(Date.now());
  a.app.resetQueue();
  await assentar();
  const b = pagina({ onLine: false });
  assert.equal(await b.app.offlineTentarAbrirSemRede(), true, 'CONTROLE: a fila nova do MESMO filtro estragou a guardada');
  // Com rede, o filtro novo traz a fila dele e a grava por cima: não sobra a velha
  // (é por isso que não é preciso apagar na troca).
  const c = pagina({ onLine: true });
  c.AppState.filters.stateId = '5';
  c.app.saveFilters();
  c.app.resetQueue();
  c.app.buscou([{ venueID: 'v9', updateRequestID: 'u9' }]);
  await c.app.offlineGravarFila(Date.now());
  const d = pagina({ onLine: false });
  assert.equal(await d.app.offlineTentarAbrirSemRede(), true);
  assert.deepEqual(d.AppState.queue.map((p) => p.venueID), ['v9'], 'a busca do filtro novo não regravou a fila guardada');
});

test('R4-O8: a fila REABERTA e regravada (a varredura grava de novo) segue sendo da mesma busca', async () => {
  const pagina = aparelhoO8();
  const a = pagina({ onLine: true });
  a.app.buscou(PEDIDOS_O8());
  await a.app.offlineGravarFila(Date.now());
  const b = pagina({ onLine: false });
  assert.equal(await b.app.offlineTentarAbrirSemRede(), true, 'PRÉ-CONDIÇÃO: a fila guardada não abriu');
  // A varredura grava a fila viva no começo dela (sem `desde`): o lugar é o da
  // fila reaberta (`filaDeOnde`), que tem de levar a assinatura junto.
  assert.equal(await b.app.offlineGravarFila(), true);
  const c = pagina({ onLine: false });
  assert.equal(await c.app.offlineTentarAbrirSemRede(), true,
    'a fila reaberta, regravada, perdeu a assinatura da busca — a próxima reabertura a recusou');
});

// ── R4-O1: a busca que falha por REDE abre a fila guardada (auditoria de 2026-09-29)
// "Lie-fi" (o `onLine` diz que há rede e nada passa: túnel, uma barra, portal
// que não responde) e a origem fora do ar (5xx): a reabertura só usava a fila
// guardada com `onLine === false`, então a busca esperava o teto de 45 s e a
// tela virava "Falha ao carregar" — com a fila preparada no aparelho, sem uso
// (medido no navegador, h2). Aqui o aparelho roda de VERDADE: o `startFetching`,
// o `fetchNextPage`, a fila guardada e a assinatura reais, contra uma API de
// mentira, com a base sobrevivendo às "páginas".
const PREFETCH_R = Number(EXPR('PREFETCH_THRESHOLD'));
const MAX_VAZIAS_R = Number(EXPR('MAX_EMPTY_PAGES'));
const MAX_PAGINAS_R = Number(EXPR('MAX_PAGINAS_POR_BUSCA'));
const FALHA_REDE = { success: false, error: 'rede', errorCategory: 'transient' };
const FALHA_SESSAO = { success: false, error: 'sessão', errorCategory: 'unauthorized' };
function aparelhoO1() {
  const ls = new Map();
  const base = new Map();
  const offlineDB = async () => ({
    close() {},
    transaction: () => {
      const tx = {};
      const fim = () => setTimeout(() => tx.oncomplete && tx.oncomplete());
      tx.objectStore = () => ({
        put: (v, k) => { base.set(k, JSON.parse(JSON.stringify(v))); fim(); },
        get: (k) => { const r = {}; setTimeout(() => { r.result = base.get(k); if (r.onsuccess) r.onsuccess(); fim(); }); return r; },
        delete: (k) => { base.delete(k); },
      });
      return tx;
    },
  });
  return function pagina({ onLine = true, offline = true, api }) {
    const log = [];
    const AppState = {
      authenticated: true, hasMore: true, fetching: false, fetchEpoch: 0, queue: [], currentPlace: null,
      serverTotal: 0, serverBlocked: 0, blockedPartial: false, loadError: false, ultimaBusca: null, profile: null, filters: null,
    };
    const el = () => ({ classList: { add() {}, remove() {} } });
    const deps = {
      AppState, navigator: { onLine }, Treino: { ativo: false }, offlineLigado: () => offline, console: { error: () => {} },
      localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
      FILTERS_KEY: 'waze_places_filters', TYPES_ALL: TYPES_ALL_R, TYPES_PADRAO: TYPES_PADRAO_R, ORDEM_PADRAO: 'newest',
      PREFETCH_THRESHOLD: PREFETCH_R, MAX_EMPTY_PAGES: MAX_VAZIAS_R, MAX_PAGINAS_POR_BUSCA: MAX_PAGINAS_R,
      API: { getRegion: () => 'row', getCountry: () => 30, getSession: () => 'tok', fetchPlaces: async (p) => api(p) },
      offlineDB, OFFLINE_STORE: 'fila', offlinePodarPousos: () => {}, offlineLerJanela: async () => null,
      contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, dfato: (k, o) => log.push([k, o || {}]),
      dlog: () => {}, dlogVigiar: () => {}, dlogVoltou: () => {}, dlogCapturarAuto: () => {},
      handleUnauthorized: () => log.push(['sessao', {}]), showToast: () => {}, msgDoServidor: (r, d) => d, t: (k) => k,
      guardarPrazoDaSessao: () => {}, trackSeenCategories: () => {}, sortQueue: () => {}, aplicarRecusaAutomatica: () => {},
      aoMudarAFilaPorBaixo: () => {}, updatePendingCount: () => {}, offlineVarrer: () => {},
      bloqueadosPorPagina: new Map(), pedidosQueEntraramNaFila: new Set(), pedidosEmAndamento: new Set(),
      pousosDaPagina: new Map(), offlineLerPousos: () => [], carregarFilaDeSaida: () => [],
      refazerPerfilSeFaltar: () => {}, showLoading: () => {}, removeCurrentCardEl: () => {},
      document: { getElementById: el },
      // A tela vazia diz se é a de FALHA (`loadError`) ou o "Tudo limpo!": o
      // instrumento que não distingue as duas conta uma pela outra.
      showCurrentPlace: () => log.push(['card', {}]), maybePrefetch: () => {},
      showNoPlaces: () => log.push([AppState.loadError ? 'falha' : 'tudoLimpo', {}]),
    };
    const nomes = ['ordemDoWaze', 'assinaturaDeBusca', 'lugarAgora', 'mesmoLugar', 'sanearTiposSalvos', 'filtrosDeFabrica',
      'loadFilters', 'offlineLerFila', 'offlineGravarFila', 'filaGuardadaDestaConta',
      'offlineTentarAbrirSemRede', 'chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila',
      'ordemPrecisaDaFilaInteira', 'fetchNextPage', 'startFetching', 'abrirGuardadaDepoisDaFalha'];
    const chaves = Object.keys(deps);
    const app = new Function(...chaves, `let filaDeOnde = null, offlineJanelaServida = null, ultimaBuscaFalhouPorRede = false,
        abrindoGuardadaDepoisDaFalha = null, rebuscasAuto = 0, filaEsperaPerfil = false;
      ${nomes.map(fatiar).join('\n')}
      AppState.filters = filtrosDeFabrica();
      loadFilters();
      return { startFetching, abrirGuardadaDepoisDaFalha, offlineTentarAbrirSemRede,
        falhouPorRede: () => ultimaBuscaFalhouPorRede };`)(...chaves.map((k) => deps[k]));
    return { app, AppState, log, deps, base };
  };
}
const TRES = () => ({ success: true, places: PEDIDOS_O8(), hasMore: false, page: 1, total: 3, blocked: 0 });
// Com rede: a busca traz a fila, e o "Disponível offline" a grava.
async function prepararO1(opcoes = {}) {
  const pagina = aparelhoO1();
  const a = pagina({ api: () => TRES(), ...opcoes });
  await a.app.startFetching();
  await assentar();
  assert.equal(a.base.has('fila'), opcoes.offline !== false, 'PRÉ-CONDIÇÃO: a fila da busca não foi (ou foi) gravada');
  return pagina;
}
const eventos = (p, k) => p.log.filter(([e]) => e === k);

test('R4-O1: abertura com o `onLine` verdadeiro e a busca FALHANDO por rede (lie-fi, 5xx): a fila guardada entra', async () => {
  const pagina = await prepararO1();
  const b = pagina({ onLine: true, api: () => FALHA_REDE });
  await b.app.startFetching();
  assert.deepEqual(b.AppState.queue.map((p) => p.venueID), ['v1', 'v2', 'v3'],
    'a busca falhou por rede com a fila guardada no aparelho, e ela NÃO entrou (a tela seria "Falha ao carregar")');
  assert.equal(eventos(b, 'falha').length + eventos(b, 'tudoLimpo').length, 0,
    'a tela vazia (de falha ou "Tudo limpo!") apareceu por cima, ou antes, da fila guardada');
  assert.equal(eventos(b, 'card').length, 1, 'o card da fila guardada não foi mostrado UMA vez');
  assert.equal(b.AppState.hasMore, true, 'a fila guardada diz que acabou: a busca não sai de novo quando a rede voltar');
  const abriu = eventos(b, 'offline.abriu')[0];
  assert.ok(abriu && abriu[1].aposFalha === true, 'o diário não diz que abriu com o aparelho dizendo que há rede');
});

test('R4-O1: CONTROLE — sem o offline, a mesma falha é a tela de falha; e 401 (sessão) nunca abre a fila guardada', async () => {
  const semOffline = await prepararO1({ offline: false });
  const b = semOffline({ onLine: true, offline: false, api: () => FALHA_REDE });
  await b.app.startFetching();
  assert.equal(eventos(b, 'falha').length, 1, 'CONTROLE: sem fila guardada, a falha não virou a tela de falha');
  assert.deepEqual(b.AppState.queue, []);
  const pagina = await prepararO1();
  const c = pagina({ onLine: true, api: () => FALHA_SESSAO });
  await c.app.startFetching();
  assert.deepEqual(c.AppState.queue, [], 'um 401 (sessão) abriu a fila guardada: quem decide ali é a conferência da sessão');
  assert.equal(c.app.falhouPorRede(), false);
});

test('R4-O1: na fila JÁ trabalhada a falha mostra a tela — e o "Tentar novamente" abre a guardada com o `onLine` verdadeiro', async () => {
  const pagina = await prepararO1();
  let falhar = false;
  const b = pagina({ onLine: true, api: () => (falhar ? FALHA_REDE : { ...TRES(), hasMore: true }) });
  await b.app.startFetching();
  assert.equal(b.AppState.queue.length, 3, 'PRÉ-CONDIÇÃO: a busca com rede não trouxe a fila');
  // A pessoa tratou tudo (a fila esvazia, o Waze ainda diz que há mais) e a rede some.
  b.AppState.queue = [];
  b.AppState.currentPlace = null;
  b.AppState.hasMore = true;
  falhar = true;
  b.log.length = 0;
  await b.app.startFetching();
  assert.equal(eventos(b, 'falha').length, 1, 'numa fila já trabalhada, a guardada entrou SOZINHA — os pulados voltariam sem ninguém pedir');
  assert.deepEqual(b.AppState.queue, []);
  assert.equal(b.app.falhouPorRede(), true, 'a falha por rede não ficou anotada pro "Tentar novamente"');
  // O "Tentar novamente": `offlineTentarAbrirSemRede(ultimaBuscaFalhouPorRede)`.
  assert.equal(await b.app.offlineTentarAbrirSemRede(b.app.falhouPorRede()), true,
    'o "Tentar novamente" não abriu a fila guardada com o `onLine` verdadeiro');
  // CONTROLE: sem a falha por rede anotada, e com o `onLine` verdadeiro, ele não abre (é a busca que sai).
  const c = pagina({ onLine: true, api: () => TRES() });
  assert.equal(await c.app.offlineTentarAbrirSemRede(false), false, 'CONTROLE: com rede e sem falha, a fila guardada abriu');
});

test('R4-O1: a fila que MUDA enquanto a base é lida (↻, filtro) não recebe a guardada por cima', async () => {
  const pagina = await prepararO1();
  const b = pagina({ onLine: true, api: () => FALHA_REDE });
  const tentativa = b.app.abrirGuardadaDepoisDaFalha(b.AppState.fetchEpoch);
  b.AppState.fetchEpoch++;               // o `resetQueue` no meio da leitura
  assert.equal(await tentativa, false, 'a fila guardada entrou numa fila que já era outra');
  assert.deepEqual(b.AppState.queue, []);
  // Duas esperas pela MESMA busca: uma tentativa só, e o card uma vez.
  const d = pagina({ onLine: true, api: () => FALHA_REDE });
  const [x, y] = await Promise.all([d.app.abrirGuardadaDepoisDaFalha(0), d.app.abrirGuardadaDepoisDaFalha(0)]);
  assert.ok(x === true && y === true);
  assert.equal(eventos(d, 'card').length, 1, 'a fila guardada foi aberta duas vezes');
});
