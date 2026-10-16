// Lote 28 — o que a rodada 24 achou ao redor da fila de saída, do Histórico, do diagnóstico e da varredura do
// offline. O rótulo é o do relatório. Cada teste foi visto REPROVANDO com o conserto desfeito.
//
//   R24-1-01 = R24-7-03  o escritor do Histórico e o leitor concordam no que é um contador (inteiro ≥ 0)
//   R24-4-06             o `deleteDatabase` do diagnóstico tem TETO (IndexedDB morto não pendura a fila de gravações)
//   R24-4-08             o leitor do diagnóstico aceita BOM e não imprime `undefined`; o relatório diz as decisões
//                        que o aparelho não deixou tirar da fila (`lembradosSemGravar`)
//   R24-4-04             a varredura do offline cede a thread por TEMPO, lido a CADA pedido
//   R24-6                código morto do «sem sinal e tudo guardado»; as duas migrações de família `aparelho` saíram
//   (R24-2-01 e a família da fila que não grava: `fila-nao-grava-fuzz.test.mjs`; R24-2-02: `conta.test.mjs`)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const semComentario = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const APP = ler('js/app.js');
const APP_SEM = semComentario(APP);

function fatiarDe(fonte, nome) {
  const m = new RegExp('^(async )?function ' + nome + '\\(', 'm').exec(fonte);
  assert.ok(m, `${nome} sumiu`);
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
      assert.ok(corpo.length > 40, `fatiar('${nome}') devolveu ${corpo.length} chars — o instrumento quebrou`);
      return corpo;
    }
  }
  throw new Error('não fechou: ' + nome);
}
function montar(nomes, deps, devolve = nomes) {
  const chaves = Object.keys(deps);
  return new Function(...chaves, nomes.map((n) => fatiarDe(APP_SEM, n)).join('\n') + `\nreturn { ${devolve.join(', ')} };`)(...chaves.map((k) => deps[k]));
}

// ═══ R24-1-01 · escritor e leitor do Histórico concordam ═══════════════════════════════════════════════
test('R24-1-01: com contador FRACIONÁRIO guardado, o `recordHistory` não soma sobre o que o leitor lê como 0', () => {
  const guardado = new Map([['waze_places_history', JSON.stringify({ _total: { read: 1.5, rejected: 2.5 },
    '2026-10-15': { read: 0.5, rejected: 3, onde: { '30': 1.5 } } })]]);
  const AppState = { history: null };
  const deps = {
    AppState, HISTORY_KEY: 'waze_places_history',
    localStorage: { getItem: (k) => (guardado.has(k) ? guardado.get(k) : null) },
    podarHistorico: () => false, salvarHistorico: (h) => guardado.set('waze_places_history', JSON.stringify(h)),
    historyTodayKey: () => '2026-10-15', ondeAgora: () => '30', agendarRedesenhoDoHistorico: () => {},
    garantirLinhaDeBaseDasConquistas: () => {}, textoDaCopia: new WeakMap(),
  };
  const { recordHistory, contagemDoHistorico } = montar(['copiaEmDia', 'lembrarTextoDaCopia', 'loadHistory', 'recordHistory', 'contagemDoHistorico'], deps, ['recordHistory', 'contagemDoHistorico']);
  recordHistory('read', 1);
  recordHistory('read', 1);
  const h = JSON.parse(guardado.get('waze_places_history'));
  // O leitor devolve 0 para o fracionário; o escritor tem que partir do MESMO 0 (1, 2) — e não de 1.5 (2.5, 3.5).
  assert.equal(h._total.read, 2, `DEFEITO: o escritor somou sobre o fracionário (${h._total.read}) e o leitor leria ${contagemDoHistorico(h._total.read)}`);
  assert.equal(contagemDoHistorico(h._total.read), 2, 'o que o escritor grava é o que o leitor lê');
  assert.equal(h['2026-10-15'].read, 2);
  assert.equal(h['2026-10-15'].onde['30'], 2, 'o contador por lugar partiu do fracionário');
  assert.equal(contagemDoHistorico(h._total.rejected), 0, 'o contador que não recebeu soma segue como estava no aparelho, e o leitor o lê como 0');
  // CONTROLE: inteiro soma normalmente.
  guardado.set('waze_places_history', JSON.stringify({ _total: { read: 10, rejected: 0 } })); AppState.history = null;
  recordHistory('read', 1);
  assert.equal(JSON.parse(guardado.get('waze_places_history'))._total.read, 11);
});

test('R24-1-01: o escritor passa pelo leitor (guard na fonte)', () => {
  assert.match(fatiarDe(APP_SEM, 'recordHistory'), /const numero = contagemDoHistorico;/);
  assert.ok(!/Number\.isFinite\(x\) \? x : 0/.test(fatiarDe(APP_SEM, 'recordHistory')), 'o escritor voltou ao critério próprio');
});

// ═══ R24-4-06 · o `deleteDatabase` do diagnóstico tem teto ═════════════════════════════════════════════
test('R24-4-06: com o IndexedDB MORTO (nenhum evento do `deleteDatabase`), o apagar do diagnóstico termina e a fila de gravações destrava', async () => {
  const deps = {
    diagEpoca: 0, diagGuardando: Promise.resolve(), DIAG_DB: 'waze_places_diag', DIAG_DB_TETO_MS: 40,
    indexedDB: { deleteDatabase: () => ({}) },       // nunca chama onsuccess/onerror/onblocked
    esperarComTeto: new Function(fatiarDe(APP_SEM, 'esperarComTeto') + '\nreturn esperarComTeto;')(),
  };
  const { diagEsquecerGuardado } = montar(['diagEsquecerGuardado'], deps);
  const antes = performance.now();
  const r = await Promise.race([diagEsquecerGuardado(), new Promise((ok) => setTimeout(() => ok('PENDURADO'), 1500))]);
  assert.notEqual(r, 'PENDURADO', 'DEFEITO: o apagar do diagnóstico pendurou com o IndexedDB morto');
  assert.equal(r, false, 'estourado, vale «não apagou»');
  assert.ok(performance.now() - antes < 1000);
  // A fila das gravações (onde toda gravação e todo apagar esperam) também destravou.
  const f = await Promise.race([deps.diagGuardando, new Promise((ok) => setTimeout(() => ok('PENDURADO'), 1500))]);
  assert.notEqual(f, 'PENDURADO', 'DEFEITO: a fila `diagGuardando` ficou pendurada pra sempre');
  // CONTROLE: o IndexedDB que responde segue apagando (true).
  const ok = { diagEpoca: 0, diagGuardando: Promise.resolve(), DIAG_DB: 'x', DIAG_DB_TETO_MS: 40,
    indexedDB: { deleteDatabase: () => { const r2 = {}; setTimeout(() => r2.onsuccess(), 1); return r2; } }, esperarComTeto: deps.esperarComTeto };
  assert.equal(await montar(['diagEsquecerGuardado'], ok).diagEsquecerGuardado(), true);
});

// ═══ R24-4-08 · o leitor do diagnóstico ═════════════════════════════════════════════════════════════════
function relatorio(extra = {}) {
  return {
    _versaoDoDiag: 11, _gerado: '2026-10-15T12:00:00.000Z', app: { rotulo: '2026.10.15-03' },
    ambiente: { ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/153', online: true, standalone: false, tela: { w: 412, h: 915, dpr: 2.6, janela: '412x800' } },
    resumo: { rede: true, offline: 'desligado', chamadas: 3, falhas: 0, errosDeJs: 0, momentos: 1, alertas: [],
      telaAgora: { tela: 'app', painel: 'card', cardMontado: true, modais: [], lightbox: false },
      saida: { n: 1, distintas: 1, repetidas: 0, tipos: { reject: 1 }, maisAntigaMin: 2, lembradosSemGravar: 2 } },
    diario: [], chamadas: [], momentos: [], erros: [], ...extra,
  };
}
function rodarResumo(obj, comoTexto = null) {
  const dir = mkdtempSync(join(tmpdir(), 'lote28-'));
  const arq = join(dir, 'd.json');
  writeFileSync(arq, comoTexto !== null ? comoTexto : JSON.stringify(obj));
  return execFileSync(process.execPath, [join(new URL('..', import.meta.url).pathname, 'tools/diag-resumo.mjs'), arq], { encoding: 'utf8', timeout: 20000 });
}

test('R24-4-08: o `.json` do diagnóstico com BOM abre (o BOM é gerado POR CÓDIGO)', () => {
  const bom = String.fromCharCode(0xFEFF);
  assert.equal(bom.length, 1);
  const s = rodarResumo(null, bom + JSON.stringify(relatorio()));
  assert.match(s, /relatório v11/);
  assert.ok(!/undefined|NaN|\[object/.test(s), 'o leitor imprimiu lixo');
});

test('R24-4-08: o relatório diz as decisões que o aparelho não deixou tirar da fila — só quando > 0', () => {
  const com = rodarResumo(relatorio());
  assert.match(com, /2 decisões já enviadas que o aparelho não deixou tirar da fila/);
  const zero = relatorio(); zero.resumo.saida.lembradosSemGravar = 0;
  assert.ok(!/não deixou tirar da fila/.test(rodarResumo(zero)), 'a linha apareceu com zero (ruído)');
  const antigo = relatorio(); delete antigo.resumo.saida.lembradosSemGravar;
  assert.ok(!/não deixou tirar da fila/.test(rodarResumo(antigo)), 'relatório de antes do campo ganhou a linha');
});

test('R24-4-08: relatório ANTIGO sem campos não imprime `undefined` — cada campo tirado, um a um', () => {
  const base = relatorio();
  const caminhos = [];
  const andar = (o, pre) => { for (const k of Object.keys(o)) { caminhos.push([...pre, k]); if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && pre.length < 2) andar(o[k], [...pre, k]); } };
  andar(base, []);
  assert.ok(caminhos.length > 20, 'o fuzz de campos ficou pequeno demais');
  for (const c of caminhos) {
    const d = JSON.parse(JSON.stringify(base));
    let alvo = d; for (const k of c.slice(0, -1)) alvo = alvo[k];
    delete alvo[c[c.length - 1]];
    const s = rodarResumo(d);
    const ruim = s.split('\n').find((l) => /\bundefined\b|\bNaN\b|\[object/.test(l));
    assert.ok(!ruim, `sem \`${c.join('.')}\`: o leitor imprimiu «${ruim && ruim.slice(0, 160)}»`);
  }
});

// ═══ R24-4-04 · a varredura cede a thread por TEMPO, lido a cada pedido ═════════════════════════════════
test('R24-4-04: `offlineItensDaFila` cede a thread a cada 8 ms de trabalho, medido a CADA pedido', async () => {
  // Cada pedido «custa» `custo` ms num relógio de mentira; a cessão (`setTimeout 0`) é o que o laço faz entre as fatias.
  async function medir(custo, pedidos) {
    let agora = 0;
    const cessoes = [];
    let trabalhoDesdeACessao = 0, maior = 0;
    const fila = Array.from({ length: pedidos }, (_, i) => ({ venueID: 'v' + i }));
    const deps = {
      performance: { now: () => agora },
      setTimeout: (f) => { cessoes.push(trabalhoDesdeACessao); maior = Math.max(maior, trabalhoDesdeACessao); trabalhoDesdeACessao = 0; f(); },
      filaReal: () => fila, offlineFaixaDeCaixas: () => ({}),
      tilesDaFaixa: () => { agora += custo; trabalhoDesdeACessao += custo; return []; },
      fotosDoCard: () => ({ urls: [], inicial: 0 }),
    };
    const { offlineItensDaFila } = montar(['offlineItensDaFila'], deps);
    await offlineItensDaFila(1);
    maior = Math.max(maior, trabalhoDesdeACessao);
    return { cessoes: cessoes.length, maior };
  }
  // 3 ms por pedido: cede quando passa de 8 → fatia de 9 ms. Com «a cada 4 pedidos» a fatia era de 12.
  const a = await medir(3, 40);
  assert.ok(a.cessoes >= 10, `DEFEITO: só ${a.cessoes} cessões em 40 pedidos de 3 ms — a varredura não cede por tempo`);
  assert.ok(a.maior <= 10, `DEFEITO: a maior fatia sem ceder foi de ${a.maior} ms (o teto é 8 ms + um pedido): o relógio só era lido a cada 4 pedidos`);
  // 9 ms por pedido (celular a 6×): tem que ceder a CADA pedido, e não a cada 4 (36 ms de tarefa longa).
  const b = await medir(9, 24);
  assert.ok(b.maior <= 9, `DEFEITO: com pedidos de 9 ms a maior fatia foi de ${b.maior} ms — devia ceder a cada pedido`);
  // CONTROLE: o relógio parado (nada custa) não cede nunca — o instrumento enxerga a diferença.
  const c = await medir(0, 40);
  assert.equal(c.cessoes, 0);
});

test('R24-4-04: o laço da varredura NÃO conta pedidos (`% 4`): o tempo é lido a cada volta (guard na fonte)', () => {
  const f = fatiarDe(APP_SEM, 'offlineItensDaFila');
  assert.match(f, /if \(performance\.now\(\) - ultimaCessao > 8\) \{/);
  assert.ok(!/% 4/.test(f), 'a cessão voltou a contar pedidos');
  assert.match(f, /await new Promise\(\(r\) => setTimeout\(r, 0\)\)/, 'a cessão da thread sumiu');
});

// ═══ R24-6 · código morto e migrações vencidas ══════════════════════════════════════════════════════════
test('R24-6: o «sem sinal e tudo guardado» não escolhe o texto do zero (n ≥ 1 ali); o zero mora no «Pronto» de baixo', () => {
  const corpo = fatiarDe(APP_SEM, 'atualizarLinhaDoOffline');
  const semSinal = /if \(semRede && fotosValem && n\) \{[^]*?return;/.exec(corpo);
  assert.ok(semSinal);
  assert.ok(!/prontoAZero/.test(semSinal[0]), 'código morto de volta');
  assert.match(corpo, /n === 1 \? 'prefs\.offline\.prontoA' : n === 0 \? 'prefs\.offline\.prontoAZero' : 'prefs\.offline\.prontoAPlural'/);
});

test('R24-6: as migrações `saida-sem-marca` e `fila-guardada-desde` cumpriram o prazo e SAÍRAM (código, marcador e registro)', () => {
  const REG = ler('tools/migracoes.mjs');
  for (const id of ['saida-sem-marca', 'fila-guardada-desde']) {
    assert.ok(!REG.includes(`id: '${id}'`), `${id} ainda está no registro`);
    assert.ok(!APP.includes(`MIGRACAO: ${id}`), `${id} ainda tem marcador no app.js`);
  }
  assert.ok(!/adotarSaidaSemMarca/.test(APP), '`adotarSaidaSemMarca` voltou');
  assert.ok(!/guardada\.desde : guardada\.t/.test(APP), 'o `: guardada.t` voltou');
  // A `regiao-world` saiu no lote de SW/servidor (R24-4); aqui só importa que as duas da fila não voltaram.
});
