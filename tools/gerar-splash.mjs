// Gera as splash screens do iOS (`apple-touch-startup-image`), claras e escuras.
//
//   node tools/gerar-splash.mjs          # gera icons/splash/*.png
//   node tools/gerar-splash.mjs --links  # só imprime as <link> pro index.html
//
// POR QUE ISTO EXISTE. O `background_color` do manifest é UM valor só — o W3C
// não tem variante por esquema de cor (issue #1045, aberta) e o origin trial do
// Chrome ("Dark mode support for web apps", 109–114) era só desktop e nunca
// virou recurso. Então no Android a splash é uma cor fixa, e o máximo que a app
// faz é escolher a cor certa. O iOS é o único lugar onde dá pra entregar o que
// o owner pediu de verdade: `apple-touch-startup-image` aceita
// `prefers-color-scheme` no `media`, então existe uma splash clara e uma escura,
// e quem escolhe é a preferência da pessoa.
//
// AS CORES NÃO SÃO DIGITADAS AQUI. Saem das duas <meta name="theme-color"> do
// index.html, que o `test/layout.test.mjs` já amarra ao fundo do `body.dark`.
// Digitar a cor de novo seria o terceiro lugar pra ela divergir — e divergência
// de cor de splash é silenciosa: ninguém abre a app pra conferir o flash.
//
// O ÍCONE TAMBÉM NÃO É REDESENHADO: a página carrega `icons/icon-512.svg`, o
// mesmo arquivo do manifest. Splash com logo diferente do ícone instalado é a
// regra de ouro de consistência quebrada no primeiro segundo de uso.

import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { paletizar } from './png-palette.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.SPLASH_PORT || 8127);
const BASE = `http://127.0.0.1:${PORTA}/`;
const SAIDA = join(ROOT, 'icons', 'splash');

// Aparelhos iOS em uso, em RETRATO. Cada linha é (largura CSS, altura CSS, dpr),
// e é essa trinca que o `media` do link precisa casar EXATAMENTE — o iOS não
// aproxima. Tamanho sem link não é usado; link sem arquivo é splash branca.
//
// Só retrato: a app é de triagem no celular, e o iOS pede um arquivo por
// orientação. Paisagem sem imagem cai no comportamento de hoje (fundo do
// `background_color`), que já não é branco desde v2026.08.11-01.
export const APARELHOS_IOS = [
  { w: 375, h: 667, dpr: 2, nota: 'iPhone SE (2ª/3ª), 6/6s/7/8' },
  { w: 414, h: 736, dpr: 3, nota: 'iPhone 6+/7+/8 Plus' },
  { w: 414, h: 896, dpr: 2, nota: 'iPhone XR, 11' },
  { w: 375, h: 812, dpr: 3, nota: 'iPhone X/XS, 11 Pro, 12 mini, 13 mini' },
  { w: 414, h: 896, dpr: 3, nota: 'iPhone XS Max, 11 Pro Max' },
  { w: 390, h: 844, dpr: 3, nota: 'iPhone 12/12 Pro, 13/13 Pro, 14' },
  { w: 428, h: 926, dpr: 3, nota: 'iPhone 12/13 Pro Max, 14 Plus' },
  { w: 393, h: 852, dpr: 3, nota: 'iPhone 14 Pro, 15/15 Pro, 16' },
  { w: 430, h: 932, dpr: 3, nota: 'iPhone 14 Pro Max, 15 Plus/Pro Max, 16 Plus' },
  { w: 402, h: 874, dpr: 3, nota: 'iPhone 16 Pro' },
  { w: 440, h: 956, dpr: 3, nota: 'iPhone 16 Pro Max' },
  { w: 768, h: 1024, dpr: 2, nota: 'iPad mini/9.7"' },
  { w: 810, h: 1080, dpr: 2, nota: 'iPad 10.2"' },
  { w: 820, h: 1180, dpr: 2, nota: 'iPad Air 10.9"' },
  { w: 834, h: 1112, dpr: 2, nota: 'iPad Pro 10.5"' },
  { w: 834, h: 1194, dpr: 2, nota: 'iPad Pro 11"' },
  { w: 1024, h: 1366, dpr: 2, nota: 'iPad Pro 12.9"' },
];

export const TEMAS = ['light', 'dark'];

export function nomeSplash({ w, h, dpr }, tema) {
  return `splash-${w * dpr}x${h * dpr}-${tema}.png`;
}

export function mediaSplash({ w, h, dpr }, tema) {
  return `(prefers-color-scheme: ${tema}) and (device-width: ${w}px) and `
    + `(device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and `
    + `(orientation: portrait)`;
}

// As duas cores de fundo vêm do index.html, não daqui.
export function coresDoIndex(html) {
  const cores = {};
  const re = /<meta\s+name="theme-color"[^>]*>/gi;
  for (const tag of html.match(re) || []) {
    const cor = /content="([^"]+)"/i.exec(tag);
    const esquema = /prefers-color-scheme:\s*(light|dark)/i.exec(tag);
    if (cor && esquema) cores[esquema[1].toLowerCase()] = cor[1];
  }
  return cores;
}

export function linksSplash() {
  const linhas = [];
  for (const ap of APARELHOS_IOS) {
    for (const tema of TEMAS) {
      linhas.push(
        `    <link rel="apple-touch-startup-image" media="${mediaSplash(ap, tema)}"`
        + ` href="icons/splash/${nomeSplash(ap, tema)}">`,
      );
    }
  }
  return linhas.join('\n');
}

if (process.argv.includes('--links')) {
  console.log(linksSplash());
  process.exit(0);
}

async function carregarPlaywright() {
  const req = createRequire(import.meta.url);
  for (const t of [
    () => req.resolve('playwright', { paths: [ROOT] }),
    () => '/opt/node22/lib/node_modules/playwright/index.mjs',
    () => 'playwright',
  ]) {
    let mod;
    try { mod = await import(t()); } catch { continue; }
    const pw = mod && mod.chromium ? mod : (mod && mod.default) || {};
    if (pw.chromium) return pw;
  }
  console.error('✗ Playwright não encontrado.');
  process.exit(1);
}

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const CORES = coresDoIndex(html);
for (const tema of TEMAS) {
  if (!CORES[tema]) {
    console.error(`✗ index.html não tem <meta name="theme-color"> pro esquema ${tema}`);
    process.exit(1);
  }
}
console.log(`cores lidas do index.html: claro ${CORES.light} · escuro ${CORES.dark}`);

const servidor = spawn(process.execPath, [join(ROOT, 'server', 'node.mjs')], {
  env: { ...process.env, PORT: String(PORTA), HOST: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.on('exit', () => servidor.kill());
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* subindo */ }
  await new Promise((r) => setTimeout(r, 250));
}

// A marca fica em texto (é o mesmo `name` do manifest), e "Waze Places" não se
// traduz — é nome próprio, como manda a seção de i18n. Então UMA imagem serve
// pras quatro línguas.
function pagina(tema) {
  const fundo = CORES[tema];
  const texto = tema === 'dark' ? '#e2e8f0' : '#334155';
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Inter'; font-style: normal; font-weight: 100 900;
    font-display: block; src: url('fonts/inter-latin-wght-normal.woff2') format('woff2');
  }
  html, body { margin: 0; padding: 0; height: 100%; background: ${fundo}; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1.5rem; font-family: 'Inter', system-ui, sans-serif; color: ${texto};
  }
  img { width: 128px; height: 128px; }
  span { font-size: 1.375rem; font-weight: 600; letter-spacing: -0.01em; }
</style></head><body>
  <img src="icons/icon-512.svg" alt="">
  <span>Waze Places</span>
</body></html>`;
}

const { chromium } = await carregarPlaywright();
const browser = await chromium.launch();
mkdirSync(SAIDA, { recursive: true });

let total = 0;
let bytes = 0;
for (const ap of APARELHOS_IOS) {
  for (const tema of TEMAS) {
    const ctx = await browser.newContext({
      viewport: { width: ap.w, height: ap.h },
      deviceScaleFactor: ap.dpr,
      colorScheme: tema,
      serviceWorkers: 'block',
    });
    const page = await ctx.newPage();
    await page.route('**/__splash', (rota) => rota.fulfill({
      body: pagina(tema), contentType: 'text/html; charset=utf-8',
    }));
    await page.goto(BASE + '__splash', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const buf = paletizar(await page.screenshot({ type: 'png' }));
    const arquivo = join(SAIDA, nomeSplash(ap, tema));
    writeFileSync(arquivo, buf);
    total++; bytes += buf.length;
    await ctx.close();
  }
}
await browser.close();
servidor.kill();

console.log(`✓ ${total} imagens em icons/splash/ · ${(bytes / 1024).toFixed(0)} KB no total`);
console.log('  cole no <head> do index.html:');
console.log(linksSplash());
