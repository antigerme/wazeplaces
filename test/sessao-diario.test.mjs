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
  // Pelo NÚMERO, não pelo literal: a versão sobe de novo a cada seção nova, e
  // o que este teste guarda é ela ter subido com as de SESSÃO (a 2).
  const v = Number((APP.match(/const DIAG_VERSAO = (\d+);/) || [])[1]);
  assert.ok(v >= 2, `a versão do diagnóstico não subiu com as seções novas (${v})`);
});

// ── A sessão que JÁ ESTAVA ativa quando o registro nasceu ──────────────────
//
// `API.getSession()` lê o token do armazenamento SEM passar pelo `setSession`,
// que é onde o gancho mora. Então quem já estava logado quando esta versão
// chegou — todo aparelho no dia do deploy, e os testadores que vão relatar —
// abre a app sem carimbar início nenhum: o `caiu` chega sozinho e a duração,
// que é o produto inteiro da seção, sai vazia no PRIMEIRO relato, que é
// justamente o que interessa.

test('a abertura com sessão já ativa carimba um marco próprio', () => {
  const corpo = fatiar('marcarSessaoJaAtiva');
  assert.match(corpo, /registrarEventoDeSessao\('jaAtiva'\)/,
    'o marco deixou de ser registrado — o primeiro relato volta a vir sem duração');
  assert.match(corpo, /if \(!safeLS\.get\('waze_session_token'\)\) return;/,
    'carimba sem haver sessão — inventaria ciclo em quem está deslogado');
  // Sem a varredura, seria uma linha por ABERTURA da app: o diário viraria
  // ruído e quebraria a própria regra de entrada (raro, nunca por gesto).
  assert.match(corpo, /e === 'token\+' \|\| e === 'jaAtiva'\) return;/,
    'o marco deixou de checar se já há início em aberto — duplica a cada abertura');
  const carga = APP.slice(APP.indexOf('const savedToken = API.getSession();'));
  assert.match(carga.slice(0, 400), /marcarSessaoJaAtiva\(\);/,
    'a carga com token salvo parou de carimbar o marco');
});

test('"já estava ativa" NÃO se confunde com "entrou agora"', () => {
  // A distinção é o que separa uma MEDIDA de um PISO. Chamar os dois de
  // entrada seria inventar um número — pior que não ter número nenhum.
  const corpo = fatiar('diagSessao');
  assert.match(corpo, /inicioConhecido: abriu\.e !== 'jaAtiva'/,
    'o ciclo deixou de dizer se o início foi medido ou é só um piso');
  assert.match(corpo, /c\.fim === 'caiu' \|\| c\.fim === 'token-'\) && c\.inicioConhecido/,
    'o piso voltou pra estatística — a mediana passa a afirmar MENOS tempo do que houve, '
    + 'que é o erro na direção de confirmar o relato');
});

test('a conta do piso e da medida, com o diário montado à mão', () => {
  const H = 3600000, agora = Date.now();
  const r = carregarDiagSessao([
    { t: agora - 50 * H, e: 'jaAtiva' },                        // início desconhecido
    { t: agora - 10 * H, e: 'caiu', motivo: 'x' },              // → 40h, PISO
    { t: agora - 9 * H,  e: 'token+', via: 'cookies' },         // início medido
    { t: agora - 1 * H,  e: 'caiu', motivo: 'x' },              // → 8h, medido
  ], agora - 60 * H);
  assert.equal(r.ciclos.length, 2);
  assert.equal(r.ciclos[0].durouH, 40);
  assert.equal(r.ciclos[0].inicioConhecido, false, 'o ciclo aberto por "jaAtiva" não é medida');
  assert.equal(r.ciclos[1].inicioConhecido, true);
  assert.equal(r.duracaoH.n, 1, 'o piso entrou na estatística');
  assert.equal(r.duracaoH.mediana, 8, 'a mediana saiu do ciclo medido, não do piso');
  assert.equal(r.pisos, 1);
});

// ── QUEM O DIAGNÓSTICO LÊ, ALGUÉM ESCREVE ──────────────────────────────────
//
// O carimbo de nascimento NASCEU sem chamador: a #219 trouxe a constante, a
// função, a leitura no `diagSessao` e a remoção no logout — e nenhuma chamada.
// Resultado, medido nos BYTES DE PRODUÇÃO com o diário ao lado gravando
// normalmente (3 entradas, 2 ciclos): `nascimento` e `idadeDoArmazenamentoH`
// saíram `null` em todo diagnóstico desde 2026-09-18.
//
// Nada enxergava, e o motivo é estrutural: o `chamadas-orfas.test.mjs` cobra o
// sentido INVERSO — toda chamada tem declaração. Faltava este.
const semComentarioJS = (s) => s.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const APP_SEM = semComentarioJS(APP);

test('toda função que ESCREVE uma chave de armazenamento é chamada', () => {
  // Escritora órfã é invisível: a leitura devolve `null`, que é indistinguível
  // de "ainda não aconteceu". Foi exatamente esse o disfarce aqui.
  const escritoras = [];
  const re = /^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm;
  const marcas = [...APP_SEM.matchAll(re)].map((m) => ({ nome: m[1], i: m.index }));
  marcas.forEach((m, k) => {
    const corpo = APP_SEM.slice(m.i, k + 1 < marcas.length ? marcas[k + 1].i : APP_SEM.length);
    if (/(safeLS\.set|localStorage\.setItem)\(\s*[A-Z][A-Z0-9_]*_KEY/.test(corpo)) escritoras.push(m.nome);
  });
  assert.ok(escritoras.length >= 5,
    `CONTROLE: achei só ${escritoras.length} escritoras de chave — o varredor não está enxergando`);
  for (const nome of escritoras) {
    // REFERÊNCIA, não chamada: `addEventListener('click', toggleTheme)` passa a
    // função sem parênteses e está viva do mesmo jeito. Exigir `nome(` acusava
    // ela — e guard que acusa código certo é guard que ninguém lê.
    const refs = (APP_SEM.match(new RegExp('\\b' + nome + '\\b', 'g')) || []).length;
    assert.ok(refs >= 2,
      `${nome}() escreve uma chave de armazenamento e NINGUÉM a chama — a leitura correspondente `
      + 'vai devolver null pra sempre, e null é indistinguível de "ainda não aconteceu"');
  }
});

test('o carimbo é feito na carga, ANTES de qualquer saída antecipada', () => {
  // A posição é load-bearing: o `initApp` tem um `return` no ramo do código de
  // pareamento na URL, e o `marcarSessaoJaAtiva()` — o irmão dele — só roda
  // dentro do `if (savedToken)`. Carimbar em qualquer um desses dois lugares
  // deixaria de fora cargas legítimas, e a idade sairia MENOR que a real:
  // erro na direção que INVENTA um apagamento que não houve.
  const init = semComentarioJS(fatiar('initApp'));
  const iCarimbo = init.indexOf('nascimentoDoArmazenamento()');
  assert.ok(iCarimbo > 0, 'o carimbo saiu do initApp');
  const iReturn = init.search(/\n\s+return;/);
  assert.ok(iReturn > 0, 'CONTROLE: não achei a saída antecipada do initApp — o teste perdeu a âncora');
  assert.ok(iCarimbo < iReturn,
    'o carimbo ficou DEPOIS de um `return` do initApp: abrir pelo código de pareamento deixa de carimbar');
  const jaAtiva = semComentarioJS(fatiar('marcarSessaoJaAtiva'));
  assert.ok(!/nascimentoDoArmazenamento/.test(jaAtiva),
    'o carimbo foi parar dentro do marcarSessaoJaAtiva, que tem `return` antecipado e só roda com sessão');
});
