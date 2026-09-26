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
    offlineEsquecerFilaDeOutroLugar: () => log.push('esqueceu'),
    semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
    pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {},
    updatePendingCount: () => {}, sortQueue: () => {}, showCurrentPlace: () => log.push('card'),
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let offlineJanelaServida = null, filaDeOnde = null;
    ${fatiar('mesmoLugar')}\n${fatiar('offlineTentarAbrirSemRede')}
    return { abrir: offlineTentarAbrirSemRede, onde: () => filaDeOnde };`)(...chaves.map((k) => deps[k]));
  return { app, AppState, log };
}
const GUARDADA = (lugar) => ({ t: Date.now(), desde: Date.now(), ...lugar, places: [{ venueID: 'v1', updateRequestID: 'u1' }] });

test('O4: a reabertura sem rede RECUSA a fila de OUTRO lugar (e a esquece) — e abre a do mesmo', async () => {
  const outra = reabrir({ guardada: GUARDADA({ regiao: 'row', pais: '30' }), agora: { regiao: 'na', pais: '235' } });
  assert.equal(await outra.app.abrir(), false, 'a fila da região velha abriu sob o filtro novo');
  assert.deepEqual(outra.AppState.queue, [], 'a fila de outro lugar entrou na tela');
  assert.ok(outra.log.includes('esqueceu') && outra.log.includes('offline.outroLugar'));
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
  assert.deepEqual(mesma.app.onde(), { regiao: 'row', pais: '30' }, 'a fila reaberta não sabe de onde é');
});

test('O4: trocar de lugar ESQUECE a fila guardada de outro lugar — e só ela, e só com o offline ligado', async () => {
  const rodar = ({ guardada, agora, ligado = true }) => {
    const apagou = [];
    let abriu = 0;
    const deps = {
      offlineLigado: () => ligado, lugarAgora: () => agora, dfato: () => {}, OFFLINE_STORE: 'fila',
      offlineDB: async () => { abriu++; return { close() {}, transaction: () => {
        const tx = { objectStore: () => ({
          get: () => { const r = {}; setTimeout(() => { r.result = guardada; r.onsuccess(); setTimeout(() => tx.oncomplete()); }); return r; },
          delete: (k) => apagou.push(k),
        }) };
        return tx;
      } }; },
    };
    const chaves = Object.keys(deps);
    const f = new Function(...chaves, `${fatiar('mesmoLugar')}\n${fatiar('offlineEsquecerFilaDeOutroLugar')}
      return offlineEsquecerFilaDeOutroLugar;`)(...chaves.map((k) => deps[k]));
    return f().then(() => ({ apagou, abriu }));
  };
  const trocou = await rodar({ guardada: GUARDADA({ regiao: 'row', pais: '30' }), agora: { regiao: 'na', pais: '235' } });
  assert.deepEqual(trocou.apagou, ['fila'], 'a fila da região velha ficou guardada');
  const mesmo = await rodar({ guardada: GUARDADA({ regiao: 'na', pais: '235' }), agora: { regiao: 'na', pais: '235' } });
  assert.deepEqual(mesmo.apagou, [], 'apagou a fila que a busca do lugar NOVO acabou de gravar');
  const desligado = await rodar({ guardada: null, agora: { regiao: 'na', pais: '235' }, ligado: false });
  assert.equal(desligado.abriu, 0, 'abriu (e CRIOU) a base de quem não ligou o offline');
  // Todo caminho que troca de lugar zera a fila por `resetQueue`, e a busca
  // anota de onde é o que trouxe.
  const reset = fatiar('resetQueue');
  assert.match(reset, /filaDeOnde = null;\s*offlineEsquecerFilaDeOutroLugar\(\);/,
    'a fila nova não zerou o lugar nem esqueceu a guardada de outro lugar');
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
