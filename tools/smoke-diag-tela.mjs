// Valida o `tools/diag-tela.mjs` do jeito mais duro que existe: dirige a app de
// VERDADE (servidor real, Waze real, cookies do owner), e em cada estado tira a
// tela AO VIVO no mesmo instante em que o FAB captura. Depois remonta o
// diagnóstico e compara as duas imagens PIXEL A PIXEL.
//
// Por que assim, e não "abri e pareceu certo": duas versões do diag-tela
// entregaram imagem SEM ESTILO, com zero erro e zero aviso — a tela errada com
// cara de certa. Olho não pega isso quando não há com o que comparar. A tela ao
// vivo é o gabarito, e a diferença percentual é o número que decide.
//
//   node tools/smoke-diag-tela.mjs <cookies.txt>
//
// O valor do cookie NUNCA é ecoado: entra por `page.evaluate` (que não repete o
// argumento no log de erro, ao contrário do `page.fill`) dentro de try/catch que
// não repassa a mensagem crua.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const COOKIES = process.argv[2];
if (!COOKIES) { console.error('uso: node tools/smoke-diag-tela.mjs <cookies.txt>'); process.exit(2); }
const PORT = 8241, BASE = `http://127.0.0.1:${PORT}`;
const SAIDA = '/tmp/smoke-diag-tela';
rmSync(SAIDA, { recursive: true, force: true });
mkdirSync(SAIDA, { recursive: true });

let falhas = 0;
const checa = (ok, oq, detalhe = '') => {
  if (!ok) { falhas++; console.log(`  ✗ ${oq}${detalhe ? ' — ' + detalhe : ''}`); }
  else console.log(`  ✓ ${oq}`);
};

const srv = spawn('node', ['server/node.mjs'], { cwd: '/home/user/wazeplaces',
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));

const browser = await chromium.launch();

// ── compara dois PNG dentro do próprio Chromium ───────────────────────────
// Não há PIL nem sharp aqui, e o projeto não ganha dependência por causa de um
// teste. O navegador já sabe decodificar PNG: desenha os dois num canvas e
// conta os pixels que diferem além de um limiar por canal.
async function diferenca(a, b) {
  const p = await browser.newPage();
  const r = await p.evaluate(async ([da, db]) => {
    const carrega = (src) => new Promise((ok, err) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = src;
    });
    const [ia, ib] = await Promise.all([carrega(da), carrega(db)]);
    if (ia.width !== ib.width || ia.height !== ib.height) {
      return { erro: `tamanhos diferentes: ${ia.width}x${ia.height} × ${ib.width}x${ib.height}` };
    }
    const px = (img) => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.getContext('2d').getImageData(0, 0, img.width, img.height).data;
    };
    const [pa, pb] = [px(ia), px(ib)];
    let diff = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (Math.abs(pa[i] - pb[i]) > 24 || Math.abs(pa[i + 1] - pb[i + 1]) > 24
          || Math.abs(pa[i + 2] - pb[i + 2]) > 24) diff++;
    }
    const total = pa.length / 4;
    return { pct: +(100 * diff / total).toFixed(2), largura: ia.width, altura: ia.height };
  }, [
    'data:image/png;base64,' + readFileSync(a).toString('base64'),
    'data:image/png;base64,' + readFileSync(b).toString('base64'),
  ]);
  await p.close();
  return r;
}

// ── a app, de verdade ─────────────────────────────────────────────────────
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  acceptDownloads: true, serviceWorkers: 'block',
});
// Imagem de TERCEIRO bloqueada também AO VIVO. A remontagem corta rede por
// projeto (recurso que carregasse aqui e não no aparelho dele daria uma imagem
// que ninguém viu), então deixar a foto do Waze carregar só de um lado mede a
// FOTO, não a fidelidade: medido, dava 46% de diferença só por causa dela.
// Bloqueando nos dois, o que sobra na conta é o que a ferramenta promete
// remontar — o desenho da própria app.
await ctx.route('**/*', (r) => {
  const u = r.request().url();
  const tipo = r.request().resourceType();
  return (tipo === 'image' && !u.startsWith(BASE)) ? r.abort() : r.continue();
});
const page = await ctx.newPage();
const errosJs = [];
page.on('pageerror', (e) => errosJs.push(String(e.message || e).slice(0, 120)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

await page.click('#pasteBtn'); await page.waitForTimeout(250);
try {
  await page.evaluate((v) => {
    const el = document.getElementById('cookiesTextarea');
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, readFileSync(COOKIES, 'utf8'));
} catch (e) { console.error('falha ao preencher (mensagem suprimida de propósito)'); process.exit(1); }
await page.click('#confirmPaste');
await page.evaluate(async () => {
  const lim = Date.now() + 60000;
  while (Date.now() < lim) {
    if (document.getElementById('authScreen').classList.contains('hidden')
        && (document.querySelector('.place-card')
            || !document.getElementById('noMoreCards').classList.contains('hidden'))) return;
    await new Promise((r) => setTimeout(r, 300));
  }
});
if (await page.evaluate(() => !document.getElementById('comoFuncionaModal').classList.contains('hidden')))
  await page.click('#comoFuncionaOk');
await page.waitForTimeout(600);
console.log('login ok · fila:', await page.evaluate(() => AppState.queue.length));

// dev: 7 toques + interruptor
await page.click('#helpBtn'); await page.waitForTimeout(250);
for (let i = 0; i < 7; i++) { await page.click('#appVersionDisplay'); await page.waitForTimeout(60); }
await page.evaluate(() => closeModal('helpModal')); await page.waitForTimeout(200);
await page.click('#filtersBtn'); await page.waitForTimeout(250);
await page.click('#filtersTabPrefs').catch(() => {});
await page.waitForTimeout(150);
await page.click('#prefDevModeActive'); await page.waitForTimeout(300);
await page.evaluate(() => closeModal('filtersModal')); await page.waitForTimeout(400);

// Captura: a tela AO VIVO e o momento, no mesmo instante. O FAB é escondido no
// print ao vivo E na remontagem (ele é do instrumento, não da app) — comparar
// com ele dentro mediria o botão, não a tela.
const aoVivo = [];
async function capturar(nome) {
  await page.evaluate(() => { document.getElementById('devFab').style.visibility = 'hidden'; });
  const arq = join(SAIDA, `vivo-${String(aoVivo.length + 1).padStart(2, '0')}.png`);
  await page.screenshot({ path: arq });
  await page.evaluate(() => { document.getElementById('devFab').style.visibility = ''; });
  const b = await page.$('#devFabBtn');
  const r = await b.boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
  await page.waitForTimeout(300);
  aoVivo.push({ nome, arq });
}

// ── os estados ────────────────────────────────────────────────────────────
await capturar('card com foto');

await page.click('#filtersBtn'); await page.waitForTimeout(500);
await capturar('modal de Filtros aberto');
await page.evaluate(() => closeModal('filtersModal')); await page.waitForTimeout(300);

await page.click('#helpBtn'); await page.waitForTimeout(500);
await capturar('modal de Ajuda aberto');
await page.evaluate(() => closeModal('helpModal')); await page.waitForTimeout(300);

// tema claro (o diagnóstico tem que trazer o tema junto)
await page.click('#themeToggle').catch(() => {});
await page.waitForTimeout(400);
await capturar('tema trocado');
await page.click('#themeToggle').catch(() => {});
await page.waitForTimeout(400);

// idioma: a remontagem tem que sair na língua da captura
await page.evaluate(() => { setLang('fr'); applyI18n(); }); await page.waitForTimeout(400);
await capturar('interface em francês');
await page.evaluate(() => { setLang('pt'); applyI18n(); }); await page.waitForTimeout(300);

// fila vazia legítima
await page.evaluate(() => {
  AppState.queue = []; AppState.hasMore = false; AppState.loadError = false;
  AppState.serverTotal = 0; showNoPlaces(); updatePendingCount();
});
await page.waitForTimeout(500);
await capturar('painel Tudo limpo');

// painel de falha
await page.evaluate(() => { AppState.loadError = true; showNoPlaces(); });
await page.waitForTimeout(400);
await capturar('painel Falha ao carregar');

// ── baixa e remonta ───────────────────────────────────────────────────────
const b = await page.$('#devFabBtn');
const rb = await b.boundingBox();
await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  (async () => { await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up(); })(),
]);
const json = join(SAIDA, 'diag.json');
await dl.saveAs(json);
const d = JSON.parse(readFileSync(json, 'utf8'));
console.log(`\ndiagnóstico: ${Math.round(readFileSync(json, 'utf8').length / 1024)} KB · `
  + `${(d.momentos || []).length} momentos\n`);

// `--cru`: sem as marcas do instrumento (hachura, molduras). Elas são anotação
// da ferramenta, não desenho da app — com elas ligadas a conta media a anotação.
execFileSync('node', ['tools/diag-tela.mjs', json, join(SAIDA, 'remontado'), '--cru'],
  { cwd: '/home/user/wazeplaces', stdio: 'inherit' });

// O FAB tem que sumir da remontagem também, senão ele conta como diferença.
// (O tool o marca com moldura; aqui o alvo é comparar a APP.)
console.log('\n── remontagem × tela ao vivo ──');
// Só os momentos MANUAIS pareiam com as capturas: a captura AUTOMÁTICA (erro de
// JS, painel de falha) entra sozinha e é o recurso funcionando — casar 1:1 com
// os toques media o instrumento, não a app.
const todos = d.momentos || [];
const momentos = todos.filter((m) => m.motivo === 'manual');
checa(momentos.length === aoVivo.length,
  `${momentos.length} momentos manuais para ${aoVivo.length} toques`, 'contagem tem que bater');
checa(todos.length > momentos.length,
  `a captura automática disparou (${todos.length - momentos.length} momento(s))`,
  'sem ela, o defeito que ninguém registra some');
const idx = todos.map((m, i) => (m.motivo === 'manual' ? i : -1)).filter((i) => i >= 0);

for (let i = 0; i < Math.min(momentos.length, aoVivo.length); i++) {
  const remontado = join(SAIDA, 'remontado', `momento-${String(idx[i] + 1).padStart(2, '0')}.png`);
  const r = await diferenca(aoVivo[i].arq, remontado);
  if (r.erro) { checa(false, `${aoVivo[i].nome}: ${r.erro}`); continue; }
  // 8% é folga pra fonte carregando em tempo diferente, sombra e antialias — a
  // falha que se quer pegar (CSS inteiro sumindo) dá 60%+ e não passa nem perto.
  checa(r.pct <= 8, `${aoVivo[i].nome}: ${r.pct}% de pixels diferentes`,
    r.pct > 8 ? `${r.largura}x${r.altura}` : '');
}

// ── conferências que a imagem sozinha não dá ──────────────────────────────
console.log('\n── o que a imagem não mostra ──');
for (let i = 0; i < momentos.length; i++) {
  const html = readFileSync(join(SAIDA, 'remontado', `.momento-${idx[i] + 1}.html`), 'utf8');
  const p = await browser.newPage();
  await p.goto('file://' + join(SAIDA, 'remontado', `.momento-${idx[i] + 1}.html`), { waitUntil: 'load' });
  const est = await p.evaluate(() => ({
    folhas: document.styleSheets.length,
    // SOMA de todas as folhas: a primeira agora é a da FONTE (uma regra só), e
    // olhar só `[0]` media a folha errada — o guard acusava 1 regra com o CSS
    // inteiro presente.
    regras: [...document.styleSheets].reduce((a, f) => {
      try { return a + f.cssRules.length; } catch (e) { return a; }
    }, 0),
    fundo: getComputedStyle(document.body).backgroundColor,
    fonte: getComputedStyle(document.body).fontFamily.slice(0, 40),
    scripts: document.querySelectorAll('script').length,
    canvas: document.querySelectorAll('canvas').length,
  }));
  await p.close();
  if (i === 0) {
    checa(est.folhas > 0 && est.regras > 100,
      `o CSS chega ao documento (${est.folhas} folha(s), ${est.regras} regras)`,
      'foi este o defeito que entregou imagem sem estilo duas vezes');
    checa(est.fundo !== 'rgba(0, 0, 0, 0)', `o corpo tem fundo pintado (${est.fundo})`);
    checa(/Inter/.test(est.fonte), `a fonte real está embutida (${est.fonte})`);
    checa(est.scripts === 0, 'nenhum script sobrou — a remontagem não re-executa a app');
    checa(est.canvas === 0, 'todo canvas virou imagem — pixel de canvas não vive no DOM');
  }
  // O painel que o momento DIZ que estava visível é o que aparece na remontagem.
  const m = momentos[i];
  const painelNoHtml = /id="loadErrorState"[^>]*class="(?![^"]*hidden)/.test(html) ? 'falhaAoCarregar'
    : /id="noMoreCards"[^>]*class="(?![^"]*hidden)/.test(html) ? 'tudoLimpo'
    : /class="[^"]*place-card/.test(html) ? 'card' : 'nada';
  checa(painelNoHtml === m.painel || m.painel === 'card',
    `momento ${i + 1} (${aoVivo[i] ? aoVivo[i].nome : '?'}): o painel bate (${m.painel})`,
    `remontado mostra ${painelNoHtml}`);
}

// Idioma e tema viajam junto?
const fr = momentos.findIndex((m) => aoVivo[momentos.indexOf(m)]);
const iFr = aoVivo.findIndex((a) => a.nome === 'interface em francês');
const htmlFr = readFileSync(join(SAIDA, 'remontado', `.momento-${idx[iFr] + 1}.html`), 'utf8');
checa(/Filtres|Aide|Passer/i.test(htmlFr), 'o momento em francês remonta EM FRANCÊS');

checa(errosJs.length === 0, 'zero erro de JS na app durante toda a bateria', errosJs[0] || '');

// ── o caminho de ABORTO ───────────────────────────────────────────────────
console.log('\n── recusa de entregar imagem errada ──');
const quebrado = join(SAIDA, 'quebrado.json');
const { writeFileSync } = await import('node:fs');
writeFileSync(quebrado, JSON.stringify({
  app: { rotulo: 'x' }, ambiente: { tela: { janela: '390x844', dpr: 2 } },
  codigo: { 'https://x/css/app.css': { tipo: 'text/css', corpo: 'body{color:red}' } },
  dom: '<html><head><title>t</title><!-- comentário que nunca fecha </head><body>oi</body></html>',
}));
let saiu = 0;
try { execFileSync('node', ['tools/diag-tela.mjs', quebrado, join(SAIDA, 'aborto')],
  { cwd: '/home/user/wazeplaces', stdio: 'pipe' }); }
catch (e) { saiu = e.status; }
checa(saiu === 1, 'CSS num ponto irrenderizável faz a ferramenta ABORTAR', `saiu ${saiu}`);
let pngs = 0;
try { pngs = (await import('node:fs')).readdirSync(join(SAIDA, 'aborto')).filter((f) => f.endsWith('.png')).length; }
catch (e) {}
checa(pngs === 0, 'e não deixa nenhum PNG pra trás — imagem errada é pior que imagem nenhuma');

await browser.close(); srv.kill();
console.log(falhas === 0
  ? `\n✓ diag-tela: ${aoVivo.length} estados remontados e conferidos contra a tela ao vivo`
  : `\n✗ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
