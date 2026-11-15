// O GRAVADOR DE GESTOS DO MODO DEV (pedido do dono, 2026-11-15; v2026.11.15-03).
//
// O diagnóstico tirava UMA foto do estado, no instante em que o arraste cruzava o limiar, e o defeito das
// faixas finas do Android acontecia DEPOIS, na saída do card (e também pelo ✓/✕). O ZIP dizia o estado de
// um instante e só o vídeo dizia quando e quanto. Agora o app grava, só com o modo dev ligado, o que a
// PÁGINA fez em cada gesto, quadro a quadro, e o relatório leva os últimos 20.
//
// O que se prova aqui, sem navegador: o gravador EXECUTADO de verdade num ambiente de mentira (relógio,
// quadros e temporizadores controlados), a régua do "cresceu" (que app, sentinela e triador dividem), a
// sonda de barras, e os PONTOS onde o app a chama. O que o navegador faz está no `tools/smoke-fluxo.mjs`
// (seção 7, com o controle sem o conserto). Cada guard foi sabotado: tirada a coisa, reprova.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ler = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const APP = ler('js/app.js');
const SWIPE = ler('js/swipe.js');
const semComentarioJs = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// ── o corte: do começo do gravador até a `diagNoInstante` ──
const INICIO = '// ── O GRAVADOR DE GESTOS (modo dev)';
const FIM = 'function diagNoInstante() {';
assert.ok(APP.includes(INICIO) && APP.includes(FIM), 'o gravador sumiu do app.js');
const TRECHO = APP.slice(APP.indexOf(INICIO), APP.indexOf(FIM));

// Ambiente de mentira: relógio, fila de quadros e temporizadores à mão. `pagina` é o que o gravador lê.
function montar({ ligado = true } = {}) {
  const e = { agora: 1000, quadros: [], timers: [], proximoTimer: 1 };
  const classes = new Set();
  const pagina = { ex: 0, ey: 0, sx: 0, sy: 0, vv: { scale: 1, offsetLeft: 0, offsetTop: 0, pageLeft: 0 },
                   overflowHtml: ['hidden', 'hidden'], overflowBody: ['clip', 'clip'] };
  const raiz = { classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c),
                              [Symbol.iterator]: () => classes[Symbol.iterator]() } };
  Object.defineProperty(raiz.classList, 'forEach', { value: (f) => classes.forEach(f) });
  // [...raiz.classList] precisa funcionar: o gravador espalha a lista de classes.
  raiz.classList[Symbol.iterator] = () => classes[Symbol.iterator]();
  const corpo = {};
  const doc = {
    documentElement: raiz, body: corpo,
    scrollingElement: { get scrollWidth() { return 411 + pagina.ex; }, get clientWidth() { return 411; },
                        get scrollHeight() { return 841 + pagina.ey; }, get clientHeight() { return 841; } },
  };
  const win = { get scrollX() { return pagina.sx; }, get scrollY() { return pagina.sy; },
                get visualViewport() { return pagina.vv; }, gestoAtual: () => e.gesto || {} };
  const f = new Function('dlogLigado', 'document', 'window', 'performance', 'requestAnimationFrame',
    'setTimeout', 'clearTimeout', 'getComputedStyle', 'Date',
    TRECHO + '\nreturn { diagGestoAoMudar, diagGestosRecentes, diagGestoEmCurso, diagGestoCresceu, diagAlertasDeGestos,'
           + ' diagResumoDosGestos, diagReduzirSerie, dlogGestosRef: () => dlogGestos, zerar: () => { dlogGestos = []; diagGestoAtual = null; },'
           + ' DIAG_GESTOS_MAX, DIAG_GESTO_FOLGA_MS, DIAG_GESTO_SERIE_MAX, DIAG_GESTO_QUADROS_MAX };');
  const api = f(
    () => ligado && e.ligado !== false, doc, win,
    { now: () => e.agora },
    (fn) => { e.quadros.push(fn); return e.quadros.length; },
    (fn, ms) => { const id = e.proximoTimer++; e.timers.push({ id, fn, em: e.agora + ms }); return id; },
    (id) => { e.timers = e.timers.filter((t) => t.id !== id); },
    (el) => ({ overflowX: (el === raiz ? pagina.overflowHtml : pagina.overflowBody)[0],
               overflowY: (el === raiz ? pagina.overflowHtml : pagina.overflowBody)[1] }),
    class { static now() { return 1_700_000_000_000 + e.agora; } constructor(ms) { this.ms = ms ?? Date.now(); } toISOString() { return new Date(this.ms).toISOString().replace(/^\d+/, (x) => x); } },
  );
  // `new Date(ms).toISOString()` do Date de mentira sai do Date de verdade: troca pelo de verdade, com o relógio fixo.
  const quadro = (ms = 16) => { e.agora += ms; const q = e.quadros.splice(0); q.forEach((fn) => fn()); };
  const passar = (ms) => {
    const fim = e.agora + ms;
    while (e.agora < fim) {
      e.agora += 1;
      const prontos = e.timers.filter((t) => t.em <= e.agora); e.timers = e.timers.filter((t) => t.em > e.agora);
      prontos.forEach((t) => t.fn());
      if (e.agora % 16 === 0) { const q = e.quadros.splice(0); q.forEach((fn) => fn()); }
    }
  };
  const liga = (emVoo, gesto) => { e.gesto = gesto; if (emVoo) classes.add('card-em-voo'); else classes.delete('card-em-voo'); api.diagGestoAoMudar(emVoo); };
  return { api, e, pagina, classes, quadro, passar, liga };
}

// um gesto de ✓: liga em 'saindo', a página cresce, desliga em 350 ms
function gestoDeBotao(t, { cresce = true, semClasse = false } = {}) {
  t.liga(true, { origem: 'botao', direcao: 'right', fase: 'saindo' });
  t.pagina.ex = cresce ? 689 : 0; t.pagina.ey = cresce ? 36 : 0;
  t.passar(350);
  t.pagina.ex = 0; t.pagina.ey = 0;   // o card saiu: o excesso some ANTES do fim (o que NÃO sumir é o caso do teste da folga)
  t.liga(false, { origem: 'botao', direcao: 'right', fase: null });
  t.passar(400);
}

test('gravador: com o modo dev DESLIGADO não grava nada (nem laço de quadros)', () => {
  const t = montar({ ligado: false });
  t.liga(true, { origem: 'arraste', fase: 'arrastando' });
  assert.equal(t.e.quadros.length, 0, 'o laço de quadros ligou com o modo dev desligado');
  t.passar(500); t.liga(false, {}); t.passar(500);
  assert.equal(t.api.dlogGestosRef().length, 0);
});

test('gravador: o ✓ vira UM gesto — origem, direção, fase, pico e a folga de 300 ms depois do fim', () => {
  const t = montar();
  gestoDeBotao(t);
  const g = t.api.diagGestosRecentes(5, true);
  assert.equal(g.length, 1, 'o gesto não fechou, ou virou mais de um');
  assert.equal(g[0].origem, 'botao'); assert.equal(g[0].direcao, 'right');
  assert.deepEqual(g[0].fases.map((f) => f[0]), ['saindo']);
  assert.equal(g[0].picoEx, 689); assert.equal(g[0].picoEy, 36);
  assert.ok(g[0].quadros >= 10, `poucos quadros gravados: ${g[0].quadros}`);
  assert.ok(g[0].durMs >= 340 && g[0].durMs <= 360, `a duração é a do gesto, sem a folga: ${g[0].durMs}`);
  assert.equal(g[0].folgaMs, 300);
  assert.equal(g[0].jaRolava, false);
  assert.ok(g[0].quadrosComExcesso.x >= 10 && g[0].quadrosComExcesso.y >= 10);
  assert.equal(g[0].semClasseComExcesso, 0, 'com a classe ligada o excesso não é "sem a classe"');
  assert.equal(g[0].vvMudou, false); assert.deepEqual(g[0].rolou, { x: 0, y: 0 });
  assert.equal(g[0].overflowNoPico.html, 'hidden/hidden');
  assert.equal(g[0].overflowNoPico.body, 'clip/clip');
  assert.ok(g[0].overflowNoPico.classes.includes('card-em-voo'));
});

test('gravador: a folga é de 300 ms — o gesto fecha DEPOIS dela, não no fim, e o excesso da folga entra', () => {
  const t = montar();
  t.liga(true, { origem: 'botao', direcao: 'right', fase: 'saindo' });
  t.passar(350);
  t.liga(false, { origem: 'botao', direcao: 'right', fase: null });
  t.passar(250);
  assert.equal(t.api.diagGestosRecentes(5).length, 0, 'fechou antes dos 300 ms de folga');
  assert.ok(t.api.diagGestoEmCurso(), 'o gesto na folga tem de aparecer como em curso');
  // o excesso que aparece DEPOIS do fim do gesto, dentro da folga, entra no pico (é o que o WebKit faz na volta)
  t.pagina.ex = 29;
  t.passar(100);
  const g = t.api.diagGestosRecentes(5, true);
  assert.equal(g.length, 1, 'não fechou ao fim da folga');
  assert.equal(g[0].picoEx, 29, 'o excesso da folga ficou de fora');
  assert.equal(g[0].semClasseComExcesso > 0, true, 'excesso SEM a classe do corte (já desligada) tem de contar');
});

test('gravador: o estado do MEIO da tarefa (classe já desligada, card ainda fora, removido logo depois) NÃO conta — só quadro conta', () => {
  // O `concluir` da saída desliga a classe com o card ainda fora da tela e só DEPOIS o remove, tudo na mesma tarefa.
  // A 1ª versão amostrava dentro do aviso e registrou 692 px de excesso "sem a classe" com o conserto ligado:
  // um estado que nunca é pintado (achado pelo smoke, que via zero nos quadros).
  const t = montar();
  t.liga(true, { origem: 'botao', direcao: 'right', fase: 'saindo' });
  t.pagina.ex = 689; t.pagina.ey = 36;
  t.passar(350);
  t.liga(false, { origem: 'botao', direcao: 'right', fase: null });   // classe fora, excesso ainda lá…
  t.pagina.ex = 0; t.pagina.ey = 0;                                     // …e o card removido na mesma tarefa
  t.passar(400);
  const [g] = t.api.diagGestosRecentes(1, true);
  assert.equal(g.semClasseComExcesso, 0, 'o aviso amostrou no meio da tarefa e contou um estado que ninguém vê');
});

test('gravador: o aviso do swipe NÃO amostra (só o laço de quadros amostra) — estrutura', () => {
  const app = semComentarioJs(APP);
  const f = app.slice(app.indexOf('function diagGestoAoMudar('), app.indexOf('\n}', app.indexOf('function diagGestoAoMudar(')) + 2);
  assert.doesNotMatch(f, /diagGestoAmostrar\(/, 'o aviso voltou a amostrar dentro da tarefa de JS');
  assert.match(app, /function diagGestoLaco\(g\) \{[\s\S]*?requestAnimationFrame\(passo\);/, 'o laço de quadros sumiu');
});

test('gravador: voltar a pegar o card DENTRO da folga continua o MESMO gesto', () => {
  const t = montar();
  t.liga(true, { origem: 'arraste', fase: 'voltando' });
  t.passar(200);
  t.liga(false, { origem: 'arraste', fase: null });
  t.passar(100);
  t.liga(true, { origem: 'arraste', fase: 'arrastando' });
  t.passar(200);
  t.liga(false, { origem: 'arraste', fase: null });
  t.passar(400);
  const g = t.api.diagGestosRecentes(5, true);
  assert.equal(g.length, 1, 'pegar o card na folga abriu outro gesto');
  assert.deepEqual(g[0].fases.map((f) => f[0]), ['voltando', 'arrastando']);
});

test('gravador: um arraste que sai tem as FASES em ordem (arrastando → saindo) e a origem do arraste', () => {
  const t = montar();
  t.liga(true, { origem: 'arraste', fase: 'arrastando' });
  t.passar(150);
  t.liga(true, { origem: 'arraste', direcao: 'right', fase: 'saindo' });
  t.pagina.ex = 689; t.passar(350);
  t.liga(false, { origem: 'arraste', direcao: 'right', fase: null });
  t.passar(400);
  const [g] = t.api.diagGestosRecentes(1, true);
  assert.equal(g.origem, 'arraste'); assert.equal(g.direcao, 'right');
  assert.deepEqual(g.fases.map((f) => f[0]), ['arrastando', 'saindo']);
  assert.ok(g.fases[1][1] >= 140, 'a fase "saindo" tem de levar o instante em que começou');
});

test('gravador: a página que JÁ rolava (`card-pagina-rola`) é lembrada; rolagem e visualViewport que mexem são vistos', () => {
  const t = montar();
  t.classes.add('card-pagina-rola');
  t.liga(true, { origem: 'arraste', fase: 'arrastando' });
  t.pagina.sy = 19; t.pagina.vv = { scale: 1.2, offsetLeft: 0, offsetTop: 0, pageLeft: 0 };
  t.passar(100);
  t.liga(false, {}); t.passar(400);
  const [g] = t.api.diagGestosRecentes(1, true);
  assert.equal(g.jaRolava, true);
  assert.equal(g.rolou.y, 19); assert.equal(g.vvMudou, true);
});

test('gravador: a série tem no máximo 40 pontos, com o primeiro, o último e o PICO dentro', () => {
  const t = montar();
  t.liga(true, { origem: 'arraste', fase: 'arrastando' });
  for (let i = 0; i < 200; i++) { t.pagina.ex = i === 120 ? 900 : 10; t.passar(16); }
  t.liga(false, {}); t.passar(400);
  const [g] = t.api.diagGestosRecentes(1, true);
  assert.ok(g.serie.length <= 40 && g.serie.length >= 30, `série fora da faixa: ${g.serie.length}`);
  assert.ok(g.serie.some((p) => p[1] === 900), 'a série perdeu o PICO — esconderia o que se procura');
  assert.equal(g.serie[0][0] <= g.serie.at(-1)[0], true);
  const reduzida = t.api.diagReduzirSerie(Array.from({ length: 10 }, (_, i) => [i, i, 0]));
  assert.equal(reduzida.length, 10, 'série curta não se mexe');
});

test('gravador: o teto de quadros por gesto (arraste segurado) marca `truncado`, e o anel guarda no máximo 20 gestos', () => {
  const t = montar();
  t.liga(true, { origem: 'arraste', fase: 'arrastando' });
  t.passar(16 * 300);
  t.liga(false, {}); t.passar(400);
  const [g] = t.api.diagGestosRecentes(1, true);
  assert.equal(g.truncado, true); assert.ok(g.quadros <= 240);
  t.api.zerar();
  for (let i = 0; i < 27; i++) { gestoDeBotao(t, { cresce: i % 2 === 0 }); }
  assert.equal(t.api.dlogGestosRef().length, 20, 'o anel não respeita o teto de 20');
});

test('gravador: as capturas levam os gestos SEM a série (8) e o relatório leva os 20 COM ela', () => {
  const t = montar();
  for (let i = 0; i < 12; i++) gestoDeBotao(t);
  const nas = t.api.diagGestosRecentes(8);
  assert.equal(nas.length, 8);
  assert.ok(nas.every((g) => !('serie' in g)), 'a captura não pode levar a série (pesa)');
  assert.ok(t.api.diagGestosRecentes(20, true).every((g) => Array.isArray(g.serie)));
});

// ── a régua do "cresceu" — a MESMA do app, da sentinela e do triador ──
const CASOS_CRESCEU = [
  [{ picoEx: 689, picoEy: 36, jaRolava: false }, true, 'a saída pra direita'],
  [{ picoEx: 0, picoEy: 36, jaRolava: false }, true, 'só o vertical, página que não rolava'],
  [{ picoEx: 0, picoEy: 36, jaRolava: true }, false, 'o vertical da página que JÁ rolava é legítimo'],
  [{ picoEx: 300, picoEy: 36, jaRolava: true }, true, 'o horizontal nunca é legítimo'],
  [{ picoEx: 1, picoEy: 1, jaRolava: false }, false, '1 px é arredondamento'],
  [{ picoEx: 0, picoEy: 0, jaRolava: false }, false, 'o conserto funcionando'],
];
test('gravador: a régua do "cresceu" (app) — horizontal nunca, vertical só se a página não rolava', () => {
  const t = montar();
  for (const [g, esperado, motivo] of CASOS_CRESCEU) assert.equal(t.api.diagGestoCresceu(g), esperado, motivo);
  assert.equal(t.api.diagGestoCresceu(null), false);
});

test('gravador: o alerta do gesto diz quantos, o pior e de que gesto', () => {
  const t = montar();
  assert.deepEqual(t.api.diagAlertasDeGestos([{ picoEx: 0, picoEy: 0, jaRolava: false }]), []);
  assert.deepEqual(t.api.diagAlertasDeGestos([]), []);
  const [a] = t.api.diagAlertasDeGestos([
    { picoEx: 0, picoEy: 0, jaRolava: false, origem: 'arraste' },
    { picoEx: 82, picoEy: 167, jaRolava: false, origem: 'arraste', direcao: 'right' },
    { picoEx: 689, picoEy: 36, jaRolava: false, origem: 'botao', direcao: 'right' }]);
  assert.equal(a.chave, 'gestoCresceuTamanhoRolavel');
  assert.equal(a.gestos, 2); assert.equal(a.picoEx, 689);
  assert.match(a.msg, /2 de 3 gesto\(s\)/); assert.match(a.msg, /botao right/);
});

// ── o triador (tools/diag-resumo.mjs) com a MESMA régua, sobre um relatório de mentira ──
function triar(relatorio) {
  const dir = mkdtempSync(join(tmpdir(), 'gestos-'));
  const arq = join(dir, 'diag.json');
  writeFileSync(arq, JSON.stringify(relatorio));
  return execFileSync(process.execPath, [new URL('../tools/diag-resumo.mjs', import.meta.url).pathname, arq], { encoding: 'utf8' });
}
const gestoDe = (t, o) => ({ t, origem: 'botao', direcao: 'right', fases: [['saindo', 0]], durMs: 350, quadros: 26, jaRolava: false,
  picoEx: 0, picoEy: 0, picoEm: 0, quadrosComExcesso: { x: 0, y: 0 }, semClasseComExcesso: 0, rolou: { x: 0, y: 0 }, vvMudou: false,
  overflowNoPico: null, ...o });
test('triador: a seção GESTOS marca com !! o gesto que fez a página crescer, e só ele — mesma régua do app', () => {
  const lista = CASOS_CRESCEU.map(([g], i) => gestoDe(`2026-11-15T12:00:0${i}.000Z`, g));
  const saida = triar({ _formato: 'x', resumo: { alertas: [] }, gestos: { max: 20, folgaMs: 300, lista },
    computado: { barras: { sobreposicao: true, padraoDaPlataforma: { larguraPx: 0, alturaPx: 0 }, comOEstiloDoApp: { larguraPx: 0, alturaPx: 0 },
                           html: { overflowX: 'hidden', overflowY: 'hidden' }, body: { overflowX: 'clip', overflowY: 'clip' },
                           larguraTomadaDaJanela: 0, alturaTomadaDaJanela: 0 } } });
  const sec = saida.slice(saida.indexOf('GESTOS (o que a página fez'));
  const marcados = sec.split('\n').filter((l) => l.startsWith('!! '));
  const esperados = CASOS_CRESCEU.filter(([, e]) => e).length;
  assert.equal(marcados.length, esperados, `marcou ${marcados.length} gesto(s), a régua do app marca ${esperados}\n${sec}`);
  assert.match(sec, /ATENÇÃO: 3 gesto\(s\) fizeram o tamanho rolável da página CRESCER/);
  assert.match(sec, /barras de rolagem: de SOBREPOSIÇÃO/);
});

test('triador: gesto que só veio de uma CAPTURA (outra abertura) entra na lista, sem repetir o do relatório', () => {
  const g1 = gestoDe('2026-11-15T12:00:00.000Z', { picoEx: 82, picoEy: 167 });
  const g2 = gestoDe('2026-11-15T12:00:05.000Z', {});
  const saida = triar({ _formato: 'x', resumo: { alertas: [] }, gestos: { max: 20, folgaMs: 300, lista: [g1] },
    momentos: [{ t: 'x', motivo: 'manual', gestos: [g1, g2] }], aberturasAnteriores: [] });
  assert.match(saida, /2 gesto\(s\) gravado\(s\).*1 vieram só das capturas/);
  assert.match(saida, /\(da captura\)/);
});

test('triador: relatório de ANTES do gravador diz "ausente nesta versão", nunca `undefined`', () => {
  const saida = triar({ _formato: 'x', resumo: { alertas: [] } });
  const sec = saida.slice(saida.indexOf('GESTOS (o que a página fez'));
  assert.match(sec, /barras de rolagem: \(ausente nesta versão\)/);
  assert.match(sec, /gestos: \(ausente nesta versão\)/);
  assert.doesNotMatch(sec.split('\n── ')[0], /undefined/);
});

// ── a sonda de barras, executada ──
test('sonda de barras: classe ou sobreposição pela diferença caixa − área útil, e o estilo do app medido à parte', () => {
  const INI = '// A SONDA DE BARRAS DE ROLAGEM';
  const FIMS = 'function diagComputado() {';
  const trecho = APP.slice(APP.indexOf(INI), APP.indexOf(FIMS));
  assert.ok(trecho.includes('function diagBarras()'), 'a sonda sumiu do app.js');
  const montarSonda = (espessuraPadrao, espessuraApp) => {
    const doc = { documentElement: { clientWidth: 411, clientHeight: 841 }, body: { appendChild(el) { this.ultimo = el; } },
      createElement: () => {
        const el = { style: {}, setAttribute() {}, appendChild() {}, remove() {},
          get offsetWidth() { return 100; }, get clientWidth() { return 100 - (String(this.style.cssText).includes('scrollbar-width:auto') ? espessuraPadrao : espessuraApp); },
          get offsetHeight() { return 100; }, get clientHeight() { return 100 - (String(this.style.cssText).includes('scrollbar-width:auto') ? espessuraPadrao : espessuraApp); } };
        return el;
      } };
    const cs = { overflowX: 'hidden', overflowY: 'hidden', scrollbarWidth: 'thin', scrollbarColor: 'rgb(71, 85, 105) rgb(30, 41, 59)' };
    const f = new Function('document', 'window', 'getComputedStyle', trecho + '\nreturn diagBarras();');
    return f(doc, { innerWidth: 411, innerHeight: 841 }, () => cs);
  };
  const sobre = montarSonda(0, 0);
  assert.equal(sobre.sobreposicao, true); assert.deepEqual(sobre.padraoDaPlataforma, { larguraPx: 0, alturaPx: 0 });
  const classica = montarSonda(15, 8);
  assert.equal(classica.sobreposicao, false);
  assert.equal(classica.padraoDaPlataforma.larguraPx, 15); assert.equal(classica.comOEstiloDoApp.larguraPx, 8);
  assert.equal(classica.html.scrollbarWidth, 'thin'); assert.equal(classica.larguraTomadaDaJanela, 0);
});

// ── os PONTOS onde o app liga tudo isto (estrutura, não distância — gotcha #67) ──
test('pontos de chamada: o swipe.js AVISA o gravador no ponto único do estado do gesto, e dá a origem e a direção', () => {
  const sw = semComentarioJs(SWIPE);
  const corpo = sw.slice(sw.indexOf('function sincronizarCorteDaPagina()'), sw.indexOf('\n}', sw.indexOf('function sincronizarCorteDaPagina()')) + 2);
  assert.match(corpo, /raiz\.classList\.toggle\('card-em-voo', emVoo\);[\s\S]*window\.diagGestoAoMudar\(emVoo\)[\s\S]*if \(!emVoo\) \{ gestoOrigem = null; gestoDirecao = null; \}/,
    'o aviso ao gravador sumiu, ou saiu da ordem (a origem só zera DEPOIS do aviso)');
  assert.match(corpo, /try \{ if \(window\.diagGestoAoMudar\)/, 'o aviso tem de estar num try (o gravador nunca derruba o gesto)');
  assert.match(sw, /gestoOrigem = 'arraste';\s*sincronizarCorteDaPagina\(\);/, 'o arraste não diz que é arraste');
  assert.match(sw, /gestoDirecao = direction;\s*if \(!gestoOrigem\) gestoOrigem = 'botao';\s*sincronizarCorteDaPagina\(\);/, 'a saída não diz a direção, ou não marca o botão');
  assert.match(sw, /window\.gestoAtual = \(\) =>/);
});

test('pontos de chamada: capturas, relatório, alertas e o "Sair" levam o gravador', () => {
  const app = semComentarioJs(APP);
  assert.match(app, /gestos: diagGestosRecentes\(8\),\s*gestoEmCurso: diagGestoEmCurso\(\),/, 'a captura não leva os gestos');
  assert.match(app, /gestos: \{ max: DIAG_GESTOS_MAX, folgaMs: DIAG_GESTO_FOLGA_MS, lista: diagGestosRecentes\(DIAG_GESTOS_MAX, true\) \},/, 'o relatório não leva os 20 com a série');
  assert.match(app, /const alertas = diagSentinelas\(computado\)\.concat\(diagAlertasDeGestos\(dlogGestos\)\);/, 'o alerta do gesto não entra no relatório');
  assert.match(app, /gestos: diagResumoDosGestos\(\),/, 'o resumo não traz os números dos gestos');
  assert.match(app, /fora\.barras = \(\(\) => \{ try \{ return diagBarras\(\);/, 'a sonda de barras não está no computado (ou perdeu o try)');
  const apagar = app.slice(app.indexOf('function dlogApagar('), app.indexOf('function dlogApagar(') + 400);
  assert.match(apagar, /dlogGestos = \[\];\s*diagGestoAtual = null;/, 'o "Sair" não apaga os gestos gravados');
});

test('pontos de chamada: o gravador só grava com o modo dev ligado e nunca lança', () => {
  const app = semComentarioJs(APP);
  const f = app.slice(app.indexOf('function diagGestoAoMudar('), app.indexOf('\n}', app.indexOf('function diagGestoAoMudar(')) + 2);
  assert.match(f, /if \(!dlogLigado\(\)\) \{ diagGestoAtual = null; return; \}/, 'o gravador gravaria com o modo dev desligado');
  const fechar = app.slice(app.indexOf('function diagGestoFechar('), app.indexOf('\n}', app.indexOf('function diagGestoFechar(')) + 2);
  assert.match(fechar, /if \(!dlogLigado\(\)\) return;/, 'o gesto fechado entraria no anel com o modo dev desligado');
});
