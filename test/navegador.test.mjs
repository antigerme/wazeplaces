// O navegador dos testes é o MAIS NOVO, e todo script que abre um passa por UMA
// porta (`tools/navegador.mjs`). Este arquivo cobra as duas coisas.
//
// A história (a longa está no CLAUDE.md, no parágrafo do smoke de browser): o
// CI fixou o Playwright 1.49.1 — Chromium 131, de novembro de 2024 — por uns 21
// meses, enquanto o sandbox tinha o 1.56.1 global e o editor roda o Chrome da
// vez, que se atualiza sozinho. Dois defeitos de INSTRUMENTO só existiam numa
// das versões e viraram "não reproduz aqui". E o carregador, copiado em quatro
// smokes, tinha um defeito que morava em dois dos quatro: cópia é como a
// correção chega num lugar e não no outro.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { _paraTeste, ruidoDoMotor } from '../tools/navegador.mjs';
const _paraTesteDoRuido = { ruidoDoMotor };

const ler = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
// Sem comentário na conta (gotcha #67): os arquivos CITAM o padrão errado
// justamente pra explicar por que ele é errado.
const semComentario = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// Os scripts que abrem navegador hoje. Serve de ALCANCE: se um deles deixar de
// passar pela fonte única, ou o guard parar de enxergá-lo, reprova.
const ABREM_NAVEGADOR = [
  'smoke-browser.mjs', 'smoke-offline.mjs', 'smoke-presenca.mjs', 'smoke-fluxo.mjs',
  'diag-replay.mjs', 'diag-tela.mjs', 'smoke-diag-tela.mjs', 'gerar-splash.mjs',
];

test('todo script que abre navegador passa pela fonte única', () => {
  const arquivos = readdirSync(new URL('../tools/', import.meta.url))
    .filter((f) => f.endsWith('.mjs') && f !== 'navegador.mjs');
  const usam = [];
  for (const f of arquivos) {
    const codigo = semComentario(ler(`tools/${f}`));
    // Carregar por fora é a porta por onde a versão divergia calada.
    assert.doesNotMatch(codigo, /node_modules\/playwright/,
      `${f} importa um playwright por CAMINHO — passe pelo tools/navegador.mjs`);
    assert.doesNotMatch(codigo, /resolve\(\s*'playwright'/,
      `${f} resolve o playwright por conta própria — passe pelo tools/navegador.mjs`);
    assert.doesNotMatch(codigo, /import\(\s*'playwright'\s*\)|from\s+'playwright'/,
      `${f} importa o playwright direto — passe pelo tools/navegador.mjs`);
    // Abrir por fora pula a linha do log que diz QUAL navegador rodou.
    assert.doesNotMatch(codigo, /\bchromium\.launch\(/,
      `${f} abre o Chromium por conta própria — use abrirChromium`);
    // Versão cravada num script é o pino que ficou 21 meses sem ninguém mexer.
    assert.doesNotMatch(codigo, /playwright@\d/, `${f} crava uma versão do Playwright`);
    if (/from '\.\/navegador\.mjs'|import\('\.\/navegador\.mjs'\)/.test(codigo)) usam.push(f);
  }
  for (const f of ABREM_NAVEGADOR) {
    assert.ok(usam.includes(f),
      `${f} não passa pelo tools/navegador.mjs — voltou a carregar por conta própria, ou o guard perdeu alcance`);
  }
});

test('a fonte única: o do repo primeiro, o global só pedido, a versão no log e sem plano B', () => {
  const src = semComentario(ler('tools/navegador.mjs'));

  // O pacote publicado é CJS por baixo: por CAMINHO o import devolve só o
  // `default`. Foi isso que fez a tentativa "do repo" falhar calada.
  assert.match(src, /mod\s*&&\s*mod\.chromium\s*\?\s*mod\s*:\s*\(mod\s*&&\s*mod\.default\)/,
    'a fonte única deixou de aceitar a forma CJS (namespace só com `default`)');

  // O global do sandbox só entra PEDIDO. Toda importação dele tem que estar
  // dentro do bloco do `PLAYWRIGHT_GLOBAL === '1'`.
  const abre = "if (process.env.PLAYWRIGHT_GLOBAL === '1') {";
  const ini = src.indexOf(abre);
  assert.ok(ini >= 0, 'sumiu o pedido explícito pro global do sandbox');
  let prof = 0;
  let fim = -1;
  for (let i = ini + abre.length - 1; i < src.length; i++) {
    if (src[i] === '{') prof++;
    else if (src[i] === '}' && --prof === 0) { fim = i; break; }
  }
  const usosDoGlobal = [...src.matchAll(/import\(GLOBAL_DO_SANDBOX\)/g)].map((m) => m.index);
  assert.ok(usosDoGlobal.length >= 1, 'o guard não achou a importação do global — perdeu alcance');
  for (const pos of usosDoGlobal) {
    assert.ok(pos > ini && pos < fim,
      'o global do sandbox passou a ser importado SEM o pedido explícito — é a divergência calada de volta');
  }

  // O log diz com o que testou: a versão do Playwright, a origem e a do navegador.
  assert.match(src, /console\.log\(`navegador: \$\{MOTORES\[motor\]\} \$\{browser\.version\(\)\} · Playwright \$\{pw\.versao\} \(\$\{pw\.origem\}\)`\)/,
    'a linha que diz QUAL navegador rodou — motor, versão e Playwright — sumiu ou mudou de forma');

  // Sem plano B: se o Chromium do Playwright não abrir, o script para.
  assert.doesNotMatch(src, /channel\s*:/,
    'voltou o "tenta o Chrome do sistema" — outro navegador, com outra versão, entrando em silêncio');
});

test('comparar versões é por NÚMERO, não por texto', () => {
  const { maisNova } = _paraTeste;
  assert.equal(maisNova('1.64.0', '1.63.0'), true);
  assert.equal(maisNova('1.63.1', '1.63.0'), true);
  assert.equal(maisNova('2.0.0', '1.99.9'), true);
  assert.equal(maisNova('1.63.0', '1.63.0'), false, 'a mesma versão não é mais nova');
  assert.equal(maisNova('1.62.1', '1.63.0'), false);
  // O caso que uma comparação de TEXTO erra: '1.10' < '1.9' em ordem de string.
  assert.equal(maisNova('1.10.0', '1.9.0'), true);
  assert.equal(maisNova('1.9.0', '1.10.0'), false);
});

test('o carregador aceita as duas formas do módulo, e só com o `chromium`', () => {
  const { comChromium } = _paraTeste;
  const chromium = { launch() {} };
  assert.equal(comChromium({ chromium }).chromium, chromium, 'forma ESM (nomeados)');
  assert.equal(comChromium({ default: { chromium } }).chromium, chromium, 'forma CJS (só `default`)');
  assert.equal(comChromium({ default: {} }), null, 'módulo sem `chromium` não serve');
  assert.equal(comChromium(null), null);
});

test('o CI testa com o Playwright MAIS NOVO, por um botão só', () => {
  const ci = ler('.github/workflows/ci.yml');
  // O navegador de quem usa a app se atualiza sozinho; o do teste também tem
  // que ser o da vez. Fixar uma versão é EXCEÇÃO: se um Playwright novo vier
  // quebrado, fixe aqui e no workflow, com o motivo e a data — ato deliberado,
  // não um pino esquecido por 21 meses.
  // TODOS os jobs: com o do WebKit, um `latest` em qualquer lugar do arquivo
  // deixava o outro job fixar versão sem reprovar (a sabotagem passou).
  // Só as linhas de código do YAML: os comentários CITAM o botão (gotcha #67).
  const ciSemComentario = ci.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const botoes = [...ciSemComentario.matchAll(/PLAYWRIGHT_VERSAO:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(botoes.length >= 2, `esperava o botão nos dois jobs, achei ${botoes.length}`);
  for (const b of botoes) assert.equal(b, 'latest', `um job do CI fixou o Playwright em ${b}`);
  assert.match(ci, /npm i --no-save "playwright@\$PLAYWRIGHT_VERSAO"/,
    'o CI instala o Playwright sem passar pelo botão PLAYWRIGHT_VERSAO');
  assert.doesNotMatch(ci, /playwright@\d/, 'o CI voltou a cravar uma versão do Playwright');
});

// ── O WebKit (o motor do Safari e de todo navegador do iPhone) ──────────────

test('fora do Chromium o launch vai SEM as chaves do Chromium', () => {
  // MEDIDO: o WebKit não abre com nenhuma chave de linha de comando do
  // Chromium ("Target page, context or browser has been closed"). Sem este
  // corte, o job do WebKit morre no primeiro launch.
  const src = semComentario(ler('tools/navegador.mjs'));
  assert.match(src, /const \{ args, \.\.\.semArgs \} = opcoes;/, 'sumiu o corte das chaves do Chromium');
  assert.match(src, /pw\[motor\]\.launch\(motor === 'chromium' \? opcoes : semArgs\)/,
    'o launch voltou a mandar as chaves do Chromium pra qualquer motor');
  // Motor desconhecido PARA: `MOTOR=safari` cair calado no Chromium seria
  // testar o motor errado achando que testou o certo.
  assert.match(src, /if \(!Object\.hasOwn\(MOTORES, m\)\) \{[\s\S]{0,200}?process\.exit\(2\)/,
    'motor desconhecido deixou de parar o script');
});

test('os smokes que o CI roda no WebKit abrem pelo motor pedido', () => {
  const ci = ler('.github/workflows/ci.yml').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const job = ci.slice(ci.indexOf('\n  webkit:'));
  assert.ok(ci.includes('\n  webkit:'), 'sumiu o job do WebKit no CI');
  assert.match(job, /MOTOR: webkit/, 'o job do WebKit não pede o WebKit');
  assert.match(job, /npx playwright install --with-deps webkit/,
    'o WebKit precisa das bibliotecas do sistema (--with-deps) — sem elas ele não abre');
  assert.match(job, /npm i --no-save "playwright@\$PLAYWRIGHT_VERSAO"/, 'o job do WebKit não usa o botão da versão');
  assert.match(job, /PLAYWRIGHT_VERSAO:\s*latest\s*$/m, 'o job do WebKit deixou de usar o mais novo');
  // O job é PARALELO: esperar o outro somaria os dois tempos.
  assert.doesNotMatch(job, /^\s+needs:/m, 'o job do WebKit passou a esperar o outro — o CI dobra de tempo');
  const rodados = [...job.matchAll(/npm run (test:[a-z]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(rodados, ['test:browser', 'test:fluxo', 'test:presenca'],
    'mudou o que roda no WebKit — o offline fica de fora por MEDIÇÃO (ver o comentário do job)');
  const script = { 'test:browser': 'smoke-browser', 'test:fluxo': 'smoke-fluxo', 'test:presenca': 'smoke-presenca' };
  for (const t of rodados) {
    const codigo = semComentario(ler(`tools/${script[t]}.mjs`));
    assert.match(codigo, /abrirNavegador\(pw\b/, `${script[t]} não abre pelo motor pedido — no job do WebKit ele abriria o Chromium`);
    assert.doesNotMatch(codigo, /abrirChromium\(/, `${script[t]} abre o Chromium à força`);
  }
});

test('todo pulo fora do Chromium é NOMEADO, com motivo, e está na lista', () => {
  // Pulo calado é teste que morreu sem ninguém ver. Pulo novo tem que entrar
  // AQUI, de propósito — o número por arquivo é a lista.
  const ESPERADOS = { 'smoke-browser.mjs': 1 };
  const achados = {};
  for (const f of readdirSync(new URL('../tools/', import.meta.url)).filter((x) => x.endsWith('.mjs') && x !== 'navegador.mjs')) {
    const codigo = semComentario(ler(`tools/${f}`));
    const chamadas = [...codigo.matchAll(/pularForaDoChromium\(MOTOR,\s*(`[^`]+`|'[^']+'),\s*(`[^`]+`|'[^']+')\)/g)];
    const soltas = (codigo.match(/pularForaDoChromium\(/g) || []).length;
    assert.equal(chamadas.length, soltas,
      `${f}: pulo sem nome ou sem motivo literal — "fora do WebKit: ???" não diz o que deixou de rodar`);
    for (const c of chamadas) assert.ok(c[2].length > 20, `${f}: motivo curto demais pra explicar o pulo: ${c[2]}`);
    if (chamadas.length) achados[f] = chamadas.length;
  }
  assert.deepEqual(achados, ESPERADOS, 'a lista de pulos mudou — pulo novo entra aqui com o motivo, não calado');
  // E o fim de cada smoke do WebKit DIZ quantos pulou.
  for (const f of ['smoke-browser', 'smoke-fluxo', 'smoke-presenca']) {
    assert.match(semComentario(ler(`tools/${f}.mjs`)), /if \(resumoDosPulos\(MOTOR\)\) console\.log\(resumoDosPulos\(MOTOR\)\);/,
      `${f} não imprime os pulos no fim`);
  }
});

test('o que o motor diz no console e não é erro da página: lista FECHADA e exata', () => {
  const { RUIDO_DO_MOTOR } = _paraTeste;
  // Uma frase só, MEDIDA: o Safari avisando que ignora o `interactive-widget`.
  assert.equal(RUIDO_DO_MOTOR.length, 1, 'a lista de ruído do motor cresceu — frase nova entra com o motivo e a medição');
  for (const r of RUIDO_DO_MOTOR) {
    assert.ok(r.source.startsWith('^') && r.source.endsWith('$'),
      `ruído sem âncora (${r.source}) engole erro de verdade que CONTENHA a frase`);
  }
  const { ruidoDoMotor } = _paraTesteDoRuido;
  assert.equal(ruidoDoMotor('Viewport argument key "interactive-widget" not recognized and ignored.'), true);
  // O que tem que continuar sendo ERRO: a mesma frase com mais coisa, e erro de verdade.
  assert.equal(ruidoDoMotor('TypeError: x is undefined'), false);
  assert.equal(ruidoDoMotor('Viewport argument key "interactive-widget" not recognized and ignored. TypeError: boom'), false);
});

test('o ajuste de ICE da presença vale SÓ fora do Chromium, e só troca o nome mDNS', () => {
  // O Chromium já sai com o IP de verdade pela chave de linha de comando; no
  // WebKit o mesmo efeito é trocar o `<uuid>.local` por 127.0.0.1 no teste.
  // MEDIDO com duas conexões na mesma página: com `.local`, o ICE fica em
  // "new" e o DataChannel não abre; trocado, "connected".
  const codigo = semComentario(ler('tools/smoke-presenca.mjs'));
  assert.match(codigo, /async function iceSemMdnsForaDoChromium\(ctx\) \{\s*if \(MOTOR === 'chromium'\) return;/,
    'o ajuste de ICE passou a valer no Chromium também — lá o instrumento já é outro');
  assert.match(codigo, /replace\(\/\[0-9a-f-\]\+\\\.local\\b\/i, '127\.0\.0\.1'\)/,
    'o ajuste deixou de ser SÓ a troca do nome mDNS');
  const contextos = (codigo.match(/await browser\.newContext\(/g) || []).length;
  const ajustados = (codigo.match(/await iceSemMdnsForaDoChromium\(/g) || []).length;
  assert.equal(ajustados, contextos, 'contexto novo na presença sem o ajuste de ICE — no WebKit a conversa não abre nele');
});

test('a main roda o CI toda semana, fora da hora cheia', () => {
  // O `latest` só testa o navegador novo quando algo dispara o CI; semana sem
  // PR era semana sem teste. A rodada semanal fecha isso.
  const ci = ler('.github/workflows/ci.yml');
  const m = ci.match(/^\s+schedule:\s*\n\s+- cron: '(\d+) (\d+) \* \* (\d)'\s*$/m);
  assert.ok(m, 'sumiu a rodada semanal (ou deixou de ser semanal)');
  assert.notEqual(m[1], '0', 'o GitHub avisa que agendamento na hora cheia atrasa e pode ser descartado sob carga');
});

test('o FAB é medido depois de QUADROS, não de um prazo', () => {
  // MEDIDO no WebKit: 250 ms depois de abrir a Ajuda, o FAB ainda estava no
  // canto velho em 4 de 8 rodadas — ele se reposiciona no primeiro QUADRO, e o
  // WebKit do Playwright desenha um a cada ~100 ms. Com dois quadros, 0 de 8.
  const codigo = semComentario(ler('tools/smoke-browser.mjs'));
  assert.match(codigo, /const doisQuadros = \(page\) => page\.evaluate\(\(\) => new Promise\(\(ok\) => \{\s*setTimeout\(ok, 2000\);\s*requestAnimationFrame\(\(\) => requestAnimationFrame\(ok\)\);/,
    'a espera por dois quadros sumiu ou mudou de forma');
  assert.match(codigo, /\} else if \(alvo\) openModal\(alvo\);\s*\}, id\);\s*await assentar\(page, 250\);\s*await doisQuadros\(page\);/,
    'a medição do FAB em cada camada voltou a esperar só um prazo');
});
