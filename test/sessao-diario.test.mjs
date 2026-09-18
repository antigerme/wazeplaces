// O diário de sessões — o que sobrevive ao tombo.
//
// Por que este arquivo existe: dois testadores relataram precisar "puxar os
// cookies de novo" a cada 2 a 7 dias, e ninguém — nem eles — sabe o intervalo
// de verdade. Memória de duração é justamente o que não se tem. O diário troca
// o relato por dois carimbos de data, e estes testes travam as três coisas que
// o fazem servir: o registro não pode escapar por um caminho novo, a conta dos
// ciclos tem que estar certa, e as sentinelas precisam ficar CALADAS quando
// não há o que dizer — sentinela que dispara sempre é a que se aprende a
// ignorar, que é como esta seção morre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const API = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');

function fatiar(nome, fonte = APP) {
  const ini = fonte.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu`);
  const resto = fonte.slice(ini + 1);
  const fim = resto.search(/\n(?:async function |function |const |let |\/\/ ──|\/\/ ═)/);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  return fonte.slice(ini, ini + 1 + fim);
}

// ── A conta dos ciclos ─────────────────────────────────────────────────────
// `diagSessao` é o que responde "durou quanto". Carrego a função de verdade
// com um localStorage de mentira, porque a conta é o produto.
function carregarDiagSessao(anel, nascimento) {
  const src = `
    const NASCIMENTO_KEY = 'n', SESSOES_KEY = 's';
    const loja = { n: ${nascimento === null ? 'null' : `'${nascimento}'`}, s: '${JSON.stringify(anel).replace(/'/g, "\\'")}' };
    const safeLS = { get: (k) => loja[k] ?? null };
    function lerDiarioDeSessoes() { try { return JSON.parse(safeLS.get(SESSOES_KEY) || '[]'); } catch (e) { return []; } }
    ${fatiar('diagSessao')}
    return diagSessao();`;
  return new Function(src)();
}

const H = 3600000;
const AGORA = Date.now();

test('mede a duração de cada ciclo, em horas', () => {
  const r = carregarDiagSessao([
    { t: AGORA - 60 * H, e: 'token+', via: 'extensao' },
    { t: AGORA - 20 * H, e: 'caiu', motivo: 'srv.err.cookiesExpired' },
    { t: AGORA - 20 * H, e: 'token-' },
  ], AGORA - 100 * H);
  assert.equal(r.ciclos.length, 1);
  assert.equal(r.ciclos[0].durouH, 40, 'a duração do ciclo saiu errada');
  assert.equal(r.ciclos[0].motivo, 'srv.err.cookiesExpired');
  assert.equal(r.idadeDoArmazenamentoH, 100);
});

test('CONTRAPROVA: um ciclo de semanas NÃO pode ser lido como de horas', () => {
  // Se a conta perder a escala (ms × s, por exemplo), o relato "dura 2 dias"
  // vira indistinguível de "dura 3 semanas" — que é a única coisa que este
  // arquivo precisa distinguir.
  const r = carregarDiagSessao([
    { t: AGORA - 21 * 24 * H, e: 'token+' },
    { t: AGORA - 10 * H, e: 'caiu', motivo: 'srv.err.sessionExpired' },
  ], AGORA - 30 * 24 * H);
  assert.ok(r.ciclos[0].durouH > 480, `21 dias deveriam passar de 480 h, vieram ${r.ciclos[0].durouH}`);
});

test('a sessão ainda aberta aparece como "em curso", não some', () => {
  const r = carregarDiagSessao([{ t: AGORA - 5 * H, e: 'token+', via: 'cookies' }], AGORA - 5 * H);
  assert.equal(r.ciclos.length, 1);
  assert.equal(r.ciclos[0].fim, 'em curso');
  assert.equal(r.ciclos[0].ate, null);
});

test('o resumo de duração ignora o ciclo em curso e o "saiu" deliberado', () => {
  const r = carregarDiagSessao([
    { t: AGORA - 50 * H, e: 'token+' }, { t: AGORA - 40 * H, e: 'caiu', motivo: 'x' },
    { t: AGORA - 30 * H, e: 'token+' }, { t: AGORA - 29 * H, e: 'saiu' },
    { t: AGORA - 2 * H, e: 'token+' },
  ], AGORA - 60 * H);
  assert.equal(r.duracaoH.n, 1, 'o "saiu" (o editor pediu) ou o ciclo em curso entraram na conta');
  assert.equal(r.duracaoH.menor, 10);
});

test('armazenamento vazio não quebra nem inventa', () => {
  const r = carregarDiagSessao([], null);
  assert.deepEqual(r.ciclos, []);
  assert.equal(r.nascimento, null);
  assert.equal(r.erro, null);
});

// ── O registro não pode escapar ────────────────────────────────────────────

test('o gancho mora no setSession, que é o ponto único do token', () => {
  // Perseguir os call sites um a um é como se perde o próximo caminho de
  // entrada que alguém adicionar (gotcha #39: persiga o CONCEITO, não o lugar).
  const m = API.match(/setSession\(token, via\) \{[\s\S]*?\n    \},/);
  assert.ok(m, 'o setSession mudou de forma');
  assert.match(m[0], /window\.__sessaoEvento\(token \? 'token\+' : 'token-'/,
    'o gancho saiu do ponto único — um caminho de entrada novo deixaria de ser registrado');
  assert.match(m[0], /tinha !== !!token/,
    'sem comparar o estado anterior, regravar o mesmo token viraria um ciclo falso');
  assert.match(m[0], /catch/, 'o instrumento pode derrubar o login');
  assert.ok(!/__sessaoEvento\([^)]*token\b[^)]*\)/.test(m[0].replace(/token \? 'token\+' : 'token-'/, '')),
    'o VALOR do token não pode ir para o diário');
});

test('os três caminhos de entrada dizem de onde vieram', () => {
  assert.match(API, /setSession\(result\.sessionToken, 'cookies'\)/, 'o login por cookies perdeu o `via`');
  assert.match(API, /setSession\(result\.sessionToken, 'pareamento'\)/, 'o pareamento perdeu o `via`');
  assert.match(APP, /API\.setSession\(String\(d\.token\), 'extensao'\)/, 'a extensão perdeu o `via`');
});

test('a QUEDA chega ao anel sem portão e ao diário', () => {
  // Era o único evento caro que não chegava ao `dfato`: havia `dlog`, que o
  // dev mode desligado engole, e o testador só liga o dev mode DEPOIS.
  const corpo = fatiar('derrubarSessao');
  assert.match(corpo, /dfato\('sessao\.caiu'/, 'a queda voltou a não chegar ao anel sem portão');
  assert.match(corpo, /registrarEventoDeSessao\('caiu'/, 'a queda parou de entrar no diário persistente');
  // O prazo tem que ser lido ANTES do esquecerPrazoDaSessao(), senão o registro
  // nasce nulo justamente no caso que se investiga.
  //
  // Ancorado na CHAMADA (início de linha), nunca na menção: o comentário logo
  // acima cita `esquecerPrazoDaSessao()` para explicar por que o prazo é lido
  // antes — e um `indexOf` do nome solto casa com o comentário e reprova código
  // certo. Gotcha #14, acontecido na primeira escrita deste teste.
  const posLe = corpo.search(/^ {4}const prazoQueMorreu = /m);
  const posEsquece = corpo.search(/^ {4}esquecerPrazoDaSessao\(\);/m);
  assert.ok(posLe !== -1 && posEsquece !== -1, 'sumiu a leitura do prazo ou o esquecimento');
  assert.ok(posLe < posEsquece, 'o prazo passou a ser lido depois de apagado — o registro vira null');
});

test('o diário não grava por swipe — só nos três momentos raros', () => {
  // A regra de entrada do `dfato`, e aqui ela é mais dura porque escrever no
  // localStorage é SÍNCRONO: grava a cada swipe e o custo aparece em quadros.
  const chamadas = [...APP.matchAll(/registrarEventoDeSessao\('([a-z+-]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(chamadas)].sort(), ['caiu', 'prazo', 'saiu'],
    'entrou evento novo no diário: confira que ele é RARO antes de liberar');
  // E o prazo só quando MUDA, senão vira uma linha por resposta do servidor.
  const g = fatiar('guardarPrazoDaSessao');
  assert.match(g, /if \(mudou\) registrarEventoDeSessao\('prazo'/,
    'o prazo voltou a ser registrado em toda resposta');
});

// ── As sentinelas ──────────────────────────────────────────────────────────

test('a sentinela do apagamento tem escopo, e o escopo é o que a torna útil', () => {
  const i = APP.indexOf("diga('apagamentoPorInatividade'");
  assert.notEqual(i, -1, 'sumiu a sentinela do apagamento por inatividade');
  const antes = APP.slice(Math.max(0, i - 400), i);
  // Sem `!dur.instalada` ela acusaria todo iPhone, inclusive o que o WebKit
  // ISENTA por estar na tela inicial — e aí vira aviso de plataforma, não sinal.
  assert.match(antes, /dur\.engine === 'WebKit' && !dur\.instalada/,
    'a sentinela perdeu o escopo e passou a acusar quem está isento');
  assert.match(antes, /AppState\.authenticated/,
    'ela dispara sem sessão ativa — na tela de login não há o que avisar');
});

test('a sentinela de queda exige PADRÃO, não um caso isolado', () => {
  const i = APP.indexOf("diga('sessaoCaiCedo'");
  assert.notEqual(i, -1, 'sumiu a sentinela de sessão caindo cedo');
  const antes = APP.slice(Math.max(0, i - 400), i);
  assert.match(antes, /curtos\.length >= 2/,
    'um ciclo curto sozinho é troca de aparelho ou logout no WME — exigir dois é o que faz padrão');
  assert.match(antes, /c\.fim === 'caiu'/,
    'passou a contar o "saiu" deliberado como queda');
});

test('o arquivo diz de que versão do diagnóstico ele é', () => {
  // Relato antigo é justamente o que se usa pra comparar antes/depois, e sem
  // isto não dá pra saber se a ausência de uma seção é defeito ou idade.
  assert.match(APP, /const DIAG_VERSAO = 2;/, 'a versão do diagnóstico não subiu com as seções novas');
});
