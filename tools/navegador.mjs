// FONTE ÚNICA de abrir o navegador nos scripts do repo: os quatro smokes do CI,
// as ferramentas do diagnóstico e o gerador de splash — no Chromium (o motor do
// Chrome, o do Android) e no WebKit (o motor do Safari, o de TODO navegador do
// iPhone), escolhido por `MOTOR=chromium|webkit`.
//
// Ela existe porque a VERSÃO do navegador já custou um diagnóstico inteiro, e o
// erro foi sempre o mesmo: medir numa versão e concluir sobre outra sem saber.
// O CI fixava o Playwright 1.49.1 (Chromium 131, de novembro de 2024), o
// sandbox tinha o 1.56.1 global (Chromium 141), e o navegador de quem usa o app
// se atualiza sozinho (Chrome 15x). Três versões, e nenhum log dizendo qual
// rodou. Duas diferenças entre elas morderam em dois dias — o `EvalError` do
// poller do rAF, que só aparecia no 1.49, e o `page.close()`, que dispara
// `pagehide` no 1.56 e não no 1.49 — e as duas foram "não reproduz aqui"
// antes de alguém conferir a versão.
//
// Por isso o CI passou a usar o Playwright MAIS NOVO (`playwright@latest`), que
// traz o Chrome da vez — é o que está chegando no celular dos editores —, e este
// módulo fecha as portas por onde a divergência entrava:
//
// 1. QUAL Playwright carrega. O do REPO (`npm i --no-save playwright@latest`,
//    o MESMO comando do CI) ganha de tudo. O global do sandbox só entra se
//    você pedir (`PLAYWRIGHT_GLOBAL=1`) e, mesmo assim, avisando: um smoke que
//    caía nele calado era o caminho do "não reproduz aqui".
// 2. O import por CAMINHO de um pacote CJS devolve só o `default` (medido em
//    2026-09-22: o laço caía calado no global por causa disso). Aqui o import é
//    pelo especificador, que traz os nomeados, e o `default` segue aceito.
// 3. QUAL navegador abriu. Toda execução imprime a versão do Playwright, de
//    onde ele veio e a do navegador que o `launch` devolveu — o log do CI
//    passa a dizer com o que testou, e reproduzir aqui é instalar aquela
//    versão. E não há mais "se o Chromium do Playwright não abrir, tenta o
//    Chrome do sistema": aquele era outro navegador, com outra versão, entrando
//    em silêncio.
//
// E ele confere, sem custar nada ao app, se o npm já tem versão mais NOVA que a
// instalada: numa sessão longa, o que foi instalado ontem pode não ser mais o
// que o CI usa hoje.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GLOBAL_DO_SANDBOX = '/opt/node22/lib/node_modules/playwright/index.mjs';

export const COMO_INSTALAR =
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --no-save playwright@latest && npx playwright install chromium';

// Os motores que os scripts sabem abrir, com o nome que vai pro log.
export const MOTORES = { chromium: 'Chromium', webkit: 'WebKit' };

// O WebKit precisa de bibliotecas do SISTEMA que o Chromium não precisa (GTK 4,
// GStreamer…): numa máquina limpa ele não abre sem elas. MEDIDO no sandbox
// (Ubuntu 24.04, a mesma base do runner): "Host system is missing
// dependencies" até o `install-deps`, e abre depois dele.
const INSTALAR_MOTOR = {
  chromium: 'npx playwright install chromium',
  webkit: 'npx playwright install --with-deps webkit',
};

/** O motor pedido por `MOTOR` (padrão: chromium). Nome desconhecido PARA o script. */
export function motorPedido() {
  const m = String(process.env.MOTOR || 'chromium').toLowerCase();
  if (!Object.hasOwn(MOTORES, m)) {
    console.error(`✗ MOTOR=${process.env.MOTOR} não existe — use ${Object.keys(MOTORES).join(' ou ')}`);
    process.exit(2);
  }
  return m;
}

const primeiraLinha = (e) => String((e && e.message) || e).split('\n')[0];

function versaoDoPacote(arquivoDeEntrada) {
  try {
    return JSON.parse(readFileSync(join(dirname(arquivoDeEntrada), 'package.json'), 'utf8')).version || '?';
  } catch {
    return '?';
  }
}

// O pacote publicado é CJS por baixo: dependendo de como é importado, o
// namespace vem com os nomeados ou só com o `default`. Aceitar as duas formas,
// e só aceitar o candidato que tenha MESMO o `chromium`.
function comChromium(mod) {
  const pw = mod && mod.chromium ? mod : (mod && mod.default) || {};
  return pw.chromium ? pw : null;
}

// Compara 'a.b.c' numericamente; pré-release conta como a versão base.
function maisNova(a, b) {
  const p = (v) => String(v).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

// Uma consulta por processo, mesmo que o script abra mais de um navegador.
let consultaAoNpm = null;
function versaoNoNpm() {
  consultaAoNpm ??= new Promise((resolve) => {
    execFile('npm', ['view', 'playwright', 'version'], { timeout: 8000 }, (erro, saida) => {
      resolve(erro ? { erro: primeiraLinha(erro) } : { versao: String(saida).trim() });
    });
  });
  return consultaAoNpm;
}

/**
 * Carrega o Playwright do repo (ou, pedido explicitamente, o global do sandbox).
 * @returns {Promise<{ chromium: any, webkit: any, versao: string, origem: 'repo'|'global do sandbox', caminho: string }>}
 */
export async function carregarPlaywright() {
  const erros = [];

  try {
    const caminho = fileURLToPath(import.meta.resolve('playwright'));
    const pw = comChromium(await import('playwright'));
    if (pw) {
      const noRepo = caminho.startsWith(join(ROOT, 'node_modules') + sep);
      return { chromium: pw.chromium, webkit: pw.webkit, versao: versaoDoPacote(caminho), origem: noRepo ? 'repo' : 'fora do repo', caminho };
    }
    erros.push(`${caminho}: importou, mas sem 'chromium'`);
  } catch (e) {
    erros.push(`do repo: ${primeiraLinha(e)}`);
  }

  if (process.env.PLAYWRIGHT_GLOBAL === '1') {
    try {
      const pw = comChromium(await import(GLOBAL_DO_SANDBOX));
      if (pw) return { chromium: pw.chromium, webkit: pw.webkit, versao: versaoDoPacote(GLOBAL_DO_SANDBOX), origem: 'global do sandbox', caminho: GLOBAL_DO_SANDBOX };
      erros.push(`${GLOBAL_DO_SANDBOX}: importou, mas sem 'chromium'`);
    } catch (e) {
      erros.push(`global do sandbox: ${primeiraLinha(e)}`);
    }
  }

  console.error('✗ Playwright não encontrado no repo.\n  - ' + erros.join('\n  - '));
  console.error(`  Instale o mesmo do CI (o mais novo):\n    ${COMO_INSTALAR}`);
  if (process.env.PLAYWRIGHT_GLOBAL !== '1') {
    console.error('  (o global do sandbox só entra com PLAYWRIGHT_GLOBAL=1 — e aí o resultado pode divergir do CI)');
  }
  process.exit(1);
}

/**
 * Abre o navegador DESTA versão do Playwright, no motor pedido (`MOTOR`), e diz
 * no log qual abriu. Sem plano B: se ele não abrir, o script para — outro
 * navegador no lugar seria outra versão, que é justamente o que este módulo
 * existe pra evitar.
 */
export async function abrirNavegador(pw, opcoes = {}, motor = motorPedido()) {
  // `args` são chaves de linha de comando do CHROMIUM (timer em segundo plano,
  // mDNS do WebRTC). MEDIDO: o WebKit não abre com elas ("Target page, context
  // or browser has been closed"), então fora do Chromium elas ficam de fora.
  const { args, ...semArgs } = opcoes;
  let browser;
  try {
    browser = await pw[motor].launch(motor === 'chromium' ? opcoes : semArgs);
  } catch (e) {
    console.error(`✗ o ${MOTORES[motor]} do Playwright ${pw.versao} não abriu: ${primeiraLinha(e)}`);
    console.error(`  Baixe o navegador desta versão: ${INSTALAR_MOTOR[motor]}`);
    process.exit(1);
  }
  console.log(`navegador: ${MOTORES[motor]} ${browser.version()} · Playwright ${pw.versao} (${pw.origem})`);
  const avisos = [];
  if (pw.origem !== 'repo') avisos.push('este NÃO é o Playwright do CI — o resultado pode divergir');
  const npm = await versaoNoNpm();
  if (npm.erro) {
    console.log(`  ⚠ não deu pra conferir se há versão mais nova no npm (${npm.erro})`);
  } else if (maisNova(npm.versao, pw.versao)) {
    avisos.push(`o npm já tem o Playwright ${npm.versao} — é o que o CI vai usar`);
  }
  for (const a of avisos) console.log(`  ⚠ ${a}`);
  if (avisos.length) console.log(`  Instale o do CI:\n    ${COMO_INSTALAR}`);
  return browser;
}

/** Pra ferramenta que só faz sentido no Chromium, dito no nome da chamada. */
export function abrirChromium(pw, opcoes = {}) {
  return abrirNavegador(pw, opcoes, 'chromium');
}

// ── O que o MOTOR diz no console e não é erro da página ─────────────────────
//
// Lista FECHADA, cada frase MEDIDA e com o porquê. Serve pra quem conta erro de
// console como erro do app: sem ela, o aviso do motor vira falha de teste; com
// ela aberta demais, erro de verdade passa calado. Frase nova só entra com o
// motivo escrito aqui, e o test/navegador.test.mjs cobra isso.
const RUIDO_DO_MOTOR = [
  // WebKit: a chave `interactive-widget` do viewport é do Chrome (redimensiona o
  // layout quando o teclado abre). O Safari a ignora e AVISA no console, com
  // nível de erro, a cada página. MEDIDO: foi a única mensagem das 75 falhas
  // do smoke de fluxo no WebKit 26.6. Inofensivo: no iPhone quem cede espaço
  // pro teclado é o `--kb-inset`, medido da visualViewport.
  /^Viewport argument key "interactive-widget" not recognized and ignored\.$/,
];

/** `true` pra mensagem de console que é aviso conhecido do MOTOR, não da página. */
export function ruidoDoMotor(texto) {
  return RUIDO_DO_MOTOR.some((r) => r.test(String(texto)));
}

// ── Trechos que só rodam no Chromium ────────────────────────────────────────
//
// Alguns trechos dos smokes falam o protocolo do DevTools do Chromium (CDP):
// toque sintético com arraste, encerrar o service worker. O WebKit do
// Playwright não tem esse protocolo. Fora do Chromium esses trechos são
// PULADOS — sempre pelo nome, com o motivo, e contados no fim —, porque pulo
// calado é teste que morreu sem ninguém ver. A lista de pulos é cobrada em
// test/navegador.test.mjs: pulo novo sem entrar lá reprova.
const pulados = [];

/** `true` quando o trecho deve ser pulado (fora do Chromium), e diz qual e por quê. */
export function pularForaDoChromium(motor, oque, porque) {
  if (motor === 'chromium') return false;
  pulados.push(oque);
  console.log(`  ↷ fora do ${MOTORES[motor]}: ${oque} — ${porque}`);
  return true;
}

/** Linha de fechamento com os pulos, pra ir junto do resultado de cada smoke. */
export function resumoDosPulos(motor) {
  if (!pulados.length) return '';
  return `\n↷ ${pulados.length} trecho(s) só do Chromium ficaram de fora no ${MOTORES[motor]}: ${pulados.join('; ')}`;
}

export const _paraTeste = { comChromium, maisNova, RUIDO_DO_MOTOR };
