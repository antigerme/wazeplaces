// Resumo do mês — a imagem que a pessoa manda no grupo.
//
// O que se trava aqui, e por quê:
//
//   1. `dadosDoResumo` LÊ o histórico por dia que o app já grava — nada novo no
//      armazenamento, nenhuma escrita, nenhuma rede — e responde só pelo
//      MÊS-CALENDÁRIO pedido: outro mês, o `_total` e balde inválido ficam de
//      fora. "Dia mais forte", "dias ativos" e a série de barras saem da mesma
//      leitura. (Foi a pergunta do owner: "como você sabe o dia mais forte?")
//   2. PESO DE FONTE: a Inter auto-hospedada vai só até o que o @font-face
//      declara (300–700). Pedir 800/900 não dá erro — o browser sintetiza ou
//      cai no fallback, em silêncio. O teto vem do CSS, não de um número aqui.
//   3. O modal segue as convenções da casa: MODAL_IDS, limpeza em
//      LIMPEZA_AO_FECHAR (o object URL é solto por QUALQUER caminho de
//      fechamento), botão só quando há mês, dismissiva à esquerda.
//   4. O desenho não escolhe palavra: `desenharResumo` não chama t(). Quem
//      traduz é quem monta os textos, e a imagem sai no idioma da pessoa.
//
// O app.js é script de browser, não módulo: o teste FATIA a fonte e executa a
// função pura num escopo de mentira — o padrão de test/guardar-pedido.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.src.html', import.meta.url), 'utf8');

// Âncora em DECLARAÇÃO, nunca em distância (gotcha #67).
function fatiarFuncao(nome) {
  const ini = APP.indexOf('function ' + nome + '(');
  assert.ok(ini >= 0, `a função ${nome} sumiu do app.js`);
  const resto = APP.slice(ini + 1);
  const fim = resto.search(/\n(?:async function |function |const |let |\/\/ ──|\/\/ ═)/);
  assert.ok(fim > 0, `não consegui delimitar ${nome}`);
  return APP.slice(ini, ini + 1 + fim);
}

// A seção inteira, entre os dois banners. É o que os guards de "só leitura",
// "sem rede" e "peso de fonte" varrem.
function secaoDoResumo() {
  const ini = APP.indexOf('//  Resumo do mês');
  const fim = APP.indexOf('//  Recusa automática');
  assert.ok(ini > 0 && fim > ini, 'os banners que delimitam a seção do Resumo sumiram');
  return APP.slice(ini, fim);
}

const dadosDoResumo = new Function(fatiarFuncao('dadosDoResumo') + '\nreturn dadosDoResumo;')();

// ── 1. A LEITURA DO MÊS ────────────────────────────────────────────────────
test('dadosDoResumo soma SÓ o mês-calendário pedido, ignorando _total e vizinhos', () => {
  const h = {
    _total: { read: 999, rejected: 999 },       // o acumulador NÃO é dia
    '2026-08-31': { read: 100, rejected: 100 }, // véspera: outro mês
    '2026-09-01': { read: 3, rejected: 2 },
    '2026-09-15': { read: 10, rejected: 0 },
    '2026-09-20': { read: 0, rejected: 0 },     // balde vazio: não é dia ativo
    '2026-10-01': { read: 7, rejected: 7 },     // mês seguinte
    '2025-09-15': { read: 50, rejected: 50 },   // mesmo mês, OUTRO ano
  };
  const d = dadosDoResumo(h, 2026, 8);
  assert.equal(d.lidos, 13);
  assert.equal(d.rejeitados, 2);
  assert.equal(d.total, 15);
  assert.equal(d.diasAtivos, 2, 'balde com zero não conta como dia ativo');
  assert.deepEqual(d.forte, { dia: 15, n: 10 });
  assert.equal(d.diasNoMes, 30);
  assert.equal(d.serie.length, 30, 'uma barra por dia do mês');
  assert.equal(d.serie[0], 5);
  assert.equal(d.serie[14], 10);
  assert.equal(d.serie.reduce((a, b) => a + b, 0), d.total, 'a série é o mesmo total, dia a dia');
  // O dia mais forte é o pico da própria série — sem segunda contagem.
  assert.equal(d.forte.n, Math.max(...d.serie));
  assert.equal(d.serie[d.forte.dia - 1], d.forte.n);
});

test('dadosDoResumo: mês vazio devolve zero, sem dia forte, e a série do tamanho do mês', () => {
  for (const [ano, mes, dias] of [[2027, 1, 28], [2028, 1, 29], [2026, 11, 31], [2026, 3, 30]]) {
    const d = dadosDoResumo({ _total: { read: 5, rejected: 5 }, '2026-06-01': { read: 1, rejected: 1 } }, ano, mes);
    assert.equal(d.total, 0, `${ano}-${mes + 1} deveria estar vazio`);
    assert.equal(d.diasAtivos, 0);
    assert.deepEqual(d.forte, { dia: 0, n: 0 }, 'sem pedido não há dia mais forte');
    assert.equal(d.serie.length, dias, `${ano}-${mes + 1} tem ${dias} dias`);
    assert.ok(d.serie.every((v) => v === 0));
  }
  // Histórico ausente não derruba nada — o botão nem aparece, mas a função se defende.
  for (const vazio of [null, undefined, {}]) {
    const d = dadosDoResumo(vazio, 2026, 8);
    assert.equal(d.total, 0);
    assert.equal(d.serie.length, 30);
  }
});

test('dadosDoResumo ignora balde inválido e tolera balde incompleto', () => {
  const h = {
    '2026-09-31': { read: 9, rejected: 9 },     // setembro não tem 31
    '2026-09-00': { read: 9, rejected: 9 },
    '2026-09-xx': { read: 9, rejected: 9 },
    '2026-09-05': null,                         // balde nulo (formato corrompido)
    '2026-09-06': 7,                            // balde que não é objeto
    '2026-09-07': { read: 2 },                  // sem `rejected`: conta o que tem
    '2026-09-08': { rejected: 3 },
  };
  const d = dadosDoResumo(h, 2026, 8);
  assert.equal(d.lidos, 2);
  assert.equal(d.rejeitados, 3);
  assert.equal(d.total, 5);
  assert.equal(d.diasAtivos, 2);
  assert.deepEqual(d.forte, { dia: 8, n: 3 });
});

test('dadosDoResumo: no empate, o dia mais CEDO é o mais forte — seja qual for a ordem das chaves', () => {
  // Chaves de trás pra frente de propósito: se a regra fosse "o primeiro que
  // aparece", a fixture em ordem cronológica nunca a distinguiria (gotcha #52).
  const h = { '2026-09-20': { read: 5, rejected: 0 }, '2026-09-03': { read: 2, rejected: 3 }, '2026-09-11': { read: 0, rejected: 5 } };
  assert.deepEqual(dadosDoResumo(h, 2026, 8).forte, { dia: 3, n: 5 });
  const inverso = { '2026-09-03': { read: 2, rejected: 3 }, '2026-09-20': { read: 5, rejected: 0 } };
  assert.deepEqual(dadosDoResumo(inverso, 2026, 8).forte, { dia: 3, n: 5 });
});

test('dadosDoResumo casa o prefixo com o mês (zero à esquerda, e dezembro é 12)', () => {
  const h = { '2026-01-10': { read: 1, rejected: 0 }, '2026-11-10': { read: 2, rejected: 0 }, '2026-12-10': { read: 4, rejected: 0 } };
  assert.equal(dadosDoResumo(h, 2026, 0).total, 1, 'janeiro é 01');
  assert.equal(dadosDoResumo(h, 2026, 10).total, 2, 'novembro é 11 — e "2026-1" cru casaria 10, 11 e 12');
  assert.equal(dadosDoResumo(h, 2026, 11).total, 4, 'dezembro é 12');
  assert.equal(dadosDoResumo(h, 2026, 11).serie.length, 31);
});

// ── 2. NADA DE NOVO NO ARMAZENAMENTO, NADA DE REDE ────────────────────────
test('o Resumo só LÊ: não grava histórico, não toca o localStorage, não chama a API', () => {
  const secao = secaoDoResumo();
  // Controle: a seção é a de verdade, com as funções que ela promete.
  for (const f of ['dadosDoResumo', 'desenharResumo', 'gerarResumoDoMes', 'abrirResumoDoMes', 'compartilharResumo', 'baixarResumo']) {
    assert.ok(secao.includes('function ' + f + '('), `a seção do Resumo perdeu ${f}`);
  }
  assert.doesNotMatch(secao, /localStorage\.setItem|salvarHistorico\(|recordHistory\(/,
    'o Resumo passou a ESCREVER — o histórico por dia que já existe é toda a fonte dele');
  assert.doesNotMatch(secao, /\bAPI\.\w+\(|\bfetch\(/,
    'o Resumo passou a falar com o servidor — é imagem gerada no aparelho, zero requisição (free tier)');
  // E lê pelo caminho único do histórico, não por um parse próprio do localStorage.
  assert.match(secao, /dadosDoResumo\(loadHistory\(\)/, 'o Resumo deixou de ler pelo loadHistory()');
});

// ── 3. PESO DE FONTE: o teto é o do @font-face ────────────────────────────
// Divide os argumentos de cada chamada respeitando parênteses aninhados — uma
// regex "3 dígitos seguidos de vírgula" pegava o `104` de um `y` como peso.
function argumentosDe(chamada, src) {
  const todas = [];
  let i = src.indexOf(chamada);
  while (i >= 0) {
    let j = i + chamada.length, nivel = 1, atual = '';
    const args = [];
    for (; j < src.length && nivel > 0; j++) {
      const c = src[j];
      if (c === '(') { nivel++; atual += c; }
      else if (c === ')') { nivel--; if (nivel > 0) atual += c; }
      else if (c === ',' && nivel === 1) { args.push(atual.trim()); atual = ''; }
      else atual += c;
    }
    args.push(atual.trim());
    todas.push(args);
    i = src.indexOf(chamada, j);
  }
  return todas;
}

test('a imagem só pede pesos que a Inter auto-hospedada TEM', () => {
  const faixa = CSS.match(/@font-face\s*\{[^}]*font-weight:\s*(\d+)\s+(\d+)/);
  assert.ok(faixa, 'o @font-face da Inter não declara a faixa de pesos (font-weight: MIN MAX)');
  const [min, max] = [Number(faixa[1]), Number(faixa[2])];
  const secao = secaoDoResumo();
  // Todo lugar em que um peso entra: `texto(s, x, y, PESO, tam, …)` (4º
  // argumento), `fonte(PESO, tam)` (1º) e a lista que o document.fonts.load aquece.
  const numero = (a) => /^\d{3}$/.test(a) ? Number(a) : null;
  const pesos = [];
  for (const args of argumentosDe('texto(', secao)) { const p = numero(args[3] || ''); if (p !== null) pesos.push(p); }
  for (const args of argumentosDe('fonte(', secao)) { const p = numero(args[0] || ''); if (p !== null) pesos.push(p); }
  const aquece = secao.match(/\[((?:\d{3},?\s*)+)\]\.map\(\(w\)/);
  assert.ok(aquece, 'sumiu a lista de pesos que o document.fonts.load aquece');
  for (const p of aquece[1].split(',')) pesos.push(Number(p.trim()));
  // Controle: se o varredor não enxerga os pesos, o teste passa por cegueira.
  assert.ok(pesos.length >= 20, `o varredor só achou ${pesos.length} pesos — a forma das chamadas mudou?`);
  const fora = pesos.filter((p) => p < min || p > max);
  assert.deepEqual(fora, [], `peso fora da faixa ${min}–${max} da Inter: o browser sintetiza ou cai no fallback em silêncio`);
});

// ── 4. O MODAL E O BOTÃO SEGUEM AS CONVENÇÕES DA CASA ─────────────────────
test('resumoModal está em MODAL_IDS e limpa o object URL por qualquer caminho de fechamento', () => {
  const ids = (APP.match(/MODAL_IDS\s*=\s*\[([^\]]*)\]/) || [])[1] || '';
  assert.ok(/'resumoModal'/.test(ids), 'resumoModal fora do MODAL_IDS — fica sem Esc, scrim e voltar');
  const limpeza = APP.match(/LIMPEZA_AO_FECHAR\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(limpeza, 'LIMPEZA_AO_FECHAR sumiu');
  const bloco = limpeza[1].match(/resumoModal\(\)\s*\{([\s\S]*?)\n    \},/);
  assert.ok(bloco, 'resumoModal não tem limpeza em LIMPEZA_AO_FECHAR — fechar por Esc/scrim vaza o blob');
  assert.match(bloco[1], /resumoAtual = null/, 'a limpeza não solta o blob');
  assert.match(bloco[1], /URL\.revokeObjectURL/, 'a limpeza não solta o object URL');
});

test('o botão do Resumo só aparece quando o mês tem pedido', () => {
  const rh = fatiarFuncao('renderHistory');
  const ini = rh.indexOf('if (mes.total > 0) {');
  assert.ok(ini > 0, 'o portão `if (mes.total > 0)` sumiu do renderHistory');
  const fim = rh.indexOf('\n    }', ini);
  const bloco = rh.slice(ini, fim);
  assert.match(bloco, /btn\.id = 'resumoBotao'/, 'o botão não nasce DENTRO do portão do mês');
  assert.equal(rh.split('resumoBotao').length, 2, 'resumoBotao aparece fora do portão');
  assert.match(bloco, /min-h-\[44px\]/, 'botão abaixo do alvo de toque');
  // Ele lê pelo MESMO caminho que a imagem — dois cálculos do mês divergiriam.
  assert.match(rh, /dadosDoResumo\(loadHistory\(\)/);
});

test('gerarResumoDoMes devolve null pra mês vazio; o desenho não traduz nada', () => {
  assert.match(fatiarFuncao('gerarResumoDoMes'), /if \(d\.total === 0\) return null;/);
  const desenho = fatiarFuncao('desenharResumo');
  assert.doesNotMatch(desenho, /\bt\(/, 'desenharResumo chama t() — o texto tem que chegar pronto, no idioma da pessoa');
  assert.doesNotMatch(desenho, /toLocale/, 'desenharResumo formata número/data — isso é de quem monta os textos');
  // Compartilhar só onde o aparelho compartilha ARQUIVO; senão o botão some.
  const abrir = fatiarFuncao('abrirResumoDoMes');
  assert.match(abrir, /navigator\.canShare\s*&&\s*navigator\.canShare\(\{\s*files:/, 'o Compartilhar deixou de conferir canShare({files})');
  assert.match(abrir, /resumoCompartilhar'\)\.classList\.toggle\('hidden', !podeCompartilhar\)/,
    'o botão de compartilhar não some onde o aparelho não compartilha arquivo');
});

test('o modal no HTML: diálogo acessível, folha, e Baixar à esquerda de Compartilhar', () => {
  const linhas = HTML.split('\n');
  const i = linhas.findIndex((l) => l.includes('id="resumoModal"'));
  assert.ok(i >= 0, 'resumoModal não está no index.html');
  assert.match(linhas[i], /role="dialog" aria-modal="true" aria-labelledby="resumoTitle"/);
  assert.match(linhas[i], /z-\[60\]/, 'modal fora da camada dos modais');
  const baixar = HTML.indexOf('id="resumoBaixar"');
  const compartilhar = HTML.indexOf('id="resumoCompartilhar"');
  assert.ok(baixar > 0 && compartilhar > 0, 'faltou um dos dois botões');
  assert.ok(baixar < compartilhar, 'dismissiva (Baixar) à esquerda, afirmativa (Compartilhar) à direita');
  for (const id of ['resumoBaixar', 'resumoCompartilhar', 'resumoClose']) {
    const l = linhas.find((x) => x.includes(`id="${id}"`));
    assert.match(l, /min-h-\[4[48]px\]/, `${id} abaixo do alvo de toque`);
  }
  // A imagem tem teto de altura: os dois botões ficam na tela sem rolar.
  const img = linhas.find((l) => l.includes('id="resumoImg"'));
  assert.match(img, /max-h-\[\d+dvh\]/, 'a imagem sem teto empurra os botões pra fora da tela');
});

// ── 5. A CSP DEIXA A IMAGEM APARECER ──────────────────────────────────────
test('a <img> recebe object URL, e as TRÊS cópias da CSP liberam blob: em img-src', () => {
  // Medido na primeira rodada do smoke: sem `blob:` a imagem chega 0×0, com o
  // ícone de quebrada, e nenhum erro sobe — a CSP bloqueia calada. O layout
  // test garante que as três cópias são IGUAIS; este garante que são CERTAS.
  assert.match(fatiarFuncao('abrirResumoDoMes'), /img\.src = URL\.createObjectURL\(blob\)/,
    'a imagem deixou de ser mostrada por object URL — se virou data:, este guard e o blob: podem sair juntos');
  // A CSP se extrai pela ESTRUTURA de cada cópia, nunca por `img-src` solto:
  // os comentários acima da meta e do `const CSP` citam "img-src blob:", e a
  // primeira versão deste guard casava com o comentário — sabotagem em UMA
  // cópia passava limpa (gotcha #14, o grep que casa com o próprio comentário).
  const copias = {
    'index.src.html': (HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1],
    '_headers': (readFileSync(new URL('../_headers', import.meta.url), 'utf8').match(/^\s*Content-Security-Policy:\s*(.+)$/m) || [])[1],
    'server/node.mjs': (readFileSync(new URL('../server/node.mjs', import.meta.url), 'utf8').match(/^const CSP = "([^"]*)"/m) || [])[1],
  };
  for (const [arquivo, csp] of Object.entries(copias)) {
    assert.ok(csp, `${arquivo}: não achei a CSP pela estrutura do arquivo`);
    const img = csp.match(/img-src([^;]*)/);
    assert.ok(img, `${arquivo}: CSP sem diretiva img-src`);
    assert.match(img[1], /\bblob:/, `${arquivo}: img-src sem blob: — a imagem do Resumo chega quebrada`);
  }
});
