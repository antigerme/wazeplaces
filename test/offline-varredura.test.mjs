// A varredura do "Disponível offline", pela auditoria de 2026-09-25: um item
// que falha SEMPRE (foto que o Waze tirou do ar, tile 404) voltava pro fim da
// fila até o teto GLOBAL — 1.001 tentativas numa URL só, e a linha parada em
// "Preparando… 499 de 500". E com o resultado "parcial" cada ação disparava
// outra varredura, martelando as mesmas URLs. Cada teste foi visto REPROVANDO
// com o conserto desfeito.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dispatch } from '../server/core.mjs';
import { sessaoDeTeste } from './_sessao.mjs';

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
// A chave de um pedido, a do app (a gravação da fila confere com ela se é a mesma fila).
const chaveDoPedido = new Function(fatiar('chaveDoPedido') + '\nreturn chaveDoPedido;')();

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
    // A gravação da fila leva um carimbo (o `t`), como a de verdade, e a releitura
    // da base o devolve: é com ele que a poda confere que a fila guardada ainda é a
    // desta varredura (R12-4-05).
    offlineGravarFila: async () => { gravou++; st.gravada = (st.gravada || 0) + 1; return true; },
    offlineLerFila: async () => (st.gravada ? { t: st.gravada, places: [{ venueID: 'v' }] } : null),
    offlineItensDaFila: async () => itens.map((u) => ({ u, tile: /tile/.test(u) })),
    offlineBaixar: async (u) => { tentativas.set(u, (tentativas.get(u) || 0) + 1); return baixar(u); },
    offlineSondarRede: async (u) => { sondas.push(u); const r = await baixar(u); return r === true || r === 'definitivo'; },
    offlineAnunciarTiles: () => {}, atualizarLinhaDoOffline: () => {}, offlineGravarJanela: () => {},
    offlinePodarTiles: async (manter) => { podas.push([...manter].sort()); return 0; },
    dfato: (k, o) => diario.push([k, o]),
    setTimeout: (fn) => { fn(); return 0; },
  };
  const corpo = [fatiar('filaReal'), fatiar('offlineVarrer')].join('\n')
    .replace(/offlineVarrendo/g, '__st.varrendo').replace(/offlinePedidaDeNovo/g, '__st.pedida')
    .replace(/offlineJanelaServida/g, '__st.janela').replace(/offlineUltimoResultado/g, '__st.resultado')
    .replace(/offlineUltimoGesto/g, '__st.gesto').replace(/offlineFeitosNaJanela/g, '__st.feitos')
    .replace(/offlineEpoca/g, '__st.epoca')
    .replace(/offlineFilaPreparada/g, '__st.preparada').replace(/offlineFilaGravadaEm/g, '__st.gravada')
    .replace(/offlineFilaVarrida/g, '__st.varrida');
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

function gravarCom({ treinoAgora = false, treinoDuranteOAbrir = false, lugarDaFila = null, real = null } = {}) {
  const puts = [];
  real = real || [{ venueID: 'real-1' }, { venueID: 'real-2' }];
  const exemplos = [{ venueID: 'exemplo', _treino: true }];
  // Com o treino aberto, a fila da TELA é a de exemplos e a real fica guardada
  // nele (`Treino._salvo.queue`), como o `Treino.entrar` faz.
  const AppState = { queue: treinoAgora ? exemplos : real, filters: { countryId: 30 } };
  const Treino = { ativo: treinoAgora, _salvo: treinoAgora ? { queue: real } : null };
  const deps = {
    AppState, Treino, offlineLigado: () => true, OFFLINE_STORE: 'fila',
    offlineDB: async () => {
      // O treino começa ENQUANTO a base abre: troca a fila, como o `Treino.entrar`.
      if (treinoDuranteOAbrir) { Treino.ativo = true; Treino._salvo = { queue: AppState.queue }; AppState.queue = exemplos; }
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
    // A sessão DESTA aba, a da memória (R13-4-04: sem ela a fila não é gravada).
    contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, marcaDestaAba: () => 'm-tok', API: { getSession: () => 'tok' },
    // O carimbo da fila que está na base, e os pedidos dela (as variáveis do
    // módulo), e a cobertura (R6-4-2: a mesma fila regravada mantém o carimbo).
    offlineFilaGravadaEm: null, offlineFilaGravadaChaves: null, offlineFilaPreparada: null, chaveDoPedido,
  };
  const chaves = Object.keys(deps);
  const gravar = new Function(...chaves, fatiar('filaReal') + '\n' + fatiar('offlineGravarFila') + '\nreturn offlineGravarFila;')(...chaves.map((k) => deps[k]));
  return { gravar, puts };
}

// No treino a fila da TELA é a de exemplos: gravada, ela voltaria como fila de
// verdade na próxima abertura sem rede (auditoria de 2026-09-25). E não gravar
// NADA, como era, fazia o interruptor ligado sem sinal no treino dizer "4 pedidos
// guardados" com a base vazia (R9-4-02, auditoria de 2026-10-06): grava a REAL.
test('offlineGravarFila: no treino grava a fila REAL, nunca os exemplos; e o treino que começa com a base ABRINDO não troca a fila gravada', async () => {
  const a = gravarCom({ treinoAgora: true });
  assert.equal(await a.gravar(), true, 'DEFEITO: no treino a fila real não foi gravada — o interruptor diria "pedidos guardados" sobre a base vazia (R9-4-02)');
  assert.deepEqual(a.puts[0].places.map((p) => p.venueID), ['real-1', 'real-2'], 'gravou a fila de EXEMPLOS');
  // A fila real VAZIA no treino (a reabertura sem rede que deixou a guardada
  // esperando o "Sair", R8-4-04) não apaga a guardada do aparelho.
  const vazia = gravarCom({ treinoAgora: true, real: [] });
  assert.equal(await vazia.gravar(), false);
  assert.equal(vazia.puts.length, 0, 'a fila real vazia do treino foi gravada por cima da guardada');

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
  // A lista do "já pronto" desta janela (R6-4-1): o que a poda apaga sai dela também.
  const feitos = { janela: 7, epoca: 0, us: new Set(['https://t/1', 'https://t/2', 'foto-1']) };
  const deps = {
    offlineEpoca: 0, OFFLINE_TILES_CACHE: 'waze-places-tiles', offlineFeitosNaJanela: feitos,
    caches: {
      has: async () => guardados.length > 0,
      open: async () => { criou = true; return { keys: async () => guardados.map((url) => ({ url })), delete: async (r) => { apagados.push(r.url); } }; },
    },
  };
  const chaves = Object.keys(deps);
  const podar = new Function(...chaves, fatiar('offlinePodarTiles') + '\nreturn offlinePodarTiles;')(...chaves.map((k) => deps[k]));
  assert.equal(await podar(new Set(['https://t/2']), 0), 2);
  assert.deepEqual(apagados.sort(), ['https://t/1', 'https://t/3']);
  assert.deepEqual([...feitos.us].sort(), ['foto-1', 'https://t/2'],
    'o tile que a poda apagou seguiu "pronto" na lista da janela (R6-4-1) — ou a poda tirou da lista o que ficou');
  // De OUTRA época (esqueceram no meio), a lista não é a deste cache: não mexe.
  const outra = { janela: 7, epoca: 3, us: new Set(['https://t/1']) };
  const deps2 = { ...deps, offlineFeitosNaJanela: outra };
  await new Function(...chaves, fatiar('offlinePodarTiles') + '\nreturn offlinePodarTiles;')(...chaves.map((k) => deps2[k]))(new Set(), 0);
  assert.deepEqual([...outra.us], ['https://t/1'], 'a poda mexeu na lista de outra época');
  // Sem cache (quem nunca ligou o offline): não abre — `open` CRIARIA um vazio.
  guardados.length = 0; criou = false;
  assert.equal(await podar(new Set(), 0), 0);
  assert.equal(criou, false, 'a poda criou o cache do mapa pra quem nunca o teve');
});

// ── R6-4-1: a poda × a lista do "já pronto" (auditoria de 2026-10-01) ─────────
// O "pronto" poda do cache os tiles dos pedidos que saíram da fila, e as URLs
// deles seguiam na lista do "já pronto" desta janela. O pedido que VOLTAVA à
// fila na mesma janela (o filtro de antes, o pulado que o ↻ traz) era pulado:
// "Pronto — 2 pedidos no aparelho" e, sem rede, o mapa dele vazio (medido no
// navegador, t1 e t1b). Os testes de cima não podiam ver: o harness troca a poda
// por `async () => 0`. Aqui a poda e a varredura rodam DE VERDADE sobre um cache
// de mentira — o mesmo em que o download grava e de onde a poda apaga.
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
function aparelhoComCache() {
  const cache = new Map();
  const baixados = [];
  const fila = { itens: [] };
  let segurarPoda = null;              // com uma promessa aqui, cada apagar da poda espera por ela
  const st = { varrendo: false, pedida: false, janela: null, resultado: null, gesto: 0, epoca: 0,
    feitos: { janela: null, epoca: -1, us: new Set() }, preparada: null, gravada: null, varrida: null };
  const agora = 1492385 * 1200000 + 1000;   // uma janela só, do começo ao fim
  st.gesto = agora;
  const deps = {
    AppState: { authenticated: true, queue: [{ venueID: 'v' }] }, Treino: { ativo: false }, navigator: { onLine: true },
    Date: { now: () => agora }, offlineLigado: () => true,
    OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: 1200000, OFFLINE_CONCORRENCIA: 1, OFFLINE_ANUNCIAR_A_CADA: 50,
    OFFLINE_TENTATIVAS_POR_ITEM: constante('OFFLINE_TENTATIVAS_POR_ITEM'), OFFLINE_TILES_CACHE: 'waze-places-tiles',
    // A gravação leva um carimbo e a releitura da base o devolve (R12-4-05: a poda
    // confere que a fila guardada ainda é a desta varredura).
    offlineGravarFila: async () => { st.gravada = (st.gravada || 0) + 1; return true; },
    offlineLerFila: async () => (st.gravada ? { t: st.gravada, places: [{ venueID: 'v' }] } : null),
    offlineItensDaFila: async () => fila.itens.map((u) => ({ u, tile: true })),
    offlineBaixar: async (u) => { baixados.push(u); cache.set(u, true); return true; },
    offlineSondarRede: async () => true,
    offlineAnunciarTiles: () => {}, atualizarLinhaDoOffline: () => {}, offlineGravarJanela: () => {}, dfato: () => {},
    setTimeout: (fn) => { fn(); return 0; },
    caches: {
      has: async () => cache.size > 0,
      open: async () => ({
        keys: async () => [...cache.keys()].map((url) => ({ url })),
        delete: async (r) => { if (segurarPoda) await segurarPoda; cache.delete(r.url); },
      }),
    },
  };
  const corpo = [fatiar('filaReal'), fatiar('offlinePodarTiles'), fatiar('offlineVarrer')].join('\n')
    .replace(/offlineVarrendo/g, '__st.varrendo').replace(/offlinePedidaDeNovo/g, '__st.pedida')
    .replace(/offlineJanelaServida/g, '__st.janela').replace(/offlineUltimoResultado/g, '__st.resultado')
    .replace(/offlineUltimoGesto/g, '__st.gesto').replace(/offlineFeitosNaJanela/g, '__st.feitos')
    .replace(/offlineEpoca/g, '__st.epoca')
    .replace(/offlineFilaPreparada/g, '__st.preparada').replace(/offlineFilaGravadaEm/g, '__st.gravada')
    .replace(/offlineFilaVarrida/g, '__st.varrida');
  const chaves = Object.keys(deps);
  const varrer = new Function(...chaves, '__st', corpo + '\nreturn offlineVarrer;')(...chaves.map((k) => deps[k]), st);
  return { varrer, st, cache, baixados, fila, segurar: (p) => { segurarPoda = p; } };
}

test('R6-4-1: o pedido que sai da fila e VOLTA na mesma janela tem o tile baixado de novo — a poda o tinha apagado', async () => {
  const a = aparelhoComCache();
  a.fila.itens = ['tile-p1', 'tile-p2'];                 // a fila A
  await a.varrer();
  assert.equal(a.st.resultado, 'pronto', 'PRÉ-CONDIÇÃO: a preparação de A não ficou pronta');
  a.fila.itens = ['tile-p1'];                             // a fila B (o p2 saiu: outro filtro)
  await a.varrer();
  await flush();
  assert.equal(a.cache.has('tile-p2'), false, 'PRÉ-CONDIÇÃO: a poda do "pronto" de B não apagou o tile do p2');
  const antes = a.baixados.length;
  a.fila.itens = ['tile-p1', 'tile-p2'];                 // de volta à A, na MESMA janela
  await a.varrer();
  await flush();
  assert.equal(a.st.resultado, 'pronto');
  assert.deepEqual(a.baixados.slice(antes), ['tile-p2'],
    'o pedido que voltou foi pulado como pronto — a linha diria "Pronto" com o mapa dele fora do aparelho');
  assert.equal(a.cache.has('tile-p2'), true, 'o tile do pedido que voltou não está no aparelho');
});

test('R6-4-1: a varredura seguinte não começa com a poda da anterior ainda apagando', async () => {
  const a = aparelhoComCache();
  a.fila.itens = ['tile-p1', 'tile-p2'];
  await a.varrer();
  // A fila B: a poda do "pronto" dela demora (o cache apaga devagar)…
  a.fila.itens = ['tile-p1'];
  let soltar = null;
  a.segurar(new Promise((ok) => { soltar = ok; }));
  const varreduraB = a.varrer();
  await flush();
  // …e nesse meio a busca traz o p2 de volta e chama a varredura (como o `fetchNextPage`).
  a.fila.itens = ['tile-p1', 'tile-p2'];
  const outra = a.varrer();
  await flush();
  a.segurar(null);
  soltar();
  await Promise.all([varreduraB, outra]);
  await flush();
  assert.equal(a.st.resultado, 'pronto');
  assert.equal(a.cache.has('tile-p2'), true,
    'a varredura da busca começou com a poda da anterior apagando: terminou "pronto" e a poda levou o tile do p2 depois');
  assert.equal(a.st.varrendo, false);
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
    // A sessão DESTA aba, a da memória (R13-4-04: sem ela a fila não é gravada).
    contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, marcaDestaAba: () => 'm-tok', API: { getSession: () => 'tok' },
  };
  const chaves = Object.keys(deps);
  const gravar = new Function(...chaves, fatiar('filaReal') + '\n' + fatiar('offlineGravarFila') + '\nreturn offlineGravarFila;')(...chaves.map((k) => deps[k]));
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
  // Com SESSÃO: sem ela a fila guardada não abre (R13-4-04).
  const AppState = { authenticated: true, queue: [], hasMore: false, loadError: true, serverTotal: 0 };
  const deps = {
    AppState, navigator: { onLine: false }, offlineLigado: () => true,
    offlineLerFila: async () => guardada, offlineLerRegistroDaJanela: async () => null,
    lugarAgora: () => agora, dfato: (k) => log.push(k),
    semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
    pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {},
    updatePendingCount: () => {}, sortQueue: () => {}, showCurrentPlace: () => log.push('card'),
    // O DONO da fila guardada (test/costura-sessao, K6): a mesma conta.
    contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, marcaDestaAba: () => 'm-tok', API: { getSession: () => 'tok' }, chaveDoPedido,
  };
  const chaves = Object.keys(deps);
  const app = new Function(...chaves, `let offlineJanelaServida = null, filaDeOnde = null, offlineFilaGravadaEm = null, offlineFilaPreparada = null,
      offlineFilaGravadaChaves = null;
    ${fatiar('mesmoLugar')}\n${fatiar('filaGuardadaDestaConta')}\n${fatiar('offlineRecuperarJanela')}\n${fatiar('offlineTentarAbrirSemRede')}
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
  const corpo = ['filaReal', 'offlinePrecisaVarrer', 'offlineTalvezVarrer', 'offlineVarrer'].map(fatiar).join('\n')
    .replace(/offlineVarrendo/g, '__st.varrendo').replace(/offlinePedidaDeNovo/g, '__st.pedida')
    .replace(/offlineJanelaServida/g, '__st.janela').replace(/offlineUltimoResultado/g, '__st.resultado')
    .replace(/offlineUltimoGesto/g, '__st.gesto').replace(/offlineFeitosNaJanela/g, '__st.feitos')
    .replace(/offlineEpoca/g, '__st.epoca')
    .replace(/offlineFilaPreparada/g, '__st.preparada').replace(/offlineFilaGravadaEm/g, '__st.gravada')
    .replace(/offlineFilaVarrida/g, '__st.varrida');
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
  const corpo = ['filaReal', 'offlineMarcarGesto', 'offlineVarrer', 'offlineAoMudarInterruptor'].map(fatiar).join('\n')
    .replace(/offlineVarrendo/g, '__st.varrendo').replace(/offlinePedidaDeNovo/g, '__st.pedida')
    .replace(/offlineJanelaServida/g, '__st.janela').replace(/offlineUltimoResultado/g, '__st.resultado')
    .replace(/offlineUltimoGesto/g, '__st.gesto').replace(/offlineFeitosNaJanela/g, '__st.feitos')
    .replace(/offlineEpoca/g, '__st.epoca')
    .replace(/offlineFilaPreparada/g, '__st.preparada').replace(/offlineFilaGravadaEm/g, '__st.gravada')
    .replace(/offlineFilaVarrida/g, '__st.varrida');
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
    const AppState = { authenticated: true, queue: [], hasMore: false, loadError: true, serverTotal: 0, filters: null,
      stats: { skipped: 0 }, fetchEpoch: 0 };
    const deps = {
      AppState, navigator: { onLine }, Treino: { ativo: false }, offlineLigado: () => true,
      localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
      FILTERS_KEY: 'waze_places_filters', TYPES_ALL: TYPES_ALL_R, TYPES_PADRAO: TYPES_PADRAO_R, ORDEM_PADRAO: 'newest',
      API: { getRegion: () => 'row', getCountry: () => 30, getSession: () => 'tok' },
      offlineDB, OFFLINE_STORE: 'fila', offlinePodarPousos: () => {}, offlineLerRegistroDaJanela: async () => null,
      contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, marcaDestaAba: () => 'm-tok', dfato: (k, o) => log.push([k, o || {}]),
      semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
      pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {},
      updatePendingCount: () => {}, sortQueue: () => {}, showCurrentPlace: () => log.push(['card', {}]),
      // O `resetQueue` de verdade (a fila nova do Aplicar, R5-4-2).
      enviarPendenciasDoLightbox: () => {}, removeUndoBanner: () => {}, bloqueadosPorPagina: new Map(),
    };
    const nomes = ['ordemDoWaze', 'assinaturaDeBusca', 'lugarAgora', 'mesmoLugar', 'sanearTiposSalvos', 'filtrosDeFabrica',
      'saveFilters', 'loadFilters', 'offlineLerFila', 'filaReal', 'offlineGravarFila', 'resetQueue',
      'filaGuardadaDestaConta', 'offlineRecuperarJanela', 'offlineTentarAbrirSemRede', 'chaveDoPedido'];
    const chaves = Object.keys(deps);
    const app = new Function(...chaves, `let filaDeOnde = null, offlineJanelaServida = null, tratouNestaFila = false,
        offlineFilaGravadaEm = null, offlineFilaPreparada = null, offlineFilaGravadaChaves = null,
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
// As falhas que a busca recebe saem do `_post` DE VERDADE (o api.js numa vm, com
// o `fetch` que o teste escolhe), e não de objetos escritos à mão: o `FALHA_REDE`
// daqui era `{ errorCategory: 'transient' }` SEM o `_motivo` que o `_post` põe
// quando a resposta não chega, e o `FALHA_502` levava um `httpCode` que o `_post`
// nunca produz pra página de erro da borda — o teste do lie-fi (R5-4-4) codificava
// a marca errada, e passava (auditoria de 2026-10-01, R6-4-3; gotcha #52). O
// corpo do CORE também é o de verdade: o `dispatch`, com uma sessão de teste e o
// `fetch` do servidor respondendo como o Waze.
function apiDeVerdade(fetch) {
  const fonte = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8') + '\n'
    + readFileSync(new URL('../js/api.js', import.meta.url), 'utf8') + '\nthis.API = API;';
  const ctx = { navigator: { language: 'pt-BR', onLine: true }, document: { documentElement: {}, querySelectorAll: () => [] },
    localStorage: { getItem: (k) => (k === 'waze_session_token' ? 'tok' : null), setItem() {}, removeItem() {} },
    fetch, performance, AbortController, Response, console: { error() {}, log() {}, warn() {} }, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(fonte, ctx);
  // A abertura com a sessão salva: ela vai pra memória — as rotas mandam a da
  // memória, nunca a do aparelho (R13-1-04).
  ctx.API.getSession();
  return ctx.API;
}
const falhaDaBusca = (fetch) => apiDeVerdade(fetch).fetchPlaces(1, {});
const respondeCom = (status, corpo, tipo) => async () => new Response(corpo, { status, headers: { 'content-type': tipo } });
const COOKIES_TESTE = ['_csrf_token\tcsrf-abc', '_web_session\tsess-xyz']
  .map((nv) => `.waze.com\tTRUE\t/\tTRUE\t9999999999\t${nv}`).join('\n');
// O que o CORE devolve da busca quando o Waze responde (ou não) do jeito que o teste manda.
async function respostaDoCore(doWaze) {
  const s = await sessaoDeTeste(COOKIES_TESTE);
  const original = globalThis.fetch;
  globalThis.fetch = doWaze;
  try { return await dispatch('buscar-places', { ...s.dados, region: 'row', countryId: 30, page: 1 }, s.ctx); }
  finally { globalThis.fetch = original; }
}
const doCore = async (doWaze) => {
  const r = await respostaDoCore(doWaze);
  return falhaDaBusca(respondeCom(r.status, JSON.stringify(r.body), 'application/json'));
};
// A rede do APARELHO caiu: o `fetch` do `_post` falha, nada chega.
const FALHA_REDE = await falhaDaBusca(async () => { throw new TypeError('Failed to fetch'); });
// A origem fora do ar: quem responde é a BORDA, com a página de erro dela (não é JSON).
const FALHA_BORDA_502 = await falhaDaBusca(respondeCom(502,
  '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>error code: 502</body></html>', 'text/html'));
// O nosso servidor respondeu, mas o WAZE está fora do alcance dele: `httpCode: 0`.
const FALHA_WAZE_FORA = await doCore(async () => { throw new TypeError('fetch failed'); });
// O nosso servidor respondeu, e o Waze devolveu 502 a ele.
const FALHA_502 = await doCore(async () => new Response('bad gateway', { status: 502 }));
const FALHA_SESSAO = await falhaDaBusca(respondeCom(401,
  JSON.stringify({ success: false, error: 'Sessão inválida', errorKey: 'srv.err.sessionInvalid', errorCategory: 'unauthorized' }),
  'application/json'));
// `filtros`: os filtros guardados no aparelho ("Minha área", R12-4-02).
function aparelhoO1({ filtros = null } = {}) {
  const ls = new Map();
  if (filtros) ls.set('waze_places_filters', JSON.stringify(filtros));
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
  // Com "Minha área" (R12-4-02): `perfil(regiao)` é a resposta do `/Session` (a
  // carga do perfil e a pergunta ao servidor da busca, as de VERDADE); `profile`, o
  // perfil já na mão; `editaveis`, o que o app já leu por servidor; `regiao`, a da busca.
  return function pagina({ onLine = true, offline = true, api, perfil = null, profile = null, editaveis = null, regiao = 'row' }) {
    const log = [];
    const AppState = {
      authenticated: true, hasMore: true, fetching: false, fetchEpoch: 0, queue: [], currentPlace: null,
      serverTotal: 0, serverBlocked: 0, blockedPartial: false, loadError: false, ultimaBusca: null, profile, filters: null,
    };
    const el = () => ({ classList: { add() {}, remove() {} } });
    const deps = {
      AppState, navigator: { onLine }, Treino: { ativo: false }, offlineLigado: () => offline, console: { error: () => {} },
      localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
      FILTERS_KEY: 'waze_places_filters', TYPES_ALL: TYPES_ALL_R, TYPES_PADRAO: TYPES_PADRAO_R, ORDEM_PADRAO: 'newest',
      PREFETCH_THRESHOLD: PREFETCH_R, MAX_EMPTY_PAGES: MAX_VAZIAS_R, MAX_PAGINAS_POR_BUSCA: MAX_PAGINAS_R,
      API: { getRegion: () => regiao, getCountry: () => 30, getSession: () => 'tok', fetchPlaces: async (p) => api(p),
             getProfile: async (r) => { log.push(['perfil', { r: r || regiao }]); return perfil ? perfil(r || regiao) : { success: false, errorCategory: 'unknown' }; } },
      // O resto da carga do perfil, que não é o que se mede aqui.
      pedirListaDePaises: async () => ({ success: false }), recusaDoPortao: () => log.push(['recusa', {}]),
      definirPerfil: (res) => { if (!(res && res.success && res.profile)) return false; AppState.profile = res.profile; return true; },
      completarPerfilChegado: async () => {}, conferirContaDestaAba: () => {}, PERFIL_REFAZER_MS: 60000,
      redesenharFiltrosComOPerfil: () => {}, saveFilters: () => {},
      offlineDB, OFFLINE_STORE: 'fila', offlinePodarPousos: () => {}, offlineLerRegistroDaJanela: async () => null,
      contaAgora: () => '111', marcaDaSessao: (t) => 'm-' + t, marcaDestaAba: () => 'm-tok', dfato: (k, o) => log.push([k, o || {}]),
      dlog: () => {}, dlogVigiar: () => {}, dlogVoltou: () => {}, dlogCapturarAuto: () => {},
      handleUnauthorized: () => log.push(['sessao', {}]), showToast: () => {}, msgDoServidor: (r, d) => d, t: (k) => k,
      guardarPrazoDaSessao: () => {}, trackSeenCategories: () => {}, sortQueue: () => {}, aplicarRecusaAutomatica: () => {},
      aoMudarAFilaPorBaixo: () => {}, updatePendingCount: () => {}, offlineVarrer: () => {},
      bloqueadosPorPagina: new Map(), pedidosQueEntraramNaFila: new Set(), pedidosEmAndamento: new Set(),
      pousosDaPagina: new Map(), offlineLerPousos: () => [], carregarFilaDeSaida: () => [],
      showLoading: () => {}, removeCurrentCardEl: () => {},
      // A decisão do lugar que ficou sem resposta (R12-6): aqui, nenhuma pendente.
      refazerDecisaoSemResposta: () => null,
      document: { getElementById: el },
      // A tela vazia diz se é a de FALHA (`loadError`) ou o "Tudo limpo!": o
      // instrumento que não distingue as duas conta uma pela outra.
      showCurrentPlace: () => log.push(['card', {}]), maybePrefetch: () => {},
      showNoPlaces: () => log.push([AppState.loadError ? 'falha' : 'tudoLimpo', {}]),
    };
    const nomes = ['ordemDoWaze', 'assinaturaDeBusca', 'lugarAgora', 'mesmoLugar', 'sanearTiposSalvos', 'filtrosDeFabrica',
      'loadFilters', 'offlineLerFila', 'filaReal', 'offlineGravarFila', 'filaGuardadaDestaConta',
      'offlineRecuperarJanela', 'offlineTentarAbrirSemRede', 'chaveDoPedido', 'semOsJaDecididos', 'registrarEntradaNaFila', 'semOsQueJaPassaramPelaFila',
      'ordemPrecisaDaFilaInteira', 'fetchNextPage', 'startFetching', 'abrirGuardadaDepoisDaFalha',
      // "Minha área": a carga do perfil, a caixa por servidor e a pergunta ao servidor da busca.
      'refazerPerfilSeFaltar', 'loadProfileAndAuxData', 'anotarEditaveis', 'editaveisLidos', 'servidorNuncaLido',
      'caixaDaMinhaArea', 'caixaDaMinhaAreaEm', 'lerServidorDaMinhaArea', 'areaNoutroServidorSemDecisao',
      'desligarMinhaAreaSemCaixa'];
    // A marca da falha por rede da espera de "Minha área" (R12-4-02): sem ela, o código de antes.
    if (/^function minhaAreaFalhouPorRedeEm\(/m.test(APP_SEM)) nomes.push('minhaAreaFalhouPorRedeEm');
    const chaves = Object.keys(deps);
    const app = new Function(...chaves, `let filaDeOnde = null, offlineJanelaServida = null, ultimaBuscaFalhouPorRede = false,
        offlineFilaGravadaEm = null, offlineFilaPreparada = null, offlineFilaGravadaChaves = null,
        abrindoGuardadaDepoisDaFalha = null, rebuscasAuto = 0, filaEsperaPerfil = false, buscaSemResposta = false,
        buscaEsperaOPerfil = false, perfilPedidoEm = 0, lugarDoPedidoDoPerfil = null, epocaDaSessao = 0,
        decisaoDoLugarDe = null, leiturasDaMinhaArea = { epoca: null, noAr: new Map() },
        editaveisPorServidor = ${JSON.stringify(editaveis || { conta: null, lidos: {}, caixas: {}, gerenciadas: {} })},
        perfilFalhouPorRede = false, minhaAreaFalhouPorRede = { epoca: null, regioes: new Set() },
        cargasDoPerfil = 0;
      ${nomes.map(fatiar).join('\n')}
      AppState.filters = filtrosDeFabrica();
      loadFilters();
      return { startFetching, fetchNextPage, abrirGuardadaDepoisDaFalha, offlineTentarAbrirSemRede,
        carregarPerfil: loadProfileAndAuxData,
        falhouPorRede: () => ultimaBuscaFalhouPorRede, semResposta: () => buscaSemResposta };`)(...chaves.map((k) => deps[k]));
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

test('R4-O1: na fila JÁ trabalhada a falha mostra a tela — e o "Tentar de novo" abre a guardada com o `onLine` verdadeiro', async () => {
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
  assert.equal(b.app.falhouPorRede(), true, 'a falha por rede não ficou anotada pro "Tentar de novo"');
  // O "Tentar de novo": `offlineTentarAbrirSemRede(ultimaBuscaFalhouPorRede)`.
  assert.equal(await b.app.offlineTentarAbrirSemRede(b.app.falhouPorRede()), true,
    'o "Tentar de novo" não abriu a fila guardada com o `onLine` verdadeiro');
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

// R12-6-02 (auditoria da rodada 12): a fila que volta VAZIA com o lugar ainda por
// decidir espera a decisão — e o PERFIL ainda vindo —, em vez de dizer "Tudo
// limpo!" (test/minha-area). Mas só a busca que RESPONDEU: no lie-fi o perfil
// pendura junto com a busca, até o teto de 45 s, e esperando por ele a fila
// guardada não entrava (MEDIDO no smoke do offline, 9j, na primeira versão do
// conserto). A falha tem a tela dela.
test('R12-6-02: a busca que FALHA por rede com o perfil ainda pendurado (o lie-fi) não espera por ele — a fila guardada entra na hora', async () => {
  const pagina = await prepararO1();
  const b = pagina({ onLine: true, api: () => FALHA_REDE });
  b.AppState._profilePromise = new Promise(() => {});   // o perfil pendurado, como a busca
  const desfecho = await Promise.race([b.app.startFetching().then(() => 'terminou'),
    new Promise((ok) => setTimeout(() => ok('pendurou no perfil'), 5000))]);
  assert.equal(desfecho, 'terminou', 'a busca que falhou por rede ficou esperando o perfil pendurado');
  assert.deepEqual(b.AppState.queue.map((p) => p.venueID), ['v1', 'v2', 'v3'], 'a fila guardada não entrou no lie-fi');
  assert.equal(eventos(b, 'card').length, 1);
});

// ── R12-4-02 (auditoria da rodada 12): o O1 com "MINHA ÁREA" ─────────────────
// A busca de "Minha área" não sai sem o perfil (a caixa das áreas vem dele), nem
// sem a caixa do servidor dela: ela ESPERA (`busca.esperaPerfil`,
// `busca.esperaCaixa`), com a tela de falha. Mas a espera não marcava a falha por
// rede, e sem a marca nem a abertura nem o "Tentar de novo" tentavam a fila
// guardada: com a rede que não anda (ou a origem fora do ar em 502), a abertura
// terminava em "Falha ao carregar" com a fila preparada no aparelho, deste lugar
// e desta conta, sem uso (MEDIDO no navegador, n9 da auditoria: 0 cards, só
// `busca.esperaPerfil`; sem "Minha área", 4 cards). Aqui a carga do perfil e a
// pergunta ao servidor da busca são as de VERDADE, com as falhas do `_post` de
// verdade, e a fila guardada é a de uma busca de "Minha área" com rede.
const CAIXA_R = [-43.5, -23.2, -42.9, -22.6];
const PERFIL_AREA = { id: 1, rank: 5, isAreaManager: true, editableCountryIDs: [30], areas: [{ type: 'drive', bbox: CAIXA_R }] };
const LIDO_ROW = { conta: '1', lidos: { row: [30] }, caixas: { row: CAIXA_R }, gerenciadas: {} };
// Com rede e o perfil na mão: a busca de "Minha área" traz a fila, e o offline a grava.
async function prepararMinhaArea({ regiao = 'row', editaveis = LIDO_ROW } = {}) {
  const pagina = aparelhoO1({ filtros: { myArea: true, unreadOnly: true } });
  const a = pagina({ api: () => TRES(), profile: PERFIL_AREA, editaveis, regiao });
  await a.app.startFetching();
  await assentar();
  assert.ok(a.AppState.filters.myArea, 'PRÉ-CONDIÇÃO: o filtro guardado não é "Minha área"');
  assert.deepEqual(a.AppState.queue.map((p) => p.venueID), ['v1', 'v2', 'v3'], 'PRÉ-CONDIÇÃO: a busca de "Minha área" com rede não trouxe a fila');
  assert.equal(a.base.has('fila'), true, 'PRÉ-CONDIÇÃO: a fila da busca de "Minha área" não foi gravada');
  return pagina;
}

test('R12-4-02: "Minha área" com o PERFIL falhando por rede (sem resposta, ou a borda em 502) — a fila guardada entra', async () => {
  for (const [rotulo, falha] of [['sem resposta', FALHA_REDE], ['a borda em 502', FALHA_BORDA_502]]) {
    const pagina = await prepararMinhaArea();
    const b = pagina({ onLine: true, api: () => FALHA_REDE, perfil: () => falha });
    await b.app.startFetching();
    assert.ok(eventos(b, 'perfil').length >= 1 && eventos(b, 'busca.esperaPerfil').length >= 1,
      `PRÉ-CONDIÇÃO (${rotulo}): a busca não esperou o perfil que falhou`);
    assert.deepEqual(b.AppState.queue.map((p) => p.venueID), ['v1', 'v2', 'v3'],
      `DEFEITO (${rotulo}): com "Minha área", a fila guardada não entrou — a tela é "Falha ao carregar" com ela no aparelho`);
    assert.equal(eventos(b, 'falha').length + eventos(b, 'tudoLimpo').length, 0,
      `${rotulo}: a tela vazia apareceu por cima, ou antes, da fila guardada`);
    const abriu = eventos(b, 'offline.abriu')[0];
    assert.ok(abriu && abriu[1].aposFalha === true, `${rotulo}: o diário não diz que abriu com o aparelho dizendo que há rede`);
  }
});

test('R12-4-02: "Minha área" com a CAIXA do servidor aplicado à mão falhando por rede — a fila guardada daquele servidor entra', async () => {
  // O servidor da NA, que a pessoa aplicou à mão: a fila guardada é de lá.
  const pagina = await prepararMinhaArea({ regiao: 'na', editaveis: { conta: '1', lidos: { row: [30], na: [235] },
    caixas: { row: CAIXA_R, na: [-74.1, 40.6, -73.8, 40.9] }, gerenciadas: {} } });
  // Reaberto: a abertura leu o perfil da ROW (o `/Session` de lá), e o da NA, que a
  // busca pergunta, não responde.
  const b = pagina({ onLine: true, regiao: 'na', profile: { ...PERFIL_AREA, areas: [] }, editaveis: LIDO_ROW,
    api: () => FALHA_REDE, perfil: () => FALHA_REDE });
  await b.app.startFetching();
  assert.deepEqual(eventos(b, 'perfil').map(([, o]) => o.r), ['na'], 'PRÉ-CONDIÇÃO: a busca não perguntou o `/Session` do servidor dela');
  assert.equal(eventos(b, 'busca.esperaCaixa').length >= 1, true, 'PRÉ-CONDIÇÃO: a busca não esperou a caixa');
  assert.deepEqual(b.AppState.queue.map((p) => p.venueID), ['v1', 'v2', 'v3'],
    'DEFEITO: com a caixa que falhou por rede, a fila guardada do servidor da busca não entrou');
  assert.equal(eventos(b, 'falha').length, 0);
  // CONTROLE: a pergunta que o servidor respondeu com recusa (não é rede) não abre
  // a guardada — a espera é outra, e a tela é a de falha.
  const c = pagina({ onLine: true, regiao: 'na', profile: { ...PERFIL_AREA, areas: [] }, editaveis: LIDO_ROW,
    api: () => FALHA_REDE, perfil: () => ({ success: false, errorCategory: 'unknown' }) });
  await c.app.startFetching();
  assert.deepEqual([c.AppState.queue, eventos(c, 'falha').length, c.app.falhouPorRede()], [[], 1, false],
    'CONTROLE: a caixa que falhou por outro motivo abriu a fila guardada');
});

test('R12-4-02 CONTROLE: o perfil que falha por outro motivo (401, erro do app) não abre a fila guardada — e sem fila guardada a falha por rede fica anotada pro "Tentar de novo"', async () => {
  const pagina = await prepararMinhaArea();
  for (const [rotulo, falha] of [['401', FALHA_SESSAO], ['erro do app', { success: false, errorCategory: 'unknown' }]]) {
    const b = pagina({ onLine: true, api: () => FALHA_REDE, perfil: () => falha });
    await b.app.startFetching();
    assert.deepEqual(b.AppState.queue, [], `CONTROLE (${rotulo}): o perfil que não falhou por rede abriu a fila guardada`);
    assert.equal(eventos(b, 'falha').length, 1, `CONTROLE (${rotulo}): a tela de falha não apareceu (o instrumento enxerga a tela)`);
    assert.equal(b.app.falhouPorRede(), false, `${rotulo}: a falha que não é de rede ficou anotada como rede`);
  }
  // Sem o offline (nada pra abrir), a falha por rede da espera fica anotada: é ela
  // que o "Tentar de novo" (`offlineTentarAbrirSemRede(ultimaBuscaFalhouPorRede)`) lê.
  const semGuardada = aparelhoO1({ filtros: { myArea: true, unreadOnly: true } });
  const d = semGuardada({ onLine: true, offline: false, api: () => FALHA_REDE, perfil: () => FALHA_REDE });
  await d.app.startFetching();
  assert.deepEqual([eventos(d, 'falha').length, d.app.falhouPorRede()], [1, true],
    'a espera pelo perfil que falhou por rede não ficou anotada pro "Tentar de novo"');
});

test('R12-4-02: a fila guardada aberta assim TERMINA em "Falha ao carregar" — nunca em "Tudo limpo!"', async () => {
  // Aberta no lie-fi, a fila guardada diz "pode haver mais" (`hasMore`). Com card
  // na fila, os últimos cards pedem a próxima busca (o `maybePrefetch`), e ela
  // ESPERA o perfil de novo: o `hasMore = false` dali fazia o FIM da fila dizer
  // "Tudo limpo!" — decididos os cards, com as decisões esperando envio e o Waze
  // sem resposta (MEDIDO no navegador, n9c; sem "Minha área", "Falha ao carregar").
  const fim = async (pagina, extra) => {
    const b = pagina({ onLine: true, api: () => FALHA_REDE, ...extra });
    await b.app.startFetching();
    assert.equal(b.AppState.queue.length, 3, 'PRÉ-CONDIÇÃO: a fila guardada não entrou');
    await b.app.fetchNextPage();                          // o `maybePrefetch` com 3 cards
    const hasMoreComCard = b.AppState.hasMore;
    // A pessoa decide os 3 (as decisões vão pra fila de saída): o que o
    // `advanceQueue` faz com a fila vazia.
    b.AppState.queue = [];
    b.AppState.currentPlace = null;
    b.log.length = 0;
    if (b.AppState.hasMore) await b.app.startFetching(); else b.deps.showNoPlaces();
    return { hasMoreComCard, falha: eventos(b, 'falha').length, tudoLimpo: eventos(b, 'tudoLimpo').length };
  };
  const minha = await fim(await prepararMinhaArea(), { perfil: () => FALHA_REDE });
  assert.equal(minha.hasMoreComCard, true, 'a espera pelo perfil, com card na fila, deu a fila por acabada (`hasMore` caiu)');
  assert.deepEqual([minha.falha, minha.tudoLimpo], [1, 0],
    'DEFEITO: o fim da fila guardada com "Minha área" disse "Tudo limpo!" — o Waze nem respondeu');
  // O mesmo pela espera da CAIXA (o servidor aplicado à mão que não responde).
  const caixa = await fim(await prepararMinhaArea({ regiao: 'na', editaveis: { conta: '1', lidos: { row: [30], na: [235] },
    caixas: { row: CAIXA_R, na: [-74.1, 40.6, -73.8, 40.9] }, gerenciadas: {} } }),
  { regiao: 'na', profile: { ...PERFIL_AREA, areas: [] }, editaveis: LIDO_ROW, perfil: () => FALHA_REDE });
  assert.deepEqual([caixa.hasMoreComCard, caixa.falha, caixa.tudoLimpo], [true, 1, 0],
    'o fim da fila guardada aberta pela espera da CAIXA disse "Tudo limpo!" (ou deu a fila por acabada com card)');
  // CONTROLE: sem "Minha área" (o O1 de sempre), o mesmo fim é a tela de falha.
  const sem = await fim(await prepararO1(), {});
  assert.deepEqual([sem.hasMoreComCard, sem.falha, sem.tudoLimpo], [true, 1, 0]);
});

// ── R5-4-4: o card de foto no LIE-FI (auditoria de 2026-09-30) ───────────────
// A fila guardada aberta pelo lie-fi (o O1: `onLine` VERDADEIRO e a busca sem
// resposta) mostrava o card de foto cuja foto não veio com "Sem Imagem" e ✕/✓
// VIVOS — decidir a foto sem vê-la —, enquanto no modo avião o mesmo card dizia
// "a foto precisa de sinal" e travava (medido no navegador, t9). As falhas
// (`FALHA_REDE`, `FALHA_502`…) são as do `_post` de verdade (ver acima).
test('R5-4-4: a busca SEM resposta anota o lie-fi; a que teve resposta (502 da origem) não; e a busca que dá certo o apaga', async () => {
  const pagina = await prepararO1();
  const b = pagina({ onLine: true, api: () => FALHA_REDE });
  await b.app.startFetching();
  assert.equal(b.app.semResposta(), true, 'a busca sem resposta nenhuma não ficou anotada (o lie-fi)');
  // A origem que RESPONDEU com erro não é falta de rede: a foto vem de outro servidor.
  const c = pagina({ onLine: true, api: () => FALHA_502 });
  await c.app.startFetching();
  assert.equal(c.app.falhouPorRede(), true, 'PRÉ-CONDIÇÃO: o 502 não contou como falha da busca');
  assert.equal(c.app.semResposta(), false, 'a origem que RESPONDEU 502 virou "sem rede" pra foto');
  // A busca que dá certo apaga a marca.
  let falhar = true;
  const d = pagina({ onLine: true, api: () => (falhar ? FALHA_REDE : TRES()) });
  await d.app.startFetching();
  assert.equal(d.app.semResposta(), true, 'PRÉ-CONDIÇÃO: a falha sem resposta não foi anotada');
  falhar = false;
  d.AppState.queue = [];
  d.AppState.hasMore = true;
  await d.app.startFetching();
  assert.equal(d.app.semResposta(), false, 'a busca que deu certo não apagou a marca do lie-fi');
});

// ── R12-4-02: o LIE-FI com "Minha área" ──────────────────────────────────────
// Com "Minha área" a busca nem sai: a ida que fica sem resposta é a do PERFIL (ou
// a da caixa do servidor da busca) que ela espera. Sem anotar o lie-fi ali, a fila
// guardada que agora entra (acima) trazia o card de FOTO cuja foto não vem com
// "Sem Imagem" e ✕/✓ VIVOS — decidir a foto sem vê-la —, enquanto sem "Minha
// área" o mesmo card trava com "a foto precisa de sinal" (R5-4-4).
test('R12-4-02: com "Minha área", o perfil (ou a caixa) SEM resposta anota o lie-fi; o que teve resposta (502), não', async () => {
  for (const [rotulo, falha, lieFi] of [['sem resposta', FALHA_REDE, true], ['a borda em 502', FALHA_BORDA_502, false]]) {
    const pagina = await prepararMinhaArea();
    const b = pagina({ onLine: true, api: () => FALHA_REDE, perfil: () => falha });
    await b.app.startFetching();
    assert.equal(b.AppState.queue.length, 3, `PRÉ-CONDIÇÃO (${rotulo}): a fila guardada não entrou`);
    assert.equal(b.app.semResposta(), lieFi, lieFi
      ? 'DEFEITO: o perfil que a busca de "Minha área" espera ficou SEM resposta, e o lie-fi não foi anotado — o card de foto sem a foto fica com ✕/✓ vivos'
      : 'a origem que RESPONDEU 502 ao perfil virou "sem rede" pra foto');
  }
  // A caixa do servidor aplicado à mão, sem resposta.
  const pagina = await prepararMinhaArea({ regiao: 'na', editaveis: { conta: '1', lidos: { row: [30], na: [235] },
    caixas: { row: CAIXA_R, na: [-74.1, 40.6, -73.8, 40.9] }, gerenciadas: {} } });
  const c = pagina({ onLine: true, regiao: 'na', profile: { ...PERFIL_AREA, areas: [] }, editaveis: LIDO_ROW,
    api: () => FALHA_REDE, perfil: () => FALHA_REDE });
  await c.app.startFetching();
  assert.deepEqual([c.AppState.queue.length, c.app.semResposta()], [3, true],
    'a caixa que a busca de "Minha área" espera ficou SEM resposta, e o lie-fi não foi anotado');
  // CONTROLE: sem "Minha área", a busca sem resposta anota o lie-fi, como sempre (R5-4-4).
  const o1 = await prepararO1();
  const d = o1({ onLine: true, api: () => FALHA_REDE });
  await d.app.startFetching();
  assert.equal(d.app.semResposta(), true);
  // E sem "Minha área" o perfil não é a busca: a busca que DEU CERTO segue valendo,
  // e o perfil que falha sem resposta depois dela não acende o lie-fi da foto.
  const e = o1({ onLine: true, api: () => TRES(), perfil: () => FALHA_REDE });
  await e.app.startFetching();
  await e.app.carregarPerfil();
  assert.deepEqual([e.AppState.queue.length, e.app.semResposta()], [3, false],
    'sem "Minha área", o perfil sem resposta acendeu o lie-fi por cima da busca que deu certo');
});

// ── R6-4-3: a marca do lie-fi decidia pelo `httpCode` (auditoria de 2026-10-01) ─
// O `_post` não traz `httpCode` quando a resposta chega e não é JSON (o 502 da
// borda com a origem fora, o 429 da cota, o desafio do WAF), e o core manda
// `httpCode: 0` quando o WAZE é que está fora do alcance do servidor. Nos dois
// casos alguém RESPONDEU, e a busca virava "sem resposta": com rede, o card da
// foto que o Waze tirou do ar travava ✕/✓ dizendo "a foto precisa de sinal"
// (medido no navegador, t2: `API=html` e `API=json0`). A marca certa é o `_motivo`.
test('R6-4-3: a busca que teve RESPOSTA não é lie-fi — nem a página de erro da borda, nem o Waze fora do alcance do servidor', async () => {
  // PRÉ-CONDIÇÕES: as falhas são as que o `_post` e o core produzem.
  assert.equal(typeof FALHA_REDE._motivo, 'string', 'PRÉ-CONDIÇÃO: a falha sem resposta do `_post` perdeu o `_motivo`');
  for (const [nome, f] of [['a borda 502', FALHA_BORDA_502], ['o Waze fora', FALHA_WAZE_FORA]]) {
    assert.equal(f.errorCategory, 'transient', `PRÉ-CONDIÇÃO: ${nome} deixou de ser transiente`);
    assert.equal('_motivo' in f, false, `PRÉ-CONDIÇÃO: ${nome} (a resposta CHEGOU) veio marcado como "sem resposta"`);
  }
  assert.equal('httpCode' in FALHA_BORDA_502, false, 'PRÉ-CONDIÇÃO: a página da borda passou a trazer `httpCode` — o teste precisa ser revisto');
  assert.equal(FALHA_WAZE_FORA.httpCode, 0, 'PRÉ-CONDIÇÃO: o core deixou de mandar `httpCode: 0` com o Waze fora do alcance');
  const pagina = await prepararO1();
  for (const [nome, falha] of [['a borda respondeu 502 (a origem fora)', FALHA_BORDA_502],
    ['o servidor respondeu com o Waze fora do alcance (httpCode 0)', FALHA_WAZE_FORA]]) {
    const b = pagina({ onLine: true, api: () => falha });
    await b.app.startFetching();
    assert.equal(b.app.falhouPorRede(), true, `PRÉ-CONDIÇÃO (${nome}): não contou como falha da busca`);
    assert.deepEqual(b.AppState.queue.map((p) => p.venueID), ['v1', 'v2', 'v3'], `PRÉ-CONDIÇÃO (${nome}): a fila guardada não entrou`);
    assert.equal(b.app.semResposta(), false,
      `${nome}: virou "sem rede" — o card da foto que o Waze tirou do ar travaria ✕/✓ dizendo que precisa de sinal`);
  }
  // CONTROLE: a falha SEM resposta (a rede do aparelho caiu) segue anotando o lie-fi.
  const c = pagina({ onLine: true, api: () => FALHA_REDE });
  await c.app.startFetching();
  assert.equal(c.app.semResposta(), true, 'CONTROLE: a busca sem resposta deixou de anotar o lie-fi');
});

test('R5-4-4: a primeira resposta que CHEGA apaga o lie-fi — antes da saída do esvaziamento', () => {
  const prova = APP_SEM.slice(APP_SEM.indexOf('API.aoProvarRede = () => {'));
  // A PRIMEIRA instrução do gancho, e antes da saída cedo do esvaziamento. (Entre
  // as duas moram a recuperação do card "sem foto" e os ganchos de teto próprio,
  // que também valem no meio do esvaziamento — R10-4-03 e R11-4-01, em
  // `test/offline-tela.test.mjs`.)
  assert.match(prova, /^API\.aoProvarRede = \(\) => \{\s*buscaSemResposta = false;/,
    'a resposta que chega não apaga a marca do lie-fi logo de cara');
  const corpo = prova.slice(0, prova.indexOf('\n};'));
  const iApaga = corpo.indexOf('buscaSemResposta = false;');
  const iSai = corpo.indexOf('if (esvaziandoSaida)');
  assert.ok(iApaga > 0 && iSai > iApaga, 'a marca do lie-fi só se apaga depois da saída do esvaziamento');
});

// A `marcarCardSemFoto` de VERDADE, com o card de mentira.
function cardDeFotoQueFalhou({ onLine, semResposta }) {
  const botao = () => ({ disabled: false, classList: { add() {} }, matches: () => false });
  const bs = { '.card-btn-reject': botao(), '.card-btn-read': botao(), '.card-btn-skip': botao() };
  const caixa = { children: [{ classList: { add() {} } }], querySelector: () => null, appendChild(el) { caixa.aviso = el; } };
  const card = { querySelector: (sel) => (sel === '.card-photo' ? caixa : bs[sel] || null), contains: () => false };
  const deps = {
    document: { activeElement: null, createElement: () => ({ className: '', innerHTML: '' }) },
    navigator: { onLine }, escapeHtml: (s) => s, t: (k) => k, focavelNaTela: () => false,
  };
  const nomes = Object.keys(deps);
  const marcar = new Function(...nomes, `let buscaSemResposta = ${semResposta};
    ${fatiar('marcarCardSemFoto')}\nreturn marcarCardSemFoto;`)(...nomes.map((n) => deps[n]));
  const marcou = marcar(card, { purType: 'NEW_PHOTO' });
  return { marcou, aviso: !!caixa.aviso, rejeitar: bs['.card-btn-reject'].disabled, lido: bs['.card-btn-read'].disabled,
    pular: bs['.card-btn-skip'].disabled };
}

test('R5-4-4: no lie-fi, a foto que não veio TRAVA ✕ e ✓ e diz que precisa de sinal — como no modo avião', () => {
  const lie = cardDeFotoQueFalhou({ onLine: true, semResposta: true });
  assert.deepEqual(lie, { marcou: true, aviso: true, rejeitar: true, lido: true, pular: false },
    'no lie-fi, o card de foto sem a foto ficou com ✕/✓ VIVOS ("Sem Imagem"): decidir a foto sem vê-la');
  // CONTROLE: com a rede respondendo, a foto que falhou é foto quebrada — "Sem Imagem" e ✕/✓ vivos.
  assert.deepEqual(cardDeFotoQueFalhou({ onLine: true, semResposta: false }),
    { marcou: false, aviso: false, rejeitar: false, lido: false, pular: false },
    'CONTROLE: com rede, a foto quebrada passou a travar o card');
  // E o modo avião continua travando (o caminho de sempre).
  assert.equal(cardDeFotoQueFalhou({ onLine: false, semResposta: false }).marcou, true, 'o modo avião deixou de travar');
});

// ── R5-4-6: a linha das Preferências SEM SINAL (auditoria de 2026-09-30) ─────
// 20 min depois da última preparação completa, sem sinal, a linha dizia "3
// pedidos guardados. O mapa e as fotos chegam quando houver rede." — com o mapa
// no aparelho (o tile não vence) e as fotos valendo (60 min do download). Quem
// decidia era a janela de AGORA (medido no navegador, t10). Aqui roda a
// `atualizarLinhaDoOffline` de verdade, com a `offlinePrecisaVarrer` de verdade.
// `preparada`/`gravada`: o `t` da fila que a preparação cobriu e o da que está
// guardada — por padrão a MESMA (a cobertura tem os testes dela, mais abaixo).
function linhaSemSinal({ onLine = false, servida, resultado = null, agora, fila = 3, preparada = 7, gravada = 7 }) {
  const el = { textContent: '', innerHTML: '' };
  const deps = {
    document: { getElementById: () => el }, navigator: { onLine },
    AppState: { queue: Array.from({ length: fila }, (_, i) => ({ venueID: 'v' + i })) },
    offlineLigado: () => true, escapeHtml: (s) => s, t: (k) => k,
    OFFLINE_CICLO_MS: 1200000, Date: { now: () => agora * 1200000 + 1000 },
  };
  const nomes = Object.keys(deps);
  const f = new Function(...nomes, `let offlineJanelaServida = ${servida}, offlineUltimoResultado = ${JSON.stringify(resultado)},
      offlineVarrendo = false, offlineFilaPreparada = ${preparada}, offlineFilaGravadaEm = ${gravada}, offlineFilaVarrida = null;
    ${fatiar('offlinePrecisaVarrer')}\n${fatiar('filaReal')}\n${fatiar('filaGuardadaEsperandoOTreino')}\n${fatiar('atualizarLinhaDoOffline')}\nreturn atualizarLinhaDoOffline;`)(...nomes.map((n) => deps[n]));
  f(0, 0);
  return el.innerHTML || el.textContent;
}

test('R5-4-6: sem sinal, a preparação COMPLETA vale enquanto a foto vale — e depois o mapa segue no aparelho', () => {
  const J = 1492385;
  assert.match(linhaSemSinal({ servida: J, agora: J }), /prefs\.offline\.prontoSemRedeB/,
    'PRÉ-CONDIÇÃO: na mesma janela a linha não disse que segue com o guardado');
  // 20 e 40 min depois: a foto baixada na janela J vale até o fim da J+2.
  for (const d of [1, 2]) {
    const l = linhaSemSinal({ servida: J, agora: J + d });
    assert.match(l, /prefs\.offline\.prontoSemRedeB/,
      `${d * 20} min depois da preparação completa, sem sinal, a linha diz que o mapa e as fotos ainda vão chegar: ${l}`);
  }
  // Uma hora depois: o mapa segue no aparelho; só a foto pode ter vencido.
  const depois = linhaSemSinal({ servida: J, agora: J + 3 });
  assert.match(depois, /prefs\.offline\.mapaGuardadoB/, `uma hora depois, a linha não diz que o mapa está no aparelho: ${depois}`);
  assert.doesNotMatch(depois, /prefs\.offline\.esperaB/);
});

test('R5-4-6: CONTROLE — sem preparação completa (nunca encheu, ou PARCIAL) a linha segue dizendo que o mapa e as fotos chegam', () => {
  const J = 1492385;
  assert.match(linhaSemSinal({ servida: null, agora: J }), /prefs\.offline\.esperaB/, 'sem preparação nenhuma a linha mudou');
  // A preparação PARCIAL de uma fila que a completa de antes NÃO cobriu (ela
  // gravou a fila com um pedido novo: outro carimbo). Este controle tinha a fila
  // COBERTA (`preparada === gravada`) com o resultado "parcial" — que é o caso da
  // renovação da MESMA fila cortada no meio, o defeito do R6-4-2 (mais abaixo).
  assert.match(linhaSemSinal({ servida: J, resultado: 'parcial', agora: J, preparada: 7, gravada: 8 }), /prefs\.offline\.esperaB/,
    'a preparação PARCIAL de uma fila não coberta passou a dizer que tudo está no aparelho');
  // E COM rede nada muda: a janela virada é "ainda não preparado" até a varredura passar.
  assert.match(linhaSemSinal({ onLine: true, servida: J, agora: J + 1 }), /prefs\.offline\.pendenteA/);
  assert.match(linhaSemSinal({ onLine: true, servida: J, agora: J }), /prefs\.offline\.prontoB/);
});

// ── A linha diz "Pronto" só sobre a fila que a preparação COBRIU (sobra do R5-4-6)
// A fila guardada é regravada na busca e no começo de cada varredura. Com a fila
// A pronta, uma busca que gravava a fila B (A + um pedido novo) deixava a linha
// em "Pronto — 4 pedidos no aparelho" com o pedido novo sem mapa e sem foto: a
// preparação de B nem começou (a pessoa estava parada), ficou parcial, ou a busca
// chegou DURANTE a preparação de A. Fechado e reaberto sem rede, "Pronto … você
// segue com o que está guardado" (medido no navegador, t11: o tile do pedido novo
// fora do aparelho nos três casos). Aqui roda o código de VERDADE — gravar a
// fila, varrer, gravar a janela, reabrir sem rede e a linha — sobre uma base de
// mentira que sobrevive às "páginas", com um relógio que anda 1 ms por leitura.
// `fila.falhar`: a gravação da fila ABORTA (a cota estourada); `fila.segurar`: a
// gravação da fila só fecha no `soltarFila()`.
function aparelhoDaLinha() {
  const base = new Map();
  const relogio = { agora: 1492385 * 1200000 + 1000 };     // começo de uma janela
  const fila = { falhar: false, segurar: false, presas: [] };
  const offlineDB = async () => ({
    close() {},
    transaction: () => {
      const tx = {};
      const fim = () => setTimeout(() => tx.oncomplete && tx.oncomplete());
      tx.objectStore = () => ({
        put: (v, k) => {
          if (k === 'fila' && fila.falhar) { setTimeout(() => tx.onabort && tx.onabort()); return; }
          base.set(k, JSON.parse(JSON.stringify(v)));
          if (k === 'fila' && fila.segurar) fila.presas.push(fim); else fim();
        },
        get: (k) => { const r = {}; setTimeout(() => { r.result = base.get(k); if (r.onsuccess) r.onsuccess(); fim(); }); return r; },
      });
      return tx;
    },
  });
  const soltarFila = () => { fila.segurar = false; for (const f of fila.presas.splice(0)) f(); };
  const A = [1, 2, 3].map((i) => ({ venueID: 'a' + i, updateRequestID: 'u' + i }));
  const NOVO = { venueID: 'b4', updateRequestID: 'u4' };
  function pagina({ onLine = true, fila = [] } = {}) {
    const el = { textContent: '', innerHTML: '' };
    // A rede da MÍDIA (tile e foto): `ok` diz se o download dá certo; com
    // `segura`, os downloads ficam presos até `soltar()`.
    // `baixados`: cada download, pela URL; `varreduras`: as que chegaram a montar a lista.
    const rede = { ok: true, segura: false, presos: [], baixados: [], varreduras: 0 };
    const AppState = { authenticated: true, queue: fila.slice(), filters: {}, fetchEpoch: 0, serverTotal: 0, hasMore: true };
    const navigator = { onLine };
    const deps = {
      AppState, navigator, Treino: { ativo: false }, offlineLigado: () => true,
      Date: { now: () => relogio.agora++ },
      document: { getElementById: () => el }, t: (k) => k, escapeHtml: (s) => s,
      offlineDB, OFFLINE_STORE: 'fila', offlinePodarPousos: () => {}, dfato: () => {},
      lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), contaAgora: () => '111',
      marcaDaSessao: (t) => 'm-' + t, marcaDestaAba: () => 'm-tok', API: { getSession: () => 'tok' },
      semOsJaDecididos: (places) => ({ places: places.slice(), excluidos: 0 }),
      pedidosQueEntraramNaFila: new Set(), registrarEntradaNaFila: () => {},
      updatePendingCount: () => {}, sortQueue: () => {}, showCurrentPlace: () => {},
      OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: 1200000, OFFLINE_CONCORRENCIA: 1,
      OFFLINE_ANUNCIAR_A_CADA: 50, OFFLINE_TENTATIVAS_POR_ITEM: constante('OFFLINE_TENTATIVAS_POR_ITEM'),
      // Um tile e uma foto por pedido da fila.
      offlineItensDaFila: async () => {
        rede.varreduras++;
        return AppState.queue.flatMap((p) => [{ u: 'tile-' + p.venueID, tile: true }, { u: 'foto-' + p.venueID, tile: false }]);
      },
      offlineBaixar: (u) => new Promise((ok) => {
        rede.baixados.push(u);
        const r = () => ok(typeof rede.ok === 'function' ? rede.ok(u) : rede.ok);
        if (rede.segura) rede.presos.push(r); else r();
      }),
      offlineSondarRede: async (u) => (typeof rede.ok === 'function' ? rede.ok(u) : rede.ok),
      offlineAnunciarTiles: () => {}, offlinePodarTiles: async () => 0,
      setTimeout: (fn) => { fn(); return 0; },
    };
    const nomes = ['mesmoLugar', 'filaGuardadaDestaConta', 'offlineGravarFila', 'offlineGravarJanela', 'offlineLerRegistroDaJanela',
      'offlineRecuperarJanela', 'offlineLerFila', 'offlineTentarAbrirSemRede', 'offlinePrecisaVarrer', 'offlineVarrer',
      'atualizarLinhaDoOffline', 'filaReal', 'filaGuardadaEsperandoOTreino', 'offlineTalvezVarrer', 'offlineMarcarGesto', 'chaveDoPedido'];
    const chaves = Object.keys(deps);
    const app = new Function(...chaves, `let filaDeOnde = null, offlineJanelaServida = null, offlineUltimoResultado = null,
        offlineVarrendo = false, offlinePedidaDeNovo = false, offlineUltimoGesto = Date.now(), offlineEpoca = 0,
        offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set() }, offlineFilaGravadaEm = null, offlineFilaPreparada = null,
        offlineFilaGravadaChaves = null,
        offlineFilaVarrida = null;
      ${nomes.map(fatiar).join('\n')}
      return { varrer: offlineVarrer, gravarFila: offlineGravarFila, abrirSemRede: offlineTentarAbrirSemRede,
        recuperarJanela: offlineRecuperarJanela,
        atualizarLinha: () => atualizarLinhaDoOffline(0, 0),
        // Os gatilhos de verdade: a prova de rede, o evento online e abrir as
        // Preferências chamam todos o offlineTalvezVarrer; a pessoa que volta a
        // usar o app é o offlineMarcarGesto.
        gatilho: offlineTalvezVarrer, voltar: offlineMarcarGesto,
        parar: () => { offlineUltimoGesto = -1e15; },          // mais de 3 min sem gesto
        estado: () => ({ resultado: offlineUltimoResultado, varrendo: offlineVarrendo, janela: offlineJanelaServida,
          preparada: offlineFilaPreparada, gravada: offlineFilaGravadaEm, varrida: offlineFilaVarrida }) };`)(
      ...chaves.map((k) => deps[k]));
    // A busca que traz pedido novo, como o `fetchNextPage`: põe na fila, grava
    // a fila (sem esperar) e chama a varredura.
    const buscar = (novos) => {
      AppState.queue.push(...novos);
      app.gravarFila(relogio.agora);
      return app.varrer();
    };
    const soltar = () => { rede.segura = false; for (const r of rede.presos.splice(0)) r(); };
    const linha = () => { app.atualizarLinha(); return el.innerHTML || el.textContent; };
    return { ...app, AppState, navigator, rede, buscar, soltar, linha };
  }
  return { pagina, base, relogio, A, NOVO, fila, soltarFila };
}
// A base de mentira fecha a transação num `setTimeout`: assentar é esperar
// TIMERS, não só a fila de microtarefas (40 `setImmediate` cabem em menos de 1 ms
// e deixavam a gravação da fila sem fechar — a memória ainda na fila anterior).
const assentarBase = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 2)); };
// A fila A preparada por inteiro, numa página com rede.
async function filaAPronta() {
  const ap = aparelhoDaLinha();
  const p1 = ap.pagina({ fila: ap.A });
  await p1.varrer();
  await assentarBase();
  assert.equal(p1.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a preparação da fila A não ficou pronta');
  return { ap, p1 };
}
// Fecha e reabre SEM rede: a reabertura de verdade, e a linha dela.
async function reabrirSemRede(ap) {
  const p2 = ap.pagina({ onLine: false });
  assert.equal(await p2.abrirSemRede(), true, 'PRÉ-CONDIÇÃO: a fila guardada não abriu sem rede');
  return p2;
}
const PRONTO = /prefs\.offline\.prontoA/;

test('cobertura: a busca grava a fila B e a preparação dela NEM COMEÇA (a pessoa parada) — a linha não diz "Pronto"', async () => {
  const { ap, p1 } = await filaAPronta();
  assert.match(p1.linha(), /prefs\.offline\.prontoB/, 'PRÉ-CONDIÇÃO: com a fila A preparada, a linha não disse "Pronto"');
  p1.parar();
  await p1.buscar([ap.NOVO]);
  await assentarBase();
  assert.equal(p1.AppState.queue.length, 4);
  assert.equal(ap.base.get('fila').places.length, 4, 'PRÉ-CONDIÇÃO: a fila B não foi gravada');
  assert.equal(p1.estado().varrendo, false);
  // Com rede, na mesma página: o pedido novo não foi preparado.
  const comRede = p1.linha();
  assert.doesNotMatch(comRede, PRONTO, `com rede, a linha diz "Pronto" sobre a fila B, que ninguém preparou: ${comRede}`);
  assert.match(comRede, /prefs\.offline\.pendenteA/);
  // O sinal cai, na mesma página.
  p1.navigator.onLine = false;
  const semRede = p1.linha();
  assert.doesNotMatch(semRede, PRONTO, `sem rede, a linha diz "Pronto" sobre a fila B: ${semRede}`);
  assert.match(semRede, /prefs\.offline\.esperaB/);
  // Fecha e reabre sem rede.
  const p2 = await reabrirSemRede(ap);
  assert.equal(p2.AppState.queue.length, 4);
  const reaberta = p2.linha();
  assert.doesNotMatch(reaberta, PRONTO, `reaberta sem rede, a linha diz "Pronto" sobre a fila B: ${reaberta}`);
  assert.match(reaberta, /prefs\.offline\.esperaB/);
});

test('cobertura: a preparação da fila B fica PARCIAL — reaberta sem rede, a linha não diz "Pronto"', async () => {
  const { ap, p1 } = await filaAPronta();
  p1.rede.ok = false;                 // o sinal da mídia cai; a busca ainda passou
  await p1.buscar([ap.NOVO]);
  await assentarBase();
  assert.equal(p1.estado().resultado, 'parcial', 'PRÉ-CONDIÇÃO: a preparação da fila B não ficou parcial');
  const p2 = await reabrirSemRede(ap);
  const l = p2.linha();
  assert.doesNotMatch(l, PRONTO, `reaberta sem rede, a linha diz "Pronto" sobre a fila que ficou pela metade: ${l}`);
  assert.match(l, /prefs\.offline\.esperaB/);
});

test('cobertura: a busca grava a fila B DURANTE a preparação de A, e a de B não começa — pela HORA ela pareceria coberta', async () => {
  const ap = aparelhoDaLinha();
  const p1 = ap.pagina({ fila: ap.A });
  p1.rede.segura = true;
  const varreduraDeA = p1.varrer();
  await assentarBase();
  assert.equal(p1.estado().varrendo, true, 'PRÉ-CONDIÇÃO: a preparação de A não está no ar');
  assert.ok(p1.rede.presos.length > 0, 'PRÉ-CONDIÇÃO: nenhum download preso');
  p1.buscar([ap.NOVO]);               // a varredura está no ar: fica pedida de novo
  await assentarBase();
  assert.equal(ap.base.get('fila').places.length, 4, 'PRÉ-CONDIÇÃO: a fila B não foi gravada');
  p1.parar();                         // e a pessoa fica parada até A terminar
  p1.soltar();
  await varreduraDeA;
  await assentarBase();
  assert.deepEqual([p1.estado().resultado, p1.estado().varrendo], ['pronto', false]);
  // A janela foi gravada DEPOIS da fila B: a regra só pela hora diria "Pronto".
  assert.ok(ap.base.get('janela').t > ap.base.get('fila').t, 'PRÉ-CONDIÇÃO: a janela não foi gravada depois da fila B');
  const comRede = p1.linha();
  assert.doesNotMatch(comRede, PRONTO, `com rede, a linha diz "Pronto" sobre a fila B (o pedido novo chegou durante a de A): ${comRede}`);
  const p2 = await reabrirSemRede(ap);
  const l = p2.linha();
  assert.doesNotMatch(l, PRONTO, `reaberta sem rede, a linha diz "Pronto" sobre a fila B: ${l}`);
  assert.match(l, /prefs\.offline\.esperaB/);
});

test('cobertura: CONTROLE — a fila que a preparação cobriu segue "Pronto" reaberta sem rede, e uma hora depois o mapa segue no aparelho', async () => {
  const { ap } = await filaAPronta();
  const p2 = await reabrirSemRede(ap);
  assert.match(p2.linha(), /prefs\.offline\.prontoSemRedeB/, 'a fila A, preparada por inteiro, deixou de dizer "Pronto" reaberta sem rede');
  ap.relogio.agora += 3 * 1200000;
  assert.match(p2.linha(), /prefs\.offline\.mapaGuardadoB/, 'uma hora depois, a fila coberta deixou de dizer que o mapa está no aparelho');
});

test('cobertura: CONTROLE — a busca grava a fila B e a preparação DELA termina: "Pronto" de novo, com rede e reaberta sem rede', async () => {
  const { ap, p1 } = await filaAPronta();
  await p1.buscar([ap.NOVO]);
  await assentarBase();
  assert.equal(p1.estado().resultado, 'pronto');
  assert.match(p1.linha(), /prefs\.offline\.prontoB/, 'a fila B, preparada, não voltou a dizer "Pronto"');
  const p2 = await reabrirSemRede(ap);
  assert.equal(p2.AppState.queue.length, 4);
  assert.match(p2.linha(), /prefs\.offline\.prontoSemRedeB/, 'a fila B, preparada, não diz "Pronto" reaberta sem rede');
});

test('cobertura: registro da janela de versão anterior (sem `filaCoberta`) vale como NÃO coberto', async () => {
  const { ap } = await filaAPronta();
  const j = ap.base.get('janela');
  assert.ok(Number.isFinite(j.filaCoberta), 'PRÉ-CONDIÇÃO: a janela não foi gravada com a fila que cobriu');
  delete j.filaCoberta;
  const p2 = await reabrirSemRede(ap);
  const l = p2.linha();
  assert.doesNotMatch(l, PRONTO, `o registro antigo, sem a fila que cobriu, diz "Pronto": ${l}`);
  assert.match(l, /prefs\.offline\.esperaB/);
});

test('cobertura: a abertura COM rede traz a janela e a cobertura juntas — no lie-fi a guardada abre "Pronto"', async () => {
  // O `abrirComSessaoSalva` (com rede) lê a janela antes da busca; a busca falha
  // e a guardada abre pelo `abrirGuardadaDepoisDaFalha`, com a janela já na memória.
  assert.match(fatiar('abrirComSessaoSalva'), /if \(offlineLigado\(\) && offlineJanelaServida === null\) await offlineRecuperarJanela\(\);/,
    'a abertura com rede voltou a ler só a janela, sem a fila que ela cobriu');
  const { ap } = await filaAPronta();
  const p2 = ap.pagina({ onLine: true });
  await p2.recuperarJanela();
  assert.equal(await p2.abrirSemRede(true, 0), true, 'PRÉ-CONDIÇÃO: a guardada não abriu depois da busca que falhou');
  assert.match(p2.linha(), /prefs\.offline\.prontoB/, 'no lie-fi, a fila coberta abriu dizendo que não está preparada');
});

// ── R6-4-2: a RENOVAÇÃO da mesma fila (auditoria de 2026-10-01) ───────────────
// 20 min depois de tudo pronto, a varredura renova a MESMA fila (as fotos com o
// sufixo novo), e grava a fila de novo no começo — com carimbo novo, o que
// quebrava a cobertura. O sinal caindo no meio (o "sai de casa" que o próprio
// código cita) deixava "parcial", e o app fechado no meio deixava a base com a
// cobertura velha: nos dois, sem sinal, a linha voltava a dizer "O mapa e as
// fotos chegam quando houver rede" — com o mapa da fila inteira no aparelho e
// as fotos da janela de antes valendo (medido no navegador, t4: `corte` e `fecha`).
async function renovacaoNaJanelaSeguinte({ cortar }) {
  const { ap, p1 } = await filaAPronta();
  const t0 = ap.base.get('fila').t;
  ap.relogio.agora += 1200000;                     // J+1
  p1.voltar();
  if (cortar) p1.rede.ok = false; else p1.rede.segura = true;
  p1.gatilho();                                    // a prova de rede, o `online`, as Preferências…
  await assentarBase();
  assert.equal(p1.rede.varreduras, 2, 'PRÉ-CONDIÇÃO: a renovação não começou');
  return { ap, p1, t0 };
}

test('R6-4-2: a renovação da MESMA fila cortada no meio — sem sinal, a linha segue com o que a preparação completa guardou', async () => {
  const { ap, p1 } = await renovacaoNaJanelaSeguinte({ cortar: true });
  assert.equal(p1.estado().resultado, 'parcial', 'PRÉ-CONDIÇÃO: a renovação cortada não ficou parcial');
  assert.equal(p1.estado().janela, 1492385, 'PRÉ-CONDIÇÃO: a janela servida mudou (o cenário é a renovação que NÃO terminou)');
  p1.navigator.onLine = false;
  const l = p1.linha();
  assert.match(l, /prefs\.offline\.prontoSemRedeB/,
    `sem sinal, a linha diz que o mapa e as fotos ainda vão chegar — com o mapa e as fotos da janela de antes no aparelho: ${l}`);
  const p2 = await reabrirSemRede(ap);
  const r = p2.linha();
  assert.match(r, /prefs\.offline\.prontoSemRedeB/, `reaberta sem rede depois da renovação cortada: ${r}`);
});

test('R6-4-2: o app FECHADO no meio da renovação — reaberto sem rede, a linha segue com o que a preparação completa guardou', async () => {
  const { ap, p1, t0 } = await renovacaoNaJanelaSeguinte({ cortar: false });
  assert.equal(p1.estado().varrendo, true, 'PRÉ-CONDIÇÃO: a renovação não está no ar (o app fecha no meio dela)');
  assert.equal(ap.base.get('fila').t, t0, 'a renovação regravou a MESMA fila com outro carimbo — a cobertura da base ficou velha');
  const p2 = await reabrirSemRede(ap);
  const r = p2.linha();
  assert.match(r, /prefs\.offline\.prontoSemRedeB/, `reaberta sem rede depois de fechar no meio da renovação: ${r}`);
});

test('R6-4-2: CONTROLE — a renovação com um pedido NOVO, cortada no meio: sem sinal, a linha segue dizendo que o mapa e as fotos chegam', async () => {
  const { ap, p1 } = await filaAPronta();
  ap.relogio.agora += 1200000;
  p1.voltar();
  p1.rede.ok = false;
  await p1.buscar([ap.NOVO]);                      // a busca trouxe um pedido, e a preparação dele cai
  await assentarBase();
  assert.equal(p1.estado().resultado, 'parcial', 'PRÉ-CONDIÇÃO');
  p1.navigator.onLine = false;
  assert.match(p1.linha(), /prefs\.offline\.esperaB/, 'o pedido novo, sem nada no aparelho, entrou no "Pronto"');
  const p2 = await reabrirSemRede(ap);
  assert.match(p2.linha(), /prefs\.offline\.esperaB/);
});

// ── A fila NÃO coberta volta pro GATILHO (auditoria de 2026-09-30) ───────────
// Com rede, a fila guardada que a preparação não cobriu esperava a janela virar:
// a busca a gravava com a pessoa parada (ou durante a varredura anterior), a
// pessoa voltava e abria os Filtros — um gatilho — e nada baixava (medido no
// navegador, t12: 0 pedidos de mídia depois do gesto, o tile do pedido novo fora
// do aparelho). Até 20 min de cards novos sem mapa nem foto pra quem saísse do
// sinal, com a linha dizendo "Ainda não preparado" e nada preparando.
async function filaBGravadaSemPreparar() {
  const { ap, p1 } = await filaAPronta();
  p1.parar();
  await p1.buscar([ap.NOVO]);
  await assentarBase();
  assert.equal(ap.base.get('fila').places.length, 4, 'PRÉ-CONDIÇÃO: a fila B não foi gravada');
  assert.equal(p1.rede.varreduras, 1, 'PRÉ-CONDIÇÃO: a preparação de B começou com a pessoa parada');
  assert.match(p1.linha(), /prefs\.offline\.pendenteA/, 'PRÉ-CONDIÇÃO: a fila B não ficou "Ainda não preparado"');
  return { ap, p1 };
}

test('gatilho: a pessoa volta e a fila B, gravada sem preparar, é preparada no próximo gatilho — e só o que falta', async () => {
  const { ap, p1 } = await filaBGravadaSemPreparar();
  const antes = p1.rede.baixados.length;
  // Parada, o gatilho não faz nada: a varredura dorme com a pessoa ociosa.
  p1.gatilho();
  await assentarBase();
  assert.equal(p1.rede.baixados.length, antes, 'com a pessoa parada, o gatilho baixou');
  p1.voltar();
  p1.gatilho();
  await assentarBase();
  assert.deepEqual(p1.rede.baixados.slice(antes).sort(), ['foto-b4', 'tile-b4'],
    `a pessoa voltou e a fila B não foi preparada no gatilho — ou baixou de novo o que já estava: ${JSON.stringify(p1.rede.baixados.slice(antes))}`);
  assert.equal(p1.estado().resultado, 'pronto');
  assert.match(p1.linha(), /prefs\.offline\.prontoB/, 'preparada, a fila B não voltou a dizer "Pronto"');
  const p2 = await reabrirSemRede(ap);
  assert.match(p2.linha(), /prefs\.offline\.prontoSemRedeB/, 'preparada, a fila B não diz "Pronto" reaberta sem rede');
});

test('gatilho: a busca chegou DURANTE a preparação de A — a pessoa volta, e o gatilho prepara só o pedido novo', async () => {
  const ap = aparelhoDaLinha();
  const p1 = ap.pagina({ fila: ap.A });
  p1.rede.segura = true;
  const varreduraDeA = p1.varrer();
  await assentarBase();
  p1.buscar([ap.NOVO]);
  await assentarBase();
  p1.parar();
  p1.soltar();
  await varreduraDeA;
  await assentarBase();
  assert.equal(p1.rede.varreduras, 1, 'PRÉ-CONDIÇÃO: a preparação de B (pedida de novo) começou com a pessoa parada');
  assert.match(p1.linha(), /prefs\.offline\.pendenteA/, 'PRÉ-CONDIÇÃO');
  const antes = p1.rede.baixados.length;
  p1.voltar();
  p1.gatilho();
  await assentarBase();
  assert.deepEqual(p1.rede.baixados.slice(antes).sort(), ['foto-b4', 'tile-b4'],
    `o gatilho não preparou o pedido novo — ou baixou de novo o que já estava: ${JSON.stringify(p1.rede.baixados.slice(antes))}`);
  assert.match(p1.linha(), /prefs\.offline\.prontoB/);
});

test('gatilho: a fila B reaberta sem rede, não coberta — a rede volta e o primeiro gatilho a prepara', async () => {
  const { ap } = await filaBGravadaSemPreparar();
  const p2 = await reabrirSemRede(ap);
  assert.match(p2.linha(), /prefs\.offline\.esperaB/, 'PRÉ-CONDIÇÃO: a fila B reaberta não estava como não coberta');
  p2.navigator.onLine = true;
  p2.gatilho();                      // a página nova nasce com o gesto de agora
  await assentarBase();
  assert.ok(p2.rede.baixados.includes('tile-b4') && p2.rede.baixados.includes('foto-b4'),
    `com a rede de volta, o gatilho não preparou o pedido novo: ${JSON.stringify(p2.rede.baixados)}`);
  assert.match(p2.linha(), /prefs\.offline\.prontoB/);
});

test('gatilho: CONTROLE — a fila já coberta não varre de novo, nem na mesma página nem reaberta com a rede de volta', async () => {
  const { ap, p1 } = await filaAPronta();
  const v = p1.rede.varreduras;
  for (let i = 0; i < 3; i++) { p1.voltar(); p1.gatilho(); }
  await assentarBase();
  assert.equal(p1.rede.varreduras, v, 'a fila coberta foi varrida de novo pelo gatilho');
  // Reaberta sem rede e com a rede de volta: a página nova não sabe o que já está
  // no aparelho, e varrer de novo conferiria tudo outra vez.
  const p2 = await reabrirSemRede(ap);
  p2.navigator.onLine = true;
  p2.voltar(); p2.gatilho();
  await assentarBase();
  assert.equal(p2.rede.varreduras, 0, 'reaberta com a rede de volta, a fila COBERTA foi varrida de novo');
  assert.deepEqual(p2.rede.baixados, []);
});

// Este controle afirmava o contrário — a MESMA fila regravada ganhava outro
// carimbo e deixava de estar coberta até uma varredura passar. É o mecanismo do
// R6-4-2: a renovação de cada janela regrava a mesma fila no começo, e cortada no
// meio (ou com o app fechado no meio) a linha sem sinal negava o que estava no
// aparelho. Hoje a mesma fila (ou parte dela) mantém o carimbo; pedido NOVO não.
test('gatilho: CONTROLE — a MESMA fila regravada mantém o carimbo e segue coberta (R6-4-2); com um pedido a menos também; com um NOVO, não', async () => {
  const { ap, p1 } = await filaAPronta();
  const t0 = ap.base.get('fila').t;
  assert.equal(await p1.gravarFila(), true);       // a mesma fila, gravada de novo
  await assentarBase();
  assert.equal(ap.base.get('fila').t, t0, 'a MESMA fila regravada ganhou outro carimbo — a cobertura da preparação completa se perde');
  assert.match(p1.linha(), /prefs\.offline\.prontoB/, 'a mesma fila regravada deixou de estar coberta');
  const v = p1.rede.varreduras;
  p1.gatilho();
  await assentarBase();
  assert.equal(p1.rede.varreduras, v, 'a fila coberta, regravada igual, foi varrida de novo na mesma janela');
  // Um pedido decidido sai: o que sobra é PARTE da fila coberta, e segue coberto.
  p1.AppState.queue.shift();
  assert.equal(await p1.gravarFila(), true);
  await assentarBase();
  assert.equal(ap.base.get('fila').places.length, 2, 'PRÉ-CONDIÇÃO: a fila gravada não é a que sobrou');
  assert.equal(ap.base.get('fila').t, t0, 'a fila com um pedido A MENOS ganhou outro carimbo');
  assert.match(p1.linha(), /prefs\.offline\.prontoB/);
  // CONTROLE: com um pedido NOVO é carimbo novo — e não coberta, como sempre.
  p1.AppState.queue.push(ap.NOVO);
  assert.equal(await p1.gravarFila(), true);
  await assentarBase();
  assert.notEqual(ap.base.get('fila').t, t0, 'a fila com um pedido NOVO manteve o carimbo da coberta — diria "Pronto" sem o mapa dele');
  assert.match(p1.linha(), /prefs\.offline\.pendenteA/);
});

test('gatilho: sem laço — a foto do pedido novo QUEBRADA (o resto andando) deixa a fila coberta (R5-4-1), e o gatilho não volta', async () => {
  const { p1 } = await filaBGravadaSemPreparar();
  p1.rede.ok = (u) => u !== 'foto-b4';             // o Waze tirou a foto do ar
  p1.voltar();
  p1.gatilho();
  await assentarBase();
  assert.equal(p1.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a foto quebrada deixou a preparação parcial');
  const v = p1.rede.varreduras;
  assert.equal(v, 2, 'PRÉ-CONDIÇÃO: o gatilho não varreu a fila não coberta');
  for (let i = 0; i < 3; i++) { p1.voltar(); p1.gatilho(); }
  await assentarBase();
  assert.equal(p1.rede.varreduras, v, 'a fila com a foto quebrada voltou a ser varrida a cada gatilho');
});

test('gatilho: sem laço — a fila que não dá pra cobrir (a gravação dela falha) não volta a cada gatilho; a próxima gravada, sim', async () => {
  const { ap, p1 } = await filaBGravadaSemPreparar();
  ap.fila.falhar = true;                           // a cota estourou: gravar a fila aborta
  p1.voltar();
  p1.gatilho();
  await assentarBase();
  assert.equal(p1.estado().resultado, 'pronto');
  const v = p1.rede.varreduras;
  assert.equal(v, 2, 'PRÉ-CONDIÇÃO: o gatilho não varreu a fila não coberta');
  assert.doesNotMatch(p1.linha(), PRONTO, 'sem a fila gravada, a linha passou a dizer "Pronto"');
  for (let i = 0; i < 3; i++) { p1.voltar(); p1.gatilho(); }
  await assentarBase();
  assert.equal(p1.rede.varreduras, v, 'a fila que não dá pra cobrir voltou a ser varrida a cada gatilho');
  // A gravação volta a funcionar: a próxima fila gravada volta pro gatilho.
  ap.fila.falhar = false;
  assert.equal(await p1.gravarFila(), true);
  await assentarBase();
  p1.gatilho();
  await assentarBase();
  assert.equal(p1.rede.varreduras, v + 1, 'a fila gravada depois da falha não voltou pro gatilho');
  assert.match(p1.linha(), /prefs\.offline\.prontoB/);
});

test('gatilho: com a varredura NO AR, o gatilho não pede outra — quem decide é o fim dela', async () => {
  const { ap, p1 } = await filaAPronta();
  assert.equal(await p1.gravarFila(), true);       // a busca gravou a fila…
  await assentarBase();
  ap.fila.segurar = true;                          // …e a gravação da varredura que ela chama demora
  const v = p1.rede.varreduras;
  const varredura = p1.varrer();
  await assentarBase();
  assert.equal(p1.estado().varrendo, true, 'PRÉ-CONDIÇÃO: a varredura não está no ar');
  p1.gatilho();                                    // uma resposta chega nesse meio
  ap.soltarFila();
  await varredura;
  await assentarBase();
  assert.equal(p1.rede.varreduras, v + 1, 'o gatilho no meio da varredura pediu outra, que não tinha o que fazer');
  assert.match(p1.linha(), /prefs\.offline\.prontoB/);
});

// ── R12-4-05 (auditoria da rodada 12): DUAS ABAS varrendo juntas ────────────
// A base do offline e o cache do mapa são do APARELHO, e cada aba grava a fila
// DELA na mesma base e poda o cache aos tiles da fila DELA. O `online` chega às
// duas, e com filas diferentes (a reposição de uma trouxe pedidos que a outra não
// tem) as duas varreduras corriam juntas: a fila guardada ficava a de quem gravou
// por último, e a poda da OUTRA apagava os tiles dos pedidos que só a primeira
// tinha — sem rede esses cards abriam sem mapa, com a linha dizendo "Pronto — 12
// pedidos no aparelho" (MEDIDO no navegador, n10 da auditoria: 6 de 12 sem mapa
// em 3 de 3 rodadas; com uma aba só, nenhum). Aqui duas "abas" — cada uma com o
// estado DELA — rodam o código de VERDADE (gravar a fila, varrer, reler a base,
// podar) sobre a MESMA base e o MESMO cache, de mentira, com a ordem segura: os
// downloads de uma esperam o teste soltar.
function duasAbasComCache() {
  const base = new Map();
  const cache = new Map();
  const relogio = { agora: 1492385 * 1200000 + 1000 };     // uma janela só
  const offlineDB = async () => ({
    close() {},
    transaction: () => {
      const tx = {};
      const fim = () => setTimeout(() => tx.oncomplete && tx.oncomplete());
      tx.objectStore = () => ({
        put: (v, k) => { base.set(k, JSON.parse(JSON.stringify(v))); fim(); },
        get: (k) => { const r = {}; setTimeout(() => { r.result = base.get(k); if (r.onsuccess) r.onsuccess(); fim(); }); return r; },
      });
      return tx;
    },
  });
  const caches = {
    has: async () => cache.size > 0,
    open: async () => ({
      keys: async () => [...cache.keys()].map((url) => ({ url })),
      delete: async (r) => { cache.delete(r.url); },
    }),
  };
  function aba(fila) {
    const rede = { segura: false, presos: [] };
    const diario = [];
    const AppState = { authenticated: true, queue: fila.slice(), filters: {} };
    const deps = {
      AppState, Treino: { ativo: false }, navigator: { onLine: true }, offlineLigado: () => true,
      Date: { now: () => relogio.agora++ },
      offlineDB, OFFLINE_STORE: 'fila', OFFLINE_TILES_CACHE: 'waze-places-tiles', caches,
      offlinePodarPousos: () => {}, dfato: (k) => diario.push(k),
      filaDeOnde: null, lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }), contaAgora: () => '111',
      marcaDaSessao: (t) => 'm-' + t, marcaDestaAba: () => 'm-tok', API: { getSession: () => 'tok' },
      OFFLINE_OCIOSO_MS: 180000, OFFLINE_CICLO_MS: 1200000, OFFLINE_CONCORRENCIA: 1,
      OFFLINE_ANUNCIAR_A_CADA: 50, OFFLINE_TENTATIVAS_POR_ITEM: constante('OFFLINE_TENTATIVAS_POR_ITEM'),
      // Um tile por pedido; o download grava no cache do aparelho, e com `segura`
      // fica preso até o teste soltar.
      offlineItensDaFila: async () => AppState.queue.map((p) => ({ u: 'tile-' + p.venueID, tile: true })),
      offlineBaixar: (u) => new Promise((ok) => {
        const r = () => { cache.set(u, true); ok(true); };
        if (rede.segura) rede.presos.push(r); else r();
      }),
      offlineSondarRede: async () => true, offlineAnunciarTiles: () => {}, atualizarLinhaDoOffline: () => {},
      offlineGravarJanela: () => {}, setTimeout: (fn) => { fn(); return 0; },
    };
    const nomes = ['filaReal', 'chaveDoPedido', 'offlineGravarFila', 'offlineLerFila', 'offlinePodarTiles', 'offlineVarrer'];
    const chaves = Object.keys(deps);
    const app = new Function(...chaves, `let offlineVarrendo = false, offlinePedidaDeNovo = false,
        offlineUltimoGesto = Date.now(), offlineJanelaServida = null, offlineUltimoResultado = null, offlineEpoca = 0,
        offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set() }, offlineFilaGravadaEm = null,
        offlineFilaPreparada = null, offlineFilaGravadaChaves = null, offlineFilaVarrida = null;
      ${nomes.map(fatiar).join('\n')}
      return { varrer: offlineVarrer,
        estado: () => ({ resultado: offlineUltimoResultado, varrendo: offlineVarrendo, gravada: offlineFilaGravadaEm }) };`)(
      ...chaves.map((k) => deps[k]));
    const soltar = () => { rede.segura = false; for (const r of rede.presos.splice(0)) r(); };
    return { ...app, rede, diario, soltar };
  }
  // Os pedidos da fila GUARDADA cujo mapa não está no aparelho.
  const semMapa = () => (base.get('fila') ? base.get('fila').places : [])
    .filter((p) => !cache.has('tile-' + p.venueID)).map((p) => p.venueID);
  return { aba, base, cache, semMapa };
}
const P5 = (i) => ({ venueID: 'p' + i, updateRequestID: 'u' + i });

test('R12-4-05: duas abas varrendo juntas — a poda de uma NÃO apaga o mapa da fila que a outra gravou por último', async () => {
  const ap = duasAbasComCache();
  const A = ap.aba([1, 2, 3].map(P5));
  const B = ap.aba([1, 2, 3, 30, 31].map(P5));            // a reposição de B trouxe dois que A não tem
  A.rede.segura = true;
  const varreA = A.varrer();                               // A grava a fila DELA e fica baixando…
  await assentarBase();
  assert.deepEqual(ap.base.get('fila').places.map((p) => p.venueID), ['p1', 'p2', 'p3'], 'PRÉ-CONDIÇÃO: A não gravou a fila dela');
  await B.varrer();                                        // …B grava a DELA por cima, baixa tudo e poda
  await assentarBase();
  assert.equal(B.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a varredura de B não ficou pronta');
  assert.deepEqual(ap.semMapa(), [], 'PRÉ-CONDIÇÃO: com a varredura de B pronta, a fila guardada já tinha pedido sem mapa');
  A.soltar();
  await varreA;
  await assentarBase();
  assert.equal(A.estado().resultado, 'pronto', 'PRÉ-CONDIÇÃO: a varredura de A não ficou pronta');
  assert.deepEqual(ap.base.get('fila').places.map((p) => p.venueID), ['p1', 'p2', 'p3', 'p30', 'p31'],
    'PRÉ-CONDIÇÃO: a fila guardada não é a de B (a que gravou por último)');
  assert.deepEqual(ap.semMapa(), [],
    'DEFEITO: a poda da aba A apagou o mapa dos pedidos que só a fila guardada (a de B) tem — sem rede, esses cards '
    + 'abrem sem mapa com a linha dizendo "Pronto"');
  assert.ok(!A.diario.includes('offline.podou'), 'a aba A podou o cache com a fila guardada sendo a de B');
});

test('R12-4-05 CONTROLE: a ordem inversa (A grava por último) e a aba sozinha — a poda segue valendo pra fila guardada', async () => {
  // Quem gravou por último é A: a fila guardada é a dela, e o mapa dela fica todo.
  const inv = duasAbasComCache();
  const A = inv.aba([1, 2, 3].map(P5));
  const B = inv.aba([1, 2, 3, 30, 31].map(P5));
  B.rede.segura = true;
  const varreB = B.varrer();
  await assentarBase();
  await A.varrer();
  await assentarBase();
  B.soltar();
  await varreB;
  await assentarBase();
  assert.deepEqual(inv.base.get('fila').places.map((p) => p.venueID), ['p1', 'p2', 'p3']);
  assert.deepEqual([A.estado().resultado, B.estado().resultado, inv.semMapa()], ['pronto', 'pronto', []],
    'com A gravando por último, a fila guardada (a de A) ficou sem mapa');
  // A aba SOZINHA: a poda segue tirando do cache o que não é da fila guardada
  // (o tile de uma fila velha) — sem isto, "não podou" passaria com a poda morta.
  const so = duasAbasComCache();
  so.cache.set('tile-velho', true);
  const C = so.aba([1, 2].map(P5));
  await C.varrer();
  await assentarBase();
  assert.equal(C.estado().resultado, 'pronto');
  assert.equal(so.cache.has('tile-velho'), false, 'CONTROLE: com a fila guardada sendo a desta aba, a poda não tirou o tile velho');
  assert.ok(C.diario.includes('offline.podou'));
  assert.deepEqual(so.semMapa(), []);
});
