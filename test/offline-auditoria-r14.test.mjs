// Rodada 14 da auditoria (2026-10-07), a parte do OFFLINE e do DIAGNÓSTICO — o
// lote 18. Todos MEDIDOS no navegador pelos roteiros da rodada 14 (r14-4):
//
//  · R14-4-04 — a gravação da fila guardada não conferia a ÉPOCA do offline
//    depois de abrir a base: o "Sair" de OUTRA aba apaga a base, e a gravação
//    que já estava a caminho (a resposta de uma busca chegou antes do aviso) a
//    abria de novo — abrir CRIA a base — e gravava nela os pedidos de terceiros,
//    com a aba já sem sessão.
//
// Os testes RODAM o código de verdade, fatiado do app.js, sobre uma base do
// IndexedDB de mentira que se comporta como a de verdade no que importa aqui: a
// abertura leva uma tarefa, a transação só fecha depois de TODOS os pedidos dela
// (inclusive os feitos no `onsuccess` de outro), e apagar a base apaga tudo.
// Cada teste tem o CONTROLE que dá o resultado oposto, e foi visto REPROVANDO
// com o conserto desfeito (sabotagem no relatório do lote 18).
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
const constante = (nome) => {
  const m = new RegExp(`^const ${nome} = ([^;]+);`, 'm').exec(APP_SEM);
  assert.ok(m, `a constante ${nome} sumiu`);
  return new Function(`return (${m[1]});`)();
};
const OFFLINE_STORE = constante('OFFLINE_STORE');
const OFFLINE_DB = constante('OFFLINE_DB');
const OFFLINE_POUSOS_KEY = constante('OFFLINE_POUSOS_KEY');

const tique = (ms = 1) => new Promise((ok) => setTimeout(ok, ms));
const P = (i) => ({ venueID: 'v' + i, updateRequestID: 'u' + i, name: 'Local ' + i });
const chave = (p) => p.venueID + '|' + p.updateRequestID;
const marcaDe = new Function(fatiar('marcaDaSessao') + '\nreturn marcaDaSessao;')();

// ── A base do IndexedDB, de mentira e do APARELHO (as abas a dividem) ────────
// Abrir leva uma tarefa (é nesse meio que o aviso do "Sair" chega); cada pedido
// é atendido numa tarefa à parte, na ordem; a transação fecha (`oncomplete`) só
// quando não sobra pedido — inclusive o `put` feito no `onsuccess` de um `get`,
// como na de verdade. `aoGravar(k)`: um gancho no instante em que o `put` grava.
function baseIDB() {
  const guardado = new Map();
  // `existe`: abrir a base CRIA a base (o `onupgradeneeded`), mesmo vazia.
  const ganchos = { aoGravar: null, aberturas: 0, apagamentos: 0, leituras: [], gravacoes: 0, existe: false };
  const offlineDB = async () => {
    await tique();
    ganchos.aberturas++;
    ganchos.existe = true;
    return {
      close() {},
      transaction() {
        const tx = {};
        let pendentes = 0;
        let fechou = false;
        const fechar = () => { if (!fechou) { fechou = true; setTimeout(() => tx.oncomplete && tx.oncomplete()); } };
        // A transação sem pedido nenhum fecha sozinha.
        setTimeout(() => { if (pendentes === 0) fechar(); });
        const pedido = (fazer) => {
          pendentes++;
          const r = {};
          setTimeout(() => {
            r.result = fazer();
            if (typeof r.onsuccess === 'function') r.onsuccess();
            if (--pendentes === 0) fechar();
          });
          return r;
        };
        tx.objectStore = () => ({
          get: (k) => { ganchos.leituras.push(k); return pedido(() => (guardado.has(k) ? structuredClone(guardado.get(k)) : undefined)); },
          put: (v, k) => pedido(() => { ganchos.gravacoes++; guardado.set(k, structuredClone(v)); if (ganchos.aoGravar) ganchos.aoGravar(k); }),
        });
        return tx;
      },
    };
  };
  // Apagar a base apaga TUDO (o `deleteDatabase` de verdade, de qualquer aba).
  const indexedDB = { deleteDatabase: () => { ganchos.apagamentos++; ganchos.existe = false; guardado.clear(); } };
  return { guardado, ganchos, offlineDB, indexedDB };
}

// ── UMA aba: a gravação e o esquecer DE VERDADE ──────────────────────────────
// `sessao`: o token na MEMÓRIA desta aba (o `marcaDestaAba` de verdade lê o
// `API.sessionToken`). `canal`: o que esta aba avisou às outras.
const NOMES = ['chaveDoPedido', 'filaReal', 'marcaDaSessao', 'marcaDestaAba', 'offlineGravarFila', 'offlineEsquecer'];
function aba({ base, fila = [], sessao = 'tok-a' } = {}) {
  const diario = [];
  const avisos = [];
  const podas = [];
  const API = { sessionToken: sessao, soltarSessao() { this.sessionToken = null; } };
  const AppState = { authenticated: !!sessao, queue: fila.slice(), currentPlace: fila[0] || null, filters: { countryId: 30 },
    preferences: { offlineDisponivel: true } };
  const deps = {
    AppState, API, Treino: { ativo: false, _salvo: null, esquecerFilaGuardada() {} },
    window: {}, safeLS: { remove() {} },
    OFFLINE_STORE, OFFLINE_DB, OFFLINE_POUSOS_KEY, OFFLINE_TILES_CACHE: 'waze-places-tiles',
    offlineDB: base.offlineDB, indexedDB: base.indexedDB,
    offlineLigado: () => AppState.preferences.offlineDisponivel === true,
    contaAgora: () => (API.sessionToken ? '4242' : null),
    lugarAgora: () => ({ regiao: 'row', pais: '30', busca: 'b' }),
    avisarOutrasAbasDaFilaGuardada: (t) => avisos.push(t),
    offlinePodarPousos: (desde) => podas.push(desde),
    offlineAnunciarTiles: () => {}, dfato: (k, o) => diario.push([k, o || {}]),
  };
  const chaves = Object.keys(deps);
  const fonte = [
    'let filaDeOnde = null, offlineFilaGravadaEm = null, offlineFilaGravadaChaves = null, offlineFilaPreparada = null,',
    '    offlineFilaVarrida = null, offlineJanelaServida = null, offlineUltimoResultado = null, offlineEpoca = 0,',
    '    diagTilesGuardadosQueFalharam = [], offlineFeitosNaJanela = { janela: null, epoca: -1, us: new Set(), guardados: new Set() };',
    'const decididosPorOutraAbaComCardAqui = new WeakSet(), pedidosEmAndamento = new Set(), pedidosQuePousaram = new WeakSet();',
    ...NOMES.map(fatiar),
    `return { ${NOMES.join(', ')}, estado: () => ({ gravada: offlineFilaGravadaEm, epoca: offlineEpoca }) };`,
  ].join('\n');
  const app = new Function(...chaves, fonte)(...chaves.map((k) => deps[k]));
  // O aviso do "Sair" de OUTRA aba, como o `handleLogout({ porOutraAba })` o
  // aplica aqui: a memória do offline sai (a base, a outra já apagou) e a sessão
  // é solta.
  const sairDeOutraAba = () => { app.offlineEsquecer({ soMemoria: true }); API.soltarSessao(); AppState.authenticated = false; };
  return { app, AppState, API, diario, avisos, podas, sairDeOutraAba };
}

// ═══ R14-4-04 · a gravação depois do "Sair" de outra aba ═════════════════════
// O roteiro e7 do auditor, com a ordem da corrida FORÇADA: a outra aba deu
// "Sair" (apagou a base), esta começou a gravar (a resposta de uma busca chegou)
// ANTES de o aviso do "Sair" chegar aqui, e o aviso chega com a gravação no ar.
async function gravacaoComOSairNoMeio({ quando }) {
  const base = baseIDB();
  base.guardado.set('fila', { t: 1, places: [P(9)] });   // a fila guardada de antes do "Sair"
  base.ganchos.existe = true;
  const A = aba({ base, fila: [P(1), P(2), P(3)] });
  base.indexedDB.deleteDatabase();                        // o "Sair" da outra aba apagou a base
  if (quando === 'antes') A.sairDeOutraAba();             // CONTROLE: o aviso chegou antes
  if (quando === 'naTransacao') {
    // O aviso chega com a transação NO AR: o `put` já gravou, e ela ainda não fechou.
    base.ganchos.aoGravar = (k) => { if (k === 'fila') A.sairDeOutraAba(); };
  }
  const gravacao = A.app.offlineGravarFila();
  if (quando === 'naAbertura') A.sairDeOutraAba();        // o aviso chega enquanto a base abre
  const gravou = await gravacao;
  await tique(5);
  return { gravou, A, base };
}

test('R14-4-04: o "Sair" de outra aba chega com a base ABRINDO — a gravação não recria a base com os pedidos de terceiros', async () => {
  const r = await gravacaoComOSairNoMeio({ quando: 'naAbertura' });
  assert.equal(r.gravou, false, 'DEFEITO: a gravação seguiu depois do "Sair" da outra aba');
  assert.equal(r.base.guardado.has('fila'), false,
    `DEFEITO: a base apagada pelo "Sair" voltou com a fila guardada: ${JSON.stringify([...r.base.guardado.keys()])}`);
  // Nem por um instante: a página que morre entre gravar e apagar deixaria a fila no aparelho.
  assert.equal(r.base.ganchos.gravacoes, 0, 'DEFEITO: a fila foi gravada (e só depois apagada) com a época já trocada');
  assert.equal(r.base.ganchos.existe, false, 'DEFEITO: a base que a abertura recriou VAZIA ficou no aparelho depois do "Sair"');
  assert.deepEqual(r.A.avisos, [], 'a gravação desfeita avisou as outras abas de uma fila que não existe');
  assert.deepEqual(r.A.podas, [], 'a gravação desfeita podou os pousos');
  assert.equal(r.A.app.estado().gravada, null, 'a memória da aba ficou com o carimbo de uma fila que não existe');
});

test('R14-4-04: o "Sair" de outra aba chega com a transação NO AR — o que ela gravou sai da base', async () => {
  const r = await gravacaoComOSairNoMeio({ quando: 'naTransacao' });
  assert.equal(r.gravou, false, 'DEFEITO: a gravação devolveu "gravou" com a época trocada no meio');
  assert.equal(r.base.guardado.has('fila'), false,
    'DEFEITO: a fila gravada com a transação no ar ficou na base depois do "Sair" da outra aba');
  assert.equal(r.base.ganchos.existe, false, 'DEFEITO: a base recriada pela gravação ficou no aparelho');
  assert.deepEqual(r.A.avisos, [], 'a gravação desfeita avisou as outras abas');
  assert.equal(r.A.app.estado().gravada, null, 'a memória da aba ficou com o carimbo de uma fila que não existe');
});

test('R14-4-04: CONTROLE — sem "Sair" no meio, grava; e com o aviso ANTES (a sessão solta), não grava nem abre a base', async () => {
  const ok = await gravacaoComOSairNoMeio({ quando: 'nunca' });
  assert.equal(ok.gravou, true, 'CONTROLE: sem o "Sair" no meio a fila não foi gravada');
  assert.deepEqual(ok.base.guardado.get('fila').places.map(chave), ['v1|u1', 'v2|u2', 'v3|u3']);
  assert.equal(ok.A.avisos.length, 1, 'CONTROLE: a gravação não avisou as outras abas');
  // A única vez em que a base foi apagada é a do "Sair" de mentira, antes de tudo.
  assert.equal(ok.base.ganchos.apagamentos, 1, 'a gravação sem "Sair" no meio apagou a base');
  assert.equal(ok.base.ganchos.existe, true);
  const antes = await gravacaoComOSairNoMeio({ quando: 'antes' });
  assert.equal(antes.gravou, false);
  assert.equal(antes.base.ganchos.aberturas, 0, 'sem sessão a gravação nem abre a base (R13-4-04)');
  assert.equal(antes.base.guardado.size, 0);
});

// ═══ os testes fatiam o FONTE; o app carrega o `js/min/` (gotcha #22) ═════════
test('o bundle GERADO tem os consertos (senão nada disso está no ar)', () => {
  const contar = (s, re) => (s.match(re) || []).length;
  for (const nome of ['offlineGravarFila', 'offlineEpoca']) {
    const re = new RegExp('\\b' + nome + '\\b', 'g');
    assert.ok(contar(APP_SEM, re) > 0, `PRÉ-CONDIÇÃO: ${nome} sumiu do fonte`);
    assert.equal(contar(MIN, re), contar(APP_SEM, re), `js/min/app.js está atrás do fonte em ${nome} — falta \`npm run js\``);
  }
});
