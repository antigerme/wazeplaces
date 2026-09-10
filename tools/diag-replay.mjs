// Reconstrói a TELA do editor a partir de um diagnóstico do modo dev, viva e
// manipulável — não uma imagem.
//
//   node tools/diag-replay.mjs <arquivo.json> [--porta 8123] [--tela] [--tudo]
//
// POR QUE ISTO EXISTE. O `diag-tela.mjs` remonta uma FOTO do momento (DOM
// congelado, sem JS, sem rede) e responde "o que ele via". Esta ferramenta
// responde outra pergunta: "e se eu mexer?". Ela sobe a app de verdade, injeta a
// fila, os filtros, o perfil, o tema e o idioma DELE, no viewport DELE — e a
// partir daí dá pra abrir modal, arrastar card, medir geometria, rodar o
// coletor do diagnóstico ou tirar um antes/depois de uma correção.
//
// Antes disso eu reconstruía esse estado À MÃO a cada investigação: extrair um
// place do JSON, escrever um script de Playwright, injetar `AppState`, medir.
// Fiz isso três vezes só no dia 2026-09-10 — e numa delas cheguei a extrair
// quadros de vídeo com ffmpeg pra medir o que era um `getBoundingClientRect()`.
//
// NÃO fala com a rede: nenhuma chamada a `/api/*` sai, porque o estado já vem
// pronto do arquivo. Quem quiser perguntar algo NOVO ao Waze usa o
// `tools/diag-api.mjs`, que é outra ferramenta e tem outras regras.
import { readFileSync } from 'node:fs';
import { lerDiagnostico } from './diag-ler.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ARQ = args.find((a) => !a.startsWith('--'));
const opt = (nome, padrao) => {
  const i = args.indexOf('--' + nome);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao;
};
if (!ARQ) {
  console.error('uso: node tools/diag-replay.mjs <arquivo.json> [--porta 8123] [--tela] [--tudo]');
  console.error('  --tela   salva um PNG e sai (sem abrir sessão interativa)');
  console.error('  --tudo   injeta a fila INTEIRA (padrão: 30 primeiros — o resto raramente muda a tela)');
  process.exit(2);
}

// Aceita `.zip` (o formato de hoje) e `.json` cru (relato antigo, ou
// navegador sem CompressionStream). Farejado pelos bytes, não pela extensão.
const { dados: d, origem: _origemDoDiag } = lerDiagnostico(ARQ);
const st = d.appState || {};
// `currentPlace` virou ÍNDICE no formato 3+. Nos formatos antigos ele é um
// objeto e o `queue[0]` pode ter saído como a string "[circular]" — o mesmo
// objeto serializado duas vezes. Os dois casos são remendados aqui.
const fila = (st.queue || []).map((x, i) => (x === '[circular]' ? st.currentPlace : x)).filter(Boolean);
const idx = Number.isInteger(st.currentPlaceIdx) && st.currentPlaceIdx >= 0 ? st.currentPlaceIdx : 0;
const LIMITE = args.includes('--tudo') ? fila.length : 30;
const recorte = fila.slice(idx, idx + LIMITE);

const [W, H] = String((d.ambiente && d.ambiente.tela && d.ambiente.tela.janela) || '390x844')
  .split('x').map((n) => parseInt(n, 10) || 0);
const dpr = (d.ambiente && d.ambiente.tela && d.ambiente.tela.dpr) || 2;
const escuro = /"?dark"?/.test(String((d.localStorage || {}).waze_places_theme || ''));
const lang = (d.app && d.app.idioma) || 'pt';
const PORTA = parseInt(opt('porta', '8123'), 10);

console.log(`de:      ${ARQ.split('/').pop()}   (${_origemDoDiag})`);
console.log(`app:     ${(d.app && d.app.rotulo) || '?'}   formato ${d._formato || '?'}`);
console.log(`tela:    ${W}x${H} @${dpr}x · tema ${escuro ? 'escuro' : 'claro'} · idioma ${lang}`);
console.log(`fila:    ${fila.length} pedido(s), injetando ${recorte.length} a partir do índice ${idx}`);
console.log(`filtros: ${JSON.stringify(st.filters || {})}`);

const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');

const servidor = spawn(process.execPath, [join(ROOT, 'server', 'node.mjs')], {
  env: { ...process.env, PORT: String(PORTA), HOST: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const parar = () => { try { servidor.kill(); } catch (e) {} };
process.on('exit', parar);
process.on('SIGINT', () => { parar(); process.exit(130); });

// Espera o servidor ATENDER, não um relógio: `sleep` fixo é palpite e falha na
// máquina lenta justamente quando se está com pressa.
for (let i = 0; i < 60; i++) {
  try { await fetch(`http://127.0.0.1:${PORTA}/`); break; } catch (e) {
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await chromium.launch({ headless: !args.includes('--abrir') });
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: dpr,
  locale: lang, hasTouch: true, isMobile: true, serviceWorkers: 'block',
  colorScheme: escuro ? 'dark' : 'light',
});
const page = await ctx.newPage();
const erros = [];
page.on('pageerror', (e) => erros.push(e.message));

// As preferências e o idioma entram ANTES da carga: o "Como funciona" da
// primeira execução cobre o card inteiro no Fold, e aí toda medição mede o
// modal. Custou uma rodada de mockups descobrir isso.
await page.addInitScript(([prefs, l, tema]) => {
  try {
    localStorage.setItem('waze_places_preferences', prefs);
    localStorage.setItem('waze_places_lang', l);
    localStorage.setItem('waze_places_theme', tema);
  } catch (e) {}
}, [JSON.stringify({ ...(st.preferences || {}), comoFuncionaVisto: true }), lang, escuro ? 'dark' : 'light']);

await page.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof AppState !== 'undefined', null, { timeout: 30000 });

await page.evaluate(([places, filtros, perfil, devMode]) => {
  for (const id of ['authScreen', 'loadingCard', 'comoFuncionaModal']) {
    document.getElementById(id)?.classList.add('hidden');
  }
  document.getElementById('appScreen')?.classList.remove('hidden');
  AppState.authenticated = true;
  AppState.profile = perfil || AppState.profile;
  if (filtros) AppState.filters = { ...AppState.filters, ...filtros };
  AppState.queue = places;
  AppState.serverTotal = places.length;
  AppState.hasMore = false;
  if (devMode) AppState.devMode = devMode;
  showCurrentPlace();
  updatePendingCount();
  if (typeof atualizarFabDev === 'function') atualizarFabDev();
}, [recorte, st.filters || null, st.profile || null, st.devMode || null]);

await page.waitForTimeout(500);

const visao = await page.evaluate(() => ({
  painel: document.querySelector('.place-card') ? 'card'
    : (!document.getElementById('noMoreCards')?.classList.contains('hidden') ? 'tudoLimpo' : 'nada'),
  titulo: document.querySelector('.card-name')?.textContent.trim() || null,
  alertas: typeof diagSentinelas === 'function' ? diagSentinelas(diagComputado()) : null,
}));
console.log(`\npainel:  ${visao.painel}${visao.titulo ? ` · "${visao.titulo}"` : ''}`);
if (visao.alertas) console.log(`alertas: ${visao.alertas.length ? JSON.stringify(visao.alertas) : 'nenhum'}`);
if (erros.length) console.log(`ERROS DE JS: ${erros.join(' | ')}`);

if (args.includes('--tela')) {
  const saida = ARQ.replace(/\.json$/, '') + '-replay.png';
  await page.screenshot({ path: saida });
  console.log(`\ntela salva em ${saida}`);
  await browser.close();
  parar();
} else {
  console.log(`\napp viva em http://127.0.0.1:${PORTA}/ com o estado dele.`);
  console.log('Ctrl+C encerra (o servidor cai junto).');
  await new Promise(() => {});
}
